/**
 * Effective capture policy, the closed rule registry, and the canonical policy
 * hash of spec/redaction-semantics.md Section 4.
 *
 * Structural closure is followed by semantic validation: at most one rule per
 * sink, rules ordered by sink enum order then `ruleId`, at least one path per
 * rule, receipt path ordering, a rule required for each selected `redacted`
 * mode and forbidden for an incompatible mode, and
 * `inlineRiskAuthorizationHash` present exactly when an inline mode is selected.
 * The complete policy fails before its hash is computed.
 */

import {
  CAPTURE_SINK_CLASSES,
  type CaptureSinkClass,
  type GuardFailure,
  type PolicyControl,
} from "./codes.js";
import { sha256Hex } from "./crypto.js";
import { canonicalTagged } from "./durable-json.js";
import { sinkRow } from "./inventory.js";
import { SECTION_11_LIMITS } from "./limits.js";
import { compareUnicodeCodePoints, utf8ByteLength } from "./portable.js";
import { decodePointer, type ReplacementMode } from "./pointer.js";

export const CAPTURE_POLICY_API_VERSION =
  "graphengineering.reacher-z.github.io/capture-policy/v1alpha2" as const;
export const REDACTION_RULE_API_VERSION =
  "graphengineering.reacher-z.github.io/redaction-rule/v1alpha2" as const;
export const REDACTION_TRANSFORM = "json-pointer-rules/v1alpha2" as const;

/**
 * Section 3.3: the transform implementation manifest is immutable and named by
 * the run. `transformImplementationHash` is SHA-256 of the manifest and is never
 * derived from source or result bytes.
 */
export const TRANSFORM_IMPLEMENTATION_MANIFEST = Object.freeze({
  apiVersion: "graphengineering.reacher-z.github.io/transform-implementation/v1alpha2",
  transform: REDACTION_TRANSFORM,
  language: "typescript",
  module: "@graph-engineering/persistence/redaction/pointer",
  contract: "redaction-semantics.md#3.3.1",
  revision: 1,
});

export const TRANSFORM_IMPLEMENTATION_HASH = sha256Hex(
  canonicalTagged(TRANSFORM_IMPLEMENTATION_MANIFEST),
);

export interface RedactionRule {
  readonly apiVersion: typeof REDACTION_RULE_API_VERSION;
  readonly ruleId: string;
  readonly registryVersion: number;
  readonly sink: CaptureSinkClass;
  readonly paths: readonly string[];
  readonly replacementMode: ReplacementMode;
}

export interface RuleRegistrySnapshot {
  readonly apiVersion: "graphengineering.reacher-z.github.io/redaction-rule-registry/v1alpha2";
  readonly registryVersion: number;
  readonly rules: readonly RedactionRule[];
}

export function ruleRegistrySnapshot(
  registryVersion: number,
  rules: readonly RedactionRule[],
): RuleRegistrySnapshot {
  return {
    apiVersion: "graphengineering.reacher-z.github.io/redaction-rule-registry/v1alpha2",
    registryVersion,
    rules,
  };
}

/** Section 3.3: SHA-256 of the complete canonical closed registry snapshot. */
export function ruleRegistryHash(snapshot: RuleRegistrySnapshot): string {
  return sha256Hex(canonicalTagged(snapshot));
}

/**
 * Section 3.3: SHA-256 of canonical Tagged Durable JSON containing the ordered
 * closed resolved rules, including each `ruleId`, `registryVersion`, exact sink,
 * paths, and replacement mode.
 */
export function ruleSetHash(rules: readonly RedactionRule[]): string {
  return sha256Hex(
    canonicalTagged(
      rules.map((rule) => ({
        ruleId: rule.ruleId,
        registryVersion: rule.registryVersion,
        sink: rule.sink,
        paths: [...rule.paths],
        replacementMode: rule.replacementMode,
      })),
    ),
  );
}

export type DurableMode = "protected" | "inline-unredacted";
export type EventsMode = "metadata-or-protected" | "allow-redacted" | "inline-unredacted";
export type ErrorsMode =
  | "codes-only"
  | "codes-and-sanitized-message"
  | "redacted"
  | "protected-evidence"
  | "inline-unredacted";
