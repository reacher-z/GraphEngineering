import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { DatabaseSync, StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  type SQLiteBaselineEntriesPublicationReceipt,
  type SQLiteCursorPostDdlPublicationReaderLease,
} from "../src/cursor-publication-outer-authority.js";
import * as initialWriteDigestModule from
  "../src/cursor-publication-initial-write-digest.js";
import {
  digestSQLiteInitialWriteParametersIntrinsic,
  digestSQLiteInitialWriteResultIntrinsic,
  encodeSQLiteInitialWriteParameterPayloadIntrinsic,
  type SQLiteInitialWriteParameterExecutions,
  type SQLiteInitialWriteTaggedScalar,
} from "../src/cursor-publication-initial-write-digest.js";
import {
  BASELINE_ENTRY_DOMAIN,
  BASELINE_ENTRY_KINDS,
  BASELINE_GENESIS_HASH,
  operationBaselineDomainHash,
} from "../src/operation-baseline.js";
import * as sqliteConnectionModule from "../src/sqlite-connection.js";
import {
  SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC,
  SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

interface TerminalReaderGraph extends ReaderLeaseTestGraph {
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
}

const graphs: TerminalReaderGraph[] = [];

function terminalGraph(legacyOperationCount = 1): TerminalReaderGraph {
  const graph = createReaderLeaseTestGraph(legacyOperationCount);
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
  const terminal = { ...graph, readerLease };
  graphs.push(terminal);
  return terminal;
}

function publish(graph: TerminalReaderGraph): SQLiteBaselineEntriesPublicationReceipt {
  return executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    graph.readerLease,
  );
}

function assertReceipt(
  graph: TerminalReaderGraph,
  receipt: SQLiteBaselineEntriesPublicationReceipt,
): SQLiteBaselineEntriesPublicationReceipt {
  return assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    graph.readerLease,
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
const blob = (value: Uint8Array): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "blob",
  value: Buffer.from(value).toString("base64url"),
});

function readPublishedRows(graph: TerminalReaderGraph): readonly (readonly unknown[])[] {
  return graph.connection.prepare(
    "SELECT baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, "
      + "previous_entry_hash, entry_hash "
      + "FROM main.ge_cycle_operation_baseline_entries ORDER BY ordinal ASC",
    "inspect-schema",
  ).all() as readonly (readonly unknown[])[];
}

