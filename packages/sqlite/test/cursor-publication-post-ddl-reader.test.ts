import { Buffer } from "node:buffer";
import { StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as sqliteRoot from "../src/index.js";
import { OperationBaselineAccumulator } from "../src/operation-baseline.js";
import * as targetCatalogModule from "../src/cursor-publication-target-catalog.js";
import {
  SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
  SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256,
  assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic,
  createSQLiteCursorOuterPublicationCancellationControllerIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic,
  type SQLiteCursorPostDdlPublicationReaderLease,
} from "../src/cursor-publication-outer-authority.js";
import * as sqliteConnectionModule from "../src/sqlite-connection.js";
import {
  SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const graphs: ReaderLeaseTestGraph[] = [];

function cleanGraph(legacyOperationCount = 0): ReaderLeaseTestGraph {
  const graph = createReaderLeaseTestGraph(legacyOperationCount);
  graphs.push(graph);
  return graph;
}

function mintLease(graph: ReaderLeaseTestGraph): SQLiteCursorPostDdlPublicationReaderLease {
  return mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
  );
}

function executeLease(
  graph: ReaderLeaseTestGraph,
  lease: SQLiteCursorPostDdlPublicationReaderLease,
  signal?: Parameters<typeof executeSQLiteCursorPostDdlPublicationReaderIntrinsic>[4],
): SQLiteCursorPostDdlPublicationReaderLease {
  return executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    lease,
    signal,
  );
}

