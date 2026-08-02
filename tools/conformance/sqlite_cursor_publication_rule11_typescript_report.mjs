#!/usr/bin/env node

import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  createSQLiteCursorPublicationSessionCancellationControllerIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorOperationSequenceZeroPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic,
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
  readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-outer-authority.js";
import {
  executeSQLiteCursorPublicationRebindRule11Intrinsic,
  executeSQLiteCursorRebindRule11GateIntrinsic,
  injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic,
  readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic,
  readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-rebind.js";
import { readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic } from
  "../../packages/sqlite/dist/sqlite-connection.js";
import {
  createRule11TypescriptGraph,
  disposeRule11TypescriptGraph,
} from "./sqlite_cursor_publication_rule11_typescript_graph.mjs";

const SCHEMA_VERSION = "sqlite-cursor-publication-rule11-parity/v2";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function publicationSession(graph) {
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
  const adoption = adoptSQLiteCursorInitialPublicationStageIntrinsic(
    graph.authority,
    Object.freeze([graph.migration0002Receipt, entries, header, sequence]),
    graph.fence,
    reader,
  );
  const prepared = prepareSQLiteCursorPublicationSessionIntrinsic(graph.authority, adoption);
  const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(prepared);
  return publishSQLiteCursorPublicationSessionIntrinsic(prepared, evidence);
}

function projectSuccess(cursorCount, session, authorityToken, rule11) {
  const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
  const writeReceipt = rule.writeReceipt;
  const write = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(writeReceipt);
  const context = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(rule.context);
  const tombstone = readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic(
    rule.consumedTombstone,
  );
  const adoption = readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic(
    rule.watermarkAdoption,
  );
  invariant(write.counts.b2CursorCount === cursorCount,
    "TypeScript Rule11 parity B2 count drifted");
  const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(authorityToken);
  invariant(
    authority.lifecycle === "active"
      && authority.writePhase === "cursor-rebind-adopted"
      && authority.publicationSession === session
      && authority.publicationRebindContext === rule.context
      && authority.publicationSessionConsumedTombstone === rule.consumedTombstone
      && authority.postRebindWatermarkAdoption === rule.watermarkAdoption
      && context.session === session
      && tombstone.session === session
      && adoption.session === session,
    "TypeScript Rule11 parity retained lifecycle graph drifted",
  );
  return Object.freeze({
    caseId: `success-n${cursorCount}`,
    cursorCount,
    sql: write.sql,
    sqlSha256: write.sqlSha256,
    changesSql: write.changesSql,
    changesSqlSha256: write.changesSqlSha256,
    parameterSha256: write.parameterSha256,
    epochDelta: Number(write.transactionEpochAfter - write.transactionEpochBefore),
    totalDelta: write.totalChangesAfter - write.totalChangesBefore,
    counts: Object.freeze({
      b2CursorCount: write.counts.b2CursorCount,
      nativeAffectedCount: write.counts.nativeAffectedCount,
      changesAffectedCount: write.counts.changesAffectedCount,
      totalChangesDelta: write.counts.totalChangesDelta,
      cursorLedgerAffectedDelta: write.counts.cursorLedgerAffectedDelta,
    }),
    cursorLedgerLogicalWriteDelta: rule.cursorLedgerLogicalWriteDelta,
    cursorLedgerFixedStatementDelta: rule.cursorLedgerFixedStatementDelta,
    outerLedgerUnchanged:
      write.outerLedgerBefore.logicalWriteSequence
        === write.outerLedgerAfter.logicalWriteSequence
      && write.outerLedgerBefore.fixedStatementCount
        === write.outerLedgerAfter.fixedStatementCount
      && write.outerLedgerBefore.affectedRowsWatermark
        === write.outerLedgerAfter.affectedRowsWatermark,
    sameIdentity: Object.freeze({
      session: write.session === rule.session && rule.session === session,
      preparedOwner: write.preparedOwner === rule.preparedOwner
        && context.preparedOwner === rule.preparedOwner,
      context: write.context === rule.context && tombstone.context === rule.context,
      tombstone: write.consumedTombstone === rule.consumedTombstone
        && adoption.tombstone === rule.consumedTombstone,
      adoption: write.watermarkAdoption === rule.watermarkAdoption,
    }),
    lifecycle: Object.freeze({
      session: "consumed-for-rebind",
      context: context.lifecycle,
      tombstone: tombstone.lifecycle,
      adoption: adoption.lifecycle,
      write: write.lifecycle,
      rule11: rule.lifecycle,
    }),
    consumeMint: Object.freeze({
      writePrepareCount: write.prepareCount,
      writeExecuteCount: write.executeCount,
      writeReleaseCount: write.releaseCount,
      changesPrepareCount: write.changesPrepareCount,
      changesFetchCount: write.changesFetchCount,
      changesReleaseCount: write.changesReleaseCount,
      rule11ViolationCount: rule.violationCount,
      diagnosticsTruncated: rule.diagnosticsTruncated,
    }),
  });
}

function successCase(cursorCount) {
  const graph = createRule11TypescriptGraph(cursorCount);
  try {
    const session = publicationSession(graph);
    const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    return projectSuccess(cursorCount, session, graph.authority, rule11);
  } finally {
    disposeRule11TypescriptGraph(graph);
  }
}

function preCancelCase() {
  const graph = createRule11TypescriptGraph(1);
  try {
    const session = publicationSession(graph);
    const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    controller.cancel();
    let rejected = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session, controller.signal);
    } catch (error) {
      rejected = error?.code === "GE_CYCLE_STORE_UNAVAILABLE";
    }
    invariant(rejected, "TypeScript Rule11 pre-cancel did not reject canonically");
    const beforeRetry = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );
    invariant(
      beforeRetry.lifecycle === "active"
        && beforeRetry.writePhase === "publication-active"
        && beforeRetry.publicationSession === session,
      "TypeScript Rule11 pre-cancel mutated or poisoned S",
    );
    const retry = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    const retryProjection = projectSuccess(1, session, graph.authority, retry);
    const sameSessionRetrySucceeded = retryProjection.cursorCount === 1;
    invariant(sameSessionRetrySucceeded,
      "TypeScript Rule11 pre-cancel same-S retry failed");
    return Object.freeze({
      caseId: "pre-cancel",
      outcome: "cancelled-before-prepare",
      selectedGraphPoisoned: beforeRetry.lifecycle === "poisoned",
      sameSessionRetrySucceeded,
    });
  } finally {
    disposeRule11TypescriptGraph(graph);
  }
}

