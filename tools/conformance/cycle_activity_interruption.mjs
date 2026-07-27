import assert from "node:assert/strict";

const PHASES = [
  "finder",
  "candidate-evaluator",
  "condition",
  "optimizer-evaluator",
  "patch-planner",
];

function binding(phase) {
  const digit = String(PHASES.indexOf(phase) + 1);
  return {
    activityId: phase,
    implementationHash: digit.repeat(64),
    sideEffects: "none",
    maxAttemptsPerRound: 1,
    maxCostUsdPerAttempt: 0,
    timeoutMs: 100,
  };
}

function phaseMode(phase) {
  if (phase === "condition") return "while";
  if (phase === "optimizer-evaluator") return "evaluator-optimizer";
  return "until-dry";
}

function configureRequest(base, entry, index, graphHash, fixture) {
  const request = JSON.parse(JSON.stringify(base));
  const suffix = String(index).padStart(3, "0");
  Object.assign(request, {
    controllerRunId: `cycle-interruption-${suffix}`,
    controllerId: `cycle-interruption-${suffix}-controller`,
    hostRun: {
      relationship: "standalone-child-controller",
      runId: `cycle-interruption-${suffix}-host`,
    },
    eventStreamId: `cycle-interruption-${suffix}.events`,
    checkpointScope: `cycle-interruption-${suffix}.checkpoints`,
    initialGraph: {
      graphRevision: 1,
      graphHash,
      revisionHash: "1".repeat(64),
    },
  });
  const mode = phaseMode(entry.phase);
  request.policy = {
    ...request.policy,
    mode,
    maxIterations: 2,
    maxDurationMs: 10_000,
    maxCostUsd: 10,
    maxTotalAttempts: 30,
    maxDiscoveries: 20,
    maxDynamicNodes: entry.phase === "patch-planner" ? 10 : 0,
    maxCandidatesPerRound: 20,
    maxCandidateBytes: 4_096,
    maxCandidateBatchBytes: 16_384,
  };
  if (mode === "until-dry") request.policy.consecutiveDryRounds = 2;
  else delete request.policy.consecutiveDryRounds;
  request.activities = {
    finder: binding("finder"),
    candidateEvaluator: binding("candidate-evaluator"),
    condition: mode === "while" ? binding("condition") : null,
    optimizerEvaluator: mode === "evaluator-optimizer"
      ? binding("optimizer-evaluator")
      : null,
    patchPlanner: entry.phase === "patch-planner" ? binding("patch-planner") : null,
  };
  request.patches = entry.phase === "patch-planner"
    ? {
      enabled: true,
      limits: {
        maxNodes: 100,
        maxEdges: 200,
        maxOutputs: 100,
        maxDepth: 20,
        maxFanOut: 20,
      },
    }
    : { enabled: false, limits: null };
  if (entry.phase !== null && entry.sideEffects !== null) {
    const key = {
      finder: "finder",
      "candidate-evaluator": "candidateEvaluator",
      condition: "condition",
      "optimizer-evaluator": "optimizerEvaluator",
      "patch-planner": "patchPlanner",
    }[entry.phase];
    const target = request.activities[key];
    target.sideEffects = entry.sideEffects;
    target.maxCostUsdPerAttempt = fixture.timeoutPolicy.maxCostUsdPerAttempt;
    if (entry.trigger === "attempt-timeout") {
      target.maxAttemptsPerRound = fixture.timeoutPolicy.maxAttemptsPerRound;
      target.timeoutMs = 1;
    }
  }
  return request;
}

function normalOutput(phase, context, index) {
  if (phase === "finder") {
    return [{ key: `candidate-${String(index).padStart(3, "0")}`, value: { source: "h03" } }];
  }
  if (phase === "candidate-evaluator") {
    return context.input.candidates.map(({ key }) => ({ key, verdict: "accept" }));
  }
  if (phase === "condition") return false;
  if (phase === "optimizer-evaluator") return "accept";
  const suffix = String(index).padStart(3, "0");
  return {
    apiVersion: "graphengineering.reacher-z.github.io/patches/v1alpha1",
    kind: "GraphPatch",
    patchId: `cycle-interruption-patch-${suffix}`,
    base: context.input.currentRevision,
    append: {
      nodes: [{
        id: `interrupt-review-${suffix}`,
        kind: "validator",
        inputSchema: {},
        outputSchema: {},
        config: {},
        sideEffects: "none",
      }],
      edges: [{
        id: `interrupt-review-edge-${suffix}`,
        from: { node: "merge" },
        to: { node: `interrupt-review-${suffix}` },
        mode: "value",
      }],
      outputs: {
        [`interruptReview${suffix}`]: { node: `interrupt-review-${suffix}` },
      },
    },
  };
}

