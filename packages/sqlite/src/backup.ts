import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  link,
  lstat,
  open,
  realpath,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import { inspectSQLitePhysicalIntegrity } from "./integrity.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

const DEFAULT_BACKUP_RATE_PAGES = 128;
const MAX_BACKUP_RATE_PAGES = 4_096;
const DEFAULT_BACKUP_PROGRESS_CALLS = 100_000;
const MAX_BACKUP_PROGRESS_CALLS = 1_000_000;
const DEFAULT_BACKUP_ELAPSED_MS = 300_000;
const MAX_BACKUP_ELAPSED_MS = 1_800_000;

export interface SQLitePhysicalBackupOptions {
  readonly ratePages?: number;
  readonly maxProgressCalls?: number;
  readonly maxElapsedMs?: number;
  readonly signal?: AbortSignal;
}

export interface SQLitePhysicalBackupReport {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly pages: number;
  readonly progressCalls: number;
  readonly integrity: {
    readonly quickCheck: "ok";
    readonly integrityCheck: "ok";
    readonly foreignKeyViolations: 0;
    readonly sqliteVersion: string;
  };
}

function invalid(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    "inspect-schema",
    message,
  );
}

function safeBackupError(error: unknown): CycleStoreProviderError {
  try {
    if (error instanceof CycleStoreProviderError) return error;
  } catch {
    // Treat hostile error-like values as an unknown internal failure.
  }
  let nativeCode: unknown;
  try {
    nativeCode = (error as NodeJS.ErrnoException).code;
  } catch {
    nativeCode = undefined;
  }
  if (nativeCode === "ENOSPC" || nativeCode === "EDQUOT" || nativeCode === "EFBIG") {
    return new CycleStoreProviderError(
      "GE_CYCLE_STORE_QUOTA_EXCEEDED",
      "inspect-schema",
      "SQLite backup storage quota was exceeded",
    );
  }
  if (nativeCode === "EACCES" || nativeCode === "EPERM" || nativeCode === "EROFS") {
    return new CycleStoreProviderError(
      "GE_CYCLE_STORE_PERMISSION_DENIED",
      "inspect-schema",
      "SQLite backup filesystem access was denied",
    );
  }
  return new CycleStoreProviderError(
    "GE_CYCLE_STORE_INTERNAL",
    "inspect-schema",
    "SQLite backup failed safely",
  );
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

async function targetExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_PERMISSION_DENIED",
      "inspect-schema",
      "SQLite backup destination cannot be inspected",
    );
  }
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
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
    // Windows does not provide POSIX directory fsync. Only known platform
    // limitations are tolerated; all other publication failures stay closed.
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== "win32" || (code !== "EISDIR" && code !== "EPERM")) throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Creates, physically verifies, syncs, and atomically publishes a SQLite
 * online backup without overwriting an existing destination.
 *
 * The CycleStore semantic audit and content-addressed sidecar manifest are a
 * higher layer; this primitive deliberately cannot claim them.
 */
export async function createSQLitePhysicalBackup(
  source: SQLiteConnection,
  destination: string,
  options: SQLitePhysicalBackupOptions = {},
): Promise<SQLitePhysicalBackupReport> {
  if (typeof destination !== "string" || destination.length === 0 || destination.includes("\0")) {
    return invalid("SQLite backup destination is invalid");
  }
  const ratePages = checkedInteger(
    options.ratePages ?? DEFAULT_BACKUP_RATE_PAGES,
    1,
    MAX_BACKUP_RATE_PAGES,
    "SQLite backup page rate",
  );
  const maxProgressCalls = checkedInteger(
    options.maxProgressCalls ?? DEFAULT_BACKUP_PROGRESS_CALLS,
    1,
    MAX_BACKUP_PROGRESS_CALLS,
    "SQLite backup progress limit",
  );
  const maxElapsedMs = checkedInteger(
    options.maxElapsedMs ?? DEFAULT_BACKUP_ELAPSED_MS,
    1,
    MAX_BACKUP_ELAPSED_MS,
    "SQLite backup elapsed limit",
  );
  if (options.signal?.aborted === true) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "SQLite backup was cancelled before it began",
    );
  }

  let parent: string;
  let sourcePath: string;
  try {
    parent = await realpath(dirname(destination));
    sourcePath = await realpath(source.location);
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_PERMISSION_DENIED",
      "inspect-schema",
      "SQLite backup source or destination parent is unavailable",
    );
  }
  const publishedPath = join(parent, basename(destination));
  if (publishedPath === sourcePath) return invalid("SQLite backup cannot overwrite its source");
  if (await targetExists(publishedPath)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CONFLICT",
      "inspect-schema",
      "SQLite backup destination already exists",
    );
  }

  const temporaryPath = join(
    parent,
    `.${basename(destination)}.graph-engineering-${randomBytes(16).toString("hex")}.tmp`,
  );
  const startedAt = performance.now();
  let progressCalls = 0;
  let published = false;
  try {
    const pages = await source.onlineBackupTo(temporaryPath, ratePages, () => {
      progressCalls += 1;
      if (progressCalls > maxProgressCalls
          || performance.now() - startedAt > maxElapsedMs
          || options.signal?.aborted === true) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_UNAVAILABLE",
          "inspect-schema",
          "SQLite backup stopped at its bounded execution limit",
        );
      }
    });
    const integrity = inspectSQLitePhysicalIntegrity(temporaryPath);
    const [file, sha256] = await Promise.all([
      stat(temporaryPath),
      sha256File(temporaryPath),
    ]);
    if (!file.isFile() || file.size < 1 || !Number.isSafeInteger(file.size)) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite backup file metadata is invalid",
      );
    }
    await syncFile(temporaryPath);
    try {
      await link(temporaryPath, publishedPath);
      published = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CONFLICT",
          "inspect-schema",
          "SQLite backup destination appeared during publication",
        );
      }
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_PERMISSION_DENIED",
        "inspect-schema",
        "SQLite backup could not be published",
      );
    }
    await syncDirectory(parent);
    return Object.freeze({
      path: publishedPath,
      sha256,
      bytes: file.size,
      pages,
      progressCalls,
      integrity,
    });
  } catch (error) {
    throw safeBackupError(error);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !published) {
        throw safeBackupError(error);
      }
    }
  }
}
