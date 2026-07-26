import type { GraphSpec, NodeKind, NodeSpec } from "@graph-engineering/core";
import type { EventStore } from "@graph-engineering/persistence";
import type { GraphRunResult, JsonValue } from "./types.js";

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
  | "DURABILITY_STORE_FAILED";

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
  eventStore: EventStore;
  nodeExecutors?: Readonly<Record<string, DurableNodeExecutor>>;
  executors?: Readonly<Partial<Record<NodeKind, DurableNodeExecutor>>>;
  concurrency?: number;
  signal?: AbortSignal;
  now?: () => Date;
  createEventId?: (context: DurableEventIdContext) => string;
}

export type DurableGraphRunResult = GraphRunResult;
