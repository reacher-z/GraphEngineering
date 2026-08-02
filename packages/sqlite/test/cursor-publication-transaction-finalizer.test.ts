import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  type SQLiteCursorInitialPublicationReceiptBundle,
  type SQLiteCursorPublicationSession,
} from "../src/cursor-publication-outer-authority.js";
import {
  executeSQLiteCursorPublicationRebindRule11Intrinsic,
} from "../src/cursor-publication-rebind.js";
import {
  captureSQLiteCursorPostConsumeTransactionFailureIntrinsic,
  finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic,
  injectSQLiteCursorPostConsumeCloseAfterNativeReturnAmbiguousFaultForTestIntrinsic,
  injectSQLiteCursorPostConsumeFinalizerRegistrationFaultForTestIntrinsic,
  injectSQLiteCursorPostConsumeRollbackAfterNativeReturnAmbiguousFaultForTestIntrinsic,
  readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic,
  type SQLiteCursorPostConsumeFinalizerDiagnostic,
  type SQLiteCursorPostConsumeTransactionFailureCapture,
  type SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
} from "../src/cursor-publication-transaction-finalizer.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

interface FixtureCase {
  readonly caseId: string;
  readonly input: Readonly<{
    primary: "GE_SQLITE_POST_T_TERMINAL_PRIMARY";
    rollbackAfterNativeReturnFault: boolean;
    closeAfterNativeReturnFault: boolean;
  }>;
  readonly expected: Readonly<{
    stateTrace: readonly ["prepared", "finalizing", "finalized"];
    ownerConsumeCount: 1;
    terminalizeCount: 1;
    rollbackAttemptCount: 1;
    rollbackNativeReturnCount: 1;
    closeAttemptCount: 1;
    closeNativeReturnCount: 1;
    selectedThrow: "GE_SQLITE_POST_T_TERMINAL_PRIMARY";
    diagnosticCodes: readonly SQLiteCursorPostConsumeFinalizerDiagnostic["code"][];
  }>;
}

interface Fixture {
  readonly diagnosticContract: Readonly<{
    primary: SQLiteCursorPostConsumeFinalizerDiagnostic;
    rollback: SQLiteCursorPostConsumeFinalizerDiagnostic;
    close: SQLiteCursorPostConsumeFinalizerDiagnostic;
  }>;
  readonly cases: readonly FixtureCase[];
}

interface CapturedNativeGraph {
  readonly graph: ReaderLeaseTestGraph;
  readonly session: SQLiteCursorPublicationSession;
  readonly capture: SQLiteCursorPostConsumeTransactionFailureCapture;
}

const fixture = JSON.parse(readFileSync(new URL(
  "../../../spec/conformance/sqlite-post-consume-transaction-failure-finalizer-v1.case.json",
  import.meta.url,
), "utf8")) as Fixture;
const graphs: ReaderLeaseTestGraph[] = [];

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

function installNativeRebindAbortTrigger(connection: SQLiteConnection): void {
  connection.execTrusted(
    "CREATE TEMP TRIGGER ge_transaction_finalizer_native_abort "
      + "BEFORE UPDATE ON main.ge_cycle_cursors BEGIN "
      + "SELECT RAISE(ABORT, 'transaction finalizer native abort'); END",
    "inspect-schema",
  );
}

function activeNativeGraph(): Readonly<{
  graph: ReaderLeaseTestGraph;
  session: SQLiteCursorPublicationSession;
}> {
  const graph = createReaderLeaseTestGraph(1, {
    beforeBaselineStageCreation: installNativeRebindAbortTrigger,
    cursorCount: 1,
  });
  graphs.push(graph);
  return { graph, session: publicationSession(graph) };
}

function capturedNativeGraph(): CapturedNativeGraph {
  const selected = activeNativeGraph();
  const capture = captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(selected.session);
  return { ...selected, capture };
}

function finalizeAndCatch(capture: SQLiteCursorPostConsumeTransactionFailureCapture): object {
  let caught = false;
  let primary: unknown;
  try {
    finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(capture.owner);
  } catch (error) {
    caught = true;
    primary = error;
  }
  expect(caught).toBe(true);
  expect(primary).toBe(capture.leafPrimary);
  return primary as object;
}

function expectedDiagnostics(entry: FixtureCase): readonly SQLiteCursorPostConsumeFinalizerDiagnostic[] {
  const byCode = new Map([
    [fixture.diagnosticContract.primary.code, fixture.diagnosticContract.primary],
    [fixture.diagnosticContract.rollback.code, fixture.diagnosticContract.rollback],
    [fixture.diagnosticContract.close.code, fixture.diagnosticContract.close],
  ] as const);
  return entry.expected.diagnosticCodes.map((code) => byCode.get(code)!);
}

