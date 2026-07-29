import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  compileGraph,
  validateRegisteredEdgeCondition,
  validateRouteSelectionPolicy,
  type ConditionValidation,
  type GraphSpec,
  type PolicyValidation,
} from "../src/index.js";

interface MatrixExpectation {
  readonly valid: boolean;
  readonly relativePath?: string;
}

interface MatrixCase {
  readonly name: string;
  readonly value: unknown;
  readonly expect: MatrixExpectation;
}

interface CompilerCase {
  readonly name: string;
  readonly expectedGraphHash: string;
  readonly graph: GraphSpec;
  readonly expect: {
    readonly valid: boolean;
    readonly diagnostics: readonly Readonly<Record<string, unknown>>[];
  };
}

interface RouterCorpus {
  readonly policyValidationCases: readonly MatrixCase[];
  readonly conditionValidationCases: readonly MatrixCase[];
  readonly compilerCases: readonly CompilerCase[];
  readonly runtimeGraphs: Readonly<Record<string, GraphSpec>>;
  readonly runtimeGraphHashes: Readonly<Record<string, string>>;
  readonly hashContract: Readonly<Record<string, string>>;
  readonly invalidExecutionGate: {
    readonly typescript: Readonly<Record<string, unknown>>;
  };
}

const corpus = JSON.parse(readFileSync(
  new URL("../../../spec/conformance/integrated-router.case.json", import.meta.url),
  "utf8",
)) as RouterCorpus;

function projectDiagnostic(value: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return {
    code: value.code,
    path: value.path,
    nodeIds: value.nodeIds,
    ...(value.edgeId === undefined ? {} : { edgeId: value.edgeId }),
  };
}

const condition = (routeKey: string) => ({
  apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
  kind: "RouteEquals",
  routeKey,
});

function diagnosticOrderGraph(
  name: string,
  allowedRoutes: readonly string[],
  edges: GraphSpec["edges"],
): GraphSpec {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name, version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["route-a", "route-z"],
    outputs: { decision: { node: "route-a" } },
    nodes: [
      {
        id: "route-a",
        kind: "router",
        inputSchema: {},
        outputSchema: {},
        config: { kind: "single", allowedRoutes: [...allowedRoutes] },
      },
      {
        id: "route-z",
        kind: "router",
        inputSchema: {},
        outputSchema: {},
        config: { kind: "single", allowedRoutes: [...allowedRoutes] },
      },
      ...["target-a", "target-a-alt", "target-z", "target-z-alt"].map((id) => ({
        id,
        kind: "transform" as const,
        inputSchema: {},
        outputSchema: {},
        config: {},
      })),
    ],
    edges,
  };
}

