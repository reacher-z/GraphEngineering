/**
 * The shared deterministic sink-before-write guard of
 * spec/redaction-semantics.md Section 7.
 *
 * ```text
 * immutable snapshot + portable validation
 *   -> classify field and sink
 *   -> compute keyed semantic identity for authoritative values
 *   -> apply immutable capture policy
 *   -> redact observational derivative OR protect authoritative bytes
 *   -> validate disposition, receipt, refs, and closed sink schema
 *   -> run canary/credential defense-in-depth scan
 *   -> canonicalize and hash the persisted representation
 *   -> write or export
 * ```
 *
 * For every classified source/sink pair the guard is a total host-code function:
 * it returns `suppressed`, a structured failure, or one opaque in-memory
 * `PreparedSinkWrite`. It never throws caller/provider text, never returns a
 * partly transformed object, and never uses `null` as failure.
 */

import type {
  CaptureSinkClass,
  CaptureSourceClass,
  GuardFailure,
  PolicyControl,
  RedactionFailureCode,
} from "./codes.js";
import { sha256Hex } from "./crypto.js";
import {
  checkDispositionFacts,
  metadataOnlyFacts,
  protectedRefFacts,
  redactedFacts,
  type DispositionFacts,
  type PayloadDisposition,
} from "./disposition.js";
import { evaluateFlow, type FlowOutcome } from "./flow.js";
import { keyRefHash, type KeyProvider } from "./key-provider.js";
import { SECTION_11_LIMITS, type PortableLimits } from "./limits.js";
import {
  canonicalJsonString,
  freezePortableJson,
  materializePortableJson,
  PortableJsonError,
  snapshotPortableJson,
} from "./portable.js";
import { decodePointer } from "./pointer.js";
import {
  ruleForSink,
  validateCapturePolicy,
  type CapturePolicy,
} from "./policy.js";
import {
  consumePreparedSinkWrite,
  createPreparedSinkWrite,
  PreparedSinkWrite,
  type ConsumeResult,
} from "./prepared-write.js";
import { buildRedactionReceipt, type RedactionReceipt } from "./receipt.js";
import { SinkCanaryScanner, type SinkScannerOptions } from "./scanner.js";
import {
  computeAuthorityBindingHash,
  computeTenantScopeHash,
  issueProtectedStoreCapability,
  protectValue,
  PROTECTED_BLOB_API_VERSION,
  PROTECTED_STORE_ENVELOPE_API_VERSION,
  PROTECTED_VALUE_API_VERSION,
  type AuthorityScope,
  type ProtectedPayloadStore,
  type ProtectedValueRef,
  type SemanticContext,
} from "./protected-store.js";

export const SINK_GUARD_DECISION_API_VERSION =
  "graphengineering.reacher-z.github.io/sink-guard-decision/v1alpha1" as const;

export type AuthorityClass = "authoritative" | "observational";

/** Section 7 closed metadata-only audit projection. Never a write capability. */
export interface SinkGuardDecision {
  readonly apiVersion: typeof SINK_GUARD_DECISION_API_VERSION;
  readonly decisionId: string;
  readonly sourceClass: CaptureSourceClass;
  readonly sink: CaptureSinkClass;
  readonly authorityClass: AuthorityClass;
  readonly capturePolicyHash: string;
  readonly outcome: FlowOutcome;
  readonly writeAuthorized: boolean;
  readonly preparedPayloadHash?: string;
  readonly protectedRefs?: readonly ProtectedValueRef[];
  readonly redactionReceipt?: RedactionReceipt;
  readonly failureCode?: RedactionFailureCode;
  readonly executorOutcome?: "not-started" | "succeeded" | "failed" | "not-applicable";
  readonly retryDisposition?:
    | "not-applicable"
    | "safe-new-attempt"
    | "in-doubt-effect"
    | "forbidden";
}

