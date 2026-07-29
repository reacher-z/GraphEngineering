import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CycleStoreProviderError, type CycleStoreProviderOperation } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { sqliteRow, sqliteSafeInteger, sqliteText } from "../src/sqlite-codec.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import {
  SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
  SQLITE_CYCLE_STORE_APPLICATION_ID,
  SQLITE_MIGRATION_MANIFEST_SHA256,
  SQLITE_SCHEMA_CATALOG_SHA256,
  SQLITE_SCHEMA_IDENTITY_SHA256,
  SQLITE_SCHEMA_SQL_SHA256,
  ensureSQLiteCycleStoreSchema,
  loadSQLiteMigrationAssets,
  verifySQLiteMigrationAssetText,
} from "../src/migrations.js";
import {
  SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  createSQLiteCycleStoreDescriptor,
} from "../src/sqlite-profile.js";

const temporaryRoots: string[] = [];
const APPLIED_AT_MS = 1_785_110_405_000;

function databasePath(name = "cycle-store.db"): string {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-migration-"));
  temporaryRoots.push(root);
  return join(root, name);
}

function packagedText() {
  return {
    manifest: readFileSync(new URL("../migrations/manifest.json", import.meta.url), "utf8"),
    schemaIdentity: readFileSync(
      new URL("../migrations/schema-v1.identity.json", import.meta.url),
      "utf8",
    ),
    schemaSql: readFileSync(new URL("../migrations/schema-v1.sql", import.meta.url), "utf8"),
    alphaV0ToV1Sql: readFileSync(
      new URL("../migrations/0001-alpha-v0-to-v1.sql", import.meta.url),
      "utf8",
    ),
  };
}

function integer(connection: SQLiteConnection, sql: string, maximum = Number.MAX_SAFE_INTEGER) {
  return sqliteSafeInteger(
    sqliteRow(connection.prepare(sql, "inspect-schema").get(), 1, "inspect-schema", sql)[0],
    0,
    maximum,
    "inspect-schema",
    sql,
  );
}

function text(connection: SQLiteConnection, sql: string) {
  return sqliteText(
    sqliteRow(connection.prepare(sql, "inspect-schema").get(), 1, "inspect-schema", sql)[0],
    "inspect-schema",
    sql,
  );
}

function expectProviderCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect(error).toMatchObject({ code, operation: "inspect-schema" });
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SQLite migration assets", () => {
  it("vendors every runtime asset byte-for-byte from the canonical specification", () => {
    for (const name of [
      "manifest.json",
      "schema-v1.identity.json",
      "schema-v1.sql",
      "0001-alpha-v0-to-v1.sql",
      "0002-v1-to-v2-operation-replay.sql",
      "manifest-v2.preview.json",
    ]) {
      const packaged = readFileSync(new URL(`../migrations/${name}`, import.meta.url));
      const python = readFileSync(new URL(
        `../../../python/src/graph_engineering/_sqlite_migrations/${name}`,
        import.meta.url,
      ));
      const canonical = readFileSync(
        new URL(`../../../spec/migrations/sqlite/${name}`, import.meta.url),
      );
      expect(packaged.equals(canonical), name).toBe(true);
      expect(python.equals(canonical), `python/${name}`).toBe(true);
    }
  });

  it("loads a checksum-anchored immutable asset set", () => {
    expect(loadSQLiteMigrationAssets()).toMatchObject({
      manifestSha256: SQLITE_MIGRATION_MANIFEST_SHA256,
      schemaSqlSha256: SQLITE_SCHEMA_SQL_SHA256,
      schemaIdentitySha256: SQLITE_SCHEMA_IDENTITY_SHA256,
      alphaV0ToV1SqlSha256: SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
    });
    expect(SQLITE_MIGRATION_MANIFEST_SHA256).toBe(
      "5f052a21215a39de101d56447fa4b25d20b6053bc558e3960562932e958d7af6",
    );
    expect(SQLITE_SCHEMA_CATALOG_SHA256).toBe(
      "8fab5049e2c9de5d114abc0c682934f1bc6fb5abd2e4c2e3ae55ef329c3e7264",
    );
  });

  it("rejects one changed SQL byte before it can reach a connection", () => {
    const source = packagedText();
    expectProviderCode(
      () => verifySQLiteMigrationAssetText({
        ...source,
        schemaSql: `${source.schemaSql}-- drift\n`,
      }),
      "GE_CYCLE_STORE_CORRUPTION",
    );
  });

  it("rejects a changed self-reporting manifest through the compiled trust anchor", () => {
    const source = packagedText();
    const manifest = JSON.parse(source.manifest) as Record<string, unknown>;
    manifest.latestVersion = 2;
    expectProviderCode(
      () => verifySQLiteMigrationAssetText({
        ...source,
        manifest: `${JSON.stringify(manifest, null, 2)}\n`,
      }),
      "GE_CYCLE_STORE_CORRUPTION",
    );
  });
});

