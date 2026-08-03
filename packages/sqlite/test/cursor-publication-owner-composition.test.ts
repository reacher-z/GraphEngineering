import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  observeSQLiteCursorPublicationFixedReadRowIntrinsic,
  observeSQLiteCursorPublicationFixedReadTerminalIntrinsic,
  prepareSQLiteCursorPublicationFixedReadPermitIntrinsic,
  prepareSQLiteCursorPublicationReusableParentIntrinsic,
  readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic,
  readSQLiteCursorPublicationMutationChildPermitSnapshotIntrinsic,
  readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic,
  readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic,
  recordSQLiteCursorPublicationMutationChildReturnIntrinsic,
  retireSQLiteCursorPublicationFixedReadResourceIntrinsic,
  retireSQLiteCursorPublicationMutationChildResourceIntrinsic,
  retireSQLiteCursorPublicationReusableParentResourceIntrinsic,
  SQLiteCursorPublicationOwnerCompositionError,
  type SQLiteCursorPublicationOwnerComposition,
} from "../src/cursor-publication-owner-composition.js";
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
import { SQLiteConnection } from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  publishReaderLeaseTestGraphSession,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

interface P9Graph {
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
  const value = { beginReceipt, owner, root };
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

  it("runs the child-owned one-shot parent/child state machine without SQL authority", () => {
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      compositionFor(p9Graph()),
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1],
      2,
    );
    for (let ordinal = 0; ordinal < 2; ordinal += 1) {
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
        childConsumedCount: 2,
        childResourceRetiredCount: 2,
        expectedCount: 2,
        lifecycle: "parent-consumed",
        nextOrdinal: 2,
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
      const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
        compositionFor(p9Graph()),
        SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        expectedCount,
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

  it("rejects reordered child ordinals before any native I/O", () => {
    const graph = p9Graph();
    const composition = compositionFor(graph);
    const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
      composition,
      SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
      2,
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

    const someDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "some")!;
    const includesDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "includes")!;
    const safeIntegerDescriptor = Object.getOwnPropertyDescriptor(Number, "isSafeInteger")!;
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
      Object.defineProperty(Number, "isSafeInteger", {
        ...safeIntegerDescriptor,
        value: () => { throw new Error("hostile Number.isSafeInteger"); },
      });
      parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
        composition,
        SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
        0,
      );
      acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic(parent);
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
      Object.defineProperty(Number, "isSafeInteger", safeIntegerDescriptor);
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
      "issueSQLiteCursorPublicationFixedReadPermitIntrinsic",
    );
  });
});
