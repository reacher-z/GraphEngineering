import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  canonicalHash,
  compileGraph,
  type RouteSelectionPolicySnapshot,
} from "@graph-engineering/core";
import {
  PatternInputError,
  routedBranches,
  type PatternGraph,
  type RoutedBranchesOptions,
} from "../src/index.js";
import { metadata, node } from "./fixtures.js";

interface GraphExpectation {
  result: "graph";
  classifierConfig: RouteSelectionPolicySnapshot;
  compilerValidIn: readonly string[];
}

interface ErrorExpectation {
  result: "error";
  reason: string;
}

interface PatternLoweringCase {
  name: string;
  normalizedBranchKeys: readonly string[];
  classifierConfig: Readonly<Record<string, unknown>>;
  routePolicy?: RouteSelectionPolicySnapshot;
  expect: GraphExpectation | ErrorExpectation;
}

interface IntegratedRouterCorpus {
  patternLoweringCases: readonly PatternLoweringCase[];
}

const corpus = JSON.parse(readFileSync(
  new URL("../../../../spec/conformance/integrated-router.case.json", import.meta.url),
  "utf8",
)) as IntegratedRouterCorpus;

const EXPECTED_CASE_NAMES = [
  "legacy-empty-config-synthesizes-single-policy",
  "supplied-policy-is-lowered-directly",
  "matching-preconfigured-policy-is-preserved",
  "option-conflicts-with-nonempty-classifier-config",
  "policy-routes-must-match-branch-order",
  "invalid-supplied-policy-fails-before-graph-return",
] as const;

const ERROR_PATH_BY_REASON: Readonly<Record<string, string>> = {
  "routePolicy-conflicts-with-preconfigured-classifier": "#/routePolicy",
  "allowedRoutes-must-equal-normalized-branch-keys": "#/routePolicy/allowedRoutes",
  "routePolicy-is-not-exact": "#/routePolicy/maxMulticast",
};

function patternOptions(
  testCase: PatternLoweringCase,
  branchKeys: readonly string[],
): RoutedBranchesOptions {
  const base: RoutedBranchesOptions = {
    metadata: metadata(`corpus-${testCase.name}`),
    classify: node("classify", "router", testCase.classifierConfig),
    branches: branchKeys.map((key) => ({ key, node: node(key) })),
    merge: node("merge", "barrier"),
  };
  return testCase.routePolicy === undefined
    ? base
    : { ...base, routePolicy: testCase.routePolicy };
}

function capturePatternError(action: () => PatternGraph): PatternInputError {
  let returnedGraph: PatternGraph | undefined;
  let captured: PatternInputError | undefined;
  assert.throws(() => {
    returnedGraph = action();
  }, (error: unknown) => {
    assert.ok(error instanceof PatternInputError);
    captured = error;
    return true;
  });
  assert.equal(returnedGraph, undefined, "an invalid corpus case must fail before graph return");
  return captured as PatternInputError;
}

test("integrated-router pattern corpus has the complete literal six-case inventory", () => {
  assert.equal(corpus.patternLoweringCases.length, EXPECTED_CASE_NAMES.length);
  assert.deepEqual(
    corpus.patternLoweringCases.map(({ name }) => name),
    EXPECTED_CASE_NAMES,
  );
  assert.equal(new Set(corpus.patternLoweringCases.map(({ name }) => name)).size, 6);
  for (const testCase of corpus.patternLoweringCases) {
    assert.deepEqual(testCase.normalizedBranchKeys, ["audit", "quick"]);
  }
});

for (const testCase of corpus.patternLoweringCases) {
  test(`integrated-router pattern corpus: ${testCase.name}`, () => {
    const normalized = [...testCase.normalizedBranchKeys];
    const permutation = [...normalized].reverse();

    if (testCase.expect.result === "graph") {
      assert.deepEqual(testCase.expect.compilerValidIn, ["typescript", "python"]);
      const normalizedGraph = routedBranches(patternOptions(testCase, normalized));
      const permutedGraph = routedBranches(patternOptions(testCase, permutation));

      assert.deepEqual(normalizedGraph.nodes[0]?.config, testCase.expect.classifierConfig);
      assert.deepEqual(permutedGraph.nodes[0]?.config, testCase.expect.classifierConfig);
      assert.deepEqual(permutedGraph, normalizedGraph);
      assert.equal(canonicalHash(permutedGraph), canonicalHash(normalizedGraph));
      assert.equal(compileGraph(normalizedGraph).valid, true);
      assert.equal(compileGraph(permutedGraph).valid, true);
      return;
    }

    const expectedPath = ERROR_PATH_BY_REASON[testCase.expect.reason];
    assert.notEqual(expectedPath, undefined, `unmapped corpus reason ${testCase.expect.reason}`);
    for (const branchKeys of [normalized, permutation]) {
      const error = capturePatternError(() => routedBranches(patternOptions(testCase, branchKeys)));
      assert.equal(error.code, "GE_PATTERN_INVALID_INPUT");
      assert.equal(error.path, expectedPath);
    }
  });
}
