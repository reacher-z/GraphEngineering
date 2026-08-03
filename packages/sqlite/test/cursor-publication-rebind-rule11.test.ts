import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import * as sqliteRoot from "../src/index.js";

import {
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
} from "../src/cursor-publication-rebind-contract.js";
import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  createSQLiteCursorPublicationSessionCancellationControllerIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic,
  prepareSQLiteCursorPublicationRebindContextIntrinsic,
  readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic,
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
  readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic,
  readSQLiteCursorPublicationSessionSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic,
  type SQLiteCursorInitialPublicationReceiptBundle,
  type SQLiteCursorPublicationSession,
} from "../src/cursor-publication-outer-authority.js";
import {
  SQLITE_CURSOR_REBIND_RULE11_ID_INTRINSIC,
  SQLITE_CURSOR_REBIND_RULE11_POSITION_INTRINSIC,
  evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic,
  executeSQLiteCursorPublicationRebindRule11Intrinsic,
  executeSQLiteCursorRebindRule11GateIntrinsic,
  injectSQLiteCursorRebindCancelBeforeExecuteForTestIntrinsic,
  injectSQLiteCursorRebindCompletedFailureRegistrationFailureForTestIntrinsic,
  injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic,
  injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic,
  injectSQLiteCursorRebindPostconsumeChangesFaultRegistrationFailureForTestIntrinsic,
  injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic,
  injectSQLiteCursorRebindPreconsumeReleaseFaultRegistrationFailureForTestIntrinsic,
  injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic,
  readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic,
  readSQLiteCursorRebindEvidenceMismatchOutcomeForTestIntrinsic,
  readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic,
  takeSQLiteCursorRebindCompletedFailureForFinalizerIntrinsic,
  type SQLiteCursorRebindEvidenceMismatchOutcomeForTest,
  type SQLiteCursorRebindRule11FiveCounts,
} from "../src/cursor-publication-rebind.js";
import {
  assertSQLiteCursorPreRebindReceiptProvenance,
} from "../src/operation-baseline-cursor-ownership.js";
import {
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
} from "../src/operation-baseline-cursor-invariants.js";
import {
  SQLiteConnection,
  beginSQLiteConnectionCursorRebindExecutionIntrinsic,
  executeSQLiteConnectionCursorRebindIntrinsic,
  injectSQLiteConnectionCursorRebindChangesFaultRegistrationFailureForTestIntrinsic,
  injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic,
  readSQLiteConnectionCursorRebindChangesFailureBoundaryIntrinsic,
  injectSQLiteConnectionCursorRebindReleaseFaultRegistrationFailureForTestIntrinsic,
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic,
  takeSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic,
  type SQLiteConnectionCursorRebindExecution,
  type SQLiteCursorRebindEvidenceMismatchDimension,
} from "../src/sqlite-connection.js";
import {
  finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic,
  captureSQLiteCursorPostConsumeTransactionFailureIntrinsic,
  injectSQLiteCursorPostConsumeCloseAfterNativeReturnAmbiguousFaultForTestIntrinsic,
  injectSQLiteCursorPostConsumeRollbackAfterNativeReturnAmbiguousFaultForTestIntrinsic,
  readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic,
} from "../src/cursor-publication-transaction-finalizer.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const graphs: ReaderLeaseTestGraph[] = [];

function graph(cursorCount = 0): ReaderLeaseTestGraph {
  const value = createReaderLeaseTestGraph(1, { cursorCount });
  graphs.push(value);
  return value;
}

function publicationSession(value: ReaderLeaseTestGraph): SQLiteCursorPublicationSession {
  const reader = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
  );
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
    reader,
  );
  const entries = executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
    reader,
  );
  const header = executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
    reader,
    entries,
  );
  const sequence = executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
    value.authority,
    value.migration0002Receipt,
    value.fence,
    reader,
    entries,
    header,
  );
  const bundle = Object.freeze([
    value.migration0002Receipt,
    entries,
    header,
    sequence,
  ] as const satisfies SQLiteCursorInitialPublicationReceiptBundle);
  const adoption = adoptSQLiteCursorInitialPublicationStageIntrinsic(
    value.authority,
    bundle,
    value.fence,
    reader,
  );
  const prepared = prepareSQLiteCursorPublicationSessionIntrinsic(value.authority, adoption);
  const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(prepared);
  return publishSQLiteCursorPublicationSessionIntrinsic(prepared, evidence);
}

function counts(value: number): SQLiteCursorRebindRule11FiveCounts {
  return Object.freeze({
    b2CursorCount: value,
    nativeAffectedCount: value,
    changesAffectedCount: value,
    totalChangesDelta: value,
    cursorLedgerAffectedDelta: value,
  });
}

const EVIDENCE_DIMENSION_PAIRS = [
  ["native-affected", "changes-affected"],
  ["native-affected", "total-delta"],
  ["native-affected", "outer-ledger"],
  ["native-affected", "cursor-ledger"],
  ["changes-affected", "total-delta"],
  ["changes-affected", "outer-ledger"],
  ["changes-affected", "cursor-ledger"],
  ["total-delta", "outer-ledger"],
  ["total-delta", "cursor-ledger"],
  ["outer-ledger", "cursor-ledger"],
] as const satisfies readonly (readonly [
  SQLiteCursorRebindEvidenceMismatchDimension,
  SQLiteCursorRebindEvidenceMismatchDimension,
])[];

const EVIDENCE_MULTI_DIMENSION_CASES = [
  ["native-affected", "changes-affected", "total-delta"],
  ["changes-affected", "outer-ledger", "cursor-ledger"],
  ["native-affected", "changes-affected", "total-delta", "cursor-ledger"],
  [
    "native-affected",
    "changes-affected",
    "total-delta",
    "outer-ledger",
    "cursor-ledger",
  ],
] as const satisfies readonly (
  readonly SQLiteCursorRebindEvidenceMismatchDimension[]
)[];

function installNativeRebindAbortTrigger(
  connection: ReaderLeaseTestGraph["connection"],
): void {
  connection.execTrusted(
    "CREATE TEMP TRIGGER ge_rule11_native_run_abort "
      + "BEFORE UPDATE ON main.ge_cycle_cursors BEGIN "
      + "SELECT RAISE(ABORT, 'rule11 native run abort'); END",
    "inspect-schema",
  );
}

interface TrackedReferent {
  readonly label: string;
  readonly reference: WeakRef<object>;
}

