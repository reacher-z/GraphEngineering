import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const ROOT = new URL("../../", import.meta.url);
const EXPECTED = Object.freeze([
  ["control", "accepted", 4, 4, 4, 0],
  ["rollback-rebegin", "transaction-lineage", 1, 0, 1, 0],
  ["skipped-boundary", "clock-order", 0, 0, 0, 0],
  ["clock-regression", "clock-regression", 1, 0, 2, 0],
  ["expiry-equal", "lock-expired", 0, 0, 1, 0],
  ["clock-invalid", "clock-unavailable", 0, 0, 1, 0],
  ["lock-drift", "migration-lock", 1, 0, 1, 1],
].map((item) => Object.freeze([...item, 0, 0, 0])));

function report(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function comparable(value) {
  assert.equal(value.publicExport, false, `${value.runtime} leaked a public clock authority`);
  assert.deepEqual(value.counterProbe, {
    cursorRebindPrepareCount: 1,
    cursorRebindExecuteCount: 1,
    commitCount: 1,
  }, `${value.runtime} counter instrumentation is not live`);
  return value.cases.map((item) => [
    item.caseId,
    item.outcome,
    item.observations,
    item.consumed,
    item.providerClockReads,
    item.totalChangesDelta,
    item.cursorRebindPrepareCount,
    item.cursorRebindExecuteCount,
    item.commitCount,
  ]);
}

test("SQLite cursor publication clock authority has exact TS/Python parity", () => {
  const typescript = report("node", [
    "--no-warnings",
    "tools/conformance/sqlite_cursor_publication_clock_typescript_report.mjs",
  ]);
  const python = report("uv", [
    "run", "--project", "python", "python",
    "tools/conformance/sqlite_cursor_publication_clock_python_report.py",
  ]);
  const typescriptCases = comparable(typescript);
  const pythonCases = comparable(python);
  assert.deepEqual(typescriptCases, EXPECTED);
  assert.deepEqual(pythonCases, EXPECTED);
  assert.deepEqual(typescriptCases, pythonCases);
});

test("clock tranche has no cursor rebind or transaction-finalization path", () => {
  for (const path of [
    "packages/sqlite/src/cursor-publication-clock-authority.ts",
    "python/src/graph_engineering/sqlite_cursor_publication_clock_authority.py",
  ]) {
    const source = readFileSync(new URL(path, ROOT), "utf8");
    assert.doesNotMatch(source, /UPDATE\s+(?:main\.)?ge_cycle_cursors/iu);
    assert.doesNotMatch(source, /\b(?:COMMIT|commit\s*\()\b/u);
  }
});
