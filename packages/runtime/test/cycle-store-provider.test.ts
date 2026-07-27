import { canonicalSerialize } from "@graph-engineering/core";
import { describe, expect, it } from "vitest";
import {
  CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN,
  CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
  CycleStoreProviderError,
  MemoryCycleStoreProvider,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  createReferenceCycleStoreProviderDescriptor,
  hashWithDomain,
  validateCycleStoreProviderDescriptor,
  type CycleStoreAuthorizationContext,
  type CycleStoreLease,
  type CycleStoreMutationContext,
  type CycleStoreRecord,
  type CycleStoreTail,
} from "../src/index.js";

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

function mutation(operationId: string, auth = AUTH): CycleStoreMutationContext {
  return Object.freeze({ ...auth, operationId });
}

function records(count: number, prefix = "record"): CycleStoreRecord[] {
  const result: CycleStoreRecord[] = [];
  for (let sequence = 0; sequence < count; sequence += 1) {
    result.push(createCycleStoreRecord({
      recordId: `${prefix}-${sequence}`,
      sequence,
      previousRecordHash: result.at(-1)?.recordHash ?? null,
      value: { sequence, source: prefix },
    }));
  }
  return result;
}

async function createStream(
  provider: MemoryCycleStoreProvider,
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

function binding(lease: CycleStoreLease) {
  return {
    leaseId: lease.leaseId,
    holderId: lease.holderId,
    fencingToken: lease.fencingToken,
  };
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

describe("cycle store provider descriptor", () => {
  it("is closed, content-addressed, and truthful about the memory reference model", () => {
    const descriptor = createReferenceCycleStoreProviderDescriptor();
    expect(descriptor.contractVersion).toBe(CYCLE_STORE_PROVIDER_CONTRACT_VERSION);
    expect(descriptor.capabilities.durability).toBe("process-local");
    expect(descriptor.capabilities.distributedFencing).toBe(false);
    expect(validateCycleStoreProviderDescriptor(descriptor)).toEqual(descriptor);

    const open = JSON.parse(JSON.stringify(descriptor));
    open.unknown = true;
    expect(() => validateCycleStoreProviderDescriptor(open)).toThrowError(CycleStoreProviderError);

    const version = JSON.parse(JSON.stringify(descriptor));
    version.contractVersion = "cycle-store-provider/v2";
    expect(() => validateCycleStoreProviderDescriptor(version)).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_STORE_UNSUPPORTED_VERSION" }),
    );

    const { descriptorHash: _descriptorHash, ...durableBody } = JSON.parse(
      JSON.stringify(descriptor),
    );
    durableBody.providerId = "postgresql-reference";
    durableBody.limits.maxPageSize = 128;
    durableBody.capabilities = {
      ...durableBody.capabilities,
      durability: "durable",
      distributedFencing: true,
      legalHold: "enforced",
      backupRestore: "enforced",
    };
    durableBody.protection = {
      ...durableBody.protection,
      payloadProtection: "provider-managed",
      encryptionAtRest: "provider-managed",
    };
    durableBody.governance = {
      ...durableBody.governance,
      retention: "enforced",
      archival: "enforced",
    };
    const durable = {
      ...durableBody,
      descriptorHash: hashWithDomain(CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, durableBody),
    };
    expect(validateCycleStoreProviderDescriptor(durable)).toEqual(durable);

    const excessive = JSON.parse(JSON.stringify(descriptor));
    excessive.limits.maxPageSize = 257;
    expect(() => validateCycleStoreProviderDescriptor(excessive)).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_STORE_QUOTA_EXCEEDED" }),
    );
  });
});

