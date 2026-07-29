import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

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
  type SQLiteCursorExactProjectionReference,
  type SQLiteCursorPreRebindReceipt,
} from "./operation-baseline-cursor-ownership.js";
import {
  assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic,
  assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic,
  assertSQLiteCursorStageOwnershipPostDdlReaderTerminalIntrinsic,
  assertSQLiteCursorStageOwnershipPreRebindCompleteIntrinsic,
  completeSQLiteCursorStageOwnershipPostDdlReaderIntrinsic,
  mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic,
  poisonSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  registerSQLiteCursorStageOwnershipPostDdlReaderIntrinsic,
  retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  type SQLiteCursorStageOwnershipOuterPublicationTail,
  type SQLiteCursorStageOwnershipTransfer,
} from "./operation-baseline-cursor-stage-ownership.js";
import {
  BASELINE_ENTRY_KINDS,
  MAX_BASELINE_KEY_BYTES,
  MAX_BASELINE_STATE_BYTES,
  OperationBaselineAccumulator,
  decodeOperationBaselineCanonicalBytes,
  validateOperationBaselineEntryBytes,
  type CanonicalOperationBaselineEntry,
  type OperationBaselineEntryKind,
  type OperationBaselineProjectionIdentity,
} from "./operation-baseline.js";
import { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import {
  SQLiteConnection,
  SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC,
  beginSQLiteConnectionMigration0002ExecutionIntrinsic,
  executeNextSQLiteConnectionMigration0002StatementIntrinsic,
  getSQLiteStatementNativeIntrinsic,
  iterateSQLiteStatementNativeIntrinsic,
  nextSQLiteStatementIteratorNativeIntrinsic,
  prepareSQLiteConnectionCursorPublicationReadIntrinsic,
  readSQLiteConnectionMigration0002ExecutionSnapshotIntrinsic,
  returnSQLiteStatementIteratorNativeIntrinsic,
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
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
  readSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
  readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
  type SQLiteCursorPublicationTargetCatalogSnapshot,
} from "./cursor-publication-target-catalog.js";
import { sqliteBlob, sqliteRow, sqliteSafeInteger, sqliteText } from "./sqlite-codec.js";
import { translateSQLiteError } from "./sqlite-errors.js";

const OPERATION = "inspect-schema" as const;
const objectFreezeIntrinsic = Object.freeze;
const objectCreateIntrinsic = Object.create;
const reflectApplyIntrinsic = Reflect.apply;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const maximumSafeIntegerIntrinsic = Number.MAX_SAFE_INTEGER;
const bufferCompareIntrinsic = Buffer.compare;
const bufferFromIntrinsic = Buffer.from;
const createHashIntrinsic = createHash;
const objectDefinePropertyIntrinsic = Object.defineProperty;
const operationBaselineAccumulatorAppendIntrinsic =
  OperationBaselineAccumulator.prototype.append;
const operationBaselineAccumulatorFinishIntrinsic =
  OperationBaselineAccumulator.prototype.finish;

export const SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL =
  SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC;
export const SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256 =
  "adae52750ecd70a75090b52de7d60763eea144c1383cf4739df9d8e8a6b2357f" as const;

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
  | "post-ddl-catalog-fence"
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

export interface SQLiteCursorPostDdlCatalogFence {
  readonly __sqliteCursorPostDdlCatalogFence: never;
}

export interface SQLiteCursorPostDdlCatalogFenceSnapshot {
  readonly applicationId: 1_195_724_359;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly catalogCanonicalUtf8Bytes: 5_785;
  readonly catalogInventory: typeof SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY;
  readonly catalogQuery: typeof SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY;
  readonly catalogQuerySha256: typeof SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256;
  readonly catalogRowCount: 34;
  readonly catalogSha256: "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf";
  readonly catalogDigestDomainUtf8: typeof SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8;
  readonly connection: SQLiteConnection;
  readonly consumesAnyWriteReceipt: false;
  readonly isFinalV2SemanticProof: false;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly mintCount: 1;
  readonly outerLedgerWatermark: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly proofScope: "post-0002-physical-target-catalog-before-baseline-publication";
  readonly totalChangesWatermark: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly userVersion: 2;
}

export interface SQLiteCursorPostDdlPublicationReaderLease {
  readonly __sqliteCursorPostDdlPublicationReaderLease: never;
}

export type SQLiteCursorPostDdlPublicationReaderLifecycle =
  | "minted-unused"
  | "reader-active"
  | "reader-closed"
  | "retired"
  | "poisoned";

export interface SQLiteCursorPostDdlPublicationReaderLeaseSnapshot {
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly closeAttemptCount: 0 | 1;
  readonly closeSucceeded: boolean;
  readonly connection: SQLiteConnection;
  readonly consumesAnyWriteReceipt: false;
  readonly readProofEpoch: bigint;
  readonly executeCount: 0 | 1;
  readonly fetchCount: number;
  readonly lifecycle: SQLiteCursorPostDdlPublicationReaderLifecycle;
  readonly mayMintStageAdoptionReceipt: false;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly mintCount: 1;
  readonly outerLedgerReadWatermark: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly ownershipAcquisitionCount: 0 | 1;
  readonly permanentWriteAuthority: false;
  readonly postDdlCatalogFence: SQLiteCursorPostDdlCatalogFence;
  readonly prepareCount: 0 | 1;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  readonly rederivedEntryCount: number | undefined;
  readonly rederivedFinalEntryHash: string | undefined;
  readonly rederivedFirstEntryHash: string | undefined;
  readonly rederivedLegacyOperationCount: number | undefined;
  readonly rederivedProjectionSha256: string | undefined;
  readonly sourceReadSql: typeof SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL;
  readonly sourceReadSqlSha256:
    typeof SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256;
  readonly stage: SQLiteBaselineTempStage;
  readonly totalChangesReadWatermark: number;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transactionEpoch: bigint;
  readonly transfer: SQLiteCursorStageOwnershipTransfer;
}

export interface SQLiteCursorOuterPublicationAuthoritySnapshot {
  readonly lifecycle: SQLiteCursorOuterPublicationAuthorityLifecycle;
  readonly connection: SQLiteConnection;
  readonly stage: SQLiteBaselineTempStage;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
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
  readonly postDdlCatalogFence: SQLiteCursorPostDdlCatalogFence | undefined;
  readonly postDdlCatalogFenceMintCount: 0 | 1;
  readonly postDdlPublicationReaderLease:
    SQLiteCursorPostDdlPublicationReaderLease | undefined;
  readonly postDdlPublicationReaderLeaseCloseCount: 0 | 1;
  readonly postDdlPublicationReaderLeaseMintCount: 0 | 1;
  readonly writePhase: SQLiteCursorOuterPublicationWritePhase;
}

interface AuthorityState {
  readonly connection: SQLiteConnection;
  readonly stage: SQLiteBaselineTempStage;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
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
  postDdlCatalogFence: SQLiteCursorPostDdlCatalogFence | undefined;
  postDdlCatalogFenceMintCount: 0 | 1;
  postDdlPublicationReaderLease: SQLiteCursorPostDdlPublicationReaderLease | undefined;
  postDdlPublicationReaderLeaseCloseCount: 0 | 1;
  postDdlPublicationReaderLeaseMintCount: 0 | 1;
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

interface PostDdlCatalogFenceState {
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly catalog: SQLiteCursorPublicationTargetCatalogSnapshot;
  readonly connection: SQLiteConnection;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly snapshot: SQLiteCursorPostDdlCatalogFenceSnapshot;
}

interface PostDdlPublicationReaderLeaseState {
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  closeAttemptCount: 0 | 1;
  closeSucceeded: boolean;
  readonly connection: SQLiteConnection;
  executeCount: 0 | 1;
  readonly fence: SQLiteCursorPostDdlCatalogFence;
  fetchCount: number;
  lifecycle: SQLiteCursorPostDdlPublicationReaderLifecycle;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly outerLedgerReadWatermark: SQLiteCursorOuterPublicationLedgerSnapshot;
  ownershipAcquisitionCount: 0 | 1;
  prepareCount: 0 | 1;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  rederivedProjection: OperationBaselineProjectionIdentity | undefined;
  retainedEntries: readonly CanonicalOperationBaselineEntry[] | undefined;
  readonly stage: SQLiteBaselineTempStage;
  readonly totalChangesReadWatermark: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transfer: SQLiteCursorStageOwnershipTransfer;
}

interface CancellationState { cancelled: boolean }

const AUTHORITIES = new WeakMap<object, AuthorityState>();
const AUTHORITY_BY_EVIDENCE = new WeakMap<object, SQLiteCursorOuterPublicationAuthority>();
const AUTHORITY_BY_TRANSFER = new WeakMap<object, SQLiteCursorOuterPublicationAuthority>();
const CANCELLATIONS = new WeakMap<object, CancellationState>();
const MIGRATION_0002_RECEIPTS = new WeakMap<object, Migration0002ReceiptState>();
const POST_DDL_CATALOG_FENCES = new WeakMap<object, PostDdlCatalogFenceState>();
const POST_DDL_PUBLICATION_READER_LEASES =
  new WeakMap<object, PostDdlPublicationReaderLeaseState>();
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
  if (state.lifecycle === "retired" || state.lifecycle === "poisoned") return;
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
  if (state.lifecycle === "retired" || state.lifecycle === "poisoned") return;
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
    postDdlCatalogFence: undefined,
    postDdlCatalogFenceMintCount: 0,
    postDdlPublicationReaderLease: undefined,
    postDdlPublicationReaderLeaseCloseCount: 0,
    postDdlPublicationReaderLeaseMintCount: 0,
    outerClockConsumedTombstone: undefined,
    outerClockEvidence,
    outerPublicationTail: mint.tail,
    projectionIdentity,
    projectionReference: receiptWitness.projectionReference,
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
    const translated = translateSQLiteError(error, OPERATION);
    terminateAfterInvariantFailure(
      state, authority, translated, "SQLite active outer publication invariant failed",
    );
    throw translated;
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

function postDdlCatalogFenceState(
  fence: SQLiteCursorPostDdlCatalogFence,
): PostDdlCatalogFenceState {
  const state = fence !== null && typeof fence === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, POST_DDL_CATALOG_FENCES, [fence as object]) as
      PostDdlCatalogFenceState | undefined
    : undefined;
  if (state === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite post-DDL catalog fence is invalid");
  }
  return state;
}

function exactLedger(
  left: SQLiteCursorOuterPublicationLedgerSnapshot,
  right: SQLiteCursorOuterPublicationLedgerSnapshot,
): boolean {
  return left.logicalWriteSequence === right.logicalWriteSequence
    && left.fixedStatementCount === right.fixedStatementCount
    && left.affectedRowsWatermark === right.affectedRowsWatermark;
}

function postDdlPublicationReaderLeaseState(
  lease: SQLiteCursorPostDdlPublicationReaderLease,
): PostDdlPublicationReaderLeaseState {
  const state = lease !== null && typeof lease === "object"
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic,
      POST_DDL_PUBLICATION_READER_LEASES,
      [lease as object],
    ) as PostDdlPublicationReaderLeaseState | undefined
    : undefined;
  if (state === undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL publication reader lease is invalid",
    );
  }
  return state;
}

