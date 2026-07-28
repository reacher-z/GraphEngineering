import { Buffer } from "node:buffer";
import { canonicalSerialize } from "@graph-engineering/core";
import { describe, expect, it } from "vitest";
import {
  CYCLE_STORE_OPERATION_DOMAIN,
  CycleStoreProviderError,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  createReferenceCycleStoreProviderDescriptor,
  cycleStoreAdapterCodec,
  hashWithDomain,
  validateCycleStoreProviderDescriptor,
  type CycleStoreAdapterRequestOperation,
  type CycleStoreAuthorizationContext,
  type CycleStoreLedgerResultByOperation,
  type CycleStoreMutationContext,
  type CycleStoreMutationOperation,
  type CycleStoreProviderDescriptor,
  type CycleStoreProviderProfile,
} from "../src/index.js";

const AUTH: CycleStoreAuthorizationContext = Object.freeze({
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});

function mutation(operationId: string): CycleStoreMutationContext {
  return Object.freeze({ ...AUTH, operationId });
}

function sqliteProfile(): CycleStoreProviderProfile {
  const reference = createReferenceCycleStoreProviderDescriptor();
  return {
    providerId: "sqlite-local",
    schemaVersion: 1,
    compatibility: reference.compatibility,
    limits: reference.limits,
    capabilities: {
      ...reference.capabilities,
      durability: "durable",
      distributedFencing: false,
      legalHold: "enforced",
      backupRestore: "enforced",
    },
    protection: {
      ...reference.protection,
      encryptionAtRest: "external",
    },
    governance: reference.governance,
  };
}

