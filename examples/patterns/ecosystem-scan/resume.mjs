#!/usr/bin/env node

/**
 * Pattern 10 — injected failure and resume. TypeScript lane.
 *
 * Two failures are injected for real here. Neither is described; both happen.
 *
 *   A. **A fetch fails and is retried.** The `registry` fetch's mock adapter
 *      is scripted to return `GE_ADAPTER_RATE_LIMITED` on its first attempt.
 *      The node declares `retry.maxAttempts = 2`, so the scheduler commits a
 *      `NodeAttemptFailed`, a `NodeRetried`, and then a successful second
 *      attempt. The run succeeds with the same digest as the nominal run.
 *
 *   B. **The process is lost mid-run and the run is resumed.** A journal
 *      wrapper commits its batch and then throws, exactly once, as soon as
 *      `fetch-advisories` has a committed `NodeSucceeded`. `startDurableGraphRun`
 *      rejects with `DURABILITY_STORE_FAILED`. The run is then resumed against
 *      the same journal, with an executor for `fetch-advisories` that throws
 *      if it is ever invoked. It is not invoked: the committed fetch is
 *      reused, not re-fetched. The other two fetches had open attempts and
 *      are re-driven.
 *
 * Both scenarios require payload protection to be configured — a durable run
 * without it fails closed before the first event and the first executor call,
 * which is also asserted below.
 *
 * There is no overlap lease here: if this script were started twice against
 * one shared journal, nothing in this repository would fence the second run.
 * See the bundle manifest's `limitations.noOverlapLease`.
 *
 * Run: node examples/patterns/ecosystem-scan/resume.mjs
 */

import assert from "node:assert/strict";

import { createAdapterExecutor, createMockAdapter } from "../../../packages/adapters/dist/index.js";
import {
  DEFAULT_CAPTURE_POLICY,
  DeterministicTestKeyProvider,
  MemoryProtectedEventStore,
  MemoryProtectedPayloadStore,
} from "../../../packages/persistence/dist/index.js";
import {
  resumeDurableGraphRun,
  startDurableGraphRun,
} from "../../../packages/runtime/dist/index.js";

import { buildExecutors, protection, readJson, renderTrace } from "./bundle.mjs";

const graph = await readJson("ecosystem-scan.graph.json");
const corpus = await readJson("fixtures/sources.json");
const descriptor = await readJson("mock-adapter.descriptor.json");
const expectedRun = await readJson("fixtures/expected-run.json");
const expectedEvents = await readJson("fixtures/expected-events.json");

const base = { corpus, descriptor, createMockAdapter, createAdapterExecutor };
const graphInput = { inventoryVersion: corpus.inventoryVersion, window: corpus.window };

function guardFor(journal) {
  return protection({
    journal,
    payloadStore: new MemoryProtectedPayloadStore(),
    keys: new DeterministicTestKeyProvider(),
    defaultPolicy: DEFAULT_CAPTURE_POLICY,
  });
}