describe("cycle store provider append and pagination", () => {
  it("atomically appends a detached batch and returns an exact strong tail", async () => {
    const provider = new MemoryCycleStoreProvider();
    const callerValues = [0, 1, 2].map((sequence) => ({ sequence, source: "record" }));
    const batch: CycleStoreRecord[] = [];
    for (const [sequence, value] of callerValues.entries()) {
      batch.push(createCycleStoreRecord({
        recordId: `record-${sequence}`,
        sequence,
        previousRecordHash: batch.at(-1)?.recordHash ?? null,
        value,
      }));
    }
    const result = await provider.append({
      context: mutation("append-1"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records: batch,
    });
    expect(result).toEqual({
      tail: { exists: true, sequence: 2, recordHash: batch[2]!.recordHash },
      appendedRecords: 3,
    });
    callerValues[0]!.sequence = 99;
    const page = await provider.readEventPage({
      context: AUTH,
      streamId: "stream-a",
      fromSequence: 0,
      pageSize: 10,
      cursor: null,
    });
    expect((page.records[0]!.value as { sequence: number }).sequence).toBe(0);
    expect(await provider.readTail({ context: AUTH, streamId: "stream-a" })).toEqual(result.tail);
  });

  it("captures before awaiting authorization and returns detached immutable reads", async () => {
    let releaseAuthorization!: () => void;
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const provider = new MemoryCycleStoreProvider({
      authorize: async () => {
        await authorizationGate;
        return true;
      },
    });
    const original = records(1, "captured")[0]!;
    const callerRecords = [original];
    const pending = provider.append({
      context: mutation("capture-before-await"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records: callerRecords,
    });
    callerRecords[0] = createCycleStoreRecord({
      recordId: "hostile-replacement",
      sequence: 0,
      previousRecordHash: null,
      value: { sentinel: "MUST_NOT_COMMIT" },
    });
    releaseAuthorization();
    await pending;
    const page = await provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
    });
    expect(page.records[0]!.recordHash).toBe(original.recordHash);
    expect(() => {
      (page.records[0]!.value as { source: string }).source = "mutated-read";
    }).toThrow(TypeError);
    const repeated = await provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
    });
    expect(repeated.records[0]!.recordHash).toBe(original.recordHash);
    expect(canonicalSerialize(provider.unsafeStateSnapshotForTest())).not.toContain("MUST_NOT_COMMIT");
  });

  it("returns the first result for an exact operation retry and rejects changed reuse", async () => {
    const provider = new MemoryCycleStoreProvider();
    const batch = records(1);
    const request = {
      context: mutation("append-once"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records: batch,
    } as const;
    const first = await provider.append(request);
    expect(await provider.append(request)).toEqual(first);
    await expectCode(provider.append({
      ...request,
      records: [createCycleStoreRecord({
        recordId: "changed",
        sequence: 0,
        previousRecordHash: null,
        value: { changed: true },
      })],
    }), "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT");
    expect(provider.unsafeStateCountersForTest().records).toBe(1);
  });

  it("contains commit-then-throw ambiguity through the operation ledger", async () => {
    let armed = true;
    const provider = new MemoryCycleStoreProvider({
      faultHook: (boundary) => {
        if (armed && boundary === "provider:append:after-commit-before-return") {
          armed = false;
          throw new Error("lost acknowledgement");
        }
      },
    });
    const request = {
      context: mutation("ambiguous-append"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records: records(1),
    } as const;
    await expectCode(provider.append(request), "GE_CYCLE_STORE_UNAVAILABLE");
    const recovered = await provider.append(request);
    expect(recovered.appendedRecords).toBe(1);
    expect(provider.unsafeStateCountersForTest().records).toBe(1);
  });

  it("allows only one concurrent CAS winner", async () => {
    const provider = new MemoryCycleStoreProvider();
    const left = records(1, "left");
    const right = records(1, "right");
    const outcomes = await Promise.allSettled([
      provider.append({
        context: mutation("left-create"), streamId: "shared", expectedTail: MISSING,
        lease: null, records: left,
      }),
      provider.append({
        context: mutation("right-create"), streamId: "shared", expectedTail: MISSING,
        lease: null, records: right,
      }),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toEqual(
      expect.objectContaining({ code: "GE_CYCLE_STORE_CONFLICT" }),
    );
    expect(provider.unsafeStateCountersForTest().records).toBe(1);
  });

  it("keeps a no-skip snapshot while later appends go to a new scan", async () => {
    const provider = new MemoryCycleStoreProvider();
    const initial = await createStream(provider, "stream-a", AUTH, 5);
    const first = await provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 2, cursor: null,
    });
    expect(first.records.map(({ sequence }) => sequence)).toEqual([0, 1]);
    const sixth = createCycleStoreRecord({
      recordId: "sixth",
      sequence: 5,
      previousRecordHash: initial[4]!.recordHash,
      value: { sequence: 5 },
    });
    await provider.append({
      context: mutation("append-sixth"),
      streamId: "stream-a",
      expectedTail: first.snapshotTail,
      lease: null,
      records: [sixth],
    });
    const second = await provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: null, pageSize: 2,
      cursor: first.nextCursor,
    });
    await expectCode(provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: null, pageSize: 2,
      cursor: first.nextCursor,
    }), "GE_CYCLE_STORE_INVALID_CURSOR");
    const third = await provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: null, pageSize: 2,
      cursor: second.nextCursor,
    });
    expect([...second.records, ...third.records].map(({ sequence }) => sequence)).toEqual([2, 3, 4]);
    expect(third.nextCursor).toBeNull();
    expect(first.snapshotTail.sequence).toBe(4);
    expect((await provider.readTail({ context: AUTH, streamId: "stream-a" })).sequence).toBe(5);
  });

  it("binds cursors to exact scope and expiry", async () => {
    const provider = new MemoryCycleStoreProvider();
    await createStream(provider, "stream-a", AUTH, 3);
    const first = await provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
    });
    await expectCode(provider.readEventPage({
      context: AUTH_B, streamId: "stream-a", fromSequence: null, pageSize: 1,
      cursor: first.nextCursor,
    }), "GE_CYCLE_STORE_INVALID_CURSOR");
    await expectCode(provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: null, pageSize: 1,
      cursor: "cursor-not-valid!",
    }), "GE_CYCLE_STORE_INVALID_CURSOR");
    expect(provider.unsafeStateCountersForTest().cursors).toBe(1);
    provider.unsafeAdvanceClockForTest(300_001);
    await expectCode(provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: null, pageSize: 1,
      cursor: first.nextCursor,
    }), "GE_CYCLE_STORE_INVALID_CURSOR");
    expect(provider.unsafeStateCountersForTest().cursors).toBe(0);
  });

  it("enforces exact count, page, clock, and fence boundaries without mutation", async () => {
    const provider = new MemoryCycleStoreProvider();
    const tooMany = records(65, "too-many");
    const before = provider.unsafeStateCountersForTest();
    await expectCode(provider.append({
      context: mutation("too-many"), streamId: "stream-a", expectedTail: MISSING,
      lease: null, records: tooMany,
    }), "GE_CYCLE_STORE_QUOTA_EXCEEDED");
    expect(provider.unsafeStateCountersForTest()).toEqual(before);
    const maximum = records(64, "maximum");
    await provider.append({
      context: mutation("maximum"), streamId: "stream-a", expectedTail: MISSING,
      lease: null, records: maximum,
    });
    await expectCode(provider.readEventPage({
      context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 257, cursor: null,
    }), "GE_CYCLE_STORE_INVALID_ARGUMENT");
    provider.unsafeSetLeaseCountersForTest(
      AUTH.tenantId,
      "stream-a",
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    );
    await expectCode(provider.acquireLease({
      context: mutation("fence-overflow"), streamId: "stream-a", leaseId: "overflow",
      holderId: "holder", ttlMs: 1, mode: "acquire",
      expectedFencingToken: Number.MAX_SAFE_INTEGER,
    }), "GE_CYCLE_STORE_QUOTA_EXCEEDED");

    let now = Date.parse("2026-07-27T01:00:00Z");
    const rollbackProvider = new MemoryCycleStoreProvider({ now: () => new Date(now) });
    await createStream(rollbackProvider);
    const rollbackLease = await rollbackProvider.acquireLease({
      context: mutation("clock-first"), streamId: "stream-a", leaseId: "clock-first",
      holderId: "holder", ttlMs: 1_000, mode: "acquire", expectedFencingToken: 0,
    });
    now -= 1;
    const rollbackBefore = rollbackProvider.unsafeStateCountersForTest();
    await expectCode(rollbackProvider.renewLease({
      context: mutation("clock-rollback"), streamId: "stream-a",
      lease: binding(rollbackLease), ttlMs: 2_000,
    }), "GE_CYCLE_STORE_INVALID_ARGUMENT");
    expect(rollbackProvider.unsafeStateCountersForTest()).toEqual(rollbackBefore);
  });
});

