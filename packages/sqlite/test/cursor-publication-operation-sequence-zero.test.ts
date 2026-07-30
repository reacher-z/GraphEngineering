import { createHash } from "node:crypto";
import { DatabaseSync, StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic,
  type SQLiteBaselineEntriesPublicationReceipt,
  type SQLiteBaselineHeaderPublicationReceipt,
  type SQLiteCursorPostDdlPublicationReaderLease,
  type SQLiteOperationSequenceZeroPublicationReceipt,
} from "../src/cursor-publication-outer-authority.js";
import * as clockAuthorityModule from "../src/cursor-publication-clock-authority.js";
import {
  readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic,
} from "../src/cursor-publication-clock-authority.js";
import * as cursorOwnershipModule from "../src/operation-baseline-cursor-ownership.js";
import * as initialWriteDigestModule from
  "../src/cursor-publication-initial-write-digest.js";
import {
  digestSQLiteInitialWriteParametersIntrinsic,
  digestSQLiteInitialWriteResultIntrinsic,
  type SQLiteInitialWriteParameterExecutions,
  type SQLiteInitialWriteTaggedScalar,
} from "../src/cursor-publication-initial-write-digest.js";
import * as sqliteConnectionModule from "../src/sqlite-connection.js";
import {
  SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
  SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";
import {
  READER_CAPTURED_AT_MS,
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const SEQUENCE_UPDATED_AT_MS = READER_CAPTURED_AT_MS + 1_234;

interface SequenceGraph extends ReaderLeaseTestGraph {
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly entriesReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly headerReceipt: SQLiteBaselineHeaderPublicationReceipt;
}

const graphs: SequenceGraph[] = [];

function sequenceGraph(
  legacyOperationCount = 1,
  outerProviderNowMs = SEQUENCE_UPDATED_AT_MS,
): SequenceGraph {
  const graph = createReaderLeaseTestGraph(legacyOperationCount, {
    outerProviderNowMs,
  });
  const readerLease = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
  );
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    readerLease,
  );
  const entriesReceipt = executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    readerLease,
  );
  const headerReceipt = executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    readerLease,
    entriesReceipt,
  );
  const complete = { ...graph, entriesReceipt, headerReceipt, readerLease };
  graphs.push(complete);
  return complete;
}

function publishSequence(
  graph: SequenceGraph,
): SQLiteOperationSequenceZeroPublicationReceipt {
  return executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    graph.readerLease,
    graph.entriesReceipt,
    graph.headerReceipt,
  );
}

function assertSequence(
  graph: SequenceGraph,
  receipt: SQLiteOperationSequenceZeroPublicationReceipt,
): SQLiteOperationSequenceZeroPublicationReceipt {
  return assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    graph.readerLease,
    graph.entriesReceipt,
    graph.headerReceipt,
    receipt,
  );
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

const text = (value: string): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "text",
  value,
});
const integer = (value: number): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "integer",
  value: `${value}`,
});

function sequenceParameterFrame(graph: SequenceGraph): SQLiteInitialWriteParameterExecutions {
  return Object.freeze([Object.freeze([
    text(graph.projectionIdentity.baselineId),
    integer(graph.sourceSummary.sourceEnvelope.capturedAtMs),
    integer(SEQUENCE_UPDATED_AT_MS),
  ])]);
}