function expectCode(action: () => unknown, code: string): CycleStoreProviderError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe(code);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code}`);
}

function roundTrip<K extends CycleStoreMutationOperation>(
  operation: K,
  result: CycleStoreLedgerResultByOperation[K],
): CycleStoreLedgerResultByOperation[K] {
  const bytes = cycleStoreAdapterCodec.encodeLedgerResult(operation, result);
  expect(Buffer.from(bytes).toString("utf8")).toBe(canonicalSerialize(result));
  const decoded = cycleStoreAdapterCodec.decodeLedgerResult(operation, bytes);
  expect(decoded).toEqual(result);
  expect(Object.isFrozen(decoded)).toBe(true);
  return decoded;
}

describe("cycle store provider adapter codec descriptors", () => {
  it("creates the cross-language SQLite descriptor from a closed stronger profile", () => {
    const profile = sqliteProfile();
    const descriptor = cycleStoreAdapterCodec.createDescriptor(profile);
    expect(descriptor.descriptorHash).toBe(
      "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe",
    );
    expect(descriptor.capabilities).toEqual(profile.capabilities);
    expect(descriptor.protection).toEqual(profile.protection);
    expect(validateCycleStoreProviderDescriptor(descriptor)).toEqual(descriptor);
    expect(Object.isFrozen(cycleStoreAdapterCodec)).toBe(true);
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("captures profiles once and rejects open profile or nested capability shapes", () => {
    const profile = sqliteProfile();
    const mutable = JSON.parse(JSON.stringify(profile)) as CycleStoreProviderProfile;
    const descriptor = cycleStoreAdapterCodec.createDescriptor(mutable);
    (mutable.capabilities as { durability: string }).durability = "process-local";
    expect(descriptor.capabilities.durability).toBe("durable");

    const open = { ...profile, unknown: true };
    expectCode(
      () => cycleStoreAdapterCodec.createDescriptor(open as CycleStoreProviderProfile),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    const nested = JSON.parse(JSON.stringify(profile)) as Record<string, unknown>;
    (nested.capabilities as Record<string, unknown>).unknown = true;
    expectCode(
      () => cycleStoreAdapterCodec.createDescriptor(nested as unknown as CycleStoreProviderProfile),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
  });
});

describe("cycle store provider adapter codec request capture", () => {
  it("captures all seventeen request operations into detached frozen values", () => {
    const descriptor = createReferenceCycleStoreProviderDescriptor();
    const record = createCycleStoreRecord({
      recordId: "record-0",
      sequence: 0,
      previousRecordHash: null,
      value: { nested: { value: 1 } },
    });
    const checkpoint = createCycleStoreCheckpoint({
      checkpointScope: "scope-a",
      checkpointId: "checkpoint-a",
      streamId: "stream-a",
      boundSequence: 0,
      boundRecordHash: record.recordHash,
      createdAt: "2026-07-27T00:00:01Z",
      value: { state: "ready" },
    });
    const binding = { leaseId: "lease-a", holderId: "holder-a", fencingToken: 1 };
    const cases: readonly (readonly [CycleStoreAdapterRequestOperation, unknown])[] = [
      ["inspect-schema", AUTH],
      ["read-tail", { context: AUTH, streamId: "stream-a" }],
      ["append", {
        context: mutation("append-a"),
        streamId: "stream-a",
        expectedTail: { exists: false, sequence: -1, recordHash: null },
        lease: null,
        records: [record],
      }],
      ["read-event-page", {
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 10, cursor: null,
      }],
      ["save-checkpoint", { context: mutation("save-a"), checkpoint, lease: null }],
      ["load-checkpoint", {
        context: AUTH, checkpointScope: "scope-a", checkpointId: "checkpoint-a",
      }],
      ["list-checkpoints", {
        context: AUTH, checkpointScope: "scope-a", pageSize: 10, cursor: null,
      }],
      ["delete-checkpoint", {
        context: mutation("delete-a"), checkpointScope: "scope-a",
        checkpointId: "checkpoint-a", expectedValueHash: checkpoint.valueHash,
      }],
      ["acquire-lease", {
        context: mutation("acquire-a"), streamId: "stream-a", leaseId: "lease-a",
        holderId: "holder-a", ttlMs: 1_000, mode: "acquire", expectedFencingToken: 0,
      }],
      ["renew-lease", {
        context: mutation("renew-a"), streamId: "stream-a", lease: binding, ttlMs: 2_000,
      }],
      ["release-lease", {
        context: mutation("release-a"), streamId: "stream-a", lease: binding,
      }],
      ["inspect-lease", { context: AUTH, streamId: "stream-a" }],
      ["set-legal-hold", {
        context: mutation("hold-a"), streamId: "stream-a", holdId: "hold-a", action: "place",
      }],
      ["inspect-governance", { context: AUTH, streamId: "stream-a" }],
      ["acquire-migration-lock", {
        context: mutation("migration-a"), lockId: "migration-a", ownerId: "owner-a",
        sourceSchemaVersion: 1, targetSchemaVersion: 2, ttlMs: 1_000,
        mode: "acquire", expectedFencingToken: 0,
      }],
      ["inspect-migration-lock", AUTH],
      ["release-migration-lock", {
        context: mutation("migration-release-a"), lockId: "migration-a",
        ownerId: "owner-a", fencingToken: 1,
      }],
    ];
    for (const [operation, value] of cases) {
      const captured = cycleStoreAdapterCodec.captureRequest(operation, value, descriptor);
      expect(Object.isFrozen(captured), operation).toBe(true);
    }

    const mutableValue = { nested: { value: 1 } };
    const mutableRecord = createCycleStoreRecord({
      recordId: "detached-0", sequence: 0, previousRecordHash: null, value: mutableValue,
    });
    const input = {
      context: mutation("detached"), streamId: "detached", expectedTail: {
        exists: false, sequence: -1, recordHash: null,
      }, lease: null, records: [mutableRecord],
    };
    const captured = cycleStoreAdapterCodec.captureRequest("append", input, descriptor);
    input.records.length = 0;
    mutableValue.nested.value = 2;
    expect(captured.records).toHaveLength(1);
    expect((captured.records[0]!.value as { nested: { value: number } }).nested.value).toBe(1);
    expect(Object.isFrozen(captured.records[0]!.value)).toBe(true);
  });

  it("preserves closure and validation order while enforcing descriptor limits", () => {
    const descriptor = createReferenceCycleStoreProviderDescriptor();
    const malformed = {
      context: { ...mutation("bad"), tenantId: "!" },
      streamId: "stream-a",
      expectedTail: { exists: false, sequence: -1, recordHash: null },
      lease: null,
      records: Array.from({ length: 65 }, () => ({ invalid: true })),
    };
    const contextError = expectCode(
      () => cycleStoreAdapterCodec.captureRequest("append", malformed, descriptor),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    expect(contextError.message).toBe("tenantId is invalid");
    malformed.context = mutation("bad") as typeof malformed.context;
    const quotaError = expectCode(
      () => cycleStoreAdapterCodec.captureRequest("append", malformed, descriptor),
      "GE_CYCLE_STORE_QUOTA_EXCEEDED",
    );
    expect(quotaError.message).toContain("record count");

    const open = { context: AUTH, streamId: "stream-a", unknown: true };
    const closure = expectCode(
      () => cycleStoreAdapterCodec.captureRequest("read-tail", open, descriptor),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
    );
    expect(closure.message).toBe("tail request must be closed");

    const limited = cycleStoreAdapterCodec.createDescriptor({
      ...sqliteProfile(),
      providerId: "limited",
      limits: { ...descriptor.limits, maxPageSize: 1 },
    });
    expectCode(() => cycleStoreAdapterCodec.captureRequest("read-event-page", {
      context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 2, cursor: null,
    }, limited), "GE_CYCLE_STORE_INVALID_ARGUMENT");
  });

  it("computes the exact domain-separated canonical operation request hash", () => {
    const descriptor = createReferenceCycleStoreProviderDescriptor();
    const record = createCycleStoreRecord({
      recordId: "record-0", sequence: 0, previousRecordHash: null, value: { value: 1 },
    });
    const request = cycleStoreAdapterCodec.captureRequest("append", {
      context: mutation("hash-a"),
      streamId: "stream-a",
      expectedTail: { exists: false, sequence: -1, recordHash: null },
      lease: null,
      records: [record],
    }, descriptor);
    expect(cycleStoreAdapterCodec.operationRequestHash("append", request)).toBe(
      hashWithDomain(CYCLE_STORE_OPERATION_DOMAIN, { operation: "append", request }),
    );
  });
});

describe("cycle store provider adapter codec stored bytes", () => {
  it("recomputes record and checkpoint identity from exact canonical UTF-8 bytes", () => {
    const record = createCycleStoreRecord({
      recordId: "record-0", sequence: 0, previousRecordHash: null,
      value: { unicode: "graph-🐍", float: 1.25 },
    });
    const checkpoint = createCycleStoreCheckpoint({
      checkpointScope: "scope-a", checkpointId: "checkpoint-a", streamId: "stream-a",
      boundSequence: 0, boundRecordHash: record.recordHash,
      createdAt: "2026-07-27T00:00:01Z", value: { state: [1, 2, 3] },
    });
    const storedRecord = cycleStoreAdapterCodec.parseStoredRecord(
      Buffer.from(canonicalSerialize(record), "utf8"),
      "read-event-page",
    );
    const storedCheckpoint = cycleStoreAdapterCodec.parseStoredCheckpoint(
      Buffer.from(canonicalSerialize(checkpoint), "utf8"),
      "load-checkpoint",
      { checkpointId: checkpoint.checkpointId },
    );
    expect(storedRecord).toEqual(record);
    expect(storedCheckpoint).toEqual(checkpoint);
    expect(Object.isFrozen(storedRecord.value)).toBe(true);
    expect(Object.isFrozen(storedCheckpoint.value)).toBe(true);
  });

  it("fails closed on noncanonical, invalid UTF-8, and identity-drifted stored values", () => {
    const record = createCycleStoreRecord({
      recordId: "record-0", sequence: 0, previousRecordHash: null, value: { value: 1 },
    });
    expectCode(() => cycleStoreAdapterCodec.parseStoredRecord(
      Buffer.from(` ${canonicalSerialize(record)}`, "utf8"),
      "read-event-page",
    ), "GE_CYCLE_STORE_CORRUPTION");
    expectCode(() => cycleStoreAdapterCodec.parseStoredRecord(
      Uint8Array.from([0xc3, 0x28]),
      "read-event-page",
    ), "GE_CYCLE_STORE_CORRUPTION");
    const drifted = { ...record, valueHash: "f".repeat(64) };
    expectCode(() => cycleStoreAdapterCodec.parseStoredRecord(
      Buffer.from(canonicalSerialize(drifted), "utf8"),
      "read-event-page",
    ), "GE_CYCLE_STORE_CORRUPTION");
  });
});

describe("cycle store provider adapter codec operation ledger", () => {
  it("round-trips every mutation result through closed canonical bytes", () => {
    const tail = { exists: true, sequence: 0, recordHash: "c".repeat(64) } as const;
    const lease = {
      leaseId: "lease-a",
      holderId: "holder-a",
      leaseEpoch: 1,
      fencingToken: 1,
      acquiredAt: "2026-07-27T00:00:00Z",
      expiresAt: "2026-07-27T00:00:01Z",
    } as const;
    const migration = {
      lockId: "migration-a",
      ownerId: "owner-a",
      sourceSchemaVersion: 1,
      targetSchemaVersion: 2,
      lockEpoch: 1,
      fencingToken: 1,
      acquiredAt: "2026-07-27T00:00:00Z",
      expiresAt: "2026-07-27T00:00:01Z",
    } as const;
    roundTrip("append", { tail, appendedRecords: 1 });
    roundTrip("save-checkpoint", {
      checkpointScope: "scope-a", checkpointId: "checkpoint-a", streamId: "stream-a",
      boundSequence: 0, boundRecordHash: tail.recordHash,
      createdAt: "2026-07-27T00:00:01Z", valueHash: "d".repeat(64), valueBytes: 2,
    });
    roundTrip("delete-checkpoint", { deleted: true });
    roundTrip("acquire-lease", lease);
    roundTrip("renew-lease", lease);
    roundTrip("release-lease", {
      status: "released", lease: null, lastLeaseEpoch: 1, lastFencingToken: 1,
    });
    roundTrip("set-legal-hold", {
      legalHoldIds: ["hold-a", "hold-b"],
      retentionMode: "retain-authoritative-history",
      archiveMode: "lossless-before-delete",
      compactionMode: "logical-history-preserving",
    });
    roundTrip("acquire-migration-lock", migration);
    roundTrip("release-migration-lock", null);
  });

  it("rejects non-byte, noncanonical, open, and wrong-operation ledger results", () => {
    expectCode(() => cycleStoreAdapterCodec.decodeLedgerResult(
      "delete-checkpoint",
      { deleted: true } as unknown as Uint8Array,
    ), "GE_CYCLE_STORE_CORRUPTION");
    expectCode(() => cycleStoreAdapterCodec.decodeLedgerResult(
      "delete-checkpoint",
      Buffer.from("{ \"deleted\":true}", "utf8"),
    ), "GE_CYCLE_STORE_CORRUPTION");
    expectCode(() => cycleStoreAdapterCodec.decodeLedgerResult(
      "delete-checkpoint",
      Buffer.from(canonicalSerialize({ deleted: true, unknown: true }), "utf8"),
    ), "GE_CYCLE_STORE_CORRUPTION");
    const deleteBytes = cycleStoreAdapterCodec.encodeLedgerResult(
      "delete-checkpoint",
      { deleted: true },
    );
    expectCode(() => cycleStoreAdapterCodec.decodeLedgerResult(
      "append",
      deleteBytes,
    ), "GE_CYCLE_STORE_CORRUPTION");
  });
});
