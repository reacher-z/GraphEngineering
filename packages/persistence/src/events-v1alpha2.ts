/**
 * The closed `events/v1alpha2` scheduler envelope of
 * spec/redaction-semantics.md Sections 3.2 and 6.1.
 *
 * Every v1alpha2 event carries both required facts — `redacted: false` and an
 * exact `payloadDisposition` — and neither has a schema default. The envelope is
 * a closed object and `event-v1alpha2.schema.json` pins exactly one disposition
 * per event type, so `inline-unredacted` is not merely denied by the default
 * profile here: it is unrepresentable (Section 4.3).
 *
 * This validator is a native mirror of that schema. It exists because the
 * durable writer must be able to reject a record before it reaches disk without
 * pulling a JSON Schema engine into the persistence dependency graph; the
 * conformance test runs the corpus `wireCases` for `event-v1alpha2.schema.json`
 * through it so the two cannot drift apart silently.
 */

import type { ValidationIssue } from "./errors.js";
import { isStrictRfc3339 } from "./datetime.js";

export const GRAPH_EVENT_V1ALPHA2_API_VERSION =
  "graphengineering.reacher-z.github.io/events/v1alpha2" as const;

export const GRAPH_EVENT_V1ALPHA2_TYPES = [
  "RunCreated",
  "RunStarted",
  "RunResumed",
  "NodeScheduled",
  "NodeStarted",
  "NodeAttemptFailed",
  "NodeSettledWithoutAttempt",
  "NodeRetried",
  "NodeSucceeded",
  "EdgeEmitted",
  "BarrierSatisfied",
  "RunCancelled",
  "RunFailed",
  "RunSucceeded",
] as const;

export type GraphEventV1Alpha2Type = (typeof GRAPH_EVENT_V1ALPHA2_TYPES)[number];

export interface GraphEventV1Alpha2 {
  readonly apiVersion: typeof GRAPH_EVENT_V1ALPHA2_API_VERSION;
  readonly eventId: string;
  readonly type: GraphEventV1Alpha2Type;
  readonly timestamp: string;
  readonly runId: string;
  readonly graphRevision: number;
  readonly sequence: number;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly parentSpanId?: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly attempt?: number;
  readonly payloadHash: string;
  readonly capturePolicyHash: string;
  readonly redacted: false;
  readonly payloadDisposition: "metadata-only" | "protected-ref";
  readonly data: Readonly<Record<string, unknown>>;
}

const ENVELOPE_KEYS = new Set([
  "apiVersion",
  "eventId",
  "type",
  "timestamp",
  "runId",
  "graphRevision",
  "sequence",
  "traceId",
  "spanId",
  "parentSpanId",
  "nodeId",
  "edgeId",
  "attempt",
  "payloadHash",
  "capturePolicyHash",
  "redacted",
  "payloadDisposition",
  "data",
]);

const REQUIRED_KEYS = [
  "apiVersion",
  "eventId",
  "type",
  "timestamp",
  "runId",
  "graphRevision",
  "sequence",
  "payloadHash",
  "capturePolicyHash",
  "redacted",
  "payloadDisposition",
  "data",
] as const;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

type IdentityShape = "none" | "node-attempt" | "node-only" | "edge-attempt";

interface DataShape {
  readonly required: readonly string[];
  readonly optional?: readonly string[];
}

interface EventTypeRule {
  readonly disposition: "metadata-only" | "protected-ref";
  readonly identity: IdentityShape;
  readonly data: DataShape;
}

/**
 * Section 6.1 field mapping. Every inline metadata field is defined by the
 * event-type schema; arbitrary diagnostic properties are invalid, and the legacy
 * aliases `inputHash`, `outputHash`, and an unkeyed logical `resultHash` are
 * forbidden in a protected v1alpha2 payload.
 */
