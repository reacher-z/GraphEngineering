import { Buffer } from "node:buffer";
import {
  canonicalHash,
  canonicalSerialize,
} from "@graph-engineering/core";
import {
  captureBoundedJson,
  hashWithDomain,
} from "./cycle-contract.js";
import { snapshotJson } from "./json.js";
import type { JsonValue } from "./types.js";

export const CYCLE_STORE_PROVIDER_API_VERSION =
  "graphengineering.reacher-z.github.io/cycle-store-providers/v1alpha1" as const;
export const CYCLE_STORE_PROVIDER_CONTRACT_VERSION =
  "cycle-store-provider/v1alpha1" as const;
export const CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN =
  "graph-engineering/cycle-store-provider-descriptor/v1alpha1\0";
export const CYCLE_STORE_RECORD_DOMAIN =
  "graph-engineering/cycle-store-record/v1alpha1\0";
export const CYCLE_STORE_OPERATION_DOMAIN =
  "graph-engineering/cycle-store-operation/v1alpha1\0";

export const MAX_CYCLE_STORE_APPEND_RECORDS = 64;
export const MAX_CYCLE_STORE_RECORD_BYTES = 1_048_576;
export const MAX_CYCLE_STORE_APPEND_BYTES = 8_388_608;
export const MAX_CYCLE_STORE_PAGE_SIZE = 256;
export const MAX_CYCLE_STORE_CHECKPOINT_BYTES = 16_777_216;
export const MAX_CYCLE_STORE_LEASE_TTL_MS = 86_400_000;
export const MAX_CYCLE_STORE_CURSOR_COUNT = 4_096;
export const CYCLE_STORE_CURSOR_TTL_MS = 300_000;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const RFC3339 = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

export const CYCLE_STORE_PROVIDER_OPERATIONS = Object.freeze([
  "describe",
  "inspect-schema",
  "read-tail",
  "append",
  "read-event-page",
  "save-checkpoint",
  "load-checkpoint",
  "list-checkpoints",
  "delete-checkpoint",
  "acquire-lease",
  "renew-lease",
  "release-lease",
  "inspect-lease",
  "set-legal-hold",
  "inspect-governance",
  "acquire-migration-lock",
  "inspect-migration-lock",
  "release-migration-lock",
] as const);

export type CycleStoreProviderOperation =
  typeof CYCLE_STORE_PROVIDER_OPERATIONS[number];

export const CYCLE_STORE_PROVIDER_ERROR_CODES = Object.freeze([
  "GE_CYCLE_STORE_INVALID_ARGUMENT",
  "GE_CYCLE_STORE_INVALID_CURSOR",
  "GE_CYCLE_STORE_NOT_FOUND",
  "GE_CYCLE_STORE_CONFLICT",
  "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
  "GE_CYCLE_STORE_LEASE_CONFLICT",
  "GE_CYCLE_STORE_STALE_FENCE",
  "GE_CYCLE_STORE_UNAVAILABLE",
  "GE_CYCLE_STORE_CORRUPTION",
  "GE_CYCLE_STORE_QUOTA_EXCEEDED",
  "GE_CYCLE_STORE_PERMISSION_DENIED",
  "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
  "GE_CYCLE_STORE_LEGAL_HOLD",
  "GE_CYCLE_STORE_MIGRATION_LOCKED",
  "GE_CYCLE_STORE_INTERNAL",
] as const);

export type CycleStoreProviderErrorCode =
  typeof CYCLE_STORE_PROVIDER_ERROR_CODES[number];

const RETRYABLE_CODES = new Set<CycleStoreProviderErrorCode>([
  "GE_CYCLE_STORE_CONFLICT",
  "GE_CYCLE_STORE_LEASE_CONFLICT",
  "GE_CYCLE_STORE_STALE_FENCE",
  "GE_CYCLE_STORE_UNAVAILABLE",
  "GE_CYCLE_STORE_MIGRATION_LOCKED",
  "GE_CYCLE_STORE_INTERNAL",
]);

export interface SerializedCycleStoreProviderError {
  readonly name: "CycleStoreProviderError";
  readonly code: CycleStoreProviderErrorCode;
  readonly operation: CycleStoreProviderOperation;
  readonly retryable: boolean;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export class CycleStoreProviderError extends Error {
  readonly code: CycleStoreProviderErrorCode;
  readonly operation: CycleStoreProviderOperation;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: CycleStoreProviderErrorCode,
    operation: CycleStoreProviderOperation,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "CycleStoreProviderError";
    this.code = code;
    this.operation = operation;
    this.retryable = RETRYABLE_CODES.has(code);
    this.details = Object.freeze({ ...details });
  }

  toJSON(): SerializedCycleStoreProviderError {
    return {
      name: "CycleStoreProviderError",
      code: this.code,
      operation: this.operation,
      retryable: this.retryable,
      message: this.message,
      details: this.details,
    };
  }
}

export interface CycleStoreProviderLimits {
  readonly maxAppendRecords: number;
  readonly maxRecordBytes: number;
  readonly maxAppendBytes: number;
  readonly maxPageSize: number;
  readonly maxCheckpointBytes: number;
  readonly maxLeaseTtlMs: number;
}

export interface CycleStoreProviderDescriptor {
  readonly apiVersion: typeof CYCLE_STORE_PROVIDER_API_VERSION;
  readonly kind: "CycleStoreProviderDescriptor";
  readonly contractVersion: typeof CYCLE_STORE_PROVIDER_CONTRACT_VERSION;
  readonly providerId: string;
  readonly schemaVersion: number;
  readonly compatibility: {
    readonly minReaderVersion: number;
    readonly maxReaderVersion: number;
    readonly minWriterVersion: number;
    readonly maxWriterVersion: number;
  };
  readonly limits: CycleStoreProviderLimits;
  readonly guarantees: {
    readonly appendAtomicity: "all-or-nothing";
    readonly tailConsistency: "strong";
    readonly pagination: "snapshot-no-skip-no-duplicate";
    readonly checkpointAuthority: "cache-only";
    readonly idempotency: "operation-id-canonical-request";
    readonly leaseClock: "provider-authoritative";
    readonly tenantIsolation: "mandatory";
  };
  readonly capabilities: {
    readonly durability: "process-local" | "durable";
    readonly distributedFencing: boolean;
    readonly snapshotPagination: true;
    readonly checkpointCrud: true;
    readonly legalHold: "reference-state-machine" | "enforced";
    readonly backupRestore: "declared" | "enforced";
    readonly compaction: "logical-history-preserving";
  };
  readonly protection: {
    readonly payloadProtection: "external" | "provider-managed";
    readonly encryptionAtRest: "none" | "provider-managed" | "external";
    readonly rawPayloadObservability: false;
  };
  readonly governance: {
    readonly retention: "descriptor-only" | "enforced";
    readonly archival: "descriptor-only" | "enforced";
    readonly legalHoldBlocksDeletion: true;
    readonly migrationLock: "exclusive-fenced";
    readonly backupIdentity: "content-addressed";
  };
  readonly observability: {
    readonly safeFields: readonly [
      "operation",
      "resultCode",
      "durationBucket",
      "canonicalByteCount",
      "recordCount",
      "pageCount",
      "retryClass",
      "tenantHash",
      "providerId",
    ];
    readonly payloadLabels: false;
    readonly authorizationLabels: false;
  };
  readonly descriptorHash: string;
}

export interface CycleStoreAuthorizationContext {
  readonly tenantId: string;
  readonly principalHash: string;
  readonly authorizationHash: string;
}

export interface CycleStoreMutationContext extends CycleStoreAuthorizationContext {
  readonly operationId: string;
}

export interface CycleStoreTail {
  readonly exists: boolean;
  readonly sequence: number;
  readonly recordHash: string | null;
}

export interface CycleStoreRecord {
  readonly recordId: string;
  readonly sequence: number;
  readonly previousRecordHash: string | null;
  readonly valueHash: string;
  readonly valueBytes: number;
  readonly value: JsonValue;
  readonly recordHash: string;
}

export interface CycleStoreLeaseBinding {
  readonly leaseId: string;
  readonly holderId: string;
  readonly fencingToken: number;
}

