import { createHash } from "node:crypto";
import { compareUnicodeCodePoints } from "@graph-engineering/core";
import { snapshotJson } from "./json.js";
import type { JsonValue } from "./types.js";

export type DurableJson =
  | readonly ["n"]
  | readonly ["b", boolean]
  | readonly ["s", string]
  | readonly ["i", number]
  | readonly ["f", string]
  | readonly ["a", readonly DurableJson[]]
  | readonly ["o", readonly (readonly [string, DurableJson])[]];

function freeze<T extends readonly unknown[]>(value: T): T {
  for (const child of value) {
    if (Array.isArray(child)) freeze(child);
  }
  return Object.freeze(value);
}

function floatBits(value: number): string {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bitsFloat(value: string): number {
  const bytes = new Uint8Array(8);
  for (let index = 0; index < 8; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return new DataView(bytes.buffer).getFloat64(0, false);
}

function encode(value: JsonValue): DurableJson {
  if (value === null) return freeze(["n"] as const);
  if (typeof value === "boolean") return freeze(["b", value] as const);
  if (typeof value === "string") return freeze(["s", value] as const);
  if (typeof value === "number") {
    if (Number.isInteger(value) || Object.is(value, -0)) {
      return freeze(["i", value === 0 ? 0 : value] as const);
    }
    return freeze(["f", floatBits(value)] as const);
  }
  if (Array.isArray(value)) {
    return freeze(["a", Object.freeze(value.map(encode))] as const);
  }
  const record = value as Readonly<Record<string, JsonValue>>;
  const entries = Object.keys(record)
    .sort(compareUnicodeCodePoints)
    .map((key) => freeze([key, encode(record[key] as JsonValue)] as const));
  return freeze(["o", Object.freeze(entries)] as const);
}

/** Encode a detached portable runtime JSON value without losing binary64 bits. */
export function encodeDurableJson(value: unknown): DurableJson {
  return encode(snapshotJson(value));
}

function invalid(message: string): never {
  throw new TypeError(`Invalid Durable JSON: ${message}`);
}

function exactArray(value: JsonValue, length: number, tag?: string): readonly JsonValue[] {
  if (!Array.isArray(value) || value.length !== length) {
    return invalid(tag === undefined ? "expected a tagged array" : `tag '${tag}' has invalid arity`);
  }
  return value;
}

function decode(value: JsonValue): JsonValue {
  const tuple = exactArray(value, Array.isArray(value) ? value.length : 0);
  const tag = tuple[0];
  if (typeof tag !== "string" || tag.length !== 1) return invalid("unknown tag");

  switch (tag) {
    case "n":
      exactArray(tuple, 1, tag);
      return null;
    case "b": {
      const tagged = exactArray(tuple, 2, tag);
      if (typeof tagged[1] !== "boolean") return invalid("tag 'b' requires a boolean");
      return tagged[1];
    }
    case "s": {
      const tagged = exactArray(tuple, 2, tag);
      if (typeof tagged[1] !== "string") return invalid("tag 's' requires a string");
      return tagged[1];
    }
    case "i": {
      const tagged = exactArray(tuple, 2, tag);
      if (typeof tagged[1] !== "number" || !Number.isSafeInteger(tagged[1])) {
        return invalid("tag 'i' requires a safe integer");
      }
      return tagged[1] === 0 ? 0 : tagged[1];
    }
    case "f": {
      const tagged = exactArray(tuple, 2, tag);
      if (typeof tagged[1] !== "string" || !/^[a-f0-9]{16}$/.test(tagged[1])) {
        return invalid("tag 'f' requires sixteen lowercase hexadecimal digits");
      }
      const number = bitsFloat(tagged[1]);
      if (!Number.isFinite(number) || Number.isInteger(number) || Object.is(number, -0)) {
        return invalid("tag 'f' must encode a finite non-integer binary64 value");
      }
      return number;
    }
    case "a": {
      const tagged = exactArray(tuple, 2, tag);
      if (!Array.isArray(tagged[1])) return invalid("tag 'a' requires an item array");
      return Object.freeze(tagged[1].map(decode));
    }
    case "o": {
      const tagged = exactArray(tuple, 2, tag);
      if (!Array.isArray(tagged[1])) return invalid("tag 'o' requires an entry array");
      const result = Object.create(null) as Record<string, JsonValue>;
      let previous: string | undefined;
      for (const entry of tagged[1]) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
          return invalid("tag 'o' entries must be [string, tagged-value] pairs");
        }
        if (previous !== undefined && compareUnicodeCodePoints(previous, entry[0]) >= 0) {
          return invalid("tag 'o' keys must be unique and sorted by Unicode code point");
        }
        result[entry[0]] = decode(entry[1] as JsonValue);
        previous = entry[0];
      }
      return Object.freeze(result);
    }
    default:
      return invalid(`unknown tag '${tag}'`);
  }
}

/** Decode and strictly validate a canonical tagged Durable JSON value. */
export function decodeDurableJson(value: unknown): JsonValue {
  const snapshot = snapshotJson(value);
  const decoded = decode(snapshot);
  const canonical = encode(decoded);
  if (JSON.stringify(canonical) !== JSON.stringify(snapshot)) {
    return invalid("value is not in canonical tagged form");
  }
  // The decoder builds objects with a null prototype so assigning an own
  // `__proto__` key cannot mutate a prototype. Re-snapshot only after the
  // canonical tagged form has been proven; callers then receive the same
  // deeply frozen, ordinary JSON object shape as every other runtime boundary.
  return snapshotJson(decoded);
}

/** SHA-256 of canonical UTF-8 JSON for the tagged representation of a value. */
export function durableJsonHash(value: unknown): string {
  const tagged = encodeDurableJson(value);
  return createHash("sha256").update(JSON.stringify(tagged), "utf8").digest("hex");
}
