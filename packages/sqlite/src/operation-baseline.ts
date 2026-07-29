import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { canonicalSerialize } from "@graph-engineering/core";

const bufferCompareIntrinsic = Buffer.compare;
const bufferEqualsIntrinsic = Buffer.prototype.equals;
const bufferFromIntrinsic = Buffer.from;
const bufferToStringIntrinsic = Buffer.prototype.toString;
const objectFreezeIntrinsic = Object.freeze;
const reflectApplyIntrinsic = Reflect.apply;

export const BASELINE_ID_DOMAIN = "graph-engineering/sqlite-operation-baseline-id/v1\0";
export const BASELINE_ENTRY_DOMAIN = "graph-engineering/sqlite-operation-baseline-entry/v1\0";
export const BASELINE_PROJECTION_DOMAIN =
  "graph-engineering/sqlite-operation-baseline-projection/v1\0";
export const BASELINE_GENESIS_DOMAIN =
  "graph-engineering/sqlite-operation-baseline-genesis/v1\0";
export const BASELINE_EMPTY_DOMAIN = "graph-engineering/sqlite-operation-baseline-empty/v1\0";
export const LEDGER_REPLAY_DIGEST_DOMAIN =
  "graph-engineering/sqlite-operation-ledger-replay/v1\0";

export const BASELINE_GENESIS_HASH =
  "5311dba7ae8b844fc3efccd55dd90c3f78e02a7f7e222d7a0a513fd1aff9ec96";
export const BASELINE_EMPTY_ROOT =
  "66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a";
export const MAX_BASELINE_KEY_BYTES = 4_096;
export const MAX_BASELINE_STATE_BYTES = 2_097_152;
export const MAX_BASELINE_POLICY_BYTES = 1_048_576;

export const BASELINE_ENTRY_KINDS = objectFreezeIntrinsic([
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
] as const);

export type OperationBaselineEntryKind = (typeof BASELINE_ENTRY_KINDS)[number];

export const OPERATION_BASELINE_POLICY = objectFreezeIntrinsic({
  baselineFormatVersion: 1,
  canonicalEncoding: "graph-engineering/canonical-json/v1",
  cursorReplay: "independent-semantic-audit",
  emptyRoot: BASELINE_EMPTY_ROOT,
  entryHashDomain: BASELINE_ENTRY_DOMAIN,
  entryKinds: BASELINE_ENTRY_KINDS,
  genesisHash: BASELINE_GENESIS_HASH,
  legacyRequestRecovery: false,
  maxEntryKeyBytes: MAX_BASELINE_KEY_BYTES,
  maxEntryStateBytes: MAX_BASELINE_STATE_BYTES,
  payloadOmissions: objectFreezeIntrinsic(["checkpoint-value", "record-blob", "record-value"]),
  projectionHashDomain: BASELINE_PROJECTION_DOMAIN,
  replayStartsAtCommitSequence: 1,
  sort: objectFreezeIntrinsic(["entry-kind-rank", "entry-key-utf8-bytes"]),
} as const);

export interface OperationBaselineSourceEnvelope {
  readonly capturedAtMs: number;
  readonly sourceApplicationId: 1195724359;
  readonly sourceDescriptorHash: string;
  readonly sourceMigrationLineageId: string;
  readonly sourceMigrationLineageSha256: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly sourceUserVersion: 1;
}

export interface OperationBaselineEntryInput {
  readonly entryKind: OperationBaselineEntryKind;
  readonly key: unknown;
  readonly state: unknown;
}

export interface CanonicalOperationBaselineEntry {
  readonly baselineId: string;
  readonly entryKind: OperationBaselineEntryKind;
  readonly ordinal: number;
  readonly keyBytes: Buffer;
  readonly stateBytes: Buffer;
  readonly previousEntryHash: string;
  readonly entryHash: string;
}

export interface OperationBaselineProjectionIdentity {
  readonly baselineId: string;
  readonly entryCount: number;
  readonly firstEntryHash: string;
  readonly finalEntryHash: string;
  readonly legacyOperationCount: number;
  readonly projectionSha256: string;
}

export interface OperationBaselineProjection extends OperationBaselineProjectionIdentity {
  readonly entries: readonly CanonicalOperationBaselineEntry[];
}

