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
  beginSQLiteBaselineCursorStageTransferIntrinsic,
  createSQLiteBaselineCursorSealTempTableIntrinsic,
  fenceSQLiteBaselineCursorStageTransferIntrinsic,
} from "./operation-baseline-stage.js";
import { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

/** Opaque one-way B0b ownership transfer. */
export interface SQLiteCursorStageOwnershipTransfer {
  readonly __sqliteCursorStageOwnershipTransfer: never;
}

interface TransferState {
  readonly connection: SQLiteConnection;
  readonly preTransferWitness: SQLiteCursorPreRebindConnectionProvenance;
  readonly receipt: SQLiteCursorPreRebindReceipt;
  readonly session: object;
  readonly stage: SQLiteBaselineTempStage;
}

const TRANSFERS = new WeakMap<object, TransferState>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;

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
