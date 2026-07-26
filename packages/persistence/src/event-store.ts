import type { GraphEvent } from "./events.js";

/**
 * Optimistic event stream contract.
 *
 * Version is the last persisted event sequence. An empty run is version -1.
 * Appended sequences begin at expectedVersion + 1, and the returned value is
 * the new last sequence.
 */
export interface EventStore {
  append(runId: string, expectedVersion: number, events: readonly GraphEvent[]): Promise<number>;
  read(runId: string, fromSequence?: number): AsyncIterable<GraphEvent>;
}
