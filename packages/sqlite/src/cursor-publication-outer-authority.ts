import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic,
  assertSQLiteCursorOuterClockAuthorityGraphIntrinsic,
  consumeSQLiteCursorProviderClockEvidenceIntrinsic,
  type SQLiteCursorMigrationLockCapability,
  type SQLiteCursorProviderClockCapability,
  type SQLiteCursorProviderClockConsumedTombstone,
  type SQLiteCursorProviderClockEvidence,
} from "./cursor-publication-clock-authority.js";
import {
  assertSQLiteCursorPreRebindReceiptProvenance,
  type SQLiteCursorPreRebindReceipt,
} from "./operation-baseline-cursor-ownership.js";
import {
  assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic,
  assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic,
  assertSQLiteCursorStageOwnershipPreRebindCompleteIntrinsic,
  mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic,
  poisonSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  type SQLiteCursorStageOwnershipOuterPublicationTail,
  type SQLiteCursorStageOwnershipTransfer,
} from "./operation-baseline-cursor-stage-ownership.js";
import type { OperationBaselineProjectionIdentity } from "./operation-baseline.js";
import { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import {
  SQLiteConnection,
  beginSQLiteConnectionMigration0002ExecutionIntrinsic,
  executeNextSQLiteConnectionMigration0002StatementIntrinsic,
  getSQLiteStatementNativeIntrinsic,
  prepareSQLiteConnectionCursorPublicationReadIntrinsic,
  readSQLiteConnectionMigration0002ExecutionSnapshotIntrinsic,
  type SQLiteConnectionTransactionLineage,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "./sqlite-connection.js";
import {
  SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
  SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
  SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
  SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
  SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
  loadSQLiteCursorMigration0002AssetIntrinsic,
  readSQLiteCursorMigration0002AssetSnapshotIntrinsic,
  type SQLiteCursorMigration0002Asset,
  type SQLiteCursorMigration0002PreviewManifestIdentity,
} from "./cursor-publication-migration-0002-asset.js";
import {
  digestSQLiteInitialWriteParametersIntrinsic,
  digestSQLiteInitialWriteResultIntrinsic,
  type SQLiteInitialWriteSha256,
} from "./cursor-publication-initial-write-digest.js";
import {
  readSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
  readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
  type SQLiteCursorPublicationTargetCatalogSnapshot,
} from "./cursor-publication-target-catalog.js";
import { sqliteRow, sqliteSafeInteger } from "./sqlite-codec.js";

const OPERATION = "inspect-schema" as const;
const objectFreezeIntrinsic = Object.freeze;
const objectCreateIntrinsic = Object.create;
const reflectApplyIntrinsic = Reflect.apply;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const maximumSafeIntegerIntrinsic = Number.MAX_SAFE_INTEGER;

export const SQLITE_CURSOR_PUBLICATION_TARGET = objectFreezeIntrinsic({
  applicationId: 1_195_724_359,
  catalogCanonicalUtf8Bytes: 5_785,
  catalogObjectCount: 34,
  catalogQuerySha256: "bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c",
  catalogSha256: "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf",
  descriptorBodySha256:
    "7bb784e57922facd28034dfdd504b37bd60c89e6c09fcd0d3f9adabb8456e214",
  descriptorCanonicalSha256:
    "27cfd73833b3a8ff29f0b33d2a73a51d1409b40a07e62c96ec4d9910a705a7d9",
  descriptorHash: "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92",
  schemaIdentitySha256:
    "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634",
  schemaVersion: 2,
  userVersion: 2,
} as const);

/** Opaque, package-private owner of the outer migration write ledger. */
export interface SQLiteCursorOuterPublicationAuthority {
  readonly __sqliteCursorOuterPublicationAuthority: never;
}

export interface SQLiteCursorOuterPublicationCancellationSignal {
  readonly __sqliteCursorOuterPublicationCancellationSignal: never;
}

export interface SQLiteCursorOuterPublicationCancellationController {
  readonly signal: SQLiteCursorOuterPublicationCancellationSignal;
  cancel(): void;
}

export type SQLiteCursorOuterPublicationAuthorityLifecycle =
  | "inactive"
  | "active"
  | "poisoned"
  | "retired";

export type SQLiteCursorOuterPublicationWritePhase =
  | "ready-0002"
  | "executing-0002"
  | "0002-complete"
  | "poisoned"
  | "retired";

export interface SQLiteMigration0002CatalogRebuildReceipt {
  readonly __sqliteMigration0002CatalogRebuildReceipt: never;
}

export interface SQLiteMigration0002CatalogRebuildReceiptSnapshot {
  readonly affectedRows: number;
  readonly applicationIdAfter: 1_195_724_359;
  readonly applicationIdBefore: 1_195_724_359;
  readonly assetSha256: typeof SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256;
  readonly assetUtf8Bytes: typeof SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES;
  readonly executeCount: 1;
  readonly fixedStatementCount: typeof SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT;
  readonly legacyOperationCopyRowCount: number;
  readonly outerLedgerAfter: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerBefore: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerDelta: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly parameterSha256: SQLiteInitialWriteSha256;
  readonly postDdlCatalogSha256: string;
  readonly preDdlCatalogSha256: string;
  readonly prepareCount: typeof SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT;
  readonly previewManifestSha256:
    typeof SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256;
  readonly previewManifestIdentity: SQLiteCursorMigration0002PreviewManifestIdentity;
  readonly resultSha256: SQLiteInitialWriteSha256;
  readonly schemaCopyRowCount: 1;
  readonly schemaSqlSha256: typeof SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256;
  readonly statementAffectedRows: readonly number[];
  readonly totalChangesAfter: number;
  readonly totalChangesBefore: number;
  readonly totalChangesDelta: number;
  readonly transactionEpochAfter: bigint;
  readonly transactionEpochBefore: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly userVersionAfter: 2;
  readonly userVersionBefore: 1;
  readonly writeKind: "migration-0002-catalog-rebuild";
}

export interface SQLiteCursorOuterPublicationLedgerSnapshot {
  readonly logicalWriteSequence: number;
  readonly fixedStatementCount: number;
  readonly affectedRowsWatermark: number;
}

export interface SQLiteCursorOuterPublicationAuthoritySnapshot {
  readonly lifecycle: SQLiteCursorOuterPublicationAuthorityLifecycle;
  readonly connection: SQLiteConnection;
  readonly stage: SQLiteBaselineTempStage;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly transfer: SQLiteCursorStageOwnershipTransfer;
  readonly migrationLockCapability: SQLiteCursorMigrationLockCapability;
  readonly providerClockCapability: SQLiteCursorProviderClockCapability;
  readonly outerClockEvidence: SQLiteCursorProviderClockEvidence;
  readonly outerClockConsumedTombstone:
    SQLiteCursorProviderClockConsumedTombstone | undefined;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transactionEpochAtPreparation: bigint;
  readonly totalChangesAtPreparation: number;
  readonly outerLedger: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly sourceSchemaVersion: 1;
  readonly target: typeof SQLITE_CURSOR_PUBLICATION_TARGET;
  readonly activationCount: 0 | 1;
  readonly migration0002LogicalExecutionCount: 0 | 1;
  readonly migration0002PreparedStatementCount: number;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt | undefined;
  readonly writePhase: SQLiteCursorOuterPublicationWritePhase;
}

interface AuthorityState {
  readonly connection: SQLiteConnection;
  readonly stage: SQLiteBaselineTempStage;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly transfer: SQLiteCursorStageOwnershipTransfer;
  readonly migrationLockCapability: SQLiteCursorMigrationLockCapability;
  readonly providerClockCapability: SQLiteCursorProviderClockCapability;
  readonly outerClockEvidence: SQLiteCursorProviderClockEvidence;
  readonly outerPublicationTail: SQLiteCursorStageOwnershipOuterPublicationTail;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transactionEpochAtPreparation: bigint;
  readonly totalChangesAtPreparation: number;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
  lifecycle: SQLiteCursorOuterPublicationAuthorityLifecycle;
  outerClockConsumedTombstone: SQLiteCursorProviderClockConsumedTombstone | undefined;
  currentTransactionEpoch: bigint;
  currentTotalChanges: number;
  activationCount: 0 | 1;
  affectedRowsWatermark: number;
  fixedStatementCount: number;
  logicalWriteSequence: number;
  migration0002LogicalExecutionCount: 0 | 1;
  migration0002PreparedStatementCount: number;
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt | undefined;
  writePhase: SQLiteCursorOuterPublicationWritePhase;
}

interface Migration0002ReceiptState {
  readonly asset: SQLiteCursorMigration0002Asset;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly connection: SQLiteConnection;
  readonly postDdlCatalog: SQLiteCursorPublicationTargetCatalogSnapshot;
  readonly preDdlCatalog: SQLiteCursorPublicationTargetCatalogSnapshot;
  readonly snapshot: SQLiteMigration0002CatalogRebuildReceiptSnapshot;
}

interface CancellationState { cancelled: boolean }

const AUTHORITIES = new WeakMap<object, AuthorityState>();
const AUTHORITY_BY_EVIDENCE = new WeakMap<object, SQLiteCursorOuterPublicationAuthority>();
const AUTHORITY_BY_TRANSFER = new WeakMap<object, SQLiteCursorOuterPublicationAuthority>();
const CANCELLATIONS = new WeakMap<object, CancellationState>();
const MIGRATION_0002_RECEIPTS = new WeakMap<object, Migration0002ReceiptState>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;

function fail(
  code: "GE_CYCLE_STORE_INVALID_ARGUMENT" | "GE_CYCLE_STORE_STALE_FENCE"
    | "GE_CYCLE_STORE_UNAVAILABLE" | "GE_CYCLE_STORE_CORRUPTION",
  message: string,
): never {
  throw new CycleStoreProviderError(code, OPERATION, message);
}

function authorityState(authority: SQLiteCursorOuterPublicationAuthority): AuthorityState {
  const state = authority !== null && typeof authority === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, AUTHORITIES, [authority as object]) as
      AuthorityState | undefined
    : undefined;
  if (state === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite outer publication authority is invalid");
  }
  return state;
}

function isStaleFence(error: unknown): boolean {
  return error instanceof CycleStoreProviderError
    && error.code === "GE_CYCLE_STORE_STALE_FENCE";
}

function poisonAuthorityGraph(
  state: AuthorityState,
  authority: SQLiteCursorOuterPublicationAuthority,
  message: string,
): void {
  state.lifecycle = "poisoned";
  state.writePhase = "poisoned";
  try {
    poisonSQLiteCursorStageOwnershipOuterPublicationIntrinsic(
      state.transfer, authority, message,
    );
  } catch {
    // The outer registry transition is authoritative; the bridge poisons its
    // transfer and stage synchronously before throwing its terminal error.
  }
}

function retireAuthorityGraph(
  state: AuthorityState,
  authority: SQLiteCursorOuterPublicationAuthority,
): void {
  state.lifecycle = "retired";
  state.writePhase = "retired";
  try {
    retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic(state.transfer, authority);
  } catch {
    // Preserve the stale-fence error that proved this transaction generation
    // can never safely resume. The outer authority is already retired.
  }
}

function terminateAfterInvariantFailure(
  state: AuthorityState,
  authority: SQLiteCursorOuterPublicationAuthority,
  error: unknown,
  message: string,
): void {
  if (isStaleFence(error)) retireAuthorityGraph(state, authority);
  else poisonAuthorityGraph(state, authority, message);
}

function sameGraph(
  state: AuthorityState,
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  projectionIdentity: OperationBaselineProjectionIdentity,
  transfer: SQLiteCursorStageOwnershipTransfer,
  migrationLockCapability: SQLiteCursorMigrationLockCapability,
  providerClockCapability: SQLiteCursorProviderClockCapability,
  outerClockEvidence: SQLiteCursorProviderClockEvidence,
): boolean {
  return state.connection === connection
    && state.stage === stage
    && state.receipt === receipt
    && state.projectionIdentity === projectionIdentity
    && state.transfer === transfer
    && state.migrationLockCapability === migrationLockCapability
    && state.providerClockCapability === providerClockCapability
    && state.outerClockEvidence === outerClockEvidence;
}

export function createSQLiteCursorOuterPublicationCancellationControllerIntrinsic():
SQLiteCursorOuterPublicationCancellationController {
  const signal = objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as SQLiteCursorOuterPublicationCancellationSignal;
  const state: CancellationState = { cancelled: false };
  reflectApplyIntrinsic(weakMapSetIntrinsic, CANCELLATIONS, [signal as object, state]);
  return objectFreezeIntrinsic({
    signal,
    cancel: (): void => { state.cancelled = true; },
  });
}

/**
 * Validate and register an inactive authority without consuming clock evidence.
 * Re-presenting the same exact graph returns the same inactive object; any
 * structural clone, substitution or cross-run mixture fails before the tail.
 */
export function prepareSQLiteCursorOuterPublicationAuthorityIntrinsic(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  projectionIdentity: OperationBaselineProjectionIdentity,
  transfer: SQLiteCursorStageOwnershipTransfer,
  migrationLockCapability: SQLiteCursorMigrationLockCapability,
  providerClockCapability: SQLiteCursorProviderClockCapability,
  outerClockEvidence: SQLiteCursorProviderClockEvidence,
): SQLiteCursorOuterPublicationAuthority {
  const receiptWitness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  if (receiptWitness.projectionIdentity !== projectionIdentity) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite outer publication projection is invalid");
  }

  const existingByEvidence = outerClockEvidence !== null
      && typeof outerClockEvidence === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, AUTHORITY_BY_EVIDENCE, [
      outerClockEvidence as object,
    ]) as SQLiteCursorOuterPublicationAuthority | undefined
    : undefined;
  const existingByTransfer = transfer !== null && typeof transfer === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, AUTHORITY_BY_TRANSFER, [
      transfer as object,
    ]) as SQLiteCursorOuterPublicationAuthority | undefined
    : undefined;
  if (existingByEvidence !== undefined || existingByTransfer !== undefined) {
    if (existingByEvidence === undefined || existingByEvidence !== existingByTransfer) {
      return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite outer publication graph was substituted");
    }
    const existing = authorityState(existingByEvidence);
    if (existing.lifecycle !== "inactive"
        || !sameGraph(
          existing, connection, stage, receipt, projectionIdentity, transfer,
          migrationLockCapability, providerClockCapability, outerClockEvidence,
        )) {
      return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite outer publication authority was reused");
    }
    try {
      const owner = readSQLiteConnectionOwnerSnapshot(connection);
      if (!owner.isTransaction || owner.transactionMode !== "exclusive"
          || owner.transactionLineage !== existing.transactionLineage) {
        fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite outer publication owner was retired");
      }
      const changes = readSQLiteConnectionTotalChangesSnapshot(connection);
      if (owner.transactionEpoch !== existing.currentTransactionEpoch
          || changes.transactionEpoch !== owner.transactionEpoch
          || changes.totalChanges !== existing.currentTotalChanges) {
        fail("GE_CYCLE_STORE_CORRUPTION", "SQLite outer publication owner advanced unexpectedly");
      }
      assertSQLiteCursorStageOwnershipPreRebindCompleteIntrinsic(
        connection, stage, receipt, projectionIdentity, transfer,
      );
      const clock = assertSQLiteCursorOuterClockAuthorityGraphIntrinsic(
        connection, migrationLockCapability, providerClockCapability, outerClockEvidence,
      );
      if (clock.transactionLineage !== owner.transactionLineage) {
        fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite outer publication clock owner changed");
      }
      assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic(
        connection, stage, receipt, projectionIdentity, transfer, existingByEvidence,
        existing.outerPublicationTail,
      );
      return existingByEvidence;
    } catch (error) {
      terminateAfterInvariantFailure(
        existing, existingByEvidence, error,
        "SQLite outer publication invariant failed during preparation",
      );
      throw error;
    }
  }

  assertSQLiteCursorStageOwnershipPreRebindCompleteIntrinsic(
    connection, stage, receipt, projectionIdentity, transfer,
  );
  const clock = assertSQLiteCursorOuterClockAuthorityGraphIntrinsic(
    connection, migrationLockCapability, providerClockCapability, outerClockEvidence,
  );
  const owner = readSQLiteConnectionOwnerSnapshot(connection);
  const changes = readSQLiteConnectionTotalChangesSnapshot(connection);
  if (!owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage === null
      || owner.transactionLineage !== clock.transactionLineage
      || owner.transactionEpoch !== clock.transactionEpoch
      || changes.transactionEpoch !== owner.transactionEpoch) {
    return fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite outer publication owner changed");
  }

  const mint = mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic(
    connection, stage, receipt, projectionIdentity, transfer,
  );
  const authority = mint.authority as SQLiteCursorOuterPublicationAuthority;
  const state: AuthorityState = {
    activationCount: 0,
    affectedRowsWatermark: 0,
    connection,
    currentTotalChanges: changes.totalChanges,
    currentTransactionEpoch: owner.transactionEpoch,
    lifecycle: "inactive",
    fixedStatementCount: 0,
    logicalWriteSequence: 0,
    migrationLockCapability,
    migration0002LogicalExecutionCount: 0,
    migration0002PreparedStatementCount: 0,
    migration0002Receipt: undefined,
    outerClockConsumedTombstone: undefined,
    outerClockEvidence,
    outerPublicationTail: mint.tail,
    projectionIdentity,
    providerClockCapability,
    receipt,
    sourceDescriptorHash: receiptWitness.sealReceipt.sourceDescriptorHash,
    sourceSchemaIdentitySha256: receiptWitness.sealReceipt.sourceSchemaIdentitySha256,
    stage,
    totalChangesAtPreparation: changes.totalChanges,
    transactionEpochAtPreparation: owner.transactionEpoch,
    transactionLineage: owner.transactionLineage,
    transfer,
    writePhase: "ready-0002",
  };
  reflectApplyIntrinsic(weakMapSetIntrinsic, AUTHORITIES, [authority as object, state]);
  reflectApplyIntrinsic(weakMapSetIntrinsic, AUTHORITY_BY_EVIDENCE, [
    outerClockEvidence as object, authority,
  ]);
  reflectApplyIntrinsic(weakMapSetIntrinsic, AUTHORITY_BY_TRANSFER, [transfer as object, authority]);
  return authority;
}

