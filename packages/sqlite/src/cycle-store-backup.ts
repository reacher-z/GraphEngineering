import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  open,
  readFile,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  DatabaseSync,
  backup as sqliteBackup,
  type BackupProgressInfo,
} from "node:sqlite";
import { performance } from "node:perf_hooks";

import { canonicalSerialize } from "@graph-engineering/core";
import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  createSQLitePhysicalBackup,
  type SQLitePhysicalBackupOptions,
} from "./backup.js";
import {
  SQLITE_CYCLE_STORE_APPLICATION_ID,
  SQLITE_CYCLE_STORE_SCHEMA_VERSION,
  SQLITE_SCHEMA_CATALOG_SHA256,
  SQLITE_SCHEMA_IDENTITY_SHA256,
} from "./migrations.js";
import {
  inspectSQLiteCycleStoreIntegrity,
  type SQLiteCycleStoreIntegrityReport,
  type SQLiteSemanticCounters,
} from "./semantic-integrity.js";
import { SQLiteConnection } from "./sqlite-connection.js";
import { SQLITE_CYCLE_STORE_DESCRIPTOR_HASH } from "./sqlite-profile.js";

export const SQLITE_BACKUP_MANIFEST_API_VERSION =
  "graphengineering.reacher-z.github.io/sqlite-cycle-store-backup-manifests/v1alpha1" as const;
export const SQLITE_BACKUP_MANIFEST_DOMAIN =
  "graph-engineering/sqlite-cycle-store-backup-manifest/v1\0" as const;

const MAX_MANIFEST_BYTES = 65_536;
const DEFAULT_RESTORE_RATE_PAGES = 128;
const MAX_RESTORE_RATE_PAGES = 4_096;
const DEFAULT_RESTORE_PROGRESS_CALLS = 100_000;
const MAX_RESTORE_PROGRESS_CALLS = 1_000_000;
const DEFAULT_RESTORE_ELAPSED_MS = 300_000;
const MAX_RESTORE_ELAPSED_MS = 1_800_000;

interface SQLiteCycleStoreBackupManifestBody {
  readonly apiVersion: typeof SQLITE_BACKUP_MANIFEST_API_VERSION;
  readonly kind: "SQLiteCycleStoreBackupManifest";
  readonly formatVersion: 1;
  readonly hashAlgorithm: "sha256";
  readonly file: {
    readonly bytes: number;
    readonly sha256: string;
  };
  readonly provider: {
    readonly applicationId: typeof SQLITE_CYCLE_STORE_APPLICATION_ID;
    readonly schemaVersion: typeof SQLITE_CYCLE_STORE_SCHEMA_VERSION;
    readonly schemaIdentitySha256: typeof SQLITE_SCHEMA_IDENTITY_SHA256;
    readonly descriptorHash: typeof SQLITE_CYCLE_STORE_DESCRIPTOR_HASH;
    readonly catalogSha256: typeof SQLITE_SCHEMA_CATALOG_SHA256;
    readonly lineageId: "fresh-v1-baseline" | "alpha-v0-to-v1";
    readonly lineageSha256: string;
  };
  readonly semantic: {
    readonly sha256: string;
    readonly counters: SQLiteSemanticCounters;
  };
}

export interface SQLiteCycleStoreBackupManifest extends SQLiteCycleStoreBackupManifestBody {
  readonly manifestSha256: string;
}

export interface SQLiteCycleStoreBackupReport {
  readonly path: string;
  readonly manifestPath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly manifestSha256: string;
  readonly pages: number;
  readonly progressCalls: number;
  readonly integrity: SQLiteCycleStoreIntegrityReport;
}

export interface SQLiteCycleStoreRestoreOptions {
  readonly manifestPath?: string;
  readonly ratePages?: number;
  readonly maxProgressCalls?: number;
  readonly maxElapsedMs?: number;
  readonly signal?: AbortSignal;
}

export interface SQLiteCycleStoreRestoreReport {
  readonly path: string;
  readonly bytes: number;
  readonly pages: number;
  readonly progressCalls: number;
  readonly sourceManifestSha256: string;
  readonly integrity: SQLiteCycleStoreIntegrityReport;
}