const EVENT_TYPE_RULES: Readonly<Record<GraphEventV1Alpha2Type, readonly EventTypeRule[]>> =
  Object.freeze({
    RunCreated: [
      {
        disposition: "protected-ref",
        identity: "none",
        data: {
          required: [
            "contractVersion",
            "graphHash",
            "implementationHash",
            "inputRef",
            "inputMac",
            "capturePolicyHash",
            "protectedStoreContract",
            "keyRefHash",
            "maxTotalAttempts",
          ],
        },
      },
    ],
    RunStarted: [{ disposition: "metadata-only", identity: "none", data: { required: [] } }],
    RunResumed: [
      {
        disposition: "metadata-only",
        identity: "none",
        data: { required: ["reusedNodeIds", "interruptedNodeIds"] },
      },
    ],
    NodeScheduled: [
      {
        disposition: "protected-ref",
        identity: "node-attempt",
        data: { required: ["inputRef", "inputMac", "activityKey", "sideEffects"] },
      },
    ],
    NodeStarted: [
      {
        disposition: "metadata-only",
        identity: "node-attempt",
        data: { required: ["inputMac", "activityKey"] },
      },
    ],
    NodeAttemptFailed: [
      {
        disposition: "metadata-only",
        identity: "node-attempt",
        data: { required: ["terminal", "failure"] },
      },
      {
        disposition: "protected-ref",
        identity: "node-attempt",
        data: { required: ["terminal", "failure", "evidenceRef", "evidenceMac"] },
      },
    ],
    NodeSettledWithoutAttempt: [
      {
        disposition: "protected-ref",
        identity: "node-only",
        data: {
          required: ["resultRef", "resultMac", "status", "attempts", "failureCode"],
        },
      },
    ],
    NodeRetried: [
      {
        disposition: "metadata-only",
        identity: "node-attempt",
        data: { required: ["availableAt", "activityKey"] },
      },
    ],
    NodeSucceeded: [
      {
        disposition: "protected-ref",
        identity: "node-attempt",
        data: { required: ["inputMac", "outputRef", "outputMac"] },
      },
    ],
    EdgeEmitted: [
      {
        disposition: "metadata-only",
        identity: "edge-attempt",
        data: { required: ["outputMac"] },
      },
    ],
    BarrierSatisfied: [
      {
        // The decision document is authoritative content (the barrier's bound
        // output when satisfied), so it travels as a protected reference exactly
        // like a NodeSucceeded output. The closed inline projection carries the
        // two domain-separated identities and the two decision enums only.
        disposition: "protected-ref",
        identity: "node-only",
        data: {
          required: [
            "decisionRef",
            "decisionMac",
            "policyHash",
            "decisionId",
            "satisfied",
            "resolution",
          ],
        },
      },
    ],
    RunCancelled: [
      {
        disposition: "protected-ref",
        identity: "none",
        data: { required: ["resultRef", "resultMac", "status"] },
      },
    ],
    RunFailed: [
      {
        disposition: "protected-ref",
        identity: "none",
        data: { required: ["resultRef", "resultMac", "status"] },
      },
    ],
    RunSucceeded: [
      {
        disposition: "protected-ref",
        identity: "none",
        data: { required: ["resultRef", "resultMac", "status"] },
      },
    ],
  });

/**
 * `event-v1alpha2.schema.json` `$defs.attemptFailure`: a closed object whose
 * `messageTemplate` and `causeCode` are closed enums. It carries no `nodeId`,
 * `attempt`, `message` or `causeName`: the first two are envelope members and
 * the last two are producer-derived text that belongs in the protected evidence.
 */
const ATTEMPT_FAILURE_REQUIRED = ["phase", "code", "messageTemplate", "retryable"] as const;
const ATTEMPT_FAILURE_OPTIONAL = ["causeCode"] as const;
const ATTEMPT_FAILURE_CODES: ReadonlySet<string> = new Set([
  "NODE_EXECUTION_FAILED",
  "NODE_TIMEOUT",
  "NODE_CANCELLED",
  "INVALID_OUTPUT",
  "NODE_EXECUTION_INTERRUPTED",
  "INVALID_ROUTE_SELECTION",
]);
const ATTEMPT_FAILURE_TEMPLATES: ReadonlySet<string> = new Set([
  "node-execution-failed/v1",
  "node-timeout/v1",
  "node-cancelled/v1",
  "invalid-output/v1",
  "process-interrupted/v1",
  "invalid-route-selection/v1",
]);
const ATTEMPT_FAILURE_CAUSE_CODES: ReadonlySet<string> = new Set([
  "EXECUTOR_REJECTED",
  "TIMEOUT",
  "CANCELLED",
  "VALIDATION",
  "PROCESS_LOST",
  "ROUTER_CONTRACT",
]);

/**
 * `$defs.barrierDecisionResolution`: the closed four-member resolution set of
 * spec/barrier-decision.schema.json `#/properties/resolution`, mirrored inline
 * exactly as the schema mirrors it.
 */
