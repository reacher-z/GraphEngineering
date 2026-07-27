import {
  canonicalHash,
  canonicalSerialize,
  compareUnicodeCodePoints,
  compileGraph,
  type EdgeSpec,
  type GraphSpec,
  type NodeSpec,
} from "@graph-engineering/core";
import {
  CycleControllerError,
  type CycleBudgetDelta,
  type CycleGraphCoordinate,
  type GraphPatch,
  type GraphPatchAcceptedDecision,
  type GraphPatchApplication,
  type GraphPatchApplyContext,
  type GraphPatchApplierOptions,
  type GraphPatchDecision,
  type GraphPatchDiagnostic,
  type GraphPatchErrorCode,
  type GraphPatchRejectedDecision,
} from "./cycle-types.js";
import {
  captureBoundedJson,
  createCycleInlinePayload,
  graphRevision,
  validateGraphPatchShape,
  decodeCycleInlinePayload,
} from "./cycle-contract.js";
import { snapshotJson } from "./json.js";

interface DecidedPatch {
  readonly canonicalJson: string;
  readonly decision: GraphPatchDecision;
  readonly application: GraphPatchApplication;
}

const HASH = /^[0-9a-f]{64}$/u;
const CONTEXT_KEYS = new Set([
  "dryRun", "cancelled", "runState", "allowPausedMutation", "authoritySnapshot",
  "policySnapshotHash", "reservationId", "reserved", "activityUsage", "durationMs",
  "deadlineMsRemaining", "effectiveCapabilities", "succeededNodeIds", "supportedEdgeModes",
]);

function plainRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
    if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError();
    }
    return Object.fromEntries(
      Object.entries(descriptors).map(([key, descriptor]) => [key, (descriptor as PropertyDescriptor & { value: unknown }).value]),
    );
  } catch (error) {
    throw new CycleControllerError(
      "GE_PATCH_INVALID", "graph-patch", `${label} must be closed plain data`, {}, { cause: error },
    );
  }
}

function exactContextKeys(value: Readonly<Record<string, unknown>>): void {
  const unknown = Object.keys(value).filter((key) => !CONTEXT_KEYS.has(key));
  if (unknown.length > 0) {
    throw new CycleControllerError(
      "GE_PATCH_INVALID", "graph-patch", "patch context contains unknown fields", { unknown },
    );
  }
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", `${label} is outside its portable range`);
  }
  return value;
}

function finite(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", `${label} is outside its portable range`);
  }
  return value;
}

function validateBudget(value: unknown, label: string): CycleBudgetDelta {
  const item = plainRecord(value, label);
  if (Object.keys(item).sort(compareUnicodeCodePoints).join("\0") !== "attempts\0costUsd\0dynamicNodes") {
    throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", `${label} is not a closed budget`);
  }
  return Object.freeze({
    attempts: integer(item.attempts, 0, Number.MAX_SAFE_INTEGER, `${label}.attempts`),
    costUsd: finite(item.costUsd, 0, Number.MAX_SAFE_INTEGER, `${label}.costUsd`),
    dynamicNodes: integer(item.dynamicNodes, 0, Number.MAX_SAFE_INTEGER, `${label}.dynamicNodes`),
  });
}