describe("cycle store provider checkpoints", () => {
  it("saves, orders, snapshots, loads, and deletes cache-only checkpoints", async () => {
    const provider = new MemoryCycleStoreProvider();
    const batch = await createStream(provider, "stream-a", AUTH, 2);
    const tail = { exists: true, sequence: 1, recordHash: batch[1]!.recordHash } as const;
    const first = createCycleStoreCheckpoint({
      checkpointScope: "scope-a", checkpointId: "cp-a", streamId: "stream-a",
      boundSequence: 1, boundRecordHash: tail.recordHash,
      createdAt: "2026-07-27T00:00:01Z", value: { state: "a" },
    });
    const second = createCycleStoreCheckpoint({
      checkpointScope: "scope-a", checkpointId: "cp-b", streamId: "stream-a",
      boundSequence: 1, boundRecordHash: tail.recordHash,
      createdAt: "2026-07-27T00:00:02Z", value: { state: "b" },
    });
    await provider.saveCheckpoint({ context: mutation("save-a"), checkpoint: first, lease: null });
    await provider.saveCheckpoint({ context: mutation("save-b"), checkpoint: second, lease: null });
    const page = await provider.listCheckpoints({
      context: AUTH, checkpointScope: "scope-a", pageSize: 1, cursor: null,
    });
    expect(page.checkpoints[0]!.checkpointId).toBe("cp-b");
    const next = await provider.listCheckpoints({
      context: AUTH, checkpointScope: "scope-a", pageSize: 1, cursor: page.nextCursor,
    });
    expect(next.checkpoints[0]!.checkpointId).toBe("cp-a");
    expect(await provider.loadCheckpoint({
      context: AUTH, checkpointScope: "scope-a", checkpointId: "cp-a",
    })).toEqual(first);
    expect(await provider.deleteCheckpoint({
      context: mutation("delete-a"), checkpointScope: "scope-a", checkpointId: "cp-a",
      expectedValueHash: first.valueHash,
    })).toEqual({ deleted: true });
    expect((await provider.readTail({ context: AUTH, streamId: "stream-a" })).sequence).toBe(1);
  });

  it("rejects stale bindings, immutable-ID drift, and corrupt cache bytes", async () => {
    const provider = new MemoryCycleStoreProvider();
    const batch = await createStream(provider);
    const checkpoint = createCycleStoreCheckpoint({
      checkpointScope: "scope-a", checkpointId: "cp-a", streamId: "stream-a",
      boundSequence: 0, boundRecordHash: batch[0]!.recordHash,
      createdAt: "2026-07-27T00:00:01Z", value: { state: "valid" },
    });
    await provider.saveCheckpoint({ context: mutation("save-a"), checkpoint, lease: null });
    const changed = createCycleStoreCheckpoint({
      ...checkpoint,
      value: { state: "changed" },
    });
    await expectCode(provider.saveCheckpoint({
      context: mutation("save-changed"), checkpoint: changed, lease: null,
    }), "GE_CYCLE_STORE_CONFLICT");
    provider.unsafeCorruptCheckpointForTest("tenant-a", "scope-a", "cp-a", {
      ...checkpoint,
      value: { state: "corrupt" },
    });
    await expectCode(provider.loadCheckpoint({
      context: AUTH, checkpointScope: "scope-a", checkpointId: "cp-a",
    }), "GE_CYCLE_STORE_CORRUPTION");
  });
});

