import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  activateSQLiteCursorOuterPublicationAuthorityIntrinsic,
  executeSQLiteCursorMigration0002CatalogRebuildIntrinsic,
  mintSQLiteCursorPostDdlCatalogFenceIntrinsic,
  prepareSQLiteCursorOuterPublicationAuthorityIntrinsic,
  type SQLiteCursorOuterPublicationAuthority,
  type SQLiteCursorPostDdlCatalogFence,
  type SQLiteMigration0002CatalogRebuildReceipt,
} from "../../src/cursor-publication-outer-authority.js";
import {
  createSQLiteCursorMigrationLockCapabilityIntrinsic,
  createSQLiteCursorProviderClockCapabilityIntrinsic,
  createSQLiteCursorProviderClockSourceIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
  type SQLiteCursorMigrationLockCapability,
  type SQLiteCursorMigrationLockIdentity,
  type SQLiteCursorProviderClockCapability,
  type SQLiteCursorProviderClockEvidence,
} from "../../src/cursor-publication-clock-authority.js";
import { ensureSQLiteCycleStoreSchema } from "../../src/migrations.js";
import { runSQLiteCheckpointInvariantCampaign } from
  "../../src/operation-baseline-checkpoint-invariants.js";
import { runSQLiteCursorPreRebindCampaign } from
  "../../src/operation-baseline-cursor-campaign.js";
import {
  beginSQLiteCursorStageOwnershipTransfer,
  createSQLiteCursorSealTempTable,
  type SQLiteCursorStageOwnershipTransfer,
} from "../../src/operation-baseline-cursor-stage-ownership.js";
import { runSQLiteLeaseLockHoldInvariantCampaign } from
  "../../src/operation-baseline-lease-lock-hold-invariants.js";
import { runSQLiteLegacyInvariantCampaign } from
  "../../src/operation-baseline-legacy-invariants.js";
import { stageSQLiteV1BaselineSourceIntoTempStage } from
  "../../src/operation-baseline-reconcile.js";
import {
  configureSQLiteBaselineTempStorage,
  createSQLiteBaselineTempStage,
  proveSQLiteExclusiveBaselineTransaction,
  type SQLiteBaselineTempStage,
} from "../../src/operation-baseline-stage.js";
import { runSQLiteStreamRecordInvariantCampaign } from
  "../../src/operation-baseline-stream-record-invariants.js";
import { readSQLiteV1BaselineOrderedTempProjection } from
  "../../src/operation-baseline-handoff.js";
import {
  SQLiteCursorPreRebindReceiptIssuer,
  assertSQLiteCursorPreRebindReceiptProvenance,
  createSQLiteCursorCaptureSession,
  createSQLiteCursorExactProjectionReference,
  createSQLiteCursorOwnershipCapability,
  type SQLiteCursorExactProjectionReference,
  type SQLiteCursorPreRebindReceipt,
} from "../../src/operation-baseline-cursor-ownership.js";
import {
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
  type SQLiteCursorSealReceipt,
} from "../../src/operation-baseline-cursor-invariants.js";
import type { OperationBaselineProjectionIdentity } from "../../src/operation-baseline.js";
import {
  captureSQLiteV1BaselineSourceSummary,
  type SQLiteV1BaselineSourceSummary,
} from "../../src/operation-baseline-source.js";
import { SQLiteConnection } from "../../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../../src/sqlite-profile.js";

export const READER_CAPTURED_AT_MS = 1_785_110_405_000;

const LOCK = Object.freeze({
  activeExpiresAtMs: READER_CAPTURED_AT_MS + 100_000,
  fencingToken: 1,
  lockEpoch: 1,
  lockId: "b3-reader-lock",
  ownerId: "b3-reader-owner",
  sourceSchemaVersion: 1,
  targetSchemaVersion: 2,
} as const satisfies SQLiteCursorMigrationLockIdentity);

export interface ReaderLeaseTestGraph {
  readonly root: string;
  readonly connection: SQLiteConnection;
  readonly stage: SQLiteBaselineTempStage;
  readonly sourceSummary: SQLiteV1BaselineSourceSummary;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  readonly preRebindReceipt: SQLiteCursorPreRebindReceipt;
  readonly transfer: SQLiteCursorStageOwnershipTransfer;
  readonly migrationLockCapability: SQLiteCursorMigrationLockCapability;
  readonly providerClockCapability: SQLiteCursorProviderClockCapability;
  readonly outerClockEvidence: SQLiteCursorProviderClockEvidence;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly fence: SQLiteCursorPostDdlCatalogFence;
}

function installMigrationLock(connection: SQLiteConnection): void {
  connection.prepare(`
    INSERT INTO main.ge_cycle_used_migration_lock_ids
      (lock_id, lock_epoch, fencing_token, first_used_at_ms)
    VALUES (?, ?, ?, ?)
  `, "inspect-schema").run(
    LOCK.lockId,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    READER_CAPTURED_AT_MS - 1,
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
    READER_CAPTURED_AT_MS - 1,
    LOCK.activeExpiresAtMs,
    LOCK.lockEpoch,
    LOCK.fencingToken,
    READER_CAPTURED_AT_MS - 1,
  );
}