function validateStringArray(
  value: unknown,
  label: string,
  allowed?: ReadonlySet<string>,
): readonly string[] {
  if (!Array.isArray(value) || value.length > 100_000) {
    throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", `${label} is not a bounded array`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0 || item.length > 256
        || seen.has(item) || allowed !== undefined && !allowed.has(item)) {
      throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", `${label} contains an invalid item`);
    }
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

function validateApplyContext(value: GraphPatchApplyContext | unknown): GraphPatchApplyContext {
  const context = plainRecord(value, "patch context");
  exactContextKeys(context);
  for (const field of ["dryRun", "cancelled", "allowPausedMutation"] as const) {
    if (context[field] !== undefined && typeof context[field] !== "boolean") {
      throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", `context.${field} must be boolean`);
    }
  }
  if (context.runState !== undefined && context.runState !== "active"
      && context.runState !== "paused" && context.runState !== "terminal") {
    throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", "context.runState is invalid");
  }
  if (typeof context.policySnapshotHash !== "string" || !HASH.test(context.policySnapshotHash)
      || typeof context.reservationId !== "string" || context.reservationId.length === 0
      || context.reservationId.length > 256) {
    throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", "context identity is invalid");
  }
  const authority = plainRecord(context.authoritySnapshot, "authority snapshot");
  const authorityKeys = [
    "proposerActivityKey", "principalHash", "proposerGrantHash", "runGrantHash",
    "tenantGrantHash", "deploymentGrantHash", "effectiveGrantHash", "policyHash", "approvalHash",
  ];
  if (Object.keys(authority).sort(compareUnicodeCodePoints).join("\0")
      !== [...authorityKeys].sort(compareUnicodeCodePoints).join("\0")) {
    throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", "authority snapshot is not closed");
  }
  for (const key of authorityKeys) {
    const item = authority[key];
    if (key === "approvalHash" && item === null) continue;
    if (typeof item !== "string" || !HASH.test(item)) {
      throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", `authoritySnapshot.${key} is invalid`);
    }
  }
  const reserved = validateBudget(context.reserved, "reserved budget");
  let activityUsage: GraphPatchApplyContext["activityUsage"];
  if (context.activityUsage !== undefined) {
    const usage = plainRecord(context.activityUsage, "activity usage");
    if (Object.keys(usage).sort(compareUnicodeCodePoints).join("\0") !== "attempts\0costUsd") {
      throw new CycleControllerError("GE_PATCH_INVALID", "graph-patch", "activity usage is not closed");
    }
    activityUsage = Object.freeze({
      attempts: integer(usage.attempts, 0, reserved.attempts, "activityUsage.attempts"),
      costUsd: finite(usage.costUsd, 0, reserved.costUsd, "activityUsage.costUsd"),
    });
  }
  const effectiveCapabilities = context.effectiveCapabilities === undefined
    ? undefined : validateStringArray(context.effectiveCapabilities, "effectiveCapabilities");
  const succeededNodeIds = context.succeededNodeIds === undefined
    ? undefined : validateStringArray(context.succeededNodeIds, "succeededNodeIds");
  const supportedEdgeModes = context.supportedEdgeModes === undefined
    ? undefined
    : validateStringArray(
      context.supportedEdgeModes, "supportedEdgeModes", new Set(["value", "stream", "artifact-ref"]),
    ) as readonly ("value" | "stream" | "artifact-ref")[];
  return snapshotJson({
    ...(context.dryRun === undefined ? {} : { dryRun: context.dryRun }),
    ...(context.cancelled === undefined ? {} : { cancelled: context.cancelled }),
    ...(context.runState === undefined ? {} : { runState: context.runState }),
    ...(context.allowPausedMutation === undefined ? {} : { allowPausedMutation: context.allowPausedMutation }),
    authoritySnapshot: authority,
    policySnapshotHash: context.policySnapshotHash,
    reservationId: context.reservationId,
    reserved,
    ...(activityUsage === undefined ? {} : { activityUsage }),
    durationMs: integer(context.durationMs, 0, 2_147_483_647, "context.durationMs"),
    deadlineMsRemaining: integer(
      context.deadlineMsRemaining, 0, 2_147_483_647, "context.deadlineMsRemaining",
    ),
    ...(effectiveCapabilities === undefined ? {} : { effectiveCapabilities }),
    ...(succeededNodeIds === undefined ? {} : { succeededNodeIds }),
    ...(supportedEdgeModes === undefined ? {} : { supportedEdgeModes }),
  }) as unknown as GraphPatchApplyContext;
}

function validateRecordedDecision(
  value: GraphPatchDecision | unknown,
  expectedPlannerActivityKey: string,
): GraphPatchDecision {
  const invalid = (message: string, cause?: unknown): never => {
    throw new CycleControllerError(
      "GE_CYCLE_INVALID_HISTORY", "graph-patch", message, {},
      cause === undefined ? {} : { cause },
    );
  };
  try {
    const captured = captureBoundedJson(value, 16_777_216).value;
    const decision = plainRecord(captured, "recorded GraphPatch decision");
    const acceptedKeys = [
      "patchId", "patchHash", "patch", "requestedBase", "authoritySnapshot",
      "policySnapshotHash", "budgetOutcome", "diagnostics", "decidedAtDurationMs",
      "outcome", "resultingRevision",
    ];
    const rejectedKeys = [...acceptedKeys.filter((key) => key !== "resultingRevision"), "errorCode"];
    const expected = decision.outcome === "accepted"
      ? acceptedKeys
      : decision.outcome === "rejected" ? rejectedKeys : invalid("recorded patch outcome is invalid");
    if (Object.keys(decision).sort(compareUnicodeCodePoints).join("\0")
        !== [...expected].sort(compareUnicodeCodePoints).join("\0")) {
      invalid("recorded patch decision is not closed");
    }
    const patch = validateGraphPatchShape(
      decodeCycleInlinePayload(decision.patch, 4_194_304, "graph-patch"), "graph-patch",
    );
    if (decision.patchId !== patch.patchId || typeof decision.patchHash !== "string"
        || !HASH.test(decision.patchHash) || canonicalHash(patch) !== decision.patchHash) {
      invalid("recorded patch bytes/hash/ID drifted");
    }
    const baseValue = plainRecord(decision.requestedBase, "recorded requested base");
    if (Object.keys(baseValue).sort(compareUnicodeCodePoints).join("\0")
        !== "graphHash\0graphRevision\0revisionHash"
        || !HASH.test(String(baseValue.graphHash)) || !HASH.test(String(baseValue.revisionHash))) {
      invalid("recorded requested base is invalid");
    }
    const requestedBase: CycleGraphCoordinate = Object.freeze({
      graphRevision: integer(baseValue.graphRevision, 1, Number.MAX_SAFE_INTEGER - 1, "base.graphRevision"),
      graphHash: baseValue.graphHash as string,
      revisionHash: baseValue.revisionHash as string,
    });
    if (!sameCoordinate(patch.base, requestedBase)) invalid("patch document and requested base differ");
    const budgetValue = plainRecord(decision.budgetOutcome, "recorded budget outcome");
    if (Object.keys(budgetValue).sort(compareUnicodeCodePoints).join("\0")
        !== "committed\0released\0requested\0reservationId") {
      invalid("recorded patch budget outcome is not closed");
    }
    if (typeof budgetValue.reservationId !== "string" || budgetValue.reservationId.length === 0
        || budgetValue.reservationId.length > 256) invalid("recorded reservation identity is invalid");
    const requested = validateBudget(budgetValue.requested, "recorded requested budget");
    const committed = validateBudget(budgetValue.committed, "recorded committed budget");
    const released = validateBudget(budgetValue.released, "recorded released budget");
    if (canonicalSerialize(subtractBudget(requested, committed)) !== canonicalSerialize(released)) {
      invalid("recorded patch budget does not reconcile");
    }
    const durationMs = integer(
      decision.decidedAtDurationMs, 0, 2_147_483_647, "recorded decidedAtDurationMs",
    );
    validateApplyContext({
      authoritySnapshot: decision.authoritySnapshot,
      policySnapshotHash: decision.policySnapshotHash,
      reservationId: budgetValue.reservationId,
      reserved: requested,
      activityUsage: { attempts: committed.attempts, costUsd: committed.costUsd },
      durationMs,
      deadlineMsRemaining: 1,
    });
    if (!HASH.test(expectedPlannerActivityKey)
        || decision.authoritySnapshot === null
        || typeof decision.authoritySnapshot !== "object"
        || (decision.authoritySnapshot as Readonly<Record<string, unknown>>).proposerActivityKey
          !== expectedPlannerActivityKey) {
      invalid("recorded patch authority is detached from its trusted planner claim");
    }
    const diagnostics = decision.diagnostics;
    if (!Array.isArray(diagnostics) || diagnostics.length > 100_000) {
      invalid("recorded patch diagnostics are invalid");
    }
    const diagnosticValues = diagnostics as readonly unknown[];
    for (const diagnosticValue of diagnosticValues) {
      const item = plainRecord(diagnosticValue, "recorded patch diagnostic");
      if (Object.keys(item).sort(compareUnicodeCodePoints).join("\0") !== "code\0path\0phase"
          || typeof item.code !== "string" || !/^GE_[A-Z0-9_]{3,64}$/u.test(item.code)
          || !Number.isSafeInteger(item.phase) || (item.phase as number) < 1 || (item.phase as number) > 13
          || typeof item.path !== "string" || !/^(?:\/(?:[^~/]|~[01])*)*$/u.test(item.path)) {
        invalid("recorded patch diagnostic is invalid");
      }
    }
    if (decision.outcome === "accepted") {
      if (diagnosticValues.length !== 0 || committed.dynamicNodes !== patch.append.nodes.length) {
        invalid("recorded accepted patch outcome is invalid");
      }
      const revision = plainRecord(decision.resultingRevision, "recorded resulting revision");
      if (Object.keys(revision).sort(compareUnicodeCodePoints).join("\0") !== "body\0revisionHash") {
        invalid("recorded resulting revision is not closed");
      }
      const body = plainRecord(revision.body, "recorded revision body");
      const rebuilt = graphRevision(body);
      if (revision.revisionHash !== rebuilt.revisionHash
          || rebuilt.body.graphRevision !== requestedBase.graphRevision + 1
          || rebuilt.body.previousRevisionHash !== requestedBase.revisionHash
          || rebuilt.body.patchHash !== decision.patchHash) {
        invalid("recorded accepted revision chain is invalid");
      }
    } else if (diagnosticValues.length === 0 || committed.dynamicNodes !== 0
        || typeof decision.errorCode !== "string" || !/^GE_PATCH_[A-Z0-9_]{3,64}$/u.test(decision.errorCode)) {
      invalid("recorded rejected patch outcome is invalid");
    }
    return captured as unknown as GraphPatchDecision;
  } catch (error) {
    if (error instanceof CycleControllerError && error.code === "GE_CYCLE_INVALID_HISTORY") throw error;
    return invalid("recorded GraphPatch decision failed closed validation", error);
  }
}

function sameCoordinate(left: CycleGraphCoordinate, right: CycleGraphCoordinate): boolean {
  return left.graphRevision === right.graphRevision
    && left.graphHash === right.graphHash
    && left.revisionHash === right.revisionHash;
}

function subtractBudget(total: CycleBudgetDelta, used: CycleBudgetDelta): CycleBudgetDelta {
  const result = {
    attempts: total.attempts - used.attempts,
    costUsd: total.costUsd - used.costUsd,
    dynamicNodes: total.dynamicNodes - used.dynamicNodes,
  };
  if (result.attempts < 0 || result.costUsd < 0 || result.dynamicNodes < 0
      || !Number.isSafeInteger(result.attempts) || !Number.isSafeInteger(result.dynamicNodes)
      || !Number.isFinite(result.costUsd)) {
    throw new TypeError("patch budget usage exceeds its exact reservation");
  }
  return Object.freeze(result);
}

function diagnostic(
  code: GraphPatchErrorCode,
  phase: number,
  path: string,
): GraphPatchDiagnostic {
  return Object.freeze({ code, phase, path });
}

function requestedCapabilities(node: NodeSpec): readonly string[] {
  const found = new Set<string>();
  const records = [node.resources, typeof node.config === "object" && node.config !== null ? node.config : undefined];
  for (const record of records) {
    if (record === undefined || Array.isArray(record)) continue;
    const capabilities = (record as Readonly<Record<string, unknown>>).capabilities;
    if (!Array.isArray(capabilities)) continue;
    for (const item of capabilities) {
      if (typeof item !== "string") return ["<invalid-capability>"];
      found.add(item);
    }
  }
  return [...found].sort(compareUnicodeCodePoints);
}

function outputMap(
  base: GraphSpec["outputs"],
  appended: GraphPatch["append"]["outputs"],
): GraphSpec["outputs"] {
  const value = Object.create(null) as Record<string, { readonly node: string; readonly port?: string }>;
  for (const [name, endpoint] of Object.entries(base)) {
    Object.defineProperty(value, name, { value: endpoint, enumerable: true, writable: false, configurable: false });
  }
  for (const name of Object.keys(appended).sort(compareUnicodeCodePoints)) {
    Object.defineProperty(value, name, {
      value: appended[name], enumerable: true, writable: false, configurable: false,
    });
  }
  return Object.freeze(value);
}

function maximumDepth(graph: GraphSpec): number {
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1);
    outgoing.get(edge.from.node)?.push(edge.to.node);
  }
  const queue = graph.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const depth = new Map(queue.map((nodeId) => [nodeId, 1]));
  let maximum = queue.length === 0 ? 0 : 1;
  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    for (const target of outgoing.get(nodeId) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 1, (depth.get(nodeId) ?? 1) + 1));
      maximum = Math.max(maximum, depth.get(target) as number);
      incoming.set(target, (incoming.get(target) as number) - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  return maximum;
}

