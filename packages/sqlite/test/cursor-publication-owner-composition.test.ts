import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES,
  SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES,
  acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic,
  acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic,
  adoptSQLiteCursorPublicationOwnerCompositionIntrinsic,
  assertSQLiteCursorPublicationOwnerCompositionRule12Intrinsic,
  beginSQLiteCursorPublicationFixedReadIntrinsic,
  boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic,
  consumeSQLiteCursorPublicationFixedReadPermitIntrinsic,
  consumeSQLiteCursorPublicationMutationChildPermitIntrinsic,
  consumeSQLiteCursorPublicationMutationParentScopeIntrinsic,
  enterSQLiteCursorPublicationMutationChildPermitIntrinsic,
  injectSQLiteCursorPublicationOwnerCompositionAdoptionFaultForTestIntrinsic,
  issueSQLiteCursorPublicationFixedReadPermitIntrinsic,
  issueSQLiteCursorPublicationMutationChildPermitIntrinsic,
  issueSQLiteCursorPublicationMutationParentScopeIntrinsic,
  mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic,
  observeSQLiteCursorPublicationFixedReadRowIntrinsic,
  observeSQLiteCursorPublicationFixedReadTerminalIntrinsic,
  prepareSQLiteCursorPublicationFixedReadPermitIntrinsic,
  prepareSQLiteCursorPublicationReusableParentIntrinsic,
  readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic,
  readSQLiteCursorPublicationMutationChildPermitSnapshotIntrinsic,
  readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic,
  readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic,
  readSQLiteCursorPublicationRetainedCountReceiptSnapshotIntrinsic,
  recordSQLiteCursorPublicationMutationChildReturnIntrinsic,
  retireSQLiteCursorPublicationFixedReadResourceIntrinsic,
  retireSQLiteCursorPublicationMutationChildResourceIntrinsic,
  retireSQLiteCursorPublicationReusableParentResourceIntrinsic,
  SQLiteCursorPublicationOwnerCompositionError,
  type SQLiteCursorPublicationOwnerComposition,
} from "../src/cursor-publication-owner-composition.js";
import { loadSQLiteCursorMigration0002AssetIntrinsic } from
  "../src/cursor-publication-migration-0002-asset.js";
import { executeSQLiteCursorPublicationRebindRule11Intrinsic } from
  "../src/cursor-publication-rebind.js";
import { executeSQLiteCursorPublicationRule12Intrinsic } from
  "../src/cursor-publication-rule12.js";
import {
  beginSQLiteCursorPublicationTransactionOwnerIntrinsic,
  captureSQLiteCursorPublicationTransactionFailureIntrinsic,
  finalizeSQLiteCursorPublicationTransactionFailureIntrinsic,
  readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic,
  readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic,
  registerSQLiteCursorPublicationTransactionOwnerIntrinsic,
  type SQLiteCursorPublicationTransactionBeginReceipt,
  type SQLiteCursorPublicationTransactionOwner,
} from "../src/cursor-publication-transaction-owner.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import {
  beginSQLiteConnectionMigration0002ExecutionIntrinsic,
  executeNextSQLiteConnectionMigration0002StatementIntrinsic,
  executeSQLiteConnectionPublicationTransactionOwnerControlIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
  SQLiteConnection,
  type SQLiteConnectionTransactionLineage,
} from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  publishReaderLeaseTestGraphSession,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

interface P9Graph {
  readonly connection: SQLiteConnection;
  readonly root: string;
  readonly owner: SQLiteCursorPublicationTransactionOwner;
  readonly beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt;
}

const p9Graphs: P9Graph[] = [];
const p10Graphs: ReaderLeaseTestGraph[] = [];

function p9Graph(): P9Graph {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-p11-a-"));
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: 1_700_000_000_000,
  });
  const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
  const beginReceipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
  const value = { beginReceipt, connection, owner, root };
  p9Graphs.push(value);
  return value;
}

function p10Rule12Graph() {
  const graph = createReaderLeaseTestGraph(1, { cursorCount: 1 });
  p10Graphs.push(graph);
  const session = publishReaderLeaseTestGraphSession(graph);
  const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
  return executeSQLiteCursorPublicationRule12Intrinsic(rule11);
}

function compositionFor(graph: P9Graph): SQLiteCursorPublicationOwnerComposition {
  return adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
    graph.owner,
    graph.beginReceipt,
  );
}

function retainedCountReceiptFor(
  composition: SQLiteCursorPublicationOwnerComposition,
  retainedCount: number,
) {
  const retainedProjection = Object.freeze(Array.from(
    { length: retainedCount },
    (_, ordinal) => Object.freeze({ ordinal }),
  ));
  return mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic(
    composition,
    SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
    retainedProjection,
  );
}

type P11DerivedTransitionPreparation = (
  composition: SQLiteCursorPublicationOwnerComposition,
) => () => unknown;

function mutationChildAt(
  composition: SQLiteCursorPublicationOwnerComposition,
  completedTransitions: number,
) {
  const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
    composition,
    SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
    1,
  );
  const child = issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, 0);
  if (completedTransitions >= 1) enterSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
  if (completedTransitions >= 2) {
    recordSQLiteCursorPublicationMutationChildReturnIntrinsic(child);
  }
  if (completedTransitions >= 3) {
    retireSQLiteCursorPublicationMutationChildResourceIntrinsic(child);
  }
  if (completedTransitions >= 4) {
    acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic(child);
  }
  return { child, parent };
}

