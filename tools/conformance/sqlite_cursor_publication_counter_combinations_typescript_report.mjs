#!/usr/bin/env node

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
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-outer-authority.js";
import {
  evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic,
  executeSQLiteCursorPublicationRebindRule11Intrinsic,
  readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic,
  readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-rebind.js";
import {
  captureSQLiteCursorPostConsumeTransactionFailureIntrinsic,
  finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic,
  readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-transaction-finalizer.js";
import {
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic,
  SQLiteConnection,
} from "../../packages/sqlite/dist/sqlite-connection.js";
import {
  createRule11TypescriptGraph,
  disposeRule11TypescriptGraph,
} from "./sqlite_cursor_publication_rule11_typescript_graph.mjs";

const SCHEMA_VERSION = "sqlite-cursor-publication-counter-combinations-parity/v1";
const V2_ARTIFACTS = Object.freeze([
  "ge_cycle_operation_baseline_entries",
  "ge_cycle_operation_baseline_entries_hash_uq",
  "ge_cycle_operation_baseline_entries_key_uq",
  "ge_cycle_operation_baselines",
  "ge_cycle_operation_sequence",
  "ge_cycle_operations_replay_idx",
  "ge_cycle_operations_sequence_uq",
  "ge_cycle_operations_v1",
  "ge_cycle_schema_v1",
]);
const COUNT_FIELDS = Object.freeze([
  "nativeAffectedCount",
  "changesAffectedCount",
  "totalChangesDelta",
  "cursorLedgerAffectedDelta",
]);
const FIELD_SLUGS = Object.freeze({
  nativeAffectedCount: "native",
  changesAffectedCount: "changes",
  totalChangesDelta: "total",
  cursorLedgerAffectedDelta: "cursor-ledger",
});
const NONCLAIMS = Object.freeze([
  Object.freeze({
    caseFamily: "outer-ledger-pair-and-multi-corruption",
    reason: "outer-ledger-is-private-authority-state-without-a-common-post-t-native-seam",
  }),
  Object.freeze({
    caseFamily: "independent-native-changes-observation-corruption",
    reason: "runtime-local-native-result-or-changes-proof-injection-is-required",
  }),
  Object.freeze({
    caseFamily: "independent-native-cursor-ledger-corruption",
    reason: "cursor-ledger-affected-is-captured-from-the-same-native-result",
  }),
  Object.freeze({
    caseFamily: "independent-changes-cursor-ledger-corruption",
    reason: "runtime-local-state-or-driver-injection-is-required",
  }),
  Object.freeze({
    caseFamily: "driver-native-result-shape-and-throw-combinations",
    reason: "no-common-driver-native-fault-adapter-is-available",
  }),
]);

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
  return publishSQLiteCursorPublicationSessionIntrinsic(
    prepared,
    observeSQLiteCursorPublicationSessionClockIntrinsic(prepared),
  );
}

function safeInteger(value, label) {
  invariant(Number.isSafeInteger(value) && value >= 0,
    `TypeScript ${label} is not a non-negative safe integer`);
  return value;
}

function ledger(value, label) {
  return Object.freeze({
    logicalWriteSequence: safeInteger(value.logicalWriteSequence,
      `${label}.logicalWriteSequence`),
    fixedStatementCount: safeInteger(value.fixedStatementCount,
      `${label}.fixedStatementCount`),
    affectedRowsWatermark: safeInteger(value.affectedRowsWatermark,
      `${label}.affectedRowsWatermark`),
  });
}

function ledgerDelta(before, after) {
  return Object.freeze({
    logicalWriteSequence: after.logicalWriteSequence - before.logicalWriteSequence,
    fixedStatementCount: after.fixedStatementCount - before.fixedStatementCount,
    affectedRowsWatermark: after.affectedRowsWatermark - before.affectedRowsWatermark,
  });
}

function countProjection(b2, native, changes, total, cursorLedger) {
  return Object.freeze({
    b2CursorCount: safeInteger(b2, "counts.b2CursorCount"),
    nativeAffectedCount: safeInteger(native, "counts.nativeAffectedCount"),
    changesAffectedCount: safeInteger(changes, "counts.changesAffectedCount"),
    totalChangesDelta: safeInteger(total, "counts.totalChangesDelta"),
    cursorLedgerAffectedDelta: safeInteger(
      cursorLedger,
      "counts.cursorLedgerAffectedDelta",
    ),
  });
}

function exactRow(value, length, label) {
  invariant(Array.isArray(value) && value.length === length,
    `TypeScript ${label} row shape drifted`);
  return value;
}

function exactSQLiteInteger(value, label) {
  invariant(typeof value === "bigint" && value >= 0n
    && value <= BigInt(Number.MAX_SAFE_INTEGER),
  `TypeScript ${label} is not an exact SQLite safe integer`);
  return Number(value);
}

function reopenRecovery(location) {
  const reopened = new SQLiteConnection(location);
  try {
    const cursorCount = exactRow(reopened.prepare(
      "SELECT count(*) FROM main.ge_cycle_cursors",
      "inspect-schema",
    ).get(), 1, "reopen cursor count");
    const operationCount = exactRow(reopened.prepare(
      "SELECT count(*) FROM main.ge_cycle_operations",
      "inspect-schema",
    ).get(), 1, "reopen operation count");
    const v2ArtifactCount = exactRow(reopened.prepare(
      `SELECT count(*) FROM main.sqlite_schema WHERE name IN (${V2_ARTIFACTS.map(() => "?").join(",")})`,
      "inspect-schema",
    ).get(...V2_ARTIFACTS), 1, "reopen v2 artifact count");
    const foreignKeyViolationCount = reopened.prepare(
      "PRAGMA foreign_key_check",
      "inspect-schema",
    ).all().length;
    const integrity = exactRow(reopened.prepare(
      "PRAGMA integrity_check",
      "inspect-schema",
    ).get(), 1, "reopen integrity check");
    const projection = Object.freeze({
      cursorCount: exactSQLiteInteger(cursorCount[0], "reopen.cursorCount"),
      operationCount: exactSQLiteInteger(operationCount[0], "reopen.operationCount"),
      v2ArtifactCount: exactSQLiteInteger(v2ArtifactCount[0], "reopen.v2ArtifactCount"),
      foreignKeyViolationCount: safeInteger(
        foreignKeyViolationCount,
        "reopen.foreignKeyViolationCount",
      ),
      integrityCheck: integrity[0],
    });
    invariant(projection.cursorCount === 1 && projection.operationCount === 1,
      "TypeScript reopen baseline row counts drifted");
    invariant(projection.v2ArtifactCount === 0,
      "TypeScript reopen retained a v2-only artifact");
    invariant(projection.foreignKeyViolationCount === 0,
      "TypeScript reopen retained a foreign-key violation");
    invariant(projection.integrityCheck === "ok",
      "TypeScript reopen integrity check failed");
    return projection;
  } finally {
    reopened.close();
  }
}

function checkerResult(result) {
  return Object.freeze({
    accepted: result.accepted,
    violationCount: result.violationCount,
    diagnosticsTruncated: result.diagnosticsTruncated,
  });
}

function authenticBaseline() {
  const graph = createRule11TypescriptGraph(1);
  try {
    const session = publicationSession(graph);
    const rule11 = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    const rule = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(rule11);
    const write = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(rule.writeReceipt);
    const execution = readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      write.execution,
    );
    const counts = countProjection(
      write.counts.b2CursorCount,
      write.counts.nativeAffectedCount,
      write.counts.changesAffectedCount,
      write.counts.totalChangesDelta,
      write.counts.cursorLedgerAffectedDelta,
    );
    const outerBefore = ledger(write.outerLedgerBefore, "baseline.outerLedger.before");
    const outerAfter = ledger(write.outerLedgerAfter, "baseline.outerLedger.after");
    const cursorBefore = ledger(write.cursorLedgerBefore, "baseline.cursorLedger.before");
    const cursorAfter = ledger(write.cursorLedgerAfter, "baseline.cursorLedger.after");
    invariant(execution.lifecycle === "completed",
      "TypeScript authentic execution lifecycle drifted");
    return Object.freeze({
      caseId: "authentic-success-n1",
      population: 1,
      counts,
      outerLedger: Object.freeze({
        before: outerBefore,
        after: outerAfter,
        delta: ledgerDelta(outerBefore, outerAfter),
      }),
      cursorLedger: Object.freeze({
        before: cursorBefore,
        after: cursorAfter,
        delta: ledgerDelta(cursorBefore, cursorAfter),
      }),
      checker: checkerResult(evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(counts)),
      lifecycle: Object.freeze({
        execution: execution.lifecycle,
        write: write.lifecycle,
        rule11: rule.lifecycle,
      }),
    });
  } finally {
    disposeRule11TypescriptGraph(graph);
  }
}

