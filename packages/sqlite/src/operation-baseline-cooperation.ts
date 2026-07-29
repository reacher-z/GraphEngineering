import type {
  OperationBaselineEntryInput,
  OperationBaselineProjectionIdentity,
} from "./operation-baseline.js";
import type {
  SQLiteCursorPreRebindConnectionProvenance,
  SQLiteCursorPreRebindReceipt,
} from "./operation-baseline-cursor-ownership.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

/** Package-private source/stage hooks. Neither symbol is exported by index.ts. */
export const SQLITE_BASELINE_COOPERATIVE_ENTRIES = Symbol(
  "SQLiteV1BaselineSourceSummary.cooperativeEntries",
);
export const SQLITE_BASELINE_OWNED_WRITE = Symbol(
  "SQLiteBaselineTempStage.ownedWrite",
);
export const SQLITE_BASELINE_COOPERATIVE_POISON = Symbol(
  "SQLiteBaselineTempStage.cooperativePoison",
);
export const SQLITE_BASELINE_CONSUME_OWNED_WRITE = Symbol(
  "SQLiteBaselineTempStage.consumeOwnedWrite",
);
export const SQLITE_BASELINE_FINISH_COOPERATIVE_WRITES = Symbol(
  "SQLiteBaselineTempStage.finishCooperativeWrites",
);
export const SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE = Symbol(
  "SQLiteV1BaselineSourceSummary.orderedHandoffSource",
);
export const SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF = Symbol(
  "SQLiteBaselineTempStage.beginOrderedHandoff",
);
export const SQLITE_BASELINE_FENCE_ORDERED_HANDOFF = Symbol(
  "SQLiteBaselineTempStage.fenceOrderedHandoff",
);
export const SQLITE_BASELINE_REGISTER_ORDERED_HANDOFF_CLEANUP = Symbol(
  "SQLiteBaselineTempStage.registerOrderedHandoffCleanup",
);
export const SQLITE_BASELINE_COMPLETE_ORDERED_HANDOFF = Symbol(
  "SQLiteBaselineTempStage.completeOrderedHandoff",
);
export const SQLITE_BASELINE_ABORT_ORDERED_HANDOFF = Symbol(
  "SQLiteBaselineTempStage.abortOrderedHandoff",
);
export const SQLITE_BASELINE_BEGIN_STREAM_RECORD_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.beginStreamRecordCampaign",
);
export const SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.fenceStreamRecordCampaign",
);
export const SQLITE_BASELINE_REGISTER_STREAM_RECORD_CLEANUP = Symbol(
  "SQLiteBaselineTempStage.registerStreamRecordCleanup",
);
export const SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.completeStreamRecordCampaign",
);
export const SQLITE_BASELINE_ABORT_STREAM_RECORD_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.abortStreamRecordCampaign",
);
export const SQLITE_BASELINE_BEGIN_CHECKPOINT_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.beginCheckpointCampaign",
);
export const SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.fenceCheckpointCampaign",
);
export const SQLITE_BASELINE_REGISTER_CHECKPOINT_CLEANUP = Symbol(
  "SQLiteBaselineTempStage.registerCheckpointCleanup",
);
export const SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.completeCheckpointCampaign",
);
export const SQLITE_BASELINE_ABORT_CHECKPOINT_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.abortCheckpointCampaign",
);
export const SQLITE_BASELINE_BEGIN_LEASE_LOCK_HOLD_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.beginLeaseLockHoldCampaign",
);
export const SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.fenceLeaseLockHoldCampaign",
);
export const SQLITE_BASELINE_REGISTER_LEASE_LOCK_HOLD_CLEANUP = Symbol(
  "SQLiteBaselineTempStage.registerLeaseLockHoldCleanup",
);
export const SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.completeLeaseLockHoldCampaign",
);
export const SQLITE_BASELINE_ABORT_LEASE_LOCK_HOLD_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.abortLeaseLockHoldCampaign",
);
export const SQLITE_BASELINE_BEGIN_LEGACY_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.beginLegacyCampaign",
);
export const SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.fenceLegacyCampaign",
);
export const SQLITE_BASELINE_REGISTER_LEGACY_CLEANUP = Symbol(
  "SQLiteBaselineTempStage.registerLegacyCleanup",
);
export const SQLITE_BASELINE_COMPLETE_LEGACY_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.completeLegacyCampaign",
);
export const SQLITE_BASELINE_ABORT_LEGACY_CAMPAIGN = Symbol(
  "SQLiteBaselineTempStage.abortLegacyCampaign",
);
export const SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER = Symbol(
  "SQLiteBaselineTempStage.beginCursorStageTransfer",
);
export const SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER = Symbol(
  "SQLiteBaselineTempStage.fenceCursorStageTransfer",
);
export const SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER = Symbol(
  "SQLiteBaselineTempStage.abortCursorStageTransfer",
);
export const SQLITE_BASELINE_CREATE_CURSOR_SEAL_TEMP_TABLE = Symbol(
  "SQLiteBaselineTempStage.createCursorSealTempTable",
);

/** Opaque evidence bound to one stage-private pending write pair. */
export interface SQLiteBaselineOwnedWriteReceipt {
  readonly kind: "sqlite-baseline-owned-write-receipt";
}

export interface SQLiteBaselineCooperativeSource {
  [SQLITE_BASELINE_COOPERATIVE_ENTRIES](
    connection: SQLiteConnection,
    stage: SQLiteBaselineCooperativeStage,
  ): Generator<
    OperationBaselineEntryInput,
    void,
    SQLiteBaselineOwnedWriteReceipt | undefined
  >;
}

