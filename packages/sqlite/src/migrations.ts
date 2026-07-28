import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { canonicalSerialize } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  type CycleStoreProviderDescriptor,
  type CycleStoreProviderErrorCode,
} from "@graph-engineering/runtime";

import { sqliteBlob, sqliteRow, sqliteSafeInteger, sqliteText } from "./sqlite-codec.js";
import type { SQLiteConnection } from "./sqlite-connection.js";
import {
  SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  createSQLiteCycleStoreDescriptor,
} from "./sqlite-profile.js";

export const SQLITE_CYCLE_STORE_APPLICATION_ID = 1_195_724_359;
export const SQLITE_CYCLE_STORE_SCHEMA_VERSION = 1;
export const SQLITE_MIGRATION_MANIFEST_SHA256 =
  "5f052a21215a39de101d56447fa4b25d20b6053bc558e3960562932e958d7af6" as const;
export const SQLITE_SCHEMA_SQL_SHA256 =
  "ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c" as const;
export const SQLITE_SCHEMA_IDENTITY_DOCUMENT_SHA256 =
  "4fcbe9872605011356e0655e2b9f9c3210e2bddbb131ddc87f08a93f0a1b9682" as const;
export const SQLITE_SCHEMA_IDENTITY_SHA256 =
  "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4" as const;
export const SQLITE_ALPHA_V0_TO_V1_SQL_SHA256 =
  "a8e9de4d1bae81f8405ef611fca1298bef024ad1df5e905d1d5a9357d1e8cb9c" as const;
export const SQLITE_SCHEMA_CATALOG_SHA256 =
  "8fab5049e2c9de5d114abc0c682934f1bc6fb5abd2e4c2e3ae55ef329c3e7264" as const;
export const SQLITE_ALPHA_V0_CATALOG_SHA256 =
  "7dc847b914f5738c02ce04b1a7864c8b1f7d66550cb9888ed0699cbc8a272177" as const;

const OPERATION = "inspect-schema" as const;
const ZERO_HASH = "0".repeat(64);
const HASH = /^[0-9a-f]{64}$/u;
const SCHEMA_IDENTITY_DOMAIN = "graph-engineering/sqlite-cycle-store-schema/v1\0";
const MAX_MANIFEST_BYTES = 65_536;
const MAX_IDENTITY_BYTES = 65_536;
const MAX_SQL_BYTES = 262_144;
const MIGRATION_ASSET_ROOT = new URL("../migrations/", import.meta.url);

const REQUIRED_POSTCONDITIONS = Object.freeze([
  "application-id-matches",
  "user-version-is-1",
  "schema-singleton-is-manifest-bound",
  "migration-ledger-row-is-manifest-bound",
  "all-canonical-tables-are-strict",
  "logical-schema-identity-matches-fresh-v1",
  "foreign-key-check-is-empty",
  "integrity-check-is-ok",
  "alpha-row-counts-are-preserved",
  "stream-heads-match-record-tails",
  "canonical-blobs-and-hashes-are-preserved",
  "checkpoint-revisions-are-seeded",
  "lease-and-migration-fences-are-monotonic",
  "no-v0-or-placeholder-state-remains",
] as const);

interface SQLiteSchemaAssetManifest {
  readonly version: 1;
  readonly bootstrapId: "fresh-v1-baseline";
  readonly sqlPath: "schema-v1.sql";
  readonly sqlSha256: string;
  readonly identityPath: "schema-v1.identity.json";
  readonly identityDocumentSha256: string;
  readonly schemaIdentitySha256: string;
  readonly reversibility: "rebuild-from-verified-backup-only";
}

interface SQLiteMigrationManifestEntry {
  readonly id: "alpha-v0-to-v1";
  readonly fromVersion: 0;
  readonly toVersion: 1;
  readonly sqlPath: "0001-alpha-v0-to-v1.sql";
  readonly sqlSha256: string;
  readonly targetSchemaIdentitySha256: string;
  readonly reversibility: "rebuild-from-verified-backup-only";
  readonly transactionMode: "caller-begin-exclusive";
  readonly finalization: "manifest-bound-prepared-statements-before-commit";
  readonly requiredPostconditions: readonly string[];
}

