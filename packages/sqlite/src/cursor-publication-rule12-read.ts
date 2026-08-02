import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_SHA256_INTRINSIC,
} from "./cursor-publication-rebind-contract.js";
import {
  beginSQLiteConnectionPostRebindSealScanIntrinsic,
  disposeSQLiteConnectionPostRebindSealScanIntrinsic,
  executeSQLiteConnectionPostRebindSealScanIntrinsic,
  injectSQLiteConnectionPostRebindSealScanCloseFaultForTestIntrinsic,
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionPostRebindSealScanSnapshotIntrinsic,
  readSQLiteConnectionTotalChangesSnapshot,
  type SQLiteConnection,
  type SQLiteConnectionCursorRebindExecution,
  type SQLiteConnectionPostRebindSealScanExecution,
  type SQLiteConnectionPostRebindSealScanSnapshot,
  type SQLiteConnectionTransactionLineage,
} from "./sqlite-connection.js";

const objectCreateIntrinsic = Object.create;
const objectFreezeIntrinsic = Object.freeze;
const reflectApplyIntrinsic = Reflect.apply;
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const OPERATION = "inspect-schema" as const;

/**
 * Opaque connection-only post-rebind read. This is deliberately not a Rule 12
 * receipt and cannot authorize a provider-clock observation.
 */
export interface SQLiteConnectionPostRebindSealReadExecution {
  readonly __sqliteConnectionPostRebindSealReadExecution: never;
}

export interface SQLiteConnectionPostRebindSealReadEvidence {
  readonly lifecycle: "completed";
  readonly mainKeyCount: number;
  readonly driverCount: number;
  readonly lookupCount: number;
  readonly accumulatorCount: number;
  readonly computedImmutableRootSha256: string;
  readonly observedDescriptorHash: string | null;
  readonly observedSchemaIdentitySha256: string | null;
  readonly mainKeyCountPrepareCount: 1;
  readonly mainKeyCountRows: number;
  readonly mainKeyCountTerminalFetchCount: 1;
  readonly mainKeyCountCloseAttemptCount: 1;
  readonly mainKeyCountCloseCount: 1;
  readonly driverPrepareCount: 1;
  readonly driverRows: number;
  readonly driverTerminalFetchCount: 1;
  readonly driverCloseAttemptCount: 1;
  readonly driverCloseCount: 1;
  readonly pointStatementPrepareCount: 1;
  readonly pointStatementExecuteCount: number;
  readonly pointStatementReleaseCount: 1;
  readonly pointCursorCreatedCount: number;
  readonly pointCursorCloseAttemptCount: number;
  readonly pointCursorClosedCount: number;
  readonly activeCursors: 0;
  readonly livePhysicalRows: 0;
  readonly liveCarriers: 0;
  readonly maximumActiveCursors: number;
  readonly maximumLivePhysicalRows: number;
  readonly maximumLiveCarriers: number;
  readonly transactionEpoch: bigint;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly totalChanges: number;
  readonly mainKeyCountSql: typeof SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_INTRINSIC;
  readonly mainKeyCountSqlSha256: typeof SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_SHA256_INTRINSIC;
  readonly driverSql: typeof SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_INTRINSIC;
  readonly driverSqlSha256: typeof SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_SHA256_INTRINSIC;
  readonly pointLookupSql: typeof SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_INTRINSIC;
  readonly pointLookupSqlSha256: typeof SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_SHA256_INTRINSIC;
}

