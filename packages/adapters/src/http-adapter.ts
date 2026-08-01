/**
 * The generic HTTP tool adapter.
 *
 * The transport is *injected*. There is no default, no fallback to
 * `globalThis.fetch` and no import of `node:http`, `node:https` or `node:net`
 * anywhere in this package, so a request plan can be constructed and asserted
 * with no network access at all.
 *
 * Every hop is authorized by `preflight` against the descriptor's network
 * profile: scheme, host and port allowlists (`P-014`..`P-016`), redirect
 * permission (`P-018`), redirect re-authorization (`P-017`) and the plaintext
 * downgrade refusal (`P-019`). Redirects are never followed by the transport —
 * the adapter follows them itself so that each hop is re-authorized.
 */

import {
  ok,
  isAborted,
  refused,
  runPreflight,
  type AdapterCallOptions,
  type AdapterOutcome,
  type AdapterResponse,
  type AdapterBaseOptions,
  type StreamingAdapter,
  type AdapterStream,
} from "./adapter.js";
import { CircuitBreaker } from "./circuit.js";
import { taxonomyFacts } from "./contract.js";
import { normalizedAdapterError } from "./envelope.js";
import { compareUnicodeCodePoints } from "./ordering.js";
import { composeUsage } from "./usage.js";
import type {
  AdapterCapability,
  AdapterDescriptor,
  AdapterErrorCode,
  AdapterRequest,
  AdapterUsage,
  EgressTarget,
  PreflightOutcome,
  ProviderMetricDeclaration,
  StreamFrame,
} from "./types.js";

export interface HttpRequestInit {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  /** Always manual: the adapter re-authorizes every redirect hop itself. */
  readonly redirect: "manual";
  readonly signal?: AbortSignal;
  /** Enforced by the injected transport; this package reads no clock. */
  readonly timeoutMs: number;
  readonly tlsMinimumVersion: "TLSv1.2" | "TLSv1.3";
}

export interface HttpResponseLike {
  readonly status: number;
  /** Case-insensitive single-value header lookup, as WHATWG `Headers` provides. */
  readonly headers: { get(name: string): string | null };
  readonly body?: string | null;
}

export type HttpFetch = (url: string, init: HttpRequestInit) => Promise<HttpResponseLike>;

export interface HttpRequestPlan {
  readonly target: EgressTarget;
  readonly url: string;
  readonly init: HttpRequestInit;
  readonly bodyBytes: number;
}

export interface HttpCallSpec {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | null;
}

/**
 * The status-to-taxonomy map. Retryability is never read from a status text or
 * a payload: the status selects a code, and the code carries retryability.
 *
 * An unmapped 4xx is `GE_ADAPTER_INVALID_REQUEST` (the provider rejected the
 * request, provably no work). An unmapped 5xx is `GE_ADAPTER_TRANSPORT_FAILURE`
 * because the request was delivered and the effect is in doubt — the
 * conservative direction.
 */
export const DEFAULT_HTTP_STATUS_CODES: Readonly<Record<number, AdapterErrorCode>> =
  Object.freeze({
    400: "GE_ADAPTER_INVALID_REQUEST",
    401: "GE_ADAPTER_AUTHENTICATION",
    402: "GE_ADAPTER_QUOTA_EXCEEDED",
    403: "GE_ADAPTER_AUTHENTICATION",
    408: "GE_ADAPTER_TIMEOUT",
    422: "GE_ADAPTER_INVALID_REQUEST",
    429: "GE_ADAPTER_RATE_LIMITED",
    503: "GE_ADAPTER_RATE_LIMITED",
    504: "GE_ADAPTER_TIMEOUT",
  });

export function classifyHttpStatus(
  status: number,
  overrides: Readonly<Record<number, AdapterErrorCode>> = {},
): AdapterErrorCode | null {
  if (status >= 200 && status < 300) return null;
  const mapped = overrides[status] ?? DEFAULT_HTTP_STATUS_CODES[status];
  if (mapped !== undefined) return mapped;
  if (status >= 500) return "GE_ADAPTER_TRANSPORT_FAILURE";
  return "GE_ADAPTER_INVALID_REQUEST";
}

