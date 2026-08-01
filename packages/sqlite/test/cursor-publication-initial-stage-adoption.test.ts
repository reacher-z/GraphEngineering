import { DatabaseSync, StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic,
  assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic,
  assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic,
  assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic,
  assertSQLiteCursorPostDdlCatalogFenceIntrinsic,
  createSQLiteCursorOuterPublicationCancellationControllerIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic,
  readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic,
  readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic,
  readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic,
  type SQLiteBaselineEntriesPublicationReceipt,
  type SQLiteBaselineHeaderPublicationReceipt,
  type SQLiteCursorInitialPublicationReceiptBundle,
  type SQLiteCursorInitialStageAdoptionReceipt,
  type SQLiteCursorPostDdlPublicationReaderLease,
  type SQLiteMigration0002CatalogRebuildReceipt,
  type SQLiteOperationSequenceZeroPublicationReceipt,
} from "../src/cursor-publication-outer-authority.js";
import {
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";
import {
  assertSQLiteCursorStageOwnershipInitialPublicationAdoptedIntrinsic,
  poisonSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
  prepareSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic,
  publishSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic,
  retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic,
} from "../src/operation-baseline-cursor-stage-ownership.js";
import {
  SQLITE_CURSOR_INITIAL_PUBLICATION_TARGET_CATALOG_SHA256,
  type SQLiteCursorInitialPublicationStageWatermark,
} from "../src/operation-baseline-stage.js";
import {
  READER_CAPTURED_AT_MS,
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const SEQUENCE_UPDATED_AT_MS = READER_CAPTURED_AT_MS + 1_234;

interface AdoptionGraph extends ReaderLeaseTestGraph {
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly entriesReceipt: SQLiteBaselineEntriesPublicationReceipt;
  readonly headerReceipt: SQLiteBaselineHeaderPublicationReceipt;
  readonly sequenceReceipt: SQLiteOperationSequenceZeroPublicationReceipt;
  readonly bundle: SQLiteCursorInitialPublicationReceiptBundle;
}

const graphs: ReaderLeaseTestGraph[] = [];

function adoptionGraph(legacyOperationCount = 1): AdoptionGraph {
  const graph = createReaderLeaseTestGraph(legacyOperationCount, {
    outerProviderNowMs: SEQUENCE_UPDATED_AT_MS,
  });
  graphs.push(graph);
  const readerLease = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
  );
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    readerLease,
  );
  const entriesReceipt = executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    readerLease,
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
  return {
    ...graph,
    bundle,
    entriesReceipt,
    headerReceipt,
    readerLease,
    sequenceReceipt,
  };
}

