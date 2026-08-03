import { describe, expect, it } from "vitest";

import { observeSQLiteCursorBeforeVerificationClockIntrinsic } from
  "../../src/cursor-publication-clock-authority.js";
import { executeSQLiteCursorPublicationRebindRule11Intrinsic } from
  "../../src/cursor-publication-rebind.js";
import { executeSQLiteCursorPublicationRule12Intrinsic } from
  "../../src/cursor-publication-rule12.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  publishReaderLeaseTestGraphSession,
} from "../support/cursor-publication-clean-graph.js";

interface TrackedReferent {
  readonly label: string;
  readonly reference: WeakRef<object>;
}

function buildAndDrop(): Readonly<{
  readonly finalized: Set<string>;
  readonly referents: readonly TrackedReferent[];
  readonly registry: FinalizationRegistry<string>;
}> {
  const graph = createReaderLeaseTestGraph(1, { cursorCount: 1 });
  const session = publishReaderLeaseTestGraphSession(graph);
  const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
  const rule12 = executeSQLiteCursorPublicationRule12Intrinsic(rule11);
  const third = observeSQLiteCursorBeforeVerificationClockIntrinsic(rule12);
  const finalized = new Set<string>();
  const registry = new FinalizationRegistry<string>((label) => finalized.add(label));
  const values = [
    ["graph", graph],
    ["authority", graph.authority],
    ["connection", graph.connection],
    ["session", session],
    ["rule11", rule11],
    ["rule12", rule12],
    ["third", third],
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

describe("SQLite Rule 12 plus unconsumed third-clock GC probe", () => {
  if (process.env.GRAPH_ENGINEERING_RUN_RULE12_CLOCK_GC_PROBE !== "1") {
    it.skip("is executed through the isolated --expose-gc harness", () => {});
  } else {
    it("collects the complete P10 graph after explicit disposal and dropped roots", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const tracked = buildAndDrop();
      const live = await forceBoundedCollection(tracked.referents);
      expect(live, [
        "Rule 12/third graph retained roots after 80 GC rounds",
        `live=${live.join(",") || "none"}`,
        `finalized=${[...tracked.finalized].sort().join(",") || "none"}`,
      ].join("; ")).toEqual([]);
      expect(tracked.registry).toBeInstanceOf(FinalizationRegistry);
    }, 120_000);
  }
});