function postDdlPublicationReaderCancellationState(
  cancellation: SQLiteCursorOuterPublicationCancellationSignal | undefined,
): CancellationState | undefined {
  if (cancellation === undefined) return undefined;
  const state = cancellation !== null && typeof cancellation === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, CANCELLATIONS, [cancellation as object]) as
      CancellationState | undefined
    : undefined;
  if (state === undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL publication reader cancellation is invalid",
    );
  }
  return state;
}

function sameProjectionIdentity(
  left: OperationBaselineProjectionIdentity,
  right: OperationBaselineProjectionIdentity,
): boolean {
  return left.baselineId === right.baselineId
    && left.entryCount === right.entryCount
    && left.firstEntryHash === right.firstEntryHash
    && left.finalEntryHash === right.finalEntryHash
    && left.legacyOperationCount === right.legacyOperationCount
    && left.projectionSha256 === right.projectionSha256;
}

function postDdlPublicationReaderCorruption(message: string): CycleStoreProviderError {
  return new CycleStoreProviderError(
    "GE_CYCLE_STORE_CORRUPTION",
    OPERATION,
    message,
  );
}

function postDdlPublicationReaderUnavailable(message: string): CycleStoreProviderError {
  return new CycleStoreProviderError(
    "GE_CYCLE_STORE_UNAVAILABLE",
    OPERATION,
    message,
  );
}