describe("integrated router conformance", () => {
  test.each(corpus.policyValidationCases)("policy: $name", ({ value, expect: expected }) => {
    const actual: PolicyValidation = validateRouteSelectionPolicy(value);
    expect(actual.valid).toBe(expected.valid);
    if (!actual.valid) expect(actual.relativePath).toBe(expected.relativePath);
  });

  test.each(corpus.conditionValidationCases)("condition: $name", ({ value, expect: expected }) => {
    const actual: ConditionValidation = validateRegisteredEdgeCondition(value);
    expect(actual.valid).toBe(expected.valid);
    if (!actual.valid) expect(actual.relativePath).toBe(expected.relativePath);
  });

  test.each(corpus.compilerCases)("compiler: $name", (fixture) => {
    const actual = compileGraph(fixture.graph);
    expect(actual.graphHash).toBe(fixture.expectedGraphHash);
    expect(actual.valid).toBe(fixture.expect.valid);
    expect(actual.diagnostics.map((item) => projectDiagnostic(item as unknown as Readonly<Record<string, unknown>>)))
      .toEqual(fixture.expect.diagnostics);
  });

  test("runtime graph hashes and canonical hash contract are compiler-verified", () => {
    expect(corpus.hashContract).toEqual({
      canonicalGraph: "existing-canonical-json-serialization-of-captured-graph",
      graphHash: "lowercase-hex-sha256-of-utf8-canonicalGraph",
      crossRuntimeRequirement: "canonicalGraph-bytes-and-graphHash-must-both-match-literals",
    });
    expect(Object.keys(corpus.runtimeGraphs)).toEqual(Object.keys(corpus.runtimeGraphHashes));
    for (const [name, graph] of Object.entries(corpus.runtimeGraphs)) {
      const result = compileGraph(graph);
      expect(result.valid, name).toBe(true);
      expect(result.canonicalGraph, name).not.toBeNull();
      expect(result.graphHash, name).toBe(corpus.runtimeGraphHashes[name]);
    }
  });

  test("compiler corpus binds the TypeScript invalid-execution gate metadata", () => {
    expect(corpus.invalidExecutionGate.typescript).toEqual({
      surface: "runGraph(document, input, options)",
      expectStatus: "failed",
      expectNodeCount: 0,
      expectExecutorCalls: 0,
    });
  });

  test.each([
    {
      code: "GE1404_ROUTE_NOT_ALLOWED",
      graph: diagnosticOrderGraph("global-ge1404-order", ["allowed"], [
        { id: "z-not-allowed", from: { node: "route-z" }, to: { node: "target-z" }, condition: condition("other") },
        { id: "a-not-allowed", from: { node: "route-a" }, to: { node: "target-a" }, condition: condition("other") },
        { id: "z-reach-alt", from: { node: "route-z" }, to: { node: "target-z-alt" } },
        { id: "a-reach-alt", from: { node: "route-a" }, to: { node: "target-a-alt" } },
      ]),
      edgeIds: ["z-not-allowed", "a-not-allowed"],
    },
    {
      code: "GE1405_DUPLICATE_ROUTE_CASE",
      graph: diagnosticOrderGraph("global-ge1405-order", ["same"], [
        { id: "a-case-seed", from: { node: "route-a" }, to: { node: "target-a" }, condition: condition("same") },
        { id: "z-case-seed", from: { node: "route-z" }, to: { node: "target-z" }, condition: condition("same") },
        { id: "z-case-duplicate", from: { node: "route-z" }, to: { node: "target-z-alt" }, condition: condition("same") },
        { id: "a-case-duplicate", from: { node: "route-a" }, to: { node: "target-a-alt" }, condition: condition("same") },
      ]),
      edgeIds: ["z-case-duplicate", "a-case-duplicate"],
    },
    {
      code: "GE1406_DUPLICATE_ROUTE_TARGET",
      graph: diagnosticOrderGraph("global-ge1406-order", ["first", "second"], [
        { id: "a-target-seed", from: { node: "route-a" }, to: { node: "target-a" }, condition: condition("first") },
        { id: "z-target-seed", from: { node: "route-z" }, to: { node: "target-z" }, condition: condition("first") },
        { id: "z-target-duplicate", from: { node: "route-z" }, to: { node: "target-z" }, condition: condition("second") },
        { id: "a-target-duplicate", from: { node: "route-a" }, to: { node: "target-a" }, condition: condition("second") },
        { id: "z-reach-alt", from: { node: "route-z" }, to: { node: "target-z-alt" } },
        { id: "a-reach-alt", from: { node: "route-a" }, to: { node: "target-a-alt" } },
      ]),
      edgeIds: ["z-target-duplicate", "a-target-duplicate"],
    },
  ])("$code diagnostics retain global edge declaration order", ({ code, graph, edgeIds }) => {
    const diagnostics = compileGraph(graph).diagnostics.filter((item) => item.code === code);
    expect(diagnostics.map((item) => item.edgeId)).toEqual(edgeIds);
    expect(diagnostics.map((item) => item.path)).toEqual(
      edgeIds.map((edgeId) => {
        const edgeIndex = graph.edges.findIndex((edge) => edge.id === edgeId);
        return code === "GE1406_DUPLICATE_ROUTE_TARGET"
          ? `#/edges/${edgeIndex}/to/node`
          : `#/edges/${edgeIndex}/condition/routeKey`;
      }),
    );
  });

  test.each([null, 1])("Graph envelope owns non-object condition %j", (condition) => {
    const document = JSON.parse(JSON.stringify(corpus.compilerCases[0]?.graph)) as GraphSpec;
    (document.edges[0] as { condition?: unknown }).condition = condition;
    expect(compileGraph(document).diagnostics.map((item) => item.code))
      .toEqual(["GE1007_INVALID_GRAPH"]);
  });

  test("Graph capture owns hostile router config before GE1401", () => {
    const document = JSON.parse(JSON.stringify(corpus.compilerCases[0]?.graph)) as GraphSpec;
    let invoked = false;
    const config = {};
    Object.defineProperty(config, "kind", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "single";
      },
    });
    (document.nodes[0] as { config: unknown }).config = config;
    expect(compileGraph(document).diagnostics.map((item) => item.code))
      .toEqual(["GE1007_INVALID_GRAPH"]);
    expect(invoked).toBe(false);
  });

  test("Graph capture owns sparse route arrays before GE1401", () => {
    const document = JSON.parse(JSON.stringify(corpus.compilerCases[0]?.graph)) as GraphSpec;
    const allowedRoutes = new Array<string>(2);
    allowedRoutes[1] = "quick";
    (document.nodes[0] as { config: unknown }).config = { kind: "single", allowedRoutes };
    expect(compileGraph(document).diagnostics.map((item) => item.code))
      .toEqual(["GE1007_INVALID_GRAPH"]);
  });

  test("Graph capture owns non-portable policy numbers before GE1401", () => {
    const document = JSON.parse(JSON.stringify(corpus.compilerCases[1]?.graph)) as GraphSpec;
    (document.nodes[0]?.config as { maxMulticast: number }).maxMulticast = Number.MAX_SAFE_INTEGER + 1;
    expect(compileGraph(document).diagnostics.map((item) => item.code))
      .toEqual(["GE1007_INVALID_GRAPH"]);
  });

  test("Graph capture owns throwing condition proxies before GE1402", () => {
    const document = JSON.parse(JSON.stringify(corpus.compilerCases[0]?.graph)) as GraphSpec;
    (document.edges[0] as { condition?: unknown }).condition = new Proxy({}, {
      ownKeys: () => {
        throw new Error("must remain a capture error");
      },
    });
    expect(compileGraph(document).diagnostics.map((item) => item.code))
      .toEqual(["GE1007_INVALID_GRAPH"]);
  });
});