export interface SQLiteConnectionPostRebindSealReadSnapshot {
  readonly lifecycle: "active" | "completed" | "released" | "poisoned";
  readonly mainKeyCount: number;
  readonly driverCount: number;
  readonly lookupCount: number;
  readonly mainKeyCountPrepareCount: 0 | 1;
  readonly mainKeyCountTerminalFetchCount: 0 | 1;
  readonly mainKeyCountCloseAttemptCount: number;
  readonly mainKeyCountCloseCount: 0 | 1;
  readonly driverPrepareCount: 0 | 1;
  readonly driverTerminalFetchCount: 0 | 1;
  readonly driverCloseAttemptCount: number;
  readonly driverCloseCount: 0 | 1;
  readonly pointStatementPrepareCount: 0 | 1;
  readonly pointStatementExecuteCount: number;
  readonly pointStatementReleaseCount: 0 | 1;
  readonly pointCursorCreatedCount: number;
  readonly pointCursorCloseAttemptCount: number;
  readonly pointCursorClosedCount: number;
  readonly activeCursors: number;
  readonly livePhysicalRows: number;
  readonly liveCarriers: number;
  readonly maximumActiveCursors: number;
  readonly maximumLivePhysicalRows: number;
  readonly maximumLiveCarriers: number;
  readonly mainStatementOwned: boolean;
  readonly mainIteratorOwned: boolean;
  readonly driverStatementOwned: boolean;
  readonly driverIteratorOwned: boolean;
  readonly pointStatementOwned: boolean;
  readonly pointIteratorOwned: boolean;
  readonly rootDisclosed: false;
}

interface ReadState {
  readonly connection: SQLiteConnection;
  readonly rebindExecution: SQLiteConnectionCursorRebindExecution;
  readonly scanExecution: SQLiteConnectionPostRebindSealScanExecution;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transactionEpoch: bigint;
  readonly totalChanges: number;
  lifecycle: "active" | "completed" | "released" | "poisoned";
}

const READS = new WeakMap<object, ReadState>();
const USED_REBINDS = new WeakMap<object, true>();

function providerError(
  code: "GE_CYCLE_STORE_INVALID_ARGUMENT" | "GE_CYCLE_STORE_CORRUPTION",
  message: string,
): CycleStoreProviderError {
  return new CycleStoreProviderError(code, OPERATION, message);
}

function readState(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealReadExecution,
): ReadState {
  const state = execution !== null && typeof execution === "object" && !isProxy(execution)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, READS, [execution as object]) as ReadState | undefined
    : undefined;
  if (state === undefined || state.connection !== connection) {
    throw providerError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite post-rebind seal read execution is invalid",
    );
  }
  return state;
}

function assertOwnerUnchanged(state: ReadState): void {
  const owner = readSQLiteConnectionOwnerSnapshot(state.connection);
  const total = readSQLiteConnectionTotalChangesSnapshot(state.connection);
  if (!owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage !== state.transactionLineage
      || owner.transactionEpoch !== state.transactionEpoch
      || total.transactionEpoch !== state.transactionEpoch
      || total.totalChanges !== state.totalChanges) {
    throw providerError(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-rebind seal read connection lineage drifted",
    );
  }
}

/** Package-private one-shot seam for close precedence and ownership tests. */
export function injectSQLiteConnectionPostRebindSealReadCloseFaultForTestIntrinsic(
  kind: "main-key-count" | "driver" | "point",
  error: unknown,
): void {
  injectSQLiteConnectionPostRebindSealScanCloseFaultForTestIntrinsic(kind, error);
}

/** Begin one zero-authority-input read after an exact completed rebind. */
export function beginSQLiteConnectionPostRebindSealReadIntrinsic(
  connection: SQLiteConnection,
  rebindExecution: SQLiteConnectionCursorRebindExecution,
): SQLiteConnectionPostRebindSealReadExecution {
  const rebind = readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
    connection, rebindExecution,
  );
  const owner = readSQLiteConnectionOwnerSnapshot(connection);
  const total = readSQLiteConnectionTotalChangesSnapshot(connection);
  if (rebind.lifecycle !== "completed" || rebind.releaseCount !== 1
      || !rebind.statementOwnershipRetired || !owner.isTransaction
      || owner.transactionMode !== "exclusive" || owner.transactionLineage === null
      || owner.transactionLineage !== rebind.transactionLineage
      || owner.transactionEpoch !== rebind.transactionEpoch
      || total.transactionEpoch !== owner.transactionEpoch
      || total.totalChanges !== rebind.totalChangesAfter) {
    throw providerError(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-rebind seal read owner is not complete",
    );
  }
  if (reflectApplyIntrinsic(
    weakMapGetIntrinsic, USED_REBINDS, [rebindExecution as object],
  ) !== undefined) {
    throw providerError(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-rebind seal read already began",
    );
  }
  const execution = objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as SQLiteConnectionPostRebindSealReadExecution;
  const state: ReadState = {
    connection,
    rebindExecution,
    scanExecution: beginSQLiteConnectionPostRebindSealScanIntrinsic(connection),
    transactionLineage: owner.transactionLineage,
    transactionEpoch: owner.transactionEpoch,
    totalChanges: total.totalChanges,
    lifecycle: "active",
  };
  reflectApplyIntrinsic(weakMapSetIntrinsic, READS, [execution as object, state]);
  reflectApplyIntrinsic(weakMapSetIntrinsic, USED_REBINDS, [rebindExecution as object, true]);
  return execution;
}

