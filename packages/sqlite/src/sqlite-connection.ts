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
import {
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_INTRINSIC,
  type SQLiteCursorPublicationRebindParameters,
  type SQLiteCursorPublicationRebindParameterTuple,
} from "./cursor-publication-rebind-contract.js";
import {
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
  SQLiteCursorSealAccumulator,
  decodeSQLiteCursorSealRow,
} from "./operation-baseline-cursor-invariants.js";

const databasePrepareIntrinsic = DatabaseSync.prototype.prepare;
const databaseCloseIntrinsic = DatabaseSync.prototype.close;
const reflectApplyIntrinsic = Reflect.apply;
const reflectOwnKeysIntrinsic = Reflect.ownKeys;
const objectFreezeIntrinsic = Object.freeze;
const objectCreateIntrinsic = Object.create;
const objectGetOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOfIntrinsic = Object.getPrototypeOf;
const functionToStringIntrinsic = Function.prototype.toString;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const mathMaxIntrinsic = Math.max;
const stringCharCodeAtIntrinsic = String.prototype.charCodeAt;
const stringIndexOfIntrinsic = String.prototype.indexOf;
const stringSliceIntrinsic = String.prototype.slice;
const stringStartsWithIntrinsic = String.prototype.startsWith;
const stringToUpperCaseIntrinsic = String.prototype.toUpperCase;
const arrayIncludesIntrinsic = Array.prototype.includes;
const setHasIntrinsic = Set.prototype.has;
const regexpExecIntrinsic = RegExp.prototype.exec;
const regexpReplaceIntrinsic = RegExp.prototype[Symbol.replace];
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
  | "cursor-publication-migration-0002-temp-conflicts"
  | "cursor-publication-migration-lock"
  | "cursor-publication-initial-stage-schema-version"
  | "cursor-publication-initial-stage-main-operations";

type SQLiteConnectionPrivateNativeReadKind = SQLiteConnectionNativeReadKind
  | "cursor-publication-post-rebind-main-key-count"
  | "cursor-publication-post-rebind-key-driver"
  | "cursor-publication-post-rebind-point-lookup";

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

/** Opaque, connection-owned single-use cursor identity rebind execution. */
export interface SQLiteConnectionCursorRebindExecution {
  readonly __sqliteConnectionCursorRebindExecution: never;
}