interface SQLiteMigrationManifest {
  readonly $schema: "./manifest.schema.json";
  readonly formatVersion: 1;
  readonly engine: "sqlite";
  readonly applicationId: number;
  readonly latestVersion: 1;
  readonly hashAlgorithm: "sha256";
  readonly byteEncoding: "utf-8-lf";
  readonly schema: SQLiteSchemaAssetManifest;
  readonly migrations: readonly [SQLiteMigrationManifestEntry];
  readonly fixtures: readonly unknown[];
  readonly requiredArtifactCopies: readonly string[];
  readonly sqlPolicy: Readonly<Record<string, unknown>>;
}

export interface SQLiteMigrationAssetText {
  readonly manifest: string;
  readonly schemaIdentity: string;
  readonly schemaSql: string;
  readonly alphaV0ToV1Sql: string;
}

export interface SQLiteMigrationAssets {
  readonly manifestSha256: string;
  readonly schemaSqlSha256: string;
  readonly schemaIdentityDocumentSha256: string;
  readonly schemaIdentitySha256: string;
  readonly alphaV0ToV1SqlSha256: string;
  readonly schemaSql: string;
  readonly alphaV0ToV1Sql: string;
}

export interface SQLiteSchemaEnsureOptions {
  /** Provider-authoritative milliseconds used only when bootstrap or migration commits. */
  readonly appliedAtMs?: number;
}

export interface SQLiteSchemaOpenResult {
  readonly disposition: "initialized" | "existing" | "migrated";
  readonly applicationId: typeof SQLITE_CYCLE_STORE_APPLICATION_ID;
  readonly schemaVersion: typeof SQLITE_CYCLE_STORE_SCHEMA_VERSION;
  readonly schemaIdentitySha256: typeof SQLITE_SCHEMA_IDENTITY_SHA256;
  readonly lineageId: "fresh-v1-baseline" | "alpha-v0-to-v1";
  readonly lineageSha256: string;
  readonly descriptorHash: typeof SQLITE_CYCLE_STORE_DESCRIPTOR_HASH;
}

interface SchemaEnvelope {
  readonly applicationId: number;
  readonly userVersion: number;
  readonly userObjectCount: number;
}

interface Lineage {
  readonly id: SQLiteSchemaOpenResult["lineageId"];
  readonly sha256: string;
}

function fail(
  code: CycleStoreProviderErrorCode,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new CycleStoreProviderError(code, OPERATION, message, details);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function checkedText(name: string, value: unknown, maximumBytes: number): string {
  if (typeof value !== "string") return fail("GE_CYCLE_STORE_CORRUPTION", `${name} is invalid`);
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length === 0 || bytes.length > maximumBytes
      || value.charCodeAt(0) === 0xfeff
      || value.includes("\r")
      || value.includes("\uFFFD")
      || !value.endsWith("\n")
      || value.endsWith("\n\n")) {
    return fail("GE_CYCLE_STORE_CORRUPTION", `${name} has invalid deterministic bytes`);
  }
  return value;
}

function parseManifest(text: string): SQLiteMigrationManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration manifest is invalid");
  }
  if (typeof value !== "object" || value === null) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration manifest is invalid");
  }
  return value as SQLiteMigrationManifest;
}

