import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  activateSQLiteCursorOuterPublicationAuthorityIntrinsic,
  executeSQLiteCursorMigration0002CatalogRebuildIntrinsic,
  mintSQLiteCursorPostDdlCatalogFenceIntrinsic,
  prepareSQLiteCursorOuterPublicationAuthorityIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-outer-authority.js";
import {
  createSQLiteCursorMigrationLockCapabilityIntrinsic,
  createSQLiteCursorProviderClockCapabilityIntrinsic,
  createSQLiteCursorProviderClockSourceIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-clock-authority.js";
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
  SQLITE_CURSOR_MAIN_SOURCE_QUERY,
  SQLiteCursorPreRebindReceiptIssuer,
  assertSQLiteCursorPreRebindReceiptProvenance,
  createSQLiteCursorCaptureSession,
  createSQLiteCursorExactProjectionReference,
  createSQLiteCursorOwnershipCapability,
} from "../../packages/sqlite/dist/operation-baseline-cursor-ownership.js";
import {
  decodeSQLiteCursorSealRow,
  sealSQLiteCursorRows,
} from "../../packages/sqlite/dist/operation-baseline-cursor-invariants.js";
import { captureSQLiteV1BaselineSourceSummary } from
  "../../packages/sqlite/dist/operation-baseline-source.js";
import { SQLiteConnection } from "../../packages/sqlite/dist/sqlite-connection.js";
import { sqliteRow, sqliteText } from "../../packages/sqlite/dist/sqlite-codec.js";
import { createSQLiteCycleStoreDescriptor } from
  "../../packages/sqlite/dist/sqlite-profile.js";

export const RULE11_PARITY_CAPTURED_AT_MS = 1_785_110_405_000;

const LOCK = Object.freeze({
  activeExpiresAtMs: RULE11_PARITY_CAPTURED_AT_MS + 100_000,
  fencingToken: 1,
  lockEpoch: 1,
  lockId: "rule11-parity-lock",
  ownerId: "rule11-parity-owner",
  sourceSchemaVersion: 1,
  targetSchemaVersion: 2,
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
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
    RULE11_PARITY_CAPTURED_AT_MS - 1,
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
    RULE11_PARITY_CAPTURED_AT_MS - 1,
    LOCK.activeExpiresAtMs,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    RULE11_PARITY_CAPTURED_AT_MS - 1,
  );
}

function insertControlOperation(connection) {
  const result = Buffer.from(
    "{\"archiveMode\":\"lossless-before-delete\","
      + "\"compactionMode\":\"logical-history-preserving\",\"legalHoldIds\":[],"
      + "\"retentionMode\":\"retain-authoritative-history\"}",
    "utf8",
  );
  connection.prepare(`
    INSERT INTO main.ge_cycle_operations
      (tenant_id, operation_id, operation_name, request_hash,
       result_blob, result_hash, committed_at_ms)
    VALUES (?, ?, 'set-legal-hold', ?, ?, ?, ?)
  `, "inspect-schema").run(
    "tenant-rule11",
    "operation-rule11",
    "1".padStart(64, "0"),
    result,
    createHash("sha256").update(result).digest("hex"),
    RULE11_PARITY_CAPTURED_AT_MS - 10,
  );
}

