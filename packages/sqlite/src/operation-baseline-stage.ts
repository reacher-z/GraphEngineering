import { Buffer } from "node:buffer";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  BASELINE_ENTRY_KINDS,
  MAX_BASELINE_KEY_BYTES,
  MAX_BASELINE_STATE_BYTES,
  type OperationBaselineEntryKind,
  validateOperationBaselineEntryBytes,
} from "./operation-baseline.js";
import { sqliteRow, sqliteSafeInteger, sqliteText } from "./sqlite-codec.js";
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
  readonly [EXCLUSIVE_PROOF_OWNER]: SQLiteConnection;
}

export type SQLiteBaselineTempStageState = "open" | "poisoned" | "disposed";

export type SQLiteBaselineExpectedCounts = Readonly<
  Record<OperationBaselineEntryKind, number>
>;

const EXCLUSIVE_PROOF_OWNER = Symbol("SQLiteExclusiveBaselineTransactionProof.owner");
const ACTIVE_STAGES = new WeakMap<SQLiteConnection, SQLiteBaselineTempStage>();
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

function validateBaselineTempCatalog(connection: SQLiteConnection): void {
  const expectedObjects = new Set<string>([
    `table:${STAGE_TABLE}`,
    ...RELATION_TABLES.map((name) => `table:${name}`),
    ...INDEXES.map((name) => `index:${name}`),
    `view:${RELATION_VIEW}`,
  ]);
  const rows = connection.prepare(
    `SELECT type, name
       FROM temp.sqlite_schema
      WHERE substr(lower(name), 1, 7) = 'ge_blr_'
      ORDER BY type, name`,
    OPERATION,
  ).all();
  const actualObjects = new Set(rows.map((raw) => {
    const row = sqliteRow(raw, 2, OPERATION, "TEMP catalog identity");
    return `${sqliteText(row[0], OPERATION, "TEMP catalog object type")}:${
      sqliteText(row[1], OPERATION, "TEMP catalog object name")}`;
  }));
  if (rows.length !== expectedObjects.size
      || actualObjects.size !== expectedObjects.size
      || [...expectedObjects].some((identity) => !actualObjects.has(identity))) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      OPERATION,
      "SQLite baseline TEMP catalog identity is invalid",
    );
  }

  const expectedTables = new Set<string>([STAGE_TABLE, ...RELATION_TABLES]);
  const tableRows = connection.prepare(
    `SELECT name, type, wr, strict
       FROM pragma_table_list
      WHERE schema = 'temp' AND type = 'table'
        AND substr(lower(name), 1, 7) = 'ge_blr_'`,
    OPERATION,
  ).all();
  const actualTables = new Set<string>();
  for (const raw of tableRows) {
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
    actualTables.add(name);
  }
  if (actualTables.size !== expectedTables.size) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      OPERATION,
      "SQLite baseline TEMP table shape is invalid",
    );
  }
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

  constructor(
    connection: SQLiteConnection,
    proof: SQLiteExclusiveBaselineTransactionProof,
    transactionEpoch: bigint,
    allowedTotalChanges: number,
  ) {
    this.#connection = connection;
    this.#transactionEpoch = transactionEpoch;
    this.#allowedTotalChanges = allowedTotalChanges;
    if (proof[EXCLUSIVE_PROOF_OWNER] !== connection) {
      invalid("SQLite baseline EXCLUSIVE proof belongs to another connection");
    }
  }

  get state(): SQLiteBaselineTempStageState {
    return this.#state;
  }

  /** Insert one already-canonical entry with an exact one-row write delta. */
  insertCommon(
    entryKind: OperationBaselineEntryKind,
    keyBytes: Uint8Array,
    stateBytes: Uint8Array,
  ): void {
    this.#requireOpenOwner();
    const rank = KIND_RANK.get(entryKind);
    if (rank === undefined) return invalid("SQLite baseline entry kind is invalid");
    let key: Buffer;
    let state: Buffer;
    try {
      validateOperationBaselineEntryBytes(entryKind, keyBytes, stateBytes);
      key = Buffer.from(keyBytes);
      state = Buffer.from(stateBytes);
    } catch {
      return this.#poison("SQLite baseline common-stage entry bytes are invalid");
    }
    const before = this.#requireAllowedChanges();
    let statementChanges: unknown;
    try {
      statementChanges = this.#connection.prepare(
        `INSERT INTO temp.${STAGE_TABLE}
           (kind_rank, entry_kind, key_blob, state_blob)
         VALUES (?, ?, ?, ?)`,
        OPERATION,
      ).run(rank, entryKind, key, state).changes;
    } catch {
      return this.#poison("SQLite baseline common-stage insert failed");
    }
    const after = totalChanges(this.#connection);
    if ((statementChanges !== 1 && statementChanges !== 1n) || after !== before + 1) {
      return this.#poison("SQLite baseline common-stage write count is invalid");
    }
    this.#allowedTotalChanges = after;
  }

  /** Prove exact grouped and total common-stage counts for all twelve kinds. */
  assertCommonCounts(expected: SQLiteBaselineExpectedCounts): void {
    this.#requireOpenOwner();
    this.#requireAllowedChanges();
    if (expected === null || typeof expected !== "object" || Array.isArray(expected)) {
      return invalid("SQLite baseline expected counts must contain exactly twelve kinds");
    }
    const actualKinds = Object.keys(expected).sort();
    const expectedKinds = [...BASELINE_ENTRY_KINDS].sort();
    if (actualKinds.length !== expectedKinds.length
        || actualKinds.some((entryKind, index) => entryKind !== expectedKinds[index])) {
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
    if (actualTotal !== expectedTotal) {
      return this.#poison("SQLite baseline common-stage total count is invalid");
    }
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
    if (missing !== 0 || extra !== 0) {
      return this.#poison("SQLite baseline stage/relation key coverage is invalid");
    }
  }

  /** Drop every owned TEMP object in reverse creation order. */
  dispose(): void {
    if (this.#state === "disposed") return;
    if (!this.#connection.isOpen) {
      this.#state = "disposed";
      ACTIVE_STAGES.delete(this.#connection);
      return;
    }
    if (!this.#connection.isTransaction
        || this.#connection.transactionMode !== "exclusive"
        || this.#connection.transactionEpoch !== this.#transactionEpoch) {
      // A rollback/rebegin may let the caller create new objects with the same
      // fixed names. A stale stage must never delete those replacement objects.
      this.#state = "disposed";
      ACTIVE_STAGES.delete(this.#connection);
      return;
    }
    const drops = [
      `DROP VIEW temp.${RELATION_VIEW}`,
      ...[...INDEXES].reverse().map((name) => `DROP INDEX temp.${name}`),
      ...[STAGE_TABLE, ...RELATION_TABLES]
        .reverse()
        .map((name) => `DROP TABLE temp.${name}`),
    ];
    const existing = new Set(
      this.#connection.prepare(
        `SELECT name FROM temp.sqlite_schema
          WHERE substr(lower(name), 1, 7) = 'ge_blr_'`,
        OPERATION,
      ).all().map((row) => sqliteText(
        sqliteRow(row, 1, OPERATION, "TEMP reserved catalog name")[0],
        OPERATION,
        "TEMP reserved catalog name",
      )),
    );
    let firstFailure: unknown;
    for (const sql of drops) {
      const name = sql.slice(sql.lastIndexOf(".") + 1);
      if (!existing.has(name)) continue;
      try {
        this.#connection.execTrusted(sql, OPERATION);
        this.#transactionEpoch = this.#connection.transactionEpoch;
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (reservedCatalogCount(this.#connection) !== 0) {
      firstFailure ??= new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        OPERATION,
        "SQLite baseline TEMP stage disposal left reserved objects",
      );
    }
    if (firstFailure !== undefined) {
      this.#state = "poisoned";
      throw firstFailure;
    }
    this.#state = "disposed";
    ACTIVE_STAGES.delete(this.#connection);
  }

  #requireOpenOwner(): void {
    if (this.#state === "disposed") {
      return invalid("SQLite baseline TEMP stage is disposed");
    }
    if (this.#state === "poisoned") {
      return invalid("SQLite baseline TEMP stage is poisoned");
    }
    if (!this.#connection.isTransaction
        || this.#connection.transactionMode !== "exclusive"
        || this.#connection.transactionEpoch !== this.#transactionEpoch) {
      return this.#poison("SQLite baseline TEMP stage transaction changed");
    }
  }

  #requireAllowedChanges(): number {
    const actual = totalChanges(this.#connection);
    if (actual !== this.#allowedTotalChanges) {
      return this.#poison("SQLite baseline TEMP stage observed an unexplained write");
    }
    return actual;
  }

  #poison(message: string): never {
    this.#state = "poisoned";
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      OPERATION,
      message,
    );
  }
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
  const active = ACTIVE_STAGES.get(connection);
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
  );
  ACTIVE_STAGES.set(connection, stage);
  return stage;
}
