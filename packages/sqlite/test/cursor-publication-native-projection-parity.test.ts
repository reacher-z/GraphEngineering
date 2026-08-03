import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The executable validator is intentionally plain ESM and has no declaration file.
// @ts-expect-error conformance validators are JavaScript oracles
import {
  assertSQLiteNativeProjectionPortableParity,
  canonicalReportJson,
  validateSQLiteNativeProjectionReport,
} from "../../../spec/conformance/sqlite-cursor-publication-native-projection-np1.validate.mjs";

const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const typescriptReporter = join(
  repositoryRoot,
  "packages/sqlite/test/sqlite_cursor_publication_native_projection_report.mjs",
);
const pythonReporter = join(
  repositoryRoot,
  "python/tests/sqlite_cursor_publication_native_projection_report.py",
);
const uv = spawnSync("uv", ["--version"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  timeout: 10_000,
});
const pythonAvailable = existsSync(pythonReporter)
  && uv.error === undefined && uv.status === 0;
if (process.env.GRAPH_ENGINEERING_REQUIRE_NP1_CROSS_RUNTIME === "1" && !pythonAvailable) {
  throw new Error("NP1 cross-runtime parity requires uv and the Python reporter");
}
const crossRuntimeIt = pythonAvailable ? it : it.skip;

interface ReporterResult {
  readonly stdout: string;
  readonly report: Record<string, unknown>;
}

function runReporter(command: string, args: readonly string[]): ReporterResult {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 180_000,
  });
  expect(result.error, `NP1 reporter spawn failed: ${String(result.error)}`).toBeUndefined();
  expect(result.signal, `NP1 reporter terminated: ${result.stderr}`).toBeNull();
  expect(result.status, `NP1 reporter failed: ${result.stderr}`).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.endsWith("\n")).toBe(true);
  expect(result.stdout.match(/\n/gu)).toHaveLength(1);
  const report = JSON.parse(result.stdout) as Record<string, unknown>;
  expect(result.stdout).toBe(`${canonicalReportJson(report)}\n`);
  validateSQLiteNativeProjectionReport(report);
  return { report, stdout: result.stdout };
}

function runTypeScriptReporter(): ReporterResult {
  return runReporter(process.execPath, [typescriptReporter]);
}

function runPythonReporter(): ReporterResult {
  return runReporter("uv", [
    "run",
    "--project",
    "python",
    "python",
    pythonReporter,
  ]);
}

describe("SQLite NP1 executable normalized parity report", () => {
  it("emits one schema-valid canonical JSON line and is byte-stable", () => {
    const first = runTypeScriptReporter();
    const second = runTypeScriptReporter();
    expect(second.stdout).toBe(first.stdout);
    expect(first.report).toMatchObject({
      contractId: "sqlite-cursor-publication-native-projection-np1/v1",
      implementation: "typescript",
      schemaVersion: 1,
    });
  }, 360_000);

  crossRuntimeIt("matches two stable Python runs by exact portable bytes", () => {
    const typescript = runTypeScriptReporter();
    const firstPython = runPythonReporter();
    const secondPython = runPythonReporter();
    expect(secondPython.stdout).toBe(firstPython.stdout);
    expect(firstPython.report).toMatchObject({ implementation: "python" });
    expect(() => assertSQLiteNativeProjectionPortableParity(
      typescript.report,
      firstPython.report,
    )).not.toThrow();
  }, 540_000);
});
