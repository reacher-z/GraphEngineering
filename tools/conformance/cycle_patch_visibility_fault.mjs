import assert from "node:assert/strict";

const FAULT_SIGNALS = Object.freeze({
  "process-loss": "coordinator-process-lost",
  "store-error": "durable-store-error",
  timeout: "operation-deadline-exceeded",
  cancellation: "operation-cancelled",
  "commit-then-throw": "commit-acknowledgement-lost",
});

class PatchVisibilityFault extends Error {
  constructor(faultKind) {
    const signal = FAULT_SIGNALS[faultKind];
    assert.notEqual(signal, undefined, `unknown patch-visibility fault kind ${faultKind}`);
    super(signal);
    this.name = "PatchVisibilityFault";
    this.faultKind = faultKind;
    this.signal = signal;
  }
}

class PatchVisibilitySeedStop extends Error {}

function findInjectedFault(error) {
  let candidate = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (candidate instanceof PatchVisibilityFault) return candidate;
    if (!(candidate instanceof Error) || candidate.cause === undefined) return null;
    candidate = candidate.cause;
  }
  return null;
}

function binding(phase, sideEffects = "none") {
  const digit = phase === "finder" ? "1"
    : phase === "candidate-evaluator" ? "2"
      : "5";
  return {
    activityId: phase,
    implementationHash: digit.repeat(64),
    sideEffects,
    maxAttemptsPerRound: 1,
    maxCostUsdPerAttempt: 0,
    timeoutMs: 100,
  };
}

function configureRequest(base, graphHash, index) {
  const request = JSON.parse(JSON.stringify(base));
  const suffix = String(index).padStart(3, "0");
  Object.assign(request, {
    controllerRunId: `cycle-patch-visibility-${suffix}`,
    controllerId: `cycle-patch-visibility-${suffix}-controller`,
    hostRun: {
      relationship: "standalone-child-controller",
      runId: `cycle-patch-visibility-${suffix}-host`,
    },
    eventStreamId: `cycle-patch-visibility-${suffix}.events`,
    checkpointScope: `cycle-patch-visibility-${suffix}.checkpoints`,
    initialGraph: {
      graphRevision: 1,
      graphHash,
      revisionHash: "1".repeat(64),
    },
  });
  request.policy = {
    ...request.policy,
    mode: "until-dry",
    consecutiveDryRounds: 2,
    maxIterations: 1,
    maxDurationMs: 10_000,
    maxCostUsd: 10,
    maxTotalAttempts: 10,
    maxDiscoveries: 10,
    maxDynamicNodes: 2,
    maxCandidatesPerRound: 10,
    maxCandidateBytes: 4_096,
    maxCandidateBatchBytes: 16_384,
  };
  request.activities = {
    finder: binding("finder"),
    candidateEvaluator: binding("candidate-evaluator"),
    condition: null,
    optimizerEvaluator: null,
    patchPlanner: binding("patch-planner", "idempotent"),
  };
  request.patches = {
    enabled: true,
    limits: {
      maxNodes: 100,
      maxEdges: 200,
      maxOutputs: 100,
      maxDepth: 20,
      maxFanOut: 20,
    },
  };
  return request;
}

function lease(runId, epoch, startedAt) {
  return {
    leaseId: `${runId}-lease-${epoch}`,
    holderId: `cycle-patch-visibility-holder-${epoch}`,
    leaseEpoch: epoch,
    fencingToken: epoch,
    acquiredAt: startedAt,
    expiresAt: `2026-07-26T12:0${epoch}:00.000Z`,
  };
}

function patchOutput(context, index) {
  const suffix = String(index).padStart(3, "0");
  const nodeId = `patch-visibility-review-${suffix}`;
  return {
    apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
    kind: "GraphPatch",
    patchId: `cycle-patch-visibility-patch-${suffix}`,
    base: context.input.currentRevision,
    append: {
      nodes: [{
        id: nodeId,
        kind: "validator",
        inputSchema: {},
        outputSchema: {},
        config: {},
        sideEffects: "none",
      }],
      edges: [{
        id: `patch-visibility-edge-${suffix}`,
        from: { node: "merge" },
        to: { node: nodeId },
        mode: "value",
      }],
      outputs: {
        [`patchVisibilityReview${suffix}`]: { node: nodeId },
      },
    },
  };
}

function patchContext(authority) {
  return {
    authoritySnapshot: authority,
    policySnapshotHash: "8".repeat(64),
    runState: "active",
    effectiveCapabilities: [],
    succeededNodeIds: ["merge"],
    supportedEdgeModes: ["value"],
  };
}

