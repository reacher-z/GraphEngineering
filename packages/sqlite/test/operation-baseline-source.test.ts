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

import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import {
  OperationBaselineAccumulator,
  createOperationBaselineId,
} from "../src/operation-baseline.js";
import { captureSQLiteV1BaselineSourceSummary } from "../src/operation-baseline-source.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";

const roots: string[] = [];
const APPLIED_AT_MS = 1_785_110_405_000;

function opened(): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-baseline-source-"));
  roots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: APPLIED_AT_MS,
  });
  return connection;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite v1 baseline source summary", () => {
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
      expect(summary.maximumObservedAtMs).toBe(APPLIED_AT_MS);
      expect(Object.isFrozen(summary)).toBe(true);
      expect(Object.isFrozen(summary.countsByKind)).toBe(true);

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
      expect(() => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS - 1)).toThrow(
        CycleStoreProviderError,
      );
      connection.prepare(
        "UPDATE ge_cycle_schema SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1",
        "inspect-schema",
      ).run();
      expect(() => captureSQLiteV1BaselineSourceSummary(connection, APPLIED_AT_MS + 2)).toThrow(
        CycleStoreProviderError,
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");
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
