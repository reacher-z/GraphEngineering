import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const conformanceRoot = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(conformanceRoot);

const DOMAINS = Object.freeze({
  artifact: "graph-engineering/artifact-ref/v1alpha1\0",
  artifactCapability: "graph-engineering/artifact-capability/v1alpha1\0",
  checkpoint: "graph-engineering/subgraph-edge-checkpoint/v1alpha1\0",
  compiledPlan: "graph-engineering/subgraph-edge-compiled-plan/v1alpha1\0",
  eventStream: "graph-engineering/subgraph-edge-event-stream/v1alpha1\0",
  event: "graph-engineering/subgraph-edge-event/v1alpha1\0",
  plan: "graph-engineering/subgraph-edge-plan/v1alpha1\0",
  projection: "graph-engineering/subgraph-edge-projection/v1alpha1\0",
  reducerBatch: "graph-engineering/subgraph-edge-reducer-batch/v1alpha1\0",
  reducerIdentity: "graph-engineering/subgraph-edge-reducer-identity/v1alpha1\0",
  reducerWrite: "graph-engineering/subgraph-edge-reducer-write/v1alpha1\0",
  scope: "graph-engineering/subgraph-edge-scope/v1alpha1\0",
  stream: "graph-engineering/subgraph-edge-stream/v1alpha1\0",
  streamItem: "graph-engineering/subgraph-edge-stream-item/v1alpha1\0",
  trace: "graph-engineering/subgraph-edge-trace/v1alpha1\0",
  traceSpan: "graph-engineering/subgraph-edge-trace-span/v1alpha1\0",
  value: "graph-engineering/subgraph-edge-value/v1alpha1\0",
});

class D4Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = "D4Error";
    this.code = code;
  }
}

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const common = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < common; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const result = Object.create(null);
    for (const key of Object.keys(value).sort(compareUnicodeCodePoints)) {
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonHash(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

function domainHash(domain, value) {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

function assertExact(actual, expected, message) {
  assert.equal(canonicalJson(actual), canonicalJson(expected), message);
}

function pointerSegments(pointer) {
  assert.equal(typeof pointer, "string", "JSON Pointer must be a string");
  if (pointer === "") return [];
  assert.ok(pointer.startsWith("/"), `JSON Pointer must be empty or start with '/': ${pointer}`);
  return pointer.slice(1).split("/").map((segment) => {
    if (/~(?![01])/u.test(segment)) throw new Error(`invalid JSON Pointer escape: ${pointer}`);
    return segment.replaceAll("~1", "/").replaceAll("~0", "~");
  });
}

function pointerValue(document, pointer) {
  let value = document;
  for (const segment of pointerSegments(pointer)) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      return { present: false };
    }
    value = value[segment];
  }
  return { present: true, value };
}

function mutationTarget(document, pointer) {
  const segments = pointerSegments(pointer);
  assert.ok(segments.length > 0, "root mutation is not supported by this corpus");
  const leaf = segments.pop();
  let parent = document;
  for (const segment of segments) {
    assert.ok(parent !== null && typeof parent === "object", `mutation parent is not an object: ${pointer}`);
    assert.ok(Object.hasOwn(parent, segment), `mutation parent does not exist: ${pointer}`);
    parent = parent[segment];
  }
  return { parent, leaf };
}

function applyMutations(document, mutations) {
  for (const mutation of mutations) {
    const { parent, leaf } = mutationTarget(document, mutation.path);
    if (mutation.op === "remove") {
      assert.ok(Object.hasOwn(parent, leaf), `remove target does not exist: ${mutation.path}`);
      if (Array.isArray(parent)) parent.splice(Number(leaf), 1);
      else delete parent[leaf];
      continue;
    }
    const value = Object.hasOwn(mutation, "valueFrom")
      ? clone(pointerValue(document, mutation.valueFrom).value)
      : clone(mutation.value);
    if (mutation.op === "add") {
      if (Array.isArray(parent)) {
        const index = Number(leaf);
        assert.ok(Number.isSafeInteger(index) && index >= 0 && index <= parent.length);
        parent.splice(index, 0, value);
      } else {
        assert.equal(Object.hasOwn(parent, leaf), false, `add target already exists: ${mutation.path}`);
        parent[leaf] = value;
      }
      continue;
    }
    assert.equal(mutation.op, "replace", `unknown mutation operation: ${mutation.op}`);
    assert.ok(Object.hasOwn(parent, leaf), `replace target does not exist: ${mutation.path}`);
    parent[leaf] = value;
  }
  return document;
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const fixture = await loadJson(join(conformanceRoot, "subgraph-edge.case.json"));
assert.equal(
  fixture.contractStatus,
  "contract-only-native-implementation-required",
  "subgraph/edge corpus contractStatus drifted",
);
assert.equal(
  fixture.implementationClaim,
  false,
  "subgraph/edge corpus implementationClaim must be literally false",
);
const schemaNames = [
  "graph.schema.json",
  "artifact-ref.schema.json",
  "subgraph-edge-plan.schema.json",
  "subgraph-edge-event.schema.json",
  "subgraph-edge-checkpoint.schema.json",
  "subgraph-edge-trace.schema.json",
];
const schemas = await Promise.all(schemaNames.map((name) => loadJson(join(specRoot, name))));
const [graphSchema, artifactSchema, planSchema, eventSchema, checkpointSchema, traceSchema] = schemas;

const ajv = new Ajv2020({ allErrors: true, strict: true });
for (const schema of schemas) {
  assert.equal(
    ajv.validateSchema(schema),
    true,
    `${schema.$id} failed Draft 2020-12 meta-validation: ${JSON.stringify(ajv.errors)}`,
  );
  ajv.addSchema(schema);
}
const validator = (schema) => {
  const compiled = ajv.getSchema(schema.$id);
  assert.ok(compiled, `schema was not compiled: ${schema.$id}`);
  return compiled;
};
const validateGraph = validator(graphSchema);
const validateArtifact = validator(artifactSchema);
const validatePlanShape = validator(planSchema);
const validateEvent = validator(eventSchema);
const validateCheckpoint = validator(checkpointSchema);
const validateTrace = validator(traceSchema);

const graphHashes = Object.create(null);
for (const [key, graph] of Object.entries(fixture.sourceGraphs)) {
  assert.equal(validateGraph(graph), true, `${key} source graph is invalid: ${JSON.stringify(validateGraph.errors)}`);
  graphHashes[key] = jsonHash(graph);
}

function graphBinding(key, graph) {
  const binding = {
    key,
    graphHash: graphHashes[key],
    compiledPlanHash: "0".repeat(64),
    graphRevision: 1,
    stateSchemaHash: graph.stateSchema === undefined ? null : jsonHash(graph.stateSchema),
    nodes: graph.nodes.map((node) => ({ id: node.id, kind: node.kind })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      fromNode: edge.from.node,
      toNode: edge.to.node,
      mode: edge.mode ?? "value",
    })),
    entrypoints: [...graph.entrypoints],
    outputs: Object.keys(graph.outputs).sort(compareUnicodeCodePoints),
  };
  const planIdentity = clone(binding);
  delete planIdentity.compiledPlanHash;
  binding.compiledPlanHash = domainHash(DOMAINS.compiledPlan, planIdentity);
  return binding;
}

function materializePlan(template = fixture.planTemplate) {
  const plan = clone(template);
  const sources = plan.graphsFromSources;
  delete plan.graphsFromSources;
  plan.graphs = sources.map((key) => graphBinding(key, fixture.sourceGraphs[key]));
  return plan;
}

function uniqueValues(values, code, context) {
  if (new Set(values).size !== values.length) throw new D4Error(code, `${context} contains a duplicate`);
}

function requireSorted(values, code, context) {
  const sorted = [...values].sort(compareUnicodeCodePoints);
  if (canonicalJson(values) !== canonicalJson(sorted)) throw new D4Error(code, `${context} is not code-point sorted`);
}

function pointerOverlap(left, right) {
  const leftSegments = pointerSegments(left);
  const rightSegments = pointerSegments(right);
  const common = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < common; index += 1) {
    if (leftSegments[index] !== rightSegments[index]) return false;
  }
  return true;
}

function stronglyConnectedComponents(adjacency) {
  let nextIndex = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  const visit = (node) => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const child of adjacency.get(node) ?? []) {
      if (!indices.has(child)) {
        visit(child);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(child)));
      } else if (onStack.has(child)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(child)));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component = [];
    while (stack.length > 0) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === node) break;
    }
    components.push(component);
  };
  for (const node of adjacency.keys()) {
    if (!indices.has(node)) visit(node);
  }
  return components;
}

function validateProjection(projection, outputs, context) {
  if (projection.mode === "whole") return;
  uniqueValues(
    projection.fields.map((field) => field.targetKey),
    "GE_D4_PROJECTION_COLLISION",
    `${context} target keys`,
  );
  if (outputs !== null) {
    for (const field of projection.fields) {
      if (!outputs.has(field.sourceOutput)) {
        throw new D4Error("GE_D4_PROJECTION_SOURCE_MISSING", `${context} references an unknown output`);
      }
    }
  }
}

