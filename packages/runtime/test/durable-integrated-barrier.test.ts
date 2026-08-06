import type { GraphSpec, NodeSpec } from "@graph-engineering/core";
import type { GraphEventV1Alpha2 } from "@graph-engineering/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  createScriptedClock,
  decodeDurableJson,
  encodeDurableJson,
  runGraph,
  resumeDurableGraphRun,
  startDurableGraphRun,
  type DurableNodeExecutor,
  type JsonValue,
  type NodeExecutor,
  type RecoveredEvent,
} from "../src/index.js";
import {
  commitThenThrow,
  forgeHistory,
  memoryProtection,
  persistedHistory,
  recoveredHistory,
} from "./support/protected-durable.js";

const BARRIER_API = "graphengineering.reacher-z.github.io/barrier/v1alpha1";

function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return {
    id,
    kind: "transform",
    inputSchema: {},
    outputSchema: {},
    config: {},
    sideEffects: "none",
    ...overrides,
  } as NodeSpec;
}

/** root fans out to a and b; both feed the gate; the gate feeds the sink. */
function gateGraph(gateConfig: Readonly<Record<string, unknown>>): GraphSpec {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "durable-integrated-barrier", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: { result: { node: "sink" } },
    nodes: [
      node("root"),
      node("a"),
      node("b"),
      node("gate", { kind: "barrier", config: gateConfig as NodeSpec["config"] }),
      node("sink"),
    ],
    edges: [
      { id: "root-a", from: { node: "root" }, to: { node: "a" } },
      { id: "root-b", from: { node: "root" }, to: { node: "b" } },
      { id: "a-gate", from: { node: "a" }, to: { node: "gate" } },
      { id: "b-gate", from: { node: "b" }, to: { node: "gate" } },
      { id: "gate-sink", from: { node: "gate" }, to: { node: "sink" } },
    ],
  } as GraphSpec;
}

const ALL_FAIL = Object.freeze({
  apiVersion: BARRIER_API,
  kind: "all",
  onUnsatisfied: "fail",
  lateArrival: "ignore",
});

function quorumConfig(onUnsatisfied: "fail" | "unknown" | "human"): Record<string, unknown> {
  return {
    apiVersion: BARRIER_API,
    kind: "quorum",
    quorum: { accepts: 2, countAbstainAsParticipant: true },
    onUnsatisfied,
    lateArrival: "ignore",
  };
}