const BARRIER_DECISION_RESOLUTIONS: ReadonlySet<string> = new Set([
  "satisfied",
  "failed",
  "unknown",
  "awaiting_human",
]);

/** `$defs.settledFailureCode`. There is deliberately no sentinel member. */
const SETTLED_FAILURE_CODES: ReadonlySet<string> = new Set([
  "EXECUTOR_NOT_FOUND",
  "UPSTREAM_FAILED",
  "INPUT_BINDING_FAILED",
  "ATTEMPT_BUDGET_EXHAUSTED",
  "NODE_CANCELLED",
  "ROUTE_NOT_SELECTED",
  "UNSUPPORTED_EDGE_CONDITION",
  "UPSTREAM_UNKNOWN",
]);

/**
 * Validate one `data.failure` against the frozen `$defs.attemptFailure`.
 *
 * This is the check whose absence let a non-conforming `NodeAttemptFailed` reach
 * disk: the envelope was validated, the `data` member names were counted, and
 * the object inside `failure` was never looked at.
 */
function attemptFailureIssues(value: unknown): readonly ValidationIssue[] {
  if (!isRecord(value)) {
    return [{ path: "#/data/failure", message: "expected an object" }];
  }
  const issues: ValidationIssue[] = [];
  const allowed = new Set<string>([...ATTEMPT_FAILURE_REQUIRED, ...ATTEMPT_FAILURE_OPTIONAL]);
  for (const key of Object.keys(value)) {
    // `nodeId`, `attempt`, `message` and `causeName` land here.
    if (!allowed.has(key)) {
      issues.push({ path: `#/data/failure/${key}`, message: "unknown property" });
    }
  }
  for (const key of ATTEMPT_FAILURE_REQUIRED) {
    if (!Object.hasOwn(value, key)) {
      issues.push({ path: `#/data/failure/${key}`, message: "required property is missing" });
    }
  }
  if (Object.hasOwn(value, "phase") && value["phase"] !== "execute") {
    issues.push({ path: "#/data/failure/phase", message: "expected execute" });
  }
  if (Object.hasOwn(value, "code") && !ATTEMPT_FAILURE_CODES.has(value["code"] as string)) {
    issues.push({ path: "#/data/failure/code", message: "not an attempt failure code" });
  }
  if (
    Object.hasOwn(value, "messageTemplate") &&
    !ATTEMPT_FAILURE_TEMPLATES.has(value["messageTemplate"] as string)
  ) {
    issues.push({ path: "#/data/failure/messageTemplate", message: "unknown message template" });
  }
  if (Object.hasOwn(value, "retryable") && typeof value["retryable"] !== "boolean") {
    issues.push({ path: "#/data/failure/retryable", message: "expected a boolean" });
  }
  if (
    Object.hasOwn(value, "causeCode") &&
    !ATTEMPT_FAILURE_CAUSE_CODES.has(value["causeCode"] as string)
  ) {
    issues.push({ path: "#/data/failure/causeCode", message: "unknown cause code" });
  }
  return issues;
}

const TERMINAL_STATUS: Readonly<Record<string, string>> = Object.freeze({
  RunCancelled: "cancelled",
  RunFailed: "failed",
  RunSucceeded: "succeeded",
});