export interface SQLiteConnectionCursorRebindStepSnapshot {
  readonly affectedRows: number;
  readonly changesAffectedRows: number;
  readonly changesFetchCount: 1;
  readonly changesPrepareCount: 1;
  readonly changesReleaseCount: 1;
  readonly changesSql: typeof SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC;
  readonly changesSqlSha256: typeof SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC;
  readonly cursorLedgerAffectedRowsWatermark: number;
  readonly cursorLedgerFixedStatementCount: 1;
  readonly cursorLedgerLogicalWriteSequence: 1;
  readonly executeCount: 1;
  readonly executionOrdinal: 1;
  readonly parameterOrder: typeof SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC;
  readonly parameterValues: SQLiteCursorPublicationRebindParameterTuple;
  readonly prepareCount: 1;
  readonly releaseCount: 1;
  readonly sql: typeof SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC;
  readonly sqlSha256: typeof SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC;
  readonly totalChangesAfter: number;
  readonly totalChangesBefore: number;
  readonly totalChangesDelta: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

export interface SQLiteConnectionCursorRebindExecutionSnapshot {
  readonly affectedRows: number;
  readonly changesAffectedRows: number | null;
  readonly changesFetchCount: 0 | 1;
  readonly changesPrepareCount: 0 | 1;
  readonly changesReleaseCount: 0 | 1;
  readonly changesSql: typeof SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC;
  readonly changesSqlSha256: typeof SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC;
  readonly cursorLedgerAffectedRowsWatermark: number;
  readonly cursorLedgerFixedStatementCount: 0 | 1;
  readonly cursorLedgerLogicalWriteSequence: 0 | 1;
  readonly executeCount: 0 | 1;
  readonly lifecycle: "active" | "released" | "completed" | "poisoned";
  readonly parameterOrder: typeof SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC;
  readonly parameterValues: SQLiteCursorPublicationRebindParameterTuple | null;
  readonly prepareCount: 1;
  readonly releaseCount: 0 | 1;
  readonly sql: typeof SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC;
  readonly sqlSha256: typeof SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC;
  readonly statementOwnershipRetired: boolean;
  readonly totalChangesAfter: number;
  readonly totalChangesBefore: number;
  readonly totalChangesDelta: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

/** Opaque owner for one exact, bounded post-rebind seal scan. */
export interface SQLiteConnectionPostRebindSealScanExecution {
  readonly __sqliteConnectionPostRebindSealScanExecution: never;
}

export interface SQLiteConnectionPostRebindSealScanSnapshot {
  readonly lifecycle: "active" | "completed" | "released" | "poisoned";
  readonly mainKeyCount: number;
  readonly driverCount: number;
  readonly lookupCount: number;
  readonly pointStatementExecuteCount: number;
  readonly mainKeyCountPrepareCount: 0 | 1;
  readonly mainKeyCountTerminalFetchCount: 0 | 1;
  readonly mainKeyCountCloseAttemptCount: number;
  readonly mainKeyCountCloseCount: 0 | 1;
  readonly driverPrepareCount: 0 | 1;
  readonly driverTerminalFetchCount: 0 | 1;
  readonly driverCloseAttemptCount: number;
  readonly driverCloseCount: 0 | 1;
  readonly pointStatementPrepareCount: 0 | 1;
  readonly pointStatementReleaseCount: 0 | 1;
  readonly pointCursorCreatedCount: number;
  readonly pointCursorCloseAttemptCount: number;
  readonly pointCursorClosedCount: number;
  readonly activeCursors: number;
  readonly livePhysicalRows: number;
  readonly liveCarriers: number;
  readonly maximumActiveCursors: number;
  readonly maximumLivePhysicalRows: number;
  readonly maximumLiveCarriers: number;
  readonly mainStatementOwned: boolean;
  readonly mainIteratorOwned: boolean;
  readonly driverStatementOwned: boolean;
  readonly driverIteratorOwned: boolean;
  readonly pointStatementOwned: boolean;
  readonly pointIteratorOwned: boolean;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly totalChanges: number;
}

export interface SQLiteConnectionPostRebindSealScanEvidence
  extends SQLiteConnectionPostRebindSealScanSnapshot {
  readonly lifecycle: "completed";
  readonly mainKeyCountPrepareCount: 1;
  readonly mainKeyCountTerminalFetchCount: 1;
  readonly mainKeyCountCloseAttemptCount: 1;
  readonly mainKeyCountCloseCount: 1;
  readonly driverPrepareCount: 1;
  readonly driverTerminalFetchCount: 1;
  readonly driverCloseAttemptCount: 1;
  readonly driverCloseCount: 1;
  readonly pointStatementPrepareCount: 1;
  readonly pointStatementReleaseCount: 1;
  readonly accumulatorCount: number;
  readonly computedImmutableRootSha256: string;
  readonly observedDescriptorHash: string | null;
  readonly observedSchemaIdentitySha256: string | null;
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

interface CursorRebindExecutionState {
  affectedRows: number;
  changesAffectedRows: number | null;
  changesFetchCount: 0 | 1;
  changesPrepareCount: 0 | 1;
  changesReleaseCount: 0 | 1;
  readonly connection: SQLiteConnection;
  cursorLedgerAffectedRowsWatermark: number;
  cursorLedgerFixedStatementCount: 0 | 1;
  cursorLedgerLogicalWriteSequence: 0 | 1;
  executeCount: 0 | 1;
  lifecycle: "active" | "released" | "completed" | "poisoned";
  parameterValues: SQLiteCursorPublicationRebindParameterTuple | null;
  releaseCount: 0 | 1;
  statement: StatementSync | null;
  totalChangesAfter: number;
  readonly totalChangesBefore: number;
  transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

interface PostRebindSealScanKey {
  readonly tenantId: string;
  readonly tokenHash: string;
}

interface PostRebindSealScanState {
  readonly connection: SQLiteConnection;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly totalChanges: number;
  lifecycle: "active" | "completed" | "released" | "poisoned";
  mainKeyCount: number;
  driverCount: number;
  lookupCount: number;
  pointStatementExecuteCount: number;
  mainKeyCountPrepareCount: 0 | 1;
  mainKeyCountTerminalFetchCount: 0 | 1;
  mainKeyCountCloseAttemptCount: number;
  mainKeyCountCloseCount: 0 | 1;
  driverPrepareCount: 0 | 1;
  driverTerminalFetchCount: 0 | 1;
  driverCloseAttemptCount: number;
  driverCloseCount: 0 | 1;
  pointStatementPrepareCount: 0 | 1;
  pointStatementReleaseCount: 0 | 1;
  pointCursorCreatedCount: number;
  pointCursorCloseAttemptCount: number;
  pointCursorClosedCount: number;
  activeCursors: number;
  livePhysicalRows: number;
  liveCarriers: number;
  maximumActiveCursors: number;
  maximumLivePhysicalRows: number;
  maximumLiveCarriers: number;
  mainStatement: StatementSync | null;
  mainIterator: SQLiteNativeStatementIterator | null;
  driverStatement: StatementSync | null;
  driverIterator: SQLiteNativeStatementIterator | null;
  pointStatement: StatementSync | null;
  pointIterator: SQLiteNativeStatementIterator | null;
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
const CURSOR_REBIND_EXECUTIONS = new WeakMap<object, CursorRebindExecutionState>();
const POST_REBIND_SEAL_SCAN_EXECUTIONS = new WeakMap<object, PostRebindSealScanState>();
let cursorRebindCleanupFaultForTest: Readonly<{ readonly error: unknown }> | undefined;
let postRebindSealScanCloseFaultForTest: Readonly<{
  readonly kind: "main-key-count" | "driver" | "point";
  readonly error: unknown;
}> | undefined;
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

function cursorRebindOwnValue(
  parameters: object,
  key: keyof SQLiteCursorPublicationRebindParameters,
): unknown {
  const descriptor = reflectApplyIntrinsic(
    objectGetOwnPropertyDescriptorIntrinsic,
    Object,
    [parameters, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite cursor rebind parameters are invalid",
    );
  }
  return descriptor.value;
}

function checkedCursorRebindParameters(
  parameters: SQLiteCursorPublicationRebindParameters,
): SQLiteCursorPublicationRebindParameterTuple {
  if (parameters === null || typeof parameters !== "object" || isProxy(parameters)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite cursor rebind parameters are invalid",
    );
  }
  const ownKeys = reflectApplyIntrinsic(reflectOwnKeysIntrinsic, Reflect, [parameters]) as
    readonly PropertyKey[];
  if (ownKeys.length !== SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC.length) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite cursor rebind parameters are invalid",
    );
  }
  for (const expected of SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC) {
    if (!reflectApplyIntrinsic(arrayIncludesIntrinsic, ownKeys, [expected])) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite cursor rebind parameters are invalid",
      );
    }
  }
  const targetDescriptorHash = cursorRebindOwnValue(parameters, "targetDescriptorHash");
  const targetSchemaIdentitySha256 = cursorRebindOwnValue(
    parameters, "targetSchemaIdentitySha256",
  );
  const sourceDescriptorHash = cursorRebindOwnValue(parameters, "sourceDescriptorHash");
  const sourceSchemaIdentitySha256 = cursorRebindOwnValue(
    parameters, "sourceSchemaIdentitySha256",
  );
  if (typeof targetDescriptorHash !== "string" || !isLowerHex64(targetDescriptorHash)
      || typeof targetSchemaIdentitySha256 !== "string"
      || !isLowerHex64(targetSchemaIdentitySha256)
      || typeof sourceDescriptorHash !== "string" || !isLowerHex64(sourceDescriptorHash)
      || typeof sourceSchemaIdentitySha256 !== "string"
      || !isLowerHex64(sourceSchemaIdentitySha256)
      || (targetDescriptorHash === sourceDescriptorHash
          && targetSchemaIdentitySha256 === sourceSchemaIdentitySha256)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite cursor rebind parameters are invalid",
    );
  }
  return objectFreezeIntrinsic([
    targetDescriptorHash,
    targetSchemaIdentitySha256,
    sourceDescriptorHash,
    sourceSchemaIdentitySha256,
  ]) as SQLiteCursorPublicationRebindParameterTuple;
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
    const whitespace = reflectApplyIntrinsic(regexpExecIntrinsic, /^\s+/u, [
      reflectApplyIntrinsic(stringSliceIntrinsic, sql, [offset]),
    ]) as RegExpExecArray | null;
    if (whitespace !== null) {
      offset += whitespace[0].length;
      continue;
    }
    if (reflectApplyIntrinsic(stringStartsWithIntrinsic, sql, ["--", offset])) {
      const newline = reflectApplyIntrinsic(stringIndexOfIntrinsic, sql, ["\n", offset + 2]) as
        number;
      if (newline < 0) return "";
      offset = newline + 1;
      continue;
    }
    if (reflectApplyIntrinsic(stringStartsWithIntrinsic, sql, ["/*", offset])) {
      const close = reflectApplyIntrinsic(stringIndexOfIntrinsic, sql, ["*/", offset + 2]) as
        number;
      if (close < 0) return "";
      offset = close + 2;
      continue;
    }
    break;
  }
  const token = reflectApplyIntrinsic(regexpExecIntrinsic, /^[A-Za-z]+/u, [
    reflectApplyIntrinsic(stringSliceIntrinsic, sql, [offset]),
  ]) as RegExpExecArray | null;
  return token === null
    ? ""
    : reflectApplyIntrinsic(stringToUpperCaseIntrinsic, token[0], []) as string;
}

