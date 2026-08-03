import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS,
  SQLiteCursorPublicationTransactionOwnerError,
  beginSQLiteCursorPublicationTransactionOwnerIntrinsic,
  captureSQLiteCursorPublicationTransactionFailureIntrinsic,
  commitSQLiteCursorPublicationTransactionOwnerIntrinsic,
  finalizeSQLiteCursorPublicationTransactionFailureIntrinsic,
  readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic,
  readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic,
  registerSQLiteCursorPublicationTransactionOwnerIntrinsic,
  type SQLiteCursorPublicationTransactionOwner,
} from "../src/cursor-publication-transaction-owner.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import {
  SQLiteConnection,
  executeSQLiteConnectionRawCommitMethodIntrinsic,
  executeSQLiteConnectionRawRollbackMethodIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";

const CONTRACT_ID = "sqlite-cursor-publication-transaction-owner-v1" as const;
const CONTRACT_SHA256 =
  "e900c0d822a31690c6cd4ef8d160d1cc4474bf4c605471d1aac899d4b293b303" as const;
const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const temporaryRoots: string[] = [];
const uvAvailability = spawnSync("uv", ["--version"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  timeout: 10_000,
});
// The ordinary TypeScript matrix intentionally does not install Python/uv.
// A present uv must run both cases; only command absence may skip this file's
// cross-runtime assertions, while the dedicated cross-language job requires 0 skips.
const crossRuntimeIt = uvAvailability.error === undefined && uvAvailability.status === 0
  ? it
  : it.skip;

interface PortableReportEnvelope {
  readonly schemaVersion: 1;
  readonly contractId: typeof CONTRACT_ID;
  readonly contractFixtureCanonicalSha256: typeof CONTRACT_SHA256;
  readonly cases: readonly Readonly<Record<string, unknown>>[];
  readonly guardInventory: readonly Readonly<Record<string, unknown>>[];
  readonly claims: Readonly<Record<string, boolean>>;
  readonly nonclaims: readonly string[];
  readonly runtimeLocalCapabilityEvidence: Readonly<{
    readonly runtime: "typescript" | "python";
    readonly guardCapabilities: readonly Readonly<Record<string, unknown>>[];
  }>;
}

function sourceV1(name: string): SQLiteConnection {
  const root = mkdtempSync(join(tmpdir(), `graph-engineering-p9-parity-${name}-`));
  temporaryRoots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: 1_700_000_000_000,
  });
  return connection;
}

function finalize(
  owner: SQLiteCursorPublicationTransactionOwner,
): Readonly<{ primary: Error; raised: unknown }> {
  const primary = new Error("P9 portable exact terminal primary");
  const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(owner, primary);
  let raised: unknown;
  try {
    finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture);
  } catch (error) {
    raised = error;
  }
  if (raised !== primary) throw new Error("TypeScript transaction owner replaced its primary");
  return { primary, raised };
}

function beginCase(): Readonly<Record<string, unknown>> {
  const connection = sourceV1("begin");
  const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
  const registered = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
  const receipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
  const active = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
  const receiptSnapshot = readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(
    owner,
    receipt,
  );
  const report = {
    caseId: "begin-returned-active",
    registrationCount: active.registrationCount,
    provisionalGenerationMintCount: active.provisionalGenerationMintCount,
    provisionalGenerationPromotionCount: active.provisionalGenerationPromotionCount,
    provisionalGenerationTombstoneCount: active.provisionalGenerationTombstoneCount,
    beginAttemptCount: active.beginAttemptCount,
    beginNativeReturnCount: active.beginNativeReturnCount,
    beginReceiptMintCount: active.beginReceiptMintCount,
    runtimeTransactionControlCount: active.runtimeTransactionControlCount,
    ioCounts: [1, 0, 0, 0, 0],
    receiptFacts: {
      exactOwner: receiptSnapshot.exactOwner,
      exactConnection: receiptSnapshot.exactConnection,
      exactTransactionLineage: receiptSnapshot.exactTransactionLineage,
      exactProvisionalGeneration: receiptSnapshot.exactProvisionalGeneration,
      exclusiveMode: receiptSnapshot.exclusiveMode,
      beginAttempt: receiptSnapshot.beginAttempt,
    },
    transactionEpochDelta: Number(active.transactionEpoch - registered.transactionEpoch),
    totalChangesDelta: active.totalChanges - registered.totalChanges,
    tempMutationEpochDelta: Number(active.tempMutationEpoch - registered.tempMutationEpoch),
    registeredBeforeBeginIo: registered.beginAttemptCount === 0,
    commitAttemptCount: active.commitAttemptCount,
    terminalClassification: "active",
  };
  finalize(owner);
  return report;
}