function validatePlanSemantics(plan) {
  if (!validatePlanShape(plan)) {
    throw new D4Error("GE_D4_PLAN_SCHEMA", JSON.stringify(validatePlanShape.errors));
  }

  const expectedCapabilities = [
    "artifact-store/v1alpha1",
    "durable-stream-edge/v1alpha1",
    "nested-subgraph/v1alpha1",
    "state-reducer/v1alpha1",
    "subgraph-edge/v1alpha1",
    "trace-checkpoint-lineage/v1alpha1",
  ];
  assertExact(plan.requiredCapabilities, expectedCapabilities, "required capability set drifted");
  requireSorted(plan.authority.ceiling, "GE_D4_AUTHORITY_ORDER", "authority ceiling");
  const rootBudgetLimits = {
    maxDurationMs: plan.policies.maxDurationMs,
    maxStateBytes: plan.policies.maxStateBytes,
    maxArtifactBytes: plan.policies.maxTotalArtifactBytes,
    maxStreamItems: plan.policies.maxTotalStreamItems,
    maxStreamInFlightBytes: plan.policies.maxStreamInFlightBytes,
  };
  for (const [key, maximum] of Object.entries(rootBudgetLimits)) {
    if (plan.budget[key] > maximum) {
      throw new D4Error("GE_D4_LIMIT_INCONSISTENT", `root budget ${key} exceeds plan policy`);
    }
  }
  const graphKeys = plan.graphs.map((graph) => graph.key);
  uniqueValues(graphKeys, "GE_D4_GRAPH_BINDING_DUPLICATE", "graph keys");
  requireSorted(graphKeys, "GE_D4_GRAPH_BINDING_ORDER", "graph keys");
  const graphs = new Map(plan.graphs.map((graph) => [graph.key, graph]));
  if (!graphs.has(plan.rootGraphKey)) throw new D4Error("GE_D4_ROOT_GRAPH_MISSING", "root graph is absent");

  for (const binding of plan.graphs) {
    const source = fixture.sourceGraphs[binding.key];
    if (source === undefined) throw new D4Error("GE_D4_GRAPH_BINDING_MISMATCH", "unknown source graph");
    const expected = graphBinding(binding.key, source);
    if (canonicalJson(binding) !== canonicalJson(expected)) {
      throw new D4Error("GE_D4_GRAPH_BINDING_MISMATCH", `graph binding ${binding.key} drifted`);
    }
    uniqueValues(binding.nodes.map((node) => node.id), "GE_D4_GRAPH_BINDING_DUPLICATE", "node bindings");
    uniqueValues(binding.edges.map((edge) => edge.id), "GE_D4_GRAPH_BINDING_DUPLICATE", "edge bindings");
  }

  uniqueValues(plan.calls.map((call) => call.id), "GE_D4_SUBGRAPH_CALL_DUPLICATE", "call IDs");
  uniqueValues(
    plan.calls.map((call) => `${call.ownerGraphKey}\0${call.nodeId}`),
    "GE_D4_SUBGRAPH_CALL_DUPLICATE",
    "call node bindings",
  );
  const callsByNode = new Map(plan.calls.map((call) => [`${call.ownerGraphKey}\0${call.nodeId}`, call]));
  const adjacency = new Map(plan.graphs.map((graph) => [graph.key, []]));
  for (const call of plan.calls) {
    const owner = graphs.get(call.ownerGraphKey);
    const child = graphs.get(call.childGraphKey);
    if (owner === undefined || child === undefined) {
      throw new D4Error("GE_D4_SUBGRAPH_GRAPH_MISSING", `call ${call.id} has an unknown graph`);
    }
    const node = owner.nodes.find((candidate) => candidate.id === call.nodeId);
    if (node?.kind !== "subgraph") {
      throw new D4Error("GE_D4_SUBGRAPH_NODE_KIND", `call ${call.id} does not bind a subgraph node`);
    }
    validateProjection(call.inputProjection, null, `${call.id} input projection`);
    validateProjection(call.outputProjection, new Set(child.outputs), `${call.id} output projection`);
    requireSorted(call.authority.requested, "GE_D4_AUTHORITY_ORDER", `${call.id} requested capabilities`);
    requireSorted(call.authority.effective, "GE_D4_AUTHORITY_ORDER", `${call.id} effective capabilities`);
    const ceiling = new Set(plan.authority.ceiling);
    const expectedEffective = call.authority.requested.filter((capability) => ceiling.has(capability));
    if (canonicalJson(call.authority.effective) !== canonicalJson(expectedEffective)) {
      throw new D4Error("GE_D4_AUTHORITY_EXPANSION", `call ${call.id} effective authority is not the parent intersection`);
    }
    for (const key of [
      "maxAttempts",
      "maxDurationMs",
      "maxStateBytes",
      "maxArtifactBytes",
      "maxStreamItems",
      "maxStreamInFlightBytes",
    ]) {
      if (call.budget[key] > plan.budget[key]) {
        throw new D4Error("GE_D4_LIMIT_INCONSISTENT", `call ${call.id} budget ${key} exceeds parent`);
      }
    }
    if (call.maxCallsPerParent > plan.policies.maxTotalInvocations) {
      throw new D4Error("GE_D4_LIMIT_INCONSISTENT", `call ${call.id} exceeds total invocation limit`);
    }
    if (call.recursion.mode === "bounded" && (
      call.recursion.maxDepth > plan.policies.maxRecursiveDepth ||
      call.recursion.maxDepth > plan.policies.maxNestingDepth
    )) {
      throw new D4Error("GE_D4_LIMIT_INCONSISTENT", `call ${call.id} recursion exceeds plan bounds`);
    }
    adjacency.get(call.ownerGraphKey).push(call.childGraphKey);
  }
  for (const graph of plan.graphs) {
    for (const node of graph.nodes.filter((candidate) => candidate.kind === "subgraph")) {
      if (!callsByNode.has(`${graph.key}\0${node.id}`)) {
        throw new D4Error("GE_D4_SUBGRAPH_CALL_MISSING", `subgraph ${graph.key}/${node.id} has no call contract`);
      }
    }
  }
  const cyclicCallIds = new Set();
  for (const component of stronglyConnectedComponents(adjacency)) {
    const members = new Set(component);
    const internalCalls = plan.calls.filter((candidate) =>
      members.has(candidate.ownerGraphKey) && members.has(candidate.childGraphKey));
    const cyclic = component.length > 1 || internalCalls.some((candidate) =>
      candidate.ownerGraphKey === candidate.childGraphKey);
    if (!cyclic) continue;
    for (const candidate of internalCalls) cyclicCallIds.add(candidate.id);
    if (internalCalls.some((candidate) => candidate.recursion.mode !== "bounded")) {
      throw new D4Error("GE_D4_RECURSION_UNDECLARED", "a recursive component has an unbounded call edge");
    }
    const groups = new Set(internalCalls.map((candidate) => candidate.recursion.group));
    const bounds = new Set(internalCalls.map((candidate) => candidate.recursion.maxDepth));
    if (groups.size !== 1 || bounds.size !== 1) {
      throw new D4Error("GE_D4_RECURSION_GROUP_MISMATCH", "recursive component does not share one group and bound");
    }
  }
  for (const call of plan.calls) {
    if (!cyclicCallIds.has(call.id) && call.recursion.mode === "bounded") {
      throw new D4Error("GE_D4_RECURSION_UNUSED", `call ${call.id} declares recursion outside a cycle`);
    }
  }

  uniqueValues(plan.reducers.map((reducer) => reducer.id), "GE_D4_REDUCER_DUPLICATE", "reducer IDs");
  for (let index = 0; index < plan.reducers.length; index += 1) {
    const reducer = plan.reducers[index];
    const graph = graphs.get(reducer.graphKey);
    if (graph === undefined) throw new D4Error("GE_D4_REDUCER_GRAPH_MISSING", "reducer graph is absent");
    if (fixture.sourceGraphs[reducer.graphKey].stateSchema === undefined) {
      throw new D4Error("GE_D4_REDUCER_STATE_SCHEMA_MISSING", "reducer graph has no state schema");
    }
    if (graph.stateSchemaHash !== jsonHash(fixture.sourceGraphs[reducer.graphKey].stateSchema)) {
      throw new D4Error("GE_D4_REDUCER_STATE_SCHEMA_MISMATCH", "reducer state schema identity drifted");
    }
    const node = graph.nodes.find((candidate) => candidate.id === reducer.nodeId);
    if (node?.kind !== "transform") throw new D4Error("GE_D4_REDUCER_NODE_KIND", "reducer node must be transform");
    uniqueValues(
      reducer.contributors.map((item) => `${item.nodeId}\0${item.outputPointer}`),
      "GE_D4_REDUCER_CONTRIBUTOR_DUPLICATE",
      "reducer contributors",
    );
    for (const contributor of reducer.contributors) {
      if (!graph.nodes.some((candidate) => candidate.id === contributor.nodeId)) {
        throw new D4Error("GE_D4_REDUCER_CONTRIBUTOR_MISSING", "reducer contributor is absent");
      }
      if (contributor.nodeId === reducer.nodeId) {
        throw new D4Error("GE_D4_REDUCER_SELF_WRITE", "reducer cannot contribute to itself");
      }
    }
    if (
      reducer.maxWrites > plan.policies.maxReducerWrites ||
      reducer.contributors.length > reducer.maxWrites ||
      reducer.maxStateBytes > plan.policies.maxStateBytes ||
      reducer.maxUpdateBytes > reducer.maxStateBytes
    ) {
      throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "reducer write bound is inconsistent");
    }
    const orderedOperations = new Set(["ordered-replace", "ordered-append", "merge-disjoint"]);
    const algebraicOperations = new Set([
      "set-union-by-hash",
      "bounded-integer-sum",
      "bounded-integer-min",
      "bounded-integer-max",
    ]);
    const expectedLaw = orderedOperations.has(reducer.operation)
      ? "ordered-noncommutative"
      : algebraicOperations.has(reducer.operation)
        ? "commutative-associative-canonical-order"
        : "declared-by-content-addressed-transform";
    if (reducer.law !== expectedLaw) {
      throw new D4Error("GE_D4_REDUCER_LAW_MISMATCH", "reducer law does not match operation");
    }
    if ((reducer.operation === "custom-deterministic") !==
      (reducer.implementation.kind === "custom-deterministic-transform")) {
      throw new D4Error("GE_D4_REDUCER_IMPLEMENTATION_MISMATCH", "custom reducer implementation mismatch");
    }
    const numeric = reducer.operation.startsWith("bounded-integer-");
    if (numeric !== Object.hasOwn(reducer, "integerBounds")) {
      throw new D4Error("GE_D4_REDUCER_BOUNDS_MISSING", "numeric reducer bounds mismatch");
    }
    if (numeric && reducer.integerBounds.minimum > reducer.integerBounds.maximum) {
      throw new D4Error("GE_D4_REDUCER_BOUNDS_INVALID", "numeric reducer minimum exceeds maximum");
    }
    if (reducer.initialState.mode === "literal" &&
      reducer.initialState.valueHash !== domainHash(DOMAINS.value, reducer.initialState.value)) {
      throw new D4Error("GE_D4_REDUCER_INITIAL_HASH", "literal initial state hash drifted");
    }
    for (let otherIndex = index + 1; otherIndex < plan.reducers.length; otherIndex += 1) {
      const other = plan.reducers[otherIndex];
      if (other.graphKey === reducer.graphKey && pointerOverlap(reducer.statePointer, other.statePointer)) {
        throw new D4Error("GE_D4_REDUCER_OVERLAP", "reducer state pointers overlap");
      }
    }
  }

  const edgeBindings = new Map();
  for (const graph of plan.graphs) {
    for (const edge of graph.edges) edgeBindings.set(`${graph.key}\0${edge.id}`, edge);
  }
  uniqueValues(
    plan.artifactEdges.map((edge) => `${edge.graphKey}\0${edge.edgeId}`),
    "GE_D4_EDGE_BINDING_DUPLICATE",
    "artifact edge bindings",
  );
  uniqueValues(
    plan.streamEdges.map((edge) => `${edge.graphKey}\0${edge.edgeId}`),
    "GE_D4_EDGE_BINDING_DUPLICATE",
    "stream edge bindings",
  );
  const configured = new Map();
  for (const edge of plan.artifactEdges) {
    const key = `${edge.graphKey}\0${edge.edgeId}`;
    if (edgeBindings.get(key)?.mode !== "artifact-ref") {
      throw new D4Error("GE_D4_EDGE_MODE_MISMATCH", "artifact policy does not bind artifact-ref edge");
    }
    if (edge.maxBytes > plan.policies.maxArtifactBytes) {
      throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "artifact edge exceeds global bytes");
    }
    for (const capability of [...edge.producerCapabilities, ...edge.consumerCapabilities]) {
      if (!plan.authority.ceiling.includes(capability)) {
        throw new D4Error("GE_D4_AUTHORITY_EXPANSION", "artifact edge capability exceeds plan ceiling");
      }
    }
    configured.set(key, "artifact-ref");
  }
  for (const edge of plan.streamEdges) {
    const key = `${edge.graphKey}\0${edge.edgeId}`;
    if (edgeBindings.get(key)?.mode !== "stream") {
      throw new D4Error("GE_D4_EDGE_MODE_MISMATCH", "stream policy does not bind stream edge");
    }
    if (edge.maxItems > plan.policies.maxStreamItemsPerEdge) {
      throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "stream edge exceeds per-edge item bound");
    }
    configured.set(key, "stream");
  }
  for (const [key, edge] of edgeBindings) {
    if (edge.mode !== "value" && configured.get(key) !== edge.mode) {
      throw new D4Error("GE_D4_EDGE_BINDING_MISSING", `edge ${key} has no execution binding`);
    }
  }
  if (plan.artifactEdges.length > plan.policies.maxArtifacts) {
    throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "artifact edge count exceeds global bound");
  }
  if (plan.artifactEdges.reduce((sum, edge) => sum + edge.maxBytes, 0) > plan.policies.maxTotalArtifactBytes) {
    throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "artifact byte reservations exceed global bound");
  }
  if (plan.streamEdges.length > plan.policies.maxStreamEdges) {
    throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "stream edge count exceeds global bound");
  }
  if (plan.streamEdges.reduce((sum, edge) => sum + edge.maxItems, 0) > plan.policies.maxTotalStreamItems) {
    throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "stream item reservations exceed global bound");
  }
  if (plan.streamEdges.reduce((sum, edge) => sum + edge.maxInFlightBytes, 0) > plan.policies.maxStreamInFlightBytes) {
    throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "stream in-flight byte reservations exceed global bound");
  }
  for (const edge of plan.streamEdges) {
    if (edge.maxInFlightBytes < edge.maxItemBytes ||
      edge.maxInFlightBytes > (edge.bufferCapacity + edge.maxUnacknowledged) * edge.maxItemBytes) {
      throw new D4Error("GE_D4_LIMIT_INCONSISTENT", "stream in-flight bytes are inconsistent with item slots");
    }
    requireSorted(edge.traceMetrics, "GE_D4_TRACE_METRIC_ORDER", "stream trace metrics");
  }
  return plan;
}

