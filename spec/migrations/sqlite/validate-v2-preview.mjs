import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OLD_ASSETS = Object.freeze({
  "schema-v1.sql": "ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c",
  "0001-alpha-v0-to-v1.sql": "a8e9de4d1bae81f8405ef611fca1298bef024ad1df5e905d1d5a9357d1e8cb9c",
  "schema-v1.identity.json": "4fcbe9872605011356e0655e2b9f9c3210e2bddbb131ddc87f08a93f0a1b9682",
});
const FIXTURE_DOMAINS = Object.freeze({
  "alpha-v0-representative": "graph-engineering/sqlite-alpha-v0-fixture/v1\0",
  "pre-replay-v1-empty": "graph-engineering/sqlite-pre-replay-v1-fixture/v1\0",
});
const FORBIDDEN_SQL = Object.freeze([
  /\bATTACH\b/iu,
  /\bDETACH\b/iu,
  /\bload_extension\s*\(/iu,
  /\bwritable_schema\b/iu,
  /\bVACUUM\b/iu,
  /\b(?:BEGIN|COMMIT|ROLLBACK)\b/iu,
  /\bIF\s+NOT\s+EXISTS\b/iu,
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compareCodePoints(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort(compareCodePoints).map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function readBytes(root, path) {
  const bytes = readFileSync(join(root, path));
  assert.ok(bytes.length > 0, `${path} is empty`);
  assert.equal(bytes.includes(0x0d), false, `${path} is not LF-only`);
  assert.equal(bytes.at(-1), 0x0a, `${path} lacks final LF`);
  assert.notEqual(bytes.at(-2), 0x0a, `${path} has more than one final LF`);
  assert.equal(Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes), true, `${path} UTF-8`);
  return bytes;
}

function json(root, path) {
  return JSON.parse(readBytes(root, path).toString("utf8"));
}

function stripComments(sql) {
  return sql.replace(/^\s*--.*$/gmu, "");
}

function assertTrustedSql(path, bytes) {
  const sql = stripComments(bytes.toString("utf8"));
  for (const pattern of FORBIDDEN_SQL) assert.doesNotMatch(sql, pattern, path);
  assert.equal(sql.includes("${"), false, `${path} contains interpolation`);
  assert.equal(sql.includes("{{"), false, `${path} contains interpolation`);
  assert.equal(sql.includes("?"), false, `${path} contains a bind hole`);
  for (const match of sql.matchAll(/\bPRAGMA\s+([A-Za-z_]+)/giu)) {
    assert.ok(
      ["application_id", "defer_foreign_keys", "user_version"].includes(match[1].toLowerCase()),
      `${path} contains unapproved PRAGMA ${match[1]}`,
    );
  }
}

function signature(db) {
  return db.prepare(
    `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_schema
      WHERE name GLOB 'ge_cycle_*'
        AND type IN ('table', 'index')
        AND sql IS NOT NULL
      ORDER BY type, name`,
  ).all().map((row) => ({
    ...row,
    sql: row.sql.replace(/\s+/gu, " ").trim(),
  }));
}

function columns(db, table) {
  assert.match(table, /^ge_cycle_[a-z_]+$/u);
  return db.prepare("SELECT name, type FROM pragma_table_info(?) ORDER BY cid").all(table);
}

function assertLogicalSchema(db, identity) {
  assert.equal(db.prepare("PRAGMA application_id").get().application_id, identity.applicationId);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, identity.userVersion);
  const tables = db.prepare(
    "SELECT name, strict FROM pragma_table_list WHERE name GLOB 'ge_cycle_*' ORDER BY name",
  ).all();
  assert.deepEqual(
    tables.map(({ name }) => name),
    Object.keys(identity.requiredTables).sort(compareCodePoints),
  );
  for (const table of tables) {
    assert.equal(table.strict, 1, `${table.name} is not STRICT`);
    assert.deepEqual(
      columns(db, table.name).map(({ name }) => name),
      identity.requiredTables[table.name],
      `${table.name} columns`,
    );
  }
  assert.deepEqual(
    db.prepare(
      `SELECT name FROM sqlite_schema
        WHERE type='index' AND name GLOB 'ge_cycle_*' AND sql IS NOT NULL
        ORDER BY name`,
    ).all().map(({ name }) => name),
    identity.requiredIndexes,
  );
  for (const carrier of identity.canonicalBlobColumns) {
    const [table, column] = carrier.split(".");
    assert.equal(columns(db, table).find(({ name }) => name === column)?.type, "BLOB", carrier);
  }
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all().map((row) => ({ ...row })), []);
  assert.deepEqual(
    db.prepare("PRAGMA integrity_check").all().map((row) => ({ ...row })),
    [{ integrity_check: "ok" }],
  );
}

function assertFixture(db, expected) {
  assert.equal(db.prepare("PRAGMA application_id").get().application_id, expected.applicationId);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, expected.userVersion);
  for (const [table, count] of Object.entries(expected.counts)) {
    assert.match(table, /^ge_cycle_[a-z_]+$/u);
    assert.equal(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count, count, table);
  }
}

function open() {
  return new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
}

