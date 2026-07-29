import {
  DatabaseSync,
  StatementSync,
  backup,
  type BackupProgressInfo,
} from "node:sqlite";
import { performance } from "node:perf_hooks";
import { isProxy } from "node:util/types";

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
import {
  readSQLiteCursorMigration0002AssetSnapshotIntrinsic,
  type SQLiteCursorMigration0002Asset,
  type SQLiteCursorMigration0002AssetSnapshot,
} from "./cursor-publication-migration-0002-asset.js";

const databasePrepareIntrinsic = DatabaseSync.prototype.prepare;
const databaseCloseIntrinsic = DatabaseSync.prototype.close;
const reflectApplyIntrinsic = Reflect.apply;
const objectFreezeIntrinsic = Object.freeze;
const objectCreateIntrinsic = Object.create;
const objectGetOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOfIntrinsic = Object.getPrototypeOf;
const functionToStringIntrinsic = Function.prototype.toString;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const statementGetIntrinsic = StatementSync.prototype.get;
const statementIterateIntrinsic = StatementSync.prototype.iterate;
const statementRunIntrinsic = StatementSync.prototype.run;
const statementSetAllowBareNamedParametersIntrinsic =
  StatementSync.prototype.setAllowBareNamedParameters;
const statementSetAllowUnknownNamedParametersIntrinsic =
  StatementSync.prototype.setAllowUnknownNamedParameters;
const statementSetReadBigIntsIntrinsic = StatementSync.prototype.setReadBigInts;
const statementSetReturnArraysIntrinsic = StatementSync.prototype.setReturnArrays;

function hardenSQLiteNativeStatementIntrinsic(statement: StatementSync): StatementSync {
  reflectApplyIntrinsic(statementSetAllowBareNamedParametersIntrinsic, statement, [false]);
  reflectApplyIntrinsic(statementSetAllowUnknownNamedParametersIntrinsic, statement, [false]);
  reflectApplyIntrinsic(statementSetReadBigIntsIntrinsic, statement, [true]);
  reflectApplyIntrinsic(statementSetReturnArraysIntrinsic, statement, [true]);
  return statement;
}

export interface SQLiteNativeStatementIterator {
  next(): IteratorResult<unknown>;
  return(): IteratorResult<unknown>;
}

function checkedSQLiteNativeIteratorMethod(
  value: unknown,
  label: string,
): (...parameters: readonly unknown[]) => unknown {
  if (typeof value !== "function" || isProxy(value)) {
    throw new Error(`SQLite statement iterator ${label} intrinsic is unavailable`);
  }
  const source = reflectApplyIntrinsic(functionToStringIntrinsic, value, []) as string;
  if (source !== `function ${label}() { [native code] }`) {
    throw new Error(`SQLite statement iterator ${label} intrinsic is not native`);
  }
  return value as (...parameters: readonly unknown[]) => unknown;
}

