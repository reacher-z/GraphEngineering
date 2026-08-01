/**
 * The bound redaction receipt of spec/redaction-semantics.md Section 3.3.
 *
 * A receipt is only proof when the guard deterministically replays the transform
 * from the immutable pre-transform snapshot and byte-compares the exact
 * persisted result. A caller-provided boolean or receipt without that comparison
 * is not proof of redaction.
 */

import type { CaptureSinkClass, CaptureSourceClass, GuardFailure } from "./codes.js";
import { hmacSha256Hex } from "./crypto.js";
import { canonicalTagged } from "./durable-json.js";
import type { AuthorityScope } from "./protected-store.js";
import { canonicalJsonString, compareUnicodeCodePoints } from "./portable.js";
import { redactionTransform, type ReplacementMode } from "./pointer.js";
import { ruleSetHash, type CapturePolicy, type RedactionRule } from "./policy.js";
import { SECTION_11_LIMITS, type PortableLimits } from "./limits.js";

export const REDACTION_RECEIPT_API_VERSION =
  "graphengineering.reacher-z.github.io/redaction-receipt/v1alpha2" as const;

/**
 * Section 1.2 row 1 and Sections 2.2/2.3: these eight authoritative classes are
 * "protect, never redact", so no receipt may name one.
 */
export const NEVER_REDACTABLE_SOURCE_CLASSES: readonly string[] = Object.freeze([
  "bound-node-input",
  "checkpoint-state",
  "event-data",
  "graph-input",
  "graph-output",
  "node-output",
  "node-result",
  "run-result",
]);

/** Section 2.3: encryption is never redaction; the protected-store family is excluded. */
export const NEVER_REDACTABLE_SINKS: readonly string[] = Object.freeze([
  "protected-blob-final",
  "protected-blob-memory",
  "protected-blob-temporary",
]);

export interface RedactionReceipt {
  readonly apiVersion: typeof REDACTION_RECEIPT_API_VERSION;
  readonly policyHash: string;
  readonly sourceHash: string;
  readonly resultHash: string;
  readonly ruleSetHash: string;
  readonly transform: "json-pointer-rules/v1alpha2";
  readonly transformImplementationHash: string;
  readonly ruleRegistryHash: string;
  readonly ruleRegistryVersion: number;
  readonly ruleResolutionId: string;
  readonly authorityBindingHash: string;
  readonly tenantScopeHash: string;
  readonly sourceClass: CaptureSourceClass;
  readonly sink: CaptureSinkClass;
  readonly decisionId: string;
  readonly runId: string;
  readonly graphRevision: number;
  readonly occurrenceKind: "event" | "checkpoint" | "sink-write";
  readonly occurrenceId: string;
  readonly occurrenceSequence: number;
  readonly occurredAt: string;
  readonly fieldPath: string;
  readonly paths: readonly string[];
  readonly replacementMode: ReplacementMode;
  readonly count: number;
}

/** Section 3.3 keyed source digest, domain `redaction-source/v1alpha2`. */
export function computeSourceHash(
  identityKey: Uint8Array,
  input: {
    readonly sourceClass: string;
    readonly sink: string;
    readonly fieldPath: string;
    readonly sourceSnapshot: unknown;
  },
): string {
  return hmacSha256Hex(
    identityKey,
    canonicalTagged([
      "redaction-source/v1alpha2",
      input.sourceClass,
      input.sink,
      input.fieldPath,
      input.sourceSnapshot,
    ]),
  );
}

/** Section 3.3 keyed result digest, domain `redaction-result/v1alpha2`. */
export function computeResultHash(
  identityKey: Uint8Array,
  input: {
    readonly sourceClass: string;
    readonly sink: string;
    readonly fieldPath: string;
    readonly result: unknown;
  },
): string {
  return hmacSha256Hex(
    identityKey,
    canonicalTagged([
      "redaction-result/v1alpha2",
      input.sourceClass,
      input.sink,
      input.fieldPath,
      input.result,
    ]),
  );
}

export interface TransformOccurrence {
  readonly decisionId: string;
  readonly runId: string;
  readonly graphRevision: number;
  readonly occurrenceKind: "event" | "checkpoint" | "sink-write";
  readonly occurrenceId: string;
  readonly occurrenceSequence: number;
  readonly occurredAt: string;
  readonly fieldPath: string;
  readonly ruleResolutionId: string;
}

export interface ReceiptRequest {
  readonly identityKey: Uint8Array;
  readonly policy: CapturePolicy;
  readonly policyHash: string;
  readonly rule: RedactionRule;
  readonly sourceClass: CaptureSourceClass;
  readonly sink: CaptureSinkClass;
  readonly occurrence: TransformOccurrence;
  readonly scope: AuthorityScope;
  readonly authorityBindingHash: string;
  readonly tenantScopeHash: string;
  /** The immutable pre-transform snapshot. Never an already-transformed value. */
  readonly sourceSnapshot: unknown;
  readonly limits?: PortableLimits;
}

export type ReceiptResult =
  | {
      readonly valid: true;
      readonly receipt: RedactionReceipt;
      readonly result: unknown;
      readonly canonicalResult: string;
    }
  | { readonly valid: false; readonly failure: GuardFailure };

function denial(code: GuardFailure["code"], reason: string): ReceiptResult {
  return { valid: false, failure: { code, phase: "receipt", reason } };
}

/**
 * Apply the rule to the immutable snapshot, build the receipt, then replay the
 * transform from the same snapshot and byte-compare the canonical result before
 * the write can be authorized (Section 3.3.1 step 6).
 */
