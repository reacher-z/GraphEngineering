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
} from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import {
  SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_COOPERATIVE_ENTRIES,
  SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF,
  SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_CONSUME_OWNED_WRITE,
  SQLITE_BASELINE_FENCE_ORDERED_HANDOFF,
  SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN,
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