function withoutEmptySQLitePrefix(sql: string): string {
  return reflectApplyIntrinsic(
    regexpReplaceIntrinsic,
    /^(?:(?:\s|;)+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/u,
    [sql, ""],
  ) as string;
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
  return reflectApplyIntrinsic(
    setHasIntrinsic, PREPARED_OWNER_MUTATION_TOKENS, [firstSQLiteToken(sql)],
  ) as boolean;
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
  return reflectApplyIntrinsic(
    regexpExecIntrinsic,
    /\bPRAGMA\b[\s\S]*\btemp_store_directory\b/iu,
    [withoutPrefix],
  ) !== null;
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
const SQLITE_CONNECTION_BEGIN_CURSOR_REBIND = Symbol(
  "SQLiteConnection.beginCursorRebind",
);
const SQLITE_CONNECTION_EXECUTE_CURSOR_REBIND = Symbol(
  "SQLiteConnection.executeCursorRebind",
);
const SQLITE_CONNECTION_RELEASE_CURSOR_REBIND = Symbol(
  "SQLiteConnection.releaseCursorRebind",
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
    return objectFreezeIntrinsic({
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
    return objectFreezeIntrinsic({
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
    if (reflectApplyIntrinsic(
      arrayIncludesIntrinsic,
      ["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"],
      [firstSQLiteToken(sql)],
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
    kind: SQLiteConnectionPrivateNativeReadKind,
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
          : kind === "cursor-publication-migration-lock"
            ? `
              SELECT active_lock_id, active_owner_id, active_source_version,
                     active_target_version, active_lock_epoch, active_fencing_token,
                     active_expires_at_ms
                FROM main.ge_cycle_migration_lock
               WHERE singleton = 1
            `
            : kind === "cursor-publication-initial-stage-schema-version"
              ? "SELECT schema_version FROM pragma_schema_version"
              : kind === "cursor-publication-initial-stage-main-operations"
                ? `SELECT type, name, tbl_name, rootpage, sql
                     FROM main.sqlite_schema
                    WHERE type = 'table' AND name = 'ge_cycle_operations'`
                : kind === "cursor-publication-post-rebind-main-key-count"
                  ? SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_INTRINSIC
                  : kind === "cursor-publication-post-rebind-key-driver"
                    ? SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_INTRINSIC
                    : kind === "cursor-publication-post-rebind-point-lookup"
                      ? SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_INTRINSIC
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

  [SQLITE_CONNECTION_BEGIN_CURSOR_REBIND](): SQLiteConnectionCursorRebindExecution {
    this.#assertOpen("inspect-schema");
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage === null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_STALE_FENCE",
        "inspect-schema",
        "SQLite cursor rebind requires the active BEGIN EXCLUSIVE owner",
      );
    }
    const transactionLineage = this.#transactionLineage;
    const transactionEpoch = this.#transactionEpoch;
    const totalChangesBefore = this.#readTotalChangesCounter();
    let statement: StatementSync;
    try {
      statement = hardenSQLiteNativeStatementIntrinsic(reflectApplyIntrinsic(
        databasePrepareIntrinsic,
        this.#database,
        [SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC],
      ) as StatementSync);
    } catch (error) {
      throw translateSQLiteError(error, "inspect-schema");
    }
    if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
        || this.#transactionLineage !== transactionLineage
        || this.#transactionEpoch !== transactionEpoch
        || this.#readTotalChangesCounter() !== totalChangesBefore) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite cursor rebind owner drifted during prepare",
      );
    }
    const execution = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteConnectionCursorRebindExecution;
    const state: CursorRebindExecutionState = {
      affectedRows: 0,
      changesAffectedRows: null,
      changesFetchCount: 0,
      changesPrepareCount: 0,
      changesReleaseCount: 0,
      connection: this,
      cursorLedgerAffectedRowsWatermark: 0,
      cursorLedgerFixedStatementCount: 0,
      cursorLedgerLogicalWriteSequence: 0,
      executeCount: 0,
      lifecycle: "active",
      parameterValues: null,
      releaseCount: 0,
      statement,
      totalChangesAfter: totalChangesBefore,
      totalChangesBefore,
      transactionEpoch,
      transactionLineage,
    };
    reflectApplyIntrinsic(weakMapSetIntrinsic, CURSOR_REBIND_EXECUTIONS, [
      execution as object,
      state,
    ]);
    return execution;
  }

  [SQLITE_CONNECTION_EXECUTE_CURSOR_REBIND](
    execution: SQLiteConnectionCursorRebindExecution,
    parameters: SQLiteCursorPublicationRebindParameters,
  ): SQLiteConnectionCursorRebindStepSnapshot {
    const state = execution !== null && typeof execution === "object" && !isProxy(execution)
      ? reflectApplyIntrinsic(weakMapGetIntrinsic, CURSOR_REBIND_EXECUTIONS, [
        execution as object,
      ]) as CursorRebindExecutionState | undefined
      : undefined;
    if (state === undefined || state.connection !== this) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite cursor rebind execution is invalid",
      );
    }
    if (state.lifecycle !== "active" || state.statement === null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite cursor rebind execution is terminal",
      );
    }

    let parameterValues: SQLiteCursorPublicationRebindParameterTuple;
    try {
      parameterValues = checkedCursorRebindParameters(parameters);
      this.#assertOpen("inspect-schema");
      if (!this.#database.isTransaction || this.#transactionMode !== "exclusive"
          || this.#transactionLineage !== state.transactionLineage
          || this.#transactionEpoch !== state.transactionEpoch
          || this.#readTotalChangesCounter() !== state.totalChangesBefore) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite cursor rebind execution owner drifted",
        );
      }
    } catch (error) {
      this.#retireCursorRebindStatement(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    state.parameterValues = parameterValues;
    state.executeCount = 1;
    this.#transactionEpoch += 1n;
    let rawResult: unknown;
    try {
      rawResult = reflectApplyIntrinsic(statementRunIntrinsic, state.statement, parameterValues);
    } catch (error) {
      state.transactionEpoch = this.#transactionEpoch;
      this.#retireCursorRebindStatement(state);
      this.#synchronizeCursorRebindAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }

    state.cursorLedgerLogicalWriteSequence = 1;
    state.cursorLedgerFixedStatementCount = 1;
    state.transactionEpoch = this.#transactionEpoch;
    try {
      if (rawResult === null || typeof rawResult !== "object" || isProxy(rawResult)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite cursor rebind result is invalid",
        );
      }
      const changesDescriptor = reflectApplyIntrinsic(
        objectGetOwnPropertyDescriptorIntrinsic,
        Object,
        [rawResult, "changes"],
      ) as PropertyDescriptor | undefined;
      const rawChanges = changesDescriptor !== undefined && "value" in changesDescriptor
        ? changesDescriptor.value
        : undefined;
      const affectedRows = typeof rawChanges === "bigint"
          && rawChanges >= 0n && rawChanges <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(rawChanges)
        : numberIsSafeIntegerIntrinsic(rawChanges) && (rawChanges as number) >= 0
          ? rawChanges as number
          : undefined;
      if (affectedRows === undefined) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite cursor rebind affected count is invalid",
        );
      }
      state.affectedRows = affectedRows;
      state.cursorLedgerAffectedRowsWatermark = affectedRows;
    } catch (error) {
      this.#retireCursorRebindStatement(state);
      this.#synchronizeCursorRebindAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }
    this.#retireCursorRebindStatement(state);

    let changesStatement: StatementSync | null = null;
    try {
      changesStatement = hardenSQLiteNativeStatementIntrinsic(reflectApplyIntrinsic(
        databasePrepareIntrinsic,
        this.#database,
        [SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC],
      ) as StatementSync);
      state.changesPrepareCount = 1;
      state.changesFetchCount = 1;
      const row = sqliteRow(
        reflectApplyIntrinsic(statementGetIntrinsic, changesStatement, []),
        1,
        "inspect-schema",
        "private SQLite cursor rebind changes result",
      );
      state.changesAffectedRows = sqliteSafeInteger(
        row[0],
        0,
        Number.MAX_SAFE_INTEGER,
        "inspect-schema",
        "private SQLite cursor rebind changes result",
      );
    } catch (error) {
      if (changesStatement !== null) state.changesReleaseCount = 1;
      this.#synchronizeCursorRebindAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }
    state.changesReleaseCount = 1;

    try {
      state.totalChangesAfter = this.#readTotalChangesCounter();
      const totalChangesDelta = state.totalChangesAfter - state.totalChangesBefore;
      if (!numberIsSafeIntegerIntrinsic(totalChangesDelta) || totalChangesDelta < 0
          || state.changesAffectedRows !== state.affectedRows
          || totalChangesDelta !== state.affectedRows
          || state.cursorLedgerAffectedRowsWatermark !== state.affectedRows) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite cursor rebind change observations disagree",
        );
      }
      state.lifecycle = "completed";
      return objectFreezeIntrinsic({
        affectedRows: state.affectedRows,
        changesAffectedRows: state.changesAffectedRows,
        changesFetchCount: 1,
        changesPrepareCount: 1,
        changesReleaseCount: 1,
        changesSql: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
        changesSqlSha256: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
        cursorLedgerAffectedRowsWatermark: state.cursorLedgerAffectedRowsWatermark,
        cursorLedgerFixedStatementCount: 1,
        cursorLedgerLogicalWriteSequence: 1,
        executeCount: 1,
        executionOrdinal: 1,
        parameterOrder: SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
        parameterValues: state.parameterValues,
        prepareCount: 1,
        releaseCount: 1,
        sql: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
        sqlSha256: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
        totalChangesAfter: state.totalChangesAfter,
        totalChangesBefore: state.totalChangesBefore,
        totalChangesDelta,
        transactionEpoch: state.transactionEpoch,
        transactionLineage: state.transactionLineage,
      });
    } catch (error) {
      this.#synchronizeCursorRebindAfterFailure(state);
      state.lifecycle = "poisoned";
      throw translateSQLiteError(error, "inspect-schema");
    }
  }

  [SQLITE_CONNECTION_RELEASE_CURSOR_REBIND](
    execution: SQLiteConnectionCursorRebindExecution,
  ): void {
    const state = execution !== null && typeof execution === "object" && !isProxy(execution)
      ? reflectApplyIntrinsic(weakMapGetIntrinsic, CURSOR_REBIND_EXECUTIONS, [
        execution as object,
      ]) as CursorRebindExecutionState | undefined
      : undefined;
    if (state === undefined || state.connection !== this) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "inspect-schema",
        "SQLite cursor rebind execution is invalid",
      );
    }
    if (state.lifecycle !== "active" || state.statement === null
        || state.executeCount !== 0 || state.releaseCount !== 0) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite cursor rebind release is terminal",
      );
    }
    this.#retireCursorRebindStatement(state);
    state.lifecycle = "released";
  }

  #retireCursorRebindStatement(state: CursorRebindExecutionState): void {
    if (state.statement !== null) {
      state.statement = null;
      state.releaseCount = 1;
    }
  }

  #synchronizeCursorRebindAfterFailure(state: CursorRebindExecutionState): void {
    state.transactionEpoch = this.#transactionEpoch;
    try {
      if (cursorRebindCleanupFaultForTest !== undefined) {
        const { error } = cursorRebindCleanupFaultForTest;
        cursorRebindCleanupFaultForTest = undefined;
        throw error;
      }
      if (this.#database.isOpen) {
        state.totalChangesAfter = this.#readTotalChangesCounter();
      }
    } catch {
      // The original execution/result/counter failure remains primary.
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
const sqliteConnectionBeginCursorRebindIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_BEGIN_CURSOR_REBIND];
const sqliteConnectionExecuteCursorRebindIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_EXECUTE_CURSOR_REBIND];
const sqliteConnectionReleaseCursorRebindIntrinsic =
  SQLiteConnection.prototype[SQLITE_CONNECTION_RELEASE_CURSOR_REBIND];
