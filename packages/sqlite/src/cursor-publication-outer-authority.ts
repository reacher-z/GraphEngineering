import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic,
  assertSQLiteCursorOuterClockAuthorityGraphIntrinsic,
  assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic,
  assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic,
  consumeSQLiteCursorProviderClockEvidenceIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
  readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic,
  type SQLiteCursorMigrationLockIdentity,
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
  assertSQLiteCursorStageOwnershipPublicationSessionActiveIntrinsic,
  assertSQLiteCursorStageOwnershipPublicationSessionPreparedIntrinsic,
  assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic,
  assertSQLiteCursorStageOwnershipPostDdlReaderTerminalIntrinsic,
  assertSQLiteCursorStageOwnershipPreRebindCompleteIntrinsic,
  assertSQLiteCursorStageOwnershipInitialPublicationAdoptedIntrinsic,
  completeSQLiteCursorStageOwnershipPostDdlReaderIntrinsic,
  mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic,
  poisonSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  prepareSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic,
  prepareSQLiteCursorStageOwnershipPublicationSessionIntrinsic,
  prepareSQLiteCursorStageOwnershipPublicationSessionTransitionIntrinsic,
  publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  publishSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic,
  registerSQLiteCursorStageOwnershipPostDdlReaderIntrinsic,
  retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  type SQLiteBaselineCursorB2FenceRetirement,
  type SQLiteCursorInitialPublicationStageWatermark,
  type SQLiteCursorStageOwnershipOuterPublicationTail,
  type SQLiteCursorStageOwnershipPublicationSessionTail,
  type SQLiteCursorStageOwnershipPublicationSessionTransition,
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
  SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
  SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC,
  SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC,
  beginSQLiteConnectionBaselineEntryPublicationExecutionIntrinsic,
  beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic,
  beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic,
  beginSQLiteConnectionMigration0002ExecutionIntrinsic,
  executeNextSQLiteConnectionBaselineEntryPublicationRowIntrinsic,
  executeSQLiteConnectionBaselineHeaderPublicationIntrinsic,
  executeSQLiteConnectionOperationSequenceZeroIntrinsic,
  executeNextSQLiteConnectionMigration0002StatementIntrinsic,
  getSQLiteStatementNativeIntrinsic,
  iterateSQLiteStatementNativeIntrinsic,
  nextSQLiteStatementIteratorNativeIntrinsic,
  prepareSQLiteConnectionCursorPublicationReadIntrinsic,
  readSQLiteConnectionBaselineEntryPublicationExecutionSnapshotIntrinsic,
  readSQLiteConnectionBaselineHeaderPublicationExecutionSnapshotIntrinsic,
  readSQLiteConnectionOperationSequenceZeroExecutionSnapshotIntrinsic,
  readSQLiteConnectionMigration0002ExecutionSnapshotIntrinsic,
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic,
  releaseSQLiteConnectionCursorRebindExecutionIntrinsic,
  returnSQLiteStatementIteratorNativeIntrinsic,
  type SQLiteConnectionCursorRebindExecution,
  type SQLiteConnectionCursorRebindExecutionSnapshot,
  type SQLiteConnectionTransactionLineage,
  type SQLiteConnectionBaselineEntryPublicationRow,
  type SQLiteConnectionBaselineHeaderPublicationRow,
  type SQLiteConnectionOperationSequenceZeroRow,
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
import {
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
} from "./cursor-publication-rebind-contract.js";
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
const objectGetOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const objectIsFrozenIntrinsic = Object.isFrozen;
const reflectOwnKeysIntrinsic = Reflect.ownKeys;
const arrayIsArrayIntrinsic = Array.isArray;
const isProxyIntrinsic = isProxy;
const readSQLiteConnectionCursorRebindExecutionSnapshotVerifierIntrinsic =
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic;
const releaseSQLiteConnectionCursorRebindExecutionVerifierIntrinsic =
  releaseSQLiteConnectionCursorRebindExecutionIntrinsic;
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

/** Opaque owner of the exact three prepared publication continuations. */
export interface SQLiteCursorPublicationSessionPreparedOwner {
  readonly __sqliteCursorPublicationSessionPreparedOwner: never;
}

/** Opaque identity activated by the final publication-session tail. */
export interface SQLiteCursorPublicationSession {
  readonly __sqliteCursorPublicationSession: never;
}

/** Outer-owned bridge binding one exact active session, P and prepared E. */
export interface SQLiteCursorPublicationRebindContext {
  readonly __sqliteCursorPublicationRebindContext: never;
}

/** P: outer-minted exact prepared owner for one context and E. */
export interface SQLiteCursorPublicationRebindPreparedOwner {
  readonly __sqliteCursorPublicationRebindPreparedOwner: never;
}

/** T: one-shot proof that the exact active session was consumed for rebind. */
export interface SQLiteCursorPublicationSessionConsumedTombstone {
  readonly __sqliteCursorPublicationSessionConsumedTombstone: never;
}

/** A: immutable adoption of the exact completed rebind watermarks. */
export interface SQLiteCursorPostRebindWatermarkAdoption {
  readonly __sqliteCursorPostRebindWatermarkAdoption: never;
}

export interface SQLiteCursorPublicationSessionCancellationSignal {
  readonly __sqliteCursorPublicationSessionCancellationSignal: never;
}

export interface SQLiteCursorPublicationSessionCancellationController {
  readonly signal: SQLiteCursorPublicationSessionCancellationSignal;
  cancel(): void;
}

export interface SQLiteCursorPublicationSessionSnapshot {
  readonly lifecycle: "publication-active";
  readonly outerAuthority: SQLiteCursorOuterPublicationAuthority;
  readonly initialStageAdoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly stage: SQLiteBaselineTempStage;
  readonly connection: SQLiteConnection;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transfer: SQLiteCursorStageOwnershipTransfer;
  readonly migrationLockCapability: SQLiteCursorMigrationLockCapability;
  readonly migrationLockIdentity: Readonly<SQLiteCursorMigrationLockIdentity>;
  readonly providerClockCapability: SQLiteCursorProviderClockCapability;
  readonly outerClockEvidence: SQLiteCursorProviderClockEvidence;
  readonly outerProviderNowMs: number;
  readonly preRebindClockEvidence: SQLiteCursorProviderClockEvidence;
  readonly preRebindProviderNowMs: number;
  readonly preRebindClockConsumedTombstone:
    SQLiteCursorProviderClockConsumedTombstone;
  readonly postDdlCatalogFence: SQLiteCursorPostDdlCatalogFence;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly targetDescriptorHash: typeof SQLITE_CURSOR_PUBLICATION_TARGET.descriptorHash;
  readonly targetSchemaIdentitySha256:
    typeof SQLITE_CURSOR_PUBLICATION_TARGET.schemaIdentitySha256;
}

export interface SQLiteCursorPublicationRebindContextSnapshot {
  readonly lifecycle: "prepared" | "released-before-write" | "session-consumed"
    | "write-adopted" | "poisoned" | "retired";
  readonly session: SQLiteCursorPublicationSession;
  readonly preparedOwner: SQLiteCursorPublicationRebindPreparedOwner;
  readonly execution: SQLiteConnectionCursorRebindExecution;
  readonly preparedExecutionSnapshot: SQLiteConnectionCursorRebindExecutionSnapshot;
  readonly outerAuthority: SQLiteCursorOuterPublicationAuthority;
  readonly connection: SQLiteConnection;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly historicalTransactionEpoch: bigint;
  readonly historicalTotalChanges: number;
  readonly historicalOuterLedger: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly preRebindReceiptSha256: string;
  readonly b2CursorCount: number;
  readonly b2ImmutableRootSha256: string;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly targetDescriptorHash: typeof SQLITE_CURSOR_PUBLICATION_TARGET.descriptorHash;
  readonly targetSchemaIdentitySha256:
    typeof SQLITE_CURSOR_PUBLICATION_TARGET.schemaIdentitySha256;
  readonly parameterValues: NonNullable<
    SQLiteConnectionCursorRebindExecutionSnapshot["parameterValues"]
  >;
}

export interface SQLiteCursorPublicationSessionConsumedTombstoneSnapshot {
  readonly lifecycle: "active" | "adopted" | "poisoned" | "retired";
  readonly context: SQLiteCursorPublicationRebindContext;
  readonly session: SQLiteCursorPublicationSession;
  readonly preparedOwner: SQLiteCursorPublicationRebindPreparedOwner;
  readonly execution: SQLiteConnectionCursorRebindExecution;
  readonly preparedExecutionSnapshot: SQLiteConnectionCursorRebindExecutionSnapshot;
  readonly historicalTransactionEpoch: bigint;
  readonly historicalTotalChanges: number;
}