describe("SQLite schema lifecycle", () => {
  it("takes the default provider timestamp from SQLite inside the exclusive transaction", () => {
    const connection = new SQLiteConnection(databasePath("transaction-clock.db"));
    const originalPrepare = connection.prepare.bind(connection);
    const startedAt = Date.now();
    let observedTransactionClock = false;
    Object.defineProperty(connection, "prepare", {
      configurable: true,
      value(sql: string, operation: CycleStoreProviderOperation) {
        if (sql.includes("strftime('%s', 'now')")) {
          expect(connection.isTransaction).toBe(true);
          observedTransactionClock = true;
        }
        return originalPrepare(sql, operation);
      },
    });
    try {
      expect(ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor()))
        .toMatchObject({ disposition: "initialized" });
      expect(observedTransactionClock).toBe(true);
      const appliedAtMs = integer(
        connection,
        "SELECT latest_migration_applied_at_ms FROM ge_cycle_schema",
      );
      expect(appliedAtMs).toBeGreaterThanOrEqual(startedAt - 1_000);
      expect(appliedAtMs).toBeLessThanOrEqual(Date.now() + 1_000);
    } finally {
      connection.close();
    }
  });

  it("initializes a fresh database and validates the same immutable lineage on reopen", () => {
    const path = databasePath();
    const descriptor = createSQLiteCycleStoreDescriptor();
    const first = new SQLiteConnection(path);
    try {
      expect(ensureSQLiteCycleStoreSchema(first, descriptor, { appliedAtMs: APPLIED_AT_MS }))
        .toEqual({
          disposition: "initialized",
          applicationId: SQLITE_CYCLE_STORE_APPLICATION_ID,
          schemaVersion: 1,
          schemaIdentitySha256: SQLITE_SCHEMA_IDENTITY_SHA256,
          lineageId: "fresh-v1-baseline",
          lineageSha256: SQLITE_SCHEMA_SQL_SHA256,
          descriptorHash: SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
        });
      expect(integer(first, "PRAGMA application_id")).toBe(SQLITE_CYCLE_STORE_APPLICATION_ID);
      expect(integer(first, "PRAGMA user_version")).toBe(1);
      expect(integer(first, "SELECT count(*) FROM ge_cycle_schema")).toBe(1);
      expect(integer(first, "SELECT count(*) FROM ge_cycle_migrations")).toBe(1);
      expect(integer(first, "SELECT count(*) FROM ge_cycle_migration_lock")).toBe(1);
    } finally {
      first.close();
    }

    const reopened = new SQLiteConnection(path);
    try {
      expect(ensureSQLiteCycleStoreSchema(reopened, descriptor)).toMatchObject({
        disposition: "existing",
        lineageId: "fresh-v1-baseline",
        lineageSha256: SQLITE_SCHEMA_SQL_SHA256,
      });
      expect(integer(reopened, "SELECT updated_at_ms FROM ge_cycle_schema")).toBe(APPLIED_AT_MS);
    } finally {
      reopened.close();
    }
  });

  it("migrates the immediately previous alpha without changing durable carriers", () => {
    const path = databasePath("alpha.db");
    const connection = new SQLiteConnection(path);
    try {
      connection.execTrusted(
        readFileSync(
          new URL("../../../spec/migrations/sqlite/fixtures/alpha-v0.sql", import.meta.url),
          "utf8",
        ),
        "inspect-schema",
      );
      const beforeRecord = Buffer.from(
        sqliteRow(
          connection.prepare(
            `SELECT record_blob FROM ge_cycle_records
              WHERE tenant_id = 'tenant-alpha' AND sequence = 1`,
            "inspect-schema",
          ).get(),
          1,
          "inspect-schema",
          "record blob",
        )[0] as Uint8Array,
      );

      expect(ensureSQLiteCycleStoreSchema(
        connection,
        createSQLiteCycleStoreDescriptor(),
        { appliedAtMs: APPLIED_AT_MS },
      )).toMatchObject({
        disposition: "migrated",
        lineageId: "alpha-v0-to-v1",
        lineageSha256: SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
      });
      expect(integer(connection, "PRAGMA user_version")).toBe(1);
      expect(integer(connection, "SELECT count(*) FROM ge_cycle_records")).toBe(3);
      expect(integer(connection, "SELECT count(*) FROM ge_cycle_checkpoint_revisions")).toBe(1);
      expect(integer(connection, "SELECT count(*) FROM ge_cycle_cursors")).toBe(0);
      expect(text(connection, "SELECT provider_descriptor_hash FROM ge_cycle_schema"))
        .toBe(SQLITE_CYCLE_STORE_DESCRIPTOR_HASH);
      const afterRecord = Buffer.from(
        sqliteRow(
          connection.prepare(
            `SELECT record_blob FROM ge_cycle_records
              WHERE tenant_id = 'tenant-alpha' AND sequence = 1`,
            "inspect-schema",
          ).get(),
          1,
          "inspect-schema",
          "record blob",
        )[0] as Uint8Array,
      );
      expect(afterRecord.equals(beforeRecord)).toBe(true);
    } finally {
      connection.close();
    }

    const reopened = new SQLiteConnection(path);
    try {
      expect(ensureSQLiteCycleStoreSchema(reopened, createSQLiteCycleStoreDescriptor()))
        .toMatchObject({ disposition: "existing", lineageId: "alpha-v0-to-v1" });
    } finally {
      reopened.close();
    }
  });

  it("rolls back schema, metadata, application id, and user version when commit fails", () => {
    const connection = new SQLiteConnection(databasePath("rollback.db"));
    const originalExec = connection.execTrusted.bind(connection);
    let failed = false;
    Object.defineProperty(connection, "execTrusted", {
      configurable: true,
      value(sql: string, operation: CycleStoreProviderOperation) {
        if (sql === "COMMIT" && !failed) {
          failed = true;
          throw new CycleStoreProviderError(
            "GE_CYCLE_STORE_UNAVAILABLE",
            operation,
            "injected commit failure",
          );
        }
        originalExec(sql, operation);
      },
    });
    try {
      expectProviderCode(
        () => ensureSQLiteCycleStoreSchema(
          connection,
          createSQLiteCycleStoreDescriptor(),
          { appliedAtMs: APPLIED_AT_MS },
        ),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
      expect(connection.isTransaction).toBe(false);
      expect(integer(connection, "PRAGMA application_id")).toBe(0);
      expect(integer(connection, "PRAGMA user_version")).toBe(0);
      expect(integer(
        connection,
        "SELECT count(*) FROM sqlite_schema WHERE name GLOB 'ge_cycle_*'",
      )).toBe(0);
    } finally {
      connection.close();
    }
  });

  it("refuses checksum, catalog, foreign-schema, and future-version drift", () => {
    const descriptor = createSQLiteCycleStoreDescriptor();

    const checksum = new SQLiteConnection(databasePath("checksum.db"));
    try {
      ensureSQLiteCycleStoreSchema(checksum, descriptor, { appliedAtMs: APPLIED_AT_MS });
      checksum.prepare(
        "UPDATE ge_cycle_migrations SET sql_sha256 = ?",
        "inspect-schema",
      ).run("e".repeat(64));
      expectProviderCode(
        () => ensureSQLiteCycleStoreSchema(checksum, descriptor),
        "GE_CYCLE_STORE_CORRUPTION",
      );
    } finally {
      checksum.close();
    }

    const catalog = new SQLiteConnection(databasePath("catalog.db"));
    try {
      ensureSQLiteCycleStoreSchema(catalog, descriptor, { appliedAtMs: APPLIED_AT_MS });
      catalog.execTrusted("DROP INDEX ge_cycle_holds_lookup_idx", "inspect-schema");
      expectProviderCode(
        () => ensureSQLiteCycleStoreSchema(catalog, descriptor),
        "GE_CYCLE_STORE_CORRUPTION",
      );
    } finally {
      catalog.close();
    }

    const foreign = new SQLiteConnection(databasePath("foreign.db"));
    try {
      foreign.execTrusted("CREATE TABLE unrelated (id INTEGER PRIMARY KEY) STRICT", "inspect-schema");
      expectProviderCode(
        () => ensureSQLiteCycleStoreSchema(foreign, descriptor),
        "GE_CYCLE_STORE_CORRUPTION",
      );
    } finally {
      foreign.close();
    }

    const future = new SQLiteConnection(databasePath("future.db"));
    try {
      future.execTrusted(
        `PRAGMA application_id = ${SQLITE_CYCLE_STORE_APPLICATION_ID};
         PRAGMA user_version = 2;`,
        "inspect-schema",
      );
      expectProviderCode(
        () => ensureSQLiteCycleStoreSchema(future, descriptor),
        "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
      );
    } finally {
      future.close();
    }
  });

  it("accepts Z and signed-offset checkpoint times and rejects malformed carriers", () => {
    const connection = new SQLiteConnection(databasePath("timestamps.db"));
    try {
      ensureSQLiteCycleStoreSchema(
        connection,
        createSQLiteCycleStoreDescriptor(),
        { appliedAtMs: APPLIED_AT_MS },
      );
      const insert = connection.prepare(
        `INSERT INTO ge_cycle_checkpoint_revisions (
           tenant_id, checkpoint_scope, revision, checkpoint_id, action,
           summary_blob, bound_sequence, bound_record_hash,
           checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
         ) VALUES ('tenant', 'scope', ?, ?, 'put', X'7b7d', 0, ?, ?, ?, 1, ?)`,
        "inspect-schema",
      );
      const hash = "a".repeat(64);
      for (const [index, timestamp] of [
        "2026-07-27T00:00:00Z",
        "2026-07-27T00:00:00+05:30",
        "2026-07-27T00:00:00-07:00",
      ].entries()) {
        expect(() => insert.run(
          index + 1,
          `checkpoint-${index}`,
          hash,
          timestamp,
          hash,
          APPLIED_AT_MS,
        )).not.toThrow();
      }
      for (const [index, timestamp] of [
        "2026-07-27T00:00:00",
        "2026-07-27T00:00:00+24:00",
        "2026-07-27T00:00:00+05:60",
        "2026-07-27 00:00:00Z",
        "2026-07-27T00:00:00.Z",
      ].entries()) {
        expect(() => insert.run(
          index + 100,
          `invalid-${index}`,
          hash,
          timestamp,
          hash,
          APPLIED_AT_MS,
        )).toThrow();
      }
    } finally {
      connection.close();
    }
  });
});
