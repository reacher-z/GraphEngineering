import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { TextDecoder } from "node:util";
import { isUint8Array } from "node:util/types";

import { canonicalSerialize } from "@graph-engineering/core";
import {
  CYCLE_STORE_RECORD_DOMAIN,
  CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
  CycleStoreProviderError,
  cycleStoreAdapterCodec,
  type CycleStoreAppendResult,
  type CycleStoreCheckpoint,
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
  sqliteNullableText,
  sqliteRow,
  sqliteText,
} from "./sqlite-codec.js";
import { translateSQLiteError } from "./sqlite-errors.js";
import { SQLITE_CYCLE_STORE_DESCRIPTOR_HASH } from "./sqlite-profile.js";

const OPERATION: CycleStoreProviderOperation = "inspect-schema";
const bufferIntrinsic = Buffer;
const createHashIntrinsic = createHash;
const databaseSyncIntrinsic = DatabaseSync;
const textDecoderIntrinsic = TextDecoder;
const isUint8ArrayIntrinsic = isUint8Array;
const arrayIntrinsic = Array;
const jsonIntrinsic = JSON;
const dateIntrinsic = Date;
const numberConstructorIntrinsic = Number;
const uint8ArrayIntrinsic = Uint8Array;
const reflectApplyIntrinsic = Reflect.apply;
const objectFreezeIntrinsic = Object.freeze;
const objectGetPrototypeOfIntrinsic = Object.getPrototypeOf;
const objectGetOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const objectKeysIntrinsic = Object.keys;
const arrayIsArrayIntrinsic = Array.isArray;
const arrayPushIntrinsic = Array.prototype.push;
const stringIncludesIntrinsic = String.prototype.includes;
const stringStartsWithIntrinsic = String.prototype.startsWith;
const stringToLowerCaseIntrinsic = String.prototype.toLowerCase;
const stringCharCodeAtIntrinsic = String.prototype.charCodeAt;
const stringSliceIntrinsic = String.prototype.slice;
const jsonParseIntrinsic = JSON.parse;
const dateParseIntrinsic = Date.parse;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const numberIsFiniteIntrinsic = Number.isFinite;
const numberIntrinsic = Number;
const bigintIntrinsic = BigInt;
const mapIntrinsic = Map;
const setIntrinsic = Set;
const mapGetIntrinsic = Map.prototype.get;
const mapSetIntrinsic = Map.prototype.set;
const setHasIntrinsic = Set.prototype.has;
const bufferFromIntrinsic = Buffer.from;
const bufferEqualsIntrinsic = Buffer.prototype.equals;
const bufferToStringIntrinsic = Buffer.prototype.toString;
const textDecoderDecodeIntrinsic = TextDecoder.prototype.decode;
const regexpExecIntrinsic = RegExp.prototype.exec;
const typedArrayPrototypeIntrinsic = reflectApplyIntrinsic(
  objectGetPrototypeOfIntrinsic,
  Object,
  [uint8ArrayIntrinsic.prototype],
) as object;
const typedArrayByteLengthGetterIntrinsic = (reflectApplyIntrinsic(
  objectGetOwnPropertyDescriptorIntrinsic,
  Object,
  [typedArrayPrototypeIntrinsic, "byteLength"],
) as PropertyDescriptor).get!;
const databasePrepareIntrinsic = DatabaseSync.prototype.prepare;
const databaseExecIntrinsic = DatabaseSync.prototype.exec;
const databaseCloseIntrinsic = DatabaseSync.prototype.close;
const statementAllIntrinsic = StatementSync.prototype.all;
const statementGetIntrinsic = StatementSync.prototype.get;
const statementSetAllowBareNamedParametersIntrinsic =
  StatementSync.prototype.setAllowBareNamedParameters;
const statementSetAllowUnknownNamedParametersIntrinsic =
  StatementSync.prototype.setAllowUnknownNamedParameters;
