import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  CycleStoreProviderError,
  createCycleStoreRecord,
  type CycleStoreAuthorizationContext,
} from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteCycleStoreProvider } from "../src/sqlite-cycle-store.js";
import {
  checkpointSQLiteCycleStoreWal,
  type SQLiteWalCheckpointMode,
} from "../src/wal-checkpoint.js";

const AUTH: CycleStoreAuthorizationContext = Object.freeze({
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const temporaryRoots: string[] = [];

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-checkpoint-"));
  temporaryRoots.push(root);
  return join(root, "store.db");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("checked SQLite WAL checkpoints", () => {
  it("returns the complete SQLite status row on success", async () => {
    const path = databasePath();
    const provider = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    try {
      const record = createCycleStoreRecord({
        recordId: "record-a",
        sequence: 0,
        previousRecordHash: null,
        value: { value: true },
      });
      await provider.append({
        context: { ...AUTH, operationId: "append-a" },
        streamId: "stream-a",
        expectedTail: { exists: false, sequence: -1, recordHash: null },
        lease: null,
        records: [record],
      });
      expect(checkpointSQLiteCycleStoreWal(path, "PASSIVE")).toMatchObject({
        mode: "PASSIVE",
        busy: 0,
      });
    } finally {
      provider.close();
    }
  });

  it("rejects a returned busy row instead of treating no throw as success", async () => {
    const path = databasePath();
    const provider = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    const first = createCycleStoreRecord({
      recordId: "record-0",
      sequence: 0,
      previousRecordHash: null,
      value: { sequence: 0 },
    });
    await provider.append({
      context: { ...AUTH, operationId: "append-0" },
      streamId: "stream-a",
      expectedTail: { exists: false, sequence: -1, recordHash: null },
      lease: null,
      records: [first],
    });
    const reader = new DatabaseSync(path, { readOnly: true });
    try {
      reader.exec("BEGIN");
      reader.prepare("SELECT count(*) FROM ge_cycle_records").get();
      const second = createCycleStoreRecord({
        recordId: "record-1",
        sequence: 1,
        previousRecordHash: first.recordHash,
        value: { sequence: 1 },
      });
      await provider.append({
        context: { ...AUTH, operationId: "append-1" },
        streamId: "stream-a",
        expectedTail: { exists: true, sequence: 0, recordHash: first.recordHash },
        lease: null,
        records: [second],
      });
      expect(() => checkpointSQLiteCycleStoreWal(path, "TRUNCATE")).toThrowError(
        expect.objectContaining({
          code: "GE_CYCLE_STORE_UNAVAILABLE",
          operation: "inspect-schema",
        }),
      );
      reader.exec("ROLLBACK");
      expect(checkpointSQLiteCycleStoreWal(path, "TRUNCATE")).toMatchObject({
        mode: "TRUNCATE",
        busy: 0,
      });
    } finally {
      if (reader.isTransaction) reader.exec("ROLLBACK");
      reader.close();
      provider.close();
    }
  });

  it("rejects an untrusted checkpoint mode before it can become SQL", () => {
    const path = databasePath();
    const provider = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    try {
      expect(() => checkpointSQLiteCycleStoreWal(
        path,
        "TRUNCATE); PRAGMA writable_schema=ON; --" as SQLiteWalCheckpointMode,
      )).toThrowError(CycleStoreProviderError);
      const database = new DatabaseSync(path, { readOnly: true });
      try {
        expect(database.isOpen).toBe(true);
      } finally {
        database.close();
      }
    } finally {
      provider.close();
    }
  });
});
