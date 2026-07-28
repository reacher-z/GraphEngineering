import { Buffer } from "node:buffer";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  cycleStoreAdapterCodec,
  type CycleStoreCheckpoint,
  type CycleStoreCheckpointSummary,
} from "@graph-engineering/runtime";

import {
  BASELINE_ENTRY_KINDS,
  type OperationBaselineEntryInput,
  type OperationBaselineEntryKind,
  type OperationBaselineSourceEnvelope,
  decodeOperationBaselineCanonicalBytes,
  encodeOperationBaselineKey,
  encodeOperationBaselineSourceEnvelope,
  encodeOperationBaselineState,
} from "./operation-baseline.js";
import {
  sqliteBlob,
  sqliteNullableText,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "./sqlite-codec.js";
import { SQLiteConnection } from "./sqlite-connection.js";
import {
  SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
  SQLITE_SCHEMA_IDENTITY_SHA256,
  SQLITE_SCHEMA_SQL_SHA256,
} from "./migrations.js";
import { SQLITE_CYCLE_STORE_DESCRIPTOR_HASH } from "./sqlite-profile.js";

const OPERATION = "inspect-schema" as const;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export type SQLiteV1BaselineCounts = Readonly<Record<OperationBaselineEntryKind, number>>;

export interface SQLiteV1BaselineSourceSummary {
  readonly sourceEnvelope: OperationBaselineSourceEnvelope;
  readonly countsByKind: SQLiteV1BaselineCounts;
  readonly expectedEntryCount: number;
  readonly maximumObservedAtMs: number;
  /**
   * Streams the seven v1 source families implemented by this foundation.
   * The iterator is deliberately one-shot and remains transaction-scoped.
   */
  readonly entries: () => Generator<OperationBaselineEntryInput, void, undefined>;
}

interface SQLiteV1BaselineTransactionGuard {
  readonly totalChanges: number;
  readonly transactionEpoch: bigint;
}

const REQUIRED_POSTCONDITIONS = Object.freeze([
  "application-id-matches",
  "user-version-is-1",
  "schema-singleton-is-manifest-bound",
  "migration-ledger-row-is-manifest-bound",
  "all-canonical-tables-are-strict",
  "logical-schema-identity-matches-fresh-v1",
  "foreign-key-check-is-empty",
  "integrity-check-is-ok",
  "alpha-row-counts-are-preserved",
  "stream-heads-match-record-tails",
  "canonical-blobs-and-hashes-are-preserved",
  "checkpoint-revisions-are-seeded",
  "lease-and-migration-fences-are-monotonic",
  "no-v0-or-placeholder-state-remains",
] as const);
const FROZEN_POSTCONDITIONS = Object.freeze({
  requiredPostconditions: REQUIRED_POSTCONDITIONS,
});
const EXPECTED_POSTCONDITIONS = canonicalSerialize(FROZEN_POSTCONDITIONS);

function fail(message: string): never {
  throw new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function safeBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > MAX_SAFE_BIGINT) {
    return fail(`SQLite v1 baseline ${label} is outside bounds`);
  }
  return value;
}

function capturedAt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite v1 baseline capture time is outside bounds",
    );
  }
  return value as number;
}

function validatedEntry(
  entryKind: OperationBaselineEntryKind,
  key: Readonly<Record<string, unknown>>,
  state: Readonly<Record<string, unknown>>,
): OperationBaselineEntryInput {
  try {
    encodeOperationBaselineKey(entryKind, key);
    encodeOperationBaselineState(entryKind, state);
  } catch {
    return fail(`SQLite v1 baseline ${entryKind} row is invalid`);
  }
  return Object.freeze({ entryKind, key: Object.freeze(key), state: Object.freeze(state) });
}

function decodedCheckpointSummary(blob: Buffer): Readonly<Record<string, unknown>> {
  if (blob.byteLength < 2 || blob.byteLength > 1_048_576) {
    return fail("SQLite v1 baseline checkpoint summary carrier is outside bounds");
  }
  let summary: CycleStoreCheckpointSummary;
  try {
    summary = cycleStoreAdapterCodec.decodeLedgerResult("save-checkpoint", blob);
  } catch {
    return fail("SQLite v1 baseline checkpoint summary carrier is invalid");
  }
  if (!blob.equals(Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", summary),
  ))) {
    return fail("SQLite v1 baseline checkpoint summary carrier is noncanonical");
  }
  return Object.freeze({ ...summary });
}

