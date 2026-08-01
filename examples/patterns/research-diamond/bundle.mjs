/**
 * The shared, side-effect-free half of the TypeScript lane of the bundle.
 *
 * `run.mjs` and `resume.mjs` both import from here so that "what the graph
 * does" is defined exactly once. Everything in this file is a pure function of
 * the committed fixtures; nothing reads a clock, a network or an environment
 * variable.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const RUN_ID = "research-diamond-bundle-001";
export const SOURCE_KEYS = ["code", "docs", "web"];

const ROLES = {
  code: "Find executable examples and implementation constraints",
  docs: "Find primary documentation and return cited facts",
  web: "Find third-party reports and dated claims",
};

/** The exact constructor input the committed bundle graph was built from. */
export function sourceOptions() {
  return SOURCE_KEYS.map((key) => ({ key, role: ROLES[key] }));
}

export function bundleFile(name) {
  return new URL(name, import.meta.url);
}

export async function readJson(name) {
  return JSON.parse(await readFile(bundleFile(name), "utf8"));
}

/**
 * The scoping step. It decomposes one question into one independent, bounded
 * job per source. It is a pure function: the same question always produces the
 * same jobs, which is what makes the whole run replayable.
 */
export function scopeQuestion(input) {
  const question = input.question;
  assert.equal(typeof question, "string");
  return {
    question,
    jobs: Object.fromEntries(
      SOURCE_KEYS.map((key) => [key, { sourceKey: key, role: ROLES[key], question }]),
    ),
  };
}

/**
 * The fan-in barrier body: flatten, verify citations, deduplicate, and detect
 * contradictions. Deterministic and total — for a given barrier input there is
 * exactly one report.
 *
 * Three rules, in order:
 *
 *   1. A claim whose `documentId` is not in the manifest of documents that same
 *      source returned is never accepted. That is the citation-laundering gate.
 *   2. Claims are keyed by `claimId`, so the same claim found by two sources is
 *      one claim with two citations, not two claims.
 *   3. If the surviving citations for one claim disagree on stance, the claim
 *      is reported as a contradiction and is not accepted. The pattern never
 *      silently picks a winner.
 */
export function synthesize(barrierInput) {
  const sources = Object.keys(barrierInput).sort();
  const unsupportedClaims = [];
  const byClaim = new Map();

  for (const source of sources) {
    const record = barrierInput[source];
    const manifest = new Map(
      record.documents.map((document) => [document.documentId, document.contentHash]),
    );
    for (const claim of record.claims) {
      const contentHash = manifest.get(claim.documentId);
      if (contentHash === undefined) {
        unsupportedClaims.push({
          claimId: claim.claimId,
          source,
          documentId: claim.documentId,
          reason: "citation-not-in-source-manifest",
        });
        continue;
      }
      const entry = byClaim.get(claim.claimId) ?? { subject: claim.subject, citations: [] };
      entry.citations.push({
        source,
        stance: claim.stance,
        text: claim.text,
        documentId: claim.documentId,
        contentHash,
        retrievedAt: record.retrievedAt,
      });
      byClaim.set(claim.claimId, entry);
    }
  }

  const acceptedClaims = [];
  const contradictions = [];
  const multiSourceClaimIds = [];
  for (const claimId of [...byClaim.keys()].sort()) {
    const entry = byClaim.get(claimId);
    const citations = [...entry.citations].sort((left, right) =>
      left.source < right.source ? -1 : left.source > right.source ? 1 : 0,
    );
    if (citations.length > 1) multiSourceClaimIds.push(claimId);
    const stances = [...new Set(citations.map((citation) => citation.stance))].sort();
    if (stances.length > 1) {
      contradictions.push({
        claimId,
        subject: entry.subject,
        stances,
        positions: citations.map((citation) => ({
          source: citation.source,
          stance: citation.stance,
          documentId: citation.documentId,
        })),
      });
      continue;
    }
    acceptedClaims.push({
      claimId,
      subject: entry.subject,
      stance: citations[0].stance,
      text: citations[0].text,
      citations: citations.map((citation) => ({
        source: citation.source,
        documentId: citation.documentId,
        contentHash: citation.contentHash,
        retrievedAt: citation.retrievedAt,
      })),
    });
  }

  return {
    question: barrierInput[sources[0]].question,
    sources,
    acceptedClaims,
    contradictions,
    unsupportedClaims,
    multiSourceClaimIds,
    coverage: { sourcesReporting: sources.length, sourcesFailed: 0 },
  };
}

/**
 * Build the node executors. Each source node dispatches through its own
 * deterministic mock adapter, scripted from the committed corpus.
 *
 * `scripts` optionally replaces one source's script — that is how the injected
 * failure in `resume.mjs` is introduced without a second copy of this wiring.
 */
