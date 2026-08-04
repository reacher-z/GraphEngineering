import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { canonicalHash, compileGraph } from "@graph-engineering/core";
import { ecosystemScan } from "../src/index.js";
import { expectPatternError } from "./fixtures.js";

/**
 * These tests are compiled to `dist/test`, so the bundle directory is found by
 * walking up rather than by a fixed number of `..` segments.
 */
function findBundleRoot(): string {
  let directory = import.meta.dirname;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(directory, "examples/patterns/ecosystem-scan");
    if (existsSync(candidate)) return candidate;
    directory = resolve(directory, "..");
  }
  throw new Error("examples/patterns/ecosystem-scan was not found above this test");
}

const bundleRoot = findBundleRoot();

const SOURCES = [
  { key: "advisories", feed: "advisories://example.invalid/security" },
  { key: "registry", feed: "registry://example.invalid/packages" },
  { key: "releases", feed: "releases://example.invalid/graph-engineering" },
];

async function bundleJson(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(bundleRoot, name), "utf8")) as unknown;
}

test("ecosystemScan builds inventory, parallel fetches, one barrier, and a digest tail", () => {
  const graph = ecosystemScan({ sources: SOURCES });
  const compilation = compileGraph(graph);
  assert.equal(compilation.valid, true);
  assert.deepEqual(compilation.topologicalLayers, [
    ["inventory"],
    ["fetch-advisories", "fetch-registry", "fetch-releases"],
    ["normalize"],
    ["digest"],
  ]);
  assert.deepEqual(graph.entrypoints, ["inventory"]);
  assert.deepEqual(graph.outputs, { digest: { node: "digest" } });
  assert.equal(graph.nodes.find((node) => node.id === "normalize")?.kind, "barrier");
  assert.deepEqual(graph.nodes.find((node) => node.id === "normalize")?.config, {
    condition: "all",
  });
  assert.equal(graph.nodes.find((node) => node.id === "digest")?.kind, "transform");
});

test("every fetch result reaches a unique normalize port named by its key", () => {
  const graph = ecosystemScan({ sources: SOURCES });
  const incoming = graph.edges.filter((edge) => edge.to.node === "normalize");
  assert.deepEqual(
    incoming.map((edge) => edge.to.port),
    ["advisories", "registry", "releases"],
  );
  assert.equal(new Set(incoming.map((edge) => edge.to.port)).size, incoming.length);
  // The barrier feeds the digest through exactly one un-ported edge.
  const tail = graph.edges.filter((edge) => edge.to.node === "digest");
  assert.equal(tail.length, 1);
  assert.deepEqual(tail[0]?.from, { node: "normalize" });
});

test("source order never changes the graph", () => {
  const forward = ecosystemScan({ sources: SOURCES });
  const reversed = ecosystemScan({ sources: [...SOURCES].reverse() });
  assert.deepEqual(forward, reversed);
  assert.equal(canonicalHash(forward), canonicalHash(reversed));
});

test("each fetch declares the retry headroom a resume needs", () => {
  const graph = ecosystemScan({ sources: SOURCES, maxAttemptsPerFetch: 3 });
  for (const key of ["advisories", "registry", "releases"]) {
    const node = graph.nodes.find((item) => item.id === `fetch-${key}`);
    assert.equal(node?.retry?.maxAttempts, 3);
    // `none` is what lets an interrupted attempt be re-driven on resume
    // instead of settling as an in-doubt side effect.
    assert.equal(node?.sideEffects, "none");
  }
  // inventory + 3 fetches * 3 attempts + normalize + digest.
  assert.equal(graph.policies?.maxTotalAttempts, 12);
  assert.equal(graph.policies?.maxConcurrency, 3);
  assert.equal(graph.policies?.maxFanOut, 3);
  assert.equal(graph.policies?.maxDepth, 4);
});

test("the returned graph is recursively frozen and rejects mutation", () => {
  const graph = ecosystemScan({ sources: SOURCES });
  assert.equal(Object.isFrozen(graph), true);
  assert.equal(Object.isFrozen(graph.nodes), true);
  assert.equal(Object.isFrozen(graph.nodes[0]), true);
  assert.throws(() => {
    (graph.nodes as unknown as { 0: { id: string } })[0].id = "mutated";
  }, TypeError);
  assert.equal(graph.nodes[0]?.id, "inventory");
});

