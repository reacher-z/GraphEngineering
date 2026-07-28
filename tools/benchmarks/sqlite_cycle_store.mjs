#!/usr/bin/env node

/**
 * Raw, reproducible SQLite CycleStore characterization.
 *
 * This is deliberately not a release gate. It emits measurements, runtime and
 * filesystem metadata, effective SQLite settings, sidecar sizes, and the
 * retry information available through the public provider boundary. It never
 * invents a throughput target or treats one workstation as production proof.
 */

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
} from "../../packages/runtime/dist/index.js";
import {
  SQLiteCycleStoreProvider,
  createSQLiteCycleStoreBackup,
  inspectSQLiteCycleStoreIntegrity,
  restoreSQLiteCycleStoreBackup,
} from "../../packages/sqlite/dist/index.js";

const AUTH = Object.freeze({
  tenantId: "benchmark-tenant",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const MISSING_TAIL = Object.freeze({
  exists: false,
  sequence: -1,
  recordHash: null,
});
const PROVIDER_OPTIONS = Object.freeze({
  busyTimeoutMs: 250,
  maxBusyAttempts: 3,
  maxBusyElapsedMs: 1_500,
});
const REPORT_API_VERSION =
  "graphengineering.reacher-z.github.io/sqlite-cycle-store-benchmarks/v1alpha1";
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function fail(message) {
  throw new Error(`SQLite CycleStore benchmark: ${message}`);
}

function checkedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function parseOptions(argv) {
  const quick = argv.includes("--quick");
  const values = new Map();
  for (const argument of argv) {
    if (argument === "--quick") continue;
    const match = /^--([a-z-]+)=(\d+)$/u.exec(argument);
    if (match === null) fail(`unknown argument ${JSON.stringify(argument)}`);
    values.set(match[1], Number(match[2]));
  }
  const samples = checkedInteger(
    values.get("samples") ?? (quick ? 2 : 20),
    1,
    1_000,
    "samples",
  );
  const warmup = checkedInteger(
    values.get("warmup") ?? (quick ? 0 : 5),
    0,
    1_000,
    "warmup",
  );
  const expensiveSamples = checkedInteger(
    values.get("expensive-samples") ?? (quick ? 1 : 5),
    1,
    100,
    "expensive-samples",
  );
  const contentionSamples = checkedInteger(
    values.get("contention-samples") ?? (quick ? 1 : 5),
    1,
    100,
    "contention-samples",
  );
  const contentionOperations = checkedInteger(
    values.get("contention-operations") ?? (quick ? 2 : 25),
    1,
    1_000,
    "contention-operations",
  );
  return Object.freeze({
    quick,
    samples,
    warmup,
    expensiveSamples,
    contentionSamples,
    contentionOperations,
    auditRecordTargets: Object.freeze(quick ? [128, 1_024] : [10_000, 100_000]),
  });
}

function assertRuntimeFloor() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 16)) {
    fail(`Node >=22.16.0 is required; received ${process.version}`);
  }
}

function pythonVersion() {
  const command = process.env.GRAPH_ENGINEERING_PYTHON ?? "python3";
  const completed = spawnSync(command, ["--version"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
    windowsHide: true,
  });
  if (completed.error !== undefined || completed.status !== 0) {
    return Object.freeze({ available: false, version: null });
  }
  const output = `${completed.stdout ?? ""}${completed.stderr ?? ""}`.trim();
  return Object.freeze({
    available: /^Python \d+\.\d+\.\d+$/u.test(output),
    version: /^Python \d+\.\d+\.\d+$/u.test(output) ? output : null,
  });
}

function mutation(operationId) {
  return Object.freeze({ ...AUTH, operationId });
}

function records(prefix, count, startSequence = 0, previousRecordHash = null) {
  const result = [];
  let previous = previousRecordHash;
  for (let offset = 0; offset < count; offset += 1) {
    const sequence = startSequence + offset;
    const record = createCycleStoreRecord({
      recordId: `${prefix}-${sequence}`,
      sequence,
      previousRecordHash: previous,
      value: { benchmark: prefix, sequence },
    });
    result.push(record);
    previous = record.recordHash;
  }
  return result;
}

function rounded(value) {
  return Number(value.toFixed(3));
}

