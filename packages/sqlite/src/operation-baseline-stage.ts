import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import type { StatementSync } from "node:sqlite";

import { canonicalHash } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  cycleStoreAdapterCodec,
  type CycleStoreLedgerResultByOperation,
  type CycleStoreMutationOperation,
} from "@graph-engineering/runtime";

import {
  BASELINE_ENTRY_KINDS,
  MAX_BASELINE_KEY_BYTES,
  MAX_BASELINE_STATE_BYTES,
  decodeOperationBaselineCanonicalBytes,
  encodeOperationBaselineKey,
  encodeOperationBaselineState,
  type OperationBaselineEntryInput,
  type OperationBaselineEntryKind,
  type OperationBaselineProjectionIdentity,
  validateOperationBaselineEntryBytes,
} from "./operation-baseline.js";
import {
  SQLITE_BASELINE_ABORT_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER,
  SQLITE_BASELINE_ABORT_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_ABORT_LEGACY_CAMPAIGN,
  SQLITE_BASELINE_ABORT_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_COOPERATIVE_POISON,
  SQLITE_BASELINE_ABORT_ORDERED_HANDOFF,
  SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF,
  SQLITE_BASELINE_BEGIN_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER,
  SQLITE_BASELINE_BEGIN_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_BEGIN_LEGACY_CAMPAIGN,
  SQLITE_BASELINE_BEGIN_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_ORDERED_HANDOFF,
  SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_LEGACY_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_CONSUME_OWNED_WRITE,
  SQLITE_BASELINE_CREATE_CURSOR_SEAL_TEMP_TABLE,
  SQLITE_BASELINE_BEGIN_CURSOR_PRE_REBIND,
  SQLITE_BASELINE_FENCE_CURSOR_PRE_REBIND,
  SQLITE_BASELINE_REGISTER_CURSOR_PRE_REBIND_CLEANUP,
  SQLITE_BASELINE_INSERT_CURSOR_PRE_REBIND_ROW,
  SQLITE_BASELINE_COMPLETE_CURSOR_PRE_REBIND,
  SQLITE_BASELINE_DIAGNOSE_CURSOR_PRE_REBIND,
  SQLITE_BASELINE_ABORT_CURSOR_PRE_REBIND,
  SQLITE_BASELINE_FENCE_ORDERED_HANDOFF,
  SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER,
  SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN,
  SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_FINISH_COOPERATIVE_WRITES,
  SQLITE_BASELINE_OWNED_WRITE,
  SQLITE_BASELINE_REGISTER_ORDERED_HANDOFF_CLEANUP,
  SQLITE_BASELINE_REGISTER_CHECKPOINT_CLEANUP,
  SQLITE_BASELINE_REGISTER_LEASE_LOCK_HOLD_CLEANUP,
  SQLITE_BASELINE_REGISTER_LEGACY_CLEANUP,
  SQLITE_BASELINE_REGISTER_STREAM_RECORD_CLEANUP,
  type SQLiteBaselineOwnedWriteReceipt,
} from "./operation-baseline-cooperation.js";
import { SQLITE_CURSOR_STAGE_INSERT_SQL } from "./cursor-pre-rebind-contract.js";
import type { SQLiteCursorStageValue } from "./operation-baseline-cursor-inspection.js";
import {
  SQLITE_CURSOR_SEAL_SCHEMA_SQL,
  SQLITE_CURSOR_SEAL_TABLE_LIST,
  SQLITE_CURSOR_SEAL_TEMP_TABLE_DDL,
  SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME,
  SQLITE_CURSOR_SEAL_XINFO,
} from "./cursor-seal-temp-table-contract.js";
import {
  assertSQLiteCursorPreRebindConnectionProvenanceWitness,
  assertSQLiteCursorPreRebindReceiptProvenance,
  type SQLiteCursorPreRebindConnectionProvenance,
  type SQLiteCursorPreRebindReceipt,
} from "./operation-baseline-cursor-ownership.js";
import {
  sqliteBlob,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "./sqlite-codec.js";
import {
  SQLiteConnection,
  execSQLiteConnectionTrustedIntrinsic,
  prepareSQLiteConnectionIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
  type SQLiteConnectionOwnerSnapshot,
} from "./sqlite-connection.js";

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
  readonly [EXCLUSIVE_PROOF_OWNER]: SQLiteConnection;
}

export type SQLiteBaselineTempStageState = "open" | "poisoned" | "disposed";

export type SQLiteBaselineExpectedCounts = Readonly<
  Record<OperationBaselineEntryKind, number>
>;

export interface SQLiteBaselineStageEntry {
  readonly entryKind: OperationBaselineEntryKind;
  readonly keyBytes: Uint8Array;
  readonly stateBytes: Uint8Array;
}

const EXCLUSIVE_PROOF_OWNER = Symbol("SQLiteExclusiveBaselineTransactionProof.owner");
const ACTIVE_STAGES = new WeakMap<SQLiteConnection, SQLiteBaselineTempStage>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;

function activeStage(connection: SQLiteConnection): SQLiteBaselineTempStage | undefined {
  return Reflect.apply(weakMapGetIntrinsic, ACTIVE_STAGES, [connection]) as
    SQLiteBaselineTempStage | undefined;
}

function publishActiveStage(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
): void {
  Reflect.apply(weakMapSetIntrinsic, ACTIVE_STAGES, [connection, stage]);
}

function deleteActiveStage(connection: SQLiteConnection): void {
  Reflect.apply(weakMapDeleteIntrinsic, ACTIVE_STAGES, [connection]);
}
const KIND_RANK = new Map(
  BASELINE_ENTRY_KINDS.map((entryKind, rank) => [entryKind, rank] as const),
);

const STAGE_TABLE = "ge_blr_stage";
const RELATION_VIEW = "ge_blr_relation_keys";
const RELATION_TABLES = Object.freeze([
  "ge_blr_schema",
  "ge_blr_migrations",
  "ge_blr_streams",
  "ge_blr_records",
  "ge_blr_checkpoint_current",
  "ge_blr_checkpoint_revisions",
  "ge_blr_leases",
  "ge_blr_used_leases",
  "ge_blr_holds",
  "ge_blr_migration_lock",
  "ge_blr_used_migration_locks",
  "ge_blr_legacy_operations",
] as const);

const INDEXES = Object.freeze([
  "ge_blr_records_tenant_hash_uidx",
  "ge_blr_records_stream_sequence_uidx",
  "ge_blr_records_stream_position_idx",
  "ge_blr_checkpoint_current_record_idx",
  "ge_blr_checkpoint_revisions_latest_idx",
  "ge_blr_checkpoint_revisions_record_idx",
  "ge_blr_used_leases_epoch_uidx",
  "ge_blr_used_leases_fencing_uidx",
  "ge_blr_used_migration_locks_epoch_uidx",
  "ge_blr_used_migration_locks_fencing_uidx",
] as const);
const EXPECTED_RESERVED_OBJECT_COUNT = 1 + 1 + RELATION_TABLES.length + INDEXES.length;

const ENTRY_KIND_CHECK = BASELINE_ENTRY_KINDS
  .map((entryKind) => `'${entryKind}'`)
  .join(", ");
const KIND_RANK_CHECK = BASELINE_ENTRY_KINDS
  .map((entryKind, rank) => `(kind_rank = ${rank} AND entry_kind = '${entryKind}')`)
  .join(" OR ");

const LEGACY_TAIL_COLUMNS = Object.freeze([
  "tail_exists", "tail_sequence", "tail_record_hash", "appended_records",
] as const);
const LEGACY_CHECKPOINT_COLUMNS = Object.freeze([
  "checkpoint_scope", "checkpoint_id", "checkpoint_stream_id",
  "checkpoint_bound_sequence", "checkpoint_bound_record_hash",
  "checkpoint_created_at", "checkpoint_value_hash", "checkpoint_value_bytes",
] as const);
const LEGACY_DELETE_COLUMNS = Object.freeze(["checkpoint_deleted"] as const);
const LEGACY_LEASE_COLUMNS = Object.freeze([
  "lease_id", "lease_holder_id", "lease_epoch", "lease_fencing_token",
  "lease_acquired_at_ms", "lease_expires_at_ms",
] as const);
const LEGACY_RELEASE_COLUMNS = Object.freeze([
  "lease_status", "last_lease_epoch", "last_lease_fencing_token",
] as const);
const LEGACY_LOCK_COLUMNS = Object.freeze([
  "lock_id", "lock_owner_id", "lock_source_version", "lock_target_version",
  "lock_epoch", "lock_fencing_token", "lock_acquired_at_ms", "lock_expires_at_ms",
] as const);
const LEGACY_DERIVED_COLUMNS = Object.freeze([
  ...LEGACY_TAIL_COLUMNS,
  ...LEGACY_CHECKPOINT_COLUMNS,
  ...LEGACY_DELETE_COLUMNS,
  ...LEGACY_LEASE_COLUMNS,
  ...LEGACY_RELEASE_COLUMNS,
  ...LEGACY_LOCK_COLUMNS,
] as const);

function columnsNull(columns: readonly string[]): string {
  return columns.map((column) => `${column} IS NULL`).join(" AND ");
}

function columnsPresent(columns: readonly string[]): string {
  return columns.map((column) => `${column} IS NOT NULL`).join(" AND ");
}

function columnsExcept(group: readonly string[]): readonly string[] {
  const allowed = new Set(group);
  return LEGACY_DERIVED_COLUMNS.filter((column) => !allowed.has(column));
}

const LEGACY_OPERATION_CHECK = Object.freeze([
  `(operation_name = 'append'
    AND ${columnsPresent(LEGACY_TAIL_COLUMNS)}
    AND tail_exists = 1
    AND tail_sequence >= 0
    AND appended_records > 0
    AND ${columnsNull(columnsExcept(LEGACY_TAIL_COLUMNS))})`,
  `(operation_name = 'save-checkpoint'
    AND ${columnsPresent(LEGACY_CHECKPOINT_COLUMNS)}
    AND ${columnsNull(columnsExcept(LEGACY_CHECKPOINT_COLUMNS))})`,
  `(operation_name = 'delete-checkpoint'
    AND checkpoint_deleted IS NOT NULL
    AND checkpoint_deleted IN (0, 1)
    AND ${columnsNull(columnsExcept(LEGACY_DELETE_COLUMNS))})`,
  `((operation_name = 'acquire-lease' OR operation_name = 'renew-lease')
    AND ${columnsPresent(LEGACY_LEASE_COLUMNS)}
    AND lease_epoch = lease_fencing_token
    AND lease_expires_at_ms > lease_acquired_at_ms
    AND ${columnsNull(columnsExcept(LEGACY_LEASE_COLUMNS))})`,
  `(operation_name = 'release-lease'
    AND ${columnsPresent(LEGACY_RELEASE_COLUMNS)}
    AND lease_status = 'released'
    AND last_lease_epoch = last_lease_fencing_token
    AND ${columnsNull(columnsExcept(LEGACY_RELEASE_COLUMNS))})`,
  `(operation_name = 'set-legal-hold'
    AND ${columnsNull(LEGACY_DERIVED_COLUMNS)})`,
  `(operation_name = 'acquire-migration-lock'
    AND ${columnsPresent(LEGACY_LOCK_COLUMNS)}
    AND lock_epoch = lock_fencing_token
    AND lock_target_version > lock_source_version
    AND lock_expires_at_ms > lock_acquired_at_ms
    AND ${columnsNull(columnsExcept(LEGACY_LOCK_COLUMNS))})`,
  `(operation_name = 'release-migration-lock'
    AND ${columnsNull(LEGACY_DERIVED_COLUMNS)})`,
]).join(" OR ");