/** One authoritative application value bound to the field that will hold its ref. */
export interface GuardPayloadField {
  /** RFC 6901 pointer to the field in the final record that holds the ref. */
  readonly refPath: string;
  /** Optional adjacent `*Mac` field; Section 6.1 requires it to equal `valueMac`. */
  readonly macPath?: string;
  readonly semanticContext: SemanticContext;
  /** The raw application value. It is snapshotted and never serialized inline. */
  readonly value: unknown;
}

export interface GuardOccurrence {
  readonly runId: string;
  readonly graphRevision: number;
  readonly recordKind: "event" | "checkpoint";
  readonly recordType: string;
  readonly recordId: string;
  readonly sequence: number;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly attempt?: number;
}

export interface GuardRequest {
  readonly decisionId: string;
  readonly sourceClass: CaptureSourceClass;
  readonly sink: CaptureSinkClass;
  /** The control the sink row names for this write. */
  readonly policyControl: PolicyControl;
  readonly authorityClass: AuthorityClass;
  /** The closed metadata record. It must contain no application value. */
  readonly metadata: unknown;
  /** Authoritative values to protect. Empty means a metadata-only record. */
  readonly payloads?: readonly GuardPayloadField[];
  readonly occurrence: GuardOccurrence;
  readonly occurredAt: string;
  /**
   * Optional RFC 6901 pointer at which the guard writes the payload hash it
   * computed over the exact persisted `data`. Section 8.1 keeps `payloadHash`
   * byte-level record integrity, never logical replay identity.
   */
  readonly payloadHashPath?: string;
  /**
   * An observational derivative to transform under the sink's redaction rule.
   * Section 3.2 forbids mixing it with protected authoritative refs in one
   * record, so it is only accepted when `payloads` is empty.
   */
  readonly observational?: {
    readonly fieldPath: string;
    readonly value: unknown;
    readonly ruleResolutionId: string;
  };
}

export type GuardResult =
  | { readonly kind: "suppressed"; readonly decision: SinkGuardDecision }
  | { readonly kind: "failed"; readonly decision: SinkGuardDecision; readonly failure: GuardFailure }
  | { readonly kind: "prepared"; readonly decision: SinkGuardDecision; readonly prepared: PreparedSinkWrite };

export interface SinkGuardOptions {
  readonly policy: CapturePolicy;
  readonly keys?: KeyProvider;
  readonly store?: ProtectedPayloadStore;
  readonly scope: AuthorityScope;
  readonly scanner?: SinkScannerOptions;
  readonly limits?: PortableLimits;
}

/**
 * Section 4.1/1.2: a control is "enabled" when its selected mode permits any
 * representation to reach the sink at all. `off`, `codes-only`, and the `deny`
 * pseudo-control are the only disabled modes in the closed vocabulary.
 */
export function controlEnabled(policy: CapturePolicy, control: PolicyControl): boolean {
  if (control === "deny") return false;
  const mode = (policy as unknown as Record<string, unknown>)[control];
  if (typeof mode !== "string") return false;
  return mode !== "off" && mode !== "codes-only";
}

function defineAtPointer(root: unknown, pointer: string, value: unknown): string | undefined {
  let tokens: readonly string[];
  try {
    tokens = decodePointer(pointer);
  } catch {
    return "field-pointer-is-not-canonical";
  }
  let current: unknown = root;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index] as string;
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return "field-pointer-array-token-is-not-canonical";
      const parsed = Number(token);
      if (parsed >= current.length) return "field-pointer-parent-does-not-exist";
      current = current[parsed];
      continue;
    }
    if (typeof current !== "object" || current === null) {
      return "field-pointer-parent-is-not-a-container";
    }
    const record = current as Record<string, unknown>;
    if (!Object.hasOwn(record, token)) return "field-pointer-parent-does-not-exist";
    current = record[token];
  }
  const leaf = tokens[tokens.length - 1] as string;
  if (Array.isArray(current)) return "field-pointer-cannot-address-an-array-element";
  if (typeof current !== "object" || current === null) {
    return "field-pointer-parent-is-not-a-container";
  }
  Object.defineProperty(current as Record<string, unknown>, leaf, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return undefined;
}

