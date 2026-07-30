import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { DatabaseSync, StatementSync } from "node:sqlite";

import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as sqliteRoot from "../src/index.js";
import {
  SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC,
  SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC,
  assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic,
  executeSQLiteCursorBaselineEntriesPublicationIntrinsic,
  executeSQLiteCursorBaselineHeaderPublicationIntrinsic,
  executeSQLiteCursorPostDdlPublicationReaderIntrinsic,
  mintSQLiteCursorPostDdlPublicationReaderLeaseIntrinsic,
  readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic,
  readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  type SQLiteBaselineEntriesPublicationReceipt,
  type SQLiteBaselineHeaderPublicationReceipt,
  type SQLiteCursorPostDdlPublicationReaderLease,
} from "../src/cursor-publication-outer-authority.js";
import * as initialWriteDigestModule from
  "../src/cursor-publication-initial-write-digest.js";
import {
  digestSQLiteInitialWriteParametersIntrinsic,
  digestSQLiteInitialWriteResultIntrinsic,
  type SQLiteInitialWriteParameterExecutions,
  type SQLiteInitialWriteTaggedScalar,
} from "../src/cursor-publication-initial-write-digest.js";
import { encodeOperationBaselinePolicy } from "../src/operation-baseline.js";
import * as cursorOwnershipModule from
  "../src/operation-baseline-cursor-ownership.js";
import * as sqliteConnectionModule from "../src/sqlite-connection.js";
import {
  SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC,
  SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

interface HeaderGraph extends ReaderLeaseTestGraph {
  readonly readerLease: SQLiteCursorPostDdlPublicationReaderLease;
  readonly entriesReceipt: SQLiteBaselineEntriesPublicationReceipt;
}

const graphs: HeaderGraph[] = [];

function headerGraph(legacyOperationCount = 1): HeaderGraph {
  const graph = createReaderLeaseTestGraph(legacyOperationCount);
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
  const complete = { ...graph, entriesReceipt, readerLease };
  graphs.push(complete);
  return complete;
}

function publishHeader(graph: HeaderGraph): SQLiteBaselineHeaderPublicationReceipt {
  return executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    graph.readerLease,
    graph.entriesReceipt,
  );
}

function assertHeader(
  graph: HeaderGraph,
  receipt: SQLiteBaselineHeaderPublicationReceipt,
): SQLiteBaselineHeaderPublicationReceipt {
  return assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic(
    graph.authority,
    graph.migration0002Receipt,
    graph.fence,
    graph.readerLease,
    graph.entriesReceipt,
    receipt,
  );
}

function expectProviderError(
  callback: () => unknown,
  code: string | undefined,
  message: RegExp,
): CycleStoreProviderError {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(CycleStoreProviderError);
    if (code !== undefined) expect((error as CycleStoreProviderError).code).toBe(code);
    expect((error as Error).message).toMatch(message);
    return error as CycleStoreProviderError;
  }
  throw new Error(`expected structured provider error${code === undefined ? "" : ` ${code}`}`);
}

const text = (value: string): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "text",
  value,
});
const integer = (value: number): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "integer",
  value: `${value}`,
});
const blob = (value: Uint8Array): SQLiteInitialWriteTaggedScalar => Object.freeze({
  type: "blob",
  value: Buffer.from(value).toString("base64url"),
});

function readHeaderRows(graph: HeaderGraph): readonly (readonly unknown[])[] {
  return graph.connection.prepare(
    "SELECT baseline_id, baseline_format_version, source_application_id, "
      + "source_user_version, source_schema_identity_sha256, "
      + "source_migration_lineage_id, source_migration_lineage_sha256, "
      + "source_descriptor_hash, captured_at_ms, legacy_operation_count, "
      + "entry_count, first_entry_hash, final_entry_hash, "
      + "canonical_projection_sha256, creation_runtime, creation_runtime_version, "
      + "policy_blob FROM main.ge_cycle_operation_baselines ORDER BY baseline_id ASC",
    "inspect-schema",
  ).all() as readonly (readonly unknown[])[];
}

