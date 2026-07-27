import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  canonicalHash,
  canonicalSerialize,
  compareUnicodeCodePoints,
  validateEdgeDocument,
  validateEndpointDocument,
  validateNodeDocument,
} from "@graph-engineering/core";
import { snapshotJson } from "./json.js";
import {
  CycleControllerError,
  type CycleActivityBinding,
  type CycleActivityPhase,
  type CycleActivityReservation,
  type CycleBudgetDelta,
  type CycleCandidate,
  type CycleCandidateVerdict,
  type CycleControllerEvent,
  type CycleControllerEventType,
  type CycleControllerPolicy,
  type CycleControllerRequest,
  type CycleExitObservation,
  type CycleExitReason,
  type CycleGraphCoordinate,
  type CycleInDoubtResolutionCommand,
  type CycleInlinePayload,
  type CycleLease,
  type CycleModeOutcome,
  type CycleResultStatus,
  type CycleRoundPlan,
  type GraphPatch,
  type GraphRevision,
  type GraphRevisionBody,
} from "./cycle-types.js";
import type { JsonValue } from "./types.js";

export const CYCLE_CONTROLLER_DOMAIN = "graph-engineering/cycle-controller/v1alpha1\0";
export const CYCLE_REQUEST_DOMAIN = "graph-engineering/cycle-controller-request/v1alpha1\0";
export const CYCLE_EVENT_DOMAIN = "graph-engineering/cycle-event/v1alpha1\0";
export const CYCLE_ACTIVITY_DOMAIN = "graph-engineering/cycle-activity/v1alpha1\0";
export const CYCLE_ROUND_PLAN_DOMAIN = "graph-engineering/cycle-round-plan/v1alpha1\0";
export const CYCLE_IN_DOUBT_RESOLUTION_DOMAIN = "graph-engineering/cycle-in-doubt-resolution/v1alpha1\0";
export const GRAPH_REVISION_DOMAIN = "graph-engineering/revision-chain/v1alpha1\0";

export const MAX_PORTABLE_DEPTH = 100;
export const MAX_PORTABLE_VALUES = 100_000;
export const MAX_PATCH_BYTES = 4_194_304;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const HASH = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PATCH_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/u;
const VERSIONED_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}\/v[0-9]+(?:alpha[0-9]+|beta[0-9]+)?$/u;
const TIMESTAMP = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

function fail(
  code: ConstructorParameters<typeof CycleControllerError>[0],
  controllerRunId: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new CycleControllerError(code, controllerRunId, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  controllerRunId: string,
  label: string,
  code: ConstructorParameters<typeof CycleControllerError>[0] = "GE_CYCLE_INVALID_REQUEST",
): void {
  const actual = Object.keys(value).sort(compareUnicodeCodePoints);
  const wanted = [...expected].sort(compareUnicodeCodePoints);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, controllerRunId, `${label} must be closed`, { actual, expected: wanted });
  }
}

function numberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  integer: boolean,
): value is number {
  return typeof value === "number" && Number.isFinite(value)
    && (!integer || Number.isSafeInteger(value)) && value >= minimum && value <= maximum;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value) && value !== "." && value !== "..";
}

function hash(value: unknown): value is string {
  return typeof value === "string" && HASH.test(value);
}

/** Hash already-canonical JSON bytes with the protocol's domain separator. */
export function hashWithDomain(domain: string, value: unknown): string {
  return createHash("sha256").update(domain, "utf8").update(canonicalSerialize(value), "utf8").digest("hex");
}

/** Hash raw UTF-8 bytes without a domain separator. */
export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function inspectPortable(value: unknown, maximumBytes?: number): string {
  const pending: Array<{
    readonly value: unknown;
    readonly depth: number;
    readonly path: string;
    readonly exit?: boolean;
  }> = [
    { value, depth: 0, path: "#" },
  ];
  const ancestors = new WeakSet<object>();
  let count = 0;
  while (pending.length > 0) {
    const item = pending.pop() as (typeof pending)[number];
    if (item.exit) {
      ancestors.delete(item.value as object);
      continue;
    }
    count += 1;
    if (count > MAX_PORTABLE_VALUES) throw new TypeError("portable JSON exceeds 100000 values");
    if (item.depth > MAX_PORTABLE_DEPTH) throw new TypeError("portable JSON exceeds depth 100");
    if (item.value === null || typeof item.value === "string" || typeof item.value === "boolean") continue;
    if (typeof item.value === "number") {
      if (!Number.isFinite(item.value) || (Number.isInteger(item.value) && !Number.isSafeInteger(item.value))) {
        throw new TypeError(`non-portable number at ${item.path}`);
      }
      continue;
    }
    if (typeof item.value !== "object") throw new TypeError(`unsupported value at ${item.path}`);
    if (isProxy(item.value)) throw new TypeError(`proxy is not portable at ${item.path}`);
    if (ancestors.has(item.value)) throw new TypeError(`cycle is not portable at ${item.path}`);
    const prototype = Object.getPrototypeOf(item.value);
    if (Array.isArray(item.value)) {
      if (prototype !== Array.prototype) throw new TypeError(`non-ordinary array at ${item.path}`);
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`non-plain object at ${item.path}`);
    }
    if (Object.getOwnPropertySymbols(item.value).length > 0) {
      throw new TypeError(`symbol key is not portable at ${item.path}`);
    }
    ancestors.add(item.value);
    pending.push({ value: item.value, depth: item.depth, path: item.path, exit: true });
    const descriptors = Object.getOwnPropertyDescriptors(item.value);
    const keys = Object.keys(descriptors).filter((key) => !(Array.isArray(item.value) && key === "length"));
    if (Array.isArray(item.value)) {
      const length = item.value.length;
      if (keys.length !== length) throw new TypeError(`sparse or extended array at ${item.path}`);
      for (let index = 0; index < length; index += 1) {
        if (!Object.hasOwn(descriptors, String(index))) throw new TypeError(`sparse array at ${item.path}/${index}`);
      }
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      const key = keys[index] as string;
      const descriptor = descriptors[key];
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
        throw new TypeError(`accessor or hidden property at ${item.path}/${key}`);
      }
      pending.push({ value: descriptor.value, depth: item.depth + 1, path: `${item.path}/${key}` });
    }
  }
  const serialized = canonicalSerialize(value);
  if (maximumBytes !== undefined && Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new TypeError(`canonical JSON exceeds ${maximumBytes} UTF-8 bytes`);
  }
  return serialized;
}

