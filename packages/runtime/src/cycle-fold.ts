import { canonicalHash, canonicalSerialize, compareUnicodeCodePoints } from "@graph-engineering/core";
import {
  CycleControllerError,
  type CycleActivityBinding,
  type CycleActivityPhase,
  type CycleBudgetDelta,
  type CycleCandidate,
  type CycleControllerCheckpoint,
  type CycleControllerCheckpointStore,
  type CycleControllerEvent,
  type CycleControllerEventStore,
  type CycleControllerFold,
  type CycleControllerRequest,
  type CycleExitObservation,
  type CycleGraphCoordinate,
  type CycleLease,
  type CycleModeOutcome,
  type CycleOpenActivity,
  type CycleOpenRoundProjection,
  type CycleReservationProjection,
  type CycleRoundPlan,
  type CycleRoundRecord,
  type GraphPatchDecision,
} from "./cycle-types.js";
import {
  CYCLE_ACTIVITY_DOMAIN,
  CYCLE_ROUND_PLAN_DOMAIN,
  captureBoundedJson,
  createCycleRoundPlan,
  cycleControllerHash,
  cycleControllerIdentity,
  cycleRequestHash,
  cycleStatus,
  decodeCycleInlinePayload,
  graphRevision,
  hashWithDomain,
  selectCycleExitReason,
  sha256Utf8,
  validateCycleCandidates,
  validateCycleControllerRequest,
  validateCycleLease,
  validateCycleVerdicts,
  validateGraphPatchShape,
  verifyCycleEventIntegrity,
} from "./cycle-contract.js";
import { snapshotJson } from "./json.js";

interface MutableReservation {
  readonly reservationId: string;
  readonly iteration: number;
  readonly maximum: CycleBudgetDelta;
  committed: CycleBudgetDelta;
  released: CycleBudgetDelta;
}

interface MutableRound {
  readonly iteration: number;
  readonly plan: CycleRoundPlan;
  readonly planHash: string;
  readonly reservation: MutableReservation;
  openActivity: CycleOpenActivity | null;
  openActivitySettled: boolean;
  pendingSettlement: { readonly phase: CycleActivityPhase; readonly delta: CycleBudgetDelta } | null;
  discovery: CycleOpenRoundProjection["discovery"];
  evaluation: CycleOpenRoundProjection["evaluation"];
  modeOutcome: CycleModeOutcome | null;
  patchDecision: GraphPatchDecision | null;
  unresolvedFailure: { readonly code: string; readonly retryable: boolean; readonly inDoubt: boolean } | null;
  closingRelease: string | null;
  readonly attemptsByPhase: Map<CycleActivityPhase, number>;
  readonly keysByPhase: Map<CycleActivityPhase, string>;
  readonly committedByPhase: Map<CycleActivityPhase, CycleBudgetDelta>;
  readonly releasedPhases: Set<CycleActivityPhase>;
}

export interface FoldCycleOptions {
  readonly parent?: CycleControllerFold;
  readonly requireTerminal?: boolean;
}

// A fork parent is executable authority over inherited counters and seen state,
// not an ordinary deserializable DTO. Only a projection produced by this
// module from a validated event prefix may cross that trust boundary. A
// restarted process obtains a fresh trusted projection by replaying the parent
// stream locally; copying self-asserted fold fields is intentionally rejected.
const VERIFIED_CYCLE_FOLDS = new WeakSet<object>();

function invalid(
  runId: string,
  message: string,
  code: "GE_CYCLE_INVALID_HISTORY" | "GE_CYCLE_COUNTER_MISMATCH" = "GE_CYCLE_INVALID_HISTORY",
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new CycleControllerError(code, runId, message, details);
}