export type GraphEventV1Alpha2ValidationResult =
  | { readonly valid: true; readonly event: GraphEventV1Alpha2; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly ValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identityIssues(
  value: Record<string, unknown>,
  identity: IdentityShape,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const has = (key: string): boolean => value[key] !== undefined;
  const forbid = (key: string): void => {
    if (has(key)) issues.push({ path: `#/${key}`, message: "forbidden for this event type" });
  };
  const require = (key: string): void => {
    if (!has(key)) issues.push({ path: `#/${key}`, message: "required for this event type" });
  };
  if (identity === "none") {
    forbid("nodeId");
    forbid("edgeId");
    forbid("attempt");
  } else if (identity === "node-attempt") {
    require("nodeId");
    require("attempt");
    forbid("edgeId");
  } else if (identity === "node-only") {
    require("nodeId");
    forbid("edgeId");
    forbid("attempt");
  } else {
    require("nodeId");
    require("edgeId");
    require("attempt");
  }
  return issues;
}

function dataIssues(
  data: Record<string, unknown>,
  shape: DataShape,
  type: GraphEventV1Alpha2Type,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allowed = new Set<string>([...shape.required, ...(shape.optional ?? [])]);
  for (const key of Object.keys(data)) {
    if (!allowed.has(key)) issues.push({ path: `#/data/${key}`, message: "unknown property" });
  }
  for (const key of shape.required) {
    if (!Object.hasOwn(data, key)) {
      issues.push({ path: `#/data/${key}`, message: "required property is missing" });
    }
  }
  const status = TERMINAL_STATUS[type];
  if (status !== undefined && Object.hasOwn(data, "status") && data["status"] !== status) {
    issues.push({ path: "#/data/status", message: `expected ${status}` });
  }
  if (type === "RunCreated") {
    if (data["contractVersion"] !== "scheduler-recovery/v1alpha2") {
      issues.push({ path: "#/data/contractVersion", message: "expected scheduler-recovery/v1alpha2" });
    }
    if (data["protectedStoreContract"] !== "protected-payload-store/v1alpha1") {
      issues.push({
        path: "#/data/protectedStoreContract",
        message: "expected protected-payload-store/v1alpha1",
      });
    }
  }
  if (type === "NodeAttemptFailed") {
    issues.push(...attemptFailureIssues(data["failure"]));
  }
  if (
    type === "NodeSettledWithoutAttempt" &&
    Object.hasOwn(data, "failureCode") &&
    !SETTLED_FAILURE_CODES.has(data["failureCode"] as string)
  ) {
    issues.push({ path: "#/data/failureCode", message: "not a settled failure code" });
  }
  if (type === "BarrierSatisfied") {
    for (const key of ["decisionMac", "policyHash", "decisionId"] as const) {
      if (Object.hasOwn(data, key) && (typeof data[key] !== "string" || !SHA256.test(data[key] as string))) {
        issues.push({
          path: `#/data/${key}`,
          message: "expected 64 lowercase hexadecimal characters",
        });
      }
    }
    if (Object.hasOwn(data, "satisfied") && typeof data["satisfied"] !== "boolean") {
      issues.push({ path: "#/data/satisfied", message: "expected a boolean" });
    }
    if (
      Object.hasOwn(data, "resolution") &&
      !BARRIER_DECISION_RESOLUTIONS.has(data["resolution"] as string)
    ) {
      issues.push({ path: "#/data/resolution", message: "unknown barrier resolution" });
    }
  }
  if (type === "NodeScheduled") {
    const sideEffects = data["sideEffects"];
    // Section 6.1: omission normalizes exactly once to `unspecified`; an unknown
    // string fails before an event, protected-store write, or executor call.
    if (
      sideEffects !== "none" &&
      sideEffects !== "idempotent" &&
      sideEffects !== "non-idempotent" &&
      sideEffects !== "unspecified"
    ) {
      issues.push({ path: "#/data/sideEffects", message: "unknown side-effect classification" });
    }
  }
  return issues;
}

const PROTECTED_VALUE_API = "graphengineering.reacher-z.github.io/protected-value/v1alpha1";

/** Section 6.1: every adjacent `*Mac` MUST equal the referenced object's `valueMac`. */
function adjacentMacIssues(data: Record<string, unknown>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (!key.endsWith("Ref") || !isRecord(value)) continue;
    if (value["apiVersion"] !== PROTECTED_VALUE_API) continue;
    const macKey = `${key.slice(0, -3)}Mac`;
    if (!Object.hasOwn(data, macKey)) continue;
    if (data[macKey] !== value["valueMac"]) {
      issues.push({ path: `#/data/${macKey}`, message: `does not equal ${key}.valueMac` });
    }
  }
  return issues;
}