const TABLE_DDL = Object.freeze([
  `CREATE TEMP TABLE ${STAGE_TABLE} (
    kind_rank INTEGER NOT NULL CHECK(kind_rank BETWEEN 0 AND 11),
    entry_kind TEXT NOT NULL CHECK(entry_kind IN (${ENTRY_KIND_CHECK})),
    key_blob BLOB NOT NULL CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    state_blob BLOB NOT NULL CHECK(length(state_blob) BETWEEN 2 AND ${MAX_BASELINE_STATE_BYTES}),
    PRIMARY KEY(kind_rank, key_blob),
    UNIQUE(entry_kind, key_blob),
    CHECK(${KIND_RANK_CHECK})
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_schema (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    singleton INTEGER NOT NULL CHECK(singleton = 1),
    current_version INTEGER NOT NULL,
    min_reader_version INTEGER NOT NULL,
    max_reader_version INTEGER NOT NULL,
    min_writer_version INTEGER NOT NULL,
    max_writer_version INTEGER NOT NULL,
    schema_identity_sha256 TEXT NOT NULL,
    latest_migration_sha256 TEXT NOT NULL,
    provider_descriptor_hash TEXT NOT NULL,
    latest_migration_applied_at_ms INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CHECK(updated_at_ms >= created_at_ms),
    PRIMARY KEY(singleton)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_migrations (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    version INTEGER NOT NULL,
    previous_version INTEGER NOT NULL,
    migration_id TEXT NOT NULL,
    sql_sha256 TEXT NOT NULL,
    schema_identity_sha256 TEXT NOT NULL,
    applied_at_ms INTEGER NOT NULL,
    PRIMARY KEY(version)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_streams (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    tenant_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    tail_sequence INTEGER NOT NULL,
    tail_record_hash TEXT,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CHECK(tail_sequence >= -1),
    CHECK((tail_sequence = -1 AND tail_record_hash IS NULL)
      OR (tail_sequence >= 0 AND tail_record_hash IS NOT NULL)),
    CHECK(updated_at_ms >= created_at_ms),
    PRIMARY KEY(tenant_id, stream_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_records (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    tenant_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    record_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    previous_record_hash TEXT,
    record_hash TEXT NOT NULL,
    value_hash TEXT NOT NULL,
    value_bytes INTEGER NOT NULL,
    committed_at_ms INTEGER NOT NULL,
    CHECK(sequence >= 0),
    CHECK((sequence = 0 AND previous_record_hash IS NULL)
      OR (sequence > 0 AND previous_record_hash IS NOT NULL)),
    CHECK(value_bytes >= 1),
    PRIMARY KEY(tenant_id, record_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_checkpoint_current (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    tenant_id TEXT NOT NULL,
    checkpoint_scope TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    bound_sequence INTEGER NOT NULL,
    bound_record_hash TEXT NOT NULL,
    checkpoint_revision INTEGER NOT NULL,
    checkpoint_created_at TEXT NOT NULL,
    value_hash TEXT NOT NULL,
    value_bytes INTEGER NOT NULL,
    committed_at_ms INTEGER NOT NULL,
    PRIMARY KEY(tenant_id, checkpoint_scope, checkpoint_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_checkpoint_revisions (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    tenant_id TEXT NOT NULL,
    checkpoint_scope TEXT NOT NULL,
    revision INTEGER NOT NULL,
    checkpoint_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('put', 'delete')),
    stream_id TEXT,
    bound_sequence INTEGER,
    bound_record_hash TEXT,
    checkpoint_created_at TEXT,
    value_hash TEXT,
    value_bytes INTEGER,
    recorded_at_ms INTEGER NOT NULL,
    CHECK(
      (action = 'put'
        AND stream_id IS NOT NULL
        AND bound_sequence IS NOT NULL
        AND bound_record_hash IS NOT NULL
        AND checkpoint_created_at IS NOT NULL
        AND value_hash IS NOT NULL
        AND value_bytes IS NOT NULL)
      OR
      (action = 'delete'
        AND stream_id IS NULL
        AND bound_sequence IS NULL
        AND bound_record_hash IS NULL
        AND checkpoint_created_at IS NULL
        AND value_hash IS NULL
        AND value_bytes IS NULL)
    ),
    PRIMARY KEY(tenant_id, checkpoint_scope, revision)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_leases (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    tenant_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    active_lease_id TEXT,
    active_holder_id TEXT,
    active_lease_epoch INTEGER,
    active_fencing_token INTEGER,
    active_acquired_at_ms INTEGER,
    active_expires_at_ms INTEGER,
    last_lease_epoch INTEGER NOT NULL,
    last_fencing_token INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CHECK(last_lease_epoch = last_fencing_token AND last_lease_epoch >= 0),
    CHECK(
      (active_lease_id IS NULL
        AND active_holder_id IS NULL
        AND active_lease_epoch IS NULL
        AND active_fencing_token IS NULL
        AND active_acquired_at_ms IS NULL
        AND active_expires_at_ms IS NULL)
      OR
      (active_lease_id IS NOT NULL
        AND active_holder_id IS NOT NULL
        AND active_lease_epoch IS NOT NULL
        AND active_fencing_token IS NOT NULL
        AND active_acquired_at_ms IS NOT NULL
        AND active_expires_at_ms IS NOT NULL
        AND active_lease_epoch = active_fencing_token
        AND active_lease_epoch = last_lease_epoch
        AND active_expires_at_ms > active_acquired_at_ms)
    ),
    PRIMARY KEY(tenant_id, stream_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_used_leases (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    tenant_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    lease_id TEXT NOT NULL,
    lease_epoch INTEGER NOT NULL,
    fencing_token INTEGER NOT NULL,
    first_used_at_ms INTEGER NOT NULL,
    CHECK(lease_epoch = fencing_token AND lease_epoch >= 1),
    PRIMARY KEY(tenant_id, stream_id, lease_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_holds (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    tenant_id TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    hold_id TEXT NOT NULL,
    placed_at_ms INTEGER NOT NULL,
    PRIMARY KEY(tenant_id, stream_id, hold_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_migration_lock (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    singleton INTEGER NOT NULL CHECK(singleton = 1),
    active_lock_id TEXT,
    active_owner_id TEXT,
    active_source_version INTEGER,
    active_target_version INTEGER,
    active_lock_epoch INTEGER,
    active_fencing_token INTEGER,
    active_acquired_at_ms INTEGER,
    active_expires_at_ms INTEGER,
    last_lock_epoch INTEGER NOT NULL,
    last_fencing_token INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    CHECK(last_lock_epoch = last_fencing_token AND last_lock_epoch >= 0),
    CHECK(
      (active_lock_id IS NULL
        AND active_owner_id IS NULL
        AND active_source_version IS NULL
        AND active_target_version IS NULL
        AND active_lock_epoch IS NULL
        AND active_fencing_token IS NULL
        AND active_acquired_at_ms IS NULL
        AND active_expires_at_ms IS NULL)
      OR
      (active_lock_id IS NOT NULL
        AND active_owner_id IS NOT NULL
        AND active_source_version IS NOT NULL
        AND active_target_version IS NOT NULL
        AND active_lock_epoch IS NOT NULL
        AND active_fencing_token IS NOT NULL
        AND active_acquired_at_ms IS NOT NULL
        AND active_expires_at_ms IS NOT NULL
        AND active_target_version > active_source_version
        AND active_lock_epoch = active_fencing_token
        AND active_lock_epoch = last_lock_epoch
        AND active_expires_at_ms > active_acquired_at_ms)
    ),
    PRIMARY KEY(singleton)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_used_migration_locks (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    lock_id TEXT NOT NULL,
    lock_epoch INTEGER NOT NULL,
    fencing_token INTEGER NOT NULL,
    first_used_at_ms INTEGER NOT NULL,
    CHECK(lock_epoch = fencing_token AND lock_epoch >= 1),
    PRIMARY KEY(lock_id)
  ) STRICT, WITHOUT ROWID`,
  `CREATE TEMP TABLE ge_blr_legacy_operations (
    key_blob BLOB NOT NULL UNIQUE CHECK(length(key_blob) BETWEEN 2 AND ${MAX_BASELINE_KEY_BYTES}),
    tenant_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    operation_name TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_hash TEXT NOT NULL,
    result_blob_sha256 TEXT NOT NULL,
    committed_at_ms INTEGER NOT NULL,
    tail_exists INTEGER,
    tail_sequence INTEGER,
    tail_record_hash TEXT,
    appended_records INTEGER,
    checkpoint_scope TEXT,
    checkpoint_id TEXT,
    checkpoint_stream_id TEXT,
    checkpoint_bound_sequence INTEGER,
    checkpoint_bound_record_hash TEXT,
    checkpoint_created_at TEXT,
    checkpoint_value_hash TEXT,
    checkpoint_value_bytes INTEGER,
    checkpoint_deleted INTEGER,
    lease_id TEXT,
    lease_holder_id TEXT,
    lease_epoch INTEGER,
    lease_fencing_token INTEGER,
    lease_acquired_at_ms INTEGER,
    lease_expires_at_ms INTEGER,
    lease_status TEXT,
    last_lease_epoch INTEGER,
    last_lease_fencing_token INTEGER,
    lock_id TEXT,
    lock_owner_id TEXT,
    lock_source_version INTEGER,
    lock_target_version INTEGER,
    lock_epoch INTEGER,
    lock_fencing_token INTEGER,
    lock_acquired_at_ms INTEGER,
    lock_expires_at_ms INTEGER,
    CHECK(${LEGACY_OPERATION_CHECK}),
    PRIMARY KEY(tenant_id, operation_id)
  ) STRICT, WITHOUT ROWID`,
] as const);

const INDEX_DDL = Object.freeze([
  "CREATE UNIQUE INDEX ge_blr_records_tenant_hash_uidx ON ge_blr_records(tenant_id, record_hash)",
  "CREATE UNIQUE INDEX ge_blr_records_stream_sequence_uidx ON ge_blr_records(tenant_id, stream_id, sequence)",
  "CREATE INDEX ge_blr_records_stream_position_idx ON ge_blr_records(tenant_id, stream_id, sequence, record_hash)",
  "CREATE INDEX ge_blr_checkpoint_current_record_idx ON ge_blr_checkpoint_current(tenant_id, stream_id, bound_sequence, bound_record_hash)",
  "CREATE INDEX ge_blr_checkpoint_revisions_latest_idx ON ge_blr_checkpoint_revisions(tenant_id, checkpoint_scope, checkpoint_id, revision DESC)",
  "CREATE INDEX ge_blr_checkpoint_revisions_record_idx ON ge_blr_checkpoint_revisions(tenant_id, stream_id, bound_sequence, bound_record_hash)",
  "CREATE UNIQUE INDEX ge_blr_used_leases_epoch_uidx ON ge_blr_used_leases(tenant_id, stream_id, lease_epoch)",
  "CREATE UNIQUE INDEX ge_blr_used_leases_fencing_uidx ON ge_blr_used_leases(tenant_id, stream_id, fencing_token)",
  "CREATE UNIQUE INDEX ge_blr_used_migration_locks_epoch_uidx ON ge_blr_used_migration_locks(lock_epoch)",
  "CREATE UNIQUE INDEX ge_blr_used_migration_locks_fencing_uidx ON ge_blr_used_migration_locks(fencing_token)",
] as const);

const VIEW_DDL = `CREATE TEMP VIEW ${RELATION_VIEW} AS
  SELECT 0 AS kind_rank, key_blob FROM ge_blr_schema
  UNION ALL SELECT 1, key_blob FROM ge_blr_migrations
  UNION ALL SELECT 2, key_blob FROM ge_blr_streams
  UNION ALL SELECT 3, key_blob FROM ge_blr_records
  UNION ALL SELECT 4, key_blob FROM ge_blr_checkpoint_current
  UNION ALL SELECT 5, key_blob FROM ge_blr_checkpoint_revisions
  UNION ALL SELECT 6, key_blob FROM ge_blr_leases
  UNION ALL SELECT 7, key_blob FROM ge_blr_used_leases
  UNION ALL SELECT 8, key_blob FROM ge_blr_holds
  UNION ALL SELECT 9, key_blob FROM ge_blr_migration_lock
  UNION ALL SELECT 10, key_blob FROM ge_blr_used_migration_locks
  UNION ALL SELECT 11, key_blob FROM ge_blr_legacy_operations`;

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

function requireSQLiteBaselineTempStorage(
  connection: SQLiteConnection,
): SQLiteBaselineTempStorageProfile {
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

/** Read and validate the bounded FILE-backed TEMP profile without mutating it. */
export function readSQLiteBaselineTempStorage(
  connection: SQLiteConnection,
): SQLiteBaselineTempStorageProfile {
  if (connection.isTransaction) {
    return invalid("SQLite baseline TEMP storage must be read outside a transaction");
  }
  return requireSQLiteBaselineTempStorage(connection);
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
  const proof = {
    mode: "exclusive",
    transactionEpoch: connection.transactionEpoch,
  } as SQLiteExclusiveBaselineTransactionProof;
  Object.defineProperty(proof, EXCLUSIVE_PROOF_OWNER, { value: connection });
  return Object.freeze(proof);
}

function totalChanges(connection: SQLiteConnection): number {
  return sqliteSafeInteger(
    sqliteRow(
      connection.prepare("SELECT total_changes()", OPERATION).get(),
      1,
      OPERATION,
      "TEMP stage change counter",
    )[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "TEMP stage change counter",
  );
}

function totalChangesIntrinsic(connection: SQLiteConnection): number {
  return sqliteSafeInteger(
    sqliteRow(
      prepareSQLiteConnectionIntrinsic(
        connection, "SELECT total_changes()", OPERATION,
      ).get(),
      1,
      OPERATION,
      "TEMP stage change counter",
    )[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "TEMP stage change counter",
  );
}

function checkedExpectedCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return invalid("SQLite baseline expected stage count is outside bounds");
  }
  return value as number;
}

function scalarCount(connection: SQLiteConnection, sql: string, label: string): number {
  return sqliteSafeInteger(
    sqliteRow(connection.prepare(sql, OPERATION).get(), 1, OPERATION, label)[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    label,
  );
}

function reservedCatalogCount(connection: SQLiteConnection): number {
  return scalarCount(
    connection,
    "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
    "TEMP reserved catalog count",
  );
}

function reservedCatalogCountIntrinsic(connection: SQLiteConnection): number {
  return sqliteSafeInteger(
    sqliteRow(
      prepareSQLiteConnectionIntrinsic(
        connection,
        "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
        OPERATION,
      ).get(),
      1,
      OPERATION,
      "TEMP reserved catalog count",
    )[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "TEMP reserved catalog count",
  );
}

interface SQLiteMainOperationsCatalogIdentity {
  readonly rootpage: number | null;
  readonly schemaVersion: number;
  readonly sql: string | null;
}

function mainOperationsCatalogIdentity(
  connection: SQLiteConnection,
  captured = false,
): SQLiteMainOperationsCatalogIdentity {
  const prepare = (sql: string): StatementSync => captured
    ? prepareSQLiteConnectionIntrinsic(connection, sql, OPERATION)
    : connection.prepare(sql, OPERATION);
  const schemaVersion = sqliteSafeInteger(
    sqliteRow(
      prepare("SELECT schema_version FROM pragma_schema_version").get(),
      1, OPERATION, "main schema version",
    )[0],
    0, Number.MAX_SAFE_INTEGER, OPERATION, "main schema version",
  );
  const raw = prepare(
      `SELECT type, name, tbl_name, rootpage, sql
         FROM main.sqlite_schema
        WHERE type = 'table' AND name = 'ge_cycle_operations'`,
    ).get();
  if (raw === undefined) {
    return Object.freeze({ rootpage: null, schemaVersion, sql: null });
  }
  const row = sqliteRow(raw, 5, OPERATION, "main operation catalog identity");
  if (sqliteText(row[0], OPERATION, "main operation object type") !== "table"
      || sqliteText(row[1], OPERATION, "main operation object name") !== "ge_cycle_operations"
      || sqliteText(row[2], OPERATION, "main operation table name") !== "ge_cycle_operations") {
    return invalid("SQLite baseline main operation catalog is invalid");
  }
  return Object.freeze({
    rootpage: sqliteSafeInteger(
      row[3], 1, Number.MAX_SAFE_INTEGER, OPERATION, "main operation rootpage",
    ),
    schemaVersion,
    sql: sqliteText(row[4], OPERATION, "main operation table SQL"),
  });
}

function validateCursorSealTempCatalog(connection: SQLiteConnection): number {
  const schemaRaw = connection.prepare(
    `SELECT type, name, tbl_name, rootpage, sql
       FROM temp.sqlite_schema
      WHERE name = '${SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME}'`,
    OPERATION,
  ).get();
  if (schemaRaw === undefined) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION", OPERATION,
      "SQLite cursor seal TEMP schema identity is invalid",
    );
  }
  const schema = sqliteRow(schemaRaw, 5, OPERATION, "cursor seal TEMP schema");
  const rootpage = sqliteSafeInteger(
    schema[3], 1, Number.MAX_SAFE_INTEGER, OPERATION, "cursor seal TEMP rootpage",
  );
  if (sqliteText(schema[0], OPERATION, "cursor seal TEMP object type") !== "table"
      || sqliteText(schema[1], OPERATION, "cursor seal TEMP object name")
        !== SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME
      || sqliteText(schema[2], OPERATION, "cursor seal TEMP table name")
        !== SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME
      || sqliteText(schema[4], OPERATION, "cursor seal TEMP schema SQL")
        !== SQLITE_CURSOR_SEAL_SCHEMA_SQL) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION", OPERATION,
      "SQLite cursor seal TEMP schema identity is invalid",
    );
  }

  const listRaw = connection.prepare(
    `SELECT name, type, ncol, wr, strict
       FROM pragma_table_list
      WHERE schema = 'temp' AND name = '${SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME}'`,
    OPERATION,
  ).get();
  if (listRaw === undefined) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION", OPERATION,
      "SQLite cursor seal TEMP table shape is invalid",
    );
  }
  const list = sqliteRow(listRaw, 5, OPERATION, "cursor seal TEMP table list");
  if (sqliteText(list[0], OPERATION, "cursor seal TEMP table-list name")
        !== SQLITE_CURSOR_SEAL_TABLE_LIST.name
      || sqliteText(list[1], OPERATION, "cursor seal TEMP table-list type")
        !== SQLITE_CURSOR_SEAL_TABLE_LIST.type
      || sqliteSafeInteger(list[2], 0, Number.MAX_SAFE_INTEGER, OPERATION,
        "cursor seal TEMP column count") !== SQLITE_CURSOR_SEAL_TABLE_LIST.ncol
      || sqliteSafeInteger(list[3], 0, 1, OPERATION,
        "cursor seal TEMP WITHOUT ROWID flag") !== SQLITE_CURSOR_SEAL_TABLE_LIST.wr
      || sqliteSafeInteger(list[4], 0, 1, OPERATION,
        "cursor seal TEMP STRICT flag") !== SQLITE_CURSOR_SEAL_TABLE_LIST.strict) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION", OPERATION,
      "SQLite cursor seal TEMP table shape is invalid",
    );
  }

  const xinfoCount = scalarCount(connection,
    `SELECT count(*)
       FROM pragma_table_xinfo('${SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME}', 'temp')`,
    "cursor seal TEMP column count");
  if (xinfoCount !== SQLITE_CURSOR_SEAL_XINFO.length) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION", OPERATION,
      "SQLite cursor seal TEMP column shape is invalid",
    );
  }
  for (let index = 0; index < SQLITE_CURSOR_SEAL_XINFO.length; index += 1) {
    const expected = SQLITE_CURSOR_SEAL_XINFO[index];
    const actual = sqliteRow(
      connection.prepare(
        `SELECT cid, name, type, "notnull", dflt_value, pk, hidden
           FROM pragma_table_xinfo('${SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME}', 'temp')
          WHERE cid = ?`,
        OPERATION,
      ).get(index),
      7, OPERATION, "cursor seal TEMP column shape",
    );
    if (expected === undefined
        || sqliteSafeInteger(actual[0], 0, 29, OPERATION, "cursor seal TEMP cid")
          !== expected.cid
        || sqliteText(actual[1], OPERATION, "cursor seal TEMP column name")
          !== expected.name
        || sqliteText(actual[2], OPERATION, "cursor seal TEMP column type")
          !== expected.type
        || sqliteSafeInteger(actual[3], 0, 1, OPERATION,
          "cursor seal TEMP NOT NULL flag") !== expected.notnull
        || actual[4] !== expected.dfltValue
        || sqliteSafeInteger(actual[5], 0, 2, OPERATION,
          "cursor seal TEMP primary-key position") !== expected.pk
        || sqliteSafeInteger(actual[6], 0, 0, OPERATION,
          "cursor seal TEMP hidden flag") !== expected.hidden) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION", OPERATION,
        "SQLite cursor seal TEMP column shape is invalid",
      );
    }
  }
  return rootpage;
}

interface SQLiteCursorSealAttemptIdentity {
  readonly rootpage: number;
  readonly sql: string;
}