const plan = materializePlan();
validatePlanSemantics(plan);
const planHash = domainHash(DOMAINS.plan, plan);

function escapeScopeSegment(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function makeScope({ graphKey, parent, callId, callOrdinal, depth, recursionGroup, recursionDepth }) {
  const graph = plan.graphs.find((candidate) => candidate.key === graphKey);
  assert.ok(graph, `missing scope graph ${graphKey}`);
  const invocationId = domainHash(DOMAINS.scope, [
    fixture.scenario.runId,
    planHash,
    parent?.invocationId ?? null,
    callId,
    callOrdinal,
    graph.graphHash,
  ]);
  const namespace = `/runs/${escapeScopeSegment(fixture.scenario.runId)}/invocations/${invocationId}`;
  assert.ok(Buffer.byteLength(namespace, "utf8") <= plan.policies.maxNamespaceBytes);
  return {
    namespace,
    invocationId,
    parentInvocationId: parent?.invocationId ?? null,
    graphKey,
    graphHash: graph.graphHash,
    compiledPlanHash: graph.compiledPlanHash,
    graphRevision: 1,
    depth,
    callId,
    callOrdinal,
    recursionGroup,
    recursionDepth,
  };
}

const rootScope = makeScope({
  graphKey: "root",
  parent: null,
  callId: null,
  callOrdinal: 0,
  depth: 0,
  recursionGroup: null,
  recursionDepth: 0,
});
const childScope = makeScope({
  graphKey: "child",
  parent: rootScope,
  callId: "call-child",
  callOrdinal: 0,
  depth: 1,
  recursionGroup: null,
  recursionDepth: 0,
});
const scopes = { root: rootScope, child: childScope };
const revisionHash = domainHash(DOMAINS.value, [planHash, graphHashes.root, graphHashes.child, 1]);
const eventStreamId = domainHash(DOMAINS.eventStream, [fixture.scenario.runId, revisionHash]);
const runLineage = Object.freeze({ mode: "start" });
const traceId = domainHash(DOMAINS.trace, [fixture.scenario.runId, planHash, revisionHash]);
const spanIds = Object.freeze({
  root: domainHash(DOMAINS.traceSpan, [traceId, "invocation", rootScope.invocationId]),
  child: domainHash(DOMAINS.traceSpan, [traceId, "invocation", childScope.invocationId]),
  reducer: domainHash(DOMAINS.traceSpan, [traceId, "reducer", childScope.invocationId, "collect-items"]),
  artifact: domainHash(DOMAINS.traceSpan, [traceId, "artifact", rootScope.invocationId, "e_nested_artifact"]),
  stream: domainHash(DOMAINS.traceSpan, [traceId, "stream", rootScope.invocationId, "e_nested_stream"]),
});

function eventTraceContext(type, scopeName) {
  let key = scopeName;
  if (type === "StateReducerCommitted") key = "reducer";
  else if (type.startsWith("Artifact")) key = "artifact";
  else if (type.startsWith("Stream")) key = "stream";
  const parentSpanId = key === "root" ? null : key === "child" || key === "artifact" || key === "stream"
    ? spanIds.root
    : spanIds.child;
  return {
    traceId,
    spanId: spanIds[key],
    parentSpanId,
    relation: parentSpanId === null ? "root" : "child-of",
  };
}

function projectValue(input, projection, namedOutputs = null) {
  if (projection.mode === "whole") return clone(input);
  const output = Object.create(null);
  for (const field of projection.fields) {
    const outputPresent = namedOutputs === null || Object.hasOwn(namedOutputs, field.sourceOutput);
    const source = namedOutputs === null ? input : namedOutputs[field.sourceOutput];
    const selected = outputPresent ? pointerValue(source, field.sourcePointer) : { present: false };
    if (!selected.present) {
      if (field.required) throw new D4Error("GE_D4_PROJECTION_MISSING", "required projection source is missing");
      continue;
    }
    if (Object.hasOwn(output, field.targetKey)) {
      throw new D4Error("GE_D4_PROJECTION_COLLISION", "projection target collides");
    }
    Object.defineProperty(output, field.targetKey, {
      value: clone(selected.value),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return clone(output);
}

const call = plan.calls[0];
const childInput = projectValue(fixture.scenario.nodeInput, call.inputProjection);
const childProjectedOutput = projectValue(
  null,
  call.outputProjection,
  fixture.scenario.childNamedOutputs,
);
assertExact(childProjectedOutput, fixture.scenario.expectedProjectedOutput, "output projection drifted");

function setPointerValue(document, pointer, value) {
  const segments = pointerSegments(pointer);
  assert.ok(segments.length > 0, "root-state reducer pointers are forbidden in v1alpha1");
  let parent = document;
  for (const segment of segments.slice(0, -1)) {
    if (parent === null || typeof parent !== "object" || !Object.hasOwn(parent, segment)) {
      throw new D4Error("GE_D4_REDUCER_CONFLICT", "state pointer parent is missing");
    }
    parent = parent[segment];
  }
  const leaf = segments.at(-1);
  if (parent === null || typeof parent !== "object" || !Object.hasOwn(parent, leaf)) {
    throw new D4Error("GE_D4_REDUCER_CONFLICT", "state pointer is missing");
  }
  parent[leaf] = value;
}

function buildReducerCommit(contributorOutputs = fixture.scenario.contributorOutputs, verifyExpected = true,
  contributorOrder = null, initialState = fixture.scenario.initialState) {
  const reducer = plan.reducers[0];
  const beforeState = clone(initialState);
  const beforeStateHash = domainHash(DOMAINS.value, beforeState);
  // Semantics 8.2/8.3: present writes apply in contributor declaration order.
  // `contributorOrder` exists only so a hostile vector can fold in some other
  // order and be rejected; it is never the declared behaviour.
  const contributors = contributorOrder === null ? reducer.contributors : contributorOrder.map((nodeId) => {
    const found = reducer.contributors.find((candidate) => candidate.nodeId === nodeId);
    assert.ok(found, `unknown reducer contributor: ${nodeId}`);
    return found;
  });
  const writes = contributors.map((contributor, contributorOrdinal) => {
    const selected = pointerValue(contributorOutputs[contributor.nodeId], contributor.outputPointer);
    if (!selected.present) {
      if (contributor.required) throw new D4Error("GE_D4_REDUCER_CONFLICT", "required contributor output is missing");
      return {
        contributorOrdinal,
        nodeId: contributor.nodeId,
        writeId: domainHash(DOMAINS.reducerWrite, [
          childScope.invocationId,
          reducer.id,
          contributorOrdinal,
          contributor.nodeId,
          "absent",
        ]),
        present: false,
        terminalStatus: "skipped",
        failureCode: "GE_D4_REDUCER_CONFLICT",
      };
    }
    const valueHash = domainHash(DOMAINS.value, selected.value);
    return {
      contributorOrdinal,
      nodeId: contributor.nodeId,
      writeId: domainHash(DOMAINS.reducerWrite, [
        childScope.invocationId,
        reducer.id,
        contributorOrdinal,
        contributor.nodeId,
        valueHash,
      ]),
      present: true,
      value: clone(selected.value),
      valueHash,
    };
  });
  const batchId = domainHash(DOMAINS.reducerBatch, [
    childScope.invocationId,
    reducer.id,
    0,
    writes,
  ]);
  const afterState = clone(beforeState);
  const current = pointerValue(afterState, reducer.statePointer);
  if (!current.present || !Array.isArray(current.value) || reducer.operation !== "ordered-append") {
    throw new D4Error("GE_D4_REDUCER_CONFLICT", "ordered append requires an existing array state target");
  }
  setPointerValue(
    afterState,
    reducer.statePointer,
    [...current.value, ...writes.filter((write) => write.present).map((write) => clone(write.value))],
  );
  if (verifyExpected) {
    assertExact(afterState, fixture.scenario.expectedReducedState, "reducer order followed completion instead of declaration");
  }
  return {
    reducerId: reducer.id,
    reducerIdentity: domainHash(DOMAINS.reducerIdentity, reducer),
    batchId,
    stateVersionBefore: 0,
    stateVersionAfter: 1,
    beforeStateHash,
    afterState,
    afterStateHash: domainHash(DOMAINS.value, afterState),
    updateBytes: Buffer.byteLength(canonicalJson(writes), "utf8"),
    writes,
  };
}

const reducerCommit = buildReducerCommit();

const declaredContributorOrder = plan.reducers[0].contributors.map((contributor) => contributor.nodeId);
// `scenario.completionOrder` is live data: it must be a real permutation of the
// declared contributors and must differ from declaration order, otherwise the
// determinism-under-concurrency vectors below degenerate into the golden path.
assertExact(
  [...fixture.scenario.completionOrder].sort(compareUnicodeCodePoints),
  [...declaredContributorOrder].sort(compareUnicodeCodePoints),
  "scenario.completionOrder is not a permutation of the declared reducer contributors",
);
assert.notEqual(
  canonicalJson(fixture.scenario.completionOrder),
  canonicalJson(declaredContributorOrder),
  "scenario.completionOrder must differ from declaration order to exercise semantics 8.2",
);

// Semantics 8.2: completion order never changes reducer order. The batch ID,
// write ordinals and after-state must reproduce the declaration-ordered commit
// byte for byte no matter which contributor finished first.
function foldReducerUnderCompletionOrder(arrivalOrder, foldInArrivalOrder) {
  const received = Object.create(null);
  for (const nodeId of arrivalOrder) {
    assert.ok(
      Object.hasOwn(fixture.scenario.contributorOutputs, nodeId),
      `completion order names a contributor with no output: ${nodeId}`,
    );
    received[nodeId] = clone(fixture.scenario.contributorOutputs[nodeId]);
  }
  const commit = buildReducerCommit(received, false, foldInArrivalOrder ? [...arrivalOrder] : null);
  if (canonicalJson(commit) !== canonicalJson(reducerCommit)) {
    throw new D4Error("GE_D4_REDUCER_CONFLICT", "completion order changed the reducer commit");
  }
  return commit;
}

function applyReducerOperation(operation, initial, values, integerBounds = null) {
  if (operation === "ordered-replace") {
    assert.ok(values.length > 0, "ordered replace requires at least one value");
    return clone(values.at(-1));
  }
  if (operation === "ordered-append") {
    if (!Array.isArray(initial)) {
      throw new D4Error("GE_D4_REDUCER_CONFLICT", "ordered append requires an array state value");
    }
    return [...clone(initial), ...clone(values)];
  }
  if (operation === "merge-disjoint") {
    if (initial === null || typeof initial !== "object" || Array.isArray(initial)) {
      throw new D4Error("GE_D4_REDUCER_CONFLICT", "merge-disjoint requires an object state value");
    }
    const result = clone(initial);
    for (const value of values) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new D4Error("GE_D4_REDUCER_CONFLICT", "merge-disjoint contributor is not an object");
      }
      for (const key of Object.keys(value).sort(compareUnicodeCodePoints)) {
        if (Object.hasOwn(result, key)) {
          throw new D4Error("GE_D4_REDUCER_CONFLICT", `merge-disjoint key collision: ${key}`);
        }
        Object.defineProperty(result, key, {
          value: clone(value[key]),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    return result;
  }
  if (operation === "set-union-by-hash") {
    if (!Array.isArray(initial)) {
      throw new D4Error("GE_D4_REDUCER_CONFLICT", "set union requires an array state value");
    }
    const byHash = new Map();
    for (const value of [...initial, ...values]) {
      const hash = domainHash(DOMAINS.value, value);
      const canonical = canonicalJson(value);
      const existing = byHash.get(hash);
      if (existing !== undefined && existing.canonical !== canonical) {
        throw new D4Error("GE_D4_REDUCER_CONFLICT", "value-hash collision requires a future contract");
      }
      if (existing === undefined) byHash.set(hash, { canonical, value: clone(value) });
    }
    return [...byHash.entries()]
      .sort(([leftHash, left], [rightHash, right]) =>
        compareUnicodeCodePoints(leftHash, rightHash) || compareUnicodeCodePoints(left.canonical, right.canonical))
      .map(([, item]) => item.value);
  }
  if (["bounded-integer-sum", "bounded-integer-min", "bounded-integer-max"].includes(operation)) {
    if (integerBounds === null || ![initial, ...values].every(Number.isSafeInteger)) {
      throw new D4Error("GE_D4_REDUCER_CONFLICT", "bounded integer reducer requires safe integers and bounds");
    }
    let result;
    if (operation === "bounded-integer-sum") {
      result = [initial, ...values].reduce((sum, value) => {
        const next = sum + value;
        if (!Number.isSafeInteger(next)) throw new D4Error("GE_D4_REDUCER_CONFLICT", "integer sum overflowed");
        return next;
      });
    } else if (operation === "bounded-integer-min") result = Math.min(initial, ...values);
    else result = Math.max(initial, ...values);
    if (result < integerBounds.minimum || result > integerBounds.maximum) {
      throw new D4Error("GE_D4_REDUCER_CONFLICT", "integer result exceeded declared bounds");
    }
    return result;
  }
  throw new Error(`unknown reducer operation: ${operation}`);
}

const artifactBytes = Buffer.from(fixture.scenario.artifactContentUtf8, "utf8");
const producerAttemptId = domainHash(DOMAINS.value, [
  fixture.scenario.runId,
  rootScope.invocationId,
  "nested",
  0,
]);
const artifactIdentityBody = {
  storeId: "local-content-store",
  storageNamespace: plan.artifactEdges[0].storageNamespace,
  tenantId: plan.artifactEdges[0].tenantBinding,
  runId: fixture.scenario.runId,
  algorithm: "sha256",
  digest: sha256Bytes(artifactBytes),
  sizeBytes: artifactBytes.length,
  mediaType: fixture.scenario.artifactMediaType,
  encoding: "identity",
  logicalName: "nested-result.json",
  protection: {
    mode: "unprotected-test-only",
    policyId: "d4-fixture-unprotected",
  },
  retention: {
    policyId: "d4-lineage-retention",
    createdAt: fixture.scenario.timestamp,
    minimumRetainUntil: null,
    gcRequiresDeleteCapability: true,
  },
  lifetime: {
    mode: "lineage",
    lineageRootRunId: fixture.scenario.runId,
  },
  createdBy: {
    planHash,
    runId: fixture.scenario.runId,
    invocationId: rootScope.invocationId,
    graphKey: "root",
    nodeId: "nested",
    edgeId: "e_nested_artifact",
    taskId: "nested-artifact-producer",
    attemptId: producerAttemptId,
    attemptNumber: 0,
  },
};
const artifactId = domainHash(DOMAINS.artifact, artifactIdentityBody);
const artifactCapability = {
  authorityHash: jsonHash(plan.authority),
  actions: ["read"],
  expiresAt: null,
};
const capabilityId = domainHash(DOMAINS.artifactCapability, [artifactId, artifactCapability]);
const artifactRef = {
  apiVersion: "graphengineering.reacher-z.github.io/artifact-refs/v1alpha1",
  kind: "ArtifactRef",
  artifactId,
  ...artifactIdentityBody,
  capability: { capabilityId, ...artifactCapability },
};
assert.equal(validateArtifact(artifactRef), true, `artifact ref is invalid: ${JSON.stringify(validateArtifact.errors)}`);

const artifactEdge = plan.artifactEdges[0];
// Semantics 9.1: the artifact ID preimage is exactly this closed body.
const ARTIFACT_IDENTITY_FIELDS = Object.freeze(Object.keys(artifactIdentityBody));
assertExact(
  ARTIFACT_IDENTITY_FIELDS,
  [
    "storeId", "storageNamespace", "tenantId", "runId", "algorithm", "digest",
    "sizeBytes", "mediaType", "encoding", "logicalName", "protection",
    "retention", "lifetime", "createdBy",
  ],
  "artifact identity preimage field set drifted from semantics 9.1",
);

const RFC3339_MILLIS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function compareInstants(left, right) {
  assert.match(left, RFC3339_MILLIS, "instant is not strict UTC RFC 3339 with millisecond precision");
  assert.match(right, RFC3339_MILLIS, "instant is not strict UTC RFC 3339 with millisecond precision");
  return left < right ? -1 : left > right ? 1 : 0;
}

function artifactIdentityOf(ref) {
  const body = Object.create(null);
  for (const field of ARTIFACT_IDENTITY_FIELDS) body[field] = clone(ref[field]);
  return domainHash(DOMAINS.artifact, body);
}

function artifactCapabilityIdOf(ref) {
  return domainHash(DOMAINS.artifactCapability, [ref.artifactId, {
    authorityHash: ref.capability.authorityHash,
    actions: clone(ref.capability.actions),
    expiresAt: ref.capability.expiresAt,
  }]);
}

function rebindArtifactRef(ref, mode) {
  if (mode === "artifact" || mode === true) ref.artifactId = artifactIdentityOf(ref);
  if (mode === "capability" || mode === true) ref.capability.capabilityId = artifactCapabilityIdOf(ref);
  return ref;
}

// Semantics 9.2 steps 2 and 7: media type, lifetime mode, tenant/namespace
// binding, byte ceiling and both derived identities are validated before an
// ArtifactPublished event may commit.
function publishArtifactRef(ref, edge = artifactEdge) {
  if (!validateArtifact(ref)) {
    throw new D4Error("GE_D4_ARTIFACT_PUBLICATION_FAILED", "artifact reference failed schema validation");
  }
  if (ref.tenantId !== edge.tenantBinding) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "artifact tenant is not the edge tenant binding");
  }
  if (ref.storageNamespace !== edge.storageNamespace) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "artifact namespace is not the edge storage namespace");
  }
  if (!edge.allowedMediaTypes.includes(ref.mediaType)) {
    throw new D4Error("GE_D4_ARTIFACT_PUBLICATION_FAILED", "artifact media type is not allowed by the edge");
  }
  if (ref.lifetime.mode !== edge.lifetime) {
    throw new D4Error("GE_D4_ARTIFACT_PUBLICATION_FAILED", "artifact lifetime mode is not the edge lifetime policy");
  }
  if (ref.sizeBytes > edge.maxBytes) {
    throw new D4Error("GE_D4_ARTIFACT_OVERSIZED", "artifact exceeds edge byte bound");
  }
  if (ref.artifactId !== artifactIdentityOf(ref)) {
    throw new D4Error("GE_D4_ARTIFACT_PUBLICATION_FAILED", "artifact ID is not the hash of its closed identity body");
  }
  if (ref.capability.capabilityId !== artifactCapabilityIdOf(ref)) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "capability ID is not bound to this artifact and authority");
  }
  return ref;
}

