/**
 * The frozen, irreducible facts of `adapter-contract/v1alpha1`.
 *
 * Everything derivable is derived here and nowhere else. In particular the
 * usage disposition, the ledger action and the budget cost state are computed
 * from the taxonomy, never restated, so an adapter cannot declare a retry
 * policy that disagrees with the code it reports.
 */

import type {
  AdapterBoundary,
  AdapterCapability,
  AdapterErrorCode,
  AdapterKind,
  BudgetCostState,
  DenialReason,
  EffectDisposition,
  FinishReason,
  LedgerAction,
  ReportableResource,
  ResourceUnit,
  SideEffectClass,
  UsageDisposition,
  UsageTrust,
} from "./types.js";

export const ADAPTER_CAPABILITIES: readonly AdapterCapability[] = Object.freeze([
  "attachments",
  "cached-input-usage-reporting",
  "cancellation",
  "content-filter-reporting",
  "deterministic-replay",
  "fault-injection",
  "idempotency-key",
  "parallel-tool-calls",
  "provider-request-id",
  "rate-limit-reporting",
  "reasoning-usage-reporting",
  "retry-after-hint",
  "streaming",
  "structured-output",
  "tool-calling",
  "usage-reporting",
]);

export const ADAPTER_KINDS: readonly AdapterKind[] = Object.freeze([
  "anthropic",
  "google-gemini",
  "http",
  "mcp",
  "mock",
  "openai",
  "openai-compatible",
  "shell",
]);

export const ADAPTER_ERROR_CODES: readonly AdapterErrorCode[] = Object.freeze([
  "GE_ADAPTER_AUTHENTICATION",
  "GE_ADAPTER_BOUNDS_EXCEEDED",
  "GE_ADAPTER_CANCELLED",
  "GE_ADAPTER_CAPABILITY_UNSUPPORTED",
  "GE_ADAPTER_CONTENT_FILTERED",
  "GE_ADAPTER_DESCRIPTOR_INVALID",
  "GE_ADAPTER_INVALID_REQUEST",
  "GE_ADAPTER_MALFORMED_RESPONSE",
  "GE_ADAPTER_POLICY_DENIED",
  "GE_ADAPTER_QUOTA_EXCEEDED",
  "GE_ADAPTER_RATE_LIMITED",
  "GE_ADAPTER_TIMEOUT",
  "GE_ADAPTER_TOOL_VALIDATION_FAILED",
  "GE_ADAPTER_TRANSPORT_FAILURE",
]);

export const DENIAL_REASONS: readonly DenialReason[] = Object.freeze([
  "capability-approval",
  "circuit-open",
  "egress-not-allowlisted",
  "environment-not-allowlisted",
  "executable-not-authorized",
  "idempotency-key-missing",
  "mcp-mutation-not-approved",
  "mcp-tool-not-allowlisted",
  "redirect-not-reauthorized",
  "stdin-policy",
  "tls-policy",
]);

export const FINISH_REASONS: readonly FinishReason[] = Object.freeze([
  "cancelled",
  "content-filter",
  "max-output",
  "stop",
  "tool-calls",
]);

export const REPORTABLE_RESOURCES: readonly ReportableResource[] = Object.freeze([
  "audio-units",
  "cached-input-units",
  "image-units",
  "input-units",
  "output-units",
  "provider-calls",
  "reasoning-units",
  "tool-calls",
  "transport-bytes",
]);

/** Exactly the cycle-controller `sideEffects` vocabulary, in escalation order. */
export const SIDE_EFFECT_ORDER: readonly SideEffectClass[] = Object.freeze([
  "none",
  "idempotent",
  "non-idempotent",
]);

export const STREAM_FRAME_KINDS = Object.freeze([
  "finish",
  "start",
  "text-delta",
  "tool-call",
  "usage",
] as const);

export const MODEL_ADAPTER_KINDS: readonly AdapterKind[] = Object.freeze([
  "anthropic",
  "google-gemini",
  "openai",
  "openai-compatible",
]);

export const SAFE_INTEGER_MAX = 9007199254740991;

/**
 * Hosts a deterministic corpus is permitted to name. RFC 2606 / RFC 6761
 * reserved names can never resolve to a routable address.
 */
const NON_ROUTABLE_SUFFIXES = Object.freeze([".invalid", ".test"]);
const NON_ROUTABLE_EXACT = Object.freeze(["localhost"]);