/** Validate one candidate against the closed v1alpha2 envelope. */
export function validateGraphEventV1Alpha2(value: unknown): GraphEventV1Alpha2ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { valid: false, issues: [{ path: "#", message: "expected an event object" }] };
  }
  for (const key of Object.keys(value)) {
    if (!ENVELOPE_KEYS.has(key)) issues.push({ path: `#/${key}`, message: "unknown property" });
  }
  for (const key of REQUIRED_KEYS) {
    if (!Object.hasOwn(value, key)) {
      issues.push({ path: `#/${key}`, message: "required property is missing" });
    }
  }
  if (value["apiVersion"] !== GRAPH_EVENT_V1ALPHA2_API_VERSION) {
    issues.push({ path: "#/apiVersion", message: `expected ${GRAPH_EVENT_V1ALPHA2_API_VERSION}` });
  }
  for (const key of ["eventId", "runId"] as const) {
    if (typeof value[key] !== "string" || !IDENTIFIER.test(value[key] as string)) {
      issues.push({ path: `#/${key}`, message: "expected a safe identifier" });
    }
  }
  for (const key of ["nodeId", "edgeId"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !IDENTIFIER.test(value[key] as string))) {
      issues.push({ path: `#/${key}`, message: "expected a safe identifier" });
    }
  }
  if (!isStrictRfc3339(value["timestamp"])) {
    issues.push({ path: "#/timestamp", message: "expected an RFC 3339 date-time" });
  }
  if (!Number.isSafeInteger(value["graphRevision"]) || (value["graphRevision"] as number) < 1) {
    issues.push({ path: "#/graphRevision", message: "expected a safe integer >= 1" });
  }
  if (!Number.isSafeInteger(value["sequence"]) || (value["sequence"] as number) < 0) {
    issues.push({ path: "#/sequence", message: "expected a safe integer >= 0" });
  }
  if (value["attempt"] !== undefined && (!Number.isSafeInteger(value["attempt"]) || (value["attempt"] as number) < 1)) {
    issues.push({ path: "#/attempt", message: "expected a safe integer >= 1" });
  }
  for (const key of ["payloadHash", "capturePolicyHash"] as const) {
    if (typeof value[key] !== "string" || !SHA256.test(value[key] as string)) {
      issues.push({ path: `#/${key}`, message: "expected 64 lowercase hexadecimal characters" });
    }
  }
  // Section 6.1: trace and span identities are lowercase fixed-width non-zero
  // hexadecimal, and a parent span requires a valid surrounding relation.
  if (value["traceId"] !== undefined) {
    const traceId = value["traceId"];
    if (typeof traceId !== "string" || !TRACE_ID.test(traceId) || /^0+$/.test(traceId)) {
      issues.push({ path: "#/traceId", message: "expected a non-zero 32-character trace identity" });
    }
  }
  for (const key of ["spanId", "parentSpanId"] as const) {
    if (value[key] === undefined) continue;
    const span = value[key];
    if (typeof span !== "string" || !SPAN_ID.test(span) || /^0+$/.test(span)) {
      issues.push({ path: `#/${key}`, message: "expected a non-zero 16-character span identity" });
    }
  }
  if (value["parentSpanId"] !== undefined && (value["traceId"] === undefined || value["spanId"] === undefined)) {
    issues.push({ path: "#/parentSpanId", message: "requires a surrounding trace and span" });
  }
  // Section 3.2: both facts are required and neither has a default.
  if (value["redacted"] !== false) {
    issues.push({ path: "#/redacted", message: "v1alpha2 events are always redacted:false" });
  }
  const disposition = value["payloadDisposition"];
  if (disposition !== "metadata-only" && disposition !== "protected-ref") {
    issues.push({
      path: "#/payloadDisposition",
      message: "expected metadata-only or protected-ref",
    });
  }
  if (Object.hasOwn(value, "redactionReceipt")) {
    issues.push({ path: "#/redactionReceipt", message: "forbidden on this disposition" });
  }
  if (!isRecord(value["data"])) issues.push({ path: "#/data", message: "expected an object" });

  const type = value["type"];
  const rules =
    typeof type === "string"
      ? EVENT_TYPE_RULES[type as GraphEventV1Alpha2Type]
      : undefined;
  if (rules === undefined) {
    issues.push({ path: "#/type", message: "unknown event type" });
    return { valid: false, issues };
  }
  if (issues.length > 0) return { valid: false, issues };

  const data = value["data"] as Record<string, unknown>;
  const matching = rules.filter((rule) => rule.disposition === disposition);
  if (matching.length === 0) {
    return {
      valid: false,
      issues: [
        {
          path: "#/payloadDisposition",
          message: `disposition '${String(disposition)}' is not pinned for ${type}`,
        },
      ],
    };
  }
  let best: readonly ValidationIssue[] | undefined;
  for (const rule of matching) {
    const candidate = [
      ...identityIssues(value, rule.identity),
      ...dataIssues(data, rule.data, type as GraphEventV1Alpha2Type),
      ...adjacentMacIssues(data),
    ];
    if (candidate.length === 0) {
      return { valid: true, event: value as unknown as GraphEventV1Alpha2, issues: [] };
    }
    if (best === undefined || candidate.length < best.length) best = candidate;
  }
  return { valid: false, issues: best ?? [{ path: "#", message: "event does not match any variant" }] };
}
