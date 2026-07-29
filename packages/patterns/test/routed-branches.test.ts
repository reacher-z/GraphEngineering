import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileGraph } from "@graph-engineering/core";
import { routedBranches } from "../src/index.js";
import { expectPatternError, metadata, node } from "./fixtures.js";

function options() {
  return {
    metadata: metadata("routed-test"),
    classify: node("classify", "router"),
    branches: [
      { key: "security", node: node("security") },
      { key: "correctness", node: node("correctness") },
    ],
    merge: node("merge", "barrier"),
  };
}

test("routedBranches produces a core-valid acyclic graph", () => {
  const graph = routedBranches(options());
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.deepEqual(compilation.topologicalLayers, [
    ["classify"],
    ["correctness", "security"],
    ["merge"],
  ]);
  assert.deepEqual(graph.entrypoints, ["classify"]);
});

test("routedBranches emits only the fixed versioned RouteEquals annotation", () => {
  const graph = routedBranches(options());
  const fanout = graph.edges.filter((edge) => edge.from.node === "classify");
  assert.deepEqual(fanout.map((edge) => edge.condition), [
    {
      apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
      kind: "RouteEquals",
      routeKey: "correctness",
    },
    {
      apiVersion: "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1",
      kind: "RouteEquals",
      routeKey: "security",
    },
  ]);
});

test("routedBranches synthesizes a direct single-route policy for legacy empty config", () => {
  const graph = routedBranches(options());
  assert.deepEqual(graph.nodes[0]?.config, {
    kind: "single",
    allowedRoutes: ["correctness", "security"],
  });
  assert.equal(compileGraph(graph).valid, true);
});

test("routedBranches lowers an exact supplied routePolicy directly", () => {
  const value = options();
  const graph = routedBranches({
    ...value,
    routePolicy: {
      kind: "multi",
      allowedRoutes: ["correctness", "security"],
      defaultRoute: "correctness",
      maxMulticast: 2,
    },
  });
  assert.deepEqual(graph.nodes[0]?.config, {
    kind: "multi",
    allowedRoutes: ["correctness", "security"],
    defaultRoute: "correctness",
    maxMulticast: 2,
  });
});

test("routedBranches preserves a matching preconfigured policy", () => {
  const value = options();
  value.classify.config = {
    kind: "single",
    allowedRoutes: ["correctness", "security"],
    defaultRoute: "security",
  };
  const graph = routedBranches(value);
  assert.deepEqual(graph.nodes[0]?.config, value.classify.config);
});

test("routedBranches rejects routePolicy with preconfigured classifier config", () => {
  const value = options();
  value.classify.config = {
    kind: "single",
    allowedRoutes: ["correctness", "security"],
  };
  expectPatternError(
    () => routedBranches({ ...value, routePolicy: value.classify.config as never }),
    "GE_PATTERN_INVALID_INPUT",
    "#/routePolicy",
  );
});

test("routedBranches rejects policy routes outside normalized branch order", () => {
  expectPatternError(
    () => routedBranches({
      ...options(),
      routePolicy: {
        kind: "single",
        allowedRoutes: ["security", "correctness"],
      },
    }),
    "GE_PATTERN_INVALID_INPUT",
    "#/routePolicy/allowedRoutes",
  );
});

test("routedBranches rejects an inexact supplied routePolicy", () => {
  expectPatternError(
    () => routedBranches({
      ...options(),
      routePolicy: {
        kind: "multi",
        allowedRoutes: ["correctness", "security"],
      } as never,
    }),
    "GE_PATTERN_INVALID_INPUT",
    "#/routePolicy/maxMulticast",
  );
});

test("routedBranches gives every branch one unique merge port", () => {
  const graph = routedBranches(options());
  assert.deepEqual(
    graph.edges.filter((edge) => edge.to.node === "merge").map((edge) => edge.to.port),
    ["correctness", "security"],
  );
});

test("routedBranches normalizes branch permutations", () => {
  const left = options();
  const right = options();
  right.branches.reverse();
  const first = routedBranches(left);
  const second = routedBranches(right);
  assert.deepEqual(first, second);
  assert.equal(canonicalHash(first), canonicalHash(second));
});

test("routedBranches marks its declarative runtime capability in metadata", () => {
  const value = options();
  value.metadata.labels = { owner: "platform" };
  const graph = routedBranches(value);
  assert.deepEqual(graph.metadata.labels, {
    "graphengineering.reacher-z.github.io/pattern": "routed-branches/v1alpha1",
    "graphengineering.reacher-z.github.io/runtime-capability": "edge-condition-routing/v1alpha1",
    owner: "platform",
  });
});

test("routedBranches accepts identical reserved labels", () => {
  const value = options();
  value.metadata.labels = {
    "graphengineering.reacher-z.github.io/pattern": "routed-branches/v1alpha1",
    "graphengineering.reacher-z.github.io/runtime-capability": "edge-condition-routing/v1alpha1",
  };
  assert.doesNotThrow(() => routedBranches(value));
});

test("routedBranches rejects conflicting reserved labels rather than overwriting", () => {
  const value = options();
  value.metadata.labels = {
    "graphengineering.reacher-z.github.io/runtime-capability": "made-up-capability",
  };
  expectPatternError(
    () => routedBranches(value),
    "GE_PATTERN_RESERVED_LABEL_CONFLICT",
    "#/metadata/labels/graphengineering.reacher-z.github.io~1runtime-capability",
  );
});

test("routedBranches rejects caller condition fields", () => {
  const value = options();
  const branch = { ...value.branches[0], condition: { arbitrary: true } };
  expectPatternError(
    () => routedBranches({ ...value, branches: [branch] } as never),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/branches/0/condition",
  );
});

test("routedBranches rejects an empty branch set", () => {
  expectPatternError(
    () => routedBranches({ ...options(), branches: [] }),
    "GE_PATTERN_EMPTY_COLLECTION",
    "#/branches",
  );
});

test("routedBranches rejects duplicate branch keys", () => {
  const value = options();
  value.branches[1] = { key: "security", node: node("other") };
  expectPatternError(() => routedBranches(value), "GE_PATTERN_DUPLICATE_KEY");
});

test("routedBranches rejects caller node collisions", () => {
  expectPatternError(
    () => routedBranches({ ...options(), merge: node("classify") }),
    "GE_PATTERN_DUPLICATE_NODE_ID",
  );
});

test("routedBranches uses stable edge IDs independent of branch IDs", () => {
  const graph = routedBranches(options());
  assert.deepEqual(graph.edges.map((edge) => edge.id), [
    "ge-routed-branches-0001",
    "ge-routed-branches-0002",
    "ge-routed-branches-0003",
    "ge-routed-branches-0004",
  ]);
});
