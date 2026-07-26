import type { EventStore } from "./event-store.js";
import type { GraphEvent } from "./events.js";
import { assertSafeIdentifier } from "./identifiers.js";
import { cloneJson } from "./json.js";
import { prepareAppendRequest, validateAppendEvents, validateReadRequest } from "./store-validation.js";
import { VersionConflictError } from "./errors.js";

export class MemoryEventStore implements EventStore {
  readonly #streams = new Map<string, GraphEvent[]>();

  async append(runId: string, expectedVersion: number, events: readonly GraphEvent[]): Promise<number> {
    const eventSnapshot = prepareAppendRequest(runId, expectedVersion, events);
    const stream = this.#streams.get(runId) ?? [];
    const actualVersion = stream.length - 1;
    if (actualVersion !== expectedVersion) {
      throw new VersionConflictError(runId, expectedVersion, actualVersion);
    }
    validateAppendEvents(runId, expectedVersion, eventSnapshot);
    if (eventSnapshot.length === 0) return actualVersion;
    stream.push(...eventSnapshot.map((event) => cloneJson(event)));
    this.#streams.set(runId, stream);
    return stream.length - 1;
  }

  async *read(runId: string, fromSequence = 0): AsyncIterable<GraphEvent> {
    validateReadRequest(runId, fromSequence);
    // Snapshot before yielding so later appends cannot alter this iteration.
    const snapshot = (this.#streams.get(runId) ?? [])
      .filter((event) => event.sequence >= fromSequence)
      .map((event) => cloneJson(event));
    for (const event of snapshot) yield event;
  }

  /** Last sequence, or -1 for a safe run with no events. */
  version(runId: string): number {
    assertSafeIdentifier(runId, "runId");
    return (this.#streams.get(runId)?.length ?? 0) - 1;
  }
}
