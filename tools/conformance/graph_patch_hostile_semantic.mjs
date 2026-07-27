import assert from "node:assert/strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function categoryCounts(cases) {
  const counts = {};
  for (const attack of cases) counts[attack.category] = (counts[attack.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function node(id, overrides = {}) {
  return {
    id,
    kind: "validator",
    inputSchema: {},
    outputSchema: {},
    config: {},
    sideEffects: "none",
    ...overrides,
  };
}

function patch(coordinate, patchId, nodeId, overrides = {}) {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
    kind: "GraphPatch",
    patchId,
    base: clone(coordinate),
    append: {
      nodes: overrides.nodes ?? [node(nodeId)],
      edges: overrides.edges ?? [{
        id: `${patchId}-edge`,
        from: { node: "merge" },
        to: { node: nodeId },
        mode: "value",
      }],
      outputs: overrides.outputs ?? { [`${nodeId}Result`]: { node: nodeId } },
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

function context(overrides = {}) {
  return {
    authoritySnapshot: authority(),
    policySnapshotHash: "8".repeat(64),
    reservationId: "hostile-semantic-reservation",
    reserved: { attempts: 1, costUsd: 0, dynamicNodes: 10 },
    activityUsage: { attempts: 1, costUsd: 0 },
    durationMs: 0,
    deadlineMsRemaining: 100,
    effectiveCapabilities: [],
    succeededNodeIds: ["merge"],
    supportedEdgeModes: ["value"],
    ...overrides,
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

function normalizedDecision(core, decision) {
  const diagnosticCodes = [...new Set(decision.diagnostics.map(({ code }) => code))].sort();
  return {
    patchId: decision.patchId,
    patchHash: decision.patchHash,
    patchCanonicalUtf8Bytes: Buffer.byteLength(decision.patch.canonicalJson, "utf8"),
    outcome: decision.outcome,
    errorCode: decision.outcome === "rejected" ? decision.errorCode : null,
    diagnosticCodes,
    requestedBase: decision.requestedBase,
    budgetOutcome: decision.budgetOutcome,
    resultingCoordinate: decision.outcome === "accepted" ? {
      graphRevision: decision.resultingRevision.body.graphRevision,
      graphHash: decision.resultingRevision.body.graphHash,
      revisionHash: decision.resultingRevision.revisionHash,
    } : null,
    authoritySnapshotHash: core.canonicalHash(decision.authoritySnapshot),
    policySnapshotHash: decision.policySnapshotHash,
  };
}

function scenarioInput(baseCoordinate, attack) {
  const suffix = attack.id;
  const nodeId = `${suffix}-node`;
  const proposal = patch(baseCoordinate, `semantic-${suffix}`, nodeId);
  let selectedContext = context({ dryRun: true });
  let selectedOptions = options();
  switch (attack.scenario) {
    case "stale-base":
      proposal.base.graphRevision += 1;
      break;
    case "duplicate-existing-node":
      proposal.append.nodes[0].id = "split";
      proposal.append.edges[0].to.node = "split";
      proposal.append.outputs = { duplicateNode: { node: "split" } };
      break;
    case "duplicate-new-node":
      proposal.append.nodes.push(clone(proposal.append.nodes[0]));
      break;
    case "duplicate-existing-edge":
      proposal.append.edges[0].id = "left-merge";
      break;
    case "duplicate-new-edge":
      proposal.append.edges.push(clone(proposal.append.edges[0]));
      break;
    case "duplicate-existing-output":
      proposal.append.outputs = { result: { node: nodeId } };
      break;
    case "incoming-existing-target":
      proposal.append.edges[0].to.node = "left";
      break;
    case "source-not-succeeded":
      selectedContext = context({ dryRun: true, succeededNodeIds: [] });
      break;
    case "unsupported-stream-edge":
      proposal.append.edges[0].mode = "stream";
      break;
    case "config-capability-expansion":
      proposal.append.nodes[0].config = { capabilities: ["network"] };
      break;
    case "resource-capability-expansion":
      proposal.append.nodes[0].resources = { capabilities: ["network"] };
      break;
    case "zero-dynamic-reservation":
      selectedContext = context({
        dryRun: true,
        reserved: { attempts: 1, costUsd: 0, dynamicNodes: 0 },
      });
      break;
    case "runtime-dynamic-limit":
      selectedOptions = options({ maxDynamicNodes: 0 });
      break;
    case "maximum-node-limit":
      selectedOptions = options({ limits: { maxNodes: 4 } });
      break;
    case "maximum-edge-limit":
      selectedOptions = options({ limits: { maxEdges: 4 } });
      break;
    case "maximum-output-limit":
      selectedOptions = options({ limits: { maxOutputs: 1 } });
      break;
    case "maximum-depth-limit":
      selectedOptions = options({ limits: { maxDepth: 3 } });
      break;
    case "maximum-fanout-limit":
      selectedOptions = options({ limits: { maxFanOut: 1 } });
      break;
    case "candidate-cycle": {
      const left = `${suffix}-left`;
      const right = `${suffix}-right`;
      proposal.append.nodes = [node(left), node(right)];
      proposal.append.edges = [
        { id: `${suffix}-entry`, from: { node: "merge" }, to: { node: left }, mode: "value" },
        { id: `${suffix}-forward`, from: { node: left }, to: { node: right }, mode: "value" },
        { id: `${suffix}-cycle`, from: { node: right }, to: { node: left }, mode: "value" },
      ];
      proposal.append.outputs = { cycleResult: { node: right } };
      break;
    }
    default:
      assert.fail(`unsupported semantic decision scenario ${attack.scenario}`);
  }
  return { proposal, selectedContext, selectedOptions };
}

function decisionCase({ runtime, core, graph, coordinate, attack, index }) {
  const { proposal, selectedContext, selectedOptions } = scenarioInput(coordinate, attack);
  const captured = runtime.validateGraphPatchShape(proposal);
  const inputCanonical = core.canonicalSerialize(captured);
  const applier = new runtime.NativeGraphPatchApplier(graph, coordinate, selectedOptions);
  const beforeCoordinate = core.canonicalSerialize(applier.coordinate);
  const application = applier.prepare(captured, selectedContext);
  assert.equal(application.decision.outcome, attack.expectOutcome);
  assert.equal(application.decision.errorCode, attack.expectCode);
  assert.equal(core.canonicalSerialize(applier.coordinate), beforeCoordinate);
  assert.equal(applier.dynamicNodes, 0);
  assert.equal(applier.decided(captured.patchId), undefined);
  return {
    index,
    id: attack.id,
    category: attack.category,
    scenario: attack.scenario,
    kind: "decision",
    inputCanonicalUtf8Bytes: Buffer.byteLength(inputCanonical, "utf8"),
    inputSha256: core.canonicalHash(captured),
    decision: normalizedDecision(core, application.decision),
    beforeCoordinate: JSON.parse(beforeCoordinate),
    afterCoordinate: applier.coordinate,
    decisionCount: 0,
    dynamicNodes: 0,
    graphNodeCount: graph.nodes.length,
  };
}

function rejectedProposal(coordinate, id) {
  const proposal = patch(coordinate, id, `${id}-node`);
  proposal.append.nodes[0].config = { capabilities: ["network"] };
  return proposal;
}

function behaviorCase({ runtime, core, graph, coordinate, attack, index }) {
  const applier = new runtime.NativeGraphPatchApplier(graph, coordinate, options());
  let observations;
  if (attack.scenario === "exact-rejected-retry") {
    const proposal = rejectedProposal(coordinate, "semantic-retry-rejected");
    const first = applier.apply(proposal, context()).decision;
    const retry = applier.apply(proposal, context({ effectiveCapabilities: ["network"] })).decision;
    observations = {
      first: normalizedDecision(core, first),
      retry: normalizedDecision(core, retry),
      decisionsEqual: core.canonicalSerialize(first) === core.canonicalSerialize(retry),
      decisionCount: 1,
      runtimeRevision: applier.coordinate.graphRevision,
      dynamicNodes: applier.dynamicNodes,
    };
  } else if (attack.scenario === "changed-decided-id") {
    const proposal = rejectedProposal(coordinate, "semantic-changed-id");
    const first = applier.apply(proposal, context()).decision;
    const changed = clone(proposal);
    changed.append.outputs = { changedOutput: { node: changed.append.nodes[0].id } };
    let observedCode = null;
    try {
      applier.apply(changed, context({ effectiveCapabilities: ["network"] }));
    } catch (error) {
      observedCode = errorCode(error);
    }
    assert.equal(observedCode, attack.expectCode);
    observations = {
      first: normalizedDecision(core, first),
      conflictCode: observedCode,
      decisionCount: 1,
      runtimeRevision: applier.coordinate.graphRevision,
      dynamicNodes: applier.dynamicNodes,
    };
  } else if (attack.scenario === "historical-accepted-retry") {
    const firstProposal = patch(coordinate, "semantic-history-first", "history-first-node");
    const first = applier.apply(firstProposal, context()).decision;
    const secondProposal = patch(
      applier.coordinate,
      "semantic-history-second",
      "history-second-node",
    );
    const second = applier.apply(secondProposal, context()).decision;
    const retry = applier.apply(firstProposal, context()).decision;
    observations = {
      first: normalizedDecision(core, first),
      second: normalizedDecision(core, second),
      retry: normalizedDecision(core, retry),
      retryEqualsFirst: core.canonicalSerialize(first) === core.canonicalSerialize(retry),
      decisionCount: 2,
      runtimeRevision: applier.coordinate.graphRevision,
      dynamicNodes: applier.dynamicNodes,
    };
  } else if (attack.scenario === "dry-run-id-reuse") {
    const dryProposal = patch(coordinate, "semantic-dry-reuse", "dry-first-node");
    const dry = applier.apply(dryProposal, context({ dryRun: true })).decision;
    const afterDry = {
      decisionCount: applier.decided(dryProposal.patchId) === undefined ? 0 : 1,
      runtimeRevision: applier.coordinate.graphRevision,
      dynamicNodes: applier.dynamicNodes,
    };
    const realProposal = patch(coordinate, "semantic-dry-reuse", "dry-real-node");
    const real = applier.apply(realProposal, context()).decision;
    observations = {
      dry: normalizedDecision(core, dry),
      afterDry,
      real: normalizedDecision(core, real),
      decisionCount: 1,
      runtimeRevision: applier.coordinate.graphRevision,
      dynamicNodes: applier.dynamicNodes,
    };
  } else if (attack.scenario === "same-base-one-winner") {
    const firstProposal = patch(coordinate, "semantic-race-first", "race-first-node");
    const secondProposal = patch(coordinate, "semantic-race-second", "race-second-node");
    const first = applier.apply(firstProposal, context()).decision;
    const second = applier.apply(secondProposal, context()).decision;
    const decisions = [first, second].map((decision) => normalizedDecision(core, decision));
    observations = {
      decisions,
      acceptedCount: decisions.filter(({ outcome }) => outcome === "accepted").length,
      staleCount: decisions.filter(({ errorCode: code }) => code === "GE_PATCH_STALE_BASE").length,
      decisionCount: 2,
      runtimeRevision: applier.coordinate.graphRevision,
      dynamicNodes: applier.dynamicNodes,
    };
  } else {
    assert.fail(`unsupported semantic behavior scenario ${attack.scenario}`);
  }
  return {
    index,
    id: attack.id,
    category: attack.category,
    scenario: attack.scenario,
    kind: "behavior",
    observations,
  };
}

export async function exerciseGraphPatchHostileSemanticCampaign({
  runtime,
  core,
  graph,
  fixture,
}) {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.id, "graph-patch-hostile-semantic-v1alpha1");
  assert.equal(fixture.cases.length, fixture.expect.caseCount);
  assert.equal(new Set(fixture.cases.map(({ id }) => id)).size, fixture.cases.length);
  assert.equal(new Set(fixture.cases.map(({ scenario }) => scenario)).size, fixture.cases.length);
  assert.deepEqual(categoryCounts(fixture.cases), fixture.expect.categoryCounts);
  assert.equal(
    fixture.cases.filter(({ expectOutcome }) => expectOutcome === "rejected").length,
    fixture.expect.decisionCaseCount,
  );
  assert.equal(
    fixture.cases.filter(({ expectOutcome }) => expectOutcome !== "rejected").length,
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

  const outcomes = fixture.cases.map((attack, index) => (
    attack.expectOutcome === "rejected"
      ? decisionCase({ runtime, core, graph, coordinate, attack, index })
      : behaviorCase({ runtime, core, graph, coordinate, attack, index })
  ));
  return {
    campaignId: fixture.id,
    caseCount: outcomes.length,
    decisionCaseCount: fixture.expect.decisionCaseCount,
    behaviorCaseCount: fixture.expect.behaviorCaseCount,
    categoryCounts: categoryCounts(fixture.cases),
    casesCanonicalUtf8Bytes: Buffer.byteLength(casesCanonical, "utf8"),
    casesSha256: core.canonicalHash(fixture.cases),
    requiredAssertions: fixture.requiredAssertions,
    outcomes,
  };
}
