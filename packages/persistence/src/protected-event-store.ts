/**
 * The guarded durable event journal.
 *
 * spec/redaction-semantics.md Section 7: "The default runtime dependency graph
 * exposes only sinks whose public write method accepts a `PreparedSinkWrite`;
 * raw byte/file/network/store primitives are private implementation details and
 * receive only the already prepared bytes."
 *
 * `ProtectedJsonlEventStore` therefore has no raw `append`. The only way to put
 * a byte in the journal is to hand it a `PreparedSinkWrite` that this exact
 * store instance is bound to, which only the guard can mint, and which the store
 * consumes at most once. A serialized guard decision, store envelope, protected
 * ref, or forged structural object reaches nothing.
 */

import { mkdir, open, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  CorruptEventLogError,
  PersistenceError,
  PersistenceIoError,
  PersistenceValidationError,
  VersionConflictError,
} from "./errors.js";
import {
  validateGraphEventV1Alpha2,
  type GraphEventV1Alpha2,
} from "./events-v1alpha2.js";
import { assertSafeIdentifier, identifierHash } from "./identifiers.js";
import { decodeUtf8, isErrno, syncDirectory } from "./io.js";
import { canonicalJson } from "./json.js";
import {
  consumePreparedSinkWrite,
  PreparedSinkWrite,
  sha256Hex,
  type CaptureSinkClass,
  type GuardFailure,
} from "./redaction/index.js";
import { SerialQueue } from "./serial-queue.js";

const PROCESS_EVENT_QUEUE = new SerialQueue();

export interface ProtectedJsonlEventStoreOptions {
  readonly directory: string;
}

export class GuardBypassError extends PersistenceError {
  constructor(reason: string) {
    super("PERSISTENCE_VALIDATION", "Protected event journal refused an unguarded write", {
      reason,
    });
    this.name = "GuardBypassError";
  }
}

export class ProtectedJsonlEventStore {
  /** The exact sink class this adapter occupies in the 54-entry inventory. */
  static readonly sink: CaptureSinkClass = "event-journal";

  readonly #eventsDirectory: string;
  /** Opaque per-instance binding; a prepared write for another store is refused. */
  readonly #binding: object = Object.freeze({});

  constructor(options: ProtectedJsonlEventStoreOptions) {
    if (
      typeof options !== "object" ||
      options === null ||
      typeof options.directory !== "string" ||
      options.directory.length === 0
    ) {
      throw new PersistenceValidationError("ProtectedJsonlEventStore directory is invalid", [
        { path: "#/directory", message: "expected a non-empty string" },
      ]);
    }
    this.#eventsDirectory = join(resolve(options.directory), "events-v1alpha2");
  }

  get sink(): CaptureSinkClass {
    return ProtectedJsonlEventStore.sink;
  }

  /** The binding token to pass to `SinkGuard.prepare`. It carries no state. */
  get binding(): object {
    return this.#binding;
  }

  /** Opaque resolved path for diagnostics; caller text is never a path segment. */
  pathForRun(runId: string): string {
    assertSafeIdentifier(runId, "runId");
    return join(this.#eventsDirectory, `${identifierHash(runId)}.jsonl`);
  }

  async #load(runId: string): Promise<GraphEventV1Alpha2[]> {
    const path = this.pathForRun(runId);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw new PersistenceIoError("read protected event log", path, error);
    }
    if (bytes.byteLength === 0) throw new CorruptEventLogError(runId, "empty event log file");

    let text: string;
    try {
      text = decodeUtf8(bytes);
    } catch {
      throw new CorruptEventLogError(runId, "invalid UTF-8");
    }
    if (!text.endsWith("\n")) throw new CorruptEventLogError(runId, "truncated final record");

