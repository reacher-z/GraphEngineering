import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileGraph } from "@graph-engineering/core";
import { diamond } from "../src/index.js";
import { expectPatternError, metadata, node } from "./fixtures.js";

function options() {
  return {
    metadata: metadata("diamond-test"),
    split: node("split"),
    workers: [
      { key: "docs", node: node("docs") },
      { key: "code", node: node("code") },
    ],
    merge: node("merge", "barrier"),
  };
}

test("diamond compiles into split, parallel workers, and merge layers", () => {
  const graph = diamond(options());
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.deepEqual(compilation.topologicalLayers, [["split"], ["code", "docs"], ["merge"]]);
  assert.deepEqual(graph.entrypoints, ["split"]);
  assert.deepEqual(graph.outputs, { result: { node: "merge" } });
});

test("diamond worker-to-merge edges use unique keyed ports", () => {
  const graph = diamond(options());
  const incoming = graph.edges.filter((edge) => edge.to.node === "merge");
  assert.deepEqual(incoming.map((edge) => edge.to.port), ["code", "docs"]);
  assert.ok(incoming.every((edge) => edge.mode === "value"));
});

test("diamond edge IDs are fixed and never interpolate caller IDs", () => {
  const graph = diamond(options());
  assert.deepEqual(graph.edges.map((edge) => edge.id), [
    "ge-diamond-0001",
    "ge-diamond-0002",
    "ge-diamond-0003",
    "ge-diamond-0004",
  ]);
  assert.ok(graph.edges.every((edge) => !edge.id.includes("split")));
});

test("diamond normalizes worker permutations by key", () => {
  const first = options();
  const second = options();
  second.workers.reverse();
  const left = diamond(first);
  const right = diamond(second);
  assert.deepEqual(left, right);
  assert.equal(canonicalHash(left), canonicalHash(right));
});

test("diamond preserves every caller node ID exactly", () => {
  const graph = diamond({
    metadata: metadata("caller-ids"),
    split: node("Caller.Split"),
    workers: [{ key: "worker", node: node("Caller_Worker-1") }],
    merge: node("Caller.Merge"),
  });
  assert.deepEqual(graph.nodes.map((item) => item.id), [
    "Caller.Split",
    "Caller_Worker-1",
    "Caller.Merge",
  ]);
});

test("diamond rejects an empty worker set", () => {
  const value = { ...options(), workers: [] };
  expectPatternError(() => diamond(value), "GE_PATTERN_EMPTY_COLLECTION", "#/workers");
});

test("diamond rejects duplicate worker keys", () => {
  const value = options();
  value.workers[1] = { key: "docs", node: node("other") };
  expectPatternError(() => diamond(value), "GE_PATTERN_DUPLICATE_KEY");
});

test("diamond rejects duplicate caller node IDs across roles", () => {
  const value = { ...options(), merge: node("code") };
  expectPatternError(() => diamond(value), "GE_PATTERN_DUPLICATE_NODE_ID", "#/merge/id");
});

test("diamond rejects unsafe worker keys", () => {
  const value = { ...options(), workers: [{ key: "not a key", node: node("worker") }] };
  expectPatternError(() => diamond(value), "GE_PATTERN_INVALID_IDENTIFIER", "#/workers/0/key");
});

test("diamond rejects an empty worker key", () => {
  const value = { ...options(), workers: [{ key: "", node: node("worker") }] };
  expectPatternError(() => diamond(value), "GE_PATTERN_INVALID_IDENTIFIER", "#/workers/0/key");
});

test("diamond accepts the 64-character key boundary", () => {
  const key = `k${"a".repeat(63)}`;
  const graph = diamond({ ...options(), workers: [{ key, node: node("worker") }] });
  assert.equal(graph.edges.find((edge) => edge.to.node === "merge")?.to.port, key);
});

test("diamond rejects keys longer than 64 characters", () => {
  const key = `k${"a".repeat(64)}`;
  expectPatternError(
    () => diamond({ ...options(), workers: [{ key, node: node("worker") }] }),
    "GE_PATTERN_INVALID_IDENTIFIER",
  );
});

test("diamond rejects invalid caller node IDs instead of rewriting them", () => {
  const value = { ...options(), split: node("bad id") };
  expectPatternError(() => diamond(value), "GE_PATTERN_INVALID_IDENTIFIER", "#/split/id");
});

test("diamond accepts the 128-character node ID boundary", () => {
  const id = `N${"a".repeat(127)}`;
  const graph = diamond({ ...options(), split: node(id) });
  assert.equal(graph.entrypoints[0], id);
});

test("diamond rejects node IDs longer than 128 characters", () => {
  const id = `N${"a".repeat(128)}`;
  expectPatternError(
    () => diamond({ ...options(), split: node(id) }),
    "GE_PATTERN_INVALID_IDENTIFIER",
    "#/split/id",
  );
});

test("diamond preserves custom schemas, output key, and satisfiable policies", () => {
  const graph = diamond({
    ...options(),
    inputSchema: { type: "object", required: ["topic"] },
    outputSchema: { type: "string" },
    stateSchema: { type: "object", properties: { seen: { type: "array" } } },
    outputKey: "report",
    policies: { maxConcurrency: 2, maxFanOut: 2, maxDepth: 3 },
  });
  assert.deepEqual(graph.inputSchema, { required: ["topic"], type: "object" });
  assert.deepEqual(graph.outputSchema, { type: "string" });
  assert.ok(graph.stateSchema !== undefined);
  assert.deepEqual(graph.outputs, { report: { node: "merge" } });
  assert.deepEqual(graph.policies, { maxConcurrency: 2, maxDepth: 3, maxFanOut: 2 });
});

test("diamond rejects more than 100 workers", () => {
  const workers = Array.from({ length: 101 }, (_, index) => ({
    key: `k${index}`,
    node: node(`n${index}`),
  }));
  expectPatternError(
    () => diamond({ ...options(), workers }),
    "GE_PATTERN_TOO_MANY_ITEMS",
    "#/workers",
  );
});

test("diamond accepts the hard maximum of 100 workers", () => {
  const workers = Array.from({ length: 100 }, (_, index) => ({
    key: `k${index}`,
    node: node(`n${index}`),
  }));
  const graph = diamond({ ...options(), workers });
  assert.equal(compileGraph(graph).valid, true);
  assert.equal(graph.nodes.length, 102);
  assert.equal(graph.edges.length, 200);
});

test("diamond rejects unknown options instead of silently ignoring them", () => {
  const value = { ...options(), surprise: true };
  expectPatternError(
    () => diamond(value as never),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/surprise",
  );
});

test("diamond never weakens caller policies rejected by core", () => {
  expectPatternError(
    () => diamond({ ...options(), policies: { maxFanOut: 1 } }),
    "GE_PATTERN_CORE_REJECTED",
    "#",
  );
});