/** Capture a bounded, detached portable JSON value and its canonical bytes. */
export function captureBoundedJson(
  value: unknown,
  maximumBytes?: number,
): { readonly value: JsonValue; readonly canonicalJson: string } {
  const canonicalJson = inspectPortable(value, maximumBytes);
  return Object.freeze({ value: snapshotJson(value), canonicalJson });
}

/** Construct the truthful inline-alpha carrier used by the D7 protocol. */
export function createCycleInlinePayload(value: unknown, maximumBytes = MAX_PATCH_BYTES): CycleInlinePayload {
  const { canonicalJson } = captureBoundedJson(value, maximumBytes);
  return Object.freeze({
    disposition: "inline-unredacted",
    redacted: false,
    encoding: "canonical-json/v1alpha1",
    canonicalJson,
    utf8ByteLength: Buffer.byteLength(canonicalJson, "utf8"),
    sha256: sha256Utf8(canonicalJson),
  });
}

/** Validate an inline carrier and return its exact detached JSON payload. */
export function decodeCycleInlinePayload(
  value: unknown,
  maximumBytes = MAX_PATCH_BYTES,
  controllerRunId = "unknown",
): JsonValue {
  if (!isRecord(value)) return fail("GE_CYCLE_INVALID_HISTORY", controllerRunId, "inline payload is not an object");
  exactKeys(
    value,
    ["disposition", "redacted", "encoding", "canonicalJson", "utf8ByteLength", "sha256"],
    controllerRunId,
    "inline payload",
    "GE_CYCLE_INVALID_HISTORY",
  );
  if (value.disposition !== "inline-unredacted" || value.redacted !== false
      || value.encoding !== "canonical-json/v1alpha1" || typeof value.canonicalJson !== "string"
      || !numberInRange(value.utf8ByteLength, 1, maximumBytes, true) || !hash(value.sha256)) {
    return fail("GE_CYCLE_INVALID_HISTORY", controllerRunId, "inline payload shape is invalid");
  }
  if (Buffer.byteLength(value.canonicalJson, "utf8") !== value.utf8ByteLength
      || sha256Utf8(value.canonicalJson) !== value.sha256) {
    return fail("GE_CYCLE_INVALID_HISTORY", controllerRunId, "inline payload bytes or hash drifted");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.canonicalJson);
    if (inspectPortable(parsed, maximumBytes) !== value.canonicalJson) throw new TypeError("not canonical");
  } catch (error) {
    return fail("GE_CYCLE_INVALID_HISTORY", controllerRunId, "inline payload is not exact canonical JSON", {
      causeName: error instanceof Error ? error.name : typeof error,
    });
  }
  return snapshotJson(parsed);
}

/** Validate and detach one effective closed cycle policy. */
export function validateCycleControllerPolicy(
  value: unknown,
  controllerRunId = "unknown",
): CycleControllerPolicy {
  if (!isRecord(value)) return fail("GE_CYCLE_INVALID_POLICY", controllerRunId, "cycle policy must be an object");
  const mode = value.mode;
  if (mode !== "until-dry" && mode !== "while" && mode !== "evaluator-optimizer") {
    return fail("GE_CYCLE_INVALID_POLICY", controllerRunId, "cycle mode is invalid");
  }
  const keys = [
    "apiVersion", "kind", "mode", "maxIterations", "maxDurationMs", "maxCostUsd",
    "maxTotalAttempts", "maxDiscoveries", "maxDynamicNodes", "maxCandidatesPerRound",
    "maxCandidateBytes", "maxCandidateBatchBytes",
    ...(mode === "until-dry" ? ["consecutiveDryRounds"] : []),
  ];
  exactKeys(value, keys, controllerRunId, "cycle policy", "GE_CYCLE_INVALID_POLICY");
  if (value.apiVersion !== "graphengineering.reacher-z.github.io/cycle-policies/v1alpha1"
      || value.kind !== "CycleControllerPolicy"
      || !numberInRange(value.maxIterations, 1, 10_000, true)
      || !numberInRange(value.maxDurationMs, 1, 2_147_483_647, true)
      || !numberInRange(value.maxCostUsd, 0, MAX_SAFE, false)
      || !numberInRange(value.maxTotalAttempts, 1, MAX_SAFE, true)
      || !numberInRange(value.maxDiscoveries, 0, 10_000_000, true)
      || !numberInRange(value.maxDynamicNodes, 0, 100_000, true)
      || !numberInRange(value.maxCandidatesPerRound, 1, 100_000, true)
      || !numberInRange(value.maxCandidateBytes, 1, 1_048_576, true)
      || !numberInRange(value.maxCandidateBatchBytes, 1, 16_777_216, true)
      || (mode === "until-dry" && !numberInRange(value.consecutiveDryRounds, 1, 100, true))) {
    return fail("GE_CYCLE_INVALID_POLICY", controllerRunId, "cycle policy contains an invalid or unsafe bound");
  }
  return snapshotJson(value) as unknown as CycleControllerPolicy;
}