function assertManifest(manifest: SQLiteMigrationManifest): void {
  const schema = manifest.schema;
  const migration = manifest.migrations?.[0];
  if (manifest.$schema !== "./manifest.schema.json"
      || manifest.formatVersion !== 1
      || manifest.engine !== "sqlite"
      || manifest.applicationId !== SQLITE_CYCLE_STORE_APPLICATION_ID
      || manifest.latestVersion !== SQLITE_CYCLE_STORE_SCHEMA_VERSION
      || manifest.hashAlgorithm !== "sha256"
      || manifest.byteEncoding !== "utf-8-lf"
      || schema?.version !== 1
      || schema.bootstrapId !== "fresh-v1-baseline"
      || schema.sqlPath !== "schema-v1.sql"
      || schema.sqlSha256 !== SQLITE_SCHEMA_SQL_SHA256
      || schema.identityPath !== "schema-v1.identity.json"
      || schema.identityDocumentSha256 !== SQLITE_SCHEMA_IDENTITY_DOCUMENT_SHA256
      || schema.schemaIdentitySha256 !== SQLITE_SCHEMA_IDENTITY_SHA256
      || schema.reversibility !== "rebuild-from-verified-backup-only"
      || manifest.migrations.length !== 1
      || migration?.id !== "alpha-v0-to-v1"
      || migration.fromVersion !== 0
      || migration.toVersion !== 1
      || migration.sqlPath !== "0001-alpha-v0-to-v1.sql"
      || migration.sqlSha256 !== SQLITE_ALPHA_V0_TO_V1_SQL_SHA256
      || migration.targetSchemaIdentitySha256 !== SQLITE_SCHEMA_IDENTITY_SHA256
      || migration.reversibility !== "rebuild-from-verified-backup-only"
      || migration.transactionMode !== "caller-begin-exclusive"
      || migration.finalization !== "manifest-bound-prepared-statements-before-commit"
      || canonicalSerialize(migration.requiredPostconditions)
        !== canonicalSerialize(REQUIRED_POSTCONDITIONS)
      || canonicalSerialize(manifest.requiredArtifactCopies) !== canonicalSerialize([
        "npm:@graph-engineering/sqlite/migrations",
        "python:graph_engineering/_sqlite_migrations",
      ])) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration manifest identity drifted");
  }
}

function identityDocumentHash(text: string): string {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite schema identity document is invalid");
  }
  if (typeof value !== "object" || value === null
      || !("identityDomain" in value)
      || value.identityDomain !== SCHEMA_IDENTITY_DOMAIN) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite schema identity domain drifted");
  }
  try {
    return createHash("sha256")
      .update(SCHEMA_IDENTITY_DOMAIN, "utf8")
      .update(canonicalSerialize(value), "utf8")
      .digest("hex");
  } catch {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite schema identity document is invalid");
  }
}

/** Verifies an in-memory asset set without ever executing its SQL. */
export function verifySQLiteMigrationAssetText(
  source: SQLiteMigrationAssetText,
): SQLiteMigrationAssets {
  const manifestText = checkedText("SQLite migration manifest", source.manifest, MAX_MANIFEST_BYTES);
  if (sha256(manifestText) !== SQLITE_MIGRATION_MANIFEST_SHA256) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration manifest checksum drifted");
  }
  const manifest = parseManifest(manifestText);
  assertManifest(manifest);

  const schemaIdentity = checkedText(
    "SQLite schema identity document",
    source.schemaIdentity,
    MAX_IDENTITY_BYTES,
  );
  const schemaSql = checkedText("SQLite version 1 schema", source.schemaSql, MAX_SQL_BYTES);
  const migrationSql = checkedText(
    "SQLite alpha v0 to v1 migration",
    source.alphaV0ToV1Sql,
    MAX_SQL_BYTES,
  );
  if (sha256(schemaIdentity) !== manifest.schema.identityDocumentSha256
      || identityDocumentHash(schemaIdentity) !== manifest.schema.schemaIdentitySha256
      || sha256(schemaSql) !== manifest.schema.sqlSha256
      || sha256(migrationSql) !== manifest.migrations[0].sqlSha256) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration asset checksum drifted");
  }

  return Object.freeze({
    manifestSha256: SQLITE_MIGRATION_MANIFEST_SHA256,
    schemaSqlSha256: SQLITE_SCHEMA_SQL_SHA256,
    schemaIdentityDocumentSha256: SQLITE_SCHEMA_IDENTITY_DOCUMENT_SHA256,
    schemaIdentitySha256: SQLITE_SCHEMA_IDENTITY_SHA256,
    alphaV0ToV1SqlSha256: SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
    schemaSql,
    alphaV0ToV1Sql: migrationSql,
  });
}

function readPackagedAsset(name: string, maximumBytes: number): string {
  const url = new URL(name, MIGRATION_ASSET_ROOT);
  const path = fileURLToPath(url);
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return fail("GE_CYCLE_STORE_CORRUPTION", "required SQLite migration asset is missing", {
      asset: name,
    });
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximumBytes) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "required SQLite migration asset is invalid", {
      asset: name,
    });
  }
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fail("GE_CYCLE_STORE_CORRUPTION", "required SQLite migration asset is unavailable", {
      asset: name,
    });
  }
}

