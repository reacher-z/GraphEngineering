/**
 * The guarded durable checkpoint sink and its fail-closed writer.
 *
 * spec/redaction-semantics.md Section 7: the default runtime dependency graph
 * exposes only sinks whose public write method accepts a `PreparedSinkWrite`;
 * raw byte/file/store primitives are private implementation details and receive
 * only the already prepared bytes.
 *
 * `GuardedFileCheckpointStore` therefore has no raw `save`. The only way to put
 * a checkpoint byte on disk is to hand it a `PreparedSinkWrite` that this exact
 * store instance is bound to, which only the guard can mint, and which the
 * store consumes at most once — and it consumes the write BEFORE the temporary
 * file is opened, so no byte the guard did not authorize ever exists in a
 * temporary or final file (redaction-semantics.md Section 5.6 / :596).
 *
 * The on-disk layout and atomic-rename discipline mirror `FileCheckpointStore`:
 * `<root>/checkpoints-v1alpha2/<runIdHash>/<checkpointIdHash>.checkpoint.json`,
 * written to an exclusive 0o600 temporary in the same directory, fsynced, then
 * renamed into place, then the directory is fsynced.
 */

import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";

import {
  CorruptCheckpointError,
  PersistenceError,
  PersistenceIoError,
  PersistenceValidationError,
} from "./errors.js";
import { assertSafeIdentifier, identifierHash } from "./identifiers.js";
import { decodeUtf8, isErrno, syncDirectory } from "./io.js";
import {
  canonicalJsonString,
  consumePreparedSinkWrite,
  DEFAULT_CAPTURE_POLICY,
  keyRefHash,
  PreparedSinkWrite,
  prepareProtectedCheckpoint,
  sha256Hex,
  SinkGuard,
  validateCheckpointV1Alpha2Document,
  type AuthorityScope,
  type CapturePolicy,
  type CaptureSinkClass,
  type GuardedCheckpointSink,
  type KeyProvider,
  type ProtectedCheckpointSpec,
  type ProtectedPayloadStore,
  type SinkScannerOptions,
} from "./redaction/index.js";
import { SerialQueue } from "./serial-queue.js";

const PROCESS_GUARDED_CHECKPOINT_QUEUE = new SerialQueue();

/**
 * Section 4.2 fail-closed refusal, the checkpoint analogue of the durable
 * runtime's `PAYLOAD_PROTECTION_REQUIRED`: a guarded checkpoint save that would
 * persist an authoritative application value without a compatible
 * `ProtectedPayloadStore` plus `KeyProvider` — or through anything other than a
 * guard-minted `PreparedSinkWrite` — fails before the first byte, temporary
 * file, or store operation. There is no inline fallback.
 */
export class CheckpointProtectionRequiredError extends PersistenceError {
  constructor(reason: string, details: Readonly<Record<string, unknown>> = {}) {
    super(
      "CHECKPOINT_PROTECTION_REQUIRED",
      "guarded checkpoint persistence requires a protected payload store and key provider",
      { reason, ...details },
    );
    this.name = "CheckpointProtectionRequiredError";
  }
}

export interface CheckpointProtection {
  readonly keys: KeyProvider;
  readonly store: ProtectedPayloadStore;
  readonly scope: AuthorityScope;
  readonly policy?: CapturePolicy;
  readonly scanner?: SinkScannerOptions;
}

/**
 * Section 4.2 for checkpoints: assert the full protection dependency set before
 * any guard construction, byte, temporary file, or executor invocation.
 * Mirrors `assertPayloadProtection` in `@graph-engineering/runtime`.
 */
export function assertCheckpointProtection(
  protection: unknown,
): asserts protection is CheckpointProtection {
  const missing: string[] = [];
  const has = (owner: unknown, ...methods: readonly string[]): boolean =>
    typeof owner === "object" &&
    owner !== null &&
    methods.every((name) => typeof (owner as Record<string, unknown>)[name] === "function");

  if (typeof protection !== "object" || protection === null) {
    missing.push("protection");
  } else {
    const candidate = protection as Record<string, unknown>;
    if (
      !has(candidate["keys"], "protectionKey", "runIdentityKey", "nonce") ||
      typeof (candidate["keys"] as Record<string, unknown> | undefined)?.["keyRef"] !== "string" ||
      ((candidate["keys"] as Record<string, unknown>)["keyRef"] as string).length === 0
    ) {
      missing.push("keys");
    }
    if (!has(candidate["store"], "put", "get")) missing.push("store");
    const scope = candidate["scope"] as Record<string, unknown> | undefined;
    if (
      typeof scope !== "object" ||
      scope === null ||
      typeof scope["tenantScopeId"] !== "string" ||
      typeof scope["authorityProviderId"] !== "string" ||
      typeof scope["authoritySubjectId"] !== "string"
    ) {
      missing.push("scope");
    }
  }
  if (missing.length > 0) {
    throw new CheckpointProtectionRequiredError("missing-protection-dependency", { missing });
  }
  // Section 5.1: a policy naming a different keyRef attests to a key that is
  // not protecting anything.
  const configured = protection as CheckpointProtection;
  if (configured.policy !== undefined && configured.policy.keyRef !== configured.keys.keyRef) {
    throw new CheckpointProtectionRequiredError(
      "capture-policy-keyRef-does-not-match-the-key-provider",
    );
  }
}