/**
 * `Retry-After` in delta-seconds only. An HTTP-date form is deliberately
 * ignored: converting it needs a wall clock, and this contract has none.
 */
export function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) return null;
  if (!/^[0-9]{1,7}$/.test(value.trim())) return null;
  const ms = Number(value.trim()) * 1000;
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 3600000) return null;
  return ms;
}

export interface HttpAdapterOptions extends AdapterBaseOptions {
  /** Required. There is no default transport and no network fallback. */
  readonly fetch: HttpFetch;
  /**
   * Per-host credential headers. Credentials are host-isolated: a redirect to
   * another allowlisted host does not carry them, and they never appear in an
   * error message or a provider-safe detail field.
   */
  readonly credentials?: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly statusCodes?: Readonly<Record<number, AdapterErrorCode>>;
  /** Bounded redirect chain. Defaults to 3 hops. */
  readonly maxRedirects?: number;
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = Object.freeze({ http: 80, https: 443 });

function authority(target: EgressTarget): string {
  const standard = DEFAULT_PORTS[target.scheme];
  return standard === target.port ? target.host : `${target.host}:${String(target.port)}`;
}

function canonicalHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const entries = Object.entries(headers).map(
    ([name, value]) => [name.toLowerCase(), value] as const,
  );
  entries.sort((left, right) => compareUnicodeCodePoints(left[0], right[0]));
  return Object.fromEntries(entries);
}

export class HttpAdapter implements StreamingAdapter {
  readonly descriptor: AdapterDescriptor;
  readonly #fetch: HttpFetch;
  readonly #credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly #statusCodes: Readonly<Record<number, AdapterErrorCode>>;
  readonly #maxRedirects: number;
  readonly #policyMetrics: readonly ProviderMetricDeclaration[];
  readonly #forbiddenMarkers: readonly string[];
  readonly #breaker: CircuitBreaker;

