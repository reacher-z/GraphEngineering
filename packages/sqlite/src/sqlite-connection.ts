import {
  DatabaseSync,
  StatementSync,
  backup,
  type BackupProgressInfo,
} from "node:sqlite";
import { performance } from "node:perf_hooks";
import { isProxy, isUint8Array } from "node:util/types";

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
const stringCharCodeAtIntrinsic = String.prototype.charCodeAt;
const stringSliceIntrinsic = String.prototype.slice;
const stringStartsWithIntrinsic = String.prototype.startsWith;
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
export const SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC =
  "SELECT kind_rank, entry_kind, key_blob, state_blob FROM temp.ge_blr_stage ORDER BY kind_rank ASC, key_blob ASC" as const;
export const SQLITE_CURSOR_MIGRATION_0002_TEMP_CONFLICT_QUERY_INTRINSIC =
  "SELECT count(*) FROM temp.sqlite_schema WHERE lower(name) IN ("
  + "'ge_cycle_schema','ge_cycle_schema_v1','ge_cycle_operations',"
  + "'ge_cycle_operations_v1','ge_cycle_operations_commit_idx',"
  + "'ge_cycle_operations_sequence_uq','ge_cycle_operations_replay_idx',"
  + "'ge_cycle_operation_baselines','ge_cycle_operation_baseline_entries',"
  + "'ge_cycle_operation_baseline_entries_key_uq',"
  + "'ge_cycle_operation_baseline_entries_hash_uq','ge_cycle_operation_sequence')";
export const SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC =
  "INSERT INTO main.ge_cycle_operation_baseline_entries (baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, previous_entry_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?)" as const;
export const SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC =
  "b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b" as const;
export const SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_PARAMETER_ORDER_INTRINSIC =
  objectFreezeIntrinsic([
    "baselineId",
    "ordinal",
    "entryKind",
    "entryKeyBlob",
    "entryStateBlob",
    "previousEntryHash",
    "entryHash",
  ] as const);
export const SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC =
  "INSERT INTO main.ge_cycle_operation_baselines (baseline_id, baseline_format_version, source_application_id, source_user_version, source_schema_identity_sha256, source_migration_lineage_id, source_migration_lineage_sha256, source_descriptor_hash, captured_at_ms, legacy_operation_count, entry_count, first_entry_hash, final_entry_hash, canonical_projection_sha256, creation_runtime, creation_runtime_version, policy_blob) VALUES (?, 1, 1195724359, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)" as const;
export const SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC =
  "b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a" as const;
export const SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC =
  objectFreezeIntrinsic([
    "baselineId",
    "sourceSchemaIdentitySha256",
    "sourceMigrationLineageId",
    "sourceMigrationLineageSha256",
    "sourceDescriptorHash",
    "capturedAtMs",
    "legacyOperationCount",
    "entryCount",
    "firstEntryHash",
    "finalEntryHash",
    "canonicalProjectionSha256",
    "creationRuntime",
    "creationRuntimeVersion",
    "policyBlob",
  ] as const);
export const SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC =
  "INSERT INTO main.ge_cycle_operation_sequence (singleton, baseline_id, last_commit_sequence, baseline_captured_at_ms, updated_at_ms) VALUES (1, ?, 0, ?, ?)" as const;
export const SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC =
  "a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85" as const;
export const SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC =
  objectFreezeIntrinsic([
    "baselineId",
    "baselineCapturedAtMs",
    "updatedAtMs",
  ] as const);
export type SQLiteConnectionNativeReadKind =
  | "cursor-publication-post-ddl-baseline-source"
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

/** Exact seven-value input contract for one baseline-entry publication run. */
export interface SQLiteConnectionBaselineEntryPublicationRow {
  readonly baselineId: string;
  readonly ordinal: number;
  readonly entryKind: string;
  readonly entryKeyBlob: Uint8Array;
  readonly entryStateBlob: Uint8Array;
  readonly previousEntryHash: string;
  readonly entryHash: string;
}

/** Opaque, connection-owned single-prepare baseline-entry write session. */
export interface SQLiteConnectionBaselineEntryPublicationExecution {
  readonly __sqliteConnectionBaselineEntryPublicationExecution: never;
}

