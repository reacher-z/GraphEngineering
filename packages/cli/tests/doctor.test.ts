import assert from "node:assert/strict";
import test from "node:test";
import { runDoctor } from "../src/doctor.js";

test("doctor failures collapse into at most three deterministic remediation groups", async () => {
  const report = await runDoctor({
    nodeVersion: "18.20.0",
    readText: async () => {
      throw new Error("asset unavailable");
    },
    importCore: async () => ({}),
    importRuntime: async () => ({}),
  });

  assert.equal(report.healthy, false);
  assert.ok(report.checks.every((item) => item.status === "fail"));
  assert.deepEqual(report.remediations, [
    "Install Node.js 20 or newer and rerun graph doctor.",
    "Reinstall @graph-engineering/cli so its bundled Graph IR assets are restored.",
    "Reinstall package dependencies and rebuild @graph-engineering/core and @graph-engineering/runtime.",
  ]);
  assert.ok(report.remediations.length <= 3);
});

test("doctor probes receive only the two fixed package-owned asset URLs", async () => {
  const requested: string[] = [];
  const schema = JSON.stringify({
    properties: { apiVersion: { const: "graphengineering.reacher-z.github.io/v1alpha1" } },
  });
  const fixture = JSON.stringify({ kind: "Graph" });
  const report = await runDoctor({
    readText: async (url) => {
      requested.push(url.href);
      return url.pathname.endsWith("graph.schema.json") ? schema : fixture;
    },
    importCore: async () => ({
      compileGraph: () => ({
        valid: true,
        graphHash: "24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288",
      }),
    }),
    importRuntime: async () => ({ runGraph: () => undefined }),
  });

  assert.equal(report.healthy, true);
  assert.equal(requested.length, 2);
  assert.ok(requested.every((url) => url.startsWith("file:")));
  assert.ok(requested.some((url) => url.endsWith("/assets/spec/graph.schema.json")));
  assert.ok(requested.some((url) => url.endsWith("/assets/spec/conformance/diamond.graph.json")));
});
