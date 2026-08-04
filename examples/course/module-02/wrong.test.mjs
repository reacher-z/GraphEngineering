#!/usr/bin/env node

/**
 * Course module 2 — the failing test that exposes the wrong implementation
 * (artifact 7).
 *
 * One assertion — "the run shape (report AND per-node attempts) equals
 * fixtures/expected-run.json" — applied to both implementations:
 *
 *   - against run.mjs's approach (retry declared on the flaky node; the
 *     scheduler retries it in place) it PASSES;
 *   - against wrong.mjs's approach (retry wrapped around the whole chain) it
 *     FAILS, and this file asserts that failure. Crucially the wrong REPORT
 *     is identical to the fixture's — an output-only test cannot catch this
 *     bug. The attempt accounting catches it: extract ran twice.
 *
 * The suite therefore stays green while the pedagogy stays real: run this
 * file and exit 0 means "the correct implementation matches the fixture AND
 * the whole-chain-retry bug is still detected by that same fixture".
 *
 * Run: node examples/course/module-02/wrong.test.mjs
 */

import assert from "node:assert/strict";

import { runGraph } from "../../../packages/runtime/dist/index.js";

import { BULLETIN, buildExecutors, failOnce, readJson } from "./handlers.mjs";
import { retryWholeChain } from "./wrong.mjs";

const graphDocument = await readJson("chain.graph.json");
const expected = await readJson("fixtures/expected-run.json");

/** The one shared assertion: report and per-node attempts match the fixture. */
function assertMatchesFixture(shape) {
  assert.deepEqual(
    shape,
    { report: expected.output.report, nodeAttempts: expected.nodeAttempts },
    "run shape differs from fixtures/expected-run.json",
  );
}

// ---------------------------------------------------------------------------
// 1. The assertion PASSES against the correct implementation (run.mjs's path)
// ---------------------------------------------------------------------------

const result = await runGraph(
  graphDocument,
  { bulletin: BULLETIN },
  { nodeExecutors: buildExecutors(graphDocument, { flaky: { enrich: failOnce() } }), concurrency: 1 },
);
assert.equal(result.status, "succeeded");
assertMatchesFixture({
  report: result.output.report,
  nodeAttempts: Object.fromEntries(result.nodes.map((node) => [node.nodeId, node.attempts])),
});

// ---------------------------------------------------------------------------
// 2. The same assertion FAILS against the wrong implementation — provably
// ---------------------------------------------------------------------------

const wrong = retryWholeChain();

let exposure = null;
try {
  assertMatchesFixture({ report: wrong.report, nodeAttempts: wrong.attemptCounts });
} catch (error) {
  exposure = error;
}
assert.ok(
  exposure instanceof assert.AssertionError,
  "the fixture assertion must fail against the whole-chain retry",
);

// The failure is the taught failure: wasted re-runs, not a wrong report.
assert.deepEqual(
  wrong.report,
  expected.output.report,
  "the report is identical — an output-only test would call this correct",
);
assert.equal(wrong.attemptCounts.extract, 2, "extract was needlessly re-run by the chain retry");
assert.equal(expected.nodeAttempts.extract, 1, "the scheduler runs extract exactly once");
assert.equal(wrong.attemptCounts.enrich, 2, "the flaky node still needed its two attempts");
assert.equal(wrong.attemptCounts.format, 1, "format ran once — only upstream work was duplicated");

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-wrong-test/v1alpha1",
    module: 2,
    lane: "typescript",
    correctImplementationMatchesFixture: true,
    wrongImplementationExposed: true,
    reportIdentical: true,
    needlesslyReRunNode: "extract",
  },
  null,
  2,
)}\n`);
