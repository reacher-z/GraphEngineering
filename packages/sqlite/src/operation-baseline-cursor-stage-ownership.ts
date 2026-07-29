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
  beginSQLiteBaselineCursorStageTransferIntrinsic,
  beginSQLiteBaselineCursorPreRebindIntrinsic,
  completeSQLiteBaselineCursorPreRebindIntrinsic,
  createSQLiteBaselineCursorSealTempTableIntrinsic,
  diagnoseSQLiteBaselineCursorPreRebindIntrinsic,
  fenceSQLiteBaselineCursorStageTransferIntrinsic,
  fenceSQLiteBaselineCursorPreRebindIntrinsic,
  insertSQLiteBaselineCursorPreRebindRowIntrinsic,
  registerSQLiteBaselineCursorPreRebindCleanupIntrinsic,
} from "./operation-baseline-stage.js";
import type { SQLiteCursorStageValue } from "./operation-baseline-cursor-inspection.js";
import { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

/** Opaque one-way B0b ownership transfer. */
export interface SQLiteCursorStageOwnershipTransfer {
  readonly __sqliteCursorStageOwnershipTransfer: never;
}

export interface SQLiteCursorPreRebindStageCampaign {
  readonly __sqliteCursorPreRebindStageCampaign: never;
}

interface TransferState {
  readonly connection: SQLiteConnection;
  readonly preTransferWitness: SQLiteCursorPreRebindConnectionProvenance;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly session: object;
  readonly stage: SQLiteBaselineTempStage;
}

const TRANSFERS = new WeakMap<object, TransferState>();
const CAMPAIGNS = new WeakMap<object, Readonly<{
  stage: SQLiteBaselineTempStage;
  session: object;
  transfer: SQLiteCursorStageOwnershipTransfer;
}>>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;

function invalid(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    OPERATION,
    message,
  );
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
  assertSQLiteCursorPreRebindReceiptProvenance(receipt);
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
    Reflect.apply(weakMapSetIntrinsic, TRANSFERS, [transfer as object, Object.freeze({
      connection,
      preTransferWitness,
      receipt,
      session,
      stage,
    })]);
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
  const state = transfer !== null && typeof transfer === "object"
    ? Reflect.apply(weakMapGetIntrinsic, TRANSFERS, [transfer as object]) as
      TransferState | undefined
    : undefined;
  if (state === undefined
      || state.connection !== connection
      || state.stage !== stage
      || state.receipt !== receipt) {
    return invalid("SQLite cursor stage ownership transfer provenance is invalid");
  }
  fenceSQLiteBaselineCursorStageTransferIntrinsic(
    stage,
    connection,
    receipt,
    state.session,
  );
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
  const state = transfer !== null && typeof transfer === "object"
    ? Reflect.apply(weakMapGetIntrinsic, TRANSFERS, [transfer as object]) as
      TransferState | undefined
    : undefined;
  if (state === undefined
      || state.connection !== connection
      || state.stage !== stage
      || state.receipt !== receipt) {
    return invalid("SQLite cursor stage ownership transfer provenance is invalid");
  }
  createSQLiteBaselineCursorSealTempTableIntrinsic(
    stage,
    connection,
    receipt,
    state.session,
  );
}

export function beginSQLiteCursorPreRebindStageCampaign(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  transfer: SQLiteCursorStageOwnershipTransfer,
): SQLiteCursorPreRebindStageCampaign {
  assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  const state = transfer !== null && typeof transfer === "object"
    ? Reflect.apply(weakMapGetIntrinsic, TRANSFERS, [transfer as object]) as
      TransferState | undefined
    : undefined;
  if (state === undefined || state.connection !== connection
      || state.stage !== stage || state.receipt !== receipt) {
    return invalid("SQLite cursor pre-rebind stage authority is invalid");
  }
  const campaign = Object.freeze(Object.create(null)) as SQLiteCursorPreRebindStageCampaign;
  const session = beginSQLiteBaselineCursorPreRebindIntrinsic(
    stage, connection, receipt, state.session,
  );
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
  completeSQLiteBaselineCursorPreRebindIntrinsic(stage, state.session);
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
  return abortSQLiteBaselineCursorPreRebindIntrinsic(stage, state?.session, message);
}
