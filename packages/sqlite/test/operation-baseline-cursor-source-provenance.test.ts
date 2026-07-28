import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import * as sqlitePackage from "../src/index.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import { runSQLiteCheckpointInvariantCampaign } from "../src/operation-baseline-checkpoint-invariants.js";
import { readSQLiteV1BaselineOrderedTempProjection } from "../src/operation-baseline-handoff.js";
import { runSQLiteLeaseLockHoldInvariantCampaign } from "../src/operation-baseline-lease-lock-hold-invariants.js";
import { runSQLiteLegacyInvariantCampaign } from "../src/operation-baseline-legacy-invariants.js";
import { stageSQLiteV1BaselineSourceIntoTempStage } from "../src/operation-baseline-reconcile.js";
import {
  configureSQLiteBaselineTempStorage,
  createSQLiteBaselineTempStage,
  proveSQLiteExclusiveBaselineTransaction,
  type SQLiteBaselineTempStage,
} from "../src/operation-baseline-stage.js";
import { runSQLiteStreamRecordInvariantCampaign } from "../src/operation-baseline-stream-record-invariants.js";
import {
  OperationBaselineAccumulator,
  createOperationBaselineId,
  type OperationBaselineProjectionIdentity,
} from "../src/operation-baseline.js";
import {
  SQLiteCursorPreRebindReceiptIssuer,
  assertSQLiteCursorPreRebindConnectionProvenance,
  assertSQLiteCursorPreRebindConnectionProvenanceWitness,
  assertSQLiteCursorPreRebindReceiptProvenance,
  createSQLiteCursorCaptureSession,
  createSQLiteCursorExactProjectionReference,
  createSQLiteCursorOwnershipCapability,
  type SQLiteCursorPreRebindIssueInput,
  type SQLiteCursorPreRebindReceipt,
} from "../src/operation-baseline-cursor-ownership.js";
import { SQLITE_CURSOR_SEAL_EMPTY_ROOT } from "../src/operation-baseline-cursor-invariants.js";
import {
  captureSQLiteV1BaselineSourceSummary,
  type SQLiteV1BaselineSourceSummary,
} from "../src/operation-baseline-source.js";
import {
  SQLiteConnection,
  readSQLiteConnectionOwnerSnapshot,
} from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";

const CAPTURED_AT_MS = 1_785_110_405_000;
const roots: string[] = [];

function opened(): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-cursor-source-owner-"));
  roots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: CAPTURED_AT_MS,
  });
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  return connection;
}

function issue(
  sourceSummary: SQLiteV1BaselineSourceSummary,
  retainedProjection?: OperationBaselineProjectionIdentity,
): Readonly<{
  input: SQLiteCursorPreRebindIssueInput;
  receipt: SQLiteCursorPreRebindReceipt;
}> {
  let projectionIdentity = retainedProjection;
  if (projectionIdentity === undefined) {
    const accumulator = new OperationBaselineAccumulator(
      createOperationBaselineId(sourceSummary.sourceEnvelope),
      sourceSummary.expectedEntryCount,
    );
    for (const entry of sourceSummary.entries()) accumulator.append(entry);
    projectionIdentity = accumulator.finish();
  }
  const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
  const sealReceipt = Object.freeze({
    cursorCount: 0,
    immutableRootSha256: SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    sourceDescriptorHash: sourceSummary.sourceEnvelope.sourceDescriptorHash,
    sourceSchemaIdentitySha256: sourceSummary.sourceEnvelope.sourceSchemaIdentitySha256,
  });
  const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, 0x10));
  const sourceStageOwnership = createSQLiteCursorOwnershipCapability(
    "source-stage",
    Buffer.alloc(32, 0x20),
  );
  const campaignOwnership = createSQLiteCursorOwnershipCapability(
    "campaign",
    Buffer.alloc(32, 0x30),
  );
  const connectionOwnership = createSQLiteCursorOwnershipCapability(
    "connection",
    Buffer.alloc(32, 0x40),
  );
  const session = createSQLiteCursorCaptureSession({
    campaignOwnership,
    connectionOwnership,
    nonce: Buffer.alloc(32, 0x50),
    sourceStageOwnership,
    tenantOwnership,
  });
  const input = Object.freeze({
    campaignOwnership,
    clockEvidence: sourceSummary.clockEvidence,
    connectionOwnership,
    projectionIdentity,
    projectionReference,
    sealReceipt,
    session,
    sourceStageOwnership,
    sourceSummary,
    tenantOwnership,
  });
  const receipt = new SQLiteCursorPreRebindReceiptIssuer(input).issue(input);
  return Object.freeze({ input, receipt });
}

function close(connection: SQLiteConnection): void {
  if (connection.isOpen && connection.isTransaction) {
    connection.execTrusted("ROLLBACK", "inspect-schema");
  }
  connection.close();
}

