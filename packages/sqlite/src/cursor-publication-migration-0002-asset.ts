import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { constants as fsConstants, lstatSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

const OPERATION = "inspect-schema" as const;
const ASSET_URL = new URL("../migrations/0002-v1-to-v2-operation-replay.sql", import.meta.url);
const PREVIEW_MANIFEST_URL = new URL("../migrations/manifest-v2.preview.json", import.meta.url);
const MAXIMUM_ASSET_BYTES = 262_144;

export const SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME =
  "0002-v1-to-v2-operation-replay.sql" as const;
export const SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256 =
  "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d" as const;
export const SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES = 9_523 as const;
export const SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT = 20 as const;
export const SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256 =
  "f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf" as const;
export const SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_UTF8_BYTES = 4_908 as const;
export const SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256 =
  "5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5" as const;

/** Opaque proof that the installed package asset matched its frozen bytes. */
export interface SQLiteCursorMigration0002Asset {
  readonly __sqliteCursorMigration0002Asset: never;
}

/** Opaque identity of the exact verified preview manifest object. */
export interface SQLiteCursorMigration0002PreviewManifestIdentity {
  readonly __sqliteCursorMigration0002PreviewManifestIdentity: never;
}

export interface SQLiteCursorMigration0002AssetSnapshot {
  readonly assetName: typeof SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME;
  readonly assetSha256: typeof SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256;
  readonly assetUtf8Bytes: typeof SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES;
  readonly fixedStatementCount: typeof SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT;
  readonly previewManifestSha256: typeof SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256;
  readonly previewManifestIdentity: SQLiteCursorMigration0002PreviewManifestIdentity;
  readonly schemaSqlSha256: typeof SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256;
  readonly statements: readonly string[];
}

const ASSETS = new WeakMap<object, SQLiteCursorMigration0002AssetSnapshot>();
const PREVIEW_MANIFESTS = new WeakMap<object, Readonly<{
  readonly manifest: unknown;
  readonly migration: unknown;
}>>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const objectFreezeIntrinsic = Object.freeze;
const objectCreateIntrinsic = Object.create;
const reflectApplyIntrinsic = Reflect.apply;
const arrayPushIntrinsic = Array.prototype.push;
const stringCharCodeAtIntrinsic = String.prototype.charCodeAt;
const stringEndsWithIntrinsic = String.prototype.endsWith;
const stringIncludesIntrinsic = String.prototype.includes;
const stringSliceIntrinsic = String.prototype.slice;
const stringTrimIntrinsic = String.prototype.trim;
const bufferFromIntrinsic = Buffer.from;
const bufferEqualsIntrinsic = Buffer.prototype.equals;
const bufferToStringIntrinsic = Buffer.prototype.toString;
const hashProbe = createHash("sha256");
const hashUpdateIntrinsic = hashProbe.update;
const hashDigestIntrinsic = hashProbe.digest;
const jsonParseIntrinsic = JSON.parse;

function fail(message: string): never {
  throw new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function sha256(bytes: Uint8Array): string {
  const digest = createHash("sha256");
  reflectApplyIntrinsic(hashUpdateIntrinsic, digest, [bytes]);
  return reflectApplyIntrinsic(hashDigestIntrinsic, digest, ["hex"]) as string;
}

function splitFixedStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | "[" | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      const close = quote === "[" ? "]" : quote;
      if (current === close) {
        if (quote !== "[" && next === close) index += 1;
        else quote = undefined;
      }
      continue;
    }
    if (current === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "'" || current === '"' || current === "`" || current === "[") {
      quote = current;
      continue;
    }
    if (current === ";") {
      const statement = reflectApplyIntrinsic(stringTrimIntrinsic,
        reflectApplyIntrinsic(stringSliceIntrinsic, sql, [start, index + 1]), []) as string;
      if (statement.length !== 0) {
        reflectApplyIntrinsic(arrayPushIntrinsic, statements, [statement]);
      }
      start = index + 1;
    }
  }
  const trailing = reflectApplyIntrinsic(stringTrimIntrinsic,
    reflectApplyIntrinsic(stringSliceIntrinsic, sql, [start]), []) as string;
  if (quote !== undefined || lineComment || blockComment || trailing.length !== 0
      || statements.length !== SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT) {
    return fail("SQLite migration 0002 statement framing drifted");
  }
  return objectFreezeIntrinsic(statements);
}

function readExactBytes(
  url: URL,
  expectedBytes: number,
  expectedSha256: string,
  label: string,
): Buffer {
  const path = fileURLToPath(url);
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    return fail(`${label} is missing`);
  }
  if ((stat.mode & fsConstants.S_IFMT) !== fsConstants.S_IFREG
      || stat.size !== expectedBytes
      || stat.size > MAXIMUM_ASSET_BYTES) {
    return fail(`${label} is invalid`);
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch {
    return fail(`${label} is unavailable`);
  }
  if (bytes.byteLength !== expectedBytes || sha256(bytes) !== expectedSha256) {
    return fail(`${label} bytes drifted`);
  }
  return bytes;
}