function cleanupCase(): Readonly<Record<string, unknown>> {
  const connection = sourceV1("cleanup");
  const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
  const receipt = beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
  const receiptSnapshot = readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(
    owner,
    receipt,
  );
  const { primary, raised } = finalize(owner);
  const terminal = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
  let receiptRejected = false;
  try {
    readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(owner, receipt);
  } catch (error) {
    receiptRejected = error instanceof SQLiteCursorPublicationTransactionOwnerError;
  }
  return {
    caseId: "active-authenticated-failure-cleanup",
    ioCounts: [1, 0, terminal.rollbackAttemptCount, terminal.closeAttemptCount,
      terminal.reopenAttemptCount],
    nativeReturnCounts: [terminal.beginNativeReturnCount, 0,
      terminal.rollbackNativeReturnCount, terminal.closeNativeReturnCount,
      terminal.reopenSourceV1Count],
    ownershipCounts: [1, 0],
    exactPrimaryRethrown: raised === primary,
    receiptWasExactBeforeCleanup: [
      receiptSnapshot.exactOwner,
      receiptSnapshot.exactConnection,
      receiptSnapshot.exactTransactionLineage,
      receiptSnapshot.exactProvisionalGeneration,
      receiptSnapshot.exclusiveMode,
    ].every(Boolean),
    terminalGraphCleared: !terminal.hasLiveProvisionalGeneration
      && !terminal.hasExactTransactionLineage
      && !terminal.hasExactTransactionGeneration
      && !terminal.exclusiveMode
      && receiptRejected,
    runtimeTransactionControlCount: terminal.runtimeTransactionControlCount,
    commitAttemptCount: terminal.commitAttemptCount,
    terminalClassification: terminal.reopenSourceV1Count === 1
      ? "source-v1"
      : "unavailable-unresolved",
  };
}

function commitDisabledCase(): Readonly<Record<string, unknown>> {
  const connection = sourceV1("commit-disabled");
  const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
  beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
  const beforeOwner = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
  const beforeConnection = readSQLiteConnectionOwnerSnapshot(connection);
  let error: unknown;
  try {
    commitSQLiteCursorPublicationTransactionOwnerIntrinsic(owner, Object.freeze({}));
  } catch (caught) {
    error = caught;
  }
  const after = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
  const afterConnection = readSQLiteConnectionOwnerSnapshot(connection);
  const report = {
    caseId: "commit-hard-disabled",
    semanticOutcome: "commit-hard-disabled",
    rejectedBeforeNativeIo: error instanceof SQLiteCursorPublicationTransactionOwnerError,
    commitAttemptCount: after.commitAttemptCount,
    runtimeTransactionControlCount: after.runtimeTransactionControlCount,
    transactionEpochDelta: Number(afterConnection.transactionEpoch
      - beforeConnection.transactionEpoch),
    totalChangesDelta: after.totalChanges - beforeOwner.totalChanges,
    tempMutationEpochDelta: Number(afterConnection.tempMutationEpoch
      - beforeConnection.tempMutationEpoch),
  };
  finalize(owner);
  return report;
}

