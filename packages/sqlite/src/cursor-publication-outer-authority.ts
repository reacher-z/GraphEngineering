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
  type SQLiteConnectionTransactionLineage,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

export const SQLITE_CURSOR_PUBLICATION_TARGET = Object.freeze({
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
  readonly outerLedger: Readonly<{
    logicalWriteSequence: 0;
    fixedStatementCount: 0;
    affectedRowsWatermark: 0;
  }>;
  readonly sourceDescriptorHash: string;
  readonly sourceSchemaIdentitySha256: string;
  readonly sourceSchemaVersion: 1;
  readonly target: typeof SQLITE_CURSOR_PUBLICATION_TARGET;
  readonly activationCount: 0 | 1;
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
}

interface CancellationState { cancelled: boolean }

const AUTHORITIES = new WeakMap<object, AuthorityState>();
const AUTHORITY_BY_EVIDENCE = new WeakMap<object, SQLiteCursorOuterPublicationAuthority>();
const AUTHORITY_BY_TRANSFER = new WeakMap<object, SQLiteCursorOuterPublicationAuthority>();
const CANCELLATIONS = new WeakMap<object, CancellationState>();
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
    ? Reflect.apply(weakMapGetIntrinsic, AUTHORITIES, [authority as object]) as
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
  const signal = Object.freeze(
    Object.create(null),
  ) as SQLiteCursorOuterPublicationCancellationSignal;
  const state: CancellationState = { cancelled: false };
  Reflect.apply(weakMapSetIntrinsic, CANCELLATIONS, [signal as object, state]);
  return Object.freeze({
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
    ? Reflect.apply(weakMapGetIntrinsic, AUTHORITY_BY_EVIDENCE, [
      outerClockEvidence as object,
    ]) as SQLiteCursorOuterPublicationAuthority | undefined
    : undefined;
  const existingByTransfer = transfer !== null && typeof transfer === "object"
    ? Reflect.apply(weakMapGetIntrinsic, AUTHORITY_BY_TRANSFER, [
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
    connection,
    currentTotalChanges: changes.totalChanges,
    currentTransactionEpoch: owner.transactionEpoch,
    lifecycle: "inactive",
    migrationLockCapability,
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
  };
  Reflect.apply(weakMapSetIntrinsic, AUTHORITIES, [authority as object, state]);
  Reflect.apply(weakMapSetIntrinsic, AUTHORITY_BY_EVIDENCE, [
    outerClockEvidence as object, authority,
  ]);
  Reflect.apply(weakMapSetIntrinsic, AUTHORITY_BY_TRANSFER, [transfer as object, authority]);
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
      ? Reflect.apply(weakMapGetIntrinsic, CANCELLATIONS, [cancellation as object]) as
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

/** Package-private identity snapshot for downstream receipt construction and tests. */
export function readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
  authority: SQLiteCursorOuterPublicationAuthority,
): SQLiteCursorOuterPublicationAuthoritySnapshot {
  const state = authorityState(authority);
  return Object.freeze({
    activationCount: state.activationCount,
    connection: state.connection,
    lifecycle: state.lifecycle,
    migrationLockCapability: state.migrationLockCapability,
    outerClockConsumedTombstone: state.outerClockConsumedTombstone,
    outerClockEvidence: state.outerClockEvidence,
    outerLedger: Object.freeze({
      affectedRowsWatermark: 0 as const,
      fixedStatementCount: 0 as const,
      logicalWriteSequence: 0 as const,
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
  });
}
