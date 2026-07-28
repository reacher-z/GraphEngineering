import type { OperationBaselineEntryInput } from "./operation-baseline.js";
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
    actualEntryCount: number,
  ): void;
  [SQLITE_BASELINE_ABORT_ORDERED_HANDOFF](session: object | undefined, message: string): never;
}
