import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canonicalHash,
  compileGraph,
  type DiagnosticCode,
  type GraphSpec,
  type NodeSpec,
} from "../src/index.js";

function fixture(name: string): GraphSpec {
  const path = fileURLToPath(new URL(`../../../spec/conformance/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as GraphSpec;
}

function codes(graph: GraphSpec): DiagnosticCode[] {
  return [...new Set(compileGraph(graph).diagnostics.map((item) => item.code))];
}

function node(id: string, overrides: Partial<NodeSpec> = {}): NodeSpec {
  return { id, kind: "transform", inputSchema: {}, outputSchema: {}, config: {}, ...overrides };
}

function graph(overrides: Partial<GraphSpec> = {}): GraphSpec {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "test-graph", version: "1" },
    inputSchema: {},
    outputSchema: {},
    entrypoints: ["a"],
    outputs: { result: { node: "a" } },
    nodes: [node("a")],
    edges: [],
    ...overrides,
  };
}

describe("graph compiler conformance", () => {
  it("compiles the diamond into stable topological layers", () => {
    const result = compileGraph(fixture("diamond.graph.json"));
    expect(result.valid).toBe(true);
    expect(result.topologicalLayers).toEqual([["split"], ["left", "right"], ["merge"]]);
    expect(result.graphHash).toBe("24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288");
  });

  it.each([
    ["invalid-duplicate-node.graph.json", "GE1001_DUPLICATE_NODE"],
    ["invalid-missing-endpoint.graph.json", "GE1004_MISSING_TARGET"],
    ["invalid-cycle.graph.json", "GE1005_CYCLE"],
    ["invalid-unreachable.graph.json", "GE1006_UNREACHABLE_NODE"],
  ] as const)("rejects %s with %s", (name, code) => {
    const result = compileGraph(fixture(name));
    expect(result.valid).toBe(false);
    expect(codes(fixture(name))).toEqual([code]);
  });

  it("rejects an entrypoint with incoming edges before reporting its unreachable root", () => {
    const result = compileGraph(fixture("invalid-entrypoint-incoming.graph.json"));
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "GE1010_ENTRYPOINT_HAS_INCOMING",
      "GE1006_UNREACHABLE_NODE",
    ]);
  });

  it("reports malformed envelopes with the stable invalid-graph code", () => {
    const malformed = { ...fixture("diamond.graph.json"), unexpected: true };
    const result = compileGraph(malformed);
    expect(result.graphHash).toBeNull();
    expect(result.topologicalLayers).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "GE1007_INVALID_GRAPH", message: expect.stringContaining("unknown property") }),
    ]);
  });

  it("validates bounded retry and policy fields at the IR boundary", () => {
    const invalid = graph({
      nodes: [node("a", { retry: { maxAttempts: 0 } })],
      policies: { maxConcurrency: 0 },
    });
    const result = compileGraph(invalid);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1007_INVALID_GRAPH",
        message: expect.stringMatching(/maxAttempts.*maxConcurrency/),
      }),
    ]);
  });

  it("orders ready peers by semantic node declaration order", () => {
    const result = compileGraph(
      graph({
        entrypoints: ["root"],
        outputs: { result: { node: "z" } },
        nodes: [node("z"), node("root"), node("a")],
        edges: [
          { id: "to-z", from: { node: "root" }, to: { node: "z" } },
          { id: "to-a", from: { node: "root" }, to: { node: "a" } },
        ],
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.topologicalLayers).toEqual([["root"], ["z", "a"]]);
  });

  it("allows independent roots only when each is an explicit entrypoint", () => {
    const disconnected = graph({
      entrypoints: ["a", "b"],
      outputs: { first: { node: "a" }, second: { node: "b" } },
      nodes: [node("b"), node("a")],
    });
    expect(compileGraph(disconnected).valid).toBe(true);

    expect(
      codes({ ...disconnected, entrypoints: ["a"] }),
    ).toContain("GE1006_UNREACHABLE_NODE");
  });

  it("diagnoses structural errors without cascading topology errors", () => {
    const result = compileGraph(
      graph({
        entrypoints: ["missing-entry"],
        outputs: { result: { node: "missing-output" } },
        edges: [
          { id: "duplicate", from: { node: "missing-source" }, to: { node: "a" } },
          { id: "duplicate", from: { node: "a" }, to: { node: "a" } },
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "GE1002_DUPLICATE_EDGE",
        "GE1003_MISSING_SOURCE",
        "GE1008_MISSING_ENTRYPOINT",
        "GE1009_MISSING_OUTPUT",
      ]),
    );
  });

  it("enforces max fan-out and max depth", () => {
    const result = compileGraph(
      graph({
        entrypoints: ["a"],
        outputs: { result: { node: "c" } },
        nodes: [node("a"), node("b"), node("c")],
        edges: [
          { id: "a-b", from: { node: "a" }, to: { node: "b" } },
          { id: "a-c", from: { node: "a" }, to: { node: "c" } },
          { id: "b-c", from: { node: "b" }, to: { node: "c" } },
        ],
        policies: { maxFanOut: 1, maxDepth: 2 },
      }),
    );
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["GE1101_MAX_FAN_OUT", "GE1102_MAX_DEPTH"]),
    );
  });

  it("never invokes a Graph IR accessor and returns a stable invalid diagnostic", () => {
    let calls = 0;
    const document = graph();
    Object.defineProperty(document.nodes[0], "config", {
      enumerable: true,
      get() {
        calls += 1;
        return { nonce: calls };
      },
    });

    expect(() => compileGraph(document)).not.toThrow();
    const result = compileGraph(document);
    expect(calls).toBe(0);
    expect(result).toMatchObject({
      valid: false,
      graphHash: null,
      canonicalGraph: null,
      entrypoints: [],
      topologicalLayers: [],
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1007_INVALID_GRAPH",
        message: "Accessor properties are not supported at #/nodes/0/config",
      }),
    ]);
  });

  it("rejects hostile Graph IR proxies without executing traps or leaking causes", () => {
    let trapCalls = 0;
    const document = new Proxy(graph(), {
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("TOP_SECRET_PROXY_CAUSE");
      },
      ownKeys() {
        trapCalls += 1;
        throw new Error("TOP_SECRET_PROXY_CAUSE");
      },
    });

    const result = compileGraph(document);
    expect(trapCalls).toBe(0);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1007_INVALID_GRAPH",
        message: "Proxy values are not supported at #",
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("TOP_SECRET_PROXY_CAUSE");
  });

  it("derives canonicalGraph and graphHash from one detached snapshot", () => {
    const shared = { revision: 1 };
    const document = graph({
      nodes: [node("a", { config: shared }), node("b", { config: shared })],
      outputs: { result: { node: "b" } },
      edges: [{ id: "a-b", from: { node: "a" }, to: { node: "b" } }],
    });

    const result = compileGraph(document);
    shared.revision = 2;
    expect(result.valid).toBe(true);
    expect(result.canonicalGraph).not.toBeNull();
    expect(result.graphHash).toBe(canonicalHash(JSON.parse(result.canonicalGraph as string)));
    const serialized = JSON.parse(result.canonicalGraph as string) as GraphSpec;
    expect(serialized.nodes.map((item) => item.config)).toEqual([
      { revision: 1 },
      { revision: 1 },
    ]);
  });

  it.each([
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["undefined", undefined],
    ["function", () => true],
    ["bigint", 1n],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("turns nested non-portable %s into GE1007 without throwing", (_name, value) => {
    const document = graph({ nodes: [node("a", { config: { value } })] });
    expect(() => compileGraph(document)).not.toThrow();
    const result = compileGraph(document);
    expect(result.valid).toBe(false);
    expect(result.graphHash).toBeNull();
    expect(result.canonicalGraph).toBeNull();
    expect(result.diagnostics.map((item) => item.code)).toEqual(["GE1007_INVALID_GRAPH"]);
  });

  it("turns cyclic and structurally non-portable nested data into GE1007", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    const sparse = new Array(2);
    sparse[1] = "present";

    const symbolic = { value: 1, [Symbol("hidden")]: true };

    const hidden = {};
    Object.defineProperty(hidden, "value", { value: 1, enumerable: false });

    const custom = Object.create({ inherited: true }) as Record<string, unknown>;
    custom.value = 1;

    for (const value of [cyclic, sparse, symbolic, hidden, custom]) {
      const document = graph({ nodes: [node("a", { config: value })] });
      expect(() => compileGraph(document)).not.toThrow();
      const result = compileGraph(document);
      expect(result.valid).toBe(false);
      expect(result.graphHash).toBeNull();
      expect(result.canonicalGraph).toBeNull();
      expect(result.diagnostics.map((item) => item.code)).toEqual(["GE1007_INVALID_GRAPH"]);
    }
  });

});
