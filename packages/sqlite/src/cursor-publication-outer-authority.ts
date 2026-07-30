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
  BASELINE_GENESIS_HASH,
  encodeOperationBaselinePolicy,
  MAX_BASELINE_KEY_BYTES,
  MAX_BASELINE_STATE_BYTES,
  OperationBaselineAccumulator,
  decodeOperationBaselineCanonicalBytes,
  validateOperationBaselineEntryBytes,
  type CanonicalOperationBaselineEntry,
  type OperationBaselineEntryKind,
  type OperationBaselineProjectionIdentity,
  type OperationBaselineSourceEnvelope,
} from "./operation-baseline.js";
import { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import {
  SQLiteConnection,
  SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC,
  SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC,
  SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC,
  SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC,
  beginSQLiteConnectionBaselineEntryPublicationExecutionIntrinsic,
  beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic,
  beginSQLiteConnectionMigration0002ExecutionIntrinsic,
  executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic,
  executeSQLiteConnectionBaselineHeaderPublicationIntrinsic,
  executeNextSQLiteConnectionMigration0002StatementIntrinsic,
  getSQLiteStatementNativeIntrinsic,
  iterateSQLiteStatementNativeIntrinsic,
  nextSQLiteStatementIteratorNativeIntrinsic,
  prepareSQLiteConnectionCursorPublicationReadIntrinsic,
  readSQLiteConnectionBaselineEntryPublicationExecutionSnapshotIntrinsic,
  readSQLiteConnectionBaselineHeaderPublicationExecutionSnapshotIntrinsic,
  readSQLiteConnectionMigration0002ExecutionSnapshotIntrinsic,
  returnSQLiteStatementIteratorNativeIntrinsic,
  type SQLiteConnectionTransactionLineage,
  type SQLiteConnectionBaselineEntryPublicationRow,
  type SQLiteConnectionBaselineHeaderPublicationRow,
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
  type SQLiteInitialWriteParameterExecutions,
  type SQLiteInitialWriteSha256,
  type SQLiteInitialWriteTaggedScalar,
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
const bufferToStringIntrinsic = Buffer.prototype.toString;
const createHashIntrinsic = createHash;
const encodeOperationBaselinePolicyIntrinsic = encodeOperationBaselinePolicy;
const hashProbe = createHashIntrinsic("sha256");
const hashUpdateIntrinsic = hashProbe.update;
const hashDigestIntrinsic = hashProbe.digest;
const digestSQLiteInitialWriteParametersVerifierIntrinsic =
  digestSQLiteInitialWriteParametersIntrinsic;
const digestSQLiteInitialWriteResultVerifierIntrinsic =
  digestSQLiteInitialWriteResultIntrinsic;
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
  | "post-ddl-reader-closed"
  | "executing-baseline-entries"
  | "baseline-entries-complete"
  | "executing-baseline-header"
  | "baseline-header-complete"
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

export interface SQLiteBaselineEntriesPublicationReceipt {
  readonly __sqliteBaselineEntriesPublicationReceipt: never;
}

export interface SQLiteBaselineEntriesPublicationReceiptSnapshot {
  readonly affectedRows: number;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly baselineId: string;
  readonly connection: SQLiteConnection;
  readonly entryCount: number;
  readonly executeCount: number;
  readonly finalEntryHash: string;
  readonly firstEntryHash: string;
  readonly fixedInsertSql:
    typeof SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC;
  readonly fixedInsertSqlSha256:
    typeof SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly mintCount: 1;
  readonly outerLedgerAfter: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerBefore: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerDelta: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly parameterSha256: SQLiteInitialWriteSha256;
  readonly postDdlCatalogFence: SQLiteCursorPostDdlCatalogFence;
  readonly prepareCount: 1;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  readonly readerCloseCount: 1;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly readerLeaseLifecycle: "retired";
  readonly readerReDerivedProjectionSha256: string;
  readonly resultSha256: SQLiteInitialWriteSha256;
  readonly sourceReadSql: typeof SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL;
  readonly sourceReadSqlSha256:
    typeof SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256;
  readonly totalChangesAfter: number;
  readonly totalChangesBefore: number;
  readonly totalChangesDelta: number;
  readonly transactionEpochAfter: bigint;
  readonly transactionEpochBefore: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly writeKind: "baseline-entries-publication";
}

export const SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC =
  "graph-engineering-typescript" as const;
export const SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC =
  "0.1.0-alpha.1" as const;

export interface SQLiteBaselineHeaderPublicationReceipt {
  readonly __sqliteBaselineHeaderPublicationReceipt: never;
}

export interface SQLiteBaselineHeaderPublicationReceiptSnapshot {
  readonly affectedRows: 1;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly baselineId: string;
  readonly canonicalProjectionSha256: string;
  readonly capturedAtMs: number;
  readonly connection: SQLiteConnection;
  readonly creationRuntime:
    typeof SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC;
  readonly creationRuntimeVersion:
    typeof SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC;
  readonly entryCount: number;
  readonly executeCount: 1;
  readonly finalEntryHash: string;
  readonly fixedInsertSql:
    typeof SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC;
  readonly fixedInsertSqlSha256:
    typeof SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC;
  readonly firstEntryHash: string;
  readonly legacyOperationCount: number;
  readonly mintCount: 1;
  readonly outerLedgerAfter: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerBefore: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerDelta: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly parameterSha256: SQLiteInitialWriteSha256;
  readonly parameterOrder:
    typeof SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC;
  readonly policyBlobBase64url: string;
  readonly policyBlobSha256: string;
  readonly policyBlobUtf8Bytes: number;
  readonly postDdlCatalogFence: SQLiteCursorPostDdlCatalogFence;
  readonly prepareCount: 1;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly resultSha256: SQLiteInitialWriteSha256;
  readonly sourceDescriptorHash: string;
  readonly sourceMigrationLineageId: string;
  readonly sourceMigrationLineageSha256: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly totalChangesAfter: number;
  readonly totalChangesBefore: number;
  readonly totalChangesDelta: 1;
  readonly transactionEpochAfter: bigint;
  readonly transactionEpochBefore: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly writeKind: "baseline-header-publication";
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
  readonly baselineEntriesPublicationReceipt:
    SQLiteBaselineEntriesPublicationReceipt | undefined;
  readonly baselineEntriesPublicationReceiptMintCount: 0 | 1;
  readonly baselineEntriesLogicalExecutionCount: 0 | 1;
  readonly baselineEntriesPrepareCount: 0 | 1;
  readonly baselineEntriesExecuteCount: number;
  readonly baselineEntriesAffectedRows: number;
  readonly baselineHeaderPublicationReceipt:
    SQLiteBaselineHeaderPublicationReceipt | undefined;
  readonly baselineHeaderPublicationReceiptMintCount: 0 | 1;
  readonly baselineHeaderLogicalExecutionCount: 0 | 1;
  readonly baselineHeaderPrepareCount: 0 | 1;
  readonly baselineHeaderExecuteCount: 0 | 1;
  readonly baselineHeaderAffectedRows: 0 | 1;
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
  readonly sourceEnvelope: OperationBaselineSourceEnvelope;
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
  baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt | undefined;
  baselineEntriesPublicationReceiptMintCount: 0 | 1;
  baselineEntriesLogicalExecutionCount: 0 | 1;
  baselineEntriesPrepareCount: 0 | 1;
  baselineEntriesExecuteCount: number;
  baselineEntriesAffectedRows: number;
  baselineHeaderPublicationReceipt: SQLiteBaselineHeaderPublicationReceipt | undefined;
  baselineHeaderPublicationReceiptMintCount: 0 | 1;
  baselineHeaderLogicalExecutionCount: 0 | 1;
  baselineHeaderPrepareCount: 0 | 1;
  baselineHeaderExecuteCount: 0 | 1;
  baselineHeaderAffectedRows: 0 | 1;
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

interface BaselineEntriesPublicationReceiptState {
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly connection: SQLiteConnection;
  readonly fence: SQLiteCursorPostDdlCatalogFence;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly snapshot: SQLiteBaselineEntriesPublicationReceiptSnapshot;
}

interface BaselineHeaderPublicationReceiptState {
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly connection: SQLiteConnection;
  readonly fence: SQLiteCursorPostDdlCatalogFence;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly snapshot: SQLiteBaselineHeaderPublicationReceiptSnapshot;
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
const BASELINE_ENTRIES_PUBLICATION_RECEIPTS =
  new WeakMap<object, BaselineEntriesPublicationReceiptState>();
const BASELINE_HEADER_PUBLICATION_RECEIPTS =
  new WeakMap<object, BaselineHeaderPublicationReceiptState>();
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
    baselineEntriesPublicationReceipt: undefined,
    baselineEntriesPublicationReceiptMintCount: 0,
    baselineEntriesLogicalExecutionCount: 0,
    baselineEntriesPrepareCount: 0,
    baselineEntriesExecuteCount: 0,
    baselineEntriesAffectedRows: 0,
    baselineHeaderPublicationReceipt: undefined,
    baselineHeaderPublicationReceiptMintCount: 0,
    baselineHeaderLogicalExecutionCount: 0,
    baselineHeaderPrepareCount: 0,
    baselineHeaderExecuteCount: 0,
    baselineHeaderAffectedRows: 0,
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
    sourceEnvelope: receiptWitness.sourceSummary.sourceEnvelope,
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

function defineDenseArrayValue<T>(array: T[], index: number, value: T): void {
  reflectApplyIntrinsic(objectDefinePropertyIntrinsic, Object, [array, `${index}`, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  }]);
}

function sha256Utf8Intrinsic(value: string): string {
  const hash = createHashIntrinsic("sha256");
  reflectApplyIntrinsic(hashUpdateIntrinsic, hash, [value, "utf8"]);
  return reflectApplyIntrinsic(hashDigestIntrinsic, hash, ["hex"]) as string;
}

function sha256BytesIntrinsic(value: Uint8Array): string {
  const hash = createHashIntrinsic("sha256");
  reflectApplyIntrinsic(hashUpdateIntrinsic, hash, [value]);
  return reflectApplyIntrinsic(hashDigestIntrinsic, hash, ["hex"]) as string;
}

function initialWriteText(value: string): SQLiteInitialWriteTaggedScalar {
  return objectFreezeIntrinsic({ type: "text" as const, value });
}

function initialWriteInteger(value: number): SQLiteInitialWriteTaggedScalar {
  if (!numberIsSafeIntegerIntrinsic(value) || value < 0) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-entry publication integer is invalid",
    );
  }
  return objectFreezeIntrinsic({ type: "integer" as const, value: `${value}` });
}

function initialWriteBlob(value: Uint8Array): SQLiteInitialWriteTaggedScalar {
  const bytes = bufferFromIntrinsic(value);
  const encoded = reflectApplyIntrinsic(
    bufferToStringIntrinsic, bytes, ["base64url"],
  ) as string;
  return objectFreezeIntrinsic({ type: "blob" as const, value: encoded });
}

function baselineEntryParameterFrame(
  row: SQLiteConnectionBaselineEntryPublicationRow,
): readonly SQLiteInitialWriteTaggedScalar[] {
  const frame: SQLiteInitialWriteTaggedScalar[] = [];
  defineDenseArrayValue(frame, 0, initialWriteText(row.baselineId));
  defineDenseArrayValue(frame, 1, initialWriteInteger(row.ordinal));
  defineDenseArrayValue(frame, 2, initialWriteText(row.entryKind));
  defineDenseArrayValue(frame, 3, initialWriteBlob(row.entryKeyBlob));
  defineDenseArrayValue(frame, 4, initialWriteBlob(row.entryStateBlob));
  defineDenseArrayValue(frame, 5, initialWriteText(row.previousEntryHash));
  defineDenseArrayValue(frame, 6, initialWriteText(row.entryHash));
  return objectFreezeIntrinsic(frame);
}

function baselineHeaderParameterFrame(
  row: SQLiteConnectionBaselineHeaderPublicationRow,
): readonly SQLiteInitialWriteTaggedScalar[] {
  const frame: SQLiteInitialWriteTaggedScalar[] = [];
  defineDenseArrayValue(frame, 0, initialWriteText(row.baselineId));
  defineDenseArrayValue(frame, 1, initialWriteText(row.sourceSchemaIdentitySha256));
  defineDenseArrayValue(frame, 2, initialWriteText(row.sourceMigrationLineageId));
  defineDenseArrayValue(frame, 3, initialWriteText(row.sourceMigrationLineageSha256));
  defineDenseArrayValue(frame, 4, initialWriteText(row.sourceDescriptorHash));
  defineDenseArrayValue(frame, 5, initialWriteInteger(row.capturedAtMs));
  defineDenseArrayValue(frame, 6, initialWriteInteger(row.legacyOperationCount));
  defineDenseArrayValue(frame, 7, initialWriteInteger(row.entryCount));
  defineDenseArrayValue(frame, 8, initialWriteText(row.firstEntryHash));
  defineDenseArrayValue(frame, 9, initialWriteText(row.finalEntryHash));
  defineDenseArrayValue(frame, 10, initialWriteText(row.canonicalProjectionSha256));
  defineDenseArrayValue(frame, 11, initialWriteText(row.creationRuntime));
  defineDenseArrayValue(frame, 12, initialWriteText(row.creationRuntimeVersion));
  defineDenseArrayValue(frame, 13, initialWriteBlob(row.policyBlob));
  return objectFreezeIntrinsic(frame);
}

function digestBaselineHeaderParametersIntrinsic(
  row: SQLiteConnectionBaselineHeaderPublicationRow,
): SQLiteInitialWriteSha256 {
  const executions: SQLiteInitialWriteTaggedScalar[][] = [];
  defineDenseArrayValue(
    executions,
    0,
    baselineHeaderParameterFrame(row) as SQLiteInitialWriteTaggedScalar[],
  );
  return digestSQLiteInitialWriteParametersVerifierIntrinsic(
    objectFreezeIntrinsic(executions) as SQLiteInitialWriteParameterExecutions,
  );
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
    const sourceSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
    );
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
    const sourceSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
    );
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
  if (authorityRecord.writePhase !== "post-ddl-catalog-fence"
      || authorityRecord.baselineEntriesPublicationReceipt !== undefined
      || authorityRecord.baselineEntriesPublicationReceiptMintCount !== 0) {
    leaseRecord.lifecycle = "poisoned";
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite post-DDL publication reader completion phase drifted",
    );
    throw postDdlPublicationReaderCorruption(
      "SQLite post-DDL publication reader completion phase drifted",
    );
  }
  leaseRecord.retainedEntries = objectFreezeIntrinsic(retainedEntries);
  leaseRecord.lifecycle = "retired";
  authorityRecord.writePhase = "post-ddl-reader-closed";
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

