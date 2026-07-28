import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { canonicalSerialize } from "@graph-engineering/core";
import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  sqliteBlob,
  sqliteNullableText,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "./sqlite-codec.js";

const OPERATION = "inspect-schema" as const;

/**
 * Frozen cursor-seal primitives for the pre-rebind half of the cursor campaign.
 *
 * This module is package-private on purpose: it is not re-exported from the
 * package index, it owns no SQL, no TEMP object and no lifecycle state, and it
 * never writes to a database. It freezes exactly one cross-runtime algorithm so
 * a later staging slice, and the Python counterpart, can agree byte for byte.
 *
 * Row carrier:
 *   carrierBytes = canonicalSerialize(carrier) encoded as UTF-8
 *   rowDigest    = SHA-256(ROW_DOMAIN || u64be(carrierBytes.length) || carrierBytes)
 *
 * Streaming seal, ordinals are 1-based and assigned in canonical order:
 *   state0     = SHA-256(SEAL_DOMAIN || 0x00)
 *   stateN     = SHA-256(SEAL_DOMAIN || 0x01 || state(N-1) || u64be(N) || rowDigest)
 *   finalRoot  = hex(SHA-256(SEAL_DOMAIN || 0x02 || u64be(count) || stateCount))
 *
 * The carrier holds the fourteen immutable non-BLOB scalars plus the byte length
 * and lowercase SHA-256 of each BLOB, which is eighteen contributions for the
 * sixteen immutable physical fields. `descriptor_hash` and
 * `schema_identity_sha256` are strictly decoded and bound beside the carrier but
 * are excluded from it, because they are the only fields a later publication
 * rebind may change: flipping them must leave the immutable root untouched.
 */
export const SQLITE_CURSOR_SEAL_ROW_DOMAIN = "graph-engineering/sqlite-cursor-seal-row/v1\0";
export const SQLITE_CURSOR_SEAL_DOMAIN = "graph-engineering/sqlite-cursor-seal/v1\0";
export const SQLITE_CURSOR_SEAL_ALGORITHM_VERSION = "sqlite-cursor-seal/v1";

const ROW_DOMAIN_BYTES = Buffer.from(SQLITE_CURSOR_SEAL_ROW_DOMAIN, "utf8");
const SEAL_DOMAIN_BYTES = Buffer.from(SQLITE_CURSOR_SEAL_DOMAIN, "utf8");
const GENESIS_TAG = Buffer.of(0x00);
const ROW_TAG = Buffer.of(0x01);
const TERMINAL_TAG = Buffer.of(0x02);

export const SQLITE_CURSOR_COLUMN_COUNT = 18;
export const MIN_SQLITE_CURSOR_BLOB_BYTES = 2;
export const MAX_SQLITE_CURSOR_REQUEST_SCOPE_BYTES = 1_048_576;
export const MAX_SQLITE_CURSOR_SNAPSHOT_BYTES = 16_777_216;
export const MIN_SQLITE_CURSOR_PAGE_SIZE = 1;
export const MAX_SQLITE_CURSOR_PAGE_SIZE = 256;

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const HASH = /^[0-9a-f]{64}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** Physical `ge_cycle_cursors` columns in schema order; the reader arity is fixed. */
export const SQLITE_CURSOR_SEAL_SOURCE_COLUMNS = Object.freeze([
  "tenant_id",
  "token_hash",
  "kind",
  "principal_hash",
  "authorization_hash",
  "stream_id",
  "checkpoint_scope",
  "request_scope_blob",
  "page_size",
  "next_position",
  "snapshot_tail_sequence",
  "snapshot_tail_record_hash",
  "descriptor_hash",
  "schema_identity_sha256",
  "snapshot_blob",
  "created_at_ms",
  "expires_at_ms",
  "consumed_at_ms",
] as const);

