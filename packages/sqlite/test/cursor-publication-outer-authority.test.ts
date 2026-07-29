import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  activateSQLiteCursorOuterPublicationAuthorityIntrinsic,
  assertSQLiteCursorPostDdlCatalogFenceIntrinsic,
  assertSQLiteCursorOuterPublicationAuthorityIntrinsic,
  createSQLiteCursorOuterPublicationCancellationControllerIntrinsic,
  executeSQLiteCursorMigration0002CatalogRebuildIntrinsic,
  mintSQLiteCursorPostDdlCatalogFenceIntrinsic,
  prepareSQLiteCursorOuterPublicationAuthorityIntrinsic,
  readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic,
  readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  type SQLiteMigration0002CatalogRebuildReceipt,
  type SQLiteCursorPostDdlCatalogFence,
  type SQLiteCursorOuterPublicationAuthority,
} from "../src/cursor-publication-outer-authority.js";
import {
  SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
  SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
  loadSQLiteCursorMigration0002AssetIntrinsic,
  readSQLiteCursorMigration0002AssetSnapshotIntrinsic,
  type SQLiteCursorMigration0002Asset,
} from "../src/cursor-publication-migration-0002-asset.js";
import {
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
  readSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
} from "../src/cursor-publication-target-catalog.js";
import * as targetCatalogModule from "../src/cursor-publication-target-catalog.js";
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