export type ObservationalMode =
  | "off"
  | "metadata-only"
  | "redacted"
  | "protected"
  | "inline-unredacted";
export type IdentifiersMode = "generated-opaque-only" | "protected" | "inline-unredacted";

export interface CapturePolicy {
  readonly apiVersion: typeof CAPTURE_POLICY_API_VERSION;
  readonly durableValues: DurableMode;
  readonly checkpointValues: DurableMode;
  readonly events: EventsMode;
  readonly artifacts: ObservationalMode;
  readonly errors: ErrorsMode;
  readonly logs: ObservationalMode;
  readonly traces: ObservationalMode;
  readonly metrics: ObservationalMode;
  readonly prompts: ObservationalMode;
  readonly responses: ObservationalMode;
  readonly tools: ObservationalMode;
  readonly mcp: ObservationalMode;
  readonly plugins: ObservationalMode;
  readonly isolationOutputs: ObservationalMode;
  readonly database: ObservationalMode;
  readonly exports: ObservationalMode;
  readonly supportBundles: ObservationalMode;
  readonly testArtifacts: ObservationalMode;
  readonly identifiers: IdentifiersMode;
  readonly maxDiagnosticUtf8Bytes: number;
  readonly redactionTransform: typeof REDACTION_TRANSFORM;
  readonly transformImplementationHash: string;
  readonly ruleRegistryVersion: number;
  readonly ruleRegistryHash: string;
  readonly redactionRules: readonly RedactionRule[];
  readonly keyRef: string;
  readonly inlineRiskAuthorizationHash?: string;
}

/** Section 4.1 closed mode vocabulary, keyed by policy field. */
export const POLICY_MODE_VOCABULARY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  durableValues: ["protected", "inline-unredacted"],
  checkpointValues: ["protected", "inline-unredacted"],
  events: ["metadata-or-protected", "allow-redacted", "inline-unredacted"],
  errors: [
    "codes-only",
    "codes-and-sanitized-message",
    "redacted",
    "protected-evidence",
    "inline-unredacted",
  ],
  logs: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  traces: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  metrics: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  artifacts: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  prompts: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  responses: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  tools: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  mcp: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  plugins: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  isolationOutputs: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  database: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  exports: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  supportBundles: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  testArtifacts: ["off", "metadata-only", "redacted", "protected", "inline-unredacted"],
  identifiers: ["generated-opaque-only", "protected", "inline-unredacted"],
});

const POLICY_FIELDS = Object.freeze(Object.keys(POLICY_MODE_VOCABULARY)) as readonly PolicyControl[];

const SINK_ORDER = new Map<string, number>(
  CAPTURE_SINK_CLASSES.map((sink, index) => [sink, index]),
);

const EMPTY_REGISTRY_VERSION = 7;
const EMPTY_REGISTRY = ruleRegistrySnapshot(EMPTY_REGISTRY_VERSION, []);

/** Section 4.1 default stable profile. */
export const DEFAULT_CAPTURE_POLICY: CapturePolicy = Object.freeze({
  apiVersion: CAPTURE_POLICY_API_VERSION,
  durableValues: "protected",
  checkpointValues: "protected",
  events: "metadata-or-protected",
  artifacts: "off",
  errors: "codes-and-sanitized-message",
  logs: "metadata-only",
  traces: "off",
  metrics: "off",
  prompts: "off",
  responses: "off",
  tools: "off",
  mcp: "off",
  plugins: "off",
  isolationOutputs: "off",
  database: "off",
  exports: "off",
  supportBundles: "off",
  testArtifacts: "off",
  identifiers: "generated-opaque-only",
  maxDiagnosticUtf8Bytes: 1024,
  redactionTransform: REDACTION_TRANSFORM,
  transformImplementationHash: TRANSFORM_IMPLEMENTATION_HASH,
  ruleRegistryVersion: EMPTY_REGISTRY_VERSION,
  ruleRegistryHash: ruleRegistryHash(EMPTY_REGISTRY),
  redactionRules: [],
  keyRef: "operator-owned-key-reference",
});

