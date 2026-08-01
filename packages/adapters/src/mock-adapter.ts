/**
 * The deterministic mock adapter.
 *
 * adapter-semantics 3: `mock` is the deterministic reference. It is implemented
 * first, it is the only adapter the candidate gate uses, and every other kind is
 * defined by the same boundary the mock already satisfies.
 *
 * It performs no network access, requires no credential, reads no clock and
 * spawns no process. Every observable it produces is a function of its
 * descriptor, its script and the request.
 */

import {
  envelopeFromContractError,
  ok,
  isAborted,
  refused,
  runPreflight,
  type AdapterBaseOptions,
  type AdapterCallOptions,
  type AdapterOutcome,
  type AdapterResponse,
  type AdapterStream,
  type StreamingAdapter,
} from "./adapter.js";
import { CircuitBreaker } from "./circuit.js";
import { taxonomyFacts } from "./contract.js";
import { normalizedAdapterError } from "./envelope.js";
import { normalizeStream } from "./stream.js";
import { validateToolCalls } from "./tools.js";
import { composeUsage } from "./usage.js";
import type {
  AdapterCapability,
  AdapterDescriptor,
  AdapterErrorCode,
  AdapterRequest,
  AdapterUsage,
  FinishReason,
  ModelToolCall,
  NormalizedStream,
  PreflightOutcome,
  ProviderMetricDeclaration,
  ProviderQuantity,
  ReportableResource,
  StreamFrame,
  UsageTrust,
} from "./types.js";

/** One scripted attempt. The script is consumed in order; the last entry repeats. */
export interface MockOutcome {
  /**
   * A scripted dispatch failure. Requires the `fault-injection` capability,
   * which `D-014` restricts to deterministic-mock evidence.
   */
  readonly fail?: AdapterErrorCode;
  /** Provider backoff hint. Requires a retryable code and `retry-after-hint`. */
  readonly retryAfterMs?: number;
  /** A scripted frame sequence, including deliberately malformed ones. */
  readonly frames?: readonly StreamFrame[];
  readonly text?: string;
  readonly structuredOutput?: unknown;
  readonly toolCalls?: readonly ModelToolCall[];
  readonly finishReason?: FinishReason;
  readonly trust?: UsageTrust;
  readonly meters?: Readonly<Partial<Record<ReportableResource, number>>>;
  readonly providerSpecific?: readonly ProviderQuantity[];
}

export interface MockAdapterOptions extends AdapterBaseOptions {
  readonly script?: readonly MockOutcome[];
  /** Deterministic provider request identity prefix. Defaults to `mock-req`. */
  readonly providerRequestIdPrefix?: string;
}

const DEFAULT_TEXT = "deterministic mock response";

function padded(value: number): string {
  return String(value).padStart(6, "0");
}

/**
 * The default frame plan for a response: exactly one `start`, the text deltas,
 * one frame per tool call, one `usage` frame when the adapter reports usage,
 * and exactly one `finish`.
 */
function planFrames(
  descriptor: AdapterDescriptor,
  text: string,
  toolCalls: readonly ModelToolCall[],
  finishReason: FinishReason,
): StreamFrame[] {
  const declared = new Set<string>(descriptor.capabilities);
  const frames: StreamFrame[] = [{ sequence: 0, kind: "start", bytes: 16 }];
  let sequence = 1;
  if (text.length > 0) {
    frames.push({ sequence, kind: "text-delta", bytes: text.length });
    sequence += 1;
  }
  for (const call of toolCalls) {
    frames.push({ sequence, kind: "tool-call", bytes: 48, toolCallId: call.id });
    sequence += 1;
  }
  if (declared.has("usage-reporting")) {
    frames.push({ sequence, kind: "usage", bytes: 32 });
    sequence += 1;
  }
  frames.push({ sequence, kind: "finish", bytes: 8, finishReason });
  return frames;
}

/**
 * Default meters. Every meter is gated on the capability `U-009`..`U-012`
 * require, so an adapter can never report a meter its descriptor does not
 * authorize.
 */
