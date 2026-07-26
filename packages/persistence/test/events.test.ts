import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GRAPH_EVENT_API_VERSION,
  MemoryEventStore,
  PersistenceValidationError,
  VersionConflictError,
  assertGraphEvent,
  validateGraphEvent,
  type GraphEvent,
} from "../src/index.js";

function event(runId: string, sequence: number, eventId = `evt-${sequence}`): GraphEvent {
  return {
    apiVersion: GRAPH_EVENT_API_VERSION,
    eventId,
    type: sequence === 0 ? "RunCreated" : "NodeSucceeded",
    timestamp: "2026-07-26T00:00:00Z",
    runId,
    graphRevision: 1,
    sequence,
    redacted: true,
    data: { sequence },
  };
}

async function collect(iterable: AsyncIterable<GraphEvent>): Promise<GraphEvent[]> {
  const values: GraphEvent[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe("GraphEvent envelope", () => {
  it("accepts the shared run-created conformance event", () => {
    const path = fileURLToPath(
      new URL("../../../spec/conformance/run-created.event.json", import.meta.url),
    );
    const fixture = JSON.parse(readFileSync(path, "utf8"));
    expect(validateGraphEvent(fixture)).toMatchObject({ valid: true, event: fixture });
    expect(() => assertGraphEvent(fixture)).not.toThrow();
  });

  it("rejects unknown fields, bad timestamps, and non-JSON data", () => {
    const invalid = {
      ...event("run-validation", 0),
      timestamp: "yesterday",
      unexpected: true,
      data: { value: 1n },
    };
    const result = validateGraphEvent(invalid);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["#/unexpected", "#/timestamp", "#/data/value"]),
      );
    }
    expect(() => assertGraphEvent(invalid)).toThrow(PersistenceValidationError);
  });

  it("validates RFC 3339 calendar and clock values instead of only their shape", () => {
    expect(validateGraphEvent({ ...event("run-time", 0), timestamp: "2024-02-29T23:59:59Z" }).valid).toBe(true);
    for (const timestamp of [
      "2026-02-29T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T00:60:00Z",
      "2026-01-01T00:00:60Z",
      "2026-01-01T00:00:00+24:00",
    ]) {
      expect(validateGraphEvent({ ...event("run-time", 0), timestamp }).valid, timestamp).toBe(false);
    }
  });

  it("rejects cyclic event data", () => {
    const data: Record<string, unknown> = {};
    data.self = data;
    expect(validateGraphEvent({ ...event("run-cycle", 0), data }).valid).toBe(false);
  });

  it("rejects event counters outside the cross-runtime safe-integer range", () => {
    expect(
      validateGraphEvent({ ...event("run-large", 0), sequence: Number.MAX_SAFE_INTEGER + 1 }).valid,
    ).toBe(false);
    expect(
      validateGraphEvent({ ...event("run-large", 0), graphRevision: Number.MAX_SAFE_INTEGER + 1 }).valid,
    ).toBe(false);
    expect(
      validateGraphEvent({ ...event("run-large", 0), attempt: Number.MAX_SAFE_INTEGER + 1 }).valid,
    ).toBe(false);
  });
});

describe("MemoryEventStore", () => {
  it("uses last-sequence CAS and inclusive reads", async () => {
    const store = new MemoryEventStore();
    expect(await store.append("run-memory", -1, [event("run-memory", 0)])).toBe(0);
    expect(
      await store.append("run-memory", 0, [event("run-memory", 1), event("run-memory", 2)]),
    ).toBe(2);
    expect((await collect(store.read("run-memory", 1))).map(({ sequence }) => sequence)).toEqual([1, 2]);
    expect(store.version("run-memory")).toBe(2);
  });

  it("allows empty CAS appends without advancing a stream", async () => {
    const store = new MemoryEventStore();
    expect(await store.append("run-empty", -1, [])).toBe(-1);
    await store.append("run-empty", -1, [event("run-empty", 0)]);
    await expect(store.append("run-empty", -1, [])).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      expectedVersion: -1,
      actualVersion: 0,
    });
  });

  it("serializes competing CAS calls so exactly one wins", async () => {
    const store = new MemoryEventStore();
    const results = await Promise.allSettled([
      store.append("run-race", -1, [event("run-race", 0, "first")]),
      store.append("run-race", -1, [event("run-race", 0, "second")]),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(VersionConflictError) });
    expect(await collect(store.read("run-race"))).toHaveLength(1);
  });

  it("validates run IDs, run binding, and contiguous sequences", async () => {
    const store = new MemoryEventStore();
    await expect(store.append("../escape", -1, [])).rejects.toMatchObject({ code: "UNSAFE_IDENTIFIER" });
    await expect(
      store.append(123 as unknown as string, -1, []),
    ).rejects.toMatchObject({ code: "UNSAFE_IDENTIFIER" });
    await expect(store.append("run-a", -1, [event("run-b", 0)])).rejects.toMatchObject({
      code: "PERSISTENCE_VALIDATION",
    });
    await expect(store.append("run-a", -1, [event("run-a", 1)])).rejects.toMatchObject({
      code: "PERSISTENCE_VALIDATION",
    });
    await expect(
      store.append("run-a", -1, null as unknown as readonly GraphEvent[]),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
    await expect(
      store.append("run-a", -1, [null as unknown as GraphEvent]),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
    await expect(
      store.append("run-a", Number.MAX_SAFE_INTEGER + 1, []),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
    await expect(
      collect(store.read("run-a", Number.MAX_SAFE_INTEGER + 1)),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
  });

  it("checks CAS before validating new event envelopes", async () => {
    const store = new MemoryEventStore();
    await store.append("run-priority", -1, [event("run-priority", 0)]);
    await expect(
      store.append("run-priority", -1, [null as unknown as GraphEvent]),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      store.append("run-priority", 0, [null as unknown as GraphEvent]),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
  });
});