function validateActivityBinding(
  value: unknown,
  controllerRunId: string,
  label: string,
): CycleActivityBinding {
  if (!isRecord(value)) return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, `${label} must be an activity binding`);
  exactKeys(
    value,
    ["activityId", "implementationHash", "sideEffects", "maxAttemptsPerRound", "maxCostUsdPerAttempt", "timeoutMs"],
    controllerRunId,
    label,
  );
  if (!identifier(value.activityId) || !hash(value.implementationHash)
      || (value.sideEffects !== "none" && value.sideEffects !== "idempotent" && value.sideEffects !== "non-idempotent")
      || !numberInRange(value.maxAttemptsPerRound, 1, 100, true)
      || !numberInRange(value.maxCostUsdPerAttempt, 0, MAX_SAFE, false)
      || !numberInRange(value.timeoutMs, 1, 2_147_483_647, true)) {
    return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, `${label} is invalid`);
  }
  return snapshotJson(value) as unknown as CycleActivityBinding;
}

function validateCoordinate(value: unknown, controllerRunId: string, label: string, patchEnabled = false): CycleGraphCoordinate {
  if (!isRecord(value)) return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, `${label} must be a graph coordinate`);
  exactKeys(value, ["graphRevision", "graphHash", "revisionHash"], controllerRunId, label);
  const maximum = patchEnabled ? MAX_SAFE - 1 : MAX_SAFE;
  if (!numberInRange(value.graphRevision, 1, maximum, true) || !hash(value.graphHash) || !hash(value.revisionHash)) {
    return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, `${label} is invalid`);
  }
  return snapshotJson(value) as unknown as CycleGraphCoordinate;
}

/** Validate the closed standalone D7 request and all applicability constraints. */
export function validateCycleControllerRequest(value: unknown): CycleControllerRequest {
  const preliminaryId = isRecord(value) && typeof value.controllerRunId === "string"
    ? value.controllerRunId
    : "unknown";
  try {
    inspectPortable(value, 16_777_216);
  } catch (error) {
    return fail("GE_CYCLE_INVALID_REQUEST", preliminaryId, "cycle request is not bounded portable JSON", {
      causeName: error instanceof Error ? error.name : typeof error,
    });
  }
  if (!isRecord(value)) return fail("GE_CYCLE_INVALID_REQUEST", preliminaryId, "cycle request must be an object");
  exactKeys(value, [
    "apiVersion", "kind", "controllerRunId", "controllerId", "hostRun", "eventStreamId",
    "checkpointScope", "policy", "objective", "keyStrategyId", "rubricIdentity",
    "authorityCeilingHash", "pricingPolicyHash", "implementationHash", "payloadProfile",
    "initialGraph", "activities", "patches", "lineage",
  ], preliminaryId, "cycle request");
  if (value.apiVersion !== "graphengineering.reacher-z.github.io/cycle-controllers/v1alpha1"
      || value.kind !== "CycleControllerRequest" || !identifier(value.controllerRunId)
      || !identifier(value.controllerId) || !identifier(value.eventStreamId)
      || !identifier(value.checkpointScope) || !VERSIONED_IDENTITY.test(String(value.keyStrategyId))
      || !VERSIONED_IDENTITY.test(String(value.rubricIdentity)) || !hash(value.authorityCeilingHash)
      || !hash(value.pricingPolicyHash) || !hash(value.implementationHash)) {
    return fail("GE_CYCLE_INVALID_REQUEST", preliminaryId, "cycle request identity is invalid");
  }
  const controllerRunId = value.controllerRunId;
  if (!isRecord(value.hostRun)) return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "hostRun must be closed");
  exactKeys(value.hostRun, ["relationship", "runId"], controllerRunId, "hostRun");
  if (value.hostRun.relationship !== "standalone-child-controller" || !identifier(value.hostRun.runId)) {
    return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "hostRun is invalid");
  }
  const policy = validateCycleControllerPolicy(value.policy, controllerRunId);
  let objective: JsonValue;
  try {
    objective = decodeCycleInlinePayload(value.objective, MAX_PATCH_BYTES, controllerRunId);
  } catch (error) {
    return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "objective inline payload is invalid", {
      causeName: error instanceof Error ? error.name : typeof error,
    });
  }
  void objective;
  if (!isRecord(value.payloadProfile)) return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "payloadProfile must be closed");
  exactKeys(value.payloadProfile, ["contractVersion", "disposition", "redacted", "inlineRiskAuthorizationHash"], controllerRunId, "payloadProfile");
  if (value.payloadProfile.contractVersion !== "cycle-controller-inline-payloads/v1alpha1"
      || value.payloadProfile.disposition !== "inline-unredacted" || value.payloadProfile.redacted !== false
      || !hash(value.payloadProfile.inlineRiskAuthorizationHash)) {
    return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "payloadProfile makes an invalid protection claim");
  }
  if (!isRecord(value.patches)) return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "patches must be closed");
  exactKeys(value.patches, ["enabled", "limits"], controllerRunId, "patches");
  if (typeof value.patches.enabled !== "boolean") return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "patch enablement is invalid");
  const patchEnabled = value.patches.enabled;
  if (patchEnabled) {
    if (!isRecord(value.patches.limits)) return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "enabled patches require graph limits");
    exactKeys(value.patches.limits, ["maxNodes", "maxEdges", "maxOutputs", "maxDepth", "maxFanOut"], controllerRunId, "patch limits");
    const limits = value.patches.limits;
    if (!numberInRange(limits.maxNodes, 1, 100_000, true)
        || !numberInRange(limits.maxEdges, 0, 200_000, true)
        || !numberInRange(limits.maxOutputs, 1, 100_000, true)
        || !numberInRange(limits.maxDepth, 1, 100_000, true)
        || !numberInRange(limits.maxFanOut, 1, 100_000, true)) {
      return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "patch graph limits are invalid");
    }
  } else if (value.patches.limits !== null) {
    return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "disabled patches forbid limits");
  }
  validateCoordinate(value.initialGraph, controllerRunId, "initialGraph", patchEnabled);
  if (!isRecord(value.activities)) return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "activities must be closed");
  exactKeys(value.activities, ["finder", "candidateEvaluator", "condition", "optimizerEvaluator", "patchPlanner"], controllerRunId, "activities");
  validateActivityBinding(value.activities.finder, controllerRunId, "finder");
  validateActivityBinding(value.activities.candidateEvaluator, controllerRunId, "candidateEvaluator");
  const condition = value.activities.condition;
  const optimizer = value.activities.optimizerEvaluator;
  const planner = value.activities.patchPlanner;
  if ((policy.mode === "while") !== (condition !== null)
      || (policy.mode === "evaluator-optimizer") !== (optimizer !== null)
      || patchEnabled !== (planner !== null)) {
    return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "activity applicability contradicts mode or patch enablement");
  }
  if (condition !== null) validateActivityBinding(condition, controllerRunId, "condition");
  if (optimizer !== null) validateActivityBinding(optimizer, controllerRunId, "optimizerEvaluator");
  if (planner !== null) validateActivityBinding(planner, controllerRunId, "patchPlanner");
  if (!isRecord(value.lineage)) return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "lineage must be closed");
  if (value.lineage.origin === "start") {
    exactKeys(value.lineage, ["origin"], controllerRunId, "start lineage");
  } else if (value.lineage.origin === "fork") {
    exactKeys(value.lineage, ["origin", "parentControllerRunId", "parentSequence", "parentHistoryHash"], controllerRunId, "fork lineage");
    if (!identifier(value.lineage.parentControllerRunId)
        || !numberInRange(value.lineage.parentSequence, 0, MAX_SAFE, true)
        || !hash(value.lineage.parentHistoryHash)) {
      return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "fork lineage is invalid");
    }
  } else {
    return fail("GE_CYCLE_INVALID_REQUEST", controllerRunId, "lineage origin is invalid");
  }
  return snapshotJson(value) as unknown as CycleControllerRequest;
}

