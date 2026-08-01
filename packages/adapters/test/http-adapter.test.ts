/**
 * The generic HTTP tool adapter, driven entirely by an injected fake.
 *
 * No test in this file opens a socket, resolves a name or touches
 * `globalThis.fetch`. Every host it names is an RFC 2606 `.invalid` name taken
 * from the corpus descriptor, which could not resolve even if something tried.
 */

import { describe, expect, it, vi } from "vitest";

import {
  createHttpAdapter,
  classifyHttpStatus,
  parseRetryAfterMs,
  validateUsage,
  type AdapterRequest,
  type HttpFetch,
  type HttpRequestInit,
  type HttpResponseLike,
} from "../src/index.js";
import { corpus, descriptorFor, requestFrom } from "./corpus.js";

const descriptor = descriptorFor("http-mock");
const policyMetrics = corpus.budgetPolicyAllowedProviderMetrics;

function headers(entries: Readonly<Record<string, string>> = {}): HttpResponseLike["headers"] {
  const lower = new Map(
    Object.entries(entries).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null };
}

function response(
  status: number,
  init: { body?: string | null; headers?: Readonly<Record<string, string>> } = {},
): HttpResponseLike {
  return {
    status,
    headers: headers(init.headers ?? {}),
    body: init.body ?? null,
  };
}

/** A transport that records every call and never performs I/O. */
function fakeFetch(
  responses: readonly HttpResponseLike[],
): { fetch: HttpFetch; calls: { url: string; init: HttpRequestInit }[] } {
  const calls: { url: string; init: HttpRequestInit }[] = [];
  let index = 0;
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) throw new Error("the fake transport ran out of responses");
    return next;
  };
  return { fetch, calls };
}

function target(
  overrides: Partial<{ scheme: string; host: string; port: number; redirected: boolean; reauthorized: boolean }> = {},
): AdapterRequest {
  return requestFrom([
    {
      op: "replace",
      path: "/target",
      value: {
        scheme: "https",
        host: "gateway.invalid",
        port: 443,
        redirected: false,
        reauthorized: false,
        ...overrides,
      },
    },
  ]);
}

function adapter(options: Partial<Parameters<typeof createHttpAdapter>[0]> = {}) {
  const { fetch } = fakeFetch([response(200, { body: "ok" })]);
  return createHttpAdapter({
    descriptor,
    fetch,
    budgetPolicyAllowedProviderMetrics: policyMetrics,
    forbiddenMarkers: corpus.forbiddenMarkers,
    ...options,
  });
}

describe("the transport is injected and required", () => {
  it("refuses to construct without one", () => {
    expect(() =>
      createHttpAdapter({ descriptor, fetch: undefined as unknown as HttpFetch }),
    ).toThrow(/injected fetch/);
  });

  it("never reads globalThis.fetch", async () => {
    const globals = globalThis as { fetch?: unknown };
    const original = globals.fetch;
    const trap = vi.fn(() => {
      throw new Error("the adapter reached the global transport");
    });
    globals.fetch = trap;
    try {
      const client = fakeFetch([response(200, { body: "ok" })]);
      const http = createHttpAdapter({ descriptor, fetch: client.fetch });
      const outcome = await http.call(target());
      expect(outcome.ok).toBe(true);
      expect(trap).not.toHaveBeenCalled();
      expect(client.calls).toHaveLength(1);
    } finally {
      if (original === undefined) delete globals.fetch;
      else globals.fetch = original;
    }
  });
});

