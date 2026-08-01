/**
 * The D13 conformance corpus executed against this package's rule engine.
 *
 * Every expectation is a literal read from `spec/conformance/adapter.case.json`.
 * Nothing in this file restates a contract fact, and a disagreement between the
 * implementation and the corpus fails here rather than being reconciled.
 */

import { describe, expect, it } from "vitest";

import {
  ADAPTER_CAPABILITIES,
  ADAPTER_ERROR_CODES,
  ADAPTER_KINDS,
  DENIAL_REASONS,
  FINISH_REASONS,
  REPORTABLE_RESOURCES,
  RESOURCE_UNITS,
  SIDE_EFFECT_ORDER,
  circuitFold,
  deriveBudgetCostState,
  deriveLedgerAction,
  deriveUsageDisposition,
  isAdapterContractError,
  isSortedByCodePoint,
  normalizeStream,
  preflight,
  requiresInDoubtRecord,
  retryDecision,
  sideEffectPermitsRetry,
  TAXONOMY_FACTS,
  validateDescriptor,
  validateDescriptorAgainstBudgetPolicy,
  validateErrorEnvelope,
  validateToolCalls,
  validateUsage,
  type AdapterErrorCode,
  type DenialReason,
  type FinishReason,
  type ReportableResource,
  type StreamFrame,
  type ToolCallResponse,
} from "../src/index.js";
import {
  applyMutations,
  clone,
  corpus,
  descriptorFor,
  descriptorNamed,
  requestFrom,
} from "./corpus.js";

/** Rules produced anywhere in this run; the register must be fully covered. */
const exercised = new Set<string>();
const observedCodes = new Set<AdapterErrorCode>();

interface Observation {
  readonly code: AdapterErrorCode | null;
  readonly rule: string | null;
  readonly message: string | null;
}

function observe(run: () => void): Observation {
  try {
    run();
    return { code: null, rule: null, message: null };
  } catch (error) {
    if (!isAdapterContractError(error)) throw error;
    return { code: error.code, rule: error.rule, message: error.message };
  }
}

function record(
  observation: Observation,
  expectedCode: AdapterErrorCode | null,
  expectedRule: string | null,
): void {
  expect(observation.code).toBe(expectedCode);
  expect(observation.rule).toBe(expectedRule);
  if (observation.rule !== null) {
    exercised.add(observation.rule);
    if (observation.code !== null) observedCodes.add(observation.code);
  }
}

describe("corpus honesty flags", () => {
  it("is deterministic-mock evidence that claims no implementation of itself", () => {
    expect(corpus.apiVersion).toBe(
      "graphengineering.reacher-z.github.io/adapter-conformance/v1alpha1",
    );
    expect(corpus.contractStatus).toBe("contract-only-native-implementation-required");
    expect(corpus.implementationClaim).toBe(false);
    expect(typeof corpus.implementationClaim).toBe("boolean");
    expect(corpus.evidenceClass).toBe("deterministic-mock");
    expect(corpus.environmentAssertions).toEqual({
      credentialRequired: false,
      injectedClockOnly: true,
      networkAccess: false,
      wallClockDependence: false,
    });
  });

  it("names three agent-harness integrations, none of them an official adapter", () => {
    expect(corpus.integrationNotes).toHaveLength(3);
    for (const note of corpus.integrationNotes) {
      expect(note.officialV1Adapter).toBe(false);
      expect(note.privateApiClaim).toBe(false);
      expect(["mcp", "shell"]).toContain(note.mechanism);
      expect(ADAPTER_KINDS).not.toContain(note.integration);
    }
  });
});

