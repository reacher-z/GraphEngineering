/**
 * Portable JSON snapshotting for the redaction guard.
 *
 * Section 3.3.1 step 1 requires the complete candidate to be snapshotted as
 * portable JSON before any path is consulted, with valid UTF-16 surrogate pairs
 * combined under the repository portable-string rule and colliding normalized
 * object keys rejected. Section 11 requires the depth/node/container/member
 * counters to be enforced with an explicit iterative stack, never a recursive
 * host traversal.
 */

export type PortableJson =
  | null
  | boolean
  | number
  | string
  | readonly PortableJson[]
  | { readonly [key: string]: PortableJson };

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).length;
}

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) as number);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) as number);
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = (leftPoints[index] as number) - (rightPoints[index] as number);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

/**
 * The repository portable-string rule: a portable string is a sequence of
 * Unicode scalar values. Valid surrogate pairs combine into one code point; a
 * lone surrogate is not portable text.
 */
export function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit >= 0xdc00) return true;
    const next = value.charCodeAt(index + 1);
    if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
    index += 1;
  }
  return false;
}

/** Normalize a key or string value to its portable code-point sequence. */
export function portableString(value: string): string {
  return Array.from(value, (character) => character).join("");
}

export class PortableJsonError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`value is not portable JSON: ${reason}`);
    this.name = "PortableJsonError";
    this.reason = reason;
  }
}

function isOrdinaryObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

interface SnapshotFrame {
  readonly source: unknown;
  readonly target: unknown[] | Record<string, unknown>;
  readonly depth: number;
}

export interface SnapshotMeasurement {
  readonly nodes: number;
  readonly containers: number;
  readonly members: number;
  readonly maxDepth: number;
}

export interface PortableSnapshot {
  /** A detached null-prototype copy. `__proto__` can only be an own data key. */
  readonly value: unknown;
  readonly measurement: SnapshotMeasurement;
}

function scalarCopy(value: unknown, path: string): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PortableJsonError(`non-finite number at ${path}`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) {
      throw new PortableJsonError(`unpaired surrogate at ${path}`);
    }
    return portableString(value);
  }
  throw new PortableJsonError(`unsupported ${typeof value} at ${path}`);
}

/**
 * Build a detached null-prototype snapshot with an explicit iterative stack and
 * count every Section 11 semantic counter in the same pass. Getters, proxies,
 * prototypes, and inherited properties are never invoked or traversed.
 */
export function snapshotPortableJson(input: unknown): PortableSnapshot {
  let nodes = 0;
  let containers = 0;
  let members = 0;
  let maxDepth = 0;

  const seen = new WeakSet<object>();

  type Shape =
    | { readonly container: false; readonly scalar: unknown }
    | { readonly container: true };

  const classify = (value: unknown, depth: number, path: string): Shape => {
    nodes += 1;
    if (depth > maxDepth) maxDepth = depth;
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        throw new PortableJsonError(`exotic array at ${path}`);
      }
      containers += 1;
      return { container: true };
    }
    if (isOrdinaryObject(value)) {
      containers += 1;
      return { container: true };
    }
    return { container: false, scalar: scalarCopy(value, path) };
  };

  const rootShape = classify(input, 0, "#");
  if (!rootShape.container) {
    return {
      value: rootShape.scalar,
      measurement: { nodes, containers, members, maxDepth },
    };
  }

  const rootTarget: unknown[] | Record<string, unknown> = Array.isArray(input)
    ? []
    : (Object.create(null) as Record<string, unknown>);
  seen.add(input as object);
  const stack: SnapshotFrame[] = [{ source: input, target: rootTarget, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop() as SnapshotFrame;
    if (Array.isArray(frame.source)) {
      const target = frame.target as unknown[];
      for (let index = 0; index < frame.source.length; index += 1) {
        const path = `${index}`;
        if (!Object.hasOwn(frame.source, index)) {
          throw new PortableJsonError(`sparse array element ${path}`);
        }
        const child: unknown = (frame.source as readonly unknown[])[index];
        const shape = classify(child, frame.depth + 1, path);
        if (!shape.container) {
          target[index] = shape.scalar;
          continue;
        }
        if (seen.has(child as object)) throw new PortableJsonError("cyclic value");
        seen.add(child as object);
        const nested: unknown[] | Record<string, unknown> = Array.isArray(child)
          ? []
          : (Object.create(null) as Record<string, unknown>);
        target[index] = nested;
        stack.push({ source: child, target: nested, depth: frame.depth + 1 });
      }
      continue;
    }

    const source = frame.source as Record<string, unknown>;
    const target = frame.target as Record<string, unknown>;
    if (Object.getOwnPropertySymbols(source).length > 0) {
      throw new PortableJsonError("symbol keys are not portable JSON");
    }
    const keys = Object.keys(source);
    members += keys.length;
    const normalized = new Set<string>();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        throw new PortableJsonError("accessor properties are not portable JSON");
      }
      if (hasUnpairedSurrogate(key)) throw new PortableJsonError("unpaired surrogate in key");
      const portableKey = portableString(key);
      if (normalized.has(portableKey)) {
        throw new PortableJsonError("object keys collide after portable normalization");
      }
      normalized.add(portableKey);
      const child: unknown = descriptor.value;
      const shape = classify(child, frame.depth + 1, portableKey);
      if (!shape.container) {
        Object.defineProperty(target, portableKey, {
          value: shape.scalar,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        continue;
      }
      if (seen.has(child as object)) throw new PortableJsonError("cyclic value");
      seen.add(child as object);
      const nested: unknown[] | Record<string, unknown> = Array.isArray(child)
        ? []
        : (Object.create(null) as Record<string, unknown>);
      Object.defineProperty(target, portableKey, {
        value: nested,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      stack.push({ source: child, target: nested, depth: frame.depth + 1 });
    }
  }

  return { value: rootTarget, measurement: { nodes, containers, members, maxDepth } };
}

/**
 * Convert a null-prototype snapshot back into ordinary JSON objects. An own
 * `__proto__` key is materialized with `defineProperty`, never assignment, so a
 * hostile key cannot reach `Object.prototype`.
 */
export function materializePortableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => materializePortableJson(item));
  if (typeof value !== "object" || value === null) return value;
  const source = value as Record<string, unknown>;
  const target: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    Object.defineProperty(target, key, {
      value: materializePortableJson(source[key]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return target;
}

/** Deep-freeze a materialized portable value so a caller cannot mutate it. */
export function freezePortableJson<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezePortableJson(child);
  }
  return value;
}

/** Canonical UTF-8 JSON: object members sorted by Unicode code point. */
export function canonicalJsonString(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new PortableJsonError("non-finite number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonString(item)).join(",")}]`;
  }
  if (typeof value !== "object") throw new PortableJsonError(`unsupported ${typeof value}`);
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort(compareUnicodeCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonString(record[key])}`);
  return `{${entries.join(",")}}`;
}
