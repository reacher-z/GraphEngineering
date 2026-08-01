/**
 * The deterministic mock adapter.
 *
 * Every descriptor and request here is built from the shipped corpus, and every
 * expectation about a code, a boundary, a disposition or a ledger action is
 * read from the corpus taxonomy rather than restated.
 */

import { describe, expect, it } from "vitest";

import {
  ADAPTER_ERROR_CODES,
  createMockAdapter,
  deriveLedgerAction,
  validateErrorEnvelope,
  validateUsage,
  type AdapterErrorCode,
  type AdapterRequest,
  type StreamFrame,
} from "../src/index.js";
import { corpus, descriptorFor, requestFrom } from "./corpus.js";

const policyMetrics = corpus.budgetPolicyAllowedProviderMetrics;
const full = descriptorFor("mock-full");
const minimal = descriptorFor("mock-minimal");
const nonIdempotent = descriptorFor("mock-nonidempotent");

function adapter(descriptorId: string, script?: Parameters<typeof createMockAdapter>[0]["script"]) {
  return createMockAdapter({
    descriptor: descriptorFor(descriptorId),
    budgetPolicyAllowedProviderMetrics: policyMetrics,
    forbiddenMarkers: corpus.forbiddenMarkers,
    ...(script === undefined ? {} : { script }),
  });
}

const taxonomy = new Map(corpus.errorTaxonomy.map((row) => [row.code, row]));

describe("capability discovery is pre-dispatch", () => {
  it("declares exactly the descriptor's capabilities", () => {
    const mock = adapter("mock-full");
    expect(mock.capabilities()).toEqual(full.capabilities);
    expect(mock.supports("streaming")).toBe(true);
    expect(createMockAdapter({ descriptor: minimal }).supports("streaming")).toBe(false);
  });

  it("refuses an undeclared capability before any dispatch, with the pinned message", async () => {
    const mock = createMockAdapter({ descriptor: minimal });
    const request = requestFrom([{ op: "replace", path: "/streaming", value: true }]);
    const outcome = await mock.call(request);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("GE_ADAPTER_CAPABILITY_UNSUPPORTED");
    expect(outcome.error.boundary).toBe("pre-dispatch");
    expect(outcome.error.effectDisposition).toBe("not-applied");
    expect(outcome.error.usageDisposition).toBe("none");
    // A pre-dispatch refusal performs zero usage and zero provider requests.
    expect(outcome.error.usage).toBeNull();
    expect(outcome.error.providerRequestId).toBeNull();
    expect(outcome.error.message).toBe(
      "Adapter capability 'streaming' required by request 'req-baseline' is not declared by adapter 'mock-minimal'",
    );
    expect(
      outcome.error.detail.providerSafeFields.find((field) => field.name === "rule")?.value,
    ).toBe("P-002");
  });
});

describe("a successful call", () => {
  it("normalizes text, usage and a deterministic provider request identity", async () => {
    const mock = adapter("mock-full");
    const outcome = await mock.call(requestFrom());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.providerRequestId).toBe("mock-req-000001");
    expect(outcome.value.finishReason).toBe("stop");
    expect(validateUsage(full, outcome.value.usage)).toEqual({
      resources: outcome.value.usage.quantities.length,
      providerCalls: 1,
      budgetCostState: "provider-reported",
    });
  });

  it("reports meters and never money", async () => {
    const outcome = await adapter("mock-full").call(requestFrom());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const usage = outcome.value.usage as unknown as Record<string, unknown>;
    expect(usage["currency"]).toBeUndefined();
    expect(usage["minorUnitExponent"]).toBeUndefined();
    for (const quantity of outcome.value.usage.quantities) {
      expect(corpus.reportableResourceInventory).toContain(quantity.resource);
      expect(quantity.aggregation).toBe("sum");
      expect(quantity.amount).toBeGreaterThan(0);
    }
  });

  it("produces structured output only when the request asked for it", async () => {
    const mock = adapter("mock-full", [{ structuredOutput: { answer: 42 } }]);
    const plain = await mock.call(requestFrom());
    expect(plain.ok && plain.value.structuredOutput).toBeNull();
    const structured = await mock.call(
      requestFrom([{ op: "replace", path: "/structuredOutput", value: true }]),
    );
    expect(structured.ok && structured.value.structuredOutput).toEqual({ answer: 42 });
  });

  it("is deterministic: the same script and request produce the same observables", async () => {
    const first = adapter("mock-full", [{ text: "abc" }]);
    const second = adapter("mock-full", [{ text: "abc" }]);
    const a = await first.call(requestFrom());
    const b = await second.call(requestFrom());
    expect(a).toEqual(b);
  });
});

