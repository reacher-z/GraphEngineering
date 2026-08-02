#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { canonicalHash, canonicalSerialize } from "../../packages/core/dist/index.js";
import {
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  cycleStoreAdapterCodec,
} from "../../packages/runtime/dist/index.js";
import * as publicApi from "../../packages/sqlite/dist/index.js";
import {
  activateSQLiteCursorOuterPublicationAuthorityIntrinsic,
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorMigration0002CatalogRebuildIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlCatalogFenceIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  prepareSQLiteCursorOuterPublicationAuthorityIntrinsic,
  readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic,
  readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic,
  readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic,
  readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-outer-authority.js";
import {
  createSQLiteCursorMigrationLockCapabilityIntrinsic,
  createSQLiteCursorProviderClockCapabilityIntrinsic,
  createSQLiteCursorProviderClockSourceIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-clock-authority.js";
import {
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
  readSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-target-catalog.js";
import { ensureSQLiteCycleStoreSchema } from "../../packages/sqlite/dist/migrations.js";
import { runSQLiteCheckpointInvariantCampaign } from
  "../../packages/sqlite/dist/operation-baseline-checkpoint-invariants.js";
import { runSQLiteCursorPreRebindCampaign } from
  "../../packages/sqlite/dist/operation-baseline-cursor-campaign.js";
import {
  beginSQLiteCursorStageOwnershipTransfer,
  createSQLiteCursorSealTempTable,
} from "../../packages/sqlite/dist/operation-baseline-cursor-stage-ownership.js";
import { runSQLiteLeaseLockHoldInvariantCampaign } from
  "../../packages/sqlite/dist/operation-baseline-lease-lock-hold-invariants.js";
import { runSQLiteLegacyInvariantCampaign } from
  "../../packages/sqlite/dist/operation-baseline-legacy-invariants.js";
import { stageSQLiteV1BaselineSourceIntoTempStage } from
  "../../packages/sqlite/dist/operation-baseline-reconcile.js";
import {
  configureSQLiteBaselineTempStorage,
  createSQLiteBaselineTempStage,
  proveSQLiteExclusiveBaselineTransaction,
} from "../../packages/sqlite/dist/operation-baseline-stage.js";
import { runSQLiteStreamRecordInvariantCampaign } from
  "../../packages/sqlite/dist/operation-baseline-stream-record-invariants.js";
import { readSQLiteV1BaselineOrderedTempProjection } from
  "../../packages/sqlite/dist/operation-baseline-handoff.js";
import {
  SQLiteCursorPreRebindReceiptIssuer,
  assertSQLiteCursorPreRebindReceiptProvenance,
  createSQLiteCursorCaptureSession,
  createSQLiteCursorExactProjectionReference,
  createSQLiteCursorOwnershipCapability,
} from "../../packages/sqlite/dist/operation-baseline-cursor-ownership.js";
import { SQLITE_CURSOR_SEAL_EMPTY_ROOT } from
  "../../packages/sqlite/dist/operation-baseline-cursor-invariants.js";
import { captureSQLiteV1BaselineSourceSummary } from
  "../../packages/sqlite/dist/operation-baseline-source.js";
import {
  SQLiteConnection,
  readSQLiteConnectionOwnerSnapshot,
} from "../../packages/sqlite/dist/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from
  "../../packages/sqlite/dist/sqlite-profile.js";

const CAPTURED_AT_MS = 1_785_110_405_000;
const SOURCE_OBSERVED_AT_MS = CAPTURED_AT_MS - 1;
const LEGACY_COMMITTED_AT_MS = CAPTURED_AT_MS - 10;
const SEQUENCE_UPDATED_AT_MS = CAPTURED_AT_MS + 1_234;
const LOCK = Object.freeze({
  activeExpiresAtMs: CAPTURED_AT_MS + 100_000,
  fencingToken: 1,
  lockEpoch: 1,
  lockId: "b3-initial-parity-lock",
  ownerId: "b3-initial-parity-owner",
  sourceSchemaVersion: 1,
  targetSchemaVersion: 2,
});
const REBIND_SQL = /UPDATE\s+(?:main\.)?ge_cycle_cursors\s+SET/iu;
const COMMIT_SQL = /(?:^|;)\s*COMMIT\b/imu;
const ROLLBACK_SQL = /(?:^|;)\s*ROLLBACK\b/imu;
const BEGIN_EXCLUSIVE_SQL = /^\s*BEGIN\s+EXCLUSIVE\b/iu;

const databasePrepareIntrinsic = DatabaseSync.prototype.prepare;
const databaseExecIntrinsic = DatabaseSync.prototype.exec;
let activeRecorder = null;
let capturedNativeDatabase = null;

export class CounterRecorder {
  constructor() {
    this.providerClockReadCount = 0;
    this.clockEvidenceConsumeCount = 0;
    this.outerAuthorityMintCount = 0;
    this.perWritePrepareCounts = [0, 0, 0, 0];
    this.perWriteExecuteCounts = [0, 0, 0, 0];
    this.perWriteAffectedRowCounts = [0, 0, 0, 0];
    this.perWriteTotalChangesDeltas = [0, 0, 0, 0];
    this.outerLedgerLogicalWriteSequence = 0;
    this.outerLedgerFixedStatementCount = 0;
    this.outerLedgerAffectedRowsWatermark = 0;
    this.postDdlCatalogFenceMintCount = 0;
    this.readerLeaseMintCount = 0;
    this.readerLeaseCloseCount = 0;
    this.initialWriteReceiptMintCount = 0;
    this.initialWriteReceiptConsumeCount = 0;
    this.initialWriteReceiptTombstoneCount = 0;
    this.stageAdoptionReceiptMintCount = 0;
    this.cursorRebindPrepareCount = 0;
    this.cursorRebindExecuteCount = 0;
    this.commitCount = 0;
    this.rollbackCount = 0;
  }

  providerClockRead() { this.providerClockReadCount += 1; }
  clockEvidenceConsumed() { this.clockEvidenceConsumeCount += 1; }
  outerAuthorityMinted() { this.outerAuthorityMintCount += 1; }
  writePrepared(slot) { this.perWritePrepareCounts[slot] += 1; }
  writeExecuted(slot) { this.perWriteExecuteCounts[slot] += 1; }
  writeAffected(slot) { this.perWriteAffectedRowCounts[slot] += 1; }
  writeChanged(slot) { this.perWriteTotalChangesDeltas[slot] += 1; }
  ledgerLogicalWrite() { this.outerLedgerLogicalWriteSequence += 1; }
  ledgerFixedStatement() { this.outerLedgerFixedStatementCount += 1; }
  ledgerAffectedRow() { this.outerLedgerAffectedRowsWatermark += 1; }
  catalogFenceMinted() { this.postDdlCatalogFenceMintCount += 1; }
  readerLeaseMinted() { this.readerLeaseMintCount += 1; }
  readerLeaseClosed() { this.readerLeaseCloseCount += 1; }
  initialWriteReceiptMinted() { this.initialWriteReceiptMintCount += 1; }
  initialWriteReceiptConsumed() { this.initialWriteReceiptConsumeCount += 1; }
  initialWriteReceiptTombstoned() { this.initialWriteReceiptTombstoneCount += 1; }
  stageAdoptionReceiptMinted() { this.stageAdoptionReceiptMintCount += 1; }
  cursorRebindPrepared() { this.cursorRebindPrepareCount += 1; }
  cursorRebindExecuted() { this.cursorRebindExecuteCount += 1; }
  committed() { this.commitCount += 1; }
  rolledBack() { this.rollbackCount += 1; }

  recordWrite(slot, snapshot) {
    for (let index = 0; index < snapshot.prepareCount; index += 1) this.writePrepared(slot);
    for (let index = 0; index < snapshot.executeCount; index += 1) this.writeExecuted(slot);
    for (let index = 0; index < snapshot.affectedRows; index += 1) this.writeAffected(slot);
    for (let index = 0; index < snapshot.totalChangesDelta; index += 1) this.writeChanged(slot);
    for (let index = 0; index < snapshot.outerLedgerDelta.logicalWriteSequence; index += 1) {
      this.ledgerLogicalWrite();
    }
    for (let index = 0; index < snapshot.outerLedgerDelta.fixedStatementCount; index += 1) {
      this.ledgerFixedStatement();
    }
    for (let index = 0; index < snapshot.outerLedgerDelta.affectedRowsWatermark; index += 1) {
      this.ledgerAffectedRow();
    }
    this.initialWriteReceiptMinted();
  }

  normalizedSnapshot() {
    return Object.freeze({
      providerClockReadCount: this.providerClockReadCount,
      clockEvidenceConsumeCount: this.clockEvidenceConsumeCount,
      outerAuthorityMintCount: this.outerAuthorityMintCount,
      perWritePrepareCounts: Object.freeze([...this.perWritePrepareCounts]),
      perWriteExecuteCounts: Object.freeze([...this.perWriteExecuteCounts]),
      perWriteAffectedRowCounts: Object.freeze([...this.perWriteAffectedRowCounts]),
      perWriteTotalChangesDeltas: Object.freeze([...this.perWriteTotalChangesDeltas]),
      outerLedgerLogicalWriteSequence: this.outerLedgerLogicalWriteSequence,
      outerLedgerFixedStatementCount: this.outerLedgerFixedStatementCount,
      outerLedgerAffectedRowsWatermark: this.outerLedgerAffectedRowsWatermark,
      postDdlCatalogFenceMintCount: this.postDdlCatalogFenceMintCount,
      readerLeaseMintCount: this.readerLeaseMintCount,
      readerLeaseCloseCount: this.readerLeaseCloseCount,
      initialWriteReceiptMintCount: this.initialWriteReceiptMintCount,
      initialWriteReceiptConsumeCount: this.initialWriteReceiptConsumeCount,
      initialWriteReceiptTombstoneCount: this.initialWriteReceiptTombstoneCount,
      stageAdoptionReceiptMintCount: this.stageAdoptionReceiptMintCount,
      cursorRebindPrepareCount: this.cursorRebindPrepareCount,
      cursorRebindExecuteCount: this.cursorRebindExecuteCount,
      commitCount: this.commitCount,
    });
  }
}

DatabaseSync.prototype.prepare = function auditedPrepare(sql) {
  const rebind = typeof sql === "string" && REBIND_SQL.test(sql);
  if (rebind && activeRecorder !== null) activeRecorder.cursorRebindPrepared();
  const statement = Reflect.apply(databasePrepareIntrinsic, this, [sql]);
  if (!rebind) return statement;
  return new Proxy(statement, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (!["all", "get", "iterate", "run"].includes(String(property))) {
        return value.bind(target);
      }
      return (...parameters) => {
        if (activeRecorder !== null) activeRecorder.cursorRebindExecuted();
        return Reflect.apply(value, target, parameters);
      };
    },
  });
};

DatabaseSync.prototype.exec = function auditedExec(sql) {
  if (typeof sql === "string" && BEGIN_EXCLUSIVE_SQL.test(sql)) {
    capturedNativeDatabase = this;
  }
  if (activeRecorder !== null && typeof sql === "string") {
    if (COMMIT_SQL.test(sql)) activeRecorder.committed();
    if (ROLLBACK_SQL.test(sql)) activeRecorder.rolledBack();
  }
  return Reflect.apply(databaseExecIntrinsic, this, [sql]);
};

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function expectConsumedReceipt(read, expectedMessage) {
  let rejected = false;
  try {
    read();
  } catch (error) {
    rejected = error?.code === "GE_CYCLE_STORE_INVALID_ARGUMENT"
      && error?.message === expectedMessage;
  }
  invariant(rejected, `TypeScript consumed receipt remained readable: ${expectedMessage}`);
}

function installMigrationLock(connection) {
  connection.prepare(`
    INSERT INTO main.ge_cycle_used_migration_lock_ids
      (lock_id, lock_epoch, fencing_token, first_used_at_ms)
    VALUES (?, ?, ?, ?)
  `, "inspect-schema").run(
    LOCK.lockId,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    SOURCE_OBSERVED_AT_MS,
  );
  connection.prepare(`
    UPDATE main.ge_cycle_migration_lock
       SET active_lock_id = ?, active_owner_id = ?, active_source_version = ?,
           active_target_version = ?, active_lock_epoch = ?, active_fencing_token = ?,
           active_acquired_at_ms = ?, active_expires_at_ms = ?,
           last_lock_epoch = ?, last_fencing_token = ?, updated_at_ms = ?
     WHERE singleton = 1
  `, "inspect-schema").run(
    LOCK.lockId,
    LOCK.ownerId,
    LOCK.sourceSchemaVersion,
    LOCK.targetSchemaVersion,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    SOURCE_OBSERVED_AT_MS,
    LOCK.activeExpiresAtMs,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    SOURCE_OBSERVED_AT_MS,
  );
}

function seedEverySourceFamily(connection) {
  const record = createCycleStoreRecord({
    previousRecordHash: null,
    recordId: "record-a",
    sequence: 0,
    value: 7,
  });
  const valueBlob = Buffer.from(canonicalSerialize(record.value), "utf8");
  const recordBlob = Buffer.from(canonicalSerialize(record), "utf8");
  connection.prepare(`
    INSERT INTO main.ge_cycle_streams
      (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
    VALUES ('tenant-a', 'stream-a', -1, NULL, ?, ?)
  `, "inspect-schema").run(SOURCE_OBSERVED_AT_MS, SOURCE_OBSERVED_AT_MS);
  connection.prepare(`
    INSERT INTO main.ge_cycle_records
      (tenant_id, stream_id, sequence, record_id, previous_record_hash,
       value_hash, value_bytes, value_blob, record_hash, record_blob, committed_at_ms)
    VALUES ('tenant-a', 'stream-a', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, "inspect-schema").run(
    record.sequence,
    record.recordId,
    record.previousRecordHash,
    record.valueHash,
    record.valueBytes,
    valueBlob,
    record.recordHash,
    recordBlob,
    SOURCE_OBSERVED_AT_MS,
  );
  connection.prepare(`
    UPDATE main.ge_cycle_streams
       SET tail_sequence = ?, tail_record_hash = ?
     WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'
  `, "inspect-schema").run(record.sequence, record.recordHash);

  const checkpoint = createCycleStoreCheckpoint({
    boundRecordHash: record.recordHash,
    boundSequence: 0,
    checkpointId: "checkpoint-a",
    checkpointScope: "scope-a",
    createdAt: "2026-07-28T00:00:00.123Z",
    streamId: "stream-a",
    value: 9,
  });
  const { value: _checkpointValue, ...checkpointSummary } = checkpoint;
  const checkpointValueBlob = Buffer.from(canonicalSerialize(checkpoint.value), "utf8");
  const checkpointBlob = Buffer.from(canonicalSerialize(checkpoint), "utf8");
  const summaryBlob = Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", checkpointSummary),
  );
  connection.prepare(`
    INSERT INTO main.ge_cycle_checkpoints
      (tenant_id, checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
       bound_record_hash, created_at, value_hash, value_bytes, value_blob,
       checkpoint_blob, summary_blob, checkpoint_revision, committed_at_ms)
    VALUES ('tenant-a', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `, "inspect-schema").run(
    checkpoint.checkpointScope,
    checkpoint.checkpointId,
    checkpoint.streamId,
    checkpoint.boundSequence,
    checkpoint.boundRecordHash,
    checkpoint.createdAt,
    checkpoint.valueHash,
    checkpoint.valueBytes,
    checkpointValueBlob,
    checkpointBlob,
    summaryBlob,
    SOURCE_OBSERVED_AT_MS,
  );
  connection.prepare(`
    INSERT INTO main.ge_cycle_checkpoint_revisions
      (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
       summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at,
       value_hash, value_bytes, recorded_at_ms)
    VALUES ('tenant-a', ?, 1, ?, 'put', ?, ?, ?, ?, ?, ?, ?)
  `, "inspect-schema").run(
    checkpoint.checkpointScope,
    checkpoint.checkpointId,
    summaryBlob,
    checkpoint.boundSequence,
    checkpoint.boundRecordHash,
    checkpoint.createdAt,
    checkpoint.valueHash,
    checkpoint.valueBytes,
    SOURCE_OBSERVED_AT_MS,
  );
  connection.prepare(`
    INSERT INTO main.ge_cycle_leases
      (tenant_id, stream_id, active_lease_id, active_holder_id,
       active_lease_epoch, active_fencing_token, active_acquired_at_ms,
       active_expires_at_ms, last_lease_epoch, last_fencing_token, updated_at_ms)
    VALUES ('tenant-a', 'stream-a', 'lease-a', 'holder-a', 1, 1, ?, ?, 1, 1, ?)
  `, "inspect-schema").run(
    SOURCE_OBSERVED_AT_MS,
    CAPTURED_AT_MS + 1,
    SOURCE_OBSERVED_AT_MS,
  );
  connection.prepare(`
    INSERT INTO main.ge_cycle_used_lease_ids
      (tenant_id, stream_id, lease_id, lease_epoch, fencing_token, first_used_at_ms)
    VALUES ('tenant-a', 'stream-a', 'lease-a', 1, 1, ?)
  `, "inspect-schema").run(SOURCE_OBSERVED_AT_MS);
  connection.prepare(`
    INSERT INTO main.ge_cycle_legal_holds
      (tenant_id, stream_id, hold_id, placed_at_ms)
    VALUES ('tenant-a', 'stream-a', 'hold-a', ?)
  `, "inspect-schema").run(SOURCE_OBSERVED_AT_MS);

  const legacyResult = Object.freeze({
    archiveMode: "lossless-before-delete",
    compactionMode: "logical-history-preserving",
    legalHoldIds: Object.freeze(["hold-a"]),
    retentionMode: "retain-authoritative-history",
  });
  const resultBlob = Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("set-legal-hold", legacyResult),
  );
  connection.prepare(`
    INSERT INTO main.ge_cycle_operations
      (tenant_id, operation_id, operation_name, request_hash,
       result_blob, result_hash, committed_at_ms)
    VALUES ('tenant-a', 'operation-a', 'set-legal-hold', ?, ?, ?, ?)
  `, "inspect-schema").run(
    createHash("sha256").update("request-a").digest("hex"),
    resultBlob,
    canonicalHash(legacyResult),
    LEGACY_COMMITTED_AT_MS,
  );
}

function mintPreRebindReceipt(sourceSummary, projectionIdentity) {
  const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
  const sealReceipt = Object.freeze({
    cursorCount: 0,
    immutableRootSha256: SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    sourceDescriptorHash: sourceSummary.sourceEnvelope.sourceDescriptorHash,
    sourceSchemaIdentitySha256: sourceSummary.sourceEnvelope.sourceSchemaIdentitySha256,
  });
  const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, 1));
  const sourceStageOwnership = createSQLiteCursorOwnershipCapability(
    "source-stage", Buffer.alloc(32, 2),
  );
  const campaignOwnership = createSQLiteCursorOwnershipCapability(
    "campaign", Buffer.alloc(32, 3),
  );
  const connectionOwnership = createSQLiteCursorOwnershipCapability(
    "connection", Buffer.alloc(32, 4),
  );
  const session = createSQLiteCursorCaptureSession({
    campaignOwnership,
    connectionOwnership,
    nonce: Buffer.alloc(32, 5),
    sourceStageOwnership,
    tenantOwnership,
  });
  const input = Object.freeze({
    campaignOwnership,
    clockEvidence: sourceSummary.clockEvidence,
    connectionOwnership,
    projectionIdentity,
    projectionReference,
    sealReceipt,
    session,
    sourceStageOwnership,
    sourceSummary,
    tenantOwnership,
  });
  return new SQLiteCursorPreRebindReceiptIssuer(input).issue(input);
}

export function createGraph(recorder) {
  capturedNativeDatabase = null;
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-b3-initial-ts-parity-"));
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  let stage;
  try {
    ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
      appliedAtMs: CAPTURED_AT_MS - 2,
    });
    installMigrationLock(connection);
    configureSQLiteBaselineTempStorage(connection);
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    invariant(capturedNativeDatabase !== null,
      "TypeScript parity graph did not capture its native SQLite owner");
    const nativeDatabase = capturedNativeDatabase;
    activeRecorder = recorder;
    seedEverySourceFamily(connection);

    stage = createSQLiteBaselineTempStage(
      connection,
      proveSQLiteExclusiveBaselineTransaction(connection),
    );
    const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
    stageSQLiteV1BaselineSourceIntoTempStage(connection, sourceSummary, stage);
    const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
      connection,
      sourceSummary,
      stage,
    );
    const diagnostics = [
      ...runSQLiteStreamRecordInvariantCampaign(connection, projectionIdentity, stage).diagnostics,
      ...runSQLiteCheckpointInvariantCampaign(connection, projectionIdentity, stage).diagnostics,
      ...runSQLiteLeaseLockHoldInvariantCampaign(connection, projectionIdentity, stage).diagnostics,
      ...runSQLiteLegacyInvariantCampaign(connection, projectionIdentity, stage).diagnostics,
    ];
    invariant(diagnostics.length === 0, "TypeScript parity B2 graph is not clean");
    invariant(projectionIdentity.entryCount === 12, "TypeScript parity control entry count drifted");
    invariant(
      projectionIdentity.legacyOperationCount === 1,
      "TypeScript parity control legacy-operation count drifted",
    );

    const preRebindReceipt = mintPreRebindReceipt(sourceSummary, projectionIdentity);
    const projectionReference = assertSQLiteCursorPreRebindReceiptProvenance(
      preRebindReceipt,
    ).projectionReference;
    const transfer = beginSQLiteCursorStageOwnershipTransfer(
      connection,
      stage,
      preRebindReceipt,
    );
    createSQLiteCursorSealTempTable(connection, stage, preRebindReceipt, transfer);
    const b2 = runSQLiteCursorPreRebindCampaign(
      connection,
      stage,
      preRebindReceipt,
      transfer,
    );
    invariant(b2.status === "pre-rebind-complete", "TypeScript parity B2 did not complete");

    const migrationLockCapability = createSQLiteCursorMigrationLockCapabilityIntrinsic(
      connection,
      LOCK,
    );
    const clockSource = createSQLiteCursorProviderClockSourceIntrinsic(() => {
      recorder.providerClockRead();
      return SEQUENCE_UPDATED_AT_MS;
    });
    const providerClockCapability = createSQLiteCursorProviderClockCapabilityIntrinsic(
      connection,
      migrationLockCapability,
      clockSource,
    );
    const outerClockEvidence = observeSQLiteCursorProviderClockIntrinsic(
      providerClockCapability,
      "before-first-permanent-mutation",
    );
    const authority = prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
      connection,
      stage,
      preRebindReceipt,
      projectionIdentity,
      transfer,
      migrationLockCapability,
      providerClockCapability,
      outerClockEvidence,
    );
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const activated = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority);
    invariant(activated.activationCount === 1, "TypeScript outer authority was not minted once");
    invariant(
      activated.outerClockConsumedTombstone !== undefined,
      "TypeScript outer clock evidence was not consumed",
    );
    recorder.clockEvidenceConsumed();
    recorder.outerAuthorityMinted();

    return {
      authority,
      connection,
      initialLineage: activated.transactionLineage,
      nativeDatabase,
      preRebindReceipt,
      projectionIdentity,
      projectionReference,
      root,
      stage,
      transfer,
    };
  } catch (error) {
    try { stage?.dispose(); } catch { /* Preserve the primary failure. */ }
    try {
      if (connection.isOpen && connection.isTransaction) {
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
    } catch { /* Preserve the primary failure. */ }
    try { if (connection.isOpen) connection.close(); } catch { /* Best effort. */ }
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function disposeGraph(graph) {
  try { graph.stage.dispose(); } catch { /* A hostile case may poison the stage. */ }
  try {
    if (graph.connection.isOpen && graph.connection.isTransaction) {
      graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    }
  } catch { /* Best effort after the subject observation. */ }
  try { if (graph.connection.isOpen) graph.connection.close(); } catch { /* Best effort. */ }
  rmSync(graph.root, { recursive: true, force: true });
}

/** Detach tracing before cleanup rollback so subject counters remain exact. */
export function detachActiveRecorder() {
  activeRecorder = null;
}

export function recordInitialAdoptionCounts(recorder, authority) {
  for (let index = 0; index < authority.receiptConsumptionCount; index += 1) {
    recorder.initialWriteReceiptConsumed();
  }
  for (let index = 0; index < authority.tombstoneMintCount; index += 1) {
    recorder.initialWriteReceiptTombstoned();
  }
  for (let index = 0; index < authority.initialStageAdoptionReceiptMintCount; index += 1) {
    recorder.stageAdoptionReceiptMinted();
  }
}

function executeMigration(graph, recorder) {
  const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(graph.authority);
  const snapshot = readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(receipt);
  recorder.recordWrite(0, snapshot);
  return receipt;
}

export function executeThroughInitialWrites(graph, recorder) {
  const migrationReceipt = executeMigration(graph, recorder);
  const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(
    graph.authority,
    migrationReceipt,
  );
  recorder.catalogFenceMinted();
  const readerLease = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
    graph.authority,
    migrationReceipt,
    fence,
  );
  recorder.readerLeaseMinted();
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
    graph.authority,
    migrationReceipt,
    fence,
    readerLease,
  );
  recorder.readerLeaseClosed();
  const entriesReceipt = executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
    graph.authority,
    migrationReceipt,
    fence,
    readerLease,
  );
  recorder.recordWrite(
    1,
    readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(entriesReceipt),
  );
  const headerReceipt = executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
    graph.authority,
    migrationReceipt,
    fence,
    readerLease,
    entriesReceipt,
  );
  recorder.recordWrite(
    2,
    readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(headerReceipt),
  );
  const sequenceReceipt = executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
    graph.authority,
    migrationReceipt,
    fence,
    readerLease,
    entriesReceipt,
    headerReceipt,
  );
  recorder.recordWrite(
    3,
    readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(sequenceReceipt),
  );
  return {
    bundle: Object.freeze([
      migrationReceipt,
      entriesReceipt,
      headerReceipt,
      sequenceReceipt,
    ]),
    entriesReceipt,
    fence,
    headerReceipt,
    migrationReceipt,
    readerLease,
    sequenceReceipt,
  };
}

export function recordFromObservation({
  authority,
  bundleRetryable,
  caseId,
  catalogFenceMatches,
  failureBoundary,
  initialLineage,
  outcome,
  recorderSnapshot,
  state,
}) {
  const owner = readSQLiteConnectionOwnerSnapshot(authority.connection);
  return Object.freeze({
    caseId,
    outcome,
    failureBoundary,
    state,
    poisoned: authority.lifecycle === "poisoned",
    providerClockReadCount: recorderSnapshot.providerClockReadCount,
    clockEvidenceConsumeCount: recorderSnapshot.clockEvidenceConsumeCount,
    outerAuthorityMintCount: recorderSnapshot.outerAuthorityMintCount,
    perWritePrepareCounts: recorderSnapshot.perWritePrepareCounts,
    perWriteExecuteCounts: recorderSnapshot.perWriteExecuteCounts,
    perWriteAffectedRowCounts: recorderSnapshot.perWriteAffectedRowCounts,
    perWriteTotalChangesDeltas: recorderSnapshot.perWriteTotalChangesDeltas,
    outerLedgerLogicalWriteSequence: authority.outerLedger.logicalWriteSequence,
    outerLedgerFixedStatementCount: authority.outerLedger.fixedStatementCount,
    outerLedgerAffectedRowsWatermark: authority.outerLedger.affectedRowsWatermark,
    postDdlCatalogFenceMintCount: recorderSnapshot.postDdlCatalogFenceMintCount,
    readerLeaseMintCount: recorderSnapshot.readerLeaseMintCount,
    readerLeaseCloseCount: recorderSnapshot.readerLeaseCloseCount,
    initialWriteReceiptMintCount: recorderSnapshot.initialWriteReceiptMintCount,
    initialWriteReceiptConsumeCount: recorderSnapshot.initialWriteReceiptConsumeCount,
    initialWriteReceiptTombstoneCount: recorderSnapshot.initialWriteReceiptTombstoneCount,
    stageAdoptionReceiptMintCount: recorderSnapshot.stageAdoptionReceiptMintCount,
    bundleRetryable,
    sameTransactionLineage: owner.transactionLineage === initialLineage,
    catalogFenceMatches,
    cursorRebindPrepareCount: recorderSnapshot.cursorRebindPrepareCount,
    cursorRebindExecuteCount: recorderSnapshot.cursorRebindExecuteCount,
    commitCount: recorderSnapshot.commitCount,
  });
}

function runSuccessControl() {
  const recorder = new CounterRecorder();
  let graph;
  try {
    graph = createGraph(recorder);
    const writes = executeThroughInitialWrites(graph, recorder);
    adoptSQLiteCursorInitialPublicationStageIntrinsic(
      graph.authority,
      writes.bundle,
      writes.fence,
      writes.readerLease,
    );
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority);
    invariant(
      authority.writePhase === "initial-stage-adoption-complete",
      "TypeScript success control did not reach adoption completion",
    );
    for (let index = 0; index < authority.receiptConsumptionCount; index += 1) {
      recorder.initialWriteReceiptConsumed();
    }
    for (let index = 0; index < authority.tombstoneMintCount; index += 1) {
      recorder.initialWriteReceiptTombstoned();
    }
    for (let index = 0; index < authority.initialStageAdoptionReceiptMintCount; index += 1) {
      recorder.stageAdoptionReceiptMinted();
    }
    const snapshot = recorder.normalizedSnapshot();
    invariant(recorder.rollbackCount === 0, "TypeScript success control rolled back");
    const observedCatalog = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      graph.connection,
    );
    invariant(
      observedCatalog.rowCount === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
      "TypeScript success control target catalog row count drifted",
    );
    return recordFromObservation({
      authority,
      bundleRetryable: false,
      caseId: "initial-publication-success-control",
      catalogFenceMatches:
        observedCatalog.catalogSha256 === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
      failureBoundary: null,
      initialLineage: graph.initialLineage,
      outcome: "success",
      recorderSnapshot: snapshot,
      state: "pre-rebind-complete",
    });
  } finally {
    activeRecorder = null;
    if (graph !== undefined) disposeGraph(graph);
  }
}

function runInvalidBundleControl() {
  const recorder = new CounterRecorder();
  let graph;
  try {
    graph = createGraph(recorder);
    const writes = executeThroughInitialWrites(graph, recorder);
    const invalidBundle = Object.freeze([
      writes.entriesReceipt,
      writes.migrationReceipt,
      writes.headerReceipt,
      writes.sequenceReceipt,
    ]);
    let rejected = false;
    try {
      adoptSQLiteCursorInitialPublicationStageIntrinsic(
        graph.authority,
        invalidBundle,
        writes.fence,
        writes.readerLease,
      );
    } catch (error) {
      rejected = error?.code === "GE_CYCLE_STORE_INVALID_ARGUMENT"
        && error?.message === "SQLite initial publication receipt bundle is invalid";
    }
    invariant(rejected, "TypeScript invalid adoption bundle was not rejected");
    const rejectedAuthority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );
    invariant(rejectedAuthority.lifecycle === "active", "Invalid bundle poisoned the graph");
    invariant(rejectedAuthority.receiptConsumptionCount === 0, "Invalid bundle consumed a receipt");
    const rejectedCounters = recorder.normalizedSnapshot();
    invariant(recorder.rollbackCount === 0, "TypeScript invalid-bundle control rolled back");
    const observedCatalog = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      graph.connection,
    );
    invariant(
      observedCatalog.rowCount === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
      "TypeScript invalid-bundle target catalog row count drifted",
    );
    const record = recordFromObservation({
      authority: rejectedAuthority,
      bundleRetryable: true,
      caseId: "initial-publication-invalid-adoption-bundle",
      catalogFenceMatches:
        observedCatalog.catalogSha256
          === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
      failureBoundary: "initial-stage-adoption-validation",
      initialLineage: graph.initialLineage,
      outcome: "rejected",
      recorderSnapshot: rejectedCounters,
      state: "pre-rebind-complete",
    });

    const adoption = adoptSQLiteCursorInitialPublicationStageIntrinsic(
      graph.authority,
      writes.bundle,
      writes.fence,
      writes.readerLease,
    );
    const corrected = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority);
    invariant(corrected.receiptConsumptionCount === 4,
      "TypeScript invalid-bundle corrected retry did not consume four receipts");
    invariant(corrected.tombstoneMintCount === 4,
      "TypeScript invalid-bundle corrected retry did not mint four tombstones");
    invariant(corrected.initialStageAdoptionReceiptMintCount === 1,
      "TypeScript invalid-bundle corrected retry did not mint one adoption receipt");
    invariant(corrected.initialStageAdoptionReceipt === adoption,
      "TypeScript invalid-bundle corrected retry returned the wrong adoption receipt");
    invariant(corrected.writePhase === "initial-stage-adoption-complete",
      "TypeScript invalid-bundle corrected retry did not succeed");
    const adoptionSnapshot = readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(
      adoption,
    );
    invariant(adoptionSnapshot.mintCount === 1,
      "TypeScript corrected adoption receipt mint count drifted");
    invariant(adoptionSnapshot.writeKind === "initial-publication-stage-adoption",
      "TypeScript corrected adoption receipt kind drifted");
    invariant(adoptionSnapshot.migration0002Receipt === writes.migrationReceipt,
      "TypeScript corrected adoption migration receipt identity drifted");
    invariant(adoptionSnapshot.baselineEntriesPublicationReceipt === writes.entriesReceipt,
      "TypeScript corrected adoption entries receipt identity drifted");
    invariant(adoptionSnapshot.baselineHeaderPublicationReceipt === writes.headerReceipt,
      "TypeScript corrected adoption header receipt identity drifted");
    invariant(
      adoptionSnapshot.operationSequenceZeroPublicationReceipt === writes.sequenceReceipt,
      "TypeScript corrected adoption sequence receipt identity drifted",
    );
    expectConsumedReceipt(
      () => readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(
        writes.migrationReceipt,
      ),
      "SQLite migration 0002 receipt was consumed",
    );
    expectConsumedReceipt(
      () => readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(
        writes.entriesReceipt,
      ),
      "SQLite baseline-entries publication receipt was consumed",
    );
    expectConsumedReceipt(
      () => readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(
        writes.headerReceipt,
      ),
      "SQLite baseline-header publication receipt was consumed",
    );
    expectConsumedReceipt(
      () => readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(
        writes.sequenceReceipt,
      ),
      "SQLite operation-sequence-zero publication receipt was consumed",
    );
    return record;
  } finally {
    activeRecorder = null;
    if (graph !== undefined) disposeGraph(graph);
  }
}

function runCatalogDriftControl() {
  const recorder = new CounterRecorder();
  let graph;
  try {
    graph = createGraph(recorder);
    const migrationReceipt = executeMigration(graph, recorder);
    Reflect.apply(databaseExecIntrinsic, graph.nativeDatabase, [
      "DROP INDEX main.ge_cycle_cursors_open_idx; "
        + "CREATE INDEX ge_cycle_cursors_open_idx "
        + "ON ge_cycle_cursors(tenant_id, token_hash, expires_at_ms)",
    ]);
    const drift = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(graph.connection);
    invariant(drift.rowCount === 34, "TypeScript catalog drift did not preserve row count");
    invariant(
      drift.catalogSha256 !== SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
      "TypeScript catalog drift did not change the physical digest",
    );
    let poisoned = false;
    let poisonEvidence = "no error";
    try {
      mintSQLiteCursorPostDdlCatalogFenceIntrinsic(
        graph.authority,
        migrationReceipt,
      );
    } catch (error) {
      poisonEvidence = `${String(error?.code)}: ${String(error?.message)}`;
      poisoned = error?.code === "GE_CYCLE_STORE_CORRUPTION"
        && error?.message === "SQLite target physical catalog does not match the frozen target";
    }
    invariant(poisoned,
      `TypeScript post-0002 catalog drift did not fail closed (${poisonEvidence})`);
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority);
    invariant(authority.lifecycle === "poisoned", "Catalog drift did not poison authority");
    const snapshot = recorder.normalizedSnapshot();
    invariant(recorder.rollbackCount === 0, "TypeScript catalog-drift control rolled back");
    return recordFromObservation({
      authority,
      bundleRetryable: false,
      caseId: "initial-publication-post-0002-catalog-drift",
      catalogFenceMatches:
        drift.catalogSha256 === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
      failureBoundary: "after-migration-0002-before-fence",
      initialLineage: graph.initialLineage,
      outcome: "poisoned",
      recorderSnapshot: snapshot,
      state: "poisoned",
    });
  } finally {
    activeRecorder = null;
    if (graph !== undefined) disposeGraph(graph);
  }
}

function counterProbe() {
  const recorder = new CounterRecorder();
  recorder.providerClockRead();
  recorder.clockEvidenceConsumed();
  recorder.outerAuthorityMinted();
  recorder.writePrepared(0);
  recorder.writePrepared(1);
  recorder.writePrepared(2);
  recorder.writePrepared(3);
  recorder.writeExecuted(0);
  recorder.writeExecuted(1);
  recorder.writeExecuted(2);
  recorder.writeExecuted(3);
  recorder.writeAffected(0);
  recorder.writeAffected(1);
  recorder.writeAffected(2);
  recorder.writeAffected(3);
  recorder.writeChanged(0);
  recorder.writeChanged(1);
  recorder.writeChanged(2);
  recorder.writeChanged(3);
  recorder.ledgerLogicalWrite();
  recorder.ledgerFixedStatement();
  recorder.ledgerAffectedRow();
  recorder.catalogFenceMinted();
  recorder.readerLeaseMinted();
  recorder.readerLeaseClosed();
  recorder.initialWriteReceiptMinted();
  recorder.initialWriteReceiptConsumed();
  recorder.initialWriteReceiptTombstoned();
  recorder.stageAdoptionReceiptMinted();
  recorder.cursorRebindPrepared();
  recorder.cursorRebindExecuted();
  recorder.committed();
  recorder.rolledBack();
  return Object.freeze({
    ...recorder.normalizedSnapshot(),
    rollbackCount: recorder.rollbackCount,
  });
}

export function runInitialPublicationTypescriptReport() {
  const cases = Object.freeze([
    runSuccessControl(),
    runInvalidBundleControl(),
    runCatalogDriftControl(),
  ]);
  return Object.freeze({
    runtime: "typescript",
    publicExports: {
      packageRootAdoption: Object.hasOwn(
        publicApi,
        "adoptSQLiteCursorInitialPublicationStageIntrinsic",
      ),
      packageRootMeasurement: Object.hasOwn(
        publicApi,
        "readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic",
      ),
    },
    counterProbe: counterProbe(),
    rollbackCount: 0,
    cases,
  });
}

if (process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(runInitialPublicationTypescriptReport())}\n`);
}
