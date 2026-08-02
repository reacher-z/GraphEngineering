import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  SQLITE_CURSOR_CLOCK_BOUNDARIES,
  SQLITE_CURSOR_CLOCK_CONSUMERS,
  assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic,
  assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic,
  assertSQLiteCursorProviderClockConsumedTombstoneIntrinsic,
  assertSQLiteCursorProviderClockEvidencePredecessorIntrinsic,
  consumeSQLiteCursorProviderClockEvidenceIntrinsic,
  createSQLiteCursorMigrationLockCapabilityIntrinsic,
  createSQLiteCursorProviderClockCapabilityIntrinsic,
  createSQLiteCursorProviderClockSourceIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
  readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic,
  type SQLiteCursorMigrationLockCapability,
  type SQLiteCursorMigrationLockIdentity,
  type SQLiteCursorProviderClockCapability,
  type SQLiteCursorProviderClockConsumedTombstone,
  type SQLiteCursorProviderClockEvidence,
  type SQLiteCursorProviderClockSource,
} from "../src/cursor-publication-clock-authority.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import {
  SQLiteConnection,
  readSQLiteConnectionOwnerSnapshot,
} from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";

const roots: string[] = [];
const connections: SQLiteConnection[] = [];
const LOCK = Object.freeze({
  activeExpiresAtMs: 1_000,
  fencingToken: 1,
  lockEpoch: 1,
  lockId: "b3-lock",
  ownerId: "b3-owner",
  sourceSchemaVersion: 1,
  targetSchemaVersion: 2,
} as const satisfies SQLiteCursorMigrationLockIdentity);

function openRun(lock: SQLiteCursorMigrationLockIdentity = LOCK): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-b3-clock-"));
  roots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  connections.push(connection);
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: 1,
  });
  connection.prepare(`
    UPDATE main.ge_cycle_migration_lock
       SET active_lock_id = ?, active_owner_id = ?, active_source_version = ?,
           active_target_version = ?, active_lock_epoch = ?, active_fencing_token = ?,
           active_acquired_at_ms = ?, active_expires_at_ms = ?,
           last_lock_epoch = ?, last_fencing_token = ?, updated_at_ms = ?
     WHERE singleton = 1
  `, "inspect-schema").run(
    lock.lockId, lock.ownerId, lock.sourceSchemaVersion, lock.targetSchemaVersion,
    lock.lockEpoch, lock.fencingToken, 10, lock.activeExpiresAtMs,
    lock.lockEpoch, lock.fencingToken, 10,
  );
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  return connection;
}

function authority(
  connection: SQLiteConnection,
  values: readonly number[],
): Readonly<{
  clock: SQLiteCursorProviderClockCapability;
  lock: SQLiteCursorMigrationLockCapability;
  source: SQLiteCursorProviderClockSource;
}> {
  let index = 0;
  const source = createSQLiteCursorProviderClockSourceIntrinsic(() => values[index++]!);
  const lock = createSQLiteCursorMigrationLockCapabilityIntrinsic(connection, LOCK);
  return Object.freeze({
    clock: createSQLiteCursorProviderClockCapabilityIntrinsic(connection, lock, source),
    lock,
    source,
  });
}

