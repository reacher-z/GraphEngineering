import { describe, expect, it } from "vitest";
import {
  CompiledIdentityCreationError,
  componentHash,
  createCompiledGraphIdentity,
  verifyCompiledGraphIdentity,
  type CompiledGraphIdentity,
  type GraphSpec,
} from "../src/index.js";

function graph(): GraphSpec {
  const stringSchema = { type: "string" };
  return {
    apiVersion: "graphengineering.reacher-z.github.io/v1alpha1",
    kind: "Graph",
    metadata: { name: "identity-vector", version: "1" },
    inputSchema: {
      type: "object",
      properties: { query: stringSchema },
      required: ["query"],
    },
    outputSchema: {
      type: "object",
      properties: { result: stringSchema },
      required: ["result"],
    },
    stateSchema: { type: "object" },
    entrypoints: ["z"],
    outputs: { result: { node: "a", port: "result" } },
    nodes: [
      {
        id: "z",
        kind: "transform",
        inputSchema: {
          type: "object",
          properties: { query: stringSchema },
          required: ["query"],
        },
        outputSchema: {
          type: "object",
          properties: { value: stringSchema },
          required: ["value"],
        },
        config: null,
      },
      {
        id: "a",
        kind: "transform",
        inputSchema: {
          type: "object",
          properties: { value: stringSchema },
          required: ["value"],
        },
        outputSchema: {
          type: "object",
          properties: { result: stringSchema },
          required: ["result"],
        },
        config: { mode: "copy" },
      },
    ],
    edges: [
      {
        id: "z-a",
        from: { node: "z", port: "value" },
        to: { node: "a", port: "value" },
        schema: stringSchema,
      },
    ],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const GOLDEN_IDENTITY: CompiledGraphIdentity = {
  apiVersion: "graphengineering.reacher-z.github.io/compiled-identity/v1alpha1",
  kind: "CompiledGraphIdentity",
  graphRevision: 1,
  graphHash: "a025079928d8fcd5bba9fc2746167a9398584daea3f04a3f571520e687169a1e",
  nodes: [
    {
      id: "z",
      index: 0,
      contentHash: "635b3a880bee57b3ae71aaea7c01cad6a888c52006e5a49346156b1535e73db5",
      inputSchemaHash: "b365ba49ab46e16750bb10198521429a8eee3868ff9e4552225a4e64404c907f",
      outputSchemaHash: "5199693181a1f7d677e8fb42f11940e02ece51d2eba955a6b445570d73d3902e",
    },
    {
      id: "a",
      index: 1,
      contentHash: "6b9421a557c8d2dca9c5bef272965cadc21af1253a8cba6be272274ec68d205f",
      inputSchemaHash: "5199693181a1f7d677e8fb42f11940e02ece51d2eba955a6b445570d73d3902e",
      outputSchemaHash: "a1ecd0eb4c1fdd16b91e3b8459d900be71df870e0a18410227f6e2ee0b803caf",
    },
  ],
  edges: [
    {
      id: "z-a",
      index: 0,
      contentHash: "6e54e3c63cabec8c288f0cb0ff924a7e6f50e6108b8b5aed7bc357471817cc36",
      schemaHash: "841e288a99d0fa98c5fc027654952f72fecc436b5ac0d202bd6c58241e355773",
    },
  ],
  graphSchemas: {
    input: "b365ba49ab46e16750bb10198521429a8eee3868ff9e4552225a4e64404c907f",
    output: "a1ecd0eb4c1fdd16b91e3b8459d900be71df870e0a18410227f6e2ee0b803caf",
    state: "c628a99a2c2801d7f6aa5a6ef5bc93c4e0d811147254b6667f44deb443319e2e",
  },
  revisionHash: "87907f37d71891e52191320f0fe937d3d17d4c4f0a60f377ea277f111eeaf444",
};

describe("revision-1 compiled component identity", () => {
  it("matches hard-coded domain-separated graph, component, schema, and revision vectors", () => {
    const identity = createCompiledGraphIdentity(graph());
    expect(identity).toEqual(GOLDEN_IDENTITY);
    expect(componentHash("node", graph().nodes[0])).toBe(
      "635b3a880bee57b3ae71aaea7c01cad6a888c52006e5a49346156b1535e73db5",
    );
    expect(componentHash("edge", graph().edges[0])).toBe(
      "6e54e3c63cabec8c288f0cb0ff924a7e6f50e6108b8b5aed7bc357471817cc36",
    );
    expect(componentHash("schema", { type: "string" })).toBe(
      "841e288a99d0fa98c5fc027654952f72fecc436b5ac0d202bd6c58241e355773",
    );
    expect(new Set([
      componentHash("node", { type: "string" }),
      componentHash("edge", { type: "string" }),
      componentHash("schema", { type: "string" }),
    ])).toHaveLength(3);
    expect(() => componentHash("invalid" as "node", {})).toThrowError(
      "Component identity kind must be 'node', 'edge', or 'schema'",
    );
  });

  it("returns a deeply frozen manifest bound to a detached graph snapshot", () => {
    const input = graph();
    const identity = createCompiledGraphIdentity(input);
    (input.nodes[1]?.config as { mode: string }).mode = "changed";
    expect(identity).toEqual(GOLDEN_IDENTITY);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Object.isFrozen(identity.nodes)).toBe(true);
    expect(Object.isFrozen(identity.nodes[0])).toBe(true);
    expect(Object.getPrototypeOf(identity)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(identity.nodes[0] as object)).toBe(Object.prototype);
    expect(() => {
      (identity.nodes[0] as { contentHash: string }).contentHash = "0".repeat(64);
    }).toThrow(TypeError);
  });

  it("keeps unrelated component hashes stable across metadata-only changes", () => {
    const before = createCompiledGraphIdentity(graph());
    const changed = graph();
    changed.metadata = { ...changed.metadata, description: "metadata-only" };
    const after = createCompiledGraphIdentity(changed);
    expect(after.graphHash).not.toBe(before.graphHash);
    expect(after.revisionHash).not.toBe(before.revisionHash);
    expect(after.nodes).toEqual(before.nodes);
    expect(after.edges).toEqual(before.edges);
    expect(after.graphSchemas).toEqual(before.graphSchemas);
  });

  it("changes the precise node/schema plus graph and revision identities for a schema edit", () => {
    const before = createCompiledGraphIdentity(graph());
    const changed = graph();
    changed.nodes = [
      {
        ...changed.nodes[0]!,
        outputSchema: {
          type: "object",
          properties: { value: { type: "string", minLength: 1 } },
          required: ["value"],
        },
      },
      changed.nodes[1]!,
    ];
    const after = createCompiledGraphIdentity(changed);
    expect(after.graphHash).not.toBe(before.graphHash);
    expect(after.revisionHash).not.toBe(before.revisionHash);
    expect(after.nodes[0]?.contentHash).not.toBe(before.nodes[0]?.contentHash);
    expect(after.nodes[0]?.outputSchemaHash).not.toBe(before.nodes[0]?.outputSchemaHash);
    expect(after.nodes[1]).toEqual(before.nodes[1]);
    expect(after.edges).toEqual(before.edges);
  });

  it("verifies an exact revision-1 manifest", () => {
    expect(verifyCompiledGraphIdentity(graph(), GOLDEN_IDENTITY)).toEqual({
      valid: true,
      diagnostics: [],
    });
  });

  it.each([0, 2, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsupported or unsafe graph revision %s with GE1301",
    (revision) => {
      const candidate = { ...clone(GOLDEN_IDENTITY), graphRevision: revision };
      expect(verifyCompiledGraphIdentity(graph(), candidate).diagnostics).toEqual([
        expect.objectContaining({
          code: "GE1301_UNSUPPORTED_GRAPH_REVISION",
          path: "#/graphRevision",
        }),
      ]);
    },
  );

  it("distinguishes graphHash mutation from component/order/revision mutation", () => {
    const graphHash = clone(GOLDEN_IDENTITY) as unknown as Record<string, unknown>;
    graphHash.graphHash = "0".repeat(64);
    expect(verifyCompiledGraphIdentity(graph(), graphHash).diagnostics).toEqual([
      expect.objectContaining({
        code: "GE1302_GRAPH_IDENTITY_MISMATCH",
        path: "#/graphHash",
      }),
    ]);

    const mutations: unknown[] = [];
    const nodeHash = clone(GOLDEN_IDENTITY);
    (nodeHash.nodes[0] as { contentHash: string }).contentHash = "0".repeat(64);
    mutations.push(nodeHash);
    const edgeOrder = clone(GOLDEN_IDENTITY);
    (edgeOrder.edges[0] as { index: number }).index = 1;
    mutations.push(edgeOrder);
    const schemaHash = clone(GOLDEN_IDENTITY);
    (schemaHash.graphSchemas as { input: string }).input = "0".repeat(64);
    mutations.push(schemaHash);
    const revisionHash = clone(GOLDEN_IDENTITY);
    revisionHash.revisionHash = "0".repeat(64);
    mutations.push(revisionHash);

    for (const candidate of mutations) {
      expect(verifyCompiledGraphIdentity(graph(), candidate).diagnostics).toEqual([
        expect.objectContaining({
          code: "GE1303_COMPONENT_IDENTITY_MISMATCH",
          path: "#",
        }),
      ]);
    }
  });

  it("rejects hostile identity proxies without executing traps or leaking causes", () => {
    let calls = 0;
    const candidate = new Proxy({}, {
      ownKeys() {
        calls += 1;
        throw new Error("SECRET_IDENTITY_CAUSE");
      },
    });
    const result = verifyCompiledGraphIdentity(graph(), candidate);
    expect(calls).toBe(0);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: "GE1303_COMPONENT_IDENTITY_MISMATCH" }),
    ]);
    expect(() => componentHash("schema", candidate)).toThrowError();
    expect(() => createCompiledGraphIdentity(candidate)).toThrowError(
      CompiledIdentityCreationError,
    );
    expect(JSON.stringify(result)).not.toContain("SECRET_IDENTITY_CAUSE");
    expect(calls).toBe(0);
  });

  it("does not manufacture an identity for an invalid graph", () => {
    const invalid = { ...graph(), graphRevision: 1 };
    let failure: unknown;
    try {
      createCompiledGraphIdentity(invalid);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CompiledIdentityCreationError);
    expect((failure as CompiledIdentityCreationError).diagnostics).toEqual([
      expect.objectContaining({ code: "GE1007_INVALID_GRAPH" }),
    ]);
    expect(Object.isFrozen((failure as CompiledIdentityCreationError).diagnostics)).toBe(true);
    expect(Object.getPrototypeOf(
      (failure as CompiledIdentityCreationError).diagnostics[0] as object,
    )).toBe(Object.prototype);
    const nodeIds = (failure as CompiledIdentityCreationError).diagnostics[0]?.nodeIds;
    if (nodeIds !== undefined) expect(Object.isFrozen(nodeIds)).toBe(true);
  });
});
