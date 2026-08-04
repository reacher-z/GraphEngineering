/**
 * The shared, side-effect-free half of the TypeScript lane of the bundle.
 *
 * `run.mjs` and `resume.mjs` both import from here so that "what the graph
 * does" is defined exactly once. Everything in this file is a pure function of
 * the committed fixtures; nothing reads a clock, a network or an environment
 * variable. Every claim, citation, contradiction and verdict below came out
 * of `fixtures/sources.json`, and every claim id is recomputed from the exact
 * claim text through the pattern package's `claimId` — the same rule the
 * Python lane applies through `claim_id`.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { claimId } from "../../../packages/patterns/dist/src/index.js";

export const RUN_ID = "cited-research-bundle-001";
export const SOURCE_KEYS = ["changelog", "docs", "interviews"];
export const SKEPTIC_SLOTS = 3;

const ROLES = {
  changelog: "release history and changelog entries",
  docs: "reference documentation and manifests",
  interviews: "practitioner interview notes",
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
 * The scope step. It decomposes the question into one independent, bounded
 * source job per declared source and fixes the static claim-slot count. It is
 * a pure function: the same question always produces the same jobs, which is
 * what makes the whole run replayable.
 */
export function buildScope(input) {
  const { question } = input;
  assert.equal(typeof question, "string");
  return {
    question,
    claimSlots: SKEPTIC_SLOTS,
    jobs: Object.fromEntries(
      SOURCE_KEYS.map((key) => [key, { sourceKey: key, role: ROLES[key], question }]),
    ),
  };
}

/**
 * The first fan-in barrier body: extract claims and give each one its stable
 * identity. Deterministic and total — for a given barrier input there is
 * exactly one claims record.
 *
 * Three rules, in order:
 *
 *   1. A claim's identity is `claimId(text)` — the first 12 hex characters of
 *      SHA-256 over the exact claim text. Two sources proposing the same text
 *      propose the same claim; their citations are merged, never
 *      double-counted as two claims.
 *   2. Claims are ordered by claim id, and only claims carrying at least one
 *      citation are assigned to the fixed skeptic slots, in that order. An
 *      uncited claim holds no slot — it is dead on arrival at the coverage
 *      gate and adversarial review is not spent on it — but it is *kept*, and
 *      travels to the adjudicator on the direct `claims` port.
 *   3. More cited claims than slots is a loud failure, not a truncation. The
 *      slot count is static because dynamic per-claim fan-out needs the
 *      `dynamic-graph-patch` capability, which the runtimes refuse.
 */
export function extractClaims(barrierInput) {
  const sources = Object.keys(barrierInput).sort();
  const first = barrierInput[sources[0]];
  const { question } = first;
  const byClaim = new Map();
  const sourceItems = {};

  for (const source of sources) {
    const record = barrierInput[source];
    assert.equal(record.question, question, "every source must echo the same question");
    sourceItems[source] = Object.fromEntries(
      record.items.map((item) => [item.itemId, { title: item.title, link: item.link }]),
    );
    for (const claim of record.claims) {
      const id = claimId(claim.text);
      const entry = byClaim.get(id) ?? { claimId: id, text: claim.text, citations: [], proposedBy: [] };
      assert.equal(entry.text, claim.text, "one claim id must never carry two texts");
      entry.proposedBy.push(source);
      for (const itemId of claim.citations) {
        entry.citations.push({ source, itemId });
      }
      byClaim.set(id, entry);
    }
  }

  const claims = [...byClaim.keys()].sort().map((id) => byClaim.get(id));
  const cited = claims.filter((claim) => claim.citations.length > 0);
  assert.ok(
    cited.length <= SKEPTIC_SLOTS,
    `${cited.length} cited claims exceed the ${SKEPTIC_SLOTS} static skeptic slots`,
  );
  const slotAssignments = {};
  cited.forEach((claim, index) => {
    claim.slot = index + 1;
    slotAssignments[String(index + 1)] = claim.claimId;
  });
  for (const claim of claims) {
    if (claim.slot === undefined) claim.slot = null;
  }

  return {
    question,
    claimSlots: SKEPTIC_SLOTS,
    claims,
    slotAssignments,
    sourceItems,
    uncitedClaimIds: claims.filter((claim) => claim.slot === null).map((claim) => claim.claimId),
  };
}

