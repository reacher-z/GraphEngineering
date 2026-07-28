import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLITE_BASELINE_COOPERATIVE_ENTRIES,
  SQLITE_BASELINE_OWNED_WRITE,
  type SQLiteBaselineCooperativeSource,
  type SQLiteBaselineCooperativeStage,
  type SQLiteBaselineOwnedWriteReceipt,
} from "./operation-baseline-cooperation.js";
import type {
  SQLiteV1BaselineCounts,
  SQLiteV1BaselineSourceSummary,
} from "./operation-baseline-source.js";
import type { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

export interface SQLiteV1BaselineStagingReport {
  readonly countsByKind: SQLiteV1BaselineCounts;
  readonly entriesStaged: number;
  readonly expectedEntryCount: number;
  readonly exactTempWriteCount: number;
}

function corruption(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_CORRUPTION",
    OPERATION,
    message,
  );
}

/**
 * Stream a captured v1 source through its paired TEMP writer.
 *
 * Required lifecycle: configure TEMP outside a transaction, BEGIN EXCLUSIVE,
 * create the stage, capture the source summary, then call this function. The
 * package root intentionally does not export this pre-migration primitive.
 */
export function stageSQLiteV1BaselineSourceIntoTempStage(
  connection: SQLiteConnection,
  summary: SQLiteV1BaselineSourceSummary,
  stage: SQLiteBaselineTempStage,
): SQLiteV1BaselineStagingReport {
  const source = summary as SQLiteV1BaselineSourceSummary & SQLiteBaselineCooperativeSource;
  const writer = stage as SQLiteBaselineTempStage & SQLiteBaselineCooperativeStage;
  let iterator: ReturnType<SQLiteBaselineCooperativeSource[
    typeof SQLITE_BASELINE_COOPERATIVE_ENTRIES
  ]> | undefined;
  let completed = false;
  let entriesStaged = 0;
  let primaryFailure: unknown;
  try {
    iterator = source[SQLITE_BASELINE_COOPERATIVE_ENTRIES](connection, writer);
    let next = iterator.next();
    while (!next.done) {
      const entry = next.value;
      const receipt: SQLiteBaselineOwnedWriteReceipt = writer[SQLITE_BASELINE_OWNED_WRITE](
        connection,
        entry,
        entriesStaged,
      );
      entriesStaged += 1;
      next = iterator.next(receipt);
    }
    completed = true;
    if (entriesStaged !== summary.expectedEntryCount) {
      return corruption("SQLite baseline cooperative source count is invalid");
    }
    stage.assertCommonCounts(summary.countsByKind);
    stage.assertRelationKeyCoverage();
    const exactTempWriteCount = entriesStaged * 2;
    if (!Number.isSafeInteger(exactTempWriteCount)) {
      return corruption("SQLite baseline cooperative TEMP write count is outside bounds");
    }
    return Object.freeze({
      countsByKind: summary.countsByKind,
      entriesStaged,
      exactTempWriteCount,
      expectedEntryCount: summary.expectedEntryCount,
    });
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    if (!completed) {
      try {
        iterator?.return?.();
      } catch (cleanupError) {
        if (primaryFailure === undefined) throw cleanupError;
      }
    }
  }
}
