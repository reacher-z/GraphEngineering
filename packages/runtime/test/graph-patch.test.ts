import { readFileSync } from "node:fs";
import * as core from "@graph-engineering/core";
import {
  compileGraph,
  type EdgeSpec,
  type GraphSpec,
  type NodeSpec,
} from "@graph-engineering/core";
import { describe, expect, it } from "vitest";
import { exerciseGraphPatchHostileShapeCampaign } from "../../../tools/conformance/graph_patch_hostile_shape.mjs";
import { exerciseGraphPatchHostileSemanticCampaign } from "../../../tools/conformance/graph_patch_hostile_semantic.mjs";
import * as runtime from "../src/index.js";
import {
  CycleControllerError,
  graphRevision as createGraphRevision,
  NativeGraphPatchApplier,
  validateGraphPatchShape,
  type CycleAuthoritySnapshot,
  type CycleGraphCoordinate,
  type GraphPatch,
  type GraphPatchApplication,
  type GraphPatchApplyContext,
} from "../src/index.js";

const H = {
  revision: "1".repeat(64),
  identity: "a".repeat(64),
  policy: "b".repeat(64),
};

function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return {
    id,
    kind: "transform",
    inputSchema: {},
    outputSchema: {},
    config: {},
    sideEffects: "none",
    ...overrides,
  };
}

function graph(): GraphSpec {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "patch-test", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["root"],
    outputs: { result: { node: "root" } },
    nodes: [node("root")],
    edges: [],
  };
}

function coordinate(value: GraphSpec = graph()): CycleGraphCoordinate {
  const compiled = compileGraph(value);
  if (!compiled.valid || compiled.graphHash === null) throw new TypeError("test graph did not compile");
  return { graphRevision: 1, graphHash: compiled.graphHash, revisionHash: H.revision };
}

function authority(): CycleAuthoritySnapshot {
  return {
    proposerActivityKey: H.identity,
    principalHash: H.identity,
    proposerGrantHash: H.identity,
    runGrantHash: H.identity,
    tenantGrantHash: H.identity,
    deploymentGrantHash: H.identity,
    effectiveGrantHash: H.identity,
    policyHash: H.policy,
    approvalHash: null,
  };
}

function context(overrides: Partial<GraphPatchApplyContext> = {}): GraphPatchApplyContext {
  return {
    authoritySnapshot: authority(),
    policySnapshotHash: H.policy,
    reservationId: "round-1",
    reserved: { attempts: 1, costUsd: 2, dynamicNodes: 4 },
    activityUsage: { attempts: 1, costUsd: 1 },
    durationMs: 10,
    deadlineMsRemaining: 100,
    effectiveCapabilities: [],
    succeededNodeIds: ["root", "child-1", "child-2"],
    supportedEdgeModes: ["value"],
    ...overrides,
  };
}

function patch(
  base: CycleGraphCoordinate,
  patchId: string,
  childId: string,
  overrides: {
    readonly node?: NodeSpec;
    readonly edges?: readonly EdgeSpec[];
    readonly outputs?: GraphSpec["outputs"];
  } = {},
): GraphPatch {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
    kind: "GraphPatch",
    patchId,
    base,
    append: {
      nodes: [overrides.node ?? node(childId)],
      edges: overrides.edges ?? [{
        id: `${patchId}-edge`,
        from: { node: "root" },
        to: { node: childId },
        mode: "value",
      }],
      outputs: overrides.outputs ?? { [`output-${childId}`]: { node: childId } },
    },
  };
}

function applier(overrides: Partial<ConstructorParameters<typeof NativeGraphPatchApplier>[2]> = {}): NativeGraphPatchApplier {
  const initial = graph();
  return new NativeGraphPatchApplier(initial, coordinate(initial), {
    limits: { maxNodes: 10, maxEdges: 20, maxOutputs: 10, maxDepth: 10, maxFanOut: 10 },
    maxDynamicNodes: 5,
    ...overrides,
  });
}

