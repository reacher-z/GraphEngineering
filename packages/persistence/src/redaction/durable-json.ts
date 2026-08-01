/**
 * Tagged Durable JSON (`durable-json/v1alpha1`) as used by the D9 contract.
 *
 * Section 5.2 encodes a logical value as canonical Tagged Durable JSON before
 * protection, and Sections 3.3, 4.1, 5.1, 5.4, 5.5, and 8.2 all hash
 * `canonicalTagged(...)` bytes. The tagged form is arrays and primitives only,
 * so canonical UTF-8 JSON of it is fully determined by the encoder.
 *
 * This is an independent implementation of the same wire format that
 * `@graph-engineering/runtime` uses. Persistence cannot depend on runtime
 * (runtime depends on persistence), so the encoding is reimplemented here and
 * pinned by a byte-equality test.
 */

import { canonicalJsonString, compareUnicodeCodePoints, PortableJsonError } from "./portable.js";

export type DurableJson =
  | readonly ["n"]
  | readonly ["b", boolean]
  | readonly ["s", string]
  | readonly ["i", number]
  | readonly ["f", string]
  | readonly ["a", readonly DurableJson[]]
  | readonly ["o", readonly (readonly [string, DurableJson])[]];

function floatBits(value: number): string {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Encode a portable JSON value. The input must already be a portable snapshot,
 * so this walker never sees an accessor, proxy, or non-finite number.
 */
export function encodeDurableJson(value: unknown): DurableJson {
  if (value === null) return ["n"];
  if (typeof value === "boolean") return ["b", value];
  if (typeof value === "string") return ["s", value];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PortableJsonError("non-finite number");
    if (Number.isInteger(value) || Object.is(value, -0)) {
      if (!Number.isSafeInteger(value === 0 ? 0 : value)) {
        throw new PortableJsonError("integer is outside the safe range");
      }
      return ["i", value === 0 ? 0 : value];
    }
    return ["f", floatBits(value)];
  }
  if (Array.isArray(value)) {
    return ["a", value.map((item) => encodeDurableJson(item))];
  }
  if (typeof value !== "object") throw new PortableJsonError(`unsupported ${typeof value}`);
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort(compareUnicodeCodePoints)
    .map((key) => [key, encodeDurableJson(record[key])] as readonly [string, DurableJson]);
  return ["o", entries];
}

/** Canonical UTF-8 JSON of the tagged representation, as a UTF-16 string. */
export function canonicalTagged(value: unknown): string {
  return canonicalJsonString(encodeDurableJson(value));
}
