import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileGraph } from "@graph-engineering/core";
import { loopUntilDry } from "../src/index.js";
import { expectPatternError, metadata, node } from "./fixtures.js";

function round(key: string, suffix: string) {
  return {
    key,
    find: node(`find-${suffix}`, "agent"),
    checkDry: node(`check-${suffix}`, "validator"),
  };
}

function options() {
  return {
    metadata: metadata("loop-test"),
    maxRounds: 3,
    rounds: [round("round1", "1"), round("round2", "2"), round("round3", "3")],
    finalize: node("finalize", "barrier"),
  };
}

test("loopUntilDry compiles a one-round static expansion", () => {
  const graph = loopUntilDry({
    metadata: metadata("one-round"),
    maxRounds: 1,
    rounds: [round("round1", "1")],
    finalize: node("finalize", "barrier"),
  });
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.deepEqual(compilation.topologicalLayers, [
    ["find-1"],
    ["check-1"],
    ["finalize"],
  ]);
  assert.equal(graph.edges.length, 2);
  assert.deepEqual(graph.entrypoints, ["find-1"]);
});

test("loopUntilDry statically unrolls all rounds without a cycle", () => {
  const graph = loopUntilDry(options());
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.ok(compilation.diagnostics.every((item) => item.code !== "GE1005_CYCLE"));
  assert.deepEqual(compilation.topologicalLayers, [
    ["find-1"],
    ["check-1"],
    ["find-2"],
    ["check-2"],
    ["find-3"],
    ["check-3"],
    ["finalize"],
  ]);
  assert.equal(graph.edges.length, 8);
});

test("loopUntilDry gives finalize every round verdict on a unique port", () => {
  const graph = loopUntilDry(options());
  const verdicts = graph.edges.filter((edge) => edge.to.node === "finalize");
  assert.deepEqual(verdicts.map((edge) => edge.to.port), ["round1", "round2", "round3"]);
  assert.equal(new Set(verdicts.map((edge) => edge.to.port)).size, 3);
});

test("loopUntilDry uses deterministic non-duplicating per-node input ports", () => {
  const graph = loopUntilDry(options());
  for (const check of ["check-1", "check-2", "check-3"]) {
    assert.deepEqual(
      graph.edges.filter((edge) => edge.to.node === check).map((edge) => edge.to.port),
      ["items"],
    );
  }
  for (const finder of ["find-2", "find-3"]) {
    assert.deepEqual(
      graph.edges.filter((edge) => edge.to.node === finder).map((edge) => edge.to.port),
      ["previousVerdict"],
    );
  }
});

test("loopUntilDry owns a fixed versioned LoopContinue annotation", () => {
  const graph = loopUntilDry(options());
  const continuations = graph.edges.filter((edge) => edge.condition?.kind === "LoopContinue");
  assert.deepEqual(continuations.map((edge) => edge.condition), [
    {
      apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
      kind: "LoopContinue",
      maxRounds: 3,
      round: 1,
      roundKey: "round1",
    },
    {
      apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
      kind: "LoopContinue",
      maxRounds: 3,
      round: 2,
      roundKey: "round2",
    },
  ]);
});

test("loopUntilDry distinguishes dry verdicts from the static bound verdict", () => {
  const graph = loopUntilDry(options());
  assert.deepEqual(
    graph.edges.filter((edge) => edge.to.node === "finalize").map((edge) => edge.condition?.kind),
    ["LoopDryVerdict", "LoopDryVerdict", "LoopVerdictAtBound"],
  );
});

test("loopUntilDry preserves explicit round order rather than sorting it", () => {
  const graph = loopUntilDry({
    metadata: metadata("round-order"),
    maxRounds: 2,
    rounds: [round("zeta", "z"), round("alpha", "a")],
    finalize: node("finalize"),
  });
  assert.deepEqual(graph.nodes.map((item) => item.id), [
    "find-z",
    "check-z",
    "find-a",
    "check-a",
    "finalize",
  ]);
  assert.deepEqual(
    graph.edges.filter((edge) => edge.to.node === "finalize").map((edge) => edge.to.port),
    ["zeta", "alpha"],
  );
});

