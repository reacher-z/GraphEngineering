import {
  DatabaseSync,
  backup,
  type BackupProgressInfo,
  type StatementSync,
} from "node:sqlite";
import { performance } from "node:perf_hooks";

import {
  CycleStoreProviderError,
  type CycleStoreProviderOperation,
} from "@graph-engineering/runtime";

import {
  hardenSQLiteStatement,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "./sqlite-codec.js";
import { isRetryableSQLiteLockError, translateSQLiteError } from "./sqlite-errors.js";

export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 250;
export const MAX_SQLITE_BUSY_TIMEOUT_MS = 5_000;
export const DEFAULT_SQLITE_BUSY_ATTEMPTS = 3;
export const MAX_SQLITE_BUSY_ATTEMPTS = 8;
export const DEFAULT_SQLITE_BUSY_ELAPSED_MS = 1_500;
export const MAX_SQLITE_BUSY_ELAPSED_MS = 30_000;
export const SQLITE_WAL_AUTOCHECKPOINT_PAGES = 1_000;
export const MINIMUM_SQLITE_VERSION = Object.freeze([3, 37, 0] as const);

export interface SQLiteConnectionOptions {
  readonly busyTimeoutMs?: number;
  readonly maxBusyAttempts?: number;
  readonly maxBusyElapsedMs?: number;
}

export type SQLiteWalCheckpointMode = "PASSIVE" | "FULL" | "RESTART" | "TRUNCATE";

export interface SQLiteWalCheckpointReport {
  readonly mode: SQLiteWalCheckpointMode;
  readonly busy: 0;
  readonly logPages: number;
  readonly checkpointedPages: number;
}

function invalid(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    "inspect-schema",
    message,
  );
}

function checkedPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return invalid("SQLite database path is invalid");
  }
  if (value === ":memory:" || value.startsWith("file::memory:")) {
    return invalid("durable SQLite provider requires a file-backed database");
  }
  return value;
}

function checkedBusyTimeout(value: unknown): number {
  if (!Number.isSafeInteger(value)
      || (value as number) < 0
      || (value as number) > MAX_SQLITE_BUSY_TIMEOUT_MS) {
    return invalid("SQLite busy timeout is outside bounds");
  }
  return value as number;
}