function invalid(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    "inspect-schema",
    message,
  );
}

function safeBackupError(error: unknown, action: "backup" | "restore"): CycleStoreProviderError {
  try {
    if (error instanceof CycleStoreProviderError) return error;
  } catch {
    // Hostile thrown values remain an opaque internal failure.
  }
  let code: unknown;
  try {
    code = (error as NodeJS.ErrnoException).code;
  } catch {
    code = undefined;
  }
  if (code === "ENOSPC" || code === "EDQUOT" || code === "EFBIG") {
    return new CycleStoreProviderError(
      "GE_CYCLE_STORE_QUOTA_EXCEEDED",
      "inspect-schema",
      `SQLite ${action} storage quota was exceeded`,
    );
  }
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return new CycleStoreProviderError(
      "GE_CYCLE_STORE_PERMISSION_DENIED",
      "inspect-schema",
      `SQLite ${action} filesystem access was denied`,
    );
  }
  return new CycleStoreProviderError(
    "GE_CYCLE_STORE_INTERNAL",
    "inspect-schema",
    `SQLite ${action} failed safely`,
  );
}

function checkedPath(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return invalid(`${label} is invalid`);
  }
  return value;
}

function checkedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return invalid(`${label} is outside bounds`);
  }
  return value as number;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function existingPathAliases(
  candidate: string,
  sourceRealPath: string,
  sourceDevice: number | bigint,
  sourceInode: number | bigint,
): Promise<boolean> {
  try {
    const metadata = await lstat(candidate, { bigint: true });
    if (metadata.dev === BigInt(sourceDevice) && metadata.ino === BigInt(sourceInode)) return true;
    try {
      return await realpath(candidate) === sourceRealPath;
    } catch {
      return false;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || (code !== "EISDIR" && code !== "EPERM")) throw error;
  } finally {
    await handle?.close();
  }
}

function manifestHash(body: SQLiteCycleStoreBackupManifestBody): string {
  return createHash("sha256")
    .update(SQLITE_BACKUP_MANIFEST_DOMAIN, "utf8")
    .update(canonicalSerialize(body), "utf8")
    .digest("hex");
}

