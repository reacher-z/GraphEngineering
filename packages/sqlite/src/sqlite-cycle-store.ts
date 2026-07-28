import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { TextDecoder } from "node:util";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import {
  CYCLE_STORE_CURSOR_TTL_MS,
  CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
  MAX_CYCLE_STORE_CHECKPOINT_BYTES,
  MAX_CYCLE_STORE_CURSOR_COUNT,
  CycleStoreProviderError,
  cycleStoreAdapterCodec,
  type CycleStoreAcquireLeaseRequest,
  type CycleStoreAcquireMigrationLockRequest,
  type CycleStoreAppendRequest,
  type CycleStoreAppendResult,
  type CycleStoreAuthorizationContext,
  type CycleStoreAuthorizationHook,
  type CycleStoreCanonicalRequestByOperation,
  type CycleStoreCheckpoint,
  type CycleStoreCheckpointPage,
  type CycleStoreCheckpointSummary,
  type CycleStoreDeleteCheckpointRequest,
  type CycleStoreDeleteCheckpointResult,
  type CycleStoreEventPage,
  type CycleStoreGovernanceInspection,
  type CycleStoreInspectLeaseRequest,
  type CycleStoreLease,
  type CycleStoreLeaseBinding,
  type CycleStoreLeaseInspection,
  type CycleStoreLedgerResultByOperation,
  type CycleStoreLegalHoldRequest,
  type CycleStoreListCheckpointsRequest,
  type CycleStoreLoadCheckpointRequest,
  type CycleStoreMigrationLock,
  type CycleStoreMutationContext,
  type CycleStoreMutationOperation,
  type CycleStoreProvider,
  type CycleStoreProviderDescriptor,
  type CycleStoreProviderFaultHook,
  type CycleStoreProviderOperation,
  type CycleStoreReadEventPageRequest,
  type CycleStoreReadTailRequest,
  type CycleStoreRecord,
  type CycleStoreReleaseLeaseRequest,
  type CycleStoreReleaseMigrationLockRequest,
  type CycleStoreRenewLeaseRequest,
  type CycleStoreSaveCheckpointRequest,
  type CycleStoreSchemaInspection,
  type CycleStoreTail,
} from "@graph-engineering/runtime";

import { ensureSQLiteCycleStoreSchema } from "./migrations.js";
import {
  sqliteBlob,
  sqliteNullableText,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "./sqlite-codec.js";
import {
  SQLiteConnection,
  type SQLiteConnectionOptions,
} from "./sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "./sqlite-profile.js";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_CURSOR_BLOB_BYTES = MAX_CYCLE_STORE_CHECKPOINT_BYTES;
const CURSOR_EXPIRY_CLEANUP_LIMIT = 64;

interface SQLiteChanges {
  readonly changes: number | bigint;
}

interface StoredLeaseState {
  readonly active: CycleStoreLease | null;
  readonly activeAcquiredAtMs: number | null;
  readonly activeExpiresAtMs: number | null;
  readonly lastLeaseEpoch: number;
  readonly lastFencingToken: number;
}

interface StoredMigrationState {
  readonly active: CycleStoreMigrationLock | null;
  readonly activeAcquiredAtMs: number | null;
  readonly activeExpiresAtMs: number | null;
  readonly lastLockEpoch: number;
  readonly lastFencingToken: number;
}

interface EventCursorState {
  readonly nextSequence: number;
  readonly snapshotTail: CycleStoreTail;
}

interface CheckpointCursorState {
  readonly nextIndex: number;
  readonly snapshot: readonly CycleStoreCheckpointSummary[];
}

interface CursorReadOutcome<T> {
  readonly invalid: boolean;
  readonly value: T | null;
}

export interface SQLiteCycleStoreProviderOptions extends SQLiteConnectionOptions {
  /** Deterministic test clock. Production time is read from SQLite inside each transaction. */
  readonly now?: () => Date;
  readonly authorize?: CycleStoreAuthorizationHook;
  /** Synchronous crash-boundary diagnostic hook; promises are rejected fail-closed. */
  readonly faultHook?: CycleStoreProviderFaultHook;
}

function fail(
  code: ConstructorParameters<typeof CycleStoreProviderError>[0],
  operation: CycleStoreProviderOperation,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new CycleStoreProviderError(code, operation, message, details);
}

function changes(value: SQLiteChanges, operation: CycleStoreProviderOperation): number {
  const raw = value.changes;
  if ((typeof raw !== "bigint" && typeof raw !== "number")
      || !Number.isSafeInteger(Number(raw)) || Number(raw) < 0) {
    return fail("GE_CYCLE_STORE_CORRUPTION", operation, "SQLite change count is invalid");
  }
  return Number(raw);
}

function nullableSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  operation: CycleStoreProviderOperation,
  label: string,
): number | null {
  return value === null ? null : sqliteSafeInteger(value, minimum, maximum, operation, label);
}

function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalSerialize(value), "utf8");
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

function decodeCanonicalBlob(
  blob: Buffer,
  operation: CycleStoreProviderOperation,
  label: string,
  maximumBytes: number,
): unknown {
  if (blob.byteLength < 2 || blob.byteLength > maximumBytes
      || (blob[0] === 0xef && blob[1] === 0xbb && blob[2] === 0xbf)) {
    return fail("GE_CYCLE_STORE_CORRUPTION", operation, `stored ${label} bytes are corrupt`);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(blob);
    const value = JSON.parse(text) as unknown;
    if (canonicalSerialize(value) !== text) throw new TypeError("not canonical");
    deepFreeze(value);
    return value;
  } catch (error) {
    if (error instanceof CycleStoreProviderError) throw error;
    return fail("GE_CYCLE_STORE_CORRUPTION", operation, `stored ${label} bytes are corrupt`);
  }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function missingTail(): CycleStoreTail {
  return Object.freeze({ exists: false, sequence: -1, recordHash: null });
}

function tail(
  sequence: number,
  recordHash: string | null,
  operation: CycleStoreProviderOperation,
): CycleStoreTail {
  if (sequence === -1 && recordHash === null) return missingTail();
  if (sequence < 0 || recordHash === null) {
    return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored stream tail is inconsistent");
  }
  return Object.freeze({ exists: true, sequence, recordHash });
}

function checkpointSummary(checkpoint: CycleStoreCheckpoint): CycleStoreCheckpointSummary {
  const { value: _value, ...summary } = checkpoint;
  return Object.freeze(summary);
}

function iso(milliseconds: number, operation: CycleStoreProviderOperation): string {
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored provider timestamp is invalid");
  }
}

/** Same-host durable CycleStore provider backed by one hardened SQLite file. */
export class SQLiteCycleStoreProvider implements CycleStoreProvider {
  readonly #connection: SQLiteConnection;
  readonly #descriptor: CycleStoreProviderDescriptor;
  readonly #schemaIdentitySha256: string;
  readonly #authorizeHook: CycleStoreAuthorizationHook;
  readonly #nowHook: (() => Date) | undefined;
  readonly #faultHook: CycleStoreProviderFaultHook | undefined;
  #lastObservedNowMs = 0;

  constructor(path: string, options: SQLiteCycleStoreProviderOptions = {}) {
    this.#descriptor = createSQLiteCycleStoreDescriptor();
    this.#authorizeHook = options.authorize ?? (() => true);
    this.#nowHook = options.now;
    this.#faultHook = options.faultHook;
    const connectionOptions: SQLiteConnectionOptions = {
      ...(options.busyTimeoutMs === undefined ? {} : { busyTimeoutMs: options.busyTimeoutMs }),
      ...(options.maxBusyAttempts === undefined ? {} : { maxBusyAttempts: options.maxBusyAttempts }),
      ...(options.maxBusyElapsedMs === undefined
        ? {}
        : { maxBusyElapsedMs: options.maxBusyElapsedMs }),
    };
    this.#connection = new SQLiteConnection(path, connectionOptions);
    try {
      const openedAtMs = this.#nowHook === undefined
        ? undefined
        : this.#clockCandidate("inspect-schema");
      const opened = ensureSQLiteCycleStoreSchema(
        this.#connection,
        this.#descriptor,
        openedAtMs === undefined ? {} : { appliedAtMs: openedAtMs },
      );
      this.#schemaIdentitySha256 = opened.schemaIdentitySha256;
      this.#connection.immediate("inspect-schema", () => this.#providerNow("inspect-schema"));
    } catch (error) {
      this.#connection.close();
      throw error;
    }
  }

  get path(): string {
    return this.#connection.path;
  }

  get isOpen(): boolean {
    return this.#connection.isOpen;
  }

  close(): void {
    this.#connection.close();
  }

  async describe(): Promise<CycleStoreProviderDescriptor> {
    this.#assertOpen("describe");
    return createSQLiteCycleStoreDescriptor();
  }