function baselineEntriesReceiptState(
  receipt: SQLiteBaselineEntriesPublicationReceipt,
): BaselineEntriesPublicationReceiptState {
  const state = receipt !== null && typeof receipt === "object"
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic,
      BASELINE_ENTRIES_PUBLICATION_RECEIPTS,
      [receipt as object],
    ) as BaselineEntriesPublicationReceiptState | undefined
    : undefined;
  if (state === undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite baseline-entries publication receipt is invalid",
    );
  }
  return state;
}

function digestRetainedBaselineEntryParametersIntrinsic(
  reader: PostDdlPublicationReaderLeaseState,
): SQLiteInitialWriteSha256 {
  const retainedEntries = reader.retainedEntries;
  const projection = reader.rederivedProjection;
  if (retainedEntries === undefined
      || projection === undefined
      || retainedEntries.length !== projection.entryCount) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-entries publication retained parameters are unavailable",
    );
  }
  const executions: SQLiteInitialWriteTaggedScalar[][] = [];
  let previousEntryHash = BASELINE_GENESIS_HASH;
  for (let ordinal = 0; ordinal < projection.entryCount; ordinal += 1) {
    const entry = retainedEntries[ordinal];
    if (entry === undefined
        || entry.baselineId !== projection.baselineId
        || entry.ordinal !== ordinal
        || entry.previousEntryHash !== previousEntryHash
        || (ordinal === 0 && entry.entryHash !== projection.firstEntryHash)
        || (ordinal === projection.entryCount - 1
          && entry.entryHash !== projection.finalEntryHash)) {
      return fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite baseline-entries publication retained parameter chain drifted",
      );
    }
    const row = objectFreezeIntrinsic({
      baselineId: entry.baselineId,
      entryHash: entry.entryHash,
      entryKeyBlob: bufferFromIntrinsic(entry.keyBytes),
      entryKind: entry.entryKind,
      entryStateBlob: bufferFromIntrinsic(entry.stateBytes),
      ordinal: entry.ordinal,
      previousEntryHash: entry.previousEntryHash,
    } satisfies SQLiteConnectionBaselineEntryPublicationRow);
    const frame = baselineEntryParameterFrame(row);
    defineDenseArrayValue(
      executions,
      ordinal,
      frame as SQLiteInitialWriteTaggedScalar[],
    );
    previousEntryHash = entry.entryHash;
  }
  if (projection.entryCount === 0
      ? projection.firstEntryHash !== projection.finalEntryHash
      : previousEntryHash !== projection.finalEntryHash) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-entries publication retained parameter terminus drifted",
    );
  }
  return digestSQLiteInitialWriteParametersVerifierIntrinsic(
    objectFreezeIntrinsic(executions) as SQLiteInitialWriteParameterExecutions,
  );
}

