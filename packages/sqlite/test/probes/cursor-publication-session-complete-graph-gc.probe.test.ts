import { afterEach, describe, expect, it } from "vitest";

import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  type SQLiteCursorInitialPublicationReceiptBundle,
} from "../../src/cursor-publication-outer-authority.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  READER_CAPTURED_AT_MS,
  type ReaderLeaseTestGraph,
} from "../support/cursor-publication-clean-graph.js";

const trackedGraphs: ReaderLeaseTestGraph[] = [];

afterEach(() => {
  for (const graph of trackedGraphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

interface TrackedReferent {
  readonly label: string;
  readonly reference: WeakRef<object>;
}

function buildDisposeAndDropCompleteGraph(): Readonly<{
  finalized: Set<string>;
  referents: readonly TrackedReferent[];
  registry: FinalizationRegistry<string>;
}> {
  const graph = createReaderLeaseTestGraph(2, {
    outerProviderNowMs: READER_CAPTURED_AT_MS + 1_234,
  });
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
  const finalized = new Set<string>();
  const registry = new FinalizationRegistry<string>((label) => finalized.add(label));
  const values = [
    ["graph", graph],
    ["authority", graph.authority],
    ["prepared-owner", prepared],
    ["clock-evidence", evidence],
    ["publication-session", session],
    ["adoption-receipt", adoption],
    ["ownership-transfer", graph.transfer],
    ["temp-stage", graph.stage],
    ["connection", graph.connection],
  ] as const;
  const referents = values.map(([label, value]) => {
    registry.register(value, label);
    return { label, reference: new WeakRef(value) };
  });
  disposeReaderLeaseTestGraph(graph);
  return { finalized, referents, registry };
}

async function forceBoundedCollection(
  referents: readonly TrackedReferent[],
): Promise<readonly string[]> {
  for (let round = 0; round < 80; round += 1) {
    globalThis.gc!();
    const pressure = Array.from({ length: 8 }, () => new Uint8Array(2 * 1024 * 1024));
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

describe("SQLite publication-session complete graph GC probe", () => {
  if (process.env.GRAPH_ENGINEERING_RUN_EXPOSE_GC_PROBE !== "1") {
    it("is executed through the isolated --expose-gc harness", () => {
      expect(globalThis.gc).toBeUndefined();
    });
  } else {
    it("releases every complete-graph root after cleanup and bounded forced GC", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const tracked = buildDisposeAndDropCompleteGraph();
      const live = await forceBoundedCollection(tracked.referents);
      expect(live, [
        "complete publication graph retained strong roots after 80 GC rounds",
        `live=${live.join(",") || "none"}`,
        `finalized=${[...tracked.finalized].sort().join(",") || "none"}`,
      ].join("; ")).toEqual([]);
      expect(tracked.registry).toBeInstanceOf(FinalizationRegistry);
    }, 120_000);
  }
});
