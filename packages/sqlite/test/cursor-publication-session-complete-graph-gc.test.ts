import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("SQLite publication-session isolated complete-graph GC", () => {
  it("passes the bounded node --expose-gc probe", () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
    const probe = "test/probes/cursor-publication-session-complete-graph-gc.probe.test.ts";
    const result = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        vitest,
        "run",
        probe,
        "--pool=threads",
        "--maxWorkers=1",
        "--fileParallelism=false",
        "--reporter=dot",
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GRAPH_ENGINEERING_RUN_EXPOSE_GC_PROBE: "1",
        },
        timeout: 150_000,
      },
    );
    expect(result.error, `GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
    expect(result.signal, `GC probe was terminated: ${result.stderr}`).toBeNull();
    expect(result.status, [
      "isolated complete-graph GC probe failed",
      `stdout=${result.stdout}`,
      `stderr=${result.stderr}`,
    ].join("\n")).toBe(0);
  }, 160_000);
});
