/**
 * Pattern 10 — the scheduled ecosystem scan, in honest reduced form.
 *
 * This is a *composition* over {@link diamond} plus one appended tail node,
 * not a new topology family. One inventory node enumerates a versioned source
 * inventory, every fetch job runs in parallel, one all-success barrier is the
 * only place cross-source normalization and deduplication happen, and one
 * final transform performs the global ranking and renders the digest. The
 * barrier exists only for the global comparison — per-source work never waits
 * on another source.
 *
 * What the constructor decides (so a caller cannot make two bundles that
 * differ only by accident):
 *
 * - node identity — `inventory`, `fetch-<key>`, `normalize`, `digest`;
 * - source ordering — keys are normalized by Unicode code point by `diamond`;
 * - fan-in — one normalize input port per source key, never a positional
 *   array;
 * - retry headroom — each fetch declares `retry.maxAttempts`, which is also
 *   what makes an interrupted fetch resumable rather than in-doubt;
 * - concurrency and attempt policy derived from the source count.
 *
 * What the constructor does **not** do, on purpose:
 *
 * - it declares no schedule. The master-plan Pattern 10 is *scheduled*; no
 *   scheduler, schedule identity or overlap lease exists in this repository,
 *   so the graph carries none. Every run of this graph is started explicitly
 *   by a caller.
 * - it declares no budget, no permission, no network policy and no isolation,
 *   because no runtime in this repository enforces any of those. Declaring
 *   them here would produce a graph that reads as governed and executes as
 *   ungoverned. The bundle manifest states them as documented intent instead
 *   — see `examples/patterns/ecosystem-scan/manifest.json`.
 * - the `normalize` barrier is the static all-success `{"condition": "all"}`
 *   join, not an integrated barrier policy. A permanently failed source means
 *   no digest at all, not a partial digest.
 */

import { compileGraph, type GraphSpec, type JsonSchema, type NodeSpec } from "@graph-engineering/core";
import { PatternInputError } from "./errors.js";
import { MAX_PATTERN_ITEMS, deepFreeze, edgeId, safeKey } from "./internal.js";
import { diamond } from "./patterns.js";
import type { KeyedNode, PatternGraph } from "./types.js";

/** One independent, bounded fetch job against a declared feed. */
export interface ScanSource {
  /** Stable source key. Names the node suffix and the normalize input port. */
  readonly key: string;
  /**
   * Opaque feed identifier this source is responsible for. Nothing in this
   * repository dereferences it; it is inventory data, not a network target.
   */
  readonly feed: string;
}

export interface EcosystemScanOptions {
  /** Graph metadata name; must match `^[a-z][a-z0-9-]{0,62}$`. */
  readonly name?: string;
  /** Graph metadata version. Defaults to `1.0.0`. */
  readonly version?: string;
  /**
   * Version label of the source inventory itself. Data, never a clock: two
   * runs against the same inventory version and the same fixtures produce the
   * same digest. Defaults to `1`.
   */
  readonly inventoryVersion?: string;
  /** At least one source; keys must be unique. */
  readonly sources: readonly ScanSource[];
  /**
   * Attempts allowed per fetch, 1..8. Defaults to 2. A value above 1 is what
   * lets a durable resume re-drive a fetch whose attempt was interrupted;
   * with 1 an interrupted fetch settles as failed instead.
   */
  readonly maxAttemptsPerFetch?: number;
}

const OBJECT_SCHEMA: JsonSchema = { type: "object" };
const MAX_ATTEMPTS_CEILING = 8;
const DESCRIPTION =
  "Enumerate a versioned source inventory, fetch in parallel, normalize at one barrier, then rank one digest";

function fetchNode(source: ScanSource, maxAttempts: number): NodeSpec {
  return {
    id: `fetch-${source.key}`,
    kind: "agent",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    config: { feed: source.feed, sourceKey: source.key },
    retry: { maxAttempts },
    sideEffects: "none",
  };
}

