import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  cycleStoreAdapterCodec,
  type CycleStoreLedgerResultByOperation,
  type CycleStoreMutationOperation,
} from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import {
  SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_COOPERATIVE_ENTRIES,
  SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF,
  SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_CONSUME_OWNED_WRITE,
  SQLITE_BASELINE_FENCE_ORDERED_HANDOFF,
  SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_OWNED_WRITE,
  type SQLiteBaselineCooperativeSource,
  type SQLiteBaselineCooperativeStage,
  type SQLiteBaselineOwnedWriteReceipt,
} from "../src/operation-baseline-cooperation.js";
import {
  SQLITE_CHECKPOINT_RULES,
  SQLiteCheckpointInvariantCampaign,
  runSQLiteCheckpointInvariantCampaign,
} from "../src/operation-baseline-checkpoint-invariants.js";
import {
  SQLITE_LEASE_LOCK_HOLD_RULES,
  SQLiteLeaseLockHoldInvariantCampaign,
  runSQLiteLeaseLockHoldInvariantCampaign,
  type SQLiteLeaseLockHoldRuleId,
} from "../src/operation-baseline-lease-lock-hold-invariants.js";
import {
  SQLITE_LEGACY_RULES,
  SQLiteLegacyInvariantCampaign,
  runSQLiteLegacyInvariantCampaign,
} from "../src/operation-baseline-legacy-invariants.js";
import { stageSQLiteV1BaselineSourceIntoTempStage } from "../src/operation-baseline-reconcile.js";
import {
  SQLiteV1BaselineOrderedTempReader,
  readSQLiteV1BaselineOrderedTempProjection,
} from "../src/operation-baseline-handoff.js";
import {
  SQLITE_STREAM_RECORD_RULES,
  SQLiteStreamRecordInvariantCampaign,
  runSQLiteStreamRecordInvariantCampaign,
} from "../src/operation-baseline-stream-record-invariants.js";
import {
  MAX_BASELINE_KEY_BYTES,
  MAX_BASELINE_STATE_BYTES,
  buildOperationBaseline,
  createOperationBaselineId,
  decodeOperationBaselineCanonicalBytes,
  encodeOperationBaselineKey,
  encodeOperationBaselineState,
  type OperationBaselineEntryInput,
  type OperationBaselineProjectionIdentity,
} from "../src/operation-baseline.js";
import {
  captureSQLiteV1BaselineSourceSummary,
  type SQLiteV1BaselineSourceSummary,
} from "../src/operation-baseline-source.js";
import {
  configureSQLiteBaselineTempStorage,
  createSQLiteBaselineTempStage,
  proveSQLiteExclusiveBaselineTransaction,
  type SQLiteBaselineTempStage,
} from "../src/operation-baseline-stage.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";

const roots: string[] = [];
const NOW = 1_785_110_405_000;

function opened(appliedAtMs = NOW): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-baseline-reconcile-"));
  roots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs,
  });
  configureSQLiteBaselineTempStorage(connection);
  return connection;
}

function totalChanges(connection: SQLiteConnection): number {
  return Number((connection.prepare(
    "SELECT total_changes()",
    "inspect-schema",
  ).get() as unknown as readonly [number | bigint])[0]);
}

function seedEverySourceFamily(connection: SQLiteConnection): void {
  const record = createCycleStoreRecord({
    previousRecordHash: null,
    recordId: "record-a",
    sequence: 0,
    value: 7,
  });
  const valueBlob = Buffer.from(canonicalSerialize(record.value), "utf8");
  const recordBlob = Buffer.from(canonicalSerialize(record), "utf8");
  connection.prepare(`
    INSERT INTO ge_cycle_streams
      (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
    VALUES ('tenant-a', 'stream-a', -1, NULL, ?, ?)
  `, "inspect-schema").run(NOW, NOW);
  connection.prepare(`
    INSERT INTO ge_cycle_records
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
    NOW,
  );
  connection.prepare(`
    UPDATE ge_cycle_streams
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
  const { value: _value, ...checkpointSummary } = checkpoint;
  const checkpointValueBlob = Buffer.from(canonicalSerialize(checkpoint.value), "utf8");
  const checkpointBlob = Buffer.from(canonicalSerialize(checkpoint), "utf8");
  const summaryBlob = Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", checkpointSummary),
  );
  connection.prepare(`
    INSERT INTO ge_cycle_checkpoints
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
    NOW,
  );
  connection.prepare(`
    INSERT INTO ge_cycle_checkpoint_revisions
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
    NOW,
  );
  connection.prepare(`
    INSERT INTO ge_cycle_leases
      (tenant_id, stream_id, active_lease_id, active_holder_id,
       active_lease_epoch, active_fencing_token, active_acquired_at_ms,
       active_expires_at_ms, last_lease_epoch, last_fencing_token, updated_at_ms)
    VALUES ('tenant-a', 'stream-a', 'lease-a', 'holder-a', 1, 1, ?, ?, 1, 1, ?)
  `, "inspect-schema").run(NOW, NOW + 1, NOW);
  connection.prepare(`
    INSERT INTO ge_cycle_used_lease_ids
      (tenant_id, stream_id, lease_id, lease_epoch, fencing_token, first_used_at_ms)
    VALUES ('tenant-a', 'stream-a', 'lease-a', 1, 1, ?)
  `, "inspect-schema").run(NOW);
  connection.prepare(`
    INSERT INTO ge_cycle_legal_holds
      (tenant_id, stream_id, hold_id, placed_at_ms)
    VALUES ('tenant-a', 'stream-a', 'hold-a', ?)
  `, "inspect-schema").run(NOW);
  connection.prepare(`
    INSERT INTO ge_cycle_used_migration_lock_ids
      (lock_id, lock_epoch, fencing_token, first_used_at_ms)
    VALUES ('lock-a', 1, 1, ?)
  `, "inspect-schema").run(NOW);

  const legacyResult = {
    archiveMode: "lossless-before-delete",
    compactionMode: "logical-history-preserving",
    legalHoldIds: ["hold-a"],
    retentionMode: "retain-authoritative-history",
  } as const;
  const resultBlob = Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("set-legal-hold", legacyResult),
  );
  connection.prepare(`
    INSERT INTO ge_cycle_operations
      (tenant_id, operation_id, operation_name, request_hash,
       result_blob, result_hash, committed_at_ms)
    VALUES ('tenant-a', 'operation-a', 'set-legal-hold', ?, ?, ?, ?)
  `, "inspect-schema").run(
    createHash("sha256").update("request-a").digest("hex"),
    resultBlob,
    canonicalHash(legacyResult),
    NOW,
  );
}