describe("closed inventories", () => {
  it("matches the corpus inventories exactly and in order", () => {
    expect(ADAPTER_CAPABILITIES).toEqual(corpus.capabilityInventory);
    expect(ADAPTER_KINDS).toEqual(corpus.adapterKindInventory);
    expect(DENIAL_REASONS).toEqual(corpus.denialReasonInventory);
    expect(FINISH_REASONS).toEqual(corpus.finishReasonInventory);
    expect(REPORTABLE_RESOURCES).toEqual(corpus.reportableResourceInventory);
    expect(SIDE_EFFECT_ORDER).toEqual(corpus.cycleComposition.sideEffectClasses);
  });

  it("keeps every inventory in Unicode code-point order", () => {
    for (const values of [
      ADAPTER_CAPABILITIES,
      ADAPTER_KINDS,
      DENIAL_REASONS,
      FINISH_REASONS,
      REPORTABLE_RESOURCES,
      ADAPTER_ERROR_CODES,
    ]) {
      expect(isSortedByCodePoint(values)).toBe(true);
    }
    expect(ADAPTER_CAPABILITIES).toHaveLength(16);
    expect(ADAPTER_ERROR_CODES).toHaveLength(14);
    expect(ADAPTER_KINDS).toHaveLength(8);
  });

  it("binds every reportable meter to the unit and aggregation the budget contract fixes", () => {
    expect(corpus.budgetComposition.resourceBindings.map((row) => row.resource)).toEqual(
      REPORTABLE_RESOURCES,
    );
    for (const row of corpus.budgetComposition.resourceBindings) {
      expect(row.unit).toBe(RESOURCE_UNITS[row.resource]);
      expect(row.aggregation).toBe("sum");
    }
    // adapter-semantics 7.1: money is not adapter-reportable.
    expect(corpus.budgetComposition.forbiddenResources).toContain("money-nano-minor");
    expect(REPORTABLE_RESOURCES).not.toContain("money-nano-minor" as ReportableResource);
    expect(corpus.budgetComposition.forbiddenResources).toHaveLength(16);
  });

  it("derives every cost-state binding from trust", () => {
    for (const binding of corpus.budgetComposition.costStateBindings) {
      expect(binding.budgetCostState).toBe(
        deriveBudgetCostState(binding.trust as Parameters<typeof deriveBudgetCostState>[0]),
      );
    }
  });
});

describe("closed failure taxonomy", () => {
  it("recomputes every row rather than reading it", () => {
    expect(corpus.errorTaxonomy.map((row) => row.code)).toEqual(ADAPTER_ERROR_CODES);
    let retryable = 0;
    let preDispatch = 0;
    for (const row of corpus.errorTaxonomy) {
      const facts = TAXONOMY_FACTS[row.code];
      const usageDisposition = deriveUsageDisposition(facts.effectDisposition);
      expect({
        boundary: row.boundary,
        retryable: row.retryable,
        effectDisposition: row.effectDisposition,
        usageDisposition: row.usageDisposition,
        ledgerAction: row.ledgerAction,
      }).toEqual({
        boundary: facts.boundary,
        retryable: facts.retryable,
        effectDisposition: facts.effectDisposition,
        usageDisposition,
        ledgerAction: deriveLedgerAction(usageDisposition),
      });
      if (facts.boundary === "pre-dispatch") {
        preDispatch += 1;
        expect(facts.retryable).toBe(false);
        expect(facts.effectDisposition).toBe("not-applied");
      }
      if (facts.retryable) retryable += 1;
    }
    expect(retryable).toBe(4);
    expect(preDispatch).toBe(5);
  });

  it("reproduces the in-doubt composition matrix of cycle-semantics 13.4", () => {
    const expected = [];
    for (const disposition of ["applied", "in-doubt", "not-applied"] as const) {
      for (const sideEffectClass of SIDE_EFFECT_ORDER) {
        expected.push({
          effectDisposition: disposition,
          recordsInDoubtIdentity: requiresInDoubtRecord(disposition, sideEffectClass),
          retryPermittedBySideEffect: sideEffectPermitsRetry(disposition, sideEffectClass),
          sideEffectClass,
        });
      }
    }
    expect(corpus.cycleComposition.matrix).toEqual(expected);
    expect(expected.filter((row) => row.recordsInDoubtIdentity)).toHaveLength(2);
  });
});

describe("shipped descriptors", () => {
  it("accepts all twelve, covers all eight kinds and all sixteen capabilities", () => {
    for (const descriptor of corpus.descriptors) {
      expect(descriptor.evidenceClass).toBe("deterministic-mock");
      expect(validateDescriptor(descriptor)).toBe(true);
      expect(
        validateDescriptorAgainstBudgetPolicy(
          descriptor,
          corpus.budgetPolicyAllowedProviderMetrics,
        ),
      ).toBe(true);
    }
    const kinds = new Set(corpus.descriptors.map((item) => item.adapterKind));
    for (const kind of ADAPTER_KINDS) expect(kinds).toContain(kind);
    const declared = new Set(corpus.descriptors.flatMap((item) => item.capabilities));
    for (const capability of ADAPTER_CAPABILITIES) expect(declared).toContain(capability);
  });
});