/**
 * The adjudication barrier body: verdicts, the citation-coverage gate, and
 * the exportable evidence table. Deterministic and total.
 *
 * Verdict rules, in order, per claim (claims arrive sorted by claim id):
 *
 *   1. **Citation-coverage gate.** Every citation is resolved against the
 *      source items the claims barrier catalogued. A claim with no resolvable
 *      citation is `rejected` with reason `citation-coverage: cites no source
 *      item` — recorded in the evidence table, never silently dropped.
 *   2. **Contradiction wins.** If the claim's skeptic reports `contradicted`,
 *      the verdict is `contradicted` and the counter-evidence — itself
 *      resolved against the source catalogue — stays in the table.
 *   3. **Corroboration.** Citations from two or more distinct sources with no
 *      contradiction: `supported`.
 *   4. Otherwise: `insufficient-evidence` — a single-source claim is kept but
 *      not accepted.
 *
 * The adjudicator also cross-checks every skeptic review: the reported slot,
 * the reported claim id, and `claimId(reported claim text)` must all agree
 * with the slot assignment the claims barrier committed. A skeptic reviewing
 * the wrong claim is a loud failure.
 */
export function adjudicate(input) {
  const claimsRecord = input.claims;
  const reviews = {};
  for (let slot = 1; slot <= claimsRecord.claimSlots; slot += 1) {
    const review = input[`skeptic-${slot}`];
    assert.equal(review.slot, slot, "a skeptic must report its own slot");
    assert.equal(
      review.claimId,
      claimsRecord.slotAssignments[String(slot)],
      "a skeptic must review the claim assigned to its slot",
    );
    assert.equal(
      claimId(review.claimText),
      review.claimId,
      "a skeptic's claim text must hash to the claim id it reviewed",
    );
    reviews[slot] = review;
  }

  const resolveItem = (reference) => {
    const item = claimsRecord.sourceItems[reference.source]?.[reference.itemId];
    return item === undefined
      ? null
      : { source: reference.source, itemId: reference.itemId, title: item.title, link: item.link };
  };

  const evidenceTable = [];
  const verdicts = { supported: [], contradicted: [], insufficientEvidence: [], rejected: [] };
  for (const claim of claimsRecord.claims) {
    const citations = claim.citations
      .map((reference) => resolveItem(reference))
      .filter((citation) => citation !== null);
    const distinctSources = [...new Set(citations.map((citation) => citation.source))].sort();
    const review = claim.slot === null ? null : reviews[claim.slot];
    let verdict;
    let accepted;
    let reason;
    if (citations.length === 0) {
      verdict = "rejected";
      accepted = false;
      reason = "citation-coverage: cites no source item";
    } else if (review !== null && review.finding === "contradicted") {
      verdict = "contradicted";
      accepted = false;
      reason = "skeptic presented counter-evidence";
    } else if (distinctSources.length >= 2) {
      verdict = "supported";
      accepted = true;
      reason = `corroborated by ${distinctSources.length} independent sources with no contradiction`;
    } else {
      verdict = "insufficient-evidence";
      accepted = false;
      reason = "single-source claim without independent corroboration";
    }
    let skeptic = null;
    if (review !== null) {
      let counterEvidence = null;
      if (review.counterEvidence !== null) {
        counterEvidence = resolveItem(review.counterEvidence);
        assert.ok(counterEvidence !== null, "counter-evidence must resolve to a source item");
        counterEvidence = { ...counterEvidence, note: review.counterEvidence.note };
      }
      skeptic = { slot: review.slot, finding: review.finding, counterEvidence };
    }
    evidenceTable.push({
      claimId: claim.claimId,
      text: claim.text,
      proposedBy: [...claim.proposedBy].sort(),
      citations,
      distinctSources,
      skeptic,
      verdict,
      accepted,
      reason,
    });
    if (verdict === "supported") verdicts.supported.push(claim.claimId);
    else if (verdict === "contradicted") verdicts.contradicted.push(claim.claimId);
    else if (verdict === "insufficient-evidence") verdicts.insufficientEvidence.push(claim.claimId);
    else verdicts.rejected.push(claim.claimId);
  }

  return {
    question: claimsRecord.question,
    generatedFrom: "committed fixture corpus; no provider was contacted and no clock was read",
    evidenceTable,
    verdicts,
    citationCoverage: {
      requiredCitationsPerClaim: 1,
      claimsTotal: claimsRecord.claims.length,
      claimsCited: claimsRecord.claims.length - verdicts.rejected.length,
      claimsRejectedForNoCitation: verdicts.rejected,
    },
    slotAssignments: claimsRecord.slotAssignments,
  };
}

