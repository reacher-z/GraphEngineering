#!/usr/bin/env node

/**
 * Pattern 01 — injected failure and resume. TypeScript lane.
 *
 * Two failures are injected for real here. Neither is described; both happen.
 *
 *   A. **A source fails and is retried.** The `web` source's mock adapter is
 *      scripted to return `GE_ADAPTER_RATE_LIMITED` on its first attempt. The
 *      node declares `retry.maxAttempts = 2`, so the scheduler commits a
 *      `NodeAttemptFailed`, a `NodeRetried`, and then a successful second
 *      attempt. The run succeeds with the same report as the nominal run.
 *
 *   B. **The process is lost mid-run and the run is resumed.** A journal
 *      wrapper commits its batch and then throws, exactly once, as soon as
 *      `source-code` has a committed `NodeSucceeded`. `startDurableGraphRun`
 *      rejects with `DURABILITY_STORE_FAILED`. The run is then resumed against
 *      the same journal, with an executor for `source-code` that throws if it
 *      is ever invoked. It is not invoked: the committed source is reused, not
 *      re-fetched. The other two sources had open attempts and are re-driven.
 *
 * Both scenarios require payload protection to be configured — a durable run
 * without it fails closed before the first event and the first executor call,
 * which is also asserted below.
 *
 * Run: node examples/patterns/research-diamond/resume.mjs
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

import {
  buildExecutors,
  protection,
  readJson,
  renderTrace,
  synthesize,
} from "./bundle.mjs";

const graph = await readJson("research-diamond.graph.json");
const corpus = await readJson("fixtures/sources.json");
const descriptor = await readJson("mock-adapter.descriptor.json");
const expectedRun = await readJson("fixtures/expected-run.json");
const expectedEvents = await readJson("fixtures/expected-events.json");

const base = { corpus, descriptor, createMockAdapter, createAdapterExecutor, synthesize };

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
// A. An injected source failure, retried
// ---------------------------------------------------------------------------

const rateLimitedRunId = "research-diamond-rate-limited-001";
const webRecord = corpus.sources.web;
const attempts = [];
const injected = buildExecutors({
  ...base,
  onDispatch: (key, attempt) => attempts.push([key, attempt]),
  scripts: {
    // Attempt 1 is refused by the provider; attempt 2 returns the corpus record.
    // The last script entry repeats, so a third attempt would also succeed —
    // the node's own `retry.maxAttempts = 2` is what bounds this, not the mock.
    web: [
      { fail: "GE_ADAPTER_RATE_LIMITED" },
      {
        text: `source web reported ${webRecord.claims.length} claims`,
        structuredOutput: { ...webRecord, sourceKey: "web", question: corpus.question },
      },
    ],
  },
});
const retryJournal = new MemoryProtectedEventStore();
const retryRun = await startDurableGraphRun(
  graph,
  { question: corpus.question },
  {
    runId: rateLimitedRunId,
    implementationId: "research-diamond-mock@1",
    protection: guardFor(retryJournal),
    nodeExecutors: injected.nodeExecutors,
    concurrency: 3,
  },
);

assert.equal(retryRun.status, "succeeded");
assert.deepEqual(retryRun.output, expectedRun.output, "a retried source must not change the report");
assert.equal(injected.dispatches(), 4, "three sources, one of them dispatched twice");
assert.deepEqual(
  attempts.filter(([key]) => key === "web"),
  [
    ["web", 1],
    ["web", 2],
  ],
);
const retryEvents = await committedEvents(retryJournal, rateLimitedRunId);
assert.deepEqual(
  retryEvents,
  expectedEvents.injectedSourceFailure,
  "injected-failure event sequence drifted from fixture",
);
const webNode = retryRun.nodes.find((node) => node.nodeId === "source-web");
assert.equal(webNode.status, "succeeded");
assert.equal(webNode.attempts, 2, "the injected rate limit must have cost a real attempt");

// ---------------------------------------------------------------------------
// B. Process loss after a committed source, then resume
// ---------------------------------------------------------------------------

const resumeRunId = "research-diamond-resume-001";
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
  batch.some(([, type, nodeId]) => type === "NodeSucceeded" && nodeId === "source-code"),
);

// A durable run with no configured protection fails closed before the first
// event, the first protected payload and the first executor call.
const preflight = buildExecutors(base);
let failedClosed = null;
try {
  await startDurableGraphRun(graph, { question: corpus.question }, {
    runId: resumeRunId,
    implementationId: "research-diamond-mock@1",
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
  await startDurableGraphRun(graph, { question: corpus.question }, {
    runId: resumeRunId,
    implementationId: "research-diamond-mock@1",
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
const committedSources = new Set(
  crashHistory.filter(([, type]) => type === "NodeSucceeded").map(([, , nodeId]) => nodeId),
);
assert.ok(committedSources.has("source-code"));

// The resume uses the same journal, the same run id and the same protection.
// `source-code` is committed, so its executor must never run again — the
// executor below throws if it does.
const afterCrash = buildExecutors(base);
const resumeExecutors = {
  ...afterCrash.nodeExecutors,
  "source-code": () => {
    throw new Error("a committed source was re-fetched on resume");
  },
};
const resumed = await resumeDurableGraphRun(graph, {
  runId: resumeRunId,
  implementationId: "research-diamond-mock@1",
  protection: { ...crashGuard, journal: delegate },
  nodeExecutors: resumeExecutors,
  concurrency: 3,
});

assert.equal(resumed.status, "succeeded");
assert.deepEqual(resumed.output, expectedRun.output, "the resumed report must equal the nominal one");

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
  implementationId: "research-diamond-mock@1",
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
      injected: "GE_ADAPTER_RATE_LIMITED on attempt 1 of source-web",
      status: retryRun.status,
      mockDispatches: injected.dispatches(),
      webAttempts: attempts.filter(([key]) => key === "web").map(([, attempt]) => attempt),
      committedEvents: retryEvents.length,
      reportUnchanged: true,
    },
    crashAndResume: {
      failedClosedWithoutProtection: failedClosed,
      crashCode,
      committedBeforeResume: crashHistory.length,
      committedSourcesBeforeResume: [...committedSources].sort(),
      resumeTail: resumeTail.map(([, type, nodeId]) => (nodeId === null ? type : `${type}:${nodeId}`)),
      committedSourceReExecuted: false,
      status: resumed.status,
      terminalReplayDispatches: terminal.dispatches(),
    },
    trace: renderTrace(retryEvents),
  },
  null,
  2,
)}\n`);