export interface CycleStoreLease extends CycleStoreLeaseBinding {
  readonly leaseEpoch: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface CycleStoreLeaseInspection {
  readonly status: "none" | "active" | "expired" | "released";
  readonly lease: CycleStoreLease | null;
  readonly lastLeaseEpoch: number;
  readonly lastFencingToken: number;
}

export interface CycleStoreCheckpoint {
  readonly checkpointScope: string;
  readonly checkpointId: string;
  readonly streamId: string;
  readonly boundSequence: number;
  readonly boundRecordHash: string;
  readonly createdAt: string;
  readonly valueHash: string;
  readonly valueBytes: number;
  readonly value: JsonValue;
}

export interface CycleStoreCheckpointSummary {
  readonly checkpointScope: string;
  readonly checkpointId: string;
  readonly streamId: string;
  readonly boundSequence: number;
  readonly boundRecordHash: string;
  readonly createdAt: string;
  readonly valueHash: string;
  readonly valueBytes: number;
}

export interface CycleStoreEventPage {
  readonly exists: boolean;
  readonly snapshotTail: CycleStoreTail;
  readonly records: readonly CycleStoreRecord[];
  readonly nextCursor: string | null;
}

export interface CycleStoreCheckpointPage {
  readonly checkpoints: readonly CycleStoreCheckpointSummary[];
  readonly nextCursor: string | null;
}

export interface CycleStoreAppendRequest {
  readonly context: CycleStoreMutationContext;
  readonly streamId: string;
  readonly expectedTail: CycleStoreTail;
  readonly lease: CycleStoreLeaseBinding | null;
  readonly records: readonly CycleStoreRecord[];
}

export interface CycleStoreAppendResult {
  readonly tail: CycleStoreTail;
  readonly appendedRecords: number;
}

export interface CycleStoreReadTailRequest {
  readonly context: CycleStoreAuthorizationContext;
  readonly streamId: string;
}

export interface CycleStoreReadEventPageRequest {
  readonly context: CycleStoreAuthorizationContext;
  readonly streamId: string;
  readonly fromSequence: number | null;
  readonly pageSize: number;
  readonly cursor: string | null;
}

export interface CycleStoreSaveCheckpointRequest {
  readonly context: CycleStoreMutationContext;
  readonly checkpoint: CycleStoreCheckpoint;
  readonly lease: CycleStoreLeaseBinding | null;
}

export interface CycleStoreLoadCheckpointRequest {
  readonly context: CycleStoreAuthorizationContext;
  readonly checkpointScope: string;
  readonly checkpointId: string;
}

export interface CycleStoreListCheckpointsRequest {
  readonly context: CycleStoreAuthorizationContext;
  readonly checkpointScope: string;
  readonly pageSize: number;
  readonly cursor: string | null;
}

export interface CycleStoreDeleteCheckpointRequest {
  readonly context: CycleStoreMutationContext;
  readonly checkpointScope: string;
  readonly checkpointId: string;
  readonly expectedValueHash: string | null;
}

export interface CycleStoreDeleteCheckpointResult {
  readonly deleted: boolean;
}

export interface CycleStoreAcquireLeaseRequest {
  readonly context: CycleStoreMutationContext;
  readonly streamId: string;
  readonly leaseId: string;
  readonly holderId: string;
  readonly ttlMs: number;
  readonly mode: "acquire" | "takeover";
  readonly expectedFencingToken: number;
}

export interface CycleStoreRenewLeaseRequest {
  readonly context: CycleStoreMutationContext;
  readonly streamId: string;
  readonly lease: CycleStoreLeaseBinding;
  readonly ttlMs: number;
}

export interface CycleStoreReleaseLeaseRequest {
  readonly context: CycleStoreMutationContext;
  readonly streamId: string;
  readonly lease: CycleStoreLeaseBinding;
}

export interface CycleStoreInspectLeaseRequest {
  readonly context: CycleStoreAuthorizationContext;
  readonly streamId: string;
}

export interface CycleStoreLegalHoldRequest {
  readonly context: CycleStoreMutationContext;
  readonly streamId: string;
  readonly holdId: string;
  readonly action: "place" | "release";
}

export interface CycleStoreGovernanceInspection {
  readonly legalHoldIds: readonly string[];
  readonly retentionMode: "retain-authoritative-history";
  readonly archiveMode: "lossless-before-delete";
  readonly compactionMode: "logical-history-preserving";
}

export interface CycleStoreMigrationLock {
  readonly lockId: string;
  readonly ownerId: string;
  readonly sourceSchemaVersion: number;
  readonly targetSchemaVersion: number;
  readonly lockEpoch: number;
  readonly fencingToken: number;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface CycleStoreAcquireMigrationLockRequest {
  readonly context: CycleStoreMutationContext;
  readonly lockId: string;
  readonly ownerId: string;
  readonly sourceSchemaVersion: number;
  readonly targetSchemaVersion: number;
  readonly ttlMs: number;
  readonly mode: "acquire" | "takeover";
  readonly expectedFencingToken: number;
}

export interface CycleStoreReleaseMigrationLockRequest {
  readonly context: CycleStoreMutationContext;
  readonly lockId: string;
  readonly ownerId: string;
  readonly fencingToken: number;
}

export interface CycleStoreSchemaInspection {
  readonly descriptorHash: string;
  readonly schemaVersion: number;
  readonly minReaderVersion: number;
  readonly maxReaderVersion: number;
  readonly minWriterVersion: number;
  readonly maxWriterVersion: number;
  readonly migrationLock: CycleStoreMigrationLock | null;
}

export interface CycleStoreProvider {
  describe(): Promise<CycleStoreProviderDescriptor>;
  inspectSchema(context: CycleStoreAuthorizationContext): Promise<CycleStoreSchemaInspection>;
  readTail(request: CycleStoreReadTailRequest): Promise<CycleStoreTail>;
  append(request: CycleStoreAppendRequest): Promise<CycleStoreAppendResult>;
  readEventPage(request: CycleStoreReadEventPageRequest): Promise<CycleStoreEventPage>;
  saveCheckpoint(request: CycleStoreSaveCheckpointRequest): Promise<CycleStoreCheckpointSummary>;
  loadCheckpoint(request: CycleStoreLoadCheckpointRequest): Promise<CycleStoreCheckpoint | null>;
  listCheckpoints(request: CycleStoreListCheckpointsRequest): Promise<CycleStoreCheckpointPage>;
  deleteCheckpoint(request: CycleStoreDeleteCheckpointRequest): Promise<CycleStoreDeleteCheckpointResult>;
  acquireLease(request: CycleStoreAcquireLeaseRequest): Promise<CycleStoreLease>;
  renewLease(request: CycleStoreRenewLeaseRequest): Promise<CycleStoreLease>;
  releaseLease(request: CycleStoreReleaseLeaseRequest): Promise<CycleStoreLeaseInspection>;
  inspectLease(request: CycleStoreInspectLeaseRequest): Promise<CycleStoreLeaseInspection>;
  setLegalHold(request: CycleStoreLegalHoldRequest): Promise<CycleStoreGovernanceInspection>;
  inspectGovernance(request: CycleStoreReadTailRequest): Promise<CycleStoreGovernanceInspection>;
  acquireMigrationLock(request: CycleStoreAcquireMigrationLockRequest): Promise<CycleStoreMigrationLock>;
  inspectMigrationLock(context: CycleStoreAuthorizationContext): Promise<CycleStoreMigrationLock | null>;
  releaseMigrationLock(request: CycleStoreReleaseMigrationLockRequest): Promise<CycleStoreMigrationLock | null>;
}

export type CycleStoreAuthorizationHook = (
  context: CycleStoreAuthorizationContext,
  operation: CycleStoreProviderOperation,
) => boolean | Promise<boolean>;

export type CycleStoreProviderFaultHook = (
  boundary: `provider:${CycleStoreProviderOperation}:before-commit`
    | `provider:${CycleStoreProviderOperation}:after-commit-before-return`,
) => void | Promise<void>;

function providerError(
  code: CycleStoreProviderErrorCode,
  operation: CycleStoreProviderOperation,
  message: string,
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new CycleStoreProviderError(code, operation, message, details);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  operation: CycleStoreProviderOperation,
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} must be closed`, {
      actual,
      expected,
    });
  }
}

function identifier(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || value === "." || value === "..") {
    return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} is invalid`);
  }
  return value;
}

function hash(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} is invalid`);
  }
  return value;
}

function integer(
  value: unknown,
  minimum: number,
  maximum: number,
  operation: CycleStoreProviderOperation,
  label: string,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} is outside bounds`);
  }
  return value as number;
}

function timestamp(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): string {
  if (typeof value !== "string" || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) {
    return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} is invalid`);
  }
  return value;
}

function captureObject(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
  maximumBytes = MAX_CYCLE_STORE_APPEND_BYTES,
): Record<string, unknown> {
  try {
    const captured = captureBoundedJson(value, maximumBytes).value;
    if (!isRecord(captured)) {
      return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} must be an object`);
    }
    return captured;
  } catch (error) {
    if (error instanceof CycleStoreProviderError) throw error;
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      operation,
      `${label} is not bounded portable JSON`,
    );
  }
}

function parseAuthorizationContext(
  value: unknown,
  operation: CycleStoreProviderOperation,
): CycleStoreAuthorizationContext {
  const context = isRecord(value)
    ? value
    : providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "authorization context must be an object");
  exactKeys(context, ["tenantId", "principalHash", "authorizationHash"], operation, "authorization context");
  return Object.freeze({
    tenantId: identifier(context.tenantId, operation, "tenantId"),
    principalHash: hash(context.principalHash, operation, "principalHash"),
    authorizationHash: hash(context.authorizationHash, operation, "authorizationHash"),
  });
}

function parseMutationContext(
  value: unknown,
  operation: CycleStoreProviderOperation,
): CycleStoreMutationContext {
  const context = isRecord(value)
    ? value
    : providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "mutation context must be an object");
  exactKeys(
    context,
    ["tenantId", "principalHash", "authorizationHash", "operationId"],
    operation,
    "mutation context",
  );
  return Object.freeze({
    tenantId: identifier(context.tenantId, operation, "tenantId"),
    principalHash: hash(context.principalHash, operation, "principalHash"),
    authorizationHash: hash(context.authorizationHash, operation, "authorizationHash"),
    operationId: identifier(context.operationId, operation, "operationId"),
  });
}