function createTriggerGraph() {
  const descriptor = Object.getOwnPropertyDescriptor(SQLiteConnection.prototype, "execTrusted");
  invariant(descriptor !== undefined && typeof descriptor.value === "function",
    "TypeScript execTrusted descriptor is unavailable");
  const exactExecTrusted = descriptor.value;
  let exclusiveBeginCount = 0;
  Object.defineProperty(SQLiteConnection.prototype, "execTrusted", {
    ...descriptor,
    value(sql, operation) {
      const result = Reflect.apply(exactExecTrusted, this, [sql, operation]);
      if (sql === "BEGIN EXCLUSIVE" && (exclusiveBeginCount += 1) === 2) {
        Reflect.apply(exactExecTrusted, this, [
          "CREATE TEMP TABLE ge_counter_combination_audit (tenant_id TEXT NOT NULL)",
          "inspect-schema",
        ]);
        Reflect.apply(exactExecTrusted, this, [
          "CREATE TEMP TRIGGER ge_counter_combination_amplify "
            + "AFTER UPDATE ON main.ge_cycle_cursors BEGIN "
            + "INSERT INTO ge_counter_combination_audit (tenant_id) "
            + "VALUES (NEW.tenant_id); END",
          "inspect-schema",
        ]);
      }
      return result;
    },
  });
  try {
    return createRule11TypescriptGraph(1);
  } finally {
    Object.defineProperty(SQLiteConnection.prototype, "execTrusted", descriptor);
  }
}