function createManifest(
  bytes: number,
  sha256: string,
  integrity: SQLiteCycleStoreIntegrityReport,
): SQLiteCycleStoreBackupManifest {
  if (integrity.level !== "semantic" || integrity.semanticSha256 === null) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INTERNAL",
      "inspect-schema",
      "SQLite backup semantic audit did not complete",
    );
  }
  const body: SQLiteCycleStoreBackupManifestBody = {
    apiVersion: SQLITE_BACKUP_MANIFEST_API_VERSION,
    kind: "SQLiteCycleStoreBackupManifest",
    formatVersion: 1,
    hashAlgorithm: "sha256",
    file: { bytes, sha256 },
    provider: {
      applicationId: integrity.applicationId,
      schemaVersion: integrity.schemaVersion,
      schemaIdentitySha256: integrity.schemaIdentitySha256,
      descriptorHash: integrity.descriptorHash,
      catalogSha256: integrity.catalogSha256,
      lineageId: integrity.lineageId,
      lineageSha256: integrity.lineageSha256,
    },
    semantic: {
      sha256: integrity.semanticSha256,
      counters: integrity.counters,
    },
  };
  return Object.freeze({ ...body, manifestSha256: manifestHash(body) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function validCounters(value: Record<string, unknown>): boolean {
  const keys = [
    "streams", "records", "operations", "checkpoints", "checkpointRevisions",
    "leases", "usedLeaseIds", "legalHolds", "cursors", "openCursors",
    "usedMigrationLockIds",
  ];
  return exactKeys(value, keys)
    && keys.every((key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0)
    && (value.openCursors as number) <= (value.cursors as number);
}

function parseManifest(text: string): SQLiteCycleStoreBackupManifest {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite backup manifest is invalid",
    );
  }
  const corrupt = (): never => {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite backup manifest identity drifted",
    );
  };
  if (!isRecord(value)
      || canonicalSerialize(value) !== text
      || !exactKeys(value, [
        "apiVersion", "kind", "formatVersion", "hashAlgorithm", "file",
        "provider", "semantic", "manifestSha256",
      ])) return corrupt();
  const file = value.file;
  const provider = value.provider;
  const semantic = value.semantic;
  if (!isRecord(file) || !exactKeys(file, ["bytes", "sha256"])
      || !isRecord(provider) || !exactKeys(provider, [
        "applicationId", "schemaVersion", "schemaIdentitySha256", "descriptorHash",
        "catalogSha256", "lineageId", "lineageSha256",
      ])
      || !isRecord(semantic) || !exactKeys(semantic, ["sha256", "counters"])
      || value.apiVersion !== SQLITE_BACKUP_MANIFEST_API_VERSION
      || value.kind !== "SQLiteCycleStoreBackupManifest"
      || value.formatVersion !== 1
      || value.hashAlgorithm !== "sha256"
      || !Number.isSafeInteger(file.bytes) || (file.bytes as number) < 1
      || !validHash(file.sha256)
      || provider.applicationId !== SQLITE_CYCLE_STORE_APPLICATION_ID
      || provider.schemaVersion !== SQLITE_CYCLE_STORE_SCHEMA_VERSION
      || provider.schemaIdentitySha256 !== SQLITE_SCHEMA_IDENTITY_SHA256
      || provider.descriptorHash !== SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
      || provider.catalogSha256 !== SQLITE_SCHEMA_CATALOG_SHA256
      || (provider.lineageId !== "fresh-v1-baseline" && provider.lineageId !== "alpha-v0-to-v1")
      || !validHash(provider.lineageSha256)
      || !validHash(semantic.sha256)
      || !isRecord(semantic.counters)
      || !validCounters(semantic.counters)
      || !validHash(value.manifestSha256)) return corrupt();
  const { manifestSha256, ...body } = value;
  if (manifestHash(body as unknown as SQLiteCycleStoreBackupManifestBody) !== manifestSha256) {
    return corrupt();
  }
  return value as unknown as SQLiteCycleStoreBackupManifest;
}

async function readManifest(path: string): Promise<SQLiteCycleStoreBackupManifest> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()
      || metadata.size < 2 || metadata.size > MAX_MANIFEST_BYTES) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite backup manifest file is invalid",
    );
  }
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text, "utf8") !== metadata.size) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite backup manifest changed during verification",
    );
  }
  return parseManifest(text);
}

function assertManifestIntegrity(
  manifest: SQLiteCycleStoreBackupManifest,
  integrity: SQLiteCycleStoreIntegrityReport,
): void {
  if (integrity.semanticSha256 !== manifest.semantic.sha256
      || canonicalSerialize(integrity.counters) !== canonicalSerialize(manifest.semantic.counters)
      || integrity.lineageId !== manifest.provider.lineageId
      || integrity.lineageSha256 !== manifest.provider.lineageSha256
      || integrity.descriptorHash !== manifest.provider.descriptorHash
      || integrity.schemaIdentitySha256 !== manifest.provider.schemaIdentitySha256
      || integrity.catalogSha256 !== manifest.provider.catalogSha256) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite backup semantic identity drifted",
    );
  }
}

/**
 * Creates a live-WAL-safe native backup, performs the complete semantic audit,
 * writes a content-addressed manifest, and then publishes both without
 * overwriting an existing path.
 */