describe("request construction is a pure function", () => {
  it("builds the exact bytes without sending them", () => {
    const http = adapter();
    const plan = http.buildRequestPlan(target(), {
      method: "POST",
      path: "/v1/tool",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: '{"a":1}',
    });
    expect(plan.url).toBe("https://gateway.invalid/v1/tool");
    expect(plan.init.method).toBe("POST");
    expect(plan.init.redirect).toBe("manual");
    expect(plan.init.tlsMinimumVersion).toBe(descriptor.network?.tlsMinimumVersion);
    expect(plan.init.timeoutMs).toBe(descriptor.bounds.requestTimeoutMs);
    // Header names are lowercased and canonically ordered.
    expect(Object.keys(plan.init.headers)).toEqual(["accept", "content-type"]);
    expect(plan.bodyBytes).toBe(7);
  });

  it("keeps a non-standard port in the authority", () => {
    const plan = adapter().buildRequestPlan(target({ port: 8443 }), { path: "/x" });
    expect(plan.url).toBe("https://gateway.invalid:8443/x");
  });

  it("isolates credentials per host", () => {
    const http = adapter({
      credentials: { "gateway.invalid": { authorization: "opaque-host-credential" } },
    });
    const authorized = http.buildRequestPlan(target());
    expect(authorized.init.headers["authorization"]).toBe("opaque-host-credential");
    const other = http.buildRequestPlan(target({ host: "stream.invalid" }));
    expect(other.init.headers["authorization"]).toBeUndefined();
  });
});

describe("egress is allowlisted before dispatch", () => {
  it.each([
    ["scheme", { scheme: "ftp" }, "P-014"],
    ["host", { host: "other.invalid" }, "P-015"],
    ["port", { port: 9999 }, "P-016"],
  ])("refuses an unlisted %s before any transport call", async (_label, overrides, rule) => {
    const client = fakeFetch([response(200)]);
    const http = createHttpAdapter({ descriptor, fetch: client.fetch });
    const outcome = await http.call(target(overrides));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("GE_ADAPTER_POLICY_DENIED");
    expect(outcome.error.denialReason).toBe("egress-not-allowlisted");
    expect(
      outcome.error.detail.providerSafeFields.find((field) => field.name === "rule")?.value,
    ).toBe(rule);
    expect(client.calls).toHaveLength(0);
  });

  it("refuses a redirect that downgrades the transport to plaintext", async () => {
    const outcome = await adapter().call(
      target({ scheme: "http", redirected: true, reauthorized: true }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.denialReason).toBe("tls-policy");
  });
});

describe("redirects are followed by the adapter, never by the transport", () => {
  it("re-authorizes every hop against the same allowlist", async () => {
    const client = fakeFetch([
      response(302, { headers: { location: "https://stream.invalid/next" } }),
      response(200, { body: "final" }),
    ]);
    const http = createHttpAdapter({ descriptor, fetch: client.fetch });
    const outcome = await http.call(target());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(client.calls.map((call) => call.url)).toEqual([
      "https://gateway.invalid/",
      "https://stream.invalid/next",
    ]);
    for (const call of client.calls) expect(call.init.redirect).toBe("manual");
    expect(outcome.value.text).toBe("final");
  });

  it("refuses a redirect to a host outside the allowlist", async () => {
    const client = fakeFetch([
      response(302, { headers: { location: "https://elsewhere.invalid/next" } }),
    ]);
    const http = createHttpAdapter({ descriptor, fetch: client.fetch });
    const outcome = await http.call(target());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("GE_ADAPTER_POLICY_DENIED");
    expect(outcome.error.denialReason).toBe("egress-not-allowlisted");
    expect(client.calls).toHaveLength(1);
  });

  it("refuses a redirect that downgrades to plaintext mid-chain", async () => {
    const client = fakeFetch([
      response(302, { headers: { location: "http://gateway.invalid:443/next" } }),
    ]);
    const http = createHttpAdapter({ descriptor, fetch: client.fetch });
    const outcome = await http.call(target());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.denialReason).toBe("tls-policy");
  });

  it("refuses redirects entirely when the descriptor does not allow them", async () => {
    const client = fakeFetch([
      response(302, { headers: { location: "https://stream.invalid/next" } }),
    ]);
    const http = createHttpAdapter({
      descriptor: descriptorFor("http-mock", [
        { op: "replace", path: "/network/allowRedirects", value: false },
      ]),
      fetch: client.fetch,
    });
    const outcome = await http.call(target());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(
      outcome.error.detail.providerSafeFields.find((field) => field.name === "rule")?.value,
    ).toBe("P-018");
  });
});

