import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
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
import { afterEach, describe, expect, it } from "vitest";

import {
  SQLITE_SCHEMA_IDENTITY_SHA256,
  ensureSQLiteCycleStoreSchema,
} from "../src/migrations.js";
import {
  OperationBaselineAccumulator,
  createOperationBaselineId,
} from "../src/operation-baseline.js";
import { decodeSQLiteCursorSealRow } from "../src/operation-baseline-cursor-invariants.js";
import {
  SQLITE_V1_BASELINE_MAXIMUM_NON_CURSOR_OBSERVED_SQL,
  captureSQLiteV1BaselineSourceSummary,
} from "../src/operation-baseline-source.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import {
  SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  createSQLiteCycleStoreDescriptor,
} from "../src/sqlite-profile.js";

const roots: string[] = [];
const APPLIED_AT_MS = 1_785_110_405_000;
const AHEAD_AT_MS = APPLIED_AT_MS + 60_000;
const BEYOND_SAFE_AT_MS = 9_007_199_254_740_992n;
const EXACT_APPLIED_AT_MS_EVIDENCE = {
  capturedAtMs: APPLIED_AT_MS,
  maximumNonCursorObservedAtMs: APPLIED_AT_MS,
  providerHighWaterAtMs: APPLIED_AT_MS,
} as const;
const CURSOR_TOKEN_HASH = "a".repeat(64);
const CURSOR_PRINCIPAL_HASH = "b".repeat(64);
const CURSOR_AUTHORIZATION_HASH = "c".repeat(64);
const CURSOR_REQUEST_SCOPE_BLOB = Buffer.from(canonicalSerialize({
  contractVersion: 1,
  kind: "event",
  pageSize: 16,
  streamId: "stream-a",
}), "utf8");
const CURSOR_SNAPSHOT_BLOB = Buffer.from(canonicalSerialize({
  exists: false,
  recordHash: null,
  sequence: -1,
}), "utf8");
/** The eighteen physical cursor columns in schema order. */
const CURSOR_COLUMNS = `tenant_id, token_hash, kind, principal_hash, authorization_hash,
         stream_id, checkpoint_scope, request_scope_blob, page_size, next_position,
         snapshot_tail_sequence, snapshot_tail_record_hash, descriptor_hash,
         schema_identity_sha256, snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms`;

function opened(): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-baseline-source-"));
  roots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: APPLIED_AT_MS,
  });
  return connection;
}

function providerError(action: () => unknown): CycleStoreProviderError {
  try {
    action();
  } catch (error) {
    if (error instanceof CycleStoreProviderError) return error;
    throw error;
  }
  throw new Error("expected a CycleStoreProviderError");
}

/**
 * One physically valid, manifest-bound event cursor over `stream-a` whose owner
 * clocks are supplied by the caller so a test can place them ahead of the
 * provider high-water.
 */
function insertPhysicalCursor(
  connection: SQLiteConnection,
  clocks: {
    readonly createdAtMs: number | bigint;
    readonly expiresAtMs: number | bigint;
    readonly consumedAtMs: number | bigint | null;
  },
): void {
  connection.prepare(`
    INSERT INTO ge_cycle_cursors
      (${CURSOR_COLUMNS})
    VALUES ('tenant-a', ?, 'event', ?, ?, 'stream-a', NULL, ?, 16, 0, -1, NULL, ?, ?, ?, ?, ?, ?)
  `, "inspect-schema").run(
    CURSOR_TOKEN_HASH,
    CURSOR_PRINCIPAL_HASH,
    CURSOR_AUTHORIZATION_HASH,
    CURSOR_REQUEST_SCOPE_BLOB,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_SCHEMA_IDENTITY_SHA256,
    CURSOR_SNAPSHOT_BLOB,
    clocks.createdAtMs,
    clocks.expiresAtMs,
    clocks.consumedAtMs,
  );
}

function insertStream(connection: SQLiteConnection): void {
  connection.prepare(`
    INSERT INTO ge_cycle_streams
      (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
    VALUES ('tenant-a', 'stream-a', -1, NULL, ?, ?)
  `, "inspect-schema").run(APPLIED_AT_MS, APPLIED_AT_MS);
}

/**
 * Seeds exactly one row in every table that carries a provider observation
 * clock, all at `APPLIED_AT_MS`, so a single column can then be pushed ahead of
 * the migration-lock high-water in isolation.
 */