/** The persisted `checkpoints/v1alpha2` projection with unresolved refs. */
export type ProtectedCheckpointV1Alpha2 = Readonly<Record<string, unknown>>;

export interface GuardedFileCheckpointStoreOptions {
  readonly directory: string;
}

export class GuardedFileCheckpointStore implements GuardedCheckpointSink {
  /** The exact sink class this adapter occupies in the closed inventory. */
  static readonly sink: CaptureSinkClass = "checkpoint-final";

  readonly #rootDirectory: string;
  /** Opaque per-instance binding; a prepared write for another store is refused. */
  readonly #binding: object = Object.freeze({});

  constructor(options: GuardedFileCheckpointStoreOptions) {
    if (
      typeof options !== "object" ||
      options === null ||
      typeof options.directory !== "string" ||
      options.directory.length === 0
    ) {
      throw new PersistenceValidationError("GuardedFileCheckpointStore directory is invalid", [
        { path: "#/directory", message: "expected a non-empty string" },
      ]);
    }
    this.#rootDirectory = join(resolve(options.directory), "checkpoints-v1alpha2");
  }

  get sink(): CaptureSinkClass {
    return GuardedFileCheckpointStore.sink;
  }

  /** The binding token to pass to `SinkGuard.prepare`. It carries no state. */
  get binding(): object {
    return this.#binding;
  }

  #runDirectory(runId: string): string {
    assertSafeIdentifier(runId, "runId");
    return join(this.#rootDirectory, identifierHash(runId));
  }

  /** Opaque resolved path for diagnostics; identifiers appear only as hashes. */
  pathForCheckpoint(runId: string, checkpointId: string): string {
    assertSafeIdentifier(checkpointId, "checkpointId");
    return join(this.#runDirectory(runId), `${identifierHash(checkpointId)}.checkpoint.json`);
  }

  #validate(record: unknown, source: string): Record<string, unknown> {
    const check = validateCheckpointV1Alpha2Document(record);
    if (!check.valid) {
      throw new PersistenceValidationError("checkpoint is not a valid checkpoints/v1alpha2 projection", [
        { path: `#/${source}`, message: check.reason },
      ]);
    }
    const document = record as Record<string, unknown>;
    // Section 6.2: contentHash is SHA-256 of canonical UTF-8 JSON of the entire
    // closed checkpoint object with only contentHash omitted.
    const { contentHash, ...body } = document;
    if (sha256Hex(canonicalJsonString(body)) !== contentHash) {
      throw new PersistenceValidationError("checkpoint contentHash does not cover the record", [
        { path: "#/contentHash", message: "recomputed content hash differs" },
      ]);
    }
    return document;
  }

