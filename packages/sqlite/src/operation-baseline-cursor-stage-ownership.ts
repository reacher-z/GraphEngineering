import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  assertSQLiteCursorPreRebindConnectionProvenance,
  assertSQLiteCursorPreRebindReceiptProvenance,
  type SQLiteCursorPreRebindConnectionProvenance,
  type SQLiteCursorPreRebindReceipt,
} from "./operation-baseline-cursor-ownership.js";
import {
  SQLiteBaselineTempStage,
  abortSQLiteBaselineCursorStageTransferIntrinsic,
  abortSQLiteBaselineCursorPreRebindIntrinsic,
  assertSQLiteBaselineCursorOuterPublicationActiveIntrinsic,
  assertSQLiteBaselineCursorPreRebindCompleteIntrinsic,
  beginSQLiteBaselineCursorStageTransferIntrinsic,
  beginSQLiteBaselineCursorPreRebindIntrinsic,
  completeSQLiteBaselineCursorPreRebindIntrinsic,
  createSQLiteBaselineCursorSealTempTableIntrinsic,
  clearSQLiteBaselineCursorPostDdlReaderCleanupIntrinsic,
  diagnoseSQLiteBaselineCursorPreRebindIntrinsic,
  fenceSQLiteBaselineCursorStageTransferIntrinsic,
  fenceSQLiteBaselineCursorPreRebindIntrinsic,
  insertSQLiteBaselineCursorPreRebindRowIntrinsic,
  poisonSQLiteBaselineCursorOuterPublicationIntrinsic,
  prepareSQLiteBaselineCursorOuterPublicationIntrinsic,
  publishSQLiteBaselineCursorOuterPublicationIntrinsic,
  registerSQLiteBaselineCursorPostDdlReaderCleanupIntrinsic,
  registerSQLiteBaselineCursorPreRebindCleanupIntrinsic,
  retireSQLiteBaselineCursorOuterPublicationIntrinsic,
} from "./operation-baseline-stage.js";
import type { SQLiteCursorStageValue } from "./operation-baseline-cursor-inspection.js";
import type { OperationBaselineProjectionIdentity } from "./operation-baseline.js";
import { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

/** Opaque one-way B0b ownership transfer. */
export interface SQLiteCursorStageOwnershipTransfer {
  readonly __sqliteCursorStageOwnershipTransfer: never;
}

export interface SQLiteCursorPreRebindStageCampaign {
  readonly __sqliteCursorPreRebindStageCampaign: never;
}

/** Opaque single-use continuation for the outer-authority activation tail. */
export interface SQLiteCursorStageOwnershipOuterPublicationTail {
  readonly __sqliteCursorStageOwnershipOuterPublicationTail: never;
}

/** Package-private result; the tail token is never part of a protocol snapshot. */
export interface SQLiteCursorStageOwnershipOuterPublicationMint {
  readonly authority: object;
  readonly tail: SQLiteCursorStageOwnershipOuterPublicationTail;
}

type TransferLifecycle = "b2-active" | "pre-rebind-complete"
  | "outer-publication-prepared" | "outer-publication-owned" | "retired" | "poisoned";

interface TransferState {
  readonly connection: SQLiteConnection;
  lifecycle: TransferLifecycle;
  outerAuthority: object | undefined;
  outerMint: SQLiteCursorStageOwnershipOuterPublicationMint | undefined;
  outerTail: SQLiteCursorStageOwnershipOuterPublicationTail | undefined;
  readonly preTransferWitness: SQLiteCursorPreRebindConnectionProvenance;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  postDdlReaderCleanup: (() => void) | undefined;
  postDdlReaderLease: object | undefined;
  postDdlReaderLifecycle: "unused" | "active" | "closed" | "poisoned";
  readonly session: object;
  readonly stage: SQLiteBaselineTempStage;
}

const TRANSFERS = new WeakMap<object, TransferState>();
const CAMPAIGNS = new WeakMap<object, Readonly<{
  stage: SQLiteBaselineTempStage;
  session: object;
  transfer: SQLiteCursorStageOwnershipTransfer;
}>>();
interface OuterPublicationTailContinuation {
  readonly authority: object;
  readonly stage: SQLiteBaselineTempStage;
  readonly transferState: TransferState;
}
const OUTER_PUBLICATION_TAILS = new WeakMap<object, OuterPublicationTailContinuation>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;
const reflectApplyIntrinsic = Reflect.apply;

function invalid(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    OPERATION,
    message,
  );
}