function headerParameterFrame(graph: HeaderGraph): SQLiteInitialWriteParameterExecutions {
  const source = graph.sourceSummary.sourceEnvelope;
  return Object.freeze([Object.freeze([
    text(graph.projectionIdentity.baselineId),
    text(source.sourceSchemaIdentitySha256),
    text(source.sourceMigrationLineageId),
    text(source.sourceMigrationLineageSha256),
    text(source.sourceDescriptorHash),
    integer(source.capturedAtMs),
    integer(graph.projectionIdentity.legacyOperationCount),
    integer(graph.projectionIdentity.entryCount),
    text(graph.projectionIdentity.firstEntryHash),
    text(graph.projectionIdentity.finalEntryHash),
    text(graph.projectionIdentity.projectionSha256),
    text(SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC),
    text(SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC),
    blob(encodeOperationBaselinePolicy()),
  ])]);
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite baseline-header publication receipt", () => {
  it("freezes the exact SQL, SHA-256, and fourteen-parameter order", () => {
    expect(SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC).toBe(
      "INSERT INTO main.ge_cycle_operation_baselines (baseline_id, "
        + "baseline_format_version, source_application_id, source_user_version, "
        + "source_schema_identity_sha256, source_migration_lineage_id, "
        + "source_migration_lineage_sha256, source_descriptor_hash, captured_at_ms, "
        + "legacy_operation_count, entry_count, first_entry_hash, final_entry_hash, "
        + "canonical_projection_sha256, creation_runtime, creation_runtime_version, "
        + "policy_blob) VALUES (?, 1, 1195724359, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    expect(SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC)
      .toBe("b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a");
    expect(createHash("sha256")
      .update(SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC, "utf8")
      .digest("hex"))
      .toBe(SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC);
    expect(SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC).toEqual([
      "baselineId",
      "sourceSchemaIdentitySha256",
      "sourceMigrationLineageId",
      "sourceMigrationLineageSha256",
      "sourceDescriptorHash",
      "capturedAtMs",
      "legacyOperationCount",
      "entryCount",
      "firstEntryHash",
      "finalEntryHash",
      "canonicalProjectionSha256",
      "creationRuntime",
      "creationRuntimeVersion",
      "policyBlob",
    ]);
  });

  it("publishes one exact committed header and advances every real ledger by one", () => {
    const graph = headerGraph(8);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const authorityBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      graph.authority,
    );
    expect(authorityBefore.outerLedger).toEqual({
      affectedRowsWatermark: 21,
      fixedStatementCount: 32,
      logicalWriteSequence: 2,
    });

    const receipt = publishHeader(graph);
    const snapshot = readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(receipt);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.getPrototypeOf(receipt)).toBeNull();
    expect(snapshot).toMatchObject({
      affectedRows: 1,
      authority: graph.authority,
      baselineEntriesPublicationReceipt: graph.entriesReceipt,
      baselineId: graph.projectionIdentity.baselineId,
      canonicalProjectionSha256: graph.projectionIdentity.projectionSha256,
      capturedAtMs: graph.sourceSummary.sourceEnvelope.capturedAtMs,
      connection: graph.connection,
      creationRuntime: SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC,
      creationRuntimeVersion:
        SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC,
      entryCount: graph.projectionIdentity.entryCount,
      executeCount: 1,
      finalEntryHash: graph.projectionIdentity.finalEntryHash,
      firstEntryHash: graph.projectionIdentity.firstEntryHash,
      fixedInsertSql: SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC,
      fixedInsertSqlSha256:
        SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
      legacyOperationCount: graph.projectionIdentity.legacyOperationCount,
      mintCount: 1,
      outerLedgerBefore: authorityBefore.outerLedger,
      outerLedgerAfter: {
        affectedRowsWatermark: 22,
        fixedStatementCount: 33,
        logicalWriteSequence: 3,
      },
      outerLedgerDelta: {
        affectedRowsWatermark: 1,
        fixedStatementCount: 1,
        logicalWriteSequence: 1,
      },
      parameterOrder: SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC,
      postDdlCatalogFence: graph.fence,
      prepareCount: 1,
      projectionIdentity: graph.projectionIdentity,
      projectionReference: graph.projectionReference,
      readerLease: graph.readerLease,
      sourceDescriptorHash: graph.sourceSummary.sourceEnvelope.sourceDescriptorHash,
      sourceMigrationLineageId:
        graph.sourceSummary.sourceEnvelope.sourceMigrationLineageId,
      sourceMigrationLineageSha256:
        graph.sourceSummary.sourceEnvelope.sourceMigrationLineageSha256,
      sourceSchemaIdentitySha256:
        graph.sourceSummary.sourceEnvelope.sourceSchemaIdentitySha256,
      totalChangesBefore: totalBefore.totalChanges,
      totalChangesAfter: totalBefore.totalChanges + 1,
      totalChangesDelta: 1,
      transactionEpochBefore: ownerBefore.transactionEpoch,
      transactionEpochAfter: ownerBefore.transactionEpoch + 1n,
      transactionLineage: ownerBefore.transactionLineage,
      writeKind: "baseline-header-publication",
    });
    expect(assertHeader(graph, receipt)).toBe(receipt);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore.totalChanges + 1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderAffectedRows: 1,
        baselineHeaderExecuteCount: 1,
        baselineHeaderLogicalExecutionCount: 1,
        baselineHeaderPrepareCount: 1,
        baselineHeaderPublicationReceipt: receipt,
        baselineHeaderPublicationReceiptMintCount: 1,
        lifecycle: "active",
        outerLedger: snapshot.outerLedgerAfter,
        writePhase: "baseline-header-complete",
      });
  });

  it("writes exact projection, source, stable runtime, and canonical policy commitments", () => {
    const graph = headerGraph(8);
    const originalRuntime = process.env.GRAPH_ENGINEERING_CREATION_RUNTIME;
    const originalVersion = process.env.GRAPH_ENGINEERING_CREATION_RUNTIME_VERSION;
    process.env.GRAPH_ENGINEERING_CREATION_RUNTIME = "hostile-ambient-runtime";
    process.env.GRAPH_ENGINEERING_CREATION_RUNTIME_VERSION = "999.0.0-hostile";
    let receipt: SQLiteBaselineHeaderPublicationReceipt;
    try {
      receipt = publishHeader(graph);
    } finally {
      if (originalRuntime === undefined) delete process.env.GRAPH_ENGINEERING_CREATION_RUNTIME;
      else process.env.GRAPH_ENGINEERING_CREATION_RUNTIME = originalRuntime;
      if (originalVersion === undefined) {
        delete process.env.GRAPH_ENGINEERING_CREATION_RUNTIME_VERSION;
      } else {
        process.env.GRAPH_ENGINEERING_CREATION_RUNTIME_VERSION = originalVersion;
      }
    }

    const rows = readHeaderRows(graph);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    const source = graph.sourceSummary.sourceEnvelope;
    expect(row).toHaveLength(17);
    expect(row.slice(0, 16)).toEqual([
      graph.projectionIdentity.baselineId,
      1n,
      1195724359n,
      1n,
      source.sourceSchemaIdentitySha256,
      source.sourceMigrationLineageId,
      source.sourceMigrationLineageSha256,
      source.sourceDescriptorHash,
      BigInt(source.capturedAtMs),
      BigInt(graph.projectionIdentity.legacyOperationCount),
      BigInt(graph.projectionIdentity.entryCount),
      graph.projectionIdentity.firstEntryHash,
      graph.projectionIdentity.finalEntryHash,
      graph.projectionIdentity.projectionSha256,
      "graph-engineering-typescript",
      "0.1.0-alpha.1",
    ]);
    const policy = encodeOperationBaselinePolicy();
    expect(Buffer.compare(row[16] as Buffer, policy)).toBe(0);
    expect(policy.toString("utf8")).toBe(
      "{\"baselineFormatVersion\":1,\"canonicalEncoding\":\"graph-engineering/canonical-json/v1\","
        + "\"cursorReplay\":\"independent-semantic-audit\","
        + "\"emptyRoot\":\"66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a\","
        + "\"entryHashDomain\":\"graph-engineering/sqlite-operation-baseline-entry/v1\\u0000\","
        + "\"entryKinds\":[\"schema-envelope\",\"migration-lineage\",\"stream-head\","
        + "\"record-identity\",\"checkpoint-current\",\"checkpoint-revision\","
        + "\"lease-current\",\"used-lease-identity\",\"legal-hold\","
        + "\"migration-lock-current\",\"used-migration-lock-identity\","
        + "\"legacy-operation\"],"
        + "\"genesisHash\":\"5311dba7ae8b844fc3efccd55dd90c3f78e02a7f7e222d7a0a513fd1aff9ec96\","
        + "\"legacyRequestRecovery\":false,\"maxEntryKeyBytes\":4096,"
        + "\"maxEntryStateBytes\":2097152,"
        + "\"payloadOmissions\":[\"checkpoint-value\",\"record-blob\",\"record-value\"],"
        + "\"projectionHashDomain\":\"graph-engineering/sqlite-operation-baseline-projection/v1\\u0000\","
        + "\"replayStartsAtCommitSequence\":1,"
        + "\"sort\":[\"entry-kind-rank\",\"entry-key-utf8-bytes\"]}",
    );
    expect(policy).toHaveLength(946);
    expect(createHash("sha256").update(policy).digest("hex"))
      .toBe("67cbe0ac8bf04f28061d50f8b7089312cc1e1f9a9520ede95deec0d1f4ec5eb0");
    expect(readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(receipt!))
      .toMatchObject({
        policyBlobBase64url: policy.toString("base64url"),
        policyBlobSha256:
          "67cbe0ac8bf04f28061d50f8b7089312cc1e1f9a9520ede95deec0d1f4ec5eb0",
        policyBlobUtf8Bytes: 946,
      });
  });

  it("passes one strict typed 1-by-14 execution frame and exact aggregate result", () => {
    const graph = headerGraph(8);
    const originalParameters =
      initialWriteDigestModule.digestSQLiteInitialWriteParametersIntrinsic;
    let captured: unknown;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteParametersIntrinsic",
    ).mockImplementation((parameters) => {
      captured = parameters;
      return originalParameters(parameters);
    });

    const receipt = publishHeader(graph);
    const snapshot = readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(receipt);
    const expected = headerParameterFrame(graph);
    expect(captured).toEqual(expected);
    expect(Object.isFrozen(captured)).toBe(true);
    const executions = captured as readonly (readonly Record<string, unknown>[])[];
    expect(executions).toHaveLength(1);
    expect(executions[0]).toHaveLength(14);
    expect(executions[0]!.map((scalar) => scalar.type)).toEqual([
      "text", "text", "text", "text", "text", "integer", "integer", "integer",
      "text", "text", "text", "text", "text", "blob",
    ]);
    expect(executions[0]!.every((scalar) => Object.isFrozen(scalar))).toBe(true);
    expect(Object.isFrozen(executions[0])).toBe(true);
    expect(snapshot.parameterSha256).toBe(
      digestSQLiteInitialWriteParametersIntrinsic(expected),
    );
    expect(snapshot.resultSha256).toBe(
      digestSQLiteInitialWriteResultIntrinsic({ affectedRows: "1" }),
    );
  });

  it("rejects wrong, cloned, proxied, revoked, and cross-run entries receipts before SQL", () => {
    const graph = headerGraph(1);
    const other = headerGraph(1);
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic",
    );
    const clone = Object.freeze({
      ...readSQLiteBaselineEntriesPublicationReceiptSnapshotIntrinsic(graph.entriesReceipt),
    });
    const revoked = Proxy.revocable(graph.entriesReceipt, {});
    const candidates = [
      Object.freeze(Object.create(null)),
      clone,
      new Proxy(graph.entriesReceipt, {}),
      revoked.proxy,
      other.entriesReceipt,
    ] as readonly unknown[];
    revoked.revoke();

    for (const candidate of candidates) {
      expectProviderError(
        () => executeSQLiteCursorBaselineHeaderPublicationIntrinsic(
          graph.authority,
          graph.migration0002Receipt,
          graph.fence,
          graph.readerLease,
          candidate as SQLiteBaselineEntriesPublicationReceipt,
        ),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /baseline|entries|header|receipt|graph|invalid/u,
      );
    }
    expect(begin).not.toHaveBeenCalled();
    expect(readHeaderRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderPublicationReceipt: undefined,
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "active",
        writePhase: "baseline-entries-complete",
      });
    expect(publishHeader(graph)).toBeDefined();
  });

  it("rejects forged header receipts without disturbing the authentic graph", () => {
    const graph = headerGraph(1);
    const other = headerGraph(1);
    const receipt = publishHeader(graph);
    const otherReceipt = publishHeader(other);
    const clone = Object.freeze({
      ...readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic(receipt),
    });
    const revoked = Proxy.revocable(receipt, {});
    const candidates = [
      Object.freeze(Object.create(null)),
      clone,
      new Proxy(receipt, {}),
      revoked.proxy,
      otherReceipt,
    ] as readonly unknown[];
    revoked.revoke();

    for (const candidate of candidates) {
      expectProviderError(
        () => assertHeader(graph, candidate as SQLiteBaselineHeaderPublicationReceipt),
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        /baseline|header|receipt|graph|invalid/u,
      );
    }
    expect(assertHeader(graph, receipt)).toBe(receipt);
    expect(assertHeader(other, otherReceipt)).toBe(otherReceipt);
  });

  it("poisons replay before preparing or executing another header INSERT", () => {
    const graph = headerGraph(8);
    const receipt = publishHeader(graph);
    const totalBeforeReplay = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic",
    );

    expectProviderError(
      () => publishHeader(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /baseline|header|publication|reused|second/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection))
      .toEqual(totalBeforeReplay);
    expect(readHeaderRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderPublicationReceipt: receipt,
        baselineHeaderPublicationReceiptMintCount: 1,
        lifecycle: "poisoned",
        writePhase: "poisoned",
      });
  });

  it("records zero prepare/run/row progress when header prepare fails", () => {
    const graph = headerGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced baseline-header prepare failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic",
    ).mockImplementation(() => {
      throw primary;
    });

    expect(() => publishHeader(graph)).toThrow(primary);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readHeaderRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderAffectedRows: 0,
        baselineHeaderExecuteCount: 0,
        baselineHeaderPrepareCount: 0,
        baselineHeaderPublicationReceipt: undefined,
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 7,
          fixedStatementCount: 25,
          logicalWriteSequence: 2,
        },
        writePhase: "poisoned",
      });
  });

  it("records one prepare but zero physical rows when execution fails before native run", () => {
    const graph = headerGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection);
    const primary = new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      "inspect-schema",
      "forced baseline-header run failure",
    );
    vi.spyOn(
      sqliteConnectionModule,
      "executeSQLiteConnectionBaselineHeaderPublicationIntrinsic",
    ).mockImplementation(() => {
      throw primary;
    });

    expect(() => publishHeader(graph)).toThrow(primary);
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection)).toEqual(totalBefore);
    expect(readHeaderRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderAffectedRows: 0,
        baselineHeaderExecuteCount: 0,
        baselineHeaderPrepareCount: 1,
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        writePhase: "poisoned",
      });
  });

  it("preserves the real one-row progress when the returned step result is spoofed", () => {
    const graph = headerGraph(1);
    const originalExecute =
      sqliteConnectionModule.executeSQLiteConnectionBaselineHeaderPublicationIntrinsic;
    vi.spyOn(
      sqliteConnectionModule,
      "executeSQLiteConnectionBaselineHeaderPublicationIntrinsic",
    ).mockImplementation((connection, execution, row) => {
      const step = originalExecute(connection, execution, row);
      return Object.freeze({ ...step, affectedRowsDelta: 0 }) as typeof step;
    });

    expectProviderError(
      () => publishHeader(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /baseline|header|execution|drift|result/u,
    );
    expect(readHeaderRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderAffectedRows: 1,
        baselineHeaderExecuteCount: 1,
        baselineHeaderPrepareCount: 1,
        baselineHeaderPublicationReceipt: undefined,
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 8,
          fixedStatementCount: 26,
          logicalWriteSequence: 2,
        },
        writePhase: "poisoned",
      });
  });

  it("rejects post-write parameter digest drift before minting a receipt", () => {
    const graph = headerGraph(1);
    const originalDigest =
      initialWriteDigestModule.digestSQLiteInitialWriteParametersIntrinsic;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteParametersIntrinsic",
    ).mockImplementation((parameters) => {
      const actual = originalDigest(parameters);
      return `${actual.slice(0, -1)}${actual.endsWith("0") ? "1" : "0"}` as typeof actual;
    });

    expectProviderError(
      () => publishHeader(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /baseline|header|digest|parameter|receipt/u,
    );
    expect(readHeaderRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderAffectedRows: 1,
        baselineHeaderPublicationReceipt: undefined,
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 8,
          fixedStatementCount: 26,
          logicalWriteSequence: 2,
        },
        writePhase: "poisoned",
      });
  });

  it("rejects post-write aggregate result digest drift before minting a receipt", () => {
    const graph = headerGraph(1);
    const originalDigest = initialWriteDigestModule.digestSQLiteInitialWriteResultIntrinsic;
    vi.spyOn(
      initialWriteDigestModule,
      "digestSQLiteInitialWriteResultIntrinsic",
    ).mockImplementation((result) => {
      const actual = originalDigest(result);
      return `${actual.slice(0, -1)}${actual.endsWith("0") ? "1" : "0"}` as typeof actual;
    });

    expectProviderError(
      () => publishHeader(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /baseline|header|digest|result|receipt/u,
    );
    expect(readHeaderRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderAffectedRows: 1,
        baselineHeaderPublicationReceipt: undefined,
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        outerLedger: {
          affectedRowsWatermark: 8,
          fixedStatementCount: 26,
          logicalWriteSequence: 2,
        },
        writePhase: "poisoned",
      });
  });

  it("never opens, commits, rolls back, or otherwise owns the caller transaction", () => {
    const graph = headerGraph(1);
    const exec = vi.spyOn(graph.connection, "execTrusted");
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(graph.connection);
    const receipt = publishHeader(graph);

    expect(exec).not.toHaveBeenCalled();
    expect(readSQLiteConnectionOwnerSnapshot(graph.connection)).toMatchObject({
      isTransaction: true,
      transactionLineage: ownerBefore.transactionLineage,
      transactionMode: "exclusive",
    });
    expect(assertHeader(graph, receipt)).toBe(receipt);
  });

  it("rejects stale transaction lineage before preparing the header", () => {
    const graph = headerGraph(1);
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    graph.connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema");
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic",
    );

    expectProviderError(
      () => publishHeader(graph),
      "GE_CYCLE_STORE_STALE_FENCE",
      /clock|lineage|retired|stale|transaction/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderPublicationReceipt: undefined,
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "retired",
      });
  });

  it("poisons catalog drift before preparing the header", () => {
    const graph = headerGraph(1);
    graph.connection.prepare(
      "CREATE TABLE main.ge_hostile_header_catalog_drift (id INTEGER NOT NULL)",
      "inspect-schema",
    ).run();
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic",
    );

    expectProviderError(
      () => publishHeader(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /catalog|fence|drift|baseline|entries/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readHeaderRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        writePhase: "poisoned",
      });
  });

  it("poisons unexplained total-change watermark drift before preparing the header", () => {
    const graph = headerGraph(1);
    const totalBefore = readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges;
    graph.connection.prepare(
      "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1",
      "inspect-schema",
    ).run();
    const begin = vi.spyOn(
      sqliteConnectionModule,
      "beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic",
    );

    expectProviderError(
      () => publishHeader(graph),
      "GE_CYCLE_STORE_CORRUPTION",
      /clock|drift|ledger|watermark|receipt/u,
    );
    expect(begin).not.toHaveBeenCalled();
    expect(readSQLiteConnectionTotalChangesSnapshot(graph.connection).totalChanges)
      .toBe(totalBefore + 1);
    expect(readHeaderRows(graph)).toHaveLength(0);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderPublicationReceiptMintCount: 0,
        lifecycle: "poisoned",
        writePhase: "poisoned",
      });
  });

  it("uses captured database, statement, and string methods in the header write window", () => {
    const graph = headerGraph(1);
    const database = DatabaseSync.prototype as unknown as {
      prepare(sql: string): unknown;
    };
    const statement = StatementSync.prototype as unknown as {
      run(...parameters: readonly unknown[]): unknown;
    };
    const originalPrepare = database.prepare;
    const originalRun = statement.run;
    const originalStartsWith = String.prototype.startsWith;
    const originalSlice = String.prototype.slice;
    const originalBegin =
      sqliteConnectionModule.beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic;
    const originalExecute =
      sqliteConnectionModule.executeSQLiteConnectionBaselineHeaderPublicationIntrinsic;
    let hostileCalls = 0;
    let receipt: SQLiteBaselineHeaderPublicationReceipt | undefined;
    try {
      vi.spyOn(
        sqliteConnectionModule,
        "beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic",
      ).mockImplementation((connection) => {
        database.prepare = function (): never {
          hostileCalls += 1;
          throw new Error("hostile DatabaseSync.prototype.prepare replacement");
        };
        statement.run = function (): never {
          hostileCalls += 1;
          throw new Error("hostile StatementSync.prototype.run replacement");
        };
        String.prototype.startsWith = function (): never {
          hostileCalls += 1;
          throw new Error("hostile String.prototype.startsWith replacement");
        };
        String.prototype.slice = function (): never {
          hostileCalls += 1;
          throw new Error("hostile String.prototype.slice replacement");
        };
        return originalBegin(connection);
      });
      vi.spyOn(
        sqliteConnectionModule,
        "executeSQLiteConnectionBaselineHeaderPublicationIntrinsic",
      ).mockImplementation((connection, execution, row) => {
        try {
          return originalExecute(connection, execution, row);
        } finally {
          database.prepare = originalPrepare;
          statement.run = originalRun;
          String.prototype.startsWith = originalStartsWith;
          String.prototype.slice = originalSlice;
        }
      });
      receipt = publishHeader(graph);
    } finally {
      database.prepare = originalPrepare;
      statement.run = originalRun;
      String.prototype.startsWith = originalStartsWith;
      String.prototype.slice = originalSlice;
    }

    expect(hostileCalls).toBe(0);
    expect(receipt).toBeDefined();
    expect(assertHeader(graph, receipt!)).toBe(receipt);
    expect(readHeaderRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderPublicationReceipt: receipt,
        baselineHeaderPublicationReceiptMintCount: 1,
        lifecycle: "active",
        writePhase: "baseline-header-complete",
      });
  });

  it("uses captured Hash update/digest after predecessor proof through receipt assertion", () => {
    const graph = headerGraph(1);
    const hashPrototype = Object.getPrototypeOf(createHash("sha256")) as {
      digest(...parameters: readonly unknown[]): unknown;
      update(...parameters: readonly unknown[]): unknown;
    };
    const originalUpdate = hashPrototype.update;
    const originalDigest = hashPrototype.digest;
    let hostileUpdateCalls = 0;
    let hostileDigestCalls = 0;
    let receipt: SQLiteBaselineHeaderPublicationReceipt | undefined;
    let asserted: SQLiteBaselineHeaderPublicationReceipt | undefined;
    const installHostileHash = (): void => {
      hashPrototype.update = function (): never {
        hostileUpdateCalls += 1;
        throw new Error("hostile Hash.prototype.update replacement");
      };
      hashPrototype.digest = function (): never {
        hostileDigestCalls += 1;
        throw new Error("hostile Hash.prototype.digest replacement");
      };
    };
    const restoreHash = (): void => {
      hashPrototype.update = originalUpdate;
      hashPrototype.digest = originalDigest;
    };
    const originalProvenance =
      cursorOwnershipModule.assertSQLiteCursorPreRebindReceiptProvenance;
    let armHostileHash = false;
    try {
      vi.spyOn(
        cursorOwnershipModule,
        "assertSQLiteCursorPreRebindReceiptProvenance",
      ).mockImplementation((candidate) => {
        const provenance = originalProvenance(candidate);
        if (armHostileHash) installHostileHash();
        return provenance;
      });
      armHostileHash = true;
      receipt = publishHeader(graph);
      restoreHash();
      asserted = assertHeader(graph, receipt);
    } finally {
      restoreHash();
    }

    expect(hostileUpdateCalls).toBe(0);
    expect(hostileDigestCalls).toBe(0);
    expect(receipt).toBeDefined();
    expect(asserted).toBe(receipt);
    expect(readHeaderRows(graph)).toHaveLength(1);
    expect(readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority))
      .toMatchObject({
        baselineHeaderPublicationReceipt: receipt,
        baselineHeaderPublicationReceiptMintCount: 1,
        lifecycle: "active",
        writePhase: "baseline-header-complete",
      });
  });

  it("keeps every header authority and connection session API package-private", () => {
    const privateNames = [
      "executeSQLiteCursorBaselineHeaderPublicationIntrinsic",
      "assertSQLiteCursorBaselineHeaderPublicationReceiptIntrinsic",
      "readSQLiteBaselineHeaderPublicationReceiptSnapshotIntrinsic",
      "SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC",
      "SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC",
      "SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC",
      "SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC",
      "SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC",
      "beginSQLiteConnectionBaselineHeaderPublicationExecutionIntrinsic",
      "executeSQLiteConnectionBaselineHeaderPublicationIntrinsic",
      "readSQLiteConnectionBaselineHeaderPublicationExecutionSnapshotIntrinsic",
    ];
    for (const name of privateNames) expect(name in sqliteRoot).toBe(false);
  });
});