export interface SQLiteCursorPostRebindWatermarkAdoptionSnapshot {
  readonly lifecycle: "active" | "poisoned" | "retired";
  readonly context: SQLiteCursorPublicationRebindContext;
  readonly tombstone: SQLiteCursorPublicationSessionConsumedTombstone;
  readonly session: SQLiteCursorPublicationSession;
  readonly preparedOwner: SQLiteCursorPublicationRebindPreparedOwner;
  readonly execution: SQLiteConnectionCursorRebindExecution;
  readonly preparedExecutionSnapshot: SQLiteConnectionCursorRebindExecutionSnapshot;
  readonly executionSnapshot: SQLiteConnectionCursorRebindExecutionSnapshot;
  readonly outerAuthority: SQLiteCursorOuterPublicationAuthority;
  readonly connection: SQLiteConnection;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly historicalTransactionEpoch: bigint;
  readonly adoptedTransactionEpoch: bigint;
  readonly historicalTotalChanges: number;
  readonly adoptedTotalChanges: number;
  readonly totalChangesDelta: number;
  readonly affectedRows: number;
  readonly historicalOuterLedger: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly adoptedOuterLedger: SQLiteCursorOuterPublicationLedgerSnapshot;
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
  | "executing-sequence-zero"
  | "sequence-zero-complete"
  | "initial-stage-adoption-complete"
  | "publication-active"
  | "publication-session-consumed"
  | "cursor-rebind-adopted"
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

export interface SQLiteOperationSequenceZeroPublicationReceipt {
  readonly __sqliteOperationSequenceZeroPublicationReceipt: never;
}

export interface SQLiteOperationSequenceZeroPublicationReceiptSnapshot {
  readonly affectedRows: 1;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly baselineCapturedAtMs: number;
  readonly baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly baselineHeaderPublicationReceipt: SQLiteBaselineHeaderPublicationReceipt;
  readonly baselineId: string;
  readonly connection: SQLiteConnection;
  readonly executeCount: 1;
  readonly fixedInsertSql:
    typeof SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC;
  readonly fixedInsertSqlSha256:
    typeof SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC;
  readonly lastCommitSequence: 0;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly mintCount: 1;
  readonly outerClockEvidence: SQLiteCursorProviderClockEvidence;
  readonly outerLedgerAfter: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerBefore: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerDelta: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerProviderNowMs: number;
  readonly parameterOrder:
    typeof SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC;
  readonly parameterSha256: SQLiteInitialWriteSha256;
  readonly postDdlCatalogFence: SQLiteCursorPostDdlCatalogFence;
  readonly prepareCount: 1;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly resultSha256: SQLiteInitialWriteSha256;
  readonly totalChangesAfter: number;
  readonly totalChangesBefore: number;
  readonly totalChangesDelta: 1;
  readonly transactionEpochAfter: bigint;
  readonly transactionEpochBefore: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly updatedAtMs: number;
  readonly writeKind: "operation-sequence-zero-publication";
}

/** Ordered, exact-identity presentation consumed by the one atomic adoption. */
export type SQLiteCursorInitialPublicationReceiptBundle = readonly [
  SQLiteMigration0002CatalogRebuildReceipt,
  SQLiteBaselineEntriesPublicationReceipt,
  SQLiteBaselineHeaderPublicationReceipt,
  SQLiteOperationSequenceZeroPublicationReceipt,
];

export interface SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone {
  readonly __sqliteMigration0002CatalogRebuildReceiptConsumedTombstone: never;
}

export interface SQLiteBaselineEntriesPublicationReceiptConsumedTombstone {
  readonly __sqliteBaselineEntriesPublicationReceiptConsumedTombstone: never;
}

export interface SQLiteBaselineHeaderPublicationReceiptConsumedTombstone {
  readonly __sqliteBaselineHeaderPublicationReceiptConsumedTombstone: never;
}

export interface SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone {
  readonly __sqliteOperationSequenceZeroPublicationReceiptConsumedTombstone: never;
}

/** Opaque proof that all four initial-write receipts were adopted together. */
export interface SQLiteCursorInitialStageAdoptionReceipt {
  readonly __sqliteCursorInitialStageAdoptionReceipt: never;
}

export interface SQLiteCursorInitialStageAdoptionReceiptSnapshot {
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly connection: SQLiteConnection;
  readonly stage: SQLiteBaselineTempStage;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  readonly transfer: SQLiteCursorStageOwnershipTransfer;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly baselineHeaderPublicationReceipt: SQLiteBaselineHeaderPublicationReceipt;
  readonly operationSequenceZeroPublicationReceipt:
    SQLiteOperationSequenceZeroPublicationReceipt;
  readonly migration0002ConsumedTombstone:
    SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone;
  readonly baselineEntriesConsumedTombstone:
    SQLiteBaselineEntriesPublicationReceiptConsumedTombstone;
  readonly baselineHeaderConsumedTombstone:
    SQLiteBaselineHeaderPublicationReceiptConsumedTombstone;
  readonly operationSequenceZeroConsumedTombstone:
    SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone;
  readonly postDdlCatalogFence: SQLiteCursorPostDdlCatalogFence;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly readerLeaseLifecycle: "retired";
  readonly readerCloseCount: 1;
  readonly readerReDerivedProjectionSha256: string;
  readonly adoptedTransactionEpoch: bigint;
  readonly adoptedTotalChanges: number;
  readonly adoptedOuterLedger: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly targetCatalogSha256:
    typeof SQLITE_CURSOR_PUBLICATION_TARGET.catalogSha256;
  readonly retiredB2Fence: SQLiteBaselineCursorB2FenceRetirement;
  readonly mintCount: 1;
  readonly writeKind: "initial-publication-stage-adoption";
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
  /**
   * Exact reason forwarded to the stage-ownership poison bridge, or `undefined`
   * while the authority was never poisoned. Retirement never sets a reason.
   */
  readonly stageOwnershipPoisonReason: string | undefined;
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
  readonly operationSequenceZeroPublicationReceipt:
    SQLiteOperationSequenceZeroPublicationReceipt | undefined;
  readonly operationSequenceZeroPublicationReceiptMintCount: 0 | 1;
  readonly operationSequenceZeroLogicalExecutionCount: 0 | 1;
  readonly operationSequenceZeroPrepareCount: 0 | 1;
  readonly operationSequenceZeroExecuteCount: 0 | 1;
  readonly operationSequenceZeroAffectedRows: 0 | 1;
  readonly initialStageAdoptionReceipt:
    SQLiteCursorInitialStageAdoptionReceipt | undefined;
  readonly initialStageAdoptionReceiptMintCount: 0 | 1;
  readonly publicationPreparedOwner: SQLiteCursorPublicationSessionPreparedOwner | undefined;
  readonly publicationSession: SQLiteCursorPublicationSession | undefined;
  readonly publicationRebindContext: SQLiteCursorPublicationRebindContext | undefined;
  readonly publicationSessionConsumedTombstone:
    SQLiteCursorPublicationSessionConsumedTombstone | undefined;
  readonly postRebindWatermarkAdoption:
    SQLiteCursorPostRebindWatermarkAdoption | undefined;
  readonly receiptConsumptionCount: 0 | 4;
  readonly tombstoneMintCount: 0 | 4;
  readonly migration0002ConsumedTombstone:
    SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone | undefined;
  readonly baselineEntriesConsumedTombstone:
    SQLiteBaselineEntriesPublicationReceiptConsumedTombstone | undefined;
  readonly baselineHeaderConsumedTombstone:
    SQLiteBaselineHeaderPublicationReceiptConsumedTombstone | undefined;
  readonly operationSequenceZeroConsumedTombstone:
    SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone | undefined;
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
  readonly outerProviderNowMs: number;
  readonly sourceSchemaIdentitySha256: string;
  lifecycle: SQLiteCursorOuterPublicationAuthorityLifecycle;
  stageOwnershipPoisonReason: string | undefined;
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
  operationSequenceZeroPublicationReceipt:
    SQLiteOperationSequenceZeroPublicationReceipt | undefined;
  operationSequenceZeroPublicationReceiptMintCount: 0 | 1;
  operationSequenceZeroLogicalExecutionCount: 0 | 1;
  operationSequenceZeroPrepareCount: 0 | 1;
  operationSequenceZeroExecuteCount: 0 | 1;
  operationSequenceZeroAffectedRows: 0 | 1;
  initialStageAdoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt | undefined;
  initialStageAdoptionReceiptMintCount: 0 | 1;
  publicationPreparedOwner: SQLiteCursorPublicationSessionPreparedOwner | undefined;
  publicationSession: SQLiteCursorPublicationSession | undefined;
  publicationRebindContext: SQLiteCursorPublicationRebindContext | undefined;
  publicationSessionConsumedTombstone:
    SQLiteCursorPublicationSessionConsumedTombstone | undefined;
  postRebindWatermarkAdoption: SQLiteCursorPostRebindWatermarkAdoption | undefined;
  receiptConsumptionCount: 0 | 4;
  tombstoneMintCount: 0 | 4;
  migration0002ConsumedTombstone:
    SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone | undefined;
  baselineEntriesConsumedTombstone:
    SQLiteBaselineEntriesPublicationReceiptConsumedTombstone | undefined;
  baselineHeaderConsumedTombstone:
    SQLiteBaselineHeaderPublicationReceiptConsumedTombstone | undefined;
  operationSequenceZeroConsumedTombstone:
    SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone | undefined;
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

interface OperationSequenceZeroPublicationReceiptState {
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly baselineHeaderPublicationReceipt: SQLiteBaselineHeaderPublicationReceipt;
  readonly connection: SQLiteConnection;
  readonly fence: SQLiteCursorPostDdlCatalogFence;
  readonly migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly snapshot: SQLiteOperationSequenceZeroPublicationReceiptSnapshot;
}

type InitialStageAdoptionReceiptLifecycle = "pending" | "active";

interface InitialStageAdoptionReceiptState {
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly bundle: SQLiteCursorInitialPublicationReceiptBundle;
  readonly connection: SQLiteConnection;
  lifecycle: InitialStageAdoptionReceiptLifecycle;
  readonly fence: SQLiteCursorPostDdlCatalogFence;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly snapshot: SQLiteCursorInitialStageAdoptionReceiptSnapshot;
  readonly stageWatermark: SQLiteCursorInitialPublicationStageWatermark;
}

type PublicationPreparedLifecycle = "prepared" | "published" | "poisoned";

interface PublicationPreparedState {
  readonly adoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  lowerTail: SQLiteCursorStageOwnershipPublicationSessionTail | undefined;
  lifecycle: PublicationPreparedLifecycle;
  observedEvidence: SQLiteCursorProviderClockEvidence | undefined;
}

interface PublicationSessionState {
  readonly adoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly preparedOwner: SQLiteCursorPublicationSessionPreparedOwner;
  readonly snapshotBase: Omit<
    SQLiteCursorPublicationSessionSnapshot,
    "lifecycle" | "preRebindClockConsumedTombstone"
  >;
  consumedTombstone: SQLiteCursorProviderClockConsumedTombstone | undefined;
  rebindConsumedTombstone: SQLiteCursorPublicationSessionConsumedTombstone | undefined;
  lifecycle: "pending" | "publication-active" | "consumed-for-rebind" | "poisoned";
}

interface PublicationRebindContextState {
  readonly token: SQLiteCursorPublicationRebindContext;
  readonly session: SQLiteCursorPublicationSession;
  readonly preparedOwner: SQLiteCursorPublicationRebindPreparedOwner;
  readonly execution: SQLiteConnectionCursorRebindExecution;
  readonly preparedExecutionSnapshot: SQLiteConnectionCursorRebindExecutionSnapshot;
  readonly authority: SQLiteCursorOuterPublicationAuthority;
  readonly connection: SQLiteConnection;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly historicalTransactionEpoch: bigint;
  readonly historicalTotalChanges: number;
  readonly historicalOuterLedger: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly preRebindReceiptSha256: string;
  readonly b2CursorCount: number;
  readonly b2ImmutableRootSha256: string;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly targetDescriptorHash: typeof SQLITE_CURSOR_PUBLICATION_TARGET.descriptorHash;
  readonly targetSchemaIdentitySha256:
    typeof SQLITE_CURSOR_PUBLICATION_TARGET.schemaIdentitySha256;
  readonly parameterValues: NonNullable<
    SQLiteConnectionCursorRebindExecutionSnapshot["parameterValues"]
  >;
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone | undefined;
  adoption: SQLiteCursorPostRebindWatermarkAdoption | undefined;
  lifecycle: SQLiteCursorPublicationRebindContextSnapshot["lifecycle"];
}

interface PublicationSessionConsumedTombstoneState {
  readonly token: SQLiteCursorPublicationSessionConsumedTombstone;
  readonly context: PublicationRebindContextState;
  lifecycle: SQLiteCursorPublicationSessionConsumedTombstoneSnapshot["lifecycle"];
}

interface PostRebindWatermarkAdoptionState {
  readonly token: SQLiteCursorPostRebindWatermarkAdoption;
  readonly context: PublicationRebindContextState;
  readonly tombstone: PublicationSessionConsumedTombstoneState;
  readonly executionSnapshot: SQLiteConnectionCursorRebindExecutionSnapshot;
  readonly adoptedTransactionEpoch: bigint;
  readonly adoptedTotalChanges: number;
  readonly totalChangesDelta: number;
  readonly affectedRows: number;
  readonly adoptedOuterLedger: SQLiteCursorOuterPublicationLedgerSnapshot;
  lifecycle: "active" | "poisoned" | "retired";
}

interface ConsumedTombstoneState {
  readonly adoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt;
  lifecycle: InitialStageAdoptionReceiptLifecycle;
  readonly receipt: object;
}

interface CancellationState { cancelled: boolean }

const AUTHORITIES = new WeakMap<object, AuthorityState>();
const AUTHORITY_BY_EVIDENCE = new WeakMap<object, SQLiteCursorOuterPublicationAuthority>();
const AUTHORITY_BY_TRANSFER = new WeakMap<object, SQLiteCursorOuterPublicationAuthority>();
const CANCELLATIONS = new WeakMap<object, CancellationState>();
const PUBLICATION_CANCELLATIONS = new WeakMap<object, CancellationState>();
const PUBLICATION_PREPARED = new WeakMap<object, PublicationPreparedState>();
const PUBLICATION_PREPARED_BY_AUTHORITY =
  new WeakMap<object, SQLiteCursorPublicationSessionPreparedOwner>();
const PUBLICATION_SESSIONS = new WeakMap<object, PublicationSessionState>();
const PUBLICATION_REBIND_CONTEXTS = new WeakMap<object, PublicationRebindContextState>();
const PUBLICATION_REBIND_CONTEXT_BY_SESSION =
  new WeakMap<object, SQLiteCursorPublicationRebindContext>();
const PUBLICATION_REBIND_CONTEXT_BY_PREPARED_OWNER =
  new WeakMap<object, SQLiteCursorPublicationRebindContext>();
const PUBLICATION_SESSION_CONSUMED_TOMBSTONES =
  new WeakMap<object, PublicationSessionConsumedTombstoneState>();
const POST_REBIND_WATERMARK_ADOPTIONS =
  new WeakMap<object, PostRebindWatermarkAdoptionState>();
type PublicationRebindRegistrationFaultStage =
  | "context-primary"
  | "context-session"
  | "context-prepared-owner"
  | "session-tombstone"
  | "watermark-adoption";
let publicationRebindRegistrationFault: Readonly<{
  readonly error: unknown;
  readonly stage: PublicationRebindRegistrationFaultStage;
}> | undefined;
let publicationPendingRegistrationFault: Readonly<{ readonly error: unknown }> | undefined;
const MIGRATION_0002_RECEIPTS = new WeakMap<object, Migration0002ReceiptState>();
const POST_DDL_CATALOG_FENCES = new WeakMap<object, PostDdlCatalogFenceState>();
const POST_DDL_PUBLICATION_READER_LEASES =
  new WeakMap<object, PostDdlPublicationReaderLeaseState>();
const BASELINE_ENTRIES_PUBLICATION_RECEIPTS =
  new WeakMap<object, BaselineEntriesPublicationReceiptState>();
const BASELINE_HEADER_PUBLICATION_RECEIPTS =
  new WeakMap<object, BaselineHeaderPublicationReceiptState>();
const OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS =
  new WeakMap<object, OperationSequenceZeroPublicationReceiptState>();
const INITIAL_STAGE_ADOPTION_RECEIPTS =
  new WeakMap<object, InitialStageAdoptionReceiptState>();
const INITIAL_STAGE_CONSUMED_TOMBSTONES =
  new WeakMap<object, ConsumedTombstoneState>();
const MIGRATION_0002_RECEIPT_CONSUMPTIONS = new WeakMap<object,
  SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone>();
const BASELINE_ENTRIES_RECEIPT_CONSUMPTIONS = new WeakMap<object,
  SQLiteBaselineEntriesPublicationReceiptConsumedTombstone>();
const BASELINE_HEADER_RECEIPT_CONSUMPTIONS = new WeakMap<object,
  SQLiteBaselineHeaderPublicationReceiptConsumedTombstone>();
const OPERATION_SEQUENCE_ZERO_RECEIPT_CONSUMPTIONS = new WeakMap<object,
  SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;

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

/**
 * Shared lifecycle boundary for every reusable initial-write receipt proof, for
 * the initial-write executors that mint those receipts, and for the migration
 * 0002 receipt reader they all depend on.
 *
 * A receipt proves what one write did; it can never prove that the authority
 * that performed it still owns the write lane. A terminal authority must
 * therefore refuse every proof, so that a later multi-receipt adoption cannot
 * collect four individually "valid" receipts from a graph that was poisoned or
 * retired after those receipts were minted.
 *
 * Poisoning and retirement fail closed under distinct codes: corruption is a
 * permanently invalid graph, while a stale fence says this transaction
 * generation is simply gone. `lifecycle` is the authoritative terminal signal;
 * `poisonAuthorityGraph` and `retireAuthorityGraph` are its only writers and
 * both assign `writePhase` in the same statement pair, so the `writePhase`
 * halves below are dominated defence in depth against a future writer that
 * assigns one field without the other.
 */
function liveAuthorityState(
  authority: SQLiteCursorOuterPublicationAuthority,
): AuthorityState {
  const state = authorityState(authority);
  if (state.lifecycle === "poisoned" || state.writePhase === "poisoned") {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite outer publication authority is poisoned",
    );
  }
  if (state.lifecycle === "retired" || state.writePhase === "retired") {
    return fail(
      "GE_CYCLE_STORE_STALE_FENCE",
      "SQLite outer publication authority is retired",
    );
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
  if (state.lifecycle === "retired") return;
  const rebindContext = state.publicationRebindContext;
  if (rebindContext !== undefined) {
    const context = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_REBIND_CONTEXTS, [rebindContext as object],
    ) as PublicationRebindContextState | undefined;
    if (context !== undefined) context.lifecycle = "poisoned";
  }
  const sessionConsumedTombstone = state.publicationSessionConsumedTombstone;
  if (sessionConsumedTombstone !== undefined) {
    const consumed = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_SESSION_CONSUMED_TOMBSTONES,
      [sessionConsumedTombstone as object],
    ) as PublicationSessionConsumedTombstoneState | undefined;
    if (consumed !== undefined) consumed.lifecycle = "poisoned";
  }
  const adoptionToken = state.postRebindWatermarkAdoption;
  if (adoptionToken !== undefined) {
    const adoption = reflectApplyIntrinsic(
      weakMapGetIntrinsic, POST_REBIND_WATERMARK_ADOPTIONS, [adoptionToken as object],
    ) as PostRebindWatermarkAdoptionState | undefined;
    if (adoption !== undefined) adoption.lifecycle = "poisoned";
  }
  if (state.lifecycle === "poisoned") return;
  state.lifecycle = "poisoned";
  state.writePhase = "poisoned";
  const preparedOwner = state.publicationPreparedOwner;
  if (preparedOwner !== undefined) {
    const prepared = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_PREPARED, [preparedOwner as object],
    ) as PublicationPreparedState | undefined;
    if (prepared !== undefined) prepared.lifecycle = "poisoned";
  }
  const session = state.publicationSession;
  if (session !== undefined) {
    const publication = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_SESSIONS, [session as object],
    ) as PublicationSessionState | undefined;
    if (publication !== undefined) publication.lifecycle = "poisoned";
  }
  // Retain the exact reason handed to the stage-ownership bridge. The bridge
  // throws it, this function swallows that throw, and without this field no
  // caller could ever observe which invariant poisoned the graph.
  state.stageOwnershipPoisonReason = message;
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
  const rebindContext = state.publicationRebindContext;
  if (rebindContext !== undefined) {
    const context = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_REBIND_CONTEXTS, [rebindContext as object],
    ) as PublicationRebindContextState | undefined;
    if (context !== undefined) context.lifecycle = "retired";
  }
  const sessionConsumedTombstone = state.publicationSessionConsumedTombstone;
  if (sessionConsumedTombstone !== undefined) {
    const consumed = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_SESSION_CONSUMED_TOMBSTONES,
      [sessionConsumedTombstone as object],
    ) as PublicationSessionConsumedTombstoneState | undefined;
    if (consumed !== undefined) consumed.lifecycle = "retired";
  }
  const adoptionToken = state.postRebindWatermarkAdoption;
  if (adoptionToken !== undefined) {
    const adoption = reflectApplyIntrinsic(
      weakMapGetIntrinsic, POST_REBIND_WATERMARK_ADOPTIONS, [adoptionToken as object],
    ) as PostRebindWatermarkAdoptionState | undefined;
    if (adoption !== undefined) adoption.lifecycle = "retired";
  }
  const preparedOwner = state.publicationPreparedOwner;
  if (preparedOwner !== undefined) {
    const prepared = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_PREPARED, [preparedOwner as object],
    ) as PublicationPreparedState | undefined;
    if (prepared !== undefined) prepared.lifecycle = "poisoned";
  }
  const session = state.publicationSession;
  if (session !== undefined) {
    const publication = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_SESSIONS, [session as object],
    ) as PublicationSessionState | undefined;
    if (publication !== undefined) publication.lifecycle = "poisoned";
  }
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

export function createSQLiteCursorPublicationSessionCancellationControllerIntrinsic():
SQLiteCursorPublicationSessionCancellationController {
  const signal = objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as SQLiteCursorPublicationSessionCancellationSignal;
  const state: CancellationState = { cancelled: false };
  reflectApplyIntrinsic(weakMapSetIntrinsic, PUBLICATION_CANCELLATIONS, [
    signal as object,
    state,
  ]);
  return objectFreezeIntrinsic({
    signal,
    cancel: (): void => { state.cancelled = true; },
  });
}

/** Read an optional authentic cancellation signal without consuming any graph. */
export function isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(
  signal: SQLiteCursorPublicationSessionCancellationSignal | undefined,
): boolean {
  if (signal === undefined) return false;
  const state = signal !== null && typeof signal === "object" && !isProxyIntrinsic(signal)
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_CANCELLATIONS, [signal as object],
    ) as CancellationState | undefined
    : undefined;
  if (state === undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication session cancellation signal is invalid",
    );
  }
  return state.cancelled;
}

/**
 * Package-private one-shot fault seam used to prove pending registration is a
 * terminal failure. It is intentionally absent from the package root.
 */
export function injectSQLiteCursorPublicationSessionPendingRegistrationFaultForTestIntrinsic(
  error: unknown,
): void {
  if (publicationPendingRegistrationFault !== undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication session pending registration fault is already armed",
    );
  }
  publicationPendingRegistrationFault = objectFreezeIntrinsic({ error });
}

/** Package-private one-shot seam for proving rebind registry atomicity. */
export function injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
  stage: PublicationRebindRegistrationFaultStage,
  error: unknown,
): void {
  if (publicationRebindRegistrationFault !== undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication rebind registration fault is already armed",
    );
  }
  publicationRebindRegistrationFault = objectFreezeIntrinsic({ error, stage });
}

function throwSQLiteCursorPublicationRebindRegistrationFaultIntrinsic(
  stage: PublicationRebindRegistrationFaultStage,
): void {
  const fault = publicationRebindRegistrationFault;
  if (fault !== undefined && fault.stage === stage) {
    publicationRebindRegistrationFault = undefined;
    throw fault.error;
  }
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
    operationSequenceZeroPublicationReceipt: undefined,
    operationSequenceZeroPublicationReceiptMintCount: 0,
    operationSequenceZeroLogicalExecutionCount: 0,
    operationSequenceZeroPrepareCount: 0,
    operationSequenceZeroExecuteCount: 0,
    operationSequenceZeroAffectedRows: 0,
    initialStageAdoptionReceipt: undefined,
    initialStageAdoptionReceiptMintCount: 0,
    publicationPreparedOwner: undefined,
    publicationSession: undefined,
    publicationRebindContext: undefined,
    publicationSessionConsumedTombstone: undefined,
    postRebindWatermarkAdoption: undefined,
    receiptConsumptionCount: 0,
    tombstoneMintCount: 0,
    migration0002ConsumedTombstone: undefined,
    baselineEntriesConsumedTombstone: undefined,
    baselineHeaderConsumedTombstone: undefined,
    operationSequenceZeroConsumedTombstone: undefined,
    connection,
    currentTotalChanges: changes.totalChanges,
    currentTransactionEpoch: owner.transactionEpoch,
    lifecycle: "inactive",
    stageOwnershipPoisonReason: undefined,
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
    outerProviderNowMs: clock.providerNowMs,
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
    if (state.writePhase === "initial-stage-adoption-complete"
        || state.writePhase === "publication-active"
        || state.writePhase === "publication-session-consumed"
        || state.writePhase === "cursor-rebind-adopted") {
      const adoptionReceipt = state.initialStageAdoptionReceipt;
      const adoption = adoptionReceipt === undefined ? undefined : reflectApplyIntrinsic(
        weakMapGetIntrinsic, INITIAL_STAGE_ADOPTION_RECEIPTS, [adoptionReceipt as object],
      ) as InitialStageAdoptionReceiptState | undefined;
      if (adoption === undefined || adoption.lifecycle !== "active") {
        fail("GE_CYCLE_STORE_CORRUPTION", "SQLite initial stage adoption authority drifted");
      }
      if (state.writePhase === "publication-active"
          || state.writePhase === "publication-session-consumed"
          || state.writePhase === "cursor-rebind-adopted") {
        const session = state.publicationSession;
        if (session === undefined) {
          fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session identity drifted");
        }
        assertSQLiteCursorStageOwnershipPublicationSessionActiveIntrinsic(
          state.transfer, authority, adoptionReceipt!, session,
        );
        if (state.writePhase === "publication-session-consumed") {
          assertSQLiteCursorPublicationSessionConsumedTombstoneIntrinsic(
            state.publicationSessionConsumedTombstone!,
          );
        } else if (state.writePhase === "cursor-rebind-adopted") {
          assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(
            state.postRebindWatermarkAdoption!,
          );
        }
      } else {
        assertSQLiteCursorStageOwnershipInitialPublicationAdoptedIntrinsic(
          state.connection, state.stage, state.receipt, state.projectionIdentity,
          state.transfer, authority, adoption.readerLease,
          adoption.snapshot.retiredB2Fence, adoption.stageWatermark,
        );
      }
    } else {
      assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic(
        state.connection, state.stage, state.receipt, state.projectionIdentity,
        state.transfer, authority,
      );
    }
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
  if (reflectApplyIntrinsic(weakMapGetIntrinsic, MIGRATION_0002_RECEIPT_CONSUMPTIONS, [
    receipt as object,
  ]) !== undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite migration 0002 receipt was consumed");
  }
  // This receipt is one of the reusable initial-write proofs a later adoption
  // replays, so it must speak the same terminal vocabulary as the other three:
  // a poisoned graph is corruption and a retired graph is a stale fence. The
  // active assert below still refuses every other non-active state under
  // `GE_CYCLE_STORE_INVALID_ARGUMENT`.
  const authority = liveAuthorityState(state.authority);
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

function assertActiveConsumedTombstoneIntrinsic(
  tombstone: object,
  receipt: object,
  adoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt,
): void {
  const tombstoneState = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    INITIAL_STAGE_CONSUMED_TOMBSTONES,
    [tombstone],
  ) as ConsumedTombstoneState | undefined;
  const adoptionState = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    INITIAL_STAGE_ADOPTION_RECEIPTS,
    [adoptionReceipt as object],
  ) as InitialStageAdoptionReceiptState | undefined;
  if (tombstoneState === undefined || tombstoneState.lifecycle !== "active"
      || tombstoneState.receipt !== receipt
      || tombstoneState.adoptionReceipt !== adoptionReceipt
      || adoptionState === undefined || adoptionState.lifecycle !== "active") {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite initial publication receipt tombstone is invalid",
    );
  }
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