function fixedReadAt(
  composition: SQLiteCursorPublicationOwnerComposition,
  completedTransitions: number,
) {
  const permit = issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
    composition,
    SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
    1,
  );
  if (completedTransitions >= 1) prepareSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
  if (completedTransitions >= 2) beginSQLiteCursorPublicationFixedReadIntrinsic(permit);
  if (completedTransitions >= 3) observeSQLiteCursorPublicationFixedReadRowIntrinsic(permit);
  if (completedTransitions >= 4) observeSQLiteCursorPublicationFixedReadTerminalIntrinsic(permit);
  if (completedTransitions >= 5) {
    retireSQLiteCursorPublicationFixedReadResourceIntrinsic(permit, "iterator-return");
  }
  return permit;
}

const P11_DERIVED_TRANSITIONS: readonly (readonly [
  string,
  P11DerivedTransitionPreparation,
])[] = [
  ["composition snapshot", (composition) => (
    () => readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic(composition)
  )],
  ["mutation parent issue", (composition) => (
    () => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      1,
    )
  )],
  ["reusable parent prepare", (composition) => {
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      retainedCountReceiptFor(composition, 0),
    );
    return () => prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
  }],
  ["mutation child issue", (composition) => {
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      1,
    );
    return () => issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, 0);
  }],
  ["mutation child enter", (composition) => {
    const { child } = mutationChildAt(composition, 0);
    return () => enterSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
  }],
  ["mutation child native-return record", (composition) => {
    const { child } = mutationChildAt(composition, 1);
    return () => recordSQLiteCursorPublicationMutationChildReturnIntrinsic(child);
  }],
  ["mutation child resource retirement", (composition) => {
    const { child } = mutationChildAt(composition, 2);
    return () => retireSQLiteCursorPublicationMutationChildResourceIntrinsic(child);
  }],
  ["mutation child postflight", (composition) => {
    const { child } = mutationChildAt(composition, 3);
    return () => acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic(child);
  }],
  ["mutation child consume", (composition) => {
    const { child } = mutationChildAt(composition, 4);
    return () => consumeSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
  }],
  ["zero-item mutation postflight", (composition) => {
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      retainedCountReceiptFor(composition, 0),
    );
    prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
    return () => acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic(parent);
  }],
  ["reusable parent resource retirement", (composition) => {
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      retainedCountReceiptFor(composition, 0),
    );
    prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
    acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic(parent);
    return () => retireSQLiteCursorPublicationReusableParentResourceIntrinsic(parent);
  }],
  ["mutation parent consume", (composition) => {
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      retainedCountReceiptFor(composition, 0),
    );
    prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
    acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic(parent);
    retireSQLiteCursorPublicationReusableParentResourceIntrinsic(parent);
    return () => consumeSQLiteCursorPublicationMutationParentScopeIntrinsic(parent);
  }],
  ["mutation parent snapshot", (composition) => {
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      1,
    );
    return () => readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent);
  }],
  ["mutation child snapshot", (composition) => {
    const { child } = mutationChildAt(composition, 0);
    return () => readSQLiteCursorPublicationMutationChildPermitSnapshotIntrinsic(child);
  }],
  ["fixed-read issue", (composition) => (
    () => issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
      1,
    )
  )],
  ["fixed-read prepare", (composition) => {
    const permit = fixedReadAt(composition, 0);
    return () => prepareSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
  }],
  ["fixed-read begin", (composition) => {
    const permit = fixedReadAt(composition, 1);
    return () => beginSQLiteCursorPublicationFixedReadIntrinsic(permit);
  }],
  ["fixed-read row observation", (composition) => {
    const permit = fixedReadAt(composition, 2);
    return () => observeSQLiteCursorPublicationFixedReadRowIntrinsic(permit);
  }],
  ["fixed-read terminal observation", (composition) => {
    const permit = fixedReadAt(composition, 3);
    return () => observeSQLiteCursorPublicationFixedReadTerminalIntrinsic(permit);
  }],
  ["fixed-read resource retirement", (composition) => {
    const permit = fixedReadAt(composition, 4);
    return () => retireSQLiteCursorPublicationFixedReadResourceIntrinsic(
      permit,
      "iterator-return",
    );
  }],
  ["fixed-read consume", (composition) => {
    const permit = fixedReadAt(composition, 5);
    return () => consumeSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
  }],
  ["fixed-read snapshot", (composition) => {
    const permit = fixedReadAt(composition, 0);
    return () => readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic(permit);
  }],
  ["bounded stop", (composition) => (
    () => boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic(
      composition,
      new Error("native drift bounded stop must not win"),
    )
  )],
  ["Rule 12 assertion", (composition) => {
    const rule12 = p10Rule12Graph();
    return () => assertSQLiteCursorPublicationOwnerCompositionRule12Intrinsic(
      composition,
      rule12,
    );
  }],
];

function driftNativeWatermarks(graph: P9Graph): void {
  const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
  const changesBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
  const execution = beginSQLiteConnectionMigration0002ExecutionIntrinsic(
    graph.connection,
    loadSQLiteCursorMigration0002AssetIntrinsic(),
  );
  for (let ordinal = 0; ordinal < 4; ordinal += 1) {
    executeNextSQLiteConnectionMigration0002StatementIntrinsic(graph.connection, execution);
  }
  const ownerAfter = readSQLiteConnectionOwnerSnapshot(graph.connection);
  const changesAfter = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
  expect(ownerAfter.transactionEpoch).toBeGreaterThan(ownerBefore.transactionEpoch);
  expect(ownerAfter.tempMutationEpoch).toBeGreaterThan(ownerBefore.tempMutationEpoch);
  expect(changesAfter.totalChanges).toBeGreaterThan(changesBefore.totalChanges);
  expect(changesAfter.transactionEpoch).toBe(ownerAfter.transactionEpoch);
}