/**
 * Normalize an effective policy to the exact closed portable object before
 * hashing or comparison. Property order does not affect the canonical bytes,
 * but an unknown or missing field does.
 */
export function normalizeCapturePolicy(policy: CapturePolicy): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    apiVersion: policy.apiVersion,
    maxDiagnosticUtf8Bytes: policy.maxDiagnosticUtf8Bytes,
    redactionTransform: policy.redactionTransform,
    transformImplementationHash: policy.transformImplementationHash,
    ruleRegistryVersion: policy.ruleRegistryVersion,
    ruleRegistryHash: policy.ruleRegistryHash,
    redactionRules: policy.redactionRules.map((rule) => ({
      apiVersion: rule.apiVersion,
      ruleId: rule.ruleId,
      registryVersion: rule.registryVersion,
      sink: rule.sink,
      paths: [...rule.paths],
      replacementMode: rule.replacementMode,
    })),
    keyRef: policy.keyRef,
  };
  for (const field of POLICY_FIELDS) {
    normalized[field] = (policy as unknown as Record<string, unknown>)[field];
  }
  if (policy.inlineRiskAuthorizationHash !== undefined) {
    normalized["inlineRiskAuthorizationHash"] = policy.inlineRiskAuthorizationHash;
  }
  return normalized;
}

export type PolicyValidation =
  | { readonly valid: true; readonly policyHash: string }
  | { readonly valid: false; readonly failure: GuardFailure };