function operationSequenceZeroParameterFrame(
  row: SQLiteConnectionOperationSequenceZeroRow,
): readonly SQLiteInitialWriteTaggedScalar[] {
  const frame: SQLiteInitialWriteTaggedScalar[] = [];
  defineDenseArrayValue(frame, 0, initialWriteText(row.baselineId));
  defineDenseArrayValue(frame, 1, initialWriteInteger(row.baselineCapturedAtMs));
  defineDenseArrayValue(frame, 2, initialWriteInteger(row.updatedAtMs));
  return objectFreezeIntrinsic(frame);
}

function digestOperationSequenceZeroParametersIntrinsic(
  row: SQLiteConnectionOperationSequenceZeroRow,
): SQLiteInitialWriteSha256 {
  const executions: SQLiteInitialWriteTaggedScalar[][] = [];
  defineDenseArrayValue(
    executions,
    0,
    operationSequenceZeroParameterFrame(row) as SQLiteInitialWriteTaggedScalar[],
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

/**
 * Reprove one exact live fence with a new physical-catalog read.
 *
 * The `assertSQLiteCursorOuterPublicationAuthorityIntrinsic` call below is the
 * only lifecycle boundary this function has, and it is therefore the lifecycle
 * boundary for the three callers that reach here with no gated authority proof
 * of their own on the path: `readSQLiteCursorPostDdlCatalogFenceSnapshotIntrinsic`,
 * `mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic`, and
 * `executeSQLiteCursorPostDdlPublicationReaderIntrinsic`. Every check above that
 * call is pure graph shape and cannot observe a terminal authority. Removing or
 * weakening that assert would silently open all three paths to a poisoned or
 * retired graph, so it must not be treated as redundant with the shape checks.
 */
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
    const consumed = reflectApplyIntrinsic(
      weakMapGetIntrinsic,
      MIGRATION_0002_RECEIPT_CONSUMPTIONS,
      [migration0002Receipt as object],
    ) as SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone | undefined;
    if (consumed === undefined) {
      readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(migration0002Receipt);
    } else {
      const adoptionReceipt = authorityRecord.initialStageAdoptionReceipt;
      if (adoptionReceipt === undefined
          || authorityRecord.migration0002ConsumedTombstone !== consumed) {
        fail(
          "GE_CYCLE_STORE_CORRUPTION",
          "SQLite post-DDL catalog fence consumed predecessor drifted",
        );
      }
      assertActiveConsumedTombstoneIntrinsic(
        consumed as object,
        migration0002Receipt as object,
        adoptionReceipt,
      );
    }
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
  const authorityRecord = liveAuthorityState(authority);
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
  if (reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_ENTRIES_RECEIPT_CONSUMPTIONS, [
    receipt as object,
  ]) !== undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite baseline-entries publication receipt was consumed",
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
  const authorityRecord = liveAuthorityState(authority);
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
  if (reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_HEADER_RECEIPT_CONSUMPTIONS, [
    receipt as object,
  ]) !== undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite baseline-header publication receipt was consumed",
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
  // Terminal classification first, under the shared codes, exactly as the
  // operation-sequence-zero sibling does: a caller that lost its transaction
  // generation must read a stale fence and retry, never a corrupt store.
  const authorityRecord = liveAuthorityState(authority);
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
  const authorityRecord = liveAuthorityState(authority);
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

function operationSequenceZeroReceiptState(
  receipt: SQLiteOperationSequenceZeroPublicationReceipt,
): OperationSequenceZeroPublicationReceiptState {
  const state = receipt !== null && typeof receipt === "object"
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic,
      OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS,
      [receipt as object],
    ) as OperationSequenceZeroPublicationReceiptState | undefined
    : undefined;
  if (state === undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite operation-sequence-zero publication receipt is invalid",
    );
  }
  if (reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    OPERATION_SEQUENCE_ZERO_RECEIPT_CONSUMPTIONS,
    [receipt as object],
  ) !== undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite operation-sequence-zero publication receipt was consumed",
    );
  }
  return state;
}

/** Publish the singleton sequence row from retained clock and source evidence only. */
export function executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  terminalLease: SQLiteCursorPostDdlPublicationReaderLease,
  baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt,
  baselineHeaderPublicationReceipt: SQLiteBaselineHeaderPublicationReceipt,
): SQLiteOperationSequenceZeroPublicationReceipt {
  // Terminal classification first, under the shared codes, exactly as the
  // baseline-header sibling does: a caller that lost its transaction generation
  // must read a stale fence and retry, never a corrupt store.
  const authorityRecord = liveAuthorityState(authority);
  const headerRecord = baselineHeaderReceiptState(baselineHeaderPublicationReceipt);
  if (headerRecord.authority !== authority
      || headerRecord.migration0002Receipt !== migration0002Receipt
      || headerRecord.fence !== fence
      || headerRecord.readerLease !== terminalLease
      || headerRecord.baselineEntriesPublicationReceipt
        !== baselineEntriesPublicationReceipt
      || headerRecord.connection !== authorityRecord.connection
      || authorityRecord.baselineHeaderPublicationReceipt
        !== baselineHeaderPublicationReceipt) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite operation-sequence-zero publication graph is invalid",
    );
  }
  if (authorityRecord.operationSequenceZeroPublicationReceipt !== undefined
      || authorityRecord.operationSequenceZeroPublicationReceiptMintCount !== 0
      || authorityRecord.operationSequenceZeroLogicalExecutionCount !== 0
      || authorityRecord.operationSequenceZeroPrepareCount !== 0
      || authorityRecord.operationSequenceZeroExecuteCount !== 0
      || authorityRecord.operationSequenceZeroAffectedRows !== 0) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero publication was reused",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite operation-sequence-zero publication was reused",
    );
  }

  assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
    authority,
    migration0002Receipt,
    fence,
    terminalLease,
    baselineEntriesPublicationReceipt,
    baselineHeaderPublicationReceipt,
  );
  // Unreachable, retained as defence in depth, and ordered after the delegated
  // predecessor proof so that this executor and its baseline-header sibling
  // check their own write phase at the same point. This branch can never be the
  // one that reports a terminal graph: `liveAuthorityState` above already
  // classified poisoning as corruption and retirement as a stale fence, which is
  // the distinction a caller needs to decide between retrying this transaction
  // generation and refusing the store. `writePhase` cannot be anything but
  // `baseline-header-complete` here either, because the retained header receipt
  // identity checked above is assigned only alongside that phase and the reuse
  // gate excludes both sequence-zero phases, while `activationCount` and
  // `outerClockConsumedTombstone` are assigned exactly once by activation and
  // never reassigned. Retained so that a future edit to the phase machine cannot
  // silently widen this entry point.
  if (authorityRecord.writePhase !== "baseline-header-complete"
      || authorityRecord.lifecycle !== "active"
      || authorityRecord.activationCount !== 1
      || authorityRecord.outerClockConsumedTombstone === undefined) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero publication entry state drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite operation-sequence-zero publication entry state drifted",
    );
  }
  const headerSnapshot = headerRecord.snapshot;
  const projection = authorityRecord.projectionIdentity;
  const baselineCapturedAtMs = authorityRecord.sourceEnvelope.capturedAtMs;
  const updatedAtMs = authorityRecord.outerProviderNowMs;
  // Unreachable, retained as defence in depth. All three clauses are dominated
  // by `assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic` above,
  // which compares the same header snapshot against the same retained
  // projection identity and source envelope before this point is reached.
  // Retained so this leaf still states the identity binding it depends on
  // rather than inheriting it silently from its predecessor proof.
  if (headerSnapshot.projectionIdentity !== projection
      || headerSnapshot.baselineId !== projection.baselineId
      || headerSnapshot.capturedAtMs !== baselineCapturedAtMs) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero baseline header identity drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite operation-sequence-zero baseline header identity drifted",
    );
  }
  // The comparand is validated here rather than assumed: a hostile retained
  // capture time must reject before anything is prepared, not inside the
  // connection-level parameter check after `prepareCount` has already moved.
  // The bound itself is dominated by the baseline-header write, whose
  // connection-level parameter check already refuses a negative or non-safe
  // captured time, and by the header receipt proof above, which refuses any
  // envelope that no longer equals the header snapshot.
  if (!numberIsSafeIntegerIntrinsic(baselineCapturedAtMs)
      || baselineCapturedAtMs < 0
      || !numberIsSafeIntegerIntrinsic(updatedAtMs)
      || updatedAtMs < baselineCapturedAtMs) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero provider timestamp predecessor drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite operation-sequence-zero provider timestamp predecessor drifted",
    );
  }

  let exactInsertSqlSha256: string;
  try {
    exactInsertSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero SQL preflight failed",
    );
    throw translated;
  }
  if (exactInsertSqlSha256
      !== SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero SQL identity drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite operation-sequence-zero SQL identity drifted",
    );
  }

  let row: SQLiteConnectionOperationSequenceZeroRow;
  let parameterExecutions: SQLiteInitialWriteTaggedScalar[][];
  try {
    row = objectFreezeIntrinsic({
      baselineCapturedAtMs,
      baselineId: projection.baselineId,
      updatedAtMs,
    } satisfies SQLiteConnectionOperationSequenceZeroRow);
    parameterExecutions = [];
    defineDenseArrayValue(
      parameterExecutions,
      0,
      operationSequenceZeroParameterFrame(row) as SQLiteInitialWriteTaggedScalar[],
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero parameter construction failed",
    );
    throw translated;
  }

  const totalChangesBefore = authorityRecord.currentTotalChanges;
  const transactionEpochBefore = authorityRecord.currentTransactionEpoch;
  const ledgerBefore = outerLedgerSnapshot(authorityRecord);
  let execution: ReturnType<
    typeof beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic
  > | undefined;
  try {
    authorityRecord.writePhase = "executing-sequence-zero";
    authorityRecord.operationSequenceZeroLogicalExecutionCount = 1;
    execution = beginSQLiteConnectionOperationSequenceZeroExecutionIntrinsic(
      authorityRecord.connection,
    );
    authorityRecord.operationSequenceZeroPrepareCount = 1;
    const step = executeSQLiteConnectionOperationSequenceZeroIntrinsic(
      authorityRecord.connection,
      execution,
      row,
    );
    authorityRecord.currentTransactionEpoch = step.transactionEpoch;
    authorityRecord.currentTotalChanges = step.totalChanges;
    authorityRecord.operationSequenceZeroExecuteCount = step.executeCount;
    authorityRecord.operationSequenceZeroAffectedRows = step.affectedRowsDelta;
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
        "SQLite operation-sequence-zero execution drifted",
      );
    }

    const progress = readSQLiteConnectionOperationSequenceZeroExecutionSnapshotIntrinsic(
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
        "SQLite operation-sequence-zero completion ledger drifted",
      );
    }

    const parameterSha256 = digestSQLiteInitialWriteParametersIntrinsic(
      objectFreezeIntrinsic(parameterExecutions) as SQLiteInitialWriteParameterExecutions,
    );
    const verifiedParameterSha256 = digestOperationSequenceZeroParametersIntrinsic(row);
    const resultSha256 = digestSQLiteInitialWriteResultIntrinsic({ affectedRows: "1" });
    const verifiedResultSha256 = digestSQLiteInitialWriteResultVerifierIntrinsic({
      affectedRows: "1",
    });
    if (parameterSha256 !== verifiedParameterSha256
        || resultSha256 !== verifiedResultSha256) {
      fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite operation-sequence-zero receipt digest drifted",
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
      baselineCapturedAtMs,
      baselineEntriesPublicationReceipt,
      baselineHeaderPublicationReceipt,
      baselineId: projection.baselineId,
      connection: authorityRecord.connection,
      executeCount: 1 as const,
      fixedInsertSql: SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
      fixedInsertSqlSha256:
        SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC,
      lastCommitSequence: 0 as const,
      migration0002Receipt,
      mintCount: 1 as const,
      outerClockEvidence: authorityRecord.outerClockEvidence,
      outerLedgerAfter: ledgerAfter,
      outerLedgerBefore: ledgerBefore,
      outerLedgerDelta: objectFreezeIntrinsic({
        affectedRowsWatermark: 1,
        fixedStatementCount: 1,
        logicalWriteSequence: 1,
      }),
      outerProviderNowMs: updatedAtMs,
      parameterOrder: SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC,
      parameterSha256,
      postDdlCatalogFence: fence,
      prepareCount: 1 as const,
      projectionIdentity: projection,
      projectionReference: authorityRecord.projectionReference,
      readerLease: terminalLease,
      resultSha256,
      totalChangesAfter: progress.totalChanges,
      totalChangesBefore,
      totalChangesDelta: 1 as const,
      transactionEpochAfter: progress.transactionEpoch,
      transactionEpochBefore,
      transactionLineage: authorityRecord.transactionLineage,
      updatedAtMs,
      writeKind: "operation-sequence-zero-publication" as const,
    } satisfies SQLiteOperationSequenceZeroPublicationReceiptSnapshot);
    const receipt = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteOperationSequenceZeroPublicationReceipt;
    reflectApplyIntrinsic(weakMapSetIntrinsic, OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS, [
      receipt as object,
      objectFreezeIntrinsic({
        authority,
        baselineEntriesPublicationReceipt,
        baselineHeaderPublicationReceipt,
        connection: authorityRecord.connection,
        fence,
        migration0002Receipt,
        readerLease: terminalLease,
        snapshot,
      } satisfies OperationSequenceZeroPublicationReceiptState),
    ]);
    authorityRecord.logicalWriteSequence = ledgerAfter.logicalWriteSequence;
    authorityRecord.operationSequenceZeroPublicationReceipt = receipt;
    authorityRecord.operationSequenceZeroPublicationReceiptMintCount = 1;
    authorityRecord.writePhase = "sequence-zero-complete";
    return receipt;
  } catch (error) {
    if (execution !== undefined) {
      try {
        const progress = readSQLiteConnectionOperationSequenceZeroExecutionSnapshotIntrinsic(
          authorityRecord.connection,
          execution,
        );
        authorityRecord.currentTransactionEpoch = progress.transactionEpoch;
        authorityRecord.currentTotalChanges = progress.totalChanges;
        authorityRecord.operationSequenceZeroPrepareCount = progress.prepareCount;
        authorityRecord.operationSequenceZeroExecuteCount = progress.executeCount;
        authorityRecord.operationSequenceZeroAffectedRows =
          progress.affectedRows === 1 ? 1 : 0;
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
      "SQLite operation-sequence-zero publication failed",
    );
    throw translateSQLiteError(error, OPERATION);
  }
}

/** Reusable proof of the exact singleton sequence-zero publication. */
export function assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  migration0002Receipt: SQLiteMigration0002CatalogRebuildReceipt,
  fence: SQLiteCursorPostDdlCatalogFence,
  terminalLease: SQLiteCursorPostDdlPublicationReaderLease,
  baselineEntriesPublicationReceipt: SQLiteBaselineEntriesPublicationReceipt,
  baselineHeaderPublicationReceipt: SQLiteBaselineHeaderPublicationReceipt,
  receipt: SQLiteOperationSequenceZeroPublicationReceipt,
): SQLiteOperationSequenceZeroPublicationReceipt {
  const receiptRecord = operationSequenceZeroReceiptState(receipt);
  if (receiptRecord.authority !== authority
      || receiptRecord.migration0002Receipt !== migration0002Receipt
      || receiptRecord.fence !== fence
      || receiptRecord.readerLease !== terminalLease
      || receiptRecord.baselineEntriesPublicationReceipt
        !== baselineEntriesPublicationReceipt
      || receiptRecord.baselineHeaderPublicationReceipt
        !== baselineHeaderPublicationReceipt) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite operation-sequence-zero receipt graph is invalid",
    );
  }
  const authorityRecord = liveAuthorityState(authority);
  assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
    authority,
    migration0002Receipt,
    fence,
    terminalLease,
    baselineEntriesPublicationReceipt,
    baselineHeaderPublicationReceipt,
  );
  const headerSnapshot = baselineHeaderReceiptState(
    baselineHeaderPublicationReceipt,
  ).snapshot;
  const projection = authorityRecord.projectionIdentity;
  const row = objectFreezeIntrinsic({
    baselineCapturedAtMs: authorityRecord.sourceEnvelope.capturedAtMs,
    baselineId: projection.baselineId,
    updatedAtMs: authorityRecord.outerProviderNowMs,
  } satisfies SQLiteConnectionOperationSequenceZeroRow);
  let parameterSha256: SQLiteInitialWriteSha256;
  let resultSha256: SQLiteInitialWriteSha256;
  let insertSqlSha256: string;
  let rederivedProviderNowMs: number;
  try {
    // Re-read the authentic retained clock evidence instead of trusting the
    // cached authority field the receipt was minted from. This is the only
    // independent proof of "outer-provider-now-ms"; the digests below prove
    // only that the receipt agrees with itself.
    rederivedProviderNowMs = readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
      authorityRecord.providerClockCapability,
      authorityRecord.outerClockEvidence,
    ).providerNowMs;
    parameterSha256 = digestOperationSequenceZeroParametersIntrinsic(row);
    resultSha256 = digestSQLiteInitialWriteResultVerifierIntrinsic({ affectedRows: "1" });
    insertSqlSha256 = sha256Utf8Intrinsic(
      SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
    );
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero receipt observation failed",
    );
    throw translated;
  }
  const snapshot = receiptRecord.snapshot;
  if (!numberIsSafeIntegerIntrinsic(rederivedProviderNowMs)
      || rederivedProviderNowMs !== authorityRecord.outerProviderNowMs
      || rederivedProviderNowMs < authorityRecord.sourceEnvelope.capturedAtMs
      || snapshot.updatedAtMs !== rederivedProviderNowMs
      || snapshot.outerProviderNowMs !== rederivedProviderNowMs) {
    poisonAuthorityGraph(
      authorityRecord,
      authority,
      "SQLite operation-sequence-zero receipt clock evidence drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite operation-sequence-zero receipt clock evidence drifted",
    );
  }
  if (authorityRecord.connection !== receiptRecord.connection
      || authorityRecord.operationSequenceZeroPublicationReceipt !== receipt
      || authorityRecord.operationSequenceZeroPublicationReceiptMintCount !== 1
      || authorityRecord.operationSequenceZeroLogicalExecutionCount !== 1
      || authorityRecord.operationSequenceZeroPrepareCount !== 1
      || authorityRecord.operationSequenceZeroExecuteCount !== 1
      || authorityRecord.operationSequenceZeroAffectedRows !== 1
      || authorityRecord.logicalWriteSequence < snapshot.outerLedgerAfter.logicalWriteSequence
      || authorityRecord.fixedStatementCount < snapshot.outerLedgerAfter.fixedStatementCount
      || authorityRecord.affectedRowsWatermark
        < snapshot.outerLedgerAfter.affectedRowsWatermark
      || authorityRecord.currentTransactionEpoch < snapshot.transactionEpochAfter
      || authorityRecord.currentTotalChanges < snapshot.totalChangesAfter
      || snapshot.authority !== authority
      || snapshot.connection !== authorityRecord.connection
      || snapshot.migration0002Receipt !== migration0002Receipt
      || snapshot.postDdlCatalogFence !== fence
      || snapshot.readerLease !== terminalLease
      || snapshot.baselineEntriesPublicationReceipt
        !== baselineEntriesPublicationReceipt
      || snapshot.baselineHeaderPublicationReceipt
        !== baselineHeaderPublicationReceipt
      || snapshot.projectionIdentity !== projection
      || snapshot.projectionReference !== authorityRecord.projectionReference
      || snapshot.baselineId !== projection.baselineId
      || snapshot.baselineCapturedAtMs !== authorityRecord.sourceEnvelope.capturedAtMs
      || snapshot.updatedAtMs !== authorityRecord.outerProviderNowMs
      || snapshot.outerClockEvidence !== authorityRecord.outerClockEvidence
      || snapshot.outerProviderNowMs !== authorityRecord.outerProviderNowMs
      || snapshot.lastCommitSequence !== 0
      || snapshot.fixedInsertSql
        !== SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC
      || snapshot.fixedInsertSqlSha256
        !== SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC
      || insertSqlSha256 !== snapshot.fixedInsertSqlSha256
      || snapshot.parameterOrder
        !== SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC
      || snapshot.parameterSha256 !== parameterSha256
      || snapshot.resultSha256 !== resultSha256
      || snapshot.writeKind !== "operation-sequence-zero-publication"
      || snapshot.mintCount !== 1
      || snapshot.prepareCount !== 1
      || snapshot.executeCount !== 1
      || snapshot.affectedRows !== 1
      || snapshot.totalChangesDelta !== 1
      || snapshot.totalChangesBefore !== headerSnapshot.totalChangesAfter
      || snapshot.totalChangesAfter !== snapshot.totalChangesBefore + 1
      || snapshot.transactionEpochBefore !== headerSnapshot.transactionEpochAfter
      || snapshot.transactionEpochAfter !== snapshot.transactionEpochBefore + 1n
      || snapshot.transactionLineage !== authorityRecord.transactionLineage
      || snapshot.outerLedgerBefore.logicalWriteSequence
        !== headerSnapshot.outerLedgerAfter.logicalWriteSequence
      || snapshot.outerLedgerBefore.fixedStatementCount
        !== headerSnapshot.outerLedgerAfter.fixedStatementCount
      || snapshot.outerLedgerBefore.affectedRowsWatermark
        !== headerSnapshot.outerLedgerAfter.affectedRowsWatermark
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
      "SQLite operation-sequence-zero receipt graph drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite operation-sequence-zero receipt graph drifted",
    );
  }
  return receipt;
}

