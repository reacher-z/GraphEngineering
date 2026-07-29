import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { canonicalSerialize } from "@graph-engineering/core";
import {
  CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
  cycleStoreAdapterCodec,
  type CycleStoreCheckpointSummary,
} from "@graph-engineering/runtime";

import {
  MAX_SQLITE_CURSOR_REQUEST_SCOPE_BYTES,
  MAX_SQLITE_CURSOR_SNAPSHOT_BYTES,
  MIN_SQLITE_CURSOR_BLOB_BYTES,
  decodeSQLiteCursorSealRow,
  type SQLiteCursorSealRow,
} from "./operation-baseline-cursor-invariants.js";

const HASH = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

function validIdentifier(value: string): boolean {
  return IDENTIFIER.test(value) && value !== "." && value !== "..";
}

export type SQLiteCursorStageValue = string | number | bigint | Buffer | null;

export interface SQLiteCursorInspectionContext {
  readonly sourceOrdinal: number;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly providerHighWaterAtMs: number;
  readonly eventTailExists: (
    tenantId: string, streamId: string, sequence: number, recordHash: string,
  ) => boolean;
  readonly checkpointPutExists: (
    tenantId: string, checkpointScope: string, checkpointId: string, summaryBlob: Buffer,
  ) => boolean;
}

export interface SQLiteCursorInspection {
  /** Pre-stage rule 1 evidence for a physical row that cannot be keyed in TEMP. */
  readonly preStageAuthorization: boolean;
  /** Pre-stage rule 8 evidence for a physical row that cannot be represented in TEMP. */
  readonly preStageShape: boolean;
  readonly stageValues: readonly SQLiteCursorStageValue[];
  readonly stageable: boolean;
  readonly sealRow?: SQLiteCursorSealRow;
}

interface CanonicalBlob {
  readonly byteLength: number;
  readonly sha256: string;
  readonly decoded: unknown;
}

function canonicalBlob(value: unknown, maximum: number): CanonicalBlob | undefined {
  if (!(value instanceof Uint8Array)) return undefined;
  const bytes = Buffer.isBuffer(value)
    ? value
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.byteLength < MIN_SQLITE_CURSOR_BLOB_BYTES || bytes.byteLength > maximum) {
    return undefined;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const decoded = JSON.parse(text) as unknown;
    if (canonicalSerialize(decoded) !== text) return undefined;
    return Object.freeze({
      byteLength: bytes.byteLength,
      decoded,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } catch {
    return undefined;
  }
}

function exactCanonical(value: unknown, expected: unknown): boolean {
  try {
    return canonicalSerialize(value) === canonicalSerialize(expected);
  } catch {
    return false;
  }
}

function normalizedInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "bigint" && value >= BigInt(-MAX_SAFE) && value <= BigInt(MAX_SAFE)) {
    return Number(value);
  }
  return undefined;
}

function safeInteger(value: unknown, minimum = 0): boolean {
  const normalized = normalizedInteger(value);
  return normalized !== undefined && normalized >= minimum;
}

function nullableSafeInteger(value: unknown, minimum = 0): value is number | null {
  return value === null || safeInteger(value, minimum);
}

function integerStorage(value: unknown): boolean {
  return typeof value === "bigint"
    || (typeof value === "number" && Number.isInteger(value));
}