function policyDenial(reason: string): PolicyValidation {
  return {
    valid: false,
    failure: { code: "REDACTION_POLICY_INVALID", phase: "policy", reason },
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Semantic policy validation followed by the canonical policy hash.
 *
 * `policyHash = SHA-256(canonical UTF-8 JSON(TaggedDurableJSON(effectivePolicy)))`,
 * emitted as 64 lowercase hexadecimal characters.
 */
export function validateCapturePolicy(policy: CapturePolicy | undefined | null): PolicyValidation {
  if (policy === undefined || policy === null) {
    return {
      valid: false,
      failure: {
        code: "REDACTION_POLICY_REQUIRED",
        phase: "policy",
        reason: "no-capture-policy-resolved",
      },
    };
  }
  if (policy.apiVersion !== CAPTURE_POLICY_API_VERSION) {
    return policyDenial("unknown-capture-policy-version");
  }
  if (policy.redactionTransform !== REDACTION_TRANSFORM) {
    return policyDenial("unknown-redaction-transform");
  }

  const record = policy as unknown as Record<string, unknown>;
  let inlineSelected = false;
  for (const field of POLICY_FIELDS) {
    const modes = POLICY_MODE_VOCABULARY[field] as readonly string[];
    const mode = record[field];
    if (typeof mode !== "string" || !modes.includes(mode)) {
      return policyDenial(`unknown-mode-for-${field}`);
    }
    if (mode === "inline-unredacted") inlineSelected = true;
  }

  const hasInlineAuthorization = policy.inlineRiskAuthorizationHash !== undefined;
  if (hasInlineAuthorization !== inlineSelected) {
    return policyDenial("inlineRiskAuthorizationHash-does-not-match-inline-selection");
  }
  if (hasInlineAuthorization && !SHA256_HEX.test(policy.inlineRiskAuthorizationHash as string)) {
    return policyDenial("inlineRiskAuthorizationHash-is-not-lowercase-sha256");
  }
  if (
    !Number.isInteger(policy.maxDiagnosticUtf8Bytes) ||
    policy.maxDiagnosticUtf8Bytes < 0 ||
    policy.maxDiagnosticUtf8Bytes > SECTION_11_LIMITS.maxDiagnosticUtf8Bytes
  ) {
    return policyDenial("maxDiagnosticUtf8Bytes-out-of-range");
  }
  for (const hash of [policy.transformImplementationHash, policy.ruleRegistryHash]) {
    if (!SHA256_HEX.test(hash)) return policyDenial("policy-hash-field-is-not-lowercase-sha256");
  }
  if (!Number.isSafeInteger(policy.ruleRegistryVersion) || policy.ruleRegistryVersion < 1) {
    return policyDenial("ruleRegistryVersion-is-not-a-positive-safe-integer");
  }

  const rules = policy.redactionRules;
  if (rules.length > CAPTURE_SINK_CLASSES.length) return policyDenial("too-many-redaction-rules");
  const seenSinks = new Set<string>();
  let previousKey: readonly [number, string] | null = null;
  for (const rule of rules) {
    if (rule.apiVersion !== REDACTION_RULE_API_VERSION) {
      return policyDenial("unknown-redaction-rule-version");
    }
    const order = SINK_ORDER.get(rule.sink);
    if (order === undefined) return policyDenial("rule-names-unknown-sink");
    if (seenSinks.has(rule.sink)) return policyDenial("two-rules-for-one-sink");
    seenSinks.add(rule.sink);
    if (rule.registryVersion !== policy.ruleRegistryVersion) {
      return policyDenial("rule-registryVersion-differs-from-policy-snapshot");
    }
    if (rule.paths.length === 0) return policyDenial("rule-has-no-path");
    if (rule.paths.length > SECTION_11_LIMITS.maxPointersPerRule) {
      return policyDenial("rule-exceeds-maxPointersPerRule");
    }
    for (let index = 1; index < rule.paths.length; index += 1) {
      if (
        compareUnicodeCodePoints(rule.paths[index - 1] as string, rule.paths[index] as string) >= 0
      ) {
        return policyDenial("rule-paths-are-not-in-strict-code-point-order");
      }
    }
    for (const pointer of rule.paths) {
      if (utf8ByteLength(pointer) > SECTION_11_LIMITS.maxPointerUtf8Bytes) {
        return policyDenial("rule-pointer-exceeds-maxPointerUtf8Bytes");
      }
      try {
        decodePointer(pointer);
      } catch {
        return policyDenial("rule-pointer-is-not-canonical");
      }
    }
    if (rule.replacementMode !== "remove" && rule.replacementMode !== "constant-token") {
      return policyDenial("unknown-replacement-mode");
    }
    const key = [order, rule.ruleId] as const;
    if (previousKey !== null) {
      const ordered =
        previousKey[0] < key[0] ||
        (previousKey[0] === key[0] && compareUnicodeCodePoints(previousKey[1], key[1]) < 0);
      if (!ordered) return policyDenial("rules-are-not-ordered-by-sink-then-ruleId");
    }
    previousKey = key;

    const controls = sinkRow(rule.sink)?.policyControls ?? [];
    const compatible = controls.some((control) => {
      const mode = record[control];
      return mode === "redacted" || mode === "allow-redacted";
    });
    if (!compatible) return policyDenial("rule-sink-has-no-redacted-control");
  }

  for (const field of POLICY_FIELDS) {
    if (record[field] !== "redacted") continue;
    const covered = rules.some((rule) => sinkRow(rule.sink)?.policyControls.includes(field));
    if (!covered) return policyDenial(`redacted-mode-without-rule-for-${field}`);
  }

  const canonical = canonicalTagged(normalizeCapturePolicy(policy));
  if (utf8ByteLength(canonical) > SECTION_11_LIMITS.maxPolicyUtf8Bytes) {
    return policyDenial("policy-exceeds-maxPolicyUtf8Bytes");
  }
  return { valid: true, policyHash: sha256Hex(canonical) };
}

export function capturePolicyHash(policy: CapturePolicy): string {
  const result = validateCapturePolicy(policy);
  if (!result.valid) throw new Error(`capture policy is invalid: ${result.failure.reason}`);
  return result.policyHash;
}

/** Section 1.2: the effective mode for one policy control. */
export function policyMode(policy: CapturePolicy, control: PolicyControl): string | undefined {
  if (control === "deny") return "deny";
  return (policy as unknown as Record<string, unknown>)[control] as string | undefined;
}

/** Section 4.1: at most one rule per sink. */
export function ruleForSink(
  policy: CapturePolicy,
  sink: CaptureSinkClass,
): RedactionRule | undefined {
  return policy.redactionRules.find((rule) => rule.sink === sink);
}
