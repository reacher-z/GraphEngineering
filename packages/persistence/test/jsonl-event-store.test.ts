import { appendFile, mkdtemp, readFile, readdir, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GRAPH_EVENT_API_VERSION,
  CorruptEventLogError,
  JsonlEventStore,
  VersionConflictError,
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
    data: { sequence },
  };
}

async function collect(iterable: AsyncIterable<GraphEvent>): Promise<GraphEvent[]> {
  const values: GraphEvent[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe("JsonlEventStore", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "graph-engineering-events-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function onlyLogPath(): Promise<string> {
    const names = await readdir(join(directory, "events"));
    expect(names).toHaveLength(1);
    return join(directory, "events", names[0] as string);
  }

  it("survives store restart and preserves inclusive sequence reads", async () => {
    const first = new JsonlEventStore({ directory });
    expect(await first.append("run-restart", -1, [event("run-restart", 0)])).toBe(0);

    const restarted = new JsonlEventStore({ directory });
    expect(await restarted.append("run-restart", 0, [event("run-restart", 1)])).toBe(1);
    expect((await collect(restarted.read("run-restart", 1))).map(({ sequence }) => sequence)).toEqual([1]);
    expect((await readFile(await onlyLogPath(), "utf8")).endsWith("\n")).toBe(true);
  });

  it("serializes concurrent CAS append across store instances in one process", async () => {
    const firstStore = new JsonlEventStore({ directory });
    const secondStore = new JsonlEventStore({ directory });
    const results = await Promise.allSettled([
      firstStore.append("run-race", -1, [event("run-race", 0, "first")]),
      secondStore.append("run-race", -1, [event("run-race", 0, "second")]),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(VersionConflictError) });
    expect(await collect(firstStore.read("run-race"))).toHaveLength(1);
  });

  it("performs an empty CAS without creating a log record", async () => {
    const store = new JsonlEventStore({ directory });
    expect(await store.append("run-empty", -1, [])).toBe(-1);
    expect(await readdir(join(directory, "events"))).toEqual([]);
  });

  it("detects a truncated final record", async () => {
    const store = new JsonlEventStore({ directory });
    await store.append("run-truncated", -1, [event("run-truncated", 0)]);
    const path = await onlyLogPath();
    const size = (await readFile(path)).byteLength;
    await truncate(path, size - 1);
    await expect(collect(store.read("run-truncated"))).rejects.toBeInstanceOf(CorruptEventLogError);
  });

  it("treats an existing zero-byte log as corruption, not an empty stream", async () => {
    const store = new JsonlEventStore({ directory });
    await store.append("run-zero-byte", -1, []);
    await writeFile(store.pathForRun("run-zero-byte"), new Uint8Array());
    await expect(collect(store.read("run-zero-byte"))).rejects.toMatchObject({
      code: "CORRUPT_EVENT_LOG",
    });
  });

  it("detects malformed complete records instead of skipping them", async () => {
    const store = new JsonlEventStore({ directory });
    await store.append("run-corrupt", -1, [event("run-corrupt", 0)]);
    const path = await onlyLogPath();
    await writeFile(path, "not-json\n", "utf8");
    await expect(collect(store.read("run-corrupt"))).rejects.toMatchObject({
      code: "CORRUPT_EVENT_LOG",
      details: expect.objectContaining({ line: 1 }),
    });
  });

  it("detects junk appended after an otherwise durable stream", async () => {
    const store = new JsonlEventStore({ directory });
    await store.append("run-junk", -1, [event("run-junk", 0)]);
    await appendFile(await onlyLogPath(), "{}\n", "utf8");
    await expect(store.append("run-junk", 0, [event("run-junk", 1)])).rejects.toMatchObject({
      code: "CORRUPT_EVENT_LOG",
    });
  });

  it("prioritizes corruption, then CAS, then new event validation", async () => {
    const store = new JsonlEventStore({ directory });
    await store.append("run-priority", -1, [event("run-priority", 0)]);

    await expect(
      store.append("run-priority", -1, [null as unknown as GraphEvent]),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      store.append("run-priority", 0, [null as unknown as GraphEvent]),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });

    await appendFile(await onlyLogPath(), "not-json\n", "utf8");
    await expect(
      store.append("run-priority", -1, [null as unknown as GraphEvent]),
    ).rejects.toMatchObject({ code: "CORRUPT_EVENT_LOG" });
  });

  it("rejects path traversal run IDs before touching disk", async () => {
    const store = new JsonlEventStore({ directory });
    await expect(store.append("../../escape", -1, [])).rejects.toMatchObject({
      code: "UNSAFE_IDENTIFIER",
    });
    await expect(readdir(join(directory, "events"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
