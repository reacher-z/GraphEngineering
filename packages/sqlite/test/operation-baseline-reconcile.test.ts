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
  SQLITE_BASELINE_COOPERATIVE_ENTRIES,
  SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF,
  SQLITE_BASELINE_CONSUME_OWNED_WRITE,
  SQLITE_BASELINE_FENCE_ORDERED_HANDOFF,
  SQLITE_BASELINE_OWNED_WRITE,
  type SQLiteBaselineCooperativeSource,
  type SQLiteBaselineCooperativeStage,
  type SQLiteBaselineOwnedWriteReceipt,
} from "../src/operation-baseline-cooperation.js";
import { stageSQLiteV1BaselineSourceIntoTempStage } from "../src/operation-baseline-reconcile.js";
import {
  SQLiteV1BaselineOrderedTempReader,
  readSQLiteV1BaselineOrderedTempProjection,
} from "../src/operation-baseline-handoff.js";
import {
  MAX_BASELINE_KEY_BYTES,
  MAX_BASELINE_STATE_BYTES,
  buildOperationBaseline,
  createOperationBaselineId,
  decodeOperationBaselineCanonicalBytes,
  encodeOperationBaselineKey,
  encodeOperationBaselineState,
  type OperationBaselineEntryInput,
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
