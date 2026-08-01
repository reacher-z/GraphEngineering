import {
  compareUnicodeCodePoints,
  compileGraph,
  type EdgeSpec,
  type Endpoint,
  type GraphSpec,
  type NodeSpec,
} from "@graph-engineering/core";
import {
  PROTECTED_STORE_CONTRACT,
  PersistenceError,
  VersionConflictError,
  classifyLegacyHistory,
  legacyQuarantineManifest,
  type EventStore,
  type GraphEvent,
  type GraphEventV1Alpha2Type,
  type LegacyQuarantineManifest,
  type SemanticContext,
} from "@graph-engineering/persistence";
import {
  DURABLE_GRAPH_REVISION,
  ProtectedDurableRun,
  assertPayloadProtection,
  type DurableEventDraft,
  type DurablePayloadDraft,
  type RecoveredEvent,
} from "./durable-protection.js";
import {
  type SchedulerAttemptIdentity,
  type SchedulerInternalOptions,
  type SchedulerJournal,
  type SchedulerRunResult,
  runGraphWithJournal,
} from "./scheduler.js";
import { decodeDurableJson, durableJsonHash, encodeDurableJson } from "./durable-json.js";
import {
  DurableRunError,
  type DurableGraphRunResult,
  type DurableNodeExecutionContext,
  type DurableNodeExecutor,
  type DurableRunErrorCode,
  type DurableSchedulerOptions,
} from "./durable-types.js";
import { snapshotJson } from "./json.js";
import {
  graphRuntimeCapabilityIssues,
  runtimeCapabilityMessage,
} from "./runtime-capabilities.js";
import {
  assertExactRouteSelection,
  edgeConditionError,
  edgeIsActive,
  graphConditionCapabilityIssues,
} from "./router-runtime.js";
import type {
  GraphRunFailure,
  GraphRunResult,
  JsonValue,
  NodeRunFailure,
  NodeRunResult,
  SchedulerOptions,
} from "./types.js";

/**
 * The durable stream is `scheduler-recovery/v1alpha2`: every authoritative
 * application value is carried as a validated protected reference and the
 * journal never sees a plaintext payload (spec/redaction-semantics.md 6.1).
 */
const CONTRACT_VERSION = "scheduler-recovery/v1alpha2";
const GRAPH_REVISION = DURABLE_GRAPH_REVISION;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type JsonRecord = Record<string, JsonValue>;

interface CompiledDurableGraph {
  readonly graph: GraphSpec;
  readonly graphHash: string;
  readonly orderedNodeIds: readonly string[];
  readonly nodesById: ReadonlyMap<string, NodeSpec>;
  readonly incoming: ReadonlyMap<string, readonly EdgeSpec[]>;
  readonly outgoing: ReadonlyMap<string, readonly EdgeSpec[]>;
  readonly sequence: ReadonlyMap<string, number>;
  readonly declaration: ReadonlyMap<string, number>;
}

/**
 * One candidate scheduler event. `data` holds closed metadata only; every
 * application value travels in `payloads` as a detached argument so there is no
 * window in which a plaintext payload exists inside a record that could be
 * serialized (spec/redaction-semantics.md 7).
 */
interface EventDraft {
  readonly type: GraphEventV1Alpha2Type;
  readonly data: Readonly<JsonRecord>;
  readonly payloads?: readonly DurablePayloadDraft[];
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly attempt?: number;
}

function invalidHistory(
  runId: string,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
  options: ErrorOptions = {},
): DurableRunError {
  return new DurableRunError("INVALID_RUN_HISTORY", runId, message, details, options);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "unknown durable scheduler failure";
}

function compileDurableGraph(document: GraphSpec): CompiledDurableGraph | GraphRunResult {
  const compilation = compileGraph(document);
  if (!compilation.valid || compilation.graphHash === null || compilation.canonicalGraph === null) {
    const failures: GraphRunFailure[] = compilation.diagnostics
      .filter((item) => item.severity === "error")
      .map((item) => ({
        phase: "compile",
        code: item.code,
        message: item.message,
        diagnostic: item,
      }));
    return {
      status: "failed",
      graphHash: compilation.graphHash,
      nodes: [],
      failures,
      maxObservedConcurrency: 0,
      totalAttempts: 0,
    };
  }

  const graph = snapshotJson(JSON.parse(compilation.canonicalGraph)) as unknown as GraphSpec;
  const orderedNodeIds = compilation.topologicalLayers.flatMap((layer) => layer);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map(graph.nodes.map((node) => [node.id, [] as EdgeSpec[]]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as EdgeSpec[]]));
  for (const edge of graph.edges) {
    incoming.get(edge.to.node)?.push(edge);
    outgoing.get(edge.from.node)?.push(edge);
  }
  for (const edges of incoming.values()) {
    edges.sort((left, right) => compareUnicodeCodePoints(left.id, right.id));
  }
  for (const edges of outgoing.values()) {
    edges.sort((left, right) => compareUnicodeCodePoints(left.id, right.id));
  }
  return {
    graph,
    graphHash: compilation.graphHash,
    orderedNodeIds,
    nodesById,
    incoming,
    outgoing,
    sequence: new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index])),
    declaration: new Map(graph.nodes.map((node, index) => [node.id, index])),
  };
}

function isCompilationFailure(
  value: CompiledDurableGraph | GraphRunResult,
): value is GraphRunResult {
  return "status" in value;
}

function capabilityFailure(
  compiled: CompiledDurableGraph,
): DurableGraphRunResult | undefined {
  const runtimeIssues = graphRuntimeCapabilityIssues(compiled.graph);
  const conditionIssues = graphConditionCapabilityIssues(compiled.graph);
  if (runtimeIssues.length === 0 && conditionIssues.length === 0) return undefined;
  return {
    status: "failed",
    graphHash: compiled.graphHash,
    nodes: [],
    failures: [
      ...runtimeIssues.map((issue) => runtimeFailure(
        issue.ownerNodeId,
        "UNSUPPORTED_RUNTIME_CAPABILITY",
        runtimeCapabilityMessage(issue),
        0,
      )),
      ...conditionIssues.map(({ nodeId, messages }) => runtimeFailure(
        nodeId,
        "UNSUPPORTED_EDGE_CONDITION",
        messages.join("; "),
        0,
      )),
    ],
    maxObservedConcurrency: 0,
    totalAttempts: 0,
  };
}

function sideEffects(node: NodeSpec): "none" | "idempotent" | "non-idempotent" | "unspecified" {
  return node.sideEffects ?? "unspecified";
}

function effectiveAttemptLimit(graph: GraphSpec): number {
  return graph.policies?.maxTotalAttempts ?? Number.MAX_SAFE_INTEGER;
}

function assertDurableTimerBounds(graph: GraphSpec): void {
  for (const node of graph.nodes) {
    for (const [name, value] of [
      ["timeoutMs", node.timeoutMs],
      ["retry.initialDelayMs", node.retry?.initialDelayMs],
      ["retry.maxDelayMs", node.retry?.maxDelayMs],
    ] as const) {
      if (value !== undefined && value > MAX_TIMER_DELAY_MS) {
        throw new TypeError(
          `Node '${node.id}' ${name} exceeds the ${MAX_TIMER_DELAY_MS}ms durable timer limit`,
        );
      }
    }
  }
  const maxDurationMs = graph.policies?.maxDurationMs;
  if (typeof maxDurationMs === "number" && maxDurationMs > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`maxDurationMs exceeds the ${MAX_TIMER_DELAY_MS}ms durable timer limit`);
  }
}

function retryDelayMs(node: NodeSpec, failedAttempt: number): number {
  const initial = Math.max(0, node.retry?.initialDelayMs ?? 0);
  const multiplier = Math.max(1, node.retry?.backoffMultiplier ?? 1);
  const maximum = Math.max(initial, node.retry?.maxDelayMs ?? initial);
  return Math.min(maximum, initial * multiplier ** Math.max(0, failedAttempt - 1));
}

function strictDate(value: unknown, runId: string, context: string): Date {
  const match = typeof value === "string"
    ? /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value)
    : null;
  if (match === null) {
    throw invalidHistory(runId, `${context} must be a strict RFC 3339 timestamp`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || day > (daysInMonth[month - 1] as number)) {
    throw invalidHistory(runId, `${context} contains an invalid calendar date`);
  }
  const parsed = new Date(value as string);
  if (!Number.isFinite(parsed.getTime())) {
    throw invalidHistory(runId, `${context} is not a real timestamp`);
  }
  return parsed;
}

function addMilliseconds(date: Date, milliseconds: number): string {
  const result = new Date(date.getTime() + milliseconds);
  const year = result.getUTCFullYear();
  if (!Number.isFinite(result.getTime()) || year < 1 || year > 9999) {
    throw new RangeError("retry availability is outside four-digit RFC 3339 range");
  }
  return result.toISOString();
}

function failureDocument(failure: NodeRunFailure): JsonRecord {
  return {
    phase: failure.phase,
    code: failure.code,
    message: failure.message,
    nodeId: failure.nodeId,
    attempt: failure.attempt,
    retryable: failure.retryable,
    ...(failure.causeName === undefined ? {} : { causeName: failure.causeName }),
    ...(failure.upstreamNodeIds === undefined
      ? {}
      : { upstreamNodeIds: [...failure.upstreamNodeIds] }),
  };
}

/**
 * The closed inline projection of an attempt failure.
 *
 * spec/redaction-semantics.md 6.1: raw errors, stack traces, provider
 * responses, prompts, paths, and tool output are absent from `NodeAttemptFailed`;
 * only identifiers, attempts, stable structured codes, and the retry flag stay
 * inline. `message` and `causeName` are producer-derived text — a caught
 * exception string reaches this runtime verbatim — so they travel as protected
 * diagnostic evidence instead.
 */
function closedFailureProjection(failure: NodeRunFailure): JsonRecord {
  return {
    phase: failure.phase,
    code: failure.code,
    nodeId: failure.nodeId,
    attempt: failure.attempt,
    retryable: failure.retryable,
    ...(failure.upstreamNodeIds === undefined
      ? {}
      : { upstreamNodeIds: [...failure.upstreamNodeIds] }),
  };
}

function graphFailureDocument(failure: GraphRunFailure): JsonRecord {
  if (failure.phase === "execute") return failureDocument(failure);
  if (failure.phase === "output") {
    return {
      phase: "output",
      code: failure.code,
      message: failure.message,
      outputName: failure.outputName,
      nodeId: failure.nodeId,
      ...(failure.port === undefined ? {} : { port: failure.port }),
    };
  }
  return {
    phase: "compile",
    code: failure.code,
    message: failure.message,
    diagnostic: snapshotJson(failure.diagnostic),
  };
}

function nodeResultDocument(result: NodeRunResult): JsonRecord {
  return {
    nodeId: result.nodeId,
    sequence: result.sequence,
    status: result.status,
    attempts: result.attempts,
    ...(result.input === undefined ? {} : { input: result.input }),
    ...(result.output === undefined ? {} : { output: result.output }),
    ...(result.failure === undefined ? {} : { failure: failureDocument(result.failure) }),
  };
}