const statementSetReadBigIntsIntrinsic = StatementSync.prototype.setReadBigInts;
const statementSetReturnArraysIntrinsic = StatementSync.prototype.setReturnArrays;
const hashProbe = createHashIntrinsic("sha256");
const hashUpdateIntrinsic = hashProbe.update;
const hashDigestIntrinsic = hashProbe.digest;
const codecParseStoredRecordIntrinsic = cycleStoreAdapterCodec.parseStoredRecord;
const codecParseStoredCheckpointIntrinsic = cycleStoreAdapterCodec.parseStoredCheckpoint;
const codecDecodeLedgerResultIntrinsic = cycleStoreAdapterCodec.decodeLedgerResult;
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const SEMANTIC_DIGEST_DOMAIN = "graph-engineering/sqlite-semantic-audit/v1\0";
const LEDGER_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const LEDGER_HASH = /^[0-9a-f]{64}$/u;
const LEDGER_RFC3339 = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
const MUTATION_OPERATIONS = new setIntrinsic<CycleStoreMutationOperation>([
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
const REQUIRED_MIGRATION_POSTCONDITIONS = objectFreezeIntrinsic([
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

function bufferFrom(value: string | ArrayBufferView): Buffer {
  return reflectApplyIntrinsic(bufferFromIntrinsic, bufferIntrinsic, [value]) as Buffer;
}

function bufferFromUtf8(value: string): Buffer {
  return reflectApplyIntrinsic(bufferFromIntrinsic, bufferIntrinsic, [value, "utf8"]) as Buffer;
}

function sqliteBlob(
  value: unknown,
  operation: CycleStoreProviderOperation,
  label: string,
): Buffer {
  if (!reflectApplyIntrinsic(isUint8ArrayIntrinsic, undefined, [value])) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      operation,
      `stored ${label} is invalid`,
    );
  }
  return bufferFrom(value as Uint8Array);
}

function sqliteSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  operation: CycleStoreProviderOperation,
  label: string,
): number {
  const minimumBigInt = reflectApplyIntrinsic(bigintIntrinsic, undefined, [minimum]) as bigint;
  const maximumBigInt = reflectApplyIntrinsic(bigintIntrinsic, undefined, [maximum]) as bigint;
  if (typeof value !== "bigint" || value < minimumBigInt || value > maximumBigInt) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_CORRUPTION",
      operation,
      `stored ${label} is invalid`,
    );
  }
  return reflectApplyIntrinsic(numberIntrinsic, undefined, [value]) as number;
}

function buffersEqual(left: Buffer, right: Uint8Array): boolean {
  return reflectApplyIntrinsic(bufferEqualsIntrinsic, left, [right]) as boolean;
}

function byteLength(value: Uint8Array): number {
  return reflectApplyIntrinsic(typedArrayByteLengthGetterIntrinsic, value, []) as number;
}

function updateHash(
  digest: ReturnType<typeof createHash>,
  value: string,
  encoding?: BufferEncoding,
): void {
  reflectApplyIntrinsic(hashUpdateIntrinsic, digest, encoding === undefined
    ? [value]
    : [value, encoding]);
}

function digestHex(digest: ReturnType<typeof createHash>): string {
  return reflectApplyIntrinsic(hashDigestIntrinsic, digest, ["hex"]) as string;
}

function domainHash(domain: string, value: unknown): string {
  const digest = createHashIntrinsic("sha256");
  updateHash(digest, domain, "utf8");
  updateHash(digest, canonicalSerialize(value), "utf8");
  return digestHex(digest);
}

function canonicalDigest(value: unknown): string {
  const digest = createHashIntrinsic("sha256");
  updateHash(digest, canonicalSerialize(value), "utf8");
  return digestHex(digest);
}

function ledgerObject(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null
      || reflectApplyIntrinsic(arrayIsArrayIntrinsic, arrayIntrinsic, [value])) {
    return fail("operation ledger result contract");
  }
  const actualKeys = reflectApplyIntrinsic(
    objectKeysIntrinsic,
    Object,
    [value],
  ) as readonly string[];
  if (actualKeys.length !== expectedKeys.length) {
    return fail("operation ledger result contract");
  }
  for (let actualIndex = 0; actualIndex < actualKeys.length; actualIndex += 1) {
    let found = false;
    for (let expectedIndex = 0; expectedIndex < expectedKeys.length; expectedIndex += 1) {
      if (actualKeys[actualIndex] === expectedKeys[expectedIndex]) {
        found = true;
        break;
      }
    }
    if (!found) return fail("operation ledger result contract");
  }
  return value as Record<string, unknown>;
}

function ledgerPattern(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string"
    && reflectApplyIntrinsic(regexpExecIntrinsic, pattern, [value]) !== null;
}

function ledgerIdentifier(value: unknown): value is string {
  return ledgerPattern(value, LEDGER_IDENTIFIER) && value !== "." && value !== "..";
}

function ledgerHash(value: unknown): value is string {
  return ledgerPattern(value, LEDGER_HASH);
}

function ledgerInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && reflectApplyIntrinsic(numberIsSafeIntegerIntrinsic, numberConstructorIntrinsic, [value])
    && value >= minimum && value <= maximum;
}

function ledgerTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = reflectApplyIntrinsic(regexpExecIntrinsic, LEDGER_RFC3339, [value]) as
    RegExpExecArray | null;
  if (match === null) return null;
  const year = reflectApplyIntrinsic(numberIntrinsic, undefined, [match[1]]) as number;
  const month = reflectApplyIntrinsic(numberIntrinsic, undefined, [match[2]]) as number;
  const day = reflectApplyIntrinsic(numberIntrinsic, undefined, [match[3]]) as number;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  let maximumDay = 31;
  if (month === 2) maximumDay = leap ? 29 : 28;
  else if (month === 4 || month === 6 || month === 9 || month === 11) maximumDay = 30;
  if (year < 1 || day > maximumDay) return null;
  const milliseconds = reflectApplyIntrinsic(dateParseIntrinsic, dateIntrinsic, [value]) as number;
  return reflectApplyIntrinsic(numberIsFiniteIntrinsic, numberConstructorIntrinsic, [milliseconds])
    ? milliseconds
    : null;
}

