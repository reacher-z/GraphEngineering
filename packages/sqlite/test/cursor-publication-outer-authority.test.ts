import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  activateSQLiteCursorOuterPublicationAuthorityIntrinsic,
  assertSQLiteCursorOuterPublicationAuthorityIntrinsic,
  createSQLiteCursorOuterPublicationCancellationControllerIntrinsic,
  prepareSQLiteCursorOuterPublicationAuthorityIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  type SQLiteCursorOuterPublicationAuthority,
} from "../src/cursor-publication-outer-authority.js";
import {
  assertSQLiteCursorProviderClockConsumedTombstoneIntrinsic,
  consumeSQLiteCursorProviderClockEvidenceIntrinsic,
  createSQLiteCursorMigrationLockCapabilityIntrinsic,
  createSQLiteCursorProviderClockCapabilityIntrinsic,
  createSQLiteCursorProviderClockSourceIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
  type SQLiteCursorMigrationLockCapability,
  type SQLiteCursorMigrationLockIdentity,
  type SQLiteCursorProviderClockCapability,
  type SQLiteCursorProviderClockEvidence,
} from "../src/cursor-publication-clock-authority.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import { runSQLiteCheckpointInvariantCampaign } from
  "../src/operation-baseline-checkpoint-invariants.js";
import { runSQLiteCursorPreRebindCampaign } from
  "../src/operation-baseline-cursor-campaign.js";
import {
  assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic,
  assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic,
  beginSQLiteCursorStageOwnershipTransfer,
  beginSQLiteCursorPreRebindStageCampaign,
  createSQLiteCursorSealTempTable,
  diagnoseSQLiteCursorPreRebindStageCampaign,
  mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic,
  publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  type SQLiteCursorStageOwnershipTransfer,
} from "../src/operation-baseline-cursor-stage-ownership.js";
import { runSQLiteLeaseLockHoldInvariantCampaign } from
  "../src/operation-baseline-lease-lock-hold-invariants.js";
import { runSQLiteLegacyInvariantCampaign } from
  "../src/operation-baseline-legacy-invariants.js";
import { stageSQLiteV1BaselineSourceIntoTempStage } from
  "../src/operation-baseline-reconcile.js";
import {
  configureSQLiteBaselineTempStorage,
  createSQLiteBaselineTempStage,
  proveSQLiteExclusiveBaselineTransaction,
  type SQLiteBaselineTempStage,
} from "../src/operation-baseline-stage.js";
import { runSQLiteStreamRecordInvariantCampaign } from
  "../src/operation-baseline-stream-record-invariants.js";
import { readSQLiteV1BaselineOrderedTempProjection } from
  "../src/operation-baseline-handoff.js";