/** Execute the fixed connection-owned scan once; this never mints a Rule 12 receipt. */
export function executeSQLiteConnectionPostRebindSealReadIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealReadExecution,
): SQLiteConnectionPostRebindSealReadEvidence {
  const state = readState(connection, execution);
  if (state.lifecycle !== "active") {
    throw providerError(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-rebind seal read execution is terminal",
    );
  }
  let scan: ReturnType<typeof executeSQLiteConnectionPostRebindSealScanIntrinsic>;
  try {
    assertOwnerUnchanged(state);
    scan = executeSQLiteConnectionPostRebindSealScanIntrinsic(
      connection, state.scanExecution,
    );
    assertOwnerUnchanged(state);
    if (scan.transactionLineage !== state.transactionLineage
        || scan.transactionEpoch !== state.transactionEpoch
        || scan.totalChanges !== state.totalChanges
        || scan.mainKeyCount !== scan.driverCount
        || scan.mainKeyCount !== scan.pointStatementExecuteCount
        || scan.mainKeyCount !== scan.lookupCount
        || scan.mainKeyCount !== scan.accumulatorCount) {
      throw providerError(
        "GE_CYCLE_STORE_CORRUPTION",
        "SQLite post-rebind seal read evidence is inconsistent",
      );
    }
    state.lifecycle = "completed";
  } catch (error) {
    state.lifecycle = "poisoned";
    throw error;
  }
  return objectFreezeIntrinsic({
    lifecycle: "completed",
    mainKeyCount: scan.mainKeyCount,
    driverCount: scan.driverCount,
    lookupCount: scan.lookupCount,
    accumulatorCount: scan.accumulatorCount,
    computedImmutableRootSha256: scan.computedImmutableRootSha256,
    observedDescriptorHash: scan.observedDescriptorHash,
    observedSchemaIdentitySha256: scan.observedSchemaIdentitySha256,
    mainKeyCountPrepareCount: scan.mainKeyCountPrepareCount,
    mainKeyCountRows: scan.mainKeyCount,
    mainKeyCountTerminalFetchCount: scan.mainKeyCountTerminalFetchCount,
    mainKeyCountCloseAttemptCount: scan.mainKeyCountCloseAttemptCount,
    mainKeyCountCloseCount: scan.mainKeyCountCloseCount,
    driverPrepareCount: scan.driverPrepareCount,
    driverRows: scan.driverCount,
    driverTerminalFetchCount: scan.driverTerminalFetchCount,
    driverCloseAttemptCount: scan.driverCloseAttemptCount,
    driverCloseCount: scan.driverCloseCount,
    pointStatementPrepareCount: scan.pointStatementPrepareCount,
    pointStatementExecuteCount: scan.pointStatementExecuteCount,
    pointStatementReleaseCount: scan.pointStatementReleaseCount,
    pointCursorCreatedCount: scan.pointCursorCreatedCount,
    pointCursorCloseAttemptCount: scan.pointCursorCloseAttemptCount,
    pointCursorClosedCount: scan.pointCursorClosedCount,
    activeCursors: 0,
    livePhysicalRows: 0,
    liveCarriers: 0,
    maximumActiveCursors: scan.maximumActiveCursors,
    maximumLivePhysicalRows: scan.maximumLivePhysicalRows,
    maximumLiveCarriers: scan.maximumLiveCarriers,
    transactionEpoch: scan.transactionEpoch,
    transactionLineage: scan.transactionLineage,
    totalChanges: scan.totalChanges,
    mainKeyCountSql: SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_INTRINSIC,
    mainKeyCountSqlSha256:
      SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_SHA256_INTRINSIC,
    driverSql: SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_INTRINSIC,
    driverSqlSha256: SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_SHA256_INTRINSIC,
    pointLookupSql: SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_INTRINSIC,
    pointLookupSqlSha256: SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_SHA256_INTRINSIC,
  });
}

