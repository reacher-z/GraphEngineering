#!/usr/bin/env node

/**
 * Course module 7 — diamond topology. TypeScript lane, correct implementation.
 *
 * Three things happen here, in order:
 *
 *   1. Both committed graph documents (JSON and YAML) are decoded and must
 *      canonicalize to the same hash, which must equal the hash in
 *      `fixtures/expected-run.json`. A drifted document fails here.
 *   2. The diamond runs on the native DAG scheduler with plain deterministic
 *      executors — no adapter, no network, no credential. A 2-party latch
 *      proves the two branches actually overlap.
 *   3. The run result is asserted against the committed fixture: status,
 *      observed concurrency, attempt count, and the full report.
 *
 * Run: node examples/course/module-07/run.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { canonicalHash, decodeGraphSource } from "../../../packages/core/dist/index.js";
import { runGraph } from "../../../packages/runtime/dist/index.js";

import { BRIEF, buildExecutors, here, latch, readJson } from "./handlers.mjs";

// ---------------------------------------------------------------------------
// 1. JSON and YAML are the same graph, and it is the graph the fixture names
// ---------------------------------------------------------------------------

const graphDocument = await readJson("diamond.graph.json");
const yamlText = await readFile(here("diamond.graph.yaml"), "utf8");
const expected = await readJson("fixtures/expected-run.json");

assert.deepEqual(
  decodeGraphSource(yamlText, { format: "yaml" }),
  graphDocument,
  "the committed YAML graph must decode to the committed JSON graph",
);
const graphHash = canonicalHash(graphDocument);
assert.equal(graphHash, expected.graphHash, "graph document drifted from the fixture hash");

// ---------------------------------------------------------------------------
// 2. Run the diamond: split, two overlapping branches, deterministic merge
// ---------------------------------------------------------------------------

const gate = latch(2);
const nodeExecutors = buildExecutors(graphDocument, { arrive: gate.arrive });

const result = await runGraph(graphDocument, { brief: BRIEF }, { nodeExecutors, concurrency: 2 });

// ---------------------------------------------------------------------------
// 3. The result is exactly the committed fixture
// ---------------------------------------------------------------------------

assert.equal(result.status, expected.status);
assert.equal(gate.arrivals(), 2, "both branches must have started before either finished");
assert.equal(
  result.maxObservedConcurrency,
  expected.maxObservedConcurrency,
  "the two branches must overlap",
);
assert.equal(result.totalAttempts, expected.totalAttempts);
assert.deepEqual(result.output, expected.output, "run output drifted from fixtures/expected-run.json");

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-run/v1alpha1",
    module: 7,
    lane: "typescript",
    graphHash,
    status: result.status,
    maxObservedConcurrency: result.maxObservedConcurrency,
    totalAttempts: result.totalAttempts,
    report: result.output.report,
  },
  null,
  2,
)}\n`);