import {
  SQLiteCursorPreRebindReceiptIssuer,
  assertSQLiteCursorPreRebindReceiptProvenance,
  createSQLiteCursorCaptureSession,
  createSQLiteCursorExactProjectionReference,
  createSQLiteCursorOwnershipCapability,
  type SQLiteCursorPreRebindReceipt,
} from "../src/operation-baseline-cursor-ownership.js";
import {
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
  type SQLiteCursorSealReceipt,
} from "../src/operation-baseline-cursor-invariants.js";
import type { OperationBaselineProjectionIdentity } from "../src/operation-baseline.js";
import {
  captureSQLiteV1BaselineSourceSummary,
  type SQLiteV1BaselineSourceSummary,
} from "../src/operation-baseline-source.js";
import {
  SQLiteConnection,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";

const CAPTURED_AT_MS = 1_785_110_405_000;
const LOCK = Object.freeze({
  activeExpiresAtMs: CAPTURED_AT_MS + 100_000,
  fencingToken: 1,
  lockEpoch: 1,
  lockId: "b3-outer-lock",
  ownerId: "b3-outer-owner",
  sourceSchemaVersion: 1,
  targetSchemaVersion: 2,
} as const satisfies SQLiteCursorMigrationLockIdentity);

interface CleanGraph {
  readonly connection: SQLiteConnection;
  readonly stage: SQLiteBaselineTempStage;
  readonly sourceSummary: SQLiteV1BaselineSourceSummary;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly transfer: SQLiteCursorStageOwnershipTransfer;
  readonly migrationLockCapability: SQLiteCursorMigrationLockCapability;
  readonly providerClockCapability: SQLiteCursorProviderClockCapability;
  readonly outerClockEvidence: SQLiteCursorProviderClockEvidence;
}

const roots: string[] = [];
const runs: Pick<CleanGraph, "connection" | "stage">[] = [];

function installMigrationLock(connection: SQLiteConnection): void {
  connection.prepare(`
    INSERT INTO main.ge_cycle_used_migration_lock_ids
      (lock_id, lock_epoch, fencing_token, first_used_at_ms)
    VALUES (?, ?, ?, ?)
  `, "inspect-schema").run(
    LOCK.lockId,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    CAPTURED_AT_MS - 1,
  );
  connection.prepare(`
    UPDATE main.ge_cycle_migration_lock
       SET active_lock_id = ?, active_owner_id = ?, active_source_version = ?,
           active_target_version = ?, active_lock_epoch = ?, active_fencing_token = ?,
           active_acquired_at_ms = ?, active_expires_at_ms = ?,
           last_lock_epoch = ?, last_fencing_token = ?, updated_at_ms = ?
     WHERE singleton = 1
  `, "inspect-schema").run(
    LOCK.lockId,
    LOCK.ownerId,
    LOCK.sourceSchemaVersion,
    LOCK.targetSchemaVersion,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    CAPTURED_AT_MS - 1,
    LOCK.activeExpiresAtMs,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    CAPTURED_AT_MS - 1,
  );
}

function openConnection(): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-b3-outer-authority-"));
  roots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: CAPTURED_AT_MS - 2,
  });
  installMigrationLock(connection);
  configureSQLiteBaselineTempStorage(connection);
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
  return connection;
}

