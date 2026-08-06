import type { GraphSpec, NodeKind, NodeSpec } from "@graph-engineering/core";
import type { EventStore } from "@graph-engineering/persistence";
import type { DurablePayloadProtection } from "./durable-protection.js";
import type { GraphRunResult, JsonValue, MonotonicClock } from "./types.js";

export type DurableRunErrorCode =
  | "RUN_NOT_FOUND"
  | "RUN_ALREADY_EXISTS"
  | "GRAPH_HASH_MISMATCH"
  | "INPUT_HASH_MISMATCH"
  | "IMPLEMENTATION_MISMATCH"
  | "INVALID_RUN_HISTORY"
  | "NODE_EXECUTION_INTERRUPTED"
  | "IN_DOUBT_SIDE_EFFECT"
  | "RESUME_CONFLICT"
  | "DURABILITY_STORE_FAILED"
  /**
   * A run outcome the frozen `events/v1alpha2` envelope cannot truthfully
   * represent (an `unknown` run terminal, a node terminal outside
   * succeeded/failed/skipped, a cancelled armed barrier, a malformed barrier
   * vote). The journal fails closed instead of writing a record whose closed
   * enums would misstate the outcome; the stream is left non-terminal and every
   * event already appended remains true.
   */
  | "UNREPRESENTABLE_DURABLE_OUTCOME"
  // spec/redaction-semantics.md Section 10 portable failure codes.
  | "PAYLOAD_PROTECTION_REQUIRED"
  | "PAYLOAD_PROTECTION_FAILED"
  | "CAPTURE_POLICY_MISMATCH"
  | "INLINE_CAPTURE_NOT_AUTHORIZED"
  | "LEGACY_REDACTION_MISMATCH"
  | "PROTECTED_PAYLOAD_NOT_FOUND"
  | "PROTECTED_PAYLOAD_UNAUTHORIZED"
  | "PROTECTED_PAYLOAD_CORRUPT"
  | "SECRET_CANARY_DETECTED";

export interface SerializedDurableRunError {
  name: "DurableRunError";
  code: DurableRunErrorCode;
  runId: string;
  message: string;
  details: Readonly<Record<string, unknown>>;
}

export class DurableRunError extends Error {
  readonly code: DurableRunErrorCode;
  readonly runId: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DurableRunErrorCode,
    runId: string,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "DurableRunError";
    this.code = code;
    this.runId = runId;
    this.details = details;
  }

  toJSON(): SerializedDurableRunError {
    return { name: "DurableRunError", code: this.code, runId: this.runId, message: this.message, details: this.details };
  }
}

export interface DurableNodeExecutionContext {
  graph: GraphSpec;
  node: NodeSpec;
  input: JsonValue;
  attempt: number;
  signal: AbortSignal;
  runId: string;
  attemptId: string;
  /** Stable across attempts for the same logical node activity. */
  activityKey: string;
  /** Alias intended for external idempotency APIs. */
  idempotencyKey: string;
}

export type DurableNodeExecutor = (
  context: DurableNodeExecutionContext,
) => unknown | Promise<unknown>;

export interface DurableEventIdContext {
  runId: string;
  sequence: number;
  type: string;
}

export interface DurableSchedulerOptions {
  runId: string;
  implementationId: string;
  /**
   * The guarded `events/v1alpha2` write path. Section 4.2 of
   * spec/redaction-semantics.md makes this mandatory: a durable run with no
   * configured protected store and key provider fails closed with
   * `PAYLOAD_PROTECTION_REQUIRED` before any write or executor call. There is
   * deliberately no fallback to the legacy inline writer.
   */
  protection: DurablePayloadProtection;
  /**
   * An existing `scheduler-recovery/v1alpha1` journal, read-only. It is used
   * only for Section 9 legacy detection; nothing is ever appended to it, and a
   * legacy history is never silently repaired or migrated.
   */
  legacyEventStore?: EventStore;
  nodeExecutors?: Readonly<Record<string, DurableNodeExecutor>>;
  executors?: Readonly<Partial<Record<NodeKind, DurableNodeExecutor>>>;
  concurrency?: number;
  signal?: AbortSignal;
  now?: () => Date;
  createEventId?: (context: DurableEventIdContext) => string;
  /**
   * Injected monotonic barrier clock, forwarded to the scheduler. Defaults to
   * the frozen clock, under which no barrier deadline can ever elapse.
   */
  clock?: MonotonicClock;
}

export type DurableGraphRunResult = GraphRunResult;
