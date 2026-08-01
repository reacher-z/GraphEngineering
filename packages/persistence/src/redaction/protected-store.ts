/**
 * The protected payload primitive of spec/redaction-semantics.md Section 5.
 *
 * A protected value is encrypted and authenticated and is represented in a sink
 * by a `ProtectedValueRef`. Protection is reversible for an authorized reader,
 * so a protected reference always carries `redacted: false` (Section 2.3).
 *
 * This is the narrow D9 primitive only. It is not a claim that a general
 * ArtifactStore, production tenant storage, retention, distributed worker, or
 * backup contract exists (Section 5.6).
 */

import { createCipheriv, createDecipheriv } from "node:crypto";

import { decodeBase64Url, encodeBase64Url, equalHex, hmacSha256Hex, sha256Hex } from "./crypto.js";
import { canonicalTagged } from "./durable-json.js";
import { GCM_NONCE_BYTES, keyRefHash, type KeyProvider } from "./key-provider.js";
import { SECTION_11_LIMITS } from "./limits.js";
import { canonicalJsonString, utf8ByteLength } from "./portable.js";

export const PROTECTED_VALUE_API_VERSION =
  "graphengineering.reacher-z.github.io/protected-value/v1alpha1" as const;
export const PROTECTED_BLOB_API_VERSION =
  "graphengineering.reacher-z.github.io/protected-blob/v1alpha1" as const;
export const PROTECTED_AAD_API_VERSION =
  "graphengineering.reacher-z.github.io/protected-aad/v1alpha1" as const;
export const PROTECTED_STORE_ENVELOPE_API_VERSION =
  "graphengineering.reacher-z.github.io/protected-store-envelope/v1alpha1" as const;
export const PROTECTED_STORE_CONTRACT = "protected-payload-store/v1alpha1" as const;
export const DURABLE_CODEC = "durable-json/v1alpha1" as const;
export const CONTRACT_VERSION_V1ALPHA2 = "scheduler-recovery/v1alpha2" as const;

const GCM_TAG_BYTES = 16;

export interface ProtectedValueRef {
  readonly apiVersion: typeof PROTECTED_VALUE_API_VERSION;
  readonly ref: string;
  readonly codec: typeof DURABLE_CODEC;
  readonly ciphertextHash: string;
  readonly valueMac: string;
  readonly keyRefHash: string;
  readonly aadHash: string;
}

export interface ProtectedBlob {
  readonly apiVersion: typeof PROTECTED_BLOB_API_VERSION;
  readonly algorithm: "A256GCM";
  readonly nonce: string;
  readonly ciphertext: string;
  readonly tag: string;
}

/** Section 5.4 closed semantic contexts. Optional fields are omitted, never null. */
export type SemanticContext =
  | { readonly kind: "graph-input"; readonly runId: string; readonly graphRevision: number }
  | {
      readonly kind: "node-input" | "node-output" | "node-result";
      readonly runId: string;
      readonly graphRevision: number;
      readonly nodeId: string;
    }
  | { readonly kind: "run-result"; readonly runId: string; readonly graphRevision: number }
  | {
      readonly kind: "diagnostic-evidence";
      readonly runId: string;
      readonly graphRevision: number;
      readonly nodeId: string;
      readonly attempt: number;
      readonly code: string;
    };

export interface ProtectedAad {
  readonly apiVersion: typeof PROTECTED_AAD_API_VERSION;
  readonly contractVersion: typeof CONTRACT_VERSION_V1ALPHA2;
  readonly runId: string;
  readonly graphRevision: number;
  readonly recordKind: "event" | "checkpoint";
  readonly recordType: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly attempt?: number;
  readonly eventId?: string;
  readonly checkpointId?: string;
  readonly sequence: number;
  readonly fieldPath: string;
  readonly capturePolicyHash: string;
  readonly keyRefHash: string;
  readonly authorityBindingHash: string;
  readonly tenantScopeHash: string;
  readonly codec: typeof DURABLE_CODEC;
  readonly valueMac: string;
}

/** Section 5.5 host-supplied opaque scope identifiers. They never appear on wire. */
export interface AuthorityScope {
  readonly tenantScopeId: string;
  readonly authorityProviderId: string;
  readonly authoritySubjectId: string;
}