function vote(verdict: string): JsonValue {
  return {
    apiVersion: BARRIER_API,
    kind: "BarrierVote",
    verdict,
    confidenceBasisPoints: 9000,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

async function wire(
  protection: ReturnType<typeof memoryProtection>,
  runId: string,
): Promise<GraphEventV1Alpha2[]> {
  return persistedHistory(protection, runId);
}

describe("durable integrated barriers", () => {
  it("journals BarrierSatisfied as a protected-ref record whose inline projection matches the document", async () => {
    const protection = memoryProtection();
    const runId = "durable-barrier-wire";
    const result = await startDurableGraphRun(gateGraph(ALL_FAIL), {}, {
      runId,
      implementationId: "v1",
      protection,
      executors: { transform: (({ input }) => input) as DurableNodeExecutor },
    });

    expect(result.status).toBe("succeeded");
    const events = await wire(protection, runId);
    const satisfied = events.filter((event) => event.type === "BarrierSatisfied");
    expect(satisfied).toHaveLength(1);
    const envelope = satisfied[0] as GraphEventV1Alpha2;
    expect(envelope.payloadDisposition).toBe("protected-ref");
    expect(envelope.nodeId).toBe("gate");
    expect(envelope.attempt).toBeUndefined();
    expect(envelope.edgeId).toBeUndefined();
    expect(Object.keys(envelope.data).sort()).toEqual([
      "decisionId", "decisionMac", "decisionRef", "policyHash", "resolution", "satisfied",
    ]);
    // The raw decision document never appears inline; only the reference does.
    expect(record(envelope.data)["decision"]).toBeUndefined();
    expect(record(record(envelope.data)["decisionRef"])["valueMac"])
      .toBe(record(envelope.data)["decisionMac"]);

    // The recovered document agrees with the closed inline projection and with
    // the barrier node's bound output.
    const recovered = await recoveredHistory(protection, runId);
    const decisionEvent = recovered.find((event) => event.type === "BarrierSatisfied");
    const document = record(decodeDurableJson(record(decisionEvent?.data)["decision"]));
    expect(document["barrierNodeId"]).toBe("gate");
    expect(document["policyHash"]).toBe(record(envelope.data)["policyHash"]);
    expect(document["decisionId"]).toBe(record(envelope.data)["decisionId"]);
    expect(document["satisfied"]).toBe(true);
    expect(document["resolution"]).toBe("satisfied");
    const gate = result.nodes.find((item) => item.nodeId === "gate");
    expect(gate?.output).toEqual(document);
    expect(result.decisionEvents?.map((event) => event.type)).toEqual(["BarrierSatisfied"]);
    expect(result.decisionEvents?.[0]?.data).toEqual(document);
  });

  it("commits the same decision document ordinarily and durably for the same graph and votes", async () => {
    const runId = "barrier-parity";
    const graph = gateGraph(quorumConfig("fail"));
    const returns: Record<string, JsonValue> = {
      root: {},
      a: vote("accept"),
      b: vote("accept"),
      sink: "done",
    };
    const ordinaryExecutors = Object.fromEntries(Object.entries(returns).map(
      ([id, value]) => [id, (() => value) as NodeExecutor],
    ));
    const durableExecutors = Object.fromEntries(Object.entries(returns).map(
      ([id, value]) => [id, (() => value) as DurableNodeExecutor],
    ));

    const ordinary = await runGraph(graph, {}, {
      nodeExecutors: ordinaryExecutors,
      // The durable path frames every decision over its run identity and the
      // fixed durable graph revision; the ordinary run adopts the same frame.
      decision: { runId, graphRevision: 1 },
    });
    const durable = await startDurableGraphRun(graph, {}, {
      runId,
      implementationId: "v1",
      protection: memoryProtection(),
      nodeExecutors: durableExecutors,
    });

    expect(ordinary.status).toBe("succeeded");
    expect(durable.status).toBe("succeeded");
    const ordinaryGate = ordinary.nodes.find((item) => item.nodeId === "gate");
    const durableGate = durable.nodes.find((item) => item.nodeId === "gate");
    // Byte-for-byte parity of the frozen decision document, identity included:
    // same policyHash, same domain-separated decisionId, same census.
    expect(durableGate?.output).toEqual(ordinaryGate?.output);
    expect(durable.decisionEvents).toEqual(ordinary.decisionEvents);
    const document = record(ordinaryGate?.output);
    expect(document["reasonCode"]).toBe("QUORUM_MET");
    expect((document["votes"] as unknown[]).length).toBe(2);
  });

  it("forwards the injected clock to the barrier decision", async () => {
    const result = await startDurableGraphRun(gateGraph(ALL_FAIL), {}, {
      runId: "barrier-clock",
      implementationId: "v1",
      protection: memoryProtection(),
      executors: { transform: (({ input }) => input) as DurableNodeExecutor },
      clock: createScriptedClock([7]),
    });
    const document = record(result.nodes.find((item) => item.nodeId === "gate")?.output);
    // The frozen default clock would observe 0; the scripted clock proves the
    // durable options actually reach the scheduler.
    expect(document["armedAtMs"]).toBe(7);
    expect(document["decidedAtMs"]).toBe(7);
  });

  describe("zero-rejudge resume", () => {
    /**
     * A run that loses its process immediately after the BarrierSatisfied
     * commit: the decision is durable, the barrier settlement and everything
     * after it are not.
     */
    async function crashedAfterDecision(runId: string): Promise<{
      protection: ReturnType<typeof memoryProtection>;
      recovered: RecoveredEvent[];
    }> {
      const base = memoryProtection();
      const crashing = commitThenThrow(base, (batch) =>
        batch.at(-1)?.type === "BarrierSatisfied");
      await expect(startDurableGraphRun(gateGraph(ALL_FAIL), {}, {
        runId,
        implementationId: "v1",
        protection: crashing,
        executors: { transform: (({ input }) => input) as DurableNodeExecutor },
      })).rejects.toMatchObject({ name: "DurableRunError", code: "DURABILITY_STORE_FAILED" });
      const recovered = await recoveredHistory(base, runId);
      expect(recovered.at(-1)?.type).toBe("BarrierSatisfied");
      return { protection: base, recovered };
    }

    it("adopts the committed decision with zero executor calls and zero new decision events", async () => {
      const runId = "barrier-zero-rejudge";
      const { protection, recovered } = await crashedAfterDecision(runId);
      const committedDocument = record(decodeDurableJson(
        record(recovered.at(-1)?.data)["decision"],
      ));

      const upstream = vi.fn(() => "never-again");
      const barrier = vi.fn(() => "never");
      const sink = vi.fn(() => "resumed");
      const result = await resumeDurableGraphRun(gateGraph(ALL_FAIL), {
        runId,
        implementationId: "v1",
        protection,
        nodeExecutors: { root: upstream, a: upstream, b: upstream, gate: barrier, sink },
      });

      expect(result.status).toBe("succeeded");
      // Zero rejudge: the decided barrier and its settled upstreams are never
      // re-evaluated, and only the one unfinished descendant runs.
      expect(upstream).not.toHaveBeenCalled();
      expect(barrier).not.toHaveBeenCalled();
      expect(sink).toHaveBeenCalledTimes(1);
      // The adopted decision is not a new decision, so the resumed run reports
      // none — mirroring adoptCommittedDecisions on the ordinary scheduler.
      expect(result.decisionEvents).toBeUndefined();
      const gate = result.nodes.find((item) => item.nodeId === "gate");
      expect(gate?.attempts).toBe(0);
      expect(gate?.output).toEqual(committedDocument);
      // No second BarrierSatisfied was appended.
      const events = await wire(protection, runId);
      expect(events.filter((event) => event.type === "BarrierSatisfied")).toHaveLength(1);
      expect(events.at(-1)?.type).toBe("RunSucceeded");
    });

    it("fails closed on a tampered decision document: DECISION_IDENTITY_MISMATCH at the adoption layer", async () => {
      const runId = "barrier-tampered-document";
      const { recovered } = await crashedAfterDecision(runId);
      // Forge a coherent history whose protected document was altered after
      // the fact: the inline projection, MACs and ciphertext are all honestly
      // recomputed for the tampered value, so neither the schema nor the
      // envelope MAC layer can object. What cannot be recomputed without the
      // scheduler is the domain-separated decisionId, which still names the
      // original document.
      const tampered = recovered.map((event) => {
        if (event.type !== "BarrierSatisfied") return event;
        const document = record(decodeDurableJson(record(event.data)["decision"]));
        return {
          ...event,
          data: {
            ...event.data,
            decision: encodeDurableJson({
              ...document,
              decidedAtMs: (document["decidedAtMs"] as number) + 1,
            }),
          },
        };
      });
      const forged = await forgeHistory(runId, tampered);

      const executor = vi.fn(() => "never");
      const result = await resumeDurableGraphRun(gateGraph(ALL_FAIL), {
        runId,
        implementationId: "v1",
        protection: forged,
        executors: { transform: executor, barrier: executor },
      });

      // The layer that catches it is zero-rejudge adoption
      // (`adoptCommittedDecisions` inside the scheduler): it recomputes the
      // decision identity from the adopted document and the run identity, and
      // refuses the mismatch as a non-retryable run failure with no executor
      // call and no re-judgement.
      expect(result.status).toBe("failed");
      expect(result.nodes).toEqual([]);
      expect(result.failures).toEqual([expect.objectContaining({
        code: "DECISION_IDENTITY_MISMATCH",
        nodeId: "gate",
        retryable: false,
      })]);
      expect(executor).not.toHaveBeenCalled();
    });

    it("fails closed on tampered inline metadata: the fold rejects the contradiction", async () => {
      const runId = "barrier-tampered-inline";
      const { recovered } = await crashedAfterDecision(runId);
      // Flip only the caller-asserted inline `satisfied` and leave the
      // protected document alone. This never reaches adoption: the history
      // fold layer catches the closed projection contradicting the protected
      // decision and refuses the whole history.
      const tampered = recovered.map((event) =>
        event.type === "BarrierSatisfied"
          ? { ...event, data: { ...event.data, satisfied: false } }
          : event);
      const forged = await forgeHistory(runId, tampered);

      await expect(resumeDurableGraphRun(gateGraph(ALL_FAIL), {
        runId,
        implementationId: "v1",
        protection: forged,
        executors: { transform: (() => "never") as DurableNodeExecutor },
      })).rejects.toMatchObject({
        name: "DurableRunError",
        code: "INVALID_RUN_HISTORY",
        message: expect.stringContaining("contradicts its protected decision"),
      });
    });
  });

  describe("resolutions the frozen envelope cannot fully represent", () => {
    const voteExecutors = (bVerdict: string): Record<string, DurableNodeExecutor> => ({
      root: () => ({}),
      a: () => vote("accept"),
      b: () => vote(bVerdict),
      sink: () => "never",
    });

    it("suspends an awaiting_human run with the decision durable and no terminal event", async () => {
      const protection = memoryProtection();
      const runId = "barrier-awaiting-human";
      const graph = gateGraph(quorumConfig("human"));
      const started = await startDurableGraphRun(graph, {}, {
        runId,
        implementationId: "v1",
        protection,
        nodeExecutors: voteExecutors("reject"),
      });

      expect(started.status).toBe("awaiting_human");
      expect(started.decisionEvents?.map((event) => event.type))
        .toEqual(["BarrierSatisfied", "HumanInputRequested"]);
      const events = await wire(protection, runId);
      // The committed decision is durable; the stream is deliberately left
      // non-terminal because the run is suspended, not finished, and the
      // authority that may resume it past the gate is D9-APPROVAL-077 work.
      expect(events.at(-1)?.type).toBe("BarrierSatisfied");

      const executor = vi.fn(() => "never");
      const resumed = await resumeDurableGraphRun(graph, {
        runId,
        implementationId: "v1",
        protection,
        executors: { transform: executor, barrier: executor },
      });
      expect(resumed.status).toBe("awaiting_human");
      expect(resumed.decisionEvents).toBeUndefined();
      expect(executor).not.toHaveBeenCalled();
      const after = await wire(protection, runId);
      expect(after.filter((event) => event.type === "BarrierSatisfied")).toHaveLength(1);
      expect(after.at(-1)?.type).toBe("RunResumed");
    });

    it("fails closed on an unknown run terminal instead of misfiling it", async () => {
      const protection = memoryProtection();
      const runId = "barrier-unknown-terminal";
      await expect(startDurableGraphRun(gateGraph(quorumConfig("unknown")), {}, {
        runId,
        implementationId: "v1",
        protection,
        nodeExecutors: voteExecutors("reject"),
      })).rejects.toMatchObject({
        name: "DurableRunError",
        code: "UNREPRESENTABLE_DURABLE_OUTCOME",
      });
      // Everything committed before the refusal is true history: the decision
      // and the descendant's UPSTREAM_UNKNOWN settlement, and no terminal.
      const events = await wire(protection, runId);
      expect(events.filter((event) => event.type === "BarrierSatisfied")).toHaveLength(1);
      const settled = events.find((event) => event.type === "NodeSettledWithoutAttempt" &&
        event.nodeId === "sink");
      expect(record(settled?.data)["failureCode"]).toBe("UPSTREAM_UNKNOWN");
      expect(["RunSucceeded", "RunFailed", "RunCancelled"])
        .not.toContain(events.at(-1)?.type);
    });

    it("fails closed on a malformed quorum vote instead of misfiling the settlement", async () => {
      const protection = memoryProtection();
      const runId = "barrier-malformed-vote";
      await expect(startDurableGraphRun(gateGraph(quorumConfig("fail")), {}, {
        runId,
        implementationId: "v1",
        protection,
        // Neither upstream produces a ballot, which the ordinary scheduler
        // settles as INVALID_BARRIER_VOTE after exactly one attempt — a shape
        // outside the closed settledFailureCode enum.
        executors: { transform: (({ input }) => input) as DurableNodeExecutor },
      })).rejects.toMatchObject({
        name: "DurableRunError",
        code: "UNREPRESENTABLE_DURABLE_OUTCOME",
      });
      const events = await wire(protection, runId);
      expect(events.some((event) => event.type === "BarrierSatisfied")).toBe(false);
      expect(events.some((event) => event.type === "NodeSettledWithoutAttempt" &&
        event.nodeId === "gate")).toBe(false);
    });
  });
});