export interface SQLiteConnectionBaselineEntryPublicationStepSnapshot {
  readonly affectedRowsDelta: 1;
  readonly completedEntryCount: number;
  readonly entryOrdinal: number;
  readonly executeCount: number;
  readonly prepareCount: 1;
  readonly totalChanges: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

export interface SQLiteConnectionBaselineEntryPublicationExecutionSnapshot {
  readonly affectedRows: number;
  readonly completedEntryCount: number;
  readonly executeCount: number;
  readonly expectedEntryCount: number;
  readonly lifecycle: "active" | "completed" | "poisoned";
  readonly nextEntryOrdinal: number;
  readonly prepareCount: 1;
  readonly totalChanges: number;
  readonly totalChangesDelta: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

/** Exact fourteen-value input contract for the single baseline-header run. */
export interface SQLiteConnectionBaselineHeaderPublicationRow {
  readonly baselineId: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly sourceMigrationLineageId: string;
  readonly sourceMigrationLineageSha256: string;
  readonly sourceDescriptorHash: string;
  readonly capturedAtMs: number;
  readonly legacyOperationCount: number;
  readonly entryCount: number;
  readonly firstEntryHash: string;
  readonly finalEntryHash: string;
  readonly canonicalProjectionSha256: string;
  readonly creationRuntime: string;
  readonly creationRuntimeVersion: string;
  readonly policyBlob: Uint8Array;
}

/** Opaque, connection-owned single-prepare/single-run header session. */
export interface SQLiteConnectionBaselineHeaderPublicationExecution {
  readonly __sqliteConnectionBaselineHeaderPublicationExecution: never;
}

export interface SQLiteConnectionBaselineHeaderPublicationStepSnapshot {
  readonly affectedRowsDelta: 1;
  readonly completedExecutionCount: 1;
  readonly executeCount: 1;
  readonly prepareCount: 1;
  readonly totalChanges: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

export interface SQLiteConnectionBaselineHeaderPublicationExecutionSnapshot {
  readonly affectedRows: number;
  readonly completedExecutionCount: 0 | 1;
  readonly executeCount: 0 | 1;
  readonly lifecycle: "active" | "completed" | "poisoned";
  readonly prepareCount: 1;
  readonly totalChanges: number;
  readonly totalChangesDelta: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

/** Exact three-value input contract for the singleton sequence-zero write. */
export interface SQLiteConnectionOperationSequenceZeroRow {
  readonly baselineId: string;
  readonly baselineCapturedAtMs: number;
  readonly updatedAtMs: number;
}

/** Opaque, connection-owned single-prepare/single-run sequence-zero session. */
export interface SQLiteConnectionOperationSequenceZeroExecution {
  readonly __sqliteConnectionOperationSequenceZeroExecution: never;
}

export interface SQLiteConnectionOperationSequenceZeroStepSnapshot {
  readonly affectedRowsDelta: 1;
  readonly completedExecutionCount: 1;
  readonly executeCount: 1;
  readonly prepareCount: 1;
  readonly totalChanges: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

export interface SQLiteConnectionOperationSequenceZeroExecutionSnapshot {
  readonly affectedRows: number;
  readonly completedExecutionCount: 0 | 1;
  readonly executeCount: 0 | 1;
  readonly lifecycle: "active" | "completed" | "poisoned";
  readonly prepareCount: 1;
  readonly totalChanges: number;
  readonly totalChangesDelta: number;
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

interface BaselineEntryPublicationExecutionState {
  readonly connection: SQLiteConnection;
  readonly expectedEntryCount: number;
  readonly initialTotalChanges: number;
  readonly statement: StatementSync;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  affectedRows: number;
  completedEntryCount: number;
  executeCount: number;
  lifecycle: "active" | "completed" | "poisoned";
  nextEntryOrdinal: number;
  totalChanges: number;
  transactionEpoch: bigint;
}

interface BaselineHeaderPublicationExecutionState {
  readonly connection: SQLiteConnection;
  readonly initialTotalChanges: number;
  readonly statement: StatementSync;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  affectedRows: number;
  completedExecutionCount: 0 | 1;
  executeCount: 0 | 1;
  lifecycle: "active" | "completed" | "poisoned";
  totalChanges: number;
  transactionEpoch: bigint;
}

interface OperationSequenceZeroExecutionState {
  readonly connection: SQLiteConnection;
  readonly initialTotalChanges: number;
  readonly statement: StatementSync;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  affectedRows: number;
  completedExecutionCount: 0 | 1;
  executeCount: 0 | 1;
  lifecycle: "active" | "completed" | "poisoned";
  totalChanges: number;
  transactionEpoch: bigint;
}

const MIGRATION_0002_EXECUTIONS = new WeakMap<object, Migration0002ExecutionState>();
const BASELINE_ENTRY_PUBLICATION_EXECUTIONS = new WeakMap<
  object,
  BaselineEntryPublicationExecutionState
>();
const BASELINE_HEADER_PUBLICATION_EXECUTIONS = new WeakMap<
  object,
  BaselineHeaderPublicationExecutionState
>();
const OPERATION_SEQUENCE_ZERO_EXECUTIONS = new WeakMap<
  object,
  OperationSequenceZeroExecutionState
>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;

function invalid(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    "inspect-schema",
    message,
  );
}

function isLowerHex64(value: string): boolean {
  if (value.length !== 64) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = reflectApplyIntrinsic(stringCharCodeAtIntrinsic, value, [index]) as number;
    if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 102))) return false;
  }
  return true;
}

function baselineEntryPublicationOwnValue(
  row: object,
  key: keyof SQLiteConnectionBaselineEntryPublicationRow,
): unknown {
  const descriptor = reflectApplyIntrinsic(
    objectGetOwnPropertyDescriptorIntrinsic,
    Object,
    [row, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite baseline-entry publication row is invalid",
    );
  }
  return descriptor.value;
}

function checkedBaselineEntryPublicationParameters(
  row: SQLiteConnectionBaselineEntryPublicationRow,
): [string, number, string, Uint8Array, Uint8Array, string, string] {
  if (row === null || typeof row !== "object" || isProxy(row)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite baseline-entry publication row is invalid",
    );
  }
  const baselineId = baselineEntryPublicationOwnValue(row, "baselineId");
  const ordinal = baselineEntryPublicationOwnValue(row, "ordinal");
  const entryKind = baselineEntryPublicationOwnValue(row, "entryKind");
  const entryKeyBlob = baselineEntryPublicationOwnValue(row, "entryKeyBlob");
  const entryStateBlob = baselineEntryPublicationOwnValue(row, "entryStateBlob");
  const previousEntryHash = baselineEntryPublicationOwnValue(row, "previousEntryHash");
  const entryHash = baselineEntryPublicationOwnValue(row, "entryHash");
  if (typeof baselineId !== "string"
      || !reflectApplyIntrinsic(stringStartsWithIntrinsic, baselineId, ["v2-"])
      || !isLowerHex64(
        reflectApplyIntrinsic(stringSliceIntrinsic, baselineId, [3]) as string,
      )
      || !numberIsSafeIntegerIntrinsic(ordinal) || (ordinal as number) < 0
      || typeof entryKind !== "string" || entryKind.length === 0
      || !isUint8Array(entryKeyBlob) || !isUint8Array(entryStateBlob)
      || typeof previousEntryHash !== "string" || !isLowerHex64(previousEntryHash)
      || typeof entryHash !== "string" || !isLowerHex64(entryHash)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite baseline-entry publication row is invalid",
    );
  }
  return [
    baselineId,
    ordinal as number,
    entryKind,
    entryKeyBlob,
    entryStateBlob,
    previousEntryHash,
    entryHash,
  ];
}

