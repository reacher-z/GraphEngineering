/**
 * Pattern 02 — cited deep research, in honest reduced form.
 *
 * This is a *composition* over {@link diamond} plus a statically appended
 * skeptic stage, not a new topology family. One scoping node decomposes a
 * question into independent per-source jobs, every source job runs in
 * parallel, one all-success barrier (`claims`) is the only place claims are
 * extracted and given their stable identity, a **fixed** number of skeptic
 * nodes each adversarially review one claim slot, and one final all-success
 * barrier (`adjudicate`) is the only place verdicts, the citation-coverage
 * gate and the evidence table are produced.
 *
 * What the constructor decides (so a caller cannot make two bundles that
 * differ only by accident):
 *
 * - node identity — `scope`, `source-<key>`, `claims`, `skeptic-<n>`,
 *   `adjudicate`;
 * - source ordering — keys are normalized by Unicode code point by `diamond`;
 * - fan-in — one claims input port per source key and one adjudicate input
 *   port per skeptic slot plus the `claims` port, never a positional array;
 * - claim identity — {@link claimId} is the single hash rule both language
 *   lanes and the bundle fixtures must agree on;
 * - retry headroom — each agent node declares `retry.maxAttempts`, which is
 *   also what makes an interrupted attempt resumable rather than in-doubt;
 * - concurrency and attempt policy derived from the source and slot counts.
 *
 * What the constructor does **not** do, on purpose:
 *
 * - it does not fan out per claim. The master-plan Pattern 02 spawns one
 *   skeptic per extracted claim; that is runtime graph growth, which the
 *   delivered runtimes refuse pre-dispatch (`maxDynamicNodes` requires the
 *   unimplemented `dynamic-graph-patch` capability). The skeptic stage here is
 *   a fixed slot count chosen at construction time; a run with more cited
 *   claims than slots fails loudly instead of silently truncating.
 * - the skeptics are `agent` nodes, not `validator` nodes. The `validator`
 *   node kind is capability-gated and refused before dispatch by every
 *   runtime in this repository, so declaring it would produce a graph that
 *   cannot run. Nothing here claims verifier *semantics* — the skeptics are
 *   ordinary agent dispatches whose adversarial content comes from the bundle
 *   fixtures.
 * - it declares no budget, no permission, no network policy and no isolation,
 *   because no runtime in this repository enforces any of those. The bundle
 *   manifest states them as documented intent instead — see
 *   `examples/patterns/cited-research/manifest.json`.
 * - both barriers are the static all-success `{"condition": "all"}` join, not
 *   integrated barrier policies. A permanently failed source or skeptic means
 *   no verdicts at all, not partial verdicts.
 */

import { createHash } from "node:crypto";
import { compileGraph, type GraphSpec, type JsonSchema, type NodeSpec } from "@graph-engineering/core";
import { PatternInputError } from "./errors.js";
import { MAX_PATTERN_ITEMS, deepFreeze, edgeId, safeKey } from "./internal.js";
import { diamond } from "./patterns.js";
import type { KeyedNode, PatternGraph } from "./types.js";

/** One independent, bounded source job. */
export interface CitedSource {
  /** Stable source key. Names the node suffix and the claims input port. */
  readonly key: string;
  /** The scoped question this source alone is responsible for answering. */
  readonly role: string;
}

export interface CitedResearchOptions {
  /** Graph metadata name; must match `^[a-z][a-z0-9-]{0,62}$`. */
  readonly name?: string;
  /** Graph metadata version. Defaults to `1.0.0`. */
  readonly version?: string;
  /** At least one source; keys must be unique. */
  readonly sources: readonly CitedSource[];
  /**
   * Fixed number of skeptic claim slots, 1..8. Defaults to 3. This is a
   * construction-time constant, not a runtime quantity: the graph always
   * contains exactly this many skeptic nodes, one per slot, because dynamic
   * per-claim fan-out needs the `dynamic-graph-patch` runtime capability,
   * which every runtime in this repository refuses.
   */
  readonly skepticSlots?: number;
  /**
   * Attempts allowed per agent node (sources and skeptics), 1..8. Defaults
   * to 2. A value above 1 is what lets a durable resume re-drive an attempt
   * that was interrupted; with 1 an interrupted node settles as failed.
   */
  readonly maxAttemptsPerAgent?: number;
}

const OBJECT_SCHEMA: JsonSchema = { type: "object" };
const MAX_ATTEMPTS_CEILING = 8;
const MAX_SKEPTIC_SLOTS = 8;
const CLAIM_ID_HEX_LENGTH = 12;
const DESCRIPTION =
  "Scope one question into cited source jobs, extract stable claims at one barrier, "
  + "adversarially review fixed claim slots, then adjudicate verdicts behind a citation-coverage gate";

/**
 * The stable claim identity rule: the first 12 lowercase hex characters of
 * SHA-256 over the exact UTF-8 claim text. `claim_id` in
 * `graph_engineering.patterns` computes the identical value, and the bundle
 * fixtures commit the resulting ids, so a drifted hash rule fails a fixture
 * comparison rather than silently re-keying every claim.
 *
 * The id is a function of the exact text and nothing else: a paraphrased
 * duplicate claim gets a different id. That is a documented limitation, not a
 * feature.
 */
export function claimId(text: string): string {
  if (typeof text !== "string" || text.length === 0) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_INPUT",
      "claim text must be a non-empty string",
      "#/text",
    );
  }
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, CLAIM_ID_HEX_LENGTH);
}

function sourceNode(source: CitedSource, maxAttempts: number): NodeSpec {
  return {
    id: `source-${source.key}`,
    kind: "agent",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    config: { role: source.role, sourceKey: source.key },
    retry: { maxAttempts },
    sideEffects: "none",
  };
}