function resultDocument(result: SchedulerRunResult): JsonRecord {
  return snapshotJson({
    status: result.status,
    graphHash: result.graphHash,
    nodes: result.nodes.map(nodeResultDocument),
    failures: result.failures.map(graphFailureDocument),
    scheduledOrder: [...result.scheduledOrder],
    completionOrder: [...result.completionOrder],
    maxObservedConcurrency: result.maxObservedConcurrency,
    totalAttempts: result.totalAttempts,
    ...(result.output === undefined ? {} : { output: result.output }),
  }) as JsonRecord;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  runId: string,
  context: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw invalidHistory(runId, `${context} must be an object`);
  const actual = Object.keys(value).sort(compareUnicodeCodePoints);
  const expected = [...keys].sort(compareUnicodeCodePoints);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw invalidHistory(runId, `${context} has unexpected fields`, { expected, actual });
  }
}

function stringValue(value: unknown, runId: string, context: string): string {
  if (typeof value !== "string") throw invalidHistory(runId, `${context} must be a string`);
  return value;
}

function integerValue(
  value: unknown,
  runId: string,
  context: string,
  minimum = 0,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw invalidHistory(runId, `${context} must be a safe integer >= ${minimum}`);
  }
  return value as number;
}

function arrayValue(value: unknown, runId: string, context: string): readonly unknown[] {
  if (!Array.isArray(value)) throw invalidHistory(runId, `${context} must be an array`);
  return value;
}

function endpointValue(endpoint: Endpoint, value: JsonValue | undefined): JsonValue {
  if (endpoint.port === undefined) return value as JsonValue;
  if (typeof value !== "object" || value === null || !Object.hasOwn(value, endpoint.port)) {
    throw new Error(`Output from '${endpoint.node}' does not contain port '${endpoint.port}'`);
  }
  return (value as Readonly<Record<string, JsonValue>>)[endpoint.port] as JsonValue;
}

function defineJsonValue(target: Record<string, JsonValue>, key: string, value: JsonValue): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function bindInput(
  compiled: CompiledDurableGraph,
  nodeId: string,
  graphInput: JsonValue,
  results: ReadonlyMap<string, NodeRunResult>,
): JsonValue {
  const structuralIncoming = compiled.incoming.get(nodeId) ?? [];
  const incoming = structuralIncoming.filter((edge) => {
    const source = results.get(edge.from.node);
    return source === undefined || edgeIsActive(edge, source);
  });
  if (structuralIncoming.length === 0) return snapshotJson(graphInput);
  if (incoming.length === 0) {
    throw new Error(`Node '${nodeId}' has no active incoming route`);
  }
  const input = Object.create(null) as Record<string, JsonValue>;
  for (const edge of incoming) {
    const producer = results.get(edge.from.node);
    if (producer?.status !== "succeeded") {
      throw new Error(`Node '${nodeId}' is not ready because '${edge.from.node}' has not succeeded`);
    }
    const key = edge.to.port ?? edge.from.node;
    if (Object.hasOwn(input, key)) {
      throw new Error(`Node '${nodeId}' receives duplicate input key '${key}'`);
    }
    defineJsonValue(input, key, endpointValue(edge.from, producer.output));
  }
  return snapshotJson(input);
}

/**
 * The closed `failureCode` member of a zero-attempt settlement when the outcome
 * carries no failure at all (a skipped node). It is a stable runtime token, not
 * an application value.
 */
const SETTLED_WITHOUT_FAILURE = "SETTLED_WITHOUT_FAILURE";

function graphInputContext(runId: string): SemanticContext {
  return { kind: "graph-input", runId, graphRevision: GRAPH_REVISION };
}

function nodeContext(
  kind: "node-input" | "node-output" | "node-result",
  runId: string,
  nodeId: string,
): SemanticContext {
  return { kind, runId, graphRevision: GRAPH_REVISION, nodeId };
}

function runResultContext(runId: string): SemanticContext {
  return { kind: "run-result", runId, graphRevision: GRAPH_REVISION };
}

class DurableJournal implements SchedulerJournal {
  readonly compiled: CompiledDurableGraph;
  readonly runId: string;
  readonly run: ProtectedDurableRun;
  readonly now: () => Date;
  readonly createEventId: NonNullable<DurableSchedulerOptions["createEventId"]>;
  readonly preScheduled: Map<string, number>;
  readonly retryAvailableAt = new Map<string, string>();
  readonly activityKeys: Map<string, string>;
  readonly eventIds: Set<string>;

  version: number;
  #queue: Promise<void> = Promise.resolve();
  #fatal: unknown;

  constructor(fields: {
    compiled: CompiledDurableGraph;
    runId: string;
    run: ProtectedDurableRun;
    version: number;
    now: () => Date;
    createEventId: NonNullable<DurableSchedulerOptions["createEventId"]>;
    preScheduled?: ReadonlyMap<string, number>;
    activityKeys?: ReadonlyMap<string, string>;
    eventIds?: ReadonlySet<string>;
  }) {
    this.compiled = fields.compiled;
    this.runId = fields.runId;
    this.run = fields.run;
    this.version = fields.version;
    this.now = fields.now;
    this.createEventId = fields.createEventId;
    this.preScheduled = new Map(fields.preScheduled);
    this.activityKeys = new Map(fields.activityKeys);
    this.eventIds = new Set(fields.eventIds);
  }

  /** Section 8.2: the activity key is keyed by the run identity and the input MAC. */
  activityKey(nodeId: string, inputMac: string): string {
    return this.run.activityKey(nodeId, inputMac);
  }

  append(
    drafts: readonly EventDraft[],
    conflictCode: DurableRunErrorCode = "RESUME_CONFLICT",
  ): Promise<void> {
    const operation = this.#queue.then(async () => {
      if (this.#fatal !== undefined) throw this.#fatal;
      const expectedVersion = this.version;
      try {
        const batchIds = new Set<string>();
        const identifiers: string[] = [];
        for (const [index, draft] of drafts.entries()) {
          const sequence = expectedVersion + index + 1;
          const eventId = this.createEventId({ runId: this.runId, sequence, type: draft.type });
          if (this.eventIds.has(eventId) || batchIds.has(eventId)) {
            throw new DurableRunError(
              "DURABILITY_STORE_FAILED",
              this.runId,
              "event ID factory produced a duplicate identifier",
              { eventId, sequence },
            );
          }
          batchIds.add(eventId);
          identifiers.push(eventId);
        }
        const actual = await this.run.append(
          expectedVersion,
          drafts as readonly DurableEventDraft[],
          (sequence) => identifiers[sequence - expectedVersion - 1] as string,
          () => this.now().toISOString(),
        );
        const expected = expectedVersion + drafts.length;
        if (actual !== expected) {
          throw new DurableRunError(
            "DURABILITY_STORE_FAILED",
            this.runId,
            "event store returned an invalid last sequence",
            { expected, actual },
          );
        }
        this.version = actual;
        for (const eventId of batchIds) this.eventIds.add(eventId);
      } catch (error) {
        let mapped: DurableRunError;
        if (error instanceof DurableRunError) {
          mapped = error;
        } else if (error instanceof VersionConflictError) {
          mapped = new DurableRunError(
            conflictCode,
            this.runId,
            "durable append lost its expected-version comparison",
            error.details,
            { cause: error },
          );
        } else if (error instanceof PersistenceError) {
          mapped = new DurableRunError(
            "DURABILITY_STORE_FAILED",
            this.runId,
            "durable event append failed",
            { persistenceCode: error.code, ...error.details },
            { cause: error },
          );
        } else {
          mapped = new DurableRunError(
            "DURABILITY_STORE_FAILED",
            this.runId,
            "durable event append failed",
            { causeName: errorName(error) },
            { cause: error },
          );
        }
        this.#fatal = mapped;
        throw mapped;
      }
    });
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async beforeAttempt(fields: {
    graph: GraphSpec;
    node: NodeSpec;
    input: JsonValue;
    attempt: number;
    signal: AbortSignal;
  }): Promise<SchedulerAttemptIdentity> {
    const input = snapshotJson(fields.input);
    const context = nodeContext("node-input", this.runId, fields.node.id);
    const inputMac = this.run.valueMac(context, input);
    const activityKey = this.activityKey(fields.node.id, inputMac);
    this.activityKeys.set(fields.node.id, activityKey);
    const drafts: EventDraft[] = [];
    if (this.preScheduled.get(fields.node.id) !== fields.attempt) {
      drafts.push({
        type: "NodeScheduled",
        nodeId: fields.node.id,
        attempt: fields.attempt,
        data: { activityKey, sideEffects: sideEffects(fields.node) },
        payloads: [{ field: "inputRef", semanticContext: context, value: input }],
      });
    }
    this.preScheduled.delete(fields.node.id);
    drafts.push({
      type: "NodeStarted",
      nodeId: fields.node.id,
      attempt: fields.attempt,
      data: { inputMac, activityKey },
    });
    await this.append(drafts);
    return {
      runId: this.runId,
      attemptId: `${this.runId}/${fields.node.id}/${fields.attempt}`,
      activityKey,
    };
  }

