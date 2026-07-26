import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

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
  const leftPoints = Array.from(left, (value) => value.codePointAt(0) as number);
  const rightPoints = Array.from(right, (value) => value.codePointAt(0) as number);
  const length = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) {
      return difference;
    }
  }

  return leftPoints.length - rightPoints.length;
}

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
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
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
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
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    return invalid("Only ordinary arrays are supported", path);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return invalid("Symbol keys are not valid JSON array keys", path);
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (lengthDescriptor === undefined || !Object.hasOwn(lengthDescriptor, "value")) {
    return invalid("Array length could not be inspected safely", path);
  }
  const length = lengthDescriptor.value as number;
  const indexNames: string[] = [];
  for (const name of Object.getOwnPropertyNames(value)) {
    if (name === "length") continue;
    const index = Number(name);
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== name) {
      return invalid("Extra array properties are not portable JSON", `${path}/${pointerSegment(name)}`);
    }
    indexNames.push(name);
  }
  indexNames.sort((left, right) => Number(left) - Number(right));

  let expected = 0;
  for (const name of indexNames) {
    if (Number(name) !== expected) break;
    expected += 1;
  }
  if (expected !== length) {
    return invalid("Sparse arrays are not valid canonical JSON", `${path}/${expected}`);
  }

  const captured: CanonicalJsonValue[] = [];
  ancestors.add(value);
  try {
    for (const name of indexNames) {
      const descriptor = dataDescriptor(value, name, `${path}/${name}`);
      captured.push(captureValue(descriptor.value, `${path}/${name}`, ancestors));
    }
  } finally {
    ancestors.delete(value);
  }
  return Object.freeze(captured);
}

function captureObject(
  value: object,
  path: string,
  ancestors: WeakSet<object>,
): Readonly<Record<string, CanonicalJsonValue>> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid("Only plain JSON objects are supported", path);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return invalid("Symbol keys are not valid JSON object keys", path);
  }

  const captured = Object.create(null) as Record<string, CanonicalJsonValue>;
  const keys = Object.getOwnPropertyNames(value).sort(compareUnicodeCodePoints);
  ancestors.add(value);
  try {
    for (const key of keys) {
      const childPath = `${path}/${pointerSegment(key)}`;
      const descriptor = dataDescriptor(value, key, childPath);
      Object.defineProperty(captured, key, {
        value: captureValue(descriptor.value, childPath, ancestors),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
  } finally {
    ancestors.delete(value);
  }
  return Object.freeze(captured);
}

function captureValue(value: unknown, path: string, ancestors: WeakSet<object>): CanonicalJsonValue {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) {
        return invalid("Only finite JSON numbers are supported", path);
      }
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
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
  if (ancestors.has(value)) {
    return invalid("Cyclic values cannot be canonicalized", path);
  }
  return Array.isArray(value)
    ? captureArray(value, path, ancestors)
    : captureObject(value, path, ancestors);
}

function serializeCaptured(value: CanonicalJsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(serializeCaptured).join(",")}]`;
  }
  const record = value as Readonly<Record<string, CanonicalJsonValue>>;
  return `{${Object.keys(record)
    .sort(compareUnicodeCodePoints)
    .map((key) => `${JSON.stringify(key)}:${serializeCaptured(record[key] as CanonicalJsonValue)}`)
    .join(",")}}`;
}

/**
 * Inspect once through property descriptors, then detach and canonicalize. This
 * internal compiler boundary never invokes caller-owned accessors or proxy traps.
 */
export function captureCanonicalJson(value: unknown): CapturedCanonicalJson {
  try {
    const captured = captureValue(value, "#", new WeakSet<object>());
    return Object.freeze({ value: captured, serialized: serializeCaptured(captured) });
  } catch (error) {
    if (error instanceof CanonicalizationError) throw error;
    throw new CanonicalizationError("Value could not be inspected safely", "#");
  }
}

/** SHA-256 of already canonicalized bytes; intended for the compiler snapshot. */
export function hashCanonicalSerialization(serialized: string): string {
  return createHash("sha256").update(serialized, "utf8").digest("hex");
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
