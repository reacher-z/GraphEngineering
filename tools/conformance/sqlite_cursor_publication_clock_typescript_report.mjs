#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as publicApi from "../../packages/sqlite/dist/index.js";
import {
  SQLITE_CURSOR_CLOCK_BOUNDARIES,
  SQLITE_CURSOR_CLOCK_CONSUMERS,
  consumeSQLiteCursorProviderClockEvidenceIntrinsic,
  createSQLiteCursorMigrationLockCapabilityIntrinsic,
  createSQLiteCursorProviderClockCapabilityIntrinsic,
  createSQLiteCursorProviderClockSourceIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-clock-authority.js";
import { ensureSQLiteCycleStoreSchema } from "../../packages/sqlite/dist/migrations.js";
import {
  SQLiteConnection,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../../packages/sqlite/dist/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../../packages/sqlite/dist/sqlite-profile.js";

const LOCK = Object.freeze({
  activeExpiresAtMs: 1_000,
  fencingToken: 1,
  lockEpoch: 1,
  lockId: "b3-lock",
  ownerId: "b3-owner",
  sourceSchemaVersion: 1,
  targetSchemaVersion: 2,
});
const FAILURES = Object.freeze({
  GE_CYCLE_STORE_CORRUPTION: Object.freeze({
    "SQLite provider clock moved backwards": "clock-regression",
  }),
  GE_CYCLE_STORE_INVALID_ARGUMENT: Object.freeze({
    "SQLite cursor clock boundary is out of order": "clock-order",
  }),
  GE_CYCLE_STORE_STALE_FENCE: Object.freeze({
    "SQLite cursor clock transaction lineage changed": "transaction-lineage",
    "SQLite cursor clock migration lock changed": "migration-lock",
    "SQLite cursor migration lock changed": "migration-lock",
    "SQLite migration lock expired": "lock-expired",
  }),
  GE_CYCLE_STORE_UNAVAILABLE: Object.freeze({
    "SQLite provider clock returned an invalid time": "clock-unavailable",
  }),
});
const CURSOR_REBIND = /UPDATE\s+(?:main\.)?ge_cycle_cursors\s+SET/iu;
let activeCounters = null;
const databasePrepareIntrinsic = DatabaseSync.prototype.prepare;
const databaseExecIntrinsic = DatabaseSync.prototype.exec;

DatabaseSync.prototype.prepare = function auditedPrepare(sql) {
  const rebind = typeof sql === "string" && CURSOR_REBIND.test(sql);
  if (rebind && activeCounters !== null) activeCounters.cursorRebindPrepareCount += 1;
  const statement = Reflect.apply(databasePrepareIntrinsic, this, [sql]);
  if (!rebind) return statement;
  return new Proxy(statement, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (!["all", "get", "iterate", "run"].includes(String(property))) {
        return value.bind(target);
      }
      return (...parameters) => {
        if (activeCounters !== null) activeCounters.cursorRebindExecuteCount += 1;
        return Reflect.apply(value, target, parameters);
      };
    },
  });
};

DatabaseSync.prototype.exec = function auditedExec(sql) {
  if (activeCounters !== null && /(?:^|;)\s*COMMIT\b/imu.test(sql)) {
    activeCounters.commitCount += 1;
  }
  return Reflect.apply(databaseExecIntrinsic, this, [sql]);
};

function openRun() {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-clock-parity-"));
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: 1,
  });
  connection.prepare(`
    UPDATE main.ge_cycle_migration_lock
       SET active_lock_id = ?, active_owner_id = ?, active_source_version = 1,
           active_target_version = 2, active_lock_epoch = 1,
           active_fencing_token = 1, active_acquired_at_ms = 10,
           active_expires_at_ms = 1000, last_lock_epoch = 1,
           last_fencing_token = 1, updated_at_ms = 10
     WHERE singleton = 1
  `, "inspect-schema").run(LOCK.lockId, LOCK.ownerId);
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  return { connection, root };
}

function outcome(error) {
  const byMessage = FAILURES[error?.code];
  return byMessage?.[error?.message] ?? `unexpected:${String(error?.code ?? error)}`;
}