function trackDroppedScenario(
  scenario: "success" | "prewrite-cancel" | "postconsume-poison"
    | "write-fault" | "rule11-fault" | "native-run-fault"
    | "release-fault" | "abandoned-release-fault" | "abandoned-changes-fault"
    | "abandoned-completed-mismatch",
): Readonly<{
  readonly finalized: Set<string>;
  readonly referents: readonly TrackedReferent[];
  readonly registry: FinalizationRegistry<string>;
}> {
  const value = createReaderLeaseTestGraph(1, scenario === "native-run-fault"
    ? {
      beforeBaselineStageCreation: installNativeRebindAbortTrigger,
      cursorCount: 1,
    }
    : {});
  const session = publicationSession(value);
  let identities: readonly (readonly [string, object])[];
  if (scenario === "abandoned-completed-mismatch") {
    injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
      session,
      Object.freeze(["native-affected", "changes-affected"]),
    );
    let primary: unknown;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch (error) {
      primary = error;
    }
    if (!(primary instanceof Error)) throw new Error("completed mismatch primary is absent");
    const retainedPrimary = primary as Error & { graph?: object; session?: object };
    retainedPrimary.graph = value;
    retainedPrimary.session = session;
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
    const context = authority.publicationRebindContext!;
    const tombstone = authority.publicationSessionConsumedTombstone!;
    const adoption = authority.postRebindWatermarkAdoption!;
    const execution = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context).execution;
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["context", context],
      ["tombstone", tombstone],
      ["adoption", adoption],
      ["execution", execution],
      ["reverse-root-error", retainedPrimary],
    ];
  } else if (scenario === "abandoned-changes-fault") {
    const error = new Error("abandoned exact-S changes fault") as Error & {
      authority?: object;
      session?: object;
    };
    error.authority = value.authority;
    error.session = session;
    injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
      session,
      "fetch-after-native-return",
      error,
    );
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["reverse-root-error", error],
    ];
  } else if (scenario === "abandoned-release-fault") {
    const error = new Error("abandoned exact-S release fault") as Error & {
      authority?: object;
      session?: object;
    };
    error.authority = value.authority;
    error.session = session;
    injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(session, error);
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["reverse-root-error", error],
    ];
  } else if (scenario === "release-fault") {
    const error = new Error("selected exact-S release fault") as Error & {
      authority?: object;
      session?: object;
    };
    error.authority = value.authority;
    error.session = session;
    injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(session, error);
    let caught: unknown;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch (selected) {
      caught = selected;
    }
    if (caught !== error) throw new Error("exact-S release primary identity was replaced");
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
    const context = authority.publicationRebindContext!;
    const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    if (authority.lifecycle !== "poisoned"
        || authority.publicationSessionConsumedTombstone !== undefined
        || authority.postRebindWatermarkAdoption !== undefined
        || contextSnapshot.lifecycle !== "poisoned"
        || readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
          value.connection,
          contextSnapshot.execution,
        ).lifecycle !== "poisoned") {
      throw new Error("exact-S release graph was not terminal before GC tracking");
    }
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["prepared-owner", contextSnapshot.preparedOwner],
      ["context", context],
      ["execution", contextSnapshot.execution],
      ["reverse-root-error", error],
    ];
  } else if (scenario === "prewrite-cancel") {
    const sessionSnapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(
      sessionSnapshot.connection,
    );
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(session, execution);
    const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(
      context,
      contextSnapshot.preparedOwner,
    );
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["prepared-owner", contextSnapshot.preparedOwner],
      ["context", context],
      ["execution", execution],
    ];
  } else if (scenario === "success" || scenario === "postconsume-poison") {
    const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
    const write = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt);
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["prepared-owner", rule.preparedOwner],
      ["context", rule.context],
      ["tombstone", rule.consumedTombstone],
      ["adoption", rule.watermarkAdoption],
      ["execution", write.execution],
      ["write", rule.writeReceipt],
      ["rule11", rule11],
    ];
    if (scenario === "postconsume-poison") {
      poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
        rule.context,
        rule.consumedTombstone,
        rule.watermarkAdoption,
        "GC post-consume poison",
      );
    }
  } else if (scenario === "native-run-fault") {
    let failed = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error("expected native run failure");
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
    const context = authority.publicationRebindContext!;
    const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    const tombstone = authority.publicationSessionConsumedTombstone!;
    const executionSnapshot = readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      value.connection,
      contextSnapshot.execution,
    );
    if (authority.lifecycle !== "poisoned"
        || authority.postRebindWatermarkAdoption !== undefined
        || contextSnapshot.lifecycle !== "poisoned"
        || readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic(tombstone)
          .lifecycle !== "poisoned"
        || executionSnapshot.lifecycle !== "poisoned"
        || executionSnapshot.executeCount !== 1
        || executionSnapshot.releaseCount !== 1
        || !executionSnapshot.statementOwnershipRetired) {
      throw new Error("native run failure graph was not terminal before GC tracking");
    }
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["prepared-owner", contextSnapshot.preparedOwner],
      ["context", context],
      ["tombstone", tombstone],
      ["execution", contextSnapshot.execution],
    ];
  } else {
    injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic(
      scenario === "write-fault" ? "write" : "rule11",
      Object.freeze({ scenario }),
    );
    let failed = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error(`expected ${scenario} registration failure`);
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
    const context = authority.publicationRebindContext!;
    const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    identities = [
      ["graph", value],
      ["authority", value.authority],
      ["connection", value.connection],
      ["session", session],
      ["prepared-owner", contextSnapshot.preparedOwner],
      ["context", context],
      ["tombstone", authority.publicationSessionConsumedTombstone!],
      ["adoption", authority.postRebindWatermarkAdoption!],
      ["execution", contextSnapshot.execution],
    ];
  }
  const finalized = new Set<string>();
  const registry = new FinalizationRegistry<string>((label) => finalized.add(label));
  const referents = identities.map(([label, identity]) => {
    const qualified = `${scenario}:${label}`;
    registry.register(identity, qualified);
    return { label: qualified, reference: new WeakRef(identity) };
  });
  disposeReaderLeaseTestGraph(value);
  return { finalized, referents, registry };
}

async function forceBoundedCollection(
  referents: readonly TrackedReferent[],
): Promise<readonly string[]> {
  for (let round = 0; round < 80; round += 1) {
    globalThis.gc!();
    const pressure = Array.from({ length: 8 }, () => new Uint8Array(2 * 1024 * 1024));
    pressure[round % pressure.length]![0] = round;
    await new Promise<void>((resolve) => setImmediate(resolve));
    globalThis.gc!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const live = referents.filter(({ reference }) => reference.deref() !== undefined);
    if (live.length === 0) return [];
  }
  return referents
    .filter(({ reference }) => reference.deref() !== undefined)
    .map(({ label }) => label);
}

function armAndDropExactSReleaseError(
  session: SQLiteCursorPublicationSession,
): WeakRef<object> {
  const error = new Error("dead exact-S release primary");
  injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(session, error);
  return new WeakRef(error);
}

function armAndDropExactSChangesError(
  session: SQLiteCursorPublicationSession,
): WeakRef<object> {
  const error = new Error("dead exact-S changes primary");
  injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
    session,
    "fetch-after-native-return",
    error,
  );
  return new WeakRef(error);
}

function trackAbandonedExactSRegistrationFailure(): Readonly<{
  readonly finalized: Set<string>;
  readonly referents: readonly TrackedReferent[];
  readonly registry: FinalizationRegistry<string>;
}> {
  const value = createReaderLeaseTestGraph(1, { cursorCount: 1 });
  const session = publicationSession(value);
  const error = new Error("abandoned exact-S registration failure") as Error & {
    authority?: object;
    graph?: object;
    session?: object;
  };
  error.authority = value.authority;
  error.graph = value;
  error.session = session;
  injectSQLiteCursorRebindPreconsumeReleaseFaultRegistrationFailureForTestIntrinsic(error);
  const finalized = new Set<string>();
  const registry = new FinalizationRegistry<string>((label) => finalized.add(label));
  const values = [
    ["registration-graph", value],
    ["registration-authority", value.authority],
    ["registration-connection", value.connection],
    ["registration-session", session],
    ["registration-error", error],
  ] as const;
  const referents = values.map(([label, identity]) => {
    registry.register(identity, label);
    return { label, reference: new WeakRef(identity) };
  });
  disposeReaderLeaseTestGraph(value);
  return { finalized, referents, registry };
}