const sqliteConnectionExecTrustedIntrinsic = SQLiteConnection.prototype.execTrusted;
const sqliteConnectionPrepareIntrinsic = SQLiteConnection.prototype.prepare;

const POST_REBIND_ZERO_IDENTITY = "0".repeat(64);

function postRebindSealScanState(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealScanExecution,
): PostRebindSealScanState {
  const state = execution !== null && typeof execution === "object" && !isProxy(execution)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, POST_REBIND_SEAL_SCAN_EXECUTIONS, [
      execution as object,
    ]) as PostRebindSealScanState | undefined
    : undefined;
  if (state === undefined || state.connection !== connection) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite post-rebind seal scan execution is invalid",
    );
  }
  return state;
}

function assertPostRebindSealScanOwner(state: PostRebindSealScanState): void {
  const owner = reflectApplyIntrinsic(
    sqliteConnectionOwnerSnapshotIntrinsic, state.connection, [],
  ) as SQLiteConnectionOwnerSnapshot;
  const total = reflectApplyIntrinsic(
    sqliteConnectionTotalChangesSnapshotIntrinsic, state.connection, [],
  ) as SQLiteConnectionTotalChangesSnapshot;
  if (!owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage !== state.transactionLineage
      || owner.transactionEpoch !== state.transactionEpoch
      || total.transactionEpoch !== state.transactionEpoch
      || total.totalChanges !== state.totalChanges) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite post-rebind seal scan connection lineage drifted",
    );
  }
}

function postRebindSealScanPrepare(
  state: PostRebindSealScanState,
  kind: Exclude<SQLiteConnectionPrivateNativeReadKind, SQLiteConnectionNativeReadKind>,
): StatementSync {
  return reflectApplyIntrinsic(
    sqliteConnectionPrepareNativeReadIntrinsic,
    state.connection,
    [kind, "inspect-schema"],
  ) as StatementSync;
}