function readTransferState(
  transfer: SQLiteCursorStageOwnershipTransfer,
): TransferState | undefined {
  return transfer !== null && typeof transfer === "object"
    ? Reflect.apply(weakMapGetIntrinsic, TRANSFERS, [transfer as object]) as
      TransferState | undefined
    : undefined;
}

function checkedOpaqueAuthority(authority: object): object {
  try {
    if (authority === null || typeof authority !== "object"
        || !Object.isFrozen(authority)
        || Object.getPrototypeOf(authority) !== null
        || Reflect.ownKeys(authority).length !== 0) {
      return invalid("SQLite cursor outer publication authority is invalid");
    }
    return authority;
  } catch {
    return invalid("SQLite cursor outer publication authority is invalid");
  }
}

function checkedTransferIdentityGraph(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  projectionIdentity: OperationBaselineProjectionIdentity,
  transfer: SQLiteCursorStageOwnershipTransfer,
): TransferState {
  // Registry and exact object identity precede every stage hook.
  const state = readTransferState(transfer);
  if (state === undefined
      || state.connection !== connection
      || state.stage !== stage
      || state.receipt !== receipt
      || state.projectionIdentity !== projectionIdentity) {
    return invalid("SQLite cursor stage ownership transfer provenance is invalid");
  }
  return state;
}

function checkedTransferGraph(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  projectionIdentity: OperationBaselineProjectionIdentity,
  transfer: SQLiteCursorStageOwnershipTransfer,
): TransferState {
  const state = checkedTransferIdentityGraph(
    connection, stage, receipt, projectionIdentity, transfer,
  );
  const witness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  if (witness.projectionIdentity !== projectionIdentity) {
    return invalid("SQLite cursor stage ownership transfer projection is invalid");
  }
  return state;
}

/**
 * Atomically consume B0a and bind it to one exact completed TEMP stage.
 * This executes no cursor SQL, creates no cursor TEMP object and performs no
 * rebind. Receipt provenance is intentionally the first operation.
 */
export function beginSQLiteCursorStageOwnershipTransfer(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
): SQLiteCursorStageOwnershipTransfer {
  const receiptWitness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  const preTransferWitness = assertSQLiteCursorPreRebindConnectionProvenance(
    connection,
    receipt,
  );
  if (!(stage instanceof SQLiteBaselineTempStage)) {
    return invalid("SQLite cursor stage ownership transfer stage is invalid");
  }
  const transfer = Object.freeze(
    Object.create(null),
  ) as SQLiteCursorStageOwnershipTransfer;
  let session: object | undefined;
  try {
    session = beginSQLiteBaselineCursorStageTransferIntrinsic(
      stage,
      connection,
      receipt,
      preTransferWitness,
    );
    Reflect.apply(weakMapSetIntrinsic, TRANSFERS, [transfer as object, {
      connection,
      lifecycle: "b2-active",
      outerAuthority: undefined,
      outerMint: undefined,
      outerTail: undefined,
      preTransferWitness,
      projectionIdentity: receiptWitness.projectionIdentity,
      postDdlReaderCleanup: undefined,
      postDdlReaderLease: undefined,
      postDdlReaderLifecycle: "unused",
      receipt,
      session,
      stage,
    } satisfies TransferState]);
    return transfer;
  } catch (error) {
    if (session !== undefined) {
      try {
        abortSQLiteBaselineCursorStageTransferIntrinsic(
          stage,
          session,
          "SQLite cursor stage ownership transfer publication failed",
        );
      } catch {
        // Preserve the authoritative begin/publication failure.
      }
    }
    throw error;
  }
}

