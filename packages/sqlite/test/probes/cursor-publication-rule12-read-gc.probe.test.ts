import { describe, expect, it } from "vitest";

import {
  beginSQLiteConnectionPostRebindSealReadIntrinsic,
  executeSQLiteConnectionPostRebindSealReadIntrinsic,
  releaseSQLiteConnectionPostRebindSealReadIntrinsic,
} from "../../src/cursor-publication-rule12-read.js";
import {
  beginSQLiteConnectionCursorRebindExecutionIntrinsic,
  executeSQLiteConnectionCursorRebindIntrinsic,
} from "../../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
} from "../support/cursor-publication-clean-graph.js";

const SOURCE_DESCRIPTOR = "1".repeat(64);
const SOURCE_SCHEMA = "2".repeat(64);
const TARGET_DESCRIPTOR = "3".repeat(64);
const TARGET_SCHEMA = "4".repeat(64);

interface TrackedReferent {
  readonly label: string;
  readonly reference: WeakRef<object>;
}

function completedRebind(connection: Parameters<
  typeof beginSQLiteConnectionCursorRebindExecutionIntrinsic
>[0]) {
  const rebind = beginSQLiteConnectionCursorRebindExecutionIntrinsic(connection);
  executeSQLiteConnectionCursorRebindIntrinsic(connection, rebind, Object.freeze({
    targetDescriptorHash: TARGET_DESCRIPTOR,
    targetSchemaIdentitySha256: TARGET_SCHEMA,
    sourceDescriptorHash: SOURCE_DESCRIPTOR,
    sourceSchemaIdentitySha256: SOURCE_SCHEMA,
  }));
  return rebind;
}

function buildCompletedAndReleasedDropDisposeGraphs(): Readonly<{
  readonly finalized: Set<string>;
  readonly referents: readonly TrackedReferent[];
  readonly registry: FinalizationRegistry<string>;
}> {
  const completedGraph = createReaderLeaseTestGraph(1);
  const completedRebindExecution = completedRebind(completedGraph.connection);
  const completedSealExecution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
    completedGraph.connection, completedRebindExecution,
  );
  executeSQLiteConnectionPostRebindSealReadIntrinsic(
    completedGraph.connection, completedSealExecution,
  );

  const releasedGraph = createReaderLeaseTestGraph(1);
  const releasedRebindExecution = completedRebind(releasedGraph.connection);
  const releasedSealExecution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
    releasedGraph.connection, releasedRebindExecution,
  );
  releaseSQLiteConnectionPostRebindSealReadIntrinsic(
    releasedGraph.connection, releasedSealExecution,
  );

  const finalized = new Set<string>();
  const registry = new FinalizationRegistry<string>((label) => finalized.add(label));
  const values = [
    ["completed-seal-execution", completedSealExecution],
    ["completed-rebind-execution", completedRebindExecution],
    ["completed-connection", completedGraph.connection],
    ["released-seal-execution", releasedSealExecution],
    ["released-rebind-execution", releasedRebindExecution],
    ["released-connection", releasedGraph.connection],
  ] as const;
  const referents = values.map(([label, value]) => {
    registry.register(value, label);
    return { label, reference: new WeakRef(value) };
  });
  disposeReaderLeaseTestGraph(completedGraph);
  disposeReaderLeaseTestGraph(releasedGraph);
  return { finalized, referents, registry };
}

async function forceBoundedCollection(
  referents: readonly TrackedReferent[],
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

describe("SQLite post-rebind seal completed-and-released owner GC probe", () => {
  if (process.env.GRAPH_ENGINEERING_RUN_RULE12_GC_PROBE !== "1") {
    it.skip("is executed through the isolated --expose-gc harness", () => {});
  } else {
    it("collects both owner graphs after terminal transition, drop and graph disposal", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const tracked = buildCompletedAndReleasedDropDisposeGraphs();
      const live = await forceBoundedCollection(tracked.referents);
      expect(live, [
        "post-rebind completed/released seal graphs retained roots after 80 GC rounds",
        `live=${live.join(",") || "none"}`,
        `finalized=${[...tracked.finalized].sort().join(",") || "none"}`,
      ].join("; ")).toEqual([]);
      expect(tracked.registry).toBeInstanceOf(FinalizationRegistry);
    }, 120_000);
  }
});
