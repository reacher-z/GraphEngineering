#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
  sep,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateSqliteMigrationAssets } from "../spec/migrations/sqlite/validate.mjs";

export const SQLITE_RELEASE_ASSETS = Object.freeze([
  "schema-v1.sql",
  "0001-alpha-v0-to-v1.sql",
  "manifest.json",
  "schema-v1.identity.json",
]);

// Preview assets are mirrored and packaged byte-for-byte without activating
// schema version 2 in the current production manifest.
export const SQLITE_PREVIEW_ASSETS = Object.freeze([
  "0002-v1-to-v2-operation-replay.sql",
  "manifest-v2.preview.json",
]);

export const SQLITE_PYTHON_SUPPORT_ASSETS = Object.freeze([
  "manifest.schema.json",
  "fixtures/alpha-v0.sql",
  "fixtures/alpha-v0.expected.json",
]);

export const SQLITE_RELEASE_DIGESTS = Object.freeze({
  manifest: "5f052a21215a39de101d56447fa4b25d20b6053bc558e3960562932e958d7af6",
  schemaSql: "ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c",
  identityDocument: "4fcbe9872605011356e0655e2b9f9c3210e2bddbb131ddc87f08a93f0a1b9682",
  schemaIdentity: "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
  migrationSql: "a8e9de4d1bae81f8405ef611fca1298bef024ad1df5e905d1d5a9357d1e8cb9c",
  schemaCatalog: "8fab5049e2c9de5d114abc0c682934f1bc6fb5abd2e4c2e3ae55ef329c3e7264",
  alphaV0Catalog: "7dc847b914f5738c02ce04b1a7864c8b1f7d66550cb9888ed0699cbc8a272177",
  fixtureSql: "a57f063f52554aeb564dfbd90dc184146ce48160acd138e69ad02f76f9074eb6",
  fixtureExpectation: "e40ab4c5b4459704160a66a119306488722c889bbccce7355b46c2201158b5c2",
  fixtureIdentity: "fe0f2bb74eab8ccfabd3a856dbe6c6dbcae40695a48d76eaf585e8e0c0ea9941",
  previewManifest: "f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf",
  migration0002Sql: "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d",
});