function runCase(caseId, action, values) {
  const { connection, root } = openRun();
  let reads = 0;
  let observations = 0;
  let consumed = 0;
  const source = createSQLiteCursorProviderClockSourceIntrinsic(() => values[reads++]);
  const lock = createSQLiteCursorMigrationLockCapabilityIntrinsic(connection, LOCK);
  const clock = createSQLiteCursorProviderClockCapabilityIntrinsic(connection, lock, source);
  const before = readSQLiteConnectionTotalChangesSnapshot(connection).totalChanges;
  const counters = {
    cursorRebindPrepareCount: 0,
    cursorRebindExecuteCount: 0,
    commitCount: 0,
  };
  const observe = (boundary) => {
    const evidence = observeSQLiteCursorProviderClockIntrinsic(clock, boundary);
    observations += 1;
    return evidence;
  };
  const consume = (evidence, consumer) => {
    consumeSQLiteCursorProviderClockEvidenceIntrinsic(clock, evidence, consumer);
    consumed += 1;
  };
  let result = "accepted";
  activeCounters = counters;
  try {
    action(connection, observe, consume);
  } catch (error) {
    result = outcome(error);
  } finally {
    activeCounters = null;
  }
  const delta = readSQLiteConnectionTotalChangesSnapshot(connection).totalChanges - before;
  try {
    if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
  } finally {
    connection.close();
    rmSync(root, { recursive: true, force: true });
  }
  return Object.freeze({
    caseId,
    outcome: result,
    observations,
    consumed,
    providerClockReads: reads,
    totalChangesDelta: delta,
    cursorRebindPrepareCount: counters.cursorRebindPrepareCount,
    cursorRebindExecuteCount: counters.cursorRebindExecuteCount,
    commitCount: counters.commitCount,
  });
}

function counterProbe() {
  const { connection, root } = openRun();
  const counters = {
    cursorRebindPrepareCount: 0,
    cursorRebindExecuteCount: 0,
    commitCount: 0,
  };
  activeCounters = counters;
  try {
    connection.prepare(
      "UPDATE main.ge_cycle_cursors SET page_size = page_size WHERE 0",
      "inspect-schema",
    ).run();
    connection.execTrusted("COMMIT", "inspect-schema");
  } finally {
    activeCounters = null;
    if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
    connection.close();
    rmSync(root, { recursive: true, force: true });
  }
  return Object.freeze(counters);
}

function control(connection, observe, consume) {
  const first = observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0]);
  connection.execTrusted(
    "CREATE TEMP TABLE temp.ge_clock_probe (id INTEGER PRIMARY KEY)",
    "inspect-schema",
  );
  consume(first, SQLITE_CURSOR_CLOCK_CONSUMERS[SQLITE_CURSOR_CLOCK_BOUNDARIES[0]]);
  for (const boundary of SQLITE_CURSOR_CLOCK_BOUNDARIES.slice(1)) {
    const evidence = observe(boundary);
    consume(evidence, SQLITE_CURSOR_CLOCK_CONSUMERS[boundary]);
  }
}

function rollbackRebegin(connection, observe) {
  observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0]);
  connection.execTrusted("ROLLBACK", "inspect-schema");
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[1]);
}

function skipped(_connection, observe) {
  observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[1]);
}

function twice(_connection, observe) {
  observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0]);
  observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[1]);
}

function once(_connection, observe) {
  observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0]);
}

function lockDrift(connection, observe) {
  observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0]);
  connection.prepare(
    "UPDATE main.ge_cycle_migration_lock SET active_owner_id = 'other' WHERE singleton = 1",
    "inspect-schema",
  ).run();
  observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[1]);
}

const cases = [
  runCase("control", control, [100, 200, 300, 400]),
  runCase("rollback-rebegin", rollbackRebegin, [100, 200]),
  runCase("skipped-boundary", skipped, [100]),
  runCase("clock-regression", twice, [100, 99]),
  runCase("expiry-equal", once, [1_000]),
  runCase("clock-invalid", once, [-1]),
  runCase("lock-drift", lockDrift, [100, 200]),
];

process.stdout.write(`${JSON.stringify({
  runtime: "typescript",
  publicExport: Object.hasOwn(publicApi, "createSQLiteCursorProviderClockCapabilityIntrinsic"),
  counterProbe: counterProbe(),
  cases,
})}\n`);
