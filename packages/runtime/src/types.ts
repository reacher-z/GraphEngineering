import type {
  CompilerDiagnostic,
  GraphSpec,
  NodeKind,
  NodeSpec,
} from "@graph-engineering/core";

export type NodeRunStatus = "succeeded" | "failed" | "skipped";
export type GraphRunStatus = "succeeded" | "failed" | "cancelled";

/**
 * Deeply read-only, detached, acyclic JSON with finite numbers and integers in
 * the interoperable IEEE-754 safe range.
 */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface JsonArray extends ReadonlyArray<JsonValue> {}

export type JsonValue =
  | null
  | string
  | boolean
  | number
  | JsonArray
  | JsonObject;

export type RuntimeFailureCode =
  | "EXECUTOR_NOT_FOUND"
  | "NODE_EXECUTION_FAILED"
  | "NODE_TIMEOUT"
  | "NODE_CANCELLED"
  | "INVALID_OUTPUT"
  | "UPSTREAM_FAILED"
  | "INPUT_BINDING_FAILED"
  | "ATTEMPT_BUDGET_EXHAUSTED"
  | "NODE_EXECUTION_INTERRUPTED";

export interface CompilationRunFailure {
  phase: "compile";
  code: CompilerDiagnostic["code"];
  message: string;
  diagnostic: CompilerDiagnostic;
}

export interface NodeRunFailure {
  phase: "execute";
  code: RuntimeFailureCode;
  message: string;
  nodeId: string;
  attempt: number;
  retryable: boolean;
  causeName?: string;
  upstreamNodeIds?: readonly string[];
}

export interface OutputRunFailure {
  phase: "output";
  code: "OUTPUT_BINDING_FAILED";
  message: string;
  outputName: string;
  nodeId: string;
  port?: string;
}

export type GraphRunFailure = CompilationRunFailure | NodeRunFailure | OutputRunFailure;

export interface NodeRunResult {
  nodeId: string;
  sequence: number;
  status: NodeRunStatus;
  attempts: number;
  /** Detached finite-JSON input supplied to this node, when it reached binding. */
  input?: JsonValue;
  /** Present only for success; invalid executor values become INVALID_OUTPUT. */
  output?: JsonValue;
  failure?: NodeRunFailure;
}

export interface GraphRunResult {
  status: GraphRunStatus;
  graphHash: string | null;
  output?: Readonly<Record<string, JsonValue>>;
  nodes: readonly NodeRunResult[];
  failures: readonly GraphRunFailure[];
  maxObservedConcurrency: number;
  totalAttempts: number;
}

export interface NodeExecutionContext {
  graph: GraphSpec;
  node: NodeSpec;
  input: JsonValue;
  attempt: number;
  signal: AbortSignal;
}

export type NodeExecutor = (context: NodeExecutionContext) => unknown | Promise<unknown>;

export interface SchedulerOptions {
  /** Per-node executors take precedence over kind executors. */
  nodeExecutors?: Readonly<Record<string, NodeExecutor>>;
  executors?: Readonly<Partial<Record<NodeKind, NodeExecutor>>>;
  /** Cannot exceed graph.policies.maxConcurrency when that policy is present. */
  concurrency?: number;
  signal?: AbortSignal;
}
