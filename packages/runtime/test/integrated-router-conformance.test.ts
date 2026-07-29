import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type { GraphSpec } from "@graph-engineering/core";
import { runGraph } from "../src/index.js";

interface ExecutorCase {
  readonly return?: unknown;
  readonly throw?: string;
}

interface RuntimeCase {
  readonly name: string;
  readonly graphRef: string;
  readonly graphInput: unknown;
  readonly executors: Readonly<Record<string, ExecutorCase>>;
  readonly expect: {
    readonly status: string;
    readonly totalAttempts: number;
    readonly output?: unknown;
    readonly outputAbsent?: boolean;
    readonly graphFailureCodes: readonly string[];
    readonly executorCalls: Readonly<Record<string, number>>;
    readonly nodes: readonly unknown[];
  };
}

interface RouterRuntimeCorpus {
  readonly runtimeGraphs: Readonly<Record<string, GraphSpec>>;
  readonly runtimeCases: readonly RuntimeCase[];
}

const corpus = JSON.parse(readFileSync(
  new URL("../../../spec/conformance/integrated-router.case.json", import.meta.url),
  "utf8",
)) as RouterRuntimeCorpus;

describe("integrated router runtime conformance", () => {
  it.each(corpus.runtimeCases)("$name", async (fixture) => {
    const graph = corpus.runtimeGraphs[fixture.graphRef];
    expect(graph).toBeDefined();
    const calls = new Map<string, ReturnType<typeof vi.fn>>();
    const nodeExecutors = Object.fromEntries(Object.entries(fixture.executors).map(
      ([nodeId, behavior]) => {
        const executor = vi.fn(() => {
          if (behavior.throw !== undefined) throw new Error(behavior.throw);
          return behavior.return;
        });
        calls.set(nodeId, executor);
        return [nodeId, executor];
      },
    ));

    const result = await runGraph(graph as GraphSpec, fixture.graphInput, { nodeExecutors });
    expect(result.status).toBe(fixture.expect.status);
    expect(result.totalAttempts).toBe(fixture.expect.totalAttempts);
    expect(result.failures.map((failure) => failure.code))
      .toEqual(fixture.expect.graphFailureCodes);
    expect(result.nodes).toMatchObject(fixture.expect.nodes);
    if (fixture.expect.outputAbsent === true) expect(result.output).toBeUndefined();
    else expect(result.output).toEqual(fixture.expect.output);
    for (const [nodeId, expectedCalls] of Object.entries(fixture.expect.executorCalls)) {
      expect(calls.get(nodeId)).toHaveBeenCalledTimes(expectedCalls);
    }
  });
});
