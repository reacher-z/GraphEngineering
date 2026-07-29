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
export type SQLiteTransactionMode = "deferred" | "immediate" | "exclusive" | "unknown";

/** Package-private, object-identity-stable token for one transaction lineage. */
export interface SQLiteConnectionTransactionLineage {
  readonly __sqliteConnectionTransactionLineage: never;
}

export interface SQLiteWalCheckpointReport {
  readonly mode: SQLiteWalCheckpointMode;
  readonly busy: 0;
  readonly logPages: number;
  readonly checkpointedPages: number;
}

/** Package-private, class-private-field-backed owner observation. */
export interface SQLiteConnectionOwnerSnapshot {
  readonly isTransaction: boolean;
  readonly transactionLineage: SQLiteConnectionTransactionLineage | null;
  readonly transactionEpoch: bigint;
  readonly transactionMode: SQLiteTransactionMode | null;
}

/** Package-private, base-intrinsic row-change observation. */
export interface SQLiteConnectionTotalChangesSnapshot {
  readonly totalChanges: number;
  readonly transactionEpoch: bigint;
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

function firstSQLiteToken(sql: string): string {
  let offset = 0;
  while (offset < sql.length) {
    if (sql[offset] === ";") {
      offset += 1;
      continue;
    }
    const whitespace = /^\s+/u.exec(sql.slice(offset));
    if (whitespace !== null) {
      offset += whitespace[0].length;
      continue;
    }
    if (sql.startsWith("--", offset)) {
      const newline = sql.indexOf("\n", offset + 2);
      if (newline < 0) return "";
      offset = newline + 1;
      continue;
    }
    if (sql.startsWith("/*", offset)) {
      const close = sql.indexOf("*/", offset + 2);
      if (close < 0) return "";
      offset = close + 2;
      continue;
    }
    break;
  }
  return /^[A-Za-z]+/u.exec(sql.slice(offset))?.[0]?.toUpperCase() ?? "";
}

function withoutEmptySQLitePrefix(sql: string): string {
  return sql.replace(
    /^(?:(?:\s|;)+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u,
    "",
  );
}

function beginTransactionMode(sql: string): SQLiteTransactionMode {
  const withoutPrefix = withoutEmptySQLitePrefix(sql).replace(
    /--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//gu,
    " ",
  );
  const match = /^BEGIN(?:\s+(DEFERRED|IMMEDIATE|EXCLUSIVE))?(?:\s+TRANSACTION)?\s*;?\s*$/iu
    .exec(withoutPrefix);
  if (match === null) return "unknown";
  const mode = match[1]?.toLowerCase();
  return mode === "immediate" || mode === "exclusive" ? mode : "deferred";
}

const PREPARED_OWNER_MUTATION_TOKENS = new Set([
  "ALTER", "ANALYZE", "ATTACH", "CREATE", "DETACH", "DROP", "PRAGMA",
  "REINDEX", "VACUUM",
]);

function preparedStatementMayMutateOwnerState(sql: string): boolean {
  return PREPARED_OWNER_MUTATION_TOKENS.has(firstSQLiteToken(sql));
}

function ownerControlMayReplaceTransaction(sql: string, token: string): boolean {
  if (token === "SAVEPOINT" || token === "RELEASE") return false;
  if (token === "ROLLBACK") {
    const normalized = withoutEmptySQLitePrefix(sql).replace(
      /--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\//gu,
      " ",
    );
    if (/^ROLLBACK(?:\s+TRANSACTION)?\s+TO(?:\s+SAVEPOINT)?\b/iu.test(normalized)) {
      return false;
    }
  }
  return ["BEGIN", "COMMIT", "END", "ROLLBACK"].includes(token);
}

function isForbiddenTempDirectoryPragma(sql: string): boolean {
  const withoutPrefix = withoutEmptySQLitePrefix(sql);
  // Reject every schema qualifier, quoted spelling, and multi-statement route.
  // False positives inside a trusted PRAGMA value are acceptable because this
  // deprecated global-directory control is never needed by the provider.
  return /\bPRAGMA\b[\s\S]*\btemp_store_directory\b/iu.test(withoutPrefix);
}

function mayContainAdditionalStatement(sql: string): boolean {
  const withoutPrefix = withoutEmptySQLitePrefix(sql).trimEnd();
  const withoutOneTerminator = withoutPrefix.endsWith(";")
    ? withoutPrefix.slice(0, -1).trimEnd()
    : withoutPrefix;
  // This is intentionally conservative: a semicolon in a quoted literal may
  // discard an EXCLUSIVE proof, but can never create one. Trusted DDL needed
  // during reconciliation is issued as one statement at a time.
  return withoutOneTerminator.includes(";");
}

function containsOwnerTransactionControl(sql: string): boolean {
  const controls = new Set(["BEGIN", "COMMIT", "END", "ROLLBACK"]);
  let index = 0;
  let atStatementStart = true;
  let createPrefix = false;
  let inTrigger = false;
  let triggerCaseDepth = 0;
  let triggerEndPending = false;
  let lastWord = "";
  while (index < sql.length) {
    const current = sql[index]!;
    const next = sql[index + 1];
    if (current === "-" && next === "-") {
      const newline = sql.indexOf("\n", index + 2);
      index = newline < 0 ? sql.length : newline + 1;
      continue;
    }
    if (current === "/" && next === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close < 0 ? sql.length : close + 2;
      continue;
    }
    if (current === "'" || current === '"' || current === "`" || current === "[") {
      const close = current === "[" ? "]" : current;
      index += 1;
      while (index < sql.length) {
        if (sql[index] !== close) {
          index += 1;
          continue;
        }
        if (close !== "]" && sql[index + 1] === close) {
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      continue;
    }
    if (/[A-Za-z]/u.test(current)) {
      const word = /^[A-Za-z]+/u.exec(sql.slice(index))![0]!.toUpperCase();
      if (inTrigger) {
        if (word === "CASE") {
          triggerCaseDepth += 1;
          triggerEndPending = false;
        } else if (word === "END" && triggerCaseDepth > 0) {
          triggerCaseDepth -= 1;
          triggerEndPending = false;
        } else {
          triggerEndPending = word === "END";
        }
        lastWord = word;
      } else if (atStatementStart) {
        if (controls.has(word)) return true;
        atStatementStart = false;
        createPrefix = word === "CREATE";
        lastWord = word;
      } else if (createPrefix) {
        if (word === "TRIGGER") {
          inTrigger = true;
        } else if (word !== "TEMP" && word !== "TEMPORARY") {
          createPrefix = false;
        }
        lastWord = word;
      } else {
        lastWord = word;
      }
      index += word.length;
      continue;
    }
    if (current === ";") {
      if (!inTrigger || (lastWord === "END" && triggerEndPending)) {
        inTrigger = false;
        triggerCaseDepth = 0;
        triggerEndPending = false;
        atStatementStart = true;
        createPrefix = false;
      }
      lastWord = "";
    }
    index += 1;
  }
  return false;
}

const SQLITE_CONNECTION_OWNER_SNAPSHOT = Symbol("SQLiteConnection.ownerSnapshot");
const SQLITE_CONNECTION_TOTAL_CHANGES_SNAPSHOT = Symbol(
  "SQLiteConnection.totalChangesSnapshot",
);

/** One hardened, synchronous, file-backed SQLite connection. */
export class SQLiteConnection {
  readonly #database: DatabaseSync;
  readonly #path: string;
  readonly #busyTimeoutMs: number;
  readonly #maxBusyAttempts: number;
  readonly #maxBusyElapsedMs: number;
  #closed = false;
  #transactionLineage: SQLiteConnectionTransactionLineage | null = null;
  #transactionEpoch = 0n;
  #transactionMode: SQLiteTransactionMode | null = null;

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

  [SQLITE_CONNECTION_OWNER_SNAPSHOT](): SQLiteConnectionOwnerSnapshot {
    const epochBefore = this.#transactionEpoch;
    const lineageBefore = this.#transactionLineage;
    const transactionBefore = this.#database.isTransaction;
    const open = !this.#closed && this.#database.isOpen;
    const mode = transactionBefore ? (this.#transactionMode ?? "unknown") : null;
    const transactionAfter = this.#database.isTransaction;
    const epochAfter = this.#transactionEpoch;
    const lineageAfter = this.#transactionLineage;
    if (!open) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        "inspect-schema",
        "SQLite provider is closed",
      );
    }
    if (epochBefore !== epochAfter || lineageBefore !== lineageAfter
        || transactionBefore !== transactionAfter
        || (transactionAfter && lineageAfter === null)
        || (!transactionAfter && lineageAfter !== null)) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite owner state changed during its private snapshot",
      );
    }
    return Object.freeze({
      isTransaction: transactionAfter,
      transactionLineage: lineageAfter,
      transactionEpoch: epochAfter,
      transactionMode: mode,
    });
  }

  [SQLITE_CONNECTION_TOTAL_CHANGES_SNAPSHOT](): SQLiteConnectionTotalChangesSnapshot {
    const epochBefore = this.#transactionEpoch;
    const transactionBefore = this.#database.isTransaction;
    if (this.#closed || !this.#database.isOpen) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        "inspect-schema",
        "SQLite provider is closed",
      );
    }
    const read = (): number => sqliteSafeInteger(
      sqliteRow(
        hardenSQLiteStatement(this.#database.prepare("SELECT total_changes()")).get(),
        1,
        "inspect-schema",
        "private SQLite change counter",
      )[0],
      0,
      Number.MAX_SAFE_INTEGER,
      "inspect-schema",
      "private SQLite change counter",
    );
    const before = read();
    const after = read();
    const transactionAfter = this.#database.isTransaction;
    const epochAfter = this.#transactionEpoch;
    if (before !== after
        || epochBefore !== epochAfter
        || transactionBefore !== transactionAfter) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite change counter changed during its private snapshot",
      );
    }
    return Object.freeze({
      totalChanges: after,
      transactionEpoch: epochAfter,
    });
  }

  get isTransaction(): boolean {
    this.#assertOpen("inspect-schema");
    return this.#database.isTransaction;
  }

  /** Monotonic owner-observed transaction/control boundary generation. */
  get transactionEpoch(): bigint {
    this.#assertOpen("inspect-schema");
    return this.#transactionEpoch;
  }

  /** Object-identity-stable lineage for the current transaction generation. */
  get transactionLineage(): SQLiteConnectionTransactionLineage | null {
    this.#assertOpen("inspect-schema");
    return this.#database.isTransaction ? this.#transactionLineage : null;
  }

  /** Owner-observed mode for the active transaction, or null in autocommit. */
  get transactionMode(): SQLiteTransactionMode | null {
    this.#assertOpen("inspect-schema");
    if (!this.#database.isTransaction) return null;
    return this.#transactionMode ?? "unknown";
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
    if (isForbiddenTempDirectoryPragma(sql)) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        operation,
        "SQLite temp_store_directory is forbidden",
      );
    }
    if (["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"].includes(
      firstSQLiteToken(sql),
    )) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        operation,
        "SQLite transaction control must use the connection owner",
      );
    }
    try {
      const statement = hardenSQLiteStatement(this.#database.prepare(sql));
      return preparedStatementMayMutateOwnerState(sql)
        ? this.#epochTrackedStatement(statement)
        : statement;
    } catch (error) {
      throw translateSQLiteError(error, operation);
    }
  }

  #epochTrackedStatement(statement: StatementSync): StatementSync {
    const executionMethods = new Set<PropertyKey>(["all", "get", "iterate", "run"]);
    return new Proxy(statement, {
      get: (target, property) => {
        const value = Reflect.get(target, property, target) as unknown;
        if (typeof value !== "function") return value;
        if (!executionMethods.has(property)) return value.bind(target) as unknown;
        return (...parameters: unknown[]): unknown => {
          this.#transactionEpoch += 1n;
          return Reflect.apply(value, target, parameters);
        };
      },
    }) as StatementSync;
  }

  execTrusted(sql: string, operation: CycleStoreProviderOperation): void {
    this.#assertOpen(operation);
    if (isForbiddenTempDirectoryPragma(sql)) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        operation,
        "SQLite temp_store_directory is forbidden",
      );
    }
    const before = this.#database.isTransaction;
    const token = firstSQLiteToken(sql);
    const mayReplaceLineage = ownerControlMayReplaceTransaction(sql, token)
      || (mayContainAdditionalStatement(sql) && containsOwnerTransactionControl(sql));
    this.#transactionEpoch += 1n;
    try {
      this.#database.exec(sql);
    } catch (error) {
      const afterFailure = this.#database.isTransaction;
      if ((!before && afterFailure) || (before && afterFailure && mayReplaceLineage)) {
        this.#transactionLineage = Object.freeze(
          Object.create(null),
        ) as SQLiteConnectionTransactionLineage;
      } else if (!afterFailure) {
        this.#transactionLineage = null;
      }
      this.#transactionMode = afterFailure ? "unknown" : null;
      throw translateSQLiteError(error, operation);
    }
    const after = this.#database.isTransaction;
    if ((!before && after) || (before && after && mayReplaceLineage)) {
      this.#transactionLineage = Object.freeze(
        Object.create(null),
      ) as SQLiteConnectionTransactionLineage;
    } else if (!after) {
      this.#transactionLineage = null;
    }
    if (!after) {
      this.#transactionMode = null;
    } else if (!before) {
      this.#transactionMode = token === "BEGIN" ? beginTransactionMode(sql) : "unknown";
    } else if (mayReplaceLineage) {
      // A trusted script may end one transaction and open another while both
      // the pre/post states are `isTransaction=true`. Never carry the old mode
      // proof across that ambiguous generation boundary.
      this.#transactionMode = "unknown";
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
        this.#transactionEpoch += 1n;
        this.#transactionLineage = Object.freeze(
          Object.create(null),
        ) as SQLiteConnectionTransactionLineage;
        this.#transactionMode = "immediate";
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
        this.#transactionEpoch += 1n;
        this.#transactionLineage = null;
        this.#transactionMode = null;
        return result;
      } catch (error) {
        if (this.#database.isTransaction) {
          try {
            this.#database.exec("ROLLBACK");
            this.#transactionEpoch += 1n;
            this.#transactionLineage = null;
            this.#transactionMode = null;
          } catch {
            // The original safe error remains authoritative. A subsequent use
            // will fail its invariant checks if rollback did not restore state.
            this.#transactionMode = "unknown";
          }
        } else {
          // COMMIT may have completed before a lower-level error surfaced. Do
          // not retain an owner proof once SQLite has returned to autocommit.
          this.#transactionLineage = null;
          this.#transactionMode = null;
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
    this.#transactionLineage = null;
    this.#transactionMode = null;
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

const sqliteConnectionOwnerSnapshotIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_OWNER_SNAPSHOT];
const sqliteConnectionTotalChangesSnapshotIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_TOTAL_CHANGES_SNAPSHOT];
const sqliteConnectionExecTrustedIntrinsic = SQLiteConnection.prototype.execTrusted;
const sqliteConnectionPrepareIntrinsic = SQLiteConnection.prototype.prepare;

