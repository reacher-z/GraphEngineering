import { Buffer } from "node:buffer";
import { mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { TextDecoder } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import {
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
} from "@graph-engineering/runtime";

import * as sqliteRoot from "../src/index.js";
import {
  SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS,
  SQLiteCursorPublicationTransactionOwnerError,
  auditSQLiteCursorPublicationReopenCapabilityForTestIntrinsic,
  beginSQLiteCursorPublicationTransactionOwnerIntrinsic,
  captureSQLiteCursorPublicationTransactionFailureIntrinsic,
  commitSQLiteCursorPublicationTransactionOwnerIntrinsic,
  finalizeSQLiteCursorPublicationTransactionFailureIntrinsic,
  injectSQLiteCursorPublicationBeginAfterNativeReturnFaultForTestIntrinsic,
  injectSQLiteCursorPublicationCloseAfterNativeReturnFaultForTestIntrinsic,
  readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic,
  readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic,
  readSQLiteCursorPublicationReopenCapabilityForTestIntrinsic,
  registerSQLiteCursorPublicationTransactionOwnerIntrinsic,
  type SQLiteCursorPublicationTransactionOwner,
} from "../src/cursor-publication-transaction-owner.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";
import { SQLiteCycleStoreProvider } from "../src/sqlite-cycle-store.js";
import {
  SQLiteConnection,
  consumeSQLiteConnectionPublicationReopenCapabilityIntrinsic,
  executeSQLiteConnectionRawCommitMethodIntrinsic,
  executeSQLiteConnectionRawRollbackMethodIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";

interface ContractFixture {
  readonly boundary: Readonly<{
    readonly guardedTransactionControlPaths: readonly string[];
  }>;
  readonly fixtureCanonicalSha256: string;
}

const fixture = JSON.parse(readFileSync(new URL(
  "../../../spec/conformance/sqlite-cursor-publication-transaction-owner-v1.case.json",
  import.meta.url,
), "utf8")) as ContractFixture;
const temporaryRoots: string[] = [];

function sourceV1(): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-tx-owner-"));
  temporaryRoots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: 1_700_000_000_000,
  });
  return connection;
}

async function sourceV1WithRecord(): Promise<SQLiteConnection> {
  const root = mkdtempSync(join(tmpdir(), "graph-engineering-tx-owner-record-"));
  temporaryRoots.push(root);
  const path = join(root, "cycle-store.db");
  const provider = new SQLiteCycleStoreProvider(path, {
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  });
  await provider.append({
    context: Object.freeze({
      tenantId: "tenant-a",
      principalHash: "a".repeat(64),
      authorizationHash: "b".repeat(64),
      operationId: "append-a",
    }),
    streamId: "stream-a",
    expectedTail: Object.freeze({ exists: false, sequence: -1, recordHash: null }),
    lease: null,
    records: [createCycleStoreRecord({
      recordId: "record-a",
      sequence: 0,
      previousRecordHash: null,
      value: { payload: "semantic-source" },
    })],
  });
  provider.close();
  return new SQLiteConnection(path);
}

async function sourceV1WithLease(): Promise<SQLiteConnection> {
  const connection = await sourceV1WithRecord();
  const path = connection.path;
  connection.close();
  const provider = new SQLiteCycleStoreProvider(path, {
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  });
  await provider.acquireLease({
    context: Object.freeze({
      tenantId: "tenant-a",
      principalHash: "a".repeat(64),
      authorizationHash: "b".repeat(64),
      operationId: "lease-a",
    }),
    streamId: "stream-a",
    leaseId: "lease-a",
    holderId: "holder-a",
    ttlMs: 60_000,
    mode: "acquire",
    expectedFencingToken: 0,
  });
  provider.close();
  return new SQLiteConnection(path);
}

async function sourceV1WithLegalHold(): Promise<SQLiteConnection> {
  const connection = await sourceV1WithRecord();
  const path = connection.path;
  connection.close();
  const provider = new SQLiteCycleStoreProvider(path, {
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  });
  await provider.setLegalHold({
    context: Object.freeze({
      tenantId: "tenant-a",
      principalHash: "a".repeat(64),
      authorizationHash: "b".repeat(64),
      operationId: "hold-a",
    }),
    streamId: "stream-a",
    holdId: "hold-a",
    action: "place",
  });
  provider.close();
  return new SQLiteConnection(path);
}

async function sourceV1WithCheckpoint(
  createdAt = "2026-02-01T00:00:00.000Z",
): Promise<SQLiteConnection> {
  const connection = await sourceV1WithRecord();
  const path = connection.path;
  const row = connection.prepare(
    "SELECT record_hash FROM ge_cycle_records WHERE sequence = 0",
    "inspect-schema",
  ).get() as unknown as readonly [string];
  connection.close();
  const provider = new SQLiteCycleStoreProvider(path, {
    now: () => new Date("2026-07-27T00:00:00.000Z"),
  });
  await provider.saveCheckpoint({
    context: Object.freeze({
      tenantId: "tenant-a",
      principalHash: "a".repeat(64),
      authorizationHash: "b".repeat(64),
      operationId: "checkpoint-a",
    }),
    checkpoint: createCycleStoreCheckpoint({
      checkpointScope: "scope-a",
      checkpointId: "checkpoint-a",
      streamId: "stream-a",
      boundSequence: 0,
      boundRecordHash: row[0],
      createdAt,
      value: { folded: true },
    }),
    lease: null,
  });
  provider.close();
  return new SQLiteConnection(path);
}