function postRebindSealScanEnterCursor(state: PostRebindSealScanState): void {
  state.activeCursors += 1;
  state.maximumActiveCursors = mathMaxIntrinsic(
    state.maximumActiveCursors, state.activeCursors,
  );
  if (state.maximumActiveCursors > 2) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite post-rebind seal scan cursor budget exceeded",
    );
  }
}

function closePostRebindSealScanIterator(
  state: PostRebindSealScanState,
  kind: "main-key-count" | "driver" | "point",
): void {
  const iterator = kind === "main-key-count"
    ? state.mainIterator
    : kind === "driver" ? state.driverIterator : state.pointIterator;
  if (iterator === null) return;
  if (postRebindSealScanCloseFaultForTest?.kind === kind) {
    const error = postRebindSealScanCloseFaultForTest.error;
    postRebindSealScanCloseFaultForTest = undefined;
    throw error;
  }
  reflectApplyIntrinsic(nativeStatementIteratorIntrinsics().return, iterator, []);
  if (kind === "main-key-count") state.mainIterator = null;
  else if (kind === "driver") state.driverIterator = null;
  else state.pointIterator = null;
  state.activeCursors -= 1;
}

function closePostRebindSealScanPreservingPrimary(
  state: PostRebindSealScanState,
  kind: "main-key-count" | "driver" | "point",
  primary: Readonly<{ readonly hasPrimary: boolean; readonly value: unknown }>,
): Readonly<{
  readonly primary: Readonly<{ readonly hasPrimary: boolean; readonly value: unknown }>;
  readonly succeeded: boolean;
}> {
  try {
    closePostRebindSealScanIterator(state, kind);
    return objectFreezeIntrinsic({ primary, succeeded: true });
  } catch (cleanupError) {
    return objectFreezeIntrinsic({
      primary: primary.hasPrimary
        ? primary
        : objectFreezeIntrinsic({ hasPrimary: true, value: cleanupError }),
      succeeded: false,
    });
  }
}

function checkedPostRebindSealScanKey(value: unknown, label: string): PostRebindSealScanKey {
  const row = sqliteRow(value, 2, "inspect-schema", label);
  const tenantId = sqliteText(row[0], "inspect-schema", `${label} tenant`);
  const tokenHash = sqliteText(row[1], "inspect-schema", `${label} token hash`);
  let tenantValid = tenantId.length >= 1 && tenantId.length <= 128;
  for (let index = 0; tenantValid && index < tenantId.length; index += 1) {
    const code = reflectApplyIntrinsic(stringCharCodeAtIntrinsic, tenantId, [index]) as number;
    tenantValid = (code >= 48 && code <= 57)
      || (code >= 65 && code <= 90)
      || (code >= 97 && code <= 122)
      || (index > 0 && (code === 45 || code === 46 || code === 95));
  }
  if (!tenantValid || !isLowerHex64(tokenHash)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      `SQLite ${label} is invalid`,
    );
  }
  return objectFreezeIntrinsic({ tenantId, tokenHash });
}

function comparePostRebindSealScanMainKey(
  left: PostRebindSealScanKey,
  right: PostRebindSealScanKey,
): number {
  return left.tenantId < right.tenantId ? -1
    : left.tenantId > right.tenantId ? 1
      : left.tokenHash < right.tokenHash ? -1 : left.tokenHash > right.tokenHash ? 1 : 0;
}

function comparePostRebindSealScanDriverKey(
  left: PostRebindSealScanKey,
  right: PostRebindSealScanKey,
): number {
  return left.tokenHash < right.tokenHash ? -1
    : left.tokenHash > right.tokenHash ? 1
      : left.tenantId < right.tenantId ? -1 : left.tenantId > right.tenantId ? 1 : 0;
}

function nextPostRebindSealScanKey(
  state: PostRebindSealScanState,
  iterator: SQLiteNativeStatementIterator,
  label: string,
): Readonly<{ readonly done: true }> | Readonly<{
  readonly done: false;
  readonly key: PostRebindSealScanKey;
}> {
  let fetched: IteratorResult<unknown> | undefined = reflectApplyIntrinsic(
    nativeStatementIteratorIntrinsics().next, iterator, [],
  ) as IteratorResult<unknown>;
  if (fetched.done) {
    fetched = undefined;
    return objectFreezeIntrinsic({ done: true });
  }
  state.livePhysicalRows += 1;
  state.maximumLivePhysicalRows = mathMaxIntrinsic(
    state.maximumLivePhysicalRows, state.livePhysicalRows,
  );
  let key: PostRebindSealScanKey;
  try {
    if (state.maximumLivePhysicalRows > 1) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite post-rebind seal scan physical-row budget exceeded",
      );
    }
    key = checkedPostRebindSealScanKey(fetched.value, label);
  } finally {
    fetched = undefined;
    state.livePhysicalRows -= 1;
  }
  return objectFreezeIntrinsic({ done: false, key });
}

function scanPostRebindMainKeys(state: PostRebindSealScanState): number {
  let previous: PostRebindSealScanKey | undefined;
  let primary: Readonly<{ readonly hasPrimary: boolean; readonly value: unknown }> =
    objectFreezeIntrinsic({ hasPrimary: false, value: undefined });
  try {
    state.mainStatement = postRebindSealScanPrepare(
      state, "cursor-publication-post-rebind-main-key-count",
    );
    state.mainKeyCountPrepareCount = 1;
    state.mainIterator = reflectApplyIntrinsic(
      statementIterateIntrinsic, state.mainStatement, [],
    ) as SQLiteNativeStatementIterator;
    postRebindSealScanEnterCursor(state);
    while (true) {
      const fetched = nextPostRebindSealScanKey(
        state, state.mainIterator, "post-rebind main key",
      );
      if (fetched.done) {
        state.mainKeyCountTerminalFetchCount = 1;
        break;
      }
      if (previous !== undefined && comparePostRebindSealScanMainKey(fetched.key, previous) <= 0) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite post-rebind main key order is invalid",
        );
      }
      previous = fetched.key;
      state.mainKeyCount += 1;
      if (!numberIsSafeIntegerIntrinsic(state.mainKeyCount)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite post-rebind main key count is unsafe",
        );
      }
    }
  } catch (error) {
    primary = objectFreezeIntrinsic({ hasPrimary: true, value: error });
  }
  if (state.mainIterator !== null) {
    state.mainKeyCountCloseAttemptCount = 1;
    const close = closePostRebindSealScanPreservingPrimary(
      state, "main-key-count", primary,
    );
    primary = close.primary;
    if (close.succeeded) {
      state.mainKeyCountCloseCount = 1;
      state.mainStatement = null;
    }
  }
  if (primary.hasPrimary) throw primary.value;
  return state.mainKeyCount;
}

