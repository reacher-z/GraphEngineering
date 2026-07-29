import {
  canonicalSerialize,
  compileGraph,
  compareUnicodeCodePoints,
  type EdgeSpec,
  type Endpoint,
  type GraphSpec,
  type NodeSpec,
} from "@graph-engineering/core";
import type {
  GraphRunFailure,
  GraphRunResult,
  JsonValue,
  NodeExecutionContext,
  NodeExecutor,
  NodeRunFailure,
  NodeRunResult,
  RuntimeFailureCode,
  SchedulerOptions,
} from "./types.js";
import { snapshotJson } from "./json.js";
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

export interface SchedulerRunResult extends GraphRunResult {
  scheduledOrder: readonly string[];
  completionOrder: readonly string[];
}

export interface SchedulerJournal {
  beforeAttempt(context: SchedulerBeforeAttempt): Promise<SchedulerAttemptIdentity>;
  attemptFailed(context: SchedulerAttemptFailed): Promise<void>;
  nodeSucceeded(context: SchedulerNodeSucceeded): Promise<void>;
  nodeSettledWithoutAttempt(context: SchedulerNodeSettledWithoutAttempt): Promise<void>;
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
  const graphInput = snapshotGraphInput(input);
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
  const capabilityIssues = graphConditionCapabilityIssues(graph);
  if (capabilityIssues.length > 0) {
    return {
      status: "failed",
      graphHash: compilation.graphHash,
      nodes: [],
      failures: capabilityIssues.map(({ nodeId, messages }) => runtimeFailure(
        nodeId,
        "UNSUPPORTED_EDGE_CONDITION",
        messages.join("; "),
        0,
      )),
      maxObservedConcurrency: 0,
      totalAttempts: 0,
      scheduledOrder: [],
      completionOrder: [],
    };
  }
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
  for (const nodeId of orderedNodeIds) {
    if (!restoredResults.has(nodeId)) continue;
    for (const edge of outgoing.get(nodeId) ?? []) {
      activeEdges.set(edge.id, edgeIsActive(edge, restoredResults.get(nodeId) as NodeRunResult));
      remaining.set(edge.to.node, (remaining.get(edge.to.node) ?? 0) - 1);
    }
  }

  const ready = orderedNodeIds
    .filter((nodeId) => remaining.get(nodeId) === 0 && !restoredResults.has(nodeId))
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

  const settle = (nodeId: string, result: NodeRunResult): void => {
    results.set(nodeId, result);
    completionOrder.push(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      activeEdges.set(edge.id, edgeIsActive(edge, result));
      const next = (remaining.get(edge.to.node) ?? 0) - 1;
      remaining.set(edge.to.node, next);
      if (next === 0 && !results.has(edge.to.node)) {
        ready.push(edge.to.node);
      }
    }
    ready.sort(compareNodes);
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
      const failedUpstream = [...new Set(
        activeIncoming
          .map((edge) => edge.from.node)
          .filter((upstreamId) => results.get(upstreamId)?.status !== "succeeded"),
      )].sort(compareUnicodeCodePoints);

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

  try {
    while (results.size < graph.nodes.length) {
      await launchReady();
      if (active.size === 0) {
        break;
      }
      const completed = await Promise.race(active.values());
      active.delete(completed.nodeId);
      settle(completed.nodeId, completed.result);
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

  const nodeResults = orderedNodeIds.map((nodeId) => results.get(nodeId) as NodeRunResult);
  const failures: GraphRunFailure[] = nodeResults.flatMap((result) =>
    result.failure === undefined || result.failure.code === "ROUTE_NOT_SELECTED"
      ? []
      : [result.failure],
  );
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

  const cancelled = runController.signal.aborted;
  const succeeded = !cancelled && failures.length === 0 && outputsComplete;
  const runResult: SchedulerRunResult = {
    status: cancelled ? "cancelled" : succeeded ? "succeeded" : "failed",
    graphHash: compilation.graphHash,
    ...(outputsComplete
      ? { output: snapshotJson(output) as Readonly<Record<string, JsonValue>> }
      : {}),
    nodes: nodeResults,
    failures,
    maxObservedConcurrency: observedConcurrency,
    totalAttempts,
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
  };
  const { scheduledOrder: _scheduledOrder, completionOrder: _completionOrder, ...result } =
    await runGraphWithJournal(graph, input, publicOptions);
  return result;
}
