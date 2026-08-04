import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { canonicalHash, compileGraph } from "@graph-engineering/core";
import { citedResearch, claimId } from "../src/index.js";
import { expectPatternError } from "./fixtures.js";

/**
 * These tests are compiled to `dist/test`, so the bundle directory is found by
 * walking up rather than by a fixed number of `..` segments.
 */
function findBundleRoot(): string {
  let directory = import.meta.dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(directory, "examples/patterns/cited-research");
    if (existsSync(candidate)) return candidate;
    directory = resolve(directory, "..");
  }
  throw new Error("examples/patterns/cited-research was not found above this test");
}

const bundleRoot = findBundleRoot();

const SOURCES = [
  { key: "changelog", role: "release history and changelog entries" },
  { key: "docs", role: "reference documentation and manifests" },
  { key: "interviews", role: "practitioner interview notes" },
];

async function bundleJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(bundleRoot, name), "utf8")) as unknown;
}

test("citedResearch builds scope, parallel sources, two barriers, and a static skeptic stage", () => {
  const graph = citedResearch({ sources: SOURCES });
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.deepEqual(compilation.topologicalLayers, [
    ["scope"],
    ["source-changelog", "source-docs", "source-interviews"],
    ["claims"],
    ["skeptic-1", "skeptic-2", "skeptic-3"],
    ["adjudicate"],
  ]);
  assert.deepEqual(graph.entrypoints, ["scope"]);
  assert.deepEqual(graph.outputs, { verdicts: { node: "adjudicate" } });
  for (const barrier of ["claims", "adjudicate"]) {
    const node = graph.nodes.find((item) => item.id === barrier);
    assert.equal(node?.kind, "barrier");
    assert.deepEqual(node?.config, { condition: "all" });
  }
  for (const slot of [1, 2, 3]) {
    const node = graph.nodes.find((item) => item.id === `skeptic-${slot}`);
    // `agent`, never `validator`: the validator node kind is capability-gated
    // and refused before dispatch by every runtime in this repository.
    assert.equal(node?.kind, "agent");
    assert.deepEqual(node?.config, { operation: "adversarial-review", slot });
  }
});

test("every fan-in arrives on a named port, and the adjudicator also sees the claims directly", () => {
  const graph = citedResearch({ sources: SOURCES });
  const intoClaims = graph.edges.filter((edge) => edge.to.node === "claims");
  assert.deepEqual(
    intoClaims.map((edge) => edge.to.port),
    ["changelog", "docs", "interviews"],
  );
  assert.equal(new Set(intoClaims.map((edge) => edge.to.port)).size, intoClaims.length);
  // Each skeptic receives the full claims record through one un-ported edge.
  for (const slot of [1, 2, 3]) {
    const incoming = graph.edges.filter((edge) => edge.to.node === `skeptic-${slot}`);
    assert.equal(incoming.length, 1);
    assert.deepEqual(incoming[0]?.from, { node: "claims" });
    assert.equal(incoming[0]?.to.port, undefined);
  }
  // The adjudicator is fed by every skeptic slot plus the direct claims port,
  // which is what lets the coverage gate see uncited claims that hold no slot.
  const intoAdjudicate = graph.edges.filter((edge) => edge.to.node === "adjudicate");
  assert.deepEqual(
    intoAdjudicate.map((edge) => edge.to.port),
    ["skeptic-1", "skeptic-2", "skeptic-3", "claims"],
  );
  assert.deepEqual(intoAdjudicate.at(-1)?.from, { node: "claims" });
});

test("source order never changes the graph", () => {
  const forward = citedResearch({ sources: SOURCES });
  const reversed = citedResearch({ sources: [...SOURCES].reverse() });
  assert.deepEqual(forward, reversed);
  assert.equal(canonicalHash(forward), canonicalHash(reversed));
});

test("each agent node declares the retry headroom a resume needs", () => {
  const graph = citedResearch({ sources: SOURCES, maxAttemptsPerAgent: 3 });
  for (const id of [
    "source-changelog",
    "source-docs",
    "source-interviews",
    "skeptic-1",
    "skeptic-2",
    "skeptic-3",
  ]) {
    const node = graph.nodes.find((item) => item.id === id);
    assert.equal(node?.retry?.maxAttempts, 3);
    // `none` is what lets an interrupted attempt be re-driven on resume
    // instead of settling as an in-doubt side effect.
    assert.equal(node?.sideEffects, "none");
  }
  // scope + claims + adjudicate + (3 sources + 3 skeptics) * 3 attempts.
  assert.equal(graph.policies?.maxTotalAttempts, 21);
  assert.equal(graph.policies?.maxConcurrency, 3);
  // `claims` fans out to three skeptics plus the adjudicate claims port.
  assert.equal(graph.policies?.maxFanOut, 4);
  assert.equal(graph.policies?.maxDepth, 5);
});