export function readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(
  receipt: SQLiteOperationSequenceZeroPublicationReceipt,
): SQLiteOperationSequenceZeroPublicationReceiptSnapshot {
  const state = operationSequenceZeroReceiptState(receipt);
  assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic(
    state.authority,
    state.migration0002Receipt,
    state.fence,
    state.readerLease,
    state.baselineEntriesPublicationReceipt,
    state.baselineHeaderPublicationReceipt,
    receipt,
  );
  return state.snapshot;
}

interface CheckedInitialPublicationBundle {
  readonly migration: Migration0002ReceiptState;
  readonly entries: BaselineEntriesPublicationReceiptState;
  readonly header: BaselineHeaderPublicationReceiptState;
  readonly sequence: OperationSequenceZeroPublicationReceiptState;
  readonly migrationReceipt: SQLiteMigration0002CatalogRebuildReceipt;
  readonly entriesReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly headerReceipt: SQLiteBaselineHeaderPublicationReceipt;
  readonly sequenceReceipt: SQLiteOperationSequenceZeroPublicationReceipt;
}

function checkedInitialPublicationBundlePresentationIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  bundle: SQLiteCursorInitialPublicationReceiptBundle,
  fence: SQLiteCursorPostDdlCatalogFence,
  readerLease: SQLiteCursorPostDdlPublicationReaderLease,
): CheckedInitialPublicationBundle {
  let values: readonly unknown[];
  try {
    if (!reflectApplyIntrinsic(arrayIsArrayIntrinsic, Array, [bundle])) {
      return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite initial publication receipt bundle is invalid");
    }
    const keys = reflectApplyIntrinsic(reflectOwnKeysIntrinsic, Reflect, [bundle]) as
      readonly PropertyKey[];
    if (keys.length !== 5 || keys[0] !== "0" || keys[1] !== "1"
        || keys[2] !== "2" || keys[3] !== "3" || keys[4] !== "length") {
      return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite initial publication receipt bundle is invalid");
    }
    const dense: unknown[] = [];
    for (let index = 0; index < 4; index += 1) {
      const descriptor = reflectApplyIntrinsic(
        objectGetOwnPropertyDescriptorIntrinsic,
        Object,
        [bundle, `${index}`],
      ) as PropertyDescriptor | undefined;
      if (descriptor === undefined || !("value" in descriptor)) {
        return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite initial publication receipt bundle is invalid");
      }
      defineDenseArrayValue(dense, index, descriptor.value);
    }
    const lengthDescriptor = reflectApplyIntrinsic(
      objectGetOwnPropertyDescriptorIntrinsic,
      Object,
      [bundle, "length"],
    ) as PropertyDescriptor | undefined;
    if (lengthDescriptor === undefined || lengthDescriptor.value !== 4) {
      return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite initial publication receipt bundle is invalid");
    }
    values = dense;
  } catch {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite initial publication receipt bundle is invalid");
  }
  // Do not destructure here: array destructuring consults the mutable
  // Array.prototype iterator. Presentation validation must remain usable even
  // when ambient prototypes are replaced after this module is loaded.
  const migrationReceipt = values[0] as SQLiteMigration0002CatalogRebuildReceipt;
  const entriesReceipt = values[1] as SQLiteBaselineEntriesPublicationReceipt;
  const headerReceipt = values[2] as SQLiteBaselineHeaderPublicationReceipt;
  const sequenceReceipt = values[3] as SQLiteOperationSequenceZeroPublicationReceipt;
  const migration = migrationReceipt !== null && typeof migrationReceipt === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, MIGRATION_0002_RECEIPTS, [
      migrationReceipt as object,
    ]) as Migration0002ReceiptState | undefined
    : undefined;
  const entries = entriesReceipt !== null && typeof entriesReceipt === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_ENTRIES_PUBLICATION_RECEIPTS, [
      entriesReceipt as object,
    ]) as BaselineEntriesPublicationReceiptState | undefined
    : undefined;
  const header = headerReceipt !== null && typeof headerReceipt === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_HEADER_PUBLICATION_RECEIPTS, [
      headerReceipt as object,
    ]) as BaselineHeaderPublicationReceiptState | undefined
    : undefined;
  const sequence = sequenceReceipt !== null && typeof sequenceReceipt === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS, [
      sequenceReceipt as object,
    ]) as OperationSequenceZeroPublicationReceiptState | undefined
    : undefined;
  if (migration === undefined || entries === undefined || header === undefined
      || sequence === undefined || migration.authority !== authority
      || entries.authority !== authority || header.authority !== authority
      || sequence.authority !== authority || entries.migration0002Receipt !== migrationReceipt
      || header.migration0002Receipt !== migrationReceipt
      || sequence.migration0002Receipt !== migrationReceipt
      || header.baselineEntriesPublicationReceipt !== entriesReceipt
      || sequence.baselineEntriesPublicationReceipt !== entriesReceipt
      || sequence.baselineHeaderPublicationReceipt !== headerReceipt
      || entries.readerLease !== readerLease || header.readerLease !== readerLease
      || sequence.readerLease !== readerLease || migration.connection !== entries.connection
      || entries.connection !== header.connection || header.connection !== sequence.connection) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite initial publication receipt bundle is invalid");
  }
  if (entries.fence !== fence || header.fence !== fence || sequence.fence !== fence) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite initial publication stage adoption graph is invalid",
    );
  }
  return { migration, entries, header, sequence, migrationReceipt, entriesReceipt,
    headerReceipt, sequenceReceipt };
}

function initialAdoptionCorruption(
  state: AuthorityState,
  authority: SQLiteCursorOuterPublicationAuthority,
  message: string,
): never {
  poisonAuthorityGraph(state, authority, message);
  return fail("GE_CYCLE_STORE_CORRUPTION", message);
}

function validateInitialAdoptionGraphIntrinsic(
  state: AuthorityState,
  authority: SQLiteCursorOuterPublicationAuthority,
  checked: CheckedInitialPublicationBundle,
  fence: SQLiteCursorPostDdlCatalogFence,
  readerLease: SQLiteCursorPostDdlPublicationReaderLease,
): PostDdlPublicationReaderLeaseState {
  const fenceState = postDdlCatalogFenceState(fence);
  const reader = postDdlPublicationReaderLeaseState(readerLease);
  const final = checked.sequence.snapshot;
  if (state.initialStageAdoptionReceipt !== undefined
      || state.initialStageAdoptionReceiptMintCount !== 0
      || state.receiptConsumptionCount !== 0 || state.tombstoneMintCount !== 0
      || state.migration0002ConsumedTombstone !== undefined
      || state.baselineEntriesConsumedTombstone !== undefined
      || state.baselineHeaderConsumedTombstone !== undefined
      || state.operationSequenceZeroConsumedTombstone !== undefined
      || reflectApplyIntrinsic(weakMapGetIntrinsic, MIGRATION_0002_RECEIPT_CONSUMPTIONS,
        [checked.migrationReceipt as object]) !== undefined
      || reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_ENTRIES_RECEIPT_CONSUMPTIONS,
        [checked.entriesReceipt as object]) !== undefined
      || reflectApplyIntrinsic(weakMapGetIntrinsic, BASELINE_HEADER_RECEIPT_CONSUMPTIONS,
        [checked.headerReceipt as object]) !== undefined
      || reflectApplyIntrinsic(weakMapGetIntrinsic, OPERATION_SEQUENCE_ZERO_RECEIPT_CONSUMPTIONS,
        [checked.sequenceReceipt as object]) !== undefined) {
    return initialAdoptionCorruption(
      state, authority, "SQLite initial publication stage adoption was reused",
    );
  }
  let owner: ReturnType<typeof readSQLiteConnectionOwnerSnapshot>;
  let changes: ReturnType<typeof readSQLiteConnectionTotalChangesSnapshot>;
  try {
    owner = readSQLiteConnectionOwnerSnapshot(state.connection);
    changes = readSQLiteConnectionTotalChangesSnapshot(state.connection);
  } catch (error) {
    const translated = translateSQLiteError(error, OPERATION);
    poisonAuthorityGraph(state, authority,
      "SQLite initial publication stage adoption owner observation failed");
    throw translated;
  }
  if (!owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage !== state.transactionLineage) {
    return initialAdoptionCorruption(
      state, authority, "SQLite initial publication stage adoption lineage drifted",
    );
  }
  if (owner.transactionEpoch !== state.currentTransactionEpoch
      || changes.transactionEpoch !== owner.transactionEpoch
      || changes.totalChanges !== state.currentTotalChanges) {
    return initialAdoptionCorruption(
      state, authority, "SQLite initial publication stage adoption ledger drifted",
    );
  }
  try {
    assertSQLiteCursorOuterPublicationAuthorityIntrinsic(authority);
    readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(
      checked.migrationReceipt,
    );
    assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
      authority, checked.migrationReceipt, fence,
    );
    assertSQLiteCursorPostDdlPublicationReaderTerminalProofIntrinsic(
      authority, checked.migrationReceipt, fence, readerLease,
    );
    assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic(
      authority, checked.migrationReceipt, fence, readerLease,
      checked.entriesReceipt,
    );
    assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
      authority, checked.migrationReceipt, fence, readerLease,
      checked.entriesReceipt, checked.headerReceipt,
    );
    assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic(
      authority, checked.migrationReceipt, fence, readerLease,
      checked.entriesReceipt, checked.headerReceipt, checked.sequenceReceipt,
    );
  } catch (error) {
    terminateAfterInvariantFailure(state, authority, error,
      "SQLite initial publication adoption authority validation failed");
    throw error;
  }
  const expectedEntries = state.projectionIdentity.entryCount;
  const expectedAffectedRows = 3 + state.projectionIdentity.legacyOperationCount
    + expectedEntries;
  if (state.writePhase !== "sequence-zero-complete"
      || state.migration0002Receipt !== checked.migrationReceipt
      || state.baselineEntriesPublicationReceipt !== checked.entriesReceipt
      || state.baselineHeaderPublicationReceipt !== checked.headerReceipt
      || state.operationSequenceZeroPublicationReceipt !== checked.sequenceReceipt
      || state.migration0002LogicalExecutionCount !== 1
      || state.migration0002PreparedStatementCount
        !== SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
      || state.baselineEntriesPublicationReceiptMintCount !== 1
      || state.baselineEntriesLogicalExecutionCount !== 1
      || state.baselineEntriesPrepareCount !== 1
      || state.baselineEntriesExecuteCount !== expectedEntries
      || state.baselineEntriesAffectedRows !== expectedEntries
      || state.baselineHeaderPublicationReceiptMintCount !== 1
      || state.baselineHeaderLogicalExecutionCount !== 1
      || state.baselineHeaderPrepareCount !== 1 || state.baselineHeaderExecuteCount !== 1
      || state.baselineHeaderAffectedRows !== 1
      || state.operationSequenceZeroPublicationReceiptMintCount !== 1
      || state.operationSequenceZeroLogicalExecutionCount !== 1
      || state.operationSequenceZeroPrepareCount !== 1
      || state.operationSequenceZeroExecuteCount !== 1
      || state.operationSequenceZeroAffectedRows !== 1
      || state.logicalWriteSequence !== 4
      || state.fixedStatementCount
        !== SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT + expectedEntries + 2
      || state.affectedRowsWatermark !== expectedAffectedRows
      || state.currentTransactionEpoch !== final.transactionEpochAfter
      || state.currentTotalChanges !== final.totalChangesAfter
      || !exactLedger(outerLedgerSnapshot(state), final.outerLedgerAfter)
      || checked.migration.snapshot.outerLedgerAfter.logicalWriteSequence !== 1
      || checked.entries.snapshot.outerLedgerBefore.logicalWriteSequence !== 1
      || checked.header.snapshot.outerLedgerBefore.logicalWriteSequence !== 2
      || final.outerLedgerBefore.logicalWriteSequence !== 3
      || fenceState.authority !== authority || fenceState.connection !== state.connection
      || fenceState.migration0002Receipt !== checked.migrationReceipt
      || fenceState.snapshot.catalogSha256 !== SQLITE_CURSOR_PUBLICATION_TARGET.catalogSha256
      || state.postDdlCatalogFence !== fence || state.postDdlCatalogFenceMintCount !== 1
      || state.postDdlPublicationReaderLease !== readerLease
      || state.postDdlPublicationReaderLeaseMintCount !== 1
      || state.postDdlPublicationReaderLeaseCloseCount !== 1
      || reader.authority !== authority || reader.connection !== state.connection
      || reader.fence !== fence || reader.migration0002Receipt !== checked.migrationReceipt
      || reader.lifecycle !== "retired" || reader.closeAttemptCount !== 1
      || !reader.closeSucceeded || reader.prepareCount !== 1 || reader.executeCount !== 1
      || reader.ownershipAcquisitionCount !== 1 || reader.rederivedProjection === undefined
      || !sameProjectionIdentity(reader.rederivedProjection, state.projectionIdentity)
      || reader.rederivedProjection.projectionSha256 !== state.projectionIdentity.projectionSha256) {
    return initialAdoptionCorruption(state, authority, "SQLite initial publication adoption graph drifted");
  }
  return reader;
}