function parameterFrame(
  rows: readonly (readonly unknown[])[],
): SQLiteInitialWriteParameterExecutions {
  return Object.freeze(rows.map((row) => Object.freeze([
    text(String(row[0])),
    integer(Number(row[1])),
    text(String(row[2])),
    blob(row[3] as Uint8Array),
    blob(row[4] as Uint8Array),
    text(String(row[5])),
    text(String(row[6])),
  ])));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite baseline-entry publication receipt", () => {
  it("publishes the frozen E=12 frame and commits exact receipt/ledger evidence", () => {
    const graph = terminalGraph(8);
    expect(graph.projectionIdentity.entryCount).toBe(12);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const authorityBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );

    const receipt = publish(graph);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.getPrototypeOf(receipt)).toBeNull();
    const snapshot = readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(receipt);
    expect(snapshot).toMatchObject({
      affectedRows: 12,
      authority: graph.authority,
      connection: graph.connection,
      executeCount: 12,
      fixedInsertSql: SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC,
      fixedInsertSqlSha256:
        SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
      migration0002Receipt: graph.migration0002Receipt,
      mintCount: 1,
      outerLedgerBefore: {
        affectedRowsWatermark: 9,
        fixedStatementCount: 20,
        logicalWriteSequence: 1,
      },
      outerLedgerAfter: {
        affectedRowsWatermark: 21,
        fixedStatementCount: 32,
        logicalWriteSequence: 2,
      },
      outerLedgerDelta: {
        affectedRowsWatermark: 12,
        fixedStatementCount: 12,
        logicalWriteSequence: 1,
      },
      postDdlCatalogFence: graph.fence,
      prepareCount: 1,
      projectionIdentity: graph.projectionIdentity,
      projectionReference: graph.projectionReference,
      readerLease: graph.readerLease,
      totalChangesBefore: totalBefore.totalChanges,
      totalChangesAfter: totalBefore.totalChanges + 12,
      totalChangesDelta: 12,
      transactionEpochBefore: ownerBefore.transactionEpoch,
      transactionEpochAfter: ownerBefore.transactionEpoch + 12n,
      transactionLineage: ownerBefore.transactionLineage,
      writeKind: "baseline-entries-publication",
    });
    expect(assertReceipt(graph, receipt)).toBe(receipt);
    expect(assertReceipt(graph, receipt)).toBe(receipt);

    const rows = readPublishedRows(graph);
    expect(rows).toHaveLength(12);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      expect(row).toHaveLength(7);
      expect(row[0]).toBe(graph.projectionIdentity.baselineId);
      expect(row[1]).toBe(BigInt(index));
      expect(BASELINE_ENTRY_KINDS).toContain(row[2]);
      expect(row[5]).toBe(index === 0 ? BASELINE_GENESIS_HASH : rows[index - 1]![6]);
      expect(row[6]).toBe(operationBaselineDomainHash(BASELINE_ENTRY_DOMAIN, {
        baselineId: row[0],
        entryKeySha256: createHash("sha256").update(row[3] as Uint8Array).digest("hex"),
        entryKind: row[2],
        entryStateSha256: createHash("sha256").update(row[4] as Uint8Array).digest("hex"),
        ordinal: index,
        previousEntryHash: row[5],
      }));
      if (index !== 0) {
        const previous = rows[index - 1]!;
        const previousRank = BASELINE_ENTRY_KINDS.indexOf(
          previous[2] as (typeof BASELINE_ENTRY_KINDS)[number],
        );
        const rank = BASELINE_ENTRY_KINDS.indexOf(
          row[2] as (typeof BASELINE_ENTRY_KINDS)[number],
        );
        expect(rank).toBeGreaterThanOrEqual(previousRank);
        if (rank === previousRank) {
          expect(Buffer.compare(row[3] as Buffer, previous[3] as Buffer)).toBeGreaterThan(0);
        }
      }
    }
    expect(rows[0]![6]).toBe(graph.projectionIdentity.firstEntryHash);
    expect(rows.at(-1)![6]).toBe(graph.projectionIdentity.finalEntryHash);
    const parameters = parameterFrame(rows);
    expect(parameters).toHaveLength(12);
    expect(parameters.every((execution) => execution.length === 7)).toBe(true);
    expect(JSON.parse(encodeSQLiteInitialWriteParameterPayloadIntrinsic(parameters)))
      .toHaveLength(12);
    expect(snapshot.parameterSha256).toBe(
      digestSQLiteInitialWriteParametersIntrinsic(parameters),
    );
    expect(snapshot.parameterSha256)
      .toBe("d3d449b8e0e0caa4d54b6d283aa765cb615a30a71a06f155eb9146c9d147a89f");
    expect(snapshot.resultSha256).toBe(
      digestSQLiteInitialWriteResultIntrinsic({ affectedRows: "12" }),
    );
    expect(snapshot.resultSha256)
      .toBe("2aab4754e5067476019ad2bb64cb9eb430de5481b643b739e574082aec63b06c");
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore.totalChanges + 12);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: receipt,
        baselineEntriesPublicationReceiptMintCount: 1,
        outerLedger: snapshot.outerLedgerAfter,
      });
    expect(authorityBefore.baselineEntriesPublicationReceipt).toBeUndefined();
  });

  it("freezes the exact INSERT SQL and SHA-256", () => {
    expect(SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC).toBe(
      "INSERT INTO main.ge_cycle_operation_baseline_entries "
        + "(baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, "
        + "previous_entry_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    expect(SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC)
      .toBe("b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b");
    expect(createHash("sha256")
      .update(SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC, "utf8")
      .digest("hex"))
      .toBe(SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC);
  });

  it("does not issue a second TEMP source SELECT after the terminal reader", () => {
    const graph = terminalGraph(8);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    let sourceReadCount = 0;
    vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourceReadCount += 1;
      return originalPrepare(connection, kind, operation);
    });

    publish(graph);
    expect(sourceReadCount).toBe(0);
  });

  it("passes one strict seven-scalar parameter frame per retained canonical row", () => {
    const graph = terminalGraph(8);
    const originalDigest =
      initialWriteDigestModule.digestSQLiteInitialWriteParametersIntrinsic;
    let captured: unknown;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteParametersIntrinsic",
    ).mockImplementation((parameters) => {
      captured = parameters;
      return originalDigest(parameters);
    });

    const receipt = publish(graph);
    expect(captured).toBeDefined();
    expect(Array.isArray(captured)).toBe(true);
    const executions = captured as readonly (readonly Record<string, unknown>[])[];
    expect(executions).toHaveLength(12);
    for (let ordinal = 0; ordinal < executions.length; ordinal += 1) {
      const execution = executions[ordinal]!;
      expect(Array.isArray(execution)).toBe(true);
      expect(execution).toHaveLength(7);
      expect(execution.map((scalar) => scalar.type))
        .toEqual(["text", "integer", "text", "blob", "blob", "text", "text"]);
      expect(execution[1]).toEqual({ type: "integer", value: `${ordinal}` });
      for (const scalar of execution) expect(Object.isFrozen(scalar)).toBe(true);
      expect(Object.isFrozen(execution)).toBe(true);
    }
    expect(Object.isFrozen(executions)).toBe(true);
    expect(readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(receipt).parameterSha256)
      .toBe(originalDigest(executions as SQLiteInitialWriteParameterExecutions));
  });

  it("records zero write progress when the one prepare fails", () => {
    const graph = terminalGraph(1);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const ledgerBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    ).outerLedger;
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced baseline-entry prepare failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionBaselineEntryPublicationExecutionIntrinsic",
    ).mockImplementation(() => {
      throw primary;
    });

    expect(() => publish(graph)).toThrow(primary);
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: ledgerBefore,
        writePhase: "poisoned",
      });
    expect(readPublishedRows(graph)).toHaveLength(0);
  });

  it("commits real partial progress through row k before row k+1 failure", () => {
    const graph = terminalGraph(8);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges;
    const originalExecute =
      sqliteConnectionModule.executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic;
    let execution: Parameters<typeof originalExecute>[1] | undefined;
    let calls = 0;
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced baseline-entry seventh execution failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic",
    ).mockImplementation((connection, candidate, row) => {
      execution = candidate;
      if (calls === 6) throw primary;
      calls += 1;
      return originalExecute(connection, candidate, row);
    });

    expect(() => publish(graph)).toThrow(primary);
    expect(calls).toBe(6);
    expect(execution).toBeDefined();
    expect(sqliteConnectionModule
      .readSQLiteConnectionBaselineEntryPublicationExecutionSnapshotIntrinsic(
        graph.connection,
        execution!,
      )).toMatchObject({
        affectedRows: 6,
        completedEntryCount: 6,
        executeCount: 6,
        expectedEntryCount: 12,
        nextEntryOrdinal: 6,
        prepareCount: 1,
        totalChanges: totalBefore + 6,
      });
    expect(readPublishedRows(graph)).toHaveLength(6);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore + 6);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 15,
          fixedStatementCount: 26,
          logicalWriteSequence: 1,
        },
        writePhase: "poisoned",
      });
  });

  it("rejects a per-row changes result other than one after preserving real progress", () => {
    const graph = terminalGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges;
    const originalExecute =
      sqliteConnectionModule.executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic;
    let replaced = false;
    vi.spyOn(
      sqliteConnectionModule,
      "executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic",
    ).mockImplementation((connection, execution, row) => {
      const step = originalExecute(connection, execution, row);
      if (!replaced) {
        replaced = true;
        return Object.freeze({ ...step, affectedRowsDelta: 0 }) as typeof step;
      }
      return step;
    });

    expectProviderError(
      () => publish(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /affected|changes|row|drift/u,
    );
    expect(readPublishedRows(graph)).toHaveLength(1);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore + 1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 3,
          fixedStatementCount: 21,
          logicalWriteSequence: 1,
        },
        writePhase: "poisoned",
      });
  });

  it("rejects post-write parameter framing digest drift before minting a receipt", () => {
    const graph = terminalGraph(8);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges;
    const originalDigest =
      initialWriteDigestModule.digestSQLiteInitialWriteParametersIntrinsic;
    let replaced = false;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteParametersIntrinsic",
    ).mockImplementation((parameters) => {
      if (!replaced) {
        replaced = true;
        return originalDigest([]);
      }
      return originalDigest(parameters);
    });

    expectProviderError(
      () => publish(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /digest|frame|parameter|receipt/u,
    );
    expect(readPublishedRows(graph)).toHaveLength(12);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore + 12);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 21,
          fixedStatementCount: 32,
          logicalWriteSequence: 1,
        },
        writePhase: "poisoned",
      });
  });

  it("rejects post-write aggregate result digest drift before minting a receipt", () => {
    const graph = terminalGraph(8);
    const originalDigest = initialWriteDigestModule.digestSQLiteInitialWriteResultIntrinsic;
    let replaced = false;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteResultIntrinsic",
    ).mockImplementation((result) => {
      if (!replaced) {
        replaced = true;
        return originalDigest({ affectedRows: "0" });
      }
      return originalDigest(result);
    });

    expectProviderError(
      () => publish(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /digest|result|receipt/u,
    );
    expect(readPublishedRows(graph)).toHaveLength(12);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 21,
          fixedStatementCount: 32,
          logicalWriteSequence: 1,
        },
        writePhase: "poisoned",
      });
  });

  it("never opens or closes the caller-owned transaction", () => {
    const graph = terminalGraph(1);
    const exec = vi.spyOn(graph.connection, "execTrusted");
    const receipt = publish(graph);
    expect(exec).not.toHaveBeenCalled();
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toMatchObject({
      isTransaction: true,
      transactionMode: "exclusive",
    });
    expect(assertReceipt(graph, receipt)).toBe(receipt);
  });

  it("uses captured native prepare/run after prototype replacement", () => {
    const graph = terminalGraph(1);
    const database = DatabaseSync.prototype as unknown as {
      prepare(sql: string): unknown;
    };
    const statement = StatementSync.prototype as unknown as {
      run(...parameters: readonly unknown[]): unknown;
    };
    const originalPrepare = database.prepare;
    const originalRun = statement.run;
    const originalCharCodeAt = String.prototype.charCodeAt;
    const originalStartsWith = String.prototype.startsWith;
    const originalSlice = String.prototype.slice;
    const originalBegin =
      sqliteConnectionModule.beginSQLiteConnectionBaselineEntryPublicationExecutionIntrinsic;
    const originalExecute =
      sqliteConnectionModule.executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic;
    let receipt: SQLiteBaselineEntriesPublicationReceipt | undefined;
    try {
      vi.spyOn(
        sqliteConnectionModule,
        "beginSQLiteConnectionBaselineEntryPublicationExecutionIntrinsic",
      ).mockImplementation((connection, expectedEntryCount) => {
        database.prepare = function (): never {
          throw new Error("hostile DatabaseSync.prototype.prepare replacement");
        };
        statement.run = function (): never {
          throw new Error("hostile StatementSync.prototype.run replacement");
        };
        String.prototype.charCodeAt = function (): never {
          throw new Error("hostile String.prototype.charCodeAt replacement");
        };
        String.prototype.startsWith = function (): never {
          throw new Error("hostile String.prototype.startsWith replacement");
        };
        String.prototype.slice = function (): never {
          throw new Error("hostile String.prototype.slice replacement");
        };
        return originalBegin(connection, expectedEntryCount);
      });
      vi.spyOn(
        sqliteConnectionModule,
        "executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic",
      ).mockImplementation((connection, execution, row) => {
        const step = originalExecute(connection, execution, row);
        if (step.completedEntryCount === graph.projectionIdentity.entryCount) {
          database.prepare = originalPrepare;
          statement.run = originalRun;
          String.prototype.charCodeAt = originalCharCodeAt;
          String.prototype.startsWith = originalStartsWith;
          String.prototype.slice = originalSlice;
        }
        return step;
      });
      receipt = publish(graph);
    } finally {
      database.prepare = originalPrepare;
      statement.run = originalRun;
      String.prototype.charCodeAt = originalCharCodeAt;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.slice = originalSlice;
    }
    expect(receipt).toBeDefined();
    expect(readPublishedRows(graph)).toHaveLength(graph.projectionIdentity.entryCount);
    expect(assertReceipt(graph, receipt!)).toBe(receipt);
  });

  it("uses captured Hash update/digest during publication and receipt assertion", () => {
    const graph = terminalGraph(1);
    const hashPrototype = Object.getPrototypeOf(createHash("sha256")) as {
      digest(...parameters: readonly unknown[]): unknown;
      update(...parameters: readonly unknown[]): unknown;
    };
    const originalUpdate = hashPrototype.update;
    const originalDigest = hashPrototype.digest;
    let hostileUpdateCalls = 0;
    let hostileDigestCalls = 0;
    let receipt: SQLiteBaselineEntriesPublicationReceipt | undefined;
    let asserted: SQLiteBaselineEntriesPublicationReceipt | undefined;
    try {
      hashPrototype.update = function (): never {
        hostileUpdateCalls += 1;
        throw new Error("hostile Hash.prototype.update replacement");
      };
      hashPrototype.digest = function (): never {
        hostileDigestCalls += 1;
        throw new Error("hostile Hash.prototype.digest replacement");
      };
      receipt = publish(graph);
      asserted = assertReceipt(graph, receipt);
    } finally {
      hashPrototype.update = originalUpdate;
      hashPrototype.digest = originalDigest;
    }

    expect(hostileUpdateCalls).toBe(0);
    expect(hostileDigestCalls).toBe(0);
    expect(receipt).toBeDefined();
    expect(asserted).toBe(receipt);
    expect(readPublishedRows(graph)).toHaveLength(graph.projectionIdentity.entryCount);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: receipt,
        baselineEntriesPublicationReceiptMintCount: 1,
        lifecycle: "active",
        writePhase: "baseline-entries-complete",
      });
  });

  it("rejects cloned, proxied, revoked, substituted, and cross-run receipts", () => {
    const graph = terminalGraph(1);
    const other = terminalGraph(1);
    const receipt = publish(graph);
    const otherReceipt = publish(other);
    const clone = Object.freeze({
      ...readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(receipt),
    });
    const revoked = Proxy.revocable(receipt, {});
    const invalid = [
      Object.freeze(Object.create(null)),
      clone,
      new Proxy(receipt, {}),
      revoked.proxy,
      otherReceipt,
    ] as readonly unknown[];
    revoked.revoke();

    for (const candidate of invalid) {
      expectProviderError(
        () => assertReceipt(
          graph,
          candidate as SQLiteBaselineEntriesPublicationReceipt,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /baseline|entries|receipt|graph|invalid/u,
      );
    }
    expect(assertReceipt(graph, receipt)).toBe(receipt);
    expect(assertReceipt(other, otherReceipt)).toBe(otherReceipt);
  });

  it("poisons a second publication call without executing another row", () => {
    const graph = terminalGraph(8);
    const receipt = publish(graph);
    const totalBeforeReplay = readSQLiteConnectionTotalChangesSnapshot(
      graph.connection,
    );

    expectProviderError(
      () => publish(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /baseline|entries|publication|reused|second/u,
    );
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection))
      .toEqual(totalBeforeReplay);
    expect(readPublishedRows(graph)).toHaveLength(12);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: receipt,
        baselineEntriesPublicationReceiptMintCount: 1,
        lifecycle: "poisoned",
        writePhase: "poisoned",
      });
  });

  it("rejects a wrong-run terminal lease before any permanent write", () => {
    const graph = terminalGraph(1);
    const other = terminalGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);

    expectProviderError(
      () => executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
        graph.authority,
        graph.migration0002Receipt,
        graph.fence,
        other.readerLease,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /baseline|entries|reader|lease|graph|invalid/u,
    );
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readPublishedRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "active",
      });
    expect(publish(graph)).toBeDefined();
  });

  it("rejects a wrong-run fence before any permanent write", () => {
    const graph = terminalGraph(1);
    const other = terminalGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);

    expectProviderError(
      () => executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
        graph.authority,
        graph.migration0002Receipt,
        other.fence,
        graph.readerLease,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /baseline|entries|fence|graph|invalid/u,
    );
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readPublishedRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "active", baselineEntriesPublicationReceiptMintCount: 0 });
  });

  it("rejects a reader whose required close failed and writes no baseline entry", () => {
    const base = createReaderLeaseTestGraph(1);
    const readerLease = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
      base.authority,
      base.migration0002Receipt,
      base.fence,
    );
    const graph = { ...base, readerLease };
    graphs.push(graph);
    const originalPrepare =
      sqliteConnectionModule.prepareSQLiteConnectionCursorPublicationReadIntrinsic;
    const originalReturn = sqliteConnectionModule.returnSQLiteStatementIteratorNativeIntrinsic;
    let sourcePrepared = false;
    const prepareSpy = vi.spyOn(
      sqliteConnectionModule,
      "prepareSQLiteConnectionCursorPublicationReadIntrinsic",
    ).mockImplementation((connection, kind, operation) => {
      if (kind === "cursor-publication-post-ddl-baseline-source") sourcePrepared = true;
      return originalPrepare(connection, kind, operation);
    });
    const returnSpy = vi.spyOn(
      sqliteConnectionModule,
      "returnSQLiteStatementIteratorNativeIntrinsic",
    ).mockImplementation((iterator) => {
      if (sourcePrepared) throw new Error("forced terminal-reader close failure");
      return originalReturn(iterator);
    });
    expect(() => executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
      graph.authority,
      graph.migration0002Receipt,
      graph.fence,
      graph.readerLease,
    )).toThrow();
    prepareSpy.mockRestore();
    returnSpy.mockRestore();

    expect(() => publish(graph)).toThrow();
    expect(readPublishedRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        writePhase: "poisoned",
      });
  });

  it("keeps stale lineage ahead of publication and mints no receipt", () => {
    const graph = terminalGraph(1);
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");

    expectProviderError(
      () => publish(graph),
      "GE_CYCLE_STORE_STALE_FENCE",
      /clock|lineage|retired|stale|transaction/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "retired",
      });
  });

  it("poisons unexplained watermark drift before publication prepare", () => {
    const graph = terminalGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges;
    graph.connection.prepare(
      "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1",
      "inspect-schema",
    ).run();

    expectProviderError(
      () => publish(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /clock|drift|ledger|watermark/u,
    );
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore + 1);
    expect(readPublishedRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineEntriesPublicationReceipt: undefined,
        baselineEntriesPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        writePhase: "poisoned",
      });
  });

  it("keeps package-private publication authorities out of the package root", () => {
    expect("executeSQLiteCursorBaselineEntriesPublicationIntrinsic" in sqliteRoot).toBe(false);
    expect("assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic" in sqliteRoot)
      .toBe(false);
    expect("readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic" in sqliteRoot)
      .toBe(false);
    expect("SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC" in sqliteRoot)
      .toBe(false);
  });
});