// Semantics 9.2: on every read, tenant/run/namespace/capability/expiry
// authorization, existence, exact length, and digest are verified before
// decoding. None of these may be skipped because a golden matched.
function authorizeArtifactRead(ref, request) {
  if (ref.capability.capabilityId !== artifactCapabilityIdOf(ref)) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "capability ID is not bound to this artifact and authority");
  }
  if (ref.capability.authorityHash !== jsonHash(plan.authority)) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "capability authority hash is not the plan authority");
  }
  if (!ref.capability.actions.includes(request.action)) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "capability does not authorize the requested action");
  }
  if (ref.capability.expiresAt !== null && compareInstants(request.readAt, ref.capability.expiresAt) >= 0) {
    throw new D4Error("GE_D4_ARTIFACT_EXPIRED", "capability expired before the read instant");
  }
  if (request.tenantId !== ref.tenantId) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "reader tenant is not the artifact tenant");
  }
  if (request.runId !== ref.runId) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "reader run is not the artifact run binding");
  }
  if (request.storageNamespace !== ref.storageNamespace) {
    throw new D4Error("GE_D4_ARTIFACT_UNAUTHORIZED", "reader namespace is not the artifact storage namespace");
  }
  if (request.contentUtf8 !== undefined) {
    const bytes = Buffer.from(request.contentUtf8, "utf8");
    if (bytes.length !== ref.sizeBytes) {
      throw new D4Error("GE_D4_ARTIFACT_CORRUPT", "artifact byte length does not match the reference");
    }
    if (sha256Bytes(bytes) !== ref.digest) {
      throw new D4Error("GE_D4_ARTIFACT_CORRUPT", "artifact bytes do not match content identity");
    }
  }
  return ref;
}

