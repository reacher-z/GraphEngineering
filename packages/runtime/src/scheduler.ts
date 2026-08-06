import {
  canonicalSerialize,
  compileGraph,
  compareUnicodeCodePoints,
  type BarrierArrival,
  type EdgeSpec,
  type Endpoint,
  type GraphSpec,
  type NodeSpec,
} from "@graph-engineering/core";
import type {
  DecisionContext,
  DecisionEvent,
  GraphRunFailure,
  GraphRunResult,
  JsonValue,
  MonotonicClock,
  NodeExecutionContext,
  NodeExecutor,
  NodeRunFailure,
  NodeRunResult,
  RuntimeFailureCode,
  SchedulerOptions,
} from "./types.js";
import { snapshotJson } from "./json.js";
import {
  BARRIER_RESOLUTION_STATUS,
  FROZEN_CLOCK,
  bindIntegratedBarriers,
  commitBarrierDecision,
  resolveArrival,
  type BarrierBinding,
} from "./barrier-runtime.js";
import {
  adoptCommittedDecisions,
  adoptedRouteSelection,
  decisionRejectionMessage,
} from "./decision-replay.js";
import {
  graphRuntimeCapabilityIssues,
  runtimeCapabilityMessage,
} from "./runtime-capabilities.js";
import {
  assertExactRouteSelection,
  edgeConditionError,
  edgeIsActive,
  graphConditionCapabilityIssues,
  InvalidRouteSelectionError,
  routeSelectionExecutor,
} from "./router-runtime.js";

const identityExecutor: NodeExecutor = ({ input }) => input;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_DECISION_CONTEXT: DecisionContext = Object.freeze({
  runId: "",
  graphRevision: 1,
});

/** Barrier state between arming and the single decision it may ever commit. */
interface BarrierState {
  armedAtMs?: number;
  decided: boolean;
  /** Sources still unsettled when the decision committed; every one is late. */
  lateSources: Set<string>;
}

/**
 * An upstream that settled `unknown`, or that inherited the zero-attempt
 * `UPSTREAM_UNKNOWN` terminal from one. Neither is a failure: a run does not
 * fail solely because a barrier resolved to unknown.
 */
function isUnknownTerminal(result: NodeRunResult | undefined): boolean {
  return result?.status === "unknown" ||
    (result?.status === "skipped" && result.failure?.code === "UPSTREAM_UNKNOWN");
}

export interface SchedulerAttemptIdentity {
  runId: string;
  attemptId: string;
  activityKey: string;
}

export interface SchedulerBeforeAttempt {
  graph: GraphSpec;
  node: NodeSpec;
  input: JsonValue;
  attempt: number;
  signal: AbortSignal;
}

export interface SchedulerAttemptFailed {
  graph: GraphSpec;
  node: NodeSpec;
  input: JsonValue;
  failure: NodeRunFailure;
  identity: SchedulerAttemptIdentity;
  willRetry: boolean;
  retryDelayMs: number;
}

export interface SchedulerNodeSucceeded {
  graph: GraphSpec;
  node: NodeSpec;
  input: JsonValue;
  attempt: number;
  output: JsonValue;
  identity: SchedulerAttemptIdentity;
  outgoingEdges: readonly EdgeSpec[];
}

export interface SchedulerNodeSettledWithoutAttempt {
  graph: GraphSpec;
  node: NodeSpec;
  result: NodeRunResult;
}

export interface SchedulerDecisionCommitted {
  graph: GraphSpec;
  node: NodeSpec;
  event: DecisionEvent;
}

export interface SchedulerRunResult extends GraphRunResult {
  scheduledOrder: readonly string[];
  completionOrder: readonly string[];
}

export interface SchedulerJournal {
  beforeAttempt(context: SchedulerBeforeAttempt): Promise<SchedulerAttemptIdentity>;
  attemptFailed(context: SchedulerAttemptFailed): Promise<void>;
  nodeSucceeded(context: SchedulerNodeSucceeded): Promise<void>;
  nodeSettledWithoutAttempt(context: SchedulerNodeSettledWithoutAttempt): Promise<void>;
  /**
   * One committed durable decision, delivered at the commit point inside the
   * scheduler and awaited BEFORE the deciding node settles — and therefore
   * before any downstream node that consumes the decision's bound output is
   * dispatched. This is the same before-effect discipline as `beforeAttempt`:
   * a journal that cannot durably record the decision must throw here, and the
   * effect never happens.
   */
  decisionCommitted?(context: SchedulerDecisionCommitted): Promise<void>;
  runTerminal(result: SchedulerRunResult): Promise<void>;
}

export interface SchedulerInternalOptions extends SchedulerOptions {
  journal?: SchedulerJournal;
  initialResults?: ReadonlyMap<string, NodeRunResult>;
  attemptOffsets?: ReadonlyMap<string, number>;
  initialTotalAttempts?: number;
  initialMaxObservedConcurrency?: number;
  initialScheduledOrder?: readonly string[];
  initialCompletionOrder?: readonly string[];
  initialRetryDelaysMs?: ReadonlyMap<string, number>;
}

interface JournalNodeExecutionContext extends NodeExecutionContext {
  runId?: string;
  attemptId?: string;
  activityKey?: string;
  idempotencyKey?: string;
}

function runtimeFailure(
  nodeId: string,
  code: RuntimeFailureCode,
  message: string,
  attempt: number,
  fields: Omit<NodeRunFailure, "phase" | "nodeId" | "code" | "message" | "attempt" | "retryable"> & {
    retryable?: boolean;
  } = {},
): NodeRunFailure {
  const { retryable = false, ...rest } = fields;
  return { phase: "execute", nodeId, code, message, attempt, retryable, ...rest };
}

function unsupportedConditionResult(
  nodeId: string,
  sequence: number,
  attempts: number,
  messages: readonly string[],
): NodeRunResult {
  return {
    nodeId,
    sequence,
    status: "failed",
    attempts,
    failure: runtimeFailure(
      nodeId,
      "UNSUPPORTED_EDGE_CONDITION",
      messages.join("; "),
      attempts,
    ),
  };
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Node executor threw a non-Error value";
}

class InvalidOutputError extends TypeError {
  constructor(cause: unknown) {
    super("Node executor returned a value that is not portable finite JSON", { cause });
    this.name = "InvalidOutputError";
  }
}