/**
 * Enter the synchronous no-SQL tail: consume evidence, retain its tombstone,
 * publish the already-prepared B2 transfer, then activate the authority.
 */
export function activateSQLiteCursorOuterPublicationAuthorityIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  cancellation?: SQLiteCursorOuterPublicationCancellationSignal,
): SQLiteCursorOuterPublicationAuthority {
  const state = authorityState(authority);
  if (state.lifecycle !== "inactive" || state.activationCount !== 0
      || state.outerClockConsumedTombstone !== undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite outer publication authority is not inactive");
  }
  // Cancellation presentation is caller-owned and therefore checked before
  // touching the graph. A cancelled signal is the sole retryable inactive path.
  if (cancellation !== undefined) {
    const cancelled = cancellation !== null && typeof cancellation === "object"
      ? reflectApplyIntrinsic(weakMapGetIntrinsic, CANCELLATIONS, [cancellation as object]) as
        CancellationState | undefined
      : undefined;
    if (cancelled === undefined) {
      return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite outer publication cancellation is invalid");
    }
    if (cancelled.cancelled) {
      return fail("GE_CYCLE_STORE_UNAVAILABLE", "SQLite outer publication activation was cancelled");
    }
  }

  try {
    const owner = readSQLiteConnectionOwnerSnapshot(state.connection);
    if (!owner.isTransaction || owner.transactionMode !== "exclusive"
        || owner.transactionLineage !== state.transactionLineage) {
      fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite outer publication owner was retired");
    }
    const changes = readSQLiteConnectionTotalChangesSnapshot(state.connection);
    if (owner.transactionEpoch !== state.currentTransactionEpoch
        || changes.transactionEpoch !== owner.transactionEpoch
        || changes.totalChanges !== state.currentTotalChanges) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite outer publication owner advanced unexpectedly");
    }
    assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic(
      state.connection, state.stage, state.receipt, state.projectionIdentity,
      state.transfer, authority, state.outerPublicationTail,
    );
    const clock = assertSQLiteCursorOuterClockAuthorityGraphIntrinsic(
      state.connection, state.migrationLockCapability, state.providerClockCapability,
      state.outerClockEvidence,
    );
    if (owner.transactionLineage !== clock.transactionLineage) {
      fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite outer publication owner changed");
    }
  } catch (error) {
    terminateAfterInvariantFailure(
      state, authority, error, "SQLite outer publication invariant failed before activation",
    );
    throw error;
  }

  try {
    const tombstone = consumeSQLiteCursorProviderClockEvidenceIntrinsic(
      state.providerClockCapability,
      state.outerClockEvidence,
      "outer-publication-authority",
    );
    state.outerClockConsumedTombstone = tombstone;
    publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic(state.outerPublicationTail);
    state.activationCount = 1;
    state.lifecycle = "active";
    return authority;
  } catch (error) {
    poisonAuthorityGraph(state, authority, "SQLite outer publication activation tail failed");
    throw error;
  }
}