function postDdlPublicationReaderSnapshot(
  state: PostDdlPublicationReaderLeaseState,
): SQLiteCursorPostDdlPublicationReaderLeaseSnapshot {
  return objectFreezeIntrinsic({
    authority: state.authority,
    closeAttemptCount: state.closeAttemptCount,
    closeSucceeded: state.closeSucceeded,
    connection: state.connection,
    consumesAnyWriteReceipt: false as const,
    executeCount: state.executeCount,
    fetchCount: state.fetchCount,
    lifecycle: state.lifecycle,
    mayMintStageAdoptionReceipt: false as const,
    migration0002Receipt: state.migration0002Receipt,
    mintCount: 1 as const,
    outerLedgerReadWatermark: state.outerLedgerReadWatermark,
    ownershipAcquisitionCount: state.ownershipAcquisitionCount,
    permanentWriteAuthority: false as const,
    postDdlCatalogFence: state.fence,
    prepareCount: state.prepareCount,
    projectionIdentity: state.projectionIdentity,
    projectionReference: state.projectionReference,
    readProofEpoch: state.transactionEpoch,
    rederivedEntryCount: state.rederivedProjection?.entryCount,
    rederivedFinalEntryHash: state.rederivedProjection?.finalEntryHash,
    rederivedFirstEntryHash: state.rederivedProjection?.firstEntryHash,
    rederivedLegacyOperationCount: state.rederivedProjection?.legacyOperationCount,
    rederivedProjectionSha256: state.rederivedProjection?.projectionSha256,
    sourceReadSql: SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
    sourceReadSqlSha256: SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256,
    stage: state.stage,
    totalChangesReadWatermark: state.totalChangesReadWatermark,
    transactionEpoch: state.transactionEpoch,
    transactionLineage: state.transactionLineage,
    transfer: state.transfer,
  });
}

/**
 * Mint the one post-0002 physical-catalog proof from a fresh authority-owned
 * read. The migration receipt is retained, not consumed.
 */
