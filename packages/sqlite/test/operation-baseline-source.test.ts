import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
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
});