/** Loads only fixed package-relative, checksum-anchored migration assets. */
export function loadSQLiteMigrationAssets(): SQLiteMigrationAssets {
  return verifySQLiteMigrationAssetText({
    manifest: readPackagedAsset("manifest.json", MAX_MANIFEST_BYTES),
    schemaIdentity: readPackagedAsset("schema-v1.identity.json", MAX_IDENTITY_BYTES),
    schemaSql: readPackagedAsset("schema-v1.sql", MAX_SQL_BYTES),
    alphaV0ToV1Sql: readPackagedAsset("0001-alpha-v0-to-v1.sql", MAX_SQL_BYTES),
  });
}

function integerQuery(
  connection: SQLiteConnection,
  sql: string,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const row = sqliteRow(connection.prepare(sql, OPERATION).get(), 1, OPERATION, label);
  return sqliteSafeInteger(row[0], minimum, maximum, OPERATION, label);
}

function schemaEnvelope(connection: SQLiteConnection): SchemaEnvelope {
  return {
    applicationId: integerQuery(
      connection,
      "PRAGMA application_id",
      0,
      2_147_483_647,
      "application id",
    ),
    userVersion: integerQuery(
      connection,
      "PRAGMA user_version",
      0,
      2_147_483_647,
      "user version",
    ),
    userObjectCount: integerQuery(
      connection,
      `SELECT count(*)
         FROM sqlite_schema
        WHERE type IN ('table', 'view', 'trigger')
          AND name NOT LIKE 'sqlite_%'`,
      0,
      Number.MAX_SAFE_INTEGER,
      "user schema object count",
    ),
  };
}

function catalogHash(connection: SQLiteConnection): string {
  const rawRows = connection.prepare(
    `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
      WHERE name GLOB 'ge_cycle_*'
        AND type IN ('table', 'index')
        AND sql IS NOT NULL
      ORDER BY type, name`,
    OPERATION,
  ).all();
  const rows = rawRows.map((raw, index) => {
    const row = sqliteRow(raw, 4, OPERATION, `schema catalog row ${index}`);
    return {
      type: sqliteText(row[0], OPERATION, "schema catalog type"),
      name: sqliteText(row[1], OPERATION, "schema catalog name"),
      tableName: sqliteText(row[2], OPERATION, "schema catalog table"),
      sql: sqliteText(row[3], OPERATION, "schema catalog SQL").replace(/\s+/gu, " ").trim(),
    };
  });
  return sha256(canonicalSerialize(rows));
}

function assertPhysicalIntegrity(connection: SQLiteConnection): void {
  const foreignKeys = connection.prepare("PRAGMA foreign_key_check", OPERATION).all();
  if (foreignKeys.length !== 0) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite foreign-key audit failed");
  }
  const integrityRows = connection.prepare("PRAGMA integrity_check", OPERATION).all();
  if (integrityRows.length !== 1
      || sqliteText(
        sqliteRow(integrityRows[0], 1, OPERATION, "integrity result")[0],
        OPERATION,
        "integrity result",
      ) !== "ok") {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite structural integrity audit failed");
  }
}

function assertFreshEnvelope(connection: SQLiteConnection): void {
  const envelope = schemaEnvelope(connection);
  if (envelope.applicationId !== 0
      || envelope.userVersion !== 0
      || envelope.userObjectCount !== 0) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite database is not an empty bootstrap target");
  }
}