function planMeters(
  descriptor: AdapterDescriptor,
  request: AdapterRequest,
  toolCalls: readonly ModelToolCall[],
  text: string,
): Partial<Record<ReportableResource, number>> {
  const declared = new Set<string>(descriptor.capabilities);
  const meters: Partial<Record<ReportableResource, number>> = {
    "provider-calls": 1,
    "transport-bytes": request.requestBytes + text.length,
  };
  if (declared.has("usage-reporting")) {
    meters["input-units"] = Math.max(1, Math.floor(request.requestBytes / 4));
    meters["output-units"] = Math.max(1, text.length);
    if (declared.has("cached-input-usage-reporting")) meters["cached-input-units"] = 1;
    if (declared.has("reasoning-usage-reporting")) meters["reasoning-units"] = 1;
    if (declared.has("attachments") && request.attachments.length > 0) {
      meters["image-units"] = request.attachments.length;
    }
  }
  if (declared.has("tool-calling") && toolCalls.length > 0) {
    meters["tool-calls"] = toolCalls.length;
  }
  return meters;
}

export class MockAdapter implements StreamingAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly #script: readonly MockOutcome[];
  readonly #policyMetrics: readonly ProviderMetricDeclaration[];
  readonly #forbiddenMarkers: readonly string[];
  readonly #prefix: string;
  readonly #breaker: CircuitBreaker;
  #providerRequestCounter = 0;

  constructor(options: MockAdapterOptions) {
    this.descriptor = options.descriptor;
    this.#script = options.script ?? [];
    this.#policyMetrics = options.budgetPolicyAllowedProviderMetrics ?? [];
    this.#forbiddenMarkers = options.forbiddenMarkers ?? [];
    this.#prefix = options.providerRequestIdPrefix ?? "mock-req";
    this.#breaker = new CircuitBreaker(options.descriptor.circuitPolicy);
  }

  capabilities(): readonly AdapterCapability[] {
    return this.descriptor.capabilities;
  }

  supports(capability: AdapterCapability): boolean {
    return this.descriptor.capabilities.includes(capability);
  }

  get circuit(): CircuitBreaker {
    return this.#breaker;
  }

  preflight(request: AdapterRequest): AdapterOutcome<PreflightOutcome> {
    return runPreflight(
      this.descriptor,
      request,
      this.#policyMetrics,
      1,
      this.#forbiddenMarkers,
    );
  }

  #outcomeFor(attempt: number): MockOutcome {
    if (this.#script.length === 0) return {};
    const index = Math.min(attempt - 1, this.#script.length - 1);
    return this.#script[index] as MockOutcome;
  }

  #nextProviderRequestId(): string | null {
    this.#providerRequestCounter += 1;
    if (!this.supports("provider-request-id")) return null;
    return `${this.#prefix}-${padded(this.#providerRequestCounter)}`;
  }

  async call(
    request: AdapterRequest,
    options: AdapterCallOptions = {},
  ): Promise<AdapterOutcome<AdapterResponse>> {
    const attempt = options.attempt ?? 1;
    const admitted = this.preflight(request);
    if (!admitted.ok) return refused(admitted.error);

    // adapter-semantics 8.3: a cancellation that arrives before dispatch
    // produces no adapter error at all — nothing was sent, so there is nothing
    // to normalize. The caller's reason propagates unchanged.
    if (isAborted(options.signal)) throw options.signal?.reason;

    const plan = this.#outcomeFor(attempt);
    const providerRequestId = this.#nextProviderRequestId();

    // The dispatch boundary. The mock crosses it on a microtask rather than on
    // a timer, so the crossing is observable without reading a clock.
    await Promise.resolve();

    try {
      // A cancellation from here on is GE_ADAPTER_CANCELLED with an in-doubt
      // external effect: the deterministic mock is the reference for what a
      // provider that may already have done the work looks like.
      if (isAborted(options.signal)) {
        return refused(
          normalizedAdapterError({
            descriptor: this.descriptor,
            requestId: request.requestId,
            attempt,
            code: "GE_ADAPTER_CANCELLED",
            sideEffectClass: request.sideEffectClass,
            message: "the caller cancelled a mock call that had already been dispatched",
            providerRequestId,
            usage: this.#conservativeUsage(request, providerRequestId),
            forbiddenMarkers: this.#forbiddenMarkers,
          }),
        );
      }

      if (plan.fail !== undefined) {
        return refused(this.#injectedFailure(request, attempt, providerRequestId, plan));
      }

      const response = this.#normalize(request, plan, providerRequestId, options);
      return ok(response);
    } catch (error) {
      return refused(
        envelopeFromContractError(error, {
          descriptor: this.descriptor,
          requestId: request.requestId,
          attempt,
          sideEffectClass: request.sideEffectClass,
          forbiddenMarkers: this.#forbiddenMarkers,
        }),
      );
    }
  }

  stream(request: AdapterRequest, options: AdapterCallOptions = {}): AdapterStream {
    const completion = this.call(request, options);
    const emit = async function* (
      this: MockAdapter,
    ): AsyncGenerator<StreamFrame, void, void> {
      const outcome = await completion;
      if (!outcome.ok) return;
      for (const frame of this.#framesFor(options)) yield frame;
    }.bind(this);
    return Object.freeze({ frames: emit(), completion });
  }

  #framesFor(options: AdapterCallOptions): readonly StreamFrame[] {
    const plan = this.#outcomeFor(options.attempt ?? 1);
    const toolCalls = plan.toolCalls ?? [];
    return (
      plan.frames ??
      planFrames(
        this.descriptor,
        plan.text ?? DEFAULT_TEXT,
        toolCalls,
        plan.finishReason ?? (toolCalls.length > 0 ? "tool-calls" : "stop"),
      )
    );
  }

  #injectedFailure(
    request: AdapterRequest,
    attempt: number,
    providerRequestId: string | null,
    plan: MockOutcome,
  ) {
    const code = plan.fail as AdapterErrorCode;
    if (!this.supports("fault-injection")) {
      throw new Error(
        `adapter '${this.descriptor.adapterId}' cannot inject '${code}' without the fault-injection capability`,
      );
    }
    const facts = taxonomyFacts(code);
    const conservative = facts.effectDisposition !== "not-applied";
    return normalizedAdapterError({
      descriptor: this.descriptor,
      requestId: request.requestId,
      attempt,
      code,
      sideEffectClass: request.sideEffectClass,
      message: `the deterministic mock produced ${code} by configuration`,
      providerRequestId: facts.boundary === "dispatch" ? providerRequestId : null,
      retryAfterMs:
        plan.retryAfterMs !== undefined && facts.retryable && this.supports("retry-after-hint")
          ? plan.retryAfterMs
          : null,
      usage: conservative ? this.#conservativeUsage(request, providerRequestId) : null,
      forbiddenMarkers: this.#forbiddenMarkers,
    });
  }

  /**
   * adapter-semantics 7.3 and 8.1: where the adapter cannot assert zero
   * external usage it substitutes a sound worst case, which maps onto the
   * `estimated` public cost state.
   */
  #conservativeUsage(request: AdapterRequest, providerRequestId: string | null): AdapterUsage {
    return composeUsage({
      descriptor: this.descriptor,
      requestId: request.requestId,
      providerRequestId,
      trust: this.supports("usage-reporting") ? "adapter-conservative" : "unknown",
      finishReason: null,
      meters: {
        "provider-calls": 1,
        "transport-bytes": request.requestBytes,
      },
    });
  }

  #normalize(
    request: AdapterRequest,
    plan: MockOutcome,
    providerRequestId: string | null,
    options: AdapterCallOptions,
  ): AdapterResponse {
    const text = plan.text ?? DEFAULT_TEXT;
    const toolCalls = plan.toolCalls ?? [];
    const finishReason: FinishReason =
      plan.finishReason ?? (toolCalls.length > 0 ? "tool-calls" : "stop");
    const frames = plan.frames ?? planFrames(this.descriptor, text, toolCalls, finishReason);

    let normalizedStream: NormalizedStream | null = null;
    if (request.streaming || plan.frames !== undefined) {
      normalizedStream = normalizeStream(this.descriptor, frames);
    }

    if (toolCalls.length > 0) {
      validateToolCalls(this.descriptor, request, {
        toolCalls,
        authorizedTools:
          options.authorizedTools ?? request.toolDefinitions.map((definition) => definition.name),
      });
    }

    const usage = composeUsage({
      descriptor: this.descriptor,
      requestId: request.requestId,
      providerRequestId,
      trust: plan.trust ?? (this.supports("usage-reporting") ? "provider-reported" : "unknown"),
      finishReason,
      meters: plan.meters ?? planMeters(this.descriptor, request, toolCalls, text),
      ...(plan.providerSpecific === undefined
        ? {}
        : { providerSpecific: plan.providerSpecific }),
    });

    return Object.freeze({
      requestId: request.requestId,
      providerRequestId,
      finishReason,
      text,
      structuredOutput: request.structuredOutput ? (plan.structuredOutput ?? null) : null,
      toolCalls: Object.freeze([...toolCalls]),
      usage,
      normalizedStream,
    });
  }
}

export function createMockAdapter(options: MockAdapterOptions): MockAdapter {
  return new MockAdapter(options);
}
