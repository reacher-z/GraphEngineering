import { Ajv2020 } from "ajv/dist/2020.js";
import {
  canonicalSerialize,
  captureCanonicalJson,
  compareUnicodeCodePoints,
} from "./canonical.js";
import type { CompilerDiagnostic } from "./compiler.js";
import type { EdgeSpec, GraphSpec, JsonSchema } from "./types.js";

export const STRICT_TYPED_PORTS_POLICY_KEY =
  "graphengineering.reacher-z.github.io/typed-ports" as const;
export const STRICT_TYPED_PORTS_API_VERSION =
  "graphengineering.reacher-z.github.io/typed-ports/v1alpha1" as const;
export const STRICT_TYPED_PORTS_MODE = "strict-exact" as const;

const DRAFT_2020_12_DIALECT =
  "https://json-schema.org/draft/2020-12/schema" as const;

export interface StrictTypedPortsPolicy {
  readonly apiVersion: typeof STRICT_TYPED_PORTS_API_VERSION;
  readonly mode: typeof STRICT_TYPED_PORTS_MODE;
}

const POLICY_PATH =
  "#/policies/graphengineering.reacher-z.github.io~1typed-ports";

const schemaValidator = new Ajv2020({
  addUsedSchema: false,
  allErrors: true,
  logger: false,
  strict: false,
  validateFormats: false,
});

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function diagnostic(
  code:
    | "GE1201_MISSING_SOURCE_PORT"
    | "GE1202_MISSING_TARGET_PORT"
    | "GE1203_PORT_SCHEMA_MISMATCH"
    | "GE1204_DUPLICATE_TARGET_BINDING"
    | "GE1205_INVALID_PORT_SCHEMA"
    | "GE1206_OUTPUT_SCHEMA_MISMATCH"
    | "GE1207_ENTRYPOINT_SCHEMA_MISMATCH"
    | "GE1208_UNSUPPORTED_TYPED_EDGE_MODE",
  message: string,
  path: string,
  fields: Pick<CompilerDiagnostic, "nodeIds" | "edgeId" | "outputName"> = {},
): CompilerDiagnostic {
  const nodeIds = Object.freeze([...(fields.nodeIds ?? [])]);
  return Object.freeze({
    code,
    severity: "error",
    message,
    path,
    nodeIds,
    ...(fields.edgeId === undefined ? {} : { edgeId: fields.edgeId }),
    ...(fields.outputName === undefined ? {} : { outputName: fields.outputName }),
  });
}