function assertV0(connection: SQLiteConnection, appliedAtMs?: number): void {
  const envelope = schemaEnvelope(connection);
  if (envelope.applicationId !== SQLITE_CYCLE_STORE_APPLICATION_ID || envelope.userVersion !== 0) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite alpha source identity drifted");
  }
  if (catalogHash(connection) !== SQLITE_ALPHA_V0_CATALOG_SHA256) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite alpha source schema drifted");
  }
  const schema = sqliteRow(
    connection.prepare(
      `SELECT current_version, min_reader_version, max_reader_version,
              min_writer_version, max_writer_version, provider_descriptor_hash,
              created_at_ms, updated_at_ms
         FROM ge_cycle_schema
        WHERE singleton = 1`,
      OPERATION,
    ).get(),
    8,
    OPERATION,
    "alpha schema singleton",
  );
  for (let index = 0; index < 5; index += 1) {
    if (sqliteSafeInteger(schema[index], 0, 0, OPERATION, "alpha schema version") !== 0) {
      fail("GE_CYCLE_STORE_UNSUPPORTED_VERSION", "SQLite alpha schema interval is unsupported");
    }
  }
  const priorDescriptorHash = sqliteText(schema[5], OPERATION, "alpha descriptor hash");
  if (!HASH.test(priorDescriptorHash)) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite alpha descriptor identity is invalid");
  }
  const createdAtMs = sqliteSafeInteger(
    schema[6],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "alpha created time",
  );
  const updatedAtMs = sqliteSafeInteger(
    schema[7],
    createdAtMs,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "alpha updated time",
  );
  if (appliedAtMs !== undefined && appliedAtMs < updatedAtMs) {
    fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "provider clock moved backwards during migration");
  }

  const lock = sqliteRow(
    connection.prepare(
      `SELECT active_lock_id, active_owner_id, active_source_version,
              active_target_version, active_lock_epoch, active_fencing_token,
              active_acquired_at_ms, active_expires_at_ms, updated_at_ms
         FROM ge_cycle_migration_lock
        WHERE singleton = 1`,
      OPERATION,
    ).get(),
    9,
    OPERATION,
    "alpha migration lock",
  );
  if (lock.slice(0, 8).some((value) => value !== null)) {
    fail("GE_CYCLE_STORE_MIGRATION_LOCKED", "SQLite alpha migration lock is active");
  }
  const lockUpdatedAtMs = sqliteSafeInteger(
    lock[8],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "alpha provider clock high-water",
  );
  if (appliedAtMs !== undefined && appliedAtMs < lockUpdatedAtMs) {
    fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "provider clock moved backwards during migration");
  }
  assertPhysicalIntegrity(connection);
}

function checkedAppliedAt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite schema application time is invalid");
  }
  return value as number;
}

function transactionAppliedAt(
  connection: SQLiteConnection,
  explicit: number | undefined,
): number {
  if (explicit !== undefined) return checkedAppliedAt(explicit);
  if (!connection.isTransaction) {
    return fail("GE_CYCLE_STORE_INTERNAL", "SQLite schema clock requires an active transaction");
  }
  // `unixepoch('subsec')` is newer than the declared SQLite 3.37 floor.
  // `%s` plus the millisecond digits from `%f` preserves that floor while
  // keeping the provider clock decision inside the exclusive transaction.
  return integerQuery(
    connection,
    `SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000
          + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)`,
    0,
    Number.MAX_SAFE_INTEGER,
    "provider transaction time",
  );
}

function changedRows(value: number | bigint, label: string): number {
  const changed = typeof value === "bigint" ? value : BigInt(value);
  if (changed !== 1n) return fail("GE_CYCLE_STORE_CORRUPTION", `${label} did not affect one row`);
  return 1;
}

function postconditionsBlob(): Buffer {
  return Buffer.from(canonicalSerialize({ requiredPostconditions: REQUIRED_POSTCONDITIONS }), "utf8");
}

function insertMigrationLineage(
  connection: SQLiteConnection,
  lineage: Lineage,
  appliedAtMs: number,
): void {
  changedRows(
    connection.prepare(
      `INSERT INTO ge_cycle_migrations (
         version, previous_version, migration_id, sql_sha256,
         schema_identity_sha256, applied_at_ms, reversibility, postconditions_blob
       ) VALUES (1, 0, ?, ?, ?, ?, 'rebuild-from-verified-backup-only', ?)`,
      OPERATION,
    ).run(
      lineage.id,
      lineage.sha256,
      SQLITE_SCHEMA_IDENTITY_SHA256,
      appliedAtMs,
      postconditionsBlob(),
    ).changes,
    "migration lineage insert",
  );
}

