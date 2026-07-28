import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const FIXED_CLOCK_EPOCH_MS = Date.parse("2026-07-27T00:00:00.000Z");
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

const METHOD_OPERATIONS = Object.freeze({
  describe: "describe",
  inspectSchema: "inspect-schema",
  readTail: "read-tail",
  append: "append",
  readEventPage: "read-event-page",
  saveCheckpoint: "save-checkpoint",
  loadCheckpoint: "load-checkpoint",
  listCheckpoints: "list-checkpoints",
  deleteCheckpoint: "delete-checkpoint",
  acquireLease: "acquire-lease",
  renewLease: "renew-lease",
  releaseLease: "release-lease",
  inspectLease: "inspect-lease",
  setLegalHold: "set-legal-hold",
  inspectGovernance: "inspect-governance",
  acquireMigrationLock: "acquire-migration-lock",
  inspectMigrationLock: "inspect-migration-lock",
  releaseMigrationLock: "release-migration-lock",
});

function hardened(database, sql) {
  const statement = database.prepare(sql);
  statement.setAllowBareNamedParameters(false);
  statement.setAllowUnknownNamedParameters(false);
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  return statement;
}

function exactCount(database, sql) {
  const row = hardened(database, sql).get();
  assert.ok(Array.isArray(row) && row.length === 1, "SQLite counter row is invalid");
  const value = row[0];
  assert.equal(typeof value, "bigint", "SQLite counter did not retain integer precision");
  assert.ok(value >= 0n && value <= BigInt(MAX_SAFE_INTEGER), "SQLite counter is outside bounds");
  return Number(value);
}

function openHarnessDatabase(path, readOnly) {
  const database = new DatabaseSync(path, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
    enableForeignKeyConstraints: true,
    open: true,
    readOnly,
    timeout: 250,
  });
  database.exec("PRAGMA trusted_schema = OFF");
  return database;
}

function withHarnessDatabase(path, readOnly, action) {
  const database = openHarnessDatabase(path, readOnly);
  try {
    return action(database);
  } finally {
    if (database.isOpen) database.close();
  }
}

function stateCounters(path) {
  return withHarnessDatabase(path, true, (database) => Object.freeze({
    streams: exactCount(database, "SELECT count(*) FROM ge_cycle_streams"),
    records: exactCount(database, "SELECT count(*) FROM ge_cycle_records"),
    recordIds: exactCount(database, "SELECT count(DISTINCT tenant_id || char(0) || record_id) FROM ge_cycle_records"),
    checkpoints: exactCount(database, "SELECT count(*) FROM ge_cycle_checkpoints"),
    leaseStreams: exactCount(database, "SELECT count(*) FROM ge_cycle_leases"),
    idempotencyEntries: exactCount(database, "SELECT count(*) FROM ge_cycle_operations"),
    cursors: exactCount(
      database,
      "SELECT count(*) FROM ge_cycle_cursors WHERE consumed_at_ms IS NULL",
    ),
    legalHolds: exactCount(database, "SELECT count(*) FROM ge_cycle_legal_holds"),
    migrationFence: exactCount(
      database,
      "SELECT last_fencing_token FROM ge_cycle_migration_lock WHERE singleton = 1",
    ),
  }));
}

function mutateDatabase(path, action) {
  return withHarnessDatabase(path, false, (database) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const result = action(database);
      database.exec("COMMIT");
      return result;
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  });
}

function corruptCheckpoint(path, core, tenantId, scope, checkpointId, replacement) {
  const bytes = Buffer.from(core.canonicalSerialize(replacement), "utf8");
  mutateDatabase(path, (database) => {
    const result = hardened(database, `
      UPDATE ge_cycle_checkpoints SET checkpoint_blob = ?
      WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
    `).run(bytes, tenantId, scope, checkpointId);
    assert.equal(Number(result.changes), 1, "checkpoint corruption target does not exist");
  });
}

