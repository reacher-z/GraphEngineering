/**
 * Pattern 01 — the multi-source research diamond.
 *
 * This is a *composition* over {@link diamond}, not a second topology. One
 * scoping node decomposes a question into independent per-source jobs, every
 * source job runs in parallel, and a single fan-in barrier is the only place
 * cross-source comparison happens.
 *
 * What the constructor decides (so a caller cannot make two bundles that differ
 * only by accident):
 *
 * - node identity — `scope`, `source-<key>`, `synthesize`;
 * - source ordering — keys are normalized by Unicode code point by `diamond`;
 * - fan-in — one merge input port per source key, never a positional array;
 * - retry headroom — each source declares `retry.maxAttempts`, which is also
 *   what makes an interrupted source resumable rather than in-doubt;
 * - concurrency and attempt policy derived from the source count.
 *
 * What the constructor does **not** do: it declares no budget, no permission,
 * no network policy and no isolation, because no runtime in this repository
 * enforces any of those. Declaring them here would produce a graph that reads
 * as governed and executes as ungoverned. The bundle manifest states them as
 * documented intent instead — see
 * `examples/patterns/research-diamond/manifest.json`.
 */

import type { JsonSchema, NodeSpec } from "@graph-engineering/core";
import { PatternInputError } from "./errors.js";
import { MAX_PATTERN_ITEMS, safeKey } from "./internal.js";
import { diamond } from "./patterns.js";
import type { KeyedNode, PatternGraph } from "./types.js";

/** One independent, bounded source job. */
export interface ResearchSource {
  /** Stable source key. Names the node suffix and the merge input port. */
  readonly key: string;
  /** The scoped question this source alone is responsible for answering. */
  readonly role: string;
}

export interface ResearchDiamondOptions {
  /** Graph metadata name; must match `^[a-z][a-z0-9-]{0,62}$`. */
  readonly name?: string;
  /** Graph metadata version. Defaults to `1.0.0`. */
  readonly version?: string;
  /** At least one source; keys must be unique. */
  readonly sources: readonly ResearchSource[];
  /**
   * Attempts allowed per source, 1..8. Defaults to 2. A value above 1 is what
   * lets a durable resume re-drive a source whose attempt was interrupted;
   * with 1 an interrupted source settles as failed instead.
   */
  readonly maxAttemptsPerSource?: number;
}

const OBJECT_SCHEMA: JsonSchema = { type: "object" };
const MAX_ATTEMPTS_CEILING = 8;

function sourceNode(source: ResearchSource, maxAttempts: number): NodeSpec {
  return {
    id: `source-${source.key}`,
    kind: "agent",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    config: { sourceKey: source.key, role: source.role },
    retry: { maxAttempts },
    sideEffects: "none",
  };
}

function parseSources(value: unknown): readonly ResearchSource[] {
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
      if (key !== "key" && key !== "role") {
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
    if (typeof entry.role !== "string" || entry.role.length === 0) {
      throw new PatternInputError(
        "GE_PATTERN_INVALID_INPUT",
        "source role must be a non-empty string",
        `${path}/role`,
      );
    }
    return { key, role: entry.role };
  });
}

/**
 * Build the Pattern 01 research diamond.
 *
 * ```text
 *                 ┌── source-a ──┐
 *   scope ────────┼── source-b ──┼──► synthesize
 *                 └── source-c ──┘
 * ```
 *
 * Duplicate source keys, an empty source list, an unknown field and an
 * out-of-range attempt bound are all rejected before a graph exists.
 */
export function researchDiamond(options: ResearchDiamondOptions): PatternGraph {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new PatternInputError("GE_PATTERN_INVALID_INPUT", "expected an object", "#");
  }
  const record = options as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["name", "version", "sources", "maxAttemptsPerSource"].includes(key)) {
      throw new PatternInputError(
        "GE_PATTERN_UNKNOWN_FIELD",
        `unknown pattern option '${key}'`,
        `#/${key}`,
      );
    }
  }

  const attempts = record.maxAttemptsPerSource ?? 2;
  if (
    typeof attempts !== "number" ||
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > MAX_ATTEMPTS_CEILING
  ) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_INPUT",
      `maxAttemptsPerSource must be an integer from 1 through ${MAX_ATTEMPTS_CEILING}`,
      "#/maxAttemptsPerSource",
    );
  }

  const sources = parseSources(record.sources);
  const workers: KeyedNode[] = sources.map((source) => ({
    key: source.key,
    node: sourceNode(source, attempts),
  }));

  return diamond({
    metadata: {
      name: typeof record.name === "string" ? record.name : "research-diamond",
      version: typeof record.version === "string" ? record.version : "1.0.0",
      description: "Decompose one question into independent sources, then merge at one barrier",
    },
    split: {
      id: "scope",
      kind: "transform",
      inputSchema: OBJECT_SCHEMA,
      outputSchema: OBJECT_SCHEMA,
      config: {
        operation: "decompose",
        sources: [...sources.map((source) => source.key)].sort(),
      },
      sideEffects: "none",
    },
    workers,
    merge: {
      id: "synthesize",
      kind: "barrier",
      inputSchema: OBJECT_SCHEMA,
      outputSchema: OBJECT_SCHEMA,
      config: { condition: "all" },
      sideEffects: "none",
    },
    outputKey: "report",
    policies: {
      maxConcurrency: sources.length,
      maxFanOut: sources.length,
      maxDepth: 3,
      // One scope attempt, `attempts` per source, one synthesize attempt.
      maxTotalAttempts: 2 + sources.length * attempts,
    },
  });
}