function maximumFanOut(graph: GraphSpec): number {
  const counts = new Map<string, number>();
  for (const edge of graph.edges) counts.set(edge.from.node, (counts.get(edge.from.node) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

/**
 * Native append-only GraphPatch compiler/applier.
 *
 * All proposal bytes are detached before inspection. Decisions are idempotent
 * by patch ID and canonical bytes, and accepted revisions become visible only
 * through `commitPrepared` or the final step of a non-dry `apply` call.
 */
export class NativeGraphPatchApplier {
  #graph: GraphSpec;
  #coordinate: CycleGraphCoordinate;
  #dynamicNodes: number;
  readonly #options: GraphPatchApplierOptions;
  readonly #decisions = new Map<string, DecidedPatch>();
  readonly #prepared = new WeakSet<object>();

  constructor(
    initialGraphValue: GraphSpec | unknown,
    initialCoordinate: CycleGraphCoordinate,
    options: GraphPatchApplierOptions,
  ) {
    const compilation = compileGraph(initialGraphValue);
    if (!compilation.valid || compilation.canonicalGraph === null || compilation.graphHash === null) {
      throw new CycleControllerError(
        "GE_PATCH_GRAPH_INVALID", "unknown", "initial graph does not compile", {
          diagnostics: compilation.diagnostics,
        },
      );
    }
    const coordinateValue = plainRecord(initialCoordinate, "initial graph coordinate");
    if (Object.keys(coordinateValue).sort(compareUnicodeCodePoints).join("\0")
        !== "graphHash\0graphRevision\0revisionHash"
        || !HASH.test(String(coordinateValue.graphHash)) || !HASH.test(String(coordinateValue.revisionHash))) {
      throw new CycleControllerError("GE_PATCH_INVALID", "unknown", "initial graph coordinate is invalid");
    }
    const coordinate: CycleGraphCoordinate = Object.freeze({
      graphRevision: integer(coordinateValue.graphRevision, 1, Number.MAX_SAFE_INTEGER - 1, "graphRevision"),
      graphHash: coordinateValue.graphHash as string,
      revisionHash: coordinateValue.revisionHash as string,
    });
    if (compilation.graphHash !== coordinate.graphHash) {
      throw new CycleControllerError(
        "GE_PATCH_STALE_BASE", "unknown", "initial graph hash does not match its coordinate",
      );
    }
    const optionValue = plainRecord(options, "GraphPatch applier options");
    const optionKeys = Object.keys(optionValue).sort(compareUnicodeCodePoints);
    if (optionKeys.join("\0") !== "limits\0maxDynamicNodes"
        && optionKeys.join("\0") !== "initialDynamicNodes\0limits\0maxDynamicNodes") {
      throw new CycleControllerError("GE_PATCH_INVALID", "unknown", "GraphPatch applier options are not closed");
    }
    const limitsValue = plainRecord(optionValue.limits, "graph limits");
    if (Object.keys(limitsValue).sort(compareUnicodeCodePoints).join("\0")
        !== "maxDepth\0maxEdges\0maxFanOut\0maxNodes\0maxOutputs") {
      throw new CycleControllerError("GE_PATCH_INVALID", "unknown", "graph limits are not closed");
    }
    const validatedOptions: GraphPatchApplierOptions = Object.freeze({
      limits: Object.freeze({
        maxNodes: integer(limitsValue.maxNodes, 1, 100_000, "limits.maxNodes"),
        maxEdges: integer(limitsValue.maxEdges, 0, 200_000, "limits.maxEdges"),
        maxOutputs: integer(limitsValue.maxOutputs, 1, 100_000, "limits.maxOutputs"),
        maxDepth: integer(limitsValue.maxDepth, 1, 100_000, "limits.maxDepth"),
        maxFanOut: integer(limitsValue.maxFanOut, 1, 100_000, "limits.maxFanOut"),
      }),
      maxDynamicNodes: integer(optionValue.maxDynamicNodes, 0, 100_000, "maxDynamicNodes"),
      ...(optionValue.initialDynamicNodes === undefined ? {} : {
        initialDynamicNodes: integer(optionValue.initialDynamicNodes, 0, 100_000, "initialDynamicNodes"),
      }),
    });
    this.#graph = snapshotJson(JSON.parse(compilation.canonicalGraph)) as unknown as GraphSpec;
    this.#coordinate = coordinate;
    this.#dynamicNodes = validatedOptions.initialDynamicNodes ?? 0;
    this.#options = validatedOptions;
    if (this.#dynamicNodes > validatedOptions.maxDynamicNodes) {
      throw new CycleControllerError(
        "GE_PATCH_INVALID", "unknown", "initial dynamic-node count is outside the configured bound",
      );
    }
  }

  get graph(): GraphSpec {
    return this.#graph;
  }

  get coordinate(): CycleGraphCoordinate {
    return this.#coordinate;
  }

  get dynamicNodes(): number {
    return this.#dynamicNodes;
  }

  decided(patchId: string): GraphPatchDecision | undefined {
    return this.#decisions.get(patchId)?.decision;
  }

  /**
   * Rebuild one durable decision without rerunning policy services.
   *
   * The independently folded `ActivityStarted.activityKey` is mandatory: a
   * hash-valid decision is not allowed to authenticate its own proposer.
   */
  restoreRecorded(decisionValue: GraphPatchDecision, expectedPlannerActivityKey: string): void {
    const decision = validateRecordedDecision(decisionValue, expectedPlannerActivityKey);
    const patch = validateGraphPatchShape(
      decodeCycleInlinePayload(decision.patch, 4_194_304, "graph-patch"),
      "graph-patch",
    );
    if (canonicalHash(patch) !== decision.patchHash || patch.patchId !== decision.patchId) {
      throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", "graph-patch", "recorded patch bytes drifted");
    }
    const prior = this.#decisions.get(decision.patchId);
    if (prior !== undefined) {
      if (prior.canonicalJson !== decision.patch.canonicalJson
          || canonicalSerialize(prior.decision) !== canonicalSerialize(decision)) {
        throw new CycleControllerError("GE_PATCH_IDEMPOTENCY_CONFLICT", "graph-patch", "recorded patch decision conflicts");
      }
      return;
    }
    if (!sameCoordinate(decision.requestedBase, this.#coordinate)) {
      throw new CycleControllerError("GE_PATCH_STALE_BASE", "graph-patch", "recorded patch lineage is stale");
    }
    let application: GraphPatchApplication;
    if (decision.outcome === "accepted") {
      const candidate = snapshotJson({
        ...this.#graph,
        nodes: [...this.#graph.nodes, ...patch.append.nodes],
        edges: [...this.#graph.edges, ...patch.append.edges],
        outputs: outputMap(this.#graph.outputs, patch.append.outputs),
      }) as unknown as GraphSpec;
      const compilation = compileGraph(candidate);
      if (!compilation.valid || compilation.canonicalGraph === null || compilation.graphHash === null
          || compilation.graphHash !== decision.resultingRevision.body.graphHash
          || graphRevision(decision.resultingRevision.body).revisionHash !== decision.resultingRevision.revisionHash
          || this.#dynamicNodes + decision.budgetOutcome.committed.dynamicNodes > this.#options.maxDynamicNodes) {
        throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", "graph-patch", "recorded accepted patch does not rebuild its revision");
      }
      const compiledGraph = snapshotJson(JSON.parse(compilation.canonicalGraph)) as unknown as GraphSpec;
      if (compiledGraph.nodes.length > this.#options.limits.maxNodes
          || compiledGraph.edges.length > this.#options.limits.maxEdges
          || Object.keys(compiledGraph.outputs).length > this.#options.limits.maxOutputs
          || maximumDepth(compiledGraph) > this.#options.limits.maxDepth
          || maximumFanOut(compiledGraph) > this.#options.limits.maxFanOut) {
        throw new CycleControllerError("GE_CYCLE_INVALID_HISTORY", "graph-patch", "recorded patch exceeds graph limits");
      }
      this.#graph = compiledGraph;
      this.#coordinate = Object.freeze({
        graphRevision: decision.resultingRevision.body.graphRevision,
        graphHash: decision.resultingRevision.body.graphHash,
        revisionHash: decision.resultingRevision.revisionHash,
      });
      this.#dynamicNodes += decision.budgetOutcome.committed.dynamicNodes;
      application = Object.freeze({
        decision,
        graph: this.#graph,
        coordinate: this.#coordinate,
        dryRun: false,
        mutated: false,
      });
    } else {
      application = Object.freeze({
        decision,
        graph: this.#graph,
        coordinate: this.#coordinate,
        dryRun: false,
        mutated: false,
      });
    }
    this.#decisions.set(decision.patchId, {
      canonicalJson: decision.patch.canonicalJson,
      decision,
      application,
    });
  }

  #reject(
    patch: GraphPatch,
    patchHash: string,
    canonicalJson: string,
    context: GraphPatchApplyContext,
    code: GraphPatchErrorCode,
    phase: number,
    path: string,
  ): GraphPatchApplication {
    const requested = snapshotJson(context.reserved) as unknown as CycleBudgetDelta;
    const usage = context.activityUsage ?? { attempts: Math.min(1, requested.attempts), costUsd: 0 };
    const committed = Object.freeze({ attempts: usage.attempts, costUsd: usage.costUsd, dynamicNodes: 0 });
    const decision: GraphPatchRejectedDecision = Object.freeze({
      patchId: patch.patchId,
      patchHash,
      patch: createCycleInlinePayload(JSON.parse(canonicalJson)),
      requestedBase: patch.base,
      authoritySnapshot: context.authoritySnapshot,
      policySnapshotHash: context.policySnapshotHash,
      budgetOutcome: Object.freeze({
        reservationId: context.reservationId,
        requested,
        committed,
        released: subtractBudget(requested, committed),
      }),
      diagnostics: Object.freeze([diagnostic(code, phase, path)]),
      decidedAtDurationMs: context.durationMs,
      outcome: "rejected",
      errorCode: code,
    });
    const application: GraphPatchApplication = Object.freeze({
      decision,
      graph: this.#graph,
      coordinate: this.#coordinate,
      dryRun: context.dryRun ?? false,
      mutated: false,
    });
    this.#prepared.add(application);
    return application;
  }

  prepare(patchValue: GraphPatch | unknown, contextValue: GraphPatchApplyContext): GraphPatchApplication {
    const controllerRunId = "graph-patch";
    const patch = validateGraphPatchShape(patchValue, controllerRunId);
    const context = validateApplyContext(contextValue);
    const canonicalJson = canonicalSerialize(patch);
    const patchHash = canonicalHash(patch);
    const prior = this.#decisions.get(patch.patchId);
    if (prior !== undefined) {
      if (prior.canonicalJson !== canonicalJson) {
        throw new CycleControllerError(
          "GE_PATCH_IDEMPOTENCY_CONFLICT", controllerRunId,
          "a decided patch ID was reused with different canonical bytes", { patchId: patch.patchId },
        );
      }
      return Object.freeze({
        decision: prior.decision,
        graph: prior.application.graph,
        coordinate: prior.application.coordinate,
        dryRun: context.dryRun ?? false,
        mutated: false,
      });
    }
    const reject = (
      code: GraphPatchErrorCode,
      phase: number,
      path: string,
    ): GraphPatchApplication => this.#reject(
      patch, patchHash, canonicalJson, context, code, phase, path,
    );

    if (context.cancelled || context.runState === "terminal"
        || (context.runState === "paused" && !context.allowPausedMutation)) {
      return reject("GE_PATCH_STATE_CONFLICT", 5, "");
    }
    if (!sameCoordinate(patch.base, this.#coordinate)) return reject("GE_PATCH_STALE_BASE", 5, "/base");

    const baseNodeIds = new Set(this.#graph.nodes.map((node) => node.id));
    const baseEdgeIds = new Set(this.#graph.edges.map((edge) => edge.id));
    const baseOutputNames = new Set(Object.keys(this.#graph.outputs));
    const newNodeIds = new Set<string>();
    for (const [index, node] of patch.append.nodes.entries()) {
      if (baseNodeIds.has(node.id) || newNodeIds.has(node.id)) {
        return reject("GE_PATCH_DUPLICATE_ID", 6, `/append/nodes/${index}/id`);
      }
      newNodeIds.add(node.id);
    }
    const newEdgeIds = new Set<string>();
    const succeeded = new Set(context.succeededNodeIds ?? []);
    const supported = new Set(context.supportedEdgeModes ?? ["value"]);
    for (const [index, edge] of patch.append.edges.entries()) {
      if (baseEdgeIds.has(edge.id) || newEdgeIds.has(edge.id)) {
        return reject("GE_PATCH_DUPLICATE_ID", 6, `/append/edges/${index}/id`);
      }
      newEdgeIds.add(edge.id);
      if (baseNodeIds.has(edge.to.node)) {
        return reject("GE_PATCH_STATE_CONFLICT", 6, `/append/edges/${index}/to/node`);
      }
      if (baseNodeIds.has(edge.from.node) && !succeeded.has(edge.from.node)) {
        return reject("GE_PATCH_STATE_CONFLICT", 6, `/append/edges/${index}/from/node`);
      }
      if (!supported.has(edge.mode ?? "value")) {
        return reject("GE_PATCH_UNSUPPORTED", 6, `/append/edges/${index}/mode`);
      }
    }
    for (const name of Object.keys(patch.append.outputs).sort(compareUnicodeCodePoints)) {
      if (baseOutputNames.has(name)) return reject("GE_PATCH_DUPLICATE_ID", 6, `/append/outputs/${name}`);
    }

    const granted = new Set(context.effectiveCapabilities ?? []);
    for (const [index, node] of patch.append.nodes.entries()) {
      if (requestedCapabilities(node).some((capability) => !granted.has(capability))) {
        return reject("GE_PATCH_AUTHORITY_EXPANSION", 9, `/append/nodes/${index}/resources/capabilities`);
      }
    }
    if (context.deadlineMsRemaining <= 0) return reject("GE_PATCH_BUDGET_EXCEEDED", 10, "");
    const requestedDynamicNodes = patch.append.nodes.length;
    if (requestedDynamicNodes > context.reserved.dynamicNodes
        || this.#dynamicNodes + requestedDynamicNodes > this.#options.maxDynamicNodes) {
      return reject("GE_PATCH_BUDGET_EXCEEDED", 10, "/append/nodes");
    }

    const candidate = snapshotJson({
      ...this.#graph,
      nodes: [...this.#graph.nodes, ...patch.append.nodes],
      edges: [...this.#graph.edges, ...patch.append.edges],
      outputs: outputMap(this.#graph.outputs, patch.append.outputs),
    }) as unknown as GraphSpec;
    const compilation = compileGraph(candidate);
    if (!compilation.valid || compilation.canonicalGraph === null || compilation.graphHash === null) {
      return reject("GE_PATCH_GRAPH_INVALID", 8, "");
    }
    const compiledGraph = snapshotJson(JSON.parse(compilation.canonicalGraph)) as unknown as GraphSpec;
    if (compiledGraph.nodes.length > this.#options.limits.maxNodes
        || compiledGraph.edges.length > this.#options.limits.maxEdges
        || Object.keys(compiledGraph.outputs).length > this.#options.limits.maxOutputs
        || maximumDepth(compiledGraph) > this.#options.limits.maxDepth
        || maximumFanOut(compiledGraph) > this.#options.limits.maxFanOut) {
      return reject("GE_PATCH_BUDGET_EXCEEDED", 10, "");
    }

    const revision = graphRevision({
      apiVersion: "graphengineering.reacher-z.github.io/graph-revisions/v1alpha1",
      kind: "GraphRevision",
      graphRevision: patch.base.graphRevision + 1,
      previousRevisionHash: patch.base.revisionHash,
      patchHash,
      graphHash: compilation.graphHash,
    });
    const requested = snapshotJson(context.reserved) as unknown as CycleBudgetDelta;
    const usage = context.activityUsage ?? { attempts: Math.min(1, requested.attempts), costUsd: 0 };
    const committed = Object.freeze({
      attempts: usage.attempts,
      costUsd: usage.costUsd,
      dynamicNodes: requestedDynamicNodes,
    });
    const decision: GraphPatchAcceptedDecision = Object.freeze({
      patchId: patch.patchId,
      patchHash,
      patch: createCycleInlinePayload(patch),
      requestedBase: patch.base,
      authoritySnapshot: context.authoritySnapshot,
      policySnapshotHash: context.policySnapshotHash,
      budgetOutcome: Object.freeze({
        reservationId: context.reservationId,
        requested,
        committed,
        released: subtractBudget(requested, committed),
      }),
      diagnostics: Object.freeze([]),
      decidedAtDurationMs: context.durationMs,
      outcome: "accepted",
      resultingRevision: revision,
    });
    const application: GraphPatchApplication = Object.freeze({
      decision,
      graph: compiledGraph,
      coordinate: Object.freeze({
        graphRevision: revision.body.graphRevision,
        graphHash: revision.body.graphHash,
        revisionHash: revision.revisionHash,
      }),
      dryRun: context.dryRun ?? false,
      mutated: false,
    });
    this.#prepared.add(application);
    return application;
  }

  /** Commit a previously prepared decision after the caller's durable CAS. */
  commitPrepared(application: GraphPatchApplication): GraphPatchApplication {
    const decision = application.decision;
    const canonicalJson = decision.patch.canonicalJson;
    const prior = this.#decisions.get(decision.patchId);
    if (prior !== undefined) {
      if (prior.canonicalJson !== canonicalJson) {
        throw new CycleControllerError(
          "GE_PATCH_IDEMPOTENCY_CONFLICT", "graph-patch",
          "prepared patch conflicts with an existing decision", { patchId: decision.patchId },
        );
      }
      return Object.freeze({
        decision: prior.decision,
        graph: prior.application.graph,
        coordinate: prior.application.coordinate,
        dryRun: false,
        mutated: false,
      });
    }
    if (!this.#prepared.has(application)) {
      throw new CycleControllerError(
        "GE_PATCH_INVALID", "graph-patch", "application was not prepared by this applier",
      );
    }
    const recordsAnAlreadyStaleBase = decision.outcome === "rejected"
      && decision.errorCode === "GE_PATCH_STALE_BASE";
    if (!recordsAnAlreadyStaleBase && !sameCoordinate(decision.requestedBase, this.#coordinate)) {
      throw new CycleControllerError(
        "GE_PATCH_STALE_BASE", "graph-patch", "prepared patch lost its base CAS",
      );
    }
    if (decision.outcome === "accepted") {
      this.#graph = application.graph;
      this.#coordinate = application.coordinate;
      this.#dynamicNodes += decision.budgetOutcome.committed.dynamicNodes;
      this.#decisions.set(decision.patchId, {
        canonicalJson,
        decision,
        application: Object.freeze({ ...application, dryRun: false, mutated: false }),
      });
      return Object.freeze({ ...application, dryRun: false, mutated: true });
    }
    this.#decisions.set(decision.patchId, {
      canonicalJson,
      decision,
      application: Object.freeze({ ...application, dryRun: false, mutated: false }),
    });
    return Object.freeze({ ...application, dryRun: false, mutated: false });
  }

  apply(patchValue: GraphPatch | unknown, context: GraphPatchApplyContext): GraphPatchApplication {
    const prepared = this.prepare(patchValue, context);
    return prepared.dryRun ? prepared : this.commitPrepared(prepared);
  }
}
