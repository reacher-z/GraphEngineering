/**
 * The authorized read side of the guarded `events/v1alpha2` journal.
 *
 * spec/redaction-semantics.md Section 8.1 step 9: "on recovery, authorize,
 * authenticate, decrypt, decode, recompute the MAC, validate context, and only
 * then expose a detached value to the fold." Section 5.6 repeats it: a
 * successful read authenticates the blob, decodes Tagged Durable JSON,
 * recomputes `valueMac`, and validates the expected logical context before
 * exposing a detached value.
 *
 * This module performs exactly those steps and no repair. Every failure is one
 * of the Section 10 codes — `PROTECTED_PAYLOAD_NOT_FOUND`,
 * `PROTECTED_PAYLOAD_UNAUTHORIZED`, or `PROTECTED_PAYLOAD_CORRUPT` — and none of
 * them ever substitutes null, an empty object, a redaction token, or a stale
 * value. The occurrence AAD is rebuilt from the persisted event envelope rather
 * than stored beside the reference, so copying a blob or reference to another
 * run, revision, event, sequence, record type, node, edge, attempt, or field
 * fails authentication (Section 5.5).
 *
 * The returned value is canonical Tagged Durable JSON *text*. The decoder lives
 * in `@graph-engineering/runtime`, which persistence cannot import; keeping the
 * boundary at the tagged bytes means this module never materializes a decoded
 * application object of its own.
 */

import type { GraphEventV1Alpha2 } from "./events-v1alpha2.js";
import { hmacSha256Hex } from "./redaction/crypto.js";
import { validateProtectedValueRefDocument } from "./redaction/documents.js";
import { encodeDurableJson } from "./redaction/durable-json.js";
import { keyRefHash, type KeyProvider } from "./redaction/key-provider.js";
import { encodePointer } from "./redaction/pointer.js";
import { canonicalJsonString } from "./redaction/portable.js";
import {
  CONTRACT_VERSION_V1ALPHA2,
  DURABLE_CODEC,
  PROTECTED_AAD_API_VERSION,
  PROTECTED_STORE_ENVELOPE_API_VERSION,
  computeAadHash,
  computeAuthorityBindingHash,
  computeTenantScopeHash,
  issueProtectedStoreCapability,
  unprotectValue,
  type AuthorityScope,
  type ProtectedAad,
  type ProtectedPayloadStore,
  type ProtectedValueRef,
  type SemanticContext,
} from "./redaction/protected-store.js";
import type { GuardFailure } from "./redaction/codes.js";

export interface ProtectedEventReaderOptions {
  readonly keys: KeyProvider;
  readonly store: ProtectedPayloadStore;
  readonly scope: AuthorityScope;
  /** The canonical policy hash the run was created under. */
  readonly capturePolicyHash: string;
}

export type ProtectedReadResult =
  | { readonly ok: true; readonly taggedJson: string }
  | { readonly ok: false; readonly failure: GuardFailure };

function failure(
  code: GuardFailure["code"],
  phase: GuardFailure["phase"],
  reason: string,
): { readonly ok: false; readonly failure: GuardFailure } {
  return { ok: false, failure: { code, phase, reason, sink: "event-journal" } };
}

/**
 * Resolve protected references out of a persisted `events/v1alpha2` record.
 *
 * The capability is issued once per reader and is never serializable, so a
 * forged envelope, reference, or decision record cannot manufacture store
 * authority (Section 5.6).
 */
export class ProtectedEventReader {
  readonly #keys: KeyProvider;
  readonly #store: ProtectedPayloadStore;
  readonly #scope: AuthorityScope;
  readonly #capturePolicyHash: string;
  readonly #capability = issueProtectedStoreCapability();

  constructor(options: ProtectedEventReaderOptions) {
    this.#keys = options.keys;
    this.#store = options.store;
    this.#scope = options.scope;
    this.#capturePolicyHash = options.capturePolicyHash;
  }

  get capturePolicyHash(): string {
    return this.#capturePolicyHash;
  }