function exactlyOne(
  connection: SQLiteConnection,
  sql: string,
  length: number,
  label: string,
): readonly unknown[] {
  let result: readonly unknown[] | undefined;
  let count = 0;
  for (const raw of connection.prepare(sql, OPERATION).iterate()) {
    count += 1;
    if (count > 1) return fail(`SQLite v1 baseline ${label} cardinality is invalid`);
    result = sqliteRow(raw, length, OPERATION, label);
  }
  if (count !== 1 || result === undefined) {
    return fail(`SQLite v1 baseline ${label} cardinality is invalid`);
  }
  return result;
}

function nullableInteger(value: unknown, minimum: number, label: string): number | null {
  return value === null
    ? null
    : sqliteSafeInteger(value, minimum, Number.MAX_SAFE_INTEGER, OPERATION, label);
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : sqliteText(value, OPERATION, label);
}

function totalChanges(connection: SQLiteConnection): number {
  return sqliteSafeInteger(
    sqliteRow(
      connection.prepare("SELECT total_changes()", OPERATION).get(),
      1,
      OPERATION,
      "transaction change counter",
    )[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "transaction change counter",
  );
}

function requireCaptureTransaction(
  connection: SQLiteConnection,
  guard: SQLiteV1BaselineTransactionGuard,
): void {
  if (!connection.isTransaction) {
    return fail("SQLite v1 baseline iteration requires the captured transaction");
  }
  if (connection.transactionEpoch !== guard.transactionEpoch
      || totalChanges(connection) !== guard.totalChanges) {
    return fail("SQLite v1 baseline captured transaction changed");
  }
}

function* transactionRows(
  connection: SQLiteConnection,
  guard: SQLiteV1BaselineTransactionGuard,
  sql: string,
): Generator<unknown, void, undefined> {
  const iterator = connection.prepare(sql, OPERATION).iterate()[Symbol.iterator]();
  try {
    while (true) {
      requireCaptureTransaction(connection, guard);
      const next = iterator.next();
      if (next.done) return;
      requireCaptureTransaction(connection, guard);
      yield next.value;
    }
  } finally {
    iterator.return?.();
  }
}

function* streamV1Entries(
  connection: SQLiteConnection,
  sourceEnvelope: OperationBaselineSourceEnvelope,
  countsByKind: SQLiteV1BaselineCounts,
  guard: SQLiteV1BaselineTransactionGuard,
  expectedMigrationAppliedAtMs: number,
): Generator<OperationBaselineEntryInput, void, undefined> {
  requireCaptureTransaction(connection, guard);

  const schema = exactlyOne(connection, `
    SELECT current_version, min_reader_version, max_reader_version,
           min_writer_version, max_writer_version, schema_identity_sha256,
           latest_migration_sha256, latest_migration_applied_at_ms,
           provider_descriptor_hash, created_at_ms, updated_at_ms
      FROM ge_cycle_schema WHERE singleton = 1
  `, 11, "schema singleton");
  const schemaState = {
    createdAtMs: sqliteSafeInteger(schema[9], 0, Number.MAX_SAFE_INTEGER, OPERATION, "schema creation time"),
    currentVersion: sqliteSafeInteger(schema[0], 1, 1, OPERATION, "schema version"),
    latestMigrationAppliedAtMs: sqliteSafeInteger(schema[7], 0, Number.MAX_SAFE_INTEGER, OPERATION, "latest migration time"),
    latestMigrationSha256: sqliteText(schema[6], OPERATION, "latest migration hash"),
    maxReaderVersion: sqliteSafeInteger(schema[2], 1, 1, OPERATION, "maximum reader version"),
    maxWriterVersion: sqliteSafeInteger(schema[4], 1, 1, OPERATION, "maximum writer version"),
    minReaderVersion: sqliteSafeInteger(schema[1], 1, 1, OPERATION, "minimum reader version"),
    minWriterVersion: sqliteSafeInteger(schema[3], 1, 1, OPERATION, "minimum writer version"),
    providerDescriptorHash: sqliteText(schema[8], OPERATION, "provider descriptor hash"),
    schemaIdentitySha256: sqliteText(schema[5], OPERATION, "schema identity"),
    updatedAtMs: sqliteSafeInteger(schema[10], 0, Number.MAX_SAFE_INTEGER, OPERATION, "schema update time"),
  };
  if (schemaState.providerDescriptorHash !== sourceEnvelope.sourceDescriptorHash
      || schemaState.schemaIdentitySha256 !== sourceEnvelope.sourceSchemaIdentitySha256
      || schemaState.latestMigrationSha256 !== sourceEnvelope.sourceMigrationLineageSha256
      || schemaState.latestMigrationAppliedAtMs !== expectedMigrationAppliedAtMs) {
    return fail("SQLite v1 baseline schema envelope identity drifted");
  }
  yield validatedEntry("schema-envelope", { scope: "cycle-store" }, schemaState);

  requireCaptureTransaction(connection, guard);
  const migration = exactlyOne(connection, `
    SELECT version, previous_version, migration_id, sql_sha256,
           schema_identity_sha256, applied_at_ms, reversibility,
           postconditions_blob
      FROM ge_cycle_migrations
     ORDER BY CAST(version AS TEXT) COLLATE BINARY
  `, 8, "migration lineage");
  const postconditionsBlob = sqliteBlob(migration[7], OPERATION, "migration postconditions");
  let postconditions: unknown;
  try {
    postconditions = decodeOperationBaselineCanonicalBytes(postconditionsBlob, 1_048_576);
  } catch {
    return fail("SQLite v1 baseline migration postconditions are invalid");
  }
  if (canonicalSerialize(postconditions) !== EXPECTED_POSTCONDITIONS) {
    return fail("SQLite v1 baseline migration postconditions drifted");
  }
  const migrationState = {
    appliedAtMs: sqliteSafeInteger(migration[5], 0, Number.MAX_SAFE_INTEGER, OPERATION, "migration time"),
    migrationId: sqliteText(migration[2], OPERATION, "migration ID"),
    postconditions: FROZEN_POSTCONDITIONS,
    previousVersion: sqliteSafeInteger(migration[1], 0, 0, OPERATION, "previous migration version"),
    reversibility: sqliteText(migration[6], OPERATION, "migration reversibility"),
    schemaIdentitySha256: sqliteText(migration[4], OPERATION, "migration schema identity"),
    sqlSha256: sqliteText(migration[3], OPERATION, "migration SQL hash"),
    version: sqliteSafeInteger(migration[0], 1, 1, OPERATION, "migration version"),
  };
  if (migrationState.migrationId !== sourceEnvelope.sourceMigrationLineageId
      || migrationState.sqlSha256 !== sourceEnvelope.sourceMigrationLineageSha256
      || migrationState.schemaIdentitySha256 !== sourceEnvelope.sourceSchemaIdentitySha256
      || migrationState.appliedAtMs !== expectedMigrationAppliedAtMs
      || migrationState.appliedAtMs !== schemaState.latestMigrationAppliedAtMs) {
    return fail("SQLite v1 baseline migration lineage identity drifted");
  }
  const frozenLineage = (migrationState.migrationId === "fresh-v1-baseline"
      && migrationState.sqlSha256 === SQLITE_SCHEMA_SQL_SHA256)
    || (migrationState.migrationId === "alpha-v0-to-v1"
      && migrationState.sqlSha256 === SQLITE_ALPHA_V0_TO_V1_SQL_SHA256);
  if (!frozenLineage
      || schemaState.schemaIdentitySha256 !== SQLITE_SCHEMA_IDENTITY_SHA256
      || schemaState.providerDescriptorHash !== SQLITE_CYCLE_STORE_DESCRIPTOR_HASH) {
    return fail("SQLite v1 baseline frozen source identity drifted");
  }
  yield validatedEntry("migration-lineage", { version: migrationState.version }, migrationState);

  let streamCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, tail_sequence, tail_record_hash,
           created_at_ms, updated_at_ms
      FROM ge_cycle_streams
     ORDER BY stream_id COLLATE BINARY, tenant_id COLLATE BINARY
  `)) {
    streamCount += 1;
    const row = sqliteRow(raw, 6, OPERATION, "stream head");
    const state = {
      createdAtMs: sqliteSafeInteger(row[4], 0, Number.MAX_SAFE_INTEGER, OPERATION, "stream creation time"),
      streamId: sqliteText(row[1], OPERATION, "stream ID"),
      tailRecordHash: sqliteNullableText(row[3], OPERATION, "stream tail record hash"),
      tailSequence: sqliteSafeInteger(row[2], -1, Number.MAX_SAFE_INTEGER, OPERATION, "stream tail sequence"),
      tenantId: sqliteText(row[0], OPERATION, "stream tenant ID"),
      updatedAtMs: sqliteSafeInteger(row[5], 0, Number.MAX_SAFE_INTEGER, OPERATION, "stream update time"),
    };
    yield validatedEntry(
      "stream-head",
      { streamId: state.streamId, tenantId: state.tenantId },
      state,
    );
  }
  if (streamCount !== countsByKind["stream-head"]) {
    return fail("SQLite v1 baseline stream-head count changed during capture");
  }

  let recordCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, sequence, record_id, previous_record_hash,
           value_hash, value_bytes, value_blob, record_hash, record_blob,
           committed_at_ms
      FROM ge_cycle_records
     ORDER BY record_id COLLATE BINARY, tenant_id COLLATE BINARY
  `)) {
    recordCount += 1;
    const row = sqliteRow(raw, 11, OPERATION, "record identity");
    const tenantId = sqliteText(row[0], OPERATION, "record tenant ID");
    const streamId = sqliteText(row[1], OPERATION, "record stream ID");
    const sequence = sqliteSafeInteger(row[2], 0, Number.MAX_SAFE_INTEGER, OPERATION, "record sequence");
    const recordId = sqliteText(row[3], OPERATION, "record ID");
    const previousRecordHash = sqliteNullableText(row[4], OPERATION, "previous record hash");
    const valueHash = sqliteText(row[5], OPERATION, "record value hash");
    const valueBytes = sqliteSafeInteger(row[6], 1, 1_048_576, OPERATION, "record value bytes");
    const valueBlob = sqliteBlob(row[7], OPERATION, "record value blob");
    const recordHash = sqliteText(row[8], OPERATION, "record hash");
    const recordBlob = sqliteBlob(row[9], OPERATION, "record blob");
    const record = cycleStoreAdapterCodec.parseStoredRecord(recordBlob, OPERATION);
    if (recordBlob.byteLength < valueBytes
        || recordBlob.byteLength > 2_097_152
        || valueBlob.byteLength !== valueBytes
        || record.recordId !== recordId
        || record.sequence !== sequence
        || record.previousRecordHash !== previousRecordHash
        || record.valueHash !== valueHash
        || record.valueBytes !== valueBytes
        || record.recordHash !== recordHash
        || !recordBlob.equals(Buffer.from(canonicalSerialize(record), "utf8"))
        || !valueBlob.equals(Buffer.from(canonicalSerialize(record.value), "utf8"))
        || canonicalHash(record.value) !== valueHash) {
      return fail("SQLite v1 baseline record carrier identity drifted");
    }
    const state = {
      committedAtMs: sqliteSafeInteger(row[10], 0, Number.MAX_SAFE_INTEGER, OPERATION, "record commit time"),
      previousRecordHash,
      recordHash,
      recordId,
      sequence,
      streamId,
      tenantId,
      valueBytes,
      valueHash,
    };
    yield validatedEntry("record-identity", { recordId, tenantId }, state);
  }
  if (recordCount !== countsByKind["record-identity"]) {
    return fail("SQLite v1 baseline record-identity count changed during capture");
  }

  let checkpointCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, checkpoint_scope, checkpoint_id, stream_id,
           bound_sequence, bound_record_hash, created_at, value_hash,
           value_bytes, value_blob, checkpoint_blob, summary_blob,
           checkpoint_revision, committed_at_ms
      FROM ge_cycle_checkpoints
     ORDER BY checkpoint_id COLLATE BINARY,
              checkpoint_scope COLLATE BINARY,
              tenant_id COLLATE BINARY
  `)) {
    checkpointCount += 1;
    const row = sqliteRow(raw, 14, OPERATION, "checkpoint current");
    const tenantId = sqliteText(row[0], OPERATION, "checkpoint tenant ID");
    const checkpointScope = sqliteText(row[1], OPERATION, "checkpoint scope");
    const checkpointId = sqliteText(row[2], OPERATION, "checkpoint ID");
    const streamId = sqliteText(row[3], OPERATION, "checkpoint stream ID");
    const boundSequence = sqliteSafeInteger(row[4], 0, Number.MAX_SAFE_INTEGER, OPERATION, "checkpoint sequence");
    const boundRecordHash = sqliteText(row[5], OPERATION, "checkpoint record hash");
    const createdAt = sqliteText(row[6], OPERATION, "checkpoint creation time");
    const valueHash = sqliteText(row[7], OPERATION, "checkpoint value hash");
    const valueBytes = sqliteSafeInteger(row[8], 1, 16_777_216, OPERATION, "checkpoint value bytes");
    const valueBlob = sqliteBlob(row[9], OPERATION, "checkpoint value blob");
    const checkpointBlob = sqliteBlob(row[10], OPERATION, "checkpoint blob");
    const summaryBlob = sqliteBlob(row[11], OPERATION, "checkpoint summary blob");
    const checkpointRevision = sqliteSafeInteger(row[12], 1, Number.MAX_SAFE_INTEGER, OPERATION, "checkpoint revision");
    const committedAtMs = sqliteSafeInteger(row[13], 0, Number.MAX_SAFE_INTEGER, OPERATION, "checkpoint commit time");
    let checkpoint: CycleStoreCheckpoint;
    try {
      checkpoint = cycleStoreAdapterCodec.parseStoredCheckpoint(checkpointBlob, OPERATION);
    } catch {
      return fail("SQLite v1 baseline checkpoint carrier is invalid");
    }
    const { value: _value, ...expectedSummary } = checkpoint;
    const summary = decodedCheckpointSummary(summaryBlob);
    if (checkpointBlob.byteLength < valueBytes
        || checkpointBlob.byteLength > 17_825_792
        || valueBlob.byteLength !== valueBytes
        || checkpoint.checkpointScope !== checkpointScope
        || checkpoint.checkpointId !== checkpointId
        || checkpoint.streamId !== streamId
        || checkpoint.boundSequence !== boundSequence
        || checkpoint.boundRecordHash !== boundRecordHash
        || checkpoint.createdAt !== createdAt
        || checkpoint.valueHash !== valueHash
        || checkpoint.valueBytes !== valueBytes
        || !checkpointBlob.equals(Buffer.from(canonicalSerialize(checkpoint), "utf8"))
        || !valueBlob.equals(Buffer.from(canonicalSerialize(checkpoint.value), "utf8"))
        || canonicalHash(checkpoint.value) !== valueHash
        || canonicalSerialize(summary) !== canonicalSerialize(expectedSummary)) {
      return fail("SQLite v1 baseline checkpoint carrier identity drifted");
    }
    const state = {
      boundRecordHash,
      boundSequence,
      checkpointId,
      checkpointRevision,
      checkpointScope,
      committedAtMs,
      createdAt,
      streamId,
      summary,
      tenantId,
      valueBytes,
      valueHash,
    };
    yield validatedEntry(
      "checkpoint-current",
      { checkpointId, checkpointScope, tenantId },
      state,
    );
  }
  if (checkpointCount !== countsByKind["checkpoint-current"]) {
    return fail("SQLite v1 baseline checkpoint-current count changed during capture");
  }

  let revisionCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, checkpoint_scope, revision, checkpoint_id, action,
           summary_blob, bound_sequence, bound_record_hash,
           checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
      FROM ge_cycle_checkpoint_revisions
     ORDER BY checkpoint_scope COLLATE BINARY,
              CAST(revision AS TEXT) COLLATE BINARY,
              tenant_id COLLATE BINARY
  `)) {
    revisionCount += 1;
    const row = sqliteRow(raw, 12, OPERATION, "checkpoint revision");
    const tenantId = sqliteText(row[0], OPERATION, "revision tenant ID");
    const checkpointScope = sqliteText(row[1], OPERATION, "revision scope");
    const revision = sqliteSafeInteger(row[2], 1, Number.MAX_SAFE_INTEGER, OPERATION, "revision number");
    const checkpointId = sqliteText(row[3], OPERATION, "revision checkpoint ID");
    const action = sqliteText(row[4], OPERATION, "revision action");
    const recordedAtMs = sqliteSafeInteger(row[11], 0, Number.MAX_SAFE_INTEGER, OPERATION, "revision record time");
    let summary: Readonly<Record<string, unknown>> | null = null;
    let boundSequence: number | null = null;
    let boundRecordHash: string | null = null;
    let checkpointCreatedAt: string | null = null;
    let valueHash: string | null = null;
    let valueBytes: number | null = null;
    if (action === "put") {
      summary = decodedCheckpointSummary(sqliteBlob(row[5], OPERATION, "revision summary blob"));
      boundSequence = sqliteSafeInteger(row[6], 0, Number.MAX_SAFE_INTEGER, OPERATION, "revision sequence");
      boundRecordHash = sqliteText(row[7], OPERATION, "revision record hash");
      checkpointCreatedAt = sqliteText(row[8], OPERATION, "revision checkpoint time");
      valueHash = sqliteText(row[9], OPERATION, "revision value hash");
      valueBytes = sqliteSafeInteger(row[10], 1, 16_777_216, OPERATION, "revision value bytes");
      if (summary.checkpointScope !== checkpointScope
          || summary.checkpointId !== checkpointId
          || summary.boundSequence !== boundSequence
          || summary.boundRecordHash !== boundRecordHash
          || summary.createdAt !== checkpointCreatedAt
          || summary.valueHash !== valueHash
          || summary.valueBytes !== valueBytes) {
        return fail("SQLite v1 baseline checkpoint revision identity drifted");
      }
    } else if (action === "delete") {
      if (row.slice(5, 11).some((value) => value !== null)) {
        return fail("SQLite v1 baseline checkpoint delete revision is invalid");
      }
    } else {
      return fail("SQLite v1 baseline checkpoint revision action is invalid");
    }
    const state = {
      action,
      boundRecordHash,
      boundSequence,
      checkpointCreatedAt,
      checkpointId,
      checkpointScope,
      recordedAtMs,
      revision,
      summary,
      tenantId,
      valueBytes,
      valueHash,
    };
    yield validatedEntry(
      "checkpoint-revision",
      { checkpointScope, revision, tenantId },
      state,
    );
  }
  if (revisionCount !== countsByKind["checkpoint-revision"]) {
    return fail("SQLite v1 baseline checkpoint-revision count changed during capture");
  }

  requireCaptureTransaction(connection, guard);
  const lock = exactlyOne(connection, `
    SELECT singleton, active_lock_id, active_owner_id, active_source_version,
           active_target_version, active_lock_epoch, active_fencing_token,
           active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
           last_fencing_token, updated_at_ms
      FROM ge_cycle_migration_lock WHERE singleton = 1
  `, 12, "migration lock singleton");
  const lockState = {
    activeAcquiredAtMs: nullableInteger(lock[7], 0, "active migration acquisition time"),
    activeExpiresAtMs: nullableInteger(lock[8], 0, "active migration expiry time"),
    activeFencingToken: nullableInteger(lock[6], 1, "active migration fencing token"),
    activeLockEpoch: nullableInteger(lock[5], 1, "active migration lock epoch"),
    activeLockId: nullableText(lock[1], "active migration lock ID"),
    activeOwnerId: nullableText(lock[2], "active migration owner ID"),
    activeSourceVersion: nullableInteger(lock[3], 1, "active migration source version"),
    activeTargetVersion: nullableInteger(lock[4], 2, "active migration target version"),
    lastFencingToken: sqliteSafeInteger(lock[10], 0, Number.MAX_SAFE_INTEGER, OPERATION, "last migration fencing token"),
    lastLockEpoch: sqliteSafeInteger(lock[9], 0, Number.MAX_SAFE_INTEGER, OPERATION, "last migration lock epoch"),
    singleton: sqliteSafeInteger(lock[0], 1, 1, OPERATION, "migration lock singleton"),
    updatedAtMs: sqliteSafeInteger(lock[11], 0, Number.MAX_SAFE_INTEGER, OPERATION, "migration lock update time"),
  };
  yield validatedEntry("migration-lock-current", { singleton: 1 }, lockState);
}