/**
 * Section 7.1: the pre-transform snapshot is the only legitimate transform
 * input. A value that already carries a protected reference, a protected blob,
 * or a replacement token produced by the same rule set is refused rather than
 * transformed a second time.
 */
function alreadyTransformed(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "string") {
      if (current === "[REDACTED]") return true;
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (typeof current !== "object" || current === null) continue;
    const record = current as Record<string, unknown>;
    const apiVersion = record["apiVersion"];
    if (apiVersion === PROTECTED_VALUE_API_VERSION || apiVersion === PROTECTED_BLOB_API_VERSION) {
      return true;
    }
    for (const child of Object.values(record)) stack.push(child);
  }
  return false;
}

function failedDecision(
  request: GuardRequest,
  capturePolicyHash: string,
  failure: GuardFailure,
): SinkGuardDecision {
  return {
    apiVersion: SINK_GUARD_DECISION_API_VERSION,
    decisionId: request.decisionId,
    sourceClass: request.sourceClass,
    sink: request.sink,
    authorityClass: request.authorityClass,
    capturePolicyHash,
    outcome: "failed",
    writeAuthorized: false,
    failureCode: failure.code,
    executorOutcome: "not-applicable",
    retryDisposition: "forbidden",
  };
}

export class SinkGuard {
  readonly #policy: CapturePolicy;
  readonly #policyHash: string;
  readonly #keys: KeyProvider | undefined;
  readonly #store: ProtectedPayloadStore | undefined;
  readonly #scope: AuthorityScope;
  readonly #scanner: SinkCanaryScanner;
  readonly #limits: PortableLimits;
  readonly #capability = issueProtectedStoreCapability();
  readonly #policyFailure: GuardFailure | undefined;

  constructor(options: SinkGuardOptions) {
    this.#policy = options.policy;
    const validation = validateCapturePolicy(options.policy);
    this.#policyHash = validation.valid ? validation.policyHash : "";
    this.#policyFailure = validation.valid ? undefined : validation.failure;
    this.#keys = options.keys;
    this.#store = options.store;
    this.#scope = options.scope;
    this.#scanner = new SinkCanaryScanner(options.scanner ?? {});
    this.#limits = options.limits ?? SECTION_11_LIMITS;
  }

  /** The canonical `policyHash`; `RunCreated` records this, never the policy. */
  get capturePolicyHash(): string {
    return this.#policyHash;
  }

  get policy(): CapturePolicy {
    return this.#policy;
  }