async function exerciseEntry({
  runtime,
  core,
  graph,
  graphHash,
  baseRequest,
  fixture,
  entry,
  index,
  startedAt,
  checkpointAt,
}) {
  const request = runtime.validateCycleControllerRequest(
    configureRequest(baseRequest, graphHash, index),
  );
  let targetFired = false;
  const targetHook = (boundary) => {
    if (!targetFired && boundary === entry.boundary) {
      targetFired = true;
      throw new PatchVisibilityFault(entry.faultKind);
    }
  };
  const store = new runtime.MemoryCycleControllerEventStore({ faultHook: targetHook });
  const checkpointInterval = fixture.linearization.checkpointEveryEvents;
  const checkpointDelegate = checkpointInterval === undefined
    ? undefined
    : new runtime.MemoryCycleControllerCheckpointStore();
  let checkpointWrites = 0;
  const checkpointStore = checkpointDelegate === undefined ? undefined : {
    async write(scope, checkpointId, checkpoint) {
      await checkpointDelegate.write(scope, checkpointId, checkpoint);
      checkpointWrites += 1;
    },
    async read(scope, checkpointId) {
      return checkpointDelegate.read(scope, checkpointId);
    },
  };
  const checkpointOptions = checkpointStore === undefined ? {} : {
    checkpointStore,
    checkpointEveryEvents: checkpointInterval,
  };
  const authority = {
    proposerActivityKey: "0".repeat(64),
    principalHash: "2".repeat(64),
    proposerGrantHash: "3".repeat(64),
    runGrantHash: "4".repeat(64),
    tenantGrantHash: "5".repeat(64),
    deploymentGrantHash: "6".repeat(64),
    effectiveGrantHash: "7".repeat(64),
    policyHash: "8".repeat(64),
    approvalHash: null,
  };
  const context = patchContext(authority);
  let seedFinderCalls = 0;
  let seedEvaluatorCalls = 0;
  const seedHook = (boundary) => {
    targetHook(boundary);
    if (boundary === fixture.seedBoundary) throw new PatchVisibilitySeedStop();
  };
  try {
    await runtime.startCycleController(request, graph, {
      eventStore: store,
      ...checkpointOptions,
      lease: lease(request.controllerRunId, 1, startedAt),
      now: () => new Date(startedAt),
      faultHook: seedHook,
      patchContext: context,
      activities: {
        finder: () => {
          seedFinderCalls += 1;
          return { output: [] };
        },
        candidateEvaluator: () => {
          seedEvaluatorCalls += 1;
          return { output: [] };
        },
        patchPlanner: () => {
          throw new Error("patch-visibility seed dispatched the planner");
        },
        shouldPlanPatch: () => true,
      },
    });
    throw new Error("patch-visibility seed did not stop before planner dispatch");
  } catch (error) {
    if (!(error instanceof PatchVisibilitySeedStop)) throw error;
  }
  assert.equal(seedFinderCalls, 1);
  assert.equal(seedEvaluatorCalls, 1);
  const seedEvents = store.snapshot(request.eventStreamId);
  assert.equal(seedEvents.at(-1)?.type, "ModeOutcomeCommitted");
  assert.equal(seedEvents.some(({ type }) => type === "PatchAccepted"), false);

  let plannerCalls = 0;
  const plannerKeys = [];
  const forbiddenCalls = { finder: 0, evaluator: 0 };
  const activities = {
    finder: () => {
      forbiddenCalls.finder += 1;
      throw new Error("patch-visibility recovery reran finder");
    },
    candidateEvaluator: () => {
      forbiddenCalls.evaluator += 1;
      throw new Error("patch-visibility recovery reran evaluator");
    },
    patchPlanner: (activity) => {
      plannerCalls += 1;
      plannerKeys.push(activity.activityKey);
      authority.proposerActivityKey = activity.activityKey;
      return { output: patchOutput(activity, index) };
    },
    shouldPlanPatch: () => true,
  };
  let observedFaultSignal;
  try {
    await runtime.resumeCycleController(request, graph, {
      eventStore: store,
      ...checkpointOptions,
      expectedSequence: seedEvents.at(-1).sequence,
      leaseReason: "takeover",
      lease: lease(request.controllerRunId, 2, startedAt),
      now: () => new Date(startedAt),
      faultHook: targetHook,
      activities,
      patchContext: context,
    });
    throw new Error(`${entry.stage}/${entry.faultKind} did not fire`);
  } catch (error) {
    const injected = findInjectedFault(error);
    if (injected === null || !targetFired) throw error;
    assert.equal(injected.faultKind, entry.faultKind);
    observedFaultSignal = injected.signal;
  }
  assert.equal(observedFaultSignal, FAULT_SIGNALS[entry.faultKind]);
  assert.equal(plannerCalls, 1);
  assert.deepEqual(forbiddenCalls, { finder: 0, evaluator: 0 });
  const interrupted = store.snapshot(request.eventStreamId);
  const interruptedFold = runtime.foldCycleControllerEvents(interrupted);
  const expectedCommitted = entry.durability !== "event-not-committed";
  const targetAtFault = interrupted.find(({ type }) => type === "PatchAccepted");
  assert.equal(
    interrupted.filter(({ type }) => type === "PatchAccepted").length,
    Number(expectedCommitted),
  );
  assert.equal(targetAtFault !== undefined, expectedCommitted);
  assert.equal(
    interruptedFold.currentRevision.graphRevision,
    expectedCommitted
      ? fixture.linearization.acceptedGraphRevision
      : fixture.linearization.initialGraphRevision,
  );
  const checkpointId = `${request.controllerRunId}${fixture.linearization.checkpointIdSuffix ?? "-latest"}`;
  const checkpointWritesAtFault = checkpointWrites;
  const checkpointAtFault = checkpointStore === undefined
    ? undefined
    : await checkpointStore.read(request.checkpointScope, checkpointId);
  if (checkpointAtFault !== undefined) {
    assert.notEqual(checkpointAtFault, null);
    const expectedLag = fixture.linearization.checkpointLagEvents[entry.stage];
    assert.equal(typeof expectedLag, "number");
    assert.notEqual(targetAtFault, undefined);
    assert.equal(targetAtFault.sequence - checkpointAtFault.lastSequence, expectedLag);
    assert.equal(
      checkpointAtFault.historyPrefixHash,
      interrupted[checkpointAtFault.lastSequence].recordHash,
    );
    assert.equal(
      entry.durability === "event-and-checkpoint-committed",
      expectedLag === 0,
    );
  }

  const result = await runtime.resumeCycleController(request, graph, {
    eventStore: store,
    ...checkpointOptions,
    expectedSequence: interrupted.at(-1).sequence,
    leaseReason: "takeover",
    lease: lease(request.controllerRunId, 3, startedAt),
    now: () => new Date(startedAt),
    activities,
    patchContext: context,
  });
  const expectedPlannerCalls = expectedCommitted
    ? fixture.linearization.committedPlannerCalls
    : fixture.linearization.preCommitPlannerCalls;
  assert.equal(plannerCalls, expectedPlannerCalls);
  assert.equal(new Set(plannerKeys).size, 1, "patch planner activity key drifted across recovery");
  assert.deepEqual(forbiddenCalls, { finder: 0, evaluator: 0 });
  assert.equal(result.exitReason, "MAX_ITERATIONS");
  assert.equal(result.lastGraphRevision, fixture.linearization.acceptedGraphRevision);
  assert.equal(result.dynamicNodes, fixture.linearization.acceptedDynamicNodes);

  const finalEvents = store.snapshot(request.eventStreamId);
  const finalFold = runtime.foldCycleControllerEvents(finalEvents, { requireTerminal: true });
  const accepted = finalEvents.filter(({ type }) => type === "PatchAccepted");
  const patchStarts = finalEvents.filter(({ type, data }) => (
    type === "ActivityStarted" && data.phase === "patch-planner"
  ));
  const patchSettlements = finalEvents.filter(({ type, data }) => (
    type === "BudgetReservationSettled" && data.phase === "patch-planner"
  ));
  assert.equal(accepted.length, 1);
  assert.equal(patchStarts.length, 1);
  assert.equal(patchSettlements.length, 1);
  assert.equal(finalEvents.filter(({ type }) => type === "RoundCommitted").length, 1);
  assert.equal(finalEvents.filter(({ type }) => type === "ControllerTerminated").length, 1);
  assert.equal(accepted[0].data.plannerActivityKey, patchStarts[0].data.activityKey);
  assert.deepEqual(patchSettlements[0].data.committed, {
    attempts: 1,
    costUsd: 0,
    dynamicNodes: fixture.linearization.acceptedDynamicNodes,
  });
  assert.equal(finalFold.currentRevision.graphRevision, fixture.linearization.acceptedGraphRevision);

  const beforeReplay = finalEvents.length;
  const checkpointWritesBeforeReplay = checkpointWrites;
  const replayed = await runtime.replayCycleController(store, request.eventStreamId);
  assert.deepEqual(replayed.terminalResult, result);
  assert.equal(store.snapshot(request.eventStreamId).length, beforeReplay);
  assert.equal(checkpointWrites, checkpointWritesBeforeReplay);

  let terminalHandlerCalls = 0;
  let terminalClockCalls = 0;
  const forbidden = () => {
    terminalHandlerCalls += 1;
    throw new Error("patch-visibility terminal resume dispatched a handler");
  };
  const terminal = await runtime.resumeCycleController(request, graph, {
    eventStore: store,
    expectedSequence: finalEvents.at(-1).sequence,
    lease: lease(request.controllerRunId, 4, startedAt),
    now: () => {
      terminalClockCalls += 1;
      throw new Error("patch-visibility terminal resume sampled the clock");
    },
    activities: {
      finder: forbidden,
      candidateEvaluator: forbidden,
      patchPlanner: forbidden,
      shouldPlanPatch: () => true,
    },
  });
  assert.deepEqual(terminal, result);
  assert.equal(store.snapshot(request.eventStreamId).length, beforeReplay);
  assert.equal(checkpointWrites, checkpointWritesBeforeReplay);
  assert.equal(terminalHandlerCalls, 0);
  assert.equal(terminalClockCalls, 0);

  const target = finalEvents.find(({ type }) => type === "PatchAccepted");
  assert.notEqual(target, undefined);
  const checkpoint = runtime.createCycleControllerCheckpoint(
    finalEvents,
    `${request.controllerRunId}-final`,
    checkpointAt,
  );
  const finalStoredCheckpoint = checkpointStore === undefined
    ? undefined
    : await checkpointStore.read(request.checkpointScope, checkpointId);
  if (finalStoredCheckpoint !== undefined) {
    assert.notEqual(finalStoredCheckpoint, null);
    assert.equal(finalStoredCheckpoint.lastSequence, finalEvents.at(-1).sequence);
    assert.equal(finalStoredCheckpoint.historyPrefixHash, finalEvents.at(-1).recordHash);
  }
  return {
    entry,
    index,
    faultSignal: observedFaultSignal,
    eventCommittedAtFault: expectedCommitted,
    interruptedTailHash: interruptedFold.historyPrefixHash,
    interruptedRecordHashes: interrupted.map(({ recordHash }) => recordHash),
    targetEventAtFaultCanonical: targetAtFault === undefined
      ? null
      : core.canonicalSerialize(targetAtFault),
    targetEventCanonical: core.canonicalSerialize(target),
    plannerCallsAtFault: 1,
    plannerCalls,
    plannerActivityKey: patchStarts[0].data.activityKey,
    resultCanonical: core.canonicalSerialize(result),
    finalEventTypes: finalEvents.map(({ type }) => type),
    finalEventCanonical: finalEvents.map((event) => core.canonicalSerialize(event)),
    finalRecordHashes: finalEvents.map(({ recordHash }) => recordHash),
    finalCheckpointCanonical: core.canonicalSerialize(checkpoint),
    ...(checkpointAtFault === undefined ? {} : {
      checkpointId,
      checkpointWritesAtFault,
      checkpointAtFaultCanonical: core.canonicalSerialize(checkpointAtFault),
      checkpointLagEventsAtFault: targetAtFault.sequence - checkpointAtFault.lastSequence,
      checkpointTargetsPatchAtFault: checkpointAtFault.lastSequence === targetAtFault.sequence,
      finalStoredCheckpointCanonical: core.canonicalSerialize(finalStoredCheckpoint),
      finalCheckpointWriteCount: checkpointWrites,
    }),
    replayZeroWrite: true,
    terminalResumeZeroWrite: true,
    terminalResumeHandlerCalls: terminalHandlerCalls,
    terminalResumeClockCalls: terminalClockCalls,
  };
}

export async function exerciseCyclePatchVisibilityFaultCampaign(options) {
  const stageSet = new Set(options.fixture.stages);
  const faultSet = new Set(options.fixture.faultKinds);
  const matrix = options.runtime.buildCycleDurableFaultMatrix().filter((entry) => (
    entry.eventType === options.fixture.eventType
      && stageSet.has(entry.stage)
      && faultSet.has(entry.faultKind)
  ));
  assert.equal(matrix.length, options.fixture.expect.matrixEntryCount);
  const canonical = options.core.canonicalSerialize(matrix);
  assert.equal(Buffer.byteLength(canonical, "utf8"), options.fixture.expect.matrixCanonicalUtf8Bytes);
  assert.equal(options.core.canonicalHash(matrix), options.fixture.expect.matrixSha256);
  const outcomes = [];
  for (const [index, entry] of matrix.entries()) {
    outcomes.push(await exerciseEntry({ ...options, entry, index }));
  }
  return {
    campaignId: options.fixture.id,
    requiredAssertions: options.fixture.requiredAssertions,
    matrix,
    obligationCount: outcomes.length,
    outcomes,
  };
}