function adopt(
  graph: AdoptionGraph,
  bundle: SQLiteCursorInitialPublicationReceiptBundle = graph.bundle,
): SQLiteCursorInitialStageAdoptionReceipt {
  return adoptSQLiteCursorInitialPublicationStageIntrinsic(
    graph.authority,
    bundle,
    graph.fence,
    graph.readerLease,
  );
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

function expectUnconsumedHealthy(graph: AdoptionGraph): void {
  expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
    .toMatchObject({
      baselineEntriesConsumedTombstone: undefined,
      baselineHeaderConsumedTombstone: undefined,
      initialStageAdoptionReceipt: undefined,
      initialStageAdoptionReceiptMintCount: 0,
      lifecycle: "active",
      migration0002ConsumedTombstone: undefined,
      operationSequenceZeroConsumedTombstone: undefined,
      receiptConsumptionCount: 0,
      stageOwnershipPoisonReason: undefined,
      tombstoneMintCount: 0,
      writePhase: "sequence-zero-complete",
    });
}

function prepareLowerStageAdoption(graph: AdoptionGraph): ReturnType<
  typeof prepareSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic
> {
  const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
    graph.authority,
  );
  const owner = readSQLiteConnectionOwnerSnapshot(graph.connection);
  const totalChanges = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
  const watermark = Object.freeze({
    outerLedger: authority.outerLedger,
    targetCatalogSha256: SQLITE_CURSOR_INITIAL_PUBLICATION_TARGET_CATALOG_SHA256,
    totalChanges: totalChanges.totalChanges,
    transactionEpoch: owner.transactionEpoch,
  } satisfies SQLiteCursorInitialPublicationStageWatermark);
  return prepareSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic(
    graph.connection,
    graph.stage,
    graph.preRebindReceipt,
    graph.projectionIdentity,
    graph.transfer,
    graph.authority,
    graph.readerLease,
    watermark,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite initial publication atomic stage adoption", () => {
  it("consumes the exact ordered four-receipt chain atomically and preserves watermarks", () => {
    const graph = adoptionGraph(8);
    const authorityBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);

    const receipt = adopt(graph);
    const snapshot = readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(receipt);
    const authorityAfter = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );

    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.getPrototypeOf(receipt)).toBeNull();
    expect(snapshot).toMatchObject({
      adoptedOuterLedger: authorityBefore.outerLedger,
      adoptedTotalChanges: totalBefore.totalChanges,
      adoptedTransactionEpoch: ownerBefore.transactionEpoch,
      authority: graph.authority,
      baselineEntriesPublicationReceipt: graph.entriesReceipt,
      baselineHeaderPublicationReceipt: graph.headerReceipt,
      connection: graph.connection,
      migration0002Receipt: graph.migration0002Receipt,
      mintCount: 1,
      operationSequenceZeroPublicationReceipt: graph.sequenceReceipt,
      postDdlCatalogFence: graph.fence,
      projectionIdentity: graph.projectionIdentity,
      projectionReference: graph.projectionReference,
      readerCloseCount: 1,
      readerLease: graph.readerLease,
      readerLeaseLifecycle: "retired",
      receipt: graph.preRebindReceipt,
      stage: graph.stage,
      targetCatalogSha256:
        "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf",
      transactionLineage: ownerBefore.transactionLineage,
      transfer: graph.transfer,
      writeKind: "initial-publication-stage-adoption",
    });
    expect(snapshot.readerReDerivedProjectionSha256).toMatch(/^[0-9a-f]{64}$/u);
    for (const tombstone of [
      snapshot.migration0002ConsumedTombstone,
      snapshot.baselineEntriesConsumedTombstone,
      snapshot.baselineHeaderConsumedTombstone,
      snapshot.operationSequenceZeroConsumedTombstone,
    ]) {
      expect(Object.isFrozen(tombstone)).toBe(true);
      expect(Object.getPrototypeOf(tombstone)).toBeNull();
    }
    expect(authorityAfter).toMatchObject({
      baselineEntriesConsumedTombstone: snapshot.baselineEntriesConsumedTombstone,
      baselineHeaderConsumedTombstone: snapshot.baselineHeaderConsumedTombstone,
      initialStageAdoptionReceipt: receipt,
      initialStageAdoptionReceiptMintCount: 1,
      lifecycle: "active",
      migration0002ConsumedTombstone: snapshot.migration0002ConsumedTombstone,
      operationSequenceZeroConsumedTombstone:
        snapshot.operationSequenceZeroConsumedTombstone,
      outerLedger: authorityBefore.outerLedger,
      postDdlCatalogFence: graph.fence,
      receiptConsumptionCount: 4,
      tombstoneMintCount: 4,
      writePhase: "initial-stage-adoption-complete",
    });
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
      graph.authority,
      graph.bundle,
      graph.fence,
      graph.readerLease,
      receipt,
    )).toBe(receipt);
    expect(assertSQLiteCursorPostDdlCatalogFenceIntrinsic(
      graph.authority,
      graph.migration0002Receipt,
      graph.fence,
    )).toBe(graph.fence);
  });

  it("rejects every malformed bundle without consumption and accepts one corrected retry", () => {
    const graph = adoptionGraph(2);
    const other = adoptionGraph(2);
    const [migration, entries, header, sequence] = graph.bundle;
    const malformed: readonly (readonly [string, unknown])[] = [
      ["missing", [migration, entries, header]],
      ["reordered", [migration, header, entries, sequence]],
      ["duplicate", [migration, entries, entries, sequence]],
      ["migration clone", [cloneOpaque(migration), entries, header, sequence]],
      ["entries clone", [migration, cloneOpaque(entries), header, sequence]],
      ["header clone", [migration, entries, cloneOpaque(header), sequence]],
      ["sequence clone", [migration, entries, header, cloneOpaque(sequence)]],
      ["substitution", [other.migration0002Receipt, entries, header, sequence]],
      ["cross graph", [migration, other.entriesReceipt, other.headerReceipt,
        other.sequenceReceipt]],
      ["not an array", Object.freeze({ 0: migration, 1: entries, 2: header, 3: sequence })],
    ];

    for (const [label, candidate] of malformed) {
      expectProviderError(
        () => adoptSQLiteCursorInitialPublicationStageIntrinsic(
          graph.authority,
          candidate as SQLiteCursorInitialPublicationReceiptBundle,
          graph.fence,
          graph.readerLease,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /^SQLite initial publication receipt bundle is invalid$/u,
      );
      expectUnconsumedHealthy(graph);
      expect(label).toBeTruthy();
    }

    const receipt = adopt(graph);
    expect(readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(receipt))
      .toMatchObject({ mintCount: 1, writeKind: "initial-publication-stage-adoption" });
  });

  it("rejects missing, active, cloned, and cross-run reader proofs before consumption", () => {
    const graph = adoptionGraph();
    const other = adoptionGraph();
    const candidates: readonly unknown[] = [
      undefined,
      cloneOpaque(graph.readerLease),
      other.readerLease,
    ];
    for (const candidate of candidates) {
      expectProviderError(
        () => adoptSQLiteCursorInitialPublicationStageIntrinsic(
          graph.authority,
          graph.bundle,
          graph.fence,
          candidate as SQLiteCursorPostDdlPublicationReaderLease,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /SQLite initial publication (?:reader|receipt bundle).*invalid/u,
      );
      expectUnconsumedHealthy(graph);
    }

    const activeGraph = createReaderLeaseTestGraph(1, {
      outerProviderNowMs: SEQUENCE_UPDATED_AT_MS,
    });
    graphs.push(activeGraph);
    const activeLease = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
      activeGraph.authority,
      activeGraph.migration0002Receipt,
      activeGraph.fence,
    );
    expectProviderError(
      () => adoptSQLiteCursorInitialPublicationStageIntrinsic(
        graph.authority,
        graph.bundle,
        graph.fence,
        activeLease,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /SQLite initial publication (?:reader|receipt bundle).*invalid/u,
    );
    expectUnconsumedHealthy(graph);
    expect(adopt(graph)).toBeDefined();
  });

  it("keeps the exact valid bundle retryable after pre-tail cancellation", () => {
    const graph = adoptionGraph();
    const controller = createSQLiteCursorOuterPublicationCancellationControllerIntrinsic();
    controller.cancel();

    expectProviderError(
      () => adoptSQLiteCursorInitialPublicationStageIntrinsic(
        graph.authority,
        graph.bundle,
        graph.fence,
        graph.readerLease,
        controller.signal,
      ),
      "GE_CYCLE_STORE_UNAVAILABLE",
      /^SQLite initial publication stage adoption was cancelled$/u,
    );
    expectUnconsumedHealthy(graph);

    const receipt = adopt(graph);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        initialStageAdoptionReceipt: receipt,
        receiptConsumptionCount: 4,
        tombstoneMintCount: 4,
      });
  });

  it("rejects a wrong post-DDL fence with zero consumption and accepts correction", () => {
    const graph = adoptionGraph();
    const other = adoptionGraph();

    expectProviderError(
      () => adoptSQLiteCursorInitialPublicationStageIntrinsic(
        graph.authority,
        graph.bundle,
        other.fence,
        graph.readerLease,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /^SQLite initial publication stage adoption graph is invalid$/u,
    );
    expectUnconsumedHealthy(graph);
    expect(adopt(graph)).toBeDefined();
  });

  it("makes every consumed initial receipt unusable through assert and read proofs", () => {
    const graph = adoptionGraph();
    adopt(graph);
    const proofs: readonly (readonly [string, () => unknown])[] = [
      ["migration read", () =>
        readSQLiteMigration0002CatalogRebuildReceiptSnapshotIntrinsic(
          graph.migration0002Receipt,
        )],
      ["entries assert", () =>
        assertSQLiteCursorBaselineEntriesPublicationReceiptIntrinsic(
          graph.authority,
          graph.migration0002Receipt,
          graph.fence,
          graph.readerLease,
          graph.entriesReceipt,
        )],
      ["entries read", () =>
        readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(
          graph.entriesReceipt,
        )],
      ["header assert", () =>
        assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
          graph.authority,
          graph.migration0002Receipt,
          graph.fence,
          graph.readerLease,
          graph.entriesReceipt,
          graph.headerReceipt,
        )],
      ["header read", () =>
        readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(graph.headerReceipt)],
      ["sequence assert", () =>
        assertSQLiteCursorOperationSequenceZeroPublicationReceiptIntrinsic(
          graph.authority,
          graph.migration0002Receipt,
          graph.fence,
          graph.readerLease,
          graph.entriesReceipt,
          graph.headerReceipt,
          graph.sequenceReceipt,
        )],
      ["sequence read", () =>
        readSQLiteOperationSequenceZeroPublicationReceiptSnapshotIntrinsic(
          graph.sequenceReceipt,
        )],
    ];
    for (const [label, proof] of proofs) {
      expectProviderError(
        proof,
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /SQLite .* receipt was consumed/u,
      );
      expect(label).toBeTruthy();
    }
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "active",
        receiptConsumptionCount: 4,
        tombstoneMintCount: 4,
        writePhase: "initial-stage-adoption-complete",
      });
  });

  it("rejects cloned and substituted adoption receipts without accepting forgery", () => {
    const graph = adoptionGraph();
    const other = adoptionGraph();
    const substitutedGraph = adoptionGraph();
    const receipt = adopt(graph);
    const otherReceipt = adopt(other);
    const substitutedReceipt = adopt(substitutedGraph);
    const clone = cloneOpaque(receipt);

    expectProviderError(
      () => readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(clone),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /^SQLite initial stage adoption receipt is invalid$/u,
    );
    expectProviderError(
      () => assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
        graph.authority,
        graph.bundle,
        graph.fence,
        graph.readerLease,
        clone,
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite initial stage adoption receipt was substituted$/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    expectProviderError(
      () => assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
        other.authority,
        other.bundle,
        other.fence,
        other.readerLease,
        substitutedReceipt,
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite initial stage adoption receipt was substituted$/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(other.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    expect(readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(
      substitutedReceipt,
    )).toMatchObject({ authority: substitutedGraph.authority });
    expect(otherReceipt).toBeDefined();
  });

  it("poisons replay and never exposes a half-consumed second result", () => {
    const graph = adoptionGraph();
    const receipt = adopt(graph);

    expectProviderError(
      () => adopt(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite initial publication stage adoption was reused$/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        initialStageAdoptionReceipt: receipt,
        initialStageAdoptionReceiptMintCount: 1,
        lifecycle: "poisoned",
        receiptConsumptionCount: 4,
        tombstoneMintCount: 4,
        writePhase: "poisoned",
      });
  });

  it("poisons transaction-epoch drift without consuming any receipt", () => {
    const graph = adoptionGraph();
    graph.connection.execTrusted(
      "CREATE TEMP TABLE hostile_adoption_epoch (value INTEGER NOT NULL)",
      "inspect-schema",
    );

    expectProviderError(
      () => adopt(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite initial publication stage adoption ledger drifted$/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        initialStageAdoptionReceiptMintCount: 0,
        lifecycle: "poisoned",
        receiptConsumptionCount: 0,
        tombstoneMintCount: 0,
        writePhase: "poisoned",
      });
  });

  it("poisons unexplained total_changes and ledger disagreement with zero consumption", () => {
    const graph = adoptionGraph();
    graph.connection.prepare(
      "INSERT INTO main.ge_cycle_used_migration_lock_ids "
        + "(lock_id, lock_epoch, fencing_token, first_used_at_ms) VALUES (?, ?, ?, ?)",
      "inspect-schema",
    ).run("hostile-adoption-ledger", 99, 99, READER_CAPTURED_AT_MS);

    expectProviderError(
      () => adopt(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /^SQLite initial publication stage adoption ledger drifted$/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        initialStageAdoptionReceiptMintCount: 0,
        lifecycle: "poisoned",
        receiptConsumptionCount: 0,
        tombstoneMintCount: 0,
        writePhase: "poisoned",
      });
  });

  it("fails closed after transaction-lineage replacement with zero consumption", () => {
    const graph = adoptionGraph();
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");

    expectProviderError(
      () => adopt(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /SQLite initial publication stage adoption .*lineage.*(?:stale|drifted)/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        initialStageAdoptionReceiptMintCount: 0,
        lifecycle: "poisoned",
        receiptConsumptionCount: 0,
        tombstoneMintCount: 0,
      });
  });

  it("does not execute permanent SQL, transaction control, or cursor rebind", () => {
    const graph = adoptionGraph(3);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const exec = vi.spyOn(graph.connection, "execTrusted");
    const prepare = vi.spyOn(graph.connection, "prepare");

    adopt(graph);

    expect(exec).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toEqual(ownerBefore);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
  });

  it("uses captured Object, WeakMap, Reflect, Number, and Array intrinsics", () => {
    const cases: readonly Readonly<{
      name: string;
      owner: object;
      key: PropertyKey;
    }>[] = [
      { name: "Object.create", owner: Object, key: "create" },
      { name: "Object.freeze", owner: Object, key: "freeze" },
      { name: "Object.getPrototypeOf", owner: Object, key: "getPrototypeOf" },
      { name: "Object.getOwnPropertyDescriptor", owner: Object, key: "getOwnPropertyDescriptor" },
      { name: "Object.isFrozen", owner: Object, key: "isFrozen" },
      { name: "WeakMap.prototype.get", owner: WeakMap.prototype, key: "get" },
      { name: "WeakMap.prototype.set", owner: WeakMap.prototype, key: "set" },
      { name: "WeakMap.prototype.delete", owner: WeakMap.prototype, key: "delete" },
      { name: "Reflect.apply", owner: Reflect, key: "apply" },
      { name: "Reflect.ownKeys", owner: Reflect, key: "ownKeys" },
      { name: "Number.isSafeInteger", owner: Number, key: "isSafeInteger" },
      { name: "Array.isArray", owner: Array, key: "isArray" },
      {
        name: "DatabaseSync.prototype.prepare",
        owner: DatabaseSync.prototype,
        key: "prepare",
      },
      {
        name: "StatementSync.prototype.get",
        owner: StatementSync.prototype,
        key: "get",
      },
    ];
    const failures: Readonly<{
      readonly failure: string;
      readonly invocationStack: string;
      readonly name: string;
    }>[] = [];
    for (const candidate of cases) {
      const graph = adoptionGraph();
      const descriptor = Object.getOwnPropertyDescriptor(
        candidate.owner,
        candidate.key,
      )!;
      let receipt: SQLiteCursorInitialStageAdoptionReceipt | undefined;
      let failure: unknown;
      let hostileInvocationStack: string | undefined;
      try {
        Object.defineProperty(candidate.owner, candidate.key, {
          configurable: true,
          value: (): never => {
            const hostileError = new Error(`hostile ${candidate.name}`);
            hostileInvocationStack ??= hostileError.stack;
            throw hostileError;
          },
        });
        try {
          receipt = adopt(graph);
        } catch (error) {
          failure = error;
        }
      } finally {
        Object.defineProperty(candidate.owner, candidate.key, descriptor);
      }
      if (failure !== undefined || receipt === undefined) {
        failures.push({
          failure: failure instanceof Error ? failure.message : String(failure),
          invocationStack: hostileInvocationStack ?? "not invoked",
          name: candidate.name,
        });
      } else {
        expect(readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(receipt))
          .toMatchObject({ mintCount: 1 });
      }
    }
    expect(failures).toEqual([]);

    const iteratorGraph = adoptionGraph();
    const iteratorReceipt = adopt(iteratorGraph);
    const iteratorDescriptor = Object.getOwnPropertyDescriptor(
      Array.prototype,
      Symbol.iterator,
    )!;
    let assertedReceipt: SQLiteCursorInitialStageAdoptionReceipt | undefined;
    try {
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value: (): never => {
          throw new Error("hostile Array.prototype[Symbol.iterator]");
        },
      });
      assertedReceipt = assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic(
        iteratorGraph.authority,
        iteratorGraph.bundle,
        iteratorGraph.fence,
        iteratorGraph.readerLease,
        iteratorReceipt,
      );
    } finally {
      Object.defineProperty(
        Array.prototype,
        Symbol.iterator,
        iteratorDescriptor,
      );
    }
    expect(assertedReceipt).toBe(iteratorReceipt);
  }, 45_000);

  it("publishes one authentic lower stage tail once and rejects its replay", () => {
    const graph = adoptionGraph();
    const mint = prepareLowerStageAdoption(graph);

    publishSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic(mint.tail);
    expect(assertSQLiteCursorStageOwnershipInitialPublicationAdoptedIntrinsic(
      graph.connection,
      graph.stage,
      graph.preRebindReceipt,
      graph.projectionIdentity,
      graph.transfer,
      graph.authority,
      graph.readerLease,
      mint.retiredB2Fence,
      mint.watermark,
    )).toBe(graph.transfer);
    expectProviderError(
      () => publishSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic(
        mint.tail,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /^SQLite cursor initial publication adoption tail is invalid$/u,
    );
  });

  it("cannot publish or revive a lower stage tail after retirement", () => {
    const graph = adoptionGraph();
    const mint = prepareLowerStageAdoption(graph);

    retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic(
      graph.transfer,
      graph.authority,
    );
    expectProviderError(
      () => publishSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic(
        mint.tail,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /^SQLite cursor initial publication adoption tail is invalid$/u,
    );
  });

  it("cannot publish or revive a lower stage tail after poisoning", () => {
    const graph = adoptionGraph();
    const mint = prepareLowerStageAdoption(graph);

    expectProviderError(
      () => poisonSQLiteCursorStageOwnershipOuterPublicationIntrinsic(
        graph.transfer,
        graph.authority,
        "hostile prepared adoption poison",
      ),
      "GE_CYCLE_STORE_CORRUPTION",
      /^hostile prepared adoption poison$/u,
    );
    expectProviderError(
      () => publishSQLiteCursorStageOwnershipInitialPublicationAdoptionIntrinsic(
        mint.tail,
      ),
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      /^SQLite cursor initial publication adoption tail is invalid$/u,
    );
  });

  it("keeps every adoption capability package-private", () => {
    for (const name of [
      "adoptSQLiteCursorInitialPublicationStageIntrinsic",
      "assertSQLiteCursorInitialStageAdoptionReceiptIntrinsic",
      "readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic",
    ]) {
      expect(name in sqliteRoot).toBe(false);
    }
  });
});