function captureSQLiteNativeStatementIteratorIntrinsics(
  database: DatabaseSync,
): Readonly<{
  next: SQLiteNativeStatementIterator["next"];
  return: SQLiteNativeStatementIterator["return"];
}> {
  let iterator: SQLiteNativeStatementIterator | undefined;
  let capturedReturn: SQLiteNativeStatementIterator["return"] | undefined;
  try {
    const statement = reflectApplyIntrinsic(
      databasePrepareIntrinsic, database, ["SELECT 1"],
    ) as StatementSync;
    iterator = reflectApplyIntrinsic(statementIterateIntrinsic, statement, []) as
      SQLiteNativeStatementIterator;
    let next: unknown;
    let returnMethod: unknown;
    let current: object | null = objectGetPrototypeOfIntrinsic(iterator) as object | null;
    while (current !== null && (next === undefined || returnMethod === undefined)) {
      const nextDescriptor = reflectApplyIntrinsic(
        objectGetOwnPropertyDescriptorIntrinsic, Object, [current, "next"],
      ) as PropertyDescriptor | undefined;
      const returnDescriptor = reflectApplyIntrinsic(
        objectGetOwnPropertyDescriptorIntrinsic, Object, [current, "return"],
      ) as PropertyDescriptor | undefined;
      if (next === undefined && nextDescriptor !== undefined && "value" in nextDescriptor) {
        next = nextDescriptor.value;
      }
      if (returnMethod === undefined && returnDescriptor !== undefined
          && "value" in returnDescriptor) {
        returnMethod = returnDescriptor.value;
      }
      current = objectGetPrototypeOfIntrinsic(current) as object | null;
    }
    const checkedNext = checkedSQLiteNativeIteratorMethod(next, "next");
    capturedReturn = checkedSQLiteNativeIteratorMethod(
      returnMethod, "return",
    ) as SQLiteNativeStatementIterator["return"];
    const first = reflectApplyIntrinsic(checkedNext, iterator, []) as
      Readonly<{ done?: unknown }>;
    const terminal = reflectApplyIntrinsic(checkedNext, iterator, []) as
      Readonly<{ done?: unknown }>;
    if (first === null || typeof first !== "object" || first.done !== false
        || terminal === null || typeof terminal !== "object" || terminal.done !== true) {
      throw new Error("SQLite statement iterator next intrinsic failed its native probe");
    }
    return objectFreezeIntrinsic({
      next: checkedNext as SQLiteNativeStatementIterator["next"],
      return: capturedReturn,
    });
  } finally {
    if (iterator !== undefined && capturedReturn !== undefined) {
      reflectApplyIntrinsic(capturedReturn, iterator, []);
    }
  }
}

let sqliteNativeStatementIteratorIntrinsics: ReturnType<
  typeof captureSQLiteNativeStatementIteratorIntrinsics
> | undefined;

export const SQLITE_CURSOR_PUBLICATION_CATALOG_NATIVE_QUERY_INTRINSIC =
  "SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL ORDER BY type COLLATE BINARY, name COLLATE BINARY" as const;
export const SQLITE_CURSOR_PUBLICATION_METADATA_NATIVE_QUERY_INTRINSIC =
  "SELECT application_id, user_version FROM main.pragma_application_id(), main.pragma_user_version()" as const;
export const SQLITE_CURSOR_MIGRATION_0002_TEMP_CONFLICT_QUERY_INTRINSIC =
  "SELECT count(*) FROM temp.sqlite_schema WHERE lower(name) IN ("
  + "'ge_cycle_schema','ge_cycle_schema_v1','ge_cycle_operations',"
  + "'ge_cycle_operations_v1','ge_cycle_operations_commit_idx',"
  + "'ge_cycle_operations_sequence_uq','ge_cycle_operations_replay_idx',"
  + "'ge_cycle_operation_baselines','ge_cycle_operation_baseline_entries',"
  + "'ge_cycle_operation_baseline_entries_key_uq',"
  + "'ge_cycle_operation_baseline_entries_hash_uq','ge_cycle_operation_sequence')";
export type SQLiteConnectionNativeReadKind =
  | "cursor-publication-target-catalog"
  | "cursor-publication-target-metadata"
  | "cursor-publication-migration-0002-temp-conflicts";

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

/** Opaque, connection-owned sequential execution session for migration 0002. */
export interface SQLiteConnectionMigration0002Execution {
  readonly __sqliteConnectionMigration0002Execution: never;
}