export function cycleControllerIdentity(requestValue: CycleControllerRequest | unknown): Readonly<Record<string, unknown>> {
  const request = validateCycleControllerRequest(requestValue);
  return Object.freeze({
    policy: request.policy,
    objectiveHash: request.objective.sha256,
    keyStrategyId: request.keyStrategyId,
    rubricIdentity: request.rubricIdentity,
    authorityCeilingHash: request.authorityCeilingHash,
    pricingPolicyHash: request.pricingPolicyHash,
    initialGraphRevision: request.initialGraph.graphRevision,
    initialGraphHash: request.initialGraph.graphHash,
    initialRevisionHash: request.initialGraph.revisionHash,
  });
}

export function cycleControllerHash(request: CycleControllerRequest | unknown): string {
  return hashWithDomain(CYCLE_CONTROLLER_DOMAIN, cycleControllerIdentity(request));
}

export function cycleRequestHash(request: CycleControllerRequest | unknown): string {
  return hashWithDomain(CYCLE_REQUEST_DOMAIN, validateCycleControllerRequest(request));
}

export function graphRevision(bodyValue: GraphRevisionBody | unknown): GraphRevision {
  if (!isRecord(bodyValue)) throw new TypeError("graph revision body must be an object");
  exactKeys(bodyValue, ["apiVersion", "kind", "graphRevision", "previousRevisionHash", "patchHash", "graphHash"], "unknown", "revision body", "GE_CYCLE_INVALID_HISTORY");
  if (bodyValue.apiVersion !== "graphengineering.reacher-z.github.io/graph-revisions/v1alpha1"
      || bodyValue.kind !== "GraphRevision" || !numberInRange(bodyValue.graphRevision, 2, MAX_SAFE, true)
      || !hash(bodyValue.previousRevisionHash) || !hash(bodyValue.patchHash) || !hash(bodyValue.graphHash)) {
    throw new TypeError("graph revision body is invalid");
  }
  const body = snapshotJson(bodyValue) as unknown as GraphRevisionBody;
  return Object.freeze({ body, revisionHash: hashWithDomain(GRAPH_REVISION_DOMAIN, body) });
}

