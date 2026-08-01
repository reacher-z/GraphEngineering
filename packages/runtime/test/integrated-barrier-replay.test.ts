import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  INTEGRATED_BARRIER_API_VERSION,
  type GraphSpec,
  type NodeSpec,
} from "@graph-engineering/core";
import { describe, expect, it, vi } from "vitest";

import {
  adoptCommittedDecisions,
  adoptedRouteSelection,
  runGraph,
  type CommittedDecisionEvent,
} from "../src/index.js";

interface ReplayCase {
  readonly name: string;
  readonly runId: string;
  readonly graphRevision: number;
  readonly currentPolicies: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly history: readonly CommittedDecisionEvent[];
  readonly expect: {
    readonly outcome: "adopted" | "rejected";
    readonly code?: string;
    readonly nodeId?: string;
    readonly recordedPolicyHash?: string;
    readonly currentPolicyHash?: string;
    readonly recordedDecisionId?: string;
    readonly recomputedDecisionId?: string;
    readonly adoptedNodeIds: readonly string[];
    readonly appendedDecisionEvents: number;
    readonly expectedExecutorCalls: number;
    readonly forkedFromRunId?: string;
    readonly parentDecisionId?: string;
    readonly childDecisionId?: string;
  };
}

interface BarrierCorpus {
  readonly vocabulary: { readonly replayRejectionCodes: readonly string[] };
  readonly replayCases: readonly ReplayCase[];
}

const corpus = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../spec/conformance/integrated-barrier.case.json", import.meta.url)),
  "utf8",
)) as BarrierCorpus;

function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return { id, kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, ...overrides };
}

function policyMap(replayCase: ReplayCase): ReadonlyMap<string, unknown> {
  return new Map(Object.entries(replayCase.currentPolicies));
}

/**
 * A graph carrying exactly the corpus policies. Three upstreams keep every
 * corpus threshold within the incoming-edge count, so GE1424 never fires.
 */
function replayGraph(replayCase: ReplayCase): GraphSpec {
  const barriers = Object.entries(replayCase.currentPolicies).filter(
    ([, config]) => config.apiVersion === INTEGRATED_BARRIER_API_VERSION,
  );
  const routers = Object.entries(replayCase.currentPolicies).filter(
    ([, config]) => config.apiVersion !== INTEGRATED_BARRIER_API_VERSION,
  );
  const sources = ["a", "b", "c"];
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "integrated-barrier-replay", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: { result: { node: "root" } },
    nodes: [
      node("root"),
      ...sources.map((id) => node(id)),
      ...routers.map(([id, config]) =>
        node(id, { kind: "router", config: config as NodeSpec["config"] })),
      ...routers.flatMap(([id, config]) =>
        (config.allowedRoutes as readonly string[]).map((route) => node(`${id}-${route}`))),
      ...barriers.map(([id, config]) =>
        node(id, { kind: "barrier", config: config as NodeSpec["config"] })),
    ],
    edges: [
      ...sources.map((id) => ({
        id: `root-${id}`,
        from: { node: "root" },
        to: { node: id, port: id },
      })),
      ...routers.map(([id]) => ({
        id: `root-${id}`,
        from: { node: "root" },
        to: { node: id },
      })),
      // GE1407 requires every allowed route to have a case.
      ...routers.flatMap(([id, config]) =>
        (config.allowedRoutes as readonly string[]).map((route) => ({
          id: `${id}-${route}`,
          from: { node: id },
          to: { node: `${id}-${route}` },
          condition: {
            apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
            kind: "RouteEquals",
            routeKey: route,
          },
        }))),
      ...barriers.flatMap(([id]) => sources.map((source) => ({
        id: `${source}-${id}`,
        from: { node: source },
        to: { node: id, port: source },
      }))),
    ],
  } as GraphSpec;
}

