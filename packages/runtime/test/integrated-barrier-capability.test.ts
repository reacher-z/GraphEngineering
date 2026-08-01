import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  INTEGRATED_BARRIER_API_VERSION,
  claimsIntegratedBarrierPolicy,
  compileGraph,
  type GraphSpec,
} from "@graph-engineering/core";
import type { GraphEventV1Alpha2 } from "@graph-engineering/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  resumeDurableGraphRun,
  runGraph,
  startDurableGraphRun,
  type DurablePayloadProtection,
  type GuardedDurableJournal,
} from "../src/index.js";
import { memoryProtection } from "./support/protected-durable.js";

/**
 * Protection whose guarded journal explodes on any use. The capability
 * preflight must complete before anything touches it.
 */
function hostileProtection(
  journal: Pick<GuardedDurableJournal, "read" | "append">,
): DurablePayloadProtection {
  const base = memoryProtection();
  return {
    ...base,
    journal: {
      sink: base.journal.sink,
      binding: base.journal.binding,
      ...journal,
    } as GuardedDurableJournal,
  };
}
import {
  INTEGRATED_BARRIER_CAPABILITY,
  graphRuntimeCapabilityIssues,
  runtimeCapabilityMessage,
} from "../src/runtime-capabilities.js";
import { runGraphWithJournal, type SchedulerJournal } from "../src/scheduler.js";

interface PolicyCase {
  readonly name: string;
  readonly config: unknown;
  readonly expect: { readonly valid: boolean; readonly claimed: boolean };
}

interface OwnershipCase {
  readonly name: string;
  readonly config: unknown;
  readonly expect: { readonly claimed: boolean };
}

interface CompilerCase {
  readonly name: string;
  readonly graphHash: string;
  readonly expectValid: boolean;
  readonly graph: GraphSpec;
}

interface BarrierCorpus {
  readonly claims: { readonly capabilityGateClaim: boolean };
  readonly policyCases: readonly PolicyCase[];
  readonly ownershipCases: readonly OwnershipCase[];
  readonly compilerCases: readonly CompilerCase[];
}

const corpus = JSON.parse(readFileSync(
  fileURLToPath(new URL("../../../spec/conformance/integrated-barrier.case.json", import.meta.url)),
  "utf8",
)) as BarrierCorpus;

function compilerCase(name: string): CompilerCase {
  const found = corpus.compilerCases.find((item) => item.name === name);
  if (found === undefined) throw new Error(`missing compiler case '${name}'`);
  return found;
}

/** The corpus graph whose three barriers all carry exact policies. */
const multiBarrierGraph = compilerCase(
  "valid-multi-barrier-graph-emits-no-barrier-diagnostics",
).graph;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function spyingJournal(): SchedulerJournal & Record<string, ReturnType<typeof vi.fn>> {
  return {
    beforeAttempt: vi.fn(),
    attemptFailed: vi.fn(),
    nodeSucceeded: vi.fn(),
    nodeSettledWithoutAttempt: vi.fn(),
    runTerminal: vi.fn(),
  } as unknown as SchedulerJournal & Record<string, ReturnType<typeof vi.fn>>;
}

function expectedFailures(graph: GraphSpec): readonly Readonly<Record<string, unknown>>[] {
  return graph.nodes.flatMap((node, index) => node.kind !== "barrier" ? [] : [{
    phase: "execute",
    nodeId: node.id,
    code: "UNSUPPORTED_RUNTIME_CAPABILITY",
    message: runtimeCapabilityMessage({
      ownerNodeId: node.id,
      capability: INTEGRATED_BARRIER_CAPABILITY,
      path: `#/nodes/${index}/config`,
    }),
    attempt: 0,
    retryable: false,
  }]);
}

