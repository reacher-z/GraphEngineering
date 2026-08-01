/**
 * The pieces composed: preflight, dispatch, retry and the circuit breaker,
 * driven by an injected clock, plus the bridge to a graph node executor.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AdapterDispatchError,
  CircuitBreaker,
  computedBackoffMs,
  createAdapterExecutor,
  createMockAdapter,
  retryDecision,
  type AdapterRequest,
} from "../src/index.js";
import { corpus, descriptorFor, requestFrom } from "./corpus.js";

const full = descriptorFor("mock-full");
const nonIdempotent = descriptorFor("mock-nonidempotent");
/** The active budget policy an adapter narrows and can never widen (`D-029`). */
const policy = corpus.budgetPolicyAllowedProviderMetrics;

describe("a retry loop reads an injected clock and never a wall clock", () => {
  it("retries a retryable dispatch failure on the integer schedule, then succeeds", async () => {
    const adapter = createMockAdapter({
      descriptor: full,
      budgetPolicyAllowedProviderMetrics: policy,
      script: [{ fail: "GE_ADAPTER_TIMEOUT" }, { fail: "GE_ADAPTER_TIMEOUT" }, { text: "done" }],
    });
    const breaker = new CircuitBreaker(full.circuitPolicy);
    const backoffs: number[] = [];
    let nowMs = 0;
    let attempt = 1;

    for (;;) {
      breaker.advance(nowMs);
      const request: AdapterRequest = requestFrom([
        { op: "replace", path: "/circuitState", value: breaker.state },
      ]);
      if (!breaker.admit()) break;
      const outcome = await adapter.call(request, { attempt, nowMs });
      if (outcome.ok) {
        breaker.recordSuccess();
        expect(outcome.value.text).toBe("done");
        break;
      }
      breaker.recordFailure(outcome.error.code, nowMs);
      const decision = retryDecision(
        full,
        outcome.error.code,
        request.sideEffectClass,
        attempt,
        outcome.error.retryAfterMs,
      );
      expect(decision.mayRetry).toBe(true);
      backoffs.push(decision.backoffMs as number);
      nowMs += decision.backoffMs as number;
      attempt += 1;
    }

    // 250, then 250 * 2000/1000 = 500, all integer arithmetic with no jitter.
    expect(backoffs).toEqual([
      computedBackoffMs(full.retryPolicy, 1),
      computedBackoffMs(full.retryPolicy, 2),
    ]);
    expect(backoffs).toEqual([250, 500]);
    expect(breaker.state).toBe("closed");
    expect(nowMs).toBe(750);
  });

  it("stops a non-idempotent call after its first ambiguous outcome", async () => {
    const adapter = createMockAdapter({
      descriptor: nonIdempotent,
      budgetPolicyAllowedProviderMetrics: policy,
      script: [{ fail: "GE_ADAPTER_TIMEOUT" }],
    });
    const request = requestFrom([
      { op: "replace", path: "/sideEffectClass", value: "non-idempotent" },
    ]);
    const outcome = await adapter.call(request);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.effectDisposition).toBe("in-doubt");
    const decision = retryDecision(
      nonIdempotent,
      outcome.error.code,
      "non-idempotent",
      1,
      null,
    );
    expect(decision).toEqual({ mayRetry: false, backoffMs: null, rule: "R-006" });
  });

  it("opens the circuit and then refuses with circuit-open before dispatch", async () => {
    const adapter = createMockAdapter({
      descriptor: full,
      budgetPolicyAllowedProviderMetrics: policy,
      script: [{ fail: "GE_ADAPTER_TRANSPORT_FAILURE" }],
    });
    const breaker = new CircuitBreaker(full.circuitPolicy);
    for (let step = 0; step < full.circuitPolicy.consecutiveFailureThreshold; step += 1) {
      expect(breaker.admit()).toBe(true);
      const outcome = await adapter.call(requestFrom(), { attempt: 1 });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      breaker.recordFailure(outcome.error.code, step * 10);
    }
    expect(breaker.state).toBe("open");

    const refusal = await adapter.call(
      requestFrom([{ op: "replace", path: "/circuitState", value: "open" }]),
    );
    expect(refusal.ok).toBe(false);
    if (refusal.ok) return;
    expect(refusal.error.code).toBe("GE_ADAPTER_POLICY_DENIED");
    expect(refusal.error.denialReason).toBe("circuit-open");

    // The window is read from the injected clock only.
    breaker.advance(20 + full.circuitPolicy.openDurationMs - 1);
    expect(breaker.state).toBe("open");
    breaker.advance(20 + full.circuitPolicy.openDurationMs);
    expect(breaker.state).toBe("half-open");
  });
});

describe("the node-executor bridge", () => {
  const executorFor = (script: Parameters<typeof createMockAdapter>[0]["script"]) =>
    createAdapterExecutor({
      adapter: createMockAdapter({
        descriptor: full,
        budgetPolicyAllowedProviderMetrics: policy,
        ...(script === undefined ? {} : { script }),
      }),
      request: (input) =>
        requestFrom([
          { op: "replace", path: "/requestBytes", value: JSON.stringify(input).length },
        ]),
    });

  it("returns the normalized text for a successful dispatch", async () => {
    const executor = executorFor([{ text: "bridged" }]);
    const output = await executor({
      input: { prompt: "x" },
      attempt: 1,
      signal: new AbortController().signal,
    });
    expect(output).toBe("bridged");
  });

  it("still matches the runtime's NodeExecutor shape", () => {
    // The bridge is structural by design: this package does not depend on the
    // runtime. That makes the compatibility claim a drift risk, so the claim is
    // checked against the runtime's own source rather than asserted.
    const runtimeTypes = readFileSync(
      new URL("../../runtime/src/types.ts", import.meta.url),
      "utf8",
    );
    expect(runtimeTypes).toContain(
      "export type NodeExecutor = (context: NodeExecutionContext) => unknown | Promise<unknown>;",
    );
    const context = runtimeTypes.slice(
      runtimeTypes.indexOf("export interface NodeExecutionContext"),
    );
    const body = context.slice(0, context.indexOf("}"));
    for (const member of ["input:", "attempt: number;", "signal: AbortSignal;"]) {
      expect(body).toContain(member);
    }
  });

  it("throws the normalized envelope so the scheduler records a node failure", async () => {
    const executor = executorFor([{ fail: "GE_ADAPTER_AUTHENTICATION" }]);
    await expect(
      executor({ input: {}, attempt: 1, signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(AdapterDispatchError);
    try {
      await executor({ input: {}, attempt: 1, signal: new AbortController().signal });
    } catch (error) {
      expect(error).toBeInstanceOf(AdapterDispatchError);
      const dispatch = error as AdapterDispatchError;
      expect(dispatch.envelope.code).toBe("GE_ADAPTER_AUTHENTICATION");
      expect(dispatch.envelope.retryable).toBe(false);
    }
  });
});
