import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const MODULE_ROOT = dirname(fileURLToPath(import.meta.url));
const HASH = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ZERO_HASH = "0".repeat(64);
const PROVIDER_DESCRIPTOR_FIXTURE_HASH = "d".repeat(64);
const APPLIED_AT_MS = 1_785_110_405_000;
const RECORD_DOMAIN = "graph-engineering/cycle-store-record/v1alpha1\0";
const FIXTURE_DOMAIN = "graph-engineering/sqlite-alpha-v0-fixture/v1\0";

function compareUnicodeCodePoints(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0));
  const rightPoints = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const difference = leftPoints[index] - rightPoints[index];
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareUnicodeCodePoints)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function domainHash(domain, value) {
  return sha256(Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from(canonicalJson(value), "utf8")]));
}

function plain(row) {
  return Object.fromEntries(Object.entries(row));
}

function scalar(db, sql, field) {
  const row = db.prepare(sql).get();
  assert.ok(row !== undefined, `query returned no row: ${sql}`);
  return row[field];
}

function assertSafeAssetPath(root, candidate) {
  assert.equal(typeof candidate, "string", "asset path must be a string");
  assert.equal(isAbsolute(candidate), false, `asset path must be relative: ${candidate}`);
  assert.equal(candidate.includes("\\"), false, `asset path must use '/': ${candidate}`);
  assert.equal(candidate.split("/").includes(".."), false, `asset path escapes root: ${candidate}`);
  const absolute = resolve(root, candidate);
  assert.ok(
    absolute.startsWith(`${resolve(root)}${sep}`),
    `asset path escapes migration root: ${candidate}`,
  );
  const stat = lstatSync(absolute);
  assert.equal(stat.isSymbolicLink(), false, `asset must not be a symbolic link: ${candidate}`);
  assert.equal(stat.isFile(), true, `asset must be a regular file: ${candidate}`);
  assert.equal(
    realpathSync(absolute).startsWith(`${realpathSync(root)}${sep}`),
    true,
    `asset resolves outside migration root: ${candidate}`,
  );
  return absolute;
}

function readDeterministicText(root, candidate) {
  const absolute = assertSafeAssetPath(root, candidate);
  const bytes = readFileSync(absolute);
  assert.ok(bytes.length > 0, `${candidate} must not be empty`);
  assert.equal(
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    false,
    `${candidate} must not contain a UTF-8 BOM`,
  );
  assert.equal(bytes.includes(0x0d), false, `${candidate} must use LF, not CRLF`);
  assert.equal(bytes.at(-1), 0x0a, `${candidate} must end with LF`);
  assert.notEqual(bytes.at(-2), 0x0a, `${candidate} must end with exactly one LF`);
  const text = bytes.toString("utf8");
  assert.equal(Buffer.from(text, "utf8").equals(bytes), true, `${candidate} is not valid UTF-8`);
  assert.equal(text.includes("\uFFFD"), false, `${candidate} contains replacement characters`);
  return { absolute, bytes, text, sha256: sha256(bytes) };
}

function parseJsonAsset(root, candidate) {
  const asset = readDeterministicText(root, candidate);
  return { ...asset, value: JSON.parse(asset.text) };
}

function stripSqlComments(sql) {
  return sql.replace(/^\s*--.*$/gmu, "");
}

