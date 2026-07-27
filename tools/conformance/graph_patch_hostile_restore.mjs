import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const BEHAVIOR_SCENARIOS = new Set([
  "accepted-restore",
  "rejected-restore",
  "stale-rejection-after-accepted",
  "sequential-accepted-history",
  "exact-accepted-duplicate",
  "historical-accepted-duplicate",
  "conflicting-duplicate",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256Utf8(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function categoryCounts(cases) {
  const counts = {};
  for (const item of cases) counts[item.category] = (counts[item.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function node(id) {
  return {
    id,
    kind: "validator",
    inputSchema: {},
    outputSchema: {},
    config: {},
    sideEffects: "none",
  };
}

function patch(coordinate, patchId, nodeId) {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
    kind: "GraphPatch",
    patchId,
    base: clone(coordinate),
    append: {
      nodes: [node(nodeId)],
      edges: [{
        id: `${patchId}-edge`,
        from: { node: "merge" },
        to: { node: nodeId },
        mode: "value",
      }],
      outputs: { [`${nodeId}Result`]: { node: nodeId } },
    },
  };
}

function authority() {
  return {
    proposerActivityKey: "1".repeat(64),
    principalHash: "2".repeat(64),
    proposerGrantHash: "3".repeat(64),
    runGrantHash: "4".repeat(64),
    tenantGrantHash: "5".repeat(64),
    deploymentGrantHash: "6".repeat(64),
    effectiveGrantHash: "7".repeat(64),
    policyHash: "8".repeat(64),
    approvalHash: null,
  };
}

function context() {
  return {
    authoritySnapshot: authority(),
    policySnapshotHash: "8".repeat(64),
    reservationId: "hostile-restore-reservation",
    reserved: { attempts: 1, costUsd: 0, dynamicNodes: 10 },
    activityUsage: { attempts: 1, costUsd: 0 },
    durationMs: 0,
    deadlineMsRemaining: 100,
    effectiveCapabilities: [],
    succeededNodeIds: ["merge"],
    supportedEdgeModes: ["value"],
  };
}

function options(overrides = {}) {
  return {
    limits: {
      maxNodes: 100,
      maxEdges: 200,
      maxOutputs: 100,
      maxDepth: 20,
      maxFanOut: 20,
      ...(overrides.limits ?? {}),
    },
    maxDynamicNodes: overrides.maxDynamicNodes ?? 10,
  };
}

function errorCode(error) {
  if (error !== null && typeof error === "object" && typeof error.code === "string") {
    return error.code;
  }
  throw error;
}

function seedCarriers({ runtime, core, graph, coordinate }) {
  const source = new runtime.NativeGraphPatchApplier(graph, coordinate, options());
  const accepted = source.apply(
    patch(coordinate, "restore-accepted", "restore-accepted-node"), context(),
  ).decision;
  assert.equal(accepted.outcome, "accepted");
  const staleAfterAccepted = source.apply(
    patch(coordinate, "restore-stale-after-accepted", "restore-stale-node"), context(),
  ).decision;
  assert.equal(staleAfterAccepted.outcome, "rejected");
  assert.equal(staleAfterAccepted.errorCode, "GE_PATCH_STALE_BASE");
  const secondAccepted = source.apply(
    patch(source.coordinate, "restore-second", "restore-second-node"), context(),
  ).decision;
  assert.equal(secondAccepted.outcome, "accepted");

  const rejectedSource = new runtime.NativeGraphPatchApplier(graph, coordinate, options());
  const rejectedPatch = patch(coordinate, "restore-rejected", "restore-rejected-node");
  rejectedPatch.base.graphRevision += 1;
  const rejected = rejectedSource.apply(rejectedPatch, context()).decision;
  assert.equal(rejected.outcome, "rejected");
  assert.equal(rejected.errorCode, "GE_PATCH_STALE_BASE");

  const carriers = {
    accepted: clone(accepted),
    rejected: clone(rejected),
    secondAccepted: clone(secondAccepted),
    staleAfterAccepted: clone(staleAfterAccepted),
  };
  return {
    carriers,
    evidence: Object.fromEntries(Object.entries(carriers).map(([name, decision]) => {
      const canonical = core.canonicalSerialize(decision);
      return [name, {
        canonicalUtf8Bytes: Buffer.byteLength(canonical, "utf8"),
        sha256: core.canonicalHash(decision),
        decision,
      }];
    })),
  };
}

function rehashRevision(runtime, decision) {
  decision.resultingRevision = clone(runtime.graphRevision(decision.resultingRevision.body));
}

function attackInput({ runtime, attack, carriers }) {
  const decision = clone(attack.seed === "rejected" ? carriers.rejected : carriers.accepted);
  let selectedOptions = options();
  switch (attack.scenario) {
    case "accepted-extra-field":
    case "rejected-extra-field":
      decision.injected = true;
      break;
    case "accepted-patch-id-drift":
      decision.patchId = "restore-accepted-drift";
      break;
    case "accepted-patch-hash-drift":
      decision.patchHash = "f".repeat(64);
      break;
    case "accepted-payload-noncanonical": {
      const pretty = JSON.stringify(JSON.parse(decision.patch.canonicalJson), null, 2);
      decision.patch.canonicalJson = pretty;
      decision.patch.utf8ByteLength = Buffer.byteLength(pretty, "utf8");
      decision.patch.sha256 = sha256Utf8(pretty);
      break;
    }
    case "accepted-payload-length-drift":
      decision.patch.utf8ByteLength += 1;
      break;
    case "accepted-requested-base-drift":
      decision.requestedBase.graphRevision += 1;
      break;
    case "accepted-planner-key-mismatch":
    case "rejected-planner-key-mismatch":
      decision.authoritySnapshot.proposerActivityKey = "f".repeat(64);
      break;
    case "accepted-authority-hash-invalid":
      decision.authoritySnapshot.principalHash = "not-a-hash";
      break;
    case "accepted-policy-hash-invalid":
      decision.policySnapshotHash = "not-a-hash";
      break;
    case "accepted-budget-negative":
      decision.budgetOutcome.committed.attempts = -1;
      break;
    case "accepted-budget-unreconciled":
    case "rejected-budget-unreconciled":
      decision.budgetOutcome.released.attempts += 1;
      break;
    case "accepted-dynamic-count-drift":
      decision.budgetOutcome.committed.dynamicNodes = 2;
      decision.budgetOutcome.released.dynamicNodes = 8;
      break;
    case "accepted-diagnostics-present":
      decision.diagnostics = [{ code: "GE_PATCH_INVALID", phase: 1, path: "" }];
      break;
    case "accepted-revision-skip":
      decision.resultingRevision.body.graphRevision += 1;
      rehashRevision(runtime, decision);
      break;
    case "accepted-previous-hash-drift":
      decision.resultingRevision.body.previousRevisionHash = "f".repeat(64);
      rehashRevision(runtime, decision);
      break;
    case "accepted-revision-patch-hash-drift":
      decision.resultingRevision.body.patchHash = "f".repeat(64);
      rehashRevision(runtime, decision);
      break;
    case "accepted-revision-hash-drift":
      decision.resultingRevision.revisionHash = "f".repeat(64);
      break;
    case "accepted-graph-hash-drift":
      decision.resultingRevision.body.graphHash = "f".repeat(64);
      rehashRevision(runtime, decision);
      break;
    case "accepted-over-dynamic-limit":
      selectedOptions = options({ maxDynamicNodes: 0 });
      break;
    case "accepted-over-node-limit":
      selectedOptions = options({ limits: { maxNodes: 4 } });
      break;
    case "rejected-diagnostics-empty":
      decision.diagnostics = [];
      break;
    case "rejected-error-code-unknown":
      decision.errorCode = "GE_PATCH_NOT_REAL";
      break;
    case "rejected-dynamic-commit-nonzero":
      decision.budgetOutcome.committed.dynamicNodes = 1;
      decision.budgetOutcome.released.dynamicNodes = 9;
      break;
    case "rejected-outcome-mismatch":
      decision.outcome = "accepted";
      break;
    default:
      assert.fail(`unsupported hostile restore attack ${attack.scenario}`);
  }
  return {
    decisions: [decision],
    expectedPlannerActivityKeys: ["1".repeat(64)],
    targetOptions: selectedOptions,
  };
}

function behaviorInput(attack, carriers) {
  const accepted = clone(carriers.accepted);
  const rejected = clone(carriers.rejected);
  const second = clone(carriers.secondAccepted);
  const stale = clone(carriers.staleAfterAccepted);
  let decisions;
  switch (attack.scenario) {
    case "accepted-restore":
      decisions = [accepted];
      break;
    case "rejected-restore":
      decisions = [rejected];
      break;
    case "stale-rejection-after-accepted":
      decisions = [accepted, stale];
      break;
    case "sequential-accepted-history":
      decisions = [accepted, second];
      break;
    case "exact-accepted-duplicate":
      decisions = [accepted, clone(accepted)];
      break;
    case "historical-accepted-duplicate":
      decisions = [accepted, second, clone(accepted)];
      break;
    case "conflicting-duplicate": {
      const conflict = clone(accepted);
      conflict.authoritySnapshot.approvalHash = "9".repeat(64);
      decisions = [accepted, conflict];
      break;
    }
    default:
      assert.fail(`unsupported hostile restore behavior ${attack.scenario}`);
  }
  return {
    decisions,
    expectedPlannerActivityKeys: decisions.map(() => "1".repeat(64)),
    targetOptions: options(),
  };
}

function executeCase({ runtime, core, graph, coordinate, attack, index, carriers }) {
  const kind = BEHAVIOR_SCENARIOS.has(attack.scenario) ? "behavior" : "attack";
  const input = kind === "attack"
    ? attackInput({ runtime, attack, carriers })
    : behaviorInput(attack, carriers);
  const target = new runtime.NativeGraphPatchApplier(graph, coordinate, input.targetOptions);
  let observedCode = null;
  for (const [decisionIndex, decision] of input.decisions.entries()) {
    try {
      target.restoreRecorded(decision, input.expectedPlannerActivityKeys[decisionIndex]);
    } catch (error) {
      observedCode = errorCode(error);
      break;
    }
  }
  const observedOutcome = observedCode === null
    ? (attack.expectOutcome === "duplicate-reused" ? "duplicate-reused" : "restored")
    : "restore-rejected";
  assert.equal(observedOutcome, attack.expectOutcome, `${attack.id} outcome drifted`);
  assert.equal(observedCode, attack.expectCode ?? null, `${attack.id} code drifted`);
  if (kind === "attack") {
    assert.deepEqual(target.coordinate, coordinate, `${attack.id} mutated the coordinate`);
    assert.equal(target.dynamicNodes, 0, `${attack.id} mutated dynamic-node state`);
    assert.equal(target.graph.nodes.length, graph.nodes.length, `${attack.id} mutated the graph`);
    assert.equal(target.decided(input.decisions[0].patchId), undefined, `${attack.id} recorded a decision`);
  }
  const inputCanonical = core.canonicalSerialize(input);
  return {
    index,
    id: attack.id,
    category: attack.category,
    scenario: attack.scenario,
    kind,
    inputCanonicalUtf8Bytes: Buffer.byteLength(inputCanonical, "utf8"),
    inputSha256: core.canonicalHash(input),
    outcome: observedOutcome,
    errorCode: observedCode,
    coordinate: target.coordinate,
    decisionCount: input.decisions.filter((decision, decisionIndex) => (
      input.decisions.findIndex((candidate) => candidate.patchId === decision.patchId) === decisionIndex
      && target.decided(decision.patchId) !== undefined
    )).length,
    dynamicNodes: target.dynamicNodes,
    graphNodeCount: target.graph.nodes.length,
  };
}

export async function exerciseGraphPatchHostileRestoreCampaign({
  runtime,
  core,
  graph,
  fixture,
}) {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.id, "graph-patch-hostile-restore-v1alpha1");
  assert.equal(fixture.cases.length, fixture.expect.caseCount);
  assert.equal(new Set(fixture.cases.map(({ id }) => id)).size, fixture.cases.length);
  assert.equal(new Set(fixture.cases.map(({ scenario }) => scenario)).size, fixture.cases.length);
  assert.deepEqual(categoryCounts(fixture.cases), fixture.expect.categoryCounts);
  assert.equal(
    fixture.cases.filter(({ scenario }) => !BEHAVIOR_SCENARIOS.has(scenario)).length,
    fixture.expect.attackCaseCount,
  );
  assert.equal(
    fixture.cases.filter(({ scenario }) => BEHAVIOR_SCENARIOS.has(scenario)).length,
    fixture.expect.behaviorCaseCount,
  );
  const casesCanonical = core.canonicalSerialize(fixture.cases);
  assert.equal(Buffer.byteLength(casesCanonical, "utf8"), fixture.expect.casesCanonicalUtf8Bytes);
  assert.equal(core.canonicalHash(fixture.cases), fixture.expect.casesSha256);
  const compilation = core.compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.notEqual(compilation.graphHash, null);
  const coordinate = {
    graphRevision: 1,
    graphHash: compilation.graphHash,
    revisionHash: "1".repeat(64),
  };
  const { carriers, evidence: seeds } = seedCarriers({ runtime, core, graph, coordinate });
  const outcomes = fixture.cases.map((attack, index) => executeCase({
    runtime, core, graph, coordinate, attack, index, carriers,
  }));
  return {
    campaignId: fixture.id,
    caseCount: outcomes.length,
    attackCaseCount: fixture.expect.attackCaseCount,
    behaviorCaseCount: fixture.expect.behaviorCaseCount,
    categoryCounts: categoryCounts(fixture.cases),
    casesCanonicalUtf8Bytes: Buffer.byteLength(casesCanonical, "utf8"),
    casesSha256: core.canonicalHash(fixture.cases),
    requiredAssertions: fixture.requiredAssertions,
    seeds,
    outcomes,
  };
}