/** Section 5.4 semantic value MAC — the logical identity used in recovery. */
export function computeValueMac(
  identityKey: Uint8Array,
  semanticContext: SemanticContext,
  logicalValue: unknown,
): string {
  return hmacSha256Hex(
    identityKey,
    canonicalTagged(["value-mac/v1alpha1", semanticContext, logicalValue]),
  );
}

/** Section 5.5 privacy-safe tenant binding. */
export function computeTenantScopeHash(identityKey: Uint8Array, tenantScopeId: string): string {
  return hmacSha256Hex(identityKey, canonicalTagged(["tenant-scope/v1alpha1", tenantScopeId]));
}

/** Section 5.5 privacy-safe authority binding. The input list is closed and ordered. */
export function computeAuthorityBindingHash(
  identityKey: Uint8Array,
  input: {
    readonly authorityProviderId: string;
    readonly authoritySubjectId: string;
    readonly tenantScopeHash: string;
    readonly runId: string;
    readonly capturePolicyHash: string;
    readonly keyRefHash: string;
  },
): string {
  return hmacSha256Hex(
    identityKey,
    canonicalTagged([
      "protected-authority/v1alpha1",
      input.authorityProviderId,
      input.authoritySubjectId,
      input.tenantScopeHash,
      input.runId,
      input.capturePolicyHash,
      input.keyRefHash,
    ]),
  );
}

/** Canonical AAD bytes: canonical UTF-8 JSON of Tagged Durable JSON of the closed object. */
export function aadBytes(aad: ProtectedAad): Buffer {
  return Buffer.from(canonicalTagged(aad), "utf8");
}

export function computeAadHash(aad: ProtectedAad): string {
  return sha256Hex(aadBytes(aad));
}

/** Section 5.2: `ciphertextHash` is SHA-256 of the exact stored protected-blob bytes. */
export function blobBytes(blob: ProtectedBlob): Buffer {
  return Buffer.from(canonicalJsonString(blob), "utf8");
}

export function computeCiphertextHash(blob: ProtectedBlob): string {
  return sha256Hex(blobBytes(blob));
}

/** Section 5.2 semantic blob decode rules, beyond schema length/pattern checks. */
export function validateBlobBytes(blob: ProtectedBlob): string | undefined {
  if (blob.apiVersion !== PROTECTED_BLOB_API_VERSION) return "unknown-protected-blob-version";
  if (blob.algorithm !== "A256GCM") return "unknown-protected-blob-algorithm";
  try {
    if (decodeBase64Url(blob.nonce).length !== GCM_NONCE_BYTES) return "nonce-is-not-twelve-bytes";
    if (decodeBase64Url(blob.tag).length !== GCM_TAG_BYTES) return "tag-is-not-sixteen-bytes";
    const ciphertext = decodeBase64Url(blob.ciphertext);
    if (ciphertext.length < 1) return "ciphertext-is-empty";
    if (ciphertext.length > SECTION_11_LIMITS.maxProtectedValueUtf8Bytes) {
      return "ciphertext-exceeds-maxProtectedValueUtf8Bytes";
    }
  } catch {
    return "non-canonical-base64url";
  }
  return undefined;
}

export interface ProtectedOccurrence {
  readonly runId: string;
  readonly graphRevision: number;
  readonly recordKind: "event" | "checkpoint";
  readonly recordType: string;
  readonly recordId: string;
  readonly sequence: number;
  readonly fieldPath: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly attempt?: number;
}

export interface ProtectionRequest {
  readonly occurrence: ProtectedOccurrence;
  readonly semanticContext: SemanticContext;
  /** The detached immutable snapshot of the logical value. */
  readonly logicalValue: unknown;
  readonly capturePolicyHash: string;
  readonly scope: AuthorityScope;
}

export interface ProtectionResult {
  readonly protectedValue: ProtectedValueRef;
  readonly blob: ProtectedBlob;
  readonly aad: ProtectedAad;
  readonly bytes: Buffer;
}

export class ProtectionError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`protection failed: ${reason}`);
    this.name = "ProtectionError";
    this.reason = reason;
  }
}