function rollbackNativeOwnerTransaction(graph: P9Graph): void {
  const native = readSQLiteConnectionOwnerSnapshot(graph.connection);
  expect(native.transactionLineage).not.toBeNull();
  expect(native.publicationTransactionGeneration).not.toBeNull();
  executeSQLiteConnectionPublicationTransactionOwnerControlIntrinsic(
    graph.connection,
    graph.owner as object,
    "rollback",
    native.transactionLineage!,
    native.publicationTransactionGeneration!,
  );
}

function replaceNativeLineageAndGeneration(graph: P9Graph): void {
  rollbackNativeOwnerTransaction(graph);
  const foreignLineage = Object.freeze(Object.create(null)) as
    SQLiteConnectionTransactionLineage;
  const foreignGeneration = Object.freeze(Object.create(null)) as object;
  executeSQLiteConnectionPublicationTransactionOwnerControlIntrinsic(
    graph.connection,
    graph.owner as object,
    "begin-exclusive",
    foreignLineage,
    foreignGeneration,
  );
  const native = readSQLiteConnectionOwnerSnapshot(graph.connection);
  expect(native.transactionLineage).toBe(foreignLineage);
  expect(native.publicationTransactionGeneration).toBe(foreignGeneration);
}

afterEach(() => {
  for (const graph of p10Graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
  for (const graph of p9Graphs.splice(0)) {
    const snapshot = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner);
    if (snapshot.lifecycle === "active") {
      const primary = new Error("P11_BOUNDED_STOP_NO_COMMIT");
      const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(
        graph.owner,
        primary,
      );
      expect(() => finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture))
        .toThrow(primary);
    }
    rmSync(graph.root, { recursive: true, force: true });
  }
});

