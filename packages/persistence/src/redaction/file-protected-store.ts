/**
 * A local file-backed `ProtectedPayloadStore`.
 *
 * Section 5.6: it authorizes every operation by host capability, atomically
 * publishes private blob bytes, validates safe opaque references and exact
 * ciphertext hashes, returns no value on missing/denied/corrupt data, never logs
 * bodies/keys/plaintext/raw provider errors, and leaves no plaintext temporary
 * file — the temporary file already contains ciphertext, and it is renamed into
 * place only after fsync.
 *
 * Section 13 already states that the current local file store is not
 * authenticated, multi-tenant, symlink-safe, or a distributed lease. This class
 * inherits that non-claim.
 */

import { mkdir, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { sha256Hex } from "./crypto.js";
import {
  blobBytes,
  computeAadHash,
  computeCiphertextHash,
  isProtectedStoreCapability,
  validateBlobBytes,
  type ProtectedBlob,
  type ProtectedStoreCapability,
  type ProtectedStoreEnvelope,
  type ProtectedPayloadStore,
  type StorePutResult,
} from "./protected-store.js";

const SAFE_REF = /^pv_[A-Za-z0-9][A-Za-z0-9._-]{0,124}$/;

function isSafeRef(ref: string): boolean {
  return SAFE_REF.test(ref) && ref !== "pv_." && ref !== "pv_..";
}

export interface FileProtectedPayloadStoreOptions {
  readonly directory: string;
}

export class FileProtectedPayloadStore implements ProtectedPayloadStore {
  readonly #directory: string;
  #counter = 0;

  constructor(options: FileProtectedPayloadStoreOptions) {
    if (
      typeof options !== "object" ||
      options === null ||
      typeof options.directory !== "string" ||
      options.directory.length === 0
    ) {
      throw new TypeError("FileProtectedPayloadStore directory is invalid");
    }
    this.#directory = join(resolve(options.directory), "protected");
  }

  /** Opaque resolved path for diagnostics; a reference is never caller text. */
  get directory(): string {
    return this.#directory;
  }

  #path(ref: string): string {
    // The reference is already a keyed digest with no application-derived text,
    // but it is hashed again so a store path can never be reversed to a ref.
    return join(this.#directory, `${sha256Hex(ref)}.blob`);
  }

  async put(
    capability: ProtectedStoreCapability,
    envelope: Extract<ProtectedStoreEnvelope, { operation: "put" }>,
  ): Promise<StorePutResult> {
    if (!isProtectedStoreCapability(capability)) return { ok: false, reason: "unauthorized" };
    if (!isSafeRef(envelope.protectedValue.ref)) return { ok: false, reason: "unsafe-reference" };
    const invalid = validateBlobBytes(envelope.blob);
    if (invalid !== undefined) return { ok: false, reason: invalid };
    const bytes = blobBytes(envelope.blob);
    if (computeCiphertextHash(envelope.blob) !== envelope.protectedValue.ciphertextHash) {
      return { ok: false, reason: "recomputed-ciphertextHash-differs" };
    }
    if (computeAadHash(envelope.aad) !== envelope.protectedValue.aadHash) {
      return { ok: false, reason: "recomputed-aadHash-differs" };
    }

    const finalPath = this.#path(envelope.protectedValue.ref);
    this.#counter += 1;
    const temporaryPath = `${finalPath}.${process.pid}.${this.#counter}.tmp`;
    try {
      await mkdir(this.#directory, { recursive: true, mode: 0o700 });
      const handle = await open(temporaryPath, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporaryPath, finalPath);
      const directory = await open(this.#directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return { ok: true };
    } catch {
      // Partial bytes are destroyed rather than treated as an orphan.
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      return { ok: false, reason: "atomic-publish-failed" };
    }
  }

  async get(
    capability: ProtectedStoreCapability,
    envelope: Extract<ProtectedStoreEnvelope, { operation: "get" }>,
  ): Promise<{ readonly ok: true; readonly blob: ProtectedBlob } | { readonly ok: false; readonly reason: string }> {
    if (!isProtectedStoreCapability(capability)) return { ok: false, reason: "unauthorized" };
    if (!isSafeRef(envelope.protectedValue.ref)) return { ok: false, reason: "unsafe-reference" };
    try {
      const handle = await open(this.#path(envelope.protectedValue.ref), "r");
      let bytes: Buffer;
      try {
        bytes = await handle.readFile();
      } finally {
        await handle.close();
      }
      if (sha256Hex(bytes) !== envelope.protectedValue.ciphertextHash) {
        return { ok: false, reason: "corrupt" };
      }
      return { ok: true, blob: JSON.parse(bytes.toString("utf8")) as ProtectedBlob };
    } catch {
      return { ok: false, reason: "not-found" };
    }
  }
}