/** Revalidate the exact live stage/session owner without replaying capture epoch. */
export function assertSQLiteCursorStageOwnershipTransfer(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  transfer: SQLiteCursorStageOwnershipTransfer,
): SQLiteCursorStageOwnershipTransfer {
  assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  const state = readTransferState(transfer);
  if (state === undefined
      || state.connection !== connection
      || state.stage !== stage
      || state.receipt !== receipt
      || state.lifecycle === "retired" || state.lifecycle === "poisoned") {
    return invalid("SQLite cursor stage ownership transfer provenance is invalid");
  }
  try {
    fenceSQLiteBaselineCursorStageTransferIntrinsic(
      stage,
      connection,
      receipt,
      state.session,
    );
  } catch (error) {
    state.lifecycle = "poisoned";
    throw error;
  }
  return transfer;
}

/** Execute the sole exact stage-owned B1 cursor TEMP DDL transition. */
export function createSQLiteCursorSealTempTable(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  transfer: SQLiteCursorStageOwnershipTransfer,
): void {
  assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  const state = readTransferState(transfer);
  if (state === undefined
      || state.connection !== connection
      || state.stage !== stage
      || state.receipt !== receipt
      || state.lifecycle !== "b2-active") {
    return invalid("SQLite cursor stage ownership transfer provenance is invalid");
  }
  try {
    createSQLiteBaselineCursorSealTempTableIntrinsic(
      stage,
      connection,
      receipt,
      state.session,
    );
  } catch (error) {
    state.lifecycle = "poisoned";
    throw error;
  }
}

export function beginSQLiteCursorPreRebindStageCampaign(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  transfer: SQLiteCursorStageOwnershipTransfer,
): SQLiteCursorPreRebindStageCampaign {
  assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  const state = readTransferState(transfer);
  if (state === undefined || state.connection !== connection
      || state.stage !== stage || state.receipt !== receipt
      || state.lifecycle !== "b2-active") {
    return invalid("SQLite cursor pre-rebind stage authority is invalid");
  }
  const campaign = Object.freeze(Object.create(null)) as SQLiteCursorPreRebindStageCampaign;
  let session: object;
  try {
    session = beginSQLiteBaselineCursorPreRebindIntrinsic(
      stage, connection, receipt, state.session,
    );
  } catch (error) {
    state.lifecycle = "poisoned";
    throw error;
  }
  Reflect.apply(weakMapSetIntrinsic, CAMPAIGNS, [campaign as object,
    Object.freeze({ stage, session, transfer })]);
  return campaign;
}

function campaignState(
  stage: SQLiteBaselineTempStage,
  campaign: SQLiteCursorPreRebindStageCampaign,
): Readonly<{
  stage: SQLiteBaselineTempStage;
  session: object;
  transfer: SQLiteCursorStageOwnershipTransfer;
}> {
  const state = campaign !== null && typeof campaign === "object"
    ? Reflect.apply(weakMapGetIntrinsic, CAMPAIGNS, [campaign as object]) as
      Readonly<{
        stage: SQLiteBaselineTempStage;
        session: object;
        transfer: SQLiteCursorStageOwnershipTransfer;
      }> | undefined
    : undefined;
  if (state === undefined || state.stage !== stage) {
    return invalid("SQLite cursor pre-rebind stage campaign is invalid");
  }
  return state;
}

export function fenceSQLiteCursorPreRebindStageCampaign(
  stage: SQLiteBaselineTempStage,
  campaign: SQLiteCursorPreRebindStageCampaign,
): void {
  const state = campaignState(stage, campaign);
  fenceSQLiteBaselineCursorPreRebindIntrinsic(stage, state.session);
}

export function registerSQLiteCursorPreRebindStageCleanup(
  stage: SQLiteBaselineTempStage,
  campaign: SQLiteCursorPreRebindStageCampaign,
  cleanup: (() => void) | undefined,
): void {
  const state = campaignState(stage, campaign);
  registerSQLiteBaselineCursorPreRebindCleanupIntrinsic(stage, state.session, cleanup);
}

export function insertSQLiteCursorPreRebindStageRow(
  stage: SQLiteBaselineTempStage,
  campaign: SQLiteCursorPreRebindStageCampaign,
  values: readonly SQLiteCursorStageValue[],
): void {
  const state = campaignState(stage, campaign);
  insertSQLiteBaselineCursorPreRebindRowIntrinsic(stage, state.session, values);
}

