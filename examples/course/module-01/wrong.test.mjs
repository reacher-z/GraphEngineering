#!/usr/bin/env node

/**
 * Course module 1 — the failing test that exposes the wrong implementation
 * (artifact 7).
 *
 * One assertion — "the invoice equals fixtures/expected-run.json" — applied
 * to both implementations:
 *
 *   - against run.mjs's approach (a typed order object crosses the declared
 *     edge) it PASSES;
 *   - against wrong.mjs's approach (prose across the edge, parsed back by
 *     the consumer) it FAILS, and this file asserts that failure: the parse
 *     read the `12` inside the SKU `AB-12` as the quantity.
 *
 * The suite therefore stays green while the pedagogy stays real: run this
 * file and exit 0 means "the correct implementation matches the fixture AND
 * the prose-parsing bug is still detected by that same fixture".
 *
 * Run: node examples/course/module-01/wrong.test.mjs
 */

import assert from "node:assert/strict";

import { runGraph } from "../../../packages/runtime/dist/index.js";

import { ORDER, buildExecutors, readJson } from "./handlers.mjs";
import { proseHandOff } from "./wrong.mjs";

const graphDocument = await readJson("typed-edge.graph.json");
const expected = await readJson("fixtures/expected-run.json");

/** The one shared assertion: an invoice must equal the committed fixture. */
function assertMatchesFixture(invoice) {
  assert.deepEqual(
    invoice,
    expected.output.invoice,
    "invoice differs from fixtures/expected-run.json",
  );
}

// ---------------------------------------------------------------------------
// 1. The assertion PASSES against the correct implementation (run.mjs's path)
// ---------------------------------------------------------------------------

const result = await runGraph(graphDocument, ORDER, {
  nodeExecutors: buildExecutors(graphDocument),
  concurrency: 1,
});
assert.equal(result.status, "succeeded");
assertMatchesFixture(result.output.invoice);

// ---------------------------------------------------------------------------
// 2. The same assertion FAILS against the wrong implementation — provably
// ---------------------------------------------------------------------------

const wrong = proseHandOff();

let exposure = null;
try {
  assertMatchesFixture(wrong.invoice);
} catch (error) {
  exposure = error;
}
assert.ok(
  exposure instanceof assert.AssertionError,
  "the fixture assertion must fail against the prose hand-off",
);

// The failure is the taught failure: a mis-parsed field, not noise.
assert.notDeepEqual(wrong.invoice, expected.output.invoice);
assert.equal(wrong.parsedQuantity, 12, "the parse read the SKU's digits as the quantity");
assert.equal(ORDER.quantity, 3, "the actual quantity was never 12");
assert.equal(wrong.invoice.totalCents, 12 * ORDER.unitPriceCents, "the customer is overbilled");
assert.ok(
  wrong.invoice.invoiceLine.startsWith("AB-12: 12 x"),
  "the wrong invoice bills 12 units, deterministically",
);

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-wrong-test/v1alpha1",
    module: 1,
    lane: "typescript",
    correctImplementationMatchesFixture: true,
    wrongImplementationExposed: true,
    misparsedField: "quantity",
  },
  null,
  2,
)}\n`);
