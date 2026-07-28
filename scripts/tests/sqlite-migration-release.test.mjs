import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  SQLITE_RELEASE_DIGESTS,
  validateSQLiteMigrationReleaseSources,
} from "../check-sqlite-migration-release.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function temporaryRepository() {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-release-test-"));
  const copies = [
    ["spec/migrations/sqlite", "spec/migrations/sqlite"],
    ["packages/sqlite/migrations", "packages/sqlite/migrations"],
    [
      "python/src/graph_engineering/_sqlite_migrations",
      "python/src/graph_engineering/_sqlite_migrations",
    ],
  ];
  for (const [source, destination] of copies) {
    const target = join(root, destination);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(REPOSITORY_ROOT, source), target, { recursive: true });
  }
  return root;
}

function cleanup(root) {
  const resolved = resolve(root);
  assert.equal(dirname(resolved), resolve(tmpdir()));
  assert.ok(basename(resolved).startsWith("graph-engineering-sqlite-release-test-"));
  rmSync(resolved, { recursive: true, force: true });
}

test("canonical, npm, and Python SQLite migration resources close over fixed release digests", () => {
  const report = validateSQLiteMigrationReleaseSources();
  assert.deepEqual(report, {
    ok: true,
    releaseAssetCount: 4,
    mirroredCopyCount: 8,
    pythonSupportAssetCount: 3,
    tableCount: 13,
    indexCount: 14,
    fixtureRecordCount: 3,
    digests: SQLITE_RELEASE_DIGESTS,
  });
});

test("one changed npm migration byte is rejected before packaging", () => {
  const root = temporaryRepository();
  try {
    const target = join(root, "packages/sqlite/migrations/schema-v1.sql");
    writeFileSync(target, `${readFileSync(target, "utf8")}-- drift\n`);
    assert.throws(
      () => validateSQLiteMigrationReleaseSources({ root }),
      /npm\/schema-v1\.sql differs byte-for-byte from spec/u,
    );
  } finally {
    cleanup(root);
  }
});

test("coordinated manifest edits cannot replace the compiled release trust anchor", () => {
  const root = temporaryRepository();
  try {
    for (const path of [
      "spec/migrations/sqlite/manifest.json",
      "packages/sqlite/migrations/manifest.json",
      "python/src/graph_engineering/_sqlite_migrations/manifest.json",
    ]) {
      const target = join(root, path);
      const manifest = JSON.parse(readFileSync(target, "utf8"));
      writeFileSync(target, `${JSON.stringify(manifest, null, 2)}  \n`);
    }
    assert.throws(
      () => validateSQLiteMigrationReleaseSources({ root }),
      /compiled release trust anchor/u,
    );
  } finally {
    cleanup(root);
  }
});

test("a Python fixture mirror drift breaks the self-contained manifest closure", () => {
  const root = temporaryRepository();
  try {
    const target = join(
      root,
      "python/src/graph_engineering/_sqlite_migrations/fixtures/alpha-v0.expected.json",
    );
    writeFileSync(target, `${readFileSync(target, "utf8")} \n`);
    assert.throws(
      () => validateSQLiteMigrationReleaseSources({ root }),
      /python\/fixtures\/alpha-v0\.expected\.json differs byte-for-byte from spec/u,
    );
  } finally {
    cleanup(root);
  }
});

test("release mirrors must be regular files, never symlink substitutions", () => {
  const root = temporaryRepository();
  try {
    const target = join(root, "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql");
    rmSync(target);
    symlinkSync(
      join(root, "spec/migrations/sqlite/schema-v1.sql"),
      target,
    );
    assert.throws(
      () => validateSQLiteMigrationReleaseSources({ root }),
      /python\/schema-v1\.sql must not be a symbolic link/u,
    );
  } finally {
    cleanup(root);
  }
});