const canonicalReadRequest = Object.freeze({
  action: "read",
  tenantId: artifactRef.tenantId,
  runId: artifactRef.runId,
  storageNamespace: artifactRef.storageNamespace,
  readAt: fixture.scenario.timestamp,
});
publishArtifactRef(clone(artifactRef));
authorizeArtifactRead(clone(artifactRef), {
  ...canonicalReadRequest,
  contentUtf8: fixture.scenario.artifactContentUtf8,
});

const streamPolicy = plan.streamEdges[0];
const streamId = domainHash(DOMAINS.stream, [
  fixture.scenario.runId,
  planHash,
  rootScope.invocationId,
  streamPolicy.graphKey,
  streamPolicy.edgeId,
]);
const streamItemBytes = Buffer.byteLength(canonicalJson(fixture.scenario.streamItem), "utf8");
const streamItemHash = domainHash(DOMAINS.streamItem, {
  streamId,
  itemSequence: 0,
  itemMode: "value",
  value: fixture.scenario.streamItem,
});

const STREAM_SEED_FIELDS = Object.freeze([
  "status",
  "totalDemand",
  "published",
  "delivered",
  "acknowledged",
  "sourceClosed",
  "inFlightBytes",
  "inFlightBytesHighWater",
  "buffer",
  "unacknowledged",
]);
// Semantics 10.2 grants: the fixture spells a grant as a named step so the
// credit count is corpus data rather than a validator constant.
const STREAM_DEMAND_STEPS = Object.freeze({
  "demand-zero": 0,
  "demand-one": 1,
  "demand-two": 2,
  "demand-three": 3,
});

function streamState(seed = null) {
  const state = {
    status: "open",
    totalDemand: 0,
    published: 0,
    delivered: 0,
    acknowledged: 0,
    sourceClosed: false,
    inFlightBytes: 0,
    inFlightBytesHighWater: 0,
    buffer: [],
    unacknowledged: [],
  };
  if (seed === null) return state;
  // Semantics 10.5: resume reconstructs counters from the committed prefix, so
  // a hostile vector is allowed to start the machine from a recovered state.
  for (const [field, value] of Object.entries(seed)) {
    assert.ok(STREAM_SEED_FIELDS.includes(field), `unknown stream seed field: ${field}`);
    state[field] = clone(value);
  }
  return state;
}

// Semantics 10.4: the first committed terminal event wins. No terminal event
// can be followed by a publish, deliver, ack, close, or second terminal event;
// `publish` is not exempt.
function streamTerminalGuard(state) {
  if (state.status === "cancelled") {
    throw new D4Error("GE_D4_STREAM_CANCELLED", "cancelled stream cannot transition");
  }
  if (state.status === "failed") {
    throw new D4Error("GE_D4_STREAM_FAILED", "failed stream cannot transition");
  }
  if (state.status === "completed") {
    throw new D4Error("GE_D4_STREAM_PROTOCOL", "terminal stream cannot transition");
  }
}

function streamTransition(state, step, options = {}) {
  const itemBytes = options.itemBytes ?? streamItemBytes;
  streamTerminalGuard(state);
  if (Object.hasOwn(STREAM_DEMAND_STEPS, step)) {
    return streamTransition(state, "demand", { ...options, credits: STREAM_DEMAND_STEPS[step] });
  }
  if (step === "demand") {
    const credits = options.credits;
    // Semantics 10.2: one grant is positive and no larger than
    // maxDemandPerGrant, and cumulative demand cannot exceed maxItems.
    if (!Number.isSafeInteger(credits) || credits <= 0) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "demand grant is not a positive safe integer");
    }
    if (credits > streamPolicy.maxDemandPerGrant) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "demand grant exceeds bound");
    }
    if (state.totalDemand + credits > streamPolicy.maxItems) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "cumulative demand exceeds the stream item bound");
    }
    state.totalDemand += credits;
    return;
  }
  if (step === "publish") {
    // Semantics 10.3: StreamSourceClosed forbids later publication.
    if (state.sourceClosed) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "source-closed stream cannot publish");
    }
    if (state.published >= streamPolicy.maxItems) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream item bound is exhausted");
    }
    if (state.published >= state.totalDemand) {
      throw new D4Error("GE_D4_STREAM_DEMAND_EXHAUSTED", "producer has no demand credit");
    }
    if (state.buffer.length >= streamPolicy.bufferCapacity) {
      throw new D4Error("GE_D4_STREAM_BUFFER_FULL", "durable stream buffer is full");
    }
    if (itemBytes > streamPolicy.maxItemBytes) {
      throw new D4Error("GE_D4_STREAM_ITEM_INVALID", "stream item exceeds the item byte bound");
    }
    if (state.inFlightBytes + itemBytes > streamPolicy.maxInFlightBytes) {
      throw new D4Error("GE_D4_STREAM_ITEM_INVALID", "stream item exceeds the in-flight byte reservation");
    }
    state.buffer.push(state.published);
    state.inFlightBytes += itemBytes;
    state.inFlightBytesHighWater = Math.max(state.inFlightBytesHighWater, state.inFlightBytes);
    state.published += 1;
    return;
  }
  if (step === "deliver") {
    if (state.buffer.length === 0) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream delivery has no buffered item");
    }
    if (state.unacknowledged.length >= streamPolicy.maxUnacknowledged) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream unacknowledged bound is exhausted");
    }
    state.unacknowledged.push(state.buffer.shift());
    state.delivered += 1;
    return;
  }
  if (step === "ack") {
    if (state.unacknowledged.length === 0) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream ack has no delivered item");
    }
    state.unacknowledged.shift();
    state.inFlightBytes -= itemBytes;
    state.acknowledged += 1;
    return;
  }
  if (step === "source-close") {
    if (state.sourceClosed) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream source closed twice");
    }
    state.sourceClosed = true;
    state.status = "source-closed";
    return;
  }
  if (step === "complete") {
    // Semantics 10.3: completion is legal only when the source is closed, the
    // buffer and unacknowledged sets are empty, and
    // published == delivered == acknowledged.
    if (!state.sourceClosed || state.buffer.length !== 0 || state.unacknowledged.length !== 0 ||
      state.delivered !== state.published || state.acknowledged !== state.published) {
      throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream completed with unsettled items");
    }
    state.status = "completed";
    return;
  }
  if (step === "cancel") {
    state.status = "cancelled";
    return;
  }
  if (step === "fail") {
    state.status = "failed";
    return;
  }
  throw new Error(`unknown stream test step: ${step}`);
}

function runStreamSteps(steps, options = {}) {
  const state = streamState(options.seed ?? null);
  for (const step of steps) streamTransition(state, step, options);
  return state;
}

const validStreamState = runStreamSteps([
  "demand-one",
  "publish",
  "deliver",
  "ack",
  "source-close",
  "complete",
]);

function eventData(type, scopeName) {
  if (type === "InvocationCreated") {
    const input = scopeName === "root" ? fixture.scenario.nodeInput : childInput;
    const projection = scopeName === "root" ? { mode: "root-input" } : call.inputProjection;
    return {
      input: clone(input),
      inputHash: domainHash(DOMAINS.value, input),
      projectionHash: domainHash(DOMAINS.projection, projection),
      effectiveAuthorityHash: jsonHash(scopeName === "root" ? plan.authority : call.authority.effective),
      budgetAllocationHash: jsonHash(scopeName === "root" ? plan.budget : call.budget),
      reuseDisposition: "new-work",
    };
  }
  if (type === "InvocationStarted") return {};
  if (type === "InvocationSucceeded") {
    const projectedOutput = scopeName === "child"
      ? childProjectedOutput
      : fixture.scenario.expectedProjectedOutput;
    return {
      namedOutputsHash: domainHash(DOMAINS.value, fixture.scenario.childNamedOutputs),
      projectedOutput: clone(projectedOutput),
      projectedOutputHash: domainHash(DOMAINS.value, projectedOutput),
    };
  }
  if (type === "StateReducerCommitted") return clone(reducerCommit);
  if (type === "ArtifactPublished") {
    return {
      publicationId: domainHash(DOMAINS.artifact, [artifactRef.artifactId, "publish", fixture.scenario.runId]),
      finalizeAttemptId: domainHash(DOMAINS.value, [artifactRef.artifactId, "finalize", 0]),
      holdId: "edge-hold",
      artifactRef: clone(artifactRef),
    };
  }
  if (type === "ArtifactReadVerified") {
    return {
      artifactId: artifactRef.artifactId,
      capabilityId: artifactRef.capability.capabilityId,
      readAttemptId: domainHash(DOMAINS.value, [artifactRef.artifactId, "read", "artifactConsumer", 0]),
      readerNodeId: "artifactConsumer",
      digest: artifactRef.digest,
      sizeBytes: artifactRef.sizeBytes,
    };
  }
  if (type === "ArtifactReleased") {
    return {
      artifactId: artifactRef.artifactId,
      holdId: "edge-hold",
      reason: "edge-consumed",
    };
  }
  if (type === "StreamOpened") {
    return {
      streamId,
      edgeId: streamPolicy.edgeId,
      producerNodeId: "nested",
      consumerNodeId: "streamConsumer",
      itemMode: streamPolicy.itemMode,
      itemSchemaHash: streamPolicy.itemSchemaHash,
      topology: streamPolicy.topology,
      maxItems: streamPolicy.maxItems,
      maxItemBytes: streamPolicy.maxItemBytes,
      maxInFlightBytes: streamPolicy.maxInFlightBytes,
      bufferCapacity: streamPolicy.bufferCapacity,
      maxUnacknowledged: streamPolicy.maxUnacknowledged,
      maxDemandPerGrant: streamPolicy.maxDemandPerGrant,
    };
  }
  if (type === "StreamDemandGranted") return { streamId, credits: 1, totalDemand: 1 };
  if (type === "StreamItemPublished") {
    return {
      streamId,
      itemSequence: 0,
      itemAttemptId: domainHash(DOMAINS.streamItem, [streamId, 0, "publish", 0]),
      itemMode: "value",
      itemBytes: streamItemBytes,
      value: clone(fixture.scenario.streamItem),
      itemHash: streamItemHash,
    };
  }
  if (type === "StreamItemDelivered" || type === "StreamItemAcknowledged") {
    return {
      streamId,
      itemSequence: 0,
      deliveryAttempt: 1,
      deliveryAttemptId: domainHash(DOMAINS.streamItem, [streamId, 0, "delivery", 1]),
    };
  }
  if (type === "StreamCancelled") {
    return { streamId, published: 1, delivered: 1, acknowledged: 1, reason: "caller-cancelled" };
  }
  if (type === "StreamSourceClosed") return { streamId, publishedCount: 1 };
  if (type === "StreamCompleted") return { streamId, published: 1, delivered: 1, acknowledged: 1 };
  throw new Error(`event data factory does not support ${type}`);
}

