import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
  type SQLiteCursorPublicationRebindParameters,
} from "../src/cursor-publication-rebind-contract.js";
import {
  beginSQLiteConnectionCursorRebindExecutionIntrinsic,
  executeSQLiteConnectionCursorRebindIntrinsic,
  injectSQLiteConnectionCursorRebindCleanupFaultForTestIntrinsic,
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
  releaseSQLiteConnectionCursorRebindExecutionIntrinsic,
  type SQLiteConnectionCursorRebindExecution,
} from "../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const SOURCE_DESCRIPTOR = "1".repeat(64);
const SOURCE_SCHEMA = "2".repeat(64);
const TARGET_DESCRIPTOR = "3".repeat(64);
const TARGET_SCHEMA = "4".repeat(64);
const PRINCIPAL_HASH = "5".repeat(64);
const AUTHORIZATION_HASH = "6".repeat(64);

const graphs: ReaderLeaseTestGraph[] = [];

function graphWithCursors(count = 2): ReaderLeaseTestGraph {
  const graph = createReaderLeaseTestGraph(1);
  graphs.push(graph);
  insertCursorRows(graph, count);
  return graph;
}

function insertCursorRows(graph: ReaderLeaseTestGraph, count: number): void {
  const insert = graph.connection.prepare(
    `INSERT INTO main.ge_cycle_cursors
       (tenant_id, token_hash, kind, principal_hash, authorization_hash,
        stream_id, checkpoint_scope, request_scope_blob, page_size,
        next_position, snapshot_tail_sequence, snapshot_tail_record_hash,
        descriptor_hash, schema_identity_sha256, snapshot_blob, created_at_ms,
        expires_at_ms, consumed_at_ms)
     VALUES (?, ?, 'checkpoint', ?, ?, NULL, ?, ?, 10, 0, NULL, NULL, ?, ?, ?,
             1000, 2000, NULL)`,
    "inspect-schema",
  );
  for (let index = 0; index < count; index += 1) {
    insert.run(
      `tenant-${index}`,
      (index + 7).toString(16).padStart(64, "0"),
      PRINCIPAL_HASH,
      AUTHORIZATION_HASH,
      `scope-${index}`,
      Buffer.from("{}"),
      SOURCE_DESCRIPTOR,
      SOURCE_SCHEMA,
      Buffer.from("{}"),
    );
  }
}

type SQLiteConnectionModule = typeof import("../src/sqlite-connection.js");
type CleanGraphModule = typeof import("./support/cursor-publication-clean-graph.js");
type RuntimeModule = typeof import("@graph-engineering/runtime");

async function withDefinitionTimeRebindCaptures(
  captures: Readonly<{
    all?: StatementSync["all"];
    prepare?: DatabaseSync["prepare"];
  }>,
  callback: (
    connectionModule: SQLiteConnectionModule,
    graph: ReaderLeaseTestGraph,
    runtimeModule: RuntimeModule,
  ) => void | Promise<void>,
): Promise<void> {
  const allDescriptor = Object.getOwnPropertyDescriptor(StatementSync.prototype, "all")!;
  const prepareDescriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, "prepare")!;
  let supportModule: CleanGraphModule | undefined;
  let graph: ReaderLeaseTestGraph | undefined;
  vi.resetModules();
  try {
    if (captures.all !== undefined) {
      Object.defineProperty(StatementSync.prototype, "all", {
        ...allDescriptor,
        value: captures.all,
      });
    }
    if (captures.prepare !== undefined) {
      Object.defineProperty(DatabaseSync.prototype, "prepare", {
        ...prepareDescriptor,
        value: captures.prepare,
      });
    }
    const connectionModule = await import("../src/sqlite-connection.js");
    Object.defineProperty(StatementSync.prototype, "all", allDescriptor);
    Object.defineProperty(DatabaseSync.prototype, "prepare", prepareDescriptor);
    const runtimeModule = await import("@graph-engineering/runtime");
    supportModule = await import("./support/cursor-publication-clean-graph.js");
    graph = supportModule.createReaderLeaseTestGraph(1);
    insertCursorRows(graph, 2);
    await callback(connectionModule, graph, runtimeModule);
  } finally {
    Object.defineProperty(StatementSync.prototype, "all", allDescriptor);
    Object.defineProperty(DatabaseSync.prototype, "prepare", prepareDescriptor);
    if (supportModule !== undefined && graph !== undefined) {
      supportModule.disposeReaderLeaseTestGraph(graph);
    }
    vi.resetModules();
  }
}