function validateLedgerTail(value: unknown): void {
  const tail = ledgerObject(value, ["exists", "sequence", "recordHash"]);
  if (typeof tail.exists !== "boolean"
      || !ledgerInteger(tail.sequence, -1, MAX_SAFE_INTEGER)
      || (tail.recordHash !== null && !ledgerHash(tail.recordHash))
      || (tail.exists === false && (tail.sequence !== -1 || tail.recordHash !== null))
      || (tail.exists === true && (tail.sequence < 0 || tail.recordHash === null))) {
    return fail("operation ledger result contract");
  }
}

function validateLedgerCheckpointSummary(value: unknown): void {
  const summary = ledgerObject(value, [
    "checkpointScope",
    "checkpointId",
    "streamId",
    "boundSequence",
    "boundRecordHash",
    "createdAt",
    "valueHash",
    "valueBytes",
  ]);
  if (!ledgerIdentifier(summary.checkpointScope)
      || !ledgerIdentifier(summary.checkpointId)
      || !ledgerIdentifier(summary.streamId)
      || !ledgerInteger(summary.boundSequence, 0, MAX_SAFE_INTEGER)
      || !ledgerHash(summary.boundRecordHash)
      || ledgerTimestampMs(summary.createdAt) === null
      || !ledgerHash(summary.valueHash)
      || !ledgerInteger(summary.valueBytes, 0, 16_777_216)) {
    return fail("operation ledger result contract");
  }
}

function validateStoredCheckpoint(value: unknown): void {
  const checkpoint = ledgerObject(value, [
    "checkpointScope",
    "checkpointId",
    "streamId",
    "boundSequence",
    "boundRecordHash",
    "createdAt",
    "valueHash",
    "valueBytes",
    "value",
  ]);
  if (!ledgerIdentifier(checkpoint.checkpointScope)
      || !ledgerIdentifier(checkpoint.checkpointId)
      || !ledgerIdentifier(checkpoint.streamId)
      || !ledgerInteger(checkpoint.boundSequence, 0, MAX_SAFE_INTEGER)
      || !ledgerHash(checkpoint.boundRecordHash)
      || ledgerTimestampMs(checkpoint.createdAt) === null
      || !ledgerHash(checkpoint.valueHash)
      || !ledgerInteger(checkpoint.valueBytes, 0, 16_777_216)
      || canonicalDigest(checkpoint.value) !== checkpoint.valueHash
      || byteLength(bufferFromUtf8(canonicalSerialize(checkpoint.value)))
        !== checkpoint.valueBytes) {
    return fail("checkpoint local contract");
  }
}

function validateLedgerLease(value: unknown): void {
  const lease = ledgerObject(value, [
    "leaseId",
    "holderId",
    "leaseEpoch",
    "fencingToken",
    "acquiredAt",
    "expiresAt",
  ]);
  const acquiredAtMs = ledgerTimestampMs(lease.acquiredAt);
  const expiresAtMs = ledgerTimestampMs(lease.expiresAt);
  if (!ledgerIdentifier(lease.leaseId)
      || !ledgerIdentifier(lease.holderId)
      || !ledgerInteger(lease.leaseEpoch, 1, MAX_SAFE_INTEGER)
      || !ledgerInteger(lease.fencingToken, 1, MAX_SAFE_INTEGER)
      || acquiredAtMs === null || expiresAtMs === null
      || expiresAtMs <= acquiredAtMs) {
    return fail("operation ledger result contract");
  }
}

function validateLedgerGovernance(value: unknown): void {
  const governance = ledgerObject(value, [
    "legalHoldIds",
    "retentionMode",
    "archiveMode",
    "compactionMode",
  ]);
  if (!reflectApplyIntrinsic(arrayIsArrayIntrinsic, arrayIntrinsic, [governance.legalHoldIds])
      || governance.retentionMode !== "retain-authoritative-history"
      || governance.archiveMode !== "lossless-before-delete"
      || governance.compactionMode !== "logical-history-preserving") {
    return fail("operation ledger result contract");
  }
  const holdIds = governance.legalHoldIds as readonly unknown[];
  let previous: string | null = null;
  for (let index = 0; index < holdIds.length; index += 1) {
    const holdId = holdIds[index];
    if (!ledgerIdentifier(holdId) || (previous !== null && previous >= holdId)) {
      return fail("operation ledger result contract");
    }
    previous = holdId;
  }
}