const COUNT_SQL = `SELECT
  (SELECT count(*) FROM ge_cycle_schema),
  (SELECT count(*) FROM ge_cycle_migrations),
  (SELECT count(*) FROM ge_cycle_streams),
  (SELECT count(*) FROM ge_cycle_records),
  (SELECT count(*) FROM ge_cycle_checkpoints),
  (SELECT count(*) FROM ge_cycle_checkpoint_revisions),
  (SELECT count(*) FROM ge_cycle_leases),
  (SELECT count(*) FROM ge_cycle_used_lease_ids),
  (SELECT count(*) FROM ge_cycle_legal_holds),
  (SELECT count(*) FROM ge_cycle_migration_lock),
  (SELECT count(*) FROM ge_cycle_used_migration_lock_ids),
  (SELECT count(*) FROM ge_cycle_operations)`;

const MAXIMUM_OBSERVED_SQL = `SELECT max(observed_at_ms) FROM (
  SELECT created_at_ms AS observed_at_ms FROM ge_cycle_schema
  UNION ALL SELECT updated_at_ms FROM ge_cycle_schema
  UNION ALL SELECT latest_migration_applied_at_ms FROM ge_cycle_schema
  UNION ALL SELECT applied_at_ms FROM ge_cycle_migrations
  UNION ALL SELECT created_at_ms FROM ge_cycle_streams
  UNION ALL SELECT updated_at_ms FROM ge_cycle_streams
  UNION ALL SELECT committed_at_ms FROM ge_cycle_records
  UNION ALL SELECT committed_at_ms FROM ge_cycle_operations
  UNION ALL SELECT committed_at_ms FROM ge_cycle_checkpoints
  UNION ALL SELECT recorded_at_ms FROM ge_cycle_checkpoint_revisions
  UNION ALL SELECT updated_at_ms FROM ge_cycle_leases
  UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_lease_ids
  UNION ALL SELECT placed_at_ms FROM ge_cycle_legal_holds
  UNION ALL SELECT created_at_ms FROM ge_cycle_cursors
  UNION ALL SELECT consumed_at_ms FROM ge_cycle_cursors WHERE consumed_at_ms IS NOT NULL
  UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_migration_lock_ids
  UNION ALL SELECT updated_at_ms FROM ge_cycle_migration_lock
)`;