async function committedEvents(journal, runId, fromSequence = 0) {
  const rows = [];
  for await (const event of journal.read(runId, fromSequence)) {
    rows.push([event.sequence, event.type, event.nodeId ?? null]);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// A. An injected fetch failure, retried
// ---------------------------------------------------------------------------

const rateLimitedRunId = "ecosystem-scan-rate-limited-001";
const registryRecord = corpus.sources.registry;
const attempts = [];
const injected = buildExecutors({
  ...base,
  onDispatch: (key, attempt) => attempts.push([key, attempt]),
  scripts: {
    // Attempt 1 is refused by the provider; attempt 2 returns the corpus
    // record. The last script entry repeats, so a third attempt would also
    // succeed — the node's own `retry.maxAttempts = 2` is what bounds this,
    // not the mock.
    registry: [
      { fail: "GE_ADAPTER_RATE_LIMITED" },
      {
        text: `source registry reported ${registryRecord.items.length} items`,
        structuredOutput: {
          ...registryRecord,
          sourceKey: "registry",
          inventoryVersion: corpus.inventoryVersion,
          window: corpus.window,
        },
      },
    ],
  },
});
const retryJournal = new MemoryProtectedEventStore();
const retryRun = await startDurableGraphRun(graph, graphInput, {
  runId: rateLimitedRunId,
  implementationId: "ecosystem-scan-mock@1",
  protection: guardFor(retryJournal),
  nodeExecutors: injected.nodeExecutors,
  concurrency: 3,
});

assert.equal(retryRun.status, "succeeded");
assert.deepEqual(retryRun.output, expectedRun.output, "a retried fetch must not change the digest");
assert.equal(injected.dispatches(), 4, "three fetches, one of them dispatched twice");
assert.deepEqual(
  attempts.filter(([key]) => key === "registry"),
  [
    ["registry", 1],
    ["registry", 2],
  ],
);
const retryEvents = await committedEvents(retryJournal, rateLimitedRunId);
assert.deepEqual(
  retryEvents,
  expectedEvents.injectedSourceFailure,
  "injected-failure event sequence drifted from fixture",
);
const registryNode = retryRun.nodes.find((node) => node.nodeId === "fetch-registry");
assert.equal(registryNode.status, "succeeded");
assert.equal(registryNode.attempts, 2, "the injected rate limit must have cost a real attempt");

// ---------------------------------------------------------------------------
// B. Process loss after a committed fetch, then resume
// ---------------------------------------------------------------------------

const resumeRunId = "ecosystem-scan-resume-001";
const delegate = new MemoryProtectedEventStore();

/**
 * A guarded journal that commits its batch and then loses the process, once.
 * It never sees a prepared write's contents or a payload — only the closed
 * metadata of what it has already committed.
 */
class CommitThenLoseProcess {
  #delegate;
  #shouldThrow;
  threw = false;

  constructor(target, shouldThrow) {
    this.#delegate = target;
    this.#shouldThrow = shouldThrow;
  }

  get sink() {
    return this.#delegate.sink;
  }

  get binding() {
    return this.#delegate.binding;
  }

  async append(runId, expectedVersion, writes) {
    const version = await this.#delegate.append(runId, expectedVersion, writes);
    const batch = await committedEvents(this.#delegate, runId, expectedVersion + 1);
    if (!this.threw && this.#shouldThrow(batch)) {
      this.threw = true;
      throw new Error("simulated process loss after a durable commit");
    }
    return version;
  }

  read(runId, fromSequence = 0) {
    return this.#delegate.read(runId, fromSequence);
  }
}

const lossy = new CommitThenLoseProcess(delegate, (batch) =>
  batch.some(([, type, nodeId]) => type === "NodeSucceeded" && nodeId === "fetch-advisories"),
);

// A durable run with no configured protection fails closed before the first
// event, the first protected payload and the first executor call.
const preflight = buildExecutors(base);
let failedClosed = null;
try {
  await startDurableGraphRun(graph, graphInput, {
    runId: resumeRunId,
    implementationId: "ecosystem-scan-mock@1",
    protection: undefined,
    nodeExecutors: preflight.nodeExecutors,
  });
} catch (error) {
  failedClosed = error.code;
}
assert.equal(failedClosed, "PAYLOAD_PROTECTION_REQUIRED");
assert.equal(preflight.dispatches(), 0, "a run that fails closed invokes no executor");

const beforeCrash = buildExecutors(base);
const crashGuard = guardFor(lossy);
let crashCode = null;
try {
  await startDurableGraphRun(graph, graphInput, {
    runId: resumeRunId,
    implementationId: "ecosystem-scan-mock@1",
    protection: crashGuard,
    nodeExecutors: beforeCrash.nodeExecutors,
    concurrency: 3,
  });
} catch (error) {
  crashCode = error.code;
}
assert.equal(crashCode, "DURABILITY_STORE_FAILED", "the injected process loss must be real");
assert.equal(lossy.threw, true);

const crashHistory = await committedEvents(delegate, resumeRunId);
assert.deepEqual(
  crashHistory,
  expectedEvents.crashResume.beforeResume,
  "pre-crash event sequence drifted from fixture",
);
const committedFetches = new Set(
  crashHistory.filter(([, type]) => type === "NodeSucceeded").map(([, , nodeId]) => nodeId),
);
assert.ok(committedFetches.has("fetch-advisories"));

// The resume uses the same journal, the same run id and the same protection.
// `fetch-advisories` is committed, so its executor must never run again — the
// executor below throws if it does.
const afterCrash = buildExecutors(base);
const resumeExecutors = {
  ...afterCrash.nodeExecutors,
  "fetch-advisories": () => {
    throw new Error("a committed fetch was re-fetched on resume");
  },
};
const resumed = await resumeDurableGraphRun(graph, {
  runId: resumeRunId,
  implementationId: "ecosystem-scan-mock@1",
  protection: { ...crashGuard, journal: delegate },
  nodeExecutors: resumeExecutors,
  concurrency: 3,
});

assert.equal(resumed.status, "succeeded");
assert.deepEqual(resumed.output, expectedRun.output, "the resumed digest must equal the nominal one");

const resumeTail = await committedEvents(delegate, resumeRunId, crashHistory.length);
assert.deepEqual(
  resumeTail,
  expectedEvents.crashResume.afterResume,
  "resume event sequence drifted from fixture",
);
const resumedEvent = resumeTail.find(([, type]) => type === "RunResumed");
assert.ok(resumedEvent !== undefined, "resume must commit a RunResumed event");

// Resuming an already terminal run is a replay: no executor, no new event.
const terminal = buildExecutors(base);
const replay = await resumeDurableGraphRun(graph, {
  runId: resumeRunId,
  implementationId: "ecosystem-scan-mock@1",
  protection: { ...crashGuard, journal: delegate },
  nodeExecutors: terminal.nodeExecutors,
});
assert.equal(replay.status, "succeeded");
assert.deepEqual(replay.output, expectedRun.output);
assert.equal(terminal.dispatches(), 0, "a terminal resume must call no executor");
const afterReplay = await committedEvents(delegate, resumeRunId);
assert.equal(afterReplay.length, crashHistory.length + resumeTail.length);

process.stdout.write(`${JSON.stringify(
  {
    schemaVersion: "graph-engineering.pattern-bundle-recovery/v1alpha1",
    lane: "typescript",
    injectedSourceFailure: {
      injected: "GE_ADAPTER_RATE_LIMITED on attempt 1 of fetch-registry",
      status: retryRun.status,
      mockDispatches: injected.dispatches(),
      registryAttempts: attempts.filter(([key]) => key === "registry").map(([, attempt]) => attempt),
      committedEvents: retryEvents.length,
      digestUnchanged: true,
    },
    crashAndResume: {
      failedClosedWithoutProtection: failedClosed,
      crashCode,
      committedBeforeResume: crashHistory.length,
      committedFetchesBeforeResume: [...committedFetches].sort(),
      resumeTail: resumeTail.map(([, type, nodeId]) => (nodeId === null ? type : `${type}:${nodeId}`)),
      committedFetchReExecuted: false,
      status: resumed.status,
      terminalReplayDispatches: terminal.dispatches(),
    },
    trace: renderTrace(retryEvents),
  },
  null,
  2,
)}\n`);
