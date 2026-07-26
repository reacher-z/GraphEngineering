import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GraphSpec, NodeSpec } from "@graph-engineering/core";
import { describe, expect, it, vi } from "vitest";
import { runGraph, type NodeExecutor } from "../src/index.js";

function fixture(name: string): GraphSpec {
  const path = fileURLToPath(new URL(`../../../spec/conformance/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as GraphSpec;
}

interface ReadyQueueCase {
  graph: GraphSpec;
  mock: {
    graphInput: unknown;
    delaysMs: Record<string, number>;
    returns: Record<string, unknown>;
  };
  expect: {
    status: "succeeded";
    maxObservedConcurrency: number;
    mustCompleteBefore: [string, string][];
    inputs: Record<string, unknown>;
    outputs: Record<string, unknown>;
  };
}

interface InvalidOutputCase {
  graph: GraphSpec;
  graphInput: unknown;
  mock: {
    producerOutput: "non-finite-number";
    independentOutput: unknown;
  };
  expect: {
    status: "failed";
    totalAttempts: number;
    nodes: {
      nodeId: string;
      sequence: number;
      status: "succeeded" | "failed" | "skipped";
      attempts: number;
      failureCode?: string;
    }[];
  };
}

function readyQueueCase(): ReadyQueueCase {
  const path = fileURLToPath(
    new URL("../../../spec/conformance/runtime-ready-queue.case.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as ReadyQueueCase;
}

function invalidOutputCase(): InvalidOutputCase {
  const path = fileURLToPath(
    new URL("./fixtures/invalid-output-isolation.case.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as InvalidOutputCase;
}

function cyclicValue(): Record<string, unknown> {
  const value: Record<string, unknown> = {};
  value.self = value;
  return value;
}

class NonJsonValue {
  readonly value = 1;
}

function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return { id, kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, ...overrides };
}

function graph(overrides: Partial<GraphSpec>): GraphSpec {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "runtime-test", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: { result: { node: "root" } },
    nodes: [node("root")],
    edges: [],
    ...overrides,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("runGraph", () => {
  it("executes a diamond concurrently and binds fan-in ports", async () => {
    let activeBranches = 0;
    let maximumBranches = 0;
    const branch = (increment: number, milliseconds: number): NodeExecutor => async ({ input }) => {
      activeBranches += 1;
      maximumBranches = Math.max(maximumBranches, activeBranches);
      await wait(milliseconds);
      activeBranches -= 1;
      return { value: (input as { split: { value: number } }).split.value + increment };
    };

    const result = await runGraph(fixture("diamond.graph.json"), { seed: 2 }, {
      nodeExecutors: {
        split: ({ input }) => ({ value: (input as { seed: number }).seed }),
        left: branch(10, 20),
        right: branch(20, 5),
        merge: ({ input }) => {
          const values = input as { left: { value: number }; right: { value: number } };
          return { sum: values.left.value + values.right.value };
        },
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ result: { sum: 34 } });
    expect(result.nodes.map(({ nodeId, status }) => [nodeId, status])).toEqual([
      ["split", "succeeded"],
      ["left", "succeeded"],
      ["right", "succeeded"],
      ["merge", "succeeded"],
    ]);
    expect(maximumBranches).toBe(2);
    expect(result.maxObservedConcurrency).toBe(2);
    expect(result.totalAttempts).toBe(4);
  });

  it("passes the shared ready-queue conformance case without a layer barrier", async () => {
    const testCase = readyQueueCase();
    const completed: string[] = [];
    const inputs: Record<string, unknown> = {};
    const nodeExecutors = Object.fromEntries(
      testCase.graph.nodes.map((current) => [
        current.id,
        async ({ input }: { input: unknown }) => {
          inputs[current.id] = input;
          await wait(testCase.mock.delaysMs[current.id] ?? 0);
          completed.push(current.id);
          return testCase.mock.returns[current.id];
        },
      ]),
    );

    const result = await runGraph(testCase.graph, testCase.mock.graphInput, { nodeExecutors });

    expect(result.status).toBe(testCase.expect.status);
    expect(result.maxObservedConcurrency).toBe(testCase.expect.maxObservedConcurrency);
    expect(result.output).toEqual(testCase.expect.outputs);
    expect(inputs).toEqual(testCase.expect.inputs);
    for (const [first, second] of testCase.expect.mustCompleteBefore) {
      expect(completed.indexOf(first), `${first} should finish before ${second}`).toBeLessThan(
        completed.indexOf(second),
      );
    }
  });

  it("never exceeds the graph concurrency policy", async () => {
    let active = 0;
    let maximum = 0;
    const tracked: NodeExecutor = async ({ node: current }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await wait(current.id === "a" ? 15 : 5);
      active -= 1;
      return current.id;
    };
    const fanout = graph({
      entrypoints: ["root"],
      outputs: { a: { node: "a" }, b: { node: "b" }, c: { node: "c" } },
      nodes: [node("root"), node("a"), node("b"), node("c")],
      edges: ["a", "b", "c"].map((id) => ({
        id: `root-${id}`,
        from: { node: "root" },
        to: { node: id },
      })),
      policies: { maxConcurrency: 2 },
    });

    const result = await runGraph(fanout, {}, {
      concurrency: 99,
      nodeExecutors: { root: tracked, a: tracked, b: tracked, c: tracked },
    });
    expect(result.status).toBe("succeeded");
    expect(maximum).toBe(2);
    expect(result.maxObservedConcurrency).toBe(2);
  });

  it("contains failure to descendants while independent work succeeds", async () => {
    const independent = vi.fn(() => "still-ran");
    const result = await runGraph(
      graph({
        entrypoints: ["bad", "independent"],
        outputs: { dependent: { node: "dependent" }, independent: { node: "independent" } },
        nodes: [node("bad"), node("dependent"), node("independent")],
        edges: [{ id: "bad-dependent", from: { node: "bad" }, to: { node: "dependent" } }],
      }),
      {},
      {
        nodeExecutors: {
          bad: () => {
            throw new Error("boom");
          },
          dependent: vi.fn(),
          independent,
        },
      },
    );

    expect(result.status).toBe("failed");
    expect(independent).toHaveBeenCalledOnce();
    expect(result.nodes.find(({ nodeId }) => nodeId === "bad")?.failure).toMatchObject({
      code: "NODE_EXECUTION_FAILED",
      message: expect.stringContaining("boom"),
    });
    expect(result.nodes.find(({ nodeId }) => nodeId === "dependent")?.failure).toMatchObject({
      code: "UPSTREAM_FAILED",
      upstreamNodeIds: ["bad"],
    });
  });

  it("returns compiler diagnostics without invoking executors", async () => {
    const executor = vi.fn();
    const result = await runGraph(fixture("invalid-cycle.graph.json"), {}, {
      executors: { transform: executor },
    });
    expect(result.status).toBe("failed");
    expect(result.nodes).toEqual([]);
    expect(result.failures).toEqual([
      expect.objectContaining({ phase: "compile", code: "GE1005_CYCLE" }),
    ]);
    expect(executor).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", () => undefined],
    ["bigint", () => 1n],
    ["NaN", () => Number.NaN],
    ["Infinity", () => Number.POSITIVE_INFINITY],
    ["unsafe integer", () => Number.MAX_SAFE_INTEGER + 1],
    ["cycle", cyclicValue],
    ["class instance", () => new NonJsonValue()],
  ])("rejects non-JSON graph input (%s) before scheduling", async (_name, value) => {
    const executor = vi.fn();
    await expect(
      runGraph(graph({}), value(), { nodeExecutors: { root: executor } }),
    ).rejects.toThrowError(new TypeError("graph input must be a portable finite JSON value"));
    expect(executor).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", () => undefined],
    ["bigint", () => 1n],
    ["NaN", () => Number.NaN],
    ["unsafe integer", () => Number.MAX_SAFE_INTEGER + 1],
    ["cycle", cyclicValue],
    ["class instance", () => new NonJsonValue()],
  ])("contains invalid executor output (%s) and skips only descendants", async (_name, value) => {
    const dependent = vi.fn();
    const independent = vi.fn(() => ({ ok: true }));
    const result = await runGraph(
      graph({
        entrypoints: ["producer", "independent"],
        outputs: { dependent: { node: "dependent" }, independent: { node: "independent" } },
        nodes: [
          node("producer", { kind: "agent" }),
          node("dependent"),
          node("independent", { kind: "agent" }),
        ],
        edges: [{ id: "producer-dependent", from: { node: "producer" }, to: { node: "dependent" } }],
      }),
      {},
      {
        nodeExecutors: {
          producer: value,
          dependent,
          independent,
        },
      },
    );

    expect(result.status).toBe("failed");
    expect(result.nodes.find(({ nodeId }) => nodeId === "producer")).toMatchObject({
      status: "failed",
      attempts: 1,
      failure: { code: "INVALID_OUTPUT", retryable: false, causeName: "InvalidOutputError" },
    });
    expect(result.nodes.find(({ nodeId }) => nodeId === "dependent")).toMatchObject({
      status: "skipped",
      attempts: 0,
      failure: { code: "UPSTREAM_FAILED" },
    });
    expect(result.nodes.find(({ nodeId }) => nodeId === "independent")).toMatchObject({
      status: "succeeded",
      output: { ok: true },
    });
    expect(dependent).not.toHaveBeenCalled();
    expect(independent).toHaveBeenCalledOnce();
  });

  it("accepts finite non-integer doubles at the portable JSON boundary", async () => {
    const result = await runGraph(graph({}), { ratio: 1.25 }, {
      nodeExecutors: { root: ({ input }) => ({ input, score: -0.125 }) },
    });
    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ result: { input: { ratio: 1.25 }, score: -0.125 } });
  });

  it("detaches and freezes graph input and successful outputs", async () => {
    const graphInput = { seed: 1 };
    const produced = { value: 2 };
    const resultPromise = runGraph(
      graph({
        outputs: { result: { node: "consumer" } },
        nodes: [node("root", { kind: "agent" }), node("consumer", { kind: "agent" })],
        edges: [{ id: "root-consumer", from: { node: "root" }, to: { node: "consumer" } }],
      }),
      graphInput,
      {
        nodeExecutors: {
          root: async ({ input }) => {
            expect(Object.isFrozen(input)).toBe(true);
            expect(input).toEqual({ seed: 1 });
            await wait(5);
            return produced;
          },
          consumer: ({ input }) => {
            expect(Object.isFrozen(input)).toBe(true);
            expect(Object.isFrozen((input as { root: object }).root)).toBe(true);
            return input;
          },
        },
      },
    );
    graphInput.seed = 99;
    const result = await resultPromise;
    produced.value = 99;
    expect(result.output).toEqual({ result: { root: { value: 2 } } });
    expect(result.nodes.find(({ nodeId }) => nodeId === "root")?.output).toEqual({ value: 2 });
  });

  it("passes the package-local deterministic invalid-output isolation fixture", async () => {
    const testCase = invalidOutputCase();
    const result = await runGraph(testCase.graph, testCase.graphInput, {
      nodeExecutors: {
        producer: () => testCase.mock.producerOutput === "non-finite-number" ? Number.NaN : null,
        independent: () => testCase.mock.independentOutput,
      },
    });
    expect(result.status).toBe(testCase.expect.status);
    expect(result.totalAttempts).toBe(testCase.expect.totalAttempts);
    expect(
      result.nodes.map((item) => ({
        nodeId: item.nodeId,
        sequence: item.sequence,
        status: item.status,
        attempts: item.attempts,
        ...(item.failure === undefined ? {} : { failureCode: item.failure.code }),
      })),
    ).toEqual(testCase.expect.nodes);
  });

  it("reports a missing executor as structured data", async () => {
    const result = await runGraph(
      graph({ nodes: [node("root", { kind: "agent" })] }),
      {},
    );
    expect(result.status).toBe("failed");
    expect(result.failures).toEqual([
      expect.objectContaining({ code: "EXECUTOR_NOT_FOUND", nodeId: "root", attempt: 0 }),
    ]);
  });

  it("retries within node and global attempt budgets", async () => {
    let calls = 0;
    const result = await runGraph(
      graph({
        nodes: [node("root", { retry: { maxAttempts: 3 } })],
        policies: { maxTotalAttempts: 3 },
      }),
      {},
      {
        nodeExecutors: {
          root: () => {
            calls += 1;
            if (calls < 3) throw new Error("transient");
            return "ok";
          },
        },
      },
    );
    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ result: "ok" });
    expect(result.nodes[0]).toMatchObject({ attempts: 3, status: "succeeded" });
  });

  it("does not hold an attempt concurrency slot during retry backoff", async () => {
    const completed: string[] = [];
    let retryCalls = 0;
    const result = await runGraph(
      graph({
        entrypoints: ["retrying", "peer"],
        outputs: { retrying: { node: "retrying" }, peer: { node: "peer" } },
        nodes: [
          node("retrying", { retry: { maxAttempts: 2, initialDelayMs: 25, maxDelayMs: 25 } }),
          node("peer"),
        ],
        policies: { maxConcurrency: 1, maxTotalAttempts: 3 },
      }),
      {},
      {
        nodeExecutors: {
          retrying: () => {
            retryCalls += 1;
            if (retryCalls === 1) throw new Error("retry me");
            completed.push("retrying");
            return "retried";
          },
          peer: () => {
            completed.push("peer");
            return "peer";
          },
        },
      },
    );
    expect(result.status).toBe("succeeded");
    expect(completed).toEqual(["peer", "retrying"]);
    expect(result.maxObservedConcurrency).toBe(1);
  });

  it("times out a node with a structured failure", async () => {
    const result = await runGraph(
      graph({ nodes: [node("root", { timeoutMs: 5 })] }),
      {},
      { nodeExecutors: { root: async () => wait(30) } },
    );
    expect(result.status).toBe("failed");
    expect(result.failures).toEqual([
      expect.objectContaining({ code: "NODE_TIMEOUT", nodeId: "root", attempt: 1 }),
    ]);
  });

  it("selects source ports and named output ports", async () => {
    const result = await runGraph(
      graph({
        outputs: { answer: { node: "consumer", port: "answer" } },
        nodes: [node("root"), node("consumer")],
        edges: [{ id: "value", from: { node: "root", port: "value" }, to: { node: "consumer" } }],
      }),
      {},
      {
        nodeExecutors: {
          root: () => ({ value: 41, ignored: true }),
          consumer: ({ input }) => ({ answer: (input as { root: number }).root + 1 }),
        },
      },
    );
    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ answer: 42 });
  });

  it("reports a missing named output port as a structured failure", async () => {
    const result = await runGraph(
      graph({ outputs: { answer: { node: "root", port: "missing" } } }),
      {},
      { nodeExecutors: { root: () => ({ present: 1 }) } },
    );
    expect(result.status).toBe("failed");
    expect(result.failures).toEqual([
      expect.objectContaining({
        phase: "output",
        code: "OUTPUT_BINDING_FAILED",
        outputName: "answer",
        nodeId: "root",
        port: "missing",
      }),
    ]);
  });

  it("reports input-key collisions instead of overwriting an edge", async () => {
    const result = await runGraph(
      graph({
        outputs: { result: { node: "consumer" } },
        nodes: [node("root"), node("consumer")],
        edges: [
          { id: "first", from: { node: "root" }, to: { node: "consumer" } },
          { id: "second", from: { node: "root" }, to: { node: "consumer" } },
        ],
      }),
      {},
      { nodeExecutors: { root: () => "value", consumer: vi.fn() } },
    );
    expect(result.status).toBe("failed");
    expect(result.failures).toEqual([
      expect.objectContaining({ code: "INPUT_BINDING_FAILED", nodeId: "consumer", attempt: 0 }),
    ]);
  });

  it("distinguishes cancellation from execution failure", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const result = await runGraph(graph({}), {}, { signal: controller.signal });
    expect(result.status).toBe("cancelled");
    expect(result.failures).toEqual([
      expect.objectContaining({ code: "NODE_CANCELLED", nodeId: "root" }),
    ]);
    expect(result.totalAttempts).toBe(0);
  });
});