/** Publish only the canonical rows retained by the exact terminal reader lease. */
export function executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  terminalLease: SQLiteCursorPostDdlPublicationReaderLease,
): SQLiteBaselineEntriesPublicationReceipt {
  const authorityRecord = authorityState(authority);
  const reader = postDdlPublicationReaderLeaseState(terminalLease);
  if (reader.authority !== authority
      || reader.migration0002Receipt !== migration0002Receipt
      || reader.fence !== fence
      || authorityRecord.migration0002Receipt !== migration0002Receipt
      || authorityRecord.postDdlCatalogFence !== fence
      || authorityRecord.postDdlPublicationReaderLease !== terminalLease) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite baseline-entries publication graph is invalid",
    );
  }
  if (authorityRecord.baselineEntriesPublicationReceipt !== undefined
      || authorityRecord.baselineEntriesPublicationReceiptMintCount !== 0
      || authorityRecord.baselineEntriesLogicalExecutionCount !== 0
      || authorityRecord.baselineEntriesPrepareCount !== 0
      || authorityRecord.baselineEntriesExecuteCount !== 0
      || authorityRecord.baselineEntriesAffectedRows !== 0) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication was reused",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-entries publication was reused",
    );
  }

  assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic(
    authority, migration0002Receipt, fence, terminalLease,
  );
  readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(migration0002Receipt);
  const retainedEntries = reader.retainedEntries;
  const projection = reader.rederivedProjection;
  if (authorityRecord.writePhase !== "post-ddl-reader-closed"
      || retainedEntries === undefined
      || projection === undefined
      || retainedEntries.length !== authorityRecord.projectionIdentity.entryCount
      || !sameProjectionIdentity(projection, authorityRecord.projectionIdentity)
      || reader.projectionReference !== authorityRecord.projectionReference
      || reader.closeAttemptCount !== 1
      || !reader.closeSucceeded) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication predecessor is invalid",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-entries publication predecessor is invalid",
    );
  }

  let sourceSqlSha256: string;
  let insertSqlSha256: string;
  try {
    sourceSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
    );
    insertSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC,
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication SQL identity observation failed",
    );
    throw translated;
  }
  if (sourceSqlSha256 !== SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256
      || insertSqlSha256
        !== SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication SQL identity drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-entries publication SQL identity drifted",
    );
  }

  const expectedEntryCount = projection.entryCount;
  const rows: SQLiteConnectionBaselineEntryPublicationRow[] = [];
  const parameterExecutions: SQLiteInitialWriteTaggedScalar[][] = [];
  let previousEntryHash = BASELINE_GENESIS_HASH;
  try {
    for (let ordinal = 0; ordinal < expectedEntryCount; ordinal += 1) {
      const entry = retainedEntries[ordinal];
      if (entry === undefined
          || entry.baselineId !== projection.baselineId
          || entry.ordinal !== ordinal
          || entry.previousEntryHash !== previousEntryHash
          || (ordinal === 0 && entry.entryHash !== projection.firstEntryHash)
          || (ordinal === expectedEntryCount - 1
            && entry.entryHash !== projection.finalEntryHash)) {
        fail(
          "GE_CYCLE_STORE_CORRUPTION",
          "SQLite baseline-entries publication retained chain drifted",
        );
      }
      const row = objectFreezeIntrinsic({
        baselineId: entry.baselineId,
        entryHash: entry.entryHash,
        entryKeyBlob: bufferFromIntrinsic(entry.keyBytes),
        entryKind: entry.entryKind,
        entryStateBlob: bufferFromIntrinsic(entry.stateBytes),
        ordinal: entry.ordinal,
        previousEntryHash: entry.previousEntryHash,
      } satisfies SQLiteConnectionBaselineEntryPublicationRow);
      defineDenseArrayValue(rows, ordinal, row);
      defineDenseArrayValue(
        parameterExecutions,
        ordinal,
        baselineEntryParameterFrame(row) as SQLiteInitialWriteTaggedScalar[],
      );
      previousEntryHash = entry.entryHash;
    }
    if (expectedEntryCount === 0
        ? projection.firstEntryHash !== projection.finalEntryHash
        : previousEntryHash !== projection.finalEntryHash) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite baseline-entries publication terminal chain drifted",
      );
    }
  } catch (error) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication parameter construction failed",
    );
    throw error;
  }

  const totalChangesBefore = authorityRecord.currentTotalChanges;
  const transactionEpochBefore = authorityRecord.currentTransactionEpoch;
  const ledgerBefore = outerLedgerSnapshot(authorityRecord);
  let execution: ReturnType<
    typeof beginSQLiteConnectionBaselineEntryPublicationExecutionIntrinsic
  > | undefined;
  try {
    authorityRecord.writePhase = "executing-baseline-entries";
    authorityRecord.baselineEntriesLogicalExecutionCount = 1;
    execution = beginSQLiteConnectionBaselineEntryPublicationExecutionIntrinsic(
      authorityRecord.connection,
      expectedEntryCount,
    );
    authorityRecord.baselineEntriesPrepareCount = 1;
    for (let ordinal = 0; ordinal < expectedEntryCount; ordinal += 1) {
      const step = executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic(
        authorityRecord.connection,
        execution,
        rows[ordinal]!,
      );
      if (step.entryOrdinal !== ordinal
          || step.completedEntryCount !== ordinal + 1
          || step.executeCount !== ordinal + 1
          || step.prepareCount !== 1
          || step.affectedRowsDelta !== 1
          || step.transactionLineage !== authorityRecord.transactionLineage) {
        fail(
          "GE_CYCLE_STORE_CORRUPTION",
          "SQLite baseline-entries publication execution drifted",
        );
      }
      authorityRecord.currentTransactionEpoch = step.transactionEpoch;
      authorityRecord.currentTotalChanges = step.totalChanges;
      authorityRecord.baselineEntriesExecuteCount = step.executeCount;
      authorityRecord.baselineEntriesAffectedRows = step.completedEntryCount;
      authorityRecord.fixedStatementCount = ledgerBefore.fixedStatementCount
        + step.completedEntryCount;
      authorityRecord.affectedRowsWatermark = ledgerBefore.affectedRowsWatermark
        + step.completedEntryCount;
    }

    const progress = readSQLiteConnectionBaselineEntryPublicationExecutionSnapshotIntrinsic(
      authorityRecord.connection,
      execution,
    );
    if (progress.lifecycle !== "completed"
        || progress.prepareCount !== 1
        || progress.executeCount !== expectedEntryCount
        || progress.completedEntryCount !== expectedEntryCount
        || progress.expectedEntryCount !== expectedEntryCount
        || progress.nextEntryOrdinal !== expectedEntryCount
        || progress.affectedRows !== expectedEntryCount
        || progress.totalChangesDelta !== expectedEntryCount
        || progress.totalChanges - totalChangesBefore !== expectedEntryCount
        || progress.transactionLineage !== authorityRecord.transactionLineage
        || authorityRecord.currentTransactionEpoch !== progress.transactionEpoch
        || authorityRecord.currentTotalChanges !== progress.totalChanges
        || authorityRecord.fixedStatementCount
          !== ledgerBefore.fixedStatementCount + expectedEntryCount
        || authorityRecord.affectedRowsWatermark
          !== ledgerBefore.affectedRowsWatermark + expectedEntryCount) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite baseline-entries publication completion ledger drifted",
      );
    }

    const parameterSha256 = digestSQLiteInitialWriteParametersIntrinsic(
      objectFreezeIntrinsic(parameterExecutions) as SQLiteInitialWriteParameterExecutions,
    );
    const verifiedParameterSha256 =
      digestRetainedBaselineEntryParametersIntrinsic(reader);
    const resultSha256 = digestSQLiteInitialWriteResultIntrinsic({
      affectedRows: `${expectedEntryCount}`,
    });
    const verifiedResultSha256 = digestSQLiteInitialWriteResultVerifierIntrinsic({
      affectedRows: `${expectedEntryCount}`,
    });
    if (parameterSha256 !== verifiedParameterSha256
        || resultSha256 !== verifiedResultSha256) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite baseline-entries publication receipt digest drifted",
      );
    }
    const ledgerAfter = objectFreezeIntrinsic({
      affectedRowsWatermark: ledgerBefore.affectedRowsWatermark + expectedEntryCount,
      fixedStatementCount: ledgerBefore.fixedStatementCount + expectedEntryCount,
      logicalWriteSequence: ledgerBefore.logicalWriteSequence + 1,
    });
    const snapshot = objectFreezeIntrinsic({
      affectedRows: expectedEntryCount,
      authority,
      baselineId: projection.baselineId,
      connection: authorityRecord.connection,
      entryCount: expectedEntryCount,
      executeCount: expectedEntryCount,
      finalEntryHash: projection.finalEntryHash,
      firstEntryHash: projection.firstEntryHash,
      fixedInsertSql: SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC,
      fixedInsertSqlSha256:
        SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
      migration0002Receipt,
      mintCount: 1 as const,
      outerLedgerAfter: ledgerAfter,
      outerLedgerBefore: ledgerBefore,
      outerLedgerDelta: objectFreezeIntrinsic({
        affectedRowsWatermark: expectedEntryCount,
        fixedStatementCount: expectedEntryCount,
        logicalWriteSequence: 1,
      }),
      parameterSha256,
      postDdlCatalogFence: fence,
      prepareCount: 1 as const,
      projectionIdentity: authorityRecord.projectionIdentity,
      projectionReference: authorityRecord.projectionReference,
      readerCloseCount: 1 as const,
      readerLease: terminalLease,
      readerLeaseLifecycle: "retired" as const,
      readerReDerivedProjectionSha256: projection.projectionSha256,
      resultSha256,
      sourceReadSql: SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
      sourceReadSqlSha256: SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256,
      totalChangesAfter: progress.totalChanges,
      totalChangesBefore,
      totalChangesDelta: expectedEntryCount,
      transactionEpochAfter: progress.transactionEpoch,
      transactionEpochBefore,
      transactionLineage: authorityRecord.transactionLineage,
      writeKind: "baseline-entries-publication" as const,
    } satisfies SQLiteBaselineEntriesPublicationReceiptSnapshot);
    const receipt = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteBaselineEntriesPublicationReceipt;
    reflectApplyIntrinsic(weakMapSetIntrinsic, BASELINE_ENTRIES_PUBLICATION_RECEIPTS, [
      receipt as object,
      objectFreezeIntrinsic({
        authority,
        connection: authorityRecord.connection,
        fence,
        migration0002Receipt,
        readerLease: terminalLease,
        snapshot,
      } satisfies BaselineEntriesPublicationReceiptState),
    ]);
    authorityRecord.logicalWriteSequence = ledgerAfter.logicalWriteSequence;
    authorityRecord.baselineEntriesPublicationReceipt = receipt;
    authorityRecord.baselineEntriesPublicationReceiptMintCount = 1;
    authorityRecord.writePhase = "baseline-entries-complete";
    return receipt;
  } catch (error) {
    if (execution !== undefined) {
      try {
        const progress = readSQLiteConnectionBaselineEntryPublicationExecutionSnapshotIntrinsic(
          authorityRecord.connection,
          execution,
        );
        authorityRecord.currentTransactionEpoch = progress.transactionEpoch;
        authorityRecord.currentTotalChanges = progress.totalChanges;
        authorityRecord.baselineEntriesPrepareCount = progress.prepareCount;
        authorityRecord.baselineEntriesExecuteCount = progress.executeCount;
        authorityRecord.baselineEntriesAffectedRows = progress.affectedRows;
        authorityRecord.fixedStatementCount = ledgerBefore.fixedStatementCount
          + progress.completedEntryCount;
        authorityRecord.affectedRowsWatermark = ledgerBefore.affectedRowsWatermark
          + progress.affectedRows;
      } catch {
        // Preserve the write failure while poisoning the exact authority below.
      }
    }
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication failed",
    );
    throw error;
  }
}