function snapshotGraphInput(input: unknown): JsonValue {
  try {
    return snapshotJson(input);
  } catch (error) {
    throw new TypeError("graph input must be a portable finite JSON value", { cause: error });
  }
}

function snapshotExecutorOutput(output: unknown): JsonValue {
  try {
    return snapshotJson(output);
  } catch (error) {
    throw new InvalidOutputError(error);
  }
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function resolveConcurrency(graph: GraphSpec, requested: number | undefined): number {
  const policy = positiveInteger(graph.policies?.maxConcurrency, 4);
  const desired = positiveInteger(requested, policy);
  return Math.min(desired, policy);
}

function assertTimerBounds(graph: GraphSpec): void {
  for (const node of graph.nodes) {
    for (const [name, value] of [
      ["timeoutMs", node.timeoutMs],
      ["retry.initialDelayMs", node.retry?.initialDelayMs],
      ["retry.maxDelayMs", node.retry?.maxDelayMs],
    ] as const) {
      if (value !== undefined && value > MAX_TIMER_DELAY_MS) {
        throw new TypeError(
          `Node '${node.id}' ${name} exceeds the ${MAX_TIMER_DELAY_MS}ms runtime timer limit`,
        );
      }
    }
  }
  const maxDurationMs = graph.policies?.maxDurationMs;
  if (typeof maxDurationMs === "number" && maxDurationMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`maxDurationMs exceeds the ${MAX_TIMER_DELAY_MS}ms runtime timer limit`);
  }
}

function endpointValue(endpoint: Endpoint, value: unknown): unknown {
  if (endpoint.port === undefined) {
    return value;
  }
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, endpoint.port)) {
    throw new Error(`Output from '${endpoint.node}' does not contain port '${endpoint.port}'`);
  }
  return (value as Record<string, unknown>)[endpoint.port];
}

function defineJsonValue(target: Record<string, JsonValue>, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function bindNodeInput(
  node: NodeSpec,
  incoming: readonly EdgeSpec[],
  graphInput: JsonValue,
  results: ReadonlyMap<string, NodeRunResult>,
): JsonValue {
  if (incoming.length === 0) {
    return graphInput;
  }

  const input = Object.create(null) as Record<string, JsonValue>;
  for (const edge of incoming) {
    const key = edge.to.port ?? edge.from.node;
    if (Object.hasOwn(input, key)) {
      throw new Error(`Node '${node.id}' receives more than one value for input key '${key}'`);
    }
    defineJsonValue(
      input,
      key,
      endpointValue(edge.from, results.get(edge.from.node)?.output) as JsonValue,
    );
  }
  return snapshotJson(input);
}

function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  if (milliseconds <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Run was cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryDelay(node: NodeSpec, failedAttempt: number): number {
  const initial = Math.max(0, node.retry?.initialDelayMs ?? 0);
  const multiplier = Math.max(1, node.retry?.backoffMultiplier ?? 1);
  const maximum = Math.max(initial, node.retry?.maxDelayMs ?? initial);
  return Math.min(maximum, initial * multiplier ** Math.max(0, failedAttempt - 1));
}

type AttemptOutcome =
  | { succeeded: true; output: JsonValue }
  | { succeeded: false; code?: RuntimeFailureCode; error?: unknown };

async function executeAttempt(
  executor: NodeExecutor,
  context: JournalNodeExecutionContext,
  timeoutMs: number | undefined,
): Promise<AttemptOutcome> {
  if (context.signal.aborted) {
    return { succeeded: false, code: "NODE_CANCELLED", error: context.signal.reason };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutController = new AbortController();
  const relayAbort = () => timeoutController.abort(context.signal.reason);
  context.signal.addEventListener("abort", relayAbort, { once: true });

  try {
    const execution = Promise.resolve(
      executor({ ...context, signal: timeoutController.signal }),
    ).then((output) => {
      if (context.signal.aborted && !timedOut) {
        return { succeeded: false, code: "NODE_CANCELLED", error: context.signal.reason } satisfies AttemptOutcome;
      }
      try {
        return { succeeded: true, output: snapshotExecutorOutput(output) } satisfies AttemptOutcome;
      } catch (error) {
        return { succeeded: false, code: "INVALID_OUTPUT", error } satisfies AttemptOutcome;
      }
    });

    if (timeoutMs === undefined) {
      return await execution;
    }

    const timeout = new Promise<AttemptOutcome>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        timeoutController.abort(new DOMException("Node timed out", "TimeoutError"));
        resolve({ succeeded: false, code: "NODE_TIMEOUT", error: new Error("Node timed out") });
      }, timeoutMs);
    });
    return await Promise.race([execution, timeout]);
  } catch (error) {
    const cancelled = context.signal.aborted && !timedOut;
    return {
      succeeded: false,
      code: cancelled ? "NODE_CANCELLED" : timedOut ? "NODE_TIMEOUT" : "NODE_EXECUTION_FAILED",
      error,
    };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    context.signal.removeEventListener("abort", relayAbort);
  }
}

interface ExecuteNodeOptions {
  graph: GraphSpec;
  node: NodeSpec;
  input: JsonValue;
  executor: NodeExecutor | undefined;
  signal: AbortSignal;
  sequence: number;
  claimAttempt: (nodeId: string) => boolean;
  reserveRetry: (nodeId: string) => boolean;
  releaseRetryReservation: (nodeId: string) => void;
  acquireAttemptSlot: (signal: AbortSignal) => Promise<() => void>;
  onAttemptStarted: () => void;
  onAttemptFinished: () => void;
  attemptOffset?: number;
  journal?: SchedulerJournal;
  journalEnabled?: () => boolean;
  outgoingEdges: readonly EdgeSpec[];
  initialRetryDelayMs?: number;
}

