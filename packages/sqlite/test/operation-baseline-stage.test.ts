import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SQLITE_BASELINE_TEMP_CACHE_KIB,
  MAX_SQLITE_BASELINE_TEMP_CACHE_KIB,
  MIN_SQLITE_BASELINE_TEMP_CACHE_KIB,
  configureSQLiteBaselineTempStorage,
  proveSQLiteExclusiveBaselineTransaction,
  readSQLiteBaselineTempStorage,
} from "../src/operation-baseline-stage.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";

const temporaryRoots: string[] = [];

function opened(): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-baseline-stage-"));
  temporaryRoots.push(root);
  return new SQLiteConnection(join(root, "cycle-store.db"));
}

function expectProviderError(
  action: () => unknown,
  code: "GE_CYCLE_STORE_INVALID_ARGUMENT" | "GE_CYCLE_STORE_UNAVAILABLE",
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect(error).toMatchObject({ code, operation: "inspect-schema" });
    return;
  }
  throw new Error(`expected ${code}`);
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SQLite operation baseline stage owner", () => {
  it("configures and reads back bounded FILE-backed TEMP storage", () => {
    const connection = opened();
    const exec = vi.spyOn(connection, "execTrusted");
    try {
      const profile = configureSQLiteBaselineTempStorage(connection);
      expect(profile).toEqual({
        tempStore: "file",
        cacheKiB: DEFAULT_SQLITE_BASELINE_TEMP_CACHE_KIB,
        cacheSpill: true,
      });
      expect(readSQLiteBaselineTempStorage(connection)).toEqual(profile);
      expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
        "PRAGMA temp_store = FILE",
        `PRAGMA temp.cache_size = -${DEFAULT_SQLITE_BASELINE_TEMP_CACHE_KIB}`,
        "PRAGMA cache_spill = ON",
      ]);
      expect(exec.mock.calls.some(([sql]) => sql.includes("temp_store_directory"))).toBe(false);
    } finally {
      exec.mockRestore();
      connection.close();
    }
  });

  it("accepts exact TEMP cache boundaries and rejects every outside value", () => {
    const connection = opened();
    try {
      expect(configureSQLiteBaselineTempStorage(connection, {
        cacheKiB: MIN_SQLITE_BASELINE_TEMP_CACHE_KIB,
      }).cacheKiB).toBe(MIN_SQLITE_BASELINE_TEMP_CACHE_KIB);
      expect(configureSQLiteBaselineTempStorage(connection, {
        cacheKiB: MAX_SQLITE_BASELINE_TEMP_CACHE_KIB,
      }).cacheKiB).toBe(MAX_SQLITE_BASELINE_TEMP_CACHE_KIB);
      for (const cacheKiB of [
        MIN_SQLITE_BASELINE_TEMP_CACHE_KIB - 1,
        MAX_SQLITE_BASELINE_TEMP_CACHE_KIB + 1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        expect(() => configureSQLiteBaselineTempStorage(connection, { cacheKiB }))
          .toThrowError(/outside bounds/u);
      }
    } finally {
      connection.close();
    }
  });

  it("rejects TEMP configuration after any transaction begins", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => configureSQLiteBaselineTempStorage(connection)).toThrowError(
        /outside a transaction/u,
      );
      expect(() => readSQLiteBaselineTempStorage(connection)).toThrowError(
        /read outside a transaction/u,
      );
      expect(connection.transactionMode).toBe("exclusive");
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("proves only the active owner EXCLUSIVE epoch", () => {
    const connection = opened();
    try {
      expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );
      for (const begin of ["BEGIN", "BEGIN DEFERRED", "BEGIN IMMEDIATE"] as const) {
        connection.execTrusted(begin, "inspect-schema");
        expect(connection.transactionMode).not.toBe("exclusive");
        expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
          /requires an owner EXCLUSIVE transaction/u,
        );
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      connection.execTrusted(";;/* owner */ BEGIN EXCLUSIVE", "inspect-schema");
      const proof = proveSQLiteExclusiveBaselineTransaction(connection);
      expect(proof).toEqual({
        mode: "exclusive",
        transactionEpoch: connection.transactionEpoch,
      });
      expect(Object.isFrozen(proof)).toBe(true);
      connection.execTrusted("SAVEPOINT nested", "inspect-schema");
      connection.execTrusted("ROLLBACK TO nested", "inspect-schema");
      connection.execTrusted("RELEASE nested", "inspect-schema");
      expect(proveSQLiteExclusiveBaselineTransaction(connection).mode).toBe("exclusive");
      connection.execTrusted("SAVEPOINT nested_long", "inspect-schema");
      connection.execTrusted(
        "ROLLBACK TRANSACTION TO SAVEPOINT nested_long",
        "inspect-schema",
      );
      connection.execTrusted("RELEASE nested_long", "inspect-schema");
      expect(proveSQLiteExclusiveBaselineTransaction(connection).mode).toBe("exclusive");
      connection.execTrusted("ROLLBACK", "inspect-schema");
      expect(connection.transactionMode).toBeNull();
      expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );

      connection.execTrusted("BEGIN /* mode */ EXCLUSIVE /* trailing */", "inspect-schema");
      expect(proveSQLiteExclusiveBaselineTransaction(connection).mode).toBe("exclusive");
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("does not carry EXCLUSIVE proof across a multi-statement transaction swap", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(proveSQLiteExclusiveBaselineTransaction(connection).mode).toBe("exclusive");
      connection.execTrusted(
        "SELECT 1; COMMIT; BEGIN DEFERRED",
        "inspect-schema",
      );
      expect(connection.isTransaction).toBe(true);
      expect(connection.transactionMode).toBe("unknown");
      expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");

      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => connection.execTrusted(
        "COMMIT; BEGIN DEFERRED; SELECT * FROM definitely_missing_table",
        "inspect-schema",
      )).toThrow();
      expect(connection.isTransaction).toBe(true);
      expect(connection.transactionMode).toBe("unknown");
      expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("fails readback drift and forbids temp_store_directory", () => {
    const connection = opened();
    try {
      configureSQLiteBaselineTempStorage(connection);
      connection.execTrusted("PRAGMA temp.cache_size = -512", "inspect-schema");
      expect(() => readSQLiteBaselineTempStorage(connection)).toThrowError(
        /profile was not retained/u,
      );
      expect(() => connection.prepare(
        "/* hostile */ PRAGMA temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        ";; PRAGMA temp.temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "PRAGMA main.\"temp_store_directory\" = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "PRAGMA cache_size; PRAGMA temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "SELECT 1; PRAGMA temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "PRAGMA /* hostile */ temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "PRAGMA [temp_store_directory] = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
    } finally {
      connection.close();
    }
  });

  it("uses stable structured codes for owner, option, directory, and readback failures", () => {
    const connection = opened();
    try {
      expectProviderError(
        () => proveSQLiteExclusiveBaselineTransaction(connection),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      expectProviderError(
        () => configureSQLiteBaselineTempStorage(connection, { cacheKiB: 1 }),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      expectProviderError(
        () => connection.execTrusted("PRAGMA temp_store_directory='/tmp'", "inspect-schema"),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      configureSQLiteBaselineTempStorage(connection);
      connection.execTrusted("PRAGMA temp.cache_size=-1", "inspect-schema");
      expectProviderError(
        () => readSQLiteBaselineTempStorage(connection),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
    } finally {
      connection.close();
    }
  });
});
