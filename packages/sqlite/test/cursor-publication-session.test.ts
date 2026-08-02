import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic,
  consumeSQLiteCursorProviderClockEvidenceIntrinsic,
  observeSQLiteCursorProviderClockIntrinsic,
} from
  "../src/cursor-publication-clock-authority.js";
import * as sqliteRoot from "../src/index.js";
import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  assertSQLiteCursorPublicationSessionIntrinsic,
  createSQLiteCursorPublicationSessionCancellationControllerIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  injectSQLiteCursorPublicationSessionPendingRegistrationFaultForTestIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteCursorPublicationSessionSnapshotIntrinsic,
  type SQLiteBaselineEntriesPublicationReceipt,
  type SQLiteBaselineHeaderPublicationReceipt,
  type SQLiteCursorInitialPublicationReceiptBundle,
  type SQLiteCursorInitialStageAdoptionReceipt,
  type SQLiteCursorPostDdlPublicationReaderLease,
  type SQLiteOperationSequenceZeroPublicationReceipt,
} from "../src/cursor-publication-outer-authority.js";
import {
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";
import {
  READER_CAPTURED_AT_MS,
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const SESSION_CLOCK_MS = READER_CAPTURED_AT_MS + 1_234;

interface AdoptedGraph extends ReaderLeaseTestGraph {
  readonly adoptionReceipt: SQLiteCursorInitialStageAdoptionReceipt;
  readonly bundle: SQLiteCursorInitialPublicationReceiptBundle;
  readonly entriesReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly headerReceipt: SQLiteBaselineHeaderPublicationReceipt;
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly sequenceReceipt: SQLiteOperationSequenceZeroPublicationReceipt;
}

const graphs: ReaderLeaseTestGraph[] = [];

function adoptedGraph(legacyOperationCount = 2): AdoptedGraph {
  const graph = createReaderLeaseTestGraph(legacyOperationCount, {
    outerProviderNowMs: SESSION_CLOCK_MS,
  });
  graphs.push(graph);
  const readerLease = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
    graph.authority, graph.migration0002Receipt, graph.fence,
  );
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
    graph.authority, graph.migration0002Receipt, graph.fence, readerLease,
  );
  const entriesReceipt = executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
    graph.authority, graph.migration0002Receipt, graph.fence, readerLease,
  );
  const headerReceipt = executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    readerLease,
    entriesReceipt,
  );
  const sequenceReceipt = executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    readerLease,
    entriesReceipt,
    headerReceipt,
  );
  const bundle = Object.freeze([
    graph.migration0002Receipt,
    entriesReceipt,
    headerReceipt,
    sequenceReceipt,
  ] as const satisfies SQLiteCursorInitialPublicationReceiptBundle);
  const adoptionReceipt = adoptSQLiteCursorInitialPublicationStageIntrinsic(
    graph.authority, bundle, graph.fence, readerLease,
  );
  return {
    ...graph,
    adoptionReceipt,
    bundle,
    entriesReceipt,
    headerReceipt,
    readerLease,
    sequenceReceipt,
  };
}