function baselineHeaderPublicationOwnValue(
  row: object,
  key: keyof SQLiteConnectionBaselineHeaderPublicationRow,
): unknown {
  const descriptor = reflectApplyIntrinsic(
    objectGetOwnPropertyDescriptorIntrinsic,
    Object,
    [row, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite baseline-header publication row is invalid",
    );
  }
  return descriptor.value;
}

function checkedBaselineHeaderPublicationParameters(
  row: SQLiteConnectionBaselineHeaderPublicationRow,
): [
  string,
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  string,
  string,
  string,
  string,
  string,
  Uint8Array,
] {
  if (row === null || typeof row !== "object" || isProxy(row)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite baseline-header publication row is invalid",
    );
  }
  const baselineId = baselineHeaderPublicationOwnValue(row, "baselineId");
  const sourceSchemaIdentitySha256 = baselineHeaderPublicationOwnValue(
    row, "sourceSchemaIdentitySha256",
  );
  const sourceMigrationLineageId = baselineHeaderPublicationOwnValue(
    row, "sourceMigrationLineageId",
  );
  const sourceMigrationLineageSha256 = baselineHeaderPublicationOwnValue(
    row, "sourceMigrationLineageSha256",
  );
  const sourceDescriptorHash = baselineHeaderPublicationOwnValue(row, "sourceDescriptorHash");
  const capturedAtMs = baselineHeaderPublicationOwnValue(row, "capturedAtMs");
  const legacyOperationCount = baselineHeaderPublicationOwnValue(row, "legacyOperationCount");
  const entryCount = baselineHeaderPublicationOwnValue(row, "entryCount");
  const firstEntryHash = baselineHeaderPublicationOwnValue(row, "firstEntryHash");
  const finalEntryHash = baselineHeaderPublicationOwnValue(row, "finalEntryHash");
  const canonicalProjectionSha256 = baselineHeaderPublicationOwnValue(
    row, "canonicalProjectionSha256",
  );
  const creationRuntime = baselineHeaderPublicationOwnValue(row, "creationRuntime");
  const creationRuntimeVersion = baselineHeaderPublicationOwnValue(
    row, "creationRuntimeVersion",
  );
  const policyBlob = baselineHeaderPublicationOwnValue(row, "policyBlob");
  if (typeof baselineId !== "string"
      || !reflectApplyIntrinsic(stringStartsWithIntrinsic, baselineId, ["v2-"])
      || !isLowerHex64(
        reflectApplyIntrinsic(stringSliceIntrinsic, baselineId, [3]) as string,
      )
      || typeof sourceSchemaIdentitySha256 !== "string"
      || !isLowerHex64(sourceSchemaIdentitySha256)
      || typeof sourceMigrationLineageId !== "string"
      || sourceMigrationLineageId.length === 0
      || typeof sourceMigrationLineageSha256 !== "string"
      || !isLowerHex64(sourceMigrationLineageSha256)
      || typeof sourceDescriptorHash !== "string" || !isLowerHex64(sourceDescriptorHash)
      || !numberIsSafeIntegerIntrinsic(capturedAtMs) || (capturedAtMs as number) < 0
      || !numberIsSafeIntegerIntrinsic(legacyOperationCount)
      || (legacyOperationCount as number) < 0
      || !numberIsSafeIntegerIntrinsic(entryCount) || (entryCount as number) < 0
      || (legacyOperationCount as number) > (entryCount as number)
      || typeof firstEntryHash !== "string" || !isLowerHex64(firstEntryHash)
      || typeof finalEntryHash !== "string" || !isLowerHex64(finalEntryHash)
      || typeof canonicalProjectionSha256 !== "string"
      || !isLowerHex64(canonicalProjectionSha256)
      || typeof creationRuntime !== "string" || creationRuntime.length === 0
      || typeof creationRuntimeVersion !== "string" || creationRuntimeVersion.length === 0
      || !isUint8Array(policyBlob)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite baseline-header publication row is invalid",
    );
  }
  return [
    baselineId,
    sourceSchemaIdentitySha256,
    sourceMigrationLineageId,
    sourceMigrationLineageSha256,
    sourceDescriptorHash,
    capturedAtMs as number,
    legacyOperationCount as number,
    entryCount as number,
    firstEntryHash,
    finalEntryHash,
    canonicalProjectionSha256,
    creationRuntime,
    creationRuntimeVersion,
    policyBlob,
  ];
}