function schemaEquals(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

const SCHEMA_MAP_KEYWORDS = [
  "$defs",
  "definitions",
  "properties",
  "dependentSchemas",
] as const;
const SCHEMA_VALUE_KEYWORDS = [
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "items",
  "unevaluatedItems",
  "contentSchema",
] as const;
const SCHEMA_ARRAY_KEYWORDS = ["prefixItems", "allOf", "anyOf", "oneOf"] as const;

function unsupportedSchemaProfile(value: unknown): boolean {
  if (typeof value === "boolean") return false;
  if (!record(value)) return false;
  if (
    Object.hasOwn(value, "$ref") ||
    Object.hasOwn(value, "$dynamicRef") ||
    Object.hasOwn(value, "pattern") ||
    Object.hasOwn(value, "patternProperties")
  ) {
    return true;
  }
  if (Object.hasOwn(value, "$schema") && value.$schema !== DRAFT_2020_12_DIALECT) return true;
  if (Array.isArray(value.enum) && value.enum.length === 0) return true;

  for (const keyword of SCHEMA_MAP_KEYWORDS) {
    const map = value[keyword];
    if (!record(map)) continue;
    for (const child of Object.values(map)) {
      if (unsupportedSchemaProfile(child)) return true;
    }
  }
  for (const keyword of SCHEMA_VALUE_KEYWORDS) {
    const child = value[keyword];
    if (Array.isArray(child)) {
      if (child.some(unsupportedSchemaProfile)) return true;
    } else if (unsupportedSchemaProfile(child)) {
      return true;
    }
  }
  for (const keyword of SCHEMA_ARRAY_KEYWORDS) {
    const children = value[keyword];
    if (Array.isArray(children) && children.some(unsupportedSchemaProfile)) return true;
  }
  const dependencies = value.dependencies;
  if (record(dependencies)) {
    for (const child of Object.values(dependencies)) {
      if ((record(child) || typeof child === "boolean") && unsupportedSchemaProfile(child)) {
        return true;
      }
    }
  }
  return false;
}

function validDraft202012Schema(value: unknown): boolean {
  // v1alpha1 intentionally refuses even local references. Comparing equal ref
  // tokens without resolving each independent schema root can manufacture a
  // false proof when the referenced definitions differ.
  if (unsupportedSchemaProfile(value)) return false;
  try {
    if (schemaValidator.validateSchema(value as object | boolean) !== true) return false;
    return true;
  } catch {
    return false;
  }
}

interface LocatedSchema {
  readonly value: unknown;
  readonly path: string;
  readonly nodeIds?: readonly string[];
  readonly edgeId?: string;
}

function participatingSchemas(graph: GraphSpec): readonly LocatedSchema[] {
  const schemas: LocatedSchema[] = [
    { value: graph.inputSchema, path: "#/inputSchema" },
    { value: graph.outputSchema, path: "#/outputSchema" },
  ];
  if (graph.stateSchema !== undefined) {
    schemas.push({ value: graph.stateSchema, path: "#/stateSchema" });
  }
  for (const [index, node] of graph.nodes.entries()) {
    schemas.push(
      { value: node.inputSchema, path: `#/nodes/${index}/inputSchema`, nodeIds: [node.id] },
      { value: node.outputSchema, path: `#/nodes/${index}/outputSchema`, nodeIds: [node.id] },
    );
  }
  for (const [index, edge] of graph.edges.entries()) {
    if (edge.schema !== undefined) {
      schemas.push({
        value: edge.schema,
        path: `#/edges/${index}/schema`,
        edgeId: edge.id,
      });
    }
  }
  return schemas;
}

type PortSelection =
  | { readonly found: false }
  | { readonly found: true; readonly schema: unknown };

function selectRequiredObjectProperty(schema: unknown, port: string): PortSelection {
  if (!record(schema) || schema.type !== "object") return { found: false };
  const properties = schema.properties;
  const required = schema.required;
  if (!record(properties) || !Object.hasOwn(properties, port)) return { found: false };
  if (!Array.isArray(required) || !required.includes(port)) return { found: false };
  return { found: true, schema: properties[port] };
}

function strictPolicyDiagnostic(graph: GraphSpec): CompilerDiagnostic | null {
  const policies = graph.policies;
  if (policies === undefined || !Object.hasOwn(policies, STRICT_TYPED_PORTS_POLICY_KEY)) {
    return null;
  }
  const value = policies[STRICT_TYPED_PORTS_POLICY_KEY];
  if (
    !record(value) ||
    Object.keys(value).length !== 2 ||
    value.apiVersion !== STRICT_TYPED_PORTS_API_VERSION ||
    value.mode !== STRICT_TYPED_PORTS_MODE
  ) {
    return diagnostic(
      "GE1205_INVALID_PORT_SCHEMA",
      "The strict typed-port policy must exactly select v1alpha1 strict-exact mode",
      POLICY_PATH,
    );
  }
  return null;
}

function hasStrictTypedPortsSnapshot(graph: GraphSpec): boolean {
  const policies = graph.policies;
  if (policies === undefined || !Object.hasOwn(policies, STRICT_TYPED_PORTS_POLICY_KEY)) {
    return false;
  }
  return strictPolicyDiagnostic(graph) === null;
}

function captureTypedGraph(graph: GraphSpec | unknown): GraphSpec | null {
  try {
    const captured = captureCanonicalJson(graph).value;
    return record(captured) ? captured as unknown as GraphSpec : null;
  } catch {
    return null;
  }
}

/** True only for the exact policy on a safely detached graph snapshot. */
export function hasStrictTypedPorts(graph: GraphSpec | unknown): boolean {
  const captured = captureTypedGraph(graph);
  return captured !== null && hasStrictTypedPortsSnapshot(captured);
}

function transferSchema(
  edge: EdgeSpec,
  edgeIndex: number,
  source: GraphSpec["nodes"][number],
  diagnostics: CompilerDiagnostic[],
): PortSelection {
  if (edge.from.port === undefined) return { found: true, schema: source.outputSchema };
  const selected = selectRequiredObjectProperty(source.outputSchema, edge.from.port);
  if (!selected.found) {
    diagnostics.push(
      diagnostic(
        "GE1201_MISSING_SOURCE_PORT",
        `Edge '${edge.id}' source port '${edge.from.port}' is not a required output property`,
        `#/edges/${edgeIndex}/from/port`,
        { edgeId: edge.id, nodeIds: [source.id] },
      ),
    );
  }
  return selected;
}

/**
 * Validate the conservative v1alpha1 strict-exact profile. Legacy graphs which
 * do not opt in return no diagnostics and make no static typed-port claim.
 */
export function validateStrictTypedPortsSnapshot(graph: GraphSpec): readonly CompilerDiagnostic[] {
  const policies = graph.policies;
  if (policies === undefined || !Object.hasOwn(policies, STRICT_TYPED_PORTS_POLICY_KEY)) {
    return Object.freeze([]);
  }

  const malformedPolicy = strictPolicyDiagnostic(graph);
  if (malformedPolicy !== null) return Object.freeze([malformedPolicy]);

  const profileDiagnostics: CompilerDiagnostic[] = [];
  for (const schema of participatingSchemas(graph)) {
    if (!validDraft202012Schema(schema.value)) {
      profileDiagnostics.push(
        diagnostic(
          "GE1205_INVALID_PORT_SCHEMA",
          "Schema is not valid Draft 2020-12 JSON Schema or contains an unsupported reference",
          schema.path,
          {
            ...(schema.nodeIds === undefined ? {} : { nodeIds: schema.nodeIds }),
            ...(schema.edgeId === undefined ? {} : { edgeId: schema.edgeId }),
          },
        ),
      );
    }
  }
  if (profileDiagnostics.length > 0) return Object.freeze(profileDiagnostics);

  const diagnostics: CompilerDiagnostic[] = [];
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));

  for (const [index, entrypoint] of graph.entrypoints.entries()) {
    const node = nodesById.get(entrypoint);
    if (node !== undefined && !schemaEquals(graph.inputSchema, node.inputSchema)) {
      diagnostics.push(
        diagnostic(
          "GE1207_ENTRYPOINT_SCHEMA_MISMATCH",
          `Entrypoint '${entrypoint}' input schema does not exactly match graph inputSchema`,
          `#/entrypoints/${index}`,
          { nodeIds: [entrypoint] },
        ),
      );
    }
  }

  const targetBindings = new Map<string, string>();
  for (const [index, edge] of graph.edges.entries()) {
    const source = nodesById.get(edge.from.node);
    const target = nodesById.get(edge.to.node);
    if (source === undefined || target === undefined) continue;

    if (edge.mode !== undefined && edge.mode !== "value") {
      diagnostics.push(
        diagnostic(
          "GE1208_UNSUPPORTED_TYPED_EDGE_MODE",
          `Edge '${edge.id}' mode '${edge.mode}' is not supported by strict-exact typed ports`,
          `#/edges/${index}/mode`,
          { edgeId: edge.id, nodeIds: [source.id, target.id] },
        ),
      );
    }

    const sourceSelection = transferSchema(edge, index, source, diagnostics);
    const binding = edge.to.port ?? edge.from.node;
    const targetSelection = selectRequiredObjectProperty(target.inputSchema, binding);
    if (!targetSelection.found) {
      diagnostics.push(
        diagnostic(
          "GE1202_MISSING_TARGET_PORT",
          `Edge '${edge.id}' target binding '${binding}' is not a required input property`,
          edge.to.port === undefined ? `#/edges/${index}/to` : `#/edges/${index}/to/port`,
          { edgeId: edge.id, nodeIds: [target.id] },
        ),
      );
    }

    const targetBindingKey = `${target.id}\0${binding}`;
    const priorEdge = targetBindings.get(targetBindingKey);
    if (priorEdge === undefined) {
      targetBindings.set(targetBindingKey, edge.id);
    } else {
      diagnostics.push(
        diagnostic(
          "GE1204_DUPLICATE_TARGET_BINDING",
          `Edges '${priorEdge}' and '${edge.id}' write target binding '${binding}'`,
          edge.to.port === undefined ? `#/edges/${index}/to` : `#/edges/${index}/to/port`,
          { edgeId: edge.id, nodeIds: [target.id] },
        ),
      );
    }

    if (sourceSelection.found && targetSelection.found) {
      const edgeMatches =
        edge.schema === undefined || schemaEquals(sourceSelection.schema, edge.schema);
      if (!schemaEquals(sourceSelection.schema, targetSelection.schema) || !edgeMatches) {
        diagnostics.push(
          diagnostic(
            "GE1203_PORT_SCHEMA_MISMATCH",
            `Edge '${edge.id}' source, edge, and target schemas are not canonical-identical`,
            `#/edges/${index}`,
            { edgeId: edge.id, nodeIds: [source.id, target.id] },
          ),
        );
      }
    }
  }

  for (const outputName of Object.keys(graph.outputs).sort(compareUnicodeCodePoints)) {
    const endpoint = graph.outputs[outputName];
    if (endpoint === undefined) continue;
    const node = nodesById.get(endpoint.node);
    if (node === undefined) continue;

    const graphSelection = selectRequiredObjectProperty(graph.outputSchema, outputName);
    if (!graphSelection.found) {
      diagnostics.push(
        diagnostic(
          "GE1206_OUTPUT_SCHEMA_MISMATCH",
          `Public output '${outputName}' is not a required graph outputSchema property`,
          `#/outputs/${pointerSegment(outputName)}`,
          { outputName, nodeIds: [node.id] },
        ),
      );
      continue;
    }

    let nodeSelection: PortSelection;
    if (endpoint.port === undefined) {
      nodeSelection = { found: true, schema: node.outputSchema };
    } else {
      nodeSelection = selectRequiredObjectProperty(node.outputSchema, endpoint.port);
      if (!nodeSelection.found) {
        diagnostics.push(
          diagnostic(
            "GE1201_MISSING_SOURCE_PORT",
            `Public output '${outputName}' port '${endpoint.port}' is not a required node output property`,
            `#/outputs/${pointerSegment(outputName)}/port`,
            { outputName, nodeIds: [node.id] },
          ),
        );
      }
    }
    if (nodeSelection.found && !schemaEquals(nodeSelection.schema, graphSelection.schema)) {
      diagnostics.push(
        diagnostic(
          "GE1206_OUTPUT_SCHEMA_MISMATCH",
          `Public output '${outputName}' schema does not exactly match graph outputSchema`,
          `#/outputs/${pointerSegment(outputName)}`,
          { outputName, nodeIds: [node.id] },
        ),
      );
    }
  }

  return Object.freeze(diagnostics);
}

/** Safely validate an untrusted graph value without invoking caller accessors. */
export function validateStrictTypedPorts(
  graph: GraphSpec | unknown,
): readonly CompilerDiagnostic[] {
  const captured = captureTypedGraph(graph);
  if (captured === null) {
    return Object.freeze([
      diagnostic(
        "GE1205_INVALID_PORT_SCHEMA",
        "Typed-port validation requires a portable Graph IR object",
        "#",
      ),
    ]);
  }
  return validateStrictTypedPortsSnapshot(captured);
}

/** Detached value emitted by builder helpers; it does not mutate a graph. */
export const STRICT_TYPED_PORTS_POLICY: StrictTypedPortsPolicy = Object.freeze({
  apiVersion: STRICT_TYPED_PORTS_API_VERSION,
  mode: STRICT_TYPED_PORTS_MODE,
});

// Keep this type reachable for package consumers authoring strict schemas.
export type StrictTypedJsonSchema = JsonSchema;