/**
 * Read exact owner state through the captured base-class intrinsic.
 * Subclass accessors and prototype replacement cannot intercept this call.
 */
export function readSQLiteConnectionOwnerSnapshot(
  connection: SQLiteConnection,
): SQLiteConnectionOwnerSnapshot {
  return Reflect.apply(sqliteConnectionOwnerSnapshotIntrinsic, connection, []);
}

/** Read the real counter without subclass `prepare` or getter interposition. */
export function readSQLiteConnectionTotalChangesSnapshot(
  connection: SQLiteConnection,
): SQLiteConnectionTotalChangesSnapshot {
  return Reflect.apply(sqliteConnectionTotalChangesSnapshotIntrinsic, connection, []);
}

/** Execute one fixed package-owned statement through the captured base intrinsic. */
export function execSQLiteConnectionTrustedIntrinsic(
  connection: SQLiteConnection,
  sql: string,
  operation: CycleStoreProviderOperation,
): void {
  Reflect.apply(sqliteConnectionExecTrustedIntrinsic, connection, [sql, operation]);
}

/** Prepare one fixed package-owned statement through the captured base intrinsic. */
export function prepareSQLiteConnectionIntrinsic(
  connection: SQLiteConnection,
  sql: string,
  operation: CycleStoreProviderOperation,
): StatementSync {
  return Reflect.apply(sqliteConnectionPrepareIntrinsic, connection, [sql, operation]);
}
