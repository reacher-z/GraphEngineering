import assert from "node:assert/strict";

class SetupCrash extends Error {}

function binding(id, digit) {
  return {
    activityId: id,
    implementationHash: digit.repeat(64),
    sideEffects: "none",
    maxAttemptsPerRound: 1,
    maxCostUsdPerAttempt: 0,
    timeoutMs: 100,
  };
}

function configureRequest(base, index, graphHash, suffix = "root") {
  const request = JSON.parse(JSON.stringify(base));
  const ordinal = String(index).padStart(3, "0");
  const identity = `cycle-operation-${ordinal}-${suffix}`;
  Object.assign(request, {
    controllerRunId: identity,
    controllerId: `${identity}-controller`,
    hostRun: {
      relationship: "standalone-child-controller",
      runId: `${identity}-host`,
    },
    eventStreamId: `${identity}.events`,
    checkpointScope: `${identity}.checkpoints`,
    initialGraph: {
      graphRevision: 1,
      graphHash,
      revisionHash: "1".repeat(64),
    },
    policy: {
      ...request.policy,
      mode: "until-dry",
      maxIterations: 1,
      maxDurationMs: 10_000,
      maxCostUsd: 10,
      maxTotalAttempts: 10,
      maxDiscoveries: 10,
      maxDynamicNodes: 0,
      maxCandidatesPerRound: 10,
      maxCandidateBytes: 4_096,
      maxCandidateBatchBytes: 16_384,
      consecutiveDryRounds: 2,
    },
    activities: {
      finder: binding("finder", "1"),
      candidateEvaluator: binding("candidate-evaluator", "2"),
      condition: null,
      optimizerEvaluator: null,
      patchPlanner: null,
    },
    patches: { enabled: false, limits: null },
    lineage: { origin: "start" },
  });
  return request;
}

function lease(runId, epoch, startedAt) {
  return {
    leaseId: `${runId}-lease-${epoch}`,
    holderId: "cycle-operation-holder",
    leaseEpoch: epoch,
    fencingToken: epoch,
    acquiredAt: startedAt,
    expiresAt: "2026-07-27T12:05:00.000Z",
  };
}

function operationActivities(counter) {
  return {
    finder: () => {
      counter.finder += 1;
      return { output: [] };
    },
    candidateEvaluator: () => {
      counter.candidateEvaluator += 1;
      return { output: [] };
    },
  };
}

async function createActivePrefix(runtime, request, graph, store, startedAt) {
  let crashed = false;
  try {
    await runtime.startCycleController(request, graph, {
      eventStore: store,
      lease: lease(request.controllerRunId, 1, startedAt),
      now: () => new Date(startedAt),
      activities: operationActivities({ finder: 0, candidateEvaluator: 0 }),
      faultHook: (boundary) => {
        if (!crashed && boundary === "event:LeaseAcquired:after-state-before-dispatch") {
          crashed = true;
          throw new SetupCrash("active prefix retained");
        }
      },
    });
    assert.fail("active-prefix setup did not stop after LeaseAcquired");
  } catch (error) {
    assert.ok(error instanceof SetupCrash, "active-prefix setup failed unexpectedly");
  }
  assert.deepEqual(
    store.snapshot(request.eventStreamId).map(({ type }) => type),
    ["ControllerCreated", "LeaseAcquired"],
  );
}

async function createTerminalPrefix(runtime, request, graph, store, checkpoints, startedAt) {
  return runtime.startCycleController(request, graph, {
    eventStore: store,
    checkpointStore: checkpoints,
    lease: lease(request.controllerRunId, 1, startedAt),
    now: () => new Date(startedAt),
    activities: operationActivities({ finder: 0, candidateEvaluator: 0 }),
  });
}