export function mintSQLiteCursorPostDdlCatalogFenceIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
): SQLiteCursorPostDdlCatalogFence {
  const authorityRecord = authorityState(authority);
  if (authorityRecord.postDdlCatalogFence !== undefined
      || authorityRecord.postDdlCatalogFenceMintCount !== 0) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL catalog fence was minted more than once",
    );
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-DDL catalog fence mint was reused");
  }
  if (authorityRecord.writePhase !== "0002-complete"
      || authorityRecord.migration0002LogicalExecutionCount !== 1
      || authorityRecord.migration0002PreparedStatementCount
        !== SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
      || authorityRecord.migration0002Receipt === undefined) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL catalog fence was requested before migration 0002 completed",
    );
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-DDL catalog fence is premature");
  }

  const receiptRecord = migration0002Receipt !== null
      && typeof migration0002Receipt === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, MIGRATION_0002_RECEIPTS, [
      migration0002Receipt as object,
    ]) as Migration0002ReceiptState | undefined
    : undefined;
  if (receiptRecord === undefined || receiptRecord.authority !== authority
      || receiptRecord.connection !== authorityRecord.connection
      || authorityRecord.migration0002Receipt !== migration0002Receipt) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL catalog fence migration receipt is invalid",
    );
  }
  // Presentation identity is validated before any live SQLite read so a
  // forged/cross-run receipt cannot poison an otherwise valid graph.
  assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);

  try {
    const migration = readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(
      migration0002Receipt,
    );
    const currentLedger = outerLedgerSnapshot(authorityRecord);
    if (authorityRecord.currentTransactionEpoch !== migration.transactionEpochAfter
        || authorityRecord.currentTotalChanges !== migration.totalChangesAfter
        || !exactLedger(currentLedger, migration.outerLedgerAfter)) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-DDL catalog fence watermark drifted");
    }

    // This must be a new read. The catalog retained in the 0002 receipt is
    // comparison evidence only and can never be supplied as mint authority.
    const catalog =
      readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
        authorityRecord.connection,
      );
    assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    if (catalog.catalogSha256 !== migration.postDdlCatalogSha256
        || catalog.catalogSha256 !== receiptRecord.postDdlCatalog.catalogSha256
        || catalog.canonicalUtf8Bytes !== receiptRecord.postDdlCatalog.canonicalUtf8Bytes
        || catalog.rowCount !== receiptRecord.postDdlCatalog.rowCount
        || catalog.applicationId !== migration.applicationIdAfter
        || catalog.userVersion !== migration.userVersionAfter) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-DDL catalog fence disagreed with 0002");
    }

    const snapshot = objectFreezeIntrinsic({
      applicationId: catalog.applicationId as 1_195_724_359,
      authority,
      catalogCanonicalUtf8Bytes: catalog.canonicalUtf8Bytes as 5_785,
      catalogDigestDomainUtf8: SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
      catalogInventory: catalog.inventory as
        unknown as typeof SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY,
      catalogQuery: SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
      catalogQuerySha256: SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
      catalogRowCount: catalog.rowCount as 34,
      catalogSha256: catalog.catalogSha256 as
        "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf",
      connection: authorityRecord.connection,
      consumesAnyWriteReceipt: false as const,
      isFinalV2SemanticProof: false as const,
      migration0002Receipt,
      mintCount: 1 as const,
      outerLedgerWatermark: currentLedger,
      proofScope: "post-0002-physical-target-catalog-before-baseline-publication" as const,
      totalChangesWatermark: authorityRecord.currentTotalChanges,
      transactionEpoch: authorityRecord.currentTransactionEpoch,
      transactionLineage: authorityRecord.transactionLineage,
      userVersion: catalog.userVersion as 2,
    } satisfies SQLiteCursorPostDdlCatalogFenceSnapshot);
    const fence = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteCursorPostDdlCatalogFence;
    reflectApplyIntrinsic(weakMapSetIntrinsic, POST_DDL_CATALOG_FENCES, [
      fence as object,
      objectFreezeIntrinsic({
        authority,
        catalog,
        connection: authorityRecord.connection,
        migration0002Receipt,
        snapshot,
      } satisfies PostDdlCatalogFenceState),
    ]);
    authorityRecord.postDdlCatalogFence = fence;
    authorityRecord.postDdlCatalogFenceMintCount = 1;
    authorityRecord.writePhase = "post-ddl-catalog-fence";
    return fence;
  } catch (error) {
    terminateAfterInvariantFailure(
      authorityRecord,
      authority,
      error,
      "SQLite post-DDL catalog fence validation failed",
    );
    throw error;
  }
}

/** Reprove one exact live fence with a new physical-catalog read. */
export function assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
): SQLiteCursorPostDdlCatalogFence {
  const fenceRecord = postDdlCatalogFenceState(fence);
  if (fenceRecord.authority !== authority
      || fenceRecord.migration0002Receipt !== migration0002Receipt) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite post-DDL catalog fence graph is invalid");
  }
  const authorityRecord = authorityState(authority);
  if (authorityRecord.postDdlCatalogFence !== fence
      || authorityRecord.postDdlCatalogFenceMintCount !== 1
      || authorityRecord.migration0002Receipt !== migration0002Receipt
      || fenceRecord.connection !== authorityRecord.connection) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite post-DDL catalog fence graph is invalid");
  }

  try {
    assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(migration0002Receipt);
    const watermark = fenceRecord.snapshot.outerLedgerWatermark;
    if (authorityRecord.transactionLineage !== fenceRecord.snapshot.transactionLineage
        || authorityRecord.currentTransactionEpoch < fenceRecord.snapshot.transactionEpoch
        || authorityRecord.currentTotalChanges < fenceRecord.snapshot.totalChangesWatermark
        || authorityRecord.logicalWriteSequence < watermark.logicalWriteSequence
        || authorityRecord.fixedStatementCount < watermark.fixedStatementCount
        || authorityRecord.affectedRowsWatermark < watermark.affectedRowsWatermark) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-DDL catalog fence watermark regressed");
    }
    const catalog =
      readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
        authorityRecord.connection,
      );
    assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    if (catalog.catalogSha256 !== fenceRecord.snapshot.catalogSha256
        || catalog.canonicalUtf8Bytes !== fenceRecord.snapshot.catalogCanonicalUtf8Bytes
        || catalog.rowCount !== fenceRecord.snapshot.catalogRowCount
        || catalog.applicationId !== fenceRecord.snapshot.applicationId
        || catalog.userVersion !== fenceRecord.snapshot.userVersion) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-DDL catalog fence drifted");
    }
    return fence;
  } catch (error) {
    terminateAfterInvariantFailure(
      authorityRecord,
      authority,
      error,
      "SQLite post-DDL catalog fence revalidation failed",
    );
    throw error;
  }
}