function expectProviderError(
  callback: () => unknown,
  code: string,
  message: RegExp,
): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    expect((error as CycleStoreProviderError).code).toBe(code);
    expect((error as Error).message).toMatch(message);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected ${code}`);
}

function cloneOpaque<T extends object>(value: T): T {
  return Object.freeze(Object.assign(Object.create(null), value)) as T;
}

afterEach(() => {
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite cursor publication session", () => {
  it("publishes the exact adopted graph across all three layers and reasserts read-only", () => {
    const graph = adoptedGraph(5);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const changesBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    const session = publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence);
    const snapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);

    expect(Object.isFrozen(preparedOwner)).toBe(true);
    expect(Object.getPrototypeOf(preparedOwner)).toBeNull();
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.getPrototypeOf(session)).toBeNull();
    expect(assertSQLiteCursorPublicationSessionIntrinsic(session)).toBe(session);
    expect(assertSQLiteCursorPublicationSessionIntrinsic(session)).toBe(session);
    expect(snapshot).toMatchObject({
      connection: graph.connection,
      initialStageAdoptionReceipt: graph.adoptionReceipt,
      lifecycle: "publication-active",
      outerAuthority: graph.authority,
      outerClockEvidence: graph.outerClockEvidence,
      postDdlCatalogFence: graph.fence,
      preRebindClockEvidence: evidence,
      projectionIdentity: graph.projectionIdentity,
      projectionReference: graph.projectionReference,
      providerClockCapability: graph.providerClockCapability,
      receipt: graph.preRebindReceipt,
      sourceDescriptorHash:
        readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority)
          .sourceDescriptorHash,
      stage: graph.stage,
      targetDescriptorHash:
        "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92",
      transactionLineage: ownerBefore.transactionLineage,
      transfer: graph.transfer,
    });
    expect(snapshot.migrationLockIdentity).toMatchObject({
      lockId: "b3-reader-lock",
      ownerId: "b3-reader-owner",
      sourceSchemaVersion: 1,
      targetSchemaVersion: 2,
    });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "active",
        publicationPreparedOwner: preparedOwner,
        publicationSession: session,
        writePhase: "publication-active",
      });
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(changesBefore);
  });

  it("observes cancellation after evidence validation and retries the same exact graph", () => {
    const graph = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    const cancellation = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    cancellation.cancel();

    expectProviderError(
      () => publishSQLiteCursorPublicationSessionIntrinsic(
        preparedOwner, evidence, cancellation.signal,
      ),
      "GE_CYCLE_STORE_UNAVAILABLE",
      /publication session was cancelled/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "active",
        publicationPreparedOwner: preparedOwner,
        publicationSession: undefined,
        writePhase: "initial-stage-adoption-complete",
      });

    const session = publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence);
    expect(assertSQLiteCursorPublicationSessionIntrinsic(session)).toBe(session);
  });

  it("rejects malformed cancellation presentation without poisoning the prepared graph", () => {
    const graph = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);

    expectProviderError(
      () => publishSQLiteCursorPublicationSessionIntrinsic(
        preparedOwner,
        evidence,
        Object.freeze(Object.create(null)),
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /cancellation is invalid/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "active", publicationSession: undefined });
    expect(assertSQLiteCursorPublicationSessionIntrinsic(
      publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence),
    )).toBeTruthy();
  });

  it("poisons the selected graph for a cloned adoption receipt", () => {
    const graph = adoptedGraph();
    expectProviderError(
      () => prepareSQLiteCursorPublicationSessionIntrinsic(
        graph.authority, cloneOpaque(graph.adoptionReceipt),
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /adoption receipt is invalid/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("rejects cloned prepared/session carriers and poisons cross-run adoption substitution", () => {
    const graph = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    expect(prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    )).toBe(preparedOwner);
    expectProviderError(
      () => observeSQLiteCursorPublicationSessionClockIntrinsic(cloneOpaque(preparedOwner)),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /session owner is invalid/u,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    const session = publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence);
    expectProviderError(
      () => assertSQLiteCursorPublicationSessionIntrinsic(cloneOpaque(session)),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /session is invalid/u,
    );
    expect(assertSQLiteCursorPublicationSessionIntrinsic(session)).toBe(session);

    const selected = adoptedGraph();
    const foreign = adoptedGraph();
    expectProviderError(
      () => prepareSQLiteCursorPublicationSessionIntrinsic(
        selected.authority, foreign.adoptionReceipt,
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /adoption receipt is invalid/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(selected.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(foreign.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "initial-stage-adoption-complete" });
  });

  it("rejects publication when a third clock boundary advances ahead of the second", () => {
    const graph = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    observeSQLiteCursorProviderClockIntrinsic(
      graph.providerClockCapability, "before-verification",
    );

    expectProviderError(
      () => publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /prepared cursor publication session clock graph is invalid/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons the selected graph for cross-run evidence and leaves the source graph live", () => {
    const graph = adoptedGraph();
    const other = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    const otherPreparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      other.authority, other.adoptionReceipt,
    );
    observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    const otherEvidence = observeSQLiteCursorPublicationSessionClockIntrinsic(
      otherPreparedOwner,
    );

    expectProviderError(
      () => publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, otherEvidence),
      "GE_CYCLE_STORE_CORRUPTION",
      /evidence is invalid/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(other.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "initial-stage-adoption-complete" });
  });

  it("treats preconsumption and successful-tail replay as terminal corruption", () => {
    const preconsumed = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      preconsumed.authority, preconsumed.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    consumeSQLiteCursorProviderClockEvidenceIntrinsic(
      preconsumed.providerClockCapability, evidence, "cursor-publication-session",
    );
    expectProviderError(
      () => publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /prepared cursor publication session clock graph is invalid/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(preconsumed.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });

    const replay = adoptedGraph();
    const replayOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      replay.authority, replay.adoptionReceipt,
    );
    const replayEvidence = observeSQLiteCursorPublicationSessionClockIntrinsic(replayOwner);
    publishSQLiteCursorPublicationSessionIntrinsic(replayOwner, replayEvidence);
    expectProviderError(
      () => publishSQLiteCursorPublicationSessionIntrinsic(replayOwner, replayEvidence),
      "GE_CYCLE_STORE_CORRUPTION",
      /evidence is invalid/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(replay.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons an active session when the transaction generation changes", () => {
    const graph = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    const session = publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence);
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");

    expectProviderError(
      () => assertSQLiteCursorPublicationSessionIntrinsic(session),
      "GE_CYCLE_STORE_STALE_FENCE",
      /(?:owner|lineage|graph|changed|retired)/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons post-tail catalog and total_changes drift without observing another clock", () => {
    const graph = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    const session = publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence);
    graph.connection.prepare(
      "INSERT INTO main.ge_cycle_used_migration_lock_ids "
        + "(lock_id, lock_epoch, fencing_token, first_used_at_ms) VALUES (?, ?, ?, ?)",
      "inspect-schema",
    ).run("hostile-session-ledger", 1001, 1001, SESSION_CLOCK_MS);

    expectProviderError(
      () => assertSQLiteCursorPublicationSessionIntrinsic(session),
      "GE_CYCLE_STORE_STALE_FENCE",
      /(?:graph changed|ledger|changed)/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });

    const catalog = adoptedGraph();
    const catalogOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      catalog.authority, catalog.adoptionReceipt,
    );
    const catalogEvidence = observeSQLiteCursorPublicationSessionClockIntrinsic(catalogOwner);
    const catalogSession = publishSQLiteCursorPublicationSessionIntrinsic(
      catalogOwner, catalogEvidence,
    );
    catalog.connection.execTrusted(
      "CREATE TABLE main.hostile_publication_catalog (value INTEGER NOT NULL)",
      "inspect-schema",
    );
    expectProviderError(
      () => assertSQLiteCursorPublicationSessionIntrinsic(catalogSession),
      "GE_CYCLE_STORE_STALE_FENCE",
      /(?:catalog|validation|drift|graph changed)/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(catalog.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("retains a pending-registration primary failure, poisons every owner, and fires once", () => {
    const graph = adoptedGraph();
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      graph.authority, graph.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    const primary = new Error("injected pending registration failure");
    injectSQLiteCursorPublicationSessionPendingRegistrationFaultForTestIntrinsic(primary);
    expectProviderError(
      () => injectSQLiteCursorPublicationSessionPendingRegistrationFaultForTestIntrinsic(
        new Error("must not replace the primary fault"),
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /fault is already armed/u,
    );

    expect(() => publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence))
      .toThrow(primary);
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );
    expect(authority).toMatchObject({
      lifecycle: "poisoned",
      publicationSession: undefined,
      writePhase: "poisoned",
    });
    expect(graph.stage.state).toBe("poisoned");
    expect(assertSQLiteCursorPublicationSessionClockPreparedGraphIntrinsic(
      graph.connection,
      graph.migrationLockCapability,
      graph.providerClockCapability,
      graph.outerClockEvidence,
      authority.outerClockConsumedTombstone!,
      evidence,
    ).boundary).toBe("before-cursor-rebind");

    const fresh = adoptedGraph();
    const freshOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      fresh.authority, fresh.adoptionReceipt,
    );
    const freshEvidence = observeSQLiteCursorPublicationSessionClockIntrinsic(freshOwner);
    expect(assertSQLiteCursorPublicationSessionIntrinsic(
      publishSQLiteCursorPublicationSessionIntrinsic(freshOwner, freshEvidence),
    )).toBeTruthy();
  });

  it("keeps carriers private and recursively closes the atomic tail over assignments", () => {
    for (const name of [
      "prepareSQLiteCursorPublicationSessionIntrinsic",
      "observeSQLiteCursorPublicationSessionClockIntrinsic",
      "publishSQLiteCursorPublicationSessionIntrinsic",
      "assertSQLiteCursorPublicationSessionIntrinsic",
      "injectSQLiteCursorPublicationSessionPendingRegistrationFaultForTestIntrinsic",
    ]) {
      expect(name in sqliteRoot).toBe(false);
    }
    const source = readFileSync(
      new URL("../src/cursor-publication-outer-authority.ts", import.meta.url),
      "utf8",
    );
    const tail = source.slice(
      source.indexOf("// Atomic tail: outer burn"),
      source.indexOf("} catch (error) {", source.indexOf("// Atomic tail: outer burn")),
    );
    const consumeIndex = tail.indexOf("consumeSQLiteCursorProviderClockEvidenceIntrinsic");
    const publishIndex = tail.indexOf("lowerTransition.publish()");
    expect(tail.indexOf("lowerTransition.burn()")).toBeGreaterThan(-1);
    expect(consumeIndex).toBeGreaterThan(tail.indexOf("lowerTransition.burn()"));
    expect(publishIndex).toBeGreaterThan(consumeIndex);
    expect(tail).not.toMatch(/\b(?:prepare|exec|query|providerNow|cancel|commit|rollback|rebind)\b/iu);
    expect(tail).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/u);
    expect(tail.slice(consumeIndex)).not.toMatch(
      /(?:WeakMap|weakMap|reflectApply|assertSQLite|readTransfer|invalid\(|throw\s)/u,
    );

    const assertionStart = source.indexOf(
      "export function assertSQLiteCursorPublicationSessionIntrinsic",
    );
    const assertionEnd = source.indexOf("\nexport function ", assertionStart + 1);
    const assertionClosure = source.slice(assertionStart, assertionEnd);
    expect(assertionStart).toBeGreaterThan(-1);
    expect(assertionClosure).toContain(
      "assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic",
    );
    expect(assertionClosure.match(
      /assertSQLiteCursorPublicationSessionClockActiveGraphIntrinsic\s*\(/gu,
    )).toHaveLength(1);
    expect(assertionClosure.match(
      /readValidatedSQLiteCursorPublicationTargetCatalogObservationIntrinsic\s*\(/gu,
    )).toHaveLength(1);
    expect(assertionClosure).not.toContain(
      "assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(",
    );

    for (const file of [
      "../src/operation-baseline-cursor-stage-ownership.ts",
      "../src/operation-baseline-stage.ts",
    ] as const) {
      const lowerSource = readFileSync(new URL(file, import.meta.url), "utf8");
      const transitionStart = lowerSource.indexOf(
        file.includes("stage-ownership")
          ? "export function prepareSQLiteCursorStageOwnershipPublicationSessionTransitionIntrinsic"
          : "[SQLITE_BASELINE_PREPARE_CURSOR_PUBLICATION_SESSION_TRANSITION]",
      );
      const burnStart = lowerSource.indexOf("burn: (): void => {", transitionStart);
      const burnEnds = [
        lowerSource.indexOf("\n    },", burnStart),
        lowerSource.indexOf("\n      },", burnStart),
      ].filter((value) => value > burnStart);
      const burnEnd = Math.min(...burnEnds);
      const publishStart = lowerSource.indexOf("publish: (): void => {", transitionStart);
      const publishEnds = [
        lowerSource.indexOf("\n    },", publishStart),
        lowerSource.indexOf("\n      },", publishStart),
      ].filter((value) => value > publishStart);
      const publishEnd = Math.min(...publishEnds);
      const burnClosure = lowerSource.slice(burnStart, burnEnd);
      const publishClosure = lowerSource.slice(publishStart, publishEnd);
      expect(transitionStart).toBeGreaterThan(-1);
      expect(burnStart).toBeGreaterThan(transitionStart);
      expect(burnEnd).toBeGreaterThan(burnStart);
      expect(publishStart).toBeGreaterThan(transitionStart);
      expect(publishEnd).toBeGreaterThan(publishStart);
      for (const transitionClosure of [burnClosure, publishClosure]) {
        expect(transitionClosure).not.toMatch(
        /(?:WeakMap|weakMap|reflectApply|\binvalid\(|\bassert|\bprepare|\bread|\bthrow|\bdelete)/u,
        );
        expect(transitionClosure).not.toMatch(
          /\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA|providerNow|cancel|commit|rollback|rebind|exec|query)\b/iu,
        );
      }
      const transitionPreparation = lowerSource.slice(transitionStart, burnStart);
      expect(transitionPreparation).not.toMatch(
        /this\s*\[SQLITE_BASELINE_ASSERT_CURSOR_PUBLICATION_SESSION_PREPARED\]/u,
      );
    }
  });
});