function validateLeaseShape(value: unknown, controllerRunId: string): CycleLease {
  let captured: JsonValue;
  try {
    captured = captureBoundedJson(value, 4096).value;
  } catch (error) {
    return fail("GE_CYCLE_LEASE_CONFLICT", controllerRunId, "lease is not bounded portable JSON", {
      causeName: error instanceof Error ? error.name : typeof error,
    });
  }
  if (!isRecord(captured)) return fail("GE_CYCLE_LEASE_CONFLICT", controllerRunId, "lease must be an object");
  exactKeys(captured, ["leaseId", "holderId", "leaseEpoch", "fencingToken", "acquiredAt", "expiresAt"], controllerRunId, "lease", "GE_CYCLE_LEASE_CONFLICT");
  if (!identifier(captured.leaseId) || !identifier(captured.holderId)
      || !numberInRange(captured.leaseEpoch, 1, MAX_SAFE, true)
      || !numberInRange(captured.fencingToken, 1, MAX_SAFE, true)
      || typeof captured.acquiredAt !== "string" || typeof captured.expiresAt !== "string"
      || !TIMESTAMP.test(captured.acquiredAt) || !TIMESTAMP.test(captured.expiresAt)
      || !Number.isFinite(Date.parse(captured.acquiredAt)) || !Number.isFinite(Date.parse(captured.expiresAt))
      || Date.parse(captured.expiresAt) <= Date.parse(captured.acquiredAt)) {
    return fail("GE_CYCLE_LEASE_CONFLICT", controllerRunId, "lease identity or interval is invalid");
  }
  return captured as unknown as CycleLease;
}

export function validateCycleLease(value: unknown, controllerRunId = "unknown"): CycleLease {
  return validateLeaseShape(value, controllerRunId);
}

/** Validate and detach one authority-bound terminal in-doubt resolution command. */
export function validateCycleInDoubtResolutionCommand(
  value: unknown,
  controllerRunId = "unknown",
): CycleInDoubtResolutionCommand {
  let captured: JsonValue;
  try {
    captured = captureBoundedJson(value, 16_384).value;
  } catch (error) {
    return fail(
      "GE_CYCLE_RESOLUTION_INVALID",
      controllerRunId,
      "in-doubt resolution command is not bounded portable JSON",
      { causeName: error instanceof Error ? error.name : typeof error },
    );
  }
  if (!isRecord(captured)) {
    return fail(
      "GE_CYCLE_RESOLUTION_INVALID",
      controllerRunId,
      "in-doubt resolution command must be an object",
    );
  }
  const commandRunId = identifier(captured.controllerRunId)
    ? captured.controllerRunId
    : controllerRunId;
  exactKeys(captured, [
    "apiVersion", "kind", "resolutionId", "controllerRunId", "controllerHash",
    "requestHash", "eventStreamId", "expectedSequence", "expectedHistoryPrefixHash",
    "activityKey", "disposition", "evidenceHash", "authoritySnapshot",
  ], commandRunId, "in-doubt resolution command", "GE_CYCLE_RESOLUTION_INVALID");
  if (captured.apiVersion !== "graphengineering.reacher-z.github.io/cycle-in-doubt-resolutions/v1alpha1"
      || captured.kind !== "CycleInDoubtResolution"
      || !identifier(captured.resolutionId)
      || !identifier(captured.controllerRunId)
      || !identifier(captured.eventStreamId)
      || !hash(captured.controllerHash)
      || !hash(captured.requestHash)
      || !numberInRange(captured.expectedSequence, 0, MAX_SAFE, true)
      || !hash(captured.expectedHistoryPrefixHash)
      || !hash(captured.activityKey)
      || captured.disposition !== "confirmed-applied"
        && captured.disposition !== "confirmed-not-applied"
      || !hash(captured.evidenceHash)
      || !isRecord(captured.authoritySnapshot)) {
    return fail(
      "GE_CYCLE_RESOLUTION_INVALID",
      commandRunId,
      "in-doubt resolution command fields are invalid",
    );
  }
  exactKeys(captured.authoritySnapshot, [
    "principalHash", "grantHash", "policyHash", "leaseHolderHash",
  ], commandRunId, "in-doubt resolution authority", "GE_CYCLE_RESOLUTION_INVALID");
  if (!hash(captured.authoritySnapshot.principalHash)
      || !hash(captured.authoritySnapshot.grantHash)
      || !hash(captured.authoritySnapshot.policyHash)
      || !hash(captured.authoritySnapshot.leaseHolderHash)) {
    return fail(
      "GE_CYCLE_RESOLUTION_INVALID",
      commandRunId,
      "in-doubt resolution authority fields are invalid",
    );
  }
  return snapshotJson(captured) as unknown as CycleInDoubtResolutionCommand;
}

/** Return the stable idempotency hash for one validated resolution command. */
export function cycleInDoubtResolutionCommandHash(
  value: CycleInDoubtResolutionCommand | unknown,
  controllerRunId = "unknown",
): string {
  return hashWithDomain(
    CYCLE_IN_DOUBT_RESOLUTION_DOMAIN,
    validateCycleInDoubtResolutionCommand(value, controllerRunId),
  );
}

function hasUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function validateCycleCandidates(
  value: unknown,
  policy: CycleControllerPolicy,
  seenKeys: ReadonlySet<string>,
  controllerRunId = "unknown",
): {
  readonly candidates: readonly CycleCandidate[];
  readonly freshKeys: readonly string[];
  readonly duplicateKeys: readonly string[];
  readonly seenAdditions: readonly string[];
  readonly candidateBatchHash: string;
} {
  let captured: ReturnType<typeof captureBoundedJson>;
  try {
    captured = captureBoundedJson(value, policy.maxCandidateBatchBytes);
  } catch (error) {
    return fail("GE_CYCLE_INVALID_CANDIDATE", controllerRunId, "candidate batch is not bounded portable JSON", {
      causeName: error instanceof Error ? error.name : typeof error,
    });
  }
  if (!Array.isArray(captured.value) || captured.value.length > policy.maxCandidatesPerRound) {
    return fail("GE_CYCLE_INVALID_CANDIDATE", controllerRunId, "candidate count exceeds the effective round bound");
  }
  const detached: CycleCandidate[] = [];
  for (const [index, candidate] of captured.value.entries()) {
    if (!isRecord(candidate)) return fail("GE_CYCLE_INVALID_CANDIDATE", controllerRunId, "candidate must be an object", { index });
    exactKeys(candidate, ["key", "value"], controllerRunId, `candidate ${index}`, "GE_CYCLE_INVALID_CANDIDATE");
    if (typeof candidate.key !== "string" || candidate.key.length === 0 || !hasUnicodeScalarString(candidate.key)
        || Buffer.byteLength(candidate.key, "utf8") > 512) {
      return fail("GE_CYCLE_INVALID_CANDIDATE", controllerRunId, "candidate key is invalid", { index });
    }
    if (Buffer.byteLength(canonicalSerialize(candidate), "utf8") > policy.maxCandidateBytes) {
      return fail("GE_CYCLE_INVALID_CANDIDATE", controllerRunId, "candidate exceeds the effective item-byte bound", { index });
    }
    detached.push(snapshotJson(candidate) as unknown as CycleCandidate);
  }
  const temporary = new Set(seenKeys);
  const freshKeys: string[] = [];
  const duplicateKeys: string[] = [];
  for (const candidate of detached) {
    if (temporary.has(candidate.key)) duplicateKeys.push(candidate.key);
    else {
      temporary.add(candidate.key);
      freshKeys.push(candidate.key);
    }
  }
  if (freshKeys.length > policy.maxDiscoveries - seenKeys.size) {
    return fail("GE_CYCLE_INVALID_CANDIDATE", controllerRunId, "fresh candidates exceed remaining discovery credit");
  }
  return Object.freeze({
    candidates: Object.freeze(detached),
    freshKeys: Object.freeze(freshKeys),
    duplicateKeys: Object.freeze(duplicateKeys),
    seenAdditions: Object.freeze([...freshKeys]),
    candidateBatchHash: sha256Utf8(captured.canonicalJson),
  });
}

export function validateCycleVerdicts(
  value: unknown,
  freshKeys: readonly string[],
  controllerRunId = "unknown",
): {
  readonly verdicts: readonly CycleCandidateVerdict[];
  readonly acceptedKeys: readonly string[];
  readonly rejectedKeys: readonly string[];
  readonly unknownKeys: readonly string[];
} {
  const { value: captured } = captureBoundedJson(value, 16_777_216);
  if (!Array.isArray(captured) || captured.length !== freshKeys.length) {
    return fail("GE_CYCLE_INVALID_HISTORY", controllerRunId, "verdicts must classify every fresh key exactly once");
  }
  const expected = new Set(freshKeys);
  const observed = new Set<string>();
  const verdicts: CycleCandidateVerdict[] = [];
  const acceptedKeys: string[] = [];
  const rejectedKeys: string[] = [];
  const unknownKeys: string[] = [];
  for (const [index, verdict] of captured.entries()) {
    if (!isRecord(verdict)) return fail("GE_CYCLE_INVALID_HISTORY", controllerRunId, "verdict must be an object", { index });
    exactKeys(verdict, ["key", "verdict"], controllerRunId, `verdict ${index}`, "GE_CYCLE_INVALID_HISTORY");
    if (typeof verdict.key !== "string" || !expected.has(verdict.key) || observed.has(verdict.key)
        || (verdict.verdict !== "accept" && verdict.verdict !== "reject" && verdict.verdict !== "unknown")) {
      return fail("GE_CYCLE_INVALID_HISTORY", controllerRunId, "verdict identity or category is invalid", { index });
    }
    observed.add(verdict.key);
    verdicts.push(snapshotJson(verdict) as unknown as CycleCandidateVerdict);
    if (verdict.verdict === "accept") acceptedKeys.push(verdict.key);
    else if (verdict.verdict === "reject") rejectedKeys.push(verdict.key);
    else unknownKeys.push(verdict.key);
  }
  return Object.freeze({
    verdicts: Object.freeze(verdicts),
    acceptedKeys: Object.freeze(acceptedKeys),
    rejectedKeys: Object.freeze(rejectedKeys),
    unknownKeys: Object.freeze(unknownKeys),
  });
}

function reservation(phase: CycleActivityPhase, binding: CycleActivityBinding): CycleActivityReservation {
  let cost = 0;
  for (let attempt = 0; attempt < binding.maxAttemptsPerRound; attempt += 1) {
    cost += binding.maxCostUsdPerAttempt;
    if (!Number.isFinite(cost)) throw new TypeError(`${phase} worst-case cost overflowed`);
  }
  return Object.freeze({
    phase,
    activityId: binding.activityId,
    maxAttempts: binding.maxAttemptsPerRound,
    maxCostUsd: cost,
  });
}