function percentile(sorted, percentage) {
  if (sorted.length === 0) fail("cannot calculate a percentile without samples");
  const rank = Math.max(0, Math.ceil(percentage * sorted.length) - 1);
  return sorted[Math.min(rank, sorted.length - 1)];
}

function summarize(name, category, rawSamples, storageAfter, metadata = {}) {
  const samples = rawSamples.map(rounded);
  const sorted = [...samples].sort((left, right) => left - right);
  return Object.freeze({
    name,
    category,
    unit: "milliseconds",
    percentileMethod: "nearest-rank",
    sampleCount: samples.length,
    rawSamples: samples,
    p50: percentile(sorted, 0.50),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    storageAfter,
    metadata,
  });
}

async function measuredSamples(count, warmup, action) {
  for (let index = 0; index < warmup; index += 1) await action(index, true);
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const startedAt = performance.now();
    await action(index, false);
    result.push(performance.now() - startedAt);
  }
  return result;
}

function sizeOrZero(path) {
  return existsSync(path) ? statSync(path).size : 0;
}

function storageSizes(path) {
  return Object.freeze({
    databaseBytes: sizeOrZero(path),
    walBytes: sizeOrZero(`${path}-wal`),
    sharedMemoryBytes: sizeOrZero(`${path}-shm`),
  });
}

