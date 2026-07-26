import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const packageRoot = resolve(import.meta.dirname, "../..");
const workspaceRoot = resolve(packageRoot, "../..");

test("bundled CLI assets are byte-identical to canonical repository assets", async () => {
  const pairs = [
    ["spec/graph.schema.json", "packages/cli/assets/spec/graph.schema.json"],
    [
      "spec/conformance/diamond.graph.json",
      "packages/cli/assets/spec/conformance/diamond.graph.json",
    ],
    [
      "examples/quickstart/research-diamond.graph.json",
      "packages/cli/assets/templates/quickstart/research-diamond.graph.json",
    ],
  ] as const;
  for (const [canonical, bundled] of pairs) {
    assert.deepEqual(
      await readFile(resolve(workspaceRoot, canonical)),
      await readFile(resolve(workspaceRoot, bundled)),
    );
  }
});

test("npm pack dry-run contains the executable CLI and assets but no tests", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const reports = JSON.parse(result.stdout) as Array<{
    files: Array<{ path: string; mode: number }>;
  }>;
  assert.equal(reports.length, 1);
  const files = reports[0]?.files ?? [];
  const paths = files.map((item) => item.path);
  assert.ok(paths.includes("dist/src/cli.js"));
  assert.ok(paths.includes("dist/src/visualize.js"));
  assert.ok(paths.includes("dist/src/visualize.d.ts"));
  assert.ok(paths.includes("assets/spec/graph.schema.json"));
  assert.ok(paths.includes("assets/spec/conformance/diamond.graph.json"));
  assert.ok(paths.includes("assets/templates/quickstart/research-diamond.graph.json"));
  assert.ok(paths.every((path) => !path.startsWith("dist/tests/")));
  assert.equal(files.find((item) => item.path === "dist/src/cli.js")?.mode, 0o755);
});