function operationSequenceZeroOwnValue(
  row: object,
  key: keyof SQLiteConnectionOperationSequenceZeroRow,
): unknown {
  const descriptor = reflectApplyIntrinsic(
    objectGetOwnPropertyDescriptorIntrinsic,
    Object,
    [row, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite operation-sequence-zero row is invalid",
    );
  }
  return descriptor.value;
}

function checkedOperationSequenceZeroParameters(
  row: SQLiteConnectionOperationSequenceZeroRow,
): [string, number, number] {
  if (row === null || typeof row !== "object" || isProxy(row)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite operation-sequence-zero row is invalid",
    );
  }
  const baselineId = operationSequenceZeroOwnValue(row, "baselineId");
  const baselineCapturedAtMs = operationSequenceZeroOwnValue(row, "baselineCapturedAtMs");
  const updatedAtMs = operationSequenceZeroOwnValue(row, "updatedAtMs");
  if (typeof baselineId !== "string"
      || !reflectApplyIntrinsic(stringStartsWithIntrinsic, baselineId, ["v2-"])
      || !isLowerHex64(
        reflectApplyIntrinsic(stringSliceIntrinsic, baselineId, [3]) as string,
      )
      || !numberIsSafeIntegerIntrinsic(baselineCapturedAtMs)
      || (baselineCapturedAtMs as number) < 0
      || !numberIsSafeIntegerIntrinsic(updatedAtMs)
      || (updatedAtMs as number) < (baselineCapturedAtMs as number)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite operation-sequence-zero row is invalid",
    );
  }
  return [baselineId, baselineCapturedAtMs as number, updatedAtMs as number];
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
const SQLITE_CONNECTION_BEGIN_BASELINE_ENTRY_PUBLICATION = Symbol(
  "SQLiteConnection.beginBaselineEntryPublication",
);
const SQLITE_CONNECTION_EXECUTE_BASELINE_ENTRY_PUBLICATION_NEXT = Symbol(
  "SQLiteConnection.executeBaselineEntryPublicationNext",
);
const SQLITE_CONNECTION_BEGIN_BASELINE_HEADER_PUBLICATION = Symbol(
  "SQLiteConnection.beginBaselineHeaderPublication",
);
const SQLITE_CONNECTION_EXECUTE_BASELINE_HEADER_PUBLICATION = Symbol(
  "SQLiteConnection.executeBaselineHeaderPublication",
);
const SQLITE_CONNECTION_BEGIN_OPERATION_SEQUENCE_ZERO = Symbol(
  "SQLiteConnection.beginOperationSequenceZero",
);
const SQLITE_CONNECTION_EXECUTE_OPERATION_SEQUENCE_ZERO = Symbol(
  "SQLiteConnection.executeOperationSequenceZero",
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
    const open = !this.#closed && this.#database.isOpen;
    if (!open) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        "inspect-schema",
        "SQLite provider is closed",
      );
    }
    const transactionBefore = this.#database.isTransaction;
    const mode = transactionBefore ? (this.#transactionMode ?? "unknown") : null;
    const transactionAfter = this.#database.isTransaction;
    const epochAfter = this.#transactionEpoch;
    const lineageAfter = this.#transactionLineage;
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
    const sql = kind === "cursor-publication-post-ddl-baseline-source"
      ? SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC
      : kind === "cursor-publication-target-catalog"
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

  [SQLITE_CONNECTION_BEGIN_BASELINE_ENTRY_PUBLICATION](
    expectedEntryCount: number,
  ): SQLiteConnectionBaselineEntryPublicationExecution {
    this.#assertOpen("inspect-schema");
    if (!numberIsSafeIntegerIntrinsic(expectedEntryCount) || expectedEntryCount < 0) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite baseline-entry publication expected count is invalid",
      );
    }
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage === null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_STALE_FENCE",
        "inspect-schema",
        "SQLite baseline-entry publication requires the active BEGIN EXCLUSIVE owner",
      );
    }

    const transactionLineage = this.#transactionLineage;
    const transactionEpoch = this.#transactionEpoch;
    const totalChanges = this.#readTotalChangesCounter();
    let statement: StatementSync;
    try {
      statement = hardenSQLiteNativeStatementIntrinsic(reflectApplyIntrinsic(
        databasePrepareIntrinsic,
        this.#database,
        [SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC],
      ) as StatementSync);
    } catch (error) {
      throw translateSQLiteError(error, "inspect-schema");
    }
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage !== transactionLineage
        || this.#transactionEpoch !== transactionEpoch
        || this.#readTotalChangesCounter() !== totalChanges) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite baseline-entry publication owner drifted during prepare",
      );
    }

    const execution = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteConnectionBaselineEntryPublicationExecution;
    const state: BaselineEntryPublicationExecutionState = {
      affectedRows: 0,
      completedEntryCount: 0,
      connection: this,
      executeCount: 0,
      expectedEntryCount,
      initialTotalChanges: totalChanges,
      lifecycle: expectedEntryCount === 0 ? "completed" : "active",
      nextEntryOrdinal: 0,
      statement,
      totalChanges,
      transactionEpoch,
      transactionLineage,
    };
    reflectApplyIntrinsic(weakMapSetIntrinsic, BASELINE_ENTRY_PUBLICATION_EXECUTIONS, [
      execution as object,
      state,
    ]);
    return execution;
  }

  [SQLITE_CONNECTION_EXECUTE_BASELINE_ENTRY_PUBLICATION_NEXT](
    execution: SQLiteConnectionBaselineEntryPublicationExecution,
    row: SQLiteConnectionBaselineEntryPublicationRow,
  ): SQLiteConnectionBaselineEntryPublicationStepSnapshot {
    const state = execution !== null && typeof execution === "object" && !isProxy(execution)
      ? reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_ENTRY_PUBLICATION_EXECUTIONS, [
        execution as object,
      ]) as BaselineEntryPublicationExecutionState | undefined
      : undefined;
    if (state === undefined || state.connection !== this) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite baseline-entry publication execution is invalid",
      );
    }
    if (state.lifecycle !== "active") {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite baseline-entry publication execution is terminal",
      );
    }
    if (state.nextEntryOrdinal >= state.expectedEntryCount) {
      state.lifecycle = "poisoned";
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite baseline-entry publication execution was reused",
      );
    }

    let parameters: ReturnType<typeof checkedBaselineEntryPublicationParameters>;
    try {
      parameters = checkedBaselineEntryPublicationParameters(row);
      this.#assertOpen("inspect-schema");
      if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
          || this.#transactionLineage !== state.transactionLineage
          || this.#transactionEpoch !== state.transactionEpoch
          || this.#readTotalChangesCounter() !== state.totalChanges) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-entry publication execution owner drifted",
        );
      }
      if (parameters[1] !== state.nextEntryOrdinal) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-entry publication ordinal is not sequential",
        );
      }
    } catch (error) {
      this.#synchronizeBaselineEntryPublicationAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    let rawResult: unknown;
    state.executeCount += 1;
    this.#transactionEpoch += 1n;
    try {
      rawResult = reflectApplyIntrinsic(statementRunIntrinsic, state.statement, parameters);
    } catch (error) {
      this.#synchronizeBaselineEntryPublicationAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    // A returning native run is the irreversible completion boundary. Preserve
    // that progress before result inspection or total_changes can fail.
    const entryOrdinal = state.nextEntryOrdinal;
    state.completedEntryCount += 1;
    state.nextEntryOrdinal += 1;
    state.affectedRows = state.completedEntryCount;
    state.transactionEpoch = this.#transactionEpoch;
    try {
      if (rawResult === null || typeof rawResult !== "object" || isProxy(rawResult)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-entry publication result is invalid",
        );
      }
      const changesDescriptor = reflectApplyIntrinsic(
        objectGetOwnPropertyDescriptorIntrinsic,
        Object,
        [rawResult, "changes"],
      ) as PropertyDescriptor | undefined;
      const changes = changesDescriptor !== undefined && "value" in changesDescriptor
        ? changesDescriptor.value
        : undefined;
      const runChanges = typeof changes === "bigint" && changes === 1n
        ? 1
        : changes === 1
          ? 1
          : undefined;
      if (runChanges !== 1) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-entry publication must affect exactly one row",
        );
      }
      const totalChanges = this.#readTotalChangesCounter();
      if (totalChanges - state.totalChanges !== 1) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-entry publication disagreed with total_changes",
        );
      }
      state.totalChanges = totalChanges;
      state.affectedRows = totalChanges - state.initialTotalChanges;
      if (state.completedEntryCount === state.expectedEntryCount) {
        state.lifecycle = "completed";
      }
      return objectFreezeIntrinsic({
        affectedRowsDelta: 1,
        completedEntryCount: state.completedEntryCount,
        entryOrdinal,
        executeCount: state.executeCount,
        prepareCount: 1,
        totalChanges,
        transactionEpoch: state.transactionEpoch,
        transactionLineage: state.transactionLineage,
      });
    } catch (error) {
      this.#synchronizeBaselineEntryPublicationAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }
  }

  #synchronizeBaselineEntryPublicationAfterFailure(
    state: BaselineEntryPublicationExecutionState,
  ): void {
    state.transactionEpoch = this.#transactionEpoch;
    try {
      if (this.#database.isOpen) {
        state.totalChanges = this.#readTotalChangesCounter();
        const delta = state.totalChanges - state.initialTotalChanges;
        if (numberIsSafeIntegerIntrinsic(delta) && delta >= 0) {
          state.affectedRows = delta;
        }
      }
    } catch {
      // The statement/result failure remains primary; the owner poisons and rolls back.
    }
  }

  [SQLITE_CONNECTION_BEGIN_BASELINE_HEADER_PUBLICATION]():
    SQLiteConnectionBaselineHeaderPublicationExecution {
    this.#assertOpen("inspect-schema");
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage === null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_STALE_FENCE",
        "inspect-schema",
        "SQLite baseline-header publication requires the active BEGIN EXCLUSIVE owner",
      );
    }

    const transactionLineage = this.#transactionLineage;
    const transactionEpoch = this.#transactionEpoch;
    const totalChanges = this.#readTotalChangesCounter();
    let statement: StatementSync;
    try {
      statement = hardenSQLiteNativeStatementIntrinsic(reflectApplyIntrinsic(
        databasePrepareIntrinsic,
        this.#database,
        [SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC],
      ) as StatementSync);
    } catch (error) {
      throw translateSQLiteError(error, "inspect-schema");
    }
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage !== transactionLineage
        || this.#transactionEpoch !== transactionEpoch
        || this.#readTotalChangesCounter() !== totalChanges) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite baseline-header publication owner drifted during prepare",
      );
    }

    const execution = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteConnectionBaselineHeaderPublicationExecution;
    const state: BaselineHeaderPublicationExecutionState = {
      affectedRows: 0,
      completedExecutionCount: 0,
      connection: this,
      executeCount: 0,
      initialTotalChanges: totalChanges,
      lifecycle: "active",
      statement,
      totalChanges,
      transactionEpoch,
      transactionLineage,
    };
    reflectApplyIntrinsic(weakMapSetIntrinsic, BASELINE_HEADER_PUBLICATION_EXECUTIONS, [
      execution as object,
      state,
    ]);
    return execution;
  }

  [SQLITE_CONNECTION_EXECUTE_BASELINE_HEADER_PUBLICATION](
    execution: SQLiteConnectionBaselineHeaderPublicationExecution,
    row: SQLiteConnectionBaselineHeaderPublicationRow,
  ): SQLiteConnectionBaselineHeaderPublicationStepSnapshot {
    const state = execution !== null && typeof execution === "object" && !isProxy(execution)
      ? reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_HEADER_PUBLICATION_EXECUTIONS, [
        execution as object,
      ]) as BaselineHeaderPublicationExecutionState | undefined
      : undefined;
    if (state === undefined || state.connection !== this) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite baseline-header publication execution is invalid",
      );
    }
    if (state.lifecycle !== "active") {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite baseline-header publication execution is terminal",
      );
    }

    let parameters: ReturnType<typeof checkedBaselineHeaderPublicationParameters>;
    try {
      parameters = checkedBaselineHeaderPublicationParameters(row);
      this.#assertOpen("inspect-schema");
      if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
          || this.#transactionLineage !== state.transactionLineage
          || this.#transactionEpoch !== state.transactionEpoch
          || this.#readTotalChangesCounter() !== state.totalChanges) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-header publication execution owner drifted",
        );
      }
    } catch (error) {
      this.#synchronizeBaselineHeaderPublicationAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    let rawResult: unknown;
    state.executeCount = 1;
    this.#transactionEpoch += 1n;
    try {
      rawResult = reflectApplyIntrinsic(statementRunIntrinsic, state.statement, parameters);
    } catch (error) {
      this.#synchronizeBaselineHeaderPublicationAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    // Native return is the irreversible one-row completion boundary.
    state.completedExecutionCount = 1;
    state.affectedRows = 1;
    state.transactionEpoch = this.#transactionEpoch;
    try {
      if (rawResult === null || typeof rawResult !== "object" || isProxy(rawResult)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-header publication result is invalid",
        );
      }
      const changesDescriptor = reflectApplyIntrinsic(
        objectGetOwnPropertyDescriptorIntrinsic,
        Object,
        [rawResult, "changes"],
      ) as PropertyDescriptor | undefined;
      const changes = changesDescriptor !== undefined && "value" in changesDescriptor
        ? changesDescriptor.value
        : undefined;
      if (!((typeof changes === "bigint" && changes === 1n) || changes === 1)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-header publication must affect exactly one row",
        );
      }
      const totalChanges = this.#readTotalChangesCounter();
      if (totalChanges - state.totalChanges !== 1) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite baseline-header publication disagreed with total_changes",
        );
      }
      state.totalChanges = totalChanges;
      state.affectedRows = totalChanges - state.initialTotalChanges;
      state.lifecycle = "completed";
      return objectFreezeIntrinsic({
        affectedRowsDelta: 1,
        completedExecutionCount: 1,
        executeCount: 1,
        prepareCount: 1,
        totalChanges,
        transactionEpoch: state.transactionEpoch,
        transactionLineage: state.transactionLineage,
      });
    } catch (error) {
      this.#synchronizeBaselineHeaderPublicationAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }
  }

  #synchronizeBaselineHeaderPublicationAfterFailure(
    state: BaselineHeaderPublicationExecutionState,
  ): void {
    state.transactionEpoch = this.#transactionEpoch;
    try {
      if (this.#database.isOpen) {
        state.totalChanges = this.#readTotalChangesCounter();
        const delta = state.totalChanges - state.initialTotalChanges;
        if (numberIsSafeIntegerIntrinsic(delta) && delta >= 0) {
          state.affectedRows = delta;
        }
      }
    } catch {
      // The statement/result failure remains primary; the owner poisons and rolls back.
    }
  }

  [SQLITE_CONNECTION_BEGIN_OPERATION_SEQUENCE_ZERO]():
    SQLiteConnectionOperationSequenceZeroExecution {
    this.#assertOpen("inspect-schema");
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage === null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_STALE_FENCE",
        "inspect-schema",
        "SQLite operation-sequence-zero write requires the active BEGIN EXCLUSIVE owner",
      );
    }

    const transactionLineage = this.#transactionLineage;
    const transactionEpoch = this.#transactionEpoch;
    const totalChanges = this.#readTotalChangesCounter();
    let statement: StatementSync;
    try {
      statement = hardenSQLiteNativeStatementIntrinsic(reflectApplyIntrinsic(
        databasePrepareIntrinsic,
        this.#database,
        [SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC],
      ) as StatementSync);
    } catch (error) {
      throw translateSQLiteError(error, "inspect-schema");
    }
    // Unreachable while `DatabaseSync.prepare` keeps its contract: preparing a
    // statement executes nothing, so no reachable caller can move the owner
    // transaction, its epoch, or the change counter across the call above.
    // Retained as defence in depth against a native contract violation.
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage !== transactionLineage
        || this.#transactionEpoch !== transactionEpoch
        || this.#readTotalChangesCounter() !== totalChanges) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite operation-sequence-zero owner drifted during prepare",
      );
    }

    const execution = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteConnectionOperationSequenceZeroExecution;
    const state: OperationSequenceZeroExecutionState = {
      affectedRows: 0,
      completedExecutionCount: 0,
      connection: this,
      executeCount: 0,
      initialTotalChanges: totalChanges,
      lifecycle: "active",
      statement,
      totalChanges,
      transactionEpoch,
      transactionLineage,
    };
    reflectApplyIntrinsic(weakMapSetIntrinsic, OPERATION_SEQUENCE_ZERO_EXECUTIONS, [
      execution as object,
      state,
    ]);
    return execution;
  }

  [SQLITE_CONNECTION_EXECUTE_OPERATION_SEQUENCE_ZERO](
    execution: SQLiteConnectionOperationSequenceZeroExecution,
    row: SQLiteConnectionOperationSequenceZeroRow,
  ): SQLiteConnectionOperationSequenceZeroStepSnapshot {
    const state = execution !== null && typeof execution === "object" && !isProxy(execution)
      ? reflectApplyIntrinsic(weakMapGetIntrinsic, OPERATION_SEQUENCE_ZERO_EXECUTIONS, [
        execution as object,
      ]) as OperationSequenceZeroExecutionState | undefined
      : undefined;
    if (state === undefined || state.connection !== this) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite operation-sequence-zero execution is invalid",
      );
    }
    if (state.lifecycle !== "active") {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite operation-sequence-zero execution is terminal",
      );
    }

    let parameters: ReturnType<typeof checkedOperationSequenceZeroParameters>;
    try {
      parameters = checkedOperationSequenceZeroParameters(row);
      this.#assertOpen("inspect-schema");
      if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
          || this.#transactionLineage !== state.transactionLineage
          || this.#transactionEpoch !== state.transactionEpoch
          || this.#readTotalChangesCounter() !== state.totalChanges) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite operation-sequence-zero execution owner drifted",
        );
      }
    } catch (error) {
      this.#synchronizeOperationSequenceZeroAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    let rawResult: unknown;
    state.executeCount = 1;
    this.#transactionEpoch += 1n;
    try {
      rawResult = reflectApplyIntrinsic(statementRunIntrinsic, state.statement, parameters);
    } catch (error) {
      this.#synchronizeOperationSequenceZeroAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    // Native return is the irreversible one-row completion boundary.
    state.completedExecutionCount = 1;
    state.affectedRows = 1;
    state.transactionEpoch = this.#transactionEpoch;
    try {
      // Unreachable while `StatementSync.run` keeps its contract of returning a
      // plain result object. Retained as defence in depth against a native
      // contract violation; every other rejection below is caller-reachable.
      if (rawResult === null || typeof rawResult !== "object" || isProxy(rawResult)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite operation-sequence-zero result is invalid",
        );
      }
      const changesDescriptor = reflectApplyIntrinsic(
        objectGetOwnPropertyDescriptorIntrinsic,
        Object,
        [rawResult, "changes"],
      ) as PropertyDescriptor | undefined;
      const changes = changesDescriptor !== undefined && "value" in changesDescriptor
        ? changesDescriptor.value
        : undefined;
      if (!((typeof changes === "bigint" && changes === 1n) || changes === 1)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite operation-sequence-zero write must affect exactly one row",
        );
      }
      const totalChanges = this.#readTotalChangesCounter();
      if (totalChanges - state.totalChanges !== 1) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite operation-sequence-zero write disagreed with total_changes",
        );
      }
      state.totalChanges = totalChanges;
      state.affectedRows = totalChanges - state.initialTotalChanges;
      state.lifecycle = "completed";
      return objectFreezeIntrinsic({
        affectedRowsDelta: 1,
        completedExecutionCount: 1,
        executeCount: 1,
        prepareCount: 1,
        totalChanges,
        transactionEpoch: state.transactionEpoch,
        transactionLineage: state.transactionLineage,
      });
    } catch (error) {
      this.#synchronizeOperationSequenceZeroAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }
  }

  #synchronizeOperationSequenceZeroAfterFailure(
    state: OperationSequenceZeroExecutionState,
  ): void {
    state.transactionEpoch = this.#transactionEpoch;
    try {
      if (this.#database.isOpen) {
        state.totalChanges = this.#readTotalChangesCounter();
        const delta = state.totalChanges - state.initialTotalChanges;
        if (numberIsSafeIntegerIntrinsic(delta) && delta >= 0) {
          state.affectedRows = delta;
        }
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
const sqliteConnectionBeginBaselineEntryPublicationIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_BEGIN_BASELINE_ENTRY_PUBLICATION];
const sqliteConnectionExecuteBaselineEntryPublicationNextIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_EXECUTE_BASELINE_ENTRY_PUBLICATION_NEXT];
const sqliteConnectionBeginBaselineHeaderPublicationIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_BEGIN_BASELINE_HEADER_PUBLICATION];
const sqliteConnectionExecuteBaselineHeaderPublicationIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_EXECUTE_BASELINE_HEADER_PUBLICATION];
const sqliteConnectionBeginOperationSequenceZeroIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_BEGIN_OPERATION_SEQUENCE_ZERO];
const sqliteConnectionExecuteOperationSequenceZeroIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_EXECUTE_OPERATION_SEQUENCE_ZERO];
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