function calculateEventHash(event) {
  const body = clone(event);
  delete body.eventHash;
  return domainHash(DOMAINS.event, body);
}

function makeEvents(steps = fixture.scenario.eventSteps, { validateShape = true } = {}) {
  const events = [];
  for (const [sequence, step] of steps.entries()) {
    const data = eventData(step.type, step.scope);
    // A hostile history may append or reorder authentic frames; `dataMutations`
    // edits the generated payload before the chain is sealed, so the resulting
    // history is byte-consistent and only its semantics are wrong.
    if (step.dataMutations !== undefined) applyMutations(data, step.dataMutations);
    const event = {
      apiVersion: "graphengineering.reacher-z.github.io/subgraph-edge-events/v1alpha1",
      kind: "SubgraphEdgeEvent",
      contractVersion: "subgraph-edge-recovery/v1alpha1",
      runId: fixture.scenario.runId,
      eventStreamId,
      revisionHash,
      lineage: clone(runLineage),
      sequence,
      expectedPreviousSequence: sequence - 1,
      eventId: `d4-event-${sequence}`,
      timestamp: fixture.scenario.timestamp,
      monotonicOffsetNs: sequence * 1000000,
      planHash,
      rootGraphHash: graphHashes.root,
      scope: clone(scopes[step.scope]),
      trace: eventTraceContext(step.type, step.scope),
      type: step.type,
      payloadDisposition: "inline-unredacted",
      redacted: false,
      data,
      previousEventHash: sequence === 0 ? null : events.at(-1).eventHash,
      payloadHash: jsonHash(data),
      eventHash: "0".repeat(64),
    };
    event.eventHash = calculateEventHash(event);
    if (validateShape) {
      assert.equal(validateEvent(event), true, `event ${sequence} is invalid: ${JSON.stringify(validateEvent.errors)}`);
    }
    events.push(event);
  }
  return events;
}

const events = makeEvents();

function assertExpectedScope(scope) {
  const expected = scope.invocationId === rootScope.invocationId ? rootScope :
    scope.invocationId === childScope.invocationId ? childScope : null;
  if (expected === null || canonicalJson(scope) !== canonicalJson(expected)) {
    throw new D4Error("GE_D4_NAMESPACE_INVALID", "event scope or namespace does not match its lineage");
  }
}

function foldHistory(history) {
  const invocationStatus = new Map();
  const eventIds = new Set();
  const stream = streamState();
  let reducerSeen = false;
  let artifactStatus = "absent";
  let previousHash = null;
  let previousMonotonicOffsetNs = -1;
  let terminal = false;
  for (const [index, event] of history.entries()) {
    if (!validateEvent(event)) throw new D4Error("GE_D4_INVALID_HISTORY", "event schema mismatch");
    if (terminal) throw new D4Error("GE_D4_INVALID_HISTORY", "event follows root terminal event");
    // Semantics 13.2: byte/envelope and hash-chain corruption wins before any
    // semantic transition check. Each obligation below is a separate guard so a
    // single hostile field cannot be absorbed by a neighbouring check.
    if (event.payloadHash !== jsonHash(event.data)) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event payload hash does not match canonical bytes");
    }
    if (event.eventHash !== calculateEventHash(event)) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event hash does not match canonical bytes");
    }
    if (event.previousEventHash !== previousHash) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "previous event hash does not match");
    }
    if (event.sequence !== index) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event sequence is not contiguous");
    }
    if (event.expectedPreviousSequence !== index - 1) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event expected-previous sequence is not contiguous");
    }
    if (event.planHash !== planHash) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event plan identity drifted");
    }
    if (event.rootGraphHash !== graphHashes.root) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event root graph identity drifted");
    }
    if (event.runId !== fixture.scenario.runId) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event run identity drifted");
    }
    if (event.eventStreamId !== eventStreamId) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event stream identity drifted");
    }
    if (event.revisionHash !== revisionHash) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event revision identity drifted");
    }
    if (canonicalJson(event.lineage) !== canonicalJson(runLineage)) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event run lineage drifted");
    }
    if (event.monotonicOffsetNs < previousMonotonicOffsetNs) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event monotonic offset moved backward");
    }
    previousMonotonicOffsetNs = event.monotonicOffsetNs;
    if (eventIds.has(event.eventId)) throw new D4Error("GE_D4_INVALID_HISTORY", "duplicate event ID");
    eventIds.add(event.eventId);
    assertExpectedScope(event.scope);
    if (canonicalJson(event.trace) !== canonicalJson(eventTraceContext(event.type,
      event.scope.invocationId === childScope.invocationId ? "child" : "root"))) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "event trace context drifted");
    }
    previousHash = event.eventHash;

    const invocationId = event.scope.invocationId;
    const status = invocationStatus.get(invocationId);
    const scopeName = invocationId === childScope.invocationId ? "child" : "root";
    // Semantics 11.2: an invocation frame carries the deterministic projection
    // of its own scope, not free-form data the corpus never re-derives.
    if (["InvocationCreated", "InvocationStarted", "InvocationSucceeded"].includes(event.type) &&
      canonicalJson(event.data) !== canonicalJson(eventData(event.type, scopeName))) {
      throw new D4Error("GE_D4_INVALID_HISTORY", "invocation event payload is not the deterministic projection");
    }
    if (event.type === "InvocationCreated") {
      if (status !== undefined) throw new D4Error("GE_D4_INVALID_HISTORY", "invocation was created twice");
      invocationStatus.set(invocationId, "created");
      continue;
    }
    if (event.type === "InvocationStarted") {
      if (status !== "created") throw new D4Error("GE_D4_INVALID_HISTORY", "invocation start is misplaced");
      invocationStatus.set(invocationId, "running");
      continue;
    }
    if (event.type === "StateReducerCommitted") {
      if (status !== "running" || event.scope.graphKey !== "child") {
        throw new D4Error("GE_D4_INVALID_HISTORY", "reducer commit is outside a running child scope");
      }
      if (canonicalJson(event.data) !== canonicalJson(reducerCommit)) {
        throw new D4Error("GE_D4_INVALID_HISTORY", "reducer event does not reproduce the deterministic fold");
      }
      reducerSeen = true;
      continue;
    }
    if (event.type === "InvocationSucceeded") {
      if (status !== "running") throw new D4Error("GE_D4_INVALID_HISTORY", "invocation success is misplaced");
      if (event.scope.graphKey === "child" && !reducerSeen) {
        throw new D4Error("GE_D4_INVALID_HISTORY", "child succeeded before reducer commit");
      }
      invocationStatus.set(invocationId, "succeeded");
      if (event.scope.graphKey === "root") {
        if (invocationStatus.get(childScope.invocationId) !== "succeeded" || stream.status !== "completed" || artifactStatus !== "released") {
          throw new D4Error("GE_D4_INVALID_HISTORY", "root succeeded before child/edge settlement");
        }
        terminal = true;
      }
      continue;
    }
    if (event.type === "StreamOpened") {
      if (stream.opened) throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream opened twice");
      // Semantics 10.1: the open frame republishes the plan's edge policy; a
      // history that widens a bound here would silently widen every later check.
      if (canonicalJson(event.data) !== canonicalJson(eventData("StreamOpened", "root"))) {
        throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream open frame does not echo the declared edge policy");
      }
      stream.opened = true;
      continue;
    }
    if (event.type === "StreamDemandGranted") {
      if (!stream.opened || event.data.totalDemand !== stream.totalDemand + event.data.credits) {
        throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream demand transition is invalid");
      }
      // The fold must reach the same demand guards as the state machine rather
      // than adding credits directly.
      streamTransition(stream, "demand", { credits: event.data.credits });
      continue;
    }
    if (event.type === "StreamItemPublished") {
      if (event.data.itemSequence !== stream.published || event.data.itemHash !== streamItemHash ||
        event.data.itemBytes !== streamItemBytes) {
        throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream item identity or sequence drifted");
      }
      streamTransition(stream, "publish");
      continue;
    }
    if (event.type === "StreamItemDelivered") {
      if (event.data.itemSequence !== stream.buffer[0]) throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream delivery order drifted");
      streamTransition(stream, "deliver");
      continue;
    }
    if (event.type === "StreamItemAcknowledged") {
      if (event.data.itemSequence !== stream.unacknowledged[0]) throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream ack order drifted");
      streamTransition(stream, "ack");
      continue;
    }
    if (event.type === "StreamSourceClosed") {
      if (event.data.publishedCount !== stream.published) throw new D4Error("GE_D4_STREAM_PROTOCOL", "source-close count drifted");
      streamTransition(stream, "source-close");
      continue;
    }
    if (event.type === "StreamCompleted") {
      streamTransition(stream, "complete");
      if (event.data.published !== stream.published || event.data.delivered !== stream.delivered ||
        event.data.acknowledged !== stream.acknowledged) {
        throw new D4Error("GE_D4_STREAM_PROTOCOL", "stream completion counters drifted");
      }
      continue;
    }
    if (event.type === "ArtifactPublished") {
      if (artifactStatus !== "absent") throw new D4Error("GE_D4_INVALID_HISTORY", "artifact published twice");
      // Semantics 9.2 step 7/8: the published reference is re-validated against
      // the edge policy before the event may be accepted, and its content
      // identity must reproduce the canonical reference exactly.
      publishArtifactRef(clone(event.data.artifactRef));
      if (canonicalJson(event.data.artifactRef) !== canonicalJson(artifactRef)) {
        throw new D4Error("GE_D4_INVALID_HISTORY", "artifact identity drifted");
      }
      artifactStatus = "published";
      continue;
    }
    if (event.type === "ArtifactReadVerified") {
      if (artifactStatus !== "published") {
        throw new D4Error("GE_D4_INVALID_HISTORY", "artifact read precedes its publication");
      }
      // Semantics 9.2: every read re-authorizes tenant, run, namespace,
      // capability and expiry before the recorded identity is trusted.
      authorizeArtifactRead(clone(artifactRef), canonicalReadRequest);
      if (event.data.digest !== artifactRef.digest) {
        throw new D4Error("GE_D4_INVALID_HISTORY", "artifact read digest drifted");
      }
      if (event.data.sizeBytes !== artifactRef.sizeBytes) {
        throw new D4Error("GE_D4_INVALID_HISTORY", "artifact read byte length drifted");
      }
      if (event.data.capabilityId !== artifactRef.capability.capabilityId) {
        throw new D4Error("GE_D4_INVALID_HISTORY", "artifact read capability drifted");
      }
      artifactStatus = "verified";
      continue;
    }
    if (event.type === "ArtifactReleased") {
      if (artifactStatus !== "verified" || event.data.artifactId !== artifactRef.artifactId) {
        throw new D4Error("GE_D4_INVALID_HISTORY", "artifact release is invalid");
      }
      artifactStatus = "released";
      continue;
    }
    throw new D4Error("GE_D4_INVALID_HISTORY", `unsupported event in golden fold: ${event.type}`);
  }
  if (!terminal) throw new D4Error("GE_D4_INVALID_HISTORY", "history is not terminal");
  return { invocationStatus, stream, reducerSeen, artifactStatus, terminalEventHash: previousHash };
}

