#!/usr/bin/env node

/**
 * Course module 2 — linear chain as a degenerate graph. TypeScript lane,
 * correct implementation.
 *
 * Three things happen here, in order:
 *
 *   1. Both committed graph documents (JSON and YAML) are decoded and must
 *      canonicalize to the same hash, which must equal the hash in
 *      `fixtures/expected-run.json`. A drifted document fails here.
 *   2. The three-node chain runs on the native DAG scheduler. The `enrich`
 *      node is deterministically flaky (first attempt throws, second
 *      succeeds), and the graph declares `retry.maxAttempts: 2` ON THAT NODE
 *      — so the scheduler retries exactly the failing node, in place.
 *   3. The run result is asserted against the committed fixture, including
 *      the PER-NODE attempt counts: extract 1, enrich 2, format 1. The
 *      nodes around the flaky one never re-run.
 *
 * Run: node examples/course/module-02/run.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { canonicalHash, decodeGraphSource } from "../../../packages/core/dist/index.js";
import { runGraph } from "../../../packages/runtime/dist/index.js";

import { BULLETIN, buildExecutors, failOnce, here, readJson } from "./handlers.mjs";

// ---------------------------------------------------------------------------
// 1. JSON and YAML are the same graph, and it is the graph the fixture names
// ---------------------------------------------------------------------------

const graphDocument = await readJson("chain.graph.json");
const yamlText = await readFile(here("chain.graph.yaml"), "utf8");
const expected = await readJson("fixtures/expected-run.json");

assert.deepEqual(
  decodeGraphSource(yamlText, { format: "yaml" }),
  graphDocument,
  "the committed YAML graph must decode to the committed JSON graph",
);
const graphHash = canonicalHash(graphDocument);
assert.equal(graphHash, expected.graphHash, "graph document drifted from the fixture hash");

// ---------------------------------------------------------------------------
// 2. Run the chain: enrich flakes once and is retried in place
// ---------------------------------------------------------------------------

const gate = failOnce();
const nodeExecutors = buildExecutors(graphDocument, { flaky: { enrich: gate } });

const result = await runGraph(graphDocument, { bulletin: BULLETIN }, { nodeExecutors, concurrency: 1 });

// ---------------------------------------------------------------------------
// 3. The result is exactly the committed fixture — per-node attempts included
// ---------------------------------------------------------------------------

assert.equal(result.status, expected.status);
assert.equal(result.maxObservedConcurrency, expected.maxObservedConcurrency);
assert.equal(result.totalAttempts, expected.totalAttempts);
assert.equal(gate.calls(), 2, "the flaky executor was invoked exactly twice");

const nodeAttempts = Object.fromEntries(result.nodes.map((node) => [node.nodeId, node.attempts]));
assert.deepEqual(
  nodeAttempts,
  expected.nodeAttempts,
  "only the flaky node may consume a second attempt",
);
assert.deepEqual(result.output, expected.output, "run output drifted from fixtures/expected-run.json");

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-run/v1alpha1",
    module: 2,
    lane: "typescript",
    graphHash,
    status: result.status,
    maxObservedConcurrency: result.maxObservedConcurrency,
    totalAttempts: result.totalAttempts,
    nodeAttempts,
    report: result.output.report,
  },
  null,
  2,
)}\n`);
