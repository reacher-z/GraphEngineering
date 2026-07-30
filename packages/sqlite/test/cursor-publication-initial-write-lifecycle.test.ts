import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic,
  assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic,
  assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic,
  assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic,
  readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic,
  type SQLiteBaselineEntriesPublicationReceipt,
  type SQLiteBaselineHeaderPublicationReceipt,
  type SQLiteCursorPostDdlPublicationReaderLease,
  type SQLiteOperationSequenceZeroPublicationReceipt,
} from "../src/cursor-publication-outer-authority.js";
import {
  READER_CAPTURED_AT_MS,
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const SEQUENCE_UPDATED_AT_MS = READER_CAPTURED_AT_MS + 1_234;

interface PublishedGraph extends ReaderLeaseTestGraph {
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly entriesReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly headerReceipt: SQLiteBaselineHeaderPublicationReceipt;
  readonly sequenceReceipt: SQLiteOperationSequenceZeroPublicationReceipt;
}

const graphs: PublishedGraph[] = [];

function publishedGraph(): PublishedGraph {
  const graph = createReaderLeaseTestGraph(1, {
    outerProviderNowMs: SEQUENCE_UPDATED_AT_MS,
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
  const sequenceReceipt = executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    readerLease,
    entriesReceipt,
    headerReceipt,
  );
  const complete = {
    ...graph,
    entriesReceipt,
    headerReceipt,
    readerLease,
    sequenceReceipt,
  };
  graphs.push(complete);
  return complete;
}

/** The exact four reusable initial-write proofs a stage adoption would replay. */
function fourProofs(graph: PublishedGraph): readonly (readonly [string, () => unknown])[] {
  return [
    ["reader lease terminal proof", () =>
      assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic(
        graph.authority, graph.migration0002Receipt, graph.fence, graph.readerLease,
      )],
    ["baseline entries receipt", () =>
      assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic(
        graph.authority, graph.migration0002Receipt, graph.fence, graph.readerLease,
        graph.entriesReceipt,
      )],
    ["baseline header receipt", () =>
      assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
        graph.authority, graph.migration0002Receipt, graph.fence, graph.readerLease,
        graph.entriesReceipt, graph.headerReceipt,
      )],
    ["operation-sequence-zero receipt", () =>
      assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic(
        graph.authority, graph.migration0002Receipt, graph.fence, graph.readerLease,
        graph.entriesReceipt, graph.headerReceipt, graph.sequenceReceipt,
      )],
  ];
}

/** The snapshot readers that delegate to those proofs. */
function threeSnapshots(
  graph: PublishedGraph,
): readonly (readonly [string, () => unknown])[] {
  return [
    ["baseline entries snapshot", () =>
      readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(graph.entriesReceipt)],
    ["baseline header snapshot", () =>
      readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(graph.headerReceipt)],
    ["operation-sequence-zero snapshot", () =>
      readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(
        graph.sequenceReceipt,
      )],
  ];
}

function expectProviderError(
  label: string,
  callback: () => unknown,
  code: string,
  message: RegExp,
): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error, label).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code, label).toBe(code);
    expect((error as Error).message, label).toMatch(message);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code} from ${label}`);
}

afterEach(() => {
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite initial-write receipt proofs observe the authority lifecycle", () => {
  it("proves all four initial-write receipts while the authority is still active", () => {
    const graph = publishedGraph();

    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "active",
        stageOwnershipPoisonReason: undefined,
        writePhase: "sequence-zero-complete",
      });
    expect(fourProofs(graph).map(([, proof]) => proof())).toEqual([
      graph.readerLease,
      graph.entriesReceipt,
      graph.headerReceipt,
      graph.sequenceReceipt,
    ]);
    for (const [label, read] of threeSnapshots(graph)) {
      expect(read(), label).toBeDefined();
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "sequence-zero-complete" });
  });

  it("refuses every initial-write receipt proof once the authority is poisoned", () => {
    const graph = publishedGraph();
    // Poison through an unrelated route: replaying the header write is refused
    // by its own reuse gate and poisons the shared authority graph.
    expectProviderError(
      "header replay",
      () => executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
        graph.authority,
        graph.migration0002Receipt,
        graph.fence,
        graph.readerLease,
        graph.entriesReceipt,
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite baseline-header publication was reused$/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        stageOwnershipPoisonReason: "SQLite baseline-header publication was reused",
        writePhase: "poisoned",
      });

    for (const [label, proof] of fourProofs(graph)) {
      expectProviderError(
        label,
        proof,
        "GE_CYCLE_STORE_CORRUPTION",
        /^SQLite outer publication authority is poisoned$/u,
      );
    }
    for (const [label, read] of threeSnapshots(graph)) {
      expectProviderError(
        label,
        read,
        "GE_CYCLE_STORE_CORRUPTION",
        /^SQLite outer publication authority is poisoned$/u,
      );
    }
  });

  it("refuses every initial-write receipt proof once the authority is retired", () => {
    const graph = publishedGraph();
    // Retire through an unrelated route: replacing the owner transaction
    // generation makes the retained lineage stale, which retires rather than
    // poisons the authority graph.
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    expectProviderError(
      "stale lineage",
      () => assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
        graph.authority, graph.migration0002Receipt, graph.fence, graph.readerLease,
        graph.entriesReceipt, graph.headerReceipt,
      ),
      "GE_CYCLE_STORE_STALE_FENCE",
      /^SQLite baseline-header publication transaction lineage is stale$/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "retired",
        stageOwnershipPoisonReason: undefined,
        writePhase: "retired",
      });

    for (const [label, proof] of fourProofs(graph)) {
      expectProviderError(
        label,
        proof,
        "GE_CYCLE_STORE_STALE_FENCE",
        /^SQLite outer publication authority is retired$/u,
      );
    }
    for (const [label, read] of threeSnapshots(graph)) {
      expectProviderError(
        label,
        read,
        "GE_CYCLE_STORE_STALE_FENCE",
        /^SQLite outer publication authority is retired$/u,
      );
    }
  });
});