/** Reusable, non-consuming proof of the exact completed baseline-entry write. */
export function assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  terminalLease: SQLiteCursorPostDdlPublicationReaderLease,
  receipt: SQLiteBaselineEntriesPublicationReceipt,
): SQLiteBaselineEntriesPublicationReceipt {
  const receiptRecord = baselineEntriesReceiptState(receipt);
  if (receiptRecord.authority !== authority
      || receiptRecord.migration0002Receipt !== migration0002Receipt
      || receiptRecord.fence !== fence
      || receiptRecord.readerLease !== terminalLease) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite baseline-entries publication receipt graph is invalid",
    );
  }
  const authorityRecord = authorityState(authority);
  assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic(
    authority, migration0002Receipt, fence, terminalLease,
  );
  const snapshot = receiptRecord.snapshot;
  const reader = postDdlPublicationReaderLeaseState(terminalLease);
  const projection = reader.rederivedProjection;
  let retainedParameterSha256: SQLiteInitialWriteSha256;
  try {
    retainedParameterSha256 = digestRetainedBaselineEntryParametersIntrinsic(reader);
  } catch (error) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication receipt parameters drifted",
    );
    throw error;
  }
  let exactSourceSqlSha256: string;
  let exactInsertSqlSha256: string;
  try {
    exactSourceSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
    );
    exactInsertSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC,
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication receipt SQL identity observation failed",
    );
    throw translated;
  }
  const expectedResultSha256 = digestSQLiteInitialWriteResultVerifierIntrinsic({
    affectedRows: `${snapshot.entryCount}`,
  });
  if (authorityRecord.connection !== receiptRecord.connection
      || authorityRecord.baselineEntriesPublicationReceipt !== receipt
      || authorityRecord.baselineEntriesPublicationReceiptMintCount !== 1
      || authorityRecord.baselineEntriesLogicalExecutionCount !== 1
      || authorityRecord.baselineEntriesPrepareCount !== 1
      || authorityRecord.baselineEntriesExecuteCount !== snapshot.entryCount
      || authorityRecord.baselineEntriesAffectedRows !== snapshot.entryCount
      || authorityRecord.logicalWriteSequence < snapshot.outerLedgerAfter.logicalWriteSequence
      || authorityRecord.fixedStatementCount < snapshot.outerLedgerAfter.fixedStatementCount
      || authorityRecord.affectedRowsWatermark
        < snapshot.outerLedgerAfter.affectedRowsWatermark
      || authorityRecord.currentTransactionEpoch < snapshot.transactionEpochAfter
      || authorityRecord.currentTotalChanges < snapshot.totalChangesAfter
      || projection === undefined
      || snapshot.authority !== authority
      || snapshot.connection !== authorityRecord.connection
      || snapshot.migration0002Receipt !== migration0002Receipt
      || snapshot.postDdlCatalogFence !== fence
      || snapshot.projectionIdentity !== authorityRecord.projectionIdentity
      || snapshot.projectionReference !== authorityRecord.projectionReference
      || snapshot.readerLease !== terminalLease
      || snapshot.baselineId !== projection.baselineId
      || snapshot.entryCount !== projection.entryCount
      || snapshot.firstEntryHash !== projection.firstEntryHash
      || snapshot.finalEntryHash !== projection.finalEntryHash
      || snapshot.readerLeaseLifecycle !== "retired"
      || snapshot.readerCloseCount !== 1
      || snapshot.readerReDerivedProjectionSha256 !== projection.projectionSha256
      || reader.lifecycle !== "retired"
      || reader.closeAttemptCount !== 1
      || !reader.closeSucceeded
      || snapshot.sourceReadSql !== SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL
      || snapshot.sourceReadSqlSha256
        !== SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256
      || exactSourceSqlSha256 !== snapshot.sourceReadSqlSha256
      || snapshot.fixedInsertSql
        !== SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC
      || snapshot.fixedInsertSqlSha256
        !== SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC
      || exactInsertSqlSha256 !== snapshot.fixedInsertSqlSha256
      || snapshot.parameterSha256 !== retainedParameterSha256
      || snapshot.resultSha256 !== expectedResultSha256
      || snapshot.writeKind !== "baseline-entries-publication"
      || snapshot.mintCount !== 1
      || snapshot.prepareCount !== 1
      || snapshot.executeCount !== snapshot.entryCount
      || snapshot.affectedRows !== snapshot.entryCount
      || snapshot.totalChangesDelta !== snapshot.entryCount
      || snapshot.totalChangesBefore !== reader.totalChangesReadWatermark
      || snapshot.totalChangesAfter
        !== snapshot.totalChangesBefore + snapshot.entryCount
      || snapshot.transactionEpochBefore !== reader.transactionEpoch
      || snapshot.transactionEpochAfter < snapshot.transactionEpochBefore
      || snapshot.transactionLineage !== authorityRecord.transactionLineage
      || snapshot.transactionLineage !== reader.transactionLineage
      || snapshot.outerLedgerBefore.logicalWriteSequence
        !== reader.outerLedgerReadWatermark.logicalWriteSequence
      || snapshot.outerLedgerBefore.fixedStatementCount
        !== reader.outerLedgerReadWatermark.fixedStatementCount
      || snapshot.outerLedgerBefore.affectedRowsWatermark
        !== reader.outerLedgerReadWatermark.affectedRowsWatermark
      || snapshot.outerLedgerDelta.logicalWriteSequence !== 1
      || snapshot.outerLedgerDelta.fixedStatementCount !== snapshot.entryCount
      || snapshot.outerLedgerDelta.affectedRowsWatermark !== snapshot.entryCount
      || snapshot.outerLedgerAfter.logicalWriteSequence
        !== snapshot.outerLedgerBefore.logicalWriteSequence + 1
      || snapshot.outerLedgerAfter.fixedStatementCount
        !== snapshot.outerLedgerBefore.fixedStatementCount + snapshot.entryCount
      || snapshot.outerLedgerAfter.affectedRowsWatermark
        !== snapshot.outerLedgerBefore.affectedRowsWatermark + snapshot.entryCount) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-entries publication receipt graph drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-entries publication receipt graph drifted",
    );
  }
  return receipt;
}

