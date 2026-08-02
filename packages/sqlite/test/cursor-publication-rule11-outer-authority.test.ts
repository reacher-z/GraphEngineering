import { afterEach, describe, expect, it } from "vitest";

import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  adoptSQLiteCursorPostRebindWatermarkIntrinsic,
  assertSQLiteCursorOuterPublicationAuthorityIntrinsic,
  assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic,
  assertSQLiteCursorPublicationRebindPreparedOwnerIdentityIntrinsic,
  assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic,
  assertSQLiteCursorPublicationSessionIntrinsic,
  consumeSQLiteCursorPublicationSessionForRebindIntrinsic,
  createSQLiteCursorPublicationSessionCancellationControllerIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic,
  injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationRebindContextIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic,
  releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic,
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
  readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic,
  type SQLiteCursorInitialPublicationReceiptBundle,
  type SQLiteCursorInitialStageAdoptionReceipt,
  type SQLiteCursorPublicationSession,
} from "../src/cursor-publication-outer-authority.js";
import {
  beginSQLiteConnectionCursorRebindExecutionIntrinsic,
  executeSQLiteConnectionCursorRebindIntrinsic,
} from "../src/sqlite-connection.js";
import {
  READER_CAPTURED_AT_MS,
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const graphs: ReaderLeaseTestGraph[] = [];

interface SessionGraph extends ReaderLeaseTestGraph {
  readonly adoption: SQLiteCursorInitialStageAdoptionReceipt;
  readonly session: SQLiteCursorPublicationSession;
}

function sessionGraph(cursorCount = 0): SessionGraph {
  const graph = createReaderLeaseTestGraph(1, {
    cursorCount,
    outerProviderNowMs: READER_CAPTURED_AT_MS + 1_234,
  });
  graphs.push(graph);
  const reader = mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
  );
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    reader,
  );
  const entries = executeSQLiteCursorBaselineEntriesPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    reader,
  );
  const header = executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    reader,
    entries,
  );
  const sequence = executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    reader,
    entries,
    header,
  );
  const bundle = Object.freeze([
    graph.migration0002Receipt,
    entries,
    header,
    sequence,
  ] as const satisfies SQLiteCursorInitialPublicationReceiptBundle);
  const adoption = adoptSQLiteCursorInitialPublicationStageIntrinsic(
    graph.authority,
    bundle,
    graph.fence,
    reader,
  );
  const prepared = prepareSQLiteCursorPublicationSessionIntrinsic(
    graph.authority,
    adoption,
  );
  const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(prepared);
  const session = publishSQLiteCursorPublicationSessionIntrinsic(prepared, evidence);
  return { ...graph, adoption, session };
}

function consumePreparedSession(graph: SessionGraph) {
  const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
  const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
    graph.session,
    execution,
  );
  const prepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
  const tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);
  return { context, execution, prepared, tombstone };
}

function executePreparedRebind(
  graph: SessionGraph,
  prepared: ReturnType<typeof consumePreparedSession>["prepared"],
  execution: ReturnType<typeof consumePreparedSession>["execution"],
) {
  return executeSQLiteConnectionCursorRebindIntrinsic(graph.connection, execution, {
    targetDescriptorHash: prepared.targetDescriptorHash,
    targetSchemaIdentitySha256: prepared.targetSchemaIdentitySha256,
    sourceDescriptorHash: prepared.sourceDescriptorHash,
    sourceSchemaIdentitySha256: prepared.sourceSchemaIdentitySha256,
  });
}

