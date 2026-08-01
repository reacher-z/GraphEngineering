/**
 * The portable adapter boundary.
 *
 * adapter-semantics 2: a conforming adapter has four ordered layers —
 * declaration, preflight, dispatch, normalization. Every adapter in this
 * package shares the declaration, preflight and normalization layers verbatim;
 * only the dispatch layer differs, and one of the three refuses to have one.
 */

import { escalatesSideEffect } from "./contract.js";
import { normalizedAdapterError } from "./envelope.js";
import { AdapterContractError, isAdapterContractError } from "./errors.js";
import { preflight } from "./preflight.js";
import type {
  AdapterCapability,
  AdapterDescriptor,
  AdapterErrorEnvelope,
  AdapterRequest,
  AdapterUsage,
  FinishReason,
  ModelToolCall,
  NormalizedStream,
  PreflightOutcome,
  ProviderMetricDeclaration,
  StreamFrame,
} from "./types.js";

export type AdapterOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AdapterErrorEnvelope };

export function ok<T>(value: T): AdapterOutcome<T> {
  return Object.freeze({ ok: true as const, value });
}

export function refused<T>(error: AdapterErrorEnvelope): AdapterOutcome<T> {
  return Object.freeze({ ok: false as const, error });
}

/**
 * Cancellation state, read as a value rather than a narrowed property so that
 * the pre-dispatch and post-dispatch checks stay independent observations.
 */
export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

export interface AdapterResponse {
  readonly requestId: string;
  readonly providerRequestId: string | null;
  readonly finishReason: FinishReason;
  readonly text: string;
  /** Present only when the request asked for structured output. */
  readonly structuredOutput: unknown;
  readonly toolCalls: readonly ModelToolCall[];
  readonly usage: AdapterUsage;
  readonly normalizedStream: NormalizedStream | null;
}

export interface AdapterStream {
  readonly frames: AsyncIterable<StreamFrame>;
  readonly completion: Promise<AdapterOutcome<AdapterResponse>>;
}

export interface AdapterCallOptions {
  /** One-based dispatch attempt index. Defaults to 1. */
  readonly attempt?: number;
  /** Caller cancellation. Cancellation is a caller fact, never a provider one. */
  readonly signal?: AbortSignal;
  /** Injected clock reading for the circuit breaker. There is no wall clock. */
  readonly nowMs?: number;
  /**
   * Tools policy authorizes for this call (`T-005`). Authority comes from
   * policy and never from the model; defaults to the declared tool names.
   */
  readonly authorizedTools?: readonly string[];
}

export interface Adapter {
  readonly descriptor: AdapterDescriptor;
  /** adapter-semantics 4: capability discovery is a pre-dispatch declaration. */
  capabilities(): readonly AdapterCapability[];
  supports(capability: AdapterCapability): boolean;
  preflight(request: AdapterRequest): AdapterOutcome<PreflightOutcome>;
  call(request: AdapterRequest, options?: AdapterCallOptions): Promise<AdapterOutcome<AdapterResponse>>;
}

export interface StreamingAdapter extends Adapter {
  stream(request: AdapterRequest, options?: AdapterCallOptions): AdapterStream;
}

export interface AdapterBaseOptions {
  readonly descriptor: AdapterDescriptor;
  /**
   * The active budget policy allowlist. An adapter narrows it and can never
   * widen it (`D-029`).
   */
  readonly budgetPolicyAllowedProviderMetrics?: readonly ProviderMetricDeclaration[];
  /**
   * Markers that must never appear in an error message or a provider-safe
   * detail field (`E-014`). Supplied by the caller because what counts as a
   * credential is deployment knowledge, not adapter knowledge.
   */
  readonly forbiddenMarkers?: readonly string[];
}

/**
 * Convert a thrown contract rejection into a normalized envelope. Anything that
 * is not an `AdapterContractError` is a defect in this package and is
 * rethrown: a bug must never be laundered into a portable adapter code.
 */
export function envelopeFromContractError(
  error: unknown,
  context: {
    readonly descriptor: AdapterDescriptor;
    readonly requestId: string;
    readonly attempt: number;
    readonly sideEffectClass: AdapterRequest["sideEffectClass"];
    readonly forbiddenMarkers?: readonly string[];
  },
): AdapterErrorEnvelope {
  if (!isAdapterContractError(error)) throw error;
  const contractError: AdapterContractError = error;
  return normalizedAdapterError({
    descriptor: context.descriptor,
    requestId: context.requestId,
    attempt: context.attempt,
    code: contractError.code,
    sideEffectClass: context.sideEffectClass,
    message: contractError.message,
    denialReason: contractError.denialReason,
    rule: contractError.rule,
    ...(context.forbiddenMarkers === undefined
      ? {}
      : { forbiddenMarkers: context.forbiddenMarkers }),
  });
}

/**
 * Run the shared preflight layer and normalize any refusal. A refused call has
 * performed zero provider requests, zero usage and zero ledger writes.
 */
export function runPreflight(
  descriptor: AdapterDescriptor,
  request: AdapterRequest,
  policyMetrics: readonly ProviderMetricDeclaration[],
  attempt: number,
  forbiddenMarkers?: readonly string[],
): AdapterOutcome<PreflightOutcome> {
  try {
    return ok(preflight(descriptor, request, policyMetrics));
  } catch (error) {
    return refused(
      envelopeFromContractError(error, {
        descriptor,
        requestId: request.requestId,
        attempt,
        // An error can never escalate the side-effect class the descriptor
        // authorizes (`E-013`), so a refused escalation reports the authorized
        // class rather than the class the request asked for.
        sideEffectClass: narrowSideEffect(request.sideEffectClass, descriptor.sideEffectClass),
        ...(forbiddenMarkers === undefined ? {} : { forbiddenMarkers }),
      }),
    );
  }
}

function narrowSideEffect(
  requested: AdapterRequest["sideEffectClass"],
  authorized: AdapterDescriptor["sideEffectClass"],
): AdapterRequest["sideEffectClass"] {
  return escalatesSideEffect(requested, authorized) ? authorized : requested;
}
