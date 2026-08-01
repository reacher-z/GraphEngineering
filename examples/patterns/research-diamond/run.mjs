#!/usr/bin/env node

/**
 * Pattern 01 — multi-source research diamond. TypeScript lane, mock end to end.
 *
 * Four things happen here, in order:
 *
 *   1. The bundle graph is reconstructed from the native `researchDiamond`
 *      constructor and checked against both committed canonical documents
 *      (JSON and YAML). A drifted bundle fails here, not at run time.
 *   2. The graph runs on the native DAG scheduler. Each source node dispatches
 *      through the deterministic mock adapter, scripted entirely from
 *      `fixtures/sources.json`. The three sources must actually overlap.
 *   3. The same graph runs durably with payload protection configured. The
 *      committed event sequence is compared against `fixtures/expected-events.json`.
 *   4. A parallelism-versus-barrier trace is rendered from the committed event
 *      order.
 *
 * No network access, no credential, no API key, no clock reading. Every value
 * below is a function of the graph, the descriptor and the committed fixtures.
 *
 * Run: node examples/patterns/research-diamond/run.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { canonicalHash, decodeGraphSource } from "../../../packages/core/dist/index.js";
import { createAdapterExecutor, createMockAdapter } from "../../../packages/adapters/dist/index.js";
import { researchDiamond } from "../../../packages/patterns/dist/src/index.js";
import {
  DEFAULT_CAPTURE_POLICY,
  DeterministicTestKeyProvider,
  MemoryProtectedEventStore,
  MemoryProtectedPayloadStore,
} from "../../../packages/persistence/dist/index.js";
import { runGraph, startDurableGraphRun } from "../../../packages/runtime/dist/index.js";

import {
  RUN_ID,
  SOURCE_KEYS,
  bundleFile,
  buildExecutors,
  overlapGate,
  protection,
  readJson,
  renderTrace,
  sourceOptions,
  synthesize,
} from "./bundle.mjs";

// ---------------------------------------------------------------------------
// 1. The committed bundle documents are exactly what the constructor produces
// ---------------------------------------------------------------------------

const graphDocument = await readJson("research-diamond.graph.json");
const yamlText = await readFile(bundleFile("research-diamond.graph.yaml"), "utf8");
const corpus = await readJson("fixtures/sources.json");
const expectedRun = await readJson("fixtures/expected-run.json");
const expectedEvents = await readJson("fixtures/expected-events.json");

const constructed = researchDiamond({ sources: sourceOptions() });
assert.deepEqual(
  JSON.parse(JSON.stringify(constructed)),
  graphDocument,
  "the committed JSON graph must equal the constructor output",
);
assert.deepEqual(
  decodeGraphSource(yamlText, { format: "yaml" }),
  graphDocument,
  "the committed YAML graph must decode to the committed JSON graph",
);
const graphHash = canonicalHash(graphDocument);
assert.equal(graphHash, expectedRun.graphHash);

// ---------------------------------------------------------------------------
// 2. The deterministic mock end-to-end run
// ---------------------------------------------------------------------------

const descriptor = await readJson("mock-adapter.descriptor.json");
const gate = overlapGate(SOURCE_KEYS.map((key) => `source-${key}`));
const parallel = buildExecutors({
  corpus,
  descriptor,
  createMockAdapter,
  createAdapterExecutor,
  synthesize,
  arrive: gate.arrive,
});

const runResult = await runGraph(
  graphDocument,
  { question: corpus.question },
  { nodeExecutors: parallel.nodeExecutors, concurrency: 3 },
);
gate.assertComplete();

assert.equal(runResult.status, "succeeded");
assert.equal(runResult.maxObservedConcurrency, expectedRun.maxObservedConcurrency);
assert.equal(runResult.totalAttempts, expectedRun.totalAttempts);
assert.equal(parallel.dispatches(), 3, "one mock dispatch per source, and no more");
assert.deepEqual(runResult.output, expectedRun.output);

// ---------------------------------------------------------------------------
// 3. The same graph, durably, with payload protection configured
// ---------------------------------------------------------------------------

const durableExecutors = buildExecutors({
  corpus,
  descriptor,
  createMockAdapter,
  createAdapterExecutor,
  synthesize,
});
const journal = new MemoryProtectedEventStore();
const guard = protection({
  journal,
  payloadStore: new MemoryProtectedPayloadStore(),
  keys: new DeterministicTestKeyProvider(),
  defaultPolicy: DEFAULT_CAPTURE_POLICY,
});

const durable = await startDurableGraphRun(
  graphDocument,
  { question: corpus.question },
  {
    runId: RUN_ID,
    implementationId: "research-diamond-mock@1",
    protection: guard,
    nodeExecutors: durableExecutors.nodeExecutors,
    concurrency: 3,
  },
);
assert.equal(durable.status, "succeeded");
assert.deepEqual(durable.output, expectedRun.output);
assert.equal(durableExecutors.dispatches(), 3);

const committed = [];
for await (const event of journal.read(RUN_ID)) {
  committed.push([event.sequence, event.type, event.nodeId ?? null]);
}
assert.deepEqual(committed, expectedEvents.nominal, "durable event sequence drifted from fixture");

// ---------------------------------------------------------------------------
// 4. Parallelism versus barrier wait, rendered from the committed event order
// ---------------------------------------------------------------------------

const trace = renderTrace(committed);

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.pattern-bundle-run/v1alpha1",
    lane: "typescript",
    graphHash,
    constructorParity: { json: true, yaml: true },
    parallelRun: {
      status: runResult.status,
      maxObservedConcurrency: runResult.maxObservedConcurrency,
      totalAttempts: runResult.totalAttempts,
      mockDispatches: parallel.dispatches(),
    },
    durableRun: {
      status: durable.status,
      committedEvents: committed.length,
      matchesFixture: true,
      mockDispatches: durableExecutors.dispatches(),
    },
    report: runResult.output.report,
    trace,
  },
  null,
  2,
)}\n`);