function sqliteEnvironment(path) {
  const database = new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    timeout: PROVIDER_OPTIONS.busyTimeoutMs,
  });
  try {
    // These connection-local settings mirror the provider policy and are read
    // back on an independent verification connection. WAL is file-persistent;
    // the remaining values are deliberately established per connection.
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA synchronous = FULL;
      PRAGMA wal_autocheckpoint = 1000;
      PRAGMA writable_schema = OFF;
      PRAGMA busy_timeout = ${PROVIDER_OPTIONS.busyTimeoutMs};
    `);
    const version = database.prepare("SELECT sqlite_version() AS value").get().value;
    const setting = (name) => Object.values(database.prepare(`PRAGMA ${name}`).get())[0];
    return Object.freeze({
      sqliteVersion: String(version),
      journalMode: String(setting("journal_mode")).toLowerCase(),
      synchronous: Number(setting("synchronous")),
      synchronousName: Number(setting("synchronous")) === 2 ? "FULL" : "unexpected",
      foreignKeys: Number(setting("foreign_keys")),
      trustedSchema: Number(setting("trusted_schema")),
      writableSchema: Number(setting("writable_schema")),
      walAutocheckpointPages: Number(setting("wal_autocheckpoint")),
      busyTimeoutMs: Number(setting("busy_timeout")),
    });
  } finally {
    database.close();
  }
}

function queryPlanAssertions(path) {
  const database = new DatabaseSync(path, { readOnly: true });
  const checks = [
    {
      name: "tenant-stream-tail",
      expected: "PRIMARY KEY",
      sql: "EXPLAIN QUERY PLAN SELECT tail_sequence, tail_record_hash FROM ge_cycle_streams WHERE tenant_id = ? AND stream_id = ?",
      parameters: [AUTH.tenantId, "query-plan-stream"],
    },
    {
      name: "record-range",
      expected: "PRIMARY KEY",
      sql: "EXPLAIN QUERY PLAN SELECT record_blob FROM ge_cycle_records WHERE tenant_id = ? AND stream_id = ? AND sequence >= ? AND sequence <= ? ORDER BY sequence",
      parameters: [AUTH.tenantId, "query-plan-stream", 0, 255],
    },
    {
      name: "operation-id",
      expected: "PRIMARY KEY",
      sql: "EXPLAIN QUERY PLAN SELECT operation_name, request_hash, result_blob, result_hash FROM ge_cycle_operations WHERE tenant_id = ? AND operation_id = ?",
      parameters: [AUTH.tenantId, "query-plan-operation"],
    },
    {
      name: "checkpoint-order",
      expected: "ge_cycle_checkpoints_order_idx",
      sql: "EXPLAIN QUERY PLAN SELECT summary_blob FROM ge_cycle_checkpoints WHERE tenant_id = ? AND checkpoint_scope = ? ORDER BY bound_sequence DESC, created_at DESC, checkpoint_id ASC",
      parameters: [AUTH.tenantId, "query-plan-scope"],
    },
    {
      name: "lease",
      expected: "PRIMARY KEY",
      sql: "EXPLAIN QUERY PLAN SELECT active_lease_id, active_fencing_token FROM ge_cycle_leases WHERE tenant_id = ? AND stream_id = ?",
      parameters: [AUTH.tenantId, "query-plan-stream"],
    },
    {
      name: "legal-hold",
      expected: "ge_cycle_holds_lookup_idx",
      sql: "EXPLAIN QUERY PLAN SELECT hold_id FROM ge_cycle_legal_holds WHERE tenant_id = ? AND stream_id = ? ORDER BY placed_at_ms, hold_id",
      parameters: [AUTH.tenantId, "query-plan-stream"],
    },
    {
      name: "cursor-token",
      expected: "PRIMARY KEY",
      sql: "EXPLAIN QUERY PLAN SELECT kind, expires_at_ms, consumed_at_ms FROM ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ?",
      parameters: [AUTH.tenantId, "0".repeat(64)],
    },
    {
      name: "cursor-expiry",
      expected: "ge_cycle_cursors_expiry_idx",
      sql: "EXPLAIN QUERY PLAN SELECT tenant_id, token_hash FROM ge_cycle_cursors WHERE expires_at_ms <= ? ORDER BY expires_at_ms, tenant_id, token_hash LIMIT 64",
      parameters: [0],
    },
    {
      name: "migration-lock",
      expected: "INTEGER PRIMARY KEY",
      sql: "EXPLAIN QUERY PLAN SELECT active_lock_id, active_fencing_token FROM ge_cycle_migration_lock WHERE singleton = 1",
      parameters: [],
    },
    {
      name: "migration-fence",
      expected: "ge_cycle_used_migration_lock_ids_fence_uq",
      sql: "EXPLAIN QUERY PLAN SELECT lock_id FROM ge_cycle_used_migration_lock_ids WHERE fencing_token = ?",
      parameters: [1],
    },
  ];
  try {
    return checks.map((check) => {
      const details = database.prepare(check.sql).all(...check.parameters)
        .map((row) => String(row.detail));
      if (!details.some((detail) => detail.includes(check.expected))) {
        fail(`hot query ${check.name} did not use ${check.expected}`);
      }
      return Object.freeze({
        name: check.name,
        expectedAccessPath: check.expected,
        details,
      });
    });
  } finally {
    database.close();
  }
}

async function appendBatch(provider, streamId, operationId, batch, expectedTail) {
  return provider.append({
    context: mutation(operationId),
    streamId,
    expectedTail,
    lease: null,
    records: batch,
  });
}

async function growStream(provider, streamId, target, state) {
  while (state.count < target) {
    const count = Math.min(64, target - state.count);
    const batch = records(
      streamId,
      count,
      state.count,
      state.tail.recordHash,
    );
    const result = await appendBatch(
      provider,
      streamId,
      `grow-${streamId}-${state.count}`,
      batch,
      state.tail,
    );
    state.count += count;
    state.tail = result.tail;
  }
}

function childProcessJson(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH, ...arguments_], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        reject(new Error(
          `contention worker failed with code ${String(code)}, signal ${String(signal)}: ${stderr}`,
        ));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("contention worker returned invalid JSON"));
      }
    });
  });
}

async function runContentionSample(path, writers, operations, sample) {
  const provider = new SQLiteCycleStoreProvider(path, PROVIDER_OPTIONS);
  provider.close();
  const startedAt = performance.now();
  const results = await Promise.all(
    Array.from({ length: writers }, (_, writer) => childProcessJson([
      "--worker",
      path,
      String(writer),
      String(operations),
      String(sample),
    ])),
  );
  return Object.freeze({
    elapsedMs: performance.now() - startedAt,
    operationSamples: results.flatMap((result) => result.operationSamples),
    completedOperations: results.reduce(
      (total, result) => total + result.completedOperations,
      0,
    ),
    exhaustedOperations: results.reduce(
      (total, result) => total + result.exhaustedOperations,
      0,
    ),
    exhaustedTransactionAttempts: results.reduce(
      (total, result) => total + result.exhaustedTransactionAttempts,
      0,
    ),
  });
}

async function workerMain(argv) {
  const [path, writerText, operationsText, sampleText] = argv;
  if (path === undefined || path.includes("\0")) fail("worker path is invalid");
  const writer = checkedInteger(Number(writerText), 0, 63, "worker index");
  const operations = checkedInteger(Number(operationsText), 1, 1_000, "worker operations");
  const sample = checkedInteger(Number(sampleText), 0, 10_000, "worker sample");
  const provider = new SQLiteCycleStoreProvider(path, PROVIDER_OPTIONS);
  const operationSamples = [];
  let completedOperations = 0;
  let exhaustedOperations = 0;
  let exhaustedTransactionAttempts = 0;
  try {
    for (let index = 0; index < operations; index += 1) {
      const streamId = `contention-${sample}-${writer}-${index}`;
      const batch = records(streamId, 1);
      const startedAt = performance.now();
      try {
        await appendBatch(
          provider,
          streamId,
          `contention-${sample}-${writer}-${index}`,
          batch,
          MISSING_TAIL,
        );
        completedOperations += 1;
      } catch (error) {
        if (error?.code !== "GE_CYCLE_STORE_UNAVAILABLE") throw error;
        exhaustedOperations += 1;
        const attempts = Number(error?.details?.attempts ?? 0);
        if (Number.isSafeInteger(attempts) && attempts > 0) {
          exhaustedTransactionAttempts += attempts;
        }
      }
      operationSamples.push(rounded(performance.now() - startedAt));
    }
  } finally {
    provider.close();
  }
  process.stdout.write(JSON.stringify({
    operationSamples,
    completedOperations,
    exhaustedOperations,
    exhaustedTransactionAttempts,
  }));
}

async function main(argv) {
  assertRuntimeFloor();
  const options = parseOptions(argv);
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-benchmark-"));
  const databasePath = join(root, "benchmark.db");
  const provider = new SQLiteCycleStoreProvider(databasePath, PROVIDER_OPTIONS);
  const benchmarks = [];
  const retryAccounting = {
    clientOperationRetries: 0,
    exhaustedOperations: 0,
    exhaustedTransactionAttempts: 0,
    successfulProviderInternalRetries: null,
    successfulProviderInternalRetriesReason:
      "The safe public adapter does not expose successful transaction retry internals; only typed exhaustion attempt counts are observable.",
  };
  let identifier = 0;
  try {
    const queryPlans = queryPlanAssertions(databasePath);
    const singleFixtures = Array.from(
      { length: options.samples + options.warmup },
      () => {
        const current = identifier++;
        const streamId = `single-${current}`;
        return Object.freeze({
          streamId,
          operationId: `single-${current}`,
          batch: Object.freeze(records(streamId, 1)),
        });
      },
    );
    let singleFixtureIndex = 0;
    const oneRecord = await measuredSamples(options.samples, options.warmup, async () => {
      const fixture = singleFixtures[singleFixtureIndex++];
      await appendBatch(
        provider,
        fixture.streamId,
        fixture.operationId,
        fixture.batch,
        MISSING_TAIL,
      );
    });
    benchmarks.push(summarize(
      "single-record-append",
      "single-record-append",
      oneRecord,
      storageSizes(databasePath),
      { recordsPerTransaction: 1, fixtureConstructionInsideTimer: false },
    ));

    const batchFixtures = Array.from(
      { length: options.samples + options.warmup },
      () => {
        const current = identifier++;
        const streamId = `batch64-${current}`;
        return Object.freeze({
          streamId,
          operationId: `batch64-${current}`,
          batch: Object.freeze(records(streamId, 64)),
        });
      },
    );
    let batchFixtureIndex = 0;
    const sixtyFourRecords = await measuredSamples(
      options.samples,
      options.warmup,
      async () => {
        const fixture = batchFixtures[batchFixtureIndex++];
        await appendBatch(
          provider,
          fixture.streamId,
          fixture.operationId,
          fixture.batch,
          MISSING_TAIL,
        );
      },
    );
    benchmarks.push(summarize(
      "sixty-four-record-append",
      "64-record-append",
      sixtyFourRecords,
      storageSizes(databasePath),
      { recordsPerTransaction: 64, fixtureConstructionInsideTimer: false },
    ));

    for (const writers of [1, 2, 4]) {
      const path = join(root, `contention-${writers}.db`);
      const rawSamples = [];
      const operationSamples = [];
      let completedOperations = 0;
      let exhaustedOperations = 0;
      let exhaustedTransactionAttempts = 0;
      for (let sample = 0; sample < options.contentionSamples; sample += 1) {
        const result = await runContentionSample(
          path,
          writers,
          options.contentionOperations,
          sample,
        );
        rawSamples.push(result.elapsedMs);
        operationSamples.push(...result.operationSamples);
        completedOperations += result.completedOperations;
        exhaustedOperations += result.exhaustedOperations;
        exhaustedTransactionAttempts += result.exhaustedTransactionAttempts;
      }
      retryAccounting.exhaustedOperations += exhaustedOperations;
      retryAccounting.exhaustedTransactionAttempts += exhaustedTransactionAttempts;
      benchmarks.push(summarize(
        `${writers}-writer-contention-campaign`,
        "local-writer-contention",
        rawSamples,
        storageSizes(path),
        {
          writers,
          operatingSystemProcesses: writers,
          operationsPerWriterPerSample: options.contentionOperations,
          completedOperations,
          exhaustedOperations,
          exhaustedTransactionAttempts,
          operationRawSamplesMilliseconds: operationSamples,
        },
      ));
    }

    const tailStream = "tail-read-stream";
    const tailBatch = records(tailStream, 1);
    await appendBatch(provider, tailStream, "tail-read-setup", tailBatch, MISSING_TAIL);
    const tailReads = await measuredSamples(
      options.samples,
      options.warmup,
      () => provider.readTail({ context: AUTH, streamId: tailStream }),
    );
    benchmarks.push(summarize(
      "tail-read",
      "tail-read",
      tailReads,
      storageSizes(databasePath),
    ));

    const pageStream = "page-read-stream";
    const pageState = { count: 0, tail: MISSING_TAIL };
    await growStream(provider, pageStream, 256, pageState);
    const pageReads = await measuredSamples(
      options.samples,
      options.warmup,
      async () => {
        const page = await provider.readEventPage({
          context: AUTH,
          streamId: pageStream,
          fromSequence: 0,
          pageSize: 256,
          cursor: null,
        });
        if (page.records.length !== 256 || page.nextCursor !== null) {
          fail("256-record page returned an unexpected shape");
        }
      },
    );
    benchmarks.push(summarize(
      "two-hundred-fifty-six-record-page",
      "256-record-page",
      pageReads,
      storageSizes(databasePath),
      { pageSize: 256 },
    ));

    const checkpointFixtures = Array.from(
      { length: options.samples + options.warmup },
      () => {
        const current = identifier++;
        return Object.freeze({
          operationId: `checkpoint-save-${current}`,
          checkpoint: createCycleStoreCheckpoint({
            checkpointScope: "benchmark-scope",
            checkpointId: `checkpoint-${current}`,
            streamId: pageStream,
            boundSequence: pageState.tail.sequence,
            boundRecordHash: pageState.tail.recordHash,
            createdAt: new Date(1_800_000_000_000 + current).toISOString(),
            value: { benchmark: "checkpoint", current },
          }),
        });
      },
    );
    let checkpointFixtureIndex = 0;
    const checkpointSaveSamples = await measuredSamples(
      options.samples,
      options.warmup,
      async () => {
        const fixture = checkpointFixtures[checkpointFixtureIndex++];
        await provider.saveCheckpoint({
          context: mutation(fixture.operationId),
          checkpoint: fixture.checkpoint,
          lease: null,
        });
      },
    );
    benchmarks.push(summarize(
      "checkpoint-save",
      "checkpoint-save-load",
      checkpointSaveSamples,
      storageSizes(databasePath),
      { fixtureConstructionInsideTimer: false },
    ));

    const loadCheckpointId = checkpointFixtures.at(-1).checkpoint.checkpointId;
    const checkpointLoadSamples = await measuredSamples(
      options.samples,
      options.warmup,
      async () => {
        const checkpoint = await provider.loadCheckpoint({
          context: AUTH,
          checkpointScope: "benchmark-scope",
          checkpointId: loadCheckpointId,
        });
        if (checkpoint === null) fail("checkpoint load benchmark lost its fixture");
      },
    );
    benchmarks.push(summarize(
      "checkpoint-load",
      "checkpoint-save-load",
      checkpointLoadSamples,
      storageSizes(databasePath),
    ));

    const leaseStream = "lease-renew-stream";
    await appendBatch(
      provider,
      leaseStream,
      "lease-stream-setup",
      records(leaseStream, 1),
      MISSING_TAIL,
    );
    let lease = await provider.acquireLease({
      context: mutation("lease-acquire-setup"),
      streamId: leaseStream,
      leaseId: "benchmark-lease",
      holderId: "benchmark-holder",
      ttlMs: 60_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    const leaseRenewSamples = await measuredSamples(
      options.samples,
      options.warmup,
      async () => {
        const current = identifier++;
        lease = await provider.renewLease({
          context: mutation(`lease-renew-${current}`),
          streamId: leaseStream,
          lease: {
            leaseId: lease.leaseId,
            holderId: lease.holderId,
            fencingToken: lease.fencingToken,
          },
          ttlMs: 60_000,
        });
      },
    );
    benchmarks.push(summarize(
      "lease-renew",
      "lease-renew",
      leaseRenewSamples,
      storageSizes(databasePath),
    ));

    const auditPath = join(root, "semantic-audit.db");
    const auditProvider = new SQLiteCycleStoreProvider(auditPath, PROVIDER_OPTIONS);
    const auditState = { count: 0, tail: MISSING_TAIL };
    try {
      for (const [targetIndex, target] of options.auditRecordTargets.entries()) {
        await growStream(auditProvider, "semantic-audit-stream", target, auditState);
        const auditSamples = await measuredSamples(
          options.expensiveSamples,
          0,
          () => Promise.resolve(inspectSQLiteCycleStoreIntegrity(auditPath, "semantic")),
        );
        benchmarks.push(summarize(
          `${target}-record-semantic-audit`,
          targetIndex === 0
            ? "10K-record-semantic-audit"
            : "100K-record-semantic-audit",
          auditSamples,
          storageSizes(auditPath),
          {
            configuredTarget: targetIndex === 0 ? 10_000 : 100_000,
            actualRecords: target,
            quickModeScaleDown: options.quick,
          },
        ));
      }
    } finally {
      auditProvider.close();
    }

    const backupSamples = [];
    let retainedBackup = "";
    for (let sample = 0; sample < options.expensiveSamples; sample += 1) {
      const destination = join(root, `backup-${sample}.db`);
      const startedAt = performance.now();
      await createSQLiteCycleStoreBackup(databasePath, destination);
      backupSamples.push(performance.now() - startedAt);
      retainedBackup = destination;
    }
    benchmarks.push(summarize(
      "online-backup",
      "online-backup",
      backupSamples,
      storageSizes(databasePath),
      { backupStorage: storageSizes(retainedBackup) },
    ));

    const restoreSamples = [];
    let retainedRestore = "";
    for (let sample = 0; sample < options.expensiveSamples; sample += 1) {
      const destination = join(root, `restore-${sample}.db`);
      const startedAt = performance.now();
      await restoreSQLiteCycleStoreBackup(retainedBackup, destination);
      restoreSamples.push(performance.now() - startedAt);
      retainedRestore = destination;
    }
    benchmarks.push(summarize(
      "restore-verification",
      "restore-verification",
      restoreSamples,
      storageSizes(retainedRestore),
      { includesManifestAndSemanticVerification: true },
    ));

    const filesystem = statfsSync(root);
    const report = Object.freeze({
      apiVersion: REPORT_API_VERSION,
      kind: "SQLiteCycleStoreBenchmarkReport",
      mode: options.quick ? "quick-smoke" : "full-characterization",
      releaseGate: false,
      productionThroughputClaim: false,
      generatedAt: new Date().toISOString(),
      environment: {
        nodeVersion: process.version,
        python: pythonVersion(),
        v8Version: process.versions.v8,
        platform: process.platform,
        architecture: process.arch,
        logicalCpuCount: cpus().length,
        filesystem: {
          typeHex: `0x${Number(filesystem.type).toString(16)}`,
          blockSizeBytes: Number(filesystem.bsize),
          blocks: Number(filesystem.blocks),
        },
        sqlite: sqliteEnvironment(databasePath),
      },
      configuration: options,
      retryAccounting,
      queryPlans,
      benchmarks,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    provider.close();
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--worker") {
  await workerMain(process.argv.slice(3));
} else {
  await main(process.argv.slice(2));
}