export function createCycleRoundPlan(
  request: CycleControllerRequest,
  remainingDynamicNodes: number,
): { readonly plan: CycleRoundPlan; readonly planHash: string; readonly maximum: CycleBudgetDelta } {
  const finder = reservation("finder", request.activities.finder);
  const candidateEvaluator = reservation("candidate-evaluator", request.activities.candidateEvaluator);
  const modeActivity = request.policy.mode === "while"
    ? reservation("condition", request.activities.condition as CycleActivityBinding)
    : request.policy.mode === "evaluator-optimizer"
      ? reservation("optimizer-evaluator", request.activities.optimizerEvaluator as CycleActivityBinding)
      : null;
  const patchPlanner = request.patches.enabled
    ? reservation("patch-planner", request.activities.patchPlanner as CycleActivityBinding)
    : null;
  const maxDynamicNodes = patchPlanner === null ? 0 : remainingDynamicNodes;
  const plan = Object.freeze({ finder, candidateEvaluator, modeActivity, patchPlanner, maxDynamicNodes });
  const entries = [finder, candidateEvaluator, ...(modeActivity === null ? [] : [modeActivity]), ...(patchPlanner === null ? [] : [patchPlanner])];
  let attempts = 0;
  let costUsd = 0;
  for (const entry of entries) {
    attempts += entry.maxAttempts;
    costUsd += entry.maxCostUsd;
    if (!Number.isSafeInteger(attempts) || !Number.isFinite(costUsd)) throw new TypeError("round plan arithmetic overflowed");
  }
  return Object.freeze({
    plan,
    planHash: hashWithDomain(CYCLE_ROUND_PLAN_DOMAIN, plan),
    maximum: Object.freeze({ attempts, costUsd, dynamicNodes: maxDynamicNodes }),
  });
}

export function cycleActivityKey(fields: {
  readonly controllerRunId: string;
  readonly controllerHash: string;
  readonly iteration: number;
  readonly phase: CycleActivityPhase;
  readonly activityId: string;
  readonly inputHash: string;
}): string {
  return hashWithDomain(CYCLE_ACTIVITY_DOMAIN, fields);
}

export function selectCycleExitReason(observation: CycleExitObservation): CycleExitReason {
  if (observation.cancelled) return "CANCELLED";
  if (observation.maxDuration) return "MAX_DURATION";
  if (observation.maxCost) return "MAX_COST";
  if (observation.maxTotalAttempts) return "MAX_TOTAL_ATTEMPTS";
  if (observation.maxDynamicNodes) return "MAX_DYNAMIC_NODES";
  if (observation.maxDiscoveries) return "MAX_DISCOVERIES";
  if (observation.maxIterations) return "MAX_ITERATIONS";
  if (observation.patchRejected) return "PATCH_REJECTED";
  if (observation.failed) return "FAILED";
  if (observation.unknownVerdict) return "UNKNOWN_VERDICT";
  if (observation.convergenceReason !== null) return observation.convergenceReason;
  throw new TypeError("exit observation has no terminal fact");
}

export function cycleStatus(exitReason: CycleExitReason): CycleResultStatus {
  if (exitReason === "DRY" || exitReason === "CONDITION_FALSE" || exitReason === "EVALUATOR_ACCEPTED") return "converged";
  if (exitReason.startsWith("MAX_")) return "bounded";
  if (exitReason === "UNKNOWN_VERDICT") return "unknown";
  if (exitReason === "CANCELLED") return "cancelled";
  return "failed";
}

export function observeCycleExit(fields: {
  readonly policy: CycleControllerPolicy;
  readonly cancelled: boolean;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly attemptsUsed: number;
  readonly dynamicNodes: number;
  readonly seenCount: number;
  readonly iterations: number;
  readonly patchRejected: boolean;
  readonly failed: boolean;
  readonly failureCode: string | null;
  readonly unknownVerdict: boolean;
  readonly convergenceReason: CycleExitObservation["convergenceReason"];
  readonly discoveryNeeded?: boolean;
}): CycleExitObservation {
  const observation = Object.freeze({
    cancelled: fields.cancelled,
    maxDuration: fields.durationMs >= fields.policy.maxDurationMs,
    maxCost: fields.costUsd > 0 && fields.costUsd >= fields.policy.maxCostUsd,
    maxTotalAttempts: fields.attemptsUsed > 0 && fields.attemptsUsed >= fields.policy.maxTotalAttempts,
    maxDynamicNodes: fields.dynamicNodes > 0 && fields.dynamicNodes >= fields.policy.maxDynamicNodes,
    maxDiscoveries: (fields.discoveryNeeded ?? fields.convergenceReason === null)
      && fields.seenCount >= fields.policy.maxDiscoveries,
    maxIterations: fields.iterations >= fields.policy.maxIterations,
    patchRejected: fields.patchRejected,
    failed: fields.failed,
    failureCode: fields.failed ? fields.failureCode : null,
    unknownVerdict: fields.unknownVerdict,
    convergenceReason: fields.convergenceReason,
  });
  if (observation.failed !== (observation.failureCode !== null)) {
    throw new TypeError("failure observation must own exactly one failure code");
  }
  return observation;
}