function expectEvidenceMismatchFailClosed(
  dimensions: readonly SQLiteCursorRebindEvidenceMismatchDimension[],
): void {
  const selected = graph(1);
  const unselected = graph(1);
  const selectedSession = publicationSession(selected);
  const unselectedSession = publicationSession(unselected);
  injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(selectedSession, dimensions);

  const unselectedRule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(
    unselectedSession,
  );
  expect(readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(unselectedRule11))
    .toMatchObject({ lifecycle: "active", counts: counts(1), violationCount: 0 });
  expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(unselected.authority))
    .toMatchObject({ lifecycle: "active", writePhase: "cursor-rebind-adopted" });

  const capture = captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(selectedSession);

  const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
    selected.authority,
  );
  const context = authority.publicationRebindContext!;
  const tombstone = authority.publicationSessionConsumedTombstone!;
  const adoption = authority.postRebindWatermarkAdoption!;
  const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
  const execution = contextSnapshot.execution;
  const native = readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
    selected.connection,
    execution,
  );
  const hasOuter = dimensions.includes("outer-ledger");
  const firstPoisonReason = hasOuter
    ? "SQLite rebind evidence mismatch outer ledger"
    : "SQLite Rule 11 five counts disagree";
  expect(capture.leafPrimary).toMatchObject({
    code: "GE_CYCLE_STORE_CORRUPTION",
    message: firstPoisonReason,
  });
  expect(readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
    capture.owner,
  )).toMatchObject({
    lifecycle: "prepared",
    primaryBoundary: hasOuter ? "rule11-outer-ledger" : "rule11-five-count",
    rollbackAttemptCount: 0,
    closeAttemptCount: 0,
  });
  const expectedOutcome: SQLiteCursorRebindEvidenceMismatchOutcomeForTest = {
    adoptionLifecycle: "poisoned",
    countEvaluation: {
      accepted: false,
      violationCount: 1,
    },
    dimensions,
    evaluatedDimensions: dimensions,
    firstPoisonReason,
    outerMismatch: hasOuter,
    projectedCounts: {
      b2CursorCount: 1,
      nativeAffectedCount: dimensions.includes("native-affected") ? 2 : 1,
      changesAffectedCount: dimensions.includes("changes-affected") ? 2 : 1,
      totalChangesDelta: dimensions.includes("total-delta") ? 2 : 1,
      cursorLedgerAffectedDelta: dimensions.includes("cursor-ledger") ? 2 : 1,
    },
    realEvidenceObserved: true,
    rule11Lifecycle: "absent",
    tombstoneLifecycle: "poisoned",
    writeLifecycle: hasOuter ? "absent" : "poisoned",
  };

  expect(authority).toMatchObject({
    lifecycle: "poisoned",
    stageOwnershipPoisonReason: firstPoisonReason,
    writePhase: "poisoned",
  });
  expect(readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context).lifecycle)
    .toBe("poisoned");
  expect(readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic(tombstone).lifecycle)
    .toBe("poisoned");
  expect(() => readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic(adoption))
    .toThrow(/post-rebind adoption is invalid/u);
  expect(readSQLiteCursorRebindEvidenceMismatchOutcomeForTestIntrinsic(
    selected.connection,
    execution,
  )).toEqual(expectedOutcome);
  expect(native).toMatchObject({
    affectedRows: 1,
    changesAffectedRows: 1,
    changesFetchCount: 1,
    changesPrepareCount: 1,
    changesReleaseCount: 1,
    cursorLedgerAffectedRowsWatermark: 1,
    cursorLedgerFixedStatementCount: 1,
    cursorLedgerLogicalWriteSequence: 1,
    executeCount: 1,
    lifecycle: "completed",
    releaseCount: 1,
    totalChangesDelta: 1,
  });

  if (dimensions.length === 5) {
    injectSQLiteCursorPostConsumeRollbackAfterNativeReturnAmbiguousFaultForTestIntrinsic(
      capture.owner,
    );
    injectSQLiteCursorPostConsumeCloseAfterNativeReturnAmbiguousFaultForTestIntrinsic(
      capture.owner,
    );
  }

  let finalizedPrimary: unknown;
  try {
    finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(capture.owner);
  } catch (error) {
    finalizedPrimary = error;
  }
  expect(finalizedPrimary).toBe(capture.leafPrimary);
  expect(readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
    capture.owner,
  )).toMatchObject({
    lifecycle: "finalized",
    primaryBoundary: hasOuter ? "rule11-outer-ledger" : "rule11-five-count",
    rollbackAttemptCount: 1,
    rollbackNativeReturnCount: 1,
    rollbackSecondaryFailureCount: dimensions.length === 5 ? 1 : 0,
    closeAttemptCount: 1,
    closeNativeReturnCount: 1,
    closeTertiaryFailureCount: dimensions.length === 5 ? 1 : 0,
  });
  const reopened = new SQLiteConnection(`${selected.root}/cycle-store.db`);
  try {
    expect(reopened.prepare(
      "SELECT count(*) FROM main.ge_cycle_cursors",
      "inspect-schema",
    ).get()).toEqual([0n]);
  } finally {
    reopened.close();
  }
}

afterEach(() => {
  for (const value of graphs.splice(0)) disposeReaderLeaseTestGraph(value);
});

