#!/usr/bin/env node

/**
 * Course module 1 — nodes and real data edges. TypeScript lane, correct
 * implementation.
 *
 * Three things happen here, in order:
 *
 *   1. Both committed graph documents (JSON and YAML) are decoded and must
 *      canonicalize to the same hash, which must equal the hash in
 *      `fixtures/expected-run.json`. A drifted document fails here.
 *   2. The two-node graph runs on the native DAG scheduler with plain
 *      deterministic executors — no adapter, no network, no credential. The
 *      producer's typed order object crosses the one declared edge and lands
 *      in the consumer keyed by the edge's port name (`order`).
 *   3. The run result is asserted against the committed fixture: status,
 *      observed concurrency, attempt count, and the full invoice.
 *
 * Run: node examples/course/module-01/run.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { canonicalHash, decodeGraphSource } from "../../../packages/core/dist/index.js";
import { runGraph } from "../../../packages/runtime/dist/index.js";

import { ORDER, buildExecutors, here, readJson } from "./handlers.mjs";

// ---------------------------------------------------------------------------
// 1. JSON and YAML are the same graph, and it is the graph the fixture names
// ---------------------------------------------------------------------------

const graphDocument = await readJson("typed-edge.graph.json");
const yamlText = await readFile(here("typed-edge.graph.yaml"), "utf8");
const expected = await readJson("fixtures/expected-run.json");

assert.deepEqual(
  decodeGraphSource(yamlText, { format: "yaml" }),
  graphDocument,
  "the committed YAML graph must decode to the committed JSON graph",
);
const graphHash = canonicalHash(graphDocument);
assert.equal(graphHash, expected.graphHash, "graph document drifted from the fixture hash");

// ---------------------------------------------------------------------------
// 2. Run the pair: price the order, cross the typed edge, write the invoice
// ---------------------------------------------------------------------------

const nodeExecutors = buildExecutors(graphDocument);

const result = await runGraph(graphDocument, ORDER, { nodeExecutors, concurrency: 1 });

// ---------------------------------------------------------------------------
// 3. The result is exactly the committed fixture
// ---------------------------------------------------------------------------

assert.equal(result.status, expected.status);
assert.equal(result.maxObservedConcurrency, expected.maxObservedConcurrency);
assert.equal(result.totalAttempts, expected.totalAttempts, "each node runs exactly once");
assert.deepEqual(result.output, expected.output, "run output drifted from fixtures/expected-run.json");

// The consumer read `quantity` as a typed integer field, not out of prose:
assert.equal(result.output.invoice.totalCents, ORDER.quantity * ORDER.unitPriceCents);

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.course-module-run/v1alpha1",
    module: 1,
    lane: "typescript",
    graphHash,
    status: result.status,
    maxObservedConcurrency: result.maxObservedConcurrency,
    totalAttempts: result.totalAttempts,
    invoice: result.output.invoice,
  },
  null,
  2,
)}\n`);