export function completeSQLiteCursorPreRebindStageCampaign(
  stage: SQLiteBaselineTempStage,
  campaign: SQLiteCursorPreRebindStageCampaign,
): void {
  const state = campaignState(stage, campaign);
  const transferState = readTransferState(state.transfer);
  if (transferState === undefined || transferState.lifecycle !== "b2-active") {
    return invalid("SQLite cursor pre-rebind stage transfer is invalid");
  }
  completeSQLiteBaselineCursorPreRebindIntrinsic(stage, state.session);
  transferState.lifecycle = "pre-rebind-complete";
  Reflect.apply(weakMapDeleteIntrinsic, CAMPAIGNS, [campaign as object]);
}

export function diagnoseSQLiteCursorPreRebindStageCampaign(
  stage: SQLiteBaselineTempStage,
  campaign: SQLiteCursorPreRebindStageCampaign,
): void {
  const state = campaignState(stage, campaign);
  diagnoseSQLiteBaselineCursorPreRebindIntrinsic(stage, state.session);
  Reflect.apply(weakMapDeleteIntrinsic, CAMPAIGNS, [campaign as object]);
  // Diagnosed is terminal and cannot flow into B3. Retire the B0b transfer
  // registry authority together with the stage-owned transfer session.
  Reflect.apply(weakMapDeleteIntrinsic, TRANSFERS, [state.transfer as object]);
}

export function abortSQLiteCursorPreRebindStageCampaign(
  stage: SQLiteBaselineTempStage,
  campaign: SQLiteCursorPreRebindStageCampaign | undefined,
  message: string,
): never {
  const state = campaign === undefined ? undefined : campaignState(stage, campaign);
  if (campaign !== undefined) {
    Reflect.apply(weakMapDeleteIntrinsic, CAMPAIGNS, [campaign as object]);
  }
  const transferState = state === undefined ? undefined : readTransferState(state.transfer);
  if (transferState !== undefined) transferState.lifecycle = "poisoned";
  return abortSQLiteBaselineCursorPreRebindIntrinsic(stage, state?.session, message);
}

/** Validate the exact completed B2 graph before any outer-authority work. */
export function assertSQLiteCursorStageOwnershipPreRebindCompleteIntrinsic(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  projectionIdentity: OperationBaselineProjectionIdentity,
  transfer: SQLiteCursorStageOwnershipTransfer,
): SQLiteCursorStageOwnershipTransfer {
  const state = checkedTransferGraph(
    connection, stage, receipt, projectionIdentity, transfer,
  );
  if (state.lifecycle === "b2-active" || state.lifecycle === "retired"
      || state.lifecycle === "poisoned") {
    return invalid("SQLite cursor pre-rebind transfer is not complete");
  }
  assertSQLiteBaselineCursorPreRebindCompleteIntrinsic(
    stage, connection, receipt, projectionIdentity, state.session,
  );
  return transfer;
}

/** Mint and bind one package-owned inactive authority without SQL or receipt consumption. */
export function mintSQLiteCursorStageOwnershipOuterPublicationAuthorityIntrinsic(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  projectionIdentity: OperationBaselineProjectionIdentity,
  transfer: SQLiteCursorStageOwnershipTransfer,
): SQLiteCursorStageOwnershipOuterPublicationMint {
  const state = checkedTransferGraph(
    connection, stage, receipt, projectionIdentity, transfer,
  );
  if (state.lifecycle === "outer-publication-prepared") {
    if (state.outerAuthority === undefined || state.outerMint === undefined
        || state.outerTail === undefined) {
      return invalid("SQLite cursor outer publication authority is invalid");
    }
    return state.outerMint;
  } else if (state.lifecycle !== "pre-rebind-complete"
      || state.outerAuthority !== undefined || state.outerMint !== undefined
      || state.outerTail !== undefined) {
    return invalid("SQLite cursor outer publication preparation is invalid");
  }
  const authority = Object.freeze(Object.create(null)) as object;
  const tail = Object.freeze(
    Object.create(null),
  ) as SQLiteCursorStageOwnershipOuterPublicationTail;
  prepareSQLiteBaselineCursorOuterPublicationIntrinsic(
    stage,
    connection,
    receipt,
    projectionIdentity,
    state.session,
    authority,
  );
  const mint = Object.freeze({ authority, tail });
  state.outerAuthority = authority;
  state.outerMint = mint;
  state.outerTail = tail;
  state.lifecycle = "outer-publication-prepared";
  return mint;
}