/** Bind the just-created object without any replaceable instance/prototype hook. */
function cursorSealAttemptIdentityIntrinsic(
  connection: SQLiteConnection,
): SQLiteCursorSealAttemptIdentity {
  const raw = prepareSQLiteConnectionIntrinsic(
    connection,
    `SELECT type, name, tbl_name, rootpage, sql
       FROM temp.sqlite_schema
      WHERE name = '${SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME}'`,
    OPERATION,
  ).get();
  const row = sqliteRow(raw, 5, OPERATION, "cursor seal owned attempt identity");
  const identity = Object.freeze({
    rootpage: sqliteSafeInteger(
      row[3], 1, Number.MAX_SAFE_INTEGER, OPERATION, "cursor seal owned rootpage",
    ),
    sql: sqliteText(row[4], OPERATION, "cursor seal owned schema SQL"),
  });
  if (sqliteText(row[0], OPERATION, "cursor seal owned object type") !== "table"
      || sqliteText(row[1], OPERATION, "cursor seal owned object name")
        !== SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME
      || sqliteText(row[2], OPERATION, "cursor seal owned table name")
        !== SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME
      || identity.sql !== SQLITE_CURSOR_SEAL_SCHEMA_SQL) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION", OPERATION,
      "SQLite cursor seal owned attempt identity is invalid",
    );
  }
  return identity;
}

function validateBaselineTempCatalog(
  connection: SQLiteConnection,
  cursorSealExpected = false,
): number | undefined {
  const expectedObjects = new Set<string>([
    `table:${STAGE_TABLE}`,
    ...RELATION_TABLES.map((name) => `table:${name}`),
    ...INDEXES.map((name) => `index:${name}`),
    `view:${RELATION_VIEW}`,
    ...(cursorSealExpected
      ? [`table:${SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME}`]
      : []),
  ]);
  if (reservedCatalogCount(connection) !== expectedObjects.size) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      OPERATION,
      "SQLite baseline TEMP catalog identity is invalid",
    );
  }
  for (const identity of expectedObjects) {
    const separator = identity.indexOf(":");
    const expectedType = identity.slice(0, separator);
    const expectedName = identity.slice(separator + 1);
    const raw = connection.prepare(
      "SELECT type,name FROM temp.sqlite_schema WHERE type = ? AND name = ?",
      OPERATION,
    ).get(expectedType, expectedName);
    const row = sqliteRow(raw, 2, OPERATION, "TEMP catalog identity");
    if (sqliteText(row[0], OPERATION, "TEMP catalog object type") !== expectedType
        || sqliteText(row[1], OPERATION, "TEMP catalog object name") !== expectedName) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION", OPERATION,
        "SQLite baseline TEMP catalog identity is invalid",
      );
    }
  }

  const expectedTables = new Set<string>([
    STAGE_TABLE,
    ...RELATION_TABLES,
    ...(cursorSealExpected ? [SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME] : []),
  ]);
  const tableCount = scalarCount(connection,
    `SELECT count(*) FROM pragma_table_list
      WHERE schema = 'temp' AND type = 'table'
        AND substr(lower(name), 1, 7) = 'ge_blr_'`,
    "TEMP table count");
  if (tableCount !== expectedTables.size) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION", OPERATION,
      "SQLite baseline TEMP table shape is invalid",
    );
  }
  for (const expectedName of expectedTables) {
    const raw = connection.prepare(
      `SELECT name, type, wr, strict FROM pragma_table_list
        WHERE schema = 'temp' AND type = 'table' AND name = ?`,
      OPERATION,
    ).get(expectedName);
    const row = sqliteRow(raw, 4, OPERATION, "TEMP table identity");
    const name = sqliteText(row[0], OPERATION, "TEMP table name");
    const type = sqliteText(row[1], OPERATION, "TEMP table type");
    const withoutRowid = sqliteSafeInteger(
      row[2], 0, 1, OPERATION, "TEMP table WITHOUT ROWID flag",
    );
    const strict = sqliteSafeInteger(row[3], 0, 1, OPERATION, "TEMP table STRICT flag");
    if (!expectedTables.has(name) || type !== "table" || withoutRowid !== 1 || strict !== 1) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        OPERATION,
        "SQLite baseline TEMP table shape is invalid",
      );
    }
  }
  return cursorSealExpected ? validateCursorSealTempCatalog(connection) : undefined;
}

function baselineTempCatalogSnapshot(
  connection: SQLiteConnection,
  expectedCount: number,
  captured = false,
): string {
  const statement = captured
    ? prepareSQLiteConnectionIntrinsic(connection,
      `SELECT count(*), group_concat(
       hex(CAST(type AS BLOB)) || ',' || hex(CAST(name AS BLOB)) || ',' ||
       hex(CAST(tbl_name AS BLOB)) || ',' || CAST(rootpage AS TEXT) || ',' ||
       hex(CAST(coalesce(sql, '') AS BLOB)), ';') FROM (
       SELECT type,name,tbl_name,rootpage,sql FROM temp.sqlite_schema
       WHERE substr(lower(name), 1, 7) = 'ge_blr_'
       ORDER BY type COLLATE BINARY, name COLLATE BINARY
     )`, OPERATION)
    : connection.prepare(
    `SELECT count(*), group_concat(
       hex(CAST(type AS BLOB)) || ',' || hex(CAST(name AS BLOB)) || ',' ||
       hex(CAST(tbl_name AS BLOB)) || ',' || CAST(rootpage AS TEXT) || ',' ||
       hex(CAST(coalesce(sql, '') AS BLOB)), ';') FROM (
       SELECT type,name,tbl_name,rootpage,sql FROM temp.sqlite_schema
       WHERE substr(lower(name), 1, 7) = 'ge_blr_'
       ORDER BY type COLLATE BINARY, name COLLATE BINARY
     )`, OPERATION);
  const row = sqliteRow(statement.get(), 2, OPERATION, "TEMP catalog snapshot");
  if (sqliteSafeInteger(row[0], 0, expectedCount + 1, OPERATION,
    "TEMP catalog snapshot count") !== expectedCount) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION", OPERATION,
      "SQLite baseline TEMP catalog snapshot is invalid",
    );
  }
  return sqliteText(row[1], OPERATION, "TEMP catalog snapshot");
}

type CanonicalRecord = Readonly<Record<string, unknown>>;
type RelationValue = string | number | null | Buffer;

interface PreparedStageEntry {
  readonly entryKind: OperationBaselineEntryKind;
  readonly key: CanonicalRecord;
  readonly keyBytes: Buffer;
  readonly rank: number;
  readonly state: CanonicalRecord;
  readonly stateBytes: Buffer;
}

interface RelationInsert {
  readonly sql: string;
  readonly values: readonly RelationValue[];
}

interface PendingOwnedWriteReceipt {
  readonly afterTotalChanges: number;
  readonly beforeTotalChanges: number;
  readonly entry: OperationBaselineEntryInput;
  readonly receipt: SQLiteBaselineOwnedWriteReceipt;
  readonly sequence: number;
  readonly transactionEpoch: bigint;
}

const LEGACY_OPERATIONS = new Set<CycleStoreMutationOperation>([
  "append",
  "save-checkpoint",
  "delete-checkpoint",
  "acquire-lease",
  "renew-lease",
  "release-lease",
  "set-legal-hold",
  "acquire-migration-lock",
  "release-migration-lock",
]);

function canonicalRecord(bytes: Buffer, maximum: number): CanonicalRecord {
  return decodeOperationBaselineCanonicalBytes(bytes, maximum) as CanonicalRecord;
}

function relationValue(
  record: CanonicalRecord,
  field: string,
): string | number | null {
  return record[field] as string | number | null;
}

function relationRecord(record: CanonicalRecord, field: string): CanonicalRecord {
  return record[field] as CanonicalRecord;
}

function projectRelationInsert(entry: PreparedStageEntry): RelationInsert {
  const { entryKind, keyBytes, state } = entry;
  const value = (field: string) => relationValue(state, field);
  switch (entryKind) {
    case "schema-envelope":
      return {
        sql: `INSERT INTO temp.ge_blr_schema
          (key_blob, singleton, current_version, min_reader_version,
           max_reader_version, min_writer_version, max_writer_version,
           schema_identity_sha256, latest_migration_sha256,
           provider_descriptor_hash, latest_migration_applied_at_ms,
           created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, 1, value("currentVersion"), value("minReaderVersion"),
          value("maxReaderVersion"), value("minWriterVersion"),
          value("maxWriterVersion"), value("schemaIdentitySha256"),
          value("latestMigrationSha256"), value("providerDescriptorHash"),
          value("latestMigrationAppliedAtMs"), value("createdAtMs"),
          value("updatedAtMs"),
        ],
      };
    case "migration-lineage":
      return {
        sql: `INSERT INTO temp.ge_blr_migrations
          (key_blob, version, previous_version, migration_id, sql_sha256,
           schema_identity_sha256, applied_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("version"), value("previousVersion"),
          value("migrationId"), value("sqlSha256"),
          value("schemaIdentitySha256"), value("appliedAtMs"),
        ],
      };
    case "stream-head":
      return {
        sql: `INSERT INTO temp.ge_blr_streams
          (key_blob, tenant_id, stream_id, tail_sequence, tail_record_hash,
           created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("tenantId"), value("streamId"),
          value("tailSequence"), value("tailRecordHash"),
          value("createdAtMs"), value("updatedAtMs"),
        ],
      };
    case "record-identity":
      return {
        sql: `INSERT INTO temp.ge_blr_records
          (key_blob, tenant_id, stream_id, record_id, sequence,
           previous_record_hash, record_hash, value_hash, value_bytes,
           committed_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("tenantId"), value("streamId"), value("recordId"),
          value("sequence"), value("previousRecordHash"), value("recordHash"),
          value("valueHash"), value("valueBytes"), value("committedAtMs"),
        ],
      };
    case "checkpoint-current":
      return {
        sql: `INSERT INTO temp.ge_blr_checkpoint_current
          (key_blob, tenant_id, checkpoint_scope, checkpoint_id, stream_id,
           bound_sequence, bound_record_hash, checkpoint_revision,
           checkpoint_created_at, value_hash, value_bytes, committed_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("tenantId"), value("checkpointScope"),
          value("checkpointId"), value("streamId"), value("boundSequence"),
          value("boundRecordHash"), value("checkpointRevision"),
          value("createdAt"), value("valueHash"), value("valueBytes"),
          value("committedAtMs"),
        ],
      };
    case "checkpoint-revision": {
      const summary = state.action === "put"
        ? relationRecord(state, "summary")
        : undefined;
      return {
        sql: `INSERT INTO temp.ge_blr_checkpoint_revisions
          (key_blob, tenant_id, checkpoint_scope, revision, checkpoint_id,
           action, stream_id, bound_sequence, bound_record_hash,
           checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("tenantId"), value("checkpointScope"),
          value("revision"), value("checkpointId"), value("action"),
          summary === undefined ? null : relationValue(summary, "streamId"),
          value("boundSequence"), value("boundRecordHash"),
          value("checkpointCreatedAt"), value("valueHash"),
          value("valueBytes"), value("recordedAtMs"),
        ],
      };
    }
    case "lease-current":
      return {
        sql: `INSERT INTO temp.ge_blr_leases
          (key_blob, tenant_id, stream_id, active_lease_id, active_holder_id,
           active_lease_epoch, active_fencing_token, active_acquired_at_ms,
           active_expires_at_ms, last_lease_epoch, last_fencing_token,
           updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("tenantId"), value("streamId"),
          value("activeLeaseId"), value("activeHolderId"),
          value("activeLeaseEpoch"), value("activeFencingToken"),
          value("activeAcquiredAtMs"), value("activeExpiresAtMs"),
          value("lastLeaseEpoch"), value("lastFencingToken"),
          value("updatedAtMs"),
        ],
      };
    case "used-lease-identity":
      return {
        sql: `INSERT INTO temp.ge_blr_used_leases
          (key_blob, tenant_id, stream_id, lease_id, lease_epoch,
           fencing_token, first_used_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("tenantId"), value("streamId"), value("leaseId"),
          value("leaseEpoch"), value("fencingToken"), value("firstUsedAtMs"),
        ],
      };
    case "legal-hold":
      return {
        sql: `INSERT INTO temp.ge_blr_holds
          (key_blob, tenant_id, stream_id, hold_id, placed_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("tenantId"), value("streamId"), value("holdId"),
          value("placedAtMs"),
        ],
      };
    case "migration-lock-current":
      return {
        sql: `INSERT INTO temp.ge_blr_migration_lock
          (key_blob, singleton, active_lock_id, active_owner_id,
           active_source_version, active_target_version, active_lock_epoch,
           active_fencing_token, active_acquired_at_ms, active_expires_at_ms,
           last_lock_epoch, last_fencing_token, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("singleton"), value("activeLockId"),
          value("activeOwnerId"), value("activeSourceVersion"),
          value("activeTargetVersion"), value("activeLockEpoch"),
          value("activeFencingToken"), value("activeAcquiredAtMs"),
          value("activeExpiresAtMs"), value("lastLockEpoch"),
          value("lastFencingToken"), value("updatedAtMs"),
        ],
      };
    case "used-migration-lock-identity":
      return {
        sql: `INSERT INTO temp.ge_blr_used_migration_locks
          (key_blob, lock_id, lock_epoch, fencing_token, first_used_at_ms)
         VALUES (?, ?, ?, ?, ?)`,
        values: [
          keyBytes, value("lockId"), value("lockEpoch"),
          value("fencingToken"), value("firstUsedAtMs"),
        ],
      };
    case "legacy-operation":
      return invalid(
        "SQLite legacy baseline relation loading requires source carrier validation",
      );
  }
}

function exactEpochMilliseconds(value: string): number {
  const fractional = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/u.exec(value)?.[1] ?? "";
  if (fractional.slice(3).replace(/0/gu, "").length !== 0) {
    return invalid("SQLite legacy baseline timestamp is not an exact epoch millisecond");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    return invalid("SQLite legacy baseline timestamp is outside epoch bounds");
  }
  return milliseconds;
}

function legacyDerivedValues(
  operation: CycleStoreMutationOperation,
  decoded: CycleStoreLedgerResultByOperation[CycleStoreMutationOperation],
): readonly RelationValue[] {
  const values: RelationValue[] = [];
  for (let index = 0; index < 30; index += 1) values.push(null);
  switch (operation) {
    case "append": {
      const result = decoded as CycleStoreLedgerResultByOperation["append"];
      if (!result.tail.exists || result.tail.recordHash === null
          || result.tail.sequence < 0 || result.appendedRecords < 1) {
        return invalid("SQLite legacy append result cannot populate its relation carrier");
      }
      values[0] = 1;
      values[1] = result.tail.sequence;
      values[2] = result.tail.recordHash;
      values[3] = result.appendedRecords;
      break;
    }
    case "save-checkpoint": {
      const result = decoded as CycleStoreLedgerResultByOperation["save-checkpoint"];
      values[4] = result.checkpointScope;
      values[5] = result.checkpointId;
      values[6] = result.streamId;
      values[7] = result.boundSequence;
      values[8] = result.boundRecordHash;
      values[9] = result.createdAt;
      values[10] = result.valueHash;
      values[11] = result.valueBytes;
      break;
    }
    case "delete-checkpoint": {
      const result = decoded as CycleStoreLedgerResultByOperation["delete-checkpoint"];
      values[12] = result.deleted ? 1 : 0;
      break;
    }
    case "acquire-lease":
    case "renew-lease": {
      const result = decoded as CycleStoreLedgerResultByOperation["acquire-lease"];
      if (result.leaseEpoch !== result.fencingToken) {
        return invalid("SQLite legacy lease result cannot populate its relation carrier");
      }
      values[13] = result.leaseId;
      values[14] = result.holderId;
      values[15] = result.leaseEpoch;
      values[16] = result.fencingToken;
      values[17] = exactEpochMilliseconds(result.acquiredAt);
      values[18] = exactEpochMilliseconds(result.expiresAt);
      break;
    }
    case "release-lease": {
      const result = decoded as CycleStoreLedgerResultByOperation["release-lease"];
      if (result.status !== "released"
          || result.lease !== null
          || result.lastLeaseEpoch !== result.lastFencingToken) {
        return invalid("SQLite legacy release result cannot populate its relation carrier");
      }
      values[19] = result.status;
      values[20] = result.lastLeaseEpoch;
      values[21] = result.lastFencingToken;
      break;
    }
    case "set-legal-hold":
      break;
    case "acquire-migration-lock": {
      const result = decoded as CycleStoreLedgerResultByOperation["acquire-migration-lock"];
      if (result.lockEpoch !== result.fencingToken
          || result.targetSchemaVersion <= result.sourceSchemaVersion) {
        return invalid("SQLite legacy migration lock cannot populate its relation carrier");
      }
      values[22] = result.lockId;
      values[23] = result.ownerId;
      values[24] = result.sourceSchemaVersion;
      values[25] = result.targetSchemaVersion;
      values[26] = result.lockEpoch;
      values[27] = result.fencingToken;
      values[28] = exactEpochMilliseconds(result.acquiredAt);
      values[29] = exactEpochMilliseconds(result.expiresAt);
      break;
    }
    case "release-migration-lock":
      if (decoded !== null) {
        return invalid("SQLite legacy migration lock release carrier is invalid");
      }
      break;
  }
  return values;
}