function realTriggerAmplification() {
  const graph = createTriggerGraph();
  try {
    const capture = captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(
      publicationSession(graph),
    );
    const prepared = readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
      capture.owner,
    );
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority);
    invariant(authority.publicationRebindContext !== undefined,
      "TypeScript trigger graph omitted its context");
    const context = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(
      authority.publicationRebindContext,
    );
    const execution = readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(
      graph.connection,
      context.execution,
    );
    const counts = countProjection(
      context.b2CursorCount,
      execution.affectedRows,
      execution.changesAffectedRows,
      execution.totalChangesDelta,
      execution.cursorLedgerAffectedRowsWatermark,
    );
    const outerBefore = ledger(context.historicalOuterLedger, "trigger.outerLedger.before");
    const outerAfter = ledger(authority.outerLedger, "trigger.outerLedger.after");
    const cursorBefore = ledger(
      {
        logicalWriteSequence: context.preparedExecutionSnapshot
          .cursorLedgerLogicalWriteSequence,
        fixedStatementCount: context.preparedExecutionSnapshot.cursorLedgerFixedStatementCount,
        affectedRowsWatermark: context.preparedExecutionSnapshot
          .cursorLedgerAffectedRowsWatermark,
      },
      "trigger.cursorLedger.before",
    );
    const cursorAfter = ledger(
      {
        logicalWriteSequence: execution.cursorLedgerLogicalWriteSequence,
        fixedStatementCount: execution.cursorLedgerFixedStatementCount,
        affectedRowsWatermark: execution.cursorLedgerAffectedRowsWatermark,
      },
      "trigger.cursorLedger.after",
    );
    let caught;
    try {
      finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(capture.owner);
    } catch (error) {
      caught = error;
    }
    invariant(caught === capture.leafPrimary,
      "TypeScript trigger finalizer replaced the exact primary");
    const finalized = readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
      capture.owner,
    );
    return Object.freeze({
      caseId: "real-trigger-amplification-n1-k1",
      population: 1,
      counts,
      outerLedger: Object.freeze({
        before: outerBefore,
        after: outerAfter,
        delta: ledgerDelta(outerBefore, outerAfter),
      }),
      cursorLedger: Object.freeze({
        before: cursorBefore,
        after: cursorAfter,
        delta: ledgerDelta(cursorBefore, cursorAfter),
      }),
      disagreementEdges: Object.freeze([
        "nativeAffectedCount!=totalChangesDelta",
        "changesAffectedCount!=totalChangesDelta",
        "totalChangesDelta!=cursorLedgerAffectedDelta",
      ]),
      primaryBoundary: prepared.primaryBoundary,
      lifecycle: Object.freeze({
        authority: authority.lifecycle,
        context: context.lifecycle,
        execution: execution.lifecycle,
        adoptionMinted: authority.postRebindWatermarkAdoption !== undefined,
      }),
      finalizer: Object.freeze({
        primaryPreserved: caught === capture.leafPrimary,
        stateTrace: finalized.stateTrace,
        selectedThrow: finalized.selectedThrow,
        diagnosticCodes: finalized.diagnosticCodes,
        rollbackAttemptCount: finalized.rollbackAttemptCount,
        closeAttemptCount: finalized.closeAttemptCount,
      }),
      reopenRecovery: reopenRecovery(`${graph.root}/cycle-store.db`),
    });
  } finally {
    disposeRule11TypescriptGraph(graph);
  }
}