export function readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(
  receipt: SQLiteBaselineEntriesPublicationReceipt,
): SQLiteBaselineEntriesPublicationReceiptSnapshot {
  const state = baselineEntriesReceiptState(receipt);
  assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic(
    state.authority,
    state.migration0002Receipt,
    state.fence,
    state.readerLease,
    receipt,
  );
  return state.snapshot;
}

function baselineHeaderReceiptState(
  receipt: SQLiteBaselineHeaderPublicationReceipt,
): BaselineHeaderPublicationReceiptState {
  const state = receipt !== null && typeof receipt === "object"
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic,
      BASELINE_HEADER_PUBLICATION_RECEIPTS,
      [receipt as object],
    ) as BaselineHeaderPublicationReceiptState | undefined
    : undefined;
  if (state === undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite baseline-header publication receipt is invalid",
    );
  }
  return state;
}

function assertBaselineEntriesHeaderPredecessorIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  authorityRecord: AuthorityState,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  terminalLease: SQLiteCursorPostDdlPublicationReaderLease,
  baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt,
): BaselineEntriesPublicationReceiptState {
  const entriesRecord = baselineEntriesReceiptState(baselineEntriesPublicationReceipt);
  const reader = postDdlPublicationReaderLeaseState(terminalLease);
  const snapshot = entriesRecord.snapshot;
  const projection = authorityRecord.projectionIdentity;
  let owner: ReturnType<typeof readSQLiteConnectionOwnerSnapshot>;
  let changes: ReturnType<typeof readSQLiteConnectionTotalChangesSnapshot>;
  try {
    owner = readSQLiteConnectionOwnerSnapshot(authorityRecord.connection);
    changes = readSQLiteConnectionTotalChangesSnapshot(authorityRecord.connection);
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    terminateAfterInvariantFailure(
      authorityRecord,
      authority,
      translated,
      "SQLite baseline-header predecessor owner observation failed",
    );
    throw translated;
  }
  if (!owner.isTransaction
      || owner.transactionMode !== "exclusive"
      || owner.transactionLineage !== authorityRecord.transactionLineage) {
    retireAuthorityGraph(authorityRecord, authority);
    return fail(
      "GE_CYCLE_STORE_STALE_FENCE",
      "SQLite baseline-header publication transaction lineage is stale",
    );
  }
  if (owner.transactionEpoch !== authorityRecord.currentTransactionEpoch
      || changes.transactionEpoch !== owner.transactionEpoch
      || changes.totalChanges !== authorityRecord.currentTotalChanges) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication owner ledger drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-header publication owner ledger drifted",
    );
  }
  let parameterSha256: SQLiteInitialWriteSha256;
  let resultSha256: SQLiteInitialWriteSha256;
  let insertSqlSha256: string;
  try {
    parameterSha256 = digestRetainedBaselineEntryParametersIntrinsic(reader);
    resultSha256 = digestSQLiteInitialWriteResultVerifierIntrinsic({
      affectedRows: `${projection.entryCount}`,
    });
    insertSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC,
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header predecessor observation failed",
    );
    throw translated;
  }
  if (entriesRecord.authority !== authority
      || entriesRecord.connection !== authorityRecord.connection
      || entriesRecord.migration0002Receipt !== migration0002Receipt
      || entriesRecord.fence !== fence
      || entriesRecord.readerLease !== terminalLease
      || authorityRecord.migration0002Receipt !== migration0002Receipt
      || authorityRecord.postDdlCatalogFence !== fence
      || authorityRecord.postDdlPublicationReaderLease !== terminalLease
      || authorityRecord.baselineEntriesPublicationReceipt
        !== baselineEntriesPublicationReceipt
      || authorityRecord.baselineEntriesPublicationReceiptMintCount !== 1
      || authorityRecord.baselineEntriesLogicalExecutionCount !== 1
      || authorityRecord.baselineEntriesPrepareCount !== 1
      || authorityRecord.baselineEntriesExecuteCount !== projection.entryCount
      || authorityRecord.baselineEntriesAffectedRows !== projection.entryCount
      || reader.lifecycle !== "retired"
      || reader.closeAttemptCount !== 1
      || !reader.closeSucceeded
      || reader.rederivedProjection === undefined
      || !sameProjectionIdentity(reader.rederivedProjection, projection)
      || snapshot.authority !== authority
      || snapshot.connection !== authorityRecord.connection
      || snapshot.migration0002Receipt !== migration0002Receipt
      || snapshot.postDdlCatalogFence !== fence
      || snapshot.readerLease !== terminalLease
      || snapshot.projectionIdentity !== projection
      || snapshot.projectionReference !== authorityRecord.projectionReference
      || snapshot.baselineId !== projection.baselineId
      || snapshot.entryCount !== projection.entryCount
      || snapshot.firstEntryHash !== projection.firstEntryHash
      || snapshot.finalEntryHash !== projection.finalEntryHash
      || snapshot.fixedInsertSql
        !== SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC
      || snapshot.fixedInsertSqlSha256
        !== SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC
      || insertSqlSha256 !== snapshot.fixedInsertSqlSha256
      || snapshot.parameterSha256 !== parameterSha256
      || snapshot.resultSha256 !== resultSha256
      || (authorityRecord.baselineHeaderPublicationReceipt === undefined
        ? snapshot.totalChangesAfter !== authorityRecord.currentTotalChanges
        : snapshot.totalChangesAfter > authorityRecord.currentTotalChanges)
      || (authorityRecord.baselineHeaderPublicationReceipt === undefined
        ? snapshot.transactionEpochAfter !== authorityRecord.currentTransactionEpoch
        : snapshot.transactionEpochAfter > authorityRecord.currentTransactionEpoch)
      || snapshot.transactionLineage !== authorityRecord.transactionLineage
      || (authorityRecord.baselineHeaderPublicationReceipt === undefined
        ? snapshot.outerLedgerAfter.logicalWriteSequence
          !== authorityRecord.logicalWriteSequence
        : snapshot.outerLedgerAfter.logicalWriteSequence
          > authorityRecord.logicalWriteSequence)
      || (authorityRecord.baselineHeaderPublicationReceipt === undefined
        ? snapshot.outerLedgerAfter.fixedStatementCount
          !== authorityRecord.fixedStatementCount
        : snapshot.outerLedgerAfter.fixedStatementCount
          > authorityRecord.fixedStatementCount)
      || (authorityRecord.baselineHeaderPublicationReceipt === undefined
        ? snapshot.outerLedgerAfter.affectedRowsWatermark
          !== authorityRecord.affectedRowsWatermark
        : snapshot.outerLedgerAfter.affectedRowsWatermark
          > authorityRecord.affectedRowsWatermark)) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication entries predecessor drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-header publication entries predecessor drifted",
    );
  }
  return entriesRecord;
}