describe("cycle store provider leases and governance", () => {
  it("monotonically acquires, renews, releases, and reacquires fences", async () => {
    const provider = new MemoryCycleStoreProvider();
    await createStream(provider);
    const first = await provider.acquireLease({
      context: mutation("lease-1"), streamId: "stream-a", leaseId: "lease-1",
      holderId: "holder-a", ttlMs: 1_000, mode: "acquire", expectedFencingToken: 0,
    });
    provider.unsafeAdvanceClockForTest(100);
    const renewed = await provider.renewLease({
      context: mutation("renew-1"), streamId: "stream-a", lease: binding(first), ttlMs: 2_000,
    });
    expect(renewed.fencingToken).toBe(1);
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(first.expiresAt));
    await provider.releaseLease({
      context: mutation("release-1"), streamId: "stream-a", lease: binding(renewed),
    });
    const second = await provider.acquireLease({
      context: mutation("lease-2"), streamId: "stream-a", leaseId: "lease-2",
      holderId: "holder-b", ttlMs: 1_000, mode: "acquire", expectedFencingToken: 1,
    });
    expect([second.leaseEpoch, second.fencingToken]).toEqual([2, 2]);
  });

  it("rejects active takeover and stale writes, then permits expired takeover", async () => {
    const provider = new MemoryCycleStoreProvider();
    const initial = await createStream(provider);
    const first = await provider.acquireLease({
      context: mutation("lease-1"), streamId: "stream-a", leaseId: "lease-1",
      holderId: "holder-a", ttlMs: 100, mode: "acquire", expectedFencingToken: 0,
    });
    await expectCode(provider.acquireLease({
      context: mutation("takeover-early"), streamId: "stream-a", leaseId: "lease-2",
      holderId: "holder-b", ttlMs: 100, mode: "takeover", expectedFencingToken: 1,
    }), "GE_CYCLE_STORE_LEASE_CONFLICT");
    const next = createCycleStoreRecord({
      recordId: "next", sequence: 1, previousRecordHash: initial[0]!.recordHash,
      value: { next: true },
    });
    await expectCode(provider.append({
      context: mutation("unfenced-write"), streamId: "stream-a",
      expectedTail: { exists: true, sequence: 0, recordHash: initial[0]!.recordHash },
      lease: null, records: [next],
    }), "GE_CYCLE_STORE_STALE_FENCE");
    provider.unsafeAdvanceClockForTest(100);
    const takeover = await provider.acquireLease({
      context: mutation("takeover-late"), streamId: "stream-a", leaseId: "lease-2",
      holderId: "holder-b", ttlMs: 100, mode: "takeover", expectedFencingToken: 1,
    });
    await provider.append({
      context: mutation("fenced-write"), streamId: "stream-a",
      expectedTail: { exists: true, sequence: 0, recordHash: initial[0]!.recordHash },
      lease: binding(takeover), records: [next],
    });
    expect((await provider.readTail({ context: AUTH, streamId: "stream-a" })).sequence).toBe(1);
  });

  it("isolates tenants and authorizes before revealing existence", async () => {
    let calls = 0;
    const provider = new MemoryCycleStoreProvider({
      authorize: (context) => {
        calls += 1;
        return context.authorizationHash !== "f".repeat(64);
      },
    });
    await createStream(provider, "same", AUTH);
    await createStream(provider, "same", AUTH_B);
    expect(provider.unsafeStateCountersForTest().streams).toBe(2);
    const denied = { ...AUTH, authorizationHash: "f".repeat(64) };
    const before = provider.unsafeStateCountersForTest();
    const error = await expectCode(provider.readTail({
      context: denied, streamId: "same",
    }), "GE_CYCLE_STORE_PERMISSION_DENIED");
    expect(Object.keys(error.details)).toHaveLength(0);
    expect(provider.unsafeStateCountersForTest()).toEqual(before);
    expect(calls).toBeGreaterThan(2);
  });

  it("places legal holds and fences a migration lock with exact retry", async () => {
    const provider = new MemoryCycleStoreProvider();
    const initial = await createStream(provider);
    const holdRequest = {
      context: mutation("hold-1"), streamId: "stream-a", holdId: "legal-1", action: "place",
    } as const;
    const governance = await provider.setLegalHold(holdRequest);
    expect(governance.legalHoldIds).toEqual(["legal-1"]);
    const request = {
      context: mutation("migration-1"), lockId: "migration-1", ownerId: "owner-a",
      sourceSchemaVersion: 1, targetSchemaVersion: 2, ttlMs: 100,
      mode: "acquire" as const, expectedFencingToken: 0,
    };
    const first = await provider.acquireMigrationLock(request);
    expect(await provider.acquireMigrationLock(request)).toEqual(first);
    expect(await provider.setLegalHold(holdRequest)).toEqual(governance);
    expect(await createStream(provider)).toEqual(initial);
    const beforeBlockedWrite = provider.unsafeStateCountersForTest();
    const next = createCycleStoreRecord({
      recordId: "migration-blocked-record",
      sequence: 1,
      previousRecordHash: initial[0]!.recordHash,
      value: { blocked: true },
    });
    await expectCode(provider.append({
      context: mutation("migration-blocked-append"),
      streamId: "stream-a",
      expectedTail: { exists: true, sequence: 0, recordHash: initial[0]!.recordHash },
      lease: null,
      records: [next],
    }), "GE_CYCLE_STORE_MIGRATION_LOCKED");
    expect(provider.unsafeStateCountersForTest()).toEqual(beforeBlockedWrite);
    await expectCode(provider.acquireMigrationLock({
      ...request,
      context: mutation("migration-2"),
      lockId: "migration-2",
      expectedFencingToken: 1,
    }), "GE_CYCLE_STORE_MIGRATION_LOCKED");
    provider.unsafeAdvanceClockForTest(100);
    const second = await provider.acquireMigrationLock({
      ...request,
      context: mutation("migration-3"),
      lockId: "migration-2",
      ownerId: "owner-b",
      mode: "takeover",
      expectedFencingToken: 1,
    });
    expect(second.fencingToken).toBe(2);
  });

  it("serializes safe typed failures without raw causes or payloads", async () => {
    const provider = new MemoryCycleStoreProvider();
    provider.unsafeInjectFailureForTest("read-tail", "GE_CYCLE_STORE_UNAVAILABLE");
    const error = await expectCode(provider.readTail({ context: AUTH, streamId: "secret-stream" }),
      "GE_CYCLE_STORE_UNAVAILABLE");
    const serialized = canonicalSerialize(error.toJSON());
    expect(serialized).not.toContain("stack");
    expect(serialized).not.toContain("cause");
    expect(serialized).not.toContain("secret-stream");
  });
});
