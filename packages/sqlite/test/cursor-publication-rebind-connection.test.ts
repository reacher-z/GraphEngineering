import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

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
  return graph;
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
    }
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