  async attemptFailed(fields: {
    graph: GraphSpec;
    node: NodeSpec;
    input: JsonValue;
    failure: NodeRunFailure;
    identity: SchedulerAttemptIdentity;
    willRetry: boolean;
    retryDelayMs: number;
  }): Promise<void> {
    const drafts: EventDraft[] = [{
      type: "NodeAttemptFailed",
      nodeId: fields.node.id,
      attempt: fields.failure.attempt,
      data: {
        terminal: !fields.willRetry,
        failure: closedFailureProjection(fields.failure),
      },
      // Section 6.1: raw failure text is explicit protected diagnostic evidence
      // and is never scheduler authority.
      payloads: [{
        field: "evidenceRef",
        semanticContext: {
          kind: "diagnostic-evidence",
          runId: this.runId,
          graphRevision: GRAPH_REVISION,
          nodeId: fields.node.id,
          attempt: fields.failure.attempt,
          code: fields.failure.code,
        },
        value: failureDocument(fields.failure),
      }],
    }];
    if (fields.willRetry) {
      const activityKey = this.activityKeys.get(fields.node.id) ?? fields.identity.activityKey;
      if (activityKey.length === 0) {
        throw invalidHistory(this.runId, "retry lacks a stable activity key", {
          nodeId: fields.node.id,
          attempt: fields.failure.attempt,
        });
      }
      let availableAt: string;
      try {
        if (this.#fatal !== undefined) throw this.#fatal;
        availableAt = addMilliseconds(this.now(), fields.retryDelayMs);
      } catch (error) {
        const mapped = error instanceof DurableRunError
          ? error
          : new DurableRunError(
              "DURABILITY_STORE_FAILED",
              this.runId,
              "retry availability could not be represented as durable RFC 3339 time",
              { causeName: errorName(error), retryDelayMs: fields.retryDelayMs },
              { cause: error },
            );
        this.#fatal = mapped;
        throw mapped;
      }
      this.retryAvailableAt.set(fields.node.id, availableAt);
      drafts.push({
        type: "NodeRetried",
        nodeId: fields.node.id,
        attempt: fields.failure.attempt + 1,
        data: { availableAt, activityKey },
      });
    }
    await this.append(drafts);
  }

  async nodeSucceeded(fields: {
    graph: GraphSpec;
    node: NodeSpec;
    input: JsonValue;
    attempt: number;
    output: JsonValue;
    identity: SchedulerAttemptIdentity;
    outgoingEdges: readonly EdgeSpec[];
  }): Promise<void> {
    const inputMac = this.run.valueMac(
      nodeContext("node-input", this.runId, fields.node.id),
      snapshotJson(fields.input),
    );
    const outputContext = nodeContext("node-output", this.runId, fields.node.id);
    const output = snapshotJson(fields.output);
    const outputMac = this.run.valueMac(outputContext, output);
    const drafts: EventDraft[] = [{
      type: "NodeSucceeded",
      nodeId: fields.node.id,
      attempt: fields.attempt,
      data: { inputMac },
      payloads: [{ field: "outputRef", semanticContext: outputContext, value: output }],
    }];
    for (const edge of [...fields.outgoingEdges].sort((left, right) =>
      compareUnicodeCodePoints(left.id, right.id),
    )) {
      drafts.push({
        type: "EdgeEmitted",
        nodeId: fields.node.id,
        edgeId: edge.id,
        attempt: fields.attempt,
        data: { outputMac },
      });
    }
    await this.append(drafts);
  }

  async nodeSettledWithoutAttempt(fields: {
    graph: GraphSpec;
    node: NodeSpec;
    result: NodeRunResult;
  }): Promise<void> {
    const document = nodeResultDocument(fields.result);
    await this.append([{
      type: "NodeSettledWithoutAttempt",
      nodeId: fields.node.id,
      data: {
        status: fields.result.status,
        attempts: fields.result.attempts,
        failureCode: fields.result.failure?.code ?? SETTLED_WITHOUT_FAILURE,
      },
      payloads: [{
        field: "resultRef",
        semanticContext: nodeContext("node-result", this.runId, fields.node.id),
        value: document,
      }],
    }]);
  }

  async runTerminal(result: SchedulerRunResult): Promise<void> {
    const type: GraphEventV1Alpha2Type = result.status === "succeeded"
      ? "RunSucceeded"
      : result.status === "cancelled"
        ? "RunCancelled"
        : "RunFailed";
    await this.append([{
      type,
      data: { status: result.status },
      payloads: [{
        field: "resultRef",
        semanticContext: runResultContext(this.runId),
        value: resultDocument(result),
      }],
    }]);
  }
}

const RUNTIME_FAILURE_CODES = new Set<NodeRunFailure["code"]>([
  "EXECUTOR_NOT_FOUND",
  "NODE_EXECUTION_FAILED",
  "NODE_TIMEOUT",
  "NODE_CANCELLED",
  "INVALID_OUTPUT",
  "INVALID_ROUTE_SELECTION",
  "UNSUPPORTED_EDGE_CONDITION",
  "ROUTE_NOT_SELECTED",
  "UPSTREAM_FAILED",
  "INPUT_BINDING_FAILED",
  "ATTEMPT_BUDGET_EXHAUSTED",
  "NODE_EXECUTION_INTERRUPTED",
]);

function booleanValue(value: unknown, runId: string, context: string): boolean {
  if (typeof value !== "boolean") {
    throw invalidHistory(runId, `${context} must be a boolean`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  runId: string,
  context: string,
): string | undefined {
  return Object.hasOwn(record, key)
    ? stringValue(record[key], runId, `${context}.${key}`)
    : undefined;
}

function decodeFailure(value: unknown, runId: string, context: string): NodeRunFailure {
  if (!isRecord(value)) throw invalidHistory(runId, `${context} must be an object`);
  const required = ["phase", "code", "message", "nodeId", "attempt", "retryable"];
  const allowed = new Set([...required, "causeName", "upstreamNodeIds"]);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidHistory(runId, `${context} has invalid failure fields`);
  }
  if (value.phase !== "execute") {
    throw invalidHistory(runId, `${context}.phase must be 'execute'`);
  }
  const code = stringValue(value.code, runId, `${context}.code`);
  if (!RUNTIME_FAILURE_CODES.has(code as NodeRunFailure["code"])) {
    throw invalidHistory(runId, `${context}.code is unknown`, { code });
  }
  let upstreamNodeIds: string[] | undefined;
  if (Object.hasOwn(value, "upstreamNodeIds")) {
    upstreamNodeIds = arrayValue(value.upstreamNodeIds, runId, `${context}.upstreamNodeIds`)
      .map((item, index) => stringValue(item, runId, `${context}.upstreamNodeIds[${index}]`));
    if (new Set(upstreamNodeIds).size !== upstreamNodeIds.length) {
      throw invalidHistory(runId, `${context}.upstreamNodeIds contains duplicates`);
    }
  }
  const causeName = optionalString(value, "causeName", runId, context);
  return {
    phase: "execute",
    code: code as NodeRunFailure["code"],
    message: stringValue(value.message, runId, `${context}.message`),
    nodeId: stringValue(value.nodeId, runId, `${context}.nodeId`),
    attempt: integerValue(value.attempt, runId, `${context}.attempt`),
    retryable: booleanValue(value.retryable, runId, `${context}.retryable`),
    ...(causeName === undefined ? {} : { causeName }),
    ...(upstreamNodeIds === undefined ? {} : { upstreamNodeIds }),
  };
}

function decodeOutputFailure(
  value: unknown,
  runId: string,
  context: string,
): Extract<GraphRunFailure, { phase: "output" }> {
  if (!isRecord(value)) throw invalidHistory(runId, `${context} must be an object`);
  const required = ["phase", "code", "message", "outputName", "nodeId"];
  const allowed = new Set([...required, "port"]);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !allowed.has(key)) ||
      value.phase !== "output" || value.code !== "OUTPUT_BINDING_FAILED") {
    throw invalidHistory(runId, `${context} has invalid output-failure fields`);
  }
  const port = optionalString(value, "port", runId, context);
  return {
    phase: "output",
    code: "OUTPUT_BINDING_FAILED",
    message: stringValue(value.message, runId, `${context}.message`),
    outputName: stringValue(value.outputName, runId, `${context}.outputName`),
    nodeId: stringValue(value.nodeId, runId, `${context}.nodeId`),
    ...(port === undefined ? {} : { port }),
  };
}

function decodeNodeResult(value: unknown, runId: string, context: string): NodeRunResult {
  if (!isRecord(value)) throw invalidHistory(runId, `${context} must be an object`);
  const required = ["nodeId", "sequence", "status", "attempts"];
  const allowed = new Set([...required, "input", "output", "failure"]);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidHistory(runId, `${context} has invalid node-result fields`);
  }
  const status = stringValue(value.status, runId, `${context}.status`);
  if (status !== "succeeded" && status !== "failed" && status !== "skipped") {
    throw invalidHistory(runId, `${context}.status is unknown`);
  }
  const hasOutput = Object.hasOwn(value, "output");
  const hasFailure = Object.hasOwn(value, "failure");
  if ((status === "succeeded") !== hasOutput || (status === "succeeded") === hasFailure) {
    throw invalidHistory(runId, `${context} has an incoherent outcome shape`);
  }
  return {
    nodeId: stringValue(value.nodeId, runId, `${context}.nodeId`),
    sequence: integerValue(value.sequence, runId, `${context}.sequence`),
    status,
    attempts: integerValue(value.attempts, runId, `${context}.attempts`),
    ...(Object.hasOwn(value, "input") ? { input: snapshotJson(value.input) } : {}),
    ...(hasOutput ? { output: snapshotJson(value.output) } : {}),
    ...(hasFailure ? { failure: decodeFailure(value.failure, runId, `${context}.failure`) } : {}),
  };
}

interface DecodedTerminalResult extends SchedulerRunResult {}

function decodeTerminalResult(
  value: unknown,
  runId: string,
  compiled: CompiledDurableGraph,
): DecodedTerminalResult {
  if (!isRecord(value)) throw invalidHistory(runId, "terminal result must be an object");
  const required = [
    "status", "graphHash", "nodes", "failures", "scheduledOrder", "completionOrder",
    "maxObservedConcurrency", "totalAttempts",
  ];
  const allowed = new Set([...required, "output"]);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !allowed.has(key))) {
    throw invalidHistory(runId, "terminal result has invalid fields");
  }
  const status = stringValue(value.status, runId, "terminal result.status");
  if (status !== "succeeded" && status !== "failed" && status !== "cancelled") {
    throw invalidHistory(runId, "terminal result status is unknown");
  }
  const graphHash = stringValue(value.graphHash, runId, "terminal result.graphHash");
  if (graphHash !== compiled.graphHash) {
    throw invalidHistory(runId, "terminal result graph hash is inconsistent");
  }
  const nodes = arrayValue(value.nodes, runId, "terminal result.nodes")
    .map((item, index) => decodeNodeResult(item, runId, `terminal result.nodes[${index}]`));
  if (nodes.length !== compiled.orderedNodeIds.length ||
      nodes.some((item, index) => item.nodeId !== compiled.orderedNodeIds[index])) {
    throw invalidHistory(runId, "terminal result nodes are not in topological order");
  }
  const failures = arrayValue(value.failures, runId, "terminal result.failures")
    .map((item, index) => {
      if (!isRecord(item)) throw invalidHistory(runId, `terminal result.failures[${index}] must be an object`);
      return item.phase === "execute"
        ? decodeFailure(item, runId, `terminal result.failures[${index}]`)
        : decodeOutputFailure(item, runId, `terminal result.failures[${index}]`);
    });
  const stringArray = (field: "scheduledOrder" | "completionOrder"): string[] =>
    arrayValue(value[field], runId, `terminal result.${field}`)
      .map((item, index) => stringValue(item, runId, `terminal result.${field}[${index}]`));
  const output = Object.hasOwn(value, "output")
    ? snapshotJson(value.output) as JsonRecord
    : undefined;
  if (output !== undefined && !isRecord(output)) {
    throw invalidHistory(runId, "terminal result.output must be an object");
  }
  return {
    status,
    graphHash,
    nodes,
    failures,
    scheduledOrder: stringArray("scheduledOrder"),
    completionOrder: stringArray("completionOrder"),
    maxObservedConcurrency: integerValue(
      value.maxObservedConcurrency, runId, "terminal result.maxObservedConcurrency",
    ),
    totalAttempts: integerValue(value.totalAttempts, runId, "terminal result.totalAttempts"),
    ...(output === undefined ? {} : { output }),
  };
}

interface NodeProjection {
  readonly nodeId: string;
  input: JsonValue | undefined;
  inputMac: string | undefined;
  activityKey: string | undefined;
  sideEffects: ReturnType<typeof sideEffects> | undefined;
  scheduledAttempt: number | undefined;
  openAttempt: number | undefined;
  retryAttempt: number | undefined;
  retryAvailableAt: string | undefined;
  retryReserved: boolean;
  attempts: number;
  result: NodeRunResult | undefined;
  outputMac: string | undefined;
}

interface FoldedRun {
  readonly graphInput: JsonValue;
  readonly graphHash: string;
  readonly inputMac: string;
  readonly implementationHash: string;
  readonly maxTotalAttempts: number;
  readonly projections: ReadonlyMap<string, NodeProjection>;
  readonly totalAttempts: number;
  readonly scheduledOrder: readonly string[];
  readonly completionOrder: readonly string[];
  readonly maxObservedConcurrency: number;
  readonly terminalResult: DecodedTerminalResult | undefined;
  readonly eventIds: ReadonlySet<string>;
  readonly version: number;
}

function maxNodeAttempts(node: NodeSpec): number {
  return node.retry?.maxAttempts ?? 1;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(encodeDurableJson(left)) === JSON.stringify(encodeDurableJson(right));
}

function sameSettledResultSemantics(left: NodeRunResult, right: NodeRunResult): boolean {
  const normalize = (result: NodeRunResult): JsonRecord => {
    const document = nodeResultDocument(result);
    if (result.failure === undefined) return document;
    const failure = failureDocument(result.failure);
    delete failure.message;
    delete failure.causeName;
    return { ...document, failure };
  };
  return sameJson(normalize(left), normalize(right));
}