function seedEveryProviderClockFamily(connection: SQLiteConnection): void {
  const record = createCycleStoreRecord({
    recordId: "record-a",
    sequence: 0,
    previousRecordHash: null,
    value: 7,
  });
  const checkpoint = createCycleStoreCheckpoint({
    checkpointScope: "scope-a",
    checkpointId: "checkpoint-a",
    streamId: "stream-a",
    boundSequence: record.sequence,
    boundRecordHash: record.recordHash,
    createdAt: "2026-07-28T00:00:00Z",
    value: 0,
  });
  const { value: _value, ...checkpointSummary } = checkpoint;
  const summaryBlob = Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", checkpointSummary),
  );
  const legacyResult = { deleted: false } as const;
  insertStream(connection);
  connection.prepare(`
    INSERT INTO ge_cycle_records
      (tenant_id, stream_id, sequence, record_id, previous_record_hash,
       value_hash, value_bytes, value_blob, record_hash, record_blob, committed_at_ms)
    VALUES ('tenant-a', 'stream-a', ?, ?, NULL, ?, ?, ?, ?, ?, ?)
  `, "inspect-schema").run(
    record.sequence,
    record.recordId,
    record.valueHash,
    record.valueBytes,
    Buffer.from(canonicalSerialize(record.value), "utf8"),
    record.recordHash,
    Buffer.from(canonicalSerialize(record), "utf8"),
    APPLIED_AT_MS,
  );
  connection.prepare(`
    UPDATE ge_cycle_streams
       SET tail_sequence = ?, tail_record_hash = ?
     WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'
  `, "inspect-schema").run(record.sequence, record.recordHash);
  connection.prepare(`
    INSERT INTO ge_cycle_checkpoints
      (tenant_id, checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
       bound_record_hash, created_at, value_hash, value_bytes, value_blob,
       checkpoint_blob, summary_blob, checkpoint_revision, committed_at_ms)
    VALUES ('tenant-a', ?, ?, 'stream-a', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `, "inspect-schema").run(
    checkpoint.checkpointScope,
    checkpoint.checkpointId,
    checkpoint.boundSequence,
    checkpoint.boundRecordHash,
    checkpoint.createdAt,
    checkpoint.valueHash,
    checkpoint.valueBytes,
    Buffer.from(canonicalSerialize(checkpoint.value), "utf8"),
    Buffer.from(canonicalSerialize(checkpoint), "utf8"),
    summaryBlob,
    APPLIED_AT_MS,
  );
  connection.prepare(`
    INSERT INTO ge_cycle_checkpoint_revisions
      (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
       summary_blob, bound_sequence, bound_record_hash,
       checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
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
    APPLIED_AT_MS,
  );
  connection.prepare(`
    INSERT INTO ge_cycle_leases
      (tenant_id, stream_id, active_lease_id, active_holder_id,
       active_lease_epoch, active_fencing_token, active_acquired_at_ms,
       active_expires_at_ms, last_lease_epoch, last_fencing_token, updated_at_ms)
    VALUES ('tenant-a', 'stream-a', 'lease-a', 'holder-a', 1, 1, ?, ?, 1, 1, ?)
  `, "inspect-schema").run(APPLIED_AT_MS, APPLIED_AT_MS + 1, APPLIED_AT_MS);
  connection.prepare(`
    INSERT INTO ge_cycle_used_lease_ids
      (tenant_id, stream_id, lease_id, lease_epoch, fencing_token, first_used_at_ms)
    VALUES ('tenant-a', 'stream-a', 'lease-a', 1, 1, ?)
  `, "inspect-schema").run(APPLIED_AT_MS);
  connection.prepare(`
    INSERT INTO ge_cycle_legal_holds (tenant_id, stream_id, hold_id, placed_at_ms)
    VALUES ('tenant-a', 'stream-a', 'hold-a', ?)
  `, "inspect-schema").run(APPLIED_AT_MS);
  connection.prepare(`
    INSERT INTO ge_cycle_used_migration_lock_ids
      (lock_id, lock_epoch, fencing_token, first_used_at_ms)
    VALUES ('lock-a', 1, 1, ?)
  `, "inspect-schema").run(APPLIED_AT_MS);
  connection.prepare(`
    INSERT INTO ge_cycle_operations
      (tenant_id, operation_id, operation_name, request_hash,
       result_blob, result_hash, committed_at_ms)
    VALUES ('tenant-a', 'op-1', 'delete-checkpoint', ?, ?, ?, ?)
  `, "inspect-schema").run(
    "0".repeat(64),
    Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult("delete-checkpoint", legacyResult)),
    canonicalHash(legacyResult),
    APPLIED_AT_MS,
  );
  insertPhysicalCursor(connection, {
    createdAtMs: APPLIED_AT_MS,
    expiresAtMs: APPLIED_AT_MS + 1,
    consumedAtMs: APPLIED_AT_MS,
  });
}

interface ClockProbe {
  readonly label: string;
  readonly mutate: (connection: SQLiteConnection) => void;
}

function probe(label: string, ...statements: readonly string[]): ClockProbe {
  return {
    label,
    mutate: (connection) => {
      for (const statement of statements) {
        // Each probe must really move exactly one seeded row.
        const { changes } = connection.prepare(statement, "inspect-schema").run(AHEAD_AT_MS);
        expect(Number(changes), label).toBe(1);
      }
    },
  };
}

/**
 * Every provider observation the combined maximum used to cover, minus the two
 * cursor clocks. The migration-lock observation is proven separately because the
 * lock is the high-water it would be compared against.
 */
const OBSERVED_NON_CURSOR_CLOCKS: readonly ClockProbe[] = [
  probe("schema creation clock", "UPDATE ge_cycle_schema SET created_at_ms = ? WHERE singleton = 1"),
  probe("schema update clock", "UPDATE ge_cycle_schema SET updated_at_ms = ? WHERE singleton = 1"),
  // The schema and ledger migration clocks move as one pair: capture rejects a
  // one-sided move as differing application times before any clock comparison.
  probe(
    "migration application clocks",
    "UPDATE ge_cycle_schema SET latest_migration_applied_at_ms = ? WHERE singleton = 1",
    "UPDATE ge_cycle_migrations SET applied_at_ms = ? WHERE version = 1",
  ),
  probe("stream creation clock", "UPDATE ge_cycle_streams SET created_at_ms = ?"),
  probe("stream update clock", "UPDATE ge_cycle_streams SET updated_at_ms = ?"),
  probe("record commit clock", "UPDATE ge_cycle_records SET committed_at_ms = ?"),
  probe("legacy operation commit clock", "UPDATE ge_cycle_operations SET committed_at_ms = ?"),
  probe("checkpoint commit clock", "UPDATE ge_cycle_checkpoints SET committed_at_ms = ?"),
  probe(
    "checkpoint revision clock",
    "UPDATE ge_cycle_checkpoint_revisions SET recorded_at_ms = ?",
  ),
  probe("lease update clock", "UPDATE ge_cycle_leases SET updated_at_ms = ?"),
  probe("used lease first-use clock", "UPDATE ge_cycle_used_lease_ids SET first_used_at_ms = ?"),
  probe("legal hold placement clock", "UPDATE ge_cycle_legal_holds SET placed_at_ms = ?"),
  probe(
    "used migration lock first-use clock",
    "UPDATE ge_cycle_used_migration_lock_ids SET first_used_at_ms = ?",
  ),
];

/** Clocks that stay outside the provider observation maximum by contract. */
const EXCLUDED_CLOCKS: readonly ClockProbe[] = [
  {
    label: "cursor creation, consumption and expiry clocks",
    mutate: (connection) => {
      const { changes } = connection.prepare(`
        UPDATE ge_cycle_cursors
           SET created_at_ms = ?, consumed_at_ms = ?, expires_at_ms = ?
      `, "inspect-schema").run(AHEAD_AT_MS, AHEAD_AT_MS + 1_000, AHEAD_AT_MS + 2_000);
      expect(Number(changes)).toBe(1);
    },
  },
  probe("lease future expiry clock", "UPDATE ge_cycle_leases SET active_expires_at_ms = ?"),
];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite v1 baseline source summary", () => {
  it("freezes the exact cross-runtime non-cursor clock query", () => {
    const normalized = SQLITE_V1_BASELINE_MAXIMUM_NON_CURSOR_OBSERVED_SQL
      .trim().split(/\s+/u).join(" ");
    expect(createHash("sha256").update(normalized, "utf8").digest("hex")).toBe(
      "c85e9836aadf613752aa9ba078c00248a4aa5cc3faafda916409b1ddf3201e1b",
    );
    expect(normalized).not.toContain("ge_cycle_cursors");
    expect(normalized).not.toContain("expires_at_ms");
    expect(normalized.match(/UNION ALL SELECT/gu)).toHaveLength(14);
  });

  it("captures one frozen envelope and all twelve exact family counts in-transaction", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(summary.sourceEnvelope).toMatchObject({
        capturedAtMs: APPLIED_AT_MS,
        sourceApplicationId: 1195724359,
        sourceMigrationLineageId: "fresh-v1-baseline",
        sourceUserVersion: 1,
      });
      expect(Object.keys(summary.countsByKind)).toHaveLength(12);
      expect(summary.countsByKind).toMatchObject({
        "schema-envelope": 1,
        "migration-lineage": 1,
        "migration-lock-current": 1,
        "legacy-operation": 0,
      });
      expect(summary.expectedEntryCount).toBe(3);
      expect(Object.keys(summary)).toEqual([
        "sourceEnvelope",
        "countsByKind",
        "expectedEntryCount",
        "clockEvidence",
        "entries",
      ]);
      expect(Object.keys(summary.clockEvidence)).toEqual([
        "capturedAtMs",
        "maximumNonCursorObservedAtMs",
        "providerHighWaterAtMs",
      ]);
      expect(summary.clockEvidence).toEqual({
        capturedAtMs: APPLIED_AT_MS,
        maximumNonCursorObservedAtMs: APPLIED_AT_MS,
        providerHighWaterAtMs: APPLIED_AT_MS,
      });
      expect(summary.clockEvidence.capturedAtMs).toBe(summary.sourceEnvelope.capturedAtMs);
      expect(Object.isFrozen(summary)).toBe(true);
      expect(Object.isFrozen(summary.countsByKind)).toBe(true);
      expect(Object.isFrozen(summary.clockEvidence)).toBe(true);
      expect(() => {
        (summary.clockEvidence as { providerHighWaterAtMs: number }).providerHighWaterAtMs = 0;
      }).toThrow(TypeError);

      const accumulator = new OperationBaselineAccumulator(
        createOperationBaselineId(summary.sourceEnvelope),
        summary.expectedEntryCount,
      );
      const inputs = [...summary.entries()];
      const migrationState = inputs[1]!.state as {
        readonly postconditions: { readonly requiredPostconditions: string[] };
      };
      expect(Object.isFrozen(migrationState.postconditions)).toBe(true);
      expect(Object.isFrozen(migrationState.postconditions.requiredPostconditions)).toBe(true);
      expect(() => migrationState.postconditions.requiredPostconditions.push("mutated")).toThrow();
      const streamed = inputs.map((input) => accumulator.append(input));
      expect(streamed.map((entry) => entry.entryKind)).toEqual([
        "schema-envelope",
        "migration-lineage",
        "migration-lock-current",
      ]);
      expect(streamed.map((entry) => entry.ordinal)).toEqual([0, 1, 2]);
      expect(accumulator.finish()).toMatchObject({ entryCount: 3, legacyOperationCount: 0 });
      expect(() => summary.entries()).toThrow(CycleStoreProviderError);
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("requires a caller transaction and rejects capture or clock-watermark drift", () => {
    const connection = opened();
    try {
      expect(() => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS)).toThrow(
        CycleStoreProviderError,
      );
      for (const begin of ["BEGIN", "BEGIN IMMEDIATE"] as const) {
        connection.execTrusted(begin, "inspect-schema");
        expect(() => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS)).toThrow(
          /active EXCLUSIVE transaction/u,
        );
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const behindHighWater = providerError(
        () => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS - 1),
      );
      expect(behindHighWater.code).toBe("GE_CYCLE_STORE_CORRUPTION");
      expect(behindHighWater.message).toMatch(/capture predates provider clock high-water/u);
      connection.prepare(
        "UPDATE ge_cycle_schema SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1",
        "inspect-schema",
      ).run();
      const behindSourceState = providerError(
        () => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS + 2),
      );
      expect(behindSourceState.code).toBe("GE_CYCLE_STORE_CORRUPTION");
      expect(behindSourceState.message).toMatch(
        /high-water predates non-cursor source state/u,
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("leaves cursor creation and consumption clocks to the cursor campaign", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      insertStream(connection);
      insertPhysicalCursor(connection, {
        createdAtMs: AHEAD_AT_MS,
        expiresAtMs: AHEAD_AT_MS + 120_000,
        consumedAtMs: AHEAD_AT_MS + 60_000,
      });
      // This is a genuinely valid physical cursor, not merely one the table
      // CHECKs tolerate: it decodes through the frozen eighteen-column reader.
      const decoded = decodeSQLiteCursorSealRow(connection.prepare(`
        SELECT ${CURSOR_COLUMNS} FROM ge_cycle_cursors
      `, "inspect-schema").get());
      expect(decoded.descriptorHash).toBe(SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
      expect(decoded.schemaIdentitySha256).toBe(SQLITE_SCHEMA_IDENTITY_SHA256);
      expect(decoded.carrier.createdAtMs).toBe(AHEAD_AT_MS);
      expect(decoded.carrier.consumedAtMs).toBe(AHEAD_AT_MS + 60_000);

      const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(summary.clockEvidence).toEqual({
        capturedAtMs: APPLIED_AT_MS,
        maximumNonCursorObservedAtMs: APPLIED_AT_MS,
        providerHighWaterAtMs: APPLIED_AT_MS,
      });
      expect(decoded.carrier.createdAtMs)
        .toBeGreaterThan(summary.clockEvidence.providerHighWaterAtMs);
      expect(decoded.carrier.consumedAtMs)
        .toBeGreaterThan(summary.clockEvidence.providerHighWaterAtMs);
      // The future Slice B cursor campaign owns this diagnostic; the cursor
      // changes no source projection in the current A2a slice.
      expect(summary.expectedEntryCount).toBe(4);
      expect([...summary.entries()].map((entry) => entry.entryKind)).toEqual([
        "schema-envelope",
        "migration-lineage",
        "stream-head",
        "migration-lock-current",
      ]);

      // The same fixture still fails the moment a non-cursor observation moves.
      connection.prepare(
        "UPDATE ge_cycle_streams SET updated_at_ms = ? WHERE stream_id = 'stream-a'",
        "inspect-schema",
      ).run(AHEAD_AT_MS);
      const failure = providerError(
        () => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS),
      );
      expect(failure.code).toBe("GE_CYCLE_STORE_CORRUPTION");
      expect(failure.message).toMatch(/high-water predates non-cursor source state/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("keeps every other provider observation inside the high-water rule", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      seedEveryProviderClockFamily(connection);
      connection.execTrusted("COMMIT", "inspect-schema");

      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const seeded = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(seeded.expectedEntryCount).toBe(12);
      expect(seeded.clockEvidence).toEqual(EXACT_APPLIED_AT_MS_EVIDENCE);
      connection.execTrusted("ROLLBACK", "inspect-schema");

      // Single-column regressions need the physical CHECKs relaxed; every probe
      // runs in its own rolled-back transaction over the same seeded fixture.
      connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      for (const probe of OBSERVED_NON_CURSOR_CLOCKS) {
        connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
        probe.mutate(connection);
        const failure = providerError(
          () => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS),
        );
        expect(failure.code, probe.label).toBe("GE_CYCLE_STORE_CORRUPTION");
        expect(failure.message, probe.label)
          .toMatch(/high-water predates non-cursor source state/u);
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }

      // The migration lock is the high-water itself, so its own observation can
      // never trip that rule; moving it ahead is caught by the capture clock.
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.prepare(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ? WHERE singleton = 1",
        "inspect-schema",
      ).run(AHEAD_AT_MS);
      const lockFailure = providerError(
        () => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS),
      );
      expect(lockFailure.code).toBe("GE_CYCLE_STORE_CORRUPTION");
      expect(lockFailure.message).toMatch(/capture predates provider clock high-water/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");

      for (const probe of EXCLUDED_CLOCKS) {
        connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
        probe.mutate(connection);
        const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
        expect(summary.clockEvidence, probe.label).toEqual(EXACT_APPLIED_AT_MS_EVIDENCE);
        expect(summary.expectedEntryCount, probe.label).toBe(12);
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      connection.execTrusted("PRAGMA ignore_check_constraints = OFF", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("holds the safe-integer boundary of every clock in the frozen evidence", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      for (const unsafe of [-1, APPLIED_AT_MS + 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
        const failure = providerError(
          () => captureSQLiteV1BaselineSourceSummary(connection, unsafe),
        );
        expect(failure.code, String(unsafe)).toBe("GE_CYCLE_STORE_INVALID_ARGUMENT");
      }
      const maximumCapture = captureSQLiteV1BaselineSourceSummary(
        connection,
        Number.MAX_SAFE_INTEGER,
      );
      expect(maximumCapture.clockEvidence).toEqual({
        capturedAtMs: Number.MAX_SAFE_INTEGER,
        maximumNonCursorObservedAtMs: APPLIED_AT_MS,
        providerHighWaterAtMs: APPLIED_AT_MS,
      });
      connection.prepare(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ? WHERE singleton = 1",
        "inspect-schema",
      ).run(Number.MAX_SAFE_INTEGER);
      const highWaterEdge = captureSQLiteV1BaselineSourceSummary(
        connection,
        Number.MAX_SAFE_INTEGER,
      );
      // The retained migration-lock branch is visible in the maximum itself.
      expect(highWaterEdge.clockEvidence).toEqual({
        capturedAtMs: Number.MAX_SAFE_INTEGER,
        maximumNonCursorObservedAtMs: Number.MAX_SAFE_INTEGER,
        providerHighWaterAtMs: Number.MAX_SAFE_INTEGER,
      });
      connection.execTrusted("ROLLBACK", "inspect-schema");

      connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.prepare(
        "UPDATE ge_cycle_schema SET updated_at_ms = ? WHERE singleton = 1",
        "inspect-schema",
      ).run(BEYOND_SAFE_AT_MS);
      const unsafeObservation = providerError(
        () => captureSQLiteV1BaselineSourceSummary(connection, Number.MAX_SAFE_INTEGER),
      );
      expect(unsafeObservation.code).toBe("GE_CYCLE_STORE_CORRUPTION");
      expect(unsafeObservation.message).toMatch(/non-cursor provider clock is invalid/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");

      // A negative high-water keeps the non-cursor maximum in range, so the
      // lock's own lower bound is what rejects the capture.
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.prepare(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = -1 WHERE singleton = 1",
        "inspect-schema",
      ).run();
      const unsafeHighWater = providerError(
        () => captureSQLiteV1BaselineSourceSummary(connection, Number.MAX_SAFE_INTEGER),
      );
      expect(unsafeHighWater.code).toBe("GE_CYCLE_STORE_CORRUPTION");
      expect(unsafeHighWater.message).toMatch(/migration lock high-water is invalid/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");

      // An out-of-range cursor clock belongs to the future Slice B cursor
      // campaign; it is never read by the source query, so capture stays exact.
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      insertStream(connection);
      insertPhysicalCursor(connection, {
        createdAtMs: BEYOND_SAFE_AT_MS,
        expiresAtMs: BEYOND_SAFE_AT_MS + 1n,
        consumedAtMs: BEYOND_SAFE_AT_MS,
      });
      const unownedCursorClock = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(unownedCursorClock.clockEvidence).toEqual(EXACT_APPLIED_AT_MS_EVIDENCE);
      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.execTrusted("PRAGMA ignore_check_constraints = OFF", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("keeps the one-shot iterator transaction-scoped and rejects postcondition drift", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      connection.execTrusted("ROLLBACK", "inspect-schema");
      expect(() => summary.entries()).toThrow(CycleStoreProviderError);

      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const capturedBeforeAppliedAtDrift = captureSQLiteV1BaselineSourceSummary(
        connection,
        APPLIED_AT_MS,
      );
      connection.prepare(
        "UPDATE ge_cycle_schema SET latest_migration_applied_at_ms = ? WHERE singleton = 1",
        "inspect-schema",
      ).run(APPLIED_AT_MS + 1);
      connection.prepare(
        "UPDATE ge_cycle_migrations SET applied_at_ms = ? WHERE version = 1",
        "inspect-schema",
      ).run(APPLIED_AT_MS + 1);
      expect(() => [...capturedBeforeAppliedAtDrift.entries()]).toThrow(
        /captured transaction changed/u,
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");

      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.prepare(`
        INSERT INTO ge_cycle_streams
          (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
        VALUES ('tenant-a', 'stream-a', -1, NULL, ?, ?)
      `, "inspect-schema").run(APPLIED_AT_MS, APPLIED_AT_MS);
      const nonIdentity = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(nonIdentity.expectedEntryCount).toBe(4);
      expect([...nonIdentity.entries()].map((entry) => entry.entryKind)).toEqual([
        "schema-envelope",
        "migration-lineage",
        "stream-head",
        "migration-lock-current",
      ]);
      connection.execTrusted("ROLLBACK", "inspect-schema");

      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.prepare(
        "UPDATE ge_cycle_migrations SET postconditions_blob = ? WHERE version = 1",
        "inspect-schema",
      ).run(Buffer.from('{"requiredPostconditions":["not-the-frozen-contract"]}', "utf8"));
      const drifted = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(() => [...drifted.entries()]).toThrow(CycleStoreProviderError);
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("stops between yields when the owner ends the capture transaction", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const iterator = captureSQLiteV1BaselineSourceSummary(
        connection,
        APPLIED_AT_MS,
      ).entries();
      expect(iterator.next().value?.entryKind).toBe("schema-envelope");
      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.execTrusted("PRAGMA defer_foreign_keys = ON", "inspect-schema");
      expect(() => iterator.next()).toThrow(/captured transaction changed/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("rejects a count-preserving source mutation after capture", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.prepare(`
        INSERT INTO ge_cycle_streams
          (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
        VALUES ('tenant-a', 'stream-a', -1, NULL, ?, ?)
      `, "inspect-schema").run(APPLIED_AT_MS, APPLIED_AT_MS);
      const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      connection.prepare(
        "UPDATE ge_cycle_streams SET stream_id = 'stream-b' WHERE stream_id = 'stream-a'",
        "inspect-schema",
      ).run();
      expect(() => [...summary.entries()]).toThrow(/captured transaction changed/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("rejects prepared TEMP DDL after capture even when total_changes is unchanged", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      connection.prepare(
        "CREATE TEMP TABLE hostile_stage(value INTEGER)",
        "inspect-schema",
      ).run();
      expect(() => [...summary.entries()]).toThrow(/captured transaction changed/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("validates scalar record carriers before omitting their payload bytes", () => {
    const connection = opened();
    try {
      const record = createCycleStoreRecord({
        recordId: "record-a",
        sequence: 0,
        previousRecordHash: null,
        value: 7,
      });
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.prepare(`
        INSERT INTO ge_cycle_streams
          (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
        VALUES (?, ?, -1, NULL, ?, ?)
      `, "inspect-schema").run("tenant-a", "stream-a", APPLIED_AT_MS, APPLIED_AT_MS);
      connection.prepare(`
        INSERT INTO ge_cycle_records
          (tenant_id, stream_id, sequence, record_id, previous_record_hash,
           value_hash, value_bytes, value_blob, record_hash, record_blob, committed_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, "inspect-schema").run(
        "tenant-a",
        "stream-a",
        record.sequence,
        record.recordId,
        record.previousRecordHash,
        record.valueHash,
        record.valueBytes,
        Buffer.from(canonicalSerialize(record.value), "utf8"),
        record.recordHash,
        Buffer.from(canonicalSerialize(record), "utf8"),
        APPLIED_AT_MS,
      );
      connection.prepare(`
        UPDATE ge_cycle_streams
           SET tail_sequence = ?, tail_record_hash = ?
         WHERE tenant_id = ? AND stream_id = ?
      `, "inspect-schema").run(record.sequence, record.recordHash, "tenant-a", "stream-a");

      const checkpoint = createCycleStoreCheckpoint({
        checkpointScope: "scope-a",
        checkpointId: "checkpoint-a",
        streamId: "stream-a",
        boundSequence: record.sequence,
        boundRecordHash: record.recordHash,
        createdAt: "2026-07-28T00:00:00Z",
        value: 0,
      });
      const { value: _value, ...checkpointSummary } = checkpoint;
      const summaryBlob = Buffer.from(
        cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", checkpointSummary),
      );
      connection.prepare(`
        INSERT INTO ge_cycle_checkpoints
          (tenant_id, checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
           bound_record_hash, created_at, value_hash, value_bytes, value_blob,
           checkpoint_blob, summary_blob, checkpoint_revision, committed_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `, "inspect-schema").run(
        "tenant-a",
        checkpoint.checkpointScope,
        checkpoint.checkpointId,
        checkpoint.streamId,
        checkpoint.boundSequence,
        checkpoint.boundRecordHash,
        checkpoint.createdAt,
        checkpoint.valueHash,
        checkpoint.valueBytes,
        Buffer.from(canonicalSerialize(checkpoint.value), "utf8"),
        Buffer.from(canonicalSerialize(checkpoint), "utf8"),
        summaryBlob,
        APPLIED_AT_MS,
      );
      connection.prepare(`
        INSERT INTO ge_cycle_checkpoint_revisions
          (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
           summary_blob, bound_sequence, bound_record_hash,
           checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
        VALUES (?, ?, 1, ?, 'put', ?, ?, ?, ?, ?, ?, ?)
      `, "inspect-schema").run(
        "tenant-a",
        checkpoint.checkpointScope,
        checkpoint.checkpointId,
        summaryBlob,
        checkpoint.boundSequence,
        checkpoint.boundRecordHash,
        checkpoint.createdAt,
        checkpoint.valueHash,
        checkpoint.valueBytes,
        APPLIED_AT_MS,
      );
      connection.prepare(`
        INSERT INTO ge_cycle_checkpoint_revisions
          (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
           summary_blob, bound_sequence, bound_record_hash,
           checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
        VALUES (?, ?, 2, ?, 'delete', NULL, NULL, NULL, NULL, NULL, NULL, ?)
      `, "inspect-schema").run(
        "tenant-a",
        checkpoint.checkpointScope,
        checkpoint.checkpointId,
        APPLIED_AT_MS,
      );
      connection.prepare(`
        INSERT INTO ge_cycle_checkpoint_revisions
          (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
           summary_blob, bound_sequence, bound_record_hash,
           checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
        VALUES (?, ?, 10, ?, 'delete', NULL, NULL, NULL, NULL, NULL, NULL, ?)
      `, "inspect-schema").run(
        "tenant-a",
        checkpoint.checkpointScope,
        checkpoint.checkpointId,
        APPLIED_AT_MS,
      );

      const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(summary.expectedEntryCount).toBe(9);
      const entries = [...summary.entries()];
      expect(entries.map((entry) => entry.entryKind)).toEqual([
        "schema-envelope",
        "migration-lineage",
        "stream-head",
        "record-identity",
        "checkpoint-current",
        "checkpoint-revision",
        "checkpoint-revision",
        "checkpoint-revision",
        "migration-lock-current",
      ]);
      expect(entries[3]).toMatchObject({
        key: { recordId: "record-a", tenantId: "tenant-a" },
        state: { valueBytes: 1, valueHash: record.valueHash, recordHash: record.recordHash },
      });
      expect(entries[4]).toMatchObject({
        key: {
          checkpointId: checkpoint.checkpointId,
          checkpointScope: checkpoint.checkpointScope,
          tenantId: "tenant-a",
        },
        state: { valueBytes: 1, valueHash: checkpoint.valueHash },
      });
      expect(entries[5]).toMatchObject({ state: { action: "put", revision: 1 } });
      expect(entries[6]).toMatchObject({
        state: { action: "delete", revision: 10 },
      });
      expect(entries[7]).toMatchObject({
        state: {
          action: "delete",
          boundRecordHash: null,
          boundSequence: null,
          checkpointCreatedAt: null,
          revision: 2,
          summary: null,
          valueBytes: null,
          valueHash: null,
        },
      });

      const mismatchedSummary = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult(
        "save-checkpoint",
        { ...checkpointSummary, checkpointId: "checkpoint-b" },
      ));
      connection.prepare(
        "UPDATE ge_cycle_checkpoints SET summary_blob = ? WHERE checkpoint_id = ?",
        "inspect-schema",
      ).run(mismatchedSummary, checkpoint.checkpointId);
      const corruptedCheckpoint = captureSQLiteV1BaselineSourceSummary(
        connection,
        APPLIED_AT_MS,
      );
      expect(() => [...corruptedCheckpoint.entries()]).toThrow(
        /checkpoint carrier identity drifted/u,
      );
      connection.prepare(
        "UPDATE ge_cycle_checkpoints SET summary_blob = ? WHERE checkpoint_id = ?",
        "inspect-schema",
      ).run(summaryBlob, checkpoint.checkpointId);
      connection.prepare(`
        UPDATE ge_cycle_checkpoint_revisions
           SET summary_blob = ?
         WHERE checkpoint_scope = ? AND revision = 1
      `, "inspect-schema").run(mismatchedSummary, checkpoint.checkpointScope);
      const corruptedRevision = captureSQLiteV1BaselineSourceSummary(
        connection,
        APPLIED_AT_MS,
      );
      expect(() => [...corruptedRevision.entries()]).toThrow(
        /checkpoint revision identity drifted/u,
      );
      connection.prepare(`
        UPDATE ge_cycle_checkpoint_revisions
           SET summary_blob = ?
         WHERE checkpoint_scope = ? AND revision = 1
      `, "inspect-schema").run(summaryBlob, checkpoint.checkpointScope);

      connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      connection.prepare(`
        UPDATE ge_cycle_checkpoint_revisions
           SET value_hash = ?
         WHERE checkpoint_scope = ? AND revision = 2
      `, "inspect-schema").run(checkpoint.valueHash, checkpoint.checkpointScope);
      const partialDelete = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(() => [...partialDelete.entries()]).toThrow(/delete revision is invalid/u);
      connection.prepare(`
        UPDATE ge_cycle_checkpoint_revisions
           SET value_hash = NULL
         WHERE checkpoint_scope = ? AND revision = 2
      `, "inspect-schema").run(checkpoint.checkpointScope);
      connection.execTrusted("PRAGMA ignore_check_constraints = OFF", "inspect-schema");

      connection.prepare(
        "UPDATE ge_cycle_records SET value_blob = ? WHERE record_id = ?",
        "inspect-schema",
      ).run(Buffer.from("8", "utf8"), record.recordId);
      const corrupted = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(() => [...corrupted.entries()]).toThrow(/record carrier identity drifted/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("streams lease, used identity, and legal-hold scalar families", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.prepare(`
        INSERT INTO ge_cycle_streams
          (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
        VALUES ('tenant-a', 'stream-a', -1, NULL, ?, ?)
      `, "inspect-schema").run(APPLIED_AT_MS, APPLIED_AT_MS);
      connection.prepare(`
        INSERT INTO ge_cycle_leases
          (tenant_id, stream_id, active_lease_id, active_holder_id,
           active_lease_epoch, active_fencing_token, active_acquired_at_ms,
           active_expires_at_ms, last_lease_epoch, last_fencing_token,
           updated_at_ms)
        VALUES ('tenant-a', 'stream-a', 'lease-a', 'holder-a', 1, 1, ?, ?, 1, 1, ?)
      `, "inspect-schema").run(APPLIED_AT_MS, APPLIED_AT_MS + 1, APPLIED_AT_MS);
      connection.prepare(`
        INSERT INTO ge_cycle_used_lease_ids
          (tenant_id, stream_id, lease_id, lease_epoch, fencing_token, first_used_at_ms)
        VALUES ('tenant-a', 'stream-a', 'lease-a', 1, 1, ?)
      `, "inspect-schema").run(APPLIED_AT_MS);
      connection.prepare(`
        INSERT INTO ge_cycle_legal_holds
          (tenant_id, stream_id, hold_id, placed_at_ms)
        VALUES ('tenant-a', 'stream-a', 'hold-a', ?)
      `, "inspect-schema").run(APPLIED_AT_MS);
      connection.prepare(`
        INSERT INTO ge_cycle_used_migration_lock_ids
          (lock_id, lock_epoch, fencing_token, first_used_at_ms)
        VALUES ('lock-a', 1, 1, ?)
      `, "inspect-schema").run(APPLIED_AT_MS);

      const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(summary.expectedEntryCount).toBe(8);
      const entries = [...summary.entries()];
      expect(entries.map((entry) => entry.entryKind)).toEqual([
        "schema-envelope",
        "migration-lineage",
        "stream-head",
        "lease-current",
        "used-lease-identity",
        "legal-hold",
        "migration-lock-current",
        "used-migration-lock-identity",
      ]);
      expect(entries[3]).toMatchObject({
        state: { activeLeaseId: "lease-a", activeLeaseEpoch: 1, lastLeaseEpoch: 1 },
      });
      expect(entries[4]).toMatchObject({ state: { leaseId: "lease-a", fencingToken: 1 } });
      expect(entries[5]).toMatchObject({ state: { holdId: "hold-a" } });
      expect(entries[7]).toMatchObject({ state: { lockId: "lock-a", lockEpoch: 1 } });

      connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      connection.prepare(
        "UPDATE ge_cycle_leases SET active_holder_id = NULL WHERE active_lease_id = 'lease-a'",
        "inspect-schema",
      ).run();
      const partialActive = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(() => [...partialActive.entries()]).toThrow(/lease-current row is invalid/u);
      connection.prepare(
        "UPDATE ge_cycle_leases SET active_holder_id = 'holder-a' WHERE active_lease_id = 'lease-a'",
        "inspect-schema",
      ).run();
      connection.prepare(
        "UPDATE ge_cycle_used_lease_ids SET fencing_token = 2 WHERE lease_id = 'lease-a'",
        "inspect-schema",
      ).run();
      const driftedFence = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(() => [...driftedFence.entries()]).toThrow(
        /used-lease-identity row is invalid/u,
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });

  it("streams all nine legacy operation result carriers without recovering requests", () => {
    const connection = opened();
    try {
      connection.execTrusted("PRAGMA ignore_check_constraints = ON", "inspect-schema");
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const inserted = new Map<string, Buffer>();
      const insert = <K extends CycleStoreMutationOperation>(
        operationId: string,
        operation: K,
        result: CycleStoreLedgerResultByOperation[K],
      ): void => {
        const resultBlob = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult(operation, result));
        inserted.set(operationId, resultBlob);
        connection.prepare(`
          INSERT INTO ge_cycle_operations
            (tenant_id, operation_id, operation_name, request_hash,
             result_blob, result_hash, committed_at_ms)
          VALUES ('tenant-a', ?, ?, ?, ?, ?, ?)
        `, "inspect-schema").run(
          operationId,
          operation,
          createHash("sha256").update(`request:${operationId}`, "utf8").digest("hex"),
          resultBlob,
          canonicalHash(result),
          APPLIED_AT_MS,
        );
      };
      const tail = { exists: true, sequence: 0, recordHash: "c".repeat(64) } as const;
      const lease = {
        leaseId: "lease-a", holderId: "holder-a", leaseEpoch: 1, fencingToken: 1,
        acquiredAt: "2026-07-28T00:00:00Z", expiresAt: "2026-07-28T00:00:01Z",
      } as const;
      insert("op-1", "append", { tail, appendedRecords: 1 });
      insert("op-10", "save-checkpoint", {
        checkpointScope: "scope-a", checkpointId: "checkpoint-a", streamId: "stream-a",
        boundSequence: 0, boundRecordHash: tail.recordHash,
        createdAt: "2026-07-28T00:00:01Z", valueHash: "d".repeat(64), valueBytes: 1,
      });
      insert("op-2", "delete-checkpoint", { deleted: false });
      insert("op-3", "acquire-lease", lease);
      insert("op-4", "renew-lease", lease);
      insert("op-5", "release-lease", {
        status: "released", lease: null, lastLeaseEpoch: 1, lastFencingToken: 1,
      });
      insert("op-6", "set-legal-hold", {
        legalHoldIds: ["hold-a"],
        retentionMode: "retain-authoritative-history",
        archiveMode: "lossless-before-delete",
        compactionMode: "logical-history-preserving",
      });
      insert("op-7", "acquire-migration-lock", {
        lockId: "lock-a", ownerId: "owner-a", sourceSchemaVersion: 1,
        targetSchemaVersion: 2, lockEpoch: 1, fencingToken: 1,
        acquiredAt: "2026-07-28T00:00:00Z", expiresAt: "2026-07-28T00:00:01Z",
      });
      insert("op-8", "release-migration-lock", null);

      const summary = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(summary.expectedEntryCount).toBe(12);
      const entries = [...summary.entries()];
      const legacy = entries.slice(3);
      expect(legacy.map((entry) => (entry.key as { operationId: string }).operationId)).toEqual([
        "op-1", "op-10", "op-2", "op-3", "op-4", "op-5", "op-6", "op-7", "op-8",
      ]);
      expect(legacy.map((entry) => (entry.state as { operationName: string }).operationName)).toEqual([
        "append", "save-checkpoint", "delete-checkpoint", "acquire-lease", "renew-lease",
        "release-lease", "set-legal-hold", "acquire-migration-lock", "release-migration-lock",
      ]);
      for (const entry of legacy) {
        const key = entry.key as { operationId: string };
        const state = entry.state as { resultBlobSha256: string };
        expect(state.resultBlobSha256).toBe(
          createHash("sha256").update(inserted.get(key.operationId)!).digest("hex"),
        );
      }

      connection.prepare(
        "UPDATE ge_cycle_operations SET result_blob = ? WHERE operation_id = 'op-1'",
        "inspect-schema",
      ).run(Buffer.from("PAYLOAD_SENTINEL", "utf8"));
      const malformed = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      try {
        [...malformed.entries()];
        throw new Error("expected malformed legacy carrier rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(CycleStoreProviderError);
        expect(JSON.stringify((error as CycleStoreProviderError).toJSON())).not.toContain(
          "PAYLOAD_SENTINEL",
        );
      }
      connection.prepare(
        "UPDATE ge_cycle_operations SET result_blob = ?, operation_name = 'Append' WHERE operation_id = 'op-1'",
        "inspect-schema",
      ).run(inserted.get("op-1")!);
      const unknownOperation = captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS);
      expect(() => [...unknownOperation.entries()]).toThrow(/legacy operation name is invalid/u);
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      connection.close();
    }
  });
});
