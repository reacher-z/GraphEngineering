const GRAPH_KEYS = new Set([
  "apiVersion",
  "kind",
  "metadata",
  "inputSchema",
  "outputSchema",
  "stateSchema",
  "entrypoints",
  "outputs",
  "nodes",
  "edges",
  "policies",
]);
const NODE_KEYS = new Set([
  "id",
  "kind",
  "inputSchema",
  "outputSchema",
  "config",
  "retry",
  "timeoutMs",
  "cache",
  "resources",
  "isolation",
  "sideEffects",
]);
const EDGE_KEYS = new Set(["id", "from", "to", "map", "condition", "mode", "schema"]);
const ENDPOINT_KEYS = new Set(["node", "port"]);
const METADATA_KEYS = new Set(["name", "version", "description", "labels"]);
const RETRY_KEYS = new Set([
  "maxAttempts",
  "initialDelayMs",
  "maxDelayMs",
  "backoffMultiplier",
  "jitter",
]);
const NODE_KINDS = new Set([
  "agent",
  "model",
  "tool",
  "transform",
  "subgraph",
  "router",
  "barrier",
  "validator",
  "human",
]);
const EDGE_MODES = new Set(["value", "stream", "artifact-ref"]);
const SIDE_EFFECT_MODES = new Set(["none", "idempotent", "non-idempotent"]);
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const GRAPH_NAME = /^[a-z][a-z0-9-]{0,62}$/;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, issues: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${path}/${key}: unknown property`);
  }
}

function required(value: Record<string, unknown>, keys: readonly string[], path: string, issues: string[]): void {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) issues.push(`${path}/${key}: required property is missing`);
  }
}

function validateEndpoint(value: unknown, path: string, issues: string[]): void {
  if (!record(value)) {
    issues.push(`${path}: expected an endpoint object`);
    return;
  }
  unknownKeys(value, ENDPOINT_KEYS, path, issues);
  required(value, ["node"], path, issues);
  if (typeof value.node !== "string" || value.node.length === 0) issues.push(`${path}/node: expected a non-empty string`);
  if (value.port !== undefined && (typeof value.port !== "string" || value.port.length === 0)) {
    issues.push(`${path}/port: expected a non-empty string`);
  }
}

function validateMetadata(value: unknown, issues: string[]): void {
  if (!record(value)) {
    issues.push("#/metadata: expected an object");
    return;
  }
  unknownKeys(value, METADATA_KEYS, "#/metadata", issues);
  required(value, ["name", "version"], "#/metadata", issues);
  if (typeof value.name !== "string" || !GRAPH_NAME.test(value.name)) issues.push("#/metadata/name: invalid graph name");
  if (typeof value.version !== "string" || value.version.length === 0) issues.push("#/metadata/version: expected a non-empty string");
  if (value.description !== undefined && typeof value.description !== "string") issues.push("#/metadata/description: expected a string");
  if (value.labels !== undefined) {
    if (!record(value.labels) || Object.values(value.labels).some((item) => typeof item !== "string")) {
      issues.push("#/metadata/labels: expected a string map");
    }
  }
}

function validateNode(value: unknown, index: number, issues: string[]): void {
  const path = `#/nodes/${index}`;
  if (!record(value)) {
    issues.push(`${path}: expected an object`);
    return;
  }
  unknownKeys(value, NODE_KEYS, path, issues);
  required(value, ["id", "kind", "inputSchema", "outputSchema", "config"], path, issues);
  if (typeof value.id !== "string" || !IDENTIFIER.test(value.id)) issues.push(`${path}/id: invalid node id`);
  if (typeof value.kind !== "string" || !NODE_KINDS.has(value.kind)) issues.push(`${path}/kind: invalid node kind`);
  if (!record(value.inputSchema)) issues.push(`${path}/inputSchema: expected an object`);
  if (!record(value.outputSchema)) issues.push(`${path}/outputSchema: expected an object`);
  if (value.timeoutMs !== undefined && (!Number.isInteger(value.timeoutMs) || (value.timeoutMs as number) < 1)) {
    issues.push(`${path}/timeoutMs: expected a positive integer`);
  }
  if (value.sideEffects !== undefined && (typeof value.sideEffects !== "string" || !SIDE_EFFECT_MODES.has(value.sideEffects))) {
    issues.push(`${path}/sideEffects: invalid mode`);
  }
  for (const key of ["cache", "resources", "isolation"] as const) {
    if (value[key] !== undefined && !record(value[key])) issues.push(`${path}/${key}: expected an object`);
  }
  if (value.retry !== undefined) {
    if (!record(value.retry)) {
      issues.push(`${path}/retry: expected an object`);
    } else {
      unknownKeys(value.retry, RETRY_KEYS, `${path}/retry`, issues);
      const { maxAttempts, initialDelayMs, maxDelayMs, backoffMultiplier, jitter } = value.retry;
      if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || (maxAttempts as number) < 1 || (maxAttempts as number) > 100)) {
        issues.push(`${path}/retry/maxAttempts: expected an integer from 1 to 100`);
      }
      for (const [name, delayValue] of [["initialDelayMs", initialDelayMs], ["maxDelayMs", maxDelayMs]] as const) {
        if (delayValue !== undefined && (!Number.isInteger(delayValue) || (delayValue as number) < 0)) {
          issues.push(`${path}/retry/${name}: expected a non-negative integer`);
        }
      }
      if (backoffMultiplier !== undefined && (typeof backoffMultiplier !== "number" || backoffMultiplier < 1)) {
        issues.push(`${path}/retry/backoffMultiplier: expected a number >= 1`);
      }
      if (jitter !== undefined && typeof jitter !== "boolean") issues.push(`${path}/retry/jitter: expected a boolean`);
    }
  }
}