function sameTerminalFailures(
  left: readonly GraphRunFailure[],
  right: readonly GraphRunFailure[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((failure, index) => {
    const expected = right[index] as GraphRunFailure;
    if (failure.phase !== expected.phase) return false;
    if (failure.phase !== "output" || expected.phase !== "output") {
      return sameJson(graphFailureDocument(failure), graphFailureDocument(expected));
    }
    return failure.code === expected.code &&
      failure.outputName === expected.outputName &&
      failure.nodeId === expected.nodeId &&
      failure.port === expected.port;
  });
}

function eventNode(
  event: RecoveredEvent,
  compiled: CompiledDurableGraph,
  runId: string,
): string {
  if (event.nodeId === undefined || !compiled.nodesById.has(event.nodeId)) {
    throw invalidHistory(runId, `${event.type} references an unknown node`);
  }
  return event.nodeId;
}

function eventAttempt(event: RecoveredEvent, runId: string): number {
  if (event.attempt === undefined) {
    throw invalidHistory(runId, `${event.type} requires an attempt`);
  }
  return event.attempt;
}

function noEventIdentity(event: RecoveredEvent, runId: string): void {
  if (event.nodeId !== undefined || event.edgeId !== undefined || event.attempt !== undefined) {
    throw invalidHistory(runId, `${event.type} has unexpected node, edge, or attempt identity`);
  }
}

function declarationOrder(
  values: readonly string[],
  compiled: CompiledDurableGraph,
): readonly string[] {
  return [...values].sort((left, right) =>
    (compiled.declaration.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (compiled.declaration.get(right) ?? Number.MAX_SAFE_INTEGER));
}

function runtimeFailure(
  nodeId: string,
  code: NodeRunFailure["code"],
  message: string,
  attempt: number,
  fields: Partial<Pick<NodeRunFailure, "retryable" | "causeName" | "upstreamNodeIds">> = {},
): NodeRunFailure {
  return {
    phase: "execute",
    nodeId,
    code,
    message,
    attempt,
    retryable: fields.retryable ?? false,
    ...(fields.causeName === undefined ? {} : { causeName: fields.causeName }),
    ...(fields.upstreamNodeIds === undefined ? {} : { upstreamNodeIds: fields.upstreamNodeIds }),
  };
}

function assertPermutation(
  order: readonly string[],
  compiled: CompiledDurableGraph,
  runId: string,
  name: string,
): void {
  if (order.length !== compiled.orderedNodeIds.length ||
      new Set(order).size !== order.length ||
      order.some((nodeId) => !compiled.nodesById.has(nodeId))) {
    throw invalidHistory(runId, `terminal ${name} is not a node permutation`);
  }
}

function reconstructTerminalNodes(fields: {
  runId: string;
  terminalType: "RunSucceeded" | "RunFailed" | "RunCancelled";
  terminal: DecodedTerminalResult;
  compiled: CompiledDurableGraph;
  projections: ReadonlyMap<string, NodeProjection>;
  graphInput: JsonValue;
  totalAttempts: number;
}): Map<string, NodeRunResult> {
  const { runId, terminal, compiled, projections } = fields;
  const expected = new Map<string, NodeRunResult>();
  for (const nodeId of compiled.orderedNodeIds) {
    const projection = projections.get(nodeId) as NodeProjection;
    if (projection.result === undefined) {
      throw invalidHistory(runId, "terminal result contains a node with no committed outcome", {
        nodeId,
      });
    }
    expected.set(nodeId, projection.result);
  }
  for (const terminalNode of terminal.nodes) {
    const committed = expected.get(terminalNode.nodeId) as NodeRunResult;
    if (!sameJson(nodeResultDocument(terminalNode), nodeResultDocument(committed))) {
      throw invalidHistory(runId, "terminal result contradicts folded node history", {
        nodeId: terminalNode.nodeId,
      });
    }
  }
  return expected;
}

function validateTerminalResult(fields: {
  runId: string;
  terminalType: "RunSucceeded" | "RunFailed" | "RunCancelled";
  terminal: DecodedTerminalResult;
  compiled: CompiledDurableGraph;
  projections: ReadonlyMap<string, NodeProjection>;
  graphInput: JsonValue;
  scheduledOrder: readonly string[];
  completionOrder: readonly string[];
  maxObservedConcurrency: number;
  totalAttempts: number;
}): void {
  const {
    runId, terminalType, terminal, compiled, projections, graphInput, scheduledOrder,
    completionOrder, maxObservedConcurrency, totalAttempts,
  } = fields;
  const expectedStatus = terminalType === "RunSucceeded"
    ? "succeeded"
    : terminalType === "RunCancelled" ? "cancelled" : "failed";
  if (terminal.status !== expectedStatus) {
    throw invalidHistory(runId, "terminal event and result status disagree");
  }
  if (terminal.totalAttempts !== totalAttempts) {
    throw invalidHistory(runId, "terminal result attempt count is inconsistent");
  }
  if (terminal.maxObservedConcurrency !== maxObservedConcurrency) {
    throw invalidHistory(runId, "terminal max concurrency contradicts event history");
  }
  if ([...projections.values()].some((item) => item.openAttempt !== undefined)) {
    throw invalidHistory(runId, "terminal event leaves an attempt open");
  }
  const expectedNodes = reconstructTerminalNodes({
    runId, terminalType, terminal, compiled, projections, graphInput, totalAttempts,
  });
  const failures: GraphRunFailure[] = [];
  for (const nodeId of compiled.orderedNodeIds) {
    const failure = expectedNodes.get(nodeId)?.failure;
    if (failure !== undefined && failure.code !== "ROUTE_NOT_SELECTED") failures.push(failure);
  }
  const output = Object.create(null) as Record<string, JsonValue>;
  let outputsComplete = true;
  for (const [name, endpoint] of Object.entries(compiled.graph.outputs)
    .sort(([left], [right]) => compareUnicodeCodePoints(left, right))) {
    const result = expectedNodes.get(endpoint.node);
    if (result?.status !== "succeeded") {
      outputsComplete = false;
      continue;
    }
    try {
      defineJsonValue(output, name, snapshotJson(endpointValue(endpoint, result.output)));
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
  if ((terminal.output === undefined) !== !outputsComplete ||
      (terminal.output !== undefined && !sameJson(terminal.output, output))) {
    throw invalidHistory(runId, "terminal output contradicts committed node outputs");
  }
  if (!sameTerminalFailures(terminal.failures, failures)) {
    throw invalidHistory(runId, "terminal failures contradict folded node outcomes");
  }
  assertPermutation(terminal.scheduledOrder, compiled, runId, "scheduledOrder");
  assertPermutation(terminal.completionOrder, compiled, runId, "completionOrder");
  if (JSON.stringify(terminal.scheduledOrder) !== JSON.stringify(scheduledOrder) ||
      JSON.stringify(terminal.completionOrder) !== JSON.stringify(completionOrder)) {
    throw invalidHistory(runId, "terminal node orders contradict event order");
  }
  const succeeded = failures.length === 0 && outputsComplete &&
    [...expectedNodes.values()].every((item) =>
      item.status === "succeeded" || item.failure?.code === "ROUTE_NOT_SELECTED");
  if ((terminal.status === "succeeded") !== succeeded && terminal.status !== "cancelled") {
    throw invalidHistory(runId, "terminal status contradicts reconstructed graph result");
  }
}

function validateSettledWithoutAttempt(fields: {
  runId: string;
  compiled: CompiledDurableGraph;
  graphInput: JsonValue;
  projections: ReadonlyMap<string, NodeProjection>;
  projection: NodeProjection;
  result: NodeRunResult;
  totalAttempts: number;
  maxTotalAttempts: number;
  pendingRetryReservations: number;
}): void {
  const {
    runId, compiled, graphInput, projections, projection, result, totalAttempts,
    maxTotalAttempts, pendingRetryReservations,
  } = fields;
  const nodeId = projection.nodeId;
  const node = compiled.nodesById.get(nodeId) as NodeSpec;
  if (result.nodeId !== nodeId || result.sequence !== compiled.sequence.get(nodeId) ||
      result.attempts !== projection.attempts || result.status === "succeeded" ||
      result.failure === undefined || result.failure.nodeId !== nodeId ||
      result.failure.attempt !== projection.attempts) {
    throw invalidHistory(runId, "NodeSettledWithoutAttempt result identity is invalid", { nodeId });
  }
  const committed = new Map<string, NodeRunResult>();
  for (const [id, item] of projections) {
    if (item.result !== undefined) committed.set(id, item.result);
  }
  const incoming = compiled.incoming.get(nodeId) ?? [];
  const unresolvedUpstream = [...new Set(incoming
    .map((edge) => edge.from.node)
    .filter((upstreamId) => !committed.has(upstreamId)))]
    .sort(compareUnicodeCodePoints);
  if (unresolvedUpstream.length > 0) {
    throw invalidHistory(
      runId,
      "NodeSettledWithoutAttempt was emitted before every dependency settled",
      { nodeId, unresolvedUpstreamNodeIds: unresolvedUpstream },
    );
  }
  const activeIncoming = incoming.filter((edge) =>
    edgeIsActive(edge, committed.get(edge.from.node) as NodeRunResult));
  const failedUpstream = [...new Set(activeIncoming
    .map((edge) => edge.from.node)
    .filter((upstreamId) => committed.get(upstreamId)?.status !== "succeeded"))]
    .sort(compareUnicodeCodePoints);

  let expected: NodeRunResult | undefined;
  const conditionIssues = (compiled.outgoing.get(nodeId) ?? [])
    .flatMap((edge) => {
      const issue = edgeConditionError(edge, node);
      return issue === undefined ? [] : [issue];
    });
  if (conditionIssues.length > 0) {
    expected = {
      nodeId,
      sequence: compiled.sequence.get(nodeId) as number,
      status: "failed",
      attempts: projection.attempts,
      failure: runtimeFailure(
        nodeId,
        "UNSUPPORTED_EDGE_CONDITION",
        conditionIssues.join("; "),
        projection.attempts,
      ),
    };
  } else if (incoming.length > 0 && activeIncoming.length === 0) {
    expected = {
      nodeId,
      sequence: compiled.sequence.get(nodeId) as number,
      status: "skipped",
      attempts: projection.attempts,
      failure: runtimeFailure(
        nodeId,
        "ROUTE_NOT_SELECTED",
        `Node '${nodeId}' did not start because no incoming route was selected`,
        projection.attempts,
      ),
    };
  } else if (result.failure.code === "NODE_CANCELLED") {
    if (result.status === "skipped") {
      expected = {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "skipped",
        attempts: projection.attempts,
        failure: runtimeFailure(
          nodeId,
          "NODE_CANCELLED",
          `Node '${nodeId}' did not start because the run was cancelled`,
          projection.attempts,
        ),
      };
    } else {
      let input: JsonValue;
      try {
        input = bindInput(compiled, nodeId, graphInput, committed);
      } catch (error) {
        throw invalidHistory(runId, "cancelled node did not have bindable input", { nodeId }, { cause: error });
      }
      expected = {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "failed",
        attempts: projection.attempts,
        input,
        failure: runtimeFailure(
          nodeId, "NODE_CANCELLED", `Node '${nodeId}' was cancelled`, projection.attempts,
        ),
      };
    }
  } else if (failedUpstream.length > 0) {
    expected = {
      nodeId,
      sequence: compiled.sequence.get(nodeId) as number,
      status: "skipped",
      attempts: projection.attempts,
      failure: runtimeFailure(
        nodeId,
        "UPSTREAM_FAILED",
        `Node '${nodeId}' did not start because upstream nodes failed: ${failedUpstream.join(", ")}`,
        projection.attempts,
        { upstreamNodeIds: failedUpstream },
      ),
    };
  } else {
    let input: JsonValue | undefined;
    let bindingError: unknown;
    try {
      input = bindInput(compiled, nodeId, graphInput, committed);
    } catch (error) {
      bindingError = error;
    }
    if (bindingError !== undefined) {
      expected = {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "failed",
        attempts: projection.attempts,
        failure: runtimeFailure(
          nodeId,
          "INPUT_BINDING_FAILED",
          `Could not bind input for node '${nodeId}': ${errorMessage(bindingError)}`,
          projection.attempts,
          { causeName: errorName(bindingError) },
        ),
      };
    } else if (result.failure.code === "EXECUTOR_NOT_FOUND") {
      expected = {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "failed",
        attempts: projection.attempts,
        input: input as JsonValue,
        failure: runtimeFailure(
          nodeId,
          "EXECUTOR_NOT_FOUND",
          `No executor is registered for node '${nodeId}' (kind '${node.kind}')`,
          projection.attempts,
        ),
      };
    } else if (projection.attempts >= maxNodeAttempts(node)) {
      expected = {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "failed",
        attempts: projection.attempts,
        input: input as JsonValue,
        failure: runtimeFailure(
          nodeId,
          "ATTEMPT_BUDGET_EXHAUSTED",
          `Node '${nodeId}' has exhausted its durable attempt budget`,
          projection.attempts,
        ),
      };
    } else if (totalAttempts + pendingRetryReservations >= maxTotalAttempts) {
      expected = {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "failed",
        attempts: projection.attempts,
        input: input as JsonValue,
        failure: runtimeFailure(
          nodeId,
          "ATTEMPT_BUDGET_EXHAUSTED",
          `Run attempt budget was exhausted before node '${nodeId}' could start`,
          projection.attempts,
        ),
      };
    }
  }
  if (expected === undefined || !sameSettledResultSemantics(result, expected)) {
    throw invalidHistory(runId, "NodeSettledWithoutAttempt result is not scheduler-derived", {
      nodeId,
      code: result.failure.code,
    });
  }
}

function foldHistory(
  events: readonly RecoveredEvent[],
  fields: {
    compiled: CompiledDurableGraph;
    runId: string;
    implementationHash: string;
    run: ProtectedDurableRun;
  },
): FoldedRun {
  const { compiled, runId, implementationHash, run } = fields;
  if (events.length === 0) {
    throw new DurableRunError("RUN_NOT_FOUND", runId, "durable run does not exist");
  }
  const projections = new Map<string, NodeProjection>(compiled.graph.nodes.map((node) => [
    node.id,
    {
      nodeId: node.id,
      input: undefined,
      inputMac: undefined,
      activityKey: undefined,
      sideEffects: undefined,
      scheduledAttempt: undefined,
      openAttempt: undefined,
      retryAttempt: undefined,
      retryAvailableAt: undefined,
      retryReserved: false,
      attempts: 0,
      result: undefined,
      outputMac: undefined,
    },
  ]));
  let graphInput: JsonValue = null;
  let storedGraphHash = "";
  let storedInputMac = "";
  let storedImplementationHash = "";
  let maxTotalAttempts = 0;
  let started = false;
  let terminalResult: DecodedTerminalResult | undefined;
  let terminalSeen = false;
  const scheduledOrder: string[] = [];
  const completionOrder: string[] = [];
  const active = new Set<string>();
  const pendingRetryReservations = new Set<string>();
  let maxObservedConcurrency = 0;
  let totalAttempts = 0;
  let expectedEdges: Array<{
    edgeId: string;
    producerId: string;
    attempt: number;
    outputMac: string;
  }> = [];
  let expectedRetry: { nodeId: string; attempt: number; activityKey: string } | undefined;
  const eventIds = new Set<string>();

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] as RecoveredEvent;
    strictDate(event.timestamp, runId, `event[${index}].timestamp`);
    if (event.sequence !== index || event.runId !== runId) {
      throw invalidHistory(runId, "event identity or sequence is inconsistent", { sequence: index });
    }
    if (event.graphRevision !== GRAPH_REVISION) {
      throw invalidHistory(runId, "event graph revision is not 1", { sequence: index });
    }
    if (eventIds.has(event.eventId)) {
      throw invalidHistory(runId, "eventId is duplicated", { eventId: event.eventId });
    }
    eventIds.add(event.eventId);
    // Envelope integrity — payload hash, sequence contiguity, closed shape, and
    // capture-policy continuity — is enforced by the guarded v1alpha2 journal
    // before a record is ever handed to this fold. What remains here is the
    // scheduler semantics the journal cannot know about.
    if (terminalSeen) {
      throw invalidHistory(runId, "event appears after a terminal event", { sequence: index });
    }

    if (expectedEdges.length > 0) {
      const expected = expectedEdges.shift() as (typeof expectedEdges)[number];
      if (event.type !== "EdgeEmitted" || event.edgeId !== expected.edgeId ||
          event.nodeId !== expected.producerId || event.attempt !== expected.attempt) {
        throw invalidHistory(
          runId,
          "NodeSucceeded is not followed by its ordered EdgeEmitted batch",
          { sequence: index, expectedEdgeId: expected.edgeId },
        );
      }
      exactKeys(event.data, ["outputMac"], runId, "EdgeEmitted.data");
      if (event.data.outputMac !== expected.outputMac) {
        throw invalidHistory(runId, "EdgeEmitted output MAC is invalid");
      }
      continue;
    }

    if (expectedRetry !== undefined) {
      if (event.type !== "NodeRetried" || event.nodeId !== expectedRetry.nodeId ||
          event.attempt !== expectedRetry.attempt || event.edgeId !== undefined) {
        throw invalidHistory(
          runId,
          "retryable NodeAttemptFailed is not followed by NodeRetried",
          { sequence: index },
        );
      }
      exactKeys(event.data, ["availableAt", "activityKey"], runId, "NodeRetried.data");
      const availableAt = stringValue(event.data.availableAt, runId, "NodeRetried.availableAt");
      strictDate(availableAt, runId, "NodeRetried.availableAt");
      if (event.data.activityKey !== expectedRetry.activityKey) {
        throw invalidHistory(runId, "NodeRetried activity key is invalid");
      }
      const projection = projections.get(expectedRetry.nodeId) as NodeProjection;
      const node = compiled.nodesById.get(expectedRetry.nodeId) as NodeSpec;
      if (expectedRetry.attempt > maxNodeAttempts(node)) {
        throw invalidHistory(runId, "NodeRetried exceeds the node retry budget", {
          nodeId: node.id, attempt: expectedRetry.attempt,
        });
      }
      if (totalAttempts + pendingRetryReservations.size >= maxTotalAttempts) {
        throw invalidHistory(runId, "NodeRetried is not eligible under the global attempt budget", {
          nodeId: node.id, attempt: expectedRetry.attempt,
        });
      }
      projection.retryAttempt = expectedRetry.attempt;
      projection.retryAvailableAt = availableAt;
      projection.retryReserved = true;
      pendingRetryReservations.add(expectedRetry.nodeId);
      expectedRetry = undefined;
      continue;
    }

    if (index === 0) {
      if (event.type !== "RunCreated") {
        throw invalidHistory(runId, "RunCreated must be the first event");
      }
      noEventIdentity(event, runId);
      exactKeys(event.data, [
        "contractVersion", "graphHash", "implementationHash", "capturePolicyHash",
        "protectedStoreContract", "keyRefHash", "input", "inputMac", "maxTotalAttempts",
      ], runId, "RunCreated.data");
      if (event.data.contractVersion !== CONTRACT_VERSION) {
        throw invalidHistory(runId, "RunCreated contract version is incompatible");
      }
      // Section 4.4: resume must resolve the policy again and match the hash
      // exactly; a policy change on resume is CAPTURE_POLICY_MISMATCH.
      run.assertPolicyHash(event.data.capturePolicyHash);
      if (event.data.protectedStoreContract !== PROTECTED_STORE_CONTRACT) {
        throw invalidHistory(runId, "RunCreated protected-store contract is incompatible", {
          expected: PROTECTED_STORE_CONTRACT,
        });
      }
      if (event.data.keyRefHash !== run.keyRefHash) {
        throw new DurableRunError(
          "PROTECTED_PAYLOAD_UNAUTHORIZED",
          runId,
          "durable run was created under a different key reference",
        );
      }
      storedGraphHash = stringValue(event.data.graphHash, runId, "RunCreated.graphHash");
      storedImplementationHash = stringValue(
        event.data.implementationHash, runId, "RunCreated.implementationHash",
      );
      storedInputMac = stringValue(event.data.inputMac, runId, "RunCreated.inputMac");
      maxTotalAttempts = integerValue(
        event.data.maxTotalAttempts, runId, "RunCreated.maxTotalAttempts", 1,
      );
      try {
        graphInput = decodeDurableJson(event.data.input);
      } catch (error) {
        throw new DurableRunError(
          "INPUT_HASH_MISMATCH",
          runId,
          "stored graph input is not valid Durable JSON",
          {},
          { cause: error },
        );
      }
      if (run.valueMac(graphInputContext(runId), graphInput) !== storedInputMac) {
        throw new DurableRunError(
          "INPUT_HASH_MISMATCH", runId, "stored graph input does not match inputMac",
        );
      }
      if (storedGraphHash !== compiled.graphHash) {
        throw new DurableRunError(
          "GRAPH_HASH_MISMATCH",
          runId,
          "compiled graph does not match the durable run",
          { expected: storedGraphHash, actual: compiled.graphHash },
        );
      }
      if (storedImplementationHash !== implementationHash) {
        throw new DurableRunError(
          "IMPLEMENTATION_MISMATCH",
          runId,
          "implementationId does not match the durable run",
          { expected: storedImplementationHash, actual: implementationHash },
        );
      }
      if (maxTotalAttempts !== effectiveAttemptLimit(compiled.graph)) {
        throw invalidHistory(runId, "stored attempt budget is inconsistent with graph");
      }
      continue;
    }

    if (event.type === "RunCreated") {
      throw invalidHistory(runId, "RunCreated appears more than once", { sequence: index });
    }
    if (event.type === "RunStarted") {
      noEventIdentity(event, runId);
      if (started || index !== 1 || Object.keys(event.data).length !== 0) {
        throw invalidHistory(runId, "RunStarted is duplicate, misplaced, or non-empty");
      }
      started = true;
      continue;
    }
    if (!started) {
      throw invalidHistory(runId, "lifecycle event appears before RunStarted");
    }

    if (event.type === "RunResumed") {
      noEventIdentity(event, runId);
      exactKeys(event.data, ["reusedNodeIds", "interruptedNodeIds"], runId, "RunResumed.data");
      const decodeNodeList = (field: "reusedNodeIds" | "interruptedNodeIds"): string[] => {
        const values = arrayValue(event.data[field], runId, `RunResumed.${field}`)
          .map((item, itemIndex) => stringValue(item, runId, `RunResumed.${field}[${itemIndex}]`));
        if (values.some((nodeId) => !compiled.nodesById.has(nodeId)) ||
            new Set(values).size !== values.length ||
            JSON.stringify(values) !== JSON.stringify(declarationOrder(values, compiled))) {
          throw invalidHistory(runId, `RunResumed.${field} is invalid or out of declaration order`);
        }
        return values;
      };
      const reused = decodeNodeList("reusedNodeIds");
      const interrupted = decodeNodeList("interruptedNodeIds");
      if (reused.some((nodeId) => interrupted.includes(nodeId))) {
        throw invalidHistory(runId, "RunResumed node lists overlap");
      }
      const expectedReused = declarationOrder(
        [...projections.values()]
          .filter((item) => item.result?.status === "succeeded")
          .map((item) => item.nodeId),
        compiled,
      );
      const expectedInterrupted = declarationOrder(
        [...projections.values()]
          .filter((item) => item.openAttempt !== undefined)
          .map((item) => item.nodeId),
        compiled,
      );
      if (JSON.stringify(reused) !== JSON.stringify(expectedReused)) {
        throw invalidHistory(runId, "RunResumed reusedNodeIds contradict history");
      }
      if (JSON.stringify(interrupted) !== JSON.stringify(expectedInterrupted)) {
        throw invalidHistory(runId, "RunResumed interruptedNodeIds contradict history");
      }
      continue;
    }

    if (event.type === "NodeSettledWithoutAttempt") {
      if (event.edgeId !== undefined || event.attempt !== undefined) {
        throw invalidHistory(runId, "NodeSettledWithoutAttempt must omit edgeId and attempt");
      }
      const nodeId = eventNode(event, compiled, runId);
      const projection = projections.get(nodeId) as NodeProjection;
      if (projection.openAttempt !== undefined || projection.result !== undefined) {
        throw invalidHistory(runId, "NodeSettledWithoutAttempt targets an open or settled node", {
          nodeId,
        });
      }
      exactKeys(
        event.data,
        ["result", "resultMac", "status", "attempts", "failureCode"],
        runId,
        "NodeSettledWithoutAttempt.data",
      );
      let decodedResult: JsonValue;
      try {
        decodedResult = decodeDurableJson(event.data.result);
      } catch (error) {
        throw invalidHistory(
          runId, "NodeSettledWithoutAttempt result is malformed", {}, { cause: error },
        );
      }
      if (run.valueMac(nodeContext("node-result", runId, nodeId), decodedResult) !==
          event.data.resultMac) {
        throw invalidHistory(runId, "NodeSettledWithoutAttempt resultMac is invalid", { nodeId });
      }
      const result = decodeNodeResult(
        decodedResult, runId, "NodeSettledWithoutAttempt.result",
      );
      // The closed inline projection must agree with the protected result.
      if (event.data.status !== result.status || event.data.attempts !== result.attempts ||
          event.data.failureCode !== (result.failure?.code ?? SETTLED_WITHOUT_FAILURE)) {
        throw invalidHistory(
          runId,
          "NodeSettledWithoutAttempt metadata contradicts its protected result",
          { nodeId },
        );
      }
      pendingRetryReservations.delete(nodeId);
      projection.retryReserved = false;
      validateSettledWithoutAttempt({
        runId,
        compiled,
        graphInput,
        projections,
        projection,
        result,
        totalAttempts,
        maxTotalAttempts,
        pendingRetryReservations: pendingRetryReservations.size,
      });
      projection.result = result;
      projection.scheduledAttempt = undefined;
      projection.retryAttempt = undefined;
      projection.retryAvailableAt = undefined;
      if (!scheduledOrder.includes(nodeId)) scheduledOrder.push(nodeId);
      if (!completionOrder.includes(nodeId)) completionOrder.push(nodeId);
      continue;
    }

    if (event.type === "NodeScheduled") {
      if (event.edgeId !== undefined) throw invalidHistory(runId, "NodeScheduled has an edge identity");
      const nodeId = eventNode(event, compiled, runId);
      const attempt = eventAttempt(event, runId);
      const projection = projections.get(nodeId) as NodeProjection;
      if (projection.result !== undefined || projection.openAttempt !== undefined) {
        throw invalidHistory(runId, "settled or running node was scheduled again");
      }
      if (projection.scheduledAttempt !== undefined && projection.retryAttempt === undefined) {
        throw invalidHistory(runId, "NodeScheduled is duplicated without a retry");
      }
      const hasRetryReservation = pendingRetryReservations.has(nodeId);
      if ((projection.retryAttempt !== undefined) !== hasRetryReservation) {
        throw invalidHistory(runId, "NodeScheduled retry reservation is inconsistent", {
          nodeId,
        });
      }
      const expectedAttempt = projection.retryAttempt ?? projection.attempts + 1;
      if (attempt !== expectedAttempt) {
        throw invalidHistory(runId, "NodeScheduled attempt is non-contiguous");
      }
      const node = compiled.nodesById.get(nodeId) as NodeSpec;
      if (attempt > maxNodeAttempts(node)) {
        throw invalidHistory(runId, "NodeScheduled exceeds the node retry budget", { nodeId, attempt });
      }
      if (!hasRetryReservation &&
          totalAttempts + pendingRetryReservations.size >= maxTotalAttempts) {
        throw invalidHistory(runId, "NodeScheduled is not eligible under the global attempt budget", {
          nodeId, attempt,
        });
      }
      exactKeys(
        event.data, ["input", "inputMac", "activityKey", "sideEffects"],
        runId, "NodeScheduled.data",
      );
      let nodeInput: JsonValue;
      try {
        nodeInput = decodeDurableJson(event.data.input);
      } catch (error) {
        throw invalidHistory(runId, "NodeScheduled input is malformed", {}, { cause: error });
      }
      const inputMac = stringValue(event.data.inputMac, runId, "NodeScheduled.inputMac");
      if (run.valueMac(nodeContext("node-input", runId, nodeId), nodeInput) !== inputMac) {
        throw invalidHistory(runId, "NodeScheduled inputMac is invalid");
      }
      let expectedInput: JsonValue;
      try {
        const committed = new Map<string, NodeRunResult>();
        for (const [id, item] of projections) {
          if (item.result !== undefined) committed.set(id, item.result);
        }
        expectedInput = bindInput(compiled, nodeId, graphInput, committed);
      } catch (error) {
        throw invalidHistory(
          runId,
          "NodeScheduled was emitted before deterministic input binding was ready",
          { nodeId, attempt },
          { cause: error },
        );
      }
      if (!sameJson(nodeInput, expectedInput)) {
        throw invalidHistory(runId, "NodeScheduled input does not match deterministic graph binding", {
          nodeId, attempt,
        });
      }
      if (projection.attempts > 0 && projection.input !== undefined &&
          !sameJson(nodeInput, projection.input)) {
        throw invalidHistory(runId, "retry changed the original bound node input", { nodeId, attempt });
      }
      const activityKey = stringValue(event.data.activityKey, runId, "NodeScheduled.activityKey");
      const expectedActivityKey = run.activityKey(nodeId, inputMac);
      if (activityKey !== expectedActivityKey) {
        throw invalidHistory(runId, "NodeScheduled activityKey is invalid");
      }
      const declaredSideEffects = stringValue(
        event.data.sideEffects, runId, "NodeScheduled.sideEffects",
      );
      if (declaredSideEffects !== sideEffects(node)) {
        throw invalidHistory(runId, "NodeScheduled sideEffects is inconsistent");
      }
      projection.input = nodeInput;
      projection.inputMac = inputMac;
      projection.activityKey = activityKey;
      projection.sideEffects = declaredSideEffects as NodeProjection["sideEffects"];
      projection.scheduledAttempt = attempt;
      projection.retryAttempt = undefined;
      if (!scheduledOrder.includes(nodeId)) scheduledOrder.push(nodeId);
      continue;
    }

    if (event.type === "NodeStarted") {
      if (event.edgeId !== undefined) throw invalidHistory(runId, "NodeStarted has an edge identity");
      const nodeId = eventNode(event, compiled, runId);
      const attempt = eventAttempt(event, runId);
      const projection = projections.get(nodeId) as NodeProjection;
      if (projection.scheduledAttempt !== attempt || projection.openAttempt !== undefined ||
          projection.result !== undefined || projection.retryAttempt !== undefined) {
        throw invalidHistory(runId, "NodeStarted lacks its required NodeScheduled");
      }
      exactKeys(event.data, ["inputMac", "activityKey"], runId, "NodeStarted.data");
      if (event.data.inputMac !== projection.inputMac ||
          event.data.activityKey !== projection.activityKey) {
        throw invalidHistory(runId, "NodeStarted recovery identity is invalid");
      }
      if (attempt > maxNodeAttempts(compiled.nodesById.get(nodeId) as NodeSpec)) {
        throw invalidHistory(runId, "NodeStarted exceeds the node retry budget", { nodeId, attempt });
      }
      const consumedReservation = pendingRetryReservations.delete(nodeId);
      if (!consumedReservation &&
          totalAttempts + pendingRetryReservations.size >= maxTotalAttempts) {
        throw invalidHistory(runId, "NodeStarted has no available global attempt slot", {
          nodeId, attempt,
        });
      }
      projection.retryReserved = false;
      projection.retryAvailableAt = undefined;
      projection.scheduledAttempt = undefined;
      projection.openAttempt = attempt;
      projection.attempts = attempt;
      totalAttempts += 1;
      if (totalAttempts + pendingRetryReservations.size > maxTotalAttempts) {
        throw invalidHistory(runId, "history exceeds the global attempt budget");
      }
      active.add(nodeId);
      const concurrencyPolicy = compiled.graph.policies?.maxConcurrency;
      if (concurrencyPolicy !== undefined && active.size > concurrencyPolicy) {
        throw invalidHistory(runId, "history exceeds the graph concurrency policy", {
          active: active.size,
          maxConcurrency: concurrencyPolicy,
        });
      }
      maxObservedConcurrency = Math.max(maxObservedConcurrency, active.size);
      continue;
    }

    if (event.type === "NodeSucceeded") {
      if (event.edgeId !== undefined) throw invalidHistory(runId, "NodeSucceeded has an edge identity");
      const nodeId = eventNode(event, compiled, runId);
      const attempt = eventAttempt(event, runId);
      const projection = projections.get(nodeId) as NodeProjection;
      if (projection.openAttempt !== attempt || projection.result !== undefined) {
        throw invalidHistory(runId, "NodeSucceeded lacks one open attempt");
      }
      exactKeys(event.data, ["inputMac", "output", "outputMac"], runId, "NodeSucceeded.data");
      if (event.data.inputMac !== projection.inputMac) {
        throw invalidHistory(runId, "NodeSucceeded inputMac is invalid");
      }
      let output: JsonValue;
      try {
        output = decodeDurableJson(event.data.output);
      } catch (error) {
        throw invalidHistory(runId, "NodeSucceeded output is malformed", {}, { cause: error });
      }
      const outputMac = stringValue(event.data.outputMac, runId, "NodeSucceeded.outputMac");
      if (run.valueMac(nodeContext("node-output", runId, nodeId), output) !== outputMac) {
        throw invalidHistory(runId, "NodeSucceeded outputMac is invalid");
      }
      projection.outputMac = outputMac;
      projection.openAttempt = undefined;
      active.delete(nodeId);
      projection.result = {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "succeeded",
        attempts: attempt,
        ...(projection.input === undefined ? {} : { input: projection.input }),
        output,
      };
      if (!completionOrder.includes(nodeId)) completionOrder.push(nodeId);
      expectedEdges = (compiled.outgoing.get(nodeId) ?? []).map((edge) => ({
        edgeId: edge.id, producerId: nodeId, attempt, outputMac,
      }));
      continue;
    }

    if (event.type === "NodeAttemptFailed") {
      if (event.edgeId !== undefined) throw invalidHistory(runId, "NodeAttemptFailed has an edge identity");
      const nodeId = eventNode(event, compiled, runId);
      const attempt = eventAttempt(event, runId);
      const projection = projections.get(nodeId) as NodeProjection;
      if (projection.openAttempt !== attempt || projection.result !== undefined) {
        throw invalidHistory(runId, "NodeAttemptFailed lacks one open attempt");
      }
      exactKeys(event.data, ["terminal", "failure"], runId, "NodeAttemptFailed.data");
      const terminal = booleanValue(event.data.terminal, runId, "NodeAttemptFailed.terminal");
      const failure = decodeFailure(event.data.failure, runId, "NodeAttemptFailed.failure");
      if (failure.nodeId !== nodeId || failure.attempt !== attempt) {
        throw invalidHistory(runId, "attempt failure identity is invalid");
      }
      const allowedAttemptCodes = new Set<NodeRunFailure["code"]>([
        "NODE_EXECUTION_FAILED",
        "NODE_TIMEOUT",
        "NODE_CANCELLED",
        "INVALID_OUTPUT",
        "INVALID_ROUTE_SELECTION",
        "NODE_EXECUTION_INTERRUPTED",
      ]);
      if (!allowedAttemptCodes.has(failure.code)) {
        throw invalidHistory(runId, "NodeAttemptFailed uses a non-attempt outcome code", {
          nodeId,
          code: failure.code,
        });
      }
      if (pendingRetryReservations.has(nodeId)) {
        throw invalidHistory(runId, "open attempt retained a retry reservation", { nodeId });
      }
      const retryableCodes = new Set<NodeRunFailure["code"]>([
        "NODE_EXECUTION_FAILED", "NODE_TIMEOUT", "INVALID_OUTPUT", "NODE_EXECUTION_INTERRUPTED",
      ]);
      const safeInterrupted = failure.code !== "NODE_EXECUTION_INTERRUPTED" ||
        projection.sideEffects === "none" || projection.sideEffects === "idempotent";
      const shouldRetry = retryableCodes.has(failure.code) && safeInterrupted &&
        attempt < maxNodeAttempts(compiled.nodesById.get(nodeId) as NodeSpec) &&
        totalAttempts + pendingRetryReservations.size < maxTotalAttempts;
      if (terminal !== !shouldRetry || failure.retryable !== shouldRetry) {
        throw invalidHistory(runId, "attempt retryability contradicts deterministic eligibility", {
          nodeId,
          attempt,
          expectedRetryable: shouldRetry,
        });
      }
      if (failure.code === "NODE_EXECUTION_INTERRUPTED" &&
          (failure.message !== "process ended before the attempt outcome was durably recorded" ||
           failure.causeName !== "ProcessLost")) {
        throw invalidHistory(runId, "interrupted attempt failure is not canonical", { nodeId, attempt });
      }
      if (failure.code === "NODE_CANCELLED" && (!terminal || failure.retryable)) {
        throw invalidHistory(runId, "cancelled attempt failure is not canonical", { nodeId, attempt });
      }
      projection.openAttempt = undefined;
      active.delete(nodeId);
      if (terminal) {
        projection.result = {
          nodeId,
          sequence: compiled.sequence.get(nodeId) as number,
          status: "failed",
          attempts: attempt,
          ...(projection.input === undefined ? {} : { input: projection.input }),
          failure,
        };
        if (!completionOrder.includes(nodeId)) completionOrder.push(nodeId);
      } else {
        if (projection.activityKey === undefined) {
          throw invalidHistory(runId, "retry has no activity key");
        }
        expectedRetry = { nodeId, attempt: attempt + 1, activityKey: projection.activityKey };
      }
      continue;
    }

    if (event.type === "RunSucceeded" || event.type === "RunFailed" || event.type === "RunCancelled") {
      noEventIdentity(event, runId);
      if (pendingRetryReservations.size > 0) {
        throw invalidHistory(runId, "terminal event leaves retry reservations pending", {
          nodeIds: declarationOrder([...pendingRetryReservations], compiled),
        });
      }
      exactKeys(event.data, ["result", "resultMac", "status"], runId, `${event.type}.data`);
      let decoded: JsonValue;
      try {
        decoded = decodeDurableJson(event.data.result);
      } catch (error) {
        throw invalidHistory(runId, "terminal result is malformed", {}, { cause: error });
      }
      if (run.valueMac(runResultContext(runId), decoded) !== event.data.resultMac) {
        throw invalidHistory(runId, "terminal resultMac is invalid");
      }
      terminalResult = decodeTerminalResult(decoded, runId, compiled);
      if (event.data.status !== terminalResult.status) {
        throw invalidHistory(runId, "terminal status contradicts its protected result");
      }
      validateTerminalResult({
        runId,
        terminalType: event.type,
        terminal: terminalResult,
        compiled,
        projections,
        graphInput,
        scheduledOrder,
        completionOrder,
        maxObservedConcurrency,
        totalAttempts,
      });
      terminalSeen = true;
      continue;
    }

    throw invalidHistory(
      runId,
      `event type '${event.type}' is outside durable DAG recovery`,
      { sequence: index },
    );
  }

  if (expectedEdges.length > 0) {
    throw invalidHistory(runId, "event stream ends inside an EdgeEmitted batch");
  }
  if (expectedRetry !== undefined) {
    throw invalidHistory(runId, "event stream ends before required NodeRetried");
  }
  if (!started) {
    throw invalidHistory(runId, "event stream omits RunStarted");
  }
  return {
    graphInput,
    graphHash: storedGraphHash,
    inputMac: storedInputMac,
    implementationHash: storedImplementationHash,
    maxTotalAttempts,
    projections,
    totalAttempts,
    scheduledOrder,
    completionOrder,
    maxObservedConcurrency,
    terminalResult,
    eventIds,
    version: (events.at(-1) as RecoveredEvent).sequence,
  };
}

async function readHistory(
  run: ProtectedDurableRun,
  runId: string,
): Promise<readonly RecoveredEvent[]> {
  try {
    return await run.read();
  } catch (error) {
    if (error instanceof DurableRunError) throw error;
    if (error instanceof PersistenceError) throw error;
    throw new DurableRunError(
      "DURABILITY_STORE_FAILED",
      runId,
      "durable event history could not be read",
      { causeName: errorName(error) },
      { cause: error },
    );
  }
}

/**
 * A report about an existing `scheduler-recovery/v1alpha1` journal.
 *
 * spec/redaction-semantics.md Section 9 requires detection and forbids repair.
 * This report is the detection result: metadata only, with the SHA-256 digest of
 * the bytes that were read and the stable failure code that blocks resume. It
 * never contains a source payload, a canary value, or an unkeyed logical-value
 * digest, and producing it writes nothing anywhere.
 */
export interface LegacyDurableHistoryReport {
  readonly runId: string;
  readonly eventCount: number;
  readonly classification: "not-legacy" | "misleading-redacted-claim" | "truthful-inline-unredacted";
  readonly failureCode: DurableRunErrorCode | undefined;
  readonly affectedSequences: readonly number[];
  readonly manifest: LegacyQuarantineManifest | undefined;
}

async function readLegacyHistory(
  store: EventStore,
  runId: string,
): Promise<readonly GraphEvent[]> {
  try {
    const events: GraphEvent[] = [];
    for await (const event of store.read(runId)) events.push(event);
    return events;
  } catch (error) {
    if (error instanceof PersistenceError) throw error;
    throw new DurableRunError(
      "DURABILITY_STORE_FAILED",
      runId,
      "legacy event history could not be read",
      { causeName: errorName(error) },
      { cause: error },
    );
  }
}

function legacyBytes(events: readonly GraphEvent[]): Uint8Array {
  return new TextEncoder().encode(`${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

/**
 * Read and classify an existing v1alpha1 durable journal without continuing it.
 *
 * This is the explicit, authorized inspection path of Section 9.3: it reads,
 * reports what it found, and stops. It appends no event, invokes no executor,
 * rewrites no byte, and returns no application payload.
 */
export async function inspectLegacyDurableHistory(
  store: EventStore,
  runId: string,
  options: { readonly legacyInlineAuthorized?: boolean } = {},
): Promise<LegacyDurableHistoryReport> {
  const events = await readLegacyHistory(store, runId);
  if (events.length === 0) {
    return {
      runId,
      eventCount: 0,
      classification: "not-legacy",
      failureCode: undefined,
      affectedSequences: [],
      manifest: undefined,
    };
  }
  const classified = classifyLegacyHistory(events, options);
  if (classified.kind === "not-legacy") {
    return {
      runId,
      eventCount: events.length,
      classification: "not-legacy",
      failureCode: undefined,
      affectedSequences: [],
      manifest: undefined,
    };
  }
  const classification =
    classified.kind === "misleading"
      ? ("misleading-redacted-claim" as const)
      : ("truthful-inline-unredacted" as const);
  return {
    runId,
    eventCount: events.length,
    classification,
    failureCode: classified.failure?.code as DurableRunErrorCode | undefined,
    affectedSequences: classified.sequences,
    manifest: legacyQuarantineManifest({
      bytes: legacyBytes(events),
      classification,
      recordedAt: new Date().toISOString(),
      affectedSequences: classified.sequences,
    }),
  };
}

/**
 * Section 9.1: classification runs before `RunResumed`, before append, and
 * before any executor invocation, and a terminal stream is not exempt. Silent
 * repair is forbidden, so the only outcome here is a structured refusal.
 */
async function assertNoBlockingLegacyHistory(
  options: DurableSchedulerOptions,
): Promise<void> {
  const store = options.legacyEventStore;
  if (store === undefined) return;
  const report = await inspectLegacyDurableHistory(store, options.runId);
  if (report.failureCode === undefined) return;
  throw new DurableRunError(
    report.failureCode,
    options.runId,
    "a legacy scheduler-recovery/v1alpha1 journal exists for this run and cannot be continued",
    {
      classification: report.classification,
      affectedSequences: report.affectedSequences,
      eventCount: report.eventCount,
      sourceDigest: report.manifest?.sourceDigest,
      disposition: "quarantine",
    },
  );
}

function implementationHash(implementationId: string): string {
  if (typeof implementationId !== "string" || implementationId.length === 0) {
    throw new TypeError("implementationId must be a non-empty string");
  }
  return durableJsonHash(implementationId);
}

function effectiveNow(options: DurableSchedulerOptions): () => Date {
  return options.now ?? (() => new Date());
}

function effectiveEventIdFactory(
  options: DurableSchedulerOptions,
): NonNullable<DurableSchedulerOptions["createEventId"]> {
  // `:` is not in the v1alpha2 safe-identifier alphabet, so the default
  // factory uses `.` — the identifier is runtime-generated either way.
  return options.createEventId ?? (({ runId, sequence }) => `${runId}.${sequence}`);
}

function stableOptions(options: DurableSchedulerOptions): DurableSchedulerOptions {
  if (typeof options !== "object" || options === null) {
    throw new TypeError("durable scheduler options must be an object");
  }
  return Object.freeze({
    ...options,
    ...(options.nodeExecutors === undefined
      ? {}
      : { nodeExecutors: Object.freeze({ ...options.nodeExecutors }) }),
    ...(options.executors === undefined
      ? {}
      : { executors: Object.freeze({ ...options.executors }) }),
  });
}

function schedulerOptions(
  options: DurableSchedulerOptions,
  extra: Omit<SchedulerInternalOptions, keyof SchedulerOptions>,
): SchedulerInternalOptions {
  return {
    ...(options.nodeExecutors === undefined
      ? {}
      : { nodeExecutors: options.nodeExecutors as unknown as NonNullable<SchedulerOptions["nodeExecutors"]> }),
    ...(options.executors === undefined
      ? {}
      : { executors: options.executors as unknown as NonNullable<SchedulerOptions["executors"]> }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...extra,
  };
}

function publicResult(result: SchedulerRunResult): DurableGraphRunResult {
  return {
    status: result.status,
    graphHash: result.graphHash,
    ...(result.output === undefined ? {} : { output: result.output }),
    nodes: result.nodes,
    failures: result.failures,
    maxObservedConcurrency: result.maxObservedConcurrency,
    totalAttempts: result.totalAttempts,
  };
}

function remainingDelayMs(availableAt: string, now: Date, runId: string): number {
  return Math.max(0, strictDate(availableAt, runId, "retry availability").getTime() - now.getTime());
}

/** Create and execute one durable graph run. This operation never resumes an existing stream. */
export async function startDurableGraphRun(
  graph: GraphSpec,
  input: unknown,
  options: DurableSchedulerOptions,
): Promise<DurableGraphRunResult> {
  options = stableOptions(options);
  const compiled = compileDurableGraph(graph);
  if (isCompilationFailure(compiled)) return compiled;
  const unsupported = capabilityFailure(compiled);
  if (unsupported !== undefined) return unsupported;
  assertDurableTimerBounds(compiled.graph);
  // Section 4.2: fail closed before the first event, checkpoint, log, error
  // payload, temporary plaintext file, or executor invocation.
  assertPayloadProtection(options.runId, options.protection);
  const run = new ProtectedDurableRun(options.protection, options.runId);
  const implementation = implementationHash(options.implementationId);
  const inputSnapshot = snapshotJson(input);
  await assertNoBlockingLegacyHistory(options);
  const existing = await readHistory(run, options.runId);
  if (existing.length > 0) {
    throw new DurableRunError(
      "RUN_ALREADY_EXISTS", options.runId, "durable run already exists",
    );
  }
  const journal = new DurableJournal({
    compiled,
    runId: options.runId,
    run,
    version: -1,
    now: effectiveNow(options),
    createEventId: effectiveEventIdFactory(options),
  });
  await journal.append([
    {
      type: "RunCreated",
      data: {
        contractVersion: CONTRACT_VERSION,
        graphHash: compiled.graphHash,
        implementationHash: implementation,
        capturePolicyHash: run.capturePolicyHash,
        protectedStoreContract: PROTECTED_STORE_CONTRACT,
        keyRefHash: run.keyRefHash,
        maxTotalAttempts: effectiveAttemptLimit(compiled.graph),
      },
      payloads: [{
        field: "inputRef",
        semanticContext: graphInputContext(options.runId),
        value: inputSnapshot,
      }],
    },
    { type: "RunStarted", data: {} },
  ], "RUN_ALREADY_EXISTS");
  const result = await runGraphWithJournal(
    compiled.graph,
    inputSnapshot,
    schedulerOptions(options, { journal }),
  );
  return publicResult(result);
}

/** Continue one non-terminal durable graph stream using its originally bound input. */
export async function resumeDurableGraphRun(
  graph: GraphSpec,
  options: DurableSchedulerOptions,
): Promise<DurableGraphRunResult> {
  options = stableOptions(options);
  const compiled = compileDurableGraph(graph);
  if (isCompilationFailure(compiled)) return compiled;
  const unsupported = capabilityFailure(compiled);
  if (unsupported !== undefined) return unsupported;
  assertDurableTimerBounds(compiled.graph);
  assertPayloadProtection(options.runId, options.protection);
  const run = new ProtectedDurableRun(options.protection, options.runId);
  const implementation = implementationHash(options.implementationId);
  await assertNoBlockingLegacyHistory(options);
  const events = await readHistory(run, options.runId);
  const folded = foldHistory(events, {
    compiled,
    runId: options.runId,
    implementationHash: implementation,
    run,
  });
  for (const [nodeId, projection] of folded.projections) {
    const node = compiled.nodesById.get(nodeId) as NodeSpec;
    const conditionIssues = (compiled.outgoing.get(nodeId) ?? []).flatMap((edge) => {
      const issue = edgeConditionError(edge, node);
      return issue === undefined ? [] : [issue];
    });
    if (conditionIssues.length > 0) {
      if (projection.attempts !== 0 || projection.scheduledAttempt !== undefined ||
          projection.openAttempt !== undefined || projection.retryAttempt !== undefined ||
          projection.input !== undefined || projection.inputMac !== undefined ||
          projection.activityKey !== undefined) {
        throw invalidHistory(
          options.runId,
          `unsupported-condition source '${nodeId}' has attempt-bearing history`,
          { nodeId },
        );
      }
      if (projection.result === undefined) continue;
      const expected: NodeRunResult = {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "failed",
        attempts: 0,
        failure: runtimeFailure(
          nodeId,
          "UNSUPPORTED_EDGE_CONDITION",
          conditionIssues.join("; "),
          0,
        ),
      };
      if (!sameJson(projection.result, expected)) {
        throw invalidHistory(
          options.runId,
          `unsupported-condition source '${nodeId}' has an invalid settlement`,
          { nodeId },
        );
      }
      continue;
    }
    if (node.kind !== "router" || projection.result?.status !== "succeeded") continue;
    try {
      if (projection.result.input === undefined) {
        throw new TypeError("successful router history is missing its scheduled input");
      }
      assertExactRouteSelection(
        node,
        projection.result.input,
        projection.result.output as JsonValue,
      );
    } catch (cause) {
      throw invalidHistory(
        options.runId,
        `successful router decision for '${nodeId}' is invalid`,
        { nodeId },
        { cause },
      );
    }
  }
  if (folded.terminalResult !== undefined) {
    return publicResult(folded.terminalResult);
  }

  for (const projection of folded.projections.values()) {
    if (projection.result?.failure?.code === "NODE_EXECUTION_INTERRUPTED" &&
        projection.sideEffects !== "none" && projection.sideEffects !== "idempotent") {
      throw new DurableRunError(
        "IN_DOUBT_SIDE_EFFECT",
        options.runId,
        "an interrupted node remains blocked on unsafe side-effect reconciliation",
        {
          nodeId: projection.nodeId,
          attempt: projection.result.attempts,
          sideEffects: projection.sideEffects ?? "unspecified",
        },
      );
    }
  }

  const now = effectiveNow(options);
  const journal = new DurableJournal({
    compiled,
    runId: options.runId,
    run,
    version: folded.version,
    now,
    createEventId: effectiveEventIdFactory(options),
    eventIds: folded.eventIds,
    preScheduled: new Map(
      [...folded.projections]
        .filter(([, projection]) => projection.scheduledAttempt !== undefined &&
          projection.openAttempt === undefined && projection.retryAttempt === undefined &&
          projection.result === undefined)
        .map(([nodeId, projection]) => [nodeId, projection.scheduledAttempt as number]),
    ),
    activityKeys: new Map(
      [...folded.projections]
        .filter(([, projection]) => projection.activityKey !== undefined)
        .map(([nodeId, projection]) => [nodeId, projection.activityKey as string]),
    ),
  });
  const interrupted = declarationOrder(
    [...folded.projections.values()]
      .filter((projection) => projection.openAttempt !== undefined)
      .map((projection) => projection.nodeId),
    compiled,
  );
  const reused = declarationOrder(
    [...folded.projections.values()]
      .filter((projection) => projection.result?.status === "succeeded")
      .map((projection) => projection.nodeId),
    compiled,
  );
  await journal.append([{
    type: "RunResumed",
    data: { reusedNodeIds: [...reused], interruptedNodeIds: [...interrupted] },
  }]);

  const initialResults = new Map<string, NodeRunResult>();
  for (const [nodeId, projection] of folded.projections) {
    if (projection.result !== undefined) initialResults.set(nodeId, projection.result);
  }
  const initialCompletionOrder = [...folded.completionOrder];
  const retryDelays = new Map<string, number>();
  let reservedAttempts = [...folded.projections.values()]
    .filter((projection) => projection.retryReserved).length;

  for (const nodeId of interrupted) {
    const projection = folded.projections.get(nodeId) as NodeProjection;
    const attempt = projection.openAttempt as number;
    const node = compiled.nodesById.get(nodeId) as NodeSpec;
    const automatic = projection.sideEffects === "none" || projection.sideEffects === "idempotent";
    const canRetry = automatic && attempt < maxNodeAttempts(node) &&
      folded.totalAttempts + reservedAttempts < folded.maxTotalAttempts;
    if (canRetry) reservedAttempts += 1;
    const interruptedFailure = runtimeFailure(
      nodeId,
      "NODE_EXECUTION_INTERRUPTED",
      "process ended before the attempt outcome was durably recorded",
      attempt,
      { retryable: canRetry, causeName: "ProcessLost" },
    );
    const delayMs = canRetry ? retryDelayMs(node, attempt) : 0;
    await journal.attemptFailed({
      graph: compiled.graph,
      node,
      input: projection.input as JsonValue,
      failure: interruptedFailure,
      identity: {
        runId: options.runId,
        attemptId: `${options.runId}/${nodeId}/${attempt}`,
        activityKey: projection.activityKey as string,
      },
      willRetry: canRetry,
      retryDelayMs: delayMs,
    });
    if (!automatic) {
      throw new DurableRunError(
        "IN_DOUBT_SIDE_EFFECT",
        options.runId,
        "an interrupted node may have produced an unsafe external effect",
        {
          nodeId,
          attempt,
          sideEffects: projection.sideEffects ?? "unspecified",
        },
      );
    }
    if (canRetry) {
      retryDelays.set(
        nodeId,
        remainingDelayMs(journal.retryAvailableAt.get(nodeId) as string, now(), options.runId),
      );
    } else {
      initialResults.set(nodeId, {
        nodeId,
        sequence: compiled.sequence.get(nodeId) as number,
        status: "failed",
        attempts: attempt,
        ...(projection.input === undefined ? {} : { input: projection.input }),
        failure: interruptedFailure,
      });
      if (!initialCompletionOrder.includes(nodeId)) initialCompletionOrder.push(nodeId);
    }
  }

  for (const [nodeId, projection] of folded.projections) {
    if (projection.retryReserved && projection.retryAvailableAt !== undefined &&
        projection.result === undefined) {
      retryDelays.set(
        nodeId,
        remainingDelayMs(projection.retryAvailableAt, now(), options.runId),
      );
    }
  }

  const result = await runGraphWithJournal(
    compiled.graph,
    folded.graphInput,
    schedulerOptions(options, {
      journal,
      initialResults,
      attemptOffsets: new Map(
        [...folded.projections].map(([nodeId, projection]) => [nodeId, projection.attempts]),
      ),
      initialTotalAttempts: folded.totalAttempts,
      initialMaxObservedConcurrency: folded.maxObservedConcurrency,
      initialScheduledOrder: folded.scheduledOrder,
      initialCompletionOrder,
      initialRetryDelaysMs: retryDelays,
    }),
  );
  return publicResult(result);
}

export const startGraphRun = startDurableGraphRun;
export const resumeGraphRun = resumeDurableGraphRun;
