import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalSerialize } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  cycleStoreAdapterCodec,
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
});
