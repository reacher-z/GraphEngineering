import { join, resolve } from "node:path";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import type { EventStore } from "./event-store.js";
import {
  CorruptEventLogError,
  PersistenceError,
  PersistenceIoError,
  PersistenceValidationError,
  VersionConflictError,
} from "./errors.js";
import { assertGraphEvent, type GraphEvent } from "./events.js";
import { assertSafeIdentifier, identifierHash } from "./identifiers.js";
import { decodeUtf8, isErrno, syncDirectory } from "./io.js";
import { canonicalJson, cloneJson } from "./json.js";
import { SerialQueue } from "./serial-queue.js";
import { prepareAppendRequest, validateAppendEvents, validateReadRequest } from "./store-validation.js";

export interface JsonlEventStoreOptions {
  directory: string;
}

const PROCESS_EVENT_QUEUE = new SerialQueue();

export class JsonlEventStore implements EventStore {
  readonly #eventsDirectory: string;

  constructor(options: JsonlEventStoreOptions) {
    if (
      typeof options !== "object" ||
      options === null ||
      typeof options.directory !== "string" ||
      options.directory.length === 0
    ) {
      throw new PersistenceValidationError("JsonlEventStore directory is invalid", [
        { path: "#/directory", message: "expected a non-empty string" },
      ]);
    }
    this.#eventsDirectory = join(resolve(options.directory), "events");
  }

  #path(runId: string): string {
    return this.pathForRun(runId);
  }

  /** Opaque resolved path for diagnostics; caller text is never a path segment. */
  pathForRun(runId: string): string {
    assertSafeIdentifier(runId, "runId");
    return join(this.#eventsDirectory, `${identifierHash(runId)}.jsonl`);
  }

  async #load(runId: string): Promise<GraphEvent[]> {
    const path = this.#path(runId);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return [];
      throw new PersistenceIoError("read event log", path, error);
    }
    if (bytes.byteLength === 0) throw new CorruptEventLogError(runId, "empty event log file");

    let text: string;
    try {
      text = decodeUtf8(bytes);
    } catch {
      throw new CorruptEventLogError(runId, "invalid UTF-8");
    }
    if (!text.endsWith("\n")) {
      throw new CorruptEventLogError(runId, "truncated final record");
    }

    const lines = text.slice(0, -1).split("\n");
    const events: GraphEvent[] = [];
    for (const [index, line] of lines.entries()) {
      const lineNumber = index + 1;
      if (line.length === 0) throw new CorruptEventLogError(runId, "blank record", lineNumber);
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new CorruptEventLogError(runId, "record is not JSON", lineNumber);
      }
      try {
        assertGraphEvent(value);
      } catch (error) {
        throw new CorruptEventLogError(
          runId,
          error instanceof Error ? error.message : "record does not match event schema",
          lineNumber,
        );
      }
      if (value.runId !== runId) {
        throw new CorruptEventLogError(runId, "record runId does not match file", lineNumber);
      }
      if (value.sequence !== index) {
        throw new CorruptEventLogError(
          runId,
          `expected sequence ${index}, found ${value.sequence}`,
          lineNumber,
        );
      }
      events.push(value);
    }
    return events;
  }

  async append(runId: string, expectedVersion: number, events: readonly GraphEvent[]): Promise<number> {
    const eventSnapshot = prepareAppendRequest(runId, expectedVersion, events);
    const path = this.#path(runId);
    return PROCESS_EVENT_QUEUE.run(path, async () => {
      try {
        await mkdir(this.#eventsDirectory, { recursive: true });
        const existing = await this.#load(runId);
        const actualVersion = existing.length - 1;
        if (actualVersion !== expectedVersion) {
          throw new VersionConflictError(runId, expectedVersion, actualVersion);
        }
        validateAppendEvents(runId, expectedVersion, eventSnapshot);
        if (eventSnapshot.length === 0) return actualVersion;

        const existed = await stat(path).then(
          () => true,
          (error: unknown) => {
            if (isErrno(error, "ENOENT")) return false;
            throw error;
          },
        );
        const serialized = `${eventSnapshot.map((event) => canonicalJson(event)).join("\n")}\n`;
        const handle = await open(path, "a", 0o600);
        try {
          await handle.writeFile(serialized, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (!existed) await syncDirectory(this.#eventsDirectory);
        return expectedVersion + eventSnapshot.length;
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceIoError("append event log", path, error);
      }
    });
  }

  async *read(runId: string, fromSequence = 0): AsyncIterable<GraphEvent> {
    validateReadRequest(runId, fromSequence);
    const path = this.#path(runId);
    const snapshot = await PROCESS_EVENT_QUEUE.run(path, async () => {
      try {
        return (await this.#load(runId))
          .filter((event) => event.sequence >= fromSequence)
          .map((event) => cloneJson(event));
      } catch (error) {
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceIoError("read event log", path, error);
      }
    });
    for (const event of snapshot) yield event;
  }
}
