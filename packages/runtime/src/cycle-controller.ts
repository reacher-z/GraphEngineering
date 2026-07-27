import { canonicalHash, canonicalSerialize, compileGraph, type GraphSpec } from "@graph-engineering/core";
import {
  CycleActivityFailure,
  CycleControllerError,
  type CycleActivityBinding,
  type CycleActivityContext,
  type CycleActivityExecution,
  type CycleActivityHandler,
  type CycleActivityPhase,
  type CycleBudgetDelta,
  type CycleCandidate,
  type CycleCandidateVerdict,
  type CycleControllerActivities,
  type CycleControllerCheckpoint,
  type CycleControllerEvent,
  type CycleControllerFold,
  type CycleControllerRequest,
  type CycleControllerResult,
  type CycleControllerRunOptions,
  type CycleExitObservation,
  type CycleExitReason,
  type CycleGraphCoordinate,
  type CycleModeOutcome,
  type CycleResumeOptions,
  type CycleUsage,
  type GraphPatch,
  type GraphPatchApplication,
  type GraphPatchDecision,
} from "./cycle-types.js";
import {
  createCycleControllerEvent,
  createCycleInlinePayload,
  createCycleRoundPlan,
  cycleActivityKey,
  cycleControllerHash,
  cycleControllerIdentity,
  cycleRequestHash,
  cycleStatus,
  decodeCycleInlinePayload,
  observeCycleExit,
  selectCycleExitReason,
  validateCycleCandidates,
  validateCycleControllerRequest,
  validateCycleLease,
  validateCycleVerdicts,
  validateGraphPatchShape,
} from "./cycle-contract.js";
import {
  createCycleControllerCheckpoint,
  foldCycleControllerEvents,
  readCycleControllerEvents,
  validateCycleControllerCheckpoint,
  type FoldCycleOptions,
} from "./cycle-fold.js";
import { NativeGraphPatchApplier } from "./graph-patch.js";
import { snapshotJson } from "./json.js";
import type { JsonValue } from "./types.js";

interface ClockSample {
  readonly timestamp: string;
  readonly elapsedMs: number;
  readonly remainingMs: number;
}

class TrustedCycleClock {
  readonly #now: () => Date;
  readonly #startedMs: number;
  readonly #deadlineMs: number;
  readonly #runId: string;
  #lastMs: number;

