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
