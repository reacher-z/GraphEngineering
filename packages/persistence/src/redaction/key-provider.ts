/**
 * Section 5.3 key provider.
 *
 * For each run the operator-owned provider supplies protection authority, a
 * 32-byte run identity key for HMAC-SHA-256, and a stable key-reference
 * identity. Protection and identity keys must be cryptographically independent
 * and the identity key is stable for the lifetime of the run, including resume
 * and key wrapping rotation.
 *
 * Production key derivation, KMS protocol, hardware boundary, escrow, and
 * rotation schedule are provider responsibilities and are deliberately not
 * defined here. Shared conformance uses an explicit test provider.
 */

import { createHash, randomBytes } from "node:crypto";

import { sha256Hex } from "./crypto.js";
import { canonicalTagged } from "./durable-json.js";

export const PROTECTION_KEY_BYTES = 32;
export const IDENTITY_KEY_BYTES = 32;
export const GCM_NONCE_BYTES = 12;

export interface KeyProvider {
  /** Stable, opaque, non-personal key reference. Never a secret value. */
  readonly keyRef: string;
  /**
   * True only for a clearly named test provider producing fixed conformance
   * vectors. Section 5.2 forbids deterministic nonces anywhere else.
   */
  readonly deterministicNonces: boolean;
  /** 32-byte AES-256-GCM protection key for one run. */
  protectionKey(runId: string): Uint8Array;
  /** 32-byte HMAC-SHA-256 run identity key, stable across resume. */
  runIdentityKey(runId: string): Uint8Array;
  /** A nonce that MUST be unique for a protection key. */
  nonce(context: { readonly runId: string; readonly aadHash: string }): Uint8Array;
}

/** Section 5.1: `keyRefHash = SHA-256(canonicalTagged(["key-ref/v1alpha1", keyRef]))`. */
export function keyRefHash(keyRef: string): string {
  return sha256Hex(canonicalTagged(["key-ref/v1alpha1", keyRef]));
}

function derive(domain: string, runId: string, keyRef: string, bytes: number): Uint8Array {
  const digest = createHash("sha256")
    .update(Buffer.from(canonicalTagged([domain, keyRef, runId]), "utf8"))
    .digest();
  return new Uint8Array(digest.subarray(0, bytes));
}

/**
 * A deterministic test key provider. It exists only so shared conformance can
 * compare exact ciphertext vectors across the TypeScript and Python lanes. It is
 * not a KMS, has no hardware boundary, and MUST NOT be used in production: its
 * keys are a pure function of `(keyRef, runId)` and its nonces are a pure
 * function of the associated data.
 */
export class DeterministicTestKeyProvider implements KeyProvider {
  readonly keyRef: string;
  readonly deterministicNonces = true;

  constructor(keyRef = "test-key-provider/deterministic/v1alpha1") {
    this.keyRef = keyRef;
  }

  protectionKey(runId: string): Uint8Array {
    return derive("test-protection-key/v1alpha1", runId, this.keyRef, PROTECTION_KEY_BYTES);
  }

  runIdentityKey(runId: string): Uint8Array {
    return derive("test-identity-key/v1alpha1", runId, this.keyRef, IDENTITY_KEY_BYTES);
  }

  nonce(context: { readonly runId: string; readonly aadHash: string }): Uint8Array {
    // The AAD is occurrence-specific (Section 5.5), so a distinct occurrence
    // yields a distinct nonce under one protection key.
    return derive(
      `test-nonce/v1alpha1/${context.aadHash}`,
      context.runId,
      this.keyRef,
      GCM_NONCE_BYTES,
    );
  }
}

/**
 * A random-nonce provider wrapper for hosts that supply their own key material.
 * The nonce comes from the platform CSPRNG and is never caller-injected.
 */
export class HostKeyProvider implements KeyProvider {
  readonly keyRef: string;
  readonly deterministicNonces = false;
  readonly #protection: Uint8Array;
  readonly #identity: Uint8Array;

  constructor(options: {
    readonly keyRef: string;
    readonly protectionKey: Uint8Array;
    readonly runIdentityKey: Uint8Array;
  }) {
    if (options.protectionKey.length !== PROTECTION_KEY_BYTES) {
      throw new RangeError("protectionKey must be exactly 32 bytes");
    }
    if (options.runIdentityKey.length !== IDENTITY_KEY_BYTES) {
      throw new RangeError("runIdentityKey must be exactly 32 bytes");
    }
    this.keyRef = options.keyRef;
    this.#protection = Uint8Array.from(options.protectionKey);
    this.#identity = Uint8Array.from(options.runIdentityKey);
  }

  protectionKey(): Uint8Array {
    return this.#protection;
  }

  runIdentityKey(): Uint8Array {
    return this.#identity;
  }

  nonce(): Uint8Array {
    return new Uint8Array(randomBytes(GCM_NONCE_BYTES));
  }
}