/** Complete every fallible check before the non-interruptible publish tail. */
export function assertSQLiteCursorStageOwnershipOuterPublicationPreparedIntrinsic(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  projectionIdentity: OperationBaselineProjectionIdentity,
  transfer: SQLiteCursorStageOwnershipTransfer,
  authority: object,
  tail: SQLiteCursorStageOwnershipOuterPublicationTail,
): void {
  const state = checkedTransferGraph(
    connection, stage, receipt, projectionIdentity, transfer,
  );
  checkedOpaqueAuthority(authority);
  if (state.lifecycle !== "outer-publication-prepared"
      || state.outerAuthority !== authority || state.outerTail !== tail) {
    return invalid("SQLite cursor outer publication preparation is invalid");
  }
  // The stage prepare hook is validation-only and idempotent for this exact pair.
  prepareSQLiteBaselineCursorOuterPublicationIntrinsic(
    stage,
    connection,
    receipt,
    projectionIdentity,
    state.session,
    authority,
  );
  // Publish can only resolve a continuation after every fallible validation.
  Reflect.apply(weakMapSetIntrinsic, OUTER_PUBLICATION_TAILS, [tail as object, {
    authority,
    stage,
    transferState: state,
  } satisfies OuterPublicationTailContinuation]);
}

/**
 * Resolve one prevalidated continuation, then enter the non-interruptible
 * assignment-only tail. Missing, forged, retired and replayed tokens fail
 * before any stage or transfer state can change.
 */
export function publishSQLiteCursorStageOwnershipOuterPublicationIntrinsic(
  tail: SQLiteCursorStageOwnershipOuterPublicationTail,
): void {
  const continuation = reflectApplyIntrinsic(
    weakMapGetIntrinsic, OUTER_PUBLICATION_TAILS, [tail as object],
  ) as OuterPublicationTailContinuation | undefined;
  if (continuation === undefined) {
    return invalid("SQLite cursor outer publication tail is invalid");
  }
  reflectApplyIntrinsic(weakMapDeleteIntrinsic, OUTER_PUBLICATION_TAILS, [tail as object]);
  publishSQLiteBaselineCursorOuterPublicationIntrinsic(
    continuation.stage, continuation.authority,
  );
  continuation.transferState.lifecycle = "outer-publication-owned";
}

/** Revalidate the exact adopted outer owner. */
export function assertSQLiteCursorStageOwnershipOuterPublicationOwnedIntrinsic(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  projectionIdentity: OperationBaselineProjectionIdentity,
  transfer: SQLiteCursorStageOwnershipTransfer,
  authority: object,
): SQLiteCursorStageOwnershipTransfer {
  const state = checkedTransferIdentityGraph(
    connection, stage, receipt, projectionIdentity, transfer,
  );
  if (state.lifecycle !== "outer-publication-owned"
      || state.outerAuthority !== authority) {
    return invalid("SQLite cursor outer publication ownership is invalid");
  }
  assertSQLiteBaselineCursorOuterPublicationActiveIntrinsic(
    stage,
    connection,
    receipt,
    projectionIdentity,
    state.session,
    authority,
  );
  return transfer;
}

/** Register the exact post-DDL reader only after its native iterator exists. */
export function registerSQLiteCursorStageOwnershipPostDdlReaderIntrinsic(
  transfer: SQLiteCursorStageOwnershipTransfer,
  authority: object,
  lease: object,
  cleanup: () => void,
): void {
  const state = readTransferState(transfer);
  checkedOpaqueAuthority(authority);
  if (state === undefined || state.lifecycle !== "outer-publication-owned"
      || state.outerAuthority !== authority
      || lease === null || typeof lease !== "object"
      || typeof cleanup !== "function"
      || state.postDdlReaderLifecycle !== "unused"
      || state.postDdlReaderLease !== undefined
      || state.postDdlReaderCleanup !== undefined) {
    return invalid("SQLite post-DDL publication reader ownership is invalid");
  }
  registerSQLiteBaselineCursorPostDdlReaderCleanupIntrinsic(
    state.stage, authority, lease, cleanup,
  );
  state.postDdlReaderLease = lease;
  state.postDdlReaderCleanup = cleanup;
  state.postDdlReaderLifecycle = "active";
}