function parseTail(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): CycleStoreTail {
  const tail = isRecord(value)
    ? value
    : providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} must be an object`);
  exactKeys(tail, ["exists", "sequence", "recordHash"], operation, label);
  if (typeof tail.exists !== "boolean") {
    providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label}.exists is invalid`);
  }
  const sequence = integer(tail.sequence, -1, Number.MAX_SAFE_INTEGER, operation, `${label}.sequence`);
  const recordHash = tail.recordHash === null ? null : hash(tail.recordHash, operation, `${label}.recordHash`);
  if ((tail.exists === false && (sequence !== -1 || recordHash !== null))
      || (tail.exists === true && (sequence < 0 || recordHash === null))) {
    providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} is inconsistent`);
  }
  return Object.freeze({ exists: tail.exists, sequence, recordHash });
}

function emptyTail(): CycleStoreTail {
  return Object.freeze({ exists: false, sequence: -1, recordHash: null });
}

function tailOf(records: readonly CycleStoreRecord[]): CycleStoreTail {
  const last = records.at(-1);
  return last === undefined
    ? emptyTail()
    : Object.freeze({ exists: true, sequence: last.sequence, recordHash: last.recordHash });
}

function same(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function clone<T>(value: T): T {
  return snapshotJson(value) as T;
}

export function createCycleStoreRecord(fields: {
  readonly recordId: string;
  readonly sequence: number;
  readonly previousRecordHash: string | null;
  readonly value: unknown;
}): CycleStoreRecord {
  const operation: CycleStoreProviderOperation = "append";
  const recordId = identifier(fields.recordId, operation, "recordId");
  const sequence = integer(fields.sequence, 0, Number.MAX_SAFE_INTEGER, operation, "sequence");
  const previousRecordHash = fields.previousRecordHash === null
    ? null
    : hash(fields.previousRecordHash, operation, "previousRecordHash");
  if ((sequence === 0) !== (previousRecordHash === null)) {
    providerError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      operation,
      "record sequence and previous hash are inconsistent",
    );
  }
  const captured = captureBoundedJson(fields.value, MAX_CYCLE_STORE_RECORD_BYTES);
  const valueBytes = Buffer.byteLength(captured.canonicalJson, "utf8");
  const body = {
    recordId,
    sequence,
    previousRecordHash,
    valueHash: canonicalHash(captured.value),
    valueBytes,
    value: captured.value,
  };
  return Object.freeze({
    ...body,
    recordHash: hashWithDomain(CYCLE_STORE_RECORD_DOMAIN, body),
  });
}

function parseRecord(value: unknown, operation: CycleStoreProviderOperation): CycleStoreRecord {
  const raw = isRecord(value)
    ? value
    : providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "record must be an object");
  exactKeys(
    raw,
    ["recordId", "sequence", "previousRecordHash", "valueHash", "valueBytes", "value", "recordHash"],
    operation,
    "record",
  );
  const expected = createCycleStoreRecord({
    recordId: raw.recordId as string,
    sequence: raw.sequence as number,
    previousRecordHash: raw.previousRecordHash as string | null,
    value: raw.value,
  });
  if (!same(expected, raw)) {
    providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "record hash or byte identity drifted");
  }
  return expected;
}

function descriptorBody(providerId: string) {
  return {
    apiVersion: CYCLE_STORE_PROVIDER_API_VERSION,
    kind: "CycleStoreProviderDescriptor" as const,
    contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
    providerId,
    schemaVersion: 1,
    compatibility: {
      minReaderVersion: 1,
      maxReaderVersion: 1,
      minWriterVersion: 1,
      maxWriterVersion: 1,
    },
    limits: {
      maxAppendRecords: MAX_CYCLE_STORE_APPEND_RECORDS,
      maxRecordBytes: MAX_CYCLE_STORE_RECORD_BYTES,
      maxAppendBytes: MAX_CYCLE_STORE_APPEND_BYTES,
      maxPageSize: MAX_CYCLE_STORE_PAGE_SIZE,
      maxCheckpointBytes: MAX_CYCLE_STORE_CHECKPOINT_BYTES,
      maxLeaseTtlMs: MAX_CYCLE_STORE_LEASE_TTL_MS,
    },
    guarantees: {
      appendAtomicity: "all-or-nothing" as const,
      tailConsistency: "strong" as const,
      pagination: "snapshot-no-skip-no-duplicate" as const,
      checkpointAuthority: "cache-only" as const,
      idempotency: "operation-id-canonical-request" as const,
      leaseClock: "provider-authoritative" as const,
      tenantIsolation: "mandatory" as const,
    },
    capabilities: {
      durability: "process-local" as const,
      distributedFencing: false,
      snapshotPagination: true as const,
      checkpointCrud: true as const,
      legalHold: "reference-state-machine" as const,
      backupRestore: "declared" as const,
      compaction: "logical-history-preserving" as const,
    },
    protection: {
      payloadProtection: "external" as const,
      encryptionAtRest: "none" as const,
      rawPayloadObservability: false as const,
    },
    governance: {
      retention: "descriptor-only" as const,
      archival: "descriptor-only" as const,
      legalHoldBlocksDeletion: true as const,
      migrationLock: "exclusive-fenced" as const,
      backupIdentity: "content-addressed" as const,
    },
    observability: {
      safeFields: [
        "operation",
        "resultCode",
        "durationBucket",
        "canonicalByteCount",
        "recordCount",
        "pageCount",
        "retryClass",
        "tenantHash",
        "providerId",
      ] as const,
      payloadLabels: false as const,
      authorizationLabels: false as const,
    },
  };
}

export function createReferenceCycleStoreProviderDescriptor(
  providerId = "memory-reference",
): CycleStoreProviderDescriptor {
  const safeProviderId = identifier(providerId, "describe", "providerId");
  const body = descriptorBody(safeProviderId);
  return validateCycleStoreProviderDescriptor({
    ...body,
    descriptorHash: hashWithDomain(CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body),
  });
}

export function validateCycleStoreProviderDescriptor(
  value: unknown,
): CycleStoreProviderDescriptor {
  const operation: CycleStoreProviderOperation = "describe";
  const raw = captureObject(value, operation, "provider descriptor", MAX_CYCLE_STORE_RECORD_BYTES);
  if (raw.apiVersion !== CYCLE_STORE_PROVIDER_API_VERSION
      || raw.contractVersion !== CYCLE_STORE_PROVIDER_CONTRACT_VERSION) {
    providerError(
      "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
      operation,
      "provider descriptor version is unsupported",
    );
  }
  const referenceKeys = Object.keys(descriptorBody("memory-reference"));
  exactKeys(raw, [...referenceKeys, "descriptorHash"], operation, "provider descriptor");
  if (raw.kind !== "CycleStoreProviderDescriptor") {
    providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "provider descriptor kind is invalid");
  }
  const providerId = identifier(raw.providerId, operation, "providerId");
  const schemaVersion = integer(
    raw.schemaVersion,
    1,
    Number.MAX_SAFE_INTEGER,
    operation,
    "schemaVersion",
  );

  const section = (
    sectionValue: unknown,
    keys: readonly string[],
    label: string,
  ): Record<string, unknown> => {
    if (!isRecord(sectionValue)) {
      return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} must be an object`);
    }
    exactKeys(sectionValue, keys, operation, label);
    return sectionValue;
  };
  const choice = <T extends string | boolean>(
    choiceValue: unknown,
    allowed: readonly T[],
    label: string,
  ): T => {
    if (!allowed.includes(choiceValue as T)) {
      return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} is invalid`);
    }
    return choiceValue as T;
  };
  const limit = (limitValue: unknown, ceiling: number, label: string): number => {
    if (!Number.isSafeInteger(limitValue) || (limitValue as number) < 1) {
      return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, `${label} is outside bounds`);
    }
    if ((limitValue as number) > ceiling) {
      return providerError(
        "GE_CYCLE_STORE_QUOTA_EXCEEDED",
        operation,
        `${label} exceeds the contract ceiling`,
      );
    }
    return limitValue as number;
  };

  const compatibilityRaw = section(
    raw.compatibility,
    ["minReaderVersion", "maxReaderVersion", "minWriterVersion", "maxWriterVersion"],
    "compatibility",
  );
  const compatibility = {
    minReaderVersion: integer(
      compatibilityRaw.minReaderVersion, 1, Number.MAX_SAFE_INTEGER, operation, "minReaderVersion",
    ),
    maxReaderVersion: integer(
      compatibilityRaw.maxReaderVersion, 1, Number.MAX_SAFE_INTEGER, operation, "maxReaderVersion",
    ),
    minWriterVersion: integer(
      compatibilityRaw.minWriterVersion, 1, Number.MAX_SAFE_INTEGER, operation, "minWriterVersion",
    ),
    maxWriterVersion: integer(
      compatibilityRaw.maxWriterVersion, 1, Number.MAX_SAFE_INTEGER, operation, "maxWriterVersion",
    ),
  };
  if (compatibility.minReaderVersion > schemaVersion
      || compatibility.maxReaderVersion < schemaVersion
      || compatibility.minWriterVersion > schemaVersion
      || compatibility.maxWriterVersion < schemaVersion) {
    providerError(
      "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
      operation,
      "provider schema version is outside its compatibility window",
    );
  }

  const limitsRaw = section(
    raw.limits,
    [
      "maxAppendRecords",
      "maxRecordBytes",
      "maxAppendBytes",
      "maxPageSize",
      "maxCheckpointBytes",
      "maxLeaseTtlMs",
    ],
    "limits",
  );
  const limits: CycleStoreProviderLimits = {
    maxAppendRecords: limit(
      limitsRaw.maxAppendRecords, MAX_CYCLE_STORE_APPEND_RECORDS, "maxAppendRecords",
    ),
    maxRecordBytes: limit(limitsRaw.maxRecordBytes, MAX_CYCLE_STORE_RECORD_BYTES, "maxRecordBytes"),
    maxAppendBytes: limit(limitsRaw.maxAppendBytes, MAX_CYCLE_STORE_APPEND_BYTES, "maxAppendBytes"),
    maxPageSize: limit(limitsRaw.maxPageSize, MAX_CYCLE_STORE_PAGE_SIZE, "maxPageSize"),
    maxCheckpointBytes: limit(
      limitsRaw.maxCheckpointBytes, MAX_CYCLE_STORE_CHECKPOINT_BYTES, "maxCheckpointBytes",
    ),
    maxLeaseTtlMs: limit(
      limitsRaw.maxLeaseTtlMs, MAX_CYCLE_STORE_LEASE_TTL_MS, "maxLeaseTtlMs",
    ),
  };

  const expectedGuarantees = descriptorBody(providerId).guarantees;
  const guaranteesRaw = section(raw.guarantees, Object.keys(expectedGuarantees), "guarantees");
  if (!same(guaranteesRaw, expectedGuarantees)) {
    providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "provider guarantees are invalid");
  }

  const capabilitiesRaw = section(
    raw.capabilities,
    [
      "durability",
      "distributedFencing",
      "snapshotPagination",
      "checkpointCrud",
      "legalHold",
      "backupRestore",
      "compaction",
    ],
    "capabilities",
  );
  const capabilities: CycleStoreProviderDescriptor["capabilities"] = {
    durability: choice(capabilitiesRaw.durability, ["process-local", "durable"], "durability"),
    distributedFencing: choice(
      capabilitiesRaw.distributedFencing, [false, true], "distributedFencing",
    ),
    snapshotPagination: choice(capabilitiesRaw.snapshotPagination, [true], "snapshotPagination"),
    checkpointCrud: choice(capabilitiesRaw.checkpointCrud, [true], "checkpointCrud"),
    legalHold: choice(
      capabilitiesRaw.legalHold, ["reference-state-machine", "enforced"], "legalHold",
    ),
    backupRestore: choice(capabilitiesRaw.backupRestore, ["declared", "enforced"], "backupRestore"),
    compaction: choice(
      capabilitiesRaw.compaction, ["logical-history-preserving"], "compaction",
    ),
  };

  const protectionRaw = section(
    raw.protection,
    ["payloadProtection", "encryptionAtRest", "rawPayloadObservability"],
    "protection",
  );
  const protection: CycleStoreProviderDescriptor["protection"] = {
    payloadProtection: choice(
      protectionRaw.payloadProtection, ["external", "provider-managed"], "payloadProtection",
    ),
    encryptionAtRest: choice(
      protectionRaw.encryptionAtRest,
      ["none", "provider-managed", "external"],
      "encryptionAtRest",
    ),
    rawPayloadObservability: choice(
      protectionRaw.rawPayloadObservability, [false], "rawPayloadObservability",
    ),
  };

  const governanceRaw = section(
    raw.governance,
    ["retention", "archival", "legalHoldBlocksDeletion", "migrationLock", "backupIdentity"],
    "governance",
  );
  const governance: CycleStoreProviderDescriptor["governance"] = {
    retention: choice(governanceRaw.retention, ["descriptor-only", "enforced"], "retention"),
    archival: choice(governanceRaw.archival, ["descriptor-only", "enforced"], "archival"),
    legalHoldBlocksDeletion: choice(
      governanceRaw.legalHoldBlocksDeletion, [true], "legalHoldBlocksDeletion",
    ),
    migrationLock: choice(governanceRaw.migrationLock, ["exclusive-fenced"], "migrationLock"),
    backupIdentity: choice(governanceRaw.backupIdentity, ["content-addressed"], "backupIdentity"),
  };

  const expectedObservability = descriptorBody(providerId).observability;
  const observabilityRaw = section(
    raw.observability,
    Object.keys(expectedObservability),
    "observability",
  );
  if (!same(observabilityRaw, expectedObservability)) {
    providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "observability declaration is invalid");
  }

  const body: Omit<CycleStoreProviderDescriptor, "descriptorHash"> = {
    apiVersion: CYCLE_STORE_PROVIDER_API_VERSION,
    kind: "CycleStoreProviderDescriptor",
    contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
    providerId,
    schemaVersion,
    compatibility,
    limits,
    guarantees: expectedGuarantees,
    capabilities,
    protection,
    governance,
    observability: expectedObservability,
  };
  const declaredHash = hash(raw.descriptorHash, operation, "descriptorHash");
  if (hashWithDomain(CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body) !== declaredHash) {
    providerError("GE_CYCLE_STORE_CORRUPTION", operation, "provider descriptor hash drifted");
  }
  return clone({ ...body, descriptorHash: declaredHash });
}

export function createCycleStoreCheckpoint(fields: {
  readonly checkpointScope: string;
  readonly checkpointId: string;
  readonly streamId: string;
  readonly boundSequence: number;
  readonly boundRecordHash: string;
  readonly createdAt: string;
  readonly value: unknown;
}): CycleStoreCheckpoint {
  const operation: CycleStoreProviderOperation = "save-checkpoint";
  const captured = captureBoundedJson(fields.value, MAX_CYCLE_STORE_CHECKPOINT_BYTES);
  return Object.freeze({
    checkpointScope: identifier(fields.checkpointScope, operation, "checkpointScope"),
    checkpointId: identifier(fields.checkpointId, operation, "checkpointId"),
    streamId: identifier(fields.streamId, operation, "streamId"),
    boundSequence: integer(
      fields.boundSequence,
      0,
      Number.MAX_SAFE_INTEGER,
      operation,
      "boundSequence",
    ),
    boundRecordHash: hash(fields.boundRecordHash, operation, "boundRecordHash"),
    createdAt: timestamp(fields.createdAt, operation, "createdAt"),
    valueHash: canonicalHash(captured.value),
    valueBytes: Buffer.byteLength(captured.canonicalJson, "utf8"),
    value: captured.value,
  });
}

function parseCheckpoint(
  value: unknown,
  operation: CycleStoreProviderOperation,
): CycleStoreCheckpoint {
  const checkpoint = isRecord(value)
    ? value
    : providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "checkpoint must be an object");
  exactKeys(
    checkpoint,
    [
      "checkpointScope",
      "checkpointId",
      "streamId",
      "boundSequence",
      "boundRecordHash",
      "createdAt",
      "valueHash",
      "valueBytes",
      "value",
    ],
    operation,
    "checkpoint",
  );
  const expected = createCycleStoreCheckpoint({
    checkpointScope: checkpoint.checkpointScope as string,
    checkpointId: checkpoint.checkpointId as string,
    streamId: checkpoint.streamId as string,
    boundSequence: checkpoint.boundSequence as number,
    boundRecordHash: checkpoint.boundRecordHash as string,
    createdAt: checkpoint.createdAt as string,
    value: checkpoint.value,
  });
  if (!same(checkpoint, expected)) {
    providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "checkpoint hash or byte identity drifted");
  }
  return expected;
}

interface IdempotencyEntry {
  readonly operation: CycleStoreProviderOperation;
  readonly requestHash: string;
  readonly result: JsonValue;
}

interface LeaseState {
  readonly active: CycleStoreLease | null;
  readonly lastLeaseEpoch: number;
  readonly lastFencingToken: number;
  readonly usedLeaseIds: ReadonlySet<string>;
}

interface EventCursorState {
  readonly kind: "events";
  readonly contractVersion: typeof CYCLE_STORE_PROVIDER_CONTRACT_VERSION;
  readonly descriptorHash: string;
  readonly schemaVersion: number;
  readonly context: CycleStoreAuthorizationContext;
  readonly streamId: string;
  readonly pageSize: number;
  readonly nextSequence: number;
  readonly snapshotTail: CycleStoreTail;
  readonly expiresAtMs: number;
}

interface CheckpointCursorState {
  readonly kind: "checkpoints";
  readonly contractVersion: typeof CYCLE_STORE_PROVIDER_CONTRACT_VERSION;
  readonly descriptorHash: string;
  readonly schemaVersion: number;
  readonly context: CycleStoreAuthorizationContext;
  readonly checkpointScope: string;
  readonly pageSize: number;
  readonly nextIndex: number;
  readonly snapshot: readonly CycleStoreCheckpointSummary[];
  readonly expiresAtMs: number;
}

type CursorState = EventCursorState | CheckpointCursorState;

interface MigrationState {
  readonly active: CycleStoreMigrationLock | null;
  readonly lastEpoch: number;
  readonly lastFencingToken: number;
  readonly usedLockIds: ReadonlySet<string>;
}

export interface MemoryCycleStoreProviderOptions {
  readonly providerId?: string;
  readonly initialTime?: string;
  readonly now?: () => Date;
  readonly authorize?: CycleStoreAuthorizationHook;
  readonly faultHook?: CycleStoreProviderFaultHook;
}

function parseLeaseBinding(
  value: unknown,
  operation: CycleStoreProviderOperation,
): CycleStoreLeaseBinding {
  const lease = isRecord(value)
    ? value
    : providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "lease binding must be an object");
  exactKeys(lease, ["leaseId", "holderId", "fencingToken"], operation, "lease binding");
  return Object.freeze({
    leaseId: identifier(lease.leaseId, operation, "leaseId"),
    holderId: identifier(lease.holderId, operation, "holderId"),
    fencingToken: integer(
      lease.fencingToken,
      1,
      Number.MAX_SAFE_INTEGER,
      operation,
      "fencingToken",
    ),
  });
}

function parseCursorToken(
  value: unknown,
  operation: CycleStoreProviderOperation,
): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    return providerError("GE_CYCLE_STORE_INVALID_CURSOR", operation, "cursor token is malformed");
  }
  return value;
}

function checkpointSummary(checkpoint: CycleStoreCheckpoint): CycleStoreCheckpointSummary {
  const { value: _value, ...summary } = checkpoint;
  return Object.freeze(summary);
}

/**
 * Deterministic executable oracle for the v1alpha1 provider contract.
 *
 * It is intentionally process-local and non-durable. Database adapters use the
 * interface and conformance behavior, never this class's maps or lock.
 */
export class MemoryCycleStoreProvider implements CycleStoreProvider {
  readonly #descriptor: CycleStoreProviderDescriptor;
  readonly #authorizeHook: CycleStoreAuthorizationHook;
  readonly #faultHook: CycleStoreProviderFaultHook | undefined;
  readonly #externalNow: (() => Date) | undefined;
  #manualNowMs: number;
  #lastObservedNowMs: number;
  #lockTail: Promise<void> = Promise.resolve();
  #records = new Map<string, readonly CycleStoreRecord[]>();
  #recordIds = new Map<string, string>();
  #checkpoints = new Map<string, CycleStoreCheckpoint>();
  #leases = new Map<string, LeaseState>();
  #idempotency = new Map<string, IdempotencyEntry>();
  #cursors = new Map<string, CursorState>();
  #cursorCounter = 0;
  #legalHolds = new Map<string, ReadonlySet<string>>();
  #migration: MigrationState = {
    active: null,
    lastEpoch: 0,
    lastFencingToken: 0,
    usedLockIds: new Set(),
  };
  #injectedFailures = new Map<CycleStoreProviderOperation, CycleStoreProviderErrorCode>();

  constructor(options: MemoryCycleStoreProviderOptions = {}) {
    this.#descriptor = createReferenceCycleStoreProviderDescriptor(
      options.providerId ?? "memory-reference",
    );
    this.#authorizeHook = options.authorize ?? (() => true);
    this.#faultHook = options.faultHook;
    this.#externalNow = options.now;
    const initial = options.initialTime ?? "2026-07-27T00:00:00Z";
    timestamp(initial, "describe", "initialTime");
    this.#manualNowMs = Date.parse(initial);
    this.#lastObservedNowMs = this.#manualNowMs;
  }

  async #locked<T>(action: () => T | Promise<T>): Promise<T> {
    const previous = this.#lockTail;
    let release!: () => void;
    this.#lockTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await action();
    } finally {
      release();
    }
  }

  #now(operation: CycleStoreProviderOperation): number {
    const value = this.#externalNow?.() ?? new Date(this.#manualNowMs);
    const milliseconds = value.getTime();
    if (!Number.isFinite(milliseconds)) {
      return providerError("GE_CYCLE_STORE_UNAVAILABLE", operation, "provider clock is invalid");
    }
    if (milliseconds < this.#lastObservedNowMs) {
      return providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "provider clock moved backwards");
    }
    this.#lastObservedNowMs = milliseconds;
    return milliseconds;
  }

  async #authorize(
    context: CycleStoreAuthorizationContext,
    operation: CycleStoreProviderOperation,
  ): Promise<void> {
    let allowed: boolean;
    try {
      allowed = await this.#authorizeHook(context, operation);
    } catch {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_INTERNAL",
        operation,
        "provider authorization hook failed",
      );
    }
    if (!allowed) {
      providerError(
        "GE_CYCLE_STORE_PERMISSION_DENIED",
        operation,
        "provider operation is not authorized",
      );
    }
  }

  #maybeFail(operation: CycleStoreProviderOperation): void {
    const code = this.#injectedFailures.get(operation);
    if (code === undefined) return;
    this.#injectedFailures.delete(operation);
    providerError(code, operation, "injected provider failure");
  }

  async #runFault(
    boundary: `provider:${CycleStoreProviderOperation}:before-commit`
      | `provider:${CycleStoreProviderOperation}:after-commit-before-return`,
    operation: CycleStoreProviderOperation,
  ): Promise<void> {
    if (this.#faultHook === undefined) return;
    try {
      await this.#faultHook(boundary);
    } catch (error) {
      if (error instanceof CycleStoreProviderError) throw error;
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        operation,
        "provider acknowledgement is unavailable",
        { boundary },
      );
    }
  }

  async #mutate<T>(
    operation: CycleStoreProviderOperation,
    context: CycleStoreMutationContext,
    canonicalRequest: unknown,
    action: () => T,
  ): Promise<T> {
    await this.#authorize(context, operation);
    return this.#locked(async () => {
      this.#maybeFail(operation);
      const ledgerKey = `${context.tenantId}\0${context.operationId}`;
      const requestHash = hashWithDomain(CYCLE_STORE_OPERATION_DOMAIN, {
        operation,
        request: canonicalRequest,
      });
      const existing = this.#idempotency.get(ledgerKey);
      if (existing !== undefined) {
        if (existing.operation !== operation || existing.requestHash !== requestHash) {
          providerError(
            "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
            operation,
            "operationId was reused with a different canonical request",
          );
        }
        return clone(existing.result) as T;
      }
      await this.#runFault(`provider:${operation}:before-commit`, operation);
      const result = action();
      const capturedResult = snapshotJson(result);
      this.#idempotency.set(ledgerKey, {
        operation,
        requestHash,
        result: capturedResult,
      });
      await this.#runFault(`provider:${operation}:after-commit-before-return`, operation);
      return clone(capturedResult) as T;
    });
  }

  #streamKey(tenantId: string, streamId: string): string {
    return `${tenantId}\0${streamId}`;
  }

  #recordKey(tenantId: string, recordId: string): string {
    return `${tenantId}\0${recordId}`;
  }

  #checkpointKey(tenantId: string, scope: string, checkpointId: string): string {
    return `${tenantId}\0${scope}\0${checkpointId}`;
  }

  #leaseState(tenantId: string, streamId: string): LeaseState {
    return this.#leases.get(this.#streamKey(tenantId, streamId)) ?? {
      active: null,
      lastLeaseEpoch: 0,
      lastFencingToken: 0,
      usedLeaseIds: new Set(),
    };
  }

  #assertWriteLease(
    tenantId: string,
    streamId: string,
    binding: CycleStoreLeaseBinding | null,
    operation: CycleStoreProviderOperation,
  ): void {
    const state = this.#leaseState(tenantId, streamId);
    if (state.lastFencingToken === 0) {
      if (binding !== null) {
        providerError("GE_CYCLE_STORE_STALE_FENCE", operation, "stream has no fenced owner");
      }
      return;
    }
    const active = state.active;
    const now = this.#now(operation);
    if (active === null || Date.parse(active.expiresAt) <= now || binding === null
        || binding.leaseId !== active.leaseId || binding.holderId !== active.holderId
        || binding.fencingToken !== active.fencingToken) {
      providerError("GE_CYCLE_STORE_STALE_FENCE", operation, "write lease is stale or inactive", {
        lastFencingToken: state.lastFencingToken,
      });
    }
  }

  #assertOnlineWriterCompatible(operation: CycleStoreProviderOperation): void {
    const active = this.#migration.active;
    if (active !== null && Date.parse(active.expiresAt) > this.#now(operation)) {
      providerError(
        "GE_CYCLE_STORE_MIGRATION_LOCKED",
        operation,
        "online mutation is blocked by an active incompatible migration",
        { migrationFencingToken: active.fencingToken },
      );
    }
  }

  #newCursor(state: Omit<EventCursorState, "expiresAtMs">
    | Omit<CheckpointCursorState, "expiresAtMs">, operation: CycleStoreProviderOperation): string {
    if (this.#cursors.size >= MAX_CYCLE_STORE_CURSOR_COUNT) {
      return providerError("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "cursor quota exceeded");
    }
    this.#cursorCounter += 1;
    const cursor = `cursor-${this.#cursorCounter.toString().padStart(8, "0")}`;
    this.#cursors.set(cursor, {
      ...state,
      expiresAtMs: this.#now(operation) + CYCLE_STORE_CURSOR_TTL_MS,
    } as CursorState);
    return cursor;
  }

  async describe(): Promise<CycleStoreProviderDescriptor> {
    return clone(this.#descriptor);
  }

  async inspectSchema(
    contextValue: CycleStoreAuthorizationContext,
  ): Promise<CycleStoreSchemaInspection> {
    const operation: CycleStoreProviderOperation = "inspect-schema";
    const captured = captureObject({ context: contextValue }, operation, "schema request");
    exactKeys(captured, ["context"], operation, "schema request");
    const context = parseAuthorizationContext(captured.context, operation);
    await this.#authorize(context, operation);
    return this.#locked(() => {
      this.#maybeFail(operation);
      const compatibility = this.#descriptor.compatibility;
      return clone({
        descriptorHash: this.#descriptor.descriptorHash,
        schemaVersion: this.#descriptor.schemaVersion,
        minReaderVersion: compatibility.minReaderVersion,
        maxReaderVersion: compatibility.maxReaderVersion,
        minWriterVersion: compatibility.minWriterVersion,
        maxWriterVersion: compatibility.maxWriterVersion,
        migrationLock: this.#migration.active,
      });
    });
  }

  async readTail(requestValue: CycleStoreReadTailRequest): Promise<CycleStoreTail> {
    const operation: CycleStoreProviderOperation = "read-tail";
    const request = captureObject(requestValue, operation, "tail request");
    exactKeys(request, ["context", "streamId"], operation, "tail request");
    const context = parseAuthorizationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    await this.#authorize(context, operation);
    return this.#locked(() => {
      this.#maybeFail(operation);
      return clone(tailOf(this.#records.get(this.#streamKey(context.tenantId, streamId)) ?? []));
    });
  }

  async append(requestValue: CycleStoreAppendRequest): Promise<CycleStoreAppendResult> {
    const operation: CycleStoreProviderOperation = "append";
    const request = captureObject(requestValue, operation, "append request");
    exactKeys(
      request,
      ["context", "streamId", "expectedTail", "lease", "records"],
      operation,
      "append request",
    );
    const context = parseMutationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    const expectedTail = parseTail(request.expectedTail, operation, "expectedTail");
    const lease = request.lease === null ? null : parseLeaseBinding(request.lease, operation);
    if (!Array.isArray(request.records) || request.records.length === 0) {
      providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "append records must be nonempty");
    }
    if (request.records.length > this.#descriptor.limits.maxAppendRecords) {
      providerError("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "append record count exceeds provider limit");
    }
    const records = request.records.map((record) => parseRecord(record, operation));
    let batchBytes = 0;
    for (const record of records) {
      const bytes = Buffer.byteLength(canonicalSerialize(record), "utf8");
      if (bytes > this.#descriptor.limits.maxRecordBytes) {
        providerError("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "record exceeds provider byte limit");
      }
      batchBytes += bytes;
      if (batchBytes > this.#descriptor.limits.maxAppendBytes) {
        providerError("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "append exceeds provider byte limit");
      }
    }
    const canonicalRequest = clone({ context, streamId, expectedTail, lease, records });
    return this.#mutate(operation, context, canonicalRequest, () => {
      this.#assertOnlineWriterCompatible(operation);
      const streamKey = this.#streamKey(context.tenantId, streamId);
      const current = this.#records.get(streamKey) ?? [];
      const actualTail = tailOf(current);
      if (!same(expectedTail, actualTail)) {
        providerError("GE_CYCLE_STORE_CONFLICT", operation, "append lost expected-tail CAS", {
          expectedSequence: expectedTail.sequence,
          actualSequence: actualTail.sequence,
        });
      }
      this.#assertWriteLease(context.tenantId, streamId, lease, operation);
      let previousHash = actualTail.recordHash;
      let nextSequence = actualTail.sequence + 1;
      const batchIds = new Set<string>();
      for (const record of records) {
        if (record.sequence !== nextSequence || record.previousRecordHash !== previousHash) {
          providerError("GE_CYCLE_STORE_CONFLICT", operation, "append record chain is not contiguous");
        }
        if (batchIds.has(record.recordId)
            || this.#recordIds.has(this.#recordKey(context.tenantId, record.recordId))) {
          providerError("GE_CYCLE_STORE_CONFLICT", operation, "recordId is already committed", {
            recordId: record.recordId,
          });
        }
        batchIds.add(record.recordId);
        previousHash = record.recordHash;
        nextSequence += 1;
      }
      this.#records.set(streamKey, Object.freeze([...current, ...records.map((record) => clone(record))]));
      for (const record of records) {
        this.#recordIds.set(this.#recordKey(context.tenantId, record.recordId), streamId);
      }
      return Object.freeze({
        tail: tailOf(this.#records.get(streamKey) ?? []),
        appendedRecords: records.length,
      });
    });
  }

  async readEventPage(requestValue: CycleStoreReadEventPageRequest): Promise<CycleStoreEventPage> {
    const operation: CycleStoreProviderOperation = "read-event-page";
    const request = captureObject(requestValue, operation, "event page request");
    exactKeys(
      request,
      ["context", "streamId", "fromSequence", "pageSize", "cursor"],
      operation,
      "event page request",
    );
    const context = parseAuthorizationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    const pageSize = integer(
      request.pageSize,
      1,
      this.#descriptor.limits.maxPageSize,
      operation,
      "pageSize",
    );
    const cursor = request.cursor === null
      ? null
      : parseCursorToken(request.cursor, operation);
    const fromSequence = request.fromSequence === null
      ? null
      : integer(request.fromSequence, 0, Number.MAX_SAFE_INTEGER, operation, "fromSequence");
    if ((cursor === null) === (fromSequence === null)) {
      providerError(
        "GE_CYCLE_STORE_INVALID_CURSOR",
        operation,
        "exactly one of cursor and fromSequence is required",
      );
    }
    await this.#authorize(context, operation);
    return this.#locked(() => {
      this.#maybeFail(operation);
      const streamRecords = this.#records.get(this.#streamKey(context.tenantId, streamId)) ?? [];
      let state: EventCursorState;
      if (cursor === null) {
        state = {
          kind: "events",
          contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
          descriptorHash: this.#descriptor.descriptorHash,
          schemaVersion: this.#descriptor.schemaVersion,
          context,
          streamId,
          pageSize,
          nextSequence: fromSequence as number,
          snapshotTail: tailOf(streamRecords),
          expiresAtMs: 0,
        };
      } else {
        const stored = this.#cursors.get(cursor);
        if (stored?.kind !== "events" || stored.streamId !== streamId
            || stored.pageSize !== pageSize || !same(stored.context, context)
            || stored.contractVersion !== CYCLE_STORE_PROVIDER_CONTRACT_VERSION
            || stored.descriptorHash !== this.#descriptor.descriptorHash
            || stored.schemaVersion !== this.#descriptor.schemaVersion) {
          providerError("GE_CYCLE_STORE_INVALID_CURSOR", operation, "event cursor is invalid or expired");
        }
        if (stored.expiresAtMs <= this.#now(operation)) {
          this.#cursors.delete(cursor);
          providerError("GE_CYCLE_STORE_INVALID_CURSOR", operation, "event cursor is invalid or expired");
        }
        state = stored;
        this.#cursors.delete(cursor);
      }
      const finalExclusive = state.snapshotTail.exists ? state.snapshotTail.sequence + 1 : 0;
      const pageEnd = Math.min(state.nextSequence + pageSize, finalExclusive);
      const records = streamRecords.slice(state.nextSequence, pageEnd).map((record) => clone(record));
      const nextCursor = pageEnd < finalExclusive
        ? this.#newCursor({
          kind: "events",
          contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
          descriptorHash: this.#descriptor.descriptorHash,
          schemaVersion: this.#descriptor.schemaVersion,
          context,
          streamId,
          pageSize,
          nextSequence: pageEnd,
          snapshotTail: state.snapshotTail,
        }, operation)
        : null;
      return clone({
        exists: state.snapshotTail.exists,
        snapshotTail: state.snapshotTail,
        records,
        nextCursor,
      });
    });
  }

  async saveCheckpoint(
    requestValue: CycleStoreSaveCheckpointRequest,
  ): Promise<CycleStoreCheckpointSummary> {
    const operation: CycleStoreProviderOperation = "save-checkpoint";
    const request = captureObject(
      requestValue,
      operation,
      "save checkpoint request",
      MAX_CYCLE_STORE_CHECKPOINT_BYTES + MAX_CYCLE_STORE_RECORD_BYTES,
    );
    exactKeys(request, ["context", "checkpoint", "lease"], operation, "save checkpoint request");
    const context = parseMutationContext(request.context, operation);
    const checkpoint = parseCheckpoint(request.checkpoint, operation);
    const lease = request.lease === null ? null : parseLeaseBinding(request.lease, operation);
    const canonicalRequest = clone({ context, checkpoint, lease });
    return this.#mutate(operation, context, canonicalRequest, () => {
      this.#assertOnlineWriterCompatible(operation);
      const records = this.#records.get(
        this.#streamKey(context.tenantId, checkpoint.streamId),
      ) ?? [];
      const tail = tailOf(records);
      if (!tail.exists || tail.sequence !== checkpoint.boundSequence
          || tail.recordHash !== checkpoint.boundRecordHash) {
        providerError(
          "GE_CYCLE_STORE_CONFLICT",
          operation,
          "checkpoint is not bound to the current event tail",
          { actualSequence: tail.sequence, expectedSequence: checkpoint.boundSequence },
        );
      }
      this.#assertWriteLease(context.tenantId, checkpoint.streamId, lease, operation);
      const key = this.#checkpointKey(
        context.tenantId,
        checkpoint.checkpointScope,
        checkpoint.checkpointId,
      );
      const existing = this.#checkpoints.get(key);
      if (existing !== undefined) {
        if (!same(existing, checkpoint)) {
          providerError(
            "GE_CYCLE_STORE_CONFLICT",
            operation,
            "checkpointId is immutable until deleted",
          );
        }
        return checkpointSummary(existing);
      }
      this.#checkpoints.set(key, clone(checkpoint));
      return checkpointSummary(checkpoint);
    });
  }

  async loadCheckpoint(
    requestValue: CycleStoreLoadCheckpointRequest,
  ): Promise<CycleStoreCheckpoint | null> {
    const operation: CycleStoreProviderOperation = "load-checkpoint";
    const request = captureObject(requestValue, operation, "load checkpoint request");
    exactKeys(
      request,
      ["context", "checkpointScope", "checkpointId"],
      operation,
      "load checkpoint request",
    );
    const context = parseAuthorizationContext(request.context, operation);
    const scope = identifier(request.checkpointScope, operation, "checkpointScope");
    const checkpointId = identifier(request.checkpointId, operation, "checkpointId");
    await this.#authorize(context, operation);
    return this.#locked(() => {
      this.#maybeFail(operation);
      const checkpoint = this.#checkpoints.get(
        this.#checkpointKey(context.tenantId, scope, checkpointId),
      );
      if (checkpoint === undefined) return null;
      try {
        return clone(parseCheckpoint(checkpoint, operation));
      } catch (error) {
        if (error instanceof CycleStoreProviderError) {
          throw new CycleStoreProviderError(
            "GE_CYCLE_STORE_CORRUPTION",
            operation,
            "checkpoint bytes are corrupt",
            { checkpointId },
          );
        }
        throw error;
      }
    });
  }

  async listCheckpoints(
    requestValue: CycleStoreListCheckpointsRequest,
  ): Promise<CycleStoreCheckpointPage> {
    const operation: CycleStoreProviderOperation = "list-checkpoints";
    const request = captureObject(requestValue, operation, "list checkpoint request");
    exactKeys(
      request,
      ["context", "checkpointScope", "pageSize", "cursor"],
      operation,
      "list checkpoint request",
    );
    const context = parseAuthorizationContext(request.context, operation);
    const checkpointScope = identifier(
      request.checkpointScope,
      operation,
      "checkpointScope",
    );
    const pageSize = integer(
      request.pageSize,
      1,
      this.#descriptor.limits.maxPageSize,
      operation,
      "pageSize",
    );
    const cursor = request.cursor === null
      ? null
      : parseCursorToken(request.cursor, operation);
    await this.#authorize(context, operation);
    return this.#locked(() => {
      this.#maybeFail(operation);
      let state: CheckpointCursorState;
      if (cursor === null) {
        const snapshot = [...this.#checkpoints.entries()]
          .filter(([key]) => key.startsWith(`${context.tenantId}\0${checkpointScope}\0`))
          .map(([, checkpoint]) => checkpointSummary(checkpoint))
          .sort((left, right) => {
            if (left.boundSequence !== right.boundSequence) {
              return right.boundSequence - left.boundSequence;
            }
            const time = right.createdAt.localeCompare(left.createdAt);
            return time === 0 ? left.checkpointId.localeCompare(right.checkpointId) : time;
          });
        state = {
          kind: "checkpoints",
          contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
          descriptorHash: this.#descriptor.descriptorHash,
          schemaVersion: this.#descriptor.schemaVersion,
          context,
          checkpointScope,
          pageSize,
          nextIndex: 0,
          snapshot: Object.freeze(snapshot.map((item) => clone(item))),
          expiresAtMs: 0,
        };
      } else {
        const stored = this.#cursors.get(cursor);
        if (stored?.kind !== "checkpoints" || stored.checkpointScope !== checkpointScope
            || stored.pageSize !== pageSize || !same(stored.context, context)
            || stored.contractVersion !== CYCLE_STORE_PROVIDER_CONTRACT_VERSION
            || stored.descriptorHash !== this.#descriptor.descriptorHash
            || stored.schemaVersion !== this.#descriptor.schemaVersion) {
          providerError(
            "GE_CYCLE_STORE_INVALID_CURSOR",
            operation,
            "checkpoint cursor is invalid or expired",
          );
        }
        if (stored.expiresAtMs <= this.#now(operation)) {
          this.#cursors.delete(cursor);
          providerError(
            "GE_CYCLE_STORE_INVALID_CURSOR",
            operation,
            "checkpoint cursor is invalid or expired",
          );
        }
        state = stored;
        this.#cursors.delete(cursor);
      }
      const end = Math.min(state.nextIndex + pageSize, state.snapshot.length);
      const checkpoints = state.snapshot.slice(state.nextIndex, end).map((item) => clone(item));
      const nextCursor = end < state.snapshot.length
        ? this.#newCursor({
          kind: "checkpoints",
          contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
          descriptorHash: this.#descriptor.descriptorHash,
          schemaVersion: this.#descriptor.schemaVersion,
          context,
          checkpointScope,
          pageSize,
          nextIndex: end,
          snapshot: state.snapshot,
        }, operation)
        : null;
      return clone({ checkpoints, nextCursor });
    });
  }

  async deleteCheckpoint(
    requestValue: CycleStoreDeleteCheckpointRequest,
  ): Promise<CycleStoreDeleteCheckpointResult> {
    const operation: CycleStoreProviderOperation = "delete-checkpoint";
    const request = captureObject(requestValue, operation, "delete checkpoint request");
    exactKeys(
      request,
      ["context", "checkpointScope", "checkpointId", "expectedValueHash"],
      operation,
      "delete checkpoint request",
    );
    const context = parseMutationContext(request.context, operation);
    const scope = identifier(request.checkpointScope, operation, "checkpointScope");
    const checkpointId = identifier(request.checkpointId, operation, "checkpointId");
    const expectedValueHash = request.expectedValueHash === null
      ? null
      : hash(request.expectedValueHash, operation, "expectedValueHash");
    const canonicalRequest = clone({ context, checkpointScope: scope, checkpointId, expectedValueHash });
    return this.#mutate(operation, context, canonicalRequest, () => {
      this.#assertOnlineWriterCompatible(operation);
      const key = this.#checkpointKey(context.tenantId, scope, checkpointId);
      const existing = this.#checkpoints.get(key);
      if (existing === undefined) return Object.freeze({ deleted: false });
      if (expectedValueHash === null || existing.valueHash !== expectedValueHash) {
        providerError(
          "GE_CYCLE_STORE_CONFLICT",
          operation,
          "checkpoint content hash differs from expected value",
        );
      }
      this.#checkpoints.delete(key);
      return Object.freeze({ deleted: true });
    });
  }

  #leaseInspection(
    tenantId: string,
    streamId: string,
    operation: CycleStoreProviderOperation,
  ): CycleStoreLeaseInspection {
    const state = this.#leaseState(tenantId, streamId);
    let status: CycleStoreLeaseInspection["status"];
    if (state.active === null) {
      status = state.lastFencingToken === 0 ? "none" : "released";
    } else {
      status = Date.parse(state.active.expiresAt) <= this.#now(operation) ? "expired" : "active";
    }
    return Object.freeze({
      status,
      lease: state.active === null ? null : clone(state.active),
      lastLeaseEpoch: state.lastLeaseEpoch,
      lastFencingToken: state.lastFencingToken,
    });
  }

  async acquireLease(requestValue: CycleStoreAcquireLeaseRequest): Promise<CycleStoreLease> {
    const operation: CycleStoreProviderOperation = "acquire-lease";
    const request = captureObject(requestValue, operation, "acquire lease request");
    exactKeys(
      request,
      [
        "context",
        "streamId",
        "leaseId",
        "holderId",
        "ttlMs",
        "mode",
        "expectedFencingToken",
      ],
      operation,
      "acquire lease request",
    );
    const context = parseMutationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    const leaseId = identifier(request.leaseId, operation, "leaseId");
    const holderId = identifier(request.holderId, operation, "holderId");
    const ttlMs = integer(
      request.ttlMs,
      1,
      this.#descriptor.limits.maxLeaseTtlMs,
      operation,
      "ttlMs",
    );
    if (request.mode !== "acquire" && request.mode !== "takeover") {
      providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "lease mode is invalid");
    }
    const mode = request.mode;
    const expectedFencingToken = integer(
      request.expectedFencingToken,
      0,
      Number.MAX_SAFE_INTEGER,
      operation,
      "expectedFencingToken",
    );
    const canonicalRequest = clone({
      context,
      streamId,
      leaseId,
      holderId,
      ttlMs,
      mode,
      expectedFencingToken,
    });
    return this.#mutate(operation, context, canonicalRequest, () => {
      this.#assertOnlineWriterCompatible(operation);
      const records = this.#records.get(this.#streamKey(context.tenantId, streamId)) ?? [];
      if (records.length === 0) {
        providerError("GE_CYCLE_STORE_NOT_FOUND", operation, "lease stream does not exist");
      }
      const state = this.#leaseState(context.tenantId, streamId);
      if (expectedFencingToken !== state.lastFencingToken) {
        providerError("GE_CYCLE_STORE_STALE_FENCE", operation, "expected lease fence is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      const now = this.#now(operation);
      const activeExpired = state.active !== null && Date.parse(state.active.expiresAt) <= now;
      if (mode === "takeover") {
        if (state.active === null || !activeExpired) {
          providerError(
            "GE_CYCLE_STORE_LEASE_CONFLICT",
            operation,
            "lease takeover requires an expired active lease",
          );
        }
      } else if (state.active !== null) {
        providerError(
          "GE_CYCLE_STORE_LEASE_CONFLICT",
          operation,
          activeExpired
            ? "expired lease requires takeover mode"
            : "stream already has an active lease",
        );
      }
      if (state.usedLeaseIds.has(leaseId)) {
        providerError("GE_CYCLE_STORE_LEASE_CONFLICT", operation, "leaseId cannot be reused");
      }
      if (state.lastLeaseEpoch === Number.MAX_SAFE_INTEGER
          || state.lastFencingToken === Number.MAX_SAFE_INTEGER) {
        providerError("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "lease fence exhausted");
      }
      const lease: CycleStoreLease = Object.freeze({
        leaseId,
        holderId,
        leaseEpoch: state.lastLeaseEpoch + 1,
        fencingToken: state.lastFencingToken + 1,
        acquiredAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlMs).toISOString(),
      });
      this.#leases.set(this.#streamKey(context.tenantId, streamId), {
        active: lease,
        lastLeaseEpoch: lease.leaseEpoch,
        lastFencingToken: lease.fencingToken,
        usedLeaseIds: new Set([...state.usedLeaseIds, leaseId]),
      });
      return lease;
    });
  }

  async renewLease(requestValue: CycleStoreRenewLeaseRequest): Promise<CycleStoreLease> {
    const operation: CycleStoreProviderOperation = "renew-lease";
    const request = captureObject(requestValue, operation, "renew lease request");
    exactKeys(request, ["context", "streamId", "lease", "ttlMs"], operation, "renew lease request");
    const context = parseMutationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    const leaseBinding = parseLeaseBinding(request.lease, operation);
    const ttlMs = integer(
      request.ttlMs,
      1,
      this.#descriptor.limits.maxLeaseTtlMs,
      operation,
      "ttlMs",
    );
    const canonicalRequest = clone({ context, streamId, lease: leaseBinding, ttlMs });
    return this.#mutate(operation, context, canonicalRequest, () => {
      this.#assertOnlineWriterCompatible(operation);
      const state = this.#leaseState(context.tenantId, streamId);
      const active = state.active;
      const now = this.#now(operation);
      if (active === null || Date.parse(active.expiresAt) <= now
          || active.leaseId !== leaseBinding.leaseId
          || active.holderId !== leaseBinding.holderId
          || active.fencingToken !== leaseBinding.fencingToken) {
        providerError("GE_CYCLE_STORE_STALE_FENCE", operation, "lease renewal identity is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      const newExpiry = now + ttlMs;
      if (newExpiry <= Date.parse(active.expiresAt)) {
        providerError(
          "GE_CYCLE_STORE_INVALID_ARGUMENT",
          operation,
          "lease renewal must strictly extend expiry",
        );
      }
      const renewed: CycleStoreLease = Object.freeze({
        ...active,
        expiresAt: new Date(newExpiry).toISOString(),
      });
      this.#leases.set(this.#streamKey(context.tenantId, streamId), {
        ...state,
        active: renewed,
      });
      return renewed;
    });
  }

  async releaseLease(
    requestValue: CycleStoreReleaseLeaseRequest,
  ): Promise<CycleStoreLeaseInspection> {
    const operation: CycleStoreProviderOperation = "release-lease";
    const request = captureObject(requestValue, operation, "release lease request");
    exactKeys(request, ["context", "streamId", "lease"], operation, "release lease request");
    const context = parseMutationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    const leaseBinding = parseLeaseBinding(request.lease, operation);
    const canonicalRequest = clone({ context, streamId, lease: leaseBinding });
    return this.#mutate(operation, context, canonicalRequest, () => {
      this.#assertOnlineWriterCompatible(operation);
      const state = this.#leaseState(context.tenantId, streamId);
      const active = state.active;
      if (active === null || active.leaseId !== leaseBinding.leaseId
          || active.holderId !== leaseBinding.holderId
          || active.fencingToken !== leaseBinding.fencingToken
          || Date.parse(active.expiresAt) <= this.#now(operation)) {
        providerError("GE_CYCLE_STORE_STALE_FENCE", operation, "lease release identity is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      this.#leases.set(this.#streamKey(context.tenantId, streamId), {
        ...state,
        active: null,
      });
      return Object.freeze({
        status: "released" as const,
        lease: null,
        lastLeaseEpoch: state.lastLeaseEpoch,
        lastFencingToken: state.lastFencingToken,
      });
    });
  }

  async inspectLease(
    requestValue: CycleStoreInspectLeaseRequest,
  ): Promise<CycleStoreLeaseInspection> {
    const operation: CycleStoreProviderOperation = "inspect-lease";
    const request = captureObject(requestValue, operation, "inspect lease request");
    exactKeys(request, ["context", "streamId"], operation, "inspect lease request");
    const context = parseAuthorizationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    await this.#authorize(context, operation);
    return this.#locked(() => {
      this.#maybeFail(operation);
      return clone(this.#leaseInspection(context.tenantId, streamId, operation));
    });
  }

  #governanceInspection(tenantId: string, streamId: string): CycleStoreGovernanceInspection {
    const holds = [...(this.#legalHolds.get(this.#streamKey(tenantId, streamId)) ?? new Set())]
      .sort();
    return Object.freeze({
      legalHoldIds: Object.freeze(holds),
      retentionMode: "retain-authoritative-history" as const,
      archiveMode: "lossless-before-delete" as const,
      compactionMode: "logical-history-preserving" as const,
    });
  }

  async setLegalHold(
    requestValue: CycleStoreLegalHoldRequest,
  ): Promise<CycleStoreGovernanceInspection> {
    const operation: CycleStoreProviderOperation = "set-legal-hold";
    const request = captureObject(requestValue, operation, "legal hold request");
    exactKeys(request, ["context", "streamId", "holdId", "action"], operation, "legal hold request");
    const context = parseMutationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    const holdId = identifier(request.holdId, operation, "holdId");
    if (request.action !== "place" && request.action !== "release") {
      providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "legal hold action is invalid");
    }
    const action = request.action;
    const canonicalRequest = clone({ context, streamId, holdId, action });
    return this.#mutate(operation, context, canonicalRequest, () => {
      this.#assertOnlineWriterCompatible(operation);
      const key = this.#streamKey(context.tenantId, streamId);
      if (!this.#records.has(key)) {
        providerError("GE_CYCLE_STORE_NOT_FOUND", operation, "legal hold stream does not exist");
      }
      const holds = new Set(this.#legalHolds.get(key) ?? []);
      if (action === "place") holds.add(holdId);
      else holds.delete(holdId);
      this.#legalHolds.set(key, holds);
      return this.#governanceInspection(context.tenantId, streamId);
    });
  }

  async inspectGovernance(
    requestValue: CycleStoreReadTailRequest,
  ): Promise<CycleStoreGovernanceInspection> {
    const operation: CycleStoreProviderOperation = "inspect-governance";
    const request = captureObject(requestValue, operation, "governance request");
    exactKeys(request, ["context", "streamId"], operation, "governance request");
    const context = parseAuthorizationContext(request.context, operation);
    const streamId = identifier(request.streamId, operation, "streamId");
    await this.#authorize(context, operation);
    return this.#locked(() => {
      this.#maybeFail(operation);
      const key = this.#streamKey(context.tenantId, streamId);
      if (!this.#records.has(key)) {
        providerError("GE_CYCLE_STORE_NOT_FOUND", operation, "governance stream does not exist");
      }
      return clone(this.#governanceInspection(context.tenantId, streamId));
    });
  }

  async acquireMigrationLock(
    requestValue: CycleStoreAcquireMigrationLockRequest,
  ): Promise<CycleStoreMigrationLock> {
    const operation: CycleStoreProviderOperation = "acquire-migration-lock";
    const request = captureObject(requestValue, operation, "migration lock request");
    exactKeys(
      request,
      [
        "context",
        "lockId",
        "ownerId",
        "sourceSchemaVersion",
        "targetSchemaVersion",
        "ttlMs",
        "mode",
        "expectedFencingToken",
      ],
      operation,
      "migration lock request",
    );
    const context = parseMutationContext(request.context, operation);
    const lockId = identifier(request.lockId, operation, "lockId");
    const ownerId = identifier(request.ownerId, operation, "ownerId");
    const sourceSchemaVersion = integer(
      request.sourceSchemaVersion,
      1,
      Number.MAX_SAFE_INTEGER,
      operation,
      "sourceSchemaVersion",
    );
    const targetSchemaVersion = integer(
      request.targetSchemaVersion,
      1,
      Number.MAX_SAFE_INTEGER,
      operation,
      "targetSchemaVersion",
    );
    if (sourceSchemaVersion !== this.#descriptor.schemaVersion
        || targetSchemaVersion <= sourceSchemaVersion) {
      providerError(
        "GE_CYCLE_STORE_UNSUPPORTED_VERSION",
        operation,
        "migration schema interval is unsupported",
      );
    }
    const ttlMs = integer(
      request.ttlMs,
      1,
      this.#descriptor.limits.maxLeaseTtlMs,
      operation,
      "ttlMs",
    );
    if (request.mode !== "acquire" && request.mode !== "takeover") {
      providerError("GE_CYCLE_STORE_INVALID_ARGUMENT", operation, "migration lock mode is invalid");
    }
    const mode = request.mode;
    const expectedFencingToken = integer(
      request.expectedFencingToken,
      0,
      Number.MAX_SAFE_INTEGER,
      operation,
      "expectedFencingToken",
    );
    const canonicalRequest = clone({
      context,
      lockId,
      ownerId,
      sourceSchemaVersion,
      targetSchemaVersion,
      ttlMs,
      mode,
      expectedFencingToken,
    });
    return this.#mutate(operation, context, canonicalRequest, () => {
      const state = this.#migration;
      if (expectedFencingToken !== state.lastFencingToken) {
        providerError("GE_CYCLE_STORE_STALE_FENCE", operation, "migration fence is stale", {
          lastFencingToken: state.lastFencingToken,
        });
      }
      const now = this.#now(operation);
      const activeExpired = state.active !== null && Date.parse(state.active.expiresAt) <= now;
      if (mode === "takeover") {
        if (state.active === null || !activeExpired) {
          providerError(
            "GE_CYCLE_STORE_MIGRATION_LOCKED",
            operation,
            "migration takeover requires an expired lock",
          );
        }
      } else if (state.active !== null) {
        providerError(
          "GE_CYCLE_STORE_MIGRATION_LOCKED",
          operation,
          activeExpired ? "expired migration lock requires takeover" : "migration lock is active",
        );
      }
      if (state.usedLockIds.has(lockId)) {
        providerError("GE_CYCLE_STORE_MIGRATION_LOCKED", operation, "migration lockId cannot be reused");
      }
      if (state.lastEpoch === Number.MAX_SAFE_INTEGER
          || state.lastFencingToken === Number.MAX_SAFE_INTEGER) {
        providerError("GE_CYCLE_STORE_QUOTA_EXCEEDED", operation, "migration fence exhausted");
      }
      const lock: CycleStoreMigrationLock = Object.freeze({
        lockId,
        ownerId,
        sourceSchemaVersion,
        targetSchemaVersion,
        lockEpoch: state.lastEpoch + 1,
        fencingToken: state.lastFencingToken + 1,
        acquiredAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttlMs).toISOString(),
      });
      this.#migration = {
        active: lock,
        lastEpoch: lock.lockEpoch,
        lastFencingToken: lock.fencingToken,
        usedLockIds: new Set([...state.usedLockIds, lockId]),
      };
      return lock;
    });
  }

  async inspectMigrationLock(
    contextValue: CycleStoreAuthorizationContext,
  ): Promise<CycleStoreMigrationLock | null> {
    const operation: CycleStoreProviderOperation = "inspect-migration-lock";
    const request = captureObject({ context: contextValue }, operation, "migration inspection request");
    exactKeys(request, ["context"], operation, "migration inspection request");
    const context = parseAuthorizationContext(request.context, operation);
    await this.#authorize(context, operation);
    return this.#locked(() => {
      this.#maybeFail(operation);
      return this.#migration.active === null ? null : clone(this.#migration.active);
    });
  }

  async releaseMigrationLock(
    requestValue: CycleStoreReleaseMigrationLockRequest,
  ): Promise<CycleStoreMigrationLock | null> {
    const operation: CycleStoreProviderOperation = "release-migration-lock";
    const request = captureObject(requestValue, operation, "migration release request");
    exactKeys(
      request,
      ["context", "lockId", "ownerId", "fencingToken"],
      operation,
      "migration release request",
    );
    const context = parseMutationContext(request.context, operation);
    const lockId = identifier(request.lockId, operation, "lockId");
    const ownerId = identifier(request.ownerId, operation, "ownerId");
    const fencingToken = integer(
      request.fencingToken,
      1,
      Number.MAX_SAFE_INTEGER,
      operation,
      "fencingToken",
    );
    const canonicalRequest = clone({ context, lockId, ownerId, fencingToken });
    return this.#mutate(operation, context, canonicalRequest, () => {
      const active = this.#migration.active;
      if (active === null || active.lockId !== lockId || active.ownerId !== ownerId
          || active.fencingToken !== fencingToken) {
        providerError("GE_CYCLE_STORE_STALE_FENCE", operation, "migration release identity is stale", {
          lastFencingToken: this.#migration.lastFencingToken,
        });
      }
      this.#migration = { ...this.#migration, active: null };
      return null;
    });
  }

  /** Advance only the deterministic built-in clock; never part of the provider interface. */
  unsafeAdvanceClockForTest(milliseconds: number): void {
    if (this.#externalNow !== undefined) {
      throw new TypeError("cannot advance an externally supplied provider clock");
    }
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
      throw new TypeError("clock advancement must be a nonnegative safe integer");
    }
    this.#manualNowMs += milliseconds;
  }

  /** Inject one typed pre-operation failure; never part of the provider interface. */
  unsafeInjectFailureForTest(
    operation: CycleStoreProviderOperation,
    code: CycleStoreProviderErrorCode,
  ): void {
    if (!CYCLE_STORE_PROVIDER_OPERATIONS.includes(operation)
        || !CYCLE_STORE_PROVIDER_ERROR_CODES.includes(code)) {
      throw new TypeError("unknown provider failure injection");
    }
    this.#injectedFailures.set(operation, code);
  }

  /** Replace one checkpoint with detached hostile bytes for corruption tests. */
  unsafeCorruptCheckpointForTest(
    tenantId: string,
    checkpointScope: string,
    checkpointId: string,
    replacement: unknown,
  ): void {
    const key = this.#checkpointKey(tenantId, checkpointScope, checkpointId);
    if (!this.#checkpoints.has(key)) throw new TypeError("checkpoint does not exist");
    this.#checkpoints.set(key, snapshotJson(replacement) as unknown as CycleStoreCheckpoint);
  }

  /** Install exact lease counters for one bounded overflow test. */
  unsafeSetLeaseCountersForTest(
    tenantId: string,
    streamId: string,
    leaseEpoch: number,
    fencingToken: number,
  ): void {
    if (!Number.isSafeInteger(leaseEpoch) || !Number.isSafeInteger(fencingToken)
        || leaseEpoch < 0 || fencingToken < 0) {
      throw new TypeError("lease counters must be nonnegative safe integers");
    }
    const state = this.#leaseState(tenantId, streamId);
    this.#leases.set(this.#streamKey(tenantId, streamId), {
      ...state,
      active: null,
      lastLeaseEpoch: leaseEpoch,
      lastFencingToken: fencingToken,
    });
  }

  /** Deterministic payload-free state export for model debugging and differential evidence. */
  unsafeStateSnapshotForTest(): JsonValue {
    const streams = [...this.#records.entries()]
      .map(([scope, records]) => ({
        scopeHash: canonicalHash(scope),
        tail: tailOf(records),
        recordHashes: records.map(({ recordHash }) => recordHash),
      }))
      .sort((left, right) => left.scopeHash.localeCompare(right.scopeHash));
    const checkpoints = [...this.#checkpoints.entries()]
      .map(([scope, checkpoint]) => ({
        scopeHash: canonicalHash(scope),
        checkpointHash: canonicalHash(checkpoint),
      }))
      .sort((left, right) => left.scopeHash.localeCompare(right.scopeHash));
    const leases = [...this.#leases.entries()]
      .map(([scope, state]) => ({
        scopeHash: canonicalHash(scope),
        lastLeaseEpoch: state.lastLeaseEpoch,
        lastFencingToken: state.lastFencingToken,
        active: state.active === null ? null : {
          leaseEpoch: state.active.leaseEpoch,
          fencingToken: state.active.fencingToken,
          expiresAt: state.active.expiresAt,
        },
      }))
      .sort((left, right) => left.scopeHash.localeCompare(right.scopeHash));
    const operations = [...this.#idempotency.entries()]
      .map(([scope, entry]) => ({
        scopeHash: canonicalHash(scope),
        operation: entry.operation,
        requestHash: entry.requestHash,
        resultHash: canonicalHash(entry.result),
      }))
      .sort((left, right) => left.scopeHash.localeCompare(right.scopeHash));
    return snapshotJson({
      descriptorHash: this.#descriptor.descriptorHash,
      observedAt: new Date(this.#lastObservedNowMs).toISOString(),
      streams,
      checkpoints,
      leases,
      operations,
      cursorCount: this.#cursors.size,
      legalHoldCount: [...this.#legalHolds.values()]
        .reduce((total, holds) => total + holds.size, 0),
      migration: {
        lastEpoch: this.#migration.lastEpoch,
        lastFencingToken: this.#migration.lastFencingToken,
        active: this.#migration.active === null ? null : {
          sourceSchemaVersion: this.#migration.active.sourceSchemaVersion,
          targetSchemaVersion: this.#migration.active.targetSchemaVersion,
          lockEpoch: this.#migration.active.lockEpoch,
          fencingToken: this.#migration.active.fencingToken,
          expiresAt: this.#migration.active.expiresAt,
        },
      },
    });
  }

  /** Safe, payload-free state counters for conformance zero-mutation proofs. */
  unsafeStateCountersForTest(): Readonly<{
    streams: number;
    records: number;
    recordIds: number;
    checkpoints: number;
    leaseStreams: number;
    idempotencyEntries: number;
    cursors: number;
    legalHolds: number;
    migrationFence: number;
  }> {
    return Object.freeze({
      streams: this.#records.size,
      records: [...this.#records.values()].reduce((total, records) => total + records.length, 0),
      recordIds: this.#recordIds.size,
      checkpoints: this.#checkpoints.size,
      leaseStreams: this.#leases.size,
      idempotencyEntries: this.#idempotency.size,
      cursors: this.#cursors.size,
      legalHolds: [...this.#legalHolds.values()].reduce((total, holds) => total + holds.size, 0),
      migrationFence: this.#migration.lastFencingToken,
    });
  }
}