function consumePostRebindPointRow(
  state: PostRebindSealScanState,
  key: PostRebindSealScanKey,
  consume: (row: ReturnType<typeof decodeSQLiteCursorSealRow>) => void,
): void {
  state.pointStatementExecuteCount += 1;
  state.pointIterator = reflectApplyIntrinsic(
    statementIterateIntrinsic,
    state.pointStatement,
    [key.tenantId, key.tokenHash],
  ) as SQLiteNativeStatementIterator;
  state.pointCursorCreatedCount += 1;
  postRebindSealScanEnterCursor(state);
  let primary: Readonly<{ readonly hasPrimary: boolean; readonly value: unknown }> =
    objectFreezeIntrinsic({ hasPrimary: false, value: undefined });
  try {
    let fetched: IteratorResult<unknown> | undefined = reflectApplyIntrinsic(
      nativeStatementIteratorIntrinsics().next, state.pointIterator, [],
    ) as IteratorResult<unknown>;
    if (fetched.done) {
      fetched = undefined;
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite post-rebind point lookup row is missing",
      );
    }
    state.livePhysicalRows += 1;
    state.maximumLivePhysicalRows = mathMaxIntrinsic(
      state.maximumLivePhysicalRows, state.livePhysicalRows,
    );
    let decoded: ReturnType<typeof decodeSQLiteCursorSealRow> | undefined;
    try {
      if (state.maximumLivePhysicalRows > 1) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite post-rebind seal scan physical-row budget exceeded",
        );
      }
      decoded = decodeSQLiteCursorSealRow(fetched.value);
      fetched = undefined;
      state.liveCarriers += 1;
      state.maximumLiveCarriers = mathMaxIntrinsic(
        state.maximumLiveCarriers, state.liveCarriers,
      );
      try {
        if (state.maximumLiveCarriers > 1) {
          throw new CycleStoreProviderError(
            "GE_CYCLE_STORE_CORRUPTION",
            "inspect-schema",
            "SQLite post-rebind seal scan carrier budget exceeded",
          );
        }
        consume(decoded);
      } finally {
        decoded = undefined;
        state.liveCarriers -= 1;
      }
    } finally {
      fetched = undefined;
      state.livePhysicalRows -= 1;
    }
  } catch (error) {
    primary = objectFreezeIntrinsic({ hasPrimary: true, value: error });
  }
  if (state.pointIterator !== null) {
    state.pointCursorCloseAttemptCount += 1;
    const close = closePostRebindSealScanPreservingPrimary(state, "point", primary);
    primary = close.primary;
    if (close.succeeded) state.pointCursorClosedCount += 1;
  }
  if (primary.hasPrimary) throw primary.value;
}

function scanPostRebindDrivenSeal(
  state: PostRebindSealScanState,
  mainKeyCount: number,
): Readonly<{
  readonly accumulatorCount: number;
  readonly computedImmutableRootSha256: string;
  readonly observedDescriptorHash: string | null;
  readonly observedSchemaIdentitySha256: string | null;
}> {
  let accumulator: SQLiteCursorSealAccumulator | undefined;
  let observedDescriptorHash: string | null = null;
  let observedSchemaIdentitySha256: string | null = null;
  let previous: PostRebindSealScanKey | undefined;
  let primary: Readonly<{ readonly hasPrimary: boolean; readonly value: unknown }> =
    objectFreezeIntrinsic({ hasPrimary: false, value: undefined });
  try {
    state.driverStatement = postRebindSealScanPrepare(
      state, "cursor-publication-post-rebind-key-driver",
    );
    state.driverPrepareCount = 1;
    state.pointStatement = postRebindSealScanPrepare(
      state, "cursor-publication-post-rebind-point-lookup",
    );
    state.pointStatementPrepareCount = 1;
    state.driverIterator = reflectApplyIntrinsic(
      statementIterateIntrinsic, state.driverStatement, [],
    ) as SQLiteNativeStatementIterator;
    postRebindSealScanEnterCursor(state);
    while (true) {
      const fetched = nextPostRebindSealScanKey(
        state, state.driverIterator, "post-rebind driver key",
      );
      if (fetched.done) {
        state.driverTerminalFetchCount = 1;
        break;
      }
      if (previous !== undefined
          && comparePostRebindSealScanDriverKey(fetched.key, previous) <= 0) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite post-rebind driver key order is invalid",
        );
      }
      previous = fetched.key;
      state.driverCount += 1;
      if (!numberIsSafeIntegerIntrinsic(state.driverCount)) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          "inspect-schema",
          "SQLite post-rebind driver count is unsafe",
        );
      }
      consumePostRebindPointRow(state, fetched.key, (row) => {
        if (row.carrier.tenantId !== fetched.key.tenantId
            || row.carrier.tokenHash !== fetched.key.tokenHash) {
          throw new CycleStoreProviderError(
            "GE_CYCLE_STORE_CORRUPTION",
            "inspect-schema",
            "SQLite post-rebind point lookup identity is invalid",
          );
        }
        if (accumulator === undefined) {
          observedDescriptorHash = row.descriptorHash;
          observedSchemaIdentitySha256 = row.schemaIdentitySha256;
          accumulator = new SQLiteCursorSealAccumulator(
            mainKeyCount, observedDescriptorHash, observedSchemaIdentitySha256,
          );
        }
        accumulator.append(row);
        state.lookupCount += 1;
      });
      assertPostRebindSealScanOwner(state);
    }
  } catch (error) {
    primary = objectFreezeIntrinsic({ hasPrimary: true, value: error });
  }
  if (state.pointIterator === null && state.pointStatement !== null) {
    state.pointStatement = null;
    state.pointStatementReleaseCount = 1;
  }
  if (state.driverIterator !== null) {
    state.driverCloseAttemptCount = 1;
    const close = closePostRebindSealScanPreservingPrimary(state, "driver", primary);
    primary = close.primary;
    if (close.succeeded) {
      state.driverCloseCount = 1;
      state.driverStatement = null;
    }
  }
  if (primary.hasPrimary) throw primary.value;
  if (state.driverCount !== mainKeyCount
      || state.pointStatementExecuteCount !== mainKeyCount) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite post-rebind seal scan counts disagree",
    );
  }
  if (accumulator === undefined) {
    if (mainKeyCount !== 0) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite post-rebind seal accumulator is missing",
      );
    }
    const empty = new SQLiteCursorSealAccumulator(
      0, POST_REBIND_ZERO_IDENTITY, POST_REBIND_ZERO_IDENTITY,
    ).finish();
    if (empty.immutableRootSha256 !== SQLITE_CURSOR_SEAL_EMPTY_ROOT) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite post-rebind empty seal root drifted",
      );
    }
    return objectFreezeIntrinsic({
      accumulatorCount: 0,
      computedImmutableRootSha256: empty.immutableRootSha256,
      observedDescriptorHash: null,
      observedSchemaIdentitySha256: null,
    });
  }
  const seal = accumulator.finish();
  return objectFreezeIntrinsic({
    accumulatorCount: seal.cursorCount,
    computedImmutableRootSha256: seal.immutableRootSha256,
    observedDescriptorHash,
    observedSchemaIdentitySha256,
  });
}

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