describe.each(corpus.descriptorCases)("descriptor case $id", (testCase) => {
  it("reports the corpus code and rule", () => {
    const candidate = applyMutations(clone(descriptorNamed(testCase.base)), testCase.mutations);
    record(
      observe(() => {
        validateDescriptor(candidate);
        validateDescriptorAgainstBudgetPolicy(
          candidate,
          corpus.budgetPolicyAllowedProviderMetrics,
        );
      }),
      testCase.expectedCode,
      testCase.expectedRule,
    );
  });
});

describe.each(corpus.preflightCases)("preflight case $id", (testCase) => {
  it("refuses before dispatch with the corpus code, rule and message", () => {
    const descriptor = descriptorFor(testCase.descriptor, testCase.descriptorMutations ?? []);
    const request = requestFrom(testCase.requestMutations ?? []);
    const observation = observe(() => {
      const outcome = preflight(descriptor, request, corpus.budgetPolicyAllowedProviderMetrics);
      expect(outcome.admitted).toBe(true);
      expect(outcome.requestId).toBe(request.requestId);
    });
    record(observation, testCase.expectedCode, testCase.expectedRule);
    if (testCase.expectedMessage !== undefined) {
      expect(observation.message).toBe(testCase.expectedMessage);
    }
  });
});

describe.each(corpus.streamCases)("stream case $id", (testCase) => {
  it("normalizes to the corpus projection", () => {
    const descriptor = descriptorFor(testCase.descriptor, testCase.descriptorMutations ?? []);
    const frames = applyMutations(
      clone(corpus.streamTemplate) as StreamFrame[],
      testCase.mutations ?? [],
    );
    record(
      observe(() => {
        const normalized = normalizeStream(descriptor, frames);
        expect(normalized).toEqual(testCase.expectedNormalized);
      }),
      testCase.expectedCode,
      testCase.expectedRule,
    );
  });
});

describe.each(corpus.usageCases)("usage case $id", (testCase) => {
  it("validates the meters against the corpus expectation", () => {
    const descriptor = descriptorFor(testCase.descriptor, testCase.descriptorMutations ?? []);
    const usage = applyMutations(clone(corpus.usageTemplate), testCase.mutations ?? []);
    record(
      observe(() => {
        const summary = validateUsage(descriptor, usage);
        if (testCase.expectedSummary !== undefined) {
          expect(summary).toEqual(testCase.expectedSummary);
        }
      }),
      testCase.expectedCode,
      testCase.expectedRule,
    );
  });
});

describe.each(corpus.toolCases)("tool case $id", (testCase) => {
  it("validates model-emitted tool calls before the tool runs", () => {
    const descriptor = descriptorFor(testCase.descriptor, testCase.descriptorMutations ?? []);
    const request = requestFrom(testCase.requestMutations ?? []);
    const response = applyMutations(
      clone(corpus.toolResponseTemplate) as ToolCallResponse,
      testCase.mutations ?? [],
    );
    record(
      observe(() => {
        const summary = validateToolCalls(descriptor, request, response);
        expect(summary.toolCalls).toBe(response.toolCalls.length);
      }),
      testCase.expectedCode,
      testCase.expectedRule,
    );
  });
});

describe.each(corpus.errorCases)("error case $id", (testCase) => {
  it("proves the envelope against the derived taxonomy", () => {
    const descriptor = descriptorFor(testCase.descriptor, testCase.descriptorMutations ?? []);
    const envelope = applyMutations(clone(corpus.errorTemplate), testCase.mutations ?? []);
    record(
      observe(() => {
        const summary = validateErrorEnvelope(descriptor, envelope, corpus.forbiddenMarkers);
        if (testCase.expectedSummary !== undefined) {
          expect(summary).toEqual(testCase.expectedSummary);
        }
      }),
      testCase.expectedCode,
      testCase.expectedRule,
    );
    if (testCase.expectedCode === null) observedCodes.add(envelope.code);
  });
});