describe("SQLite P11-A owner composition substrate", () => {
  it("one-shot adopts one exact live P9 owner and its exact BEGIN receipt", () => {
    const graph = p9Graph();
    const begin = readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(
      graph.owner,
      graph.beginReceipt,
    );
    const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
      graph.owner,
      graph.beginReceipt,
    );

    expect(readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic(composition))
      .toEqual({
        acceptedStageIds: [],
        acceptedStageReceiptCount: 0,
        beginTempMutationEpoch: begin.tempMutationEpoch,
        beginTotalChanges: begin.totalChanges,
        beginTransactionEpoch: begin.transactionEpoch,
        commitAttemptCount: 0,
        commitPresented: false,
        currentTempMutationEpoch: begin.tempMutationEpoch,
        currentTotalChanges: begin.totalChanges,
        currentTransactionEpoch: begin.transactionEpoch,
        exactBeginReceipt: true,
        exactOwner: true,
        highestAccepted30Stage: null,
        lifecycle: "begin-adopted",
        publicApi: false,
        rule12Selected: false,
        stage18Accepted: false,
        thirdEvidenceConsumed: false,
      });
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({
        beginAttemptCount: 1,
        beginNativeReturnCount: 1,
        beginReceiptMintCount: 1,
        commitAttemptCount: 0,
        lifecycle: "active",
      });
  });

  it("rejects replay and cross-owner BEGIN substitution", () => {
    const left = p9Graph();
    const right = p9Graph();
    adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(left.owner, left.beginReceipt);

    expect(() => adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
      left.owner,
      left.beginReceipt,
    )).toThrow(SQLiteCursorPublicationOwnerCompositionError);
    expect(() => adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
      right.owner,
      left.beginReceipt,
    )).toThrow(SQLiteCursorPublicationOwnerCompositionError);
  });

  it("fails closed when a real P9 composition is paired with the legacy raw-BEGIN P10 graph", () => {
    const p9 = p9Graph();
    const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
      p9.owner,
      p9.beginReceipt,
    );
    const rule12 = p10Rule12Graph();

    expect(() => assertSQLiteCursorPublicationOwnerCompositionRule12Intrinsic(
      composition,
      rule12,
    )).toThrowError(expect.objectContaining({
      code: "GE_SQLITE_P11_RULE12_NOT_OWNER_SCOPED",
    }));
    expect(() => readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic(composition))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_AUTHORITY" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(p9.owner))
      .toMatchObject({
        closeAttemptCount: 1,
        commitAttemptCount: 0,
        lifecycle: "finalized",
        reopenAttemptCount: 1,
        rollbackAttemptCount: 1,
      });
  });

  it.each(["registration", "binding", "pending", "owner-adopt"] as const)(
    "atomically finalizes the P9 graph when %s adoption fails",
    (point) => {
      const graph = p9Graph();
      const primary = new Error(`p11 adoption ${point}`);
      let captured: SQLiteCursorPublicationOwnerComposition | undefined;
      let observerReadRejected = false;
      injectSQLiteCursorPublicationOwnerCompositionAdoptionFaultForTestIntrinsic(
        point,
        primary,
        (composition) => {
          captured = composition;
          try {
            readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic(composition);
          } catch {
            observerReadRejected = true;
          }
        },
      );
      let thrown: unknown;
      try {
        adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
          graph.owner,
          graph.beginReceipt,
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBe(primary);
      expect(captured).toBeDefined();
      expect(observerReadRejected).toBe(true);
      expect(() => readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic(captured!))
        .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_AUTHORITY" }));
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({
          closeAttemptCount: 1,
          closeNativeReturnCount: 1,
          commitAttemptCount: 0,
          lifecycle: "finalized",
          reopenAttemptCount: 1,
          reopenSourceV1Count: 1,
          rollbackAttemptCount: 1,
          rollbackNativeReturnCount: 1,
        });
    },
  );

  it("runs the exact 20-statement migration parent/child lattice without SQL authority", () => {
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      compositionFor(p9Graph()),
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1],
      20,
    );
    for (let ordinal = 0; ordinal < 20; ordinal += 1) {
      const child = issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, ordinal);
      enterSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
      recordSQLiteCursorPublicationMutationChildReturnIntrinsic(child);
      retireSQLiteCursorPublicationMutationChildResourceIntrinsic(child);
      acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic(child);
      consumeSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
      expect(readSQLiteCursorPublicationMutationChildPermitSnapshotIntrinsic(child))
        .toMatchObject({
          actualNativeIoCount: 0,
          lifecycle: "child-consumed",
          model: "child-owned-one-shot",
          ordinal,
          sqlAuthority: false,
        });
    }
    consumeSQLiteCursorPublicationMutationParentScopeIntrinsic(parent);
    expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
      .toMatchObject({
        actualNativeIoCount: 0,
        childConsumedCount: 20,
        childResourceRetiredCount: 20,
        expectedCount: 20,
        lifecycle: "parent-consumed",
        nextOrdinal: 20,
        parentResourceRetiredCount: 0,
        bindingKind: "asset-sha256",
        bindingSha256: "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d",
        routeId: "main.migration-0002",
        sqlAuthority: false,
      });
  });

  it.each([0, 2])(
    "runs the reusable parent model for expectedCount=%i with one parent retirement",
    (expectedCount) => {
      const composition = compositionFor(p9Graph());
      const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
        composition,
        SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        retainedCountReceiptFor(composition, expectedCount),
      );
      prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
      if (expectedCount === 0) {
        acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic(parent);
      } else {
        for (let ordinal = 0; ordinal < expectedCount; ordinal += 1) {
          const child = issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, ordinal);
          enterSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
          recordSQLiteCursorPublicationMutationChildReturnIntrinsic(child);
          retireSQLiteCursorPublicationMutationChildResourceIntrinsic(child);
          acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic(child);
          consumeSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
        }
      }
      retireSQLiteCursorPublicationReusableParentResourceIntrinsic(parent);
      consumeSQLiteCursorPublicationMutationParentScopeIntrinsic(parent);
      expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
        .toMatchObject({
          actualNativeIoCount: 0,
          childConsumedCount: expectedCount,
          expectedCount,
          lifecycle: "parent-consumed",
          parentResourceRetiredCount: 1,
          reusableExecutionLeaseReleasedCount: expectedCount,
          reusableParentPrepareCount: 1,
          bindingKind: "sql-sha256",
          bindingSha256: "b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b",
          routeId: "main.baseline-entries",
          sqlAuthority: false,
        });
    },
  );

  it("derives zero from one exact retained projection without claiming native provenance", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    const receipt = retainedCountReceiptFor(composition, 0);
    expect(readSQLiteCursorPublicationRetainedCountReceiptSnapshotIntrinsic(
      composition,
      receipt,
    )).toEqual({
      actualNativeIoCount: 0,
      exactGeneration: true,
      exactOwner: true,
      exactScope: false,
      exactRetainedProjectionCount: true,
      exactRetainedProjectionIdentity: true,
      genuineZeroClaim: false,
      lifecycle: "issued",
      nativeSourceProvenance: false,
      oneShot: true,
      retainedCount: 0,
      routeId: "main.baseline-entries",
      sqlAuthority: false,
    });
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      receipt,
    );
    expect(readSQLiteCursorPublicationRetainedCountReceiptSnapshotIntrinsic(
      composition,
      receipt,
    )).toMatchObject({ exactScope: true, lifecycle: "consumed", retainedCount: 0 });
    expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
      .toMatchObject({ actualNativeIoCount: 0, expectedCount: 0, sqlAuthority: false });
  });

  it("rejects scalar fake-zero and retained-count receipt replay through exact P9 cleanup", () => {
    const fakeGraph = p9Graph();
    const fakeComposition = compositionFor(fakeGraph);
    expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      fakeComposition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      0,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(fakeGraph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });

    const replayGraph = p9Graph();
    const replayComposition = compositionFor(replayGraph);
    const receipt = retainedCountReceiptFor(replayComposition, 0);
    issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      replayComposition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      receipt,
    );
    expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      replayComposition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      receipt,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(replayGraph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });
  });

  it.each([
    ["mutable", []],
    ["sparse", Object.freeze(new Array(1))],
    ["array-subclass", Object.freeze(new (class extends Array<unknown> {})())],
    ["oversized", Object.freeze(Array.from({ length: 1_025 }, () => Object.freeze({})))],
    ["proxy", new Proxy(Object.freeze([]), {})],
  ] as const)("rejects %s retained projections before any route I/O", (_caseName, projection) => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    expect(() => mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      projection,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });
  });

  it("rejects a retained projection receipt minted for any non-baseline route", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    expect(() => mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      Object.freeze([]),
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });
  });

  it("keeps receipt authority in registry identity despite Reflect and structural bypasses", () => {
    const validComposition = compositionFor(p9Graph());
    const validReceipt = retainedCountReceiptFor(validComposition, 0);
    expect(Reflect.set(validReceipt as object, "retainedCount", 99)).toBe(false);
    expect(() => Object.defineProperty(validReceipt, "retainedCount", { value: 99 }))
      .toThrow(TypeError);
    expect(issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      validComposition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      validReceipt,
    )).toBeTypeOf("object");

    const proxyGraph = p9Graph();
    const proxyComposition = compositionFor(proxyGraph);
    const proxiedReceipt = new Proxy(retainedCountReceiptFor(proxyComposition, 0), {});
    expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      proxyComposition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      proxiedReceipt,
    )).toThrow();
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(proxyGraph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });

    const cloneGraph = p9Graph();
    const cloneComposition = compositionFor(cloneGraph);
    const clonedReceipt = Object.freeze({
      ...retainedCountReceiptFor(cloneComposition, 0),
    });
    expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      cloneComposition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      clonedReceipt as never,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(cloneGraph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });
  });

  it("strongly retains the consumed receipt and projection while its parent is live", async () => {
    const composition = compositionFor(p9Graph());
    let receipt = retainedCountReceiptFor(composition, 2);
    const receiptReference = new WeakRef(receipt as object);
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      receipt,
    );
    receipt = undefined as never;
    for (let round = 0; round < 4; round += 1) {
      globalThis.gc?.();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const retainedReceipt = receiptReference.deref();
    expect(retainedReceipt).toBeDefined();
    expect(readSQLiteCursorPublicationRetainedCountReceiptSnapshotIntrinsic(
      composition,
      retainedReceipt as never,
    )).toMatchObject({ lifecycle: "consumed", retainedCount: 2 });
    expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
      .toMatchObject({ expectedCount: 2 });
  });

  it("terminalizes only the presented composition on a cross-composition receipt attack", () => {
    const sourceGraph = p9Graph();
    const sourceComposition = compositionFor(sourceGraph);
    const sourceReceipt = retainedCountReceiptFor(sourceComposition, 0);
    const targetGraph = p9Graph();
    const targetComposition = compositionFor(targetGraph);
    expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      targetComposition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      sourceReceipt,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(targetGraph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });
    expect(readSQLiteCursorPublicationRetainedCountReceiptSnapshotIntrinsic(
      sourceComposition,
      sourceReceipt,
    )).toMatchObject({ exactScope: false, lifecycle: "issued", retainedCount: 0 });
    expect(issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      sourceComposition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      sourceReceipt,
    )).toBeTypeOf("object");
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(sourceGraph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "active" });
  });

  it.each([0, 3, 4, 5] as const)(
    "accepts only the exact singleton count for mutation route index %i",
    (routeIndex) => {
      const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
        compositionFor(p9Graph()),
        SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[routeIndex],
        1,
      );
      expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
        .toMatchObject({
          actualNativeIoCount: 0,
          expectedCount: 1,
          model: "child-owned-one-shot",
          sqlAuthority: false,
        });
    },
  );

  it("accepts the inclusive 1024 projection-count boundary without mutation I/O", () => {
    const composition = compositionFor(p9Graph());
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
      retainedCountReceiptFor(composition, 1_024),
    );
    expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
      .toMatchObject({
        actualNativeIoCount: 0,
        expectedCount: 1_024,
        lifecycle: "parent-issued",
        model: "parent-owned-reusable",
        sqlAuthority: false,
      });
  });

  it.each([
    ["b2-ddl-zero", 0, 0],
    ["b2-ddl-multiple", 0, 2],
    ["migration-zero", 1, 0],
    ["migration-short", 1, 19],
    ["migration-long", 1, 21],
    ["baseline-negative", 2, -1],
    ["baseline-overflow", 2, 1_025],
    ["baseline-fraction", 2, 1.5],
    ["baseline-NaN", 2, Number.NaN],
    ["baseline-infinite", 2, Number.POSITIVE_INFINITY],
    ["singleton-boolean", 0, true as unknown as number],
    ["migration-string", 1, "20" as unknown as number],
    ["baseline-bigint", 2, 20n as unknown as number],
    ["singleton-boxed-proxy", 3, new Proxy(new Number(1), {}) as unknown as number],
    ["header-zero", 3, 0],
    ["header-multiple", 3, 2],
    ["sequence-zero-zero", 4, 0],
    ["sequence-zero-multiple", 4, 2],
    ["cursor-rebind-zero", 5, 0],
    ["cursor-rebind-multiple", 5, 2],
  ] as const)(
    "rejects hostile route/count pair %s before mutation I/O and performs exact P9 cleanup",
    (_caseName, routeIndex, expectedCount) => {
      const graph = p9Graph();
      const composition = compositionFor(graph);
      expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
        composition,
        SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[routeIndex],
        expectedCount,
      )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({
          closeAttemptCount: 1,
          closeNativeReturnCount: 1,
          commitAttemptCount: 0,
          lifecycle: "finalized",
          reopenAttemptCount: 1,
          reopenSourceV1Count: 1,
          rollbackAttemptCount: 1,
          rollbackNativeReturnCount: 1,
        });
    },
  );

  it("rejects reordered child ordinals before any native I/O", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1],
      20,
    );
    expect(() => issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, 1))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_ORDER" }));
    expect(() => readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_STATE" }));
    expect(() => issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
      1,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_FIXED_READ_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({
        closeAttemptCount: 1,
        commitAttemptCount: 0,
        lifecycle: "finalized",
        reopenAttemptCount: 1,
        rollbackAttemptCount: 1,
      });
  });

  it("separates the 15 B2 and three Rule 12 fixed-read routes and retires portably", () => {
    expect(SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES
      .filter(({ family }) => family === "b2-eqp")).toHaveLength(15);
    expect(SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES
      .filter(({ family }) => family === "rule12-eqp")).toHaveLength(3);
    const permit = issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
      compositionFor(p9Graph()),
      SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[1],
      2,
    );
    prepareSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
    beginSQLiteCursorPublicationFixedReadIntrinsic(permit);
    observeSQLiteCursorPublicationFixedReadRowIntrinsic(permit);
    observeSQLiteCursorPublicationFixedReadRowIntrinsic(permit);
    observeSQLiteCursorPublicationFixedReadTerminalIntrinsic(permit);
    retireSQLiteCursorPublicationFixedReadResourceIntrinsic(permit, "iterator-return");
    consumeSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
    expect(readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic(permit)).toMatchObject({
      actualNativeIoCount: 0,
      consumeCount: 1,
      family: "b2-eqp",
      lifecycle: "consumed",
      maximumCursors: 1,
      maximumRows: 2,
      mutationDelta: 0,
      observedRows: 2,
      prepareCount: 1,
      resourceKind: "iterator-return",
      resourceRetired: true,
      routeId: "b2.eqp.source",
      sqlSha256: "dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4",
      sqlAuthority: false,
      terminalRowObserved: true,
    });
  });

  it("terminally finalizes the exact P9 graph on a fixed-read order failure", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    const permit = issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
      1,
    );
    expect(() => beginSQLiteCursorPublicationFixedReadIntrinsic(permit))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_FIXED_READ_ORDER" }));
    expect(() => readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic(permit))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_STATE" }));
    expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      1,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({
        closeAttemptCount: 1,
        commitAttemptCount: 0,
        lifecycle: "finalized",
        reopenAttemptCount: 1,
        rollbackAttemptCount: 1,
      });
  });

  it("uses captured intrinsics and rejects cloned route descriptors before native I/O", () => {
    const clonedMutationGraph = p9Graph();
    const clonedMutationComposition = compositionFor(clonedMutationGraph);
    const clonedMutationRoute = {
      model: "child-owned-one-shot" as const,
      bindingKind: "sql-sha256" as const,
      bindingSha256: "032db65e1e8c11d90ed27fc6a6e2cab130d1bf33c7d688381f5666379c52b84a",
      routeId: "b2.cursor-seal-table-ddl" as const,
    };
    const clonedReadRoute = {
      family: "b2-eqp" as const,
      routeId: "b2.eqp.source",
      sqlSha256: "dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4",
    };
    expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      clonedMutationComposition,
      clonedMutationRoute,
      0,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(
      clonedMutationGraph.owner,
    )).toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });

    const clonedReadGraph = p9Graph();
    const clonedReadComposition = compositionFor(clonedReadGraph);
    expect(() => issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
      clonedReadComposition,
      clonedReadRoute,
      0,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_FIXED_READ_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(clonedReadGraph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });

    const proxyGraph = p9Graph();
    const proxyComposition = compositionFor(proxyGraph);
    expect(() => issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      proxyComposition,
      new Proxy(SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0], {}),
      0,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(proxyGraph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "finalized" });

    const composition = compositionFor(p9Graph());
    const retainedCountReceipt = retainedCountReceiptFor(composition, 0);

    const someDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "some")!;
    const includesDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "includes")!;
    const arrayIsArrayDescriptor = Object.getOwnPropertyDescriptor(Array, "isArray")!;
    const safeIntegerDescriptor = Object.getOwnPropertyDescriptor(Number, "isSafeInteger")!;
    const reflectApplyDescriptor = Object.getOwnPropertyDescriptor(Reflect, "apply")!;
    const objectCreateDescriptor = Object.getOwnPropertyDescriptor(Object, "create")!;
    const objectFreezeDescriptor = Object.getOwnPropertyDescriptor(Object, "freeze")!;
    const objectGetOwnPropertyDescriptorDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "getOwnPropertyDescriptor",
    )!;
    const objectGetPrototypeOfDescriptor = Object.getOwnPropertyDescriptor(
      Object,
      "getPrototypeOf",
    )!;
    const objectIsFrozenDescriptor = Object.getOwnPropertyDescriptor(Object, "isFrozen")!;
    const weakMapGetDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "get")!;
    const weakMapHasDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "has")!;
    const weakMapSetDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "set")!;
    const weakMapDeleteDescriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, "delete")!;
    const weakRefDerefDescriptor = Object.getOwnPropertyDescriptor(WeakRef.prototype, "deref")!;
    let parent: ReturnType<typeof issueSQLiteCursorPublicationMutationParentScopeIntrinsic>
      | undefined;
    let permit: ReturnType<typeof issueSQLiteCursorPublicationFixedReadPermitIntrinsic>
      | undefined;
    try {
      Object.defineProperty(Array.prototype, "some", {
        ...someDescriptor,
        value: () => { throw new Error("hostile Array.prototype.some"); },
      });
      Object.defineProperty(Array.prototype, "includes", {
        ...includesDescriptor,
        value: () => { throw new Error("hostile Array.prototype.includes"); },
      });
      Object.defineProperty(Array, "isArray", {
        ...arrayIsArrayDescriptor,
        value: () => { throw new Error("hostile Array.isArray"); },
      });
      Object.defineProperty(Number, "isSafeInteger", {
        ...safeIntegerDescriptor,
        value: () => { throw new Error("hostile Number.isSafeInteger"); },
      });
      Object.defineProperty(Object, "create", {
        ...objectCreateDescriptor,
        value: () => { throw new Error("hostile Object.create"); },
      });
      Object.defineProperty(Object, "freeze", {
        ...objectFreezeDescriptor,
        value: () => { throw new Error("hostile Object.freeze"); },
      });
      Object.defineProperty(Object, "getOwnPropertyDescriptor", {
        ...objectGetOwnPropertyDescriptorDescriptor,
        value: () => { throw new Error("hostile Object.getOwnPropertyDescriptor"); },
      });
      Object.defineProperty(Object, "getPrototypeOf", {
        ...objectGetPrototypeOfDescriptor,
        value: () => { throw new Error("hostile Object.getPrototypeOf"); },
      });
      Object.defineProperty(Object, "isFrozen", {
        ...objectIsFrozenDescriptor,
        value: () => { throw new Error("hostile Object.isFrozen"); },
      });
      Object.defineProperty(WeakMap.prototype, "get", {
        ...weakMapGetDescriptor,
        value: () => { throw new Error("hostile WeakMap.prototype.get"); },
      });
      Object.defineProperty(WeakMap.prototype, "has", {
        ...weakMapHasDescriptor,
        value: () => { throw new Error("hostile WeakMap.prototype.has"); },
      });
      Object.defineProperty(WeakMap.prototype, "set", {
        ...weakMapSetDescriptor,
        value: () => { throw new Error("hostile WeakMap.prototype.set"); },
      });
      Object.defineProperty(WeakMap.prototype, "delete", {
        ...weakMapDeleteDescriptor,
        value: () => { throw new Error("hostile WeakMap.prototype.delete"); },
      });
      Object.defineProperty(WeakRef.prototype, "deref", {
        ...weakRefDerefDescriptor,
        value: () => { throw new Error("hostile WeakRef.prototype.deref"); },
      });
      Object.defineProperty(Reflect, "apply", {
        ...reflectApplyDescriptor,
        value: () => { throw new Error("hostile Reflect.apply"); },
      });
      parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
        composition,
        SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        retainedCountReceipt,
      );
      prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
      acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic(parent);
      retireSQLiteCursorPublicationReusableParentResourceIntrinsic(parent);
      consumeSQLiteCursorPublicationMutationParentScopeIntrinsic(parent);
      permit = issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
        composition,
        SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[16],
        0,
      );
      prepareSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
      beginSQLiteCursorPublicationFixedReadIntrinsic(permit);
      observeSQLiteCursorPublicationFixedReadTerminalIntrinsic(permit);
      retireSQLiteCursorPublicationFixedReadResourceIntrinsic(permit, "lexical-release");
      consumeSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
    } finally {
      Object.defineProperty(Array.prototype, "some", someDescriptor);
      Object.defineProperty(Array.prototype, "includes", includesDescriptor);
      Object.defineProperty(Array, "isArray", arrayIsArrayDescriptor);
      Object.defineProperty(Number, "isSafeInteger", safeIntegerDescriptor);
      Object.defineProperty(Reflect, "apply", reflectApplyDescriptor);
      Object.defineProperty(Object, "create", objectCreateDescriptor);
      Object.defineProperty(Object, "freeze", objectFreezeDescriptor);
      Object.defineProperty(
        Object,
        "getOwnPropertyDescriptor",
        objectGetOwnPropertyDescriptorDescriptor,
      );
      Object.defineProperty(Object, "getPrototypeOf", objectGetPrototypeOfDescriptor);
      Object.defineProperty(Object, "isFrozen", objectIsFrozenDescriptor);
      Object.defineProperty(WeakMap.prototype, "get", weakMapGetDescriptor);
      Object.defineProperty(WeakMap.prototype, "has", weakMapHasDescriptor);
      Object.defineProperty(WeakMap.prototype, "set", weakMapSetDescriptor);
      Object.defineProperty(WeakMap.prototype, "delete", weakMapDeleteDescriptor);
      Object.defineProperty(WeakRef.prototype, "deref", weakRefDerefDescriptor);
    }
    expect(readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent!))
      .toMatchObject({ actualNativeIoCount: 0, lifecycle: "parent-consumed", sqlAuthority: false });
    expect(readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic(permit!))
      .toMatchObject({
        actualNativeIoCount: 0,
        lifecycle: "consumed",
        resourceKind: "lexical-release",
        sqlAuthority: false,
      });
  });

  it("rejects cloned and proxied derived authorities without using or retiring the live graph", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      1,
    );
    const child = issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, 0);
    const permit = issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
      1,
    );

    expect(() => prepareSQLiteCursorPublicationReusableParentIntrinsic(
      Object.freeze({ ...parent }),
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_SCOPE_INVALID" }));
    expect(() => enterSQLiteCursorPublicationMutationChildPermitIntrinsic(
      new Proxy(child, {}),
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_AUTHORITY" }));
    expect(() => prepareSQLiteCursorPublicationFixedReadPermitIntrinsic(
      Object.freeze({ ...permit }),
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_FIXED_READ_INVALID" }));
    expect(() => readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic(
      new Proxy(permit, {}),
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_AUTHORITY" }));

    expect(readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic(composition))
      .toMatchObject({
        commitAttemptCount: 0,
        lifecycle: "begin-adopted",
      });
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({ commitAttemptCount: 0, lifecycle: "active" });
  });

  it("bounded-stop reuses P9 failure authority and preserves the exact primary", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    const primary = new Error("P11_BOUNDED_STOP_NO_COMMIT");
    let thrown: unknown;
    try {
      boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic(
        composition,
        primary,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(primary);
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({
        closeAttemptCount: 1,
        commitAttemptCount: 0,
        lifecycle: "finalized",
        reopenAttemptCount: 1,
        rollbackAttemptCount: 1,
      });
    expect(() => boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic(
      composition,
      new Error("replay"),
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_STATE" }));
  });

  it("reauthenticates the exact live composition on every derived authority transition", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      1,
    );
    const permit = issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
      1,
    );
    const primary = new Error("P11_DERIVED_AUTHORITY_REAUTH_STOP");
    let thrown: unknown;
    try {
      boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic(
        composition,
        primary,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(primary);
    expect(() => issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, 0))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_STATE" }));
    expect(() => prepareSQLiteCursorPublicationFixedReadPermitIntrinsic(permit))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_STATE" }));
    expect(() => readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_STATE" }));
    expect(() => readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic(permit))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_STATE" }));
  });

  it.each(P11_DERIVED_TRANSITIONS)(
    "rejects direct native transaction/temp/total drift before %s and performs exact P9 cleanup",
    (_name, prepareTransition) => {
      const graph = p9Graph();
      const composition = compositionFor(graph);
      const transition = prepareTransition(composition);
      driftNativeWatermarks(graph);

      let thrown: unknown;
      try {
        transition();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(SQLiteCursorPublicationOwnerCompositionError);
      expect(thrown).toMatchObject({ code: "GE_SQLITE_P11_INVALID_AUTHORITY" });
      expect(() => readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic(composition))
        .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_AUTHORITY" }));
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
        .toMatchObject({
          closeAttemptCount: 1,
          closeNativeReturnCount: 1,
          commitAttemptCount: 0,
          lifecycle: "finalized",
          reopenAttemptCount: 1,
          reopenSourceV1Count: 1,
          rollbackAttemptCount: 1,
          rollbackNativeReturnCount: 1,
        });
    },
  );

  it("rejects a directly replaced native lineage/generation and still closes and reopens v1", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      1,
    );
    replaceNativeLineageAndGeneration(graph);

    expect(() => issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, 0))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_AUTHORITY" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({
        closeAttemptCount: 1,
        closeNativeReturnCount: 1,
        commitAttemptCount: 0,
        lifecycle: "finalized",
        reopenAttemptCount: 1,
        reopenSourceV1Count: 1,
        rollbackAttemptCount: 1,
        rollbackNativeReturnCount: 0,
      });
  });

  it("rejects a directly ended native transaction before issuing any new authority", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    rollbackNativeOwnerTransaction(graph);
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toMatchObject({
      isTransaction: false,
      publicationTransactionGeneration: null,
      transactionLineage: null,
    });

    expect(() => issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
      1,
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_P11_INVALID_AUTHORITY" }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner))
      .toMatchObject({
        closeAttemptCount: 1,
        closeNativeReturnCount: 1,
        commitAttemptCount: 0,
        lifecycle: "finalized",
        reopenAttemptCount: 1,
        reopenSourceV1Count: 1,
        rollbackAttemptCount: 1,
        rollbackNativeReturnCount: 0,
      });
  });

  it("does not export the P11 authority from the package root", () => {
    expect(sqliteRoot).not.toHaveProperty(
      "adoptSQLiteCursorPublicationOwnerCompositionIntrinsic",
    );
    expect(sqliteRoot).not.toHaveProperty(
      "assertSQLiteCursorPublicationOwnerCompositionRule12Intrinsic",
    );
    expect(sqliteRoot).not.toHaveProperty(
      "issueSQLiteCursorPublicationMutationParentScopeIntrinsic",
    );
    expect(sqliteRoot).not.toHaveProperty(
      "mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic",
    );
    expect(sqliteRoot).not.toHaveProperty(
      "readSQLiteCursorPublicationRetainedCountReceiptSnapshotIntrinsic",
    );
    expect(sqliteRoot).not.toHaveProperty(
      "issueSQLiteCursorPublicationFixedReadPermitIntrinsic",
    );
  });
});

interface P11TrackedReferent {
  readonly label: string;
  readonly reference: WeakRef<object>;
}

function buildAndAbandonP11AuthorityGraph(): Readonly<{
  readonly finalized: Set<string>;
  readonly referents: readonly P11TrackedReferent[];
  readonly registry: FinalizationRegistry<string>;
  readonly root: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-p11-gc-"));
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: 1_700_000_000_000,
  });
  const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
  const beginReceipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
  const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(owner, beginReceipt);
  const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
    composition,
    SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
    1,
  );
  const child = issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, 0);
  const fixedRead = issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
    composition,
    SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
    1,
  );
  const retainedCountReceipt = retainedCountReceiptFor(composition, 0);
  const retainedCountParent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
    composition,
    SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
    retainedCountReceipt,
  );
  const finalized = new Set<string>();
  const registry = new FinalizationRegistry<string>((label) => finalized.add(label));
  const referents = [
    ["connection", connection],
    ["owner", owner],
    ["begin-receipt", beginReceipt],
    ["composition", composition],
    ["mutation-parent", parent],
    ["mutation-child", child],
    ["fixed-read", fixedRead],
    ["retained-count-receipt", retainedCountReceipt],
    ["retained-count-parent", retainedCountParent],
  ].map(([label, value]) => {
    registry.register(value as object, label as string);
    return { label: label as string, reference: new WeakRef(value as object) };
  });
  return { finalized, referents, registry, root };
}

