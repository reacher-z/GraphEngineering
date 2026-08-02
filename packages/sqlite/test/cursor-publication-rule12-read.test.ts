import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { canonicalSerialize } from "@graph-engineering/core";
import { CycleStoreProviderError } from "@graph-engineering/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_SHA256_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_INTRINSIC,
  SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_SHA256_INTRINSIC,
} from "../src/cursor-publication-rebind-contract.js";
import {
  beginSQLiteConnectionPostRebindSealReadIntrinsic,
  disposeSQLiteConnectionPostRebindSealReadIntrinsic,
  executeSQLiteConnectionPostRebindSealReadIntrinsic,
  injectSQLiteConnectionPostRebindSealReadCloseFaultForTestIntrinsic,
  readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic,
  releaseSQLiteConnectionPostRebindSealReadIntrinsic,
} from "../src/cursor-publication-rule12-read.js";
import { SQLITE_CURSOR_SEAL_EMPTY_ROOT } from
  "../src/operation-baseline-cursor-invariants.js";
import {
  beginSQLiteConnectionCursorRebindExecutionIntrinsic,
  executeSQLiteConnectionCursorRebindIntrinsic,
  prepareSQLiteConnectionCursorPublicationReadIntrinsic,
  type SQLiteConnectionNativeReadKind,
} from "../src/sqlite-connection.js";
import {
  createReaderLeaseTestGraph,
  disposeReaderLeaseTestGraph,
  type ReaderLeaseTestGraph,
} from "./support/cursor-publication-clean-graph.js";

const SOURCE_DESCRIPTOR = "1".repeat(64);
const SOURCE_SCHEMA = "2".repeat(64);
const TARGET_DESCRIPTOR = "3".repeat(64);
const TARGET_SCHEMA = "4".repeat(64);
const PRINCIPAL_HASH = "5".repeat(64);
const AUTHORIZATION_HASH = "6".repeat(64);
const BLOB_HASH = "7".repeat(64);
const graphs: ReaderLeaseTestGraph[] = [];