function forgedCancelCase() {
  const controller = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
  controller.cancel();
  let invalidPresentationWon = false;
  try {
    executeSQLiteCursorPublicationRebindRule11Intrinsic(
      Object.freeze(Object.create(null)),
      controller.signal,
    );
  } catch (error) {
    invalidPresentationWon = error?.code === "GE_CYCLE_STORE_INVALID_ARGUMENT";
  }
  invariant(invalidPresentationWon,
    "TypeScript Rule11 forged S was masked by cancellation");
  return Object.freeze({
    caseId: "forged-cancel",
    outcome: "invalid-session-presentation",
    invalidPresentationPrecedesCancellation: true,
    graphSelected: false,
  });
}

function replayPoisonCase() {
  const graph = createRule11TypescriptGraph(3);
  try {
    const session = publicationSession(graph);
    const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
    let replayRejected = false;
    try {
      executeSQLiteCursorRebindRule11GateIntrinsic(rule.writeReceipt);
    } catch (error) {
      replayRejected = error?.code === "GE_CYCLE_STORE_CORRUPTION";
    }
    invariant(replayRejected, "TypeScript Rule11 replay did not reject");
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority);
    let receiptReadableAfterPoison = true;
    try {
      readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
    } catch {
      receiptReadableAfterPoison = false;
    }
    return Object.freeze({
      caseId: "replay-poison",
      outcome: "exact-replay-poisoned",
      selectedGraphPoisoned: authority.lifecycle === "poisoned",
      replayRejected,
      receiptReadableAfterPoison,
    });
  } finally {
    disposeRule11TypescriptGraph(graph);
  }
}

function preconsumeReleaseCase() {
  const graph = createRule11TypescriptGraph(1);
  try {
    const session = publicationSession(graph);
    const primary = new Error("Rule11 parity exact preconsume release primary");
    injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(session, primary);
    let caught;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch (error) {
      caught = error;
    }
    invariant(caught === primary,
      "TypeScript Rule11 preconsume release replaced the exact primary");
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );
    invariant(authority.publicationRebindContext !== undefined,
      "TypeScript Rule11 preconsume release omitted the selected context");
    const context = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(
      authority.publicationRebindContext,
    );
    const execution = readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      context.execution,
    );
    let replayRejected = false;
    try {
      executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    } catch (error) {
      replayRejected = error?.code === "GE_CYCLE_STORE_CORRUPTION";
    }
    invariant(replayRejected,
      "TypeScript Rule11 poisoned preconsume release graph accepted replay");
    return Object.freeze({
      caseId: "preconsume-release",
      outcome: "exact-release-primary",
      primaryIdentityPreserved: caught === primary,
      selectedGraphPoisoned:
        authority.lifecycle === "poisoned" && authority.writePhase === "poisoned",
      sessionConsumed: authority.publicationSessionConsumedTombstone !== undefined,
      contextLifecycle: context.lifecycle,
      executionLifecycle: execution.lifecycle,
      executeCount: execution.executeCount,
      releaseCount: execution.releaseCount,
      replayRejected,
    });
  } finally {
    disposeRule11TypescriptGraph(graph);
  }
}

const report = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  runtime: "typescript",
  successes: Object.freeze([0, 1, 3].map(successCase)),
  failures: Object.freeze([
    preCancelCase(),
    forgedCancelCase(),
    replayPoisonCase(),
    preconsumeReleaseCase(),
  ]),
});

process.stdout.write(`${JSON.stringify(report)}\n`);
