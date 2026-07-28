#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { canonicalSerialize } from "../../packages/core/dist/index.js";
import {
  CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
  CYCLE_STORE_PROVIDER_ERROR_CODES,
  CYCLE_STORE_PROVIDER_OPERATIONS,
  CycleStoreProviderError,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
} from "../../packages/runtime/dist/index.js";
import {
  createSQLiteCycleStoreBackup,
  restoreSQLiteCycleStoreBackup,
} from "../../packages/sqlite/dist/cycle-store-backup.js";
import { SQLiteConnection } from "../../packages/sqlite/dist/sqlite-connection.js";
import {
  SQLITE_CYCLE_STORE_APPLICATION_ID,
  SQLITE_SCHEMA_IDENTITY_SHA256,
  ensureSQLiteCycleStoreSchema,
} from "../../packages/sqlite/dist/migrations.js";
import {
  SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  createSQLiteCycleStoreDescriptor,
} from "../../packages/sqlite/dist/sqlite-profile.js";
import { inspectSQLiteCycleStoreIntegrity } from "../../packages/sqlite/dist/semantic-integrity.js";
import { SQLiteCycleStoreProvider } from "../../packages/sqlite/dist/sqlite-cycle-store.js";

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = dirname(dirname(dirname(MODULE_PATH)));
const FIXTURE_PATH = join(REPOSITORY_ROOT, "spec", "conformance", "sqlite-cycle-store.case.json");
const MIGRATION_FIXTURE_PATH = join(
  REPOSITORY_ROOT,
  "spec",
  "migrations",
  "sqlite",
  "fixtures",
  "alpha-v0.sql",
);
const PROCESS_WORKER_PATH = join(
  REPOSITORY_ROOT,
  "tools",
  "conformance",
  "workers",
  "sqlite_process_worker.mjs",
);
const PYTHON_WORKER_PATH = join(
  REPOSITORY_ROOT,
  "tools",
  "conformance",
  "workers",
  "sqlite_python_worker.py",
);
const FIXED_NOW_MS = Date.parse("2026-07-27T00:00:00.000Z");
const ALPHA_MIGRATION_NOW_MS = FIXED_NOW_MS + 5_000;
const FIXTURE_BYTES = 13_316;
const FIXTURE_SHA256 = "60164cab2843257186fc578bf16624e05aa12e50dd7d7c291c7daf756c9ef220";
const WORKER_TIMEOUT_MS = 20_000;
const SENTINELS = Object.freeze([
  "PAYLOAD_SENTINEL",
  "AUTHORIZATION_SENTINEL",
  "DATABASE_SENTINEL",
]);
const AUTH = Object.freeze({
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const MISSING = Object.freeze({ exists: false, sequence: -1, recordHash: null });
const activeChildren = new Set();
let workerCount = 0;
let barrierCount = 0;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mutation(operationId) {
  return Object.freeze({ ...AUTH, operationId });
}

function records(count, prefix, startSequence = 0, previousRecordHash = null, value = {}) {
  const result = [];
  let previous = previousRecordHash;
  for (let offset = 0; offset < count; offset += 1) {
    const sequence = startSequence + offset;
    const record = createCycleStoreRecord({
      recordId: `${prefix}-${sequence}`,
      sequence,
      previousRecordHash: previous,
      value: { source: prefix, sequence, ...value },
    });
    result.push(record);
    previous = record.recordHash;
  }
  return result;
}

function tailFor(batch) {
  const last = batch.at(-1);
  return last === undefined
    ? MISSING
    : Object.freeze({ exists: true, sequence: last.sequence, recordHash: last.recordHash });
}

async function appendBatch(provider, {
  operationId,
  streamId,
  batch,
  expectedTail = MISSING,
  lease = null,
}) {
  return provider.append({
    context: mutation(operationId),
    streamId,
    expectedTail,
    lease,
    records: batch,
  });
}

async function createStream(provider, streamId = "stream-a", count = 1, prefix = streamId) {
  const batch = records(count, prefix);
  await appendBatch(provider, {
    operationId: `create-${streamId}`,
    streamId,
    batch,
  });
  return batch;
}

function provider(path, nowMs = FIXED_NOW_MS, options = {}) {
  return new SQLiteCycleStoreProvider(path, {
    now: () => new Date(nowMs),
    ...options,
  });
}

function database(path, options = {}) {
  const value = new DatabaseSync(path, {
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    ...options,
  });
  value.exec("PRAGMA trusted_schema = OFF");
  return value;
}

function plainRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "bigint" ? Number(value) : value,
    ]),
  );
}

function scalar(db, sql, field) {
  const row = db.prepare(sql).get();
  assert.ok(row !== undefined, `query returned no row: ${sql}`);
  const value = row[field];
  return typeof value === "bigint" ? Number(value) : value;
}