function checkedIntegerOption(
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

function versionParts(value: string): readonly [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:\D.*)?$/u.exec(value);
  if (match === null) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
      "inspect-schema",
      "SQLite runtime version is unsupported",
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(
  actual: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean {
  for (let index = 0; index < actual.length; index += 1) {
    const actualPart = actual[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (actualPart > minimumPart) return true;
    if (actualPart < minimumPart) return false;
  }
  return true;
}

/** One hardened, synchronous, file-backed SQLite connection. */
export class SQLiteConnection {
  readonly #database: DatabaseSync;
  readonly #path: string;
  readonly #busyTimeoutMs: number;
  readonly #maxBusyAttempts: number;
  readonly #maxBusyElapsedMs: number;
  #closed = false;

  constructor(path: string, options: SQLiteConnectionOptions = {}) {
    this.#path = checkedPath(path);
    this.#busyTimeoutMs = checkedBusyTimeout(
      options.busyTimeoutMs ?? DEFAULT_SQLITE_BUSY_TIMEOUT_MS,
    );
    this.#maxBusyAttempts = checkedIntegerOption(
      options.maxBusyAttempts ?? DEFAULT_SQLITE_BUSY_ATTEMPTS,
      1,
      MAX_SQLITE_BUSY_ATTEMPTS,
      "SQLite busy attempt limit",
    );
    this.#maxBusyElapsedMs = checkedIntegerOption(
      options.maxBusyElapsedMs ?? DEFAULT_SQLITE_BUSY_ELAPSED_MS,
      0,
      MAX_SQLITE_BUSY_ELAPSED_MS,
      "SQLite busy elapsed limit",
    );
    if (this.#busyTimeoutMs * this.#maxBusyAttempts > this.#maxBusyElapsedMs) {
      invalid("SQLite busy retry policy exceeds its elapsed-time bound");
    }

    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(this.#path, {
        allowExtension: false,
        enableDoubleQuotedStringLiterals: false,
        enableForeignKeyConstraints: true,
        open: true,
        readOnly: false,
        timeout: this.#busyTimeoutMs,
      });
      this.#database = database;
      this.#configure();
    } catch (error) {
      if (database?.isOpen === true) database.close();
      throw translateSQLiteError(error, "inspect-schema");
    }
  }

  get path(): string {
    return this.#path;
  }

  get busyTimeoutMs(): number {
    return this.#busyTimeoutMs;
  }

  get maxBusyAttempts(): number {
    return this.#maxBusyAttempts;
  }

  get maxBusyElapsedMs(): number {
    return this.#maxBusyElapsedMs;
  }

  get isOpen(): boolean {
    return !this.#closed && this.#database.isOpen;
  }

  get isTransaction(): boolean {
    this.#assertOpen("inspect-schema");
    return this.#database.isTransaction;
  }

  get location(): string {
    this.#assertOpen("inspect-schema");
    const location = this.#database.location();
    if (location === null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite provider unexpectedly opened a non-file database",
      );
    }
    return location;
  }

  async onlineBackupTo(
    path: string,
    rate: number,
    progress: (information: BackupProgressInfo) => void,
  ): Promise<number> {
    this.#assertOpen("inspect-schema");
    if (this.#database.isTransaction) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INTERNAL",
        "inspect-schema",
        "SQLite backup cannot begin inside a transaction",
      );
    }
    try {
      return await backup(this.#database, path, { rate, progress });
    } catch (error) {
      throw translateSQLiteError(error, "inspect-schema");
    }
  }

  /**
   * Runs one fixed-mode WAL checkpoint and treats a returned busy status as a
   * failed operation. SQLite may return a status row without throwing.
   */
  checkpointWal(mode: SQLiteWalCheckpointMode): SQLiteWalCheckpointReport {
    this.#assertOpen("inspect-schema");
    if (!["PASSIVE", "FULL", "RESTART", "TRUNCATE"].includes(mode)) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite WAL checkpoint mode is invalid",
      );
    }
    const row = sqliteRow(
      this.prepare(`PRAGMA wal_checkpoint(${mode})`, "inspect-schema").get(),
      3,
      "inspect-schema",
      "WAL checkpoint status",
    );
    const busy = sqliteSafeInteger(row[0], 0, 1, "inspect-schema", "WAL checkpoint busy status");
    const logPages = sqliteSafeInteger(
      row[1],
      0,
      Number.MAX_SAFE_INTEGER,
      "inspect-schema",
      "WAL checkpoint log pages",
    );
    const checkpointedPages = sqliteSafeInteger(
      row[2],
      0,
      Number.MAX_SAFE_INTEGER,
      "inspect-schema",
      "WAL checkpoint completed pages",
    );
    if (busy !== 0) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        "inspect-schema",
        "SQLite WAL checkpoint could not complete within the current lock state",
        { mode, retryClass: "busy" },
      );
    }
    return Object.freeze({ mode, busy: 0, logPages, checkpointedPages });
  }

  prepare(sql: string, operation: CycleStoreProviderOperation): StatementSync {
    this.#assertOpen(operation);
    try {
      return hardenSQLiteStatement(this.#database.prepare(sql));
    } catch (error) {
      throw translateSQLiteError(error, operation);
    }
  }

  execTrusted(sql: string, operation: CycleStoreProviderOperation): void {
    this.#assertOpen(operation);
    try {
      this.#database.exec(sql);
    } catch (error) {
      throw translateSQLiteError(error, operation);
    }
  }

  immediate<T>(
    operation: CycleStoreProviderOperation,
    action: () => T,
  ): T {
    this.#assertOpen(operation);
    if (this.#database.isTransaction) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INTERNAL",
        operation,
        "nested SQLite provider transaction is forbidden",
      );
    }
    const startedAt = performance.now();
    for (let attempt = 1; attempt <= this.#maxBusyAttempts; attempt += 1) {
      try {
        this.#database.exec("BEGIN IMMEDIATE");
        const result = action();
        if ((typeof result === "object" && result !== null && "then" in result)
            || (typeof result === "function" && "then" in result)) {
          throw new CycleStoreProviderError(
            "GE_CYCLE_STORE_INTERNAL",
            operation,
            "SQLite transaction action must be synchronous",
          );
        }
        this.#database.exec("COMMIT");
        return result;
      } catch (error) {
        if (this.#database.isTransaction) {
          try {
            this.#database.exec("ROLLBACK");
          } catch {
            // The original safe error remains authoritative. A subsequent use
            // will fail its invariant checks if rollback did not restore state.
          }
        }
        if (isRetryableSQLiteLockError(error)
            && attempt < this.#maxBusyAttempts
            && performance.now() - startedAt < this.#maxBusyElapsedMs) {
          continue;
        }
        if (isRetryableSQLiteLockError(error)) {
          throw new CycleStoreProviderError(
            "GE_CYCLE_STORE_UNAVAILABLE",
            operation,
            "SQLite writer lock retry budget was exhausted",
            { attempts: attempt },
          );
        }
        throw translateSQLiteError(error, operation);
      }
    }
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INTERNAL",
      operation,
      "SQLite transaction retry invariant failed",
    );
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#database.isOpen) this.#database.close();
  }

  #assertOpen(operation: CycleStoreProviderOperation): void {
    if (this.#closed || !this.#database.isOpen) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        operation,
        "SQLite provider is closed",
      );
    }
  }

  #pragmaValue(name: string): unknown {
    // Every name is a source literal controlled by this class. Callers cannot
    // pass a PRAGMA identifier or arbitrary SQL through this helper.
    const row = sqliteRow(
      hardenSQLiteStatement(this.#database.prepare(`PRAGMA ${name}`)).get(),
      1,
      "inspect-schema",
      `PRAGMA ${name}`,
    );
    return row[0];
  }

  #configure(): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA synchronous = FULL;
      PRAGMA wal_autocheckpoint = ${SQLITE_WAL_AUTOCHECKPOINT_PAGES};
      PRAGMA writable_schema = OFF;
    `);

    const journalMode = sqliteText(
      sqliteRow(
        hardenSQLiteStatement(this.#database.prepare("PRAGMA journal_mode = WAL")).get(),
        1,
        "inspect-schema",
        "journal mode",
      )[0],
      "inspect-schema",
      "journal mode",
    );
    const sqliteVersion = sqliteText(
      sqliteRow(
        hardenSQLiteStatement(this.#database.prepare("SELECT sqlite_version()" )).get(),
        1,
        "inspect-schema",
        "SQLite version",
      )[0],
      "inspect-schema",
      "SQLite version",
    );
    if (!versionAtLeast(versionParts(sqliteVersion), MINIMUM_SQLITE_VERSION)) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
        "inspect-schema",
        "SQLite runtime version is below 3.37.0",
      );
    }

    const expectedIntegers = [
      ["foreign_keys", 1],
      ["trusted_schema", 0],
      ["synchronous", 2],
      ["wal_autocheckpoint", SQLITE_WAL_AUTOCHECKPOINT_PAGES],
      ["busy_timeout", this.#busyTimeoutMs],
      ["writable_schema", 0],
      ["query_only", 0],
    ] as const;
    for (const [name, expected] of expectedIntegers) {
      const actual = sqliteSafeInteger(
        this.#pragmaValue(name),
        0,
        Number.MAX_SAFE_INTEGER,
        "inspect-schema",
        `PRAGMA ${name}`,
      );
      if (actual !== expected) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_UNAVAILABLE",
          "inspect-schema",
          "required SQLite connection setting was not established",
          { setting: name },
        );
      }
    }
    if (journalMode.toLowerCase() !== "wal") {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        "inspect-schema",
        "SQLite WAL journal mode was not established",
      );
    }
  }
}