function finalizeFresh(
  connection: SQLiteConnection,
  descriptor: CycleStoreProviderDescriptor,
  appliedAtMs: number,
): Lineage {
  const lineage = { id: "fresh-v1-baseline", sha256: SQLITE_SCHEMA_SQL_SHA256 } as const;
  changedRows(
    connection.prepare(
      `INSERT INTO ge_cycle_schema (
         singleton, current_version, min_reader_version, max_reader_version,
         min_writer_version, max_writer_version, schema_identity_sha256,
         latest_migration_sha256, latest_migration_applied_at_ms,
         provider_descriptor_hash, created_at_ms, updated_at_ms
       ) VALUES (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)`,
      OPERATION,
    ).run(
      SQLITE_SCHEMA_IDENTITY_SHA256,
      lineage.sha256,
      appliedAtMs,
      descriptor.descriptorHash,
      appliedAtMs,
      appliedAtMs,
    ).changes,
    "schema singleton insert",
  );
  insertMigrationLineage(connection, lineage, appliedAtMs);
  changedRows(
    connection.prepare(
      `INSERT INTO ge_cycle_migration_lock (
         singleton, active_lock_id, active_owner_id, active_source_version,
         active_target_version, active_lock_epoch, active_fencing_token,
         active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
         last_fencing_token, updated_at_ms
       ) VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)`,
      OPERATION,
    ).run(appliedAtMs).changes,
    "migration lock singleton insert",
  );
  return lineage;
}

function finalizeMigration(
  connection: SQLiteConnection,
  descriptor: CycleStoreProviderDescriptor,
  appliedAtMs: number,
): Lineage {
  const lineage = { id: "alpha-v0-to-v1", sha256: SQLITE_ALPHA_V0_TO_V1_SQL_SHA256 } as const;
  changedRows(
    connection.prepare(
      `UPDATE ge_cycle_schema
          SET schema_identity_sha256 = ?,
              latest_migration_sha256 = ?,
              latest_migration_applied_at_ms = ?,
              provider_descriptor_hash = ?,
              updated_at_ms = ?
        WHERE singleton = 1
          AND current_version = 1
          AND schema_identity_sha256 = ?
          AND latest_migration_sha256 = ?`,
      OPERATION,
    ).run(
      SQLITE_SCHEMA_IDENTITY_SHA256,
      lineage.sha256,
      appliedAtMs,
      descriptor.descriptorHash,
      appliedAtMs,
      ZERO_HASH,
      ZERO_HASH,
    ).changes,
    "migrated schema finalization",
  );
  changedRows(
    connection.prepare(
      `UPDATE ge_cycle_migration_lock SET updated_at_ms = ?
        WHERE singleton = 1 AND updated_at_ms <= ?`,
      OPERATION,
    ).run(appliedAtMs, appliedAtMs).changes,
    "migrated provider clock finalization",
  );
  insertMigrationLineage(connection, lineage, appliedAtMs);
  return lineage;
}

function validateDescriptor(value: CycleStoreProviderDescriptor): void {
  let exact = false;
  try {
    exact = canonicalSerialize(value) === canonicalSerialize(createSQLiteCycleStoreDescriptor());
  } catch {
    exact = false;
  }
  if (!exact || value.descriptorHash !== SQLITE_CYCLE_STORE_DESCRIPTOR_HASH) {
    fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite provider descriptor is invalid");
  }
}