function buildAad(
  request: ProtectionRequest,
  valueMac: string,
  hashes: {
    readonly keyRefHash: string;
    readonly authorityBindingHash: string;
    readonly tenantScopeHash: string;
  },
): ProtectedAad {
  const { occurrence } = request;
  const identity =
    occurrence.recordKind === "event"
      ? { eventId: occurrence.recordId }
      : { checkpointId: occurrence.recordId };
  return {
    apiVersion: PROTECTED_AAD_API_VERSION,
    contractVersion: CONTRACT_VERSION_V1ALPHA2,
    runId: occurrence.runId,
    graphRevision: occurrence.graphRevision,
    recordKind: occurrence.recordKind,
    recordType: occurrence.recordType,
    ...(occurrence.nodeId === undefined ? {} : { nodeId: occurrence.nodeId }),
    ...(occurrence.edgeId === undefined ? {} : { edgeId: occurrence.edgeId }),
    ...(occurrence.attempt === undefined ? {} : { attempt: occurrence.attempt }),
    ...identity,
    sequence: occurrence.sequence,
    fieldPath: occurrence.fieldPath,
    capturePolicyHash: request.capturePolicyHash,
    keyRefHash: hashes.keyRefHash,
    authorityBindingHash: hashes.authorityBindingHash,
    tenantScopeHash: hashes.tenantScopeHash,
    codec: DURABLE_CODEC,
    valueMac,
  };
}

/**
 * Section 8.1 order for one authoritative value: encode canonical Tagged Durable
 * JSON, compute its semantic-context `valueMac`, construct occurrence-specific
 * AAD, then protect. Publication is the store's responsibility.
 */
export function protectValue(
  keys: KeyProvider,
  request: ProtectionRequest,
): ProtectionResult {
  const identityKey = keys.runIdentityKey(request.occurrence.runId);
  const plaintext = Buffer.from(canonicalTagged(request.logicalValue), "utf8");
  if (plaintext.byteLength > SECTION_11_LIMITS.maxProtectedValueUtf8Bytes) {
    throw new ProtectionError("value-exceeds-maxProtectedValueUtf8Bytes");
  }
  if (utf8ByteLength(request.occurrence.fieldPath) > SECTION_11_LIMITS.maxRefUtf8Bytes * 8) {
    throw new ProtectionError("fieldPath-exceeds-limit");
  }

  const valueMac = computeValueMac(identityKey, request.semanticContext, request.logicalValue);
  const keyRefDigest = keyRefHash(keys.keyRef);
  const tenantScopeHash = computeTenantScopeHash(identityKey, request.scope.tenantScopeId);
  const authorityBindingHash = computeAuthorityBindingHash(identityKey, {
    authorityProviderId: request.scope.authorityProviderId,
    authoritySubjectId: request.scope.authoritySubjectId,
    tenantScopeHash,
    runId: request.occurrence.runId,
    capturePolicyHash: request.capturePolicyHash,
    keyRefHash: keyRefDigest,
  });

  const aad = buildAad(request, valueMac, {
    keyRefHash: keyRefDigest,
    authorityBindingHash,
    tenantScopeHash,
  });
  const aadHash = computeAadHash(aad);

  const nonce = keys.nonce({ runId: request.occurrence.runId, aadHash });
  if (nonce.length !== GCM_NONCE_BYTES) throw new ProtectionError("nonce-is-not-twelve-bytes");
  const protectionKey = keys.protectionKey(request.occurrence.runId);
  if (protectionKey.length !== 32) throw new ProtectionError("protection-key-is-not-32-bytes");

  const cipher = createCipheriv("aes-256-gcm", protectionKey, nonce);
  cipher.setAAD(aadBytes(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob: ProtectedBlob = {
    apiVersion: PROTECTED_BLOB_API_VERSION,
    algorithm: "A256GCM",
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(ciphertext),
    tag: encodeBase64Url(tag),
  };
  const invalid = validateBlobBytes(blob);
  if (invalid !== undefined) throw new ProtectionError(invalid);

  const bytes = blobBytes(blob);
  const ciphertextHash = sha256Hex(bytes);
  const ref = `pv_${hmacSha256Hex(identityKey, canonicalTagged(["protected-ref/v1alpha1", aadHash, ciphertextHash])).slice(0, 26)}`;
  if (utf8ByteLength(ref) > SECTION_11_LIMITS.maxRefUtf8Bytes) {
    throw new ProtectionError("ref-exceeds-maxRefUtf8Bytes");
  }

  const protectedValue: ProtectedValueRef = {
    apiVersion: PROTECTED_VALUE_API_VERSION,
    ref,
    codec: DURABLE_CODEC,
    ciphertextHash,
    valueMac,
    keyRefHash: keyRefDigest,
    aadHash,
  };
  return { protectedValue, blob, aad, bytes };
}

/**
 * Decrypt one protected occurrence. Section 5.6 requires the read to
 * authenticate the blob, decode Tagged Durable JSON, recompute `valueMac`, and
 * validate the expected logical context before exposing a detached value.
 */
export function unprotectValue(
  keys: KeyProvider,
  input: {
    readonly protectedValue: ProtectedValueRef;
    readonly blob: ProtectedBlob;
    readonly aad: ProtectedAad;
  },
): { readonly ok: true; readonly taggedJson: string } | { readonly ok: false; readonly reason: string } {
  const invalid = validateBlobBytes(input.blob);
  if (invalid !== undefined) return { ok: false, reason: invalid };
  if (!equalHex(computeCiphertextHash(input.blob), input.protectedValue.ciphertextHash)) {
    return { ok: false, reason: "ciphertext-hash-mismatch" };
  }
  if (!equalHex(computeAadHash(input.aad), input.protectedValue.aadHash)) {
    return { ok: false, reason: "aad-hash-mismatch" };
  }
  if (!equalHex(input.aad.valueMac, input.protectedValue.valueMac)) {
    return { ok: false, reason: "value-mac-mismatch" };
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keys.protectionKey(input.aad.runId),
      decodeBase64Url(input.blob.nonce),
    );
    decipher.setAAD(aadBytes(input.aad));
    decipher.setAuthTag(Buffer.from(decodeBase64Url(input.blob.tag)));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(decodeBase64Url(input.blob.ciphertext))),
      decipher.final(),
    ]);
    return { ok: true, taggedJson: plaintext.toString("utf8") };
  } catch {
    return { ok: false, reason: "aead-authentication-failed" };
  }
}

