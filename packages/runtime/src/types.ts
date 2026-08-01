import type {
  CompilerDiagnostic,
  GraphSpec,
  NodeKind,
  NodeSpec,
} from "@graph-engineering/core";

/**
 * `unknown`, `awaiting_human` and `cancelled` are integrated-barrier terminals.
 * None of them is a success and none of them binds an output.
 */
export type NodeRunStatus =
  | "succeeded"
  | "failed"
  | "skipped"
  | "unknown"
  | "awaiting_human"
  | "cancelled";

/** Run terminal precedence, highest first, is the declaration order below. */
export type GraphRunStatus =
  | "failed"
  | "cancelled"
  | "awaiting_human"
  | "unknown"
  | "succeeded";

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
  | "INVALID_ROUTE_SELECTION"
  | "UNSUPPORTED_RUNTIME_CAPABILITY"
  | "UNSUPPORTED_EDGE_CONDITION"
  | "ROUTE_NOT_SELECTED"
  | "UPSTREAM_FAILED"
  | "INPUT_BINDING_FAILED"
  | "ATTEMPT_BUDGET_EXHAUSTED"
  | "NODE_EXECUTION_INTERRUPTED"
  | "INVALID_BARRIER_VOTE"
  | "BARRIER_NOT_SATISFIED"
  | "BARRIER_LATE_ARRIVAL"
  | "UPSTREAM_UNKNOWN"
  | "DECISION_POLICY_DRIFT"
  | "DECISION_IDENTITY_MISMATCH"
  | "DUPLICATE_DECISION";

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

/**
 * A durable decision event this run committed. `BarrierSatisfied` is emitted for
 * every committed barrier decision, satisfied or not; `satisfied` inside `data`
 * carries the truth. `HumanInputRequested` carries the same decision document.
 */
export interface DecisionEvent {
  readonly type: "BarrierSatisfied" | "RouteSelected" | "HumanInputRequested";
  readonly nodeId: string;
  readonly data: JsonValue;
}

export interface GraphRunResult {
  status: GraphRunStatus;
  graphHash: string | null;
  output?: Readonly<Record<string, JsonValue>>;
  nodes: readonly NodeRunResult[];
  failures: readonly GraphRunFailure[];
  maxObservedConcurrency: number;
  totalAttempts: number;
  /** Present only when this run committed at least one durable decision. */
  decisionEvents?: readonly DecisionEvent[];
}

export interface NodeExecutionContext {
  graph: GraphSpec;
  node: NodeSpec;
  input: JsonValue;
  attempt: number;
  signal: AbortSignal;
}

export type NodeExecutor = (context: NodeExecutionContext) => unknown | Promise<unknown>;

/**
 * Injected monotonic millisecond clock. Barriers never read a wall clock and
 * never schedule a timer: conformance drives this with a scripted tick list, so
 * the same list produces the same decisions in every language.
 */
export interface MonotonicClock {
  nowMs(): number;
  /**
   * The promise that resolves once the driver has advanced `nowMs`, or
   * `undefined` when the driver will never advance it again.
   */
  nextTick?(): Promise<void> | undefined;
}

/** Run and graph revision that a durable decision identity binds. */
export interface DecisionContext {
  readonly runId: string;
  readonly graphRevision: number;
}

/** A `BarrierSatisfied` or `RouteSelected` event folded from durable history. */
export interface CommittedDecisionEvent {
  readonly type: "BarrierSatisfied" | "RouteSelected";
  readonly nodeId: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface SchedulerOptions {
  /** Per-node executors take precedence over kind executors. */
  nodeExecutors?: Readonly<Record<string, NodeExecutor>>;
  executors?: Readonly<Partial<Record<NodeKind, NodeExecutor>>>;
  /** Cannot exceed graph.policies.maxConcurrency when that policy is present. */
  concurrency?: number;
  signal?: AbortSignal;
  /** Defaults to a clock frozen at zero, which no deadline can ever elapse. */
  clock?: MonotonicClock;
  /** Identity every decision this run commits binds. */
  decision?: DecisionContext;
  /**
   * Durable history folded before scheduling. A node with a committed decision
   * is never re-evaluated and its executor is never called.
   */
  committedDecisions?: readonly CommittedDecisionEvent[];
}

export type PipelineFailureCode =
  | "INVALID_INPUT"
  | "STAGE_EXECUTION_FAILED"
  | "STAGE_TIMEOUT"
  | "INVALID_OUTPUT"
  | "ITEM_CANCELLED";

export type PipelineItemStatus = "succeeded" | "failed" | "dropped" | "cancelled";
export type PipelineRunStatus = "succeeded" | "failed" | "cancelled";
export type PipelineOrdering = "input" | "completion";
export type PipelineFailurePolicy = "stop" | "drop" | "dead-letter";

export interface PipelineItemFailure {
  code: PipelineFailureCode;
  message: string;
  itemIndex: number;
  stageId?: string;
  stageIndex?: number;
  attempt: number;
  retryable: false;
  causeName?: string;
}

export interface PipelineItemResult {
  itemIndex: number;
  status: PipelineItemStatus;
  inputBound: boolean;
  input?: JsonValue;
  output?: JsonValue;
  completedStages: number;
  totalAttempts: number;
  failure?: PipelineItemFailure;
}

export interface PipelineRunFailure {
  code: "SOURCE_FAILED" | "ITEM_LIMIT_REACHED";
  message: string;
  causeName?: string;
}

export interface PipelineSummary {
  status: PipelineRunStatus;
  accepted: number;
  emitted: number;
  succeeded: number;
  failed: number;
  dropped: number;
  cancelled: number;
  maxObservedInFlight: number;
  stageMaxObservedConcurrency: Readonly<Record<string, number>>;
  stageMaxObservedQueueDepth: Readonly<Record<string, number>>;
  runFailure?: PipelineRunFailure;
}

export interface PipelineHandlerContext {
  readonly input: JsonValue;
  readonly itemIndex: number;
  readonly stageId: string;
  readonly stageIndex: number;
  readonly attempt: number;
  readonly signal: AbortSignal;
}

export type PipelineHandler = (
  context: PipelineHandlerContext,
) => unknown | Promise<unknown>;

export interface PipelineRetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  maxDelayMs?: number;
}

export interface PipelineStage {
  id: string;
  handler: PipelineHandler;
  concurrency?: number;
  timeoutMs?: number;
  retry?: PipelineRetryOptions;
  onFailure?: PipelineFailurePolicy;
}

export interface PipelineOptions {
  bufferCapacity?: number;
  maxInFlight?: number;
  maxItems?: number;
  maxStages?: number;
  ordering?: PipelineOrdering;
  cancellationSignal?: AbortSignal;
}

export type PipelineSource = Iterable<unknown> | AsyncIterable<unknown>;

export interface PipelineRun extends AsyncIterableIterator<PipelineItemResult> {
  readonly completion: Promise<PipelineSummary>;
  close(reason?: unknown): Promise<PipelineSummary>;
}
