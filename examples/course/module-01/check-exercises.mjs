#!/usr/bin/env node

/**
 * Course module 1 — machine check for the exercises (artifact 11).
 *
 * One check per exercise in `exercises.md`, each verified against its
 * committed solution under `solutions/`. Exit 0 means every solution is
 * correct; the first wrong solution fails with a plain assertion.
 *
 * Run: node examples/course/module-01/check-exercises.mjs
 */

import assert from "node:assert/strict";

import { canonicalHash } from "../../../packages/core/dist/index.js";
import { runGraph } from "../../../packages/runtime/dist/index.js";

import { ORDER, buildExecutors, dollars, priceOrder, readJson } from "./handlers.mjs";

const checks = [];

// ---------------------------------------------------------------------------
// Exercise 1 — widen the edge contract with a required currency field
// ---------------------------------------------------------------------------

{
  const solution = await readJson("solutions/exercise-1.graph.json");
  const answer = await readJson("solutions/exercise-1.answer.json");
  assert.ok(canonicalHash(solution), "exercise 1 solution must canonicalize");

  const producer = solution.nodes.find((node) => node.id === "price-order");
  assert.ok(
    producer.outputSchema.required.includes("currency"),
    "the currency field must be a declared, required part of the producer's contract",
  );

  // The exercise's executor half: the producer adds the field, the consumer
  // reads it by name. Neither side parses anything.
  const port = solution.edges[0].to.port;
  const amount = (cents, currency) => `${dollars(cents).slice(1)} ${currency}`;
  const nodeExecutors = {
    "price-order": ({ input }) => ({ ...priceOrder(input), currency: "USD" }),
    "write-invoice": ({ input }) => {
      const order = input[port];
      return {
        invoiceLine:
          `${order.sku}: ${order.quantity} x ${amount(order.unitPriceCents, order.currency)} each` +
          ` = ${amount(order.totalCents, order.currency)}`,
        totalCents: order.totalCents,
        currency: order.currency,
      };
    },
  };

  const result = await runGraph(solution, ORDER, { nodeExecutors, concurrency: 1 });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(
    result.output.invoice,
    answer,
    "the currency-aware invoice must match the committed answer",
  );

  const base = await readJson("fixtures/expected-run.json");
  assert.equal(
    result.output.invoice.totalCents,
    base.output.invoice.totalCents,
    "adding a field must not reprice the order",
  );

  checks.push({ exercise: 1, invoiceLine: result.output.invoice.invoiceLine });
}

// ---------------------------------------------------------------------------
// Exercise 2 — rename the port; the consumer's key follows the graph
// ---------------------------------------------------------------------------

{
  const solution = await readJson("solutions/exercise-2.graph.json");
  assert.ok(canonicalHash(solution), "exercise 2 solution must canonicalize");
  assert.equal(
    solution.edges[0].to.port,
    "pricedOrder",
    "the solution renames the destination port",
  );

  // The shared executors resolve the port name from the graph document, so
  // the same code serves both port spellings — nothing but the graph changed.
  const result = await runGraph(solution, ORDER, {
    nodeExecutors: buildExecutors(solution),
    concurrency: 1,
  });
  assert.equal(result.status, "succeeded");

  const base = await readJson("fixtures/expected-run.json");
  assert.deepEqual(
    result.output,
    base.output,
    "renaming the port re-keys the consumer's view; the invoice must not change",
  );

  checks.push({ exercise: 2, port: solution.edges[0].to.port });
}

// ---------------------------------------------------------------------------
// Exercise 3 — delete the edge; the compiler refuses before any node runs
// ---------------------------------------------------------------------------

{
  const graphDocument = await readJson("typed-edge.graph.json");
  const answer = await readJson("solutions/exercise-3.answer.json");

  const edgeless = structuredClone(graphDocument);
  edgeless.edges = [];

  const result = await runGraph(edgeless, ORDER, {
    nodeExecutors: buildExecutors(graphDocument),
    concurrency: 1,
  });
  assert.equal(result.status, answer.status, "the edgeless graph must be refused");
  assert.ok(
    result.failures.some((failure) => failure.code === answer.failureCode),
    `compilation must fail with ${answer.failureCode}`,
  );
  assert.equal(
    result.totalAttempts,
    answer.totalAttempts,
    "no node may run when the graph does not compile",
  );

  checks.push({ exercise: 3, failureCode: answer.failureCode });
}

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-exercises/v1alpha1",
    module: 1,
    checks,
    allSolutionsCorrect: true,
  },
  null,
  2,
)}\n`);