/** Publish one header derived only from the authentic entries predecessor graph. */
export function executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  terminalLease: SQLiteCursorPostDdlPublicationReaderLease,
  baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt,
): SQLiteBaselineHeaderPublicationReceipt {
  const authorityRecord = authorityState(authority);
  const entriesRecord = baselineEntriesReceiptState(baselineEntriesPublicationReceipt);
  if (entriesRecord.authority !== authority
      || entriesRecord.migration0002Receipt !== migration0002Receipt
      || entriesRecord.fence !== fence
      || entriesRecord.readerLease !== terminalLease
      || entriesRecord.connection !== authorityRecord.connection
      || authorityRecord.migration0002Receipt !== migration0002Receipt
      || authorityRecord.postDdlCatalogFence !== fence
      || authorityRecord.postDdlPublicationReaderLease !== terminalLease
      || authorityRecord.baselineEntriesPublicationReceipt
        !== baselineEntriesPublicationReceipt) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite baseline-header publication graph is invalid",
    );
  }
  if (authorityRecord.baselineHeaderPublicationReceipt !== undefined
      || authorityRecord.baselineHeaderPublicationReceiptMintCount !== 0
      || authorityRecord.baselineHeaderLogicalExecutionCount !== 0
      || authorityRecord.baselineHeaderPrepareCount !== 0
      || authorityRecord.baselineHeaderExecuteCount !== 0
      || authorityRecord.baselineHeaderAffectedRows !== 0) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication was reused",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-header publication was reused",
    );
  }

  assertBaselineEntriesHeaderPredecessorIntrinsic(
    authority,
    authorityRecord,
    migration0002Receipt,
    fence,
    terminalLease,
    baselineEntriesPublicationReceipt,
  );
  const entriesSnapshot = entriesRecord.snapshot;
  const sourceEnvelope = authorityRecord.sourceEnvelope;
  const projection = authorityRecord.projectionIdentity;
  if (authorityRecord.writePhase !== "baseline-entries-complete"
      || entriesSnapshot.projectionIdentity !== projection
      || entriesSnapshot.projectionReference !== authorityRecord.projectionReference
      || sourceEnvelope.sourceSchemaIdentitySha256
        !== authorityRecord.sourceSchemaIdentitySha256
      || sourceEnvelope.sourceDescriptorHash !== authorityRecord.sourceDescriptorHash) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication predecessor drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-header publication predecessor drifted",
    );
  }

  let exactInsertSqlSha256: string;
  try {
    exactInsertSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC,
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication SQL preflight failed",
    );
    throw translated;
  }
  if (exactInsertSqlSha256
      !== SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication SQL identity drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-header publication SQL identity drifted",
    );
  }

  let policyBlob: Buffer;
  let row: SQLiteConnectionBaselineHeaderPublicationRow;
  let parameterExecutions: SQLiteInitialWriteTaggedScalar[][];
  let policyBlobSha256: string;
  let policyBlobBase64url: string;
  try {
    policyBlob = bufferFromIntrinsic(encodeOperationBaselinePolicyIntrinsic());
    policyBlobSha256 = sha256BytesIntrinsic(policyBlob);
    policyBlobBase64url = reflectApplyIntrinsic(
      bufferToStringIntrinsic,
      policyBlob,
      ["base64url"],
    ) as string;
    row = objectFreezeIntrinsic({
      baselineId: projection.baselineId,
      canonicalProjectionSha256: projection.projectionSha256,
      capturedAtMs: sourceEnvelope.capturedAtMs,
      creationRuntime: SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC,
      creationRuntimeVersion:
        SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC,
      entryCount: projection.entryCount,
      finalEntryHash: projection.finalEntryHash,
      firstEntryHash: projection.firstEntryHash,
      legacyOperationCount: projection.legacyOperationCount,
      policyBlob,
      sourceDescriptorHash: sourceEnvelope.sourceDescriptorHash,
      sourceMigrationLineageId: sourceEnvelope.sourceMigrationLineageId,
      sourceMigrationLineageSha256: sourceEnvelope.sourceMigrationLineageSha256,
      sourceSchemaIdentitySha256: sourceEnvelope.sourceSchemaIdentitySha256,
    } satisfies SQLiteConnectionBaselineHeaderPublicationRow);
    parameterExecutions = [];
    defineDenseArrayValue(
      parameterExecutions,
      0,
      baselineHeaderParameterFrame(row) as SQLiteInitialWriteTaggedScalar[],
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication parameter construction failed",
    );
    throw translated;
  }

  const totalChangesBefore = authorityRecord.currentTotalChanges;
  const transactionEpochBefore = authorityRecord.currentTransactionEpoch;
  const ledgerBefore = outerLedgerSnapshot(authorityRecord);
  let execution: ReturnType<
    typeof beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic
  > | undefined;
  try {
    authorityRecord.writePhase = "executing-baseline-header";
    authorityRecord.baselineHeaderLogicalExecutionCount = 1;
    execution = beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic(
      authorityRecord.connection,
    );
    authorityRecord.baselineHeaderPrepareCount = 1;
    const step = executeSQLiteConnectionBaselineHeaderPublicationIntrinsic(
      authorityRecord.connection,
      execution,
      row,
    );
    authorityRecord.currentTransactionEpoch = step.transactionEpoch;
    authorityRecord.currentTotalChanges = step.totalChanges;
    authorityRecord.baselineHeaderExecuteCount = step.executeCount;
    authorityRecord.baselineHeaderAffectedRows = step.affectedRowsDelta;
    authorityRecord.fixedStatementCount = ledgerBefore.fixedStatementCount
      + step.executeCount;
    authorityRecord.affectedRowsWatermark = ledgerBefore.affectedRowsWatermark
      + step.affectedRowsDelta;
    if (step.prepareCount !== 1
        || step.executeCount !== 1
        || step.completedExecutionCount !== 1
        || step.affectedRowsDelta !== 1
        || step.transactionLineage !== authorityRecord.transactionLineage) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite baseline-header publication execution drifted",
      );
    }

    const progress = readSQLiteConnectionBaselineHeaderPublicationExecutionSnapshotIntrinsic(
      authorityRecord.connection,
      execution,
    );
    if (progress.lifecycle !== "completed"
        || progress.prepareCount !== 1
        || progress.executeCount !== 1
        || progress.completedExecutionCount !== 1
        || progress.affectedRows !== 1
        || progress.totalChangesDelta !== 1
        || progress.totalChanges !== totalChangesBefore + 1
        || progress.transactionEpoch !== transactionEpochBefore + 1n
        || progress.transactionLineage !== authorityRecord.transactionLineage
        || authorityRecord.currentTransactionEpoch !== progress.transactionEpoch
        || authorityRecord.currentTotalChanges !== progress.totalChanges
        || authorityRecord.fixedStatementCount !== ledgerBefore.fixedStatementCount + 1
        || authorityRecord.affectedRowsWatermark
          !== ledgerBefore.affectedRowsWatermark + 1) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite baseline-header publication completion ledger drifted",
      );
    }

    const parameterSha256 = digestSQLiteInitialWriteParametersIntrinsic(
      objectFreezeIntrinsic(parameterExecutions) as SQLiteInitialWriteParameterExecutions,
    );
    const verifiedParameterSha256 = digestBaselineHeaderParametersIntrinsic(row);
    const resultSha256 = digestSQLiteInitialWriteResultIntrinsic({ affectedRows: "1" });
    const verifiedResultSha256 = digestSQLiteInitialWriteResultVerifierIntrinsic({
      affectedRows: "1",
    });
    if (parameterSha256 !== verifiedParameterSha256
        || resultSha256 !== verifiedResultSha256) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite baseline-header publication receipt digest drifted",
      );
    }

    const ledgerAfter = objectFreezeIntrinsic({
      affectedRowsWatermark: ledgerBefore.affectedRowsWatermark + 1,
      fixedStatementCount: ledgerBefore.fixedStatementCount + 1,
      logicalWriteSequence: ledgerBefore.logicalWriteSequence + 1,
    });
    const snapshot = objectFreezeIntrinsic({
      affectedRows: 1 as const,
      authority,
      baselineEntriesPublicationReceipt,
      baselineId: projection.baselineId,
      canonicalProjectionSha256: projection.projectionSha256,
      capturedAtMs: sourceEnvelope.capturedAtMs,
      connection: authorityRecord.connection,
      creationRuntime: SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC,
      creationRuntimeVersion:
        SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC,
      entryCount: projection.entryCount,
      executeCount: 1 as const,
      finalEntryHash: projection.finalEntryHash,
      firstEntryHash: projection.firstEntryHash,
      fixedInsertSql: SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC,
      fixedInsertSqlSha256:
        SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
      legacyOperationCount: projection.legacyOperationCount,
      mintCount: 1 as const,
      outerLedgerAfter: ledgerAfter,
      outerLedgerBefore: ledgerBefore,
      outerLedgerDelta: objectFreezeIntrinsic({
        affectedRowsWatermark: 1,
        fixedStatementCount: 1,
        logicalWriteSequence: 1,
      }),
      parameterOrder: SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC,
      parameterSha256,
      policyBlobBase64url,
      policyBlobSha256,
      policyBlobUtf8Bytes: policyBlob.length,
      postDdlCatalogFence: fence,
      prepareCount: 1 as const,
      projectionIdentity: projection,
      projectionReference: authorityRecord.projectionReference,
      readerLease: terminalLease,
      resultSha256,
      sourceDescriptorHash: sourceEnvelope.sourceDescriptorHash,
      sourceMigrationLineageId: sourceEnvelope.sourceMigrationLineageId,
      sourceMigrationLineageSha256: sourceEnvelope.sourceMigrationLineageSha256,
      sourceSchemaIdentitySha256: sourceEnvelope.sourceSchemaIdentitySha256,
      totalChangesAfter: progress.totalChanges,
      totalChangesBefore,
      totalChangesDelta: 1 as const,
      transactionEpochAfter: progress.transactionEpoch,
      transactionEpochBefore,
      transactionLineage: authorityRecord.transactionLineage,
      writeKind: "baseline-header-publication" as const,
    } satisfies SQLiteBaselineHeaderPublicationReceiptSnapshot);
    const receipt = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteBaselineHeaderPublicationReceipt;
    reflectApplyIntrinsic(weakMapSetIntrinsic, BASELINE_HEADER_PUBLICATION_RECEIPTS, [
      receipt as object,
      objectFreezeIntrinsic({
        authority,
        baselineEntriesPublicationReceipt,
        connection: authorityRecord.connection,
        fence,
        migration0002Receipt,
        readerLease: terminalLease,
        snapshot,
      } satisfies BaselineHeaderPublicationReceiptState),
    ]);
    authorityRecord.logicalWriteSequence = ledgerAfter.logicalWriteSequence;
    authorityRecord.baselineHeaderPublicationReceipt = receipt;
    authorityRecord.baselineHeaderPublicationReceiptMintCount = 1;
    authorityRecord.writePhase = "baseline-header-complete";
    return receipt;
  } catch (error) {
    if (execution !== undefined) {
      try {
        const progress =
          readSQLiteConnectionBaselineHeaderPublicationExecutionSnapshotIntrinsic(
            authorityRecord.connection,
            execution,
          );
        authorityRecord.currentTransactionEpoch = progress.transactionEpoch;
        authorityRecord.currentTotalChanges = progress.totalChanges;
        authorityRecord.baselineHeaderPrepareCount = progress.prepareCount;
        authorityRecord.baselineHeaderExecuteCount = progress.executeCount;
        authorityRecord.baselineHeaderAffectedRows = progress.affectedRows === 1 ? 1 : 0;
        authorityRecord.fixedStatementCount = ledgerBefore.fixedStatementCount
          + progress.executeCount;
        authorityRecord.affectedRowsWatermark = ledgerBefore.affectedRowsWatermark
          + progress.affectedRows;
      } catch {
        // Preserve the primary failure after poisoning the exact authority below.
      }
    }
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication failed",
    );
    throw translateSQLiteError(error, OPERATION);
  }
}