async function executeNode(options: ExecuteNodeOptions): Promise<NodeRunResult> {
  const {
    graph,
    node,
    input,
    executor,
    signal,
    sequence,
    claimAttempt,
    reserveRetry,
    releaseRetryReservation,
    acquireAttemptSlot,
    onAttemptStarted,
    onAttemptFinished,
    attemptOffset = 0,
    journal,
    journalEnabled = () => true,
    outgoingEdges,
    initialRetryDelayMs = 0,
  } = options;

  const settledWithoutAttempt = async (result: NodeRunResult): Promise<NodeRunResult> => {
    if (journal !== undefined && journalEnabled()) {
      await journal.nodeSettledWithoutAttempt({ graph, node, result });
    }
    return result;
  };

  if (executor === undefined) {
    const failure = runtimeFailure(
      node.id,
      "EXECUTOR_NOT_FOUND",
      `No executor is registered for node '${node.id}' (kind '${node.kind}')`,
      attemptOffset,
    );
    releaseRetryReservation(node.id);
    return settledWithoutAttempt({
      nodeId: node.id,
      sequence,
      status: "failed",
      attempts: attemptOffset,
      input,
      failure,
    });
  }

  const maxAttempts = positiveInteger(node.retry?.maxAttempts, 1);
  let lastFailure: NodeRunFailure | undefined;
  let attempts = attemptOffset;

  if (initialRetryDelayMs > 0) {
    try {
      await delay(initialRetryDelayMs, signal);
    } catch {
      const failure = runtimeFailure(node.id, "NODE_CANCELLED", `Node '${node.id}' was cancelled`, attempts);
      releaseRetryReservation(node.id);
      return settledWithoutAttempt({ nodeId: node.id, sequence, status: "failed", attempts, input, failure });
    }
  }

  if (attempts >= maxAttempts) {
    const failure = runtimeFailure(
      node.id,
      "ATTEMPT_BUDGET_EXHAUSTED",
      `Node '${node.id}' has exhausted its durable attempt budget`,
      attempts,
    );
    releaseRetryReservation(node.id);
    return settledWithoutAttempt({ nodeId: node.id, sequence, status: "failed", attempts, input, failure });
  }

  while (attempts < maxAttempts) {
    let releaseAttemptSlot: (() => void) | undefined;
    try {
      releaseAttemptSlot = await acquireAttemptSlot(signal);
    } catch {
      const failure = runtimeFailure(node.id, "NODE_CANCELLED", `Node '${node.id}' was cancelled`, attempts);
      releaseRetryReservation(node.id);
      return settledWithoutAttempt({ nodeId: node.id, sequence, status: "failed", attempts, input, failure });
    }

    if (!claimAttempt(node.id)) {
      releaseAttemptSlot();
      if (lastFailure !== undefined) {
        lastFailure = { ...lastFailure, retryable: false };
        return settledWithoutAttempt({
          nodeId: node.id,
          sequence,
          status: "failed",
          attempts,
          input,
          failure: lastFailure,
        });
      }
      const failure = runtimeFailure(
        node.id,
        "ATTEMPT_BUDGET_EXHAUSTED",
        `Run attempt budget was exhausted before node '${node.id}' could start`,
        attempts,
      );
      return settledWithoutAttempt({ nodeId: node.id, sequence, status: "failed", attempts, input, failure });
    }

    attempts += 1;
    let outcome: AttemptOutcome;
    let identity: SchedulerAttemptIdentity | undefined;
    let attemptMetricStarted = false;
    let mayRetry = false;
    let retryDelayMs = 0;
    try {
      if (journal !== undefined) {
        identity = await journal.beforeAttempt({ graph, node, input, attempt: attempts, signal });
        if (!journalEnabled()) throw signal.reason;
      }
      onAttemptStarted();
      attemptMetricStarted = true;
      const context: JournalNodeExecutionContext = {
        graph,
        node,
        input,
        attempt: attempts,
        signal,
        ...(identity === undefined
          ? {}
          : {
              runId: identity.runId,
              attemptId: identity.attemptId,
              activityKey: identity.activityKey,
              idempotencyKey: identity.activityKey,
            }),
      };
      outcome = await executeAttempt(
        executor,
        context,
        node.timeoutMs,
      );
      if (outcome.succeeded && node.kind === "router") {
        try {
          assertExactRouteSelection(node, input, outcome.output);
        } catch (error) {
          outcome = {
            succeeded: false,
            code: "INVALID_ROUTE_SELECTION",
            error,
          };
        }
      }
      if (outcome.succeeded && journal !== undefined && identity !== undefined && journalEnabled()) {
        await journal.nodeSucceeded({
          graph,
          node,
          input,
          attempt: attempts,
          output: outcome.output,
          identity,
          outgoingEdges,
        });
      } else if (!outcome.succeeded) {
        const code = outcome.error instanceof InvalidRouteSelectionError
          ? "INVALID_ROUTE_SELECTION"
          : outcome.code ?? "NODE_EXECUTION_FAILED";
        mayRetry = attempts < maxAttempts &&
          code !== "NODE_CANCELLED" &&
          code !== "INVALID_ROUTE_SELECTION" &&
          reserveRetry(node.id);
        lastFailure = runtimeFailure(
          node.id,
          code,
          code === "NODE_TIMEOUT"
            ? `Node '${node.id}' timed out after ${node.timeoutMs}ms`
            : code === "NODE_CANCELLED"
              ? `Node '${node.id}' was cancelled`
              : code === "INVALID_OUTPUT"
                ? `Node '${node.id}' returned a value that is not portable finite JSON`
                : `Node '${node.id}' failed: ${errorMessage(outcome.error)}`,
          attempts,
          { retryable: mayRetry, causeName: errorName(outcome.error) },
        );
        retryDelayMs = mayRetry ? retryDelay(node, attempts) : 0;
        if (journal !== undefined && identity !== undefined && journalEnabled()) {
          await journal.attemptFailed({
            graph,
            node,
            input,
            failure: lastFailure,
            identity,
            willRetry: mayRetry,
            retryDelayMs,
          });
        }
      }
    } finally {
      if (attemptMetricStarted) onAttemptFinished();
      releaseAttemptSlot();
    }
    if (outcome.succeeded) {
      return {
        nodeId: node.id,
        sequence,
        status: "succeeded",
        attempts,
        input,
        output: outcome.output,
      };
    }

    if (!mayRetry) {
      return {
        nodeId: node.id,
        sequence,
        status: "failed",
        attempts,
        input,
        failure: lastFailure as NodeRunFailure,
      };
    }

    try {
      await delay(retryDelayMs, signal);
    } catch {
      releaseRetryReservation(node.id);
      lastFailure = runtimeFailure(node.id, "NODE_CANCELLED", `Node '${node.id}' was cancelled`, attempts);
      return settledWithoutAttempt({
        nodeId: node.id,
        sequence,
        status: "failed",
        attempts,
        input,
        failure: lastFailure,
      });
    }
  }

  return {
    nodeId: node.id,
    sequence,
    status: "failed",
    attempts,
    input,
    failure: lastFailure as NodeRunFailure,
  };
}

