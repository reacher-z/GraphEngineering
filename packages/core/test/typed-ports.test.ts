import { describe, expect, it } from "vitest";
import {
  compileGraph,
  hasStrictTypedPorts,
  validateStrictTypedPorts,
  type DiagnosticCode,
  type GraphSpec,
  type JsonSchema,
} from "../src/index.js";

const STRING_SCHEMA = Object.freeze({ type: "string" });
const NUMBER_SCHEMA = Object.freeze({ type: "number" });
const TYPED_POLICY = Object.freeze({
  "graphengineering.reacher-z.github.io/typed-ports": Object.freeze({
    apiVersion: "graphengineering.reacher-z.github.io/typed-ports/v1alpha1",
    mode: "strict-exact",
  }),
});

function objectSchema(properties: Record<string, JsonSchema>, required = Object.keys(properties)): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

function typedGraph(): GraphSpec {
  const inputSchema = objectSchema({ query: STRING_SCHEMA });
  const rootOutput = objectSchema({ value: STRING_SCHEMA });
  const targetInput = objectSchema({ value: STRING_SCHEMA });
  const targetOutput = objectSchema({ result: STRING_SCHEMA });
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "typed-graph", version: "1" },
    inputSchema,
    outputSchema: targetOutput,
    entrypoints: ["root"],
    outputs: { result: { node: "target", port: "result" } },
    nodes: [
      {
        id: "root",
        kind: "transform",
        inputSchema,
        outputSchema: rootOutput,
        config: null,
      },
      {
        id: "target",
        kind: "transform",
        inputSchema: targetInput,
        outputSchema: targetOutput,
        config: null,
      },
    ],
    edges: [
      {
        id: "root-target",
        from: { node: "root", port: "value" },
        to: { node: "target", port: "value" },
        schema: STRING_SCHEMA,
      },
    ],
    policies: TYPED_POLICY,
  };
}

function clone(graph = typedGraph()): GraphSpec {
  return JSON.parse(JSON.stringify(graph)) as GraphSpec;
}

function typedCodes(graph: GraphSpec): DiagnosticCode[] {
  return compileGraph(graph).diagnostics.map((item) => item.code);
}

