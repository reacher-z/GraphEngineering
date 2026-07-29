import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import { sqliteRow, sqliteSafeInteger } from "./sqlite-codec.js";
import {
  SQLITE_CURSOR_PUBLICATION_CATALOG_NATIVE_QUERY_INTRINSIC,
  SQLiteConnection,
  getSQLiteStatementNativeIntrinsic,
  iterateSQLiteStatementNativeIntrinsic,
  nextSQLiteStatementIteratorNativeIntrinsic,
  prepareSQLiteConnectionCursorPublicationReadIntrinsic,
  returnSQLiteStatementIteratorNativeIntrinsic,
} from "./sqlite-connection.js";
import { translateSQLiteError } from "./sqlite-errors.js";

const OPERATION = "inspect-schema" as const;
const objectFreezeIntrinsic = Object.freeze;
const objectDefinePropertyIntrinsic = Object.defineProperty;

export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY =
  SQLITE_CURSOR_PUBLICATION_CATALOG_NATIVE_QUERY_INTRINSIC;
export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256 =
  "bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c";
export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8 =
  "graph-engineering/sqlite-target-physical-catalog/v1\0";
export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES = 5_785;
export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT = 34;
export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256 =
  "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf";
export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID = 1_195_724_359;
export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION = 2;