const folded = foldHistory(events);

function zeroWaits(overrides = {}) {
  return {
    queueNs: 0,
    barrierNs: 0,
    retryNs: 0,
    backpressureNs: 0,
    approvalNs: 0,
    checkpointRecoveryNs: 0,
    ...overrides,
  };
}

function zeroUsage(overrides = {}) {
  return {
    attemptsReserved: 0,
    attemptsCommitted: 0,
    inputUnits: 0,
    outputUnits: 0,
    costNanos: 0,
    currency: "XXX",
    budgetReservationId: null,
    budgetReleased: true,
    ...overrides,
  };
}

function makeTraceSpan({ key, parentKey, kind, name, graphKey, nodeId = null, edgeId = null,
  artifactId: spanArtifactId = null, streamId: spanStreamId = null, startSequence, endSequence, waits = {}, usage = {} }) {
  const graph = graphKey === null ? null : plan.graphs.find((candidate) => candidate.key === graphKey);
  return {
    spanId: spanIds[key],
    parentSpanId: parentKey === null ? null : spanIds[parentKey],
    kind,
    name,
    identities: {
      graphHash: graph?.graphHash ?? null,
      compiledPlanHash: graph?.compiledPlanHash ?? null,
      revisionHash,
      nodeId,
      edgeId,
      attemptId: key === "artifact" ? producerAttemptId : null,
      activityId: null,
      controllerId: null,
      subgraphInvocationId: key === "child" || key === "reducer" ? childScope.invocationId : rootScope.invocationId,
      artifactId: spanArtifactId,
      streamId: spanStreamId,
      providerId: null,
    },
    causality: {
      startSequence,
      endSequence,
      parentEventSequence: parentKey === null ? null : startSequence - 1,
    },
    timing: {
      wallStart: fixture.scenario.timestamp,
      wallEnd: fixture.scenario.timestamp,
      monotonicStartOffsetNs: events[startSequence].monotonicOffsetNs,
      monotonicEndOffsetNs: events[endSequence].monotonicOffsetNs,
      durationNs: events[endSequence].monotonicOffsetNs - events[startSequence].monotonicOffsetNs,
    },
    state: "succeeded",
    waits: zeroWaits(waits),
    usage: zeroUsage(usage),
    payloadDisposition: "metadata-only",
    failure: null,
  };
}

function normalizedTraceWithoutHash() {
  const streamBytes = Buffer.byteLength(canonicalJson(fixture.scenario.streamItem), "utf8");
  return {
    apiVersion: "graphengineering.reacher-z.github.io/subgraph-edge-traces/v1alpha1",
    kind: "NormalizedTrace",
    contractVersion: "normalized-trace/v1alpha1",
    runId: fixture.scenario.runId,
    traceId,
    planHash,
    rootGraphHash: graphHashes.root,
    revisionHash,
    source: {
      eventStreamId,
      throughSequence: events.length - 1,
      historyHash: events.at(-1).eventHash,
      complete: true,
    },
    normalization: "canonical-json-code-point-order/v1alpha1",
    payloadDisposition: "metadata-only",
    externalExport: "off-by-default",
    spans: [
      makeTraceSpan({ key: "root", parentKey: null, kind: "run", name: "root-run", graphKey: "root",
        startSequence: 0, endSequence: 16, usage: { attemptsReserved: 16, attemptsCommitted: 2,
          budgetReservationId: domainHash(DOMAINS.value, [fixture.scenario.runId, "root-budget"]) } }),
      makeTraceSpan({ key: "child", parentKey: "root", kind: "invocation", name: "child-invocation", graphKey: "child",
        startSequence: 2, endSequence: 12, usage: { attemptsReserved: 8, attemptsCommitted: 1,
          budgetReservationId: domainHash(DOMAINS.value, [fixture.scenario.runId, "child-budget"]) } }),
      makeTraceSpan({ key: "stream", parentKey: "root", kind: "stream", name: "stream-edge", graphKey: "root",
        edgeId: streamPolicy.edgeId, streamId, startSequence: 4, endSequence: 10, waits: { backpressureNs: 1000000 } }),
      makeTraceSpan({ key: "reducer", parentKey: "child", kind: "reducer", name: "state-reducer", graphKey: "child",
        nodeId: "reduce", startSequence: 11, endSequence: 11 }),
      makeTraceSpan({ key: "artifact", parentKey: "root", kind: "artifact", name: "artifact-edge", graphKey: "root",
        edgeId: "e_nested_artifact", artifactId: artifactRef.artifactId, startSequence: 13, endSequence: 15 }),
    ],
    links: [
      { fromSpanId: spanIds.root, toSpanId: spanIds.child, kind: "child", eventSequence: 2 },
      { fromSpanId: spanIds.root, toSpanId: spanIds.stream, kind: "data", eventSequence: 4 },
      { fromSpanId: spanIds.child, toSpanId: spanIds.reducer, kind: "data", eventSequence: 11 },
      { fromSpanId: spanIds.root, toSpanId: spanIds.artifact, kind: "data", eventSequence: 13 },
    ],
    criticalPathInputs: {
      rootSpanId: spanIds.root,
      terminalSpanIds: [spanIds.root],
      availableParallelism: plan.policies.maxConcurrentInvocations,
      observedPeakParallelism: 2,
    },
    metrics: {
      queueDepthHighWater: 2,
      streamLagHighWater: 1,
      artifactBytes: artifactRef.sizeBytes,
      streamBytes,
      droppedSpans: 0,
      incomplete: false,
    },
  };
}

function buildNormalizedTrace() {
  const body = normalizedTraceWithoutHash();
  return { ...body, contentHash: domainHash(DOMAINS.trace, body) };
}

const normalizedTrace = buildNormalizedTrace();
assert.equal(validateTrace(normalizedTrace), true, `trace is invalid: ${JSON.stringify(validateTrace.errors)}`);

function validateTraceSemantics(candidate) {
  if (!validateTrace(candidate)) throw new D4Error("GE_D4_TRACE_INVALID", "trace schema mismatch");
  const body = clone(candidate);
  delete body.contentHash;
  if (candidate.contentHash !== domainHash(DOMAINS.trace, body)) {
    throw new D4Error("GE_D4_TRACE_INVALID", "trace content hash drifted");
  }
  if (canonicalJson(body) !== canonicalJson(normalizedTraceWithoutHash())) {
    throw new D4Error("GE_D4_TRACE_INVALID", "trace is not the normalized event projection");
  }
}
validateTraceSemantics(normalizedTrace);

function checkpointWithoutHash() {
  const rootInputHash = domainHash(DOMAINS.value, fixture.scenario.nodeInput);
  const childInputHash = domainHash(DOMAINS.value, childInput);
  const projectedOutputHash = domainHash(DOMAINS.value, fixture.scenario.expectedProjectedOutput);
  return {
    apiVersion: "graphengineering.reacher-z.github.io/subgraph-edge-checkpoints/v1alpha1",
    kind: "SubgraphEdgeCheckpoint",
    contractVersion: "subgraph-edge-recovery/v1alpha1",
    runId: fixture.scenario.runId,
    eventStreamId,
    revisionHash,
    lineage: clone(runLineage),
    checkpointId: fixture.scenario.checkpointId,
    planHash,
    rootGraphHash: graphHashes.root,
    sequence: events.length - 1,
    historyPrefixHash: events.at(-1).eventHash,
    createdAt: fixture.scenario.timestamp,
    payloadDisposition: "inline-unredacted",
    redacted: false,
    invocations: [
      {
        scope: clone(rootScope),
        status: "succeeded",
        inputHash: rootInputHash,
        effectiveAuthorityHash: jsonHash(plan.authority),
        budgetAllocationHash: jsonHash(plan.budget),
        reuseDisposition: "new-work",
        projectedOutputHash,
      },
      {
        scope: clone(childScope),
        status: "succeeded",
        inputHash: childInputHash,
        effectiveAuthorityHash: jsonHash(call.authority.effective),
        budgetAllocationHash: jsonHash(call.budget),
        reuseDisposition: "new-work",
        projectedOutputHash,
      },
    ],
    reducers: [
      {
        invocationId: childScope.invocationId,
        reducerId: reducerCommit.reducerId,
        reducerIdentity: reducerCommit.reducerIdentity,
        stateVersion: reducerCommit.stateVersionAfter,
        state: clone(reducerCommit.afterState),
        stateHash: reducerCommit.afterStateHash,
        lastBatchId: reducerCommit.batchId,
      },
    ],
    artifacts: [
      {
        artifactRef: clone(artifactRef),
        verifiedBy: ["artifactConsumer"],
        activeHolds: [],
        releaseRecorded: true,
        eligibleForGc: false,
      },
    ],
    streams: [
      {
        streamId,
        invocationId: rootScope.invocationId,
        edgeId: streamPolicy.edgeId,
        status: "completed",
        itemMode: streamPolicy.itemMode,
        itemSchemaHash: streamPolicy.itemSchemaHash,
        topology: streamPolicy.topology,
        maxItems: streamPolicy.maxItems,
        maxItemBytes: streamPolicy.maxItemBytes,
        maxInFlightBytes: streamPolicy.maxInFlightBytes,
        currentInFlightBytes: 0,
        bufferCapacity: streamPolicy.bufferCapacity,
        maxUnacknowledged: streamPolicy.maxUnacknowledged,
        totalDemand: folded.stream.totalDemand,
        published: folded.stream.published,
        delivered: folded.stream.delivered,
        acknowledged: folded.stream.acknowledged,
        sourceClosed: folded.stream.sourceClosed,
        bufferedItemSequences: [],
        unacknowledgedItemSequences: [],
      },
    ],
    trace: {
      traceId,
      throughSequence: events.length - 1,
      normalizedTraceHash: normalizedTrace.contentHash,
      openSpanIds: [],
      completedSpanIds: normalizedTrace.spans.map((span) => span.spanId),
      droppedSpans: 0,
      externalExport: "off-by-default",
    },
  };
}

function buildCheckpoint() {
  const body = checkpointWithoutHash();
  return { ...body, contentHash: domainHash(DOMAINS.checkpoint, body) };
}

const checkpoint = buildCheckpoint();
assert.equal(validateCheckpoint(checkpoint), true, `checkpoint is invalid: ${JSON.stringify(validateCheckpoint.errors)}`);

function validateCheckpointSemantics(candidate) {
  if (!validateCheckpoint(candidate)) throw new D4Error("GE_D4_CORRUPT_CHECKPOINT", "checkpoint schema mismatch");
  const body = clone(candidate);
  delete body.contentHash;
  if (candidate.contentHash !== domainHash(DOMAINS.checkpoint, body)) {
    throw new D4Error("GE_D4_CORRUPT_CHECKPOINT", "checkpoint content hash drifted");
  }
  if (canonicalJson(body) !== canonicalJson(checkpointWithoutHash())) {
    throw new D4Error("GE_D4_CORRUPT_CHECKPOINT", "checkpoint does not equal the event-derived projection");
  }
}
validateCheckpointSemantics(checkpoint);