test("loopUntilDry is deterministic across repeated construction", () => {
  const first = loopUntilDry(options());
  const second = loopUntilDry(options());
  assert.deepEqual(first, second);
  assert.equal(canonicalHash(first), canonicalHash(second));
});

for (const invalid of [0, -1, 1.5, 101] as const) {
  test(`loopUntilDry rejects maxRounds ${invalid}`, () => {
    expectPatternError(
      () => loopUntilDry({ ...options(), maxRounds: invalid }),
      "GE_PATTERN_INVALID_MAX_ROUNDS",
      "#/maxRounds",
    );
  });
}

test("loopUntilDry rejects a missing maxRounds", () => {
  const { maxRounds: _removed, ...value } = options();
  expectPatternError(
    () => loopUntilDry(value as never),
    "GE_PATTERN_INVALID_MAX_ROUNDS",
    "#/maxRounds",
  );
});

test("loopUntilDry rejects fewer explicit rounds than maxRounds", () => {
  const value = options();
  value.rounds.pop();
  expectPatternError(
    () => loopUntilDry(value),
    "GE_PATTERN_ROUND_COUNT_MISMATCH",
    "#/rounds",
  );
});

test("loopUntilDry rejects more explicit rounds than maxRounds", () => {
  const value = options();
  value.maxRounds = 2;
  expectPatternError(
    () => loopUntilDry(value),
    "GE_PATTERN_ROUND_COUNT_MISMATCH",
    "#/rounds",
  );
});

test("loopUntilDry rejects an empty round set", () => {
  expectPatternError(
    () => loopUntilDry({ ...options(), maxRounds: 1, rounds: [] }),
    "GE_PATTERN_EMPTY_COLLECTION",
    "#/rounds",
  );
});

test("loopUntilDry rejects duplicate round keys to protect finalize bindings", () => {
  const value = options();
  value.rounds[1] = { ...value.rounds[1]!, key: "round1" };
  expectPatternError(() => loopUntilDry(value), "GE_PATTERN_DUPLICATE_KEY", "#/rounds/1/key");
});

test("loopUntilDry rejects duplicate caller node IDs across rounds", () => {
  const value = options();
  value.rounds[1] = { ...value.rounds[1]!, find: node("check-1") };
  expectPatternError(() => loopUntilDry(value), "GE_PATTERN_DUPLICATE_NODE_ID");
});

test("loopUntilDry rejects a finalize ID collision", () => {
  expectPatternError(
    () => loopUntilDry({ ...options(), finalize: node("find-1") }),
    "GE_PATTERN_DUPLICATE_NODE_ID",
    "#/finalize/id",
  );
});

test("loopUntilDry rejects caller condition injection in a round", () => {
  const value = options();
  const first = { ...value.rounds[0], condition: { kind: "CallerCondition" } };
  expectPatternError(
    () => loopUntilDry({ ...value, rounds: [first, ...value.rounds.slice(1)] } as never),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/rounds/0/condition",
  );
});

test("loopUntilDry never weakens a maxDepth policy", () => {
  expectPatternError(
    () => loopUntilDry({ ...options(), policies: { maxDepth: 6 } }),
    "GE_PATTERN_CORE_REJECTED",
    "#",
  );
});

test("loopUntilDry marks its required unsupported scheduler capability", () => {
  const graph = loopUntilDry(options());
  assert.equal(
    graph.metadata.labels?.["graphengineering.reacher-z.github.io/runtime-capability"],
    "edge-condition-routing-and-early-stop/v1alpha1",
  );
  assert.equal(
    graph.metadata.labels?.["graphengineering.reacher-z.github.io/pattern"],
    "loop-until-dry/v1alpha1",
  );
});

test("loopUntilDry accepts the hard maximum of 100 explicit rounds", () => {
  const rounds = Array.from({ length: 100 }, (_, index) => round(`round${index + 1}`, String(index + 1)));
  const graph = loopUntilDry({
    metadata: metadata("hundred-rounds"),
    maxRounds: 100,
    rounds,
    finalize: node("finalize"),
  });
  assert.equal(compileGraph(graph).valid, true);
  assert.equal(graph.nodes.length, 201);
  assert.equal(graph.edges.length, 299);
});