export const SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY =
objectFreezeIntrinsic([
  "index:ge_cycle_checkpoint_revisions_lookup_idx:ge_cycle_checkpoint_revisions:9e51c4c421ba6a66fd3bdced00ef64173635c35cff91bf4609d4e424c75c10d4",
  "index:ge_cycle_checkpoints_order_idx:ge_cycle_checkpoints:76364679ad3068fa3b6a7b675f999917cdb517c2d77a8d6b679986c2e175122e",
  "index:ge_cycle_cursors_expiry_idx:ge_cycle_cursors:974a760be2f7fb492447c021dbdc86bc82f26abb07c6238892143087efa72f2a",
  "index:ge_cycle_cursors_open_idx:ge_cycle_cursors:1699d5eb1866230afd3604569e85294b67bef6eab73d854444a8da9ba1fb5fea",
  "index:ge_cycle_holds_lookup_idx:ge_cycle_legal_holds:55f4107f5a881ba5bc5c385feeffc26baf337814877d77d7fde894661b678b59",
  "index:ge_cycle_leases_expiry_idx:ge_cycle_leases:c1327bb8445d47494c87ae11f02cb7d03ad3d4f7dc432125053bd4ab9711b4e3",
  "index:ge_cycle_operation_baseline_entries_hash_uq:ge_cycle_operation_baseline_entries:dfccdf277787c39ea7434cb62f3ecb566200748f53e89faa07fd43c4d50ca64a",
  "index:ge_cycle_operation_baseline_entries_key_uq:ge_cycle_operation_baseline_entries:f67c4c3c8d26aee7ab355066c973ded45098bca135ad8f6329a1b0094f0e19e1",
  "index:ge_cycle_operations_commit_idx:ge_cycle_operations:e6327b988d646d54e985ac400bcf4874dbbaa1a533cd38b69ef38ea5acf5c5cc",
  "index:ge_cycle_operations_replay_idx:ge_cycle_operations:adead2ffcd16460f81c93445cadb8a358cb7e34a468d76d7aa4744869a49a71a",
  "index:ge_cycle_operations_sequence_uq:ge_cycle_operations:2bc47f53a077b24919689d37b4b0e4003804454fe801be5478ebeea2058638b5",
  "index:ge_cycle_records_range_idx:ge_cycle_records:0df5a752800279303577d5ca0dac3fd1e5686a93577c2d8b89a014897e703497",
  "index:ge_cycle_records_stream_hash_uq:ge_cycle_records:632ba77e052a08614d52e354a0a664e12899f90a508f4ea7add7805305646993",
  "index:ge_cycle_records_stream_sequence_hash_uq:ge_cycle_records:69a32763f756ad96d8dbaee38e8d942ec6fd0e52ab568b024121fd3890acfc58",
  "index:ge_cycle_records_tenant_hash_uq:ge_cycle_records:4c37cade016d684799fe836cc4297e472540fb5c10baeaac3717fcf4926fbf38",
  "index:ge_cycle_records_tenant_record_id_uq:ge_cycle_records:ed0019bc10cc21c26b4b14298e1d981f855f08edde0ba548cc28f11530248ed5",
  "index:ge_cycle_used_lease_ids_fence_uq:ge_cycle_used_lease_ids:22ad08b207d9617ccea4b98e32774f9de4f2c7a255cb6609ad545079b49b7533",
  "index:ge_cycle_used_migration_lock_ids_fence_uq:ge_cycle_used_migration_lock_ids:8cdff91e036b679adfa94bbe598a65350a27df3dc7dcdeef1e4bf1405fc4138b",
  "table:ge_cycle_checkpoint_revisions:ge_cycle_checkpoint_revisions:6cd5ca1cb83b687ad5d545d03f0c15a3edb02c9d88c0afdd9984ae4376d44c5c",
  "table:ge_cycle_checkpoints:ge_cycle_checkpoints:bad0a0f8e72991764c3e00ce476c6c917039b4909afa41113bcb7f40c437839d",
  "table:ge_cycle_cursors:ge_cycle_cursors:519abf879eee49cee95d6c99c5026ca629fba7bdb5037a8791a5ec03f295dcb9",
  "table:ge_cycle_leases:ge_cycle_leases:a1d6c0a18be2702fb2e8b505c1387b368bbd1b89029c43071a17c6191dc4f13d",
  "table:ge_cycle_legal_holds:ge_cycle_legal_holds:a7cfe19503c510818eebc43ddcf0b89a1847b14b8d6a577e6154df1c6368c745",
  "table:ge_cycle_migration_lock:ge_cycle_migration_lock:ef0718cd3244fd1957cfd66356735c2c2e599c27194a9af9a102fc95ab6e7aca",
  "table:ge_cycle_migrations:ge_cycle_migrations:50980e7a5377134f84888a058f99ac6150ee2049d64732c4c17729f5eaebc85a",
  "table:ge_cycle_operation_baseline_entries:ge_cycle_operation_baseline_entries:977738c76fe937c912b24cc3d17b5613d5071f9e257f2ae0c7308949869c5de7",
  "table:ge_cycle_operation_baselines:ge_cycle_operation_baselines:367358b632119e17495eb95aac470b1df11d9a6d60bc793f5cfa6ce753942679",
  "table:ge_cycle_operation_sequence:ge_cycle_operation_sequence:096a0ed10877cc23c0c62c2d5d7f90ae798378178d020e848b999ee3887372a5",
  "table:ge_cycle_operations:ge_cycle_operations:13884236ec7903d7c58654dd15f88735f5b9b454ca2b99131a17269e53d93028",
  "table:ge_cycle_records:ge_cycle_records:18864cc98a9b33c2e192473be94189f161fa21c3f0ece7489aa6f1a26fbd2cdc",
  "table:ge_cycle_schema:ge_cycle_schema:d274a42f456db9c36303b55b30500409bfab7d5f5d8980a18e19d6e552867e44",
  "table:ge_cycle_streams:ge_cycle_streams:7aea433bad2282847a12d44fd07edc4ccdc19de7431415d89e2d53bce09396ee",
  "table:ge_cycle_used_lease_ids:ge_cycle_used_lease_ids:6bba50213cc40e3e76fe475ceb8e15799658fe002357de831e1e099f31f5042e",
  "table:ge_cycle_used_migration_lock_ids:ge_cycle_used_migration_lock_ids:fefc267ccd3367aca2079d1666dbecb466a9a491a57cb0c732369bf8ab9bd71b",
] as const);

const MAXIMUM_OBSERVED_ROWS = SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT + 1;

export interface SQLiteCursorPublicationTargetCatalogRow {
  readonly name: string;
  readonly sql: string;
  readonly tableName: string;
  readonly type: string;
}

export interface SQLiteCursorPublicationTargetCatalogCanonicalRow {
  readonly name: string;
  readonly sqlSha256: string;
  readonly tableName: string;
  readonly type: string;
}

export interface SQLiteCursorPublicationTargetCatalogObservationInput {
  readonly applicationId: number;
  readonly rows: readonly SQLiteCursorPublicationTargetCatalogRow[];
  readonly userVersion: number;
}

export interface SQLiteCursorPublicationTargetCatalogSnapshot {
  readonly applicationId: number;
  readonly canonicalJson: string;
  readonly canonicalRows: readonly SQLiteCursorPublicationTargetCatalogCanonicalRow[];
  readonly canonicalUtf8Bytes: number;
  readonly catalogSha256: string;
  readonly inventory: readonly string[];
  readonly query: typeof SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY;
  readonly querySha256: typeof SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256;
  readonly rowCount: number;
  readonly userVersion: number;
}