/** The closed carrier field set, in canonical code-point order. */
export const SQLITE_CURSOR_SEAL_CARRIER_FIELDS = Object.freeze([
  "authorizationHash",
  "checkpointScope",
  "consumedAtMs",
  "createdAtMs",
  "expiresAtMs",
  "kind",
  "nextPosition",
  "pageSize",
  "principalHash",
  "requestScopeBlobSha256",
  "requestScopeByteLength",
  "snapshotBlobSha256",
  "snapshotByteLength",
  "snapshotTailRecordHash",
  "snapshotTailSequence",
  "streamId",
  "tenantId",
  "tokenHash",
] as const);

export const SQLITE_CURSOR_KINDS = Object.freeze(["event", "checkpoint"] as const);

export type SQLiteCursorKind = (typeof SQLITE_CURSOR_KINDS)[number];

/** The closed immutable seal carrier for exactly one physical cursor row. */
export interface SQLiteCursorSealCarrier {
  readonly authorizationHash: string;
  readonly checkpointScope: string | null;
  readonly consumedAtMs: number | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly kind: SQLiteCursorKind;
  readonly nextPosition: number;
  readonly pageSize: number;
  readonly principalHash: string;
  readonly requestScopeBlobSha256: string;
  readonly requestScopeByteLength: number;
  readonly snapshotBlobSha256: string;
  readonly snapshotByteLength: number;
  readonly snapshotTailRecordHash: string | null;
  readonly snapshotTailSequence: number | null;
  readonly streamId: string | null;
  readonly tenantId: string;
  readonly tokenHash: string;
}

/** One decoded cursor: the sealed carrier plus the separately bound identities. */
export interface SQLiteCursorSealRow {
  readonly carrier: SQLiteCursorSealCarrier;
  readonly descriptorHash: string;
  readonly schemaIdentitySha256: string;
}

/** Fixed-size, deeply frozen evidence returned exactly once per accumulator. */
export interface SQLiteCursorSealReceipt {
  readonly cursorCount: number;
  readonly immutableRootSha256: string;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
}

function corruption(label: string): CycleStoreProviderError {
  return new CycleStoreProviderError(
    "GE_CYCLE_STORE_CORRUPTION",
    OPERATION,
    `SQLite ${label} is invalid`,
  );
}

function invalidArgument(label: string): CycleStoreProviderError {
  return new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    OPERATION,
    `SQLite ${label} is invalid`,
  );
}

function u64be(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function hashValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) throw corruption(label);
  return value;
}

function nullableHashValue(value: unknown, label: string): string | null {
  return value === null ? null : hashValue(value, label);
}

function identifierValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) throw corruption(label);
  return value;
}

function nullableIdentifierValue(value: unknown, label: string): string | null {
  return value === null ? null : identifierValue(value, label);
}

function integerValue(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw corruption(label);
  }
  return value as number;
}