describe("native GraphPatch applier", () => {
  it("rejects incomplete Graph IR fragments before compilation or durable replay", () => {
    const runtime = applier();
    const valid = patch(runtime.coordinate, "strict-fragments", "child-1");
    const attacks: unknown[] = [
      {
        ...valid,
        append: {
          ...valid.append,
          nodes: [{
            id: "missing-config",
            kind: "transform",
            inputSchema: {},
            outputSchema: {},
          }],
        },
      },
      {
        ...valid,
        append: {
          ...valid.append,
          edges: [{ id: "missing-from", to: { node: "child-1" } }],
        },
      },
      {
        ...valid,
        append: {
          ...valid.append,
          outputs: { invalid: { node: "child-1", port: "" } },
        },
      },
    ];

    for (const attack of attacks) {
      expect(() => validateGraphPatchShape(attack)).toThrowError(
        expect.objectContaining({ code: "GE_PATCH_INVALID" }),
      );
    }
    expect(runtime.coordinate.graphRevision).toBe(1);
  });

  it("applies append-only revisions with durable-CAS preparation and frozen idempotent retries", () => {
    const runtime = applier();
    const firstPatch = patch(runtime.coordinate, "patch-1", "child-1");
    const prepared = runtime.prepare(firstPatch, context({ dryRun: true }));
    expect(prepared.decision.outcome).toBe("accepted");
    expect(runtime.coordinate.graphRevision).toBe(1);
    expect(runtime.decided("patch-1")).toBeUndefined();

    const first = runtime.commitPrepared(prepared);
    expect(first.mutated).toBe(true);
    expect(runtime.coordinate.graphRevision).toBe(2);
    expect(runtime.dynamicNodes).toBe(1);

    const secondPatch = patch(runtime.coordinate, "patch-2", "child-2", {
      edges: [{ id: "patch-2-edge", from: { node: "child-1" }, to: { node: "child-2" } }],
    });
    const second = runtime.apply(secondPatch, context());
    expect(second.mutated).toBe(true);
    expect(runtime.coordinate.graphRevision).toBe(3);

    const retry = runtime.apply(firstPatch, context({
      succeededNodeIds: [],
      effectiveCapabilities: [],
    }));
    expect(retry.mutated).toBe(false);
    expect(retry.coordinate).toEqual(first.coordinate);
    expect(retry.graph.nodes.map(({ id }) => id)).toEqual(["root", "child-1"]);
    expect(runtime.coordinate).toEqual(second.coordinate);
  });

  it("makes rejected decisions idempotent and rejects same-ID byte conflicts", () => {
    const runtime = applier();
    const denied = patch(runtime.coordinate, "denied", "privileged", {
      node: node("privileged", { config: { capabilities: ["network"] } }),
    });
    const first = runtime.apply(denied, context());
    expect(first.decision.outcome).toBe("rejected");
    expect(first.decision.outcome === "rejected" && first.decision.errorCode).toBe(
      "GE_PATCH_AUTHORITY_EXPANSION",
    );
    expect(runtime.apply(denied, context({ effectiveCapabilities: ["network"] })).decision).toEqual(
      first.decision,
    );
    expect(() => runtime.apply({ ...denied, append: { ...denied.append, outputs: {} } }, context())).toThrowError(
      expect.objectContaining({ code: "GE_PATCH_IDEMPOTENCY_CONFLICT" }),
    );
  });

  it("fails closed for budgets, capabilities, incoming existing edges, cycles, and unsupported modes", () => {
    const cases: readonly [GraphPatch, GraphPatchApplyContext, string][] = [
      [patch(coordinate(), "budget", "budget-node"), context({ reserved: { attempts: 1, costUsd: 2, dynamicNodes: 0 } }), "GE_PATCH_BUDGET_EXCEEDED"],
      [patch(coordinate(), "incoming", "new", {
        edges: [{ id: "incoming-edge", from: { node: "new" }, to: { node: "root" } }],
      }), context(), "GE_PATCH_STATE_CONFLICT"],
      [patch(coordinate(), "stream", "stream-node", {
        edges: [{ id: "stream-edge", from: { node: "root" }, to: { node: "stream-node" }, mode: "stream" }],
      }), context(), "GE_PATCH_UNSUPPORTED"],
      [patch(coordinate(), "cycle", "a", {
        node: node("a"),
        edges: [
          { id: "a-b", from: { node: "a" }, to: { node: "b" } },
          { id: "b-a", from: { node: "b" }, to: { node: "a" } },
        ],
        outputs: { cycle: { node: "a" } },
      }) as GraphPatch, context(), "GE_PATCH_GRAPH_INVALID"],
    ];
    // The cycle case needs a second appended node while preserving the helper's first node.
    const cycleCase = cases[3]![0];
    (cycleCase.append.nodes as NodeSpec[]).push(node("b"));
    for (const [proposal, applyContext, errorCode] of cases) {
      const result = applier().apply(proposal, applyContext);
      expect(result.decision.outcome).toBe("rejected");
      expect(result.decision.outcome === "rejected" && result.decision.errorCode).toBe(errorCode);
    }
  });

  it("rejects malformed public context and forged prepared applications before mutation", () => {
    const runtime = applier();
    const proposal = patch(runtime.coordinate, "valid", "child-1");
    expect(() => runtime.prepare(proposal, context({
      activityUsage: { attempts: -1, costUsd: -1 },
    }))).toThrowError(expect.objectContaining({ code: "GE_PATCH_INVALID" }));

    const withGetter = context() as GraphPatchApplyContext & { poison?: unknown };
    Object.defineProperty(withGetter, "poison", { enumerable: true, get: () => 1 });
    expect(() => runtime.prepare(proposal, withGetter)).toThrowError(
      expect.objectContaining({ code: "GE_PATCH_INVALID" }),
    );

    const prepared = runtime.prepare(proposal, context({ dryRun: true }));
    const forged = { ...prepared, coordinate: { ...prepared.coordinate, graphRevision: 9 } } as GraphPatchApplication;
    expect(() => runtime.commitPrepared(forged)).toThrowError(
      expect.objectContaining({ code: "GE_PATCH_INVALID" }),
    );
    expect(runtime.coordinate.graphRevision).toBe(1);
  });

  it("strictly validates accepted and rejected durable decisions before restore", () => {
    const source = applier();
    const accepted = source.apply(patch(source.coordinate, "restore-ok", "child-1"), context()).decision;
    if (accepted.outcome !== "accepted") throw new TypeError("test patch was rejected");
    const plannerActivityKey = accepted.authoritySnapshot.proposerActivityKey;
    expect(() => applier().restoreRecorded(accepted, plannerActivityKey)).not.toThrow();

    const attacks: unknown[] = [];
    attacks.push({ ...accepted, injected: true });
    attacks.push({
      ...accepted,
      budgetOutcome: {
        ...accepted.budgetOutcome,
        committed: { ...accepted.budgetOutcome.committed, attempts: -1 },
      },
    });
    attacks.push({
      ...accepted,
      requestedBase: { ...accepted.requestedBase, graphRevision: accepted.requestedBase.graphRevision + 1 },
    });
    const skippedBody = { ...accepted.resultingRevision.body, graphRevision: 3 };
    attacks.push({ ...accepted, resultingRevision: createGraphRevision(skippedBody) });
    const previousDrift = { ...accepted.resultingRevision.body, previousRevisionHash: "2".repeat(64) };
    attacks.push({ ...accepted, resultingRevision: createGraphRevision(previousDrift) });
    const patchHashDrift = { ...accepted.resultingRevision.body, patchHash: "3".repeat(64) };
    attacks.push({ ...accepted, resultingRevision: createGraphRevision(patchHashDrift) });
    attacks.push({
      ...accepted,
      authoritySnapshot: { ...accepted.authoritySnapshot, principalHash: "not-a-hash" },
    });
    attacks.push({ ...accepted, policySnapshotHash: "not-a-hash" });
    for (const attack of attacks) {
      expect(() => applier().restoreRecorded(attack as typeof accepted, plannerActivityKey)).toThrowError(
        expect.objectContaining({ code: "GE_CYCLE_INVALID_HISTORY" }),
      );
    }
    expect(() => applier().restoreRecorded({
      ...accepted,
      authoritySnapshot: {
        ...accepted.authoritySnapshot,
        proposerActivityKey: "f".repeat(64),
      },
    }, plannerActivityKey)).toThrowError(expect.objectContaining({ code: "GE_CYCLE_INVALID_HISTORY" }));

    const rejectionSource = applier();
    const denied = patch(rejectionSource.coordinate, "restore-denied", "privileged", {
      node: node("privileged", { config: { capabilities: ["network"] } }),
    });
    const rejected = rejectionSource.apply(denied, context()).decision;
    if (rejected.outcome !== "rejected") throw new TypeError("test patch was accepted");
    const rejectedPlannerKey = rejected.authoritySnapshot.proposerActivityKey;
    expect(() => applier().restoreRecorded(rejected, rejectedPlannerKey)).not.toThrow();
    expect(() => applier().restoreRecorded({
      ...rejected,
      diagnostics: [{ ...rejected.diagnostics[0], injected: true }],
    } as typeof rejected, rejectedPlannerKey)).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_INVALID_HISTORY" }),
    );
  });

  it("enforces exact and over-bound node, edge, output, depth, fan-out, and dynamic-node limits", () => {
    const proposalFor = (runtime: NativeGraphPatchApplier): GraphPatch => patch(
      runtime.coordinate, "one-node", "child-1",
    );
    const exactLimits = {
      maxNodes: 2, maxEdges: 1, maxOutputs: 2, maxDepth: 2, maxFanOut: 1,
    };
    const exact = applier({ limits: exactLimits, maxDynamicNodes: 1 });
    expect(exact.apply(proposalFor(exact), context({
      reserved: { attempts: 1, costUsd: 2, dynamicNodes: 1 },
    })).decision.outcome).toBe("accepted");

    const overCases = [
      { limits: { ...exactLimits, maxNodes: 1 }, maxDynamicNodes: 1 },
      { limits: { ...exactLimits, maxEdges: 0 }, maxDynamicNodes: 1 },
      { limits: { ...exactLimits, maxOutputs: 1 }, maxDynamicNodes: 1 },
      { limits: { ...exactLimits, maxDepth: 1 }, maxDynamicNodes: 1 },
      { limits: exactLimits, maxDynamicNodes: 0 },
    ];
    for (const options of overCases) {
      const runtime = applier(options);
      const result = runtime.apply(proposalFor(runtime), context({
        reserved: { attempts: 1, costUsd: 2, dynamicNodes: 1 },
      }));
      expect(result.decision.outcome).toBe("rejected");
      expect(result.decision.outcome === "rejected" && result.decision.errorCode).toBe(
        "GE_PATCH_BUDGET_EXCEEDED",
      );
    }

    const fanOut = applier({
      limits: { maxNodes: 3, maxEdges: 2, maxOutputs: 3, maxDepth: 2, maxFanOut: 1 },
      maxDynamicNodes: 2,
    });
    const fanOutPatch: GraphPatch = {
      apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
      kind: "GraphPatch",
      patchId: "fanout-over",
      base: fanOut.coordinate,
      append: {
        nodes: [node("left"), node("right")],
        edges: [
          { id: "root-left", from: { node: "root" }, to: { node: "left" } },
          { id: "root-right", from: { node: "root" }, to: { node: "right" } },
        ],
        outputs: { left: { node: "left" }, right: { node: "right" } },
      },
    };
    const fanOutResult = fanOut.apply(fanOutPatch, context({
      reserved: { attempts: 1, costUsd: 2, dynamicNodes: 2 },
    }));
    expect(fanOutResult.decision.outcome).toBe("rejected");
    expect(fanOutResult.decision.outcome === "rejected" && fanOutResult.decision.errorCode).toBe(
      "GE_PATCH_BUDGET_EXCEEDED",
    );
  });

  it("allows one stale-base race winner and keeps dry-run free of ID reservation", () => {
    const race = applier();
    const left = race.prepare(patch(race.coordinate, "race-left", "left"), context({ dryRun: true }));
    const right = race.prepare(patch(race.coordinate, "race-right", "right"), context({ dryRun: true }));
    expect(race.commitPrepared(left).mutated).toBe(true);
    expect(() => race.commitPrepared(right)).toThrowError(
      expect.objectContaining({ code: "GE_PATCH_STALE_BASE" }),
    );

    const dry = applier();
    dry.prepare(patch(dry.coordinate, "reusable-id", "first"), context({ dryRun: true }));
    const changedSameId = patch(dry.coordinate, "reusable-id", "second");
    expect(() => dry.prepare(changedSameId, context({ dryRun: true }))).not.toThrow();
    expect(dry.decided("reusable-id")).toBeUndefined();
  });

  it("executes the closed 54-case hostile shape corpus before graph mutation", async () => {
    const fixture = JSON.parse(readFileSync(
      new URL("../../../spec/conformance/graph-patch-hostile-shape.case.json", import.meta.url),
      "utf8",
    ));
    const baseGraph = JSON.parse(readFileSync(
      new URL("../../../spec/conformance/diamond.graph.json", import.meta.url),
      "utf8",
    ));
    const report = await exerciseGraphPatchHostileShapeCampaign({
      runtime,
      core,
      graph: baseGraph,
      fixture,
    });

    expect(report.attackCount).toBe(54);
    expect(report.corpusCanonicalUtf8Bytes).toBe(8934);
    expect(report.corpusSha256).toBe(
      "cd229d4e9a9559140bc8f457b2237c861ddec1b39baa537d7130e5d2d91156f4",
    );
    expect(report.outcomes.every((outcome) => (
      outcome.errorCode === "GE_PATCH_INVALID"
      && outcome.coordinateUnchanged
      && outcome.dynamicNodes === 0
      && !outcome.decisionRecorded
      && outcome.callerUnchanged
    ))).toBe(true);
  });

  it("executes the closed 24-case hostile semantic and idempotency corpus", async () => {
    const fixture = JSON.parse(readFileSync(
      new URL("../../../spec/conformance/graph-patch-hostile-semantic.case.json", import.meta.url),
      "utf8",
    ));
    const baseGraph = JSON.parse(readFileSync(
      new URL("../../../spec/conformance/diamond.graph.json", import.meta.url),
      "utf8",
    ));
    const report = await exerciseGraphPatchHostileSemanticCampaign({
      runtime,
      core,
      graph: baseGraph,
      fixture,
    });

    expect(report.caseCount).toBe(24);
    expect(report.decisionCaseCount).toBe(19);
    expect(report.behaviorCaseCount).toBe(5);
    expect(report.casesCanonicalUtf8Bytes).toBe(3590);
    expect(report.casesSha256).toBe(
      "9b58924f80d5b6886652a104dc9e84c0502e939ccc02751a052970c556cabb53",
    );
    const decisions = report.outcomes.filter(({ kind }) => kind === "decision");
    expect(decisions).toHaveLength(19);
    expect(decisions.every((outcome) => (
      outcome.decision.outcome === "rejected"
      && outcome.decision.errorCode !== null
      && outcome.beforeCoordinate.graphRevision === outcome.afterCoordinate.graphRevision
      && outcome.decisionCount === 0
      && outcome.dynamicNodes === 0
    ))).toBe(true);
    const race = report.outcomes.find(({ id }) => id === "same-base-one-winner");
    expect(race?.observations).toMatchObject({
      acceptedCount: 1,
      staleCount: 1,
      decisionCount: 2,
      runtimeRevision: 2,
      dynamicNodes: 1,
    });
  });
});