const MODULE_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = dirname(dirname(MODULE_PATH));
const NPM_PACKAGE_NAMES = Object.freeze([
  "@graph-engineering/core",
  "@graph-engineering/persistence",
  "@graph-engineering/runtime",
  "@graph-engineering/sqlite",
]);
const NPM_PACKAGE_DIRECTORIES = Object.freeze({
  "@graph-engineering/core": "core",
  "@graph-engineering/persistence": "persistence",
  "@graph-engineering/runtime": "runtime",
  "@graph-engineering/sqlite": "sqlite",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

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

function assertDescendant(root, candidate, label) {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  assert.equal(
    candidatePath.startsWith(`${rootPath}${sep}`),
    true,
    `${label} escapes its declared root`,
  );
  return candidatePath;
}

function readRegularAsset(root, path, label = path) {
  assert.equal(typeof path, "string", `${label} path must be a string`);
  assert.equal(isAbsolute(path), false, `${label} path must be relative`);
  assert.equal(path.includes("\\"), false, `${label} path must use '/' separators`);
  assert.equal(path.split("/").includes(".."), false, `${label} path must not traverse`);
  const absolute = assertDescendant(root, join(root, ...path.split("/")), label);
  const stat = lstatSync(absolute);
  assert.equal(stat.isSymbolicLink(), false, `${label} must not be a symbolic link`);
  assert.equal(stat.isFile(), true, `${label} must be a regular file`);
  const rootRealPath = realpathSync(root);
  assert.equal(
    realpathSync(absolute).startsWith(`${rootRealPath}${sep}`),
    true,
    `${label} resolves outside its declared root`,
  );
  const bytes = readFileSync(absolute);
  assert.ok(bytes.length > 0, `${label} must not be empty`);
  assert.equal(bytes.length > 262_144, false, `${label} exceeds the 256 KiB release bound`);
  assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false, `${label} has a UTF-8 BOM`);
  assert.equal(bytes.includes(0x0d), false, `${label} must use LF line endings`);
  assert.equal(bytes.at(-1), 0x0a, `${label} must end in LF`);
  const text = bytes.toString("utf8");
  assert.equal(Buffer.from(text, "utf8").equals(bytes), true, `${label} is not valid UTF-8`);
  assert.equal(text.includes("\uFFFD"), false, `${label} contains replacement characters`);
  return Object.freeze({ absolute, bytes, text, sha256: sha256(bytes) });
}

function catalogDigest(sql) {
  const database = new DatabaseSync(":memory:", {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  try {
    database.exec(sql);
    const rows = database.prepare(
      `SELECT type, name, tbl_name, sql
         FROM sqlite_schema
        WHERE name GLOB 'ge_cycle_*'
          AND type IN ('table', 'index')
          AND sql IS NOT NULL
        ORDER BY type, name`,
    ).all().map((row) => ({
      type: row.type,
      name: row.name,
      tableName: row.tbl_name,
      sql: row.sql.replace(/\s+/gu, " ").trim(),
    }));
    return sha256(Buffer.from(canonicalJson(rows), "utf8"));
  } finally {
    database.close();
  }
}

function sourceRoots(root) {
  return Object.freeze({
    canonical: join(root, "spec", "migrations", "sqlite"),
    npm: join(root, "packages", "sqlite", "migrations"),
    python: join(root, "python", "src", "graph_engineering", "_sqlite_migrations"),
  });
}

/**
 * Validate the immutable SQLite migration closure before any release packaging.
 *
 * The compiled manifest digest is intentionally a trust anchor. A coordinated
 * edit to a SQL file and every self-reported manifest checksum must still fail.
 */
export function validateSQLiteMigrationReleaseSources({ root = REPOSITORY_ROOT } = {}) {
  const roots = sourceRoots(resolve(root));
  const canonical = new Map();
  for (const path of SQLITE_RELEASE_ASSETS) {
    const authoritative = readRegularAsset(roots.canonical, path, `spec/${path}`);
    const npm = readRegularAsset(roots.npm, path, `npm/${path}`);
    const python = readRegularAsset(roots.python, path, `python/${path}`);
    assert.equal(npm.bytes.equals(authoritative.bytes), true, `npm/${path} differs byte-for-byte from spec`);
    assert.equal(python.bytes.equals(authoritative.bytes), true, `python/${path} differs byte-for-byte from spec`);
    canonical.set(path, authoritative);
  }

  const preview = new Map();
  for (const path of SQLITE_PREVIEW_ASSETS) {
    const authoritative = readRegularAsset(roots.canonical, path, `spec/${path}`);
    const npm = readRegularAsset(roots.npm, path, `npm/${path}`);
    const python = readRegularAsset(roots.python, path, `python/${path}`);
    assert.equal(
      npm.bytes.equals(authoritative.bytes),
      true,
      `npm/${path} differs byte-for-byte from spec`,
    );
    assert.equal(
      python.bytes.equals(authoritative.bytes),
      true,
      `python/${path} differs byte-for-byte from spec`,
    );
    preview.set(path, authoritative);
  }
  assert.equal(
    preview.get("0002-v1-to-v2-operation-replay.sql").sha256,
    SQLITE_RELEASE_DIGESTS.migration0002Sql,
    "canonical SQLite migration 0002 changed without updating its compiled preview trust anchor",
  );
  assert.equal(
    preview.get("manifest-v2.preview.json").sha256,
    SQLITE_RELEASE_DIGESTS.previewManifest,
    "canonical SQLite v2 preview manifest changed without updating its compiled trust anchor",
  );
  const previewManifest = JSON.parse(preview.get("manifest-v2.preview.json").text);
  assert.equal(previewManifest.latestVersion, 2);
  assert.equal(previewManifest.migrations.length, 2);
  assert.equal(previewManifest.migrations[1].id, "v1-to-v2-operation-replay");
  assert.equal(
    previewManifest.migrations[1].sqlSha256,
    SQLITE_RELEASE_DIGESTS.migration0002Sql,
  );

  for (const path of SQLITE_PYTHON_SUPPORT_ASSETS) {
    const authoritative = readRegularAsset(roots.canonical, path, `spec/${path}`);
    const python = readRegularAsset(roots.python, path, `python/${path}`);
    assert.equal(
      python.bytes.equals(authoritative.bytes),
      true,
      `python/${path} differs byte-for-byte from spec`,
    );
  }

  const manifestAsset = canonical.get("manifest.json");
  assert.ok(manifestAsset !== undefined);
  assert.equal(
    manifestAsset.sha256,
    SQLITE_RELEASE_DIGESTS.manifest,
    "canonical SQLite manifest changed without updating the compiled release trust anchor",
  );
  const manifest = JSON.parse(manifestAsset.text);
  assert.deepEqual(manifest.requiredArtifactCopies, [
    "npm:@graph-engineering/sqlite/migrations",
    "python:graph_engineering/_sqlite_migrations",
  ]);
  assert.equal(manifest.schema.sqlSha256, SQLITE_RELEASE_DIGESTS.schemaSql);
  assert.equal(manifest.schema.identityDocumentSha256, SQLITE_RELEASE_DIGESTS.identityDocument);
  assert.equal(manifest.schema.schemaIdentitySha256, SQLITE_RELEASE_DIGESTS.schemaIdentity);
  assert.equal(manifest.migrations[0].sqlSha256, SQLITE_RELEASE_DIGESTS.migrationSql);
  assert.equal(manifest.migrations[0].targetSchemaIdentitySha256, SQLITE_RELEASE_DIGESTS.schemaIdentity);
  assert.equal(manifest.fixtures[0].sqlSha256, SQLITE_RELEASE_DIGESTS.fixtureSql);
  assert.equal(manifest.fixtures[0].expectationSha256, SQLITE_RELEASE_DIGESTS.fixtureExpectation);
  assert.equal(manifest.fixtures[0].fixtureIdentitySha256, SQLITE_RELEASE_DIGESTS.fixtureIdentity);

  const canonicalValidation = validateSqliteMigrationAssets({ root: roots.canonical });
  assert.deepEqual(canonicalValidation.digests, {
    schemaSql: SQLITE_RELEASE_DIGESTS.schemaSql,
    identityDocument: SQLITE_RELEASE_DIGESTS.identityDocument,
    schemaIdentity: SQLITE_RELEASE_DIGESTS.schemaIdentity,
    migrationSql: SQLITE_RELEASE_DIGESTS.migrationSql,
    fixtureSql: SQLITE_RELEASE_DIGESTS.fixtureSql,
    fixtureExpectation: SQLITE_RELEASE_DIGESTS.fixtureExpectation,
    fixtureIdentity: SQLITE_RELEASE_DIGESTS.fixtureIdentity,
  });

  const schemaCatalog = catalogDigest(canonical.get("schema-v1.sql").text);
  const alphaV0Catalog = catalogDigest(
    readRegularAsset(roots.canonical, "fixtures/alpha-v0.sql", "spec/fixtures/alpha-v0.sql").text,
  );
  assert.equal(schemaCatalog, SQLITE_RELEASE_DIGESTS.schemaCatalog, "version 1 catalog digest drifted");
  assert.equal(alphaV0Catalog, SQLITE_RELEASE_DIGESTS.alphaV0Catalog, "alpha v0 catalog digest drifted");

  return Object.freeze({
    ok: true,
    releaseAssetCount: SQLITE_RELEASE_ASSETS.length,
    mirroredCopyCount: SQLITE_RELEASE_ASSETS.length * 2,
    previewAssetCount: SQLITE_PREVIEW_ASSETS.length,
    previewMirroredCopyCount: SQLITE_PREVIEW_ASSETS.length * 2,
    pythonSupportAssetCount: SQLITE_PYTHON_SUPPORT_ASSETS.length,
    tableCount: canonicalValidation.tableCount,
    indexCount: canonicalValidation.indexCount,
    fixtureRecordCount: canonicalValidation.fixtureRecordCount,
    digests: Object.freeze({ ...SQLITE_RELEASE_DIGESTS }),
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stderr || result.stdout}`,
  );
  return result;
}

function copyNpmStagingWorkspace(repositoryRoot, stagingRoot) {
  for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    cpSync(join(repositoryRoot, path), join(stagingRoot, path));
  }
  mkdirSync(join(stagingRoot, "packages"));
  for (const directory of Object.values(NPM_PACKAGE_DIRECTORIES)) {
    const source = join(repositoryRoot, "packages", directory);
    const destination = join(stagingRoot, "packages", directory);
    cpSync(source, destination, {
      recursive: true,
      filter: (candidate) => {
        const name = basename(candidate);
        return !["node_modules", "dist", "coverage", ".vitest"].includes(name);
      },
    });
  }
}

function safeRemoveTemporaryRoot(path, prefix) {
  const resolved = resolve(path);
  assert.equal(dirname(resolved), resolve(tmpdir()), "refusing to remove a non-temporary directory");
  assert.ok(basename(resolved).startsWith(prefix), "refusing to remove an unexpected temporary directory");
  rmSync(resolved, { recursive: true, force: true });
}

export async function validateSQLiteNpmReleaseArtifact({ root = REPOSITORY_ROOT } = {}) {
  const repositoryRoot = resolve(root);
  const temporaryRoot = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-npm-release-"));
  const stagingRoot = join(temporaryRoot, "workspace");
  const tarballRoot = join(temporaryRoot, "tarballs");
  const consumerRoot = join(temporaryRoot, "consumer");
  mkdirSync(stagingRoot);
  mkdirSync(tarballRoot);
  mkdirSync(consumerRoot);

  try {
    copyNpmStagingWorkspace(repositoryRoot, stagingRoot);
    const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    run(corepack, ["pnpm", "install", "--frozen-lockfile", "--offline", "--ignore-scripts"], {
      cwd: stagingRoot,
    });
    for (const name of NPM_PACKAGE_NAMES) {
      run(corepack, ["pnpm", "--filter", name, "build"], { cwd: stagingRoot });
    }

    const tarballs = new Map();
    for (const name of NPM_PACKAGE_NAMES) {
      const directory = NPM_PACKAGE_DIRECTORIES[name];
      const before = new Set(readdirSync(tarballRoot));
      run(corepack, [
        "pnpm",
        "--dir",
        join(stagingRoot, "packages", directory),
        "pack",
        "--pack-destination",
        tarballRoot,
      ]);
      const created = readdirSync(tarballRoot).filter((entry) => !before.has(entry));
      assert.equal(created.length, 1, `${name} must produce exactly one tarball`);
      assert.match(created[0], /\.tgz$/u, `${name} did not produce a .tgz archive`);
      const tarball = join(tarballRoot, created[0]);
      const tarballStat = lstatSync(tarball);
      assert.equal(tarballStat.isSymbolicLink(), false, `${name} tarball must not be a symlink`);
      assert.equal(tarballStat.isFile(), true, `${name} tarball must be a regular file`);
      assert.ok(tarballStat.size > 0 && tarballStat.size <= 2_000_000, `${name} tarball is outside size bounds`);
      tarballs.set(name, tarball);
    }

    writeFileSync(
      join(consumerRoot, "package.json"),
      `${JSON.stringify({
        name: "graph-engineering-sqlite-release-smoke",
        version: "0.0.0",
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          [...tarballs].map(([name, path]) => [name, `file:${resolve(path)}`]),
        ),
      }, null, 2)}\n`,
    );
    run(npm, [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
    ], { cwd: consumerRoot });

    const installedRoot = join(consumerRoot, "node_modules", "@graph-engineering", "sqlite");
    const canonicalRoot = sourceRoots(repositoryRoot).canonical;
    for (const path of [...SQLITE_RELEASE_ASSETS, ...SQLITE_PREVIEW_ASSETS]) {
      const installed = readRegularAsset(installedRoot, `migrations/${path}`, `installed npm/${path}`);
      const canonical = readRegularAsset(canonicalRoot, path, `spec/${path}`);
      assert.equal(installed.bytes.equals(canonical.bytes), true, `installed npm/${path} differs from spec`);
    }

    const loaderPath = join(installedRoot, "dist", "migrations.js");
    const loaderStat = lstatSync(loaderPath);
    assert.equal(loaderStat.isFile(), true, "installed npm artifact omits dist/migrations.js");
    assert.equal(loaderStat.isSymbolicLink(), false, "installed npm migration loader must not be a symlink");
    const loader = await import(`${pathToFileURL(loaderPath).href}?integrity=${Date.now()}`);
    assert.equal(typeof loader.loadSQLiteMigrationAssets, "function", "installed npm migration loader is absent");
    const loaded = loader.loadSQLiteMigrationAssets();
    assert.equal(loaded.manifestSha256, SQLITE_RELEASE_DIGESTS.manifest);
    assert.equal(loaded.schemaSqlSha256, SQLITE_RELEASE_DIGESTS.schemaSql);
    assert.equal(loaded.schemaIdentityDocumentSha256, SQLITE_RELEASE_DIGESTS.identityDocument);
    assert.equal(loaded.schemaIdentitySha256, SQLITE_RELEASE_DIGESTS.schemaIdentity);
    assert.equal(loaded.alphaV0ToV1SqlSha256, SQLITE_RELEASE_DIGESTS.migrationSql);

    const runtimePath = join(
      consumerRoot,
      "node_modules",
      "@graph-engineering",
      "runtime",
      "dist",
      "index.js",
    );
    const sqlitePath = join(installedRoot, "dist", "index.js");
    const runtime = await import(`${pathToFileURL(runtimePath).href}?smoke=${Date.now()}`);
    const sqlite = await import(`${pathToFileURL(sqlitePath).href}?smoke=${Date.now()}`);
    assert.equal(typeof sqlite.SQLiteCycleStoreProvider, "function");
    assert.equal(typeof runtime.createCycleStoreRecord, "function");

    const databasePath = join(consumerRoot, "installed-cycle-store.db");
    const context = Object.freeze({
      tenantId: "installed-tenant",
      principalHash: "a".repeat(64),
      authorizationHash: "b".repeat(64),
      operationId: "installed-append",
    });
    const record = runtime.createCycleStoreRecord({
      recordId: "installed-record-0",
      sequence: 0,
      previousRecordHash: null,
      value: { source: "installed-npm-artifact", sequence: 0 },
    });
    const request = Object.freeze({
      context,
      streamId: "installed-stream",
      expectedTail: Object.freeze({ exists: false, sequence: -1, recordHash: null }),
      lease: null,
      records: Object.freeze([record]),
    });
    let first;
    const created = new sqlite.SQLiteCycleStoreProvider(databasePath);
    try {
      first = await created.append(request);
    } finally {
      created.close();
    }
    const reopened = new sqlite.SQLiteCycleStoreProvider(databasePath);
    try {
      const retainedTail = await reopened.readTail({
        context: {
          tenantId: context.tenantId,
          principalHash: context.principalHash,
          authorizationHash: context.authorizationHash,
        },
        streamId: request.streamId,
      });
      assert.deepEqual(retainedTail, first.tail, "installed npm artifact lost its durable tail");
      assert.deepEqual(
        await reopened.append(request),
        first,
        "installed npm artifact did not replay the durable operation ledger",
      );
    } finally {
      reopened.close();
    }

    const sqliteTarball = tarballs.get("@graph-engineering/sqlite");
    assert.equal(typeof sqliteTarball, "string", "SQLite package tarball was not recorded");
    return Object.freeze({
      ok: true,
      packageCount: NPM_PACKAGE_NAMES.length,
      releaseAssetCount: SQLITE_RELEASE_ASSETS.length,
      previewAssetCount: SQLITE_PREVIEW_ASSETS.length,
      installedLoader: "dist/migrations.js",
      installedRuntimeSmoke: "open-append-close-reopen-read-replay",
      tarball: basename(sqliteTarball),
    });
  } finally {
    safeRemoveTemporaryRoot(temporaryRoot, "graph-engineering-sqlite-npm-release-");
  }
}

export function validateSQLitePythonReleaseArtifacts({ root = REPOSITORY_ROOT } = {}) {
  const result = run(
    process.platform === "win32" ? "python.exe" : "python3",
    [join(resolve(root), "scripts", "check-sqlite-python-artifacts.py")],
    { cwd: resolve(root) },
  );
  const line = result.stdout.trim().split(/\r?\n/u).at(-1);
  assert.ok(line !== undefined && line.startsWith("{"), "Python artifact gate did not emit JSON");
  const report = JSON.parse(line);
  assert.equal(report.ok, true, "Python artifact gate did not report success");
  return Object.freeze(report);
}

export async function validateSQLiteMigrationReleaseArtifacts({ root = REPOSITORY_ROOT } = {}) {
  const sources = validateSQLiteMigrationReleaseSources({ root });
  const npm = await validateSQLiteNpmReleaseArtifact({ root });
  const python = validateSQLitePythonReleaseArtifacts({ root });
  return Object.freeze({ ok: true, sources, npm, python });
}

function usage() {
  return `Usage: node scripts/check-sqlite-migration-release.mjs [--source-only | --artifacts]\n\n` +
    `  --source-only  Validate canonical/mirrored bytes, manifest closure, catalogs, and fixtures.\n` +
    `  --artifacts    Also build, inspect, isolate-install, and load npm/Python release artifacts.\n`;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === MODULE_PATH) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.includes("--help")) {
    process.stdout.write(usage());
  } else {
    assert.ok(
      arguments_.length <= 1 && [undefined, "--source-only", "--artifacts"].includes(arguments_[0]),
      usage(),
    );
    const report = arguments_[0] === "--artifacts"
      ? await validateSQLiteMigrationReleaseArtifacts()
      : validateSQLiteMigrationReleaseSources();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}
