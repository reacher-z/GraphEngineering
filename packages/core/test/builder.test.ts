import { describe, expect, it } from "vitest";
import {
  GraphBuilderError,
  canonicalSerialize,
  compileGraph,
  graphBuilder,
  type GraphSpec,
  type NodeSpec,
} from "../src/index.js";

function node(id: string, config: unknown = {}): NodeSpec {
  return {
    id,
    kind: "transform",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    config,
  };
}

function builder() {
  return graphBuilder({
    metadata: { name: "builder-test", version: "1" },
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  });
}

function errorCode(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(GraphBuilderError);
    return (error as GraphBuilderError).code;
  }
}

describe("general graph builder", () => {
  it("builds arbitrary Graph IR without inferring IDs, roots, outputs, or declaration order", () => {
    const built = builder()
      .addNode(node("z"))
      .addNode(node("a"))
      .addEdge({ id: "z-a", from: { node: "z" }, to: { node: "a" } })
      .addEntrypoint("z")
      .addOutput("result", { node: "a" })
      .build();

    expect(built.graph.nodes.map((item) => item.id)).toEqual(["z", "a"]);
    expect(built.graph.edges.map((item) => item.id)).toEqual(["z-a"]);
    expect(built.graph.entrypoints).toEqual(["z"]);
    expect(built.canonicalGraph).toBe(canonicalSerialize(built.graph));
    expect(compileGraph(built.graph).graphHash).toBe(built.graphHash);
    expect(built.identity.graphHash).toBe(built.graphHash);
    expect(built.identity.graphRevision).toBe(1);
  });

  it("snapshots every call immediately and deeply freezes the completed graph", () => {
    const metadata = { name: "builder-test", version: "1", labels: { team: "before" } };
    const config = { nested: { revision: 1 } };
    const endpoint = { node: "a", port: "result" };
    const outputSchema = {
      type: "object",
      properties: { result: { type: "string" } },
      required: ["result"],
    };
    const author = graphBuilder({ metadata, inputSchema: {}, outputSchema })
      .addNode(node("a", config))
      .addEntrypoint("a")
      .addOutput("result", endpoint);
    metadata.labels.team = "after";
    config.nested.revision = 2;
    endpoint.node = "missing";
    outputSchema.properties.result.type = "number";

    const built = author.build();
    expect(built.graph.metadata.labels).toEqual({ team: "before" });
    expect(built.graph.nodes[0]?.config).toEqual({ nested: { revision: 1 } });
    expect(built.graph.outputs.result).toEqual({ node: "a", port: "result" });
    expect(built.graph.outputSchema).toEqual({
      type: "object",
      properties: { result: { type: "string" } },
      required: ["result"],
    });
    expect(Object.isFrozen(built.graph)).toBe(true);
    expect(Object.isFrozen(built.graph.nodes)).toBe(true);
    expect(Object.isFrozen((built.graph.nodes[0]?.config as { nested: object }).nested)).toBe(true);
    expect(Object.getPrototypeOf(built.graph)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(built.graph.nodes[0] as object)).toBe(Object.prototype);
    expect(() => {
      (built.graph.nodes[0]?.config as { nested: { revision: number } }).nested.revision = 9;
    }).toThrow(TypeError);
    expect(canonicalSerialize(built.graph)).toBe(built.canonicalGraph);
  });

  it.each([
    ["node", () => builder().addNode(node("a")).addNode(node("a")), "GE_BUILDER_DUPLICATE_NODE"],
    [
      "edge",
      () => builder()
        .addEdge({ id: "same", from: { node: "a" }, to: { node: "b" } })
        .addEdge({ id: "same", from: { node: "a" }, to: { node: "b" } }),
      "GE_BUILDER_DUPLICATE_EDGE",
    ],
    [
      "entrypoint",
      () => builder().addEntrypoint("a").addEntrypoint("a"),
      "GE_BUILDER_DUPLICATE_ENTRYPOINT",
    ],
    [
      "output",
      () => builder().addOutput("result", { node: "a" }).addOutput("result", { node: "b" }),
      "GE_BUILDER_DUPLICATE_OUTPUT",
    ],
  ] as const)("rejects a duplicate %s before it can overwrite state", (_name, operation, code) => {
    expect(errorCode(operation)).toBe(code);
  });

  it("requires explicit entrypoints and outputs and seals on the first build attempt", () => {
    const noRoot = builder().addNode(node("a")).addOutput("result", { node: "a" });
    expect(errorCode(() => noRoot.build())).toBe("GE_BUILDER_MISSING_REQUIRED");
    expect(errorCode(() => noRoot.addEntrypoint("a"))).toBe("GE_BUILDER_SEALED");

    const noOutput = builder().addNode(node("a")).addEntrypoint("a");
    expect(errorCode(() => noOutput.build())).toBe("GE_BUILDER_MISSING_REQUIRED");
    expect(errorCode(() => noOutput.build())).toBe("GE_BUILDER_SEALED");
  });

  it("preserves required config null and unknown policy-extension null", () => {
    const built = graphBuilder({
      metadata: { name: "builder-test", version: "1" },
      inputSchema: {},
      outputSchema: {},
      policies: { "example.dev/extension": null },
    })
      .addNode(node("a", null))
      .addEntrypoint("a")
      .addOutput("result", { node: "a" })
      .build();

    expect(built.graph.nodes[0]?.config).toBeNull();
    expect(built.graph.policies?.["example.dev/extension"]).toBeNull();
  });

  it("retains reserved output names without prototype pollution", () => {
    const built = builder()
      .addNode(node("a"))
      .addEntrypoint("a")
      .addOutput("__proto__", { node: "a" })
      .addOutput("constructor", { node: "a" })
      .build();
    expect(Object.hasOwn(built.graph.outputs, "__proto__")).toBe(true);
    expect(built.graph.outputs.__proto__).toEqual({ node: "a" });
    expect(built.graph.outputs.constructor).toEqual({ node: "a" });
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("rejects getters and proxies without executing caller code or exposing its cause", () => {
    let calls = 0;
    const hostile = {} as Record<string, unknown>;
    Object.defineProperty(hostile, "id", {
      enumerable: true,
      get() {
        calls += 1;
        throw new Error("SECRET_GETTER_CAUSE");
      },
    });
    const proxy = new Proxy({}, {
      ownKeys() {
        calls += 1;
        throw new Error("SECRET_PROXY_CAUSE");
      },
    });

    for (const value of [hostile, proxy]) {
      let failure: unknown;
      try {
        builder().addNode(value);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(GraphBuilderError);
      expect((failure as GraphBuilderError).code).toBe("GE_BUILDER_INVALID_INPUT");
      expect(JSON.stringify(failure)).not.toMatch(/SECRET_/u);
    }

    const operations = [
      () => graphBuilder(proxy),
      () => graphBuilder({ metadata: proxy, inputSchema: {}, outputSchema: {} }),
      () => graphBuilder({
        metadata: { name: "builder-test", version: "1" },
        inputSchema: proxy,
        outputSchema: {},
      }),
      () => builder().addEdge(proxy),
      () => builder().addEntrypoint(proxy as unknown as string),
      () => builder().addOutput("result", proxy),
      () => builder().addOutput(proxy as unknown as string, { node: "a" }),
      () => builder().setPolicies(proxy),
    ];
    for (const operation of operations) {
      let failure: unknown;
      try {
        operation();
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(GraphBuilderError);
      expect((failure as GraphBuilderError).code).toBe("GE_BUILDER_INVALID_INPUT");
      expect(JSON.stringify(failure)).not.toMatch(/SECRET_/u);
    }
    expect(calls).toBe(0);
  });

  it.each([
    ["cycle", (() => { const value: Record<string, unknown> = {}; value.self = value; return value; })()],
    ["sparse array", (() => { const value = new Array(2); value[1] = true; return value; })()],
    ["class", new (class Custom { value = 1; })()],
    ["date", new Date(0)],
    ["bigint", 1n],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects non-portable %s input locally", (_name, config) => {
    expect(errorCode(() => builder().addNode(node("a", config)))).toBe(
      "GE_BUILDER_INVALID_INPUT",
    );
  });

  it("projects complete compiler diagnostics and never returns a partial graph", () => {
    const author = builder()
      .addNode(node("a"))
      .addEntrypoint("missing")
      .addOutput("result", { node: "also-missing" });
    let failure: GraphBuilderError | undefined;
    try {
      author.build();
    } catch (error) {
      failure = error as GraphBuilderError;
    }
    expect(failure).toBeInstanceOf(GraphBuilderError);
    expect(failure?.code).toBe("GE_BUILDER_CORE_REJECTED");
    expect(failure?.diagnostics.map((item) => item.code)).toEqual([
      "GE1008_MISSING_ENTRYPOINT",
      "GE1009_MISSING_OUTPUT",
    ]);
    expect(Object.getPrototypeOf(failure?.diagnostics[0] as object)).toBe(Object.prototype);
    expect(failure?.toJSON()).toEqual({
      code: "GE_BUILDER_CORE_REJECTED",
      message: "Core compiler rejected the constructed graph",
      path: "#",
      diagnostics: failure?.diagnostics,
    });
  });

  it("rejects a malformed node at the call that introduces it", () => {
    const invalidNode = { ...node("a"), retry: null } as unknown as NodeSpec;
    let failure: GraphBuilderError | undefined;
    try {
      builder().addNode(invalidNode);
    } catch (error) {
      failure = error as GraphBuilderError;
    }
    expect(failure?.code).toBe("GE_BUILDER_INVALID_INPUT");
    expect(failure?.path).toBe("#/nodes/0");
    expect(failure?.diagnostics).toEqual([]);
  });

  it("validates constructor fragments, edges, endpoints, and replacement policies immediately", () => {
    expect(errorCode(() => graphBuilder({
      metadata: { name: "Invalid_Name", version: "1" },
      inputSchema: {},
      outputSchema: {},
    }))).toBe("GE_BUILDER_INVALID_INPUT");
    expect(errorCode(() => builder().addNode({ id: "a" }))).toBe("GE_BUILDER_INVALID_INPUT");
    expect(errorCode(() => builder().addEdge({
      id: "bad edge",
      from: { node: "a" },
      to: { node: "b" },
    }))).toBe("GE_BUILDER_INVALID_INPUT");
    expect(errorCode(() => builder().addOutput("result", { node: "a", port: null }))).toBe(
      "GE_BUILDER_INVALID_INPUT",
    );
    expect(errorCode(() => builder().setPolicies({ maxDepth: 0 }))).toBe(
      "GE_BUILDER_INVALID_INPUT",
    );
  });

  it("enables strict typed ports only through the explicit fixed policy", () => {
    const stringSchema = { type: "string" };
    const graphInput = {
      type: "object",
      properties: { query: stringSchema },
      required: ["query"],
    };
    const graphOutput = {
      type: "object",
      properties: { result: stringSchema },
      required: ["result"],
    };
    const built = graphBuilder({
      metadata: { name: "typed-builder", version: "1" },
      inputSchema: graphInput,
      outputSchema: graphOutput,
    })
      .addNode({
        ...node("a"),
        inputSchema: graphInput,
        outputSchema: graphOutput,
      })
      .addEntrypoint("a")
      .addOutput("result", { node: "a", port: "result" })
      .enableStrictTypedPorts()
      .build();
    expect(built.graph.policies).toEqual({
      "graphengineering.reacher-z.github.io/typed-ports": {
        apiVersion: "graphengineering.reacher-z.github.io/typed-ports/v1alpha1",
        mode: "strict-exact",
      },
    });
    expect(compileGraph(built.graph).diagnostics).toEqual([]);

    const manuallyConfigured = graphBuilder({
      metadata: { name: "typed-builder", version: "1" },
      inputSchema: {},
      outputSchema: {},
      policies: {
        "graphengineering.reacher-z.github.io/typed-ports": {
          apiVersion: "wrong",
          mode: "strict-exact",
        },
      },
    });
    expect(errorCode(() => manuallyConfigured.enableStrictTypedPorts())).toBe(
      "GE_BUILDER_INVALID_INPUT",
    );
  });

  it("replaces the complete policy object through one detached setPolicies operation", () => {
    const replacement = { maxDepth: 2, "example.dev/reviewed": { enabled: true } };
    const author = graphBuilder({
      metadata: { name: "policy-builder", version: "1" },
      inputSchema: {},
      outputSchema: {},
      policies: { maxDepth: 99, maxConcurrency: 1 },
    })
      .setPolicies(replacement)
      .addNode(node("a"))
      .addEntrypoint("a")
      .addOutput("result", { node: "a" });
    replacement.maxDepth = 9;
    replacement["example.dev/reviewed"].enabled = false;
    const built = author.build();
    expect(built.graph.policies).toEqual({
      maxDepth: 2,
      "example.dev/reviewed": { enabled: true },
    });
    expect(built.graph.policies).not.toHaveProperty("maxConcurrency");
  });

  it("constructs a byte-identical GraphSpec when given every optional envelope field", () => {
    const expected: GraphSpec = {
      apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
      kind: "Graph",
      metadata: { name: "full-builder", version: "1", description: "full" },
      inputSchema: {},
      outputSchema: {},
      stateSchema: { type: "object" },
      entrypoints: ["a"],
      outputs: { result: { node: "a" } },
      nodes: [node("a")],
      edges: [],
      policies: { maxDepth: 3 },
    };
    const built = graphBuilder({
      metadata: expected.metadata,
      inputSchema: expected.inputSchema,
      outputSchema: expected.outputSchema,
      stateSchema: expected.stateSchema,
      policies: expected.policies,
    })
      .addNode(expected.nodes[0])
      .addEntrypoint("a")
      .addOutput("result", { node: "a" })
      .build();
    expect(built.canonicalGraph).toBe(canonicalSerialize(expected));
  });
});
