#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline";

import {
  CycleStoreProviderError,
  createCycleStoreRecord,
} from "../../../packages/runtime/dist/index.js";
import { SQLiteCycleStoreProvider } from "../../../packages/sqlite/dist/sqlite-cycle-store.js";
import { translateSQLiteError } from "../../../packages/sqlite/dist/sqlite-errors.js";

const AUTH = Object.freeze({
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const MISSING = Object.freeze({ exists: false, sequence: -1, recordHash: null });
const config = JSON.parse(process.argv[2] ?? "null");
assert.ok(config !== null && typeof config === "object" && !Array.isArray(config));
assert.equal(typeof config.mode, "string");

let provider;
let database;
let closed = false;
const commands = [];
let waiting;
let barrierSequence = 0;
const barrierWaitWord = new Int32Array(new SharedArrayBuffer(4));
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function barrier(stage) {
  if (config.emitStageBarriers !== true) return;
  assert.equal(typeof config.barrierAckRoot, "string");
  const root = realpathSync(config.barrierAckRoot);
  assert.equal(lstatSync(root).isDirectory(), true);
  const nonce = `${String(barrierSequence).padStart(2, "0")}-${stage}`;
  barrierSequence += 1;
  const acknowledgement = resolve(join(root, `${nonce}.ack`));
  assert.equal(acknowledgement.startsWith(`${root}${sep}`), true);
  send({ type: "barrier", stage, nonce });
  const deadline = Date.now() + 15_000;
  while (!existsSync(acknowledgement)) {
    if (Date.now() >= deadline) throw new Error("barrier acknowledgement timed out");
    Atomics.wait(barrierWaitWord, 0, 0, 5);
  }
  unlinkSync(acknowledgement);
}

function errorResult(error) {
  if (error instanceof CycleStoreProviderError) {
    return {
      type: "result",
      outcome: "rejected",
      error: error.toJSON(),
    };
  }
  return {
    type: "result",
    outcome: "worker-error",
    error: {
      name: "WorkerError",
      code: null,
      operation: null,
      retryable: null,
      message: "SQLite campaign worker failed",
      details: {},
    },
  };
}

function cleanup() {
  if (closed) return;
  closed = true;
  try {
    if (database?.isTransaction === true) database.exec("ROLLBACK");
  } catch {
    // Process teardown remains best effort; the parent verifies durable state.
  }
  try { database?.close(); } catch { /* parent verifies cleanup */ }
  try { provider?.close(); } catch { /* parent verifies cleanup */ }
  input.close();
}

function nextCommand() {
  if (commands.length > 0) return Promise.resolve(commands.shift());
  return new Promise((resolve) => { waiting = resolve; });
}

input.on("line", (line) => {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    send({ type: "protocol-error" });
    cleanup();
    process.exitCode = 70;
    return;
  }
  if (waiting !== undefined) {
    const resolve = waiting;
    waiting = undefined;
    resolve(value);
  } else {
    commands.push(value);
  }
});

process.once("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
process.once("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.once("exit", cleanup);

function record(prefix, sequence, previousRecordHash, value = {}) {
  return createCycleStoreRecord({
    recordId: `${prefix}-${sequence}`,
    sequence,
    previousRecordHash,
    value: { source: prefix, sequence, ...value },
  });
}

function appendRequest(configuration) {
  const records = [];
  let previous = configuration.previousRecordHash ?? null;
  const start = configuration.startSequence ?? 0;
  const count = configuration.count ?? 1;
  for (let offset = 0; offset < count; offset += 1) {
    const next = record(
      configuration.recordPrefix,
      start + offset,
      previous,
      configuration.value ?? {},
    );
    records.push(next);
    previous = next.recordHash;
  }
  return {
    context: { ...AUTH, operationId: configuration.operationId },
    streamId: configuration.streamId,
    expectedTail: configuration.expectedTail ?? MISSING,
    lease: configuration.lease ?? null,
    records,
  };
}

async function runProviderAppend(configuration, faultBoundary) {
  const emitStageBarriers = configuration.emitStageBarriers === true;
  provider = new SQLiteCycleStoreProvider(configuration.path, {
    now: () => new Date(configuration.nowMs),
    ...(configuration.busyTimeoutMs === undefined
      ? {}
      : { busyTimeoutMs: configuration.busyTimeoutMs }),
    ...(configuration.maxBusyAttempts === undefined
      ? {}
      : { maxBusyAttempts: configuration.maxBusyAttempts }),
    ...(configuration.maxBusyElapsedMs === undefined
      ? {}
      : { maxBusyElapsedMs: configuration.maxBusyElapsedMs }),
    ...(faultBoundary === undefined && !emitStageBarriers
      ? {}
      : {
          faultHook(boundary) {
            if (emitStageBarriers) {
              barrier(boundary === "provider:append:after-commit-before-return"
                ? "before-acknowledgement"
                : boundary.slice("provider:append:".length));
            }
            if (boundary === faultBoundary) process.kill(process.pid, "SIGKILL");
          },
        }),
  });
  if (emitStageBarriers) barrier("opened");
  send({ type: "ready", pid: process.pid });
  const command = await nextCommand();
  assert.equal(command?.type, "go");
  const request = appendRequest(configuration);
  try {
    const result = await provider.append(request);
    if (emitStageBarriers) {
      provider.close();
      provider = undefined;
      barrier("closed");
    }
    send({ type: "result", outcome: "accepted", result, request });
  } catch (error) {
    send(errorResult(error));
  } finally {
    cleanup();
  }
}

async function runHoldTransaction(configuration, snapshotOnly = false) {
  database = new DatabaseSync(configuration.path, {
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: 0,
  });
  database.exec("PRAGMA trusted_schema = OFF");
  if (snapshotOnly) {
    database.exec("BEGIN");
    database.prepare("SELECT count(*) FROM ge_cycle_streams").get();
  } else {
    database.exec(configuration.exclusive === true ? "BEGIN EXCLUSIVE" : "BEGIN IMMEDIATE");
  }
  send({ type: "ready", pid: process.pid });
  const release = () => {
    if (database?.isTransaction === true) database.exec("ROLLBACK");
    send({ type: "released" });
    cleanup();
  };
  if (Number.isSafeInteger(configuration.releaseAfterMs)) {
    setTimeout(release, configuration.releaseAfterMs);
  } else {
    const command = await nextCommand();
    assert.equal(command?.type, "release");
    release();
  }
}

async function runDeferredSnapshot(configuration) {
  database = new DatabaseSync(configuration.path, {
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    timeout: 0,
  });
  database.exec("PRAGMA trusted_schema = OFF; BEGIN DEFERRED");
  database.prepare("SELECT count(*) FROM ge_cycle_streams").get();
  send({ type: "ready", pid: process.pid });
  const command = await nextCommand();
  assert.equal(command?.type, "go");
  try {
    database.prepare(
      "UPDATE ge_cycle_migration_lock SET updated_at_ms = updated_at_ms WHERE singleton = 1",
    ).run();
    send({ type: "result", outcome: "accepted" });
  } catch (error) {
    send(errorResult(translateSQLiteError(error, "append")));
  } finally {
    cleanup();
  }
}

async function runStaleLease(configuration) {
  let nowMs = configuration.nowMs;
  provider = new SQLiteCycleStoreProvider(configuration.path, {
    now: () => new Date(nowMs),
  });
  const lease = await provider.acquireLease({
    context: { ...AUTH, operationId: "worker-acquire-lease" },
    streamId: configuration.streamId,
    leaseId: "worker-lease",
    holderId: "worker-holder",
    ttlMs: configuration.ttlMs,
    mode: "acquire",
    expectedFencingToken: 0,
  });
  send({ type: "ready", pid: process.pid, lease });
  const command = await nextCommand();
  assert.equal(command?.type, "go");
  nowMs = configuration.appendNowMs;
  const request = appendRequest({
    ...configuration,
    operationId: "worker-stale-append",
    recordPrefix: "worker-stale",
    startSequence: configuration.expectedTail.sequence + 1,
    previousRecordHash: configuration.expectedTail.recordHash,
    lease: {
      leaseId: lease.leaseId,
      holderId: lease.holderId,
      fencingToken: lease.fencingToken,
    },
  });
  try {
    const result = await provider.append(request);
    send({ type: "result", outcome: "accepted", result });
  } catch (error) {
    send(errorResult(error));
  } finally {
    cleanup();
  }
}

async function runBoundedWriter(configuration) {
  provider = new SQLiteCycleStoreProvider(configuration.path, {
    now: () => new Date(configuration.nowMs),
    busyTimeoutMs: 50,
    maxBusyAttempts: 8,
    maxBusyElapsedMs: 2_000,
  });
  send({ type: "ready", pid: process.pid });
  const command = await nextCommand();
  assert.equal(command?.type, "go");
  try {
    for (let index = 0; index < configuration.streamCount; index += 1) {
      const request = appendRequest({
        operationId: `backup-writer-${index}`,
        streamId: `backup-writer-${index}`,
        recordPrefix: `backup-writer-${index}`,
        count: 1,
      });
      await provider.append(request);
    }
    send({ type: "result", outcome: "accepted", result: { writes: configuration.streamCount } });
  } catch (error) {
    send(errorResult(error));
  } finally {
    cleanup();
  }
}

try {
  if (config.mode === "append") {
    await runProviderAppend(config);
  } else if (config.mode === "append-fault") {
    await runProviderAppend(config, config.faultBoundary);
  } else if (config.mode === "hold-lock") {
    await runHoldTransaction(config, false);
  } else if (config.mode === "read-snapshot") {
    await runHoldTransaction(config, true);
  } else if (config.mode === "deferred-snapshot") {
    await runDeferredSnapshot(config);
  } else if (config.mode === "stale-lease") {
    await runStaleLease(config);
  } else if (config.mode === "bounded-writer") {
    await runBoundedWriter(config);
  } else {
    throw new TypeError("unknown SQLite campaign worker mode");
  }
} catch (error) {
  send(errorResult(error));
  cleanup();
  process.exitCode = 70;
}
