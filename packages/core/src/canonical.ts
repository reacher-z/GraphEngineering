import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

const arrayIsArrayIntrinsic = Array.isArray;
const arrayPushIntrinsic = Array.prototype.push;
const arraySortIntrinsic = Array.prototype.sort;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const numberIsFiniteIntrinsic = Number.isFinite;
const numberIsIntegerIntrinsic = Number.isInteger;
const numberIntrinsic = Number;
const objectCreateIntrinsic = Object.create;
const objectDefinePropertyIntrinsic = Object.defineProperty;
const objectFreezeIntrinsic = Object.freeze;
const objectGetOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const objectGetOwnPropertyNamesIntrinsic = Object.getOwnPropertyNames;
const objectGetOwnPropertySymbolsIntrinsic = Object.getOwnPropertySymbols;
const objectGetPrototypeOfIntrinsic = Object.getPrototypeOf;
const objectHasOwnIntrinsic = Object.hasOwn;
const objectKeysIntrinsic = Object.keys;
const arrayPrototypeIntrinsic = Array.prototype;
const objectPrototypeIntrinsic = Object.prototype;
const reflectApplyIntrinsic = Reflect.apply;
const stringCodePointAtIntrinsic = String.prototype.codePointAt;
const stringReplaceAllIntrinsic = String.prototype.replaceAll;
const stringIntrinsic = String;
const jsonParseIntrinsic = JSON.parse;
const jsonStringifyIntrinsic = JSON.stringify;
const weakSetIntrinsic = WeakSet;
const weakSetAddIntrinsic = WeakSet.prototype.add;
const weakSetDeleteIntrinsic = WeakSet.prototype.delete;
const weakSetHasIntrinsic = WeakSet.prototype.has;
const createHashIntrinsic = createHash;
const hashProbe = createHashIntrinsic("sha256");
const hashUpdateIntrinsic = hashProbe.update;
const hashDigestIntrinsic = hashProbe.digest;