describe("streaming", () => {
  it("emits a conforming frame sequence that normalizes without error", async () => {
    const mock = adapter("mock-full", [
      { text: "hello", toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "hi" } }] },
    ]);
    const request = requestFrom([
      { op: "replace", path: "/streaming", value: true },
      {
        op: "replace",
        path: "/toolDefinitions",
        value: [{ name: "echo", requiredArguments: ["text"], allowedArguments: ["text"] }],
      },
    ]);
    const stream = mock.stream(request);
    const frames: StreamFrame[] = [];
    for await (const frame of stream.frames) frames.push(frame);
    const outcome = await stream.completion;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(frames.map((frame) => frame.kind)).toEqual([
      "start",
      "text-delta",
      "tool-call",
      "usage",
      "finish",
    ]);
    expect(frames.map((frame) => frame.sequence)).toEqual([0, 1, 2, 3, 4]);
    expect(outcome.value.normalizedStream).toEqual({
      frames: 5,
      textBytes: 5,
      toolCalls: 1,
      usageFrames: 1,
      finishReason: "tool-calls",
    });
  });

  it("turns a provider disconnect into an in-doubt transport failure", async () => {
    const truncated: StreamFrame[] = [
      { sequence: 0, kind: "start", bytes: 16 },
      { sequence: 1, kind: "text-delta", bytes: 8 },
    ];
    const outcome = await adapter("mock-full", [{ frames: truncated }]).call(
      requestFrom([{ op: "replace", path: "/streaming", value: true }]),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("GE_ADAPTER_TRANSPORT_FAILURE");
    expect(outcome.error.effectDisposition).toBe("in-doubt");
    expect(outcome.error.usageDisposition).toBe("conservative");
  });
});

describe("tool calls", () => {
  const definition = {
    name: "echo",
    requiredArguments: ["text"],
    allowedArguments: ["locale", "text"],
  };
  const request: AdapterRequest = requestFrom([
    { op: "replace", path: "/toolDefinitions", value: [definition] },
  ]);

  it("accepts a declared, authorized call", async () => {
    const outcome = await adapter("mock-full", [
      { toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "hi" } }] },
    ]).call(request);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.toolCalls).toHaveLength(1);
    expect(outcome.value.finishReason).toBe("tool-calls");
  });

  it("refuses a tool policy did not authorize, whatever the model selected", async () => {
    const outcome = await adapter("mock-full", [
      { toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "hi" } }] },
    ]).call(request, { authorizedTools: [] });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("GE_ADAPTER_TOOL_VALIDATION_FAILED");
    expect(
      outcome.error.detail.providerSafeFields.find((field) => field.name === "rule")?.value,
    ).toBe("T-005");
  });
});

describe("cancellation is a caller fact", () => {
  it("produces no adapter error when it arrives before dispatch", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    await expect(
      adapter("mock-full").call(requestFrom(), { signal: controller.signal }),
    ).rejects.toBe(reason);
  });

  it("produces GE_ADAPTER_CANCELLED once the dispatch boundary is crossed", async () => {
    const controller = new AbortController();
    const mock = adapter("mock-nonidempotent");
    const request = requestFrom([
      { op: "replace", path: "/cancellable", value: true },
      { op: "replace", path: "/sideEffectClass", value: "non-idempotent" },
    ]);
    // The script has no fault, so the abort is observed after dispatch.
    const promise = mock.call(request, { signal: controller.signal, attempt: 1 });
    controller.abort(new Error("late"));
    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("GE_ADAPTER_CANCELLED");
    expect(outcome.error.boundary).toBe("dispatch");
    expect(outcome.error.effectDisposition).toBe("in-doubt");
    const summary = validateErrorEnvelope(nonIdempotent, outcome.error, corpus.forbiddenMarkers);
    // in-doubt x an external side-effect class records a durable identity.
    expect(summary.requiresInDoubtRecord).toBe(true);
    expect(summary.ledgerAction).toBe("commit-conservative");
  });
});

