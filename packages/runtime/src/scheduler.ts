import {
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

const identityExecutor: NodeExecutor = ({ input }) => input;

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

function endpointValue(endpoint: Endpoint, value: unknown): unknown {
  if (endpoint.port === undefined) {
    return value;
  }
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, endpoint.port)) {
    throw new Error(`Output from '${endpoint.node}' does not contain port '${endpoint.port}'`);
  }
  return (value as Record<string, unknown>)[endpoint.port];
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

  const input: Record<string, JsonValue> = {};
  for (const edge of incoming) {
    const key = edge.to.port ?? edge.from.node;
    if (Object.hasOwn(input, key)) {
      throw new Error(`Node '${node.id}' receives more than one value for input key '${key}'`);
    }
    input[key] = endpointValue(edge.from, results.get(edge.from.node)?.output) as JsonValue;
  }
  return snapshotJson(input);
}

function delay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
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
  context: NodeExecutionContext,
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
  claimAttempt: () => boolean;
  acquireAttemptSlot: (signal: AbortSignal) => Promise<() => void>;
}

async function executeNode(options: ExecuteNodeOptions): Promise<NodeRunResult> {
  const { graph, node, input, executor, signal, sequence, claimAttempt, acquireAttemptSlot } = options;
  if (executor === undefined) {
    const failure = runtimeFailure(
      node.id,
      "EXECUTOR_NOT_FOUND",
      `No executor is registered for node '${node.id}' (kind '${node.kind}')`,
      0,
    );
    return { nodeId: node.id, sequence, status: "failed", attempts: 0, input, failure };
  }

  const maxAttempts = positiveInteger(node.retry?.maxAttempts, 1);
  let lastFailure: NodeRunFailure | undefined;
  let attempts = 0;

  while (attempts < maxAttempts) {
    let releaseAttemptSlot: (() => void) | undefined;
    try {
      releaseAttemptSlot = await acquireAttemptSlot(signal);
    } catch {
      const failure = runtimeFailure(node.id, "NODE_CANCELLED", `Node '${node.id}' was cancelled`, attempts);
      return { nodeId: node.id, sequence, status: "failed", attempts, input, failure };
    }

    if (!claimAttempt()) {
      releaseAttemptSlot();
      if (lastFailure !== undefined) {
        lastFailure = { ...lastFailure, retryable: false };
        return { nodeId: node.id, sequence, status: "failed", attempts, input, failure: lastFailure };
      }
      const failure = runtimeFailure(
        node.id,
        "ATTEMPT_BUDGET_EXHAUSTED",
        `Run attempt budget was exhausted before node '${node.id}' could start`,
        attempts,
      );
      return { nodeId: node.id, sequence, status: "failed", attempts, input, failure };
    }

    attempts += 1;
    let outcome: AttemptOutcome;
    try {
      outcome = await executeAttempt(
        executor,
        { graph, node, input, attempt: attempts, signal },
        node.timeoutMs,
      );
    } finally {
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

    const code = outcome.code ?? "NODE_EXECUTION_FAILED";
    const mayRetry = attempts < maxAttempts && code !== "NODE_CANCELLED";
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

    if (mayRetry) {
      try {
        await delay(retryDelay(node, attempts), signal);
      } catch {
        lastFailure = runtimeFailure(node.id, "NODE_CANCELLED", `Node '${node.id}' was cancelled`, attempts);
        break;
      }
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

function createAttemptSemaphore(limit: number, onRunningChange: (running: number) => void) {
  let running = 0;
  const waiters: SemaphoreWaiter[] = [];

  const releaseFactory = (): (() => void) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      running -= 1;
      onRunningChange(running);

      while (waiters.length > 0) {
        const next = waiters.shift() as SemaphoreWaiter;
        if (next.cancelled) continue;
        next.signal.removeEventListener("abort", next.onAbort);
        running += 1;
        onRunningChange(running);
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
      onRunningChange(running);
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

/** Execute a valid DAG with bounded concurrency and deterministic result ordering. */
export async function runGraph(
  graph: GraphSpec,
  input: unknown,
  options: SchedulerOptions = {},
): Promise<GraphRunResult> {
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
    };
  }

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as EdgeSpec[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as EdgeSpec[]]));
  const remaining = new Map(graph.nodes.map((node) => [node.id, 0]));
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

  const orderedNodeIds = compilation.topologicalLayers.flatMap((layer) => layer);
  const sequence = new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]));
  const compareNodes = (left: string, right: string): number =>
    (sequence.get(left) ?? Number.MAX_SAFE_INTEGER) - (sequence.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    compareUnicodeCodePoints(left, right);

  const ready = orderedNodeIds.filter((nodeId) => remaining.get(nodeId) === 0).sort(compareNodes);
  const active = new Map<string, Promise<{ nodeId: string; result: NodeRunResult }>>();
  const results = new Map<string, NodeRunResult>();
  const concurrency = resolveConcurrency(graph, options.concurrency);
  const runController = new AbortController();
  const cancelRun = () => runController.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancelRun, { once: true });
  if (options.signal?.aborted) {
    cancelRun();
  }

  const attemptLimit = positiveInteger(graph.policies?.maxTotalAttempts, Number.MAX_SAFE_INTEGER);
  let totalAttempts = 0;
  let observedConcurrency = 0;
  const acquireAttemptSlot = createAttemptSemaphore(concurrency, (running) => {
    observedConcurrency = Math.max(observedConcurrency, running);
  });

  const claimAttempt = (): boolean => {
    if (totalAttempts >= attemptLimit) {
      return false;
    }
    totalAttempts += 1;
    return true;
  };

  const settle = (nodeId: string, result: NodeRunResult): void => {
    results.set(nodeId, result);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const next = (remaining.get(edge.to.node) ?? 0) - 1;
      remaining.set(edge.to.node, next);
      if (next === 0) {
        ready.push(edge.to.node);
      }
    }
    ready.sort(compareNodes);
  };

  const launchReady = (): void => {
    while (ready.length > 0) {
      const nodeId = ready.shift() as string;
      const node = nodesById.get(nodeId) as NodeSpec;
      const nodeIncoming = incoming.get(nodeId) ?? [];
      const failedUpstream = [...new Set(
        nodeIncoming
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
          0,
          cancelled ? {} : { upstreamNodeIds: failedUpstream },
        );
        settle(nodeId, {
          nodeId,
          sequence: sequence.get(nodeId) as number,
          status: "skipped",
          attempts: 0,
          failure,
        });
        continue;
      }

      let nodeInput: JsonValue;
      try {
        nodeInput = bindNodeInput(node, nodeIncoming, graphInput, results);
      } catch (error) {
        const failure = runtimeFailure(
          nodeId,
          "INPUT_BINDING_FAILED",
          `Could not bind input for node '${nodeId}': ${errorMessage(error)}`,
          0,
          { causeName: errorName(error) },
        );
        settle(nodeId, {
          nodeId,
          sequence: sequence.get(nodeId) as number,
          status: "failed",
          attempts: 0,
          failure,
        });
        continue;
      }

      const executor = options.nodeExecutors?.[nodeId] ?? options.executors?.[node.kind] ??
        (node.kind === "transform" || node.kind === "barrier" ? identityExecutor : undefined);
      const task = executeNode({
        graph,
        node,
        input: nodeInput,
        executor,
        signal: runController.signal,
        sequence: sequence.get(nodeId) as number,
        claimAttempt,
        acquireAttemptSlot,
      }).then((result) => ({ nodeId, result }));
      active.set(nodeId, task);
    }
  };

  try {
    while (results.size < graph.nodes.length) {
      launchReady();
      if (active.size === 0) {
        break;
      }
      const completed = await Promise.race(active.values());
      active.delete(completed.nodeId);
      settle(completed.nodeId, completed.result);
    }
  } finally {
    options.signal?.removeEventListener("abort", cancelRun);
  }

  const nodeResults = orderedNodeIds.map((nodeId) => results.get(nodeId) as NodeRunResult);
  const failures: GraphRunFailure[] = nodeResults.flatMap((result) =>
    result.failure === undefined ? [] : [result.failure],
  );
  const output: Record<string, JsonValue> = {};
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
      output[name] = endpointValue(endpoint, result.output) as JsonValue;
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
  return {
    status: cancelled ? "cancelled" : succeeded ? "succeeded" : "failed",
    graphHash: compilation.graphHash,
    ...(outputsComplete ? { output } : {}),
    nodes: nodeResults,
    failures,
    maxObservedConcurrency: observedConcurrency,
    totalAttempts,
  };
}