function mintPreRebindReceipt(
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

export function createReaderLeaseTestGraph(
  legacyOperationCount = 0,
  options: Readonly<{ outerProviderNowMs?: number }> = {},
): ReaderLeaseTestGraph {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-b3-reader-"));
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: READER_CAPTURED_AT_MS - 2,
  });
  installMigrationLock(connection);
  configureSQLiteBaselineTempStorage(connection);
  connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");

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
      `tenant-reader-${index}`,
      `operation-reader-${index}`,
      `${index + 1}`.padStart(64, "0"),
      governanceResult,
      governanceResultHash,
      READER_CAPTURED_AT_MS - 10 + index,
    );
  }

  const stage = createSQLiteBaselineTempStage(
    connection,
    proveSQLiteExclusiveBaselineTransaction(connection),
  );
  try {
    const sourceSummary = captureSQLiteV1BaselineSourceSummary(
      connection,
      READER_CAPTURED_AT_MS,
    );
    stageSQLiteV1BaselineSourceIntoTempStage(connection, sourceSummary, stage);
    const projectionIdentity = readSQLiteV1BaselineOrderedTempProjection(
      connection,
      sourceSummary,
      stage,
    );
    const diagnostics = [
      ...runSQLiteStreamRecordInvariantCampaign(connection, projectionIdentity, stage).diagnostics,
      ...runSQLiteCheckpointInvariantCampaign(connection, projectionIdentity, stage).diagnostics,
      ...runSQLiteLeaseLockHoldInvariantCampaign(connection, projectionIdentity, stage).diagnostics,
      ...runSQLiteLegacyInvariantCampaign(connection, projectionIdentity, stage).diagnostics,
    ];
    if (diagnostics.length !== 0) throw new Error("expected a clean reader-lease B2 graph");
    const preRebindReceipt = mintPreRebindReceipt(sourceSummary, projectionIdentity);
    const projectionReference = assertSQLiteCursorPreRebindReceiptProvenance(
      preRebindReceipt,
    ).projectionReference;
    const transfer = beginSQLiteCursorStageOwnershipTransfer(
      connection,
      stage,
      preRebindReceipt,
    );
    createSQLiteCursorSealTempTable(connection, stage, preRebindReceipt, transfer);
    const outcome = runSQLiteCursorPreRebindCampaign(
      connection,
      stage,
      preRebindReceipt,
      transfer,
    );
    if (outcome.status !== "pre-rebind-complete") throw new Error("expected clean B2");

    const migrationLockCapability = createSQLiteCursorMigrationLockCapabilityIntrinsic(
      connection,
      LOCK,
    );
    const providerClockSource = createSQLiteCursorProviderClockSourceIntrinsic(
      () => options.outerProviderNowMs ?? READER_CAPTURED_AT_MS,
    );
    const providerClockCapability = createSQLiteCursorProviderClockCapabilityIntrinsic(
      connection,
      migrationLockCapability,
      providerClockSource,
    );
    const outerClockEvidence = observeSQLiteCursorProviderClockIntrinsic(
      providerClockCapability,
      "before-first-permanent-mutation",
    );
    const authority = prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
      connection,
      stage,
      preRebindReceipt,
      projectionIdentity,
      transfer,
      migrationLockCapability,
      providerClockCapability,
      outerClockEvidence,
    );
    activateSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    const migration0002Receipt =
      executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(authority);
    const fence = mintSQLiteCursorPostDdlCatalogFenceIntrinsic(
      authority,
      migration0002Receipt,
    );
    return {
      authority,
      connection,
      fence,
      migration0002Receipt,
      migrationLockCapability,
      outerClockEvidence,
      preRebindReceipt,
      projectionIdentity,
      projectionReference,
      providerClockCapability,
      root,
      sourceSummary,
      stage,
      transfer,
    };
  } catch (error) {
    try { stage.dispose(); } catch { /* Preserve primary. */ }
    try {
      if (connection.isOpen && connection.isTransaction) {
        connection.execTrusted("ROLLBACK", "inspect-schema");
      }
    } catch { /* Preserve primary. */ }
    try { if (connection.isOpen) connection.close(); } catch { /* Preserve primary. */ }
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function disposeReaderLeaseTestGraph(graph: ReaderLeaseTestGraph): void {
  try { graph.stage.dispose(); } catch { /* Hostile tests may poison the stage. */ }
  try {
    if (graph.connection.isOpen && graph.connection.isTransaction) {
      graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    }
  } catch { /* Best effort. */ }
  try { if (graph.connection.isOpen) graph.connection.close(); } catch { /* Best effort. */ }
  rmSync(graph.root, { recursive: true, force: true });
}