  constructor(options: HttpAdapterOptions) {
    if (typeof options.fetch !== "function") {
      throw new Error("an HTTP adapter requires an injected fetch implementation");
    }
    this.descriptor = options.descriptor;
    this.#fetch = options.fetch;
    this.#credentials = options.credentials ?? {};
    this.#statusCodes = options.statusCodes ?? {};
    this.#maxRedirects = options.maxRedirects ?? 3;
    this.#policyMetrics = options.budgetPolicyAllowedProviderMetrics ?? [];
    this.#forbiddenMarkers = options.forbiddenMarkers ?? [];
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
    return runPreflight(this.descriptor, request, this.#policyMetrics, 1, this.#forbiddenMarkers);
  }

  /**
   * Build the exact bytes that would be sent, without sending them. This is a
   * pure function of the descriptor, the request and the call spec, which is
   * what makes the corpus assertable with no transport at all.
   */
  buildRequestPlan(
    request: AdapterRequest,
    spec: HttpCallSpec = {},
    signal?: AbortSignal,
  ): HttpRequestPlan {
    const target = request.target;
    if (target === null) {
      throw new Error("an HTTP call requires a request target");
    }
    const path = spec.path ?? "/";
    const headers = canonicalHeaders({
      ...(spec.headers ?? {}),
      // Credentials are attached per host and never merged across hosts.
      ...(this.#credentials[target.host] ?? {}),
    });
    const body = spec.body ?? null;
    return Object.freeze({
      target,
      url: `${target.scheme}://${authority(target)}${path}`,
      bodyBytes: body === null ? 0 : body.length,
      init: Object.freeze({
        method: spec.method ?? "GET",
        headers: Object.freeze(headers),
        body,
        redirect: "manual" as const,
        timeoutMs: this.descriptor.bounds.requestTimeoutMs,
        tlsMinimumVersion: this.descriptor.network?.tlsMinimumVersion ?? "TLSv1.3",
        ...(signal === undefined ? {} : { signal }),
      }),
    });
  }

  async call(
    request: AdapterRequest,
    options: AdapterCallOptions = {},
    spec: HttpCallSpec = {},
  ): Promise<AdapterOutcome<AdapterResponse>> {
    const attempt = options.attempt ?? 1;
    const admitted = this.preflight(request);
    if (!admitted.ok) return refused(admitted.error);

    // adapter-semantics 8.3: cancellation before dispatch normalizes to nothing.
    if (isAborted(options.signal)) throw options.signal?.reason;

    let current = request;
    let currentSpec = spec;
    let hops = 0;
    let transportBytes = 0;
    let providerCalls = 0;

    for (;;) {
      const plan = this.buildRequestPlan(current, currentSpec, options.signal);
      transportBytes += plan.bodyBytes;
      providerCalls += 1;

      let response: HttpResponseLike;
      try {
        response = await this.#fetch(plan.url, plan.init);
      } catch (error) {
        return refused(this.#transportFailure(request, attempt, error, options));
      }

      const bodyBytes = response.body === null || response.body === undefined
        ? 0
        : response.body.length;
      transportBytes += bodyBytes;

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        hops += 1;
        if (location === null || hops > this.#maxRedirects) {
          return refused(
            this.#dispatchFailure(request, attempt, "GE_ADAPTER_TRANSPORT_FAILURE",
              "the provider redirected without a usable location or beyond the hop bound",
              null, transportBytes, providerCalls),
          );
        }
        const redirected = this.#redirectTarget(plan.target, location);
        if (redirected === null) {
          return refused(
            this.#dispatchFailure(request, attempt, "GE_ADAPTER_INVALID_REQUEST",
              "the provider redirect location is not a target this adapter can authorize",
              null, transportBytes, providerCalls),
          );
        }
        current = { ...current, target: redirected.target };
        currentSpec = { ...currentSpec, path: redirected.path };
        // Every hop is re-authorized against the same allowlist as the original.
        const reauthorized = this.preflight(current);
        if (!reauthorized.ok) return refused(reauthorized.error);
        continue;
      }

      if (bodyBytes > this.descriptor.bounds.maxResponseBytes) {
        // adapter-semantics 6.1: a provider that exceeds the declared response
        // bound has already performed work, so this is a dispatch code, not
        // GE_ADAPTER_BOUNDS_EXCEEDED.
        return refused(
          this.#dispatchFailure(request, attempt, "GE_ADAPTER_MALFORMED_RESPONSE",
            "the provider response exceeds maxResponseBytes", null,
            transportBytes, providerCalls),
        );
      }

      const code = classifyHttpStatus(response.status, this.#statusCodes);
      if (code !== null) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        return refused(
          this.#dispatchFailure(request, attempt, code,
            `the provider returned HTTP ${String(response.status)}`, retryAfterMs,
            transportBytes, providerCalls),
        );
      }