async function sourceV1WithDeletedCheckpoint(): Promise<SQLiteConnection> {
  const connection = await sourceV1WithCheckpoint();
  const path = connection.path;
  const row = connection.prepare(
    `SELECT value_hash FROM ge_cycle_checkpoints
      WHERE checkpoint_scope = 'scope-a' AND checkpoint_id = 'checkpoint-a'`,
    "inspect-schema",
  ).get() as unknown as readonly [string];
  connection.close();
  const provider = new SQLiteCycleStoreProvider(path, {
    now: () => new Date("2026-07-27T00:00:01.000Z"),
  });
  await provider.deleteCheckpoint({
    context: Object.freeze({
      tenantId: "tenant-a",
      principalHash: "a".repeat(64),
      authorizationHash: "b".repeat(64),
      operationId: "delete-checkpoint-a",
    }),
    checkpointScope: "scope-a",
    checkpointId: "checkpoint-a",
    expectedValueHash: row[0],
  });
  provider.close();
  return new SQLiteConnection(path);
}

function finalizeOwner(
  owner: SQLiteCursorPublicationTransactionOwner,
  primary = new Error("authenticated terminal primary"),
): Error {
  const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(owner, primary);
  expect(() => finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture)).toThrow(primary);
  return primary;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("SQLite publication transaction owner P9", () => {
  it("registers before I/O, promotes one provisional generation, and begins once", () => {
    const connection = sourceV1();
    const beforeEpoch = connection.transactionEpoch;
    const beforeChanges = readSQLiteConnectionTotalChangesSnapshot(connection).totalChanges;
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);

    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner)).toMatchObject({
      lifecycle: "registered",
      registrationCount: 1,
      provisionalGenerationMintCount: 1,
      provisionalGenerationPromotionCount: 0,
      beginAttemptCount: 0,
      runtimeTransactionControlCount: 0,
      commitAttemptCount: 0,
      commitHardDisabled: true,
      transactionEpoch: beforeEpoch,
      totalChanges: beforeChanges,
    });
    expect(connection.transactionEpoch).toBe(beforeEpoch);
    expect(readSQLiteConnectionTotalChangesSnapshot(connection).totalChanges).toBe(beforeChanges);

    const receipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
    expect(receipt).toBeTypeOf("object");
    expect(readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(owner, receipt)).toMatchObject({
      exactOwner: true,
      exactConnection: true,
      exactTransactionLineage: true,
      exactProvisionalGeneration: true,
      exclusiveMode: true,
      beginAttempt: 1,
    });
    const active = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
    expect(active).toMatchObject({
      lifecycle: "active",
      provisionalGenerationPromotionCount: 1,
      provisionalGenerationTombstoneCount: 0,
      beginAttemptCount: 1,
      beginNativeReturnCount: 1,
      beginReceiptMintCount: 1,
      runtimeTransactionControlCount: 1,
      hasLiveProvisionalGeneration: true,
      hasExactTransactionLineage: true,
      hasExactTransactionGeneration: true,
      exclusiveMode: true,
      transactionEpochAdvancedExactlyOnceByOwnerBegin: true,
      totalChangesUnchangedByOwnerBegin: true,
    });
    expect(() => beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner)).toThrowError(
      expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_STATE" }),
    );

    finalizeOwner(owner);
  });

  it("pins relative registration, post-BEGIN, and reopen audits across cwd changes", () => {
    const originalCwd = process.cwd();
    const sourceRoot = mkdtempSync(join(tmpdir(), "graph-engineering-tx-owner-relative-source-"));
    const otherRoot = mkdtempSync(join(tmpdir(), "graph-engineering-tx-owner-relative-other-"));
    temporaryRoots.push(sourceRoot, otherRoot);
    let connection: SQLiteConnection | undefined;
    try {
      process.chdir(sourceRoot);
      connection = new SQLiteConnection("cycle-store.db");
      ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
        appliedAtMs: 1_700_000_000_000,
      });
      expect(connection.path).toBe("cycle-store.db");

      // The new cwd deliberately contains the same relative filename, but it
      // is not source-v1.  Any registration, post-BEGIN, or reopen audit that
      // resolves the public spelling again will inspect this substitute.
      const substitute = new SQLiteConnection(join(otherRoot, "cycle-store.db"));
      ensureSQLiteCycleStoreSchema(substitute, createSQLiteCycleStoreDescriptor(), {
        appliedAtMs: 1_700_000_000_000,
      });
      substitute.execTrusted("PRAGMA user_version = 2", "inspect-schema");
      substitute.close();

      process.chdir(otherRoot);
      const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
      beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
      const primary = new Error("relative-path terminal primary");
      const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(owner, primary);
      expect(() => finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture))
        .toThrow(primary);
      expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner)).toMatchObject({
        lifecycle: "finalized",
        reopenAttemptCount: 1,
        reopenSourceV1Count: 1,
      });
    } finally {
      process.chdir(originalCwd);
      if (connection?.isOpen) connection.close();
    }
  });

  it("classifies an unavailable reopen separately and still terminalizes", () => {
    const connection = sourceV1();
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
    const primary = new Error("unavailable-reopen terminal primary");
    const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(owner, primary);
    renameSync(connection.path, `${connection.path}.moved`);

    expect(() => finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture))
      .toThrowError(expect.objectContaining({
        code: "GE_SQLITE_TX_OWNER_REOPEN_UNAVAILABLE",
      }));
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner)).toMatchObject({
      lifecycle: "finalized",
      rollbackAttemptCount: 1,
      closeAttemptCount: 1,
      reopenAttemptCount: 1,
      reopenSourceV1Count: 0,
      diagnosticCodes: [
        "GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY",
        "GE_SQLITE_TX_OWNER_REOPEN_AUDIT",
      ],
    });
  });

  it("guards all 19 frozen bypass classes without epoch or total-change drift", () => {
    expect(SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS).toEqual(
      fixture.boundary.guardedTransactionControlPaths,
    );
    expect(SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS).toHaveLength(19);
    const connection = sourceV1();
    const cachedMutation = connection.prepare(
      "UPDATE ge_cycle_migration_lock "
        + "SET active_expires_at_ms = active_expires_at_ms WHERE singleton = 1",
      "inspect-schema",
    );
    const cachedDdl = connection.prepare(
      "CREATE TABLE ge_tx_owner_hostile (value INTEGER NOT NULL) STRICT",
      "inspect-schema",
    );
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    let immediateCalled = false;
    const beforeBeginActions: readonly Readonly<{
      path: typeof SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[number];
      action: () => unknown;
    }>[] = [
      { path: "connection-commit-method", action: () => executeSQLiteConnectionRawCommitMethodIntrinsic(connection) },
      { path: "connection-rollback-method", action: () => executeSQLiteConnectionRawRollbackMethodIntrinsic(connection) },
      { path: "execute-COMMIT-or-END", action: () => connection.execTrusted("COMMIT", "inspect-schema") },
      { path: "execute-ROLLBACK", action: () => connection.execTrusted("ROLLBACK", "inspect-schema") },
      { path: "execute-BEGIN", action: () => connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema") },
      { path: "execute-SAVEPOINT-or-RELEASE-or-ROLLBACK-TO", action: () => connection.execTrusted("SAVEPOINT hostile", "inspect-schema") },
      { path: "multi-statement-exec-containing-transaction-control", action: () => connection.execTrusted("SELECT 1; COMMIT", "inspect-schema") },
      { path: "prepared-statement-containing-transaction-control", action: () => connection.prepare("BEGIN EXCLUSIVE", "inspect-schema") },
      { path: "script-containing-implicit-or-explicit-transaction-control", action: () => connection.immediate("inspect-schema", () => { immediateCalled = true; }) },
    ];
    for (const { path, action } of beforeBeginActions) {
      const before = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
      expect(action).toThrowError(expect.objectContaining({
        code: "GE_SQLITE_TX_OWNER_GUARD_REJECTED",
        guardPath: path,
      }));
      const after = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
      expect(after.transactionEpoch).toBe(before.transactionEpoch);
      expect(after.totalChanges).toBe(before.totalChanges);
    }
    expect(immediateCalled).toBe(false);

    beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
    const activeActions: readonly Readonly<{
      path: typeof SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[number];
      action: () => unknown;
    }>[] = [
      { path: "nested-BEGIN", action: () => connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema") },
      { path: "close-live-guarded-transaction", action: () => connection.close() },
      { path: "newly-prepared-permanent-DML-after-pre-retirement", action: () => connection.prepare("UPDATE ge_cycle_migration_lock SET active_expires_at_ms = active_expires_at_ms", "inspect-schema") },
      { path: "already-prepared-permanent-DML-after-pre-retirement", action: () => cachedMutation.run() },
      { path: "newly-prepared-permanent-DDL-after-pre-retirement", action: () => connection.prepare("CREATE TABLE ge_tx_owner_new (value INTEGER NOT NULL) STRICT", "inspect-schema") },
      { path: "already-prepared-permanent-DDL-after-pre-retirement", action: () => cachedDdl.run() },
      { path: "persistent-PRAGMA-including-user-version-or-application-id", action: () => connection.execTrusted("PRAGMA user_version = 2", "inspect-schema") },
      { path: "VACUUM-ANALYZE-or-REINDEX", action: () => connection.execTrusted("VACUUM", "inspect-schema") },
      { path: "ATTACH-DETACH-or-connection-topology-change", action: () => connection.execTrusted("ATTACH DATABASE 'hostile.db' AS hostile", "inspect-schema") },
      { path: "any-other-permanent-state-mutation-or-transaction-proof-history-change", action: () => connection.execTrusted("WITH hostile AS (SELECT 1) UPDATE ge_cycle_migration_lock SET active_expires_at_ms = active_expires_at_ms", "inspect-schema") },
    ];
    for (const { path, action } of activeActions) {
      const before = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
      expect(action).toThrowError(expect.objectContaining({
        code: "GE_SQLITE_TX_OWNER_GUARD_REJECTED",
        guardPath: path,
      }));
      const after = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
      expect(after.transactionEpoch).toBe(before.transactionEpoch);
      expect(after.totalChanges).toBe(before.totalChanges);
    }
    expect(connection.prepare("SELECT 1", "inspect-schema").get()).toBeDefined();

    const after = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
    expect(connection.transactionEpoch).toBe(after.transactionEpoch);
    expect(readSQLiteConnectionTotalChangesSnapshot(connection).totalChanges).toBe(after.totalChanges);
    expect(after.guardRejectionCount).toBe(19);
    expect(after.rejectedGuardPaths).toEqual(SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS);

    finalizeOwner(owner);
  });

  it("hard-disables COMMIT before I/O and preserves zero commit attempts", () => {
    const connection = sourceV1();
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
    const before = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
    expect(() => commitSQLiteCursorPublicationTransactionOwnerIntrinsic(owner, Object.freeze({})))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_COMMIT_DISABLED" }));
    const after = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
    expect(after.commitAttemptCount).toBe(0);
    expect(after.runtimeTransactionControlCount).toBe(1);
    expect(after.transactionEpoch).toBe(before.transactionEpoch);
    expect(connection.transactionEpoch).toBe(before.transactionEpoch);
    finalizeOwner(owner);
  });

  it("authenticates one failure capture then rolls back, closes, and reopens source-v1", () => {
    const connection = sourceV1();
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    const receipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
    const heldReceiptSnapshot = readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(
      owner,
      receipt,
    );
    const primary = new Error("exact active-graph primary");
    const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(owner, primary);
    expect(() => readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(owner, receipt))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_AUTHORITY" }));

    expect(() => captureSQLiteCursorPublicationTransactionFailureIntrinsic(owner, primary))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_AUTHORITY" }));
    expect(() => finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(
      Object.freeze({ ...capture }),
    )).toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_AUTHORITY" }));
    injectSQLiteCursorPublicationCloseAfterNativeReturnFaultForTestIntrinsic(
      new Error("after native close return"),
    );
    expect(() => finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture)).toThrow(primary);

    expect(connection.isOpen).toBe(false);
    const terminalSnapshot = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
    expect(terminalSnapshot).toMatchObject({
      lifecycle: "finalized",
      provisionalGenerationPromotionCount: 1,
      beginAttemptCount: 1,
      beginNativeReturnCount: 1,
      rollbackAttemptCount: 1,
      rollbackNativeReturnCount: 1,
      closeAttemptCount: 1,
      closeNativeReturnCount: 1,
      reopenAttemptCount: 1,
      reopenSourceV1Count: 1,
      runtimeTransactionControlCount: 2,
      commitAttemptCount: 0,
      hasLiveProvisionalGeneration: false,
      hasExactTransactionLineage: false,
      hasExactTransactionGeneration: false,
      exclusiveMode: false,
      transactionEpochAdvancedExactlyOnceByOwnerBegin: true,
      totalChangesUnchangedByOwnerBegin: true,
      diagnosticCodes: [
        "GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY",
        "GE_SQLITE_TX_OWNER_CLOSE_TERTIARY",
      ],
    });
    expect(Object.values(heldReceiptSnapshot).every((value) =>
      value === null || ["boolean", "bigint", "number", "string"].includes(typeof value)))
      .toBe(true);
    expect(terminalSnapshot).not.toHaveProperty("connection");
    expect(terminalSnapshot).not.toHaveProperty("path");
    expect(terminalSnapshot).not.toHaveProperty("transactionLineage");
    expect(terminalSnapshot).not.toHaveProperty("provisionalGeneration");
    expect(terminalSnapshot).not.toHaveProperty("primary");
    expect(() => readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(owner, receipt))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_AUTHORITY" }));
    expect(() => finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_AUTHORITY" }));
  });

  it("rejects a non-v1 registration before installing any owner guard", () => {
    const connection = sourceV1();
    connection.execTrusted("PRAGMA user_version = 2", "inspect-schema");
    expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection)).toThrow();
    expect(connection.isOpen).toBe(true);
    connection.close();
  });

  it("rejects empty, version-2, and every non-source-v1 persistent object before BEGIN I/O", () => {
    const root = mkdtempSync(join(tmpdir(), "graph-engineering-tx-owner-invalid-"));
    temporaryRoots.push(root);
    const empty = new SQLiteConnection(join(root, "empty.db"));
    const emptyEpoch = empty.transactionEpoch;
    expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(empty)).toThrow();
    expect(empty.transactionEpoch).toBe(emptyEpoch);
    empty.close();

    for (const [name, mutate] of [
      ["v2-envelope", (value: SQLiteConnection) => {
        value.execTrusted("PRAGMA user_version = 2", "inspect-schema");
      }],
      ["hostile-table", (value: SQLiteConnection) => value.execTrusted(
        "CREATE TABLE hostile_table (value INTEGER NOT NULL) STRICT",
        "inspect-schema",
      )],
      ["hostile-index", (value: SQLiteConnection) => value.execTrusted(
        "CREATE INDEX hostile_index ON ge_cycle_migration_lock(active_expires_at_ms)",
        "inspect-schema",
      )],
      ["hostile-trigger", (value: SQLiteConnection) => value.execTrusted(
        "CREATE TRIGGER hostile_trigger AFTER UPDATE ON ge_cycle_migration_lock BEGIN SELECT 1; END",
        "inspect-schema",
      )],
      ["hostile-view", (value: SQLiteConnection) => value.execTrusted(
        "CREATE VIEW hostile_view AS SELECT singleton FROM ge_cycle_migration_lock",
        "inspect-schema",
      )],
    ] as const) {
      const connection = new SQLiteConnection(join(root, `${name}.db`));
      ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
        appliedAtMs: 1_700_000_000_000,
      });
      mutate(connection);
      const before = connection.transactionEpoch;
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection)).toThrow();
      expect(connection.transactionEpoch).toBe(before);
      connection.close();
    }
  });

  it("rejects a corrupt target when Database prototypes redirect reads to a clean substitute", () => {
    const corrupt = sourceV1();
    corrupt.execTrusted(
      "CREATE TABLE hostile_redirect_target (value INTEGER NOT NULL) STRICT",
      "inspect-schema",
    );
    const clean = sourceV1();
    const cleanPath = clean.path;
    clean.close();
    const cleanNative = new DatabaseSync(cleanPath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: true,
      timeout: 250,
    });
    cleanNative.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON");
    const prepareDescriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, "prepare")!;
    const pushDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "push")!;
    const exactPrepare = prepareDescriptor.value as DatabaseSync["prepare"];
    const exactPush = pushDescriptor.value as typeof Array.prototype.push;
    Object.defineProperty(DatabaseSync.prototype, "prepare", {
      ...prepareDescriptor,
      value: (_sql: string) => Reflect.apply(exactPrepare, cleanNative, [_sql]),
    });
    Object.defineProperty(Array.prototype, "push", {
      ...pushDescriptor,
      value(this: unknown[], ...items: unknown[]) {
        if (new Error().stack?.includes("sqlite-publication-source-v1-audit")) {
          throw new Error("hostile late Array.prototype.push replacement executed");
        }
        return Reflect.apply(exactPush, this, items);
      },
    });
    try {
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(corrupt)).toThrow();
      expect(corrupt.isTransaction).toBe(false);
    } finally {
      Object.defineProperty(Array.prototype, "push", pushDescriptor);
      Object.defineProperty(DatabaseSync.prototype, "prepare", prepareDescriptor);
      cleanNative.close();
      corrupt.close();
    }
  });

  it("rejects semantic value corruption when late prototypes redirect to a clean substitute", async () => {
    const corrupt = await sourceV1WithRecord();
    corrupt.execTrusted(
      "UPDATE ge_cycle_records SET value_blob = zeroblob(value_bytes) WHERE sequence = 0",
      "inspect-schema",
    );
    const clean = await sourceV1WithRecord();
    const cleanPath = clean.path;
    clean.close();
    const cleanNative = new DatabaseSync(cleanPath, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      open: true,
      readOnly: true,
      timeout: 250,
    });
    cleanNative.exec("PRAGMA trusted_schema = OFF; PRAGMA query_only = ON");

    const prepareDescriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, "prepare")!;
    const equalsDescriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, "equals")!;
    const exactPrepare = prepareDescriptor.value as DatabaseSync["prepare"];
    const statementMethodNames = [
      "all",
      "get",
      "setAllowBareNamedParameters",
      "setAllowUnknownNamedParameters",
      "setReadBigInts",
      "setReturnArrays",
    ] as const;
    const statementDescriptors = statementMethodNames.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(StatementSync.prototype, name)!,
    ] as const);
    Object.defineProperty(DatabaseSync.prototype, "prepare", {
      ...prepareDescriptor,
      value: (sql: string) => Reflect.apply(exactPrepare, cleanNative, [sql]),
    });
    Object.defineProperty(Buffer.prototype, "equals", {
      ...equalsDescriptor,
      value: () => true,
    });
    for (const [name, descriptor] of statementDescriptors) {
      const exact = descriptor.value as (...parameters: unknown[]) => unknown;
      Object.defineProperty(StatementSync.prototype, name, {
        ...descriptor,
        value(this: StatementSync, ...parameters: unknown[]) {
          return Reflect.apply(exact, this, parameters);
        },
      });
    }
    try {
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(corrupt)).toThrow();
      expect(corrupt.isTransaction).toBe(false);
    } finally {
      Object.defineProperty(Buffer.prototype, "equals", equalsDescriptor);
      for (const [name, descriptor] of statementDescriptors) {
        Object.defineProperty(StatementSync.prototype, name, descriptor);
      }
      Object.defineProperty(DatabaseSync.prototype, "prepare", prepareDescriptor);
      cleanNative.close();
      corrupt.close();
    }
  });

  it("rejects an empty stream when Map.prototype.size is forged after module load", () => {
    const connection = sourceV1();
    connection.prepare(`
      INSERT INTO ge_cycle_streams
        (tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms)
      VALUES ('tenant-a', 'empty-stream', -1, NULL, ?, ?)
    `, "inspect-schema").run(1_700_000_000_000, 1_700_000_000_000);
    const sizeDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, "size")!;
    Object.defineProperty(Map.prototype, "size", {
      ...sizeDescriptor,
      get: () => 1,
    });
    try {
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection)).toThrow();
      expect(connection.isTransaction).toBe(false);
    } finally {
      Object.defineProperty(Map.prototype, "size", sizeDescriptor);
      connection.close();
    }
  });

  it("rejects UTF-16 authoritative blobs after a synced TextDecoder builtin replacement", () => {
    const connection = sourceV1();
    const row = connection.prepare(
      "SELECT postconditions_blob FROM ge_cycle_migrations",
      "inspect-schema",
    ).get() as unknown as readonly [Uint8Array];
    const canonical = Buffer.from(row[0]).toString("utf8");
    connection.prepare(
      "UPDATE ge_cycle_migrations SET postconditions_blob = ?",
      "inspect-schema",
    ).run(Buffer.from(canonical, "utf16le"));

    const require = createRequire(import.meta.url);
    const util = require("node:util") as { TextDecoder: typeof TextDecoder };
    const originalTextDecoder = util.TextDecoder;
    function HostileTextDecoder(): TextDecoder {
      return new originalTextDecoder("utf-16le", { fatal: true });
    }
    util.TextDecoder = HostileTextDecoder as unknown as typeof TextDecoder;
    syncBuiltinESMExports();
    try {
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection)).toThrow();
      expect(connection.isTransaction).toBe(false);
    } finally {
      util.TextDecoder = originalTextDecoder;
      syncBuiltinESMExports();
      connection.close();
    }
  });

  it("rejects hostile sqlite_schema SQL when RegExp.prototype.exec erases its comment", () => {
    const connection = sourceV1();
    connection.execTrusted(`
      PRAGMA writable_schema = ON;
      UPDATE sqlite_schema
         SET sql = replace(
           sql,
           'CREATE TABLE ge_cycle_streams',
           'CREATE /*hostile*/ TABLE ge_cycle_streams'
         )
       WHERE type = 'table' AND name = 'ge_cycle_streams';
      PRAGMA writable_schema = OFF;
    `, "inspect-schema");
    const execDescriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, "exec")!;
    const exactExec = execDescriptor.value as RegExp["exec"];
    Object.defineProperty(RegExp.prototype, "exec", {
      ...execDescriptor,
      value(this: RegExp, input: string): RegExpExecArray | null {
        const marker = " /*hostile*/ ";
        const markerIndex = input.indexOf(marker);
        if (this.source === "\\s+" && markerIndex >= 0 && this.lastIndex <= markerIndex) {
          this.lastIndex = markerIndex + marker.length;
          const match = [marker] as unknown as RegExpExecArray;
          match.index = markerIndex;
          match.input = input;
          match.groups = undefined;
          return match;
        }
        return Reflect.apply(exactExec, this, [input]);
      },
    });
    try {
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection)).toThrow();
      expect(connection.isTransaction).toBe(false);
    } finally {
      Object.defineProperty(RegExp.prototype, "exec", execDescriptor);
      connection.close();
    }
  });

  it("rejects corrupt record_blob when a hostile decoder returns the original JSON", async () => {
    const connection = await sourceV1WithRecord();
    const row = connection.prepare(
      "SELECT record_blob FROM ge_cycle_records WHERE sequence = 0",
      "inspect-schema",
    ).get() as unknown as readonly [Uint8Array];
    const originalJson = Buffer.from(row[0]).toString("utf8");
    connection.execTrusted(
      "UPDATE ge_cycle_records SET record_blob = zeroblob(length(record_blob)) WHERE sequence = 0",
      "inspect-schema",
    );
    const decodeDescriptor = Object.getOwnPropertyDescriptor(TextDecoder.prototype, "decode")!;
    Object.defineProperty(TextDecoder.prototype, "decode", {
      ...decodeDescriptor,
      value: () => originalJson,
    });
    try {
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection)).toThrow();
      expect(connection.isTransaction).toBe(false);
    } finally {
      Object.defineProperty(TextDecoder.prototype, "decode", decodeDescriptor);
      connection.close();
    }
  });

  it("independently rejects a forged canonical record hash after Object.freeze is replaced", async () => {
    const connection = await sourceV1WithRecord();
    const row = connection.prepare(
      "SELECT record_blob FROM ge_cycle_records WHERE sequence = 0",
      "inspect-schema",
    ).get() as unknown as readonly [Uint8Array];
    const originalFreeze = Object.freeze;
    const stored = JSON.parse(Buffer.from(row[0]).toString("utf8")) as Record<string, unknown>;
    const forgedRecordHash = "f".repeat(64);
    const forgedRecord = originalFreeze({ ...stored, recordHash: forgedRecordHash });
    const forgedRecordBlob = Buffer.from(canonicalSerialize(forgedRecord), "utf8");
    connection.execTrusted("PRAGMA foreign_keys = OFF", "inspect-schema");
    connection.prepare(
      "UPDATE ge_cycle_records SET record_hash = ?, record_blob = ? WHERE sequence = 0",
      "inspect-schema",
    ).run(forgedRecordHash, forgedRecordBlob);
    connection.prepare(
      "UPDATE ge_cycle_streams SET tail_record_hash = ? WHERE tail_sequence = 0",
      "inspect-schema",
    ).run(forgedRecordHash);
    connection.execTrusted("DELETE FROM ge_cycle_operations", "inspect-schema");
    connection.execTrusted("PRAGMA foreign_keys = ON", "inspect-schema");

    Object.freeze = ((value: unknown) => {
      if (value !== null && typeof value === "object"
          && "recordId" in value && "recordHash" in value) {
        return forgedRecord;
      }
      return originalFreeze(value);
    }) as typeof Object.freeze;
    let rejected = false;
    try {
      registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    } catch {
      rejected = true;
    } finally {
      Object.freeze = originalFreeze;
    }
    try {
      expect(rejected).toBe(true);
      expect(connection.isTransaction).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("rejects a canonical lease ledger result with reversed expiry after Date.parse is replaced", async () => {
    const connection = await sourceV1WithLease();
    const row = connection.prepare(
      "SELECT result_blob FROM ge_cycle_operations WHERE operation_name = 'acquire-lease'",
      "inspect-schema",
    ).get() as unknown as readonly [Uint8Array];
    const stored = JSON.parse(Buffer.from(row[0]).toString("utf8")) as Record<string, unknown>;
    const forged = { ...stored, expiresAt: "2025-07-27T00:00:00.000Z" };
    connection.prepare(
      `UPDATE ge_cycle_operations
          SET result_blob = ?, result_hash = ?
        WHERE operation_name = 'acquire-lease'`,
      "inspect-schema",
    ).run(
      Buffer.from(canonicalSerialize(forged), "utf8"),
      canonicalHash(forged),
    );

    const parseDescriptor = Object.getOwnPropertyDescriptor(Date, "parse")!;
    Object.defineProperty(Date, "parse", {
      ...parseDescriptor,
      value: (value: string) => value === forged.expiresAt ? 2 : 1,
    });
    let rejected = false;
    try {
      registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    } catch {
      rejected = true;
    } finally {
      Object.defineProperty(Date, "parse", parseDescriptor);
    }
    try {
      expect(rejected).toBe(true);
      expect(connection.isTransaction).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("rejects invalid canonical legal-hold IDs after RegExp.prototype.test is replaced", async () => {
    const connection = await sourceV1WithLegalHold();
    const forged = {
      legalHoldIds: ["!"],
      retentionMode: "retain-authoritative-history",
      archiveMode: "lossless-before-delete",
      compactionMode: "logical-history-preserving",
    };
    connection.prepare(
      `UPDATE ge_cycle_operations
          SET result_blob = ?, result_hash = ?
        WHERE operation_name = 'set-legal-hold'`,
      "inspect-schema",
    ).run(
      Buffer.from(canonicalSerialize(forged), "utf8"),
      canonicalHash(forged),
    );

    const testDescriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!;
    Object.defineProperty(RegExp.prototype, "test", {
      ...testDescriptor,
      value: () => true,
    });
    let rejected = false;
    try {
      registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    } catch {
      rejected = true;
    } finally {
      Object.defineProperty(RegExp.prototype, "test", testDescriptor);
    }
    try {
      expect(rejected).toBe(true);
      expect(connection.isTransaction).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("rejects impossible checkpoint calendar dates under hostile timestamp prototypes", async () => {
    const connections: SQLiteConnection[] = [];
    for (const invalidCreatedAt of [
      "0000-01-01T00:00:00.000Z",
      "2025-02-29T00:00:00.000Z",
      "2026-02-31T00:00:00.000Z",
      "2026-04-31T00:00:00.000Z",
    ]) {
      const connection = await sourceV1WithCheckpoint();
      connections.push(connection);
      const row = connection.prepare(
        `SELECT checkpoint_blob, summary_blob
           FROM ge_cycle_checkpoints
          WHERE checkpoint_scope = 'scope-a' AND checkpoint_id = 'checkpoint-a'`,
        "inspect-schema",
      ).get() as unknown as readonly [Uint8Array, Uint8Array];
      const checkpoint = JSON.parse(Buffer.from(row[0]).toString("utf8")) as
        Record<string, unknown>;
      const summary = JSON.parse(Buffer.from(row[1]).toString("utf8")) as
        Record<string, unknown>;
      const forgedCheckpoint = { ...checkpoint, createdAt: invalidCreatedAt };
      const forgedSummary = { ...summary, createdAt: invalidCreatedAt };
      connection.prepare(
        `UPDATE ge_cycle_checkpoints
            SET created_at = ?, checkpoint_blob = ?, summary_blob = ?
          WHERE checkpoint_scope = 'scope-a' AND checkpoint_id = 'checkpoint-a'`,
        "inspect-schema",
      ).run(
        invalidCreatedAt,
        Buffer.from(canonicalSerialize(forgedCheckpoint), "utf8"),
        Buffer.from(canonicalSerialize(forgedSummary), "utf8"),
      );
      connection.prepare(
        `UPDATE ge_cycle_checkpoint_revisions
            SET checkpoint_created_at = ?, summary_blob = ?
          WHERE checkpoint_scope = 'scope-a' AND checkpoint_id = 'checkpoint-a'`,
        "inspect-schema",
      ).run(
        invalidCreatedAt,
        Buffer.from(canonicalSerialize(forgedSummary), "utf8"),
      );
      connection.execTrusted("DELETE FROM ge_cycle_operations", "inspect-schema");
    }

    const testDescriptor = Object.getOwnPropertyDescriptor(RegExp.prototype, "test")!;
    const parseDescriptor = Object.getOwnPropertyDescriptor(Date, "parse")!;
    Object.defineProperty(RegExp.prototype, "test", {
      ...testDescriptor,
      value: () => true,
    });
    Object.defineProperty(Date, "parse", {
      ...parseDescriptor,
      value: () => 1_772_496_000_000,
    });
    const rejected: boolean[] = [];
    try {
      for (const connection of connections) {
        try {
          registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
          rejected.push(false);
        } catch {
          rejected.push(true);
        }
      }
    } finally {
      Object.defineProperty(Date, "parse", parseDescriptor);
      Object.defineProperty(RegExp.prototype, "test", testDescriptor);
    }
    try {
      expect(rejected).toEqual([true, true, true, true]);
      expect(connections.every((connection) => !connection.isTransaction)).toBe(true);
    } finally {
      for (const connection of connections) connection.close();
    }
  });

  it("accepts a real Gregorian leap-day checkpoint", async () => {
    const connection = await sourceV1WithCheckpoint("2024-02-29T00:00:00.000Z");
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
    finalizeOwner(owner);
  });

  it("rejects invalid identifiers in a coherent checkpoint deletion revision", async () => {
    const connection = await sourceV1WithDeletedCheckpoint();
    connection.prepare(
      `UPDATE ge_cycle_checkpoint_revisions
          SET checkpoint_scope = '!', checkpoint_id = '!', revision = 1
        WHERE checkpoint_scope = 'scope-a' AND checkpoint_id = 'checkpoint-a'
          AND action = 'delete'`,
      "inspect-schema",
    ).run();
    connection.execTrusted("DELETE FROM ge_cycle_operations", "inspect-schema");
    try {
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection)).toThrow();
      expect(connection.isTransaction).toBe(false);
    } finally {
      connection.close();
    }
  });

  it("rejects pre-attached databases and pre-existing TEMP schema before BEGIN I/O", () => {
    for (const [name, mutate] of [
      ["attached", (value: SQLiteConnection) => value.execTrusted(
        "ATTACH DATABASE ':memory:' AS hostile",
        "inspect-schema",
      )],
      ["temp-table", (value: SQLiteConnection) => value.execTrusted(
        "CREATE TEMP TABLE hostile_temp_table (value INTEGER NOT NULL) STRICT",
        "inspect-schema",
      )],
      ["temp-trigger", (value: SQLiteConnection) => value.execTrusted(
        "CREATE TEMP TRIGGER hostile_temp_trigger AFTER UPDATE ON main.ge_cycle_migration_lock BEGIN SELECT 1; END",
        "inspect-schema",
      )],
      ["temp-view", (value: SQLiteConnection) => value.execTrusted(
        "CREATE TEMP VIEW hostile_temp_view AS SELECT singleton FROM main.ge_cycle_migration_lock",
        "inspect-schema",
      )],
    ] as const) {
      const connection = sourceV1();
      mutate(connection);
      const before = readSQLiteConnectionOwnerSnapshot(connection);
      expect(() => registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection)).toThrow();
      const after = readSQLiteConnectionOwnerSnapshot(connection);
      expect(after.transactionEpoch).toBe(before.transactionEpoch);
      expect(after.isTransaction).toBe(false);
      connection.close();
    }
  });

  it("tracks the conservative TEMP-affecting attempt epoch independently", () => {
    const connection = sourceV1();
    const initial = readSQLiteConnectionOwnerSnapshot(connection).tempMutationEpoch;
    connection.execTrusted(
      "CREATE TEMP TABLE ge_tx_owner_temp (value INTEGER NOT NULL) STRICT",
      "inspect-schema",
    );
    expect(readSQLiteConnectionOwnerSnapshot(connection).tempMutationEpoch).toBe(initial + 1n);
    connection.prepare("INSERT INTO temp.ge_tx_owner_temp (value) VALUES (1)", "inspect-schema")
      .run();
    expect(readSQLiteConnectionOwnerSnapshot(connection).tempMutationEpoch).toBe(initial + 2n);
    connection.prepare("SELECT value FROM temp.ge_tx_owner_temp", "inspect-schema").get();
    expect(readSQLiteConnectionOwnerSnapshot(connection).tempMutationEpoch).toBe(initial + 2n);
    connection.execTrusted("DROP TABLE temp.ge_tx_owner_temp", "inspect-schema");
    expect(readSQLiteConnectionOwnerSnapshot(connection).tempMutationEpoch).toBe(initial + 3n);

    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    const receipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
    expect(readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(owner, receipt))
      .toMatchObject({ tempMutationEpoch: initial + 3n });
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner))
      .toMatchObject({ tempMutationEpochUnchangedByOwnerBegin: true });
    finalizeOwner(owner);
  });

  it("rejects an external writer committed between registration and exact BEGIN", () => {
    const connection = sourceV1();
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    const writer = new SQLiteConnection(connection.path);
    writer.execTrusted("PRAGMA user_version = 2", "inspect-schema");
    writer.close();

    expect(() => beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION" }));
    expect(connection.isOpen).toBe(false);
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner)).toMatchObject({
      lifecycle: "finalized",
      beginAttemptCount: 1,
      beginNativeReturnCount: 1,
      beginReceiptMintCount: 0,
      provisionalGenerationPromotionCount: 0,
      provisionalGenerationTombstoneCount: 1,
      rollbackAttemptCount: 1,
      rollbackNativeReturnCount: 1,
      closeAttemptCount: 1,
      closeNativeReturnCount: 1,
      reopenAttemptCount: 1,
      reopenSourceV1Count: 0,
      runtimeTransactionControlCount: 2,
      hasLiveProvisionalGeneration: false,
      hasExactTransactionLineage: false,
      hasExactTransactionGeneration: false,
      diagnosticCodes: [
        "GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY",
        "GE_SQLITE_TX_OWNER_REOPEN_AUDIT",
      ],
    });
  });

  it("binds an opaque reopen capability to the exact owner and connection", () => {
    const leftConnection = sourceV1();
    const rightConnection = sourceV1();
    const left = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(leftConnection);
    const right = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(rightConnection);
    const capability = readSQLiteCursorPublicationReopenCapabilityForTestIntrinsic(left);
    const clone = Object.freeze({ ...capability });

    expect(() => auditSQLiteCursorPublicationReopenCapabilityForTestIntrinsic(left, capability))
      .toThrow();
    expect(() => consumeSQLiteConnectionPublicationReopenCapabilityIntrinsic(
      capability,
      left as object,
      leftConnection,
    )).toThrow();
    expect(() => auditSQLiteCursorPublicationReopenCapabilityForTestIntrinsic(
      left,
      clone as typeof capability,
    )).toThrow();
    expect(() => auditSQLiteCursorPublicationReopenCapabilityForTestIntrinsic(right, capability))
      .toThrow();

    beginSQLiteCursorPublicationTransactionOwnerIntrinsic(left);
    beginSQLiteCursorPublicationTransactionOwnerIntrinsic(right);
    finalizeOwner(left);
    finalizeOwner(right);
    expect(() => auditSQLiteCursorPublicationReopenCapabilityForTestIntrinsic(left, capability))
      .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_STATE" }));
    expect(() => consumeSQLiteConnectionPublicationReopenCapabilityIntrinsic(
      capability,
      left as object,
      leftConnection,
    )).toThrow();
  });

  it.runIf(typeof globalThis.gc === "function")(
    "leaves an abandoned owner's connection guard permanently fail-closed",
    async () => {
      const connection = sourceV1();
      let owner: SQLiteCursorPublicationTransactionOwner | null =
        registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
      const ownerReference = new WeakRef(owner);
      let finalized = false;
      const registry = new FinalizationRegistry(() => { finalized = true; });
      registry.register(owner, "publication-owner");
      owner = null;
      for (let attempt = 0; attempt < 100 && !finalized; attempt += 1) {
        globalThis.gc?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(finalized).toBe(true);
      expect(ownerReference.deref()).toBeUndefined();
      expect(() => connection.prepare("SELECT 1", "inspect-schema").get())
        .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_STATE" }));
      expect(() => connection.close())
        .toThrowError(expect.objectContaining({ code: "GE_SQLITE_TX_OWNER_INVALID_STATE" }));
    },
  );

  it("rolls back the exact generation after an injected after-native-BEGIN-return throw", () => {
    const connection = sourceV1();
    const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
    const primary = new Error("after native BEGIN return");
    injectSQLiteCursorPublicationBeginAfterNativeReturnFaultForTestIntrinsic(primary);
    expect(() => beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner)).toThrow(primary);
    expect(connection.isOpen).toBe(false);
    expect(readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner)).toMatchObject({
      lifecycle: "finalized",
      provisionalGenerationPromotionCount: 0,
      provisionalGenerationTombstoneCount: 1,
      beginAttemptCount: 1,
      beginNativeReturnCount: 1,
      beginReceiptMintCount: 0,
      rollbackAttemptCount: 1,
      rollbackNativeReturnCount: 1,
      closeAttemptCount: 1,
      closeNativeReturnCount: 1,
      reopenAttemptCount: 1,
      reopenSourceV1Count: 1,
      runtimeTransactionControlCount: 2,
      commitAttemptCount: 0,
      hasLiveProvisionalGeneration: false,
      hasExactTransactionLineage: false,
      hasExactTransactionGeneration: false,
      exclusiveMode: false,
      transactionEpochAdvancedExactlyOnceByOwnerBegin: true,
      totalChangesUnchangedByOwnerBegin: true,
    });
  });

  it("remains package-private and does not widen the public root", () => {
    expect(fixture.fixtureCanonicalSha256).toBe(
      "e900c0d822a31690c6cd4ef8d160d1cc4474bf4c605471d1aac899d4b293b303",
    );
    expect("registerSQLiteCursorPublicationTransactionOwnerIntrinsic" in sqliteRoot).toBe(false);
    expect("commitSQLiteCursorPublicationTransactionOwnerIntrinsic" in sqliteRoot).toBe(false);
  });
});