function validateV1(
  connection: SQLiteConnection,
  descriptor: CycleStoreProviderDescriptor,
): Lineage {
  const envelope = schemaEnvelope(connection);
  if (envelope.applicationId !== SQLITE_CYCLE_STORE_APPLICATION_ID
      || envelope.userVersion !== SQLITE_CYCLE_STORE_SCHEMA_VERSION) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite version 1 envelope drifted");
  }
  if (catalogHash(connection) !== SQLITE_SCHEMA_CATALOG_SHA256) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite version 1 schema catalog drifted");
  }
  const schema = sqliteRow(
    connection.prepare(
      `SELECT current_version, min_reader_version, max_reader_version,
              min_writer_version, max_writer_version, schema_identity_sha256,
              latest_migration_sha256, latest_migration_applied_at_ms,
              provider_descriptor_hash, created_at_ms, updated_at_ms
         FROM ge_cycle_schema
        WHERE singleton = 1`,
      OPERATION,
    ).get(),
    11,
    OPERATION,
    "schema singleton",
  );
  for (let index = 0; index < 5; index += 1) {
    sqliteSafeInteger(schema[index], 1, 1, OPERATION, "schema compatibility version");
  }
  const identity = sqliteText(schema[5], OPERATION, "schema identity");
  const latestMigrationHash = sqliteText(schema[6], OPERATION, "latest migration hash");
  const appliedAtMs = sqliteSafeInteger(
    schema[7],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "latest migration time",
  );
  const descriptorHash = sqliteText(schema[8], OPERATION, "provider descriptor hash");
  const createdAtMs = sqliteSafeInteger(
    schema[9],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "schema creation time",
  );
  const updatedAtMs = sqliteSafeInteger(
    schema[10],
    createdAtMs,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "schema update time",
  );
  if (identity !== SQLITE_SCHEMA_IDENTITY_SHA256
      || identity === ZERO_HASH
      || latestMigrationHash === ZERO_HASH
      || descriptorHash !== descriptor.descriptorHash
      || appliedAtMs !== updatedAtMs) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite schema singleton identity drifted");
  }
  if (integerQuery(
    connection,
    "SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1",
    0,
    Number.MAX_SAFE_INTEGER,
    "provider clock high-water",
  ) < updatedAtMs) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite provider clock high-water drifted");
  }

  if (integerQuery(
    connection,
    "SELECT count(*) FROM ge_cycle_migrations",
    0,
    Number.MAX_SAFE_INTEGER,
    "migration lineage count",
  ) !== 1) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration lineage is incomplete");
  }
  const migration = sqliteRow(
    connection.prepare(
      `SELECT version, previous_version, migration_id, sql_sha256,
              schema_identity_sha256, applied_at_ms, reversibility,
              postconditions_blob
         FROM ge_cycle_migrations`,
      OPERATION,
    ).get(),
    8,
    OPERATION,
    "migration lineage",
  );
  sqliteSafeInteger(migration[0], 1, 1, OPERATION, "migration version");
  sqliteSafeInteger(migration[1], 0, 0, OPERATION, "migration previous version");
  const migrationId = sqliteText(migration[2], OPERATION, "migration id");
  const migrationHash = sqliteText(migration[3], OPERATION, "migration SQL hash");
  const migrationIdentity = sqliteText(migration[4], OPERATION, "migration schema identity");
  const migrationAppliedAt = sqliteSafeInteger(
    migration[5],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "migration application time",
  );
  const reversibility = sqliteText(migration[6], OPERATION, "migration reversibility");
  const recordedPostconditions = sqliteBlob(migration[7], OPERATION, "migration postconditions");
  const isFresh = migrationId === "fresh-v1-baseline" && migrationHash === SQLITE_SCHEMA_SQL_SHA256;
  const isMigrated = migrationId === "alpha-v0-to-v1"
    && migrationHash === SQLITE_ALPHA_V0_TO_V1_SQL_SHA256;
  if ((!isFresh && !isMigrated)
      || latestMigrationHash !== migrationHash
      || migrationIdentity !== SQLITE_SCHEMA_IDENTITY_SHA256
      || migrationAppliedAt !== appliedAtMs
      || reversibility !== "rebuild-from-verified-backup-only"
      || !recordedPostconditions.equals(postconditionsBlob())) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration checksum identity drifted");
  }
  if (integerQuery(
    connection,
    "SELECT count(*) FROM ge_cycle_migration_lock WHERE singleton = 1",
    0,
    1,
    "migration lock singleton count",
  ) !== 1
      || integerQuery(
        connection,
        "SELECT count(*) FROM sqlite_schema WHERE name GLOB '*_v0'",
        0,
        Number.MAX_SAFE_INTEGER,
        "legacy table count",
      ) !== 0) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration postconditions are incomplete");
  }
  assertPhysicalIntegrity(connection);
  return isFresh
    ? { id: "fresh-v1-baseline", sha256: migrationHash }
    : { id: "alpha-v0-to-v1", sha256: migrationHash };
}

