#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalHash,
  canonicalSerialize,
} from "../../packages/core/dist/index.js";
import {
  CycleStoreProviderError,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  cycleStoreAdapterCodec,
} from "../../packages/runtime/dist/index.js";
import {
  SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
  SQLITE_BACKUP_MANIFEST_API_VERSION,
  SQLITE_BACKUP_MANIFEST_DOMAIN,
  SQLITE_CYCLE_STORE_APPLICATION_ID,
  SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  SQLITE_CYCLE_STORE_PROVIDER_ID,
  SQLITE_CYCLE_STORE_SCHEMA_VERSION,
  SQLITE_MIGRATION_MANIFEST_SHA256,
  SQLITE_SCHEMA_CATALOG_SHA256,
  SQLITE_SCHEMA_IDENTITY_DOCUMENT_SHA256,
  SQLITE_SCHEMA_IDENTITY_SHA256,
  SQLITE_SCHEMA_SQL_SHA256,
  SQLiteCycleStoreProvider,
  createSQLiteCycleStoreBackup,
  createSQLiteCycleStoreDescriptor,
  inspectSQLiteCycleStoreIntegrity,
  restoreSQLiteCycleStoreBackup,
} from "../../packages/sqlite/dist/index.js";

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = dirname(dirname(dirname(MODULE_PATH)));
const PYTHON_WORKER_PATH = join(
  REPOSITORY_ROOT,
  "tools",
  "conformance",
  "workers",
  "sqlite_interop_python_worker.py",
);
const PYTHON_EXECUTABLE = process.platform === "win32"
  ? join(REPOSITORY_ROOT, "python", ".venv", "Scripts", "python.exe")
  : join(REPOSITORY_ROOT, "python", ".venv", "bin", "python");
const TEMPORARY_PREFIX = "graph-engineering-sqlite-interop-";
const WORKER_TIMEOUT_MS = 20_000;
const MAX_PROTOCOL_LINE_BYTES = 1_048_576;
const MAX_STDERR_BYTES = 16_384;
const MAX_CURSOR_PAGES = 8;
const T0 = "2026-07-27T00:00:00.000Z";
const T1 = "2026-07-27T00:00:02.000Z";
const T_LEASE_TAKEOVER = "2026-07-27T00:00:03.000Z";
const AUTH = Object.freeze({
  tenantId: "interop-tenant",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const MISSING = Object.freeze({ exists: false, sequence: -1, recordHash: null });
const LEAK_SENTINELS = Object.freeze([
  "TS_RACE_PAYLOAD_SENTINEL",
  "PYTHON_RACE_PAYLOAD_SENTINEL",
  "INTEROP_AUTHORIZATION_SENTINEL",
]);
const activeChildren = new Set();
let childProcessCount = 0;
let jsonBarrierCount = 0;

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

async function appendBatch(store, {
  operationId,
  streamId,
  batch,
  expectedTail = MISSING,
  lease = null,
}) {
  return store.append({
    context: mutation(operationId),
    streamId,
    expectedTail,
    lease,
    records: batch,
  });
}

function leaseBinding(lease) {
  return Object.freeze({
    leaseId: lease.leaseId,
    holderId: lease.holderId,
    fencingToken: lease.fencingToken,
  });
}

function provider(path, clock = { value: T0 }) {
  return new SQLiteCycleStoreProvider(path, {
    now: () => new Date(clock.value),
  });
}

function semanticComparable(report) {
  const { sqliteVersion: _sqliteVersion, ...portable } = report;
  return portable;
}

function assertSemanticEqual(left, right, label) {
  assert.equal(
    canonicalSerialize(semanticComparable(left)),
    canonicalSerialize(semanticComparable(right)),
    `${label} semantic audit differs across runtimes`,
  );
}

function assertAccepted(message, label) {
  assert.equal(message.type, "result", `${label} returned the wrong protocol message`);
  assert.equal(
    message.outcome,
    "accepted",
    `${label} was not accepted; code=${message.error?.code ?? "none"}; `
      + `message=${message.error?.message ?? "none"}`,
  );
  assert.equal(typeof message.value, "object", `${label} returned no value`);
  assert.notEqual(message.value, null, `${label} returned null`);
  return message.value;
}

function assertRejected(message, code, operation, label) {
  assert.equal(message.type, "result", `${label} returned the wrong protocol message`);
  assert.equal(message.outcome, "rejected", `${label} was not rejected`);
  assert.deepEqual(Object.keys(message.error).sort(), [
    "code",
    "details",
    "message",
    "name",
    "operation",
    "retryable",
  ]);
  assert.equal(message.error.name, "CycleStoreProviderError");
  assert.equal(message.error.code, code);
  assert.equal(message.error.operation, operation);
  assert.equal(typeof message.error.retryable, "boolean");
  const serialized = canonicalSerialize(message.error);
  assert.equal(serialized.includes("stack"), false);
  assert.equal(serialized.includes("cause"), false);
  for (const sentinel of LEAK_SENTINELS) assert.equal(serialized.includes(sentinel), false);
  return message.error;
}

function serializeTypeScriptError(error) {
  assert.ok(error instanceof CycleStoreProviderError, "TypeScript rejection is not typed");
  const serialized = error.toJSON();
  const text = canonicalSerialize(serialized);
  assert.equal(text.includes("stack"), false);
  assert.equal(text.includes("cause"), false);
  for (const sentinel of LEAK_SENTINELS) assert.equal(text.includes(sentinel), false);
  return serialized;
}

function cleanupTemporaryRoot(root) {
  const resolved = resolve(root);
  assert.equal(dirname(resolved), resolve(tmpdir()), "temporary cleanup escaped the OS temp root");
  assert.ok(
    basename(resolved).startsWith(TEMPORARY_PREFIX),
    "temporary cleanup rejected an unowned path",
  );
  rmSync(resolved, { recursive: true, force: true });
}

function temporaryRootNames() {
  return new Set(
    readdirSync(tmpdir()).filter((name) => name.startsWith(TEMPORARY_PREFIX)),
  );
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
      assert.notEqual(
        await childExitWithin(child, 5_000),
        null,
        "SQLite interop child resisted bounded SIGKILL cleanup",
      );
    }
  }
  activeChildren.delete(child);
}

