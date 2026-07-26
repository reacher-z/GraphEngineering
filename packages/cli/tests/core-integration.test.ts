import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { compileGraph as compileCoreGraph, type GraphSpec } from "@graph-engineering/core";
import { planGraph } from "../src/planner.js";
import { validateGraphDocument } from "../src/validation.js";
import * as publicApi from "../src/index.js";

const fixtures = resolve(import.meta.dirname, "../../../../spec/conformance");

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(fixtures, name), "utf8")) as unknown;
}

test("CLI hash, diagnostics, and layers come directly from core", async () => {
  const graph = (await fixture("diamond.graph.json")) as GraphSpec;
  const core = compileCoreGraph(graph);
  const cli = validateGraphDocument(graph);

  assert.equal(cli.valid, core.valid);
  assert.equal(cli.canonicalSha256, core.graphHash);
  assert.equal(cli.canonicalGraph, core.canonicalGraph);
  assert.deepEqual(cli.diagnostics, core.diagnostics);
  assert.deepEqual(cli.topologicalLayers, core.topologicalLayers);
  assert.equal(cli.canonicalSha256, "24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288");
  assert.deepEqual(planGraph(graph, cli).topologicalLayers, core.topologicalLayers);
});

test("CLI public API does not re-export a compiler", () => {
  assert.equal("compileGraph" in publicApi, false);
  assert.equal("canonicalSha256" in publicApi, false);
});

for (const [name, code] of [
  ["invalid-duplicate-node.graph.json", "GE1001_DUPLICATE_NODE"],
  ["invalid-missing-endpoint.graph.json", "GE1004_MISSING_TARGET"],
  ["invalid-cycle.graph.json", "GE1005_CYCLE"],
  ["invalid-unreachable.graph.json", "GE1006_UNREACHABLE_NODE"],
] as const) {
  test(`${name} exposes the core ${code} diagnostic`, async () => {
    const graph = (await fixture(name)) as GraphSpec;
    const core = compileCoreGraph(graph);
    const cli = validateGraphDocument(graph);

    assert.deepEqual(cli.diagnostics, core.diagnostics);
    assert.deepEqual(cli.diagnosticCodes, core.diagnostics.map((item) => item.code));
    assert.deepEqual(cli.diagnosticCodes, [code]);
  });
}

test("policy diagnostics added by core pass through without CLI reimplementation", async () => {
  const graph = structuredClone((await fixture("diamond.graph.json")) as GraphSpec) as GraphSpec;
  const constrained = {
    ...graph,
    policies: { ...graph.policies, maxFanOut: 1 },
  } satisfies GraphSpec;

  const core = compileCoreGraph(constrained);
  const cli = validateGraphDocument(constrained);

  assert.ok(core.diagnostics.some((item) => item.code === "GE1101_MAX_FAN_OUT"));
  assert.deepEqual(cli.diagnostics, core.diagnostics);
  assert.ok(cli.diagnosticCodes.includes("GE1101_MAX_FAN_OUT"));
});

test("unsafe input is delegated to core without a second CLI validator", () => {
  const document = { kind: "NotAGraph" };
  const core = compileCoreGraph(document);
  const cli = validateGraphDocument(document);
  assert.equal(cli.valid, false);
  assert.equal(cli.graph, null);
  assert.equal(cli.canonicalGraph, core.canonicalGraph);
  assert.equal(cli.canonicalSha256, core.graphHash);
  assert.deepEqual(cli.diagnostics, core.diagnostics);
  assert.deepEqual(cli.diagnosticCodes, ["GE1007_INVALID_GRAPH"]);
});

test("the documented quickstart graph remains valid and parallel", async () => {
  const graph = JSON.parse(
    await readFile(
      resolve(import.meta.dirname, "../../../../examples/quickstart/research-diamond.graph.json"),
      "utf8",
    ),
  ) as GraphSpec;
  const result = validateGraphDocument(graph);
  assert.equal(result.valid, true);
  assert.deepEqual(result.topologicalLayers[1], ["research-docs", "research-code"]);
  assert.equal(planGraph(graph, result).maxParallelWidth, 2);
});