/** Revalidate the reusable active authority without consuming it. */
export function assertSQLiteCursorOuterPublicationAuthorityIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
): SQLiteCursorOuterPublicationAuthority {
  const state = authorityState(authority);
  if (state.lifecycle !== "active" || state.activationCount !== 1
      || state.outerClockConsumedTombstone === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite outer publication authority is not active");
  }
  try {
    assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic(
      state.connection, state.stage, state.receipt, state.projectionIdentity,
      state.transfer, authority,
    );
    const clock = assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic(
      state.connection, state.migrationLockCapability, state.providerClockCapability,
      state.outerClockEvidence, state.outerClockConsumedTombstone,
    );
    const owner = readSQLiteConnectionOwnerSnapshot(state.connection);
    const changes = readSQLiteConnectionTotalChangesSnapshot(state.connection);
    if (!owner.isTransaction || owner.transactionMode !== "exclusive"
        || owner.transactionLineage !== state.transactionLineage
        || owner.transactionLineage !== clock.transactionLineage) {
      fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite active outer publication owner was retired");
    }
    if (owner.transactionEpoch !== state.currentTransactionEpoch
        || changes.transactionEpoch !== owner.transactionEpoch
        || changes.totalChanges !== state.currentTotalChanges) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite active outer publication ledger drifted");
    }
    return authority;
  } catch (error) {
    terminateAfterInvariantFailure(
      state, authority, error, "SQLite active outer publication invariant failed",
    );
    throw error;
  }
}