function insertLegacyOperation<K extends CycleStoreMutationOperation>(
  connection: SQLiteConnection,
  operationId: string,
  operation: K,
  result: CycleStoreLedgerResultByOperation[K],
  tenantId = "tenant-a",
): void {
  const resultBlob = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult(operation, result));
  connection.prepare(`INSERT INTO ge_cycle_operations
    (tenant_id, operation_id, operation_name, request_hash,
     result_blob, result_hash, committed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, "inspect-schema").run(
    tenantId,
    operationId,
    operation,
    createHash("sha256").update(`request:${operationId}`).digest("hex"),
    resultBlob,
    canonicalHash(result),
    NOW,
  );
}

function activatePristineMigrationLock(connection: SQLiteConnection): void {
  connection.prepare(`UPDATE ge_cycle_migration_lock SET
    active_lock_id = 'lock-a', active_owner_id = 'owner-a',
    active_source_version = 1, active_target_version = 2,
    active_lock_epoch = 1, active_fencing_token = 1,
    active_acquired_at_ms = ?, active_expires_at_ms = ?,
    last_lock_epoch = 1, last_fencing_token = 1, updated_at_ms = ?
    WHERE singleton = 1`, "inspect-schema").run(NOW, NOW + 1, NOW);
}

function seedAllLegacyOperationResults(connection: SQLiteConnection): void {
  seedEverySourceFamily(connection);
  const record = createCycleStoreRecord({
    previousRecordHash: null, recordId: "record-a", sequence: 0, value: 7,
  });
  const checkpoint = createCycleStoreCheckpoint({
    boundRecordHash: record.recordHash,
    boundSequence: 0,
    checkpointId: "checkpoint-a",
    checkpointScope: "scope-a",
    createdAt: "2026-07-28T00:00:00.123Z",
    streamId: "stream-a",
    value: 9,
  });
  const { value: _value, ...checkpointSummary } = checkpoint;
  const acquiredAt = new Date(NOW).toISOString();
  const expiresAt = new Date(NOW + 1).toISOString();
  const lease = {
    acquiredAt, expiresAt, fencingToken: 1, holderId: "holder-a",
    leaseEpoch: 1, leaseId: "lease-a",
  } as const;
  insertLegacyOperation(connection, "legacy-append", "append", {
    appendedRecords: 1,
    tail: { exists: true, sequence: 0, recordHash: record.recordHash },
  });
  insertLegacyOperation(connection, "legacy-checkpoint-save", "save-checkpoint", checkpointSummary);
  insertLegacyOperation(connection, "legacy-checkpoint-delete", "delete-checkpoint", { deleted: false });
  insertLegacyOperation(connection, "legacy-lease-acquire", "acquire-lease", lease);
  insertLegacyOperation(connection, "legacy-lease-renew", "renew-lease", lease);
  insertLegacyOperation(connection, "legacy-lease-release", "release-lease", {
    status: "released", lease: null, lastLeaseEpoch: 1, lastFencingToken: 1,
  });
  insertLegacyOperation(connection, "legacy-lock-acquire", "acquire-migration-lock", {
    acquiredAt, expiresAt, fencingToken: 1, lockEpoch: 1, lockId: "lock-a",
    ownerId: "owner-a", sourceSchemaVersion: 1, targetSchemaVersion: 2,
  });
  insertLegacyOperation(connection, "legacy-lock-release", "release-migration-lock", null);
  activatePristineMigrationLock(connection);
}

function seedHostileLegacyOperationResults(connection: SQLiteConnection): void {
  seedAllLegacyOperationResults(connection);
  const record = createCycleStoreRecord({
    previousRecordHash: null, recordId: "record-a", sequence: 0, value: 7,
  });
  const acquiredAt = new Date(NOW).toISOString();
  const expiresAt = new Date(NOW + 1_000).toISOString();
  insertLegacyOperation(connection, "hostile-append-missing", "append", {
    appendedRecords: 1,
    tail: { exists: true, sequence: 0, recordHash: "f".repeat(64) },
  });
  insertLegacyOperation(connection, "hostile-append-range", "append", {
    appendedRecords: 2,
    tail: { exists: true, sequence: 0, recordHash: record.recordHash },
  });
  insertLegacyOperation(connection, "hostile-checkpoint-save", "save-checkpoint", {
    boundRecordHash: record.recordHash, boundSequence: 0,
    checkpointId: "checkpoint-missing", checkpointScope: "scope-a",
    createdAt: "2026-07-28T00:00:00.123Z", streamId: "stream-a",
    valueBytes: 1, valueHash: "e".repeat(64),
  });
  insertLegacyOperation(connection, "hostile-checkpoint-delete", "delete-checkpoint", {
    deleted: true,
  });
  insertLegacyOperation(connection, "hostile-lease-acquire", "acquire-lease", {
    acquiredAt: new Date(NOW + 10).toISOString(), expiresAt,
    fencingToken: 2, holderId: "holder-missing-a", leaseEpoch: 2,
    leaseId: "lease-missing-a",
  });
  insertLegacyOperation(connection, "hostile-lease-renew", "renew-lease", {
    acquiredAt: new Date(NOW + 20).toISOString(), expiresAt,
    fencingToken: 3, holderId: "holder-missing-b", leaseEpoch: 3,
    leaseId: "lease-missing-b",
  });
  insertLegacyOperation(connection, "hostile-lease-release", "release-lease", {
    status: "released", lease: null, lastLeaseEpoch: 4, lastFencingToken: 4,
  });
  insertLegacyOperation(connection, "hostile-lock-acquire", "acquire-migration-lock", {
    acquiredAt: new Date(NOW + 30).toISOString(), expiresAt,
    fencingToken: 2, lockEpoch: 2, lockId: "lock-missing", ownerId: "owner-missing",
    sourceSchemaVersion: 1, targetSchemaVersion: 2,
  });
  connection.prepare(`UPDATE ge_cycle_migration_lock SET
    active_lock_id = 'lock-a', active_owner_id = 'owner-physical',
    active_source_version = 1, active_target_version = 2,
    active_lock_epoch = 1, active_fencing_token = 1,
    active_acquired_at_ms = ?, active_expires_at_ms = ?,
    last_lock_epoch = 1, last_fencing_token = 1, updated_at_ms = ?
    WHERE singleton = 1`, "inspect-schema").run(NOW, NOW + 1, NOW);
}

function seedMixed1024(connection: SQLiteConnection): void {
  const legacyResult = {
    archiveMode: "lossless-before-delete",
    compactionMode: "logical-history-preserving",
    legalHoldIds: ["hold"],
    retentionMode: "retain-authoritative-history",
  } as const;
  const resultBlob = Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("set-legal-hold", legacyResult),
  );
  const resultHash = canonicalHash(legacyResult);
  const insertStream = connection.prepare(`
    INSERT INTO ge_cycle_streams
      (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
    VALUES ('tenant-scale', ?, -1, NULL, ?, ?)
  `, "inspect-schema");
  const insertHold = connection.prepare(`
    INSERT INTO ge_cycle_legal_holds
      (tenant_id, stream_id, hold_id, placed_at_ms)
    VALUES ('tenant-scale', ?, ?, ?)
  `, "inspect-schema");
  const insertOperation = connection.prepare(`
    INSERT INTO ge_cycle_operations
      (tenant_id, operation_id, operation_name, request_hash,
       result_blob, result_hash, committed_at_ms)
    VALUES ('tenant-scale', ?, 'set-legal-hold', ?, ?, ?, ?)
  `, "inspect-schema");
  for (let index = 0; index < 341; index += 1) {
    const streamId = `stream-${index.toString().padStart(3, "0")}`;
    insertStream.run(streamId, NOW, NOW);
    if (index < 340) {
      const holdId = `hold-${index.toString().padStart(3, "0")}`;
      const operationId = `operation-${index.toString().padStart(3, "0")}`;
      insertHold.run(streamId, holdId, NOW);
      insertOperation.run(
        operationId,
        createHash("sha256").update(`request:${operationId}`).digest("hex"),
        resultBlob,
        resultHash,
        NOW,
      );
    }
  }
}

interface Started {
  readonly connection: SQLiteConnection;
  readonly source: SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  readonly stage: SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
}

function started(seed = false): Started {
  const connection = opened();
  if (seed) seedEverySourceFamily(connection);
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  const stage = createSQLiteBaselineTempStage(
    connection,
    proveSQLiteExclusiveBaselineTransaction(connection),
  ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
  const source = captureSQLiteV1BaselineSourceSummary(
    connection,
    NOW,
  ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  return { connection, source, stage };
}

function startedWithCallerProbe(): Started {
  const connection = opened();
  connection.execTrusted("CREATE TABLE caller_probe(value INTEGER)", "inspect-schema");
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  const stage = createSQLiteBaselineTempStage(
    connection,
    proveSQLiteExclusiveBaselineTransaction(connection),
  ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
  const source = captureSQLiteV1BaselineSourceSummary(
    connection,
    NOW,
  ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  return { connection, source, stage };
}

function close(start: Started): void {
  try {
    start.stage.dispose();
  } finally {
    if (start.connection.isTransaction) {
      start.connection.execTrusted("ROLLBACK", "inspect-schema");
    }
    start.connection.close();
  }
}

function materializedTempIdentity(run: Started) {
  const entries = run.connection.prepare(
    `SELECT entry_kind, key_blob, state_blob
       FROM temp.ge_blr_stage
      ORDER BY kind_rank ASC, key_blob ASC`,
    "inspect-schema",
  ).all().map((raw) => {
    const row = raw as unknown as readonly [string, Uint8Array, Uint8Array];
    return {
      entryKind: row[0] as OperationBaselineEntryInput["entryKind"],
      key: decodeOperationBaselineCanonicalBytes(row[1], MAX_BASELINE_KEY_BYTES),
      state: decodeOperationBaselineCanonicalBytes(row[2], MAX_BASELINE_STATE_BYTES),
    };
  });
  return buildOperationBaseline(
    createOperationBaselineId(run.source.sourceEnvelope),
    entries,
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("SQLite v1 cooperative source/stage reconciliation", () => {
  it("streams one real row from every source family with exactly two TEMP writes each", () => {
    const run = started(true);
    try {
      expect(Object.values(run.source.countsByKind)).toEqual(Array.from({ length: 12 }, () => 1));
      const before = totalChanges(run.connection);
      const report = stageSQLiteV1BaselineSourceIntoTempStage(
        run.connection,
        run.source,
        run.stage,
      );
      expect(report).toMatchObject({
        entriesStaged: 12,
        exactTempWriteCount: 24,
        expectedEntryCount: 12,
      });
      expect(totalChanges(run.connection) - before).toBe(24);
      expect(run.stage.state).toBe("open");
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.ge_blr_stage",
        "inspect-schema",
      ).get()).toEqual([12n]);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.ge_blr_relation_keys",
        "inspect-schema",
      ).get()).toEqual([12n]);
    } finally {
      close(run);
    }
  });

  it("streams 1,024 mixed real rows without a barrier or entry materialization", () => {
    const connection = opened();
    seedMixed1024(connection);
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const stage = createSQLiteBaselineTempStage(
      connection,
      proveSQLiteExclusiveBaselineTransaction(connection),
    );
    const source = captureSQLiteV1BaselineSourceSummary(connection, NOW);
    try {
      expect(source.expectedEntryCount).toBe(1_024);
      const before = totalChanges(connection);
      const report = stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
      expect(report.entriesStaged).toBe(1_024);
      expect(report.exactTempWriteCount).toBe(2_048);
      expect(totalChanges(connection) - before).toBe(2_048);
    } finally {
      stage.dispose();
      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("poisons both sides when caller DML appears after the pair but before receipt consumption", () => {
    const connection = opened();
    connection.execTrusted("CREATE TABLE caller_probe(value INTEGER)", "inspect-schema");
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const stage = createSQLiteBaselineTempStage(
      connection,
      proveSQLiteExclusiveBaselineTransaction(connection),
    ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
    const source = captureSQLiteV1BaselineSourceSummary(
      connection,
      NOW,
    ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
    try {
      const iterator = source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](connection, stage);
      const first = iterator.next();
      expect(first.done).toBe(false);
      const receipt = stage[SQLITE_BASELINE_OWNED_WRITE](connection, first.value!, 0);
      connection.prepare(
        "INSERT INTO caller_probe(value) VALUES (1)",
        "inspect-schema",
      ).run();
      expect(() => iterator.next(receipt)).toThrow(CycleStoreProviderError);
      expect(stage.state).toBe("poisoned");
      stage.dispose();
    } finally {
      if (connection.isTransaction) {
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      connection.close();
    }
  });

  it("burns forged and replayed receipts and never advances to another source row", () => {
    for (const attack of ["forged", "replay"] as const) {
      const run = started();
      try {
        const iterator = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
          run.connection,
          run.stage,
        );
        const first = iterator.next();
        const receipt = run.stage[SQLITE_BASELINE_OWNED_WRITE](
          run.connection,
          first.value!,
          0,
        );
        if (attack === "forged") {
          const forged = Object.freeze({
            kind: "sqlite-baseline-owned-write-receipt",
          }) as SQLiteBaselineOwnedWriteReceipt;
          expect(() => iterator.next(forged)).toThrow(/receipt binding/u);
        } else {
          const second = iterator.next(receipt);
          expect(second.done).toBe(false);
          expect(() => iterator.next(receipt)).toThrow(/receipt binding/u);
        }
        expect(run.stage.state).toBe("poisoned");
      } finally {
        close(run);
      }
    }
  });

  it("rejects a receipt issued by another stage and poisons both abandoned streams", () => {
    const left = started();
    const right = started();
    try {
      const leftIterator = left.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
        left.connection,
        left.stage,
      );
      const rightIterator = right.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
        right.connection,
        right.stage,
      );
      const leftEntry = leftIterator.next().value!;
      const rightEntry = rightIterator.next().value!;
      left.stage[SQLITE_BASELINE_OWNED_WRITE](left.connection, leftEntry, 0);
      const wrongReceipt = right.stage[SQLITE_BASELINE_OWNED_WRITE](
        right.connection,
        rightEntry,
        0,
      );
      expect(() => leftIterator.next(wrongReceipt)).toThrow(/receipt binding/u);
      expect(() => rightIterator.return()).toThrow(/receipt was skipped/u);
      expect(left.stage.state).toBe("poisoned");
      expect(right.stage.state).toBe("poisoned");
    } finally {
      close(left);
      close(right);
    }
  });

  it("refuses to mix a prior standalone write into the cooperative lane", () => {
    const connection = opened();
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const stage = createSQLiteBaselineTempStage(
      connection,
      proveSQLiteExclusiveBaselineTransaction(connection),
    );
    stage.insertCommon(
      "stream-head",
      encodeOperationBaselineKey("stream-head", {
        streamId: "standalone-stream",
        tenantId: "standalone-tenant",
      }),
      encodeOperationBaselineState("stream-head", {
        createdAtMs: NOW,
        streamId: "standalone-stream",
        tailRecordHash: null,
        tailSequence: -1,
        tenantId: "standalone-tenant",
        updatedAtMs: NOW,
      }),
    );
    const source = captureSQLiteV1BaselineSourceSummary(connection, NOW);
    try {
      expect(() => stageSQLiteV1BaselineSourceIntoTempStage(
        connection,
        source,
        stage,
      )).toThrow(/cannot be mixed/u);
      expect(stage.state).toBe("poisoned");
    } finally {
      stage.dispose();
      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("invalidates rollback/rebegin even when a real receipt is outstanding", () => {
    const run = started();
    try {
      const iterator = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
        run.connection,
        run.stage,
      );
      const first = iterator.next();
      const receipt = run.stage[SQLITE_BASELINE_OWNED_WRITE](
        run.connection,
        first.value!,
        0,
      );
      run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => iterator.next(receipt)).toThrow(/transaction changed/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      if (run.connection.isTransaction) {
        run.connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      run.connection.close();
    }
  });

  it("finalizes and poisons an early-abandoned source with no receipt", () => {
    const run = started();
    try {
      const iterator = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
        run.connection,
        run.stage,
      );
      expect(iterator.next().done).toBe(false);
      expect(() => iterator.return()).toThrow(/receipt was skipped/u);
      expect(run.stage.state).toBe("poisoned");
      // A fresh statement on the same connection proves the active source
      // statement was synchronously finalized rather than left half-open.
      expect(run.connection.prepare("SELECT 1", "inspect-schema").get()).toEqual([1n]);
    } finally {
      close(run);
    }
  });

  it("rejects skipped receipts and wrong sequence, count, or epoch claims", () => {
    for (const attack of ["skipped", "sequence", "before", "after", "epoch"] as const) {
      const run = started();
      try {
        const iterator = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
          run.connection,
          run.stage,
        );
        const entry = iterator.next().value!;
        if (attack === "sequence") {
          expect(() => run.stage[SQLITE_BASELINE_OWNED_WRITE](
            run.connection,
            entry,
            1,
          )).toThrow(/sequence|order/u);
        } else {
          const before = totalChanges(run.connection);
          const receipt = run.stage[SQLITE_BASELINE_OWNED_WRITE](
            run.connection,
            entry,
            0,
          );
          const after = totalChanges(run.connection);
          if (attack === "skipped") {
            expect(() => iterator.next(undefined)).toThrow(/receipt binding/u);
          } else {
            expect(() => run.stage[SQLITE_BASELINE_CONSUME_OWNED_WRITE](
              run.connection,
              entry,
              receipt,
              0,
              attack === "before" ? before + 1 : before,
              attack === "after" ? after + 1 : after,
              attack === "epoch" ? run.connection.transactionEpoch + 1n : run.connection.transactionEpoch,
            )).toThrow(/receipt binding/u);
          }
        }
        expect(run.stage.state).toBe("poisoned");
      } finally {
        close(run);
      }
    }
  });

  it("rejects summary-before-stage and owner-control changes before consumption", () => {
    for (const attack of [
      "wrong-order", "savepoint", "prepared-ddl", "trusted-ddl",
    ] as const) {
      const connection = opened();
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      if (attack === "wrong-order") {
        const source = captureSQLiteV1BaselineSourceSummary(connection, NOW) as
          SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
        const stage = createSQLiteBaselineTempStage(
          connection,
          proveSQLiteExclusiveBaselineTransaction(connection),
        ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
        try {
          const iterator = source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](connection, stage);
          expect(() => iterator.next()).toThrow(/stream failed|captured transaction changed/u);
          expect(stage.state).toBe("poisoned");
        } finally {
          stage.dispose();
        }
      } else {
        const stage = createSQLiteBaselineTempStage(
          connection,
          proveSQLiteExclusiveBaselineTransaction(connection),
        ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
        const source = captureSQLiteV1BaselineSourceSummary(connection, NOW) as
          SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
        try {
          const iterator = source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](connection, stage);
          const entry = iterator.next().value!;
          const receipt = stage[SQLITE_BASELINE_OWNED_WRITE](connection, entry, 0);
          if (attack === "savepoint") {
            connection.execTrusted("SAVEPOINT hostile", "inspect-schema");
          } else if (attack === "prepared-ddl") {
            connection.prepare(
              "CREATE TEMP TABLE hostile_epoch(value INTEGER)",
              "inspect-schema",
            ).run();
          } else {
            connection.execTrusted(
              "CREATE TEMP TABLE hostile_trusted_epoch(value INTEGER)",
              "inspect-schema",
            );
          }
          expect(() => iterator.next(receipt)).toThrow(/transaction changed/u);
          expect(stage.state).toBe("poisoned");
        } finally {
          stage.dispose();
        }
      }
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it.each(["before-common", "between-common-relation"] as const)(
    "rejects caller DML at the %s boundary",
    (boundary) => {
      const run = startedWithCallerProbe();
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let injected = false;
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation((sql, operation) => {
        const target = boundary === "before-common"
          ? sql.includes("INSERT INTO temp.ge_blr_stage")
          : sql.includes("INSERT INTO temp.ge_blr_schema");
        if (!injected && target) {
          injected = true;
          originalPrepare(
            "INSERT INTO caller_probe(value) VALUES (1)",
            "inspect-schema",
          ).run();
        }
        return originalPrepare(sql, operation);
      });
      try {
        expect(() => stageSQLiteV1BaselineSourceIntoTempStage(
          run.connection,
          run.source,
          run.stage,
        )).toThrow(boundary === "before-common"
          ? /common-stage write count is invalid/u
          : /relation write count is invalid/u);
        expect(injected).toBe(true);
        expect(run.stage.state).toBe("poisoned");
        if (boundary === "between-common-relation") {
          expect(run.connection.prepare(
            "SELECT count(*) FROM temp.ge_blr_stage",
            "inspect-schema",
          ).get()).toEqual([1n]);
        }
      } finally {
        prepare.mockRestore();
        close(run);
      }
    },
  );

  it("rejects caller DML injected during receipt validation", () => {
    const run = startedWithCallerProbe();
    try {
      const iterator = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
        run.connection,
        run.stage,
      );
      const entry = iterator.next().value!;
      const receipt = run.stage[SQLITE_BASELINE_OWNED_WRITE](
        run.connection,
        entry,
        0,
      );
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let counterReads = 0;
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation((sql, operation) => {
        if (sql === "SELECT total_changes()") {
          counterReads += 1;
          if (counterReads === 3) {
            originalPrepare(
              "INSERT INTO caller_probe(value) VALUES (1)",
              "inspect-schema",
            ).run();
          }
        }
        return originalPrepare(sql, operation);
      });
      try {
        expect(() => iterator.next(receipt)).toThrow(/unexplained write/u);
      } finally {
        prepare.mockRestore();
      }
      expect(counterReads).toBeGreaterThanOrEqual(3);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("rejects caller DML between accepted source fetches", () => {
    const run = startedWithCallerProbe();
    try {
      const iterator = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
        run.connection,
        run.stage,
      );
      const first = iterator.next().value!;
      const receipt = run.stage[SQLITE_BASELINE_OWNED_WRITE](
        run.connection,
        first,
        0,
      );
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let injected = false;
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation((sql, operation) => {
        if (!injected && sql.includes("FROM ge_cycle_migrations")) {
          injected = true;
          originalPrepare(
            "INSERT INTO caller_probe(value) VALUES (1)",
            "inspect-schema",
          ).run();
        }
        return originalPrepare(sql, operation);
      });
      let second: IteratorResult<OperationBaselineEntryInput, void>;
      try {
        second = iterator.next(receipt);
      } finally {
        prepare.mockRestore();
      }
      expect(injected).toBe(true);
      expect(second.done).toBe(false);
      expect(() => run.stage[SQLITE_BASELINE_OWNED_WRITE](
        run.connection,
        second.value!,
        1,
      )).toThrow(/unexplained write/u);
      expect(run.stage.state).toBe("poisoned");
      try {
        iterator.return();
      } catch {
        // The exact writer error above remains authoritative.
      }
    } finally {
      close(run);
    }
  });

  it("retains exact +1 common evidence and the primary relation failure", () => {
    const run = started();
    const before = totalChanges(run.connection);
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation((sql, operation) => {
      if (sql.includes("INSERT INTO temp.ge_blr_schema")) {
        throw new Error("hostile relation preparation failure");
      }
      return originalPrepare(sql, operation);
    });
    try {
      expect(() => stageSQLiteV1BaselineSourceIntoTempStage(
        run.connection,
        run.source,
        run.stage,
      )).toThrowError("SQLite baseline relation insert failed");
      expect(totalChanges(run.connection) - before).toBe(1);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.ge_blr_stage",
        "inspect-schema",
      ).get()).toEqual([1n]);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.ge_blr_schema",
        "inspect-schema",
      ).get()).toEqual([0n]);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("rejects a legacy carrier mutation after yield and before preprojection", () => {
    const run = started(true);
    try {
      const iterator = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
        run.connection,
        run.stage,
      );
      let sequence = 0;
      let next = iterator.next();
      while (!next.done && next.value.entryKind !== "legacy-operation") {
        const receipt = run.stage[SQLITE_BASELINE_OWNED_WRITE](
          run.connection,
          next.value,
          sequence,
        );
        sequence += 1;
        next = iterator.next(receipt);
      }
      expect(next.done).toBe(false);
      expect(next.value!.entryKind).toBe("legacy-operation");
      run.connection.prepare(
        "UPDATE ge_cycle_operations SET result_blob = ? WHERE operation_id = 'operation-a'",
        "inspect-schema",
      ).run(Buffer.from("{}", "utf8"));
      expect(() => run.stage[SQLITE_BASELINE_OWNED_WRITE](
        run.connection,
        next.value!,
        sequence,
      )).toThrow(/unexplained write/u);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.ge_blr_stage WHERE entry_kind = 'legacy-operation'",
        "inspect-schema",
      ).get()).toEqual([0n]);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.ge_blr_legacy_operations",
        "inspect-schema",
      ).get()).toEqual([0n]);
      expect(run.stage.state).toBe("poisoned");
      try {
        iterator.return();
      } catch {
        // Expected early-close poison after the authoritative writer failure.
      }
    } finally {
      close(run);
    }
  });

  it("never lets iterator cleanup failure mask the primary writer error", () => {
    const run = started();
    const open = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES].bind(run.source);
    const wrappedSource: SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource = {
      ...run.source,
      [SQLITE_BASELINE_COOPERATIVE_ENTRIES]: (
        connection: SQLiteConnection,
        stage: SQLiteBaselineCooperativeStage,
      ): Generator<
        OperationBaselineEntryInput,
        void,
        SQLiteBaselineOwnedWriteReceipt | undefined
      > => {
        const inner = open(connection, stage);
        return new Proxy(inner, {
          get(iterator, iteratorProperty) {
            if (iteratorProperty === "return") {
              return (): IteratorResult<OperationBaselineEntryInput, void> => {
                try {
                  iterator.return?.();
                } finally {
                  throw new Error("hostile cleanup failure");
                }
              };
            }
            const value = Reflect.get(iterator, iteratorProperty, iterator) as unknown;
            return typeof value === "function" ? value.bind(iterator) as unknown : value;
          },
        });
      },
    };
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation((sql, operation) => {
      if (sql.includes("INSERT INTO temp.ge_blr_schema")) {
        throw new Error("hostile primary relation failure");
      }
      return originalPrepare(sql, operation);
    });
    try {
      expect(() => stageSQLiteV1BaselineSourceIntoTempStage(
        run.connection,
        wrappedSource,
        run.stage,
      )).toThrowError("SQLite baseline relation insert failed");
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("hands off all twelve kinds in exact TEMP order with materializer-identical identity", () => {
    const run = started(true);
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
      const expected = materializedTempIdentity(run);
      const identity = readSQLiteV1BaselineOrderedTempProjection(
        run.connection,
        run.source,
        run.stage,
      );
      expect(identity).toEqual({
        baselineId: expected.baselineId,
        entryCount: expected.entryCount,
        finalEntryHash: expected.finalEntryHash,
        firstEntryHash: expected.firstEntryHash,
        legacyOperationCount: expected.legacyOperationCount,
        projectionSha256: expected.projectionSha256,
      });
      expect(identity.entryCount).toBe(12);
      expect(Object.isFrozen(identity)).toBe(true);
      expect(() => readSQLiteV1BaselineOrderedTempProjection(
        run.connection,
        run.source,
        run.stage,
      )).toThrow(/one-shot|binding|session/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("matches the frozen cross-runtime pristine three-entry projection golden", () => {
    const connection = opened(1_000);
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const stage = createSQLiteBaselineTempStage(
      connection,
      proveSQLiteExclusiveBaselineTransaction(connection),
    );
    const source = captureSQLiteV1BaselineSourceSummary(connection, 1_000);
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
      expect(readSQLiteV1BaselineOrderedTempProjection(connection, source, stage)).toEqual({
        baselineId: "v2-57ddf5826fc8d0a7b30a8dbcc961a66953e1604d73e2e43b8e4d229c0b9f3612",
        entryCount: 3,
        finalEntryHash: "1ad91f22d750f258b129d5dbd9e6deef8f04368b95e3497a5a9a268319f62e06",
        firstEntryHash: "bfb3045f4b4e17ed490877a6030fc4b0151fbbb892290e476369040d065d5928",
        legacyOperationCount: 0,
        projectionSha256: "7d9dc721b57bfd9272887e8f2b991c53d344e12921b2aaddef88b978ac0de245",
      });
    } finally {
      stage.dispose();
      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("hands off 1,024 mixed rows with the exact constant-memory projection identity", () => {
    const connection = opened();
    seedMixed1024(connection);
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const stage = createSQLiteBaselineTempStage(
      connection,
      proveSQLiteExclusiveBaselineTransaction(connection),
    ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
    const source = captureSQLiteV1BaselineSourceSummary(
      connection,
      NOW,
    ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
    const run = { connection, source, stage };
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
      const expected = materializedTempIdentity(run);
      const identity = readSQLiteV1BaselineOrderedTempProjection(connection, source, stage);
      expect(identity).toMatchObject({
        baselineId: expected.baselineId,
        entryCount: 1_024,
        finalEntryHash: expected.finalEntryHash,
        firstEntryHash: expected.firstEntryHash,
        legacyOperationCount: 340,
        projectionSha256: expected.projectionSha256,
      });
    } finally {
      close(run);
    }
  });

  it("poisons an ordered reader abandoned before its one allowed read", () => {
    const run = started();
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
      const reader = new SQLiteV1BaselineOrderedTempReader(
        run.connection,
        run.source,
        run.stage,
      );
      expect(() => reader.dispose()).toThrow(/was abandoned/u);
      expect(reader.state).toBe("poisoned");
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it.each(["missing", "extra", "replaced", "catalog", "savepoint", "rollback"] as const)(
    "rejects %s state before ordered handoff",
    (attack) => {
      const run = started();
      try {
        stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
        if (attack === "missing") {
          run.connection.prepare(
            "DELETE FROM temp.ge_blr_stage WHERE entry_kind = 'schema-envelope'",
            "inspect-schema",
          ).run();
        } else if (attack === "extra") {
          run.connection.prepare(
            `INSERT INTO temp.ge_blr_stage(kind_rank, entry_kind, key_blob, state_blob)
             SELECT kind_rank, entry_kind, CAST(key_blob || x'00' AS BLOB), state_blob
               FROM temp.ge_blr_stage WHERE entry_kind = 'schema-envelope'`,
            "inspect-schema",
          ).run();
        } else if (attack === "replaced") {
          run.connection.prepare(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE entry_kind = 'schema-envelope'",
            "inspect-schema",
          ).run();
        } else if (attack === "catalog") {
          run.connection.execTrusted("CREATE TEMP TABLE ge_blr_hostile(value INTEGER)", "inspect-schema");
        } else if (attack === "savepoint") {
          run.connection.execTrusted("SAVEPOINT hostile_handoff", "inspect-schema");
        } else {
          run.connection.execTrusted("ROLLBACK", "inspect-schema");
          run.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
        }
        expect(() => readSQLiteV1BaselineOrderedTempProjection(
          run.connection,
          run.source,
          run.stage,
        )).toThrow();
        expect(run.stage.state).toBe("poisoned");
      } finally {
        close(run);
      }
    },
  );

  it.each([
    ["pre-query", 1],
    ["pre-fetch", 3],
    ["post-fetch", 4],
    ["post-append", 5],
    ["terminal-counts", 15],
    ["post-root", 16],
    ["complete", 17],
  ] as const)(
    "rejects DML at ordered handoff %s boundary",
    (_boundary, targetFence) => {
      const run = startedWithCallerProbe();
      try {
        stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
        const originalFence = run.stage[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF]
          .bind(run.stage);
        let fences = 0;
        const fence = vi.spyOn(
          run.stage,
          SQLITE_BASELINE_FENCE_ORDERED_HANDOFF,
        ).mockImplementation((session) => {
          fences += 1;
          if (fences === targetFence) {
            run.connection.prepare(
              "INSERT INTO caller_probe(value) VALUES (1)",
              "inspect-schema",
            ).run();
          }
          return originalFence(session);
        });
        try {
          expect(() => readSQLiteV1BaselineOrderedTempProjection(
            run.connection,
            run.source,
            run.stage,
          )).toThrow(/unexplained write|binding/u);
        } finally {
          fence.mockRestore();
        }
        expect(run.stage.state).toBe("poisoned");
      } finally {
        close(run);
      }
    },
  );

  it.each(["missing", "extra", "reordered", "rank-kind", "noncanonical"] as const)(
    "rejects a counter-preserving mocked %s ordered row stream",
    (attack) => {
      const run = started();
      try {
        stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
        const sql = `SELECT kind_rank, entry_kind, key_blob, state_blob
           FROM temp.ge_blr_stage
          ORDER BY kind_rank ASC, key_blob ASC`;
        const originalPrepare = run.connection.prepare.bind(run.connection);
        const rows = originalPrepare(sql, "inspect-schema").all().map((raw) => [
          ...(raw as unknown as readonly unknown[]),
        ]);
        const reader = new SQLiteV1BaselineOrderedTempReader(
          run.connection,
          run.source,
          run.stage,
        );
        let hostile = rows.map((row) => [...row]);
        if (attack === "missing") {
          hostile = hostile.slice(0, -1);
        } else if (attack === "extra") {
          hostile.push([...hostile[0]!]);
        } else if (attack === "reordered") {
          [hostile[0], hostile[1]] = [hostile[1]!, hostile[0]!];
        } else if (attack === "rank-kind") {
          hostile[0]![0] = 1n;
        } else {
          hostile[0]![3] = Buffer.from("{}", "utf8");
        }
        const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
          (statementSql, operation) => statementSql === sql
            ? ({ iterate: () => hostile } as unknown as ReturnType<SQLiteConnection["prototype"]["prepare"]>)
            : originalPrepare(statementSql, operation),
        );
        try {
          expect(() => reader.read()).toThrow(/ordered handoff/u);
        } finally {
          prepare.mockRestore();
        }
        expect(reader.state).toBe("poisoned");
        expect(run.stage.state).toBe("poisoned");
      } finally {
        close(run);
      }
    },
  );

  it("rejects a wrong summary/stage pair and a wrong connection", () => {
    const left = started();
    const right = started();
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(left.connection, left.source, left.stage);
      stageSQLiteV1BaselineSourceIntoTempStage(right.connection, right.source, right.stage);
      expect(() => new SQLiteV1BaselineOrderedTempReader(
        left.connection,
        left.source,
        right.stage,
      )).toThrow(/source binding/u);
      expect(right.stage.state).toBe("poisoned");
      expect(() => new SQLiteV1BaselineOrderedTempReader(
        right.connection,
        left.source,
        left.stage,
      )).toThrow(/source binding/u);
      expect(left.stage.state).toBe("poisoned");
    } finally {
      close(left);
      close(right);
    }
  });

  it("stage disposal terminalizes an active ordered reader before catalog drop", () => {
    const run = started();
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
      const reader = new SQLiteV1BaselineOrderedTempReader(
        run.connection,
        run.source,
        run.stage,
      );
      run.stage.dispose();
      expect(reader.state).toBe("poisoned");
      expect(run.stage.state).toBe("disposed");
      expect(() => reader.read()).toThrow();
    } finally {
      if (run.connection.isTransaction) {
        run.connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      run.connection.close();
    }
  });

  it("private ordered BEGIN rejects a gap before cooperative finish", () => {
    const run = started();
    try {
      const iterator = run.source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](
        run.connection,
        run.stage,
      );
      const first = iterator.next().value!;
      const receipt = run.stage[SQLITE_BASELINE_OWNED_WRITE](
        run.connection,
        first,
        0,
      );
      expect(iterator.next(receipt).done).toBe(false);
      expect(() => run.stage[SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF](
        run.connection,
        1,
        totalChanges(run.connection),
        run.connection.transactionEpoch,
      )).toThrow(/binding is invalid/u);
      expect(run.stage.state).toBe("poisoned");
      try {
        iterator.return();
      } catch {
        // The explicit incomplete-finish rejection remains authoritative.
      }
    } finally {
      close(run);
    }
  });

  it("finalizes the active row iterator when stage disposal occurs during fetch", () => {
    const run = started();
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
      const sql = `SELECT kind_rank, entry_kind, key_blob, state_blob
           FROM temp.ge_blr_stage
          ORDER BY kind_rank ASC, key_blob ASC`;
      const originalPrepare = run.connection.prepare.bind(run.connection);
      const row = originalPrepare(sql, "inspect-schema").get();
      const reader = new SQLiteV1BaselineOrderedTempReader(
        run.connection,
        run.source,
        run.stage,
      );
      let closed = 0;
      let fetched = false;
      const hostileIterator: Iterator<unknown> & Iterable<unknown> = {
        [Symbol.iterator]() { return this; },
        next: () => {
          if (fetched) return { done: true, value: undefined };
          fetched = true;
          run.stage.dispose();
          return { done: false, value: row };
        },
        return: () => {
          closed += 1;
          return { done: true, value: undefined };
        },
      };
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (statementSql, operation) => statementSql === sql
          ? ({ iterate: () => hostileIterator } as unknown as ReturnType<SQLiteConnection["prototype"]["prepare"]>)
          : originalPrepare(statementSql, operation),
      );
      try {
        expect(() => reader.read()).toThrow();
      } finally {
        prepare.mockRestore();
      }
      expect(closed).toBe(1);
      expect(reader.state).toBe("poisoned");
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.sqlite_schema WHERE name LIKE 'ge_blr_%'",
        "inspect-schema",
      ).get()).toEqual([0n]);
    } finally {
      if (run.connection.isTransaction) {
        run.connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      run.connection.close();
    }
  });

  it("active iterator cleanup failure cannot mask the ordered read failure", () => {
    const run = started();
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
      const sql = `SELECT kind_rank, entry_kind, key_blob, state_blob
           FROM temp.ge_blr_stage
          ORDER BY kind_rank ASC, key_blob ASC`;
      const originalPrepare = run.connection.prepare.bind(run.connection);
      const reader = new SQLiteV1BaselineOrderedTempReader(
        run.connection,
        run.source,
        run.stage,
      );
      let returns = 0;
      const hostileIterator: Iterator<unknown> & Iterable<unknown> = {
        [Symbol.iterator]() { return this; },
        next: () => { throw new Error("authoritative ordered fetch failure"); },
        return: () => {
          returns += 1;
          throw new Error("secondary ordered cleanup failure");
        },
      };
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (statementSql, operation) => statementSql === sql
          ? ({ iterate: () => hostileIterator } as unknown as ReturnType<SQLiteConnection["prototype"]["prepare"]>)
          : originalPrepare(statementSql, operation),
      );
      try {
        expect(() => reader.read()).toThrowError("SQLite baseline ordered handoff failed");
      } finally {
        prepare.mockRestore();
      }
      expect(returns).toBe(1);
      expect(reader.state).toBe("poisoned");
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });
});

interface Sealed extends Started {
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
}

function sealed(seed = true): Sealed {
  const run = started(seed);
  stageSQLiteV1BaselineSourceIntoTempStage(run.connection, run.source, run.stage);
  const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
    run.connection,
    run.source,
    run.stage,
  );
  return { ...run, projectionIdentity };
}

function insertInvariantStream(
  connection: SQLiteConnection,
  tenantId: string,
  streamId: string,
  tailSequence: number,
  tailRecordHash: string | null,
  observedAtMs = NOW,
): void {
  connection.prepare(`INSERT INTO ge_cycle_streams
    (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)`, "inspect-schema").run(
    tenantId, streamId, tailSequence, tailRecordHash, observedAtMs, observedAtMs,
  );
}

function insertInvariantRecord(
  connection: SQLiteConnection,
  tenantId: string,
  streamId: string,
  recordId: string,
  sequence: number,
  previousRecordHash: string | null,
  committedAtMs = NOW,
): string {
  const record = createCycleStoreRecord({
    previousRecordHash,
    recordId,
    sequence,
    value: `${tenantId}:${streamId}:${sequence}`,
  });
  const valueBlob = Buffer.from(canonicalSerialize(record.value), "utf8");
  const recordBlob = Buffer.from(canonicalSerialize(record), "utf8");
  connection.prepare(`INSERT INTO ge_cycle_records
    (tenant_id, stream_id, sequence, record_id, previous_record_hash,
     value_hash, value_bytes, value_blob, record_hash, record_blob, committed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "inspect-schema").run(
    tenantId, streamId, sequence, recordId, previousRecordHash,
    record.valueHash, record.valueBytes, valueBlob, record.recordHash, recordBlob, committedAtMs,
  );
  return record.recordHash;
}

function sealedHostileStreamRecordFixture(): Sealed {
  const sharedNow = NOW;
  const connection = opened(sharedNow);
  connection.execTrusted("PRAGMA foreign_keys = OFF", "inspect-schema");
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  const addStream = (
    tenantId: string,
    streamId: string,
    tailSequence: number,
    tailRecordHash: string | null,
  ) => insertInvariantStream(
    connection, tenantId, streamId, tailSequence, tailRecordHash, sharedNow,
  );
  const addRecord = (
    tenantId: string,
    streamId: string,
    recordId: string,
    sequence: number,
    previousRecordHash: string | null,
  ) => insertInvariantRecord(
    connection, tenantId, streamId, recordId, sequence, previousRecordHash, sharedNow,
  );

  addStream("tenant-foreign", "stream-orphan", -1, null);
  addRecord("tenant-orphan", "stream-orphan", "orphan-0", 0, null);
  addStream("tenant-empty", "stream-empty", -1, null);

  const missingPredecessor = "a".repeat(64);
  const gapTail = addRecord(
    "tenant-gap", "stream-gap", "gap-1", 1, missingPredecessor,
  );
  addStream("tenant-gap", "stream-gap", 1, gapTail);

  const interiorZero = addRecord(
    "tenant-interior", "stream-interior", "interior-0", 0, null,
  );
  const interiorTwo = addRecord(
    "tenant-interior", "stream-interior", "interior-2", 2, interiorZero,
  );
  addStream("tenant-interior", "stream-interior", 2, interiorTwo);

  const predecessorZero = addRecord(
    "tenant-pred", "stream-pred", "pred-0", 0, null,
  );
  const wrongPredecessor = "b".repeat(64);
  const predecessorOne = addRecord(
    "tenant-pred", "stream-pred", "pred-1", 1, wrongPredecessor,
  );
  addStream("tenant-pred", "stream-pred", 1, predecessorOne);
  expect(predecessorZero).not.toBe(wrongPredecessor);

  const staleZero = addRecord(
    "tenant-tail", "stream-tail", "tail-0", 0, null,
  );
  addRecord(
    "tenant-tail", "stream-tail", "tail-1", 1, staleZero,
  );
  addStream("tenant-tail", "stream-tail", 0, staleZero);

  addRecord(
    "tenant-missing-tail", "stream-missing-tail", "missing-tail-0", 0, null,
  );
  addStream(
    "tenant-missing-tail", "stream-missing-tail", 1, "c".repeat(64),
  );
  addRecord(
    "tenant-wrong-tail", "stream-wrong-tail", "wrong-tail-0", 0, null,
  );
  addStream(
    "tenant-wrong-tail", "stream-wrong-tail", 0, "d".repeat(64),
  );

  const stage = createSQLiteBaselineTempStage(
    connection,
    proveSQLiteExclusiveBaselineTransaction(connection),
  ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
  const source = captureSQLiteV1BaselineSourceSummary(
    connection,
    sharedNow,
  ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
  const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
    connection, source, stage,
  );
  return { connection, source, stage, projectionIdentity };
}

describe("SQLite stream/record invariant campaign", () => {
  it("reports the exact ordered real-source missing/empty/gap/predecessor/stale-tail campaign", () => {
    const run = sealedHostileStreamRecordFixture();
    try {
      expect(run.projectionIdentity).toEqual({
        baselineId: "v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af",
        entryCount: 21,
        legacyOperationCount: 0,
        firstEntryHash: "f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c",
        finalEntryHash: "f1210fc05e988ad147f859d3eda8eab51e3a1006ef6f4414f66b338bc1ddcd5e",
        projectionSha256: "8ad7385488da4cba4475e4037671384962cd2d9d24cecd82d08962af0031a6b8",
      });
      expect(runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([
        { ruleId: "BLR_RECORD_STREAM_MISSING", violationCount: 1, diagnosticsTruncated: false },
        { ruleId: "BLR_STREAM_EMPTY", violationCount: 2, diagnosticsTruncated: false },
        { ruleId: "BLR_RECORD_GAP", violationCount: 2, diagnosticsTruncated: false },
        { ruleId: "BLR_RECORD_PREDECESSOR", violationCount: 1, diagnosticsTruncated: false },
        { ruleId: "BLR_STREAM_TAIL", violationCount: 3, diagnosticsTruncated: false },
      ]);
    } finally {
      close(run);
    }
  });
  it("returns one deeply frozen safe empty report bound to the exact projection identity", () => {
    const run = sealed();
    try {
      const report = runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      );
      expect(report).toEqual({ projectionIdentity: run.projectionIdentity, diagnostics: [] });
      expect(report.projectionIdentity).toBe(run.projectionIdentity);
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.diagnostics)).toBe(true);
      expect(Object.keys(report)).toEqual(["projectionIdentity", "diagnostics"]);
    } finally {
      close(run);
    }
  });

  it("keeps the exact seven-rule registry order and deeply freezes every query", () => {
    expect(SQLITE_STREAM_RECORD_RULES.map((rule) => rule.ruleId)).toEqual([
      "BLR_RECORD_STREAM_MISSING", "BLR_STREAM_EMPTY", "BLR_RECORD_GAP",
      "BLR_RECORD_PREDECESSOR", "BLR_STREAM_TAIL", "BLR_RECORD_HASH_DUPLICATE",
      "BLR_RECORD_BINDING",
    ]);
    expect(Object.isFrozen(SQLITE_STREAM_RECORD_RULES)).toBe(true);
    expect(SQLITE_STREAM_RECORD_RULES.every(Object.isFrozen)).toBe(true);
    expect(SQLITE_STREAM_RECORD_RULES.every((rule) => rule.sql.endsWith("LIMIT ?"))).toBe(true);
  });

  it("proves every record-bearing query uses its frozen named relation index", () => {
    const run = sealed();
    const expected = new Map<string, readonly string[]>([
      ["BLR_RECORD_STREAM_MISSING", ["ge_blr_records_stream_sequence_uidx"]],
      ["BLR_RECORD_GAP", ["ge_blr_records_stream_sequence_uidx"]],
      ["BLR_RECORD_PREDECESSOR", [
        "ge_blr_records_stream_sequence_uidx", "ge_blr_records_stream_position_idx",
      ]],
      ["BLR_STREAM_TAIL", ["ge_blr_records_stream_position_idx"]],
      ["BLR_RECORD_HASH_DUPLICATE", ["ge_blr_records_tenant_hash_uidx"]],
      ["BLR_RECORD_BINDING", ["ge_blr_records_tenant_hash_uidx"]],
    ]);
    try {
      for (const rule of SQLITE_STREAM_RECORD_RULES) {
        const plan = run.connection.prepare(
          `EXPLAIN QUERY PLAN ${rule.sql}`, "inspect-schema",
        ).all(17).map((row) => String((row as unknown as readonly unknown[])[3])).join("\n");
        for (const index of expected.get(rule.ruleId) ?? []) expect(plan).toContain(index);
      }
    } finally {
      close(run);
    }
  });

  it("caps a hostile rule at limit+1 witnesses and returns only safe fields", () => {
    const run = sealed();
    const target = SQLITE_STREAM_RECORD_RULES[5];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => Array.from({ length: 4 }, () => [1n]).values() } as never)
        : originalPrepare(sql, operation),
    );
    try {
      const report = runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage, { diagnosticLimit: 3 },
      );
      expect(report.diagnostics).toEqual([{
        ruleId: "BLR_RECORD_HASH_DUPLICATE",
        violationCount: 3,
        diagnosticsTruncated: true,
      }]);
      expect(Object.keys(report.diagnostics[0]!)).toEqual([
        "ruleId", "violationCount", "diagnosticsTruncated",
      ]);
      expect(Object.isFrozen(report.diagnostics[0])).toBe(true);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it.each([1, 16, 64])(
    "distinguishes an exact limit from limit+1 at the %i boundary",
    (limit) => {
      for (const extra of [0, 1]) {
        const run = sealed();
        const target = SQLITE_STREAM_RECORD_RULES[6];
        const originalPrepare = run.connection.prepare.bind(run.connection);
        const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
          (sql, operation) => sql === target.sql
            ? ({
              iterate: () => Array.from({ length: limit + extra }, () => [1n]).values(),
            } as never)
            : originalPrepare(sql, operation),
        );
        try {
          expect(runSQLiteStreamRecordInvariantCampaign(
            run.connection, run.projectionIdentity, run.stage, { diagnosticLimit: limit },
          ).diagnostics).toEqual([{
            ruleId: "BLR_RECORD_BINDING",
            violationCount: limit,
            diagnosticsTruncated: extra === 1,
          }]);
        } finally {
          prepare.mockRestore();
          close(run);
        }
      }
    },
  );

  it("rejects a malformed or identity-bearing witness row", () => {
    for (const hostileRow of [[0n], [2n], ["tenant-secret"], [1n, "tenant-secret"]]) {
      const run = sealed();
      const target = SQLITE_STREAM_RECORD_RULES[0];
      const originalPrepare = run.connection.prepare.bind(run.connection);
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => sql === target.sql
          ? ({ iterate: () => [hostileRow].values() } as never)
          : originalPrepare(sql, operation),
      );
      try {
        expect(() => runSQLiteStreamRecordInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        )).toThrow(CycleStoreProviderError);
        expect(run.stage.state).toBe("poisoned");
      } finally {
        prepare.mockRestore();
        close(run);
      }
    }
  });

  it.each([null, [], false, { diagnosticLimit: null }, { diagnosticLimit: 0 },
    { diagnosticLimit: 65 }, { unknown: 1 }])(
    "rejects hostile options before burning the stage: %j",
    (options) => {
      const run = sealed();
      try {
        expect(() => new SQLiteStreamRecordInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage, options as never,
        )).toThrow(CycleStoreProviderError);
        expect(runSQLiteStreamRecordInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([]);
      } finally {
        close(run);
      }
    },
  );

  it("rejects non-enumerable, symbol and accessor options without evaluating hostile getters", () => {
    const hostile: unknown[] = [];
    const hidden = {};
    Object.defineProperty(hidden, "hidden", { value: 1 });
    hostile.push(hidden, { [Symbol("hidden")]: 1 });
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, "diagnosticLimit", {
      enumerable: true,
      get: () => { getterCalls += 1; return 16; },
    });
    hostile.push(accessor);
    for (const options of hostile) {
      const run = sealed();
      try {
        expect(() => new SQLiteStreamRecordInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage, options as never,
        )).toThrow(CycleStoreProviderError);
        expect(runSQLiteStreamRecordInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([]);
      } finally {
        close(run);
      }
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects an equal-content projection clone and burns the exact stage", () => {
    const run = sealed();
    try {
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, Object.freeze({ ...run.projectionIdentity }), run.stage,
      )).toThrow(/binding/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("is one-shot after success and early abandonment is terminal", () => {
    const completed = sealed();
    try {
      const campaign = new SQLiteStreamRecordInvariantCampaign(
        completed.connection, completed.projectionIdentity, completed.stage,
      );
      expect(campaign.run().diagnostics).toEqual([]);
      expect(campaign.state).toBe("complete");
      expect(() => campaign.run()).toThrow(/one-shot/u);
      expect(completed.stage.state).toBe("poisoned");
    } finally {
      close(completed);
    }

    const abandoned = sealed();
    try {
      const campaign = new SQLiteStreamRecordInvariantCampaign(
        abandoned.connection, abandoned.projectionIdentity, abandoned.stage,
      );
      expect(() => campaign.dispose()).toThrow(/abandoned/u);
      expect(campaign.state).toBe("poisoned");
      expect(abandoned.stage.state).toBe("poisoned");
    } finally {
      close(abandoned);
    }
  });

  it("rejects catalog replacement before the campaign can prepare a rule", () => {
    const run = sealed();
    try {
      run.connection.execTrusted(
        "DROP INDEX temp.ge_blr_records_stream_position_idx",
        "inspect-schema",
      );
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/transaction changed|catalog/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it.each(SQLITE_STREAM_RECORD_RULES)(
    "detects DML during $ruleId next() and finalizes exactly once",
    (target) => {
    const run = sealed();
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.connection.prepare(
          "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
          "inspect-schema",
        ).run();
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
    },
  );

  it("detects DML from iterator close after EOF", () => {
    const run = sealed();
    const target = SQLITE_STREAM_RECORD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => ({ done: true, value: undefined }),
      return: () => {
        returns += 1;
        run.connection.prepare(
          "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
          "inspect-schema",
        ).run();
        return { done: true, value: undefined };
      },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(returns).toBe(1);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects mid-rule catalog replacement at the post-fetch fence", () => {
    const run = sealed();
    const target = SQLITE_STREAM_RECORD_RULES[2];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.connection.execTrusted(
          "DROP INDEX temp.ge_blr_records_stream_position_idx",
          "inspect-schema",
        );
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/transaction changed|catalog/u);
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects DML after a diagnostic append but before the next rule", () => {
    const run = sealed();
    const target = SQLITE_STREAM_RECORD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const originalFence = run.stage[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN]
      .bind(run.stage);
    let closed = false;
    let closedFences = 0;
    let emitted = false;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => emitted
        ? { done: true, value: undefined }
        : (emitted = true, { done: false, value: [1n] }),
      return: () => { closed = true; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    const fence = vi.spyOn(
      run.stage,
      SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN,
    ).mockImplementation((session) => {
      if (closed) {
        closedFences += 1;
        if (closedFences === 3) {
          run.connection.prepare(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            "inspect-schema",
          ).run();
        }
      }
      originalFence(session);
    });
    try {
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(closedFences).toBe(3);
    } finally {
      fence.mockRestore();
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects DML at terminal campaign completion", () => {
    const run = sealed();
    const originalComplete = run.stage[SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN]
      .bind(run.stage);
    const complete = vi.spyOn(
      run.stage,
      SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN,
    ).mockImplementation((session) => {
      run.connection.prepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        "inspect-schema",
      ).run();
      originalComplete(session);
    });
    try {
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      complete.mockRestore();
      close(run);
    }
  });

  it("preserves a primary query failure over iterator cleanup failure", () => {
    const run = sealed();
    const target = SQLITE_STREAM_RECORD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => { throw new Error("authoritative invariant read failure"); },
      return: () => { returns += 1; throw new Error("secondary cleanup failure"); },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline stream/record campaign failed");
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("stage disposal surfaces an active cursor cleanup failure after removing owned TEMP objects", () => {
    const run = sealed();
    const target = SQLITE_STREAM_RECORD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.stage.dispose();
        return { done: true, value: undefined };
      },
      return: () => {
        returns += 1;
        throw new Error("active campaign cleanup failure");
      },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteStreamRecordInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline stream/record campaign failed");
      expect(returns).toBe(1);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
        "inspect-schema",
      ).get()).toEqual([0n]);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      if (run.connection.isTransaction) {
        run.connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      run.connection.close();
    }
  });
});

type Checkpoint = ReturnType<typeof createCycleStoreCheckpoint>;

function insertInvariantCheckpointCurrent(
  connection: SQLiteConnection,
  tenantId: string,
  checkpoint: Checkpoint,
  revision: number,
  committedAtMs: number,
): void {
  const { value: _value, ...summary } = checkpoint;
  connection.prepare(`INSERT INTO ge_cycle_checkpoints
    (tenant_id, checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
     bound_record_hash, created_at, value_hash, value_bytes, value_blob,
     checkpoint_blob, summary_blob, checkpoint_revision, committed_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "inspect-schema").run(
    tenantId, checkpoint.checkpointScope, checkpoint.checkpointId,
    checkpoint.streamId, checkpoint.boundSequence, checkpoint.boundRecordHash,
    checkpoint.createdAt, checkpoint.valueHash, checkpoint.valueBytes,
    Buffer.from(canonicalSerialize(checkpoint.value), "utf8"),
    Buffer.from(canonicalSerialize(checkpoint), "utf8"),
    Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", summary)),
    revision, committedAtMs,
  );
}

function insertInvariantCheckpointRevision(
  connection: SQLiteConnection,
  tenantId: string,
  checkpointScope: string,
  revision: number,
  checkpointId: string,
  recordedAtMs: number,
  checkpoint?: Checkpoint,
): void {
  if (checkpoint === undefined) {
    connection.prepare(`INSERT INTO ge_cycle_checkpoint_revisions
      (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
       summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at,
       value_hash, value_bytes, recorded_at_ms)
      VALUES (?, ?, ?, ?, 'delete', NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
    "inspect-schema").run(
      tenantId, checkpointScope, revision, checkpointId, recordedAtMs,
    );
    return;
  }
  const { value: _value, ...summary } = checkpoint;
  connection.prepare(`INSERT INTO ge_cycle_checkpoint_revisions
    (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
     summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at,
     value_hash, value_bytes, recorded_at_ms)
    VALUES (?, ?, ?, ?, 'put', ?, ?, ?, ?, ?, ?, ?)`, "inspect-schema").run(
    tenantId, checkpointScope, revision, checkpointId,
    Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", summary)),
    checkpoint.boundSequence, checkpoint.boundRecordHash, checkpoint.createdAt,
    checkpoint.valueHash, checkpoint.valueBytes, recordedAtMs,
  );
}

function checkpoint(
  checkpointScope: string,
  checkpointId: string,
  streamId: string,
  boundRecordHash: string,
  value: unknown = `value-${checkpointId}`,
  createdAt = "2026-07-28T00:00:00Z",
): Checkpoint {
  return createCycleStoreCheckpoint({
    boundRecordHash,
    boundSequence: 0,
    checkpointId,
    checkpointScope,
    createdAt,
    streamId,
    value,
  });
}

function sealedHostileCheckpointFixture(): Sealed {
  const connection = opened(NOW);
  connection.execTrusted("PRAGMA foreign_keys = OFF", "inspect-schema");
  const addRecord = (tenantId: string, streamId: string, recordId: string): string => {
    const hash = insertInvariantRecord(
      connection, tenantId, streamId, recordId, 0, null, NOW,
    );
    insertInvariantStream(connection, tenantId, streamId, 0, hash, NOW);
    return hash;
  };

  const crossHash = addRecord("tenant-foreign", "stream-cross", "record-cross-0");
  const cross = checkpoint("scope-cross", "checkpoint-cross", "stream-cross", crossHash);
  insertInvariantCheckpointRevision(
    connection, "tenant-cross", "scope-cross", 1, "checkpoint-cross", NOW, cross,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-cross", "scope-cross", 2, "checkpoint-cross", NOW,
  );

  addRecord("tenant-wrong", "stream-wrong", "record-wrong-0");
  const wrong = checkpoint(
    "scope-wrong", "checkpoint-wrong", "stream-wrong", "c".repeat(64),
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-wrong", "scope-wrong", 1, "checkpoint-wrong", NOW, wrong,
  );
  insertInvariantCheckpointCurrent(connection, "tenant-wrong", wrong, 1, NOW);

  const startHash = addRecord("tenant-start", "stream-start", "record-start-0");
  const start = checkpoint("scope-start", "checkpoint-start", "stream-start", startHash);
  insertInvariantCheckpointRevision(
    connection, "tenant-start", "scope-start", 2, "checkpoint-start", NOW, start,
  );

  const mixedHash = addRecord("tenant-mixed", "stream-mixed", "record-mixed-0");
  const mixedA = checkpoint("scope-mixed", "checkpoint-a", "stream-mixed", mixedHash);
  const mixedB = checkpoint("scope-mixed", "checkpoint-b", "stream-mixed", mixedHash);
  insertInvariantCheckpointRevision(
    connection, "tenant-mixed", "scope-mixed", 1, "checkpoint-a", NOW, mixedA,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-mixed", "scope-mixed", 2, "checkpoint-b", NOW, mixedB,
  );
  insertInvariantCheckpointCurrent(connection, "tenant-mixed", mixedB, 2, NOW);

  const deleteHash = addRecord("tenant-delete", "stream-delete", "record-delete-0");
  const deleted = checkpoint(
    "scope-delete", "checkpoint-delete", "stream-delete", deleteHash,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-delete", "scope-delete", 1, "checkpoint-delete", NOW, deleted,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-delete", "scope-delete", 2, "checkpoint-delete", NOW,
  );
  insertInvariantCheckpointCurrent(connection, "tenant-delete", deleted, 1, NOW);

  const zeroHash = addRecord("tenant-zero", "stream-zero", "record-zero-0");
  const zero = checkpoint("scope-zero", "checkpoint-zero", "stream-zero", zeroHash);
  insertInvariantCheckpointCurrent(connection, "tenant-zero", zero, 1, NOW);

  const interleavedHash = addRecord(
    "tenant-interleaved", "stream-interleaved", "record-interleaved-0",
  );
  const interleavedA = checkpoint(
    "scope-interleaved", "checkpoint-a", "stream-interleaved", interleavedHash,
  );
  const interleavedB = checkpoint(
    "scope-interleaved", "checkpoint-b", "stream-interleaved", interleavedHash,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-interleaved", "scope-interleaved", 1,
    "checkpoint-a", NOW, interleavedA,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-interleaved", "scope-interleaved", 2,
    "checkpoint-b", NOW, interleavedB,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-interleaved", "scope-interleaved", 3,
    "checkpoint-a", NOW, interleavedA,
  );
  insertInvariantCheckpointCurrent(connection, "tenant-interleaved", interleavedA, 1, NOW);
  insertInvariantCheckpointCurrent(connection, "tenant-interleaved", interleavedB, 2, NOW);

  const bindingHash = addRecord("tenant-binding", "stream-binding", "record-binding-0");
  const bindingRevision = checkpoint(
    "scope-binding", "checkpoint-binding", "stream-binding", bindingHash,
    "binding-revision",
  );
  const bindingCurrent = checkpoint(
    "scope-binding", "checkpoint-binding", "stream-binding", bindingHash,
    "binding-current", "2026-07-29T00:00:00Z",
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-binding", "scope-binding", 1,
    "checkpoint-binding", NOW - 1, bindingRevision,
  );
  insertInvariantCheckpointCurrent(connection, "tenant-binding", bindingCurrent, 1, NOW);

  const interiorHash = addRecord(
    "tenant-interior", "stream-interior", "record-interior-0",
  );
  const interior = checkpoint(
    "scope-interior", "checkpoint-interior", "stream-interior", interiorHash,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-interior", "scope-interior", 1,
    "checkpoint-interior", NOW, interior,
  );
  insertInvariantCheckpointRevision(
    connection, "tenant-interior", "scope-interior", 3,
    "checkpoint-interior", NOW, interior,
  );
  insertInvariantCheckpointCurrent(connection, "tenant-interior", interior, 3, NOW);

  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  const stage = createSQLiteBaselineTempStage(
    connection, proveSQLiteExclusiveBaselineTransaction(connection),
  ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
  const source = captureSQLiteV1BaselineSourceSummary(
    connection, NOW,
  ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
  const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
    connection, source, stage,
  );
  runSQLiteStreamRecordInvariantCampaign(connection, projectionIdentity, stage);
  return { connection, source, stage, projectionIdentity };
}

function sealedForCheckpoint(seed = true): Sealed {
  const run = sealed(seed);
  runSQLiteStreamRecordInvariantCampaign(
    run.connection, run.projectionIdentity, run.stage,
  );
  return run;
}

describe("SQLite checkpoint invariant campaign", () => {
  it("reports the exact shared hostile checkpoint vector", () => {
    const run = sealedHostileCheckpointFixture();
    try {
      expect(run.projectionIdentity).toEqual({
        baselineId: "v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af",
        entryCount: 43,
        legacyOperationCount: 0,
        firstEntryHash: "f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c",
        finalEntryHash: "c4585a6a22dd0859d5d671f75ff143a6c5eae088cc3d87a2addc97ce9c21144c",
        projectionSha256: "264a8ba16682d78368f5318e67b2c938167a28549ccf8fbb1ca685d2f79f497e",
      });
      expect(runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([
        { ruleId: "BLR_CHECKPOINT_REVISION_GAP", violationCount: 2, diagnosticsTruncated: false },
        { ruleId: "BLR_CHECKPOINT_RECORD_MISSING", violationCount: 3, diagnosticsTruncated: false },
        { ruleId: "BLR_CHECKPOINT_CURRENT_MISSING", violationCount: 2, diagnosticsTruncated: false },
        { ruleId: "BLR_CHECKPOINT_CURRENT_UNEXPECTED", violationCount: 2, diagnosticsTruncated: false },
        { ruleId: "BLR_CHECKPOINT_CURRENT_STALE", violationCount: 1, diagnosticsTruncated: false },
        { ruleId: "BLR_CHECKPOINT_CURRENT_BINDING", violationCount: 1, diagnosticsTruncated: false },
      ]);
    } finally {
      close(run);
    }
  });

  it("returns a deeply frozen safe empty report bound to the exact projection", () => {
    const run = sealedForCheckpoint();
    try {
      const report = runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      );
      expect(report).toEqual({ projectionIdentity: run.projectionIdentity, diagnostics: [] });
      expect(report.projectionIdentity).toBe(run.projectionIdentity);
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.diagnostics)).toBe(true);
      expect(Object.keys(report)).toEqual(["projectionIdentity", "diagnostics"]);
    } finally {
      close(run);
    }
  });

  it("re-proves exact common counts and relation coverage before opening a session", () => {
    const run = sealedForCheckpoint();
    const common = vi.spyOn(run.stage, "assertCommonCounts");
    const coverage = vi.spyOn(run.stage, "assertRelationKeyCoverage");
    try {
      expect(runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([]);
      expect(common).toHaveBeenCalledTimes(2);
      expect(coverage).toHaveBeenCalledTimes(2);
    } finally {
      coverage.mockRestore();
      common.mockRestore();
      close(run);
    }
  });

  it("keeps the exact six-rule order and deeply freezes fixed bounded SQL", () => {
    expect(SQLITE_CHECKPOINT_RULES.map((rule) => rule.ruleId)).toEqual([
      "BLR_CHECKPOINT_REVISION_GAP",
      "BLR_CHECKPOINT_RECORD_MISSING",
      "BLR_CHECKPOINT_CURRENT_MISSING",
      "BLR_CHECKPOINT_CURRENT_UNEXPECTED",
      "BLR_CHECKPOINT_CURRENT_STALE",
      "BLR_CHECKPOINT_CURRENT_BINDING",
    ]);
    expect(Object.isFrozen(SQLITE_CHECKPOINT_RULES)).toBe(true);
    expect(SQLITE_CHECKPOINT_RULES.every(Object.isFrozen)).toBe(true);
    expect(SQLITE_CHECKPOINT_RULES.every((rule) => rule.sql.endsWith("LIMIT ?"))).toBe(true);
    expect(SQLITE_CHECKPOINT_RULES.every((rule) => rule.sql.startsWith("SELECT 1")
      || rule.sql.startsWith("SELECT violation"))).toBe(true);
  });

  it("proves every checkpoint query uses its frozen named relation indexes", () => {
    const run = sealedForCheckpoint();
    const expected = new Map<string, readonly string[]>([
      ["BLR_CHECKPOINT_REVISION_GAP", ["ge_blr_checkpoint_revisions_latest_idx"]],
      ["BLR_CHECKPOINT_RECORD_MISSING", [
        "ge_blr_checkpoint_current_record_idx",
        "ge_blr_checkpoint_revisions_record_idx",
        "ge_blr_records_stream_position_idx",
      ]],
      ["BLR_CHECKPOINT_CURRENT_MISSING", ["ge_blr_checkpoint_revisions_latest_idx"]],
      ["BLR_CHECKPOINT_CURRENT_UNEXPECTED", ["ge_blr_checkpoint_revisions_latest_idx"]],
      ["BLR_CHECKPOINT_CURRENT_STALE", ["ge_blr_checkpoint_revisions_latest_idx"]],
      ["BLR_CHECKPOINT_CURRENT_BINDING", ["ge_blr_checkpoint_revisions_latest_idx"]],
    ]);
    try {
      for (const rule of SQLITE_CHECKPOINT_RULES) {
        const plan = run.connection.prepare(
          `EXPLAIN QUERY PLAN ${rule.sql}`, "inspect-schema",
        ).all(17).map((row) => String((row as unknown as readonly unknown[])[3])).join("\n");
        for (const index of expected.get(rule.ruleId) ?? []) expect(plan).toContain(index);
      }
    } finally {
      close(run);
    }
  });

  it("rejects checkpoint execution before the predecessor campaign completes", () => {
    const run = sealed();
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/binding/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it.each([1, 16, 64])(
    "distinguishes exact checkpoint limit from limit+1 at %i",
    (limit) => {
      for (const extra of [0, 1]) {
        const run = sealedForCheckpoint();
        const target = SQLITE_CHECKPOINT_RULES[5];
        const originalPrepare = run.connection.prepare.bind(run.connection);
        const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
          (sql, operation) => sql === target.sql
            ? ({
              iterate: () => Array.from({ length: limit + extra }, () => [1n]).values(),
            } as never)
            : originalPrepare(sql, operation),
        );
        try {
          expect(runSQLiteCheckpointInvariantCampaign(
            run.connection, run.projectionIdentity, run.stage, { diagnosticLimit: limit },
          ).diagnostics).toEqual([{
            ruleId: "BLR_CHECKPOINT_CURRENT_BINDING",
            violationCount: limit,
            diagnosticsTruncated: extra === 1,
          }]);
        } finally {
          prepare.mockRestore();
          close(run);
        }
      }
    },
  );

  it("rejects malformed checkpoint witness rows without leaking identity", () => {
    for (const hostileRow of [[0n], [2n], ["tenant-secret"], [1n, "tenant-secret"]]) {
      const run = sealedForCheckpoint();
      const target = SQLITE_CHECKPOINT_RULES[0];
      const originalPrepare = run.connection.prepare.bind(run.connection);
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => sql === target.sql
          ? ({ iterate: () => [hostileRow].values() } as never)
          : originalPrepare(sql, operation),
      );
      try {
        expect(() => runSQLiteCheckpointInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        )).toThrow(CycleStoreProviderError);
        expect(run.stage.state).toBe("poisoned");
      } finally {
        prepare.mockRestore();
        close(run);
      }
    }
  });

  it.each(SQLITE_CHECKPOINT_RULES)(
    "detects DML during $ruleId fetch and finalizes exactly once",
    (target) => {
      const run = sealedForCheckpoint();
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let returns = 0;
      const iterator: Iterator<unknown> & Iterable<unknown> = {
        [Symbol.iterator]() { return this; },
        next: () => {
          run.connection.prepare(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            "inspect-schema",
          ).run();
          return { done: true, value: undefined };
        },
        return: () => { returns += 1; return { done: true, value: undefined }; },
      };
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => sql === target.sql
          ? ({ iterate: () => iterator } as never)
          : originalPrepare(sql, operation),
      );
      try {
        expect(() => runSQLiteCheckpointInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        )).toThrow(/unexplained write/u);
        expect(returns).toBe(1);
        expect(run.stage.state).toBe("poisoned");
      } finally {
        prepare.mockRestore();
        close(run);
      }
    },
  );

  it.each(SQLITE_CHECKPOINT_RULES)(
    "detects DML after $ruleId cursor creation and before first fetch",
    (target) => {
      const run = sealedForCheckpoint();
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let returns = 0;
      const iterator: Iterator<unknown> & Iterable<unknown> = {
        [Symbol.iterator]() { return this; },
        next: () => ({ done: true, value: undefined }),
        return: () => { returns += 1; return { done: true, value: undefined }; },
      };
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => sql === target.sql
          ? ({
            iterate: () => {
              run.connection.prepare(
                "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
                "inspect-schema",
              ).run();
              return iterator;
            },
          } as never)
          : originalPrepare(sql, operation),
      );
      try {
        expect(() => runSQLiteCheckpointInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        )).toThrow(/unexplained write/u);
        expect(returns).toBe(1);
        expect(run.stage.state).toBe("poisoned");
      } finally {
        prepare.mockRestore();
        close(run);
      }
    },
  );

  it("preserves a primary checkpoint fetch failure over cleanup failure", () => {
    const run = sealedForCheckpoint();
    const target = SQLITE_CHECKPOINT_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => { throw new Error("authoritative checkpoint failure"); },
      return: () => { returns += 1; throw new Error("secondary cleanup failure"); },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline checkpoint campaign failed");
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects DML at terminal checkpoint completion", () => {
    const run = sealedForCheckpoint();
    const originalComplete = run.stage[SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN]
      .bind(run.stage);
    const complete = vi.spyOn(
      run.stage, SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN,
    ).mockImplementation((session) => {
      run.connection.prepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        "inspect-schema",
      ).run();
      originalComplete(session);
    });
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      complete.mockRestore();
      close(run);
    }
  });

  it.each([null, [], false, { diagnosticLimit: null }, { diagnosticLimit: 0 },
    { diagnosticLimit: 65 }, { unknown: 1 }])(
    "rejects hostile checkpoint options without consuming the stage: %j",
    (options) => {
      const run = sealedForCheckpoint();
      try {
        expect(() => new SQLiteCheckpointInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage, options as never,
        )).toThrow(CycleStoreProviderError);
        expect(runSQLiteCheckpointInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([]);
      } finally {
        close(run);
      }
    },
  );

  it("rejects hidden, symbol and accessor checkpoint options without invoking getters", () => {
    const hidden = {};
    Object.defineProperty(hidden, "hidden", { value: 1 });
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, "diagnosticLimit", {
      enumerable: true,
      get: () => { getterCalls += 1; return 16; },
    });
    for (const options of [hidden, { [Symbol("hidden")]: 1 }, accessor]) {
      const run = sealedForCheckpoint();
      try {
        expect(() => new SQLiteCheckpointInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage, options,
        )).toThrow(CycleStoreProviderError);
        expect(runSQLiteCheckpointInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([]);
      } finally {
        close(run);
      }
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects an equal-content projection clone and burns the sealed stage", () => {
    const run = sealedForCheckpoint();
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, Object.freeze({ ...run.projectionIdentity }), run.stage,
      )).toThrow(/binding/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("is one-shot after success and abandonment is terminal", () => {
    const completed = sealedForCheckpoint();
    try {
      const campaign = new SQLiteCheckpointInvariantCampaign(
        completed.connection, completed.projectionIdentity, completed.stage,
      );
      expect(campaign.run().diagnostics).toEqual([]);
      expect(campaign.state).toBe("complete");
      expect(() => campaign.run()).toThrow(/one-shot/u);
      expect(completed.stage.state).toBe("poisoned");
    } finally {
      close(completed);
    }

    const abandoned = sealedForCheckpoint();
    try {
      const campaign = new SQLiteCheckpointInvariantCampaign(
        abandoned.connection, abandoned.projectionIdentity, abandoned.stage,
      );
      expect(() => campaign.dispose()).toThrow(/abandoned/u);
      expect(campaign.state).toBe("poisoned");
      expect(abandoned.stage.state).toBe("poisoned");
    } finally {
      close(abandoned);
    }
  });

  it("rejects equal-count common mutation before checkpoint query preparation", () => {
    const run = sealedForCheckpoint();
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const prepare = vi.spyOn(run.connection, "prepare");
    try {
      originalPrepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 4",
        "inspect-schema",
      ).run();
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(prepare.mock.calls.some(([sql]) => SQLITE_CHECKPOINT_RULES
        .some((rule) => rule.sql === sql))).toBe(false);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("rejects delete/recreate catalog substitution before checkpoint execution", () => {
    const run = sealedForCheckpoint();
    try {
      run.connection.execTrusted(
        "DROP INDEX temp.ge_blr_checkpoint_revisions_latest_idx",
        "inspect-schema",
      );
      run.connection.execTrusted(
        "CREATE INDEX ge_blr_checkpoint_revisions_latest_idx ON ge_blr_checkpoint_revisions(tenant_id)",
        "inspect-schema",
      );
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/transaction changed|catalog|unexplained write/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("detects DML from checkpoint iterator close after EOF", () => {
    const run = sealedForCheckpoint();
    const target = SQLITE_CHECKPOINT_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => ({ done: true, value: undefined }),
      return: () => {
        returns += 1;
        run.connection.prepare(
          "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
          "inspect-schema",
        ).run();
        return { done: true, value: undefined };
      },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(returns).toBe(1);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects mid-rule checkpoint catalog replacement at the post-fetch fence", () => {
    const run = sealedForCheckpoint();
    const target = SQLITE_CHECKPOINT_RULES[2];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.connection.execTrusted(
          "DROP INDEX temp.ge_blr_checkpoint_current_record_idx", "inspect-schema",
        );
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/transaction changed|catalog/u);
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects DML after a checkpoint diagnostic and before rule transition", () => {
    const run = sealedForCheckpoint();
    const target = SQLITE_CHECKPOINT_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const originalFence = run.stage[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN]
      .bind(run.stage);
    let closed = false;
    let closedFences = 0;
    let emitted = false;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => emitted
        ? { done: true, value: undefined }
        : (emitted = true, { done: false, value: [1n] }),
      return: () => { closed = true; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    const fence = vi.spyOn(
      run.stage, SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN,
    ).mockImplementation((session) => {
      if (closed) {
        closedFences += 1;
        if (closedFences === 3) {
          run.connection.prepare(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            "inspect-schema",
          ).run();
        }
      }
      originalFence(session);
    });
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(closedFences).toBe(3);
    } finally {
      fence.mockRestore();
      prepare.mockRestore();
      close(run);
    }
  });

  it("stage disposal runs active checkpoint cleanup once and removes owned TEMP objects", () => {
    const run = sealedForCheckpoint();
    const target = SQLITE_CHECKPOINT_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.stage.dispose();
        return { done: true, value: undefined };
      },
      return: () => {
        returns += 1;
        throw new Error("active checkpoint cleanup failure");
      },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline checkpoint campaign failed");
      expect(returns).toBe(1);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
        "inspect-schema",
      ).get()).toEqual([0n]);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });

  it("stage disposal closes an active checkpoint cursor normally and removes the catalog", () => {
    const run = sealedForCheckpoint();
    const target = SQLITE_CHECKPOINT_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.stage.dispose();
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteCheckpointInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(returns).toBe(1);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
        "inspect-schema",
      ).get()).toEqual([0n]);
    } finally {
      prepare.mockRestore();
      if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });

  it.each([
    [4, "$.summary.valueHash", "d".repeat(64)],
    [5, "$.summary.streamId", "substituted-rank5-stream"],
  ] as const)(
    "defensively detects rank %i nested canonical summary substitution",
    (kindRank, path, value) => {
      const run = sealedForCheckpoint();
      try {
        run.connection.prepare(
          `UPDATE temp.ge_blr_stage
              SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), ?, ?) AS BLOB)
            WHERE kind_rank = ?`,
          "inspect-schema",
        ).run(path, value, kindRank);
        const witnesses = run.connection.prepare(
          SQLITE_CHECKPOINT_RULES[5].sql, "inspect-schema",
        ).all(17);
        expect(witnesses).toEqual([[1n]]);
      } finally {
        if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
        run.connection.close();
      }
    },
  );

  it("defensively rejects a delete revision whose canonical summary null was substituted", () => {
    const run = sealedHostileCheckpointFixture();
    try {
      const rule = SQLITE_CHECKPOINT_RULES[5];
      expect(run.connection.prepare(rule.sql, "inspect-schema").all(17)).toEqual([[1n]]);
      run.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), '$.summary', json('{}')) AS BLOB)
          WHERE kind_rank = 5
            AND json_extract(CAST(state_blob AS TEXT), '$.action') = 'delete'
            AND json_extract(CAST(state_blob AS TEXT), '$.tenantId') = 'tenant-cross'`,
        "inspect-schema",
      ).run();
      expect(run.connection.prepare(rule.sql, "inspect-schema").all(17)).toEqual([[1n], [1n]]);
    } finally {
      if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });

  it("freezes all normalized and nested checkpoint binding paths", () => {
    const sql = SQLITE_CHECKPOINT_RULES[5].sql;
    for (const path of [
      "$.summary.checkpointScope", "$.summary.checkpointId", "$.summary.streamId",
      "$.summary.boundSequence", "$.summary.boundRecordHash", "$.summary.createdAt",
      "$.summary.valueHash", "$.summary.valueBytes", "$.committedAtMs", "$.recordedAtMs",
    ]) expect(sql).toContain(path);
    expect(sql).toContain("current.committed_at_ms IS NOT latest.recorded_at_ms");
    expect(sql).toContain("json_type(CAST(common.state_blob AS TEXT), '$.summary') IS NOT 'null'");
  });
});

function insertInvariantLease(
  connection: SQLiteConnection,
  tenantId: string,
  streamId: string,
  lastEpoch: number,
  active?: Readonly<{
    leaseId: string;
    holderId: string;
    acquiredAtMs: number;
    expiresAtMs: number;
  }>,
): void {
  connection.prepare(`INSERT INTO ge_cycle_leases
    (tenant_id, stream_id, active_lease_id, active_holder_id,
     active_lease_epoch, active_fencing_token, active_acquired_at_ms,
     active_expires_at_ms, last_lease_epoch, last_fencing_token, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, "inspect-schema").run(
    tenantId, streamId, active?.leaseId ?? null, active?.holderId ?? null,
    active === undefined ? null : lastEpoch, active === undefined ? null : lastEpoch,
    active?.acquiredAtMs ?? null, active?.expiresAtMs ?? null,
    lastEpoch, lastEpoch, NOW,
  );
}