describe("zero-rejudge decision replay conformance", () => {
  it("consumes the whole replay section", () => {
    expect(corpus.replayCases).toHaveLength(8);
    expect(corpus.vocabulary.replayRejectionCodes).toEqual([
      "DECISION_POLICY_DRIFT",
      "DECISION_IDENTITY_MISMATCH",
      "DUPLICATE_DECISION",
    ]);
  });

  it.each(corpus.replayCases)("replay: $name", (replayCase) => {
    const adoption = adoptCommittedDecisions(
      replayCase.history,
      policyMap(replayCase),
      { runId: replayCase.runId, graphRevision: replayCase.graphRevision },
    );
    expect(adoption.outcome).toBe(replayCase.expect.outcome);
    if (adoption.outcome === "adopted") {
      expect(adoption.decisions.map((item) => item.nodeId))
        .toEqual(replayCase.expect.adoptedNodeIds);
      // The identity really recomputes; it is not copied from the record.
      for (const decision of adoption.decisions) {
        expect(decision.decisionId).toBe(decision.document.decisionId);
      }
      return;
    }
    const { rejection } = adoption;
    expect(rejection.code).toBe(replayCase.expect.code);
    expect(rejection.nodeId).toBe(replayCase.expect.nodeId);
    if (rejection.code === "DECISION_POLICY_DRIFT") {
      expect(rejection.recordedPolicyHash).toBe(replayCase.expect.recordedPolicyHash);
      expect(rejection.currentPolicyHash).toBe(replayCase.expect.currentPolicyHash);
      expect(rejection.recordedPolicyHash).not.toBe(rejection.currentPolicyHash);
    }
    if (rejection.code === "DECISION_IDENTITY_MISMATCH") {
      expect(rejection.recordedDecisionId).toBe(replayCase.expect.recordedDecisionId);
      expect(rejection.recomputedDecisionId).toBe(replayCase.expect.recomputedDecisionId);
    }
  });

  it("adopts a fork's own identity and refuses the parent's", () => {
    const fork = corpus.replayCases.find(
      (item) => item.name === "fork-recomputes-its-own-decision-identity-under-the-child-run-id",
    );
    const transplant = corpus.replayCases.find(
      (item) => item.name === "decision-identity-mismatch-rejects-a-transplanted-run-id",
    );
    if (fork === undefined || transplant === undefined) throw new Error("missing fork witness");
    expect(fork.runId).toBe(transplant.runId);
    expect(fork.expect.childDecisionId).toBe(transplant.expect.recomputedDecisionId);
    expect(fork.expect.parentDecisionId).toBe(transplant.expect.recordedDecisionId);
    // Same run, same policy, same document body: only the recorded identity
    // differs, and only the child's own identity is adoptable.
    expect(adoptCommittedDecisions(fork.history, policyMap(fork), {
      runId: fork.runId,
      graphRevision: fork.graphRevision,
    }).outcome).toBe("adopted");
    expect(adoptCommittedDecisions(transplant.history, policyMap(transplant), {
      runId: transplant.runId,
      graphRevision: transplant.graphRevision,
    }).outcome).toBe("rejected");
  });

  it.each(corpus.replayCases)(
    "the scheduler never calls an executor for: $name",
    async (replayCase) => {
      const executors: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const nodeId of Object.keys(replayCase.currentPolicies)) {
        executors[nodeId] = vi.fn(() => "must-not-run");
      }
      const result = await runGraph(replayGraph(replayCase), {}, {
        decision: { runId: replayCase.runId, graphRevision: replayCase.graphRevision },
        committedDecisions: replayCase.history,
        nodeExecutors: {
          ...executors,
          a: () => "ok",
          b: () => "ok",
          c: () => "ok",
        },
      });

      for (const [nodeId, executor] of Object.entries(executors)) {
        expect(executor, nodeId).not.toHaveBeenCalled();
      }
      // No second decision event is ever appended for an adopted node.
      expect(result.decisionEvents ?? []).toHaveLength(
        replayCase.expect.appendedDecisionEvents,
      );

      if (replayCase.expect.outcome === "rejected") {
        expect(result.status).toBe("failed");
        expect(result.nodes).toEqual([]);
        expect(result.totalAttempts).toBe(0);
        expect(result.failures).toEqual([expect.objectContaining({
          code: replayCase.expect.code,
          nodeId: replayCase.expect.nodeId,
          retryable: false,
          attempt: 0,
        })]);
        return;
      }

      for (const nodeId of replayCase.expect.adoptedNodeIds) {
        const adopted = result.nodes.find((item) => item.nodeId === nodeId);
        expect(adopted?.attempts, nodeId).toBe(0);
      }
    },
  );

  it("adopts a committed barrier decision as the node's bound output", async () => {
    const replayCase = corpus.replayCases.find(
      (item) => item.name === "zero-rejudge-adoption-of-a-committed-barrier-decision",
    );
    if (replayCase === undefined) throw new Error("missing adoption witness");
    const result = await runGraph(replayGraph(replayCase), {}, {
      decision: { runId: replayCase.runId, graphRevision: replayCase.graphRevision },
      committedDecisions: replayCase.history,
      nodeExecutors: { a: () => "ok", b: () => "ok", c: () => "ok" },
    });
    const gate = result.nodes.find((item) => item.nodeId === "gate");
    expect(gate?.status).toBe("succeeded");
    // Adopted verbatim: the recorded counts survive even though this graph's
    // upstreams would not reproduce them.
    expect(gate?.output).toEqual(replayCase.history[0]?.data);
    expect(gate?.attempts).toBe(0);
  });

  it("projects an adopted route decision back to the published eight members", () => {
    const replayCase = corpus.replayCases.find(
      (item) => item.name === "adoption-of-a-committed-route-selected-decision",
    );
    if (replayCase === undefined) throw new Error("missing route adoption witness");
    const document = replayCase.history[0]?.data as Readonly<Record<string, unknown>>;
    expect(Object.keys(adoptedRouteSelection(document) as object).sort()).toEqual([
      "confidenceBasisPoints",
      "escalated",
      "reasonCode",
      "requestedRoutes",
      "routed",
      "selectedRoutes",
      "unknownRoutes",
      "usedDefault",
    ]);
  });
});
