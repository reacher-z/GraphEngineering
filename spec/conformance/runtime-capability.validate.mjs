import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const here = dirname(fileURLToPath(import.meta.url));
const specRoot = dirname(here);
const CASE_PATH = join(here, "runtime-capability.case.json");
const SCHEMA_PATH = join(here, "runtime-capability.schema.json");
const GRAPH_SCHEMA_PATH = join(specRoot, "graph.schema.json");

const CONTRACT = "runtime-capability/v1alpha1";
const CODE = "UNSUPPORTED_RUNTIME_CAPABILITY";
const SUPPORTED_KINDS = new Set(["agent", "model", "tool", "transform", "router", "barrier"]);
const SUPPORTED_POLICIES = new Set([
  "maxConcurrency",
  "maxDepth",
  "maxFanOut",
  "maxTotalAttempts",
  "graphengineering.reacher-z.github.io/typed-ports",
]);

function compareUnicodeCodePoints(left, right) {
  const a = Array.from(left, (item) => item.codePointAt(0));
  const b = Array.from(right, (item) => item.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function pointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function message(capability, path) {
  return `Runtime capability '${capability}' at '${path}' is not implemented by ${CONTRACT}`;
}

function failure(nodeId, capability, path) {
  return { code: CODE, nodeId, message: message(capability, path) };
}

function expectedFailures(graph) {
  const graphOwner = graph.entrypoints[0];
  const result = [];
  if (Object.hasOwn(graph, "stateSchema")) {
    result.push(failure(graphOwner, "graph-state", "#/stateSchema"));
  }
  for (const [index, node] of graph.nodes.entries()) {
    const base = `#/nodes/${index}`;
    if (!SUPPORTED_KINDS.has(node.kind)) {
      result.push(failure(node.id, `node-kind:${node.kind}`, `${base}/kind`));
    }
    if (node.kind === "barrier") {
      const keys = Object.keys(node.config);
      const supported = keys.length === 0 ||
        (keys.length === 1 && keys[0] === "condition" && node.config.condition === "all");
      if (!supported) {
        result.push(failure(node.id, "node-config:barrier", `${base}/config`));
      }
    }
    if (Object.hasOwn(node, "cache")) {
      result.push(failure(node.id, "node-cache", `${base}/cache`));
    }
    if (Object.hasOwn(node, "resources")) {
      result.push(failure(node.id, "resource-admission", `${base}/resources`));
    }
    if (Object.hasOwn(node, "isolation")) {
      result.push(failure(node.id, "isolation-provider", `${base}/isolation`));
    }
    if (node.retry?.jitter === true) {
      result.push(failure(node.id, "retry-jitter", `${base}/retry/jitter`));
    }
  }

  for (const [index, edge] of graph.edges.entries()) {
    const base = `#/edges/${index}`;
    if (Object.hasOwn(edge, "map")) {
      result.push(failure(edge.from.node, "edge-map", `${base}/map`));
    }
    if (edge.mode === "stream" || edge.mode === "artifact-ref") {
      result.push(failure(edge.from.node, `edge-mode:${edge.mode}`, `${base}/mode`));
    }
  }

  const policies = graph.policies ?? {};
  for (const [key, capability] of [
    ["maxDynamicNodes", "dynamic-graph-patch"],
    ["maxDurationMs", "graph-deadline"],
    ["maxCostUsd", "cost-budget"],
  ]) {
    if (Object.hasOwn(policies, key)) {
      result.push(failure(graphOwner, capability, `#/policies/${key}`));
    }
  }
  for (const key of Object.keys(policies)
    .filter((item) => !SUPPORTED_POLICIES.has(item) &&
      item !== "maxDynamicNodes" && item !== "maxDurationMs" && item !== "maxCostUsd")
    .sort(compareUnicodeCodePoints)) {
    result.push(failure(graphOwner, `policy:${key}`, `#/policies/${pointer(key)}`));
  }
  return result;
}

export function validateRuntimeCapabilityGraphSemantics(graph, caseName) {
  const nodeIds = graph.nodes.map((node) => node.id);
  assert.equal(
    new Set(nodeIds).size,
    nodeIds.length,
    `${caseName} contains duplicate node IDs`,
  );
  const nodes = new Set(nodeIds);
  const adjacency = new Map(nodeIds.map((nodeId) => [nodeId, []]));
  const indegree = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  const fanOut = new Map(nodeIds.map((nodeId) => [nodeId, 0]));
  for (const entrypoint of graph.entrypoints) {
    assert.ok(nodes.has(entrypoint), `${caseName} entrypoint ${entrypoint} is missing`);
  }
  for (const output of Object.values(graph.outputs)) {
    assert.ok(nodes.has(output.node), `${caseName} output node ${output.node} is missing`);
  }
  for (const edge of graph.edges) {
    assert.ok(nodes.has(edge.from.node), `${caseName} edge source ${edge.from.node} is missing`);
    assert.ok(nodes.has(edge.to.node), `${caseName} edge target ${edge.to.node} is missing`);
    adjacency.get(edge.from.node).push(edge.to.node);
    indegree.set(edge.to.node, indegree.get(edge.to.node) + 1);
    fanOut.set(edge.from.node, fanOut.get(edge.from.node) + 1);
  }
  for (const entrypoint of graph.entrypoints) {
    assert.equal(indegree.get(entrypoint), 0, `${caseName} entrypoint has an incoming edge`);
  }

  const reachable = new Set(graph.entrypoints);
  const pending = [...graph.entrypoints];
  while (pending.length > 0) {
    const current = pending.shift();
    for (const target of adjacency.get(current)) {
      if (!reachable.has(target)) {
        reachable.add(target);
        pending.push(target);
      }
    }
  }
  assert.equal(reachable.size, nodeIds.length, `${caseName} contains unreachable nodes`);

  const remaining = new Map(indegree);
  const ready = nodeIds.filter((nodeId) => remaining.get(nodeId) === 0);
  const depth = new Map(ready.map((nodeId) => [nodeId, 1]));
  let visited = 0;
  while (ready.length > 0) {
    const current = ready.shift();
    visited += 1;
    for (const target of adjacency.get(current)) {
      depth.set(target, Math.max(depth.get(target) ?? 1, depth.get(current) + 1));
      const next = remaining.get(target) - 1;
      remaining.set(target, next);
      if (next === 0) ready.push(target);
    }
  }
  assert.equal(visited, nodeIds.length, `${caseName} contains a cycle`);

  if (graph.policies?.maxDepth !== undefined) {
    assert.ok(
      Math.max(...depth.values()) <= graph.policies.maxDepth,
      `${caseName} exceeds policies.maxDepth`,
    );
  }
  if (graph.policies?.maxFanOut !== undefined) {
    assert.ok(
      Math.max(...fanOut.values()) <= graph.policies.maxFanOut,
      `${caseName} exceeds policies.maxFanOut`,
    );
  }
}

export async function validateRuntimeCapabilityFixture() {
  const [fixture, schema, graphSchema] = await Promise.all(
    [CASE_PATH, SCHEMA_PATH, GRAPH_SCHEMA_PATH].map(async (path) =>
      JSON.parse(await readFile(path, "utf8"))),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(graphSchema);
  assert.equal(
    ajv.validateSchema(schema),
    true,
    `runtime capability schema is invalid: ${JSON.stringify(ajv.errors)}`,
  );
  const validate = ajv.compile(schema);
  assert.equal(
    validate(fixture),
    true,
    `runtime capability fixture is invalid: ${JSON.stringify(validate.errors)}`,
  );

  assert.equal(new Set(fixture.cases.map((item) => item.name)).size, fixture.cases.length);
  for (const testCase of fixture.cases) {
    validateRuntimeCapabilityGraphSemantics(testCase.graph, testCase.name);
    const expected = expectedFailures(testCase.graph);
    assert.deepEqual(
      testCase.expect.failures,
      expected,
      `${testCase.name} failure projection or ordering drifted`,
    );
    assert.equal(testCase.expect.supported, expected.length === 0);
    assert.ok(testCase.graph.nodes.some((node) => node.id === testCase.graph.entrypoints[0]));
    for (const item of expected) {
      assert.ok(testCase.graph.nodes.some((node) => node.id === item.nodeId));
    }
  }
  return fixture;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await validateRuntimeCapabilityFixture();
  process.stdout.write(`${JSON.stringify({ contract: fixture.contract, cases: fixture.cases.length })}\n`);
}