function validateLedgerMigrationLock(value: unknown): void {
  const lock = ledgerObject(value, [
    "lockId",
    "ownerId",
    "sourceSchemaVersion",
    "targetSchemaVersion",
    "lockEpoch",
    "fencingToken",
    "acquiredAt",
    "expiresAt",
  ]);
  const acquiredAtMs = ledgerTimestampMs(lock.acquiredAt);
  const expiresAtMs = ledgerTimestampMs(lock.expiresAt);
  if (!ledgerIdentifier(lock.lockId)
      || !ledgerIdentifier(lock.ownerId)
      || !ledgerInteger(lock.sourceSchemaVersion, 1, MAX_SAFE_INTEGER)
      || !ledgerInteger(lock.targetSchemaVersion, 1, MAX_SAFE_INTEGER)
      || lock.targetSchemaVersion <= lock.sourceSchemaVersion
      || !ledgerInteger(lock.lockEpoch, 1, MAX_SAFE_INTEGER)
      || !ledgerInteger(lock.fencingToken, 1, MAX_SAFE_INTEGER)
      || acquiredAtMs === null || expiresAtMs === null
      || expiresAtMs <= acquiredAtMs) {
    return fail("operation ledger result contract");
  }
}

function validateLedgerResult(
  operation: CycleStoreMutationOperation,
  value: unknown,
): void {
  switch (operation) {
    case "append": {
      const append = ledgerObject(value, ["tail", "appendedRecords"]);
      validateLedgerTail(append.tail);
      if (!ledgerInteger(append.appendedRecords, 1, 64)) {
        return fail("operation ledger result contract");
      }
      return;
    }
    case "save-checkpoint":
      validateLedgerCheckpointSummary(value);
      return;
    case "delete-checkpoint": {
      const deletion = ledgerObject(value, ["deleted"]);
      if (typeof deletion.deleted !== "boolean") {
        return fail("operation ledger result contract");
      }
      return;
    }
    case "acquire-lease":
    case "renew-lease":
      validateLedgerLease(value);
      return;
    case "release-lease": {
      const inspection = ledgerObject(value, [
        "status",
        "lease",
        "lastLeaseEpoch",
        "lastFencingToken",
      ]);
      if (inspection.status !== "released" || inspection.lease !== null
          || !ledgerInteger(inspection.lastLeaseEpoch, 0, MAX_SAFE_INTEGER)
          || !ledgerInteger(inspection.lastFencingToken, 0, MAX_SAFE_INTEGER)) {
        return fail("operation ledger result contract");
      }
      return;
    }
    case "set-legal-hold":
      validateLedgerGovernance(value);
      return;
    case "acquire-migration-lock":
      validateLedgerMigrationLock(value);
      return;
    case "release-migration-lock":
      if (value !== null) return fail("operation ledger result contract");
  }
}

function numericProjection(values: readonly unknown[]): readonly unknown[] {
  const projected: unknown[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    reflectApplyIntrinsic(arrayPushIntrinsic, projected, [
      typeof value === "bigint"
        ? reflectApplyIntrinsic(numberIntrinsic, undefined, [value])
        : value,
    ]);
  }
  return projected;
}

function isEcmaWhitespaceCodeUnit(value: number): boolean {
  return (value >= 0x0009 && value <= 0x000d)
    || value === 0x0020 || value === 0x00a0 || value === 0x1680
    || (value >= 0x2000 && value <= 0x200a)
    || value === 0x2028 || value === 0x2029 || value === 0x202f
    || value === 0x205f || value === 0x3000 || value === 0xfeff;
}

function normalizeSQLiteCatalogSql(value: string): string {
  let normalized = "";
  let pendingSpace = false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = reflectApplyIntrinsic(stringCharCodeAtIntrinsic, value, [index]) as number;
    if (isEcmaWhitespaceCodeUnit(codeUnit)) {
      if (normalized.length !== 0) pendingSpace = true;
      continue;
    }
    if (pendingSpace) {
      normalized += " ";
      pendingSpace = false;
    }
    normalized += reflectApplyIntrinsic(stringSliceIntrinsic, value, [index, index + 1]) as string;
  }
  return normalized;
}

function checkedPath(value: unknown): string {
  if (typeof value !== "string"
      || value.length === 0
      || reflectApplyIntrinsic(stringIncludesIntrinsic, value, ["\0"])
      || value === ":memory:"
      || reflectApplyIntrinsic(stringStartsWithIntrinsic, value, ["file::memory:"])) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite audit path is invalid",
    );
  }
  return value;
}

interface SQLiteAuditStatement {
  all(...parameters: readonly unknown[]): readonly unknown[];
  get(...parameters: readonly unknown[]): unknown;
}