/** Prepare the exact baseline-entry INSERT once under the live exclusive owner. */
export function beginSQLiteConnectionBaselineEntryPublicationExecutionIntrinsic(
  connection: SQLiteConnection,
  expectedEntryCount: number,
): SQLiteConnectionBaselineEntryPublicationExecution {
  return reflectApplyIntrinsic(
    sqliteConnectionBeginBaselineEntryPublicationIntrinsic,
    connection,
    [expectedEntryCount],
  );
}

/** Run the next exact seven-parameter baseline-entry INSERT sequentially. */
export function executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionBaselineEntryPublicationExecution,
  row: SQLiteConnectionBaselineEntryPublicationRow,
): SQLiteConnectionBaselineEntryPublicationStepSnapshot {
  return reflectApplyIntrinsic(
    sqliteConnectionExecuteBaselineEntryPublicationNextIntrinsic,
    connection,
    [execution, row],
  );
}

/** Read real prepared/run/row/counter progress, including after failure. */
export function readSQLiteConnectionBaselineEntryPublicationExecutionSnapshotIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionBaselineEntryPublicationExecution,
): SQLiteConnectionBaselineEntryPublicationExecutionSnapshot {
  const state = execution !== null && typeof execution === "object" && !isProxy(execution)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_ENTRY_PUBLICATION_EXECUTIONS, [
      execution as object,
    ]) as BaselineEntryPublicationExecutionState | undefined
    : undefined;
  if (state === undefined || state.connection !== connection) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite baseline-entry publication execution is invalid",
    );
  }
  return objectFreezeIntrinsic({
    affectedRows: state.affectedRows,
    completedEntryCount: state.completedEntryCount,
    executeCount: state.executeCount,
    expectedEntryCount: state.expectedEntryCount,
    lifecycle: state.lifecycle,
    nextEntryOrdinal: state.nextEntryOrdinal,
    prepareCount: 1,
    totalChanges: state.totalChanges,
    totalChangesDelta: state.totalChanges - state.initialTotalChanges,
    transactionEpoch: state.transactionEpoch,
    transactionLineage: state.transactionLineage,
  });
}