function skepticNode(slot: number, maxAttempts: number): NodeSpec {
  return {
    id: `skeptic-${slot}`,
    kind: "agent",
    inputSchema: OBJECT_SCHEMA,
    outputSchema: OBJECT_SCHEMA,
    config: { operation: "adversarial-review", slot },
    retry: { maxAttempts },
    sideEffects: "none",
  };
}

function parseSources(value: unknown): readonly CitedSource[] {
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
 * Build the Pattern 02 cited deep research graph, reduced form.
 *
 * ```text
 *                ┌── source-a ──┐              ┌── skeptic-1 ──┐
 *   scope ───────┼── source-b ──┼──► claims ───┼── skeptic-2 ──┼──► adjudicate
 *                └── source-c ──┘        │     └── skeptic-3 ──┘        ▲
 *                                        └──────────── claims port ────┘
 * ```
 *
 * The diamond core (`scope` → `source-*` → `claims`) is built by the
 * {@link diamond} constructor and then extended with the static skeptic stage
 * and the `adjudicate` barrier; the extended graph is re-verified by the
 * canonical core compiler before it is frozen and returned. The `claims`
 * barrier also feeds `adjudicate` directly on the `claims` port, so the
 * adjudicator sees every claim and every source item — including uncited
 * claims that hold no skeptic slot — and the citation-coverage gate can
 * reject them with a recorded reason instead of never seeing them.
 */
export function citedResearch(options: CitedResearchOptions): PatternGraph {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new PatternInputError("GE_PATTERN_INVALID_INPUT", "expected an object", "#");
  }
  const record = options as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!["name", "version", "sources", "skepticSlots", "maxAttemptsPerAgent"].includes(key)) {
      throw new PatternInputError(
        "GE_PATTERN_UNKNOWN_FIELD",
        `unknown pattern option '${key}'`,
        `#/${key}`,
      );
    }
  }

  const attempts = record.maxAttemptsPerAgent ?? 2;
  if (
    typeof attempts !== "number" ||
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > MAX_ATTEMPTS_CEILING
  ) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_INPUT",
      `maxAttemptsPerAgent must be an integer from 1 through ${MAX_ATTEMPTS_CEILING}`,
      "#/maxAttemptsPerAgent",
    );
  }

  const slots = record.skepticSlots ?? 3;
  if (
    typeof slots !== "number" ||
    !Number.isSafeInteger(slots) ||
    slots < 1 ||
    slots > MAX_SKEPTIC_SLOTS
  ) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_INPUT",
      `skepticSlots must be an integer from 1 through ${MAX_SKEPTIC_SLOTS}`,
      "#/skepticSlots",
    );
  }

  const sources = parseSources(record.sources);
  const workers: KeyedNode[] = sources.map((source) => ({
    key: source.key,
    node: sourceNode(source, attempts),
  }));

  const core = diamond({
    metadata: {
      name: typeof record.name === "string" ? record.name : "cited-research",
      version: typeof record.version === "string" ? record.version : "1.0.0",
      description: DESCRIPTION,
    },
    split: {
      id: "scope",
      kind: "transform",
      inputSchema: OBJECT_SCHEMA,
      outputSchema: OBJECT_SCHEMA,
      config: {
        claimSlots: slots,
        operation: "scope",
        sources: [...sources.map((source) => source.key)].sort(),
      },
      sideEffects: "none",
    },
    workers,
    merge: {
      id: "claims",
      kind: "barrier",
      inputSchema: OBJECT_SCHEMA,
      outputSchema: OBJECT_SCHEMA,
      config: { condition: "all" },
      sideEffects: "none",
    },
    // Replaced below: the graph's real named output is the adjudicate tail.
    outputKey: "claims",
    policies: {
      maxConcurrency: Math.max(sources.length, slots),
      // `claims` fans out to every skeptic plus the adjudicate claims port.
      maxFanOut: Math.max(sources.length, slots + 1),
      maxDepth: 5,
      // One scope attempt, `attempts` per source and per skeptic, one claims
      // attempt, one adjudicate attempt.
      maxTotalAttempts: 3 + (sources.length + slots) * attempts,
    },
  });

  // Append the static skeptic stage and the adjudicate barrier to the
  // verified diamond core. The clone is plain portable JSON — `diamond`
  // returned a frozen graph of exactly that — and the extended document goes
  // through the canonical core compiler again before anything escapes.
  const extended = JSON.parse(JSON.stringify(core)) as GraphSpec;
  const slotNumbers = Array.from({ length: slots }, (_, index) => index + 1);
  extended.nodes = [
    ...extended.nodes,
    ...slotNumbers.map((slot) => skepticNode(slot, attempts)),
    {
      id: "adjudicate",
      kind: "barrier",
      inputSchema: OBJECT_SCHEMA,
      outputSchema: OBJECT_SCHEMA,
      config: { condition: "all" },
      sideEffects: "none",
    },
  ];
  let edgeIndex = sources.length * 2;
  extended.edges = [
    ...extended.edges,
    ...slotNumbers.map((slot) => ({
      id: edgeId("diamond", (edgeIndex += 1)),
      from: { node: "claims" },
      to: { node: `skeptic-${slot}` },
      mode: "value" as const,
    })),
    ...slotNumbers.map((slot) => ({
      id: edgeId("diamond", (edgeIndex += 1)),
      from: { node: `skeptic-${slot}` },
      to: { node: "adjudicate", port: `skeptic-${slot}` },
      mode: "value" as const,
    })),
    {
      id: edgeId("diamond", (edgeIndex += 1)),
      from: { node: "claims" },
      to: { node: "adjudicate", port: "claims" },
      mode: "value" as const,
    },
  ];
  extended.outputs = { verdicts: { node: "adjudicate" } };

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
