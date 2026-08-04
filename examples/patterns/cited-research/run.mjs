#!/usr/bin/env node

/**
 * Pattern 02 — cited deep research, reduced form. TypeScript lane, mock end
 * to end.
 *
 * Four things happen here, in order:
 *
 *   1. The bundle graph is reconstructed from the native `citedResearch`
 *      constructor and checked against both committed canonical documents
 *      (JSON and YAML). A drifted bundle fails here, not at run time.
 *   2. The graph runs on the native DAG scheduler. Each source and each
 *      skeptic dispatches through the deterministic mock adapter, scripted
 *      entirely from `fixtures/sources.json`. The three source lanes must
 *      actually overlap, and so must the three skeptic lanes.
 *   3. The same graph runs durably with payload protection configured. The
 *      committed event sequence is compared against
 *      `fixtures/expected-events.json`.
 *   4. A parallelism-versus-barrier trace is rendered from the committed
 *      event order.
 *
 * No network access, no credential, no API key, no clock reading, and no
 * real research: every claim, citation and contradiction is committed fixture
 * data. The four verdict cases the corpus carries — supported, contradicted,
 * rejected-by-the-citation-gate, insufficient-evidence — are each asserted
 * against the run's actual output, not merely described.
 *
 * Run: node examples/patterns/cited-research/run.mjs
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { canonicalHash, decodeGraphSource } from "../../../packages/core/dist/index.js";
import { createAdapterExecutor, createMockAdapter } from "../../../packages/adapters/dist/index.js";
import { citedResearch, claimId } from "../../../packages/patterns/dist/src/index.js";
import {
  DEFAULT_CAPTURE_POLICY,
  DeterministicTestKeyProvider,
  MemoryProtectedEventStore,
  MemoryProtectedPayloadStore,
} from "../../../packages/persistence/dist/index.js";
import { runGraph, startDurableGraphRun } from "../../../packages/runtime/dist/index.js";

import {
  RUN_ID,
  SKEPTIC_SLOTS,
  SOURCE_KEYS,
  buildExecutors,
  bundleFile,
  overlapGate,
  protection,
  readJson,
  renderTrace,
  sourceOptions,
} from "./bundle.mjs";

// ---------------------------------------------------------------------------
// 1. The committed bundle documents are exactly what the constructor produces
// ---------------------------------------------------------------------------

const graphDocument = await readJson("cited-research.graph.json");
const yamlText = await readFile(bundleFile("cited-research.graph.yaml"), "utf8");
const corpus = await readJson("fixtures/sources.json");
const expectedRun = await readJson("fixtures/expected-run.json");
const expectedEvents = await readJson("fixtures/expected-events.json");

const constructed = citedResearch({ sources: sourceOptions(), skepticSlots: SKEPTIC_SLOTS });
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
assert.equal(corpus.claimSlots, SKEPTIC_SLOTS);

// ---------------------------------------------------------------------------
// 2. The deterministic mock end-to-end run
// ---------------------------------------------------------------------------

const descriptor = await readJson("mock-adapter.descriptor.json");
const sourceGate = overlapGate(SOURCE_KEYS.map((key) => `source-${key}`));
const skepticGate = overlapGate(
  Array.from({ length: SKEPTIC_SLOTS }, (_, index) => `skeptic-${index + 1}`),
);
const parallel = buildExecutors({
  corpus,
  descriptor,
  createMockAdapter,
  createAdapterExecutor,
  arriveSource: sourceGate.arrive,
  arriveSkeptic: skepticGate.arrive,
});

const graphInput = { question: corpus.question };
const runResult = await runGraph(graphDocument, graphInput, {
  nodeExecutors: parallel.nodeExecutors,
  concurrency: 3,
});
sourceGate.assertComplete();
skepticGate.assertComplete();

assert.equal(runResult.status, "succeeded");
assert.equal(runResult.maxObservedConcurrency, expectedRun.maxObservedConcurrency);
assert.equal(runResult.totalAttempts, expectedRun.totalAttempts);
assert.equal(parallel.dispatches(), 6, "one mock dispatch per source and per skeptic, and no more");
assert.deepEqual(runResult.output, expectedRun.output);

// The committed output really contains the corpus's four verdict cases, and
// the claim ids in it really are the hash rule applied to the fixture texts.
const report = runResult.output.verdicts;
const idsByVerdict = Object.fromEntries(
  report.evidenceTable.map((row) => [row.verdict, row.claimId]),
);
assert.equal(report.evidenceTable.length, 4, "every claim stays in the evidence table");
for (const row of report.evidenceTable) {
  assert.equal(claimId(row.text), row.claimId, "every table row's id must re-derive from its text");
}

// supported: proposed by two sources, two distinct citations, no contradiction.
const supported = report.evidenceTable.find((row) => row.verdict === "supported");
assert.deepEqual(report.verdicts.supported, [supported.claimId]);
assert.deepEqual(supported.distinctSources, ["changelog", "docs"]);
assert.equal(supported.accepted, true);

// contradicted: the skeptic's counter-evidence is kept in the table, resolved
// against a real source item.
const contradicted = report.evidenceTable.find((row) => row.verdict === "contradicted");
assert.deepEqual(report.verdicts.contradicted, [contradicted.claimId]);
assert.equal(contradicted.accepted, false);
assert.equal(contradicted.skeptic.finding, "contradicted");
assert.equal(contradicted.skeptic.counterEvidence.source, "docs");
assert.equal(contradicted.skeptic.counterEvidence.itemId, "doc-budget");
assert.equal(typeof contradicted.skeptic.counterEvidence.title, "string");

// rejected: the citation-coverage gate actually rejected the uncited claim,
// with a recorded reason, and it held no skeptic slot.
const rejected = report.evidenceTable.find((row) => row.verdict === "rejected");
assert.deepEqual(report.verdicts.rejected, [rejected.claimId]);
assert.deepEqual(report.citationCoverage.claimsRejectedForNoCitation, [rejected.claimId]);
assert.equal(rejected.accepted, false);
assert.equal(rejected.reason, "citation-coverage: cites no source item");
assert.deepEqual(rejected.citations, []);
assert.equal(rejected.skeptic, null);

// insufficient-evidence: cited, unreviewed-without-contradiction, but single
// source.
const insufficient = report.evidenceTable.find((row) => row.verdict === "insufficient-evidence");
assert.deepEqual(report.verdicts.insufficientEvidence, [insufficient.claimId]);
assert.equal(insufficient.accepted, false);
assert.deepEqual(insufficient.distinctSources, ["changelog"]);

assert.equal(report.citationCoverage.claimsTotal, 4);
assert.equal(report.citationCoverage.claimsCited, 3);
assert.equal(Object.keys(idsByVerdict).length, 4, "all four verdict kinds are present");

// ---------------------------------------------------------------------------
// 3. The same graph, durably, with payload protection configured
// ---------------------------------------------------------------------------

const durableExecutors = buildExecutors({
  corpus,
  descriptor,
  createMockAdapter,
  createAdapterExecutor,
});
const journal = new MemoryProtectedEventStore();
const guard = protection({
  journal,
  payloadStore: new MemoryProtectedPayloadStore(),
  keys: new DeterministicTestKeyProvider(),
  defaultPolicy: DEFAULT_CAPTURE_POLICY,
});

const durable = await startDurableGraphRun(graphDocument, graphInput, {
  runId: RUN_ID,
  implementationId: "cited-research-mock@1",
  protection: guard,
  nodeExecutors: durableExecutors.nodeExecutors,
  concurrency: 3,
});
assert.equal(durable.status, "succeeded");
assert.deepEqual(durable.output, expectedRun.output);
assert.equal(durableExecutors.dispatches(), 6);

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
    verdicts: report,
    trace,
  },
  null,
  2,
)}\n`);