async function exerciseEntry({
  runtime,
  core,
  graph,
  graphHash,
  baseRequest,
  entry,
  index,
  startedAt,
}) {
  const store = new runtime.MemoryCycleControllerEventStore();
  const checkpoints = new runtime.MemoryCycleControllerCheckpointStore();
  const rootRequest = runtime.validateCycleControllerRequest(
    configureRequest(baseRequest, index, graphHash),
  );
  let operationRequest = rootRequest;
  let targetStreamId = rootRequest.eventStreamId;
  let parentStreamId = rootRequest.eventStreamId;
  let parentCanonical = [];

  if (entry.operation === "pause" || entry.operation === "resume" || entry.operation === "fork") {
    await createActivePrefix(runtime, rootRequest, graph, store, startedAt);
  } else {
    await createTerminalPrefix(runtime, rootRequest, graph, store, checkpoints, startedAt);
  }

  if (entry.operation === "resume") {
    const prefix = store.snapshot(rootRequest.eventStreamId);
    await runtime.pauseCycleController(rootRequest, {
      eventStore: store,
      checkpointStore: checkpoints,
      expectedSequence: prefix.at(-1).sequence,
      now: () => new Date(startedAt),
    });
  }

  if (entry.operation === "fork") {
    const parentEvents = store.snapshot(rootRequest.eventStreamId);
    const parentFold = await runtime.replayCycleController(store, rootRequest.eventStreamId);
    const child = configureRequest(baseRequest, index, graphHash, "child");
    child.initialGraph = parentFold.currentRevision;
    child.lineage = {
      origin: "fork",
      parentControllerRunId: rootRequest.controllerRunId,
      parentSequence: parentEvents.at(-1).sequence,
      parentHistoryHash: parentEvents.at(-1).recordHash,
    };
    operationRequest = runtime.validateCycleControllerRequest(child);
    targetStreamId = operationRequest.eventStreamId;
    parentStreamId = rootRequest.eventStreamId;
    parentCanonical = parentEvents.map((event) => core.canonicalSerialize(event));
  }

  const before = store.snapshot(targetStreamId);
  const cancellation = new AbortController();
  const handlerCalls = { finder: 0, candidateEvaluator: 0 };
  let boundaryHits = 0;
  const faultHook = (boundary) => {
    if (boundary === entry.boundary) {
      boundaryHits += 1;
      cancellation.abort(new Error(entry.id));
    }
  };
  let operationResult = null;
  let error = null;
  try {
    if (entry.operation === "pause") {
      operationResult = await runtime.pauseCycleController(operationRequest, {
        eventStore: store,
        checkpointStore: checkpoints,
        expectedSequence: before.at(-1).sequence,
        now: () => new Date(startedAt),
        signal: cancellation.signal,
        faultHook,
      });
    } else if (entry.operation === "resume") {
      operationResult = await runtime.resumeCycleController(operationRequest, graph, {
        eventStore: store,
        checkpointStore: checkpoints,
        expectedSequence: before.at(-1).sequence,
        lease: lease(operationRequest.controllerRunId, 2, startedAt),
        now: () => new Date(startedAt),
        signal: cancellation.signal,
        faultHook,
        activities: operationActivities(handlerCalls),
      });
    } else if (entry.operation === "replay") {
      operationResult = await runtime.replayCycleController(
        store,
        targetStreamId,
        undefined,
        { signal: cancellation.signal, faultHook },
      );
    } else {
      operationResult = await runtime.forkCycleController(
        store,
        parentStreamId,
        operationRequest,
        graph,
        {
          eventStore: store,
          checkpointStore: checkpoints,
          lease: lease(operationRequest.controllerRunId, 1, startedAt),
          now: () => new Date(startedAt),
          signal: cancellation.signal,
          faultHook,
          activities: operationActivities(handlerCalls),
        },
      );
    }
  } catch (caught) {
    error = caught;
  }

  assert.equal(boundaryHits, 1, `${entry.id}: target boundary count`);
  const after = store.snapshot(targetStreamId);
  const appended = after.slice(before.length);
  const errorCode = error?.code ?? null;
  const result = entry.operation === "replay"
    ? operationResult?.terminalResult ?? null
    : entry.operation === "pause"
      ? null
      : operationResult;
  const observedOutcome = errorCode === "GE_CYCLE_OPERATION_CANCELLED"
    ? "operation-cancelled"
    : result?.exitReason === "CANCELLED"
      ? "controller-cancelled"
      : "committed-result";
  assert.equal(observedOutcome, entry.outcome, `${entry.id}: outcome`);
  if (entry.outcome === "operation-cancelled") {
    assert.equal(errorCode, "GE_CYCLE_OPERATION_CANCELLED", `${entry.id}: error code`);
    assert.deepEqual(error.details, {
      operation: entry.operation,
      boundary: entry.boundary,
    });
    assert.equal(appended.length, 0, `${entry.id}: pre-commit/read-only write`);
  } else {
    assert.equal(error, null, `${entry.id}: committed operation must return`);
    assert.ok(appended.length > 0, `${entry.id}: committed operation has no event`);
  }
  if (entry.outcome === "controller-cancelled") {
    assert.equal(result.exitReason, "CANCELLED", `${entry.id}: terminal result`);
    assert.equal(handlerCalls.finder + handlerCalls.candidateEvaluator, 0);
  }
  if (entry.operation === "replay") {
    assert.equal(appended.length, 0, `${entry.id}: replay wrote an event`);
    assert.equal(handlerCalls.finder + handlerCalls.candidateEvaluator, 0);
  }
  if (entry.operation === "pause" && entry.outcome === "committed-result") {
    assert.deepEqual(appended.map(({ type }) => type), ["LeaseReleased"]);
  }
  const checkpoint = entry.operation === "pause" && entry.outcome === "committed-result"
    ? await checkpoints.read(
      operationRequest.checkpointScope,
      `${operationRequest.controllerRunId}-latest`,
    )
    : null;
  if (entry.operation === "pause" && entry.outcome === "committed-result") {
    assert.notEqual(checkpoint, null, `${entry.id}: committed pause checkpoint`);
  }
  return {
    entry,
    boundaryHits,
    observedOutcome,
    errorCode,
    errorDetails: error?.details ?? null,
    operationResultCanonical: result === null ? null : core.canonicalSerialize(result),
    handlerCalls,
    baselineEventCount: before.length,
    appendedEventTypes: appended.map(({ type }) => type),
    appendedEventCanonical: appended.map((event) => core.canonicalSerialize(event)),
    streamEventTypes: after.map(({ type }) => type),
    streamEventCanonical: after.map((event) => core.canonicalSerialize(event)),
    recordHashes: after.map(({ recordHash }) => recordHash),
    parentCanonical,
    checkpointCanonical: checkpoint === null ? null : core.canonicalSerialize(checkpoint),
  };
}

export async function exerciseCycleOperationInterruptionCampaign(options) {
  const matrix = options.runtime.buildCycleOperationInterruptionMatrix();
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