test("the skeptic stage is a construction-time constant, not a runtime quantity", () => {
  const wide = citedResearch({ sources: SOURCES, skepticSlots: 5 });
  assert.deepEqual(
    wide.nodes.filter((node) => node.id.startsWith("skeptic-")).map((node) => node.id),
    ["skeptic-1", "skeptic-2", "skeptic-3", "skeptic-4", "skeptic-5"],
  );
  assert.equal(wide.policies?.maxConcurrency, 5);
  assert.equal(wide.policies?.maxFanOut, 6);
  // Dynamic per-claim fan-out would need the `dynamic-graph-patch` runtime
  // capability, which every runtime in this repository refuses; the slot
  // bounds are therefore enforced here, before a graph exists.
  expectPatternError(
    () => citedResearch({ sources: SOURCES, skepticSlots: 9 }),
    "GE_PATTERN_INVALID_INPUT",
    "#/skepticSlots",
  );
});

test("the returned graph is recursively frozen and rejects mutation", () => {
  const graph = citedResearch({ sources: SOURCES });
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.nodes), true);
  assert.equal(Object.isFrozen(graph.nodes[0]), true);
  assert.throws(() => {
    (graph.nodes as unknown as { 0: { id: string } })[0].id = "mutated";
  }, TypeError);
  assert.equal(graph.nodes[0]?.id, "scope");
});

test("invalid inputs are refused before a graph exists", () => {
  expectPatternError(
    () => citedResearch({ sources: [] }),
    "GE_PATTERN_EMPTY_COLLECTION",
    "#/sources",
  );
  expectPatternError(
    () =>
      citedResearch({
        sources: [
          { key: "docs", role: "one" },
          { key: "docs", role: "two" },
        ],
      }),
    "GE_PATTERN_DUPLICATE_KEY",
    "#/sources/1/key",
  );
  expectPatternError(
    () => citedResearch({ sources: [{ key: "docs", role: "" }] }),
    "GE_PATTERN_INVALID_INPUT",
    "#/sources/0/role",
  );
  expectPatternError(
    () => citedResearch({ sources: [{ key: "__proto__", role: "x" }] }),
    "GE_PATTERN_INVALID_IDENTIFIER",
    "#/sources/0/key",
  );
  expectPatternError(
    () =>
      citedResearch({
        sources: [
          { key: "docs", role: "x", extra: 1 } as unknown as { key: string; role: string },
        ],
      }),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/sources/0/extra",
  );
  expectPatternError(
    () => citedResearch({ sources: SOURCES, maxAttemptsPerAgent: 0 }),
    "GE_PATTERN_INVALID_INPUT",
    "#/maxAttemptsPerAgent",
  );
  expectPatternError(
    () => citedResearch({ sources: SOURCES, skepticSlots: 0 }),
    "GE_PATTERN_INVALID_INPUT",
    "#/skepticSlots",
  );
  expectPatternError(
    () => citedResearch({ sources: SOURCES, skepticSlots: 1.5 }),
    "GE_PATTERN_INVALID_INPUT",
    "#/skepticSlots",
  );
  expectPatternError(
    () => citedResearch({ sources: SOURCES, cost: 1 } as unknown as { sources: never }),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/cost",
  );
  expectPatternError(
    () => citedResearch(null as unknown as { sources: never }),
    "GE_PATTERN_INVALID_INPUT",
    "#",
  );
});

test("claim ids are the pinned deterministic hash rule, and hostile inputs are refused", () => {
  // Pinned literals: the first 12 hex characters of SHA-256 over the exact
  // UTF-8 text. `python/tests/test_patterns_cited_research.py` pins the same
  // values through `claim_id`, which is the cross-language identity contract.
  assert.equal(
    claimId(
      "A resumed durable run reuses committed node results instead of re-invoking their executors.",
    ),
    "82329aad7ca5",
  );
  assert.equal(claimId("x"), "2d711642b726");
  // Same text, same id; different text, different id.
  assert.equal(claimId("x"), claimId("x"));
  assert.notEqual(claimId("x"), claimId("x "));
  assert.match(claimId("x"), /^[0-9a-f]{12}$/);
  expectPatternError(() => claimId(""), "GE_PATTERN_INVALID_INPUT", "#/text");
  expectPatternError(
    () => claimId(42 as unknown as string),
    "GE_PATTERN_INVALID_INPUT",
    "#/text",
  );
});

