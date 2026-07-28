import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync, type StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SQLITE_BUSY_ATTEMPTS,
  DEFAULT_SQLITE_BUSY_ELAPSED_MS,
  DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
  SQLiteConnection,
} from "../src/sqlite-connection.js";
import { sqliteRow, sqliteSafeInteger, sqliteText } from "../src/sqlite-codec.js";

const temporaryRoots: string[] = [];

function databasePath(name = "cycle-store.db"): string {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-connection-"));
  temporaryRoots.push(root);
  return join(root, name);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SQLiteConnection", () => {
  it("establishes and reads back the fail-closed connection profile", () => {
    const connection = new SQLiteConnection(databasePath());
    try {
      expect(connection.isOpen).toBe(true);
      expect(connection.busyTimeoutMs).toBe(DEFAULT_SQLITE_BUSY_TIMEOUT_MS);
      expect(connection.maxBusyAttempts).toBe(DEFAULT_SQLITE_BUSY_ATTEMPTS);
      expect(connection.maxBusyElapsedMs).toBe(DEFAULT_SQLITE_BUSY_ELAPSED_MS);
      expect(connection.location.endsWith("cycle-store.db")).toBe(true);
      const row = sqliteRow(
        connection.prepare(
          "SELECT sqlite_version(), (SELECT journal_mode FROM pragma_journal_mode)",
          "inspect-schema",
        ).get(),
        2,
        "inspect-schema",
        "profile",
      );
      expect(sqliteText(row[0], "inspect-schema", "version")).toMatch(/^3\./u);
      expect(sqliteText(row[1], "inspect-schema", "journal")).toBe("wal");
    } finally {
      connection.close();
    }
  });

  it("refuses a connection whose required PRAGMA readback drifts", () => {
    const originalPrepare = DatabaseSync.prototype.prepare;
    const prepare = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(
      function prepareWithDrift(this: DatabaseSync, sql: string): StatementSync {
        const prepared = originalPrepare.call(this, sql);
        if (sql !== "PRAGMA foreign_keys") return prepared;
        return new Proxy(prepared, {
          get(target, property) {
            if (property === "get") return () => [0n];
            const value = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
      },
    );
    try {
      expect(() => new SQLiteConnection(databasePath())).toThrowError(
        expect.objectContaining({
          code: "GE_CYCLE_STORE_UNAVAILABLE",
          operation: "inspect-schema",
        }),
      );
    } finally {
      prepare.mockRestore();
    }
  });

  it("commits complete immediate transactions", () => {
    const connection = new SQLiteConnection(databasePath());
    try {
      connection.execTrusted("CREATE TABLE t (value INTEGER NOT NULL) STRICT", "inspect-schema");
      const result = connection.immediate("append", () => {
        connection.prepare("INSERT INTO t (value) VALUES (?)", "append").run(7);
        return "committed";
      });
      expect(result).toBe("committed");
      const row = sqliteRow(
        connection.prepare("SELECT value FROM t", "read-tail").get(),
        1,
        "read-tail",
        "value",
      );
      expect(sqliteSafeInteger(row[0], 0, 10, "read-tail", "value")).toBe(7);
    } finally {
      connection.close();
    }
  });

  it("rolls back every earlier statement when an action fails", () => {
    const connection = new SQLiteConnection(databasePath());
    try {
      connection.execTrusted("CREATE TABLE t (value INTEGER NOT NULL) STRICT", "inspect-schema");
      const failure = new CycleStoreProviderError(
        "GE_CYCLE_STORE_CONFLICT",
        "append",
        "expected conflict",
      );
      expect(() => connection.immediate("append", () => {
        connection.prepare("INSERT INTO t (value) VALUES (?)", "append").run(1);
        throw failure;
      })).toThrow(failure);
      const row = sqliteRow(
        connection.prepare("SELECT count(*) FROM t", "read-tail").get(),
        1,
        "read-tail",
        "count",
      );
      expect(sqliteSafeInteger(row[0], 0, 1, "read-tail", "count")).toBe(0);
    } finally {
      connection.close();
    }
  });

  it("rejects a Promise-returning action and rolls back before its await can escape", () => {
    const connection = new SQLiteConnection(databasePath());
    try {
      connection.execTrusted("CREATE TABLE t (value INTEGER NOT NULL) STRICT", "inspect-schema");
      expect(() => connection.immediate("append", async () => {
        connection.prepare("INSERT INTO t (value) VALUES (?)", "append").run(1);
      })).toThrowError(/must be synchronous/u);
      const row = sqliteRow(
        connection.prepare("SELECT count(*) FROM t", "read-tail").get(),
        1,
        "read-tail",
        "count",
      );
      expect(sqliteSafeInteger(row[0], 0, 1, "read-tail", "count")).toBe(0);
    } finally {
      connection.close();
    }
  });

  it("rejects nested transactions before executing their action", () => {
    const connection = new SQLiteConnection(databasePath());
    try {
      expect(() => connection.immediate("append", () => (
        connection.immediate("save-checkpoint", () => undefined)
      ))).toThrowError(/nested SQLite provider transaction/u);
      expect(connection.isTransaction).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("bounds whole-transaction retries when another writer holds the reservation", () => {
    const path = databasePath();
    const first = new SQLiteConnection(path, {
      busyTimeoutMs: 1,
      maxBusyAttempts: 2,
      maxBusyElapsedMs: 20,
    });
    const second = new SQLiteConnection(path, {
      busyTimeoutMs: 1,
      maxBusyAttempts: 2,
      maxBusyElapsedMs: 20,
    });
    try {
      first.execTrusted("CREATE TABLE t (value INTEGER NOT NULL) STRICT", "inspect-schema");
      first.execTrusted("BEGIN IMMEDIATE", "append");
      try {
        second.immediate("append", () => {
          second.prepare("INSERT INTO t (value) VALUES (?)", "append").run(1);
        });
        throw new Error("expected writer exhaustion");
      } catch (error) {
        expect(error).toBeInstanceOf(CycleStoreProviderError);
        expect(error).toMatchObject({
          code: "GE_CYCLE_STORE_UNAVAILABLE",
          operation: "append",
          details: { attempts: 2 },
        });
      }
      first.execTrusted("ROLLBACK", "append");
    } finally {
      if (first.isTransaction) first.execTrusted("ROLLBACK", "append");
      first.close();
      second.close();
    }
  });

  it("measures the documented synchronous event-loop stall within the busy bound", async () => {
    const path = databasePath();
    const holder = new SQLiteConnection(path, {
      busyTimeoutMs: 25,
      maxBusyAttempts: 1,
      maxBusyElapsedMs: 25,
    });
    const blocked = new SQLiteConnection(path, {
      busyTimeoutMs: 25,
      maxBusyAttempts: 1,
      maxBusyElapsedMs: 25,
    });
    let timerFired = false;
    try {
      holder.execTrusted("CREATE TABLE t (value INTEGER NOT NULL) STRICT", "inspect-schema");
      holder.execTrusted("BEGIN IMMEDIATE", "append");
      const timer = new Promise<void>((resolve) => {
        setTimeout(() => {
          timerFired = true;
          resolve();
        }, 0);
      });
      const startedAt = performance.now();
      expect(() => blocked.immediate("append", () => {
        blocked.prepare("INSERT INTO t (value) VALUES (?)", "append").run(1);
      })).toThrowError(CycleStoreProviderError);
      const blockedForMs = performance.now() - startedAt;

      // DatabaseSync holds the JavaScript thread through SQLite's busy wait.
      // The timer can only fire once the complete synchronous decision returns.
      expect(timerFired).toBe(false);
      expect(blockedForMs).toBeGreaterThanOrEqual(1);
      expect(blockedForMs).toBeLessThan(1_000);
      await timer;
      expect(timerFired).toBe(true);
    } finally {
      if (holder.isTransaction) holder.execTrusted("ROLLBACK", "append");
      holder.close();
      blocked.close();
    }
  });

  it("closes idempotently and returns typed lifecycle errors", () => {
    const connection = new SQLiteConnection(databasePath());
    connection.close();
    connection.close();
    expect(connection.isOpen).toBe(false);
    try {
      connection.prepare("SELECT 1", "read-tail");
      throw new Error("expected close failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CycleStoreProviderError);
      expect(error).toMatchObject({ code: "GE_CYCLE_STORE_UNAVAILABLE", operation: "read-tail" });
    }
  });

  it.each(["", ":memory:", "file::memory:?cache=shared", "bad\0path"])(
    "rejects a non-durable path %j",
    (path) => {
      expect(() => new SQLiteConnection(path)).toThrowError(CycleStoreProviderError);
    },
  );

  it.each([-1, 5_001, 1.5, Number.NaN])("rejects busy timeout %j", (busyTimeoutMs) => {
    expect(() => new SQLiteConnection(databasePath(), { busyTimeoutMs })).toThrowError(
      CycleStoreProviderError,
    );
  });

  it("rejects an internally inconsistent retry budget", () => {
    expect(() => new SQLiteConnection(databasePath(), {
      busyTimeoutMs: 100,
      maxBusyAttempts: 3,
      maxBusyElapsedMs: 299,
    })).toThrowError(CycleStoreProviderError);
  });
});