/** Clear active cursor ownership after the one required close attempt. */
export function completeSQLiteCursorStageOwnershipPostDdlReaderIntrinsic(
  transfer: SQLiteCursorStageOwnershipTransfer,
  authority: object,
  lease: object,
  closeSucceeded: boolean,
): void {
  const state = readTransferState(transfer);
  if (state === undefined || state.lifecycle !== "outer-publication-owned"
      || state.outerAuthority !== authority
      || state.postDdlReaderLifecycle !== "active"
      || state.postDdlReaderLease !== lease
      || state.postDdlReaderCleanup === undefined) {
    return invalid("SQLite post-DDL publication reader ownership is invalid");
  }
  clearSQLiteBaselineCursorPostDdlReaderCleanupIntrinsic(
    state.stage, authority, lease,
  );
  state.postDdlReaderCleanup = undefined;
  state.postDdlReaderLifecycle = closeSucceeded ? "closed" : "poisoned";
}

/** Future adoption gate: an exact lease must be closed and have no cleanup owner. */
export function assertSQLiteCursorStageOwnershipPostDdlReaderTerminalIntrinsic(
  transfer: SQLiteCursorStageOwnershipTransfer,
  authority: object,
  lease: object,
): void {
  const state = readTransferState(transfer);
  if (state === undefined || state.lifecycle !== "outer-publication-owned"
      || state.outerAuthority !== authority
      || state.postDdlReaderLifecycle !== "closed"
      || state.postDdlReaderLease !== lease
      || state.postDdlReaderCleanup !== undefined) {
    return invalid("SQLite post-DDL publication reader is not terminal");
  }
}

function closeActivePostDdlReader(state: TransferState): void {
  const cleanup = state.postDdlReaderCleanup;
  state.postDdlReaderCleanup = undefined;
  if (state.postDdlReaderLifecycle === "active") {
    state.postDdlReaderLifecycle = "poisoned";
    try {
      clearSQLiteBaselineCursorPostDdlReaderCleanupIntrinsic(
        state.stage, state.outerAuthority!, state.postDdlReaderLease!,
      );
    } catch {
      // The close callback below is still mandatory and idempotent.
    }
    try {
      cleanup?.();
    } catch {
      // Outer retirement/poison remains authoritative after the close attempt.
    }
  }
}

/** Retire the exact inactive/active pair without SQL or the pre-0002 fence. */
export function retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic(
  transfer: SQLiteCursorStageOwnershipTransfer,
  authority: object,
): void {
  const state = readTransferState(transfer);
  if (state === undefined || (state.lifecycle !== "outer-publication-prepared"
        && state.lifecycle !== "outer-publication-owned")
      || state.outerAuthority !== authority) {
    return invalid("SQLite cursor outer publication authority is invalid");
  }
  if (state.outerTail !== undefined) {
    reflectApplyIntrinsic(
      weakMapDeleteIntrinsic, OUTER_PUBLICATION_TAILS, [state.outerTail as object],
    );
  }
  closeActivePostDdlReader(state);
  retireSQLiteBaselineCursorOuterPublicationIntrinsic(state.stage);
  state.lifecycle = "retired";
}

/** Poison the exact prepared/owned graph while preserving its authority identity. */
export function poisonSQLiteCursorStageOwnershipOuterPublicationIntrinsic(
  transfer: SQLiteCursorStageOwnershipTransfer,
  authority: object,
  message: string,
): never {
  const state = readTransferState(transfer);
  checkedOpaqueAuthority(authority);
  if (state === undefined || state.outerAuthority !== authority
      || (state.lifecycle !== "outer-publication-prepared"
        && state.lifecycle !== "outer-publication-owned")) {
    return invalid("SQLite cursor outer publication authority is invalid");
  }
  state.lifecycle = "poisoned";
  closeActivePostDdlReader(state);
  if (state.outerTail !== undefined) {
    reflectApplyIntrinsic(
      weakMapDeleteIntrinsic, OUTER_PUBLICATION_TAILS, [state.outerTail as object],
    );
  }
  return poisonSQLiteBaselineCursorOuterPublicationIntrinsic(
    state.stage, authority, message,
  );
}