function projectLegacyRelationInsert(
  connection: SQLiteConnection,
  entry: PreparedStageEntry,
): RelationInsert {
  const tenantId = relationValue(entry.key, "tenantId");
  const operationId = relationValue(entry.key, "operationId");
  const raw = connection.prepare(
    `SELECT operation_name, request_hash, result_blob, result_hash, committed_at_ms
       FROM main.ge_cycle_operations
      WHERE tenant_id = ? AND operation_id = ?`,
    OPERATION,
  ).get(tenantId, operationId);
  const row = sqliteRow(raw, 5, OPERATION, "legacy operation relation source");
  const operationName = sqliteText(row[0], OPERATION, "legacy operation name");
  if (!LEGACY_OPERATIONS.has(operationName as CycleStoreMutationOperation)) {
    return invalid("SQLite legacy baseline operation name is invalid");
  }
  const operation = operationName as CycleStoreMutationOperation;
  const requestHash = sqliteText(row[1], OPERATION, "legacy operation request hash");
  const resultBlob = sqliteBlob(row[2], OPERATION, "legacy operation result carrier");
  const resultHash = sqliteText(row[3], OPERATION, "legacy operation result hash");
  const committedAtMs = sqliteSafeInteger(
    row[4], 0, Number.MAX_SAFE_INTEGER, OPERATION, "legacy operation commit time",
  );
  if (operation !== relationValue(entry.state, "operationName")
      || requestHash !== relationValue(entry.state, "requestHash")
      || resultHash !== relationValue(entry.state, "resultHash")
      || committedAtMs !== relationValue(entry.state, "committedAtMs")
      || resultBlob.byteLength < 2
      || resultBlob.byteLength > 16_777_216
      || createHash("sha256").update(resultBlob).digest("hex")
        !== relationValue(entry.state, "resultBlobSha256")) {
    return invalid("SQLite legacy baseline source carrier changed before staging");
  }
  const decoded = cycleStoreAdapterCodec.decodeLedgerResult(operation, resultBlob);
  const reencoded = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult(operation, decoded));
  if (!reencoded.equals(resultBlob) || canonicalHash(decoded) !== resultHash) {
    return invalid("SQLite legacy baseline result carrier is invalid");
  }
  return {
    sql: `INSERT INTO temp.ge_blr_legacy_operations
      (key_blob, tenant_id, operation_id, operation_name, request_hash,
       result_hash, result_blob_sha256, committed_at_ms, tail_exists,
       tail_sequence, tail_record_hash, appended_records, checkpoint_scope,
       checkpoint_id, checkpoint_stream_id, checkpoint_bound_sequence,
       checkpoint_bound_record_hash, checkpoint_created_at,
       checkpoint_value_hash, checkpoint_value_bytes, checkpoint_deleted,
       lease_id, lease_holder_id, lease_epoch, lease_fencing_token,
       lease_acquired_at_ms, lease_expires_at_ms, lease_status,
       last_lease_epoch, last_lease_fencing_token, lock_id, lock_owner_id,
       lock_source_version, lock_target_version, lock_epoch,
       lock_fencing_token, lock_acquired_at_ms, lock_expires_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      entry.keyBytes, tenantId, operationId, operation, requestHash, resultHash,
      relationValue(entry.state, "resultBlobSha256"), committedAtMs,
      ...legacyDerivedValues(operation, decoded),
    ],
  };
}

/**
 * Transaction-bound owner for the common TEMP stage and relation catalog.
 *
 * This remains module-internal (the package index does not export it). It owns
 * no transaction boundary: callers remain solely responsible for rollback or
 * commit, including after poison or disposal.
 */
export class SQLiteBaselineTempStage {
  readonly #connection: SQLiteConnection;
  #state: SQLiteBaselineTempStageState = "open";
  #transactionEpoch: bigint;
  #allowedTotalChanges: number;
  #nextOwnedWriteSequence = 0;
  #pendingOwnedWrite: PendingOwnedWriteReceipt | undefined;
  #writeLane: "unset" | "standalone" | "cooperative" = "unset";
  #orderedHandoffState: "unused" | "active" | "complete" | "poisoned" = "unused";
  #orderedHandoffSession: object | undefined;
  #orderedHandoffCleanup: (() => void) | undefined;
  #orderedProjectionIdentity: OperationBaselineProjectionIdentity | undefined;
  #orderedExpectedCounts: Readonly<Record<OperationBaselineEntryKind, number>> | undefined;
  #streamRecordCampaignState: "unused" | "active" | "complete" | "poisoned" = "unused";
  #streamRecordCampaignSession: object | undefined;
  #streamRecordCampaignCleanup: (() => void) | undefined;
  #checkpointCampaignState: "unused" | "active" | "complete" | "poisoned" = "unused";
  #checkpointCampaignSession: object | undefined;
  #checkpointCampaignCleanup: (() => void) | undefined;
  #leaseLockHoldCampaignState: "unused" | "active" | "complete" | "poisoned" = "unused";
  #leaseLockHoldCampaignSession: object | undefined;
  #leaseLockHoldCampaignCleanup: (() => void) | undefined;
  #legacyCampaignState: "unused" | "active" | "complete" | "poisoned" = "unused";
  #legacyCampaignSession: object | undefined;
  #legacyCampaignCleanup: (() => void) | undefined;
  #cursorTransferState: "unused" | "active" | "poisoned" = "unused";
  #cursorTransferSession: object | undefined;
  #cursorTransferReceipt: SQLiteCursorPreRebindReceipt | undefined;
  #cursorTransferProjection: OperationBaselineProjectionIdentity | undefined;
  #cursorTransferCaptureEpoch: bigint | undefined;
  #cursorTransferStageEpoch: bigint | undefined;
  #cursorTransferAllowedTotalChanges: number | undefined;
  #cursorSealState: "absent" | "creating" | "present" | "poisoned" = "absent";
  #cursorSealRootpage: number | undefined;
  #cursorSealCatalogSnapshot: string | undefined;
  #cursorPreRebindState:
    "unused" | "active" | "pre-rebind-complete" | "diagnosed" | "poisoned" = "unused";
  #cursorPreRebindSession: object | undefined;
  #cursorPreRebindCleanup: (() => void) | undefined;
  #cursorPreRebindInsertStatement: StatementSync | undefined;
  readonly #mainOperationsCatalogIdentity: SQLiteMainOperationsCatalogIdentity;
  #cooperativeWritesFinished = false;

  constructor(
    connection: SQLiteConnection,
    proof: SQLiteExclusiveBaselineTransactionProof,
    transactionEpoch: bigint,
    allowedTotalChanges: number,
    mainCatalogIdentity: SQLiteMainOperationsCatalogIdentity,
  ) {
    this.#connection = connection;
    this.#transactionEpoch = transactionEpoch;
    this.#allowedTotalChanges = allowedTotalChanges;
    this.#mainOperationsCatalogIdentity = mainCatalogIdentity;
    if (proof[EXCLUSIVE_PROOF_OWNER] !== connection) {
      invalid("SQLite baseline EXCLUSIVE proof belongs to another connection");
    }
  }

  get state(): SQLiteBaselineTempStageState {
    return this.#state;
  }

  /**
   * Package-private cooperative source write. The symbol is deliberately not
   * re-exported from the package and the returned object is bound by private
   * pending-object identity.
   */
  [SQLITE_BASELINE_OWNED_WRITE](
    connection: SQLiteConnection,
    entry: OperationBaselineEntryInput,
    sequence: number,
  ): SQLiteBaselineOwnedWriteReceipt {
    this.#requireOpenOwner();
    if (this.#orderedHandoffState !== "unused") {
      return this.#poison("SQLite baseline cooperative writes cannot enter an ordered handoff");
    }
    if (this.#cooperativeWritesFinished) {
      return this.#poison("SQLite baseline cooperative writes are already finished");
    }
    if (connection !== this.#connection) {
      return this.#poison("SQLite baseline cooperative writer connection is invalid");
    }
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      return this.#poison("SQLite baseline cooperative writer sequence is invalid");
    }
    if (sequence !== this.#nextOwnedWriteSequence
        || this.#pendingOwnedWrite !== undefined) {
      return this.#poison("SQLite baseline cooperative writer order is invalid");
    }
    if (this.#writeLane === "standalone") {
      return this.#poison("SQLite baseline cooperative and standalone writes cannot be mixed");
    }
    if (this.#writeLane === "unset") {
      if (sequence !== 0
          || scalarCount(
            this.#connection,
            `SELECT count(*) FROM temp.${STAGE_TABLE}`,
            "TEMP cooperative initial common count",
          ) !== 0
          || scalarCount(
            this.#connection,
            `SELECT count(*) FROM temp.${RELATION_VIEW}`,
            "TEMP cooperative initial relation count",
          ) !== 0) {
        return this.#poison("SQLite baseline cooperative writer did not start from an empty stage");
      }
      this.#requireAllowedChanges();
      this.#writeLane = "cooperative";
    }
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return this.#poison("SQLite baseline cooperative source entry is invalid");
    }
    const before = this.#requireAllowedChanges();
    let keyBytes: Buffer;
    let stateBytes: Buffer;
    try {
      keyBytes = encodeOperationBaselineKey(entry.entryKind, entry.key);
      stateBytes = encodeOperationBaselineState(entry.entryKind, entry.state);
    } catch {
      return this.#poison("SQLite baseline cooperative source entry is invalid");
    }
    this.#insertEntryWithRelation({ entryKind: entry.entryKind, keyBytes, stateBytes });
    const after = this.#requireAllowedChanges();
    // A second read is a terminal fence against DML injected during the first
    // post-write counter read.
    if (this.#requireAllowedChanges() !== after || after !== before + 2) {
      return this.#poison("SQLite baseline cooperative write delta is invalid");
    }
    if (!Number.isSafeInteger(after)) {
      return this.#poison("SQLite baseline cooperative write delta is invalid");
    }
    const receipt = Object.freeze(Object.create(null, {
      kind: {
        enumerable: true,
        value: "sqlite-baseline-owned-write-receipt",
      },
    })) as SQLiteBaselineOwnedWriteReceipt;
    this.#pendingOwnedWrite = {
      afterTotalChanges: after,
      beforeTotalChanges: before,
      entry,
      receipt,
      sequence,
      transactionEpoch: this.#transactionEpoch,
    };
    return receipt;
  }

  /** Consume and burn the exact pending receipt before another write may run. */
  [SQLITE_BASELINE_CONSUME_OWNED_WRITE](
    connection: SQLiteConnection,
    entry: OperationBaselineEntryInput,
    receipt: SQLiteBaselineOwnedWriteReceipt | undefined,
    sequence: number,
    beforeTotalChanges: number,
    currentTotalChanges: number,
    transactionEpoch: bigint,
  ): number {
    this.#requireOpenOwner();
    const actualTotalChanges = this.#requireAllowedChanges();
    const pending = this.#pendingOwnedWrite;
    // Burn private pending state on every presentation. A wrong or forged
    // receipt can never be followed by a retry with the real object.
    this.#pendingOwnedWrite = undefined;
    if (pending === undefined
        || connection !== this.#connection
        || receipt !== pending.receipt
        || entry !== pending.entry
        || sequence !== pending.sequence
        || sequence !== this.#nextOwnedWriteSequence
        || beforeTotalChanges !== pending.beforeTotalChanges
        || currentTotalChanges !== actualTotalChanges
        || actualTotalChanges !== pending.afterTotalChanges
        || pending.afterTotalChanges !== pending.beforeTotalChanges + 2
        || transactionEpoch !== pending.transactionEpoch
        || this.#transactionEpoch !== pending.transactionEpoch) {
      return this.#poison(
        "SQLite baseline owned-write receipt binding does not match the source item",
      );
    }
    if (this.#requireAllowedChanges() !== pending.afterTotalChanges) {
      return this.#poison("SQLite baseline owned-write receipt observed an unexplained write");
    }
    this.#nextOwnedWriteSequence += 1;
    return pending.afterTotalChanges;
  }

  /** Prove that the source consumed every issued receipt exactly once. */
  [SQLITE_BASELINE_FINISH_COOPERATIVE_WRITES](
    connection: SQLiteConnection,
    expectedSequence: number,
    expectedTotalChanges: number,
    currentTotalChanges: number,
    transactionEpoch: bigint,
  ): void {
    this.#requireOpenOwner();
    const actualTotalChanges = this.#requireAllowedChanges();
    if (this.#writeLane !== "cooperative"
        || connection !== this.#connection
        || this.#pendingOwnedWrite !== undefined
        || !Number.isSafeInteger(expectedSequence)
        || expectedSequence !== this.#nextOwnedWriteSequence
        || expectedTotalChanges !== actualTotalChanges
        || currentTotalChanges !== actualTotalChanges
        || transactionEpoch !== this.#transactionEpoch) {
      return this.#poison("SQLite baseline cooperative writer did not finish exactly");
    }
    this.#requireAllowedChanges();
    this.#cooperativeWritesFinished = true;
  }

  /** Begin the one package-private, transaction-bound ordered TEMP handoff. */
  [SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF](
    connection: SQLiteConnection,
    expectedEntryCount: number,
    expectedCounts: Readonly<Record<OperationBaselineEntryKind, number>>,
    expectedTotalChanges: number,
    transactionEpoch: bigint,
  ): object {
    this.#requireOpenOwner();
    const actualTotalChanges = this.#requireAllowedChanges();
    if (this.#orderedHandoffState !== "unused"
        || connection !== this.#connection
        || this.#writeLane !== "cooperative"
        || !this.#cooperativeWritesFinished
        || this.#pendingOwnedWrite !== undefined
        || !Number.isSafeInteger(expectedEntryCount)
        || expectedEntryCount < 0
        || expectedEntryCount !== this.#nextOwnedWriteSequence
        || expectedTotalChanges !== actualTotalChanges
        || transactionEpoch !== this.#transactionEpoch
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${STAGE_TABLE}`,
          "TEMP ordered handoff common count",
        ) !== expectedEntryCount
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${RELATION_VIEW}`,
          "TEMP ordered handoff relation count",
        ) !== expectedEntryCount) {
      return this.#poison("SQLite baseline ordered handoff binding is invalid");
    }
    this.assertCommonCounts(expectedCounts);
    const catalogEpoch = this.#connection.transactionEpoch;
    validateBaselineTempCatalog(this.#connection);
    if (this.#connection.transactionEpoch !== catalogEpoch
        || reservedCatalogCount(this.#connection) !== EXPECTED_RESERVED_OBJECT_COUNT) {
      return this.#poison("SQLite baseline ordered handoff catalog is invalid");
    }
    this.#transactionEpoch = this.#connection.transactionEpoch;
    this.#requireAllowedChanges();
    const session = Object.freeze(Object.create(null)) as object;
    this.#orderedHandoffSession = session;
    this.#orderedExpectedCounts = Object.freeze({ ...expectedCounts });
    this.#orderedHandoffState = "active";
    return session;
  }

  /** Revalidate exact owner, epoch and write fence around every handoff step. */
  [SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](session: object): number {
    this.#requireOpenOwner();
    if (this.#orderedHandoffState !== "active"
        || session !== this.#orderedHandoffSession) {
      return this.#poison("SQLite baseline ordered handoff session is invalid");
    }
    const actual = this.#requireAllowedChanges();
    if (this.#requireAllowedChanges() !== actual) {
      return this.#poison("SQLite baseline ordered handoff observed an unexplained write");
    }
    return actual;
  }

  /** Register only the current SQLite row iterator finalizer. */
  [SQLITE_BASELINE_REGISTER_ORDERED_HANDOFF_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void {
    this[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](session);
    if (cleanup !== undefined && this.#orderedHandoffCleanup !== undefined) {
      return this.#poison("SQLite baseline ordered handoff cleanup is already registered");
    }
    this.#orderedHandoffCleanup = cleanup;
  }

  /** Seal the exact one-shot handoff after every terminal barrier passes. */
  [SQLITE_BASELINE_COMPLETE_ORDERED_HANDOFF](
    session: object,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): void {
    this[SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](session);
    if (projectionIdentity === null
        || typeof projectionIdentity !== "object"
        || !Object.isFrozen(projectionIdentity)
        || !Number.isSafeInteger(projectionIdentity.entryCount)
        || projectionIdentity.entryCount !== this.#nextOwnedWriteSequence
        || this.#orderedHandoffCleanup !== undefined) {
      return this.#poison("SQLite baseline ordered handoff completion is invalid");
    }
    const catalogEpoch = this.#connection.transactionEpoch;
    validateBaselineTempCatalog(this.#connection);
    if (this.#connection.transactionEpoch !== catalogEpoch
        || reservedCatalogCount(this.#connection) !== EXPECTED_RESERVED_OBJECT_COUNT) {
      return this.#poison("SQLite baseline ordered handoff catalog is invalid");
    }
    this.#transactionEpoch = this.#connection.transactionEpoch;
    this.#requireAllowedChanges();
    this.#orderedHandoffSession = undefined;
    this.#orderedHandoffState = "complete";
    this.#orderedProjectionIdentity = projectionIdentity;
  }

  /** Finalize the current statement and poison every incomplete handoff. */
  [SQLITE_BASELINE_ABORT_ORDERED_HANDOFF](
    session: object | undefined,
    message: string,
  ): never {
    const cleanup = this.#orderedHandoffCleanup;
    this.#orderedHandoffCleanup = undefined;
    try {
      cleanup?.();
    } catch {
      // The authoritative handoff failure remains primary.
    }
    if (session !== undefined && session !== this.#orderedHandoffSession) {
      message = "SQLite baseline ordered handoff session is invalid";
    }
    this.#orderedHandoffSession = undefined;
    this.#orderedHandoffState = "poisoned";
    return this.#poison(message);
  }

  /** Bind the first relational campaign to the exact sealed handoff identity. */
  [SQLITE_BASELINE_BEGIN_STREAM_RECORD_CAMPAIGN](
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): object {
    this.#requireOpenOwner();
    if (this.#streamRecordCampaignState !== "unused"
        || this.#orderedHandoffState !== "complete"
        || connection !== this.#connection
        || projectionIdentity !== this.#orderedProjectionIdentity
        || projectionIdentity.entryCount !== this.#nextOwnedWriteSequence) {
      return this.#poison("SQLite baseline stream/record campaign binding is invalid");
    }
    this.#assertExactBaselineCatalog("stream/record campaign begin");
    const campaignSession = Object.freeze(Object.create(null)) as object;
    this.#streamRecordCampaignSession = campaignSession;
    this.#streamRecordCampaignState = "active";
    return campaignSession;
  }

  /** Re-prove owner, write counter, transaction epoch and exact TEMP catalog. */
  [SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](session: object): void {
    this.#requireOpenOwner();
    if (this.#streamRecordCampaignState !== "active"
        || session !== this.#streamRecordCampaignSession) {
      return this.#poison("SQLite baseline stream/record campaign session is invalid");
    }
    this.#requireAllowedChanges();
    this.#assertExactBaselineCatalog("stream/record campaign fence");
    this.#requireAllowedChanges();
  }

  /** Register only the current bounded witness iterator finalizer. */
  [SQLITE_BASELINE_REGISTER_STREAM_RECORD_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void {
    this[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](session);
    if (cleanup !== undefined && this.#streamRecordCampaignCleanup !== undefined) {
      return this.#poison("SQLite baseline stream/record cleanup is already registered");
    }
    this.#streamRecordCampaignCleanup = cleanup;
  }

  /** Seal the one-shot campaign only after every rule and terminal fence passes. */
  [SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN](session: object): void {
    this[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](session);
    const projectionIdentity = this.#orderedProjectionIdentity;
    const expectedCounts = this.#orderedExpectedCounts;
    if (this.#streamRecordCampaignCleanup !== undefined
        || projectionIdentity === undefined
        || expectedCounts === undefined
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${STAGE_TABLE}`,
          "TEMP stream/record campaign common count",
        ) !== projectionIdentity.entryCount
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${RELATION_VIEW}`,
          "TEMP stream/record campaign relation count",
        ) !== projectionIdentity.entryCount) {
      return this.#poison("SQLite baseline stream/record completion is invalid");
    }
    this.assertCommonCounts(expectedCounts);
    this.assertRelationKeyCoverage();
    this[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](session);
    this.#streamRecordCampaignSession = undefined;
    this.#streamRecordCampaignState = "complete";
  }

  /** Finalize the current witness iterator while preserving its primary failure. */
  [SQLITE_BASELINE_ABORT_STREAM_RECORD_CAMPAIGN](
    session: object | undefined,
    message: string,
  ): never {
    const campaignCleanup = this.#streamRecordCampaignCleanup;
    this.#streamRecordCampaignCleanup = undefined;
    try {
      campaignCleanup?.();
    } catch {
      // The authoritative rule or fence failure remains primary.
    }
    if (session !== undefined && session !== this.#streamRecordCampaignSession) {
      message = "SQLite baseline stream/record campaign session is invalid";
    }
    this.#streamRecordCampaignSession = undefined;
    this.#streamRecordCampaignState = "poisoned";
    return this.#poison(message);
  }

  /** Continue the sealed relational campaign with the checkpoint rule family. */
  [SQLITE_BASELINE_BEGIN_CHECKPOINT_CAMPAIGN](
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): object {
    this.#requireOpenOwner();
    if (this.#checkpointCampaignState !== "unused"
        || this.#streamRecordCampaignState !== "complete"
        || connection !== this.#connection
        || projectionIdentity !== this.#orderedProjectionIdentity
        || projectionIdentity.entryCount !== this.#nextOwnedWriteSequence
        || this.#orderedExpectedCounts === undefined) {
      return this.#poison("SQLite baseline checkpoint campaign binding is invalid");
    }
    this.#assertExactBaselineCatalog("checkpoint campaign begin");
    this.assertCommonCounts(this.#orderedExpectedCounts);
    this.assertRelationKeyCoverage();
    this.#assertExactBaselineCatalog("checkpoint campaign begin coverage");
    const campaignSession = Object.freeze(Object.create(null)) as object;
    this.#checkpointCampaignSession = campaignSession;
    this.#checkpointCampaignState = "active";
    return campaignSession;
  }

  /** Reuse the sealed owner, write, epoch and exact-catalog fence. */
  [SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](session: object): void {
    this.#requireOpenOwner();
    if (this.#checkpointCampaignState !== "active"
        || session !== this.#checkpointCampaignSession) {
      return this.#poison("SQLite baseline checkpoint campaign session is invalid");
    }
    this.#requireAllowedChanges();
    this.#assertExactBaselineCatalog("checkpoint campaign fence");
    this.#requireAllowedChanges();
  }

  /** Own exactly one bounded checkpoint witness iterator finalizer. */
  [SQLITE_BASELINE_REGISTER_CHECKPOINT_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void {
    this[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](session);
    if (cleanup !== undefined && this.#checkpointCampaignCleanup !== undefined) {
      return this.#poison("SQLite baseline checkpoint cleanup is already registered");
    }
    this.#checkpointCampaignCleanup = cleanup;
  }

  /** Seal the checkpoint phase only after coverage and terminal fences pass. */
  [SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN](session: object): void {
    this[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](session);
    const projectionIdentity = this.#orderedProjectionIdentity;
    const expectedCounts = this.#orderedExpectedCounts;
    if (this.#checkpointCampaignCleanup !== undefined
        || projectionIdentity === undefined
        || expectedCounts === undefined
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${STAGE_TABLE}`,
          "TEMP checkpoint campaign common count",
        ) !== projectionIdentity.entryCount
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${RELATION_VIEW}`,
          "TEMP checkpoint campaign relation count",
        ) !== projectionIdentity.entryCount) {
      return this.#poison("SQLite baseline checkpoint completion is invalid");
    }
    this.assertCommonCounts(expectedCounts);
    this.assertRelationKeyCoverage();
    this[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](session);
    this.#checkpointCampaignSession = undefined;
    this.#checkpointCampaignState = "complete";
  }

  /** Finalize the current checkpoint witness while keeping the primary failure. */
  [SQLITE_BASELINE_ABORT_CHECKPOINT_CAMPAIGN](
    session: object | undefined,
    message: string,
  ): never {
    const campaignCleanup = this.#checkpointCampaignCleanup;
    this.#checkpointCampaignCleanup = undefined;
    try {
      campaignCleanup?.();
    } catch {
      // The authoritative rule or fence failure remains primary.
    }
    if (session !== undefined && session !== this.#checkpointCampaignSession) {
      message = "SQLite baseline checkpoint campaign session is invalid";
    }
    this.#checkpointCampaignSession = undefined;
    this.#checkpointCampaignState = "poisoned";
    return this.#poison(message);
  }

  /** Continue the sealed chain with lease, lock and hold invariants. */
  [SQLITE_BASELINE_BEGIN_LEASE_LOCK_HOLD_CAMPAIGN](
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): object {
    this.#requireOpenOwner();
    if (this.#leaseLockHoldCampaignState !== "unused"
        || this.#checkpointCampaignState !== "complete"
        || connection !== this.#connection
        || projectionIdentity !== this.#orderedProjectionIdentity
        || projectionIdentity.entryCount !== this.#nextOwnedWriteSequence
        || this.#orderedExpectedCounts === undefined) {
      return this.#poison("SQLite baseline lease/lock/hold campaign binding is invalid");
    }
    this.#assertExactBaselineCatalog("lease/lock/hold campaign begin");
    this.assertCommonCounts(this.#orderedExpectedCounts);
    this.assertRelationKeyCoverage();
    this.#assertExactBaselineCatalog("lease/lock/hold campaign begin coverage");
    const campaignSession = Object.freeze(Object.create(null)) as object;
    this.#leaseLockHoldCampaignSession = campaignSession;
    this.#leaseLockHoldCampaignState = "active";
    return campaignSession;
  }

  [SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](session: object): void {
    this.#requireOpenOwner();
    if (this.#leaseLockHoldCampaignState !== "active"
        || session !== this.#leaseLockHoldCampaignSession) {
      return this.#poison("SQLite baseline lease/lock/hold campaign session is invalid");
    }
    this.#requireAllowedChanges();
    this.#assertExactBaselineCatalog("lease/lock/hold campaign fence");
    this.#requireAllowedChanges();
  }

  [SQLITE_BASELINE_REGISTER_LEASE_LOCK_HOLD_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void {
    this[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](session);
    if (cleanup !== undefined && this.#leaseLockHoldCampaignCleanup !== undefined) {
      return this.#poison("SQLite baseline lease/lock/hold cleanup is already registered");
    }
    this.#leaseLockHoldCampaignCleanup = cleanup;
  }

  [SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN](session: object): void {
    this[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](session);
    const projectionIdentity = this.#orderedProjectionIdentity;
    const expectedCounts = this.#orderedExpectedCounts;
    if (this.#leaseLockHoldCampaignCleanup !== undefined
        || projectionIdentity === undefined
        || expectedCounts === undefined
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${STAGE_TABLE}`,
          "TEMP lease/lock/hold campaign common count",
        ) !== projectionIdentity.entryCount
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${RELATION_VIEW}`,
          "TEMP lease/lock/hold campaign relation count",
        ) !== projectionIdentity.entryCount) {
      return this.#poison("SQLite baseline lease/lock/hold completion is invalid");
    }
    this.assertCommonCounts(expectedCounts);
    this.assertRelationKeyCoverage();
    this[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](session);
    this.#leaseLockHoldCampaignSession = undefined;
    this.#leaseLockHoldCampaignState = "complete";
  }

  [SQLITE_BASELINE_ABORT_LEASE_LOCK_HOLD_CAMPAIGN](
    session: object | undefined,
    message: string,
  ): never {
    const campaignCleanup = this.#leaseLockHoldCampaignCleanup;
    this.#leaseLockHoldCampaignCleanup = undefined;
    try {
      campaignCleanup?.();
    } catch {
      // The authoritative rule or fence failure remains primary.
    }
    if (session !== undefined && session !== this.#leaseLockHoldCampaignSession) {
      message = "SQLite baseline lease/lock/hold campaign session is invalid";
    }
    this.#leaseLockHoldCampaignSession = undefined;
    this.#leaseLockHoldCampaignState = "poisoned";
    return this.#poison(message);
  }

  /** Finish the sealed chain with recoverable legacy-operation bindings. */
  [SQLITE_BASELINE_BEGIN_LEGACY_CAMPAIGN](
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): object {
    this.#requireOpenOwner();
    if (this.#legacyCampaignState !== "unused"
        || this.#leaseLockHoldCampaignState !== "complete"
        || connection !== this.#connection
        || projectionIdentity !== this.#orderedProjectionIdentity
        || projectionIdentity.entryCount !== this.#nextOwnedWriteSequence
        || this.#orderedExpectedCounts === undefined) {
      return this.#poison("SQLite baseline legacy campaign binding is invalid");
    }
    this.#requireAllowedChanges();
    this.#assertExactBaselineCatalog("legacy campaign begin");
    this.#assertMainOperationsCatalog("legacy campaign begin");
    this.assertCommonCounts(this.#orderedExpectedCounts);
    this.assertRelationKeyCoverage();
    this.#assertExactBaselineCatalog("legacy campaign begin coverage");
    this.#requireAllowedChanges();
    const campaignSession = Object.freeze(Object.create(null)) as object;
    this.#legacyCampaignSession = campaignSession;
    this.#legacyCampaignState = "active";
    return campaignSession;
  }

  [SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](session: object): void {
    this.#requireOpenOwner();
    if (this.#legacyCampaignState !== "active"
        || session !== this.#legacyCampaignSession) {
      return this.#poison("SQLite baseline legacy campaign session is invalid");
    }
    this.#requireAllowedChanges();
    this.#assertExactBaselineCatalog("legacy campaign fence");
    this.#assertMainOperationsCatalog("legacy campaign fence");
    this.#requireAllowedChanges();
  }

  [SQLITE_BASELINE_REGISTER_LEGACY_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void {
    this[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](session);
    if (cleanup !== undefined && this.#legacyCampaignCleanup !== undefined) {
      return this.#poison("SQLite baseline legacy cleanup is already registered");
    }
    this.#legacyCampaignCleanup = cleanup;
  }

  [SQLITE_BASELINE_COMPLETE_LEGACY_CAMPAIGN](session: object): void {
    this[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](session);
    const projectionIdentity = this.#orderedProjectionIdentity;
    const expectedCounts = this.#orderedExpectedCounts;
    if (this.#legacyCampaignCleanup !== undefined
        || projectionIdentity === undefined
        || expectedCounts === undefined
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${STAGE_TABLE}`,
          "TEMP legacy campaign common count",
        ) !== projectionIdentity.entryCount
        || scalarCount(
          this.#connection,
          `SELECT count(*) FROM temp.${RELATION_VIEW}`,
          "TEMP legacy campaign relation count",
        ) !== projectionIdentity.entryCount) {
      return this.#poison("SQLite baseline legacy completion is invalid");
    }
    this.assertCommonCounts(expectedCounts);
    this.assertRelationKeyCoverage();
    this[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](session);
    this.#legacyCampaignSession = undefined;
    this.#legacyCampaignState = "complete";
  }

  [SQLITE_BASELINE_ABORT_LEGACY_CAMPAIGN](
    session: object | undefined,
    message: string,
  ): never {
    const cleanup = this.#legacyCampaignCleanup;
    this.#legacyCampaignCleanup = undefined;
    try {
      cleanup?.();
    } catch {
      // Preserve the authoritative rule or fence failure.
    }
    if (session !== undefined && session !== this.#legacyCampaignSession) {
      message = "SQLite baseline legacy campaign session is invalid";
    }
    this.#legacyCampaignSession = undefined;
    this.#legacyCampaignState = "poisoned";
    return this.#poison(message);
  }

  /**
   * Atomically burn B0a and transfer historical capture ownership to this
   * exact completed stage. This hook executes no cursor SQL and creates no
   * cursor TEMP object.
   */
  [SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER](
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    provenance: SQLiteCursorPreRebindConnectionProvenance,
  ): object {
    // A2b must remain authoritative even for direct package-private calls.
    const receiptWitness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
    assertSQLiteCursorPreRebindConnectionProvenanceWitness(
      connection,
      receipt,
      provenance,
    );
    const session = Object.freeze(Object.create(null)) as object;
    if (this.#cursorTransferState !== "unused"
        || connection !== this.#connection
        || activeStage(connection) !== this
        || this.#orderedHandoffState !== "complete"
        || this.#orderedHandoffSession !== undefined
        || this.#orderedHandoffCleanup !== undefined
        || this.#streamRecordCampaignState !== "complete"
        || this.#streamRecordCampaignSession !== undefined
        || this.#streamRecordCampaignCleanup !== undefined
        || this.#checkpointCampaignState !== "complete"
        || this.#checkpointCampaignSession !== undefined
        || this.#checkpointCampaignCleanup !== undefined
        || this.#leaseLockHoldCampaignState !== "complete"
        || this.#leaseLockHoldCampaignSession !== undefined
        || this.#leaseLockHoldCampaignCleanup !== undefined
        || this.#legacyCampaignState !== "complete"
        || this.#legacyCampaignSession !== undefined
        || this.#legacyCampaignCleanup !== undefined
        || receiptWitness.projectionIdentity !== this.#orderedProjectionIdentity
        || receiptWitness.sourceSummary.expectedEntryCount !== this.#nextOwnedWriteSequence
        || receiptWitness.projectionIdentity.entryCount !== this.#nextOwnedWriteSequence
        || this.#orderedExpectedCounts === undefined) {
      return this.#poison("SQLite cursor stage ownership transfer binding is invalid");
    }
    this.#requireOpenOwner();
    const expectedTotalChanges = this.#requireAllowedChanges();
    this.#assertExactBaselineCatalog("cursor transfer begin");
    this.#assertMainOperationsCatalog("cursor transfer begin");
    this.assertCommonCounts(this.#orderedExpectedCounts);
    this.assertRelationKeyCoverage();
    this.#assertExactBaselineCatalog("cursor transfer begin coverage");
    const finalTotalChanges = this.#requireAllowedChanges();
    if (finalTotalChanges !== expectedTotalChanges
        || finalTotalChanges !== this.#allowedTotalChanges) {
      return this.#poison("SQLite cursor stage ownership transfer write fence changed");
    }
    const owner = readSQLiteConnectionOwnerSnapshot(connection);
    const privateChanges = readSQLiteConnectionTotalChangesSnapshot(connection);
    if (!owner.isTransaction
        || owner.transactionMode !== "exclusive"
        || owner.transactionEpoch !== this.#transactionEpoch
        || privateChanges.transactionEpoch !== owner.transactionEpoch
        || privateChanges.totalChanges !== finalTotalChanges) {
      return this.#poison("SQLite cursor stage ownership transfer epoch is invalid");
    }
    // This is the last fallible operation. It repeats A2b and the private live
    // source/connection fence before the stage assumes one-way live ownership.
    try {
      assertSQLiteCursorPreRebindConnectionProvenanceWitness(
        connection,
        receipt,
        provenance,
      );
    } catch {
      return this.#poison(
        "SQLite cursor stage ownership transfer source provenance changed during begin",
      );
    }
    this.#cursorTransferSession = session;
    this.#cursorTransferReceipt = receipt;
    this.#cursorTransferProjection = receiptWitness.projectionIdentity;
    this.#cursorTransferCaptureEpoch = owner.transactionEpoch;
    this.#cursorTransferStageEpoch = owner.transactionEpoch;
    this.#cursorTransferAllowedTotalChanges = finalTotalChanges;
    this.#cursorTransferState = "active";
    return session;
  }

  /** Revalidate the live B0b stage/session owner without replaying capture epoch. */
  [SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER](
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    session: object,
  ): void {
    this.#fenceCursorStageTransfer(connection, receipt, session);
  }

  #fenceCursorStageTransfer(
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    session: object,
    captured = false,
  ): void {
    const receiptWitness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
    if (this.#cursorTransferState !== "active"
        || connection !== this.#connection
        || receipt !== this.#cursorTransferReceipt
        || session !== this.#cursorTransferSession
        || receiptWitness.projectionIdentity !== this.#cursorTransferProjection
        || this.#cursorTransferProjection !== this.#orderedProjectionIdentity
        || this.#cursorTransferCaptureEpoch === undefined
        || this.#cursorTransferStageEpoch !== this.#transactionEpoch
        || this.#cursorTransferAllowedTotalChanges !== this.#allowedTotalChanges
        || activeStage(connection) !== this
        || this.#orderedHandoffState !== "complete"
        || this.#orderedHandoffSession !== undefined
        || this.#orderedHandoffCleanup !== undefined
        || this.#streamRecordCampaignState !== "complete"
        || this.#streamRecordCampaignSession !== undefined
        || this.#streamRecordCampaignCleanup !== undefined
        || this.#checkpointCampaignState !== "complete"
        || this.#checkpointCampaignSession !== undefined
        || this.#checkpointCampaignCleanup !== undefined
        || this.#leaseLockHoldCampaignState !== "complete"
        || this.#leaseLockHoldCampaignSession !== undefined
        || this.#leaseLockHoldCampaignCleanup !== undefined
        || this.#legacyCampaignState !== "complete"
        || this.#legacyCampaignSession !== undefined
        || this.#legacyCampaignCleanup !== undefined) {
      return this.#poison("SQLite cursor stage ownership transfer session is invalid");
    }
    // Prove the stage write fence before consulting the retained owner
    // snapshots. Active B2 uses captured intrinsics throughout; a real,
    // same-cardinality DELETE+INSERT must still be classified as an
    // unexplained write rather than a generic owner-fence failure.
    this.#requireOpenOwner(captured);
    this.#requireAllowedChanges(captured);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(connection);
    if (!ownerBefore.isTransaction
        || ownerBefore.transactionMode !== "exclusive"
        || ownerBefore.transactionEpoch !== this.#cursorTransferStageEpoch
        || changesBefore.transactionEpoch !== ownerBefore.transactionEpoch
        || changesBefore.totalChanges !== this.#cursorTransferAllowedTotalChanges) {
      return this.#poison("SQLite cursor stage ownership transfer owner fence changed");
    }
    this.#assertExactBaselineCatalog("cursor transfer fence", captured);
    this.#assertMainOperationsCatalog("cursor transfer fence", captured);
    this.#requireAllowedChanges(captured);
    const ownerAfter = readSQLiteConnectionOwnerSnapshot(connection);
    const changesAfter = readSQLiteConnectionTotalChangesSnapshot(connection);
    const ownerFinal = readSQLiteConnectionOwnerSnapshot(connection);
    let reportedEpoch = ownerFinal.transactionEpoch;
    if (!captured) {
      try {
        reportedEpoch = connection.transactionEpoch;
      } catch {
        return this.#poison("SQLite cursor stage ownership transfer owner fence changed");
      }
    }
    if (!ownerAfter.isTransaction
        || ownerAfter.transactionMode !== "exclusive"
        || ownerAfter.transactionEpoch !== this.#cursorTransferStageEpoch
        || ownerAfter.transactionEpoch !== ownerBefore.transactionEpoch
        || this.#transactionEpoch !== this.#cursorTransferStageEpoch
        || changesAfter.transactionEpoch !== ownerAfter.transactionEpoch
        || changesAfter.totalChanges !== this.#cursorTransferAllowedTotalChanges
        || changesAfter.totalChanges !== changesBefore.totalChanges
        || !ownerFinal.isTransaction
        || ownerFinal.transactionMode !== "exclusive"
        || ownerFinal.transactionEpoch !== ownerAfter.transactionEpoch
        || reportedEpoch !== ownerFinal.transactionEpoch) {
      return this.#poison("SQLite cursor stage ownership transfer owner fence changed");
    }
  }

  /** Execute and adopt the sole exact stage-owned B1 DDL transition. */
  [SQLITE_BASELINE_CREATE_CURSOR_SEAL_TEMP_TABLE](
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    session: object,
  ): void {
    // A2b remains first even when this package-private hook is called directly.
    assertSQLiteCursorPreRebindReceiptProvenance(receipt);
    this.#fenceCursorStageTransfer(connection, receipt, session);
    if (this.#cursorSealState !== "absent"
        || this.#cursorSealRootpage !== undefined
        || this.#cursorTransferCaptureEpoch === undefined
        || this.#cursorTransferStageEpoch === undefined
        || this.#cursorTransferAllowedTotalChanges === undefined) {
      return this.#poison("SQLite cursor seal TEMP table creation is already started");
    }

    const ownerBefore = readSQLiteConnectionOwnerSnapshot(connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(connection);
    if (!ownerBefore.isTransaction
        || ownerBefore.transactionMode !== "exclusive"
        || ownerBefore.transactionEpoch !== this.#transactionEpoch
        || ownerBefore.transactionEpoch !== this.#cursorTransferStageEpoch
        || changesBefore.transactionEpoch !== ownerBefore.transactionEpoch
        || changesBefore.totalChanges !== this.#allowedTotalChanges
        || changesBefore.totalChanges !== this.#cursorTransferAllowedTotalChanges) {
      return this.#poison("SQLite cursor seal TEMP table owner fence changed");
    }

    this.#cursorSealState = "creating";
    let attemptIdentity: SQLiteCursorSealAttemptIdentity | undefined;
    let ownerAfterCreate: SQLiteConnectionOwnerSnapshot | undefined;
    try {
      execSQLiteConnectionTrustedIntrinsic(
        connection,
        SQLITE_CURSOR_SEAL_TEMP_TABLE_DDL,
        OPERATION,
      );
      ownerAfterCreate = readSQLiteConnectionOwnerSnapshot(connection);
      const changesAfterCreate = readSQLiteConnectionTotalChangesSnapshot(connection);
      if (!ownerAfterCreate.isTransaction
          || ownerAfterCreate.transactionMode !== "exclusive"
          || ownerAfterCreate.transactionEpoch !== ownerBefore.transactionEpoch + 1n
          || changesAfterCreate.transactionEpoch !== ownerAfterCreate.transactionEpoch
          || changesAfterCreate.totalChanges !== changesBefore.totalChanges) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          OPERATION,
          "SQLite cursor seal TEMP table DDL delta is invalid",
        );
      }
      attemptIdentity = cursorSealAttemptIdentityIntrinsic(connection);

      const rootpage = validateBaselineTempCatalog(connection, true);
      this.#assertMainOperationsCatalog("cursor seal create");
      const ownerAfterValidation = readSQLiteConnectionOwnerSnapshot(connection);
      const changesAfterValidation = readSQLiteConnectionTotalChangesSnapshot(connection);
      if (rootpage === undefined
          || rootpage !== attemptIdentity.rootpage
          || !ownerAfterValidation.isTransaction
          || ownerAfterValidation.transactionMode !== "exclusive"
          || ownerAfterValidation.transactionEpoch !== ownerAfterCreate.transactionEpoch
          || changesAfterValidation.transactionEpoch !== ownerAfterValidation.transactionEpoch
          || changesAfterValidation.totalChanges !== changesBefore.totalChanges
          || reservedCatalogCount(connection) !== EXPECTED_RESERVED_OBJECT_COUNT + 1) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          OPERATION,
          "SQLite cursor seal TEMP table adoption fence is invalid",
        );
      }

      // Capture epoch is intentionally immutable. Only the live stage epoch is
      // advanced across the one exact package-owned DDL statement.
      this.#transactionEpoch = ownerAfterValidation.transactionEpoch;
      this.#cursorTransferStageEpoch = ownerAfterValidation.transactionEpoch;
      this.#cursorSealRootpage = rootpage;
      this.#cursorSealCatalogSnapshot = baselineTempCatalogSnapshot(
        connection, EXPECTED_RESERVED_OBJECT_COUNT + 1,
      );
      this.#cursorSealState = "present";
    } catch (error) {
      // The name was proven absent immediately before the owned attempt, so a
      // best-effort drop can only target this transition's object. Preserve the
      // authoritative creation/adoption error even if cleanup or poison fails.
      let cleanedExactAttempt = false;
      if (attemptIdentity !== undefined && ownerAfterCreate !== undefined) {
        try {
          const cleanupOwner = readSQLiteConnectionOwnerSnapshot(connection);
          const cleanupChanges = readSQLiteConnectionTotalChangesSnapshot(connection);
          const currentIdentity = cursorSealAttemptIdentityIntrinsic(connection);
          if (cleanupOwner.isTransaction
              && cleanupOwner.transactionMode === "exclusive"
              && cleanupOwner.transactionEpoch === ownerAfterCreate.transactionEpoch
              && cleanupChanges.transactionEpoch === cleanupOwner.transactionEpoch
              && cleanupChanges.totalChanges === changesBefore.totalChanges
              && currentIdentity.rootpage === attemptIdentity.rootpage
              && currentIdentity.sql === attemptIdentity.sql) {
            execSQLiteConnectionTrustedIntrinsic(
              connection,
              `DROP TABLE temp.${SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME}`,
              OPERATION,
            );
            cleanedExactAttempt = true;
          }
        } catch {
          // Unknown generation/identity must never be deleted by name.
        }
      }
      if (cleanedExactAttempt) {
        try {
          const ownerAfterCleanup = readSQLiteConnectionOwnerSnapshot(connection);
          if (ownerAfterCleanup.isTransaction
              && ownerAfterCleanup.transactionMode === "exclusive") {
            this.#transactionEpoch = ownerAfterCleanup.transactionEpoch;
            this.#cursorTransferStageEpoch = ownerAfterCleanup.transactionEpoch;
          }
        } catch {
          // A closed/replaced owner is secondary to the primary B1 failure.
        }
      }
      this.#cursorSealRootpage = undefined;
      this.#cursorSealCatalogSnapshot = undefined;
      this.#cursorSealState = "poisoned";
      try {
        this.#poison("SQLite cursor seal TEMP table creation failed");
      } catch {
        // Preserve the exact primary exception.
      }
      throw error;
    }
  }

  /** Begin B2 only from the exact retained B0b session and adopted B1 table. */
  [SQLITE_BASELINE_BEGIN_CURSOR_PRE_REBIND](
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    transferSession: object,
  ): object {
    assertSQLiteCursorPreRebindReceiptProvenance(receipt);
    this.#fenceCursorStageTransfer(connection, receipt, transferSession);
    if (this.#cursorSealState !== "present"
        || this.#cursorPreRebindState !== "unused"
        || this.#cursorPreRebindSession !== undefined
        || this.#cursorPreRebindCleanup !== undefined) {
      return this.#poison("SQLite cursor pre-rebind campaign authority is invalid");
    }
    let insertStatement: StatementSync;
    try {
      insertStatement = prepareSQLiteConnectionIntrinsic(
        connection, SQLITE_CURSOR_STAGE_INSERT_SQL, OPERATION,
      );
    } catch (error) {
      try {
        this.#poison("SQLite cursor pre-rebind insert statement is invalid");
      } catch {
        // The exact statement preparation failure remains authoritative.
      }
      throw error;
    }
    const session = Object.freeze(Object.create(null)) as object;
    this.#cursorPreRebindSession = session;
    this.#cursorPreRebindInsertStatement = insertStatement;
    this.#cursorPreRebindState = "active";
    return session;
  }

  [SQLITE_BASELINE_FENCE_CURSOR_PRE_REBIND](session: object): void {
    this.#fenceCursorPreRebind(session);
  }

  #fenceCursorPreRebind(session: object): void {
    if (this.#cursorPreRebindState !== "active"
        || session !== this.#cursorPreRebindSession
        || this.#cursorTransferSession === undefined
        || this.#cursorTransferReceipt === undefined) {
      return this.#poison("SQLite cursor pre-rebind campaign session is invalid");
    }
    this.#fenceCursorStageTransfer(
      this.#connection,
      this.#cursorTransferReceipt,
      this.#cursorTransferSession,
      true,
    );
  }

  [SQLITE_BASELINE_REGISTER_CURSOR_PRE_REBIND_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void {
    this.#fenceCursorPreRebind(session);
    if (cleanup !== undefined && this.#cursorPreRebindCleanup !== undefined) {
      return this.#poison("SQLite cursor pre-rebind cleanup is already active");
    }
    this.#cursorPreRebindCleanup = cleanup;
  }

  [SQLITE_BASELINE_INSERT_CURSOR_PRE_REBIND_ROW](
    session: object,
    values: readonly SQLiteCursorStageValue[],
  ): void {
    this.#fenceCursorPreRebind(session);
    if (!Array.isArray(values) || values.length !== 30) {
      return this.#poison("SQLite cursor pre-rebind stage tuple is invalid");
    }
    const statement = this.#cursorPreRebindInsertStatement;
    if (statement === undefined) {
      return this.#poison("SQLite cursor pre-rebind insert statement is absent");
    }
    const before = this.#requireAllowedChanges(true);
    let statementChanges: unknown;
    try {
      statementChanges = statement.run(...values).changes;
    } catch (error) {
      try {
        this.#poison("SQLite cursor pre-rebind stage insert failed");
      } catch {
        // The exact statement execution failure remains authoritative.
      }
      throw error;
    }
    let after: number;
    try {
      after = totalChangesIntrinsic(this.#connection);
    } catch {
      return this.#poison("SQLite cursor pre-rebind stage write count is invalid");
    }
    if ((statementChanges !== 1 && statementChanges !== 1n) || after !== before + 1) {
      return this.#poison("SQLite cursor pre-rebind stage write count is invalid");
    }
    this.#allowedTotalChanges = after;
    this.#cursorTransferAllowedTotalChanges = this.#allowedTotalChanges;
    this.#fenceCursorPreRebind(session);
  }

  [SQLITE_BASELINE_COMPLETE_CURSOR_PRE_REBIND](session: object): void {
    this.#fenceCursorPreRebind(session);
    if (this.#cursorPreRebindCleanup !== undefined) {
      return this.#poison("SQLite cursor pre-rebind cleanup remains active");
    }
    this.#cursorPreRebindSession = undefined;
    this.#cursorPreRebindInsertStatement = undefined;
    this.#cursorPreRebindState = "pre-rebind-complete";
  }

  [SQLITE_BASELINE_DIAGNOSE_CURSOR_PRE_REBIND](session: object): void {
    this.#fenceCursorPreRebind(session);
    if (this.#cursorPreRebindCleanup !== undefined) {
      return this.#poison("SQLite cursor pre-rebind cleanup remains active");
    }
    this.#cursorPreRebindSession = undefined;
    this.#cursorPreRebindInsertStatement = undefined;
    this.#cursorPreRebindState = "diagnosed";
  }

  [SQLITE_BASELINE_ABORT_CURSOR_PRE_REBIND](
    session: object | undefined,
    message: string,
  ): never {
    const cleanup = this.#cursorPreRebindCleanup;
    const expectedSession = this.#cursorPreRebindSession;
    this.#cursorPreRebindCleanup = undefined;
    this.#cursorPreRebindSession = undefined;
    this.#cursorPreRebindInsertStatement = undefined;
    this.#cursorPreRebindState = "poisoned";
    try {
      cleanup?.();
    } catch {
      // Preserve the authoritative campaign failure.
    }
    if (session !== undefined && session !== expectedSession) {
      message = "SQLite cursor pre-rebind campaign session is invalid";
    }
    // An explicit owner disposal is terminal in its own right.  The campaign
    // still fails closed, but its best-effort abort must not rewrite the
    // externally observable lifecycle from `disposed` to `poisoned` after
    // disposal has already finalized the cursor and removed every TEMP object.
    if (this.#state === "disposed") {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        OPERATION,
        message,
      );
    }
    return this.#poison(message);
  }

  /** Burn the B0b session while preserving the authoritative caller failure. */
  [SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER](
    session: object | undefined,
    message: string,
  ): never {
    if (session !== undefined && session !== this.#cursorTransferSession) {
      message = "SQLite cursor stage ownership transfer session is invalid";
    }
    this.#cursorTransferSession = undefined;
    this.#cursorTransferReceipt = undefined;
    this.#cursorTransferProjection = undefined;
    this.#cursorTransferStageEpoch = undefined;
    this.#cursorTransferAllowedTotalChanges = undefined;
    if (this.#cursorSealState !== "absent") this.#cursorSealState = "poisoned";
    if (this.#cursorTransferState === "active") this.#cursorTransferState = "poisoned";
    return this.#poison(message);
  }

  /** Package-private fail-closed bridge used when source receipt checks fail. */
  [SQLITE_BASELINE_COOPERATIVE_POISON](message: string): never {
    if (this.#state === "open") return this.#poison(message);
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      OPERATION,
      message,
    );
  }

  /** Insert one already-canonical entry with an exact one-row write delta. */
  insertCommon(
    entryKind: OperationBaselineEntryKind,
    keyBytes: Uint8Array,
    stateBytes: Uint8Array,
  ): void {
    this.#requireStandaloneWriteLane();
    const prepared = this.#prepareEntry(entryKind, keyBytes, stateBytes);
    this.#insertCommonPrepared(prepared);
  }

  /**
   * Insert one canonical common row and its rank-matched relation row.
   *
   * Legacy v1 operations re-read and fully validate their exact raw result
   * carrier before either write; no decoded result is retained afterward.
   */
  insertEntryWithRelation(entry: SQLiteBaselineStageEntry): void {
    this.#requireStandaloneWriteLane();
    this.#insertEntryWithRelation(entry);
  }

  #insertEntryWithRelation(entry: SQLiteBaselineStageEntry): void {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return invalid("SQLite baseline staged entry is invalid");
    }
    const prepared = this.#prepareEntry(
      entry.entryKind,
      entry.keyBytes,
      entry.stateBytes,
    );
    this.#requireAllowedChanges();
    let relation: RelationInsert;
    try {
      relation = prepared.entryKind === "legacy-operation"
        ? projectLegacyRelationInsert(this.#connection, prepared)
        : projectRelationInsert(prepared);
    } catch {
      return this.#poison("SQLite baseline relation projection failed");
    }
    this.#insertCommonPrepared(prepared);
    this.#insertOneRelation(relation);
  }

  /** Prove exact grouped and total common-stage counts for all twelve kinds. */
  assertCommonCounts(expected: SQLiteBaselineExpectedCounts): void {
    this.#requireOpenOwner();
    this.#requireAllowedChanges();
    if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
      return invalid("SQLite baseline expected counts must contain exactly twelve kinds");
    }
    const actualKinds = Object.keys(expected);
    if (actualKinds.length !== BASELINE_ENTRY_KINDS.length
        || BASELINE_ENTRY_KINDS.some((entryKind) => !Object.hasOwn(expected, entryKind))) {
      return invalid("SQLite baseline expected counts must contain exactly twelve kinds");
    }
    let expectedTotal = 0;
    for (const entryKind of BASELINE_ENTRY_KINDS) {
      const expectedCount = checkedExpectedCount(expected[entryKind]);
      expectedTotal += expectedCount;
      if (!Number.isSafeInteger(expectedTotal)) {
        return invalid("SQLite baseline expected stage count is outside bounds");
      }
      const rank = KIND_RANK.get(entryKind);
      if (rank === undefined) return this.#poison("SQLite baseline kind rank is invalid");
      const actual = scalarCount(
        this.#connection,
        `SELECT count(*) FROM temp.${STAGE_TABLE}
          WHERE kind_rank = ${rank} AND entry_kind = '${entryKind}'`,
        "TEMP stage kind count",
      );
      if (actual !== expectedCount) {
        return this.#poison("SQLite baseline common-stage count is invalid");
      }
    }
    const actualTotal = scalarCount(
      this.#connection,
      `SELECT count(*) FROM temp.${STAGE_TABLE}`,
      "TEMP stage total count",
    );
    this.#requireAllowedChanges();
    if (actualTotal !== expectedTotal) {
      return this.#poison("SQLite baseline common-stage total count is invalid");
    }
    this.#requireAllowedChanges();
  }

  /** Prove bidirectional key coverage once normalized relation rows exist. */
  assertRelationKeyCoverage(): void {
    this.#requireOpenOwner();
    this.#requireAllowedChanges();
    const missing = scalarCount(
      this.#connection,
      `SELECT count(*)
         FROM temp.${STAGE_TABLE} AS stage
         LEFT JOIN temp.${RELATION_VIEW} AS relation
           ON relation.kind_rank = stage.kind_rank
          AND relation.key_blob = stage.key_blob
        WHERE relation.key_blob IS NULL`,
      "TEMP stage missing relation count",
    );
    const extra = scalarCount(
      this.#connection,
      `SELECT count(*)
         FROM temp.${RELATION_VIEW} AS relation
         LEFT JOIN temp.${STAGE_TABLE} AS stage
           ON stage.kind_rank = relation.kind_rank
          AND stage.key_blob = relation.key_blob
        WHERE stage.key_blob IS NULL`,
      "TEMP stage extra relation count",
    );
    this.#requireAllowedChanges();
    if (missing !== 0 || extra !== 0) {
      return this.#poison("SQLite baseline stage/relation key coverage is invalid");
    }
    this.#requireAllowedChanges();
  }

  /** Drop every owned TEMP object in reverse creation order. */
  dispose(): void {
    if (this.#state === "disposed") return;
    this.#pendingOwnedWrite = undefined;
    let handoffCleanupFailure: unknown;
    if (this.#orderedHandoffState === "active") {
      try {
        this.#orderedHandoffCleanup?.();
      } catch (error) {
        handoffCleanupFailure = error;
      }
      this.#orderedHandoffCleanup = undefined;
      this.#orderedHandoffSession = undefined;
      this.#orderedHandoffState = "poisoned";
    }
    if (this.#streamRecordCampaignState === "active") {
      try {
        this.#streamRecordCampaignCleanup?.();
      } catch (error) {
        handoffCleanupFailure ??= error;
      }
      this.#streamRecordCampaignCleanup = undefined;
      this.#streamRecordCampaignSession = undefined;
      this.#streamRecordCampaignState = "poisoned";
    }
    if (this.#checkpointCampaignState === "active") {
      try {
        this.#checkpointCampaignCleanup?.();
      } catch (error) {
        handoffCleanupFailure ??= error;
      }
      this.#checkpointCampaignCleanup = undefined;
      this.#checkpointCampaignSession = undefined;
      this.#checkpointCampaignState = "poisoned";
    }
    if (this.#leaseLockHoldCampaignState === "active") {
      try {
        this.#leaseLockHoldCampaignCleanup?.();
      } catch (error) {
        handoffCleanupFailure ??= error;
      }
      this.#leaseLockHoldCampaignCleanup = undefined;
      this.#leaseLockHoldCampaignSession = undefined;
      this.#leaseLockHoldCampaignState = "poisoned";
    }
    if (this.#legacyCampaignState === "active") {
      try {
        this.#legacyCampaignCleanup?.();
      } catch (error) {
        handoffCleanupFailure ??= error;
      }
      this.#legacyCampaignCleanup = undefined;
      this.#legacyCampaignSession = undefined;
      this.#legacyCampaignState = "poisoned";
    }
    if (this.#cursorPreRebindState === "active") {
      const cleanup = this.#cursorPreRebindCleanup;
      this.#cursorPreRebindCleanup = undefined;
      this.#cursorPreRebindSession = undefined;
      this.#cursorPreRebindInsertStatement = undefined;
      this.#cursorPreRebindState = "poisoned";
      try {
        cleanup?.();
      } catch (error) {
        handoffCleanupFailure ??= error;
      }
    }
    if (this.#cursorTransferState === "active") this.#cursorTransferState = "poisoned";
    if (this.#cursorSealState !== "absent") this.#cursorSealState = "poisoned";
    this.#cursorTransferSession = undefined;
    this.#cursorTransferReceipt = undefined;
    this.#cursorTransferProjection = undefined;
    this.#cursorTransferStageEpoch = undefined;
    this.#cursorTransferAllowedTotalChanges = undefined;
    if (!this.#connection.isOpen) {
      this.#state = "disposed";
      deleteActiveStage(this.#connection);
      if (handoffCleanupFailure !== undefined) throw handoffCleanupFailure;
      return;
    }
    if (!this.#connection.isTransaction
        || this.#connection.transactionMode !== "exclusive"
        || this.#connection.transactionEpoch !== this.#transactionEpoch) {
      // A rollback/rebegin may let the caller create new objects with the same
      // fixed names. A stale stage must never delete those replacement objects.
      this.#state = "disposed";
      deleteActiveStage(this.#connection);
      if (handoffCleanupFailure !== undefined) throw handoffCleanupFailure;
      return;
    }
    const drops = [
      `DROP TABLE temp.${SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME}`,
      `DROP VIEW temp.${RELATION_VIEW}`,
      ...[...INDEXES].reverse().map((name) => `DROP INDEX temp.${name}`),
      ...[STAGE_TABLE, ...RELATION_TABLES]
        .reverse()
        .map((name) => `DROP TABLE temp.${name}`),
    ];
    const existing = new Set<string>();
    const existingStatement = prepareSQLiteConnectionIntrinsic(
      this.#connection,
      "SELECT name FROM temp.sqlite_schema WHERE name = ?",
      OPERATION,
    );
    // Probe only the fixed package-owned allowlist.  A bounded prefix scan can
    // be crowded out by foreign reserved objects when SQLite reverses an
    // unordered catalog walk; captured preparation also prevents a replaceable
    // public method from fabricating or suppressing disposal membership.
    for (const sql of drops) {
      const name = sql.slice(sql.lastIndexOf(".") + 1);
      const raw = existingStatement.get(name);
      if (raw === undefined) continue;
      const actualName = sqliteText(
        sqliteRow(raw, 1, OPERATION, "TEMP owned catalog name")[0],
        OPERATION,
        "TEMP owned catalog name",
      );
      if (actualName !== name) {
        throw new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          OPERATION,
          "SQLite baseline TEMP stage disposal identity is invalid",
        );
      }
      existing.add(actualName);
    }
    let firstFailure: unknown = handoffCleanupFailure;
    let cursorSealOwned = false;
    if (existing.has(SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME)) {
      try {
        const identity = cursorSealAttemptIdentityIntrinsic(this.#connection);
        cursorSealOwned = this.#cursorSealRootpage !== undefined
          && identity.rootpage === this.#cursorSealRootpage
          && identity.sql === SQLITE_CURSOR_SEAL_SCHEMA_SQL;
      } catch {
        // A same-name object whose exact identity cannot be re-proven is not
        // ours to delete, even while the original transaction is still live.
      }
      if (!cursorSealOwned) {
        firstFailure ??= new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          OPERATION,
          "SQLite cursor seal TEMP table disposal identity is invalid",
        );
      }
    }
    for (const sql of drops) {
      const name = sql.slice(sql.lastIndexOf(".") + 1);
      if (!existing.has(name)) continue;
      if (name === SQLITE_CURSOR_SEAL_TEMP_TABLE_NAME && !cursorSealOwned) continue;
      try {
        execSQLiteConnectionTrustedIntrinsic(this.#connection, sql, OPERATION);
        this.#transactionEpoch = readSQLiteConnectionOwnerSnapshot(
          this.#connection,
        ).transactionEpoch;
      } catch (error) {
        firstFailure ??= error;
      }
    }
    try {
      if (reservedCatalogCountIntrinsic(this.#connection) !== 0) {
        firstFailure ??= new CycleStoreProviderError(
          "GE_CYCLE_STORE_CORRUPTION",
          OPERATION,
          "SQLite baseline TEMP stage disposal left reserved objects",
        );
      }
    } catch (error) {
      firstFailure ??= error;
    }
    if (firstFailure !== undefined) {
      this.#state = "poisoned";
      throw firstFailure;
    }
    this.#state = "disposed";
    deleteActiveStage(this.#connection);
  }

  #requireOpenOwner(captured = false): void {
    if (this.#state === "disposed") {
      return invalid("SQLite baseline TEMP stage is disposed");
    }
    if (this.#state === "poisoned") {
      return invalid("SQLite baseline TEMP stage is poisoned");
    }
    let owner: SQLiteConnectionOwnerSnapshot;
    try {
      owner = captured
        ? readSQLiteConnectionOwnerSnapshot(this.#connection)
        : {
            isTransaction: this.#connection.isTransaction,
            transactionLineage: this.#connection.transactionLineage,
            transactionMode: this.#connection.transactionMode,
            transactionEpoch: this.#connection.transactionEpoch,
          };
    } catch {
      return unavailable("SQLite provider is closed");
    }
    if (!owner.isTransaction
        || owner.transactionMode !== "exclusive"
        || owner.transactionEpoch !== this.#transactionEpoch) {
      return this.#poison("SQLite baseline TEMP stage transaction changed");
    }
  }

  #requireStandaloneWriteLane(): void {
    this.#requireOpenOwner();
    if (this.#writeLane === "cooperative") {
      return this.#poison("SQLite baseline cooperative and standalone writes cannot be mixed");
    }
    this.#writeLane = "standalone";
  }

  #requireAllowedChanges(captured = false): number {
    let actual: number;
    try {
      actual = captured
        ? totalChangesIntrinsic(this.#connection)
        : totalChanges(this.#connection);
    } catch {
      return this.#poison("SQLite baseline TEMP stage change counter is invalid");
    }
    if (actual !== this.#allowedTotalChanges) {
      return this.#poison("SQLite baseline TEMP stage observed an unexplained write");
    }
    return actual;
  }

  #prepareEntry(
    entryKind: OperationBaselineEntryKind,
    keyBytes: Uint8Array,
    stateBytes: Uint8Array,
  ): PreparedStageEntry {
    this.#requireOpenOwner();
    const rank = KIND_RANK.get(entryKind);
    if (rank === undefined) return invalid("SQLite baseline entry kind is invalid");
    try {
      const key = Buffer.from(keyBytes);
      const state = Buffer.from(stateBytes);
      validateOperationBaselineEntryBytes(entryKind, key, state);
      return {
        entryKind,
        key: canonicalRecord(key, MAX_BASELINE_KEY_BYTES),
        keyBytes: key,
        rank,
        state: canonicalRecord(state, MAX_BASELINE_STATE_BYTES),
        stateBytes: state,
      };
    } catch {
      return this.#poison("SQLite baseline common-stage entry bytes are invalid");
    }
  }

  #insertCommonPrepared(entry: PreparedStageEntry): void {
    this.#insertExactlyOne(
      `INSERT INTO temp.${STAGE_TABLE}
         (kind_rank, entry_kind, key_blob, state_blob)
       VALUES (?, ?, ?, ?)`,
      [entry.rank, entry.entryKind, entry.keyBytes, entry.stateBytes],
      "SQLite baseline common-stage insert failed",
      "SQLite baseline common-stage write count is invalid",
    );
  }

  #insertOneRelation(insert: RelationInsert): void {
    this.#insertExactlyOne(
      insert.sql,
      insert.values,
      "SQLite baseline relation insert failed",
      "SQLite baseline relation write count is invalid",
    );
  }

  #insertExactlyOne(
    sql: string,
    values: readonly RelationValue[],
    insertFailure: string,
    countFailure: string,
  ): void {
    this.#requireOpenOwner();
    const before = this.#requireAllowedChanges();
    let statementChanges: unknown;
    try {
      statementChanges = this.#connection.prepare(sql, OPERATION).run(...values).changes;
    } catch {
      return this.#poison(insertFailure);
    }
    let after: number;
    try {
      after = totalChanges(this.#connection);
    } catch {
      return this.#poison(countFailure);
    }
    if ((statementChanges !== 1 && statementChanges !== 1n) || after !== before + 1) {
      return this.#poison(countFailure);
    }
    this.#allowedTotalChanges = after;
  }

  #assertExactBaselineCatalog(label: string, captured = false): void {
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(this.#connection);
    if (!ownerBefore.isTransaction
        || ownerBefore.transactionMode !== "exclusive"
        || ownerBefore.transactionEpoch !== this.#transactionEpoch) {
      return this.#poison(`SQLite baseline ${label} catalog is invalid`);
    }
    const cursorSealExpected = this.#cursorSealState === "present";
    let cursorSealRootpage: number | undefined;
    try {
      if (cursorSealExpected) {
        if (this.#cursorSealCatalogSnapshot === undefined
            || baselineTempCatalogSnapshot(
              this.#connection, EXPECTED_RESERVED_OBJECT_COUNT + 1,
              captured,
            ) !== this.#cursorSealCatalogSnapshot) {
          throw new Error("cursor seal catalog snapshot changed");
        }
        cursorSealRootpage = cursorSealAttemptIdentityIntrinsic(this.#connection).rootpage;
      } else {
        cursorSealRootpage = validateBaselineTempCatalog(this.#connection, false);
      }
    } catch {
      return this.#poison(`SQLite baseline ${label} catalog is invalid`);
    }
    const ownerAfter = readSQLiteConnectionOwnerSnapshot(this.#connection);
    if (!ownerAfter.isTransaction
        || ownerAfter.transactionMode !== "exclusive"
        || ownerAfter.transactionEpoch !== ownerBefore.transactionEpoch
        || ownerAfter.transactionEpoch !== this.#transactionEpoch
        || (captured
          ? reservedCatalogCountIntrinsic(this.#connection)
          : reservedCatalogCount(this.#connection))
          !== EXPECTED_RESERVED_OBJECT_COUNT + (cursorSealExpected ? 1 : 0)
        || (cursorSealExpected && cursorSealRootpage !== this.#cursorSealRootpage)) {
      return this.#poison(`SQLite baseline ${label} catalog is invalid`);
    }
  }

  #assertMainOperationsCatalog(label: string, captured = false): void {
    let actual: SQLiteMainOperationsCatalogIdentity;
    try {
      actual = mainOperationsCatalogIdentity(this.#connection, captured);
    } catch {
      return this.#poison(`SQLite baseline ${label} main operation catalog is invalid`);
    }
    const expected = this.#mainOperationsCatalogIdentity;
    if (expected.rootpage === null
        || expected.sql === null
        || actual.schemaVersion !== expected.schemaVersion
        || actual.rootpage !== expected.rootpage
        || actual.sql !== expected.sql) {
      return this.#poison(`SQLite baseline ${label} main operation catalog is invalid`);
    }
  }

  #poison(message: string): never {
    this.#pendingOwnedWrite = undefined;
    this.#orderedHandoffCleanup = undefined;
    this.#orderedHandoffSession = undefined;
    if (this.#orderedHandoffState === "active") this.#orderedHandoffState = "poisoned";
    this.#streamRecordCampaignCleanup = undefined;
    this.#streamRecordCampaignSession = undefined;
    if (this.#streamRecordCampaignState === "active") {
      this.#streamRecordCampaignState = "poisoned";
    }
    this.#checkpointCampaignCleanup = undefined;
    this.#checkpointCampaignSession = undefined;
    if (this.#checkpointCampaignState === "active") {
      this.#checkpointCampaignState = "poisoned";
    }
    this.#leaseLockHoldCampaignCleanup = undefined;
    this.#leaseLockHoldCampaignSession = undefined;
    if (this.#leaseLockHoldCampaignState === "active") {
      this.#leaseLockHoldCampaignState = "poisoned";
    }
    this.#legacyCampaignCleanup = undefined;
    this.#legacyCampaignSession = undefined;
    if (this.#legacyCampaignState === "active") {
      this.#legacyCampaignState = "poisoned";
    }
    if (this.#cursorTransferState === "active") this.#cursorTransferState = "poisoned";
    if (this.#cursorSealState !== "absent") this.#cursorSealState = "poisoned";
    this.#cursorTransferSession = undefined;
    this.#cursorTransferReceipt = undefined;
    this.#cursorTransferProjection = undefined;
    this.#cursorTransferStageEpoch = undefined;
    this.#cursorTransferAllowedTotalChanges = undefined;
    // Disposal is an irreversible public lifecycle state.  A stale campaign
    // may still discover its invalidated private authority and fail closed,
    // but that later failure must not rewrite an already completed disposal.
    if (this.#state !== "disposed") this.#state = "poisoned";
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      OPERATION,
      message,
    );
  }
}

const sqliteBaselineBeginCursorStageTransferIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER];
const sqliteBaselineFenceCursorStageTransferIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER];
const sqliteBaselineAbortCursorStageTransferIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER];
const sqliteBaselineCreateCursorSealTempTableIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_CREATE_CURSOR_SEAL_TEMP_TABLE];
const sqliteBaselineBeginCursorPreRebindIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_BEGIN_CURSOR_PRE_REBIND];
const sqliteBaselineFenceCursorPreRebindIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_FENCE_CURSOR_PRE_REBIND];
const sqliteBaselineRegisterCursorPreRebindCleanupIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_REGISTER_CURSOR_PRE_REBIND_CLEANUP];
const sqliteBaselineInsertCursorPreRebindRowIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_INSERT_CURSOR_PRE_REBIND_ROW];
const sqliteBaselineCompleteCursorPreRebindIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_COMPLETE_CURSOR_PRE_REBIND];
const sqliteBaselineDiagnoseCursorPreRebindIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_DIAGNOSE_CURSOR_PRE_REBIND];
const sqliteBaselineAbortCursorPreRebindIntrinsic =
  SQLiteBaselineTempStage.prototype[SQLITE_BASELINE_ABORT_CURSOR_PRE_REBIND];