export async function createSQLiteCycleStoreBackup(
  sourcePath: string,
  destination: string,
  options: SQLitePhysicalBackupOptions = {},
): Promise<SQLiteCycleStoreBackupReport> {
  const source = checkedPath(sourcePath, "SQLite backup source");
  const target = checkedPath(destination, "SQLite backup destination");
  let parent: string;
  let sourceRealPath: string;
  let sourceMetadata;
  try {
    sourceMetadata = await lstat(source, { bigint: true });
    if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink()) {
      return invalid("SQLite backup source must be one regular non-symlink file");
    }
    parent = await realpath(dirname(target));
    sourceRealPath = await realpath(source);
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_PERMISSION_DENIED",
      "inspect-schema",
      "SQLite backup source or destination parent is unavailable",
    );
  }
  const publishedPath = join(parent, basename(target));
  const manifestPath = `${publishedPath}.manifest.json`;
  if (publishedPath === sourceRealPath
      || await existingPathAliases(
        publishedPath,
        sourceRealPath,
        sourceMetadata.dev,
        sourceMetadata.ino,
      )) {
    return invalid("SQLite backup destination aliases its source");
  }
  if (await exists(publishedPath) || await exists(manifestPath)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CONFLICT",
      "inspect-schema",
      "SQLite backup destination already exists",
    );
  }
  const nonce = randomBytes(16).toString("hex");
  const hiddenBackup = join(parent, `.${basename(target)}.verified-${nonce}.db`);
  const hiddenManifest = join(parent, `.${basename(target)}.verified-${nonce}.manifest.tmp`);
  let sourceConnection: SQLiteConnection | undefined;
  let databasePublished = false;
  let manifestPublished = false;
  try {
    sourceConnection = new SQLiteConnection(source);
    const physical = await createSQLitePhysicalBackup(sourceConnection, hiddenBackup, options);
    sourceConnection.close();
    sourceConnection = undefined;
    const integrity = inspectSQLiteCycleStoreIntegrity(hiddenBackup, "semantic");
    const manifest = createManifest(physical.bytes, physical.sha256, integrity);
    const manifestText = canonicalSerialize(manifest);
    if (Buffer.byteLength(manifestText, "utf8") > MAX_MANIFEST_BYTES) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INTERNAL",
        "inspect-schema",
        "SQLite backup manifest exceeds its fixed bound",
      );
    }
    const handle = await open(hiddenManifest, "wx", 0o600);
    try {
      await handle.writeFile(manifestText, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncFile(hiddenBackup);
    await link(hiddenBackup, publishedPath);
    databasePublished = true;
    try {
      await link(hiddenManifest, manifestPath);
      manifestPublished = true;
    } catch (error) {
      await safeUnlink(publishedPath);
      databasePublished = false;
      throw error;
    }
    await syncDirectory(parent);
    return Object.freeze({
      path: publishedPath,
      manifestPath,
      bytes: physical.bytes,
      sha256: physical.sha256,
      manifestSha256: manifest.manifestSha256,
      pages: physical.pages,
      progressCalls: physical.progressCalls,
      integrity,
    });
  } catch (error) {
    if (manifestPublished) await safeUnlink(manifestPath).catch(() => undefined);
    if (databasePublished) await safeUnlink(publishedPath).catch(() => undefined);
    throw safeBackupError(error, "backup");
  } finally {
    sourceConnection?.close();
    await safeUnlink(hiddenBackup).catch(() => undefined);
    await safeUnlink(hiddenManifest).catch(() => undefined);
  }
}