export class OperationBaselineError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "OperationBaselineError";
  }
}

const HASH = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const RFC3339 = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const KIND_RANK = new Map(BASELINE_ENTRY_KINDS.map((kind, rank) => [kind, rank] as const));
const LEGACY_OPERATION_NAMES = new Set([
  "append", "save-checkpoint", "delete-checkpoint", "acquire-lease", "renew-lease",
  "release-lease", "set-legal-hold", "acquire-migration-lock", "release-migration-lock",
]);

function invalid(label: string): never {
  throw new OperationBaselineError(`invalid SQLite operation baseline ${label}`);
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function operationBaselineDomainHash(domain: string, value: unknown): string {
  return createHash("sha256")
    .update(domain, "utf8")
    .update(canonicalSerialize(value), "utf8")
    .digest("hex");
}

function detachedRecord(value: unknown, label: string): Record<string, unknown> {
  let detached: unknown;
  try {
    detached = JSON.parse(canonicalSerialize(value)) as unknown;
  } catch {
    return invalid(label);
  }
  if (detached === null || Array.isArray(detached) || typeof detached !== "object") {
    return invalid(label);
  }
  return detached as Record<string, unknown>;
}

function exact(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid(`${label} fields`);
  }
}

function string(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string") return invalid(`${label}.${key}`);
  return value;
}

function nonempty(record: Record<string, unknown>, key: string, label: string): string {
  const value = string(record, key, label);
  return value.length > 0 ? value : invalid(`${label}.${key}`);
}

function identifier(record: Record<string, unknown>, key: string, label: string): string {
  const value = string(record, key, label);
  return IDENTIFIER.test(value) && value !== "." && value !== ".."
    ? value
    : invalid(`${label}.${key}`);
}

function hash(record: Record<string, unknown>, key: string, label: string): string {
  const value = string(record, key, label);
  return HASH.test(value) ? value : invalid(`${label}.${key}`);
}

