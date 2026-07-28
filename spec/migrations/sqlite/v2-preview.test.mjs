import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateSqliteV2Preview } from "./validate-v2-preview.mjs";

const roots = [];

function copyFixture() {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-v2-preview-"));
  roots.push(root);
  cpSync(new URL(".", import.meta.url), root, { recursive: true });
  return root;
}

test.afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("validates the frozen schema-v2 catalog and both migration edges", () => {
  assert.deepEqual(validateSqliteV2Preview(), {
    ok: true,
    latestVersion: 2,
    tableCount: 16,
    indexCount: 18,
    migrationCount: 2,
    fixtureCount: 2,
    digests: {
      schemaSql: "5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5",
      identityDocument: "c6a2df3422eadf60a814c55f9c266dffde52e9da021cc554ea19a6785669cec2",
      schemaIdentity: "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634",
      migrationV1ToV2: "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d",
      previewManifest: "f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf",
    },
  });
});

test("rejects drift in an immutable version-1 predecessor", () => {
  const root = copyFixture();
  const path = join(root, "schema-v1.sql");
  writeFileSync(path, `${readFileSync(path, "utf8")}-- drift\n`);
  assert.throws(
    () => validateSqliteV2Preview({ root }),
    /schema-v1\.sql predecessor changed/u,
  );
});

test("rejects a self-reporting schema-v2 byte change", () => {
  const root = copyFixture();
  const path = join(root, "schema-v2.sql");
  writeFileSync(path, `${readFileSync(path, "utf8")}-- drift\n`);
  assert.throws(
    () => validateSqliteV2Preview({ root }),
    /Expected values to be strictly equal/u,
  );
});
