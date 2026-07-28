import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
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
        /schema envelope identity drifted/u,
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
      expect(() => nonIdentity.entries()).toThrow(/identity-only iterator/u);
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
      expect(() => iterator.next()).toThrow(/active transaction/u);
    } finally {
      connection.close();
    }
  });
});
