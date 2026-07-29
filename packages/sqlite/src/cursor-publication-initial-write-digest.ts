import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

const OPERATION = "inspect-schema" as const;

export const SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8 =
  "graph-engineering/sqlite-initial-write-parameters/v1\0" as const;
export const SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8 =
  "graph-engineering/sqlite-initial-write-result/v1\0" as const;
export const SQLITE_INITIAL_WRITE_SIGNED_INT64_MINIMUM = "-9223372036854775808" as const;
export const SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM = "9223372036854775807" as const;

export type SQLiteInitialWriteTaggedScalar =
  | Readonly<{ type: "text"; value: string }>
  | Readonly<{ type: "integer"; value: string }>
  | Readonly<{ type: "blob"; value: string }>
  | Readonly<{ type: "null" }>;

export type SQLiteInitialWriteParameterExecutions =
  readonly (readonly SQLiteInitialWriteTaggedScalar[])[];

export interface SQLiteInitialWriteResult {
  readonly affectedRows: string;
}

declare const SQLITE_INITIAL_WRITE_SHA256: unique symbol;
export type SQLiteInitialWriteSha256 = string & {
  readonly [SQLITE_INITIAL_WRITE_SHA256]: true;
};

const arrayIsArrayIntrinsic = Array.isArray;
const objectGetOwnPropertyDescriptorsIntrinsic = Object.getOwnPropertyDescriptors;
const objectGetOwnPropertyNamesIntrinsic = Object.getOwnPropertyNames;
const objectGetOwnPropertySymbolsIntrinsic = Object.getOwnPropertySymbols;
const objectGetPrototypeOfIntrinsic = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const jsonStringifyIntrinsic = JSON.stringify;
const stringCharCodeAtIntrinsic = String.prototype.charCodeAt;
const bufferFromIntrinsic = Buffer.from;
const bufferToStringIntrinsic = Buffer.prototype.toString;
const reflectApplyIntrinsic = Reflect.apply;
const hashProbe = createHash("sha256");
const hashUpdateIntrinsic = hashProbe.update;
const hashDigestIntrinsic = hashProbe.digest;

function charCodeAt(value: string, index: number): number {
  return reflectApplyIntrinsic(stringCharCodeAtIntrinsic, value, [index]);
}

function invalid(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    OPERATION,
    message,
  );
}

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = charCodeAt(value, index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = charCodeAt(value, index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

interface InspectedDescriptors {
  readonly descriptors: Readonly<Record<PropertyKey, PropertyDescriptor>>;
  readonly names: readonly string[];
}

function checkedDescriptors(
  value: unknown,
  label: string,
): InspectedDescriptors {
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
  if (descriptor === undefined || !("value" in descriptor)
      || descriptor.enumerable !== true) {
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
  if (prototype !== objectPrototype && prototype !== null) {
    return invalid(`${label} is invalid`);
  }
  if (inspected.names.length !== exactKeys.length) {
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
  // `Array.isArray` throws for a revoked Proxy(array), whereas `isProxy` can
  // reject it without consulting the revoked target.
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
  const inspected = checkedDescriptors(value, label);
  const lengthDescriptor = inspected.descriptors.length;
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
      || !numberIsSafeIntegerIntrinsic(lengthDescriptor.value)
      || (lengthDescriptor.value as number) < 0) {
    return invalid(`${label} is invalid`);
  }
  const length = lengthDescriptor.value as number;
  if (inspected.names.length !== length + 1) {
    return invalid(`${label} must be a dense ordinary array`);
  }
  for (let index = 0; index < length; index += 1) {
    const key = `${index}`;
    const descriptor = inspected.descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)
        || descriptor.enumerable !== true) {
      return invalid(`${label} must be a dense ordinary array`);
    }
  }
  return { descriptors: inspected, length };
}

function checkedInteger(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalid("SQLite initial-write integer is invalid");
  }
  if (value === "0") return value;
  const negative = charCodeAt(value, 0) === 45;
  const digitStart = negative ? 1 : 0;
  if (digitStart === value.length) return invalid("SQLite initial-write integer is invalid");
  const first = charCodeAt(value, digitStart);
  if (first < 49 || first > 57) return invalid("SQLite initial-write integer is invalid");
  const bound = negative
    ? "9223372036854775808"
    : SQLITE_INITIAL_WRITE_SIGNED_INT64_MAXIMUM;
  const digitCount = value.length - digitStart;
  if (digitCount > bound.length) {
    return invalid("SQLite initial-write integer is outside signed 64-bit bounds");
  }
  for (let index = digitStart + 1; index < value.length; index += 1) {
    const unit = charCodeAt(value, index);
    if (unit < 48 || unit > 57) return invalid("SQLite initial-write integer is invalid");
  }
  if (digitCount === bound.length) {
    for (let index = 0; index < digitCount; index += 1) {
      const actual = charCodeAt(value, digitStart + index);
      const maximum = charCodeAt(bound, index);
      if (actual < maximum) break;
      if (actual > maximum) {
        return invalid("SQLite initial-write integer is outside signed 64-bit bounds");
      }
    }
  }
  return value;
}

