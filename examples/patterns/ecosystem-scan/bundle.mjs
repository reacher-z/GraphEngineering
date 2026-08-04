/**
 * The shared, side-effect-free half of the TypeScript lane of the bundle.
 *
 * `run.mjs` and `resume.mjs` both import from here so that "what the graph
 * does" is defined exactly once. Everything in this file is a pure function of
 * the committed fixtures; nothing reads a clock, a network or an environment
 * variable. Every date in every output below came out of
 * `fixtures/sources.json`.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const RUN_ID = "ecosystem-scan-bundle-001";
export const SOURCE_KEYS = ["advisories", "registry", "releases"];
export const INVENTORY_VERSION = "2026-01";

const FEEDS = {
  advisories: "advisories://example.invalid/security",
  registry: "registry://example.invalid/packages",
  releases: "releases://example.invalid/graph-engineering",
};

/** The exact constructor input the committed bundle graph was built from. */
export function sourceOptions() {
  return SOURCE_KEYS.map((key) => ({ key, feed: FEEDS[key] }));
}

export function bundleFile(name) {
  return new URL(name, import.meta.url);
}

export async function readJson(name) {
  return JSON.parse(await readFile(bundleFile(name), "utf8"));
}

/**
 * The inventory step. It enumerates one independent, bounded fetch job per
 * declared source. It is a pure function: the same inventory version and scan
 * window always produce the same jobs, which is what makes the whole run
 * replayable.
 */
export function buildInventory(input) {
  const { inventoryVersion, window } = input;
  assert.equal(typeof inventoryVersion, "string");
  assert.equal(typeof window.from, "string");
  assert.equal(typeof window.to, "string");
  return {
    inventoryVersion,
    window,
    jobs: Object.fromEntries(
      SOURCE_KEYS.map((key) => [key, { sourceKey: key, feed: FEEDS[key], window }]),
    ),
  };
}

/**
 * Total order over version strings: dot-separated segments, numeric when both
 * segments are all digits, code-point order otherwise, missing segments read
 * as "0". Deterministic and identical in `bundle.py`.
 */