function nullableIntegerValue(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number | null {
  return value === null ? null : integerValue(value, minimum, maximum, label);
}

function nullableSQLiteInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number | null {
  return value === null ? null : sqliteSafeInteger(value, minimum, maximum, OPERATION, label);
}

function cursorKind(value: unknown, label: string): SQLiteCursorKind {
  if (value !== "event" && value !== "checkpoint") throw corruption(label);
  return value;
}

/**
 * Both cursor BLOBs are bounded before decoding, decoded with fatal UTF-8 that
 * keeps any byte-order mark, parsed as JSON and required to re-encode byte for
 * byte. Only the length and digest survive: no raw bytes, decoded snapshot or
 * tenant-controlled text leaves this function, including in diagnostics.
 */
function digestCanonicalBlob(
  value: unknown,
  maximumBytes: number,
  label: string,
): { readonly byteLength: number; readonly sha256: string } {
  const bytes = sqliteBlob(value, OPERATION, label);
  if (bytes.byteLength < MIN_SQLITE_CURSOR_BLOB_BYTES || bytes.byteLength > maximumBytes) {
    throw corruption(`${label} byte length`);
  }
  let canonical: Buffer;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    canonical = Buffer.from(canonicalSerialize(JSON.parse(text) as unknown), "utf8");
  } catch {
    throw corruption(label);
  }
  if (!canonical.equals(bytes)) throw corruption(label);
  return {
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function assertCursorShape(
  kind: SQLiteCursorKind,
  streamId: string | null,
  checkpointScope: string | null,
  snapshotTailSequence: number | null,
  snapshotTailRecordHash: string | null,
): void {
  if (kind === "event") {
    if (streamId === null || checkpointScope !== null || snapshotTailSequence === null) {
      throw corruption("cursor event scope");
    }
    if (snapshotTailSequence === -1
      ? snapshotTailRecordHash !== null
      : snapshotTailRecordHash === null) {
      throw corruption("cursor event tail");
    }
    return;
  }
  if (streamId !== null || checkpointScope === null
      || snapshotTailSequence !== null || snapshotTailRecordHash !== null) {
    throw corruption("cursor checkpoint scope");
  }
}

function assertCursorClocks(
  createdAtMs: number,
  expiresAtMs: number,
  consumedAtMs: number | null,
): void {
  if (expiresAtMs <= createdAtMs) throw corruption("cursor expiry clock");
  if (consumedAtMs !== null && consumedAtMs < createdAtMs) throw corruption("cursor consumption clock");
}

function freezeCarrier(carrier: SQLiteCursorSealCarrier): SQLiteCursorSealCarrier {
  return Object.freeze({
    authorizationHash: carrier.authorizationHash,
    checkpointScope: carrier.checkpointScope,
    consumedAtMs: carrier.consumedAtMs,
    createdAtMs: carrier.createdAtMs,
    expiresAtMs: carrier.expiresAtMs,
    kind: carrier.kind,
    nextPosition: carrier.nextPosition,
    pageSize: carrier.pageSize,
    principalHash: carrier.principalHash,
    requestScopeBlobSha256: carrier.requestScopeBlobSha256,
    requestScopeByteLength: carrier.requestScopeByteLength,
    snapshotBlobSha256: carrier.snapshotBlobSha256,
    snapshotByteLength: carrier.snapshotByteLength,
    snapshotTailRecordHash: carrier.snapshotTailRecordHash,
    snapshotTailSequence: carrier.snapshotTailSequence,
    streamId: carrier.streamId,
    tenantId: carrier.tenantId,
    tokenHash: carrier.tokenHash,
  });
}

/**
 * Revalidate a detached carrier so a hand-built or drifted object can never
 * reach the seal. Canonical capture rejects accessors, proxies, symbol keys,
 * unsafe integers and non-portable values before any field is inspected.
 */
export function validateSQLiteCursorSealCarrier(value: unknown): SQLiteCursorSealCarrier {
  let detached: unknown;
  try {
    detached = JSON.parse(canonicalSerialize(value)) as unknown;
  } catch {
    throw corruption("cursor seal carrier");
  }
  if (detached === null || typeof detached !== "object" || Array.isArray(detached)) {
    throw corruption("cursor seal carrier");
  }
  const record = detached as Record<string, unknown>;
  if (Object.keys(record).length !== SQLITE_CURSOR_SEAL_CARRIER_FIELDS.length
      || !SQLITE_CURSOR_SEAL_CARRIER_FIELDS.every((field) => Object.hasOwn(record, field))) {
    throw corruption("cursor seal carrier");
  }
  const kind = cursorKind(record["kind"], "cursor kind");
  const streamId = nullableIdentifierValue(record["streamId"], "cursor stream");
  const checkpointScope = nullableIdentifierValue(record["checkpointScope"], "cursor scope");
  const snapshotTailSequence = nullableIntegerValue(
    record["snapshotTailSequence"], -1, MAX_SAFE_INTEGER, "cursor tail sequence",
  );
  const snapshotTailRecordHash = nullableHashValue(
    record["snapshotTailRecordHash"], "cursor tail record hash",
  );
  assertCursorShape(kind, streamId, checkpointScope, snapshotTailSequence, snapshotTailRecordHash);
  const createdAtMs = integerValue(record["createdAtMs"], 0, MAX_SAFE_INTEGER, "cursor creation clock");
  const expiresAtMs = integerValue(record["expiresAtMs"], 0, MAX_SAFE_INTEGER, "cursor expiry clock");
  const consumedAtMs = nullableIntegerValue(
    record["consumedAtMs"], 0, MAX_SAFE_INTEGER, "cursor consumption clock",
  );
  assertCursorClocks(createdAtMs, expiresAtMs, consumedAtMs);
  return freezeCarrier({
    authorizationHash: hashValue(record["authorizationHash"], "cursor authorization hash"),
    checkpointScope,
    consumedAtMs,
    createdAtMs,
    expiresAtMs,
    kind,
    nextPosition: integerValue(record["nextPosition"], 0, MAX_SAFE_INTEGER, "cursor next position"),
    pageSize: integerValue(
      record["pageSize"], MIN_SQLITE_CURSOR_PAGE_SIZE, MAX_SQLITE_CURSOR_PAGE_SIZE, "cursor page size",
    ),
    principalHash: hashValue(record["principalHash"], "cursor principal hash"),
    requestScopeBlobSha256: hashValue(
      record["requestScopeBlobSha256"], "cursor request scope digest",
    ),
    requestScopeByteLength: integerValue(
      record["requestScopeByteLength"],
      MIN_SQLITE_CURSOR_BLOB_BYTES,
      MAX_SQLITE_CURSOR_REQUEST_SCOPE_BYTES,
      "cursor request scope byte length",
    ),
    snapshotBlobSha256: hashValue(record["snapshotBlobSha256"], "cursor snapshot digest"),
    snapshotByteLength: integerValue(
      record["snapshotByteLength"],
      MIN_SQLITE_CURSOR_BLOB_BYTES,
      MAX_SQLITE_CURSOR_SNAPSHOT_BYTES,
      "cursor snapshot byte length",
    ),
    snapshotTailRecordHash,
    snapshotTailSequence,
    streamId,
    tenantId: identifierValue(record["tenantId"], "cursor tenant"),
    tokenHash: hashValue(record["tokenHash"], "cursor token hash"),
  });
}

/**
 * Read exactly one hardened eighteen-column row in physical schema order.
 *
 * Both BLOBs are reduced to a length and digest inside this call, so the caller
 * never receives request-scope bytes, snapshot bytes or a decoded snapshot.
 */
export function decodeSQLiteCursorSealRow(value: unknown): SQLiteCursorSealRow {
  const row = sqliteRow(value, SQLITE_CURSOR_COLUMN_COUNT, OPERATION, "cursor row");
  const tenantId = identifierValue(sqliteText(row[0], OPERATION, "cursor tenant"), "cursor tenant");
  const tokenHash = hashValue(sqliteText(row[1], OPERATION, "cursor token hash"), "cursor token hash");
  const kind = cursorKind(sqliteText(row[2], OPERATION, "cursor kind"), "cursor kind");
  const principalHash = hashValue(
    sqliteText(row[3], OPERATION, "cursor principal hash"), "cursor principal hash",
  );
  const authorizationHash = hashValue(
    sqliteText(row[4], OPERATION, "cursor authorization hash"), "cursor authorization hash",
  );
  const streamId = nullableIdentifierValue(
    sqliteNullableText(row[5], OPERATION, "cursor stream"), "cursor stream",
  );
  const checkpointScope = nullableIdentifierValue(
    sqliteNullableText(row[6], OPERATION, "cursor scope"), "cursor scope",
  );
  const requestScope = digestCanonicalBlob(
    row[7], MAX_SQLITE_CURSOR_REQUEST_SCOPE_BYTES, "cursor request scope blob",
  );
  const pageSize = sqliteSafeInteger(
    row[8], MIN_SQLITE_CURSOR_PAGE_SIZE, MAX_SQLITE_CURSOR_PAGE_SIZE, OPERATION, "cursor page size",
  );
  const nextPosition = sqliteSafeInteger(
    row[9], 0, MAX_SAFE_INTEGER, OPERATION, "cursor next position",
  );
  const snapshotTailSequence = nullableSQLiteInteger(
    row[10], -1, MAX_SAFE_INTEGER, "cursor tail sequence",
  );
  const snapshotTailRecordHash = nullableHashValue(
    sqliteNullableText(row[11], OPERATION, "cursor tail record hash"), "cursor tail record hash",
  );
  const descriptorHash = hashValue(
    sqliteText(row[12], OPERATION, "cursor descriptor hash"), "cursor descriptor hash",
  );
  const schemaIdentitySha256 = hashValue(
    sqliteText(row[13], OPERATION, "cursor schema identity"), "cursor schema identity",
  );
  const snapshot = digestCanonicalBlob(
    row[14], MAX_SQLITE_CURSOR_SNAPSHOT_BYTES, "cursor snapshot blob",
  );
  const createdAtMs = sqliteSafeInteger(
    row[15], 0, MAX_SAFE_INTEGER, OPERATION, "cursor creation clock",
  );
  const expiresAtMs = sqliteSafeInteger(
    row[16], 0, MAX_SAFE_INTEGER, OPERATION, "cursor expiry clock",
  );
  const consumedAtMs = nullableSQLiteInteger(
    row[17], 0, MAX_SAFE_INTEGER, "cursor consumption clock",
  );
  assertCursorShape(kind, streamId, checkpointScope, snapshotTailSequence, snapshotTailRecordHash);
  assertCursorClocks(createdAtMs, expiresAtMs, consumedAtMs);
  return Object.freeze({
    carrier: freezeCarrier({
      authorizationHash,
      checkpointScope,
      consumedAtMs,
      createdAtMs,
      expiresAtMs,
      kind,
      nextPosition,
      pageSize,
      principalHash,
      requestScopeBlobSha256: requestScope.sha256,
      requestScopeByteLength: requestScope.byteLength,
      snapshotBlobSha256: snapshot.sha256,
      snapshotByteLength: snapshot.byteLength,
      snapshotTailRecordHash,
      snapshotTailSequence,
      streamId,
      tenantId,
      tokenHash,
    }),
    descriptorHash,
    schemaIdentitySha256,
  });
}

/** Canonical UTF-8 carrier bytes; the only encoding the row digest may consume. */
export function encodeSQLiteCursorSealCarrier(carrier: SQLiteCursorSealCarrier): Buffer {
  return Buffer.from(canonicalSerialize(validateSQLiteCursorSealCarrier(carrier)), "utf8");
}

/** `SHA-256(ROW_DOMAIN || u64be(len) || carrierBytes)` as thirty-two raw bytes. */
export function digestSQLiteCursorSealCarrier(carrier: SQLiteCursorSealCarrier): Buffer {
  const carrierBytes = encodeSQLiteCursorSealCarrier(carrier);
  return createHash("sha256")
    .update(ROW_DOMAIN_BYTES)
    .update(u64be(carrierBytes.byteLength))
    .update(carrierBytes)
    .digest();
}

function genesisState(): Buffer {
  return createHash("sha256").update(SEAL_DOMAIN_BYTES).update(GENESIS_TAG).digest();
}

/**
 * Streams the immutable cursor seal in constant space.
 *
 * The accumulator retains one 32-byte chain state, one accepted count and the
 * previous identity bytes. It never retains a carrier, a digest history, a
 * decoded snapshot or any collection proportional to the cursor count. Rows
 * must arrive in canonical order: `token_hash` unsigned UTF-8 bytes first, then
 * `tenant_id` unsigned UTF-8 bytes. A rejected append is observationally
 * atomic, because every throwing step runs before any field is advanced.
 */
export class SQLiteCursorSealAccumulator {
  readonly #expectedCursorCount: number;
  readonly #sourceDescriptorHash: string;
  readonly #sourceSchemaIdentitySha256: string;
  #state: Buffer = genesisState();
  #acceptedCount = 0;
  #previousTokenHash: Buffer | undefined;
  #previousTenantId: Buffer | undefined;
  #receipt: SQLiteCursorSealReceipt | undefined;

  constructor(
    expectedCursorCount: number,
    sourceDescriptorHash: string,
    sourceSchemaIdentitySha256: string,
  ) {
    if (!Number.isSafeInteger(expectedCursorCount) || expectedCursorCount < 0) {
      throw invalidArgument("cursor seal expected count");
    }
    this.#expectedCursorCount = expectedCursorCount;
    this.#sourceDescriptorHash = hashValue(sourceDescriptorHash, "cursor source descriptor hash");
    this.#sourceSchemaIdentitySha256 = hashValue(
      sourceSchemaIdentitySha256, "cursor source schema identity",
    );
  }

  get expectedCursorCount(): number {
    return this.#expectedCursorCount;
  }

  get cursorCount(): number {
    return this.#acceptedCount;
  }

  get isFinished(): boolean {
    return this.#receipt !== undefined;
  }

  append(row: SQLiteCursorSealRow): void {
    if (this.#receipt !== undefined) throw invalidArgument("cursor seal append after finish");
    if (this.#acceptedCount >= this.#expectedCursorCount) {
      throw corruption("cursor seal count overflow");
    }
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw corruption("cursor seal row");
    }

    // Descriptor and schema identity are exactly bound here and deliberately
    // excluded from the carrier: only a later publication rebind may change them.
    if (hashValue(row.descriptorHash, "cursor descriptor hash") !== this.#sourceDescriptorHash
        || hashValue(row.schemaIdentitySha256, "cursor schema identity")
          !== this.#sourceSchemaIdentitySha256) {
      throw corruption("cursor seal source identity");
    }
    const carrier = validateSQLiteCursorSealCarrier(row.carrier);
    const tokenHash = Buffer.from(carrier.tokenHash, "utf8");
    const tenantId = Buffer.from(carrier.tenantId, "utf8");
    if (this.#previousTokenHash !== undefined && this.#previousTenantId !== undefined) {
      const order = Buffer.compare(tokenHash, this.#previousTokenHash)
        || Buffer.compare(tenantId, this.#previousTenantId);
      if (order === 0) throw corruption("cursor seal duplicate identity");
      if (order < 0) throw corruption("cursor seal order");
    }
    const ordinal = this.#acceptedCount + 1;
    const state = createHash("sha256")
      .update(SEAL_DOMAIN_BYTES)
      .update(ROW_TAG)
      .update(this.#state)
      .update(u64be(ordinal))
      .update(digestSQLiteCursorSealCarrier(carrier))
      .digest();

    this.#state = state;
    this.#acceptedCount = ordinal;
    this.#previousTokenHash = tokenHash;
    this.#previousTenantId = tenantId;
  }

  finish(): SQLiteCursorSealReceipt {
    if (this.#receipt !== undefined) throw invalidArgument("cursor seal finish reuse");
    if (this.#acceptedCount !== this.#expectedCursorCount) {
      throw corruption("cursor seal count underflow");
    }
    this.#receipt = Object.freeze({
      cursorCount: this.#acceptedCount,
      immutableRootSha256: createHash("sha256")
        .update(SEAL_DOMAIN_BYTES)
        .update(TERMINAL_TAG)
        .update(u64be(this.#acceptedCount))
        .update(this.#state)
        .digest("hex"),
      sourceDescriptorHash: this.#sourceDescriptorHash,
      sourceSchemaIdentitySha256: this.#sourceSchemaIdentitySha256,
    });
    return this.#receipt;
  }
}

/** Seals an already canonically ordered one-row-at-a-time cursor stream. */
export function sealSQLiteCursorRows(
  expectedCursorCount: number,
  sourceDescriptorHash: string,
  sourceSchemaIdentitySha256: string,
  rows: Iterable<SQLiteCursorSealRow>,
): SQLiteCursorSealReceipt {
  const accumulator = new SQLiteCursorSealAccumulator(
    expectedCursorCount, sourceDescriptorHash, sourceSchemaIdentitySha256,
  );
  for (const row of rows) accumulator.append(row);
  return accumulator.finish();
}

/** The terminal root of a zero-cursor stream, derived from the frozen algorithm. */
export const SQLITE_CURSOR_SEAL_EMPTY_ROOT =
  new SQLiteCursorSealAccumulator(0, "0".repeat(64), "0".repeat(64))
    .finish().immutableRootSha256;
