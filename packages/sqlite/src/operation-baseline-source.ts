import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  cycleStoreAdapterCodec,
  type CycleStoreCheckpoint,
  type CycleStoreCheckpointSummary,
  type CycleStoreMutationOperation,
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
  SQLITE_BASELINE_COOPERATIVE_ENTRIES,
  SQLITE_BASELINE_COOPERATIVE_POISON,
  SQLITE_BASELINE_CONSUME_OWNED_WRITE,
  SQLITE_BASELINE_FINISH_COOPERATIVE_WRITES,
  SQLITE_BASELINE_ABORT_ORDERED_HANDOFF,
  SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE,
  type SQLiteBaselineCooperativeStage,
  type SQLiteBaselineOwnedWriteReceipt,
  type SQLiteBaselineOrderedHandoffSourceBinding,
  type SQLiteBaselineOrderedHandoffStage,
} from "./operation-baseline-cooperation.js";
import {
  sqliteBlob,
  sqliteNullableText,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "./sqlite-codec.js";
import {
  SQLiteConnection,
  readSQLiteConnectionOwnerSnapshot,
} from "./sqlite-connection.js";
import {
  SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
  SQLITE_SCHEMA_IDENTITY_SHA256,
  SQLITE_SCHEMA_SQL_SHA256,
} from "./migrations.js";
import { SQLITE_CYCLE_STORE_DESCRIPTOR_HASH } from "./sqlite-profile.js";

const OPERATION = "inspect-schema" as const;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export type SQLiteV1BaselineCounts = Readonly<Record<OperationBaselineEntryKind, number>>;

/**
 * The frozen, exactly three-key source clock evidence.
 *
 * `capturedAtMs` is the caller-supplied capture clock, `providerHighWaterAtMs`
 * is the migration-lock high-water, and `maximumNonCursorObservedAtMs` is the
 * maximum provider-owned observation of every source family except
 * `ge_cycle_cursors`. Capture keeps the two orderings it always enforced: the
 * high-water may not be behind non-cursor state, and the capture clock may not
 * be behind the high-water.
 *
 * Cursor creation and consumption clocks are deliberately absent. They will be
 * checked by the future Slice B cursor campaign against this same frozen
 * high-water, so a cursor-only regression will become one
 * `BLR_CURSOR_EXPIRY_CONSUMPTION` unit instead of a generic source failure.
 * This splits diagnostic ownership only: a valid
 * database still ends up with the same clock ordering as the earlier combined
 * maximum. Lease and migration-lock future expiry clocks and checkpoint RFC3339
 * creation timestamps stay outside the observation maximum as before, as does
 * cursor `expires_at_ms`, which only has to be strictly after its creation.
 */
export interface SQLiteV1BaselineClockEvidence {
  readonly capturedAtMs: number;
  readonly maximumNonCursorObservedAtMs: number;
  readonly providerHighWaterAtMs: number;
}

export interface SQLiteV1BaselineSourceSummary {
  readonly sourceEnvelope: OperationBaselineSourceEnvelope;
  readonly countsByKind: SQLiteV1BaselineCounts;
  readonly expectedEntryCount: number;
  readonly clockEvidence: SQLiteV1BaselineClockEvidence;
  /**
   * Streams all twelve v1 source families implemented by this foundation.
   * The iterator is deliberately one-shot and remains transaction-scoped.
   */
  readonly entries: () => Generator<OperationBaselineEntryInput, void, undefined>;
}

/** Private registry state for one exact summary returned by this module. */
interface SQLiteV1BaselineCapturedSourceState {
  readonly connection: SQLiteConnection;
  readonly transactionEpoch: bigint;
}

const CAPTURED_CURSOR_SOURCES = new WeakMap<object, SQLiteV1BaselineCapturedSourceState>();

interface SQLiteV1BaselineTransactionGuard {
  totalChanges: number;
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

function legacyOperation(value: unknown): CycleStoreMutationOperation {
  const operation = sqliteText(value, OPERATION, "legacy operation name");
  if (!LEGACY_OPERATIONS.has(operation as CycleStoreMutationOperation)) {
    return fail("SQLite v1 baseline legacy operation name is invalid");
  }
  return operation as CycleStoreMutationOperation;
}

function legacyResultBlobSha256(
  operation: CycleStoreMutationOperation,
  blob: Buffer,
  resultHash: string,
): string {
  if (blob.byteLength < 2 || blob.byteLength > 16_777_216) {
    return fail("SQLite v1 baseline legacy operation result carrier is outside bounds");
  }
  try {
    const decoded = cycleStoreAdapterCodec.decodeLedgerResult(operation, blob);
    const reencoded = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult(operation, decoded));
    if (!reencoded.equals(blob) || canonicalHash(decoded) !== resultHash) {
      return fail("SQLite v1 baseline legacy operation result carrier is invalid");
    }
    return createHash("sha256").update(blob).digest("hex");
  } catch {
    return fail("SQLite v1 baseline legacy operation result carrier is invalid");
  }
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
  if (!connection.isTransaction || connection.transactionMode !== "exclusive") {
    return fail("SQLite v1 baseline iteration requires the captured EXCLUSIVE transaction");
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

  let leaseCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, active_lease_id, active_holder_id,
           active_lease_epoch, active_fencing_token, active_acquired_at_ms,
           active_expires_at_ms, last_lease_epoch, last_fencing_token,
           updated_at_ms
      FROM ge_cycle_leases
     ORDER BY stream_id COLLATE BINARY, tenant_id COLLATE BINARY
  `)) {
    leaseCount += 1;
    const row = sqliteRow(raw, 11, OPERATION, "lease current");
    const tenantId = sqliteText(row[0], OPERATION, "lease tenant ID");
    const streamId = sqliteText(row[1], OPERATION, "lease stream ID");
    yield validatedEntry(
      "lease-current",
      { streamId, tenantId },
      {
        activeAcquiredAtMs: nullableInteger(row[6], 0, "lease acquisition time"),
        activeExpiresAtMs: nullableInteger(row[7], 0, "lease expiry time"),
        activeFencingToken: nullableInteger(row[5], 1, "lease fencing token"),
        activeHolderId: nullableText(row[3], "lease holder ID"),
        activeLeaseEpoch: nullableInteger(row[4], 1, "lease epoch"),
        activeLeaseId: nullableText(row[2], "lease ID"),
        lastFencingToken: sqliteSafeInteger(row[9], 0, Number.MAX_SAFE_INTEGER, OPERATION, "last lease fencing token"),
        lastLeaseEpoch: sqliteSafeInteger(row[8], 0, Number.MAX_SAFE_INTEGER, OPERATION, "last lease epoch"),
        streamId,
        tenantId,
        updatedAtMs: sqliteSafeInteger(row[10], 0, Number.MAX_SAFE_INTEGER, OPERATION, "lease update time"),
      },
    );
  }
  if (leaseCount !== countsByKind["lease-current"]) {
    return fail("SQLite v1 baseline lease-current count changed during capture");
  }

  let usedLeaseCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
           first_used_at_ms
      FROM ge_cycle_used_lease_ids
     ORDER BY lease_id COLLATE BINARY, stream_id COLLATE BINARY,
              tenant_id COLLATE BINARY
  `)) {
    usedLeaseCount += 1;
    const row = sqliteRow(raw, 6, OPERATION, "used lease identity");
    const tenantId = sqliteText(row[0], OPERATION, "used lease tenant ID");
    const streamId = sqliteText(row[1], OPERATION, "used lease stream ID");
    const leaseId = sqliteText(row[2], OPERATION, "used lease ID");
    yield validatedEntry(
      "used-lease-identity",
      { leaseId, streamId, tenantId },
      {
        fencingToken: sqliteSafeInteger(row[4], 1, Number.MAX_SAFE_INTEGER, OPERATION, "used lease fencing token"),
        firstUsedAtMs: sqliteSafeInteger(row[5], 0, Number.MAX_SAFE_INTEGER, OPERATION, "used lease first-use time"),
        leaseEpoch: sqliteSafeInteger(row[3], 1, Number.MAX_SAFE_INTEGER, OPERATION, "used lease epoch"),
        leaseId,
        streamId,
        tenantId,
      },
    );
  }
  if (usedLeaseCount !== countsByKind["used-lease-identity"]) {
    return fail("SQLite v1 baseline used-lease-identity count changed during capture");
  }

  let holdCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, hold_id, placed_at_ms
      FROM ge_cycle_legal_holds
     ORDER BY hold_id COLLATE BINARY, stream_id COLLATE BINARY,
              tenant_id COLLATE BINARY
  `)) {
    holdCount += 1;
    const row = sqliteRow(raw, 4, OPERATION, "legal hold");
    const tenantId = sqliteText(row[0], OPERATION, "hold tenant ID");
    const streamId = sqliteText(row[1], OPERATION, "hold stream ID");
    const holdId = sqliteText(row[2], OPERATION, "hold ID");
    yield validatedEntry(
      "legal-hold",
      { holdId, streamId, tenantId },
      {
        holdId,
        placedAtMs: sqliteSafeInteger(row[3], 0, Number.MAX_SAFE_INTEGER, OPERATION, "hold placement time"),
        streamId,
        tenantId,
      },
    );
  }
  if (holdCount !== countsByKind["legal-hold"]) {
    return fail("SQLite v1 baseline legal-hold count changed during capture");
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

  let usedLockCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT lock_id, lock_epoch, fencing_token, first_used_at_ms
      FROM ge_cycle_used_migration_lock_ids
     ORDER BY lock_id COLLATE BINARY
  `)) {
    usedLockCount += 1;
    const row = sqliteRow(raw, 4, OPERATION, "used migration lock identity");
    const lockId = sqliteText(row[0], OPERATION, "used migration lock ID");
    yield validatedEntry(
      "used-migration-lock-identity",
      { lockId },
      {
        fencingToken: sqliteSafeInteger(row[2], 1, Number.MAX_SAFE_INTEGER, OPERATION, "used migration lock fencing token"),
        firstUsedAtMs: sqliteSafeInteger(row[3], 0, Number.MAX_SAFE_INTEGER, OPERATION, "used migration lock first-use time"),
        lockEpoch: sqliteSafeInteger(row[1], 1, Number.MAX_SAFE_INTEGER, OPERATION, "used migration lock epoch"),
        lockId,
      },
    );
  }
  if (usedLockCount !== countsByKind["used-migration-lock-identity"]) {
    return fail("SQLite v1 baseline used-migration-lock-identity count changed during capture");
  }

  let legacyCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, operation_id, operation_name, request_hash,
           result_blob, result_hash, committed_at_ms
      FROM ge_cycle_operations
     ORDER BY operation_id COLLATE BINARY, tenant_id COLLATE BINARY
  `)) {
    legacyCount += 1;
    const row = sqliteRow(raw, 7, OPERATION, "legacy operation");
    const tenantId = sqliteText(row[0], OPERATION, "legacy operation tenant ID");
    const operationId = sqliteText(row[1], OPERATION, "legacy operation ID");
    const operationName = legacyOperation(row[2]);
    const requestHash = sqliteText(row[3], OPERATION, "legacy operation request hash");
    const resultBlob = sqliteBlob(row[4], OPERATION, "legacy operation result blob");
    const resultHash = sqliteText(row[5], OPERATION, "legacy operation result hash");
    yield validatedEntry(
      "legacy-operation",
      { operationId, tenantId },
      {
        committedAtMs: sqliteSafeInteger(
          row[6],
          0,
          Number.MAX_SAFE_INTEGER,
          OPERATION,
          "legacy operation commit time",
        ),
        operationId,
        operationName,
        requestHash,
        resultBlobSha256: legacyResultBlobSha256(operationName, resultBlob, resultHash),
        resultHash,
        tenantId,
      },
    );
  }
  if (legacyCount !== countsByKind["legacy-operation"]) {
    return fail("SQLite v1 baseline legacy-operation count changed during capture");
  }
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

/**
 * Every provider-owned observation clock except the two owned by cursors.
 *
 * `ge_cycle_cursors.created_at_ms` and its non-null `consumed_at_ms` are the
 * only branches removed from the earlier combined maximum: the future Slice B
 * cursor campaign will compare them with the same high-water and own their
 * diagnostic. Every other
 * previously covered observation is retained here unchanged.
 */
export const SQLITE_V1_BASELINE_MAXIMUM_NON_CURSOR_OBSERVED_SQL = `SELECT max(observed_at_ms) FROM (
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
  UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_migration_lock_ids
  UNION ALL SELECT updated_at_ms FROM ge_cycle_migration_lock
)`;

/** Capture bounded source identity/count evidence inside a caller-owned transaction. */
export function captureSQLiteV1BaselineSourceSummary(
  connection: SQLiteConnection,
  capturedAtMs: number,
): SQLiteV1BaselineSourceSummary {
  if (!connection.isTransaction || connection.transactionMode !== "exclusive") {
    return fail("SQLite v1 baseline capture requires an active EXCLUSIVE transaction");
  }
  const captured = capturedAt(capturedAtMs);
  const applicationId = sqliteSafeInteger(
    sqliteRow(
      connection.prepare(
        "SELECT application_id FROM pragma_application_id",
        OPERATION,
      ).get(),
      1,
      OPERATION,
      "application ID",
    )[0],
    1195724359,
    1195724359,
    OPERATION,
    "application ID",
  );
  const pragmaUserVersion = sqliteSafeInteger(
    sqliteRow(
      connection.prepare(
        "SELECT user_version FROM pragma_user_version",
        OPERATION,
      ).get(),
      1,
      OPERATION,
      "user version",
    )[0],
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

  const maximumNonCursorObservedAtMs = sqliteSafeInteger(
    sqliteRow(connection.prepare(SQLITE_V1_BASELINE_MAXIMUM_NON_CURSOR_OBSERVED_SQL, OPERATION).get(), 1, OPERATION, "non-cursor provider clock")[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "non-cursor provider clock",
  );
  const providerHighWaterAtMs = sqliteSafeInteger(
    sqliteRow(connection.prepare("SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1", OPERATION).get(), 1, OPERATION, "migration lock high-water")[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "migration lock high-water",
  );
  if (providerHighWaterAtMs < maximumNonCursorObservedAtMs) {
    return fail("SQLite v1 provider clock high-water predates non-cursor source state");
  }
  if (captured < providerHighWaterAtMs) {
    return fail("SQLite v1 baseline capture predates provider clock high-water");
  }
  const clockEvidence: SQLiteV1BaselineClockEvidence = Object.freeze({
    capturedAtMs: captured,
    maximumNonCursorObservedAtMs,
    providerHighWaterAtMs,
  });
  const transactionGuard: SQLiteV1BaselineTransactionGuard = Object.freeze({
    totalChanges: totalChanges(connection),
    transactionEpoch: connection.transactionEpoch,
  });
  requireCaptureTransaction(connection, transactionGuard);
  const frozenEnvelope = Object.freeze(sourceEnvelope);
  let entriesTaken = false;
  let cooperativeHandoffStage: object | undefined;
  let cooperativeHandoffTotalChanges: number | undefined;
  let cooperativeStreamCompleted = false;
  const takeEntries = (guard: SQLiteV1BaselineTransactionGuard): Generator<
    OperationBaselineEntryInput,
    void,
    undefined
  > => {
    const implementedKinds = new Set<OperationBaselineEntryKind>([
      "schema-envelope",
      "migration-lineage",
      "stream-head",
      "record-identity",
      "checkpoint-current",
      "checkpoint-revision",
      "lease-current",
      "used-lease-identity",
      "legal-hold",
      "migration-lock-current",
      "used-migration-lock-identity",
      "legacy-operation",
    ]);
    requireCaptureTransaction(connection, guard);
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
      guard,
      expectedMigrationAppliedAtMs,
    );
  };
  const entries = (): Generator<OperationBaselineEntryInput, void, undefined> =>
    takeEntries(transactionGuard);
  const cooperativeEntries = (
    requestedConnection: SQLiteConnection,
    stage: SQLiteBaselineCooperativeStage,
  ): Generator<
    OperationBaselineEntryInput,
    void,
    SQLiteBaselineOwnedWriteReceipt | undefined
  > => {
    const cooperativeGuard: SQLiteV1BaselineTransactionGuard = {
      totalChanges: transactionGuard.totalChanges,
      transactionEpoch: transactionGuard.transactionEpoch,
    };
    return (function* cooperativeSourceGenerator() {
      let completed = false;
      let pending = false;
      let primaryFailure: unknown;
      let sequence = 0;
      let upstream: Generator<OperationBaselineEntryInput, void, undefined> | undefined;
      try {
        if (requestedConnection !== connection) {
          fail("SQLite v1 baseline cooperative source connection is invalid");
        }
        upstream = takeEntries(cooperativeGuard);
        let next = upstream.next();
        while (!next.done) {
          const entry = next.value;
          pending = true;
          const receipt: SQLiteBaselineOwnedWriteReceipt | undefined = yield entry;
          if (!connection.isTransaction
              || connection.transactionMode !== "exclusive"
              || connection.transactionEpoch !== cooperativeGuard.transactionEpoch) {
            stage[SQLITE_BASELINE_COOPERATIVE_POISON](
              "SQLite baseline cooperative source transaction changed",
            );
          }
          // This is intentionally the last operation before stage consumption.
          const currentTotalChanges = totalChanges(connection);
          const acceptedTotalChanges = stage[SQLITE_BASELINE_CONSUME_OWNED_WRITE](
            connection,
            entry,
            receipt,
            sequence,
            cooperativeGuard.totalChanges,
            currentTotalChanges,
            cooperativeGuard.transactionEpoch,
          );
          // Independently fence DML injected during receipt validation.
          if (totalChanges(connection) !== acceptedTotalChanges) {
            stage[SQLITE_BASELINE_COOPERATIVE_POISON](
              "SQLite baseline cooperative receipt validation observed an unexplained write",
            );
          }
          cooperativeGuard.totalChanges = acceptedTotalChanges;
          requireCaptureTransaction(connection, cooperativeGuard);
          pending = false;
          sequence += 1;
          next = upstream.next();
        }
        if (sequence !== Number(total)) {
          stage[SQLITE_BASELINE_COOPERATIVE_POISON](
            "SQLite baseline cooperative source count is invalid",
          );
        }
        stage[SQLITE_BASELINE_FINISH_COOPERATIVE_WRITES](
          connection,
          sequence,
          cooperativeGuard.totalChanges,
          totalChanges(connection),
          cooperativeGuard.transactionEpoch,
        );
        cooperativeHandoffStage = stage;
        cooperativeHandoffTotalChanges = cooperativeGuard.totalChanges;
        cooperativeStreamCompleted = true;
        completed = true;
      } catch (error) {
        primaryFailure = error;
        try {
          stage[SQLITE_BASELINE_COOPERATIVE_POISON](
            "SQLite baseline cooperative source stream failed",
          );
        } catch {
          // Preserve the exact source, receipt, or writer failure.
        }
      } finally {
        try {
          upstream?.return?.();
        } catch (error) {
          primaryFailure ??= error;
        }
        if (!completed && pending) {
          try {
            stage[SQLITE_BASELINE_COOPERATIVE_POISON](
              "SQLite baseline cooperative source receipt was skipped",
            );
          } catch (error) {
            primaryFailure ??= error;
          }
        }
        if (primaryFailure !== undefined) throw primaryFailure;
      }
    })();
  };
  const orderedHandoffSource = (
    requestedConnection: SQLiteConnection,
    stage: SQLiteBaselineOrderedHandoffStage,
  ): SQLiteBaselineOrderedHandoffSourceBinding => {
    if (requestedConnection !== connection
        || !cooperativeStreamCompleted
        || cooperativeHandoffStage !== stage
        || cooperativeHandoffTotalChanges === undefined
        || !connection.isTransaction
        || connection.transactionMode !== "exclusive"
        || connection.transactionEpoch !== transactionGuard.transactionEpoch
        || totalChanges(connection) !== cooperativeHandoffTotalChanges) {
      return stage[SQLITE_BASELINE_ABORT_ORDERED_HANDOFF](
        undefined,
        "SQLite baseline ordered handoff source binding is invalid",
      );
    }
    return Object.freeze({
      countsByKind,
      expectedEntryCount: Number(total),
      sourceEnvelope: frozenEnvelope,
      totalChanges: cooperativeHandoffTotalChanges,
      transactionEpoch: transactionGuard.transactionEpoch,
    });
  };
  const summary = Object.freeze({
    sourceEnvelope: frozenEnvelope,
    countsByKind,
    expectedEntryCount: Number(total),
    clockEvidence,
    entries,
    [SQLITE_BASELINE_COOPERATIVE_ENTRIES]: cooperativeEntries,
    [SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE]: orderedHandoffSource,
  });
  CAPTURED_CURSOR_SOURCES.set(summary, Object.freeze({
    connection,
    transactionEpoch: transactionGuard.transactionEpoch,
  }));
  return summary;
}

/**
 * Fence a genuinely captured source against its exact live connection.
 *
 * This performs no SQL and deliberately does not compare the capture-time
 * `total_changes()`: once accepted, the existing TEMP stage owns all allowed
 * write-counter movement. Every invocation does synchronously re-prove the
 * active EXCLUSIVE mode and the original pre-TEMP transaction epoch.
 */
export function assertSQLiteV1BaselineCursorSourceProvenance(
  sourceSummary: SQLiteV1BaselineSourceSummary,
  connection: SQLiteConnection,
): void {
  const state = sourceSummary !== null && typeof sourceSummary === "object"
    ? CAPTURED_CURSOR_SOURCES.get(sourceSummary as object)
    : undefined;
  if (state === undefined
      || state.connection !== connection) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite v1 baseline captured source provenance is invalid",
    );
  }
  const first = readSQLiteConnectionOwnerSnapshot(connection);
  if (!first.isTransaction
      || first.transactionMode !== "exclusive"
      || first.transactionEpoch !== state.transactionEpoch) {
    return fail("SQLite v1 baseline captured transaction changed");
  }
  const final = readSQLiteConnectionOwnerSnapshot(connection);
  if (!final.isTransaction
      || final.transactionMode !== "exclusive"
      || final.transactionEpoch !== state.transactionEpoch
      || final.transactionEpoch !== first.transactionEpoch) {
    return fail("SQLite v1 baseline captured transaction changed");
  }
}