export function buildRedactionReceipt(request: ReceiptRequest): ReceiptResult {
  const limits = request.limits ?? SECTION_11_LIMITS;

  if (NEVER_REDACTABLE_SOURCE_CLASSES.includes(request.sourceClass)) {
    return denial("REDACTION_RECEIPT_INVALID", "authoritative-source-class-cannot-be-redacted");
  }
  if (NEVER_REDACTABLE_SINKS.includes(request.sink)) {
    return denial("REDACTION_RECEIPT_INVALID", "protected-store-sink-cannot-carry-a-receipt");
  }
  if (request.rule.sink !== request.sink) {
    return denial("REDACTION_RECEIPT_INVALID", "rule-sink-does-not-match-write-sink");
  }
  if (request.rule.registryVersion !== request.policy.ruleRegistryVersion) {
    return {
      valid: false,
      failure: {
        code: "CAPTURE_POLICY_MISMATCH",
        phase: "receipt",
        reason: "rule-registry-version-changed-during-transform",
      },
    };
  }

  const first = redactionTransform(
    request.sourceSnapshot,
    request.rule.paths,
    request.rule.replacementMode,
    limits,
  );
  if (!first.valid) {
    return { valid: false, failure: { code: first.code, phase: "receipt", reason: first.reason } };
  }

  const paths = [...request.rule.paths];
  for (let index = 1; index < paths.length; index += 1) {
    if (compareUnicodeCodePoints(paths[index - 1] as string, paths[index] as string) >= 0) {
      return denial("REDACTION_RECEIPT_INVALID", "receipt-paths-are-not-in-strict-order");
    }
  }

  const receipt: RedactionReceipt = {
    apiVersion: REDACTION_RECEIPT_API_VERSION,
    policyHash: request.policyHash,
    sourceHash: computeSourceHash(request.identityKey, {
      sourceClass: request.sourceClass,
      sink: request.sink,
      fieldPath: request.occurrence.fieldPath,
      sourceSnapshot: request.sourceSnapshot,
    }),
    resultHash: computeResultHash(request.identityKey, {
      sourceClass: request.sourceClass,
      sink: request.sink,
      fieldPath: request.occurrence.fieldPath,
      result: first.output,
    }),
    ruleSetHash: ruleSetHash([request.rule]),
    transform: "json-pointer-rules/v1alpha2",
    transformImplementationHash: request.policy.transformImplementationHash,
    ruleRegistryHash: request.policy.ruleRegistryHash,
    ruleRegistryVersion: request.policy.ruleRegistryVersion,
    ruleResolutionId: request.occurrence.ruleResolutionId,
    authorityBindingHash: request.authorityBindingHash,
    tenantScopeHash: request.tenantScopeHash,
    sourceClass: request.sourceClass,
    sink: request.sink,
    decisionId: request.occurrence.decisionId,
    runId: request.occurrence.runId,
    graphRevision: request.occurrence.graphRevision,
    occurrenceKind: request.occurrence.occurrenceKind,
    occurrenceId: request.occurrence.occurrenceId,
    occurrenceSequence: request.occurrence.occurrenceSequence,
    occurredAt: request.occurrence.occurredAt,
    fieldPath: request.occurrence.fieldPath,
    paths,
    replacementMode: request.rule.replacementMode,
    count: paths.length,
  };
  if (receipt.count !== receipt.paths.length) {
    return denial("REDACTION_RECEIPT_INVALID", "count-does-not-equal-paths-length");
  }

  // Deterministic replay from the same immutable snapshot, byte-compared.
  const replay = redactionTransform(
    request.sourceSnapshot,
    receipt.paths,
    receipt.replacementMode,
    limits,
  );
  if (!replay.valid) {
    return denial("REDACTION_RECEIPT_INVALID", "replay-denied-after-first-application");
  }
  const canonicalResult = canonicalJsonString(first.output);
  if (canonicalJsonString(replay.output) !== canonicalResult) {
    return denial("REDACTION_RECEIPT_INVALID", "replay-does-not-reproduce-the-candidate");
  }

  return { valid: true, receipt, result: first.output, canonicalResult };
}

/**
 * Verify a claimed receipt against the immutable snapshot and a persisted
 * result. Changing source, result, rule order, registry, transform identity,
 * authority, tenant, sink, occurrence, timestamp, or field path while retaining
 * an old receipt yields `REDACTION_RECEIPT_INVALID`.
 */
export function verifyRedactionReceipt(
  request: ReceiptRequest & { readonly claimed: RedactionReceipt; readonly persistedResult: unknown },
): { readonly valid: true } | { readonly valid: false; readonly failure: GuardFailure } {
  const rebuilt = buildRedactionReceipt(request);
  if (!rebuilt.valid) return rebuilt;
  if (canonicalTagged(rebuilt.receipt) !== canonicalTagged(request.claimed)) {
    return {
      valid: false,
      failure: {
        code: "REDACTION_RECEIPT_INVALID",
        phase: "receipt",
        reason: "receipt-does-not-bind-this-occurrence",
      },
    };
  }
  if (canonicalJsonString(request.persistedResult) !== rebuilt.canonicalResult) {
    return {
      valid: false,
      failure: {
        code: "REDACTION_RECEIPT_INVALID",
        phase: "receipt",
        reason: "persisted-result-differs-from-replay",
      },
    };
  }
  return { valid: true };
}