function expectCode(callback: () => unknown, code: string): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe(code);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code}`);
}

function preparedSessionClockGraph(
  connection: SQLiteConnection,
  values: readonly number[] = [100, 200, 300],
): Readonly<{
  clock: SQLiteCursorProviderClockCapability;
  lock: SQLiteCursorMigrationLockCapability;
  outerEvidence: SQLiteCursorProviderClockEvidence;
  outerTombstone: SQLiteCursorProviderClockConsumedTombstone;
  preRebindEvidence: SQLiteCursorProviderClockEvidence;
}> {
  const run = authority(connection, values);
  const outerEvidence = observeSQLiteCursorProviderClockIntrinsic(
    run.clock,
    "before-first-permanent-mutation",
  );
  const outerTombstone = consumeSQLiteCursorProviderClockEvidenceIntrinsic(
    run.clock,
    outerEvidence,
    "outer-publication-authority",
  );
  const preRebindEvidence = observeSQLiteCursorProviderClockIntrinsic(
    run.clock,
    "before-cursor-rebind",
  );
  return Object.freeze({
    clock: run.clock,
    lock: run.lock,
    outerEvidence,
    outerTombstone,
    preRebindEvidence,
  });
}

afterEach(() => {
  for (const connection of connections.splice(0)) {
    try {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
    } catch {
      // The hostile case may already have ended or closed the transaction.
    }
    try {
      connection.close();
    } catch {
      // Preserve the test's primary assertion.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite B3 provider-clock authority", () => {
  it("proves the exact prepared and active second-boundary session graphs", () => {
    const connection = openRun();
    const run = preparedSessionClockGraph(connection);

    const prepared = assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
      connection,
      run.lock,
      run.clock,
      run.outerEvidence,
      run.outerTombstone,
      run.preRebindEvidence,
    );
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(Object.isFrozen(prepared.migrationLock)).toBe(true);
    expect(prepared).toMatchObject({
      activeExpiresAtMs: 1_000,
      boundary: "before-cursor-rebind",
      consumer: "cursor-publication-session",
      migrationLock: LOCK,
      previousEvidence: run.outerEvidence,
      providerNowMs: 200,
    });

    const preRebindTombstone = consumeSQLiteCursorProviderClockEvidenceIntrinsic(
      run.clock,
      run.preRebindEvidence,
      "cursor-publication-session",
    );
    expectCode(
      () => assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
        connection,
        run.lock,
        run.clock,
        run.outerEvidence,
        run.outerTombstone,
        run.preRebindEvidence,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );

    const active = assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic(
      connection,
      run.lock,
      run.clock,
      run.outerEvidence,
      run.outerTombstone,
      run.preRebindEvidence,
      preRebindTombstone,
    );
    expect(active.previousEvidence).toBe(run.outerEvidence);
    expect(active).toEqual(prepared);
    expect(assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic(
      connection,
      run.lock,
      run.clock,
      run.outerEvidence,
      run.outerTombstone,
      run.preRebindEvidence,
      preRebindTombstone,
    )).toEqual(active);
  });

  it("rejects active proof before consumption and rejects tombstone clones", () => {
    const connection = openRun();
    const run = preparedSessionClockGraph(connection);
    const clone = Object.freeze(Object.create(null)) as
      SQLiteCursorProviderClockConsumedTombstone;
    expectCode(
      () => assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic(
        connection,
        run.lock,
        run.clock,
        run.outerEvidence,
        run.outerTombstone,
        run.preRebindEvidence,
        clone,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    const preRebindTombstone = consumeSQLiteCursorProviderClockEvidenceIntrinsic(
      run.clock,
      run.preRebindEvidence,
      "cursor-publication-session",
    );
    expectCode(
      () => assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic(
        connection,
        run.lock,
        run.clock,
        run.outerEvidence,
        clone,
        run.preRebindEvidence,
        preRebindTombstone,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
  });

  it("rejects predecessor, capability, and connection substitutions", () => {
    const firstConnection = openRun();
    const secondConnection = openRun();
    const first = preparedSessionClockGraph(firstConnection);
    const second = preparedSessionClockGraph(secondConnection);

    for (const assertion of [
      () => assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
        firstConnection,
        first.lock,
        first.clock,
        second.outerEvidence,
        first.outerTombstone,
        first.preRebindEvidence,
      ),
      () => assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
        firstConnection,
        second.lock,
        first.clock,
        first.outerEvidence,
        first.outerTombstone,
        first.preRebindEvidence,
      ),
      () => assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
        firstConnection,
        first.lock,
        second.clock,
        first.outerEvidence,
        first.outerTombstone,
        first.preRebindEvidence,
      ),
      () => assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
        secondConnection,
        first.lock,
        first.clock,
        first.outerEvidence,
        first.outerTombstone,
        first.preRebindEvidence,
      ),
    ]) {
      expectCode(assertion, "GE_CYCLE_STORE_INVALID_ARGUMENT");
    }
  });

  it("rejects a second-boundary graph overtaken by an early third observation", () => {
    const connection = openRun();
    const run = preparedSessionClockGraph(connection);
    observeSQLiteCursorProviderClockIntrinsic(run.clock, "before-verification");
    expectCode(
      () => assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
        connection,
        run.lock,
        run.clock,
        run.outerEvidence,
        run.outerTombstone,
        run.preRebindEvidence,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );

    const activeConnection = openRun();
    const active = preparedSessionClockGraph(activeConnection);
    const tombstone = consumeSQLiteCursorProviderClockEvidenceIntrinsic(
      active.clock,
      active.preRebindEvidence,
      "cursor-publication-session",
    );
    observeSQLiteCursorProviderClockIntrinsic(active.clock, "before-verification");
    expectCode(
      () => assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic(
        activeConnection,
        active.lock,
        active.clock,
        active.outerEvidence,
        active.outerTombstone,
        active.preRebindEvidence,
        tombstone,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
  });

  it("rejects post-observation total-change and live-lock drift", () => {
    const changedConnection = openRun();
    const changed = preparedSessionClockGraph(changedConnection);
    changedConnection.prepare(
      "UPDATE main.ge_cycle_schema SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1",
      "inspect-schema",
    ).run();
    expectCode(
      () => assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
        changedConnection,
        changed.lock,
        changed.clock,
        changed.outerEvidence,
        changed.outerTombstone,
        changed.preRebindEvidence,
      ),
      "GE_CYCLE_STORE_STALE_FENCE",
    );

    const lockConnection = openRun();
    const lockRun = preparedSessionClockGraph(lockConnection);
    lockConnection.prepare(
      "UPDATE main.ge_cycle_migration_lock SET active_owner_id = ? WHERE singleton = 1",
      "inspect-schema",
    ).run("substituted-owner");
    expectCode(
      () => assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
        lockConnection,
        lockRun.lock,
        lockRun.clock,
        lockRun.outerEvidence,
        lockRun.outerTombstone,
        lockRun.preRebindEvidence,
      ),
      "GE_CYCLE_STORE_STALE_FENCE",
    );
  });

  it("mints four distinct chained receipts and consumes each through its exact owner", () => {
    const run = authority(openRun(), [100, 200, 300, 400]);
    const evidence: SQLiteCursorProviderClockEvidence[] = [];
    let previous: SQLiteCursorProviderClockEvidence | undefined;
    for (const boundary of SQLITE_CURSOR_CLOCK_BOUNDARIES) {
      const current = observeSQLiteCursorProviderClockIntrinsic(run.clock, boundary);
      expect(current).not.toBe(previous);
      expect(assertSQLiteCursorProviderClockEvidencePredecessorIntrinsic(
        run.clock, current, previous,
      )).toBe(current);
      const snapshot = readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
        run.clock, current,
      );
      expect(snapshot).toMatchObject({
        activeExpiresAtMs: 1_000,
        boundary,
        consumer: SQLITE_CURSOR_CLOCK_CONSUMERS[boundary],
      });
      evidence.push(current);
      previous = current;
    }
    expect(evidence.map((item) =>
      readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(run.clock, item).providerNowMs,
    )).toEqual([100, 200, 300, 400]);

    for (const [index, boundary] of SQLITE_CURSOR_CLOCK_BOUNDARIES.entries()) {
      const current = evidence[index]!;
      const consumer = SQLITE_CURSOR_CLOCK_CONSUMERS[boundary];
      const tombstone = consumeSQLiteCursorProviderClockEvidenceIntrinsic(
        run.clock, current, consumer,
      );
      expect(assertSQLiteCursorProviderClockConsumedTombstoneIntrinsic(
        run.clock, current, tombstone, consumer,
      )).toBe(tombstone);
      expectCode(
        () => consumeSQLiteCursorProviderClockEvidenceIntrinsic(run.clock, current, consumer),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
    }
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        run.clock, "before-commit",
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
  });

  it("preserves BEGIN lineage across DDL epochs but rejects rollback and rebegin", () => {
    const connection = openRun();
    const run = authority(connection, [100, 200, 300]);
    const before = readSQLiteConnectionOwnerSnapshot(connection);
    observeSQLiteCursorProviderClockIntrinsic(run.clock, "before-first-permanent-mutation");
    connection.execTrusted(
      "CREATE TEMP TABLE temp.ge_b3_epoch_probe (id INTEGER PRIMARY KEY)",
      "inspect-schema",
    );
    const afterDdl = readSQLiteConnectionOwnerSnapshot(connection);
    expect(afterDdl.transactionLineage).toBe(before.transactionLineage);
    expect(afterDdl.transactionEpoch).toBeGreaterThan(before.transactionEpoch);
    expect(() => observeSQLiteCursorProviderClockIntrinsic(
      run.clock, "before-cursor-rebind",
    )).not.toThrow();

    const beforeTrigger = readSQLiteConnectionOwnerSnapshot(connection);
    connection.execTrusted(
      "CREATE TEMP TABLE temp.ge_b3_trigger_target (id INTEGER);"
      + "CREATE TEMP TRIGGER ge_b3_trigger AFTER INSERT ON ge_b3_trigger_target "
      + "BEGIN SELECT CASE WHEN NEW.id > 0 THEN 1 ELSE 0 END; SELECT 2; END;",
      "inspect-schema",
    );
    expect(readSQLiteConnectionOwnerSnapshot(connection).transactionLineage)
      .toBe(beforeTrigger.transactionLineage);

    connection.execTrusted("ROLLBACK", "inspect-schema");
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    expect(readSQLiteConnectionOwnerSnapshot(connection).transactionLineage)
      .not.toBe(before.transactionLineage);
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(run.clock, "before-verification"),
      "GE_CYCLE_STORE_STALE_FENCE",
    );
  });

  it("rejects skipped boundaries and cloned or substituted authority objects", () => {
    const connection = openRun();
    const first = authority(connection, [100, 200]);
    const second = authority(connection, [100, 200]);
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(first.clock, "before-cursor-rebind"),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    const evidence = observeSQLiteCursorProviderClockIntrinsic(
      first.clock, "before-first-permanent-mutation",
    );
    const clone = Object.freeze(Object.create(null)) as SQLiteCursorProviderClockEvidence;
    expectCode(
      () => readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(first.clock, clone),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    expectCode(
      () => consumeSQLiteCursorProviderClockEvidenceIntrinsic(
        second.clock, evidence, "outer-publication-authority",
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    expectCode(
      () => createSQLiteCursorProviderClockCapabilityIntrinsic(
        connection,
        Object.freeze(Object.create(null)) as SQLiteCursorMigrationLockCapability,
        first.source,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    expectCode(
      () => createSQLiteCursorProviderClockCapabilityIntrinsic(
        connection,
        first.lock,
        Object.freeze(Object.create(null)) as SQLiteCursorProviderClockSource,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
  });

  it("rejects regressing unsafe equal-expiry and past-expiry provider clocks", () => {
    const regression = authority(openRun(), [100, 99]);
    observeSQLiteCursorProviderClockIntrinsic(
      regression.clock, "before-first-permanent-mutation",
    );
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        regression.clock, "before-cursor-rebind",
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );

    for (const invalid of [1_000, 1_001]) {
      const expired = authority(openRun(), [invalid]);
      expectCode(
        () => observeSQLiteCursorProviderClockIntrinsic(
          expired.clock, "before-first-permanent-mutation",
        ),
        "GE_CYCLE_STORE_STALE_FENCE",
      );
    }
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const unavailable = authority(openRun(), [invalid]);
      expectCode(
        () => observeSQLiteCursorProviderClockIntrinsic(
          unavailable.clock, "before-first-permanent-mutation",
        ),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
    }
  });

  it("rereads the live lock and rejects provider-clock mutation side effects", () => {
    const connection = openRun();
    const drift = authority(connection, [100, 200]);
    observeSQLiteCursorProviderClockIntrinsic(drift.clock, "before-first-permanent-mutation");
    connection.prepare(
      "UPDATE main.ge_cycle_migration_lock SET active_owner_id = ? WHERE singleton = 1",
      "inspect-schema",
    ).run("other-owner");
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(drift.clock, "before-cursor-rebind"),
      "GE_CYCLE_STORE_STALE_FENCE",
    );

    const sideEffectConnection = openRun();
    const source = createSQLiteCursorProviderClockSourceIntrinsic(() => {
      sideEffectConnection.prepare(
        "UPDATE main.ge_cycle_schema SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1",
        "inspect-schema",
      ).run();
      return 100;
    });
    const lock = createSQLiteCursorMigrationLockCapabilityIntrinsic(sideEffectConnection, LOCK);
    const clock = createSQLiteCursorProviderClockCapabilityIntrinsic(
      sideEffectConnection, lock, source,
    );
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        clock, "before-first-permanent-mutation",
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        clock, "before-first-permanent-mutation",
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );
  });

  it("poisons reentrant observation before either call can mint evidence", () => {
    const connection = openRun();
    let clock: SQLiteCursorProviderClockCapability;
    const source = createSQLiteCursorProviderClockSourceIntrinsic(() => {
      try {
        observeSQLiteCursorProviderClockIntrinsic(
          clock, "before-first-permanent-mutation",
        );
      } catch {
        // A hostile callback may swallow the nested structured failure.
      }
      return 100;
    });
    const lock = createSQLiteCursorMigrationLockCapabilityIntrinsic(connection, LOCK);
    clock = createSQLiteCursorProviderClockCapabilityIntrinsic(connection, lock, source);
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        clock, "before-first-permanent-mutation",
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );
    expectCode(
      () => observeSQLiteCursorProviderClockIntrinsic(
        clock, "before-first-permanent-mutation",
      ),
      "GE_CYCLE_STORE_CORRUPTION",
    );
  });

  it("keeps the exact frozen 0002 script in the same BEGIN lineage", () => {
    const connection = openRun();
    const before = readSQLiteConnectionOwnerSnapshot(connection);
    const migration = readFileSync(new URL(
      "../../../spec/migrations/sqlite/0002-v1-to-v2-operation-replay.sql",
      import.meta.url,
    ), "utf8");
    connection.execTrusted(migration, "inspect-schema");
    const after = readSQLiteConnectionOwnerSnapshot(connection);
    expect(after.isTransaction).toBe(true);
    expect(after.transactionMode).toBe("exclusive");
    expect(after.transactionLineage).toBe(before.transactionLineage);
    expect(after.transactionEpoch).toBeGreaterThan(before.transactionEpoch);
  });

  it("translates hostile migration-lock shapes into structured failures", () => {
    const connection = openRun();
    for (const hostile of [null, undefined, Object.create(null)]) {
      expectCode(
        () => createSQLiteCursorMigrationLockCapabilityIntrinsic(
          connection,
          hostile as unknown as SQLiteCursorMigrationLockIdentity,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
    }
    const accessor = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(accessor, "lockEpoch", {
      enumerable: true,
      get: () => 1,
    });
    expectCode(
      () => createSQLiteCursorMigrationLockCapabilityIntrinsic(
        connection,
        accessor as unknown as SQLiteCursorMigrationLockIdentity,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    const proxy = new Proxy(LOCK, {
      ownKeys: () => { throw new Error("hostile proxy"); },
    });
    expectCode(
      () => createSQLiteCursorMigrationLockCapabilityIntrinsic(connection, proxy),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
  });
});