test("the committed bundle graph is exactly what the constructor produces", async () => {
  const committed = await bundleJson("cited-research.graph.json");
  const graph = citedResearch({ sources: SOURCES, skepticSlots: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(graph)), committed);
});

test("the bundle fixtures agree with the committed graph identity", async () => {
  const committed = await bundleJson("cited-research.graph.json");
  const expectedRun = (await bundleJson("fixtures/expected-run.json")) as {
    graphHash: string;
    maxObservedConcurrency: number;
    output: {
      verdicts: {
        evidenceTable: { claimId: string; text: string; verdict: string }[];
        verdicts: Record<string, string[]>;
        citationCoverage: { claimsRejectedForNoCitation: string[] };
      };
    };
  };
  assert.equal(canonicalHash(committed), expectedRun.graphHash);
  assert.equal(expectedRun.maxObservedConcurrency, 3);

  // The committed run really contains all four verdict cases, every table
  // row's id re-derives from its committed text, and the coverage gate really
  // rejected the uncited claim.
  const report = expectedRun.output.verdicts;
  assert.deepEqual(
    report.evidenceTable.map((row) => row.verdict).sort(),
    ["contradicted", "insufficient-evidence", "rejected", "supported"],
  );
  for (const row of report.evidenceTable) {
    assert.equal(claimId(row.text), row.claimId);
  }
  assert.deepEqual(report.verdicts.rejected, report.citationCoverage.claimsRejectedForNoCitation);
  assert.equal(report.verdicts.rejected.length, 1);
});

test("the expected-event fixtures describe a real fan-out and a real resume", async () => {
  const events = (await bundleJson("fixtures/expected-events.json")) as {
    nominal: [number, string, string | null][];
    injectedSourceFailure: [number, string, string | null][];
    crashResume: {
      beforeResume: [number, string, string | null][];
      afterResume: [number, string, string | null][];
    };
  };

  // Every source is started before any source succeeds, and every skeptic is
  // started before any skeptic succeeds: two real fan-outs, not six runs that
  // happen to share one journal.
  for (const prefix of ["source-", "skeptic-"]) {
    const firstSuccess = events.nominal.findIndex(
      ([, type, nodeId]) => type === "NodeSucceeded" && nodeId?.startsWith(prefix) === true,
    );
    const started = events.nominal
      .slice(0, firstSuccess)
      .filter(([, type, nodeId]) => type === "NodeStarted" && nodeId?.startsWith(prefix) === true);
    assert.equal(started.length, 3, `all three ${prefix} lanes must be in flight together`);
  }

  // The skeptics only ever run after the claims barrier has succeeded, and
  // the adjudicator only after every skeptic has.
  const claimsSucceeded = events.nominal.findIndex(
    ([, type, nodeId]) => type === "NodeSucceeded" && nodeId === "claims",
  );
  const firstSkepticStarted = events.nominal.findIndex(
    ([, type, nodeId]) => type === "NodeStarted" && nodeId?.startsWith("skeptic-") === true,
  );
  assert.ok(claimsSucceeded >= 0 && firstSkepticStarted > claimsSucceeded);
  const lastSkepticSucceeded = events.nominal.reduce(
    (last, [, type, nodeId], index) =>
      type === "NodeSucceeded" && nodeId?.startsWith("skeptic-") === true ? index : last,
    -1,
  );
  const adjudicateStarted = events.nominal.findIndex(
    ([, type, nodeId]) => type === "NodeStarted" && nodeId === "adjudicate",
  );
  assert.ok(lastSkepticSucceeded >= 0 && adjudicateStarted > lastSkepticSucceeded);

  // The injected failure costs a real attempt and a real retry.
  assert.ok(
    events.injectedSourceFailure.some(
      ([, type, nodeId]) => type === "NodeAttemptFailed" && nodeId === "source-docs",
    ),
  );
  assert.ok(
    events.injectedSourceFailure.some(
      ([, type, nodeId]) => type === "NodeRetried" && nodeId === "source-docs",
    ),
  );

  // The crash left `source-changelog` committed, and the resume never re-ran it.
  const committedBefore = events.crashResume.beforeResume
    .filter(([, type]) => type === "NodeSucceeded")
    .map(([, , nodeId]) => nodeId);
  assert.ok(committedBefore.includes("source-changelog"));
  assert.equal(events.crashResume.afterResume[0]?.[1], "RunResumed");
  assert.equal(
    events.crashResume.afterResume.some(([, type, nodeId]) => nodeId === "source-changelog"),
    false,
    "a committed source must not appear again after resume",
  );
  assert.equal(events.crashResume.afterResume.at(-1)?.[1], "RunSucceeded");
});