export function isNonRoutableHost(host: string): boolean {
  if (NON_ROUTABLE_EXACT.includes(host)) return true;
  return NON_ROUTABLE_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

export interface TaxonomyFacts {
  readonly boundary: AdapterBoundary;
  readonly retryable: boolean;
  readonly effectDisposition: EffectDisposition;
}

/**
 * The closed failure taxonomy of adapter-semantics 8.1. Retryability is a
 * property of the code: no implementation may read a message string, an HTTP
 * status text or a provider payload to decide whether to retry.
 */
export const TAXONOMY_FACTS: Readonly<Record<AdapterErrorCode, TaxonomyFacts>> = Object.freeze({
  GE_ADAPTER_AUTHENTICATION: {
    boundary: "dispatch",
    retryable: false,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_BOUNDS_EXCEEDED: {
    boundary: "pre-dispatch",
    retryable: false,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_CANCELLED: {
    boundary: "dispatch",
    retryable: false,
    effectDisposition: "in-doubt",
  },
  GE_ADAPTER_CAPABILITY_UNSUPPORTED: {
    boundary: "pre-dispatch",
    retryable: false,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_CONTENT_FILTERED: {
    boundary: "dispatch",
    retryable: false,
    effectDisposition: "applied",
  },
  GE_ADAPTER_DESCRIPTOR_INVALID: {
    boundary: "pre-dispatch",
    retryable: false,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_INVALID_REQUEST: {
    boundary: "dispatch",
    retryable: false,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_MALFORMED_RESPONSE: {
    boundary: "dispatch",
    retryable: true,
    effectDisposition: "applied",
  },
  GE_ADAPTER_POLICY_DENIED: {
    boundary: "pre-dispatch",
    retryable: false,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_QUOTA_EXCEEDED: {
    boundary: "dispatch",
    retryable: false,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_RATE_LIMITED: {
    boundary: "dispatch",
    retryable: true,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_TIMEOUT: {
    boundary: "dispatch",
    retryable: true,
    effectDisposition: "in-doubt",
  },
  GE_ADAPTER_TOOL_VALIDATION_FAILED: {
    boundary: "pre-dispatch",
    retryable: false,
    effectDisposition: "not-applied",
  },
  GE_ADAPTER_TRANSPORT_FAILURE: {
    boundary: "dispatch",
    retryable: true,
    effectDisposition: "in-doubt",
  },
});

export function taxonomyFacts(code: AdapterErrorCode): TaxonomyFacts {
  const facts = TAXONOMY_FACTS[code];
  if (facts === undefined) throw new Error(`unknown adapter error code '${String(code)}'`);
  return facts;
}

/** adapter-semantics 8.1: derived, never declared. */
export function deriveUsageDisposition(effect: EffectDisposition): UsageDisposition {
  return effect === "not-applied" ? "none" : "conservative";
}

/** adapter-semantics 8.1: release only capacity proven unused. */
export function deriveLedgerAction(usage: UsageDisposition): LedgerAction {
  return usage === "none" ? "release-reservation" : "commit-conservative";
}

/** adapter-semantics 7.3: three of the seven public cost states. */
export function deriveBudgetCostState(trust: UsageTrust): BudgetCostState {
  if (trust === "provider-reported") return "provider-reported";
  if (trust === "adapter-conservative") return "estimated";
  if (trust === "unknown") return "unknown";
  throw new Error(`unknown usage trust '${String(trust)}'`);
}

/**
 * cycle-semantics 13.4: an in-doubt external effect produces a durable
 * in-doubt identity only for an external side-effect class.
 */
export function requiresInDoubtRecord(
  effect: EffectDisposition,
  sideEffectClass: SideEffectClass,
): boolean {
  return effect === "in-doubt" && sideEffectClass !== "none";
}

/**
 * cycle-semantics 13.4: `none` and `idempotent` may retry under the same stable
 * key; `non-idempotent` stops after its first ambiguous outcome, and
 * "ambiguous" is exactly `effectDisposition !== "not-applied"`.
 */
export function sideEffectPermitsRetry(
  effect: EffectDisposition,
  sideEffectClass: SideEffectClass,
): boolean {
  if (sideEffectClass !== "non-idempotent") return true;
  return effect === "not-applied";
}

/** adapter-semantics 7.2. Each resource carries exactly one unit. */
export const RESOURCE_UNITS: Readonly<Record<ReportableResource, ResourceUnit>> = Object.freeze({
  "audio-units": "usage-unit",
  "cached-input-units": "usage-unit",
  "image-units": "usage-unit",
  "input-units": "usage-unit",
  "output-units": "usage-unit",
  "provider-calls": "count",
  "reasoning-units": "usage-unit",
  "tool-calls": "count",
  "transport-bytes": "byte",
});

export const USAGE_UNIT_RESOURCES: readonly ReportableResource[] = Object.freeze([
  "audio-units",
  "cached-input-units",
  "image-units",
  "input-units",
  "output-units",
  "reasoning-units",
]);

export interface CapabilityImplication {
  readonly rule: string;
  readonly capability: AdapterCapability;
  readonly requires: AdapterCapability;
}

/** adapter-semantics 4.2. Table rows, so each row is separately falsifiable. */
export const CAPABILITY_IMPLICATIONS: readonly CapabilityImplication[] = Object.freeze([
  { rule: "D-009", capability: "cached-input-usage-reporting", requires: "usage-reporting" },
  { rule: "D-010", capability: "reasoning-usage-reporting", requires: "usage-reporting" },
  { rule: "D-011", capability: "parallel-tool-calls", requires: "tool-calling" },
  { rule: "D-012", capability: "retry-after-hint", requires: "rate-limit-reporting" },
]);

export const MOCK_ONLY_CAPABILITIES: readonly {
  readonly rule: string;
  readonly capability: AdapterCapability;
}[] = Object.freeze([
  { rule: "D-013", capability: "deterministic-replay" },
  { rule: "D-014", capability: "fault-injection" },
]);

export const CAPABILITY_GATED_RESOURCES: readonly {
  readonly rule: string;
  readonly resource: ReportableResource;
  readonly capability: AdapterCapability;
}[] = Object.freeze([
  { rule: "U-009", resource: "cached-input-units", capability: "cached-input-usage-reporting" },
  { rule: "U-010", resource: "reasoning-units", capability: "reasoning-usage-reporting" },
  { rule: "U-011", resource: "image-units", capability: "attachments" },
  { rule: "U-011", resource: "audio-units", capability: "attachments" },
  { rule: "U-012", resource: "tool-calls", capability: "tool-calling" },
]);

export function escalatesSideEffect(
  requested: SideEffectClass,
  authorized: SideEffectClass,
): boolean {
  return SIDE_EFFECT_ORDER.indexOf(requested) > SIDE_EFFECT_ORDER.indexOf(authorized);
}
