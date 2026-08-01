/**
 * The opaque in-memory `PreparedSinkWrite` of spec/redaction-semantics.md
 * Section 7.
 *
 * "The prepared write binds the single sink instance, canonical final bytes,
 * payload hash, policy hash, and decision identity. Its constructor is private
 * to the guard, it cannot be serialized or cloned, and the matching sink
 * consumes it at most once. Changed bytes, destination, policy, or decision
 * require a new guard evaluation."
 *
 * The runtime enforcement here is deliberate and not merely a TypeScript
 * `private`:
 *
 * - the constructor demands a module-private symbol, so no caller can build one;
 * - all state lives in a module-private `WeakMap` keyed by the instance, so the
 *   object has no own enumerable properties and `structuredClone` produces a
 *   stateless husk that `consume` rejects;
 * - `toJSON` and the Node inspection hook throw or redact, so a prepared write
 *   cannot be logged, serialized, or posted into a sink as data.
 */

import type { CaptureSinkClass } from "./codes.js";
import type { PayloadDisposition } from "./disposition.js";

const CONSTRUCTOR_TOKEN = Symbol("graph-engineering/prepared-sink-write");

interface PreparedState {
  readonly sink: CaptureSinkClass;
  /** Object identity of the one sink adapter allowed to consume this write. */
  readonly sinkBinding: object;
  readonly bytes: string;
  readonly payloadHash: string;
  readonly capturePolicyHash: string;
  readonly decisionId: string;
  readonly payloadDisposition: PayloadDisposition;
  readonly record: unknown;
  consumed: boolean;
}

const STATE = new WeakMap<PreparedSinkWrite, PreparedState>();

export class PreparedSinkWrite {
  constructor(token: symbol) {
    if (token !== CONSTRUCTOR_TOKEN) {
      throw new TypeError(
        "PreparedSinkWrite is produced only by the sink-before-write guard",
      );
    }
  }

  /** Non-sensitive facts a sink adapter may read before consuming. */
  get sink(): CaptureSinkClass {
    return requireState(this).sink;
  }

  get payloadHash(): string {
    return requireState(this).payloadHash;
  }

  get capturePolicyHash(): string {
    return requireState(this).capturePolicyHash;
  }

  get decisionId(): string {
    return requireState(this).decisionId;
  }

  get payloadDisposition(): PayloadDisposition {
    return requireState(this).payloadDisposition;
  }

  get consumed(): boolean {
    return requireState(this).consumed;
  }

  toJSON(): never {
    throw new TypeError("PreparedSinkWrite is not serializable");
  }

  toString(): string {
    return "[PreparedSinkWrite]";
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[PreparedSinkWrite]";
  }
}

function requireState(write: PreparedSinkWrite): PreparedState {
  const state = STATE.get(write);
  if (state === undefined) {
    throw new TypeError("PreparedSinkWrite has no guard state; it was cloned or forged");
  }
  return state;
}

/** Guard-internal factory. Not exported from the package index. */
export function createPreparedSinkWrite(
  state: Omit<PreparedState, "consumed">,
): PreparedSinkWrite {
  const write = new PreparedSinkWrite(CONSTRUCTOR_TOKEN);
  STATE.set(write, { ...state, consumed: false });
  return write;
}

export type ConsumeResult =
  | {
      readonly ok: true;
      readonly bytes: string;
      readonly record: unknown;
      readonly payloadHash: string;
      readonly capturePolicyHash: string;
      readonly decisionId: string;
      readonly payloadDisposition: PayloadDisposition;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Consume a prepared write exactly once, from the exact sink instance the guard
 * bound it to. A cloned, forged, replayed, or misdirected write is refused.
 */
export function consumePreparedSinkWrite(
  write: unknown,
  sink: CaptureSinkClass,
  sinkBinding: object,
): ConsumeResult {
  if (!(write instanceof PreparedSinkWrite)) {
    return { ok: false, reason: "not-a-prepared-sink-write" };
  }
  const state = STATE.get(write);
  if (state === undefined) return { ok: false, reason: "prepared-write-was-cloned-or-forged" };
  if (state.consumed) return { ok: false, reason: "prepared-write-already-consumed" };
  if (state.sink !== sink) return { ok: false, reason: "prepared-write-is-bound-to-another-sink" };
  if (state.sinkBinding !== sinkBinding) {
    return { ok: false, reason: "prepared-write-is-bound-to-another-sink-instance" };
  }
  state.consumed = true;
  return {
    ok: true,
    bytes: state.bytes,
    record: state.record,
    payloadHash: state.payloadHash,
    capturePolicyHash: state.capturePolicyHash,
    decisionId: state.decisionId,
    payloadDisposition: state.payloadDisposition,
  };
}