export function buildExecutors(options) {
  const {
    corpus,
    descriptor,
    createMockAdapter,
    createAdapterExecutor,
    synthesize: merge,
    arrive,
    scripts = {},
    onDispatch,
  } = options;

  let dispatches = 0;
  const adapters = {};
  const nodeExecutors = {
    scope: ({ input }) => scopeQuestion(input),
    synthesize: ({ input }) => merge(input),
  };

  for (const key of SOURCE_KEYS) {
    const record = corpus.sources[key];
    const adapter = createMockAdapter({
      descriptor: { ...descriptor, adapterId: `${descriptor.adapterId}-${key}` },
      script: scripts[key] ?? [
        {
          text: `source ${key} reported ${record.claims.length} claims`,
          // The source echoes the scoped question it answered, so the barrier
          // never has to be told out of band what the run was about.
          structuredOutput: { ...record, sourceKey: key, question: corpus.question },
        },
      ],
    });
    adapters[key] = adapter;
    const dispatch = createAdapterExecutor({
      adapter,
      // The preflight view of a request never carries prompt text: a refusal
      // must not be able to quote a payload.
      request: (input) => ({
        requestId: `research-${key}`,
        sideEffectClass: "none",
        requiredCapabilities: ["structured-output", "usage-reporting"],
        requestBytes: Buffer.byteLength(JSON.stringify(input), "utf8"),
        attachments: [],
        toolDefinitions: [],
        streaming: false,
        structuredOutput: true,
        cancellable: false,
        idempotencyKey: null,
        circuitState: "closed",
        target: null,
        mcpCall: null,
        processCall: null,
      }),
    });
    nodeExecutors[`source-${key}`] = async (context) => {
      dispatches += 1;
      if (onDispatch !== undefined) onDispatch(key, context.attempt);
      const value = await dispatch(context);
      if (arrive !== undefined) await arrive(`source-${key}`);
      return value;
    };
  }

  return { nodeExecutors, adapters, dispatches: () => dispatches };
}

/**
 * A promise gate that can only be passed when every participant has arrived.
 * It uses no sleep, timestamp or timeout: if the workers are not genuinely
 * concurrent they cannot pass it, and the microtask fallback turns a serial
 * scheduler into a failed assertion rather than a hang.
 */
export function overlapGate(participants) {
  const expected = [...participants].sort();
  const arrived = [];
  let release;
  let released = false;
  let releasedEarly = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const open = () => {
    if (released) return;
    released = true;
    release();
  };

  return {
    async arrive(nodeId) {
      assert.ok(expected.includes(nodeId), `unexpected participant ${nodeId}`);
      arrived.push(nodeId);
      if (arrived.length === expected.length) open();
      else if (arrived.length === 1) {
        queueMicrotask(() => {
          if (arrived.length < expected.length) {
            releasedEarly = true;
            open();
          }
        });
      }
      await gate;
    },
    assertComplete() {
      assert.deepEqual([...arrived].sort(), expected);
      assert.equal(releasedEarly, false, "the source lanes did not overlap");
    },
  };
}

/** A fully configured in-memory protected write path. */
export function protection({ journal, payloadStore, keys, defaultPolicy }) {
  return {
    journal,
    payloadStore,
    keys,
    // Opaque tenant and authority identity. Never a personal identifier.
    scope: {
      tenantScopeId: "research-diamond-tenant",
      authorityProviderId: "research-diamond-provider",
      authoritySubjectId: "research-diamond-subject",
    },
    // The capture policy must name the key reference actually in use.
    policy: { ...defaultPolicy, keyRef: keys.keyRef },
  };
}

/**
 * Render parallelism versus barrier wait from the committed event order.
 *
 * This is an *event-order* trace, not a wall-clock one. The scale is the
 * journal sequence number, which is exactly reproducible; a duration chart
 * would not be. A lane is `=` while the node is running and `.` while it is
 * waiting, so the three overlapping source lanes and the barrier's wait are
 * visible as shape.
 */
export function renderTrace(events) {
  const lanes = new Map();
  for (const [sequence, type, nodeId] of events) {
    if (nodeId === null) continue;
    const lane = lanes.get(nodeId) ?? { start: null, end: null };
    if (type === "NodeStarted" && lane.start === null) lane.start = sequence;
    if (type === "NodeSucceeded" || type === "NodeAttemptFailed") lane.end = sequence;
    lanes.set(nodeId, lane);
  }
  const width = events.length;
  const rows = [];
  for (const [nodeId, lane] of lanes) {
    if (lane.start === null || lane.end === null) continue;
    const cells = [];
    for (let index = 0; index < width; index += 1) {
      cells.push(index >= lane.start && index <= lane.end ? "=" : ".");
    }
    rows.push({ nodeId, span: [lane.start, lane.end], lane: cells.join("") });
  }
  const overlapping = rows.filter((row) =>
    rows.some(
      (other) =>
        other !== row && other.span[0] <= row.span[1] && row.span[0] <= other.span[1],
    ),
  );
  return {
    scale: "journal sequence number, not wall clock",
    rows,
    concurrentLanes: overlapping.map((row) => row.nodeId).sort(),
  };
}
