import { Buffer } from "node:buffer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  cycleStoreAdapterCodec,
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
  type CycleStoreAuthorizationContext,
  type CycleStoreMutationContext,
  type CycleStoreTail,
} from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { inspectSQLiteCycleStoreIntegrity } from "../src/semantic-integrity.js";
import { SQLiteCycleStoreProvider } from "../src/sqlite-cycle-store.js";

const AUTH: CycleStoreAuthorizationContext = Object.freeze({
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
});
const MISSING: CycleStoreTail = Object.freeze({
  exists: false,
  sequence: -1,
  recordHash: null,
});
const temporaryRoots: string[] = [];

function databasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-sqlite-semantic-"));
  temporaryRoots.push(root);
  return join(root, "cycle-store.db");
}

function mutation(operationId: string): CycleStoreMutationContext {
  return Object.freeze({ ...AUTH, operationId });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite CycleStore semantic integrity", () => {
  it("audits every persisted state family and returns only bounded identities", async () => {
    const path = databasePath();
    const provider = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    const records = [createCycleStoreRecord({
      recordId: "record-0",
      sequence: 0,
      previousRecordHash: null,
      value: { sequence: 0, secret: "PAYLOAD_SENTINEL" },
    })];
    for (let sequence = 1; sequence < 3; sequence += 1) {
      records.push(createCycleStoreRecord({
        recordId: `record-${sequence}`,
        sequence,
        previousRecordHash: records.at(-1)!.recordHash,
        value: { sequence },
      }));
    }
    const appended = await provider.append({
      context: mutation("append"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records,
    });
    const page = await provider.readEventPage({
      context: AUTH,
      streamId: "stream-a",
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    expect(page.nextCursor).not.toBeNull();
    await provider.saveCheckpoint({
      context: mutation("checkpoint"),
      checkpoint: createCycleStoreCheckpoint({
        checkpointScope: "scope-a",
        checkpointId: "checkpoint-a",
        streamId: "stream-a",
        boundSequence: appended.tail.sequence,
        boundRecordHash: appended.tail.recordHash!,
        createdAt: "2026-07-27T00:00:00+00:00",
        value: { folded: 3 },
      }),
      lease: null,
    });
    await provider.acquireLease({
      context: mutation("lease"),
      streamId: "stream-a",
      leaseId: "lease-a",
      holderId: "holder-a",
      ttlMs: 1_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    await provider.setLegalHold({
      context: mutation("hold"),
      streamId: "stream-a",
      holdId: "hold-a",
      action: "place",
    });
    await provider.acquireMigrationLock({
      context: mutation("migration"),
      lockId: "migration-a",
      ownerId: "owner-a",
      sourceSchemaVersion: 1,
      targetSchemaVersion: 2,
      ttlMs: 1_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    provider.close();

    const first = inspectSQLiteCycleStoreIntegrity(path, "semantic");
    const second = inspectSQLiteCycleStoreIntegrity(path, "semantic");
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      level: "semantic",
      quickCheck: "ok",
      integrityCheck: "ok",
      foreignKeyViolations: 0,
      counters: {
        streams: 1,
        records: 3,
        operations: 5,
        checkpoints: 1,
        checkpointRevisions: 1,
        leases: 1,
        usedLeaseIds: 1,
        legalHolds: 1,
        cursors: 1,
        openCursors: 1,
        usedMigrationLockIds: 1,
      },
    });
    expect(first.semanticSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(first)).not.toContain("PAYLOAD_SENTINEL");
    expect(inspectSQLiteCycleStoreIntegrity(path, "quick")).toMatchObject({
      level: "quick",
      integrityCheck: "not-run",
      semanticSha256: null,
    });
  });

  it("detects canonical application corruption that SQLite structural checks cannot see", async () => {
    const path = databasePath();
    const provider = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    const record = createCycleStoreRecord({
      recordId: "record-a",
      sequence: 0,
      previousRecordHash: null,
      value: { original: true },
    });
    await provider.append({
      context: mutation("append"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records: [record],
    });
    provider.close();

    const database = new DatabaseSync(path);
    try {
      database.prepare(`
        UPDATE ge_cycle_records SET record_blob = ?
        WHERE tenant_id = ? AND stream_id = ? AND sequence = 0
      `).run(
        Buffer.from(canonicalSerialize({
          ...record,
          value: { secret: "PAYLOAD_SENTINEL" },
        }), "utf8"),
        "tenant-a",
        "stream-a",
      );
    } finally {
      database.close();
    }

    expect(inspectSQLiteCycleStoreIntegrity(path, "structural")).toMatchObject({
      level: "structural",
      integrityCheck: "ok",
      semanticSha256: null,
    });
    try {
      inspectSQLiteCycleStoreIntegrity(path, "semantic");
      throw new Error("expected semantic corruption failure");
    } catch (error) {
      expect(error).toBeInstanceOf(CycleStoreProviderError);
      expect(error).toMatchObject({ code: "GE_CYCLE_STORE_CORRUPTION" });
      expect(JSON.stringify((error as CycleStoreProviderError).toJSON())).not.toContain(
        "PAYLOAD_SENTINEL",
      );
      expect(JSON.stringify((error as CycleStoreProviderError).toJSON())).not.toContain(path);
    }
  });

  it("rejects a canonical self-consistent ledger result that is split from its mutation", async () => {
    const path = databasePath();
    const provider = new SQLiteCycleStoreProvider(path, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    await provider.append({
      context: mutation("append"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records: [createCycleStoreRecord({
        recordId: "record-a",
        sequence: 0,
        previousRecordHash: null,
        value: { original: true },
      })],
    });
    provider.close();

    const forged = Object.freeze({
      tail: Object.freeze({
        exists: true,
        sequence: 0,
        recordHash: "f".repeat(64),
      }),
      appendedRecords: 1,
    });
    const forgedBlob = Buffer.from(
      cycleStoreAdapterCodec.encodeLedgerResult("append", forged),
    );
    const database = new DatabaseSync(path);
    try {
      database.prepare(`
        UPDATE ge_cycle_operations SET result_blob = ?, result_hash = ?
         WHERE tenant_id = ? AND operation_id = ?
      `).run(forgedBlob, canonicalHash(forged), "tenant-a", "append");
    } finally {
      database.close();
    }

    expect(inspectSQLiteCycleStoreIntegrity(path, "structural")).toMatchObject({
      level: "structural",
      integrityCheck: "ok",
    });
    expect(() => inspectSQLiteCycleStoreIntegrity(path, "semantic")).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_STORE_CORRUPTION" }),
    );
  });

  it("rejects a provider clock high-water below the manifest-bound schema time", () => {
    const path = databasePath();
    const now = "2026-07-27T00:00:00.000Z";
    const provider = new SQLiteCycleStoreProvider(path, { now: () => new Date(now) });
    provider.close();
    const database = new DatabaseSync(path);
    try {
      database.prepare(`
        UPDATE ge_cycle_migration_lock SET updated_at_ms = 0 WHERE singleton = 1
      `).run();
    } finally {
      database.close();
    }
    expect(() => inspectSQLiteCycleStoreIntegrity(path, "semantic")).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_STORE_CORRUPTION" }),
    );
    expect(() => new SQLiteCycleStoreProvider(path, {
      now: () => new Date(now),
    })).toThrowError(expect.objectContaining({ code: "GE_CYCLE_STORE_CORRUPTION" }));
  });

  it("rejects erased lease and migration identity history even when active rows remain valid", async () => {
    const leasePath = databasePath();
    const leaseProvider = new SQLiteCycleStoreProvider(leasePath, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    await leaseProvider.append({
      context: mutation("append-for-lease"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records: [createCycleStoreRecord({
        recordId: "record-for-lease",
        sequence: 0,
        previousRecordHash: null,
        value: { retained: true },
      })],
    });
    await leaseProvider.acquireLease({
      context: mutation("acquire-lease"),
      streamId: "stream-a",
      leaseId: "lease-a",
      holderId: "holder-a",
      ttlMs: 1_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    leaseProvider.close();
    const leaseDatabase = new DatabaseSync(leasePath);
    try {
      leaseDatabase.exec("DELETE FROM ge_cycle_used_lease_ids");
    } finally {
      leaseDatabase.close();
    }
    expect(() => inspectSQLiteCycleStoreIntegrity(leasePath, "semantic")).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_STORE_CORRUPTION" }),
    );

    const migrationPath = databasePath();
    const migrationProvider = new SQLiteCycleStoreProvider(migrationPath, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    await migrationProvider.acquireMigrationLock({
      context: mutation("acquire-migration"),
      lockId: "migration-a",
      ownerId: "owner-a",
      sourceSchemaVersion: 1,
      targetSchemaVersion: 2,
      ttlMs: 1_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    migrationProvider.close();
    const migrationDatabase = new DatabaseSync(migrationPath);
    try {
      migrationDatabase.exec("DELETE FROM ge_cycle_used_migration_lock_ids");
    } finally {
      migrationDatabase.close();
    }
    expect(() => inspectSQLiteCycleStoreIntegrity(migrationPath, "semantic")).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_STORE_CORRUPTION" }),
    );
  });

  it("binds cursor snapshot tails and current checkpoints to immutable history", async () => {
    const cursorPath = databasePath();
    const cursorProvider = new SQLiteCycleStoreProvider(cursorPath, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    const cursorRecords = [createCycleStoreRecord({
      recordId: "cursor-record-0",
      sequence: 0,
      previousRecordHash: null,
      value: { sequence: 0 },
    })];
    for (let sequence = 1; sequence < 3; sequence += 1) {
      cursorRecords.push(createCycleStoreRecord({
        recordId: `cursor-record-${sequence}`,
        sequence,
        previousRecordHash: cursorRecords.at(-1)!.recordHash,
        value: { sequence },
      }));
    }
    await cursorProvider.append({
      context: mutation("cursor-append"),
      streamId: "cursor-stream",
      expectedTail: MISSING,
      lease: null,
      records: cursorRecords,
    });
    const cursorPage = await cursorProvider.readEventPage({
      context: AUTH,
      streamId: "cursor-stream",
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    expect(cursorPage.nextCursor).not.toBeNull();
    cursorProvider.close();
    const cursorDatabase = new DatabaseSync(cursorPath);
    try {
      const forgedHash = "f".repeat(64);
      cursorDatabase.prepare(`
        UPDATE ge_cycle_cursors
           SET snapshot_tail_record_hash = ?, snapshot_blob = ?
         WHERE kind = 'event' AND consumed_at_ms IS NULL
      `).run(
        forgedHash,
        Buffer.from(canonicalSerialize({
          exists: true,
          sequence: 2,
          recordHash: forgedHash,
        }), "utf8"),
      );
    } finally {
      cursorDatabase.close();
    }
    expect(() => inspectSQLiteCycleStoreIntegrity(cursorPath, "semantic")).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_STORE_CORRUPTION" }),
    );

    const checkpointPath = databasePath();
    const checkpointProvider = new SQLiteCycleStoreProvider(checkpointPath, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    const record = createCycleStoreRecord({
      recordId: "checkpoint-record",
      sequence: 0,
      previousRecordHash: null,
      value: { sequence: 0 },
    });
    await checkpointProvider.append({
      context: mutation("checkpoint-append"),
      streamId: "checkpoint-stream",
      expectedTail: MISSING,
      lease: null,
      records: [record],
    });
    await checkpointProvider.saveCheckpoint({
      context: mutation("checkpoint-save"),
      checkpoint: createCycleStoreCheckpoint({
        checkpointScope: "checkpoint-scope",
        checkpointId: "checkpoint-id",
        streamId: "checkpoint-stream",
        boundSequence: 0,
        boundRecordHash: record.recordHash,
        createdAt: "2026-07-27T00:00:00.000Z",
        value: { folded: 1 },
      }),
      lease: null,
    });
    checkpointProvider.close();
    const checkpointDatabase = new DatabaseSync(checkpointPath);
    try {
      checkpointDatabase.exec("UPDATE ge_cycle_checkpoints SET checkpoint_revision = 2");
    } finally {
      checkpointDatabase.close();
    }
    expect(() => inspectSQLiteCycleStoreIntegrity(checkpointPath, "semantic")).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_STORE_CORRUPTION" }),
    );
  });
});