class PythonJsonWorker {
  constructor(configuration) {
    this.messages = [];
    this.waiters = [];
    this.stdoutRemainder = "";
    this.stderr = "";
    this.protocolError = null;
    assert.ok(
      existsSync(PYTHON_EXECUTABLE),
      "Python interop requires `uv sync --project python --extra dev` first",
    );
    this.child = spawn(PYTHON_EXECUTABLE, [
      PYTHON_WORKER_PATH,
      JSON.stringify(configuration),
    ], {
      cwd: REPOSITORY_ROOT,
      env: { ...process.env, PYTHONUTF8: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    childProcessCount += 1;
    activeChildren.add(this.child);
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-MAX_STDERR_BYTES);
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#consume(chunk));
    this.exit = new Promise((resolveExit) => {
      this.child.once("error", () => {
        this.#failProtocol("SQLite interop worker failed to spawn");
      });
      this.child.once("exit", (code, signal) => {
        activeChildren.delete(this.child);
        resolveExit({ code, signal });
      });
    });
  }

  #failProtocol(message) {
    if (this.protocolError !== null) return;
    this.protocolError = new Error(message);
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(this.protocolError);
    }
  }

  #consume(chunk) {
    this.stdoutRemainder += chunk;
    if (Buffer.byteLength(this.stdoutRemainder, "utf8") > MAX_PROTOCOL_LINE_BYTES) {
      this.#failProtocol("SQLite interop worker exceeded its bounded protocol line");
      return;
    }
    while (true) {
      const newline = this.stdoutRemainder.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutRemainder.slice(0, newline);
      this.stdoutRemainder = this.stdoutRemainder.slice(newline + 1);
      if (line.length === 0) continue;
      if (Buffer.byteLength(line, "utf8") > MAX_PROTOCOL_LINE_BYTES) {
        this.#failProtocol("SQLite interop worker emitted an oversized message");
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        this.#failProtocol("SQLite interop worker emitted invalid JSON");
        return;
      }
      if (message === null || typeof message !== "object" || typeof message.type !== "string") {
        this.#failProtocol("SQLite interop worker emitted an invalid envelope");
        return;
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
    if (this.protocolError !== null) return Promise.reject(this.protocolError);
    const existing = this.messages.findIndex((message) => message.type === type);
    if (existing >= 0) return Promise.resolve(this.messages.splice(existing, 1)[0]);
    return new Promise((resolveWaiter, rejectWaiter) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolveWaiter);
        if (index >= 0) this.waiters.splice(index, 1);
        rejectWaiter(new Error(`SQLite interop worker timed out waiting for ${type}`));
      }, timeoutMs);
      this.waiters.push({ type, resolve: resolveWaiter, reject: rejectWaiter, timer });
    });
  }

  async ready() {
    const message = await this.waitFor("ready");
    assert.equal(message.pid, this.child.pid, "worker ready PID did not match the spawned PID");
    jsonBarrierCount += 1;
    return message;
  }

  sendGo() {
    assert.equal(this.child.exitCode, null, "cannot signal an exited SQLite interop worker");
    assert.equal(this.child.signalCode, null, "cannot signal a terminated SQLite interop worker");
    this.child.stdin.write(`${JSON.stringify({ type: "go" })}\n`);
    jsonBarrierCount += 1;
  }

  async result() {
    const message = await this.waitFor("result");
    jsonBarrierCount += 1;
    const exited = await this.waitForExit();
    assert.deepEqual(
      exited,
      { code: 0, signal: null },
      `SQLite interop worker failed safely; stderrBytes=${Buffer.byteLength(this.stderr, "utf8")}`,
    );
    return message;
  }

  async waitForExit(timeoutMs = WORKER_TIMEOUT_MS) {
    let timer;
    try {
      return await Promise.race([
        this.exit,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("SQLite interop worker exit timed out")),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async cleanup() {
    await terminateChild(this.child);
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("SQLite interop worker cleaned up"));
    }
    assert.equal(activeChildren.has(this.child), false, "SQLite interop child PID leaked");
  }
}

