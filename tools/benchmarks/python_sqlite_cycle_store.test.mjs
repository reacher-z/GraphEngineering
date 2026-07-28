import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BENCHMARK = fileURLToPath(
  new URL("./python_sqlite_cycle_store.py", import.meta.url),
);
const PROJECT_PYTHON = process.platform === "win32"
  ? join(ROOT, "python", ".venv", "Scripts", "python.exe")
  : join(ROOT, "python", ".venv", "bin", "python");
const PYTHON = process.env.GRAPH_ENGINEERING_PYTHON
  ?? (existsSync(PROJECT_PYTHON) ? PROJECT_PYTHON : "python3");

async function runQuickBenchmark() {
  const temporaryParent = await mkdtemp(join(tmpdir(), "ge-python-benchmark-test-"));
  const sentinel = "sentinel.keep";
  await writeFile(join(temporaryParent, sentinel), "retained\n", "utf8");
  try {
    const report = await new Promise((resolve, reject) => {
      const child = spawn(PYTHON, [
        BENCHMARK,
        "--quick",
        "--samples=1",
        "--expensive-samples=1",
        "--contention-samples=1",
        "--contention-operations=1",
      ], {
        cwd: ROOT,
        env: {
          ...process.env,
          TEMP: temporaryParent,
          TMP: temporaryParent,
          TMPDIR: temporaryParent,
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Python SQLite benchmark smoke exceeded 60 seconds"));
      }, 60_000);
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
            `Python SQLite benchmark smoke failed with code ${String(code)}, `
            + `signal ${String(signal)}: ${stderr}`,
          ));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("Python SQLite benchmark smoke returned invalid JSON"));
        }
      });
    });
    assert.deepEqual(
      await readdir(temporaryParent),
      [sentinel],
      "benchmark must remove its database, WAL, SHM, manifest, backup, and restore tree",
    );
    return report;
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
}

test("quick native Python SQLite benchmark retains every workload and nonclaim", async () => {
  const report = await runQuickBenchmark();
  assert.equal(report.kind, "PythonSQLiteCycleStoreBenchmarkReport");
  assert.equal(report.language, "python");
  assert.equal(report.mode, "quick-smoke");
  assert.equal(report.releaseGate, false);
  assert.equal(report.productionThroughputClaim, false);
  assert.equal(report.crossLanguagePerformanceClaim, false);
  assert.deepEqual(report.temporaryDirectoryCleanup, {
    strategy: "recursive-after-all-provider-and-worker-handles-close",
    verified: true,
  });

  const [pythonMajor, pythonMinor] = report.environment.python.version
    .split(".")
    .map(Number);
  assert.ok(pythonMajor > 3 || (pythonMajor === 3 && pythonMinor >= 11));
  assert.match(report.environment.python.implementation, /Python$/u);
  assert.ok(Number.isSafeInteger(report.environment.platform.logicalCpuCount));
  assert.ok(report.environment.platform.logicalCpuCount >= 1);
  assert.ok(Number.isSafeInteger(report.environment.filesystem.blockSizeBytes));
  assert.ok(report.environment.filesystem.blockSizeBytes >= 1);
  assert.ok(Number.isSafeInteger(report.environment.filesystem.blocks));
  assert.ok(report.environment.filesystem.blocks >= 1);

  const sqlite = report.environment.sqlite;
  assert.match(sqlite.runtimeVersion, /^3\./u);
  assert.match(sqlite.moduleVersion, /^2\./u);
  assert.equal(sqlite.settings.journalMode, "wal");
  assert.equal(sqlite.settings.synchronousName, "FULL");
  assert.equal(sqlite.settings.foreignKeys, 1);
  assert.equal(sqlite.settings.trustedSchema, 0);
  assert.equal(sqlite.settings.writableSchema, 0);
  assert.equal(sqlite.settings.queryOnly, 1);
  assert.equal(sqlite.settings.walAutocheckpointPages, 1_000);
  assert.equal(sqlite.settings.busyTimeoutMs, 250);
  assert.ok(Number.isSafeInteger(sqlite.database.applicationId));
  assert.equal(sqlite.database.userVersion >= 1, true);
  assert.ok(sqlite.database.files.databaseBytes > 0);
  assert.ok(sqlite.database.files.walBytes >= 0);
  assert.ok(sqlite.database.files.sharedMemoryBytes >= 0);

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
    assert.ok(benchmark.rawSamples.every(
      (sample) => Number.isFinite(sample) && sample >= 0,
    ));
    assert.ok(benchmark.p50 <= benchmark.p95);
    assert.ok(benchmark.p95 <= benchmark.p99);
    assert.ok(Number.isSafeInteger(benchmark.storageAfter.databaseBytes));
    assert.ok(Number.isSafeInteger(benchmark.storageAfter.walBytes));
    assert.ok(Number.isSafeInteger(benchmark.storageAfter.sharedMemoryBytes));
  }

  for (const writers of [1, 2, 4]) {
    const campaign = report.benchmarks.find(
      ({ name }) => name === `${writers}-writer-contention-campaign`,
    );
    assert.equal(campaign.metadata.writers, writers);
    assert.equal(campaign.metadata.operatingSystemProcesses, writers);
    assert.equal(campaign.metadata.contentionSamples, 1);
    assert.equal(campaign.metadata.operationsPerWriterPerSample, 1);
    assert.equal(
      campaign.metadata.completedOperations + campaign.metadata.exhaustedOperations,
      writers,
    );
    assert.equal(campaign.metadata.operationRawSamplesMilliseconds.length, writers);
  }

  assert.equal(report.retryAccounting.clientOperationRetries, 0);
  assert.equal(report.retryAccounting.successfulProviderInternalRetries, null);
  assert.match(
    report.retryAccounting.successfulProviderInternalRetriesReason,
    /does not expose/u,
  );
  assert.deepEqual(report.configuration.auditRecordTargets, [128, 1_024]);
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

  const backup = report.benchmarks.find(({ name }) => name === "online-backup");
  assert.ok(backup.metadata.backupStorage.databaseBytes > 0);
  assert.ok(backup.metadata.manifestBytes > 0);
  assert.equal(backup.metadata.semanticIdentityMatched, true);
  assert.match(backup.metadata.sourceSemanticSha256, /^[0-9a-f]{64}$/u);
  assert.equal(
    backup.metadata.sourceSemanticSha256,
    backup.metadata.backupSemanticSha256,
  );
  const restore = report.benchmarks.find(
    ({ name }) => name === "restore-verification",
  );
  assert.equal(restore.metadata.includesManifestAndSemanticVerification, true);
  assert.equal(restore.metadata.includesPublicTailAndSemanticAudit, true);
  assert.equal(restore.metadata.semanticIdentityMatched, true);
  assert.equal(restore.metadata.tailIdentityMatched, true);
  assert.equal(
    restore.metadata.sourceSemanticSha256,
    restore.metadata.restoredSemanticSha256,
  );

  const encoded = JSON.stringify(report);
  assert.doesNotMatch(encoded, /"opsPerSecond"|"throughputTarget"|"releaseThreshold"/u);
});