describe("SQLite Cursor Slice B captured-source connection provenance", () => {
  it("accepts only the exact real captured summary retained by the A2b receipt", () => {
    const connection = opened();
    try {
      const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
      const { receipt } = issue(sourceSummary);

      expect(assertSQLiteCursorPreRebindReceiptProvenance(receipt).sourceSummary)
        .toBe(sourceSummary);
      const witness = assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt);
      expect(Object.isFrozen(witness)).toBe(true);
      expect(Reflect.ownKeys(witness)).toEqual([]);
      expect(Object.keys(sqlitePackage)).not.toContain(
        "assertSQLiteCursorPreRebindConnectionProvenance",
      );
      expect(Object.keys(sqlitePackage)).not.toContain(
        "assertSQLiteCursorPreRebindConnectionProvenanceWitness",
      );
      expect(Object.keys(sqlitePackage)).not.toContain(
        "assertSQLiteV1BaselineCursorSourceProvenance",
      );
      expect(Object.keys(sqlitePackage)).not.toContain(
        "readSQLiteConnectionOwnerSnapshot",
      );
      expect(assertSQLiteCursorPreRebindConnectionProvenanceWitness(
        connection,
        receipt,
        witness,
      )).toBe(witness);
    } finally {
      close(connection);
    }
  });

  it("rejects a frozen equal-value summary clone even when pure A2b accepts it", () => {
    const connection = opened();
    try {
      const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
      const accumulator = new OperationBaselineAccumulator(
        createOperationBaselineId(sourceSummary.sourceEnvelope),
        sourceSummary.expectedEntryCount,
      );
      for (const entry of sourceSummary.entries()) accumulator.append(entry);
      const clone = Object.freeze({ ...sourceSummary }) as SQLiteV1BaselineSourceSummary;
      const projectionIdentity = accumulator.finish();
      const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
      const sealReceipt = Object.freeze({
        cursorCount: 0,
        immutableRootSha256: SQLITE_CURSOR_SEAL_EMPTY_ROOT,
        sourceDescriptorHash: clone.sourceEnvelope.sourceDescriptorHash,
        sourceSchemaIdentitySha256: clone.sourceEnvelope.sourceSchemaIdentitySha256,
      });
      const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, 1));
      const sourceStageOwnership = createSQLiteCursorOwnershipCapability(
        "source-stage",
        Buffer.alloc(32, 2),
      );
      const campaignOwnership = createSQLiteCursorOwnershipCapability("campaign", Buffer.alloc(32, 3));
      const connectionOwnership = createSQLiteCursorOwnershipCapability(
        "connection",
        Buffer.alloc(32, 4),
      );
      const session = createSQLiteCursorCaptureSession({
        campaignOwnership,
        connectionOwnership,
        nonce: Buffer.alloc(32, 5),
        sourceStageOwnership,
        tenantOwnership,
      });
      const input = Object.freeze({
        campaignOwnership,
        clockEvidence: clone.clockEvidence,
        connectionOwnership,
        projectionIdentity,
        projectionReference,
        sealReceipt,
        session,
        sourceStageOwnership,
        sourceSummary: clone,
        tenantOwnership,
      });
      const receipt = new SQLiteCursorPreRebindReceiptIssuer(input).issue(input);
      expect(assertSQLiteCursorPreRebindReceiptProvenance(receipt).sourceSummary).toBe(clone);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt))
        .toThrow(/captured source provenance/u);
    } finally {
      close(connection);
    }
  });

  it("rejects a synthetic frozen summary and a wrong live connection", () => {
    const owner = opened();
    const wrong = opened();
    try {
      const sourceSummary = captureSQLiteV1BaselineSourceSummary(owner, CAPTURED_AT_MS);
      const { input, receipt } = issue(sourceSummary);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenance(wrong, receipt))
        .toThrow(/captured source provenance/u);

      const synthetic = Object.freeze({
        clockEvidence: sourceSummary.clockEvidence,
        countsByKind: sourceSummary.countsByKind,
        entries: () => (function* syntheticEntries() { /* database-free */ })(),
        expectedEntryCount: sourceSummary.expectedEntryCount,
        sourceEnvelope: sourceSummary.sourceEnvelope,
      }) as SQLiteV1BaselineSourceSummary;
      expect(synthetic).not.toBe(sourceSummary);
      const syntheticInput = Object.freeze({ ...input, sourceSummary: synthetic });
      const syntheticReceipt = new SQLiteCursorPreRebindReceiptIssuer(syntheticInput)
        .issue(syntheticInput);
      expect(assertSQLiteCursorPreRebindReceiptProvenance(syntheticReceipt).sourceSummary)
        .toBe(synthetic);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenance(owner, syntheticReceipt))
        .toThrow(/captured source provenance/u);
    } finally {
      close(owner);
      close(wrong);
    }
  });

  it("revalidates EXCLUSIVE owner epoch on every call and rejects stale-stage reuse", () => {
    const connection = opened();
    try {
      const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
      const { receipt } = issue(sourceSummary);
      const witness = assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenanceWitness(
        connection,
        receipt,
        witness,
      )).not.toThrow();

      connection.execTrusted("ROLLBACK", "inspect-schema");
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      expect(() => assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt))
        .toThrow(/captured transaction/u);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenanceWitness(
        connection,
        receipt,
        witness,
      ))
        .toThrow(/captured transaction/u);
    } finally {
      close(connection);
    }
  });

  it("runs the A2b provenance fence before touching connection state", () => {
    const connection = opened();
    close(connection);
    expect(() => assertSQLiteCursorPreRebindConnectionProvenance(
      connection,
      Object.freeze(Object.create(null)) as SQLiteCursorPreRebindReceipt,
    )).toThrow(/receipt provenance/u);
  });

  it("uses the base-class private snapshot instead of hostile subclass epoch getters", () => {
    class RacingConnection extends SQLiteConnection {
      #armed = false;
      #hostileReads = 0;

      arm(): void {
        this.#armed = true;
      }

      get hostileReads(): number {
        return this.#hostileReads;
      }

      override get transactionEpoch(): bigint {
        const reported = super.transactionEpoch;
        this.#hostileReads += 1;
        if (this.#armed) {
          this.#armed = false;
          this.prepare("PRAGMA schema_version", "inspect-schema").get();
        }
        return reported;
      }
    }

    const root = mkdtempSync(join(tmpdir(), "graph-engineering-cursor-source-race-"));
    roots.push(root);
    const connection = new RacingConnection(join(root, "cycle-store.db"));
    ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
      appliedAtMs: CAPTURED_AT_MS,
    });
    connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    try {
      const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
      const { receipt } = issue(sourceSummary);
      const witness = assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt);
      const beforeFenceReads = connection.hostileReads;

      connection.arm();
      expect(() => assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt))
        .not.toThrow();
      expect(connection.hostileReads).toBe(beforeFenceReads);

      const capturedEpoch = readSQLiteConnectionOwnerSnapshot(connection).transactionEpoch;
      connection.arm();
      const falselyReportedEpoch = connection.transactionEpoch;
      const realEpoch = readSQLiteConnectionOwnerSnapshot(connection).transactionEpoch;
      expect(falselyReportedEpoch).toBe(capturedEpoch);
      expect(realEpoch).toBe(capturedEpoch + 1n);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt))
        .toThrow(/captured transaction/u);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenanceWitness(
        connection,
        receipt,
        witness,
      )).toThrow(/captured transaction/u);
    } finally {
      close(connection);
    }
  });

  it("accepts the real predecessor chain while stage owns advanced total_changes", () => {
    const connection = opened();
    let stage: SQLiteBaselineTempStage | undefined;
    try {
      connection.execTrusted("ROLLBACK", "inspect-schema");
      configureSQLiteBaselineTempStorage(connection);
      connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
      stage = createSQLiteBaselineTempStage(
        connection,
        proveSQLiteExclusiveBaselineTransaction(connection),
      );
      const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
      const captureEpoch = readSQLiteConnectionOwnerSnapshot(connection).transactionEpoch;
      const captureTotalChanges = Number((connection.prepare(
        "SELECT total_changes()",
        "inspect-schema",
      ).get() as unknown as readonly [number | bigint])[0]);
      stageSQLiteV1BaselineSourceIntoTempStage(connection, sourceSummary, stage);
      const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
        connection,
        sourceSummary,
        stage,
      );
      expect(runSQLiteStreamRecordInvariantCampaign(
        connection,
        projectionIdentity,
        stage,
      ).diagnostics).toEqual([]);
      expect(runSQLiteCheckpointInvariantCampaign(
        connection,
        projectionIdentity,
        stage,
      ).diagnostics).toEqual([]);
      expect(runSQLiteLeaseLockHoldInvariantCampaign(
        connection,
        projectionIdentity,
        stage,
      ).diagnostics).toEqual([]);
      expect(runSQLiteLegacyInvariantCampaign(
        connection,
        projectionIdentity,
        stage,
      ).diagnostics).toEqual([]);
      const currentTotalChanges = Number((connection.prepare(
        "SELECT total_changes()",
        "inspect-schema",
      ).get() as unknown as readonly [number | bigint])[0]);
      expect(readSQLiteConnectionOwnerSnapshot(connection).transactionEpoch).toBe(captureEpoch);
      expect(currentTotalChanges).toBeGreaterThan(captureTotalChanges);

      const { receipt } = issue(sourceSummary, projectionIdentity);
      expect(() => assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt))
        .not.toThrow();
      connection.prepare(
        "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        "inspect-schema",
      ).run();
      expect(() => assertSQLiteCursorPreRebindConnectionProvenance(connection, receipt))
        .not.toThrow();
      expect(() => stage?.assertCommonCounts(sourceSummary.countsByKind))
        .toThrow(/unexplained write/u);
    } finally {
      stage?.dispose();
      close(connection);
    }
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