/** Prepare the exact baseline-header INSERT once under the live exclusive owner. */
export function beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic(
  connection: SQLiteConnection,
): SQLiteConnectionBaselineHeaderPublicationExecution {
  return reflectApplyIntrinsic(
    sqliteConnectionBeginBaselineHeaderPublicationIntrinsic,
    connection,
    [],
  );
}

/** Run the exact fourteen-parameter baseline-header INSERT once. */
export function executeSQLiteConnectionBaselineHeaderPublicationIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionBaselineHeaderPublicationExecution,
  row: SQLiteConnectionBaselineHeaderPublicationRow,
): SQLiteConnectionBaselineHeaderPublicationStepSnapshot {
  return reflectApplyIntrinsic(
    sqliteConnectionExecuteBaselineHeaderPublicationIntrinsic,
    connection,
    [execution, row],
  );
}

/** Read real prepare/run/row/counter progress, including after failure. */
export function readSQLiteConnectionBaselineHeaderPublicationExecutionSnapshotIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionBaselineHeaderPublicationExecution,
): SQLiteConnectionBaselineHeaderPublicationExecutionSnapshot {
  const state = execution !== null && typeof execution === "object" && !isProxy(execution)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_HEADER_PUBLICATION_EXECUTIONS, [
      execution as object,
    ]) as BaselineHeaderPublicationExecutionState | undefined
    : undefined;
  if (state === undefined || state.connection !== connection) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite baseline-header publication execution is invalid",
    );
  }
  return objectFreezeIntrinsic({
    affectedRows: state.affectedRows,
    completedExecutionCount: state.completedExecutionCount,
    executeCount: state.executeCount,
    lifecycle: state.lifecycle,
    prepareCount: 1,
    totalChanges: state.totalChanges,
    totalChangesDelta: state.totalChanges - state.initialTotalChanges,
    transactionEpoch: state.transactionEpoch,
    transactionLineage: state.transactionLineage,
  });
}