function record(value: unknown, runId: string, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(runId, `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

const EVENT_KEYS = [
  "apiVersion", "contractVersion", "eventId", "type", "timestamp", "controllerRunId",
  "hostRunId", "controllerHash", "requestHash", "graphRevision", "sequence",
  "expectedPreviousSequence", "previousEventHash", "lease", "payloadDisposition",
  "redacted", "payloadHash", "data", "recordHash",
] as const;

const DATA_KEYS: Readonly<Record<CycleControllerEvent["type"], readonly string[]>> = {
  ControllerCreated: ["request", "requestHash", "identity", "controllerHash", "startedAt", "deadlineAt"],
  LeaseAcquired: ["reason", "previousLeaseId"],
  LeaseRenewed: ["previousExpiresAt", "newExpiresAt"],
  LeaseReleased: ["reason"],
  RoundReserved: ["iteration", "plan", "planHash", "reservationId", "maximum", "deadlineAt", "currentRevision"],
  ActivityStarted: ["iteration", "phase", "activityId", "activityKey", "attempt", "sideEffects", "inputHash", "reservationId"],
  ActivityFailed: ["iteration", "activityKey", "attempt", "failure", "usage"],
  DiscoveryCommitted: [
    "iteration", "activityKey", "candidateBatch", "candidateBatchHash", "candidateCount",
    "freshKeys", "duplicateKeys", "seenAdditions", "usage", "durationMs",
  ],
  CandidateEvaluationCommitted: [
    "iteration", "activityKey", "verdicts", "acceptedKeys", "rejectedKeys", "unknownKeys",
    "usage", "durationMs",
  ],
  ModeOutcomeCommitted: ["iteration", "activityKey", "outcome", "usage", "durationMs"],
  BudgetReservationSettled: ["iteration", "reservationId", "phase", "committed", "totals"],
  BudgetReservationReleased: ["iteration", "reservationId", "reason", "released", "remaining", "totals"],
  PatchAccepted: [
    "iteration", "plannerActivityKey", "patchId", "patch", "patchHash", "requestedBase",
    "authoritySnapshot", "policySnapshotHash", "budgetOutcome", "diagnostics",
    "decidedAtDurationMs", "outcome", "resultingRevision",
  ],
  PatchRejected: [
    "iteration", "plannerActivityKey", "patchId", "patch", "patchHash", "requestedBase",
    "authoritySnapshot", "policySnapshotHash", "budgetOutcome", "diagnostics",
    "decidedAtDurationMs", "outcome", "errorCode",
  ],
  RoundCommitted: ["record"],
  ControllerTerminated: ["observation", "result"],
};

function closedKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  runId: string,
  label: string,
): void {
  const actual = Object.keys(value).sort(compareUnicodeCodePoints);
  const wanted = [...expected].sort(compareUnicodeCodePoints);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(runId, `${label} is not a closed object`);
  }
}

function validateEventWire(value: unknown): CycleControllerEvent {
  let event: Record<string, unknown>;
  try {
    const captured = captureBoundedJson(value, 16_777_216).value;
    event = record(captured, "unknown", "cycle event");
  } catch (error) {
    if (error instanceof CycleControllerError) throw error;
    throw new CycleControllerError(
      "GE_CYCLE_INVALID_HISTORY", "unknown", "cycle event is not bounded portable JSON", {}, { cause: error },
    );
  }
  const runId = typeof event.controllerRunId === "string" ? event.controllerRunId : "unknown";
  closedKeys(event, EVENT_KEYS, runId, "cycle event envelope");
  const type = event.type;
  if (typeof type !== "string" || !(type in DATA_KEYS)) invalid(runId, "cycle event type is invalid");
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
  const hash = /^[0-9a-f]{64}$/u;
  const timestamp = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
  if (event.apiVersion !== "graphengineering.reacher-z.github.io/cycle-controller-events/v1alpha1"
      || event.contractVersion !== "cycle-controller-recovery/v1alpha1"
      || typeof event.eventId !== "string" || !identifier.test(event.eventId)
      || event.eventId === "." || event.eventId === ".."
      || typeof event.controllerRunId !== "string" || !identifier.test(event.controllerRunId)
      || typeof event.hostRunId !== "string" || !identifier.test(event.hostRunId)
      || typeof event.controllerHash !== "string" || !hash.test(event.controllerHash)
      || typeof event.requestHash !== "string" || !hash.test(event.requestHash)
      || typeof event.payloadHash !== "string" || !hash.test(event.payloadHash)
      || typeof event.recordHash !== "string" || !hash.test(event.recordHash)
      || !Number.isSafeInteger(event.graphRevision) || (event.graphRevision as number) < 1
      || !Number.isSafeInteger(event.sequence) || (event.sequence as number) < 0
      || !Number.isSafeInteger(event.expectedPreviousSequence) || (event.expectedPreviousSequence as number) < -1
      || event.previousEventHash !== null
        && (typeof event.previousEventHash !== "string" || !hash.test(event.previousEventHash))
      || typeof event.timestamp !== "string" || !timestamp.test(event.timestamp)
      || !Number.isFinite(Date.parse(event.timestamp))
      || event.payloadDisposition !== "inline-unredacted" || event.redacted !== false) {
    invalid(runId, "cycle event envelope is invalid");
  }
  if (event.lease !== null) validateCycleLease(event.lease, runId);
  const data = record(event.data, runId, `${type}.data`);
  const expected = DATA_KEYS[type as CycleControllerEvent["type"]];
  if (type === "BudgetReservationReleased" && Object.hasOwn(data, "phase")) {
    closedKeys(data, [...expected, "phase"], runId, `${type}.data`);
  } else {
    closedKeys(data, expected, runId, `${type}.data`);
  }
  return event as unknown as CycleControllerEvent;
}

function array(value: unknown, runId: string, label: string): readonly unknown[] {
  if (!Array.isArray(value)) return invalid(runId, `${label} must be an array`);
  return value;
}

function text(value: unknown, runId: string, label: string): string {
  if (typeof value !== "string") return invalid(runId, `${label} must be a string`);
  return value;
}

function integer(value: unknown, runId: string, label: string, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    return invalid(runId, `${label} must be a safe integer`, "GE_CYCLE_COUNTER_MISMATCH");
  }
  return value;
}

function cost(value: unknown, runId: string, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return invalid(runId, `${label} must be a finite nonnegative number`, "GE_CYCLE_COUNTER_MISMATCH");
  }
  return value;
}

function exact(left: unknown, right: unknown, runId: string, message: string, counter = false): void {
  if (canonicalSerialize(left) !== canonicalSerialize(right)) {
    invalid(runId, message, counter ? "GE_CYCLE_COUNTER_MISMATCH" : "GE_CYCLE_INVALID_HISTORY");
  }
}

function add(left: number, right: number, runId: string, label: string, integerValue = false): number {
  const result = left + right;
  if (!Number.isFinite(result) || result < 0 || (integerValue && !Number.isSafeInteger(result))) {
    return invalid(runId, `${label} overflowed`, "GE_CYCLE_COUNTER_MISMATCH");
  }
  return result;
}

function budget(value: unknown, runId: string, label: string): CycleBudgetDelta {
  const item = record(value, runId, label);
  closedKeys(item, ["attempts", "costUsd", "dynamicNodes"], runId, label);
  return Object.freeze({
    attempts: integer(item.attempts, runId, `${label}.attempts`),
    costUsd: cost(item.costUsd, runId, `${label}.costUsd`),
    dynamicNodes: integer(item.dynamicNodes, runId, `${label}.dynamicNodes`),
  });
}

function subtract(maximum: CycleBudgetDelta, committed: CycleBudgetDelta, released: CycleBudgetDelta, runId: string): CycleBudgetDelta {
  const remaining = {
    attempts: maximum.attempts - committed.attempts - released.attempts,
    costUsd: maximum.costUsd - committed.costUsd - released.costUsd,
    dynamicNodes: maximum.dynamicNodes - committed.dynamicNodes - released.dynamicNodes,
  };
  if (remaining.attempts < 0 || remaining.costUsd < 0 || remaining.dynamicNodes < 0
      || !Number.isSafeInteger(remaining.attempts) || !Number.isSafeInteger(remaining.dynamicNodes)
      || !Number.isFinite(remaining.costUsd)) {
    return invalid(runId, "reservation accounting became negative", "GE_CYCLE_COUNTER_MISMATCH");
  }
  return Object.freeze(remaining);
}

function binding(request: CycleControllerRequest, phase: CycleActivityPhase): CycleActivityBinding | null {
  if (phase === "finder") return request.activities.finder;
  if (phase === "candidate-evaluator") return request.activities.candidateEvaluator;
  if (phase === "condition") return request.activities.condition;
  if (phase === "optimizer-evaluator") return request.activities.optimizerEvaluator;
  return request.activities.patchPlanner;
}

function planEntry(plan: CycleRoundPlan, phase: CycleActivityPhase) {
  if (phase === "finder") return plan.finder;
  if (phase === "candidate-evaluator") return plan.candidateEvaluator;
  if (phase === "condition" || phase === "optimizer-evaluator") return plan.modeActivity;
  return plan.patchPlanner;
}

function phaseMaximum(
  round: MutableRound,
  phase: CycleActivityPhase,
  runId: string,
): CycleBudgetDelta {
  const entry = planEntry(round.plan, phase);
  if (entry === null) return invalid(runId, `phase ${phase} has no round-plan credit`);
  return Object.freeze({
    attempts: entry.maxAttempts,
    costUsd: entry.maxCostUsd,
    dynamicNodes: phase === "patch-planner" ? round.plan.maxDynamicNodes : 0,
  });
}

function phaseHasCompleted(round: MutableRound, phase: CycleActivityPhase): boolean {
  if (phase === "finder") return round.discovery !== null;
  if (phase === "candidate-evaluator") return round.evaluation !== null;
  if (phase === "condition") return round.modeOutcome?.mode === "while";
  if (phase === "optimizer-evaluator") return round.modeOutcome?.mode === "evaluator-optimizer";
  return round.patchDecision !== null;
}

function parsePlan(
  value: unknown,
  request: CycleControllerRequest,
  dynamicNodes: number,
  maximumValue: unknown,
  runId: string,
): { readonly plan: CycleRoundPlan; readonly maximum: CycleBudgetDelta } {
  const item = record(value, runId, "round plan");
  closedKeys(item, ["finder", "candidateEvaluator", "modeActivity", "patchPlanner", "maxDynamicNodes"], runId, "round plan");
  const parseEntry = (entryValue: unknown, expectedPhase: CycleActivityPhase) => {
    const entry = record(entryValue, runId, `${expectedPhase} reservation`);
    closedKeys(entry, ["phase", "activityId", "maxAttempts", "maxCostUsd"], runId, `${expectedPhase} reservation`);
    const bound = binding(request, expectedPhase);
    if (bound === null || entry.phase !== expectedPhase || entry.activityId !== bound.activityId) {
      return invalid(runId, `${expectedPhase} round-plan binding drifted`);
    }
    const maxAttempts = integer(entry.maxAttempts, runId, `${expectedPhase}.maxAttempts`, 1);
    if (maxAttempts > bound.maxAttemptsPerRound) invalid(runId, `${expectedPhase} attempts widen the request`);
    let expectedCost = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      expectedCost = add(expectedCost, bound.maxCostUsdPerAttempt, runId, "planned cost");
    }
    if (cost(entry.maxCostUsd, runId, `${expectedPhase}.maxCostUsd`) !== expectedCost) {
      invalid(runId, `${expectedPhase} cost is not its exact worst case`, "GE_CYCLE_COUNTER_MISMATCH");
    }
    return Object.freeze({ phase: expectedPhase, activityId: bound.activityId, maxAttempts, maxCostUsd: expectedCost });
  };
  const finder = parseEntry(item.finder, "finder");
  const candidateEvaluator = parseEntry(item.candidateEvaluator, "candidate-evaluator");
  const expectedMode = request.policy.mode === "while"
    ? "condition"
    : request.policy.mode === "evaluator-optimizer" ? "optimizer-evaluator" : null;
  const modeActivity = expectedMode === null
    ? (item.modeActivity === null ? null : invalid(runId, "until-dry plan invents a mode activity"))
    : parseEntry(item.modeActivity, expectedMode);
  const patchPlanner = item.patchPlanner === null
    ? null
    : parseEntry(item.patchPlanner, "patch-planner");
  if ((patchPlanner !== null) !== request.patches.enabled) invalid(runId, "patch plan contradicts request enablement");
  const maxDynamicNodes = integer(item.maxDynamicNodes, runId, "plan.maxDynamicNodes");
  if (patchPlanner === null && maxDynamicNodes !== 0) invalid(runId, "patch-free plan reserves structure");
  if (maxDynamicNodes > request.policy.maxDynamicNodes - dynamicNodes) {
    invalid(runId, "round plan widens remaining dynamic-node credit", "GE_CYCLE_COUNTER_MISMATCH");
  }
  const plan = Object.freeze({ finder, candidateEvaluator, modeActivity, patchPlanner, maxDynamicNodes });
  const entries = [finder, candidateEvaluator, ...(modeActivity === null ? [] : [modeActivity]), ...(patchPlanner === null ? [] : [patchPlanner])];
  const expectedMaximum = entries.reduce<CycleBudgetDelta>((total, entry) => Object.freeze({
    attempts: add(total.attempts, entry.maxAttempts, runId, "planned attempts", true),
    costUsd: add(total.costUsd, entry.maxCostUsd, runId, "planned cost"),
    dynamicNodes: total.dynamicNodes,
  }), Object.freeze({ attempts: 0, costUsd: 0, dynamicNodes: maxDynamicNodes }));
  const maximum = budget(maximumValue, runId, "round maximum");
  exact(maximum, expectedMaximum, runId, "round maximum does not equal its closed plan", true);
  return { plan, maximum };
}

function phaseAllowed(round: MutableRound, request: CycleControllerRequest, phase: CycleActivityPhase): boolean {
  if (phase === "finder") return round.discovery === null;
  if (phase === "candidate-evaluator") return round.discovery !== null && round.evaluation === null;
  if (phase === "condition") return request.policy.mode === "while" && round.evaluation !== null && round.modeOutcome === null;
  if (phase === "optimizer-evaluator") return request.policy.mode === "evaluator-optimizer" && round.evaluation !== null && round.modeOutcome === null;
  return round.modeOutcome !== null && round.patchDecision === null;
}

function keys(value: unknown, runId: string, label: string): readonly string[] {
  return Object.freeze(array(value, runId, label).map((item) => text(item, runId, label)));
}

function coordinate(value: unknown, runId: string, label: string): CycleGraphCoordinate {
  const item = record(value, runId, label);
  closedKeys(item, ["graphRevision", "graphHash", "revisionHash"], runId, label);
  const result = {
    graphRevision: integer(item.graphRevision, runId, `${label}.graphRevision`, 1),
    graphHash: text(item.graphHash, runId, `${label}.graphHash`),
    revisionHash: text(item.revisionHash, runId, `${label}.revisionHash`),
  };
  if (!/^[0-9a-f]{64}$/u.test(result.graphHash) || !/^[0-9a-f]{64}$/u.test(result.revisionHash)) {
    return invalid(runId, `${label} hashes are invalid`);
  }
  return Object.freeze(result);
}

function modeOutcome(value: unknown, request: CycleControllerRequest, runId: string): CycleModeOutcome {
  const item = record(value, runId, "mode outcome");
  if (request.policy.mode === "until-dry" && item.mode === "until-dry" && Object.keys(item).length === 1) {
    return Object.freeze({ mode: "until-dry" });
  }
  if (request.policy.mode === "while" && item.mode === "while" && typeof item.condition === "boolean"
      && Object.keys(item).length === 2) {
    return Object.freeze({ mode: "while", condition: item.condition });
  }
  if (request.policy.mode === "evaluator-optimizer" && item.mode === "evaluator-optimizer"
      && (item.verdict === "accept" || item.verdict === "revise" || item.verdict === "unknown")
      && Object.keys(item).length === 2) {
    return Object.freeze({ mode: "evaluator-optimizer", verdict: item.verdict });
  }
  return invalid(runId, "mode outcome contradicts controller mode");
}

function projection(round: MutableRound | null): CycleOpenRoundProjection | null {
  if (round === null) return null;
  let phase: CycleOpenRoundProjection["phase"] = "reserved";
  if (round.unresolvedFailure !== null) phase = "failed";
  else if (round.openActivity !== null) phase = "running";
  else if (round.patchDecision !== null) phase = "patch-decided";
  else if (round.modeOutcome !== null) phase = "mode-decided";
  else if (round.evaluation !== null) phase = "evaluated";
  else if (round.discovery !== null) phase = "discovered";
  return Object.freeze({
    iteration: round.iteration,
    phase,
    plan: round.plan,
    planHash: round.planHash,
    reservationId: round.reservation.reservationId,
    openActivity: round.openActivity,
    discovery: round.discovery,
    evaluation: round.evaluation,
    modeOutcome: round.modeOutcome,
    patchDecision: round.patchDecision,
  });
}

/** Strictly validate and fold one exact D7 event prefix without executing work. */
export function foldCycleControllerEvents(
  eventValues: readonly CycleControllerEvent[],
  options: FoldCycleOptions = {},
): CycleControllerFold {
  if (eventValues.length === 0) throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", "unknown", "cycle history is empty");
  const events = eventValues.map(validateEventWire);
  const first = events[0] as CycleControllerEvent;
  const runId = first.controllerRunId;
  let request: CycleControllerRequest | undefined;
  let requestHash = "";
  let controllerHash = "";
  let startedAt = "";
  let deadlineAt = "";
  let currentRevision: CycleGraphCoordinate | undefined;
  let activeLease: CycleLease | null = null;
  let lastLeaseId: string | null = null;
  let maxLeaseEpoch = 0;
  let maxFencingToken = 0;
  let nextIteration = 1;
  const seen: string[] = [];
  const seenSet = new Set<string>();
  const accepted: string[] = [];
  const rejected: string[] = [];
  const unknown: string[] = [];
  const unevaluated: string[] = [];
  const acceptedSet = new Set<string>();
  const rejectedSet = new Set<string>();
  const unknownSet = new Set<string>();
  const unevaluatedSet = new Set<string>();
  let consecutiveDryRounds = 0;
  let attemptsUsed = 0;
  let costUsd = 0;
  let dynamicNodes = 0;
  let durationMs = 0;
  let round: MutableRound | null = null;
  const reservations = new Map<string, MutableReservation>();
  const inDoubt: CycleOpenActivity[] = [];
  const decidedPatches: Array<{ patchId: string; patchHash: string; outcome: "accepted" | "rejected"; decisionSequence: number }> = [];
  const committedRounds: CycleRoundRecord[] = [];
  let terminalObservation: CycleExitObservation | null = null;
  let terminalResult: CycleControllerFold["terminalResult"] = null;
  let lastTimestamp = -Infinity;
  const eventIds = new Set<string>();

  for (const [index, event] of events.entries()) {
    verifyCycleEventIntegrity(event, index === 0 ? undefined : events[index - 1]);
    if (eventIds.has(event.eventId)) invalid(runId, "event ID is duplicated");
    eventIds.add(event.eventId);
    if (terminalResult !== null) invalid(runId, "event follows terminal result");
    const eventTime = Date.parse(event.timestamp);
    if (!Number.isFinite(eventTime) || eventTime < lastTimestamp) invalid(runId, "event timestamps regress or are invalid");
    lastTimestamp = eventTime;
    if (index === 0) {
      if (event.type !== "ControllerCreated" || event.lease !== null || event.sequence !== 0) {
        invalid(runId, "history must begin with unleased ControllerCreated");
      }
    } else {
      if (event.lease === null) invalid(runId, "mutation event has no lease");
      validateCycleLease(event.lease, runId);
      if (event.type !== "LeaseAcquired" && event.type !== "LeaseRenewed") {
        if (activeLease === null) invalid(runId, "event has no active lease");
        exact(event.lease, activeLease, runId, "event uses stale lease identity");
        if (eventTime >= Date.parse(activeLease.expiresAt)) invalid(runId, "event uses an expired lease");
      }
    }

    const data = record(event.data, runId, `${event.type}.data`);
    if (round?.closingRelease !== null && round?.closingRelease !== undefined) {
      const expectedType = round.closingRelease === "round-complete"
        ? "RoundCommitted"
        : "ControllerTerminated";
      if (event.type !== expectedType) {
        invalid(
          runId,
          round.closingRelease === "round-complete"
            ? "round completion release is not followed by RoundCommitted"
            : "closing budget release is not followed by ControllerTerminated",
        );
      }
    }
    if (round?.openActivitySettled === true
        && event.type !== "LeaseAcquired" && event.type !== "LeaseRenewed" && event.type !== "LeaseReleased"
        && event.type !== "BudgetReservationReleased" && event.type !== "ControllerTerminated") {
      invalid(runId, "a charged unmatched activity can only be closed, never completed or redispatched");
    }
    if (event.type === "ControllerCreated") {
      request = validateCycleControllerRequest(data.request);
      requestHash = cycleRequestHash(request);
      controllerHash = cycleControllerHash(request);
      if (event.controllerRunId !== request.controllerRunId || event.hostRunId !== request.hostRun.runId
          || event.requestHash !== requestHash || event.controllerHash !== controllerHash
          || data.requestHash !== requestHash || data.controllerHash !== controllerHash) {
        invalid(runId, "controller creation identity or hashes drifted");
      }
      exact(data.identity, cycleControllerIdentity(request), runId, "controller identity body drifted");
      startedAt = text(data.startedAt, runId, "startedAt");
      deadlineAt = text(data.deadlineAt, runId, "deadlineAt");
      const timestampPattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
      if (!timestampPattern.test(startedAt) || !timestampPattern.test(deadlineAt)
          || Date.parse(startedAt) !== eventTime
          || Date.parse(deadlineAt) - Date.parse(startedAt) !== request.policy.maxDurationMs) {
        invalid(runId, "controller deadline is not the exact policy duration");
      }
      currentRevision = request.initialGraph;
      if (request.lineage.origin === "fork") {
        const parent = options.parent;
        if (parent === undefined || !VERIFIED_CYCLE_FOLDS.has(parent)
            || parent.request.controllerRunId !== request.lineage.parentControllerRunId
            || parent.lastSequence !== request.lineage.parentSequence
            || parent.historyPrefixHash !== request.lineage.parentHistoryHash
            || !sameCoordinate(parent.currentRevision, request.initialGraph)) {
          invalid(runId, "fork lineage does not bind the supplied parent prefix");
        }
        for (const key of parent.seenKeys) { seen.push(key); seenSet.add(key); }
        for (const key of parent.acceptedKeys) { accepted.push(key); acceptedSet.add(key); }
        for (const key of parent.rejectedKeys) { rejected.push(key); rejectedSet.add(key); }
        for (const key of parent.unknownKeys) { unknown.push(key); unknownSet.add(key); }
        for (const key of parent.unevaluatedKeys) { unevaluated.push(key); unevaluatedSet.add(key); }
        consecutiveDryRounds = parent.consecutiveDryRounds;
        attemptsUsed = parent.attemptsUsed;
        costUsd = parent.costUsd;
        dynamicNodes = parent.dynamicNodes;
        durationMs = parent.durationMs;
        nextIteration = parent.nextIteration;
        committedRounds.push(...parent.committedRounds);
        inDoubt.push(...parent.inDoubtActivities);
        const inheritedOpen = parent.openRound?.openActivity;
        if (inheritedOpen?.sideEffects === "non-idempotent"
            && !inDoubt.some(({ activityKey }) => activityKey === inheritedOpen.activityKey)) {
          inDoubt.push(inheritedOpen);
        }
      } else if (options.parent !== undefined) {
        invalid(runId, "non-fork history cannot inherit a parent projection");
      }
      if (event.graphRevision !== currentRevision.graphRevision) invalid(runId, "creation graph revision drifted");
      continue;
    }
    if (request === undefined || currentRevision === undefined) invalid(runId, "history has no controller request");
    const elapsed = eventTime - Date.parse(startedAt);
    if (!Number.isSafeInteger(elapsed) || elapsed < 0) {
      invalid(runId, "event timestamp is outside the trusted elapsed-time envelope");
    }
    durationMs = Math.max(durationMs, elapsed);
    if (event.controllerRunId !== runId || event.hostRunId !== request.hostRun.runId
        || event.requestHash !== requestHash || event.controllerHash !== controllerHash) {
      invalid(runId, "event controller identity drifted");
    }

    if (event.type === "LeaseAcquired") {
      const lease = event.lease as CycleLease;
      const reason = data.reason;
      if (reason !== "start" && reason !== "resume" && reason !== "takeover") invalid(runId, "lease acquisition reason is invalid");
      if (lease.leaseEpoch <= maxLeaseEpoch || lease.fencingToken <= maxFencingToken
          || Date.parse(lease.acquiredAt) > eventTime || Date.parse(lease.expiresAt) <= eventTime) {
        invalid(runId, "lease fence or interval did not advance");
      }
      if (maxLeaseEpoch === 0) {
        if (reason !== "start" || data.previousLeaseId !== null) invalid(runId, "first lease is not the start lease");
      } else if (reason === "start" || data.previousLeaseId !== lastLeaseId || lease.leaseId === lastLeaseId) {
        invalid(runId, "reacquired lease does not bind the prior identity");
      } else if (activeLease !== null && reason !== "takeover" && eventTime < Date.parse(activeLease.expiresAt)) {
        invalid(runId, "lease was acquired while an unexpired holder remained active");
      }
      activeLease = lease;
      lastLeaseId = lease.leaseId;
      maxLeaseEpoch = lease.leaseEpoch;
      maxFencingToken = lease.fencingToken;
      continue;
    }
    if (event.type === "LeaseRenewed") {
      const lease = event.lease as CycleLease;
      if (activeLease === null || lease.leaseId !== activeLease.leaseId
          || lease.holderId !== activeLease.holderId || lease.leaseEpoch !== activeLease.leaseEpoch
          || lease.fencingToken !== activeLease.fencingToken || lease.acquiredAt !== activeLease.acquiredAt
          || data.previousExpiresAt !== activeLease.expiresAt || data.newExpiresAt !== lease.expiresAt
          || eventTime >= Date.parse(activeLease.expiresAt)
          || Date.parse(lease.expiresAt) <= Date.parse(activeLease.expiresAt)) {
        invalid(runId, "lease renewal changed or failed to extend its fence");
      }
      activeLease = lease;
      continue;
    }
    if (event.type === "LeaseReleased") {
      if (activeLease === null || data.reason !== "paused" && data.reason !== "handoff") invalid(runId, "lease release is invalid");
      activeLease = null;
      continue;
    }
    if (event.type === "RoundReserved") {
      if (round !== null || integer(data.iteration, runId, "iteration", 1) !== nextIteration) {
        invalid(runId, "round reservation is not contiguous");
      }
      if (nextIteration > request.policy.maxIterations || seen.length >= request.policy.maxDiscoveries
          || eventTime >= Date.parse(deadlineAt) || durationMs >= request.policy.maxDurationMs) {
        invalid(runId, "round was reserved after a hard preflight stop");
      }
      const parsed = parsePlan(data.plan, request, dynamicNodes, data.maximum, runId);
      const planHash = text(data.planHash, runId, "planHash");
      if (hashWithDomain(CYCLE_ROUND_PLAN_DOMAIN, parsed.plan) !== planHash) invalid(runId, "round plan hash drifted");
      const current = coordinate(data.currentRevision, runId, "round current revision");
      exact(current, currentRevision, runId, "round uses a stale graph revision");
      if (data.deadlineAt !== deadlineAt) invalid(runId, "round deadline drifted");
      if (attemptsUsed + parsed.maximum.attempts > request.policy.maxTotalAttempts
          || costUsd + parsed.maximum.costUsd > request.policy.maxCostUsd
          || dynamicNodes + parsed.maximum.dynamicNodes > request.policy.maxDynamicNodes) {
        invalid(runId, "round reservation exceeds controller policy", "GE_CYCLE_COUNTER_MISMATCH");
      }
      const reservationId = text(data.reservationId, runId, "reservationId");
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(reservationId)
          || reservationId === "." || reservationId === "..") invalid(runId, "reservation ID is invalid");
      if (reservations.has(reservationId)) invalid(runId, "reservation ID is reused");
      const reservation: MutableReservation = {
        reservationId, iteration: nextIteration, maximum: parsed.maximum,
        committed: Object.freeze({ attempts: 0, costUsd: 0, dynamicNodes: 0 }),
        released: Object.freeze({ attempts: 0, costUsd: 0, dynamicNodes: 0 }),
      };
      reservations.set(reservationId, reservation);
      round = {
        iteration: nextIteration, plan: parsed.plan, planHash, reservation,
        openActivity: null, openActivitySettled: false, pendingSettlement: null,
        discovery: null, evaluation: null, modeOutcome: null, patchDecision: null,
        unresolvedFailure: null, closingRelease: null,
        attemptsByPhase: new Map(), keysByPhase: new Map(),
        committedByPhase: new Map(), releasedPhases: new Set(),
      };
      nextIteration += 1;
      continue;
    }
    if (event.type === "ActivityStarted") {
      if (round?.closingRelease !== null && round?.closingRelease !== undefined) {
        invalid(runId, "activity starts after a closing budget release");
      }
      if (round === null || round.openActivity !== null || round.pendingSettlement !== null
          || integer(data.iteration, runId, "activity iteration", 1) !== round.iteration) {
        invalid(runId, "activity starts outside one open ready round");
      }
      if (eventTime >= Date.parse(deadlineAt) || durationMs >= request.policy.maxDurationMs) {
        invalid(runId, "activity dispatch occurs at or after the controller deadline");
      }
      const phase = text(data.phase, runId, "activity phase") as CycleActivityPhase;
      if (!["finder", "candidate-evaluator", "condition", "optimizer-evaluator", "patch-planner"].includes(phase)
          || round.releasedPhases.has(phase)
          || !phaseAllowed(round, request, phase)) invalid(runId, "activity phase is not ready");
      const bound = binding(request, phase);
      const planned = planEntry(round.plan, phase);
      if (bound === null || planned === null || data.activityId !== bound.activityId
          || data.sideEffects !== bound.sideEffects || data.reservationId !== round.reservation.reservationId) {
        invalid(runId, "activity start is not request/plan-bound");
      }
      const attempt = integer(data.attempt, runId, "activity attempt", 1);
      if (attempt !== (round.attemptsByPhase.get(phase) ?? 0) + 1 || attempt > planned.maxAttempts) {
        invalid(runId, "activity attempt is not contiguous or exceeds its plan");
      }
      if (round.unresolvedFailure !== null
          && (!round.unresolvedFailure.retryable
            || (round.unresolvedFailure.inDoubt && bound.sideEffects === "non-idempotent"))) {
        invalid(runId, "unsafe or non-retryable activity was retried");
      }
      const inputHash = text(data.inputHash, runId, "activity inputHash");
      if (!/^[0-9a-f]{64}$/u.test(inputHash)) invalid(runId, "activity inputHash is invalid");
      const expectedKey = hashWithDomain(CYCLE_ACTIVITY_DOMAIN, {
        controllerRunId: runId, controllerHash, iteration: round.iteration, phase,
        activityId: bound.activityId, inputHash,
      });
      if (data.activityKey !== expectedKey || (round.keysByPhase.has(phase) && round.keysByPhase.get(phase) !== expectedKey)) {
        invalid(runId, "activity key preimage or retry identity drifted");
      }
      round.attemptsByPhase.set(phase, attempt);
      round.keysByPhase.set(phase, expectedKey);
      round.openActivity = Object.freeze({
        iteration: round.iteration,
        reservationId: round.reservation.reservationId,
        phase,
        activityId: bound.activityId,
        activityKey: expectedKey,
        attempt,
        sideEffects: bound.sideEffects,
        inputHash,
      });
      round.openActivitySettled = false;
      round.unresolvedFailure = null;
      continue;
    }
    if (event.type === "ActivityFailed") {
      if (round === null || round.openActivity === null
          || round.openActivitySettled
          || data.activityKey !== round.openActivity.activityKey || data.iteration !== round.iteration
          || data.attempt !== round.openActivity.attempt) invalid(runId, "failure has no matching activity claim");
      const failure = record(data.failure, runId, "activity failure");
      closedKeys(failure, ["phase", "code", "retryable", "inDoubt"], runId, "activity failure");
      if (failure.phase !== round.openActivity.phase || typeof failure.code !== "string"
          || !/^GE_[A-Z0-9_]{3,64}$/u.test(failure.code)
          || typeof failure.retryable !== "boolean" || typeof failure.inDoubt !== "boolean"
          || round.openActivity.sideEffects === "non-idempotent" && failure.inDoubt !== true
          || round.openActivity.sideEffects === "none" && failure.inDoubt !== false) {
        invalid(runId, "activity failure is malformed");
      }
      const usage = record(data.usage, runId, "failure usage");
      closedKeys(usage, ["attempts", "costUsd"], runId, "failure usage");
      const delta = Object.freeze({
        attempts: integer(usage.attempts, runId, "failure attempts"),
        costUsd: cost(usage.costUsd, runId, "failure cost"), dynamicNodes: 0,
      });
      if (delta.attempts !== 1 || delta.costUsd > (binding(request, round.openActivity.phase) as CycleActivityBinding).maxCostUsdPerAttempt) {
        invalid(runId, "failure usage exceeds activity claim", "GE_CYCLE_COUNTER_MISMATCH");
      }
      round.pendingSettlement = { phase: round.openActivity.phase, delta };
      round.unresolvedFailure = { code: failure.code, retryable: failure.retryable, inDoubt: failure.inDoubt };
      if (failure.inDoubt) inDoubt.push(round.openActivity);
      round.openActivity = null;
      continue;
    }
    if (event.type === "DiscoveryCommitted") {
      if (round === null || round.openActivity?.phase !== "finder"
          || round.openActivitySettled
          || data.iteration !== round.iteration || data.activityKey !== round.openActivity.activityKey) {
        invalid(runId, "discovery has no matching finder claim");
      }
      const candidatesValue = decodeCycleInlinePayload(data.candidateBatch, request.policy.maxCandidateBatchBytes, runId);
      const classified = validateCycleCandidates(candidatesValue, request.policy, seenSet, runId);
      exact(data.freshKeys, classified.freshKeys, runId, "fresh candidate projection drifted");
      exact(data.duplicateKeys, classified.duplicateKeys, runId, "duplicate candidate projection drifted");
      exact(data.seenAdditions, classified.seenAdditions, runId, "seen additions drifted");
      if (data.candidateBatchHash !== classified.candidateBatchHash
          || data.candidateCount !== classified.candidates.length) invalid(runId, "candidate batch identity drifted");
      for (const key of classified.seenAdditions) {
        seenSet.add(key); seen.push(key); unevaluatedSet.add(key); unevaluated.push(key);
      }
      const usage = record(data.usage, runId, "finder usage");
      closedKeys(usage, ["attempts", "costUsd"], runId, "finder usage");
      const delta = Object.freeze({ attempts: integer(usage.attempts, runId, "finder attempts"), costUsd: cost(usage.costUsd, runId, "finder cost"), dynamicNodes: 0 });
      if (delta.attempts !== 1 || delta.costUsd > request.activities.finder.maxCostUsdPerAttempt) {
        invalid(runId, "finder usage exceeds its claim", "GE_CYCLE_COUNTER_MISMATCH");
      }
      round.discovery = Object.freeze({
        candidateBatchHash: classified.candidateBatchHash,
        candidateCount: classified.candidates.length,
        freshKeys: classified.freshKeys,
        duplicateKeys: classified.duplicateKeys,
        seenAdditions: classified.seenAdditions,
        candidates: classified.candidates,
      });
      round.pendingSettlement = { phase: "finder", delta };
      round.openActivity = null;
      if (integer(data.durationMs, runId, "discovery duration") !== durationMs) {
        invalid(runId, "discovery duration is not the trusted cumulative elapsed value");
      }
      continue;
    }
    if (event.type === "CandidateEvaluationCommitted") {
      if (round === null || round.discovery === null || round.openActivity?.phase !== "candidate-evaluator"
          || round.openActivitySettled
          || data.iteration !== round.iteration || data.activityKey !== round.openActivity.activityKey) {
        invalid(runId, "candidate evaluation has no matching claim");
      }
      const classified = validateCycleVerdicts(data.verdicts, round.discovery.freshKeys, runId);
      exact(data.acceptedKeys, classified.acceptedKeys, runId, "accepted keys drifted");
      exact(data.rejectedKeys, classified.rejectedKeys, runId, "rejected keys drifted");
      exact(data.unknownKeys, classified.unknownKeys, runId, "unknown keys drifted");
      for (const key of round.discovery.freshKeys) {
        unevaluatedSet.delete(key);
        const position = unevaluated.indexOf(key);
        if (position >= 0) unevaluated.splice(position, 1);
      }
      for (const key of classified.acceptedKeys) { acceptedSet.add(key); accepted.push(key); }
      for (const key of classified.rejectedKeys) { rejectedSet.add(key); rejected.push(key); }
      for (const key of classified.unknownKeys) { unknownSet.add(key); unknown.push(key); }
      const usage = record(data.usage, runId, "evaluator usage");
      closedKeys(usage, ["attempts", "costUsd"], runId, "evaluator usage");
      const delta = Object.freeze({ attempts: integer(usage.attempts, runId, "evaluator attempts"), costUsd: cost(usage.costUsd, runId, "evaluator cost"), dynamicNodes: 0 });
      if (delta.attempts !== 1 || delta.costUsd > request.activities.candidateEvaluator.maxCostUsdPerAttempt) {
        invalid(runId, "candidate evaluator usage exceeds its claim", "GE_CYCLE_COUNTER_MISMATCH");
      }
      round.evaluation = Object.freeze({
        verdicts: classified.verdicts,
        acceptedKeys: classified.acceptedKeys,
        rejectedKeys: classified.rejectedKeys,
        unknownKeys: classified.unknownKeys,
      });
      round.pendingSettlement = { phase: "candidate-evaluator", delta };
      round.openActivity = null;
      if (integer(data.durationMs, runId, "evaluation duration") !== durationMs) {
        invalid(runId, "candidate evaluation duration is not the trusted cumulative elapsed value");
      }
      continue;
    }
    if (event.type === "ModeOutcomeCommitted") {
      if (round === null || round.evaluation === null || round.pendingSettlement !== null
          || data.iteration !== round.iteration) {
        invalid(runId, "mode outcome is outside an evaluated round");
      }
      const outcome = modeOutcome(data.outcome, request, runId);
      const usage = record(data.usage, runId, "mode usage");
      closedKeys(usage, ["attempts", "costUsd"], runId, "mode usage");
      const delta = Object.freeze({ attempts: integer(usage.attempts, runId, "mode attempts"), costUsd: cost(usage.costUsd, runId, "mode cost"), dynamicNodes: 0 });
      if (request.policy.mode === "until-dry") {
        if (data.activityKey !== null || delta.attempts !== 0 || delta.costUsd !== 0 || round.openActivity !== null) {
          invalid(runId, "until-dry mode outcome must be deterministic and unclaimed");
        }
      } else {
        const phase = request.policy.mode === "while" ? "condition" : "optimizer-evaluator";
        if (round.openActivity?.phase !== phase || data.activityKey !== round.openActivity.activityKey
            || delta.attempts !== 1 || delta.costUsd > (binding(request, phase) as CycleActivityBinding).maxCostUsdPerAttempt) {
          invalid(runId, "mode outcome has no matching activity claim");
        }
        round.pendingSettlement = { phase, delta };
        round.openActivity = null;
      }
      round.modeOutcome = outcome;
      if (integer(data.durationMs, runId, "mode duration") !== durationMs) {
        invalid(runId, "mode duration is not the trusted cumulative elapsed value");
      }
      continue;
    }
    if (event.type === "PatchAccepted" || event.type === "PatchRejected") {
      if (round === null || round.openActivity?.phase !== "patch-planner"
          || round.openActivitySettled
          || data.iteration !== round.iteration || data.plannerActivityKey !== round.openActivity.activityKey) {
        invalid(runId, "patch decision has no matching planner claim");
      }
      const patchValue = decodeCycleInlinePayload(data.patch, 4_194_304, runId);
      const patch = validateGraphPatchShape(patchValue, runId);
      const patchHash = canonicalHash(patch);
      if (data.patchHash !== patchHash || data.patchId !== patch.patchId) invalid(runId, "patch bytes/hash/ID drifted");
      exact(data.requestedBase, currentRevision, runId, "patch requested base drifted");
      exact(patch.base, currentRevision, runId, "patch document base drifted");
      const budgetOutcome = record(data.budgetOutcome, runId, "patch budget outcome");
      closedKeys(
        budgetOutcome, ["reservationId", "requested", "committed", "released"],
        runId, "patch budget outcome",
      );
      const authority = record(data.authoritySnapshot, runId, "patch authority snapshot");
      closedKeys(authority, [
        "proposerActivityKey", "principalHash", "proposerGrantHash", "runGrantHash",
        "tenantGrantHash", "deploymentGrantHash", "effectiveGrantHash", "policyHash", "approvalHash",
      ], runId, "patch authority snapshot");
      const hashPattern = /^[0-9a-f]{64}$/u;
      for (const [name, value] of Object.entries(authority)) {
        if (name === "approvalHash" && value === null) continue;
        if (typeof value !== "string" || !hashPattern.test(value)) invalid(runId, `authority ${name} is invalid`);
      }
      if (authority.proposerActivityKey !== round.openActivity.activityKey) {
        invalid(runId, "patch authority snapshot is detached from its planner activity");
      }
      if (typeof data.policySnapshotHash !== "string" || !hashPattern.test(data.policySnapshotHash)) {
        invalid(runId, "patch policy snapshot hash is invalid");
      }
      const requested = budget(budgetOutcome.requested, runId, "patch requested budget");
      const committed = budget(budgetOutcome.committed, runId, "patch committed budget");
      const released = budget(budgetOutcome.released, runId, "patch released budget");
      const plannerPlan = round.plan.patchPlanner;
      if (plannerPlan === null) invalid(runId, "patch decision has no planner reservation");
      if (committed.attempts !== 1
          || committed.costUsd > (binding(request, "patch-planner") as CycleActivityBinding).maxCostUsdPerAttempt) {
        invalid(runId, "patch decision does not charge its exact planner attempt", "GE_CYCLE_COUNTER_MISMATCH");
      }
      const priorPlannerUsage = round.committedByPhase.get("patch-planner")
        ?? Object.freeze({ attempts: 0, costUsd: 0, dynamicNodes: 0 });
      exact(
        requested,
        subtract(phaseMaximum(round, "patch-planner", runId), priorPlannerUsage, {
          attempts: 0, costUsd: 0, dynamicNodes: 0,
        }, runId),
        runId,
        "patch requested budget is not its exact remaining planner reservation",
        true,
      );
      exact({
        attempts: committed.attempts + released.attempts,
        costUsd: committed.costUsd + released.costUsd,
        dynamicNodes: committed.dynamicNodes + released.dynamicNodes,
      }, requested, runId, "patch budget outcome does not reconcile", true);
      const remaining = subtract(round.reservation.maximum, round.reservation.committed, round.reservation.released, runId);
      if (requested.attempts > remaining.attempts || requested.costUsd > remaining.costUsd
          || requested.dynamicNodes > remaining.dynamicNodes || budgetOutcome.reservationId !== round.reservation.reservationId) {
        invalid(runId, "patch budget exceeds the live reservation", "GE_CYCLE_COUNTER_MISMATCH");
      }
      let decision: GraphPatchDecision;
      const diagnostics = array(data.diagnostics, runId, "patch diagnostics");
      for (const [index, diagnosticValue] of diagnostics.entries()) {
        const item = record(diagnosticValue, runId, `patch diagnostic ${index}`);
        closedKeys(item, ["code", "phase", "path"], runId, `patch diagnostic ${index}`);
        if (typeof item.code !== "string" || !/^GE_[A-Z0-9_]{3,64}$/u.test(item.code)
            || !Number.isSafeInteger(item.phase) || (item.phase as number) < 1 || (item.phase as number) > 13
            || typeof item.path !== "string" || !/^(?:\/(?:[^~/]|~[01])*)*$/u.test(item.path)) {
          invalid(runId, `patch diagnostic ${index} is invalid`);
        }
      }
      if (event.type === "PatchAccepted") {
        if (data.outcome !== "accepted" || diagnostics.length !== 0
            || committed.dynamicNodes !== patch.append.nodes.length) invalid(runId, "accepted patch decision is malformed");
        const revisionValue = record(data.resultingRevision, runId, "resulting revision");
        closedKeys(revisionValue, ["body", "revisionHash"], runId, "resulting revision");
        const revisionBody = record(revisionValue.body, runId, "revision body");
        const expectedRevision = graphRevision(revisionBody);
        if (revisionValue.revisionHash !== expectedRevision.revisionHash
            || expectedRevision.body.graphRevision !== currentRevision.graphRevision + 1
            || expectedRevision.body.previousRevisionHash !== currentRevision.revisionHash
            || expectedRevision.body.patchHash !== patchHash || event.graphRevision !== expectedRevision.body.graphRevision) {
          invalid(runId, "accepted revision chain drifted");
        }
        currentRevision = Object.freeze({
          graphRevision: expectedRevision.body.graphRevision,
          graphHash: expectedRevision.body.graphHash,
          revisionHash: expectedRevision.revisionHash,
        });
        decision = snapshotJson(data) as unknown as GraphPatchDecision;
      } else {
        if (data.outcome !== "rejected" || typeof data.errorCode !== "string"
            || !/^GE_PATCH_[A-Z0-9_]{3,64}$/u.test(data.errorCode)
            || diagnostics.length === 0 || committed.dynamicNodes !== 0
            || event.graphRevision !== currentRevision.graphRevision) invalid(runId, "rejected patch decision is malformed");
        decision = snapshotJson(data) as unknown as GraphPatchDecision;
      }
      if (decidedPatches.some((item) => item.patchId === patch.patchId)) invalid(runId, "patch ID was decided twice");
      decidedPatches.push({ patchId: patch.patchId, patchHash, outcome: decision.outcome, decisionSequence: event.sequence });
      round.patchDecision = decision;
      round.pendingSettlement = { phase: "patch-planner", delta: committed };
      round.openActivity = null;
      if (integer(data.decidedAtDurationMs, runId, "patch duration") !== durationMs) {
        invalid(runId, "patch decision duration is not the trusted cumulative elapsed value");
      }
      continue;
    }
    if (event.type === "BudgetReservationSettled") {
      if (round === null || data.iteration !== round.iteration
          || data.reservationId !== round.reservation.reservationId) invalid(runId, "settlement names no open reservation");
      const phase = text(data.phase, runId, "settlement phase") as CycleActivityPhase;
      const delta = budget(data.committed, runId, "settled budget");
      if (round.pendingSettlement === null) {
        if (round.openActivity === null || round.openActivitySettled || round.openActivity.phase !== phase
            || delta.attempts !== 1 || delta.dynamicNodes !== 0
            || delta.costUsd > (binding(request, phase) as CycleActivityBinding).maxCostUsdPerAttempt) {
          invalid(runId, "settlement has no matching result or in-doubt claim");
        }
        round.openActivitySettled = true;
      } else {
        if (round.pendingSettlement.phase !== phase) invalid(runId, "settlement phase drifted");
        exact(delta, round.pendingSettlement.delta, runId, "settlement amount drifted", true);
        round.pendingSettlement = null;
      }
      round.reservation.committed = Object.freeze({
        attempts: add(round.reservation.committed.attempts, delta.attempts, runId, "reservation attempts", true),
        costUsd: add(round.reservation.committed.costUsd, delta.costUsd, runId, "reservation cost"),
        dynamicNodes: add(round.reservation.committed.dynamicNodes, delta.dynamicNodes, runId, "reservation nodes", true),
      });
      attemptsUsed = add(attemptsUsed, delta.attempts, runId, "attempt total", true);
      costUsd = add(costUsd, delta.costUsd, runId, "cost total");
      dynamicNodes = add(dynamicNodes, delta.dynamicNodes, runId, "dynamic-node total", true);
      const priorPhase = round.committedByPhase.get(phase)
        ?? Object.freeze({ attempts: 0, costUsd: 0, dynamicNodes: 0 });
      const nextPhase = Object.freeze({
        attempts: add(priorPhase.attempts, delta.attempts, runId, `${phase} attempts`, true),
        costUsd: add(priorPhase.costUsd, delta.costUsd, runId, `${phase} cost`),
        dynamicNodes: add(priorPhase.dynamicNodes, delta.dynamicNodes, runId, `${phase} nodes`, true),
      });
      subtract(phaseMaximum(round, phase, runId), nextPhase, {
        attempts: 0, costUsd: 0, dynamicNodes: 0,
      }, runId);
      round.committedByPhase.set(phase, nextPhase);
      const remaining = subtract(round.reservation.maximum, round.reservation.committed, round.reservation.released, runId);
      const totals = record(data.totals, runId, "settlement totals");
      exact(totals, {
        attemptsCommitted: attemptsUsed, costUsdCommitted: costUsd,
        dynamicNodesCommitted: dynamicNodes, liveReservations: remaining,
      }, runId, "settlement totals drifted", true);
      continue;
    }
    if (event.type === "BudgetReservationReleased") {
      if (round === null || data.iteration !== round.iteration
          || data.reservationId !== round.reservation.reservationId || round.pendingSettlement !== null) {
        invalid(runId, "release names no settled open reservation");
      }
      const reason = text(data.reason, runId, "release reason");
      if (!["phase-complete", "round-complete", "failed", "cancelled", "patch-rejected", "bound-reached"].includes(reason)) {
        invalid(runId, "release reason is invalid");
      }
      if ((reason === "phase-complete") !== Object.hasOwn(data, "phase")) {
        invalid(runId, "phase-complete release applicability is invalid");
      }
      if (reason === "phase-complete"
          && !["finder", "candidate-evaluator", "condition", "optimizer-evaluator", "patch-planner"].includes(String(data.phase))) {
        invalid(runId, "phase-complete release phase is invalid");
      }
      const delta = budget(data.released, runId, "released budget");
      if (delta.attempts === 0 && delta.costUsd === 0 && delta.dynamicNodes === 0) invalid(runId, "zero-unit release is invalid");
      if (reason === "phase-complete") {
        const phase = data.phase as CycleActivityPhase;
        if (round.releasedPhases.has(phase) || !phaseHasCompleted(round, phase)) {
          invalid(runId, "phase-complete release does not name one newly completed phase");
        }
        const committed = round.committedByPhase.get(phase)
          ?? Object.freeze({ attempts: 0, costUsd: 0, dynamicNodes: 0 });
        exact(delta, subtract(phaseMaximum(round, phase, runId), committed, {
          attempts: 0, costUsd: 0, dynamicNodes: 0,
        }, runId), runId, "phase-complete release is not the exact unused phase credit", true);
        round.releasedPhases.add(phase);
      }
      round.reservation.released = Object.freeze({
        attempts: add(round.reservation.released.attempts, delta.attempts, runId, "released attempts", true),
        costUsd: add(round.reservation.released.costUsd, delta.costUsd, runId, "released cost"),
        dynamicNodes: add(round.reservation.released.dynamicNodes, delta.dynamicNodes, runId, "released nodes", true),
      });
      const remaining = subtract(round.reservation.maximum, round.reservation.committed, round.reservation.released, runId);
      exact(data.remaining, remaining, runId, "release remaining budget drifted", true);
      exact(data.totals, {
        attemptsCommitted: attemptsUsed, costUsdCommitted: costUsd,
        dynamicNodesCommitted: dynamicNodes, liveReservations: remaining,
      }, runId, "release totals drifted", true);
      if (reason !== "phase-complete") round.closingRelease = reason;
      continue;
    }
    if (event.type === "RoundCommitted") {
      if (round === null || round.discovery === null || round.evaluation === null || round.modeOutcome === null
          || round.openActivity !== null || round.pendingSettlement !== null
          || !isZero(subtract(round.reservation.maximum, round.reservation.committed, round.reservation.released, runId))) {
        invalid(runId, "round committed before all required facts and reservations closed");
      }
      const dry = round.discovery.freshKeys.length === 0;
      consecutiveDryRounds = request.policy.mode === "until-dry"
        ? (dry ? consecutiveDryRounds + 1 : 0)
        : 0;
      const expected: CycleRoundRecord = Object.freeze({
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
        attemptsUsed,
        costUsd,
        dynamicNodes,
        durationMs,
        currentRevision,
      });
      const actual = record(data.record, runId, "round record");
      exact(actual, expected, runId, "committed round projection drifted");
      committedRounds.push(expected);
      reservations.delete(round.reservation.reservationId);
      round = null;
      continue;
    }
    if (event.type === "ControllerTerminated") {
      const observation = parseObservation(data.observation, runId);
      const result = record(data.result, runId, "terminal result");
      if (round !== null) {
        if (round.pendingSettlement !== null || !isZero(subtract(round.reservation.maximum, round.reservation.committed, round.reservation.released, runId))) {
          invalid(runId, "terminal event leaves an unsettled reservation", "GE_CYCLE_COUNTER_MISMATCH");
        }
        if (round.openActivity !== null) {
          if (!round.openActivitySettled) invalid(runId, "terminal open activity was not charged");
          if (!inDoubt.some((item) => item.activityKey === round?.openActivity?.activityKey)) {
            inDoubt.push(round.openActivity);
          }
        }
        reservations.delete(round.reservation.reservationId);
      }
      if (reservations.size !== 0) invalid(runId, "terminal event retains a live reservation", "GE_CYCLE_COUNTER_MISMATCH");
      const convergence = convergenceReason(request, committedRounds.at(-1), consecutiveDryRounds);
      const lastOutcome = committedRounds.at(-1)?.modeOutcome;
      const nextMaximum = round === null && convergence === null
        ? createCycleRoundPlan(request, request.policy.maxDynamicNodes - dynamicNodes).maximum
        : null;
      const expectedFacts = {
        maxDuration: durationMs >= request.policy.maxDurationMs,
        maxCost: costUsd > 0 && costUsd >= request.policy.maxCostUsd
          || nextMaximum !== null && costUsd + nextMaximum.costUsd > request.policy.maxCostUsd,
        maxTotalAttempts: attemptsUsed > 0 && attemptsUsed >= request.policy.maxTotalAttempts
          || nextMaximum !== null && attemptsUsed + nextMaximum.attempts > request.policy.maxTotalAttempts,
        maxDynamicNodes: dynamicNodes > 0 && dynamicNodes >= request.policy.maxDynamicNodes
          || nextMaximum !== null && dynamicNodes + nextMaximum.dynamicNodes > request.policy.maxDynamicNodes,
        maxDiscoveries: seen.length >= request.policy.maxDiscoveries,
        maxIterations: nextIteration - 1 >= request.policy.maxIterations,
        patchRejected: round?.patchDecision?.outcome === "rejected",
        unknownVerdict: convergence === null && request.policy.mode === "evaluator-optimizer"
          && lastOutcome?.mode === "evaluator-optimizer" && lastOutcome.verdict === "unknown",
        convergenceReason: convergence,
      };
      if (round?.closingRelease === "cancelled" && !observation.cancelled
          || round?.closingRelease === "failed" && !observation.failed
          || round?.closingRelease === "patch-rejected" && !observation.patchRejected
          || round?.closingRelease === "bound-reached"
            && !observation.maxDuration && !observation.maxCost
            && !observation.maxTotalAttempts && !observation.maxDynamicNodes
            && !observation.maxDiscoveries && !observation.maxIterations) {
        invalid(runId, "terminal observation does not bind its closing budget release");
      }
      for (const [name, expected] of Object.entries(expectedFacts)) {
        if (observation[name as keyof CycleExitObservation] !== expected) invalid(runId, `terminal observation ${name} drifted`);
      }
      const exitReason = selectCycleExitReason(observation);
      const expectedResult = {
        apiVersion: "graphengineering.reacher-z.github.io/cycle-results/v1alpha1",
        kind: "CycleControllerResult",
        controllerRunId: runId,
        controllerHash,
        requestHash,
        mode: request.policy.mode,
        status: cycleStatus(exitReason),
        exitReason,
        iterations: nextIteration - 1,
        consecutiveDryRounds,
        seenCount: seen.length,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        unknownCount: unknown.length,
        unevaluatedCount: unevaluated.length,
        attemptsUsed,
        costUsd,
        dynamicNodes,
        durationMs,
        lastGraphRevision: currentRevision.graphRevision,
        lastGraphHash: currentRevision.graphHash,
        lastRevisionHash: currentRevision.revisionHash,
        terminalSequence: event.sequence,
        historyPrefixHash: event.previousEventHash,
      };
      exact(result, expectedResult, runId, "terminal result does not equal folded history");
      terminalObservation = observation;
      terminalResult = snapshotJson(result) as unknown as CycleControllerFold["terminalResult"];
      activeLease = null;
      round = null;
      continue;
    }
    invalid(runId, `unsupported event type ${event.type}`);
  }
  if (request === undefined || currentRevision === undefined) invalid(runId, "history has no creation event");
  if ((options.requireTerminal ?? false) && terminalResult === null) invalid(runId, "history is not terminal");
  const liveReservations: CycleReservationProjection[] = [...reservations.values()].map((item) => Object.freeze({
    reservationId: item.reservationId,
    iteration: item.iteration,
    maximum: item.maximum,
    committed: item.committed,
    released: item.released,
    remaining: subtract(item.maximum, item.committed, item.released, runId),
  }));
  const tail = events.at(-1) as CycleControllerEvent;
  const result = Object.freeze({
    request,
    requestHash,
    controllerHash,
    startedAt,
    deadlineAt,
    currentRevision,
    activeLease,
    maxLeaseEpoch,
    maxFencingToken,
    lastLeaseId,
    nextIteration,
    seenKeys: Object.freeze([...seen]),
    acceptedKeys: Object.freeze([...accepted]),
    rejectedKeys: Object.freeze([...rejected]),
    unknownKeys: Object.freeze([...unknown]),
    unevaluatedKeys: Object.freeze([...unevaluated]),
    consecutiveDryRounds,
    attemptsUsed,
    costUsd,
    dynamicNodes,
    durationMs,
    liveReservations: Object.freeze(liveReservations),
    inDoubtActivities: Object.freeze([...inDoubt]),
    decidedPatches: Object.freeze(decidedPatches),
    committedRounds: Object.freeze(committedRounds),
    openRound: projection(round),
    terminalObservation,
    terminalResult,
    lastSequence: tail.sequence,
    historyPrefixHash: tail.recordHash,
  });
  VERIFIED_CYCLE_FOLDS.add(result);
  return result;
}

function sameCoordinate(left: CycleGraphCoordinate, right: CycleGraphCoordinate): boolean {
  return left.graphRevision === right.graphRevision && left.graphHash === right.graphHash
    && left.revisionHash === right.revisionHash;
}

function isZero(value: CycleBudgetDelta): boolean {
  return value.attempts === 0 && value.costUsd === 0 && value.dynamicNodes === 0;
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

function convergenceReason(
  request: CycleControllerRequest,
  last: CycleRoundRecord | undefined,
  dryRounds: number,
): CycleExitObservation["convergenceReason"] {
  if (last === undefined) return null;
  if (request.policy.mode === "until-dry") {
    return dryRounds >= (request.policy.consecutiveDryRounds as number) ? "DRY" : null;
  }
  if (last.modeOutcome.mode === "while") return last.modeOutcome.condition ? null : "CONDITION_FALSE";
  if (last.modeOutcome.mode === "evaluator-optimizer") return last.modeOutcome.verdict === "accept" ? "EVALUATOR_ACCEPTED" : null;
  return null;
}

function parseObservation(value: unknown, runId: string): CycleExitObservation {
  const item = record(value, runId, "exit observation");
  closedKeys(item, [
    "cancelled", "maxDuration", "maxCost", "maxTotalAttempts", "maxDynamicNodes",
    "maxDiscoveries", "maxIterations", "patchRejected", "failed", "failureCode",
    "unknownVerdict", "convergenceReason",
  ], runId, "exit observation");
  const bool = (name: string): boolean => {
    if (typeof item[name] !== "boolean") return invalid(runId, `observation.${name} is not boolean`);
    return item[name];
  };
  const failed = bool("failed");
  const failureCode = item.failureCode;
  if ((failed && (typeof failureCode !== "string" || !/^GE_[A-Z0-9_]{3,64}$/u.test(failureCode)))
      || (!failed && failureCode !== null)) {
    return invalid(runId, "failure observation code is inconsistent");
  }
  const convergence = item.convergenceReason;
  if (convergence !== null && convergence !== "DRY" && convergence !== "CONDITION_FALSE"
      && convergence !== "EVALUATOR_ACCEPTED") invalid(runId, "convergence observation is invalid");
  return Object.freeze({
    cancelled: bool("cancelled"),
    maxDuration: bool("maxDuration"),
    maxCost: bool("maxCost"),
    maxTotalAttempts: bool("maxTotalAttempts"),
    maxDynamicNodes: bool("maxDynamicNodes"),
    maxDiscoveries: bool("maxDiscoveries"),
    maxIterations: bool("maxIterations"),
    patchRejected: bool("patchRejected"),
    failed,
    failureCode: failed ? failureCode as string : null,
    unknownVerdict: bool("unknownVerdict"),
    convergenceReason: convergence as CycleExitObservation["convergenceReason"],
  });
}

function checkpointState(fold: CycleControllerFold): Readonly<Record<string, unknown>> {
  const openRound = fold.openRound === null ? null : {
    iteration: fold.openRound.iteration,
    phase: fold.openRound.phase,
    plan: fold.openRound.plan,
    planHash: fold.openRound.planHash,
    reservationId: fold.openRound.reservationId,
    openActivity: fold.openRound.openActivity,
    discovery: fold.openRound.discovery === null ? null : {
      candidateBatchHash: fold.openRound.discovery.candidateBatchHash,
      candidateCount: fold.openRound.discovery.candidateCount,
      freshKeys: fold.openRound.discovery.freshKeys,
      duplicateKeys: fold.openRound.discovery.duplicateKeys,
      seenAdditions: fold.openRound.discovery.seenAdditions,
    },
    evaluation: fold.openRound.evaluation === null ? null : {
      acceptedKeys: fold.openRound.evaluation.acceptedKeys,
      rejectedKeys: fold.openRound.evaluation.rejectedKeys,
      unknownKeys: fold.openRound.evaluation.unknownKeys,
    },
    modeOutcome: fold.openRound.modeOutcome,
    patchDecision: fold.openRound.patchDecision === null ? null : patchProjection(fold.openRound.patchDecision),
  };
  return snapshotJson({
    contractVersion: "cycle-controller-recovery/v1alpha1",
    request: fold.request,
    requestHash: fold.requestHash,
    controllerHash: fold.controllerHash,
    startedAt: fold.startedAt,
    deadlineAt: fold.deadlineAt,
    currentRevision: fold.currentRevision,
    status: fold.terminalResult === null ? "active" : "terminal",
    nextIteration: fold.nextIteration,
    seenKeys: fold.seenKeys,
    acceptedKeys: fold.acceptedKeys,
    rejectedKeys: fold.rejectedKeys,
    unknownKeys: fold.unknownKeys,
    unevaluatedKeys: fold.unevaluatedKeys,
    consecutiveDryRounds: fold.consecutiveDryRounds,
    attemptsUsed: fold.attemptsUsed,
    costUsd: fold.costUsd,
    dynamicNodes: fold.dynamicNodes,
    durationMs: fold.durationMs,
    liveReservations: fold.liveReservations,
    inDoubtActivities: fold.inDoubtActivities,
    decidedPatches: fold.decidedPatches,
    committedRounds: fold.committedRounds,
    openRound,
    terminalObservation: fold.terminalObservation,
    terminalResult: fold.terminalResult,
  }) as unknown as Readonly<Record<string, unknown>>;
}

export function createCycleControllerCheckpoint(
  events: readonly CycleControllerEvent[],
  checkpointId: string,
  createdAt: string,
  options: FoldCycleOptions = {},
): CycleControllerCheckpoint {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
  const timestamp = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
  if (!identifier.test(checkpointId) || checkpointId === "." || checkpointId === ".."
      || !timestamp.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    throw new CycleControllerError(
      "GE_CYCLE_INVALID_HISTORY", events[0]?.controllerRunId ?? "unknown",
      "checkpoint identity or creation timestamp is invalid",
    );
  }
  const fold = foldCycleControllerEvents(events, options);
  const body = {
    apiVersion: "graphengineering.reacher-z.github.io/cycle-controller-checkpoints/v1alpha1" as const,
    kind: "CycleControllerCheckpoint" as const,
    controllerRunId: fold.request.controllerRunId,
    hostRunId: fold.request.hostRun.runId,
    eventStreamId: fold.request.eventStreamId,
    checkpointId,
    lastSequence: fold.lastSequence,
    historyPrefixHash: fold.historyPrefixHash,
    controllerHash: fold.controllerHash,
    requestHash: fold.requestHash,
    graphRevision: fold.currentRevision.graphRevision,
    createdAt,
    lease: fold.terminalResult === null ? fold.activeLease : null,
    payloadDisposition: "inline-unredacted" as const,
    redacted: false as const,
    state: checkpointState(fold),
  };
  return snapshotJson({ ...body, contentHash: canonicalHash(body) }) as unknown as CycleControllerCheckpoint;
}

export function validateCycleControllerCheckpoint(
  checkpointValue: CycleControllerCheckpoint | unknown,
  events: readonly CycleControllerEvent[],
  options: FoldCycleOptions = {},
): CycleControllerFold {
  let checkpoint: CycleControllerCheckpoint;
  try {
    checkpoint = captureBoundedJson(checkpointValue, 16_777_216).value as unknown as CycleControllerCheckpoint;
  } catch (error) {
    throw new CycleControllerError(
      "GE_CYCLE_INVALID_HISTORY", "unknown", "checkpoint is not bounded portable JSON", {}, { cause: error },
    );
  }
  const envelope = record(checkpoint, checkpoint.controllerRunId ?? "unknown", "checkpoint");
  closedKeys(envelope, [
    "apiVersion", "kind", "controllerRunId", "hostRunId", "eventStreamId", "checkpointId",
    "lastSequence", "historyPrefixHash", "controllerHash", "requestHash", "graphRevision",
    "createdAt", "lease", "payloadDisposition", "redacted", "state", "contentHash",
  ], checkpoint.controllerRunId ?? "unknown", "checkpoint");
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
  const hash = /^[0-9a-f]{64}$/u;
  const timestamp = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
  const identifiers = [
    checkpoint.controllerRunId, checkpoint.hostRunId, checkpoint.eventStreamId, checkpoint.checkpointId,
  ];
  if (checkpoint.apiVersion !== "graphengineering.reacher-z.github.io/cycle-controller-checkpoints/v1alpha1"
      || checkpoint.kind !== "CycleControllerCheckpoint"
      || identifiers.some((value) => typeof value !== "string" || !identifier.test(value)
        || value === "." || value === "..")
      || !hash.test(checkpoint.historyPrefixHash) || !hash.test(checkpoint.controllerHash)
      || !hash.test(checkpoint.requestHash) || !hash.test(checkpoint.contentHash)
      || !Number.isSafeInteger(checkpoint.graphRevision) || checkpoint.graphRevision < 1
      || typeof checkpoint.createdAt !== "string" || !timestamp.test(checkpoint.createdAt)
      || !Number.isFinite(Date.parse(checkpoint.createdAt))
      || checkpoint.payloadDisposition !== "inline-unredacted" || checkpoint.redacted !== false) {
    invalid(checkpoint.controllerRunId ?? "unknown", "checkpoint envelope is invalid");
  }
  if (checkpoint.lease !== null) validateCycleLease(checkpoint.lease, checkpoint.controllerRunId);
  record(checkpoint.state, checkpoint.controllerRunId, "checkpoint state");
  const { contentHash, ...body } = checkpoint;
  if (canonicalHash(body) !== contentHash) {
    throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", checkpoint.controllerRunId ?? "unknown", "checkpoint content hash drifted");
  }
  if (!Number.isSafeInteger(checkpoint.lastSequence) || checkpoint.lastSequence < 0
      || checkpoint.lastSequence >= events.length) {
    throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", checkpoint.controllerRunId, "checkpoint is ahead of the event tail");
  }
  const prefix = events.slice(0, checkpoint.lastSequence + 1);
  const fold = foldCycleControllerEvents(prefix, options);
  const expected = createCycleControllerCheckpoint(prefix, checkpoint.checkpointId, checkpoint.createdAt, options);
  exact(checkpoint, expected, checkpoint.controllerRunId, "checkpoint does not equal the complete event-prefix fold");
  return fold;
}

/** Simple native CAS event store for local deterministic execution and tests. */
export class MemoryCycleControllerEventStore implements CycleControllerEventStore {
  readonly #streams = new Map<string, CycleControllerEvent[]>();

  async append(
    streamId: string,
    expectedSequence: number,
    eventValues: readonly CycleControllerEvent[],
  ): Promise<number> {
    const current = this.#streams.get(streamId) ?? [];
    const actual = current.length - 1;
    if (actual !== expectedSequence) {
      throw new CycleControllerError(
        "GE_CYCLE_RESUME_CONFLICT",
        eventValues[0]?.controllerRunId ?? "unknown",
        "cycle event-store CAS conflict",
        { expectedSequence, actualSequence: actual },
      );
    }
    const events = eventValues.map((event) => snapshotJson(event) as unknown as CycleControllerEvent);
    let previous = current.at(-1);
    for (const event of events) {
      verifyCycleEventIntegrity(event, previous);
      previous = event;
    }
    this.#streams.set(streamId, [...current, ...events]);
    return actual + events.length;
  }

  async *read(streamId: string, fromSequence = 0): AsyncIterable<CycleControllerEvent> {
    for (const event of (this.#streams.get(streamId) ?? []).slice(fromSequence)) yield event;
  }

  snapshot(streamId: string): readonly CycleControllerEvent[] {
    return Object.freeze([...(this.#streams.get(streamId) ?? [])]);
  }
}

/** Atomic replace-by-key checkpoint cache; event history remains authoritative. */
export class MemoryCycleControllerCheckpointStore implements CycleControllerCheckpointStore {
  readonly #checkpoints = new Map<string, CycleControllerCheckpoint>();

  async write(scope: string, checkpointId: string, checkpointValue: CycleControllerCheckpoint): Promise<void> {
    const checkpoint = snapshotJson(checkpointValue) as unknown as CycleControllerCheckpoint;
    this.#checkpoints.set(`${scope}\0${checkpointId}`, checkpoint);
  }

  async read(scope: string, checkpointId: string): Promise<CycleControllerCheckpoint | null> {
    return this.#checkpoints.get(`${scope}\0${checkpointId}`) ?? null;
  }
}

export async function readCycleControllerEvents(
  store: CycleControllerEventStore,
  streamId: string,
): Promise<readonly CycleControllerEvent[]> {
  const events: CycleControllerEvent[] = [];
  try {
    for await (const event of store.read(streamId)) events.push(event);
  } catch (error) {
    throw new CycleControllerError(
      "GE_CYCLE_STORE_FAILED", "unknown", "cycle event stream could not be read", {
        causeName: error instanceof Error ? error.name : typeof error,
      }, { cause: error },
    );
  }
  return Object.freeze(events);
}