function readScan(state: ReadState): SQLiteConnectionPostRebindSealScanSnapshot {
  return readSQLiteConnectionPostRebindSealScanSnapshotIntrinsic(
    state.connection, state.scanExecution,
  );
}

/** Retire an unexecuted read. There is no retry after release. */
export function releaseSQLiteConnectionPostRebindSealReadIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealReadExecution,
): SQLiteConnectionPostRebindSealReadSnapshot {
  const state = readState(connection, execution);
  if (state.lifecycle !== "active") {
    throw providerError(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-rebind seal read release is terminal",
    );
  }
  disposeSQLiteConnectionPostRebindSealScanIntrinsic(connection, state.scanExecution);
  state.lifecycle = "released";
  return readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(connection, execution);
}

/** Recover retained native handles after poison without making the read reusable. */
export function disposeSQLiteConnectionPostRebindSealReadIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealReadExecution,
): SQLiteConnectionPostRebindSealReadSnapshot {
  const state = readState(connection, execution);
  if (state.lifecycle !== "poisoned") {
    throw providerError(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite post-rebind seal read dispose requires a poisoned execution",
    );
  }
  disposeSQLiteConnectionPostRebindSealScanIntrinsic(connection, state.scanExecution);
  return readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(connection, execution);
}

/** Failure snapshots never disclose a partial or computed root. */
export function readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionPostRebindSealReadExecution,
): SQLiteConnectionPostRebindSealReadSnapshot {
  const state = readState(connection, execution);
  const scan = readScan(state);
  return objectFreezeIntrinsic({
    lifecycle: state.lifecycle,
    mainKeyCount: scan.mainKeyCount,
    driverCount: scan.driverCount,
    lookupCount: scan.lookupCount,
    mainKeyCountPrepareCount: scan.mainKeyCountPrepareCount,
    mainKeyCountTerminalFetchCount: scan.mainKeyCountTerminalFetchCount,
    mainKeyCountCloseAttemptCount: scan.mainKeyCountCloseAttemptCount,
    mainKeyCountCloseCount: scan.mainKeyCountCloseCount,
    driverPrepareCount: scan.driverPrepareCount,
    driverTerminalFetchCount: scan.driverTerminalFetchCount,
    driverCloseAttemptCount: scan.driverCloseAttemptCount,
    driverCloseCount: scan.driverCloseCount,
    pointStatementPrepareCount: scan.pointStatementPrepareCount,
    pointStatementExecuteCount: scan.pointStatementExecuteCount,
    pointStatementReleaseCount: scan.pointStatementReleaseCount,
    pointCursorCreatedCount: scan.pointCursorCreatedCount,
    pointCursorCloseAttemptCount: scan.pointCursorCloseAttemptCount,
    pointCursorClosedCount: scan.pointCursorClosedCount,
    activeCursors: scan.activeCursors,
    livePhysicalRows: scan.livePhysicalRows,
    liveCarriers: scan.liveCarriers,
    maximumActiveCursors: scan.maximumActiveCursors,
    maximumLivePhysicalRows: scan.maximumLivePhysicalRows,
    maximumLiveCarriers: scan.maximumLiveCarriers,
    mainStatementOwned: scan.mainStatementOwned,
    mainIteratorOwned: scan.mainIteratorOwned,
    driverStatementOwned: scan.driverStatementOwned,
    driverIteratorOwned: scan.driverIteratorOwned,
    pointStatementOwned: scan.pointStatementOwned,
    pointIteratorOwned: scan.pointIteratorOwned,
    rootDisclosed: false,
  });
}
