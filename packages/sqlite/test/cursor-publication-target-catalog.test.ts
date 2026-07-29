import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
  encodeSQLiteCursorPublicationTargetCatalogRowsIntrinsic,
  readSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
  snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
  validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
  type SQLiteCursorPublicationTargetCatalogObservationInput,
  type SQLiteCursorPublicationTargetCatalogRow,
} from "../src/cursor-publication-target-catalog.js";
import {
  SQLiteConnection,
  prepareSQLiteConnectionCursorPublicationReadIntrinsic,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";

const METADATA_QUERY =
  "SELECT application_id, user_version FROM main.pragma_application_id(), main.pragma_user_version()";
const EXPECTED_QUERY =
  "SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema "
  + "WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL "
  + "ORDER BY type COLLATE BINARY, name COLLATE BINARY";
const EXPECTED_QUERY_SHA256 =
  "bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c";
const EXPECTED_DOMAIN = "graph-engineering/sqlite-target-physical-catalog/v1\0";
const EXPECTED_CATALOG_SHA256 =
  "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf";

interface FixtureCatalogContract {
  readonly expectedApplicationId: number;
  readonly expectedCanonicalRowBytes: number;
  readonly expectedDigestSha256: string;
  readonly expectedInventory: readonly string[];
  readonly expectedRowCount: number;
  readonly expectedUserVersion: number;
}

const FIXTURE = JSON.parse(readFileSync(new URL(
  "../../../spec/conformance/sqlite-cursor-publication-rebind-v2.case.json",
  import.meta.url,
), "utf8")) as {
  readonly authority: {
    readonly postDdlCatalogFence: {
      readonly catalogReadContract: FixtureCatalogContract;
    };
  };
};
const FIXTURE_CATALOG = FIXTURE.authority.postDdlCatalogFence.catalogReadContract;
const SCHEMA_V2_SQL = readFileSync(new URL(
  "../../../spec/migrations/sqlite/schema-v2.sql", import.meta.url,
), "utf8");

const roots: string[] = [];
const connections: SQLiteConnection[] = [];

function freshV2(): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-target-catalog-"));
  roots.push(root);
  const connection = new SQLiteConnection(join(root, "catalog.db"));
  connections.push(connection);
  connection.execTrusted(SCHEMA_V2_SQL, "inspect-schema");
  return connection;
}

function readRows(connection: SQLiteConnection): SQLiteCursorPublicationTargetCatalogRow[] {
  return connection.prepare(
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY, "inspect-schema",
  ).all().map((row) => {
    const values = row as readonly unknown[];
    return {
      name: String(values[1]),
      sql: String(values[3]),
      tableName: String(values[2]),
      type: String(values[0]),
    };
  });
}

function input(
  rows: unknown,
  applicationId: unknown = SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID,
  userVersion: unknown = SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION,
): unknown {
  return { applicationId, rows, userVersion };
}

