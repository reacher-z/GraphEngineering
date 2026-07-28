import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const AUTH = Object.freeze({
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const AUTH_B = Object.freeze({
  tenantId: "tenant-b",
  principalHash: "c".repeat(64),
  authorizationHash: "d".repeat(64),
});
const MISSING = Object.freeze({ exists: false, sequence: -1, recordHash: null });
const LEAK_SENTINELS = ["PAYLOAD_SENTINEL", "AUTHORIZATION_SENTINEL", "DATABASE_SENTINEL"];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mutation(operationId, auth = AUTH) {
  return { ...auth, operationId };
}

function records(runtime, count, prefix = "record") {
  const result = [];
  for (let sequence = 0; sequence < count; sequence += 1) {
    result.push(runtime.createCycleStoreRecord({
      recordId: `${prefix}-${sequence}`,
      sequence,
      previousRecordHash: result.at(-1)?.recordHash ?? null,
      value: { sequence, source: prefix },
    }));
  }
  return result;
}

async function createStream(runtime, provider, streamId = "stream-a", auth = AUTH, count = 1) {
  const batch = records(runtime, count, `${auth.tenantId}-${streamId}`);
  await provider.append({
    context: mutation(`create-${auth.tenantId}-${streamId}`, auth),
    streamId,
    expectedTail: MISSING,
    lease: null,
    records: batch,
  });
  return batch;
}

function binding(lease) {
  return {
    leaseId: lease.leaseId,
    holderId: lease.holderId,
    fencingToken: lease.fencingToken,
  };
}

function tailFor(batch) {
  const last = batch.at(-1);
  return last === undefined
    ? MISSING
    : { exists: true, sequence: last.sequence, recordHash: last.recordHash };
}

function checkpoint(runtime, batch, overrides = {}) {
  const last = batch.at(-1);
  return runtime.createCycleStoreCheckpoint({
    checkpointScope: "scope-a",
    checkpointId: "checkpoint-a",
    streamId: "stream-a",
    boundSequence: last.sequence,
    boundRecordHash: last.recordHash,
    createdAt: "2026-07-27T00:00:01Z",
    value: { state: "checkpoint-a" },
    ...overrides,
  });
}

function leaseRequest(operationId = "lease-1", overrides = {}) {
  return {
    context: mutation(operationId),
    streamId: "stream-a",
    leaseId: "lease-1",
    holderId: "holder-a",
    ttlMs: 100,
    mode: "acquire",
    expectedFencingToken: 0,
    ...overrides,
  };
}

function migrationRequest(operationId = "migration-1", overrides = {}) {
  return {
    context: mutation(operationId),
    lockId: "migration-1",
    ownerId: "owner-a",
    sourceSchemaVersion: 1,
    targetSchemaVersion: 2,
    ttlMs: 100,
    mode: "acquire",
    expectedFencingToken: 0,
    ...overrides,
  };
}

function categoryCounts(cases) {
  const counts = {};
  for (const item of cases) counts[item.category] = (counts[item.category] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
}

function aggregateStates(caseResults) {
  const keys = [
    "streams", "records", "recordIds", "checkpoints", "leaseStreams",
    "idempotencyEntries", "cursors", "legalHolds", "migrationFence",
  ];
  return Object.fromEntries(keys.map((key) => [
    key,
    caseResults.reduce((total, result) => total + result.finalState[key], 0),
  ]));
}

export function createMemoryCycleStoreConformanceHarness(runtime) {
  return Object.freeze({
    async createProvider(options = {}) {
      const provider = new runtime.MemoryCycleStoreProvider(options);
      return {
        provider,
        controls: {
          stateCounters: () => provider.unsafeStateCountersForTest(),
          advanceClock: (milliseconds) => provider.unsafeAdvanceClockForTest(milliseconds),
          corruptCheckpoint: (...arguments_) => provider.unsafeCorruptCheckpointForTest(...arguments_),
          setLeaseCounters: (...arguments_) => provider.unsafeSetLeaseCountersForTest(...arguments_),
          injectFailure: (...arguments_) => provider.unsafeInjectFailureForTest(...arguments_),
        },
        cleanup: async () => undefined,
      };
    },
  });
}

async function createHarnessInstance(harness, options = {}) {
  assert.equal(typeof harness?.createProvider, "function", "provider harness factory is required");
  const instance = await harness.createProvider(options);
  assert.ok(instance !== null && typeof instance === "object", "provider harness instance is invalid");
  assert.ok(instance.provider !== null && typeof instance.provider === "object", "provider is missing");
  const cleanup = typeof instance.cleanup === "function"
    ? instance.cleanup
    : async () => {
      if (typeof instance.provider.close === "function") await instance.provider.close();
    };
  try {
    const requiredControls = [
      "stateCounters",
      "advanceClock",
      "corruptCheckpoint",
      "setLeaseCounters",
      "injectFailure",
    ];
    for (const name of requiredControls) {
      assert.equal(typeof instance.controls?.[name], "function", `provider test control ${name} is missing`);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    provider: instance.provider,
    controls: instance.controls,
    cleanup,
  };
}

async function exerciseScenario(item, runtime, core, harness) {
  let instance = await createHarnessInstance(harness);
  let provider = instance.provider;
  let controls = instance.controls;
  const replaceProvider = async (options = {}) => {
    await instance.cleanup();
    instance = null;
    instance = await createHarnessInstance(harness, options);
    provider = instance.provider;
    controls = instance.controls;
  };
  let attackBefore = await controls.stateCounters();
  let observation = {};
  try {
    try {
    const scenario = item.scenario;
    if (scenario === "descriptor-reference") {
      const descriptor = await provider.describe();
      runtime.validateCycleStoreProviderDescriptor(descriptor);
      observation = {
        descriptorHash: descriptor.descriptorHash,
        durability: descriptor.capabilities.durability,
        distributedFencing: descriptor.capabilities.distributedFencing,
      };
    } else if (scenario === "descriptor-durable-profile") {
      const reference = await provider.describe();
      const { descriptorHash: _descriptorHash, ...body } = clone(reference);
      body.providerId = "postgresql-reference";
      body.capabilities = {
        ...body.capabilities,
        durability: "durable",
        distributedFencing: true,
        legalHold: "enforced",
        backupRestore: "enforced",
      };
      body.protection = {
        ...body.protection,
        payloadProtection: "provider-managed",
        encryptionAtRest: "provider-managed",
      };
      body.governance = { ...body.governance, retention: "enforced", archival: "enforced" };
      const descriptor = runtime.validateCycleStoreProviderDescriptor({
        ...body,
        descriptorHash: runtime.hashWithDomain(runtime.CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body),
      });
      observation = {
        providerId: descriptor.providerId,
        durability: descriptor.capabilities.durability,
        distributedFencing: descriptor.capabilities.distributedFencing,
      };
    } else if (scenario === "descriptor-smaller-limits") {
      const reference = await provider.describe();
      const { descriptorHash: _descriptorHash, ...body } = clone(reference);
      body.providerId = "bounded-reference";
      body.limits.maxPageSize = 128;
      const descriptor = runtime.validateCycleStoreProviderDescriptor({
        ...body,
        descriptorHash: runtime.hashWithDomain(runtime.CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body),
      });
      observation = { providerId: descriptor.providerId, maxPageSize: descriptor.limits.maxPageSize };
    } else if (scenario === "schema-inspection") {
      observation = await provider.inspectSchema(AUTH);
    } else if (scenario === "descriptor-unknown-field") {
      const descriptor = clone(await provider.describe());
      descriptor.unknown = true;
      attackBefore = await controls.stateCounters();
      runtime.validateCycleStoreProviderDescriptor(descriptor);
    } else if (scenario === "descriptor-limit-overflow") {
      const descriptor = clone(await provider.describe());
      descriptor.limits.maxPageSize = 257;
      attackBefore = await controls.stateCounters();
      runtime.validateCycleStoreProviderDescriptor(descriptor);
    } else if (scenario === "empty-tail") {
      observation = await provider.readTail({ context: AUTH, streamId: "missing" });
    } else if (scenario === "append-single" || scenario === "append-atomic-batch") {
      const count = scenario === "append-single" ? 1 : 3;
      observation = await provider.append({
        context: mutation("append"), streamId: "stream-a", expectedTail: MISSING,
        lease: null, records: records(runtime, count),
      });
    } else if (scenario === "append-exact-retry") {
      const request = {
        context: mutation("append-retry"), streamId: "stream-a", expectedTail: MISSING,
        lease: null, records: records(runtime, 1),
      };
      const first = await provider.append(request);
      const second = await provider.append(request);
      observation = { first, second, recordCount: (await controls.stateCounters()).records };
    } else if (scenario === "append-commit-then-throw") {
      let armed = true;
      await replaceProvider({
        faultHook: (boundary) => {
          if (armed && boundary === "provider:append:after-commit-before-return") {
            armed = false;
            throw new Error("DATABASE_SENTINEL");
          }
        },
      });
      const request = {
        context: mutation("ambiguous"), streamId: "stream-a", expectedTail: MISSING,
        lease: null, records: records(runtime, 1),
      };
      let firstCode = null;
      try { await provider.append(request); } catch (error) {
        assert.ok(error instanceof runtime.CycleStoreProviderError);
        firstCode = error.code;
      }
      const recovered = await provider.append(request);
      observation = { firstCode, recovered, recordCount: (await controls.stateCounters()).records };
    } else if (scenario.startsWith("append-")) {
      const initial = await createStream(runtime, provider);
      const next = runtime.createCycleStoreRecord({
        recordId: "next-record",
        sequence: 1,
        previousRecordHash: initial[0].recordHash,
        value: { next: true },
      });
      if (scenario === "append-cas-loss") {
        attackBefore = await controls.stateCounters();
        await provider.append({
          context: mutation("cas-loss"), streamId: "stream-a", expectedTail: MISSING,
          lease: null, records: [next],
        });
      } else if (scenario === "append-expected-hash-drift") {
        attackBefore = await controls.stateCounters();
        await provider.append({
          context: mutation("hash-drift"), streamId: "stream-a",
          expectedTail: { exists: true, sequence: 0, recordHash: "f".repeat(64) },
          lease: null, records: [next],
        });
      } else if (scenario === "append-broken-chain") {
        const broken = runtime.createCycleStoreRecord({
          recordId: "broken", sequence: 1, previousRecordHash: "e".repeat(64),
          value: { broken: true },
        });
        attackBefore = await controls.stateCounters();
        await provider.append({
          context: mutation("broken"), streamId: "stream-a", expectedTail: tailFor(initial),
          lease: null, records: [broken],
        });
      } else if (scenario === "append-duplicate-record-id") {
        const duplicate = runtime.createCycleStoreRecord({
          recordId: initial[0].recordId, sequence: 1, previousRecordHash: initial[0].recordHash,
          value: { duplicate: true },
        });
        attackBefore = await controls.stateCounters();
        await provider.append({
          context: mutation("duplicate"), streamId: "stream-a", expectedTail: tailFor(initial),
          lease: null, records: [duplicate],
        });
      } else if (scenario === "append-operation-request-drift") {
        const originalRequest = {
          context: mutation("shared-append"), streamId: "other", expectedTail: MISSING,
          lease: null, records: records(runtime, 1, "original"),
        };
        await provider.append(originalRequest);
        attackBefore = await controls.stateCounters();
        await provider.append({ ...originalRequest, records: records(runtime, 1, "changed") });
      } else if (scenario === "append-operation-name-reuse") {
        const request = {
          context: mutation("cross-operation"), streamId: "other", expectedTail: MISSING,
          lease: null, records: records(runtime, 1, "cross"),
        };
        await provider.append(request);
        attackBefore = await controls.stateCounters();
        await provider.deleteCheckpoint({
          context: mutation("cross-operation"), checkpointScope: "scope-a",
          checkpointId: "missing", expectedValueHash: null,
        });
      } else if (scenario === "append-count-overflow") {
        await replaceProvider();
        attackBefore = await controls.stateCounters();
        await provider.append({
          context: mutation("overflow"), streamId: "stream-a", expectedTail: MISSING,
          lease: null, records: records(runtime, 65, "overflow"),
        });
      } else throw new TypeError(`unknown append scenario ${scenario}`);
    } else if (scenario === "event-exact-traversal") {
      await createStream(runtime, provider, "stream-a", AUTH, 5);
      const sequences = [];
      let cursor = null;
      let snapshotTail = null;
      do {
        const page = await provider.readEventPage({
          context: AUTH, streamId: "stream-a", fromSequence: cursor === null ? 0 : null,
          pageSize: 2, cursor,
        });
        sequences.push(...page.records.map(({ sequence }) => sequence));
        snapshotTail = page.snapshotTail;
        cursor = page.nextCursor;
      } while (cursor !== null);
      observation = { sequences, snapshotTail, nextCursor: cursor };
    } else if (scenario === "event-append-during-scan") {
      const initial = await createStream(runtime, provider, "stream-a", AUTH, 3);
      const first = await provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
      });
      const later = runtime.createCycleStoreRecord({
        recordId: "later", sequence: 3, previousRecordHash: initial[2].recordHash,
        value: { later: true },
      });
      await provider.append({
        context: mutation("later"), streamId: "stream-a", expectedTail: tailFor(initial),
        lease: null, records: [later],
      });
      const remaining = [];
      let cursor = first.nextCursor;
      while (cursor !== null) {
        const page = await provider.readEventPage({
          context: AUTH, streamId: "stream-a", fromSequence: null, pageSize: 1, cursor,
        });
        remaining.push(...page.records.map(({ sequence }) => sequence));
        cursor = page.nextCursor;
      }
      observation = {
        snapshotSequences: [first.records[0].sequence, ...remaining],
        snapshotTail: first.snapshotTail,
        currentTail: await provider.readTail({ context: AUTH, streamId: "stream-a" }),
      };
    } else if (scenario === "event-beyond-tail") {
      await createStream(runtime, provider, "stream-a", AUTH, 2);
      observation = await provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 9, pageSize: 2, cursor: null,
      });
    } else if (scenario === "event-missing-stream") {
      observation = await provider.readEventPage({
        context: AUTH, streamId: "missing", fromSequence: 0, pageSize: 2, cursor: null,
      });
    } else if (scenario.startsWith("event-cursor-")) {
      await createStream(runtime, provider, "stream-a", AUTH, 3);
      if (scenario === "event-cursor-stream-scope") await createStream(runtime, provider, "stream-b", AUTH, 1);
      const first = await provider.readEventPage({
        context: AUTH, streamId: "stream-a", fromSequence: 0, pageSize: 1, cursor: null,
      });
      attackBefore = await controls.stateCounters();
      if (scenario === "event-cursor-tenant-scope") {
        await provider.readEventPage({
          context: AUTH_B, streamId: "stream-a", fromSequence: null, pageSize: 1,
          cursor: first.nextCursor,
        });
      } else if (scenario === "event-cursor-stream-scope") {
        await provider.readEventPage({
          context: AUTH, streamId: "stream-b", fromSequence: null, pageSize: 1,
          cursor: first.nextCursor,
        });
      } else if (scenario === "event-cursor-page-size") {
        await provider.readEventPage({
          context: AUTH, streamId: "stream-a", fromSequence: null, pageSize: 2,
          cursor: first.nextCursor,
        });
      } else if (scenario === "event-cursor-tamper") {
        await provider.readEventPage({
          context: AUTH, streamId: "stream-a", fromSequence: null, pageSize: 1,
          cursor: "cursor-not-valid!",
        });
      } else throw new TypeError(`unknown cursor scenario ${scenario}`);
    } else if (scenario.startsWith("checkpoint-")) {
      const batch = await createStream(runtime, provider, "stream-a", AUTH, 2);
      const base = checkpoint(runtime, batch);
      if (scenario === "checkpoint-save-load") {
        const summary = await provider.saveCheckpoint({
          context: mutation("save"), checkpoint: base, lease: null,
        });
        const loaded = await provider.loadCheckpoint({
          context: AUTH, checkpointScope: "scope-a", checkpointId: "checkpoint-a",
        });
        observation = { summary, loaded };
      } else if (scenario === "checkpoint-list-order") {
        const second = checkpoint(runtime, batch, {
          checkpointId: "checkpoint-b", createdAt: "2026-07-27T00:00:02Z",
          value: { state: "checkpoint-b" },
        });
        await provider.saveCheckpoint({ context: mutation("save-a"), checkpoint: base, lease: null });
        await provider.saveCheckpoint({ context: mutation("save-b"), checkpoint: second, lease: null });
        const page = await provider.listCheckpoints({
          context: AUTH, checkpointScope: "scope-a", pageSize: 2, cursor: null,
        });
        observation = { checkpointIds: page.checkpoints.map(({ checkpointId }) => checkpointId) };
      } else if (scenario === "checkpoint-delete") {
        await provider.saveCheckpoint({ context: mutation("save"), checkpoint: base, lease: null });
        const deleted = await provider.deleteCheckpoint({
          context: mutation("delete"), checkpointScope: "scope-a",
          checkpointId: "checkpoint-a", expectedValueHash: base.valueHash,
        });
        observation = {
          deleted,
          tail: await provider.readTail({ context: AUTH, streamId: "stream-a" }),
          loaded: await provider.loadCheckpoint({
            context: AUTH, checkpointScope: "scope-a", checkpointId: "checkpoint-a",
          }),
        };
      } else if (scenario === "checkpoint-exact-retry") {
        const request = { context: mutation("save"), checkpoint: base, lease: null };
        const first = await provider.saveCheckpoint(request);
        const second = await provider.saveCheckpoint(request);
        observation = { first, second };
      } else if (scenario === "checkpoint-stale-tail") {
        const stale = checkpoint(runtime, [batch[0]], { checkpointId: "stale" });
        attackBefore = await controls.stateCounters();
        await provider.saveCheckpoint({ context: mutation("stale"), checkpoint: stale, lease: null });
      } else if (scenario === "checkpoint-content-hash-drift") {
        const drifted = clone(base);
        drifted.value = { state: "PAYLOAD_SENTINEL" };
        attackBefore = await controls.stateCounters();
        await provider.saveCheckpoint({ context: mutation("drift"), checkpoint: drifted, lease: null });
      } else if (scenario === "checkpoint-immutable-id") {
        await provider.saveCheckpoint({ context: mutation("save"), checkpoint: base, lease: null });
        const changed = checkpoint(runtime, batch, { value: { state: "changed" } });
        attackBefore = await controls.stateCounters();
        await provider.saveCheckpoint({ context: mutation("changed"), checkpoint: changed, lease: null });
      } else if (scenario === "checkpoint-corrupt-load") {
        await provider.saveCheckpoint({ context: mutation("save"), checkpoint: base, lease: null });
        await controls.corruptCheckpoint("tenant-a", "scope-a", "checkpoint-a", {
          ...base, value: { state: "PAYLOAD_SENTINEL" },
        });
        attackBefore = await controls.stateCounters();
        await provider.loadCheckpoint({
          context: AUTH, checkpointScope: "scope-a", checkpointId: "checkpoint-a",
        });
      } else throw new TypeError(`unknown checkpoint scenario ${scenario}`);
    } else if (scenario.startsWith("lease-")) {
      const initial = await createStream(runtime, provider);
      const firstRequest = leaseRequest();
      if (scenario === "lease-first-acquire") {
        observation = await provider.acquireLease(firstRequest);
      } else if (scenario === "lease-renew") {
        const first = await provider.acquireLease(firstRequest);
        await controls.advanceClock(10);
        observation = await provider.renewLease({
          context: mutation("renew"), streamId: "stream-a", lease: binding(first), ttlMs: 200,
        });
      } else if (scenario === "lease-release-reacquire") {
        const first = await provider.acquireLease(firstRequest);
        const released = await provider.releaseLease({
          context: mutation("release"), streamId: "stream-a", lease: binding(first),
        });
        const second = await provider.acquireLease(leaseRequest("lease-2", {
          leaseId: "lease-2", holderId: "holder-b", expectedFencingToken: 1,
        }));
        observation = { released, second };
      } else if (scenario === "lease-expired-takeover") {
        const first = await provider.acquireLease(firstRequest);
        await controls.advanceClock(100);
        const second = await provider.acquireLease(leaseRequest("takeover", {
          leaseId: "lease-2", holderId: "holder-b", mode: "takeover", expectedFencingToken: 1,
        }));
        observation = { firstFence: first.fencingToken, second };
      } else if (scenario === "lease-exact-retry") {
        const first = await provider.acquireLease(firstRequest);
        await controls.advanceClock(1_000);
        const second = await provider.acquireLease(firstRequest);
        observation = { first, second };
      } else {
        const first = await provider.acquireLease(firstRequest);
        const next = runtime.createCycleStoreRecord({
          recordId: "next", sequence: 1, previousRecordHash: initial[0].recordHash,
          value: { next: true },
        });
        if (scenario === "lease-active-owner-conflict") {
          attackBefore = await controls.stateCounters();
          await provider.acquireLease(leaseRequest("second", {
            leaseId: "lease-2", holderId: "holder-b", expectedFencingToken: 1,
          }));
        } else if (scenario === "lease-early-takeover") {
          attackBefore = await controls.stateCounters();
          await provider.acquireLease(leaseRequest("early", {
            leaseId: "lease-2", holderId: "holder-b", mode: "takeover", expectedFencingToken: 1,
          }));
        } else if (scenario === "lease-stale-renew") {
          attackBefore = await controls.stateCounters();
          await provider.renewLease({
            context: mutation("stale-renew"), streamId: "stream-a",
            lease: { ...binding(first), holderId: "substituted" }, ttlMs: 200,
          });
        } else if (scenario === "lease-stale-release") {
          await controls.advanceClock(100);
          attackBefore = await controls.stateCounters();
          await provider.releaseLease({
            context: mutation("stale-release"), streamId: "stream-a", lease: binding(first),
          });
        } else if (scenario === "lease-stale-write") {
          attackBefore = await controls.stateCounters();
          await provider.append({
            context: mutation("stale-write"), streamId: "stream-a", expectedTail: tailFor(initial),
            lease: null, records: [next],
          });
        } else if (scenario === "lease-expired-write") {
          await controls.advanceClock(100);
          attackBefore = await controls.stateCounters();
          await provider.append({
            context: mutation("expired-write"), streamId: "stream-a", expectedTail: tailFor(initial),
            lease: binding(first), records: [next],
          });
        } else if (scenario === "lease-fence-overflow") {
          await controls.setLeaseCounters(
            "tenant-a", "stream-a", Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER,
          );
          attackBefore = await controls.stateCounters();
          await provider.acquireLease(leaseRequest("overflow", {
            leaseId: "overflow", expectedFencingToken: Number.MAX_SAFE_INTEGER,
          }));
        } else throw new TypeError(`unknown lease scenario ${scenario}`);
      }
    } else if (scenario === "tenant-same-id-isolation") {
      const left = runtime.createCycleStoreRecord({
        recordId: "shared-record", sequence: 0, previousRecordHash: null, value: { tenant: "a" },
      });
      const right = runtime.createCycleStoreRecord({
        recordId: "shared-record", sequence: 0, previousRecordHash: null, value: { tenant: "b" },
      });
      await provider.append({
        context: mutation("tenant-a", AUTH), streamId: "shared", expectedTail: MISSING,
        lease: null, records: [left],
      });
      await provider.append({
        context: mutation("tenant-b", AUTH_B), streamId: "shared", expectedTail: MISSING,
        lease: null, records: [right],
      });
      observation = {
        tenantA: await provider.readTail({ context: AUTH, streamId: "shared" }),
        tenantB: await provider.readTail({ context: AUTH_B, streamId: "shared" }),
      };
    } else if (scenario === "safe-error-envelope") {
      await controls.injectFailure("read-tail", "GE_CYCLE_STORE_UNAVAILABLE");
      let serialized = null;
      try {
        await provider.readTail({ context: AUTH, streamId: "PAYLOAD_SENTINEL" });
      } catch (error) {
        assert.ok(error instanceof runtime.CycleStoreProviderError);
        serialized = error.toJSON();
      }
      const text = core.canonicalSerialize(serialized);
      assert.equal(text.includes("stack"), false);
      assert.equal(text.includes("cause"), false);
      assert.equal(text.includes("PAYLOAD_SENTINEL"), false);
      observation = serialized;
    } else if (scenario === "authorization-denied-lookup") {
      await replaceProvider({ authorize: () => false });
      attackBefore = await controls.stateCounters();
      await provider.readTail({
        context: { ...AUTH, authorizationHash: "f".repeat(64) }, streamId: "PAYLOAD_SENTINEL",
      });
    } else if (scenario === "injected-error-classification") {
      const caughtCodes = [];
      for (const code of ["GE_CYCLE_STORE_UNAVAILABLE", "GE_CYCLE_STORE_CORRUPTION"]) {
        await controls.injectFailure("read-tail", code);
        try { await provider.readTail({ context: AUTH, streamId: "stream-a" }); } catch (error) {
          assert.ok(error instanceof runtime.CycleStoreProviderError);
          caughtCodes.push(error.code);
        }
      }
      observation = { caughtCodes };
      await controls.injectFailure("read-tail", "GE_CYCLE_STORE_QUOTA_EXCEEDED");
      attackBefore = await controls.stateCounters();
      await provider.readTail({ context: AUTH, streamId: "stream-a" });
    } else if (scenario === "governance-hold-declarations") {
      await createStream(runtime, provider);
      const placed = await provider.setLegalHold({
        context: mutation("hold"), streamId: "stream-a", holdId: "legal-1", action: "place",
      });
      observation = {
        placed,
        inspected: await provider.inspectGovernance({ context: AUTH, streamId: "stream-a" }),
        descriptorGovernance: (await provider.describe()).governance,
      };
    } else if (scenario === "migration-retry-takeover") {
      const request = migrationRequest();
      const first = await provider.acquireMigrationLock(request);
      const retry = await provider.acquireMigrationLock(request);
      await controls.advanceClock(100);
      const takeover = await provider.acquireMigrationLock(migrationRequest("migration-2", {
        lockId: "migration-2", ownerId: "owner-b", mode: "takeover", expectedFencingToken: 1,
      }));
      observation = { first, retry, takeover };
    } else if (scenario === "migration-live-lock-conflict") {
      await provider.acquireMigrationLock(migrationRequest());
      attackBefore = await controls.stateCounters();
      await provider.acquireMigrationLock(migrationRequest("migration-2", {
        lockId: "migration-2", ownerId: "owner-b", expectedFencingToken: 1,
      }));
    } else if (scenario === "migration-blocks-online-writer") {
      const initial = await createStream(runtime, provider);
      await provider.acquireMigrationLock(migrationRequest());
      const next = runtime.createCycleStoreRecord({
        recordId: "blocked", sequence: 1, previousRecordHash: initial[0].recordHash,
        value: { secret: "PAYLOAD_SENTINEL" },
      });
      attackBefore = await controls.stateCounters();
      await provider.append({
        context: mutation("blocked"), streamId: "stream-a", expectedTail: tailFor(initial),
        lease: null, records: [next],
      });
    } else throw new TypeError(`unknown CycleStore provider scenario ${String(scenario)}`);

    assert.notEqual(item.polarity, "attack", `${item.id}: attack unexpectedly succeeded`);
    const finalState = await controls.stateCounters();
    return {
      id: item.id,
      category: item.category,
      polarity: item.polarity,
      outcome: item.expectOutcome,
      code: null,
      operation: null,
      retryable: null,
      zeroMutation: null,
      observation,
      finalState,
    };
  } catch (error) {
    assert.equal(item.polarity, "attack", `${item.id}: behavior raised ${String(error)}`);
    assert.ok(
      error instanceof runtime.CycleStoreProviderError,
      `${item.id}: generic exceptions cannot satisfy provider conformance`,
    );
    assert.equal(error.code, item.expectCode, `${item.id}: exact provider code drifted`);
    const finalState = await controls.stateCounters();
    assert.deepEqual(finalState, attackBefore, `${item.id}: rejected operation mutated state`);
    const serialized = error.toJSON();
    const serializedText = core.canonicalSerialize(serialized);
    for (const sentinel of LEAK_SENTINELS) {
      assert.equal(serializedText.includes(sentinel), false, `${item.id}: leaked ${sentinel}`);
    }
    return {
      id: item.id,
      category: item.category,
      polarity: item.polarity,
      outcome: "rejected",
      code: error.code,
      operation: error.operation,
      retryable: error.retryable,
      zeroMutation: true,
      observation,
      finalState,
    };
    }
  } finally {
    if (instance !== null) await instance.cleanup();
  }
}