describe("strict-exact typed-port compiler profile", () => {
  it("accepts explicit source/target/output ports and exact edge schemas", () => {
    const graph = typedGraph();
    expect(hasStrictTypedPorts(graph)).toBe(true);
    expect(validateStrictTypedPorts(graph)).toEqual([]);
    expect(compileGraph(graph)).toMatchObject({ valid: true, diagnostics: [] });
  });

  it("accepts an implicit target binding using the source node id", () => {
    const graph = clone();
    graph.edges[0] = {
      id: "root-target",
      from: { node: "root", port: "value" },
      to: { node: "target" },
      schema: STRING_SCHEMA,
    };
    graph.nodes[1] = {
      ...graph.nodes[1]!,
      inputSchema: objectSchema({ root: STRING_SCHEMA }),
    };
    expect(typedCodes(graph)).toEqual([]);
  });

  it("treats schema object key order as irrelevant under canonical exactness", () => {
    const graph = clone();
    const differentlyOrdered = {
      maxLength: 30,
      type: "string",
      minLength: 1,
    };
    const sourceOrdered = {
      type: "string",
      minLength: 1,
      maxLength: 30,
    };
    graph.nodes[0] = {
      ...graph.nodes[0]!,
      outputSchema: objectSchema({ value: sourceOrdered }),
    };
    graph.nodes[1] = {
      ...graph.nodes[1]!,
      inputSchema: objectSchema({ value: differentlyOrdered }),
    };
    graph.edges[0] = { ...graph.edges[0]!, schema: differentlyOrdered };
    expect(typedCodes(graph)).toEqual([]);
  });

  it.each([
    [
      "GE1201_MISSING_SOURCE_PORT",
      (graph: GraphSpec) => {
        graph.edges[0] = { ...graph.edges[0]!, from: { node: "root", port: "missing" } };
      },
      "#/edges/0/from/port",
      { edgeId: "root-target", nodeIds: ["root"] },
    ],
    [
      "GE1202_MISSING_TARGET_PORT",
      (graph: GraphSpec) => {
        graph.edges[0] = { ...graph.edges[0]!, to: { node: "target", port: "missing" } };
      },
      "#/edges/0/to/port",
      { edgeId: "root-target", nodeIds: ["target"] },
    ],
    [
      "GE1203_PORT_SCHEMA_MISMATCH",
      (graph: GraphSpec) => {
        graph.nodes[1] = { ...graph.nodes[1]!, inputSchema: objectSchema({ value: NUMBER_SCHEMA }) };
      },
      "#/edges/0",
      { edgeId: "root-target", nodeIds: ["root", "target"] },
    ],
    [
      "GE1206_OUTPUT_SCHEMA_MISMATCH",
      (graph: GraphSpec) => {
        graph.outputSchema = objectSchema({ result: NUMBER_SCHEMA });
      },
      "#/outputs/result",
      { outputName: "result", nodeIds: ["target"] },
    ],
    [
      "GE1207_ENTRYPOINT_SCHEMA_MISMATCH",
      (graph: GraphSpec) => {
        graph.nodes[0] = { ...graph.nodes[0]!, inputSchema: objectSchema({ other: STRING_SCHEMA }) };
      },
      "#/entrypoints/0",
      { nodeIds: ["root"] },
    ],
    [
      "GE1208_UNSUPPORTED_TYPED_EDGE_MODE",
      (graph: GraphSpec) => {
        graph.edges[0] = { ...graph.edges[0]!, mode: "stream" };
      },
      "#/edges/0/mode",
      { edgeId: "root-target", nodeIds: ["root", "target"] },
    ],
  ] as const)("emits %s at a stable path", (expectedCode, mutate, expectedPath, projection) => {
    const graph = clone();
    mutate(graph);
    const diagnostics = compileGraph(graph).diagnostics;
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: expectedCode, path: expectedPath, ...projection }),
    ]);
  });

  it("detects duplicate target bindings in edge declaration order", () => {
    const graph = clone();
    graph.entrypoints = ["root", "second"];
    graph.nodes = [
      graph.nodes[0]!,
      {
        ...graph.nodes[0]!,
        id: "second",
      },
      graph.nodes[1]!,
    ];
    graph.edges = [
      graph.edges[0]!,
      {
        id: "second-target",
        from: { node: "second", port: "value" },
        to: { node: "target", port: "value" },
        schema: STRING_SCHEMA,
      },
    ];
    expect(compileGraph(graph).diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1204_DUPLICATE_TARGET_BINDING",
        path: "#/edges/1/to/port",
        edgeId: "second-target",
        nodeIds: ["target"],
      }),
    ]);
  });

  it("checks edge.schema against both endpoint schemas", () => {
    const graph = clone();
    graph.edges[0] = { ...graph.edges[0]!, schema: NUMBER_SCHEMA };
    expect(typedCodes(graph)).toEqual(["GE1203_PORT_SCHEMA_MISMATCH"]);
  });

  it("keeps GE1203 at the edge path when edge.schema is absent", () => {
    const graph = clone();
    graph.edges[0] = {
      id: "root-target",
      from: { node: "root", port: "value" },
      to: { node: "target", port: "value" },
    };
    graph.nodes[1] = { ...graph.nodes[1]!, inputSchema: objectSchema({ value: NUMBER_SCHEMA }) };
    expect(compileGraph(graph).diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1203_PORT_SCHEMA_MISMATCH",
        path: "#/edges/0",
        edgeId: "root-target",
        nodeIds: ["root", "target"],
      }),
    ]);
  });

  it("accepts canonical-identical Draft 2020-12 boolean property subschemas", () => {
    const graph = clone();
    graph.nodes[0] = {
      ...graph.nodes[0]!,
      outputSchema: objectSchema({ value: true as unknown as JsonSchema }),
    };
    graph.nodes[1] = {
      ...graph.nodes[1]!,
      inputSchema: objectSchema({ value: true as unknown as JsonSchema }),
    };
    graph.edges[0] = {
      id: "root-target",
      from: { node: "root", port: "value" },
      to: { node: "target", port: "value" },
    };
    expect(typedCodes(graph)).toEqual([]);
  });

  it("checks public output properties are required on both graph and node schemas", () => {
    const missingGraphProperty = clone();
    missingGraphProperty.outputSchema = objectSchema({ other: STRING_SCHEMA });
    expect(typedCodes(missingGraphProperty)).toEqual(["GE1206_OUTPUT_SCHEMA_MISMATCH"]);

    const missingNodeProperty = clone();
    missingNodeProperty.nodes[1] = {
      ...missingNodeProperty.nodes[1]!,
      outputSchema: objectSchema({ other: STRING_SCHEMA }),
    };
    expect(typedCodes(missingNodeProperty)).toEqual(["GE1201_MISSING_SOURCE_PORT"]);
  });

  it.each([
    ["invalid Draft keyword value", { type: "not-a-json-schema-type" }],
    ["external ref", { $ref: "https://example.invalid/schema.json" }],
    ["relative ref", { $dynamicRef: "other.json#value" }],
    ["foreign dialect", { $schema: "https://json-schema.org/draft/2019-09/schema", type: "string" }],
    ["unknown dialect", { $schema: "https://example.invalid/schema", type: "string" }],
    ["unsupported pattern keyword", { type: "string", pattern: "^[a-z]+$" }],
    ["unsupported patternProperties keyword", { type: "object", patternProperties: { "^x": {} } }],
    ["unsupported nested pattern", { $defs: { probe: { pattern: "a+" } } }],
    ["empty nested enum", { $defs: { probe: { enum: [] } } }],
  ])("fails the complete Draft 2020-12 profile for %s", (_name, badSchema) => {
    const graph = clone();
    graph.nodes[0] = {
      ...graph.nodes[0]!,
      outputSchema: objectSchema({ value: badSchema }),
    };
    expect(compileGraph(graph).diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1205_INVALID_PORT_SCHEMA",
        path: "#/nodes/0/outputSchema",
        nodeIds: ["root"],
      }),
    ]);
  });

  it("accepts only the exact declared Draft 2020-12 dialect URI", () => {
    const graph = clone();
    const declared = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
    };
    graph.nodes[0] = {
      ...graph.nodes[0]!,
      outputSchema: objectSchema({ value: declared }),
    };
    graph.nodes[1] = {
      ...graph.nodes[1]!,
      inputSchema: objectSchema({ value: declared }),
    };
    graph.edges[0] = { ...graph.edges[0]!, schema: declared };
    expect(typedCodes(graph)).toEqual([]);

    const trailingHash = clone(graph);
    const other = { ...declared, $schema: `${declared.$schema}#` };
    trailingHash.nodes[0] = {
      ...trailingHash.nodes[0]!,
      outputSchema: objectSchema({ value: other }),
    };
    expect(compileGraph(trailingHash).diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1205_INVALID_PORT_SCHEMA",
        path: "#/nodes/0/outputSchema",
        nodeIds: ["root"],
      }),
    ]);
  });

  it("projects edge-schema GE1205 with edgeId and no associated node set", () => {
    const graph = clone();
    graph.edges[0] = { ...graph.edges[0]!, schema: { type: "invalid" } };
    const diagnostic = compileGraph(graph).diagnostics[0];
    expect(diagnostic).toMatchObject({
      code: "GE1205_INVALID_PORT_SCHEMA",
      path: "#/edges/0/schema",
      edgeId: "root-target",
      nodeIds: [],
    });
    expect(diagnostic).not.toHaveProperty("outputName");
  });

  it("rejects equal local ref tokens whose independent roots resolve to different schemas", () => {
    const graph = clone();
    const schema = { $ref: "#/$defs/Payload" };
    graph.nodes[0] = {
      ...graph.nodes[0]!,
      outputSchema: {
        ...objectSchema({ value: schema }),
        $defs: { Payload: { type: "string" } },
      },
    };
    graph.nodes[1] = {
      ...graph.nodes[1]!,
      inputSchema: {
        ...objectSchema({ value: schema }),
        $defs: { Payload: { type: "number" } },
      },
    };
    expect(compileGraph(graph).diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1205_INVALID_PORT_SCHEMA",
        path: "#/nodes/0/outputSchema",
        nodeIds: ["root"],
      }),
      expect.objectContaining({
        code: "GE1205_INVALID_PORT_SCHEMA",
        path: "#/nodes/1/inputSchema",
        nodeIds: ["target"],
      }),
    ]);
  });

  it("maps a malformed opt-in policy to GE1205 and stops before binding cascades", () => {
    const graph = clone();
    graph.policies = {
      "graphengineering.reacher-z.github.io/typed-ports": {
        apiVersion: "graphengineering.reacher-z.github.io/typed-ports/v1alpha1",
        mode: "strict-exact",
        permissive: true,
      },
    };
    graph.edges[0] = { ...graph.edges[0]!, from: { node: "root", port: "missing" } };
    expect(hasStrictTypedPorts(graph)).toBe(false);
    expect(compileGraph(graph).diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1205_INVALID_PORT_SCHEMA",
        path: "#/policies/graphengineering.reacher-z.github.io~1typed-ports",
      }),
    ]);
  });

  it("leaves legacy graphs unchanged and makes no false static type claim", () => {
    const graph = clone();
    delete graph.policies;
    graph.nodes[1] = { ...graph.nodes[1]!, inputSchema: {} };
    graph.edges[0] = { ...graph.edges[0]!, mode: "artifact-ref" };
    expect(hasStrictTypedPorts(graph)).toBe(false);
    expect(validateStrictTypedPorts(graph)).toEqual([]);
    expect(compileGraph(graph).valid).toBe(true);
  });

  it("does not execute proxy traps at the standalone typed-port API boundary", () => {
    let calls = 0;
    const hostile = new Proxy({}, {
      get() {
        calls += 1;
        throw new Error("SECRET_TYPED_PROXY");
      },
      ownKeys() {
        calls += 1;
        throw new Error("SECRET_TYPED_PROXY");
      },
    });
    expect(hasStrictTypedPorts(hostile)).toBe(false);
    expect(validateStrictTypedPorts(hostile)).toEqual([
      expect.objectContaining({
        code: "GE1205_INVALID_PORT_SCHEMA",
        path: "#",
        nodeIds: [],
      }),
    ]);
    expect(calls).toBe(0);
  });
});