    const lines = text.slice(0, -1).split("\n");
    const events: GraphEventV1Alpha2[] = [];
    let capturePolicyHash: string | undefined;
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      if (line.length === 0) throw new CorruptEventLogError(runId, "blank record", lineNumber);
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new CorruptEventLogError(runId, "record is not JSON", lineNumber);
      }
      const validation = validateGraphEventV1Alpha2(value);
      if (!validation.valid) {
        throw new CorruptEventLogError(
          runId,
          `record does not match the v1alpha2 envelope: ${validation.issues[0]?.path ?? "#"}`,
          lineNumber,
        );
      }
      const event = validation.event;
      if (event.runId !== runId) {
        throw new CorruptEventLogError(runId, "record runId does not match file", lineNumber);
      }
      if (event.sequence !== index) {
        throw new CorruptEventLogError(
          runId,
          `expected sequence ${index}, found ${event.sequence}`,
          lineNumber,
        );
      }
      // Section 8.1: payloadHash is SHA-256 of canonical UTF-8 JSON(event.data).
      if (sha256Hex(canonicalJson(event.data)) !== event.payloadHash) {
        throw new CorruptEventLogError(runId, "payloadHash does not match data", lineNumber);
      }
      // Section 6.1: every event's capturePolicyHash must match RunCreated.
      capturePolicyHash ??= event.capturePolicyHash;
      if (event.capturePolicyHash !== capturePolicyHash) {
        throw new CorruptEventLogError(runId, "capturePolicyHash changed mid-stream", lineNumber);
      }
      events.push(event);
    }
    return events;
  }

  /**
   * Append guarded records. The only accepted argument is a list of
   * `PreparedSinkWrite` values this store instance is bound to.
   */
  async append(
    runId: string,
    expectedVersion: number,
    writes: readonly PreparedSinkWrite[],
  ): Promise<number> {
    assertSafeIdentifier(runId, "runId");
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < -1) {
      throw new PersistenceValidationError("expectedVersion is invalid", [
        { path: "#/expectedVersion", message: "expected a safe integer >= -1" },
      ]);
    }
    if (!Array.isArray(writes)) {
      throw new GuardBypassError("append accepts only prepared sink writes");
    }
    for (const write of writes) {
      if (!(write instanceof PreparedSinkWrite)) {
        throw new GuardBypassError("append accepts only prepared sink writes");
      }
    }

    const path = this.pathForRun(runId);
    return PROCESS_EVENT_QUEUE.run(path, async () => {
      try {
        await mkdir(this.#eventsDirectory, { recursive: true, mode: 0o700 });
        const existing = await this.#load(runId);
        const actualVersion = existing.length - 1;
        if (actualVersion !== expectedVersion) {
          throw new VersionConflictError(runId, expectedVersion, actualVersion);
        }
        if (writes.length === 0) return actualVersion;

        // Consume every prepared write before any byte is produced, so a
        // rejected batch leaves the journal untouched as a unit.
        const consumed = writes.map((write) =>
          consumePreparedSinkWrite(write, this.sink, this.#binding),
        );
        for (const result of consumed) {
          if (!result.ok) throw new GuardBypassError(result.reason);
        }

        const records: string[] = [];
        for (const [index, result] of consumed.entries()) {
          if (!result.ok) throw new GuardBypassError("unreachable");
          const validation = validateGraphEventV1Alpha2(result.record);
          if (!validation.valid) {
            throw new PersistenceValidationError(
              "Prepared record does not match the v1alpha2 envelope",
              validation.issues,
            );
          }
          const event = validation.event;
          if (event.runId !== runId) {
            throw new PersistenceValidationError("Prepared record targets another run", [
              { path: "#/runId", message: "does not match the append target" },
            ]);
          }
          if (event.sequence !== expectedVersion + 1 + index) {
            throw new PersistenceValidationError("Prepared record sequence is not contiguous", [
              { path: "#/sequence", message: `expected ${expectedVersion + 1 + index}` },
            ]);
          }
          if (event.payloadHash !== result.payloadHash) {
            throw new PersistenceValidationError("Prepared payload hash was rebound", [
              { path: "#/payloadHash", message: "does not match the guard decision" },
            ]);
          }
          records.push(result.bytes);
        }

        const existed = await stat(path).then(
          () => true,
          (error: unknown) => {
            if (isErrno(error, "ENOENT")) return false;
            throw error;
          },
        );
        const serialized = `${records.join("\n")}\n`;
        const handle = await open(path, "a", 0o600);
        try {
          await handle.writeFile(serialized, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (!existed) await syncDirectory(this.#eventsDirectory);
        return expectedVersion + records.length;
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceIoError("append protected event log", path, error);
      }
    });
  }

  async *read(runId: string, fromSequence = 0): AsyncIterable<GraphEventV1Alpha2> {
    assertSafeIdentifier(runId, "runId");
    if (!Number.isSafeInteger(fromSequence) || fromSequence < 0) {
      throw new PersistenceValidationError("fromSequence is invalid", [
        { path: "#/fromSequence", message: "expected a safe integer >= 0" },
      ]);
    }
    const path = this.pathForRun(runId);
    const snapshot = await PROCESS_EVENT_QUEUE.run(path, async () => {
      try {
        return (await this.#load(runId)).filter((event) => event.sequence >= fromSequence);
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceIoError("read protected event log", path, error);
      }
    });
    for (const event of snapshot) yield event;
  }
}

export type { GuardFailure };
