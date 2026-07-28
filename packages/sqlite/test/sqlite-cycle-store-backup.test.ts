import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CycleStoreProviderError,
  createCycleStoreRecord,
  type CycleStoreAuthorizationContext,
  type CycleStoreMutationContext,
  type CycleStoreTail,
} from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSQLiteCycleStoreBackup,
  restoreSQLiteCycleStoreBackup,
} from "../src/cycle-store-backup.js";
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

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-cycle-backup-"));
  temporaryRoots.push(root);
  return root;
}

function mutation(operationId: string): CycleStoreMutationContext {
  return Object.freeze({ ...AUTH, operationId });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("manifest-bound SQLite CycleStore backup and restore", () => {
  it("backs up a live WAL, verifies semantics, restores, and continues durable identities", async () => {
    const root = temporaryRoot();
    const source = join(root, "live.db");
    const backup = join(root, "evidence.db");
    const restored = join(root, "restored.db");
    let now = Date.parse("2026-07-27T00:00:00.000Z");
    const provider = new SQLiteCycleStoreProvider(source, { now: () => new Date(now) });
    const records = [createCycleStoreRecord({
      recordId: "record-0",
      sequence: 0,
      previousRecordHash: null,
      value: { secret: "PAYLOAD_SENTINEL", sequence: 0 },
    })];
    for (let sequence = 1; sequence < 3; sequence += 1) {
      records.push(createCycleStoreRecord({
        recordId: `record-${sequence}`,
        sequence,
        previousRecordHash: records.at(-1)!.recordHash,
        value: { sequence },
      }));
    }
    const appendRequest = {
      context: mutation("append"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records,
    } as const;
    const appended = await provider.append(appendRequest);
    const firstPage = await provider.readEventPage({
      context: AUTH,
      streamId: "stream-a",
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    expect(firstPage.nextCursor).not.toBeNull();
    const lease = await provider.acquireLease({
      context: mutation("lease"),
      streamId: "stream-a",
      leaseId: "lease-a",
      holderId: "holder-a",
      ttlMs: 10_000,
      mode: "acquire",
      expectedFencingToken: 0,
    });
    await provider.setLegalHold({
      context: mutation("hold"),
      streamId: "stream-a",
      holdId: "hold-a",
      action: "place",
    });

    const backupReport = await createSQLiteCycleStoreBackup(source, backup);
    expect(backupReport).toMatchObject({
      path: backup,
      manifestPath: `${backup}.manifest.json`,
      integrity: {
        level: "semantic",
        counters: { records: 3, leases: 1, legalHolds: 1, openCursors: 1 },
      },
    });
    expect(backupReport.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(backupReport.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
    const manifestText = readFileSync(`${backup}.manifest.json`, "utf8");
    expect(manifestText).not.toContain("PAYLOAD_SENTINEL");
    expect(manifestText).not.toContain(source);

    provider.close();
    const restoreReport = await restoreSQLiteCycleStoreBackup(backup, restored);
    expect(restoreReport.sourceManifestSha256).toBe(backupReport.manifestSha256);
    expect(restoreReport.integrity.semanticSha256).toBe(
      backupReport.integrity.semanticSha256,
    );

    now += 1_000;
    const reopened = new SQLiteCycleStoreProvider(restored, { now: () => new Date(now) });
    try {
      expect(await reopened.readTail({ context: AUTH, streamId: "stream-a" })).toEqual(
        appended.tail,
      );
      expect(await reopened.append(appendRequest)).toEqual(appended);
      const continuation = await reopened.readEventPage({
        context: AUTH,
        streamId: "stream-a",
        fromSequence: null,
        pageSize: 1,
        cursor: firstPage.nextCursor,
      });
      expect(continuation.records.map(({ sequence }) => sequence)).toEqual([1]);
      expect(await reopened.inspectLease({ context: AUTH, streamId: "stream-a" })).toMatchObject({
        status: "active",
        lease,
        lastFencingToken: 1,
      });
      expect(await reopened.inspectGovernance({ context: AUTH, streamId: "stream-a" }))
        .toMatchObject({ legalHoldIds: ["hold-a"] });
    } finally {
      reopened.close();
    }
  });

  it("refuses overwrite, source alias, and a tampered manifest without leaking bytes", async () => {
    const root = temporaryRoot();
    const source = join(root, "live.db");
    const backup = join(root, "evidence.db");
    const provider = new SQLiteCycleStoreProvider(source, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });
    const record = createCycleStoreRecord({
      recordId: "record-a",
      sequence: 0,
      previousRecordHash: null,
      value: { value: true },
    });
    await provider.append({
      context: mutation("append"),
      streamId: "stream-a",
      expectedTail: MISSING,
      lease: null,
      records: [record],
    });

    await expect(createSQLiteCycleStoreBackup(source, source)).rejects.toMatchObject({
      code: "GE_CYCLE_STORE_INVALID_ARGUMENT",
    });
    const hardLinkAlias = join(root, "source-hard-link.db");
    linkSync(source, hardLinkAlias);
    await expect(createSQLiteCycleStoreBackup(source, hardLinkAlias)).rejects.toMatchObject({
      code: "GE_CYCLE_STORE_INVALID_ARGUMENT",
    });
    await createSQLiteCycleStoreBackup(source, backup);
    await expect(createSQLiteCycleStoreBackup(source, backup)).rejects.toMatchObject({
      code: "GE_CYCLE_STORE_CONFLICT",
    });
    provider.close();

    writeFileSync(
      `${backup}.manifest.json`,
      '{"secret":"PAYLOAD_SENTINEL"}',
      "utf8",
    );
    try {
      await restoreSQLiteCycleStoreBackup(backup, join(root, "restored.db"));
      throw new Error("expected restore refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(CycleStoreProviderError);
      expect(error).toMatchObject({ code: "GE_CYCLE_STORE_CORRUPTION" });
      expect(JSON.stringify((error as CycleStoreProviderError).toJSON())).not.toContain(
        "PAYLOAD_SENTINEL",
      );
      expect(JSON.stringify((error as CycleStoreProviderError).toJSON())).not.toContain(root);
    }
  });
});
