import {
  CycleStoreProviderError,
  type CycleStoreProviderErrorCode,
  type CycleStoreProviderOperation,
} from "@graph-engineering/runtime";

const SQLITE_BASE_CODE_MASK = 0xff;

const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_NOMEM = 7;
const SQLITE_READONLY = 8;
const SQLITE_INTERRUPT = 9;
const SQLITE_IOERR = 10;
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_CANTOPEN = 14;
const SQLITE_TOOBIG = 18;
const SQLITE_CONSTRAINT = 19;
const SQLITE_AUTH = 23;
const SQLITE_NOTADB = 26;

interface SQLiteCodedError {
  readonly errcode: number;
}

function codedError(value: unknown): SQLiteCodedError | null {
  try {
    if (typeof value !== "object" || value === null || !("errcode" in value)) return null;
    const errcode = (value as { readonly errcode?: unknown }).errcode;
    return Number.isSafeInteger(errcode) && (errcode as number) >= 0
      ? { errcode: errcode as number }
      : null;
  } catch {
    return null;
  }
}

export function sqliteBaseErrorCode(value: unknown): number | null {
  const error = codedError(value);
  return error === null ? null : error.errcode & SQLITE_BASE_CODE_MASK;
}

export function isRetryableSQLiteLockError(value: unknown): boolean {
  const code = sqliteBaseErrorCode(value);
  return code === SQLITE_BUSY || code === SQLITE_LOCKED;
}

function providerCodeForSQLite(baseCode: number | null): CycleStoreProviderErrorCode {
  switch (baseCode) {
    case SQLITE_BUSY:
    case SQLITE_LOCKED:
    case SQLITE_NOMEM:
    case SQLITE_INTERRUPT:
    case SQLITE_IOERR:
    case SQLITE_CANTOPEN:
      return "GE_CYCLE_STORE_UNAVAILABLE";
    case SQLITE_READONLY:
    case SQLITE_AUTH:
      return "GE_CYCLE_STORE_PERMISSION_DENIED";
    case SQLITE_CORRUPT:
    case SQLITE_NOTADB:
      return "GE_CYCLE_STORE_CORRUPTION";
    case SQLITE_FULL:
    case SQLITE_TOOBIG:
      return "GE_CYCLE_STORE_QUOTA_EXCEEDED";
    case SQLITE_CONSTRAINT:
      // Expected conflicts are classified before the statement is executed.
      // An unclassified constraint means the relational invariant disagrees
      // with the validated provider decision and therefore fails closed.
      return "GE_CYCLE_STORE_CORRUPTION";
    default:
      return "GE_CYCLE_STORE_INTERNAL";
  }
}

export function translateSQLiteError(
  error: unknown,
  operation: CycleStoreProviderOperation,
): CycleStoreProviderError {
  try {
    if (error instanceof CycleStoreProviderError) return error;
  } catch {
    // A hostile Proxy is still an unknown internal error. No trap result or
    // message becomes observable through the provider taxonomy.
  }
  const baseCode = sqliteBaseErrorCode(error);
  const code = providerCodeForSQLite(baseCode);
  const details = baseCode === null ? {} : { sqliteClass: baseCode };
  return new CycleStoreProviderError(
    code,
    operation,
    code === "GE_CYCLE_STORE_UNAVAILABLE"
      ? "SQLite provider is temporarily unavailable"
      : "SQLite provider operation failed safely",
    details,
  );
}