function outerLedgerSnapshot(state: AuthorityState): SQLiteCursorOuterPublicationLedgerSnapshot {
  return objectFreezeIntrinsic({
    affectedRowsWatermark: state.affectedRowsWatermark,
    fixedStatementCount: state.fixedStatementCount,
    logicalWriteSequence: state.logicalWriteSequence,
  });
}

function assertNoMigration0002TempConflicts(connection: SQLiteConnection): void {
  const statement = prepareSQLiteConnectionCursorPublicationReadIntrinsic(
    connection,
    "cursor-publication-migration-0002-temp-conflicts",
    OPERATION,
  );
  const count = sqliteSafeInteger(
    sqliteRow(
      getSQLiteStatementNativeIntrinsic(statement),
      1,
      OPERATION,
      "migration 0002 TEMP conflict count",
    )[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "migration 0002 TEMP conflict count",
  );
  if (count !== 0) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 TEMP names are shadowed");
  }
}

/**
 * Execute the exact package-owned 0002 asset inside the active outer owner.
 * The returned receipt is minted only after all 20 statements and target
 * catalog checks succeed; this leaf never begins, commits or rolls back.
 */
export function executeSQLiteCursorMigration0002CatalogRebuildIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
): SQLiteMigration0002CatalogRebuildReceipt {
  const state = authorityState(authority);
  if (state.migration0002Receipt !== undefined
      || state.migration0002LogicalExecutionCount !== 0
      || state.logicalWriteSequence !== 0 || state.fixedStatementCount !== 0
      || state.affectedRowsWatermark !== 0) {
    poisonAuthorityGraph(state, authority, "SQLite migration 0002 was executed more than once");
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 execution was reused");
  }
  // Reuse is terminal before any live SQLite revalidation. This preserves the
  // single-use contract literally: a second logical call emits no SQL at all.
  assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
  if (state.writePhase !== "ready-0002") {
    poisonAuthorityGraph(state, authority, "SQLite migration 0002 write phase is invalid");
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 write phase is invalid");
  }

  let execution: ReturnType<typeof beginSQLiteConnectionMigration0002ExecutionIntrinsic>
    | undefined;
  let preDdlCatalog: SQLiteCursorPublicationTargetCatalogSnapshot | undefined;
  let asset: SQLiteCursorMigration0002Asset | undefined;
  const totalChangesBefore = state.currentTotalChanges;
  const transactionEpochBefore = state.currentTransactionEpoch;
  const ledgerBefore = outerLedgerSnapshot(state);
  let schemaCopyRowCount = 0;
  let legacyOperationCopyRowCount = 0;
  const statementAffectedRows: number[] = [];

  try {
    if (!numberIsSafeIntegerIntrinsic(state.projectionIdentity.legacyOperationCount)
        || state.projectionIdentity.legacyOperationCount < 0
        || state.projectionIdentity.legacyOperationCount > maximumSafeIntegerIntrinsic - 1) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 legacy count is unsafe");
    }
    asset = loadSQLiteCursorMigration0002AssetIntrinsic();
    const assetSnapshot = readSQLiteCursorMigration0002AssetSnapshotIntrinsic(asset);
    if (assetSnapshot.assetSha256 !== SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256
        || assetSnapshot.assetUtf8Bytes !== SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES
        || assetSnapshot.fixedStatementCount
          !== SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
        || assetSnapshot.previewManifestSha256
          !== SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256
        || assetSnapshot.schemaSqlSha256 !== SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 asset identity drifted");
    }
    assertNoMigration0002TempConflicts(state.connection);
    preDdlCatalog = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      state.connection,
    );
    if (preDdlCatalog.applicationId !== SQLITE_CURSOR_PUBLICATION_TARGET.applicationId
        || preDdlCatalog.userVersion !== 1) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 source metadata drifted");
    }

    state.writePhase = "executing-0002";
    state.migration0002LogicalExecutionCount = 1;
    execution = beginSQLiteConnectionMigration0002ExecutionIntrinsic(
      state.connection,
      asset,
    );
    for (let ordinal = 1;
      ordinal <= SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT;
      ordinal += 1) {
      const step = executeNextSQLiteConnectionMigration0002StatementIntrinsic(
        state.connection,
        execution,
      );
      if (step.fixedStatementOrdinal !== ordinal
          || step.completedStatementCount !== ordinal
          || step.preparedStatementCount !== ordinal
          || step.transactionLineage !== state.transactionLineage) {
        fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 execution order drifted");
      }
      state.currentTransactionEpoch = step.transactionEpoch;
      state.currentTotalChanges = step.totalChanges;
      state.fixedStatementCount = step.completedStatementCount;
      state.migration0002PreparedStatementCount = step.preparedStatementCount;
      state.affectedRowsWatermark += step.affectedRowsDelta;
      statementAffectedRows[ordinal - 1] = step.affectedRowsDelta;
      if (ordinal === 4) schemaCopyRowCount = step.affectedRowsDelta;
      if (ordinal === 17) legacyOperationCopyRowCount = step.affectedRowsDelta;
    }

    const progress = readSQLiteConnectionMigration0002ExecutionSnapshotIntrinsic(
      state.connection,
      execution,
    );
    const expectedAffectedRows = 1 + state.projectionIdentity.legacyOperationCount;
    if (progress.lifecycle !== "completed"
        || progress.preparedStatementCount !== SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
        || progress.completedStatementCount
          !== SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
        || progress.nextStatementOrdinal
          !== SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT + 1
        || progress.transactionLineage !== state.transactionLineage
        || schemaCopyRowCount !== 1
        || legacyOperationCopyRowCount !== state.projectionIdentity.legacyOperationCount
        || progress.affectedRows !== expectedAffectedRows
        || state.affectedRowsWatermark !== expectedAffectedRows
        || progress.totalChanges - totalChangesBefore !== expectedAffectedRows
        || state.currentTotalChanges !== progress.totalChanges
        || state.currentTransactionEpoch !== progress.transactionEpoch) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 completion ledger drifted");
    }

    const postDdlCatalog =
      readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic(state.connection);
    const parameterSha256 = digestSQLiteInitialWriteParametersIntrinsic([[]]);
    const resultSha256 = digestSQLiteInitialWriteResultIntrinsic({
      affectedRows: `${expectedAffectedRows}`,
    });
    const ledgerAfter = objectFreezeIntrinsic({
      affectedRowsWatermark: expectedAffectedRows,
      fixedStatementCount: SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
      logicalWriteSequence: 1,
    });
    const snapshot = objectFreezeIntrinsic({
      affectedRows: expectedAffectedRows,
      applicationIdAfter: postDdlCatalog.applicationId as 1_195_724_359,
      applicationIdBefore: preDdlCatalog.applicationId as 1_195_724_359,
      assetSha256: SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
      assetUtf8Bytes: SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
      executeCount: 1 as const,
      fixedStatementCount: SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
      legacyOperationCopyRowCount,
      outerLedgerAfter: ledgerAfter,
      outerLedgerBefore: ledgerBefore,
      outerLedgerDelta: objectFreezeIntrinsic({
        affectedRowsWatermark: expectedAffectedRows,
        fixedStatementCount: SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
        logicalWriteSequence: 1,
      }),
      parameterSha256,
      postDdlCatalogSha256: postDdlCatalog.catalogSha256,
      preDdlCatalogSha256: preDdlCatalog.catalogSha256,
      prepareCount: SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
      previewManifestIdentity: assetSnapshot.previewManifestIdentity,
      previewManifestSha256: SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
      resultSha256,
      schemaCopyRowCount: 1 as const,
      schemaSqlSha256: SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
      statementAffectedRows: objectFreezeIntrinsic(statementAffectedRows),
      totalChangesAfter: progress.totalChanges,
      totalChangesBefore,
      totalChangesDelta: expectedAffectedRows,
      transactionEpochAfter: progress.transactionEpoch,
      transactionEpochBefore,
      transactionLineage: state.transactionLineage,
      userVersionAfter: postDdlCatalog.userVersion as 2,
      userVersionBefore: preDdlCatalog.userVersion as 1,
      writeKind: "migration-0002-catalog-rebuild" as const,
    } satisfies SQLiteMigration0002CatalogRebuildReceiptSnapshot);
    const receipt = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteMigration0002CatalogRebuildReceipt;
    reflectApplyIntrinsic(weakMapSetIntrinsic, MIGRATION_0002_RECEIPTS, [
      receipt as object,
      objectFreezeIntrinsic({
        asset,
        authority,
        connection: state.connection,
        postDdlCatalog,
        preDdlCatalog,
        snapshot,
      } satisfies Migration0002ReceiptState),
    ]);
    state.logicalWriteSequence = 1;
    state.migration0002Receipt = receipt;
    state.writePhase = "0002-complete";
    return receipt;
  } catch (error) {
    if (execution !== undefined) {
      try {
        const progress = readSQLiteConnectionMigration0002ExecutionSnapshotIntrinsic(
          state.connection,
          execution,
        );
        state.currentTransactionEpoch = progress.transactionEpoch;
        state.currentTotalChanges = progress.totalChanges;
        state.fixedStatementCount = progress.completedStatementCount;
        state.migration0002PreparedStatementCount = progress.preparedStatementCount;
        state.affectedRowsWatermark = progress.affectedRows;
      } catch {
        // The migration failure remains primary; the exact graph is poisoned below.
      }
    }
    poisonAuthorityGraph(state, authority, "SQLite migration 0002 execution failed");
    throw error;
  }
}