function assertMigrationCatalog(root, schemaV2, migrationV2, fixturePath, expected, expectedVersion) {
  const fresh = open();
  const migrated = open();
  try {
    fresh.exec(schemaV2.toString("utf8"));
    migrated.exec(readBytes(root, fixturePath).toString("utf8"));
    assertFixture(migrated, expected);
    assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, expectedVersion);
    migrated.exec("BEGIN EXCLUSIVE");
    migrated.exec(migrationV2.toString("utf8"));
    assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, 2);
    assert.deepEqual(signature(migrated), signature(fresh), `${fixturePath} catalog differs`);
    assert.equal(
      migrated.prepare("SELECT count(*) AS count FROM ge_cycle_operations WHERE ledger_format_version <> 1 OR request_blob IS NOT NULL OR commit_sequence IS NOT NULL").get().count,
      0,
      `${fixturePath} legacy conversion`,
    );
    migrated.exec("ROLLBACK");
    assert.equal(migrated.prepare("PRAGMA user_version").get().user_version, expectedVersion);
    assertFixture(migrated, expected);
  } finally {
    fresh.close();
    migrated.close();
  }
}

export function validateSqliteV2Preview({ root = ROOT } = {}) {
  const absoluteRoot = resolve(root);
  for (const [path, expected] of Object.entries(OLD_ASSETS)) {
    assert.equal(sha256(readBytes(absoluteRoot, path)), expected, `${path} predecessor changed`);
  }

  const manifest = json(absoluteRoot, "manifest-v2.preview.json");
  const manifestSchema = json(absoluteRoot, "manifest-v2.preview.schema.json");
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  assert.equal(ajv.validateSchema(manifestSchema), true, JSON.stringify(ajv.errors));
  const validate = ajv.compile(manifestSchema);
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));

  const schemaV2 = readBytes(absoluteRoot, manifest.schema.sqlPath);
  const identityBytes = readBytes(absoluteRoot, manifest.schema.identityPath);
  const identity = JSON.parse(identityBytes.toString("utf8"));
  const migrationV2 = readBytes(absoluteRoot, manifest.migrations[1].sqlPath);
  assert.equal(sha256(schemaV2), manifest.schema.sqlSha256);
  assert.equal(sha256(identityBytes), manifest.schema.identityDocumentSha256);
  assert.equal(
    sha256(Buffer.concat([
      Buffer.from(identity.identityDomain, "utf8"),
      Buffer.from(canonicalJson(identity), "utf8"),
    ])),
    manifest.schema.schemaIdentitySha256,
  );
  for (const migration of manifest.migrations) {
    const bytes = readBytes(absoluteRoot, migration.sqlPath);
    assert.equal(sha256(bytes), migration.sqlSha256, migration.id);
    assert.equal(migration.toVersion, migration.fromVersion + 1, migration.id);
    assertTrustedSql(migration.sqlPath, bytes);
  }
  assertTrustedSql(manifest.schema.sqlPath, schemaV2);

  for (const fixture of manifest.fixtures) {
    const sql = readBytes(absoluteRoot, fixture.sqlPath);
    const expectation = readBytes(absoluteRoot, fixture.expectationPath);
    assert.equal(sha256(sql), fixture.sqlSha256, fixture.id);
    assert.equal(sha256(expectation), fixture.expectationSha256, fixture.id);
    const domain = FIXTURE_DOMAINS[fixture.id];
    assert.equal(typeof domain, "string", `${fixture.id} fixture domain`);
    assert.equal(
      sha256(Buffer.from(`${domain}${fixture.sqlSha256}\0${fixture.expectationSha256}`, "utf8")),
      fixture.fixtureIdentitySha256,
      fixture.id,
    );
  }

  const fresh = open();
  try {
    fresh.exec(schemaV2.toString("utf8"));
    assertLogicalSchema(fresh, identity);
  } finally {
    fresh.close();
  }

  const v1Fixture = manifest.fixtures[1];
  assertMigrationCatalog(
    absoluteRoot,
    schemaV2,
    migrationV2,
    v1Fixture.sqlPath,
    json(absoluteRoot, v1Fixture.expectationPath),
    1,
  );

  const v0 = open();
  const freshForV0 = open();
  try {
    freshForV0.exec(schemaV2.toString("utf8"));
    v0.exec(readBytes(absoluteRoot, manifest.fixtures[0].sqlPath).toString("utf8"));
    v0.exec("BEGIN EXCLUSIVE");
    v0.exec(readBytes(absoluteRoot, manifest.migrations[0].sqlPath).toString("utf8"));
    v0.exec(migrationV2.toString("utf8"));
    assert.deepEqual(signature(v0), signature(freshForV0), "v0-to-v1-to-v2 catalog differs");
    assert.equal(v0.prepare("SELECT count(*) AS count FROM ge_cycle_operations WHERE ledger_format_version=1 AND request_blob IS NULL AND commit_sequence IS NULL").get().count, 2);
    v0.exec("ROLLBACK");
    assert.equal(v0.prepare("PRAGMA user_version").get().user_version, 0);
  } finally {
    freshForV0.close();
    v0.close();
  }

  return Object.freeze({
    ok: true,
    latestVersion: manifest.latestVersion,
    tableCount: Object.keys(identity.requiredTables).length,
    indexCount: identity.requiredIndexes.length,
    migrationCount: manifest.migrations.length,
    fixtureCount: manifest.fixtures.length,
    digests: Object.freeze({
      schemaSql: sha256(schemaV2),
      identityDocument: sha256(identityBytes),
      schemaIdentity: manifest.schema.schemaIdentitySha256,
      migrationV1ToV2: sha256(migrationV2),
      previewManifest: sha256(readBytes(absoluteRoot, "manifest-v2.preview.json")),
    }),
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(validateSqliteV2Preview(), null, 2)}\n`);
}