  /** Section 4.4: a resume whose policy hash differs is `CAPTURE_POLICY_MISMATCH`. */
  assertPolicyHash(expected: string): GuardFailure | undefined {
    if (expected === this.#policyHash) return undefined;
    return {
      code: "CAPTURE_POLICY_MISMATCH",
      phase: "policy",
      reason: "resume-policy-hash-differs-from-run-created",
    };
  }

  /**
   * Evaluate one classified source/sink pair. Total: it never throws and never
   * returns `null`.
   */
  async prepare(request: GuardRequest, sinkBinding: object): Promise<GuardResult> {
    try {
      return await this.#prepare(request, sinkBinding);
    } catch {
      // Section 7: an internal exception is a structured failure that does not
      // echo the offending value or any provider text.
      const failure: GuardFailure = {
        code: "PAYLOAD_PROTECTION_FAILED",
        phase: "snapshot",
        reason: "internal-guard-failure",
        sink: request.sink,
        sourceClass: request.sourceClass,
        decisionId: request.decisionId,
      };
      return {
        kind: "failed",
        decision: failedDecision(request, this.#policyHash, failure),
        failure,
      };
    }
  }

  #fail(request: GuardRequest, failure: GuardFailure): GuardResult {
    const bound: GuardFailure = {
      ...failure,
      sink: request.sink,
      sourceClass: request.sourceClass,
      decisionId: request.decisionId,
    };
    return {
      kind: "failed",
      decision: failedDecision(request, this.#policyHash, bound),
      failure: bound,
    };
  }

  async #prepare(request: GuardRequest, sinkBinding: object): Promise<GuardResult> {
    if (this.#policyFailure !== undefined) return this.#fail(request, this.#policyFailure);
    const policy = this.#policy;
    const payloads = request.payloads ?? [];

    // --- step 1: immutable snapshot + portable validation -------------------
    let metadataSnapshot: unknown;
    const payloadSnapshots: unknown[] = [];
    try {
      metadataSnapshot = snapshotPortableJson(request.metadata).value;
      for (const field of payloads) {
        const captured = snapshotPortableJson(field.value);
        if (captured.measurement.maxDepth > this.#limits.maxValueDepth) {
          return this.#fail(request, {
            code: "PAYLOAD_PROTECTION_FAILED",
            phase: "snapshot",
            reason: "value-exceeds-maxValueDepth",
          });
        }
        if (captured.measurement.nodes > this.#limits.maxValueNodes) {
          return this.#fail(request, {
            code: "PAYLOAD_PROTECTION_FAILED",
            phase: "snapshot",
            reason: "value-exceeds-maxValueNodes",
          });
        }
        if (captured.measurement.containers > this.#limits.maxContainers) {
          return this.#fail(request, {
            code: "PAYLOAD_PROTECTION_FAILED",
            phase: "snapshot",
            reason: "value-exceeds-maxContainers",
          });
        }
        if (captured.measurement.members > this.#limits.maxObjectMembers) {
          return this.#fail(request, {
            code: "PAYLOAD_PROTECTION_FAILED",
            phase: "snapshot",
            reason: "value-exceeds-maxObjectMembers",
          });
        }
        payloadSnapshots.push(captured.value);
      }
    } catch (error) {
      return this.#fail(request, {
        code: "PAYLOAD_PROTECTION_FAILED",
        phase: "snapshot",
        reason: error instanceof PortableJsonError ? error.reason : "snapshot-failed",
      });
    }

    // Section 7.1: never re-transform or re-protect an already transformed value.
    for (const snapshot of payloadSnapshots) {
      if (alreadyTransformed(snapshot)) {
        return this.#fail(request, {
          code: "PAYLOAD_PROTECTION_FAILED",
          phase: "classification",
          reason: "input-already-carries-a-protected-or-redacted-representation",
        });
      }
    }

    // --- step 2: classify field and sink ------------------------------------
    const flow = evaluateFlow({
      sourceClass: request.sourceClass,
      sink: request.sink,
      policyControl: request.policyControl,
      policyEnabled: this.#policyEnabled(request),
    });
    if (flow.outcome === "failed") {
      return this.#fail(request, {
        code: "REDACTION_POLICY_INVALID",
        phase: "classification",
        reason: "unknown-source-sink-or-control-row",
      });
    }
    if (flow.outcome === "suppressed") {
      return {
        kind: "suppressed",
        decision: {
          apiVersion: SINK_GUARD_DECISION_API_VERSION,
          decisionId: request.decisionId,
          sourceClass: request.sourceClass,
          sink: request.sink,
          authorityClass: request.authorityClass,
          capturePolicyHash: this.#policyHash,
          outcome: "suppressed",
          writeAuthorized: false,
        },
      };
    }

    // Section 4.3: inline capture is never a property of the durable envelope.
    const sinkControls = flow.sinkRow?.policyControls ?? [];
    for (const control of [flow.sourceRow?.policyControl, ...sinkControls]) {
      if (control === undefined || control === "deny") continue;
      if ((policy as unknown as Record<string, unknown>)[control] === "inline-unredacted") {
        return this.#fail(request, {
          code: "INLINE_CAPTURE_NOT_AUTHORIZED",
          phase: "policy",
          reason: "inline-capture-is-not-representable-for-this-sink",
        });
      }
    }

    // --- step 3: representation ---------------------------------------------
    let disposition: DispositionFacts;
    let record: unknown;
    let refs: ProtectedValueRef[] = [];

    if (request.observational !== undefined) {
      if (payloads.length > 0) {
        return this.#fail(request, {
          code: "REDACTION_POLICY_INVALID",
          phase: "classification",
          reason: "one-record-cannot-mix-redacted-and-protected-material",
        });
      }
      const redactedResult = this.#redact(request);
      if ("failure" in redactedResult) return this.#fail(request, redactedResult.failure);
      disposition = redactedFacts(redactedResult.receipt);
      record = materializePortableJson(metadataSnapshot);
      const placed = defineAtPointer(record, request.observational.fieldPath, redactedResult.result);
      if (placed !== undefined) {
        return this.#fail(request, {
          code: "REDACTION_RECEIPT_INVALID",
          phase: "receipt",
          reason: placed,
        });
      }
    } else if (flow.outcome === "metadata-only") {
      if (payloads.length > 0) {
        return this.#fail(request, {
          code: "REDACTION_POLICY_INVALID",
          phase: "classification",
          reason: "metadata-only-record-cannot-carry-an-application-payload",
        });
      }
      disposition = metadataOnlyFacts();
      record = materializePortableJson(metadataSnapshot);
    } else {
      if (payloads.length === 0) {
        // No application payload field was sourced.
        disposition = metadataOnlyFacts();
        record = materializePortableJson(metadataSnapshot);
      } else {
        const protectedResult = await this.#protect(request, payloadSnapshots);
        if ("failure" in protectedResult) return this.#fail(request, protectedResult.failure);
        refs = [...protectedResult.refs];
        disposition = protectedRefFacts();
        record = materializePortableJson(metadataSnapshot);
        for (let index = 0; index < payloads.length; index += 1) {
          const field = payloads[index] as GuardPayloadField;
          const reference = refs[index] as ProtectedValueRef;
          const placedRef = defineAtPointer(record, field.refPath, reference);
          if (placedRef !== undefined) {
            return this.#fail(request, {
              code: "PAYLOAD_PROTECTION_FAILED",
              phase: "canonicalize",
              reason: placedRef,
            });
          }
          if (field.macPath !== undefined) {
            const placedMac = defineAtPointer(record, field.macPath, reference.valueMac);
            if (placedMac !== undefined) {
              return this.#fail(request, {
                code: "PAYLOAD_PROTECTION_FAILED",
                phase: "canonicalize",
                reason: placedMac,
              });
            }
          }
        }
      }
    }

    if (refs.length > this.#limits.maxProtectedRefsPerRecord) {
      return this.#fail(request, {
        code: "PAYLOAD_PROTECTION_FAILED",
        phase: "canonicalize",
        reason: "record-exceeds-maxProtectedRefsPerRecord",
      });
    }

    // --- step 4: validate disposition, receipt, refs -------------------------
    const dispositionCheck = checkDispositionFacts(disposition);
    if (!dispositionCheck.valid) {
      return this.#fail(request, {
        code: "REDACTION_RECEIPT_INVALID",
        phase: "receipt",
        reason: dispositionCheck.reason,
      });
    }

    const finalRecord: Record<string, unknown> = {
      ...(record as Record<string, unknown>),
      redacted: disposition.redacted,
      payloadDisposition: disposition.payloadDisposition,
      ...(disposition.redactionReceipt === undefined
        ? {}
        : { redactionReceipt: disposition.redactionReceipt }),
    };

    // --- step 5: canonicalize and hash --------------------------------------
    let bytes: string;
    let payloadHash: string;
    try {
      const data = finalRecord["data"];
      payloadHash = sha256Hex(canonicalJsonString(data ?? {}));
      if (request.payloadHashPath !== undefined) {
        const placed = defineAtPointer(finalRecord, request.payloadHashPath, payloadHash);
        if (placed !== undefined) {
          return this.#fail(request, {
            code: "PAYLOAD_PROTECTION_FAILED",
            phase: "canonicalize",
            reason: placed,
          });
        }
      }
      bytes = canonicalJsonString(finalRecord);
    } catch {
      return this.#fail(request, {
        code: "PAYLOAD_PROTECTION_FAILED",
        phase: "canonicalize",
        reason: "record-is-not-canonical-json",
      });
    }

    // --- step 6: canary/credential defense-in-depth scan --------------------
    const detected = this.#scanner.scan(bytes, request.sink);
    if (detected !== undefined) return this.#fail(request, detected);

    const decision: SinkGuardDecision = {
      apiVersion: SINK_GUARD_DECISION_API_VERSION,
      decisionId: request.decisionId,
      sourceClass: request.sourceClass,
      sink: request.sink,
      authorityClass: request.authorityClass,
      capturePolicyHash: this.#policyHash,
      outcome: disposition.payloadDisposition as FlowOutcome,
      writeAuthorized: true,
      preparedPayloadHash: payloadHash,
      ...(refs.length > 0 ? { protectedRefs: refs } : {}),
      ...(disposition.redactionReceipt === undefined
        ? {}
        : { redactionReceipt: disposition.redactionReceipt }),
    };

    const prepared = createPreparedSinkWrite({
      sink: request.sink,
      sinkBinding,
      bytes,
      payloadHash,
      capturePolicyHash: this.#policyHash,
      decisionId: request.decisionId,
      payloadDisposition: disposition.payloadDisposition as PayloadDisposition,
      record: freezePortableJson(finalRecord),
    });

    return { kind: "prepared", decision, prepared };
  }

  #policyEnabled(request: GuardRequest): boolean {
    const policy = this.#policy;
    const flow = evaluateFlow({
      sourceClass: request.sourceClass,
      sink: request.sink,
      policyControl: request.policyControl,
      policyEnabled: true,
    });
    const sourceControl = flow.sourceRow?.policyControl;
    if (sourceControl === undefined) return false;
    if (!controlEnabled(policy, sourceControl)) return false;
    for (const control of flow.sinkRow?.policyControls ?? []) {
      if (!controlEnabled(policy, control)) return false;
    }
    return true;
  }

  #redact(
    request: GuardRequest,
  ): { readonly receipt: RedactionReceipt; readonly result: unknown } | { readonly failure: GuardFailure } {
    const observational = request.observational as NonNullable<GuardRequest["observational"]>;
    if (this.#keys === undefined) {
      return {
        failure: {
          code: "PAYLOAD_PROTECTION_REQUIRED",
          phase: "policy",
          reason: "no-key-provider-for-receipt-identity",
        },
      };
    }
    const rule = ruleForSink(this.#policy, request.sink);
    if (rule === undefined) {
      return {
        failure: {
          code: "REDACTION_POLICY_INVALID",
          phase: "policy",
          reason: "redacted-capture-is-not-enabled-for-this-sink",
        },
      };
    }
    let snapshot: unknown;
    try {
      snapshot = snapshotPortableJson(observational.value).value;
    } catch {
      return {
        failure: {
          code: "PAYLOAD_PROTECTION_FAILED",
          phase: "snapshot",
          reason: "observational-snapshot-failed",
        },
      };
    }
    if (alreadyTransformed(snapshot)) {
      return {
        failure: {
          code: "REDACTION_RECEIPT_INVALID",
          phase: "receipt",
          reason: "input-already-carries-a-transformed-representation",
        },
      };
    }

    const identityKey = this.#keys.runIdentityKey(request.occurrence.runId);
    const tenantScopeHash = computeTenantScopeHash(identityKey, this.#scope.tenantScopeId);
    const authorityBindingHash = computeAuthorityBindingHash(identityKey, {
      authorityProviderId: this.#scope.authorityProviderId,
      authoritySubjectId: this.#scope.authoritySubjectId,
      tenantScopeHash,
      runId: request.occurrence.runId,
      capturePolicyHash: this.#policyHash,
      keyRefHash: keyRefHash(this.#keys.keyRef),
    });

    const built = buildRedactionReceipt({
      identityKey,
      policy: this.#policy,
      policyHash: this.#policyHash,
      rule,
      sourceClass: request.sourceClass,
      sink: request.sink,
      occurrence: {
        decisionId: request.decisionId,
        runId: request.occurrence.runId,
        graphRevision: request.occurrence.graphRevision,
        occurrenceKind: "sink-write",
        occurrenceId: request.occurrence.recordId,
        occurrenceSequence: request.occurrence.sequence,
        occurredAt: request.occurredAt,
        fieldPath: observational.fieldPath,
        ruleResolutionId: observational.ruleResolutionId,
      },
      scope: this.#scope,
      authorityBindingHash,
      tenantScopeHash,
      sourceSnapshot: snapshot,
      limits: this.#limits,
    });
    if (!built.valid) return { failure: built.failure };
    return { receipt: built.receipt, result: built.result };
  }

  async #protect(
    request: GuardRequest,
    snapshots: readonly unknown[],
  ): Promise<{ readonly refs: readonly ProtectedValueRef[] } | { readonly failure: GuardFailure }> {
    const keys = this.#keys;
    const store = this.#store;
    if (keys === undefined || store === undefined) {
      return {
        failure: {
          code: "PAYLOAD_PROTECTION_REQUIRED",
          phase: "policy",
          reason: "no-protected-payload-store-or-key-provider-is-configured",
        },
      };
    }
    const payloads = request.payloads ?? [];
    const identityKey = keys.runIdentityKey(request.occurrence.runId);
    const tenantScopeHash = computeTenantScopeHash(identityKey, this.#scope.tenantScopeId);
    const authorityBindingHash = computeAuthorityBindingHash(identityKey, {
      authorityProviderId: this.#scope.authorityProviderId,
      authoritySubjectId: this.#scope.authoritySubjectId,
      tenantScopeHash,
      runId: request.occurrence.runId,
      capturePolicyHash: this.#policyHash,
      keyRefHash: keyRefHash(keys.keyRef),
    });

    const refs: ProtectedValueRef[] = [];
    for (let index = 0; index < payloads.length; index += 1) {
      const field = payloads[index] as GuardPayloadField;
      let protectedResult;
      try {
        protectedResult = protectValue(keys, {
          occurrence: {
            runId: request.occurrence.runId,
            graphRevision: request.occurrence.graphRevision,
            recordKind: request.occurrence.recordKind,
            recordType: request.occurrence.recordType,
            recordId: request.occurrence.recordId,
            sequence: request.occurrence.sequence,
            fieldPath: field.refPath,
            ...(request.occurrence.nodeId === undefined
              ? {}
              : { nodeId: request.occurrence.nodeId }),
            ...(request.occurrence.edgeId === undefined
              ? {}
              : { edgeId: request.occurrence.edgeId }),
            ...(request.occurrence.attempt === undefined
              ? {}
              : { attempt: request.occurrence.attempt }),
          },
          semanticContext: field.semanticContext,
          logicalValue: snapshots[index],
          capturePolicyHash: this.#policyHash,
          scope: this.#scope,
        });
      } catch {
        return {
          failure: {
            code: "PAYLOAD_PROTECTION_FAILED",
            phase: "protect",
            reason: "protection-failed",
          },
        };
      }

      const published = await store.put(this.#capability, {
        apiVersion: PROTECTED_STORE_ENVELOPE_API_VERSION,
        operationId: `${request.decisionId}.${index}`,
        operation: "put",
        runId: request.occurrence.runId,
        capturePolicyHash: this.#policyHash,
        keyRefHash: keyRefHash(keys.keyRef),
        authorityBindingHash,
        tenantScopeHash,
        protectedValue: protectedResult.protectedValue,
        aad: protectedResult.aad,
        blob: protectedResult.blob,
      });
      if (!published.ok) {
        return {
          failure: {
            code: "PAYLOAD_PROTECTION_FAILED",
            phase: "atomic-publish",
            reason: published.reason,
          },
        };
      }
      refs.push(protectedResult.protectedValue);
    }
    return { refs };
  }
}

export { consumePreparedSinkWrite, PreparedSinkWrite, type ConsumeResult };