const arrayIsArrayIntrinsic = Array.isArray;
const arrayPrototype = Array.prototype;
const objectGetOwnPropertyDescriptorsIntrinsic = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyNamesIntrinsic = Object.getOwnPropertyNames;
const objectGetOwnPropertySymbolsIntrinsic = Object.getOwnPropertySymbols;
const objectGetPrototypeOfIntrinsic = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const jsonStringifyIntrinsic = JSON.stringify;
const stringCharCodeAtIntrinsic = String.prototype.charCodeAt;
const bufferByteLengthIntrinsic = Buffer.byteLength;
const reflectApplyIntrinsic = Reflect.apply;
const hashProbe = createHash("sha256");
const hashUpdateIntrinsic = hashProbe.update;
const hashDigestIntrinsic = hashProbe.digest;

function invalid(message: string): never {
  throw new CycleStoreProviderError("GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION, message);
}

function corruption(message: string): never {
  throw new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function charCodeAt(value: string, index: number): number {
  return reflectApplyIntrinsic(stringCharCodeAtIntrinsic, value, [index]);
}

function checkedUnicodeText(value: unknown, label: string): string {
  if (typeof value !== "string") return invalid(`${label} is invalid`);
  for (let index = 0; index < value.length; index += 1) {
    const unit = charCodeAt(value, index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = charCodeAt(value, index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return invalid(`${label} is invalid`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return invalid(`${label} is invalid`);
    }
  }
  return value;
}

interface InspectedDescriptors {
  readonly descriptors: Readonly<Record<PropertyKey, PropertyDescriptor>>;
  readonly names: readonly string[];
}

function checkedDescriptors(value: unknown, label: string): InspectedDescriptors {
  if (value === null || typeof value !== "object" || isProxy(value)) {
    return invalid(`${label} is invalid`);
  }
  try {
    if (objectGetOwnPropertySymbolsIntrinsic(value).length !== 0) {
      return invalid(`${label} is invalid`);
    }
    return {
      descriptors: objectGetOwnPropertyDescriptorsIntrinsic(value),
      names: objectGetOwnPropertyNamesIntrinsic(value),
    };
  } catch {
    return invalid(`${label} is invalid`);
  }
}

function checkedDataValue(
  inspected: InspectedDescriptors,
  key: string,
  label: string,
): unknown {
  const descriptor = inspected.descriptors[key];
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
    return invalid(`${label} is invalid`);
  }
  return descriptor.value;
}

function checkedPlainObject(
  value: unknown,
  exactKeys: readonly string[],
  label: string,
): InspectedDescriptors {
  const inspected = checkedDescriptors(value, label);
  let prototype: object | null;
  try {
    prototype = objectGetPrototypeOfIntrinsic(value as object);
  } catch {
    return invalid(`${label} is invalid`);
  }
  if (prototype !== objectPrototype && prototype !== null
      || inspected.names.length !== exactKeys.length) {
    return invalid(`${label} has an invalid shape`);
  }
  for (let expectedIndex = 0; expectedIndex < exactKeys.length; expectedIndex += 1) {
    const expected = exactKeys[expectedIndex] as string;
    let found = false;
    for (let actualIndex = 0; actualIndex < inspected.names.length; actualIndex += 1) {
      if (inspected.names[actualIndex] === expected) {
        found = true;
        break;
      }
    }
    if (!found) return invalid(`${label} has an invalid shape`);
    checkedDataValue(inspected, expected, label);
  }
  return inspected;
}

interface DenseArrayInspection {
  readonly descriptors: InspectedDescriptors;
  readonly length: number;
}

function checkedDenseArray(value: unknown, label: string): DenseArrayInspection {
  if (value === null || typeof value !== "object" || isProxy(value)
      || !arrayIsArrayIntrinsic(value)) {
    return invalid(`${label} is invalid`);
  }
  let prototype: object | null;
  try {
    prototype = objectGetPrototypeOfIntrinsic(value);
  } catch {
    return invalid(`${label} is invalid`);
  }
  if (prototype !== arrayPrototype) return invalid(`${label} is invalid`);
  const descriptors = checkedDescriptors(value, label);
  const lengthDescriptor = descriptors.descriptors.length;
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
      || !numberIsSafeIntegerIntrinsic(lengthDescriptor.value)
      || (lengthDescriptor.value as number) < 0
      || descriptors.names.length !== (lengthDescriptor.value as number) + 1) {
    return invalid(`${label} must be a dense ordinary array`);
  }
  const length = lengthDescriptor.value as number;
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors.descriptors[`${index}`];
    if (descriptor === undefined || !("value" in descriptor)
        || descriptor.enumerable !== true) {
      return invalid(`${label} must be a dense ordinary array`);
    }
  }
  return { descriptors, length };
}

function checkedSafeInteger(value: unknown, label: string): number {
  if (!numberIsSafeIntegerIntrinsic(value) || (value as number) < 0
      || (value as number) > 0x7fff_ffff) {
    return invalid(`${label} is invalid`);
  }
  return value as number;
}

function sha256Utf8(...parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (let index = 0; index < parts.length; index += 1) {
    reflectApplyIntrinsic(hashUpdateIntrinsic, hash, [parts[index] as string, "utf8"]);
  }
  return reflectApplyIntrinsic(hashDigestIntrinsic, hash, ["hex"]);
}

function jsonString(value: string): string {
  return reflectApplyIntrinsic(jsonStringifyIntrinsic, JSON, [value]) as string;
}

interface EncodedRows {
  readonly canonicalJson: string;
  readonly canonicalRows: readonly SQLiteCursorPublicationTargetCatalogCanonicalRow[];
  readonly inventory: readonly string[];
}

function defineDenseArrayValue<T>(array: T[], index: number, value: T): void {
  reflectApplyIntrinsic(objectDefinePropertyIntrinsic, Object, [array, `${index}`, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  }]);
}