export function createCycleControllerEvent(fields: {
  readonly request: CycleControllerRequest;
  readonly controllerHash: string;
  readonly requestHash: string;
  readonly type: CycleControllerEventType;
  readonly data: Readonly<Record<string, unknown>>;
  readonly graphRevision: number;
  readonly sequence: number;
  readonly previousEventHash: string | null;
  readonly lease: CycleLease | null;
  readonly timestamp: string;
  readonly eventId: string;
}): CycleControllerEvent {
  const body = {
    apiVersion: "graphengineering.reacher-z.github.io/cycle-controller-events/v1alpha1" as const,
    contractVersion: "cycle-controller-recovery/v1alpha1" as const,
    eventId: fields.eventId,
    type: fields.type,
    timestamp: fields.timestamp,
    controllerRunId: fields.request.controllerRunId,
    hostRunId: fields.request.hostRun.runId,
    controllerHash: fields.controllerHash,
    requestHash: fields.requestHash,
    graphRevision: fields.graphRevision,
    sequence: fields.sequence,
    expectedPreviousSequence: fields.sequence - 1,
    previousEventHash: fields.previousEventHash,
    lease: fields.lease,
    payloadDisposition: "inline-unredacted" as const,
    redacted: false as const,
    payloadHash: canonicalHash(fields.data),
    data: fields.data,
  };
  return snapshotJson({ ...body, recordHash: hashWithDomain(CYCLE_EVENT_DOMAIN, body) }) as unknown as CycleControllerEvent;
}

export function verifyCycleEventIntegrity(
  event: CycleControllerEvent,
  previous: CycleControllerEvent | undefined,
): void {
  const controllerRunId = event.controllerRunId;
  const { recordHash, ...body } = event;
  if (event.sequence !== (previous?.sequence ?? -1) + 1
      || event.expectedPreviousSequence !== event.sequence - 1
      || event.previousEventHash !== (previous?.recordHash ?? null)
      || canonicalHash(event.data) !== event.payloadHash
      || hashWithDomain(CYCLE_EVENT_DOMAIN, body) !== recordHash
      || event.payloadDisposition !== "inline-unredacted" || event.redacted !== false) {
    return fail("GE_CYCLE_INVALID_HISTORY", controllerRunId, "cycle event integrity or CAS chain is invalid", {
      sequence: event.sequence,
    });
  }
}

export function validateGraphPatchShape(value: unknown, controllerRunId = "unknown"): GraphPatch {
  let captured: ReturnType<typeof captureBoundedJson>;
  try {
    captured = captureBoundedJson(value, MAX_PATCH_BYTES);
  } catch (error) {
    return fail("GE_PATCH_INVALID", controllerRunId, "GraphPatch is not bounded portable JSON", {
      causeName: error instanceof Error ? error.name : typeof error,
    });
  }
  if (!isRecord(captured.value)) return fail("GE_PATCH_INVALID", controllerRunId, "GraphPatch must be an object");
  const patch = captured.value;
  exactKeys(patch, ["apiVersion", "kind", "patchId", "base", "append"], controllerRunId, "GraphPatch", "GE_PATCH_INVALID");
  if (patch.apiVersion !== "graphengineering.reacher-z.github.io/patches/v1alpha1"
      || patch.kind !== "GraphPatch" || typeof patch.patchId !== "string" || !PATCH_IDENTIFIER.test(patch.patchId)) {
    return fail("GE_PATCH_INVALID", controllerRunId, "GraphPatch identity is invalid");
  }
  if (!isRecord(patch.base)) return fail("GE_PATCH_INVALID", controllerRunId, "GraphPatch base is invalid");
  exactKeys(patch.base, ["graphRevision", "graphHash", "revisionHash"], controllerRunId, "GraphPatch base", "GE_PATCH_INVALID");
  if (!numberInRange(patch.base.graphRevision, 1, MAX_SAFE - 1, true)
      || !hash(patch.base.graphHash) || !hash(patch.base.revisionHash)) {
    return fail("GE_PATCH_INVALID", controllerRunId, "GraphPatch base coordinate is invalid");
  }
  if (!isRecord(patch.append)) return fail("GE_PATCH_INVALID", controllerRunId, "GraphPatch append is invalid");
  exactKeys(patch.append, ["nodes", "edges", "outputs"], controllerRunId, "GraphPatch append", "GE_PATCH_INVALID");
  if (!Array.isArray(patch.append.nodes) || patch.append.nodes.length > 10_000
      || !Array.isArray(patch.append.edges) || patch.append.edges.length > 20_000
      || !isRecord(patch.append.outputs) || Object.keys(patch.append.outputs).length > 10_000
      || (patch.append.nodes.length === 0 && patch.append.edges.length === 0 && Object.keys(patch.append.outputs).length === 0)) {
    return fail("GE_PATCH_INVALID", controllerRunId, "GraphPatch append cardinality is invalid");
  }
  for (const [index, node] of patch.append.nodes.entries()) {
    const issues = validateNodeDocument(node, index);
    if (issues.length > 0) {
      return fail("GE_PATCH_INVALID", controllerRunId, "appended node violates the Graph IR schema", {
        index,
        issues,
      });
    }
  }
  for (const [index, edge] of patch.append.edges.entries()) {
    const issues = validateEdgeDocument(edge, index);
    if (issues.length > 0) {
      return fail("GE_PATCH_INVALID", controllerRunId, "appended edge violates the Graph IR schema", {
        index,
        issues,
      });
    }
  }
  for (const [name, endpoint] of Object.entries(patch.append.outputs)) {
    if (name.length === 0 || name.length > 128) {
      return fail("GE_PATCH_INVALID", controllerRunId, "appended output is invalid", { name });
    }
    const issues = validateEndpointDocument(endpoint, `#/append/outputs/${name}`);
    if (issues.length > 0) {
      return fail("GE_PATCH_INVALID", controllerRunId, "appended output endpoint violates the Graph IR schema", {
        name,
        issues,
      });
    }
  }
  return snapshotJson(patch) as unknown as GraphPatch;
}