function expectProviderError(
  callback: () => unknown,
  code: "GE_CYCLE_STORE_INVALID_ARGUMENT" | "GE_CYCLE_STORE_CORRUPTION"
    | "GE_CYCLE_STORE_INTERNAL" | "GE_CYCLE_STORE_UNAVAILABLE",
): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe(code);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code}`);
}

function expectMalformed(rows: unknown): void {
  expectProviderError(
    () => encodeSQLiteCursorPublicationTargetCatalogRowsIntrinsic(rows),
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
  );
  expectProviderError(
    () => snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(input(rows)),
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
  );
}

afterEach(() => {
  for (const connection of connections.splice(0)) {
    try { connection.close(); } catch { /* Preserve the primary assertion. */ }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.sequential("SQLite cursor publication target catalog", () => {
  it("locks every canonical target-catalog fixture commitment", () => {
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY).toBe(EXPECTED_QUERY);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256).toBe(EXPECTED_QUERY_SHA256);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8).toBe(EXPECTED_DOMAIN);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES).toBe(5_785);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT).toBe(34);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256)
      .toBe(EXPECTED_CATALOG_SHA256);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID)
      .toBe(1_195_724_359);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION).toBe(2);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY)
      .toEqual(FIXTURE_CATALOG.expectedInventory);
    expect(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY).toHaveLength(34);
    expect(Object.isFrozen(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY))
      .toBe(true);
    expect(FIXTURE_CATALOG).toMatchObject({
      expectedApplicationId: 1_195_724_359,
      expectedCanonicalRowBytes: 5_785,
      expectedDigestSha256: EXPECTED_CATALOG_SHA256,
      expectedRowCount: 34,
      expectedUserVersion: 2,
    });
  });

  it("observes and validates a fresh real v2 catalog and the exact fixture rows", () => {
    const connection = freshV2();
    const rows = readRows(connection);
    const encoded = encodeSQLiteCursorPublicationTargetCatalogRowsIntrinsic(rows);
    const snapshot = validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      input(rows) as SQLiteCursorPublicationTargetCatalogObservationInput,
    );
    const observed = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection);

    expect(rows).toHaveLength(34);
    expect(encoded).toBe(snapshot.canonicalJson);
    expect(Buffer.byteLength(encoded, "utf8")).toBe(5_785);
    expect(snapshot).toEqual(observed);
    expect(snapshot).toMatchObject({
      applicationId: 1_195_724_359,
      canonicalUtf8Bytes: 5_785,
      catalogSha256: EXPECTED_CATALOG_SHA256,
      inventory: FIXTURE_CATALOG.expectedInventory,
      query: EXPECTED_QUERY,
      querySha256: EXPECTED_QUERY_SHA256,
      rowCount: 34,
      userVersion: 2,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.inventory)).toBe(true);
    expect(Object.isFrozen(snapshot.canonicalRows)).toBe(true);
    expect(snapshot.canonicalRows.every(Object.isFrozen)).toBe(true);
  });

  it("includes uppercase and mixed-case owned views and triggers but excludes unrelated objects", () => {
    const connection = freshV2();
    const baseline = snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      input(readRows(connection)),
    );
    connection.execTrusted(
      "CREATE VIEW main.UNRELATED_CATALOG_VIEW AS SELECT 1 AS value", "inspect-schema",
    );
    expect(snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      input(readRows(connection)),
    ).catalogSha256).toBe(baseline.catalogSha256);

    const statements = [
      ["CREATE VIEW main.GE_CYCLE_Hostile_View AS SELECT 1 AS hostile_value",
        "GE_CYCLE_Hostile_View"],
      ["CREATE VIEW main.Ge_CyClE_Hostile_View_Two AS SELECT 2 AS hostile_value",
        "Ge_CyClE_Hostile_View_Two"],
      ["CREATE TRIGGER main.GE_CYCLE_Hostile_Trigger AFTER INSERT ON main.ge_cycle_schema BEGIN SELECT 1; END",
        "GE_CYCLE_Hostile_Trigger"],
      ["CREATE TRIGGER main.Ge_CyClE_Hostile_Trigger_Two AFTER INSERT ON main.ge_cycle_schema BEGIN SELECT 2; END",
        "Ge_CyClE_Hostile_Trigger_Two"],
    ] as const;
    let prior = baseline;
    for (const [statement, expectedName] of statements) {
      connection.execTrusted(statement, "inspect-schema");
      const next = snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
        input(readRows(connection)),
      );
      expect(next.rowCount).toBe(prior.rowCount + 1);
      expect(next.catalogSha256).not.toBe(prior.catalogSha256);
      expect(next.inventory.some((identity) => identity.includes(`:${expectedName}:`)))
        .toBe(true);
      prior = next;
    }
    expect(prior.rowCount).toBe(38);
    expectProviderError(
      () => validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
        input(readRows(connection)),
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );
  });

  it("rejects missing, extra, duplicate, renamed, equal-count replacement and reordered rows", () => {
    const rows = readRows(freshV2());
    const replacement = { ...rows[0]!, name: `${rows[0]!.name}_replacement` };
    const mutations = [
      rows.slice(1),
      [...rows, replacement],
      [...rows, rows[0]!],
      [{ ...rows[0]!, name: `${rows[0]!.name}_renamed` }, ...rows.slice(1)],
      [replacement, ...rows.slice(1)],
      [rows[1]!, rows[0]!, ...rows.slice(2)],
    ];
    for (const mutation of mutations) {
      const detached = snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
        input(mutation),
      );
      expect(detached.catalogSha256).not.toBe(EXPECTED_CATALOG_SHA256);
      expectProviderError(
        () => validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(input(mutation)),
        "GE_CYCLE_STORE_CORRUPTION",
      );
    }
    for (const [applicationId, userVersion] of [[1, 2], [1_195_724_359, 1]]) {
      expectProviderError(
        () => validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
          input(rows, applicationId, userVersion),
        ),
        "GE_CYCLE_STORE_CORRUPTION",
      );
    }
  });

  it("hashes SQL text byte-for-byte without whitespace normalization", () => {
    const base = [{ name: "ge_cycle_probe", sql: "CREATE TABLE ge_cycle_probe (id INTEGER)",
      tableName: "ge_cycle_probe", type: "table" }];
    const whitespace = [{ ...base[0]!, sql: `${base[0]!.sql} ` }];
    const left = snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(input(base));
    const right = snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      input(whitespace),
    );
    expect(left.canonicalRows[0]!.sqlSha256).not.toBe(right.canonicalRows[0]!.sqlSha256);
    expect(left.catalogSha256).not.toBe(right.catalogSha256);
    expect(left.canonicalJson).not.toBe(right.canonicalJson);

    const rows = readRows(freshV2());
    const sqlDrift = [{ ...rows[0]!, sql: `${rows[0]!.sql}\n` }, ...rows.slice(1)];
    expectProviderError(
      () => validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(input(sqlDrift)),
      "GE_CYCLE_STORE_CORRUPTION",
    );
  });

  it("rejects malformed row shapes, scalar types, lone surrogates and hostile arrays", () => {
    const valid = { name: "ge_cycle_probe", sql: "CREATE TABLE ge_cycle_probe (id INTEGER)",
      tableName: "ge_cycle_probe", type: "table" };
    const sparse: unknown[] = [];
    sparse.length = 1;
    class RowArray extends Array<unknown> {}
    const symbolRow = { ...valid } as Record<PropertyKey, unknown>;
    Object.defineProperty(symbolRow, Symbol("extra"), { value: true });
    for (const hostile of [
      null, undefined, {}, valid, sparse, new RowArray(valid),
      [{}], [{ ...valid, extra: true }], [{ name: valid.name, sql: valid.sql,
        tableName: valid.tableName }],
      [{ ...valid, name: 1 }], [{ ...valid, sql: null }], [{ ...valid, tableName: [] }],
      [{ ...valid, type: true }], [{ ...valid, name: "bad\uD800" }],
      [{ ...valid, sql: "bad\uDC00" }], [symbolRow],
    ]) expectMalformed(hostile);
  });

  it("rejects live and revoked proxies and accessors without invoking traps or getters", () => {
    let trapCalls = 0;
    const handler: ProxyHandler<object> = {
      get: () => { trapCalls += 1; throw new Error("proxy get trap reached"); },
      getOwnPropertyDescriptor: () => {
        trapCalls += 1;
        throw new Error("proxy descriptor trap reached");
      },
      getPrototypeOf: () => { trapCalls += 1; throw new Error("proxy proto trap reached"); },
      ownKeys: () => { trapCalls += 1; throw new Error("proxy keys trap reached"); },
    };
    const row = { name: "ge_cycle_probe", sql: "CREATE TABLE ge_cycle_probe (id INTEGER)",
      tableName: "ge_cycle_probe", type: "table" };
    const revokedRow = Proxy.revocable(row, handler);
    revokedRow.revoke();
    const revokedRows = Proxy.revocable([row], handler);
    revokedRows.revoke();
    for (const hostile of [
      [new Proxy(row, {})],
      [new Proxy(row, handler)],
      [revokedRow.proxy],
      new Proxy([row], handler),
      revokedRows.proxy,
    ]) expectMalformed(hostile);
    expect(trapCalls).toBe(0);

    let getterCalls = 0;
    const accessor = { name: row.name, sql: row.sql, tableName: row.tableName } as
      Record<string, unknown>;
    Object.defineProperty(accessor, "type", {
      enumerable: true,
      get: () => { getterCalls += 1; return "table"; },
    });
    expectMalformed([accessor]);
    expect(getterCalls).toBe(0);
  });

  it("bypasses mutable driver hooks and performs no write side effect", () => {
    const connection = freshV2();
    const before = readSQLiteConnectionTotalChangesSnapshot(connection);
    const prepared: string[] = [];
    const executed: string[] = [];
    const native = DatabaseSync.prototype as unknown as {
      exec(sql: string): void;
      prepare(sql: string): unknown;
    };
    const originalExec = native.exec;
    const originalPrepare = native.prepare;
    try {
      native.exec = function (sql: string): void {
        executed.push(sql);
        return Reflect.apply(originalExec, this, [sql]);
      };
      native.prepare = function (sql: string): unknown {
        prepared.push(sql);
        return Reflect.apply(originalPrepare, this, [sql]);
      };
      readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection);
    } finally {
      native.exec = originalExec;
      native.prepare = originalPrepare;
    }
    const after = readSQLiteConnectionTotalChangesSnapshot(connection);
    expect(executed).toEqual([]);
    expect(prepared).toEqual([]);
    expect(after).toEqual(before);
  });

  it("uses captured base preparation and rejects forged connection brands", () => {
    class PrepareTrapConnection extends SQLiteConnection {
      prepareCallCount = 0;

      override prepare(
        ...parameters: Parameters<SQLiteConnection["prepare"]>
      ): ReturnType<SQLiteConnection["prepare"]> {
        this.prepareCallCount += 1;
        throw new Error(`public prepare override reached: ${String(parameters[0])}`);
      }
    }
    const root = mkdtempSync(join(tmpdir(), "graph-engineering-target-catalog-subclass-"));
    roots.push(root);
    const connection = new PrepareTrapConnection(join(root, "catalog.db"));
    connections.push(connection);
    connection.execTrusted(SCHEMA_V2_SQL, "inspect-schema");

    expect(readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection))
      .toMatchObject({ catalogSha256: EXPECTED_CATALOG_SHA256, rowCount: 34 });
    expect(connection.prepareCallCount).toBe(0);

    const forged = Object.create(SQLiteConnection.prototype) as SQLiteConnection;
    expectProviderError(
      () => readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(forged),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
  });

  it("rejects a same-name foreign native next before the first connection capture", async () => {
    const probe = new DatabaseSync(":memory:");
    const statementIterator = probe.prepare("SELECT 1").iterate();
    const statementIteratorPrototype = Object.getPrototypeOf(statementIterator) as {
      next(): IteratorResult<unknown>;
    };
    const originalNext = statementIteratorPrototype.next;
    const arrayNext = (Object.getPrototypeOf([][Symbol.iterator]()) as {
      next(): IteratorResult<unknown>;
    }).next;
    statementIterator.return();
    probe.close();
    const root = mkdtempSync(join(tmpdir(), "graph-engineering-target-catalog-capture-"));
    roots.push(root);
    try {
      statementIteratorPrototype.next = arrayNext;
      vi.resetModules();
      const freshModule = await import("../src/sqlite-connection.js");
      try {
        new freshModule.SQLiteConnection(join(root, "capture.db"));
        throw new Error("expected constructor capture rejection");
      } catch (error) {
        expect(error).toMatchObject({
          code: "GE_CYCLE_STORE_INTERNAL",
          operation: "inspect-schema",
        });
      }
    } finally {
      statementIteratorPrototype.next = originalNext;
      vi.resetModules();
    }
  });

  it("preserves unavailable for a closed branded connection", () => {
    const connection = freshV2();
    connection.close();
    expectProviderError(
      () => readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection),
      "GE_CYCLE_STORE_UNAVAILABLE",
    );
  });

  it("rejects every non-allowlisted captured native-read kind", () => {
    const connection = freshV2();
    for (const kind of ["", "arbitrary-select", "write"] as const) {
      expectProviderError(
        () => prepareSQLiteConnectionCursorPublicationReadIntrinsic(
          connection,
          kind as "cursor-publication-target-catalog",
          "inspect-schema",
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
    }
    expect(readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection).rowCount)
      .toBe(34);
  });

  it("is detached plain data rather than hidden identity authority", () => {
    const rows = readRows(freshV2());
    const snapshot = validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      input(rows),
    );
    const originalName = snapshot.canonicalRows[0]!.name;
    rows[0] = { ...rows[0]!, name: "mutated_after_snapshot" };

    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype);
    expect(Object.keys(snapshot)).toEqual([
      "applicationId", "canonicalJson", "canonicalRows", "canonicalUtf8Bytes",
      "catalogSha256", "inventory", "query", "querySha256", "rowCount", "userVersion",
    ]);
    expect(Object.getOwnPropertySymbols(snapshot)).toEqual([]);
    expect(snapshot.canonicalRows[0]!.name).toBe(originalName);
    expect(Object.keys(snapshot.canonicalRows[0]!))
      .toEqual(["name", "sqlSha256", "tableName", "type"]);
    expect(Object.getPrototypeOf(snapshot.canonicalRows[0]!)).toBe(Object.prototype);
    for (const forbidden of ["connection", "statement", "iterator", "receipt", "lease"]) {
      expect(Object.prototype.hasOwnProperty.call(snapshot, forbidden)).toBe(false);
    }

    const reconstructedRows = JSON.parse(JSON.stringify(readRows(freshV2()))) as unknown;
    expect(validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      input(reconstructedRows),
    )).toEqual(validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      input(readRows(freshV2())),
    ));
  });

  it("does not depend on mutable Array prototype helpers", () => {
    const connection = freshV2();
    const rows = readRows(connection);
    const keys = ["includes", "push", "join", Symbol.iterator] as const;
    const descriptors = keys.map((key) => Object.getOwnPropertyDescriptor(
      Array.prototype, key,
    ));
    const numericDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let pure: ReturnType<typeof validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic>
      | undefined;
    let observed: ReturnType<typeof readSQLiteCursorPublicationTargetCatalogObservationIntrinsic>
      | undefined;
    try {
      for (const key of keys) {
        Object.defineProperty(Array.prototype, key, {
          configurable: true,
          value: () => { throw new Error(`ambient Array.${String(key)} reached`); },
          writable: true,
        });
      }
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set: () => { throw new Error("ambient Array numeric setter reached"); },
      });
      pure = validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(input(rows));
      observed = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection);
    } finally {
      for (let index = 0; index < keys.length; index += 1) {
        const descriptor = descriptors[index];
        if (descriptor !== undefined) Object.defineProperty(Array.prototype, keys[index]!, descriptor);
      }
      if (numericDescriptor === undefined) delete (Array.prototype as { 0?: unknown })[0];
      else Object.defineProperty(Array.prototype, "0", numericDescriptor);
    }
    expect(pure?.catalogSha256).toBe(EXPECTED_CATALOG_SHA256);
    expect(observed).toEqual(pure);
    for (let index = 0; index < keys.length; index += 1) {
      expect(Object.getOwnPropertyDescriptor(Array.prototype, keys[index]!))
        .toEqual(descriptors[index]);
    }
    expect(Object.getOwnPropertyDescriptor(Array.prototype, "0")).toEqual(numericDescriptor);
  });

  it("caps at 35 rows without consulting mutable native iterator prototypes", () => {
    const connection = freshV2();
    let extraSql = "";
    for (let index = 0; index < 70; index += 1) {
      extraSql += `CREATE VIEW main.GE_CYCLE_Overflow_${index} AS SELECT ${index} AS value;`;
    }
    connection.execTrusted(extraSql, "inspect-schema");

    const probe = new DatabaseSync(":memory:");
    const probeIterator = probe.prepare("SELECT 1").iterate();
    const iteratorPrototype = Object.getPrototypeOf(probeIterator) as {
      next(): IteratorResult<unknown>;
      return(): IteratorResult<unknown>;
    };
    const originalNext = iteratorPrototype.next;
    const originalReturn = iteratorPrototype.return;
    const statementPrototype = StatementSync.prototype;
    const originalIterate = statementPrototype.iterate;
    const originalGet = statementPrototype.get;
    const originalBare = statementPrototype.setAllowBareNamedParameters;
    const originalUnknown = statementPrototype.setAllowUnknownNamedParameters;
    const originalBigInts = statementPrototype.setReadBigInts;
    const originalArrays = statementPrototype.setReturnArrays;
    const originalReflectApply = Reflect.apply;
    probeIterator.return();
    probe.close();
    let nextCount = 0;
    let returnCount = 0;
    let snapshot: ReturnType<typeof readSQLiteCursorPublicationTargetCatalogObservationIntrinsic>
      | undefined;
    try {
      iteratorPrototype.next = function (): IteratorResult<unknown> {
        nextCount += 1;
        throw new Error("mutable iterator next reached");
      };
      iteratorPrototype.return = function (): IteratorResult<unknown> {
        returnCount += 1;
        throw new Error("mutable iterator return reached");
      };
      const statementTrap = (): never => { throw new Error("mutable statement method reached"); };
      statementPrototype.iterate = statementTrap;
      statementPrototype.get = statementTrap;
      statementPrototype.setAllowBareNamedParameters = statementTrap;
      statementPrototype.setAllowUnknownNamedParameters = statementTrap;
      statementPrototype.setReadBigInts = statementTrap;
      statementPrototype.setReturnArrays = statementTrap;
      Reflect.apply = (() => {
        throw new Error("mutable Reflect.apply reached");
      }) as typeof Reflect.apply;
      snapshot = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection);
    } finally {
      Reflect.apply = originalReflectApply;
      iteratorPrototype.next = originalNext;
      iteratorPrototype.return = originalReturn;
      statementPrototype.iterate = originalIterate;
      statementPrototype.get = originalGet;
      statementPrototype.setAllowBareNamedParameters = originalBare;
      statementPrototype.setAllowUnknownNamedParameters = originalUnknown;
      statementPrototype.setReadBigInts = originalBigInts;
      statementPrototype.setReturnArrays = originalArrays;
    }
    expect(snapshot?.rowCount).toBe(35);
    expect(nextCount).toBe(0);
    expect(returnCount).toBe(0);
  });

  it("reads main metadata despite hostile TEMP pragma-name shadow tables", () => {
    const connection = freshV2();
    connection.execTrusted(`
      CREATE TEMP TABLE pragma_application_id(application_id INTEGER NOT NULL);
      CREATE TEMP TABLE pragma_user_version(user_version INTEGER NOT NULL);
      INSERT INTO pragma_application_id(application_id) VALUES (999);
      INSERT INTO pragma_user_version(user_version) VALUES (777);
    `, "inspect-schema");
    expect(readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection))
      .toMatchObject({
        applicationId: SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID,
        catalogSha256: EXPECTED_CATALOG_SHA256,
        userVersion: SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION,
      });
  });

  it("caps hostile owned inventory observation and leaves the connection usable", () => {
    const connection = freshV2();
    connection.execTrusted(
      "CREATE VIEW main.GE_CYCLE_Extra_View AS SELECT 1 AS hostile_value", "inspect-schema",
    );
    const snapshot = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection);
    expect(snapshot.rowCount).toBe(35);
    expectProviderError(
      () => validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic({
        applicationId: snapshot.applicationId,
        rows: readRows(connection),
        userVersion: snapshot.userVersion,
      }),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    connection.execTrusted("DROP VIEW main.GE_CYCLE_Extra_View", "inspect-schema");
    expect(readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection).rowCount)
      .toBe(34);
  });

  it("keeps every target-catalog type, constant and intrinsic off the package root", () => {
    const names = [
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY",
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256",
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8",
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES",
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT",
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY",
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256",
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID",
      "SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION",
      "SQLiteCursorPublicationTargetCatalogRow",
      "SQLiteCursorPublicationTargetCatalogCanonicalRow",
      "SQLiteCursorPublicationTargetCatalogObservationInput",
      "SQLiteCursorPublicationTargetCatalogSnapshot",
      "encodeSQLiteCursorPublicationTargetCatalogRowsIntrinsic",
      "snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic",
      "validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic",
      "readSQLiteCursorPublicationTargetCatalogObservationIntrinsic",
    ] as const;
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    for (const name of names) {
      expect(Object.keys(sqliteRoot)).not.toContain(name);
      expect(source).not.toContain(name);
    }
  });

  it("statically exposes only catalog observation and no migration or authority capability", () => {
    const source = readFileSync(new URL(
      "../src/cursor-publication-target-catalog.ts", import.meta.url,
    ), "utf8");
    const connectionSource = readFileSync(new URL(
      "../src/sqlite-connection.ts", import.meta.url,
    ), "utf8");
    expect(connectionSource).toContain(EXPECTED_QUERY);
    expect(connectionSource).toContain(METADATA_QUERY);
    expect(source).toContain("SQLITE_CURSOR_PUBLICATION_CATALOG_NATIVE_QUERY_INTRINSIC");
    expect(source).not.toContain("0002-v1-to-v2-operation-replay.sql");
    expect(source).not.toContain("execTrusted");
    expect(source).not.toMatch(/\.all\s*\(/u);
    expect(source).not.toMatch(/\bconnection\.prepare\s*\(/u);
    expect(source.match(/prepareSQLiteConnectionCursorPublicationReadIntrinsic\s*\(/gu))
      .toHaveLength(2);
    expect(source).toMatch(
      /prepareSQLiteConnectionCursorPublicationReadIntrinsic\(\s*connection,\s*"cursor-publication-target-catalog",\s*OPERATION,?\s*\)/u,
    );
    expect(source).toMatch(
      /prepareSQLiteConnectionCursorPublicationReadIntrinsic\(\s*connection,\s*"cursor-publication-target-metadata",\s*OPERATION,?\s*\)/u,
    );
    expect(source).not.toMatch(/\.run\s*\(/u);
    expect(source).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/u);
    expect(source).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/u);
    expect(source).not.toContain("cursor-rebind");
    expect(source).not.toMatch(/(?:Fence|ReaderLease|mint.*Authority|adopt.*Stage)/u);
    expect(source).not.toContain("cursor-publication-outer-authority");
    expect(source).not.toContain("operation-baseline-cursor-stage-ownership");
  });
});
