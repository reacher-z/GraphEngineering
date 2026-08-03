import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

it("passes the isolated NP1 strong-retention and release GC probe", () => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    "--expose-gc",
    vitest,
    "run",
    "test/probes/cursor-publication-native-projection-gc.probe.test.ts",
    "--pool=threads",
    "--maxWorkers=1",
    "--fileParallelism=false",
    "--reporter=dot",
  ], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GRAPH_ENGINEERING_RUN_NP1_EXPOSE_GC_PROBE: "1",
    },
    timeout: 150_000,
  });
  expect(result.error, `NP1 GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
  expect(result.signal, `NP1 GC probe terminated: ${result.stderr}`).toBeNull();
  expect(result.status, `NP1 GC probe failed:\n${result.stdout}\n${result.stderr}`).toBe(0);
}, 160_000);