function logicalSnapshot(path) {
  const db = database(path, { readOnly: true });
  try {
    const tables = db.prepare(
      `SELECT name, sql FROM sqlite_schema
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all().map(plainRow);
    const indexes = db.prepare(
      `SELECT name, sql FROM sqlite_schema
        WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`,
    ).all().map(plainRow);
    const counts = {};
    for (const { name } of tables) {
      assert.match(name, /^[A-Za-z0-9_]+$/u);
      counts[name] = scalar(db, `SELECT count(*) AS value FROM ${name}`, "value");
    }
    const migrations = tables.some(({ name }) => name === "ge_cycle_migrations")
      ? db.prepare("SELECT * FROM ge_cycle_migrations ORDER BY version").all().map(plainRow)
      : [];
    return {
      applicationId: scalar(db, "PRAGMA application_id", "application_id"),
      userVersion: scalar(db, "PRAGMA user_version", "user_version"),
      tables,
      indexes,
      counts,
      migrations,
    };
  } finally {
    db.close();
  }
}

function tableCount(path, table) {
  assert.match(table, /^ge_cycle_[a-z_]+$/u);
  const db = database(path, { readOnly: true });
  try {
    return scalar(db, `SELECT count(*) AS value FROM ${table}`, "value");
  } finally {
    db.close();
  }
}

function stabilizeDatabase(path) {
  const db = database(path);
  try {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE");
  } finally {
    db.close();
  }
}

function fileIdentity(path) {
  const value = readFileSync(path);
  return Object.freeze({ bytes: value.byteLength, sha256: sha256(value) });
}

function safeEnvelope(error) {
  assert.ok(error instanceof CycleStoreProviderError, "generic errors cannot satisfy SQLite conformance");
  const envelope = error.toJSON();
  const serialized = canonicalSerialize(envelope);
  assert.equal(serialized.includes("stack"), false);
  assert.equal(serialized.includes("cause"), false);
  for (const sentinel of SENTINELS) assert.equal(serialized.includes(sentinel), false);
  return envelope;
}

async function expectCode(action, code) {
  try {
    await action();
  } catch (error) {
    const envelope = safeEnvelope(error);
    assert.equal(envelope.code, code, `expected ${code}, received ${envelope.code}`);
    return envelope;
  }
  assert.fail(`expected typed provider rejection ${code}`);
}

function assertWorkerRejection(message, code) {
  assert.equal(message?.type, "result");
  assert.equal(message.outcome, "rejected");
  assert.equal(message.error?.name, "CycleStoreProviderError");
  assert.equal(message.error?.code, code);
  assert.ok(CYCLE_STORE_PROVIDER_OPERATIONS.includes(message.error.operation));
  assert.equal(typeof message.error.retryable, "boolean");
  const serialized = canonicalSerialize(message.error);
  assert.equal(serialized.includes("stack"), false);
  assert.equal(serialized.includes("cause"), false);
  for (const sentinel of SENTINELS) assert.equal(serialized.includes(sentinel), false);
  return message.error;
}

function categoryCounts(cases) {
  const counts = {};
  for (const item of cases) counts[item.category] = (counts[item.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function cleanupTemporaryRoot(root) {
  const resolved = resolve(root);
  assert.equal(dirname(resolved), resolve(tmpdir()));
  assert.ok(basename(resolved).startsWith("graph-engineering-sqlite-campaign-"));
  rmSync(resolved, { recursive: true, force: true });
}

class JsonWorker {
  constructor(configuration) {
    this.messages = [];
    this.waiters = [];
    this.stderr = "";
    this.stdoutRemainder = "";
    this.child = spawn(
      process.execPath,
      ["--no-warnings", PROCESS_WORKER_PATH, JSON.stringify(configuration)],
      {
        cwd: REPOSITORY_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    workerCount += 1;
    activeChildren.add(this.child);
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-16_384);
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#consume(chunk));
    this.exit = new Promise((resolveExit) => {
      this.child.once("exit", (code, signal) => {
        activeChildren.delete(this.child);
        resolveExit({ code, signal });
      });
    });
  }

  #consume(chunk) {
    this.stdoutRemainder += chunk;
    while (true) {
      const newline = this.stdoutRemainder.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutRemainder.slice(0, newline);
      this.stdoutRemainder = this.stdoutRemainder.slice(newline + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        message = { type: "invalid-json" };
      }
      const waiterIndex = this.waiters.findIndex(({ type }) => type === message.type);
      if (waiterIndex >= 0) {
        const [{ resolve: resolveWaiter, timer }] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(timer);
        resolveWaiter(message);
      } else {
        this.messages.push(message);
      }
    }
  }

  waitFor(type, timeoutMs = WORKER_TIMEOUT_MS) {
    const existing = this.messages.findIndex((message) => message.type === type);
    if (existing >= 0) return Promise.resolve(this.messages.splice(existing, 1)[0]);
    return new Promise((resolveWaiter, rejectWaiter) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolveWaiter);
        if (index >= 0) this.waiters.splice(index, 1);
        rejectWaiter(new Error(`SQLite worker timed out waiting for ${type}; stderr=${this.stderr}`));
      }, timeoutMs);
      this.waiters.push({ type, resolve: resolveWaiter, timer });
    });
  }

  async ready() {
    const message = await this.waitFor("ready");
    assert.equal(message.pid, this.child.pid);
    barrierCount += 1;
    return message;
  }

  send(type, fields = {}) {
    assert.equal(this.child.exitCode, null, "cannot signal an exited SQLite worker");
    this.child.stdin.write(`${JSON.stringify({ type, ...fields })}\n`);
    barrierCount += 1;
  }

  async waitForExit(timeoutMs = WORKER_TIMEOUT_MS) {
    let timer;
    try {
      return await Promise.race([
        this.exit,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("SQLite worker exit timed out")), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async cleanup() {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      try {
        await this.waitForExit(1_000);
      } catch {
        this.child.kill("SIGKILL");
        await this.waitForExit(5_000);
      }
    }
    assert.equal(activeChildren.has(this.child), false);
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve({ type: "worker-cleaned" });
    }
  }
}

function childExitWithin(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit) => {
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(null);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function terminateChild(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    if (await childExitWithin(child, 1_000) === null) {
      child.kill("SIGKILL");
      const killed = await childExitWithin(child, 5_000);
      assert.notEqual(killed, null, "SQLite campaign child resisted SIGKILL cleanup");
    }
  }
  activeChildren.delete(child);
}

async function runPythonWorker(configuration) {
  const command = process.platform === "win32" ? "uv.exe" : "uv";
  const child = spawn(command, [
    "run",
    "--quiet",
    "--project",
    "python",
    "python",
    PYTHON_WORKER_PATH,
    JSON.stringify(configuration),
  ], {
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, PYTHONUTF8: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  workerCount += 1;
  activeChildren.add(child);
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-1_048_576); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
  const exit = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  let timer;
  try {
    const exited = await Promise.race([
      exit,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Python SQLite worker timed out")), WORKER_TIMEOUT_MS);
      }),
    ]);
    assert.deepEqual(exited, { code: 0, signal: null }, `Python worker failed: ${stderr}`);
    const lines = stdout.trim().split(/\r?\n/u);
    const message = JSON.parse(lines.at(-1));
    assert.equal(message.type, "result");
    assert.equal(message.outcome, "accepted");
    return message;
  } finally {
    clearTimeout(timer);
    await terminateChild(child);
  }
}

async function bootstrapScenario(scenario, root, path) {
  if (scenario === "fresh-creation") {
    const instance = provider(path);
    try {
      const [descriptor, schema] = await Promise.all([
        instance.describe(),
        instance.inspectSchema(AUTH),
      ]);
      assert.equal(descriptor.descriptorHash, SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
      assert.equal(schema.schemaVersion, 1);
    } finally {
      instance.close();
    }
    const snapshot = logicalSnapshot(path);
    assert.equal(snapshot.applicationId, SQLITE_CYCLE_STORE_APPLICATION_ID);
    assert.equal(snapshot.userVersion, 1);
    assert.equal(snapshot.tables.length, 13);
    assert.equal(snapshot.migrations.length, 1);
    return {
      observation: {
        applicationId: snapshot.applicationId,
        schemaVersion: snapshot.userVersion,
        tableCount: snapshot.tables.length,
        migrationCount: snapshot.migrations.length,
        descriptorHash: SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
      },
    };
  }

  if (scenario === "exact-descriptor") {
    const typescript = createSQLiteCycleStoreDescriptor();
    const python = await runPythonWorker({
      action: "descriptor",
      path: join(root, "python-descriptor.db"),
      initialTime: "2026-07-27T00:00:00.000Z",
    });
    assert.equal(canonicalSerialize(python.descriptor), canonicalSerialize(typescript));
    assert.equal(typescript.descriptorHash, SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
    return {
      observation: {
        descriptorHash: typescript.descriptorHash,
        crossLanguageExact: true,
      },
    };
  }

  if (scenario === "repeat-open-schema-identity") {
    const first = provider(path);
    first.close();
    stabilizeDatabase(path);
    const before = logicalSnapshot(path);
    const beforeIntegrity = inspectSQLiteCycleStoreIntegrity(path, "semantic");
    const second = provider(path, FIXED_NOW_MS + 1);
    second.close();
    stabilizeDatabase(path);
    const after = logicalSnapshot(path);
    const afterIntegrity = inspectSQLiteCycleStoreIntegrity(path, "semantic");
    assert.deepEqual(after, before);
    for (const key of [
      "applicationId",
      "schemaVersion",
      "schemaIdentitySha256",
      "descriptorHash",
      "lineageId",
      "lineageSha256",
      "catalogSha256",
    ]) {
      assert.equal(afterIntegrity[key], beforeIntegrity[key]);
    }
    assert.deepEqual(afterIntegrity.counters, beforeIntegrity.counters);
    return {
      observation: {
        schemaIdentitySha256: afterIntegrity.schemaIdentitySha256,
        lineageId: afterIntegrity.lineageId,
        migrationRows: after.migrations.length,
        unchanged: true,
      },
    };
  }

  if (scenario === "future-version-refusal") {
    const db = database(path);
    db.exec(`PRAGMA application_id = ${SQLITE_CYCLE_STORE_APPLICATION_ID}; PRAGMA user_version = 2`);
    db.close();
    const before = logicalSnapshot(path);
    const rejection = await expectCode(
      () => Promise.resolve().then(() => provider(path)),
      "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
    );
    const after = logicalSnapshot(path);
    assert.deepEqual(after, before);
    return {
      rejection,
      zeroMutation: true,
      observation: { schemaVersion: after.userVersion },
    };
  }

  if (scenario === "setting-drift-refusal") {
    const initialized = provider(path);
    initialized.close();
    const before = logicalSnapshot(path);
    const originalPrepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function prepareWithSettingDrift(sql) {
      const prepared = originalPrepare.call(this, sql);
      if (sql !== "PRAGMA foreign_keys") return prepared;
      return new Proxy(prepared, {
        get(target, property) {
          if (property === "get") return () => [0n];
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    try {
      const rejection = await expectCode(
        () => Promise.resolve().then(() => provider(path, FIXED_NOW_MS + 1)),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
      const after = logicalSnapshot(path);
      assert.deepEqual(after, before);
      return {
        rejection,
        zeroMutation: true,
        observation: { settingReadbackDriftRefused: "foreign_keys" },
      };
    } finally {
      DatabaseSync.prototype.prepare = originalPrepare;
    }
  }

  throw new TypeError(`unknown bootstrap scenario ${scenario}`);
}

async function migrationScenario(scenario, root, path) {
  if (scenario === "alpha-v0-to-v1-migration") {
    const fixtureSql = readFileSync(MIGRATION_FIXTURE_PATH, "utf8");
    const db = database(path);
    db.exec(fixtureSql);
    const beforeBlob = Buffer.from(
      db.prepare(
        "SELECT record_blob FROM ge_cycle_records WHERE tenant_id = 'tenant-alpha' AND sequence = 1",
      ).get().record_blob,
    );
    db.close();
    const connection = new SQLiteConnection(path);
    let opened;
    try {
      opened = ensureSQLiteCycleStoreSchema(
        connection,
        createSQLiteCycleStoreDescriptor(),
        { appliedAtMs: ALPHA_MIGRATION_NOW_MS },
      );
    } finally {
      connection.close();
    }
    assert.equal(opened.disposition, "migrated");
    const verify = database(path, { readOnly: true });
    const afterBlob = Buffer.from(
      verify.prepare(
        "SELECT record_blob FROM ge_cycle_records WHERE tenant_id = 'tenant-alpha' AND sequence = 1",
      ).get().record_blob,
    );
    const recordCount = scalar(verify, "SELECT count(*) AS value FROM ge_cycle_records", "value");
    const revisionCount = scalar(
      verify,
      "SELECT count(*) AS value FROM ge_cycle_checkpoint_revisions",
      "value",
    );
    verify.close();
    assert.equal(afterBlob.equals(beforeBlob), true);
    assert.equal(recordCount, 3);
    assert.equal(revisionCount, 1);
    const integrity = inspectSQLiteCycleStoreIntegrity(path, "semantic");
    assert.equal(integrity.lineageId, "alpha-v0-to-v1");
    return {
      observation: {
        disposition: opened.disposition,
        lineageId: opened.lineageId,
        recordCount,
        checkpointRevisionCount: revisionCount,
        canonicalBlobPreserved: true,
      },
    };
  }

  if (scenario === "migration-finalization-rollback") {
    const fixtureSql = readFileSync(MIGRATION_FIXTURE_PATH, "utf8");
    const db = database(path);
    db.exec(fixtureSql);
    db.close();
    const before = logicalSnapshot(path);
    const connection = new SQLiteConnection(path);
    const originalPrepare = connection.prepare.bind(connection);
    Object.defineProperty(connection, "prepare", {
      configurable: true,
      value(sql, operation) {
        if (sql.includes("INSERT INTO ge_cycle_migrations")) {
          throw new CycleStoreProviderError(
            "GE_CYCLE_STORE_INTERNAL",
            operation,
            "injected migration finalization failure",
          );
        }
        return originalPrepare(sql, operation);
      },
    });
    let rejection;
    try {
      rejection = await expectCode(
        () => Promise.resolve().then(() => ensureSQLiteCycleStoreSchema(
          connection,
          createSQLiteCycleStoreDescriptor(),
          { appliedAtMs: ALPHA_MIGRATION_NOW_MS },
        )),
        "GE_CYCLE_STORE_INTERNAL",
      );
      assert.equal(connection.isTransaction, false);
    } finally {
      connection.close();
    }
    const after = logicalSnapshot(path);
    assert.deepEqual(after, before);
    return {
      rejection,
      zeroMutation: true,
      observation: { schemaVersion: after.userVersion, exactRollback: true },
    };
  }

  if (scenario === "structural-corruption-audit") {
    const instance = provider(path);
    await createStream(instance);
    instance.close();
    stabilizeDatabase(path);
    const originalBytes = statSync(path).size;
    truncateSync(path, Math.max(512, Math.floor(originalBytes / 3)));
    const before = fileIdentity(path);
    const rejection = await expectCode(
      () => Promise.resolve().then(() => inspectSQLiteCycleStoreIntegrity(path, "structural")),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    assert.deepEqual(fileIdentity(path), before);
    return {
      rejection,
      zeroMutation: true,
      observation: { truncatedBytes: originalBytes - before.bytes, auditReadOnly: true },
    };
  }

  if (scenario === "canonical-hash-corruption-audit") {
    const instance = provider(path);
    const batch = await createStream(instance);
    instance.close();
    stabilizeDatabase(path);
    const db = database(path);
    db.prepare(
      `UPDATE ge_cycle_records SET record_blob = ?
        WHERE tenant_id = ? AND stream_id = ? AND sequence = 0`,
    ).run(
      Buffer.from(canonicalSerialize({
        ...batch[0],
        value: { secret: "PAYLOAD_SENTINEL" },
      }), "utf8"),
      AUTH.tenantId,
      "stream-a",
    );
    db.close();
    stabilizeDatabase(path);
    const structural = inspectSQLiteCycleStoreIntegrity(path, "structural");
    assert.equal(structural.integrityCheck, "ok");
    const before = fileIdentity(path);
    const rejection = await expectCode(
      () => Promise.resolve().then(() => inspectSQLiteCycleStoreIntegrity(path, "semantic")),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    assert.deepEqual(fileIdentity(path), before);
    return {
      rejection,
      zeroMutation: true,
      observation: { structuralCheck: structural.integrityCheck, semanticAuditReadOnly: true },
    };
  }

  if (scenario === "foreign-key-corruption-audit") {
    const instance = provider(path);
    instance.close();
    stabilizeDatabase(path);
    const db = database(path);
    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare(
      `INSERT INTO ge_cycle_legal_holds
        (tenant_id, stream_id, hold_id, placed_at_ms) VALUES (?, ?, ?, ?)`,
    ).run("tenant-a", "missing-stream", "missing-hold", FIXED_NOW_MS);
    const integrity = db.prepare("PRAGMA integrity_check").get().integrity_check;
    const foreignKeyViolations = db.prepare("PRAGMA foreign_key_check").all().length;
    db.close();
    stabilizeDatabase(path);
    assert.equal(integrity, "ok");
    assert.ok(foreignKeyViolations > 0);
    const before = fileIdentity(path);
    const rejection = await expectCode(
      () => Promise.resolve().then(() => inspectSQLiteCycleStoreIntegrity(path, "semantic")),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    assert.deepEqual(fileIdentity(path), before);
    return {
      rejection,
      zeroMutation: true,
      observation: { integrityCheck: integrity, foreignKeyViolations, auditReadOnly: true },
    };
  }

  throw new TypeError(`unknown migration scenario ${scenario}`);
}

async function lifecycleScenario(scenario, root, path) {
  if (scenario === "close-double-close-use-after-close") {
    const instance = provider(path);
    const probeRecord = records(1, "closed-probe")[0];
    const probeCheckpoint = createCycleStoreCheckpoint({
      checkpointScope: "scope-a",
      checkpointId: "closed-checkpoint",
      streamId: "stream-a",
      boundSequence: 0,
      boundRecordHash: probeRecord.recordHash,
      createdAt: "2026-07-27T00:00:00.000Z",
      value: { probe: true },
    });
    instance.close();
    instance.close();
    const before = logicalSnapshot(path);
    const calls = [
      ["describe", () => instance.describe()],
      ["inspect-schema", () => instance.inspectSchema(AUTH)],
      ["read-tail", () => instance.readTail({ context: AUTH, streamId: "stream-a" })],
      ["append", () => appendBatch(instance, {
        operationId: "closed-append",
        streamId: "stream-a",
        batch: [probeRecord],
      })],
      ["read-event-page", () => instance.readEventPage({
        context: AUTH,
        streamId: "stream-a",
        fromSequence: 0,
        pageSize: 1,
        cursor: null,
      })],
      ["save-checkpoint", () => instance.saveCheckpoint({
        context: mutation("closed-save"), checkpoint: probeCheckpoint, lease: null,
      })],
      ["load-checkpoint", () => instance.loadCheckpoint({
        context: AUTH, checkpointScope: "scope-a", checkpointId: "closed-checkpoint",
      })],
      ["list-checkpoints", () => instance.listCheckpoints({
        context: AUTH, checkpointScope: "scope-a", pageSize: 1, cursor: null,
      })],
      ["delete-checkpoint", () => instance.deleteCheckpoint({
        context: mutation("closed-delete"),
        checkpointScope: "scope-a",
        checkpointId: "closed-checkpoint",
        lease: null,
      })],
      ["acquire-lease", () => instance.acquireLease({
        context: mutation("closed-acquire"),
        streamId: "stream-a",
        leaseId: "lease-a",
        holderId: "holder-a",
        ttlMs: 100,
        mode: "acquire",
        expectedFencingToken: 0,
      })],
      ["renew-lease", () => instance.renewLease({
        context: mutation("closed-renew"),
        streamId: "stream-a",
        lease: { leaseId: "lease-a", holderId: "holder-a", fencingToken: 1 },
        ttlMs: 100,
      })],
      ["release-lease", () => instance.releaseLease({
        context: mutation("closed-release"),
        streamId: "stream-a",
        lease: { leaseId: "lease-a", holderId: "holder-a", fencingToken: 1 },
      })],
      ["inspect-lease", () => instance.inspectLease({ context: AUTH, streamId: "stream-a" })],
      ["set-legal-hold", () => instance.setLegalHold({
        context: mutation("closed-hold"),
        streamId: "stream-a",
        holdId: "hold-a",
        action: "place",
      })],
      ["inspect-governance", () => instance.inspectGovernance({
        context: AUTH, streamId: "stream-a",
      })],
      ["acquire-migration-lock", () => instance.acquireMigrationLock({
        context: mutation("closed-migration"),
        lockId: "migration-a",
        ownerId: "owner-a",
        sourceSchemaVersion: 1,
        targetSchemaVersion: 2,
        ttlMs: 100,
        mode: "acquire",
        expectedFencingToken: 0,
      })],
      ["inspect-migration-lock", () => instance.inspectMigrationLock(AUTH)],
      ["release-migration-lock", () => instance.releaseMigrationLock({
        context: mutation("closed-migration-release"),
        lockId: "migration-a",
        ownerId: "owner-a",
        fencingToken: 1,
      })],
    ];
    const errors = [];
    for (const [operation, call] of calls) {
      const rejection = await expectCode(call, "GE_CYCLE_STORE_UNAVAILABLE");
      assert.equal(rejection.operation, operation);
      errors.push(rejection);
    }
    assert.deepEqual(logicalSnapshot(path), before);
    return {
      rejection: errors[0],
      zeroMutation: true,
      observation: { rejectedOperationCount: errors.length, doubleCloseHarmless: true },
    };
  }

  if (scenario === "readonly-open-failure-redaction") {
    const deniedRoot = join(root, "AUTHORIZATION_SENTINEL");
    mkdirSync(deniedRoot);
    const deniedPath = join(deniedRoot, "DATABASE_SENTINEL.db");
    const initialized = provider(deniedPath);
    initialized.close();
    stabilizeDatabase(deniedPath);
    const before = logicalSnapshot(deniedPath);
    chmodSync(deniedPath, 0o444);
    chmodSync(deniedRoot, 0o555);
    let rejection;
    try {
      rejection = await expectCode(
        () => Promise.resolve().then(() => provider(deniedPath, FIXED_NOW_MS + 1)),
        "GE_CYCLE_STORE_PERMISSION_DENIED",
      );
      const serialized = canonicalSerialize(rejection);
      assert.equal(serialized.includes(deniedPath), false);
      assert.equal(serialized.includes("SQLITE_"), false);
    } finally {
      chmodSync(deniedRoot, 0o755);
      chmodSync(deniedPath, 0o644);
    }
    assert.deepEqual(logicalSnapshot(deniedPath), before);
    return {
      rejection,
      zeroMutation: true,
      observation: { pathRedacted: true, nativeDriverTextRedacted: true },
    };
  }

  if (scenario === "full-quota-classification") {
    const connection = new SQLiteConnection(path);
    connection.execTrusted(
      "CREATE TABLE quota_probe (id INTEGER PRIMARY KEY, payload BLOB NOT NULL) STRICT",
      "append",
    );
    const pageCount = Number(connection.prepare("PRAGMA page_count", "append").get()[0]);
    connection.execTrusted(`PRAGMA max_page_count = ${pageCount}`, "append");
    const before = Number(
      connection.prepare("SELECT count(*) FROM quota_probe", "append").get()[0],
    );
    const rejection = await expectCode(
      () => Promise.resolve().then(() => connection.immediate("append", () => {
        connection.prepare(
          "INSERT INTO quota_probe (payload) VALUES (?)",
          "append",
        ).run(Buffer.alloc(900_000, 0x61));
      })),
      "GE_CYCLE_STORE_QUOTA_EXCEEDED",
    );
    const after = Number(
      connection.prepare("SELECT count(*) FROM quota_probe", "append").get()[0],
    );
    connection.close();
    assert.equal(before, 0);
    assert.equal(after, before);
    return {
      rejection,
      zeroMutation: true,
      observation: { maxPageCount: pageCount, committedRows: after },
    };
  }

  throw new TypeError(`unknown lifecycle scenario ${scenario}`);
}

async function restartScenario(scenario, root, path) {
  if (scenario === "restart-all-state-families") {
    const first = provider(path);
    const batch = await createStream(first, "stream-a", 3, "restart-all");
    const firstPage = await first.readEventPage({
      context: AUTH,
      streamId: "stream-a",
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    assert.notEqual(firstPage.nextCursor, null);
    const saved = await first.saveCheckpoint({
      context: mutation("restart-checkpoint"),
      checkpoint: createCycleStoreCheckpoint({
        checkpointScope: "scope-a",
        checkpointId: "checkpoint-a",
        streamId: "stream-a",
        boundSequence: 2,
        boundRecordHash: batch[2].recordHash,
        createdAt: "2026-07-27T00:00:00.000Z",
        value: { folded: 3 },
      }),
      lease: null,
    });
    const lease = await first.acquireLease({
      context: mutation("restart-lease"),
      streamId: "stream-a",
      leaseId: "lease-a",
      holderId: "holder-a",
      ttlMs: 10_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    await first.setLegalHold({
      context: mutation("restart-hold"),
      streamId: "stream-a",
      holdId: "hold-a",
      action: "place",
    });
    const migration = await first.acquireMigrationLock({
      context: mutation("restart-migration"),
      lockId: "migration-a",
      ownerId: "owner-a",
      sourceSchemaVersion: 1,
      targetSchemaVersion: 2,
      ttlMs: 10_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    first.close();

    const second = provider(path, FIXED_NOW_MS + 1);
    try {
      const tail = await second.readTail({ context: AUTH, streamId: "stream-a" });
      const checkpoint = await second.loadCheckpoint({
        context: AUTH,
        checkpointScope: "scope-a",
        checkpointId: "checkpoint-a",
      });
      const resumed = await second.readEventPage({
        context: AUTH,
        streamId: "stream-a",
        fromSequence: null,
        pageSize: 1,
        cursor: firstPage.nextCursor,
      });
      const inspectedLease = await second.inspectLease({ context: AUTH, streamId: "stream-a" });
      const governance = await second.inspectGovernance({ context: AUTH, streamId: "stream-a" });
      const inspectedMigration = await second.inspectMigrationLock(AUTH);
      assert.deepEqual(tail, tailFor(batch));
      assert.equal(checkpoint.checkpointId, saved.checkpointId);
      assert.deepEqual(resumed.records.map(({ sequence }) => sequence), [1]);
      assert.equal(inspectedLease.lease.fencingToken, lease.fencingToken);
      assert.deepEqual(governance.legalHoldIds, ["hold-a"]);
      assert.equal(inspectedMigration.fencingToken, migration.fencingToken);
    } finally {
      second.close();
    }
    const integrity = inspectSQLiteCycleStoreIntegrity(path, "semantic");
    assert.deepEqual(integrity.counters, {
      streams: 1,
      records: 3,
      operations: 5,
      checkpoints: 1,
      checkpointRevisions: 1,
      leases: 1,
      usedLeaseIds: 1,
      legalHolds: 1,
      cursors: 1,
      openCursors: 1,
      usedMigrationLockIds: 1,
    });
    return {
      observation: {
        stateFamilyCount: 7,
        counters: integrity.counters,
        semanticIdentityPresent: /^[0-9a-f]{64}$/u.test(integrity.semanticSha256),
      },
    };
  }

  if (scenario === "typescript-to-python-continue") {
    const first = provider(path);
    const initial = createCycleStoreRecord({
      recordId: "typescript-0",
      sequence: 0,
      previousRecordHash: null,
      value: { origin: "typescript", step: 0 },
    });
    await appendBatch(first, {
      operationId: "typescript-seed",
      streamId: "interop",
      batch: [initial],
    });
    first.close();
    const python = await runPythonWorker({
      action: "continue",
      path,
      initialTime: "2026-07-27T00:00:01.000Z",
      operationId: "python-continue",
      streamId: "interop",
      recordId: "python-1",
      value: { origin: "python", step: 1 },
    });
    const expected = createCycleStoreRecord({
      recordId: "python-1",
      sequence: 1,
      previousRecordHash: initial.recordHash,
      value: { origin: "python", step: 1 },
    });
    assert.equal(canonicalSerialize(python.record), canonicalSerialize(expected));
    const reopened = provider(path, FIXED_NOW_MS + 2_000);
    try {
      const page = await reopened.readEventPage({
        context: AUTH,
        streamId: "interop",
        fromSequence: 0,
        pageSize: 2,
        cursor: null,
      });
      assert.deepEqual(page.records.map(({ recordHash }) => recordHash), [
        initial.recordHash,
        expected.recordHash,
      ]);
    } finally {
      reopened.close();
    }
    return {
      observation: { continuedSequence: 1, recordHash: expected.recordHash, exactCanonical: true },
    };
  }

  if (scenario === "python-to-typescript-continue") {
    const python = await runPythonWorker({
      action: "seed",
      path,
      initialTime: "2026-07-27T00:00:00.000Z",
      operationId: "python-seed",
      streamId: "interop",
      recordId: "python-0",
      value: { origin: "python", step: 0 },
    });
    const expectedInitial = createCycleStoreRecord({
      recordId: "python-0",
      sequence: 0,
      previousRecordHash: null,
      value: { origin: "python", step: 0 },
    });
    assert.equal(canonicalSerialize(python.record), canonicalSerialize(expectedInitial));
    const second = provider(path, FIXED_NOW_MS + 1_000);
    const next = createCycleStoreRecord({
      recordId: "typescript-1",
      sequence: 1,
      previousRecordHash: expectedInitial.recordHash,
      value: { origin: "typescript", step: 1 },
    });
    try {
      const tail = await second.readTail({ context: AUTH, streamId: "interop" });
      assert.deepEqual(tail, tailFor([expectedInitial]));
      await appendBatch(second, {
        operationId: "typescript-continue",
        streamId: "interop",
        batch: [next],
        expectedTail: tail,
      });
    } finally {
      second.close();
    }
    return {
      observation: { continuedSequence: 1, recordHash: next.recordHash, exactCanonical: true },
    };
  }

  if (scenario === "restart-cursor-continuation") {
    const first = provider(path);
    const initial = await createStream(first, "stream-a", 3, "cursor-restart");
    const firstPage = await first.readEventPage({
      context: AUTH,
      streamId: "stream-a",
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    first.close();
    const second = provider(path, FIXED_NOW_MS + 1);
    try {
      const later = records(1, "cursor-later", 3, initial[2].recordHash);
      await appendBatch(second, {
        operationId: "cursor-later",
        streamId: "stream-a",
        batch: later,
        expectedTail: tailFor(initial),
      });
      const resumed = await second.readEventPage({
        context: AUTH,
        streamId: "stream-a",
        fromSequence: null,
        pageSize: 1,
        cursor: firstPage.nextCursor,
      });
      assert.deepEqual(resumed.records.map(({ sequence }) => sequence), [1]);
      assert.equal(resumed.snapshotTail.sequence, 2);
      assert.equal(resumed.records.some(({ sequence }) => sequence === 3), false);
      return {
        observation: {
          resumedSequence: 1,
          snapshotTailSequence: resumed.snapshotTail.sequence,
          laterRecordExcluded: true,
        },
      };
    } finally {
      second.close();
    }
  }

  if (scenario === "restart-ledger-retry") {
    const batch = records(1, "ledger-restart");
    const request = {
      operationId: "ledger-retry",
      streamId: "stream-a",
      batch,
    };
    const first = provider(path);
    const original = await appendBatch(first, request);
    first.close();
    const before = logicalSnapshot(path);
    const second = provider(path, FIXED_NOW_MS + 1);
    try {
      const replayed = await appendBatch(second, request);
      assert.deepEqual(replayed, original);
    } finally {
      second.close();
    }
    const after = logicalSnapshot(path);
    assert.deepEqual(after.counts, before.counts);
    return {
      observation: {
        operationRows: after.counts.ge_cycle_operations,
        recordRows: after.counts.ge_cycle_records,
        exactResultReplay: true,
      },
    };
  }

  if (scenario === "truncated-reopen-refusal") {
    const redactionRoot = join(root, "AUTHORIZATION_SENTINEL");
    mkdirSync(redactionRoot);
    const truncatedPath = join(redactionRoot, "DATABASE_SENTINEL.db");
    const first = provider(truncatedPath);
    await createStream(first, "stream-a", 2, "truncated");
    first.close();
    stabilizeDatabase(truncatedPath);
    const originalSize = statSync(truncatedPath).size;
    truncateSync(truncatedPath, Math.max(512, Math.floor(originalSize / 2)));
    const before = fileIdentity(truncatedPath);
    const rejection = await expectCode(
      () => Promise.resolve().then(() => provider(truncatedPath, FIXED_NOW_MS + 1)),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    assert.deepEqual(fileIdentity(truncatedPath), before);
    const envelope = canonicalSerialize(rejection);
    assert.equal(envelope.includes(truncatedPath), false);
    return {
      rejection,
      zeroMutation: true,
      observation: { truncatedBytes: originalSize - before.bytes, pathRedacted: true },
    };
  }

  throw new TypeError(`unknown restart scenario ${scenario}`);
}

async function runAppendRace(path, leftConfiguration, rightConfiguration) {
  const left = new JsonWorker({
    mode: "append",
    path,
    nowMs: FIXED_NOW_MS,
    ...leftConfiguration,
  });
  const right = new JsonWorker({
    mode: "append",
    path,
    nowMs: FIXED_NOW_MS,
    ...rightConfiguration,
  });
  try {
    await Promise.all([left.ready(), right.ready()]);
    left.send("go");
    right.send("go");
    const results = await Promise.all([left.waitFor("result"), right.waitFor("result")]);
    const exits = await Promise.all([left.waitForExit(), right.waitForExit()]);
    for (const exit of exits) assert.deepEqual(exit, { code: 0, signal: null });
    return results;
  } finally {
    await Promise.all([left.cleanup(), right.cleanup()]);
  }
}

async function concurrencyScenario(scenario, root, path) {
  if (scenario === "concurrent-empty-tail-one-winner") {
    const initialized = provider(path);
    initialized.close();
    const results = await runAppendRace(
      path,
      {
        operationId: "empty-left",
        streamId: "shared",
        recordPrefix: "empty-left",
        count: 1,
      },
      {
        operationId: "empty-right",
        streamId: "shared",
        recordPrefix: "empty-right",
        count: 1,
      },
    );
    const accepted = results.filter(({ outcome }) => outcome === "accepted");
    const rejected = results.filter(({ outcome }) => outcome === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    assertWorkerRejection(rejected[0], "GE_CYCLE_STORE_CONFLICT");
    assert.equal(tableCount(path, "ge_cycle_records"), 1);
    assert.equal(tableCount(path, "ge_cycle_operations"), 1);
    return {
      observation: {
        winners: accepted.length,
        loserCode: rejected[0].error.code,
        committedRecords: 1,
      },
    };
  }

  if (scenario === "concurrent-exact-operation-retry") {
    const initialized = provider(path);
    initialized.close();
    const configuration = {
      operationId: "exact-retry",
      streamId: "shared",
      recordPrefix: "exact-retry",
      count: 1,
    };
    const results = await runAppendRace(path, configuration, configuration);
    assert.deepEqual(results.map(({ outcome }) => outcome), ["accepted", "accepted"]);
    assert.deepEqual(results[0].result, results[1].result);
    assert.equal(tableCount(path, "ge_cycle_records"), 1);
    assert.equal(tableCount(path, "ge_cycle_operations"), 1);
    return {
      observation: {
        acceptedResults: 2,
        equalResults: true,
        committedRecords: 1,
        operationRows: 1,
      },
    };
  }

  if (scenario === "busy-release-then-success") {
    const writer = provider(path, FIXED_NOW_MS, {
      busyTimeoutMs: 50,
      maxBusyAttempts: 8,
      maxBusyElapsedMs: 2_000,
    });
    const lock = new JsonWorker({ mode: "hold-lock", path, releaseAfterMs: 150 });
    try {
      await lock.ready();
      const result = await appendBatch(writer, {
        operationId: "busy-release",
        streamId: "stream-a",
        batch: records(1, "busy-release"),
      });
      assert.equal(result.appendedRecords, 1);
      await lock.waitFor("released");
      assert.deepEqual(await lock.waitForExit(), { code: 0, signal: null });
      assert.equal(tableCount(path, "ge_cycle_records"), 1);
      return {
        observation: { committedRecords: 1, releasedAfterContention: true },
      };
    } finally {
      writer.close();
      await lock.cleanup();
    }
  }

  if (scenario === "concurrent-operation-request-drift") {
    const initialized = provider(path);
    initialized.close();
    const results = await runAppendRace(
      path,
      {
        operationId: "request-drift",
        streamId: "shared",
        recordPrefix: "request-left",
        count: 1,
      },
      {
        operationId: "request-drift",
        streamId: "shared",
        recordPrefix: "request-right",
        count: 1,
      },
    );
    const accepted = results.filter(({ outcome }) => outcome === "accepted");
    const rejected = results.filter(({ outcome }) => outcome === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(rejected.length, 1);
    const rejection = assertWorkerRejection(
      rejected[0],
      "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
    );
    assert.equal(tableCount(path, "ge_cycle_records"), 1);
    assert.equal(tableCount(path, "ge_cycle_operations"), 1);
    return {
      rejection,
      zeroMutation: true,
      observation: { committedRecords: 1, operationRows: 1, secondMutationCommitted: false },
    };
  }

  if (scenario === "busy-budget-exhaustion") {
    const writer = provider(path, FIXED_NOW_MS, {
      busyTimeoutMs: 25,
      maxBusyAttempts: 2,
      maxBusyElapsedMs: 100,
    });
    const lock = new JsonWorker({ mode: "hold-lock", path });
    try {
      await lock.ready();
      const before = logicalSnapshot(path);
      const rejection = await expectCode(
        () => appendBatch(writer, {
          operationId: "busy-exhaustion",
          streamId: "stream-a",
          batch: records(1, "busy-exhaustion"),
        }),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
      assert.equal(rejection.details.attempts, 2);
      lock.send("release");
      await lock.waitFor("released");
      await lock.waitForExit();
      const after = logicalSnapshot(path);
      assert.deepEqual(after, before);
      return {
        rejection,
        zeroMutation: true,
        observation: { attempts: rejection.details.attempts, committedRecords: 0 },
      };
    } finally {
      writer.close();
      await lock.cleanup();
    }
  }

  if (scenario === "deferred-upgrade-busy-snapshot") {
    const writer = provider(path);
    const deferred = new JsonWorker({ mode: "deferred-snapshot", path });
    try {
      await deferred.ready();
      await appendBatch(writer, {
        operationId: "snapshot-intervening-write",
        streamId: "stream-a",
        batch: records(1, "snapshot-intervening"),
      });
      const before = logicalSnapshot(path);
      deferred.send("go");
      const message = await deferred.waitFor("result");
      const rejection = assertWorkerRejection(message, "GE_CYCLE_STORE_UNAVAILABLE");
      assert.deepEqual(await deferred.waitForExit(), { code: 0, signal: null });
      const after = logicalSnapshot(path);
      assert.deepEqual(after, before);
      return {
        rejection,
        zeroMutation: true,
        observation: { busySnapshotReproduced: true, committedInterveningRecords: 1 },
      };
    } finally {
      writer.close();
      await deferred.cleanup();
    }
  }

  throw new TypeError(`unknown concurrency scenario ${scenario}`);
}

async function crashScenario(scenario, root, path) {
  if (scenario === "kill-before-commit-retry" || scenario === "kill-after-commit-before-ack-retry") {
    const initialized = provider(path);
    initialized.close();
    const beforeCommit = scenario === "kill-before-commit-retry";
    const configuration = {
      mode: "append-fault",
      path,
      nowMs: FIXED_NOW_MS,
      operationId: beforeCommit ? "kill-before" : "kill-after",
      streamId: beforeCommit ? "before-stream" : "after-stream",
      recordPrefix: beforeCommit ? "kill-before" : "kill-after",
      count: 1,
      faultBoundary: beforeCommit
        ? "provider:append:before-commit"
        : "provider:append:after-commit-before-return",
    };
    const worker = new JsonWorker(configuration);
    try {
      await worker.ready();
      worker.send("go");
      const exit = await worker.waitForExit();
      assert.deepEqual(exit, { code: null, signal: "SIGKILL" });
    } finally {
      await worker.cleanup();
    }

    const expectedBatch = records(1, configuration.recordPrefix);
    const reopened = provider(path, FIXED_NOW_MS + 1);
    try {
      const tailBeforeRetry = await reopened.readTail({
        context: AUTH,
        streamId: configuration.streamId,
      });
      assert.equal(tailBeforeRetry.exists, !beforeCommit);
      assert.equal(tableCount(path, "ge_cycle_records"), beforeCommit ? 0 : 1);
      assert.equal(tableCount(path, "ge_cycle_operations"), beforeCommit ? 0 : 1);
      const retry = await appendBatch(reopened, {
        operationId: configuration.operationId,
        streamId: configuration.streamId,
        batch: expectedBatch,
      });
      assert.equal(retry.appendedRecords, 1);
    } finally {
      reopened.close();
    }
    assert.equal(tableCount(path, "ge_cycle_records"), 1);
    assert.equal(tableCount(path, "ge_cycle_operations"), 1);
    return {
      observation: {
        killedBySignal: true,
        boundary: beforeCommit ? "before-commit" : "after-commit-before-return",
        visibleBeforeRetry: !beforeCommit,
        recordsAfterRetry: 1,
        operationRowsAfterRetry: 1,
      },
    };
  }

  if (scenario === "atomic-maximum-record-batch") {
    const instance = provider(path);
    try {
      const batch = records(64, "maximum-batch");
      const appended = await appendBatch(instance, {
        operationId: "maximum-batch",
        streamId: "stream-a",
        batch,
      });
      assert.equal(appended.appendedRecords, 64);
      assert.deepEqual(appended.tail, tailFor(batch));
      assert.equal(tableCount(path, "ge_cycle_records"), 64);
      assert.equal(tableCount(path, "ge_cycle_operations"), 1);
      return {
        observation: {
          appendedRecords: appended.appendedRecords,
          tailSequence: appended.tail.sequence,
          operationRows: 1,
        },
      };
    } finally {
      instance.close();
    }
  }

  if (scenario === "one-bad-record-batch-rollback") {
    const instance = provider(path);
    try {
      const valid = records(2, "bad-batch");
      const hostile = [valid[0], { ...valid[1], valueHash: "0".repeat(64) }];
      const before = logicalSnapshot(path);
      const rejection = await expectCode(
        () => instance.append({
          context: mutation("bad-batch"),
          streamId: "stream-a",
          expectedTail: MISSING,
          lease: null,
          records: hostile,
        }),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      const after = logicalSnapshot(path);
      assert.deepEqual(after, before);
      assert.equal(after.counts.ge_cycle_records, 0);
      assert.equal(after.counts.ge_cycle_operations, 0);
      return {
        rejection,
        zeroMutation: true,
        observation: { committedPrefixRecords: 0, operationRows: 0 },
      };
    } finally {
      instance.close();
    }
  }

  if (scenario === "stale-owner-after-process-takeover") {
    const initialProvider = provider(path);
    const initial = await createStream(initialProvider, "stream-a", 1, "stale-owner");
    initialProvider.close();
    const stale = new JsonWorker({
      mode: "stale-lease",
      path,
      nowMs: FIXED_NOW_MS,
      appendNowMs: FIXED_NOW_MS + 100,
      streamId: "stream-a",
      ttlMs: 100,
      expectedTail: tailFor(initial),
    });
    try {
      const ready = await stale.ready();
      assert.equal(ready.lease.fencingToken, 1);
      const replacement = provider(path, FIXED_NOW_MS + 100);
      try {
        const takeover = await replacement.acquireLease({
          context: mutation("takeover-lease"),
          streamId: "stream-a",
          leaseId: "replacement-lease",
          holderId: "replacement-holder",
          ttlMs: 100,
          mode: "takeover",
          expectedFencingToken: 1,
        });
        assert.equal(takeover.fencingToken, 2);
      } finally {
        replacement.close();
      }
      const before = logicalSnapshot(path);
      stale.send("go");
      const message = await stale.waitFor("result");
      const rejection = assertWorkerRejection(message, "GE_CYCLE_STORE_STALE_FENCE");
      assert.deepEqual(await stale.waitForExit(), { code: 0, signal: null });
      const after = logicalSnapshot(path);
      assert.deepEqual(after, before);
      assert.equal(after.counts.ge_cycle_records, 1);
      return {
        rejection,
        zeroMutation: true,
        observation: { replacementFencingToken: 2, staleMutationCommitted: false },
      };
    } finally {
      await stale.cleanup();
    }
  }

  if (scenario === "ledger-mutation-split-corruption") {
    const instance = provider(path);
    await createStream(instance, "stream-a", 1, "ledger-split");
    instance.close();
    stabilizeDatabase(path);
    const db = database(path);
    const changed = db.prepare(
      "UPDATE ge_cycle_operations SET result_hash = ? WHERE operation_id = ?",
    ).run("f".repeat(64), "create-stream-a");
    assert.equal(Number(changed.changes), 1);
    db.close();
    stabilizeDatabase(path);
    assert.equal(inspectSQLiteCycleStoreIntegrity(path, "structural").integrityCheck, "ok");
    const before = fileIdentity(path);
    const rejection = await expectCode(
      () => Promise.resolve().then(() => inspectSQLiteCycleStoreIntegrity(path, "semantic")),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    assert.deepEqual(fileIdentity(path), before);
    return {
      rejection,
      zeroMutation: true,
      observation: { structuralCheck: "ok", splitDetected: true, auditReadOnly: true },
    };
  }

  throw new TypeError(`unknown crash scenario ${scenario}`);
}

async function seedBackupState(path) {
  const instance = provider(path);
  try {
    const batch = records(3, "backup-state");
    const appendRequest = {
      operationId: "backup-append",
      streamId: "stream-a",
      batch,
    };
    const appended = await appendBatch(instance, appendRequest);
    const firstPage = await instance.readEventPage({
      context: AUTH,
      streamId: "stream-a",
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    const lease = await instance.acquireLease({
      context: mutation("backup-lease"),
      streamId: "stream-a",
      leaseId: "backup-lease",
      holderId: "backup-holder",
      ttlMs: 10_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    await instance.setLegalHold({
      context: mutation("backup-hold"),
      streamId: "stream-a",
      holdId: "backup-hold",
      action: "place",
    });
    const migration = await instance.acquireMigrationLock({
      context: mutation("backup-migration"),
      lockId: "backup-migration",
      ownerId: "backup-owner",
      sourceSchemaVersion: 1,
      targetSchemaVersion: 2,
      ttlMs: 10_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    return { instance, batch, appendRequest, appended, firstPage, lease, migration };
  } catch (error) {
    instance.close();
    throw error;
  }
}

async function backupScenario(scenario, root, path) {
  if (scenario === "live-wal-online-backup") {
    const instance = provider(path);
    let batch;
    let report;
    const backupPath = join(root, "live-backup.db");
    const restoredPath = join(root, "live-restored.db");
    try {
      batch = await createStream(instance, "stream-a", 3, "live-wal");
      const walPath = `${path}-wal`;
      assert.equal(existsSync(walPath), true);
      assert.ok(statSync(walPath).size > 0);
      report = await createSQLiteCycleStoreBackup(path, backupPath, { ratePages: 1 });
      assert.equal(report.integrity.counters.records, 3);
    } finally {
      instance.close();
    }
    const restored = await restoreSQLiteCycleStoreBackup(backupPath, restoredPath, { ratePages: 1 });
    assert.equal(restored.integrity.counters.records, 3);
    const reopened = provider(restoredPath, FIXED_NOW_MS + 1);
    try {
      assert.deepEqual(
        await reopened.readTail({ context: AUTH, streamId: "stream-a" }),
        tailFor(batch),
      );
    } finally {
      reopened.close();
    }
    return {
      observation: {
        uncheckpointedWalPresent: true,
        backedUpRecords: report.integrity.counters.records,
        restoredRecords: restored.integrity.counters.records,
      },
    };
  }

  if (scenario === "concurrent-write-backup-checkpoint-busy") {
    const initialized = provider(path);
    initialized.close();
    const reader = new JsonWorker({ mode: "read-snapshot", path });
    const writer = new JsonWorker({
      mode: "bounded-writer",
      path,
      nowMs: FIXED_NOW_MS + 1,
      streamCount: 32,
    });
    const backupPath = join(root, "concurrent-backup.db");
    try {
      await reader.ready();
      await writer.ready();
      writer.send("go");
      const backupPromise = createSQLiteCycleStoreBackup(path, backupPath, { ratePages: 1 });
      const [backup, writeResult] = await Promise.all([
        backupPromise,
        writer.waitFor("result"),
      ]);
      assert.equal(writeResult.outcome, "accepted");
      assert.equal(writeResult.result.writes, 32);
      assert.deepEqual(await writer.waitForExit(), { code: 0, signal: null });

      const checkpointConnection = database(path, { timeout: 0 });
      const checkpointRow = checkpointConnection.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      checkpointConnection.close();
      const [busy, logFrames, checkpointedFrames] = Object.values(checkpointRow).map(Number);
      assert.equal(busy, 1);
      assert.ok(logFrames > 0);
      assert.ok(checkpointedFrames >= 0 && checkpointedFrames <= logFrames);
      reader.send("release");
      await reader.waitFor("released");
      assert.deepEqual(await reader.waitForExit(), { code: 0, signal: null });
      const audited = inspectSQLiteCycleStoreIntegrity(backupPath, "semantic");
      assert.equal(audited.semanticSha256, backup.integrity.semanticSha256);
      return {
        observation: {
          boundedWrites: writeResult.result.writes,
          checkpointBusy: busy,
          backupSemanticValid: true,
        },
      };
    } finally {
      await Promise.all([reader.cleanup(), writer.cleanup()]);
    }
  }

  if (scenario === "restored-ledger-fence-cursor-identities") {
    const state = await seedBackupState(path);
    const backupPath = join(root, "identity-backup.db");
    const restoredPath = join(root, "identity-restored.db");
    let sourceIntegrity;
    let backup;
    try {
      sourceIntegrity = inspectSQLiteCycleStoreIntegrity(path, "semantic");
      backup = await createSQLiteCycleStoreBackup(path, backupPath, { ratePages: 1 });
    } finally {
      state.instance.close();
    }
    const restored = await restoreSQLiteCycleStoreBackup(backupPath, restoredPath, {
      ratePages: 1,
    });
    assert.equal(backup.integrity.semanticSha256, sourceIntegrity.semanticSha256);
    assert.equal(restored.integrity.semanticSha256, sourceIntegrity.semanticSha256);
    assert.equal(restored.integrity.descriptorHash, SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
    assert.equal(restored.integrity.schemaIdentitySha256, SQLITE_SCHEMA_IDENTITY_SHA256);

    const reopened = provider(restoredPath, FIXED_NOW_MS + 1);
    try {
      assert.deepEqual(await appendBatch(reopened, state.appendRequest), state.appended);
      const continuation = await reopened.readEventPage({
        context: AUTH,
        streamId: "stream-a",
        fromSequence: null,
        pageSize: 1,
        cursor: state.firstPage.nextCursor,
      });
      assert.deepEqual(continuation.records.map(({ sequence }) => sequence), [1]);
      const lease = await reopened.inspectLease({ context: AUTH, streamId: "stream-a" });
      const governance = await reopened.inspectGovernance({ context: AUTH, streamId: "stream-a" });
      const migration = await reopened.inspectMigrationLock(AUTH);
      assert.equal(lease.lease.fencingToken, state.lease.fencingToken);
      assert.deepEqual(governance.legalHoldIds, ["backup-hold"]);
      assert.equal(migration.fencingToken, state.migration.fencingToken);
    } finally {
      reopened.close();
    }
    return {
      observation: {
        semanticIdentityPreserved: true,
        descriptorIdentityPreserved: true,
        schemaIdentityPreserved: true,
        ledgerReplayExact: true,
        cursorContinued: true,
        fencingToken: state.lease.fencingToken,
      },
    };
  }

  if (scenario === "backup-existing-target-refusal") {
    const instance = provider(path);
    try {
      await createStream(instance, "stream-a", 1, "existing-target");
      const sourceBefore = logicalSnapshot(path);
      const target = join(root, "existing-target.db");
      writeFileSync(target, "EXISTING_TARGET_BYTES", { encoding: "utf8", mode: 0o600 });
      const targetBefore = fileIdentity(target);
      const rejection = await expectCode(
        () => createSQLiteCycleStoreBackup(path, target),
        "GE_CYCLE_STORE_CONFLICT",
      );
      assert.deepEqual(fileIdentity(target), targetBefore);
      assert.equal(existsSync(`${target}.manifest.json`), false);
      assert.deepEqual(logicalSnapshot(path), sourceBefore);
      return {
        rejection,
        zeroMutation: true,
        observation: { targetBytesPreserved: true, manifestPublished: false },
      };
    } finally {
      instance.close();
    }
  }

  if (scenario === "backup-source-alias-refusal") {
    const instance = provider(path);
    await createStream(instance, "stream-a", 1, "source-alias");
    instance.close();
    stabilizeDatabase(path);
    const alias = join(root, "source-alias.db");
    linkSync(path, alias);
    assert.equal(realpathSync(dirname(alias)), realpathSync(dirname(path)));
    const sourceBefore = fileIdentity(path);
    const aliasBefore = fileIdentity(alias);
    const rejection = await expectCode(
      () => createSQLiteCycleStoreBackup(path, alias),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    assert.deepEqual(fileIdentity(path), sourceBefore);
    assert.deepEqual(fileIdentity(alias), aliasBefore);
    assert.equal(lstatSync(path).ino, lstatSync(alias).ino);
    return {
      rejection,
      zeroMutation: true,
      observation: { hardLinkAliasDetected: true, sourceBytesPreserved: true },
    };
  }

  throw new TypeError(`unknown backup scenario ${scenario}`);
}

async function dispatchScenario(item, root, path) {
  if (item.category === "bootstrap") {
    return bootstrapScenario(item.scenario, root, path);
  }
  if (item.category === "migration-integrity") {
    return migrationScenario(item.scenario, root, path);
  }
  if (item.category === "lifecycle-error") {
    return lifecycleScenario(item.scenario, root, path);
  }
  if (item.category === "restart-interop") {
    return restartScenario(item.scenario, root, path);
  }
  if (item.category === "concurrency") {
    return concurrencyScenario(item.scenario, root, path);
  }
  if (item.category === "crash-recovery") {
    return crashScenario(item.scenario, root, path);
  }
  if (item.category === "backup-restore") {
    return backupScenario(item.scenario, root, path);
  }
  throw new TypeError(`unknown SQLite campaign category ${item.category}`);
}

async function exerciseScenario(item) {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-campaign-"));
  const path = join(root, "cycle-store.db");
  const childrenBefore = new Set(activeChildren);
  try {
    const result = await dispatchScenario(item, root, path);
    if (item.polarity === "attack") {
      assert.ok(result.rejection !== undefined, `${item.id} omitted its typed rejection`);
      assert.equal(result.rejection.code, item.expectCode, `${item.id} returned the wrong code`);
      assert.ok(CYCLE_STORE_PROVIDER_ERROR_CODES.includes(result.rejection.code));
      assert.equal(result.zeroMutation, true, `${item.id} did not prove zero mutation`);
      return Object.freeze({
        id: item.id,
        category: item.category,
        polarity: item.polarity,
        scenario: item.scenario,
        outcome: "rejected",
        code: result.rejection.code,
        operation: result.rejection.operation,
        retryable: result.rejection.retryable,
        zeroMutation: true,
        observation: result.observation,
      });
    }
    assert.equal(result.rejection, undefined, `${item.id} behavior returned a rejection`);
    assert.equal(item.expectOutcome, "accepted");
    assert.equal(item.expectCode, null);
    return Object.freeze({
      id: item.id,
      category: item.category,
      polarity: item.polarity,
      scenario: item.scenario,
      outcome: "accepted",
      code: null,
      operation: null,
      retryable: null,
      zeroMutation: null,
      observation: result.observation,
    });
  } finally {
    for (const child of [...activeChildren]) {
      if (childrenBefore.has(child)) continue;
      await terminateChild(child);
    }
    cleanupTemporaryRoot(root);
  }
}

function validateFixture(fixture, fixtureBytes) {
  assert.equal(fixtureBytes.byteLength, FIXTURE_BYTES);
  assert.equal(sha256(fixtureBytes), FIXTURE_SHA256);
  assert.deepEqual(Object.keys(fixture).sort(), [
    "cases",
    "expect",
    "id",
    "migrationManifest",
    "providerContractVersion",
    "schemaVersion",
  ]);
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.id, "sqlite-cycle-store-v1");
  assert.equal(fixture.providerContractVersion, CYCLE_STORE_PROVIDER_CONTRACT_VERSION);
  assert.equal(fixture.migrationManifest, "spec/migrations/sqlite/manifest.json");
  assert.equal(fixture.cases.length, 36);
  assert.equal(new Set(fixture.cases.map(({ id }) => id)).size, 36);
  assert.equal(new Set(fixture.cases.map(({ scenario }) => scenario)).size, 36);
  for (const item of fixture.cases) {
    assert.deepEqual(Object.keys(item).sort(), [
      "assertion",
      "category",
      "expectCode",
      "expectOutcome",
      "id",
      "polarity",
      "scenario",
    ]);
  }
  const casesCanonical = canonicalSerialize(fixture.cases);
  assert.equal(Buffer.byteLength(casesCanonical, "utf8"), fixture.expect.casesCanonicalUtf8Bytes);
  assert.equal(sha256(Buffer.from(casesCanonical, "utf8")), fixture.expect.casesSha256);
  assert.equal(fixture.expect.caseCount, 36);
  assert.equal(fixture.expect.behaviorCaseCount, 18);
  assert.equal(fixture.expect.attackCaseCount, 18);
  assert.deepEqual(categoryCounts(fixture.cases), fixture.expect.categoryCounts);
  return casesCanonical;
}

export async function exerciseSQLiteCycleStoreCampaign(options = {}) {
  workerCount = 0;
  barrierCount = 0;
  assert.equal(activeChildren.size, 0, "a prior SQLite campaign leaked child processes");
  const fixtureBytes = readFileSync(options.fixturePath ?? FIXTURE_PATH);
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  const casesCanonical = validateFixture(fixture, fixtureBytes);
  const selected = options.onlyCategories === undefined
    ? fixture.cases
    : fixture.cases.filter(({ category }) => options.onlyCategories.includes(category));
  assert.ok(selected.length > 0, "SQLite campaign selected no cases");
  const caseResults = [];
  for (const item of selected) caseResults.push(await exerciseScenario(item));
  assert.equal(activeChildren.size, 0, "SQLite campaign leaked a child PID");

  const behaviorCaseCount = caseResults.filter(({ polarity }) => polarity === "behavior").length;
  const attackCaseCount = caseResults.filter(({ polarity }) => polarity === "attack").length;
  const fullCampaign = selected.length === fixture.cases.length;
  if (fullCampaign) {
    assert.equal(caseResults.length, fixture.expect.caseCount);
    assert.equal(behaviorCaseCount, fixture.expect.behaviorCaseCount);
    assert.equal(attackCaseCount, fixture.expect.attackCaseCount);
    assert.deepEqual(categoryCounts(caseResults), fixture.expect.categoryCounts);
  }
  const report = {
    campaign: fixture.id,
    schemaVersion: fixture.schemaVersion,
    providerContractVersion: fixture.providerContractVersion,
    migrationManifest: fixture.migrationManifest,
    fixtureUtf8Bytes: fixtureBytes.byteLength,
    fixtureSha256: sha256(fixtureBytes),
    casesCanonicalUtf8Bytes: Buffer.byteLength(casesCanonical, "utf8"),
    casesSha256: sha256(Buffer.from(casesCanonical, "utf8")),
    caseCount: caseResults.length,
    behaviorCaseCount,
    attackCaseCount,
    categoryCounts: categoryCounts(caseResults),
    typedRejectionCount: caseResults.filter(({ code }) => code !== null).length,
    zeroMutationAttackCount: caseResults.filter(({ zeroMutation }) => zeroMutation === true).length,
    childProcessCount: workerCount,
    jsonBarrierCount: barrierCount,
    childPidCleanup: "clean",
    caseResults,
    leakSentinelScan: "clean",
  };
  const reportText = canonicalSerialize(report);
  for (const sentinel of SENTINELS) assert.equal(reportText.includes(sentinel), false);
  assert.equal(reportText.includes('"pending"'), false);
  assert.equal(reportText.includes('"skipped"'), false);
  return Object.freeze(report);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === MODULE_PATH) {
  const report = await exerciseSQLiteCycleStoreCampaign();
  process.stdout.write(`${canonicalSerialize(report)}\n`);
}