describe("status normalization never reads a message string", () => {
  const rows = [
    [401, "GE_ADAPTER_AUTHENTICATION"],
    [402, "GE_ADAPTER_QUOTA_EXCEEDED"],
    [422, "GE_ADAPTER_INVALID_REQUEST"],
    [429, "GE_ADAPTER_RATE_LIMITED"],
    [500, "GE_ADAPTER_TRANSPORT_FAILURE"],
    [504, "GE_ADAPTER_TIMEOUT"],
  ] as const;

  it.each(rows)("maps HTTP %i to %s with the taxonomy's own dispositions", async (status, code) => {
    const client = fakeFetch([response(status, { body: "provider text is not load-bearing" })]);
    const http = createHttpAdapter({ descriptor, fetch: client.fetch });
    const outcome = await http.call(target());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const row = corpus.errorTaxonomy.find((entry) => entry.code === code);
    expect(outcome.error.code).toBe(code);
    expect(outcome.error.retryable).toBe(row?.retryable);
    expect(outcome.error.effectDisposition).toBe(row?.effectDisposition);
    expect(outcome.error.usageDisposition).toBe(row?.usageDisposition);
  });

  it("classifies unmapped statuses conservatively", () => {
    expect(classifyHttpStatus(200)).toBeNull();
    expect(classifyHttpStatus(204)).toBeNull();
    expect(classifyHttpStatus(418)).toBe("GE_ADAPTER_INVALID_REQUEST");
    expect(classifyHttpStatus(599)).toBe("GE_ADAPTER_TRANSPORT_FAILURE");
  });

  it("reads Retry-After as delta-seconds only, because there is no clock", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT")).toBeNull();
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("99999999")).toBeNull();
  });

  it("attaches a provider backoff hint on a rate limit", async () => {
    const client = fakeFetch([response(429, { headers: { "retry-after": "3" } })]);
    const http = createHttpAdapter({ descriptor, fetch: client.fetch });
    const outcome = await http.call(target());
    expect(outcome.ok === false && outcome.error.retryAfterMs).toBe(3000);
  });

  it("treats a thrown transport as in-doubt, not as failed", async () => {
    const fetch: HttpFetch = async () => {
      throw new Error("connection reset");
    };
    const http = createHttpAdapter({ descriptor, fetch });
    const outcome = await http.call(target());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("GE_ADAPTER_TRANSPORT_FAILURE");
    expect(outcome.error.effectDisposition).toBe("in-doubt");
    expect(outcome.error.usageDisposition).toBe("conservative");
    expect(outcome.error.usage).not.toBeNull();
  });

  it("maps an injected TimeoutError to GE_ADAPTER_TIMEOUT", async () => {
    const fetch: HttpFetch = async () => {
      const error = new Error("deadline");
      error.name = "TimeoutError";
      throw error;
    };
    const http = createHttpAdapter({ descriptor, fetch });
    const outcome = await http.call(target());
    expect(outcome.ok === false && outcome.error.code).toBe("GE_ADAPTER_TIMEOUT");
  });

  it("treats an oversized response as a dispatch code, not a bounds refusal", async () => {
    const client = fakeFetch([response(200, { body: "x".repeat(64) })]);
    const http = createHttpAdapter({
      descriptor: descriptorFor("http-mock", [
        { op: "replace", path: "/bounds/maxResponseBytes", value: 32 },
        { op: "replace", path: "/bounds/maxStreamFrameBytes", value: 32 },
      ]),
      fetch: client.fetch,
    });
    const outcome = await http.call(target());
    expect(outcome.ok === false && outcome.error.code).toBe("GE_ADAPTER_MALFORMED_RESPONSE");
  });
});

describe("usage", () => {
  it("reports meters only, with unknown trust because it declares no usage-reporting", async () => {
    const client = fakeFetch([response(200, { body: "12345" })]);
    const http = createHttpAdapter({ descriptor, fetch: client.fetch });
    const outcome = await http.call(target(), {}, { body: "ab" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.usage.trust).toBe("unknown");
    expect(outcome.value.usage.budgetCostState).toBe("unknown");
    expect(outcome.value.usage.quantities.map((quantity) => quantity.resource)).toEqual([
      "provider-calls",
      "transport-bytes",
    ]);
    expect(validateUsage(descriptor, outcome.value.usage).providerCalls).toBe(1);
  });
});

describe("cancellation", () => {
  it("produces no adapter error before dispatch", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    await expect(adapter().call(target(), { signal: controller.signal })).rejects.toBe(reason);
  });
});