function validateTrustedSql(name, sql) {
  const statements = stripSqlComments(sql);
  assert.doesNotMatch(statements, /\bATTACH\b/iu, `${name} must not ATTACH another database`);
  assert.doesNotMatch(statements, /\bDETACH\b/iu, `${name} must not DETACH another database`);
  assert.doesNotMatch(statements, /\bload_extension\s*\(/iu, `${name} must not load extensions`);
  assert.doesNotMatch(statements, /\bwritable_schema\b/iu, `${name} must not enable writable_schema`);
  assert.doesNotMatch(statements, /\bVACUUM\b/iu, `${name} must not VACUUM inside migration`);
  assert.doesNotMatch(statements, /\b(?:BEGIN|COMMIT|ROLLBACK)\b/iu, `${name} transaction belongs to adapter`);
  assert.doesNotMatch(statements, /\bIF\s+NOT\s+EXISTS\b/iu, `${name} must fail on unexpected existing schema`);
  assert.equal(statements.includes("${"), false, `${name} must not contain template interpolation`);
  assert.equal(statements.includes("{{"), false, `${name} must not contain template interpolation`);
  assert.equal(statements.includes("?"), false, `${name} migration bytes must not contain bind holes`);
  for (const match of statements.matchAll(/\bPRAGMA\s+([A-Za-z_]+)/giu)) {
    assert.ok(
      ["application_id", "user_version"].includes(match[1].toLowerCase()),
      `${name} contains a non-manifest PRAGMA: ${match[1]}`,
    );
  }
}

function openDatabase(path = ":memory:") {
  return new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
}

function pragmaRows(db, pragma) {
  return db.prepare(`PRAGMA ${pragma}`).all().map(plain);
}

function tableColumns(db, table) {
  assert.match(table, /^ge_cycle_[a-z_]+$/u);
  return db.prepare("SELECT cid, name, type, pk FROM pragma_table_info(?) ORDER BY cid")
    .all(table)
    .map(plain);
}

function explicitSchemaSignature(db) {
  return db.prepare(
    `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_schema
      WHERE name GLOB 'ge_cycle_*'
        AND type IN ('table', 'index')
        AND sql IS NOT NULL
      ORDER BY type, name`,
  ).all().map((row) => ({
    ...plain(row),
    sql: row.sql.replace(/\s+/gu, " ").trim(),
  }));
}

function assertLogicalSchema(db, identity) {
  assert.equal(scalar(db, "PRAGMA application_id", "application_id"), identity.applicationId);
  assert.equal(scalar(db, "PRAGMA user_version", "user_version"), identity.userVersion);

  const tableRows = db.prepare(
    `SELECT name, strict
       FROM pragma_table_list
      WHERE name GLOB 'ge_cycle_*'
      ORDER BY name`,
  ).all().map(plain);
  assert.deepEqual(
    tableRows.map(({ name }) => name),
    Object.keys(identity.requiredTables).sort(compareUnicodeCodePoints),
    "canonical table inventory drifted",
  );
  for (const table of tableRows) {
    assert.equal(table.strict, 1, `${table.name} must be STRICT`);
    const columns = tableColumns(db, table.name);
    assert.deepEqual(
      columns.map(({ name }) => name),
      identity.requiredTables[table.name],
      `${table.name} column order drifted`,
    );
  }

  const explicitIndexes = db.prepare(
    `SELECT name
       FROM sqlite_schema
      WHERE type = 'index'
        AND name GLOB 'ge_cycle_*'
        AND sql IS NOT NULL
      ORDER BY name`,
  ).all().map(({ name }) => name);
  assert.deepEqual(explicitIndexes, identity.requiredIndexes, "canonical index inventory drifted");

  for (const qualified of identity.canonicalBlobColumns) {
    const [table, column] = qualified.split(".");
    const info = tableColumns(db, table).find(({ name }) => name === column);
    assert.ok(info !== undefined, `${qualified} is missing`);
    assert.equal(info.type, "BLOB", `${qualified} must be a BLOB`);
  }

  const tenantTables = new Set(identity.tenantScopedTables);
  for (const table of identity.tenantScopedTables) {
    const primary = tableColumns(db, table)
      .filter(({ pk }) => pk > 0)
      .sort((left, right) => left.pk - right.pk);
    assert.equal(primary[0]?.name, "tenant_id", `${table} primary key must start with tenant_id`);

    const indexes = db.prepare("SELECT name, \"unique\" AS isUnique FROM pragma_index_list(?)")
      .all(table)
      .map(plain)
      .filter(({ isUnique }) => isUnique === 1);
    for (const index of indexes) {
      const indexedColumns = db.prepare("SELECT seqno, name FROM pragma_index_info(?) ORDER BY seqno")
        .all(index.name)
        .map(plain);
      assert.equal(
        indexedColumns[0]?.name,
        "tenant_id",
        `${table}.${index.name} unique scope must start with tenant_id`,
      );
    }

    const foreignKeys = db.prepare("SELECT id, seq, \"table\" AS target, \"from\" AS sourceColumn, \"to\" AS targetColumn FROM pragma_foreign_key_list(?) ORDER BY id, seq")
      .all(table)
      .map(plain);
    const grouped = Map.groupBy(foreignKeys, ({ id }) => id);
    for (const group of grouped.values()) {
      if (!tenantTables.has(group[0].target)) continue;
      assert.ok(
        group.some(({ sourceColumn, targetColumn }) => sourceColumn === "tenant_id" && targetColumn === "tenant_id"),
        `${table} foreign key to ${group[0].target} is not tenant-scoped`,
      );
    }
  }

  for (const table of identity.globalTables) {
    assert.equal(
      tableColumns(db, table).some(({ name }) => name === "tenant_id"),
      false,
      `${table} is global and must not masquerade as tenant state`,
    );
  }
}

function assertSqliteIntegrity(db) {
  assert.deepEqual(pragmaRows(db, "foreign_key_check"), [], "foreign-key audit failed");
  assert.deepEqual(pragmaRows(db, "integrity_check"), [{ integrity_check: "ok" }], "integrity audit failed");
}

function parseCanonicalBlob(bytes, label) {
  const buffer = Buffer.from(bytes);
  const text = buffer.toString("utf8");
  assert.equal(Buffer.from(text, "utf8").equals(buffer), true, `${label} is invalid UTF-8`);
  const value = JSON.parse(text);
  assert.equal(canonicalJson(value), text, `${label} is not canonical JSON`);
  return { buffer, text, value };
}

function validateCanonicalCarriers(db) {
  const records = db.prepare(
    `SELECT tenant_id, stream_id, sequence, record_id, previous_record_hash, value_hash,
            value_bytes, value_blob, record_hash, record_blob
       FROM ge_cycle_records
      ORDER BY tenant_id, stream_id, sequence`,
  ).all();
  for (const row of records) {
    const value = parseCanonicalBlob(row.value_blob, `${row.tenant_id}/${row.record_id}.value`);
    const record = parseCanonicalBlob(row.record_blob, `${row.tenant_id}/${row.record_id}.record`);
    assert.equal(value.buffer.length, row.value_bytes);
    assert.equal(sha256(value.buffer), row.value_hash);
    assert.deepEqual(record.value.value, value.value);
    assert.equal(record.value.recordId, row.record_id);
    assert.equal(record.value.sequence, row.sequence);
    assert.equal(record.value.previousRecordHash, row.previous_record_hash);
    assert.equal(record.value.valueHash, row.value_hash);
    assert.equal(record.value.valueBytes, row.value_bytes);
    assert.equal(record.value.recordHash, row.record_hash);
    const { recordHash, ...body } = record.value;
    assert.equal(domainHash(RECORD_DOMAIN, body), recordHash, `${row.record_id} record hash drifted`);
  }

  const checkpoints = db.prepare(
    `SELECT tenant_id, checkpoint_scope, checkpoint_id, value_hash, value_bytes,
            value_blob, checkpoint_blob, summary_blob
       FROM ge_cycle_checkpoints
      ORDER BY tenant_id, checkpoint_scope, checkpoint_id`,
  ).all();
  for (const row of checkpoints) {
    const value = parseCanonicalBlob(row.value_blob, `${row.tenant_id}/${row.checkpoint_id}.value`);
    const checkpoint = parseCanonicalBlob(row.checkpoint_blob, `${row.tenant_id}/${row.checkpoint_id}.checkpoint`);
    const summary = parseCanonicalBlob(row.summary_blob, `${row.tenant_id}/${row.checkpoint_id}.summary`);
    assert.equal(value.buffer.length, row.value_bytes);
    assert.equal(sha256(value.buffer), row.value_hash);
    assert.deepEqual(checkpoint.value.value, value.value);
    assert.equal(checkpoint.value.valueHash, row.value_hash);
    assert.equal(checkpoint.value.valueBytes, row.value_bytes);
    const { value: _removed, ...expectedSummary } = checkpoint.value;
    assert.deepEqual(summary.value, expectedSummary);
  }

  const operations = db.prepare(
    `SELECT tenant_id, operation_id, result_blob, result_hash
       FROM ge_cycle_operations
      ORDER BY tenant_id, operation_id`,
  ).all();
  for (const row of operations) {
    const result = parseCanonicalBlob(row.result_blob, `${row.tenant_id}/${row.operation_id}.result`);
    assert.equal(sha256(result.buffer), row.result_hash);
  }
}

function validateFixture(db, expected) {
  assert.equal(scalar(db, "PRAGMA application_id", "application_id"), expected.applicationId);
  for (const [table, count] of Object.entries(expected.counts)) {
    assert.match(table, /^ge_cycle_[a-z_]+$/u);
    assert.equal(scalar(db, `SELECT count(*) AS count FROM ${table}`, "count"), count, `${table} count drifted`);
  }

  const streams = db.prepare(
    `SELECT tenant_id AS tenantId, stream_id AS streamId, tail_sequence AS tailSequence,
            tail_record_hash AS tailRecordHash
       FROM ge_cycle_streams
      ORDER BY tenant_id, stream_id`,
  ).all().map(plain);
  assert.deepEqual(streams, expected.streams);

  const collision = db.prepare(
    `SELECT count(DISTINCT tenant_id) AS tenants
       FROM ge_cycle_records
      WHERE stream_id = ? AND record_id = ?`,
  ).get(expected.collidingPublicIds.streamId, expected.collidingPublicIds.recordId);
  assert.equal(collision.tenants, expected.collidingPublicIds.tenants.length);

  const checkpoint = plain(db.prepare(
    `SELECT tenant_id AS tenantId, checkpoint_scope AS checkpointScope,
            checkpoint_id AS checkpointId, bound_sequence AS boundSequence,
            value_hash AS valueHash, value_bytes AS valueBytes
       FROM ge_cycle_checkpoints`,
  ).get());
  assert.deepEqual(checkpoint, expected.checkpoint);

  const active = plain(db.prepare(
    `SELECT tenant_id AS tenantId, active_lease_id AS leaseId,
            last_lease_epoch AS lastLeaseEpoch, last_fencing_token AS lastFencingToken
       FROM ge_cycle_leases WHERE active_lease_id IS NOT NULL`,
  ).get());
  assert.deepEqual(active, expected.leaseHistory.active);
  const released = plain(db.prepare(
    `SELECT tenant_id AS tenantId, last_lease_epoch AS lastLeaseEpoch,
            last_fencing_token AS lastFencingToken
       FROM ge_cycle_leases WHERE active_lease_id IS NULL`,
  ).get());
  assert.deepEqual(released, expected.leaseHistory.released);

  const migrationFence = plain(db.prepare(
    `SELECT last_lock_epoch AS lastLockEpoch, last_fencing_token AS lastFencingToken
       FROM ge_cycle_migration_lock WHERE singleton = 1`,
  ).get());
  migrationFence.usedLockIds = db.prepare(
    "SELECT lock_id FROM ge_cycle_used_migration_lock_ids ORDER BY fencing_token",
  ).all().map(({ lock_id: lockId }) => lockId);
  assert.deepEqual(migrationFence, expected.migrationFence);

  const ledger = db.prepare(
    `SELECT tenant_id AS tenantId, operation_id AS operationId, result_hash AS resultHash
       FROM ge_cycle_operations
      ORDER BY tenant_id, operation_id`,
  ).all().map(plain);
  assert.deepEqual(ledger, expected.ledger);

  validateCanonicalCarriers(db);
  assertSqliteIntegrity(db);
}

function postconditionsBlob(migration) {
  return Buffer.from(canonicalJson({ requiredPostconditions: migration.requiredPostconditions }), "utf8");
}

function bindFreshMetadata(db, manifest) {
  const schema = manifest.schema;
  db.prepare(
    `INSERT INTO ge_cycle_schema (
       singleton, current_version, min_reader_version, max_reader_version,
       min_writer_version, max_writer_version, schema_identity_sha256,
       latest_migration_sha256, latest_migration_applied_at_ms,
       provider_descriptor_hash, created_at_ms, updated_at_ms
     ) VALUES (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)`,
  ).run(
    schema.schemaIdentitySha256,
    schema.sqlSha256,
    APPLIED_AT_MS,
    PROVIDER_DESCRIPTOR_FIXTURE_HASH,
    APPLIED_AT_MS,
    APPLIED_AT_MS,
  );
  db.prepare(
    `INSERT INTO ge_cycle_migrations (
       version, previous_version, migration_id, sql_sha256,
       schema_identity_sha256, applied_at_ms, reversibility, postconditions_blob
     ) VALUES (1, 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    schema.bootstrapId,
    schema.sqlSha256,
    schema.schemaIdentitySha256,
    APPLIED_AT_MS,
    schema.reversibility,
    postconditionsBlob(manifest.migrations[0]),
  );
  db.prepare(
    `INSERT INTO ge_cycle_migration_lock (
       singleton, active_lock_id, active_owner_id, active_source_version,
       active_target_version, active_lock_epoch, active_fencing_token,
       active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
       last_fencing_token, updated_at_ms
     ) VALUES (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)`,
  ).run(APPLIED_AT_MS);
}

function bindMigrationMetadata(db, manifest) {
  const migration = manifest.migrations[0];
  const update = db.prepare(
    `UPDATE ge_cycle_schema
        SET schema_identity_sha256 = ?,
            latest_migration_sha256 = ?,
            latest_migration_applied_at_ms = ?,
            updated_at_ms = ?
      WHERE singleton = 1
        AND schema_identity_sha256 = ?
        AND latest_migration_sha256 = ?`,
  ).run(
    migration.targetSchemaIdentitySha256,
    migration.sqlSha256,
    APPLIED_AT_MS,
    APPLIED_AT_MS,
    ZERO_HASH,
    ZERO_HASH,
  );
  assert.equal(update.changes, 1, "migration sentinels were not replaced exactly once");
  db.prepare(
    `INSERT INTO ge_cycle_migrations (
       version, previous_version, migration_id, sql_sha256,
       schema_identity_sha256, applied_at_ms, reversibility, postconditions_blob
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    migration.toVersion,
    migration.fromVersion,
    migration.id,
    migration.sqlSha256,
    migration.targetSchemaIdentitySha256,
    APPLIED_AT_MS,
    migration.reversibility,
    postconditionsBlob(migration),
  );
}

function validateBoundMetadata(db, manifest, lineage) {
  const row = plain(db.prepare(
    `SELECT current_version AS currentVersion,
            schema_identity_sha256 AS schemaIdentitySha256,
            latest_migration_sha256 AS latestMigrationSha256,
            provider_descriptor_hash AS providerDescriptorHash
       FROM ge_cycle_schema WHERE singleton = 1`,
  ).get());
  assert.deepEqual(row, {
    currentVersion: 1,
    schemaIdentitySha256: manifest.schema.schemaIdentitySha256,
    latestMigrationSha256: lineage.sha256,
    providerDescriptorHash: PROVIDER_DESCRIPTOR_FIXTURE_HASH,
  });
  assert.notEqual(row.schemaIdentitySha256, ZERO_HASH);
  assert.notEqual(row.latestMigrationSha256, ZERO_HASH);

  const ledger = plain(db.prepare(
    `SELECT version, previous_version AS previousVersion, migration_id AS migrationId,
            sql_sha256 AS sqlSha256, schema_identity_sha256 AS schemaIdentitySha256,
            reversibility
       FROM ge_cycle_migrations`,
  ).get());
  assert.deepEqual(ledger, {
    version: 1,
    previousVersion: 0,
    migrationId: lineage.id,
    sqlSha256: lineage.sha256,
    schemaIdentitySha256: manifest.schema.schemaIdentitySha256,
    reversibility: "rebuild-from-verified-backup-only",
  });
}

function createFreshDatabase(path, assets) {
  const db = openDatabase(path);
  try {
    db.exec("BEGIN EXCLUSIVE");
    db.exec(assets.schemaSql.text);
    bindFreshMetadata(db, assets.manifest);
    assertLogicalSchema(db, assets.identity);
    validateBoundMetadata(db, assets.manifest, {
      id: assets.manifest.schema.bootstrapId,
      sha256: assets.manifest.schema.sqlSha256,
    });
    assertSqliteIntegrity(db);
    db.exec("COMMIT");
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}

function migrateFixtureDatabase(path, assets) {
  const db = openDatabase(path);
  try {
    db.exec(assets.fixtureSql.text);
    assert.equal(scalar(db, "PRAGMA user_version", "user_version"), 0);
    validateFixture(db, assets.expected);
    db.exec("BEGIN EXCLUSIVE");
    db.exec(assets.migrationSql.text);
    bindMigrationMetadata(db, assets.manifest);
    assertLogicalSchema(db, assets.identity);
    validateBoundMetadata(db, assets.manifest, {
      id: assets.manifest.migrations[0].id,
      sha256: assets.manifest.migrations[0].sqlSha256,
    });
    validateFixture(db, assets.expected);
    assert.equal(scalar(db, "SELECT count(*) AS count FROM ge_cycle_cursors", "count"), 0);
    assert.equal(
      scalar(db, "SELECT count(*) AS count FROM ge_cycle_checkpoint_revisions", "count"),
      assets.expected.counts.ge_cycle_checkpoints,
    );
    assert.equal(
      scalar(db, "SELECT count(*) AS count FROM sqlite_schema WHERE name GLOB '*_v0'", "count"),
      0,
    );
    assertSqliteIntegrity(db);
    db.exec("COMMIT");
    return db;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
    throw error;
  }
}

function verifyRollback(path, assets) {
  const db = openDatabase(path);
  try {
    db.exec(assets.fixtureSql.text);
    const beforeSignature = explicitSchemaSignature(db);
    assert.throws(() => {
      db.exec("BEGIN EXCLUSIVE");
      db.exec(assets.migrationSql.text);
      db.exec("SELECT * FROM ge_deliberate_missing_table");
    });
    assert.equal(db.isTransaction, true, "failed migration must leave a transaction for explicit rollback");
    db.exec("ROLLBACK");
    assert.equal(scalar(db, "PRAGMA user_version", "user_version"), 0);
    assert.deepEqual(explicitSchemaSignature(db), beforeSignature, "failed migration changed schema");
    assert.equal(
      scalar(db, "SELECT count(*) AS count FROM sqlite_schema WHERE name = 'ge_cycle_migrations'", "count"),
      0,
    );
    validateFixture(db, assets.expected);
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-migrations-"));
}

function removeTempRoot(path) {
  const resolved = resolve(path);
  assert.equal(dirname(resolved), resolve(tmpdir()), "refusing to remove non-temporary path");
  assert.ok(
    resolved.split(sep).at(-1).startsWith("graph-engineering-sqlite-migrations-"),
    "refusing to remove unexpected temporary path",
  );
  rmSync(resolved, { recursive: true, force: true });
}

function loadAssets(root) {
  const manifestSchema = parseJsonAsset(root, "manifest.schema.json");
  const manifestAsset = parseJsonAsset(root, "manifest.json");
  const manifest = manifestAsset.value;

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  assert.equal(
    ajv.validateSchema(manifestSchema.value),
    true,
    `manifest schema is invalid: ${JSON.stringify(ajv.errors)}`,
  );
  const validateManifest = ajv.compile(manifestSchema.value);
  assert.equal(
    validateManifest(manifest),
    true,
    `migration manifest is invalid: ${JSON.stringify(validateManifest.errors)}`,
  );

  const schemaSql = readDeterministicText(root, manifest.schema.sqlPath);
  const identityAsset = parseJsonAsset(root, manifest.schema.identityPath);
  const migrationSql = readDeterministicText(root, manifest.migrations[0].sqlPath);
  const fixtureSql = readDeterministicText(root, manifest.fixtures[0].sqlPath);
  const expectedAsset = parseJsonAsset(root, manifest.fixtures[0].expectationPath);

  assert.equal(schemaSql.sha256, manifest.schema.sqlSha256, "fresh schema SHA-256 drifted");
  assert.equal(
    identityAsset.sha256,
    manifest.schema.identityDocumentSha256,
    "schema identity document SHA-256 drifted",
  );
  const schemaIdentity = domainHash(identityAsset.value.identityDomain, identityAsset.value);
  assert.equal(schemaIdentity, manifest.schema.schemaIdentitySha256, "schema identity drifted");
  assert.equal(
    manifest.migrations[0].targetSchemaIdentitySha256,
    schemaIdentity,
    "migration target identity drifted",
  );
  assert.equal(migrationSql.sha256, manifest.migrations[0].sqlSha256, "migration SHA-256 drifted");
  assert.equal(fixtureSql.sha256, manifest.fixtures[0].sqlSha256, "v0 fixture SHA-256 drifted");
  assert.equal(
    expectedAsset.sha256,
    manifest.fixtures[0].expectationSha256,
    "v0 expectation SHA-256 drifted",
  );
  const fixtureIdentity = sha256(Buffer.from(
    `${FIXTURE_DOMAIN}${fixtureSql.sha256}\0${expectedAsset.sha256}`,
    "utf8",
  ));
  assert.equal(fixtureIdentity, manifest.fixtures[0].fixtureIdentitySha256, "fixture identity drifted");

  validateTrustedSql(manifest.schema.sqlPath, schemaSql.text);
  validateTrustedSql(manifest.migrations[0].sqlPath, migrationSql.text);
  assert.equal(manifest.migrations[0].toVersion, manifest.migrations[0].fromVersion + 1);
  assert.equal(manifest.latestVersion, manifest.migrations.at(-1).toVersion);

  return {
    root,
    manifest,
    identity: identityAsset.value,
    expected: expectedAsset.value,
    schemaSql,
    migrationSql,
    fixtureSql,
    digests: {
      schemaSql: schemaSql.sha256,
      identityDocument: identityAsset.sha256,
      schemaIdentity,
      migrationSql: migrationSql.sha256,
      fixtureSql: fixtureSql.sha256,
      fixtureExpectation: expectedAsset.sha256,
      fixtureIdentity,
    },
  };
}

export function validateSqliteMigrationAssets({ root = MODULE_ROOT } = {}) {
  const assets = loadAssets(resolve(root));
  const temporaryRoot = makeTempRoot();
  try {
    const freshPath = join(temporaryRoot, "fresh-v1.sqlite");
    const migratedPath = join(temporaryRoot, "migrated-v1.sqlite");
    const rollbackPath = join(temporaryRoot, "rollback-v0.sqlite");

    const fresh = createFreshDatabase(freshPath, assets);
    const freshSignature = explicitSchemaSignature(fresh);
    fresh.close();

    const migrated = migrateFixtureDatabase(migratedPath, assets);
    assert.deepEqual(
      explicitSchemaSignature(migrated),
      freshSignature,
      "migrated logical DDL differs from fresh version 1",
    );
    migrated.close();

    const reopened = openDatabase(migratedPath);
    try {
      assert.equal(scalar(reopened, "PRAGMA user_version", "user_version"), 1);
      assertLogicalSchema(reopened, assets.identity);
      validateBoundMetadata(reopened, assets.manifest, {
        id: assets.manifest.migrations[0].id,
        sha256: assets.manifest.migrations[0].sqlSha256,
      });
      validateFixture(reopened, assets.expected);
      assertSqliteIntegrity(reopened);
    } finally {
      reopened.close();
    }

    verifyRollback(rollbackPath, assets);

    return Object.freeze({
      ok: true,
      applicationId: assets.manifest.applicationId,
      latestVersion: assets.manifest.latestVersion,
      tableCount: Object.keys(assets.identity.requiredTables).length,
      indexCount: assets.identity.requiredIndexes.length,
      migrationCount: assets.manifest.migrations.length,
      fixtureRecordCount: assets.expected.counts.ge_cycle_records,
      digests: Object.freeze({ ...assets.digests }),
    });
  } finally {
    removeTempRoot(temporaryRoot);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateSqliteMigrationAssets();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
