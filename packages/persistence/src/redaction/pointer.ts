/**
 * The exact RFC 6901 pointer resolution and transform order of
 * spec/redaction-semantics.md Section 3.3.1.
 *
 * The transform is a total deterministic result operation: it returns either one
 * transformed snapshot plus its canonical path list, or one structured
 * `REDACTION_POLICY_INVALID`/`REDACTION_RECEIPT_INVALID` denial. A malformed
 * pointer, missing target, normalization collision, unsupported value, or
 * internal exception never produces a partial candidate and never escapes into a
 * raw diagnostic.
 */

import type { RedactionFailureCode } from "./codes.js";
import { SECTION_11_LIMITS, type PortableLimits } from "./limits.js";
import {
  canonicalJsonString,
  compareUnicodeCodePoints,
  materializePortableJson,
  PortableJsonError,
  snapshotPortableJson,
  utf8ByteLength,
} from "./portable.js";

export const REDACTION_TOKEN = "[REDACTED]";

/**
 * Section 3.3.1 step 2: after decoding, a token equal to any of these
 * invalidates the entire transform at any depth, regardless of whether it is an
 * own JSON member.
 */
export const FORBIDDEN_POINTER_TOKENS: readonly string[] = Object.freeze([
  "__proto__",
  "prototype",
  "constructor",
]);

export type ReplacementMode = "remove" | "constant-token";

export type TransformResult =
  | {
      readonly valid: true;
      readonly output: unknown;
      readonly canonicalPaths: readonly string[];
    }
  | {
      readonly valid: false;
      readonly code: RedactionFailureCode;
      readonly reason: string;
    };

class TransformDenial extends Error {
  readonly code: RedactionFailureCode;
  readonly reason: string;

  constructor(code: RedactionFailureCode, reason: string) {
    super(`${code}: ${reason}`);
    this.name = "TransformDenial";
    this.code = code;
    this.reason = reason;
  }
}

function deny(code: RedactionFailureCode, reason: string): never {
  throw new TransformDenial(code, reason);
}

/**
 * Section 3.3.1 step 2. Split only on literal `/`; decode `~1` as `/` and `~0`
 * as `~`; reject `~` followed by anything else or by end-of-token; require the
 * decode/re-encode round trip to reproduce the input token exactly.
 */
export function decodePointer(pointer: unknown): readonly string[] {
  if (typeof pointer !== "string") deny("REDACTION_RECEIPT_INVALID", "pointer-not-a-string");
  if (pointer.length === 0) deny("REDACTION_RECEIPT_INVALID", "root-pointer-not-permitted");
  if (!pointer.startsWith("/")) deny("REDACTION_RECEIPT_INVALID", "pointer-missing-leading-slash");

  const rawTokens = pointer.slice(1).split("/");
  const tokens: string[] = [];
  for (const rawToken of rawTokens) {
    let decoded = "";
    for (let index = 0; index < rawToken.length; index += 1) {
      const character = rawToken[index] as string;
      if (character !== "~") {
        decoded += character;
        continue;
      }
      const next = rawToken[index + 1];
      if (next !== "0" && next !== "1") {
        deny("REDACTION_RECEIPT_INVALID", "invalid-escape-sequence");
      }
      decoded += next === "0" ? "~" : "/";
      index += 1;
    }
    const reEncoded = decoded.replaceAll("~", "~0").replaceAll("/", "~1");
    if (reEncoded !== rawToken) {
      deny("REDACTION_RECEIPT_INVALID", "token-is-not-canonically-escaped");
    }
    if (FORBIDDEN_POINTER_TOKENS.includes(decoded)) {
      deny("REDACTION_RECEIPT_INVALID", "forbidden-prototype-member-token");
    }
    tokens.push(decoded);
  }
  return tokens;
}