/** Validate authentic receipt provenance without consuming it. */
export function readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(
  receipt: SQLiteMigration0002CatalogRebuildReceipt,
): SQLiteMigration0002CatalogRebuildReceiptSnapshot {
  const state = receipt !== null && typeof receipt === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, MIGRATION_0002_RECEIPTS, [receipt as object]) as
      Migration0002ReceiptState | undefined
    : undefined;
  if (state === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite migration 0002 receipt is invalid");
  }
  const authority = authorityState(state.authority);
  assertSQLiteCursorOuterPublicationAuthorityIntrinsic(state.authority);
  const asset = readSQLiteCursorMigration0002AssetSnapshotIntrinsic(state.asset);
  if (authority.connection !== state.connection
      || authority.transactionLineage !== state.snapshot.transactionLineage
      || authority.migration0002Receipt !== receipt
      || authority.migration0002LogicalExecutionCount !== 1
      || authority.logicalWriteSequence < state.snapshot.outerLedgerAfter.logicalWriteSequence
      || authority.fixedStatementCount < state.snapshot.outerLedgerAfter.fixedStatementCount
      || authority.affectedRowsWatermark
        < state.snapshot.outerLedgerAfter.affectedRowsWatermark
      || authority.currentTransactionEpoch < state.snapshot.transactionEpochAfter
      || authority.currentTotalChanges < state.snapshot.totalChangesAfter
      || asset.previewManifestIdentity !== state.snapshot.previewManifestIdentity
      || asset.previewManifestSha256 !== state.snapshot.previewManifestSha256
      || asset.assetSha256 !== state.snapshot.assetSha256) {
    terminateAfterInvariantFailure(
      authority,
      state.authority,
      new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        OPERATION,
        "SQLite migration 0002 receipt graph drifted",
      ),
      "SQLite migration 0002 receipt graph drifted",
    );
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite migration 0002 receipt graph drifted");
  }
  return state.snapshot;
}