describe("integrated barrier durable capability gate", () => {
  it("keeps the corpus capability-gate claim false for this tranche", () => {
    expect(corpus.claims.capabilityGateClaim).toBe(false);
  });

  it("refuses every barrier node whose config claims an exact policy", () => {
    // Drive the gate from the corpus's own valid policy configs rather than a
    // hand-written policy list.
    const valid = corpus.policyCases.filter((item) => item.expect.valid);
    expect(valid.length).toBeGreaterThan(0);
    for (const policyCase of valid) {
      expect(policyCase.expect.claimed, policyCase.name).toBe(true);
      const document = clone(multiBarrierGraph);
      for (const node of document.nodes) {
        if (node.kind === "barrier") node.config = policyCase.config;
      }
      // The policy itself is exact, so the compiler raises no shape or kind
      // diagnostic. A threshold above this graph's two incoming edges is still
      // GE1424, which is a cardinality fact about the graph, not the policy.
      expect(
        compileGraph(document).diagnostics
          .map((item) => item.code)
          .filter((code) => code !== "GE1424_BARRIER_THRESHOLD_EXCEEDS_INPUTS"),
        policyCase.name,
      ).toEqual([]);
      expect(
        graphRuntimeCapabilityIssues(document).map((issue) => issue.capability),
        policyCase.name,
      ).toEqual(["gate-all", "gate-quorum", "gate-percentage"].map(
        () => INTEGRATED_BARRIER_CAPABILITY,
      ));
    }
  });

  it("keys the gate on the ownership claim, not on the policy shape", () => {
    // Every corpus ownership case, on the same graph: claimed configs are
    // refused under the barrier capability, unclaimed configs never are.
    for (const ownershipCase of corpus.ownershipCases) {
      const document = clone(multiBarrierGraph);
      for (const node of document.nodes) {
        if (node.kind === "barrier") node.config = ownershipCase.config;
      }
      expect(claimsIntegratedBarrierPolicy(ownershipCase.config), ownershipCase.name)
        .toBe(ownershipCase.expect.claimed);
      const barrierCapabilities = graphRuntimeCapabilityIssues(document)
        .filter((issue) => issue.capability === INTEGRATED_BARRIER_CAPABILITY);
      expect(barrierCapabilities.length > 0, ownershipCase.name)
        .toBe(ownershipCase.expect.claimed);
    }
  });

  it("refuses a claimed policy whose body is not yet a valid policy", () => {
    // The gate must not depend on the body validating: a claimed carrier this
    // runtime cannot execute is refused even before the compiler diagnoses it.
    const document = clone(multiBarrierGraph);
    for (const node of document.nodes) {
      if (node.kind === "barrier") {
        node.config = { apiVersion: INTEGRATED_BARRIER_API_VERSION, kind: "minimum" };
      }
    }
    expect(graphRuntimeCapabilityIssues(document).map((issue) => issue.capability))
      .toEqual([
        INTEGRATED_BARRIER_CAPABILITY,
        INTEGRATED_BARRIER_CAPABILITY,
        INTEGRATED_BARRIER_CAPABILITY,
      ]);
  });

  it("groups refusals in node declaration order", () => {
    expect(graphRuntimeCapabilityIssues(multiBarrierGraph)).toEqual([
      { ownerNodeId: "gate-all", capability: INTEGRATED_BARRIER_CAPABILITY, path: "#/nodes/3/config" },
      { ownerNodeId: "gate-quorum", capability: INTEGRATED_BARRIER_CAPABILITY, path: "#/nodes/4/config" },
      { ownerNodeId: "gate-percentage", capability: INTEGRATED_BARRIER_CAPABILITY, path: "#/nodes/5/config" },
    ]);
  });

  it("keeps the gate closed for the entry point that does not implement it", () => {
    // The ordinary scheduler now decides integrated barriers, so it opts in.
    // The durable scheduler does not journal BarrierSatisfied yet, so it keeps
    // refusing under the same capability name and the default stays closed.
    expect(graphRuntimeCapabilityIssues(multiBarrierGraph, { integratedBarrier: true }))
      .toEqual([]);
    for (const options of [undefined, {}, { integratedBarrier: false }]) {
      expect(
        graphRuntimeCapabilityIssues(multiBarrierGraph, options).map((issue) => issue.capability),
        JSON.stringify(options ?? null),
      ).toEqual([
        INTEGRATED_BARRIER_CAPABILITY,
        INTEGRATED_BARRIER_CAPABILITY,
        INTEGRATED_BARRIER_CAPABILITY,
      ]);
    }
  });

  it("never calls a barrier executor now that the scheduler owns the decision", async () => {
    const executor = vi.fn(() => "never");
    const journal = spyingJournal();
    const nodeExecutors = Object.fromEntries(
      multiBarrierGraph.nodes
        .filter((node) => node.kind === "barrier")
        .map((node) => [node.id, executor]),
    );

    const result = await runGraphWithJournal(
      multiBarrierGraph,
      {},
      { nodeExecutors, executors: { barrier: executor }, journal },
    );

    // A barrier is decided with zero executor attempts whatever the outcome, so
    // a registered barrier executor is never reached.
    expect(executor).not.toHaveBeenCalled();
    expect(result.failures.map((failure) => failure.code))
      .not.toContain("UNSUPPORTED_RUNTIME_CAPABILITY");
    expect(vi.mocked(journal.beforeAttempt).mock.calls
      .map((call) => (call[0] as { node: { id: string } }).node.id))
      .not.toEqual(expect.arrayContaining(["gate-all", "gate-quorum", "gate-percentage"]));
  });

  it("does not inspect externally supplied graph input before refusing", async () => {
    const executor = vi.fn(() => "never");
    const hostileInput = new Proxy({}, {
      ownKeys: () => {
        throw new Error("graph input must not be inspected during capability preflight");
      },
    });

    // The gated durable path still refuses without ever touching the input.
    const result = await startDurableGraphRun(multiBarrierGraph, hostileInput, {
      runId: "integrated-barrier-hostile-input",
      implementationId: "v1",
      protection: hostileProtection({
        read: () => {
          throw new Error("event journal read must not run during capability preflight");
        },
        append: async () => {
          throw new Error("event journal append must not run during capability preflight");
        },
      }),
      executors: { transform: executor, barrier: executor },
    });

    expect(result.status).toBe("failed");
    expect(result.failures).toEqual(expectedFailures(multiBarrierGraph));
    expect(executor).not.toHaveBeenCalled();
  });

  it("fails durable start and resume with no history read, append or other store call", async () => {
    const read = vi.fn((): AsyncIterable<GraphEventV1Alpha2> => {
      throw new Error("event journal read must not run during capability preflight");
    });
    const append = vi.fn(async (): Promise<number> => {
      throw new Error("event store append must not run during capability preflight");
    });
    const executor = vi.fn(() => "never");
    const options = {
      runId: "integrated-barrier-capability",
      implementationId: "v1",
      protection: hostileProtection({ read, append }),
      executors: { transform: executor, barrier: executor },
    };

    const started = await startDurableGraphRun(multiBarrierGraph, {}, options);
    const resumed = await resumeDurableGraphRun(multiBarrierGraph, options);

    for (const result of [started, resumed]) {
      expect(result.status).toBe("failed");
      expect(result.nodes).toEqual([]);
      expect(result.totalAttempts).toBe(0);
      expect(result.maxObservedConcurrency).toBe(0);
      expect(result.failures).toEqual(expectedFailures(multiBarrierGraph));
    }
    expect(started).toEqual(resumed);
    expect(read).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
  });

  it("keeps the published barrier capability names for unclaimed configs", () => {
    // The pre-contract static all-success join still executes.
    const supported = clone(multiBarrierGraph);
    for (const node of supported.nodes) {
      if (node.kind === "barrier") node.config = { condition: "all" };
    }
    expect(compileGraph(supported).valid).toBe(true);
    expect(graphRuntimeCapabilityIssues(supported)).toEqual([]);

    // A pre-contract config this runtime cannot execute keeps its published
    // `node-config:barrier` name and must not be relabelled by this tranche.
    const legacy = clone(multiBarrierGraph);
    for (const node of legacy.nodes) {
      if (node.kind === "barrier") node.config = { condition: "minimum", minimum: 1 };
    }
    expect(compileGraph(legacy).valid).toBe(true);
    expect(graphRuntimeCapabilityIssues(legacy).map((issue) => issue.capability))
      .toEqual(["node-config:barrier", "node-config:barrier", "node-config:barrier"]);

    // An exact policy body without the discriminator is unowned, so it takes the
    // legacy path too rather than the barrier capability.
    const unowned = clone(multiBarrierGraph);
    for (const node of unowned.nodes) {
      if (node.kind === "barrier") {
        node.config = { kind: "minimum", minimum: 2, onUnsatisfied: "fail", lateArrival: "ignore" };
      }
    }
    expect(compileGraph(unowned).valid).toBe(true);
    expect(graphRuntimeCapabilityIssues(unowned).map((issue) => issue.capability))
      .toEqual(["node-config:barrier", "node-config:barrier", "node-config:barrier"]);
  });

  it("never executes an exact policy as an identity transform", async () => {
    // A quorum policy has no pure evaluator at all; executing it as an identity
    // transform would silently pass an unsatisfied barrier. The scheduler now
    // decides it instead, and an unsatisfied quorum is still not a success.
    const document = clone(multiBarrierGraph);
    const gate = document.nodes.find((node) => node.id === "gate-quorum");
    expect(gate?.config).toMatchObject({ kind: "quorum" });
    const barrierExecutor = vi.fn(() => "never");
    const result = await runGraph(document, {}, {
      executors: { barrier: barrierExecutor },
    });
    expect(barrierExecutor).not.toHaveBeenCalled();
    const quorum = result.nodes.find((node) => node.nodeId === "gate-quorum");
    expect(quorum?.status).not.toBe("succeeded");
    expect(quorum?.output).toBeUndefined();
    // The upstream transforms produce no ballot, so the quorum barrier fails
    // non-retryably after exactly one attempt rather than coercing a verdict.
    expect(quorum?.failure?.code).toBe("INVALID_BARRIER_VOTE");
    expect(quorum?.attempts).toBe(1);
    expect(quorum?.failure?.retryable).toBe(false);
    expect(result.status).not.toBe("succeeded");
  });
});