export function adoptSQLiteCursorInitialPublicationStageIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  bundle: SQLiteCursorInitialPublicationReceiptBundle,
  fence: SQLiteCursorPostDdlCatalogFence,
  readerLease: SQLiteCursorPostDdlPublicationReaderLease,
  cancellation?: SQLiteCursorOuterPublicationCancellationSignal,
): SQLiteCursorInitialStageAdoptionReceipt {
  const checked = checkedInitialPublicationBundlePresentationIntrinsic(
    authority, bundle, fence, readerLease,
  );
  const state = authorityState(authority);
  const cancellationState = postDdlPublicationReaderCancellationState(cancellation);
  const reader = validateInitialAdoptionGraphIntrinsic(
    state, authority, checked, fence, readerLease,
  );
  const requestedWatermark = objectFreezeIntrinsic({
    outerLedger: outerLedgerSnapshot(state),
    targetCatalogSha256: SQLITE_CURSOR_PUBLICATION_TARGET.catalogSha256,
    totalChanges: state.currentTotalChanges,
    transactionEpoch: state.currentTransactionEpoch,
  } satisfies SQLiteCursorInitialPublicationStageWatermark);
  let mint: ReturnType<
    typeof prepareSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic
  >;
  try {
    mint = prepareSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic(
      state.connection, state.stage, state.receipt, state.projectionIdentity,
      state.transfer, authority, readerLease, requestedWatermark,
    );
  } catch (error) {
    terminateAfterInvariantFailure(state, authority, error,
      "SQLite initial publication stage adoption preparation failed");
    throw error;
  }
  // This is the sole retryable exit after every fallible graph, catalog and
  // stage-side adoption check, but before any receipt/tombstone is allocated
  // or consumed. The exact prepared continuation remains reusable by the same
  // untouched valid bundle.
  if (cancellationState?.cancelled) {
    return fail("GE_CYCLE_STORE_UNAVAILABLE", "SQLite initial publication stage adoption was cancelled");
  }
  const migrationTombstone = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone;
  const entriesTombstone = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteBaselineEntriesPublicationReceiptConsumedTombstone;
  const headerTombstone = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteBaselineHeaderPublicationReceiptConsumedTombstone;
  const sequenceTombstone = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone;
  const adoptionReceipt = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorInitialStageAdoptionReceipt;
  const adoptedOuterLedger = outerLedgerSnapshot(state);
  const snapshot = objectFreezeIntrinsic({
    adoptedOuterLedger,
    adoptedTotalChanges: state.currentTotalChanges,
    adoptedTransactionEpoch: state.currentTransactionEpoch,
    authority,
    baselineEntriesConsumedTombstone: entriesTombstone,
    baselineEntriesPublicationReceipt: checked.entriesReceipt,
    baselineHeaderConsumedTombstone: headerTombstone,
    baselineHeaderPublicationReceipt: checked.headerReceipt,
    connection: state.connection,
    migration0002ConsumedTombstone: migrationTombstone,
    migration0002Receipt: checked.migrationReceipt,
    mintCount: 1 as const,
    operationSequenceZeroConsumedTombstone: sequenceTombstone,
    operationSequenceZeroPublicationReceipt: checked.sequenceReceipt,
    postDdlCatalogFence: fence,
    projectionIdentity: state.projectionIdentity,
    projectionReference: state.projectionReference,
    readerCloseCount: 1 as const,
    readerLease,
    readerLeaseLifecycle: "retired" as const,
    readerReDerivedProjectionSha256: reader.rederivedProjection!.projectionSha256,
    receipt: state.receipt,
    retiredB2Fence: mint.retiredB2Fence,
    stage: state.stage,
    targetCatalogSha256: SQLITE_CURSOR_PUBLICATION_TARGET.catalogSha256,
    transactionLineage: state.transactionLineage,
    transfer: state.transfer,
    writeKind: "initial-publication-stage-adoption" as const,
  } satisfies SQLiteCursorInitialStageAdoptionReceiptSnapshot);
  const receiptState: InitialStageAdoptionReceiptState = {
    authority, bundle: objectFreezeIntrinsic([
      checked.migrationReceipt, checked.entriesReceipt, checked.headerReceipt,
      checked.sequenceReceipt,
    ]), connection: state.connection, fence, lifecycle: "pending", readerLease,
    snapshot, stageWatermark: mint.watermark,
  };
  const tombstones: readonly [object, object, object, object] = [
    migrationTombstone as object, entriesTombstone as object,
    headerTombstone as object, sequenceTombstone as object,
  ];
  const originals: readonly [object, object, object, object] = [
    checked.migrationReceipt as object, checked.entriesReceipt as object,
    checked.headerReceipt as object, checked.sequenceReceipt as object,
  ];
  reflectApplyIntrinsic(weakMapSetIntrinsic, INITIAL_STAGE_ADOPTION_RECEIPTS,
    [adoptionReceipt as object, receiptState]);
  for (let index = 0; index < 4; index += 1) {
    reflectApplyIntrinsic(weakMapSetIntrinsic, INITIAL_STAGE_CONSUMED_TOMBSTONES, [
      tombstones[index]!, { adoptionReceipt, lifecycle: "pending", receipt: originals[index]! },
    ]);
  }
  try {
    publishSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic(mint.tail);
    reflectApplyIntrinsic(weakMapSetIntrinsic, MIGRATION_0002_RECEIPT_CONSUMPTIONS,
      [checked.migrationReceipt as object, migrationTombstone]);
    reflectApplyIntrinsic(weakMapSetIntrinsic, BASELINE_ENTRIES_RECEIPT_CONSUMPTIONS,
      [checked.entriesReceipt as object, entriesTombstone]);
    reflectApplyIntrinsic(weakMapSetIntrinsic, BASELINE_HEADER_RECEIPT_CONSUMPTIONS,
      [checked.headerReceipt as object, headerTombstone]);
    reflectApplyIntrinsic(weakMapSetIntrinsic, OPERATION_SEQUENCE_ZERO_RECEIPT_CONSUMPTIONS,
      [checked.sequenceReceipt as object, sequenceTombstone]);
    state.migration0002ConsumedTombstone = migrationTombstone;
    state.baselineEntriesConsumedTombstone = entriesTombstone;
    state.baselineHeaderConsumedTombstone = headerTombstone;
    state.operationSequenceZeroConsumedTombstone = sequenceTombstone;
    for (let index = 0; index < 4; index += 1) {
      const tombstoneState = reflectApplyIntrinsic(
        weakMapGetIntrinsic, INITIAL_STAGE_CONSUMED_TOMBSTONES, [tombstones[index]!],
      ) as ConsumedTombstoneState;
      tombstoneState.lifecycle = "active";
    }
    state.receiptConsumptionCount = 4;
    state.tombstoneMintCount = 4;
    receiptState.lifecycle = "active";
    state.initialStageAdoptionReceipt = adoptionReceipt;
    state.initialStageAdoptionReceiptMintCount = 1;
    state.writePhase = "initial-stage-adoption-complete";
    return adoptionReceipt;
  } catch (error) {
    poisonAuthorityGraph(state, authority, "SQLite initial publication stage adoption tail failed");
    throw error;
  }
}

export function assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  bundle: SQLiteCursorInitialPublicationReceiptBundle,
  fence: SQLiteCursorPostDdlCatalogFence,
  readerLease: SQLiteCursorPostDdlPublicationReaderLease,
  receipt: SQLiteCursorInitialStageAdoptionReceipt,
): SQLiteCursorInitialStageAdoptionReceipt {
  const checked = checkedInitialPublicationBundlePresentationIntrinsic(
    authority, bundle, fence, readerLease,
  );
  const state = authorityState(authority);
  const record = receipt !== null && typeof receipt === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, INITIAL_STAGE_ADOPTION_RECEIPTS,
      [receipt as object]) as InitialStageAdoptionReceiptState | undefined
    : undefined;
  if (record === undefined || record.lifecycle !== "active" || record.authority !== authority
      || record.fence !== fence || record.readerLease !== readerLease
      || record.bundle[0] !== checked.migrationReceipt
      || record.bundle[1] !== checked.entriesReceipt || record.bundle[2] !== checked.headerReceipt
      || record.bundle[3] !== checked.sequenceReceipt) {
    return initialAdoptionCorruption(
      state, authority, "SQLite initial stage adoption receipt was substituted",
    );
  }
  const snapshot = record.snapshot;
  try {
    if (state.writePhase === "publication-active") {
      if (state.publicationSession === undefined) {
        fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session identity drifted");
      }
      assertSQLiteCursorStageOwnershipPublicationSessionActiveIntrinsic(
        state.transfer, authority, receipt, state.publicationSession,
      );
    } else {
      assertSQLiteCursorStageOwnershipInitialPublicationAdoptedIntrinsic(
        state.connection, state.stage, state.receipt, state.projectionIdentity, state.transfer,
        authority, readerLease, snapshot.retiredB2Fence, record.stageWatermark,
      );
    }
    let clockTransactionLineage: SQLiteConnectionTransactionLineage;
    if (state.writePhase === "publication-active") {
      const session = state.publicationSession;
      const publication = session === undefined ? undefined : reflectApplyIntrinsic(
        weakMapGetIntrinsic, PUBLICATION_SESSIONS, [session as object],
      ) as PublicationSessionState | undefined;
      if (publication === undefined || publication.lifecycle !== "publication-active"
          || publication.adoptionReceipt !== receipt
          || publication.consumedTombstone === undefined) {
        fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session clock identity drifted");
      }
      const clock = assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic(
        state.connection,
        state.migrationLockCapability,
        state.providerClockCapability,
        state.outerClockEvidence,
        state.outerClockConsumedTombstone!,
        publication.snapshotBase.preRebindClockEvidence,
        publication.consumedTombstone,
      );
      const expectedLock = publication.snapshotBase.migrationLockIdentity;
      if (clock.transactionEpoch !== state.currentTransactionEpoch
          || clock.totalChanges !== state.currentTotalChanges
          || clock.migrationLock.lockId !== expectedLock.lockId
          || clock.migrationLock.ownerId !== expectedLock.ownerId
          || clock.migrationLock.lockEpoch !== expectedLock.lockEpoch
          || clock.migrationLock.fencingToken !== expectedLock.fencingToken
          || clock.migrationLock.activeExpiresAtMs !== expectedLock.activeExpiresAtMs
          || clock.migrationLock.sourceSchemaVersion !== expectedLock.sourceSchemaVersion
          || clock.migrationLock.targetSchemaVersion !== expectedLock.targetSchemaVersion) {
        fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session clock graph drifted");
      }
      clockTransactionLineage = clock.transactionLineage;
    } else {
      clockTransactionLineage = assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic(
        state.connection, state.migrationLockCapability, state.providerClockCapability,
        state.outerClockEvidence, state.outerClockConsumedTombstone!,
      ).transactionLineage;
    }
    const owner = readSQLiteConnectionOwnerSnapshot(state.connection);
    const changes = readSQLiteConnectionTotalChangesSnapshot(state.connection);
    if (!owner.isTransaction || owner.transactionMode !== "exclusive"
        || owner.transactionLineage !== state.transactionLineage
        || clockTransactionLineage !== state.transactionLineage
        || owner.transactionEpoch !== snapshot.adoptedTransactionEpoch
        || changes.transactionEpoch !== owner.transactionEpoch
        || changes.totalChanges !== snapshot.adoptedTotalChanges
        || state.lifecycle !== "active"
        || (state.writePhase !== "initial-stage-adoption-complete"
          && state.writePhase !== "publication-active")
        || state.initialStageAdoptionReceipt !== receipt
        || state.initialStageAdoptionReceiptMintCount !== 1
        || state.receiptConsumptionCount !== 4 || state.tombstoneMintCount !== 4
        || !exactLedger(outerLedgerSnapshot(state), snapshot.adoptedOuterLedger)) {
      return initialAdoptionCorruption(state, authority, "SQLite initial stage adoption receipt graph drifted");
    }
    const pairs: readonly [object, object][] = [
      [snapshot.migration0002ConsumedTombstone as object, checked.migrationReceipt as object],
      [snapshot.baselineEntriesConsumedTombstone as object, checked.entriesReceipt as object],
      [snapshot.baselineHeaderConsumedTombstone as object, checked.headerReceipt as object],
      [snapshot.operationSequenceZeroConsumedTombstone as object, checked.sequenceReceipt as object],
    ];
    for (let index = 0; index < pairs.length; index += 1) {
      const pair = pairs[index]!;
      assertActiveConsumedTombstoneIntrinsic(pair[0], pair[1], receipt);
    }
    return receipt;
  } catch (error) {
    if (state.writePhase === "publication-active") {
      poisonAuthorityGraph(
        state, authority, "SQLite publication session adoption receipt validation failed",
      );
    } else {
      terminateAfterInvariantFailure(state, authority, error,
        "SQLite initial stage adoption receipt validation failed");
    }
    throw error;
  }
}

function selectedInitialAdoptionRecord(
  state: AuthorityState,
  authority: SQLiteCursorOuterPublicationAuthority,
  adoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt,
): InitialStageAdoptionReceiptState {
  const record = adoptionReceipt !== null && typeof adoptionReceipt === "object"
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic,
      INITIAL_STAGE_ADOPTION_RECEIPTS,
      [adoptionReceipt as object],
    ) as InitialStageAdoptionReceiptState | undefined
    : undefined;
  if (record === undefined || record.lifecycle !== "active"
      || record.authority !== authority
      || state.initialStageAdoptionReceipt !== adoptionReceipt
      || state.initialStageAdoptionReceiptMintCount !== 1) {
    poisonAuthorityGraph(
      state, authority, "SQLite publication session adoption receipt was substituted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite publication session adoption receipt is invalid",
    );
  }
  return record;
}

/** Reprove every retained adoption identity without issuing any SQL. */
function assertSQLiteCursorPublicationSessionAdoptionRetainedGraphIntrinsic(
  state: AuthorityState,
  authority: SQLiteCursorOuterPublicationAuthority,
  receipt: SQLiteCursorInitialStageAdoptionReceipt,
  adoption: InitialStageAdoptionReceiptState,
): PostDdlCatalogFenceState {
  const checked = checkedInitialPublicationBundlePresentationIntrinsic(
    authority, adoption.bundle, adoption.fence, adoption.readerLease,
  );
  const snapshot = adoption.snapshot;
  const fence = postDdlCatalogFenceState(adoption.fence);
  const reader = postDdlPublicationReaderLeaseState(adoption.readerLease);
  if (snapshot.authority !== authority
      || snapshot.connection !== state.connection
      || snapshot.stage !== state.stage
      || snapshot.receipt !== state.receipt
      || snapshot.projectionIdentity !== state.projectionIdentity
      || snapshot.projectionReference !== state.projectionReference
      || snapshot.transfer !== state.transfer
      || snapshot.transactionLineage !== state.transactionLineage
      || snapshot.migration0002Receipt !== checked.migrationReceipt
      || snapshot.baselineEntriesPublicationReceipt !== checked.entriesReceipt
      || snapshot.baselineHeaderPublicationReceipt !== checked.headerReceipt
      || snapshot.operationSequenceZeroPublicationReceipt !== checked.sequenceReceipt
      || snapshot.postDdlCatalogFence !== adoption.fence
      || snapshot.readerLease !== adoption.readerLease
      || snapshot.readerLeaseLifecycle !== "retired"
      || snapshot.readerCloseCount !== 1
      || snapshot.mintCount !== 1
      || snapshot.writeKind !== "initial-publication-stage-adoption"
      || state.receiptConsumptionCount !== 4
      || state.tombstoneMintCount !== 4
      || state.migration0002ConsumedTombstone !== snapshot.migration0002ConsumedTombstone
      || state.baselineEntriesConsumedTombstone !== snapshot.baselineEntriesConsumedTombstone
      || state.baselineHeaderConsumedTombstone !== snapshot.baselineHeaderConsumedTombstone
      || state.operationSequenceZeroConsumedTombstone
        !== snapshot.operationSequenceZeroConsumedTombstone
      || fence.authority !== authority
      || fence.connection !== state.connection
      || fence.migration0002Receipt !== checked.migrationReceipt
      || reader.authority !== authority
      || reader.connection !== state.connection
      || reader.stage !== state.stage
      || reader.transfer !== state.transfer
      || reader.fence !== adoption.fence
      || reader.migration0002Receipt !== checked.migrationReceipt
      || reader.projectionIdentity !== state.projectionIdentity
      || reader.projectionReference !== state.projectionReference
      || reader.transactionLineage !== state.transactionLineage
      || reader.lifecycle !== "retired"
      || reader.closeAttemptCount !== 1
      || !reader.closeSucceeded
      || reader.prepareCount !== 1
      || reader.executeCount !== 1
      || reader.ownershipAcquisitionCount !== 1
      || reader.rederivedProjection === undefined
      || reader.rederivedProjection.projectionSha256
        !== snapshot.readerReDerivedProjectionSha256) {
    fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session adoption graph drifted");
  }
  const pairs: readonly [object, object][] = [
    [snapshot.migration0002ConsumedTombstone as object, checked.migrationReceipt as object],
    [snapshot.baselineEntriesConsumedTombstone as object, checked.entriesReceipt as object],
    [snapshot.baselineHeaderConsumedTombstone as object, checked.headerReceipt as object],
    [snapshot.operationSequenceZeroConsumedTombstone as object, checked.sequenceReceipt as object],
  ];
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!;
    assertActiveConsumedTombstoneIntrinsic(pair[0], pair[1], receipt);
  }
  return fence;
}

/** Bind one exact future session owner to the adopted graph. */
export function prepareSQLiteCursorPublicationSessionIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
  adoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt,
): SQLiteCursorPublicationSessionPreparedOwner {
  const state = authorityState(authority);
  if (state.lifecycle !== "active"
      || state.writePhase !== "initial-stage-adoption-complete"
      || state.publicationSession !== undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite publication session graph is not ready");
  }
  const adoption = selectedInitialAdoptionRecord(state, authority, adoptionReceipt);
  const existing = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    PUBLICATION_PREPARED_BY_AUTHORITY,
    [authority as object],
  ) as SQLiteCursorPublicationSessionPreparedOwner | undefined;
  if (existing !== undefined) {
    const prepared = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_PREPARED, [existing as object],
    ) as PublicationPreparedState | undefined;
    if (prepared === undefined || prepared.lifecycle !== "prepared"
        || prepared.authority !== authority
        || prepared.adoptionReceipt !== adoptionReceipt
        || state.publicationPreparedOwner !== existing) {
      poisonAuthorityGraph(state, authority, "SQLite publication session preparation drifted");
      return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session preparation is invalid");
    }
    return existing;
  }

  try {
    assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
      authority, adoption.bundle, adoption.fence, adoption.readerLease, adoptionReceipt,
    );
    const preparedOwner = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteCursorPublicationSessionPreparedOwner;
    const lowerTail = prepareSQLiteCursorStageOwnershipPublicationSessionIntrinsic(
      state.connection,
      state.stage,
      state.receipt,
      state.projectionIdentity,
      state.transfer,
      authority,
      adoptionReceipt,
      preparedOwner,
    );
    const prepared: PublicationPreparedState = {
      adoptionReceipt,
      authority,
      lifecycle: "prepared",
      lowerTail,
      observedEvidence: undefined,
    };
    reflectApplyIntrinsic(weakMapSetIntrinsic, PUBLICATION_PREPARED, [
      preparedOwner as object,
      prepared,
    ]);
    reflectApplyIntrinsic(weakMapSetIntrinsic, PUBLICATION_PREPARED_BY_AUTHORITY, [
      authority as object,
      preparedOwner,
    ]);
    state.publicationPreparedOwner = preparedOwner;
    return preparedOwner;
  } catch (error) {
    poisonAuthorityGraph(state, authority, "SQLite publication session preparation failed");
    throw error;
  }
}

function publicationPreparedState(
  preparedOwner: SQLiteCursorPublicationSessionPreparedOwner,
): PublicationPreparedState {
  const prepared = preparedOwner !== null && typeof preparedOwner === "object"
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_PREPARED, [preparedOwner as object],
    ) as PublicationPreparedState | undefined
    : undefined;
  if (prepared === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite publication session owner is invalid");
  }
  return prepared;
}

/** The second provider-clock boundary is observable only through this owner. */
export function observeSQLiteCursorPublicationSessionClockIntrinsic(
  preparedOwner: SQLiteCursorPublicationSessionPreparedOwner,
): SQLiteCursorProviderClockEvidence {
  const prepared = publicationPreparedState(preparedOwner);
  const state = authorityState(prepared.authority);
  if (prepared.lifecycle !== "prepared"
      || state.lifecycle !== "active"
      || state.writePhase !== "initial-stage-adoption-complete"
      || state.publicationPreparedOwner !== preparedOwner
      || prepared.observedEvidence !== undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite publication session owner is not observable");
  }
  const adoption = selectedInitialAdoptionRecord(
    state, prepared.authority, prepared.adoptionReceipt,
  );
  try {
    assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
      prepared.authority,
      adoption.bundle,
      adoption.fence,
      adoption.readerLease,
      prepared.adoptionReceipt,
    );
    assertSQLiteCursorStageOwnershipPublicationSessionPreparedIntrinsic(
      state.transfer,
      prepared.authority,
      prepared.adoptionReceipt,
      preparedOwner,
      prepared.lowerTail!,
    );
    const evidence = observeSQLiteCursorProviderClockIntrinsic(
      state.providerClockCapability,
      "before-cursor-rebind",
    );
    const clock = assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
      state.connection,
      state.migrationLockCapability,
      state.providerClockCapability,
      state.outerClockEvidence,
      state.outerClockConsumedTombstone!,
      evidence,
    );
    if (clock.transactionLineage !== state.transactionLineage
        || clock.transactionEpoch !== state.currentTransactionEpoch
        || clock.totalChanges !== state.currentTotalChanges) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session clock evidence drifted");
    }
    prepared.observedEvidence = evidence;
    return evidence;
  } catch (error) {
    poisonAuthorityGraph(state, prepared.authority, "SQLite publication session clock failed");
    throw error;
  }
}