/** Invoke the captured exact B0b begin hook despite later prototype replacement. */
export function beginSQLiteBaselineCursorStageTransferIntrinsic(
  stage: SQLiteBaselineTempStage,
  connection: SQLiteConnection,
  receipt: SQLiteCursorPreRebindReceipt,
  provenance: SQLiteCursorPreRebindConnectionProvenance,
): object {
  return Reflect.apply(sqliteBaselineBeginCursorStageTransferIntrinsic, stage, [
    connection,
    receipt,
    provenance,
  ]);
}

/** Invoke the captured exact B0b retained fence. */
export function fenceSQLiteBaselineCursorStageTransferIntrinsic(
  stage: SQLiteBaselineTempStage,
  connection: SQLiteConnection,
  receipt: SQLiteCursorPreRebindReceipt,
  session: object,
): void {
  Reflect.apply(sqliteBaselineFenceCursorStageTransferIntrinsic, stage, [
    connection,
    receipt,
    session,
  ]);
}

/** Invoke the captured exact B0b abort hook while preserving caller precedence. */
export function abortSQLiteBaselineCursorStageTransferIntrinsic(
  stage: SQLiteBaselineTempStage,
  session: object | undefined,
  message: string,
): never {
  return Reflect.apply(sqliteBaselineAbortCursorStageTransferIntrinsic, stage, [
    session,
    message,
  ]) as never;
}