export interface SQLiteConnectionMigration0002StepSnapshot {
  readonly affectedRowsDelta: number;
  readonly completedStatementCount: number;
  readonly fixedStatementOrdinal: number;
  readonly preparedStatementCount: number;
  readonly totalChanges: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

export interface SQLiteConnectionMigration0002ExecutionSnapshot {
  readonly affectedRows: number;
  readonly completedStatementCount: number;
  readonly lifecycle: "active" | "completed" | "poisoned";
  readonly nextStatementOrdinal: number;
  readonly preparedStatementCount: number;
  readonly totalChanges: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

interface Migration0002ExecutionState {
  readonly asset: SQLiteCursorMigration0002Asset;
  readonly assetSnapshot: SQLiteCursorMigration0002AssetSnapshot;
  readonly connection: SQLiteConnection;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  affectedRows: number;
  completedStatementCount: number;
  lifecycle: "active" | "completed" | "poisoned";
  nextStatementOrdinal: number;
  preparedStatementCount: number;
  totalChanges: number;
  transactionEpoch: bigint;
}

const MIGRATION_0002_EXECUTIONS = new WeakMap<object, Migration0002ExecutionState>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;

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
const SQLITE_CONNECTION_PREPARE_NATIVE_READ = Symbol(
  "SQLiteConnection.prepareNativeRead",
);
const SQLITE_CONNECTION_BEGIN_MIGRATION_0002 = Symbol(
  "SQLiteConnection.beginMigration0002",
);
const SQLITE_CONNECTION_EXECUTE_MIGRATION_0002_NEXT = Symbol(
  "SQLiteConnection.executeMigration0002Next",
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
      sqliteNativeStatementIteratorIntrinsics ??=
        captureSQLiteNativeStatementIteratorIntrinsics(database);
      this.#configure();
    } catch (error) {
      const primary = translateSQLiteError(error, "inspect-schema");
      if (database !== undefined) {
        try {
          if (database.isOpen) {
            reflectApplyIntrinsic(databaseCloseIntrinsic, database, []);
          }
        } catch {
          // Constructor failure remains primary; the native owner was asked to close.
        }
      }
      throw primary;
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
    const before = this.#readTotalChangesCounter();
    const after = this.#readTotalChangesCounter();
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

  #readTotalChangesCounter(): number {
    const statement = hardenSQLiteNativeStatementIntrinsic(reflectApplyIntrinsic(
      databasePrepareIntrinsic, this.#database, ["SELECT total_changes()"],
    ) as StatementSync);
    return sqliteSafeInteger(
      sqliteRow(
        reflectApplyIntrinsic(statementGetIntrinsic, statement, []),
        1,
        "inspect-schema",
        "private SQLite change counter",
      )[0],
      0,
      Number.MAX_SAFE_INTEGER,
      "inspect-schema",
      "private SQLite change counter",
    );
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

  [SQLITE_CONNECTION_PREPARE_NATIVE_READ](
    kind: SQLiteConnectionNativeReadKind,
    operation: CycleStoreProviderOperation,
  ): StatementSync {
    this.#assertOpen(operation);
    const sql = kind === "cursor-publication-target-catalog"
      ? SQLITE_CURSOR_PUBLICATION_CATALOG_NATIVE_QUERY_INTRINSIC
      : kind === "cursor-publication-target-metadata"
        ? SQLITE_CURSOR_PUBLICATION_METADATA_NATIVE_QUERY_INTRINSIC
        : kind === "cursor-publication-migration-0002-temp-conflicts"
          ? SQLITE_CURSOR_MIGRATION_0002_TEMP_CONFLICT_QUERY_INTRINSIC
          : undefined;
    if (sql === undefined) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        operation,
        "captured SQLite native read kind is invalid",
      );
    }
    try {
      return hardenSQLiteNativeStatementIntrinsic(reflectApplyIntrinsic(
        databasePrepareIntrinsic, this.#database, [sql],
      ) as StatementSync);
    } catch (error) {
      throw translateSQLiteError(error, operation);
    }
  }