function encodeRows(rows: unknown): EncodedRows {
  const inspectedRows = checkedDenseArray(rows, "SQLite target catalog rows");
  const canonicalRows: SQLiteCursorPublicationTargetCatalogCanonicalRow[] = [];
  const inventory: string[] = [];
  let canonicalJson = "[";
  for (let index = 0; index < inspectedRows.length; index += 1) {
    const row = checkedPlainObject(
      checkedDataValue(inspectedRows.descriptors, `${index}`, "SQLite target catalog row"),
      ["name", "sql", "tableName", "type"],
      "SQLite target catalog row",
    );
    const name = checkedUnicodeText(
      checkedDataValue(row, "name", "SQLite target catalog row name"),
      "SQLite target catalog row name",
    );
    const sql = checkedUnicodeText(
      checkedDataValue(row, "sql", "SQLite target catalog row SQL"),
      "SQLite target catalog row SQL",
    );
    const tableName = checkedUnicodeText(
      checkedDataValue(row, "tableName", "SQLite target catalog row table name"),
      "SQLite target catalog row table name",
    );
    const type = checkedUnicodeText(
      checkedDataValue(row, "type", "SQLite target catalog row type"),
      "SQLite target catalog row type",
    );
    const sqlSha256 = sha256Utf8(sql);
    const canonical = objectFreezeIntrinsic({ name, sqlSha256, tableName, type });
    defineDenseArrayValue(canonicalRows, index, canonical);
    defineDenseArrayValue(inventory, index, `${type}:${name}:${tableName}:${sqlSha256}`);
    if (index !== 0) canonicalJson += ",";
    canonicalJson += `{"name":${jsonString(name)},"sqlSha256":${jsonString(sqlSha256)},`
      + `"tableName":${jsonString(tableName)},"type":${jsonString(type)}}`;
  }
  canonicalJson += "]";
  return {
    canonicalJson,
    canonicalRows: objectFreezeIntrinsic(canonicalRows),
    inventory: objectFreezeIntrinsic(inventory),
  };
}

export function encodeSQLiteCursorPublicationTargetCatalogRowsIntrinsic(rows: unknown): string {
  return encodeRows(rows).canonicalJson;
}

export function snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
  input: unknown,
): SQLiteCursorPublicationTargetCatalogSnapshot {
  const inspected = checkedPlainObject(
    input,
    ["applicationId", "rows", "userVersion"],
    "SQLite target catalog observation",
  );
  const applicationId = checkedSafeInteger(
    checkedDataValue(inspected, "applicationId", "SQLite target catalog application ID"),
    "SQLite target catalog application ID",
  );
  const userVersion = checkedSafeInteger(
    checkedDataValue(inspected, "userVersion", "SQLite target catalog user version"),
    "SQLite target catalog user version",
  );
  const encoded = encodeRows(
    checkedDataValue(inspected, "rows", "SQLite target catalog rows"),
  );
  const canonicalUtf8Bytes = reflectApplyIntrinsic(
    bufferByteLengthIntrinsic, Buffer, [encoded.canonicalJson, "utf8"],
  ) as number;
  return objectFreezeIntrinsic({
    applicationId,
    canonicalJson: encoded.canonicalJson,
    canonicalRows: encoded.canonicalRows,
    canonicalUtf8Bytes,
    catalogSha256: sha256Utf8(
      SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
      encoded.canonicalJson,
    ),
    inventory: encoded.inventory,
    query: SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
    querySha256: SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
    rowCount: encoded.canonicalRows.length,
    userVersion,
  });
}