function validateEdge(value: unknown, index: number, issues: string[]): void {
  const path = `#/edges/${index}`;
  if (!record(value)) {
    issues.push(`${path}: expected an object`);
    return;
  }
  unknownKeys(value, EDGE_KEYS, path, issues);
  required(value, ["id", "from", "to"], path, issues);
  if (typeof value.id !== "string" || !IDENTIFIER.test(value.id)) issues.push(`${path}/id: invalid edge id`);
  validateEndpoint(value.from, `${path}/from`, issues);
  validateEndpoint(value.to, `${path}/to`, issues);
  if (value.mode !== undefined && (typeof value.mode !== "string" || !EDGE_MODES.has(value.mode))) {
    issues.push(`${path}/mode: invalid edge mode`);
  }
  for (const key of ["map", "condition", "schema"] as const) {
    if (value[key] !== undefined && !record(value[key])) issues.push(`${path}/${key}: expected an object`);
  }
}

/** Dependency-free structural validation of the public v1alpha1 Graph envelope. */
export function validateGraphDocument(value: unknown): readonly string[] {
  const issues: string[] = [];
  if (!record(value)) return ["#: expected a Graph object"];

  unknownKeys(value, GRAPH_KEYS, "#", issues);
  required(
    value,
    ["apiVersion", "kind", "metadata", "inputSchema", "outputSchema", "entrypoints", "outputs", "nodes", "edges"],
    "#",
    issues,
  );
  if (value.apiVersion !== "graphengineering.reacher-z.github.io/v1alpha1") issues.push("#/apiVersion: unsupported version");
  if (value.kind !== "Graph") issues.push("#/kind: expected 'Graph'");
  validateMetadata(value.metadata, issues);
  if (!record(value.inputSchema)) issues.push("#/inputSchema: expected an object");
  if (!record(value.outputSchema)) issues.push("#/outputSchema: expected an object");
  if (value.stateSchema !== undefined && !record(value.stateSchema)) issues.push("#/stateSchema: expected an object");

  if (!Array.isArray(value.entrypoints) || value.entrypoints.length === 0) {
    issues.push("#/entrypoints: expected a non-empty array");
  } else {
    if (value.entrypoints.some((item) => typeof item !== "string" || item.length === 0)) {
      issues.push("#/entrypoints: every item must be a non-empty string");
    }
    if (new Set(value.entrypoints).size !== value.entrypoints.length) issues.push("#/entrypoints: items must be unique");
  }

  if (!record(value.outputs) || Object.keys(value.outputs).length === 0) {
    issues.push("#/outputs: expected a non-empty endpoint map");
  } else {
    for (const [name, endpoint] of Object.entries(value.outputs)) validateEndpoint(endpoint, `#/outputs/${name}`, issues);
  }
  if (!Array.isArray(value.nodes)) issues.push("#/nodes: expected an array");
  else value.nodes.forEach((item, index) => validateNode(item, index, issues));
  if (!Array.isArray(value.edges)) issues.push("#/edges: expected an array");
  else value.edges.forEach((item, index) => validateEdge(item, index, issues));
  if (value.policies !== undefined) {
    if (!record(value.policies)) {
      issues.push("#/policies: expected an object");
    } else {
      const positiveIntegers = [
        "maxConcurrency",
        "maxDepth",
        "maxFanOut",
        "maxTotalAttempts",
        "maxDurationMs",
      ] as const;
      for (const key of positiveIntegers) {
        const item = value.policies[key];
        if (item !== undefined && (!Number.isInteger(item) || (item as number) < 1)) {
          issues.push(`#/policies/${key}: expected a positive integer`);
        }
      }
      const dynamicNodes = value.policies.maxDynamicNodes;
      if (dynamicNodes !== undefined && (!Number.isInteger(dynamicNodes) || (dynamicNodes as number) < 0)) {
        issues.push("#/policies/maxDynamicNodes: expected a non-negative integer");
      }
      const cost = value.policies.maxCostUsd;
      if (cost !== undefined && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) {
        issues.push("#/policies/maxCostUsd: expected a non-negative finite number");
      }
    }
  }

  return issues;
}