/** Invoke the captured exact B1 DDL hook despite later prototype replacement. */
export function createSQLiteBaselineCursorSealTempTableIntrinsic(
  stage: SQLiteBaselineTempStage,
  connection: SQLiteConnection,
  receipt: SQLiteCursorPreRebindReceipt,
  session: object,
): void {
  Reflect.apply(sqliteBaselineCreateCursorSealTempTableIntrinsic, stage, [
    connection,
    receipt,
    session,
  ]);
}

export function beginSQLiteBaselineCursorPreRebindIntrinsic(
  stage: SQLiteBaselineTempStage,
  connection: SQLiteConnection,
  receipt: SQLiteCursorPreRebindReceipt,
  transferSession: object,
): object {
  return Reflect.apply(sqliteBaselineBeginCursorPreRebindIntrinsic, stage, [
    connection, receipt, transferSession,
  ]) as object;
}

export function fenceSQLiteBaselineCursorPreRebindIntrinsic(
  stage: SQLiteBaselineTempStage,
  session: object,
): void {
  Reflect.apply(sqliteBaselineFenceCursorPreRebindIntrinsic, stage, [session]);
}

export function registerSQLiteBaselineCursorPreRebindCleanupIntrinsic(
  stage: SQLiteBaselineTempStage,
  session: object,
  cleanup: (() => void) | undefined,
): void {
  Reflect.apply(sqliteBaselineRegisterCursorPreRebindCleanupIntrinsic, stage, [session, cleanup]);
}