afterEach(() => {
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite outer-owned cursor rebind transition", () => {
  it("reads optional authentic cancellation without consuming a graph", () => {
    const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    expect(isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(undefined)).toBe(false);
    expect(isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(controller.signal))
      .toBe(false);
    controller.cancel();
    expect(isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(controller.signal))
      .toBe(true);
    expect(() => isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(
      Object.freeze(Object.create(null)),
    )).toThrow(/cancellation signal is invalid/u);
  });

  it("releases exact prepared E on cancellation and permits same-S fresh-P retry", () => {
    const graph = sessionGraph();
    const firstExecution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const firstContext = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      firstExecution,
    );
    const firstPrepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(firstContext);

    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(
      firstContext,
      firstPrepared.preparedOwner,
    );
    expect(readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(firstContext).lifecycle)
      .toBe("released-before-write");
    expect(assertSQLiteCursorPublicationRebindPreparedOwnerIdentityIntrinsic(
      firstPrepared.preparedOwner,
      firstContext,
    )).toBe(firstPrepared.preparedOwner);
    expect(() => assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic(
      firstPrepared.preparedOwner,
      firstContext,
    )).toThrow(/prepared owner is not live/u);
    expect(() => assertSQLiteCursorPublicationRebindPreparedOwnerIdentityIntrinsic(
      new Proxy(firstPrepared.preparedOwner, {}),
      firstContext,
    )).toThrow(/prepared owner is invalid/u);
    expect(assertSQLiteCursorPublicationSessionIntrinsic(graph.session)).toBe(graph.session);
    expect(() => readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(
      Object.freeze(Object.create(null)),
    )).toThrow(/rebind context is invalid/u);
    expect(() => readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(
      new Proxy(firstContext, {}),
    )).toThrow(/rebind context is invalid/u);

    const secondExecution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const secondContext = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      secondExecution,
    );
    const secondPrepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(secondContext);
    expect(secondContext).not.toBe(firstContext);
    expect(secondPrepared.preparedOwner).not.toBe(firstPrepared.preparedOwner);
    expect(() => assertSQLiteCursorPublicationRebindPreparedOwnerIdentityIntrinsic(
      firstPrepared.preparedOwner,
      secondContext,
    )).toThrow(/prepared owner is invalid/u);
    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(
      secondContext,
      secondPrepared.preparedOwner,
    );
  });

  it("rejects cross-graph P/context substitution without poisoning either graph", () => {
    const left = sessionGraph();
    const right = sessionGraph();
    const leftExecution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(left.connection);
    const rightExecution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(right.connection);
    const leftContext = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      left.session,
      leftExecution,
    );
    const rightContext = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      right.session,
      rightExecution,
    );
    const leftPrepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(leftContext);
    const rightPrepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(rightContext);

    expect(() => assertSQLiteCursorPublicationRebindPreparedOwnerIdentityIntrinsic(
      leftPrepared.preparedOwner,
      rightContext,
    )).toThrow(/prepared owner is invalid/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(left.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(right.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-active" });

    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(
      leftContext,
      leftPrepared.preparedOwner,
    );
    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(
      rightContext,
      rightPrepared.preparedOwner,
    );
  });

  it("makes an active same-S double prepare terminal", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    prepareSQLiteCursorPublicationRebindContextIntrinsic(graph.session, execution);

    expect(() => prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    )).toThrow(/rebind context was reused/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it.each([
    "context-primary",
    "context-session",
    "context-prepared-owner",
  ] as const)("rolls back %s registration and leaves S retryable", (stage) => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      stage,
      new Error(`injected ${stage}`),
    );
    expect(() => prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    )).toThrow(`injected ${stage}`);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ publicationRebindContext: undefined, writePhase: "publication-active" });
    expect(assertSQLiteCursorPublicationSessionIntrinsic(graph.session)).toBe(graph.session);

    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    const prepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(
      context,
      prepared.preparedOwner,
    );
  });

  it("rolls back T registration before the consumed flag and permits exact retry", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      "session-tombstone",
      new Error("injected T registration"),
    );
    expect(() => consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context))
      .toThrow("injected T registration");
    expect(readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context).lifecycle)
      .toBe("prepared");
    expect(assertSQLiteCursorPublicationSessionIntrinsic(graph.session)).toBe(graph.session);

    const tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);
    poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
      context,
      tombstone,
      undefined,
      "test cleanup after successful T retry",
    );
  });

  it("removes partial A registration and poisons the consumed graph", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    const prepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    const tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);
    executeSQLiteConnectionCursorRebindIntrinsic(graph.connection, execution, {
      targetDescriptorHash: prepared.targetDescriptorHash,
      targetSchemaIdentitySha256: prepared.targetSchemaIdentitySha256,
      sourceDescriptorHash: prepared.sourceDescriptorHash,
      sourceSchemaIdentitySha256: prepared.sourceSchemaIdentitySha256,
    });
    injectSQLiteCursorPublicationRebindRegistrationFaultForTestIntrinsic(
      "watermark-adoption",
      new Error("injected A registration"),
    );
    expect(() => adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      context,
      tombstone,
      execution,
    )).toThrow("injected A registration");
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        postRebindWatermarkAdoption: undefined,
        writePhase: "poisoned",
      });
    expect(readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context).lifecycle)
      .toBe("poisoned");
  });

  it("makes S consumption terminal and poisons a replay", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);

    expect(() => consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context))
      .toThrow(/publication session consume is terminal/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("rejects clone/proxy T before native execution without consuming valid T", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    const tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);

    expect(() => adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      context,
      Object.freeze(Object.create(null)) as unknown as typeof tombstone,
      execution,
    )).toThrow(/consumed tombstone is invalid/u);
    expect(() => adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      context,
      new Proxy(tombstone, {}),
      execution,
    )).toThrow(/consumed tombstone is invalid/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-session-consumed" });

    poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
      context,
      tombstone,
      undefined,
      "test cleanup after hostile T substitutions",
    );
  });

  it("rejects cross-run T and poisons only the context selected by the call", () => {
    const left = sessionGraph();
    const right = sessionGraph();
    const leftRun = consumePreparedSession(left);
    const rightRun = consumePreparedSession(right);

    expect(() => adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      leftRun.context,
      rightRun.tombstone,
      leftRun.execution,
    )).toThrow(/post-rebind adoption is terminal/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(left.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(right.authority))
      .toMatchObject({ lifecycle: "active", writePhase: "publication-session-consumed" });
    poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
      rightRun.context,
      rightRun.tombstone,
      undefined,
      "cross-run T test cleanup",
    );
  });

  it("rejects clone/proxy/cross-run A presentations without selecting either graph", () => {
    const left = sessionGraph(1);
    const right = sessionGraph(1);
    const leftRun = consumePreparedSession(left);
    const rightRun = consumePreparedSession(right);
    executePreparedRebind(left, leftRun.prepared, leftRun.execution);
    executePreparedRebind(right, rightRun.prepared, rightRun.execution);
    const leftAdoption = adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      leftRun.context,
      leftRun.tombstone,
      leftRun.execution,
    );
    const rightAdoption = adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      rightRun.context,
      rightRun.tombstone,
      rightRun.execution,
    );
    const leftProjection = readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic(
      leftAdoption,
    );

    expect(() => assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(
      Object.freeze({ ...leftProjection }) as unknown as typeof leftAdoption,
    )).toThrow(/watermark adoption is invalid/u);
    expect(() => assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(
      new Proxy(leftAdoption, {}),
    )).toThrow(/watermark adoption is invalid/u);
    expect(() => poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
      leftRun.context,
      leftRun.tombstone,
      rightAdoption,
      "cross-run A must not select left",
    )).toThrow(/poison graph is invalid/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(left.authority).lifecycle)
      .toBe("active");
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(right.authority).lifecycle)
      .toBe("active");
    expect(assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(leftAdoption)).toBe(leftAdoption);
    expect(assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(rightAdoption))
      .toBe(rightAdoption);
  });

  it.each(["target-catalog", "source-target-parameters"] as const)(
    "poisons A preflight on authentic %s drift after E/T selection",
    (drift) => {
      const graph = sessionGraph(1);
      const run = consumePreparedSession(graph);
      if (drift === "source-target-parameters") {
        executeSQLiteConnectionCursorRebindIntrinsic(graph.connection, run.execution, {
          targetDescriptorHash: "f".repeat(64),
          targetSchemaIdentitySha256: run.prepared.targetSchemaIdentitySha256,
          sourceDescriptorHash: run.prepared.sourceDescriptorHash,
          sourceSchemaIdentitySha256: run.prepared.sourceSchemaIdentitySha256,
        });
      } else {
        executePreparedRebind(graph, run.prepared, run.execution);
        graph.connection.prepare(
          "PRAGMA user_version = 31337",
          "inspect-schema",
        ).run();
      }

      expect(() => adoptSQLiteCursorPostRebindWatermarkIntrinsic(
        run.context,
        run.tombstone,
        run.execution,
      )).toThrow();
      expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
        .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    },
  );

  it("poisons a consumed graph when a different E is substituted", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    const tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);

    expect(() => adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      context,
      tombstone,
      Object.freeze(Object.create(null)) as unknown as typeof execution,
    )).toThrow(/post-rebind adoption is terminal/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("poisons adoption when live owner/total-change authority drifts after E", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    const prepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    const tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);
    executeSQLiteConnectionCursorRebindIntrinsic(graph.connection, execution, {
      targetDescriptorHash: prepared.targetDescriptorHash,
      targetSchemaIdentitySha256: prepared.targetSchemaIdentitySha256,
      sourceDescriptorHash: prepared.sourceDescriptorHash,
      sourceSchemaIdentitySha256: prepared.sourceSchemaIdentitySha256,
    });
    graph.connection.prepare(
      "UPDATE main.ge_cycle_migration_lock SET active_owner_id = ? WHERE singleton = 1",
      "inspect-schema",
    ).run("hostile-owner-before-adoption");

    expect(() => adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      context,
      tombstone,
      execution,
    )).toThrow();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("uses the authenticated poison bridge after real post-T connection drift", () => {
    const graph = sessionGraph(1);
    const run = consumePreparedSession(graph);
    graph.connection.execTrusted(
      "CREATE TABLE main.rebind_rule11_audit (tenant_id TEXT NOT NULL)",
      "inspect-schema",
    );
    graph.connection.execTrusted(
      "CREATE TRIGGER main.rebind_rule11_audit_trigger "
        + "AFTER UPDATE ON main.ge_cycle_cursors BEGIN "
        + "INSERT INTO rebind_rule11_audit (tenant_id) VALUES (NEW.tenant_id); END",
      "inspect-schema",
    );

    let primary: unknown;
    try {
      executePreparedRebind(graph, run.prepared, run.execution);
      throw new Error("expected post-T connection drift failure");
    } catch (error) {
      primary = error;
      poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
        run.context,
        run.tombstone,
        undefined,
        "real post-T connection drift failed",
      );
    }
    expect(primary).toMatchObject({ code: "GE_CYCLE_STORE_CORRUPTION" });
    expect((primary as Readonly<{ readonly message: string }>).message)
      .toMatch(/SQLite cursor rebind/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        stageOwnershipPoisonReason: "real post-T connection drift failed",
        writePhase: "poisoned",
      });
    expect(readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(run.context).lifecycle)
      .toBe("poisoned");
    expect(readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic(
      run.tombstone,
    ).lifecycle).toBe("poisoned");
  });

  it.each([0, 1, 3])(
    "consumes exact S only after prepared E for %i cursors, adopts E1/T1 and preserves E0/T0",
    (cursorCount) => {
    const graph = sessionGraph(cursorCount);
    const initial = readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(graph.adoption);
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    const prepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);

    expect(prepared.lifecycle).toBe("prepared");
    expect(assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic(
      prepared.preparedOwner,
      context,
    )).toBe(prepared.preparedOwner);
    expect(() => assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic(
      Object.freeze(Object.create(null)),
      context,
    )).toThrow(/prepared owner is invalid/u);
    expect(prepared.execution).toBe(execution);
    expect(prepared.preparedExecutionSnapshot).toMatchObject({
      cursorLedgerAffectedRowsWatermark: 0,
      cursorLedgerFixedStatementCount: 0,
      cursorLedgerLogicalWriteSequence: 0,
      executeCount: 0,
      lifecycle: "active",
      parameterValues: null,
      releaseCount: 0,
    });
    expect(Object.isFrozen(prepared.preparedExecutionSnapshot)).toBe(true);
    expect(prepared.historicalTransactionEpoch).toBe(initial.adoptedTransactionEpoch);
    expect(prepared.historicalTotalChanges).toBe(initial.adoptedTotalChanges);
    expect(prepared.parameterValues).toEqual([
      prepared.targetDescriptorHash,
      prepared.targetSchemaIdentitySha256,
      prepared.sourceDescriptorHash,
      prepared.sourceSchemaIdentitySha256,
    ]);

    const tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);
    expect(readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic(tombstone))
      .toMatchObject({
        context,
        execution,
        lifecycle: "active",
        session: graph.session,
      });
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority).writePhase)
      .toBe("publication-session-consumed");

    const completed = executeSQLiteConnectionCursorRebindIntrinsic(
      graph.connection,
      execution,
      {
        targetDescriptorHash: prepared.targetDescriptorHash,
        targetSchemaIdentitySha256: prepared.targetSchemaIdentitySha256,
        sourceDescriptorHash: prepared.sourceDescriptorHash,
        sourceSchemaIdentitySha256: prepared.sourceSchemaIdentitySha256,
      },
    );
    const adoption = adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      context,
      tombstone,
      execution,
    );
    expect(assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(adoption)).toBe(adoption);
    expect(assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(adoption)).toBe(adoption);
    expect(assertSQLiteCursorOuterPublicationAuthorityIntrinsic(graph.authority))
      .toBe(graph.authority);
    const adopted = readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic(adoption);

    expect(adopted.execution).toBe(execution);
    expect(adopted.preparedExecutionSnapshot).toBe(prepared.preparedExecutionSnapshot);
    expect(adopted.executionSnapshot.lifecycle).toBe("completed");
    expect(adopted.historicalTransactionEpoch).toBe(initial.adoptedTransactionEpoch);
    expect(adopted.adoptedTransactionEpoch).toBe(initial.adoptedTransactionEpoch + 1n);
    expect(adopted.historicalTotalChanges).toBe(initial.adoptedTotalChanges);
    expect(completed.affectedRows).toBe(cursorCount);
    expect(adopted.adoptedTotalChanges).toBe(initial.adoptedTotalChanges + completed.affectedRows);
    expect(adopted.totalChangesDelta).toBe(completed.affectedRows);
    expect(adopted.historicalOuterLedger).toEqual(adopted.adoptedOuterLedger);
    expect(readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic(graph.adoption))
      .toEqual(initial);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        postRebindWatermarkAdoption: adoption,
        publicationRebindContext: context,
        publicationSessionConsumedTombstone: tombstone,
        writePhase: "cursor-rebind-adopted",
      });

    // A's repeat proof is intentionally retained-data-only. A later generic
    // authority proof will detect this hostile live-lock drift, but A itself
    // performs no SQL and therefore remains repeatable.
    graph.connection.prepare(
      "UPDATE main.ge_cycle_migration_lock SET active_owner_id = ? WHERE singleton = 1",
      "inspect-schema",
    ).run("hostile-owner-after-adoption");
    expect(assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(adoption)).toBe(adoption);

    expect(() => adoptSQLiteCursorPostRebindWatermarkIntrinsic(
      context,
      tombstone,
      execution,
    )).toThrow(/post-rebind adoption is terminal/u);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
    },
  );

  it("makes the ordinary active-session assertion reject after T consumption", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);

    expect(() => assertSQLiteCursorPublicationSessionIntrinsic(graph.session)).toThrow(
      /SQLite publication session is not active/u,
    );
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({ lifecycle: "poisoned", writePhase: "poisoned" });
  });

  it("authenticates downstream poison after consume without replacing thrown undefined", () => {
    const graph = sessionGraph();
    const execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
    const context = prepareSQLiteCursorPublicationRebindContextIntrinsic(
      graph.session,
      execution,
    );
    const tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);

    let caught = false;
    try {
      try {
        throw undefined;
      } catch (error) {
        poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
          context,
          tombstone,
          undefined,
          "injected post-consume execution failure",
        );
        throw error;
      }
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        lifecycle: "poisoned",
        stageOwnershipPoisonReason: "injected post-consume execution failure",
        writePhase: "poisoned",
      });
    expect(readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context).lifecycle)
      .toBe("poisoned");
    expect(readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic(tombstone).lifecycle)
      .toBe("poisoned");
  });
});