function setLeaseCounters(path, tenantId, streamId, leaseEpoch, fencingToken) {
  assert.ok(Number.isSafeInteger(leaseEpoch) && leaseEpoch >= 0, "lease epoch is invalid");
  assert.ok(Number.isSafeInteger(fencingToken) && fencingToken >= 0, "fencing token is invalid");
  mutateDatabase(path, (database) => {
    const result = hardened(database, `
      UPDATE ge_cycle_leases
      SET active_lease_id = NULL,
          active_holder_id = NULL,
          active_lease_epoch = NULL,
          active_fencing_token = NULL,
          active_acquired_at_ms = NULL,
          active_expires_at_ms = NULL,
          last_lease_epoch = ?,
          last_fencing_token = ?
      WHERE tenant_id = ? AND stream_id = ?
    `).run(leaseEpoch, fencingToken, tenantId, streamId);
    assert.equal(Number(result.changes), 1, "lease counter target does not exist");
  });
}

function providerWithInjectedFailures(provider, runtime, injectedFailures) {
  return new Proxy(provider, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const operation = METHOD_OPERATIONS[property];
      if (operation === undefined) return value.bind(target);
      return (...arguments_) => {
        const code = injectedFailures.get(operation);
        if (code !== undefined) {
          injectedFailures.delete(operation);
          throw new runtime.CycleStoreProviderError(
            code,
            operation,
            "injected provider failure",
          );
        }
        return value.apply(target, arguments_);
      };
    },
  });
}

/**
 * Creates isolated, file-backed providers for the shared 54-case campaign.
 * Unsafe controls live entirely in this test harness and never widen the
 * production CycleStoreProvider surface.
 */
export function createSQLiteCycleStoreConformanceHarness({
  runtime,
  core,
  SQLiteCycleStoreProvider,
}) {
  assert.equal(typeof SQLiteCycleStoreProvider, "function", "SQLite provider class is required");
  return Object.freeze({
    async createProvider(options = {}) {
      const directory = await mkdtemp(join(tmpdir(), "graph-engineering-sqlite-conformance-"));
      const databasePath = join(directory, "cycle-store.db");
      let clockMs = FIXED_CLOCK_EPOCH_MS;
      let rawProvider;
      try {
        rawProvider = new SQLiteCycleStoreProvider(databasePath, {
          now: () => new Date(clockMs),
          ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
          ...(options.faultHook === undefined ? {} : { faultHook: options.faultHook }),
        });
      } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
      }
      const injectedFailures = new Map();
      const provider = providerWithInjectedFailures(rawProvider, runtime, injectedFailures);
      let cleaned = false;
      return {
        provider,
        controls: Object.freeze({
          stateCounters: () => stateCounters(databasePath),
          advanceClock(milliseconds) {
            assert.ok(
              Number.isSafeInteger(milliseconds) && milliseconds >= 0,
              "clock advancement is invalid",
            );
            assert.ok(
              clockMs <= MAX_SAFE_INTEGER - milliseconds,
              "clock advancement exceeds the safe range",
            );
            clockMs += milliseconds;
          },
          corruptCheckpoint: (...arguments_) => (
            corruptCheckpoint(databasePath, core, ...arguments_)
          ),
          setLeaseCounters: (...arguments_) => setLeaseCounters(databasePath, ...arguments_),
          injectFailure(operation, code) {
            assert.ok(runtime.CYCLE_STORE_PROVIDER_OPERATIONS.includes(operation));
            assert.ok(runtime.CYCLE_STORE_PROVIDER_ERROR_CODES.includes(code));
            injectedFailures.set(operation, code);
          },
        }),
        async cleanup() {
          assert.equal(cleaned, false, "SQLite harness instance was cleaned twice");
          cleaned = true;
          rawProvider.close();
          const resolvedDirectory = resolve(directory);
          assert.ok(
            resolvedDirectory.startsWith(`${resolve(tmpdir())}/graph-engineering-sqlite-conformance-`),
            "refusing to clean an unexpected SQLite harness directory",
          );
          await rm(resolvedDirectory, { recursive: true, force: true });
        },
      };
    },
  });
}