function cleanGraph(
  mode: "clean" | "unfinished" | "diagnosed" = "clean",
  legacyOperationCount = 0,
): CleanGraph {
  const connection = openConnection();
  const governanceResult = Buffer.from(
    "{\"archiveMode\":\"lossless-before-delete\","
      + "\"compactionMode\":\"logical-history-preserving\",\"legalHoldIds\":[],"
      + "\"retentionMode\":\"retain-authoritative-history\"}",
    "utf8",
  );
  const governanceResultHash = createHash("sha256").update(governanceResult).digest("hex");
  for (let index = 0; index < legacyOperationCount; index += 1) {
    connection.prepare(`
      INSERT INTO main.ge_cycle_operations
        (tenant_id, operation_id, operation_name, request_hash,
         result_blob, result_hash, committed_at_ms)
      VALUES (?, ?, 'set-legal-hold', ?, ?, ?, ?)
    `, "inspect-schema").run(
      `tenant-legacy-${index}`,
      `operation-legacy-${index}`,
      `${index + 1}`.padStart(64, "0"),
      governanceResult,
      governanceResultHash,
      CAPTURED_AT_MS - 10 + index,
    );
  }
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

  it("loads only the exact packaged migration 0002 asset and rejects a clone", () => {
    const asset = loadSQLiteCursorMigration0002AssetIntrinsic();
    const snapshot = readSQLiteCursorMigration0002AssetSnapshotIntrinsic(asset);
    expect(Object.isFrozen(asset)).toBe(true);
    expect(Object.getPrototypeOf(asset)).toBeNull();
    expect(snapshot).toMatchObject({
      assetSha256: SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
      assetUtf8Bytes: SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
      fixedStatementCount: 20,
      previewManifestIdentity: snapshot.previewManifestIdentity,
      previewManifestSha256:
        "f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf",
      schemaSqlSha256:
        "5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5",
    });
    expect(snapshot.statements).toHaveLength(20);
    expect(Object.isFrozen(snapshot.previewManifestIdentity)).toBe(true);
    expect(Object.getPrototypeOf(snapshot.previewManifestIdentity)).toBeNull();
    expect(snapshot.statements[0]).toContain("PRAGMA defer_foreign_keys = ON;");
    expect(snapshot.statements[19]).toBe("PRAGMA user_version = 2;");
    expect(readFileSync(new URL(
      "../migrations/0002-v1-to-v2-operation-replay.sql",
      import.meta.url,
    ))).toEqual(readFileSync(new URL(
      "../../../spec/migrations/sqlite/0002-v1-to-v2-operation-replay.sql",
      import.meta.url,
    )));
    expect(() => readSQLiteCursorMigration0002AssetSnapshotIntrinsic(
      Object.freeze(Object.create(null)) as SQLiteCursorMigration0002Asset,
    )).toThrow(/asset proof is invalid/u);
  });

  it("executes exact 0002 once, advances the three-dimensional ledger, and mints a receipt", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);

    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const ownerAfter = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesAfter = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const snapshot = readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(receipt);

    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.getPrototypeOf(receipt)).toBeNull();
    expect(ownerAfter.isTransaction).toBe(true);
    expect(ownerAfter.transactionMode).toBe("exclusive");
    expect(ownerAfter.transactionLineage).toBe(ownerBefore.transactionLineage);
    expect(ownerAfter.transactionEpoch).toBe(ownerBefore.transactionEpoch + 20n);
    expect(changesAfter.totalChanges - changesBefore.totalChanges).toBe(1);
    expect(snapshot).toMatchObject({
      affectedRows: 1,
      applicationIdAfter: 1_195_724_359,
      applicationIdBefore: 1_195_724_359,
      assetSha256: SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
      executeCount: 1,
      fixedStatementCount: 20,
      legacyOperationCopyRowCount: 0,
      outerLedgerAfter: {
        affectedRowsWatermark: 1,
        fixedStatementCount: 20,
        logicalWriteSequence: 1,
      },
      outerLedgerBefore: {
        affectedRowsWatermark: 0,
        fixedStatementCount: 0,
        logicalWriteSequence: 0,
      },
      outerLedgerDelta: {
        affectedRowsWatermark: 1,
        fixedStatementCount: 20,
        logicalWriteSequence: 1,
      },
      parameterSha256:
        "8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a",
      postDdlCatalogSha256:
        "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf",
      prepareCount: 20,
      resultSha256:
        "2475973b53ba5659827cf78fca83b7a040172ae04e0c03d7de1cd7a297f1a96e",
      schemaCopyRowCount: 1,
      totalChangesDelta: 1,
      userVersionAfter: 2,
      userVersionBefore: 1,
      writeKind: "migration-0002-catalog-rebuild",
    });
    expect(snapshot.statementAffectedRows).toEqual([
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(snapshot.transactionLineage).toBe(ownerBefore.transactionLineage);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority)).toMatchObject({
      lifecycle: "active",
      migration0002LogicalExecutionCount: 1,
      migration0002PreparedStatementCount: 20,
      migration0002Receipt: receipt,
      outerLedger: {
        affectedRowsWatermark: 1,
        fixedStatementCount: 20,
        logicalWriteSequence: 1,
      },
      writePhase: "0002-complete",
    });
    expect(assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
  });

  it("copies non-empty legacy operations and binds the 1 + L result formula", () => {
    const graph = cleanGraph("clean", 2);
    expect(graph.projectionIdentity.legacyOperationCount).toBe(2);
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const before = readSQLiteConnectionTotalChangesSnapshot(graph.connection);

    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const snapshot = readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(receipt);
    expect(snapshot).toMatchObject({
      affectedRows: 3,
      legacyOperationCopyRowCount: 2,
      outerLedgerAfter: {
        affectedRowsWatermark: 3,
        fixedStatementCount: 20,
        logicalWriteSequence: 1,
      },
      resultSha256:
        "9c4a39646a7cb26c3ba53e91941b6fe0f4435355a06d2138156d1fd9551ba417",
      schemaCopyRowCount: 1,
      totalChangesDelta: 3,
    });
    expect(snapshot.statementAffectedRows).toEqual([
      0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 2, 0, 0, 0,
    ]);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges
      - before.totalChanges).toBe(3);
    expect(graph.connection.prepare(`
      SELECT ledger_format_version, request_blob, commit_sequence
        FROM main.ge_cycle_operations
       ORDER BY tenant_id COLLATE BINARY, operation_id COLLATE BINARY
    `, "inspect-schema").all()).toEqual([
      [1n, null, null],
      [1n, null, null],
    ]);
  });

  it("poisons a second logical 0002 execution without running another statement", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);

    expect(() => executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority))
      .toThrow(/executed more than once|execution was reused/u);
    const ownerAfter = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesAfter = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    expect(ownerAfter.transactionEpoch).toBe(ownerBefore.transactionEpoch);
    expect(ownerAfter.transactionLineage).toBe(ownerBefore.transactionLineage);
    expect(changesAfter.totalChanges).toBe(changesBefore.totalChanges);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority)).toMatchObject({
      lifecycle: "poisoned",
      outerLedger: {
        affectedRowsWatermark: 1,
        fixedStatementCount: 20,
        logicalWriteSequence: 1,
      },
      writePhase: "poisoned",
    });
  });

  it("leaves commit ownership outside the leaf and rolls back to the exact pre-DDL catalog", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const receiptSnapshot =
      readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(receipt);
    expect(graph.connection.isTransaction).toBe(true);

    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    expect(graph.connection.isTransaction).toBe(false);
    const restored = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      graph.connection,
    );
    expect(restored.applicationId).toBe(receiptSnapshot.applicationIdBefore);
    expect(restored.userVersion).toBe(receiptSnapshot.userVersionBefore);
    expect(restored.catalogSha256).toBe(receiptSnapshot.preDdlCatalogSha256);
    expect(restored.catalogSha256).not.toBe(receiptSnapshot.postDdlCatalogSha256);
    expect(() => readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(receipt))
      .toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority).lifecycle)
      .toBe("retired");
  });

  it("mints one reusable fresh post-DDL fence without changing any write watermark", () => {
    const graph = cleanGraph("clean", 2);
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const ledgerBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      authority,
    ).outerLedger;

    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt);
    const snapshot = readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic(fence);
    expect(Object.isFrozen(fence)).toBe(true);
    expect(Object.getPrototypeOf(fence)).toBeNull();
    expect(snapshot).toMatchObject({
      applicationId: 1_195_724_359,
      authority,
      catalogCanonicalUtf8Bytes: 5_785,
      catalogRowCount: 34,
      catalogSha256:
        "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf",
      connection: graph.connection,
      consumesAnyWriteReceipt: false,
      isFinalV2SemanticProof: false,
      migration0002Receipt: receipt,
      mintCount: 1,
      outerLedgerWatermark: {
        affectedRowsWatermark: 3,
        fixedStatementCount: 20,
        logicalWriteSequence: 1,
      },
      proofScope: "post-0002-physical-target-catalog-before-baseline-publication",
      userVersion: 2,
    });
    expect(snapshot.catalogInventory).toHaveLength(34);
    expect(snapshot.catalogInventory)
      .toEqual(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY);
    expect(snapshot.catalogQuery).toBe(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY);
    expect(snapshot.catalogDigestDomainUtf8)
      .toBe(SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8);
    expect(snapshot.catalogQuerySha256)
      .toBe("bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c");
    expect(snapshot.transactionEpoch).toBe(ownerBefore.transactionEpoch);
    expect(snapshot.transactionLineage).toBe(ownerBefore.transactionLineage);
    expect(snapshot.totalChangesWatermark).toBe(changesBefore.totalChanges);
    expect(assertSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt, fence))
      .toBe(fence);
    expect(assertSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt, fence))
      .toBe(fence);
    expect(readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(receipt))
      .toBeDefined();
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(changesBefore);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority)).toMatchObject({
      lifecycle: "active",
      outerLedger: ledgerBefore,
      postDdlCatalogFence: fence,
      postDdlCatalogFenceMintCount: 1,
      writePhase: "post-ddl-catalog-fence",
    });
  });

  it("rejects substituted 0002 receipt presentation and permits exact corrected mint", () => {
    const graph = cleanGraph();
    const other = cleanGraph();
    const authority = prepare(graph);
    const otherAuthority = prepare(other);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(otherAuthority);
    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const otherReceipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(otherAuthority);

    expectProviderError(
      () => mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, otherReceipt),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /receipt is invalid/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority)).toMatchObject({
      lifecycle: "active",
      postDdlCatalogFenceMintCount: 0,
      writePhase: "0002-complete",
    });
    expect(mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt)).toBeDefined();
  });

  it("rejects forged and cross-run fence presentation without poisoning valid graphs", () => {
    const graph = cleanGraph();
    const other = cleanGraph();
    const authority = prepare(graph);
    const otherAuthority = prepare(other);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(otherAuthority);
    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const otherReceipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(otherAuthority);
    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt);
    const otherFence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(
      otherAuthority,
      otherReceipt,
    );

    expectProviderError(
      () => assertSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt, otherFence),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /graph is invalid/u,
    );
    expectProviderError(
      () => assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
        authority,
        receipt,
        Object.freeze(Object.create(null)) as SQLiteCursorPostDdlCatalogFence,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /fence is invalid/u,
    );
    const revoked = Proxy.revocable(fence, {});
    const invalidFences = [
      Object.freeze({ ...readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic(fence) }),
      new Proxy(fence, {}),
      revoked.proxy,
    ] as readonly unknown[];
    revoked.revoke();
    for (const invalidFence of invalidFences) {
      expectProviderError(
        () => assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
          authority,
          receipt,
          invalidFence as SQLiteCursorPostDdlCatalogFence,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /fence is invalid/u,
      );
    }
    expect(assertSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt, fence))
      .toBe(fence);
    expect(assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
      otherAuthority,
      otherReceipt,
      otherFence,
    )).toBe(otherFence);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority).lifecycle)
      .toBe("active");
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(otherAuthority).lifecycle)
      .toBe("active");
  });

  it("poisons premature and repeated fence mint attempts without changing the ledger", () => {
    const earlyGraph = cleanGraph();
    const earlyAuthority = prepare(earlyGraph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(earlyAuthority);
    const forgedReceipt = Object.freeze(Object.create(null)) as
      SQLiteMigration0002CatalogRebuildReceipt;
    expectProviderError(
      () => mintSQLiteCursorPostDdlCatalogFenceIntrinsic(earlyAuthority, forgedReceipt),
      "GE_CYCLE_STORE_CORRUPTION",
      /premature/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(earlyAuthority))
      .toMatchObject({
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 0,
          fixedStatementCount: 0,
          logicalWriteSequence: 0,
        },
        postDdlCatalogFenceMintCount: 0,
      });

    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    expectProviderError(
      () => mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt),
      "GE_CYCLE_STORE_CORRUPTION",
      /reused/u,
    );
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(changesBefore);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority)).toMatchObject({
      lifecycle: "poisoned",
      outerLedger: {
        affectedRowsWatermark: 1,
        fixedStatementCount: 20,
        logicalWriteSequence: 1,
      },
      postDdlCatalogFenceMintCount: 1,
    });
    expect(() => assertSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt, fence))
      .toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority).lifecycle)
      .toBe("poisoned");
  });

  it("rejects forged fences and retires an authentic fence after rollback and rebegin", () => {
    expect(() => readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic(
      Object.freeze(Object.create(null)) as SQLiteCursorPostDdlCatalogFence,
    )).toThrow(/fence is invalid/u);

    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt);
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    expect(() => readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic(fence)).toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority).lifecycle)
      .toBe("retired");
    expect(() => readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic(fence)).toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority).lifecycle)
      .toBe("retired");
  });

  it("poisons a minted fence after connection close and keeps later presentation terminal", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt);
    graph.connection.close();
    expectProviderError(
      () => readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic(fence),
      "GE_CYCLE_STORE_UNAVAILABLE",
      /closed/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority).lifecycle)
      .toBe("poisoned");
    expect(() => readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic(fence)).toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority).lifecycle)
      .toBe("poisoned");
  });

  it("poisons a live fence when the physical catalog changes after mint", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt);
    graph.connection.execTrusted(
      "CREATE VIEW main.GE_CYCLE_HOSTILE_VIEW AS SELECT 1 AS value",
      "inspect-schema",
    );
    expectProviderError(
      () => assertSQLiteCursorPostDdlCatalogFenceIntrinsic(authority, receipt, fence),
      "GE_CYCLE_STORE_CORRUPTION",
      /clock graph|ledger drifted|catalog fence/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority).lifecycle)
      .toBe("poisoned");
  });

  it("requires an independent fresh catalog read at mint and every exact revalidation", () => {
    const mintGraph = cleanGraph();
    const mintAuthority = prepare(mintGraph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(mintAuthority);
    const mintReceipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(mintAuthority);
    const mintRead = vi.spyOn(
      targetCatalogModule,
      "readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic",
    ).mockImplementationOnce(() => {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "forced fresh catalog mint failure",
      );
    });
    try {
      expectProviderError(
        () => mintSQLiteCursorPostDdlCatalogFenceIntrinsic(mintAuthority, mintReceipt),
        "GE_CYCLE_STORE_CORRUPTION",
        /forced fresh catalog mint failure/u,
      );
      expect(mintRead).toHaveBeenCalledTimes(1);
    } finally {
      mintRead.mockRestore();
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(mintAuthority))
      .toMatchObject({ lifecycle: "poisoned", postDdlCatalogFenceMintCount: 0 });

    const assertGraph = cleanGraph();
    const assertAuthority = prepare(assertGraph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(assertAuthority);
    const assertReceipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(assertAuthority);
    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(assertAuthority, assertReceipt);
    const assertRead = vi.spyOn(
      targetCatalogModule,
      "readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic",
    ).mockImplementationOnce(() => {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        "inspect-schema",
        "forced fresh catalog assertion failure",
      );
    });
    try {
      expectProviderError(
        () => assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
          assertAuthority,
          assertReceipt,
          fence,
        ),
        "GE_CYCLE_STORE_CORRUPTION",
        /forced fresh catalog assertion failure/u,
      );
      expect(assertRead).toHaveBeenCalledTimes(1);
    } finally {
      assertRead.mockRestore();
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(assertAuthority).lifecycle)
      .toBe("poisoned");
  });

  it("uses the captured native run intrinsic after StatementSync prototype replacement", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const runDescriptor = Object.getOwnPropertyDescriptor(StatementSync.prototype, "run")!;
    try {
      Object.defineProperty(StatementSync.prototype, "run", {
        ...runDescriptor,
        value: (): never => { throw new Error("hostile StatementSync.run"); },
      });
      const receipt = executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
      expect(readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(receipt))
        .toMatchObject({ affectedRows: 1, fixedStatementCount: 20 });
    } finally {
      Object.defineProperty(StatementSync.prototype, "run", runDescriptor);
    }
    expect(assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority)).toBe(authority);
  });

  it("fails closed before 0002 if an upstream authority read prototype is replaced", () => {
    const graph = cleanGraph();
    const authority = prepare(graph);
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const before = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const prepareDescriptor = Object.getOwnPropertyDescriptor(
      DatabaseSync.prototype,
      "prepare",
    )!;
    try {
      Object.defineProperty(DatabaseSync.prototype, "prepare", {
        ...prepareDescriptor,
        value: (): never => { throw new Error("hostile DatabaseSync.prepare"); },
      });
      expect(() => executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority)).toThrow();
    } finally {
      Object.defineProperty(DatabaseSync.prototype, "prepare", prepareDescriptor);
    }
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(before.totalChanges);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authority)).toMatchObject({
      lifecycle: "poisoned",
      migration0002PreparedStatementCount: 0,
      outerLedger: {
        affectedRowsWatermark: 0,
        fixedStatementCount: 0,
        logicalWriteSequence: 0,
      },
    });
  });

  it("rejects a forged migration 0002 receipt", () => {
    expect(() => readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(
      Object.freeze(Object.create(null)) as SQLiteMigration0002CatalogRebuildReceipt,
    )).toThrow(/receipt is invalid/u);
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
      "executeSQLiteCursorMigration0002CatalogRebuildIntrinsic",
      "readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic",
      "SQLiteMigration0002CatalogRebuildReceipt",
      "SQLiteCursorPostDdlCatalogFence",
      "SQLiteCursorPostDdlCatalogFenceSnapshot",
      "mintSQLiteCursorPostDdlCatalogFenceIntrinsic",
      "assertSQLiteCursorPostDdlCatalogFenceIntrinsic",
      "readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic",
      "loadSQLiteCursorMigration0002AssetIntrinsic",
      "readSQLiteCursorMigration0002AssetSnapshotIntrinsic",
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
