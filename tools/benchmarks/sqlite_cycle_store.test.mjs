import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BENCHMARK = fileURLToPath(new URL("./sqlite_cycle_store.mjs", import.meta.url));

function runQuickBenchmark() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      BENCHMARK,
      "--quick",
      "--samples=1",
      "--expensive-samples=1",
      "--contention-samples=1",
      "--contention-operations=1",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("SQLite benchmark smoke exceeded 30 seconds"));
    }, 30_000);
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
          `SQLite benchmark smoke failed with code ${String(code)}, signal ${String(signal)}: ${stderr}`,
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("SQLite benchmark smoke returned invalid JSON"));
      }
    });
  });
}

test("quick SQLite CycleStore benchmark covers the retained workload and index plan", async () => {
  const report = await runQuickBenchmark();
  assert.equal(report.kind, "SQLiteCycleStoreBenchmarkReport");
  assert.equal(report.mode, "quick-smoke");
  assert.equal(report.releaseGate, false);
  assert.equal(report.productionThroughputClaim, false);
  const [nodeMajor, nodeMinor] = report.environment.nodeVersion
    .slice(1)
    .split(".")
    .map(Number);
  assert.ok(nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 16));
  assert.equal(typeof report.environment.python.available, "boolean");
  if (report.environment.python.available) {
    assert.match(report.environment.python.version, /^Python 3\./u);
  } else {
    assert.equal(report.environment.python.version, null);
  }
  assert.match(report.environment.sqlite.sqliteVersion, /^3\./u);
  assert.equal(report.environment.sqlite.journalMode, "wal");
  assert.equal(report.environment.sqlite.synchronousName, "FULL");
  assert.equal(report.environment.sqlite.foreignKeys, 1);
  assert.equal(report.environment.sqlite.trustedSchema, 0);
  assert.equal(report.environment.sqlite.writableSchema, 0);
  assert.equal(report.environment.sqlite.walAutocheckpointPages, 1_000);
  assert.equal(report.environment.sqlite.busyTimeoutMs, 250);

  assert.deepEqual(
    report.queryPlans.map(({ name }) => name),
    [
      "tenant-stream-tail",
      "record-range",
      "operation-id",
      "checkpoint-order",
      "lease",
      "legal-hold",
      "cursor-token",
      "cursor-expiry",
      "migration-lock",
      "migration-fence",
    ],
  );
  for (const plan of report.queryPlans) {
    assert.ok(plan.details.some((detail) => detail.includes(plan.expectedAccessPath)));
    assert.ok(plan.details.every((detail) => !/\bSCAN\b|USE TEMP B-TREE/u.test(detail)));
  }

  assert.deepEqual(
    report.benchmarks.map(({ name }) => name),
    [
      "single-record-append",
      "sixty-four-record-append",
      "1-writer-contention-campaign",
      "2-writer-contention-campaign",
      "4-writer-contention-campaign",
      "tail-read",
      "two-hundred-fifty-six-record-page",
      "checkpoint-save",
      "checkpoint-load",
      "lease-renew",
      "128-record-semantic-audit",
      "1024-record-semantic-audit",
      "online-backup",
      "restore-verification",
    ],
  );
  assert.deepEqual(
    new Set(report.benchmarks.map(({ category }) => category)),
    new Set([
      "single-record-append",
      "64-record-append",
      "local-writer-contention",
      "tail-read",
      "256-record-page",
      "checkpoint-save-load",
      "lease-renew",
      "10K-record-semantic-audit",
      "100K-record-semantic-audit",
      "online-backup",
      "restore-verification",
    ]),
  );
  for (const benchmark of report.benchmarks) {
    assert.ok(benchmark.sampleCount >= 1);
    assert.equal(benchmark.rawSamples.length, benchmark.sampleCount);
    assert.ok(benchmark.rawSamples.every((sample) => Number.isFinite(sample) && sample >= 0));
    assert.ok(benchmark.p50 <= benchmark.p95);
    assert.ok(benchmark.p95 <= benchmark.p99);
    assert.ok(Number.isSafeInteger(benchmark.storageAfter.databaseBytes));
    assert.ok(Number.isSafeInteger(benchmark.storageAfter.walBytes));
    assert.ok(Number.isSafeInteger(benchmark.storageAfter.sharedMemoryBytes));
  }

  assert.equal(report.retryAccounting.clientOperationRetries, 0);
  assert.equal(report.retryAccounting.successfulProviderInternalRetries, null);
  assert.match(
    report.retryAccounting.successfulProviderInternalRetriesReason,
    /does not expose/u,
  );
  assert.equal(report.configuration.auditRecordTargets[0], 128);
  assert.equal(report.configuration.auditRecordTargets[1], 1_024);
  assert.equal(
    report.benchmarks.find(({ name }) => name === "128-record-semantic-audit")
      .metadata.configuredTarget,
    10_000,
  );
  assert.equal(
    report.benchmarks.find(({ name }) => name === "1024-record-semantic-audit")
      .metadata.configuredTarget,
    100_000,
  );
});
