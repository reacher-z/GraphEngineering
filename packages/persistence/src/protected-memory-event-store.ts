/**
 * The in-memory guarded event journal — the `event-memory` sink of
 * spec/redaction-semantics.md Section 1.2.
 *
 * Section 1.2: "Heap objects and temporary/staging bytes are sinks even when
 * they are never renamed to a final file." An in-memory journal is therefore a
 * sink like any other and gets the same Section 7 treatment as
 * `ProtectedJsonlEventStore`: no raw `append`, the only accepted argument is a
 * `PreparedSinkWrite` this instance is bound to, and the store keeps the exact
 * canonical bytes the guard produced rather than a live object graph.
 */

import {
  CorruptEventLogError,
  PersistenceValidationError,
  VersionConflictError,
} from "./errors.js";
import {
  validateGraphEventV1Alpha2,
  type GraphEventV1Alpha2,
} from "./events-v1alpha2.js";
import { assertSafeIdentifier } from "./identifiers.js";
import { canonicalJson } from "./json.js";
import { GuardBypassError } from "./protected-event-store.js";
import {
  consumePreparedSinkWrite,
  PreparedSinkWrite,
  sha256Hex,
  type CaptureSinkClass,
} from "./redaction/index.js";

export class MemoryProtectedEventStore {
  /** The exact sink class this adapter occupies in the 54-entry inventory. */
  static readonly sink: CaptureSinkClass = "event-memory";

  readonly #records = new Map<string, string[]>();
  readonly #binding: object = Object.freeze({});

  get sink(): CaptureSinkClass {
    return MemoryProtectedEventStore.sink;
  }

  get binding(): object {
    return this.#binding;
  }

  #load(runId: string): GraphEventV1Alpha2[] {
    const lines = this.#records.get(runId) ?? [];
    const events: GraphEventV1Alpha2[] = [];
    let capturePolicyHash: string | undefined;
    for (const [index, line] of lines.entries()) {
      const validation = validateGraphEventV1Alpha2(JSON.parse(line));
      if (!validation.valid) {
        throw new CorruptEventLogError(runId, "record does not match the v1alpha2 envelope", index + 1);
      }
      const event = validation.event;
      if (event.runId !== runId || event.sequence !== index) {
        throw new CorruptEventLogError(runId, "record identity or sequence is inconsistent", index + 1);
      }
      if (sha256Hex(canonicalJson(event.data)) !== event.payloadHash) {
        throw new CorruptEventLogError(runId, "payloadHash does not match data", index + 1);
      }
      capturePolicyHash ??= event.capturePolicyHash;
      if (event.capturePolicyHash !== capturePolicyHash) {
        throw new CorruptEventLogError(runId, "capturePolicyHash changed mid-stream", index + 1);
      }
      events.push(event);
    }
    return events;
  }

  async append(
    runId: string,
    expectedVersion: number,
    writes: readonly PreparedSinkWrite[],
  ): Promise<number> {
    assertSafeIdentifier(runId, "runId");
    if (!Array.isArray(writes) || writes.some((write) => !(write instanceof PreparedSinkWrite))) {
      throw new GuardBypassError("append accepts only prepared sink writes");
    }
    const existing = this.#records.get(runId) ?? [];
    const actualVersion = existing.length - 1;
    if (actualVersion !== expectedVersion) {
      throw new VersionConflictError(runId, expectedVersion, actualVersion);
    }
    if (writes.length === 0) return actualVersion;

    const consumed = writes.map((write) =>
      consumePreparedSinkWrite(write, this.sink, this.#binding),
    );
    const records: string[] = [];
    for (const [index, result] of consumed.entries()) {
      if (!result.ok) throw new GuardBypassError(result.reason);
      const validation = validateGraphEventV1Alpha2(result.record);
      if (!validation.valid) {
        throw new PersistenceValidationError(
          "Prepared record does not match the v1alpha2 envelope",
          validation.issues,
        );
      }
      if (validation.event.runId !== runId) {
        throw new PersistenceValidationError("Prepared record targets another run", [
          { path: "#/runId", message: "does not match the append target" },
        ]);
      }
      if (validation.event.sequence !== expectedVersion + 1 + index) {
        throw new PersistenceValidationError("Prepared record sequence is not contiguous", [
          { path: "#/sequence", message: `expected ${expectedVersion + 1 + index}` },
        ]);
      }
      records.push(result.bytes);
    }
    this.#records.set(runId, [...existing, ...records]);
    return expectedVersion + records.length;
  }

  async *read(runId: string, fromSequence = 0): AsyncIterable<GraphEventV1Alpha2> {
    assertSafeIdentifier(runId, "runId");
    for (const event of this.#load(runId)) {
      if (event.sequence >= fromSequence) yield event;
    }
  }
}
