import { afterEach, describe, expect, it, vi } from "vitest";

const nativeReadCounts = vi.hoisted(() => new Map<string, number>());

vi.mock("../src/sqlite-connection.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/sqlite-connection.js")>();
  return {
    ...original,
    prepareSQLiteConnectionCursorPublicationReadIntrinsic: (
      ...args: Parameters<typeof original.prepareSQLiteConnectionCursorPublicationReadIntrinsic>
    ): ReturnType<typeof original.prepareSQLiteConnectionCursorPublicationReadIntrinsic> => {
      const kind = args[1];
      nativeReadCounts.set(kind, (nativeReadCounts.get(kind) ?? 0) + 1);
      return original.prepareSQLiteConnectionCursorPublicationReadIntrinsic(...args);
    },
  };
});

import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  assertSQLiteCursorPublicationSessionIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  type SQLiteCursorInitialPublicationReceiptBundle,
} from "../src/cursor-publication-outer-authority.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  READER_CAPTURED_AT_MS,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const graphs: ReaderLeaseTestGraph[] = [];

afterEach(() => {
  nativeReadCounts.clear();
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite publication-session repeatable assertion query budget", () => {
  it("performs one live-lock read and one two-component target-catalog observation", () => {
    const graph = createReaderLeaseTestGraph(2, {
      outerProviderNowMs: READER_CAPTURED_AT_MS + 1_234,
    });
    graphs.push(graph);
    const reader = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
      graph.authority, graph.migration0002Receipt, graph.fence,
    );
    executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
      graph.authority, graph.migration0002Receipt, graph.fence, reader,
    );
    const entries = executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
      graph.authority, graph.migration0002Receipt, graph.fence, reader,
    );
    const header = executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
      graph.authority, graph.migration0002Receipt, graph.fence, reader, entries,
    );
    const sequence = executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
      graph.authority, graph.migration0002Receipt, graph.fence, reader, entries, header,
    );
    const bundle = Object.freeze([
      graph.migration0002Receipt, entries, header, sequence,
    ] as const satisfies SQLiteCursorInitialPublicationReceiptBundle);
    const adoption = adoptSQLiteCursorInitialPublicationStageIntrinsic(
      graph.authority, bundle, graph.fence, reader,
    );
    const prepared = prepareSQLiteCursorPublicationSessionIntrinsic(graph.authority, adoption);
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(prepared);
    const session = publishSQLiteCursorPublicationSessionIntrinsic(prepared, evidence);

    for (let repetition = 0; repetition < 2; repetition += 1) {
      nativeReadCounts.clear();
      expect(assertSQLiteCursorPublicationSessionIntrinsic(session)).toBe(session);
      expect(Object.fromEntries(nativeReadCounts)).toEqual({
        "cursor-publication-migration-lock": 1,
        "cursor-publication-target-catalog": 1,
        "cursor-publication-target-metadata": 1,
      });
    }
  });
});