export class CanonicalizationError extends TypeError {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} at ${path}`);
    this.name = "CanonicalizationError";
    this.path = path;
  }
}

/** Compare strings lexicographically by Unicode code point, not UTF-16 unit. */
export function compareUnicodeCodePoints(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = reflectApplyIntrinsic(stringCodePointAtIntrinsic, left, [leftIndex]) as number;
    const rightPoint = reflectApplyIntrinsic(stringCodePointAtIntrinsic, right, [rightIndex]) as number;
    const difference = leftPoint - rightPoint;
    if (difference !== 0) {
      return difference;
    }
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return (left.length - leftIndex) - (right.length - rightIndex);
}

function pointerSegment(value: string): string {
  const escapedTilde = reflectApplyIntrinsic(
    stringReplaceAllIntrinsic,
    value,
    ["~", "~0"],
  ) as string;
  return reflectApplyIntrinsic(
    stringReplaceAllIntrinsic,
    escapedTilde,
    ["/", "~1"],
  ) as string;
}

interface CanonicalJsonObject {
  readonly [key: string]: CanonicalJsonValue;
}

interface CanonicalJsonArray extends ReadonlyArray<CanonicalJsonValue> {}

type CanonicalJsonValue =
  | null
  | string
  | boolean
  | number
  | CanonicalJsonArray
  | CanonicalJsonObject;

export interface CapturedCanonicalJson {
  /** A deeply frozen, detached, accessor-free portable JSON value. */
  readonly value: CanonicalJsonValue;
  /** Canonical bytes represented as a JavaScript UTF-16 string. */
  readonly serialized: string;
}

function invalid(message: string, path: string): never {
  throw new CanonicalizationError(message, path);
}

function dataDescriptor(
  value: object,
  key: PropertyKey,
  path: string,
): PropertyDescriptor & { value: unknown } {
  const descriptor = reflectApplyIntrinsic(objectGetOwnPropertyDescriptorIntrinsic, Object, [
    value,
    key,
  ]) as PropertyDescriptor | undefined;
  if (descriptor === undefined || !reflectApplyIntrinsic(objectHasOwnIntrinsic, Object, [
    descriptor,
    "value",
  ])) {
    return invalid("Accessor properties are not supported", path);
  }
  if (descriptor.enumerable !== true) {
    return invalid("Non-enumerable properties are not portable JSON", path);
  }
  return descriptor as PropertyDescriptor & { value: unknown };
}

function captureArray(
  value: readonly unknown[],
  path: string,
  ancestors: WeakSet<object>,
): readonly CanonicalJsonValue[] {
  if (reflectApplyIntrinsic(objectGetPrototypeOfIntrinsic, Object, [value])
      !== arrayPrototypeIntrinsic) {
    return invalid("Only ordinary arrays are supported", path);
  }
  if ((reflectApplyIntrinsic(objectGetOwnPropertySymbolsIntrinsic, Object, [value]) as symbol[])
    .length > 0) {
    return invalid("Symbol keys are not valid JSON array keys", path);
  }

  const lengthDescriptor = reflectApplyIntrinsic(
    objectGetOwnPropertyDescriptorIntrinsic,
    Object,
    [value, "length"],
  ) as PropertyDescriptor | undefined;
  if (lengthDescriptor === undefined || !reflectApplyIntrinsic(objectHasOwnIntrinsic, Object, [
    lengthDescriptor,
    "value",
  ])) {
    return invalid("Array length could not be inspected safely", path);
  }
  const length = lengthDescriptor.value as number;
  const indexNames: string[] = [];
  const ownNames = reflectApplyIntrinsic(objectGetOwnPropertyNamesIntrinsic, Object, [value]) as
    string[];
  for (let ownNameIndex = 0; ownNameIndex < ownNames.length; ownNameIndex += 1) {
    const name = ownNames[ownNameIndex] as string;
    if (name === "length") continue;
    const index = numberIntrinsic(name);
    if (!numberIsIntegerIntrinsic(index) || index < 0 || index >= length
        || stringIntrinsic(index) !== name) {
      return invalid("Extra array properties are not portable JSON", `${path}/${pointerSegment(name)}`);
    }
    reflectApplyIntrinsic(arrayPushIntrinsic, indexNames, [name]);
  }
  reflectApplyIntrinsic(arraySortIntrinsic, indexNames, [
    (left: string, right: string): number => numberIntrinsic(left) - numberIntrinsic(right),
  ]);

  let expected = 0;
  for (let indexNameIndex = 0; indexNameIndex < indexNames.length; indexNameIndex += 1) {
    const name = indexNames[indexNameIndex] as string;
    if (numberIntrinsic(name) !== expected) break;
    expected += 1;
  }
  if (expected !== length) {
    return invalid("Sparse arrays are not valid canonical JSON", `${path}/${expected}`);
  }

  const captured: CanonicalJsonValue[] = [];
  reflectApplyIntrinsic(weakSetAddIntrinsic, ancestors, [value]);
  try {
    for (let indexNameIndex = 0; indexNameIndex < indexNames.length; indexNameIndex += 1) {
      const name = indexNames[indexNameIndex] as string;
      const descriptor = dataDescriptor(value, name, `${path}/${name}`);
      reflectApplyIntrinsic(arrayPushIntrinsic, captured, [
        captureValue(descriptor.value, `${path}/${name}`, ancestors),
      ]);
    }
  } finally {
    reflectApplyIntrinsic(weakSetDeleteIntrinsic, ancestors, [value]);
  }
  return objectFreezeIntrinsic(captured);
}

function captureObject(
  value: object,
  path: string,
  ancestors: WeakSet<object>,
): Readonly<Record<string, CanonicalJsonValue>> {
  const prototype = reflectApplyIntrinsic(objectGetPrototypeOfIntrinsic, Object, [value]);
  if (prototype !== objectPrototypeIntrinsic && prototype !== null) {
    return invalid("Only plain JSON objects are supported", path);
  }
  if ((reflectApplyIntrinsic(objectGetOwnPropertySymbolsIntrinsic, Object, [value]) as symbol[])
    .length > 0) {
    return invalid("Symbol keys are not valid JSON object keys", path);
  }

  const captured = objectCreateIntrinsic(null) as Record<string, CanonicalJsonValue>;
  const keys = reflectApplyIntrinsic(objectGetOwnPropertyNamesIntrinsic, Object, [value]) as
    string[];
  reflectApplyIntrinsic(arraySortIntrinsic, keys, [compareUnicodeCodePoints]);
  reflectApplyIntrinsic(weakSetAddIntrinsic, ancestors, [value]);
  try {
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex] as string;
      const childPath = `${path}/${pointerSegment(key)}`;
      const descriptor = dataDescriptor(value, key, childPath);
      reflectApplyIntrinsic(objectDefinePropertyIntrinsic, Object, [captured, key, {
        value: captureValue(descriptor.value, childPath, ancestors),
        enumerable: true,
        configurable: false,
        writable: false,
      }]);
    }
  } finally {
    reflectApplyIntrinsic(weakSetDeleteIntrinsic, ancestors, [value]);
  }
  return objectFreezeIntrinsic(captured);
}

function captureValue(value: unknown, path: string, ancestors: WeakSet<object>): CanonicalJsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!numberIsFiniteIntrinsic(value)) {
        return invalid("Only finite JSON numbers are supported", path);
      }
      if (numberIsIntegerIntrinsic(value) && !numberIsSafeIntegerIntrinsic(value)) {
        return invalid("JSON integers must be within the interoperable safe-integer range", path);
      }
      return value === 0 ? 0 : value;
    case "undefined":
    case "bigint":
    case "function":
    case "symbol":
      return invalid(`Unsupported JSON value ${typeof value}`, path);
    case "object":
      break;
  }

  if (isProxy(value)) {
    return invalid("Proxy values are not supported", path);
  }
  if (reflectApplyIntrinsic(weakSetHasIntrinsic, ancestors, [value])) {
    return invalid("Cyclic values cannot be canonicalized", path);
  }
  return arrayIsArrayIntrinsic(value)
    ? captureArray(value, path, ancestors)
    : captureObject(value, path, ancestors);
}

function serializeCaptured(value: CanonicalJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return reflectApplyIntrinsic(jsonStringifyIntrinsic, JSON, [value]) as string;
  }
  if (arrayIsArrayIntrinsic(value)) {
    let serialized = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) serialized += ",";
      serialized += serializeCaptured(value[index] as CanonicalJsonValue);
    }
    return `${serialized}]`;
  }
  const record = value as Readonly<Record<string, CanonicalJsonValue>>;
  const keys = reflectApplyIntrinsic(objectKeysIntrinsic, Object, [record]) as string[];
  reflectApplyIntrinsic(arraySortIntrinsic, keys, [compareUnicodeCodePoints]);
  let serialized = "{";
  for (let index = 0; index < keys.length; index += 1) {
    if (index > 0) serialized += ",";
    const key = keys[index] as string;
    serialized += `${reflectApplyIntrinsic(jsonStringifyIntrinsic, JSON, [key]) as string}:${
      serializeCaptured(record[key] as CanonicalJsonValue)}`;
  }
  return `${serialized}}`;
}

/**
 * Inspect once through property descriptors, then detach and canonicalize. This
 * internal compiler boundary never invokes caller-owned accessors or proxy traps.
 */
export function captureCanonicalJson(value: unknown): CapturedCanonicalJson {
  try {
    const captured = captureValue(value, "#", new weakSetIntrinsic<object>());
    return objectFreezeIntrinsic({
      value: captured,
      serialized: serializeCaptured(captured),
    });
  } catch (error) {
    if (error instanceof CanonicalizationError) throw error;
    throw new CanonicalizationError("Value could not be inspected safely", "#");
  }
}

/** SHA-256 of already canonicalized bytes; intended for the compiler snapshot. */
export function hashCanonicalSerialization(serialized: string): string {
  const hash = createHashIntrinsic("sha256");
  reflectApplyIntrinsic(hashUpdateIntrinsic, hash, [serialized, "utf8"]);
  return reflectApplyIntrinsic(hashDigestIntrinsic, hash, ["hex"]) as string;
}

/** Canonical, whitespace-free UTF-8 JSON with recursively sorted object keys. */
export function canonicalSerialize(value: unknown): string {
  return captureCanonicalJson(value).serialized;
}

/** Lowercase hexadecimal SHA-256 of canonical UTF-8 JSON. */
export function canonicalHash(value: unknown): string {
  const { serialized } = captureCanonicalJson(value);
  return hashCanonicalSerialization(serialized);
}

/** Rehydrate trusted canonical bytes as a recursively frozen ordinary JSON value. */
export function parseFrozenCanonicalJson<T>(serialized: string): T {
  return reflectApplyIntrinsic(jsonParseIntrinsic, JSON, [serialized, (_key: string, value: unknown) => {
    if (typeof value === "object" && value !== null) return objectFreezeIntrinsic(value);
    return value;
  }]) as T;
}