test("invalid source collections are refused before a graph exists", () => {
  expectPatternError(
    () => ecosystemScan({ sources: [] }),
    "GE_PATTERN_EMPTY_COLLECTION",
    "#/sources",
  );
  expectPatternError(
    () =>
      ecosystemScan({
        sources: [
          { key: "registry", feed: "one" },
          { key: "registry", feed: "two" },
        ],
      }),
    "GE_PATTERN_DUPLICATE_KEY",
    "#/sources/1/key",
  );
  expectPatternError(
    () => ecosystemScan({ sources: [{ key: "registry", feed: "" }] }),
    "GE_PATTERN_INVALID_INPUT",
    "#/sources/0/feed",
  );
  expectPatternError(
    () => ecosystemScan({ sources: [{ key: "__proto__", feed: "x" }] }),
    "GE_PATTERN_INVALID_IDENTIFIER",
    "#/sources/0/key",
  );
  expectPatternError(
    () =>
      ecosystemScan({
        sources: [
          { key: "registry", feed: "x", extra: 1 } as unknown as { key: string; feed: string },
        ],
      }),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/sources/0/extra",
  );
  expectPatternError(
    () => ecosystemScan({ sources: SOURCES, maxAttemptsPerFetch: 0 }),
    "GE_PATTERN_INVALID_INPUT",
    "#/maxAttemptsPerFetch",
  );
  expectPatternError(
    () => ecosystemScan({ sources: SOURCES, inventoryVersion: "" }),
    "GE_PATTERN_INVALID_INPUT",
    "#/inventoryVersion",
  );
  expectPatternError(
    () => ecosystemScan({ sources: SOURCES, cost: 1 } as unknown as { sources: never }),
    "GE_PATTERN_UNKNOWN_FIELD",
    "#/cost",
  );
});

test("the committed bundle graph is exactly what the constructor produces", async () => {
  const committed = await bundleJson("ecosystem-scan.graph.json");
  const graph = ecosystemScan({ sources: SOURCES, inventoryVersion: "2026-01" });
  assert.deepEqual(JSON.parse(JSON.stringify(graph)), committed);
});

test("the bundle fixtures agree with the committed graph identity", async () => {
  const committed = await bundleJson("ecosystem-scan.graph.json");
  const expectedRun = (await bundleJson("fixtures/expected-run.json")) as {
    graphHash: string;
    maxObservedConcurrency: number;
    output: { digest: { entries: { rank: number; itemId: string }[] } };
  };
  assert.equal(canonicalHash(committed), expectedRun.graphHash);
  assert.equal(expectedRun.maxObservedConcurrency, 3);
  assert.deepEqual(
    expectedRun.output.digest.entries.map((entry) => entry.rank),
    [1, 2, 3],
  );
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

  // Every fetch is started before any fetch succeeds: that is fan-out, not a
  // sequence of three runs that happen to be in one journal.
  const firstSuccess = events.nominal.findIndex(
    ([, type, nodeId]) => type === "NodeSucceeded" && nodeId?.startsWith("fetch-") === true,
  );
  const started = events.nominal
    .slice(0, firstSuccess)
    .filter(([, type, nodeId]) => type === "NodeStarted" && nodeId?.startsWith("fetch-") === true);
  assert.equal(started.length, 3);

  // The digest only ever runs after the barrier has succeeded.
  const normalizeSucceeded = events.nominal.findIndex(
    ([, type, nodeId]) => type === "NodeSucceeded" && nodeId === "normalize",
  );
  const digestStarted = events.nominal.findIndex(
    ([, type, nodeId]) => type === "NodeStarted" && nodeId === "digest",
  );
  assert.ok(normalizeSucceeded >= 0 && digestStarted > normalizeSucceeded);

  // The injected failure costs a real attempt and a real retry.
  assert.ok(
    events.injectedSourceFailure.some(
      ([, type, nodeId]) => type === "NodeAttemptFailed" && nodeId === "fetch-registry",
    ),
  );
  assert.ok(
    events.injectedSourceFailure.some(
      ([, type, nodeId]) => type === "NodeRetried" && nodeId === "fetch-registry",
    ),
  );

  // The crash left `fetch-advisories` committed, and the resume never re-ran it.
  const committedBefore = events.crashResume.beforeResume
    .filter(([, type]) => type === "NodeSucceeded")
    .map(([, , nodeId]) => nodeId);
  assert.ok(committedBefore.includes("fetch-advisories"));
  assert.equal(events.crashResume.afterResume[0]?.[1], "RunResumed");
  assert.equal(
    events.crashResume.afterResume.some(([, type, nodeId]) => nodeId === "fetch-advisories"),
    false,
    "a committed fetch must not appear again after resume",
  );
  assert.equal(events.crashResume.afterResume.at(-1)?.[1], "RunSucceeded");
});