/**
 * Complete the final synchronous tail after all fallible graph and cancellation
 * checks.  A valid cancellation leaves the same owner/evidence retryable.
 */
export function publishSQLiteCursorPublicationSessionIntrinsic(
  preparedOwner: SQLiteCursorPublicationSessionPreparedOwner,
  evidence: SQLiteCursorProviderClockEvidence,
  cancellation?: SQLiteCursorPublicationSessionCancellationSignal,
): SQLiteCursorPublicationSession {
  let cancellationState: CancellationState | undefined;
  if (cancellation !== undefined) {
    cancellationState = cancellation !== null && typeof cancellation === "object"
      ? reflectApplyIntrinsic(
        weakMapGetIntrinsic, PUBLICATION_CANCELLATIONS, [cancellation as object],
      ) as CancellationState | undefined
      : undefined;
    if (cancellationState === undefined) {
      return fail(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "SQLite publication session cancellation is invalid",
      );
    }
  }
  const prepared = publicationPreparedState(preparedOwner);
  const state = authorityState(prepared.authority);
  if (prepared.lifecycle !== "prepared"
      || state.lifecycle !== "active"
      || state.writePhase !== "initial-stage-adoption-complete"
      || state.publicationPreparedOwner !== preparedOwner
      || prepared.observedEvidence !== evidence) {
    poisonAuthorityGraph(state, prepared.authority, "SQLite publication session evidence was substituted");
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session evidence is invalid");
  }
  const adoption = selectedInitialAdoptionRecord(
    state, prepared.authority, prepared.adoptionReceipt,
  );
  let clock: ReturnType<
    typeof assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic
  >;
  let migrationLockIdentity: Readonly<SQLiteCursorMigrationLockIdentity>;
  try {
    assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
      prepared.authority,
      adoption.bundle,
      adoption.fence,
      adoption.readerLease,
      prepared.adoptionReceipt,
    );
    assertSQLiteCursorStageOwnershipPublicationSessionPreparedIntrinsic(
      state.transfer,
      prepared.authority,
      prepared.adoptionReceipt,
      preparedOwner,
      prepared.lowerTail!,
    );
    clock = assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
      state.connection,
      state.migrationLockCapability,
      state.providerClockCapability,
      state.outerClockEvidence,
      state.outerClockConsumedTombstone!,
      evidence,
    );
    if (clock.transactionLineage !== state.transactionLineage
        || clock.transactionEpoch !== state.currentTransactionEpoch
        || clock.totalChanges !== state.currentTotalChanges) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session clock graph drifted");
    }
    migrationLockIdentity = clock.migrationLock;
  } catch (error) {
    poisonAuthorityGraph(
      state, prepared.authority, "SQLite publication session pre-tail validation failed",
    );
    throw error;
  }
  if (cancellationState?.cancelled === true) {
    return fail("GE_CYCLE_STORE_UNAVAILABLE", "SQLite publication session was cancelled");
  }

  let session: SQLiteCursorPublicationSession;
  let sessionState: PublicationSessionState;
  let lowerTransition: SQLiteCursorStageOwnershipPublicationSessionTransition;
  try {
    session = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteCursorPublicationSession;
    const snapshotBase = objectFreezeIntrinsic({
      connection: state.connection,
      initialStageAdoptionReceipt: prepared.adoptionReceipt,
      migrationLockCapability: state.migrationLockCapability,
      migrationLockIdentity,
      outerAuthority: prepared.authority,
      outerClockEvidence: state.outerClockEvidence,
      outerProviderNowMs: state.outerProviderNowMs,
      postDdlCatalogFence: adoption.fence,
      preRebindClockEvidence: evidence,
      preRebindProviderNowMs: clock.providerNowMs,
      projectionIdentity: state.projectionIdentity,
      projectionReference: state.projectionReference,
      providerClockCapability: state.providerClockCapability,
      receipt: state.receipt,
      sourceDescriptorHash: state.sourceDescriptorHash,
      sourceSchemaIdentitySha256: state.sourceSchemaIdentitySha256,
      stage: state.stage,
      targetDescriptorHash: SQLITE_CURSOR_PUBLICATION_TARGET.descriptorHash,
      targetSchemaIdentitySha256: SQLITE_CURSOR_PUBLICATION_TARGET.schemaIdentitySha256,
      transactionLineage: state.transactionLineage,
      transfer: state.transfer,
    } satisfies PublicationSessionState["snapshotBase"]);
    sessionState = {
      adoptionReceipt: prepared.adoptionReceipt,
      authority: prepared.authority,
      consumedTombstone: undefined,
      rebindConsumedTombstone: undefined,
      lifecycle: "pending",
      preparedOwner,
      snapshotBase,
    };
    lowerTransition = prepareSQLiteCursorStageOwnershipPublicationSessionTransitionIntrinsic(
      state.transfer,
      prepared.authority,
      prepared.adoptionReceipt,
      preparedOwner,
      prepared.lowerTail!,
      session,
    );
    const registrationFault = publicationPendingRegistrationFault;
    publicationPendingRegistrationFault = undefined;
    if (registrationFault !== undefined) throw registrationFault.error;
    reflectApplyIntrinsic(weakMapSetIntrinsic, PUBLICATION_SESSIONS, [
      session as object,
      sessionState,
    ]);
  } catch (error) {
    prepared.lifecycle = "poisoned";
    poisonAuthorityGraph(
      state,
      prepared.authority,
      "SQLite publication session pending allocation failed",
    );
    throw error;
  }

  try {
    // Atomic tail: outer burn -> ownership burn -> stage burn -> evidence
    // consumption -> lower publication -> outer publication -> activation.
    prepared.lifecycle = "published";
    prepared.lowerTail = undefined;
    lowerTransition.burn();
    const tombstone = consumeSQLiteCursorProviderClockEvidenceIntrinsic(
      state.providerClockCapability, evidence, "cursor-publication-session",
    );
    sessionState.consumedTombstone = tombstone;
    lowerTransition.publish();
    state.publicationSession = session;
    state.writePhase = "publication-active";
    sessionState.lifecycle = "publication-active";
    return session;
  } catch (error) {
    sessionState.lifecycle = "poisoned";
    poisonAuthorityGraph(state, prepared.authority, "SQLite publication session tail failed");
    throw error;
  }
}

/** Repeatable read-only proof of the fully published three-layer session. */
export function assertSQLiteCursorPublicationSessionIntrinsic(
  session: SQLiteCursorPublicationSession,
): SQLiteCursorPublicationSession {
  const publication = session !== null && typeof session === "object"
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_SESSIONS, [session as object],
    ) as PublicationSessionState | undefined
    : undefined;
  if (publication === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite publication session is invalid");
  }
  const state = authorityState(publication.authority);
  if (publication.lifecycle !== "publication-active"
      || publication.consumedTombstone === undefined
      || state.lifecycle !== "active"
      || state.writePhase !== "publication-active"
      || state.publicationSession !== session
      || state.publicationPreparedOwner !== publication.preparedOwner) {
    poisonAuthorityGraph(state, publication.authority, "SQLite publication session identity drifted");
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session is not active");
  }
  const adoption = selectedInitialAdoptionRecord(
    state, publication.authority, publication.adoptionReceipt,
  );
  try {
    assertSQLiteCursorStageOwnershipPublicationSessionActiveIntrinsic(
      state.transfer, publication.authority, publication.adoptionReceipt, session,
    );
    const fence = assertSQLiteCursorPublicationSessionAdoptionRetainedGraphIntrinsic(
      state, publication.authority, publication.adoptionReceipt, adoption,
    );
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(state.connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(state.connection);
    const retainedClock = assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic(
      state.connection,
      state.migrationLockCapability,
      state.providerClockCapability,
      state.outerClockEvidence,
      state.outerClockConsumedTombstone!,
      publication.snapshotBase.preRebindClockEvidence,
      publication.consumedTombstone,
    );
    const catalog = readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      state.connection,
    );
    const ownerAfter = readSQLiteConnectionOwnerSnapshot(state.connection);
    const changesAfter = readSQLiteConnectionTotalChangesSnapshot(state.connection);
    const adoptionSnapshot = adoption.snapshot;
    const sessionSnapshot = publication.snapshotBase;
    if (sessionSnapshot.connection !== state.connection
        || sessionSnapshot.initialStageAdoptionReceipt !== publication.adoptionReceipt
        || sessionSnapshot.migrationLockCapability !== state.migrationLockCapability
        || sessionSnapshot.outerAuthority !== publication.authority
        || sessionSnapshot.outerClockEvidence !== state.outerClockEvidence
        || sessionSnapshot.postDdlCatalogFence !== adoption.fence
        || sessionSnapshot.projectionIdentity !== state.projectionIdentity
        || sessionSnapshot.projectionReference !== state.projectionReference
        || sessionSnapshot.providerClockCapability !== state.providerClockCapability
        || sessionSnapshot.receipt !== state.receipt
        || sessionSnapshot.sourceDescriptorHash !== state.sourceDescriptorHash
        || sessionSnapshot.sourceSchemaIdentitySha256 !== state.sourceSchemaIdentitySha256
        || sessionSnapshot.stage !== state.stage
        || sessionSnapshot.targetDescriptorHash
          !== SQLITE_CURSOR_PUBLICATION_TARGET.descriptorHash
        || sessionSnapshot.targetSchemaIdentitySha256
          !== SQLITE_CURSOR_PUBLICATION_TARGET.schemaIdentitySha256
        || sessionSnapshot.transactionLineage !== state.transactionLineage
        || sessionSnapshot.transfer !== state.transfer
        || retainedClock.transactionLineage !== state.transactionLineage
        || retainedClock.transactionEpoch !== state.currentTransactionEpoch
        || retainedClock.totalChanges !== state.currentTotalChanges
        || retainedClock.migrationLock.lockId !== sessionSnapshot.migrationLockIdentity.lockId
        || retainedClock.migrationLock.ownerId !== sessionSnapshot.migrationLockIdentity.ownerId
        || retainedClock.migrationLock.lockEpoch
          !== sessionSnapshot.migrationLockIdentity.lockEpoch
        || retainedClock.migrationLock.fencingToken
          !== sessionSnapshot.migrationLockIdentity.fencingToken
        || retainedClock.migrationLock.activeExpiresAtMs
          !== sessionSnapshot.migrationLockIdentity.activeExpiresAtMs
        || retainedClock.migrationLock.sourceSchemaVersion
          !== sessionSnapshot.migrationLockIdentity.sourceSchemaVersion
        || retainedClock.migrationLock.targetSchemaVersion
          !== sessionSnapshot.migrationLockIdentity.targetSchemaVersion
        || ownerBefore.transactionLineage !== state.transactionLineage
        || ownerAfter.transactionLineage !== ownerBefore.transactionLineage
        || ownerBefore.transactionEpoch !== adoptionSnapshot.adoptedTransactionEpoch
        || ownerAfter.transactionEpoch !== ownerBefore.transactionEpoch
        || changesBefore.transactionEpoch !== ownerBefore.transactionEpoch
        || changesAfter.transactionEpoch !== ownerAfter.transactionEpoch
        || changesBefore.totalChanges !== adoptionSnapshot.adoptedTotalChanges
        || changesAfter.totalChanges !== changesBefore.totalChanges
        || !exactLedger(outerLedgerSnapshot(state), adoptionSnapshot.adoptedOuterLedger)
        || adoption.fence !== sessionSnapshot.postDdlCatalogFence
        || fence.snapshot.catalogSha256 !== adoptionSnapshot.targetCatalogSha256
        || catalog.catalogSha256 !== fence.snapshot.catalogSha256
        || catalog.canonicalUtf8Bytes !== fence.snapshot.catalogCanonicalUtf8Bytes
        || catalog.rowCount !== fence.snapshot.catalogRowCount
        || catalog.applicationId !== fence.snapshot.applicationId
        || catalog.userVersion !== fence.snapshot.userVersion) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session retained graph drifted");
    }
    return session;
  } catch (error) {
    poisonAuthorityGraph(
      state, publication.authority, "SQLite publication session validation failed",
    );
    throw error;
  }
}

export function readSQLiteCursorPublicationSessionSnapshotIntrinsic(
  session: SQLiteCursorPublicationSession,
): SQLiteCursorPublicationSessionSnapshot {
  assertSQLiteCursorPublicationSessionIntrinsic(session);
  const publication = reflectApplyIntrinsic(
    weakMapGetIntrinsic, PUBLICATION_SESSIONS, [session as object],
  ) as PublicationSessionState;
  return objectFreezeIntrinsic({
    ...publication.snapshotBase,
    lifecycle: "publication-active",
    preRebindClockConsumedTombstone: publication.consumedTombstone!,
  });
}

function mintPublicationRebindOpaqueIntrinsic<T>(): T {
  return objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as T;
}

function publicationRebindContextState(
  context: SQLiteCursorPublicationRebindContext,
): PublicationRebindContextState {
  const selected = context !== null && typeof context === "object" && !isProxyIntrinsic(context)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, PUBLICATION_REBIND_CONTEXTS, [context as object]) as
      PublicationRebindContextState | undefined
    : undefined;
  if (selected === undefined || selected.token !== context) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite publication rebind context is invalid");
  }
  return selected;
}

function publicationSessionConsumedTombstoneState(
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone,
): PublicationSessionConsumedTombstoneState {
  const selected = tombstone !== null && typeof tombstone === "object"
      && !isProxyIntrinsic(tombstone)
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_SESSION_CONSUMED_TOMBSTONES, [tombstone as object],
    ) as PublicationSessionConsumedTombstoneState | undefined
    : undefined;
  if (selected === undefined || selected.token !== tombstone) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication session consumed tombstone is invalid",
    );
  }
  return selected;
}

function postRebindWatermarkAdoptionState(
  adoption: SQLiteCursorPostRebindWatermarkAdoption,
): PostRebindWatermarkAdoptionState {
  const selected = adoption !== null && typeof adoption === "object" && !isProxyIntrinsic(adoption)
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic, POST_REBIND_WATERMARK_ADOPTIONS, [adoption as object],
    ) as PostRebindWatermarkAdoptionState | undefined
    : undefined;
  if (selected === undefined || selected.token !== adoption) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-rebind watermark adoption is invalid",
    );
  }
  return selected;
}

function safePublicationRebindCount(value: number, label: string): number {
  if (!numberIsSafeIntegerIntrinsic(value) || value < 0) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      `SQLite publication rebind ${label} is invalid`,
    );
  }
  return value;
}

function exactPublicationRebindParameterOrder(
  value: SQLiteConnectionCursorRebindExecutionSnapshot["parameterOrder"],
): boolean {
  return value.length === 4
    && value[0] === SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC[0]
    && value[1] === SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC[1]
    && value[2] === SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC[2]
    && value[3] === SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC[3];
}

function exactPublicationRebindParameters(
  value: SQLiteConnectionCursorRebindExecutionSnapshot["parameterValues"],
  context: PublicationRebindContextState,
): boolean {
  return value !== null && value.length === 4
    && value[0] === context.targetDescriptorHash
    && value[1] === context.targetSchemaIdentitySha256
    && value[2] === context.sourceDescriptorHash
    && value[3] === context.sourceSchemaIdentitySha256;
}

function retainedPreparedPublicationRebindSnapshotIsExact(
  snapshot: SQLiteConnectionCursorRebindExecutionSnapshot,
  context: PublicationRebindContextState,
): boolean {
  return objectIsFrozenIntrinsic(snapshot)
    && snapshot.lifecycle === "active"
    && !snapshot.statementOwnershipRetired
    && snapshot.prepareCount === 1
    && snapshot.executeCount === 0
    && snapshot.releaseCount === 0
    && snapshot.changesPrepareCount === 0
    && snapshot.changesFetchCount === 0
    && snapshot.changesReleaseCount === 0
    && snapshot.affectedRows === 0
    && snapshot.changesAffectedRows === null
    && snapshot.cursorLedgerLogicalWriteSequence === 0
    && snapshot.cursorLedgerFixedStatementCount === 0
    && snapshot.cursorLedgerAffectedRowsWatermark === 0
    && snapshot.parameterValues === null
    && snapshot.sql === SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC
    && snapshot.sqlSha256 === SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC
    && exactPublicationRebindParameterOrder(snapshot.parameterOrder)
    && snapshot.changesSql === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
    && snapshot.changesSqlSha256 === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC
    && snapshot.transactionLineage === context.transactionLineage
    && snapshot.transactionEpoch === context.historicalTransactionEpoch
    && snapshot.totalChangesBefore === context.historicalTotalChanges
    && snapshot.totalChangesAfter === context.historicalTotalChanges
    && snapshot.totalChangesDelta === 0;
}