/** Capture bounded source identity/count evidence inside a caller-owned transaction. */
export function captureSQLiteV1BaselineSourceSummary(
  connection: SQLiteConnection,
  capturedAtMs: number,
): SQLiteV1BaselineSourceSummary {
  if (!connection.isTransaction) return fail("SQLite v1 baseline capture requires an active transaction");
  const captured = capturedAt(capturedAtMs);
  const applicationId = sqliteSafeInteger(
    sqliteRow(connection.prepare("PRAGMA application_id", OPERATION).get(), 1, OPERATION, "application ID")[0],
    1195724359,
    1195724359,
    OPERATION,
    "application ID",
  );
  const pragmaUserVersion = sqliteSafeInteger(
    sqliteRow(connection.prepare("PRAGMA user_version", OPERATION).get(), 1, OPERATION, "user version")[0],
    1,
    1,
    OPERATION,
    "user version",
  );
  const source = sqliteRow(connection.prepare(`
    SELECT schema_row.current_version, schema_row.schema_identity_sha256,
           schema_row.provider_descriptor_hash, migration.migration_id,
           migration.sql_sha256, schema_row.latest_migration_applied_at_ms,
           migration.applied_at_ms
      FROM ge_cycle_schema AS schema_row
      JOIN ge_cycle_migrations AS migration
        ON migration.version = schema_row.current_version
     WHERE schema_row.singleton = 1
  `, OPERATION).get(), 7, OPERATION, "v1 source identity");
  const sourceUserVersion = sqliteSafeInteger(source[0], 1, 1, OPERATION, "source version");
  if (sourceUserVersion !== pragmaUserVersion) {
    return fail("SQLite v1 baseline schema and PRAGMA versions differ");
  }
  const expectedMigrationAppliedAtMs = sqliteSafeInteger(
    source[5],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "schema latest migration time",
  );
  const capturedMigrationAppliedAtMs = sqliteSafeInteger(
    source[6],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "migration application time",
  );
  if (expectedMigrationAppliedAtMs !== capturedMigrationAppliedAtMs) {
    return fail("SQLite v1 baseline migration application times differ");
  }
  const sourceEnvelope: OperationBaselineSourceEnvelope = {
    capturedAtMs: captured,
    sourceApplicationId: applicationId as 1195724359,
    sourceDescriptorHash: sqliteText(source[2], OPERATION, "source descriptor hash"),
    sourceMigrationLineageId: sqliteText(source[3], OPERATION, "source migration ID"),
    sourceMigrationLineageSha256: sqliteText(source[4], OPERATION, "source migration hash"),
    sourceSchemaIdentitySha256: sqliteText(source[1], OPERATION, "source schema identity"),
    sourceUserVersion: sourceUserVersion as 1,
  };
  encodeOperationBaselineSourceEnvelope(sourceEnvelope);

  const rawCounts = sqliteRow(
    connection.prepare(COUNT_SQL, OPERATION).get(),
    BASELINE_ENTRY_KINDS.length,
    OPERATION,
    "baseline source counts",
  );
  const bigintCounts = rawCounts.map((value, index) => safeBigInt(value, `${BASELINE_ENTRY_KINDS[index]} count`));
  const total = bigintCounts.reduce((sum, value) => sum + value, 0n);
  if (total > MAX_SAFE_BIGINT) return fail("SQLite v1 baseline total count is outside bounds");
  const countsByKind = Object.freeze(Object.fromEntries(
    BASELINE_ENTRY_KINDS.map((kind, index) => [kind, Number(bigintCounts[index])]),
  )) as SQLiteV1BaselineCounts;

  const maximumObservedAtMs = sqliteSafeInteger(
    sqliteRow(connection.prepare(MAXIMUM_OBSERVED_SQL, OPERATION).get(), 1, OPERATION, "provider clock high-water")[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "provider clock high-water",
  );
  const lockHighWater = sqliteSafeInteger(
    sqliteRow(connection.prepare("SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1", OPERATION).get(), 1, OPERATION, "migration lock high-water")[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "migration lock high-water",
  );
  if (lockHighWater < maximumObservedAtMs) return fail("SQLite v1 provider clock high-water predates source state");
  if (captured < lockHighWater) return fail("SQLite v1 baseline capture predates provider clock high-water");
  const transactionGuard = Object.freeze({
    totalChanges: totalChanges(connection),
    transactionEpoch: connection.transactionEpoch,
  });
  requireCaptureTransaction(connection, transactionGuard);
  const frozenEnvelope = Object.freeze(sourceEnvelope);
  let entriesTaken = false;
  const entries = (): Generator<OperationBaselineEntryInput, void, undefined> => {
    const implementedKinds = new Set<OperationBaselineEntryKind>([
      "schema-envelope",
      "migration-lineage",
      "stream-head",
      "record-identity",
      "checkpoint-current",
      "checkpoint-revision",
      "migration-lock-current",
    ]);
    requireCaptureTransaction(connection, transactionGuard);
    if (countsByKind["schema-envelope"] !== 1
        || countsByKind["migration-lineage"] !== 1
        || countsByKind["migration-lock-current"] !== 1
        || BASELINE_ENTRY_KINDS.some((kind) => !implementedKinds.has(kind) && countsByKind[kind] !== 0)) {
      return fail("SQLite v1 baseline iterator cannot cover unimplemented source families");
    }
    if (entriesTaken) return fail("SQLite v1 baseline source entries are one-shot");
    entriesTaken = true;
    return streamV1Entries(
      connection,
      frozenEnvelope,
      countsByKind,
      transactionGuard,
      expectedMigrationAppliedAtMs,
    );
  };
  return Object.freeze({
    sourceEnvelope: frozenEnvelope,
    countsByKind,
    expectedEntryCount: Number(total),
    maximumObservedAtMs,
    entries,
  });
}