function exclusive<T>(connection: SQLiteConnection, action: () => T): T {
  if (connection.isTransaction) {
    return fail("GE_CYCLE_STORE_INTERNAL", "nested SQLite schema transaction is forbidden");
  }
  connection.execTrusted("BEGIN EXCLUSIVE", OPERATION);
  try {
    const result = action();
    connection.execTrusted("COMMIT", OPERATION);
    return result;
  } catch (error) {
    if (connection.isTransaction) {
      try {
        connection.execTrusted("ROLLBACK", OPERATION);
      } catch {
        // Preserve the original safe error. The next open repeats all identity checks.
      }
    }
    throw error;
  }
}

function result(
  disposition: SQLiteSchemaOpenResult["disposition"],
  lineage: Lineage,
  descriptor: CycleStoreProviderDescriptor,
): SQLiteSchemaOpenResult {
  return Object.freeze({
    disposition,
    applicationId: SQLITE_CYCLE_STORE_APPLICATION_ID,
    schemaVersion: SQLITE_CYCLE_STORE_SCHEMA_VERSION,
    schemaIdentitySha256: SQLITE_SCHEMA_IDENTITY_SHA256,
    lineageId: lineage.id,
    lineageSha256: lineage.sha256,
    descriptorHash: descriptor.descriptorHash as typeof SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
  });
}

/**
 * Opens, bootstraps, or upgrades the one supported local SQLite schema.
 *
 * Every mutation is an explicit exclusive transaction. Existing version 1
 * files are read-only validated; unknown/future or checksum-drifted files fail
 * before the provider serves any online operation.
 */
export function ensureSQLiteCycleStoreSchema(
  connection: SQLiteConnection,
  descriptor: CycleStoreProviderDescriptor,
  options: SQLiteSchemaEnsureOptions = {},
): SQLiteSchemaOpenResult {
  const assets = loadSQLiteMigrationAssets();
  validateDescriptor(descriptor);
  const envelope = schemaEnvelope(connection);

  if (envelope.applicationId === 0 && envelope.userVersion === 0) {
    if (envelope.userObjectCount !== 0) {
      return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite bootstrap target contains another schema");
    }
    const lineage = exclusive(connection, () => {
      assertFreshEnvelope(connection);
      const appliedAtMs = transactionAppliedAt(connection, options.appliedAtMs);
      connection.execTrusted(assets.schemaSql, OPERATION);
      const created = finalizeFresh(connection, descriptor, appliedAtMs);
      const validated = validateV1(connection, descriptor);
      if (validated.id !== created.id || validated.sha256 !== created.sha256) {
        fail("GE_CYCLE_STORE_CORRUPTION", "fresh SQLite lineage finalization drifted");
      }
      return created;
    });
    return result("initialized", lineage, descriptor);
  }

  if (envelope.applicationId !== SQLITE_CYCLE_STORE_APPLICATION_ID) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite application identity does not belong to Graph Engineering");
  }
  if (envelope.userVersion > SQLITE_CYCLE_STORE_SCHEMA_VERSION) {
    return fail("GE_CYCLE_STORE_UNSUPPORTED_VERSION", "SQLite schema version is newer than this adapter", {
      schemaVersion: envelope.userVersion,
    });
  }
  if (envelope.userVersion === SQLITE_CYCLE_STORE_SCHEMA_VERSION) {
    return result("existing", validateV1(connection, descriptor), descriptor);
  }
  if (envelope.userVersion !== 0) {
    return fail("GE_CYCLE_STORE_UNSUPPORTED_VERSION", "SQLite schema migration path is unavailable", {
      schemaVersion: envelope.userVersion,
    });
  }

  assertV0(connection);
  const lineage = exclusive(connection, () => {
    const appliedAtMs = transactionAppliedAt(connection, options.appliedAtMs);
    assertV0(connection, appliedAtMs);
    connection.execTrusted(assets.alphaV0ToV1Sql, OPERATION);
    const migrated = finalizeMigration(connection, descriptor, appliedAtMs);
    const validated = validateV1(connection, descriptor);
    if (validated.id !== migrated.id || validated.sha256 !== migrated.sha256) {
      fail("GE_CYCLE_STORE_CORRUPTION", "migrated SQLite lineage finalization drifted");
    }
    return migrated;
  });
  return result("migrated", lineage, descriptor);
}