function u64be(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function independentOneRowRoot(): string {
  const blobSha256 = createHash("sha256").update(Buffer.from("{}")).digest("hex");
  const carrier = {
    authorizationHash: AUTHORIZATION_HASH,
    checkpointScope: "scope-0",
    consumedAtMs: null,
    createdAtMs: 1000,
    expiresAtMs: 2000,
    kind: "checkpoint",
    nextPosition: 0,
    pageSize: 10,
    principalHash: PRINCIPAL_HASH,
    requestScopeBlobSha256: blobSha256,
    requestScopeByteLength: 2,
    snapshotBlobSha256: blobSha256,
    snapshotByteLength: 2,
    snapshotTailRecordHash: null,
    snapshotTailSequence: null,
    streamId: null,
    tenantId: "tenant-0",
    tokenHash: "8".padStart(64, "0"),
  };
  const rowBytes = Buffer.from(canonicalSerialize(carrier), "utf8");
  const rowDigest = createHash("sha256")
    .update(Buffer.from("graph-engineering/sqlite-cursor-seal-row/v1\0", "utf8"))
    .update(u64be(rowBytes.byteLength))
    .update(rowBytes)
    .digest();
  const sealDomain = Buffer.from("graph-engineering/sqlite-cursor-seal/v1\0", "utf8");
  const genesis = createHash("sha256").update(sealDomain).update(Buffer.of(0)).digest();
  const rowState = createHash("sha256")
    .update(sealDomain).update(Buffer.of(1)).update(genesis).update(u64be(1)).update(rowDigest)
    .digest();
  return createHash("sha256")
    .update(sealDomain).update(Buffer.of(2)).update(u64be(1)).update(rowState)
    .digest("hex");
}

function graphWithRows(mainCount: number, driverCount = mainCount): ReaderLeaseTestGraph {
  const graph = createReaderLeaseTestGraph(1);
  graphs.push(graph);
  const main = graph.connection.prepare(
    `INSERT INTO main.ge_cycle_cursors
       (tenant_id, token_hash, kind, principal_hash, authorization_hash,
        stream_id, checkpoint_scope, request_scope_blob, page_size,
        next_position, snapshot_tail_sequence, snapshot_tail_record_hash,
        descriptor_hash, schema_identity_sha256, snapshot_blob, created_at_ms,
        expires_at_ms, consumed_at_ms)
     VALUES (?, ?, 'checkpoint', ?, ?, NULL, ?, ?, 10, 0, NULL, NULL, ?, ?, ?,
             1000, 2000, NULL)`,
    "inspect-schema",
  );
  const stage = graph.connection.prepare(
    `INSERT INTO temp.ge_blr_cursor_seal
       (token_hash, tenant_id, kind, principal_hash, authorization_hash,
        stream_id, checkpoint_scope, request_scope_byte_length,
        request_scope_blob_sha256, page_size, next_position,
        snapshot_tail_sequence, snapshot_tail_record_hash, snapshot_byte_length,
        snapshot_blob_sha256, created_at_ms, expires_at_ms, consumed_at_ms,
        descriptor_hash, schema_identity_sha256, authorization_ok, scope_ok,
        blobs_canonical_ok, position_ok, clock_ok, catalog_ok, shape_ok,
        event_binding_ok, checkpoint_binding_ok, seal_eligible)
     VALUES (?, ?, 'checkpoint', ?, ?, NULL, ?, 2, ?, 10, 0, NULL, NULL, 2, ?,
             1000, 2000, NULL, ?, ?, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1)`,
    "inspect-schema",
  );
  for (let index = 0; index < Math.max(mainCount, driverCount); index += 1) {
    const tenantId = `tenant-${index}`;
    const tokenHash = (index + 8).toString(16).padStart(64, "0");
    if (index < mainCount) {
      main.run(
        tenantId, tokenHash, PRINCIPAL_HASH, AUTHORIZATION_HASH, `scope-${index}`,
        Buffer.from("{}"), SOURCE_DESCRIPTOR, SOURCE_SCHEMA, Buffer.from("{}"),
      );
    }
    if (index < driverCount) {
      stage.run(
        tokenHash, tenantId, PRINCIPAL_HASH, AUTHORIZATION_HASH, `scope-${index}`,
        BLOB_HASH, BLOB_HASH, SOURCE_DESCRIPTOR, SOURCE_SCHEMA,
      );
    }
  }
  return graph;
}

function completedRebind(graph: ReaderLeaseTestGraph) {
  const rebind = beginSQLiteConnectionCursorRebindExecutionIntrinsic(graph.connection);
  executeSQLiteConnectionCursorRebindIntrinsic(graph.connection, rebind, Object.freeze({
    targetDescriptorHash: TARGET_DESCRIPTOR,
    targetSchemaIdentitySha256: TARGET_SCHEMA,
    sourceDescriptorHash: SOURCE_DESCRIPTOR,
    sourceSchemaIdentitySha256: SOURCE_SCHEMA,
  }));
  return rebind;
}

afterEach(() => {
  for (const graph of graphs.splice(0)) disposeReaderLeaseTestGraph(graph);
});

describe("SQLite connection-only post-rebind seal read", () => {
  it("anchors all three exact SQL strings and SHA-256 identities", () => {
    expect(SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_INTRINSIC).toBe(
      "SELECT tenant_id, token_hash FROM main.ge_cycle_cursors ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY",
    );
    expect(SQLITE_CURSOR_PUBLICATION_POST_REBIND_MAIN_KEY_COUNT_SQL_SHA256_INTRINSIC).toBe(
      "09d1ce669070093fbbf0dfd8ce7e2a7bbfde96d051b3ce9341be85495479ec32",
    );
    expect(SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_INTRINSIC).toBe(
      "SELECT tenant_id, token_hash FROM temp.ge_blr_cursor_seal ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
    );
    expect(SQLITE_CURSOR_PUBLICATION_POST_REBIND_KEY_DRIVER_SQL_SHA256_INTRINSIC).toBe(
      "1694ab6fe938203b0d8f6cb72cf82238e89234c21086ff5d224c7de4db7b1266",
    );
    expect(SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_INTRINSIC).toContain(
      "FROM main.ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ? LIMIT 1",
    );
    expect(SQLITE_CURSOR_PUBLICATION_POST_REBIND_POINT_LOOKUP_SQL_SHA256_INTRINSIC).toBe(
      "bd056ee55f2bd27eee3277ed7bfee8ae7b7db935edc3cf0937fc8167e2eac342",
    );
  });

  it("keeps exact SQL, native handles, decoding and accumulation inside the connection owner", () => {
    const facadeSource = readFileSync(new URL(
      "../src/cursor-publication-rule12-read.ts", import.meta.url,
    ), "utf8");
    const connectionSource = readFileSync(new URL(
      "../src/sqlite-connection.ts", import.meta.url,
    ), "utf8");
    for (const forbidden of [
      "StatementSync",
      "SQLiteNativeStatementIterator",
      "iterateSQLiteStatementNativeIntrinsic",
      "nextSQLiteStatementIteratorNativeIntrinsic",
      "returnSQLiteStatementIteratorNativeIntrinsic",
      "decodeSQLiteCursorSealRow",
      "SQLiteCursorSealAccumulator",
      "SQLiteConnectionPostRebindSealPointConsumer",
    ]) {
      expect(facadeSource).not.toContain(forbidden);
    }
    expect(connectionSource).toContain("interface PostRebindSealScanState");
    expect(connectionSource).toContain("mainStatement: StatementSync | null");
    expect(connectionSource).toContain("pointIterator: SQLiteNativeStatementIterator | null");
    expect(connectionSource).toContain("decodeSQLiteCursorSealRow(fetched.value)");
    expect(connectionSource).toContain("new SQLiteCursorSealAccumulator(");
  });

  it("rejects all three private seal SQL routes through the generic read helper", () => {
    const graph = graphWithRows(0);
    for (const kind of [
      "cursor-publication-post-rebind-main-key-count",
      "cursor-publication-post-rebind-key-driver",
      "cursor-publication-post-rebind-point-lookup",
    ]) {
      expect(() => prepareSQLiteConnectionCursorPublicationReadIntrinsic(
        graph.connection,
        kind as SQLiteConnectionNativeReadKind,
        "inspect-schema",
      )).toThrow(/connection-owner private/u);
    }
  });

  for (const count of [0, 1, 3]) {
    it(`streams ${count} rows with exact lifecycle budgets and no authority verdict`, () => {
      const graph = graphWithRows(count);
      const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
        graph.connection, completedRebind(graph),
      );
      const evidence = executeSQLiteConnectionPostRebindSealReadIntrinsic(
        graph.connection, execution,
      );
      expect(evidence).toMatchObject({
        lifecycle: "completed",
        mainKeyCount: count,
        driverCount: count,
        lookupCount: count,
        accumulatorCount: count,
        observedDescriptorHash: count === 0 ? null : TARGET_DESCRIPTOR,
        observedSchemaIdentitySha256: count === 0 ? null : TARGET_SCHEMA,
        mainKeyCountPrepareCount: 1,
        mainKeyCountRows: count,
        mainKeyCountTerminalFetchCount: 1,
        mainKeyCountCloseAttemptCount: 1,
        mainKeyCountCloseCount: 1,
        driverPrepareCount: 1,
        driverRows: count,
        driverTerminalFetchCount: 1,
        driverCloseAttemptCount: 1,
        driverCloseCount: 1,
        pointStatementPrepareCount: 1,
        pointStatementExecuteCount: count,
        pointStatementReleaseCount: 1,
        pointCursorCreatedCount: count,
        pointCursorCloseAttemptCount: count,
        pointCursorClosedCount: count,
        maximumActiveCursors: count === 0 ? 1 : 2,
        maximumLivePhysicalRows: count === 0 ? 0 : 1,
        maximumLiveCarriers: count === 0 ? 0 : 1,
      });
      expect(evidence.computedImmutableRootSha256).toMatch(/^[0-9a-f]{64}$/u);
      if (count === 0) expect(evidence.computedImmutableRootSha256).toBe(SQLITE_CURSOR_SEAL_EMPTY_ROOT);
      if (count === 1) expect(evidence.computedImmutableRootSha256).toBe(independentOneRowRoot());
      expect(evidence).not.toHaveProperty("accepted");
      expect(evidence).not.toHaveProperty("receipt");
      expect(Object.isFrozen(evidence)).toBe(true);
      expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
        graph.connection, execution,
      )).toMatchObject({ lifecycle: "completed", rootDisclosed: false });
      expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
        graph.connection, execution,
      )).toThrow(/execution is terminal/u);
    });
  }

  it("poisons on an extra main row without disclosing a partial root", () => {
    const graph = graphWithRows(2, 1);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(CycleStoreProviderError);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      mainKeyCount: 2,
      driverCount: 1,
      lookupCount: 1,
      mainKeyCountCloseCount: 1,
      driverCloseCount: 1,
      pointStatementReleaseCount: 1,
      rootDisclosed: false,
    });
  });

  it("closes a missing point cursor and poisons the read", () => {
    const graph = graphWithRows(1, 2);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(/point lookup row is missing/u);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      pointCursorCreatedCount: 2,
      pointCursorClosedCount: 2,
      driverCloseCount: 1,
      pointStatementReleaseCount: 1,
      rootDisclosed: false,
    });
  });

  it("poisons mixed post-rebind mutable identities after closing both point cursors", () => {
    const graph = graphWithRows(2);
    graph.connection.prepare(
      "UPDATE main.ge_cycle_cursors SET descriptor_hash = ? WHERE tenant_id = 'tenant-1'",
      "inspect-schema",
    ).run("8".repeat(64));
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(/source identity/u);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      pointCursorCreatedCount: 2,
      pointCursorClosedCount: 2,
      driverCloseCount: 1,
      rootDisclosed: false,
    });
  });

  it("computes distinct roots for a same-length BLOB substitution without accepting either", () => {
    const original = graphWithRows(1);
    const substituted = graphWithRows(1);
    substituted.connection.prepare(
      "UPDATE main.ge_cycle_cursors SET request_scope_blob = ? WHERE tenant_id = 'tenant-0'",
      "inspect-schema",
    ).run(Buffer.from("[]"));
    const originalEvidence = executeSQLiteConnectionPostRebindSealReadIntrinsic(
      original.connection,
      beginSQLiteConnectionPostRebindSealReadIntrinsic(original.connection, completedRebind(original)),
    );
    const substitutedEvidence = executeSQLiteConnectionPostRebindSealReadIntrinsic(
      substituted.connection,
      beginSQLiteConnectionPostRebindSealReadIntrinsic(
        substituted.connection, completedRebind(substituted),
      ),
    );
    expect(originalEvidence.computedImmutableRootSha256)
      .not.toBe(substitutedEvidence.computedImmutableRootSha256);
    expect(originalEvidence).not.toHaveProperty("accepted");
    expect(substitutedEvidence).not.toHaveProperty("accepted");
  });

  it("rejects forged, proxied and cross-connection executions", () => {
    const graph = graphWithRows(0);
    const other = graphWithRows(0);
    const rebind = completedRebind(graph);
    const otherRebind = completedRebind(other);
    expect(() => beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, otherRebind,
    )).toThrow(/rebind execution is invalid/u);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(graph.connection, rebind);
    for (const candidate of [
      Object.freeze(Object.create(null)),
      new Proxy(execution, {}),
    ]) {
      expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
        graph.connection, candidate as typeof execution,
      )).toThrow(/seal read execution is invalid/u);
    }
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      other.connection, execution,
    )).toThrow(/seal read execution is invalid/u);
    expect(Reflect.ownKeys(execution)).toEqual([]);
    expect(Object.getPrototypeOf(execution)).toBeNull();
    expect(Object.isFrozen(execution)).toBe(true);
  });

  it("poisons an execution when exclusive transaction lineage changes", () => {
    const graph = graphWithRows(0);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    graph.connection.execTrusted("ROLLBACK", "inspect-schema");
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(/connection lineage drifted/u);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({ lifecycle: "poisoned", rootDisclosed: false });
  });

  it("poisons on same-owner totalChanges drift before preparing any seal SQL", () => {
    const graph = graphWithRows(1);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    graph.connection.prepare(
      "UPDATE main.ge_cycle_cursors SET expires_at_ms = expires_at_ms + 1",
      "inspect-schema",
    ).run();
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(/connection lineage drifted/u);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      mainKeyCountPrepareCount: 0,
      driverPrepareCount: 0,
      pointStatementPrepareCount: 0,
      mainStatementOwned: false,
      mainIteratorOwned: false,
      driverStatementOwned: false,
      driverIteratorOwned: false,
      pointStatementOwned: false,
      pointIteratorOwned: false,
      rootDisclosed: false,
    });
  });

  it("uses definition-time database and statement captures", () => {
    const graph = graphWithRows(1);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    const prepareDescriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, "prepare")!;
    const iterateDescriptor = Object.getOwnPropertyDescriptor(StatementSync.prototype, "iterate")!;
    const maxDescriptor = Object.getOwnPropertyDescriptor(Math, "max")!;
    const probeIterator = graph.connection.prepare(
      "SELECT 1", "inspect-schema",
    ).iterate() as Iterator<unknown>;
    let iteratorPrototype: object | null = Object.getPrototypeOf(probeIterator) as object | null;
    while (iteratorPrototype !== null
        && (!Object.hasOwn(iteratorPrototype, "next")
          || !Object.hasOwn(iteratorPrototype, "return"))) {
      iteratorPrototype = Object.getPrototypeOf(iteratorPrototype) as object | null;
    }
    expect(iteratorPrototype).not.toBeNull();
    const nextDescriptor = Object.getOwnPropertyDescriptor(iteratorPrototype!, "next")!;
    const returnDescriptor = Object.getOwnPropertyDescriptor(iteratorPrototype!, "return")!;
    probeIterator.return!();
    try {
      Object.defineProperty(DatabaseSync.prototype, "prepare", {
        configurable: true,
        value: () => { throw new Error("hostile prepare"); },
      });
      Object.defineProperty(StatementSync.prototype, "iterate", {
        configurable: true,
        value: () => { throw new Error("hostile iterate"); },
      });
      Object.defineProperty(Math, "max", {
        configurable: true,
        value: () => 0,
      });
      Object.defineProperty(iteratorPrototype!, "next", {
        configurable: true,
        value: () => { throw new Error("hostile iterator next"); },
      });
      Object.defineProperty(iteratorPrototype!, "return", {
        configurable: true,
        value: () => { throw new Error("hostile iterator return"); },
      });
      expect(executeSQLiteConnectionPostRebindSealReadIntrinsic(
        graph.connection, execution,
      )).toMatchObject({
        lifecycle: "completed",
        lookupCount: 1,
        maximumActiveCursors: 2,
        maximumLivePhysicalRows: 1,
        maximumLiveCarriers: 1,
      });
    } finally {
      Object.defineProperty(DatabaseSync.prototype, "prepare", prepareDescriptor);
      Object.defineProperty(StatementSync.prototype, "iterate", iterateDescriptor);
      Object.defineProperty(Math, "max", maxDescriptor);
      Object.defineProperty(iteratorPrototype!, "next", nextDescriptor);
      Object.defineProperty(iteratorPrototype!, "return", returnDescriptor);
    }
  });

  it("treats throw undefined from point close as a primary and recovers its real owner", () => {
    const graph = graphWithRows(2);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    injectSQLiteConnectionPostRebindSealReadCloseFaultForTestIntrinsic("point", undefined);
    let didThrow = false;
    try {
      executeSQLiteConnectionPostRebindSealReadIntrinsic(graph.connection, execution);
    } catch (error) {
      didThrow = true;
      expect(error).toBeUndefined();
    }
    expect(didThrow).toBe(true);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      driverCount: 1,
      lookupCount: 1,
      pointStatementExecuteCount: 1,
      pointCursorCloseAttemptCount: 1,
      pointCursorClosedCount: 0,
      pointStatementOwned: true,
      pointIteratorOwned: true,
      activeCursors: 1,
      rootDisclosed: false,
    });
    expect(disposeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      pointCursorCloseAttemptCount: 2,
      pointCursorClosedCount: 1,
      pointStatementOwned: false,
      pointIteratorOwned: false,
      activeCursors: 0,
      rootDisclosed: false,
    });
  });

  it("reports a point-close failure when no earlier row primary exists", () => {
    const graph = graphWithRows(1);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    const closeFailure = new Error("injected point close failure");
    injectSQLiteConnectionPostRebindSealReadCloseFaultForTestIntrinsic("point", closeFailure);
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(closeFailure);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      pointCursorCloseAttemptCount: 1,
      pointCursorClosedCount: 0,
      driverCloseAttemptCount: 1,
      driverCloseCount: 1,
      activeCursors: 1,
      pointStatementOwned: true,
      pointIteratorOwned: true,
      driverStatementOwned: false,
      driverIteratorOwned: false,
      livePhysicalRows: 0,
      liveCarriers: 0,
      rootDisclosed: false,
    });
    expect(disposeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      activeCursors: 0,
      pointStatementOwned: false,
      pointIteratorOwned: false,
      pointStatementReleaseCount: 1,
      pointCursorCloseAttemptCount: 2,
      pointCursorClosedCount: 1,
      rootDisclosed: false,
    });
  });

  it("does not prepare the driver when main-key close fails", () => {
    const graph = graphWithRows(0);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    injectSQLiteConnectionPostRebindSealReadCloseFaultForTestIntrinsic(
      "main-key-count", new Error("injected main close failure"),
    );
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(/injected main close failure/u);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      mainKeyCountCloseAttemptCount: 1,
      mainKeyCountCloseCount: 0,
      driverPrepareCount: 0,
      pointStatementPrepareCount: 0,
      activeCursors: 1,
      mainStatementOwned: true,
      mainIteratorOwned: true,
      livePhysicalRows: 0,
      liveCarriers: 0,
      rootDisclosed: false,
    });
    expect(disposeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      activeCursors: 0,
      mainStatementOwned: false,
      mainIteratorOwned: false,
      mainKeyCountCloseAttemptCount: 2,
      mainKeyCountCloseCount: 1,
      rootDisclosed: false,
    });
  });

  it("releases the point statement before a driver-close failure", () => {
    const graph = graphWithRows(0);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    injectSQLiteConnectionPostRebindSealReadCloseFaultForTestIntrinsic(
      "driver", new Error("injected driver close failure"),
    );
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(/injected driver close failure/u);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      pointStatementReleaseCount: 1,
      driverCloseAttemptCount: 1,
      driverCloseCount: 0,
      activeCursors: 1,
      pointStatementOwned: false,
      pointIteratorOwned: false,
      driverStatementOwned: true,
      driverIteratorOwned: true,
      livePhysicalRows: 0,
      liveCarriers: 0,
      rootDisclosed: false,
    });
    expect(disposeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      activeCursors: 0,
      driverStatementOwned: false,
      driverIteratorOwned: false,
      driverCloseAttemptCount: 2,
      driverCloseCount: 1,
      rootDisclosed: false,
    });
  });

  it("does not fetch the next driver key after a point-close failure", () => {
    const graph = graphWithRows(2);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    injectSQLiteConnectionPostRebindSealReadCloseFaultForTestIntrinsic(
      "point", new Error("stop before next driver"),
    );
    expect(() => executeSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(/stop before next driver/u);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      driverCount: 1,
      lookupCount: 1,
      pointStatementExecuteCount: 1,
      pointCursorCloseAttemptCount: 1,
      pointCursorClosedCount: 0,
      activeCursors: 1,
      livePhysicalRows: 0,
      liveCarriers: 0,
      rootDisclosed: false,
    });
  });

  it("keeps a row primary ahead of a simultaneous point-close failure", () => {
    const graph = graphWithRows(1);
    graph.connection.prepare(
      "UPDATE main.ge_cycle_cursors SET request_scope_blob = ? WHERE tenant_id = 'tenant-0'",
      "inspect-schema",
    ).run(Buffer.from("no"));
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, completedRebind(graph),
    );
    const closeFailure = new Error("must not replace row primary");
    injectSQLiteConnectionPostRebindSealReadCloseFaultForTestIntrinsic("point", closeFailure);
    let observed: unknown;
    try {
      executeSQLiteConnectionPostRebindSealReadIntrinsic(graph.connection, execution);
    } catch (error) {
      observed = error;
    }
    expect(observed).toBeInstanceOf(CycleStoreProviderError);
    expect(observed).not.toBe(closeFailure);
    expect(readSQLiteConnectionPostRebindSealReadSnapshotIntrinsic(
      graph.connection, execution,
    )).toMatchObject({
      lifecycle: "poisoned",
      lookupCount: 0,
      pointCursorCloseAttemptCount: 1,
      pointCursorClosedCount: 0,
      driverCloseCount: 1,
      activeCursors: 1,
      livePhysicalRows: 0,
      liveCarriers: 0,
      rootDisclosed: false,
    });
  });

  it("releases only before execution and rejects all reuse", () => {
    const graph = graphWithRows(0);
    const rebind = completedRebind(graph);
    const execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(graph.connection, rebind);
    expect(releaseSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toMatchObject({ lifecycle: "released", rootDisclosed: false });
    expect(() => releaseSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, execution,
    )).toThrow(/release is terminal/u);
    expect(() => beginSQLiteConnectionPostRebindSealReadIntrinsic(
      graph.connection, rebind,
    )).toThrow(/already began/u);
  });

  it("passes the isolated bounded completed-and-released owner GC probe", () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
    const probe = "test/probes/cursor-publication-rule12-read-gc.probe.test.ts";
    const result = spawnSync(
      process.execPath,
      [
        "--expose-gc",
        vitest,
        "run",
        probe,
        "--pool=threads",
        "--maxWorkers=1",
        "--fileParallelism=false",
        "--reporter=dot",
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: { ...process.env, GRAPH_ENGINEERING_RUN_RULE12_GC_PROBE: "1" },
        timeout: 150_000,
      },
    );
    expect(result.error, `GC probe spawn failed: ${String(result.error)}`).toBeUndefined();
    expect(result.signal, `GC probe was terminated: ${result.stderr}`).toBeNull();
    expect(result.status, [
      "isolated post-rebind completed/released owner GC probe failed",
      `stdout=${result.stdout}`,
      `stderr=${result.stderr}`,
    ].join("\n")).toBe(0);
  }, 160_000);
});
