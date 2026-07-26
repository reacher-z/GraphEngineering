import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHECKPOINT_API_VERSION,
  CorruptCheckpointError,
  FileCheckpointStore,
  type StoredCheckpoint,
} from "../src/index.js";

describe("FileCheckpointStore", () => {
  let directory: string;
  const now = () => new Date("2026-07-26T01:02:03.000Z");

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "graph-engineering-checkpoints-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function runDirectory(): Promise<string> {
    const runNames = await readdir(join(directory, "checkpoints"));
    expect(runNames).toHaveLength(1);
    return join(directory, "checkpoints", runNames[0] as string);
  }

  it("atomically saves, hashes, restarts, and loads a checkpoint", async () => {
    const store = new FileCheckpointStore({ directory, now });
    const saved = await store.save({
      runId: "run-checkpoint",
      checkpointId: "after-research",
      sequence: 7,
      state: { completed: ["research"], count: 1 },
    });
    expect(saved).toMatchObject({
      apiVersion: CHECKPOINT_API_VERSION,
      createdAt: "2026-07-26T01:02:03.000Z",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const restarted = new FileCheckpointStore({ directory });
    expect(await restarted.load("run-checkpoint", "after-research")).toEqual(saved);
    const names = await readdir(await runDirectory());
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[a-f0-9]{64}\.checkpoint\.json$/);
  });

  it("matches the shared checkpoint content-hash and round-trip fixture", async () => {
    const fixturePath = fileURLToPath(
      new URL("../../../spec/conformance/checkpoint-basic.json", import.meta.url),
    );
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as StoredCheckpoint;
    const store = new FileCheckpointStore({ directory });
    const saved = await store.save({
      runId: fixture.runId,
      checkpointId: fixture.checkpointId,
      sequence: fixture.sequence,
      createdAt: fixture.createdAt,
      state: fixture.state,
    });
    expect(saved.contentHash).toBe(fixture.contentHash);
    expect(saved).toEqual(fixture);
    expect(await store.load(fixture.runId, fixture.checkpointId)).toEqual(fixture);
  });

  it("replaces a checkpoint through temp+rename without leaving temp files", async () => {
    const store = new FileCheckpointStore({ directory, now });
    const first = await store.save({
      runId: "run-atomic",
      checkpointId: "latest",
      sequence: 1,
      state: { value: "first" },
    });
    const second = await store.save({
      runId: "run-atomic",
      checkpointId: "latest",
      sequence: 2,
      state: { value: "second" },
    });
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(await store.load("run-atomic", "latest")).toEqual(second);
    expect(await readdir(await runDirectory())).toHaveLength(1);
  });

  it("serializes concurrent replacements across store instances in one process", async () => {
    const firstStore = new FileCheckpointStore({ directory, now });
    const secondStore = new FileCheckpointStore({ directory, now });
    const [first, second] = await Promise.all([
      firstStore.save({
        runId: "run-race",
        checkpointId: "latest",
        sequence: 1,
        state: { writer: "first" },
      }),
      secondStore.save({
        runId: "run-race",
        checkpointId: "latest",
        sequence: 2,
        state: { writer: "second" },
      }),
    ]);
    expect(await firstStore.load("run-race", "latest")).toEqual(second);
    expect(first.contentHash).not.toBe(second.contentHash);
    expect(await readdir(await runDirectory())).toHaveLength(1);
  });

  it("lists metadata in sequence then checkpoint-id order", async () => {
    const store = new FileCheckpointStore({ directory, now });
    await store.save({ runId: "run-list", checkpointId: "z", sequence: 2, state: {} });
    await store.save({ runId: "run-list", checkpointId: "b", sequence: 1, state: {} });
    await store.save({ runId: "run-list", checkpointId: "a", sequence: 1, state: {} });
    const listed = await store.list("run-list");
    expect(listed.map(({ checkpointId }) => checkpointId)).toEqual(["a", "b", "z"]);
    expect(listed.every((item) => !("state" in item))).toBe(true);
  });

  it("returns null and an empty list for absent checkpoints", async () => {
    const store = new FileCheckpointStore({ directory });
    expect(await store.load("run-missing", "unknown")).toBeNull();
    expect(await store.list("run-missing")).toEqual([]);
  });

  it("rejects hash-mismatched checkpoint data", async () => {
    const store = new FileCheckpointStore({ directory, now });
    await store.save({ runId: "run-corrupt", checkpointId: "latest", sequence: 1, state: { ok: true } });
    const path = join(await runDirectory(), (await readdir(await runDirectory()))[0] as string);
    const record = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    record.state = { ok: false };
    await writeFile(path, `${JSON.stringify(record)}\n`, "utf8");
    await expect(store.load("run-corrupt", "latest")).rejects.toBeInstanceOf(CorruptCheckpointError);
  });

  it("rejects unsafe IDs and non-portable checkpoint numbers", async () => {
    const store = new FileCheckpointStore({ directory });
    await expect(
      store.save(null as unknown as Parameters<FileCheckpointStore["save"]>[0]),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
    await expect(
      store.save({ runId: "../escape", checkpointId: "latest", sequence: 0, state: {} }),
    ).rejects.toMatchObject({ code: "UNSAFE_IDENTIFIER" });
    await expect(
      store.save({ runId: "run-safe", checkpointId: "../escape", sequence: 0, state: {} }),
    ).rejects.toMatchObject({ code: "UNSAFE_IDENTIFIER" });
    await expect(
      store.save({ runId: "run-safe", checkpointId: "float", sequence: 0, state: { value: 1.5 } }),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
    await expect(
      store.save({
        runId: "run-safe",
        checkpointId: "large",
        sequence: 0,
        state: { value: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
    await expect(
      store.save({
        runId: "run-safe",
        checkpointId: "bad-time",
        sequence: 0,
        createdAt: "2026-02-29T00:00:00Z",
        state: {},
      }),
    ).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION" });
    await expect(
      store.save({
        runId: "run-safe",
        checkpointId: "extra-field",
        sequence: 0,
        state: {},
        contentHash: "caller-must-not-set-this",
      } as unknown as Parameters<FileCheckpointStore["save"]>[0]),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_VALIDATION",
      issues: expect.arrayContaining([expect.objectContaining({ path: "#/contentHash" })]),
    });
  });
});