function combinations(values, size, start = 0, prefix = []) {
  const result = [];
  if (prefix.length === size) return [prefix];
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    result.push(...combinations(values, size, index + 1, [...prefix, values[index]]));
  }
  return result;
}

function checkerCombinationCases(authentic) {
  const subsets = [2, 3, 4].flatMap((size) => combinations(COUNT_FIELDS, size));
  return Object.freeze(subsets.map((subset) => {
    const input = { ...authentic };
    for (const field of subset) input[field] += 1;
    const evaluation = evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(input);
    invariant(evaluation.accepted === false && evaluation.violationCount === 1,
      `TypeScript checker accepted ${subset.join("+")}`);
    return Object.freeze({
      caseId: `checker-${subset.length}-way-${subset.map((field) => FIELD_SLUGS[field]).join("+")}`,
      corruptedDimensions: Object.freeze([...subset]),
      input: countProjection(
        evaluation.counts.b2CursorCount,
        evaluation.counts.nativeAffectedCount,
        evaluation.counts.changesAffectedCount,
        evaluation.counts.totalChangesDelta,
        evaluation.counts.cursorLedgerAffectedDelta,
      ),
      result: checkerResult(evaluation),
      seam: "post-real-sqlite-rule11-pure-checker",
    });
  }));
}

function buildReport() {
  const baseline = authenticBaseline();
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    runtime: "typescript",
    authenticBaseline: baseline,
    realTriggerAmplification: realTriggerAmplification(),
    checkerCombinationCases: checkerCombinationCases(baseline.counts),
    nonclaims: NONCLAIMS,
    claims: Object.freeze({
      realTriggerAmplificationIsNativeObservation: true,
      checkerInputsDerivedFromAuthenticRealSQLiteEvidence: true,
      checkerCombinationCasesAreNativeObservations: false,
      outerLedgerCombinationCoverage: false,
      runtimeLocalObservationSeamsCovered: false,
    }),
  });
}

process.stdout.write(`${JSON.stringify(buildReport())}\n`);