  [SQLITE_CONNECTION_BEGIN_MIGRATION_0002](
    asset: SQLiteCursorMigration0002Asset,
  ): SQLiteConnectionMigration0002Execution {
    this.#assertOpen("inspect-schema");
    const assetSnapshot = readSQLiteCursorMigration0002AssetSnapshotIntrinsic(asset);
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage === null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_STALE_FENCE",
        "inspect-schema",
        "SQLite migration 0002 requires the active BEGIN EXCLUSIVE owner",
      );
    }
    const execution = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteConnectionMigration0002Execution;
    const state: Migration0002ExecutionState = {
      affectedRows: 0,
      asset,
      assetSnapshot,
      completedStatementCount: 0,
      connection: this,
      lifecycle: "active",
      nextStatementOrdinal: 1,
      preparedStatementCount: 0,
      totalChanges: this.#readTotalChangesCounter(),
      transactionEpoch: this.#transactionEpoch,
      transactionLineage: this.#transactionLineage,
    };
    reflectApplyIntrinsic(weakMapSetIntrinsic, MIGRATION_0002_EXECUTIONS, [
      execution as object,
      state,
    ]);
    return execution;
  }

  [SQLITE_CONNECTION_EXECUTE_MIGRATION_0002_NEXT](
    execution: SQLiteConnectionMigration0002Execution,
  ): SQLiteConnectionMigration0002StepSnapshot {
    const state = execution !== null && typeof execution === "object" && !isProxy(execution)
      ? reflectApplyIntrinsic(weakMapGetIntrinsic, MIGRATION_0002_EXECUTIONS, [
        execution as object,
      ]) as Migration0002ExecutionState | undefined
      : undefined;
    if (state === undefined || state.connection !== this) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite migration 0002 execution is invalid",
      );
    }
    if (state.lifecycle !== "active") {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite migration 0002 execution is terminal",
      );
    }
    if (state.nextStatementOrdinal > state.assetSnapshot.fixedStatementCount) {
      state.lifecycle = "poisoned";
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite migration 0002 execution was reused",
      );
    }
    try {
      this.#assertOpen("inspect-schema");
      if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
          || this.#transactionLineage !== state.transactionLineage
          || this.#transactionEpoch !== state.transactionEpoch
          || this.#readTotalChangesCounter() !== state.totalChanges) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite migration 0002 execution owner drifted",
        );
      }
    } catch (error) {
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    const ordinal = state.nextStatementOrdinal;
    const sql = state.assetSnapshot.statements[ordinal - 1];
    if (sql === undefined) {
      state.lifecycle = "poisoned";
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite migration 0002 statement plan is incomplete",
      );
    }
    let statement: StatementSync;
    let rawResult: unknown;
    try {
      statement = hardenSQLiteNativeStatementIntrinsic(reflectApplyIntrinsic(
        databasePrepareIntrinsic, this.#database, [sql],
      ) as StatementSync);
      state.preparedStatementCount += 1;
      this.#transactionEpoch += 1n;
      rawResult = reflectApplyIntrinsic(statementRunIntrinsic, statement, []);
    } catch (error) {
      state.transactionEpoch = this.#transactionEpoch;
      this.#synchronizeMigration0002CounterAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    // Native run returning is the irreversible statement-completed boundary.
    // Record it before any later result/counter observation can fail.
    state.completedStatementCount += 1;
    state.nextStatementOrdinal += 1;
    state.transactionEpoch = this.#transactionEpoch;
    try {
      if (rawResult === null || typeof rawResult !== "object" || isProxy(rawResult)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite migration 0002 statement result is invalid",
        );
      }
      const changesDescriptor = reflectApplyIntrinsic(
        objectGetOwnPropertyDescriptorIntrinsic,
        Object,
        [rawResult, "changes"],
      ) as PropertyDescriptor | undefined;
      if (changesDescriptor === undefined || !("value" in changesDescriptor)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite migration 0002 statement result is invalid",
        );
      }
      const runChanges = typeof changesDescriptor.value === "bigint"
        && changesDescriptor.value >= 0n
        && changesDescriptor.value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(changesDescriptor.value)
        : numberIsSafeIntegerIntrinsic(changesDescriptor.value)
            && (changesDescriptor.value as number) >= 0
          ? changesDescriptor.value as number
          : undefined;
      if (runChanges === undefined) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite migration 0002 statement changes are invalid",
        );
      }
      const totalChanges = this.#readTotalChangesCounter();
      const delta = totalChanges - state.totalChanges;
      if (!numberIsSafeIntegerIntrinsic(delta) || delta < 0) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite migration 0002 total_changes regressed",
        );
      }
      if ((ordinal === 4 || ordinal === 17) && runChanges !== delta) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite migration 0002 statement result disagreed with total_changes",
        );
      }
      state.affectedRows += delta;
      state.totalChanges = totalChanges;
      if (state.completedStatementCount === state.assetSnapshot.fixedStatementCount) {
        state.lifecycle = "completed";
      }
      return objectFreezeIntrinsic({
        affectedRowsDelta: delta,
        completedStatementCount: state.completedStatementCount,
        fixedStatementOrdinal: ordinal,
        preparedStatementCount: state.preparedStatementCount,
        totalChanges,
        transactionEpoch: state.transactionEpoch,
        transactionLineage: state.transactionLineage,
      });
    } catch (error) {
      this.#synchronizeMigration0002CounterAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }
  }

  #synchronizeMigration0002CounterAfterFailure(state: Migration0002ExecutionState): void {
    try {
      if (this.#database.isOpen && this.#database.isTransaction
          && this.#transactionLineage === state.transactionLineage) {
        const afterFailure = this.#readTotalChangesCounter();
        const delta = afterFailure - state.totalChanges;
        if (numberIsSafeIntegerIntrinsic(delta) && delta >= 0) state.affectedRows += delta;
        state.totalChanges = afterFailure;
      }
    } catch {
      // The statement/result failure remains primary; the owner poisons and rolls back.
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
          return reflectApplyIntrinsic(value, target, parameters);
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
    if (this.#database.isOpen) {
      reflectApplyIntrinsic(databaseCloseIntrinsic, this.#database, []);
    }
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
const sqliteConnectionPrepareNativeReadIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_PREPARE_NATIVE_READ];
const sqliteConnectionBeginMigration0002Intrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_BEGIN_MIGRATION_0002];
const sqliteConnectionExecuteMigration0002NextIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_EXECUTE_MIGRATION_0002_NEXT];
const sqliteConnectionExecTrustedIntrinsic = SQLiteConnection.prototype.execTrusted;
const sqliteConnectionPrepareIntrinsic = SQLiteConnection.prototype.prepare;