function guardEvidence(): readonly Readonly<Record<string, unknown>>[] {
  const connection = sourceV1("guards");
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

  const reject = (path: string, action: () => unknown): void => {
    const beforeOwner = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
    const beforeConnection = readSQLiteConnectionOwnerSnapshot(connection);
    let error: unknown;
    try {
      action();
    } catch (caught) {
      error = caught;
    }
    if (!(error instanceof SQLiteCursorPublicationTransactionOwnerError)
        || error.guardPath !== path) {
      throw new Error(`TypeScript guard evidence drifted at ${path}`);
    }
    const afterOwner = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
    const afterConnection = readSQLiteConnectionOwnerSnapshot(connection);
    if (afterOwner.transactionEpoch !== beforeOwner.transactionEpoch
        || afterOwner.totalChanges !== beforeOwner.totalChanges
        || afterConnection.tempMutationEpoch !== beforeConnection.tempMutationEpoch) {
      throw new Error(`TypeScript guard reached native SQLite at ${path}`);
    }
  };

  const registeredActions: readonly Readonly<{ path: string; action: () => unknown }>[] = [
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[0], action: () => executeSQLiteConnectionRawCommitMethodIntrinsic(connection) },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[1], action: () => executeSQLiteConnectionRawRollbackMethodIntrinsic(connection) },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[2], action: () => connection.execTrusted("COMMIT", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[3], action: () => connection.execTrusted("ROLLBACK", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[4], action: () => connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[5], action: () => connection.execTrusted("SAVEPOINT hostile", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[6], action: () => connection.execTrusted("SELECT 1; COMMIT", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[7], action: () => connection.prepare("BEGIN EXCLUSIVE", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[8], action: () => connection.immediate("inspect-schema", () => { immediateCalled = true; }) },
  ];
  for (const { path, action } of registeredActions) reject(path, action);
  if (immediateCalled) throw new Error("TypeScript guarded immediate callback ran");

  beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner);
  const activeActions: readonly Readonly<{ path: string; action: () => unknown }>[] = [
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[9], action: () => connection.execTrusted("BEGIN EXCLUSIVE", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[10], action: () => connection.close() },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[11], action: () => connection.prepare("UPDATE ge_cycle_migration_lock SET active_expires_at_ms = active_expires_at_ms", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[12], action: () => cachedMutation.run() },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[13], action: () => connection.prepare("CREATE TABLE ge_tx_owner_new (value INTEGER NOT NULL) STRICT", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[14], action: () => cachedDdl.run() },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[15], action: () => connection.execTrusted("PRAGMA user_version = 2", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[16], action: () => connection.execTrusted("VACUUM", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[17], action: () => connection.execTrusted("ATTACH DATABASE 'hostile.db' AS hostile", "inspect-schema") },
    { path: SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[18], action: () => connection.execTrusted("WITH hostile AS (SELECT 1) UPDATE ge_cycle_migration_lock SET active_expires_at_ms = active_expires_at_ms", "inspect-schema") },
  ];
  for (const { path, action } of activeActions) reject(path, action);
  const snapshot = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
  if (snapshot.guardRejectionCount !== 19
      || JSON.stringify(snapshot.rejectedGuardPaths)
        !== JSON.stringify(SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS)) {
    throw new Error("TypeScript did not exercise the exact 19-path inventory");
  }
  finalize(owner);
  return SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS.map((path) => ({
    path,
    evidence: "runtime-rejected",
    guardRejectCount: 1,
  }));
}

function portableGuardInventory(): readonly Readonly<Record<string, unknown>>[] {
  return SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS.map((path) => ({
    path,
    portableGuarantee: "no-native-io-bypass",
    nativeIoBypassPossible: false,
  }));
}

function typescriptReport(): PortableReportEnvelope {
  return {
    schemaVersion: 1,
    contractId: CONTRACT_ID,
    contractFixtureCanonicalSha256: CONTRACT_SHA256,
    cases: [beginCase(), cleanupCase(), commitDisabledCase()],
    guardInventory: portableGuardInventory(),
    claims: {
      ownerRegistration: true,
      preIoProvisionalGeneration: true,
      guardedBeginReturnedExactActive: true,
      commonGuardNoNativeIo: true,
      authenticatedReturnedFailureCleanup: true,
      commitHardDisabled: true,
      driverNativeBeginThrow: false,
      driverNativeRollbackThrow: false,
      driverNativeCloseThrow: false,
      commitRuntime: false,
      successPath: false,
      completeV2Classifier: false,
      publicApi: false,
      releaseGate: false,
    },
    nonclaims: [
      "driver-native-begin-throw",
      "driver-native-rollback-throw",
      "driver-native-close-throw",
      "runtime-commit-execution",
      "success-path",
      "complete-v2-reopen-classifier",
      "package-root-public-api",
      "release-gate",
    ],
    runtimeLocalCapabilityEvidence: {
      runtime: "typescript",
      guardCapabilities: guardEvidence(),
    },
  };
}

function portableOnly(report: PortableReportEnvelope): Omit<
  PortableReportEnvelope,
  "runtimeLocalCapabilityEvidence"
> {
  const {
    runtimeLocalCapabilityEvidence: _runtimeLocalCapabilityEvidence,
    ...portable
  } = report;
  return portable;
}

function pythonReport(): PortableReportEnvelope {
  const script = join(
    repositoryRoot,
    "python/tests/sqlite_cursor_publication_transaction_owner_report.py",
  );
  const result = spawnSync(
    "uv",
    ["run", "--project", "python", "python", script],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 120_000,
    },
  );
  expect(result.error, `Python P9 reporter spawn failed: ${String(result.error)}`).toBeUndefined();
  expect(result.signal, `Python P9 reporter terminated: ${result.stderr}`).toBeNull();
  expect(result.status, `Python P9 reporter failed: ${result.stderr}`).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.endsWith("\n")).toBe(true);
  expect(result.stdout.match(/\n/gu)).toHaveLength(1);
  const decoded = JSON.parse(result.stdout) as PortableReportEnvelope;
  expect(result.stdout).toBe(`${JSON.stringify(decoded)}\n`);
  return decoded;
}

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite publication transaction owner P9 portable parity", () => {
  crossRuntimeIt("matches canonical real-SQLite portable evidence across TypeScript and Python", () => {
    const typescript = typescriptReport();
    const python = pythonReport();
    expect(JSON.stringify(portableOnly(typescript))).toBe(JSON.stringify(portableOnly(python)));
  }, 150_000);

  crossRuntimeIt("keeps runtime-local prepared capability evidence outside portable equality", () => {
    const typescript = typescriptReport().runtimeLocalCapabilityEvidence;
    const python = pythonReport().runtimeLocalCapabilityEvidence;
    expect(typescript.runtime).toBe("typescript");
    expect(typescript.guardCapabilities).toHaveLength(19);
    expect(typescript.guardCapabilities.every(({ evidence }) => evidence === "runtime-rejected"))
      .toBe(true);
    expect(python.runtime).toBe("python");
    expect(python.guardCapabilities.filter(({ evidence }) => evidence === "structurally-absent")
      .map(({ path }) => path)).toEqual([
      "prepared-statement-containing-transaction-control",
      "already-prepared-permanent-DML-after-pre-retirement",
      "already-prepared-permanent-DDL-after-pre-retirement",
    ]);
  }, 150_000);
});