function integer(
  record: Record<string, unknown>,
  key: string,
  label: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const value = record[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : invalid(`${label}.${key}`);
}

function nullableString(
  record: Record<string, unknown>, key: string, label: string, validator: RegExp = IDENTIFIER,
): string | null {
  const value = record[key];
  if (value === null) return null;
  return typeof value === "string" && validator.test(value) ? value : invalid(`${label}.${key}`);
}

function nullableInteger(record: Record<string, unknown>, key: string, label: string): number | null {
  return record[key] === null ? null : integer(record, key, label);
}

function isRfc3339Timestamp(value: string): boolean {
  if (!RFC3339.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year === 0) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (days[month - 1] ?? 0);
}

function timestamp(record: Record<string, unknown>, key: string, label: string): string {
  const value = string(record, key, label);
  return isRfc3339Timestamp(value) ? value : invalid(`${label}.${key}`);
}

function nullableTimestamp(
  record: Record<string, unknown>, key: string, label: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  return typeof value === "string" && isRfc3339Timestamp(value)
    ? value
    : invalid(`${label}.${key}`);
}

function checkpointSummary(value: unknown, label: string): void {
  if (value === null) return;
  const record = detachedRecord(value, `${label}.summary`);
  exact(record, ["checkpointScope", "checkpointId", "streamId", "boundSequence", "boundRecordHash", "createdAt", "valueHash", "valueBytes"], `${label}.summary`);
  identifier(record, "checkpointScope", label); identifier(record, "checkpointId", label);
  identifier(record, "streamId", label); integer(record, "boundSequence", label);
  hash(record, "boundRecordHash", label); timestamp(record, "createdAt", label);
  hash(record, "valueHash", label); integer(record, "valueBytes", label, 1, 16_777_216);
}

function validateKey(kind: OperationBaselineEntryKind, value: unknown): Record<string, unknown> {
  const record = detachedRecord(value, `${kind} key`);
  const id = (key: string) => identifier(record, key, `${kind} key`);
  switch (kind) {
    case "schema-envelope": exact(record, ["scope"], `${kind} key`); if (record.scope !== "cycle-store") invalid(`${kind} key.scope`); break;
    case "migration-lineage": exact(record, ["version"], `${kind} key`); integer(record, "version", `${kind} key`, 1); break;
    case "stream-head": exact(record, ["streamId", "tenantId"], `${kind} key`); id("streamId"); id("tenantId"); break;
    case "record-identity": exact(record, ["recordId", "tenantId"], `${kind} key`); id("recordId"); id("tenantId"); break;
    case "checkpoint-current": exact(record, ["checkpointId", "checkpointScope", "tenantId"], `${kind} key`); id("checkpointId"); id("checkpointScope"); id("tenantId"); break;
    case "checkpoint-revision": exact(record, ["checkpointScope", "revision", "tenantId"], `${kind} key`); id("checkpointScope"); integer(record, "revision", `${kind} key`, 1); id("tenantId"); break;
    case "lease-current": exact(record, ["streamId", "tenantId"], `${kind} key`); id("streamId"); id("tenantId"); break;
    case "used-lease-identity": exact(record, ["leaseId", "streamId", "tenantId"], `${kind} key`); id("leaseId"); id("streamId"); id("tenantId"); break;
    case "legal-hold": exact(record, ["holdId", "streamId", "tenantId"], `${kind} key`); id("holdId"); id("streamId"); id("tenantId"); break;
    case "migration-lock-current": exact(record, ["singleton"], `${kind} key`); if (integer(record, "singleton", `${kind} key`, 1, 1) !== 1) invalid(`${kind} key.singleton`); break;
    case "used-migration-lock-identity": exact(record, ["lockId"], `${kind} key`); id("lockId"); break;
    case "legacy-operation": exact(record, ["operationId", "tenantId"], `${kind} key`); id("operationId"); id("tenantId"); break;
  }
  return record;
}

function validateState(kind: OperationBaselineEntryKind, value: unknown): Record<string, unknown> {
  const record = detachedRecord(value, `${kind} state`);
  const label = `${kind} state`;
  const id = (key: string) => identifier(record, key, label);
  const time = (key: string) => integer(record, key, label);
  switch (kind) {
    case "schema-envelope":
      exact(record, ["createdAtMs", "currentVersion", "latestMigrationAppliedAtMs", "latestMigrationSha256", "maxReaderVersion", "maxWriterVersion", "minReaderVersion", "minWriterVersion", "providerDescriptorHash", "schemaIdentitySha256", "updatedAtMs"], label);
      time("createdAtMs"); integer(record, "currentVersion", label, 1, 1); time("latestMigrationAppliedAtMs"); hash(record, "latestMigrationSha256", label);
      for (const key of ["maxReaderVersion", "maxWriterVersion", "minReaderVersion", "minWriterVersion"] as const) integer(record, key, label, 1, 1);
      hash(record, "providerDescriptorHash", label); hash(record, "schemaIdentitySha256", label); time("updatedAtMs");
      if ((record.updatedAtMs as number) < (record.createdAtMs as number)) invalid(`${label}.timestamps`);
      break;
    case "migration-lineage":
      exact(record, ["appliedAtMs", "migrationId", "postconditions", "previousVersion", "reversibility", "schemaIdentitySha256", "sqlSha256", "version"], label);
      time("appliedAtMs"); id("migrationId");
      {
        const postconditions = detachedRecord(record.postconditions, `${label}.postconditions`);
        exact(postconditions, ["requiredPostconditions"], `${label}.postconditions`);
        if (!Array.isArray(postconditions.requiredPostconditions)
          || postconditions.requiredPostconditions.length === 0
          || postconditions.requiredPostconditions.some((item) => typeof item !== "string" || item.length === 0)) invalid(`${label}.postconditions.requiredPostconditions`);
      }
      integer(record, "previousVersion", label, 0);
      if (record.reversibility !== "rebuild-from-verified-backup-only") invalid(`${label}.reversibility`);
      hash(record, "schemaIdentitySha256", label); hash(record, "sqlSha256", label); integer(record, "version", label, 1);
      if (record.previousVersion !== (record.version as number) - 1) invalid(`${label}.version edge`);
      break;
    case "stream-head":
      exact(record, ["createdAtMs", "streamId", "tailRecordHash", "tailSequence", "tenantId", "updatedAtMs"], label);
      time("createdAtMs"); id("streamId"); nullableString(record, "tailRecordHash", label, HASH); integer(record, "tailSequence", label, -1); id("tenantId"); time("updatedAtMs");
      if ((record.tailSequence === -1) !== (record.tailRecordHash === null)) invalid(`${label}.tail identity`);
      if ((record.updatedAtMs as number) < (record.createdAtMs as number)) invalid(`${label}.timestamps`);
      break;
    case "record-identity":
      exact(record, ["committedAtMs", "previousRecordHash", "recordHash", "recordId", "sequence", "streamId", "tenantId", "valueBytes", "valueHash"], label);
      time("committedAtMs"); nullableString(record, "previousRecordHash", label, HASH); hash(record, "recordHash", label); id("recordId"); integer(record, "sequence", label); id("streamId"); id("tenantId"); integer(record, "valueBytes", label, 1, 1_048_576); hash(record, "valueHash", label);
      if ((record.sequence === 0) !== (record.previousRecordHash === null)) invalid(`${label}.predecessor`);
      break;
    case "checkpoint-current":
      exact(record, ["boundRecordHash", "boundSequence", "checkpointId", "checkpointRevision", "checkpointScope", "committedAtMs", "createdAt", "streamId", "summary", "tenantId", "valueBytes", "valueHash"], label);
      hash(record, "boundRecordHash", label); integer(record, "boundSequence", label); id("checkpointId"); integer(record, "checkpointRevision", label, 1); id("checkpointScope"); time("committedAtMs"); timestamp(record, "createdAt", label); id("streamId"); if (record.summary === null) invalid(`${label}.summary`); checkpointSummary(record.summary, label); id("tenantId"); integer(record, "valueBytes", label, 1, 16_777_216); hash(record, "valueHash", label); validateCheckpointSummaryIdentity(kind, record); break;
    case "checkpoint-revision": {
      exact(record, ["action", "boundRecordHash", "boundSequence", "checkpointCreatedAt", "checkpointId", "checkpointScope", "recordedAtMs", "revision", "summary", "tenantId", "valueBytes", "valueHash"], label);
      const action = string(record, "action", label); if (action !== "put" && action !== "delete") invalid(`${label}.action`);
      nullableString(record, "boundRecordHash", label, HASH); nullableInteger(record, "boundSequence", label); nullableTimestamp(record, "checkpointCreatedAt", label); id("checkpointId"); id("checkpointScope"); time("recordedAtMs"); integer(record, "revision", label, 1); checkpointSummary(record.summary, label); id("tenantId"); nullableInteger(record, "valueBytes", label); nullableString(record, "valueHash", label, HASH);
      const nullable = ["boundRecordHash", "boundSequence", "checkpointCreatedAt", "summary", "valueBytes", "valueHash"] as const;
      if (action === "put" ? nullable.some((key) => record[key] === null) : nullable.some((key) => record[key] !== null)) invalid(`${label}.${action}`);
      validateCheckpointSummaryIdentity(kind, record);
      break;
    }
    case "lease-current":
      exact(record, ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken", "activeHolderId", "activeLeaseEpoch", "activeLeaseId", "lastFencingToken", "lastLeaseEpoch", "streamId", "tenantId", "updatedAtMs"], label);
      for (const key of ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken", "activeLeaseEpoch"] as const) nullableInteger(record, key, label);
      for (const key of ["activeHolderId", "activeLeaseId"] as const) nullableString(record, key, label);
      integer(record, "lastFencingToken", label); integer(record, "lastLeaseEpoch", label); id("streamId"); id("tenantId"); time("updatedAtMs");
      {
        const active = ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken", "activeHolderId", "activeLeaseEpoch", "activeLeaseId"] as const;
        const nullCount = active.filter((key) => record[key] === null).length;
        if (nullCount !== 0 && nullCount !== active.length) invalid(`${label}.active identity`);
        if (record.lastFencingToken !== record.lastLeaseEpoch
          || (nullCount === 0 && (record.activeFencingToken !== record.activeLeaseEpoch
            || record.activeFencingToken !== record.lastFencingToken
            || (record.activeFencingToken as number) < 1
            || (record.activeExpiresAtMs as number) <= (record.activeAcquiredAtMs as number)))) invalid(`${label}.epoch/fence identity`);
      }
      break;
    case "used-lease-identity":
      exact(record, ["fencingToken", "firstUsedAtMs", "leaseEpoch", "leaseId", "streamId", "tenantId"], label); integer(record, "fencingToken", label, 1); time("firstUsedAtMs"); integer(record, "leaseEpoch", label, 1); id("leaseId"); id("streamId"); id("tenantId"); if (record.fencingToken !== record.leaseEpoch) invalid(`${label}.epoch/fence identity`); break;
    case "legal-hold":
      exact(record, ["holdId", "placedAtMs", "streamId", "tenantId"], label); id("holdId"); time("placedAtMs"); id("streamId"); id("tenantId"); break;
    case "migration-lock-current":
      exact(record, ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken", "activeLockEpoch", "activeLockId", "activeOwnerId", "activeSourceVersion", "activeTargetVersion", "lastFencingToken", "lastLockEpoch", "singleton", "updatedAtMs"], label);
      for (const key of ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken", "activeLockEpoch", "activeSourceVersion", "activeTargetVersion"] as const) nullableInteger(record, key, label);
      nullableString(record, "activeLockId", label); nullableString(record, "activeOwnerId", label); integer(record, "lastFencingToken", label); integer(record, "lastLockEpoch", label); integer(record, "singleton", label, 1, 1); time("updatedAtMs");
      {
        const active = ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken", "activeLockEpoch", "activeLockId", "activeOwnerId", "activeSourceVersion", "activeTargetVersion"] as const;
        const nullCount = active.filter((key) => record[key] === null).length;
        if (nullCount !== 0 && nullCount !== active.length) invalid(`${label}.active identity`);
        if (record.lastFencingToken !== record.lastLockEpoch
          || (nullCount === 0 && (record.activeFencingToken !== record.activeLockEpoch
            || record.activeFencingToken !== record.lastFencingToken
            || (record.activeFencingToken as number) < 1
            || (record.activeSourceVersion as number) < 1
            || (record.activeTargetVersion as number) < 2
            || (record.activeTargetVersion as number) <= (record.activeSourceVersion as number)
            || (record.activeExpiresAtMs as number) <= (record.activeAcquiredAtMs as number)))) invalid(`${label}.epoch/fence identity`);
      }
      break;
    case "used-migration-lock-identity":
      exact(record, ["fencingToken", "firstUsedAtMs", "lockEpoch", "lockId"], label); integer(record, "fencingToken", label, 1); time("firstUsedAtMs"); integer(record, "lockEpoch", label, 1); id("lockId"); if (record.fencingToken !== record.lockEpoch) invalid(`${label}.epoch/fence identity`); break;
    case "legacy-operation":
      exact(record, ["committedAtMs", "operationId", "operationName", "requestHash", "resultBlobSha256", "resultHash", "tenantId"], label); time("committedAtMs"); id("operationId"); if (!LEGACY_OPERATION_NAMES.has(nonempty(record, "operationName", label))) invalid(`${label}.operationName`); hash(record, "requestHash", label); hash(record, "resultBlobSha256", label); hash(record, "resultHash", label); id("tenantId"); break;
  }
  return record;
}

function validateCheckpointSummaryIdentity(
  kind: "checkpoint-current" | "checkpoint-revision",
  state: Record<string, unknown>,
): void {
  if (kind === "checkpoint-revision" && state.action !== "put") return;
  const summary = state.summary as Record<string, unknown>;
  const pairs = kind === "checkpoint-current"
    ? ([
        ["checkpointScope", "checkpointScope"], ["checkpointId", "checkpointId"],
        ["streamId", "streamId"], ["boundSequence", "boundSequence"],
        ["boundRecordHash", "boundRecordHash"], ["createdAt", "createdAt"],
        ["valueHash", "valueHash"], ["valueBytes", "valueBytes"],
      ] as const)
    : ([
        ["checkpointScope", "checkpointScope"], ["checkpointId", "checkpointId"],
        ["boundSequence", "boundSequence"], ["boundRecordHash", "boundRecordHash"],
        ["checkpointCreatedAt", "createdAt"], ["valueHash", "valueHash"],
        ["valueBytes", "valueBytes"],
      ] as const);
  if (pairs.some(([stateField, summaryField]) => state[stateField] !== summary[summaryField])) {
    invalid(`${kind} summary identity`);
  }
}

function canonicalBytes(value: unknown, minimum: number, maximum: number, label: string): Buffer {
  let bytes: Buffer;
  try { bytes = bufferFromIntrinsic(canonicalSerialize(value), "utf8"); } catch { return invalid(label); }
  if (bytes.byteLength < minimum || bytes.byteLength > maximum) return invalid(`${label} byte length`);
  return bytes;
}

function validateEntryIdentity(
  kind: OperationBaselineEntryKind,
  key: Record<string, unknown>,
  state: Record<string, unknown>,
): void {
  const shared: Readonly<Record<OperationBaselineEntryKind, readonly string[]>> = {
    "schema-envelope": [],
    "migration-lineage": ["version"],
    "stream-head": ["streamId", "tenantId"],
    "record-identity": ["recordId", "tenantId"],
    "checkpoint-current": ["checkpointId", "checkpointScope", "tenantId"],
    "checkpoint-revision": ["checkpointScope", "revision", "tenantId"],
    "lease-current": ["streamId", "tenantId"],
    "used-lease-identity": ["leaseId", "streamId", "tenantId"],
    "legal-hold": ["holdId", "streamId", "tenantId"],
    "migration-lock-current": ["singleton"],
    "used-migration-lock-identity": ["lockId"],
    "legacy-operation": ["operationId", "tenantId"],
  };
  if (shared[kind].some((field) => key[field] !== state[field])) {
    invalid(`${kind} key/state identity`);
  }

}

export function encodeOperationBaselinePolicy(): Buffer {
  return canonicalBytes(OPERATION_BASELINE_POLICY, 2, MAX_BASELINE_POLICY_BYTES, "policy");
}

export function encodeOperationBaselineSourceEnvelope(value: unknown): Buffer {
  const record = detachedRecord(value, "source envelope");
  exact(record, ["capturedAtMs", "sourceApplicationId", "sourceDescriptorHash", "sourceMigrationLineageId", "sourceMigrationLineageSha256", "sourceSchemaIdentitySha256", "sourceUserVersion"], "source envelope");
  integer(record, "capturedAtMs", "source envelope");
  integer(record, "sourceApplicationId", "source envelope", 1195724359, 1195724359);
  hash(record, "sourceDescriptorHash", "source envelope"); identifier(record, "sourceMigrationLineageId", "source envelope");
  hash(record, "sourceMigrationLineageSha256", "source envelope"); hash(record, "sourceSchemaIdentitySha256", "source envelope"); integer(record, "sourceUserVersion", "source envelope", 1, 1);
  return bufferFromIntrinsic(canonicalSerialize(record), "utf8");
}

export function createOperationBaselineId(value: unknown): string {
  const encoded = encodeOperationBaselineSourceEnvelope(value);
  const envelope = JSON.parse(
    reflectApplyIntrinsic(bufferToStringIntrinsic, encoded, ["utf8"]) as string,
  ) as unknown;
  return `v2-${operationBaselineDomainHash(BASELINE_ID_DOMAIN, envelope)}`;
}

export function encodeOperationBaselineKey(kind: OperationBaselineEntryKind, value: unknown): Buffer {
  if (!KIND_RANK.has(kind)) return invalid("entry kind");
  return canonicalBytes(validateKey(kind, value), 2, MAX_BASELINE_KEY_BYTES, `${kind} key`);
}

export function encodeOperationBaselineState(kind: OperationBaselineEntryKind, value: unknown): Buffer {
  if (!KIND_RANK.has(kind)) return invalid("entry kind");
  return canonicalBytes(validateState(kind, value), 2, MAX_BASELINE_STATE_BYTES, `${kind} state`);
}

export function decodeOperationBaselineCanonicalBytes(bytes: Uint8Array, maximum: number): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2 || bytes.byteLength > maximum) return invalid("canonical bytes");
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    if (canonicalSerialize(parsed) !== text) return invalid("canonical bytes");
    return parsed;
  } catch (error) {
    if (error instanceof OperationBaselineError) throw error;
    return invalid("canonical bytes");
  }
}

/**
 * Revalidate canonical entry bytes against the selected kind and its
 * key/state identity contract. This is intentionally not re-exported from the
 * package root; transaction-bound staging uses it as a module-internal gate.
 */
export function validateOperationBaselineEntryBytes(
  entryKind: OperationBaselineEntryKind,
  keyBytes: Uint8Array,
  stateBytes: Uint8Array,
): void {
  const key = decodeOperationBaselineCanonicalBytes(keyBytes, MAX_BASELINE_KEY_BYTES);
  const state = decodeOperationBaselineCanonicalBytes(stateBytes, MAX_BASELINE_STATE_BYTES);
  const prepared = prepareOperationBaselineEntry({ entryKind, key, state });
  if (!(reflectApplyIntrinsic(bufferEqualsIntrinsic, prepared.keyBytes, [keyBytes]) as boolean)
      || !(reflectApplyIntrinsic(
        bufferEqualsIntrinsic, prepared.stateBytes, [stateBytes],
      ) as boolean)) {
    invalid("entry canonical bytes");
  }
}

interface PreparedOperationBaselineEntry {
  readonly entryKind: OperationBaselineEntryKind;
  readonly rank: number;
  readonly key: Record<string, unknown>;
  readonly keyBytes: Buffer;
  readonly state: Record<string, unknown>;
  readonly stateBytes: Buffer;
}

function validateBaselineId(baselineId: string): void {
  if (!/^v2-[0-9a-f]{64}$/u.test(baselineId)) invalid("baseline ID");
}

function prepareOperationBaselineEntry(input: OperationBaselineEntryInput): PreparedOperationBaselineEntry {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return invalid("entry");
  const rank = KIND_RANK.get(input.entryKind);
  if (rank === undefined) return invalid("entry kind");
  const key = validateKey(input.entryKind, input.key);
  const state = validateState(input.entryKind, input.state);
  validateEntryIdentity(input.entryKind, key, state);
  return {
    entryKind: input.entryKind,
    rank,
    key,
    keyBytes: canonicalBytes(key, 2, MAX_BASELINE_KEY_BYTES, `${input.entryKind} key`),
    state,
    stateBytes: canonicalBytes(state, 2, MAX_BASELINE_STATE_BYTES, `${input.entryKind} state`),
  };
}

function immutableCanonicalEntry(
  baselineId: string,
  entry: PreparedOperationBaselineEntry,
  ordinal: number,
  previousEntryHash: string,
): CanonicalOperationBaselineEntry {
  const entryHash = operationBaselineDomainHash(BASELINE_ENTRY_DOMAIN, {
    baselineId,
    entryKeySha256: sha256(entry.keyBytes),
    entryKind: entry.entryKind,
    entryStateSha256: sha256(entry.stateBytes),
    ordinal,
    previousEntryHash,
  });
  const keyBytes = bufferFromIntrinsic(entry.keyBytes);
  const stateBytes = bufferFromIntrinsic(entry.stateBytes);
  return objectFreezeIntrinsic({
    baselineId,
    entryKind: entry.entryKind,
    ordinal,
    get keyBytes(): Buffer { return bufferFromIntrinsic(keyBytes); },
    get stateBytes(): Buffer { return bufferFromIntrinsic(stateBytes); },
    previousEntryHash,
    entryHash,
  });
}

/**
 * Incrementally derives an operation-baseline identity from entries that are
 * already ordered by kind rank and unsigned canonical key bytes.
 *
 * The accumulator retains only its hash/count summary and the immediately
 * preceding key. Callers own persistence of each immutable entry returned by
 * {@link append}.
 */
export class OperationBaselineAccumulator {
  readonly #baselineId: string;
  readonly #expectedEntryCount: number;
  #acceptedCount = 0;
  #legacyCount = 0;
  #firstHash = BASELINE_EMPTY_ROOT;
  #finalHash = BASELINE_EMPTY_ROOT;
  #previousRank: number | undefined;
  #previousKeyBytes: Buffer | undefined;
  #sealedIdentity: OperationBaselineProjectionIdentity | undefined;

  constructor(baselineId: string, expectedEntryCount: number) {
    validateBaselineId(baselineId);
    if (!Number.isSafeInteger(expectedEntryCount) || expectedEntryCount < 0) {
      invalid("expected entry count");
    }
    this.#baselineId = baselineId;
    this.#expectedEntryCount = expectedEntryCount;
  }

  get baselineId(): string {
    return this.#baselineId;
  }

  get expectedEntryCount(): number {
    return this.#expectedEntryCount;
  }

  get entryCount(): number {
    return this.#acceptedCount;
  }

  get isFinished(): boolean {
    return this.#sealedIdentity !== undefined;
  }

  append(input: OperationBaselineEntryInput): CanonicalOperationBaselineEntry {
    if (this.#sealedIdentity !== undefined) invalid("append after finish");
    if (this.#acceptedCount >= this.#expectedEntryCount) invalid("entry count overflow");

    // All potentially throwing work happens before any accumulator field is
    // advanced, making rejected appends observationally atomic.
    const prepared = prepareOperationBaselineEntry(input);
    if (this.#previousRank !== undefined) {
      if (prepared.rank < this.#previousRank) invalid("entry kind order");
      if (prepared.rank === this.#previousRank) {
        const order = bufferCompareIntrinsic(prepared.keyBytes, this.#previousKeyBytes!);
        if (order === 0) invalid("duplicate entry key");
        if (order < 0) invalid("entry key order");
      }
    }
    const previousEntryHash = this.#acceptedCount === 0
      ? BASELINE_GENESIS_HASH
      : this.#finalHash;
    const result = immutableCanonicalEntry(
      this.#baselineId,
      prepared,
      this.#acceptedCount,
      previousEntryHash,
    );
    const nextKeyBytes = bufferFromIntrinsic(prepared.keyBytes);

    this.#acceptedCount += 1;
    this.#legacyCount += prepared.entryKind === "legacy-operation" ? 1 : 0;
    if (result.ordinal === 0) this.#firstHash = result.entryHash;
    this.#finalHash = result.entryHash;
    this.#previousRank = prepared.rank;
    this.#previousKeyBytes = nextKeyBytes;
    return result;
  }

  finish(): OperationBaselineProjectionIdentity {
    if (this.#sealedIdentity !== undefined) return this.#sealedIdentity;
    if (this.#acceptedCount !== this.#expectedEntryCount) invalid("entry count truncation");
    const identity = objectFreezeIntrinsic({
      baselineId: this.#baselineId,
      entryCount: this.#acceptedCount,
      firstEntryHash: this.#firstHash,
      finalEntryHash: this.#finalHash,
      legacyOperationCount: this.#legacyCount,
      projectionSha256: operationBaselineDomainHash(BASELINE_PROJECTION_DOMAIN, {
        baselineId: this.#baselineId,
        entryCount: this.#acceptedCount,
        finalEntryHash: this.#finalHash,
        firstEntryHash: this.#firstHash,
        legacyOperationCount: this.#legacyCount,
      }),
    });
    this.#sealedIdentity = identity;
    return identity;
  }
}

export function buildOperationBaseline(
  baselineId: string,
  inputs: readonly OperationBaselineEntryInput[],
): OperationBaselineProjection {
  validateBaselineId(baselineId);
  if (!Array.isArray(inputs) || inputs.length > Number.MAX_SAFE_INTEGER) return invalid("entries");
  const prepared = inputs.map(prepareOperationBaselineEntry)
    .sort((left, right) => left.rank - right.rank
      || bufferCompareIntrinsic(left.keyBytes, right.keyBytes));

  // Only clean, detached canonical values reach the accumulator. Re-encoding
  // them there intentionally proves the materializing and streaming paths are
  // byte-compatible and leaves one chain/projection implementation.
  const accumulator = new OperationBaselineAccumulator(baselineId, prepared.length);
  const entries = prepared.map((entry) => accumulator.append({
    entryKind: entry.entryKind,
    key: entry.key,
    state: entry.state,
  }));
  const identity = accumulator.finish();
  return objectFreezeIntrinsic({ ...identity, entries: objectFreezeIntrinsic(entries) });
}