function readPreparedPublicationRebindExecutionIntrinsic(
  state: AuthorityState,
  authority: SQLiteCursorOuterPublicationAuthority,
  execution: SQLiteConnectionCursorRebindExecution,
): SQLiteConnectionCursorRebindExecutionSnapshot {
  let hasPrimary = false;
  let primary: unknown;
  let snapshot: SQLiteConnectionCursorRebindExecutionSnapshot | undefined;
  try {
    snapshot = readSQLiteConnectionCursorRebindExecutionSnapshotVerifierIntrinsic(
      state.connection,
      execution,
    );
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  if (hasPrimary) {
    poisonAuthorityGraph(
      state,
      authority,
      "SQLite prepared publication rebind execution validation failed",
    );
    throw primary;
  }
  return snapshot!;
}

function preparedPublicationRebindSnapshotIsExact(
  snapshot: SQLiteConnectionCursorRebindExecutionSnapshot,
  state: AuthorityState,
): boolean {
  return objectIsFrozenIntrinsic(snapshot)
    && snapshot.lifecycle === "active"
    && !snapshot.statementOwnershipRetired
    && snapshot.prepareCount === 1
    && snapshot.executeCount === 0
    && snapshot.releaseCount === 0
    && snapshot.changesPrepareCount === 0
    && snapshot.changesFetchCount === 0
    && snapshot.changesReleaseCount === 0
    && snapshot.affectedRows === 0
    && snapshot.changesAffectedRows === null
    && snapshot.cursorLedgerLogicalWriteSequence === 0
    && snapshot.cursorLedgerFixedStatementCount === 0
    && snapshot.cursorLedgerAffectedRowsWatermark === 0
    && snapshot.parameterValues === null
    && snapshot.sql === SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC
    && snapshot.sqlSha256 === SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC
    && exactPublicationRebindParameterOrder(snapshot.parameterOrder)
    && snapshot.changesSql === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
    && snapshot.changesSqlSha256 === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC
    && snapshot.transactionLineage === state.transactionLineage
    && snapshot.transactionEpoch === state.currentTransactionEpoch
    && snapshot.totalChangesBefore === state.currentTotalChanges
    && snapshot.totalChangesAfter === state.currentTotalChanges
    && snapshot.totalChangesDelta === 0;
}

/**
 * Freeze the exact active-session predecessor after the orchestrator has begun
 * one authentic, still-unexecuted connection rebind E.
 */
export function prepareSQLiteCursorPublicationRebindContextIntrinsic(
  session: SQLiteCursorPublicationSession,
  execution: SQLiteConnectionCursorRebindExecution,
): SQLiteCursorPublicationRebindContext {
  assertSQLiteCursorPublicationSessionIntrinsic(session);
  const publication = reflectApplyIntrinsic(
    weakMapGetIntrinsic, PUBLICATION_SESSIONS, [session as object],
  ) as PublicationSessionState;
  const state = authorityState(publication.authority);
  const existingSessionContext = reflectApplyIntrinsic(
    weakMapGetIntrinsic, PUBLICATION_REBIND_CONTEXT_BY_SESSION, [session as object],
  ) as SQLiteCursorPublicationRebindContext | undefined;
  if (existingSessionContext !== undefined || state.publicationRebindContext !== undefined) {
    poisonAuthorityGraph(
      state, publication.authority, "SQLite publication rebind context was prepared twice",
    );
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication rebind context was reused");
  }

  const preparedSnapshot = readPreparedPublicationRebindExecutionIntrinsic(
    state,
    publication.authority,
    execution,
  );
  if (!preparedPublicationRebindSnapshotIsExact(preparedSnapshot, state)) {
    poisonAuthorityGraph(
      state, publication.authority, "SQLite prepared publication rebind execution drifted",
    );
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite prepared publication rebind execution is invalid",
    );
  }
  const owner = readSQLiteConnectionOwnerSnapshot(state.connection);
  const total = readSQLiteConnectionTotalChangesSnapshot(state.connection);
  const provenance = assertSQLiteCursorPreRebindReceiptProvenance(state.receipt);
  const historicalOuterLedger = outerLedgerSnapshot(state);
  const b2CursorCount = safePublicationRebindCount(
    provenance.sealReceipt.cursorCount,
    "B2 cursor count",
  );
  if (!owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage !== state.transactionLineage
      || owner.transactionEpoch !== state.currentTransactionEpoch
      || total.transactionEpoch !== owner.transactionEpoch
      || total.totalChanges !== state.currentTotalChanges
      || publication.lifecycle !== "publication-active"
      || publication.rebindConsumedTombstone !== undefined
      || state.writePhase !== "publication-active"
      || state.publicationSession !== session
      || provenance.projectionIdentity !== state.projectionIdentity
      || provenance.projectionReference !== state.projectionReference
      || provenance.sealReceipt.sourceDescriptorHash !== state.sourceDescriptorHash
      || provenance.sealReceipt.sourceSchemaIdentitySha256
        !== state.sourceSchemaIdentitySha256) {
    poisonAuthorityGraph(
      state, publication.authority, "SQLite publication rebind predecessor graph drifted",
    );
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication rebind predecessor is invalid");
  }

  const preparedOwner =
    mintPublicationRebindOpaqueIntrinsic<SQLiteCursorPublicationRebindPreparedOwner>();
  const token = mintPublicationRebindOpaqueIntrinsic<SQLiteCursorPublicationRebindContext>();
  const parameterValues = objectFreezeIntrinsic([
    SQLITE_CURSOR_PUBLICATION_TARGET.descriptorHash,
    SQLITE_CURSOR_PUBLICATION_TARGET.schemaIdentitySha256,
    state.sourceDescriptorHash,
    state.sourceSchemaIdentitySha256,
  ] as const);
  const context: PublicationRebindContextState = {
    adoption: undefined,
    authority: publication.authority,
    b2CursorCount,
    b2ImmutableRootSha256: provenance.sealReceipt.immutableRootSha256,
    connection: state.connection,
    execution,
    historicalOuterLedger,
    historicalTotalChanges: state.currentTotalChanges,
    historicalTransactionEpoch: state.currentTransactionEpoch,
    lifecycle: "prepared",
    parameterValues,
    preRebindReceiptSha256: provenance.receiptSha256,
    preparedExecutionSnapshot: preparedSnapshot,
    preparedOwner,
    receipt: state.receipt,
    session,
    sourceDescriptorHash: state.sourceDescriptorHash,
    sourceSchemaIdentitySha256: state.sourceSchemaIdentitySha256,
    targetDescriptorHash: SQLITE_CURSOR_PUBLICATION_TARGET.descriptorHash,
    targetSchemaIdentitySha256: SQLITE_CURSOR_PUBLICATION_TARGET.schemaIdentitySha256,
    token,
    tombstone: undefined,
    transactionLineage: state.transactionLineage,
  };
  let hasPrimary = false;
  let primary: unknown;
  try {
    reflectApplyIntrinsic(weakMapSetIntrinsic, PUBLICATION_REBIND_CONTEXTS, [
      token as object, context,
    ]);
    throwSQLiteCursorPublicationRebindRegistrationFaultIntrinsic("context-primary");
    reflectApplyIntrinsic(weakMapSetIntrinsic, PUBLICATION_REBIND_CONTEXT_BY_SESSION, [
      session as object, token,
    ]);
    throwSQLiteCursorPublicationRebindRegistrationFaultIntrinsic("context-session");
    reflectApplyIntrinsic(weakMapSetIntrinsic, PUBLICATION_REBIND_CONTEXT_BY_PREPARED_OWNER, [
      preparedOwner as object, token,
    ]);
    throwSQLiteCursorPublicationRebindRegistrationFaultIntrinsic("context-prepared-owner");
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  if (hasPrimary) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, PUBLICATION_REBIND_CONTEXTS, [token as object]);
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, PUBLICATION_REBIND_CONTEXT_BY_SESSION, [
      session as object,
    ]);
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, PUBLICATION_REBIND_CONTEXT_BY_PREPARED_OWNER, [
      preparedOwner as object,
    ]);
    throw primary;
  }
  state.publicationRebindContext = token;
  return token;
}

export function assertSQLiteCursorPublicationRebindPreparedOwnerIdentityIntrinsic(
  preparedOwner: SQLiteCursorPublicationRebindPreparedOwner,
  contextToken: SQLiteCursorPublicationRebindContext,
): SQLiteCursorPublicationRebindPreparedOwner {
  const context = publicationRebindContextState(contextToken);
  const selected = preparedOwner !== null && typeof preparedOwner === "object"
      && !isProxyIntrinsic(preparedOwner)
    ? reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_REBIND_CONTEXT_BY_PREPARED_OWNER,
      [preparedOwner as object],
    ) as SQLiteCursorPublicationRebindContext | undefined
    : undefined;
  if (selected !== contextToken || context.preparedOwner !== preparedOwner) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication rebind prepared owner is invalid",
    );
  }
  return preparedOwner;
}

export function assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic(
  preparedOwner: SQLiteCursorPublicationRebindPreparedOwner,
  contextToken: SQLiteCursorPublicationRebindContext,
): SQLiteCursorPublicationRebindPreparedOwner {
  assertSQLiteCursorPublicationRebindPreparedOwnerIdentityIntrinsic(
    preparedOwner,
    contextToken,
  );
  const context = publicationRebindContextState(contextToken);
  const state = authorityState(context.authority);
  if (state.lifecycle !== "active" || state.publicationRebindContext !== contextToken
      || (context.lifecycle !== "prepared"
        && context.lifecycle !== "session-consumed"
        && context.lifecycle !== "write-adopted")) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication rebind prepared owner is not live",
    );
  }
  if (context.lifecycle === "prepared") {
    if (state.writePhase !== "publication-active") {
      return fail(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "SQLite publication rebind prepared owner is not live",
      );
    }
    assertSQLiteCursorPublicationSessionIntrinsic(context.session);
  } else if (context.lifecycle === "session-consumed") {
    assertSQLiteCursorPublicationSessionConsumedTombstoneIntrinsic(context.tombstone!);
  } else {
    assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(context.adoption!);
  }
  return preparedOwner;
}

function snapshotPublicationRebindContext(
  state: PublicationRebindContextState,
): SQLiteCursorPublicationRebindContextSnapshot {
  return objectFreezeIntrinsic({
    b2CursorCount: state.b2CursorCount,
    b2ImmutableRootSha256: state.b2ImmutableRootSha256,
    connection: state.connection,
    execution: state.execution,
    historicalOuterLedger: state.historicalOuterLedger,
    historicalTotalChanges: state.historicalTotalChanges,
    historicalTransactionEpoch: state.historicalTransactionEpoch,
    lifecycle: state.lifecycle,
    outerAuthority: state.authority,
    parameterValues: state.parameterValues,
    preRebindReceiptSha256: state.preRebindReceiptSha256,
    preparedExecutionSnapshot: state.preparedExecutionSnapshot,
    preparedOwner: state.preparedOwner,
    receipt: state.receipt,
    session: state.session,
    sourceDescriptorHash: state.sourceDescriptorHash,
    sourceSchemaIdentitySha256: state.sourceSchemaIdentitySha256,
    targetDescriptorHash: state.targetDescriptorHash,
    targetSchemaIdentitySha256: state.targetSchemaIdentitySha256,
    transactionLineage: state.transactionLineage,
  });
}

export function readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(
  context: SQLiteCursorPublicationRebindContext,
): SQLiteCursorPublicationRebindContextSnapshot {
  return snapshotPublicationRebindContext(publicationRebindContextState(context));
}

function releasedPublicationRebindSnapshotIsExact(
  snapshot: SQLiteConnectionCursorRebindExecutionSnapshot,
  context: PublicationRebindContextState,
): boolean {
  return objectIsFrozenIntrinsic(snapshot)
    && snapshot.lifecycle === "released"
    && snapshot.statementOwnershipRetired
    && snapshot.prepareCount === 1
    && snapshot.executeCount === 0
    && snapshot.releaseCount === 1
    && snapshot.changesPrepareCount === 0
    && snapshot.changesFetchCount === 0
    && snapshot.changesReleaseCount === 0
    && snapshot.affectedRows === 0
    && snapshot.changesAffectedRows === null
    && snapshot.cursorLedgerLogicalWriteSequence === 0
    && snapshot.cursorLedgerFixedStatementCount === 0
    && snapshot.cursorLedgerAffectedRowsWatermark === 0
    && snapshot.parameterValues === null
    && snapshot.sql === SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC
    && snapshot.sqlSha256 === SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC
    && exactPublicationRebindParameterOrder(snapshot.parameterOrder)
    && snapshot.changesSql === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
    && snapshot.changesSqlSha256 === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC
    && snapshot.transactionLineage === context.transactionLineage
    && snapshot.transactionEpoch === context.historicalTransactionEpoch
    && snapshot.totalChangesBefore === context.historicalTotalChanges
    && snapshot.totalChangesAfter === context.historicalTotalChanges
    && snapshot.totalChangesDelta === 0;
}

/** Release exact prepared E after pre-execute cancellation; S remains active and retryable. */
export function releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(
  contextToken: SQLiteCursorPublicationRebindContext,
  preparedOwner: SQLiteCursorPublicationRebindPreparedOwner,
): void {
  const context = publicationRebindContextState(contextToken);
  assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic(preparedOwner, contextToken);
  const state = authorityState(context.authority);
  if (context.lifecycle !== "prepared" || context.tombstone !== undefined
      || context.adoption !== undefined || state.writePhase !== "publication-active") {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication rebind context is not releasable",
    );
  }
  let hasPrimary = false;
  let primary: unknown;
  try {
    const released = releaseSQLiteConnectionCursorRebindExecutionVerifierIntrinsic(
      context.connection,
      context.execution,
    );
    const owner = readSQLiteConnectionOwnerSnapshot(context.connection);
    const total = readSQLiteConnectionTotalChangesSnapshot(context.connection);
    if (!releasedPublicationRebindSnapshotIsExact(released, context)
        || !owner.isTransaction || owner.transactionMode !== "exclusive"
        || owner.transactionLineage !== context.transactionLineage
        || owner.transactionEpoch !== context.historicalTransactionEpoch
        || total.transactionEpoch !== owner.transactionEpoch
        || total.totalChanges !== context.historicalTotalChanges
        || !exactLedger(outerLedgerSnapshot(state), context.historicalOuterLedger)
        || !reflectApplyIntrinsic(
          weakMapDeleteIntrinsic,
          PUBLICATION_REBIND_CONTEXT_BY_SESSION,
          [context.session as object],
        )) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite released publication rebind context drifted");
    }
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  if (hasPrimary) {
    poisonAuthorityGraph(
      state,
      context.authority,
      "SQLite publication rebind cancellation release failed",
    );
    throw primary;
  }

  // Assignment-only cleanup tail. P/context stay authentic but terminal.
  context.lifecycle = "released-before-write";
  state.publicationRebindContext = undefined;
  return;
}

/**
 * Preallocate T and register every fallible identity edge before the assignment-
 * only tail consumes S. E is still required to be the exact prepared execution.
 */
export function consumeSQLiteCursorPublicationSessionForRebindIntrinsic(
  contextToken: SQLiteCursorPublicationRebindContext,
): SQLiteCursorPublicationSessionConsumedTombstone {
  const context = publicationRebindContextState(contextToken);
  const state = authorityState(context.authority);
  const publication = reflectApplyIntrinsic(
    weakMapGetIntrinsic, PUBLICATION_SESSIONS, [context.session as object],
  ) as PublicationSessionState | undefined;
  if (context.lifecycle !== "prepared" || context.tombstone !== undefined
      || state.publicationRebindContext !== contextToken
      || state.publicationSessionConsumedTombstone !== undefined
      || publication === undefined || publication.authority !== context.authority) {
    poisonAuthorityGraph(state, context.authority, "SQLite publication session consume was reused");
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session consume is terminal");
  }
  try {
    assertSQLiteCursorPublicationSessionIntrinsic(context.session);
    const preparedSnapshot = readSQLiteConnectionCursorRebindExecutionSnapshotVerifierIntrinsic(
      context.connection,
      context.execution,
    );
    const provenance = assertSQLiteCursorPreRebindReceiptProvenance(context.receipt);
    const owner = readSQLiteConnectionOwnerSnapshot(context.connection);
    const total = readSQLiteConnectionTotalChangesSnapshot(context.connection);
    if (!preparedPublicationRebindSnapshotIsExact(context.preparedExecutionSnapshot, state)
        || !preparedPublicationRebindSnapshotIsExact(preparedSnapshot, state)
        || !owner.isTransaction || owner.transactionMode !== "exclusive"
        || owner.transactionLineage !== context.transactionLineage
        || owner.transactionEpoch !== context.historicalTransactionEpoch
        || total.transactionEpoch !== owner.transactionEpoch
        || total.totalChanges !== context.historicalTotalChanges
        || !exactLedger(outerLedgerSnapshot(state), context.historicalOuterLedger)
        || provenance.receiptSha256 !== context.preRebindReceiptSha256
        || provenance.sealReceipt.cursorCount !== context.b2CursorCount
        || provenance.sealReceipt.immutableRootSha256 !== context.b2ImmutableRootSha256) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite publication session consume graph drifted");
    }
  } catch (error) {
    poisonAuthorityGraph(
      state, context.authority, "SQLite publication session consume validation failed",
    );
    throw error;
  }

  const token =
    mintPublicationRebindOpaqueIntrinsic<SQLiteCursorPublicationSessionConsumedTombstone>();
  const consumed: PublicationSessionConsumedTombstoneState = {
    context,
    lifecycle: "active",
    token,
  };
  let hasPrimary = false;
  let primary: unknown;
  try {
    reflectApplyIntrinsic(weakMapSetIntrinsic, PUBLICATION_SESSION_CONSUMED_TOMBSTONES, [
      token as object, consumed,
    ]);
    throwSQLiteCursorPublicationRebindRegistrationFaultIntrinsic("session-tombstone");
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  if (hasPrimary) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, PUBLICATION_SESSION_CONSUMED_TOMBSTONES, [
      token as object,
    ]);
    throw primary;
  }

  // Assignment-only consume tail. No fallible operation may be added below.
  context.tombstone = token;
  context.lifecycle = "session-consumed";
  publication.rebindConsumedTombstone = token;
  publication.lifecycle = "consumed-for-rebind";
  state.publicationSessionConsumedTombstone = token;
  state.writePhase = "publication-session-consumed";
  return token;
}

export function assertSQLiteCursorPublicationSessionConsumedTombstoneIntrinsic(
  tombstoneToken: SQLiteCursorPublicationSessionConsumedTombstone,
): SQLiteCursorPublicationSessionConsumedTombstone {
  const consumed = publicationSessionConsumedTombstoneState(tombstoneToken);
  const context = consumed.context;
  const state = authorityState(context.authority);
  const publication = reflectApplyIntrinsic(
    weakMapGetIntrinsic, PUBLICATION_SESSIONS, [context.session as object],
  ) as PublicationSessionState | undefined;
  const expectedPhase = consumed.lifecycle === "adopted"
    ? "cursor-rebind-adopted"
    : "publication-session-consumed";
  if ((consumed.lifecycle !== "active" && consumed.lifecycle !== "adopted")
      || context.tombstone !== tombstoneToken
      || state.publicationRebindContext !== context.token
      || state.publicationSessionConsumedTombstone !== tombstoneToken
      || state.writePhase !== expectedPhase
      || publication === undefined
      || publication.lifecycle !== "consumed-for-rebind"
      || publication.rebindConsumedTombstone !== tombstoneToken) {
    poisonAuthorityGraph(state, context.authority, "SQLite consumed publication session drifted");
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite publication session consumed tombstone is terminal",
    );
  }
  return tombstoneToken;
}

export function readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic(
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone,
): SQLiteCursorPublicationSessionConsumedTombstoneSnapshot {
  const state = publicationSessionConsumedTombstoneState(tombstone);
  return objectFreezeIntrinsic({
    context: state.context.token,
    execution: state.context.execution,
    preparedExecutionSnapshot: state.context.preparedExecutionSnapshot,
    historicalTotalChanges: state.context.historicalTotalChanges,
    historicalTransactionEpoch: state.context.historicalTransactionEpoch,
    lifecycle: state.lifecycle,
    preparedOwner: state.context.preparedOwner,
    session: state.context.session,
  });
}