/** Verifies a manifest-bound backup and restores it only to a new empty path. */
export async function restoreSQLiteCycleStoreBackup(
  backupPath: string,
  destination: string,
  options: SQLiteCycleStoreRestoreOptions = {},
): Promise<SQLiteCycleStoreRestoreReport> {
  const source = checkedPath(backupPath, "SQLite restore source");
  const target = checkedPath(destination, "SQLite restore destination");
  const manifestInput = checkedPath(
    options.manifestPath ?? `${source}.manifest.json`,
    "SQLite restore manifest path",
  );
  const ratePages = checkedInteger(
    options.ratePages ?? DEFAULT_RESTORE_RATE_PAGES,
    1,
    MAX_RESTORE_RATE_PAGES,
    "SQLite restore page rate",
  );
  const maxProgressCalls = checkedInteger(
    options.maxProgressCalls ?? DEFAULT_RESTORE_PROGRESS_CALLS,
    1,
    MAX_RESTORE_PROGRESS_CALLS,
    "SQLite restore progress limit",
  );
  const maxElapsedMs = checkedInteger(
    options.maxElapsedMs ?? DEFAULT_RESTORE_ELAPSED_MS,
    1,
    MAX_RESTORE_ELAPSED_MS,
    "SQLite restore elapsed limit",
  );
  if (options.signal?.aborted === true) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "SQLite restore was cancelled before it began",
    );
  }
  let sourceRealPath: string;
  let parent: string;
  let sourceInputMetadata;
  try {
    sourceInputMetadata = await lstat(source, { bigint: true });
    if (!sourceInputMetadata.isFile() || sourceInputMetadata.isSymbolicLink()) {
      return invalid("SQLite restore source must be one regular non-symlink file");
    }
    sourceRealPath = await realpath(source);
    parent = await realpath(dirname(target));
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_PERMISSION_DENIED",
      "inspect-schema",
      "SQLite restore source or destination parent is unavailable",
    );
  }
  const publishedPath = join(parent, basename(target));
  if (publishedPath === sourceRealPath
      || await existingPathAliases(
        publishedPath,
        sourceRealPath,
        sourceInputMetadata.dev,
        sourceInputMetadata.ino,
      )) {
    return invalid("SQLite restore destination aliases its source");
  }
  if (await exists(publishedPath)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CONFLICT",
      "inspect-schema",
      "SQLite restore destination already exists",
    );
  }
  const sourceMetadata = await lstat(sourceRealPath);
  if (!sourceMetadata.isFile() || sourceMetadata.isSymbolicLink() || sourceMetadata.size < 1) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite restore source is invalid",
    );
  }
  const manifest = await readManifest(manifestInput);
  if (manifest.file.bytes !== sourceMetadata.size
      || await sha256File(sourceRealPath) !== manifest.file.sha256) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite backup content identity drifted",
    );
  }
  const sourceIntegrity = inspectSQLiteCycleStoreIntegrity(sourceRealPath, "semantic");
  assertManifestIntegrity(manifest, sourceIntegrity);

  const temporaryPath = join(
    parent,
    `.${basename(target)}.restore-${randomBytes(16).toString("hex")}.tmp`,
  );
  let sourceDatabase: DatabaseSync | undefined;
  let published = false;
  const startedAt = performance.now();
  let progressCalls = 0;
  try {
    sourceDatabase = new DatabaseSync(sourceRealPath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: true,
      timeout: 250,
    });
    sourceDatabase.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON");
    const pages = await sqliteBackup(sourceDatabase, temporaryPath, {
      rate: ratePages,
      progress: (_information: BackupProgressInfo) => {
        progressCalls += 1;
        if (progressCalls > maxProgressCalls
            || performance.now() - startedAt > maxElapsedMs
            || options.signal?.aborted === true) {
          throw new CycleStoreProviderError(
            "GE_CYCLE_STORE_UNAVAILABLE",
            "inspect-schema",
            "SQLite restore stopped at its bounded execution limit",
          );
        }
      },
    });
    sourceDatabase.close();
    sourceDatabase = undefined;
    const restoredIntegrity = inspectSQLiteCycleStoreIntegrity(temporaryPath, "semantic");
    assertManifestIntegrity(manifest, restoredIntegrity);
    if (await sha256File(sourceRealPath) !== manifest.file.sha256) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite backup changed during restore",
      );
    }
    await syncFile(temporaryPath);
    await link(temporaryPath, publishedPath);
    published = true;
    await syncDirectory(parent);
    const restoredMetadata = await stat(publishedPath);
    return Object.freeze({
      path: publishedPath,
      bytes: restoredMetadata.size,
      pages,
      progressCalls,
      sourceManifestSha256: manifest.manifestSha256,
      integrity: restoredIntegrity,
    });
  } catch (error) {
    if (published) await safeUnlink(publishedPath).catch(() => undefined);
    throw safeBackupError(error, "restore");
  } finally {
    if (sourceDatabase?.isOpen === true) sourceDatabase.close();
    await safeUnlink(temporaryPath).catch(() => undefined);
  }
}