export function readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic(
  fence: SQLiteCursorPostDdlCatalogFence,
): SQLiteCursorPostDdlCatalogFenceSnapshot {
  const state = postDdlCatalogFenceState(fence);
  assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
    state.authority,
    state.migration0002Receipt,
    fence,
  );
  return state.snapshot;
}

/** Mint the one-shot capability for the fixed ordered post-DDL TEMP read. */
export function mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
): SQLiteCursorPostDdlPublicationReaderLease {
  const authorityRecord = authorityState(authority);
  const fenceRecord = postDdlCatalogFenceState(fence);
  if (fenceRecord.authority !== authority
      || fenceRecord.migration0002Receipt !== migration0002Receipt
      || authorityRecord.migration0002Receipt !== migration0002Receipt
      || authorityRecord.postDdlCatalogFence !== fence) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL publication reader graph is invalid",
    );
  }
  if (authorityRecord.postDdlPublicationReaderLease !== undefined
      || authorityRecord.postDdlPublicationReaderLeaseMintCount !== 0) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader lease mint was reused",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-DDL publication reader lease mint was reused",
    );
  }
  if (authorityRecord.writePhase !== "post-ddl-catalog-fence") {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader lease mint is premature",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-DDL publication reader lease mint is premature",
    );
  }

  try {
    assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
      authority, migration0002Receipt, fence,
    );
    const sourceSqlSha256 = createHashIntrinsic("sha256")
      .update(SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL, "utf8")
      .digest("hex");
    if (SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL
          !== SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC
        || sourceSqlSha256
          !== SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite post-DDL publication reader source SQL identity drifted",
      );
    }
    const witness = assertSQLiteCursorPreRebindReceiptProvenance(authorityRecord.receipt);
    const ledger = outerLedgerSnapshot(authorityRecord);
    if (witness.projectionIdentity !== authorityRecord.projectionIdentity
        || witness.projectionReference !== authorityRecord.projectionReference
        || authorityRecord.transactionLineage !== fenceRecord.snapshot.transactionLineage
        || authorityRecord.currentTransactionEpoch !== fenceRecord.snapshot.transactionEpoch
        || authorityRecord.currentTotalChanges !== fenceRecord.snapshot.totalChangesWatermark
        || !exactLedger(ledger, fenceRecord.snapshot.outerLedgerWatermark)) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite post-DDL publication reader lease watermark drifted",
      );
    }
    const lease = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteCursorPostDdlPublicationReaderLease;
    const state: PostDdlPublicationReaderLeaseState = {
      authority,
      closeAttemptCount: 0,
      closeSucceeded: false,
      connection: authorityRecord.connection,
      executeCount: 0,
      fence,
      fetchCount: 0,
      lifecycle: "minted-unused",
      migration0002Receipt,
      outerLedgerReadWatermark: ledger,
      ownershipAcquisitionCount: 0,
      prepareCount: 0,
      projectionIdentity: authorityRecord.projectionIdentity,
      projectionReference: authorityRecord.projectionReference,
      rederivedProjection: undefined,
      retainedEntries: undefined,
      stage: authorityRecord.stage,
      totalChangesReadWatermark: authorityRecord.currentTotalChanges,
      transactionEpoch: authorityRecord.currentTransactionEpoch,
      transactionLineage: authorityRecord.transactionLineage,
      transfer: authorityRecord.transfer,
    };
    reflectApplyIntrinsic(weakMapSetIntrinsic, POST_DDL_PUBLICATION_READER_LEASES, [
      lease as object,
      state,
    ]);
    authorityRecord.postDdlPublicationReaderLease = lease;
    authorityRecord.postDdlPublicationReaderLeaseMintCount = 1;
    return lease;
  } catch (error) {
    terminateAfterInvariantFailure(
      authorityRecord,
      authority,
      error,
      "SQLite post-DDL publication reader lease mint failed",
    );
    throw error;
  }
}

/** Read lifecycle diagnostics from the exact opaque lease registry. */
export function readSQLiteCursorPostDdlPublicationReaderLeaseSnapshotIntrinsic(
  lease: SQLiteCursorPostDdlPublicationReaderLease,
): SQLiteCursorPostDdlPublicationReaderLeaseSnapshot {
  return postDdlPublicationReaderSnapshot(postDdlPublicationReaderLeaseState(lease));
}