function readSequenceRows(graph: SequenceGraph): readonly (readonly unknown[])[] {
  return graph.connection.prepare(
    "SELECT singleton, baseline_id, last_commit_sequence, baseline_captured_at_ms, "
      + "updated_at_ms FROM main.ge_cycle_operation_sequence ORDER BY singleton ASC",
    "inspect-schema",
  ).all() as readonly (readonly unknown[])[];
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite operation-sequence-zero publication receipt", () => {
  it("freezes exact SQL, SHA-256, and three-parameter order", () => {
    expect(SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC).toBe(
      "INSERT INTO main.ge_cycle_operation_sequence (singleton, baseline_id, "
        + "last_commit_sequence, baseline_captured_at_ms, updated_at_ms) "
        + "VALUES (1, ?, 0, ?, ?)",
    );
    expect(SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC)
      .toBe("a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85");
    expect(createHash("sha256")
      .update(SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC, "utf8")
      .digest("hex"))
      .toBe(SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC);
    expect(SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC).toEqual([
      "baselineId",
      "baselineCapturedAtMs",
      "updatedAtMs",
    ]);
  });

  it("publishes singleton sequence zero and advances every real ledger by one", () => {
    const graph = sequenceGraph(8);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const authorityBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );
    expect(authorityBefore.outerLedger).toEqual({
      affectedRowsWatermark: 22,
      fixedStatementCount: 33,
      logicalWriteSequence: 3,
    });

    const receipt = publishSequence(graph);
    const snapshot = readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(
      receipt,
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.getPrototypeOf(receipt)).toBeNull();
    expect(snapshot).toMatchObject({
      affectedRows: 1,
      authority: graph.authority,
      baselineCapturedAtMs: READER_CAPTURED_AT_MS,
      baselineEntriesPublicationReceipt: graph.entriesReceipt,
      baselineHeaderPublicationReceipt: graph.headerReceipt,
      baselineId: graph.projectionIdentity.baselineId,
      connection: graph.connection,
      executeCount: 1,
      fixedInsertSql: SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
      fixedInsertSqlSha256:
        SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC,
      lastCommitSequence: 0,
      migration0002Receipt: graph.migration0002Receipt,
      mintCount: 1,
      outerClockEvidence: graph.outerClockEvidence,
      outerLedgerBefore: authorityBefore.outerLedger,
      outerLedgerAfter: {
        affectedRowsWatermark: 23,
        fixedStatementCount: 34,
        logicalWriteSequence: 4,
      },
      outerLedgerDelta: {
        affectedRowsWatermark: 1,
        fixedStatementCount: 1,
        logicalWriteSequence: 1,
      },
      outerProviderNowMs: SEQUENCE_UPDATED_AT_MS,
      parameterOrder: SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC,
      postDdlCatalogFence: graph.fence,
      prepareCount: 1,
      projectionIdentity: graph.projectionIdentity,
      projectionReference: graph.projectionReference,
      readerLease: graph.readerLease,
      totalChangesBefore: totalBefore.totalChanges,
      totalChangesAfter: totalBefore.totalChanges + 1,
      totalChangesDelta: 1,
      transactionEpochBefore: ownerBefore.transactionEpoch,
      transactionEpochAfter: ownerBefore.transactionEpoch + 1n,
      transactionLineage: ownerBefore.transactionLineage,
      updatedAtMs: SEQUENCE_UPDATED_AT_MS,
      writeKind: "operation-sequence-zero-publication",
    });
    expect(assertSequence(graph, receipt)).toBe(receipt);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore.totalChanges + 1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "active",
        operationSequenceZeroAffectedRows: 1,
        operationSequenceZeroExecuteCount: 1,
        operationSequenceZeroLogicalExecutionCount: 1,
        operationSequenceZeroPrepareCount: 1,
        operationSequenceZeroPublicationReceipt: receipt,
        operationSequenceZeroPublicationReceiptMintCount: 1,
        outerLedger: snapshot.outerLedgerAfter,
        writePhase: "sequence-zero-complete",
      });
  });

  it("separates retained capture time from exact outer-clock updated time", () => {
    const graph = sequenceGraph(1);
    const clock = readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
      graph.providerClockCapability,
      graph.outerClockEvidence,
    );
    expect(graph.sourceSummary.sourceEnvelope.capturedAtMs).toBe(READER_CAPTURED_AT_MS);
    expect(clock.providerNowMs).toBe(SEQUENCE_UPDATED_AT_MS);
    expect(clock.providerNowMs).not.toBe(graph.sourceSummary.sourceEnvelope.capturedAtMs);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(9_999_999_999_999);
    const originalTimestamp = process.env.GRAPH_ENGINEERING_UPDATED_AT_MS;
    process.env.GRAPH_ENGINEERING_UPDATED_AT_MS = "1";
    let receipt: SQLiteOperationSequenceZeroPublicationReceipt;
    try {
      receipt = publishSequence(graph);
    } finally {
      if (originalTimestamp === undefined) delete process.env.GRAPH_ENGINEERING_UPDATED_AT_MS;
      else process.env.GRAPH_ENGINEERING_UPDATED_AT_MS = originalTimestamp;
    }

    expect(dateNow).not.toHaveBeenCalled();
    expect(readSequenceRows(graph)).toEqual([[
      1n,
      graph.projectionIdentity.baselineId,
      0n,
      BigInt(READER_CAPTURED_AT_MS),
      BigInt(SEQUENCE_UPDATED_AT_MS),
    ]]);
    expect(readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(receipt!))
      .toMatchObject({
        baselineCapturedAtMs: graph.sourceSummary.sourceEnvelope.capturedAtMs,
        outerClockEvidence: graph.outerClockEvidence,
        outerProviderNowMs: clock.providerNowMs,
        updatedAtMs: clock.providerNowMs,
      });
  });

  it("passes one strict typed 1-by-3 frame and exact aggregate result", () => {
    const graph = sequenceGraph(1);
    const originalParameters =
      initialWriteDigestModule.digestSQLiteInitialWriteParametersIntrinsic;
    let captured: unknown;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteParametersIntrinsic",
    ).mockImplementation((parameters) => {
      captured = parameters;
      return originalParameters(parameters);
    });

    const receipt = publishSequence(graph);
    const snapshot = readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(
      receipt,
    );
    const expected = sequenceParameterFrame(graph);
    expect(captured).toEqual(expected);
    expect(Object.isFrozen(captured)).toBe(true);
    const executions = captured as readonly (readonly Record<string, unknown>[])[];
    expect(executions).toHaveLength(1);
    expect(executions[0]).toHaveLength(3);
    expect(executions[0]!.map((scalar) => scalar.type))
      .toEqual(["text", "integer", "integer"]);
    expect(executions[0]!.every((scalar) => Object.isFrozen(scalar))).toBe(true);
    expect(Object.isFrozen(executions[0])).toBe(true);
    expect(snapshot.parameterSha256)
      .toBe(digestSQLiteInitialWriteParametersIntrinsic(expected));
    expect(snapshot.resultSha256)
      .toBe(digestSQLiteInitialWriteResultIntrinsic({ affectedRows: "1" }));
  });

  it("rejects wrong, cloned, proxied, revoked, and cross-run header receipts before SQL", () => {
    const graph = sequenceGraph(1);
    const other = sequenceGraph(1);
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );
    const clone = Object.freeze({
      ...readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(graph.headerReceipt),
    });
    const revoked = Proxy.revocable(graph.headerReceipt, {});
    const candidates = [
      Object.freeze(Object.create(null)),
      clone,
      new Proxy(graph.headerReceipt, {}),
      revoked.proxy,
      other.headerReceipt,
    ] as readonly unknown[];
    revoked.revoke();

    for (const candidate of candidates) {
      expectProviderError(
        () => executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
          graph.authority,
          graph.migration0002Receipt,
          graph.fence,
          graph.readerLease,
          graph.entriesReceipt,
          candidate as SQLiteBaselineHeaderPublicationReceipt,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /baseline|header|sequence|receipt|graph|invalid/u,
      );
    }
    expect(begin).not.toHaveBeenCalled();
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "active",
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        writePhase: "baseline-header-complete",
      });
    expect(publishSequence(graph)).toBeDefined();
  });

  it("rejects forged sequence receipts without disturbing the authentic graph", () => {
    const graph = sequenceGraph(1);
    const other = sequenceGraph(1);
    const receipt = publishSequence(graph);
    const otherReceipt = publishSequence(other);
    const clone = Object.freeze({
      ...readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(receipt),
    });
    const revoked = Proxy.revocable(receipt, {});
    const candidates = [
      Object.freeze(Object.create(null)),
      clone,
      new Proxy(receipt, {}),
      revoked.proxy,
      otherReceipt,
    ] as readonly unknown[];
    revoked.revoke();

    for (const candidate of candidates) {
      expectProviderError(
        () => assertSequence(
          graph,
          candidate as SQLiteOperationSequenceZeroPublicationReceipt,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /sequence|zero|receipt|graph|invalid/u,
      );
    }
    expect(assertSequence(graph, receipt)).toBe(receipt);
    expect(assertSequence(other, otherReceipt)).toBe(otherReceipt);
  });

  it("poisons replay before preparing or executing another sequence INSERT", () => {
    const graph = sequenceGraph(8);
    const receipt = publishSequence(graph);
    const totalBeforeReplay = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /sequence|zero|publication|reused|second/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection))
      .toEqual(totalBeforeReplay);
    expect(readSequenceRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroPublicationReceipt: receipt,
        operationSequenceZeroPublicationReceiptMintCount: 1,
        writePhase: "poisoned",
      });
  });

  it("records zero prepare/run/row progress when sequence prepare fails", () => {
    const graph = sequenceGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced sequence-zero prepare failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    ).mockImplementation(() => {
      throw primary;
    });

    expect(() => publishSequence(graph)).toThrow(primary);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroAffectedRows: 0,
        operationSequenceZeroExecuteCount: 0,
        operationSequenceZeroPrepareCount: 0,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        outerLedger: {
          affectedRowsWatermark: 8,
          fixedStatementCount: 26,
          logicalWriteSequence: 3,
        },
        writePhase: "poisoned",
      });
  });

  it("records one prepare but zero physical rows when native run is not reached", () => {
    const graph = sequenceGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced sequence-zero run failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "executeSQLiteConnectionOperationSequenceZeroIntrinsic",
    ).mockImplementation(() => {
      throw primary;
    });

    expect(() => publishSequence(graph)).toThrow(primary);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroAffectedRows: 0,
        operationSequenceZeroExecuteCount: 0,
        operationSequenceZeroPrepareCount: 1,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        writePhase: "poisoned",
      });
  });

  it("preserves the real sequence row when the returned step result is spoofed", () => {
    const graph = sequenceGraph(1);
    const originalExecute =
      sqliteConnectionModule.executeSQLiteConnectionOperationSequenceZeroIntrinsic;
    vi.spyOn(
      sqliteConnectionModule,
      "executeSQLiteConnectionOperationSequenceZeroIntrinsic",
    ).mockImplementation((connection, execution, row) => {
      const step = originalExecute(connection, execution, row);
      return Object.freeze({ ...step, affectedRowsDelta: 0 }) as typeof step;
    });

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /sequence|zero|execution|drift|result/u,
    );
    expect(readSequenceRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroAffectedRows: 1,
        operationSequenceZeroExecuteCount: 1,
        operationSequenceZeroPrepareCount: 1,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        outerLedger: {
          affectedRowsWatermark: 9,
          fixedStatementCount: 27,
          logicalWriteSequence: 3,
        },
        writePhase: "poisoned",
      });
  });

  it("rejects post-write parameter digest drift before minting a receipt", () => {
    const graph = sequenceGraph(1);
    const originalDigest =
      initialWriteDigestModule.digestSQLiteInitialWriteParametersIntrinsic;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteParametersIntrinsic",
    ).mockImplementation((parameters) => {
      const actual = originalDigest(parameters);
      return `${actual.slice(0, -1)}${actual.endsWith("0") ? "1" : "0"}` as typeof actual;
    });

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /sequence|zero|digest|parameter|receipt/u,
    );
    expect(readSequenceRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroAffectedRows: 1,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        outerLedger: {
          affectedRowsWatermark: 9,
          fixedStatementCount: 27,
          logicalWriteSequence: 3,
        },
        writePhase: "poisoned",
      });
  });

  it("rejects post-write aggregate result digest drift before minting a receipt", () => {
    const graph = sequenceGraph(1);
    const originalDigest = initialWriteDigestModule.digestSQLiteInitialWriteResultIntrinsic;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteResultIntrinsic",
    ).mockImplementation((result) => {
      const actual = originalDigest(result);
      return `${actual.slice(0, -1)}${actual.endsWith("0") ? "1" : "0"}` as typeof actual;
    });

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /sequence|zero|digest|result|receipt/u,
    );
    expect(readSequenceRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroAffectedRows: 1,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        outerLedger: {
          affectedRowsWatermark: 9,
          fixedStatementCount: 27,
          logicalWriteSequence: 3,
        },
        writePhase: "poisoned",
      });
  });

  it("never opens, commits, rolls back, or otherwise owns the caller transaction", () => {
    const graph = sequenceGraph(1);
    const exec = vi.spyOn(graph.connection, "execTrusted");
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const receipt = publishSequence(graph);

    expect(exec).not.toHaveBeenCalled();
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toMatchObject({
      isTransaction: true,
      transactionLineage: ownerBefore.transactionLineage,
      transactionMode: "exclusive",
    });
    expect(assertSequence(graph, receipt)).toBe(receipt);
  });

  it("rejects stale transaction lineage before preparing sequence zero", () => {
    const graph = sequenceGraph(1);
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_STALE_FENCE",
      /clock|lineage|retired|stale|transaction/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "retired",
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
      });
  });

  it("poisons catalog drift before preparing sequence zero", () => {
    const graph = sequenceGraph(1);
    graph.connection.prepare(
      "CREATE TABLE main.ge_hostile_sequence_catalog_drift (id INTEGER NOT NULL)",
      "inspect-schema",
    ).run();
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /catalog|fence|drift|baseline|header/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroPublicationReceiptMintCount: 0,
        writePhase: "poisoned",
      });
  });

  it("poisons unexplained total-change watermark drift before preparing sequence zero", () => {
    const graph = sequenceGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges;
    graph.connection.prepare(
      "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1",
      "inspect-schema",
    ).run();
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /clock|drift|ledger|watermark|receipt/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore + 1);
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroPublicationReceiptMintCount: 0,
        writePhase: "poisoned",
      });
  });

  it("uses captured database, statement, and string methods in the sequence write window", () => {
    const graph = sequenceGraph(1);
    const database = DatabaseSync.prototype as unknown as {
      prepare(sql: string): unknown;
    };
    const statement = StatementSync.prototype as unknown as {
      run(...parameters: readonly unknown[]): unknown;
    };
    const originalPrepare = database.prepare;
    const originalRun = statement.run;
    const originalStartsWith = String.prototype.startsWith;
    const originalSlice = String.prototype.slice;
    const originalBegin =
      sqliteConnectionModule.beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic;
    const originalExecute =
      sqliteConnectionModule.executeSQLiteConnectionOperationSequenceZeroIntrinsic;
    let hostileCalls = 0;
    let receipt: SQLiteOperationSequenceZeroPublicationReceipt | undefined;
    try {
      vi.spyOn(
        sqliteConnectionModule,
        "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
      ).mockImplementation((connection) => {
        database.prepare = function (): never {
          hostileCalls += 1;
          throw new Error("hostile DatabaseSync.prototype.prepare replacement");
        };
        statement.run = function (): never {
          hostileCalls += 1;
          throw new Error("hostile StatementSync.prototype.run replacement");
        };
        String.prototype.startsWith = function (): never {
          hostileCalls += 1;
          throw new Error("hostile String.prototype.startsWith replacement");
        };
        String.prototype.slice = function (): never {
          hostileCalls += 1;
          throw new Error("hostile String.prototype.slice replacement");
        };
        return originalBegin(connection);
      });
      vi.spyOn(
        sqliteConnectionModule,
        "executeSQLiteConnectionOperationSequenceZeroIntrinsic",
      ).mockImplementation((connection, execution, row) => {
        try {
          return originalExecute(connection, execution, row);
        } finally {
          database.prepare = originalPrepare;
          statement.run = originalRun;
          String.prototype.startsWith = originalStartsWith;
          String.prototype.slice = originalSlice;
        }
      });
      receipt = publishSequence(graph);
    } finally {
      database.prepare = originalPrepare;
      statement.run = originalRun;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.slice = originalSlice;
    }

    expect(hostileCalls).toBe(0);
    expect(receipt).toBeDefined();
    expect(assertSequence(graph, receipt!)).toBe(receipt);
    expect(readSequenceRows(graph)).toHaveLength(1);
  });

  it("uses captured Hash update/digest throughout sequence publish and assertion", () => {
    const graph = sequenceGraph(1);
    const hashPrototype = Object.getPrototypeOf(createHash("sha256")) as {
      digest(...parameters: readonly unknown[]): unknown;
      update(...parameters: readonly unknown[]): unknown;
    };
    const originalUpdate = hashPrototype.update;
    const originalDigest = hashPrototype.digest;
    let hostileUpdateCalls = 0;
    let hostileDigestCalls = 0;
    let receipt: SQLiteOperationSequenceZeroPublicationReceipt | undefined;
    let asserted: SQLiteOperationSequenceZeroPublicationReceipt | undefined;
    try {
      hashPrototype.update = function (): never {
        hostileUpdateCalls += 1;
        throw new Error("hostile Hash.prototype.update replacement");
      };
      hashPrototype.digest = function (): never {
        hostileDigestCalls += 1;
        throw new Error("hostile Hash.prototype.digest replacement");
      };
      receipt = publishSequence(graph);
      asserted = assertSequence(graph, receipt);
    } finally {
      hashPrototype.update = originalUpdate;
      hashPrototype.digest = originalDigest;
    }

    expect(hostileUpdateCalls).toBe(0);
    expect(hostileDigestCalls).toBe(0);
    expect(receipt).toBeDefined();
    expect(asserted).toBe(receipt);
    expect(readSequenceRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "active",
        operationSequenceZeroPublicationReceipt: receipt,
        operationSequenceZeroPublicationReceiptMintCount: 1,
        writePhase: "sequence-zero-complete",
      });
  });

  it("refuses a poisoned authority that left the baseline-header-complete phase", () => {
    const graph = sequenceGraph(1);
    expectProviderError(
      () => executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
        graph.authority,
        graph.migration0002Receipt,
        graph.fence,
        graph.readerLease,
        graph.entriesReceipt,
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /baseline-header publication was reused/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite outer publication authority is poisoned$/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroAffectedRows: 0,
        operationSequenceZeroExecuteCount: 0,
        operationSequenceZeroLogicalExecutionCount: 0,
        operationSequenceZeroPrepareCount: 0,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        writePhase: "poisoned",
      });
  });

  it("stale-fences a retired authority rather than reporting a corrupt store", () => {
    const graph = sequenceGraph(1);
    // Retire through an unrelated route: replacing the owner transaction
    // generation makes the retained lineage stale, which retires rather than
    // poisons the authority graph. The executor must then report the retirement
    // as a stale fence a caller can retry at a higher layer, not as corruption.
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    expectProviderError(
      () => readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(graph.headerReceipt),
      "GE_CYCLE_STORE_STALE_FENCE",
      /^SQLite baseline-header publication transaction lineage is stale$/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "retired",
        stageOwnershipPoisonReason: undefined,
        writePhase: "retired",
      });
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_STALE_FENCE",
      /^SQLite outer publication authority is retired$/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "retired",
        operationSequenceZeroAffectedRows: 0,
        operationSequenceZeroExecuteCount: 0,
        operationSequenceZeroLogicalExecutionCount: 0,
        operationSequenceZeroPrepareCount: 0,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        stageOwnershipPoisonReason: undefined,
        writePhase: "retired",
      });
  });

  it("poisons a provider clock that precedes the retained baseline capture time", () => {
    const graph = sequenceGraph(1, READER_CAPTURED_AT_MS - 1);
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );
    expect(readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
      graph.providerClockCapability,
      graph.outerClockEvidence,
    ).providerNowMs).toBe(READER_CAPTURED_AT_MS - 1);
    expect(graph.sourceSummary.sourceEnvelope.capturedAtMs).toBe(READER_CAPTURED_AT_MS);

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero provider timestamp predecessor drifted$/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroAffectedRows: 0,
        operationSequenceZeroExecuteCount: 0,
        operationSequenceZeroLogicalExecutionCount: 0,
        operationSequenceZeroPrepareCount: 0,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        writePhase: "poisoned",
      });
  });

  it("accepts an outer provider clock exactly equal to the retained capture time", () => {
    const graph = sequenceGraph(1, READER_CAPTURED_AT_MS);
    const receipt = publishSequence(graph);

    expect(readSequenceRows(graph)).toEqual([[
      1n,
      graph.projectionIdentity.baselineId,
      0n,
      BigInt(READER_CAPTURED_AT_MS),
      BigInt(READER_CAPTURED_AT_MS),
    ]]);
    expect(readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(receipt))
      .toMatchObject({
        baselineCapturedAtMs: READER_CAPTURED_AT_MS,
        outerProviderNowMs: READER_CAPTURED_AT_MS,
        updatedAtMs: READER_CAPTURED_AT_MS,
      });
    expect(assertSequence(graph, receipt)).toBe(receipt);
  });

  it("binds the sequence receipt to the exact baseline-header snapshot identity", () => {
    const graph = sequenceGraph(1);
    const headerSnapshot = readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(
      graph.headerReceipt,
    );
    const receipt = publishSequence(graph);
    const snapshot = readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(
      receipt,
    );

    expect(headerSnapshot.projectionIdentity).toBe(graph.projectionIdentity);
    expect(snapshot.projectionIdentity).toBe(headerSnapshot.projectionIdentity);
    expect(snapshot.baselineId).toBe(headerSnapshot.baselineId);
    expect(snapshot.baselineId).toBe(graph.projectionIdentity.baselineId);
    expect(snapshot.baselineCapturedAtMs).toBe(headerSnapshot.capturedAtMs);
    expect(snapshot.baselineCapturedAtMs)
      .toBe(graph.sourceSummary.sourceEnvelope.capturedAtMs);
  });

  it("poisons frozen sequence INSERT SQL identity drift before preparing anything", () => {
    const graph = sequenceGraph(1);
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC",
      "get",
    ).mockReturnValue(
      `${SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC} -- drift` as
        unknown as typeof SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
    );

    expectProviderError(
      () => publishSequence(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero SQL identity drifted$/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroAffectedRows: 0,
        operationSequenceZeroExecuteCount: 0,
        operationSequenceZeroLogicalExecutionCount: 0,
        operationSequenceZeroPrepareCount: 0,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        // The SQL identity comparison is hoisted out of the preflight `try`.
        // Both placements throw the same translated error, so only the reason
        // forwarded to the stage-ownership poison bridge distinguishes an
        // identity rejection from a preflight failure.
        stageOwnershipPoisonReason:
          "SQLite operation-sequence-zero SQL identity drifted",
        writePhase: "poisoned",
      });
  });

  it("names the SQL preflight failure distinctly from SQL identity drift", () => {
    const graph = sequenceGraph(1);
    const primary = new Error("hostile sha256 preflight failure");
    vi.spyOn(
      sqliteConnectionModule,
      "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC",
      "get",
    ).mockImplementation(() => { throw primary; });

    expect(() => publishSequence(graph)).toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        stageOwnershipPoisonReason:
          "SQLite operation-sequence-zero SQL preflight failed",
        writePhase: "poisoned",
      });
  });

  it("rejects a hostile retained capture time with zero progress before prepare", () => {
    // The sequence entry compares its own updated time against the retained
    // baseline capture time, so it validates that comparand rather than
    // assuming it. The bound is defence in depth: a hostile retained capture
    // time is already refused by the baseline-header receipt proof this leaf
    // delegates to, which is what this test pins - the rejection must stay a
    // zero-progress rejection that never prepares the sequence statement.
    const original = cursorOwnershipModule.assertSQLiteCursorPreRebindReceiptProvenance;
    let retainedEnvelope: { capturedAtMs: number } | undefined;
    vi.spyOn(
      cursorOwnershipModule,
      "assertSQLiteCursorPreRebindReceiptProvenance",
    ).mockImplementation((receipt) => {
      const witness = original(receipt);
      retainedEnvelope ??= { ...witness.sourceSummary.sourceEnvelope };
      return Object.freeze({
        ...witness,
        sourceSummary: Object.freeze({
          ...witness.sourceSummary,
          sourceEnvelope: retainedEnvelope,
        }),
      }) as typeof witness;
    });
    const graph = sequenceGraph(1);
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
    );
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    expect(retainedEnvelope).toBeDefined();
    retainedEnvelope!.capturedAtMs = -1;

    expect(() => publishSequence(graph)).toThrow(CycleStoreProviderError);
    expect(begin).not.toHaveBeenCalled();
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readSequenceRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        operationSequenceZeroPrepareCount: 0,
        operationSequenceZeroPublicationReceipt: undefined,
        operationSequenceZeroPublicationReceiptMintCount: 0,
        writePhase: "poisoned",
      });
  });

  it("re-derives the receipt updated time from retained clock evidence", () => {
    const graph = sequenceGraph(1);
    const receipt = publishSequence(graph);
    const snapshot = readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(
      receipt,
    );
    const authentic = readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
      graph.providerClockCapability,
      graph.outerClockEvidence,
    );
    const original =
      clockAuthorityModule.readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic;
    vi.spyOn(
      clockAuthorityModule,
      "readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic",
    ).mockImplementation((capability, evidence) => Object.freeze({
      ...original(capability, evidence),
      providerNowMs: authentic.providerNowMs + 1,
    }));

    expectProviderError(
      () => assertSequence(graph, receipt),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite operation-sequence-zero receipt clock evidence drifted$/u,
    );
    // The receipt still agrees with itself: every digest the assertion
    // recomputes is unchanged, so only the independent clock re-derivation
    // can have rejected this receipt.
    expect(snapshot.parameterSha256)
      .toBe(digestSQLiteInitialWriteParametersIntrinsic(sequenceParameterFrame(graph)));
    expect(snapshot.resultSha256)
      .toBe(digestSQLiteInitialWriteResultIntrinsic({ affectedRows: "1" }));
    expect(snapshot.updatedAtMs).toBe(authentic.providerNowMs);
    expect(readSequenceRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("keeps every sequence-zero authority and connection session API package-private", () => {
    const privateNames = [
      "executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic",
      "assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic",
      "readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic",
      "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC",
      "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC",
      "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC",
      "beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic",
      "executeSQLiteConnectionOperationSequenceZeroIntrinsic",
      "readSQLiteConnectionOperationSequenceZeroExecutionSnapshotIntrinsic",
    ];
    for (const name of privateNames) expect(name in sqliteRoot).toBe(false);
  });
});