/** Reusable, non-consuming proof of the exact completed baseline-header write. */
export function assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  terminalLease: SQLiteCursorPostDdlPublicationReaderLease,
  baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt,
  receipt: SQLiteBaselineHeaderPublicationReceipt,
): SQLiteBaselineHeaderPublicationReceipt {
  const receiptRecord = baselineHeaderReceiptState(receipt);
  if (receiptRecord.authority !== authority
      || receiptRecord.migration0002Receipt !== migration0002Receipt
      || receiptRecord.fence !== fence
      || receiptRecord.readerLease !== terminalLease
      || receiptRecord.baselineEntriesPublicationReceipt
        !== baselineEntriesPublicationReceipt) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite baseline-header publication receipt graph is invalid",
    );
  }
  const authorityRecord = authorityState(authority);
  const entriesRecord = assertBaselineEntriesHeaderPredecessorIntrinsic(
    authority,
    authorityRecord,
    migration0002Receipt,
    fence,
    terminalLease,
    baselineEntriesPublicationReceipt,
  );
  const entriesSnapshot = entriesRecord.snapshot;
  const sourceEnvelope = authorityRecord.sourceEnvelope;
  const projection = authorityRecord.projectionIdentity;
  let policyBlob: Buffer;
  let policyBlobSha256: string;
  let policyBlobBase64url: string;
  let parameterSha256: SQLiteInitialWriteSha256;
  let resultSha256: SQLiteInitialWriteSha256;
  let exactInsertSqlSha256: string;
  try {
    policyBlob = bufferFromIntrinsic(encodeOperationBaselinePolicyIntrinsic());
    const row = objectFreezeIntrinsic({
      baselineId: projection.baselineId,
      canonicalProjectionSha256: projection.projectionSha256,
      capturedAtMs: sourceEnvelope.capturedAtMs,
      creationRuntime: SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC,
      creationRuntimeVersion:
        SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC,
      entryCount: projection.entryCount,
      finalEntryHash: projection.finalEntryHash,
      firstEntryHash: projection.firstEntryHash,
      legacyOperationCount: projection.legacyOperationCount,
      policyBlob,
      sourceDescriptorHash: sourceEnvelope.sourceDescriptorHash,
      sourceMigrationLineageId: sourceEnvelope.sourceMigrationLineageId,
      sourceMigrationLineageSha256: sourceEnvelope.sourceMigrationLineageSha256,
      sourceSchemaIdentitySha256: sourceEnvelope.sourceSchemaIdentitySha256,
    } satisfies SQLiteConnectionBaselineHeaderPublicationRow);
    policyBlobSha256 = sha256BytesIntrinsic(policyBlob);
    policyBlobBase64url = reflectApplyIntrinsic(
      bufferToStringIntrinsic,
      policyBlob,
      ["base64url"],
    ) as string;
    parameterSha256 = digestBaselineHeaderParametersIntrinsic(row);
    resultSha256 = digestSQLiteInitialWriteResultVerifierIntrinsic({ affectedRows: "1" });
    exactInsertSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC,
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication receipt observation failed",
    );
    throw translated;
  }
  const snapshot = receiptRecord.snapshot;
  if (authorityRecord.connection !== receiptRecord.connection
      || authorityRecord.baselineHeaderPublicationReceipt !== receipt
      || authorityRecord.baselineHeaderPublicationReceiptMintCount !== 1
      || authorityRecord.baselineHeaderLogicalExecutionCount !== 1
      || authorityRecord.baselineHeaderPrepareCount !== 1
      || authorityRecord.baselineHeaderExecuteCount !== 1
      || authorityRecord.baselineHeaderAffectedRows !== 1
      || authorityRecord.logicalWriteSequence < snapshot.outerLedgerAfter.logicalWriteSequence
      || authorityRecord.fixedStatementCount < snapshot.outerLedgerAfter.fixedStatementCount
      || authorityRecord.affectedRowsWatermark
        < snapshot.outerLedgerAfter.affectedRowsWatermark
      || authorityRecord.currentTransactionEpoch < snapshot.transactionEpochAfter
      || authorityRecord.currentTotalChanges < snapshot.totalChangesAfter
      || snapshot.authority !== authority
      || snapshot.connection !== authorityRecord.connection
      || snapshot.baselineEntriesPublicationReceipt
        !== baselineEntriesPublicationReceipt
      || snapshot.postDdlCatalogFence !== fence
      || snapshot.readerLease !== terminalLease
      || snapshot.projectionIdentity !== projection
      || snapshot.projectionReference !== authorityRecord.projectionReference
      || snapshot.baselineId !== projection.baselineId
      || snapshot.canonicalProjectionSha256 !== projection.projectionSha256
      || snapshot.entryCount !== projection.entryCount
      || snapshot.legacyOperationCount !== projection.legacyOperationCount
      || snapshot.firstEntryHash !== projection.firstEntryHash
      || snapshot.finalEntryHash !== projection.finalEntryHash
      || snapshot.sourceSchemaIdentitySha256
        !== sourceEnvelope.sourceSchemaIdentitySha256
      || snapshot.sourceMigrationLineageId !== sourceEnvelope.sourceMigrationLineageId
      || snapshot.sourceMigrationLineageSha256
        !== sourceEnvelope.sourceMigrationLineageSha256
      || snapshot.sourceDescriptorHash !== sourceEnvelope.sourceDescriptorHash
      || snapshot.capturedAtMs !== sourceEnvelope.capturedAtMs
      || snapshot.creationRuntime
        !== SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC
      || snapshot.creationRuntimeVersion
        !== SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC
      || snapshot.policyBlobUtf8Bytes !== policyBlob.length
      || snapshot.policyBlobSha256 !== policyBlobSha256
      || snapshot.policyBlobBase64url !== policyBlobBase64url
      || snapshot.fixedInsertSql
        !== SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC
      || snapshot.fixedInsertSqlSha256
        !== SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC
      || exactInsertSqlSha256 !== snapshot.fixedInsertSqlSha256
      || snapshot.parameterOrder
        !== SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC
      || snapshot.parameterSha256 !== parameterSha256
      || snapshot.resultSha256 !== resultSha256
      || snapshot.writeKind !== "baseline-header-publication"
      || snapshot.mintCount !== 1
      || snapshot.prepareCount !== 1
      || snapshot.executeCount !== 1
      || snapshot.affectedRows !== 1
      || snapshot.totalChangesDelta !== 1
      || snapshot.totalChangesBefore !== entriesSnapshot.totalChangesAfter
      || snapshot.totalChangesAfter !== snapshot.totalChangesBefore + 1
      || snapshot.transactionEpochBefore !== entriesSnapshot.transactionEpochAfter
      || snapshot.transactionEpochAfter !== snapshot.transactionEpochBefore + 1n
      || snapshot.transactionLineage !== authorityRecord.transactionLineage
      || snapshot.outerLedgerBefore.logicalWriteSequence
        !== entriesSnapshot.outerLedgerAfter.logicalWriteSequence
      || snapshot.outerLedgerBefore.fixedStatementCount
        !== entriesSnapshot.outerLedgerAfter.fixedStatementCount
      || snapshot.outerLedgerBefore.affectedRowsWatermark
        !== entriesSnapshot.outerLedgerAfter.affectedRowsWatermark
      || snapshot.outerLedgerDelta.logicalWriteSequence !== 1
      || snapshot.outerLedgerDelta.fixedStatementCount !== 1
      || snapshot.outerLedgerDelta.affectedRowsWatermark !== 1
      || snapshot.outerLedgerAfter.logicalWriteSequence
        !== snapshot.outerLedgerBefore.logicalWriteSequence + 1
      || snapshot.outerLedgerAfter.fixedStatementCount
        !== snapshot.outerLedgerBefore.fixedStatementCount + 1
      || snapshot.outerLedgerAfter.affectedRowsWatermark
        !== snapshot.outerLedgerBefore.affectedRowsWatermark + 1) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite baseline-header publication receipt graph drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite baseline-header publication receipt graph drifted",
    );
  }
  return receipt;
}