function insertInvariantUsedLease(
  connection: SQLiteConnection,
  tenantId: string,
  streamId: string,
  leaseId: string,
  epoch: number,
  firstUsedAtMs: number,
): void {
  connection.prepare(`INSERT INTO ge_cycle_used_lease_ids
    (tenant_id, stream_id, lease_id, lease_epoch, fencing_token, first_used_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)`, "inspect-schema").run(
    tenantId, streamId, leaseId, epoch, epoch, firstUsedAtMs,
  );
}

function insertInvariantHold(
  connection: SQLiteConnection,
  tenantId: string,
  streamId: string,
  holdId: string,
): void {
  connection.prepare(`INSERT INTO ge_cycle_legal_holds
    (tenant_id, stream_id, hold_id, placed_at_ms) VALUES (?, ?, ?, ?)`,
  "inspect-schema").run(tenantId, streamId, holdId, NOW);
}

function sealedHostileLeaseLockHoldFixture(): Sealed {
  const connection = opened(NOW);
  connection.execTrusted("PRAGMA foreign_keys = OFF", "inspect-schema");
  const addStream = (tenantId: string, streamId: string, recordId: string): void => {
    const hash = insertInvariantRecord(
      connection, tenantId, streamId, recordId, 0, null, NOW,
    );
    insertInvariantStream(connection, tenantId, streamId, 0, hash, NOW);
  };

  addStream("tenant-foreign", "stream-orphan", "record-stream-orphan-0");
  insertInvariantLease(connection, "tenant-lease-orphan", "stream-orphan", 0);
  insertInvariantHold(connection, "tenant-hold-orphan", "stream-orphan", "hold-orphan");

  addStream("tenant-start", "stream-start", "record-stream-start-0");
  insertInvariantLease(connection, "tenant-start", "stream-start", 2);
  insertInvariantUsedLease(
    connection, "tenant-start", "stream-start", "lease-start-2", 2, NOW - 100,
  );

  addStream("tenant-interior", "stream-interior", "record-stream-interior-0");
  insertInvariantLease(connection, "tenant-interior", "stream-interior", 3);
  insertInvariantUsedLease(
    connection, "tenant-interior", "stream-interior", "lease-interior-1", 1, NOW - 100,
  );
  insertInvariantUsedLease(
    connection, "tenant-interior", "stream-interior", "lease-interior-3", 3, NOW - 100,
  );

  addStream("tenant-extra", "stream-extra", "record-stream-extra-0");
  insertInvariantLease(connection, "tenant-extra", "stream-extra", 2);
  for (const epoch of [1, 2, 3]) {
    insertInvariantUsedLease(
      connection, "tenant-extra", "stream-extra", `lease-extra-${epoch}`,
      epoch, NOW - 100,
    );
  }

  addStream("tenant-active-id", "stream-active-id", "record-stream-active-id-0");
  insertInvariantLease(connection, "tenant-active-id", "stream-active-id", 1, {
    leaseId: "lease-active-wrong", holderId: "holder-active-id",
    acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
  });
  insertInvariantUsedLease(
    connection, "tenant-active-id", "stream-active-id", "lease-active-terminal", 1, NOW - 100,
  );

  addStream("tenant-active-clock", "stream-active-clock", "record-stream-active-clock-0");
  insertInvariantLease(connection, "tenant-active-clock", "stream-active-clock", 1, {
    leaseId: "lease-active-clock", holderId: "holder-active-clock",
    acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
  });
  insertInvariantUsedLease(
    connection, "tenant-active-clock", "stream-active-clock", "lease-active-clock", 1, NOW - 101,
  );

  addStream("tenant-zero", "stream-zero", "record-stream-zero-0");
  insertInvariantLease(connection, "tenant-zero", "stream-zero", 0);

  addStream("tenant-retired", "stream-retired", "record-stream-retired-0");
  insertInvariantLease(connection, "tenant-retired", "stream-retired", 2);
  insertInvariantUsedLease(
    connection, "tenant-retired", "stream-retired", "lease-retired-1", 1, NOW - 100,
  );
  insertInvariantUsedLease(
    connection, "tenant-retired", "stream-retired", "lease-retired-2", 2, NOW - 100,
  );

  addStream("tenant-active-valid", "stream-active-valid", "record-stream-active-valid-0");
  insertInvariantLease(connection, "tenant-active-valid", "stream-active-valid", 1, {
    leaseId: "lease-active-valid", holderId: "holder-active-valid",
    acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
  });
  insertInvariantUsedLease(
    connection, "tenant-active-valid", "stream-active-valid", "lease-active-valid", 1, NOW - 100,
  );

  insertInvariantHold(connection, "tenant-active-clock", "stream-active-clock", "hold-valid-a");
  insertInvariantHold(connection, "tenant-active-clock", "stream-active-clock", "hold-valid-b");

  connection.prepare(`UPDATE ge_cycle_migration_lock SET
    active_lock_id = 'lock-active-wrong', active_owner_id = 'owner-active',
    active_source_version = 1, active_target_version = 2,
    active_lock_epoch = 3, active_fencing_token = 3,
    active_acquired_at_ms = ?, active_expires_at_ms = ?,
    last_lock_epoch = 3, last_fencing_token = 3, updated_at_ms = ?
    WHERE singleton = 1`, "inspect-schema").run(NOW - 200, NOW + 200, NOW);
  connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
    (lock_id, lock_epoch, fencing_token, first_used_at_ms)
    VALUES ('lock-history-2', 2, 2, ?), ('lock-terminal-3', 3, 3, ?)`,
  "inspect-schema").run(NOW - 201, NOW - 201);

  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  const stage = createSQLiteBaselineTempStage(
    connection, proveSQLiteExclusiveBaselineTransaction(connection),
  ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
  const source = captureSQLiteV1BaselineSourceSummary(
    connection, NOW,
  ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
  const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
    connection, source, stage,
  );
  runSQLiteStreamRecordInvariantCampaign(connection, projectionIdentity, stage);
  runSQLiteCheckpointInvariantCampaign(connection, projectionIdentity, stage);
  return { connection, source, stage, projectionIdentity };
}

function sealedLeaseLockHoldSource(
  populate: (connection: SQLiteConnection) => void,
): Sealed {
  const connection = opened(NOW);
  connection.execTrusted("PRAGMA foreign_keys = OFF", "inspect-schema");
  populate(connection);
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  const stage = createSQLiteBaselineTempStage(
    connection, proveSQLiteExclusiveBaselineTransaction(connection),
  ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
  const source = captureSQLiteV1BaselineSourceSummary(
    connection, NOW,
  ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
  const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
    connection, source, stage,
  );
  runSQLiteStreamRecordInvariantCampaign(connection, projectionIdentity, stage);
  runSQLiteCheckpointInvariantCampaign(connection, projectionIdentity, stage);
  return { connection, source, stage, projectionIdentity };
}

function sealedForLeaseLockHold(): Sealed {
  const run = sealedForCheckpoint(false);
  runSQLiteCheckpointInvariantCampaign(
    run.connection, run.projectionIdentity, run.stage,
  );
  return run;
}

describe("SQLite lease/lock/hold invariant campaign", () => {
  it("reports the exact shared hostile lease/lock/hold vector and identity", () => {
    const run = sealedHostileLeaseLockHoldFixture();
    try {
      expect(run.projectionIdentity).toEqual({
        baselineId: "v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af",
        entryCount: 46,
        legacyOperationCount: 0,
        firstEntryHash: "f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c",
        finalEntryHash: "6b929039b709ef0a09818896df9d0366564389219e7fbec1866648bd67684638",
        projectionSha256: "ebc3aab7adc7062aee8067e2bbada04d14f0502802f1241dd62b2a790eb9e755",
      });
      expect(runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([
        { ruleId: "BLR_LEASE_STREAM_MISSING", violationCount: 1, diagnosticsTruncated: false },
        { ruleId: "BLR_LEASE_HISTORY_INCOMPLETE", violationCount: 3, diagnosticsTruncated: false },
        { ruleId: "BLR_LEASE_ACTIVE_BINDING", violationCount: 2, diagnosticsTruncated: false },
        { ruleId: "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE", violationCount: 1, diagnosticsTruncated: false },
        { ruleId: "BLR_MIGRATION_LOCK_ACTIVE_BINDING", violationCount: 1, diagnosticsTruncated: false },
        { ruleId: "BLR_HOLD_STREAM_MISSING", violationCount: 1, diagnosticsTruncated: false },
      ]);
    } finally {
      close(run);
    }
  });

  it("executes every rule against an isolated real-source witness", () => {
    const addStream = (connection: SQLiteConnection, tenant: string, stream: string): void => {
      const hash = insertInvariantRecord(
        connection, tenant, stream, `record-${stream}-0`, 0, null, NOW,
      );
      insertInvariantStream(connection, tenant, stream, 0, hash, NOW);
    };
    const cases: readonly [
      SQLiteLeaseLockHoldRuleId,
      (connection: SQLiteConnection) => void,
    ][] = [
      ["BLR_LEASE_STREAM_MISSING", (connection) => {
        insertInvariantLease(connection, "tenant-orphan", "stream-orphan", 0);
      }],
      ["BLR_LEASE_HISTORY_INCOMPLETE", (connection) => {
        addStream(connection, "tenant-gap", "stream-gap");
        insertInvariantLease(connection, "tenant-gap", "stream-gap", 2);
        insertInvariantUsedLease(
          connection, "tenant-gap", "stream-gap", "lease-gap-2", 2, NOW - 100,
        );
      }],
      ["BLR_LEASE_ACTIVE_BINDING", (connection) => {
        addStream(connection, "tenant-active", "stream-active");
        insertInvariantLease(connection, "tenant-active", "stream-active", 1, {
          leaseId: "lease-active", holderId: "holder-active",
          acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
        });
        insertInvariantUsedLease(
          connection, "tenant-active", "stream-active", "lease-other", 1, NOW - 100,
        );
      }],
      ["BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE", (connection) => {
        connection.prepare(`UPDATE ge_cycle_migration_lock SET
          last_lock_epoch = 2, last_fencing_token = 2, updated_at_ms = ?
          WHERE singleton = 1`, "inspect-schema").run(NOW);
        connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
          (lock_id, lock_epoch, fencing_token, first_used_at_ms)
          VALUES ('lock-gap-2', 2, 2, ?)`, "inspect-schema").run(NOW - 100);
      }],
      ["BLR_MIGRATION_LOCK_ACTIVE_BINDING", (connection) => {
        connection.prepare(`UPDATE ge_cycle_migration_lock SET
          active_lock_id = 'lock-active', active_owner_id = 'owner-active',
          active_source_version = 1, active_target_version = 2,
          active_lock_epoch = 1, active_fencing_token = 1,
          active_acquired_at_ms = ?, active_expires_at_ms = ?,
          last_lock_epoch = 1, last_fencing_token = 1, updated_at_ms = ?
          WHERE singleton = 1`, "inspect-schema").run(NOW - 100, NOW + 100, NOW);
        connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
          (lock_id, lock_epoch, fencing_token, first_used_at_ms)
          VALUES ('lock-other', 1, 1, ?)`, "inspect-schema").run(NOW - 100);
      }],
      ["BLR_HOLD_STREAM_MISSING", (connection) => {
        insertInvariantHold(connection, "tenant-hold", "stream-hold", "hold-orphan");
      }],
    ];
    for (const [ruleId, populate] of cases) {
      const run = sealedLeaseLockHoldSource(populate);
      try {
        expect(runSQLiteLeaseLockHoldInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([{ ruleId, violationCount: 1, diagnosticsTruncated: false }]);
      } finally {
        close(run);
      }
    }
  });

  it("rejects retired active-ID reuse without double-counting complete history", () => {
    const run = sealedLeaseLockHoldSource((connection) => {
      const hash = insertInvariantRecord(
        connection, "tenant-reuse", "stream-reuse", "record-stream-reuse-0",
        0, null, NOW,
      );
      insertInvariantStream(connection, "tenant-reuse", "stream-reuse", 0, hash, NOW);
      insertInvariantLease(connection, "tenant-reuse", "stream-reuse", 2, {
        leaseId: "lease-reused", holderId: "holder-reuse",
        acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
      });
      insertInvariantUsedLease(
        connection, "tenant-reuse", "stream-reuse", "lease-reused", 1, NOW - 200,
      );
      insertInvariantUsedLease(
        connection, "tenant-reuse", "stream-reuse", "lease-terminal-2", 2, NOW - 100,
      );
    });
    try {
      expect(runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([{
        ruleId: "BLR_LEASE_ACTIVE_BINDING",
        violationCount: 1,
        diagnosticsTruncated: false,
      }]);
    } finally {
      close(run);
    }
  });

  it("rejects duplicate lease/lock epochs and multiple singleton candidates early", () => {
    const connection = opened(NOW);
    connection.execTrusted("PRAGMA foreign_keys = OFF", "inspect-schema");
    const hash = insertInvariantRecord(
      connection, "tenant-duplicate", "stream-duplicate", "record-stream-duplicate-0",
      0, null, NOW,
    );
    insertInvariantStream(connection, "tenant-duplicate", "stream-duplicate", 0, hash, NOW);
    insertInvariantLease(connection, "tenant-duplicate", "stream-duplicate", 2);
    insertInvariantUsedLease(
      connection, "tenant-duplicate", "stream-duplicate", "lease-duplicate-a", 1, NOW,
    );
    expect(() => insertInvariantUsedLease(
      connection, "tenant-duplicate", "stream-duplicate", "lease-duplicate-b", 1, NOW,
    )).toThrow();
    connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
      (lock_id, lock_epoch, fencing_token, first_used_at_ms)
      VALUES ('lock-duplicate-a', 1, 1, ?)`, "inspect-schema").run(NOW);
    expect(() => connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
      (lock_id, lock_epoch, fencing_token, first_used_at_ms)
      VALUES ('lock-duplicate-b', 1, 1, ?)`, "inspect-schema").run(NOW))
      .toThrow();
    expect(() => connection.prepare(`INSERT INTO ge_cycle_migration_lock
      (singleton, active_lock_id, active_owner_id, active_source_version,
       active_target_version, active_lock_epoch, active_fencing_token,
       active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
       last_fencing_token, updated_at_ms)
      VALUES (2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)`,
    "inspect-schema").run(NOW)).toThrow();
    connection.close();

    const run = sealedForLeaseLockHold();
    try {
      run.connection.prepare(
        `INSERT INTO temp.ge_blr_stage(kind_rank, entry_kind, key_blob, state_blob)
         SELECT kind_rank, entry_kind,
                CAST(json_set(CAST(key_blob AS TEXT), '$.singleton', 2) AS BLOB),
                state_blob
           FROM temp.ge_blr_stage WHERE kind_rank = 9`,
        "inspect-schema",
      ).run();
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write|count|coverage/u);
    } finally {
      close(run);
    }
  });

  it("predecessor campaign reports an empty stream before lease evaluation", () => {
    const connection = opened(NOW);
    insertInvariantStream(connection, "tenant-empty-control", "stream-empty-control", -1, null, NOW);
    insertInvariantLease(connection, "tenant-empty-control", "stream-empty-control", 0);
    insertInvariantHold(connection, "tenant-empty-control", "stream-empty-control", "hold-empty-a");
    insertInvariantHold(connection, "tenant-empty-control", "stream-empty-control", "hold-empty-b");
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const stage = createSQLiteBaselineTempStage(
      connection, proveSQLiteExclusiveBaselineTransaction(connection),
    ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
    const source = captureSQLiteV1BaselineSourceSummary(
      connection, NOW,
    ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
    try {
      stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
      const identity = readSQLiteV1BaselineOrderedTempProjection(connection, source, stage);
      expect(runSQLiteStreamRecordInvariantCampaign(
        connection, identity, stage,
      ).diagnostics).toContainEqual({
        ruleId: "BLR_STREAM_EMPTY", violationCount: 1, diagnosticsTruncated: false,
      });
      expect(runSQLiteCheckpointInvariantCampaign(
        connection, identity, stage,
      ).diagnostics).toEqual([]);
      expect(runSQLiteLeaseLockHoldInvariantCampaign(
        connection, identity, stage,
      ).diagnostics).toEqual([]);
    } finally {
      stage.dispose();
      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("defensively executes rank 6-10 canonical common-binding branches", () => {
    const addStream = (connection: SQLiteConnection, tenant: string, stream: string): void => {
      const hash = insertInvariantRecord(
        connection, tenant, stream, `record-${stream}-0`, 0, null, NOW,
      );
      insertInvariantStream(connection, tenant, stream, 0, hash, NOW);
    };
    const cases: readonly [
      number,
      number,
      string,
      unknown,
      (connection: SQLiteConnection) => void,
    ][] = [
      [6, 2, "$.activeHolderId", "substituted-holder", (connection) => {
        addStream(connection, "tenant-rank6", "stream-rank6");
        insertInvariantLease(connection, "tenant-rank6", "stream-rank6", 1, {
          leaseId: "lease-rank6", holderId: "holder-rank6",
          acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
        });
        insertInvariantUsedLease(
          connection, "tenant-rank6", "stream-rank6", "lease-rank6", 1, NOW - 100,
        );
      }],
      [7, 1, "$.firstUsedAtMs", NOW - 99, (connection) => {
        addStream(connection, "tenant-rank7", "stream-rank7");
        insertInvariantLease(connection, "tenant-rank7", "stream-rank7", 1);
        insertInvariantUsedLease(
          connection, "tenant-rank7", "stream-rank7", "lease-rank7", 1, NOW - 100,
        );
      }],
      [8, 5, "$.placedAtMs", NOW - 1, (connection) => {
        addStream(connection, "tenant-rank8", "stream-rank8");
        insertInvariantHold(connection, "tenant-rank8", "stream-rank8", "hold-rank8");
      }],
      [9, 4, "$.updatedAtMs", NOW - 1, () => {}],
      [10, 3, "$.firstUsedAtMs", NOW - 99, (connection) => {
        connection.prepare(`UPDATE ge_cycle_migration_lock SET
          last_lock_epoch = 1, last_fencing_token = 1, updated_at_ms = ?
          WHERE singleton = 1`, "inspect-schema").run(NOW);
        connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
          (lock_id, lock_epoch, fencing_token, first_used_at_ms)
          VALUES ('lock-rank10', 1, 1, ?)`, "inspect-schema").run(NOW - 100);
      }],
    ];
    for (const [kindRank, ruleIndex, path, value, populate] of cases) {
      const run = sealedLeaseLockHoldSource(populate);
      try {
        expect(run.connection.prepare(
          SQLITE_LEASE_LOCK_HOLD_RULES[ruleIndex]!.sql, "inspect-schema",
        ).all(17)).toEqual([]);
        run.connection.prepare(
          `UPDATE temp.ge_blr_stage
              SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), ?, ?) AS BLOB)
            WHERE kind_rank = ?`,
          "inspect-schema",
        ).run(path, value, kindRank);
        expect(run.connection.prepare(
          SQLITE_LEASE_LOCK_HOLD_RULES[ruleIndex]!.sql, "inspect-schema",
        ).all(17)).toEqual([[1n]]);
      } finally {
        if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
        run.connection.close();
      }
    }
  });

  it("defensively detects clock-only active binding and lock version reversal", () => {
    const leaseRun = sealedLeaseLockHoldSource((connection) => {
      const hash = insertInvariantRecord(
        connection, "tenant-clock", "stream-clock", "record-stream-clock-0",
        0, null, NOW,
      );
      insertInvariantStream(connection, "tenant-clock", "stream-clock", 0, hash, NOW);
      insertInvariantLease(connection, "tenant-clock", "stream-clock", 1, {
        leaseId: "lease-clock", holderId: "holder-clock",
        acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
      });
      insertInvariantUsedLease(
        connection, "tenant-clock", "stream-clock", "lease-clock", 1, NOW - 100,
      );
    });
    try {
      leaseRun.connection.prepare(
        "UPDATE temp.ge_blr_leases SET active_acquired_at_ms = ?",
        "inspect-schema",
      ).run(NOW - 99);
      leaseRun.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), '$.activeAcquiredAtMs', ?) AS BLOB)
          WHERE kind_rank = 6`,
        "inspect-schema",
      ).run(NOW - 99);
      expect(leaseRun.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[2].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      leaseRun.connection.execTrusted("ROLLBACK", "inspect-schema");
      leaseRun.connection.close();
    }

    const lockRun = sealedLeaseLockHoldSource((connection) => {
      connection.prepare(`UPDATE ge_cycle_migration_lock SET
        active_lock_id = 'lock-active', active_owner_id = 'owner-active',
        active_source_version = 1, active_target_version = 2,
        active_lock_epoch = 1, active_fencing_token = 1,
        active_acquired_at_ms = ?, active_expires_at_ms = ?,
        last_lock_epoch = 1, last_fencing_token = 1, updated_at_ms = ?
        WHERE singleton = 1`, "inspect-schema").run(NOW - 100, NOW + 100, NOW);
      connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
        (lock_id, lock_epoch, fencing_token, first_used_at_ms)
        VALUES ('lock-active', 1, 1, ?)`, "inspect-schema").run(NOW - 100);
    });
    try {
      lockRun.connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      lockRun.connection.prepare(
        "UPDATE temp.ge_blr_migration_lock SET active_source_version = 3",
        "inspect-schema",
      ).run();
      lockRun.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), '$.activeSourceVersion', 3) AS BLOB)
          WHERE kind_rank = 9`,
        "inspect-schema",
      ).run();
      expect(lockRun.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[4].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      lockRun.connection.execTrusted("ROLLBACK", "inspect-schema");
      lockRun.connection.close();
    }
  });

  it("kills every active lease null, expiry inversion and negative high-water", () => {
    const run = sealedLeaseLockHoldSource((connection) => {
      const hash = insertInvariantRecord(
        connection, "tenant-tuple", "stream-tuple", "record-stream-tuple-0",
        0, null, NOW,
      );
      insertInvariantStream(connection, "tenant-tuple", "stream-tuple", 0, hash, NOW);
      insertInvariantLease(connection, "tenant-tuple", "stream-tuple", 1, {
        leaseId: "lease-tuple", holderId: "holder-tuple",
        acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
      });
      insertInvariantUsedLease(
        connection, "tenant-tuple", "stream-tuple", "lease-tuple", 1, NOW - 100,
      );
    });
    const columns = [
      ["active_lease_id", "activeLeaseId", "lease-tuple"],
      ["active_holder_id", "activeHolderId", "holder-tuple"],
      ["active_lease_epoch", "activeLeaseEpoch", 1],
      ["active_fencing_token", "activeFencingToken", 1],
      ["active_acquired_at_ms", "activeAcquiredAtMs", NOW - 100],
      ["active_expires_at_ms", "activeExpiresAtMs", NOW + 100],
    ] as const;
    try {
      run.connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      for (const [column, stateField, original] of columns) {
        run.connection.prepare(
          `UPDATE temp.ge_blr_leases SET ${column} = NULL`, "inspect-schema",
        ).run();
        run.connection.prepare(
          `UPDATE temp.ge_blr_stage
              SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), ?, NULL) AS BLOB)
            WHERE kind_rank = 6`,
          "inspect-schema",
        ).run(`$.${stateField}`);
        expect(run.connection.prepare(
          SQLITE_LEASE_LOCK_HOLD_RULES[2].sql, "inspect-schema",
        ).all(17)).toEqual([[1n]]);
        run.connection.prepare(
          `UPDATE temp.ge_blr_leases SET ${column} = ?`, "inspect-schema",
        ).run(original);
        run.connection.prepare(
          `UPDATE temp.ge_blr_stage
              SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), ?, ?) AS BLOB)
            WHERE kind_rank = 6`,
          "inspect-schema",
        ).run(`$.${stateField}`, original);
      }
      run.connection.prepare(
        "UPDATE temp.ge_blr_leases SET active_expires_at_ms = active_acquired_at_ms",
        "inspect-schema",
      ).run();
      run.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), '$.activeExpiresAtMs', ?) AS BLOB)
          WHERE kind_rank = 6`,
        "inspect-schema",
      ).run(NOW - 100);
      expect(run.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[2].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
      run.connection.prepare(
        `UPDATE temp.ge_blr_leases
            SET active_expires_at_ms = ?, last_lease_epoch = -1, last_fencing_token = -1`,
        "inspect-schema",
      ).run(NOW + 100);
      run.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(
              json_set(json_set(CAST(state_blob AS TEXT), '$.activeExpiresAtMs', ?),
                       '$.lastLeaseEpoch', -1), '$.lastFencingToken', -1
            ) AS BLOB)
          WHERE kind_rank = 6`,
        "inspect-schema",
      ).run(NOW + 100);
      expect(run.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[2].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });

  it("rejects retired migration lock ID reuse with complete history", () => {
    const run = sealedLeaseLockHoldSource((connection) => {
      connection.prepare(`UPDATE ge_cycle_migration_lock SET
        active_lock_id = 'lock-reused', active_owner_id = 'owner-reuse',
        active_source_version = 1, active_target_version = 2,
        active_lock_epoch = 2, active_fencing_token = 2,
        active_acquired_at_ms = ?, active_expires_at_ms = ?,
        last_lock_epoch = 2, last_fencing_token = 2, updated_at_ms = ?
        WHERE singleton = 1`, "inspect-schema").run(NOW - 100, NOW + 100, NOW);
      connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
        (lock_id, lock_epoch, fencing_token, first_used_at_ms)
        VALUES ('lock-reused', 1, 1, ?), ('lock-terminal-2', 2, 2, ?)`,
      "inspect-schema").run(NOW - 200, NOW - 100);
    });
    try {
      expect(runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([{
        ruleId: "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
        violationCount: 1,
        diagnosticsTruncated: false,
      }]);
    } finally {
      close(run);
    }
  });

  it("kills every active migration-lock field null with synchronized common drift", () => {
    const run = sealedLeaseLockHoldSource((connection) => {
      connection.prepare(`UPDATE ge_cycle_migration_lock SET
        active_lock_id = 'lock-null', active_owner_id = 'owner-null',
        active_source_version = 1, active_target_version = 2,
        active_lock_epoch = 1, active_fencing_token = 1,
        active_acquired_at_ms = ?, active_expires_at_ms = ?,
        last_lock_epoch = 1, last_fencing_token = 1, updated_at_ms = ?
        WHERE singleton = 1`, "inspect-schema").run(NOW - 100, NOW + 100, NOW);
      connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
        (lock_id, lock_epoch, fencing_token, first_used_at_ms)
        VALUES ('lock-null', 1, 1, ?)`, "inspect-schema").run(NOW - 100);
    });
    const columns = [
      ["active_lock_id", "activeLockId", "lock-null"],
      ["active_owner_id", "activeOwnerId", "owner-null"],
      ["active_source_version", "activeSourceVersion", 1],
      ["active_target_version", "activeTargetVersion", 2],
      ["active_lock_epoch", "activeLockEpoch", 1],
      ["active_fencing_token", "activeFencingToken", 1],
      ["active_acquired_at_ms", "activeAcquiredAtMs", NOW - 100],
      ["active_expires_at_ms", "activeExpiresAtMs", NOW + 100],
    ] as const;
    try {
      run.connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      for (const [column, stateField, original] of columns) {
        run.connection.prepare(
          `UPDATE temp.ge_blr_migration_lock SET ${column} = NULL`, "inspect-schema",
        ).run();
        run.connection.prepare(
          `UPDATE temp.ge_blr_stage
              SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), ?, NULL) AS BLOB)
            WHERE kind_rank = 9`,
          "inspect-schema",
        ).run(`$.${stateField}`);
        expect(run.connection.prepare(
          SQLITE_LEASE_LOCK_HOLD_RULES[4].sql, "inspect-schema",
        ).all(17)).toEqual([[1n]]);
        run.connection.prepare(
          `UPDATE temp.ge_blr_migration_lock SET ${column} = ?`, "inspect-schema",
        ).run(original);
        run.connection.prepare(
          `UPDATE temp.ge_blr_stage
              SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), ?, ?) AS BLOB)
            WHERE kind_rank = 9`,
          "inspect-schema",
        ).run(`$.${stateField}`, original);
      }
      run.connection.prepare(
        "UPDATE temp.ge_blr_migration_lock SET active_expires_at_ms = active_acquired_at_ms",
        "inspect-schema",
      ).run();
      run.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), '$.activeExpiresAtMs', ?) AS BLOB)
          WHERE kind_rank = 9`,
        "inspect-schema",
      ).run(NOW - 100);
      expect(run.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[4].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);

      run.connection.prepare(
        `UPDATE temp.ge_blr_migration_lock
            SET active_expires_at_ms = ?, last_lock_epoch = -1, last_fencing_token = -1`,
        "inspect-schema",
      ).run(NOW + 100);
      run.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(
              json_set(json_set(CAST(state_blob AS TEXT), '$.activeExpiresAtMs', ?),
                       '$.lastLockEpoch', -1), '$.lastFencingToken', -1
            ) AS BLOB)
          WHERE kind_rank = 9`,
        "inspect-schema",
      ).run(NOW + 100);
      expect(run.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[4].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });

  it("kills every rank 6-10 canonical state and key substitution with real SQL", () => {
    const run = sealedLeaseLockHoldSource((connection) => {
      const hash = insertInvariantRecord(
        connection, "tenant-canonical", "stream-canonical", "record-stream-canonical-0",
        0, null, NOW,
      );
      insertInvariantStream(connection, "tenant-canonical", "stream-canonical", 0, hash, NOW);
      insertInvariantLease(connection, "tenant-canonical", "stream-canonical", 1, {
        leaseId: "lease-canonical", holderId: "holder-canonical",
        acquiredAtMs: NOW - 100, expiresAtMs: NOW + 100,
      });
      insertInvariantUsedLease(
        connection, "tenant-canonical", "stream-canonical", "lease-canonical", 1, NOW - 100,
      );
      insertInvariantHold(
        connection, "tenant-canonical", "stream-canonical", "hold-canonical",
      );
      connection.prepare(`UPDATE ge_cycle_migration_lock SET
        active_lock_id = 'lock-canonical', active_owner_id = 'owner-canonical',
        active_source_version = 1, active_target_version = 2,
        active_lock_epoch = 1, active_fencing_token = 1,
        active_acquired_at_ms = ?, active_expires_at_ms = ?,
        last_lock_epoch = 1, last_fencing_token = 1, updated_at_ms = ?
        WHERE singleton = 1`, "inspect-schema").run(NOW - 100, NOW + 100, NOW);
      connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
        (lock_id, lock_epoch, fencing_token, first_used_at_ms)
        VALUES ('lock-canonical', 1, 1, ?)`, "inspect-schema").run(NOW - 100);
    });
    const stateCases = new Map<number, readonly string[]>([
      [6, ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken",
        "activeHolderId", "activeLeaseEpoch", "activeLeaseId", "lastFencingToken",
        "lastLeaseEpoch", "streamId", "tenantId", "updatedAtMs"]],
      [7, ["fencingToken", "firstUsedAtMs", "leaseEpoch", "leaseId", "streamId", "tenantId"]],
      [8, ["holdId", "placedAtMs", "streamId", "tenantId"]],
      [9, ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken",
        "activeLockEpoch", "activeLockId", "activeOwnerId", "activeSourceVersion",
        "activeTargetVersion", "lastFencingToken", "lastLockEpoch", "singleton", "updatedAtMs"]],
      [10, ["fencingToken", "firstUsedAtMs", "lockEpoch", "lockId"]],
    ]);
    const keyCases = new Map<number, readonly string[]>([
      [6, ["tenantId", "streamId"]],
      [7, ["tenantId", "streamId", "leaseId"]],
      [8, ["tenantId", "streamId", "holdId"]],
      [9, ["singleton"]],
      [10, ["lockId"]],
    ]);
    const ruleByRank = new Map([[6, 2], [7, 1], [8, 5], [9, 4], [10, 3]]);
    try {
      for (const [kindRank, fields] of stateCases) {
        const rule = SQLITE_LEASE_LOCK_HOLD_RULES[ruleByRank.get(kindRank)!]!;
        const original = run.connection.prepare(
          "SELECT state_blob FROM temp.ge_blr_stage WHERE kind_rank = ? LIMIT 1",
          "inspect-schema",
        ).get(kindRank) as unknown as readonly [Uint8Array];
        for (const field of fields) {
          run.connection.prepare(
            `UPDATE temp.ge_blr_stage
                SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), ?, ?) AS BLOB)
              WHERE kind_rank = ?`,
            "inspect-schema",
          ).run(`$.${field}`, field.includes("Id") ? `substituted-${field}` : 7, kindRank);
          const rows = run.connection.prepare(rule.sql, "inspect-schema").all(17);
          expect(rows.length).toBeGreaterThan(0);
          expect(rows.every((row) => (row as unknown as readonly unknown[])[0] === 1n)).toBe(true);
          run.connection.prepare(
            "UPDATE temp.ge_blr_stage SET state_blob = ? WHERE kind_rank = ?",
            "inspect-schema",
          ).run(original[0], kindRank);
        }
      }
      for (const [kindRank, fields] of keyCases) {
        const rule = SQLITE_LEASE_LOCK_HOLD_RULES[ruleByRank.get(kindRank)!]!;
        const original = run.connection.prepare(
          "SELECT key_blob FROM temp.ge_blr_stage WHERE kind_rank = ? LIMIT 1",
          "inspect-schema",
        ).get(kindRank) as unknown as readonly [Uint8Array];
        for (const field of fields) {
          run.connection.prepare(
            `UPDATE temp.ge_blr_stage
                SET key_blob = CAST(json_set(CAST(key_blob AS TEXT), ?, ?) AS BLOB)
              WHERE kind_rank = ?`,
            "inspect-schema",
          ).run(`$.${field}`, field === "singleton" ? 2 : `substituted-${field}`, kindRank);
          expect(run.connection.prepare(rule.sql, "inspect-schema").all(17).length)
            .toBeGreaterThan(0);
          run.connection.prepare(
            "UPDATE temp.ge_blr_stage SET key_blob = ? WHERE kind_rank = ?",
            "inspect-schema",
          ).run(original[0], kindRank);
        }
      }
      run.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(
              json_set(CAST(state_blob AS TEXT), '$.activeHolderId', 'multi-holder'),
              '$.updatedAtMs', 7
            ) AS BLOB)
          WHERE kind_rank = 6`,
        "inspect-schema",
      ).run();
      expect(run.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[2].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });

  it("defends partial inactive tuples, missing singleton and one-unit domain collapse", () => {
    const partial = sealedLeaseLockHoldSource((connection) => {
      const hash = insertInvariantRecord(
        connection, "tenant-inactive", "stream-inactive", "record-stream-inactive-0",
        0, null, NOW,
      );
      insertInvariantStream(connection, "tenant-inactive", "stream-inactive", 0, hash, NOW);
      insertInvariantLease(connection, "tenant-inactive", "stream-inactive", 0);
    });
    try {
      partial.connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      partial.connection.prepare(
        "UPDATE temp.ge_blr_leases SET active_holder_id = 'partial-holder'",
        "inspect-schema",
      ).run();
      partial.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), '$.activeHolderId', 'partial-holder') AS BLOB)
          WHERE kind_rank = 6`,
        "inspect-schema",
      ).run();
      expect(partial.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[2].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      partial.connection.execTrusted("ROLLBACK", "inspect-schema");
      partial.connection.close();
    }

    const missing = sealedForLeaseLockHold();
    try {
      missing.connection.prepare(
        "DELETE FROM temp.ge_blr_migration_lock", "inspect-schema",
      ).run();
      missing.connection.prepare(
        "DELETE FROM temp.ge_blr_stage WHERE kind_rank = 9", "inspect-schema",
      ).run();
      expect(missing.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[3].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
      expect(missing.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[4].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      missing.connection.execTrusted("ROLLBACK", "inspect-schema");
      missing.connection.close();
    }

    const collapsed = sealedLeaseLockHoldSource((connection) => {
      const hash = insertInvariantRecord(
        connection, "tenant-collapse", "stream-collapse", "record-stream-collapse-0",
        0, null, NOW,
      );
      insertInvariantStream(connection, "tenant-collapse", "stream-collapse", 0, hash, NOW);
      insertInvariantLease(connection, "tenant-collapse", "stream-collapse", 2);
      insertInvariantUsedLease(
        connection, "tenant-collapse", "stream-collapse", "lease-collapse-1", 1, NOW - 100,
      );
      insertInvariantUsedLease(
        connection, "tenant-collapse", "stream-collapse", "lease-collapse-2", 2, NOW - 100,
      );
    });
    try {
      collapsed.connection.prepare(
        `UPDATE temp.ge_blr_stage
            SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), '$.firstUsedAtMs', 7) AS BLOB)
          WHERE kind_rank = 7`,
        "inspect-schema",
      ).run();
      expect(collapsed.connection.prepare(
        SQLITE_LEASE_LOCK_HOLD_RULES[1].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      collapsed.connection.execTrusted("ROLLBACK", "inspect-schema");
      collapsed.connection.close();
    }
  });

  it("returns a deeply frozen empty report for the valid zero-history state", () => {
    const run = sealedForLeaseLockHold();
    try {
      const report = runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      );
      expect(report).toEqual({ projectionIdentity: run.projectionIdentity, diagnostics: [] });
      expect(report.projectionIdentity).toBe(run.projectionIdentity);
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.diagnostics)).toBe(true);
      expect(Object.keys(report)).toEqual(["projectionIdentity", "diagnostics"]);
    } finally {
      close(run);
    }
  });

  it("keeps the exact six-rule registry order and bounded marker SQL", () => {
    expect(SQLITE_LEASE_LOCK_HOLD_RULES.map((rule) => rule.ruleId)).toEqual([
      "BLR_LEASE_STREAM_MISSING",
      "BLR_LEASE_HISTORY_INCOMPLETE",
      "BLR_LEASE_ACTIVE_BINDING",
      "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE",
      "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
      "BLR_HOLD_STREAM_MISSING",
    ]);
    expect(Object.isFrozen(SQLITE_LEASE_LOCK_HOLD_RULES)).toBe(true);
    expect(SQLITE_LEASE_LOCK_HOLD_RULES.every(Object.isFrozen)).toBe(true);
    expect(SQLITE_LEASE_LOCK_HOLD_RULES.every((rule) => rule.sql.endsWith("LIMIT ?"))).toBe(true);
  });

  it("uses every frozen epoch index with only the allowed lease-domain GROUP", () => {
    const run = sealedForLeaseLockHold();
    try {
      const plans = new Map(SQLITE_LEASE_LOCK_HOLD_RULES.map((rule) => [
        rule.ruleId,
        run.connection.prepare(
          `EXPLAIN QUERY PLAN ${rule.sql}`, "inspect-schema",
        ).all(17).map((row) => String((row as unknown as readonly unknown[])[3])),
      ]));
      for (const ruleId of [
        "BLR_LEASE_HISTORY_INCOMPLETE", "BLR_LEASE_ACTIVE_BINDING",
      ]) expect(plans.get(ruleId)?.join("\n")).toContain("ge_blr_used_leases_epoch_uidx");
      for (const ruleId of [
        "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE", "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
      ]) expect(plans.get(ruleId)?.join("\n"))
        .toContain("ge_blr_used_migration_locks_epoch_uidx");
      const allPlanDetails = [...plans.values()].flat();
      expect(allPlanDetails.some((detail) => detail.includes("MATERIALIZE"))).toBe(false);
      expect(allPlanDetails.some((detail) => detail.includes("AUTOMATIC"))).toBe(false);
      expect(plans.get("BLR_LEASE_HISTORY_INCOMPLETE")
        ?.filter((detail) => detail.includes("USE TEMP B-TREE"))).toEqual([
        "USE TEMP B-TREE FOR GROUP BY",
      ]);
      for (const ruleId of [
        "BLR_LEASE_STREAM_MISSING", "BLR_LEASE_ACTIVE_BINDING",
        "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE", "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
        "BLR_HOLD_STREAM_MISSING",
      ]) expect(plans.get(ruleId)?.some((detail) => detail.includes("USE TEMP B-TREE")))
        .toBe(false);
    } finally {
      close(run);
    }
  });

  it("requires successful checkpoint completion before opening the campaign", () => {
    const run = sealedForCheckpoint(false);
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/binding/u);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("rejects count-preserving mutation and index delete/recreate at begin", () => {
    const mutated = sealedForLeaseLockHold();
    try {
      mutated.connection.prepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 9",
        "inspect-schema",
      ).run();
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        mutated.connection, mutated.projectionIdentity, mutated.stage,
      )).toThrow(/unexplained write/u);
    } finally {
      close(mutated);
    }

    const replaced = sealedForLeaseLockHold();
    try {
      replaced.connection.execTrusted(
        "DROP INDEX temp.ge_blr_used_leases_epoch_uidx", "inspect-schema",
      );
      replaced.connection.execTrusted(
        "CREATE UNIQUE INDEX ge_blr_used_leases_epoch_uidx ON ge_blr_used_leases(tenant_id, stream_id, lease_id)",
        "inspect-schema",
      );
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        replaced.connection, replaced.projectionIdentity, replaced.stage,
      )).toThrow(/transaction changed|catalog|unexplained write/u);
    } finally {
      close(replaced);
    }

    const tableReplaced = sealedForLeaseLockHold();
    try {
      tableReplaced.connection.execTrusted(
        "DROP TABLE temp.ge_blr_holds", "inspect-schema",
      );
      tableReplaced.connection.execTrusted(
        "CREATE TEMP TABLE ge_blr_holds(key_blob BLOB)", "inspect-schema",
      );
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        tableReplaced.connection, tableReplaced.projectionIdentity, tableReplaced.stage,
      )).toThrow(/transaction changed|catalog|unexplained write/u);
    } finally {
      close(tableReplaced);
    }
  });

  it("re-proves common counts and relation coverage at begin and completion", () => {
    const run = sealedForLeaseLockHold();
    const common = vi.spyOn(run.stage, "assertCommonCounts");
    const coverage = vi.spyOn(run.stage, "assertRelationKeyCoverage");
    try {
      expect(runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([]);
      expect(common).toHaveBeenCalledTimes(2);
      expect(coverage).toHaveBeenCalledTimes(2);
    } finally {
      coverage.mockRestore();
      common.mockRestore();
      close(run);
    }
  });

  it.each([1, 16, 64])(
    "distinguishes exact lease/lock/hold limit from limit+1 at %i",
    (limit) => {
      for (const extra of [0, 1]) {
        const run = sealedForLeaseLockHold();
        const target = SQLITE_LEASE_LOCK_HOLD_RULES[5];
        const originalPrepare = run.connection.prepare.bind(run.connection);
        const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
          (sql, operation) => sql === target.sql
            ? ({
              iterate: () => Array.from({ length: limit + extra }, () => [1n]).values(),
            } as never)
            : originalPrepare(sql, operation),
        );
        try {
          expect(runSQLiteLeaseLockHoldInvariantCampaign(
            run.connection, run.projectionIdentity, run.stage, { diagnosticLimit: limit },
          ).diagnostics).toEqual([{
            ruleId: "BLR_HOLD_STREAM_MISSING",
            violationCount: limit,
            diagnosticsTruncated: extra === 1,
          }]);
        } finally {
          prepare.mockRestore();
          close(run);
        }
      }
    },
  );

  it.each([null, [], false, { diagnosticLimit: null }, { diagnosticLimit: 0 },
    { diagnosticLimit: 65 }, { unknown: 1 }])(
    "rejects hostile lease/lock/hold options before ownership burn: %j",
    (options) => {
      const run = sealedForLeaseLockHold();
      try {
        expect(() => new SQLiteLeaseLockHoldInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage, options as never,
        )).toThrow(CycleStoreProviderError);
        expect(runSQLiteLeaseLockHoldInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([]);
      } finally {
        close(run);
      }
    },
  );

  it("rejects hidden, symbol and accessor options without invoking getters", () => {
    const hidden = {};
    Object.defineProperty(hidden, "hidden", { value: 1 });
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, "diagnosticLimit", {
      enumerable: true,
      get: () => { getterCalls += 1; return 16; },
    });
    for (const options of [hidden, { [Symbol("hidden")]: 1 }, accessor]) {
      const run = sealedForLeaseLockHold();
      try {
        expect(() => new SQLiteLeaseLockHoldInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage, options,
        )).toThrow(CycleStoreProviderError);
        expect(runSQLiteLeaseLockHoldInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([]);
      } finally {
        close(run);
      }
    }
    expect(getterCalls).toBe(0);
  });

  it("rejects malformed marker rows without retaining identity", () => {
    for (const hostileRow of [[0n], [2n], ["tenant-secret"], [1n, "tenant-secret"]]) {
      const run = sealedForLeaseLockHold();
      const target = SQLITE_LEASE_LOCK_HOLD_RULES[0];
      const originalPrepare = run.connection.prepare.bind(run.connection);
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => sql === target.sql
          ? ({ iterate: () => [hostileRow].values() } as never)
          : originalPrepare(sql, operation),
      );
      try {
        expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        )).toThrow(CycleStoreProviderError);
        expect(run.stage.state).toBe("poisoned");
      } finally {
        prepare.mockRestore();
        close(run);
      }
    }
  });

  it("rejects an equal-content identity clone, second run and abandonment", () => {
    const clone = sealedForLeaseLockHold();
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        clone.connection, Object.freeze({ ...clone.projectionIdentity }), clone.stage,
      )).toThrow(/binding/u);
      expect(clone.stage.state).toBe("poisoned");
    } finally {
      close(clone);
    }

    const completed = sealedForLeaseLockHold();
    try {
      const campaign = new SQLiteLeaseLockHoldInvariantCampaign(
        completed.connection, completed.projectionIdentity, completed.stage,
      );
      expect(campaign.run().diagnostics).toEqual([]);
      expect(() => campaign.run()).toThrow(/one-shot/u);
    } finally {
      close(completed);
    }

    const abandoned = sealedForLeaseLockHold();
    try {
      const campaign = new SQLiteLeaseLockHoldInvariantCampaign(
        abandoned.connection, abandoned.projectionIdentity, abandoned.stage,
      );
      expect(() => campaign.dispose()).toThrow(/abandoned/u);
      expect(campaign.state).toBe("poisoned");
    } finally {
      close(abandoned);
    }
  });

  it.each(SQLITE_LEASE_LOCK_HOLD_RULES)(
    "detects DML after $ruleId cursor creation before first fetch",
    (target) => {
      const run = sealedForLeaseLockHold();
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let returns = 0;
      const iterator: Iterator<unknown> & Iterable<unknown> = {
        [Symbol.iterator]() { return this; },
        next: () => ({ done: true, value: undefined }),
        return: () => { returns += 1; return { done: true, value: undefined }; },
      };
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => sql === target.sql
          ? ({
            iterate: () => {
              run.connection.prepare(
                "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
                "inspect-schema",
              ).run();
              return iterator;
            },
          } as never)
          : originalPrepare(sql, operation),
      );
      try {
        expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        )).toThrow(/unexplained write/u);
        expect(returns).toBe(1);
      } finally {
        prepare.mockRestore();
        close(run);
      }
    },
  );

  it.each(SQLITE_LEASE_LOCK_HOLD_RULES)(
    "detects DML during $ruleId marker fetch and finalizes once",
    (target) => {
      const run = sealedForLeaseLockHold();
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let returns = 0;
      const iterator: Iterator<unknown> & Iterable<unknown> = {
        [Symbol.iterator]() { return this; },
        next: () => {
          run.connection.prepare(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            "inspect-schema",
          ).run();
          return { done: true, value: undefined };
        },
        return: () => { returns += 1; return { done: true, value: undefined }; },
      };
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => sql === target.sql
          ? ({ iterate: () => iterator } as never)
          : originalPrepare(sql, operation),
      );
      try {
        expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        )).toThrow(/unexplained write/u);
        expect(returns).toBe(1);
      } finally {
        prepare.mockRestore();
        close(run);
      }
    },
  );

  it.each(SQLITE_LEASE_LOCK_HOLD_RULES)("detects DML during $ruleId cursor close", (target) => {
    const run = sealedForLeaseLockHold();
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => ({ done: true, value: undefined }),
      return: () => {
        returns += 1;
        run.connection.prepare(
          "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
          "inspect-schema",
        ).run();
        return { done: true, value: undefined };
      },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(returns).toBe(1);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects catalog replacement during grouped history evaluation", () => {
    const run = sealedForLeaseLockHold();
    const target = SQLITE_LEASE_LOCK_HOLD_RULES[1];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.connection.execTrusted(
          "DROP INDEX temp.ge_blr_used_leases_epoch_uidx", "inspect-schema",
        );
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/transaction changed|catalog/u);
      expect(returns).toBe(1);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects DML after diagnostic emission and before the next rule", () => {
    const run = sealedForLeaseLockHold();
    const target = SQLITE_LEASE_LOCK_HOLD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    const originalFence = run.stage[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN]
      .bind(run.stage);
    let closed = false;
    let closedFences = 0;
    let emitted = false;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => emitted
        ? { done: true, value: undefined }
        : (emitted = true, { done: false, value: [1n] }),
      return: () => { closed = true; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    const fence = vi.spyOn(
      run.stage, SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN,
    ).mockImplementation((session) => {
      if (closed) {
        closedFences += 1;
        if (closedFences === 3) {
          run.connection.prepare(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            "inspect-schema",
          ).run();
        }
      }
      originalFence(session);
    });
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
      expect(closedFences).toBe(3);
    } finally {
      fence.mockRestore();
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects DML at terminal completion", () => {
    const run = sealedForLeaseLockHold();
    const originalComplete = run.stage[SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN]
      .bind(run.stage);
    const complete = vi.spyOn(
      run.stage, SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN,
    ).mockImplementation((session) => {
      run.connection.prepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        "inspect-schema",
      ).run();
      originalComplete(session);
    });
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(/unexplained write/u);
    } finally {
      complete.mockRestore();
      close(run);
    }
  });

  it("preserves primary failure over cleanup failure", () => {
    const run = sealedForLeaseLockHold();
    const target = SQLITE_LEASE_LOCK_HOLD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => { throw new Error("authoritative lease failure"); },
      return: () => { returns += 1; throw new Error("secondary cleanup failure"); },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline lease/lock/hold campaign failed");
      expect(returns).toBe(1);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("surfaces cleanup-only iterator close failure", () => {
    const run = sealedForLeaseLockHold();
    const target = SQLITE_LEASE_LOCK_HOLD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => ({ done: true, value: undefined }),
      return: () => { returns += 1; throw new Error("cleanup-only failure"); },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline lease/lock/hold campaign failed");
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("active stage disposal finalizes the cursor once and removes every TEMP object", () => {
    const run = sealedForLeaseLockHold();
    const target = SQLITE_LEASE_LOCK_HOLD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.stage.dispose();
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(returns).toBe(1);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
        "inspect-schema",
      ).get()).toEqual([0n]);
    } finally {
      prepare.mockRestore();
      if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });

  it("active stage disposal surfaces its cursor cleanup failure after catalog removal", () => {
    const run = sealedForLeaseLockHold();
    const target = SQLITE_LEASE_LOCK_HOLD_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.stage.dispose();
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; throw new Error("active cleanup failure"); },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLeaseLockHoldInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline lease/lock/hold campaign failed");
      expect(returns).toBe(1);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
        "inspect-schema",
      ).get()).toEqual([0n]);
    } finally {
      prepare.mockRestore();
      if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });
});

