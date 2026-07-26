import { canonicalSerialize } from "@graph-engineering/core";
import type { JsonValue } from "./types.js";

function assertPortableNumbers(value: JsonValue): void {
  if (typeof value === "number") {
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new TypeError("JSON integers must be within the interoperable safe-integer range");
    }
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const child of Object.values(value)) assertPortableNumbers(child);
}

function deepFreeze(value: JsonValue): JsonValue {
  if (typeof value !== "object" || value === null) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Validate a finite JSON value and return a detached, plain-data snapshot.
 * Canonical serialization rejects non-finite numbers, unsupported primitives,
 * sparse arrays, cycles, symbol keys, and non-plain object instances. Integer
 * values are additionally restricted to the interoperable IEEE-754 safe range.
 */
export function snapshotJson(value: unknown): JsonValue {
  const snapshot = JSON.parse(canonicalSerialize(value)) as JsonValue;
  assertPortableNumbers(snapshot);
  return deepFreeze(snapshot);
}