function targetOutcomeType(phase) {
  return {
    finder: "DiscoveryCommitted",
    "candidate-evaluator": "CandidateEvaluationCommitted",
    condition: "ModeOutcomeCommitted",
    "optimizer-evaluator": "ModeOutcomeCommitted",
    "patch-planner": "PatchAccepted",
  }[phase];
}

function beforeClaimSettlementOrdinal(phase) {
  return {
    "candidate-evaluator": 1,
    condition: 2,
    "optimizer-evaluator": 2,
  }[phase];
}

function expectedTimeoutCalls(entry, fixture) {
  return fixture.timeoutPolicy.nonRetryableSideEffects.includes(entry.sideEffects)
    ? 1
    : fixture.timeoutPolicy.maxAttemptsPerRound;
}

function targetInDoubtCount(entry) {
  if (entry.sideEffects === null || entry.sideEffects === "none") return 0;
  if (entry.trigger === "during-handler"
      || entry.trigger === "after-handler-before-outcome"
      || entry.trigger === "attempt-timeout") return 1;
  return 0;
}

function projectEventData(events) {
  return events.map((event) => ({
    type: event.type,
    phase: event.type === "ActivityStarted"
      ? event.data.phase
      : event.type === "BudgetReservationSettled"
        ? event.data.phase
        : event.type === "ActivityFailed"
          ? event.data.failure.phase
          : null,
  }));
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
    configureRequest(baseRequest, entry, index, graphHash, fixture),
  );
  const store = new runtime.MemoryCycleControllerEventStore();
  const cancellation = new AbortController();
  const handlerCalls = Object.fromEntries(PHASES.map((phase) => [phase, 0]));
  let repeatedCancellationCount = 0;
  let settlementCount = 0;
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
  const faultHook = (boundary) => {
    if (boundary === "event:BudgetReservationSettled:after-state-before-dispatch") {
      settlementCount += 1;
    }
    if (entry.trigger === "before-claim") {
      if (entry.phase === "finder"
          && boundary === "event:RoundReserved:after-state-before-dispatch") {
        cancellation.abort(new Error(entry.id));
      } else if (entry.phase === "patch-planner"
          && boundary === "event:ModeOutcomeCommitted:after-state-before-dispatch") {
        cancellation.abort(new Error(entry.id));
      } else if (beforeClaimSettlementOrdinal(entry.phase) === settlementCount
          && boundary === "event:BudgetReservationSettled:after-state-before-dispatch") {
        cancellation.abort(new Error(entry.id));
      }
    }
    if (entry.trigger === "after-outcome-before-next-dispatch"
        && entry.phase !== null
        && boundary === `event:${targetOutcomeType(entry.phase)}:after-state-before-dispatch`) {
      cancellation.abort(new Error(entry.id));
    }
    if (entry.trigger === "after-round-commit"
        && boundary === "event:RoundCommitted:after-state-before-dispatch") {
      cancellation.abort(new Error(entry.id));
    }
  };
  const makeHandler = (phase) => (context) => {
    handlerCalls[phase] += 1;
    if (phase === "patch-planner") authority.proposerActivityKey = context.activityKey;
    if (entry.phase === phase && (
      entry.trigger === "during-handler" || entry.trigger === "repeated-cancellation"
    )) {
      cancellation.abort(new Error(entry.id));
      repeatedCancellationCount += 1;
      if (entry.trigger === "repeated-cancellation") {
        cancellation.abort(new Error(`${entry.id}:again`));
        repeatedCancellationCount += 1;
      }
      return new Promise(() => undefined);
    }
    if (entry.phase === phase && entry.trigger === "attempt-timeout") {
      return new Promise(() => undefined);
    }
    const output = entry.trigger === "after-round-commit" && phase === "finder"
      ? []
      : normalOutput(phase, context, index);
    if (entry.phase === phase && entry.trigger === "after-handler-before-outcome") {
      cancellation.abort(new Error(entry.id));
    }
    return {
      output,
      ...(entry.phase === phase && entry.sideEffects !== null
        ? { costUsd: fixture.timeoutPolicy.maxCostUsdPerAttempt }
        : {}),
    };
  };
  if (entry.trigger === "before-first-round") {
    cancellation.abort(new Error(entry.id));
  }
  const activities = {
    finder: makeHandler("finder"),
    candidateEvaluator: makeHandler("candidate-evaluator"),
    ...(request.policy.mode === "while" ? { condition: makeHandler("condition") } : {}),
    ...(request.policy.mode === "evaluator-optimizer"
      ? { optimizerEvaluator: makeHandler("optimizer-evaluator") }
      : {}),
    ...(entry.phase === "patch-planner"
      ? { patchPlanner: makeHandler("patch-planner"), shouldPlanPatch: () => true }
      : {}),
  };
  const result = await runtime.startCycleController(request, graph, {
    eventStore: store,
    lease: {
      leaseId: `${request.controllerRunId}-lease-1`,
      holderId: "cycle-interruption-holder",
      leaseEpoch: 1,
      fencingToken: 1,
      acquiredAt: startedAt,
      expiresAt: "2026-07-26T12:01:00.000Z",
    },
    now: () => new Date(startedAt),
    signal: cancellation.signal,
    faultHook,
    activities,
    ...(entry.phase === "patch-planner"
      ? {
        patchContext: {
          authoritySnapshot: authority,
          policySnapshotHash: "8".repeat(64),
          runState: "active",
          effectiveCapabilities: [],
          succeededNodeIds: ["merge"],
          supportedEdgeModes: ["value"],
        },
      }
      : {}),
  });
  const events = store.snapshot(request.eventStreamId);
  const fold = runtime.foldCycleControllerEvents(events, { requireTerminal: true });
  const expectedExit = entry.trigger === "attempt-timeout" ? "FAILED" : "CANCELLED";
  assert.equal(result.exitReason, expectedExit, `${entry.id}: exit reason`);
  assert.equal(result.status, expectedExit === "FAILED" ? "failed" : "cancelled");
  assert.equal(events.at(-1).type, "ControllerTerminated");
  assert.equal(events.filter(({ type }) => type === "ControllerTerminated").length, 1);
  if (entry.trigger === "before-first-round") {
    assert.equal(events.some(({ type }) => type === "RoundReserved"), false);
    assert.equal(events.some(({ type }) => type === "ActivityStarted"), false);
    assert.equal(result.attemptsUsed, 0);
  }
  if (entry.trigger === "after-round-commit") {
    assert.equal(events.filter(({ type }) => type === "RoundCommitted").length, 1);
    assert.equal(result.consecutiveDryRounds, 1, "committed dry count must survive cancellation");
  }
  if (entry.phase !== null) {
    const starts = events.filter(({ type, data }) => (
      type === "ActivityStarted" && data.phase === entry.phase
    ));
    const outcomes = events.filter(({ type }) => type === targetOutcomeType(entry.phase));
    const failures = events.filter(({ type, data }) => (
      type === "ActivityFailed" && data.failure.phase === entry.phase
    ));
    const phaseSettlements = events.filter(({ type, data }) => (
      type === "BudgetReservationSettled" && data.phase === entry.phase
    ));
    if (entry.trigger === "before-claim") {
      assert.equal(handlerCalls[entry.phase], 0);
      assert.equal(starts.length, 0);
      assert.equal(phaseSettlements.length, 0);
    } else if (entry.trigger === "attempt-timeout") {
      const expectedCalls = expectedTimeoutCalls(entry, fixture);
      assert.equal(handlerCalls[entry.phase], expectedCalls);
      assert.equal(starts.length, expectedCalls);
      assert.equal(failures.length, expectedCalls);
      assert.equal(phaseSettlements.length, expectedCalls);
      assert.equal(outcomes.length, 0);
      for (const failure of failures) {
        assert.equal(failure.data.failure.code, fixture.timeoutPolicy.stableFailureCode);
        assert.equal(failure.data.failure.retryable, true);
        assert.equal(failure.data.failure.inDoubt, entry.sideEffects !== "none");
        assert.equal(failure.data.usage.costUsd, fixture.timeoutPolicy.maxCostUsdPerAttempt);
      }
      for (const settlement of phaseSettlements) {
        assert.deepEqual(settlement.data.committed, {
          attempts: 1,
          costUsd: fixture.timeoutPolicy.maxCostUsdPerAttempt,
          dynamicNodes: 0,
        });
      }
      assert.equal(
        result.costUsd,
        expectedCalls * fixture.timeoutPolicy.maxCostUsdPerAttempt,
      );
      assert.equal(fold.terminalObservation?.failureCode, fixture.timeoutPolicy.stableFailureCode);
    } else {
      assert.equal(handlerCalls[entry.phase], 1);
      assert.equal(starts.length, 1);
      assert.equal(failures.length, 0, `${entry.id}: cancellation is not ActivityFailed`);
      assert.equal(phaseSettlements.length, 1, `${entry.id}: claim must settle exactly once`);
      const expectedDynamicNodes = entry.phase === "patch-planner"
        && entry.trigger === "after-outcome-before-next-dispatch" ? 1 : 0;
      assert.deepEqual(phaseSettlements[0].data.committed, {
        attempts: 1,
        costUsd: fixture.timeoutPolicy.maxCostUsdPerAttempt,
        dynamicNodes: expectedDynamicNodes,
      }, `${entry.id}: exact claim settlement`);
      assert.equal(result.costUsd, fixture.timeoutPolicy.maxCostUsdPerAttempt);
      assert.equal(
        outcomes.length,
        entry.trigger === "after-outcome-before-next-dispatch" ? 1 : 0,
      );
    }
    assert.equal(fold.inDoubtActivities.length, targetInDoubtCount(entry));
    if (entry.trigger === "after-outcome-before-next-dispatch"
        && entry.phase === "patch-planner") {
      assert.equal(result.lastGraphRevision, 2);
    }
    if (entry.trigger === "after-outcome-before-next-dispatch"
        && entry.phase === "finder") {
      assert.equal(result.seenCount, 1, "committed discovery must remain visible");
    }
    if (entry.trigger === "after-outcome-before-next-dispatch"
        && entry.phase === "candidate-evaluator") {
      assert.equal(result.acceptedCount, 1, "committed verdict must remain visible");
    }
  }
  if (entry.trigger !== "after-round-commit") {
    assert.equal(events.some(({ type }) => type === "RoundCommitted"), false);
    assert.equal(result.consecutiveDryRounds, 0);
  }
  if (entry.trigger === "repeated-cancellation") {
    assert.equal(repeatedCancellationCount, 2);
    assert.equal(events.filter(({ type }) => type === "ControllerTerminated").length, 1);
  }
  const replayed = await runtime.replayCycleController(store, request.eventStreamId);
  assert.deepEqual(replayed.terminalResult, result);
  const beforeTerminalResume = events.length;
  let terminalHandlerCalls = 0;
  let terminalClockCalls = 0;
  const forbidden = () => {
    terminalHandlerCalls += 1;
    throw new Error(`${entry.id}: terminal resume dispatched a handler`);
  };
  const terminal = await runtime.resumeCycleController(request, graph, {
    eventStore: store,
    expectedSequence: events.at(-1).sequence,
    lease: {
      leaseId: `${request.controllerRunId}-lease-2`,
      holderId: "cycle-interruption-terminal-holder",
      leaseEpoch: 2,
      fencingToken: 2,
      acquiredAt: startedAt,
      expiresAt: "2026-07-26T12:02:00.000Z",
    },
    now: () => {
      terminalClockCalls += 1;
      throw new Error(`${entry.id}: terminal resume sampled the clock`);
    },
    activities: {
      finder: forbidden,
      candidateEvaluator: forbidden,
      condition: forbidden,
      optimizerEvaluator: forbidden,
      patchPlanner: forbidden,
    },
  });
  assert.deepEqual(terminal, result);
  assert.equal(store.snapshot(request.eventStreamId).length, beforeTerminalResume);
  assert.equal(terminalHandlerCalls, 0);
  assert.equal(terminalClockCalls, 0);
  const checkpoint = runtime.createCycleControllerCheckpoint(
    events,
    `${request.controllerRunId}-terminal`,
    checkpointAt,
  );
  return {
    entry,
    resultCanonical: core.canonicalSerialize(result),
    eventTypes: events.map(({ type }) => type),
    eventCanonical: events.map((event) => core.canonicalSerialize(event)),
    recordHashes: events.map(({ recordHash }) => recordHash),
    activityPath: projectEventData(events),
    handlerCalls,
    repeatedCancellationCount,
    failures: events.filter(({ type }) => type === "ActivityFailed").map(({ data }) => data),
    settlements: events.filter(({ type }) => type === "BudgetReservationSettled").map(({ data }) => data),
    inDoubtActivities: fold.inDoubtActivities,
    checkpointCanonical: core.canonicalSerialize(checkpoint),
    terminalResumeZeroWrite: true,
    terminalResumeHandlerCalls: terminalHandlerCalls,
    terminalResumeClockCalls: terminalClockCalls,
  };
}

export async function exerciseCycleActivityInterruptionCampaign(options) {
  const matrix = options.runtime.buildCycleActivityInterruptionMatrix();
  assert.equal(matrix.length, options.fixture.expect.matrixEntryCount);
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