interface SemaphoreWaiter {
  cancelled: boolean;
  grant: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

function createAttemptSemaphore(limit: number) {
  let running = 0;
  const waiters: SemaphoreWaiter[] = [];

  const releaseFactory = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      running -= 1;

      while (waiters.length > 0) {
        const next = waiters.shift() as SemaphoreWaiter;
        if (next.cancelled) continue;
        next.signal.removeEventListener("abort", next.onAbort);
        running += 1;
        next.grant(releaseFactory());
        break;
      }
    };
  };

  return (signal: AbortSignal): Promise<() => void> => {
    if (signal.aborted) {
      return Promise.reject(signal.reason);
    }
    if (running < limit) {
      running += 1;
      return Promise.resolve(releaseFactory());
    }

    return new Promise((grant, reject) => {
      const waiter: SemaphoreWaiter = {
        cancelled: false,
        grant,
        reject,
        signal,
        onAbort: () => {
          waiter.cancelled = true;
          reject(signal.reason);
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      waiters.push(waiter);
    });
  };
}

/** Internal scheduler entry point with durable journal and recovery seeds. */
export async function runGraphWithJournal(
  graph: GraphSpec,
  input: unknown,
  options: SchedulerInternalOptions = {},
): Promise<SchedulerRunResult> {
  const compilation = compileGraph(graph);
  if (!compilation.valid) {
    const failures: GraphRunFailure[] = compilation.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => ({ phase: "compile", code: item.code, message: item.message, diagnostic: item }));
    return {
      status: "failed",
      graphHash: compilation.graphHash,
      nodes: [],
      failures,
      maxObservedConcurrency: 0,
      totalAttempts: 0,
      scheduledOrder: [],
      completionOrder: [],
    };
  }
  if (compilation.canonicalGraph === null) {
    throw new TypeError("valid graph compilation omitted its canonical graph");
  }
  // Bind execution to the exact document whose hash was compiled. This also
  // prevents caller or executor mutation from changing live routing/config
  // after validation while leaving graphHash unchanged.
  graph = snapshotJson(JSON.parse(compilation.canonicalGraph)) as unknown as GraphSpec;
  const runtimeCapabilityIssues = graphRuntimeCapabilityIssues(graph, {
    integratedBarrier: true,
  });
  const capabilityIssues = graphConditionCapabilityIssues(graph);
  if (runtimeCapabilityIssues.length > 0 || capabilityIssues.length > 0) {
    return {
      status: "failed",
      graphHash: compilation.graphHash,
      nodes: [],
      failures: [
        ...runtimeCapabilityIssues.map((issue) => runtimeFailure(
          issue.ownerNodeId,
          "UNSUPPORTED_RUNTIME_CAPABILITY",
          runtimeCapabilityMessage(issue),
          0,
        )),
        ...capabilityIssues.map(({ nodeId, messages }) => runtimeFailure(
          nodeId,
          "UNSUPPORTED_EDGE_CONDITION",
          messages.join("; "),
          0,
        )),
      ],
      maxObservedConcurrency: 0,
      totalAttempts: 0,
      scheduledOrder: [],
      completionOrder: [],
    };
  }
  const graphInput = snapshotGraphInput(input);
  assertTimerBounds(graph);

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as EdgeSpec[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as EdgeSpec[]]));
  const remaining = new Map(graph.nodes.map((node) => [node.id, 0]));
  const activeEdges = new Map<string, boolean>();
  const conditionFailures = new Map<string, string[]>();
  for (const edge of graph.edges) {
    incoming.get(edge.to.node)?.push(edge);
    outgoing.get(edge.from.node)?.push(edge);
    remaining.set(edge.to.node, (remaining.get(edge.to.node) ?? 0) + 1);
  }
  for (const edges of incoming.values()) {
    edges.sort((left, right) => compareUnicodeCodePoints(left.id, right.id));
  }
  for (const edges of outgoing.values()) {
    edges.sort((left, right) => compareUnicodeCodePoints(left.id, right.id));
  }
  for (const [nodeId, edges] of outgoing) {
    const source = nodesById.get(nodeId) as NodeSpec;
    const messages = edges.flatMap((edge) => {
      const issue = edgeConditionError(edge, source);
      return issue === undefined ? [] : [issue];
    });
    if (messages.length > 0) conditionFailures.set(nodeId, messages);
  }

  const orderedNodeIds = compilation.topologicalLayers.flatMap((layer) => layer);
  const sequence = new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]));
  const compareNodes = (left: string, right: string): number =>
    (sequence.get(left) ?? Number.MAX_SAFE_INTEGER) - (sequence.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    compareUnicodeCodePoints(left, right);

  const restoredResults = new Map(options.initialResults ?? []);
  for (const [nodeId, restored] of restoredResults) {
    if (!nodesById.has(nodeId)) {
      throw new TypeError(`initialResults contains unknown node '${nodeId}'`);
    }
    const restoredConditionFailures = conditionFailures.get(nodeId);
    if (restoredConditionFailures !== undefined) {
      const expected = unsupportedConditionResult(
        nodeId,
        sequence.get(nodeId) as number,
        options.attemptOffsets?.get(nodeId) ?? 0,
        restoredConditionFailures,
      );
      if (canonicalSerialize(restored) !== canonicalSerialize(expected)) {
        throw new TypeError(
          `initialResults contains an invalid unsupported-condition settlement for '${nodeId}'`,
        );
      }
      continue;
    }
    const restoredNode = nodesById.get(nodeId) as NodeSpec;
    if (restoredNode.kind === "router" && restored.status === "succeeded") {
      try {
        if (restored.input === undefined) {
          throw new InvalidRouteSelectionError("restored router success is missing its input");
        }
        assertExactRouteSelection(
          restoredNode,
          restored.input,
          restored.output as JsonValue,
        );
      } catch (cause) {
        throw new TypeError(
          `initialResults contains an invalid successful router decision for '${nodeId}'`,
          { cause },
        );
      }
    }
  }

  const clock: MonotonicClock = options.clock ?? FROZEN_CLOCK;
  const decisionContext = options.decision ?? DEFAULT_DECISION_CONTEXT;
  const barrierBindings = bindIntegratedBarriers(graph);
  const barrierStates = new Map<string, BarrierState>(
    [...barrierBindings.keys()].map((nodeId) =>
      [nodeId, { decided: false, lateSources: new Set<string>() }]),
  );
  const decisionEvents: DecisionEvent[] = [];
  let haltedForHuman = false;

  // Fold the durable history before scheduling. A node with a committed
  // decision is never re-evaluated: no executor call, no recomputation, no
  // upstream re-read, and no second decision event.
  const committed = options.committedDecisions ?? [];
  if (committed.length > 0) {
    const currentPolicies = new Map<string, unknown>();
    for (const event of committed) {
      const node = nodesById.get(event.nodeId);
      if (node !== undefined) currentPolicies.set(event.nodeId, node.config);
    }
    const adoption = adoptCommittedDecisions(committed, currentPolicies, decisionContext);
    if (adoption.outcome === "rejected") {
      const { rejection } = adoption;
      return {
        status: "failed",
        graphHash: compilation.graphHash,
        nodes: [],
        failures: [runtimeFailure(
          rejection.nodeId,
          rejection.code,
          decisionRejectionMessage(rejection),
          0,
        )],
        maxObservedConcurrency: 0,
        totalAttempts: 0,
        scheduledOrder: [],
        completionOrder: [],
      };
    }
    for (const decision of adoption.decisions) {
      const nodeSequence = sequence.get(decision.nodeId);
      if (nodeSequence === undefined) {
        throw new TypeError(`committed decision targets unknown node '${decision.nodeId}'`);
      }
      if (decision.type === "RouteSelected") {
        restoredResults.set(decision.nodeId, {
          nodeId: decision.nodeId,
          sequence: nodeSequence,
          status: "succeeded",
          attempts: 0,
          output: adoptedRouteSelection(decision.document),
        });
        continue;
      }
      const resolution = decision.document.resolution as keyof typeof BARRIER_RESOLUTION_STATUS;
      const status = BARRIER_RESOLUTION_STATUS[resolution];
      if (status === undefined) {
        throw new TypeError(`committed barrier decision for '${decision.nodeId}' has no resolution`);
      }
      restoredResults.set(decision.nodeId, {
        nodeId: decision.nodeId,
        sequence: nodeSequence,
        status,
        attempts: 0,
        ...(status === "succeeded" ? { output: decision.document as unknown as JsonValue } : {}),
        ...(status === "failed"
          ? {
            failure: runtimeFailure(
              decision.nodeId,
              "BARRIER_NOT_SATISFIED",
              `Barrier '${decision.nodeId}' was not satisfied`,
              0,
            ),
          }
          : {}),
      });
      const state = barrierStates.get(decision.nodeId);
      if (state !== undefined) state.decided = true;
      if (status === "awaiting_human") haltedForHuman = true;
    }
  }

  for (const nodeId of orderedNodeIds) {
    if (!restoredResults.has(nodeId)) continue;
    for (const edge of outgoing.get(nodeId) ?? []) {
      activeEdges.set(edge.id, edgeIsActive(edge, restoredResults.get(nodeId) as NodeRunResult));
      remaining.set(edge.to.node, (remaining.get(edge.to.node) ?? 0) - 1);
    }
  }

  // An integrated barrier never enters the ready queue: it is decided by the
  // scheduler at a quiescence point, with zero executor attempts.
  const ready = orderedNodeIds
    .filter((nodeId) => remaining.get(nodeId) === 0 &&
      !restoredResults.has(nodeId) &&
      !barrierBindings.has(nodeId))
    .sort(compareNodes);
  const active = new Map<string, Promise<{ nodeId: string; result: NodeRunResult }>>();
  const results = restoredResults;
  const scheduledOrder = [...(options.initialScheduledOrder ?? [])];
  const completionOrder = [...(options.initialCompletionOrder ?? [])];
  const concurrency = resolveConcurrency(graph, options.concurrency);
  const runController = new AbortController();
  const cancelRun = () => runController.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancelRun, { once: true });
  if (options.signal?.aborted) {
    cancelRun();
  }

  const attemptLimit = positiveInteger(graph.policies?.maxTotalAttempts, Number.MAX_SAFE_INTEGER);
  let totalAttempts = options.initialTotalAttempts ?? 0;
  if (!Number.isSafeInteger(totalAttempts) || totalAttempts < 0) {
    throw new TypeError("initialTotalAttempts must be a non-negative safe integer");
  }
  const retryReservations = new Set(options.initialRetryDelaysMs?.keys() ?? []);
  for (const nodeId of retryReservations) {
    if (!nodesById.has(nodeId)) {
      throw new TypeError(`initialRetryDelaysMs contains unknown node '${nodeId}'`);
    }
    if (restoredResults.has(nodeId)) {
      throw new TypeError(`initial retry reservation targets settled node '${nodeId}'`);
    }
  }
  if (totalAttempts + retryReservations.size > attemptLimit) {
    throw new TypeError("initial durable attempts and retry reservations exceed maxTotalAttempts");
  }
  let observedConcurrency = options.initialMaxObservedConcurrency ?? 0;
  let journalEnabled = true;
  let runningAttempts = 0;
  const acquireAttemptSlot = createAttemptSemaphore(concurrency);
  const onAttemptStarted = (): void => {
    runningAttempts += 1;
    observedConcurrency = Math.max(observedConcurrency, runningAttempts);
  };
  const onAttemptFinished = (): void => {
    runningAttempts -= 1;
  };

  const claimAttempt = (nodeId: string): boolean => {
    if (retryReservations.delete(nodeId)) {
      totalAttempts += 1;
      return true;
    }
    if (totalAttempts + retryReservations.size >= attemptLimit) {
      return false;
    }
    totalAttempts += 1;
    return true;
  };

  const reserveRetry = (nodeId: string): boolean => {
    if (retryReservations.has(nodeId)) return false;
    if (totalAttempts + retryReservations.size >= attemptLimit) return false;
    retryReservations.add(nodeId);
    return true;
  };

  const releaseRetryReservation = (nodeId: string): void => {
    retryReservations.delete(nodeId);
  };

  const lateArrivalFailures: NodeRunFailure[] = [];

  /**
   * A source that settles after a barrier already committed its decision. The
   * committed decision is immutable either way: a late arrival never mutates
   * `total`, any count, any ID list, any vote, or the decision identity.
   */
  const observeLateArrival = (sourceNodeId: string): void => {
    for (const [barrierNodeId, state] of barrierStates) {
      if (!state.decided || !state.lateSources.delete(sourceNodeId)) continue;
      const binding = barrierBindings.get(barrierNodeId) as BarrierBinding;
      if (binding.policy.lateArrival !== "reject") continue;
      lateArrivalFailures.push(runtimeFailure(
        barrierNodeId,
        "BARRIER_LATE_ARRIVAL",
        `Barrier '${barrierNodeId}' had already decided when upstream `
          + `'${sourceNodeId}' settled`,
        0,
        { upstreamNodeIds: [sourceNodeId] },
      ));
    }
  };

  const settle = (nodeId: string, result: NodeRunResult): void => {
    results.set(nodeId, result);
    completionOrder.push(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      activeEdges.set(edge.id, edgeIsActive(edge, result));
      const next = (remaining.get(edge.to.node) ?? 0) - 1;
      remaining.set(edge.to.node, next);
      if (next === 0 && !results.has(edge.to.node) && !barrierBindings.has(edge.to.node)) {
        ready.push(edge.to.node);
      }
    }
    ready.sort(compareNodes);
    observeLateArrival(nodeId);
  };

  const settleWithoutAttempt = async (
    node: NodeSpec,
    result: NodeRunResult,
  ): Promise<void> => {
    releaseRetryReservation(node.id);
    if (options.journal !== undefined && journalEnabled) {
      await options.journal.nodeSettledWithoutAttempt({ graph, node, result });
    }
    settle(node.id, result);
  };

  const launchReady = async (): Promise<void> => {
    while (ready.length > 0) {
      const nodeId = ready.shift() as string;
      if (!scheduledOrder.includes(nodeId)) scheduledOrder.push(nodeId);
      const node = nodesById.get(nodeId) as NodeSpec;
      const attemptOffset = options.attemptOffsets?.get(nodeId) ?? 0;
      const nodeIncoming = incoming.get(nodeId) ?? [];
      const activeIncoming = nodeIncoming.filter((edge) => activeEdges.get(edge.id) !== false);
      const conditionFailure = conditionFailures.get(nodeId);
      if (conditionFailure !== undefined) {
        await settleWithoutAttempt(node, unsupportedConditionResult(
          nodeId,
          sequence.get(nodeId) as number,
          attemptOffset,
          conditionFailure,
        ));
        continue;
      }
      if (nodeIncoming.length > 0 && activeIncoming.length === 0) {
        const failure = runtimeFailure(
          nodeId,
          "ROUTE_NOT_SELECTED",
          `Node '${nodeId}' did not start because no incoming route was selected`,
          attemptOffset,
        );
        await settleWithoutAttempt(node, {
          nodeId,
          sequence: sequence.get(nodeId) as number,
          status: "skipped",
          attempts: attemptOffset,
          failure,
        });
        continue;
      }
      const unsucceededUpstream = [...new Set(
        activeIncoming
          .map((edge) => edge.from.node)
          .filter((upstreamId) => results.get(upstreamId)?.status !== "succeeded"),
      )].sort(compareUnicodeCodePoints);
      const unknownUpstream = unsucceededUpstream.filter(
        (upstreamId) => isUnknownTerminal(results.get(upstreamId)),
      );
      const failedUpstream = unsucceededUpstream.filter(
        (upstreamId) => !isUnknownTerminal(results.get(upstreamId)),
      );

      // A descendant reachable only through a barrier that resolved `unknown`
      // inherits the zero-attempt `UPSTREAM_UNKNOWN` terminal. A genuine
      // upstream failure still outranks it.
      if (!runController.signal.aborted && failedUpstream.length === 0 &&
          unknownUpstream.length > 0) {
        await settleWithoutAttempt(node, {
          nodeId,
          sequence: sequence.get(nodeId) as number,
          status: "skipped",
          attempts: attemptOffset,
          failure: runtimeFailure(
            nodeId,
            "UPSTREAM_UNKNOWN",
            `Node '${nodeId}' did not start because upstream nodes are unknown: `
              + unknownUpstream.join(", "),
            attemptOffset,
            { upstreamNodeIds: unknownUpstream },
          ),
        });
        continue;
      }

      if (runController.signal.aborted || failedUpstream.length > 0) {
        const cancelled = runController.signal.aborted;
        const failure = runtimeFailure(
          nodeId,
          cancelled ? "NODE_CANCELLED" : "UPSTREAM_FAILED",
          cancelled
            ? `Node '${nodeId}' did not start because the run was cancelled`
            : `Node '${nodeId}' did not start because upstream nodes failed: ${failedUpstream.join(", ")}`,
          attemptOffset,
          cancelled ? {} : { upstreamNodeIds: failedUpstream },
        );
        await settleWithoutAttempt(node, {
          nodeId,
          sequence: sequence.get(nodeId) as number,
          status: "skipped",
          attempts: attemptOffset,
          failure,
        });
        continue;
      }

      let nodeInput: JsonValue;
      try {
        nodeInput = bindNodeInput(node, activeIncoming, graphInput, results);
      } catch (error) {
        const failure = runtimeFailure(
          nodeId,
          "INPUT_BINDING_FAILED",
          `Could not bind input for node '${nodeId}': ${errorMessage(error)}`,
          attemptOffset,
          { causeName: errorName(error) },
        );
        await settleWithoutAttempt(node, {
          nodeId,
          sequence: sequence.get(nodeId) as number,
          status: "failed",
          attempts: attemptOffset,
          failure,
        });
        continue;
      }

      const nodeExecutor = options.nodeExecutors !== undefined &&
          Object.hasOwn(options.nodeExecutors, nodeId)
        ? options.nodeExecutors[nodeId]
        : undefined;
      const kindExecutor = options.executors !== undefined &&
          Object.hasOwn(options.executors, node.kind)
        ? options.executors[node.kind]
        : undefined;
      const executor = nodeExecutor ?? kindExecutor ??
        (node.kind === "router"
          ? routeSelectionExecutor
          : node.kind === "transform" || node.kind === "barrier"
            ? identityExecutor
            : undefined);
      const task = executeNode({
        graph,
        node,
        input: nodeInput,
        executor,
        signal: runController.signal,
        sequence: sequence.get(nodeId) as number,
        claimAttempt,
        reserveRetry,
        releaseRetryReservation,
        acquireAttemptSlot,
        onAttemptStarted,
        onAttemptFinished,
        attemptOffset,
        ...(options.journal === undefined ? {} : { journal: options.journal }),
        journalEnabled: () => journalEnabled,
        outgoingEdges: outgoing.get(nodeId) ?? [],
        initialRetryDelayMs: options.initialRetryDelaysMs?.get(nodeId) ?? 0,
      }).then((result) => ({ nodeId, result }));
      active.set(nodeId, task);
    }
  };

  const barrierNodeResult = (
    nodeId: string,
    status: NodeRunResult["status"],
    extra: Omit<NodeRunResult, "nodeId" | "sequence" | "status" | "attempts"> & {
      attempts?: number;
    } = {},
  ): NodeRunResult => {
    const { attempts = 0, ...rest } = extra;
    return {
      nodeId,
      sequence: sequence.get(nodeId) as number,
      status,
      attempts,
      ...rest,
    };
  };

  /** The value a barrier's incoming edge would bind, for ballot extraction only. */
  const boundVoteValue = (edge: EdgeSpec): JsonValue | undefined => {
    try {
      return endpointValue(edge.from, results.get(edge.from.node)?.output) as JsonValue;
    } catch {
      return undefined;
    }
  };

  const decideBarrier = async (binding: BarrierBinding, state: BarrierState): Promise<void> => {
    const node = nodesById.get(binding.nodeId) as NodeSpec;
    if (!scheduledOrder.includes(binding.nodeId)) scheduledOrder.push(binding.nodeId);
    const arrivals: BarrierArrival[] = [];
    for (const edge of binding.incoming) {
      const resolved = resolveArrival(binding.policy, {
        edge,
        result: results.get(edge.from.node),
        edgeActive: activeEdges.get(edge.id) !== false,
        boundValue: () => boundVoteValue(edge),
      });
      if (resolved.kind === "malformed-vote") {
        // Never coerced to abstain or unknown, and no disposition entry is
        // produced: the barrier fails non-retryably after exactly one attempt.
        state.decided = true;
        totalAttempts += 1;
        await settleWithoutAttempt(node, barrierNodeResult(binding.nodeId, "failed", {
          attempts: 1,
          failure: runtimeFailure(
            binding.nodeId,
            "INVALID_BARRIER_VOTE",
            `Barrier '${binding.nodeId}' received a malformed vote from `
              + `'${resolved.sourceNodeId}'`,
            1,
            { upstreamNodeIds: [resolved.sourceNodeId] },
          ),
        }));
        return;
      }
      arrivals.push(resolved.arrival);
    }

    const document = commitBarrierDecision(
      binding,
      decisionContext,
      arrivals,
      state.armedAtMs as number,
      clock.nowMs(),
    );
    state.decided = true;
    state.lateSources = new Set(
      binding.incoming
        .filter((edge) => !results.has(edge.from.node))
        .map((edge) => edge.from.node),
    );
    const commitDecision = async (event: DecisionEvent): Promise<void> => {
      decisionEvents.push(event);
      // Before-effect: the durable journal records the decision before the
      // barrier settles, so no downstream dispatch can precede the record. A
      // journal failure here aborts the run with the decision unsettled.
      if (options.journal?.decisionCommitted !== undefined && journalEnabled) {
        await options.journal.decisionCommitted({ graph, node, event });
      }
    };
    await commitDecision({
      type: "BarrierSatisfied",
      nodeId: binding.nodeId,
      data: document as unknown as JsonValue,
    });
    if (document.resolution === "awaiting_human") {
      await commitDecision({
        type: "HumanInputRequested",
        nodeId: binding.nodeId,
        data: document as unknown as JsonValue,
      });
      haltedForHuman = true;
    }
    const status = BARRIER_RESOLUTION_STATUS[document.resolution];
    await settleWithoutAttempt(node, barrierNodeResult(binding.nodeId, status, {
      // A satisfied barrier binds the decision document. An unsatisfied one
      // NEVER binds an output, whichever resolution it declared.
      ...(status === "succeeded" ? { output: document as unknown as JsonValue } : {}),
      ...(status === "failed"
        ? {
          failure: runtimeFailure(
            binding.nodeId,
            "BARRIER_NOT_SATISFIED",
            `Barrier '${binding.nodeId}' was not satisfied (${document.reasonCode})`,
            0,
          ),
        }
        : {}),
    }));
  };

  /**
   * One quiescence point: arm every barrier that now has a bound upstream, then
   * decide every barrier that is complete or whose deadline has elapsed.
   * Returns true when anything settled, so the caller re-enters this state.
   */
  const observeBarrierQuiescence = async (): Promise<boolean> => {
    let settledAny = false;
    for (const nodeId of orderedNodeIds) {
      const binding = barrierBindings.get(nodeId);
      const state = barrierStates.get(nodeId);
      if (binding === undefined || state === undefined || state.decided) continue;

      if (runController.signal.aborted) {
        // A cancelled armed barrier emits no decision event and never produces
        // a partial decision document.
        state.decided = true;
        settledAny = true;
        const node = nodesById.get(nodeId) as NodeSpec;
        await settleWithoutAttempt(node, state.armedAtMs === undefined
          ? barrierNodeResult(nodeId, "skipped", {
            failure: runtimeFailure(
              nodeId,
              "NODE_CANCELLED",
              `Node '${nodeId}' did not start because the run was cancelled`,
              0,
            ),
          })
          : barrierNodeResult(nodeId, "cancelled"));
        continue;
      }

      const settledSources = binding.incoming.filter((edge) => results.has(edge.from.node));
      if (settledSources.length === 0) continue;
      state.armedAtMs ??= clock.nowMs();
      const complete = settledSources.length === binding.incoming.length;
      const afterMs = binding.policy.deadline?.afterMs;
      const elapsed = afterMs !== undefined &&
        clock.nowMs() - (state.armedAtMs as number) >= afterMs;
      if (!complete && !elapsed) continue;
      await decideBarrier(binding, state);
      settledAny = true;
    }
    return settledAny;
  };

  /** True while some armed barrier can still only be decided by the clock. */
  const awaitsDeadline = (): boolean => {
    for (const [nodeId, state] of barrierStates) {
      if (state.decided || state.armedAtMs === undefined) continue;
      if (barrierBindings.get(nodeId)?.policy.deadline !== undefined) return true;
    }
    return false;
  };

  const TICK = Symbol("clock-tick");
  type RaceOutcome = { nodeId: string; result: NodeRunResult } | typeof TICK;

  // At most one tick is ever outstanding, so a tick the race did not win is
  // reused rather than pulling a second value off the driver's script.
  let pendingTick: Promise<RaceOutcome> | undefined;
  const tickContender = (): Promise<RaceOutcome> | undefined => {
    if (pendingTick !== undefined) return pendingTick;
    const tick = clock.nextTick?.();
    if (tick === undefined) return undefined;
    const contender: Promise<RaceOutcome> = tick.then(() => {
      if (pendingTick === contender) pendingTick = undefined;
      return TICK;
    });
    pendingTick = contender;
    return contender;
  };

  const raceNext = async (waitForTick: boolean): Promise<RaceOutcome | undefined> => {
    // Node settlement is offered to the race first. A deterministic executor
    // settles on the microtask queue while the driver delivers a tick on the
    // macrotask queue, so a tick is only ever observed at a real quiescence
    // point and the scheduler needs no timer of its own.
    const contenders: Promise<RaceOutcome>[] = [...active.values()];
    if (waitForTick) {
      if (!runController.signal.aborted) {
        // Cancellation is a quiescence point of its own, so a barrier waiting
        // on a deadline must never outlive the run's abort.
        contenders.push(new Promise<RaceOutcome>((resolve) => {
          runController.signal.addEventListener("abort", () => resolve(TICK), { once: true });
        }));
      }
      const tick = tickContender();
      if (tick !== undefined) contenders.push(tick);
    }
    if (contenders.length === 0) return undefined;
    return await Promise.race(contenders);
  };

  try {
    while (results.size < graph.nodes.length) {
      if (!haltedForHuman) await launchReady();
      if (await observeBarrierQuiescence()) continue;
      // A human resolution schedules no descendant and stops.
      if (haltedForHuman && active.size === 0) break;
      const raced = await raceNext(!haltedForHuman && awaitsDeadline());
      if (raced === undefined) break;
      if (raced === TICK) continue;
      active.delete(raced.nodeId);
      settle(raced.nodeId, raced.result);
    }
  } catch (error) {
    journalEnabled = false;
    runController.abort(error);
    // Stop admitting journal writes immediately. Executors are cooperative and
    // may ignore AbortSignal, so durability failures must not wait forever for
    // unrelated in-flight work. allSettled observes late rejections without
    // delaying propagation of the authoritative journal error.
    void Promise.allSettled([...active.values()]);
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", cancelRun);
  }

  // A run halted by a human resolution legitimately leaves nodes unscheduled.
  const nodeResults = orderedNodeIds.flatMap((nodeId) => {
    const result = results.get(nodeId);
    return result === undefined ? [] : [result];
  });
  // `UPSTREAM_UNKNOWN` is excluded from graph failure codes exactly as
  // `ROUTE_NOT_SELECTED` already is: neither invents a node failure.
  const failures: GraphRunFailure[] = [
    ...nodeResults.flatMap((result) =>
      result.failure === undefined ||
        result.failure.code === "ROUTE_NOT_SELECTED" ||
        result.failure.code === "UPSTREAM_UNKNOWN"
        ? []
        : [result.failure]),
    ...lateArrivalFailures,
  ];
  const output = Object.create(null) as Record<string, JsonValue>;
  let outputsComplete = true;
  for (const [name, endpoint] of Object.entries(graph.outputs).sort(([left], [right]) =>
    compareUnicodeCodePoints(left, right),
  )) {
    const result = results.get(endpoint.node);
    if (result?.status !== "succeeded") {
      outputsComplete = false;
      continue;
    }
    try {
      defineJsonValue(output, name, endpointValue(endpoint, result.output) as JsonValue);
    } catch (error) {
      outputsComplete = false;
      failures.push({
        phase: "output",
        code: "OUTPUT_BINDING_FAILED",
        message: `Could not bind graph output '${name}': ${errorMessage(error)}`,
        outputName: name,
        nodeId: endpoint.node,
        ...(endpoint.port === undefined ? {} : { port: endpoint.port }),
      });
    }
  }

  // Run terminal precedence, highest first: failed, cancelled, awaiting_human,
  // unknown, succeeded. A node whose only failure is its own cancellation is a
  // cancellation rather than a failure, which is how the shipped `cancelled`
  // terminal keeps outranking the NODE_CANCELLED failures it necessarily emits.
  const cancelled = runController.signal.aborted;
  const failed = failures.some((failure) =>
    failure.phase !== "execute" || failure.code !== "NODE_CANCELLED");
  const awaitingHuman = nodeResults.some((result) => result.status === "awaiting_human");
  const unknownTerminal = nodeResults.some((result) => result.status === "unknown");
  const status: GraphRunResult["status"] = failed
    ? "failed"
    : cancelled
      ? "cancelled"
      : awaitingHuman
        ? "awaiting_human"
        : unknownTerminal
          ? "unknown"
          : outputsComplete
            ? "succeeded"
            : "failed";
  const runResult: SchedulerRunResult = {
    status,
    graphHash: compilation.graphHash,
    ...(outputsComplete
      ? { output: snapshotJson(output) as Readonly<Record<string, JsonValue>> }
      : {}),
    nodes: nodeResults,
    failures,
    maxObservedConcurrency: observedConcurrency,
    totalAttempts,
    ...(decisionEvents.length === 0 ? {} : { decisionEvents: Object.freeze(decisionEvents) }),
    scheduledOrder,
    completionOrder,
  };
  if (options.journal !== undefined) {
    await options.journal.runTerminal(runResult);
  }
  return runResult;
}

/** Execute a valid DAG with bounded concurrency and deterministic result ordering. */
export async function runGraph(
  graph: GraphSpec,
  input: unknown,
  options: SchedulerOptions = {},
): Promise<GraphRunResult> {
  // Whitelist the public surface at runtime. JavaScript callers must not be
  // able to smuggle internal recovery seeds or a journal through an untyped
  // options object and bypass durable-history validation.
  const publicOptions: SchedulerOptions = {
    ...(options.nodeExecutors === undefined ? {} : { nodeExecutors: options.nodeExecutors }),
    ...(options.executors === undefined ? {} : { executors: options.executors }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.decision === undefined ? {} : { decision: options.decision }),
    ...(options.committedDecisions === undefined
      ? {}
      : { committedDecisions: options.committedDecisions }),
  };
  const { scheduledOrder: _scheduledOrder, completionOrder: _completionOrder, ...result } =
    await runGraphWithJournal(graph, input, publicOptions);
  return result;
}