      return ok(
        Object.freeze({
          requestId: request.requestId,
          providerRequestId: this.#providerRequestId(response),
          finishReason: "stop" as const,
          text: response.body ?? "",
          structuredOutput: null,
          toolCalls: Object.freeze([]),
          usage: this.#usage(request, transportBytes, providerCalls, this.#providerRequestId(response)),
          normalizedStream: null,
        }),
      );
    }
  }

  /**
   * The HTTP adapter is a request/response tool adapter. It declares
   * `streaming` for callers that need frame-shaped delivery, and delivers the
   * single completed response as one conforming frame sequence.
   */
  stream(request: AdapterRequest, options: AdapterCallOptions = {}): AdapterStream {
    const completion = this.call(request, options);
    const emit = async function* (): AsyncGenerator<StreamFrame, void, void> {
      const outcome = await completion;
      if (!outcome.ok) return;
      yield { sequence: 0, kind: "start", bytes: 16 };
      yield { sequence: 1, kind: "text-delta", bytes: outcome.value.text.length };
      yield { sequence: 2, kind: "finish", bytes: 8, finishReason: "stop" };
    };
    return Object.freeze({ frames: emit(), completion });
  }

  #providerRequestId(response: HttpResponseLike): string | null {
    if (!this.supports("provider-request-id")) return null;
    const value = response.headers.get("x-request-id");
    return value === null || value.length === 0 ? null : value.slice(0, 256);
  }

  /**
   * The next hop a `Location` header names. Only absolute http(s) targets and
   * root-relative paths are representable; anything else is refused rather than
   * guessed, because a guess would be an unauthorized egress decision.
   */
  #redirectTarget(
    from: EgressTarget,
    location: string,
  ): { readonly target: EgressTarget; readonly path: string } | null {
    const absolute = /^(https?):\/\/([a-z0-9.-]+)(?::([0-9]{1,5}))?(\/[^\s]*)?$/i.exec(location);
    if (absolute !== null) {
      const scheme = (absolute[1] as string).toLowerCase();
      const host = (absolute[2] as string).toLowerCase();
      const port =
        absolute[3] === undefined ? (DEFAULT_PORTS[scheme] as number) : Number(absolute[3]);
      return Object.freeze({
        target: Object.freeze({ scheme, host, port, redirected: true, reauthorized: true }),
        path: absolute[4] ?? "/",
      });
    }
    if (location.startsWith("/")) {
      return Object.freeze({
        target: Object.freeze({ ...from, redirected: true, reauthorized: true }),
        path: location,
      });
    }
    return null;
  }

  #usage(
    request: AdapterRequest,
    transportBytes: number,
    providerCalls: number,
    providerRequestId: string | null,
  ): AdapterUsage {
    return composeUsage({
      descriptor: this.descriptor,
      requestId: request.requestId,
      providerRequestId,
      // An adapter without usage-reporting reports unknown trust and no
      // usage-unit meter (`U-018`). `transport-bytes` is a byte meter, so it
      // remains reportable.
      trust: this.supports("usage-reporting") ? "adapter-conservative" : "unknown",
      finishReason: null,
      meters: {
        "provider-calls": providerCalls,
        "transport-bytes": transportBytes,
      },
    });
  }

  #dispatchFailure(
    request: AdapterRequest,
    attempt: number,
    code: AdapterErrorCode,
    message: string,
    retryAfterMs: number | null,
    transportBytes: number,
    providerCalls: number,
  ) {
    const facts = taxonomyFacts(code);
    const conservative = facts.effectDisposition !== "not-applied";
    return normalizedAdapterError({
      descriptor: this.descriptor,
      requestId: request.requestId,
      attempt,
      code,
      sideEffectClass: request.sideEffectClass,
      message,
      retryAfterMs:
        retryAfterMs !== null && facts.retryable && this.supports("retry-after-hint")
          ? retryAfterMs
          : null,
      usage: conservative ? this.#usage(request, transportBytes, providerCalls, null) : null,
      forbiddenMarkers: this.#forbiddenMarkers,
    });
  }

  #transportFailure(
    request: AdapterRequest,
    attempt: number,
    error: unknown,
    options: AdapterCallOptions,
  ) {
    const name = error instanceof Error ? error.name : "";
    // The transport enforces the timeout; this package reads no clock.
    const code: AdapterErrorCode =
      name === "TimeoutError"
        ? "GE_ADAPTER_TIMEOUT"
        : isAborted(options.signal)
          ? "GE_ADAPTER_CANCELLED"
          : "GE_ADAPTER_TRANSPORT_FAILURE";
    // The cause is deliberately not quoted: a transport error can carry a URL
    // with credentials in it.
    return normalizedAdapterError({
      descriptor: this.descriptor,
      requestId: request.requestId,
      attempt,
      code,
      sideEffectClass: request.sideEffectClass,
      message: `the injected transport failed before a trusted response arrived (${name || "error"})`,
      usage: this.#usage(request, request.requestBytes, 1, null),
      forbiddenMarkers: this.#forbiddenMarkers,
    });
  }
}

export function createHttpAdapter(options: HttpAdapterOptions): HttpAdapter {
  return new HttpAdapter(options);
}
