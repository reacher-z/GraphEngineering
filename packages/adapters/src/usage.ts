/**
 * Usage envelope normalization, rules `U-001` through `U-018`.
 *
 * adapter-semantics 7.1: an adapter reports meters, never money. The envelope
 * has no currency, no minor-unit exponent and no `money-nano-minor` entry;
 * money is produced only by applying an immutable pricing snapshot to these
 * meters. A zero meter is represented by absence.
 */

import {
  CAPABILITY_GATED_RESOURCES,
  RESOURCE_UNITS,
  SAFE_INTEGER_MAX,
  USAGE_UNIT_RESOURCES,
  deriveBudgetCostState,
} from "./contract.js";
import { fail } from "./errors.js";
import { compareUnicodeCodePoints, isSortedByCodePoint } from "./ordering.js";
import {
  ADAPTER_API_VERSION,
  ADAPTER_CONTRACT_VERSION,
  type AdapterDescriptor,
  type AdapterUsage,
  type FinishReason,
  type NormalizedUsage,
  type ProviderQuantity,
  type ReportableResource,
  type UsageQuantity,
  type UsageTrust,
} from "./types.js";

const MALFORMED = "GE_ADAPTER_MALFORMED_RESPONSE" as const;
const NUL = String.fromCharCode(0);

function metricKey(metric: ProviderQuantity): string {
  return `${metric.metricId}${NUL}${metric.unitId}`;
}

export function validateUsage(
  descriptor: AdapterDescriptor,
  usage: AdapterUsage,
): NormalizedUsage {
  const declared = new Set<string>(descriptor.capabilities);
  const resources = usage.quantities.map((quantity) => quantity.resource);

  for (const resource of resources) {
    if (!Object.hasOwn(RESOURCE_UNITS, resource)) {
      fail(MALFORMED, "U-005",
        `resource '${resource}' is not adapter-reportable; adapters report meters, never money`);
    }
  }
  if (new Set(resources).size !== resources.length) {
    fail(MALFORMED, "U-002", "usage resources must be unique");
  }
  if (!isSortedByCodePoint(resources)) {
    fail(MALFORMED, "U-001", "usage quantities must be in Unicode code-point order by resource");
  }
  for (const quantity of usage.quantities) {
    if (quantity.unit !== RESOURCE_UNITS[quantity.resource]) {
      fail(MALFORMED, "U-003",
        `resource '${quantity.resource}' has a fixed unit '${RESOURCE_UNITS[quantity.resource]}'`);
    }
    if (quantity.aggregation !== "sum") {
      fail(MALFORMED, "U-004", "an adapter reports only sum-aggregated resources");
    }
    if (
      !Number.isSafeInteger(quantity.amount) ||
      quantity.amount < 1 ||
      quantity.amount > SAFE_INTEGER_MAX
    ) {
      fail(MALFORMED, "U-016",
        "usage amounts must be positive portable integers; zero is absence");
    }
  }

  if (usage.budgetCostState !== deriveBudgetCostState(usage.trust)) {
    fail(MALFORMED, "U-006", "budgetCostState must be the derivation of trust");
  }

  const byResource = new Map<ReportableResource, number>(
    usage.quantities.map((quantity) => [quantity.resource, quantity.amount]),
  );
  if (!byResource.has("provider-calls")) {
    fail(MALFORMED, "U-007",
      "every dispatch-boundary usage envelope records at least one provider call");
  }

  if (usage.trust === "provider-reported" && !declared.has("usage-reporting")) {
    fail(MALFORMED, "U-008", "provider-reported trust requires the usage-reporting capability");
  }

  for (const gate of CAPABILITY_GATED_RESOURCES) {
    if (byResource.has(gate.resource) && !declared.has(gate.capability)) {
      fail(MALFORMED, gate.rule,
        `resource '${gate.resource}' requires capability '${gate.capability}'`);
    }
  }

  if (usage.providerRequestId !== null && !declared.has("provider-request-id")) {
    fail(MALFORMED, "U-013",
      "a provider request identity requires the provider-request-id capability");
  }

  const metricKeys = usage.providerSpecific.map(metricKey);
  if (!isSortedByCodePoint(metricKeys)) {
    fail(MALFORMED, "U-014",
      "provider metrics must be unique and ordered by metricId + U+0000 + unitId");
  }
  const allowedMetrics = new Set(
    descriptor.allowedProviderMetrics.map(
      (metric) => `${metric.metricId}${NUL}${metric.unitId}`,
    ),
  );
  for (const key of metricKeys) {
    if (!allowedMetrics.has(key)) {
      fail(MALFORMED, "U-015",
        "a provider metric outside the descriptor allowlist is never silently bucketed");
    }
  }

  if (usage.finishReason === "content-filter" && !declared.has("content-filter-reporting")) {
    fail(MALFORMED, "U-017", "a content-filter finish reason requires content-filter-reporting");
  }

  if (!declared.has("usage-reporting")) {
    if (usage.trust !== "unknown") {
      fail(MALFORMED, "U-018", "an adapter without usage-reporting must report unknown trust");
    }
    for (const resource of USAGE_UNIT_RESOURCES) {
      if (byResource.has(resource)) {
        fail(MALFORMED, "U-018",
          "an adapter without usage-reporting cannot report a usage-unit meter");
      }
    }
  }

  return Object.freeze({
    resources: resources.length,
    providerCalls: byResource.get("provider-calls"),
    budgetCostState: usage.budgetCostState,
  });
}

export interface UsageDraft {
  readonly descriptor: AdapterDescriptor;
  readonly requestId: string;
  readonly providerRequestId: string | null;
  readonly trust: UsageTrust;
  readonly finishReason: FinishReason | null;
  /** A zero meter is absence; entries at or below zero are dropped. */
  readonly meters: Readonly<Partial<Record<ReportableResource, number>>>;
  readonly providerSpecific?: readonly ProviderQuantity[];
}

/**
 * Build a canonical usage envelope: meters ordered by resource, zeros absent,
 * `budgetCostState` derived from trust, and the whole document proved against
 * `U-001`..`U-018` before it is returned.
 */
export function composeUsage(draft: UsageDraft): AdapterUsage {
  const quantities: UsageQuantity[] = (
    Object.entries(draft.meters) as [ReportableResource, number | undefined][]
  )
    .filter(([, amount]) => amount !== undefined && amount > 0)
    .map(([resource, amount]) =>
      Object.freeze({
        resource,
        unit: RESOURCE_UNITS[resource],
        aggregation: "sum" as const,
        amount: amount as number,
      }),
    )
    .sort((left, right) => compareUnicodeCodePoints(left.resource, right.resource));

  const providerSpecific = [...(draft.providerSpecific ?? [])].sort((left, right) =>
    compareUnicodeCodePoints(metricKey(left), metricKey(right)),
  );

  const usage: AdapterUsage = Object.freeze({
    apiVersion: ADAPTER_API_VERSION,
    kind: "AdapterUsage" as const,
    contractVersion: ADAPTER_CONTRACT_VERSION,
    adapterId: draft.descriptor.adapterId,
    adapterKind: draft.descriptor.adapterKind,
    requestId: draft.requestId,
    providerRequestId: draft.providerRequestId,
    trust: draft.trust,
    budgetCostState: deriveBudgetCostState(draft.trust),
    finishReason: draft.finishReason,
    quantities: Object.freeze(quantities),
    providerSpecific: Object.freeze(providerSpecific),
  });

  validateUsage(draft.descriptor, usage);
  return usage;
}
