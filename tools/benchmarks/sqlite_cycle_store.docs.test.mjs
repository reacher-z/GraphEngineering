import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function run(command, arguments_, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: REPOSITORY_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`documentation smoke exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(
          `documentation smoke failed with code ${String(code)}, signal ${String(signal)}: ${stderr}`,
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

test("SQLite docs retain every safety and support boundary", async () => {
  const runbook = await readFile(join(REPOSITORY_ROOT, "docs/SQLITE.md"), "utf8");
  const readme = await readFile(
    join(REPOSITORY_ROOT, "packages/sqlite/README.md"),
    "utf8",
  );
  for (const required of [
    "Node.js 22.16.0",
    "Python 3.11",
    "single-use",
    "single-host",
    "network-filesystem",
    "DatabaseSync",
    "asyncio.to_thread",
    "synchronous=FULL",
    "BUSY/LOCKED",
    "cycle-store.db-wal",
    "cycle-store.db-shm",
    "raw copy",
    "content-addressed",
    "semantic audit",
    "new path",
    "rollback",
    "same `operationId`",
    "GE_CYCLE_STORE_CORRUPTION",
    "encryption",
    "forbidden logs",
    "node:sqlite",
    "manual SQL",
    "migration-lock",
    "ATTACH",
    "extensions disabled",
    "D7-S03 PostgreSQL",
    "D7-S04 checkpoint acceleration",
    "D7-I01/I02",
    "scheduler integration",
    "release",
  ]) {
    assert.ok(
      runbook.toLowerCase().includes(required.toLowerCase()),
      `runbook is missing ${required}`,
    );
  }
  for (const required of [
    ">=22.16.0",
    "local filesystem",
    "active development",
    "DatabaseSync",
    "manifest",
    "restore",
    "operationId",
    "D7-S04",
  ]) {
    assert.ok(readme.includes(required), `package README is missing ${required}`);
  }
  assert.ok(!runbook.includes("rm -rf"));
  assert.ok(!readme.includes("rm -rf"));
});

test("retained Node and Python SQLite examples execute on temporary paths", async () => {
  const node = await run(process.execPath, [
    "--no-warnings",
    "examples/sqlite/node-quickstart.mjs",
  ]);
  const nodeReport = JSON.parse(node.stdout);
  assert.equal(nodeReport.providerId, "sqlite-local");
  assert.equal(nodeReport.appendedRecords, 1);
  assert.equal(nodeReport.exactOperationReplay, true);
  assert.equal(nodeReport.sourceSemanticSha256, nodeReport.backupSemanticSha256);
  assert.equal(nodeReport.backupSemanticSha256, nodeReport.restoreSemanticSha256);
  assert.ok(!node.stdout.includes("/tmp/"));

  const python = await run("uv", [
    "run",
    "--project",
    "python",
    "python",
    "examples/sqlite/python_quickstart.py",
  ]);
  const pythonReport = JSON.parse(python.stdout);
  assert.equal(pythonReport.providerId, "sqlite-local");
  assert.equal(pythonReport.appendedRecords, 1);
  assert.equal(pythonReport.exactOperationReplay, true);
  assert.equal(
    pythonReport.sourceSemanticSha256,
    pythonReport.backupSemanticSha256,
  );
  assert.equal(
    pythonReport.backupSemanticSha256,
    pythonReport.restoreSemanticSha256,
  );
  assert.ok(!python.stdout.includes("/tmp/"));
});