export function readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(
  receipt: SQLiteBaselineHeaderPublicationReceipt,
): SQLiteBaselineHeaderPublicationReceiptSnapshot {
  const state = baselineHeaderReceiptState(receipt);
  assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
    state.authority,
    state.migration0002Receipt,
    state.fence,
    state.readerLease,
    state.baselineEntriesPublicationReceipt,
    receipt,
  );
  return state.snapshot;
}

/** Package-private identity snapshot for downstream receipt construction and tests. */
export function readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
): SQLiteCursorOuterPublicationAuthoritySnapshot {
  const state = authorityState(authority);
  return objectFreezeIntrinsic({
    activationCount: state.activationCount,
    baselineEntriesAffectedRows: state.baselineEntriesAffectedRows,
    baselineEntriesExecuteCount: state.baselineEntriesExecuteCount,
    baselineEntriesLogicalExecutionCount: state.baselineEntriesLogicalExecutionCount,
    baselineEntriesPrepareCount: state.baselineEntriesPrepareCount,
    baselineEntriesPublicationReceipt: state.baselineEntriesPublicationReceipt,
    baselineEntriesPublicationReceiptMintCount:
      state.baselineEntriesPublicationReceiptMintCount,
    baselineHeaderAffectedRows: state.baselineHeaderAffectedRows,
    baselineHeaderExecuteCount: state.baselineHeaderExecuteCount,
    baselineHeaderLogicalExecutionCount: state.baselineHeaderLogicalExecutionCount,
    baselineHeaderPrepareCount: state.baselineHeaderPrepareCount,
    baselineHeaderPublicationReceipt: state.baselineHeaderPublicationReceipt,
    baselineHeaderPublicationReceiptMintCount:
      state.baselineHeaderPublicationReceiptMintCount,
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