function mintReceipt(
  sourceSummary: SQLiteV1BaselineSourceSummary,
  projectionIdentity: OperationBaselineProjectionIdentity,
): SQLiteCursorPreRebindReceipt {
  const projectionReference = createSQLiteCursorExactProjectionReference(projectionIdentity);
  const sealReceipt = Object.freeze({
    cursorCount: 0,
    immutableRootSha256: SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    sourceDescriptorHash: sourceSummary.sourceEnvelope.sourceDescriptorHash,
    sourceSchemaIdentitySha256: sourceSummary.sourceEnvelope.sourceSchemaIdentitySha256,
  } satisfies SQLiteCursorSealReceipt);
  const tenantOwnership = createSQLiteCursorOwnershipCapability("tenant", Buffer.alloc(32, 1));
  const sourceStageOwnership = createSQLiteCursorOwnershipCapability(
    "source-stage", Buffer.alloc(32, 2),
  );
  const campaignOwnership = createSQLiteCursorOwnershipCapability(
    "campaign", Buffer.alloc(32, 3),
  );
  const connectionOwnership = createSQLiteCursorOwnershipCapability(
    "connection", Buffer.alloc(32, 4),
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
  return new SQLiteCursorPreRebindReceiptIssuer(input).issue(input);
}

function cleanGraph(mode: "clean" | "unfinished" | "diagnosed" = "clean"): CleanGraph {
  const connection = openConnection();
  const stage = createSQLiteBaselineTempStage(
    connection,
    proveSQLiteExclusiveBaselineTransaction(connection),
  );
  runs.push({ connection, stage });
  const sourceSummary = captureSQLiteV1BaselineSourceSummary(connection, CAPTURED_AT_MS);
  stageSQLiteV1BaselineSourceIntoTempStage(connection, sourceSummary, stage);
  const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
    connection, sourceSummary, stage,
  );
  expect(runSQLiteStreamRecordInvariantCampaign(
    connection, projectionIdentity, stage,
  ).diagnostics).toEqual([]);
  expect(runSQLiteCheckpointInvariantCampaign(
    connection, projectionIdentity, stage,
  ).diagnostics).toEqual([]);
  expect(runSQLiteLeaseLockHoldInvariantCampaign(
    connection, projectionIdentity, stage,
  ).diagnostics).toEqual([]);
  expect(runSQLiteLegacyInvariantCampaign(
    connection, projectionIdentity, stage,
  ).diagnostics).toEqual([]);
  const receipt = mintReceipt(sourceSummary, projectionIdentity);
  const transfer = beginSQLiteCursorStageOwnershipTransfer(connection, stage, receipt);
  createSQLiteCursorSealTempTable(connection, stage, receipt, transfer);
  if (mode === "clean") {
    const outcome = runSQLiteCursorPreRebindCampaign(connection, stage, receipt, transfer);
    expect(outcome.status).toBe("pre-rebind-complete");
    if (outcome.status !== "pre-rebind-complete") throw new Error("expected clean B2");
    expect(outcome.receipt).toBe(receipt);
    expect(outcome.projectionIdentity).toBe(projectionIdentity);
  } else if (mode === "diagnosed") {
    const campaign = beginSQLiteCursorPreRebindStageCampaign(
      connection, stage, receipt, transfer,
    );
    diagnoseSQLiteCursorPreRebindStageCampaign(stage, campaign);
  }

  const migrationLockCapability = createSQLiteCursorMigrationLockCapabilityIntrinsic(
    connection, LOCK,
  );
  const providerClockSource = createSQLiteCursorProviderClockSourceIntrinsic(
    () => CAPTURED_AT_MS,
  );
  const providerClockCapability = createSQLiteCursorProviderClockCapabilityIntrinsic(
    connection, migrationLockCapability, providerClockSource,
  );
  const outerClockEvidence = observeSQLiteCursorProviderClockIntrinsic(
    providerClockCapability, "before-first-permanent-mutation",
  );
  return {
    connection,
    migrationLockCapability,
    outerClockEvidence,
    projectionIdentity,
    providerClockCapability,
    receipt,
    sourceSummary,
    stage,
    transfer,
  };
}

function prepare(graph: CleanGraph): SQLiteCursorOuterPublicationAuthority {
  return prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
    graph.connection,
    graph.stage,
    graph.receipt,
    graph.projectionIdentity,
    graph.transfer,
    graph.migrationLockCapability,
    graph.providerClockCapability,
    graph.outerClockEvidence,
  );
}

function tempInventory(connection: SQLiteConnection): readonly string[] {
  return connection.prepare(
    "SELECT type || ':' || name FROM temp.sqlite_schema "
      + "WHERE substr(lower(name), 1, 7) = 'ge_blr_' ORDER BY 1",
    "inspect-schema",
  ).all().map((row) => String((row as readonly unknown[])[0]));
}