function postRebindSealScanSnapshot(
  state: PostRebindSealScanState,
): SQLiteConnectionPostRebindSealScanSnapshot {
  return objectFreezeIntrinsic({
    lifecycle: state.lifecycle,
    mainKeyCount: state.mainKeyCount,
    driverCount: state.driverCount,
    lookupCount: state.lookupCount,
    pointStatementExecuteCount: state.pointStatementExecuteCount,
    mainKeyCountPrepareCount: state.mainKeyCountPrepareCount,
    mainKeyCountTerminalFetchCount: state.mainKeyCountTerminalFetchCount,
    mainKeyCountCloseAttemptCount: state.mainKeyCountCloseAttemptCount,
    mainKeyCountCloseCount: state.mainKeyCountCloseCount,
    driverPrepareCount: state.driverPrepareCount,
    driverTerminalFetchCount: state.driverTerminalFetchCount,
    driverCloseAttemptCount: state.driverCloseAttemptCount,
    driverCloseCount: state.driverCloseCount,
    pointStatementPrepareCount: state.pointStatementPrepareCount,
    pointStatementReleaseCount: state.pointStatementReleaseCount,
    pointCursorCreatedCount: state.pointCursorCreatedCount,
    pointCursorCloseAttemptCount: state.pointCursorCloseAttemptCount,
    pointCursorClosedCount: state.pointCursorClosedCount,
    activeCursors: state.activeCursors,
    livePhysicalRows: state.livePhysicalRows,
    liveCarriers: state.liveCarriers,
    maximumActiveCursors: state.maximumActiveCursors,
    maximumLivePhysicalRows: state.maximumLivePhysicalRows,
    maximumLiveCarriers: state.maximumLiveCarriers,
    mainStatementOwned: state.mainStatement !== null,
    mainIteratorOwned: state.mainIterator !== null,
    driverStatementOwned: state.driverStatement !== null,
    driverIteratorOwned: state.driverIterator !== null,
    pointStatementOwned: state.pointStatement !== null,
    pointIteratorOwned: state.pointIterator !== null,
    transactionEpoch: state.transactionEpoch,
    transactionLineage: state.transactionLineage,
    totalChanges: state.totalChanges,
  });
}

/** Begin one zero-parameter, exact-SQL, connection-owned seal scan. */
export function beginSQLiteConnectionPostRebindSealScanIntrinsic(
  connection: SQLiteConnection,
): SQLiteConnectionPostRebindSealScanExecution {
  const owner = readSQLiteConnectionOwnerSnapshot(connection);
  const total = readSQLiteConnectionTotalChangesSnapshot(connection);
  if (!owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage === null
      || total.transactionEpoch !== owner.transactionEpoch) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite post-rebind seal scan requires the active exclusive owner",
    );
  }
  const execution = objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as SQLiteConnectionPostRebindSealScanExecution;
  const state: PostRebindSealScanState = {
    connection,
    transactionEpoch: owner.transactionEpoch,
    transactionLineage: owner.transactionLineage,
    totalChanges: total.totalChanges,
    lifecycle: "active",
    mainKeyCount: 0,
    driverCount: 0,
    lookupCount: 0,
    pointStatementExecuteCount: 0,
    mainKeyCountPrepareCount: 0,
    mainKeyCountTerminalFetchCount: 0,
    mainKeyCountCloseAttemptCount: 0,
    mainKeyCountCloseCount: 0,
    driverPrepareCount: 0,
    driverTerminalFetchCount: 0,
    driverCloseAttemptCount: 0,
    driverCloseCount: 0,
    pointStatementPrepareCount: 0,
    pointStatementReleaseCount: 0,
    pointCursorCreatedCount: 0,
    pointCursorCloseAttemptCount: 0,
    pointCursorClosedCount: 0,
    activeCursors: 0,
    livePhysicalRows: 0,
    liveCarriers: 0,
    maximumActiveCursors: 0,
    maximumLivePhysicalRows: 0,
    maximumLiveCarriers: 0,
    mainStatement: null,
    mainIterator: null,
    driverStatement: null,
    driverIterator: null,
    pointStatement: null,
    pointIterator: null,
  };
  reflectApplyIntrinsic(weakMapSetIntrinsic, POST_REBIND_SEAL_SCAN_EXECUTIONS, [
    execution as object,
    state,
  ]);
  return execution;
}

/** Execute the complete 1/N/1 scan without exposing statements, iterators or rows. */
export function executeSQLiteConnectionPostRebindSealScanIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealScanExecution,
): SQLiteConnectionPostRebindSealScanEvidence {
  const state = postRebindSealScanState(connection, execution);
  if (state.lifecycle !== "active") {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite post-rebind seal scan execution is terminal",
    );
  }
  let seal: ReturnType<typeof scanPostRebindDrivenSeal>;
  try {
    assertPostRebindSealScanOwner(state);
    const mainKeyCount = scanPostRebindMainKeys(state);
    if (state.mainStatement !== null || state.mainIterator !== null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite post-rebind main scan owner was not retired",
      );
    }
    assertPostRebindSealScanOwner(state);
    seal = scanPostRebindDrivenSeal(state, mainKeyCount);
    assertPostRebindSealScanOwner(state);
    if (state.mainKeyCountPrepareCount !== 1
        || state.mainKeyCountTerminalFetchCount !== 1
        || state.mainKeyCountCloseAttemptCount !== 1
        || state.mainKeyCountCloseCount !== 1
        || state.driverPrepareCount !== 1
        || state.driverTerminalFetchCount !== 1
        || state.driverCloseAttemptCount !== 1
        || state.driverCloseCount !== 1
        || state.pointStatementPrepareCount !== 1
        || state.pointStatementReleaseCount !== 1
        || state.pointStatementExecuteCount !== state.mainKeyCount
        || state.lookupCount !== state.mainKeyCount
        || state.pointCursorCreatedCount !== state.mainKeyCount
        || state.pointCursorCloseAttemptCount !== state.mainKeyCount
        || state.pointCursorClosedCount !== state.mainKeyCount
        || state.driverCount !== state.mainKeyCount
        || seal.accumulatorCount !== state.mainKeyCount
        || state.activeCursors !== 0
        || state.livePhysicalRows !== 0
        || state.liveCarriers !== 0
        || state.maximumActiveCursors > 2
        || state.maximumLivePhysicalRows > 1
        || state.maximumLiveCarriers > 1
        || state.mainStatement !== null || state.mainIterator !== null
        || state.driverStatement !== null || state.driverIterator !== null
        || state.pointStatement !== null || state.pointIterator !== null) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "SQLite post-rebind seal scan lifecycle is incomplete",
      );
    }
    state.lifecycle = "completed";
  } catch (error) {
    state.lifecycle = "poisoned";
    throw error;
  }
  return objectFreezeIntrinsic({
    ...postRebindSealScanSnapshot(state),
    lifecycle: "completed",
    mainKeyCountPrepareCount: 1,
    mainKeyCountTerminalFetchCount: 1,
    mainKeyCountCloseAttemptCount: 1,
    mainKeyCountCloseCount: 1,
    driverPrepareCount: 1,
    driverTerminalFetchCount: 1,
    driverCloseAttemptCount: 1,
    driverCloseCount: 1,
    pointStatementPrepareCount: 1,
    pointStatementReleaseCount: 1,
    accumulatorCount: seal.accumulatorCount,
    computedImmutableRootSha256: seal.computedImmutableRootSha256,
    observedDescriptorHash: seal.observedDescriptorHash,
    observedSchemaIdentitySha256: seal.observedSchemaIdentitySha256,
  });
}

