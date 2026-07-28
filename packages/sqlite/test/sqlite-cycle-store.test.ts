import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalSerialize } from "@graph-engineering/core";
import {
  CYCLE_STORE_CURSOR_TTL_MS,
  CycleStoreProviderError,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  type CycleStoreAuthorizationContext,
  type CycleStoreLease,
  type CycleStoreMutationContext,
  type CycleStoreRecord,
  type CycleStoreTail,
} from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SQLiteCycleStoreProvider } from "../src/sqlite-cycle-store.js";

const AUTH: CycleStoreAuthorizationContext = Object.freeze({
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const AUTH_B: CycleStoreAuthorizationContext = Object.freeze({
  tenantId: "tenant-b",
  principalHash: "c".repeat(64),
  authorizationHash: "d".repeat(64),
});
const MISSING: CycleStoreTail = Object.freeze({
  exists: false,
  sequence: -1,
  recordHash: null,
});

const temporaryRoots: string[] = [];

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-provider-"));
  temporaryRoots.push(root);
  return join(root, "cycle-store.db");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function mutation(operationId: string, auth = AUTH): CycleStoreMutationContext {
  return Object.freeze({ ...auth, operationId });
}

function binding(lease: CycleStoreLease) {
  return Object.freeze({
    leaseId: lease.leaseId,
    holderId: lease.holderId,
    fencingToken: lease.fencingToken,
  });
}

function records(
  count: number,
  prefix = "record",
  startSequence = 0,
  previousRecordHash: string | null = null,
): CycleStoreRecord[] {
  const result: CycleStoreRecord[] = [];
  let previous = previousRecordHash;
  for (let offset = 0; offset < count; offset += 1) {
    const sequence = startSequence + offset;
    const record = createCycleStoreRecord({
      recordId: `${prefix}-${sequence}`,
      sequence,
      previousRecordHash: previous,
      value: { sequence, source: prefix },
    });
    result.push(record);
    previous = record.recordHash;
  }
  return result;
}

async function createStream(
  provider: SQLiteCycleStoreProvider,
  streamId = "stream-a",
  auth = AUTH,
  count = 1,
): Promise<readonly CycleStoreRecord[]> {
  const batch = records(count, `${auth.tenantId}-${streamId}`);
  await provider.append({
    context: mutation(`create-${auth.tenantId}-${streamId}`, auth),
    streamId,
    expectedTail: MISSING,
    lease: null,
    records: batch,
  });
  return batch;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<CycleStoreProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe(code);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code}`);
}

describe("SQLiteCycleStoreProvider durability and append", () => {
  it("uses SQLite UTC time by default while preserving the explicit deterministic test clock", async () => {
    const path = databasePath();
    const realBeforeMs = Date.now();
    let provider: SQLiteCycleStoreProvider | undefined;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2001-02-03T04:05:06.007Z"));
    try {
      provider = new SQLiteCycleStoreProvider(path);
      await createStream(provider);
      const lease = await provider.acquireLease({
        context: mutation("default-sqlite-clock"), streamId: "stream-a",
        leaseId: "default-clock-lease", holderId: "holder-a", ttlMs: 1_000,
        mode: "acquire", expectedFencingToken: 0,
      });
      expect(Date.parse(lease.acquiredAt)).toBeGreaterThanOrEqual(realBeforeMs - 5_000);
      expect(Date.parse(lease.acquiredAt)).toBeLessThan(realBeforeMs + 60_000);
      provider.close();
      provider = undefined;

      const database = new DatabaseSync(path, { readOnly: true });
      try {
        const row = database.prepare(
          "SELECT latest_migration_applied_at_ms AS appliedAtMs "
            + "FROM ge_cycle_schema WHERE singleton = 1",
        ).get() as { appliedAtMs: number };
        expect(Number(row.appliedAtMs)).toBeGreaterThanOrEqual(realBeforeMs - 5_000);
      } finally {
        database.close();
      }
    } finally {
      provider?.close();
      vi.useRealTimers();
    }

    const deterministic = new SQLiteCycleStoreProvider(databasePath(), {
      now: () => new Date("2026-07-27T12:34:56.789Z"),
    });
    try {
      await createStream(deterministic);
      const lease = await deterministic.acquireLease({
        context: mutation("deterministic-clock"), streamId: "stream-a",
        leaseId: "deterministic-lease", holderId: "holder-a", ttlMs: 1_000,
        mode: "acquire", expectedFencingToken: 0,
      });
      expect(lease.acquiredAt).toBe("2026-07-27T12:34:56.789Z");
      expect(lease.expiresAt).toBe("2026-07-27T12:34:57.789Z");
    } finally {
      deterministic.close();
    }
  });

  it("bootstraps the canonical schema and restores events after restart", async () => {
    const path = databasePath();
    let now = Date.parse("2026-07-27T00:00:00Z");
    const first = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    const batch = records(3);
    try {
      expect((await first.describe()).capabilities.durability).toBe("durable");
      expect(await first.inspectSchema(AUTH)).toMatchObject({
        schemaVersion: 1,
        minReaderVersion: 1,
        maxWriterVersion: 1,
        migrationLock: null,
      });
      await first.append({
        context: mutation("append-a"), streamId: "stream-a", expectedTail: MISSING,
        lease: null, records: batch,
      });
    } finally {
      first.close();
    }

    now += 1;
    const second = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    try {
      expect(await second.readTail({ context: AUTH, streamId: "stream-a" })).toEqual({
        exists: true, sequence: 2, recordHash: batch[2]!.recordHash,
      });
      const page = await second.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 10, cursor: null,
      });
      expect(page.records).toEqual(batch);
      expect(page.nextCursor).toBeNull();
    } finally {
      second.close();
    }
  });

  it("captures before asynchronous authorization and detaches caller values", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const provider = new SQLiteCycleStoreProvider(databasePath(), {
      now: () => new Date("2026-07-27T00:00:00Z"),
      authorize: async () => {
        await gate;
        return true;
      },
    });
    const original = records(1, "captured")[0]!;
    const callerRecords = [original];
    try {
      const pending = provider.append({
        context: mutation("captured"), streamId: "stream-a", expectedTail: MISSING,
        lease: null, records: callerRecords,
      });
      callerRecords[0] = createCycleStoreRecord({
        recordId: "hostile", sequence: 0, previousRecordHash: null,
        value: { sentinel: "MUST_NOT_COMMIT" },
      });
      release();
      await pending;
      const page = await provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
      });
      expect(page.records[0]!.recordHash).toBe(original.recordHash);
      expect(JSON.stringify(page)).not.toContain("MUST_NOT_COMMIT");
    } finally {
      provider.close();
    }
  });

  it("replays the durable operation ledger and rejects drift after restart", async () => {
    const path = databasePath();
    const batch = records(1);
    const request = {
      context: mutation("append-once"), streamId: "stream-a", expectedTail: MISSING,
      lease: null, records: batch,
    } as const;
    const first = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00Z"),
    });
    const result = await first.append(request);
    first.close();

    const second = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:01Z"),
    });
    try {
      expect(await second.append(request)).toEqual(result);
      await expectCode(second.append({
        ...request,
        records: [createCycleStoreRecord({
          recordId: "changed", sequence: 0, previousRecordHash: null, value: { changed: true },
        })],
      }), "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT");
      const page = await second.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 10, cursor: null,
      });
      expect(page.records).toHaveLength(1);
    } finally {
      second.close();
    }
  });

  it("fails closed on stored record, checkpoint, and ledger hash drift", async () => {
    const path = databasePath();
    const first = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00Z"),
    });
    const batch = await createStream(first);
    const checkpoint = createCycleStoreCheckpoint({
      checkpointScope: "scope-a", checkpointId: "checkpoint-a", streamId: "stream-a",
      boundSequence: 0, boundRecordHash: batch[0]!.recordHash,
      createdAt: "2026-07-27T00:00:01Z", value: { state: "valid" },
    });
    await first.saveCheckpoint({
      context: mutation("save-corruption-target"), checkpoint, lease: null,
    });
    first.close();

    const database = new DatabaseSync(path);
    try {
      database.prepare(`
        UPDATE ge_cycle_records SET record_blob = ?
        WHERE tenant_id = ? AND stream_id = ? AND sequence = 0
      `).run(Buffer.from(canonicalSerialize({
        ...batch[0], value: { state: "tampered-record-payload" },
      })), AUTH.tenantId, "stream-a");
      database.prepare(`
        UPDATE ge_cycle_checkpoints SET checkpoint_blob = ?
        WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
      `).run(Buffer.from(canonicalSerialize({
        ...checkpoint, value: { state: "tampered-checkpoint-payload" },
      })), AUTH.tenantId, "scope-a", "checkpoint-a");
      database.prepare(`
        UPDATE ge_cycle_operations SET result_hash = ?
        WHERE tenant_id = ? AND operation_id = ?
      `).run("f".repeat(64), AUTH.tenantId, "create-tenant-a-stream-a");
    } finally {
      database.close();
    }

    const second = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:01Z"),
    });
    try {
      await expectCode(second.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
      }), "GE_CYCLE_STORE_CORRUPTION");
      await expectCode(second.loadCheckpoint({
        context: AUTH, checkpointScope: "scope-a", checkpointId: "checkpoint-a",
      }), "GE_CYCLE_STORE_CORRUPTION");
      await expectCode(second.append({
        context: mutation("create-tenant-a-stream-a"), streamId: "stream-a",
        expectedTail: MISSING, lease: null, records: batch,
      }), "GE_CYCLE_STORE_CORRUPTION");
    } finally {
      second.close();
    }
  });

  it("rolls back before commit and replays safely after acknowledgement loss", async () => {
    let fault: "none" | "before" | "after" = "none";
    const provider = new SQLiteCycleStoreProvider(databasePath(), {
      now: () => new Date("2026-07-27T00:00:00Z"),
      faultHook: (boundary) => {
        if (fault === "before" && boundary === "provider:append:before-commit") {
          fault = "none";
          throw new Error("secret-before-sentinel");
        }
        if (fault === "after" && boundary === "provider:append:after-commit-before-return") {
          fault = "none";
          throw new Error("secret-after-sentinel");
        }
      },
    });
    const beforeRequest = {
      context: mutation("fault-before"), streamId: "before", expectedTail: MISSING,
      lease: null, records: records(1, "before"),
    } as const;
    const afterRequest = {
      context: mutation("fault-after"), streamId: "after", expectedTail: MISSING,
      lease: null, records: records(1, "after"),
    } as const;
    try {
      fault = "before";
      const beforeError = await expectCode(
        provider.append(beforeRequest),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
      expect(JSON.stringify(beforeError)).not.toContain("secret-before-sentinel");
      expect(await provider.readTail({ context: AUTH, streamId: "before" })).toEqual(MISSING);
      const recovered = await provider.append(beforeRequest);
      expect(recovered.appendedRecords).toBe(1);

      fault = "after";
      const afterError = await expectCode(
        provider.append(afterRequest),
        "GE_CYCLE_STORE_UNAVAILABLE",
      );
      expect(JSON.stringify(afterError)).not.toContain("secret-after-sentinel");
      expect((await provider.readTail({ context: AUTH, streamId: "after" })).exists).toBe(true);
      expect(await provider.append(afterRequest)).toMatchObject({ appendedRecords: 1 });
      const page = await provider.readEventPage({
        context: AUTH, streamId: "after", fromSequence: 0, pageSize: 10, cursor: null,
      });
      expect(page.records).toHaveLength(1);
    } finally {
      provider.close();
    }
  });

  it("rejects asynchronous fault hooks without awaiting inside the transaction", async () => {
    const provider = new SQLiteCycleStoreProvider(databasePath(), {
      now: () => new Date("2026-07-27T00:00:00Z"),
      faultHook: (boundary) => boundary === "provider:append:before-commit"
        ? Promise.resolve()
        : undefined,
    });
    try {
      await expectCode(provider.append({
        context: mutation("async-fault"), streamId: "stream-a", expectedTail: MISSING,
        lease: null, records: records(1, "async-fault"),
      }), "GE_CYCLE_STORE_UNAVAILABLE");
      expect(await provider.readTail({ context: AUTH, streamId: "stream-a" })).toEqual(MISSING);
    } finally {
      provider.close();
    }
  });

  it("serializes independent connections so only one missing-tail CAS wins", async () => {
    const path = databasePath();
    const first = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00Z"),
    });
    const second = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00Z"),
    });
    try {
      const outcomes = await Promise.allSettled([
        first.append({
          context: mutation("left"), streamId: "shared", expectedTail: MISSING,
          lease: null, records: records(1, "left"),
        }),
        second.append({
          context: mutation("right"), streamId: "shared", expectedTail: MISSING,
          lease: null, records: records(1, "right"),
        }),
      ]);
      expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect((outcomes.find(({ status }) => status === "rejected") as PromiseRejectedResult).reason)
        .toMatchObject({ code: "GE_CYCLE_STORE_CONFLICT" });
    } finally {
      first.close();
      second.close();
    }
  });
});

describe("SQLiteCycleStoreProvider snapshot cursors and checkpoints", () => {
  it("bounds expiry cleanup per cursor creation and never lets stale rows grow the live quota", async () => {
    const path = databasePath();
    let now = Date.parse("2026-07-27T00:00:00Z");
    const provider = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    try {
      await createStream(provider, "stream-a", AUTH, 2);
      for (let index = 0; index < 70; index += 1) {
        const page = await provider.readEventPage({
          context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
        });
        expect(page.nextCursor).not.toBeNull();
      }
      now += CYCLE_STORE_CURSOR_TTL_MS + 1;
      await provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
      });
    } finally {
      provider.close();
    }

    const database = new DatabaseSync(path, { readOnly: true });
    try {
      const row = database.prepare(
        "SELECT count(*) AS cursorCount FROM ge_cycle_cursors",
      ).get() as { cursorCount: number };
      expect(Number(row.cursorCount)).toBe(7);
    } finally {
      database.close();
    }
  });

  it("resumes a single-use event snapshot after restart without seeing later appends", async () => {
    const path = databasePath();
    let now = Date.parse("2026-07-27T00:00:00Z");
    const first = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    const initial = await createStream(first, "stream-a", AUTH, 3);
    const page = await first.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
    });
    first.close();

    now += 1;
    const second = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    try {
      const later = records(1, "later", 3, initial[2]!.recordHash);
      await second.append({
        context: mutation("later"), streamId: "stream-a", expectedTail: page.snapshotTail,
        lease: null, records: later,
      });
      const resumed = await second.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: null,
        pageSize: 1, cursor: page.nextCursor,
      });
      expect(resumed.records.map(({ sequence }) => sequence)).toEqual([1]);
      expect(resumed.snapshotTail.sequence).toBe(2);
      await expectCode(second.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: null,
        pageSize: 1, cursor: page.nextCursor,
      }), "GE_CYCLE_STORE_INVALID_CURSOR");
    } finally {
      second.close();
    }
  });

  it("binds event cursors to tenant, authorization scope, page size, and expiry", async () => {
    let now = Date.parse("2026-07-27T00:00:00Z");
    const provider = new SQLiteCycleStoreProvider(databasePath(), { now: () => new Date(now) });
    try {
      await createStream(provider, "stream-a", AUTH, 3);
      const first = await provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
      });
      await expectCode(provider.readEventPage({
        context: AUTH_B, streamId: "stream-a", fromSequence: null,
        pageSize: 1, cursor: first.nextCursor,
      }), "GE_CYCLE_STORE_INVALID_CURSOR");
      await expectCode(provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: null,
        pageSize: 2, cursor: first.nextCursor,
      }), "GE_CYCLE_STORE_INVALID_CURSOR");
      const resumed = await provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: null,
        pageSize: 1, cursor: first.nextCursor,
      });
      expect(resumed.records[0]!.sequence).toBe(1);

      const expiring = await provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
      });
      now += CYCLE_STORE_CURSOR_TTL_MS;
      await expectCode(provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: null,
        pageSize: 1, cursor: expiring.nextCursor,
      }), "GE_CYCLE_STORE_INVALID_CURSOR");
    } finally {
      provider.close();
    }
  });

  it("persists checkpoint CRUD, revision snapshots, and legal-hold deletion gates", async () => {
    const path = databasePath();
    let now = Date.parse("2026-07-27T00:00:00Z");
    const first = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    const batch = await createStream(first);
    const checkpoints = ["a", "b", "c"].map((suffix, index) => createCycleStoreCheckpoint({
      checkpointScope: "scope-a",
      checkpointId: `checkpoint-${suffix}`,
      streamId: "stream-a",
      boundSequence: 0,
      boundRecordHash: batch[0]!.recordHash,
      createdAt: index === 0
        ? "2026-07-26T17:00:01-07:00"
        : `2026-07-27T00:00:0${index + 1}Z`,
      value: { suffix },
    }));
    for (const checkpoint of checkpoints) {
      await first.saveCheckpoint({
        context: mutation(`save-${checkpoint.checkpointId}`), checkpoint, lease: null,
      });
    }
    const page = await first.listCheckpoints({
      context: AUTH, checkpointScope: "scope-a", pageSize: 1, cursor: null,
    });
    expect(page.checkpoints[0]!.checkpointId).toBe("checkpoint-c");
    first.close();

    now += 1;
    const second = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    try {
      await second.setLegalHold({
        context: mutation("hold"), streamId: "stream-a", holdId: "hold-a", action: "place",
      });
      await expectCode(second.deleteCheckpoint({
        context: mutation("delete-blocked"), checkpointScope: "scope-a",
        checkpointId: "checkpoint-b", expectedValueHash: checkpoints[1]!.valueHash,
      }), "GE_CYCLE_STORE_LEGAL_HOLD");
      await second.setLegalHold({
        context: mutation("unhold"), streamId: "stream-a", holdId: "hold-a", action: "release",
      });
      await second.deleteCheckpoint({
        context: mutation("delete-b"), checkpointScope: "scope-a",
        checkpointId: "checkpoint-b", expectedValueHash: checkpoints[1]!.valueHash,
      });
      const resumed = await second.listCheckpoints({
        context: AUTH, checkpointScope: "scope-a", pageSize: 1, cursor: page.nextCursor,
      });
      expect(resumed.checkpoints[0]!.checkpointId).toBe("checkpoint-b");
      expect(await second.loadCheckpoint({
        context: AUTH, checkpointScope: "scope-a", checkpointId: "checkpoint-b",
      })).toBeNull();
      expect((await second.loadCheckpoint({
        context: AUTH, checkpointScope: "scope-a", checkpointId: "checkpoint-a",
      }))?.createdAt).toBe("2026-07-26T17:00:01-07:00");
    } finally {
      second.close();
    }
  });
});

describe("SQLiteCycleStoreProvider leases, governance, and migration fencing", () => {
  it("persists monotonic lease fences and rejects stale writes across restart", async () => {
    const path = databasePath();
    let now = Date.parse("2026-07-27T00:00:00Z");
    const first = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    const initial = await createStream(first);
    const lease = await first.acquireLease({
      context: mutation("lease-a"), streamId: "stream-a", leaseId: "lease-a",
      holderId: "holder-a", ttlMs: 1_000, mode: "acquire", expectedFencingToken: 0,
    });
    first.close();

    now += 100;
    const second = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    try {
      expect(await second.inspectLease({ context: AUTH, streamId: "stream-a" }))
        .toMatchObject({ status: "active", lastFencingToken: 1 });
      const next = records(1, "next", 1, initial[0]!.recordHash);
      await expectCode(second.append({
        context: mutation("unfenced"), streamId: "stream-a",
        expectedTail: { exists: true, sequence: 0, recordHash: initial[0]!.recordHash },
        lease: null, records: next,
      }), "GE_CYCLE_STORE_STALE_FENCE");
      await second.append({
        context: mutation("fenced"), streamId: "stream-a",
        expectedTail: { exists: true, sequence: 0, recordHash: initial[0]!.recordHash },
        lease: binding(lease), records: next,
      });
      await second.releaseLease({
        context: mutation("release"), streamId: "stream-a", lease: binding(lease),
      });
      const replacement = await second.acquireLease({
        context: mutation("lease-b"), streamId: "stream-a", leaseId: "lease-b",
        holderId: "holder-b", ttlMs: 1_000, mode: "acquire", expectedFencingToken: 1,
      });
      expect(replacement.fencingToken).toBe(2);
    } finally {
      second.close();
    }
  });

  it("requires expiry for takeover and permanently rejects reused lease identities", async () => {
    let now = Date.parse("2026-07-27T00:00:00Z");
    const provider = new SQLiteCycleStoreProvider(databasePath(), { now: () => new Date(now) });
    try {
      await createStream(provider);
      const first = await provider.acquireLease({
        context: mutation("lease-first"), streamId: "stream-a", leaseId: "lease-first",
        holderId: "holder-a", ttlMs: 100, mode: "acquire", expectedFencingToken: 0,
      });
      await expectCode(provider.acquireLease({
        context: mutation("takeover-early"), streamId: "stream-a", leaseId: "lease-second",
        holderId: "holder-b", ttlMs: 100, mode: "takeover", expectedFencingToken: 1,
      }), "GE_CYCLE_STORE_LEASE_CONFLICT");
      now += 100;
      const second = await provider.acquireLease({
        context: mutation("takeover-expired"), streamId: "stream-a", leaseId: "lease-second",
        holderId: "holder-b", ttlMs: 100, mode: "takeover", expectedFencingToken: 1,
      });
      expect([second.leaseEpoch, second.fencingToken]).toEqual([2, 2]);
      await expectCode(provider.renewLease({
        context: mutation("renew-stale"), streamId: "stream-a",
        lease: binding(first), ttlMs: 500,
      }), "GE_CYCLE_STORE_STALE_FENCE");
      await provider.releaseLease({
        context: mutation("release-second"), streamId: "stream-a", lease: binding(second),
      });
      await expectCode(provider.acquireLease({
        context: mutation("reuse-first"), streamId: "stream-a", leaseId: "lease-first",
        holderId: "holder-c", ttlMs: 100, mode: "acquire", expectedFencingToken: 2,
      }), "GE_CYCLE_STORE_LEASE_CONFLICT");
    } finally {
      provider.close();
    }
  });

  it("persists governance and globally fences online writers with migration locks", async () => {
    const provider = new SQLiteCycleStoreProvider(databasePath(), {
      now: () => new Date("2026-07-27T00:00:00Z"),
    });
    const initial = await createStream(provider);
    try {
      expect(await provider.setLegalHold({
        context: mutation("hold"), streamId: "stream-a", holdId: "legal-a", action: "place",
      })).toMatchObject({ legalHoldIds: ["legal-a"] });
      const lock = await provider.acquireMigrationLock({
        context: mutation("migration"), lockId: "migration-a", ownerId: "owner-a",
        sourceSchemaVersion: 1, targetSchemaVersion: 2, ttlMs: 1_000,
        mode: "acquire", expectedFencingToken: 0,
      });
      const next = records(1, "blocked", 1, initial[0]!.recordHash);
      await expectCode(provider.append({
        context: mutation("blocked"), streamId: "stream-a",
        expectedTail: { exists: true, sequence: 0, recordHash: initial[0]!.recordHash },
        lease: null, records: next,
      }), "GE_CYCLE_STORE_MIGRATION_LOCKED");
      expect(await provider.inspectMigrationLock(AUTH)).toEqual(lock);
      expect(await provider.releaseMigrationLock({
        context: mutation("migration-release"), lockId: lock.lockId,
        ownerId: lock.ownerId, fencingToken: lock.fencingToken,
      })).toBeNull();
      await provider.append({
        context: mutation("unblocked"), streamId: "stream-a",
        expectedTail: { exists: true, sequence: 0, recordHash: initial[0]!.recordHash },
        lease: null, records: next,
      });
    } finally {
      provider.close();
    }
  });

  it("isolates tenants and authorizes before revealing stored existence", async () => {
    const path = databasePath();
    const writer = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00Z"),
    });
    await createStream(writer, "same", AUTH);
    await createStream(writer, "same", AUTH_B);
    writer.close();

    const reader = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:01Z"),
      authorize: (context) => context.authorizationHash !== "f".repeat(64),
    });
    try {
      const denied = { ...AUTH, authorizationHash: "f".repeat(64) };
      const error = await expectCode(reader.readTail({
        context: denied, streamId: "same",
      }), "GE_CYCLE_STORE_PERMISSION_DENIED");
      expect(error.details).toEqual({});
      expect((await reader.readTail({ context: AUTH, streamId: "same" })).exists).toBe(true);
      expect((await reader.readTail({ context: AUTH_B, streamId: "same" })).exists).toBe(true);
    } finally {
      reader.close();
    }
  });

  it("persists the provider clock high-water and closes idempotently", async () => {
    const path = databasePath();
    let now = Date.parse("2026-07-27T00:00:00Z");
    let authorizationCalls = 0;
    const first = new SQLiteCycleStoreProvider(path, {
      now: () => new Date(now),
      authorize: () => {
        authorizationCalls += 1;
        return true;
      },
    });
    first.close();
    first.close();
    expect(first.isOpen).toBe(false);
    const lifecycle = await expectCode(first.describe(), "GE_CYCLE_STORE_UNAVAILABLE");
    expect(JSON.stringify(lifecycle)).not.toContain(path);
    await expectCode(first.readTail({ context: AUTH, streamId: "stream-a" }),
      "GE_CYCLE_STORE_UNAVAILABLE");
    await expectCode(first.append({} as never), "GE_CYCLE_STORE_UNAVAILABLE");
    expect(authorizationCalls).toBe(0);
    now -= 1;
    expect(() => new SQLiteCycleStoreProvider(path, { now: () => new Date(now) }))
      .toThrowError(expect.objectContaining({ code: "GE_CYCLE_STORE_INVALID_ARGUMENT" }));
  });

  it("remembers a forward clock observation even when the surrounding decision rolls back", async () => {
    let now = Date.parse("2026-07-27T00:00:00Z");
    const provider = new SQLiteCycleStoreProvider(databasePath(), { now: () => new Date(now) });
    try {
      await createStream(provider);
      now += 1_000;
      await expectCode(provider.append({
        context: mutation("future-conflict"), streamId: "stream-a", expectedTail: MISSING,
        lease: null, records: records(1, "never-committed"),
      }), "GE_CYCLE_STORE_CONFLICT");
      now -= 1;
      await expectCode(provider.inspectLease({ context: AUTH, streamId: "stream-a" }),
        "GE_CYCLE_STORE_INVALID_ARGUMENT");
      expect((await provider.readTail({ context: AUTH, streamId: "stream-a" })).sequence).toBe(0);
    } finally {
      provider.close();
    }
  });

  it("fails closed when an authorization hook returns non-boolean data", async () => {
    const provider = new SQLiteCycleStoreProvider(databasePath(), {
      now: () => new Date("2026-07-27T00:00:00Z"),
      authorize: (() => "allow") as never,
    });
    try {
      await expectCode(provider.readTail({ context: AUTH, streamId: "stream-a" }),
        "GE_CYCLE_STORE_INTERNAL");
    } finally {
      provider.close();
    }
  });
});