function parameters(
  overrides: Partial<SQLiteCursorPublicationRebindParameters> = {},
): SQLiteCursorPublicationRebindParameters {
  return Object.freeze({
    targetDescriptorHash: TARGET_DESCRIPTOR,
    targetSchemaIdentitySha256: TARGET_SCHEMA,
    sourceDescriptorHash: SOURCE_DESCRIPTOR,
    sourceSchemaIdentitySha256: SOURCE_SCHEMA,
    ...overrides,
  });
}

function begin(graph: ReaderLeaseTestGraph): SQLiteConnectionCursorRebindExecution {
  return beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
}

function expectProviderError(
  callback: () => unknown,
  code: string,
  message: RegExp,
): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe(code);
    expect((error as Error).message).toMatch(message);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code}`);
}

function expectDynamicProviderError(
  callback: () => unknown,
  code: string,
  message: RegExp,
): Readonly<{ readonly code: string; readonly message: string }> {
  try {
    callback();
  } catch (error) {
    expect(error).toBeTypeOf("object");
    expect(error).not.toBeNull();
    const projected = error as Readonly<{ readonly code: string; readonly message: string }>;
    expect(projected.code).toBe(code);
    expect(projected.message).toMatch(message);
    return projected;
  }
  throw new Error(`expected dynamic ${code}`);
}

function expectPoisonedChangesProofSnapshot(
  connectionModule: SQLiteConnectionModule,
  graph: ReaderLeaseTestGraph,
  execution: SQLiteConnectionCursorRebindExecution,
  changesCounts: readonly [0 | 1, 0 | 1, 0 | 1],
  totalChangesDelta = 2,
): void {
  expect(connectionModule.readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
    graph.connection,
    execution,
  )).toMatchObject({
    affectedRows: 2,
    changesAffectedRows: null,
    changesFetchCount: changesCounts[1],
    changesPrepareCount: changesCounts[0],
    changesReleaseCount: changesCounts[2],
    cursorLedgerAffectedRowsWatermark: 2,
    cursorLedgerFixedStatementCount: 1,
    cursorLedgerLogicalWriteSequence: 1,
    executeCount: 1,
    lifecycle: "poisoned",
    releaseCount: 1,
    statementOwnershipRetired: true,
    totalChangesDelta,
  });
}

const outerProxyTraps = { count: 0 };
const rowProxyTraps = { count: 0 };
const outerAccessorGets = { count: 0 };
const rowAccessorGets = { count: 0 };

const hostileChangesProofs: readonly Readonly<{
  readonly name: string;
  readonly makeResult: () => unknown;
  readonly message: RegExp;
}>[] = [
  { name: "zero rows", makeResult: () => [], message: /changes proof is invalid/u },
  {
    name: "two rows",
    makeResult: () => [[2n], [2n]],
    message: /changes proof is invalid/u,
  },
  {
    name: "outer Array subclass",
    makeResult: () => {
      class HostileOuterArray extends Array<unknown> {}
      const value = new HostileOuterArray();
      value.push([2n]);
      if (!Array.isArray(value)) throw new Error("Array subclass probe drifted");
      return value;
    },
    message: /changes proof is invalid/u,
  },
  {
    name: "outer Array Proxy",
    makeResult: () => new Proxy([[2n]], {
      get() { outerProxyTraps.count += 1; throw new Error("outer proxy get trap"); },
      getOwnPropertyDescriptor() {
        outerProxyTraps.count += 1;
        throw new Error("outer proxy descriptor trap");
      },
      getPrototypeOf() {
        outerProxyTraps.count += 1;
        throw new Error("outer proxy prototype trap");
      },
      ownKeys() { outerProxyTraps.count += 1; throw new Error("outer proxy keys trap"); },
    }),
    message: /changes proof is invalid/u,
  },
  {
    name: "sparse outer Array",
    makeResult: () => new Array<unknown>(1),
    message: /changes proof is invalid/u,
  },
  {
    name: "outer index accessor",
    makeResult: () => {
      const value: unknown[] = [];
      Object.defineProperty(value, "0", {
        configurable: true,
        enumerable: true,
        get() { outerAccessorGets.count += 1; return [2n]; },
      });
      return value;
    },
    message: /changes proof is invalid/u,
  },
  { name: "missing row", makeResult: () => [undefined], message: /changes proof is invalid/u },
  {
    name: "row Array subclass",
    makeResult: () => {
      class HostileRowArray extends Array<unknown> {}
      const row = new HostileRowArray();
      row.push(2n);
      if (!Array.isArray(row)) throw new Error("row Array subclass probe drifted");
      return [row];
    },
    message: /changes proof is invalid/u,
  },
  {
    name: "row index accessor",
    makeResult: () => {
      const row: unknown[] = [];
      Object.defineProperty(row, "0", {
        configurable: true,
        enumerable: true,
        get() { rowAccessorGets.count += 1; return 2n; },
      });
      return [row];
    },
    message: /changes proof is invalid/u,
  },
  {
    name: "row Array Proxy",
    makeResult: () => [new Proxy([2n], {
      get() { rowProxyTraps.count += 1; throw new Error("row proxy get trap"); },
      getOwnPropertyDescriptor() {
        rowProxyTraps.count += 1;
        throw new Error("row proxy descriptor trap");
      },
      getPrototypeOf() {
        rowProxyTraps.count += 1;
        throw new Error("row proxy prototype trap");
      },
      ownKeys() { rowProxyTraps.count += 1; throw new Error("row proxy keys trap"); },
    })],
    message: /changes proof is invalid/u,
  },
  { name: "empty row", makeResult: () => [[]], message: /changes proof is invalid/u },
  {
    name: "sparse row",
    makeResult: () => [new Array<unknown>(1)],
    message: /changes proof is invalid/u,
  },
  { name: "wide row", makeResult: () => [[2n, 2n]], message: /changes proof is invalid/u },
  { name: "number value", makeResult: () => [[2]], message: /changes proof is invalid/u },
  { name: "string value", makeResult: () => [["2"]], message: /changes proof is invalid/u },
  { name: "boolean value", makeResult: () => [[true]], message: /changes proof is invalid/u },
  { name: "negative bigint", makeResult: () => [[-1n]], message: /changes proof is invalid/u },
  {
    name: "unsafe bigint",
    makeResult: () => [[BigInt(Number.MAX_SAFE_INTEGER) + 1n]],
    message: /changes proof is invalid/u,
  },
  {
    name: "native mismatch",
    makeResult: () => [[1n]],
    message: /change observations disagree/u,
  },
];

afterEach(() => {
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite connection cursor publication rebind", () => {
  it("anchors the exact SQL, digests and positional parameter contract", () => {
    expect(SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC).toBe(
      "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, schema_identity_sha256 = ? WHERE descriptor_hash = ? AND schema_identity_sha256 = ?",
    );
    expect(SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC).toBe(
      "6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91",
    );
    expect(SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC).toEqual([
      "targetDescriptorHash",
      "targetSchemaIdentitySha256",
      "sourceDescriptorHash",
      "sourceSchemaIdentitySha256",
    ]);
    expect(SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC).toBe(
      "SELECT changes() AS affected_rows",
    );
    expect(SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC).toBe(
      "a6ab435eb54879f942436129997f231de19504b11028b55b014fddc2bb42e112",
    );
    expect(Object.isFrozen(SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC))
      .toBe(true);
  });

  it("executes one fixed rebind and proves run, changes, total and ledger 1/1/N", () => {
    const graph = graphWithCursors(2);
    const owner = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges;
    const execution = begin(graph);

    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      execution,
    )).toEqual({
      affectedRows: 0,
      changesAffectedRows: null,
      changesFetchCount: 0,
      changesPrepareCount: 0,
      changesReleaseCount: 0,
      changesSql: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
      changesSqlSha256: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
      cursorLedgerAffectedRowsWatermark: 0,
      cursorLedgerFixedStatementCount: 0,
      cursorLedgerLogicalWriteSequence: 0,
      executeCount: 0,
      lifecycle: "active",
      parameterOrder: SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
      parameterValues: null,
      prepareCount: 1,
      releaseCount: 0,
      sql: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
      sqlSha256: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
      statementOwnershipRetired: false,
      totalChangesAfter: totalBefore,
      totalChangesBefore: totalBefore,
      totalChangesDelta: 0,
      transactionEpoch: owner.transactionEpoch,
      transactionLineage: owner.transactionLineage,
    });

    const result = executeSQLiteConnectionCursorRebindIntrinsic(
      graph.connection,
      execution,
      parameters(),
    );
    expect(result).toMatchObject({
      affectedRows: 2,
      changesAffectedRows: 2,
      changesFetchCount: 1,
      changesPrepareCount: 1,
      changesReleaseCount: 1,
      cursorLedgerAffectedRowsWatermark: 2,
      cursorLedgerFixedStatementCount: 1,
      cursorLedgerLogicalWriteSequence: 1,
      executeCount: 1,
      executionOrdinal: 1,
      prepareCount: 1,
      releaseCount: 1,
      totalChangesAfter: totalBefore + 2,
      totalChangesBefore: totalBefore,
      totalChangesDelta: 2,
      transactionEpoch: owner.transactionEpoch + 1n,
      transactionLineage: owner.transactionLineage,
    });
    expect(result.parameterValues).toEqual([
      TARGET_DESCRIPTOR,
      TARGET_SCHEMA,
      SOURCE_DESCRIPTOR,
      SOURCE_SCHEMA,
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.parameterValues)).toBe(true);
    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      execution,
    )).toMatchObject({
      affectedRows: 2,
      changesAffectedRows: 2,
      lifecycle: "completed",
      releaseCount: 1,
      statementOwnershipRetired: true,
      totalChangesDelta: 2,
    });
    expect(graph.connection.prepare(
      "SELECT DISTINCT descriptor_hash, schema_identity_sha256 FROM main.ge_cycle_cursors",
      "inspect-schema",
    ).all()).toEqual([[TARGET_DESCRIPTOR, TARGET_SCHEMA]]);
  });

  it("requires the exact live BEGIN EXCLUSIVE connection owner", () => {
    const graph = graphWithCursors();
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    expectProviderError(
      () => begin(graph),
      "GE_CYCLE_STORE_STALE_FENCE",
      /^SQLite cursor rebind requires the active BEGIN EXCLUSIVE owner$/u,
    );
    graph.connection.execTrusted("BEGIN", "inspect-schema");
    expectProviderError(
      () => begin(graph),
      "GE_CYCLE_STORE_STALE_FENCE",
      /^SQLite cursor rebind requires the active BEGIN EXCLUSIVE owner$/u,
    );
  });

  it("deterministically releases a prepared cancellation exactly once", () => {
    const graph = graphWithCursors();
    const execution = begin(graph);
    const released = releaseSQLiteConnectionCursorRebindExecutionIntrinsic(
      graph.connection,
      execution,
    );
    expect(released).toMatchObject({
      affectedRows: 0,
      changesFetchCount: 0,
      changesPrepareCount: 0,
      changesReleaseCount: 0,
      cursorLedgerAffectedRowsWatermark: 0,
      cursorLedgerFixedStatementCount: 0,
      cursorLedgerLogicalWriteSequence: 0,
      executeCount: 0,
      lifecycle: "released",
      parameterValues: null,
      prepareCount: 1,
      releaseCount: 1,
      statementOwnershipRetired: true,
      totalChangesDelta: 0,
    });
    expectProviderError(
      () => executeSQLiteConnectionCursorRebindIntrinsic(
        graph.connection,
        execution,
        parameters(),
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite cursor rebind execution is terminal$/u,
    );
    expectProviderError(
      () => releaseSQLiteConnectionCursorRebindExecutionIntrinsic(
        graph.connection,
        execution,
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite cursor rebind release is terminal$/u,
    );
    expect(graph.connection.prepare(
      "SELECT DISTINCT descriptor_hash, schema_identity_sha256 FROM main.ge_cycle_cursors",
      "inspect-schema",
    ).all()).toEqual([[SOURCE_DESCRIPTOR, SOURCE_SCHEMA]]);
  });

  it("rejects forged, proxied, revoked and connection-substituted tokens", () => {
    const graph = graphWithCursors();
    const other = graphWithCursors();
    const execution = begin(graph);
    const revoked = Proxy.revocable(execution, {});
    const candidates = [
      Object.freeze(Object.create(null)),
      new Proxy(execution, {}),
      revoked.proxy,
      begin(other),
    ] as readonly unknown[];
    revoked.revoke();
    for (const candidate of candidates) {
      expectProviderError(
        () => executeSQLiteConnectionCursorRebindIntrinsic(
          graph.connection,
          candidate as SQLiteConnectionCursorRebindExecution,
          parameters(),
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /^SQLite cursor rebind execution is invalid$/u,
      );
      expectProviderError(
        () => readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
          graph.connection,
          candidate as SQLiteConnectionCursorRebindExecution,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /^SQLite cursor rebind execution is invalid$/u,
      );
    }
    expect(Reflect.ownKeys(execution)).toEqual([]);
    expect(Object.getPrototypeOf(execution)).toBeNull();
    expect(Object.isFrozen(execution)).toBe(true);
  });

  it("retires and poisons a prepared execution on non-exact or same-value inputs", () => {
    const hostile = [
      { ...parameters(), sourceDescriptorHash: "x".repeat(64) },
      { ...parameters(), extra: SOURCE_SCHEMA },
      {
        ...parameters(),
        targetDescriptorHash: SOURCE_DESCRIPTOR,
        targetSchemaIdentitySha256: SOURCE_SCHEMA,
      },
      Object.defineProperty({ ...parameters() }, "sourceDescriptorHash", {
        enumerable: true,
        get: () => SOURCE_DESCRIPTOR,
      }),
      new Proxy(parameters(), {}),
    ] as readonly unknown[];
    for (const candidate of hostile) {
      const graph = graphWithCursors();
      const execution = begin(graph);
      expectProviderError(
        () => executeSQLiteConnectionCursorRebindIntrinsic(
          graph.connection,
          execution,
          candidate as SQLiteCursorPublicationRebindParameters,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /^SQLite cursor rebind parameters are invalid$/u,
      );
      expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
        graph.connection,
        execution,
      )).toMatchObject({
        cursorLedgerLogicalWriteSequence: 0,
        executeCount: 0,
        lifecycle: "poisoned",
        releaseCount: 1,
        statementOwnershipRetired: true,
      });
    }
  });

  it("uses the frozen positional order; a reversed source/target replay affects zero", () => {
    const graph = graphWithCursors();
    const execution = begin(graph);
    const result = executeSQLiteConnectionCursorRebindIntrinsic(
      graph.connection,
      execution,
      parameters({
        sourceDescriptorHash: TARGET_DESCRIPTOR,
        sourceSchemaIdentitySha256: TARGET_SCHEMA,
        targetDescriptorHash: SOURCE_DESCRIPTOR,
        targetSchemaIdentitySha256: SOURCE_SCHEMA,
      }),
    );
    expect(result).toMatchObject({
      affectedRows: 0,
      changesAffectedRows: 0,
      cursorLedgerAffectedRowsWatermark: 0,
      cursorLedgerFixedStatementCount: 1,
      cursorLedgerLogicalWriteSequence: 1,
      totalChangesDelta: 0,
    });
    expect(graph.connection.prepare(
      "SELECT DISTINCT descriptor_hash, schema_identity_sha256 FROM main.ge_cycle_cursors",
      "inspect-schema",
    ).all()).toEqual([[SOURCE_DESCRIPTOR, SOURCE_SCHEMA]]);
  });

  it("rejects double execution without changing completed release or ledger counters", () => {
    const graph = graphWithCursors();
    const execution = begin(graph);
    executeSQLiteConnectionCursorRebindIntrinsic(graph.connection, execution, parameters());
    expectProviderError(
      () => executeSQLiteConnectionCursorRebindIntrinsic(
        graph.connection,
        execution,
        parameters(),
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite cursor rebind execution is terminal$/u,
    );
    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      execution,
    )).toMatchObject({
      executeCount: 1,
      lifecycle: "completed",
      releaseCount: 1,
      cursorLedgerFixedStatementCount: 1,
      cursorLedgerLogicalWriteSequence: 1,
    });
    expectProviderError(
      () => releaseSQLiteConnectionCursorRebindExecutionIntrinsic(
        graph.connection,
        execution,
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite cursor rebind release is terminal$/u,
    );
  });

  it("uses definition-time native captures after post-import prototype monkeypatching", () => {
    const graph = graphWithCursors();
    const prepareDescriptor = Object.getOwnPropertyDescriptor(
      DatabaseSync.prototype,
      "prepare",
    )!;
    const runDescriptor = Object.getOwnPropertyDescriptor(StatementSync.prototype, "run")!;
    const getDescriptor = Object.getOwnPropertyDescriptor(StatementSync.prototype, "get")!;
    const allDescriptor = Object.getOwnPropertyDescriptor(StatementSync.prototype, "all")!;
    const forbidden = (): never => { throw new Error("late native monkeypatch ran"); };
    try {
      Object.defineProperty(DatabaseSync.prototype, "prepare", {
        ...prepareDescriptor,
        value: forbidden,
      });
      Object.defineProperty(StatementSync.prototype, "run", {
        ...runDescriptor,
        value: forbidden,
      });
      Object.defineProperty(StatementSync.prototype, "get", {
        ...getDescriptor,
        value: forbidden,
      });
      Object.defineProperty(StatementSync.prototype, "all", {
        ...allDescriptor,
        value: forbidden,
      });
      const execution = begin(graph);
      expect(executeSQLiteConnectionCursorRebindIntrinsic(
        graph.connection,
        execution,
        parameters(),
      )).toMatchObject({ affectedRows: 2, releaseCount: 1 });
    } finally {
      Object.defineProperty(DatabaseSync.prototype, "prepare", prepareDescriptor);
      Object.defineProperty(StatementSync.prototype, "run", runDescriptor);
      Object.defineProperty(StatementSync.prototype, "get", getDescriptor);
      Object.defineProperty(StatementSync.prototype, "all", allDescriptor);
    }
  });

  it("uses definition-time numeric conversion after post-import global rebound", () => {
    const graph = graphWithCursors(2);
    const execution = begin(graph);
    const numberDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Number")!;
    const originalNumber = numberDescriptor.value as NumberConstructor;
    let forbiddenAffectedConversions = 0;
    const hostileNumber = function (value?: unknown): number {
      if (value === 2n) {
        forbiddenAffectedConversions += 1;
        throw new Error("late global Number rebound converted an affected count");
      }
      return Reflect.apply(originalNumber, undefined, [value]) as number;
    } as NumberConstructor;
    Object.setPrototypeOf(hostileNumber, originalNumber);
    try {
      Object.defineProperty(globalThis, "Number", {
        ...numberDescriptor,
        value: hostileNumber,
      });
      expect(executeSQLiteConnectionCursorRebindIntrinsic(
        graph.connection,
        execution,
        parameters(),
      )).toMatchObject({ affectedRows: 2, changesAffectedRows: 2 });
      expect(forbiddenAffectedConversions).toBe(0);
    } finally {
      Object.defineProperty(globalThis, "Number", numberDescriptor);
    }

    const source = readFileSync(new URL("../src/sqlite-connection.ts", import.meta.url), "utf8");
    const proofStart = source.indexOf("function exactSQLiteCursorRebindChangesArrayElement");
    const proofEnd = source.indexOf("\nexport interface SQLiteNativeStatementIterator", proofStart);
    const nativeStart = source.indexOf("const affectedRows = typeof rawChanges");
    const nativeEnd = source.indexOf("\n      if (affectedRows === undefined)", nativeStart);
    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(proofEnd).toBeGreaterThan(proofStart);
    expect(nativeStart).toBeGreaterThanOrEqual(0);
    expect(nativeEnd).toBeGreaterThan(nativeStart);
    for (const closure of [
      source.slice(proofStart, proofEnd),
      source.slice(nativeStart, nativeEnd),
    ]) {
      expect(closure).not.toMatch(/\bBigInt\s*\(/u);
      expect(closure).not.toMatch(/\bNumber\s*\(/u);
      expect(closure).toContain("SQLITE_MAX_SAFE_INTEGER_BIGINT_INTRINSIC");
      expect(closure).toContain("numberIntrinsic");
    }
  });

  it.each(hostileChangesProofs)(
    "rejects a definition-time captured hostile changes proof: $name",
    async ({ makeResult, message, name }) => {
      if (name === "outer Array Proxy") outerProxyTraps.count = 0;
      if (name === "row Array Proxy") rowProxyTraps.count = 0;
      if (name === "outer index accessor") outerAccessorGets.count = 0;
      if (name === "row index accessor") rowAccessorGets.count = 0;
      await withDefinitionTimeRebindCaptures({
        all: function (): unknown[] {
          return makeResult() as unknown[];
        },
      }, (connectionModule, graph) => {
        const execution = connectionModule
          .beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
        expectDynamicProviderError(
          () => connectionModule.executeSQLiteConnectionCursorRebindIntrinsic(
            graph.connection,
            execution,
            parameters(),
          ),
          "GE_CYCLE_STORE_CORRUPTION",
          message,
        );
        expectPoisonedChangesProofSnapshot(connectionModule, graph, execution, [1, 1, 1]);
      });
      if (name === "outer Array Proxy") expect(outerProxyTraps.count).toBe(0);
      if (name === "row Array Proxy") expect(rowProxyTraps.count).toBe(0);
      if (name === "outer index accessor") expect(outerAccessorGets.count).toBe(0);
      if (name === "row index accessor") expect(rowAccessorGets.count).toBe(0);
    },
  );

  it("preserves an all primary over cleanup and retires the proof statement", async () => {
    let primary: unknown;
    const cleanup = new Error("changes cleanup must not replace all primary");
    await withDefinitionTimeRebindCaptures({
      all: function (): never {
        if (primary === undefined) throw new Error("changes all primary was not installed");
        throw primary;
      },
    }, (connectionModule, graph, runtimeModule) => {
      primary = new runtimeModule.CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        "inspect-schema",
        "changes all primary",
      );
      const execution = connectionModule
        .beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
      connectionModule.injectSQLiteConnectionCursorRebindCleanupFaultForTestIntrinsic(cleanup);
      let caught: unknown;
      try {
        connectionModule.executeSQLiteConnectionCursorRebindIntrinsic(
          graph.connection,
          execution,
          parameters(),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(primary);
      expectPoisonedChangesProofSnapshot(connectionModule, graph, execution, [1, 1, 1], 0);
    });
  });

  it("preserves a changes-prepare primary over cleanup before fetch", async () => {
    const nativePrepare = DatabaseSync.prototype.prepare;
    let primary: unknown;
    const cleanup = new Error("changes cleanup must not replace prepare primary");
    await withDefinitionTimeRebindCaptures({
      prepare: function (this: DatabaseSync, sql: string): StatementSync {
        if (sql === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC) {
          if (primary === undefined) throw new Error("changes prepare primary was not installed");
          throw primary;
        }
        return Reflect.apply(nativePrepare, this, [sql]) as StatementSync;
      },
    }, (connectionModule, graph, runtimeModule) => {
      primary = new runtimeModule.CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        "inspect-schema",
        "changes prepare primary",
      );
      const execution = connectionModule
        .beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
      connectionModule.injectSQLiteConnectionCursorRebindCleanupFaultForTestIntrinsic(cleanup);
      let caught: unknown;
      try {
        connectionModule.executeSQLiteConnectionCursorRebindIntrinsic(
          graph.connection,
          execution,
          parameters(),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(primary);
      expectPoisonedChangesProofSnapshot(connectionModule, graph, execution, [0, 0, 0], 0);
    });
  });

  it("preserves a shape primary over cleanup without reading proxy traps", async () => {
    const cleanup = new Error("changes cleanup must not replace shape primary");
    let traps = 0;
    await withDefinitionTimeRebindCaptures({
      all: function (): unknown[] {
        return new Proxy([[2n]], {
          get() { traps += 1; throw new Error("shape proxy get trap"); },
          getOwnPropertyDescriptor() {
            traps += 1;
            throw new Error("shape proxy descriptor trap");
          },
          getPrototypeOf() { traps += 1; throw new Error("shape proxy prototype trap"); },
          ownKeys() { traps += 1; throw new Error("shape proxy keys trap"); },
        });
      },
    }, (connectionModule, graph) => {
      const execution = connectionModule
        .beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
      connectionModule.injectSQLiteConnectionCursorRebindCleanupFaultForTestIntrinsic(cleanup);
      expectDynamicProviderError(
        () => connectionModule.executeSQLiteConnectionCursorRebindIntrinsic(
          graph.connection,
          execution,
          parameters(),
        ),
        "GE_CYCLE_STORE_CORRUPTION",
        /changes proof is invalid/u,
      );
      expectPoisonedChangesProofSnapshot(connectionModule, graph, execution, [1, 1, 1], 0);
    });
    expect(traps).toBe(0);
  });

  it("keeps native result counts bounded and never exposes either owned statement", () => {
    const graph = graphWithCursors(2);
    const execution = begin(graph);
    const result = executeSQLiteConnectionCursorRebindIntrinsic(
      graph.connection,
      execution,
      parameters(),
    );
    const snapshot = readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      execution,
    );
    for (const value of [
      result.affectedRows,
      result.changesAffectedRows,
      result.totalChangesBefore,
      result.totalChangesAfter,
      result.totalChangesDelta,
    ]) {
      expect(Number.isSafeInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(Reflect.ownKeys(execution)).toEqual([]);
    expect(Object.keys(result)).not.toContain("statement");
    expect(Object.keys(snapshot)).not.toContain("statement");
    expect(snapshot).toMatchObject({
      changesFetchCount: 1,
      changesPrepareCount: 1,
      changesReleaseCount: 1,
      releaseCount: 1,
      statementOwnershipRetired: true,
    });
  });

  it("poisons and retires before mutation when the owner watermark drifts", () => {
    const graph = graphWithCursors();
    const execution = begin(graph);
    graph.connection.prepare(
      "UPDATE main.ge_cycle_cursors SET page_size = page_size + 1",
      "inspect-schema",
    ).run();
    expectProviderError(
      () => executeSQLiteConnectionCursorRebindIntrinsic(
        graph.connection,
        execution,
        parameters(),
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite cursor rebind execution owner drifted$/u,
    );
    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      execution,
    )).toMatchObject({
      cursorLedgerLogicalWriteSequence: 0,
      executeCount: 0,
      lifecycle: "poisoned",
      releaseCount: 1,
      statementOwnershipRetired: true,
    });
  });

  it("detects trigger-amplified total_changes after preserving real write progress", () => {
    const graph = graphWithCursors(2);
    graph.connection.execTrusted(
      "CREATE TABLE main.rebind_audit (tenant_id TEXT NOT NULL)",
      "inspect-schema",
    );
    graph.connection.execTrusted(
      "CREATE TRIGGER main.rebind_audit_trigger AFTER UPDATE ON main.ge_cycle_cursors "
        + "BEGIN INSERT INTO rebind_audit (tenant_id) VALUES (NEW.tenant_id); END",
      "inspect-schema",
    );
    const execution = begin(graph);
    expectProviderError(
      () => executeSQLiteConnectionCursorRebindIntrinsic(
        graph.connection,
        execution,
        parameters(),
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite cursor rebind change observations disagree$/u,
    );
    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      execution,
    )).toMatchObject({
      affectedRows: 2,
      changesAffectedRows: 2,
      changesFetchCount: 1,
      changesPrepareCount: 1,
      changesReleaseCount: 1,
      cursorLedgerAffectedRowsWatermark: 2,
      cursorLedgerFixedStatementCount: 1,
      cursorLedgerLogicalWriteSequence: 1,
      executeCount: 1,
      lifecycle: "poisoned",
      releaseCount: 1,
      statementOwnershipRetired: true,
      totalChangesDelta: 4,
    });
    expect(graph.connection.prepare(
      "SELECT count(*) FROM main.rebind_audit",
      "inspect-schema",
    ).get()).toEqual([2n]);
  });

  it("preserves the disagreement primary when cleanup counter synchronization fails", () => {
    const graph = graphWithCursors();
    graph.connection.execTrusted(
      "CREATE TABLE main.rebind_audit (tenant_id TEXT NOT NULL)",
      "inspect-schema",
    );
    graph.connection.execTrusted(
      "CREATE TRIGGER main.rebind_audit_trigger AFTER UPDATE ON main.ge_cycle_cursors "
        + "BEGIN INSERT INTO rebind_audit (tenant_id) VALUES (NEW.tenant_id); END",
      "inspect-schema",
    );
    const execution = begin(graph);
    const cleanup = new Error("cleanup counter must not replace primary");
    injectSQLiteConnectionCursorRebindCleanupFaultForTestIntrinsic(cleanup);
    expectProviderError(
      () => executeSQLiteConnectionCursorRebindIntrinsic(
        graph.connection,
        execution,
        parameters(),
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite cursor rebind change observations disagree$/u,
    );
    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      execution,
    )).toMatchObject({
      affectedRows: 2,
      cursorLedgerAffectedRowsWatermark: 2,
      lifecycle: "poisoned",
      totalChangesDelta: 4,
    });
  });
});

interface RebindTrackedReferent {
  readonly label: string;
  readonly reference: WeakRef<object>;
}

function buildReleaseAndDropRebindGraph(): Readonly<{
  readonly finalized: Set<string>;
  readonly referents: readonly RebindTrackedReferent[];
  readonly registry: FinalizationRegistry<string>;
}> {
  const graph = createReaderLeaseTestGraph(1);
  const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
  releaseSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection, execution);
  const finalized = new Set<string>();
  const registry = new FinalizationRegistry<string>((label) => finalized.add(label));
  const values = [
    ["execution", execution],
    ["connection", graph.connection],
  ] as const;
  const referents = values.map(([label, value]) => {
    registry.register(value, label);
    return { label, reference: new WeakRef(value) };
  });
  disposeReaderLeaseTestGraph(graph);
  return { finalized, referents, registry };
}

async function forceRebindGraphCollection(
  referents: readonly RebindTrackedReferent[],
): Promise<readonly string[]> {
  for (let round = 0; round < 80; round += 1) {
    globalThis.gc!();
    const pressure = Array.from({ length: 4 }, () => new Uint8Array(2 * 1024 * 1024));
    pressure[round % pressure.length]![0] = round;
    await new Promise<void>((resolve) => setImmediate(resolve));
    globalThis.gc!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const live = referents.filter(({ reference }) => reference.deref() !== undefined);
    if (live.length === 0) return [];
  }
  return referents
    .filter(({ reference }) => reference.deref() !== undefined)
    .map(({ label }) => label);
}

describe("SQLite cursor-rebind isolated released-graph GC", () => {
  if (process.env.GRAPH_ENGINEERING_RUN_REBIND_GC_PROBE !== "1") {
    it("passes the bounded node --expose-gc probe", () => {
      const packageRoot = fileURLToPath(new URL("..", import.meta.url));
      const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          vitest,
          "run",
          "test/cursor-publication-rebind-connection.test.ts",
          "--pool=threads",
          "--maxWorkers=1",
          "--fileParallelism=false",
          "--reporter=dot",
        ],
        {
          cwd: packageRoot,
          encoding: "utf8",
          env: { ...process.env, GRAPH_ENGINEERING_RUN_REBIND_GC_PROBE: "1" },
          timeout: 150_000,
        },
      );
      expect(result.error, `GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
      expect(result.signal, `GC probe was terminated: ${result.stderr}`).toBeNull();
      expect(result.status, [
        "isolated cursor-rebind GC probe failed",
        `stdout=${result.stdout}`,
        `stderr=${result.stderr}`,
      ].join("\n")).toBe(0);
    }, 160_000);
  } else {
    it("collects the released token and connection without a WeakMap value-key cycle", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const tracked = buildReleaseAndDropRebindGraph();
      const live = await forceRebindGraphCollection(tracked.referents);
      expect(live, [
        "released cursor-rebind graph retained roots after 80 GC rounds",
        `live=${live.join(",") || "none"}`,
        `finalized=${[...tracked.finalized].sort().join(",") || "none"}`,
      ].join("; ")).toEqual([]);
      expect(tracked.registry).toBeInstanceOf(FinalizationRegistry);
    }, 120_000);
  }
});
