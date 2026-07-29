import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GraphSpec, NodeSpec } from "@graph-engineering/core";
import { describe, expect, it, vi } from "vitest";
import { runGraph, type NodeExecutor } from "../src/index.js";
import {
  runGraphWithJournal,
  type SchedulerJournal,
} from "../src/scheduler.js";
import {
  projectedRuntimeCapabilityFailures,
  runtimeCapabilityCorpus,
} from "./runtime-capability-fixtures.js";

function fixture(name: string): GraphSpec {
  const path = fileURLToPath(new URL(`../../../spec/conformance/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as GraphSpec;
}

function registeredLoopConditionGraph(): GraphSpec {
  const corpus = JSON.parse(readFileSync(
    fileURLToPath(new URL("../../../spec/conformance/integrated-router.case.json", import.meta.url)),
    "utf8",
  )) as { compilerCases: Array<{ name: string; graph: GraphSpec }> };
  const fixture = corpus.compilerCases.find(
    (item) => item.name === "registered-loop-condition-families-remain-compiler-valid",
  );
  if (fixture === undefined) throw new Error("registered loop condition fixture is missing");
  return fixture.graph;
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

function testJournal(overrides: Partial<SchedulerJournal> = {}): SchedulerJournal {
  return {
    beforeAttempt: async ({ node, attempt }) => ({
      runId: "test-run",
      attemptId: `test-run/${node.id}/${attempt}`,
      activityKey: `activity/${node.id}`,
    }),
    attemptFailed: async () => undefined,
    nodeSucceeded: async () => undefined,
    nodeSettledWithoutAttempt: async () => undefined,
    runTerminal: async () => undefined,
    ...overrides,
  };
}

describe("runGraph", () => {
  it("consumes the runtime-capability corpus literally with stable failures and zero side effects", async () => {
    const corpus = runtimeCapabilityCorpus();
    expect(corpus.contract).toBe("runtime-capability/v1alpha1");

    for (const testCase of corpus.cases) {
      const executor = vi.fn(({ input }) => input);
      const journal = testJournal({
        beforeAttempt: vi.fn(),
        attemptFailed: vi.fn(),
        nodeSucceeded: vi.fn(),
        nodeSettledWithoutAttempt: vi.fn(),
        runTerminal: vi.fn(),
      });
      const nodeExecutors = Object.fromEntries(
        testCase.graph.nodes
          .filter((current) => current.kind !== "barrier")
          .map((current) => [current.id, executor]),
      );
      const result = await runGraphWithJournal(
        testCase.graph,
        {},
        { nodeExecutors, journal },
      );

      if (testCase.expect.supported) {
        expect(result.status, `${testCase.name}: ${JSON.stringify(result)}`).toBe("succeeded");
        expect(result.failures, testCase.name).toEqual([]);
        expect(executor, testCase.name).toHaveBeenCalledTimes(1);
        continue;
      }

      expect(result, testCase.name).toMatchObject({
        status: corpus.failureProjection.status,
        nodes: [],
        failures: projectedRuntimeCapabilityFailures(testCase),
        maxObservedConcurrency: 0,
        totalAttempts: corpus.failureProjection.totalAttempts,
        scheduledOrder: corpus.failureProjection.scheduledOrder,
        completionOrder: corpus.failureProjection.completionOrder,
      });
      expect(executor, testCase.name).toHaveBeenCalledTimes(
        corpus.failureProjection.executorCalls,
      );
      const journalCalls = [
        journal.beforeAttempt,
        journal.attemptFailed,
        journal.nodeSucceeded,
        journal.nodeSettledWithoutAttempt,
        journal.runTerminal,
      ].reduce((total, callback) => total + vi.mocked(callback).mock.calls.length, 0);
      expect(journalCalls, testCase.name).toBe(corpus.failureProjection.ordinaryJournalCalls);
    }
  });

  it("reports runtime issues before foreign conditions without inspecting hostile graph input", async () => {
    const combined: GraphSpec = {
      ...registeredLoopConditionGraph(),
      stateSchema: {},
    };
    const hostileInput = new Proxy({}, {
      ownKeys: () => {
        throw new Error("graph input must not be inspected during capability preflight");
      },
    });
    const executor = vi.fn(() => "never");

    const result = await runGraph(combined, hostileInput, {
      nodeExecutors: { source: executor },
    });

    expect(result).toMatchObject({
      status: "failed",
      nodes: [],
      totalAttempts: 0,
      failures: [
        {
          code: "UNSUPPORTED_RUNTIME_CAPABILITY",
          nodeId: "source",
          message: "Runtime capability 'graph-state' at '#/stateSchema' is not implemented by runtime-capability/v1alpha1",
          attempt: 0,
        },
        {
          code: "UNSUPPORTED_EDGE_CONDITION",
          nodeId: "source",
          attempt: 0,
        },
      ],
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it("allows implemented node kinds, empty schemas, value edges, false jitter, and supported policies", async () => {
    const supported = graph({
      entrypoints: ["agent", "model", "tool", "transform", "barrier"],
      outputs: { result: { node: "barrier" } },
      nodes: [
        node("agent", { kind: "agent", retry: { maxAttempts: 1, jitter: false } }),
        node("model", { kind: "model" }),
        node("tool", { kind: "tool" }),
        node("transform", { kind: "transform" }),
        node("barrier", { kind: "barrier", config: { condition: "all" } }),
      ],
      edges: [],
      policies: {
        maxConcurrency: 5,
        maxDepth: 1,
        maxFanOut: 1,
        maxTotalAttempts: 5,
      },
    });
    const executor = vi.fn(({ input }) => input);

    const result = await runGraph(
      supported,
      {},
      {
        nodeExecutors: {
          agent: executor,
          model: executor,
          tool: executor,
          transform: executor,
        },
      },
    );

    expect(result.status, JSON.stringify(result)).toBe("succeeded");
    expect(result.failures).toEqual([]);
    expect(result.totalAttempts).toBe(5);
    expect(executor).toHaveBeenCalledTimes(4);
  });

  it("rejects barrier configurations beyond the captured static all-success join", async () => {
    const executor = vi.fn(() => "never");
    const result = await runGraph(graph({
      nodes: [node("root", { kind: "barrier", config: { condition: "any" } })],
    }), {}, { nodeExecutors: { root: executor } });

    expect(result).toMatchObject({
      status: "failed",
      nodes: [],
      totalAttempts: 0,
      failures: [{
        code: "UNSUPPORTED_RUNTIME_CAPABILITY",
        nodeId: "root",
        message: "Runtime capability 'node-config:barrier' at '#/nodes/0/config' is not implemented by runtime-capability/v1alpha1",
        attempt: 0,
      }],
    });
    expect(executor).not.toHaveBeenCalled();
  });

  it("accepts compiler-valid typed-port schemas without rejecting the policy at runtime", async () => {
    const objectSchema = {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    } as const;
    const result = await runGraph(graph({
      inputSchema: objectSchema,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: { result: { type: "string" } },
        required: ["result"],
      },
      nodes: [node("root", {
        inputSchema: objectSchema,
        outputSchema: { type: "string" },
      })],
      policies: {
        maxConcurrency: 1,
        maxDepth: 1,
        maxFanOut: 1,
        maxTotalAttempts: 1,
        "graphengineering.reacher-z.github.io/typed-ports": {
          apiVersion: "graphengineering.reacher-z.github.io/typed-ports/v1alpha1",
          mode: "strict-exact",
        },
      },
    }), {}, { nodeExecutors: { root: () => "ok" } });

    expect(result.status, JSON.stringify(result)).toBe("succeeded");
    expect(result.output).toEqual({ result: "ok" });
    expect(result.failures).toEqual([]);
  });

  it("executes RouteEquals edges, propagates inactive control flow, and binds only the selected branch", async () => {
    const quick = vi.fn(() => ({ reviewed: "quick" }));
    const quickPost = vi.fn(({ input }) => input);
    const audit = vi.fn(() => ({ reviewed: "audit" }));
    const result = await runGraph(
      graph({
        outputs: { result: { node: "merge" } },
        nodes: [
          node("route", {
            kind: "router",
            config: { kind: "single", allowedRoutes: ["quick", "audit"] },
          }),
          node("quick"),
          node("quick-post"),
          node("audit"),
          node("merge", { kind: "barrier" }),
        ],
        entrypoints: ["route"],
        edges: [
          {
            id: "route-quick",
            from: { node: "route" },
            to: { node: "quick" },
            condition: {
              apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
              kind: "RouteEquals",
              routeKey: "quick",
            },
          },
          {
            id: "route-audit",
            from: { node: "route" },
            to: { node: "audit" },
            condition: {
              apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
              kind: "RouteEquals",
              routeKey: "audit",
            },
          },
          { id: "quick-post", from: { node: "quick" }, to: { node: "quick-post" } },
          { id: "quick-merge", from: { node: "quick-post" }, to: { node: "merge", port: "quick" } },
          { id: "audit-merge", from: { node: "audit" }, to: { node: "merge", port: "audit" } },
        ],
      }),
      { requestedRoutes: ["audit"] },
      { nodeExecutors: { quick, "quick-post": quickPost, audit } },
    );

    expect(result.status).toBe("succeeded");
    expect(result.output).toEqual({ result: { audit: { reviewed: "audit" } } });
    expect(result.failures).toEqual([]);
    expect(result.nodes.find(({ nodeId }) => nodeId === "quick")).toMatchObject({
      status: "skipped",
      attempts: 0,
      failure: { code: "ROUTE_NOT_SELECTED" },
    });
    expect(result.nodes.find(({ nodeId }) => nodeId === "quick-post")).toMatchObject({
      status: "skipped",
      attempts: 0,
      failure: { code: "ROUTE_NOT_SELECTED" },
    });
    expect(quick).not.toHaveBeenCalled();
    expect(quickPost).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledOnce();
  });

  it("settles every zero-match branch without executing it", async () => {
    const branch = vi.fn();
    const result = await runGraph(
      graph({
        outputs: { decision: { node: "route" } },
        nodes: [
          node("route", {
            kind: "router",
            config: { kind: "single", allowedRoutes: ["known"] },
          }),
          node("branch"),
        ],
        entrypoints: ["route"],
        edges: [{
          id: "route-branch",
          from: { node: "route" },
          to: { node: "branch" },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: "known",
          },
        }],
      }),
      { requestedRoutes: ["unknown"] },
      { nodeExecutors: { branch } },
    );

    expect(result.status).toBe("succeeded");
    expect(result.output).toMatchObject({ decision: { routed: false, reasonCode: "UNKNOWN_ROUTE" } });
    expect(result.nodes.find(({ nodeId }) => nodeId === "branch")?.failure?.code)
      .toBe("ROUTE_NOT_SELECTED");
    expect(result.failures).toEqual([]);
    expect(branch).not.toHaveBeenCalled();
  });

  it("routes a low-confidence decision only to its configured escalation branch", async () => {
    const quick = vi.fn();
    const human = vi.fn(() => ({ reviewed: "human" }));
    const result = await runGraph(
      graph({
        outputs: { decision: { node: "route" } },
        nodes: [
          node("route", {
            kind: "router",
            config: {
              kind: "single",
              allowedRoutes: ["quick", "human"],
              confidence: { minimumBasisPoints: 7000, escalationRoute: "human" },
            },
          }),
          node("quick"),
          node("human"),
        ],
        entrypoints: ["route"],
        edges: ["quick", "human"].map((routeKey) => ({
          id: `route-${routeKey}`,
          from: { node: "route" },
          to: { node: routeKey },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey,
          },
        })),
      }),
      { requestedRoutes: ["quick"], confidenceBasisPoints: 6999 },
      { nodeExecutors: { quick, human } },
    );

    expect(result.output).toMatchObject({
      decision: {
        selectedRoutes: ["human"],
        reasonCode: "ESCALATION_SELECTED_LOW_CONFIDENCE",
        escalated: true,
      },
    });
    expect(quick).not.toHaveBeenCalled();
    expect(human).toHaveBeenCalledOnce();
  });

  it.each([
    ["duplicate selected route", ["quick", "quick"]],
    ["non-string selected route", [1]],
  ])("rejects a router output with a %s", async (_name, selectedRoutes) => {
    const result = await runGraph(
      graph({
        outputs: { decision: { node: "root" } },
        nodes: [
          node("root", {
            kind: "router",
            config: { kind: "single", allowedRoutes: ["quick"] },
          }),
          node("quick"),
        ],
        edges: [{
          id: "root-quick",
          from: { node: "root" },
          to: { node: "quick" },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: "quick",
          },
        }],
      }),
      { requestedRoutes: ["quick"] },
      {
        nodeExecutors: {
          root: () => ({
            routed: true,
            reasonCode: "REQUESTED_ROUTES_SELECTED",
            requestedRoutes: ["quick"],
            selectedRoutes,
            unknownRoutes: [],
            confidenceBasisPoints: null,
            usedDefault: false,
            escalated: false,
          }),
        },
      },
    );
    expect(result.nodes[0]?.failure).toMatchObject({
      code: "INVALID_ROUTE_SELECTION",
      retryable: false,
    });
  });

  it("does not retry an INVALID_ROUTE_SELECTION from a malformed request", async () => {
    const attemptFailed = vi.fn(async () => undefined);
    const result = await runGraphWithJournal(
      graph({
        nodes: [
          node("root", {
            kind: "router",
            config: { kind: "single", allowedRoutes: ["quick"] },
            retry: { maxAttempts: 3 },
          }),
          node("quick"),
        ],
        edges: [{
          id: "root-quick",
          from: { node: "root" },
          to: { node: "quick" },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: "quick",
          },
        }],
      }),
      {},
      { journal: testJournal({ attemptFailed }) },
    );
    expect(result.nodes[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      failure: { code: "INVALID_ROUTE_SELECTION", retryable: false },
    });
    expect(result.totalAttempts).toBe(1);
    expect(attemptFailed).toHaveBeenCalledOnce();
    expect(attemptFailed.mock.calls[0]?.[0]).toMatchObject({
      willRetry: false,
      retryDelayMs: 0,
      failure: { code: "INVALID_ROUTE_SELECTION", retryable: false },
    });
  });

  it("rejects an invalid router policy at compile time without an attempt", async () => {
    const attemptFailed = vi.fn(async () => undefined);
    const result = await runGraphWithJournal(
      graph({
        nodes: [node("root", {
          kind: "router",
          config: { kind: "multi", allowedRoutes: ["quick"] },
          retry: { maxAttempts: 3 },
        })],
      }),
      { requestedRoutes: ["quick"] },
      { journal: testJournal({ attemptFailed }) },
    );
    expect(result).toMatchObject({
      status: "failed",
      totalAttempts: 0,
      nodes: [],
      failures: [{ code: "GE1401_INVALID_ROUTER_POLICY", phase: "compile" }],
    });
    expect(attemptFailed).not.toHaveBeenCalled();
  });

  it("fails a forged router decision before emitting a successful router result", async () => {
    const branch = vi.fn();
    const router = vi.fn(() => ({
      routed: true,
      reasonCode: "REQUESTED_ROUTES_SELECTED",
      requestedRoutes: ["audit"],
      selectedRoutes: ["audit"],
      unknownRoutes: [],
      confidenceBasisPoints: null,
      usedDefault: false,
      escalated: false,
    }));
    const result = await runGraph(
      graph({
        outputs: { decision: { node: "route" } },
        nodes: [
          node("route", {
            kind: "router",
            config: { kind: "single", allowedRoutes: ["quick", "audit"] },
            retry: { maxAttempts: 3 },
          }),
          node("branch"),
          node("quick"),
        ],
        entrypoints: ["route"],
        edges: [
          {
            id: "route-branch",
            from: { node: "route" },
            to: { node: "branch" },
            condition: {
              apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
              kind: "RouteEquals",
              routeKey: "audit",
            },
          },
          {
            id: "route-quick",
            from: { node: "route" },
            to: { node: "quick" },
            condition: {
              apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
              kind: "RouteEquals",
              routeKey: "quick",
            },
          },
        ],
      }),
      { requestedRoutes: ["quick"] },
      {
        nodeExecutors: {
          route: router,
          branch,
        },
      },
    );

    expect(result.status).toBe("failed");
    expect(result.nodes[0]).toMatchObject({
      status: "failed",
      attempts: 1,
      failure: { code: "INVALID_ROUTE_SELECTION", causeName: "InvalidRouteSelectionError" },
    });
    expect(result.nodes[1]).toMatchObject({
      status: "skipped",
      failure: { code: "UPSTREAM_FAILED" },
    });
    expect(result.totalAttempts).toBe(1);
    expect(router).toHaveBeenCalledOnce();
    expect(branch).not.toHaveBeenCalled();
  });

  it("rejects a forged restored router success before reconstructing edge activation", async () => {
    const routed = graph({
      outputs: { decision: { node: "route" } },
      nodes: [
        node("route", {
          kind: "router",
          config: { kind: "single", allowedRoutes: ["quick", "audit"] },
        }),
        node("branch"),
        node("quick"),
      ],
      entrypoints: ["route"],
      edges: [
        {
          id: "route-branch",
          from: { node: "route" },
          to: { node: "branch" },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: "audit",
          },
        },
        {
          id: "route-quick",
          from: { node: "route" },
          to: { node: "quick" },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: "quick",
          },
        },
      ],
    });
    const initialResults = new Map([[
      "route",
      {
        nodeId: "route",
        sequence: 0,
        status: "succeeded" as const,
        attempts: 1,
        input: { requestedRoutes: ["quick"] },
        output: {
          routed: true,
          reasonCode: "REQUESTED_ROUTES_SELECTED",
          requestedRoutes: ["audit"],
          selectedRoutes: ["audit"],
          unknownRoutes: [],
          confidenceBasisPoints: null,
          usedDefault: false,
          escalated: false,
        },
      },
    ]]);

    await expect(runGraphWithJournal(routed, {}, { initialResults }))
      .rejects.toThrow("initialResults contains an invalid successful router decision for 'route'");
  });

  it.each([
    ["malformed", node("route", {
      kind: "router",
      config: { kind: "single", allowedRoutes: ["x"] },
    }), { kind: "RouteEquals", routeKey: "x" }, "GE1402_UNSUPPORTED_EDGE_CONDITION"],
    ["unsupported", node("route", {
      kind: "router",
      config: { kind: "single", allowedRoutes: ["x"] },
    }), {
      apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
      kind: "Other",
      routeKey: "x",
    }, "GE1402_UNSUPPORTED_EDGE_CONDITION"],
    ["non-router", node("route"), {
      apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
      kind: "RouteEquals",
      routeKey: "x",
    }, "GE1403_CONDITION_SOURCE_NOT_ROUTER"],
  ])("fails closed for a %s conditional edge before source execution", async (
    _name,
    source,
    condition,
    expectedCode,
  ) => {
    const sourceExecutor = vi.fn(() => ({ selectedRoutes: ["x"] }));
    const result = await runGraph(
      graph({
        outputs: { decision: { node: "route" } },
        nodes: [source, node("branch")],
        entrypoints: ["route"],
        edges: [{ id: "conditional", from: { node: "route" }, to: { node: "branch" }, condition }],
      }),
      {},
      { nodeExecutors: { route: sourceExecutor } },
    );

    expect(result.status).toBe("failed");
    expect(result).toMatchObject({
      totalAttempts: 0,
      nodes: [],
      failures: [{ code: expectedCode, phase: "compile" }],
    });
    expect(sourceExecutor).not.toHaveBeenCalled();
  });

  it("preflights compiler-registered foreign conditions across the whole graph", async () => {
    const sourceExecutor = vi.fn(() => ({ done: true }));
    const result = await runGraph(registeredLoopConditionGraph(), {}, {
      nodeExecutors: { source: sourceExecutor },
    });

    expect(result).toMatchObject({
      status: "failed",
      totalAttempts: 0,
      nodes: [],
      failures: [{
        phase: "execute",
        code: "UNSUPPORTED_EDGE_CONDITION",
        nodeId: "source",
        attempt: 0,
      }],
    });
    expect(result.failures[0]?.message).toContain("to-continue");
    expect(result.failures[0]?.message).toContain("to-dry");
    expect(result.failures[0]?.message).toContain("to-bound");
    const message = result.failures[0]?.message ?? "";
    expect(message.indexOf("to-continue")).toBeLessThan(message.indexOf("to-dry"));
    expect(message.indexOf("to-dry")).toBeLessThan(message.indexOf("to-bound"));
    expect(sourceExecutor).not.toHaveBeenCalled();
  });

  it("orders foreign-condition failures by node declaration and messages by edge declaration", async () => {
    const zSource = vi.fn(() => ({ done: true }));
    const aSource = vi.fn(() => ({ done: true }));
    const foreign = (kind: string, round: number) => ({
      apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
      kind,
      maxRounds: 3,
      round,
      roundKey: `r${round}`,
    });
    const result = await runGraph(graph({
      entrypoints: ["z-source", "a-source"],
      outputs: { z: { node: "z-target" }, a: { node: "a-target" } },
      nodes: [node("z-source"), node("z-target"), node("a-source"), node("a-target")],
      edges: [
        {
          id: "z-edge-declared-first",
          from: { node: "a-source" },
          to: { node: "a-target" },
          condition: foreign("LoopDryVerdict", 1),
        },
        {
          id: "a-edge-declared-second",
          from: { node: "z-source" },
          to: { node: "z-target" },
          condition: foreign("LoopContinue", 0),
        },
      ],
    }), {}, { nodeExecutors: { "z-source": zSource, "a-source": aSource } });

    expect(result.nodes).toEqual([]);
    expect(result.totalAttempts).toBe(0);
    expect(result.failures.map((failure) => ({
      nodeId: "nodeId" in failure ? failure.nodeId : undefined,
      message: failure.message,
    }))).toEqual([
      { nodeId: "z-source", message: expect.stringContaining("a-edge-declared-second") },
      { nodeId: "a-source", message: expect.stringContaining("z-edge-declared-first") },
    ]);
    expect(zSource).not.toHaveBeenCalled();
    expect(aSource).not.toHaveBeenCalled();
  });

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

    const diamond = fixture("diamond.graph.json");
    const executableDiamond: GraphSpec = {
      ...diamond,
      policies: {
        maxConcurrency: 2,
        maxDepth: 8,
        maxFanOut: 4,
        maxTotalAttempts: 8,
      },
    };
    const result = await runGraph(executableDiamond, { seed: 2 }, {
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

  it("does not resolve inherited node or kind executor properties", async () => {
    const inherited = graph({
      entrypoints: ["toString"],
      outputs: { result: { node: "toString" } },
      nodes: [node("toString", { kind: "agent" })],
    });
    const result = await runGraph(inherited, {}, { nodeExecutors: {}, executors: {} });
    expect(result.status).toBe("failed");
    expect(result.failures[0]).toMatchObject({
      code: "EXECUTOR_NOT_FOUND", nodeId: "toString", attempt: 0,
    });
  });

  it("executes an immutable snapshot of the compiled graph", async () => {
    const mutableConfig = { value: "original" };
    const document = graph({ nodes: [node("root", { config: mutableConfig })] });
    const running = runGraph(document, {}, {
      nodeExecutors: {
        root: ({ graph: runtimeGraph }) => {
          expect(Object.isFrozen(runtimeGraph)).toBe(true);
          expect(Object.isFrozen(runtimeGraph.nodes[0])).toBe(true);
          expect(() => {
            (runtimeGraph.nodes as NodeSpec[])[0]!.id = "changed";
          }).toThrow(TypeError);
          return (runtimeGraph.nodes[0]?.config as { value: string }).value;
        },
      },
    });
    mutableConfig.value = "caller-mutated";
    const result = await running;
    expect(result.output).toEqual({ result: "original" });
  });

  it("treats __proto__ output names and target ports as ordinary own JSON keys", async () => {
    const outputs = JSON.parse('{"__proto__":{"node":"consumer"}}') as GraphSpec["outputs"];
    let consumerInput: Record<string, unknown> | undefined;
    const document = graph({
      outputs,
      nodes: [node("root"), node("consumer")],
      edges: [{
        id: "root-consumer",
        from: { node: "root" },
        to: { node: "consumer", port: "__proto__" },
      }],
    });
    const result = await runGraph(document, {}, {
      nodeExecutors: {
        root: () => ({ safe: true }),
        consumer: ({ input }) => {
          consumerInput = input as Record<string, unknown>;
          return { received: Object.hasOwn(input as object, "__proto__") };
        },
      },
    });
    expect(result.status).toBe("succeeded");
    expect(Object.hasOwn(consumerInput as object, "__proto__")).toBe(true);
    expect(consumerInput?.__proto__).toEqual({ safe: true });
    expect(Object.getPrototypeOf(consumerInput)).toBe(Object.prototype);
    expect(Object.hasOwn(result.output as object, "__proto__")).toBe(true);
    expect(result.output?.__proto__).toEqual({ received: true });
    expect(Object.getPrototypeOf(result.output)).toBe(Object.prototype);
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

  it("does not journal a retry when the global attempt budget has no capacity", async () => {
    const retryAdmissions: boolean[] = [];
    const result = await runGraphWithJournal(
      graph({
        nodes: [node("root", { retry: { maxAttempts: 2 } })],
        policies: { maxTotalAttempts: 1 },
      }),
      {},
      {
        nodeExecutors: { root: () => { throw new Error("fail once"); } },
        journal: testJournal({
          attemptFailed: async ({ willRetry }) => { retryAdmissions.push(willRetry); },
        }),
      },
    );

    expect(retryAdmissions).toEqual([false]);
    expect(result.totalAttempts).toBe(1);
    expect(result.nodes[0]).toMatchObject({
      attempts: 1,
      status: "failed",
      failure: { retryable: false },
    });
  });

  it("atomically grants only one final retry reservation to parallel failures", async () => {
    let firstAttemptStarts = 0;
    let releaseFirstAttempts!: () => void;
    const firstAttemptsStarted = new Promise<void>((resolve) => { releaseFirstAttempts = resolve; });
    const calls = new Map<string, number>();
    const retryAdmissions: { nodeId: string; willRetry: boolean }[] = [];
    const executor: NodeExecutor = async ({ node: current }) => {
      const count = (calls.get(current.id) ?? 0) + 1;
      calls.set(current.id, count);
      if (count === 1) {
        firstAttemptStarts += 1;
        if (firstAttemptStarts === 2) releaseFirstAttempts();
        await firstAttemptsStarted;
        throw new Error(`first ${current.id}`);
      }
      return `${current.id}-recovered`;
    };

    const result = await runGraphWithJournal(
      graph({
        entrypoints: ["a", "b"],
        outputs: { a: { node: "a" }, b: { node: "b" } },
        nodes: [
          node("a", { retry: { maxAttempts: 2 } }),
          node("b", { retry: { maxAttempts: 2 } }),
        ],
        policies: { maxConcurrency: 2, maxTotalAttempts: 3 },
      }),
      {},
      {
        nodeExecutors: { a: executor, b: executor },
        journal: testJournal({
          attemptFailed: async ({ node: current, willRetry }) => {
            retryAdmissions.push({ nodeId: current.id, willRetry });
          },
        }),
      },
    );

    expect([...calls.values()].reduce((sum, count) => sum + count, 0)).toBe(3);
    expect(retryAdmissions.filter(({ willRetry }) => willRetry)).toHaveLength(1);
    expect(retryAdmissions.filter(({ willRetry }) => !willRetry)).toHaveLength(1);
    expect(result.totalAttempts).toBe(3);
  });

  it("measures only globally admitted, journal-committed attempts", async () => {
    let historyOpen = 0;
    let maximumHistoryOpen = 0;
    const executor = vi.fn(async ({ node: current }: Parameters<NodeExecutor>[0]) => {
      await wait(5);
      return current.id;
    });
    const journal = testJournal({
      beforeAttempt: async ({ node: current, attempt }) => {
        historyOpen += 1;
        maximumHistoryOpen = Math.max(maximumHistoryOpen, historyOpen);
        return {
          runId: "metric-run",
          attemptId: `metric-run/${current.id}/${attempt}`,
          activityKey: `activity/${current.id}`,
        };
      },
      attemptFailed: async () => { historyOpen -= 1; },
      nodeSucceeded: async () => { historyOpen -= 1; },
    });

    const result = await runGraphWithJournal(
      graph({
        entrypoints: ["a", "b"],
        outputs: { a: { node: "a" }, b: { node: "b" } },
        nodes: [node("a"), node("b")],
        policies: { maxConcurrency: 2, maxTotalAttempts: 1 },
      }),
      {},
      { nodeExecutors: { a: executor, b: executor }, journal },
    );

    expect(executor).toHaveBeenCalledOnce();
    expect(result.totalAttempts).toBe(1);
    expect(result.maxObservedConcurrency).toBe(1);
    expect(maximumHistoryOpen).toBe(1);
    expect(historyOpen).toBe(0);
  });

  it("commits a failed attempt before releasing its concurrency slot", async () => {
    const order: string[] = [];
    const journal = testJournal({
      beforeAttempt: async ({ node: current, attempt }) => {
        order.push(`${current.id}:started`);
        return {
          runId: "ordering-run",
          attemptId: `ordering-run/${current.id}/${attempt}`,
          activityKey: `activity/${current.id}`,
        };
      },
      attemptFailed: async ({ node: current }) => {
        order.push(`${current.id}:failure-begin`);
        await wait(5);
        order.push(`${current.id}:failure-commit`);
      },
      nodeSucceeded: async ({ node: current }) => {
        order.push(`${current.id}:success-commit`);
      },
    });

    await runGraphWithJournal(
      graph({
        entrypoints: ["a", "b"],
        outputs: { a: { node: "a" }, b: { node: "b" } },
        nodes: [node("a"), node("b")],
        policies: { maxConcurrency: 1, maxTotalAttempts: 2 },
      }),
      {},
      {
        nodeExecutors: {
          a: () => { throw new Error("a failed"); },
          b: () => "b succeeded",
        },
        journal,
      },
    );

    expect(order.indexOf("a:failure-commit")).toBeLessThan(order.indexOf("b:started"));
    expect(order).toEqual([
      "a:started",
      "a:failure-begin",
      "a:failure-commit",
      "b:started",
      "b:success-commit",
    ]);
  });

  it("counts persisted retry-delay seeds as reserved global attempts", async () => {
    await expect(
      runGraphWithJournal(
        graph({
          entrypoints: ["a", "b"],
          outputs: { a: { node: "a" }, b: { node: "b" } },
          nodes: [node("a"), node("b")],
          policies: { maxTotalAttempts: 2 },
        }),
        {},
        {
          initialTotalAttempts: 1,
          initialRetryDelaysMs: new Map([["a", 0], ["b", 0]]),
        },
      ),
    ).rejects.toThrow("initial durable attempts and retry reservations exceed maxTotalAttempts");
  });

  it("commits zero-attempt settlement before releasing a failed descendant", async () => {
    let releaseRootCommit!: () => void;
    let rootCommitStarted!: () => void;
    const rootCommitGate = new Promise<void>((resolve) => { releaseRootCommit = resolve; });
    const rootCommitEntered = new Promise<void>((resolve) => { rootCommitStarted = resolve; });
    const order: string[] = [];
    const child = vi.fn(() => "should-not-run");
    const journal = testJournal({
      nodeSettledWithoutAttempt: async ({ node: current }) => {
        order.push(`${current.id}:begin`);
        if (current.id === "root") {
          rootCommitStarted();
          await rootCommitGate;
        }
        order.push(`${current.id}:end`);
      },
    });

    const run = runGraphWithJournal(
      graph({
        outputs: { result: { node: "child" } },
        nodes: [node("root", { kind: "agent" }), node("child", { kind: "agent" })],
        edges: [{ id: "root-child", from: { node: "root" }, to: { node: "child" } }],
      }),
      {},
      { nodeExecutors: { child }, journal },
    );

    await rootCommitEntered;
    expect(order).toEqual(["root:begin"]);
    expect(child).not.toHaveBeenCalled();
    releaseRootCommit();
    const result = await run;
    expect(order).toEqual(["root:begin", "root:end", "child:begin", "child:end"]);
    expect(result.nodes.map(({ status }) => status)).toEqual(["failed", "skipped"]);
    expect(child).not.toHaveBeenCalled();
  });

  it("keeps the public runGraph enumerable result shape unchanged", async () => {
    const result = await runGraph(graph({}), {}, { nodeExecutors: { root: () => "ok" } });
    expect(Object.keys(result).sort()).toEqual([
      "failures",
      "graphHash",
      "maxObservedConcurrency",
      "nodes",
      "output",
      "status",
      "totalAttempts",
    ]);
    expect("scheduledOrder" in result).toBe(false);
    expect("completionOrder" in result).toBe(false);
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