  /**
   * Persist one guarded projection. The only accepted argument is a
   * `PreparedSinkWrite` this store instance is bound to; there is no raw
   * checkpoint save. The write is consumed before the temporary file is
   * opened, so a temporary file only ever contains guard-authorized bytes.
   */
  async save(write: PreparedSinkWrite): Promise<ProtectedCheckpointV1Alpha2> {
    if (!(write instanceof PreparedSinkWrite)) {
      throw new CheckpointProtectionRequiredError("save-accepts-only-a-prepared-sink-write");
    }
    const consumed = consumePreparedSinkWrite(write, this.sink, this.#binding);
    if (!consumed.ok) {
      throw new CheckpointProtectionRequiredError(consumed.reason);
    }
    const record = this.#validate(consumed.record, "record");
    if (consumed.bytes !== canonicalJsonString(record)) {
      throw new CheckpointProtectionRequiredError("prepared-bytes-do-not-match-the-record");
    }
    const runId = record["runId"] as string;
    const checkpointId = record["checkpointId"] as string;
    const directory = this.#runDirectory(runId);
    return PROCESS_GUARDED_CHECKPOINT_QUEUE.run(directory, async () => {
      const path = this.pathForCheckpoint(runId, checkpointId);
      let temporary: string | undefined;
      try {
        temporary = join(
          directory,
          `.${identifierHash(checkpointId)}.${process.pid}.${randomUUID()}.tmp`,
        );
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(`${consumed.bytes}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, path);
        await syncDirectory(directory);
        return JSON.parse(consumed.bytes) as ProtectedCheckpointV1Alpha2;
      } catch (error) {
        if (temporary !== undefined) await unlink(temporary).catch(() => undefined);
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceIoError("save protected checkpoint", path, error);
      }
    });
  }

  /**
   * Read back one persisted projection. Protected references are returned
   * unresolved: this path holds no key provider and cannot materialize an
   * application value. Use `ProtectedCheckpointReader` for authorized reads.
   */
  async load(runId: string, checkpointId: string): Promise<ProtectedCheckpointV1Alpha2 | null> {
    assertSafeIdentifier(runId, "runId");
    assertSafeIdentifier(checkpointId, "checkpointId");
    const directory = this.#runDirectory(runId);
    return PROCESS_GUARDED_CHECKPOINT_QUEUE.run(directory, async () => {
      const path = this.pathForCheckpoint(runId, checkpointId);
      let bytes: Uint8Array;
      try {
        bytes = await readFile(path);
      } catch (error) {
        if (isErrno(error, "ENOENT")) return null;
        throw new PersistenceIoError("read protected checkpoint", path, error);
      }
      let text: string;
      try {
        text = decodeUtf8(bytes);
      } catch {
        throw new CorruptCheckpointError(runId, checkpointId, "invalid UTF-8");
      }
      if (!text.endsWith("\n")) {
        throw new CorruptCheckpointError(runId, checkpointId, "truncated record");
      }
      let value: unknown;
      try {
        value = JSON.parse(text.slice(0, -1));
      } catch {
        throw new CorruptCheckpointError(runId, checkpointId, "record is not JSON");
      }
      let record: Record<string, unknown>;
      try {
        record = this.#validate(value, "file");
      } catch (error) {
        const reason =
          error instanceof PersistenceValidationError
            ? (error.issues[0]?.message ?? "invalid projection")
            : "invalid projection";
        throw new CorruptCheckpointError(runId, checkpointId, reason);
      }
      if (record["runId"] !== runId) {
        throw new CorruptCheckpointError(runId, checkpointId, "runId does not match checkpoint directory");
      }
      if (record["checkpointId"] !== checkpointId) {
        throw new CorruptCheckpointError(runId, checkpointId, "checkpointId does not match file");
      }
      return record;
    });
  }
}

export interface ProtectedCheckpointWriterOptions extends CheckpointProtection {}

/**
 * The high-level guarded checkpoint writer.
 *
 * Construction is fail-closed: missing keys, protected store, or authority
 * scope raises `CHECKPOINT_PROTECTION_REQUIRED` before a guard, byte, or file
 * exists (Section 4.2). `save` runs the shared sink-before-write guard and
 * hands the resulting one-shot `PreparedSinkWrite` to the bound store; a guard
 * refusal never leaves a partial record and never falls back to inline capture.
 */
export class ProtectedCheckpointWriter {
  readonly #guard: SinkGuard;
  readonly #keys: KeyProvider;

  constructor(options: ProtectedCheckpointWriterOptions) {
    assertCheckpointProtection(options);
    this.#keys = options.keys;
    this.#guard = new SinkGuard({
      policy: options.policy ?? DEFAULT_CAPTURE_POLICY,
      keys: options.keys,
      store: options.store,
      scope: options.scope,
      ...(options.scanner === undefined ? {} : { scanner: options.scanner }),
    });
  }

  get capturePolicyHash(): string {
    return this.#guard.capturePolicyHash;
  }

  get keyRefHash(): string {
    return keyRefHash(this.#keys.keyRef);
  }

  /** Guard one projection and mint the one-shot write for `sink`. */
  async prepare(sink: GuardedCheckpointSink, spec: ProtectedCheckpointSpec): Promise<PreparedSinkWrite> {
    const result = await prepareProtectedCheckpoint(this.#guard, sink, spec);
    if (result.kind === "prepared") return result.prepared;
    if (result.kind === "suppressed") {
      throw new CheckpointProtectionRequiredError(
        "capture-policy-suppressed-an-authoritative-checkpoint",
      );
    }
    const { code, phase, reason } = result.failure;
    if (code === "PAYLOAD_PROTECTION_REQUIRED" || code === "INLINE_CAPTURE_NOT_AUTHORIZED") {
      throw new CheckpointProtectionRequiredError(reason, { failureCode: code, phase });
    }
    throw new PersistenceValidationError("guarded checkpoint preparation failed", [
      { path: "#/checkpoint", message: `${code}:${phase}:${reason}` },
    ]);
  }

  /** Guard and persist one projection through the bound store. */
  async save(
    store: GuardedFileCheckpointStore,
    spec: ProtectedCheckpointSpec,
  ): Promise<ProtectedCheckpointV1Alpha2> {
    return store.save(await this.prepare(store, spec));
  }
}