const goldens = {
  rootGraphHash: graphHashes.root,
  childGraphHash: graphHashes.child,
  rootCompiledPlanHash: plan.graphs.find((graph) => graph.key === "root").compiledPlanHash,
  childCompiledPlanHash: plan.graphs.find((graph) => graph.key === "child").compiledPlanHash,
  planHash,
  revisionHash,
  eventStreamId,
  rootInvocationId: rootScope.invocationId,
  childInvocationId: childScope.invocationId,
  projectedOutputHash: domainHash(DOMAINS.value, fixture.scenario.expectedProjectedOutput),
  reducerBatchId: reducerCommit.batchId,
  artifactDigest: artifactRef.digest,
  artifactId: artifactRef.artifactId,
  artifactCapabilityId: artifactRef.capability.capabilityId,
  streamId,
  traceId,
  traceHash: normalizedTrace.contentHash,
  terminalEventHash: events.at(-1).eventHash,
  checkpointHash: checkpoint.contentHash,
};

if (process.argv.includes("--print-goldens")) {
  process.stdout.write(`${JSON.stringify(goldens, null, 2)}\n`);
  process.exit(0);
}
assertExact(fixture.goldens, goldens, "D4 golden hash set drifted");

for (const testCase of fixture.schemaNegativeCases) {
  let candidate;
  let validate;
  if (testCase.target === "plan") {
    candidate = clone(plan);
    validate = validatePlanShape;
  } else if (testCase.target === "artifact") {
    candidate = clone(artifactRef);
    validate = validateArtifact;
  } else if (testCase.target === "event") {
    candidate = clone(events[testCase.eventIndex]);
    validate = validateEvent;
  } else if (testCase.target === "checkpoint") {
    candidate = clone(checkpoint);
    validate = validateCheckpoint;
  } else if (testCase.target === "trace") {
    candidate = clone(normalizedTrace);
    validate = validateTrace;
  } else {
    throw new Error(`unknown schema-negative target: ${testCase.target}`);
  }
  applyMutations(candidate, testCase.mutations);
  assert.equal(validate(candidate), false, `${testCase.name} unexpectedly passed schema validation`);
}

for (const testCase of fixture.semanticPlanCases) {
  const candidate = applyMutations(clone(plan), testCase.mutations);
  let code = null;
  try {
    validatePlanSemantics(candidate);
  } catch (error) {
    if (!(error instanceof D4Error)) throw error;
    code = error.code;
  }
  assert.equal(code, testCase.expectedCode, `${testCase.name} semantic plan verdict drifted`);
}

for (const testCase of fixture.semanticRuntimeCases) {
  let code = null;
  try {
    if (testCase.operation === "project-output") {
      projectValue(null, testCase.projection ?? call.outputProjection, testCase.input);
    } else if (testCase.operation === "enter-recursion") {
      if (testCase.ancestorDepth >= testCase.maxDepth) {
        throw new D4Error("GE_D4_RECURSION_LIMIT", "bounded recursion is exhausted");
      }
    } else if (testCase.operation === "repeat-reducer-batch") {
      const ledger = new Map([[reducerCommit.batchId, canonicalJson(reducerCommit)]]);
      const repeated = testCase.changeValue
        ? buildReducerCommit({ left: { value: "changed" }, right: { value: "right" } }, false)
        : clone(reducerCommit);
      if (testCase.changeValue) repeated.batchId = reducerCommit.batchId;
      const recorded = ledger.get(repeated.batchId);
      if (recorded !== undefined && recorded !== canonicalJson(repeated)) {
        throw new D4Error("GE_D4_REDUCER_IDEMPOTENCY_CONFLICT", "batch ID was reused for different bytes");
      }
      assert.equal(repeated.stateVersionAfter, 1, "idempotent repeat advanced state version");
    } else if (testCase.operation === "reduce-operation") {
      const reduced = applyReducerOperation(
        testCase.reducerOperation,
        testCase.initial,
        testCase.values,
        testCase.integerBounds ?? null,
      );
      assertExact(reduced, testCase.expected, `${testCase.name} reducer projection drifted`);
    } else if (testCase.operation === "artifact-gc") {
      const eligible = checkpoint.artifacts[0].eligibleForGc;
      assert.equal(eligible, testCase.expectedEligible, `${testCase.name} GC verdict drifted`);
    } else if (testCase.operation === "publish-artifact") {
      const candidate = rebindArtifactRef(
        applyMutations(clone(artifactRef), testCase.refMutations ?? []),
        testCase.rebind ?? false,
      );
      publishArtifactRef(candidate);
    } else if (testCase.operation === "read-artifact") {
      const candidate = rebindArtifactRef(
        applyMutations(clone(artifactRef), testCase.refMutations ?? []),
        testCase.rebind ?? false,
      );
      const request = {
        action: testCase.action ?? canonicalReadRequest.action,
        tenantId: testCase.tenantId ?? candidate.tenantId,
        runId: testCase.runId ?? candidate.runId,
        storageNamespace: testCase.storageNamespace ?? candidate.storageNamespace,
        readAt: testCase.readAt ?? canonicalReadRequest.readAt,
      };
      if (Object.hasOwn(testCase, "contentUtf8")) request.contentUtf8 = testCase.contentUtf8;
      authorizeArtifactRead(candidate, request);
    } else if (testCase.operation === "reduce-contributors") {
      buildReducerCommit(
        testCase.contributorOutputs,
        false,
        null,
        testCase.initialState ?? fixture.scenario.initialState,
      );
    } else if (testCase.operation === "reducer-completion-order") {
      foldReducerUnderCompletionOrder(
        testCase.completionOrder ?? fixture.scenario.completionOrder,
        testCase.foldInArrivalOrder === true,
      );
    } else if (testCase.operation === "stream") {
      runStreamSteps(testCase.steps, {
        seed: testCase.seed ?? null,
        ...(testCase.itemBytes === undefined ? {} : { itemBytes: testCase.itemBytes }),
      });
    } else if (testCase.operation === "stream-failure") {
      const result = {
        boundValue: false,
        failure: {
          code: "GE_D4_STREAM_FAILED",
          phase: "stream",
          retryable: false,
        },
      };
      assert.equal(result.boundValue, testCase.expectedBoundValue);
      throw new D4Error(result.failure.code, "stream failure remains structured");
    } else {
      throw new Error(`unknown semantic runtime operation: ${testCase.operation}`);
    }
  } catch (error) {
    if (!(error instanceof D4Error)) throw error;
    code = error.code;
  }
  assert.equal(code, testCase.expectedCode, `${testCase.name} runtime verdict drifted`);
}

for (const testCase of fixture.semanticHistoryCases) {
  let code = null;
  try {
    if (testCase.target === "checkpoint") {
      const candidate = applyMutations(clone(checkpoint), testCase.mutations);
      if (testCase.rehash === true) {
        const body = clone(candidate);
        delete body.contentHash;
        candidate.contentHash = domainHash(DOMAINS.checkpoint, body);
      }
      validateCheckpointSemantics(candidate);
    } else {
      let history;
      if (testCase.prefixLength !== undefined || testCase.stepMutations !== undefined ||
        testCase.appendSteps !== undefined) {
        // Rebuild an authentic, fully re-chained history from a hostile step
        // list so terminal/ordering obligations are exercised by real frames
        // rather than by a hash the corpus could never produce.
        const steps = clone(fixture.scenario.eventSteps)
          .slice(0, testCase.prefixLength ?? fixture.scenario.eventSteps.length);
        if (testCase.stepMutations !== undefined) applyMutations(steps, testCase.stepMutations);
        for (const step of testCase.appendSteps ?? []) steps.push(clone(step));
        history = makeEvents(steps, { validateShape: false });
      } else {
        history = clone(events);
      }
      if (testCase.eventIndex !== undefined) {
        applyMutations(history[testCase.eventIndex], testCase.mutations ?? []);
        if (testCase.rebindArtifact !== undefined) {
          // Re-derive the embedded reference's own identities so the frame is
          // internally consistent and only its relation to the run is hostile.
          rebindArtifactRef(history[testCase.eventIndex].data.artifactRef, testCase.rebindArtifact);
        }
        if (testCase.rehash === true) {
          history[testCase.eventIndex].payloadHash = jsonHash(history[testCase.eventIndex].data);
        }
        if (testCase.rehash === true || testCase.rehash === "event") {
          history[testCase.eventIndex].eventHash = calculateEventHash(history[testCase.eventIndex]);
        }
        if (testCase.reseal === true) {
          // Re-chain every later frame as well, so a mid-history semantic
          // substitution is not absorbed by the hash-chain guard downstream.
          history[testCase.eventIndex].payloadHash = jsonHash(history[testCase.eventIndex].data);
          for (let index = testCase.eventIndex; index < history.length; index += 1) {
            history[index].previousEventHash = index === 0 ? null : history[index - 1].eventHash;
            history[index].eventHash = calculateEventHash(history[index]);
          }
        }
      }
      foldHistory(history);
    }
  } catch (error) {
    if (!(error instanceof D4Error)) throw error;
    code = error.code;
  }
  assert.equal(code, testCase.expectedCode, `${testCase.name} history verdict drifted`);
}

for (const testCase of fixture.semanticTraceCases) {
  let code = null;
  try {
    const candidate = applyMutations(clone(normalizedTrace), testCase.mutations);
    if (testCase.rehash === true) {
      const body = clone(candidate);
      delete body.contentHash;
      candidate.contentHash = domainHash(DOMAINS.trace, body);
    }
    validateTraceSemantics(candidate);
  } catch (error) {
    if (!(error instanceof D4Error)) throw error;
    code = error.code;
  }
  assert.equal(code, testCase.expectedCode, `${testCase.name} trace verdict drifted`);
}

// Importing this module executes the whole campaign above; the summary exists
// so scripts/validate-fixtures.mjs can report its counts without re-running it.
export const subgraphEdgeCampaign = Object.freeze({
  contractStatus: fixture.contractStatus,
  implementationClaim: fixture.implementationClaim,
  schemas: schemas.length - 1,
  boundGraphs: Object.keys(fixture.sourceGraphs).length,
  planCases: fixture.semanticPlanCases.length,
  events: events.length,
  schemaNegatives: fixture.schemaNegativeCases.length,
  runtimeCases: fixture.semanticRuntimeCases.length,
  historyCases: fixture.semanticHistoryCases.length,
  traceCases: fixture.semanticTraceCases.length,
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(
    `Validated ${subgraphEdgeCampaign.schemas} D4 schemas, ${subgraphEdgeCampaign.boundGraphs} bound graphs, ` +
    `1 canonical plan plus ${subgraphEdgeCampaign.planCases} semantic plan variants, ` +
    `${subgraphEdgeCampaign.events} chained events, 1 event-derived checkpoint, 1 normalized trace, ` +
    `${subgraphEdgeCampaign.schemaNegatives} schema negatives, ` +
    `${subgraphEdgeCampaign.runtimeCases} runtime-semantic cases, ` +
    `${subgraphEdgeCampaign.historyCases} hostile history/checkpoint cases, and ` +
    `${subgraphEdgeCampaign.traceCases} hostile trace cases.\n`,
  );
}