/** Execute and retain the exact fixed TEMP source read under one-shot ownership. */
export function executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  lease: SQLiteCursorPostDdlPublicationReaderLease,
  cancellation?: SQLiteCursorOuterPublicationCancellationSignal,
): SQLiteCursorPostDdlPublicationReaderLease {
  const leaseRecord = postDdlPublicationReaderLeaseState(lease);
  if (leaseRecord.authority !== authority
      || leaseRecord.migration0002Receipt !== migration0002Receipt
      || leaseRecord.fence !== fence) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL publication reader lease graph is invalid",
    );
  }
  const authorityRecord = authorityState(authority);
  if (authorityRecord.postDdlPublicationReaderLease !== lease
      || authorityRecord.postDdlPublicationReaderLeaseMintCount !== 1
      || authorityRecord.projectionReference !== leaseRecord.projectionReference) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL publication reader lease graph is invalid",
    );
  }
  if (leaseRecord.lifecycle !== "minted-unused") {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader lease was reused",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-DDL publication reader lease was reused",
    );
  }

  // Presentation and pre-cancellation are resolved before prepare. A valid
  // pre-cancelled lease remains unused and may be retried exactly once later.
  const cancellationRecord = postDdlPublicationReaderCancellationState(cancellation);

  try {
    assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
      authority, migration0002Receipt, fence,
    );
    const sourceSqlSha256 = createHashIntrinsic("sha256")
      .update(SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL, "utf8")
      .digest("hex");
    if (SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL
          !== SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC
        || sourceSqlSha256
          !== SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite post-DDL publication reader source SQL identity drifted before prepare",
      );
    }
    if (authorityRecord.currentTransactionEpoch !== leaseRecord.transactionEpoch
        || authorityRecord.currentTotalChanges !== leaseRecord.totalChangesReadWatermark
        || !exactLedger(
          outerLedgerSnapshot(authorityRecord),
          leaseRecord.outerLedgerReadWatermark,
        )) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite post-DDL publication reader watermark drifted before prepare",
      );
    }
  } catch (error) {
    leaseRecord.lifecycle = "poisoned";
    terminateAfterInvariantFailure(
      authorityRecord,
      authority,
      error,
      "SQLite post-DDL publication reader pre-prepare validation failed",
    );
    throw error;
  }

  // Allocate every potentially throwing proof accumulator before native
  // iterator ownership begins, making the close boundary structurally total.
  let accumulator: OperationBaselineAccumulator;
  let retainedEntries: CanonicalOperationBaselineEntry[];
  try {
    accumulator = new OperationBaselineAccumulator(
      leaseRecord.projectionIdentity.baselineId,
      leaseRecord.projectionIdentity.entryCount,
    );
    retainedEntries = [];
  } catch {
    leaseRecord.lifecycle = "poisoned";
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader accumulator construction failed",
    );
    throw postDdlPublicationReaderCorruption(
      "SQLite post-DDL publication reader accumulator construction failed",
    );
  }
  if (cancellationRecord?.cancelled) {
    throw postDdlPublicationReaderUnavailable(
      "SQLite post-DDL publication reader was cancelled before ownership",
    );
  }

  let statement: ReturnType<typeof prepareSQLiteConnectionCursorPublicationReadIntrinsic>;
  try {
    statement = prepareSQLiteConnectionCursorPublicationReadIntrinsic(
      leaseRecord.connection,
      "cursor-publication-post-ddl-baseline-source",
      OPERATION,
    );
    leaseRecord.prepareCount = 1;
  } catch (error) {
    leaseRecord.lifecycle = "poisoned";
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader prepare failed",
    );
    throw translated;
  }

  let iterator: ReturnType<typeof iterateSQLiteStatementNativeIntrinsic>;
  try {
    iterator = iterateSQLiteStatementNativeIntrinsic(statement);
  } catch (error) {
    leaseRecord.lifecycle = "poisoned";
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader execute failed before ownership",
    );
    throw translated;
  }

  leaseRecord.executeCount = 1;
  leaseRecord.ownershipAcquisitionCount = 1;
  leaseRecord.lifecycle = "reader-active";
  let closeFailure: CycleStoreProviderError | undefined;
  const closeOwnedReader = (): void => {
    if (leaseRecord.closeAttemptCount === 1) {
      if (closeFailure !== undefined) throw closeFailure;
      return;
    }
    leaseRecord.closeAttemptCount = 1;
    authorityRecord.postDdlPublicationReaderLeaseCloseCount = 1;
    try {
      returnSQLiteStatementIteratorNativeIntrinsic(iterator);
      leaseRecord.closeSucceeded = true;
    } catch (error) {
      closeFailure = translateSQLiteError(error, OPERATION);
      throw closeFailure;
    }
  };
  const cleanupOwnedReader = (): void => {
    leaseRecord.lifecycle = "poisoned";
    closeOwnedReader();
  };

  let registered = false;
  let primaryFailure: CycleStoreProviderError | undefined;
  try {
    registerSQLiteCursorStageOwnershipPostDdlReaderIntrinsic(
      leaseRecord.transfer,
      authority,
      lease,
      cleanupOwnedReader,
    );
    registered = true;
  } catch {
    primaryFailure = postDdlPublicationReaderCorruption(
      "SQLite post-DDL publication reader cleanup ownership failed",
    );
  }

  let cancellationObserved = false;
  let terminalObserved = false;
  let retainedEntryCount = 0;
  let previousRank: number | undefined;
  let previousKey: Buffer | undefined;

  while (primaryFailure === undefined && !cancellationObserved) {
    if (cancellationRecord?.cancelled) {
      cancellationObserved = true;
      break;
    }
    let result: IteratorResult<unknown>;
    try {
      leaseRecord.fetchCount += 1;
      result = nextSQLiteStatementIteratorNativeIntrinsic(iterator);
    } catch (error) {
      primaryFailure = translateSQLiteError(error, OPERATION);
      break;
    }
    try {
      if (result === null || typeof result !== "object") {
        throw postDdlPublicationReaderCorruption(
          "SQLite post-DDL publication reader iterator result is invalid",
        );
      }
      if (result.done === true) {
        terminalObserved = true;
      } else {
        if (result.done !== false) {
          throw postDdlPublicationReaderCorruption(
            "SQLite post-DDL publication reader iterator terminal is invalid",
          );
        }
        const row = sqliteRow(result.value, 4, OPERATION, "post-DDL baseline source row");
        const rank = sqliteSafeInteger(
          row[0],
          0,
          BASELINE_ENTRY_KINDS.length - 1,
          OPERATION,
          "post-DDL baseline source kind rank",
        );
        const entryKind = sqliteText(
          row[1], OPERATION, "post-DDL baseline source entry kind",
        );
        if (BASELINE_ENTRY_KINDS[rank] !== entryKind) {
          throw postDdlPublicationReaderCorruption(
            "SQLite post-DDL publication reader kind rank drifted",
          );
        }
        const keyBytes = sqliteBlob(
          row[2], OPERATION, "post-DDL baseline source key",
        );
        const stateBytes = sqliteBlob(
          row[3], OPERATION, "post-DDL baseline source state",
        );
        if (previousRank !== undefined
            && (rank < previousRank
              || (rank === previousRank
                && bufferCompareIntrinsic(keyBytes, previousKey!) <= 0))) {
          throw postDdlPublicationReaderCorruption(
            "SQLite post-DDL publication reader source order drifted",
          );
        }
        validateOperationBaselineEntryBytes(
          entryKind as OperationBaselineEntryKind,
          keyBytes,
          stateBytes,
        );
        const canonical = reflectApplyIntrinsic(
          operationBaselineAccumulatorAppendIntrinsic,
          accumulator,
          [{
            entryKind: entryKind as OperationBaselineEntryKind,
            key: decodeOperationBaselineCanonicalBytes(keyBytes, MAX_BASELINE_KEY_BYTES),
            state: decodeOperationBaselineCanonicalBytes(stateBytes, MAX_BASELINE_STATE_BYTES),
          }],
        ) as CanonicalOperationBaselineEntry;
        if (bufferCompareIntrinsic(canonical.keyBytes, keyBytes) !== 0
            || bufferCompareIntrinsic(canonical.stateBytes, stateBytes) !== 0) {
          throw postDdlPublicationReaderCorruption(
            "SQLite post-DDL publication reader canonical bytes drifted",
          );
        }
        reflectApplyIntrinsic(objectDefinePropertyIntrinsic, Object, [
          retainedEntries,
          retainedEntryCount,
          {
            configurable: false,
            enumerable: true,
            value: canonical,
            writable: false,
          },
        ]);
        retainedEntryCount += 1;
        previousRank = rank;
        previousKey = bufferFromIntrinsic(keyBytes);
      }
    } catch (error) {
      primaryFailure = error instanceof CycleStoreProviderError
        ? error
        : postDdlPublicationReaderCorruption(
          "SQLite post-DDL publication reader row proof failed",
        );
    }
    if (primaryFailure === undefined && terminalObserved) break;
    if (primaryFailure === undefined && cancellationRecord?.cancelled) {
      cancellationObserved = true;
    }
  }

  let rederived: OperationBaselineProjectionIdentity | undefined;
  if (primaryFailure === undefined && terminalObserved) {
    try {
      rederived = reflectApplyIntrinsic(
        operationBaselineAccumulatorFinishIntrinsic,
        accumulator,
        [],
      ) as OperationBaselineProjectionIdentity;
      if (!sameProjectionIdentity(rederived, leaseRecord.projectionIdentity)) {
        throw postDdlPublicationReaderCorruption(
          "SQLite post-DDL publication reader projection disagreed with B2",
        );
      }
    } catch (error) {
      primaryFailure = error instanceof CycleStoreProviderError
        ? error
        : postDdlPublicationReaderCorruption(
          "SQLite post-DDL publication reader terminal proof failed",
        );
    }
  }
  if (rederived !== undefined) {
    leaseRecord.rederivedProjection = rederived;
  }

  try {
    closeOwnedReader();
  } catch {
    // Error precedence is resolved below after the mandatory close attempt.
  }
  if (leaseRecord.closeSucceeded
      && (leaseRecord.lifecycle as SQLiteCursorPostDdlPublicationReaderLifecycle)
        !== "poisoned") {
    leaseRecord.lifecycle = "reader-closed";
  }
  if (registered) {
    try {
      completeSQLiteCursorStageOwnershipPostDdlReaderIntrinsic(
        leaseRecord.transfer,
        authority,
        lease,
        leaseRecord.closeSucceeded,
      );
    } catch {
      primaryFailure ??= postDdlPublicationReaderCorruption(
        "SQLite post-DDL publication reader cleanup completion failed",
      );
    }
  }
  if (primaryFailure === undefined
      && terminalObserved
      && cancellationRecord?.cancelled) {
    cancellationObserved = true;
  }

  if (primaryFailure !== undefined) {
    leaseRecord.lifecycle = "poisoned";
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader primary proof failed",
    );
    throw primaryFailure;
  }
  if (closeFailure !== undefined || !leaseRecord.closeSucceeded) {
    leaseRecord.lifecycle = "poisoned";
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader close failed",
    );
    throw closeFailure ?? postDdlPublicationReaderCorruption(
      "SQLite post-DDL publication reader did not close",
    );
  }
  if ((leaseRecord.lifecycle as SQLiteCursorPostDdlPublicationReaderLifecycle)
        === "poisoned") {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader owner was cleaned up during read",
    );
    throw postDdlPublicationReaderCorruption(
      "SQLite post-DDL publication reader owner was cleaned up during read",
    );
  }

  try {
    assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
      authority, migration0002Receipt, fence,
    );
    assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    if (authorityRecord.currentTransactionEpoch !== leaseRecord.transactionEpoch
        || authorityRecord.currentTotalChanges !== leaseRecord.totalChangesReadWatermark
        || !exactLedger(
          outerLedgerSnapshot(authorityRecord),
          leaseRecord.outerLedgerReadWatermark,
        )) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite post-DDL publication reader watermark drifted after read",
      );
    }
  } catch (error) {
    leaseRecord.lifecycle = "poisoned";
    terminateAfterInvariantFailure(
      authorityRecord,
      authority,
      error,
      "SQLite post-DDL publication reader post-read fence failed",
    );
    throw error;
  }
  if (cancellationObserved || cancellationRecord?.cancelled) {
    leaseRecord.lifecycle = "poisoned";
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader was cancelled after ownership",
    );
    throw postDdlPublicationReaderUnavailable(
      "SQLite post-DDL publication reader was cancelled after ownership",
    );
  }
  if (rederived === undefined
      || retainedEntryCount !== leaseRecord.projectionIdentity.entryCount
      || retainedEntries.length !== retainedEntryCount) {
    leaseRecord.lifecycle = "poisoned";
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader retained proof is incomplete",
    );
    throw postDdlPublicationReaderCorruption(
      "SQLite post-DDL publication reader retained proof is incomplete",
    );
  }
  leaseRecord.retainedEntries = objectFreezeIntrinsic(retainedEntries);
  leaseRecord.lifecycle = "retired";
  return lease;
}

