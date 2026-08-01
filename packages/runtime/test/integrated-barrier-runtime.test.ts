import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  INTEGRATED_BARRIER_API_VERSION,
  barrierDecisionId,
  decisionPolicyHash,
  validateBarrierPolicy,
  type GraphSpec,
  type NodeSpec,
} from "@graph-engineering/core";
import { describe, expect, it, vi } from "vitest";

import { createScriptedClock, runGraph, type NodeExecutor } from "../src/index.js";

interface EvaluationCase {
  readonly name: string;
  readonly policy: Readonly<Record<string, unknown>>;
  readonly barrierNodeId: string;
  readonly dispositions: readonly {
    readonly sourceNodeId: string;
    readonly disposition: string;
    readonly vote?: Readonly<Record<string, unknown>>;
  }[];
  readonly expect: Readonly<Record<string, unknown>>;
}

interface BarrierCorpus {
  readonly vocabulary: {
    readonly runTerminalPrecedence: readonly string[];
    readonly nodeFailureCodes: readonly string[];
    readonly resolutionByOnUnsatisfied: Readonly<Record<string, string>>;
    readonly verdictToDisposition: Readonly<Record<string, string>>;
  };
  readonly evaluationCases: readonly EvaluationCase[];
}

const corpus = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../spec/conformance/integrated-barrier.case.json", import.meta.url)),
  "utf8",
)) as BarrierCorpus;

function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return { id, kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, ...overrides };
}

/**
 * `sourceIds` become the barrier's incoming edges **in declaration order**,
 * which is the order the decision document must preserve.
 */
function barrierGraph(
  policy: unknown,
  sourceIds: readonly string[],
  options: { readonly sink?: boolean; readonly outputFromSink?: boolean } = {},
): GraphSpec {
  const sink = options.sink === true;
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "integrated-barrier", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: {
      result: sink && options.outputFromSink === true
        ? { node: "sink" }
        : { node: "gate" },
    },
    nodes: [
      node("root"),
      ...sourceIds.map((id) => node(id)),
      node("gate", { kind: "barrier", config: policy as NodeSpec["config"] }),
      ...(sink ? [node("sink")] : []),
    ],
    edges: [
      ...sourceIds.map((id) => ({
        id: `root-${id}`,
        from: { node: "root" },
        to: { node: id, port: id },
      })),
      ...sourceIds.map((id) => ({
        id: `${id}-gate`,
        from: { node: id },
        to: { node: "gate", port: id },
      })),
      ...(sink ? [{ id: "gate-sink", from: { node: "gate" }, to: { node: "sink" } }] : []),
    ],
  } as GraphSpec;
}

const policy = (fields: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> => ({
  apiVersion: INTEGRATED_BARRIER_API_VERSION,
  ...fields,
});

const ballot = (
  verdict: string,
  extra: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  apiVersion: INTEGRATED_BARRIER_API_VERSION,
  kind: "BarrierVote",
  verdict,
  ...extra,
});

const failing: NodeExecutor = () => { throw new Error("upstream failed"); };

interface HeldExecutor {
  readonly executor: NodeExecutor;
  release(value?: unknown): void;
}

/** An executor that settles only when the test releases it. */
function held(): HeldExecutor {
  let settle: ((value: unknown) => void) | undefined;
  const queued: unknown[] = [];
  return {
    executor: () => new Promise((resolve) => {
      settle = resolve;
      if (queued.length > 0) resolve(queued.shift());
    }),
    release: (value: unknown = "late") => {
      if (settle === undefined) queued.push(value);
      else settle(value);
    },
  };
}

const settleAfter = async (milliseconds: number, action: () => void): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
  action();
};

function decisionOf(result: Awaited<ReturnType<typeof runGraph>>, nodeId = "gate"): Record<
  string,
  unknown
> {
  const event = result.decisionEvents?.find(
    (item) => item.type === "BarrierSatisfied" && item.nodeId === nodeId,
  );
  if (event === undefined) throw new Error(`no committed decision for '${nodeId}'`);
  return event.data as Record<string, unknown>;
}