export interface SQLiteBaselineCooperativeStage {
  [SQLITE_BASELINE_OWNED_WRITE](
    connection: SQLiteConnection,
    entry: OperationBaselineEntryInput,
    sequence: number,
  ): SQLiteBaselineOwnedWriteReceipt;
  [SQLITE_BASELINE_CONSUME_OWNED_WRITE](
    connection: SQLiteConnection,
    entry: OperationBaselineEntryInput,
    receipt: SQLiteBaselineOwnedWriteReceipt | undefined,
    sequence: number,
    beforeTotalChanges: number,
    currentTotalChanges: number,
    transactionEpoch: bigint,
  ): number;
  [SQLITE_BASELINE_FINISH_COOPERATIVE_WRITES](
    connection: SQLiteConnection,
    expectedSequence: number,
    expectedTotalChanges: number,
    currentTotalChanges: number,
    transactionEpoch: bigint,
  ): void;
  [SQLITE_BASELINE_COOPERATIVE_POISON](message: string): never;
}

export interface SQLiteBaselineOrderedHandoffSourceBinding {
  readonly countsByKind: Readonly<Record<OperationBaselineEntryInput["entryKind"], number>>;
  readonly expectedEntryCount: number;
  readonly sourceEnvelope: unknown;
  readonly totalChanges: number;
  readonly transactionEpoch: bigint;
}

export interface SQLiteBaselineOrderedHandoffSource {
  [SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE](
    connection: SQLiteConnection,
    stage: SQLiteBaselineOrderedHandoffStage,
  ): SQLiteBaselineOrderedHandoffSourceBinding;
}

export interface SQLiteBaselineOrderedHandoffStage {
  [SQLITE_BASELINE_BEGIN_ORDERED_HANDOFF](
    connection: SQLiteConnection,
    expectedEntryCount: number,
    expectedCounts: Readonly<Record<OperationBaselineEntryInput["entryKind"], number>>,
    totalChanges: number,
    transactionEpoch: bigint,
  ): object;
  [SQLITE_BASELINE_FENCE_ORDERED_HANDOFF](session: object): number;
  [SQLITE_BASELINE_REGISTER_ORDERED_HANDOFF_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void;
  [SQLITE_BASELINE_COMPLETE_ORDERED_HANDOFF](
    session: object,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): void;
  [SQLITE_BASELINE_ABORT_ORDERED_HANDOFF](session: object | undefined, message: string): never;
}

export interface SQLiteBaselineStreamRecordCampaignStage {
  [SQLITE_BASELINE_BEGIN_STREAM_RECORD_CAMPAIGN](
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): object;
  [SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](session: object): void;
  [SQLITE_BASELINE_REGISTER_STREAM_RECORD_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void;
  [SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN](session: object): void;
  [SQLITE_BASELINE_ABORT_STREAM_RECORD_CAMPAIGN](
    session: object | undefined,
    message: string,
  ): never;
}

export interface SQLiteBaselineCheckpointCampaignStage {
  [SQLITE_BASELINE_BEGIN_CHECKPOINT_CAMPAIGN](
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): object;
  [SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](session: object): void;
  [SQLITE_BASELINE_REGISTER_CHECKPOINT_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void;
  [SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN](session: object): void;
  [SQLITE_BASELINE_ABORT_CHECKPOINT_CAMPAIGN](
    session: object | undefined,
    message: string,
  ): never;
}

export interface SQLiteBaselineLeaseLockHoldCampaignStage {
  [SQLITE_BASELINE_BEGIN_LEASE_LOCK_HOLD_CAMPAIGN](
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): object;
  [SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](session: object): void;
  [SQLITE_BASELINE_REGISTER_LEASE_LOCK_HOLD_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void;
  [SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN](session: object): void;
  [SQLITE_BASELINE_ABORT_LEASE_LOCK_HOLD_CAMPAIGN](
    session: object | undefined,
    message: string,
  ): never;
}

export interface SQLiteBaselineLegacyCampaignStage {
  [SQLITE_BASELINE_BEGIN_LEGACY_CAMPAIGN](
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
  ): object;
  [SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](session: object): void;
  [SQLITE_BASELINE_REGISTER_LEGACY_CLEANUP](
    session: object,
    cleanup: (() => void) | undefined,
  ): void;
  [SQLITE_BASELINE_COMPLETE_LEGACY_CAMPAIGN](session: object): void;
  [SQLITE_BASELINE_ABORT_LEGACY_CAMPAIGN](
    session: object | undefined,
    message: string,
  ): never;
}

/** Closed B0b owner surface; no hook executes cursor SQL or TEMP DDL. */
export interface SQLiteBaselineCursorStageTransferOwner {
  [SQLITE_BASELINE_BEGIN_CURSOR_STAGE_TRANSFER](
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    provenance: SQLiteCursorPreRebindConnectionProvenance,
  ): object;
  [SQLITE_BASELINE_FENCE_CURSOR_STAGE_TRANSFER](
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    session: object,
  ): void;
  [SQLITE_BASELINE_ABORT_CURSOR_STAGE_TRANSFER](
    session: object | undefined,
    message: string,
  ): never;
  [SQLITE_BASELINE_CREATE_CURSOR_SEAL_TEMP_TABLE](
    connection: SQLiteConnection,
    receipt: SQLiteCursorPreRebindReceipt,
    session: object,
  ): void;
}