function checkedBlob(value: unknown): string {
  if (typeof value !== "string" || value.length % 4 === 1) {
    return invalid("SQLite initial-write BLOB is invalid");
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = charCodeAt(value, index);
    if (!((unit >= 65 && unit <= 90) || (unit >= 97 && unit <= 122)
        || (unit >= 48 && unit <= 57) || unit === 45 || unit === 95)) {
      return invalid("SQLite initial-write BLOB is invalid");
    }
  }
  let canonical: string;
  try {
    const bytes = reflectApplyIntrinsic(bufferFromIntrinsic, Buffer, [value, "base64url"]);
    canonical = reflectApplyIntrinsic(bufferToStringIntrinsic, bytes, ["base64url"]);
  } catch {
    return invalid("SQLite initial-write BLOB is invalid");
  }
  if (canonical !== value) return invalid("SQLite initial-write BLOB is not canonical");
  return value;
}

function checkedTaggedScalar(value: unknown): string {
  const base = checkedDescriptors(value, "SQLite initial-write tagged scalar");
  let prototype: object | null;
  try {
    prototype = objectGetPrototypeOfIntrinsic(value as object);
  } catch {
    return invalid("SQLite initial-write tagged scalar is invalid");
  }
  if (prototype !== objectPrototype && prototype !== null) {
    return invalid("SQLite initial-write tagged scalar is invalid");
  }
  const type = checkedDataValue(base, "type", "SQLite initial-write scalar type");
  if (type === "null") {
    checkedPlainObject(value, ["type"], "SQLite initial-write tagged scalar");
    return "{\"type\":\"null\"}";
  }

  const descriptors = checkedPlainObject(
    value, ["type", "value"], "SQLite initial-write tagged scalar",
  );
  const raw = checkedDataValue(descriptors, "value", "SQLite initial-write scalar value");
  if (type === "text") {
    if (typeof raw !== "string" || !isUnicodeScalarString(raw)) {
      return invalid("SQLite initial-write text is not valid Unicode scalar text");
    }
    const encoded = jsonStringifyIntrinsic(raw);
    if (encoded === undefined) return invalid("SQLite initial-write text is invalid");
    return `{\"type\":\"text\",\"value\":${encoded}}`;
  }
  if (type === "integer") {
    return `{\"type\":\"integer\",\"value\":\"${checkedInteger(raw)}\"}`;
  }
  if (type === "blob") {
    return `{\"type\":\"blob\",\"value\":\"${checkedBlob(raw)}\"}`;
  }
  return invalid("SQLite initial-write scalar type is invalid");
}

function hash(domain: string, canonicalJson: string): SQLiteInitialWriteSha256 {
  const digest = createHash("sha256");
  reflectApplyIntrinsic(hashUpdateIntrinsic, digest, [domain, "utf8"]);
  reflectApplyIntrinsic(hashUpdateIntrinsic, digest, [canonicalJson, "utf8"]);
  return reflectApplyIntrinsic(hashDigestIntrinsic, digest, ["hex"]) as
    SQLiteInitialWriteSha256;
}

/** Validate, detach and canonically encode the exact two-dimensional parameter frame. */
export function encodeSQLiteInitialWriteParameterPayloadIntrinsic(executions: unknown): string {
  const outer = checkedDenseArray(executions, "SQLite initial-write execution frame");
  let encoded = "[";
  for (let executionIndex = 0; executionIndex < outer.length; executionIndex += 1) {
    if (executionIndex !== 0) encoded += ",";
    const execution = outer.descriptors.descriptors[`${executionIndex}`] as
      PropertyDescriptor & { value: unknown };
    const parameters = checkedDenseArray(
      execution.value, `SQLite initial-write execution ${executionIndex} parameters`,
    );
    encoded += "[";
    for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
      if (parameterIndex !== 0) encoded += ",";
      const parameter = parameters.descriptors.descriptors[`${parameterIndex}`] as
        PropertyDescriptor & { value: unknown };
      encoded += checkedTaggedScalar(parameter.value);
    }
    encoded += "]";
  }
  return `${encoded}]`;
}

/** Domain-separated SHA-256 of the canonical two-dimensional parameter frame. */
export function digestSQLiteInitialWriteParametersIntrinsic(
  executions: unknown,
): SQLiteInitialWriteSha256 {
  return hash(
    SQLITE_INITIAL_WRITE_PARAMETER_DOMAIN_UTF8,
    encodeSQLiteInitialWriteParameterPayloadIntrinsic(executions),
  );
}

/** Validate and canonically encode the complete logical result aggregate. */
export function encodeSQLiteInitialWriteResultPayloadIntrinsic(result: unknown): string {
  const descriptors = checkedPlainObject(
    result, ["affectedRows"], "SQLite initial-write result",
  );
  const affectedRows = checkedDataValue(
    descriptors, "affectedRows", "SQLite initial-write affected rows",
  );
  if (typeof affectedRows !== "string" || affectedRows.length === 0) {
    return invalid("SQLite initial-write affected rows are invalid");
  }
  if (affectedRows !== "0") {
    const first = charCodeAt(affectedRows, 0);
    if (first < 49 || first > 57) {
      return invalid("SQLite initial-write affected rows are invalid");
    }
    for (let index = 1; index < affectedRows.length; index += 1) {
      const unit = charCodeAt(affectedRows, index);
      if (unit < 48 || unit > 57) {
        return invalid("SQLite initial-write affected rows are invalid");
      }
    }
  }
  return `{\"affectedRows\":\"${affectedRows}\"}`;
}

/** Domain-separated SHA-256 of the complete logical result aggregate. */
export function digestSQLiteInitialWriteResultIntrinsic(
  result: unknown,
): SQLiteInitialWriteSha256 {
  return hash(
    SQLITE_INITIAL_WRITE_RESULT_DOMAIN_UTF8,
    encodeSQLiteInitialWriteResultPayloadIntrinsic(result),
  );
}
