import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic,
  executeSQLiteConnectionOperationSequenceZeroIntrinsic,
  readSQLiteConnectionOperationSequenceZeroExecutionSnapshotIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
  type SQLiteConnectionOperationSequenceZeroExecution,
  type SQLiteConnectionOperationSequenceZeroRow,
} from "../src/sqlite-connection.js";
import {
  READER_CAPTURED_AT_MS,
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

// This file drives the connection-owned sequence-zero session directly: every
// case below reaches the real `begin`/`execute` methods on a real SQLite
// connection that already owns its BEGIN EXCLUSIVE generation, instead of
// mocking the module-level intrinsics the outer authority calls.
//
// Two of the session's rejections cannot be reached this way because they
// defend against a violated native contract rather than against any reachable
// caller or database state:
//   * "owner drifted during prepare" requires the owner transaction, epoch, or
//     total_changes counter to change across a single `DatabaseSync.prepare`
//     call, and preparing a statement never executes one.
//   * "result is invalid" requires `StatementSync.run` to return something
//     other than an object.
// Both are retained as defence in depth and are named here so the gap is
// visible rather than implied.

const SEQUENCE_UPDATED_AT_MS = READER_CAPTURED_AT_MS + 1_234;

const graphs: ReaderLeaseTestGraph[] = [];

function sessionGraph(): ReaderLeaseTestGraph {
  const graph = createReaderLeaseTestGraph(1);
  graphs.push(graph);
  return graph;
}

function authenticRow(
  graph: ReaderLeaseTestGraph,
): SQLiteConnectionOperationSequenceZeroRow {
  return Object.freeze({
    baselineCapturedAtMs: READER_CAPTURED_AT_MS,
    baselineId: graph.projectionIdentity.baselineId,
    updatedAtMs: SEQUENCE_UPDATED_AT_MS,
  });
}

function begin(
  graph: ReaderLeaseTestGraph,
): SQLiteConnectionOperationSequenceZeroExecution {
  return beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic(graph.connection);
}

function execute(
  graph: ReaderLeaseTestGraph,
  execution: SQLiteConnectionOperationSequenceZeroExecution,
  row: SQLiteConnectionOperationSequenceZeroRow,
): ReturnType<typeof executeSQLiteConnectionOperationSequenceZeroIntrinsic> {
  return executeSQLiteConnectionOperationSequenceZeroIntrinsic(
    graph.connection,
    execution,
    row,
  );
}

function progress(
  graph: ReaderLeaseTestGraph,
  execution: SQLiteConnectionOperationSequenceZeroExecution,
): ReturnType<typeof readSQLiteConnectionOperationSequenceZeroExecutionSnapshotIntrinsic> {
  return readSQLiteConnectionOperationSequenceZeroExecutionSnapshotIntrinsic(
    graph.connection,
    execution,
  );
}

function sequenceRows(graph: ReaderLeaseTestGraph): readonly (readonly unknown[])[] {
  return graph.connection.prepare(
    "SELECT singleton, baseline_id, last_commit_sequence, baseline_captured_at_ms, "
      + "updated_at_ms FROM main.ge_cycle_operation_sequence ORDER BY singleton ASC",
    "inspect-schema",
  ).all() as readonly (readonly unknown[])[];
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

describe("SQLite connection operation-sequence-zero session", () => {
  it("writes exactly one sequence row and reports real prepare/run/counter progress", () => {
    const graph = sessionGraph();
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(
      graph.connection,
    ).totalChanges;
    const execution = begin(graph);

    expect(progress(graph, execution)).toEqual({
      affectedRows: 0,
      completedExecutionCount: 0,
      executeCount: 0,
      lifecycle: "active",
      prepareCount: 1,
      totalChanges: totalBefore,
      totalChangesDelta: 0,
      transactionEpoch: ownerBefore.transactionEpoch,
      transactionLineage: ownerBefore.transactionLineage,
    });
    expect(execute(graph, execution, authenticRow(graph))).toEqual({
      affectedRowsDelta: 1,
      completedExecutionCount: 1,
      executeCount: 1,
      prepareCount: 1,
      totalChanges: totalBefore + 1,
      transactionEpoch: ownerBefore.transactionEpoch + 1n,
      transactionLineage: ownerBefore.transactionLineage,
    });
    expect(progress(graph, execution)).toEqual({
      affectedRows: 1,
      completedExecutionCount: 1,
      executeCount: 1,
      lifecycle: "completed",
      prepareCount: 1,
      totalChanges: totalBefore + 1,
      totalChangesDelta: 1,
      transactionEpoch: ownerBefore.transactionEpoch + 1n,
      transactionLineage: ownerBefore.transactionLineage,
    });
    expect(sequenceRows(graph)).toEqual([[
      1n,
      graph.projectionIdentity.baselineId,
      0n,
      BigInt(READER_CAPTURED_AT_MS),
      BigInt(SEQUENCE_UPDATED_AT_MS),
    ]]);
  });

  it("requires the active BEGIN EXCLUSIVE owner before preparing anything", () => {
    const graph = sessionGraph();
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");

    expectProviderError(
      () => begin(graph),
      "GE_CYCLE_STORE_STALE_FENCE",
      /^SQLite operation-sequence-zero write requires the active BEGIN EXCLUSIVE owner$/u,
    );
    graph.connection.execTrusted("BEGIN", "inspect-schema");
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection).transactionMode)
      .not.toBe("exclusive");
    expectProviderError(
      () => begin(graph),
      "GE_CYCLE_STORE_STALE_FENCE",
      /^SQLite operation-sequence-zero write requires the active BEGIN EXCLUSIVE owner$/u,
    );
  });

  it("rejects forged, proxied, revoked and foreign execution tokens", () => {
    const graph = sessionGraph();
    const other = sessionGraph();
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
        () => execute(
          graph,
          candidate as SQLiteConnectionOperationSequenceZeroExecution,
          authenticRow(graph),
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /^SQLite operation-sequence-zero execution is invalid$/u,
      );
      expectProviderError(
        () => progress(
          graph,
          candidate as SQLiteConnectionOperationSequenceZeroExecution,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /^SQLite operation-sequence-zero execution is invalid$/u,
      );
    }
    expect(execute(graph, execution, authenticRow(graph)).affectedRowsDelta).toBe(1);
    expect(sequenceRows(graph)).toHaveLength(1);
  });

  it("rejects a second run on the completed single-run session", () => {
    const graph = sessionGraph();
    const execution = begin(graph);
    execute(graph, execution, authenticRow(graph));

    expectProviderError(
      () => execute(graph, execution, authenticRow(graph)),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero execution is terminal$/u,
    );
    expect(progress(graph, execution)).toMatchObject({
      affectedRows: 1,
      executeCount: 1,
      lifecycle: "completed",
    });
    expect(sequenceRows(graph)).toHaveLength(1);
  });

  it("rejects a retry on a session already poisoned by a hostile row", () => {
    const graph = sessionGraph();
    const execution = begin(graph);

    expectProviderError(
      () => execute(
        graph,
        execution,
        Object.freeze({ ...authenticRow(graph), baselineId: "v1-legacy" }),
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /^SQLite operation-sequence-zero row is invalid$/u,
    );
    expect(progress(graph, execution).lifecycle).toBe("poisoned");
    expectProviderError(
      () => execute(graph, execution, authenticRow(graph)),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero execution is terminal$/u,
    );
    expect(sequenceRows(graph)).toHaveLength(0);
  });

  it("rejects every hostile sequence row before the prepared statement runs", () => {
    const graph = sessionGraph();
    const base = authenticRow(graph);
    const accessorRow = Object.freeze(Object.defineProperties({}, {
      baselineCapturedAtMs: { enumerable: true, value: base.baselineCapturedAtMs },
      baselineId: { enumerable: true, value: base.baselineId },
      updatedAtMs: { enumerable: true, get: () => SEQUENCE_UPDATED_AT_MS },
    }));
    const hostile = [
      null,
      "not-an-object",
      new Proxy(base, {}),
      Object.freeze({
        baselineCapturedAtMs: base.baselineCapturedAtMs,
        updatedAtMs: base.updatedAtMs,
      }),
      accessorRow,
      Object.freeze({ ...base, baselineId: `v1-${base.baselineId.slice(3)}` }),
      Object.freeze({ ...base, baselineId: `v2-${"Z".repeat(64)}` }),
      Object.freeze({ ...base, baselineId: 42 }),
      Object.freeze({ ...base, baselineCapturedAtMs: -1 }),
      Object.freeze({ ...base, baselineCapturedAtMs: 1.5 }),
      Object.freeze({ ...base, baselineCapturedAtMs: Number.NaN }),
      Object.freeze({ ...base, updatedAtMs: Number.MAX_SAFE_INTEGER + 2 }),
      Object.freeze({ ...base, updatedAtMs: `${SEQUENCE_UPDATED_AT_MS}` }),
      Object.freeze({ ...base, updatedAtMs: Number.NaN }),
    ] as readonly unknown[];

    for (const row of hostile) {
      const execution = begin(graph);
      expectProviderError(
        () => execute(graph, execution, row as SQLiteConnectionOperationSequenceZeroRow),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /^SQLite operation-sequence-zero row is invalid$/u,
      );
      expect(progress(graph, execution)).toMatchObject({
        affectedRows: 0,
        completedExecutionCount: 0,
        executeCount: 0,
        lifecycle: "poisoned",
        totalChangesDelta: 0,
      });
    }
    expect(sequenceRows(graph)).toHaveLength(0);
    expect(execute(graph, begin(graph), base).affectedRowsDelta).toBe(1);
  });

  it("rejects an updated time that precedes the retained baseline capture time", () => {
    const graph = sessionGraph();
    const execution = begin(graph);

    expectProviderError(
      () => execute(
        graph,
        execution,
        Object.freeze({
          ...authenticRow(graph),
          updatedAtMs: READER_CAPTURED_AT_MS - 1,
        }),
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /^SQLite operation-sequence-zero row is invalid$/u,
    );
    expect(progress(graph, execution)).toMatchObject({
      affectedRows: 0,
      executeCount: 0,
      lifecycle: "poisoned",
      totalChangesDelta: 0,
    });
    expect(sequenceRows(graph)).toHaveLength(0);
    // Equality is the accepted boundary: the guard rejects only a strictly
    // earlier updated time, and it does so before the statement is ever run.
    expect(execute(
      graph,
      begin(graph),
      Object.freeze({ ...authenticRow(graph), updatedAtMs: READER_CAPTURED_AT_MS }),
    ).affectedRowsDelta).toBe(1);
  });

  it("rejects an owner whose change counter drifted after the prepare", () => {
    const graph = sessionGraph();
    const execution = begin(graph);
    graph.connection.prepare(
      "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1",
      "inspect-schema",
    ).run();

    expectProviderError(
      () => execute(graph, execution, authenticRow(graph)),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero execution owner drifted$/u,
    );
    // The session never ran its own statement, and it reports the foreign
    // change it observed rather than claiming a clean zero-progress failure.
    expect(progress(graph, execution)).toMatchObject({
      affectedRows: 1,
      completedExecutionCount: 0,
      executeCount: 0,
      lifecycle: "poisoned",
      totalChangesDelta: 1,
    });
    expect(sequenceRows(graph)).toHaveLength(0);
  });

  it("rejects a replaced transaction generation after the prepare", () => {
    const graph = sessionGraph();
    const execution = begin(graph);
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");

    expectProviderError(
      () => execute(graph, execution, authenticRow(graph)),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero execution owner drifted$/u,
    );
    expect(progress(graph, execution)).toMatchObject({
      completedExecutionCount: 0,
      executeCount: 0,
      lifecycle: "poisoned",
    });
  });

  it("rejects a suppressed insert that affected no row", () => {
    const graph = sessionGraph();
    graph.connection.prepare(
      "CREATE TRIGGER main.ge_hostile_sequence_ignore "
        + "BEFORE INSERT ON ge_cycle_operation_sequence "
        + "BEGIN SELECT RAISE(IGNORE); END",
      "inspect-schema",
    ).run();
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(
      graph.connection,
    ).totalChanges;
    const execution = begin(graph);

    expectProviderError(
      () => execute(graph, execution, authenticRow(graph)),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero write must affect exactly one row$/u,
    );
    expect(progress(graph, execution)).toMatchObject({
      affectedRows: 0,
      completedExecutionCount: 1,
      executeCount: 1,
      lifecycle: "poisoned",
      totalChanges: totalBefore,
      totalChangesDelta: 0,
    });
    expect(sequenceRows(graph)).toHaveLength(0);
  });

  it("rejects a write whose real total_changes disagreed with its one reported row", () => {
    const graph = sessionGraph();
    graph.connection.prepare(
      "CREATE TABLE main.ge_hostile_sequence_echo "
        + "(id INTEGER PRIMARY KEY, note TEXT NOT NULL)",
      "inspect-schema",
    ).run();
    graph.connection.prepare(
      "CREATE TRIGGER main.ge_hostile_sequence_echo_trigger "
        + "AFTER INSERT ON ge_cycle_operation_sequence "
        + "BEGIN INSERT INTO ge_hostile_sequence_echo (note) VALUES ('shadow'); END",
      "inspect-schema",
    ).run();
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(
      graph.connection,
    ).totalChanges;
    const execution = begin(graph);

    expectProviderError(
      () => execute(graph, execution, authenticRow(graph)),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero write disagreed with total_changes$/u,
    );
    expect(progress(graph, execution)).toMatchObject({
      affectedRows: 2,
      completedExecutionCount: 1,
      executeCount: 1,
      lifecycle: "poisoned",
      totalChanges: totalBefore + 2,
      totalChangesDelta: 2,
    });
    // The physical write really happened: the session refuses to report a
    // one-row result for a statement that changed the database twice.
    expect(sequenceRows(graph)).toHaveLength(1);
    expect(graph.connection.prepare(
      "SELECT count(*) FROM main.ge_hostile_sequence_echo",
      "inspect-schema",
    ).all()).toEqual([[1n]]);
  });
});
