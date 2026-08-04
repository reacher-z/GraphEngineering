import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import * as publicApi from "../src/index.js";

const packageRoot = resolve(import.meta.dirname, "../..");

test("package marks itself side-effect free and exposes only the intended API", async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8")) as {
    sideEffects: boolean;
  };
  assert.equal(manifest.sideEffects, false);
  assert.deepEqual(Object.keys(publicApi).sort(), [
    "PatternInputError",
    "diamond",
    "ecosystemScan",
    "loopUntilDry",
    "researchDiamond",
    "routedBranches",
    "verifiedFanout",
  ]);
});

test("npm pack dry-run publishes source declarations but excludes tests", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: packageRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  const reports = JSON.parse(result.stdout) as Array<{
    files: Array<{ path: string }>;
  }>;
  assert.equal(reports.length, 1);
  const paths = reports[0]?.files.map((item) => item.path) ?? [];
  assert.ok(paths.includes("dist/src/index.js"));
  assert.ok(paths.includes("dist/src/index.d.ts"));
  assert.ok(paths.includes("README.md"));
  assert.ok(paths.every((path) => !path.startsWith("dist/test/")));
});