export function validateSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
  input: unknown,
): SQLiteCursorPublicationTargetCatalogSnapshot {
  const snapshot = snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic(input);
  let inventoryMatches = snapshot.inventory.length
    === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY.length;
  for (let index = 0; inventoryMatches && index < snapshot.inventory.length; index += 1) {
    inventoryMatches = snapshot.inventory[index]
      === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY[index];
  }
  if (snapshot.applicationId !== SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
      || snapshot.userVersion !== SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION
      || snapshot.rowCount !== SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
      || snapshot.canonicalUtf8Bytes
        !== SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES
      || snapshot.catalogSha256 !== SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
      || sha256Utf8(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY)
        !== SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256
      || !inventoryMatches) {
    return corruption("SQLite target physical catalog does not match the frozen target");
  }
  return snapshot;
}

export function readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
  connection: SQLiteConnection,
): SQLiteCursorPublicationTargetCatalogSnapshot {
  let statement;
  try {
    statement = prepareSQLiteConnectionCursorPublicationReadIntrinsic(
      connection,
      "cursor-publication-target-catalog",
      OPERATION,
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    if (translated !== error) return invalid("SQLite target catalog connection is invalid");
    throw translated;
  }
  let iterator;
  try {
    iterator = iterateSQLiteStatementNativeIntrinsic(statement);
  } catch (error) {
    throw translateSQLiteError(error, OPERATION);
  }
  const rows: SQLiteCursorPublicationTargetCatalogRow[] = [];
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    while (rows.length < MAXIMUM_OBSERVED_ROWS) {
      const step = nextSQLiteStatementIteratorNativeIntrinsic(iterator);
      if (step !== null && typeof step === "object" && step.done === true) break;
      const row = sqliteRow(
        step !== null && typeof step === "object" ? step.value : undefined,
        4,
        OPERATION,
        "target physical catalog row",
      );
      const type = typeof row[0] === "string"
        ? row[0]
        : corruption("SQLite target physical catalog row type is invalid");
      const name = typeof row[1] === "string"
        ? row[1]
        : corruption("SQLite target physical catalog row name is invalid");
      const tableName = typeof row[2] === "string"
        ? row[2]
        : corruption("SQLite target physical catalog row table name is invalid");
      const sql = typeof row[3] === "string"
        ? row[3]
        : corruption("SQLite target physical catalog row SQL is invalid");
      defineDenseArrayValue(rows, rows.length, { name, sql, tableName, type });
    }
  } catch (error) {
    hasPrimaryError = true;
    primaryError = translateSQLiteError(error, OPERATION);
  }
  let closeError: unknown;
  try {
    returnSQLiteStatementIteratorNativeIntrinsic(iterator);
  } catch (error) {
    closeError = translateSQLiteError(error, OPERATION);
  }
  if (hasPrimaryError) throw primaryError;
  if (closeError !== undefined) throw closeError;

  let metadataValue: unknown;
  try {
    const metadataStatement = prepareSQLiteConnectionCursorPublicationReadIntrinsic(
      connection, "cursor-publication-target-metadata", OPERATION,
    );
    metadataValue = getSQLiteStatementNativeIntrinsic(metadataStatement);
  } catch (error) {
    throw translateSQLiteError(error, OPERATION);
  }
  const metadata = sqliteRow(metadataValue, 2, OPERATION, "target physical catalog metadata");
  return snapshotSQLiteCursorPublicationTargetCatalogObservationIntrinsic({
    applicationId: sqliteSafeInteger(
      metadata[0], 0, 0x7fff_ffff, OPERATION, "target catalog application ID",
    ),
    rows,
    userVersion: sqliteSafeInteger(
      metadata[1], 0, 0x7fff_ffff, OPERATION, "target catalog user version",
    ),
  });
}