function expectProviderError(
  callback: () => unknown,
  code: string,
  message: RegExp,
): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe(code);
    expect((error as Error).message).toMatch(message);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code}`);
}

afterEach(() => {
  for (const { connection, stage } of runs.splice(0)) {
    try { stage.dispose(); } catch { /* A hostile case may poison the stage. */ }
    try {
      if (connection.isOpen && connection.isTransaction) {
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
    } catch { /* Preserve the focused assertion. */ }
    try { if (connection.isOpen) connection.close(); } catch { /* Best effort. */ }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite B3 outer publication authority", () => {
  it("adopts the exact clean B2 graph and exposes a frozen zero-ledger snapshot", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    expect(prepare(graph)).toBe(authority);
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.getPrototypeOf(authority)).toBeNull();

    expect(activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
    expect(assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
    expect(assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
    const snapshot = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toMatchObject({
      activationCount: 1,
      lifecycle: "active",
      outerLedger: {
        affectedRowsWatermark: 0,
        fixedStatementCount: 0,
        logicalWriteSequence: 0,
      },
    });
    expect(snapshot.connection).toBe(graph.connection);
    expect(snapshot.stage).toBe(graph.stage);
    expect(snapshot.receipt).toBe(graph.receipt);
    expect(snapshot.projectionIdentity).toBe(graph.projectionIdentity);
    expect(snapshot.transfer).toBe(graph.transfer);
    expect(snapshot.migrationLockCapability).toBe(graph.migrationLockCapability);
    expect(snapshot.providerClockCapability).toBe(graph.providerClockCapability);
    expect(snapshot.outerClockEvidence).toBe(graph.outerClockEvidence);
    expect(snapshot.outerClockConsumedTombstone).toBeDefined();
    expect(assertSQLiteCursorProviderClockConsumedTombstoneIntrinsic(
      graph.providerClockCapability,
      graph.outerClockEvidence,
      snapshot.outerClockConsumedTombstone!,
      "outer-publication-authority",
    )).toBe(snapshot.outerClockConsumedTombstone);
    expect(() => activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority))
      .toThrow(/not inactive/u);
  });

  it("cancels before the tail and retries the same authority and evidence", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    const controller = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    controller.cancel();
    expect(() => activateSQLiteCursorOuterPublicationAuthorityIntrinsic(
      authority, controller.signal,
    )).toThrow(/cancelled/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority)).toMatchObject({
      activationCount: 0,
      lifecycle: "inactive",
      outerClockConsumedTombstone: undefined,
    });
    expect(prepare(graph)).toBe(authority);
    expect(activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
  });

  it("rejects cloned and cross-run graph members before exact-graph retry", () => {
    const graph = cleanGraph();
    const other = cleanGraph();
    const attempts = [
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage,
        Object.freeze(Object.create(null)) as SQLiteCursorPreRebindReceipt,
        graph.projectionIdentity, graph.transfer, graph.migrationLockCapability,
        graph.providerClockCapability, graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, graph.receipt,
        Object.freeze({ ...graph.projectionIdentity }) as OperationBaselineProjectionIdentity,
        graph.transfer, graph.migrationLockCapability, graph.providerClockCapability,
        graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
        Object.freeze(Object.create(null)) as SQLiteCursorStageOwnershipTransfer,
        graph.migrationLockCapability, graph.providerClockCapability, graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
        graph.transfer,
        Object.freeze(Object.create(null)) as SQLiteCursorMigrationLockCapability,
        graph.providerClockCapability, graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
        graph.transfer, graph.migrationLockCapability,
        Object.freeze(Object.create(null)) as SQLiteCursorProviderClockCapability,
        graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
        graph.transfer, graph.migrationLockCapability, graph.providerClockCapability,
        Object.freeze(Object.create(null)) as SQLiteCursorProviderClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
        graph.transfer, graph.migrationLockCapability, graph.providerClockCapability,
        other.outerClockEvidence,
      ),
    ];
    for (const attempt of attempts) expect(attempt).toThrow();
    const authority = prepare(graph);
    expect(activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
  });

  it("rejects preconsumed evidence and an authority clone", () => {
    const consumed = cleanGraph();
    consumeSQLiteCursorProviderClockEvidenceIntrinsic(
      consumed.providerClockCapability,
      consumed.outerClockEvidence,
      "outer-publication-authority",
    );
    expect(() => prepare(consumed)).toThrow(/clock graph/u);

    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const clone = Object.freeze(Object.create(null)) as SQLiteCursorOuterPublicationAuthority;
    expect(() => assertSQLiteCursorOuterPublicationAuthorityIntrinsic(clone))
      .toThrow(/authority is invalid/u);
  });

  it("rejects unfinished and diagnosed B2 state without consuming evidence", () => {
    const unfinished = cleanGraph("unfinished");
    expect(() => prepare(unfinished)).toThrow(/pre-rebind|transfer/u);
    const outcome = runSQLiteCursorPreRebindCampaign(
      unfinished.connection,
      unfinished.stage,
      unfinished.receipt,
      unfinished.transfer,
    );
    expect(outcome.status).toBe("pre-rebind-complete");
    const authority = prepare(unfinished);
    expect(activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);

    const diagnosed = cleanGraph("diagnosed");
    expect(() => prepare(diagnosed)).toThrow(/transfer|pre-rebind/u);
    expect(consumeSQLiteCursorProviderClockEvidenceIntrinsic(
      diagnosed.providerClockCapability,
      diagnosed.outerClockEvidence,
      "outer-publication-authority",
    )).toBeDefined();
  });

  it("rejects cross-run receipt, projection, transfer, stage, and connection substitutions", () => {
    const graph = cleanGraph();
    const other = cleanGraph();
    const substitutions = [
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, other.receipt, graph.projectionIdentity,
        graph.transfer, graph.migrationLockCapability, graph.providerClockCapability,
        graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, graph.receipt, other.projectionIdentity,
        graph.transfer, graph.migrationLockCapability, graph.providerClockCapability,
        graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
        other.transfer, graph.migrationLockCapability, graph.providerClockCapability,
        graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        graph.connection, other.stage, graph.receipt, graph.projectionIdentity,
        graph.transfer, graph.migrationLockCapability, graph.providerClockCapability,
        graph.outerClockEvidence,
      ),
      () => prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
        other.connection, graph.stage, graph.receipt, graph.projectionIdentity,
        graph.transfer, graph.migrationLockCapability, graph.providerClockCapability,
        graph.outerClockEvidence,
      ),
    ];
    for (const substitution of substitutions) expect(substitution).toThrow();
    const authority = prepare(graph);
    expect(activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
  });

  it("rejects first-boundary evidence after a later boundary was observed", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    const later = observeSQLiteCursorProviderClockIntrinsic(
      graph.providerClockCapability, "before-cursor-rebind",
    );
    expect(later).not.toBe(graph.outerClockEvidence);
    expect(() => activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority))
      .toThrow(/clock graph/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority)).toMatchObject({
      activationCount: 0,
      lifecycle: "poisoned",
      outerClockConsumedTombstone: undefined,
    });
    expect(() => activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority))
      .toThrow(/not inactive/u);
  });

  it("fails closed after rollback and rebegin for inactive and active authorities", () => {
    const inactiveGraph = cleanGraph();
    const inactive = prepare(inactiveGraph);
    inactiveGraph.connection.execTrusted("ROLLBACK", "inspect-schema");
    inactiveGraph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    expect(() => activateSQLiteCursorOuterPublicationAuthorityIntrinsic(inactive)).toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(inactive)).toMatchObject({
      activationCount: 0,
      lifecycle: "retired",
      outerClockConsumedTombstone: undefined,
    });
    expect(() => activateSQLiteCursorOuterPublicationAuthorityIntrinsic(inactive))
      .toThrow(/not inactive/u);

    const activeGraph = cleanGraph();
    const active = prepare(activeGraph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(active);
    activeGraph.connection.execTrusted("ROLLBACK", "inspect-schema");
    activeGraph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    expect(() => assertSQLiteCursorOuterPublicationAuthorityIntrinsic(active)).toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(active).lifecycle)
      .toBe("retired");
    expect(() => assertSQLiteCursorOuterPublicationAuthorityIntrinsic(active))
      .toThrow(/not active/u);
  });

  it("uses captured tail intrinsics after Object.create and Object.freeze are replaced", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    const createDescriptor = Object.getOwnPropertyDescriptor(Object, "create")!;
    const freezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze")!;
    const originalCreate = createDescriptor.value as typeof Object.create;
    const originalFreeze = freezeDescriptor.value as typeof Object.freeze;
    const rejectTailLookup = (): void => {
      if (new Error().stack?.includes("consumeSQLiteCursorProviderClockEvidenceIntrinsic")) {
        throw new Error("hostile ambient intrinsic reached activation tail");
      }
    };
    try {
      Object.defineProperty(Object, "create", {
        ...createDescriptor,
        value: ((prototype: object | null, properties?: PropertyDescriptorMap): object => {
          rejectTailLookup();
          return properties === undefined
            ? Reflect.apply(originalCreate, Object, [prototype]) as object
            : Reflect.apply(originalCreate, Object, [prototype, properties]) as object;
        }) as typeof Object.create,
      });
      Object.defineProperty(Object, "freeze", {
        ...freezeDescriptor,
        value: (<T extends object>(value: T): Readonly<T> => {
          rejectTailLookup();
          return Reflect.apply(originalFreeze, Object, [value]) as Readonly<T>;
        }) satisfies typeof Object.freeze,
      });
      expect(activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
    } finally {
      Object.defineProperty(Object, "create", createDescriptor);
      Object.defineProperty(Object, "freeze", freezeDescriptor);
    }
    expect(assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
    const snapshot = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority);
    expect(snapshot.lifecycle).toBe("active");
    expect(Object.keys(snapshot)).not.toContain("outerPublicationTail");
    expect(() => activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority))
      .toThrow(/not inactive/u);
  });

  it("burns an armed bridge tail on retirement and cannot revive ownership", () => {
    const graph = cleanGraph();
    const mint = mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic(
      graph.connection, graph.stage, graph.receipt, graph.projectionIdentity, graph.transfer,
    );
    assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic(
      graph.connection, graph.stage, graph.receipt, graph.projectionIdentity, graph.transfer,
      mint.authority, mint.tail,
    );
    retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic(
      graph.transfer, mint.authority,
    );

    expectProviderError(
      () => publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic(mint.tail),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /tail is invalid/u,
    );
    expectProviderError(
      () => assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic(
        graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
        graph.transfer, mint.authority,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /ownership is invalid/u,
    );
    expectProviderError(
      () => publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic(mint.tail),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /tail is invalid/u,
    );
  });

  it("publishes a bridge tail exactly once and rejects replay without losing ownership", () => {
    const graph = cleanGraph();
    const mint = mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic(
      graph.connection, graph.stage, graph.receipt, graph.projectionIdentity, graph.transfer,
    );
    assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic(
      graph.connection, graph.stage, graph.receipt, graph.projectionIdentity, graph.transfer,
      mint.authority, mint.tail,
    );
    publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic(mint.tail);
    expect(assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic(
      graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
      graph.transfer, mint.authority,
    )).toBe(graph.transfer);

    expectProviderError(
      () => publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic(mint.tail),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /tail is invalid/u,
    );
    expect(assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic(
      graph.connection, graph.stage, graph.receipt, graph.projectionIdentity,
      graph.transfer, mint.authority,
    )).toBe(graph.transfer);
  });

  it("does not execute 0002, cursor rebind, transaction control, or any permanent write", () => {
    const graph = cleanGraph();
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const tempBefore = tempInventory(graph.connection);
    const observedSql: string[] = [];
    const native = DatabaseSync.prototype as unknown as {
      exec(sql: string): void;
      prepare(sql: string): unknown;
    };
    const originalExec = native.exec;
    const originalPrepare = native.prepare;
    try {
      native.exec = function (sql: string): void {
        observedSql.push(sql);
        return Reflect.apply(originalExec, this, [sql]);
      };
      native.prepare = function (sql: string): unknown {
        observedSql.push(sql);
        return Reflect.apply(originalPrepare, this, [sql]);
      };
      const authority = prepare(graph);
      activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
      assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    } finally {
      native.exec = originalExec;
      native.prepare = originalPrepare;
    }
    const ownerAfter = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesAfter = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    expect(ownerAfter.transactionLineage).toBe(ownerBefore.transactionLineage);
    expect(ownerAfter.transactionEpoch).toBe(ownerBefore.transactionEpoch);
    expect(changesAfter.totalChanges).toBe(changesBefore.totalChanges);
    expect(changesAfter.transactionEpoch).toBe(changesBefore.transactionEpoch);
    expect(tempInventory(graph.connection)).toEqual(tempBefore);
    const normalized = observedSql.join("\n").toUpperCase();
    expect(normalized).not.toContain("0002-V1-TO-V2");
    expect(normalized).not.toContain("UPDATE MAIN.GE_CYCLE_CURSORS");
    expect(normalized).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK|END)\b/u);
    expect(changesAfter.totalChanges).toBe(changesBefore.totalChanges);
  });

  it("keeps every outer-authority intrinsic off the package root", () => {
    const names = [
      "SQLITE_CURSOR_PUBLICATION_TARGET",
      "SQLiteCursorOuterPublicationAuthority",
      "SQLiteCursorOuterPublicationAuthorityLifecycle",
      "SQLiteCursorOuterPublicationAuthoritySnapshot",
      "SQLiteCursorOuterPublicationCancellationController",
      "SQLiteCursorOuterPublicationCancellationSignal",
      "createSQLiteCursorOuterPublicationCancellationControllerIntrinsic",
      "prepareSQLiteCursorOuterPublicationAuthorityIntrinsic",
      "activateSQLiteCursorOuterPublicationAuthorityIntrinsic",
      "assertSQLiteCursorOuterPublicationAuthorityIntrinsic",
      "readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic",
      "assertSQLiteCursorOuterClockAuthorityGraphIntrinsic",
      "assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic",
      "SQLiteCursorStageOwnershipOuterPublicationTail",
      "SQLiteCursorStageOwnershipOuterPublicationMint",
      "assertSQLiteCursorStageOwnershipPreRebindCompleteIntrinsic",
      "mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic",
      "assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic",
      "publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic",
      "assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic",
      "retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic",
      "poisonSQLiteCursorStageOwnershipOuterPublicationIntrinsic",
      "SQLITE_BASELINE_ASSERT_CURSOR_PRE_REBIND_COMPLETE",
      "SQLITE_BASELINE_PREPARE_CURSOR_OUTER_PUBLICATION",
      "SQLITE_BASELINE_PUBLISH_CURSOR_OUTER_PUBLICATION",
      "SQLITE_BASELINE_ASSERT_CURSOR_OUTER_PUBLICATION_OWNED",
      "SQLITE_BASELINE_ASSERT_CURSOR_OUTER_PUBLICATION_ACTIVE",
      "SQLITE_BASELINE_RETIRE_CURSOR_OUTER_PUBLICATION",
      "SQLITE_BASELINE_POISON_CURSOR_OUTER_PUBLICATION",
      "assertSQLiteBaselineCursorPreRebindCompleteIntrinsic",
      "prepareSQLiteBaselineCursorOuterPublicationIntrinsic",
      "publishSQLiteBaselineCursorOuterPublicationIntrinsic",
      "assertSQLiteBaselineCursorOuterPublicationOwnedIntrinsic",
      "assertSQLiteBaselineCursorOuterPublicationActiveIntrinsic",
      "retireSQLiteBaselineCursorOuterPublicationIntrinsic",
      "poisonSQLiteBaselineCursorOuterPublicationIntrinsic",
    ] as const;
    const rootSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    for (const name of names) {
      expect(Object.keys(sqliteRoot)).not.toContain(name);
      expect(rootSource).not.toContain(name);
    }
    expect(assertSQLiteCursorPreRebindReceiptProvenance).toBeTypeOf("function");
  });

  it("keeps the outer-authority module free of SQL execution and transaction control", () => {
    const source = readFileSync(new URL(
      "../src/cursor-publication-outer-authority.ts", import.meta.url,
    ), "utf8");
    expect(source).not.toContain("execTrusted");
    expect(source).not.toMatch(/\.run\s*\(/u);
    expect(source).not.toContain("0002-v1-to-v2-operation-replay.sql");
    expect(source).not.toMatch(/UPDATE\s+main\.ge_cycle_cursors/iu);
    expect(source).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK)\b/u);
  });
});