function nullableIntegerStorage(value: unknown): boolean {
  return value === null || integerStorage(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number {
  return normalizedInteger(value) ?? 0;
}

function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function compareCheckpointSummary(
  left: CycleStoreCheckpointSummary,
  right: CycleStoreCheckpointSummary,
): number {
  if (left.boundSequence !== right.boundSequence) return right.boundSequence - left.boundSequence;
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
  return Buffer.compare(Buffer.from(left.checkpointId), Buffer.from(right.checkpointId));
}

const SENTINEL_DOMAIN = Buffer.from(
  "graph-engineering/sqlite-cursor-inspection-sentinel/v1\0", "ascii",
);

function sentinelHash(ordinal: number, label: string): string {
  return createHash("sha256").update(SENTINEL_DOMAIN)
    .update(`${ordinal}:${label}`, "ascii").digest("hex");
}

function sentinelIdentifier(ordinal: number, label: string): string {
  // `!` is outside the legal main-table identifier alphabet. TEMP accepts
  // arbitrary TEXT, so a legal tenant can never preoccupy this namespace;
  // the source ordinal then makes every invalid identifier mapping unique.
  return `!ge-invalid-${ordinal}-${label}`;
}

function sentinelToken(ordinal: number): string {
  // Main token hashes are exactly 64 lowercase hexadecimal characters.  The
  // TEMP table deliberately has no hash CHECK because diagnosed rows must be
  // stageable, so keep invalid tokens in a namespace that no valid main token
  // can occupy.  The ordinal prevents two hostile rows for one tenant from
  // colliding with each other in the composite TEMP primary key.
  return `!ge-invalid-token-${ordinal}`;
}

function integerOr(value: unknown, fallback: number, minimum = 0): number {
  const normalized = normalizedInteger(value);
  return normalized !== undefined && normalized >= minimum ? normalized : fallback;
}

function nullableIntegerOr(value: unknown, fallback: number, minimum = 0): number | null {
  return value === null ? null : integerOr(value, fallback, minimum);
}

/**
 * Inspect one physical cursor without retaining either raw BLOB or decoded
 * snapshot. Independent rule flags deliberately avoid cascade diagnostics.
 */
export function inspectSQLiteCursorRow(
  value: unknown,
  context: SQLiteCursorInspectionContext,
): SQLiteCursorInspection {
  if (!Number.isSafeInteger(context.sourceOrdinal) || context.sourceOrdinal < 0) {
    throw new TypeError("cursor source ordinal is invalid");
  }
  const physical = Array.isArray(value) ? value : [];
  const arityOk = physical.length === 18;
  const row: unknown[] = [];
  // Match SQLite/Python's NULL padding for absent physical columns even
  // though wrong-arity rows remain nonstageable. This keeps the bounded
  // diagnostic carrier deterministic if that policy is ever relaxed.
  for (let index = 0; index < 18; index += 1) {
    row.push(index < physical.length ? physical[index] : null);
  }
  const tenantId = text(row[0]);
  const tokenHash = text(row[1]);
  const kind = text(row[2]);
  const principalHash = text(row[3]);
  const authorizationHash = text(row[4]);
  const streamId = nullableText(row[5]);
  const checkpointScope = nullableText(row[6]);
  const pageSize = integer(row[8]);
  const nextPosition = integer(row[9]);
  const tailSequence = nullableInteger(row[10]);
  const tailHash = nullableText(row[11]);
  const descriptorHash = text(row[12]);
  const schemaIdentity = text(row[13]);
  const createdAt = integer(row[15]);
  const expiresAt = integer(row[16]);
  const consumedAt = nullableInteger(row[17]);

  const requestBlob = canonicalBlob(row[7], MAX_SQLITE_CURSOR_REQUEST_SCOPE_BYTES);
  const snapshotBlob = canonicalBlob(row[14], MAX_SQLITE_CURSOR_SNAPSHOT_BYTES);
  const asBufferView = (item: Uint8Array): Buffer => Buffer.isBuffer(item)
    ? item : Buffer.from(item.buffer, item.byteOffset, item.byteLength);
  const requestBytes = row[7] instanceof Uint8Array ? asBufferView(row[7]) : Buffer.alloc(0);
  const snapshotBytes = row[14] instanceof Uint8Array ? asBufferView(row[14]) : Buffer.alloc(0);

  const storageOk = arityOk
    && row.slice(0, 5).every((item) => typeof item === "string")
    && (row[5] === null || typeof row[5] === "string")
    && (row[6] === null || typeof row[6] === "string")
    && row[7] instanceof Uint8Array
    && integerStorage(row[8]) && integerStorage(row[9])
    && nullableIntegerStorage(row[10])
    && (row[11] === null || typeof row[11] === "string")
    && typeof row[12] === "string" && typeof row[13] === "string"
    && row[14] instanceof Uint8Array
    && integerStorage(row[15]) && integerStorage(row[16])
    && nullableIntegerStorage(row[17]);
  const authorizationStorageOk = arityOk
    && [row[0], row[1], row[3], row[4]].every((item) => typeof item === "string");
  const authorizationOk = !authorizationStorageOk || (
    validIdentifier(tenantId) && HASH.test(tokenHash)
      && HASH.test(principalHash) && HASH.test(authorizationHash)
  );
  const scopeLexicalOk = (streamId === null || validIdentifier(streamId))
    && (checkpointScope === null || validIdentifier(checkpointScope));
  const shapeOk = storageOk;
  const keyIdentityOk = typeof row[0] === "string" && typeof row[1] === "string";
  const stageable = arityOk && keyIdentityOk;
  // A nonstageable row has no trustworthy unique bounded TEMP key. Preserve
  // both independent facts explicitly: authorization/key identity is absent
  // and the physical row shape cannot be represented. The campaign counts the
  // row as walked but never manufactures a TEMP row for it.
  const preStageAuthorization = !keyIdentityOk;
  const preStageShape = !stageable;
  const scopeStorageOk = arityOk && typeof row[2] === "string"
    && (row[5] === null || typeof row[5] === "string")
    && (row[6] === null || typeof row[6] === "string")
    && row[7] instanceof Uint8Array && integerStorage(row[8]);
  let scopeOk = !scopeStorageOk || ((kind === "event"
    ? streamId !== null && checkpointScope === null
    : kind === "checkpoint" && streamId === null && checkpointScope !== null)
    && scopeLexicalOk);
  const requestPage = normalizedInteger(row[8]);
  if (scopeStorageOk && requestBlob !== undefined && scopeOk && requestPage !== undefined
      && requestPage >= 1 && requestPage <= 256) {
    const expected = kind === "event"
      ? { contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION, pageSize, streamId }
      : { checkpointScope, contractVersion: CYCLE_STORE_PROVIDER_CONTRACT_VERSION, pageSize };
    scopeOk = exactCanonical(requestBlob.decoded, expected);
  }
  const blobStorageOk = arityOk
    && row[7] instanceof Uint8Array && row[14] instanceof Uint8Array;
  const blobsOk = !blobStorageOk
    || (requestBlob !== undefined && snapshotBlob !== undefined);
  const pageInteger = normalizedInteger(row[8]);
  const nextInteger = normalizedInteger(row[9]);
  const positionStorageOk = arityOk && typeof row[2] === "string"
    && integerStorage(row[8]) && integerStorage(row[9])
    && nullableIntegerStorage(row[10])
    && (row[11] === null || typeof row[11] === "string")
    && row[14] instanceof Uint8Array;
  let positionOk = !positionStorageOk || (
    pageInteger !== undefined && nextInteger !== undefined
      && pageInteger >= 1 && pageInteger <= 256 && nextInteger >= 0
  );
  let eventBindingOk = true;
  let checkpointBindingOk = true;

  const tailInteger = row[10] === null ? null : normalizedInteger(row[10]);
  if (kind === "event" && positionStorageOk) {
    if (row[10] === null) positionOk = false;
    else if (integerStorage(row[10])
        && (tailInteger === undefined || tailInteger === null || tailInteger < -1)) positionOk = false;
  }
  if (kind === "event" && positionStorageOk && snapshotBlob !== undefined
      && validIdentifier(tenantId)
      && streamId !== null && validIdentifier(streamId) && row[10] !== null && tailInteger !== undefined
      && tailInteger !== null && tailInteger >= -1) {
    const semanticTail = tailInteger ?? 0;
    const tailTupleOk = semanticTail === -1 ? tailHash === null : HASH.test(tailHash ?? "");
    const expectedTail = {
      exists: semanticTail !== -1,
      recordHash: tailHash,
      sequence: semanticTail,
    };
    eventBindingOk = tailTupleOk && exactCanonical(snapshotBlob.decoded, expectedTail);
    if (semanticTail === -1) positionOk = positionOk && nextPosition === 0;
    else {
      positionOk = positionOk && nextPosition <= semanticTail;
      eventBindingOk = eventBindingOk && tailHash !== null
        && context.eventTailExists(tenantId, streamId, semanticTail, tailHash);
    }
  }

  if (arityOk && kind === "checkpoint" && snapshotBlob !== undefined
      && validIdentifier(tenantId) && checkpointScope !== null
      && validIdentifier(checkpointScope)) {
    if (!Array.isArray(snapshotBlob.decoded)) checkpointBindingOk = false;
    else {
      positionOk = positionOk && nextPosition <= snapshotBlob.decoded.length;
      let previous: CycleStoreCheckpointSummary | undefined;
      for (const item of snapshotBlob.decoded) {
        let summary: CycleStoreCheckpointSummary;
        let encoded: Buffer;
        try {
          encoded = Buffer.from(canonicalSerialize(item));
          const originalEncoded = encoded;
          summary = cycleStoreAdapterCodec.decodeLedgerResult("save-checkpoint", encoded);
          encoded = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", summary));
          if (!encoded.equals(originalEncoded)) {
            checkpointBindingOk = false;
            break;
          }
        } catch {
          checkpointBindingOk = false;
          break;
        }
        if (summary.checkpointScope !== checkpointScope
            || (previous !== undefined && compareCheckpointSummary(previous, summary) >= 0)
            || !context.checkpointPutExists(
              tenantId, checkpointScope, summary.checkpointId, encoded,
            )) {
          checkpointBindingOk = false;
        }
        previous = summary;
      }
    }
  }

  const createdInteger = normalizedInteger(row[15]);
  const expiresInteger = normalizedInteger(row[16]);
  const consumedInteger = row[17] === null ? null : normalizedInteger(row[17]);
  const clockStorageOk = integerStorage(row[15]) && integerStorage(row[16])
    && nullableIntegerStorage(row[17]) && arityOk;
  const clockOk = !clockStorageOk
    ? true
    : createdInteger === undefined || expiresInteger === undefined || consumedInteger === undefined
      ? false
    : createdInteger >= 0 && expiresInteger >= 0
      && expiresInteger > createdInteger
      && (consumedInteger === null || consumedInteger >= createdInteger)
      && createdInteger <= context.providerHighWaterAtMs
      && (consumedInteger === null || consumedInteger <= context.providerHighWaterAtMs);
  const catalogStorageOk = arityOk
    && typeof row[12] === "string" && typeof row[13] === "string";
  const catalogOk = !catalogStorageOk || (
    descriptorHash === context.sourceDescriptorHash
      && schemaIdentity === context.sourceSchemaIdentitySha256
  );
  const flags = [authorizationOk, scopeOk, blobsOk, positionOk, clockOk, catalogOk,
    shapeOk, eventBindingOk, checkpointBindingOk] as const;
  const eligible = flags.every(Boolean);
  const stagedToken = HASH.test(tokenHash)
    ? tokenHash : sentinelToken(context.sourceOrdinal);
  const stagedTenant = validIdentifier(tenantId)
    ? tenantId : sentinelIdentifier(context.sourceOrdinal, "tenant");
  const mutableStageValues: SQLiteCursorStageValue[] = [
    stagedToken, stagedTenant, kind === "event" || kind === "checkpoint" ? kind : "event",
    HASH.test(principalHash) ? principalHash : sentinelHash(context.sourceOrdinal, "principal"),
    HASH.test(authorizationHash) ? authorizationHash
      : sentinelHash(context.sourceOrdinal, "authorization"),
    streamId === null || validIdentifier(streamId)
      ? streamId : sentinelIdentifier(context.sourceOrdinal, "stream"),
    checkpointScope === null || validIdentifier(checkpointScope)
      ? checkpointScope : sentinelIdentifier(context.sourceOrdinal, "checkpoint"),
    requestBlob?.byteLength ?? requestBytes.byteLength,
    requestBlob?.sha256 ?? createHash("sha256").update(requestBytes).digest("hex"),
    integerOr(row[8], 1, 1), integerOr(row[9], 0), nullableIntegerOr(row[10], -1, -1),
    tailHash === null || HASH.test(tailHash)
      ? tailHash : sentinelHash(context.sourceOrdinal, "tail"),
    snapshotBlob?.byteLength ?? snapshotBytes.byteLength,
    snapshotBlob?.sha256 ?? createHash("sha256").update(snapshotBytes).digest("hex"),
    integerOr(row[15], 0), integerOr(row[16], 1), nullableIntegerOr(row[17], 0),
    HASH.test(descriptorHash) ? descriptorHash : sentinelHash(context.sourceOrdinal, "descriptor"),
    HASH.test(schemaIdentity) ? schemaIdentity : sentinelHash(context.sourceOrdinal, "schema"),
    ...flags.map((flag) => flag ? 1 : 0), eligible ? 1 : 0,
  ];
  if (!eligible) return Object.freeze({
    preStageAuthorization,
    preStageShape,
    stageValues: Object.freeze(mutableStageValues), stageable,
  });
  const strictRow = row.map((item, index) =>
    [8, 9, 10, 15, 16, 17].includes(index) && item !== null
      ? BigInt(integer(item))
      : item);
  try {
    const sealRow = decodeSQLiteCursorSealRow(strictRow);
    return Object.freeze({
      preStageAuthorization,
      preStageShape,
      sealRow,
      stageValues: Object.freeze(mutableStageValues),
      stageable,
    });
  } catch {
    // A tenant row must never escape the diagnostic reader. Any A1 invariant
    // not already allocated above belongs to the closed physical-shape rule.
    mutableStageValues[26] = 0;
    mutableStageValues[29] = 0;
    return Object.freeze({
      preStageAuthorization,
      preStageShape,
      stageValues: Object.freeze(mutableStageValues), stageable,
    });
  }
}