describe.each(corpus.retryCases)("retry case $id", (testCase) => {
  it("recomputes the integer backoff decision", () => {
    const descriptor = descriptorFor(testCase.descriptor, testCase.descriptorMutations ?? []);
    const decision = retryDecision(
      descriptor,
      testCase.code,
      testCase.sideEffectClass,
      testCase.attempt,
      testCase.retryAfterMs,
    );
    expect({
      mayRetry: decision.mayRetry,
      backoffMs: decision.backoffMs,
      rule: decision.rule,
    }).toEqual(testCase.expected);
    exercised.add(decision.rule);
  });
});

describe.each(corpus.circuitCases)("circuit case $id", (testCase) => {
  it("folds the injected-clock script to the corpus projection", () => {
    const observedProjection = circuitFold(
      descriptorNamed(testCase.descriptor),
      testCase.script,
    );
    expect({ ...observedProjection }).toEqual(testCase.expected);
    for (const rule of testCase.rules) exercised.add(rule);
  });
});

describe("coverage is a hard failure", () => {
  it("exercises every registered rule and produces no unregistered rule", () => {
    const registered = new Set(corpus.ruleRegister.map((row) => row.rule));
    const missing = [...registered].filter((rule) => !exercised.has(rule)).sort();
    expect(missing).toEqual([]);
    const stray = [...exercised].filter((rule) => !registered.has(rule)).sort();
    expect(stray).toEqual([]);
    expect(registered.size).toBe(corpus.declaredCounts.rules);
  });

  it("produces every code in the closed taxonomy", () => {
    for (const code of ADAPTER_ERROR_CODES) expect(observedCodes).toContain(code);
  });

  it("agrees with the register on every rule's code and denial reason", () => {
    const rows = new Map(corpus.ruleRegister.map((row) => [row.rule, row]));
    for (const testCase of corpus.preflightCases) {
      if (testCase.expectedDenialReason === undefined) continue;
      expect(testCase.expectedCode).toBe("GE_ADAPTER_POLICY_DENIED");
      expect(rows.get(testCase.expectedRule as string)?.denialReason ?? null).toBe(
        testCase.expectedDenialReason,
      );
    }
    const denials = new Set<DenialReason>(
      corpus.preflightCases
        .map((item) => item.expectedDenialReason)
        .filter((value): value is DenialReason => value !== undefined),
    );
    for (const reason of DENIAL_REASONS) expect(denials).toContain(reason);
  });

  it("exercises every finish reason and every reportable meter", () => {
    const finishes = new Set<FinishReason>();
    for (const testCase of corpus.streamCases) {
      const reason = testCase.expectedNormalized?.finishReason;
      if (reason !== undefined && reason !== null) finishes.add(reason);
      if (testCase.finishReasonExercised !== undefined) {
        finishes.add(testCase.finishReasonExercised);
      }
    }
    for (const reason of FINISH_REASONS) expect(finishes).toContain(reason);

    const resources = new Set<ReportableResource>();
    for (const testCase of corpus.usageCases) {
      for (const resource of testCase.resourcesExercised ?? []) resources.add(resource);
    }
    for (const resource of REPORTABLE_RESOURCES) expect(resources).toContain(resource);
  });

  it("consumes exactly the section counts the corpus declares", () => {
    expect({
      circuitCases: corpus.circuitCases.length,
      descriptorCases: corpus.descriptorCases.length,
      descriptors: corpus.descriptors.length,
      errorCases: corpus.errorCases.length,
      preflightCases: corpus.preflightCases.length,
      retryCases: corpus.retryCases.length,
      rules: corpus.ruleRegister.length,
      schemaNegativeCases: corpus.schemaNegativeCases.length,
      streamCases: corpus.streamCases.length,
      toolCases: corpus.toolCases.length,
      usageCases: corpus.usageCases.length,
    }).toEqual(corpus.declaredCounts);
  });
});

describe("no host in the corpus could ever resolve", () => {
  it("names only localhost and RFC 2606 / RFC 6761 reserved names", () => {
    const text = JSON.stringify(corpus);
    for (const match of text.matchAll(/"host":"([^"]+)"/g)) {
      const host = match[1] as string;
      expect(host === "localhost" || /\.(invalid|test)$/.test(host)).toBe(true);
    }
    expect(/https?:\/\//.test(text)).toBe(false);
  });
});