function sealedLegacySource(
  populate?: (connection: SQLiteConnection) => void,
  allowPredecessorDiagnostics = false,
): Sealed {
  const connection = opened(NOW);
  populate?.(connection);
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  const stage = createSQLiteBaselineTempStage(
    connection, proveSQLiteExclusiveBaselineTransaction(connection),
  ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
  const source = captureSQLiteV1BaselineSourceSummary(
    connection, NOW,
  ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
  const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
    connection, source, stage,
  );
  runSQLiteStreamRecordInvariantCampaign(connection, projectionIdentity, stage);
  runSQLiteCheckpointInvariantCampaign(connection, projectionIdentity, stage);
  const predecessor = runSQLiteLeaseLockHoldInvariantCampaign(
    connection, projectionIdentity, stage,
  );
  if (!allowPredecessorDiagnostics) {
    expect(predecessor.diagnostics).toEqual([]);
  }
  return { connection, source, stage, projectionIdentity };
}

function sealedForLegacy(withLegacy = true): Sealed {
  return sealedLegacySource(withLegacy ? (connection) => {
    seedEverySourceFamily(connection);
    activatePristineMigrationLock(connection);
  } : undefined);
}

type LegacySafeEvolution =
  | "append-later-head"
  | "checkpoint-delete-recreate"
  | "lease-later-acquisition"
  | "lease-same-tenant-ambiguous"
  | "lease-current-nonbinding"
  | "lock-later-acquisition";

function seedLegacySafeEvolution(
  connection: SQLiteConnection,
  evolution: LegacySafeEvolution,
): void {
  seedAllLegacyOperationResults(connection);
  switch (evolution) {
    case "append-later-head": {
      const [previousRecordHash] = connection.prepare(`SELECT record_hash
        FROM ge_cycle_records
        WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a' AND sequence = 0`,
      "inspect-schema").get() as unknown as readonly [string];
      const recordHash = insertInvariantRecord(
        connection, "tenant-a", "stream-a", "record-a-1", 1, previousRecordHash,
      );
      connection.prepare(`UPDATE ge_cycle_streams
        SET tail_sequence = 1, tail_record_hash = ?
        WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'`,
      "inspect-schema").run(recordHash);
      break;
    }
    case "checkpoint-delete-recreate":
      insertInvariantCheckpointRevision(
        connection, "tenant-a", "scope-a", 2, "checkpoint-a", NOW,
      );
      connection.prepare(`INSERT INTO ge_cycle_checkpoint_revisions
        SELECT tenant_id, checkpoint_scope, 3, checkpoint_id, action,
               summary_blob, bound_sequence, bound_record_hash,
               checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
        FROM ge_cycle_checkpoint_revisions
        WHERE tenant_id = 'tenant-a' AND checkpoint_scope = 'scope-a'
          AND revision = 1`, "inspect-schema").run();
      connection.prepare(`UPDATE ge_cycle_checkpoints
        SET checkpoint_revision = 3
        WHERE tenant_id = 'tenant-a' AND checkpoint_scope = 'scope-a'
          AND checkpoint_id = 'checkpoint-a'`, "inspect-schema").run();
      break;
    case "lease-later-acquisition":
      insertInvariantUsedLease(
        connection, "tenant-a", "stream-a", "lease-later", 2, NOW,
      );
      connection.prepare(`UPDATE ge_cycle_leases
        SET active_lease_id = 'lease-later', active_holder_id = 'holder-later',
            active_lease_epoch = 2, active_fencing_token = 2,
            active_acquired_at_ms = ?, active_expires_at_ms = ?,
            last_lease_epoch = 2, last_fencing_token = 2, updated_at_ms = ?
        WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'`,
      "inspect-schema").run(NOW, NOW + 2_000, NOW);
      break;
    case "lease-same-tenant-ambiguous": {
      insertInvariantStream(connection, "tenant-a", "stream-b", -1, null);
      const recordHash = insertInvariantRecord(
        connection, "tenant-a", "stream-b", "record-b-0", 0, null,
      );
      connection.prepare(`UPDATE ge_cycle_streams
        SET tail_sequence = 0, tail_record_hash = ?
        WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-b'`,
      "inspect-schema").run(recordHash);
      insertInvariantLease(connection, "tenant-a", "stream-b", 1, {
        leaseId: "lease-a",
        holderId: "holder-other",
        acquiredAtMs: NOW,
        expiresAtMs: NOW + 5_000,
      });
      insertInvariantUsedLease(
        connection, "tenant-a", "stream-b", "lease-a", 1, NOW,
      );
      break;
    }
    case "lease-current-nonbinding":
      connection.prepare(`UPDATE ge_cycle_leases
        SET active_holder_id = 'holder-renewed', active_expires_at_ms = ?
        WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'`,
      "inspect-schema").run(NOW + 5_000);
      break;
    case "lock-later-acquisition":
      connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
        (lock_id, lock_epoch, fencing_token, first_used_at_ms)
        VALUES ('lock-later', 2, 2, ?)`, "inspect-schema").run(NOW);
      connection.prepare(`UPDATE ge_cycle_migration_lock
        SET active_lock_id = 'lock-later', active_owner_id = 'owner-later',
            active_source_version = 2, active_target_version = 3,
            active_lock_epoch = 2, active_fencing_token = 2,
            active_acquired_at_ms = ?, active_expires_at_ms = ?,
            last_lock_epoch = 2, last_fencing_token = 2, updated_at_ms = ?
        WHERE singleton = 1`, "inspect-schema").run(NOW, NOW + 2_000, NOW);
      break;
  }
}

describe("SQLite legacy invariant campaign", () => {
  it("reports the exact shared hostile legacy vector and projection identity", () => {
    const run = sealedLegacySource(seedHostileLegacyOperationResults);
    try {
      expect(run.projectionIdentity).toEqual({
        baselineId: "v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af",
        entryCount: 28,
        legacyOperationCount: 17,
        firstEntryHash: "f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c",
        finalEntryHash: "85cc900b39b8631815f5631aa13711a9ef152f88e91793bb771f0be85b1a55e2",
        projectionSha256: "a23da0ae704c5d1414fd55950ff1f306eeffb8d5408340dbe713e2fa02b72647",
      });
      const report = runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      );
      expect(report.diagnostics).toEqual([
        { ruleId: "BLR_LEGACY_APPEND_BINDING", violationCount: 2, diagnosticsTruncated: false },
        { ruleId: "BLR_LEGACY_CHECKPOINT_BINDING", violationCount: 2, diagnosticsTruncated: false },
        { ruleId: "BLR_LEGACY_LEASE_BINDING", violationCount: 3, diagnosticsTruncated: false },
        { ruleId: "BLR_LEGACY_LOCK_BINDING", violationCount: 2, diagnosticsTruncated: false },
      ]);
      expect(SQLITE_LEGACY_RULES.map((rule) =>
        report.diagnostics.find((item) => item.ruleId === rule.ruleId)?.violationCount ?? 0,
      )).toEqual([0, 2, 2, 3, 2]);
    } finally {
      close(run);
    }
  });

  it("keeps the frozen five-rule order and marker-only SQL surface", () => {
    expect(SQLITE_LEGACY_RULES.map((rule) => rule.ruleId)).toEqual([
      "BLR_LEGACY_INVENTORY",
      "BLR_LEGACY_APPEND_BINDING",
      "BLR_LEGACY_CHECKPOINT_BINDING",
      "BLR_LEGACY_LEASE_BINDING",
      "BLR_LEGACY_LOCK_BINDING",
    ]);
    expect(SQLITE_LEGACY_RULES.map((rule) => rule.requiredIndexes)).toEqual([
      [],
      ["ge_blr_records_tenant_hash_uidx", "ge_blr_records_stream_sequence_uidx"],
      ["ge_blr_checkpoint_revisions_latest_idx"],
      ["ge_blr_used_leases_epoch_uidx"],
      [],
    ]);
    for (const rule of SQLITE_LEGACY_RULES) {
      expect(rule.sql.trimStart().startsWith("SELECT 1")).toBe(true);
      expect(rule.sql).toMatch(/LIMIT \?$/);
      expect(rule.sql).not.toMatch(/\b(?:source\.)?result_blob\b/i);
      expect(rule.sql).not.toMatch(/json_extract\([^)]*result/i);
    }
    expect(SQLITE_LEGACY_RULES.map((rule) => createHash("sha256")
      .update(rule.sql.replace(/\s+/gu, " ").trim())
      .digest("hex"))).toEqual([
      "47955bd3ba75cbfd515d95cff82dd28213d956818e06a597e07a7376a7874f46",
      "c18ddc48822f41fa3e6dcafcbdfbb26aed83f9ebcb135c959d5bf32fd0c3b055",
      "46a86173db67c4a6e573d68c5bfdf4a8b886862f16857a1c538cbe953ab1ca4d",
      "619daa1f02963c6a4ef58331db5157ed2f8a95aa0f99cc3add27e2063f541212",
      "14ac5f2c3bf01c7b3ac6744b209bded53e7e3001ab94084431a1b92f0f782247",
    ]);
  });

  it("accepts a staged legacy inventory operation without inventing a hold target", () => {
    const run = sealedForLegacy(true);
    try {
      expect(run.projectionIdentity.legacyOperationCount).toBe(1);
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toEqual({ projectionIdentity: run.projectionIdentity, diagnostics: [] });
    } finally {
      close(run);
    }
  });

  it("accepts the complete nine-operation recoverability matrix", () => {
    const run = sealedLegacySource(seedAllLegacyOperationResults);
    try {
      expect(run.projectionIdentity).toEqual({
        baselineId: "v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af",
        entryCount: 20,
        legacyOperationCount: 9,
        firstEntryHash: "f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c",
        finalEntryHash: "7438000be18c081b0fd1eff96b3f4c9736dca1b6873285de6f2140d1f2e3bf46",
        projectionSha256: "459ecad40c2ed54c59c38bb3fecbabfc71694bdf4f59f1eebbdae749fbb9dd62",
      });
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([]);
    } finally {
      close(run);
    }
  });

  it.each([
    "append-later-head",
    "checkpoint-delete-recreate",
    "lease-later-acquisition",
    "lease-same-tenant-ambiguous",
    "lease-current-nonbinding",
    "lock-later-acquisition",
  ] as const)("does not strengthen safe historical recoverability for %s", (evolution) => {
    const run = sealedLegacySource((connection) => {
      seedLegacySafeEvolution(connection, evolution);
    });
    try {
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([]);
    } finally {
      close(run);
    }
  });

  it("executes every recoverability rule against real staged operations", () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const acquiredAt = new Date(NOW).toISOString();
    const expiresAt = new Date(NOW + 1_000).toISOString();
    const cases: readonly [
      "BLR_LEGACY_APPEND_BINDING"
        | "BLR_LEGACY_CHECKPOINT_BINDING"
        | "BLR_LEGACY_LEASE_BINDING"
        | "BLR_LEGACY_LOCK_BINDING",
      (connection: SQLiteConnection) => void,
    ][] = [
      ["BLR_LEGACY_APPEND_BINDING", (connection) => {
        insertLegacyOperation(connection, "missing-append", "append", {
          appendedRecords: 1,
          tail: { exists: true, sequence: 0, recordHash: hashA },
        });
      }],
      ["BLR_LEGACY_CHECKPOINT_BINDING", (connection) => {
        insertLegacyOperation(connection, "missing-save", "save-checkpoint", {
          boundRecordHash: hashA, boundSequence: 0,
          checkpointId: "checkpoint-missing", checkpointScope: "scope-missing",
          createdAt: acquiredAt, streamId: "stream-missing",
          valueBytes: 2, valueHash: hashB,
        });
      }],
      ["BLR_LEGACY_CHECKPOINT_BINDING", (connection) => {
        insertLegacyOperation(connection, "missing-delete", "delete-checkpoint", { deleted: true });
      }],
      ["BLR_LEGACY_LEASE_BINDING", (connection) => {
        insertLegacyOperation(connection, "missing-acquire", "acquire-lease", {
          acquiredAt, expiresAt, fencingToken: 1, holderId: "holder-missing",
          leaseEpoch: 1, leaseId: "lease-missing",
        });
      }],
      ["BLR_LEGACY_LEASE_BINDING", (connection) => {
        insertLegacyOperation(connection, "missing-release", "release-lease", {
          status: "released", lease: null, lastLeaseEpoch: 1, lastFencingToken: 1,
        });
      }],
      ["BLR_LEGACY_LOCK_BINDING", (connection) => {
        insertLegacyOperation(connection, "missing-lock", "acquire-migration-lock", {
          acquiredAt, expiresAt, fencingToken: 1, lockEpoch: 1,
          lockId: "lock-missing", ownerId: "owner-missing",
          sourceSchemaVersion: 1, targetSchemaVersion: 2,
        });
      }],
    ];
    for (const [ruleId, populate] of cases) {
      const run = sealedLegacySource(populate);
      try {
        expect(runSQLiteLegacyInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([{
          ruleId, violationCount: 1, diagnosticsTruncated: false,
        }]);
      } finally {
        close(run);
      }
    }
  });

  it("detects relation-only, common-only, and main-only inventory units", () => {
    for (const orphan of ["relation", "common", "main"] as const) {
      const run = sealedForLegacy(true);
      try {
        if (orphan !== "relation") {
          run.connection.prepare(
            "DELETE FROM temp.ge_blr_legacy_operations WHERE operation_id = 'operation-a'",
            "inspect-schema",
          ).run();
        }
        if (orphan !== "common") {
          run.connection.prepare(
            "DELETE FROM temp.ge_blr_stage WHERE kind_rank = 11",
            "inspect-schema",
          ).run();
        }
        if (orphan !== "main") {
          run.connection.prepare(
            "DELETE FROM main.ge_cycle_operations WHERE operation_id = 'operation-a'",
            "inspect-schema",
          ).run();
        }
        expect(run.connection.prepare(
          SQLITE_LEGACY_RULES[0].sql, "inspect-schema",
        ).all(17)).toEqual([[1n]]);
      } finally {
        close(run);
      }
    }
  });

  it("counts a relation key substitution as one inventory unit", () => {
    const run = sealedForLegacy(true);
    try {
      run.connection.prepare(`UPDATE temp.ge_blr_legacy_operations
        SET key_blob = CAST(json_set(CAST(key_blob AS TEXT),
            '$.operationId', 'operation-substituted') AS BLOB)
        WHERE operation_id = 'operation-a'`, "inspect-schema").run();
      expect(run.connection.prepare(
        SQLITE_LEGACY_RULES[0].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      close(run);
    }
  });

  it("truncates by operation units without collecting application rows", () => {
    const run = sealedLegacySource((connection) => {
      for (let index = 0; index < 3; index += 1) {
        insertLegacyOperation(connection, `missing-append-${index}`, "append", {
          appendedRecords: 1,
          tail: { exists: true, sequence: index, recordHash: `${index + 1}`.repeat(64) },
        });
      }
    });
    try {
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage, { diagnosticLimit: 2 },
      ).diagnostics).toEqual([{
        ruleId: "BLR_LEGACY_APPEND_BINDING",
        violationCount: 2,
        diagnosticsTruncated: true,
      }]);
    } finally {
      close(run);
    }
  });

  it.each([1, 16, 64])(
    "distinguishes exact and limit+1 witness counts at limit %i",
    (limit) => {
      for (const extra of [0, 1]) {
        const run = sealedForLegacy(false);
        const target = SQLITE_LEGACY_RULES[4];
        const originalPrepare = run.connection.prepare.bind(run.connection);
        const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
          (sql, operation) => sql === target.sql
            ? ({ iterate: () => Array.from({ length: limit + extra }, () => [1n]).values() } as never)
            : originalPrepare(sql, operation),
        );
        try {
          expect(runSQLiteLegacyInvariantCampaign(
            run.connection, run.projectionIdentity, run.stage, { diagnosticLimit: limit },
          ).diagnostics).toEqual([{
            ruleId: target.ruleId,
            violationCount: limit,
            diagnosticsTruncated: extra === 1,
          }]);
        } finally {
          prepare.mockRestore();
          close(run);
        }
      }
    },
  );

  it("keeps every frozen SQL plan free of automatic indexes and materialization", () => {
    const run = sealedLegacySource(seedAllLegacyOperationResults);
    try {
      for (const rule of SQLITE_LEGACY_RULES) {
        expect(Object.isFrozen(rule.requiredIndexes)).toBe(true);
        const details = run.connection.prepare(
          `EXPLAIN QUERY PLAN ${rule.sql}`, "inspect-schema",
        ).all(17).map((raw) => String((raw as unknown as readonly unknown[])[3]));
        const joined = details.join("\n");
        expect(joined, rule.ruleId).not.toMatch(/AUTOMATIC|MATERIALIZE|TEMP B-TREE/i);
        for (const indexName of rule.requiredIndexes) {
          expect(joined, `${rule.ruleId}:${indexName}`).toContain(indexName);
        }
      }
    } finally {
      close(run);
    }
  });

  it("finalizes the active witness exactly once on a malformed marker", () => {
    const run = sealedForLegacy(false);
    const target = SQLITE_LEGACY_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    let emitted = false;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => emitted
        ? { done: true, value: undefined }
        : (emitted = true, { done: false, value: [2n] }),
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("fences hostile catalog changes and closes the current witness", () => {
    const run = sealedForLegacy(false);
    const target = SQLITE_LEGACY_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.connection.execTrusted(
          "CREATE TEMP TABLE ge_blr_hostile(value INTEGER)", "inspect-schema",
        );
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      run.connection.execTrusted("DROP TABLE temp.ge_blr_hostile", "inspect-schema");
      close(run);
    }
  });

  it("creates, fetches, and closes one bounded witness per frozen rule", () => {
    for (const target of SQLITE_LEGACY_RULES) {
      const run = sealedForLegacy(false);
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let creates = 0;
      let fetches = 0;
      let closes = 0;
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => {
          const statement = originalPrepare(sql, operation);
          if (sql !== target.sql) return statement;
          creates += 1;
          return {
            iterate: (...values: readonly unknown[]) => {
              const inner = statement.iterate(...values)[Symbol.iterator]();
              const wrapper: Iterator<unknown> & Iterable<unknown> = {
                [Symbol.iterator]() { return this; },
                next: () => { fetches += 1; return inner.next(); },
                return: () => {
                  closes += 1;
                  return inner.return?.() ?? { done: true, value: undefined };
                },
              };
              return wrapper;
            },
          } as never;
        },
      );
      try {
        expect(runSQLiteLegacyInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([]);
        expect({ creates, closes }).toEqual({ creates: 1, closes: 1 });
        expect(fetches).toBeGreaterThanOrEqual(1);
      } finally {
        prepare.mockRestore();
        close(run);
      }
    }
  });

  it("closes a diagnostic witness before entering the next rule", () => {
    const run = sealedForLegacy(false);
    const first = SQLITE_LEGACY_RULES[0];
    const second = SQLITE_LEGACY_RULES[1];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let firstClosed = false;
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => {
        if (sql === second.sql) expect(firstClosed).toBe(true);
        if (sql !== first.sql) return originalPrepare(sql, operation);
        let emitted = false;
        return { iterate: () => ({
          [Symbol.iterator]() { return this; },
          next: () => emitted
            ? { done: true, value: undefined }
            : (emitted = true, { done: false, value: [1n] }),
          return: () => { firstClosed = true; return { done: true, value: undefined }; },
        }) } as never;
      },
    );
    try {
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([{
        ruleId: first.ruleId, violationCount: 1, diagnosticsTruncated: false,
      }]);
      expect(firstClosed).toBe(true);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("rejects an equal-content projection clone by reference", () => {
    const run = sealedForLegacy(false);
    try {
      expect(() => new SQLiteLegacyInvariantCampaign(
        run.connection, Object.freeze({ ...run.projectionIdentity }), run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("rejects an equal-count TEMP write at legacy begin before rule preparation", () => {
    const run = sealedForLegacy(true);
    const prepare = vi.spyOn(run.connection, "prepare");
    try {
      run.connection.prepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 11",
        "inspect-schema",
      ).run();
      expect(() => new SQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(prepare.mock.calls.some(([sql]) =>
        SQLITE_LEGACY_RULES.some((rule) => rule.sql === sql),
      )).toBe(false);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("detects an equal-count main inventory replacement in raw rule evidence", () => {
    const run = sealedForLegacy(true);
    try {
      const result = {
        archiveMode: "lossless-before-delete",
        compactionMode: "logical-history-preserving",
        legalHoldIds: ["hold-a"],
        retentionMode: "retain-authoritative-history",
      } as const;
      run.connection.prepare(
        "DELETE FROM main.ge_cycle_operations WHERE operation_id = 'operation-a'",
        "inspect-schema",
      ).run();
      insertLegacyOperation(run.connection, "operation-replacement", "set-legal-hold", result);
      expect(run.connection.prepare(
        SQLITE_LEGACY_RULES[0].sql, "inspect-schema",
      ).all(17)).toHaveLength(2);
    } finally {
      close(run);
    }
  });

  it("fails before fetching when main storage mutates after capture", () => {
    const run = sealedForLegacy(true);
    const prepare = vi.spyOn(run.connection, "prepare");
    try {
      run.connection.prepare(
        "UPDATE main.ge_cycle_operations SET committed_at_ms = committed_at_ms + 1",
        "inspect-schema",
      ).run();
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(prepare.mock.calls.some(([sql]) => sql === SQLITE_LEGACY_RULES[0].sql)).toBe(false);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("rejects a blob-only exact-shape main table swap with unchanged row changes", () => {
    const connection = opened(NOW);
    seedEverySourceFamily(connection);
    const sourceSql = String((connection.prepare(
      "SELECT sql FROM main.sqlite_schema WHERE type = 'table' AND name = 'ge_cycle_operations'",
      "inspect-schema",
    ).get() as unknown as readonly [string])[0]);
    connection.execTrusted(
      sourceSql.replace("ge_cycle_operations", "ge_cycle_operations_shadow"),
      "inspect-schema",
    );
    connection.prepare(`INSERT INTO main.ge_cycle_operations_shadow
      (tenant_id, operation_id, operation_name, request_hash,
       result_blob, result_hash, committed_at_ms)
      SELECT tenant_id, operation_id, operation_name, request_hash,
             X'7b7d', result_hash, committed_at_ms
        FROM main.ge_cycle_operations`, "inspect-schema").run();
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const stage = createSQLiteBaselineTempStage(
      connection, proveSQLiteExclusiveBaselineTransaction(connection),
    ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
    const source = captureSQLiteV1BaselineSourceSummary(
      connection, NOW,
    ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
    stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
    const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
      connection, source, stage,
    );
    runSQLiteStreamRecordInvariantCampaign(connection, projectionIdentity, stage);
    runSQLiteCheckpointInvariantCampaign(connection, projectionIdentity, stage);
    runSQLiteLeaseLockHoldInvariantCampaign(connection, projectionIdentity, stage);
    const beforeChanges = totalChanges(connection);
    try {
      connection.execTrusted(
        "ALTER TABLE main.ge_cycle_operations RENAME TO ge_cycle_operations_original",
        "inspect-schema",
      );
      connection.execTrusted(
        "ALTER TABLE main.ge_cycle_operations_shadow RENAME TO ge_cycle_operations",
        "inspect-schema",
      );
      expect(totalChanges(connection)).toBe(beforeChanges);
      expect(() => runSQLiteLegacyInvariantCampaign(
        connection, projectionIdentity, stage,
      )).toThrow(CycleStoreProviderError);
      expect(stage.state).toBe("poisoned");
    } finally {
      close({ connection, source, stage });
    }
  });

  it("rejects an exact-shape main swap during an active witness and closes it once", () => {
    const connection = opened(NOW);
    seedEverySourceFamily(connection);
    const sourceSql = String((connection.prepare(
      "SELECT sql FROM main.sqlite_schema WHERE type = 'table' AND name = 'ge_cycle_operations'",
      "inspect-schema",
    ).get() as unknown as readonly [string])[0]);
    connection.execTrusted(
      sourceSql.replace("ge_cycle_operations", "ge_cycle_operations_shadow"),
      "inspect-schema",
    );
    connection.prepare(`INSERT INTO main.ge_cycle_operations_shadow
      (tenant_id, operation_id, operation_name, request_hash,
       result_blob, result_hash, committed_at_ms)
      SELECT tenant_id, operation_id, operation_name, request_hash,
             X'7b7d', result_hash, committed_at_ms
        FROM main.ge_cycle_operations`, "inspect-schema").run();
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const stage = createSQLiteBaselineTempStage(
      connection, proveSQLiteExclusiveBaselineTransaction(connection),
    ) as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
    const source = captureSQLiteV1BaselineSourceSummary(
      connection, NOW,
    ) as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
    stageSQLiteV1BaselineSourceIntoTempStage(connection, source, stage);
    const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
      connection, source, stage,
    );
    runSQLiteStreamRecordInvariantCampaign(connection, projectionIdentity, stage);
    runSQLiteCheckpointInvariantCampaign(connection, projectionIdentity, stage);
    runSQLiteLeaseLockHoldInvariantCampaign(connection, projectionIdentity, stage);
    const beforeChanges = totalChanges(connection);
    const target = SQLITE_LEGACY_RULES[0];
    const originalPrepare = connection.prepare.bind(connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        connection.execTrusted(
          "ALTER TABLE main.ge_cycle_operations RENAME TO ge_cycle_operations_original",
          "inspect-schema",
        );
        connection.execTrusted(
          "ALTER TABLE main.ge_cycle_operations_shadow RENAME TO ge_cycle_operations",
          "inspect-schema",
        );
        expect(totalChanges(connection)).toBe(beforeChanges);
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        connection, projectionIdentity, stage,
      )).toThrow(CycleStoreProviderError);
      expect(returns).toBe(1);
      expect(stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close({ connection, source, stage });
    }
  });

  it("rejects same-name TEMP table and index replacements during an active cursor", () => {
    for (const replacement of ["table", "index"] as const) {
      const run = sealedForLegacy(false);
      const target = SQLITE_LEGACY_RULES[0];
      const originalPrepare = run.connection.prepare.bind(run.connection);
      let returns = 0;
      const iterator: Iterator<unknown> & Iterable<unknown> = {
        [Symbol.iterator]() { return this; },
        next: () => {
          if (replacement === "index") {
            run.connection.execTrusted(
              "DROP INDEX temp.ge_blr_records_tenant_hash_uidx", "inspect-schema",
            );
            run.connection.execTrusted(
              "CREATE UNIQUE INDEX temp.ge_blr_records_tenant_hash_uidx ON ge_blr_records(record_hash, tenant_id)",
              "inspect-schema",
            );
          } else {
            run.connection.execTrusted(
              "DROP TABLE temp.ge_blr_legacy_operations", "inspect-schema",
            );
            run.connection.execTrusted(
              "CREATE TEMP TABLE ge_blr_legacy_operations(value INTEGER) STRICT",
              "inspect-schema",
            );
          }
          return { done: true, value: undefined };
        },
        return: () => { returns += 1; return { done: true, value: undefined }; },
      };
      const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
        (sql, operation) => sql === target.sql
          ? ({ iterate: () => iterator } as never)
          : originalPrepare(sql, operation),
      );
      try {
        expect(() => runSQLiteLegacyInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        )).toThrow(CycleStoreProviderError);
        expect(returns).toBe(1);
        expect(run.stage.state).toBe("poisoned");
      } finally {
        prepare.mockRestore();
        close(run);
      }
    }
  });

  it("active stage disposal closes the witness and removes the fixed TEMP catalog", () => {
    const run = sealedForLegacy(false);
    const target = SQLITE_LEGACY_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.stage.dispose();
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(returns).toBe(1);
      expect(run.connection.prepare(
        "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
        "inspect-schema",
      ).get()).toEqual([0n]);
    } finally {
      prepare.mockRestore();
      if (run.connection.isTransaction) run.connection.execTrusted("ROLLBACK", "inspect-schema");
      run.connection.close();
    }
  });

  it("closes the active witness when the owner transaction terminates", () => {
    const run = sealedForLegacy(false);
    const target = SQLITE_LEGACY_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => {
        run.connection.execTrusted("COMMIT", "inspect-schema");
        return { done: true, value: undefined };
      },
      return: () => { returns += 1; return { done: true, value: undefined }; },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("keeps the primary fetch failure authoritative over cleanup failure", () => {
    const run = sealedForLegacy(false);
    const target = SQLITE_LEGACY_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => { throw new Error("primary fetch failure"); },
      return: () => { returns += 1; throw new Error("secondary cleanup failure"); },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline legacy campaign failed");
      expect(returns).toBe(1);
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("surfaces a cleanup-only failure and poisons the stage", () => {
    const run = sealedForLegacy(false);
    const target = SQLITE_LEGACY_RULES[0];
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let returns = 0;
    const iterator: Iterator<unknown> & Iterable<unknown> = {
      [Symbol.iterator]() { return this; },
      next: () => ({ done: true, value: undefined }),
      return: () => { returns += 1; throw new Error("cleanup-only failure"); },
    };
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => sql === target.sql
        ? ({ iterate: () => iterator } as never)
        : originalPrepare(sql, operation),
    );
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrowError("SQLite baseline legacy campaign failed");
      expect(returns).toBe(1);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("accepts an empty legacy inventory and completes one-shot", () => {
    const run = sealedForLegacy(false);
    try {
      const campaign = new SQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      );
      expect(campaign.state).toBe("open");
      expect(campaign.run().diagnostics).toEqual([]);
      expect(campaign.state).toBe("complete");
      expect(() => campaign.run()).toThrow(CycleStoreProviderError);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("requires successful completion of every preceding campaign", () => {
    const run = sealedForLeaseLockHold();
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });

  it("validates the exact diagnostic-limit option surface before stage binding", () => {
    const run = sealedForLegacy(false);
    try {
      for (const options of [
        { diagnosticLimit: 0 }, { diagnosticLimit: 65 },
        { diagnosticLimit: 1.5 }, { extra: true }, null,
      ]) {
        expect(() => new SQLiteLegacyInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage, options as never,
        )).toThrow(CycleStoreProviderError);
        expect(run.stage.state).toBe("open");
      }
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage, { diagnosticLimit: 1 },
      ).diagnostics).toEqual([]);
    } finally {
      close(run);
    }
  });

  it("rejects hostile option prototypes, accessors, symbols, arrays, and proxies", () => {
    const hidden = {};
    Object.defineProperty(hidden, "hidden", { value: true });
    const symbol = { [Symbol("hidden")]: true };
    let getterCalls = 0;
    const accessor = {};
    Object.defineProperty(accessor, "diagnosticLimit", {
      enumerable: true,
      get: () => { getterCalls += 1; return 16; },
    });
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.diagnosticLimit = 16;
    const proxy = new Proxy({}, {
      ownKeys: () => { throw new Error("hostile ownKeys"); },
    });
    for (const options of [
      hidden, symbol, accessor, nullPrototype, [], proxy,
    ]) {
      const run = sealedForLegacy(false);
      try {
        expect(() => new SQLiteLegacyInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage, options as never,
        )).toThrow(CycleStoreProviderError);
        expect(run.stage.state).toBe("open");
        expect(runSQLiteLegacyInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([]);
      } finally {
        close(run);
      }
    }
    expect(getterCalls).toBe(0);
  });

  it.each([1, 16, 64])(
    "uses genuine fixed SQL for exact and limit+1 append units at %i",
    (limit) => {
      for (const extra of [0, 1]) {
        const run = sealedLegacySource((connection) => {
          for (let index = 0; index < limit + extra; index += 1) {
            insertLegacyOperation(
              connection,
              `genuine-boundary-${limit}-${extra}-${index}`,
              "append",
              {
                appendedRecords: 1,
                tail: {
                  exists: true,
                  sequence: index,
                  recordHash: createHash("sha256")
                    .update(`missing:${limit}:${extra}:${index}`).digest("hex"),
                },
              },
            );
          }
        });
        try {
          expect(runSQLiteLegacyInvariantCampaign(
            run.connection, run.projectionIdentity, run.stage,
            { diagnosticLimit: limit },
          ).diagnostics).toEqual([{
            ruleId: "BLR_LEGACY_APPEND_BINDING",
            violationCount: limit,
            diagnosticsTruncated: extra === 1,
          }]);
        } finally {
          close(run);
        }
      }
    },
  );

  it("rejects append, checkpoint, and lease witnesses that exist only in another tenant", () => {
    const acquiredAt = new Date(NOW).toISOString();
    const expiresAt = new Date(NOW + 100).toISOString();
    const cases: readonly [string, (connection: SQLiteConnection) => void][] = [
      ["BLR_LEGACY_APPEND_BINDING", (connection) => {
        insertInvariantStream(connection, "tenant-b", "stream-alias", -1, null);
        const hash = insertInvariantRecord(
          connection, "tenant-b", "stream-alias", "record-alias", 0, null,
        );
        connection.prepare(`UPDATE ge_cycle_streams
          SET tail_sequence = 0, tail_record_hash = ?
          WHERE tenant_id = 'tenant-b' AND stream_id = 'stream-alias'`,
        "inspect-schema").run(hash);
        insertLegacyOperation(connection, "cross-tenant-append", "append", {
          appendedRecords: 1,
          tail: { exists: true, sequence: 0, recordHash: hash },
        });
      }],
      ["BLR_LEGACY_CHECKPOINT_BINDING", (connection) => {
        insertInvariantStream(
          connection, "tenant-b", "stream-checkpoint-alias", -1, null,
        );
        const hash = insertInvariantRecord(
          connection, "tenant-b", "stream-checkpoint-alias", "record-checkpoint-alias",
          0, null,
        );
        connection.prepare(`UPDATE ge_cycle_streams
          SET tail_sequence = 0, tail_record_hash = ?
          WHERE tenant_id = 'tenant-b' AND stream_id = 'stream-checkpoint-alias'`,
        "inspect-schema").run(hash);
        const value = createCycleStoreCheckpoint({
          boundRecordHash: hash, boundSequence: 0,
          checkpointId: "checkpoint-alias", checkpointScope: "scope-alias",
          createdAt: acquiredAt, streamId: "stream-checkpoint-alias", value: 1,
        });
        insertInvariantCheckpointRevision(
          connection, "tenant-b", "scope-alias", 1, "checkpoint-alias", NOW, value,
        );
        const { value: _value, ...summary } = value;
        insertLegacyOperation(
          connection, "cross-tenant-checkpoint", "save-checkpoint", summary,
        );
      }],
      ["BLR_LEGACY_LEASE_BINDING", (connection) => {
        insertInvariantStream(connection, "tenant-b", "stream-lease-alias", -1, null);
        const hash = insertInvariantRecord(
          connection, "tenant-b", "stream-lease-alias", "record-lease-alias", 0, null,
        );
        connection.prepare(`UPDATE ge_cycle_streams
          SET tail_sequence = 0, tail_record_hash = ?
          WHERE tenant_id = 'tenant-b' AND stream_id = 'stream-lease-alias'`,
        "inspect-schema").run(hash);
        insertInvariantLease(connection, "tenant-b", "stream-lease-alias", 1, {
          acquiredAtMs: NOW, expiresAtMs: NOW + 100,
          holderId: "holder-alias", leaseId: "lease-alias",
        });
        insertInvariantUsedLease(
          connection, "tenant-b", "stream-lease-alias", "lease-alias", 1, NOW,
        );
        insertLegacyOperation(connection, "cross-tenant-lease", "acquire-lease", {
          acquiredAt, expiresAt, fencingToken: 1, holderId: "holder-alias",
          leaseEpoch: 1, leaseId: "lease-alias",
        });
      }],
    ];
    for (const [ruleId, populate] of cases) {
      const run = sealedLegacySource(populate);
      try {
        expect(runSQLiteLegacyInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toEqual([{
          ruleId, violationCount: 1, diagnosticsTruncated: false,
        }]);
      } finally {
        close(run);
      }
    }
  });

  it("accepts delete:true when any delete revision exists in the same tenant", () => {
    const run = sealedLegacySource((connection) => {
      insertInvariantCheckpointRevision(
        connection, "tenant-a", "unrecoverable-scope", 1,
        "unrecoverable-checkpoint", NOW,
      );
      insertLegacyOperation(
        connection, "recoverable-delete", "delete-checkpoint", { deleted: true },
      );
    });
    try {
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([]);
    } finally {
      close(run);
    }
  });

  it("rejects release when the exact used pair and highwater belong to different domains", () => {
    const populate = (connection: SQLiteConnection): void => {
      for (const streamId of ["stream-used-pair", "stream-highwater"]) {
        insertInvariantStream(connection, "tenant-a", streamId, -1, null);
        const hash = insertInvariantRecord(
          connection, "tenant-a", streamId, `record-${streamId}`, 0, null,
        );
        connection.prepare(`UPDATE ge_cycle_streams
          SET tail_sequence = 0, tail_record_hash = ?
          WHERE tenant_id = 'tenant-a' AND stream_id = ?`,
        "inspect-schema").run(hash, streamId);
      }
      insertInvariantLease(connection, "tenant-a", "stream-used-pair", 1);
      insertInvariantUsedLease(
        connection, "tenant-a", "stream-used-pair", "lease-pair", 2, NOW,
      );
      insertInvariantLease(connection, "tenant-a", "stream-highwater", 2);
      insertLegacyOperation(connection, "split-release", "release-lease", {
        status: "released", lease: null, lastLeaseEpoch: 2, lastFencingToken: 2,
      });
    };
    const run = sealedLegacySource(populate, true);
    try {
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toEqual([{
        ruleId: "BLR_LEGACY_LEASE_BINDING",
        violationCount: 1,
        diagnosticsTruncated: false,
      }]);
    } finally {
      close(run);
    }
  });

  it.each([
    ["owner", "active_owner_id = 'owner-drift'"],
    ["target-version", "active_target_version = 3"],
    ["acquired-clock", `active_acquired_at_ms = ${NOW - 1}`],
    ["expiry-clock", `active_expires_at_ms = ${NOW + 2}`],
  ] as const)("rejects active migration-lock %s drift", (_label, assignment) => {
    const run = sealedLegacySource((connection) => {
      seedAllLegacyOperationResults(connection);
      connection.prepare(
        `UPDATE ge_cycle_migration_lock SET ${assignment} WHERE singleton = 1`,
        "inspect-schema",
      ).run();
    }, true);
    try {
      expect(runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      ).diagnostics).toContainEqual({
        ruleId: "BLR_LEGACY_LOCK_BINDING",
        violationCount: 1,
        diagnosticsTruncated: false,
      });
    } finally {
      close(run);
    }
  });

  it("rejects active migration-lock source-version and epoch/fence drift", () => {
    const variants: readonly ((connection: SQLiteConnection) => void)[] = [
      (connection) => {
        connection.prepare(
          "DELETE FROM ge_cycle_operations WHERE operation_id = 'legacy-lock-acquire'",
          "inspect-schema",
        ).run();
        insertLegacyOperation(connection, "legacy-lock-acquire", "acquire-migration-lock", {
          acquiredAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1).toISOString(),
          fencingToken: 1, lockEpoch: 1, lockId: "lock-a", ownerId: "owner-a",
          sourceSchemaVersion: 2, targetSchemaVersion: 3,
        });
        connection.prepare(
          "UPDATE ge_cycle_migration_lock SET active_target_version = 3 WHERE singleton = 1",
          "inspect-schema",
        ).run();
      },
      (connection) => {
        connection.prepare(
          "DELETE FROM ge_cycle_operations WHERE operation_id = 'legacy-lock-acquire'",
          "inspect-schema",
        ).run();
        connection.prepare(
          "DELETE FROM ge_cycle_used_migration_lock_ids WHERE lock_id = 'lock-a'",
          "inspect-schema",
        ).run();
        connection.prepare(`INSERT INTO ge_cycle_used_migration_lock_ids
          (lock_id, lock_epoch, fencing_token, first_used_at_ms)
          VALUES ('lock-a', 2, 2, ?)`, "inspect-schema").run(NOW);
        insertLegacyOperation(connection, "legacy-lock-acquire", "acquire-migration-lock", {
          acquiredAt: new Date(NOW).toISOString(), expiresAt: new Date(NOW + 1).toISOString(),
          fencingToken: 2, lockEpoch: 2, lockId: "lock-a", ownerId: "owner-a",
          sourceSchemaVersion: 1, targetSchemaVersion: 2,
        });
      },
    ];
    for (const mutate of variants) {
      const run = sealedLegacySource((connection) => {
        seedAllLegacyOperationResults(connection);
        mutate(connection);
      }, true);
      try {
        expect(runSQLiteLegacyInvariantCampaign(
          run.connection, run.projectionIdentity, run.stage,
        ).diagnostics).toContainEqual({
          ruleId: "BLR_LEGACY_LOCK_BINDING",
          violationCount: 1,
          diagnosticsTruncated: false,
        });
      } finally {
        close(run);
      }
    }
    expect(SQLITE_LEGACY_RULES[4].sql).toContain(
      "lock.active_lock_epoch IS NOT legacy.lock_epoch",
    );
    expect(SQLITE_LEGACY_RULES[4].sql).toContain(
      "lock.active_fencing_token IS NOT legacy.lock_fencing_token",
    );
  });

  it("detects every recoverable inventory scalar drift as one operation unit", () => {
    const attacks = [
      "tenant_id = 'tenant-drift'",
      "operation_id = 'operation-drift'",
      `request_hash = '${"a".repeat(64)}'`,
      `result_hash = '${"b".repeat(64)}'`,
      `result_blob_sha256 = '${"c".repeat(64)}'`,
      "operation_name = 'release-migration-lock'",
      `committed_at_ms = ${NOW + 1}`,
    ];
    for (const assignment of attacks) {
      const run = sealedForLegacy(true);
      try {
        run.connection.prepare(
          `UPDATE temp.ge_blr_legacy_operations SET ${assignment}
            WHERE operation_id = 'operation-a'`, "inspect-schema",
        ).run();
        expect(run.connection.prepare(
          SQLITE_LEGACY_RULES[0].sql, "inspect-schema",
        ).all(17)).toEqual([[1n]]);
      } finally {
        close(run);
      }
    }
  });

  it.each([
    ["$.resultBlobSha256", "c".repeat(64)],
    ["$.operationName", "release-migration-lock"],
  ])("detects common inventory drift at %s as one operation unit", (path, value) => {
    const run = sealedForLegacy(true);
    try {
      run.connection.prepare(`UPDATE temp.ge_blr_stage
        SET state_blob = CAST(json_set(CAST(state_blob AS TEXT), ?, ?) AS BLOB)
        WHERE kind_rank = 11`, "inspect-schema").run(path, value);
      expect(run.connection.prepare(
        SQLITE_LEGACY_RULES[0].sql, "inspect-schema",
      ).all(17)).toEqual([[1n]]);
    } finally {
      close(run);
    }
  });

  it("caps one corrupt operation at one unit in each affected rule", () => {
    const run = sealedLegacySource(seedAllLegacyOperationResults);
    try {
      run.connection.prepare(`UPDATE temp.ge_blr_legacy_operations
        SET request_hash = ?, tail_record_hash = ?
        WHERE operation_id = 'legacy-append'`, "inspect-schema").run(
        "a".repeat(64), "f".repeat(64),
      );
      const vector = SQLITE_LEGACY_RULES.map((rule) =>
        run.connection.prepare(rule.sql, "inspect-schema").all(17).length,
      );
      expect(vector).toEqual([1, 1, 0, 0, 0]);
      expect(vector.every((count) => count <= 1)).toBe(true);
    } finally {
      close(run);
    }
  });

  it("fences genuine DML after a real diagnostic and before the next rule", () => {
    const run = sealedLegacySource((connection) => {
      insertLegacyOperation(connection, "transition-append", "append", {
        appendedRecords: 1,
        tail: { exists: true, sequence: 0, recordHash: "f".repeat(64) },
      });
    });
    const originalPrepare = run.connection.prepare.bind(run.connection);
    let injected = false;
    const prepare = vi.spyOn(run.connection, "prepare").mockImplementation(
      (sql, operation) => {
        if (!injected && sql === SQLITE_LEGACY_RULES[2].sql) {
          injected = true;
          originalPrepare(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            "inspect-schema",
          ).run();
        }
        return originalPrepare(sql, operation);
      },
    );
    try {
      expect(() => runSQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      )).toThrow(CycleStoreProviderError);
      expect(injected).toBe(true);
      expect(run.stage.state).toBe("poisoned");
    } finally {
      prepare.mockRestore();
      close(run);
    }
  });

  it("abandons an open campaign fail-closed", () => {
    const run = sealedForLegacy(false);
    try {
      const campaign = new SQLiteLegacyInvariantCampaign(
        run.connection, run.projectionIdentity, run.stage,
      );
      expect(() => campaign.dispose()).toThrow(CycleStoreProviderError);
      expect(campaign.state).toBe("poisoned");
      expect(run.stage.state).toBe("poisoned");
    } finally {
      close(run);
    }
  });
});