export function compareVersions(left, right) {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftParts[index] ?? "0";
    const b = rightParts[index] ?? "0";
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
      const difference = Number(a) - Number(b);
      if (difference !== 0) return difference;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

/**
 * The fan-in barrier body: window-gate, deduplicate, and resolve version
 * disagreements. Deterministic and total — for a given barrier input there is
 * exactly one normalized record.
 *
 * Three rules, in order:
 *
 *   1. An item published outside the scan window is never kept. It is dropped
 *      with reason `published-outside-scan-window`; ISO-8601 strings compare
 *      lexicographically, so no date is ever parsed against a clock.
 *   2. Items are keyed by `itemId`, so the same item syndicated by two sources
 *      is one item with two sightings, not two items.
 *   3. If the surviving sightings for one item disagree on version, the
 *      highest version wins (`highest-version-wins`) and the disagreement is
 *      reported in `versionConflicts` — resolved, but never hidden. The
 *      canonical title, date and link come from the winning sighting; among
 *      equal versions the lowest source key wins.
 */
export function normalize(barrierInput) {
  const sources = Object.keys(barrierInput).sort();
  const first = barrierInput[sources[0]];
  const { window, inventoryVersion } = first;
  const droppedItems = [];
  const byItem = new Map();

  for (const source of sources) {
    const record = barrierInput[source];
    assert.deepEqual(record.window, window, "every fetch must echo the same scan window");
    for (const item of record.items) {
      if (item.publishedAt < window.from || item.publishedAt > window.to) {
        droppedItems.push({
          itemId: item.itemId,
          source,
          publishedAt: item.publishedAt,
          reason: "published-outside-scan-window",
        });
        continue;
      }
      const sightings = byItem.get(item.itemId) ?? [];
      sightings.push({
        source,
        title: item.title,
        version: item.version,
        publishedAt: item.publishedAt,
        link: item.link,
        retrievedAt: record.retrievedAt,
      });
      byItem.set(item.itemId, sightings);
    }
  }

  const items = [];
  const duplicateItemIds = [];
  const versionConflicts = [];
  for (const itemId of [...byItem.keys()].sort()) {
    const sightings = [...byItem.get(itemId)].sort((left, right) =>
      left.source < right.source ? -1 : left.source > right.source ? 1 : 0,
    );
    if (sightings.length > 1) duplicateItemIds.push(itemId);
    const versions = [...new Set(sightings.map((sighting) => sighting.version))].sort();
    const resolvedVersion = versions.reduce((best, candidate) =>
      compareVersions(candidate, best) > 0 ? candidate : best,
    );
    if (versions.length > 1) {
      versionConflicts.push({
        itemId,
        reported: sightings.map((sighting) => ({
          source: sighting.source,
          version: sighting.version,
          publishedAt: sighting.publishedAt,
        })),
        resolvedVersion,
        rule: "highest-version-wins",
      });
    }
    // Lowest source key among the winning-version sightings: deterministic.
    const winner = sightings.find((sighting) => sighting.version === resolvedVersion);
    items.push({
      itemId,
      title: winner.title,
      version: resolvedVersion,
      publishedAt: winner.publishedAt,
      link: winner.link,
      sources: sightings.map((sighting) => sighting.source),
      sightings: sightings.map((sighting) => ({
        source: sighting.source,
        version: sighting.version,
        publishedAt: sighting.publishedAt,
        link: sighting.link,
        retrievedAt: sighting.retrievedAt,
      })),
    });
  }

  return {
    inventoryVersion,
    window,
    sources,
    items,
    duplicateItemIds,
    versionConflicts,
    droppedItems,
    coverage: { sourcesReporting: sources.length, sourcesFailed: 0 },
  };
}

/**
 * The global ranking and digest step, downstream of the barrier. Rank is by
 * `publishedAt` descending (fixture dates, never a clock), ties broken by
 * `itemId` ascending. The digest carries the exact dates and links of every
 * entry, and passes the normalize verdicts (conflicts, drops, duplicates)
 * through unchanged.
 */
export function digest(normalized) {
  const entries = [...normalized.items]
    .sort((left, right) => {
      if (left.publishedAt !== right.publishedAt) {
        return left.publishedAt < right.publishedAt ? 1 : -1;
      }
      return left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0;
    })
    .map((item, index) => ({
      rank: index + 1,
      itemId: item.itemId,
      title: item.title,
      version: item.version,
      publishedAt: item.publishedAt,
      link: item.link,
      sources: item.sources,
    }));
  return {
    inventoryVersion: normalized.inventoryVersion,
    window: normalized.window,
    generatedFrom: "committed fixture dates; no clock was read",
    entries,
    duplicateItemIds: normalized.duplicateItemIds,
    versionConflicts: normalized.versionConflicts,
    droppedItems: normalized.droppedItems,
    coverage: normalized.coverage,
  };
}

/**
 * Build the node executors. Each fetch node dispatches through its own
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
    scripts = {},
    arrive,
    onDispatch,
  } = options;

  let dispatches = 0;
  const adapters = {};
  const nodeExecutors = {
    inventory: ({ input }) => buildInventory(input),
    normalize: ({ input }) => normalize(input),
    // A single un-ported edge binds its value under the upstream node id.
    digest: ({ input }) => digest(input.normalize),
  };

  for (const key of SOURCE_KEYS) {
    const record = corpus.sources[key];
    const adapter = createMockAdapter({
      descriptor: { ...descriptor, adapterId: `${descriptor.adapterId}-${key}` },
      script: scripts[key] ?? [
        {
          text: `source ${key} reported ${record.items.length} items`,
          // The fetch echoes the inventory version and window it answered, so
          // the barrier never has to be told out of band what the scan was.
          structuredOutput: {
            ...record,
            sourceKey: key,
            inventoryVersion: corpus.inventoryVersion,
            window: corpus.window,
          },
        },
      ],
    });
    adapters[key] = adapter;
    const dispatch = createAdapterExecutor({
      adapter,
      // The preflight view of a request never carries prompt text: a refusal
      // must not be able to quote a payload.
      request: (input) => ({
        requestId: `scan-${key}`,
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
    nodeExecutors[`fetch-${key}`] = async (context) => {
      dispatches += 1;
      if (onDispatch !== undefined) onDispatch(key, context.attempt);
      const value = await dispatch(context);
      if (arrive !== undefined) await arrive(`fetch-${key}`);
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
      assert.equal(releasedEarly, false, "the fetch lanes did not overlap");
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
      tenantScopeId: "ecosystem-scan-tenant",
      authorityProviderId: "ecosystem-scan-provider",
      authoritySubjectId: "ecosystem-scan-subject",
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
 * waiting, so the three overlapping fetch lanes and the barrier's wait are
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
