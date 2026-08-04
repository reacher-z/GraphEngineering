#!/usr/bin/env node

/**
 * Course module 2 — machine check for the exercises (artifact 11).
 *
 * One check per exercise in `exercises.md`, each verified against its
 * committed solution under `solutions/`. Exit 0 means every solution is
 * correct; the first wrong solution fails with a plain assertion.
 *
 * Run: node examples/course/module-02/check-exercises.mjs
 */

import assert from "node:assert/strict";

import { canonicalHash } from "../../../packages/core/dist/index.js";
import { runGraph } from "../../../packages/runtime/dist/index.js";

import { BULLETIN, buildExecutors, failOnce, readJson } from "./handlers.mjs";

const checks = [];

const attemptsByNode = (result) =>
  Object.fromEntries(result.nodes.map((node) => [node.nodeId, node.attempts]));

// ---------------------------------------------------------------------------
// Exercise 1 — move the flake (and the retry declaration) to the format node
// ---------------------------------------------------------------------------

{
  const solution = await readJson("solutions/exercise-1.graph.json");
  const answer = await readJson("solutions/exercise-1.answer.json");
  assert.ok(canonicalHash(solution), "exercise 1 solution must canonicalize");

  const formatNode = solution.nodes.find((node) => node.id === "format");
  const enrichNode = solution.nodes.find((node) => node.id === "enrich");
  assert.equal(formatNode.retry?.maxAttempts, 2, "the retry declaration follows the flake");
  assert.equal(enrichNode.retry, undefined, "enrich no longer declares a retry it does not need");

  const gate = failOnce();
  const result = await runGraph(
    solution,
    { bulletin: BULLETIN },
    { nodeExecutors: buildExecutors(solution, { flaky: { format: gate } }), concurrency: 1 },
  );
  assert.equal(result.status, answer.status);
  assert.deepEqual(
    attemptsByNode(result),
    answer.nodeAttempts,
    "everything upstream of the flake keeps exactly one attempt",
  );
  assert.equal(result.totalAttempts, answer.totalAttempts);

  const base = await readJson("fixtures/expected-run.json");
  assert.deepEqual(
    result.output,
    base.output,
    "where the flake lives must not change what the chain produces",
  );

  checks.push({ exercise: 1, nodeAttempts: attemptsByNode(result) });
}

// ---------------------------------------------------------------------------
// Exercise 2 — no retry anywhere: the first flake is fatal, downstream skips
// ---------------------------------------------------------------------------

{
  const solution = await readJson("solutions/exercise-2.graph.json");
  const answer = await readJson("solutions/exercise-2.answer.json");
  assert.ok(canonicalHash(solution), "exercise 2 solution must canonicalize");
  assert.ok(
    solution.nodes.every((node) => node.retry === undefined),
    "the solution declares no retry on any node",
  );

  const result = await runGraph(
    solution,
    { bulletin: BULLETIN },
    { nodeExecutors: buildExecutors(solution, { flaky: { enrich: failOnce() } }), concurrency: 1 },
  );
  assert.equal(result.status, answer.status, "one flake with no retry budget fails the run");
  assert.deepEqual(attemptsByNode(result), answer.nodeAttempts);

  const enrich = result.nodes.find((node) => node.nodeId === "enrich");
  assert.equal(enrich.failure?.code, answer.enrichFailureCode);
  const format = result.nodes.find((node) => node.nodeId === "format");
  assert.equal(format.status, answer.formatStatus, "format never ran, and the result says so");
  assert.equal(format.failure?.code, answer.formatFailureCode);

  checks.push({ exercise: 2, status: result.status, formatStatus: format.status });
}

// ---------------------------------------------------------------------------
// Exercise 3 — three slots buy a chain nothing: every layer has width 1
// ---------------------------------------------------------------------------

{
  const graphDocument = await readJson("chain.graph.json");
  const answer = await readJson("solutions/exercise-3.answer.json");

  const result = await runGraph(
    graphDocument,
    { bulletin: BULLETIN },
    { nodeExecutors: buildExecutors(graphDocument, { flaky: { enrich: failOnce() } }), concurrency: 3 },
  );
  assert.equal(result.status, "succeeded");
  assert.equal(
    result.maxObservedConcurrency,
    answer.maxObservedConcurrency,
    "a chain's layers all have width 1, so extra slots stay idle",
  );
  assert.equal(result.totalAttempts, answer.totalAttempts);

  const expected = await readJson("fixtures/expected-run.json");
  assert.deepEqual(
    result.output,
    expected.output,
    "the slot count must not change the report",
  );

  checks.push({ exercise: 3, maxObservedConcurrency: result.maxObservedConcurrency });
}

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-exercises/v1alpha1",
    module: 2,
    checks,
    allSolutionsCorrect: true,
  },
  null,
  2,
)}\n`);