function checkedUtf8Lf(bytes: Buffer, label: string): string {
  const text = reflectApplyIntrinsic(bufferToStringIntrinsic, bytes, ["utf8"]) as string;
  const roundTrip = reflectApplyIntrinsic(bufferFromIntrinsic, Buffer, [text, "utf8"]) as Buffer;
  if (!reflectApplyIntrinsic(bufferEqualsIntrinsic, bytes, [roundTrip])
      || reflectApplyIntrinsic(stringCharCodeAtIntrinsic, text, [0]) === 0xfeff
      || reflectApplyIntrinsic(stringIncludesIntrinsic, text, ["\r"])
      || !reflectApplyIntrinsic(stringEndsWithIntrinsic, text, ["\n"])
      || reflectApplyIntrinsic(stringEndsWithIntrinsic, text, ["\n\n"])) {
    return fail(`${label} is not canonical UTF-8/LF`);
  }
  return text;
}

function loadPreviewManifestIdentity(): SQLiteCursorMigration0002PreviewManifestIdentity {
  const bytes = readExactBytes(
    PREVIEW_MANIFEST_URL,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_UTF8_BYTES,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
    "SQLite migration 0002 preview manifest",
  );
  const text = checkedUtf8Lf(bytes, "SQLite migration 0002 preview manifest");
  let value: unknown;
  try {
    value = reflectApplyIntrinsic(jsonParseIntrinsic, JSON, [text]);
  } catch {
    return fail("SQLite migration 0002 preview manifest JSON is invalid");
  }
  const manifest = value as {
    readonly $schema?: unknown;
    readonly applicationId?: unknown;
    readonly byteEncoding?: unknown;
    readonly engine?: unknown;
    readonly formatVersion?: unknown;
    readonly hashAlgorithm?: unknown;
    readonly latestVersion?: unknown;
    readonly migrations?: readonly Readonly<Record<string, unknown>>[];
    readonly schema?: Readonly<Record<string, unknown>>;
  };
  const migration = manifest?.migrations?.[1];
  if (manifest?.$schema !== "./manifest-v2.preview.schema.json"
      || manifest?.formatVersion !== 1 || manifest?.engine !== "sqlite"
      || manifest?.applicationId !== 1_195_724_359 || manifest?.latestVersion !== 2
      || manifest?.hashAlgorithm !== "sha256" || manifest?.byteEncoding !== "utf-8-lf"
      || manifest?.schema?.version !== 2
      || manifest?.schema?.sqlSha256 !== SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256
      || manifest?.schema?.schemaIdentitySha256
        !== "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634"
      || migration?.id !== "v1-to-v2-operation-replay"
      || migration?.fromVersion !== 1 || migration?.toVersion !== 2
      || migration?.sqlPath !== SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME
      || migration?.sqlSha256 !== SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256
      || migration?.targetSchemaIdentitySha256
        !== "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634"
      || migration?.transactionMode !== "caller-begin-exclusive"
      || migration?.finalization !== "manifest-bound-prepared-statements-before-commit") {
    return fail("SQLite migration 0002 preview manifest identity drifted");
  }
  const identity = objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as SQLiteCursorMigration0002PreviewManifestIdentity;
  reflectApplyIntrinsic(weakMapSetIntrinsic, PREVIEW_MANIFESTS, [
    identity as object,
    objectFreezeIntrinsic({ manifest, migration }),
  ]);
  return identity;
}

/** Re-read and verify the installed package asset for each logical execution. */
export function loadSQLiteCursorMigration0002AssetIntrinsic():
SQLiteCursorMigration0002Asset {
  const bytes = readExactBytes(
    ASSET_URL,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
    "SQLite migration 0002 package asset",
  );
  const sql = checkedUtf8Lf(bytes, "SQLite migration 0002 package asset");
  const previewManifestIdentity = loadPreviewManifestIdentity();
  const asset = objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as SQLiteCursorMigration0002Asset;
  const snapshot = objectFreezeIntrinsic({
    assetName: SQLITE_CURSOR_MIGRATION_0002_ASSET_NAME,
    assetSha256: SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
    assetUtf8Bytes: SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
    fixedStatementCount: SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
    previewManifestIdentity,
    previewManifestSha256: SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
    schemaSqlSha256: SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
    statements: splitFixedStatements(sql),
  });
  reflectApplyIntrinsic(weakMapSetIntrinsic, ASSETS, [asset as object, snapshot]);
  return asset;
}

/** Validate asset provenance and return its immutable package-owned execution plan. */
export function readSQLiteCursorMigration0002AssetSnapshotIntrinsic(
  asset: SQLiteCursorMigration0002Asset,
): SQLiteCursorMigration0002AssetSnapshot {
  const snapshot = asset !== null && typeof asset === "object" && !isProxy(asset)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, ASSETS, [asset as object]) as
      SQLiteCursorMigration0002AssetSnapshot | undefined
    : undefined;
  if (snapshot === undefined) return fail("SQLite migration 0002 asset proof is invalid");
  const manifest = reflectApplyIntrinsic(weakMapGetIntrinsic, PREVIEW_MANIFESTS, [
    snapshot.previewManifestIdentity as object,
  ]);
  if (manifest === undefined) return fail("SQLite migration 0002 preview manifest proof is invalid");
  return snapshot;
}
