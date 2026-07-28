import { DatabaseSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { describe, expect, it } from "vitest";

import {
  hardenSQLiteStatement,
  sqliteBlob,
  sqliteBoolean,
  sqliteNullableText,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "../src/sqlite-codec.js";

describe("SQLite storage codec", () => {
  it("forces arrays and BigInt before interpreting a result", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const statement = hardenSQLiteStatement(database.prepare("SELECT 7, 'value', x'0102'"));
      const row = sqliteRow(statement.get(), 3, "read-tail", "test row");
      expect(sqliteSafeInteger(row[0], 0, 10, "read-tail", "integer")).toBe(7);
      expect(sqliteText(row[1], "read-tail", "text")).toBe("value");
      expect(sqliteBlob(row[2], "read-tail", "blob")).toEqual(Buffer.from([1, 2]));
    } finally {
      database.close();
    }
  });

  it("rejects unsafe integer storage before Number conversion", () => {
    expect(() => sqliteSafeInteger(
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      0,
      Number.MAX_SAFE_INTEGER,
      "read-tail",
      "sequence",
    )).toThrowError(CycleStoreProviderError);
    expect(() => sqliteSafeInteger(1, 0, 1, "read-tail", "sequence")).toThrowError(
      CycleStoreProviderError,
    );
  });

  it("requires exact row arity and storage classes", () => {
    expect(() => sqliteRow([1n], 2, "read-tail", "row")).toThrowError(
      CycleStoreProviderError,
    );
    expect(() => sqliteText(Buffer.from("x"), "read-tail", "text")).toThrowError(
      CycleStoreProviderError,
    );
    expect(() => sqliteBlob("x", "read-tail", "blob")).toThrowError(
      CycleStoreProviderError,
    );
  });

  it("decodes nullable text and strict Boolean storage", () => {
    expect(sqliteNullableText(null, "read-tail", "hash")).toBeNull();
    expect(sqliteNullableText("a", "read-tail", "hash")).toBe("a");
    expect(sqliteBoolean(0n, "inspect-lease", "active")).toBe(false);
    expect(sqliteBoolean(1n, "inspect-lease", "active")).toBe(true);
    expect(() => sqliteBoolean(2n, "inspect-lease", "active")).toThrowError(
      CycleStoreProviderError,
    );
  });

  it("keeps prefixed parameter binding strict", () => {
    const database = new DatabaseSync(":memory:");
    try {
      const statement = hardenSQLiteStatement(database.prepare("SELECT $bound"));
      // A bare SELECT parameter retains the input representation; persisted
      // INTEGER columns are the values interpreted by sqliteSafeInteger.
      expect(statement.get({ $bound: 1 })).toEqual([1]);
      expect(() => statement.get({ bound: 1 })).toThrow();
      expect(() => statement.get({ $bound: 1, $unknown: 2 })).toThrow();
    } finally {
      database.close();
    }
  });
});