function insertCursorRows(connection, cursorCount) {
  invariant(Number.isSafeInteger(cursorCount) && [0, 1, 3].includes(cursorCount),
    "TypeScript Rule11 parity cursor population is invalid");
  const descriptor = createSQLiteCycleStoreDescriptor().descriptorHash;
  const schema = sqliteText(sqliteRow(connection.prepare(
    "SELECT schema_identity_sha256 FROM main.ge_cycle_schema WHERE singleton = 1",
    "inspect-schema",
  ).get(), 1, "inspect-schema", "schema row")[0], "inspect-schema", "schema identity");
  const insert = connection.prepare(`
    INSERT INTO main.ge_cycle_cursors
      (tenant_id, token_hash, kind, principal_hash, authorization_hash, stream_id,
       checkpoint_scope, request_scope_blob, page_size, next_position,
       snapshot_tail_sequence, snapshot_tail_record_hash, descriptor_hash,
       schema_identity_sha256, snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, "inspect-schema");
  for (let ordinal = 1; ordinal <= cursorCount; ordinal += 1) {
    const streamId = `stream-rule11-${ordinal}`;
    insert.run(
      `tenant-rule11-${ordinal}`,
      ordinal.toString(16).padStart(64, "0"),
      "event",
      "b".repeat(64),
      "c".repeat(64),
      streamId,
      null,
      Buffer.from(
        `{"contractVersion":"cycle-store-provider/v1alpha1","pageSize":1,`
          + `"streamId":"${streamId}"}`,
        "utf8",
      ),
      1,
      0,
      -1,
      null,
      descriptor,
      schema,
      Buffer.from('{"exists":false,"recordHash":null,"sequence":-1}', "utf8"),
      RULE11_PARITY_CAPTURED_AT_MS - 100,
      RULE11_PARITY_CAPTURED_AT_MS + 100,
      null,
    );
  }
}

function sealCursorRows(connection, sourceSummary, cursorCount) {
  const rows = [...connection.prepare(
    SQLITE_CURSOR_MAIN_SOURCE_QUERY,
    "inspect-schema",
  ).iterate()].map(decodeSQLiteCursorSealRow).sort((left, right) =>
    Buffer.compare(Buffer.from(left.carrier.tokenHash), Buffer.from(right.carrier.tokenHash))
      || Buffer.compare(Buffer.from(left.carrier.tenantId), Buffer.from(right.carrier.tenantId)));
  return sealSQLiteCursorRows(
    cursorCount,
    sourceSummary.sourceEnvelope.sourceDescriptorHash,
    sourceSummary.sourceEnvelope.sourceSchemaIdentitySha256,
    rows,
  );
}

function mintPreRebindReceipt(sourceSummary, projectionIdentity, sealReceipt) {
  const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
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

export function createRule11TypescriptGraph(cursorCount) {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-rule11-ts-parity-"));
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  let stage;
  try {
    ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
      appliedAtMs: RULE11_PARITY_CAPTURED_AT_MS - 2,
    });
    installMigrationLock(connection);
    configureSQLiteBaselineTempStorage(connection);
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    insertControlOperation(connection);
    insertCursorRows(connection, cursorCount);
    stage = createSQLiteBaselineTempStage(
      connection,
      proveSQLiteExclusiveBaselineTransaction(connection),
    );
    const sourceSummary = captureSQLiteV1BaselineSourceSummary(
      connection,
      RULE11_PARITY_CAPTURED_AT_MS,
    );
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
    invariant(diagnostics.length === 0, "TypeScript Rule11 parity B2 graph is not clean");
    const sealReceipt = sealCursorRows(connection, sourceSummary, cursorCount);
    const preRebindReceipt = mintPreRebindReceipt(
      sourceSummary,
      projectionIdentity,
      sealReceipt,
    );
    const projectionReference = assertSQLiteCursorPreRebindReceiptProvenance(
      preRebindReceipt,
    ).projectionReference;
    const transfer = beginSQLiteCursorStageOwnershipTransfer(
      connection,
      stage,
      preRebindReceipt,
    );
    createSQLiteCursorSealTempTable(connection, stage, preRebindReceipt, transfer);
    const outcome = runSQLiteCursorPreRebindCampaign(
      connection,
      stage,
      preRebindReceipt,
      transfer,
    );
    invariant(outcome.status === "pre-rebind-complete",
      "TypeScript Rule11 parity B2 did not complete");
    const migrationLockCapability = createSQLiteCursorMigrationLockCapabilityIntrinsic(
      connection,
      LOCK,
    );
    const clockSource = createSQLiteCursorProviderClockSourceIntrinsic(
      () => RULE11_PARITY_CAPTURED_AT_MS + 1_234,
    );
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
    const migration0002Receipt =
      executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(
      authority,
      migration0002Receipt,
    );
    return Object.freeze({
      authority,
      connection,
      cursorCount,
      fence,
      migration0002Receipt,
      preRebindReceipt,
      projectionIdentity,
      projectionReference,
      root,
      sourceSummary,
      stage,
      transfer,
    });
  } catch (error) {
    try { stage?.dispose(); } catch { /* Preserve primary. */ }
    try {
      if (connection.isOpen && connection.isTransaction) {
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
    } catch { /* Preserve primary. */ }
    try { if (connection.isOpen) connection.close(); } catch { /* Preserve primary. */ }
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function disposeRule11TypescriptGraph(graph) {
  let cleanupError;
  try {
    graph.stage.dispose();
    invariant(graph.stage.state === "disposed",
      "TypeScript Rule11 parity TEMP stage did not dispose");
  } catch (error) {
    cleanupError = error;
  }
  try {
    if (graph.connection.isOpen && graph.connection.isTransaction) {
      graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    }
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    if (graph.connection.isOpen) graph.connection.close();
    invariant(!graph.connection.isOpen,
      "TypeScript Rule11 parity connection remained open after close");
  } catch (error) {
    cleanupError ??= error;
  }
  try {
    rmSync(graph.root, { recursive: true, force: false });
    invariant(!existsSync(graph.root),
      "TypeScript Rule11 parity temporary root survived cleanup");
  } catch (error) {
    cleanupError ??= error;
  }
  if (cleanupError !== undefined) throw cleanupError;
}