/** Package-private identity snapshot for downstream receipt construction and tests. */
export function readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
): SQLiteCursorOuterPublicationAuthoritySnapshot {
  const state = authorityState(authority);
  return objectFreezeIntrinsic({
    activationCount: state.activationCount,
    connection: state.connection,
    lifecycle: state.lifecycle,
    migrationLockCapability: state.migrationLockCapability,
    outerClockConsumedTombstone: state.outerClockConsumedTombstone,
    outerClockEvidence: state.outerClockEvidence,
    outerLedger: objectFreezeIntrinsic({
      affectedRowsWatermark: state.affectedRowsWatermark,
      fixedStatementCount: state.fixedStatementCount,
      logicalWriteSequence: state.logicalWriteSequence,
    }),
    projectionIdentity: state.projectionIdentity,
    providerClockCapability: state.providerClockCapability,
    receipt: state.receipt,
    sourceDescriptorHash: state.sourceDescriptorHash,
    sourceSchemaIdentitySha256: state.sourceSchemaIdentitySha256,
    sourceSchemaVersion: 1,
    stage: state.stage,
    target: SQLITE_CURSOR_PUBLICATION_TARGET,
    totalChangesAtPreparation: state.totalChangesAtPreparation,
    transactionEpochAtPreparation: state.transactionEpochAtPreparation,
    transactionLineage: state.transactionLineage,
    transfer: state.transfer,
    migration0002LogicalExecutionCount: state.migration0002LogicalExecutionCount,
    migration0002PreparedStatementCount: state.migration0002PreparedStatementCount,
    migration0002Receipt: state.migration0002Receipt,
    writePhase: state.writePhase,
  });
}
