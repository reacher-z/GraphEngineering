#!/usr/bin/env node

/**
 * Course module 7 — the failing test that exposes the wrong implementation
 * (artifact 7).
 *
 * One assertion — "the report equals fixtures/expected-run.json" — applied to
 * both implementations:
 *
 *   - against run.mjs's approach (the graph scheduler joins both branches)
 *     it PASSES;
 *   - against wrong.mjs's approach (race to first completion) it FAILS, and
 *     this file asserts that failure: the wrong report differs from the
 *     fixture and is missing the `examples` branch.
 *
 * The suite therefore stays green while the pedagogy stays real: run this
 * file and exit 0 means "the correct implementation matches the fixture AND
 * the race bug is still detected by that same fixture".
 *
 * Run: node examples/course/module-07/wrong.test.mjs
 */

import assert from "node:assert/strict";

import { runGraph } from "../../../packages/runtime/dist/index.js";

import { BRIEF, buildExecutors, latch, readJson } from "./handlers.mjs";
import { raceToFirstMerge } from "./wrong.mjs";

const graphDocument = await readJson("diamond.graph.json");
const expected = await readJson("fixtures/expected-run.json");

/** The one shared assertion: a report must equal the committed fixture. */
function assertMatchesFixture(report) {
  assert.deepEqual(report, expected.output.report, "report differs from fixtures/expected-run.json");
}

// ---------------------------------------------------------------------------
// 1. The assertion PASSES against the correct implementation (run.mjs's path)
// ---------------------------------------------------------------------------

const gate = latch(2);
const result = await runGraph(
  graphDocument,
  { brief: BRIEF },
  { nodeExecutors: buildExecutors(graphDocument, { arrive: gate.arrive }), concurrency: 2 },
);
assert.equal(result.status, "succeeded");
assertMatchesFixture(result.output.report);

// ---------------------------------------------------------------------------
// 2. The same assertion FAILS against the wrong implementation — provably
// ---------------------------------------------------------------------------

const wrong = await raceToFirstMerge();

let exposure = null;
try {
  assertMatchesFixture(wrong.report);
} catch (error) {
  exposure = error;
}
assert.ok(
  exposure instanceof assert.AssertionError,
  "the fixture assertion must fail against the race-to-first merge",
);

// The failure is the taught failure: a silently dropped branch, not noise.
assert.notDeepEqual(wrong.report, expected.output.report);
assert.deepEqual(wrong.report.branches, ["outline"], "the race winner is deterministic");
assert.equal(wrong.report.mergedFrom, 1, "only one branch was merged");
assert.ok(
  !wrong.report.branches.includes("examples"),
  "the examples branch must have been silently dropped",
);

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-wrong-test/v1alpha1",
    module: 7,
    lane: "typescript",
    correctImplementationMatchesFixture: true,
    wrongImplementationExposed: true,
    droppedBranch: "examples",
  },
  null,
  2,
)}\n`);