describe("SQLite cursor publication rebind Rule 11 integration", () => {
  it("evaluates exactly five explicit counts under hostile iterator mutation", () => {
    for (const value of [0, 1, 7, Number.MAX_SAFE_INTEGER]) {
      expect(evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(counts(value))).toEqual({
        accepted: true,
        counts: counts(value),
        violationCount: 0,
        diagnosticsTruncated: false,
      });
    }
    const candidates: Array<keyof SQLiteCursorRebindRule11FiveCounts> = [
      "b2CursorCount",
      "nativeAffectedCount",
      "changesAffectedCount",
      "totalChangesDelta",
      "cursorLedgerAffectedDelta",
    ];
    for (let index = 0; index < candidates.length; index += 1) {
      const key = candidates[index]!;
      expect(evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic({
        ...counts(7),
        [key]: 6,
      })).toMatchObject({ accepted: false, violationCount: 1 });
    }
    const original = Array.prototype[Symbol.iterator];
    Array.prototype[Symbol.iterator] = function* (): Generator<never> {
      return undefined;
    };
    try {
      expect(evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(counts(3)))
        .toMatchObject({ accepted: true, violationCount: 0 });
    } finally {
      Array.prototype[Symbol.iterator] = original;
    }
    expect(() => evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(
      new Proxy(counts(0), {}),
    )).toThrow(/count tuple is invalid/u);
    expect(() => evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic({
      ...counts(0),
      extra: 0,
    } as SQLiteCursorRebindRule11FiveCounts)).toThrow(/count tuple is invalid/u);
  });

  it.each(EVIDENCE_DIMENSION_PAIRS)(
    "fails closed for authentic post-observation evidence pair %s + %s",
    (left, right) => {
      expectEvidenceMismatchFailClosed(Object.freeze([left, right]));
    },
  );

  it.each(EVIDENCE_MULTI_DIMENSION_CASES.map((dimensions) => [dimensions] as const))(
    "fails closed when an agreeing subset cannot mask mismatch set %j",
    (dimensions) => {
      expectEvidenceMismatchFailClosed(dimensions);
    },
  );

  it("authenticates the exact S arm and rejects malformed, replayed and competing arms", () => {
    const value = graph(1);
    const session = publicationSession(value);
    expect(() => injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
      Object.freeze(Object.create(null)) as SQLiteCursorPublicationSession,
      Object.freeze(["native-affected", "changes-affected"]),
    )).toThrow(/publication session is invalid/u);
    expect(() => injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
      new Proxy(session, {}),
      Object.freeze(["native-affected", "changes-affected"]),
    )).toThrow(/publication session is invalid/u);
    for (const dimensions of [
      Object.freeze([]),
      Object.freeze(["native-affected", "native-affected"]),
      Object.freeze(["cursor-ledger", "native-affected"]),
      new Proxy(Object.freeze(["native-affected", "changes-affected"]), {}),
    ]) {
      expect(() => injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
        session,
        dimensions as readonly SQLiteCursorRebindEvidenceMismatchDimension[],
      )).toThrow(/evidence mismatch dimensions are invalid/u);
    }
    injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
      session,
      Object.freeze(["native-affected", "changes-affected"]),
    );
    expect(() => injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
      session,
      Object.freeze(["total-delta", "cursor-ledger"]),
    )).toThrow(/evidence mismatch is already armed/u);
    expect(() => injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
      session,
      "fetch-after-native-return",
      new Error("competing changes arm"),
    )).toThrow(/changes fault is invalid/u);
    expect(() => injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      session,
      new Error("competing release arm"),
    )).toThrow(/preconsume release fault is invalid/u);
  });

  it("binds the lower projection to one exact connection/E and consumes it once", () => {
    const selected = graph(1);
    const other = graph(1);
    const selectedSession = publicationSession(selected);
    const snapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(selectedSession);
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(selected.connection);
    const otherExecution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(other.connection);
    const dimensions = Object.freeze([
      "native-affected",
      "cursor-ledger",
    ] as const);
    expect(() => injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      other.connection,
      execution,
      dimensions,
    )).toThrow(/evidence mismatch is invalid/u);
    expect(() => injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      selected.connection,
      Object.freeze(Object.create(null)) as SQLiteConnectionCursorRebindExecution,
      dimensions,
    )).toThrow(/evidence mismatch is invalid/u);
    expect(() => injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      selected.connection,
      new Proxy(execution, {}),
      dimensions,
    )).toThrow(/evidence mismatch is invalid/u);
    injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      selected.connection,
      execution,
      dimensions,
    );
    expect(() => injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      selected.connection,
      execution,
      Object.freeze(["changes-affected", "total-delta"]),
    )).toThrow(/evidence mismatch is invalid/u);
    executeSQLiteConnectionCursorRebindIntrinsic(selected.connection, execution, {
      sourceDescriptorHash: snapshot.sourceDescriptorHash,
      sourceSchemaIdentitySha256: snapshot.sourceSchemaIdentitySha256,
      targetDescriptorHash: snapshot.targetDescriptorHash,
      targetSchemaIdentitySha256: snapshot.targetSchemaIdentitySha256,
    });
    expect(() => takeSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      other.connection,
      execution,
    )).toThrow(/execution is invalid|take is invalid/u);
    expect(takeSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      selected.connection,
      execution,
    )).toEqual(dimensions);
    expect(takeSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      selected.connection,
      execution,
    )).toBeNull();
    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      other.connection,
      otherExecution,
    )).toMatchObject({ lifecycle: "active", executeCount: 0, releaseCount: 0 });
  });

  it("rolls back a completed-E ticket registration failure and clears the global arm", () => {
    const selected = graph(1);
    const session = publicationSession(selected);
    const registrationPrimary = new Error("completed-E registration primary");
    injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
      session,
      Object.freeze(["native-affected", "changes-affected"]),
    );
    injectSQLiteCursorRebindCompletedFailureRegistrationFailureForTestIntrinsic(
      registrationPrimary,
    );
    expect(() => captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(session))
      .toThrow(/completed failure ticket is invalid/u);
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      selected.authority,
    );
    const context = authority.publicationRebindContext!;
    const tombstone = authority.publicationSessionConsumedTombstone!;
    const adoption = authority.postRebindWatermarkAdoption!;
    const execution = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(
      context,
    ).execution;
    expect(() => takeSQLiteCursorRebindCompletedFailureForFinalizerIntrinsic(
      selected.connection,
      session,
      context,
      tombstone,
      adoption,
      execution,
      registrationPrimary,
    )).toThrow(/completed failure ticket is invalid/u);

    const retry = graph(1);
    const retrySession = publicationSession(retry);
    injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
      retrySession,
      Object.freeze(["native-affected", "changes-affected"]),
    );
    const capture = captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(retrySession);
    let caught: unknown;
    try {
      finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(capture.owner);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(capture.leafPrimary);
  });

  it.each(["substitute-primary", "cross-connection"] as const)(
    "destructively rejects one completed-E ticket %s mismatch",
    (scenario) => {
      const selected = graph(1);
      const other = graph(1);
      const session = publicationSession(selected);
      injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
        session,
        Object.freeze(["native-affected", "changes-affected"]),
      );
      let primary: unknown;
      try {
        executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      } catch (error) {
        primary = error;
      }
      expect(primary).toBeInstanceOf(Error);
      const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
        selected.authority,
      );
      const context = authority.publicationRebindContext!;
      const tombstone = authority.publicationSessionConsumedTombstone!;
      const adoption = authority.postRebindWatermarkAdoption!;
      const execution = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(
        context,
      ).execution;
      expect(() => takeSQLiteCursorRebindCompletedFailureForFinalizerIntrinsic(
        scenario === "cross-connection" ? other.connection : selected.connection,
        session,
        context,
        tombstone,
        adoption,
        execution,
        scenario === "substitute-primary" ? new Error("substitute") : primary as object,
      )).toThrow(/completed failure ticket is invalid/u);
      expect(() => takeSQLiteCursorRebindCompletedFailureForFinalizerIntrinsic(
        selected.connection,
        session,
        context,
        tombstone,
        adoption,
        execution,
        primary as object,
      )).toThrow(/completed failure ticket is invalid/u);
    },
  );

  it.each([0, 1, 3])(
    "runs the authentic S-P-T-E-A-W-R11 chain for %i real cursors and retains exact ledgers",
    (cursorCount) => {
      const value = graph(cursorCount);
      const session = publicationSession(value);
      const sessionSnapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
      const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
      const write = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt);
      const sealReceipt = assertSQLiteCursorPreRebindReceiptProvenance(
        value.preRebindReceipt,
      ).sealReceipt;

      expect(rule).toMatchObject({
        lifecycle: "active",
        ruleId: SQLITE_CURSOR_REBIND_RULE11_ID_INTRINSIC,
        position: SQLITE_CURSOR_REBIND_RULE11_POSITION_INTRINSIC,
        violationCount: 0,
        diagnosticsTruncated: false,
      });
      expect(write).toMatchObject({
        lifecycle: "rule11-complete",
        session,
        outerAuthority: value.authority,
        connection: value.connection,
        prepareCount: 1,
        executeCount: 1,
        releaseCount: 1,
        changesPrepareCount: 1,
        changesFetchCount: 1,
        changesReleaseCount: 1,
        sql: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
        sqlSha256: SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
        parameterOrder: SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
        parameterSha256: "524ece2b423a16fe16cf147e4918f74029ec71bd1559a65a2e7e2710a73ef37f",
        changesSql: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
        changesSqlSha256: SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
        cursorLedgerBefore: {
          logicalWriteSequence: 0,
          fixedStatementCount: 0,
          affectedRowsWatermark: 0,
        },
        cursorLedgerAfter: {
          logicalWriteSequence: 1,
          fixedStatementCount: 1,
          affectedRowsWatermark: cursorCount,
        },
        counts: counts(cursorCount),
        violationCount: 0,
      });
      expect(sealReceipt.cursorCount).toBe(cursorCount);
      if (cursorCount > 0) {
        expect(sealReceipt.immutableRootSha256).not.toBe(SQLITE_CURSOR_SEAL_EMPTY_ROOT);
      }
      expect(write.preparedExecutionSnapshot.lifecycle).toBe("active");
      expect(write.completedExecutionSnapshot.lifecycle).toBe("completed");
      expect(write.outerLedgerAfter).toEqual(write.outerLedgerBefore);
      expect(write.transactionEpochAfter).toBe(write.transactionEpochBefore + 1n);
      expect(BigInt(write.totalChangesAfter)).toBe(
        BigInt(write.totalChangesBefore) + BigInt(cursorCount),
      );
      expect(rule.transactionEpoch).toBe(write.transactionEpochAfter);
      expect(rule.totalChanges).toBe(write.totalChangesAfter);
      expect(value.connection.prepare(
        "SELECT DISTINCT descriptor_hash, schema_identity_sha256 "
          + "FROM main.ge_cycle_cursors ORDER BY descriptor_hash, schema_identity_sha256",
        "inspect-schema",
      ).all()).toEqual(cursorCount === 0 ? [] : [[
        sessionSnapshot.targetDescriptorHash,
        sessionSnapshot.targetSchemaIdentitySha256,
      ]]);
      expect(Object.isFrozen(write)).toBe(true);
      expect(Object.isFrozen(rule)).toBe(true);

      expect(() => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(
        Object.freeze(Object.create(null)),
      )).toThrow(/Rule 11 owner is invalid/u);
      expect(() => readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(
        new Proxy(rule.writeReceipt, {}),
      )).toThrow(/write receipt is invalid/u);
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).lifecycle)
        .toBe("active");
      expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(rule.writeReceipt))
        .toThrow(/write receipt is terminal/u);
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
        .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    },
  );

  it("rejects forged W/R11 presentations and poisons only the exact replay-selected run", () => {
    const left = graph();
    const right = graph();
    const leftRule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(
      publicationSession(left),
    );
    const rightRule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(
      publicationSession(right),
    );
    const leftRule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(leftRule11);
    const rightRule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rightRule11);
    const leftWriteProjection = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(
      leftRule.writeReceipt,
    );

    expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(
      Object.freeze({ ...leftWriteProjection }),
    )).toThrow(/write receipt is invalid/u);
    expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(
      new Proxy(leftRule.writeReceipt, {}),
    )).toThrow(/write receipt is invalid/u);
    expect(() => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(
      Object.freeze({ ...leftRule }),
    )).toThrow(/Rule 11 owner is invalid/u);
    expect(() => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(
      new Proxy(leftRule11, {}),
    )).toThrow(/Rule 11 owner is invalid/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(left.authority).lifecycle)
      .toBe("active");
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(right.authority).lifecycle)
      .toBe("active");

    // The exact W selects its own run. Replaying right W poisons right only;
    // structurally equal/cross-run projections never select left.
    expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(rightRule.writeReceipt))
      .toThrow(/write receipt is terminal/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(right.authority).lifecycle)
      .toBe("poisoned");
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(left.authority).lifecycle)
      .toBe("active");
    expect(readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(leftRule11)).toEqual(leftRule);
  });

  it("cancels after authenticating but without consuming S, then retries", () => {
    const value = graph();
    const session = publicationSession(value);
    const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    controller.cancel();
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(
      session,
      controller.signal,
    )).toThrowError(CycleStoreProviderError);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority).writePhase)
      .toBe("publication-active");
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("authenticates forged or drifted S before honoring an already-cancelled signal", () => {
    const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    controller.cancel();

    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(
      Object.freeze(Object.create(null)) as unknown as SQLiteCursorPublicationSession,
      controller.signal,
    )).toThrow(/publication session is invalid/u);

    const value = graph();
    const session = publicationSession(value);
    value.connection.prepare(
      "UPDATE main.ge_cycle_migration_lock SET active_owner_id = ? WHERE singleton = 1",
      "inspect-schema",
    ).run("hostile-owner-before-cancelled-entry");
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(
      session,
      controller.signal,
    )).toThrowError(expect.not.objectContaining({
      message: expect.stringContaining("cancelled before prepare"),
    }));
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("releases P/context before consume on second-boundary cancellation and retries S", () => {
    const value = graph();
    const session = publicationSession(value);
    const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    injectSQLiteCursorRebindCancelBeforeExecuteForTestIntrinsic();
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(
      session,
      controller.signal,
    )).toThrow(/cancelled before execute/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("selects one exact S-to-E preconsume release primary before simultaneous cancellation", () => {
    const selected = graph(1);
    const unselected = graph(1);
    const selectedSession = publicationSession(selected);
    const unselectedSession = publicationSession(unselected);
    const primary = new Error("selected exact-S-to-E preconsume release");

    expect(() => injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      Object.freeze(Object.create(null)) as SQLiteCursorPublicationSession,
      primary,
    )).toThrow(/publication session is invalid/u);
    expect(() => injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      new Proxy(selectedSession, {}),
      primary,
    )).toThrow(/publication session is invalid/u);
    expect(() => injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      selectedSession,
      Object.freeze(new Proxy({}, {})),
    )).toThrow(/release fault is invalid/u);
    expect(() => injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      selectedSession,
      "not weak-referenceable",
    )).toThrow(/release fault is invalid/u);

    injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      selectedSession,
      primary,
    );
    expect(() => injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      selectedSession,
      new Error("double exact-S arm"),
    )).toThrow(/release fault is invalid/u);

    const unselectedRule = executeSQLiteCursorPublicationRebindRule11Intrinsic(
      unselectedSession,
    );
    expect(readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(unselectedRule).lifecycle)
      .toBe("active");
    injectSQLiteCursorRebindCancelBeforeExecuteForTestIntrinsic();
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(selectedSession);
      throw new Error("expected selected preconsume release failure");
    } catch (error) {
      expect(error).toBe(primary);
    }

    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      selected.authority,
    );
    const context = authority.publicationRebindContext!;
    const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    expect(authority).toMatchObject({
      lifecycle: "poisoned",
      postRebindWatermarkAdoption: undefined,
      publicationRebindContext: context,
      publicationSessionConsumedTombstone: undefined,
      stageOwnershipPoisonReason: "SQLite publication rebind cancellation release failed",
      writePhase: "poisoned",
    });
    expect(contextSnapshot).toMatchObject({ lifecycle: "poisoned", session: selectedSession });
    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      selected.connection,
      contextSnapshot.execution,
    )).toMatchObject({
      affectedRows: 0,
      changesAffectedRows: null,
      changesFetchCount: 0,
      changesPrepareCount: 0,
      changesReleaseCount: 0,
      cursorLedgerAffectedRowsWatermark: 0,
      cursorLedgerFixedStatementCount: 0,
      cursorLedgerLogicalWriteSequence: 0,
      executeCount: 0,
      lifecycle: "poisoned",
      parameterValues: null,
      releaseCount: 1,
      statementOwnershipRetired: true,
      totalChangesDelta: 0,
    });
    expect(() => readSQLiteCursorPublicationSessionSnapshotIntrinsic(selectedSession))
      .toThrow(/publication session is not active/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(unselected.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "cursor-rebind-adopted" });
  });

  it.each([
    ["prepare-after-native-return", "changes-prepare", [1, 0, 1], null],
    ["fetch-after-native-return", "changes-fetch", [1, 1, 1], null],
    ["shape-after-validation", "changes-shape", [1, 1, 1], 1],
    ["release-after-logical-retirement", "changes-release", [1, 1, 1], 1],
  ] as const)(
    "hands exact S to exact E and preserves %s primary after T",
    (stage, _projection, expectedCounts, expectedChanges) => {
      const selected = graph(1);
      const unselected = graph(1);
      const selectedSession = publicationSession(selected);
      const unselectedSession = publicationSession(unselected);
      const primary = new Error(`selected exact-S ${stage}`);
      injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
        selectedSession,
        stage,
        primary,
      );
      expect(() => injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
        selectedSession,
        stage,
        new Error("double exact-S changes arm"),
      )).toThrow(/changes fault is invalid/u);
      expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(unselectedSession))
        .not.toThrow();
      let caught: unknown;
      try {
        executeSQLiteCursorPublicationRebindRule11Intrinsic(selectedSession);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(primary);
      const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
        selected.authority,
      );
      const context = authority.publicationRebindContext!;
      const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
      expect(authority).toMatchObject({
        lifecycle: "poisoned",
        postRebindWatermarkAdoption: undefined,
        publicationSessionConsumedTombstone: {},
        writePhase: "poisoned",
      });
      expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
        selected.connection,
        contextSnapshot.execution,
      )).toMatchObject({
        affectedRows: 1,
        changesAffectedRows: expectedChanges,
        changesFetchCount: expectedCounts[1],
        changesPrepareCount: expectedCounts[0],
        changesReleaseCount: expectedCounts[2],
        cursorLedgerAffectedRowsWatermark: 1,
        cursorLedgerFixedStatementCount: 1,
        cursorLedgerLogicalWriteSequence: 1,
        executeCount: 1,
        lifecycle: "poisoned",
        releaseCount: 1,
        statementOwnershipRetired: true,
        totalChangesDelta: 1,
      });
      expect(readSQLiteConnectionCursorRebindChangesFailureBoundaryIntrinsic(
        selected.connection,
        contextSnapshot.execution,
      )).toBe(stage);
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(unselected.authority))
        .toMatchObject({ lifecycle: "active", writePhase: "cursor-rebind-adopted" });
    },
  );

  it("rejects forged/cross/proxy changes arms and rolls back exact-S/E registration", () => {
    const value = graph(1);
    const other = graph(1);
    const session = publicationSession(value);
    const otherSession = publicationSession(other);
    const primary = new Error("selected upper changes primary");
    expect(() => injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
      Object.freeze(Object.create(null)) as SQLiteCursorPublicationSession,
      "fetch-after-native-return",
      primary,
    )).toThrow(/publication session is invalid/u);
    expect(() => injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
      new Proxy(session, {}),
      "fetch-after-native-return",
      primary,
    )).toThrow(/publication session is invalid/u);
    expect(() => injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
      session,
      "fetch-after-native-return",
      Object.freeze(new Proxy({}, {})),
    )).toThrow(/changes fault is invalid/u);
    injectSQLiteCursorRebindPostconsumeChangesFaultRegistrationFailureForTestIntrinsic(primary);
    expect(() => injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
      session,
      "fetch-after-native-return",
      new Error("discarded upper changes arm"),
    )).toThrow(primary);

    const handoffPrimary = new Error("selected lower registration primary");
    injectSQLiteConnectionCursorRebindChangesFaultRegistrationFailureForTestIntrinsic(
      handoffPrimary,
    );
    injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
      session,
      "fetch-after-native-return",
      new Error("discarded lower changes arm"),
    );
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session))
      .toThrow(handoffPrimary);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(otherSession)).not.toThrow();
  });

  it("rolls back exact-S and exact-E partial registrations without consuming S", () => {
    const value = graph(1);
    const session = publicationSession(value);
    const upperRegistrationPrimary = new Error("exact-S registration primary");
    injectSQLiteCursorRebindPreconsumeReleaseFaultRegistrationFailureForTestIntrinsic(
      upperRegistrationPrimary,
    );
    try {
      injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
        session,
        new Error("discarded exact-S primary"),
      );
      throw new Error("expected exact-S registration failure");
    } catch (error) {
      expect(error).toBe(upperRegistrationPrimary);
    }

    const handoffRegistrationPrimary = new Error("exact-E handoff registration primary");
    injectSQLiteConnectionCursorRebindReleaseFaultRegistrationFailureForTestIntrinsic(
      handoffRegistrationPrimary,
    );
    injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      session,
      new Error("discarded handoff release primary"),
    );
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected exact-E handoff registration failure");
    } catch (error) {
      expect(error).toBe(handoffRegistrationPrimary);
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({
        lifecycle: "active",
        postRebindWatermarkAdoption: undefined,
        publicationRebindContext: undefined,
        publicationSessionConsumedTombstone: undefined,
        writePhase: "publication-active",
      });
    expect(readSQLiteCursorPublicationSessionSnapshotIntrinsic(session).lifecycle)
      .toBe("publication-active");
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("exact-discards an exact-S partial arm when registration throws undefined", () => {
    const value = graph(1);
    const session = publicationSession(value);
    injectSQLiteCursorRebindPreconsumeReleaseFaultRegistrationFailureForTestIntrinsic(
      undefined,
    );
    let caught = false;
    try {
      injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
        session,
        new Error("discarded undefined exact-S registration arm"),
      );
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);

    const retryPrimary = new Error("retry exact-S after thrown undefined");
    injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
      session,
      retryPrimary,
    );
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected retry exact-S release primary");
    } catch (error) {
      expect(error).toBe(retryPrimary);
    }
  });

  it("cleans an unbound E after outer context registration failure and retries S", () => {
    const value = graph();
    const session = publicationSession(value);
    const primary = Object.freeze({ boundary: "context-session-registration" });
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      "context-session",
      primary,
    );
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected context registration failure");
    } catch (error) {
      expect(error).toBe(primary);
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("releases prepared E/context after T registration failure and permits fresh retry", () => {
    const value = graph();
    const session = publicationSession(value);
    const primary = Object.freeze({ boundary: "session-tombstone-registration" });
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      "session-tombstone",
      primary,
    );
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected T registration failure");
    } catch (error) {
      expect(error).toBe(primary);
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
  });

  it("preserves an A registration primary and poisons after T consumption", () => {
    const value = graph();
    const session = publicationSession(value);
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      "watermark-adoption",
      undefined,
    );
    let caught = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons exact outer graph on W registration failure and preserves thrown undefined", () => {
    const value = graph();
    const session = publicationSession(value);
    injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic("write", undefined);
    let caught = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons exact outer graph on R11 registration failure without replacing primary", () => {
    const value = graph();
    const session = publicationSession(value);
    const primary = Object.freeze({ boundary: "rule11-registration" });
    injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic("rule11", primary);
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected registration failure");
    } catch (error) {
      expect(error).toBe(primary);
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("preserves a real post-T native statement-run failure and poisons its exact graph", () => {
    let hookCalls = 0;
    let hookConnection: ReaderLeaseTestGraph["connection"] | undefined;
    const value = createReaderLeaseTestGraph(1, {
      beforeBaselineStageCreation: (connection) => {
        hookCalls += 1;
        hookConnection = connection;
        installNativeRebindAbortTrigger(connection);
      },
      cursorCount: 1,
    });
    graphs.push(value);
    expect(hookCalls).toBe(1);
    expect(hookConnection).toBe(value.connection);
    const session = publicationSession(value);

    let primary: unknown;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
      throw new Error("expected native statement-run failure");
    } catch (error) {
      primary = error;
    }
    expect(primary).toBeInstanceOf(CycleStoreProviderError);
    expect(primary).toMatchObject({
      code: "GE_CYCLE_STORE_CORRUPTION",
      details: { sqliteClass: 19 },
    });
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority);
    const context = authority.publicationRebindContext!;
    const tombstone = authority.publicationSessionConsumedTombstone!;
    const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    expect(authority).toMatchObject({
      lifecycle: "poisoned",
      postRebindWatermarkAdoption: undefined,
      publicationRebindContext: context,
      publicationSessionConsumedTombstone: tombstone,
      stageOwnershipPoisonReason: "SQLite cursor rebind failed after session consumption",
      writePhase: "poisoned",
    });
    expect(contextSnapshot).toMatchObject({ lifecycle: "poisoned", session });
    expect(readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic(tombstone))
      .toMatchObject({ context, lifecycle: "poisoned", session });
    expect(readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      value.connection,
      contextSnapshot.execution,
    )).toMatchObject({
      affectedRows: 0,
      changesFetchCount: 0,
      changesPrepareCount: 0,
      changesReleaseCount: 0,
      cursorLedgerAffectedRowsWatermark: 0,
      cursorLedgerFixedStatementCount: 0,
      cursorLedgerLogicalWriteSequence: 0,
      executeCount: 1,
      lifecycle: "poisoned",
      releaseCount: 1,
      statementOwnershipRetired: true,
    });
    expect(() => readSQLiteCursorPublicationSessionSnapshotIntrinsic(session))
      .toThrow(/publication session is not active/u);
    expect(() => readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(
      Object.freeze(Object.create(null)),
    )).toThrow(/write receipt is invalid/u);
    expect(() => readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(
      Object.freeze(Object.create(null)),
    )).toThrow(/Rule 11 owner is invalid/u);
    expect(value.connection.isTransaction).toBe(true);
    expect(graphs.pop()).toBe(value);
    disposeReaderLeaseTestGraph(value);
    expect(value.connection.isOpen).toBe(false);
  });

  it("performs zero additional SQLite work while reading W/R11 retained proofs", () => {
    const value = graph();
    const session = publicationSession(value);
    const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
    const before = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt);
    const prepare = value.connection.prepare;
    let prepareCount = 0;
    const connectionReads = {
      isTransaction: 0,
      transactionEpoch: 0,
      transactionLineage: 0,
      transactionMode: 0,
    };
    const connectionValues = {
      isTransaction: value.connection.isTransaction,
      transactionEpoch: value.connection.transactionEpoch,
      transactionLineage: value.connection.transactionLineage,
      transactionMode: value.connection.transactionMode,
    };
    value.connection.prepare = function (...args: Parameters<typeof prepare>) {
      prepareCount += 1;
      return Reflect.apply(prepare, this, args) as ReturnType<typeof prepare>;
    };
    Object.defineProperties(value.connection, {
      isTransaction: {
        configurable: true,
        get() {
          connectionReads.isTransaction += 1;
          return connectionValues.isTransaction;
        },
      },
      transactionEpoch: {
        configurable: true,
        get() {
          connectionReads.transactionEpoch += 1;
          return connectionValues.transactionEpoch;
        },
      },
      transactionLineage: {
        configurable: true,
        get() {
          connectionReads.transactionLineage += 1;
          return connectionValues.transactionLineage;
        },
      },
      transactionMode: {
        configurable: true,
        get() {
          connectionReads.transactionMode += 1;
          return connectionValues.transactionMode;
        },
      },
    });
    try {
      expect(readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11)).toEqual(rule);
      expect(readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt)).toEqual(before);
      expect(prepareCount).toBe(0);
      expect(connectionReads).toEqual({
        isTransaction: 0,
        transactionEpoch: 0,
        transactionLineage: 0,
        transactionMode: 0,
      });

      // A terminal replay still traverses the real gate's retained graph
      // authentication before it rejects.  Dynamically surround that gate,
      // not only the public snapshot readers, to prove it performs no public
      // SQL/transaction/clock observation on the retained-only path.
      expect(() => executeSQLiteCursorRebindRule11GateIntrinsic(rule.writeReceipt))
        .toThrow(/write receipt is terminal/u);
      expect(prepareCount).toBe(0);
      expect(connectionReads).toEqual({
        isTransaction: 0,
        transactionEpoch: 0,
        transactionLineage: 0,
        transactionMode: 0,
      });

      const protocolSource = readFileSync(
        new URL("../src/cursor-publication-rebind.ts", import.meta.url),
        "utf8",
      );
      const outerSource = readFileSync(
        new URL("../src/cursor-publication-outer-authority.ts", import.meta.url),
        "utf8",
      );
      const retainedStart = protocolSource.indexOf("function assertWriteRetainedGraph");
      const retainedEnd = protocolSource.indexOf("\nfunction mintWriteReceipt", retainedStart);
      const retainedClosure = protocolSource.slice(retainedStart, retainedEnd);
      const adoptionStart = outerSource.indexOf(
        "export function assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic",
      );
      const adoptionEnd = outerSource.indexOf("\nexport function ", adoptionStart + 1);
      const adoptionClosure = outerSource.slice(adoptionStart, adoptionEnd);
      for (const closure of [retainedClosure, adoptionClosure]) {
        expect(closure).not.toContain("readSQLiteConnectionOwnerSnapshot(");
        expect(closure).not.toContain("readSQLiteConnectionTotalChangesSnapshot(");
        expect(closure).not.toContain(
          "readSQLiteConnectionCursorRebindExecutionSnapshotVerifierIntrinsic(",
        );
        expect(closure).not.toContain(
          "readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic(",
        );
        expect(closure).not.toContain("assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic(");
        expect(closure).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/u);
      }
    } finally {
      value.connection.prepare = prepare;
      for (const name of [
        "isTransaction",
        "transactionEpoch",
        "transactionLineage",
        "transactionMode",
      ]) {
        Reflect.deleteProperty(value.connection, name);
      }
    }
  });

  it("does not export the private protocol module or capabilities from the package root", () => {
    for (const name of [
      "executeSQLiteCursorPublicationRebindRule11Intrinsic",
      "executeSQLiteCursorRebindRule11GateIntrinsic",
      "injectSQLiteConnectionCursorRebindReleaseFaultForTestIntrinsic",
      "injectSQLiteConnectionCursorRebindReleaseFaultRegistrationFailureForTestIntrinsic",
      "injectSQLiteConnectionCursorRebindChangesFaultForTestIntrinsic",
      "injectSQLiteConnectionCursorRebindChangesFaultRegistrationFailureForTestIntrinsic",
      "injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic",
      "takeSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic",
      "SQLiteCursorRebindEvidenceMismatchDimension",
      "readSQLiteConnectionCursorRebindChangesFailureBoundaryIntrinsic",
      "injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic",
      "injectSQLiteCursorRebindPreconsumeReleaseFaultRegistrationFailureForTestIntrinsic",
      "injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic",
      "injectSQLiteCursorRebindPostconsumeChangesFaultRegistrationFailureForTestIntrinsic",
      "injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic",
      "readSQLiteCursorRebindEvidenceMismatchOutcomeForTestIntrinsic",
      "SQLiteCursorRebindEvidenceMismatchOutcomeForTest",
      "injectSQLiteCursorRebindCompletedFailureRegistrationFailureForTestIntrinsic",
      "takeSQLiteCursorRebindCompletedFailureForFinalizerIntrinsic",
      "assertSQLiteCursorRebindCompletedFailureForFinalizerIntrinsic",
      "SQLiteCursorRebindCompletedFailureBoundary",
      "SQLiteCursorRebindChangesFaultStage",
      "SQLiteCursorRebindWriteReceipt",
      "SQLiteCursorRebindRule11Owner",
    ]) {
      expect(name in sqliteRoot).toBe(false);
    }
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).not.toContain("cursor-publication-rebind");
    expect(source).not.toContain("SQLiteCursorRebindWriteReceipt");
    expect(source).not.toContain("SQLiteCursorRebindRule11Owner");
  });

  if (process.env.GRAPH_ENGINEERING_RUN_RULE11_GC_PROBE !== "1") {
    it("passes success, cancellation, poison, native-run and W/R11-fault isolated GC", () => {
      const packageRoot = fileURLToPath(new URL("..", import.meta.url));
      const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          vitest,
          "run",
          "test/cursor-publication-rebind-rule11.test.ts",
          "--pool=threads",
          "--maxWorkers=1",
          "--fileParallelism=false",
          "--reporter=dot",
        ],
        {
          cwd: packageRoot,
          encoding: "utf8",
          env: { ...process.env, GRAPH_ENGINEERING_RUN_RULE11_GC_PROBE: "1" },
          timeout: 150_000,
        },
      );
      expect(result.error, `GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
      expect(result.signal, `GC probe was terminated: ${result.stderr}`).toBeNull();
      expect(result.status, [
        "isolated Rule 11 GC probe failed",
        `stdout=${result.stdout}`,
        `stderr=${result.stderr}`,
      ].join("\n")).toBe(0);
    }, 160_000);
  } else {
    it("collects every exact identity in all ten terminal or abandoned profiles", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const scenarios = [
        "success",
        "prewrite-cancel",
        "postconsume-poison",
        "native-run-fault",
        "write-fault",
        "rule11-fault",
        "release-fault",
        "abandoned-release-fault",
        "abandoned-changes-fault",
        "abandoned-completed-mismatch",
      ] as const;
      for (let index = 0; index < scenarios.length; index += 1) {
        const tracked = trackDroppedScenario(scenarios[index]!);
        const live = await forceBoundedCollection(tracked.referents);
        expect(live, [
          `Rule 11 ${scenarios[index]} graph retained strong roots after 80 GC rounds`,
          `live=${live.join(",") || "none"}`,
          `finalized=${[...tracked.finalized].sort().join(",") || "none"}`,
        ].join("; ")).toEqual([]);
        expect(tracked.registry).toBeInstanceOf(FinalizationRegistry);
      }
    }, 120_000);

    it("discards a dead exact-S error, releases prepared E/context, and retries the same S", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const value = graph(1);
      const session = publicationSession(value);
      const errorReference = armAndDropExactSReleaseError(session);
      const live = await forceBoundedCollection([
        { label: "release-error", reference: errorReference },
      ]);
      expect(live).toEqual([]);
      expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session))
        .toThrow(/preconsume release fault identity drifted/u);
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
        .toMatchObject({
          lifecycle: "active",
          postRebindWatermarkAdoption: undefined,
          publicationRebindContext: undefined,
          publicationSessionConsumedTombstone: undefined,
          writePhase: "publication-active",
        });
      expect(readSQLiteCursorPublicationSessionSnapshotIntrinsic(session).lifecycle)
        .toBe("publication-active");
      expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
    }, 120_000);

    it("discards a dead exact-S changes error before T and retries the same S", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const value = graph(1);
      const session = publicationSession(value);
      const errorReference = armAndDropExactSChangesError(session);
      expect(await forceBoundedCollection([
        { label: "changes-error", reference: errorReference },
      ])).toEqual([]);
      expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session))
        .toThrow(/postconsume changes fault identity drifted/u);
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.authority))
        .toMatchObject({
          lifecycle: "active",
          publicationRebindContext: undefined,
          publicationSessionConsumedTombstone: undefined,
          writePhase: "publication-active",
        });
      expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
    }, 120_000);

    it("weakly holds an abandoned exact-S registration failure and clears it on trigger", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const tracked = trackAbandonedExactSRegistrationFailure();
      const live = await forceBoundedCollection(tracked.referents);

      // Trigger regardless of the diagnostic result so the global one-shot is
      // cleared and its partial pending arm is exact-discarded.
      const value = graph(1);
      const session = publicationSession(value);
      const retryPrimary = new Error("next exact-S release primary");
      expect(() => injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
        session,
        retryPrimary,
      )).toThrow(/registration failure expired/u);
      injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
        session,
        retryPrimary,
      );
      try {
        executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
        throw new Error("expected retry exact-S release failure");
      } catch (error) {
        expect(error).toBe(retryPrimary);
      }

      expect(live, [
        "abandoned exact-S registration failure retained its graph",
        `live=${live.join(",") || "none"}`,
        `finalized=${[...tracked.finalized].sort().join(",") || "none"}`,
      ].join("; ")).toEqual([]);
      expect(tracked.registry).toBeInstanceOf(FinalizationRegistry);
    }, 120_000);
  }
});