function parseSources(value: unknown): readonly ScanSource[] {
  if (!Array.isArray(value)) {
    throw new PatternInputError("GE_PATTERN_INVALID_INPUT", "expected an array", "#/sources");
  }
  if (value.length === 0) {
    throw new PatternInputError(
      "GE_PATTERN_EMPTY_COLLECTION",
      "at least one source is required",
      "#/sources",
    );
  }
  if (value.length > MAX_PATTERN_ITEMS) {
    throw new PatternInputError(
      "GE_PATTERN_TOO_MANY_ITEMS",
      `at most ${MAX_PATTERN_ITEMS} sources are allowed`,
      "#/sources",
    );
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const path = `#/sources/${index}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new PatternInputError("GE_PATTERN_INVALID_INPUT", "expected an object", path);
    }
    const entry = item as Record<string, unknown>;
    for (const key of Object.keys(entry)) {
      if (key !== "key" && key !== "feed") {
        throw new PatternInputError(
          "GE_PATTERN_UNKNOWN_FIELD",
          `unknown source field '${key}'`,
          `${path}/${key}`,
        );
      }
    }
    const key = safeKey(entry.key, `${path}/key`, "source key");
    // Caught here rather than inside `diamond`, so the reported pointer names
    // the caller's own `sources` array instead of the internal worker list.
    if (seen.has(key)) {
      throw new PatternInputError(
        "GE_PATTERN_DUPLICATE_KEY",
        `duplicate source key '${key}'`,
        `${path}/key`,
      );
    }
    seen.add(key);
    if (typeof entry.feed !== "string" || entry.feed.length === 0) {
      throw new PatternInputError(
        "GE_PATTERN_INVALID_INPUT",
        "source feed must be a non-empty string",
        `${path}/feed`,
      );
    }
    return { key, feed: entry.feed };
  });
}

/**
 * Build the Pattern 10 ecosystem scan, reduced form.
 *
 * ```text
 *                     ┌── fetch-a ──┐
 *   inventory ────────┼── fetch-b ──┼──► normalize ──► digest
 *                     └── fetch-c ──┘
 * ```
 *
 * The diamond core (`inventory` → `fetch-*` → `normalize`) is built by the
 * {@link diamond} constructor and then extended with the `digest` tail; the
 * extended graph is re-verified by the canonical core compiler before it is
 * frozen and returned. Duplicate source keys, an empty source list, an
 * unknown field and an out-of-range attempt bound are all rejected before a
 * graph exists.
 */
export function ecosystemScan(options: EcosystemScanOptions): PatternGraph {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new PatternInputError("GE_PATTERN_INVALID_INPUT", "expected an object", "#");
  }
  const record = options as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["name", "version", "inventoryVersion", "sources", "maxAttemptsPerFetch"].includes(key)) {
      throw new PatternInputError(
        "GE_PATTERN_UNKNOWN_FIELD",
        `unknown pattern option '${key}'`,
        `#/${key}`,
      );
    }
  }

  const attempts = record.maxAttemptsPerFetch ?? 2;
  if (
    typeof attempts !== "number" ||
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > MAX_ATTEMPTS_CEILING
  ) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_INPUT",
      `maxAttemptsPerFetch must be an integer from 1 through ${MAX_ATTEMPTS_CEILING}`,
      "#/maxAttemptsPerFetch",
    );
  }

  const inventoryVersion = record.inventoryVersion ?? "1";
  if (typeof inventoryVersion !== "string" || inventoryVersion.length === 0) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_INPUT",
      "inventoryVersion must be a non-empty string",
      "#/inventoryVersion",
    );
  }

  const sources = parseSources(record.sources);
  const workers: KeyedNode[] = sources.map((source) => ({
    key: source.key,
    node: fetchNode(source, attempts),
  }));

  const core = diamond({
    metadata: {
      name: typeof record.name === "string" ? record.name : "ecosystem-scan",
      version: typeof record.version === "string" ? record.version : "1.0.0",
      description: DESCRIPTION,
    },
    split: {
      id: "inventory",
      kind: "transform",
      inputSchema: OBJECT_SCHEMA,
      outputSchema: OBJECT_SCHEMA,
      config: {
        inventoryVersion,
        operation: "inventory",
        sources: [...sources.map((source) => source.key)].sort(),
      },
      sideEffects: "none",
    },
    workers,
    merge: {
      id: "normalize",
      kind: "barrier",
      inputSchema: OBJECT_SCHEMA,
      outputSchema: OBJECT_SCHEMA,
      config: { condition: "all" },
      sideEffects: "none",
    },
    // Replaced below: the graph's real named output is the digest tail.
    outputKey: "normalized",
    policies: {
      maxConcurrency: sources.length,
      maxFanOut: sources.length,
      maxDepth: 4,
      // One inventory attempt, `attempts` per fetch, one normalize attempt,
      // one digest attempt.
      maxTotalAttempts: 3 + sources.length * attempts,
    },
  });

  // Append the digest tail to the verified diamond core. The clone is plain
  // portable JSON — `diamond` returned a frozen graph of exactly that — and
  // the extended document goes through the canonical core compiler again
  // before anything escapes.
  const extended = JSON.parse(JSON.stringify(core)) as GraphSpec;
  extended.nodes = [
    ...extended.nodes,
    {
      id: "digest",
      kind: "transform",
      inputSchema: OBJECT_SCHEMA,
      outputSchema: OBJECT_SCHEMA,
      config: { operation: "rank-digest" },
      sideEffects: "none",
    },
  ];
  extended.edges = [
    ...extended.edges,
    {
      id: edgeId("diamond", sources.length * 2 + 1),
      from: { node: "normalize" },
      to: { node: "digest" },
      mode: "value",
    },
  ];
  extended.outputs = { digest: { node: "digest" } };

  const compilation = compileGraph(extended);
  if (!compilation.valid) {
    const details = compilation.diagnostics
      .map((item) => `${item.code}: ${item.message}`)
      .join("; ");
    throw new PatternInputError(
      "GE_PATTERN_CORE_REJECTED",
      `canonical core rejected constructed graph (${details || "unknown diagnostic"})`,
      "#",
    );
  }
  return deepFreeze(extended);
}
