/**
 * Normalized error envelope consistency, rules `E-001` through `E-015`, plus
 * the single constructor every adapter in this package uses.
 *
 * adapter-semantics 8.5: an error message is operator-facing and never
 * load-bearing. `message` and every provider-safe detail field MUST NOT carry
 * credentials, prompts or unredacted provider payloads.
 */

import {
  ADAPTER_API_VERSION,
  ADAPTER_CONTRACT_VERSION,
} from "./types.js";
import {
  deriveLedgerAction,
  deriveUsageDisposition,
  escalatesSideEffect,
  taxonomyFacts,
  requiresInDoubtRecord,
} from "./contract.js";
import { fail } from "./errors.js";
import { compareUnicodeCodePoints, isSortedByCodePoint } from "./ordering.js";
import type {
  AdapterDescriptor,
  AdapterErrorCode,
  AdapterErrorEnvelope,
  AdapterUsage,
  DenialReason,
  NormalizedErrorOutcome,
  ProviderSafeField,
  SideEffectClass,
} from "./types.js";

const MALFORMED = "GE_ADAPTER_MALFORMED_RESPONSE" as const;
const NUL = String.fromCharCode(0);
const MAX_MESSAGE_LENGTH = 512;

export function validateErrorEnvelope(
  descriptor: AdapterDescriptor,
  error: AdapterErrorEnvelope,
  forbiddenMarkers: readonly string[] = [],
): NormalizedErrorOutcome {
  const facts = taxonomyFacts(error.code);
  const declared = new Set<string>(descriptor.capabilities);

  if (error.retryable !== facts.retryable) {
    fail(MALFORMED, "E-001", "retryability is a property of the code and cannot be restated");
  }
  if (error.boundary !== facts.boundary) {
    fail(MALFORMED, "E-002", "boundary is a property of the code");
  }
  if (error.effectDisposition !== facts.effectDisposition) {
    fail(MALFORMED, "E-003", "external-effect disposition is a property of the code");
  }
  if (error.usageDisposition !== deriveUsageDisposition(facts.effectDisposition)) {
    fail(MALFORMED, "E-004", "usage disposition is derived from the effect disposition");
  }
  if ((error.denialReason !== null) !== (error.code === "GE_ADAPTER_POLICY_DENIED")) {
    fail(MALFORMED, "E-005",
      "a denial reason accompanies GE_ADAPTER_POLICY_DENIED and nothing else");
  }
  if (error.providerRequestId !== null && facts.boundary !== "dispatch") {
    fail(MALFORMED, "E-006", "a pre-dispatch refusal never reached the provider");
  }
  if (error.providerRequestId !== null && !declared.has("provider-request-id")) {
    fail(MALFORMED, "E-007",
      "a provider request identity requires the provider-request-id capability");
  }
  if (error.retryAfterMs !== null && !facts.retryable) {
    fail(MALFORMED, "E-008", "a backoff hint on a non-retryable code is meaningless");
  }
  if (error.retryAfterMs !== null && !declared.has("retry-after-hint")) {
    fail(MALFORMED, "E-009", "a backoff hint requires the retry-after-hint capability");
  }
  if (error.usageDisposition === "none" && error.usage !== null) {
    fail(MALFORMED, "E-010", "a refusal that performed no external work reports no usage");
  }
  if (
    error.usage !== null &&
    (error.usage.adapterId !== error.adapterId ||
      error.usage.adapterKind !== error.adapterKind ||
      error.usage.requestId !== error.requestId)
  ) {
    fail(MALFORMED, "E-011", "an attached usage envelope must bind the same adapter and request");
  }
  if (error.attempt > descriptor.retryPolicy.maxAttempts) {
    fail(MALFORMED, "E-012", "an attempt index cannot exceed the declared attempt ceiling");
  }
  if (escalatesSideEffect(error.sideEffectClass, descriptor.sideEffectClass)) {
    fail(MALFORMED, "E-013",
      "an error cannot report a stronger side-effect class than the adapter declares");
  }
  const haystack = [
    error.message,
    ...error.detail.providerSafeFields.map((field) => `${field.name}=${field.value}`),
  ].join(NUL);
  for (const marker of forbiddenMarkers) {
    if (haystack.includes(marker)) {
      fail(MALFORMED, "E-014",
        "an adapter error must not carry credentials, prompts or unredacted payloads");
    }
  }
  const names = error.detail.providerSafeFields.map((field) => field.name);
  if (new Set(names).size !== names.length || !isSortedByCodePoint(names)) {
    fail(MALFORMED, "E-015", "provider-safe detail names must be unique and ordered");
  }

  return Object.freeze({
    code: error.code,
    ledgerAction: deriveLedgerAction(error.usageDisposition),
    requiresInDoubtRecord: requiresInDoubtRecord(error.effectDisposition, error.sideEffectClass),
  });
}

export interface AdapterErrorInput {
  readonly descriptor: AdapterDescriptor;
  readonly requestId: string;
  readonly attempt: number;
  readonly code: AdapterErrorCode;
  readonly sideEffectClass: SideEffectClass;
  readonly message: string;
  readonly denialReason?: DenialReason | null;
  readonly providerRequestId?: string | null;
  readonly retryAfterMs?: number | null;
  /**
   * The stable rule identifier of adapter-semantics 12, reported as the `rule`
   * provider-safe detail field. `"none"` when the refusal is not one the rule
   * register names — an implementation may never invent a register identifier.
   */
  readonly rule?: string;
  readonly detail?: readonly ProviderSafeField[];
  readonly usage?: AdapterUsage | null;
  readonly forbiddenMarkers?: readonly string[];
}

/**
 * Build a normalized envelope whose boundary, retryability, effect disposition
 * and usage disposition are *derived* from the code, then prove it against
 * `E-001`..`E-015` before returning it. An adapter cannot emit a
 * non-conforming envelope through this constructor.
 */
export function normalizedAdapterError(input: AdapterErrorInput): AdapterErrorEnvelope {
  const facts = taxonomyFacts(input.code);
  const fields = new Map<string, string>([
    ["attempt", String(input.attempt)],
    ["rule", input.rule ?? "none"],
  ]);
  for (const field of input.detail ?? []) fields.set(field.name, field.value);
  const providerSafeFields: ProviderSafeField[] = [...fields.entries()]
    .map(([name, value]) => Object.freeze({ name, value: value.slice(0, 256) }))
    .sort((left, right) => compareUnicodeCodePoints(left.name, right.name));

  const envelope: AdapterErrorEnvelope = Object.freeze({
    apiVersion: ADAPTER_API_VERSION,
    kind: "AdapterError" as const,
    contractVersion: ADAPTER_CONTRACT_VERSION,
    adapterId: input.descriptor.adapterId,
    adapterKind: input.descriptor.adapterKind,
    requestId: input.requestId,
    attempt: input.attempt,
    code: input.code,
    boundary: facts.boundary,
    retryable: facts.retryable,
    effectDisposition: facts.effectDisposition,
    usageDisposition: deriveUsageDisposition(facts.effectDisposition),
    sideEffectClass: input.sideEffectClass,
    denialReason: input.denialReason ?? null,
    providerRequestId: input.providerRequestId ?? null,
    retryAfterMs: input.retryAfterMs ?? null,
    message: input.message.slice(0, MAX_MESSAGE_LENGTH),
    detail: Object.freeze({ providerSafeFields: Object.freeze(providerSafeFields) }),
    usage: input.usage ?? null,
  });

  validateErrorEnvelope(input.descriptor, envelope, input.forbiddenMarkers ?? []);
  return envelope;
}
