import {
  compareUnicodeCodePoints,
  compileGraph,
  type EdgeSpec,
  type GraphMetadata,
  type GraphPolicies,
  type GraphSpec,
  type JsonSchema,
  type NodeSpec,
} from "@graph-engineering/core";
import { PatternInputError } from "./errors.js";

const NODE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const KEY_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const GRAPH_NAME = /^[a-z][a-z0-9-]{0,62}$/;
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 100;
const MAX_ARRAY_LENGTH = 10_000;
export const MAX_PATTERN_ITEMS = 100;

export const PATTERN_LABEL = "graphengineering.reacher-z.github.io/pattern";
export const CAPABILITY_LABEL = "graphengineering.reacher-z.github.io/runtime-capability";

export type PatternKind = "diamond" | "routed-branches" | "verified-fanout" | "loop-until-dry";

export interface PatternIdentity {
  pattern: `${PatternKind}/v1alpha1`;
  capability: string;
}

export interface ParsedKeyedNode {
  key: string;
  node: NodeSpec;
  path: string;
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path: string, key: string): string {
  return `${path}/${pointerSegment(key)}`;
}

function invalidInput(message: string, path: string): never {
  throw new PatternInputError("GE_PATTERN_INVALID_INPUT", message, path);
}

function cloneArray(value: readonly unknown[], path: string, ancestors: WeakSet<object>, depth: number): unknown[] {
  if (value.length > MAX_ARRAY_LENGTH) {
    invalidInput(`array length exceeds ${MAX_ARRAY_LENGTH}`, path);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    invalidInput("symbol properties are not portable JSON", path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Object.keys(descriptors)) {
    if (key === "length") continue;
    const numeric = Number(key);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric >= value.length || String(numeric) !== key) {
      invalidInput(`array property '${key}' is not a portable JSON index`, childPath(path, key));
    }
  }

  const result: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = descriptors[key];
    if (descriptor === undefined) {
      invalidInput("sparse arrays are not portable JSON", childPath(path, key));
    }
    if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      invalidInput("accessor properties are not accepted", childPath(path, key));
    }
    if (!descriptor.enumerable) {
      invalidInput("non-enumerable values are not portable JSON", childPath(path, key));
    }
    result.push(snapshotValue(descriptor.value, childPath(path, key), ancestors, depth + 1));
  }
  return result;
}

function cloneRecord(
  value: object,
  path: string,
  ancestors: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    invalidInput("symbol properties are not portable JSON", path);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).sort(compareUnicodeCodePoints);
  if (keys.length > MAX_ARRAY_LENGTH) {
    invalidInput(`object property count exceeds ${MAX_ARRAY_LENGTH}`, path);
  }
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined) continue;
    const location = childPath(path, key);
    if (!("value" in descriptor) || descriptor.get !== undefined || descriptor.set !== undefined) {
      invalidInput("accessor properties are not accepted", location);
    }
    if (!descriptor.enumerable) {
      invalidInput("non-enumerable values are not portable JSON", location);
    }
    Object.defineProperty(result, key, {
      value: snapshotValue(descriptor.value, location, ancestors, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

function snapshotValue(value: unknown, path: string, ancestors: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) invalidInput(`nesting exceeds ${MAX_DEPTH} levels`, path);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalidInput("numbers must be finite", path);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    invalidInput(`unsupported portable JSON value '${typeof value}'`, path);
  }

  const objectValue = value as object;
  if (ancestors.has(objectValue)) invalidInput("cyclic values are not portable JSON", path);
  const prototype = Object.getPrototypeOf(objectValue);
  const array = Array.isArray(objectValue);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    invalidInput("only plain objects and arrays are portable JSON", path);
  }

  ancestors.add(objectValue);
  try {
    return array
      ? cloneArray(objectValue as readonly unknown[], path, ancestors, depth)
      : cloneRecord(objectValue, path, ancestors, depth);
  } finally {
    ancestors.delete(objectValue);
  }
}

/** Snapshot without invoking property getters. */
export function portableSnapshot(value: unknown, path = "#"): unknown {
  return snapshotValue(value, path, new WeakSet<object>(), 0);
}

export function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalidInput("expected an object", path);
  }
  return value as Record<string, unknown>;
}

export function snapshotOptions(
  value: unknown,
  allowedFields: ReadonlySet<string>,
): Record<string, unknown> {
  const snapshot = expectRecord(portableSnapshot(value, "#"), "#");
  for (const key of Object.keys(snapshot)) {
    if (!allowedFields.has(key)) {
      throw new PatternInputError(
        "GE_PATTERN_UNKNOWN_FIELD",
        `unknown pattern option '${key}'`,
        childPath("#", key),
      );
    }
  }
  return snapshot;
}

export function assertEntryFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new PatternInputError(
        "GE_PATTERN_UNKNOWN_FIELD",
        `unknown pattern entry field '${key}'`,
        childPath(path, key),
      );
    }
  }
}

export function safeKey(value: unknown, path: string, description: string): string {
  if (
    typeof value !== "string" ||
    !KEY_IDENTIFIER.test(value) ||
    RESERVED_KEYS.has(value)
  ) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_IDENTIFIER",
      `${description} must match ${KEY_IDENTIFIER.source} and not be a reserved object key`,
      path,
    );
  }
  return value;
}

export function parseNode(value: unknown, path: string): NodeSpec {
  const node = expectRecord(value, path);
  if (typeof node.id !== "string" || !NODE_IDENTIFIER.test(node.id)) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_IDENTIFIER",
      `node id must match ${NODE_IDENTIFIER.source}`,
      childPath(path, "id"),
    );
  }
  return node as unknown as NodeSpec;
}