describe("every code in the closed taxonomy is reachable by configuration", () => {
  const dispatchCodes = ADAPTER_ERROR_CODES.filter(
    (code) => (taxonomy.get(code)?.boundary ?? "") === "dispatch",
  );

  it.each(dispatchCodes)("%s", async (code) => {
    const outcome = await adapter("mock-full", [{ fail: code as AdapterErrorCode }]).call(
      requestFrom(),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const row = taxonomy.get(code);
    expect(outcome.error.code).toBe(code);
    expect(outcome.error.boundary).toBe(row?.boundary);
    expect(outcome.error.retryable).toBe(row?.retryable);
    expect(outcome.error.effectDisposition).toBe(row?.effectDisposition);
    expect(outcome.error.usageDisposition).toBe(row?.usageDisposition);
    expect(deriveLedgerAction(outcome.error.usageDisposition)).toBe(row?.ledgerAction);
    // A refusal that performed no external work reports no usage.
    expect(outcome.error.usage === null).toBe(row?.usageDisposition === "none");
  });

  it("reaches all five pre-dispatch codes through preflight and normalization", async () => {
    const observed = new Set<AdapterErrorCode>();
    const cases: readonly (readonly [string, AdapterRequest, string])[] = [
      ["mock-full", requestFrom([{ op: "replace", path: "/requestBytes", value: 2097152 }]), "mock-full"],
      ["mock-minimal", requestFrom([{ op: "replace", path: "/streaming", value: true }]), "mock-minimal"],
      ["mock-full", requestFrom([{ op: "replace", path: "/circuitState", value: "open" }]), "mock-full"],
      [
        "mock-full",
        requestFrom([
          {
            op: "replace",
            path: "/toolDefinitions",
            value: [
              { name: "echo", requiredArguments: [], allowedArguments: [] },
              { name: "echo", requiredArguments: [], allowedArguments: [] },
            ],
          },
        ]),
        "mock-full",
      ],
    ];
    for (const [descriptorId, request] of cases) {
      const outcome = await adapter(descriptorId).call(request);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) observed.add(outcome.error.code);
    }
    // A descriptor that is shape-valid and semantically invalid is refused
    // before any request rule runs.
    const broken = createMockAdapter({
      descriptor: descriptorFor("mock-full", [
        { op: "replace", path: "/capture/enabled", value: true },
      ]),
    });
    const brokenOutcome = await broken.call(requestFrom());
    expect(brokenOutcome.ok).toBe(false);
    if (!brokenOutcome.ok) observed.add(brokenOutcome.error.code);

    expect([...observed].sort()).toEqual([
      "GE_ADAPTER_BOUNDS_EXCEEDED",
      "GE_ADAPTER_CAPABILITY_UNSUPPORTED",
      "GE_ADAPTER_DESCRIPTOR_INVALID",
      "GE_ADAPTER_POLICY_DENIED",
      "GE_ADAPTER_TOOL_VALIDATION_FAILED",
    ]);
  });

  it("refuses to inject a fault without the fault-injection capability", async () => {
    const mock = createMockAdapter({
      descriptor: minimal,
      script: [{ fail: "GE_ADAPTER_TIMEOUT" }],
    });
    await expect(mock.call(requestFrom())).rejects.toThrow(/fault-injection/);
  });

  it("carries a provider backoff hint only for a retryable code", async () => {
    const limited = await adapter("mock-full", [
      { fail: "GE_ADAPTER_RATE_LIMITED", retryAfterMs: 1500 },
    ]).call(requestFrom());
    expect(limited.ok === false && limited.error.retryAfterMs).toBe(1500);
    const authenticated = await adapter("mock-full", [
      { fail: "GE_ADAPTER_AUTHENTICATION", retryAfterMs: 1500 },
    ]).call(requestFrom());
    expect(authenticated.ok === false && authenticated.error.retryAfterMs).toBeNull();
  });
});

describe("errors carry no secrets", () => {
  it("refuses a message containing a forbidden marker", async () => {
    const marker = corpus.forbiddenMarkers[0] as string;
    const mock = createMockAdapter({
      descriptor: full,
      budgetPolicyAllowedProviderMetrics: policyMetrics,
      forbiddenMarkers: corpus.forbiddenMarkers,
      script: [{ fail: "GE_ADAPTER_AUTHENTICATION" }],
    });
    expect(mock.supports("fault-injection")).toBe(true);
    const outcome = await mock.call(requestFrom());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.message).not.toContain(marker);
    for (const field of outcome.error.detail.providerSafeFields) {
      expect(field.value).not.toContain(marker);
    }
  });
});