afterEach(() => {
  for (const value of graphs.splice(0)) disposeReaderLeaseTestGraph(value);
});

describe.sequential("SQLite post-consume transaction failure finalizer", () => {
  it.each(fixture.cases)(
    "matches the frozen projection for $caseId",
    (entry) => {
      const value = capturedNativeGraph();
      expect(value.capture.leafPrimary).toBeInstanceOf(CycleStoreProviderError);
      expect(value.capture.leafPrimary).toMatchObject({
        code: "GE_CYCLE_STORE_CORRUPTION",
        details: { sqliteClass: 19 },
      });
      if (entry.input.rollbackAfterNativeReturnFault) {
        injectSQLiteCursorPostConsumeRollbackAfterNativeReturnAmbiguousFaultForTestIntrinsic(
          value.capture.owner,
        );
      }
      if (entry.input.closeAfterNativeReturnFault) {
        injectSQLiteCursorPostConsumeCloseAfterNativeReturnAmbiguousFaultForTestIntrinsic(
          value.capture.owner,
        );
      }
      expect(readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
        value.capture.owner,
      )).toMatchObject({
        lifecycle: "prepared",
        stateTrace: ["prepared"],
        ownerConsumeCount: 0,
        terminalizeCount: 0,
        rollbackAttemptCount: 0,
        closeAttemptCount: 0,
        diagnosticCodes: ["GE_SQLITE_POST_T_TERMINAL_PRIMARY"],
        diagnostics: [fixture.diagnosticContract.primary],
      });

      const originalClose = Object.getOwnPropertyDescriptor(SQLiteConnection.prototype, "close")!;
      let hostileCloseCalls = 0;
      Object.defineProperty(SQLiteConnection.prototype, "close", {
        configurable: true,
        value(): never {
          hostileCloseCalls += 1;
          throw new Error("replaceable public close reached");
        },
        writable: true,
      });
      try {
        finalizeAndCatch(value.capture);
      } finally {
        Object.defineProperty(SQLiteConnection.prototype, "close", originalClose);
      }

      expect(hostileCloseCalls).toBe(0);
      expect(value.graph.connection.isOpen).toBe(false);
      const snapshot = readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
        value.capture.owner,
      );
      expect({
        stateTrace: snapshot.stateTrace,
        ownerConsumeCount: snapshot.ownerConsumeCount,
        terminalizeCount: snapshot.terminalizeCount,
        rollbackAttemptCount: snapshot.rollbackAttemptCount,
        rollbackNativeReturnCount: snapshot.rollbackNativeReturnCount,
        closeAttemptCount: snapshot.closeAttemptCount,
        closeNativeReturnCount: snapshot.closeNativeReturnCount,
        selectedThrow: snapshot.selectedThrow,
        diagnosticCodes: snapshot.diagnosticCodes,
      }).toEqual(entry.expected);
      expect(snapshot.lifecycle).toBe("finalized");
      expect(snapshot.diagnostics).toEqual(expectedDiagnostics(entry));
      expect(snapshot.claims).toEqual({
        cleanupNeverReplacesPrimary: true,
        driverNativeRollbackThrow: false,
        driverNativeCloseThrow: false,
        ownsBegin: false,
        ownsCommit: false,
        ownsRule12: false,
        ownsSuccessPath: false,
      });
      expect(snapshot.rollbackAfterNativeReturnAmbiguousFaultCount)
        .toBe(entry.input.rollbackAfterNativeReturnFault ? 1 : 0);
      expect(snapshot.closeAfterNativeReturnAmbiguousFaultCount)
        .toBe(entry.input.closeAfterNativeReturnFault ? 1 : 0);

      const reopened = new SQLiteConnection(`${value.graph.root}/cycle-store.db`);
      try {
        expect(reopened.prepare("PRAGMA user_version", "inspect-schema").get()).toEqual([1n]);
        expect(reopened.prepare(
          "SELECT count(*) FROM main.ge_cycle_cursors",
          "inspect-schema",
        ).get()).toEqual([0n]);
        expect(reopened.prepare(
          "SELECT count(*) FROM main.sqlite_schema "
            + "WHERE name = 'ge_cycle_operation_baselines'",
          "inspect-schema",
        ).get()).toEqual([0n]);
      } finally {
        reopened.close();
      }
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(value.graph.authority))
        .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
      expect(() => finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(
        value.capture.owner,
      )).toThrow(/replay is invalid/u);
    },
  );

  it("makes caller-selected primary substitution impossible at capture and finalize", () => {
    const selected = activeNativeGraph();
    const substitute = new Error("caller-selected substitute");
    const runtimeCapture = captureSQLiteCursorPostConsumeTransactionFailureIntrinsic as
      unknown as (session: SQLiteCursorPublicationSession,
        ignoredCallerThunk: () => never) => SQLiteCursorPostConsumeTransactionFailureCapture;
    const capture = runtimeCapture(selected.session, () => { throw substitute; });
    expect(capture.leafPrimary).not.toBe(substitute);
    const runtimeFinalize = finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic as
      unknown as (owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
        ignoredSubstitute: object) => never;
    let caught: unknown;
    try {
      runtimeFinalize(capture.owner, substitute);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(capture.leafPrimary);
    expect(captureSQLiteCursorPostConsumeTransactionFailureIntrinsic.length).toBe(1);
    expect(finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic.length).toBe(1);
  });

  it("rejects forged/proxy S, clone/proxy owner, replay and a fixed-leaf no-primary path", () => {
    const selected = activeNativeGraph();
    const forgedSession = Object.freeze(Object.create(null)) as SQLiteCursorPublicationSession;
    expect(() => captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(
      forgedSession,
    )).toThrow(/publication session/u);
    expect(() => captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(
      new Proxy(selected.session as object, {}) as SQLiteCursorPublicationSession,
    )).toThrow(/publication session/u);

    const success = createReaderLeaseTestGraph(1, { cursorCount: 1 });
    graphs.push(success);
    const successSession = publicationSession(success);
    expect(() => captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(successSession))
      .toThrow(/forbids a no-primary branch/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(success.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "cursor-rebind-adopted" });

    const capture = captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(selected.session);
    expect(() => readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
      Object.freeze(Object.create(null)) as SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
    )).toThrow(/owner is invalid/u);
    expect(() => readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
      new Proxy(capture.owner as object, {}) as
        SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
    )).toThrow(/owner is invalid/u);
    finalizeAndCatch(capture);
    expect(() => finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(capture.owner))
      .toThrow(/replay is invalid/u);
  });

  it.each(["after-owner", "after-authority"] as const)(
    "rolls back %s registration before invoking the leaf and permits exact retry",
    (stage) => {
      const selected = activeNativeGraph();
      injectSQLiteCursorPostConsumeFinalizerRegistrationFaultForTestIntrinsic(stage);
      expect(() => captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(
        selected.session,
      )).toThrow(/registration fault/u);
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(selected.graph.authority))
        .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
      const capture = captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(
        selected.session,
      );
      finalizeAndCatch(capture);
    },
  );

  it("keeps a fresh graph healthy after a captured failed graph is finalized", () => {
    const failed = capturedNativeGraph();
    finalizeAndCatch(failed.capture);
    const fresh = createReaderLeaseTestGraph(1, { cursorCount: 1 });
    graphs.push(fresh);
    const session = publicationSession(fresh);
    expect(() => executeSQLiteCursorPublicationRebindRule11Intrinsic(session)).not.toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(fresh.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "cursor-rebind-adopted" });
  });

  it("stays package-private and has no arbitrary-primary prepare or unrelated ownership", () => {
    for (const name of [
      "SQLiteCursorPostConsumeTransactionFailureFinalizerOwner",
      "SQLiteCursorPostConsumeTransactionFailureCapture",
      "captureSQLiteCursorPostConsumeTransactionFailureIntrinsic",
      "finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic",
      "readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic",
    ]) {
      expect(name in sqliteRoot).toBe(false);
    }
    const source = readFileSync(
      new URL("../src/cursor-publication-transaction-finalizer.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain(
      "prepareSQLiteCursorPostConsumeTransactionFailureFinalizerIntrinsic",
    );
    expect(source).not.toMatch(/\bBEGIN\b/u);
    expect(source).not.toMatch(/\bCOMMIT\b/u);
    expect(source).not.toContain("cursor-publication-rule12-read");
    expect(source.match(/executeSQLiteCursorPublicationRebindRule11Intrinsic/gu)).toHaveLength(2);
    expect(source).toContain(
      "executePublicationRebindRule11LeafIntrinsic =\n  "
        + "executeSQLiteCursorPublicationRebindRule11Intrinsic",
    );
    const captureSource = source.slice(
      source.indexOf("export function captureSQLiteCursorPostConsumeTransactionFailureIntrinsic"),
      source.indexOf(
        "export function injectSQLiteCursorPostConsumeRollbackAfterNativeReturn",
      ),
    );
    expect(captureSource).toContain("session: SQLiteCursorPublicationSession");
    expect(captureSource).not.toContain("leaf:");
    expect(captureSource).not.toContain("callback");
    expect(captureSource).toContain(
      "reflectApplyIntrinsic(executePublicationRebindRule11LeafIntrinsic, undefined, [session])",
    );
    const finalizer = source.slice(source.indexOf(
      "export function finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic",
    ));
    const orderedBoundaries = [
      "if (leafPrimary === undefined)",
      "state.ownerConsumeCount = 1",
      'state.lifecycle = "finalizing"',
      "state.terminalizeCount = 1",
      "execSQLiteConnectionTrustedVerifierIntrinsic(connection, \"ROLLBACK\"",
      "reflectApplyIntrinsic(sqliteConnectionCloseIntrinsic, connection, [])",
      'state.lifecycle = "finalized"',
      "throw leafPrimary",
    ].map((needle) => finalizer.indexOf(needle));
    expect(orderedBoundaries.every((index) => index >= 0)).toBe(true);
    expect(orderedBoundaries).toEqual([...orderedBoundaries].sort((left, right) => left - right));
  });

  if (process.env.GRAPH_ENGINEERING_RUN_TRANSACTION_FINALIZER_GC_PROBE !== "1") {
    it("passes isolated abandoned-owner and dead-primary GC", () => {
      const packageRoot = fileURLToPath(new URL("..", import.meta.url));
      const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
      const result = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          vitest,
          "run",
          "test/cursor-publication-transaction-finalizer.test.ts",
          "--pool=threads",
          "--maxWorkers=1",
          "--fileParallelism=false",
          "--reporter=dot",
        ],
        {
          cwd: packageRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GRAPH_ENGINEERING_RUN_TRANSACTION_FINALIZER_GC_PROBE: "1",
          },
          timeout: 180_000,
        },
      );
      expect(result.error, `GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
      expect(result.signal, `GC probe was terminated: ${result.stderr}`).toBeNull();
      expect(result.status, [
        "isolated transaction finalizer GC probe failed",
        `stdout=${result.stdout}`,
        `stderr=${result.stderr}`,
      ].join("\n")).toBe(0);
    }, 190_000);
  } else {
    it("does not root an abandoned graph through a retained owner", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const tracked = trackAbandonedOwner();
      const live = await forceBoundedCollection(tracked.references);
      expect(live).toEqual([]);
      expect(readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
        tracked.owner,
      )).toMatchObject({
        graphIdentitiesAlive: false,
        leafPrimaryAlive: false,
        lifecycle: "prepared",
      });
    }, 120_000);

    it("blocks every cleanup operation when the directly caught primary expires", async () => {
      expect(typeof globalThis.gc).toBe("function");
      const tracked = captureAndDropPrimary();
      expect(await forceBoundedCollection([tracked.primaryReference])).toEqual([]);
      const before = readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
        tracked.owner,
      );
      expect(before).toMatchObject({
        leafPrimaryAlive: false,
        lifecycle: "prepared",
        ownerConsumeCount: 0,
        terminalizeCount: 0,
        rollbackAttemptCount: 0,
        closeAttemptCount: 0,
      });
      expect(() => finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(tracked.owner))
        .toThrow(/primary expired before finalizing/u);
      expect(readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
        tracked.owner,
      )).toEqual(before);
      expect(tracked.graph.connection.isOpen).toBe(true);
      expect(tracked.graph.connection.isTransaction).toBe(true);
    }, 120_000);
  }
});

function captureAndDropPrimary(): Readonly<{
  graph: ReaderLeaseTestGraph;
  owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner;
  primaryReference: WeakRef<object>;
}> {
  const value = capturedNativeGraph();
  return {
    graph: value.graph,
    owner: value.capture.owner,
    primaryReference: new WeakRef(value.capture.leafPrimary),
  };
}

function trackAbandonedOwner(): Readonly<{
  owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner;
  references: readonly WeakRef<object>[];
}> {
  const value = capturedNativeGraph();
  const primary = value.capture.leafPrimary as object & { graph?: object; authority?: object };
  primary.graph = value.graph;
  primary.authority = value.graph.authority;
  const references = [
    value.graph,
    value.graph.connection,
    value.graph.authority,
    value.capture.leafPrimary,
  ].map((identity) => new WeakRef(identity));
  const owner = value.capture.owner;
  disposeReaderLeaseTestGraph(value.graph);
  graphs.splice(graphs.indexOf(value.graph), 1);
  return { owner, references };
}

async function forceBoundedCollection(
  references: readonly WeakRef<object>[],
): Promise<readonly object[]> {
  for (let round = 0; round < 80; round += 1) {
    globalThis.gc!();
    const pressure = Array.from({ length: 8 }, () => new Uint8Array(2 * 1024 * 1024));
    pressure[round % pressure.length]![0] = round;
    await new Promise<void>((resolve) => setImmediate(resolve));
    globalThis.gc!();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const live = references.flatMap((reference) => {
      const value = reference.deref();
      return value === undefined ? [] : [value];
    });
    if (live.length === 0) return [];
  }
  return references.flatMap((reference) => {
    const value = reference.deref();
    return value === undefined ? [] : [value];
  });
}
