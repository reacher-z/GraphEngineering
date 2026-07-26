import { PersistenceValidationError, type ValidationIssue } from "./errors.js";
import { jsonValidationIssues } from "./json.js";
import { isStrictRfc3339 } from "./datetime.js";

export const GRAPH_EVENT_API_VERSION =
  "graphengineering.reacher-z.github.io/events/v1alpha1" as const;

export const GRAPH_EVENT_TYPES = [
  "RunCreated",
  "RunStarted",
  "RunPaused",
  "RunResumed",
  "GraphPatched",
  "NodeScheduled",
  "NodeStarted",
  "NodeAttemptFailed",
  "NodeRetried",
  "NodeSucceeded",
  "EdgeEmitted",
  "BarrierSatisfied",
  "RouteSelected",
  "VerificationRecorded",
  "BudgetUpdated",
  "ArtifactCreated",
  "HumanInputRequested",
  "HumanInputReceived",
  "RunCancelled",
  "RunFailed",
  "RunSucceeded",
] as const;

export type GraphEventType = (typeof GRAPH_EVENT_TYPES)[number];

export interface GraphEvent {
  apiVersion: typeof GRAPH_EVENT_API_VERSION;
  eventId: string;
  type: GraphEventType;
  timestamp: string;
  runId: string;
  graphRevision: number;
  sequence: number;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  nodeId?: string;
  edgeId?: string;
  attempt?: number;
  payloadHash?: string;
  artifactRef?: string;
  redacted?: boolean;
  data: Readonly<Record<string, unknown>>;
}

export type GraphEventValidationResult =
  | { valid: true; event: GraphEvent; issues: readonly [] }
  | { valid: false; issues: readonly ValidationIssue[] };

const EVENT_KEYS = new Set([
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
  "artifactRef",
  "redacted",
  "data",
]);
const EVENT_TYPE_SET = new Set<string>(GRAPH_EVENT_TYPES);
const REQUIRED_KEYS = [
  "apiVersion",
  "eventId",
  "type",
  "timestamp",
  "runId",
  "graphRevision",
  "sequence",
  "data",
] as const;
const OPTIONAL_STRINGS = [
  "traceId",
  "spanId",
  "parentSpanId",
  "nodeId",
  "edgeId",
  "payloadHash",
  "artifactRef",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateGraphEvent(value: unknown): GraphEventValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return { valid: false, issues: [{ path: "#", message: "expected an event object" }] };
  }

  for (const key of Object.keys(value)) {
    if (!EVENT_KEYS.has(key)) issues.push({ path: `#/${key}`, message: "unknown property" });
  }
  for (const key of REQUIRED_KEYS) {
    if (!Object.hasOwn(value, key)) issues.push({ path: `#/${key}`, message: "required property is missing" });
  }
  if (value.apiVersion !== GRAPH_EVENT_API_VERSION) {
    issues.push({ path: "#/apiVersion", message: `expected ${GRAPH_EVENT_API_VERSION}` });
  }
  if (typeof value.eventId !== "string" || value.eventId.length === 0) {
    issues.push({ path: "#/eventId", message: "expected a non-empty string" });
  }
  if (typeof value.type !== "string" || !EVENT_TYPE_SET.has(value.type)) {
    issues.push({ path: "#/type", message: "unknown event type" });
  }
  if (!isStrictRfc3339(value.timestamp)) {
    issues.push({ path: "#/timestamp", message: "expected an RFC 3339 date-time" });
  }
  if (typeof value.runId !== "string" || value.runId.length === 0) {
    issues.push({ path: "#/runId", message: "expected a non-empty string" });
  }
  if (!Number.isSafeInteger(value.graphRevision) || (value.graphRevision as number) < 1) {
    issues.push({ path: "#/graphRevision", message: "expected a safe integer >= 1" });
  }
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 0) {
    issues.push({ path: "#/sequence", message: "expected a safe integer >= 0" });
  }
  for (const key of OPTIONAL_STRINGS) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      issues.push({ path: `#/${key}`, message: "expected a string" });
    }
  }
  if (value.attempt !== undefined && (!Number.isSafeInteger(value.attempt) || (value.attempt as number) < 1)) {
    issues.push({ path: "#/attempt", message: "expected a safe integer >= 1" });
  }
  if (value.redacted !== undefined && typeof value.redacted !== "boolean") {
    issues.push({ path: "#/redacted", message: "expected a boolean" });
  }
  if (!isRecord(value.data)) {
    issues.push({ path: "#/data", message: "expected an object" });
  }
  issues.push(...jsonValidationIssues(value));

  return issues.length === 0
    ? { valid: true, event: value as unknown as GraphEvent, issues: [] }
    : { valid: false, issues };
}

export function assertGraphEvent(value: unknown): asserts value is GraphEvent {
  const result = validateGraphEvent(value);
  if (!result.valid) {
    throw new PersistenceValidationError("Graph event does not match the v1alpha1 envelope", result.issues);
  }
}