export function parseKeyedNodes(value: unknown, path: string): ParsedKeyedNode[] {
  if (!Array.isArray(value)) invalidInput("expected an array", path);
  if (value.length === 0) {
    throw new PatternInputError("GE_PATTERN_EMPTY_COLLECTION", "at least one item is required", path);
  }
  if (value.length > MAX_PATTERN_ITEMS) {
    throw new PatternInputError(
      "GE_PATTERN_TOO_MANY_ITEMS",
      `at most ${MAX_PATTERN_ITEMS} items are allowed`,
      path,
    );
  }

  const keys = new Set<string>();
  const parsed = value.map((item, index) => {
    const itemPath = childPath(path, String(index));
    const entry = expectRecord(item, itemPath);
    assertEntryFields(entry, new Set(["key", "node"]), itemPath);
    const key = safeKey(entry.key, childPath(itemPath, "key"), "item key");
    if (keys.has(key)) {
      throw new PatternInputError(
        "GE_PATTERN_DUPLICATE_KEY",
        `duplicate item key '${key}'`,
        childPath(itemPath, "key"),
      );
    }
    keys.add(key);
    const nodePath = childPath(itemPath, "node");
    return { key, node: parseNode(entry.node, nodePath), path: nodePath };
  });
  return parsed.sort((left, right) => compareUnicodeCodePoints(left.key, right.key));
}

export function assertUniqueNodeIds(nodes: readonly { node: NodeSpec; path: string }[]): void {
  const seen = new Set<string>();
  for (const item of nodes) {
    if (seen.has(item.node.id)) {
      throw new PatternInputError(
        "GE_PATTERN_DUPLICATE_NODE_ID",
        `duplicate caller node id '${item.node.id}'`,
        childPath(item.path, "id"),
      );
    }
    seen.add(item.node.id);
  }
}

function metadataWithIdentity(value: unknown, identity: PatternIdentity): GraphMetadata {
  const metadata = expectRecord(value, "#/metadata");
  if (typeof metadata.name !== "string" || !GRAPH_NAME.test(metadata.name)) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_IDENTIFIER",
      `graph metadata.name must match ${GRAPH_NAME.source}`,
      "#/metadata/name",
    );
  }
  const labels = metadata.labels === undefined
    ? {}
    : expectRecord(metadata.labels, "#/metadata/labels");
  const required: Readonly<Record<string, string>> = {
    [PATTERN_LABEL]: identity.pattern,
    [CAPABILITY_LABEL]: identity.capability,
  };
  for (const [key, expected] of Object.entries(required)) {
    if (Object.hasOwn(labels, key) && labels[key] !== expected) {
      throw new PatternInputError(
        "GE_PATTERN_RESERVED_LABEL_CONFLICT",
        `reserved label '${key}' must equal '${expected}'`,
        childPath("#/metadata/labels", key),
      );
    }
    labels[key] = expected;
  }
  metadata.labels = portableSnapshot(labels, "#/metadata/labels") as Record<string, string>;
  return portableSnapshot(metadata, "#/metadata") as GraphMetadata;
}

function optionalRecord(value: unknown, path: string): Record<string, unknown> | undefined {
  return value === undefined ? undefined : expectRecord(value, path);
}

export function buildGraph(
  options: Record<string, unknown>,
  identity: PatternIdentity,
  entrypoint: string,
  exit: string,
  nodes: readonly NodeSpec[],
  edges: readonly EdgeSpec[],
): GraphSpec {
  const outputKey = options.outputKey === undefined
    ? "result"
    : safeKey(options.outputKey, "#/outputKey", "output key");
  const inputSchema = optionalRecord(options.inputSchema, "#/inputSchema") ?? { type: "object" };
  const outputSchema = optionalRecord(options.outputSchema, "#/outputSchema") ?? { type: "object" };
  const stateSchema = optionalRecord(options.stateSchema, "#/stateSchema");
  const policies = optionalRecord(options.policies, "#/policies");

  const graph: GraphSpec = {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: metadataWithIdentity(options.metadata, identity),
    inputSchema: inputSchema as JsonSchema,
    outputSchema: outputSchema as JsonSchema,
    ...(stateSchema === undefined ? {} : { stateSchema: stateSchema as JsonSchema }),
    entrypoints: [entrypoint],
    outputs: { [outputKey]: { node: exit } },
    nodes,
    edges,
    ...(policies === undefined ? {} : { policies: policies as GraphPolicies }),
  };

  const compilation = compileGraph(graph);
  if (!compilation.valid) {
    const details = compilation.diagnostics
      .map((item) => `${item.code}: ${item.message}`)
      .join("; ");
    throw new PatternInputError(
      "GE_PATTERN_CORE_REJECTED",
      `canonical core rejected constructed graph (${details || "unknown diagnostic"})`,
      "#",
    );
  }
  return deepFreeze(graph);
}

function deepFreezeValue<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) deepFreezeValue(descriptor.value);
  }
  return Object.freeze(value);
}

export function deepFreeze<T extends GraphSpec>(graph: T): T {
  return deepFreezeValue(graph);
}

export function edgeId(pattern: PatternKind, index: number): string {
  return `ge-${pattern}-${String(index).padStart(4, "0")}`;
}

export const BASE_FIELDS = new Set([
  "metadata",
  "inputSchema",
  "outputSchema",
  "stateSchema",
  "outputKey",
  "policies",
]);

export function fields(...patternFields: string[]): ReadonlySet<string> {
  return new Set([...BASE_FIELDS, ...patternFields]);
}
