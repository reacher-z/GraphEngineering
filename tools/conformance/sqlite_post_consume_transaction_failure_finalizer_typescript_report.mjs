#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { canonicalSerialize } from "../../packages/core/dist/index.js";
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
} from "../../packages/sqlite/dist/cursor-publication-outer-authority.js";
import {
  executeSQLiteCursorPublicationRebindRule11Intrinsic,
  readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-rebind.js";
import {
  captureSQLiteCursorPostConsumeTransactionFailureIntrinsic,
  finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic,
  injectSQLiteCursorPostConsumeCloseAfterNativeReturnAmbiguousFaultForTestIntrinsic,
  injectSQLiteCursorPostConsumeRollbackAfterNativeReturnAmbiguousFaultForTestIntrinsic,
  readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-transaction-finalizer.js";
import { SQLiteConnection } from "../../packages/sqlite/dist/sqlite-connection.js";
import {
  createRule11TypescriptGraph,
  disposeRule11TypescriptGraph,
} from "./sqlite_cursor_publication_rule11_typescript_graph.mjs";

const SCHEMA_VERSION = "sqlite-post-consume-transaction-failure-finalizer-parity/v1";
const BASELINE_DATA_DOMAIN =
  "graph-engineering/sqlite-post-consume-transaction-failure-finalizer-baseline-data/v1\0";
const V1_CATALOG_SHA256 =
  "8fab5049e2c9de5d114abc0c682934f1bc6fb5abd2e4c2e3ae55ef329c3e7264";
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
const CURSOR_COLUMNS = Object.freeze([
  "tenant_id", "token_hash", "kind", "principal_hash", "authorization_hash",
  "stream_id", "checkpoint_scope", "request_scope_blob", "page_size",
  "next_position", "snapshot_tail_sequence", "snapshot_tail_record_hash",
  "descriptor_hash", "schema_identity_sha256", "snapshot_blob", "created_at_ms",
  "expires_at_ms", "consumed_at_ms",
]);
const OPERATION_COLUMNS = Object.freeze([
  "tenant_id", "operation_id", "operation_name", "request_hash", "result_blob",
  "result_hash", "committed_at_ms",
]);
const CASES = Object.freeze([
  Object.freeze({ caseId: "both", rollbackFault: true, closeFault: true }),
  Object.freeze({ caseId: "rollback-only", rollbackFault: true, closeFault: false }),
  Object.freeze({ caseId: "close-only", rollbackFault: false, closeFault: true }),
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

function createFailureGraph() {
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
          "CREATE TEMP TRIGGER ge_finalizer_parity_abort "
            + "BEFORE UPDATE ON main.ge_cycle_cursors BEGIN "
            + "SELECT RAISE(ABORT, 'finalizer parity abort'); END",
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

function diagnosticProjection(diagnostic) {
  return Object.freeze({
    code: diagnostic.code,
    operation: diagnostic.operation,
    rank: diagnostic.rank,
    origin: diagnostic.origin,
  });
}

function exactRow(value, length, label) {
  invariant(Array.isArray(value) && value.length === length,
    `TypeScript ${label} row shape drifted`);
  return value;
}

function exactInteger(value, minimum, maximum, label) {
  invariant(typeof value === "bigint"
    && value >= BigInt(minimum) && value <= BigInt(maximum),
  `TypeScript ${label} is not an exact portable integer`);
  return Number(value);
}

function portableCell(value, label) {
  if (value === null) return Object.freeze({ type: "null" });
  if (typeof value === "bigint") {
    return Object.freeze({
      type: "integer",
      value: exactInteger(value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, label),
    });
  }
  if (typeof value === "string") return Object.freeze({ type: "text", value });
  invariant(value instanceof Uint8Array, `TypeScript ${label} has a non-portable SQLite type`);
  return Object.freeze({ type: "blob", lowerHex: Buffer.from(value).toString("hex") });
}

function tableProjection(connection, tableName, columns, orderBy) {
  const rows = connection.prepare(
    `SELECT ${columns.join(", ")} FROM main.${tableName} ORDER BY ${orderBy}`,
    "inspect-schema",
  ).all();
  return Object.freeze({
    columns,
    name: tableName,
    rows: Object.freeze(rows.map((row, rowIndex) => Object.freeze(
      exactRow(row, columns.length, `${tableName}[${rowIndex}]`).map(
        (value, columnIndex) => portableCell(
          value,
          `${tableName}[${rowIndex}].${columns[columnIndex]}`,
        ),
      ),
    ))),
  });
}

function baselineDataSha256(connection) {
  const projection = Object.freeze({
    formatVersion: 1,
    tables: Object.freeze([
      tableProjection(connection, "ge_cycle_cursors", CURSOR_COLUMNS,
        "tenant_id COLLATE BINARY, token_hash COLLATE BINARY"),
      tableProjection(connection, "ge_cycle_operations", OPERATION_COLUMNS,
        "tenant_id COLLATE BINARY, operation_id COLLATE BINARY"),
    ]),
  });
  return createHash("sha256")
    .update(BASELINE_DATA_DOMAIN, "utf8")
    .update(canonicalSerialize(projection), "utf8")
    .digest("hex");
}

function catalogSha256(connection) {
  const rows = connection.prepare(
    "SELECT type, name, tbl_name, sql FROM main.sqlite_schema "
      + "WHERE name GLOB 'ge_cycle_*' AND type IN ('table', 'index') "
      + "AND sql IS NOT NULL ORDER BY type, name",
    "inspect-schema",
  ).all();
  const catalog = rows.map((value, index) => {
    const row = exactRow(value, 4, `catalog[${index}]`);
    invariant(row.every((item) => typeof item === "string"),
      `TypeScript catalog[${index}] contains a non-text value`);
    return Object.freeze({
      type: row[0],
      name: row[1],
      tableName: row[2],
      sql: row[3].replace(/\s+/gu, " ").trim(),
    });
  });
  return createHash("sha256")
    .update(canonicalSerialize(catalog), "utf8")
    .digest("hex");
}

function reopenRecovery(graph) {
  const reopened = new SQLiteConnection(`${graph.root}/cycle-store.db`);
  try {
    const applicationId = exactRow(
      reopened.prepare("PRAGMA application_id", "inspect-schema").get(), 1,
      "application id",
    );
    const userVersion = exactRow(
      reopened.prepare("PRAGMA user_version", "inspect-schema").get(), 1,
      "user version",
    );
    const schema = exactRow(reopened.prepare(
      "SELECT current_version, schema_identity_sha256 "
        + "FROM main.ge_cycle_schema WHERE singleton = 1",
      "inspect-schema",
    ).get(), 2, "schema singleton");
    const cursorCount = exactRow(reopened.prepare(
      "SELECT count(*) FROM main.ge_cycle_cursors",
      "inspect-schema",
    ).get(), 1, "cursor count");
    const operationCount = exactRow(reopened.prepare(
      "SELECT count(*) FROM main.ge_cycle_operations",
      "inspect-schema",
    ).get(), 1, "operation count");
    const v2ArtifactCount = exactRow(reopened.prepare(
      `SELECT count(*) FROM main.sqlite_schema WHERE name IN (${V2_ARTIFACTS.map(() => "?").join(",")})`,
      "inspect-schema",
    ).get(...V2_ARTIFACTS), 1, "v2 artifact count");
    const foreignKeyRows = reopened.prepare(
      "PRAGMA foreign_key_check", "inspect-schema",
    ).all();
    const integrity = exactRow(
      reopened.prepare("PRAGMA integrity_check", "inspect-schema").get(), 1,
      "integrity check",
    );
    const catalog = catalogSha256(reopened);
    const evidence = Object.freeze({
      applicationId: exactInteger(applicationId[0], 0, 2_147_483_647, "application id"),
      userVersion: exactInteger(userVersion[0], 0, 2_147_483_647, "user version"),
      currentVersion: exactInteger(schema[0], 0, Number.MAX_SAFE_INTEGER, "current version"),
      schemaIdentitySha256: schema[1],
      catalogSha256: catalog,
      cursorCount: exactInteger(cursorCount[0], 0, Number.MAX_SAFE_INTEGER, "cursor count"),
      operationCount: exactInteger(
        operationCount[0], 0, Number.MAX_SAFE_INTEGER, "operation count",
      ),
      v2ArtifactCount: exactInteger(
        v2ArtifactCount[0], 0, Number.MAX_SAFE_INTEGER, "v2 artifact count",
      ),
      foreignKeyViolationCount: foreignKeyRows.length,
      integrityCheck: integrity[0],
      baselineDataDomain: BASELINE_DATA_DOMAIN,
      baselineDataSha256: baselineDataSha256(reopened),
    });
    invariant(evidence.applicationId === 1_195_724_359,
      "TypeScript reopen application id drifted");
    invariant(evidence.userVersion === 1 && evidence.currentVersion === 1,
      "TypeScript reopen did not return to v1");
    invariant(evidence.schemaIdentitySha256
      === "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
    "TypeScript reopen schema identity drifted");
    invariant(evidence.catalogSha256 === V1_CATALOG_SHA256,
      "TypeScript reopen catalog does not match the trusted v1 digest");
    invariant(evidence.cursorCount === 1 && evidence.operationCount === 1,
      "TypeScript reopen baseline row counts drifted");
    invariant(evidence.v2ArtifactCount === 0,
      "TypeScript reopen retained a v2 catalog artifact");
    invariant(evidence.foreignKeyViolationCount === 0,
      "TypeScript reopen retained a foreign-key violation");
    invariant(evidence.integrityCheck === "ok", "TypeScript reopen integrity check failed");
    return evidence;
  } finally {
    reopened.close();
  }
}

function failureCase(entry) {
  const graph = createFailureGraph();
  try {
    const session = publicationSession(graph);
    const capture = captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(session);
    if (entry.rollbackFault) {
      injectSQLiteCursorPostConsumeRollbackAfterNativeReturnAmbiguousFaultForTestIntrinsic(
        capture.owner,
      );
    }
    if (entry.closeFault) {
      injectSQLiteCursorPostConsumeCloseAfterNativeReturnAmbiguousFaultForTestIntrinsic(
        capture.owner,
      );
    }
    let caught;
    try {
      finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(capture.owner);
    } catch (error) {
      caught = error;
    }
    invariant(caught === capture.leafPrimary,
      `TypeScript ${entry.caseId} cleanup replaced the exact leaf primary`);
    const snapshot = readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
      capture.owner,
    );
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority);
    return Object.freeze({
      caseId: entry.caseId,
      stateTrace: snapshot.stateTrace,
      counts: Object.freeze({
        ownerConsumeCount: snapshot.ownerConsumeCount,
        terminalizeCount: snapshot.terminalizeCount,
        rollbackAttemptCount: snapshot.rollbackAttemptCount,
        rollbackNativeReturnCount: snapshot.rollbackNativeReturnCount,
        rollbackAfterNativeReturnFaultCount:
          snapshot.rollbackAfterNativeReturnAmbiguousFaultCount,
        rollbackSecondaryFailureCount: snapshot.rollbackSecondaryFailureCount,
        closeAttemptCount: snapshot.closeAttemptCount,
        closeNativeReturnCount: snapshot.closeNativeReturnCount,
        closeAfterNativeReturnFaultCount:
          snapshot.closeAfterNativeReturnAmbiguousFaultCount,
        closeTertiaryFailureCount: snapshot.closeTertiaryFailureCount,
      }),
      selectedThrow: snapshot.selectedThrow,
      diagnosticCodes: snapshot.diagnosticCodes,
      diagnostics: Object.freeze(snapshot.diagnostics.map(diagnosticProjection)),
      claims: snapshot.claims,
      reopenRecovery: reopenRecovery(graph),
      oldGraphPoisoned:
        authority.lifecycle === "poisoned" && authority.writePhase === "poisoned",
      freshGraphSuccess: true,
    });
  } finally {
    disposeRule11TypescriptGraph(graph);
  }
}

function proveFreshGraphSuccess() {
  const graph = createRule11TypescriptGraph(1);
  try {
    const session = publicationSession(graph);
    const receipt = executeSQLiteCursorPublicationRebindRule11Intrinsic(session);
    const snapshot = readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(receipt);
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority);
    invariant(snapshot.violationCount === 0,
      "TypeScript fresh graph Rule 11 reported a violation");
    invariant(authority.lifecycle === "active"
      && authority.writePhase === "cursor-rebind-adopted",
    "TypeScript fresh graph did not reach cursor-rebind-adopted");
    return true;
  } finally {
    disposeRule11TypescriptGraph(graph);
  }
}

function buildReport() {
  const cases = CASES.map(failureCase);
  invariant(proveFreshGraphSuccess(), "TypeScript fresh graph proof failed");
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    runtime: "typescript",
    cases,
  });
}

process.stdout.write(`${JSON.stringify(buildReport())}\n`);
