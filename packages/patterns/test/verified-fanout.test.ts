import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileGraph } from "@graph-engineering/core";
import { verifiedFanout } from "../src/index.js";
import { expectPatternError, metadata, node } from "./fixtures.js";

function options() {
  return {
    metadata: metadata("verified-test"),
    work: node("work", "agent"),
    verifiers: [
      { key: "security", node: node("verify-security", "validator") },
      { key: "correctness", node: node("verify-correctness", "validator") },
      { key: "repro", node: node("verify-repro", "validator") },
    ],
    adjudicate: node("adjudicate", "barrier"),
  };
}

test("verifiedFanout compiles work, parallel lenses, and adjudication", () => {
  const graph = verifiedFanout(options());
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.deepEqual(compilation.topologicalLayers, [
    ["work"],
    ["verify-correctness", "verify-repro", "verify-security"],
    ["adjudicate"],
  ]);
  assert.deepEqual(graph.entrypoints, ["work"]);
  assert.deepEqual(graph.outputs, { result: { node: "adjudicate" } });
});

test("verifiedFanout sends every verdict to a unique lens port", () => {
  const graph = verifiedFanout(options());
  assert.deepEqual(
    graph.edges.filter((edge) => edge.to.node === "adjudicate").map((edge) => edge.to.port),
    ["correctness", "repro", "security"],
  );
});

test("verifiedFanout normalizes lens permutations", () => {
  const firstInput = options();
  const secondInput = options();
  secondInput.verifiers.reverse();
  const first = verifiedFanout(firstInput);
  const second = verifiedFanout(secondInput);
  assert.deepEqual(first, second);
  assert.equal(canonicalHash(first), canonicalHash(second));
});

test("verifiedFanout preserves caller verifier IDs", () => {
  const graph = verifiedFanout(options());
  assert.deepEqual(graph.nodes.map((item) => item.id), [
    "work",
    "verify-correctness",
    "verify-repro",
    "verify-security",
    "adjudicate",
  ]);
});

test("verifiedFanout rejects an empty verifier set", () => {
  expectPatternError(
    () => verifiedFanout({ ...options(), verifiers: [] }),
    "GE_PATTERN_EMPTY_COLLECTION",
    "#/verifiers",
  );
});

test("verifiedFanout rejects duplicate lens keys", () => {
  const value = options();
  value.verifiers[1] = { key: "security", node: node("other", "validator") };
  expectPatternError(() => verifiedFanout(value), "GE_PATTERN_DUPLICATE_KEY");
});

test("verifiedFanout rejects duplicate verifier IDs", () => {
  const value = options();
  value.verifiers[1] = { key: "other", node: node("verify-security", "validator") };
  expectPatternError(() => verifiedFanout(value), "GE_PATTERN_DUPLICATE_NODE_ID");
});

test("verifiedFanout rejects a collision with adjudicate", () => {
  expectPatternError(
    () => verifiedFanout({ ...options(), adjudicate: node("work") }),
    "GE_PATTERN_DUPLICATE_NODE_ID",
    "#/adjudicate/id",
  );
});

test("verifiedFanout adds only DAG runtime capability metadata", () => {
  const graph = verifiedFanout(options());
  assert.equal(
    graph.metadata.labels?.["graphengineering.reacher-z.github.io/pattern"],
    "verified-fanout/v1alpha1",
  );
  assert.equal(
    graph.metadata.labels?.["graphengineering.reacher-z.github.io/runtime-capability"],
    "dag/v1alpha1",
  );
});

test("verifiedFanout rejects unsafe output keys", () => {
  expectPatternError(
    () => verifiedFanout({ ...options(), outputKey: "constructor" }),
    "GE_PATTERN_INVALID_IDENTIFIER",
    "#/outputKey",
  );
});
