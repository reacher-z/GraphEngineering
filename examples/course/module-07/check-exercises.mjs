#!/usr/bin/env node

/**
 * Course module 7 — machine check for the exercises (artifact 11).
 *
 * One check per exercise in `exercises.md`, each verified against its
 * committed solution under `solutions/`. Exit 0 means every solution is
 * correct; the first wrong solution fails with a plain assertion.
 *
 * Run: node examples/course/module-07/check-exercises.mjs
 */

import assert from "node:assert/strict";

import { canonicalHash } from "../../../packages/core/dist/index.js";
import { runGraph } from "../../../packages/runtime/dist/index.js";

import { BRIEF, buildExecutors, latch, readJson } from "./handlers.mjs";

const checks = [];

// ---------------------------------------------------------------------------
// Exercise 1 — widen the diamond to three branches and predict the concurrency
// ---------------------------------------------------------------------------

{
  const solution = await readJson("solutions/exercise-1.graph.json");
  const answer = await readJson("solutions/exercise-1.answer.json");

  const agents = solution.nodes.filter((node) => node.kind === "agent");
  assert.equal(agents.length, 3, "exercise 1 solution must have three agent branches");
  assert.ok(canonicalHash(solution), "exercise 1 solution must canonicalize");

  const gate = latch(3);
  const result = await runGraph(
    solution,
    { brief: BRIEF },
    { nodeExecutors: buildExecutors(solution, { arrive: gate.arrive }), concurrency: 3 },
  );
  assert.equal(result.status, "succeeded");
  assert.equal(
    result.maxObservedConcurrency,
    answer.predictedMaxObservedConcurrency,
    "the predicted concurrency must be what the scheduler observed",
  );
  assert.equal(result.maxObservedConcurrency, 3, "three branches must overlap three wide");
  assert.equal(result.output.report.mergedFrom, answer.predictedMergedFrom);
  assert.deepEqual(
    result.output.report.branches,
    ["examples", "outline", "risks"],
    "the merge must join all three branches in sorted order",
  );

  checks.push({ exercise: 1, maxObservedConcurrency: result.maxObservedConcurrency });
}

// ---------------------------------------------------------------------------
// Exercise 2 — rename the merge ports; the join keys follow the ports
// ---------------------------------------------------------------------------

{
  const solution = await readJson("solutions/exercise-2.graph.json");
  assert.ok(canonicalHash(solution), "exercise 2 solution must canonicalize");

  const gate = latch(2);
  const result = await runGraph(
    solution,
    { brief: BRIEF },
    { nodeExecutors: buildExecutors(solution, { arrive: gate.arrive }), concurrency: 2 },
  );
  assert.equal(result.status, "succeeded");
  assert.deepEqual(
    result.output.report.branches,
    ["cases", "structure"],
    "the merge keys must be the renamed port names, not the producer node ids",
  );
  assert.deepEqual(
    result.output.report.findings.map((finding) => finding.branch),
    ["examples", "outline"],
    "the producers' own payloads are unchanged by the port rename",
  );

  checks.push({ exercise: 2, mergeKeys: result.output.report.branches });
}

// ---------------------------------------------------------------------------
// Exercise 3 — cap concurrency at 1 and predict what the scheduler observes
// ---------------------------------------------------------------------------

{
  const graphDocument = await readJson("diamond.graph.json");
  const answer = await readJson("solutions/exercise-3.answer.json");

  // No latch here: with one execution slot a rendezvous would deadlock —
  // which is itself part of the lesson.
  const result = await runGraph(
    graphDocument,
    { brief: BRIEF },
    { nodeExecutors: buildExecutors(graphDocument), concurrency: 1 },
  );
  assert.equal(result.status, "succeeded");
  assert.equal(
    result.maxObservedConcurrency,
    answer.maxObservedConcurrency,
    "with one slot the branches serialize; the diamond still joins both",
  );
  assert.equal(result.totalAttempts, answer.totalAttempts);

  const expected = await readJson("fixtures/expected-run.json");
  assert.deepEqual(
    result.output,
    expected.output,
    "serializing the branches must not change the merged report",
  );

  checks.push({ exercise: 3, maxObservedConcurrency: result.maxObservedConcurrency });
}

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-exercises/v1alpha1",
    module: 7,
    checks,
    allSolutionsCorrect: true,
  },
  null,
  2,
)}\n`);