/* -------------------------------------------------------------------------
 * Guarded store envelope and capability
 * ---------------------------------------------------------------------- */

export type ProtectedStoreEnvelope =
  | {
      readonly apiVersion: typeof PROTECTED_STORE_ENVELOPE_API_VERSION;
      readonly operationId: string;
      readonly operation: "put";
      readonly runId: string;
      readonly capturePolicyHash: string;
      readonly keyRefHash: string;
      readonly authorityBindingHash: string;
      readonly tenantScopeHash: string;
      readonly protectedValue: ProtectedValueRef;
      readonly aad: ProtectedAad;
      readonly blob: ProtectedBlob;
    }
  | {
      readonly apiVersion: typeof PROTECTED_STORE_ENVELOPE_API_VERSION;
      readonly operationId: string;
      readonly operation: "get";
      readonly runId: string;
      readonly capturePolicyHash: string;
      readonly keyRefHash: string;
      readonly authorityBindingHash: string;
      readonly tenantScopeHash: string;
      readonly protectedValue: ProtectedValueRef;
      readonly aad: ProtectedAad;
    };

/**
 * Section 5.6: actual put/get/delete authorization is an unforgeable host
 * capability checked at the operation boundary. A serialized envelope,
 * reference, decision record, hash, or graph-supplied object cannot manufacture
 * it, so the capability carries no serializable state at all.
 */
const CAPABILITY_REGISTRY = new WeakSet<object>();

export class ProtectedStoreCapability {
  constructor(token: symbol) {
    if (token !== CAPABILITY_TOKEN) {
      throw new TypeError("ProtectedStoreCapability is host-issued and cannot be constructed");
    }
    CAPABILITY_REGISTRY.add(this);
  }

  toJSON(): never {
    throw new TypeError("ProtectedStoreCapability is not serializable");
  }
}

const CAPABILITY_TOKEN = Symbol("graph-engineering/protected-store-capability");

export function issueProtectedStoreCapability(): ProtectedStoreCapability {
  return new ProtectedStoreCapability(CAPABILITY_TOKEN);
}

export function isProtectedStoreCapability(value: unknown): boolean {
  return typeof value === "object" && value !== null && CAPABILITY_REGISTRY.has(value);
}

export type StorePutResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface ProtectedPayloadStore {
  put(
    capability: ProtectedStoreCapability,
    envelope: Extract<ProtectedStoreEnvelope, { operation: "put" }>,
  ): Promise<StorePutResult>;
  get(
    capability: ProtectedStoreCapability,
    envelope: Extract<ProtectedStoreEnvelope, { operation: "get" }>,
  ): Promise<{ readonly ok: true; readonly blob: ProtectedBlob } | { readonly ok: false; readonly reason: string }>;
}