/**
 * Read exact owner state through the captured base-class intrinsic.
 * Subclass accessors and prototype replacement cannot intercept this call.
 */
export function readSQLiteConnectionOwnerSnapshot(
  connection: SQLiteConnection,
): SQLiteConnectionOwnerSnapshot {
  return reflectApplyIntrinsic(sqliteConnectionOwnerSnapshotIntrinsic, connection, []);
}

/** Read the real counter without subclass `prepare` or getter interposition. */
export function readSQLiteConnectionTotalChangesSnapshot(
  connection: SQLiteConnection,
): SQLiteConnectionTotalChangesSnapshot {
  return reflectApplyIntrinsic(sqliteConnectionTotalChangesSnapshotIntrinsic, connection, []);
}

/** Execute one fixed package-owned statement through the captured base intrinsic. */
export function execSQLiteConnectionTrustedIntrinsic(
  connection: SQLiteConnection,
  sql: string,
  operation: CycleStoreProviderOperation,
): void {
  reflectApplyIntrinsic(sqliteConnectionExecTrustedIntrinsic, connection, [sql, operation]);
}

/** Prepare one fixed package-owned statement through the captured base intrinsic. */
export function prepareSQLiteConnectionIntrinsic(
  connection: SQLiteConnection,
  sql: string,
  operation: CycleStoreProviderOperation,
): StatementSync {
  return reflectApplyIntrinsic(sqliteConnectionPrepareIntrinsic, connection, [sql, operation]);
}