/** Read exact lifecycle, budget and retained native-owner truth. */
export function readSQLiteConnectionPostRebindSealScanSnapshotIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealScanExecution,
): SQLiteConnectionPostRebindSealScanSnapshot {
  return postRebindSealScanSnapshot(postRebindSealScanState(connection, execution));
}

/** Release an unexecuted scan or recover every still-owned handle after poison. */
export function disposeSQLiteConnectionPostRebindSealScanIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealScanExecution,
): SQLiteConnectionPostRebindSealScanSnapshot {
  const state = postRebindSealScanState(connection, execution);
  if (state.lifecycle === "completed" || state.lifecycle === "released") {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      "inspect-schema",
      "SQLite post-rebind seal scan dispose is terminal",
    );
  }
  let primary: Readonly<{ readonly hasPrimary: boolean; readonly value: unknown }> =
    objectFreezeIntrinsic({ hasPrimary: false, value: undefined });
  for (const kind of ["point", "driver", "main-key-count"] as const) {
    const iterator = kind === "point" ? state.pointIterator
      : kind === "driver" ? state.driverIterator : state.mainIterator;
    if (iterator === null) continue;
    if (kind === "point") state.pointCursorCloseAttemptCount += 1;
    else if (kind === "driver") state.driverCloseAttemptCount += 1;
    else state.mainKeyCountCloseAttemptCount += 1;
    const close = closePostRebindSealScanPreservingPrimary(state, kind, primary);
    primary = close.primary;
    if (!close.succeeded) continue;
    if (kind === "point") state.pointCursorClosedCount += 1;
    else if (kind === "driver") state.driverCloseCount = 1;
    else state.mainKeyCountCloseCount = 1;
  }
  if (state.pointIterator === null && state.pointStatement !== null) {
    state.pointStatement = null;
    state.pointStatementReleaseCount = 1;
  }
  if (state.driverIterator === null) state.driverStatement = null;
  if (state.mainIterator === null) state.mainStatement = null;
  if (primary.hasPrimary) throw primary.value;
  if (state.lifecycle === "active") state.lifecycle = "released";
  return postRebindSealScanSnapshot(state);
}

/** Package-private one-shot native-close fault seam. */
export function injectSQLiteConnectionPostRebindSealScanCloseFaultForTestIntrinsic(
  kind: "main-key-count" | "driver" | "point",
  error: unknown,
): void {
  if (postRebindSealScanCloseFaultForTest !== undefined) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite post-rebind seal scan close fault is already armed",
    );
  }
  postRebindSealScanCloseFaultForTest = objectFreezeIntrinsic({ kind, error });
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
  const runtimeKind: string = kind;
  if (runtimeKind === "cursor-publication-post-rebind-main-key-count"
      || runtimeKind === "cursor-publication-post-rebind-key-driver"
      || runtimeKind === "cursor-publication-post-rebind-point-lookup") {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      operation,
      "post-rebind seal SQL is connection-owner private",
    );
  }
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

/** Prepare the exact four-parameter cursor identity UPDATE once. */
export function beginSQLiteConnectionCursorRebindExecutionIntrinsic(
  connection: SQLiteConnection,
): SQLiteConnectionCursorRebindExecution {
  return reflectApplyIntrinsic(sqliteConnectionBeginCursorRebindIntrinsic, connection, []);
}

/** Execute, logically release, read changes(), and prove real counter agreement once. */
export function executeSQLiteConnectionCursorRebindIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionCursorRebindExecution,
  parameters: SQLiteCursorPublicationRebindParameters,
): SQLiteConnectionCursorRebindStepSnapshot {
  return reflectApplyIntrinsic(
    sqliteConnectionExecuteCursorRebindIntrinsic,
    connection,
    [execution, parameters],
  );
}

/** Deterministically retire one prepared, unexecuted rebind after cancellation. */
export function releaseSQLiteConnectionCursorRebindExecutionIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionCursorRebindExecution,
): SQLiteConnectionCursorRebindExecutionSnapshot {
  reflectApplyIntrinsic(
    sqliteConnectionReleaseCursorRebindIntrinsic,
    connection,
    [execution],
  );
  return readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(connection, execution);
}

/** Package-private one-shot fault seam proving cleanup never replaces a primary. */
export function injectSQLiteConnectionCursorRebindCleanupFaultForTestIntrinsic(
  error: unknown,
): void {
  if (cursorRebindCleanupFaultForTest !== undefined) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite cursor rebind cleanup fault is already armed",
    );
  }
  cursorRebindCleanupFaultForTest = objectFreezeIntrinsic({ error });
}

/** Read immutable real lifecycle, counter and private cursor-ledger progress. */
export function readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionCursorRebindExecution,
): SQLiteConnectionCursorRebindExecutionSnapshot {
  const state = execution !== null && typeof execution === "object" && !isProxy(execution)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, CURSOR_REBIND_EXECUTIONS, [
      execution as object,
    ]) as CursorRebindExecutionState | undefined
    : undefined;
  if (state === undefined || state.connection !== connection) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "inspect-schema",
      "SQLite cursor rebind execution is invalid",
    );
  }
  return objectFreezeIntrinsic({
    affectedRows: state.affectedRows,
    changesAffectedRows: state.changesAffectedRows,
    changesFetchCount: state.changesFetchCount,
    changesPrepareCount: state.changesPrepareCount,
    changesReleaseCount: state.changesReleaseCount,
    changesSql: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
    changesSqlSha256: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
    cursorLedgerAffectedRowsWatermark: state.cursorLedgerAffectedRowsWatermark,
    cursorLedgerFixedStatementCount: state.cursorLedgerFixedStatementCount,
    cursorLedgerLogicalWriteSequence: state.cursorLedgerLogicalWriteSequence,
    executeCount: state.executeCount,
    lifecycle: state.lifecycle,
    parameterOrder: SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
    parameterValues: state.parameterValues,
    prepareCount: 1,
    releaseCount: state.releaseCount,
    sql: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
    sqlSha256: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
    statementOwnershipRetired: state.statement === null,
    totalChangesAfter: state.totalChangesAfter,
    totalChangesBefore: state.totalChangesBefore,
    totalChangesDelta: state.totalChangesAfter - state.totalChangesBefore,
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