/** Prepare the exact singleton operation-sequence-zero INSERT once. */
export function beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic(
  connection: SQLiteConnection,
): SQLiteConnectionOperationSequenceZeroExecution {
  return reflectApplyIntrinsic(
    sqliteConnectionBeginOperationSequenceZeroIntrinsic,
    connection,
    [],
  );
}

/** Run the exact three-parameter operation-sequence-zero INSERT once. */
export function executeSQLiteConnectionOperationSequenceZeroIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionOperationSequenceZeroExecution,
  row: SQLiteConnectionOperationSequenceZeroRow,
): SQLiteConnectionOperationSequenceZeroStepSnapshot {
  return reflectApplyIntrinsic(
    sqliteConnectionExecuteOperationSequenceZeroIntrinsic,
    connection,
    [execution, row],
  );
}

/** Read real prepare/run/row/counter progress, including after failure. */
export function readSQLiteConnectionOperationSequenceZeroExecutionSnapshotIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionOperationSequenceZeroExecution,
): SQLiteConnectionOperationSequenceZeroExecutionSnapshot {
  const state = execution !== null && typeof execution === "object" && !isProxy(execution)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, OPERATION_SEQUENCE_ZERO_EXECUTIONS, [
      execution as object,
    ]) as OperationSequenceZeroExecutionState | undefined
    : undefined;
  if (state === undefined || state.connection !== connection) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite operation-sequence-zero execution is invalid",
    );
  }
  return objectFreezeIntrinsic({
    affectedRows: state.affectedRows,
    completedExecutionCount: state.completedExecutionCount,
    executeCount: state.executeCount,
    lifecycle: state.lifecycle,
    prepareCount: 1,
    totalChanges: state.totalChanges,
    totalChangesDelta: state.totalChanges - state.initialTotalChanges,
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