/**
 * Build the node executors. Each source and each skeptic dispatches through
 * its own deterministic mock adapter, scripted from the committed corpus.
 *
 * `scripts` optionally replaces one source's script — that is how the
 * injected failure in `resume.mjs` is introduced without a second copy of
 * this wiring.
 */
export function buildExecutors(options) {
  const {
    corpus,
    descriptor,
    createMockAdapter,
    createAdapterExecutor,
    scripts = {},
    arriveSource,
    arriveSkeptic,
    onDispatch,
  } = options;

  let dispatches = 0;
  const adapters = {};
  const nodeExecutors = {
    scope: ({ input }) => buildScope(input),
    claims: ({ input }) => extractClaims(input),
    adjudicate: ({ input }) => adjudicate(input),
  };

  const wire = (nodeId, requestId, adapter, arrive) => {
    const dispatch = createAdapterExecutor({
      adapter,
      // The preflight view of a request never carries prompt text: a refusal
      // must not be able to quote a payload.
      request: (input) => ({
        requestId,
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
    nodeExecutors[nodeId] = async (context) => {
      dispatches += 1;
      if (onDispatch !== undefined) onDispatch(nodeId, context.attempt);
      const value = await dispatch(context);
      if (arrive !== undefined) await arrive(nodeId);
      return value;
    };
  };

  for (const key of SOURCE_KEYS) {
    const record = corpus.sources[key];
    const adapter = createMockAdapter({
      descriptor: { ...descriptor, adapterId: `${descriptor.adapterId}-${key}` },
      script: scripts[key] ?? [
        {
          text: `source ${key} proposed ${record.claims.length} claims`,
          // The source echoes the question it answered, so the barrier never
          // has to be told out of band what the research was.
          structuredOutput: {
            sourceKey: key,
            role: record.role,
            question: corpus.question,
            items: record.items,
            claims: record.claims,
          },
        },
      ],
    });
    adapters[key] = adapter;
    wire(`source-${key}`, `research-${key}`, adapter, arriveSource);
  }

  for (let slot = 1; slot <= SKEPTIC_SLOTS; slot += 1) {
    const entry = corpus.skeptics[String(slot)];
    const adapter = createMockAdapter({
      descriptor: { ...descriptor, adapterId: `${descriptor.adapterId}-skeptic-${slot}` },
      script: [
        {
          text: `skeptic ${slot} adversarially reviewed claim ${claimId(entry.claimText)}`,
          structuredOutput: {
            slot,
            claimId: claimId(entry.claimText),
            claimText: entry.claimText,
            finding: entry.finding,
            counterEvidence: entry.counterEvidence,
          },
        },
      ],
    });
    adapters[`skeptic-${slot}`] = adapter;
    wire(`skeptic-${slot}`, `skeptic-${slot}`, adapter, arriveSkeptic);
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
      assert.equal(releasedEarly, false, "the parallel lanes did not overlap");
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
      tenantScopeId: "cited-research-tenant",
      authorityProviderId: "cited-research-provider",
      authoritySubjectId: "cited-research-subject",
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
 * waiting, so the overlapping source lanes, the overlapping skeptic lanes and
 * both barriers' waits are visible as shape.
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