describe("integrated barrier scheduler execution", () => {
  it("decides an all barrier and binds the decision document as its output", async () => {
    const result = await runGraph(
      barrierGraph(policy({ kind: "all", onUnsatisfied: "fail", lateArrival: "ignore" }),
        ["a", "b"]),
      {},
      {
        decision: { runId: "run-alpha", graphRevision: 1 },
        clock: createScriptedClock([12, 40]),
        nodeExecutors: { a: () => "ok", b: () => "ok" },
      },
    );

    expect(result.status).toBe("succeeded");
    const gate = result.nodes.find((item) => item.nodeId === "gate");
    expect(gate?.status).toBe("succeeded");
    expect(gate?.attempts).toBe(0);
    const decision = decisionOf(result);
    expect(decision).toMatchObject({
      barrierNodeId: "gate",
      satisfied: true,
      reasonCode: "ALL_SUCCEEDED",
      resolution: "satisfied",
      deadlineElapsed: false,
      total: 2,
      succeeded: 2,
      acceptedIds: ["a", "b"],
    });
    // The bound output is the decision document itself.
    expect(gate?.output).toEqual(decision);
    expect(result.output?.result).toEqual(decision);
  });

  it("recomputes policyHash and decisionId natively for the committed decision", async () => {
    const declared = policy({ kind: "all", onUnsatisfied: "fail", lateArrival: "ignore" });
    const result = await runGraph(
      barrierGraph(declared, ["a", "b"]),
      {},
      {
        decision: { runId: "run-alpha", graphRevision: 1 },
        nodeExecutors: { a: () => "ok", b: () => "ok" },
      },
    );
    const decision = decisionOf(result);
    const validated = validateBarrierPolicy(declared);
    if (!validated.valid) throw new Error("policy must be valid");
    expect(decision.policyHash).toBe(decisionPolicyHash("barrier", validated.policy));
    const { decisionId, ...body } = decision;
    expect(decisionId).toBe(barrierDecisionId(
      { runId: "run-alpha", graphRevision: 1, nodeId: "gate" },
      body,
    ));
    // The same run under a different run ID recomputes a different identity.
    const forked = await runGraph(
      barrierGraph(declared, ["a", "b"]),
      {},
      {
        decision: { runId: "run-alpha-fork", graphRevision: 1 },
        nodeExecutors: { a: () => "ok", b: () => "ok" },
      },
    );
    expect(decisionOf(forked).decisionId).not.toBe(decisionId);
    expect(decisionOf(forked).policyHash).toBe(decision.policyHash);
  });

  it.each(["fail", "unknown", "human"] as const)(
    "never binds an output and never lets a descendant run for onUnsatisfied=%s",
    async (onUnsatisfied) => {
      const descendant = vi.fn(() => "must-not-run");
      const result = await runGraph(
        barrierGraph(
          policy({ kind: "all", onUnsatisfied, lateArrival: "ignore" }),
          ["a", "b"],
          { sink: true, outputFromSink: true },
        ),
        {},
        { nodeExecutors: { a: () => "ok", b: failing, sink: descendant } },
      );

      const gate = result.nodes.find((item) => item.nodeId === "gate");
      expect(gate?.status).toBe(
        { fail: "failed", unknown: "unknown", human: "awaiting_human" }[onUnsatisfied],
      );
      expect(gate?.attempts).toBe(0);
      expect(gate?.output).toBeUndefined();
      expect(result.output).toBeUndefined();
      expect(descendant).not.toHaveBeenCalled();
      expect(decisionOf(result).resolution)
        .toBe(corpus.vocabulary.resolutionByOnUnsatisfied[onUnsatisfied]);
      expect(decisionOf(result).satisfied).toBe(false);
    },
  );

  it("fails a barrier that resolves to fail with BARRIER_NOT_SATISFIED and zero attempts", async () => {
    const result = await runGraph(
      barrierGraph(
        policy({ kind: "minimum", minimum: 2, onUnsatisfied: "fail", lateArrival: "ignore" }),
        ["a", "b"],
        { sink: true, outputFromSink: true },
      ),
      {},
      { nodeExecutors: { a: () => "ok", b: failing, sink: () => "never" } },
    );
    const gate = result.nodes.find((item) => item.nodeId === "gate");
    expect(gate?.failure).toMatchObject({
      code: "BARRIER_NOT_SATISFIED",
      attempt: 0,
      retryable: false,
    });
    // Descendants inherit the existing zero-attempt UPSTREAM_FAILED terminal.
    const sink = result.nodes.find((item) => item.nodeId === "sink");
    expect(sink?.status).toBe("skipped");
    expect(sink?.failure?.code).toBe("UPSTREAM_FAILED");
    expect(result.status).toBe("failed");
  });

  it("propagates UPSTREAM_UNKNOWN without failing the run", async () => {
    // Every upstream node succeeds; only the ballots refuse, so the run holds
    // no node failure at all and `unknown` is the whole terminal story.
    const result = await runGraph(
      barrierGraph(
        policy({
          kind: "quorum",
          quorum: { accepts: 2, countAbstainAsParticipant: true },
          onUnsatisfied: "unknown",
          lateArrival: "ignore",
        }),
        ["a", "b"],
        { sink: true, outputFromSink: true },
      ),
      {},
      { nodeExecutors: { a: () => ballot("accept"), b: () => ballot("reject"), sink: () => "never" } },
    );
    const gate = result.nodes.find((item) => item.nodeId === "gate");
    expect(gate?.status).toBe("unknown");
    expect(gate?.failure).toBeUndefined();
    const sink = result.nodes.find((item) => item.nodeId === "sink");
    expect(sink?.status).toBe("skipped");
    expect(sink?.failure?.code).toBe("UPSTREAM_UNKNOWN");
    expect(sink?.attempts).toBe(0);
    // Exactly like ROUTE_NOT_SELECTED, UPSTREAM_UNKNOWN is not a graph failure.
    expect(result.failures.map((failure) => failure.code)).not.toContain("UPSTREAM_UNKNOWN");
    expect(result.failures).toEqual([]);
    expect(result.status).toBe("unknown");
  });

  it("suspends the run on a human resolution and schedules no descendant", async () => {
    const descendant = vi.fn(() => "must-not-run");
    const result = await runGraph(
      barrierGraph(
        policy({
          kind: "quorum",
          quorum: { accepts: 2, countAbstainAsParticipant: true },
          onUnsatisfied: "human",
          lateArrival: "ignore",
        }),
        ["a", "b"],
        { sink: true, outputFromSink: true },
      ),
      {},
      { nodeExecutors: { a: () => ballot("accept"), b: () => ballot("reject"), sink: descendant } },
    );
    expect(result.status).toBe("awaiting_human");
    expect(descendant).not.toHaveBeenCalled();
    expect(result.nodes.some((item) => item.nodeId === "sink")).toBe(false);
    const human = result.decisionEvents?.filter((item) => item.type === "HumanInputRequested");
    expect(human).toHaveLength(1);
    // HumanInputRequested carries the same decision document.
    expect(human?.[0]?.data).toEqual(decisionOf(result));
    const gate = result.nodes.find((item) => item.nodeId === "gate");
    expect(gate?.status).toBe("awaiting_human");
    expect(gate?.status).not.toBe("succeeded");
    expect(gate?.status).not.toBe("cancelled");
  });

  it("keeps run terminal precedence: failed outranks awaiting_human and unknown", async () => {
    expect(corpus.vocabulary.runTerminalPrecedence)
      .toEqual(["failed", "cancelled", "awaiting_human", "unknown", "succeeded"]);
    const mixed: GraphSpec = {
      apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
      kind: "Graph",
      metadata: { name: "mixed-terminals", version: "1" },
      inputSchema: {},
      outputSchema: {},
      entrypoints: ["root"],
      outputs: { result: { node: "root" } },
      nodes: [
        node("root"),
        node("a"),
        node("b"),
        node("boom"),
        node("gate-unknown", {
          kind: "barrier",
          config: policy({
            kind: "quorum",
            quorum: { accepts: 2, countAbstainAsParticipant: true },
            onUnsatisfied: "unknown",
            lateArrival: "ignore",
          }) as NodeSpec["config"],
        }),
        node("gate-human", {
          kind: "barrier",
          config: policy({
            kind: "quorum",
            quorum: { accepts: 2, countAbstainAsParticipant: true },
            onUnsatisfied: "human",
            lateArrival: "ignore",
          }) as NodeSpec["config"],
        }),
      ],
      edges: [
        { id: "root-a", from: { node: "root" }, to: { node: "a" } },
        { id: "root-b", from: { node: "root" }, to: { node: "b" } },
        { id: "root-boom", from: { node: "root" }, to: { node: "boom" } },
        { id: "a-unknown", from: { node: "a" }, to: { node: "gate-unknown", port: "a" } },
        { id: "b-unknown", from: { node: "b" }, to: { node: "gate-unknown", port: "b" } },
        { id: "a-human", from: { node: "a" }, to: { node: "gate-human", port: "a" } },
        { id: "b-human", from: { node: "b" }, to: { node: "gate-human", port: "b" } },
      ],
    } as GraphSpec;

    const withFailure = await runGraph(mixed, {}, {
      nodeExecutors: {
        a: () => ballot("accept"),
        b: () => ballot("reject"),
        boom: failing,
      },
    });
    expect(withFailure.nodes.find((item) => item.nodeId === "gate-unknown")?.status)
      .toBe("unknown");
    expect(withFailure.nodes.find((item) => item.nodeId === "gate-human")?.status)
      .toBe("awaiting_human");
    // A run with any failed node is failed even beside unknown and awaiting_human.
    expect(withFailure.status).toBe("failed");

    const withoutFailure = await runGraph(mixed, {}, {
      nodeExecutors: {
        a: () => ballot("accept"),
        b: () => ballot("reject"),
        boom: () => "ok",
      },
    });
    // awaiting_human outranks unknown once no node has failed.
    expect(withoutFailure.status).toBe("awaiting_human");
  });

  it("counts a quorum ballot rather than the upstream's success", async () => {
    const declared = policy({
      kind: "quorum",
      quorum: { accepts: 2, countAbstainAsParticipant: true },
      onUnsatisfied: "fail",
      lateArrival: "ignore",
    });
    const result = await runGraph(
      barrierGraph(declared, ["a", "b", "c"]),
      {},
      {
        nodeExecutors: {
          a: () => ballot("accept", { confidenceBasisPoints: 9000 }),
          // A node that executes correctly and returns a refutation is a
          // reject, not an acceptance. Only quorum reads the ballot.
          b: () => ballot("reject", { evidence: { note: "contradicted" } }),
          c: () => ballot("abstain"),
        },
      },
    );
    const decision = decisionOf(result);
    expect(decision).toMatchObject({
      satisfied: false,
      reasonCode: "QUORUM_NOT_MET",
      succeeded: 1,
      failed: 1,
      abstained: 1,
      acceptedIds: ["a"],
      failedIds: ["b"],
      abstainedIds: ["c"],
    });
    expect(decision.votes).toEqual([
      { sourceNodeId: "a", verdict: "accept", confidenceBasisPoints: 9000 },
      { sourceNodeId: "b", verdict: "reject", evidenceHash: expect.any(String) },
      { sourceNodeId: "c", verdict: "abstain" },
    ]);
    expect(JSON.stringify(decision)).not.toContain("contradicted");
    expect(corpus.vocabulary.verdictToDisposition.reject).toBe("failed");
  });

  it("counts the same three successes as an all barrier regardless of their values", async () => {
    // The same panel of refuters satisfies a non-quorum barrier. That silent
    // inversion is why a barrier that consumes verdicts MUST declare quorum;
    // nothing in the barrier's own text can catch it.
    const result = await runGraph(
      barrierGraph(policy({ kind: "all", onUnsatisfied: "fail", lateArrival: "ignore" }),
        ["a", "b", "c"]),
      {},
      {
        nodeExecutors: {
          a: () => ballot("reject"),
          b: () => ballot("reject"),
          c: () => ballot("reject"),
        },
      },
    );
    expect(decisionOf(result)).toMatchObject({ satisfied: true, reasonCode: "ALL_SUCCEEDED" });
    // and the non-quorum decision carries no census at all.
    expect(decisionOf(result).votes).toBeUndefined();
  });

  it("fails a malformed vote non-retryably after exactly one attempt", async () => {
    expect(corpus.vocabulary.nodeFailureCodes).toContain("INVALID_BARRIER_VOTE");
    const result = await runGraph(
      barrierGraph(
        policy({
          kind: "quorum",
          quorum: { accepts: 1, countAbstainAsParticipant: true },
          onUnsatisfied: "fail",
          lateArrival: "ignore",
        }),
        ["a", "b"],
      ),
      {},
      { nodeExecutors: { a: () => ballot("accept"), b: () => ({ verdict: "accept" }) } },
    );
    const gate = result.nodes.find((item) => item.nodeId === "gate");
    expect(gate?.status).toBe("failed");
    expect(gate?.attempts).toBe(1);
    expect(gate?.failure).toMatchObject({
      code: "INVALID_BARRIER_VOTE",
      retryable: false,
      upstreamNodeIds: ["b"],
    });
    // No disposition entry, so no decision event at all: never coerced.
    expect(result.decisionEvents).toBeUndefined();
    expect(result.status).toBe("failed");
  });

  it("arms at the first bound upstream and settles at the exact deadline boundary", async () => {
    const declared = policy({
      kind: "all",
      deadline: { afterMs: 100 },
      onUnsatisfied: "fail",
      lateArrival: "ignore",
    });
    // Arms at 10; the deadline elapses exactly at 110.
    const slow = held();
    const run = runGraph(
      barrierGraph(declared, ["a", "slow"]),
      {},
      {
        clock: createScriptedClock([10, 109, 110]),
        nodeExecutors: { a: () => "ok", slow: slow.executor },
      },
    );
    await settleAfter(30, () => slow.release());
    const result = await run;
    const decision = decisionOf(result);
    expect(decision).toMatchObject({
      armedAtMs: 10,
      decidedAtMs: 110,
      deadlineElapsed: true,
      satisfied: false,
      reasonCode: "ALL_NOT_SUCCEEDED",
      timedOut: 1,
      timedOutIds: ["slow"],
      acceptedIds: ["a"],
    });
    expect(decision.decidedAtMs as number).toBeGreaterThanOrEqual(decision.armedAtMs as number);
  });

  it("decides before the deadline with deadlineElapsed false", async () => {
    const result = await runGraph(
      barrierGraph(
        policy({
          kind: "all",
          deadline: { afterMs: 100 },
          onUnsatisfied: "fail",
          lateArrival: "ignore",
        }),
        ["a", "b"],
      ),
      {},
      {
        clock: createScriptedClock([10, 500]),
        nodeExecutors: { a: () => "ok", b: () => "ok" },
      },
    );
    const decision = decisionOf(result);
    // Complete before the deadline, even though the clock later passes it.
    expect(decision).toMatchObject({
      armedAtMs: 10,
      decidedAtMs: 10,
      deadlineElapsed: true === false,
      satisfied: true,
      timedOut: 0,
    });
  });

  it("never deadline-settles a barrier that declared no deadline", async () => {
    const slow = held();
    const clock = createScriptedClock([0, 10_000, 20_000]);
    const run = runGraph(
      barrierGraph(policy({ kind: "all", onUnsatisfied: "fail", lateArrival: "ignore" }),
        ["a", "slow"]),
      {},
      { clock, nodeExecutors: { a: () => "ok", slow: slow.executor } },
    );
    await settleAfter(30, () => slow.release("ok"));
    const result = await run;
    // No deadline, so no tick was ever pulled and nothing timed out.
    expect(clock.deliveredTicks).toBe(0);
    expect(decisionOf(result)).toMatchObject({
      armedAtMs: 0,
      decidedAtMs: 0,
      deadlineElapsed: false,
      timedOut: 0,
      satisfied: true,
    });
  });

  it("cancels an armed undecided barrier with no decision event", async () => {
    const controller = new AbortController();
    const slow = held();
    const run = runGraph(
      barrierGraph(
        policy({
          kind: "all",
          deadline: { afterMs: 1000 },
          onUnsatisfied: "fail",
          lateArrival: "ignore",
        }),
        ["a", "slow"],
        { sink: true, outputFromSink: true },
      ),
      {},
      {
        clock: createScriptedClock([0, 1]),
        signal: controller.signal,
        nodeExecutors: { a: () => "ok", slow: slow.executor, sink: () => "never" },
      },
    );
    // Abort once the barrier is armed by 'a' but still undecided, then let the
    // cooperative-but-slow upstream finish so the run can drain.
    await settleAfter(30, () => controller.abort(new Error("stop")));
    await settleAfter(30, () => slow.release("ok"));
    const result = await run;

    const gate = result.nodes.find((item) => item.nodeId === "gate");
    expect(gate?.status).toBe("cancelled");
    expect(gate?.attempts).toBe(0);
    expect(gate?.output).toBeUndefined();
    expect(gate?.failure).toBeUndefined();
    // No decision event, and never a partial decision document.
    expect(result.decisionEvents).toBeUndefined();
    expect(result.status).toBe("cancelled");
    // The cancellation terminal still propagates to descendants.
    expect(result.nodes.find((item) => item.nodeId === "sink")?.failure?.code)
      .toBe("NODE_CANCELLED");
  });

  it("keeps a committed decision immutable under lateArrival=ignore", async () => {
    const late = held();
    const declared = policy({
      kind: "minimum",
      minimum: 1,
      deadline: { afterMs: 50 },
      onUnsatisfied: "fail",
      lateArrival: "ignore",
    });
    const run = runGraph(barrierGraph(declared, ["a", "late"]), {}, {
      clock: createScriptedClock([0, 50]),
      nodeExecutors: { a: () => "ok", late: late.executor },
    });
    await settleAfter(30, () => late.release());
    const result = await run;

    const decision = decisionOf(result);
    expect(decision).toMatchObject({
      total: 2,
      succeeded: 1,
      timedOut: 1,
      timedOutIds: ["late"],
      deadlineElapsed: true,
      satisfied: true,
      reasonCode: "MINIMUM_MET",
    });
    // Exactly one decision event; the late node's own success is still recorded.
    expect(result.decisionEvents).toHaveLength(1);
    expect(result.nodes.find((item) => item.nodeId === "late")?.status).toBe("succeeded");
    expect(result.failures.map((failure) => failure.code)).not.toContain("BARRIER_LATE_ARRIVAL");
  });

  it("rejects a late arrival under lateArrival=reject", async () => {
    const late = held();
    const declared = policy({
      kind: "minimum",
      minimum: 1,
      deadline: { afterMs: 50 },
      onUnsatisfied: "fail",
      lateArrival: "reject",
    });
    const run = runGraph(barrierGraph(declared, ["a", "late"]), {}, {
      clock: createScriptedClock([0, 50]),
      nodeExecutors: { a: () => "ok", late: late.executor },
    });
    await settleAfter(30, () => late.release());
    const result = await run;

    expect(result.failures).toEqual([expect.objectContaining({
      code: "BARRIER_LATE_ARRIVAL",
      nodeId: "gate",
      upstreamNodeIds: ["late"],
      retryable: false,
    })]);
    expect(result.status).toBe("failed");
    // The decision itself is untouched.
    expect(decisionOf(result)).toMatchObject({ total: 2, timedOutIds: ["late"], satisfied: true });
    expect(result.decisionEvents).toHaveLength(1);
  });

  it("treats a route-pruned or upstream-failed arrival as missing", async () => {
    const result = await runGraph(
      barrierGraph(
        policy({
          kind: "quorum",
          quorum: { accepts: 1, countAbstainAsParticipant: true },
          onUnsatisfied: "unknown",
          lateArrival: "ignore",
        }),
        ["a", "broken"],
      ),
      {},
      { nodeExecutors: { a: () => ballot("accept"), broken: failing } },
    );
    const decision = decisionOf(result);
    // The failed upstream cast no ballot at all, so its census record is
    // not-cast even though its disposition is `failed`.
    expect(decision).toMatchObject({ failed: 1, failedIds: ["broken"], succeeded: 1 });
    expect(decision.votes).toEqual([
      { sourceNodeId: "a", verdict: "accept" },
      { sourceNodeId: "broken", verdict: "not-cast" },
    ]);
    expect(decision.satisfied).toBe(true);
  });

  it("keeps the incoming-edge declaration order of the compiled graph", async () => {
    // Edge IDs sort in the opposite order to their declaration, so an
    // implementation that reused the scheduler's edge-ID ordering would fail.
    const document = barrierGraph(
      policy({ kind: "all", onUnsatisfied: "fail", lateArrival: "ignore" }),
      ["zeta", "alpha"],
    );
    const result = await runGraph(document, {}, {
      nodeExecutors: { zeta: () => "ok", alpha: () => "ok" },
    });
    expect(document.edges.filter((edge) => edge.to.node === "gate").map((edge) => edge.id))
      .toEqual(["zeta-gate", "alpha-gate"]);
    expect(decisionOf(result).acceptedIds).toEqual(["zeta", "alpha"]);
  });

  it("keeps a pre-contract barrier config on its published path", async () => {
    const document = barrierGraph({ condition: "all" }, ["a", "b"]);
    const executor = vi.fn(({ input }) => input);
    const result = await runGraph(document, {}, {
      nodeExecutors: { a: () => "ok", b: () => "ok", gate: executor },
    });
    // Unclaimed configs are not integrated barriers: the ordinary executor runs
    // and no decision is committed.
    expect(executor).toHaveBeenCalledTimes(1);
    expect(result.decisionEvents).toBeUndefined();
    expect(result.status).toBe("succeeded");
  });

  it("reaches every corpus evaluation shape end to end for the exercised kinds", async () => {
    // Drive the scheduler from corpus cases whose arrivals are all reproducible
    // with deterministic executors, and compare the policy-decided members of
    // the committed document with the corpus expectation verbatim.
    const threshold = (item: EvaluationCase): number => {
      const quorum = item.policy.quorum as { accepts?: number } | undefined;
      return (item.policy.minimum as number | undefined) ?? quorum?.accepts ?? 0;
    };
    const reproducible = corpus.evaluationCases.filter((item) =>
      item.dispositions.length > 0 &&
      // GE1424 rejects a threshold above the incoming-edge count at compile
      // time, so those cases are unreachable through a real graph by design.
      threshold(item) <= item.dispositions.length &&
      item.dispositions.every((entry) =>
        entry.disposition === "succeeded" || entry.disposition === "failed" ||
        entry.disposition === "abstained" || entry.disposition === "unknown"
          ? item.policy.kind !== "quorum" || entry.vote !== undefined
          : false));
    expect(reproducible.length).toBeGreaterThan(10);

    for (const evaluationCase of reproducible) {
      const sourceIds = evaluationCase.dispositions.map((entry) => entry.sourceNodeId);
      const executors: Record<string, NodeExecutor> = {};
      for (const entry of evaluationCase.dispositions) {
        executors[entry.sourceNodeId] = entry.vote === undefined
          ? (entry.disposition === "succeeded"
            ? () => "ok"
            : failing)
          : () => entry.vote as never;
      }
      const result = await runGraph(
        barrierGraph(evaluationCase.policy, sourceIds),
        {},
        { nodeExecutors: executors },
      );
      const decision = decisionOf(result);
      const {
        policyHash: _policyHash,
        decisionId: _decisionId,
        armedAtMs: _armedAtMs,
        decidedAtMs: _decidedAtMs,
        ...core
      } = decision;
      expect(core, evaluationCase.name).toEqual(evaluationCase.expect);
    }
  });
});