/** Encode one decoded token chain back into a canonical RFC 6901 pointer. */
export function encodePointer(tokens: readonly string[]): string {
  return tokens.map((token) => `/${token.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

function enforcePointerLimits(
  pointer: string,
  tokens: readonly string[],
  limits: PortableLimits,
): void {
  if (utf8ByteLength(pointer) > limits.maxPointerUtf8Bytes) {
    deny("REDACTION_POLICY_INVALID", "pointer-exceeds-maxPointerUtf8Bytes");
  }
  if (tokens.length > limits.maxPointerTokens) {
    deny("REDACTION_RECEIPT_INVALID", "pointer-exceeds-maxPointerTokens");
  }
  for (const token of tokens) {
    if (utf8ByteLength(token) > limits.maxPointerTokenUtf8Bytes) {
      deny("REDACTION_RECEIPT_INVALID", "token-exceeds-maxPointerTokenUtf8Bytes");
    }
  }
}

function isContainerObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CANONICAL_ARRAY_INDEX = /^[1-9][0-9]*$/;

/**
 * Section 3.3.1 steps 3 and 4: resolve one decoded token chain against the
 * immutable snapshot. Object traversal uses only own data properties of the
 * null-prototype snapshot; a numeric-looking object key stays an object key.
 */
function resolveTokens(snapshot: unknown, tokens: readonly string[]): void {
  let current: unknown = snapshot;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (token !== "0" && !CANONICAL_ARRAY_INDEX.test(token)) {
        deny("REDACTION_RECEIPT_INVALID", "array-token-is-not-a-canonical-index");
      }
      const parsed = Number(token);
      if (parsed >= current.length) deny("REDACTION_RECEIPT_INVALID", "array-index-out-of-range");
      current = current[parsed];
      continue;
    }
    if (isContainerObject(current)) {
      if (!Object.hasOwn(current, token)) {
        deny("REDACTION_RECEIPT_INVALID", "member-does-not-exist");
      }
      current = current[token];
      continue;
    }
    deny("REDACTION_RECEIPT_INVALID", "token-addresses-a-non-container");
  }
}

function containerAt(root: unknown, tokens: readonly string[]): unknown {
  let current: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index] as string;
    current = Array.isArray(current)
      ? current[Number(token)]
      : (current as Record<string, unknown>)[token];
  }
  return current;
}

function isAncestor(shorter: readonly string[], longer: readonly string[]): boolean {
  if (shorter.length >= longer.length) return false;
  return shorter.every((token, index) => token === longer[index]);
}

function assignMember(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/**
 * Apply the closed JSON Pointer transform.
 *
 * The order below is normative: Section 11 limits are evaluated before target,
 * overlap, and mutation checks, and a limit failure wins and produces no partial
 * result.
 */
export function redactionTransform(
  input: unknown,
  paths: readonly string[],
  replacementMode: string,
  limits: PortableLimits = SECTION_11_LIMITS,
): TransformResult {
  try {
    if (!Array.isArray(paths) || paths.length === 0) {
      deny("REDACTION_RECEIPT_INVALID", "at-least-one-pointer-is-required");
    }
    if (paths.length > limits.maxPointersPerRule) {
      deny("REDACTION_POLICY_INVALID", "rule-exceeds-maxPointersPerRule");
    }
    if (replacementMode !== "remove" && replacementMode !== "constant-token") {
      deny("REDACTION_RECEIPT_INVALID", "unknown-replacement-mode");
    }

    const decoded = paths.map((pointer) => {
      const tokens = decodePointer(pointer);
      enforcePointerLimits(pointer as string, tokens, limits);
      return tokens;
    });

    let snapshot: unknown;
    try {
      const captured = snapshotPortableJson(input);
      snapshot = captured.value;
      const { measurement } = captured;
      if (measurement.maxDepth > limits.maxValueDepth) {
        deny("REDACTION_RECEIPT_INVALID", "value-exceeds-maxValueDepth");
      }
      if (measurement.nodes > limits.maxValueNodes) {
        deny("REDACTION_RECEIPT_INVALID", "value-exceeds-maxValueNodes");
      }
      if (measurement.containers > limits.maxContainers) {
        deny("REDACTION_RECEIPT_INVALID", "value-exceeds-maxContainers");
      }
      if (measurement.members > limits.maxObjectMembers) {
        deny("REDACTION_RECEIPT_INVALID", "value-exceeds-maxObjectMembers");
      }
    } catch (error) {
      if (error instanceof TransformDenial) throw error;
      if (error instanceof PortableJsonError) {
        deny("REDACTION_RECEIPT_INVALID", `snapshot-${error.reason}`);
      }
      throw error;
    }

    for (let index = 1; index < paths.length; index += 1) {
      if (compareUnicodeCodePoints(paths[index - 1] as string, paths[index] as string) >= 0) {
        deny("REDACTION_RECEIPT_INVALID", "pointers-are-not-in-strict-code-point-order");
      }
    }
    for (let left = 0; left < decoded.length; left += 1) {
      for (let right = 0; right < decoded.length; right += 1) {
        if (left === right) continue;
        if (isAncestor(decoded[left] as readonly string[], decoded[right] as readonly string[])) {
          deny("REDACTION_RECEIPT_INVALID", "pointers-form-an-ancestor-descendant-pair");
        }
      }
    }

    for (const tokens of decoded) resolveTokens(snapshot, tokens);

    const locations = decoded.map((tokens) => JSON.stringify(tokens));
    if (new Set(locations).size !== locations.length) {
      deny("REDACTION_RECEIPT_INVALID", "pointers-resolve-to-duplicate-locations");
    }

    if (replacementMode === "remove") {
      for (const tokens of decoded) {
        if (Array.isArray(containerAt(snapshot, tokens))) {
          deny("REDACTION_RECEIPT_INVALID", "remove-cannot-delete-an-array-element");
        }
      }
    }

    // Deepest first; at equal depth, reverse code-point order.
    const ordered = decoded
      .map((tokens, index) => ({ tokens, pointer: paths[index] as string }))
      .sort((left, right) => {
        if (left.tokens.length !== right.tokens.length) {
          return right.tokens.length - left.tokens.length;
        }
        return compareUnicodeCodePoints(right.pointer, left.pointer);
      });

    for (const { tokens } of ordered) {
      const parent = containerAt(snapshot, tokens);
      const leaf = tokens[tokens.length - 1] as string;
      if (Array.isArray(parent)) {
        parent[Number(leaf)] = REDACTION_TOKEN;
        continue;
      }
      const record = parent as Record<string, unknown>;
      if (replacementMode === "remove") {
        delete record[leaf];
        continue;
      }
      assignMember(record, leaf, REDACTION_TOKEN);
    }

    const output = materializePortableJson(snapshot);
    const serialized = canonicalJsonString(output);
    if (utf8ByteLength(serialized) > limits.maxTransformedUtf8Bytes) {
      deny("REDACTION_RECEIPT_INVALID", "transformed-value-exceeds-maxTransformedUtf8Bytes");
    }

    return { valid: true, output, canonicalPaths: [...paths] };
  } catch (error) {
    if (error instanceof TransformDenial) {
      return { valid: false, code: error.code, reason: error.reason };
    }
    // Section 3.3.1: an internal exception never escapes into a raw diagnostic.
    return { valid: false, code: "REDACTION_RECEIPT_INVALID", reason: "internal-transform-failure" };
  }
}