function statement(database: DatabaseSync, sql: string): SQLiteAuditStatement {
  const native = reflectApplyIntrinsic(databasePrepareIntrinsic, database, [sql]) as StatementSync;
  reflectApplyIntrinsic(statementSetAllowBareNamedParametersIntrinsic, native, [false]);
  reflectApplyIntrinsic(statementSetAllowUnknownNamedParametersIntrinsic, native, [false]);
  reflectApplyIntrinsic(statementSetReadBigIntsIntrinsic, native, [true]);
  reflectApplyIntrinsic(statementSetReturnArraysIntrinsic, native, [true]);
  return {
    all: (...parameters: readonly unknown[]) => reflectApplyIntrinsic(
      statementAllIntrinsic,
      native,
      parameters,
    ) as readonly unknown[],
    get: (...parameters: readonly unknown[]) => reflectApplyIntrinsic(
      statementGetIntrinsic,
      native,
      parameters,
    ),
  };
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
  if (byteLength(blob) < 2 || (blob[0] === 0xef && blob[1] === 0xbb && blob[2] === 0xbf)) {
    return fail(label);
  }
  try {
    const decoder = new textDecoderIntrinsic("utf-8", { fatal: true });
    const text = reflectApplyIntrinsic(textDecoderDecodeIntrinsic, decoder, [blob]) as string;
    const decoded = reflectApplyIntrinsic(jsonParseIntrinsic, jsonIntrinsic, [text]) as unknown;
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
  const observed = rows(database, `
    SELECT type, name, tbl_name, sql
      FROM sqlite_schema
     WHERE name GLOB 'ge_cycle_*'
       AND type IN ('table', 'index')
       AND sql IS NOT NULL
     ORDER BY type, name
  `);
  const catalog: unknown[] = [];
  for (let index = 0; index < observed.length; index += 1) {
    const value = observed[index];
    const row = sqliteRow(value, 4, OPERATION, `schema catalog row ${index}`);
    reflectApplyIntrinsic(arrayPushIntrinsic, catalog, [{
      type: sqliteText(row[0], OPERATION, "schema catalog type"),
      name: sqliteText(row[1], OPERATION, "schema catalog name"),
      tableName: sqliteText(row[2], OPERATION, "schema catalog table"),
      sql: normalizeSQLiteCatalogSql(sqliteText(row[3], OPERATION, "schema catalog SQL")),
    }]);
  }
  const digest = createHashIntrinsic("sha256");
  updateHash(digest, canonicalSerialize(catalog), "utf8");
  return digestHex(digest);
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
  updateHash(digest, label, "utf8");
  updateHash(digest, "\0", "utf8");
  updateHash(digest, canonicalSerialize(value), "utf8");
  updateHash(digest, "\0", "utf8");
}

function inspectRecords(
  database: DatabaseSync,
  digest: ReturnType<typeof createHash>,
): Map<string, RecordHead> {
  const heads = new mapIntrinsic<string, RecordHead>();
  let headCount = 0;
  const recordRows = rows(database, `
    SELECT tenant_id, stream_id, sequence, record_id, previous_record_hash,
           value_hash, value_bytes, value_blob, record_hash, record_blob
      FROM ge_cycle_records
     ORDER BY tenant_id, stream_id, sequence
  `);
  for (let index = 0; index < recordRows.length; index += 1) {
    const raw = recordRows[index];
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
    const record = reflectApplyIntrinsic(
      codecParseStoredRecordIntrinsic,
      cycleStoreAdapterCodec,
      [recordBlob, OPERATION],
    ) as CycleStoreRecord;
    const key = canonicalSerialize([tenantId, streamId]);
    const previous = reflectApplyIntrinsic(mapGetIntrinsic, heads, [key]) as
      RecordHead | undefined;
    const expectedRecordHash = domainHash(CYCLE_STORE_RECORD_DOMAIN, {
      recordId,
      sequence,
      previousRecordHash: previousHash,
      valueHash,
      valueBytes,
      value: record.value,
    });
    if (sequence !== (previous?.sequence ?? -1) + 1
        || previousHash !== (previous?.recordHash ?? null)
        || record.recordId !== recordId
        || record.sequence !== sequence
        || record.previousRecordHash !== previousHash
        || record.valueHash !== valueHash
        || record.valueBytes !== valueBytes
        || record.recordHash !== recordHash
        || record.recordHash !== expectedRecordHash
        || recordHash !== expectedRecordHash
        || byteLength(valueBlob) !== valueBytes
        || !buffersEqual(recordBlob, bufferFromUtf8(canonicalSerialize(record)))
        || !buffersEqual(valueBlob, bufferFromUtf8(canonicalSerialize(record.value)))
        || canonicalDigest(record.value) !== valueHash) {
      return fail("record canonical chain");
    }
    if (previous === undefined) headCount += 1;
    reflectApplyIntrinsic(mapSetIntrinsic, heads, [
      key,
      { sequence, recordHash, count: (previous?.count ?? 0) + 1 },
    ]);
    updateDigest(digest, "record", { tenantId, streamId, record });
  }

  const streamRows = rows(database, `
    SELECT tenant_id, stream_id, tail_sequence, tail_record_hash
      FROM ge_cycle_streams ORDER BY tenant_id, stream_id
  `);
  for (let index = 0; index < streamRows.length; index += 1) {
    const raw = streamRows[index];
    const row = sqliteRow(raw, 4, OPERATION, `stream row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "stream tenant");
    const streamId = sqliteText(row[1], OPERATION, "stream id");
    const sequence = integer(row[2], -1, MAX_SAFE_INTEGER, "stream tail sequence");
    const recordHash = sqliteNullableText(row[3], OPERATION, "stream tail hash");
    const head = reflectApplyIntrinsic(
      mapGetIntrinsic,
      heads,
      [canonicalSerialize([tenantId, streamId])],
    ) as RecordHead | undefined;
    if (head === undefined
      ? (sequence !== -1 || recordHash !== null)
      : (sequence !== head.sequence || recordHash !== head.recordHash)) {
      return fail("stream head binding");
    }
    updateDigest(digest, "stream", { tenantId, streamId, sequence, recordHash });
  }
  if (streamRows.length !== headCount) return fail("stream record cardinality");
  return heads;
}

function mutationOperation(value: unknown): CycleStoreMutationOperation {
  const operation = sqliteText(value, OPERATION, "ledger operation");
  if (!reflectApplyIntrinsic(
    setHasIntrinsic,
    MUTATION_OPERATIONS,
    [operation as CycleStoreMutationOperation],
  )) {
    return fail("ledger operation");
  }
  return operation as CycleStoreMutationOperation;
}

function inspectOperations(database: DatabaseSync, digest: ReturnType<typeof createHash>): void {
  const operationRows = rows(database, `
    SELECT tenant_id, operation_id, operation_name, request_hash, result_blob, result_hash
      FROM ge_cycle_operations ORDER BY tenant_id, operation_id
  `);
  for (let index = 0; index < operationRows.length; index += 1) {
    const raw = operationRows[index];
    const row = sqliteRow(raw, 6, OPERATION, `operation row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "operation tenant");
    const operationId = sqliteText(row[1], OPERATION, "operation id");
    const operation = mutationOperation(row[2]);
    const requestHash = sqliteText(row[3], OPERATION, "operation request hash");
    const resultBlob = sqliteBlob(row[4], OPERATION, "operation result blob");
    const resultHash = sqliteText(row[5], OPERATION, "operation result hash");
    const result = reflectApplyIntrinsic(
      codecDecodeLedgerResultIntrinsic,
      cycleStoreAdapterCodec,
      [operation, resultBlob],
    );
    validateLedgerResult(operation, result);
    const encoded = bufferFromUtf8(canonicalSerialize(result));
    if (!buffersEqual(encoded, resultBlob) || canonicalDigest(result) !== resultHash) {
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
      const acquiredAtMs = reflectApplyIntrinsic(dateParseIntrinsic, dateIntrinsic, [lease.acquiredAt]) as
        number;
      if (!reflectApplyIntrinsic(numberIsSafeIntegerIntrinsic, numberConstructorIntrinsic, [acquiredAtMs])
          || acquiredAtMs < 0) {
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
      const acquiredAtMs = reflectApplyIntrinsic(dateParseIntrinsic, dateIntrinsic, [lock.acquiredAt]) as
        number;
      if (!reflectApplyIntrinsic(numberIsSafeIntegerIntrinsic, numberConstructorIntrinsic, [acquiredAtMs])
          || acquiredAtMs < 0) {
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
  for (let index = 0; index < checkpointRows.length; index += 1) {
    const raw = checkpointRows[index];
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
    const checkpoint = reflectApplyIntrinsic(
      codecParseStoredCheckpointIntrinsic,
      cycleStoreAdapterCodec,
      [checkpointBlob, OPERATION],
    ) as CycleStoreCheckpoint;
    validateStoredCheckpoint(checkpoint);
    const summary = checkpointSummary(checkpoint as unknown as Record<string, unknown>);
    if (checkpoint.checkpointScope !== scope
        || checkpoint.checkpointId !== checkpointId
        || checkpoint.streamId !== streamId
        || checkpoint.boundSequence !== boundSequence
        || checkpoint.boundRecordHash !== boundRecordHash
        || checkpoint.createdAt !== createdAt
        || checkpoint.valueHash !== valueHash
        || checkpoint.valueBytes !== valueBytes
        || byteLength(valueBlob) !== valueBytes
        || !buffersEqual(checkpointBlob, bufferFromUtf8(canonicalSerialize(checkpoint)))
        || !buffersEqual(valueBlob, bufferFromUtf8(canonicalSerialize(checkpoint.value)))
        || canonicalDigest(checkpoint.value) !== valueHash
        || !buffersEqual(summaryBlob, bufferFromUtf8(canonicalSerialize(summary)))) {
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
        || !buffersEqual(
          sqliteBlob(revisionRow[2], OPERATION, "current checkpoint revision summary"),
          summaryBlob,
        )
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
  for (let index = 0; index < revisionRows.length; index += 1) {
    const raw = revisionRows[index];
    const row = sqliteRow(raw, 11, OPERATION, `checkpoint revision row ${index}`);
    const tenantId = sqliteText(row[0], OPERATION, "revision tenant");
    const scope = sqliteText(row[1], OPERATION, "revision scope");
    const revision = integer(row[2], 1, MAX_SAFE_INTEGER, "checkpoint revision");
    const checkpointId = sqliteText(row[3], OPERATION, "revision checkpoint id");
    const action = sqliteText(row[4], OPERATION, "revision action");
    if (!ledgerIdentifier(tenantId)
        || !ledgerIdentifier(scope)
        || !ledgerIdentifier(checkpointId)) {
      return fail("checkpoint revision identifier");
    }
    const key = canonicalSerialize([tenantId, scope]);
    const expectedRevision = key === priorKey ? priorRevision + 1 : 1;
    if (revision !== expectedRevision) return fail("checkpoint revision sequence");
    priorKey = key;
    priorRevision = revision;
    if (action === "put") {
      const summaryBlob = sqliteBlob(row[5], OPERATION, "revision summary");
      const summary = reflectApplyIntrinsic(
        codecDecodeLedgerResultIntrinsic,
        cycleStoreAdapterCodec,
        ["save-checkpoint", summaryBlob],
      ) as CycleStoreCheckpointSummary;
      validateLedgerCheckpointSummary(summary);
      const boundSequence = integer(row[6], 0, MAX_SAFE_INTEGER, "revision sequence");
      const boundHash = sqliteText(row[7], OPERATION, "revision record hash");
      const createdAt = sqliteText(row[8], OPERATION, "revision created time");
      const valueHash = sqliteText(row[9], OPERATION, "revision value hash");
      const valueBytes = integer(row[10], 1, 16_777_216, "revision value bytes");
      if (!buffersEqual(summaryBlob, bufferFromUtf8(canonicalSerialize(summary)))
          || summary.checkpointScope !== scope
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
      for (let fieldIndex = 5; fieldIndex < row.length; fieldIndex += 1) {
        if (row[fieldIndex] !== null) return fail("checkpoint deletion revision");
      }
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
  let activeNulls = 0;
  for (let index = 0; index < 8; index += 1) {
    if (migration[index] === null) activeNulls += 1;
  }
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

  const leaseRows = rows(database, `
    SELECT tenant_id, stream_id, last_lease_epoch, last_fencing_token,
           active_lease_id, active_holder_id, active_lease_epoch,
           active_fencing_token, active_acquired_at_ms, active_expires_at_ms
      FROM ge_cycle_leases ORDER BY tenant_id, stream_id
  `);
  for (let index = 0; index < leaseRows.length; index += 1) {
    const raw = leaseRows[index];
    const row = sqliteRow(raw, 10, OPERATION, `lease row ${index}`);
    updateDigest(digest, "lease", numericProjection(row));
  }
  updateDigest(
    digest,
    "migration-lock",
    numericProjection(migration),
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
  for (let index = 0; index < cursorRows.length; index += 1) {
    const raw = cursorRows[index];
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
          || !same(requestScope, expectedScope)
          || !reflectApplyIntrinsic(arrayIsArrayIntrinsic, arrayIntrinsic, [snapshot])) {
        return fail("checkpoint cursor binding");
      }
      const snapshotItems = snapshot as readonly unknown[];
      if (nextPosition > snapshotItems.length) return fail("checkpoint cursor binding");
      const summaries: CycleStoreCheckpointSummary[] = [];
      for (let summaryIndex = 0; summaryIndex < snapshotItems.length; summaryIndex += 1) {
        const summary = snapshotItems[summaryIndex];
        const decoded = reflectApplyIntrinsic(
          codecDecodeLedgerResultIntrinsic,
          cycleStoreAdapterCodec,
          ["save-checkpoint", bufferFromUtf8(canonicalSerialize(summary))],
        ) as CycleStoreCheckpointSummary;
        const encoded = bufferFromUtf8(canonicalSerialize(decoded));
        if (decoded.checkpointScope !== scope || statement(database, `
          SELECT 1 FROM ge_cycle_checkpoint_revisions
           WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
             AND action = 'put' AND summary_blob = ?
           LIMIT 1
        `).get(tenantId, scope, decoded.checkpointId, encoded) === undefined) {
          return fail("checkpoint cursor revision binding");
        }
        reflectApplyIntrinsic(arrayPushIntrinsic, summaries, [decoded]);
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
  return objectFreezeIntrinsic({
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
  for (let index = 0; index < expectedIntegers.length; index += 1) {
    const [name, expected] = expectedIntegers[index]!;
    const actual = scalarInteger(database, `PRAGMA ${name}`, 0, MAX_SAFE_INTEGER, name);
    if (actual !== expected) return fail("connection settings");
  }
  const journalMode = reflectApplyIntrinsic(
    stringToLowerCaseIntrinsic,
    scalarText(database, "PRAGMA journal_mode", "journal mode"),
    [],
  ) as string;
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
    database = new databaseSyncIntrinsic(safePath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: true,
      timeout: 250,
    });
    reflectApplyIntrinsic(databaseExecIntrinsic, database, [
      "PRAGMA trusted_schema = OFF; PRAGMA query_only = ON",
    ]);
    inspectConnectionSettings(database);
    reflectApplyIntrinsic(databaseExecIntrinsic, database, ["BEGIN"]);
    checkPragma(database, "quick_check");
    if (rows(database, "PRAGMA foreign_key_check").length !== 0) {
      return fail("foreign keys");
    }
    if (level !== "quick") checkPragma(database, "integrity_check");
    const lineage = inspectIdentity(database);
    const semanticCounters = counters(database);
    let semanticSha256: string | null = null;
    if (level === "semantic") {
      const digest = createHashIntrinsic("sha256");
      updateHash(digest, SEMANTIC_DIGEST_DOMAIN, "utf8");
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
      const trailingQueries = [
        ["legal-hold", `SELECT tenant_id, stream_id, hold_id, placed_at_ms
                          FROM ge_cycle_legal_holds ORDER BY tenant_id, stream_id, hold_id`],
        ["used-lease", `SELECT tenant_id, stream_id, lease_id, lease_epoch,
                               fencing_token, first_used_at_ms
                          FROM ge_cycle_used_lease_ids
                         ORDER BY tenant_id, stream_id, lease_id`],
        ["used-migration", `SELECT lock_id, lock_epoch, fencing_token, first_used_at_ms
                              FROM ge_cycle_used_migration_lock_ids ORDER BY lock_id`],
      ] as const;
      for (let queryIndex = 0; queryIndex < trailingQueries.length; queryIndex += 1) {
        const [label, sql] = trailingQueries[queryIndex]!;
        const trailingRows = rows(database, sql);
        for (let rowIndex = 0; rowIndex < trailingRows.length; rowIndex += 1) {
          assertAuditRow(trailingRows[rowIndex], label, digest);
        }
      }
      updateDigest(digest, "counters", semanticCounters);
      semanticSha256 = digestHex(digest);
    }
    reflectApplyIntrinsic(databaseExecIntrinsic, database, ["COMMIT"]);
    const sqliteVersion = scalarText(database, "SELECT sqlite_version()", "SQLite version");
    return objectFreezeIntrinsic({
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
    if (database !== undefined) {
      try {
        reflectApplyIntrinsic(databaseExecIntrinsic, database, ["ROLLBACK"]);
      } catch { /* preserve the safe audit error */ }
      reflectApplyIntrinsic(databaseCloseIntrinsic, database, []);
    }
  }
}

function assertAuditRow(
  value: unknown,
  label: string,
  digest: ReturnType<typeof createHash>,
): void {
  if (!reflectApplyIntrinsic(arrayIsArrayIntrinsic, arrayIntrinsic, [value])) {
    return fail(`${label} row`);
  }
  const fields = value as readonly unknown[];
  const normalized: unknown[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (typeof field === "bigint") {
      const maximum = reflectApplyIntrinsic(bigintIntrinsic, undefined, [MAX_SAFE_INTEGER]) as bigint;
      if (field < 0n || field > maximum) return fail(`${label} integer`);
      reflectApplyIntrinsic(arrayPushIntrinsic, normalized, [
        reflectApplyIntrinsic(numberIntrinsic, undefined, [field]),
      ]);
      continue;
    }
    if (typeof field !== "string" && field !== null
        && !reflectApplyIntrinsic(isUint8ArrayIntrinsic, undefined, [field])) {
      return fail(`${label} field`);
    }
    const normalizedField = reflectApplyIntrinsic(isUint8ArrayIntrinsic, undefined, [field])
      ? reflectApplyIntrinsic(
        bufferToStringIntrinsic,
        bufferFrom(field as Uint8Array),
        ["hex"],
      )
      : field;
    reflectApplyIntrinsic(arrayPushIntrinsic, normalized, [normalizedField]);
  }
  updateDigest(digest, label, normalized);
}