/** Reusable presentation of the exact retired/closed reader proof. */
export function assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  lease: SQLiteCursorPostDdlPublicationReaderLease,
): SQLiteCursorPostDdlPublicationReaderLease {
  const state = postDdlPublicationReaderLeaseState(lease);
  if (state.authority !== authority
      || state.migration0002Receipt !== migration0002Receipt
      || state.fence !== fence) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL publication reader terminal graph is invalid",
    );
  }
  if (state.lifecycle !== "retired"
      || state.prepareCount !== 1
      || state.executeCount !== 1
      || state.ownershipAcquisitionCount !== 1
      || state.closeAttemptCount !== 1
      || !state.closeSucceeded
      || state.rederivedProjection === undefined
      || state.retainedEntries === undefined
      || state.retainedEntries.length !== state.projectionIdentity.entryCount
      || state.rederivedProjection.entryCount !== state.projectionIdentity.entryCount) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL publication reader lease is not terminal",
    );
  }
  const authorityRecord = authorityState(authority);
  if (authorityRecord.postDdlPublicationReaderLease !== lease
      || authorityRecord.postDdlPublicationReaderLeaseMintCount !== 1
      || authorityRecord.postDdlPublicationReaderLeaseCloseCount !== 1
      || authorityRecord.projectionReference !== state.projectionReference) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-DDL publication reader terminal graph is invalid",
    );
  }
  assertSQLiteCursorStageOwnershipPostDdlReaderTerminalIntrinsic(
    state.transfer, authority, lease,
  );
  assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
    authority, migration0002Receipt, fence,
  );
  if (!sameProjectionIdentity(state.rederivedProjection, state.projectionIdentity)) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-DDL publication reader projection proof drifted",
    );
  }
  return lease;
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
    projectionReference: state.projectionReference,
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
    postDdlCatalogFence: state.postDdlCatalogFence,
    postDdlCatalogFenceMintCount: state.postDdlCatalogFenceMintCount,
    postDdlPublicationReaderLease: state.postDdlPublicationReaderLease,
    postDdlPublicationReaderLeaseCloseCount:
      state.postDdlPublicationReaderLeaseCloseCount,
    postDdlPublicationReaderLeaseMintCount:
      state.postDdlPublicationReaderLeaseMintCount,
    writePhase: state.writePhase,
  });
}