/** Prepare one closed-set publication read through captured native SQLite code. */
export function prepareSQLiteConnectionCursorPublicationReadIntrinsic(
  connection: SQLiteConnection,
  kind: SQLiteConnectionNativeReadKind,
  operation: CycleStoreProviderOperation,
): StatementSync {
  return reflectApplyIntrinsic(
    sqliteConnectionPrepareNativeReadIntrinsic, connection, [kind, operation],
  );
}

/** Open one exact, zero-parameter, strict-order migration 0002 execution. */
export function beginSQLiteConnectionMigration0002ExecutionIntrinsic(
  connection: SQLiteConnection,
  asset: SQLiteCursorMigration0002Asset,
): SQLiteConnectionMigration0002Execution {
  return reflectApplyIntrinsic(
    sqliteConnectionBeginMigration0002Intrinsic, connection, [asset],
  );
}

/** Prepare and execute only the next fixed migration 0002 statement. */
export function executeNextSQLiteConnectionMigration0002StatementIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionMigration0002Execution,
): SQLiteConnectionMigration0002StepSnapshot {
  return reflectApplyIntrinsic(
    sqliteConnectionExecuteMigration0002NextIntrinsic, connection, [execution],
  );
}

/** Read real completed progress, including after a failed prepare or run. */
export function readSQLiteConnectionMigration0002ExecutionSnapshotIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionMigration0002Execution,
): SQLiteConnectionMigration0002ExecutionSnapshot {
  const state = execution !== null && typeof execution === "object" && !isProxy(execution)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, MIGRATION_0002_EXECUTIONS, [
      execution as object,
    ]) as Migration0002ExecutionState | undefined
    : undefined;
  if (state === undefined || state.connection !== connection) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite migration 0002 execution is invalid",
    );
  }
  return objectFreezeIntrinsic({
    affectedRows: state.affectedRows,
    completedStatementCount: state.completedStatementCount,
    lifecycle: state.lifecycle,
    nextStatementOrdinal: state.nextStatementOrdinal,
    preparedStatementCount: state.preparedStatementCount,
    totalChanges: state.totalChanges,
    transactionEpoch: state.transactionEpoch,
    transactionLineage: state.transactionLineage,
  });
}

/** Execute a statement read through the captured native StatementSync getter. */
export function getSQLiteStatementNativeIntrinsic(statement: StatementSync): unknown {
  return reflectApplyIntrinsic(statementGetIntrinsic, statement, []);
}

/** Acquire a native SQLite row iterator without consulting a mutable prototype. */
export function iterateSQLiteStatementNativeIntrinsic(
  statement: StatementSync,
): SQLiteNativeStatementIterator {
  return reflectApplyIntrinsic(statementIterateIntrinsic, statement, []) as
    SQLiteNativeStatementIterator;
}

function nativeStatementIteratorIntrinsics(): NonNullable<
  typeof sqliteNativeStatementIteratorIntrinsics
> {
  if (sqliteNativeStatementIteratorIntrinsics === undefined) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INTERNAL",
      "inspect-schema",
      "SQLite native statement iterator intrinsics are unavailable",
    );
  }
  return sqliteNativeStatementIteratorIntrinsics;
}

/** Advance a native SQLite row iterator through its connection-initialization intrinsic. */
export function nextSQLiteStatementIteratorNativeIntrinsic(
  iterator: SQLiteNativeStatementIterator,
): IteratorResult<unknown> {
  return reflectApplyIntrinsic(nativeStatementIteratorIntrinsics().next, iterator, []) as
    IteratorResult<unknown>;
}

/** Close a native SQLite row iterator through its connection-initialization intrinsic. */
export function returnSQLiteStatementIteratorNativeIntrinsic(
  iterator: SQLiteNativeStatementIterator,
): IteratorResult<unknown> {
  return reflectApplyIntrinsic(nativeStatementIteratorIntrinsics().return, iterator, []) as
    IteratorResult<unknown>;
}