async function runPython(configuration) {
  const worker = new PythonJsonWorker(configuration);
  try {
    await worker.ready();
    worker.sendGo();
    return await worker.result();
  } finally {
    await worker.cleanup();
  }
}

async function stateSummary(store, configuration, cursorContinuation) {
  const [descriptor, schema, page, checkpoint, lease, governance, tail] = await Promise.all([
    store.describe(),
    store.inspectSchema(AUTH),
    store.readEventPage({
      context: AUTH,
      streamId: configuration.streamId,
      fromSequence: 0,
      pageSize: 256,
      cursor: null,
    }),
    store.loadCheckpoint({
      context: AUTH,
      checkpointScope: configuration.checkpointScope,
      checkpointId: configuration.checkpointId,
    }),
    store.inspectLease({ context: AUTH, streamId: configuration.streamId }),
    store.inspectGovernance({ context: AUTH, streamId: configuration.streamId }),
    store.readTail({ context: AUTH, streamId: configuration.streamId }),
  ]);
  return {
    descriptorHash: descriptor.descriptorHash,
    schemaVersion: schema.schemaVersion,
    tail,
    records: page.records,
    checkpoint,
    lease,
    governance,
    cursorContinuation,
  };
}

async function seedTypeScriptState(path, configuration) {
  const store = provider(path);
  const prefix = configuration.prefix;
  try {
    const batch = records(3, prefix);
    const appended = await appendBatch(store, {
      operationId: `${prefix}-append`,
      streamId: configuration.streamId,
      batch,
    });
    const checkpoint = createCycleStoreCheckpoint({
      checkpointScope: configuration.checkpointScope,
      checkpointId: configuration.checkpointId,
      streamId: configuration.streamId,
      boundSequence: 2,
      boundRecordHash: batch[2].recordHash,
      createdAt: configuration.checkpointCreatedAt,
      value: { source: prefix, state: "checkpoint" },
    });
    await store.saveCheckpoint({
      context: mutation(`${prefix}-checkpoint-save`),
      checkpoint,
      lease: null,
    });
    const firstLease = await store.acquireLease({
      context: mutation(`${prefix}-lease-one-acquire`),
      streamId: configuration.streamId,
      leaseId: `${prefix}-lease-one`,
      holderId: `${prefix}-holder-one`,
      ttlMs: 10_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    const firstBinding = leaseBinding(firstLease);
    await store.renewLease({
      context: mutation(`${prefix}-lease-one-renew`),
      streamId: configuration.streamId,
      lease: firstBinding,
      ttlMs: 20_000,
    });
    await store.releaseLease({
      context: mutation(`${prefix}-lease-one-release`),
      streamId: configuration.streamId,
      lease: firstBinding,
    });
    const secondLease = await store.acquireLease({
      context: mutation(`${prefix}-lease-two-acquire`),
      streamId: configuration.streamId,
      leaseId: `${prefix}-lease-two`,
      holderId: `${prefix}-holder-two`,
      ttlMs: 10_000,
      mode: "acquire",
      expectedFencingToken: 1,
    });
    await store.releaseLease({
      context: mutation(`${prefix}-lease-two-release`),
      streamId: configuration.streamId,
      lease: leaseBinding(secondLease),
    });
    await store.setLegalHold({
      context: mutation(`${prefix}-hold-place`),
      streamId: configuration.streamId,
      holdId: `${prefix}-hold`,
      action: "place",
    });
    const firstPage = await store.readEventPage({
      context: AUTH,
      streamId: configuration.streamId,
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    assert.equal(firstPage.records.length, 1);
    assert.equal(typeof firstPage.nextCursor, "string");
    const cursorContinuation = {
      record: batch[1],
      snapshotTail: appended.tail,
      hasNextCursor: true,
    };
    const summary = await stateSummary(store, configuration, cursorContinuation);
    return {
      summary,
      publicCanonicalSha256: canonicalHash(summary),
      cursor: firstPage.nextCursor,
    };
  } finally {
    store.close();
  }
}

function stateConfiguration(path, prefix) {
  return {
    path,
    now: T0,
    prefix,
    streamId: `${prefix}-stream`,
    checkpointScope: `${prefix}-scope`,
    checkpointId: `${prefix}-checkpoint`,
    checkpointCreatedAt: T0,
  };
}

async function caseTypeScriptToPython(root) {
  const path = join(root, "typescript-to-python.db");
  const configuration = stateConfiguration(path, "ts-seed");
  const typescript = await seedTypeScriptState(path, configuration);
  const python = assertAccepted(await runPython({
    mode: "validate-state",
    ...configuration,
    cursor: typescript.cursor,
  }), "TypeScript-to-Python validation");
  assert.equal(canonicalSerialize(python.summary), canonicalSerialize(typescript.summary));
  assert.equal(python.publicCanonicalSha256, typescript.publicCanonicalSha256);
  const typescriptAudit = inspectSQLiteCycleStoreIntegrity(path, "semantic");
  assertSemanticEqual(typescriptAudit, python.audit, "TypeScript-to-Python");
  assert.deepEqual(typescriptAudit.counters, {
    streams: 1,
    records: 3,
    operations: 8,
    checkpoints: 1,
    checkpointRevisions: 1,
    leases: 1,
    usedLeaseIds: 2,
    legalHolds: 1,
    cursors: 1,
    openCursors: 1,
    usedMigrationLockIds: 0,
  });
  return {
    id: "typescript-create-python-validate",
    status: "passed",
    canonicalPublicBytesExact: true,
    semanticDatabaseIdentityExact: true,
    verifiedFamilies: [
      "records",
      "checkpoint",
      "checkpoint-history",
      "lease-history",
      "legal-hold",
      "event-cursor",
      "operation-ledger",
    ],
    counters: typescriptAudit.counters,
  };
}

async function casePythonToTypeScript(root) {
  const path = join(root, "python-to-typescript.db");
  const configuration = stateConfiguration(path, "py-seed");
  const pythonSeed = assertAccepted(await runPython({
    mode: "seed-state",
    ...configuration,
  }), "Python state seed");
  const store = provider(path);
  let typescriptSummary;
  try {
    const continuation = await store.readEventPage({
      context: AUTH,
      streamId: configuration.streamId,
      fromSequence: null,
      pageSize: 1,
      cursor: pythonSeed.cursor,
    });
    assert.equal(continuation.records.length, 1);
    typescriptSummary = await stateSummary(store, configuration, {
      record: continuation.records[0],
      snapshotTail: continuation.snapshotTail,
      hasNextCursor: continuation.nextCursor !== null,
    });
  } finally {
    store.close();
  }
  assert.equal(canonicalSerialize(typescriptSummary), canonicalSerialize(pythonSeed.summary));
  assert.equal(canonicalHash(typescriptSummary), pythonSeed.publicCanonicalSha256);
  const typescriptAudit = inspectSQLiteCycleStoreIntegrity(path, "semantic");
  const pythonAudit = assertAccepted(await runPython({
    mode: "audit-state",
    ...configuration,
  }), "Python post-TypeScript audit");
  assert.equal(pythonAudit.descriptor.descriptorHash, SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
  assert.equal(pythonAudit.schema.descriptorHash, SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
  assertSemanticEqual(typescriptAudit, pythonAudit.audit, "Python-to-TypeScript");
  return {
    id: "python-create-typescript-validate",
    status: "passed",
    canonicalPublicBytesExact: true,
    semanticDatabaseIdentityExact: true,
    verifiedFamilies: [
      "records",
      "checkpoint",
      "checkpoint-history",
      "lease-history",
      "legal-hold",
      "event-cursor",
      "operation-ledger",
    ],
    counters: typescriptAudit.counters,
  };
}

async function caseEventSnapshot(root) {
  const path = join(root, "event-snapshot.db");
  const clock = { value: T0 };
  const store = provider(path, clock);
  const streamId = "event-snapshot-stream";
  const prefix = "event-snapshot";
  try {
    const original = records(3, prefix);
    const appended = await appendBatch(store, {
      operationId: "event-snapshot-seed",
      streamId,
      batch: original,
    });
    const first = await store.readEventPage({
      context: AUTH,
      streamId,
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    assert.equal(typeof first.nextCursor, "string");
    const pythonAppend = assertAccepted(await runPython({
      mode: "append-continuation",
      path,
      now: T1,
      prefix,
      streamId,
      operationId: "event-snapshot-python-append",
      value: { runtime: "python" },
    }), "Python event append");
    assert.equal(pythonAppend.record.sequence, 3);
    clock.value = T1;
    const snapshotRecords = [...first.records];
    let cursor = first.nextCursor;
    for (let pageIndex = 0; cursor !== null && pageIndex < MAX_CURSOR_PAGES; pageIndex += 1) {
      const page = await store.readEventPage({
        context: AUTH,
        streamId,
        fromSequence: null,
        pageSize: 1,
        cursor,
      });
      assert.deepEqual(page.snapshotTail, appended.tail);
      snapshotRecords.push(...page.records);
      cursor = page.nextCursor;
    }
    assert.equal(cursor, null, "event snapshot cursor exceeded its page bound");
    const live = await store.readEventPage({
      context: AUTH,
      streamId,
      fromSequence: 0,
      pageSize: 256,
      cursor: null,
    });
    assert.deepEqual(snapshotRecords.map(({ sequence }) => sequence), [0, 1, 2]);
    assert.deepEqual(live.records.map(({ sequence }) => sequence), [0, 1, 2, 3]);
    assert.equal(
      snapshotRecords.some(({ recordId }) => recordId === pythonAppend.record.recordId),
      false,
    );
    return {
      id: "typescript-event-snapshot-python-append-typescript-continue",
      status: "passed",
      snapshotSequences: [0, 1, 2],
      liveSequences: [0, 1, 2, 3],
      postSnapshotAppendExcluded: true,
      boundedPageCount: snapshotRecords.length,
    };
  } finally {
    store.close();
  }
}

async function caseCheckpointSnapshot(root) {
  const path = join(root, "checkpoint-snapshot.db");
  const prefix = "checkpoint-snapshot";
  const streamId = "checkpoint-snapshot-stream";
  const checkpointScope = "checkpoint-snapshot-scope";
  const seed = assertAccepted(await runPython({
    mode: "seed-checkpoint-snapshot",
    path,
    now: T0,
    prefix,
    streamId,
    checkpointScope,
  }), "Python checkpoint snapshot seed");
  assert.equal(seed.firstCheckpointId, `${prefix}-checkpoint-c`);
  const store = provider(path, { value: T1 });
  try {
    const checkpointD = createCycleStoreCheckpoint({
      checkpointScope,
      checkpointId: `${prefix}-checkpoint-d`,
      streamId,
      boundSequence: 0,
      boundRecordHash: seed.record.recordHash,
      createdAt: T1,
      value: { source: prefix, suffix: "d" },
    });
    await store.saveCheckpoint({
      context: mutation(`${prefix}-save-d`),
      checkpoint: checkpointD,
      lease: null,
    });
    const checkpointB = await store.loadCheckpoint({
      context: AUTH,
      checkpointScope,
      checkpointId: `${prefix}-checkpoint-b`,
    });
    assert.notEqual(checkpointB, null);
    await store.deleteCheckpoint({
      context: mutation(`${prefix}-delete-b`),
      checkpointScope,
      checkpointId: `${prefix}-checkpoint-b`,
      expectedValueHash: checkpointB.valueHash,
    });
  } finally {
    store.close();
  }
  const continuation = assertAccepted(await runPython({
    mode: "continue-checkpoint-snapshot",
    path,
    now: T1,
    cursor: seed.cursor,
    checkpointScope,
  }), "Python checkpoint snapshot continuation");
  const snapshotIds = [seed.firstCheckpointId, ...continuation.snapshotIds];
  assert.deepEqual(snapshotIds, [
    `${prefix}-checkpoint-c`,
    `${prefix}-checkpoint-b`,
    `${prefix}-checkpoint-a`,
  ]);
  assert.deepEqual(continuation.liveIds, [
    `${prefix}-checkpoint-c`,
    `${prefix}-checkpoint-d`,
    `${prefix}-checkpoint-a`,
  ]);
  return {
    id: "python-checkpoint-snapshot-typescript-mutate-python-continue",
    status: "passed",
    snapshotSuffixes: ["c", "b", "a"],
    liveSuffixes: ["c", "d", "a"],
    snapshotHasNoSkipOrDuplicate: new Set(snapshotIds).size === 3,
    liveSaveAndDeleteIsolated: true,
  };
}

async function caseEmptyTailRace(root) {
  const path = join(root, "empty-tail-race.db");
  const bootstrap = provider(path);
  bootstrap.close();
  const worker = new PythonJsonWorker({
    mode: "race",
    path,
    now: T0,
    prefix: "python-race",
    streamId: "race-stream",
    operationId: "python-race-append",
    value: { secret: "PYTHON_RACE_PAYLOAD_SENTINEL" },
  });
  const store = provider(path);
  try {
    await worker.ready();
    const typescriptBatch = records(1, "typescript-race", 0, null, {
      secret: "TS_RACE_PAYLOAD_SENTINEL",
    });
    worker.sendGo();
    const [typescriptOutcome, pythonMessage] = await Promise.all([
      appendBatch(store, {
        operationId: "typescript-race-append",
        streamId: "race-stream",
        batch: typescriptBatch,
      }).then(
        (value) => ({ outcome: "accepted", value }),
        (error) => ({ outcome: "rejected", error: serializeTypeScriptError(error) }),
      ),
      worker.result(),
    ]);
    const accepted = [
      typescriptOutcome.outcome === "accepted",
      pythonMessage.outcome === "accepted",
    ].filter(Boolean).length;
    assert.equal(accepted, 1, "empty-tail race did not produce exactly one accepted append");
    if (typescriptOutcome.outcome === "rejected") {
      assert.equal(typescriptOutcome.error.code, "GE_CYCLE_STORE_CONFLICT");
      assert.equal(typescriptOutcome.error.operation, "append");
      assertAccepted(pythonMessage, "Python empty-tail race winner");
    } else {
      assertRejected(
        pythonMessage,
        "GE_CYCLE_STORE_CONFLICT",
        "append",
        "Python empty-tail race loser",
      );
    }
    const tail = await store.readTail({ context: AUTH, streamId: "race-stream" });
    assert.deepEqual(
      { exists: tail.exists, sequence: tail.sequence },
      { exists: true, sequence: 0 },
    );
  } finally {
    store.close();
    await worker.cleanup();
  }
  const audit = inspectSQLiteCycleStoreIntegrity(path, "semantic");
  assert.equal(audit.counters.records, 1);
  assert.equal(audit.counters.operations, 1);
  return {
    id: "real-typescript-python-empty-tail-race",
    status: "passed",
    contenders: 2,
    accepted: 1,
    typedConflicts: 1,
    committedRecords: audit.counters.records,
    committedOperations: audit.counters.operations,
    winnerNormalized: true,
  };
}

async function caseLeaseTakeover(root) {
  const path = join(root, "lease-takeover.db");
  const streamId = "lease-takeover-stream";
  const bootstrap = provider(path);
  let expectedTail;
  try {
    const batch = records(1, "lease-seed");
    const result = await appendBatch(bootstrap, {
      operationId: "lease-seed-append",
      streamId,
      batch,
    });
    expectedTail = result.tail;
  } finally {
    bootstrap.close();
  }
  const worker = new PythonJsonWorker({
    mode: "stale-lease",
    path,
    now: T0,
    appendNow: T_LEASE_TAKEOVER,
    prefix: "python-stale-lease",
    streamId,
    acquireOperationId: "python-lease-acquire",
    appendOperationId: "python-stale-lease-append",
    leaseId: "python-lease",
    holderId: "python-holder",
    ttlMs: 1_000,
    expectedTail,
  });
  let store;
  try {
    const ready = await worker.ready();
    assert.equal(ready.value.lease.fencingToken, 1);
    store = provider(path, { value: T_LEASE_TAKEOVER });
    const current = await store.acquireLease({
      context: mutation("typescript-lease-takeover"),
      streamId,
      leaseId: "typescript-lease",
      holderId: "typescript-holder",
      ttlMs: 10_000,
      mode: "takeover",
      expectedFencingToken: 1,
    });
    assert.equal(current.fencingToken, 2);
    worker.sendGo();
    assertRejected(
      await worker.result(),
      "GE_CYCLE_STORE_STALE_FENCE",
      "append",
      "Python stale lease writer",
    );
    const currentBatch = records(
      1,
      "typescript-current-lease",
      expectedTail.sequence + 1,
      expectedTail.recordHash,
    );
    await appendBatch(store, {
      operationId: "typescript-current-lease-append",
      streamId,
      batch: currentBatch,
      expectedTail,
      lease: leaseBinding(current),
    });
    const tail = await store.readTail({ context: AUTH, streamId });
    assert.equal(tail.sequence, 1);
    return {
      id: "cross-runtime-lease-takeover-stale-writer",
      status: "passed",
      staleFence: 1,
      takeoverFence: current.fencingToken,
      staleWriterCode: "GE_CYCLE_STORE_STALE_FENCE",
      currentWriterCommitted: true,
      finalSequence: tail.sequence,
    };
  } finally {
    store?.close();
    await worker.cleanup();
  }
}

async function caseBidirectionalBackup(root) {
  const tsSource = join(root, "backup-ts-source.db");
  const tsBackup = join(root, "backup-ts-copy.db");
  const pyDestination = join(root, "backup-python-restored.db");
  const tsStreamId = "backup-ts-stream";
  const tsStore = provider(tsSource);
  try {
    await appendBatch(tsStore, {
      operationId: "backup-ts-seed",
      streamId: tsStreamId,
      batch: records(2, "backup-ts"),
    });
  } finally {
    tsStore.close();
  }
  const tsBackupReport = await createSQLiteCycleStoreBackup(tsSource, tsBackup);
  const pythonBackupAudit = assertAccepted(await runPython({
    mode: "audit-state",
    path: tsBackup,
    now: T0,
  }), "Python audit of TypeScript backup");
  const typescriptPostPythonAudit = inspectSQLiteCycleStoreIntegrity(tsBackup, "semantic");
  assertSemanticEqual(
    tsBackupReport.integrity,
    typescriptPostPythonAudit,
    "TypeScript backup before/after Python open",
  );
  assertSemanticEqual(
    typescriptPostPythonAudit,
    pythonBackupAudit.audit,
    "TypeScript backup/Python pre-restore audit",
  );
  const pythonRestore = assertAccepted(await runPython({
    mode: "restore-and-continue",
    backupPath: tsBackup,
    destinationPath: pyDestination,
    path: pyDestination,
    now: T1,
    prefix: "backup-ts",
    streamId: tsStreamId,
    operationId: "backup-python-continue",
  }), "Python restore of TypeScript backup");
  assert.equal(pythonRestore.manifestSha256, tsBackupReport.manifestSha256);
  const tsValidation = provider(pyDestination, { value: T1 });
  let tsToPythonAudit;
  try {
    const page = await tsValidation.readEventPage({
      context: AUTH,
      streamId: tsStreamId,
      fromSequence: 0,
      pageSize: 256,
      cursor: null,
    });
    assert.deepEqual(page.records.map(({ sequence }) => sequence), [0, 1, 2]);
    tsToPythonAudit = inspectSQLiteCycleStoreIntegrity(pyDestination, "semantic");
  } finally {
    tsValidation.close();
  }
  assertSemanticEqual(tsToPythonAudit, pythonRestore.audit, "TypeScript backup/Python restore");

  const pySource = join(root, "backup-py-source.db");
  const pyBackup = join(root, "backup-py-copy.db");
  const tsDestination = join(root, "backup-typescript-restored.db");
  const pyStreamId = "backup-py-stream";
  const pythonBackup = assertAccepted(await runPython({
    mode: "seed-backup",
    path: pySource,
    backupPath: pyBackup,
    now: T0,
    prefix: "backup-py",
    streamId: pyStreamId,
    operationId: "backup-py-seed",
  }), "Python backup seed");
  const tsRestore = await restoreSQLiteCycleStoreBackup(pyBackup, tsDestination);
  assert.equal(tsRestore.sourceManifestSha256, pythonBackup.manifestSha256);
  assert.equal(tsRestore.integrity.semanticSha256, pythonBackup.semanticSha256);
  assert.deepEqual(tsRestore.integrity.counters, pythonBackup.counters);
  const tsContinuation = provider(tsDestination, { value: T1 });
  let expectedRecords;
  let expectedTail;
  try {
    const currentTail = await tsContinuation.readTail({ context: AUTH, streamId: pyStreamId });
    const continuation = records(
      1,
      "backup-py",
      currentTail.sequence + 1,
      currentTail.recordHash,
    );
    await appendBatch(tsContinuation, {
      operationId: "backup-typescript-continue",
      streamId: pyStreamId,
      batch: continuation,
      expectedTail: currentTail,
    });
    const page = await tsContinuation.readEventPage({
      context: AUTH,
      streamId: pyStreamId,
      fromSequence: 0,
      pageSize: 256,
      cursor: null,
    });
    expectedRecords = page.records;
    expectedTail = await tsContinuation.readTail({ context: AUTH, streamId: pyStreamId });
  } finally {
    tsContinuation.close();
  }
  const pythonValidation = assertAccepted(await runPython({
    mode: "validate-simple",
    path: tsDestination,
    now: T1,
    streamId: pyStreamId,
  }), "Python validation of TypeScript-restored continuation");
  assert.equal(canonicalSerialize(pythonValidation.records), canonicalSerialize(expectedRecords));
  assert.equal(canonicalSerialize(pythonValidation.tail), canonicalSerialize(expectedTail));
  assertSemanticEqual(
    inspectSQLiteCycleStoreIntegrity(tsDestination, "semantic"),
    pythonValidation.audit,
    "Python backup/TypeScript restore",
  );
  return {
    id: "bidirectional-cross-runtime-backup-restore-continue",
    status: "passed",
    directions: ["typescript-to-python", "python-to-typescript"],
    manifestBindingsExact: 2,
    semanticRestoreBindingsExact: 2,
    continuedSequences: { python: 2, typescript: 2 },
    sourceObjectsRemainImmutable: true,
  };
}

async function caseIdentities(root) {
  const python = assertAccepted(await runPython({
    mode: "identities",
    path: join(root, "identity-python.db"),
    now: T0,
  }), "Python identity probe");
  const descriptor = createSQLiteCycleStoreDescriptor();
  const record = createCycleStoreRecord({
    recordId: "identity-record-0",
    sequence: 0,
    previousRecordHash: null,
    value: { identity: "portable", sequence: 0 },
  });
  const request = {
    context: mutation("identity-operation"),
    streamId: "identity-stream",
    expectedTail: MISSING,
    lease: null,
    records: [record],
  };
  const captured = cycleStoreAdapterCodec.captureRequest("append", request, descriptor);
  const typescript = {
    providerId: SQLITE_CYCLE_STORE_PROVIDER_ID,
    descriptorHash: SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    applicationId: SQLITE_CYCLE_STORE_APPLICATION_ID,
    schemaVersion: SQLITE_CYCLE_STORE_SCHEMA_VERSION,
    schemaIdentitySha256: SQLITE_SCHEMA_IDENTITY_SHA256,
    catalogSha256: SQLITE_SCHEMA_CATALOG_SHA256,
    migrationManifestSha256: SQLITE_MIGRATION_MANIFEST_SHA256,
    schemaSqlSha256: SQLITE_SCHEMA_SQL_SHA256,
    schemaIdentityDocumentSha256: SQLITE_SCHEMA_IDENTITY_DOCUMENT_SHA256,
    alphaV0ToV1SqlSha256: SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
    backupManifestApiVersion: SQLITE_BACKUP_MANIFEST_API_VERSION,
    backupManifestDomain: SQLITE_BACKUP_MANIFEST_DOMAIN,
    record,
    recordCanonicalSha256: canonicalHash(record),
    operationRequestHash: cycleStoreAdapterCodec.operationRequestHash("append", captured),
    descriptorInspectionHash: descriptor.descriptorHash,
    schemaInspectionHash: SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  };
  for (const [key, value] of Object.entries(typescript)) {
    assert.equal(
      canonicalSerialize(python[key]),
      canonicalSerialize(value),
      `cross-runtime identity differs: ${key}`,
    );
  }
  const typescriptFresh = provider(join(root, "identity-typescript.db"));
  typescriptFresh.close();
  const typescriptAudit = inspectSQLiteCycleStoreIntegrity(
    join(root, "identity-typescript.db"),
    "semantic",
  );
  assertSemanticEqual(typescriptAudit, python.semanticAudit, "fresh identity database");
  return {
    id: "cross-runtime-portable-identities",
    status: "passed",
    providerId: typescript.providerId,
    descriptorHash: typescript.descriptorHash,
    applicationId: typescript.applicationId,
    schemaVersion: typescript.schemaVersion,
    schemaIdentitySha256: typescript.schemaIdentitySha256,
    catalogSha256: typescript.catalogSha256,
    migrationManifestSha256: typescript.migrationManifestSha256,
    schemaSqlSha256: typescript.schemaSqlSha256,
    schemaIdentityDocumentSha256: typescript.schemaIdentityDocumentSha256,
    alphaV0ToV1SqlSha256: typescript.alphaV0ToV1SqlSha256,
    recordCanonicalSha256: typescript.recordCanonicalSha256,
    operationRequestHash: typescript.operationRequestHash,
    backupManifestApiVersion: typescript.backupManifestApiVersion,
    backupManifestDomain: typescript.backupManifestDomain,
    semanticIdentityExact: true,
  };
}

export async function exerciseSQLiteInterop() {
  childProcessCount = 0;
  jsonBarrierCount = 0;
  assert.equal(activeChildren.size, 0, "a prior SQLite interop run leaked child processes");
  const rootsBefore = temporaryRootNames();
  const root = mkdtempSync(join(tmpdir(), TEMPORARY_PREFIX));
  let cases;
  try {
    cases = [
      await caseTypeScriptToPython(root),
      await casePythonToTypeScript(root),
      await caseEventSnapshot(root),
      await caseCheckpointSnapshot(root),
      await caseEmptyTailRace(root),
      await caseLeaseTakeover(root),
      await caseBidirectionalBackup(root),
      await caseIdentities(root),
    ];
    assert.equal(activeChildren.size, 0, "SQLite interop run leaked a child PID");
    assert.equal(cases.length, 8);
    assert.ok(cases.every(({ status }) => status === "passed"));
    const body = {
      suite: "graph-engineering-sqlite-cross-language-interop",
      schemaVersion: 1,
      runtimes: ["typescript", "python"],
      publicApisOnly: true,
      sameFileInterop: true,
      caseCount: cases.length,
      childProcessCount,
      jsonBarrierCount,
      childPidCleanup: "clean",
      boundedExecution: {
        workerTimeoutMs: WORKER_TIMEOUT_MS,
        maximumCursorPages: MAX_CURSOR_PAGES,
        maximumProtocolLineBytes: MAX_PROTOCOL_LINE_BYTES,
      },
      cases,
      leakSentinelScan: "clean",
      temporaryCleanup: "clean",
    };
    const bodyText = canonicalSerialize(body);
    for (const sentinel of LEAK_SENTINELS) assert.equal(bodyText.includes(sentinel), false);
    assert.equal(bodyText.includes('"pending"'), false);
    assert.equal(bodyText.includes('"skipped"'), false);
    return Object.freeze({
      ...body,
      reportSha256: sha256(Buffer.from(bodyText, "utf8")),
    });
  } finally {
    for (const child of [...activeChildren]) await terminateChild(child);
    cleanupTemporaryRoot(root);
    assert.deepEqual(temporaryRootNames(), rootsBefore, "SQLite interop temporary root leaked");
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === MODULE_PATH) {
  const report = await exerciseSQLiteInterop();
  process.stdout.write(`${canonicalSerialize(report)}\n`);
}