export function insertSQLiteBaselineCursorPreRebindRowIntrinsic(
  stage: SQLiteBaselineTempStage,
  session: object,
  values: readonly SQLiteCursorStageValue[],
): void {
  Reflect.apply(sqliteBaselineInsertCursorPreRebindRowIntrinsic, stage, [session, values]);
}

export function completeSQLiteBaselineCursorPreRebindIntrinsic(
  stage: SQLiteBaselineTempStage,
  session: object,
): void {
  Reflect.apply(sqliteBaselineCompleteCursorPreRebindIntrinsic, stage, [session]);
}

export function diagnoseSQLiteBaselineCursorPreRebindIntrinsic(
  stage: SQLiteBaselineTempStage,
  session: object,
): void {
  Reflect.apply(sqliteBaselineDiagnoseCursorPreRebindIntrinsic, stage, [session]);
}

export function abortSQLiteBaselineCursorPreRebindIntrinsic(
  stage: SQLiteBaselineTempStage,
  session: object | undefined,
  message: string,
): never {
  return Reflect.apply(sqliteBaselineAbortCursorPreRebindIntrinsic, stage, [
    session, message,
  ]) as never;
}

/** Create the fixed TEMP catalog under one exact owner EXCLUSIVE proof. */
export function createSQLiteBaselineTempStage(
  connection: SQLiteConnection,
  proof: SQLiteExclusiveBaselineTransactionProof,
): SQLiteBaselineTempStage {
  if (proof[EXCLUSIVE_PROOF_OWNER] !== connection
      || proof.mode !== "exclusive"
      || !connection.isTransaction
      || connection.transactionMode !== "exclusive"
      || connection.transactionEpoch !== proof.transactionEpoch) {
    return invalid("SQLite baseline TEMP stage requires its current owner EXCLUSIVE proof");
  }
  const active = activeStage(connection);
  if (active !== undefined && active.state !== "disposed") {
    return invalid("SQLite baseline TEMP stage already exists on this connection");
  }
  requireSQLiteBaselineTempStorage(connection);
  if (reservedCatalogCount(connection) !== 0) {
    return invalid("SQLite baseline TEMP stage reserved catalog is not empty");
  }

  const createdTables: string[] = [];
  const createdIndexes: string[] = [];
  let createdView = false;
  const allowedTotalChanges = totalChanges(connection);
  const mainCatalogIdentity = mainOperationsCatalogIdentity(connection);
  try {
    for (let index = 0; index < TABLE_DDL.length; index += 1) {
      connection.execTrusted(TABLE_DDL[index] ?? "", OPERATION);
      createdTables.push(index === 0 ? STAGE_TABLE : RELATION_TABLES[index - 1] ?? "");
    }
    for (let index = 0; index < INDEX_DDL.length; index += 1) {
      connection.execTrusted(INDEX_DDL[index] ?? "", OPERATION);
      createdIndexes.push(INDEXES[index] ?? "");
    }
    connection.execTrusted(VIEW_DDL, OPERATION);
    createdView = true;
    if (reservedCatalogCount(connection) !== EXPECTED_RESERVED_OBJECT_COUNT) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        OPERATION,
        "SQLite baseline TEMP catalog identity is invalid",
      );
    }
    validateBaselineTempCatalog(connection);
    if (totalChanges(connection) !== allowedTotalChanges) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        OPERATION,
        "SQLite baseline TEMP catalog creation changed rows",
      );
    }
  } catch (error) {
    if (createdView) {
      try {
        connection.execTrusted(`DROP VIEW temp.${RELATION_VIEW}`, OPERATION);
      } catch {
        // Preserve the authoritative creation failure and continue cleanup.
      }
    }
    for (const name of createdIndexes.reverse()) {
      try {
        connection.execTrusted(`DROP INDEX temp.${name}`, OPERATION);
      } catch {
        // Preserve the authoritative creation failure and continue cleanup.
      }
    }
    for (const name of createdTables.reverse()) {
      try {
        connection.execTrusted(`DROP TABLE temp.${name}`, OPERATION);
      } catch {
        // Preserve the authoritative creation failure and continue cleanup.
      }
    }
    throw error;
  }

  const stage = new SQLiteBaselineTempStage(
    connection,
    proof,
    connection.transactionEpoch,
    allowedTotalChanges,
    mainCatalogIdentity,
  );
  publishActiveStage(connection, stage);
  return stage;
}

/** Package-private exact-identity fence for the B0b stage owner. */
export function assertSQLiteBaselineTempStageIdentity(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
): void {
  if (activeStage(connection) !== stage) {
    return invalid("SQLite baseline TEMP stage identity is invalid");
  }
}
