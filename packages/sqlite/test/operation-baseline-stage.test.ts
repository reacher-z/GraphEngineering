import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  encodeOperationBaselineKey,
  encodeOperationBaselineState,
} from "../src/operation-baseline.js";
import {
  DEFAULT_SQLITE_BASELINE_TEMP_CACHE_KIB,
  MAX_SQLITE_BASELINE_TEMP_CACHE_KIB,
  MIN_SQLITE_BASELINE_TEMP_CACHE_KIB,
  configureSQLiteBaselineTempStorage,
  createSQLiteBaselineTempStage,
  proveSQLiteExclusiveBaselineTransaction,
  readSQLiteBaselineTempStorage,
  type SQLiteBaselineExpectedCounts,
} from "../src/operation-baseline-stage.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";

const temporaryRoots: string[] = [];
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);

function schemaBytes(): readonly [Buffer, Buffer] {
  return [
    encodeOperationBaselineKey("schema-envelope", { scope: "cycle-store" }),
    encodeOperationBaselineState("schema-envelope", {
      createdAtMs: 1,
      currentVersion: 1,
      latestMigrationAppliedAtMs: 2,
      latestMigrationSha256: H1,
      maxReaderVersion: 1,
      maxWriterVersion: 1,
      minReaderVersion: 1,
      minWriterVersion: 1,
      providerDescriptorHash: H2,
      schemaIdentitySha256: H3,
      updatedAtMs: 2,
    }),
  ];
}

function streamBytes(): readonly [Buffer, Buffer] {
  return [
    encodeOperationBaselineKey("stream-head", { streamId: "s", tenantId: "t" }),
    encodeOperationBaselineState("stream-head", {
      createdAtMs: 1,
      streamId: "s",
      tailRecordHash: null,
      tailSequence: -1,
      tenantId: "t",
      updatedAtMs: 1,
    }),
  ];
}

function opened(): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-baseline-stage-"));
  temporaryRoots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  configureSQLiteBaselineTempStorage(connection);
  return connection;
}

function expectProviderError(
  action: () => unknown,
  code: "GE_CYCLE_STORE_INVALID_ARGUMENT" | "GE_CYCLE_STORE_UNAVAILABLE",
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect(error).toMatchObject({ code, operation: "inspect-schema" });
    return;
  }
  throw new Error(`expected ${code}`);
}

function zeroCounts(): SQLiteBaselineExpectedCounts {
  return {
    "schema-envelope": 0,
    "migration-lineage": 0,
    "stream-head": 0,
    "record-identity": 0,
    "checkpoint-current": 0,
    "checkpoint-revision": 0,
    "lease-current": 0,
    "used-lease-identity": 0,
    "legal-hold": 0,
    "migration-lock-current": 0,
    "used-migration-lock-identity": 0,
    "legacy-operation": 0,
  };
}

