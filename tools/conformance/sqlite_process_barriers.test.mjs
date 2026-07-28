import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCycleStoreRecord } from "../../packages/runtime/dist/index.js";
import {
  inspectSQLiteCycleStoreIntegrity,
  SQLiteCycleStoreProvider,
} from "../../packages/sqlite/dist/index.js";

const WORKER = fileURLToPath(new URL("./workers/sqlite_process_worker.mjs", import.meta.url));
const EXPECTED_STAGES = Object.freeze([
  "opened",
  "transaction-reserved",
  "decision-state-read",
  "records-staged",
  "ledger-staged",
  "before-commit",
  "commit-returned",
  "before-acknowledgement",
  "closed",
]);

function runBarrierWorker(path, acknowledgementRoot, killAt = null) {
  const configuration = {
    mode: "append",
    path,
    nowMs: Date.parse("2026-07-27T00:00:00.000Z"),
    operationId: "barrier-append",
    streamId: "barrier-stream",
    recordPrefix: "barrier-record",
    count: 1,
    emitStageBarriers: true,
    barrierAckRoot: acknowledgementRoot,
  };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, JSON.stringify(configuration)], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    assert.ok(Number.isSafeInteger(child.pid) && child.pid > 0);
    const messages = [];
    let stdout = "";
    let stderr = "";
    let sentGo = false;
    let killed = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("SQLite barrier worker exceeded 20 seconds"));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      for (;;) {
        const newline = stdout.indexOf("\n");
        if (newline < 0) break;
        const line = stdout.slice(0, newline);
        stdout = stdout.slice(newline + 1);
        const message = JSON.parse(line);
        messages.push(message);
        if (message.type === "barrier") {
          if (message.stage === killAt) {
            killed = true;
            assert.equal(child.kill("SIGKILL"), true);
          } else {
            writeFileSync(join(acknowledgementRoot, `${message.nonce}.ack`), "", {
              flag: "wx",
            });
          }
        }
        if (message.type === "ready" && !sentGo) {
          sentGo = true;
          child.stdin.write(`${JSON.stringify({ type: "go" })}\n`);
        }
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (killAt === null && (code !== 0 || signal !== null)) {
        reject(new Error(
          `SQLite barrier worker failed with code ${String(code)}, `
            + `signal ${String(signal)}: ${stderr}`,
        ));
        return;
      }
      if (killAt !== null) {
        assert.equal(killed, true, `worker never reached kill barrier ${killAt}`);
        assert.equal(code, null);
        assert.equal(signal, "SIGKILL");
      }
      resolve({ messages, exit: { code, signal }, pid: child.pid });
    });
  });
}

function appendRequest() {
  return {
    context: {
      tenantId: "tenant-a",
      principalHash: "a".repeat(64),
      authorizationHash: "b".repeat(64),
      operationId: "barrier-append",
    },
    streamId: "barrier-stream",
    expectedTail: { exists: false, sequence: -1, recordHash: null },
    lease: null,
    records: [createCycleStoreRecord({
      recordId: "barrier-record-0",
      sequence: 0,
      previousRecordHash: null,
      value: { source: "barrier-record", sequence: 0 },
    })],
  };
}

async function replayAndInspect(path, committedBeforeRetry) {
  const before = inspectSQLiteCycleStoreIntegrity(path, "semantic");
  assert.equal(before.counters.records, committedBeforeRetry ? 1 : 0);
  assert.equal(before.counters.operations, committedBeforeRetry ? 1 : 0);
  const provider = new SQLiteCycleStoreProvider(path, {
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  });
  try {
    const result = await provider.append(appendRequest());
    assert.equal(result.appendedRecords, 1);
  } finally {
    provider.close();
  }
  const after = inspectSQLiteCycleStoreIntegrity(path, "semantic");
  assert.equal(after.counters.records, 1);
  assert.equal(after.counters.operations, 1);
}

test("parent ACKs or kills every one of the nine real append process barriers", {
  timeout: 60_000,
}, async () => {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-barriers-"));
  try {
    const successRoot = join(root, "success");
    const successAcks = join(successRoot, "acks");
    mkdirSync(successAcks, { recursive: true });
    const success = await runBarrierWorker(
      join(successRoot, "cycle-store.db"),
      successAcks,
    );
    assert.deepEqual(
      success.messages.filter(({ type }) => type === "barrier").map(({ stage }) => stage),
      EXPECTED_STAGES,
    );
    assert.deepEqual(success.exit, { code: 0, signal: null });
    const result = success.messages.find(({ type }) => type === "result");
    assert.deepEqual(result?.outcome, "accepted");
    assert.deepEqual(result?.result?.appendedRecords, 1);
    assert.equal(success.messages.filter(({ type }) => type === "ready").length, 1);
    await replayAndInspect(join(successRoot, "cycle-store.db"), true);

    const postCommitStages = new Set([
      "commit-returned",
      "before-acknowledgement",
      "closed",
    ]);
    for (const [index, stage] of EXPECTED_STAGES.entries()) {
      const caseRoot = join(root, `kill-${String(index).padStart(2, "0")}-${stage}`);
      const acknowledgements = join(caseRoot, "acks");
      mkdirSync(acknowledgements, { recursive: true });
      const path = join(caseRoot, "cycle-store.db");
      const killed = await runBarrierWorker(path, acknowledgements, stage);
      const observedStages = killed.messages
        .filter(({ type }) => type === "barrier")
        .map(({ stage: observed }) => observed);
      assert.deepEqual(observedStages, EXPECTED_STAGES.slice(0, index + 1));
      assert.equal(killed.messages.some(({ type }) => type === "result"), false);
      await replayAndInspect(path, postCommitStages.has(stage));
    }
    assert.equal(JSON.stringify(success.messages).includes("PAYLOAD_SENTINEL"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
