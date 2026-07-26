import assert from "node:assert/strict";
import test from "node:test";
import { compileGraph } from "@graph-engineering/core";
import { diamond } from "../src/index.js";
import { expectPatternError, metadata, node } from "./fixtures.js";

function options(config: unknown = {}) {
  return {
    metadata: metadata("invariant-test"),
    split: node("split", "transform", config),
    workers: [{ key: "worker", node: node("worker") }],
    merge: node("merge", "barrier"),
  };
}

function assertDeepFrozen(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  assert.equal(Object.isFrozen(value), true);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) assertDeepFrozen(descriptor.value);
  }
}

test("constructor output is recursively frozen", () => {
  const graph = diamond(options({ nested: { values: [1, 2, 3] } }));
  assertDeepFrozen(graph);
  assert.throws(() => {
    (graph.nodes[0] as { id: string }).id = "mutated";
  }, TypeError);
});

test("constructor output is detached from caller objects", () => {
  const config = { nested: { value: "before" } };
  const split = node("split", "transform", config);
  const value = { ...options(), split };
  const graph = diamond(value);
  config.nested.value = "after";
  split.id = "changed-by-caller";
  assert.equal(graph.nodes[0]?.id, "split");
  assert.deepEqual(graph.nodes[0]?.config, { nested: { value: "before" } });
});

test("caller metadata labels remain detached and preserved", () => {
  const labels = { owner: "team-a" };
  const value = options();
  value.metadata.labels = labels;
  const graph = diamond(value);
  labels.owner = "team-b";
  assert.equal(graph.metadata.labels?.owner, "team-a");
  assert.equal(
    graph.metadata.labels?.["graphengineering.reacher-z.github.io/pattern"],
    "diamond/v1alpha1",
  );
});

test("top-level getters are rejected without invocation", () => {
  let invocations = 0;
  const value: Record<string, unknown> = {};
  Object.defineProperty(value, "metadata", {
    enumerable: true,
    get() {
      invocations += 1;
      return metadata();
    },
  });
  expectPatternError(
    () => diamond(value as never),
    "GE_PATTERN_INVALID_INPUT",
    "#/metadata",
  );
  assert.equal(invocations, 0);
});

test("nested getters are rejected without invocation", () => {
  let invocations = 0;
  const config: Record<string, unknown> = {};
  Object.defineProperty(config, "secret", {
    enumerable: true,
    get() {
      invocations += 1;
      return "value";
    },
  });
  expectPatternError(
    () => diamond(options(config)),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config/secret",
  );
  assert.equal(invocations, 0);
});

test("setter-only descriptors are rejected", () => {
  const config: Record<string, unknown> = {};
  Object.defineProperty(config, "value", { enumerable: true, set() {} });
  expectPatternError(
    () => diamond(options(config)),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config/value",
  );
});

test("explicit undefined is rejected instead of silently omitted", () => {
  expectPatternError(
    () => diamond(options({ value: undefined })),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config/value",
  );
});

for (const [label, value] of [
  ["NaN", Number.NaN],
  ["positive infinity", Number.POSITIVE_INFINITY],
  ["negative infinity", Number.NEGATIVE_INFINITY],
] as const) {
  test(`${label} is rejected as non-portable JSON`, () => {
    expectPatternError(
      () => diamond(options({ value })),
      "GE_PATTERN_INVALID_INPUT",
      "#/split/config/value",
    );
  });
}

test("bigint is rejected as non-portable JSON", () => {
  expectPatternError(
    () => diamond(options({ value: 1n })),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config/value",
  );
});

for (const [label, value] of [
  ["Date", new Date(0)],
  ["Map", new Map([["key", "value"]])],
  ["Set", new Set(["value"])],
] as const) {
  test(`${label} instances are rejected`, () => {
    expectPatternError(
      () => diamond(options({ value })),
      "GE_PATTERN_INVALID_INPUT",
      "#/split/config/value",
    );
  });
}

test("cyclic caller input is rejected", () => {
  const config: Record<string, unknown> = {};
  config.self = config;
  expectPatternError(
    () => diamond(options(config)),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config/self",
  );
});

test("sparse arrays are rejected", () => {
  const sparse = new Array(2);
  sparse[1] = "present";
  expectPatternError(
    () => diamond(options({ sparse })),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config/sparse/0",
  );
});

test("arrays with extra properties are rejected", () => {
  const values = [1, 2] as number[] & { extra?: string };
  values.extra = "not-json";
  expectPatternError(
    () => diamond(options({ values })),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config/values/extra",
  );
});

test("symbol properties are rejected", () => {
  const config = { visible: true } as Record<PropertyKey, unknown>;
  config[Symbol("hidden")] = true;
  expectPatternError(
    () => diamond(options(config)),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config",
  );
});

test("non-enumerable properties are rejected", () => {
  const config: Record<string, unknown> = {};
  Object.defineProperty(config, "hidden", { value: true, enumerable: false });
  expectPatternError(
    () => diamond(options(config)),
    "GE_PATTERN_INVALID_INPUT",
    "#/split/config/hidden",
  );
});

test("negative zero is normalized to portable JSON zero", () => {
  const graph = diamond(options({ value: -0 }));
  const config = graph.nodes[0]?.config as { value: number };
  assert.equal(Object.is(config.value, -0), false);
  assert.equal(config.value, 0);
});

test("shared caller references become detached JSON values, not graph aliases", () => {
  const shared = { value: 1 };
  const graph = diamond({
    metadata: metadata("shared-reference"),
    split: node("split", "transform", shared),
    workers: [{ key: "worker", node: node("worker", "transform", shared) }],
    merge: node("merge"),
  });
  assert.deepEqual(graph.nodes[0]?.config, graph.nodes[1]?.config);
  assert.notEqual(graph.nodes[0]?.config, graph.nodes[1]?.config);
});

test("object key insertion order is normalized", () => {
  const firstConfig: Record<string, number> = {};
  firstConfig.z = 1;
  firstConfig.a = 2;
  const secondConfig: Record<string, number> = {};
  secondConfig.a = 2;
  secondConfig.z = 1;
  assert.deepEqual(diamond(options(firstConfig)), diamond(options(secondConfig)));
});

test("output round-trips as portable JSON", () => {
  const graph = diamond(options({ nested: [null, true, "value", 4] }));
  assert.deepEqual(JSON.parse(JSON.stringify(graph)), graph);
});

test("invalid metadata names are rejected before graph construction", () => {
  expectPatternError(
    () => diamond({ ...options(), metadata: metadata("Not Valid") }),
    "GE_PATTERN_INVALID_IDENTIFIER",
    "#/metadata/name",
  );
});

test("invalid NodeSpec fields are rejected by canonical core", () => {
  const invalidNode = { ...node("split"), kind: "not-a-kind" };
  expectPatternError(
    () => diamond({ ...options(), split: invalidNode as never }),
    "GE_PATTERN_CORE_REJECTED",
    "#",
  );
});

test("all successful outputs remain accepted by canonical core", () => {
  assert.equal(compileGraph(diamond(options())).valid, true);
});