function completedPublicationRebindSnapshotIsExact(
  snapshot: SQLiteConnectionCursorRebindExecutionSnapshot,
  context: PublicationRebindContextState,
): boolean {
  const totalChangesDelta = snapshot.totalChangesAfter - snapshot.totalChangesBefore;
  return objectIsFrozenIntrinsic(snapshot)
    && snapshot.lifecycle === "completed"
    && snapshot.statementOwnershipRetired
    && snapshot.prepareCount === 1
    && snapshot.executeCount === 1
    && snapshot.releaseCount === 1
    && snapshot.changesPrepareCount === 1
    && snapshot.changesFetchCount === 1
    && snapshot.changesReleaseCount === 1
    && snapshot.changesAffectedRows !== null
    && snapshot.cursorLedgerLogicalWriteSequence === 1
    && snapshot.cursorLedgerFixedStatementCount === 1
    && snapshot.sql === SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC
    && snapshot.sqlSha256 === SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC
    && exactPublicationRebindParameterOrder(snapshot.parameterOrder)
    && exactPublicationRebindParameters(snapshot.parameterValues, context)
    && snapshot.changesSql === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
    && snapshot.changesSqlSha256 === SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC
    && snapshot.transactionLineage === context.transactionLineage
    && snapshot.transactionEpoch === context.historicalTransactionEpoch + 1n
    && snapshot.totalChangesBefore === context.historicalTotalChanges
    && numberIsSafeIntegerIntrinsic(totalChangesDelta)
    && totalChangesDelta >= 0
    && totalChangesDelta === snapshot.totalChangesDelta
    && totalChangesDelta === snapshot.affectedRows
    && totalChangesDelta === snapshot.changesAffectedRows
    && totalChangesDelta === snapshot.cursorLedgerAffectedRowsWatermark;
}

/** Adopt E1/T1 from the exact completed E and mint immutable A. */
export function adoptSQLiteCursorPostRebindWatermarkIntrinsic(
  contextToken: SQLiteCursorPublicationRebindContext,
  tombstoneToken: SQLiteCursorPublicationSessionConsumedTombstone,
  execution: SQLiteConnectionCursorRebindExecution,
): SQLiteCursorPostRebindWatermarkAdoption {
  const context = publicationRebindContextState(contextToken);
  const consumed = publicationSessionConsumedTombstoneState(tombstoneToken);
  const state = authorityState(context.authority);
  if (context.lifecycle !== "session-consumed" || context.adoption !== undefined
      || context.tombstone !== tombstoneToken || consumed.context !== context
      || consumed.lifecycle !== "active" || execution !== context.execution
      || state.writePhase !== "publication-session-consumed") {
    poisonAuthorityGraph(state, context.authority, "SQLite post-rebind adoption was reused");
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-rebind adoption is terminal");
  }

  let hasPrimary = false;
  let primary: unknown;
  let snapshot: SQLiteConnectionCursorRebindExecutionSnapshot | undefined;
  let currentOuterLedger: SQLiteCursorOuterPublicationLedgerSnapshot | undefined;
  try {
    snapshot = readSQLiteConnectionCursorRebindExecutionSnapshotVerifierIntrinsic(
      context.connection,
      execution,
    );
    const owner = readSQLiteConnectionOwnerSnapshot(context.connection);
    const total = readSQLiteConnectionTotalChangesSnapshot(context.connection);
    const publication = reflectApplyIntrinsic(
      weakMapGetIntrinsic, PUBLICATION_SESSIONS, [context.session as object],
    ) as PublicationSessionState | undefined;
    if (publication === undefined
        || publication.authority !== context.authority
        || publication.adoptionReceipt !== state.initialStageAdoptionReceipt
        || publication.lifecycle !== "consumed-for-rebind"
        || publication.rebindConsumedTombstone !== tombstoneToken
        || publication.snapshotBase.connection !== context.connection
        || publication.snapshotBase.receipt !== context.receipt
        || publication.snapshotBase.projectionIdentity !== state.projectionIdentity
        || publication.snapshotBase.projectionReference !== state.projectionReference
        || publication.snapshotBase.stage !== state.stage
        || publication.snapshotBase.transfer !== state.transfer
        || publication.snapshotBase.migrationLockCapability !== state.migrationLockCapability
        || publication.snapshotBase.providerClockCapability !== state.providerClockCapability
        || publication.snapshotBase.outerClockEvidence !== state.outerClockEvidence
        || publication.snapshotBase.sourceDescriptorHash !== context.sourceDescriptorHash
        || publication.snapshotBase.sourceSchemaIdentitySha256
          !== context.sourceSchemaIdentitySha256
        || publication.snapshotBase.targetDescriptorHash !== context.targetDescriptorHash
        || publication.snapshotBase.targetSchemaIdentitySha256
          !== context.targetSchemaIdentitySha256) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-rebind retained session is invalid");
    }
    assertSQLiteCursorStageOwnershipPublicationSessionActiveIntrinsic(
      state.transfer,
      context.authority,
      publication.adoptionReceipt,
      context.session,
    );
    const clock = assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic(
      context.connection,
      state.migrationLockCapability,
      state.providerClockCapability,
      state.outerClockEvidence,
      state.outerClockConsumedTombstone!,
    );
    const catalog = readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic(
      context.connection,
    );
    const fence = postDdlCatalogFenceState(publication.snapshotBase.postDdlCatalogFence);
    const provenance = assertSQLiteCursorPreRebindReceiptProvenance(context.receipt);
    currentOuterLedger = outerLedgerSnapshot(state);
    if (!completedPublicationRebindSnapshotIsExact(snapshot, context)
        || !owner.isTransaction || owner.transactionMode !== "exclusive"
        || owner.transactionLineage !== context.transactionLineage
        || owner.transactionEpoch !== snapshot.transactionEpoch
        || total.transactionEpoch !== owner.transactionEpoch
        || total.totalChanges !== snapshot.totalChangesAfter
        || state.currentTransactionEpoch !== context.historicalTransactionEpoch
        || state.currentTotalChanges !== context.historicalTotalChanges
        || !exactLedger(currentOuterLedger, context.historicalOuterLedger)
        || clock.transactionLineage !== context.transactionLineage
        || clock.transactionEpoch !== snapshot.transactionEpoch
        || fence.authority !== context.authority
        || fence.connection !== context.connection
        || fence.snapshot.catalogSha256 !== SQLITE_CURSOR_PUBLICATION_TARGET.catalogSha256
        || catalog.catalogSha256 !== fence.snapshot.catalogSha256
        || catalog.canonicalUtf8Bytes !== fence.snapshot.catalogCanonicalUtf8Bytes
        || catalog.rowCount !== fence.snapshot.catalogRowCount
        || catalog.applicationId !== fence.snapshot.applicationId
        || catalog.userVersion !== fence.snapshot.userVersion
        || provenance.receiptSha256 !== context.preRebindReceiptSha256
        || provenance.projectionIdentity !== state.projectionIdentity
        || provenance.projectionReference !== state.projectionReference
        || provenance.sealReceipt.cursorCount !== context.b2CursorCount
        || provenance.sealReceipt.immutableRootSha256 !== context.b2ImmutableRootSha256
        || provenance.sealReceipt.sourceDescriptorHash !== context.sourceDescriptorHash
        || provenance.sealReceipt.sourceSchemaIdentitySha256
          !== context.sourceSchemaIdentitySha256) {
      fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-rebind watermark is invalid");
    }
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  if (hasPrimary) {
    poisonAuthorityGraph(state, context.authority, "SQLite post-rebind watermark validation failed");
    throw primary;
  }

  let token: SQLiteCursorPostRebindWatermarkAdoption | undefined;
  try {
    token = mintPublicationRebindOpaqueIntrinsic<SQLiteCursorPostRebindWatermarkAdoption>();
    const adoption: PostRebindWatermarkAdoptionState = {
      adoptedOuterLedger: currentOuterLedger!,
      adoptedTotalChanges: snapshot!.totalChangesAfter,
      adoptedTransactionEpoch: snapshot!.transactionEpoch,
      affectedRows: snapshot!.affectedRows,
      context,
      executionSnapshot: snapshot!,
      lifecycle: "active",
      token,
      tombstone: consumed,
      totalChangesDelta: snapshot!.totalChangesDelta,
    };
    reflectApplyIntrinsic(weakMapSetIntrinsic, POST_REBIND_WATERMARK_ADOPTIONS, [
      token as object, adoption,
    ]);
    throwSQLiteCursorPublicationRebindRegistrationFaultIntrinsic("watermark-adoption");
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  if (hasPrimary) {
    if (token !== undefined) {
      reflectApplyIntrinsic(weakMapDeleteIntrinsic, POST_REBIND_WATERMARK_ADOPTIONS, [
        token as object,
      ]);
    }
    poisonAuthorityGraph(state, context.authority, "SQLite post-rebind adoption mint failed");
    throw primary;
  }

  // Assignment-only adoption tail. Historical receipts/session data remain unchanged.
  context.adoption = token!;
  context.lifecycle = "write-adopted";
  consumed.lifecycle = "adopted";
  state.currentTransactionEpoch = snapshot!.transactionEpoch;
  state.currentTotalChanges = snapshot!.totalChangesAfter;
  state.postRebindWatermarkAdoption = token!;
  state.writePhase = "cursor-rebind-adopted";
  return token!;
}

/** Repeatable post-adoption proof: registry/retained-data only, zero SQL/clock. */
export function assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(
  adoptionToken: SQLiteCursorPostRebindWatermarkAdoption,
): SQLiteCursorPostRebindWatermarkAdoption {
  const adoption = postRebindWatermarkAdoptionState(adoptionToken);
  const context = adoption.context;
  const state = authorityState(context.authority);
  if (adoption.lifecycle !== "active"
      || context.lifecycle !== "write-adopted"
      || context.adoption !== adoptionToken
      || context.tombstone !== adoption.tombstone.token
      || adoption.tombstone.lifecycle !== "adopted"
      || state.lifecycle !== "active"
      || state.writePhase !== "cursor-rebind-adopted"
      || state.publicationRebindContext !== context.token
      || state.publicationSessionConsumedTombstone !== adoption.tombstone.token
      || state.postRebindWatermarkAdoption !== adoptionToken
      || state.currentTransactionEpoch !== adoption.adoptedTransactionEpoch
      || state.currentTotalChanges !== adoption.adoptedTotalChanges
      || !exactLedger(outerLedgerSnapshot(state), context.historicalOuterLedger)
      || !exactLedger(adoption.adoptedOuterLedger, context.historicalOuterLedger)
      || adoption.executionSnapshot.transactionLineage !== context.transactionLineage
      || !retainedPreparedPublicationRebindSnapshotIsExact(
        context.preparedExecutionSnapshot,
        context,
      )
      || adoption.executionSnapshot.transactionEpoch !== adoption.adoptedTransactionEpoch
      || adoption.executionSnapshot.totalChangesBefore !== context.historicalTotalChanges
      || adoption.executionSnapshot.totalChangesAfter !== adoption.adoptedTotalChanges
      || adoption.executionSnapshot.totalChangesDelta !== adoption.totalChangesDelta
      || adoption.executionSnapshot.affectedRows !== adoption.affectedRows) {
    poisonAuthorityGraph(state, context.authority, "SQLite post-rebind adoption graph drifted");
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite post-rebind adoption is invalid");
  }
  return adoptionToken;
}

/**
 * Authenticate the exact consumed graph before a downstream E/W/R11 failure
 * poisons it. This performs no SQL and deliberately does not throw after a
 * successful authentication, allowing callers to preserve any primary value,
 * including a thrown `undefined`.
 */
export function poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
  contextToken: SQLiteCursorPublicationRebindContext,
  tombstoneToken: SQLiteCursorPublicationSessionConsumedTombstone,
  adoptionToken: SQLiteCursorPostRebindWatermarkAdoption | undefined,
  message: string,
): void {
  if (typeof message !== "string" || message.length === 0) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication rebind poison reason is invalid",
    );
  }
  const context = publicationRebindContextState(contextToken);
  const consumed = publicationSessionConsumedTombstoneState(tombstoneToken);
  const state = authorityState(context.authority);
  const adoption = adoptionToken === undefined
    ? undefined
    : postRebindWatermarkAdoptionState(adoptionToken);
  const preAdoption = adoption === undefined
    && context.lifecycle === "session-consumed"
    && context.adoption === undefined
    && consumed.lifecycle === "active"
    && state.writePhase === "publication-session-consumed";
  const postAdoption = adoption !== undefined
    && adoption.context === context
    && adoption.tombstone === consumed
    && adoption.lifecycle === "active"
    && context.lifecycle === "write-adopted"
    && context.adoption === adoptionToken
    && consumed.lifecycle === "adopted"
    && state.writePhase === "cursor-rebind-adopted"
    && state.postRebindWatermarkAdoption === adoptionToken;
  if (consumed.context !== context
      || context.tombstone !== tombstoneToken
      || state.lifecycle !== "active"
      || state.publicationRebindContext !== contextToken
      || state.publicationSessionConsumedTombstone !== tombstoneToken
      || (!preAdoption && !postAdoption)) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite publication rebind poison graph is invalid",
    );
  }
  poisonAuthorityGraph(state, context.authority, message);
}

function snapshotPostRebindWatermarkAdoption(
  state: PostRebindWatermarkAdoptionState,
): SQLiteCursorPostRebindWatermarkAdoptionSnapshot {
  const context = state.context;
  return objectFreezeIntrinsic({
    adoptedOuterLedger: state.adoptedOuterLedger,
    adoptedTotalChanges: state.adoptedTotalChanges,
    adoptedTransactionEpoch: state.adoptedTransactionEpoch,
    affectedRows: state.affectedRows,
    connection: context.connection,
    context: context.token,
    execution: context.execution,
    executionSnapshot: state.executionSnapshot,
    historicalOuterLedger: context.historicalOuterLedger,
    historicalTotalChanges: context.historicalTotalChanges,
    historicalTransactionEpoch: context.historicalTransactionEpoch,
    lifecycle: state.lifecycle,
    outerAuthority: context.authority,
    preparedExecutionSnapshot: context.preparedExecutionSnapshot,
    preparedOwner: context.preparedOwner,
    session: context.session,
    tombstone: state.tombstone.token,
    totalChangesDelta: state.totalChangesDelta,
    transactionLineage: context.transactionLineage,
  });
}

export function readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic(
  adoption: SQLiteCursorPostRebindWatermarkAdoption,
): SQLiteCursorPostRebindWatermarkAdoptionSnapshot {
  assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(adoption);
  return snapshotPostRebindWatermarkAdoption(postRebindWatermarkAdoptionState(adoption));
}

export function readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(
  receipt: SQLiteCursorInitialStageAdoptionReceipt,
): SQLiteCursorInitialStageAdoptionReceiptSnapshot {
  const record = receipt !== null && typeof receipt === "object"
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, INITIAL_STAGE_ADOPTION_RECEIPTS,
      [receipt as object]) as InitialStageAdoptionReceiptState | undefined
    : undefined;
  if (record === undefined || record.lifecycle !== "active") {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite initial stage adoption receipt is invalid");
  }
  const state = authorityState(record.authority);
  if (state.writePhase === "publication-session-consumed"
      || state.writePhase === "cursor-rebind-adopted") {
    const contextToken = state.publicationRebindContext;
    const tombstone = state.publicationSessionConsumedTombstone;
    const context = contextToken === undefined
      ? undefined
      : publicationRebindContextState(contextToken);
    const publication = context === undefined
      ? undefined
      : reflectApplyIntrinsic(
        weakMapGetIntrinsic, PUBLICATION_SESSIONS, [context.session as object],
      ) as PublicationSessionState | undefined;
    if (context === undefined || tombstone === undefined
        || record.authority !== context.authority
        || record.connection !== context.connection
        || publication === undefined || publication.adoptionReceipt !== receipt
        || record.snapshot.adoptedTransactionEpoch !== context.historicalTransactionEpoch
        || record.snapshot.adoptedTotalChanges !== context.historicalTotalChanges
        || !exactLedger(record.snapshot.adoptedOuterLedger, context.historicalOuterLedger)) {
      poisonAuthorityGraph(
        state, record.authority, "SQLite retained initial adoption receipt drifted",
      );
      return fail(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite retained initial adoption receipt is invalid",
      );
    }
    assertActiveConsumedTombstoneIntrinsic(
      record.snapshot.migration0002ConsumedTombstone as object,
      record.bundle[0] as object,
      receipt,
    );
    assertActiveConsumedTombstoneIntrinsic(
      record.snapshot.baselineEntriesConsumedTombstone as object,
      record.bundle[1] as object,
      receipt,
    );
    assertActiveConsumedTombstoneIntrinsic(
      record.snapshot.baselineHeaderConsumedTombstone as object,
      record.bundle[2] as object,
      receipt,
    );
    assertActiveConsumedTombstoneIntrinsic(
      record.snapshot.operationSequenceZeroConsumedTombstone as object,
      record.bundle[3] as object,
      receipt,
    );
    if (state.writePhase === "cursor-rebind-adopted") {
      assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(
        state.postRebindWatermarkAdoption!,
      );
    } else {
      assertSQLiteCursorPublicationSessionConsumedTombstoneIntrinsic(tombstone);
    }
    return record.snapshot;
  }
  assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
    record.authority, record.bundle, record.fence, record.readerLease, receipt,
  );
  return record.snapshot;
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
    baselineEntriesConsumedTombstone: state.baselineEntriesConsumedTombstone,
    baselineHeaderConsumedTombstone: state.baselineHeaderConsumedTombstone,
    initialStageAdoptionReceipt: state.initialStageAdoptionReceipt,
    initialStageAdoptionReceiptMintCount: state.initialStageAdoptionReceiptMintCount,
    publicationPreparedOwner: state.publicationPreparedOwner,
    publicationSession: state.publicationSession,
    publicationRebindContext: state.publicationRebindContext,
    publicationSessionConsumedTombstone: state.publicationSessionConsumedTombstone,
    postRebindWatermarkAdoption: state.postRebindWatermarkAdoption,
    migration0002ConsumedTombstone: state.migration0002ConsumedTombstone,
    operationSequenceZeroAffectedRows: state.operationSequenceZeroAffectedRows,
    operationSequenceZeroExecuteCount: state.operationSequenceZeroExecuteCount,
    operationSequenceZeroLogicalExecutionCount:
      state.operationSequenceZeroLogicalExecutionCount,
    operationSequenceZeroPrepareCount: state.operationSequenceZeroPrepareCount,
    operationSequenceZeroPublicationReceipt:
      state.operationSequenceZeroPublicationReceipt,
    operationSequenceZeroPublicationReceiptMintCount:
      state.operationSequenceZeroPublicationReceiptMintCount,
    operationSequenceZeroConsumedTombstone:
      state.operationSequenceZeroConsumedTombstone,
    receiptConsumptionCount: state.receiptConsumptionCount,
    tombstoneMintCount: state.tombstoneMintCount,
    connection: state.connection,
    lifecycle: state.lifecycle,
    stageOwnershipPoisonReason: state.stageOwnershipPoisonReason,
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
