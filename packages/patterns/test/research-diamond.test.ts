import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { canonicalHash, compileGraph } from "@graph-engineering/core";
import { researchDiamond } from "../src/index.js";
import { expectPatternError } from "./fixtures.js";

/**
 * These tests are compiled to `dist/test`, so the bundle directory is found by
 * walking up rather than by a fixed number of `..` segments.
 */
function findBundleRoot(): string {
  let directory = import.meta.dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(directory, "examples/patterns/research-diamond");
    if (existsSync(candidate)) return candidate;
    directory = resolve(directory, "..");
  }
  throw new Error("examples/patterns/research-diamond was not found above this test");
}

const bundleRoot = findBundleRoot();

const SOURCES = [
  { key: "code", role: "Find executable examples and implementation constraints" },
  { key: "docs", role: "Find primary documentation and return cited facts" },
  { key: "web", role: "Find third-party reports and dated claims" },
];

async function bundleJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(bundleRoot, name), "utf8")) as unknown;
}

test("researchDiamond builds scope, parallel sources, and one fan-in barrier", () => {
  const graph = researchDiamond({ sources: SOURCES });
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.deepEqual(compilation.topologicalLayers, [
    ["scope"],
    ["source-code", "source-docs", "source-web"],
    ["synthesize"],
  ]);
  assert.deepEqual(graph.entrypoints, ["scope"]);
  assert.deepEqual(graph.outputs, { report: { node: "synthesize" } });
  assert.equal(graph.nodes.find((node) => node.id === "synthesize")?.kind, "barrier");
});

test("every source result reaches a unique merge port named by its key", () => {
  const graph = researchDiamond({ sources: SOURCES });
  const incoming = graph.edges.filter((edge) => edge.to.node === "synthesize");
  assert.deepEqual(
    incoming.map((edge) => edge.to.port),
    ["code", "docs", "web"],
  );
  assert.equal(new Set(incoming.map((edge) => edge.to.port)).size, incoming.length);
});

test("source order never changes the graph", () => {
  const forward = researchDiamond({ sources: SOURCES });
  const reversed = researchDiamond({ sources: [...SOURCES].reverse() });
  assert.deepEqual(forward, reversed);
  assert.equal(canonicalHash(forward), canonicalHash(reversed));
});

test("each source declares the retry headroom a resume needs", () => {
  const graph = researchDiamond({ sources: SOURCES, maxAttemptsPerSource: 3 });
  for (const key of ["code", "docs", "web"]) {
    const node = graph.nodes.find((item) => item.id === `source-${key}`);
    assert.equal(node?.retry?.maxAttempts, 3);
    // `none` is what lets an interrupted attempt be re-driven on resume
    // instead of settling as an in-doubt side effect.
    assert.equal(node?.sideEffects, "none");
  }
  assert.equal(graph.policies?.maxTotalAttempts, 11);
  assert.equal(graph.policies?.maxConcurrency, 3);
  assert.equal(graph.policies?.maxFanOut, 3);
});

test("the returned graph is recursively frozen and rejects mutation", () => {
  const graph = researchDiamond({ sources: SOURCES });
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.nodes), true);
  assert.equal(Object.isFrozen(graph.nodes[0]), true);
  assert.throws(() => {
    (graph.nodes as unknown as { 0: { id: string } })[0].id = "mutated";
  }, TypeError);
  assert.equal(graph.nodes[0]?.id, "scope");
});

test("invalid source collections are refused before a graph exists", () => {
  expectPatternError(
    () => researchDiamond({ sources: [] }),
    "GE_PATTERN_EMPTY_COLLECTION",
    "#/sources",
  );
  expectPatternError(
    () =>
      researchDiamond({
        sources: [
          { key: "docs", role: "one" },
          { key: "docs", role: "two" },
        ],
      }),
    "GE_PATTERN_DUPLICATE_KEY",
    "#/sources/1/key",
  );
  expectPatternError(
    () => researchDiamond({ sources: [{ key: "docs", role: "" }] }),
    "GE_PATTERN_INVALID_INPUT",
    "#/sources/0/role",
  );
  expectPatternError(
    () => researchDiamond({ sources: [{ key: "__proto__", role: "x" }] }),
    "GE_PATTERN_INVALID_IDENTIFIER",
    "#/sources/0/key",
  );
  expectPatternError(
    () =>
      researchDiamond({
        sources: [{ key: "docs", role: "x", extra: 1 } as unknown as { key: string; role: string }],
      }),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/sources/0/extra",
  );
  expectPatternError(
    () => researchDiamond({ sources: SOURCES, maxAttemptsPerSource: 0 }),
    "GE_PATTERN_INVALID_INPUT",
    "#/maxAttemptsPerSource",
  );
  expectPatternError(
    () => researchDiamond({ sources: SOURCES, cost: 1 } as unknown as { sources: never }),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/cost",
  );
});

test("the committed bundle graph is exactly what the constructor produces", async () => {
  const committed = await bundleJson("research-diamond.graph.json");
  const graph = researchDiamond({ sources: SOURCES });
  assert.deepEqual(JSON.parse(JSON.stringify(graph)), committed);
});

test("the bundle fixtures agree with the committed graph identity", async () => {
  const committed = await bundleJson("research-diamond.graph.json");
  const expectedRun = (await bundleJson("fixtures/expected-run.json")) as {
    graphHash: string;
    maxObservedConcurrency: number;
    output: { report: { sources: string[] } };
  };
  assert.equal(canonicalHash(committed), expectedRun.graphHash);
  assert.equal(expectedRun.maxObservedConcurrency, 3);
  assert.deepEqual(expectedRun.output.report.sources, ["code", "docs", "web"]);
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

  // Every source is started before any source succeeds: that is fan-out, not
  // a sequence of three runs that happen to be in one journal.
  const firstSuccess = events.nominal.findIndex(
    ([, type, nodeId]) => type === "NodeSucceeded" && nodeId?.startsWith("source-") === true,
  );
  const started = events.nominal
    .slice(0, firstSuccess)
    .filter(([, type, nodeId]) => type === "NodeStarted" && nodeId?.startsWith("source-") === true);
  assert.equal(started.length, 3);

  // The injected failure costs a real attempt and a real retry.
  assert.ok(
    events.injectedSourceFailure.some(
      ([, type, nodeId]) => type === "NodeAttemptFailed" && nodeId === "source-web",
    ),
  );
  assert.ok(
    events.injectedSourceFailure.some(
      ([, type, nodeId]) => type === "NodeRetried" && nodeId === "source-web",
    ),
  );

  // The crash left `source-code` committed, and the resume never re-ran it.
  const committedBefore = events.crashResume.beforeResume
    .filter(([, type]) => type === "NodeSucceeded")
    .map(([, , nodeId]) => nodeId);
  assert.ok(committedBefore.includes("source-code"));
  assert.equal(events.crashResume.afterResume[0]?.[1], "RunResumed");
  assert.equal(
    events.crashResume.afterResume.some(([, type, nodeId]) => nodeId === "source-code"),
    false,
    "a committed source must not appear again after resume",
  );
  assert.equal(events.crashResume.afterResume.at(-1)?.[1], "RunSucceeded");
});
