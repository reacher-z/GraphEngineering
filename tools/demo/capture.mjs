#!/usr/bin/env node

/**
 * Ground-truth capture for the README demo animation.
 *
 * This script fabricates nothing. It reuses the exact helpers of the committed
 * research-diamond pattern bundle (`examples/patterns/research-diamond/`) to:
 *
 *   1. rebuild the graph from the native constructor and hash it,
 *   2. run it on the native DAG scheduler (the three sources must genuinely
 *      overlap — the bundle's overlap gate fails otherwise),
 *   3. run the same graph durably with mandatory payload protection, and
 *   4. dump the committed journal event triples [sequence, type, nodeId]
 *      plus the run results to `tools/demo/capture.json`.
 *
 * Every frame of docs/assets/demo.gif and docs/assets/demo.svg is rendered
 * from that file by tools/demo/render.py. Regenerate with:
 *
 *   node tools/demo/capture.mjs
 */

import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

import { canonicalHash } from "../../packages/core/dist/index.js";
import {
  createAdapterExecutor,
  createMockAdapter,
} from "../../packages/adapters/dist/index.js";
import { researchDiamond } from "../../packages/patterns/dist/src/index.js";
import {
  DEFAULT_CAPTURE_POLICY,
  DeterministicTestKeyProvider,
  MemoryProtectedEventStore,
  MemoryProtectedPayloadStore,
} from "../../packages/persistence/dist/index.js";
import { runGraph, startDurableGraphRun } from "../../packages/runtime/dist/index.js";

import {
  RUN_ID,
  SOURCE_KEYS,
  buildExecutors,
  overlapGate,
  protection,
  readJson,
  renderTrace,
  sourceOptions,
  synthesize,
} from "../../examples/patterns/research-diamond/bundle.mjs";

// 1. The graph and its canonical hash -------------------------------------

const graphDocument = JSON.parse(
  JSON.stringify(researchDiamond({ sources: sourceOptions() })),
);
const graphHash = canonicalHash(graphDocument);

const corpus = await readJson("fixtures/sources.json");
const descriptor = await readJson("mock-adapter.descriptor.json");

// 2. Native parallel run with the overlap gate -----------------------------

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

// 3. Durable run with mandatory payload protection -------------------------

const durableExecutors = buildExecutors({
  corpus,
  descriptor,
  createMockAdapter,
  createAdapterExecutor,
  synthesize,
});
const journal = new MemoryProtectedEventStore();
const payloadStore = new MemoryProtectedPayloadStore();
const guard = protection({
  journal,
  payloadStore,
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

// 4. The committed journal, verified plaintext-free ------------------------

const events = [];
let rawPayloadFields = 0;
for await (const event of journal.read(RUN_ID)) {
  events.push([event.sequence, event.type, event.nodeId ?? null]);
  // The question text is the only free-text input to this run. If it appears
  // anywhere in a committed event, the journal leaked plaintext.
  if (JSON.stringify(event).includes(corpus.question)) rawPayloadFields += 1;
}
assert.equal(rawPayloadFields, 0, "committed journal contains plaintext input");

const report = durable.output.report;
const capture = {
  capturedBy: "tools/demo/capture.mjs",
  source: "examples/patterns/research-diamond",
  runId: RUN_ID,
  question: corpus.question,
  graphHash,
  nodes: graphDocument.nodes.map((node) => node.id),
  edges: graphDocument.edges.map((edge) => [edge.from.node, edge.to.node]),
  parallelRun: {
    status: runResult.status,
    maxObservedConcurrency: runResult.maxObservedConcurrency,
    totalAttempts: runResult.totalAttempts,
    mockDispatches: parallel.dispatches(),
  },
  durableRun: {
    status: durable.status,
    committedEvents: events.length,
    protectedPayloadBlobs: payloadStore.size,
    plaintextLeaksInJournal: rawPayloadFields,
  },
  reportSummary: {
    acceptedClaims: report.acceptedClaims.length,
    contradictions: report.contradictions.length,
    unsupportedClaims: report.unsupportedClaims.length,
    sourcesReporting: report.coverage.sourcesReporting,
  },
  events,
  trace: renderTrace(events),
};

const outUrl = new URL("capture.json", import.meta.url);
await writeFile(outUrl, `${JSON.stringify(capture, null, 2)}\n`);
process.stdout.write(
  `captured ${events.length} events, graphHash ${graphHash.slice(0, 12)}…, ` +
    `maxObservedConcurrency ${runResult.maxObservedConcurrency}, ` +
    `protected blobs ${payloadStore.size} -> tools/demo/capture.json\n`,
);