export async function exerciseCycleStoreProviderCampaign({ runtime, core, fixture, harness }) {
  const providerHarness = harness ?? createMemoryCycleStoreConformanceHarness(runtime);
  assert.deepEqual(Object.keys(fixture).sort(), [
    "cases",
    "contractVersion",
    "descriptorSchema",
    "errorCodes",
    "expect",
    "hashDomains",
    "id",
    "requiredAssertions",
    "schemaVersion",
  ]);
  assert.equal(fixture.id, "cycle-store-provider-v1alpha1");
  assert.equal(fixture.contractVersion, runtime.CYCLE_STORE_PROVIDER_CONTRACT_VERSION);
  assert.deepEqual(fixture.errorCodes, [...runtime.CYCLE_STORE_PROVIDER_ERROR_CODES]);
  assert.deepEqual(fixture.hashDomains, {
    descriptor: runtime.CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN,
    record: runtime.CYCLE_STORE_RECORD_DOMAIN,
    operation: runtime.CYCLE_STORE_OPERATION_DOMAIN,
  });
  const ids = fixture.cases.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, "CycleStore provider case IDs must be unique");
  assert.equal(new Set(fixture.cases.map(({ assertion }) => assertion)).size, fixture.cases.length);
  for (const item of fixture.cases) {
    assert.deepEqual(Object.keys(item).sort(), [
      "assertion", "category", "expectCode", "expectOutcome", "id", "mutation", "polarity", "scenario",
    ]);
  }
  const caseResults = [];
  for (const item of fixture.cases) {
    caseResults.push(await exerciseScenario(item, runtime, core, providerHarness));
  }
  const attackCaseCount = fixture.cases.filter(({ polarity }) => polarity === "attack").length;
  const behaviorCaseCount = fixture.cases.filter(({ polarity }) => polarity === "behavior").length;
  assert.equal(fixture.cases.length, fixture.expect.caseCount);
  assert.equal(attackCaseCount, fixture.expect.attackCaseCount);
  assert.equal(behaviorCaseCount, fixture.expect.behaviorCaseCount);
  assert.deepEqual(categoryCounts(fixture.cases), fixture.expect.categoryCounts);
  const caseListCanonical = core.canonicalSerialize(fixture.cases);
  assert.equal(Buffer.byteLength(caseListCanonical, "utf8"), fixture.expect.casesCanonicalUtf8Bytes);
  const caseListSha256 = createHash("sha256").update(caseListCanonical, "utf8").digest("hex");
  assert.equal(caseListSha256, fixture.expect.casesSha256);
  const probeRecord = runtime.createCycleStoreRecord({
    recordId: "conformance-probe",
    sequence: 0,
    previousRecordHash: null,
    value: { probe: true },
  });
  const probeRequest = {
    context: mutation("conformance-probe"),
    streamId: "conformance-probe",
    expectedTail: MISSING,
    lease: null,
    records: [probeRecord],
  };
  const report = {
    campaign: fixture.id,
    contractVersion: fixture.contractVersion,
    descriptorHash: caseResults.find(({ id }) => id === "descriptor-reference")
      ?.observation.descriptorHash,
    caseCount: fixture.cases.length,
    attackCaseCount,
    behaviorCaseCount,
    categoryCounts: categoryCounts(fixture.cases),
    caseListCanonicalUtf8Bytes: Buffer.byteLength(caseListCanonical, "utf8"),
    caseListSha256,
    probeIdentities: {
      recordHash: probeRecord.recordHash,
      operationHash: runtime.hashWithDomain(runtime.CYCLE_STORE_OPERATION_DOMAIN, {
        operation: "append",
        request: probeRequest,
      }),
    },
    caseResults,
    aggregateFinalState: aggregateStates(caseResults),
    leakSentinelScan: "clean",
  };
  const reportText = core.canonicalSerialize(report);
  for (const sentinel of LEAK_SENTINELS) assert.equal(reportText.includes(sentinel), false);
  return report;
}