  /**
   * Rebuild the occurrence-specific associated data for one reference-bearing
   * field of one persisted event. Every component comes from the event envelope
   * itself; nothing is read back from the protected store.
   */
  #aad(event: GraphEventV1Alpha2, field: string, reference: ProtectedValueRef): ProtectedAad {
    const identityKey = this.#keys.runIdentityKey(event.runId);
    const tenantScopeHash = computeTenantScopeHash(identityKey, this.#scope.tenantScopeId);
    return {
      apiVersion: PROTECTED_AAD_API_VERSION,
      contractVersion: CONTRACT_VERSION_V1ALPHA2,
      runId: event.runId,
      graphRevision: event.graphRevision,
      recordKind: "event",
      recordType: event.type,
      ...(event.nodeId === undefined ? {} : { nodeId: event.nodeId }),
      ...(event.edgeId === undefined ? {} : { edgeId: event.edgeId }),
      ...(event.attempt === undefined ? {} : { attempt: event.attempt }),
      eventId: event.eventId,
      sequence: event.sequence,
      fieldPath: encodePointer(["data", field]),
      capturePolicyHash: this.#capturePolicyHash,
      keyRefHash: keyRefHash(this.#keys.keyRef),
      authorityBindingHash: computeAuthorityBindingHash(identityKey, {
        authorityProviderId: this.#scope.authorityProviderId,
        authoritySubjectId: this.#scope.authoritySubjectId,
        tenantScopeHash,
        runId: event.runId,
        capturePolicyHash: this.#capturePolicyHash,
        keyRefHash: keyRefHash(this.#keys.keyRef),
      }),
      tenantScopeHash,
      codec: DURABLE_CODEC,
      valueMac: reference.valueMac,
    };
  }

  /**
   * Authorize, authenticate, decrypt, and validate the semantic context of one
   * protected field. Returns canonical Tagged Durable JSON text or a structured
   * failure; it never returns a partial or substituted value.
   */
  async resolve(
    event: GraphEventV1Alpha2,
    field: string,
    semanticContext: SemanticContext,
  ): Promise<ProtectedReadResult> {
    const candidate = event.data[field];
    const shape = validateProtectedValueRefDocument(candidate);
    if (!shape.valid) {
      return failure("PROTECTED_PAYLOAD_CORRUPT", "classification", shape.reason);
    }
    const reference = candidate as ProtectedValueRef;

    // Section 6.1: the adjacent MAC must equal the referenced object's valueMac.
    const macField = field.endsWith("Ref") ? `${field.slice(0, -3)}Mac` : undefined;
    if (macField !== undefined && event.data[macField] !== reference.valueMac) {
      return failure("PROTECTED_PAYLOAD_CORRUPT", "classification", "adjacent-mac-differs-from-ref");
    }
    if (reference.keyRefHash !== keyRefHash(this.#keys.keyRef)) {
      return failure("PROTECTED_PAYLOAD_UNAUTHORIZED", "policy", "reference-key-authority-differs");
    }

    const aad = this.#aad(event, field, reference);
    if (computeAadHash(aad) !== reference.aadHash) {
      return failure("PROTECTED_PAYLOAD_CORRUPT", "classification", "occurrence-aad-hash-differs");
    }

    const fetched = await this.#store.get(this.#capability, {
      apiVersion: PROTECTED_STORE_ENVELOPE_API_VERSION,
      operationId: `${event.eventId}.${field}.get`,
      operation: "get",
      runId: event.runId,
      capturePolicyHash: this.#capturePolicyHash,
      keyRefHash: keyRefHash(this.#keys.keyRef),
      authorityBindingHash: aad.authorityBindingHash,
      tenantScopeHash: aad.tenantScopeHash,
      protectedValue: reference,
      aad,
    });
    if (!fetched.ok) {
      if (fetched.reason === "unauthorized") {
        return failure("PROTECTED_PAYLOAD_UNAUTHORIZED", "policy", "store-denied-the-read");
      }
      if (fetched.reason === "not-found") {
        return failure("PROTECTED_PAYLOAD_NOT_FOUND", "sink-write", "referenced-blob-is-missing");
      }
      return failure("PROTECTED_PAYLOAD_CORRUPT", "sink-write", fetched.reason);
    }

    const opened = unprotectValue(this.#keys, {
      protectedValue: reference,
      blob: fetched.blob,
      aad,
    });
    if (!opened.ok) {
      return failure("PROTECTED_PAYLOAD_CORRUPT", "protect", opened.reason);
    }

    // Section 5.6: recompute the semantic MAC over the decrypted logical value
    // and validate the expected logical context before exposing the value.
    let tagged: unknown;
    try {
      tagged = JSON.parse(opened.taggedJson);
    } catch {
      return failure("PROTECTED_PAYLOAD_CORRUPT", "encode", "plaintext-is-not-tagged-json");
    }
    const recomputed = hmacSha256Hex(
      this.#keys.runIdentityKey(event.runId),
      // canonicalTagged(["value-mac/v1alpha1", semanticContext, logicalValue]) —
      // the third element is exactly the decrypted tagged encoding, so the MAC is
      // recomputed without decoding the application value here.
      canonicalJsonString([
        "a",
        [
          encodeDurableJson("value-mac/v1alpha1"),
          encodeDurableJson(semanticContext),
          tagged,
        ],
      ]),
    );
    if (recomputed !== reference.valueMac) {
      return failure("PROTECTED_PAYLOAD_CORRUPT", "mac", "semantic-context-or-value-mac-differs");
    }
    return { ok: true, taggedJson: opened.taggedJson };
  }
}
