import { CycleStoreProviderError } from "@graph-engineering/runtime";

import { sqliteRow, sqliteSafeInteger } from "./sqlite-codec.js";
import { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

export const DEFAULT_SQLITE_BASELINE_TEMP_CACHE_KIB = 8_192;
export const MIN_SQLITE_BASELINE_TEMP_CACHE_KIB = 1_024;
export const MAX_SQLITE_BASELINE_TEMP_CACHE_KIB = 65_536;

export interface SQLiteBaselineTempStorageOptions {
  readonly cacheKiB?: number;
}

export interface SQLiteBaselineTempStorageProfile {
  readonly tempStore: "file";
  readonly cacheKiB: number;
  readonly cacheSpill: true;
}

export interface SQLiteExclusiveBaselineTransactionProof {
  readonly mode: "exclusive";
  readonly transactionEpoch: bigint;
}

function invalid(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    OPERATION,
    message,
  );
}

function unavailable(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_UNAVAILABLE",
    OPERATION,
    message,
  );
}

function checkedCacheKiB(value: unknown): number {
  if (!Number.isSafeInteger(value)
      || (value as number) < MIN_SQLITE_BASELINE_TEMP_CACHE_KIB
      || (value as number) > MAX_SQLITE_BASELINE_TEMP_CACHE_KIB) {
    return invalid("SQLite baseline TEMP cache size is outside bounds");
  }
  return value as number;
}

function pragmaInteger(connection: SQLiteConnection, sql: string, label: string): number {
  return sqliteSafeInteger(
    sqliteRow(
      connection.prepare(sql, OPERATION).get(),
      1,
      OPERATION,
      label,
    )[0],
    Number.MIN_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    label,
  );
}

/** Read and validate the bounded FILE-backed TEMP profile without mutating it. */
export function readSQLiteBaselineTempStorage(
  connection: SQLiteConnection,
): SQLiteBaselineTempStorageProfile {
  if (connection.isTransaction) {
    return invalid("SQLite baseline TEMP storage must be read outside a transaction");
  }
  const tempStore = pragmaInteger(connection, "PRAGMA temp_store", "TEMP storage mode");
  const cachePages = pragmaInteger(
    connection,
    "PRAGMA temp.cache_size",
    "TEMP cache size",
  );
  const cacheSpill = pragmaInteger(connection, "PRAGMA cache_spill", "TEMP cache spill");
  if (tempStore !== 1
      || cachePages >= 0
      || -cachePages < MIN_SQLITE_BASELINE_TEMP_CACHE_KIB
      || -cachePages > MAX_SQLITE_BASELINE_TEMP_CACHE_KIB
      || cacheSpill === 0) {
    return unavailable("SQLite baseline FILE-backed TEMP profile was not retained");
  }
  return Object.freeze({
    tempStore: "file",
    cacheKiB: -cachePages,
    cacheSpill: true,
  });
}

/** Configure bounded FILE-backed TEMP storage before the owner begins EXCLUSIVE. */
export function configureSQLiteBaselineTempStorage(
  connection: SQLiteConnection,
  options: SQLiteBaselineTempStorageOptions = {},
): SQLiteBaselineTempStorageProfile {
  if (connection.isTransaction) {
    return invalid("SQLite baseline TEMP storage must be configured outside a transaction");
  }
  const cacheKiB = checkedCacheKiB(
    options.cacheKiB ?? DEFAULT_SQLITE_BASELINE_TEMP_CACHE_KIB,
  );
  connection.execTrusted("PRAGMA temp_store = FILE", OPERATION);
  connection.execTrusted(`PRAGMA temp.cache_size = -${cacheKiB}`, OPERATION);
  connection.execTrusted("PRAGMA cache_spill = ON", OPERATION);
  const profile = readSQLiteBaselineTempStorage(connection);
  if (profile.cacheKiB !== cacheKiB) {
    return unavailable("SQLite baseline TEMP cache size readback drifted");
  }
  return profile;
}

/** Prove that the current owner epoch is an active EXCLUSIVE transaction. */
export function proveSQLiteExclusiveBaselineTransaction(
  connection: SQLiteConnection,
): SQLiteExclusiveBaselineTransactionProof {
  if (!connection.isTransaction || connection.transactionMode !== "exclusive") {
    return invalid("SQLite baseline capture requires an owner EXCLUSIVE transaction");
  }
  return Object.freeze({
    mode: "exclusive",
    transactionEpoch: connection.transactionEpoch,
  });
}
