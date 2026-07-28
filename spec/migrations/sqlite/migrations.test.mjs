import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateSqliteMigrationAssets } from "./validate.mjs";

const root = dirname(fileURLToPath(import.meta.url));

function temporaryCopy() {
  const directory = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-manifest-test-"));
  const copy = join(directory, "assets");
  cpSync(root, copy, { recursive: true });
  return { directory, copy };
}

function cleanup(directory) {
  const resolved = resolve(directory);
  assert.equal(dirname(resolved), resolve(tmpdir()));
  assert.ok(basename(resolved).startsWith("graph-engineering-sqlite-manifest-test-"));
  rmSync(resolved, { recursive: true, force: true });
}

test("canonical SQLite migration assets pass fresh, migration, reopen, and rollback validation", () => {
  const result = validateSqliteMigrationAssets();
  assert.deepEqual(result, {
    ok: true,
    applicationId: 1195724359,
    latestVersion: 1,
    tableCount: 13,
    indexCount: 14,
    migrationCount: 1,
    fixtureRecordCount: 3,
    digests: {
      schemaSql: "ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c",
      identityDocument: "4fcbe9872605011356e0655e2b9f9c3210e2bddbb131ddc87f08a93f0a1b9682",
      schemaIdentity: "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
      migrationSql: "a8e9de4d1bae81f8405ef611fca1298bef024ad1df5e905d1d5a9357d1e8cb9c",
      fixtureSql: "a57f063f52554aeb564dfbd90dc184146ce48160acd138e69ad02f76f9074eb6",
      fixtureExpectation: "e40ab4c5b4459704160a66a119306488722c889bbccce7355b46c2201158b5c2",
      fixtureIdentity: "fe0f2bb74eab8ccfabd3a856dbe6c6dbcae40695a48d76eaf585e8e0c0ea9941",
    },
  });
});

test("one changed migration byte fails before database execution", () => {
  const { directory, copy } = temporaryCopy();
  try {
    const migrationPath = join(copy, "0001-alpha-v0-to-v1.sql");
    writeFileSync(migrationPath, `${readFileSync(migrationPath, "utf8")}-- hostile drift\n`);
    assert.throws(
      () => validateSqliteMigrationAssets({ root: copy }),
      /migration SHA-256 drifted/u,
    );
  } finally {
    cleanup(directory);
  }
});

test("unknown manifest fields fail the closed manifest schema", () => {
  const { directory, copy } = temporaryCopy();
  try {
    const manifestPath = join(copy, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.unexpected = true;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => validateSqliteMigrationAssets({ root: copy }),
      /migration manifest is invalid/u,
    );
  } finally {
    cleanup(directory);
  }
});

test("manifest asset traversal fails before filesystem access", () => {
  const { directory, copy } = temporaryCopy();
  try {
    const manifestPath = join(copy, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.migrations[0].sqlPath = "../outside.sql";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    assert.throws(
      () => validateSqliteMigrationAssets({ root: copy }),
      /migration manifest is invalid/u,
    );
  } finally {
    cleanup(directory);
  }
});

test("checkpoint revision timestamps preserve Z and signed RFC3339 offsets", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(readFileSync(join(root, "schema-v1.sql"), "utf8"));
    const insert = database.prepare(`
      INSERT INTO ge_cycle_checkpoint_revisions (
        tenant_id, checkpoint_scope, revision, checkpoint_id, action,
        summary_blob, bound_sequence, bound_record_hash,
        checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
      ) VALUES ('tenant', 'scope', ?, ?, 'put', X'7b7d', 0, ?, ?, ?, 1, 0)
    `);
    const hash = "a".repeat(64);
    for (const [index, timestamp] of [
      "2026-07-27T00:00:00Z",
      "2026-07-27T00:00:00+05:30",
      "2026-07-27T00:00:00-07:00",
      "2026-07-27T00:00:00.123456789+05:30",
    ].entries()) {
      assert.doesNotThrow(() => insert.run(index + 1, `checkpoint-${index}`, hash, timestamp, hash));
    }
  } finally {
    database.close();
  }
});

test("checkpoint revision timestamp constraints reject malformed timezone carriers", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(readFileSync(join(root, "schema-v1.sql"), "utf8"));
    const insert = database.prepare(`
      INSERT INTO ge_cycle_checkpoint_revisions (
        tenant_id, checkpoint_scope, revision, checkpoint_id, action,
        summary_blob, bound_sequence, bound_record_hash,
        checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
      ) VALUES ('tenant', 'scope', ?, ?, 'put', X'7b7d', 0, ?, ?, ?, 1, 0)
    `);
    const hash = "b".repeat(64);
    for (const [index, timestamp] of [
      "2026-07-27T00:00:00",
      "2026-07-27T00:00:00+24:00",
      "2026-07-27T00:00:00+05:60",
      "2026-07-27 00:00:00Z",
      "2026-07-27T00:00:00.Z",
      "2026-07-27T00:00:00z",
    ].entries()) {
      assert.throws(() => insert.run(index + 1, `invalid-${index}`, hash, timestamp, hash));
    }
  } finally {
    database.close();
  }
});