async function forceP11AuthorityGraphCollection(
  referents: readonly P11TrackedReferent[],
): Promise<readonly string[]> {
  for (let round = 0; round < 80; round += 1) {
    globalThis.gc!();
    const pressure = Array.from({ length: 4 }, () => new Uint8Array(2 * 1024 * 1024));
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

describe("SQLite P11-A isolated abandoned-authority GC", () => {
  if (process.env.GRAPH_ENGINEERING_RUN_P11_GC_PROBE !== "1") {
    it("passes the bounded node --expose-gc probe", () => {
      const packageRoot = fileURLToPath(new URL("..", import.meta.url));
      const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          vitest,
          "run",
          "test/cursor-publication-owner-composition.test.ts",
          "--pool=threads",
          "--maxWorkers=1",
          "--fileParallelism=false",
          "--reporter=dot",
        ],
        {
          cwd: packageRoot,
          encoding: "utf8",
          env: { ...process.env, GRAPH_ENGINEERING_RUN_P11_GC_PROBE: "1" },
          timeout: 150_000,
        },
      );
      expect(result.error, `GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
      expect(result.signal, `GC probe was terminated: ${result.stderr}`).toBeNull();
      expect(result.status, [
        "isolated P11-A abandoned-authority GC probe failed",
        `stdout=${result.stdout}`,
        `stderr=${result.stderr}`,
      ].join("\n")).toBe(0);
    }, 160_000);
  } else {
    it("collects an abandoned live P9/P11 graph without WeakMap or WeakRef reverse roots", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const tracked = buildAndAbandonP11AuthorityGraph();
      const live = await forceP11AuthorityGraphCollection(tracked.referents);
      try {
        expect(live).toEqual([]);
        expect(tracked.finalized).toEqual(new Set(tracked.referents.map(({ label }) => label)));
      } finally {
        rmSync(tracked.root, { recursive: true, force: true });
      }
    }, 120_000);
  }
});