function baselineObjects(connection: SQLiteConnection): readonly (readonly unknown[])[] {
  return connection.prepare(
    `SELECT type, name, tbl_name, sql
       FROM temp.sqlite_schema
      WHERE name LIKE 'ge_blr_%'
      ORDER BY type, name`,
    "inspect-schema",
  ).all() as unknown as readonly (readonly unknown[])[];
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SQLite operation baseline stage owner", () => {
  it("configures and reads back bounded FILE-backed TEMP storage", () => {
    const connection = opened();
    const exec = vi.spyOn(connection, "execTrusted");
    try {
      const profile = configureSQLiteBaselineTempStorage(connection);
      expect(profile).toEqual({
        tempStore: "file",
        cacheKiB: DEFAULT_SQLITE_BASELINE_TEMP_CACHE_KIB,
        cacheSpill: true,
      });
      expect(readSQLiteBaselineTempStorage(connection)).toEqual(profile);
      expect(exec.mock.calls.map(([sql]) => sql)).toEqual([
        "PRAGMA temp_store = FILE",
        `PRAGMA temp.cache_size = -${DEFAULT_SQLITE_BASELINE_TEMP_CACHE_KIB}`,
        "PRAGMA cache_spill = ON",
      ]);
      expect(exec.mock.calls.some(([sql]) => sql.includes("temp_store_directory"))).toBe(false);
    } finally {
      exec.mockRestore();
      connection.close();
    }
  });

  it("accepts exact TEMP cache boundaries and rejects every outside value", () => {
    const connection = opened();
    try {
      expect(configureSQLiteBaselineTempStorage(connection, {
        cacheKiB: MIN_SQLITE_BASELINE_TEMP_CACHE_KIB,
      }).cacheKiB).toBe(MIN_SQLITE_BASELINE_TEMP_CACHE_KIB);
      expect(configureSQLiteBaselineTempStorage(connection, {
        cacheKiB: MAX_SQLITE_BASELINE_TEMP_CACHE_KIB,
      }).cacheKiB).toBe(MAX_SQLITE_BASELINE_TEMP_CACHE_KIB);
      for (const cacheKiB of [
        MIN_SQLITE_BASELINE_TEMP_CACHE_KIB - 1,
        MAX_SQLITE_BASELINE_TEMP_CACHE_KIB + 1,
        1.5,
        Number.MAX_SAFE_INTEGER + 1,
      ]) {
        expect(() => configureSQLiteBaselineTempStorage(connection, { cacheKiB }))
          .toThrowError(/outside bounds/u);
      }
    } finally {
      connection.close();
    }
  });

  it("rejects TEMP configuration after any transaction begins", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => configureSQLiteBaselineTempStorage(connection)).toThrowError(
        /outside a transaction/u,
      );
      expect(() => readSQLiteBaselineTempStorage(connection)).toThrowError(
        /read outside a transaction/u,
      );
      expect(connection.transactionMode).toBe("exclusive");
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("proves only the active owner EXCLUSIVE epoch", () => {
    const connection = opened();
    try {
      expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );
      for (const begin of ["BEGIN", "BEGIN DEFERRED", "BEGIN IMMEDIATE"] as const) {
        connection.execTrusted(begin, "inspect-schema");
        expect(connection.transactionMode).not.toBe("exclusive");
        expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
          /requires an owner EXCLUSIVE transaction/u,
        );
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
      connection.execTrusted(";;/* owner */ BEGIN EXCLUSIVE", "inspect-schema");
      const proof = proveSQLiteExclusiveBaselineTransaction(connection);
      expect(proof).toEqual({
        mode: "exclusive",
        transactionEpoch: connection.transactionEpoch,
      });
      expect(Object.isFrozen(proof)).toBe(true);
      connection.execTrusted("SAVEPOINT nested", "inspect-schema");
      connection.execTrusted("ROLLBACK TO nested", "inspect-schema");
      connection.execTrusted("RELEASE nested", "inspect-schema");
      expect(proveSQLiteExclusiveBaselineTransaction(connection).mode).toBe("exclusive");
      connection.execTrusted("SAVEPOINT nested_long", "inspect-schema");
      connection.execTrusted(
        "ROLLBACK TRANSACTION TO SAVEPOINT nested_long",
        "inspect-schema",
      );
      connection.execTrusted("RELEASE nested_long", "inspect-schema");
      expect(proveSQLiteExclusiveBaselineTransaction(connection).mode).toBe("exclusive");
      connection.execTrusted("ROLLBACK", "inspect-schema");
      expect(connection.transactionMode).toBeNull();
      expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );

      connection.execTrusted("BEGIN /* mode */ EXCLUSIVE /* trailing */", "inspect-schema");
      expect(proveSQLiteExclusiveBaselineTransaction(connection).mode).toBe("exclusive");
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("does not carry EXCLUSIVE proof across a multi-statement transaction swap", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(proveSQLiteExclusiveBaselineTransaction(connection).mode).toBe("exclusive");
      connection.execTrusted(
        "SELECT 1; COMMIT; BEGIN DEFERRED",
        "inspect-schema",
      );
      expect(connection.isTransaction).toBe(true);
      expect(connection.transactionMode).toBe("unknown");
      expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");

      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => connection.execTrusted(
        "COMMIT; BEGIN DEFERRED; SELECT * FROM definitely_missing_table",
        "inspect-schema",
      )).toThrow();
      expect(connection.isTransaction).toBe(true);
      expect(connection.transactionMode).toBe("unknown");
      expect(() => proveSQLiteExclusiveBaselineTransaction(connection)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("fails readback drift and forbids temp_store_directory", () => {
    const connection = opened();
    try {
      configureSQLiteBaselineTempStorage(connection);
      connection.execTrusted("PRAGMA temp.cache_size = -512", "inspect-schema");
      expect(() => readSQLiteBaselineTempStorage(connection)).toThrowError(
        /profile was not retained/u,
      );
      expect(() => connection.prepare(
        "/* hostile */ PRAGMA temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        ";; PRAGMA temp.temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "PRAGMA main.\"temp_store_directory\" = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "PRAGMA cache_size; PRAGMA temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "SELECT 1; PRAGMA temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "PRAGMA /* hostile */ temp_store_directory = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
      expect(() => connection.execTrusted(
        "PRAGMA [temp_store_directory] = '/tmp'",
        "inspect-schema",
      )).toThrowError(/temp_store_directory is forbidden/u);
    } finally {
      connection.close();
    }
  });

  it("uses stable structured codes for owner, option, directory, and readback failures", () => {
    const connection = opened();
    try {
      expectProviderError(
        () => proveSQLiteExclusiveBaselineTransaction(connection),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      expectProviderError(
        () => configureSQLiteBaselineTempStorage(connection, { cacheKiB: 1 }),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      expectProviderError(
        () => connection.execTrusted("PRAGMA temp_store_directory='/tmp'", "inspect-schema"),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
      );
      configureSQLiteBaselineTempStorage(connection);
      connection.execTrusted("PRAGMA temp.cache_size=-1", "inspect-schema");
      expectProviderError(
        () => readSQLiteBaselineTempStorage(connection),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
    } finally {
      connection.close();
    }
  });

  it("binds creation to the exact current EXCLUSIVE owner proof", () => {
    const first = opened();
    const second = opened();
    try {
      first.execTrusted("BEGIN IMMEDIATE", "inspect-schema");
      expect(() => proveSQLiteExclusiveBaselineTransaction(first)).toThrowError(
        /requires an owner EXCLUSIVE transaction/u,
      );
      first.execTrusted("ROLLBACK", "inspect-schema");

      first.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const firstProof = proveSQLiteExclusiveBaselineTransaction(first);
      second.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => createSQLiteBaselineTempStage(second, firstProof)).toThrowError(
        /requires its current owner EXCLUSIVE proof/u,
      );
      const stage = createSQLiteBaselineTempStage(first, firstProof);
      expect(stage.state).toBe("open");
      stage.dispose();
    } finally {
      if (first.isTransaction) first.execTrusted("ROLLBACK", "inspect-schema");
      if (second.isTransaction) second.execTrusted("ROLLBACK", "inspect-schema");
      first.close();
      second.close();
    }
  });

  it("refuses stage creation unless the bounded FILE TEMP profile is retained", () => {
    const root = mkdtempSync(join(tmpdir(), "graph-engineering-baseline-stage-profile-"));
    temporaryRoots.push(root);
    const connection = new SQLiteConnection(join(root, "cycle-store.db"));
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const proof = proveSQLiteExclusiveBaselineTransaction(connection);
      expect(() => createSQLiteBaselineTempStage(connection, proof)).toThrowError(
        /FILE-backed TEMP profile was not retained/u,
      );
      expect(baselineObjects(connection)).toEqual([]);
      expect(connection.isTransaction).toBe(true);
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("creates the fixed STRICT WITHOUT ROWID relation catalog and indexes", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const objects = baselineObjects(connection);
      const tables = objects.filter(([type]) => type === "table");
      const indexes = objects.filter(([type]) => type === "index");
      const views = objects.filter(([type]) => type === "view");
      expect(tables.map(([, name]) => name)).toEqual([
        "ge_blr_checkpoint_current",
        "ge_blr_checkpoint_revisions",
        "ge_blr_holds",
        "ge_blr_leases",
        "ge_blr_legacy_operations",
        "ge_blr_migration_lock",
        "ge_blr_migrations",
        "ge_blr_records",
        "ge_blr_schema",
        "ge_blr_stage",
        "ge_blr_streams",
        "ge_blr_used_leases",
        "ge_blr_used_migration_locks",
      ]);
      expect(tables).toHaveLength(13);
      for (const [, , , sql] of tables) {
        expect(sql).toEqual(expect.stringMatching(/STRICT, WITHOUT ROWID$/u));
        expect(sql).toEqual(expect.stringContaining("key_blob"));
      }
      expect(indexes.map(([, name]) => name)).toEqual([
        "ge_blr_checkpoint_current_record_idx",
        "ge_blr_checkpoint_revisions_latest_idx",
        "ge_blr_checkpoint_revisions_record_idx",
        "ge_blr_records_stream_position_idx",
        "ge_blr_records_stream_sequence_uidx",
        "ge_blr_records_tenant_hash_uidx",
        "ge_blr_used_leases_epoch_uidx",
        "ge_blr_used_leases_fencing_uidx",
        "ge_blr_used_migration_locks_epoch_uidx",
        "ge_blr_used_migration_locks_fencing_uidx",
      ]);
      expect(views.map(([, name]) => name)).toEqual(["ge_blr_relation_keys"]);
      expect(String(views[0]?.[3])).toContain("UNION ALL SELECT 11");
      stage.assertCommonCounts(zeroCounts());
      stage.assertRelationKeyCoverage();
      stage.dispose();
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("rejects repeated creation without damaging the active stage", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const currentProof = proveSQLiteExclusiveBaselineTransaction(connection);
      expect(() => createSQLiteBaselineTempStage(connection, currentProof)).toThrowError(
        /already exists/u,
      );
      expect(stage.state).toBe("open");
      stage.assertCommonCounts(zeroCounts());
      expect(baselineObjects(connection).filter(([type]) => type === "table")).toHaveLength(13);
      stage.dispose();
      expect(baselineObjects(connection)).toEqual([]);
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("enforces exact one-row common writes, canonical bytes, and duplicate poison", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const [key, state] = schemaBytes();
      stage.insertCommon("schema-envelope", key, state);
      stage.assertCommonCounts({ ...zeroCounts(), "schema-envelope": 1 });
      expect(() => stage.insertCommon("schema-envelope", key, state)).toThrowError(
        /common-stage insert failed/u,
      );
      expect(stage.state).toBe("poisoned");
      expect(() => stage.assertCommonCounts(zeroCounts())).toThrowError(/poisoned/u);
      stage.dispose();
      expect(stage.state).toBe("disposed");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("poisons canonical bytes whose key and state identity disagree", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const key = encodeOperationBaselineKey(
        "stream-head",
        { streamId: "s", tenantId: "tenant-a" },
      );
      const state = encodeOperationBaselineState("stream-head", {
        createdAtMs: 1,
        streamId: "s",
        tailRecordHash: null,
        tailSequence: -1,
        tenantId: "tenant-b",
        updatedAtMs: 1,
      });
      expect(() => stage.insertCommon("stream-head", key, state)).toThrowError(
        /entry bytes are invalid/u,
      );
      expect(stage.state).toBe("poisoned");
      stage.dispose();
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("poisons a spoofed zero-row common write and a missing relation", () => {
    const zeroWriteConnection = opened();
    try {
      zeroWriteConnection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        zeroWriteConnection,
        proveSQLiteExclusiveBaselineTransaction(zeroWriteConnection),
      );
      const originalPrepare = zeroWriteConnection.prepare.bind(zeroWriteConnection);
      const prepare = vi.spyOn(zeroWriteConnection, "prepare").mockImplementation(
        (sql, operation) => sql.startsWith("INSERT INTO temp.ge_blr_stage")
          ? ({ run: () => ({ changes: 0 }) } as never)
          : originalPrepare(sql, operation),
      );
      try {
        const [key, stateBytes] = schemaBytes();
        expect(() => stage.insertCommon("schema-envelope", key, stateBytes)).toThrowError(
          /write count is invalid/u,
        );
        expect(stage.state).toBe("poisoned");
      } finally {
        prepare.mockRestore();
        stage.dispose();
      }
    } finally {
      if (zeroWriteConnection.isTransaction) {
        zeroWriteConnection.execTrusted("ROLLBACK", "inspect-schema");
      }
      zeroWriteConnection.close();
    }

    const missingConnection = opened();
    try {
      missingConnection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        missingConnection,
        proveSQLiteExclusiveBaselineTransaction(missingConnection),
      );
      const [key, stateBytes] = schemaBytes();
      stage.insertCommon("schema-envelope", key, stateBytes);
      expect(() => stage.assertRelationKeyCoverage()).toThrowError(/coverage is invalid/u);
      expect(stage.state).toBe("poisoned");
      stage.dispose();
    } finally {
      if (missingConnection.isTransaction) {
        missingConnection.execTrusted("ROLLBACK", "inspect-schema");
      }
      missingConnection.close();
    }
  });

  it("detects extra and rank-mismatched relation keys behind the write fence", () => {
    const cases = ["extra", "rank-mismatch"] as const;
    for (const attack of cases) {
      const connection = opened();
      try {
        connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
        const stage = createSQLiteBaselineTempStage(
          connection,
          proveSQLiteExclusiveBaselineTransaction(connection),
        );
        const [key, stateBytes] = schemaBytes();
        let allowedTotalChanges = 0;
        if (attack === "extra") {
          connection.prepare(
            `INSERT INTO temp.ge_blr_schema
               (key_blob, singleton, current_version, min_reader_version,
                max_reader_version, min_writer_version, max_writer_version,
                schema_identity_sha256, latest_migration_sha256,
                provider_descriptor_hash, latest_migration_applied_at_ms,
                created_at_ms, updated_at_ms)
             VALUES (?, 1, 1, 1, 1, 1, 1, ?, ?, ?, 2, 1, 2)`,
            "inspect-schema",
          ).run(key, H3, H1, H2);
        } else {
          stage.insertCommon("schema-envelope", key, stateBytes);
          allowedTotalChanges = 1;
          connection.prepare(
            `INSERT INTO temp.ge_blr_migrations
               (key_blob, version, previous_version, migration_id, sql_sha256,
                schema_identity_sha256, applied_at_ms)
             VALUES (?, 1, 0, 'm1', ?, ?, 2)`,
            "inspect-schema",
          ).run(key, H1, H3);
        }
        const originalPrepare = connection.prepare.bind(connection);
        const prepare = vi.spyOn(connection, "prepare").mockImplementation(
          (sql, operation) => sql === "SELECT total_changes()"
            ? originalPrepare(
              `SELECT ${allowedTotalChanges} AS "total_changes()"`,
              operation,
            )
            : originalPrepare(sql, operation),
        );
        try {
          expect(() => stage.assertRelationKeyCoverage()).toThrowError(/coverage is invalid/u);
          expect(stage.state).toBe("poisoned");
        } finally {
          prepare.mockRestore();
          stage.dispose();
        }
      } finally {
        if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
        connection.close();
      }
    }
  });

  it("poisons wrong counts and rejects a pre-existing reserved catalog", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const [key, state] = streamBytes();
      stage.insertCommon("stream-head", key, state);
      expect(() => stage.assertCommonCounts({
        ...zeroCounts(),
        unexpected: 0,
      } as unknown as SQLiteBaselineExpectedCounts)).toThrowError(/exactly twelve kinds/u);
      expect(stage.state).toBe("open");
      expect(() => stage.assertCommonCounts(zeroCounts())).toThrowError(/count is invalid/u);
      expect(stage.state).toBe("poisoned");
      stage.dispose();

      connection.execTrusted(
        "CREATE TEMP TABLE GE_BLR_Hostile_Residue(value INTEGER)",
        "inspect-schema",
      );
      expect(() => createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      )).toThrowError(/reserved catalog is not empty/u);
      connection.execTrusted("DROP TABLE temp.GE_BLR_Hostile_Residue", "inspect-schema");
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("invalidates on rollback/rebegin and disposes early in reverse order exactly once", () => {
    const connection = opened();
    const exec = vi.spyOn(connection, "execTrusted");
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => stage.assertCommonCounts(zeroCounts())).toThrowError(
        /transaction changed/u,
      );
      expect(stage.state).toBe("poisoned");
      const beforeDispose = exec.mock.calls.length;
      stage.dispose();
      expect(exec.mock.calls).toHaveLength(beforeDispose);

      const current = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const beforeCurrentDispose = exec.mock.calls.length;
      current.dispose();
      const drops = exec.mock.calls.slice(beforeCurrentDispose).map(([sql]) => sql);
      expect(drops[0]).toBe("DROP VIEW temp.ge_blr_relation_keys");
      expect(drops.at(-1)).toBe("DROP TABLE temp.ge_blr_stage");
      expect(drops).toHaveLength(24);
      expect(drops.some((sql) => /\b(?:COMMIT|ROLLBACK)\b/iu.test(sql))).toBe(false);
      expect(current.state).toBe("disposed");
      expect(baselineObjects(connection)).toEqual([]);
      current.dispose();
      expect(exec.mock.calls.slice(beforeCurrentDispose).map(([sql]) => sql)).toEqual(drops);
      expect(connection.isTransaction).toBe(true);
    } finally {
      exec.mockRestore();
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("never lets a stale stage dispose caller replacement objects", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stale = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      connection.execTrusted(
        "CREATE TEMP TABLE ge_blr_schema(caller_owned INTEGER)",
        "inspect-schema",
      );
      stale.dispose();
      expect(stale.state).toBe("disposed");
      const row = connection.prepare(
        "SELECT sql FROM temp.sqlite_schema WHERE name = 'ge_blr_schema'",
        "inspect-schema",
      ).get() as unknown as readonly unknown[];
      expect(String(row[0])).toContain("caller_owned");
      expect(() => createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      )).toThrowError(/reserved catalog is not empty/u);
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("closes checkpoint and legacy nullable groups against NULL smuggling", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const key = Buffer.from('{"id":"x"}', "utf8");
      expect(() => connection.prepare(
        `INSERT INTO temp.ge_blr_checkpoint_revisions
           (key_blob, tenant_id, checkpoint_scope, revision, checkpoint_id,
            action, stream_id, recorded_at_ms)
         VALUES (?, 't', 's', 1, 'c', 'delete', 'smuggled', 1)`,
        "inspect-schema",
      ).run(key)).toThrow();
      expect(() => connection.prepare(
        `INSERT INTO temp.ge_blr_legacy_operations
           (key_blob, tenant_id, operation_id, operation_name, request_hash,
            result_hash, result_blob_sha256, committed_at_ms, tail_exists)
         VALUES (?, 't', 'o', 'set-legal-hold', 'r', 'h', 'b', 1, 1)`,
        "inspect-schema",
      ).run(key)).toThrow();
      expect(() => connection.prepare(
        `INSERT INTO temp.ge_blr_legacy_operations
           (key_blob, tenant_id, operation_id, operation_name, request_hash,
            result_hash, result_blob_sha256, committed_at_ms,
            tail_exists, tail_record_hash, appended_records)
         VALUES (?, 't', 'append-null', 'append', 'r', 'h', 'b', 1, 1, 'tail', 1)`,
        "inspect-schema",
      ).run(key)).toThrow();
      expect(() => connection.prepare(
        `INSERT INTO temp.ge_blr_legacy_operations
           (key_blob, tenant_id, operation_id, operation_name, request_hash,
            result_hash, result_blob_sha256, committed_at_ms, checkpoint_deleted)
         VALUES (?, 't', 'delete-null', 'delete-checkpoint', 'r', 'h', 'b', 1, NULL)`,
        "inspect-schema",
      ).run(key)).toThrow();
      const inserted = connection.prepare(
        `INSERT INTO temp.ge_blr_legacy_operations
           (key_blob, tenant_id, operation_id, operation_name, request_hash,
            result_hash, result_blob_sha256, committed_at_ms)
         VALUES (?, 't', 'o', 'release-migration-lock', 'r', 'h', 'b', 1)`,
        "inspect-schema",
      ).run(key);
      expect(inserted.changes === 1 || inserted.changes === 1n).toBe(true);
      stage.dispose();
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("enforces stream, record, lease, and lock carrier identities in SQL", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const key = Buffer.from('{"id":"x"}', "utf8");
      expect(() => connection.prepare(
        `INSERT INTO temp.ge_blr_streams
           (key_blob, tenant_id, stream_id, tail_sequence, tail_record_hash,
            created_at_ms, updated_at_ms)
         VALUES (?, 't', 's', -1, 'not-null', 1, 1)`,
        "inspect-schema",
      ).run(key)).toThrow();
      expect(() => connection.prepare(
        `INSERT INTO temp.ge_blr_records
           (key_blob, tenant_id, stream_id, record_id, sequence,
            previous_record_hash, record_hash, value_hash, value_bytes, committed_at_ms)
         VALUES (?, 't', 's', 'r', 1, NULL, 'h', 'v', 1, 1)`,
        "inspect-schema",
      ).run(key)).toThrow();
      expect(() => connection.prepare(
        `INSERT INTO temp.ge_blr_used_leases
           (key_blob, tenant_id, stream_id, lease_id, lease_epoch,
            fencing_token, first_used_at_ms)
         VALUES (?, 't', 's', 'l', 2, 3, 1)`,
        "inspect-schema",
      ).run(key)).toThrow();
      expect(() => connection.prepare(
        `INSERT INTO temp.ge_blr_migration_lock
           (key_blob, singleton, active_lock_id, active_owner_id,
            active_source_version, active_target_version, active_lock_epoch,
            active_fencing_token, active_acquired_at_ms, active_expires_at_ms,
            last_lock_epoch, last_fencing_token, updated_at_ms)
         VALUES (?, 1, 'l', 'o', 2, 1, 1, 1, 1, 2, 1, 1, 2)`,
        "inspect-schema",
      ).run(key)).toThrow();
      stage.dispose();
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("rejects an injected row write during catalog creation", () => {
    const connection = opened();
    try {
      connection.execTrusted("CREATE TABLE caller_probe(value INTEGER)", "inspect-schema");
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const proof = proveSQLiteExclusiveBaselineTransaction(connection);
      const original = connection.execTrusted.bind(connection);
      let injected = false;
      const exec = vi.spyOn(connection, "execTrusted").mockImplementation((sql, operation) => {
        original(sql, operation);
        if (!injected && sql.startsWith("CREATE TEMP TABLE ge_blr_schema")) {
          injected = true;
          connection.prepare(
            "INSERT INTO caller_probe(value) VALUES (1)",
            "inspect-schema",
          ).run();
        }
      });
      try {
        expect(() => createSQLiteBaselineTempStage(connection, proof)).toThrowError(
          /catalog creation changed rows/u,
        );
        expect(baselineObjects(connection)).toEqual([]);
      } finally {
        exec.mockRestore();
      }
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });

  it("preserves catalog creation failure while continuing reverse cleanup", () => {
    const connection = opened();
    try {
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      const proof = proveSQLiteExclusiveBaselineTransaction(connection);
      const original = connection.execTrusted.bind(connection);
      const executed: string[] = [];
      let createFailed = false;
      const exec = vi.spyOn(connection, "execTrusted").mockImplementation((sql, operation) => {
        executed.push(sql);
        if (!createFailed && sql.startsWith(
          "CREATE INDEX ge_blr_checkpoint_revisions_latest_idx",
        )) {
          createFailed = true;
          throw new Error("authoritative-create-failure");
        }
        if (sql === "DROP INDEX temp.ge_blr_records_stream_position_idx") {
          throw new Error("secondary-cleanup-failure");
        }
        original(sql, operation);
      });
      try {
        expect(() => createSQLiteBaselineTempStage(connection, proof)).toThrowError(
          /authoritative-create-failure/u,
        );
        expect(executed).toContain("DROP TABLE temp.ge_blr_stage");
        expect(baselineObjects(connection)).toEqual([]);
      } finally {
        exec.mockRestore();
      }
    } finally {
      if (connection.isTransaction) connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.close();
    }
  });
});