function assertTerminal(
  graph: ReaderLeaseTestGraph,
  lease: SQLiteCursorPostDdlPublicationReaderLease,
): SQLiteCursorPostDdlPublicationReaderLease {
  return assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    lease,
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

afterEach(() => {
  vi.restoreAllMocks();
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite post-DDL publication reader lease", () => {
  it("owns one exact read, closes once, retires, and leaves all write counters still", () => {
    const graph = cleanGraph(2);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const authorityBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );

    const lease = mintLease(graph);
    expect(Object.isFrozen(lease)).toBe(true);
    expect(Object.getPrototypeOf(lease)).toBeNull();
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        authority: graph.authority,
        closeAttemptCount: 0,
        closeSucceeded: false,
        connection: graph.connection,
        consumesAnyWriteReceipt: false,
        executeCount: 0,
        fetchCount: 0,
        lifecycle: "minted-unused",
        mayMintStageAdoptionReceipt: false,
        migration0002Receipt: graph.migration0002Receipt,
        mintCount: 1,
        ownershipAcquisitionCount: 0,
        permanentWriteAuthority: false,
        postDdlCatalogFence: graph.fence,
        prepareCount: 0,
        projectionIdentity: graph.projectionIdentity,
        projectionReference: graph.projectionReference,
        sourceReadSql: SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
        sourceReadSqlSha256:
          SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256,
        stage: graph.stage,
        transfer: graph.transfer,
      });

    expect(executeLease(graph, lease)).toBe(lease);
    const snapshot = readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease);
    expect(snapshot).toMatchObject({
      closeAttemptCount: 1,
      closeSucceeded: true,
      executeCount: 1,
      lifecycle: "retired",
      ownershipAcquisitionCount: 1,
      prepareCount: 1,
      rederivedEntryCount: graph.projectionIdentity.entryCount,
      rederivedFinalEntryHash: graph.projectionIdentity.finalEntryHash,
      rederivedFirstEntryHash: graph.projectionIdentity.firstEntryHash,
      rederivedLegacyOperationCount: graph.projectionIdentity.legacyOperationCount,
      rederivedProjectionSha256: graph.projectionIdentity.projectionSha256,
    });
    expect(snapshot.fetchCount).toBe(graph.projectionIdentity.entryCount + 1);
    expect(assertTerminal(graph, lease)).toBe(lease);
    expect(assertTerminal(graph, lease)).toBe(lease);

    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    const authorityAfter = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );
    expect(authorityAfter.outerLedger).toEqual(authorityBefore.outerLedger);
    expect(authorityAfter.postDdlPublicationReaderLease).toBe(lease);
    expect(authorityAfter.postDdlPublicationReaderLeaseMintCount).toBe(1);
    expect(authorityAfter.postDdlPublicationReaderLeaseCloseCount).toBe(1);
  });

  it("freezes the one-line source query and its exact ordering identity", () => {
    expect(SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL).toBe(
      "SELECT kind_rank, entry_kind, key_blob, state_blob "
        + "FROM temp.ge_blr_stage ORDER BY kind_rank ASC, key_blob ASC",
    );
    expect(SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL).toBe(
      SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC,
    );
    expect(SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256).toBe(
      "adae52750ecd70a75090b52de7d60763eea144c1383cf4739df9d8e8a6b2357f",
    );
  });

  it("detects injected SQL/order drift and closes the already-owned reader once", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") {
        return connection.prepare(
          "SELECT kind_rank, entry_kind, key_blob, state_blob "
            + "FROM temp.ge_blr_stage ORDER BY kind_rank DESC, key_blob DESC",
          operation,
        );
      }
      return originalPrepare(connection, kind, operation);
    });

    expectProviderError(
      () => executeLease(graph, lease),
      "GE_CYCLE_STORE_CORRUPTION",
      /order|projection/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
        prepareCount: 1,
      });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons execution replay without changing the retired lease counters", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    executeLease(graph, lease);
    expect(assertTerminal(graph, lease)).toBe(lease);
    expect(assertTerminal(graph, lease)).toBe(lease);
    const terminalBefore = readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease);

    expectProviderError(
      () => executeLease(graph, lease),
      "GE_CYCLE_STORE_CORRUPTION",
      /reader|lease|retired|reused/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: terminalBefore.closeAttemptCount,
        closeSucceeded: true,
        executeCount: terminalBefore.executeCount,
        fetchCount: terminalBefore.fetchCount,
        ownershipAcquisitionCount: terminalBefore.ownershipAcquisitionCount,
        prepareCount: terminalBefore.prepareCount,
      });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("rejects a second mint before a read and moves no connection or ledger counter", () => {
    const graph = cleanGraph();
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const ledgerBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    ).outerLedger;
    const lease = mintLease(graph);

    expectProviderError(
      () => mintLease(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /reader|lease|mint|reused/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 0,
        closeSucceeded: false,
        executeCount: 0,
        fetchCount: 0,
        ownershipAcquisitionCount: 0,
        prepareCount: 0,
      });
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority).outerLedger)
      .toEqual(ledgerBefore);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("rejects clones, proxies, revoked proxies, substitutions, and cross-run leases", () => {
    const graph = cleanGraph();
    const other = cleanGraph();
    const lease = mintLease(graph);
    const otherLease = mintLease(other);
    const snapshotClone = Object.freeze({
      ...readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease),
    });
    const revoked = Proxy.revocable(lease, {});
    const invalid = [
      Object.freeze(Object.create(null)),
      snapshotClone,
      new Proxy(lease, {}),
      revoked.proxy,
      otherLease,
    ] as readonly unknown[];
    revoked.revoke();

    for (const candidate of invalid) {
      expectProviderError(
        () => executeLease(graph, candidate as SQLiteCursorPostDdlPublicationReaderLease),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /reader|lease|graph|invalid/u,
      );
    }
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({ lifecycle: "minted-unused", prepareCount: 0 });
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(otherLease))
      .toMatchObject({ lifecycle: "minted-unused", prepareCount: 0 });
    expect(executeLease(graph, lease)).toBe(lease);
    expect(executeLease(other, otherLease)).toBe(otherLease);
  });

  it("rejects nonterminal proof presentations but keeps the authentic lease executable", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    expectProviderError(
      () => assertTerminal(graph, lease),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /reader|lease|terminal|active|closed/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({ lifecycle: "minted-unused", closeAttemptCount: 0 });
    expect(executeLease(graph, lease)).toBe(lease);
    expect(assertTerminal(graph, lease)).toBe(lease);
  });

  it("uses the closed-set source-read kind exactly once", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const sourceKinds: string[] = [];
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourceKinds.push(kind);
      return originalPrepare(connection, kind, operation);
    });

    executeLease(graph, lease);
    expect(sourceKinds).toEqual(["cursor-publication-post-ddl-baseline-source"]);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease).prepareCount)
      .toBe(1);
  });

  it("revalidates the physical catalog after source close before retirement", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const originalRead =
      targetCatalogModule.readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic;
    const closeCountsAtFreshRead: number[] = [];
    vi.spyOn(
      targetCatalogModule,
      "readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic",
    ).mockImplementation((connection) => {
      closeCountsAtFreshRead.push(
        readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease)
          .closeAttemptCount,
      );
      return originalRead(connection);
    });

    expect(executeLease(graph, lease)).toBe(lease);
    expect(closeCountsAtFreshRead).toEqual([0, 1]);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease).lifecycle)
      .toBe("retired");

    const executionReadCount = closeCountsAtFreshRead.length;
    expect(assertTerminal(graph, lease)).toBe(lease);
    expect(closeCountsAtFreshRead.length).toBe(executionReadCount + 1);
  });

  it("keeps a preownership cancellation retryable and records no prepare, fetch, or close", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    cancellation.cancel();

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_UNAVAILABLE",
      /cancel/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 0,
        closeSucceeded: false,
        executeCount: 0,
        fetchCount: 0,
        lifecycle: "minted-unused",
        ownershipAcquisitionCount: 0,
        prepareCount: 0,
      });
    expect(executeLease(graph, lease)).toBe(lease);
  });

  it("keeps stale transaction lineage ahead of preownership cancellation", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    cancellation.cancel();
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_STALE_FENCE",
      /clock|lineage|retired|stale|transaction/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 0,
        fetchCount: 0,
        ownershipAcquisitionCount: 0,
        prepareCount: 0,
      });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority).lifecycle)
      .toBe("retired");
  });

  it("keeps unexplained watermark drift ahead of preownership cancellation", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    cancellation.cancel();
    graph.connection.prepare(
      "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1",
      "inspect-schema",
    ).run();

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_CORRUPTION",
      /clock|drift|ledger|watermark/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 0,
        fetchCount: 0,
        ownershipAcquisitionCount: 0,
        prepareCount: 0,
      });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("records prepare failure before ownership without inventing a close", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced reader prepare failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") throw primary;
      return originalPrepare(connection, kind, operation);
    });

    expect(() => executeLease(graph, lease)).toThrow(primary);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 0,
        closeSucceeded: false,
        fetchCount: 0,
        ownershipAcquisitionCount: 0,
        prepareCount: 0,
      });
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
  });

  it("records iterator-acquisition failure after prepare but before ownership with zero closes", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalIterate = sqliteConnectionModule.iterateSQLiteStatementNativeIntrinsic;
    let sourcePrepared = false;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "iterateSQLiteStatementNativeIntrinsic",
    ).mockImplementation((statement) => {
      if (sourcePrepared) throw new Error("forced reader iterator acquisition failure");
      return originalIterate(statement);
    });

    expect(() => executeLease(graph, lease)).toThrow(CycleStoreProviderError);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 0,
        closeSucceeded: false,
        fetchCount: 0,
        ownershipAcquisitionCount: 0,
        prepareCount: 1,
      });
  });

  it("closes exactly once when an owned reader produces a projection mismatch", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let truncated = false;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared && !truncated) {
        truncated = true;
        return { done: true, value: undefined };
      }
      return originalNext(iterator);
    });

    expectProviderError(
      () => executeLease(graph, lease),
      "GE_CYCLE_STORE_CORRUPTION",
      /projection|entry|count|mismatch|terminal proof/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        fetchCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
        prepareCount: 1,
        rederivedProjectionSha256: undefined,
      });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority).lifecycle)
      .toBe("poisoned");
  });

  it("keeps a row/fetch primary error ahead of a simultaneous close failure", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    const originalReturn = sqliteConnectionModule.returnSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "forced reader row hash failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) throw primary;
      return originalNext(iterator);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "returnSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) throw new Error("forced reader close failure");
      return originalReturn(iterator);
    });

    expect(() => executeLease(graph, lease)).toThrow(primary);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: false,
        fetchCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
        prepareCount: 1,
      });
    expect(() => assertTerminal(graph, lease)).toThrow();
  });

  it("surfaces close failure after a valid read and never accepts failed-close terminal proof", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalReturn = sqliteConnectionModule.returnSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    const close = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced reader close failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "returnSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) throw close;
      return originalReturn(iterator);
    });

    expect(() => executeLease(graph, lease)).toThrow(close);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: false,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
        prepareCount: 1,
        rederivedProjectionSha256: graph.projectionIdentity.projectionSha256,
      });
    expect(() => assertTerminal(graph, lease)).toThrow();
  });

  it("closes an owned reader once on cancellation", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let cancelled = false;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      const result = originalNext(iterator);
      if (sourcePrepared && !cancelled) {
        cancelled = true;
        cancellation.cancel();
      }
      return result;
    });

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_UNAVAILABLE",
      /cancel/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
        prepareCount: 1,
      });
  });

  it("honors cancellation first observed on the validated terminal fetch", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let cancelledAtTerminal = false;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      const result = originalNext(iterator);
      if (sourcePrepared && result.done === true) {
        cancelledAtTerminal = true;
        cancellation.cancel();
      }
      return result;
    });

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_UNAVAILABLE",
      /cancel/u,
    );
    expect(cancelledAtTerminal).toBe(true);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        fetchCount: graph.projectionIdentity.entryCount + 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
        rederivedEntryCount: graph.projectionIdentity.entryCount,
        rederivedProjectionSha256: graph.projectionIdentity.projectionSha256,
      });
  });

  it("keeps transaction-lineage loss ahead of cancellation after ownership", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let invalidated = false;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      const result = originalNext(iterator);
      if (sourcePrepared && !invalidated) {
        invalidated = true;
        graph.connection.execTrusted("ROLLBACK", "inspect-schema");
        graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
        cancellation.cancel();
      }
      return result;
    });

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_STALE_FENCE",
      /clock|lineage|retired|stale|transaction/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
      });
  });

  it("keeps unexplained watermark drift ahead of cancellation after ownership", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let drifted = false;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      const result = originalNext(iterator);
      if (sourcePrepared && !drifted) {
        drifted = true;
        graph.connection.prepare(
          "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1",
          "inspect-schema",
        ).run();
        cancellation.cancel();
      }
      return result;
    });

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_CORRUPTION",
      /clock|drift|ledger|watermark/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
      });
  });

  it("keeps close failure ahead of cancellation once reader ownership exists", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    const originalReturn = sqliteConnectionModule.returnSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let cancelled = false;
    const close = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced reader close outranks cancellation",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      const result = originalNext(iterator);
      if (sourcePrepared && !cancelled) {
        cancelled = true;
        cancellation.cancel();
      }
      return result;
    });
    vi.spyOn(
      sqliteConnectionModule,
      "returnSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) throw close;
      return originalReturn(iterator);
    });

    expect(() => executeLease(graph, lease, cancellation.signal)).toThrow(close);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: false,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
      });
  });

  it("keeps a primary fetch failure ahead of both close failure and cancellation", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    const originalReturn = sqliteConnectionModule.returnSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "forced primary reader failure outranks cleanup and cancellation",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) {
        cancellation.cancel();
        throw primary;
      }
      return originalNext(iterator);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "returnSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) throw new Error("forced secondary reader close failure");
      return originalReturn(iterator);
    });

    expect(() => executeLease(graph, lease, cancellation.signal)).toThrow(primary);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: false,
        fetchCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
      });
  });

  it("validates a fetched malformed row before honoring simultaneous cancellation", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let injected = false;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      const result = originalNext(iterator);
      if (sourcePrepared && !injected) {
        injected = true;
        cancellation.cancel();
        return { done: false, value: ["malformed-row"] };
      }
      return result;
    });

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_CORRUPTION",
      /row/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        fetchCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
      });
  });

  it("keeps an invalid fetched terminal primary ahead of close failure and cancellation", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    const originalReturn = sqliteConnectionModule.returnSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let injected = false;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared && !injected) {
        injected = true;
        cancellation.cancel();
        return { done: "hostile-terminal", value: undefined } as unknown as
          IteratorResult<unknown>;
      }
      return originalNext(iterator);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "returnSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) throw new Error("secondary close after invalid terminal");
      return originalReturn(iterator);
    });

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_CORRUPTION",
      /terminal/u,
    );
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: false,
        fetchCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
      });
  });

  it("detects a reentrant second open while the first owned reader is active", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let nested: unknown;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared && nested === undefined) {
        try {
          executeLease(graph, lease);
        } catch (error) {
          nested = error;
        }
      }
      return originalNext(iterator);
    });

    expect(() => executeLease(graph, lease)).toThrow();
    expect(nested).toBeInstanceOf(CycleStoreProviderError);
    expect((nested as CycleStoreProviderError).code).toBe("GE_CYCLE_STORE_CORRUPTION");
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
        prepareCount: 1,
      });
  });

  it("rejects terminal proof while the owned reader is active and still closes it", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let activeProofError: unknown;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared && activeProofError === undefined) {
        try {
          assertTerminal(graph, lease);
        } catch (error) {
          activeProofError = error;
        }
      }
      return originalNext(iterator);
    });

    expect(executeLease(graph, lease)).toBe(lease);
    expect(activeProofError).toBeInstanceOf(CycleStoreProviderError);
    expect((activeProofError as CycleStoreProviderError).code)
      .toBe("GE_CYCLE_STORE_INVALID_ARGUMENT");
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        lifecycle: "retired",
        ownershipAcquisitionCount: 1,
      });
  });

  it("rejects a formerly terminal lease after rollback and transaction rebegin", () => {
    const graph = cleanGraph();
    const lease = mintLease(graph);
    executeLease(graph, lease);
    expect(assertTerminal(graph, lease)).toBe(lease);
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");

    expect(() => assertTerminal(graph, lease)).toThrow();
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        lifecycle: "retired",
      });
  });

  it("keeps stage-disposal corruption ahead of cancellation and closes exactly once", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const cancellation = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalNext = sqliteConnectionModule.nextSQLiteStatementIteratorNativeIntrinsic;
    const originalReturn = sqliteConnectionModule.returnSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    let disposed = false;
    let sourceCloseCalls = 0;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    vi.spyOn(
      sqliteConnectionModule,
      "nextSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      const result = originalNext(iterator);
      if (sourcePrepared && !disposed) {
        disposed = true;
        cancellation.cancel();
        graph.stage.dispose();
      }
      return result;
    });
    vi.spyOn(
      sqliteConnectionModule,
      "returnSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) sourceCloseCalls += 1;
      return originalReturn(iterator);
    });

    expectProviderError(
      () => executeLease(graph, lease, cancellation.signal),
      "GE_CYCLE_STORE_CORRUPTION",
      /cleaned up|owner|stage|reader/u,
    );
    expect(sourceCloseCalls).toBe(1);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        lifecycle: "poisoned",
        ownershipAcquisitionCount: 1,
      });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("uses captured native StatementSync iteration after prototype replacement", () => {
    const graph = cleanGraph(1);
    const lease = mintLease(graph);
    const native = StatementSync.prototype as unknown as {
      iterate(...parameters: readonly unknown[]): unknown;
    };
    const originalIterate = native.iterate;
    try {
      native.iterate = function (): never {
        throw new Error("hostile StatementSync.prototype.iterate replacement");
      };
      expect(executeLease(graph, lease)).toBe(lease);
      expect(assertTerminal(graph, lease)).toBe(lease);
    } finally {
      native.iterate = originalIterate;
    }
  });

  it("retains canonical entries despite an inherited numeric setter attack", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const originalZero = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    let result: SQLiteCursorPostDdlPublicationReaderLease | undefined;
    try {
      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set(value: unknown): void {
          if (value !== null && typeof value === "object"
              && Object.hasOwn(value, "entryHash")
              && Object.hasOwn(value, "baselineId")) {
            throw new Error("hostile inherited canonical-entry index setter");
          }
          Object.defineProperty(this, "0", {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
          });
        },
      });
      result = executeLease(graph, lease);
    } finally {
      if (originalZero === undefined) Reflect.deleteProperty(Array.prototype, "0");
      else Object.defineProperty(Array.prototype, "0", originalZero);
    }

    expect(result).toBe(lease);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        lifecycle: "retired",
        rederivedEntryCount: graph.projectionIdentity.entryCount,
        rederivedProjectionSha256: graph.projectionIdentity.projectionSha256,
      });
    expect(assertTerminal(graph, lease)).toBe(lease);
  });

  it("uses captured accumulator methods after hostile prototype replacement", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const originalAppend = OperationBaselineAccumulator.prototype.append;
    const originalFinish = OperationBaselineAccumulator.prototype.finish;
    let result: SQLiteCursorPostDdlPublicationReaderLease | undefined;
    try {
      OperationBaselineAccumulator.prototype.append = function (): never {
        throw new Error("hostile OperationBaselineAccumulator.prototype.append replacement");
      };
      OperationBaselineAccumulator.prototype.finish = function (): never {
        throw new Error("hostile OperationBaselineAccumulator.prototype.finish replacement");
      };
      result = executeLease(graph, lease);
    } finally {
      OperationBaselineAccumulator.prototype.append = originalAppend;
      OperationBaselineAccumulator.prototype.finish = originalFinish;
    }

    expect(result).toBe(lease);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        closeAttemptCount: 1,
        closeSucceeded: true,
        lifecycle: "retired",
        rederivedEntryCount: graph.projectionIdentity.entryCount,
        rederivedProjectionSha256: graph.projectionIdentity.projectionSha256,
      });
    expect(assertTerminal(graph, lease)).toBe(lease);
  });

  it("does not expose retained canonical buffers through hostile Buffer.from replacement", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const bufferConstructor = Buffer as unknown as {
      from(value: unknown, ...arguments_: readonly unknown[]): Buffer;
    };
    const originalFrom = bufferConstructor.from;
    const capturedCanonicalSources: Uint8Array[] = [];
    let result: SQLiteCursorPostDdlPublicationReaderLease | undefined;
    try {
      bufferConstructor.from = function (
        value: unknown,
        ...arguments_: readonly unknown[]
      ): Buffer {
        if (value instanceof Uint8Array
            && new Error().stack?.includes("operation-baseline.ts")) {
          capturedCanonicalSources.push(value);
        }
        return Reflect.apply(originalFrom, Buffer, [value, ...arguments_]) as Buffer;
      };
      result = executeLease(graph, lease);
    } finally {
      bufferConstructor.from = originalFrom;
    }

    for (const captured of capturedCanonicalSources) captured.fill(0);
    expect(capturedCanonicalSources).toHaveLength(0);
    expect(result).toBe(lease);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        lifecycle: "retired",
        rederivedEntryCount: graph.projectionIdentity.entryCount,
        rederivedProjectionSha256: graph.projectionIdentity.projectionSha256,
      });
    expect(assertTerminal(graph, lease)).toBe(lease);
  });

  it("uses captured freeze for retained canonical entries and projection proof", () => {
    const graph = cleanGraph(2);
    const lease = mintLease(graph);
    const objectConstructor = Object as unknown as {
      freeze<T>(value: T): Readonly<T>;
    };
    const originalFreeze = objectConstructor.freeze;
    const capturedCanonicalObjects: object[] = [];
    let result: SQLiteCursorPostDdlPublicationReaderLease | undefined;
    try {
      objectConstructor.freeze = function <T>(value: T): Readonly<T> {
        if (value !== null && typeof value === "object"
            && Object.hasOwn(value, "baselineId")
            && (Object.hasOwn(value, "entryHash")
              || Object.hasOwn(value, "projectionSha256"))) {
          capturedCanonicalObjects.push(value);
        }
        return value as Readonly<T>;
      };
      result = executeLease(graph, lease);
    } finally {
      objectConstructor.freeze = originalFreeze;
    }

    for (const captured of capturedCanonicalObjects) {
      if (Array.isArray(captured)) captured.length = 0;
      else Reflect.set(captured, "projectionSha256", "0".repeat(64));
    }
    expect(capturedCanonicalObjects).toHaveLength(0);
    expect(result).toBe(lease);
    expect(readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(lease))
      .toMatchObject({
        lifecycle: "retired",
        rederivedEntryCount: graph.projectionIdentity.entryCount,
        rederivedProjectionSha256: graph.projectionIdentity.projectionSha256,
      });
    expect(assertTerminal(graph, lease)).toBe(lease);
  });

  it("keeps package-private lease authorities out of the package root", () => {
    expect("mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic" in sqliteRoot).toBe(false);
    expect("executeSQLiteCursorPostDdlPublicationReaderIntrinsic" in sqliteRoot).toBe(false);
    expect("assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic" in sqliteRoot)
      .toBe(false);
    expect("readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic" in sqliteRoot)
      .toBe(false);
  });
});