  constructor(
    now: () => Date,
    startedAt: string,
    deadlineAt: string,
    lastTimestamp: string,
    runId: string,
  ) {
    this.#now = now;
    this.#startedMs = Date.parse(startedAt);
    this.#deadlineMs = Date.parse(deadlineAt);
    this.#lastMs = Date.parse(lastTimestamp);
    this.#runId = runId;
    if (!Number.isFinite(this.#startedMs) || !Number.isFinite(this.#deadlineMs)
        || !Number.isFinite(this.#lastMs) || this.#deadlineMs < this.#startedMs) {
      throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", runId, "stored clock envelope is invalid");
    }
  }

  sample(): ClockSample {
    let value: Date;
    try {
      value = this.#now();
    } catch (error) {
      throw new CycleControllerError(
        "GE_CYCLE_ACTIVITY_FAILED", this.#runId, "trusted clock adapter failed", {}, { cause: error },
      );
    }
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new CycleControllerError("GE_CYCLE_ACTIVITY_FAILED", this.#runId, "trusted clock returned an invalid date");
    }
    const milliseconds = value.getTime();
    if (milliseconds < this.#lastMs) {
      throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", this.#runId, "trusted clock rolled back");
    }
    this.#lastMs = milliseconds;
    const elapsedMs = milliseconds - this.#startedMs;
    if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 2_147_483_647) {
      throw new CycleControllerError("GE_CYCLE_COUNTER_MISMATCH", this.#runId, "elapsed duration is not portable");
    }
    return Object.freeze({
      timestamp: value.toISOString(),
      elapsedMs,
      remainingMs: Math.max(0, this.#deadlineMs - milliseconds),
    });
  }
}

class CycleJournal {
  readonly request: CycleControllerRequest;
  readonly controllerHash: string;
  readonly requestHash: string;
  readonly options: CycleControllerRunOptions;
  readonly parent: CycleControllerFold | undefined;
  readonly clock: TrustedCycleClock;
  readonly events: CycleControllerEvent[];
  #cachedFold: CycleControllerFold | undefined;

  constructor(fields: {
    readonly request: CycleControllerRequest;
    readonly options: CycleControllerRunOptions;
    readonly events: readonly CycleControllerEvent[];
    readonly parent?: CycleControllerFold;
    readonly clock: TrustedCycleClock;
  }) {
    this.request = fields.request;
    this.controllerHash = cycleControllerHash(fields.request);
    this.requestHash = cycleRequestHash(fields.request);
    this.options = fields.options;
    this.events = [...fields.events];
    this.parent = fields.parent;
    this.clock = fields.clock;
    this.#cachedFold = fields.events.length === 0
      ? undefined
      : foldCycleControllerEvents(
        fields.events,
        fields.parent === undefined ? {} : { parent: fields.parent },
      );
  }

  get fold(): CycleControllerFold {
    if (this.#cachedFold === undefined) {
      this.#cachedFold = foldCycleControllerEvents(
        this.events, this.parent === undefined ? {} : { parent: this.parent },
      );
    }
    return this.#cachedFold;
  }

  async append(
    type: CycleControllerEvent["type"],
    data: Readonly<Record<string, unknown>>,
    fields: {
      readonly graphRevision?: number;
      readonly lease?: CycleControllerEvent["lease"];
      readonly sample?: ClockSample;
    } = {},
  ): Promise<CycleControllerEvent> {
    const sequence = this.events.length;
    const sample = fields.sample ?? this.clock.sample();
    const currentFold = sequence === 0 ? undefined : this.fold;
    const graphRevision = fields.graphRevision
      ?? currentFold?.currentRevision.graphRevision
      ?? this.request.initialGraph.graphRevision;
    const lease = fields.lease === undefined
      ? (type === "ControllerCreated" ? null : currentFold?.activeLease ?? null)
      : fields.lease;
    let eventId: string;
    try {
      eventId = (this.options.createEventId ?? ((context) => `${context.controllerRunId}-${context.sequence}`))({
        controllerRunId: this.request.controllerRunId,
        sequence,
        type,
      });
      if (typeof eventId !== "string" || eventId.length === 0) throw new TypeError("empty event ID");
    } catch (error) {
      throw new CycleControllerError(
        "GE_CYCLE_STORE_FAILED", this.request.controllerRunId,
        "event ID factory failed before durable append", { type, sequence }, { cause: error },
      );
    }
    const event = createCycleControllerEvent({
      request: this.request,
      controllerHash: this.controllerHash,
      requestHash: this.requestHash,
      type,
      data: snapshotJson(data) as unknown as Readonly<Record<string, unknown>>,
      graphRevision,
      sequence,
      previousEventHash: this.events.at(-1)?.recordHash ?? null,
      lease,
      timestamp: sample.timestamp,
      eventId,
    });
    // Never let an invalid locally-constructed transition poison the
    // authoritative stream. The exact candidate prefix must fold before CAS.
    let candidateFold: CycleControllerFold;
    try {
      candidateFold = foldCycleControllerEvents(
        [...this.events, event],
        this.parent === undefined ? {} : { parent: this.parent },
      );
    } catch (error) {
      if (error instanceof CycleControllerError) throw error;
      throw new CycleControllerError(
        "GE_CYCLE_INVALID_HISTORY", this.request.controllerRunId,
        "locally constructed event failed semantic preflight", { type, sequence }, { cause: error },
      );
    }
    try {
      const committedSequence = await this.options.eventStore.append(
        this.request.eventStreamId, sequence - 1, [event],
      );
      if (committedSequence !== sequence) {
        throw new CycleControllerError(
          "GE_CYCLE_STORE_FAILED", this.request.controllerRunId,
          "cycle event store returned an impossible committed sequence",
          { type, sequence, committedSequence },
        );
      }
    } catch (error) {
      if (error instanceof CycleControllerError) throw error;
      throw new CycleControllerError(
        "GE_CYCLE_STORE_FAILED", this.request.controllerRunId,
        "cycle event append failed", { type, sequence }, { cause: error },
      );
    }
    this.events.push(event);
    // The pre-CAS fold is also the authoritative new in-memory projection.
    this.#cachedFold = candidateFold;
    const folded = candidateFold;
    const interval = this.options.checkpointEveryEvents ?? 0;
    if (this.options.checkpointStore !== undefined
        && (type === "ControllerTerminated" || (interval > 0 && this.events.length % interval === 0))) {
      const checkpointId = `${this.request.controllerRunId}-latest`;
      const checkpoint = createCycleControllerCheckpoint(
        this.events, checkpointId, sample.timestamp,
        this.parent === undefined ? {} : { parent: this.parent },
      );
      try {
        await this.options.checkpointStore.write(this.request.checkpointScope, checkpointId, checkpoint);
      } catch (error) {
        throw new CycleControllerError(
          "GE_CYCLE_STORE_FAILED", this.request.controllerRunId,
          "checkpoint write failed after the event remained durable",
          { sequence: folded.lastSequence }, { cause: error },
        );
      }
    }
    return event;
  }
}

function phaseBinding(request: CycleControllerRequest, phase: CycleActivityPhase): CycleActivityBinding {
  const binding = phase === "finder" ? request.activities.finder
    : phase === "candidate-evaluator" ? request.activities.candidateEvaluator
      : phase === "condition" ? request.activities.condition
        : phase === "optimizer-evaluator" ? request.activities.optimizerEvaluator
          : request.activities.patchPlanner;
  if (binding === null) throw new CycleControllerError("GE_CYCLE_INVALID_REQUEST", request.controllerRunId, `missing ${phase} binding`);
  return binding;
}

function phasePlan(fold: CycleControllerFold, phase: CycleActivityPhase) {
  const plan = fold.openRound?.plan;
  if (plan === undefined) throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", fold.request.controllerRunId, "activity has no round plan");
  const entry = phase === "finder" ? plan.finder
    : phase === "candidate-evaluator" ? plan.candidateEvaluator
      : phase === "condition" || phase === "optimizer-evaluator" ? plan.modeActivity
        : plan.patchPlanner;
  if (entry === null) throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", fold.request.controllerRunId, `round plan omits ${phase}`);
  return entry;
}

function activityInput(
  fold: CycleControllerFold,
  phase: CycleActivityPhase,
  graph: GraphSpec,
): JsonValue {
  const objective = decodeCycleInlinePayload(
    fold.request.objective, 4_194_304, fold.request.controllerRunId,
  );
  const discovery = fold.openRound?.discovery;
  const evaluation = fold.openRound?.evaluation;
  if (phase === "finder") {
    return snapshotJson({
      objective,
      currentRevision: fold.currentRevision,
      remainingDiscoveryCredit: fold.request.policy.maxDiscoveries - fold.seenKeys.length,
    });
  }
  if (phase === "candidate-evaluator") {
    if (discovery === null || discovery === undefined) throw new TypeError("candidate evaluation has no discovery");
    const fresh = new Set(discovery.freshKeys);
    const emitted = new Set<string>();
    return snapshotJson({
      objective,
      candidates: discovery.candidates.filter((candidate) => {
        if (!fresh.has(candidate.key) || emitted.has(candidate.key)) return false;
        emitted.add(candidate.key);
        return true;
      }),
    });
  }
  if (phase === "condition" || phase === "optimizer-evaluator") {
    if (discovery === null || discovery === undefined || evaluation === null || evaluation === undefined) {
      throw new TypeError("mode activity has no evaluated candidates");
    }
    return snapshotJson({
      objective,
      candidates: discovery.candidates,
      verdicts: evaluation.verdicts,
      graphHash: canonicalHash(graph),
    });
  }
  if (discovery === null || discovery === undefined || evaluation === null || evaluation === undefined
      || fold.openRound?.modeOutcome === null || fold.openRound?.modeOutcome === undefined) {
    throw new TypeError("patch planner has no complete round input");
  }
  return snapshotJson({
    objective,
    candidates: discovery.candidates,
    verdicts: evaluation.verdicts,
    modeOutcome: fold.openRound.modeOutcome,
    currentRevision: fold.currentRevision,
  });
}

function signalFailure(
  signal: AbortSignal,
  phase: CycleActivityPhase,
  sideEffects: CycleActivityBinding["sideEffects"],
): CycleActivityFailure {
  return new CycleActivityFailure(
    "GE_CYCLE_ACTIVITY_CANCELLED", `${phase} was cancelled`, {
      retryable: false,
      inDoubt: sideEffects !== "none",
      cause: signal.reason,
    },
  );
}

async function invokeActivity<T>(
  handler: CycleActivityHandler<T>,
  context: CycleActivityContext,
  binding: CycleActivityBinding,
  outerSignal: AbortSignal | undefined,
): Promise<CycleActivityExecution<T>> {
  if (outerSignal?.aborted) throw signalFailure(outerSignal, context.phase, binding.sideEffects);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectBoundary!: (reason: unknown) => void;
  const boundary = new Promise<never>((_resolve, reject) => { rejectBoundary = reject; });
  timer = setTimeout(() => {
    controller.abort(new Error("activity timeout"));
    rejectBoundary(new CycleActivityFailure(
      "GE_CYCLE_ACTIVITY_TIMEOUT", `${context.phase} exceeded timeout`, {
        retryable: true,
        inDoubt: binding.sideEffects !== "none",
      },
    ));
  }, binding.timeoutMs);
  let rejectCancellation: ((reason: unknown) => void) | undefined;
  const onOuterAbort = (): void => {
    controller.abort(outerSignal?.reason);
    rejectCancellation?.(signalFailure(
      outerSignal as AbortSignal, context.phase, binding.sideEffects,
    ));
  };
  const cancellation = outerSignal === undefined
    ? new Promise<never>(() => undefined)
    : new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
      if (outerSignal.aborted) onOuterAbort();
      else outerSignal.addEventListener("abort", onOuterAbort, { once: true });
    });
  const call = Promise.resolve().then(() => handler({ ...context, signal: controller.signal }));
  // A handler that swallows cancellation may resolve later. The detached call
  // is observed to avoid unhandled rejection, but its late result is never
  // durably committed after the boundary promise wins.
  void call.catch(() => undefined);
  try {
    const result = await Promise.race([call, boundary, cancellation]);
    const captured = snapshotJson(result) as unknown as CycleActivityExecution<T>;
    if (typeof captured !== "object" || captured === null || !("output" in captured)) {
      throw new CycleActivityFailure("GE_CYCLE_INVALID_ACTIVITY_OUTPUT", "activity returned no closed output");
    }
    const activityCost = captured.costUsd ?? 0;
    if (typeof activityCost !== "number" || !Number.isFinite(activityCost) || activityCost < 0
        || activityCost > binding.maxCostUsdPerAttempt) {
      throw new CycleActivityFailure("GE_CYCLE_INVALID_ACTIVITY_OUTPUT", "activity usage exceeds its declared ceiling");
    }
    return captured;
  } catch (error) {
    if (error instanceof CycleActivityFailure) throw error;
    throw new CycleActivityFailure("GE_CYCLE_ACTIVITY_FAILED", `${context.phase} failed`, {
      retryable: false,
      inDoubt: binding.sideEffects !== "none",
      cause: error,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

interface ActivitySuccess<T> {
  readonly execution: CycleActivityExecution<T>;
  readonly activityKey: string;
  readonly usage: CycleUsage;
}

interface ActivityFailureResult {
  readonly failure: CycleActivityFailure;
}

interface PendingSettlementEvidence {
  readonly phase: CycleActivityPhase;
  readonly delta: CycleBudgetDelta;
  readonly failure: {
    readonly code: string;
    readonly retryable: boolean;
    readonly attempt: number;
  } | null;
}

interface UnresolvedFailureEvidence {
  readonly phase: CycleActivityPhase;
  readonly code: string;
  readonly retryable: boolean;
  readonly attempt: number;
}

function pendingSettlementEvidence(
  events: readonly CycleControllerEvent[],
  iteration: number,
): PendingSettlementEvidence | null {
  let pending: PendingSettlementEvidence | null = null;
  for (const event of events) {
    if (event.data.iteration !== iteration) continue;
    if (event.type === "ActivityFailed") {
      const failure = event.data.failure as {
        readonly phase: CycleActivityPhase;
        readonly code: string;
        readonly retryable: boolean;
      };
      const usage = event.data.usage as CycleUsage;
      pending = Object.freeze({
        phase: failure.phase,
        delta: Object.freeze({ attempts: usage.attempts, costUsd: usage.costUsd, dynamicNodes: 0 }),
        failure: Object.freeze({
          code: failure.code,
          retryable: failure.retryable,
          attempt: event.data.attempt as number,
        }),
      });
    } else if (event.type === "DiscoveryCommitted") {
      const usage = event.data.usage as CycleUsage;
      pending = Object.freeze({
        phase: "finder",
        delta: Object.freeze({ attempts: usage.attempts, costUsd: usage.costUsd, dynamicNodes: 0 }),
        failure: null,
      });
    } else if (event.type === "CandidateEvaluationCommitted") {
      const usage = event.data.usage as CycleUsage;
      pending = Object.freeze({
        phase: "candidate-evaluator",
        delta: Object.freeze({ attempts: usage.attempts, costUsd: usage.costUsd, dynamicNodes: 0 }),
        failure: null,
      });
    } else if (event.type === "ModeOutcomeCommitted") {
      const usage = event.data.usage as CycleUsage;
      if (usage.attempts > 0) {
        const outcome = event.data.outcome as CycleModeOutcome;
        pending = Object.freeze({
          phase: outcome.mode === "while" ? "condition" : "optimizer-evaluator",
          delta: Object.freeze({ attempts: usage.attempts, costUsd: usage.costUsd, dynamicNodes: 0 }),
          failure: null,
        });
      }
    } else if (event.type === "PatchAccepted" || event.type === "PatchRejected") {
      const budgetOutcome = event.data.budgetOutcome as { readonly committed: CycleBudgetDelta };
      pending = Object.freeze({ phase: "patch-planner", delta: budgetOutcome.committed, failure: null });
    } else if (event.type === "BudgetReservationSettled") {
      pending = null;
    }
  }
  return pending;
}

function unresolvedFailureEvidence(
  events: readonly CycleControllerEvent[],
  iteration: number,
): UnresolvedFailureEvidence | null {
  let unresolved: UnresolvedFailureEvidence | null = null;
  for (const event of events) {
    if (event.data.iteration !== iteration) continue;
    if (event.type === "ActivityFailed") {
      const failure = event.data.failure as {
        readonly phase: CycleActivityPhase;
        readonly code: string;
        readonly retryable: boolean;
      };
      unresolved = Object.freeze({
        phase: failure.phase,
        code: failure.code,
        retryable: failure.retryable,
        attempt: event.data.attempt as number,
      });
    } else if (event.type === "ActivityStarted" && unresolved !== null) {
      unresolved = null;
    }
  }
  return unresolved;
}

function openActivityWasCharged(
  events: readonly CycleControllerEvent[],
  activityKey: string,
  phase: CycleActivityPhase,
  attempt: number,
): boolean {
  let startIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as CycleControllerEvent;
    if (event.type === "ActivityStarted" && event.data.activityKey === activityKey
        && event.data.attempt === attempt) {
      startIndex = index;
      break;
    }
  }
  return startIndex >= 0 && events.slice(startIndex + 1).some((event) => (
    event.type === "BudgetReservationSettled" && event.data.phase === phase
  ));
}

function committedForPhase(
  events: readonly CycleControllerEvent[],
  iteration: number,
  phase: CycleActivityPhase,
): CycleBudgetDelta {
  let attempts = 0;
  let costUsd = 0;
  let dynamicNodes = 0;
  for (const event of events) {
    if (event.type !== "BudgetReservationSettled" || event.data.iteration !== iteration
        || event.data.phase !== phase) continue;
    const committed = event.data.committed as CycleBudgetDelta;
    attempts += committed.attempts;
    costUsd += committed.costUsd;
    dynamicNodes += committed.dynamicNodes;
  }
  return Object.freeze({ attempts, costUsd, dynamicNodes });
}

async function settle(
  journal: CycleJournal,
  phase: CycleActivityPhase,
  delta: CycleBudgetDelta,
): Promise<void> {
  const fold = journal.fold;
  const reservation = fold.liveReservations[0];
  if (reservation === undefined || fold.openRound === null) throw new TypeError("settlement has no reservation");
  const remaining = {
    attempts: reservation.remaining.attempts - delta.attempts,
    costUsd: reservation.remaining.costUsd - delta.costUsd,
    dynamicNodes: reservation.remaining.dynamicNodes - delta.dynamicNodes,
  };
  await journal.append("BudgetReservationSettled", {
    iteration: fold.openRound.iteration,
    reservationId: reservation.reservationId,
    phase,
    committed: delta,
    totals: {
      attemptsCommitted: fold.attemptsUsed + delta.attempts,
      costUsdCommitted: fold.costUsd + delta.costUsd,
      dynamicNodesCommitted: fold.dynamicNodes + delta.dynamicNodes,
      liveReservations: remaining,
    },
  });
}

async function executeActivity<T, U = T>(
  journal: CycleJournal,
  applier: NativeGraphPatchApplier,
  phase: CycleActivityPhase,
  handler: CycleActivityHandler<T>,
  validateOutput?: (value: T) => U,
): Promise<ActivitySuccess<U> | ActivityFailureResult> {
  const runId = journal.request.controllerRunId;
  while (true) {
    let fold = journal.fold;
    if (fold.openRound === null) throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", runId, "activity has no open round");
    const binding = phaseBinding(journal.request, phase);
    const planned = phasePlan(fold, phase);
    const input = activityInput(fold, phase, applier.graph);
    const inputHash = canonicalHash(input);
    let open = fold.openRound.openActivity;
    if (open !== null) {
      if (open.phase !== phase || open.inputHash !== inputHash) {
        throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", runId, "resumed activity input or phase drifted");
      }
      if (open.sideEffects === "non-idempotent") {
        throw new CycleControllerError(
          "IN_DOUBT_SIDE_EFFECT", runId,
          "an open non-idempotent cycle activity cannot be resumed automatically",
          { phase, activityKey: open.activityKey },
        );
      }
    } else {
      const priorAttempts = journal.events.filter((event) => (
        event.type === "ActivityStarted"
        && event.data.iteration === fold.openRound?.iteration
        && event.data.phase === phase
      )).length;
      const nextAttempt = priorAttempts + 1;
      if (nextAttempt > planned.maxAttempts) {
        throw new CycleControllerError(
          "GE_CYCLE_INVALID_HISTORY", runId, "activity attempt history exceeds its round plan",
          { phase, nextAttempt, maxAttempts: planned.maxAttempts },
        );
      }
      const activityKey = cycleActivityKey({
        controllerRunId: runId,
        controllerHash: fold.controllerHash,
        iteration: fold.openRound.iteration,
        phase,
        activityId: binding.activityId,
        inputHash,
      });
      await journal.append("ActivityStarted", {
        iteration: fold.openRound.iteration,
        phase,
        activityId: binding.activityId,
        activityKey,
        attempt: nextAttempt,
        sideEffects: binding.sideEffects,
        inputHash,
        reservationId: fold.openRound.reservationId,
      });
      fold = journal.fold;
      open = fold.openRound?.openActivity ?? null;
    }
    if (open === null) throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", runId, "activity claim disappeared");
    const context: CycleActivityContext = Object.freeze({
      request: journal.request,
      graph: applier.graph,
      iteration: open.iteration,
      phase,
      activityKey: open.activityKey,
      idempotencyKey: open.activityKey,
      attempt: open.attempt,
      input,
      seenKeys: fold.seenKeys,
      remainingDiscoveryCredit: journal.request.policy.maxDiscoveries - fold.seenKeys.length,
      signal: new AbortController().signal,
    });
    try {
      const execution = await invokeActivity(handler, context, binding, journal.options.signal);
      let output: U;
      try {
        output = validateOutput === undefined
          ? execution.output as unknown as U
          : validateOutput(execution.output);
      } catch (error) {
        throw new CycleActivityFailure(
          "GE_CYCLE_INVALID_ACTIVITY_OUTPUT", `${phase} returned an invalid semantic output`, {
            retryable: true,
            inDoubt: binding.sideEffects !== "none",
            costUsd: execution.costUsd ?? 0,
            cause: error,
          },
        );
      }
      return Object.freeze({
        execution: Object.freeze({ output, ...(execution.costUsd === undefined ? {} : { costUsd: execution.costUsd }) }),
        activityKey: open.activityKey,
        usage: Object.freeze({ attempts: 1, costUsd: execution.costUsd ?? 0 }),
      });
    } catch (error) {
      const failure = error instanceof CycleActivityFailure
        ? error
        : new CycleActivityFailure("GE_CYCLE_ACTIVITY_FAILED", `${phase} failed`, { cause: error });
      const remaining = journal.fold.liveReservations[0]?.remaining;
      const validCost = typeof failure.costUsd === "number" && Number.isFinite(failure.costUsd)
        && failure.costUsd >= 0 && failure.costUsd <= binding.maxCostUsdPerAttempt
        && failure.costUsd <= (remaining?.costUsd ?? -1);
      const validFailure = validCost
        && typeof failure.retryable === "boolean" && typeof failure.inDoubt === "boolean";
      const code = validFailure && /^GE_[A-Z0-9_]{3,64}$/u.test(failure.code)
        ? failure.code
        : "GE_CYCLE_INVALID_ACTIVITY_OUTPUT";
      const retryable = validFailure && failure.retryable;
      const inDoubt = binding.sideEffects === "non-idempotent"
        || binding.sideEffects === "idempotent" && (!validFailure || failure.inDoubt);
      // An ambiguous external call retains the sound per-attempt maximum.
      // A handler-controlled malformed cost or a zero self-report cannot turn
      // an in-doubt provider/tool side effect into newly spendable credit.
      const costUsd = inDoubt
        ? binding.maxCostUsdPerAttempt
        : validFailure ? failure.costUsd : 0;
      await journal.append("ActivityFailed", {
        iteration: open.iteration,
        activityKey: open.activityKey,
        attempt: open.attempt,
        failure: { phase, code, retryable, inDoubt },
        usage: { attempts: 1, costUsd },
      });
      await settle(journal, phase, { attempts: 1, costUsd, dynamicNodes: 0 });
      const after = journal.fold;
      const recordedFailure = validFailure
        ? failure
        : new CycleActivityFailure(code, `${phase} returned an invalid failure envelope`);
      const canRetry = retryable && open.attempt < planned.maxAttempts
        && !(inDoubt && binding.sideEffects === "non-idempotent")
        && !journal.options.signal?.aborted
        && hardStop(after, journal.clock.sample()) === null;
      if (!canRetry) return Object.freeze({ failure: recordedFailure });
    }
  }
}

function hardStop(fold: CycleControllerFold, sample: ClockSample): CycleExitReason | null {
  const policy = fold.request.policy;
  if (Math.max(fold.durationMs, sample.elapsedMs) >= policy.maxDurationMs) return "MAX_DURATION";
  if (fold.costUsd > 0 && fold.costUsd >= policy.maxCostUsd) return "MAX_COST";
  if (fold.attemptsUsed > 0 && fold.attemptsUsed >= policy.maxTotalAttempts) return "MAX_TOTAL_ATTEMPTS";
  if (fold.dynamicNodes > 0 && fold.dynamicNodes >= policy.maxDynamicNodes) return "MAX_DYNAMIC_NODES";
  return null;
}

function preflightStop(fold: CycleControllerFold, sample: ClockSample): CycleExitReason | null {
  const direct = hardStop(fold, sample);
  if (direct !== null) return direct;
  const policy = fold.request.policy;
  if (fold.seenKeys.length >= policy.maxDiscoveries) return "MAX_DISCOVERIES";
  if (fold.nextIteration - 1 >= policy.maxIterations) return "MAX_ITERATIONS";
  const { maximum } = createCycleRoundPlan(fold.request, policy.maxDynamicNodes - fold.dynamicNodes);
  if (fold.costUsd + maximum.costUsd > policy.maxCostUsd) return "MAX_COST";
  if (fold.attemptsUsed + maximum.attempts > policy.maxTotalAttempts) return "MAX_TOTAL_ATTEMPTS";
  if (fold.dynamicNodes + maximum.dynamicNodes > policy.maxDynamicNodes) return "MAX_DYNAMIC_NODES";
  return null;
}

function convergence(fold: CycleControllerFold): CycleExitObservation["convergenceReason"] {
  const last = fold.committedRounds.at(-1);
  if (last === undefined) return null;
  if (fold.request.policy.mode === "until-dry") {
    return fold.consecutiveDryRounds >= (fold.request.policy.consecutiveDryRounds as number) ? "DRY" : null;
  }
  if (last.modeOutcome.mode === "while") return last.modeOutcome.condition ? null : "CONDITION_FALSE";
  if (last.modeOutcome.mode === "evaluator-optimizer") return last.modeOutcome.verdict === "accept" ? "EVALUATOR_ACCEPTED" : null;
  return null;
}

async function releaseRemaining(
  journal: CycleJournal,
  reason: "round-complete" | "failed" | "cancelled" | "patch-rejected" | "bound-reached",
): Promise<void> {
  const fold = journal.fold;
  const reservation = fold.liveReservations[0];
  if (reservation === undefined || fold.openRound === null) return;
  const remaining = reservation.remaining;
  if (remaining.attempts === 0 && remaining.costUsd === 0 && remaining.dynamicNodes === 0) return;
  await journal.append("BudgetReservationReleased", {
    iteration: fold.openRound.iteration,
    reservationId: reservation.reservationId,
    reason,
    released: remaining,
    remaining: { attempts: 0, costUsd: 0, dynamicNodes: 0 },
    totals: {
      attemptsCommitted: fold.attemptsUsed,
      costUsdCommitted: fold.costUsd,
      dynamicNodesCommitted: fold.dynamicNodes,
      liveReservations: { attempts: 0, costUsd: 0, dynamicNodes: 0 },
    },
  });
}

function forcedObservation(
  fold: CycleControllerFold,
  sample: ClockSample,
  fields: {
    readonly reason?: CycleExitReason;
    readonly failed?: boolean;
    readonly failureCode?: string;
    readonly patchRejected?: boolean;
    readonly cancelled?: boolean;
    readonly unknownVerdict?: boolean;
    readonly convergenceReason?: CycleExitObservation["convergenceReason"];
  },
): CycleExitObservation {
  const base = observeCycleExit({
    policy: fold.request.policy,
    cancelled: fields.cancelled ?? false,
    durationMs: Math.max(fold.durationMs, sample.elapsedMs),
    costUsd: fold.costUsd,
    attemptsUsed: fold.attemptsUsed,
    dynamicNodes: fold.dynamicNodes,
    seenCount: fold.seenKeys.length,
    iterations: fold.nextIteration - 1,
    patchRejected: fields.patchRejected ?? false,
    failed: fields.failed ?? false,
    failureCode: fields.failed ? fields.failureCode ?? "GE_CYCLE_ACTIVITY_FAILED" : null,
    unknownVerdict: fields.unknownVerdict ?? fields.reason === "UNKNOWN_VERDICT",
    convergenceReason: fields.convergenceReason ?? null,
  });
  return Object.freeze({
    ...base,
    maxDuration: base.maxDuration || fields.reason === "MAX_DURATION",
    maxCost: base.maxCost || fields.reason === "MAX_COST",
    maxTotalAttempts: base.maxTotalAttempts || fields.reason === "MAX_TOTAL_ATTEMPTS",
    maxDynamicNodes: base.maxDynamicNodes || fields.reason === "MAX_DYNAMIC_NODES",
    maxDiscoveries: base.maxDiscoveries || fields.reason === "MAX_DISCOVERIES",
    maxIterations: base.maxIterations || fields.reason === "MAX_ITERATIONS",
    patchRejected: base.patchRejected || fields.reason === "PATCH_REJECTED",
    unknownVerdict: base.unknownVerdict || fields.reason === "UNKNOWN_VERDICT",
  });
}

async function terminate(
  journal: CycleJournal,
  fields: {
    readonly reason?: CycleExitReason;
    readonly failed?: boolean;
    readonly failureCode?: string;
    readonly patchRejected?: boolean;
    readonly cancelled?: boolean;
    readonly unknownVerdict?: boolean;
    readonly convergenceReason?: CycleExitObservation["convergenceReason"];
  },
): Promise<CycleControllerResult> {
  const openActivity = journal.fold.openRound?.openActivity;
  if (openActivity !== null && openActivity !== undefined) {
    let startIndex = -1;
    for (let index = journal.events.length - 1; index >= 0; index -= 1) {
      const event = journal.events[index] as CycleControllerEvent;
      if (event.type === "ActivityStarted" && event.data.activityKey === openActivity.activityKey) {
        startIndex = index;
        break;
      }
    }
    const charged = journal.events.slice(startIndex + 1).some((event) => (
      event.type === "BudgetReservationSettled" && event.data.phase === openActivity.phase
    ));
    if (!charged) {
      // Cancellation/controller failure after a durable claim still charges the
      // attempt and retains the unmatched activity as in-doubt in the fold.
      // An external call may have crossed its side-effect boundary before the
      // process disappeared, so its unproven usage retains the complete
      // per-attempt ceiling instead of becoming newly spendable credit.
      const costUsd = openActivity.sideEffects === "none"
        ? 0
        : phaseBinding(journal.request, openActivity.phase).maxCostUsdPerAttempt;
      await settle(journal, openActivity.phase, { attempts: 1, costUsd, dynamicNodes: 0 });
    }
  }
  const releaseReason = fields.cancelled ? "cancelled"
    : fields.patchRejected ? "patch-rejected"
      : fields.failed ? "failed"
        : fields.reason?.startsWith("MAX_") ? "bound-reached"
          : "round-complete";
  await releaseRemaining(journal, releaseReason);
  const sample = journal.clock.sample();
  const fold = journal.fold;
  const observation = forcedObservation(fold, sample, fields);
  const exitReason = selectCycleExitReason(observation);
  const sequence = journal.events.length;
  const result: CycleControllerResult = Object.freeze({
    apiVersion: "graphengineering.reacher-z.github.io/cycle-results/v1alpha1",
    kind: "CycleControllerResult",
    controllerRunId: journal.request.controllerRunId,
    controllerHash: fold.controllerHash,
    requestHash: fold.requestHash,
    mode: journal.request.policy.mode,
    status: cycleStatus(exitReason),
    exitReason,
    iterations: fold.nextIteration - 1,
    consecutiveDryRounds: fold.consecutiveDryRounds,
    seenCount: fold.seenKeys.length,
    acceptedCount: fold.acceptedKeys.length,
    rejectedCount: fold.rejectedKeys.length,
    unknownCount: fold.unknownKeys.length,
    unevaluatedCount: fold.unevaluatedKeys.length,
    attemptsUsed: fold.attemptsUsed,
    costUsd: fold.costUsd,
    dynamicNodes: fold.dynamicNodes,
    durationMs: Math.max(fold.durationMs, sample.elapsedMs),
    lastGraphRevision: fold.currentRevision.graphRevision,
    lastGraphHash: fold.currentRevision.graphHash,
    lastRevisionHash: fold.currentRevision.revisionHash,
    terminalSequence: sequence,
    historyPrefixHash: journal.events.at(-1)?.recordHash ?? "0".repeat(64),
  });
  await journal.append("ControllerTerminated", { observation, result }, { sample });
  return journal.fold.terminalResult as CycleControllerResult;
}

function patchProjection(decision: GraphPatchDecision): Readonly<Record<string, unknown>> {
  return decision.outcome === "accepted"
    ? Object.freeze({
      patchId: decision.patchId,
      patchHash: decision.patchHash,
      outcome: "accepted",
      requestedBase: decision.requestedBase,
      resultingRevision: {
        graphRevision: decision.resultingRevision.body.graphRevision,
        graphHash: decision.resultingRevision.body.graphHash,
        revisionHash: decision.resultingRevision.revisionHash,
      },
    })
    : Object.freeze({
      patchId: decision.patchId,
      patchHash: decision.patchHash,
      outcome: "rejected",
      requestedBase: decision.requestedBase,
      errorCode: decision.errorCode,
    });
}

async function commitRound(journal: CycleJournal): Promise<void> {
  await releaseRemaining(journal, "round-complete");
  const sample = journal.clock.sample();
  const fold = journal.fold;
  const round = fold.openRound;
  if (round?.discovery === null || round?.evaluation === null || round?.modeOutcome === null || round === null) {
    throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", journal.request.controllerRunId, "round is incomplete");
  }
  const dry = round.discovery.freshKeys.length === 0;
  const consecutiveDryRounds = journal.request.policy.mode === "until-dry"
    ? (dry ? fold.consecutiveDryRounds + 1 : 0)
    : 0;
  await journal.append("RoundCommitted", {
    record: {
      iteration: round.iteration,
      candidateBatchHash: round.discovery.candidateBatchHash,
      candidateCount: round.discovery.candidateCount,
      freshKeys: round.discovery.freshKeys,
      duplicateKeys: round.discovery.duplicateKeys,
      acceptedKeys: round.evaluation.acceptedKeys,
      rejectedKeys: round.evaluation.rejectedKeys,
      unknownKeys: round.evaluation.unknownKeys,
      modeOutcome: round.modeOutcome,
      patchDecision: round.patchDecision === null ? null : patchProjection(round.patchDecision),
      consecutiveDryRounds,
      attemptsUsed: fold.attemptsUsed,
      costUsd: fold.costUsd,
      dynamicNodes: fold.dynamicNodes,
      durationMs: Math.max(fold.durationMs, sample.elapsedMs),
      currentRevision: fold.currentRevision,
    },
  }, { sample });
}

function plannerShouldRun(fold: CycleControllerFold, activities: CycleControllerActivities): boolean {
  if (!fold.request.patches.enabled || fold.openRound?.discovery === null
      || fold.openRound?.evaluation === null || fold.openRound?.modeOutcome === null
      || fold.openRound?.patchDecision !== null || fold.openRound === null) return false;
  try {
    const decision = activities.shouldPlanPatch?.({
      request: fold.request,
      iteration: fold.openRound.iteration,
      candidates: fold.openRound.discovery.candidates,
      verdicts: fold.openRound.evaluation.verdicts,
      modeOutcome: fold.openRound.modeOutcome,
    }) ?? false;
    if (typeof decision !== "boolean") throw new TypeError("patch routing decision must be boolean");
    return decision;
  } catch (error) {
    throw new CycleControllerError(
      "GE_CYCLE_ACTIVITY_FAILED", fold.request.controllerRunId,
      "deterministic patch routing failed", {}, { cause: error },
    );
  }
}

async function failClaimedActivity(
  journal: CycleJournal,
  phase: CycleActivityPhase,
  activityKey: string,
  usage: CycleUsage,
  code: string,
): Promise<void> {
  const open = journal.fold.openRound?.openActivity;
  if (open === null || open === undefined || open.phase !== phase || open.activityKey !== activityKey) {
    throw new CycleControllerError(
      "GE_CYCLE_INVALID_HISTORY", journal.request.controllerRunId,
      "claimed activity disappeared before structured failure settlement",
    );
  }
  const stableCode = /^GE_[A-Z0-9_]{3,64}$/u.test(code) ? code : "GE_CYCLE_ACTIVITY_FAILED";
  await journal.append("ActivityFailed", {
    iteration: open.iteration,
    activityKey: open.activityKey,
    attempt: open.attempt,
    failure: {
      phase,
      code: stableCode,
      retryable: false,
      inDoubt: open.sideEffects !== "none",
    },
    usage,
  });
  await settle(journal, phase, { ...usage, dynamicNodes: 0 });
}

async function continueController(
  journal: CycleJournal,
  applier: NativeGraphPatchApplier,
): Promise<CycleControllerResult> {
  const activities = journal.options.activities;
  while (true) {
    let fold = journal.fold;
    if (fold.terminalResult !== null) return fold.terminalResult;
    const chargedOpen = fold.openRound?.openActivity;
    if (chargedOpen !== null && chargedOpen !== undefined
        && openActivityWasCharged(
          journal.events, chargedOpen.activityKey, chargedOpen.phase, chargedOpen.attempt,
        )) {
      if (journal.options.signal?.aborted) {
        return terminate(journal, { cancelled: true, reason: "CANCELLED" });
      }
      return terminate(journal, {
        failed: true,
        failureCode: "GE_CYCLE_ACTIVITY_FAILED",
        reason: "FAILED",
      });
    }
    if (fold.openRound !== null) {
      const pending = pendingSettlementEvidence(journal.events, fold.openRound.iteration);
      if (pending !== null) {
        await settle(journal, pending.phase, pending.delta);
        const after = journal.fold;
        const stop = hardStop(after, journal.clock.sample());
        if (journal.options.signal?.aborted) {
          return terminate(journal, { cancelled: true, reason: "CANCELLED" });
        }
        if (pending.failure !== null) {
          const maximum = phasePlan(after, pending.phase).maxAttempts;
          if (!pending.failure.retryable || pending.failure.attempt >= maximum || stop !== null) {
            return terminate(journal, {
              failed: true,
              failureCode: pending.failure.code,
              reason: stop ?? "FAILED",
            });
          }
        } else if (stop !== null) {
          return terminate(journal, { reason: stop });
        }
        continue;
      }
      const unresolved = unresolvedFailureEvidence(journal.events, fold.openRound.iteration);
      if (unresolved !== null) {
        if (journal.options.signal?.aborted) {
          return terminate(journal, { cancelled: true, reason: "CANCELLED" });
        }
        const stop = hardStop(fold, journal.clock.sample());
        const maximum = phasePlan(fold, unresolved.phase).maxAttempts;
        if (!unresolved.retryable || unresolved.attempt >= maximum || stop !== null) {
          return terminate(journal, {
            failed: true,
            failureCode: unresolved.code,
            reason: stop ?? "FAILED",
          });
        }
      }
    }
    if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
    if (fold.openRound === null) {
      const sample = journal.clock.sample();
      const modeConvergence = convergence(fold);
      const stop = preflightStop(fold, sample);
      if (stop !== null || modeConvergence !== null) {
        return terminate(journal, { reason: stop ?? modeConvergence as CycleExitReason, convergenceReason: modeConvergence });
      }
      const plan = createCycleRoundPlan(
        journal.request,
        journal.request.policy.maxDynamicNodes - fold.dynamicNodes,
      );
      await journal.append("RoundReserved", {
        iteration: fold.nextIteration,
        plan: plan.plan,
        planHash: plan.planHash,
        reservationId: `round-${fold.nextIteration}`,
        maximum: plan.maximum,
        deadlineAt: fold.deadlineAt,
        currentRevision: fold.currentRevision,
      }, { sample });
      fold = journal.fold;
    }

    if (fold.openRound?.discovery === null) {
      if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
      const output = await executeActivity(
        journal, applier, "finder", activities.finder,
        (value) => validateCycleCandidates(
          value, journal.request.policy, new Set(journal.fold.seenKeys), journal.request.controllerRunId,
        ),
      );
      if ("failure" in output) {
        if (journal.options.signal?.aborted || output.failure.code === "GE_CYCLE_ACTIVITY_CANCELLED") {
          return terminate(journal, { cancelled: true, reason: "CANCELLED" });
        }
        return terminate(journal, {
          failed: true,
          failureCode: output.failure.code,
          reason: hardStop(journal.fold, journal.clock.sample()) ?? "FAILED",
        });
      }
      const before = journal.fold;
      const classified = output.execution.output;
      const sample = journal.clock.sample();
      const payload = createCycleInlinePayload(classified.candidates, journal.request.policy.maxCandidateBatchBytes);
      await journal.append("DiscoveryCommitted", {
        iteration: before.openRound?.iteration,
        activityKey: output.activityKey,
        candidateBatch: payload,
        candidateBatchHash: classified.candidateBatchHash,
        candidateCount: classified.candidates.length,
        freshKeys: classified.freshKeys,
        duplicateKeys: classified.duplicateKeys,
        seenAdditions: classified.seenAdditions,
        usage: output.usage,
        durationMs: Math.max(before.durationMs, sample.elapsedMs),
      }, { sample });
      await settle(journal, "finder", { ...output.usage, dynamicNodes: 0 });
      if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
      const stop = hardStop(journal.fold, journal.clock.sample());
      if (stop !== null) return terminate(journal, { reason: stop });
      fold = journal.fold;
    }

    if (fold.openRound?.evaluation === null) {
      if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
      const freshKeys = fold.openRound?.discovery?.freshKeys ?? [];
      const output = await executeActivity(
        journal, applier, "candidate-evaluator", activities.candidateEvaluator,
        (value) => validateCycleVerdicts(value, freshKeys, journal.request.controllerRunId),
      );
      if ("failure" in output) {
        if (journal.options.signal?.aborted || output.failure.code === "GE_CYCLE_ACTIVITY_CANCELLED") {
          return terminate(journal, { cancelled: true, reason: "CANCELLED" });
        }
        return terminate(journal, {
          failed: true, failureCode: output.failure.code,
          reason: hardStop(journal.fold, journal.clock.sample()) ?? "FAILED",
        });
      }
      const before = journal.fold;
      const classified = output.execution.output;
      const sample = journal.clock.sample();
      await journal.append("CandidateEvaluationCommitted", {
        iteration: before.openRound?.iteration,
        activityKey: output.activityKey,
        verdicts: classified.verdicts,
        acceptedKeys: classified.acceptedKeys,
        rejectedKeys: classified.rejectedKeys,
        unknownKeys: classified.unknownKeys,
        usage: output.usage,
        durationMs: Math.max(before.durationMs, sample.elapsedMs),
      }, { sample });
      await settle(journal, "candidate-evaluator", { ...output.usage, dynamicNodes: 0 });
      if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
      const stop = hardStop(journal.fold, journal.clock.sample());
      if (stop !== null) return terminate(journal, { reason: stop });
      fold = journal.fold;
    }

    if (fold.openRound?.modeOutcome === null) {
      if (journal.request.policy.mode === "until-dry") {
        const sample = journal.clock.sample();
        await journal.append("ModeOutcomeCommitted", {
          iteration: fold.openRound.iteration,
          activityKey: null,
          outcome: { mode: "until-dry" },
          usage: { attempts: 0, costUsd: 0 },
          durationMs: Math.max(fold.durationMs, sample.elapsedMs),
        }, { sample });
      } else {
        const output = journal.request.policy.mode === "while"
          ? await (() => {
            if (activities.condition === undefined) {
              throw new CycleControllerError(
                "GE_CYCLE_INVALID_REQUEST", journal.request.controllerRunId, "condition handler is missing",
              );
            }
            return executeActivity(
              journal, applier, "condition", activities.condition,
              (value) => {
                if (typeof value !== "boolean") throw new TypeError("condition must return boolean");
                return value;
              },
            );
          })()
          : await (() => {
            if (activities.optimizerEvaluator === undefined) {
              throw new CycleControllerError(
                "GE_CYCLE_INVALID_REQUEST", journal.request.controllerRunId,
                "optimizer-evaluator handler is missing",
              );
            }
            return executeActivity(
              journal, applier, "optimizer-evaluator", activities.optimizerEvaluator,
              (value) => {
                if (value !== "accept" && value !== "revise" && value !== "unknown") {
                  throw new TypeError("optimizer evaluator verdict is invalid");
                }
                return value;
              },
            );
          })();
        if ("failure" in output) {
          if (journal.options.signal?.aborted || output.failure.code === "GE_CYCLE_ACTIVITY_CANCELLED") {
            return terminate(journal, { cancelled: true, reason: "CANCELLED" });
          }
          return terminate(journal, {
            failed: true, failureCode: output.failure.code,
            reason: hardStop(journal.fold, journal.clock.sample()) ?? "FAILED",
          });
        }
        const phase: CycleActivityPhase = journal.request.policy.mode === "while"
          ? "condition"
          : "optimizer-evaluator";
        const outcome: CycleModeOutcome = phase === "condition"
          ? Object.freeze({ mode: "while", condition: output.execution.output as boolean })
          : Object.freeze({
            mode: "evaluator-optimizer",
            verdict: output.execution.output as "accept" | "revise" | "unknown",
          });
        const sample = journal.clock.sample();
        await journal.append("ModeOutcomeCommitted", {
          iteration: journal.fold.openRound?.iteration,
          activityKey: output.activityKey,
          outcome,
          usage: output.usage,
          durationMs: Math.max(journal.fold.durationMs, sample.elapsedMs),
        }, { sample });
        await settle(journal, phase, { ...output.usage, dynamicNodes: 0 });
        if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
      }
      const stop = hardStop(journal.fold, journal.clock.sample());
      if (stop !== null) return terminate(journal, { reason: stop });
      fold = journal.fold;
    }

    let shouldPlanPatch: boolean;
    try {
      shouldPlanPatch = plannerShouldRun(fold, activities);
    } catch (error) {
      const failureCode = error instanceof CycleControllerError
        ? error.code
        : "GE_CYCLE_ACTIVITY_FAILED";
      return terminate(journal, { failed: true, failureCode, reason: "FAILED" });
    }
    if (shouldPlanPatch) {
      if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
      if (activities.patchPlanner === undefined || journal.options.patchContext === undefined) {
        return terminate(journal, {
          failed: true,
          failureCode: "GE_PATCH_AUTHORITY_EXPANSION",
          reason: "FAILED",
        });
      }
      const output = await executeActivity(
        journal, applier, "patch-planner", activities.patchPlanner,
        (value) => validateGraphPatchShape(value, journal.request.controllerRunId),
      );
      if ("failure" in output) {
        if (journal.options.signal?.aborted || output.failure.code === "GE_CYCLE_ACTIVITY_CANCELLED") {
          return terminate(journal, { cancelled: true, reason: "CANCELLED" });
        }
        return terminate(journal, {
          failed: true, failureCode: output.failure.code,
          reason: hardStop(journal.fold, journal.clock.sample()) ?? "FAILED",
        });
      }
      if (journal.options.patchContext.authoritySnapshot.proposerActivityKey !== output.activityKey) {
        await failClaimedActivity(
          journal, "patch-planner", output.activityKey, output.usage,
          "GE_PATCH_AUTHORITY_EXPANSION",
        );
        return terminate(journal, {
          failed: true,
          failureCode: "GE_PATCH_AUTHORITY_EXPANSION",
          reason: "FAILED",
        });
      }
      const before = journal.fold;
      const patchPlan = before.openRound?.plan.patchPlanner;
      if (patchPlan === null || patchPlan === undefined || before.openRound === null) {
        throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", journal.request.controllerRunId, "planner has no reservation");
      }
      const sample = journal.clock.sample();
      const priorPlannerUsage = committedForPhase(
        journal.events, before.openRound.iteration, "patch-planner",
      );
      const reserved: CycleBudgetDelta = Object.freeze({
        attempts: patchPlan.maxAttempts - priorPlannerUsage.attempts,
        costUsd: patchPlan.maxCostUsd - priorPlannerUsage.costUsd,
        dynamicNodes: before.openRound.plan.maxDynamicNodes - priorPlannerUsage.dynamicNodes,
      });
      let prepared: GraphPatchApplication;
      try {
        prepared = applier.prepare(output.execution.output, {
          ...journal.options.patchContext,
          dryRun: true,
          reservationId: before.openRound.reservationId,
          reserved,
          activityUsage: output.usage,
          durationMs: Math.max(before.durationMs, sample.elapsedMs),
          deadlineMsRemaining: sample.remainingMs,
        });
      } catch (error) {
        const failureCode = error instanceof CycleControllerError
          ? error.code
          : "GE_CYCLE_ACTIVITY_FAILED";
        await failClaimedActivity(
          journal, "patch-planner", output.activityKey, output.usage, failureCode,
        );
        return terminate(journal, { failed: true, failureCode, reason: "FAILED" });
      }
      const decision = prepared.decision;
      const data = {
        iteration: before.openRound.iteration,
        plannerActivityKey: output.activityKey,
        ...decision,
      };
      await journal.append(decision.outcome === "accepted" ? "PatchAccepted" : "PatchRejected", data, {
        graphRevision: decision.outcome === "accepted"
          ? decision.resultingRevision.body.graphRevision
          : before.currentRevision.graphRevision,
        sample,
      });
      applier.commitPrepared(prepared);
      await settle(journal, "patch-planner", decision.budgetOutcome.committed);
      if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
      if (decision.outcome === "rejected") {
        return terminate(journal, { patchRejected: true, reason: "PATCH_REJECTED" });
      }
      const stop = hardStop(journal.fold, journal.clock.sample());
      if (stop !== null) return terminate(journal, { reason: stop });
    }

    await commitRound(journal);
    fold = journal.fold;
    const modeConvergence = convergence(fold);
    const stop = preflightStop(fold, journal.clock.sample());
    if (journal.options.signal?.aborted) return terminate(journal, { cancelled: true, reason: "CANCELLED" });
    const lastOutcome = fold.committedRounds.at(-1)?.modeOutcome;
    const unknownVerdict = journal.request.policy.mode === "evaluator-optimizer"
      && lastOutcome?.mode === "evaluator-optimizer"
      && lastOutcome.verdict === "unknown";
    if (stop !== null || modeConvergence !== null || unknownVerdict) {
      return terminate(journal, {
        reason: stop ?? (unknownVerdict ? "UNKNOWN_VERDICT" : modeConvergence as CycleExitReason),
        convergenceReason: modeConvergence,
        unknownVerdict,
      });
    }
  }
}

function validateInitialGraph(
  request: CycleControllerRequest,
  graphValue: GraphSpec | unknown,
): GraphSpec {
  const compilation = compileGraph(graphValue);
  if (!compilation.valid || compilation.canonicalGraph === null || compilation.graphHash === null) {
    throw new CycleControllerError(
      "GE_PATCH_GRAPH_INVALID", request.controllerRunId, "initial controller graph does not compile",
      { diagnostics: compilation.diagnostics },
    );
  }
  if (compilation.graphHash !== request.initialGraph.graphHash) {
    throw new CycleControllerError("GE_PATCH_STALE_BASE", request.controllerRunId, "initial graph hash does not match request");
  }
  return snapshotJson(JSON.parse(compilation.canonicalGraph)) as unknown as GraphSpec;
}

function createApplier(
  request: CycleControllerRequest,
  graph: GraphSpec,
  events: readonly CycleControllerEvent[],
): NativeGraphPatchApplier {
  const applier = new NativeGraphPatchApplier(graph, request.initialGraph, {
    limits: request.patches.limits ?? {
      maxNodes: graph.nodes.length,
      maxEdges: graph.edges.length,
      maxOutputs: Object.keys(graph.outputs).length,
      maxDepth: Math.max(1, graph.nodes.length),
      maxFanOut: Math.max(1, graph.edges.length),
    },
    maxDynamicNodes: request.policy.maxDynamicNodes,
  });
  for (const event of events) {
    if (event.type === "PatchAccepted" || event.type === "PatchRejected") {
      const { iteration: _iteration, plannerActivityKey: _plannerActivityKey, ...decision } = event.data;
      applier.restoreRecorded(
        decision as unknown as GraphPatchDecision,
        event.data.plannerActivityKey as string,
      );
    }
  }
  return applier;
}

function nowOption(options: CycleControllerRunOptions): () => Date {
  return options.now ?? (() => new Date());
}

async function emptyStream(options: CycleControllerRunOptions, streamId: string): Promise<boolean> {
  return (await readCycleControllerEvents(options.eventStore, streamId)).length === 0;
}

function validateRunOptions(request: CycleControllerRequest, options: CycleControllerRunOptions): void {
  const fail = (message: string): never => {
    throw new CycleControllerError("GE_CYCLE_INVALID_REQUEST", request.controllerRunId, message);
  };
  if (options === null || typeof options !== "object"
      || options.eventStore === null || typeof options.eventStore !== "object"
      || typeof options.eventStore.read !== "function" || typeof options.eventStore.append !== "function") {
    fail("controller options require an event store adapter");
  }
  if (options.checkpointStore !== undefined
      && (options.checkpointStore === null || typeof options.checkpointStore !== "object"
        || typeof options.checkpointStore.read !== "function"
        || typeof options.checkpointStore.write !== "function")) {
    fail("checkpoint store adapter is invalid");
  }
  if (options.checkpointEveryEvents !== undefined
      && (!Number.isSafeInteger(options.checkpointEveryEvents) || options.checkpointEveryEvents < 0)) {
    fail("checkpoint interval must be a nonnegative safe integer");
  }
  if (options.now !== undefined && typeof options.now !== "function"
      || options.createEventId !== undefined && typeof options.createEventId !== "function") {
    fail("controller clock or event-ID adapter is invalid");
  }
  if (options.activities === null || typeof options.activities !== "object"
      || typeof options.activities.finder !== "function"
      || typeof options.activities.candidateEvaluator !== "function"
      || request.policy.mode === "while" && typeof options.activities.condition !== "function"
      || request.policy.mode === "evaluator-optimizer"
        && typeof options.activities.optimizerEvaluator !== "function"
      || options.activities.patchPlanner !== undefined
        && typeof options.activities.patchPlanner !== "function"
      || options.activities.shouldPlanPatch !== undefined
        && typeof options.activities.shouldPlanPatch !== "function") {
    fail("controller activity adapters do not satisfy the request mode");
  }
  validateCycleLease(options.lease, request.controllerRunId);
}

async function startInternal(
  requestValue: CycleControllerRequest | unknown,
  initialGraphValue: GraphSpec | unknown,
  options: CycleControllerRunOptions,
  parent?: CycleControllerFold,
): Promise<CycleControllerResult> {
  const request = validateCycleControllerRequest(requestValue);
  validateRunOptions(request, options);
  const graph = validateInitialGraph(request, initialGraphValue);
  if (!(await emptyStream(options, request.eventStreamId))) {
    throw new CycleControllerError("GE_CYCLE_RUN_ALREADY_EXISTS", request.controllerRunId, "start requires an empty event stream");
  }
  let firstDate: Date;
  try {
    firstDate = nowOption(options)();
  } catch (error) {
    throw new CycleControllerError(
      "GE_CYCLE_ACTIVITY_FAILED", request.controllerRunId,
      "trusted clock adapter failed before controller creation", {}, { cause: error },
    );
  }
  if (!(firstDate instanceof Date) || !Number.isFinite(firstDate.getTime())) {
    throw new CycleControllerError("GE_CYCLE_ACTIVITY_FAILED", request.controllerRunId, "trusted clock returned an invalid start time");
  }
  const deadlineMs = firstDate.getTime() + request.policy.maxDurationMs;
  if (!Number.isSafeInteger(deadlineMs)) throw new CycleControllerError("GE_CYCLE_COUNTER_MISMATCH", request.controllerRunId, "deadline overflowed");
  const startedAt = firstDate.toISOString();
  const deadlineAt = new Date(deadlineMs).toISOString();
  const clock = new TrustedCycleClock(
    nowOption(options), startedAt, deadlineAt, startedAt, request.controllerRunId,
  );
  const journal = new CycleJournal({ request, options, events: [], ...(parent === undefined ? {} : { parent }), clock });
  await journal.append("ControllerCreated", {
    request,
    requestHash: cycleRequestHash(request),
    identity: cycleControllerIdentity(request),
    controllerHash: cycleControllerHash(request),
    startedAt,
    deadlineAt,
  }, { lease: null, sample: { timestamp: startedAt, elapsedMs: 0, remainingMs: request.policy.maxDurationMs } });
  if (parent !== undefined && journal.fold.inDoubtActivities.length !== 0) {
    throw new CycleControllerError(
      "IN_DOUBT_SIDE_EFFECT", request.controllerRunId,
      "fork inherited an external in-doubt activity whose parent key cannot be reused",
    );
  }
  await journal.append("LeaseAcquired", {
    reason: "start",
    previousLeaseId: null,
  }, { lease: options.lease });
  const applier = createApplier(request, graph, journal.events);
  return continueController(journal, applier);
}

/** Start one native TypeScript bounded controller. This operation never resumes. */
export async function startCycleController(
  request: CycleControllerRequest | unknown,
  initialGraph: GraphSpec | unknown,
  options: CycleControllerRunOptions,
): Promise<CycleControllerResult> {
  return startInternal(request, initialGraph, options);
}

/** Resume one exact nonterminal stream; a terminal stream is returned read-only. */
export async function resumeCycleController(
  requestValue: CycleControllerRequest | unknown,
  initialGraphValue: GraphSpec | unknown,
  options: CycleResumeOptions,
  foldOptions: FoldCycleOptions = {},
): Promise<CycleControllerResult> {
  const request = validateCycleControllerRequest(requestValue);
  validateRunOptions(request, options);
  const graph = validateInitialGraph(request, initialGraphValue);
  const events = await readCycleControllerEvents(options.eventStore, request.eventStreamId);
  if (events.length === 0) throw new CycleControllerError("GE_CYCLE_RUN_NOT_FOUND", request.controllerRunId, "resume requires an existing stream");
  let fold = foldCycleControllerEvents(events, foldOptions);
  if (fold.requestHash !== cycleRequestHash(request) || fold.controllerHash !== cycleControllerHash(request)
      || canonicalSerialize(fold.request) !== canonicalSerialize(request)) {
    throw new CycleControllerError("GE_CYCLE_REQUEST_MISMATCH", request.controllerRunId, "resume request does not match history");
  }
  if (options.expectedSequence !== fold.lastSequence) {
    throw new CycleControllerError(
      "GE_CYCLE_RESUME_CONFLICT", request.controllerRunId, "resume expected version is stale",
      { expectedSequence: options.expectedSequence, actualSequence: fold.lastSequence },
    );
  }
  if (fold.terminalResult !== null) return fold.terminalResult;
  if (fold.inDoubtActivities.some((activity) => activity.sideEffects === "non-idempotent")
      || fold.openRound?.openActivity?.sideEffects === "non-idempotent") {
    throw new CycleControllerError("IN_DOUBT_SIDE_EFFECT", request.controllerRunId, "resume is blocked by an in-doubt non-idempotent activity");
  }
  if (options.checkpointStore !== undefined) {
    const checkpointId = `${request.controllerRunId}-latest`;
    let checkpoint: CycleControllerCheckpoint | null;
    try {
      checkpoint = await options.checkpointStore.read(request.checkpointScope, checkpointId);
    } catch (error) {
      throw new CycleControllerError(
        "GE_CYCLE_STORE_FAILED", request.controllerRunId,
        "cycle checkpoint cache could not be read", {}, { cause: error },
      );
    }
    if (checkpoint !== null) {
      try {
        validateCycleControllerCheckpoint(checkpoint, events, foldOptions);
      } catch {
        // Invalid acceleration is ignored; the already completed full event
        // fold above remains authoritative and no work is released from it.
      }
    }
  }
  const lastTimestamp = events.at(-1)?.timestamp as string;
  const clock = new TrustedCycleClock(
    nowOption(options), fold.startedAt, fold.deadlineAt, lastTimestamp, request.controllerRunId,
  );
  const journal = new CycleJournal({
    request,
    options,
    events,
    ...(foldOptions.parent === undefined ? {} : { parent: foldOptions.parent }),
    clock,
  });
  await journal.append("LeaseAcquired", {
    reason: options.leaseReason ?? "resume",
    previousLeaseId: fold.lastLeaseId,
  }, { lease: options.lease });
  fold = journal.fold;
  const applier = createApplier(request, graph, events);
  return continueController(journal, applier);
}

/** Read-only replay of one exact prefix. It acquires no lease and calls no adapter. */
export async function replayCycleController(
  store: CycleControllerRunOptions["eventStore"],
  streamId: string,
  throughSequence?: number,
  options: FoldCycleOptions = {},
): Promise<CycleControllerFold> {
  const events = await readCycleControllerEvents(store, streamId);
  if (events.length === 0) throw new CycleControllerError("GE_CYCLE_RUN_NOT_FOUND", "unknown", "replay requires an existing stream");
  const through = throughSequence ?? events.length - 1;
  if (!Number.isSafeInteger(through) || through < 0 || through >= events.length) {
    throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", events[0]!.controllerRunId, "replay prefix is outside history");
  }
  return foldCycleControllerEvents(events.slice(0, through + 1), options);
}

/** Create a child stream bound to an exact immutable parent prefix. */
export async function forkCycleController(
  parentStore: CycleControllerRunOptions["eventStore"],
  parentStreamId: string,
  childRequestValue: CycleControllerRequest | unknown,
  graphAtParentPrefix: GraphSpec | unknown,
  options: CycleControllerRunOptions,
): Promise<CycleControllerResult> {
  const childRequest = validateCycleControllerRequest(childRequestValue);
  if (childRequest.lineage.origin !== "fork") {
    throw new CycleControllerError("GE_CYCLE_INVALID_REQUEST", childRequest.controllerRunId, "fork requires fork lineage");
  }
  const parent = await replayCycleController(
    parentStore, parentStreamId, childRequest.lineage.parentSequence,
  );
  if (parent.request.controllerRunId !== childRequest.lineage.parentControllerRunId
      || parent.historyPrefixHash !== childRequest.lineage.parentHistoryHash
      || canonicalSerialize(parent.currentRevision) !== canonicalSerialize(childRequest.initialGraph)) {
    throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", childRequest.controllerRunId, "child lineage does not bind the parent prefix");
  }
  return startInternal(childRequest, graphAtParentPrefix, options, parent);
}

export type { GraphPatch, CycleCandidate, CycleCandidateVerdict, CycleGraphCoordinate };