  async inspectSchema(
    contextValue: CycleStoreAuthorizationContext,
  ): Promise<CycleStoreSchemaInspection> {
    const operation = "inspect-schema" as const;
    this.#assertOpen(operation);
    const { context } = cycleStoreAdapterCodec.captureRequest(
      operation,
      contextValue,
      this.#descriptor,
    );
    await this.#authorize(context, operation);
    return this.#connection.immediate(operation, () => {
      const row = sqliteRow(
        this.#connection.prepare(`
          SELECT current_version, min_reader_version, max_reader_version,
                 min_writer_version, max_writer_version, provider_descriptor_hash,
                 schema_identity_sha256
          FROM ge_cycle_schema WHERE singleton = 1
        `, operation).get(),
        7,
        operation,
        "schema singleton",
      );
      const schemaVersion = sqliteSafeInteger(row[0], 1, MAX_SAFE_INTEGER, operation, "schema version");
      const minReaderVersion = sqliteSafeInteger(row[1], 1, MAX_SAFE_INTEGER, operation, "minimum reader");
      const maxReaderVersion = sqliteSafeInteger(row[2], 1, MAX_SAFE_INTEGER, operation, "maximum reader");
      const minWriterVersion = sqliteSafeInteger(row[3], 1, MAX_SAFE_INTEGER, operation, "minimum writer");
      const maxWriterVersion = sqliteSafeInteger(row[4], 1, MAX_SAFE_INTEGER, operation, "maximum writer");
      const descriptorHash = sqliteText(row[5], operation, "descriptor hash");
      const schemaIdentity = sqliteText(row[6], operation, "schema identity");
      if (descriptorHash !== this.#descriptor.descriptorHash
          || schemaIdentity !== this.#schemaIdentitySha256
          || schemaVersion !== this.#descriptor.schemaVersion) {
        return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored schema identity drifted");
      }
      return Object.freeze({
        descriptorHash,
        schemaVersion,
        minReaderVersion,
        maxReaderVersion,
        minWriterVersion,
        maxWriterVersion,
        migrationLock: this.#readMigrationState(operation).active,
      });
    });
  }

  async readTail(requestValue: CycleStoreReadTailRequest): Promise<CycleStoreTail> {
    const operation = "read-tail" as const;
    this.#assertOpen(operation);
    const { context, streamId } = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(context, operation);
    return this.#readTail(context.tenantId, streamId, operation);
  }

  async append(requestValue: CycleStoreAppendRequest): Promise<CycleStoreAppendResult> {
    const operation = "append" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      this.#assertOnlineWriterCompatible(operation, now);
      const actualTail = this.#readTail(request.context.tenantId, request.streamId, operation);
      if (!same(actualTail, request.expectedTail)) {
        return fail("GE_CYCLE_STORE_CONFLICT", operation, "append lost expected-tail CAS", {
          expectedSequence: request.expectedTail.sequence,
          actualSequence: actualTail.sequence,
        });
      }
      this.#assertWriteLease(
        request.context.tenantId,
        request.streamId,
        request.lease,
        operation,
        now,
      );
      this.#runFault("provider:append:decision-state-read", operation);
      if (actualTail.sequence === MAX_SAFE_INTEGER) {
        return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "stream sequence is exhausted");
      }
      let nextSequence = actualTail.sequence + 1;
      let previousHash = actualTail.recordHash;
      const batchIds = new Set<string>();
      for (const [index, record] of request.records.entries()) {
        if (record.sequence !== nextSequence || record.previousRecordHash !== previousHash) {
          return fail("GE_CYCLE_STORE_CONFLICT", operation, "append record chain is not contiguous");
        }
        if (batchIds.has(record.recordId) || this.#recordIdExists(
          request.context.tenantId,
          record.recordId,
          operation,
        )) {
          return fail("GE_CYCLE_STORE_CONFLICT", operation, "recordId is already committed", {
            recordId: record.recordId,
          });
        }
        batchIds.add(record.recordId);
        previousHash = record.recordHash;
        if (index + 1 < request.records.length) {
          if (nextSequence === MAX_SAFE_INTEGER) {
            return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "stream sequence is exhausted");
          }
          nextSequence += 1;
        }
      }

      if (!actualTail.exists) {
        this.#connection.prepare(`
          INSERT INTO ge_cycle_streams
            (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
          VALUES (?, ?, -1, NULL, ?, ?)
        `, operation).run(request.context.tenantId, request.streamId, now, now);
      }
      const insert = this.#connection.prepare(`
        INSERT INTO ge_cycle_records
          (tenant_id, stream_id, sequence, record_id, previous_record_hash,
           value_hash, value_bytes, value_blob, record_hash, record_blob, committed_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, operation);
      for (const record of request.records) {
        insert.run(
          request.context.tenantId,
          request.streamId,
          record.sequence,
          record.recordId,
          record.previousRecordHash,
          record.valueHash,
          record.valueBytes,
          canonicalBytes(record.value),
          record.recordHash,
          canonicalBytes(record),
          now,
        );
      }
      const committedTail = Object.freeze({
        exists: true as const,
        sequence: request.records.at(-1)!.sequence,
        recordHash: request.records.at(-1)!.recordHash,
      });
      const updated = changes(this.#connection.prepare(`
        UPDATE ge_cycle_streams
        SET tail_sequence = ?, tail_record_hash = ?, updated_at_ms = ?
        WHERE tenant_id = ? AND stream_id = ?
          AND tail_sequence = ? AND tail_record_hash IS ?
      `, operation).run(
        committedTail.sequence,
        committedTail.recordHash,
        now,
        request.context.tenantId,
        request.streamId,
        actualTail.sequence,
        actualTail.recordHash,
      ), operation);
      if (updated !== 1) {
        return fail("GE_CYCLE_STORE_CONFLICT", operation, "append lost expected-tail CAS");
      }
      this.#runFault("provider:append:records-staged", operation);
      return Object.freeze({ tail: committedTail, appendedRecords: request.records.length });
    });
  }

  async readEventPage(requestValue: CycleStoreReadEventPageRequest): Promise<CycleStoreEventPage> {
    const operation = "read-event-page" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    const outcome = this.#connection.immediate(operation, () => {
      const now = this.#providerNow(operation);
      let state: EventCursorState;
      if (request.cursor === null) {
        state = {
          nextSequence: request.fromSequence!,
          snapshotTail: this.#readTail(request.context.tenantId, request.streamId, operation),
        };
      } else {
        const resumed = this.#consumeEventCursor(request, now, operation);
        if (resumed.invalid) return Object.freeze({ invalid: true, value: null });
        state = resumed.value!;
      }
      const snapshotLastSequence = state.snapshotTail.exists ? state.snapshotTail.sequence : -1;
      const rows = this.#connection.prepare(`
        SELECT sequence, record_id, previous_record_hash, value_hash,
               value_bytes, value_blob, record_hash, record_blob
        FROM ge_cycle_records
        WHERE tenant_id = ? AND stream_id = ? AND sequence >= ? AND sequence <= ?
        ORDER BY sequence ASC LIMIT ?
      `, operation).all(
        request.context.tenantId,
        request.streamId,
        state.nextSequence,
        snapshotLastSequence,
        request.pageSize,
      );
      let expectedPreviousHash: string | null = null;
      if (state.nextSequence > 0 && state.nextSequence <= snapshotLastSequence) {
        const predecessor = sqliteRow(this.#connection.prepare(`
          SELECT record_hash FROM ge_cycle_records
          WHERE tenant_id = ? AND stream_id = ? AND sequence = ?
        `, operation).get(
          request.context.tenantId,
          request.streamId,
          state.nextSequence - 1,
        ), 1, operation, "event predecessor");
        expectedPreviousHash = sqliteText(predecessor[0], operation, "event predecessor hash");
      }
      const records: CycleStoreRecord[] = [];
      let expectedSequence = state.nextSequence;
      for (const [index, raw] of rows.entries()) {
        const row = sqliteRow(raw, 8, operation, "event record");
        const sequence = sqliteSafeInteger(row[0], 0, MAX_SAFE_INTEGER, operation, "record sequence");
        const recordId = sqliteText(row[1], operation, "record ID");
        const previousRecordHash = sqliteNullableText(row[2], operation, "previous record hash");
        const valueHash = sqliteText(row[3], operation, "record value hash");
        const valueBytes = sqliteSafeInteger(
          row[4],
          1,
          this.#descriptor.limits.maxRecordBytes,
          operation,
          "record value bytes",
        );
        const valueBlob = sqliteBlob(row[5], operation, "record value blob");
        const recordHash = sqliteText(row[6], operation, "record hash");
        const record = cycleStoreAdapterCodec.parseStoredRecord(
          sqliteBlob(row[7], operation, "record blob"),
          operation,
        );
        if (sequence !== expectedSequence || record.sequence !== sequence
            || record.recordId !== recordId
            || record.previousRecordHash !== previousRecordHash
            || record.previousRecordHash !== expectedPreviousHash
            || record.valueHash !== valueHash
            || record.valueBytes !== valueBytes
            || record.recordHash !== recordHash
            || !valueBlob.equals(canonicalBytes(record.value))) {
          return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored event page is not contiguous");
        }
        records.push(record);
        expectedPreviousHash = record.recordHash;
        if (index + 1 < rows.length) {
          if (expectedSequence === MAX_SAFE_INTEGER) {
            return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored event sequence overflowed");
          }
          expectedSequence += 1;
        }
      }
      if (records.length === 0 && state.nextSequence <= snapshotLastSequence) {
        return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored event snapshot has a missing record");
      }
      const lastRecord = records.at(-1);
      if (lastRecord !== undefined && lastRecord.sequence === snapshotLastSequence
          && lastRecord.recordHash !== state.snapshotTail.recordHash) {
        return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored event snapshot tail drifted");
      }
      const hasRemaining = lastRecord !== undefined && lastRecord.sequence < snapshotLastSequence;
      const nextCursor = hasRemaining
        ? this.#createEventCursor(
          request,
          state.snapshotTail,
          lastRecord.sequence + 1,
          now,
          operation,
        )
        : null;
      const page: CycleStoreEventPage = Object.freeze({
        exists: state.snapshotTail.exists,
        snapshotTail: state.snapshotTail,
        records: Object.freeze(records),
        nextCursor,
      });
      return Object.freeze({ invalid: false, value: page });
    });
    if (outcome.invalid || outcome.value === null) {
      return fail("GE_CYCLE_STORE_INVALID_CURSOR", operation, "event cursor is invalid or expired");
    }
    return outcome.value;
  }

  async saveCheckpoint(
    requestValue: CycleStoreSaveCheckpointRequest,
  ): Promise<CycleStoreCheckpointSummary> {
    const operation = "save-checkpoint" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      this.#assertOnlineWriterCompatible(operation, now);
      const streamTail = this.#readTail(
        request.context.tenantId,
        request.checkpoint.streamId,
        operation,
      );
      if (!streamTail.exists
          || streamTail.sequence !== request.checkpoint.boundSequence
          || streamTail.recordHash !== request.checkpoint.boundRecordHash) {
        return fail("GE_CYCLE_STORE_CONFLICT", operation, "checkpoint is not bound to the current event tail", {
          actualSequence: streamTail.sequence,
          expectedSequence: request.checkpoint.boundSequence,
        });
      }
      this.#assertWriteLease(
        request.context.tenantId,
        request.checkpoint.streamId,
        request.lease,
        operation,
        now,
      );
      const existing = this.#connection.prepare(`
        SELECT checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
               bound_record_hash, created_at, value_hash, value_bytes,
               value_blob, checkpoint_blob, summary_blob
        FROM ge_cycle_checkpoints
        WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
      `, operation).get(
        request.context.tenantId,
        request.checkpoint.checkpointScope,
        request.checkpoint.checkpointId,
      );
      if (existing !== undefined) {
        const stored = this.#decodeCheckpointRow(existing, operation);
        if (!same(stored, request.checkpoint)) {
          return fail("GE_CYCLE_STORE_CONFLICT", operation, "checkpointId is immutable until deleted");
        }
        return checkpointSummary(stored);
      }
      const summary = checkpointSummary(request.checkpoint);
      const revision = this.#nextCheckpointRevision(
        request.context.tenantId,
        request.checkpoint.checkpointScope,
        operation,
      );
      this.#connection.prepare(`
        INSERT INTO ge_cycle_checkpoints
          (tenant_id, checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
           bound_record_hash, created_at, value_hash, value_bytes, value_blob,
           checkpoint_blob, summary_blob, checkpoint_revision, committed_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, operation).run(
        request.context.tenantId,
        request.checkpoint.checkpointScope,
        request.checkpoint.checkpointId,
        request.checkpoint.streamId,
        request.checkpoint.boundSequence,
        request.checkpoint.boundRecordHash,
        request.checkpoint.createdAt,
        request.checkpoint.valueHash,
        request.checkpoint.valueBytes,
        canonicalBytes(request.checkpoint.value),
        canonicalBytes(request.checkpoint),
        cycleStoreAdapterCodec.encodeLedgerResult(operation, summary),
        revision,
        now,
      );
      this.#connection.prepare(`
        INSERT INTO ge_cycle_checkpoint_revisions
          (tenant_id, checkpoint_scope, revision, checkpoint_id, action, summary_blob,
           bound_sequence, bound_record_hash, checkpoint_created_at, value_hash,
           value_bytes, recorded_at_ms)
        VALUES (?, ?, ?, ?, 'put', ?, ?, ?, ?, ?, ?, ?)
      `, operation).run(
        request.context.tenantId,
        request.checkpoint.checkpointScope,
        revision,
        request.checkpoint.checkpointId,
        cycleStoreAdapterCodec.encodeLedgerResult(operation, summary),
        request.checkpoint.boundSequence,
        request.checkpoint.boundRecordHash,
        request.checkpoint.createdAt,
        request.checkpoint.valueHash,
        request.checkpoint.valueBytes,
        now,
      );
      return summary;
    });
  }

  async loadCheckpoint(
    requestValue: CycleStoreLoadCheckpointRequest,
  ): Promise<CycleStoreCheckpoint | null> {
    const operation = "load-checkpoint" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    const raw = this.#connection.prepare(`
      SELECT checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
             bound_record_hash, created_at, value_hash, value_bytes,
             value_blob, checkpoint_blob, summary_blob
      FROM ge_cycle_checkpoints
      WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
    `, operation).get(
      request.context.tenantId,
      request.checkpointScope,
      request.checkpointId,
    );
    if (raw === undefined) return null;
    return this.#decodeCheckpointRow(raw, operation);
  }

  async listCheckpoints(
    requestValue: CycleStoreListCheckpointsRequest,
  ): Promise<CycleStoreCheckpointPage> {
    const operation = "list-checkpoints" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    const outcome = this.#connection.immediate(operation, () => {
      const now = this.#providerNow(operation);
      let state: CheckpointCursorState;
      if (request.cursor === null) {
        state = { nextIndex: 0, snapshot: this.#checkpointSnapshot(request, operation) };
      } else {
        const resumed = this.#consumeCheckpointCursor(request, now, operation);
        if (resumed.invalid) return Object.freeze({ invalid: true, value: null });
        state = resumed.value!;
      }
      const end = Math.min(state.nextIndex + request.pageSize, state.snapshot.length);
      const checkpoints = Object.freeze(state.snapshot.slice(state.nextIndex, end));
      const nextCursor = end < state.snapshot.length
        ? this.#createCheckpointCursor(request, state.snapshot, end, now, operation)
        : null;
      return Object.freeze({
        invalid: false,
        value: Object.freeze({ checkpoints, nextCursor }),
      });
    });
    if (outcome.invalid || outcome.value === null) {
      return fail("GE_CYCLE_STORE_INVALID_CURSOR", operation, "checkpoint cursor is invalid or expired");
    }
    return outcome.value;
  }

  async deleteCheckpoint(
    requestValue: CycleStoreDeleteCheckpointRequest,
  ): Promise<CycleStoreDeleteCheckpointResult> {
    const operation = "delete-checkpoint" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      this.#assertOnlineWriterCompatible(operation, now);
      const raw = this.#connection.prepare(`
        SELECT checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
               bound_record_hash, created_at, value_hash, value_bytes,
               value_blob, checkpoint_blob, summary_blob
        FROM ge_cycle_checkpoints
        WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
      `, operation).get(
        request.context.tenantId,
        request.checkpointScope,
        request.checkpointId,
      );
      if (raw === undefined) return Object.freeze({ deleted: false });
      const checkpoint = this.#decodeCheckpointRow(raw, operation);
      if (request.expectedValueHash === null
          || request.expectedValueHash !== checkpoint.valueHash) {
        return fail("GE_CYCLE_STORE_CONFLICT", operation, "checkpoint content hash differs from expected value");
      }
      if (this.#legalHoldCount(request.context.tenantId, checkpoint.streamId, operation) > 0) {
        return fail("GE_CYCLE_STORE_LEGAL_HOLD", operation, "checkpoint deletion is blocked by legal hold");
      }
      const revision = this.#nextCheckpointRevision(
        request.context.tenantId,
        request.checkpointScope,
        operation,
      );
      this.#connection.prepare(`
        INSERT INTO ge_cycle_checkpoint_revisions
          (tenant_id, checkpoint_scope, revision, checkpoint_id, action, summary_blob,
           bound_sequence, bound_record_hash, checkpoint_created_at, value_hash,
           value_bytes, recorded_at_ms)
        VALUES (?, ?, ?, ?, 'delete', NULL, NULL, NULL, NULL, NULL, NULL, ?)
      `, operation).run(
        request.context.tenantId,
        request.checkpointScope,
        revision,
        request.checkpointId,
        now,
      );
      const deleted = changes(this.#connection.prepare(`
        DELETE FROM ge_cycle_checkpoints
        WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
      `, operation).run(
        request.context.tenantId,
        request.checkpointScope,
        request.checkpointId,
      ), operation);
      if (deleted !== 1) return fail("GE_CYCLE_STORE_CONFLICT", operation, "checkpoint deletion lost CAS");
      return Object.freeze({ deleted: true });
    });
  }

  async acquireLease(requestValue: CycleStoreAcquireLeaseRequest): Promise<CycleStoreLease> {
    const operation = "acquire-lease" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      this.#assertOnlineWriterCompatible(operation, now);
      if (!this.#readTail(request.context.tenantId, request.streamId, operation).exists) {
        return fail("GE_CYCLE_STORE_NOT_FOUND", operation, "lease stream does not exist");
      }
      const state = this.#readLeaseState(request.context.tenantId, request.streamId, operation);
      if (request.expectedFencingToken !== state.lastFencingToken) {
        return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "expected lease fence is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      const expired = state.activeExpiresAtMs !== null && state.activeExpiresAtMs <= now;
      if (request.mode === "takeover") {
        if (state.active === null || !expired) {
          return fail("GE_CYCLE_STORE_LEASE_CONFLICT", operation, "lease takeover requires an expired active lease");
        }
      } else if (state.active !== null) {
        return fail(
          "GE_CYCLE_STORE_LEASE_CONFLICT",
          operation,
          expired ? "expired lease requires takeover mode" : "stream already has an active lease",
        );
      }
      if (this.#usedLeaseIdExists(
        request.context.tenantId,
        request.streamId,
        request.leaseId,
        operation,
      )) {
        return fail("GE_CYCLE_STORE_LEASE_CONFLICT", operation, "leaseId cannot be reused");
      }
      if (state.lastLeaseEpoch === MAX_SAFE_INTEGER || state.lastFencingToken === MAX_SAFE_INTEGER) {
        return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "lease fence exhausted");
      }
      const expiresAtMs = this.#addDuration(now, request.ttlMs, operation);
      const lease: CycleStoreLease = Object.freeze({
        leaseId: request.leaseId,
        holderId: request.holderId,
        leaseEpoch: state.lastLeaseEpoch + 1,
        fencingToken: state.lastFencingToken + 1,
        acquiredAt: iso(now, operation),
        expiresAt: iso(expiresAtMs, operation),
      });
      this.#upsertLease(request.context.tenantId, request.streamId, lease, now, expiresAtMs, operation);
      this.#connection.prepare(`
        INSERT INTO ge_cycle_used_lease_ids
          (tenant_id, stream_id, lease_id, lease_epoch, fencing_token, first_used_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `, operation).run(
        request.context.tenantId,
        request.streamId,
        lease.leaseId,
        lease.leaseEpoch,
        lease.fencingToken,
        now,
      );
      return lease;
    });
  }

  async renewLease(requestValue: CycleStoreRenewLeaseRequest): Promise<CycleStoreLease> {
    const operation = "renew-lease" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      this.#assertOnlineWriterCompatible(operation, now);
      const state = this.#readLeaseState(request.context.tenantId, request.streamId, operation);
      if (!this.#bindingMatches(state, request.lease)
          || state.activeExpiresAtMs === null || state.activeExpiresAtMs <= now) {
        return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "lease renewal identity is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      const expiresAtMs = this.#addDuration(now, request.ttlMs, operation);
      if (expiresAtMs <= state.activeExpiresAtMs) {
        return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "lease renewal must strictly extend expiry");
      }
      const renewed: CycleStoreLease = Object.freeze({
        ...state.active!,
        expiresAt: iso(expiresAtMs, operation),
      });
      this.#upsertLease(request.context.tenantId, request.streamId, renewed, now, expiresAtMs, operation);
      return renewed;
    });
  }

  async releaseLease(requestValue: CycleStoreReleaseLeaseRequest): Promise<CycleStoreLeaseInspection> {
    const operation = "release-lease" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      this.#assertOnlineWriterCompatible(operation, now);
      const state = this.#readLeaseState(request.context.tenantId, request.streamId, operation);
      if (!this.#bindingMatches(state, request.lease)
          || state.activeExpiresAtMs === null || state.activeExpiresAtMs <= now) {
        return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "lease release identity is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      const updated = changes(this.#connection.prepare(`
        UPDATE ge_cycle_leases
        SET active_lease_id = NULL, active_holder_id = NULL, active_lease_epoch = NULL,
            active_fencing_token = NULL, active_acquired_at_ms = NULL,
            active_expires_at_ms = NULL, updated_at_ms = ?
        WHERE tenant_id = ? AND stream_id = ? AND active_lease_id = ?
          AND active_holder_id = ? AND active_fencing_token = ?
      `, operation).run(
        now,
        request.context.tenantId,
        request.streamId,
        request.lease.leaseId,
        request.lease.holderId,
        request.lease.fencingToken,
      ), operation);
      if (updated !== 1) return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "lease release lost fence CAS");
      return Object.freeze({
        status: "released" as const,
        lease: null,
        lastLeaseEpoch: state.lastLeaseEpoch,
        lastFencingToken: state.lastFencingToken,
      });
    });
  }

  async inspectLease(requestValue: CycleStoreInspectLeaseRequest): Promise<CycleStoreLeaseInspection> {
    const operation = "inspect-lease" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#connection.immediate(operation, () => {
      const now = this.#providerNow(operation);
      return this.#leaseInspection(
        this.#readLeaseState(request.context.tenantId, request.streamId, operation),
        now,
      );
    });
  }

  async setLegalHold(requestValue: CycleStoreLegalHoldRequest): Promise<CycleStoreGovernanceInspection> {
    const operation = "set-legal-hold" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      this.#assertOnlineWriterCompatible(operation, now);
      if (!this.#readTail(request.context.tenantId, request.streamId, operation).exists) {
        return fail("GE_CYCLE_STORE_NOT_FOUND", operation, "legal hold stream does not exist");
      }
      if (request.action === "place") {
        this.#connection.prepare(`
          INSERT INTO ge_cycle_legal_holds (tenant_id, stream_id, hold_id, placed_at_ms)
          VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, stream_id, hold_id) DO NOTHING
        `, operation).run(request.context.tenantId, request.streamId, request.holdId, now);
      } else {
        this.#connection.prepare(`
          DELETE FROM ge_cycle_legal_holds
          WHERE tenant_id = ? AND stream_id = ? AND hold_id = ?
        `, operation).run(request.context.tenantId, request.streamId, request.holdId);
      }
      return this.#governanceInspection(request.context.tenantId, request.streamId, operation);
    });
  }

  async inspectGovernance(requestValue: CycleStoreReadTailRequest): Promise<CycleStoreGovernanceInspection> {
    const operation = "inspect-governance" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    if (!this.#readTail(request.context.tenantId, request.streamId, operation).exists) {
      return fail("GE_CYCLE_STORE_NOT_FOUND", operation, "governance stream does not exist");
    }
    return this.#governanceInspection(request.context.tenantId, request.streamId, operation);
  }

  async acquireMigrationLock(
    requestValue: CycleStoreAcquireMigrationLockRequest,
  ): Promise<CycleStoreMigrationLock> {
    const operation = "acquire-migration-lock" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      const state = this.#readMigrationState(operation);
      if (request.expectedFencingToken !== state.lastFencingToken) {
        return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "migration fence is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      const expired = state.activeExpiresAtMs !== null && state.activeExpiresAtMs <= now;
      if (request.mode === "takeover") {
        if (state.active === null || !expired) {
          return fail("GE_CYCLE_STORE_MIGRATION_LOCKED", operation, "migration takeover requires an expired lock");
        }
      } else if (state.active !== null) {
        return fail(
          "GE_CYCLE_STORE_MIGRATION_LOCKED",
          operation,
          expired ? "expired migration lock requires takeover" : "migration lock is active",
        );
      }
      if (this.#usedMigrationLockIdExists(request.lockId, operation)) {
        return fail("GE_CYCLE_STORE_MIGRATION_LOCKED", operation, "migration lockId cannot be reused");
      }
      if (state.lastLockEpoch === MAX_SAFE_INTEGER || state.lastFencingToken === MAX_SAFE_INTEGER) {
        return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "migration fence exhausted");
      }
      const expiresAtMs = this.#addDuration(now, request.ttlMs, operation);
      const lock: CycleStoreMigrationLock = Object.freeze({
        lockId: request.lockId,
        ownerId: request.ownerId,
        sourceSchemaVersion: request.sourceSchemaVersion,
        targetSchemaVersion: request.targetSchemaVersion,
        lockEpoch: state.lastLockEpoch + 1,
        fencingToken: state.lastFencingToken + 1,
        acquiredAt: iso(now, operation),
        expiresAt: iso(expiresAtMs, operation),
      });
      const updated = changes(this.#connection.prepare(`
        UPDATE ge_cycle_migration_lock
        SET active_lock_id = ?, active_owner_id = ?, active_source_version = ?,
            active_target_version = ?, active_lock_epoch = ?, active_fencing_token = ?,
            active_acquired_at_ms = ?, active_expires_at_ms = ?,
            last_lock_epoch = ?, last_fencing_token = ?, updated_at_ms = ?
        WHERE singleton = 1 AND last_fencing_token = ?
      `, operation).run(
        lock.lockId,
        lock.ownerId,
        lock.sourceSchemaVersion,
        lock.targetSchemaVersion,
        lock.lockEpoch,
        lock.fencingToken,
        now,
        expiresAtMs,
        lock.lockEpoch,
        lock.fencingToken,
        now,
        state.lastFencingToken,
      ), operation);
      if (updated !== 1) return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "migration lock lost fence CAS");
      this.#connection.prepare(`
        INSERT INTO ge_cycle_used_migration_lock_ids
          (lock_id, lock_epoch, fencing_token, first_used_at_ms)
        VALUES (?, ?, ?, ?)
      `, operation).run(lock.lockId, lock.lockEpoch, lock.fencingToken, now);
      return lock;
    });
  }

  async inspectMigrationLock(
    contextValue: CycleStoreAuthorizationContext,
  ): Promise<CycleStoreMigrationLock | null> {
    const operation = "inspect-migration-lock" as const;
    this.#assertOpen(operation);
    const { context } = cycleStoreAdapterCodec.captureRequest(
      operation,
      contextValue,
      this.#descriptor,
    );
    await this.#authorize(context, operation);
    return this.#readMigrationState(operation).active;
  }

  async releaseMigrationLock(
    requestValue: CycleStoreReleaseMigrationLockRequest,
  ): Promise<CycleStoreMigrationLock | null> {
    const operation = "release-migration-lock" as const;
    this.#assertOpen(operation);
    const request = cycleStoreAdapterCodec.captureRequest(
      operation,
      requestValue,
      this.#descriptor,
    );
    await this.#authorize(request.context, operation);
    return this.#mutate(operation, request.context, request, () => {
      const now = this.#providerNow(operation);
      const state = this.#readMigrationState(operation);
      if (state.active === null
          || state.active.lockId !== request.lockId
          || state.active.ownerId !== request.ownerId
          || state.active.fencingToken !== request.fencingToken) {
        return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "migration release identity is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      const updated = changes(this.#connection.prepare(`
        UPDATE ge_cycle_migration_lock
        SET active_lock_id = NULL, active_owner_id = NULL, active_source_version = NULL,
            active_target_version = NULL, active_lock_epoch = NULL,
            active_fencing_token = NULL, active_acquired_at_ms = NULL,
            active_expires_at_ms = NULL, updated_at_ms = ?
        WHERE singleton = 1 AND active_lock_id = ? AND active_owner_id = ?
          AND active_fencing_token = ?
      `, operation).run(now, request.lockId, request.ownerId, request.fencingToken), operation);
      if (updated !== 1) return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "migration release lost fence CAS");
      return null;
    });
  }

  async #authorize(
    context: CycleStoreAuthorizationContext,
    operation: CycleStoreProviderOperation,
  ): Promise<void> {
    let allowed: unknown;
    try {
      allowed = await this.#authorizeHook(context, operation);
    } catch {
      return fail("GE_CYCLE_STORE_INTERNAL", operation, "provider authorization hook failed");
    }
    if (typeof allowed !== "boolean") {
      return fail("GE_CYCLE_STORE_INTERNAL", operation, "provider authorization hook returned invalid data");
    }
    if (!allowed) return fail("GE_CYCLE_STORE_PERMISSION_DENIED", operation, "provider operation is not authorized");
  }

  #assertOpen(operation: CycleStoreProviderOperation): void {
    if (!this.#connection.isOpen) {
      return fail("GE_CYCLE_STORE_UNAVAILABLE", operation, "SQLite provider is closed");
    }
  }

  #clockCandidate(operation: CycleStoreProviderOperation): number {
    let value: Date;
    try {
      value = this.#nowHook!();
    } catch {
      return fail("GE_CYCLE_STORE_UNAVAILABLE", operation, "provider clock is unavailable");
    }
    const milliseconds = value instanceof Date ? value.getTime() : Number.NaN;
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      return fail("GE_CYCLE_STORE_UNAVAILABLE", operation, "provider clock is invalid");
    }
    return milliseconds;
  }

  #sqliteClockCandidate(operation: CycleStoreProviderOperation): number {
    if (!this.#connection.isTransaction) {
      return fail(
        "GE_CYCLE_STORE_INTERNAL",
        operation,
        "default SQLite provider clock must be read inside a transaction",
      );
    }
    const row = sqliteRow(this.#connection.prepare(`
      SELECT CAST(strftime('%s', 'now') AS INTEGER) * 1000
           + CAST(substr(strftime('%f', 'now'), 4, 3) AS INTEGER)
    `, operation).get(), 1, operation, "SQLite provider clock");
    return sqliteSafeInteger(row[0], 0, MAX_SAFE_INTEGER, operation, "SQLite provider clock");
  }

  #observeNow(operation: CycleStoreProviderOperation, candidate: number): number {
    const row = sqliteRow(
      this.#connection.prepare(
        "SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1",
        operation,
      ).get(),
      1,
      operation,
      "provider clock high-water",
    );
    const highWater = sqliteSafeInteger(row[0], 0, MAX_SAFE_INTEGER, operation, "provider clock high-water");
    const effectiveHighWater = Math.max(highWater, this.#lastObservedNowMs);
    if (candidate < effectiveHighWater) {
      return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "provider clock moved backwards");
    }
    this.#lastObservedNowMs = candidate;
    if (candidate > highWater) {
      const updated = changes(this.#connection.prepare(`
        UPDATE ge_cycle_migration_lock SET updated_at_ms = ?
        WHERE singleton = 1 AND updated_at_ms = ?
      `, operation).run(candidate, highWater), operation);
      if (updated !== 1) return fail("GE_CYCLE_STORE_CONFLICT", operation, "provider clock high-water lost CAS");
    }
    return candidate;
  }

  #providerNow(operation: CycleStoreProviderOperation): number {
    const candidate = this.#nowHook === undefined
      ? this.#sqliteClockCandidate(operation)
      : this.#clockCandidate(operation);
    return this.#observeNow(operation, candidate);
  }

  #addDuration(now: number, duration: number, operation: CycleStoreProviderOperation): number {
    if (now > MAX_SAFE_INTEGER - duration) {
      return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "provider timestamp range is exhausted");
    }
    return now + duration;
  }

  #readTail(
    tenantId: string,
    streamId: string,
    operation: CycleStoreProviderOperation,
  ): CycleStoreTail {
    const raw = this.#connection.prepare(`
      SELECT tail_sequence, tail_record_hash FROM ge_cycle_streams
      WHERE tenant_id = ? AND stream_id = ?
    `, operation).get(tenantId, streamId);
    if (raw === undefined) return missingTail();
    const row = sqliteRow(raw, 2, operation, "stream tail");
    const sequence = sqliteSafeInteger(row[0], -1, MAX_SAFE_INTEGER, operation, "tail sequence");
    const recordHash = sqliteNullableText(row[1], operation, "tail record hash");
    if (sequence === -1 && recordHash === null) return missingTail();
    if (sequence < 0 || recordHash === null) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored stream tail is inconsistent");
    }
    return Object.freeze({ exists: true, sequence, recordHash });
  }

  #recordIdExists(
    tenantId: string,
    recordId: string,
    operation: CycleStoreProviderOperation,
  ): boolean {
    return this.#connection.prepare(`
      SELECT 1 FROM ge_cycle_records WHERE tenant_id = ? AND record_id = ? LIMIT 1
    `, operation).get(tenantId, recordId) !== undefined;
  }

  #mutate<K extends CycleStoreMutationOperation>(
    operation: K,
    context: CycleStoreMutationContext,
    request: CycleStoreCanonicalRequestByOperation[K],
    action: () => CycleStoreLedgerResultByOperation[K],
  ): CycleStoreLedgerResultByOperation[K] {
    const requestHash = cycleStoreAdapterCodec.operationRequestHash(operation, request);
    const outcome = this.#connection.immediate(operation, () => {
      this.#runFault(`provider:${operation}:transaction-reserved`, operation);
      const existing = this.#connection.prepare(`
        SELECT operation_name, request_hash, result_blob, result_hash
        FROM ge_cycle_operations WHERE tenant_id = ? AND operation_id = ?
      `, operation).get(context.tenantId, context.operationId);
      if (operation !== "append") {
        this.#runFault(`provider:${operation}:decision-state-read`, operation);
      }
      if (existing !== undefined) {
        const row = sqliteRow(existing, 4, operation, "operation ledger");
        const storedOperation = sqliteText(row[0], operation, "ledger operation");
        const storedRequestHash = sqliteText(row[1], operation, "ledger request hash");
        if (storedOperation !== operation || storedRequestHash !== requestHash) {
          return fail(
            "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
            operation,
            "operationId was reused with a different canonical request",
          );
        }
        const bytes = sqliteBlob(row[2], operation, "ledger result blob");
        const storedResultHash = sqliteText(row[3], operation, "ledger result hash");
        const decoded = cycleStoreAdapterCodec.decodeLedgerResult(operation, bytes);
        if (canonicalHash(decoded) !== storedResultHash) {
          return fail("GE_CYCLE_STORE_CORRUPTION", operation, "operation ledger result hash drifted");
        }
        return Object.freeze({ resultBytes: Buffer.from(bytes), committed: false });
      }
      const result = action();
      const bytes = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult(operation, result));
      if (bytes.byteLength > MAX_CYCLE_STORE_CHECKPOINT_BYTES) {
        return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "operation ledger result exceeds byte limit");
      }
      const resultHash = canonicalHash(result);
      const committedAtMs = this.#currentHighWater(operation);
      this.#connection.prepare(`
        INSERT INTO ge_cycle_operations
          (tenant_id, operation_id, operation_name, request_hash,
           result_blob, result_hash, committed_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, operation).run(
        context.tenantId,
        context.operationId,
        operation,
        requestHash,
        bytes,
        resultHash,
        committedAtMs,
      );
      this.#runFault(`provider:${operation}:ledger-staged`, operation);
      this.#runFault(`provider:${operation}:before-commit`, operation);
      return Object.freeze({ resultBytes: bytes, committed: true });
    });
    if (outcome.committed) {
      this.#runFault(`provider:${operation}:commit-returned`, operation);
      this.#runFault(`provider:${operation}:after-commit-before-return`, operation);
    }
    return cycleStoreAdapterCodec.decodeLedgerResult(operation, outcome.resultBytes);
  }

  #runFault(
    boundary: `provider:${CycleStoreProviderOperation}:transaction-reserved`
      | `provider:${CycleStoreProviderOperation}:decision-state-read`
      | "provider:append:records-staged"
      | `provider:${CycleStoreProviderOperation}:ledger-staged`
      | `provider:${CycleStoreProviderOperation}:before-commit`
      | `provider:${CycleStoreProviderOperation}:commit-returned`
      | `provider:${CycleStoreProviderOperation}:after-commit-before-return`,
    operation: CycleStoreProviderOperation,
  ): void {
    if (this.#faultHook === undefined) return;
    let result: void | Promise<void>;
    try {
      result = this.#faultHook(boundary);
      if (typeof result === "object" && result !== null && "then" in result) {
        void Promise.resolve(result).catch(() => undefined);
        return fail(
          "GE_CYCLE_STORE_UNAVAILABLE",
          operation,
          "provider fault hook cannot be asynchronous",
          { boundary },
        );
      }
    } catch (error) {
      if (error instanceof CycleStoreProviderError) throw error;
      return fail(
        "GE_CYCLE_STORE_UNAVAILABLE",
        operation,
        "provider acknowledgement is unavailable",
        { boundary },
      );
    }
  }

  #currentHighWater(operation: CycleStoreProviderOperation): number {
    const row = sqliteRow(
      this.#connection.prepare(
        "SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1",
        operation,
      ).get(),
      1,
      operation,
      "provider clock high-water",
    );
    return sqliteSafeInteger(row[0], 0, MAX_SAFE_INTEGER, operation, "provider clock high-water");
  }

  #assertOnlineWriterCompatible(operation: CycleStoreProviderOperation, now: number): void {
    const migration = this.#readMigrationState(operation);
    if (migration.active !== null
        && migration.activeExpiresAtMs !== null
        && migration.activeExpiresAtMs > now) {
      return fail(
        "GE_CYCLE_STORE_MIGRATION_LOCKED",
        operation,
        "online mutation is blocked by an active incompatible migration",
        { migrationFencingToken: migration.active.fencingToken },
      );
    }
  }

  #readLeaseState(
    tenantId: string,
    streamId: string,
    operation: CycleStoreProviderOperation,
  ): StoredLeaseState {
    const raw = this.#connection.prepare(`
      SELECT active_lease_id, active_holder_id, active_lease_epoch, active_fencing_token,
             active_acquired_at_ms, active_expires_at_ms,
             last_lease_epoch, last_fencing_token
      FROM ge_cycle_leases WHERE tenant_id = ? AND stream_id = ?
    `, operation).get(tenantId, streamId);
    if (raw === undefined) {
      return { active: null, activeAcquiredAtMs: null, activeExpiresAtMs: null,
        lastLeaseEpoch: 0, lastFencingToken: 0 };
    }
    const row = sqliteRow(raw, 8, operation, "lease state");
    const leaseId = sqliteNullableText(row[0], operation, "active leaseId");
    const holderId = sqliteNullableText(row[1], operation, "active holderId");
    const leaseEpoch = nullableSafeInteger(row[2], 1, MAX_SAFE_INTEGER, operation, "active lease epoch");
    const fencingToken = nullableSafeInteger(row[3], 1, MAX_SAFE_INTEGER, operation, "active fencing token");
    const acquiredAtMs = nullableSafeInteger(row[4], 0, MAX_SAFE_INTEGER, operation, "active acquired time");
    const expiresAtMs = nullableSafeInteger(row[5], 0, MAX_SAFE_INTEGER, operation, "active expiry time");
    const lastLeaseEpoch = sqliteSafeInteger(row[6], 0, MAX_SAFE_INTEGER, operation, "last lease epoch");
    const lastFencingToken = sqliteSafeInteger(row[7], 0, MAX_SAFE_INTEGER, operation, "last fencing token");
    const nulls = [leaseId, holderId, leaseEpoch, fencingToken, acquiredAtMs, expiresAtMs]
      .filter((value) => value === null).length;
    if (lastLeaseEpoch !== lastFencingToken || (nulls !== 0 && nulls !== 6)) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored lease state is inconsistent");
    }
    if (nulls === 6) {
      return { active: null, activeAcquiredAtMs: null, activeExpiresAtMs: null,
        lastLeaseEpoch, lastFencingToken };
    }
    if (leaseEpoch !== lastLeaseEpoch || fencingToken !== lastFencingToken
        || expiresAtMs! <= acquiredAtMs!) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored active lease is inconsistent");
    }
    return {
      active: Object.freeze({
        leaseId: leaseId!, holderId: holderId!, leaseEpoch: leaseEpoch!,
        fencingToken: fencingToken!, acquiredAt: iso(acquiredAtMs!, operation),
        expiresAt: iso(expiresAtMs!, operation),
      }),
      activeAcquiredAtMs: acquiredAtMs,
      activeExpiresAtMs: expiresAtMs,
      lastLeaseEpoch,
      lastFencingToken,
    };
  }

  #bindingMatches(state: StoredLeaseState, binding: CycleStoreLeaseBinding): boolean {
    return state.active !== null
      && state.active.leaseId === binding.leaseId
      && state.active.holderId === binding.holderId
      && state.active.fencingToken === binding.fencingToken;
  }

  #assertWriteLease(
    tenantId: string,
    streamId: string,
    binding: CycleStoreLeaseBinding | null,
    operation: CycleStoreProviderOperation,
    now: number,
  ): void {
    const state = this.#readLeaseState(tenantId, streamId, operation);
    if (state.lastFencingToken === 0) {
      if (binding !== null) return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "stream has no fenced owner");
      return;
    }
    if (binding === null || !this.#bindingMatches(state, binding)
        || state.activeExpiresAtMs === null || state.activeExpiresAtMs <= now) {
      return fail("GE_CYCLE_STORE_STALE_FENCE", operation, "write lease is stale or inactive", {
        lastFencingToken: state.lastFencingToken,
      });
    }
  }

  #upsertLease(
    tenantId: string,
    streamId: string,
    lease: CycleStoreLease,
    now: number,
    expiresAtMs: number,
    operation: CycleStoreProviderOperation,
  ): void {
    this.#connection.prepare(`
      INSERT INTO ge_cycle_leases
        (tenant_id, stream_id, active_lease_id, active_holder_id,
         active_lease_epoch, active_fencing_token, active_acquired_at_ms,
         active_expires_at_ms, last_lease_epoch, last_fencing_token, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, stream_id) DO UPDATE SET
        active_lease_id = excluded.active_lease_id,
        active_holder_id = excluded.active_holder_id,
        active_lease_epoch = excluded.active_lease_epoch,
        active_fencing_token = excluded.active_fencing_token,
        active_acquired_at_ms = excluded.active_acquired_at_ms,
        active_expires_at_ms = excluded.active_expires_at_ms,
        last_lease_epoch = excluded.last_lease_epoch,
        last_fencing_token = excluded.last_fencing_token,
        updated_at_ms = excluded.updated_at_ms
    `, operation).run(
      tenantId, streamId, lease.leaseId, lease.holderId, lease.leaseEpoch,
      lease.fencingToken, Date.parse(lease.acquiredAt), expiresAtMs,
      lease.leaseEpoch, lease.fencingToken, now,
    );
  }

  #usedLeaseIdExists(
    tenantId: string,
    streamId: string,
    leaseId: string,
    operation: CycleStoreProviderOperation,
  ): boolean {
    return this.#connection.prepare(`
      SELECT 1 FROM ge_cycle_used_lease_ids
      WHERE tenant_id = ? AND stream_id = ? AND lease_id = ?
    `, operation).get(tenantId, streamId, leaseId) !== undefined;
  }

  #leaseInspection(state: StoredLeaseState, now: number): CycleStoreLeaseInspection {
    const status = state.active === null
      ? (state.lastFencingToken === 0 ? "none" : "released")
      : (state.activeExpiresAtMs! <= now ? "expired" : "active");
    return Object.freeze({
      status,
      lease: state.active,
      lastLeaseEpoch: state.lastLeaseEpoch,
      lastFencingToken: state.lastFencingToken,
    });
  }

  #readMigrationState(operation: CycleStoreProviderOperation): StoredMigrationState {
    const row = sqliteRow(this.#connection.prepare(`
      SELECT active_lock_id, active_owner_id, active_source_version, active_target_version,
             active_lock_epoch, active_fencing_token, active_acquired_at_ms,
             active_expires_at_ms, last_lock_epoch, last_fencing_token
      FROM ge_cycle_migration_lock WHERE singleton = 1
    `, operation).get(), 10, operation, "migration lock state");
    const lockId = sqliteNullableText(row[0], operation, "active migration lockId");
    const ownerId = sqliteNullableText(row[1], operation, "active migration ownerId");
    const source = nullableSafeInteger(row[2], 1, MAX_SAFE_INTEGER, operation, "migration source version");
    const target = nullableSafeInteger(row[3], 2, MAX_SAFE_INTEGER, operation, "migration target version");
    const epoch = nullableSafeInteger(row[4], 1, MAX_SAFE_INTEGER, operation, "migration lock epoch");
    const fence = nullableSafeInteger(row[5], 1, MAX_SAFE_INTEGER, operation, "migration fencing token");
    const acquired = nullableSafeInteger(row[6], 0, MAX_SAFE_INTEGER, operation, "migration acquired time");
    const expires = nullableSafeInteger(row[7], 0, MAX_SAFE_INTEGER, operation, "migration expiry time");
    const lastEpoch = sqliteSafeInteger(row[8], 0, MAX_SAFE_INTEGER, operation, "last migration epoch");
    const lastFence = sqliteSafeInteger(row[9], 0, MAX_SAFE_INTEGER, operation, "last migration fence");
    const nulls = [lockId, ownerId, source, target, epoch, fence, acquired, expires]
      .filter((value) => value === null).length;
    if (lastEpoch !== lastFence || (nulls !== 0 && nulls !== 8)) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored migration lock is inconsistent");
    }
    if (nulls === 8) {
      return { active: null, activeAcquiredAtMs: null, activeExpiresAtMs: null,
        lastLockEpoch: lastEpoch, lastFencingToken: lastFence };
    }
    if (target! <= source! || epoch !== lastEpoch || fence !== lastFence || expires! <= acquired!) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored active migration lock is inconsistent");
    }
    return {
      active: Object.freeze({
        lockId: lockId!, ownerId: ownerId!, sourceSchemaVersion: source!,
        targetSchemaVersion: target!, lockEpoch: epoch!, fencingToken: fence!,
        acquiredAt: iso(acquired!, operation), expiresAt: iso(expires!, operation),
      }),
      activeAcquiredAtMs: acquired,
      activeExpiresAtMs: expires,
      lastLockEpoch: lastEpoch,
      lastFencingToken: lastFence,
    };
  }

  #usedMigrationLockIdExists(lockId: string, operation: CycleStoreProviderOperation): boolean {
    return this.#connection.prepare(
      "SELECT 1 FROM ge_cycle_used_migration_lock_ids WHERE lock_id = ?",
      operation,
    ).get(lockId) !== undefined;
  }

  #legalHoldCount(tenantId: string, streamId: string, operation: CycleStoreProviderOperation): number {
    const row = sqliteRow(this.#connection.prepare(`
      SELECT count(*) FROM ge_cycle_legal_holds WHERE tenant_id = ? AND stream_id = ?
    `, operation).get(tenantId, streamId), 1, operation, "legal hold count");
    return sqliteSafeInteger(row[0], 0, MAX_SAFE_INTEGER, operation, "legal hold count");
  }

  #governanceInspection(
    tenantId: string,
    streamId: string,
    operation: CycleStoreProviderOperation,
  ): CycleStoreGovernanceInspection {
    const legalHoldIds = this.#connection.prepare(`
      SELECT hold_id FROM ge_cycle_legal_holds
      WHERE tenant_id = ? AND stream_id = ? ORDER BY hold_id ASC
    `, operation).all(tenantId, streamId).map((raw) => sqliteText(
      sqliteRow(raw, 1, operation, "legal hold")[0],
      operation,
      "holdId",
    ));
    return Object.freeze({
      legalHoldIds: Object.freeze(legalHoldIds),
      retentionMode: "retain-authoritative-history",
      archiveMode: "lossless-before-delete",
      compactionMode: "logical-history-preserving",
    });
  }

  #nextCheckpointRevision(
    tenantId: string,
    scope: string,
    operation: CycleStoreProviderOperation,
  ): number {
    const row = sqliteRow(this.#connection.prepare(`
      SELECT coalesce(max(revision), 0) FROM ge_cycle_checkpoint_revisions
      WHERE tenant_id = ? AND checkpoint_scope = ?
    `, operation).get(tenantId, scope), 1, operation, "checkpoint revision");
    const current = sqliteSafeInteger(row[0], 0, MAX_SAFE_INTEGER, operation, "checkpoint revision");
    if (current === MAX_SAFE_INTEGER) {
      return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "checkpoint revision exhausted");
    }
    return current + 1;
  }

  #checkpointSnapshot(
    request: CycleStoreCanonicalRequestByOperation["list-checkpoints"],
    operation: CycleStoreProviderOperation,
  ): readonly CycleStoreCheckpointSummary[] {
    const stats = sqliteRow(this.#connection.prepare(`
      SELECT count(*), coalesce(sum(length(summary_blob)), 0)
      FROM ge_cycle_checkpoints
      WHERE tenant_id = ? AND checkpoint_scope = ?
    `, operation).get(
      request.context.tenantId,
      request.checkpointScope,
    ), 2, operation, "checkpoint snapshot bounds");
    if (typeof stats[0] !== "bigint" || typeof stats[1] !== "bigint"
        || stats[0] < 0n || stats[1] < 0n) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "checkpoint snapshot bounds are invalid");
    }
    const canonicalArrayBytes = stats[1] + (stats[0] === 0n ? 2n : stats[0] + 1n);
    if (canonicalArrayBytes > BigInt(MAX_CURSOR_BLOB_BYTES)) {
      return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "checkpoint snapshot exceeds byte limit");
    }
    const snapshot = this.#connection.prepare(`
      SELECT checkpoint_scope, checkpoint_id, stream_id, bound_sequence,
             bound_record_hash, created_at, value_hash, value_bytes, summary_blob
      FROM ge_cycle_checkpoints
      WHERE tenant_id = ? AND checkpoint_scope = ?
      ORDER BY bound_sequence DESC, created_at DESC, checkpoint_id ASC
    `, operation).all(request.context.tenantId, request.checkpointScope).map((raw) => (
      this.#decodeCheckpointSummaryRow(raw, operation)
    ));
    return Object.freeze(snapshot);
  }

  #decodeCheckpointRow(
    raw: unknown,
    operation: CycleStoreProviderOperation,
  ): CycleStoreCheckpoint {
    const row = sqliteRow(raw, 11, operation, "checkpoint");
    const checkpointScope = sqliteText(row[0], operation, "checkpoint scope");
    const checkpointId = sqliteText(row[1], operation, "checkpoint ID");
    const streamId = sqliteText(row[2], operation, "checkpoint stream");
    const boundSequence = sqliteSafeInteger(
      row[3], 0, MAX_SAFE_INTEGER, operation, "checkpoint bound sequence",
    );
    const boundRecordHash = sqliteText(row[4], operation, "checkpoint bound record hash");
    const createdAt = sqliteText(row[5], operation, "checkpoint created time");
    const valueHash = sqliteText(row[6], operation, "checkpoint value hash");
    const valueBytes = sqliteSafeInteger(
      row[7],
      1,
      this.#descriptor.limits.maxCheckpointBytes,
      operation,
      "checkpoint value bytes",
    );
    const valueBlob = sqliteBlob(row[8], operation, "checkpoint value blob");
    const checkpoint = cycleStoreAdapterCodec.parseStoredCheckpoint(
      sqliteBlob(row[9], operation, "checkpoint blob"),
      operation,
    );
    const summary = this.#decodeCheckpointSummary(
      sqliteBlob(row[10], operation, "checkpoint summary blob"),
      operation,
    );
    if (checkpoint.checkpointScope !== checkpointScope
        || checkpoint.checkpointId !== checkpointId
        || checkpoint.streamId !== streamId
        || checkpoint.boundSequence !== boundSequence
        || checkpoint.boundRecordHash !== boundRecordHash
        || checkpoint.createdAt !== createdAt
        || checkpoint.valueHash !== valueHash
        || checkpoint.valueBytes !== valueBytes
        || !valueBlob.equals(canonicalBytes(checkpoint.value))
        || !same(summary, checkpointSummary(checkpoint))) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored checkpoint columns drifted");
    }
    return checkpoint;
  }

  #decodeCheckpointSummaryRow(
    raw: unknown,
    operation: CycleStoreProviderOperation,
  ): CycleStoreCheckpointSummary {
    const row = sqliteRow(raw, 9, operation, "checkpoint summary");
    const summary = this.#decodeCheckpointSummary(
      sqliteBlob(row[8], operation, "checkpoint summary blob"),
      operation,
    );
    const boundSequence = sqliteSafeInteger(
      row[3], 0, MAX_SAFE_INTEGER, operation, "checkpoint summary sequence",
    );
    const valueBytes = sqliteSafeInteger(
      row[7],
      1,
      this.#descriptor.limits.maxCheckpointBytes,
      operation,
      "checkpoint summary bytes",
    );
    if (summary.checkpointScope !== sqliteText(row[0], operation, "checkpoint summary scope")
        || summary.checkpointId !== sqliteText(row[1], operation, "checkpoint summary ID")
        || summary.streamId !== sqliteText(row[2], operation, "checkpoint summary stream")
        || summary.boundSequence !== boundSequence
        || summary.boundRecordHash !== sqliteText(row[4], operation, "checkpoint summary tail hash")
        || summary.createdAt !== sqliteText(row[5], operation, "checkpoint summary created time")
        || summary.valueHash !== sqliteText(row[6], operation, "checkpoint summary value hash")
        || summary.valueBytes !== valueBytes) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored checkpoint summary columns drifted");
    }
    return summary;
  }

  #decodeCheckpointSummary(
    bytes: Uint8Array,
    operation: CycleStoreProviderOperation,
  ): CycleStoreCheckpointSummary {
    try {
      return cycleStoreAdapterCodec.decodeLedgerResult("save-checkpoint", bytes);
    } catch {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "stored checkpoint summary is corrupt");
    }
  }

  #createEventCursor(
    request: CycleStoreCanonicalRequestByOperation["read-event-page"],
    snapshotTail: CycleStoreTail,
    nextSequence: number,
    now: number,
    operation: CycleStoreProviderOperation,
  ): string {
    return this.#insertCursor({
      context: request.context,
      kind: "event",
      streamId: request.streamId,
      checkpointScope: null,
      requestScope: {
        contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
        streamId: request.streamId,
        pageSize: request.pageSize,
      },
      pageSize: request.pageSize,
      nextPosition: nextSequence,
      snapshotTail,
      snapshot: snapshotTail,
      now,
      operation,
    });
  }

  #createCheckpointCursor(
    request: CycleStoreCanonicalRequestByOperation["list-checkpoints"],
    snapshot: readonly CycleStoreCheckpointSummary[],
    nextIndex: number,
    now: number,
    operation: CycleStoreProviderOperation,
  ): string {
    return this.#insertCursor({
      context: request.context,
      kind: "checkpoint",
      streamId: null,
      checkpointScope: request.checkpointScope,
      requestScope: {
        contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
        checkpointScope: request.checkpointScope,
        pageSize: request.pageSize,
      },
      pageSize: request.pageSize,
      nextPosition: nextIndex,
      snapshotTail: null,
      snapshot,
      now,
      operation,
    });
  }

  #insertCursor(fields: {
    readonly context: CycleStoreAuthorizationContext;
    readonly kind: "event" | "checkpoint";
    readonly streamId: string | null;
    readonly checkpointScope: string | null;
    readonly requestScope: unknown;
    readonly pageSize: number;
    readonly nextPosition: number;
    readonly snapshotTail: CycleStoreTail | null;
    readonly snapshot: unknown;
    readonly now: number;
    readonly operation: CycleStoreProviderOperation;
  }): string {
    this.#connection.prepare(`
      DELETE FROM ge_cycle_cursors
      WHERE (tenant_id, token_hash) IN (
        SELECT tenant_id, token_hash
        FROM ge_cycle_cursors
        WHERE expires_at_ms <= ?
        ORDER BY expires_at_ms ASC, tenant_id ASC, token_hash ASC
        LIMIT ?
      )
    `, fields.operation).run(fields.now, CURSOR_EXPIRY_CLEANUP_LIMIT);
    const countRow = sqliteRow(this.#connection.prepare(`
      SELECT count(*) FROM ge_cycle_cursors
    `, fields.operation).get(), 1, fields.operation, "cursor count");
    const count = sqliteSafeInteger(countRow[0], 0, MAX_SAFE_INTEGER, fields.operation, "cursor count");
    if (count >= MAX_CYCLE_STORE_CURSOR_COUNT) {
      return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", fields.operation, "cursor quota exceeded");
    }
    const expiresAt = this.#addDuration(fields.now, CYCLE_STORE_CURSOR_TTL_MS, fields.operation);
    const requestScopeBlob = canonicalBytes(fields.requestScope);
    const snapshotBlob = canonicalBytes(fields.snapshot);
    if (requestScopeBlob.byteLength > 1_048_576 || snapshotBlob.byteLength > MAX_CURSOR_BLOB_BYTES) {
      return fail("GE_CYCLE_STORE_QUOTA_EXCEEDED", fields.operation, "cursor snapshot exceeds byte limit");
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = `cursor-${randomBytes(32).toString("hex")}`;
      const tokenHash = canonicalHash(token);
      if (this.#connection.prepare(`
        SELECT 1 FROM ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ?
      `, fields.operation).get(fields.context.tenantId, tokenHash) !== undefined) continue;
      this.#connection.prepare(`
        INSERT INTO ge_cycle_cursors
          (tenant_id, token_hash, kind, principal_hash, authorization_hash,
           stream_id, checkpoint_scope, request_scope_blob, page_size, next_position,
           snapshot_tail_sequence, snapshot_tail_record_hash, descriptor_hash,
           schema_identity_sha256, snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `, fields.operation).run(
        fields.context.tenantId,
        tokenHash,
        fields.kind,
        fields.context.principalHash,
        fields.context.authorizationHash,
        fields.streamId,
        fields.checkpointScope,
        requestScopeBlob,
        fields.pageSize,
        fields.nextPosition,
        fields.snapshotTail?.sequence ?? null,
        fields.snapshotTail?.recordHash ?? null,
        this.#descriptor.descriptorHash,
        this.#schemaIdentitySha256,
        snapshotBlob,
        fields.now,
        expiresAt,
      );
      return token;
    }
    return fail("GE_CYCLE_STORE_INTERNAL", fields.operation, "cursor token allocation failed");
  }

  #consumeEventCursor(
    request: CycleStoreCanonicalRequestByOperation["read-event-page"],
    now: number,
    operation: CycleStoreProviderOperation,
  ): CursorReadOutcome<EventCursorState> {
    const row = this.#readCursor(request.context, request.cursor!, operation);
    if (row === null) return { invalid: true, value: null };
    const [kind, streamId, checkpointScope, pageSize, nextPosition, tailSequence,
      tailHash, requestScope, snapshot, expiresAt, consumedAt] = row;
    if (expiresAt <= now) {
      this.#deleteCursor(request.context.tenantId, request.cursor!, operation);
      return { invalid: true, value: null };
    }
    const expectedScope = canonicalBytes({
      contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
      streamId: request.streamId,
      pageSize: request.pageSize,
    });
    if (kind !== "event" || streamId !== request.streamId || checkpointScope !== null
        || pageSize !== request.pageSize || consumedAt !== null
        || !requestScope.equals(expectedScope) || tailSequence === null) {
      return { invalid: true, value: null };
    }
    const snapshotTail = tail(tailSequence, tailHash, operation);
    if (!snapshot.equals(canonicalBytes(snapshotTail))) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "event cursor snapshot drifted");
    }
    this.#consumeCursor(request.context.tenantId, request.cursor!, now, operation);
    return { invalid: false, value: { nextSequence: nextPosition, snapshotTail } };
  }

  #consumeCheckpointCursor(
    request: CycleStoreCanonicalRequestByOperation["list-checkpoints"],
    now: number,
    operation: CycleStoreProviderOperation,
  ): CursorReadOutcome<CheckpointCursorState> {
    const row = this.#readCursor(request.context, request.cursor!, operation);
    if (row === null) return { invalid: true, value: null };
    const [kind, streamId, checkpointScope, pageSize, nextPosition, tailSequence,
      tailHash, requestScope, snapshotBlob, expiresAt, consumedAt] = row;
    if (expiresAt <= now) {
      this.#deleteCursor(request.context.tenantId, request.cursor!, operation);
      return { invalid: true, value: null };
    }
    const expectedScope = canonicalBytes({
      contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
      checkpointScope: request.checkpointScope,
      pageSize: request.pageSize,
    });
    if (kind !== "checkpoint" || streamId !== null || checkpointScope !== request.checkpointScope
        || pageSize !== request.pageSize || consumedAt !== null
        || tailSequence !== null || tailHash !== null || !requestScope.equals(expectedScope)) {
      return { invalid: true, value: null };
    }
    const decoded = decodeCanonicalBlob(
      snapshotBlob,
      operation,
      "checkpoint cursor snapshot",
      MAX_CURSOR_BLOB_BYTES,
    );
    if (!Array.isArray(decoded) || nextPosition > decoded.length) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "checkpoint cursor snapshot is invalid");
    }
    const snapshot = decoded.map((item) => this.#decodeCheckpointSummary(
      canonicalBytes(item),
      operation,
    ));
    this.#consumeCursor(request.context.tenantId, request.cursor!, now, operation);
    return { invalid: false, value: { nextIndex: nextPosition, snapshot: Object.freeze(snapshot) } };
  }

  #readCursor(
    context: CycleStoreAuthorizationContext,
    token: string,
    operation: CycleStoreProviderOperation,
  ): readonly [
    string, string | null, string | null, number, number, number | null,
    string | null, Buffer, Buffer, number, number | null,
  ] | null {
    const raw = this.#connection.prepare(`
      SELECT kind, principal_hash, authorization_hash, stream_id, checkpoint_scope,
             request_scope_blob, page_size, next_position, snapshot_tail_sequence,
             snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256,
             snapshot_blob, expires_at_ms, consumed_at_ms
      FROM ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ?
    `, operation).get(context.tenantId, canonicalHash(token));
    if (raw === undefined) return null;
    const row = sqliteRow(raw, 15, operation, "cursor");
    const kind = sqliteText(row[0], operation, "cursor kind");
    const principalHash = sqliteText(row[1], operation, "cursor principal");
    const authorizationHash = sqliteText(row[2], operation, "cursor authorization");
    const streamId = sqliteNullableText(row[3], operation, "cursor stream");
    const checkpointScope = sqliteNullableText(row[4], operation, "cursor checkpoint scope");
    const requestScope = sqliteBlob(row[5], operation, "cursor request scope");
    const pageSize = sqliteSafeInteger(row[6], 1, 256, operation, "cursor page size");
    const nextPosition = sqliteSafeInteger(row[7], 0, MAX_SAFE_INTEGER, operation, "cursor position");
    const tailSequence = nullableSafeInteger(row[8], -1, MAX_SAFE_INTEGER, operation, "cursor tail sequence");
    const tailHash = sqliteNullableText(row[9], operation, "cursor tail hash");
    const descriptorHash = sqliteText(row[10], operation, "cursor descriptor");
    const schemaIdentity = sqliteText(row[11], operation, "cursor schema identity");
    const snapshot = sqliteBlob(row[12], operation, "cursor snapshot");
    const expiresAt = sqliteSafeInteger(row[13], 0, MAX_SAFE_INTEGER, operation, "cursor expiry");
    const consumedAt = nullableSafeInteger(row[14], 0, MAX_SAFE_INTEGER, operation, "cursor consumption");
    if (principalHash !== context.principalHash || authorizationHash !== context.authorizationHash
        || descriptorHash !== this.#descriptor.descriptorHash
        || schemaIdentity !== this.#schemaIdentitySha256) return null;
    return [kind, streamId, checkpointScope, pageSize, nextPosition, tailSequence,
      tailHash, requestScope, snapshot, expiresAt, consumedAt];
  }

  #consumeCursor(tenantId: string, token: string, now: number, operation: CycleStoreProviderOperation): void {
    const tokenHash = canonicalHash(token);
    const updated = changes(this.#connection.prepare(`
      UPDATE ge_cycle_cursors SET consumed_at_ms = ?
      WHERE tenant_id = ? AND token_hash = ? AND consumed_at_ms IS NULL
    `, operation).run(now, tenantId, tokenHash), operation);
    if (updated !== 1) return fail("GE_CYCLE_STORE_INVALID_CURSOR", operation, "cursor was already consumed");
    const deleted = changes(this.#connection.prepare(`
      DELETE FROM ge_cycle_cursors
      WHERE tenant_id = ? AND token_hash = ? AND consumed_at_ms = ?
    `, operation).run(tenantId, tokenHash, now), operation);
    if (deleted !== 1) {
      return fail("GE_CYCLE_STORE_CORRUPTION", operation, "consumed cursor cleanup lost identity");
    }
  }

  #deleteCursor(tenantId: string, token: string, operation: CycleStoreProviderOperation): void {
    this.#connection.prepare(
      "DELETE FROM ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ?",
      operation,
    ).run(tenantId, canonicalHash(token));
  }
}