function validatePutEnvelope(
  envelope: Extract<ProtectedStoreEnvelope, { operation: "put" }>,
): string | undefined {
  if (envelope.apiVersion !== PROTECTED_STORE_ENVELOPE_API_VERSION) return "unknown-envelope-version";
  const { aad, protectedValue, blob } = envelope;
  for (const field of [
    "runId",
    "capturePolicyHash",
    "keyRefHash",
    "authorityBindingHash",
    "tenantScopeHash",
  ] as const) {
    if (envelope[field] !== aad[field]) return `envelope-and-aad-${field}-differ`;
  }
  if (protectedValue.keyRefHash !== aad.keyRefHash) return "reference-and-aad-keyRefHash-differ";
  if (protectedValue.valueMac !== aad.valueMac) return "reference-and-aad-valueMac-differ";
  if (computeCiphertextHash(blob) !== protectedValue.ciphertextHash) {
    return "recomputed-ciphertextHash-differs";
  }
  if (computeAadHash(aad) !== protectedValue.aadHash) return "recomputed-aadHash-differs";
  const invalid = validateBlobBytes(blob);
  if (invalid !== undefined) return invalid;
  if (aad.recordKind === "event" && aad.eventId === undefined) return "event-aad-missing-eventId";
  if (aad.recordKind === "event" && aad.checkpointId !== undefined) {
    return "event-aad-carries-checkpointId";
  }
  if (aad.recordKind === "checkpoint" && aad.checkpointId === undefined) {
    return "checkpoint-aad-missing-checkpointId";
  }
  if (aad.recordKind === "checkpoint" && aad.eventId !== undefined) {
    return "checkpoint-aad-carries-eventId";
  }
  return undefined;
}

/**
 * In-memory protected payload store. It publishes blob bytes atomically (a map
 * insert is atomic), validates safe opaque references and exact ciphertext
 * hashes, returns no value on missing/denied/corrupt data, and never logs
 * request/response bodies, keys, plaintext, or raw provider errors.
 */
export class MemoryProtectedPayloadStore implements ProtectedPayloadStore {
  readonly #blobs = new Map<string, { bytes: Buffer; aadHash: string; operationId: string }>();

  async put(
    capability: ProtectedStoreCapability,
    envelope: Extract<ProtectedStoreEnvelope, { operation: "put" }>,
  ): Promise<StorePutResult> {
    if (!isProtectedStoreCapability(capability)) return { ok: false, reason: "unauthorized" };
    const invalid = validatePutEnvelope(envelope);
    if (invalid !== undefined) return { ok: false, reason: invalid };
    const existing = this.#blobs.get(envelope.protectedValue.ref);
    if (existing !== undefined) {
      // Section 5.6: replay with a byte-identical envelope may receive the prior
      // idempotent result; reuse with any changed field is rejected.
      const same =
        existing.aadHash === envelope.protectedValue.aadHash &&
        existing.bytes.equals(blobBytes(envelope.blob));
      return same ? { ok: true } : { ok: false, reason: "operation-id-reuse-with-changed-field" };
    }
    this.#blobs.set(envelope.protectedValue.ref, {
      bytes: blobBytes(envelope.blob),
      aadHash: envelope.protectedValue.aadHash,
      operationId: envelope.operationId,
    });
    return { ok: true };
  }

  async get(
    capability: ProtectedStoreCapability,
    envelope: Extract<ProtectedStoreEnvelope, { operation: "get" }>,
  ): Promise<{ readonly ok: true; readonly blob: ProtectedBlob } | { readonly ok: false; readonly reason: string }> {
    if (!isProtectedStoreCapability(capability)) return { ok: false, reason: "unauthorized" };
    const stored = this.#blobs.get(envelope.protectedValue.ref);
    if (stored === undefined) return { ok: false, reason: "not-found" };
    if (stored.aadHash !== envelope.protectedValue.aadHash) return { ok: false, reason: "not-found" };
    if (sha256Hex(stored.bytes) !== envelope.protectedValue.ciphertextHash) {
      return { ok: false, reason: "corrupt" };
    }
    return { ok: true, blob: JSON.parse(stored.bytes.toString("utf8")) as ProtectedBlob };
  }

  get size(): number {
    return this.#blobs.size;
  }
}
