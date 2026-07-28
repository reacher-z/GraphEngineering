import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { TextDecoder } from "node:util";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import {
  CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
  CycleStoreProviderError,
  cycleStoreAdapterCodec,
  type CycleStoreAppendResult,
  type CycleStoreCheckpointSummary,
  type CycleStoreLease,
  type CycleStoreMigrationLock,
  type CycleStoreMutationOperation,
  type CycleStoreProviderOperation,
  type CycleStoreRecord,
} from "@graph-engineering/runtime";

import {
  SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
  SQLITE_CYCLE_STORE_APPLICATION_ID,
  SQLITE_CYCLE_STORE_SCHEMA_VERSION,
  SQLITE_SCHEMA_CATALOG_SHA256,
  SQLITE_SCHEMA_IDENTITY_SHA256,
  SQLITE_SCHEMA_SQL_SHA256,
} from "./migrations.js";
import {
  hardenSQLiteStatement,
  sqliteBlob,
  sqliteNullableText,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "./sqlite-codec.js";
import { translateSQLiteError } from "./sqlite-errors.js";
import { SQLITE_CYCLE_STORE_DESCRIPTOR_HASH } from "./sqlite-profile.js";

const OPERATION: CycleStoreProviderOperation = "inspect-schema";
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const SEMANTIC_DIGEST_DOMAIN = "graph-engineering/sqlite-semantic-audit/v1\0";
const MUTATION_OPERATIONS = new Set<CycleStoreMutationOperation>([
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
const REQUIRED_MIGRATION_POSTCONDITIONS = Object.freeze([
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

export type SQLiteIntegrityLevel = "quick" | "structural" | "semantic";

export interface SQLiteSemanticCounters {
  readonly streams: number;
  readonly records: number;
  readonly operations: number;
  readonly checkpoints: number;
  readonly checkpointRevisions: number;
  readonly leases: number;
  readonly usedLeaseIds: number;
  readonly legalHolds: number;
  readonly cursors: number;
  readonly openCursors: number;
  readonly usedMigrationLockIds: number;
}

export interface SQLiteCycleStoreIntegrityReport {
  readonly level: SQLiteIntegrityLevel;
  readonly quickCheck: "ok";
  readonly integrityCheck: "ok" | "not-run";
  readonly foreignKeyViolations: 0;
  readonly applicationId: typeof SQLITE_CYCLE_STORE_APPLICATION_ID;
  readonly schemaVersion: typeof SQLITE_CYCLE_STORE_SCHEMA_VERSION;
  readonly schemaIdentitySha256: typeof SQLITE_SCHEMA_IDENTITY_SHA256;
  readonly descriptorHash: typeof SQLITE_CYCLE_STORE_DESCRIPTOR_HASH;
  readonly lineageId: "fresh-v1-baseline" | "alpha-v0-to-v1";
  readonly lineageSha256: string;
  readonly catalogSha256: typeof SQLITE_SCHEMA_CATALOG_SHA256;
  readonly counters: SQLiteSemanticCounters;
  readonly semanticSha256: string | null;
  readonly sqliteVersion: string;
}

interface RecordHead {
  readonly sequence: number;
  readonly recordHash: string;
  readonly count: number;
}

function fail(check: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_CORRUPTION",
    OPERATION,
    "SQLite CycleStore integrity audit failed",
    { check },
  );
}

function checkedPath(value: unknown): string {
  if (typeof value !== "string"
      || value.length === 0
      || value.includes("\0")
      || value === ":memory:"
      || value.startsWith("file::memory:")) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite audit path is invalid",
    );
  }
  return value;
}

function statement(database: DatabaseSync, sql: string) {
  return hardenSQLiteStatement(database.prepare(sql));
}

function rows(database: DatabaseSync, sql: string): readonly unknown[] {
  return statement(database, sql).all();
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  return sqliteSafeInteger(value, minimum, maximum, OPERATION, label);
}

function nullableInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number | null {
  return value === null ? null : integer(value, minimum, maximum, label);
}

function scalarInteger(
  database: DatabaseSync,
  sql: string,
  minimum: number,
  maximum: number,
  label: string,
): number {
  return integer(
    sqliteRow(statement(database, sql).get(), 1, OPERATION, label)[0],
    minimum,
    maximum,
    label,
  );
}

function scalarText(database: DatabaseSync, sql: string, label: string): string {
  return sqliteText(
    sqliteRow(statement(database, sql).get(), 1, OPERATION, label)[0],
    OPERATION,
    label,
  );
}

function checkPragma(database: DatabaseSync, pragma: "quick_check" | "integrity_check"): void {
  const result = rows(database, `PRAGMA ${pragma}`);
  if (result.length !== 1
      || sqliteText(
        sqliteRow(result[0], 1, OPERATION, pragma)[0],
        OPERATION,
        pragma,
      ) !== "ok") {
    fail(pragma);
  }
}

function canonicalBlob(value: unknown, label: string): unknown {
  const blob = sqliteBlob(value, OPERATION, label);
  if (blob.byteLength < 2 || (blob[0] === 0xef && blob[1] === 0xbb && blob[2] === 0xbf)) {
    return fail(label);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(blob);
    const decoded = JSON.parse(text) as unknown;
    if (canonicalSerialize(decoded) !== text) return fail(label);
    return decoded;
  } catch (error) {
    if (error instanceof CycleStoreProviderError) throw error;
    return fail(label);
  }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function catalogHash(database: DatabaseSync): string {
  const catalog = rows(database, `
    SELECT type, name, tbl_name, sql
      FROM sqlite_schema
     WHERE name GLOB 'ge_cycle_*'
       AND type IN ('table', 'index')
       AND sql IS NOT NULL
     ORDER BY type, name
  `).map((value, index) => {
    const row = sqliteRow(value, 4, OPERATION, `schema catalog row ${index}`);
    return {
      type: sqliteText(row[0], OPERATION, "schema catalog type"),
      name: sqliteText(row[1], OPERATION, "schema catalog name"),
      tableName: sqliteText(row[2], OPERATION, "schema catalog table"),
      sql: sqliteText(row[3], OPERATION, "schema catalog SQL").replace(/\s+/gu, " ").trim(),
    };
  });
  return createHash("sha256").update(canonicalSerialize(catalog), "utf8").digest("hex");
}

function inspectIdentity(database: DatabaseSync): {
  lineageId: "fresh-v1-baseline" | "alpha-v0-to-v1";
  lineageSha256: string;
} {
  const applicationId = scalarInteger(
    database,
    "PRAGMA application_id",
    0,
    2_147_483_647,
    "application id",
  );
  const userVersion = scalarInteger(
    database,
    "PRAGMA user_version",
    0,
    2_147_483_647,
    "user version",
  );
  if (applicationId !== SQLITE_CYCLE_STORE_APPLICATION_ID
      || userVersion !== SQLITE_CYCLE_STORE_SCHEMA_VERSION
      || catalogHash(database) !== SQLITE_SCHEMA_CATALOG_SHA256) {
    return fail("schema identity");
  }
  const schema = sqliteRow(statement(database, `
    SELECT current_version, min_reader_version, max_reader_version,
           min_writer_version, max_writer_version, schema_identity_sha256,
           latest_migration_sha256, latest_migration_applied_at_ms,
           provider_descriptor_hash, created_at_ms, updated_at_ms
      FROM ge_cycle_schema WHERE singleton = 1
  `).get(), 11, OPERATION, "schema singleton");
  for (let index = 0; index < 5; index += 1) {
    if (integer(schema[index], 1, 1, "schema compatibility") !== 1) {
      return fail("schema compatibility");
    }
  }
  const schemaIdentity = sqliteText(schema[5], OPERATION, "schema identity");
  const latestMigration = sqliteText(schema[6], OPERATION, "latest migration hash");
  const appliedAt = integer(schema[7], 0, MAX_SAFE_INTEGER, "migration application time");
  const descriptorHash = sqliteText(schema[8], OPERATION, "provider descriptor hash");
  const createdAt = integer(schema[9], 0, MAX_SAFE_INTEGER, "schema creation time");
  const updatedAt = integer(schema[10], createdAt, MAX_SAFE_INTEGER, "schema update time");
  if (schemaIdentity !== SQLITE_SCHEMA_IDENTITY_SHA256
      || descriptorHash !== SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
      || appliedAt !== updatedAt) {
    return fail("schema singleton binding");
  }
  if (scalarInteger(database, "SELECT count(*) FROM ge_cycle_migrations", 0, 2, "lineage rows") !== 1) {
    return fail("migration lineage cardinality");
  }
  const migration = sqliteRow(statement(database, `
    SELECT version, previous_version, migration_id, sql_sha256,
           schema_identity_sha256, applied_at_ms, reversibility, postconditions_blob
      FROM ge_cycle_migrations
  `).get(), 8, OPERATION, "migration lineage");
  integer(migration[0], 1, 1, "migration version");
  integer(migration[1], 0, 0, "migration previous version");
  const lineageId = sqliteText(migration[2], OPERATION, "migration id");
  const lineageSha256 = sqliteText(migration[3], OPERATION, "migration hash");
  const migrationIdentity = sqliteText(migration[4], OPERATION, "migration identity");
  const migrationAppliedAt = integer(migration[5], 0, MAX_SAFE_INTEGER, "migration time");
  const reversibility = sqliteText(migration[6], OPERATION, "migration reversibility");
  const postconditions = canonicalBlob(migration[7], "migration postconditions");
  const fresh = lineageId === "fresh-v1-baseline" && lineageSha256 === SQLITE_SCHEMA_SQL_SHA256;
  const migrated = lineageId === "alpha-v0-to-v1"
    && lineageSha256 === SQLITE_ALPHA_V0_TO_V1_SQL_SHA256;
  if ((!fresh && !migrated)
      || latestMigration !== lineageSha256
      || migrationIdentity !== SQLITE_SCHEMA_IDENTITY_SHA256
      || migrationAppliedAt !== appliedAt
      || reversibility !== "rebuild-from-verified-backup-only"
      || !same(postconditions, {
        requiredPostconditions: REQUIRED_MIGRATION_POSTCONDITIONS,
      })) {
    return fail("migration lineage binding");
  }
  return {
    lineageId: fresh ? "fresh-v1-baseline" : "alpha-v0-to-v1",
    lineageSha256,
  };
}

function updateDigest(digest: ReturnType<typeof createHash>, label: string, value: unknown): void {
  digest.update(label, "utf8");
  digest.update("\0", "utf8");
  digest.update(canonicalSerialize(value), "utf8");
  digest.update("\0", "utf8");
}

function inspectRecords(
  database: DatabaseSync,
  digest: ReturnType<typeof createHash>,
): Map<string, RecordHead> {
  const heads = new Map<string, RecordHead>();
  const recordRows = rows(database, `
    SELECT tenant_id, stream_id, sequence, record_id, previous_record_hash,
           value_hash, value_bytes, value_blob, record_hash, record_blob
      FROM ge_cycle_records
     ORDER BY tenant_id, stream_id, sequence
  `);
  for (const [index, raw] of recordRows.entries()) {
    const row = sqliteRow(raw, 10, OPERATION, `record row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "record tenant");
    const streamId = sqliteText(row[1], OPERATION, "record stream");
    const sequence = integer(row[2], 0, MAX_SAFE_INTEGER, "record sequence");
    const recordId = sqliteText(row[3], OPERATION, "record id");
    const previousHash = sqliteNullableText(row[4], OPERATION, "previous record hash");
    const valueHash = sqliteText(row[5], OPERATION, "record value hash");
    const valueBytes = integer(row[6], 1, 1_048_576, "record value bytes");
    const valueBlob = sqliteBlob(row[7], OPERATION, "record value blob");
    const recordHash = sqliteText(row[8], OPERATION, "record hash");
    const recordBlob = sqliteBlob(row[9], OPERATION, "record blob");
    const record = cycleStoreAdapterCodec.parseStoredRecord(recordBlob, OPERATION);
    const key = canonicalSerialize([tenantId, streamId]);
    const previous = heads.get(key);
    if (sequence !== (previous?.sequence ?? -1) + 1
        || previousHash !== (previous?.recordHash ?? null)
        || record.recordId !== recordId
        || record.sequence !== sequence
        || record.previousRecordHash !== previousHash
        || record.valueHash !== valueHash
        || record.valueBytes !== valueBytes
        || record.recordHash !== recordHash
        || valueBlob.byteLength !== valueBytes
        || !valueBlob.equals(Buffer.from(canonicalSerialize(record.value), "utf8"))
        || canonicalHash(record.value) !== valueHash) {
      return fail("record canonical chain");
    }
    heads.set(key, { sequence, recordHash, count: (previous?.count ?? 0) + 1 });
    updateDigest(digest, "record", { tenantId, streamId, record });
  }

  const streamRows = rows(database, `
    SELECT tenant_id, stream_id, tail_sequence, tail_record_hash
      FROM ge_cycle_streams ORDER BY tenant_id, stream_id
  `);
  for (const [index, raw] of streamRows.entries()) {
    const row = sqliteRow(raw, 4, OPERATION, `stream row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "stream tenant");
    const streamId = sqliteText(row[1], OPERATION, "stream id");
    const sequence = integer(row[2], -1, MAX_SAFE_INTEGER, "stream tail sequence");
    const recordHash = sqliteNullableText(row[3], OPERATION, "stream tail hash");
    const head = heads.get(canonicalSerialize([tenantId, streamId]));
    if (head === undefined
      ? (sequence !== -1 || recordHash !== null)
      : (sequence !== head.sequence || recordHash !== head.recordHash)) {
      return fail("stream head binding");
    }
    updateDigest(digest, "stream", { tenantId, streamId, sequence, recordHash });
  }
  if (streamRows.length !== heads.size) return fail("stream record cardinality");
  return heads;
}

function mutationOperation(value: unknown): CycleStoreMutationOperation {
  const operation = sqliteText(value, OPERATION, "ledger operation");
  if (!MUTATION_OPERATIONS.has(operation as CycleStoreMutationOperation)) {
    return fail("ledger operation");
  }
  return operation as CycleStoreMutationOperation;
}

function inspectOperations(database: DatabaseSync, digest: ReturnType<typeof createHash>): void {
  const operationRows = rows(database, `
    SELECT tenant_id, operation_id, operation_name, request_hash, result_blob, result_hash
      FROM ge_cycle_operations ORDER BY tenant_id, operation_id
  `);
  for (const [index, raw] of operationRows.entries()) {
    const row = sqliteRow(raw, 6, OPERATION, `operation row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "operation tenant");
    const operationId = sqliteText(row[1], OPERATION, "operation id");
    const operation = mutationOperation(row[2]);
    const requestHash = sqliteText(row[3], OPERATION, "operation request hash");
    const resultBlob = sqliteBlob(row[4], OPERATION, "operation result blob");
    const resultHash = sqliteText(row[5], OPERATION, "operation result hash");
    const result = cycleStoreAdapterCodec.decodeLedgerResult(operation, resultBlob);
    const encoded = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult(operation, result));
    if (!encoded.equals(resultBlob) || canonicalHash(result) !== resultHash) {
      return fail("operation ledger result");
    }
    if (operation === "append") {
      const append = result as CycleStoreAppendResult;
      if (!append.tail.exists || append.tail.recordHash === null
          || append.appendedRecords < 1
          || append.appendedRecords > append.tail.sequence + 1) {
        return fail("append ledger result binding");
      }
      const located = statement(database, `
        SELECT stream_id FROM ge_cycle_records
         WHERE tenant_id = ? AND sequence = ? AND record_hash = ?
      `).get(tenantId, append.tail.sequence, append.tail.recordHash);
      if (located === undefined) return fail("append ledger tail binding");
      const locatedRow = sqliteRow(located, 1, OPERATION, "append ledger tail");
      const streamId = sqliteText(locatedRow[0], OPERATION, "append ledger stream");
      const firstSequence = append.tail.sequence - append.appendedRecords + 1;
      const retainedCountRow = sqliteRow(statement(database, `
        SELECT count(*) FROM ge_cycle_records
         WHERE tenant_id = ? AND stream_id = ? AND sequence BETWEEN ? AND ?
      `).get(tenantId, streamId, firstSequence, append.tail.sequence),
      1, OPERATION, "append ledger retained record count");
      const retainedCount = sqliteSafeInteger(
        retainedCountRow[0],
        0,
        MAX_SAFE_INTEGER,
        OPERATION,
        "append ledger retained record count",
      );
      if (retainedCount !== append.appendedRecords) {
        return fail("append ledger record binding");
      }
    } else if (operation === "save-checkpoint") {
      const summary = result as CycleStoreCheckpointSummary;
      const retainedRevision = statement(database, `
        SELECT 1 FROM ge_cycle_checkpoint_revisions
         WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
           AND action = 'put' AND summary_blob = ?
         LIMIT 1
      `).get(
        tenantId,
        summary.checkpointScope,
        summary.checkpointId,
        resultBlob,
      );
      if (retainedRevision === undefined) return fail("checkpoint ledger revision binding");
    } else if (operation === "acquire-lease" || operation === "renew-lease") {
      const lease = result as CycleStoreLease;
      const acquiredAtMs = Date.parse(lease.acquiredAt);
      if (!Number.isSafeInteger(acquiredAtMs) || acquiredAtMs < 0) {
        return fail("lease ledger time binding");
      }
      const retainedIdentity = statement(database, `
        SELECT 1 FROM ge_cycle_used_lease_ids
         WHERE tenant_id = ? AND lease_id = ? AND lease_epoch = ?
           AND fencing_token = ? AND first_used_at_ms = ?
         LIMIT 1
      `).get(
        tenantId,
        lease.leaseId,
        lease.leaseEpoch,
        lease.fencingToken,
        acquiredAtMs,
      );
      if (retainedIdentity === undefined) return fail("lease ledger identity binding");
    } else if (operation === "acquire-migration-lock") {
      const lock = result as CycleStoreMigrationLock;
      const acquiredAtMs = Date.parse(lock.acquiredAt);
      if (!Number.isSafeInteger(acquiredAtMs) || acquiredAtMs < 0) {
        return fail("migration ledger time binding");
      }
      const retainedIdentity = statement(database, `
        SELECT 1 FROM ge_cycle_used_migration_lock_ids
         WHERE lock_id = ? AND lock_epoch = ? AND fencing_token = ?
           AND first_used_at_ms = ?
      `).get(lock.lockId, lock.lockEpoch, lock.fencingToken, acquiredAtMs);
      if (retainedIdentity === undefined) return fail("migration ledger identity binding");
    }
    updateDigest(digest, "operation", {
      tenantId,
      operationId,
      operation,
      requestHash,
      resultHash,
    });
  }
}

function checkpointSummary(checkpoint: Record<string, unknown>): CycleStoreCheckpointSummary {
  const { value: _value, ...summary } = checkpoint;
  return summary as unknown as CycleStoreCheckpointSummary;
}

function inspectCheckpoints(database: DatabaseSync, digest: ReturnType<typeof createHash>): void {
  const checkpointRows = rows(database, `
    SELECT tenant_id, checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
           bound_record_hash, created_at, value_hash, value_bytes, value_blob,
           checkpoint_blob, summary_blob, checkpoint_revision, committed_at_ms
      FROM ge_cycle_checkpoints
     ORDER BY tenant_id, checkpoint_scope, checkpoint_id
  `);
  for (const [index, raw] of checkpointRows.entries()) {
    const row = sqliteRow(raw, 14, OPERATION, `checkpoint row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "checkpoint tenant");
    const scope = sqliteText(row[1], OPERATION, "checkpoint scope");
    const checkpointId = sqliteText(row[2], OPERATION, "checkpoint id");
    const streamId = sqliteText(row[3], OPERATION, "checkpoint stream");
    const boundSequence = integer(row[4], 0, MAX_SAFE_INTEGER, "checkpoint sequence");
    const boundRecordHash = sqliteText(row[5], OPERATION, "checkpoint record hash");
    const createdAt = sqliteText(row[6], OPERATION, "checkpoint created time");
    const valueHash = sqliteText(row[7], OPERATION, "checkpoint value hash");
    const valueBytes = integer(row[8], 1, 16_777_216, "checkpoint value bytes");
    const valueBlob = sqliteBlob(row[9], OPERATION, "checkpoint value blob");
    const checkpointBlob = sqliteBlob(row[10], OPERATION, "checkpoint blob");
    const summaryBlob = sqliteBlob(row[11], OPERATION, "checkpoint summary blob");
    const checkpointRevision = integer(row[12], 1, MAX_SAFE_INTEGER, "checkpoint revision");
    const committedAtMs = integer(row[13], 0, MAX_SAFE_INTEGER, "checkpoint commit time");
    const checkpoint = cycleStoreAdapterCodec.parseStoredCheckpoint(checkpointBlob, OPERATION);
    const summary = checkpointSummary(checkpoint as unknown as Record<string, unknown>);
    if (checkpoint.checkpointScope !== scope
        || checkpoint.checkpointId !== checkpointId
        || checkpoint.streamId !== streamId
        || checkpoint.boundSequence !== boundSequence
        || checkpoint.boundRecordHash !== boundRecordHash
        || checkpoint.createdAt !== createdAt
        || checkpoint.valueHash !== valueHash
        || checkpoint.valueBytes !== valueBytes
        || valueBlob.byteLength !== valueBytes
        || !valueBlob.equals(Buffer.from(canonicalSerialize(checkpoint.value), "utf8"))
        || canonicalHash(checkpoint.value) !== valueHash
        || !summaryBlob.equals(Buffer.from(
          cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", summary),
        ))) {
      return fail("checkpoint canonical binding");
    }
    const retainedRevision = statement(database, `
      SELECT revision, action, summary_blob, bound_sequence, bound_record_hash,
             checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
        FROM ge_cycle_checkpoint_revisions
       WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
       ORDER BY revision DESC LIMIT 1
    `).get(tenantId, scope, checkpointId);
    if (retainedRevision === undefined) return fail("checkpoint revision binding");
    const revisionRow = sqliteRow(
      retainedRevision,
      9,
      OPERATION,
      "current checkpoint revision",
    );
    if (integer(revisionRow[0], 1, MAX_SAFE_INTEGER, "current checkpoint revision")
          !== checkpointRevision
        || sqliteText(revisionRow[1], OPERATION, "current checkpoint revision action") !== "put"
        || !sqliteBlob(revisionRow[2], OPERATION, "current checkpoint revision summary")
          .equals(summaryBlob)
        || integer(revisionRow[3], 0, MAX_SAFE_INTEGER, "current checkpoint sequence")
          !== checkpoint.boundSequence
        || sqliteText(revisionRow[4], OPERATION, "current checkpoint record hash")
          !== checkpoint.boundRecordHash
        || sqliteText(revisionRow[5], OPERATION, "current checkpoint creation time")
          !== checkpoint.createdAt
        || sqliteText(revisionRow[6], OPERATION, "current checkpoint value hash")
          !== checkpoint.valueHash
        || integer(revisionRow[7], 1, 16_777_216, "current checkpoint value bytes")
          !== checkpoint.valueBytes
        || integer(revisionRow[8], 0, MAX_SAFE_INTEGER, "current checkpoint recorded time")
          !== committedAtMs) {
      return fail("checkpoint revision binding");
    }
    updateDigest(digest, "checkpoint", {
      tenantId,
      checkpoint,
      checkpointRevision,
      committedAtMs,
    });
  }

  const revisionRows = rows(database, `
    SELECT tenant_id, checkpoint_scope, revision, checkpoint_id, action,
           summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at,
           value_hash, value_bytes
      FROM ge_cycle_checkpoint_revisions
     ORDER BY tenant_id, checkpoint_scope, revision
  `);
  let priorKey: string | null = null;
  let priorRevision = 0;
  for (const [index, raw] of revisionRows.entries()) {
    const row = sqliteRow(raw, 11, OPERATION, `checkpoint revision row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "revision tenant");
    const scope = sqliteText(row[1], OPERATION, "revision scope");
    const revision = integer(row[2], 1, MAX_SAFE_INTEGER, "checkpoint revision");
    const checkpointId = sqliteText(row[3], OPERATION, "revision checkpoint id");
    const action = sqliteText(row[4], OPERATION, "revision action");
    const key = canonicalSerialize([tenantId, scope]);
    const expectedRevision = key === priorKey ? priorRevision + 1 : 1;
    if (revision !== expectedRevision) return fail("checkpoint revision sequence");
    priorKey = key;
    priorRevision = revision;
    if (action === "put") {
      const summaryBlob = sqliteBlob(row[5], OPERATION, "revision summary");
      const summary = cycleStoreAdapterCodec.decodeLedgerResult("save-checkpoint", summaryBlob);
      const boundSequence = integer(row[6], 0, MAX_SAFE_INTEGER, "revision sequence");
      const boundHash = sqliteText(row[7], OPERATION, "revision record hash");
      const createdAt = sqliteText(row[8], OPERATION, "revision created time");
      const valueHash = sqliteText(row[9], OPERATION, "revision value hash");
      const valueBytes = integer(row[10], 1, 16_777_216, "revision value bytes");
      if (summary.checkpointScope !== scope
          || summary.checkpointId !== checkpointId
          || summary.boundSequence !== boundSequence
          || summary.boundRecordHash !== boundHash
          || summary.createdAt !== createdAt
          || summary.valueHash !== valueHash
          || summary.valueBytes !== valueBytes) {
        return fail("checkpoint revision binding");
      }
      updateDigest(digest, "checkpoint-revision", { tenantId, revision, action, summary });
    } else if (action === "delete") {
      if (row.slice(5).some((value) => value !== null)) return fail("checkpoint deletion revision");
      updateDigest(digest, "checkpoint-revision", {
        tenantId,
        scope,
        revision,
        checkpointId,
        action,
      });
    } else {
      return fail("checkpoint revision action");
    }
  }
}

function inspectFences(database: DatabaseSync, digest: ReturnType<typeof createHash>): void {
  const badLeases = scalarInteger(database, `
    SELECT count(*) FROM ge_cycle_leases
     WHERE last_lease_epoch <> last_fencing_token
        OR (active_lease_id IS NULL) <> (active_holder_id IS NULL)
        OR (active_lease_id IS NULL) <> (active_lease_epoch IS NULL)
        OR (active_lease_id IS NULL) <> (active_fencing_token IS NULL)
        OR (active_lease_id IS NULL) <> (active_acquired_at_ms IS NULL)
        OR (active_lease_id IS NULL) <> (active_expires_at_ms IS NULL)
        OR (active_lease_id IS NOT NULL AND (
             active_lease_epoch <> last_lease_epoch
          OR active_fencing_token <> last_fencing_token
          OR active_expires_at_ms <= active_acquired_at_ms))
  `, 0, MAX_SAFE_INTEGER, "invalid lease count");
  const badUsedLeases = scalarInteger(database, `
    SELECT count(*)
      FROM ge_cycle_used_lease_ids used
      JOIN ge_cycle_leases lease
        ON lease.tenant_id = used.tenant_id AND lease.stream_id = used.stream_id
     WHERE used.lease_epoch <> used.fencing_token
        OR used.fencing_token > lease.last_fencing_token
  `, 0, MAX_SAFE_INTEGER, "invalid used lease count");
  const incompleteLeaseHistory = scalarInteger(database, `
    SELECT count(*)
      FROM ge_cycle_leases lease
     WHERE (SELECT count(*) FROM ge_cycle_used_lease_ids used
             WHERE used.tenant_id = lease.tenant_id
               AND used.stream_id = lease.stream_id) <> lease.last_lease_epoch
        OR coalesce((SELECT min(used.lease_epoch) FROM ge_cycle_used_lease_ids used
                     WHERE used.tenant_id = lease.tenant_id
                       AND used.stream_id = lease.stream_id), 0)
           <> CASE WHEN lease.last_lease_epoch = 0 THEN 0 ELSE 1 END
        OR coalesce((SELECT max(used.lease_epoch) FROM ge_cycle_used_lease_ids used
                     WHERE used.tenant_id = lease.tenant_id
                       AND used.stream_id = lease.stream_id), 0) <> lease.last_lease_epoch
        OR (SELECT count(DISTINCT used.lease_epoch) FROM ge_cycle_used_lease_ids used
             WHERE used.tenant_id = lease.tenant_id
               AND used.stream_id = lease.stream_id) <> lease.last_lease_epoch
        OR (lease.active_lease_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM ge_cycle_used_lease_ids used
              WHERE used.tenant_id = lease.tenant_id
                AND used.stream_id = lease.stream_id
                AND used.lease_id = lease.active_lease_id
                AND used.lease_epoch = lease.active_lease_epoch
                AND used.fencing_token = lease.active_fencing_token
           ))
  `, 0, MAX_SAFE_INTEGER, "incomplete lease identity history");
  const migration = sqliteRow(statement(database, `
    SELECT active_lock_id, active_owner_id, active_source_version, active_target_version,
           active_lock_epoch, active_fencing_token, active_acquired_at_ms,
           active_expires_at_ms, last_lock_epoch, last_fencing_token,
           ge_cycle_migration_lock.updated_at_ms, ge_cycle_schema.updated_at_ms
      FROM ge_cycle_migration_lock CROSS JOIN ge_cycle_schema
     WHERE ge_cycle_migration_lock.singleton = 1 AND ge_cycle_schema.singleton = 1
  `).get(), 12, OPERATION, "migration lock singleton");
  const activeNulls = migration.slice(0, 8).filter((value) => value === null).length;
  const lastEpoch = integer(migration[8], 0, MAX_SAFE_INTEGER, "last migration epoch");
  const lastFence = integer(migration[9], 0, MAX_SAFE_INTEGER, "last migration fence");
  const clockHighWater = integer(migration[10], 0, MAX_SAFE_INTEGER, "provider clock high-water");
  const schemaAppliedAt = integer(migration[11], 0, MAX_SAFE_INTEGER, "schema application time");
  const maximumObservedCommit = scalarInteger(database, `
    SELECT max(observed_at_ms) FROM (
      SELECT created_at_ms AS observed_at_ms FROM ge_cycle_schema
      UNION ALL SELECT updated_at_ms FROM ge_cycle_schema
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
    )
  `, 0, MAX_SAFE_INTEGER, "maximum observed provider time");
  if (badLeases !== 0 || badUsedLeases !== 0 || incompleteLeaseHistory !== 0
      || lastEpoch !== lastFence
      || clockHighWater < schemaAppliedAt || clockHighWater < maximumObservedCommit
      || (activeNulls !== 0 && activeNulls !== 8)) {
    return fail("lease or migration fence");
  }
  if (activeNulls === 0) {
    const source = integer(migration[2], 1, MAX_SAFE_INTEGER, "migration source");
    const target = integer(migration[3], 2, MAX_SAFE_INTEGER, "migration target");
    const epoch = integer(migration[4], 1, MAX_SAFE_INTEGER, "migration epoch");
    const fence = integer(migration[5], 1, MAX_SAFE_INTEGER, "migration fence");
    const acquired = integer(migration[6], 0, MAX_SAFE_INTEGER, "migration acquired time");
    const expires = integer(migration[7], 0, MAX_SAFE_INTEGER, "migration expiry time");
    if (target <= source || epoch !== lastEpoch || fence !== lastFence || expires <= acquired) {
      return fail("active migration fence");
    }
  }
  const badUsedMigration = scalarInteger(database, `
    SELECT count(*) FROM ge_cycle_used_migration_lock_ids
     WHERE lock_epoch <> fencing_token
        OR fencing_token > (
          SELECT last_fencing_token FROM ge_cycle_migration_lock WHERE singleton = 1
        )
  `, 0, MAX_SAFE_INTEGER, "invalid migration identity count");
  const incompleteMigrationHistory = scalarInteger(database, `
    SELECT count(*)
      FROM ge_cycle_migration_lock lock
     WHERE (SELECT count(*) FROM ge_cycle_used_migration_lock_ids) <> lock.last_lock_epoch
        OR coalesce((SELECT min(lock_epoch) FROM ge_cycle_used_migration_lock_ids), 0)
           <> CASE WHEN lock.last_lock_epoch = 0 THEN 0 ELSE 1 END
        OR coalesce((SELECT max(lock_epoch) FROM ge_cycle_used_migration_lock_ids), 0)
           <> lock.last_lock_epoch
        OR (SELECT count(DISTINCT lock_epoch) FROM ge_cycle_used_migration_lock_ids)
           <> lock.last_lock_epoch
        OR (lock.active_lock_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM ge_cycle_used_migration_lock_ids used
              WHERE used.lock_id = lock.active_lock_id
                AND used.lock_epoch = lock.active_lock_epoch
                AND used.fencing_token = lock.active_fencing_token
           ))
  `, 0, MAX_SAFE_INTEGER, "incomplete migration identity history");
  if (badUsedMigration !== 0 || incompleteMigrationHistory !== 0) {
    return fail("used migration identities");
  }

  for (const [index, raw] of rows(database, `
    SELECT tenant_id, stream_id, last_lease_epoch, last_fencing_token,
           active_lease_id, active_holder_id, active_lease_epoch,
           active_fencing_token, active_acquired_at_ms, active_expires_at_ms
      FROM ge_cycle_leases ORDER BY tenant_id, stream_id
  `).entries()) {
    const row = sqliteRow(raw, 10, OPERATION, `lease row ${index}`);
    updateDigest(digest, "lease", row.map((value) => typeof value === "bigint" ? Number(value) : value));
  }
  updateDigest(
    digest,
    "migration-lock",
    migration.map((value) => typeof value === "bigint" ? Number(value) : value),
  );
}

function inspectCursors(database: DatabaseSync, digest: ReturnType<typeof createHash>): void {
  const cursorRows = rows(database, `
    SELECT tenant_id, token_hash, kind, stream_id, checkpoint_scope,
           request_scope_blob, page_size, next_position, snapshot_tail_sequence,
           snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256,
           snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms
      FROM ge_cycle_cursors ORDER BY tenant_id, token_hash
  `);
  for (const [index, raw] of cursorRows.entries()) {
    const row = sqliteRow(raw, 16, OPERATION, `cursor row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "cursor tenant");
    const tokenHash = sqliteText(row[1], OPERATION, "cursor token hash");
    const kind = sqliteText(row[2], OPERATION, "cursor kind");
    const streamId = sqliteNullableText(row[3], OPERATION, "cursor stream");
    const scope = sqliteNullableText(row[4], OPERATION, "cursor scope");
    const requestScope = canonicalBlob(row[5], "cursor request scope");
    const pageSize = integer(row[6], 1, 256, "cursor page size");
    const nextPosition = integer(row[7], 0, MAX_SAFE_INTEGER, "cursor position");
    const tailSequence = nullableInteger(row[8], -1, MAX_SAFE_INTEGER, "cursor tail sequence");
    const tailHash = sqliteNullableText(row[9], OPERATION, "cursor tail hash");
    const descriptorHash = sqliteText(row[10], OPERATION, "cursor descriptor");
    const schemaIdentity = sqliteText(row[11], OPERATION, "cursor schema identity");
    const snapshot = canonicalBlob(row[12], "cursor snapshot");
    const createdAt = integer(row[13], 0, MAX_SAFE_INTEGER, "cursor creation time");
    const expiresAt = integer(row[14], 0, MAX_SAFE_INTEGER, "cursor expiry time");
    const consumedAt = nullableInteger(row[15], 0, MAX_SAFE_INTEGER, "cursor consumption time");
    if (descriptorHash !== SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
        || schemaIdentity !== SQLITE_SCHEMA_IDENTITY_SHA256
        || expiresAt <= createdAt
        || (consumedAt !== null && consumedAt < createdAt)) {
      return fail("cursor identity binding");
    }
    if (kind === "event") {
      const expectedScope = {
        contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
        streamId,
        pageSize,
      };
      const expectedSnapshot = {
        exists: tailSequence !== -1,
        sequence: tailSequence,
        recordHash: tailHash,
      };
      if (streamId === null || scope !== null || tailSequence === null
          || !same(requestScope, expectedScope) || !same(snapshot, expectedSnapshot)
          || tailSequence < 0 || tailHash === null
          || (tailSequence >= 0 && nextPosition > tailSequence)) {
        return fail("event cursor binding");
      }
      if (statement(database, `
        SELECT 1 FROM ge_cycle_records
         WHERE tenant_id = ? AND stream_id = ? AND sequence = ? AND record_hash = ?
      `).get(tenantId, streamId, tailSequence, tailHash) === undefined) {
        return fail("event cursor snapshot record binding");
      }
    } else if (kind === "checkpoint") {
      const expectedScope = {
        contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
        checkpointScope: scope,
        pageSize,
      };
      if (streamId !== null || scope === null || tailSequence !== null || tailHash !== null
          || !same(requestScope, expectedScope) || !Array.isArray(snapshot)
          || nextPosition > snapshot.length) {
        return fail("checkpoint cursor binding");
      }
      const summaries: CycleStoreCheckpointSummary[] = [];
      for (const summary of snapshot) {
        const decoded = cycleStoreAdapterCodec.decodeLedgerResult(
          "save-checkpoint",
          Buffer.from(canonicalSerialize(summary), "utf8"),
        );
        const encoded = Buffer.from(
          cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", decoded),
        );
        if (decoded.checkpointScope !== scope || statement(database, `
          SELECT 1 FROM ge_cycle_checkpoint_revisions
           WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
             AND action = 'put' AND summary_blob = ?
           LIMIT 1
        `).get(tenantId, scope, decoded.checkpointId, encoded) === undefined) {
          return fail("checkpoint cursor revision binding");
        }
        summaries.push(decoded);
      }
      for (let index = 1; index < summaries.length; index += 1) {
        const prior = summaries[index - 1]!;
        const current = summaries[index]!;
        const ordered = prior.boundSequence > current.boundSequence
          || (prior.boundSequence === current.boundSequence && prior.createdAt > current.createdAt)
          || (prior.boundSequence === current.boundSequence
            && prior.createdAt === current.createdAt
            && prior.checkpointId < current.checkpointId);
        if (!ordered) return fail("checkpoint cursor snapshot order");
      }
    } else {
      return fail("cursor kind");
    }
    updateDigest(digest, "cursor", {
      tenantId,
      tokenHash,
      kind,
      requestScope,
      nextPosition,
      snapshot,
      createdAt,
      expiresAt,
      consumedAt,
    });
  }
}

function counters(database: DatabaseSync): SQLiteSemanticCounters {
  const count = (table: string): number => scalarInteger(
    database,
    `SELECT count(*) FROM ${table}`,
    0,
    MAX_SAFE_INTEGER,
    `${table} count`,
  );
  return Object.freeze({
    streams: count("ge_cycle_streams"),
    records: count("ge_cycle_records"),
    operations: count("ge_cycle_operations"),
    checkpoints: count("ge_cycle_checkpoints"),
    checkpointRevisions: count("ge_cycle_checkpoint_revisions"),
    leases: count("ge_cycle_leases"),
    usedLeaseIds: count("ge_cycle_used_lease_ids"),
    legalHolds: count("ge_cycle_legal_holds"),
    cursors: count("ge_cycle_cursors"),
    openCursors: scalarInteger(
      database,
      "SELECT count(*) FROM ge_cycle_cursors WHERE consumed_at_ms IS NULL",
      0,
      MAX_SAFE_INTEGER,
      "open cursor count",
    ),
    usedMigrationLockIds: count("ge_cycle_used_migration_lock_ids"),
  });
}

function inspectConnectionSettings(database: DatabaseSync): void {
  const expectedIntegers = [
    ["foreign_keys", 1],
    ["trusted_schema", 0],
    ["synchronous", 2],
    ["busy_timeout", 250],
    ["writable_schema", 0],
    ["query_only", 1],
  ] as const;
  for (const [name, expected] of expectedIntegers) {
    const actual = scalarInteger(database, `PRAGMA ${name}`, 0, MAX_SAFE_INTEGER, name);
    if (actual !== expected) return fail("connection settings");
  }
  const journalMode = scalarText(database, "PRAGMA journal_mode", "journal mode").toLowerCase();
  if (journalMode !== "wal" && journalMode !== "delete") {
    return fail("connection settings");
  }
}

/**
 * Runs one read-only snapshot audit. Semantic mode verifies every canonical
 * authoritative blob and all hash-chain, ledger, checkpoint, fence, cursor,
 * schema, and migration bindings without returning tenant or payload data.
 */
export function inspectSQLiteCycleStoreIntegrity(
  path: string,
  level: SQLiteIntegrityLevel = "semantic",
): SQLiteCycleStoreIntegrityReport {
  const safePath = checkedPath(path);
  if (level !== "quick" && level !== "structural" && level !== "semantic") {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite integrity level is invalid",
    );
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(safePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: true,
      timeout: 250,
    });
    database.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON");
    inspectConnectionSettings(database);
    database.exec("BEGIN");
    checkPragma(database, "quick_check");
    if (rows(database, "PRAGMA foreign_key_check").length !== 0) {
      return fail("foreign keys");
    }
    if (level !== "quick") checkPragma(database, "integrity_check");
    const lineage = inspectIdentity(database);
    const semanticCounters = counters(database);
    let semanticSha256: string | null = null;
    if (level === "semantic") {
      const digest = createHash("sha256").update(SEMANTIC_DIGEST_DOMAIN, "utf8");
      updateDigest(digest, "schema", {
        applicationId: SQLITE_CYCLE_STORE_APPLICATION_ID,
        schemaVersion: SQLITE_CYCLE_STORE_SCHEMA_VERSION,
        schemaIdentitySha256: SQLITE_SCHEMA_IDENTITY_SHA256,
        descriptorHash: SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
        catalogSha256: SQLITE_SCHEMA_CATALOG_SHA256,
        ...lineage,
      });
      inspectRecords(database, digest);
      inspectOperations(database, digest);
      inspectCheckpoints(database, digest);
      inspectFences(database, digest);
      inspectCursors(database, digest);
      for (const [label, sql] of [
        ["legal-hold", `SELECT tenant_id, stream_id, hold_id, placed_at_ms
                          FROM ge_cycle_legal_holds ORDER BY tenant_id, stream_id, hold_id`],
        ["used-lease", `SELECT tenant_id, stream_id, lease_id, lease_epoch,
                               fencing_token, first_used_at_ms
                          FROM ge_cycle_used_lease_ids
                         ORDER BY tenant_id, stream_id, lease_id`],
        ["used-migration", `SELECT lock_id, lock_epoch, fencing_token, first_used_at_ms
                              FROM ge_cycle_used_migration_lock_ids ORDER BY lock_id`],
      ] as const) {
        for (const raw of rows(database, sql)) {
          assertAuditRow(raw, label, digest);
        }
      }
      updateDigest(digest, "counters", semanticCounters);
      semanticSha256 = digest.digest("hex");
    }
    database.exec("COMMIT");
    const sqliteVersion = scalarText(database, "SELECT sqlite_version()", "SQLite version");
    return Object.freeze({
      level,
      quickCheck: "ok",
      integrityCheck: level === "quick" ? "not-run" : "ok",
      foreignKeyViolations: 0,
      applicationId: SQLITE_CYCLE_STORE_APPLICATION_ID,
      schemaVersion: SQLITE_CYCLE_STORE_SCHEMA_VERSION,
      schemaIdentitySha256: SQLITE_SCHEMA_IDENTITY_SHA256,
      descriptorHash: SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
      ...lineage,
      catalogSha256: SQLITE_SCHEMA_CATALOG_SHA256,
      counters: semanticCounters,
      semanticSha256,
      sqliteVersion,
    });
  } catch (error) {
    if (error instanceof CycleStoreProviderError) {
      if (error.operation === OPERATION) throw error;
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        OPERATION,
        "SQLite CycleStore integrity audit found invalid canonical state",
        { check: "canonical application state" },
      );
    }
    throw translateSQLiteError(error, OPERATION);
  } finally {
    if (database?.isOpen === true) {
      if (database.isTransaction) {
        try { database.exec("ROLLBACK"); } catch { /* preserve the safe audit error */ }
      }
      database.close();
    }
  }
}

function assertAuditRow(
  value: unknown,
  label: string,
  digest: ReturnType<typeof createHash>,
): void {
  if (!Array.isArray(value)) return fail(`${label} row`);
  const normalized = value.map((field) => {
    if (typeof field === "bigint") {
      if (field < 0n || field > BigInt(MAX_SAFE_INTEGER)) return fail(`${label} integer`);
      return Number(field);
    }
    if (typeof field !== "string" && field !== null && !(field instanceof Uint8Array)) {
      return fail(`${label} field`);
    }
    return field instanceof Uint8Array ? Buffer.from(field).toString("hex") : field;
  });
  updateDigest(digest, label, normalized);
}
