import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES,
  SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES,
  SQLiteCursorPublicationOwnerCompositionError,
  acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic,
  acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic,
  adoptSQLiteCursorPublicationOwnerCompositionIntrinsic,
  beginSQLiteCursorPublicationFixedReadIntrinsic,
  consumeSQLiteCursorPublicationFixedReadPermitIntrinsic,
  consumeSQLiteCursorPublicationMutationChildPermitIntrinsic,
  consumeSQLiteCursorPublicationMutationParentScopeIntrinsic,
  enterSQLiteCursorPublicationMutationChildPermitIntrinsic,
  issueSQLiteCursorPublicationFixedReadPermitIntrinsic,
  issueSQLiteCursorPublicationMutationChildPermitIntrinsic,
  issueSQLiteCursorPublicationMutationParentScopeIntrinsic,
  mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic,
  observeSQLiteCursorPublicationFixedReadRowIntrinsic,
  observeSQLiteCursorPublicationFixedReadTerminalIntrinsic,
  prepareSQLiteCursorPublicationFixedReadPermitIntrinsic,
  prepareSQLiteCursorPublicationReusableParentIntrinsic,
  readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic,
  readSQLiteCursorPublicationMutationChildPermitSnapshotIntrinsic,
  readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic,
  recordSQLiteCursorPublicationMutationChildReturnIntrinsic,
  retireSQLiteCursorPublicationFixedReadResourceIntrinsic,
  retireSQLiteCursorPublicationMutationChildResourceIntrinsic,
  retireSQLiteCursorPublicationReusableParentResourceIntrinsic,
  type SQLiteCursorPublicationFixedReadResourceKind,
  type SQLiteCursorPublicationMutationRouteDescriptor,
} from "../src/cursor-publication-owner-composition.js";
import {
  beginSQLiteCursorPublicationTransactionOwnerIntrinsic,
  captureSQLiteCursorPublicationTransactionFailureIntrinsic,
  finalizeSQLiteCursorPublicationTransactionFailureIntrinsic,
  readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic,
  registerSQLiteCursorPublicationTransactionOwnerIntrinsic,
  type SQLiteCursorPublicationTransactionBeginReceipt,
  type SQLiteCursorPublicationTransactionOwner,
} from "../src/cursor-publication-transaction-owner.js";
import { ensureSQLiteCycleStoreSchema } from "../src/migrations.js";
import { SQLiteConnection } from "../src/sqlite-connection.js";
import { createSQLiteCycleStoreDescriptor } from "../src/sqlite-profile.js";
import {
  SQLITE_CURSOR_P11_PARITY_REPORT_VERSION,
  createSQLiteCursorP11PortableReport,
  normalizeSQLiteCursorP11FailureCase,
  normalizeSQLiteCursorP11FixedReadCase,
  normalizeSQLiteCursorP11MutationCase,
  type SQLiteCursorP11NormalizedMutationCase,
  type SQLiteCursorP11ParityReportEnvelope,
} from "./support/cursor-publication-p11-normalized-report.js";

interface ActiveGraph {
  readonly owner: SQLiteCursorPublicationTransactionOwner;
  readonly receipt: SQLiteCursorPublicationTransactionBeginReceipt;
}

const repositoryRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const temporaryRoots: string[] = [];
const uvAvailability = spawnSync("uv", ["--version"], {
  cwd: repositoryRoot,
  encoding: "utf8",
  timeout: 10_000,
});
if (process.env.GRAPH_ENGINEERING_REQUIRE_P11_CROSS_RUNTIME === "1"
    && (uvAvailability.error !== undefined || uvAvailability.status !== 0)) {
  throw new Error("P11 cross-runtime parity requires an available uv executable");
}
const crossRuntimeIt = uvAvailability.error === undefined && uvAvailability.status === 0
  ? it
  : it.skip;

function activeGraph(caseId: string): ActiveGraph {
  const root = mkdtempSync(join(tmpdir(), `graph-engineering-p11-parity-${caseId}-`));
  temporaryRoots.push(root);
  const connection = new SQLiteConnection(join(root, "cycle-store.db"));
  ensureSQLiteCycleStoreSchema(connection, createSQLiteCycleStoreDescriptor(), {
    appliedAtMs: 1_700_000_000_000,
  });
  const owner = registerSQLiteCursorPublicationTransactionOwnerIntrinsic(connection);
  return {
    owner,
    receipt: beginSQLiteCursorPublicationTransactionOwnerIntrinsic(owner),
  };
}

function finalizeSuccess(graph: ActiveGraph): void {
  const primary = new Error("P11 parity success-case bounded cleanup");
  const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(
    graph.owner,
    primary,
  );
  let raised: unknown;
  try {
    finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture);
  } catch (error) {
    raised = error;
  }
  if (raised !== primary) throw new Error("P11 parity cleanup replaced its exact primary");
}

function mutationCase(
  caseId: SQLiteCursorP11NormalizedMutationCase["caseId"],
  descriptor: SQLiteCursorPublicationMutationRouteDescriptor,
  expectedCount: number,
) {
  const graph = activeGraph(caseId);
  const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
    graph.owner,
    graph.receipt,
  );
  const countProof = descriptor === SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]
    ? mintSQLiteCursorPublicationRetainedCountReceiptIntrinsic(
      composition,
      descriptor,
      Object.freeze(Array.from(
        { length: expectedCount },
        (_, ordinal) => Object.freeze({ ordinal }),
      )),
    )
    : expectedCount;
  const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
    composition,
    descriptor,
    countProof,
  );
  if (descriptor.model === "parent-owned-reusable") {
    prepareSQLiteCursorPublicationReusableParentIntrinsic(parent);
  }
  const children = [];
  if (expectedCount === 0) {
    acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic(parent);
  } else {
    for (let ordinal = 0; ordinal < expectedCount; ordinal += 1) {
      const child = issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, ordinal);
      enterSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
      recordSQLiteCursorPublicationMutationChildReturnIntrinsic(child);
      retireSQLiteCursorPublicationMutationChildResourceIntrinsic(child);
      acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic(child);
      consumeSQLiteCursorPublicationMutationChildPermitIntrinsic(child);
      children.push(readSQLiteCursorPublicationMutationChildPermitSnapshotIntrinsic(child));
    }
  }
  if (descriptor.model === "parent-owned-reusable") {
    retireSQLiteCursorPublicationReusableParentResourceIntrinsic(parent);
  }
  consumeSQLiteCursorPublicationMutationParentScopeIntrinsic(parent);
  const normalized = normalizeSQLiteCursorP11MutationCase(
    caseId,
    readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(parent),
    children,
  );
  finalizeSuccess(graph);
  return normalized;
}

function fixedReadCase(
  caseId: "fixed-read-0" | "fixed-read-2",
  routeIndex: 1 | 16,
  maximumRows: 0 | 2,
  resourceKind: SQLiteCursorPublicationFixedReadResourceKind,
) {
  const graph = activeGraph(caseId);
  const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
    graph.owner,
    graph.receipt,
  );
  const permit = issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
    composition,
    SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[routeIndex],
    maximumRows,
  );
  prepareSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
  beginSQLiteCursorPublicationFixedReadIntrinsic(permit);
  for (let row = 0; row < maximumRows; row += 1) {
    observeSQLiteCursorPublicationFixedReadRowIntrinsic(permit);
  }
  observeSQLiteCursorPublicationFixedReadTerminalIntrinsic(permit);
  retireSQLiteCursorPublicationFixedReadResourceIntrinsic(permit, resourceKind);
  consumeSQLiteCursorPublicationFixedReadPermitIntrinsic(permit);
  const normalized = normalizeSQLiteCursorP11FixedReadCase(
    caseId,
    readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic(permit),
  );
  finalizeSuccess(graph);
  return {
    normalized,
    runtimeLocal: Object.freeze({ caseId, resourceKind }),
  };
}

function orderFailureCase() {
  const graph = activeGraph("order-failure");
  const composition = adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
    graph.owner,
    graph.receipt,
  );
  const parent = issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
    composition,
    SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1],
    20,
  );
  let error: unknown;
  try {
    issueSQLiteCursorPublicationMutationChildPermitIntrinsic(parent, 1);
  } catch (caught) {
    error = caught;
  }
  if (!(error instanceof SQLiteCursorPublicationOwnerCompositionError)) {
    throw new Error("P11 parity order failure did not return the structured TS error");
  }
  return normalizeSQLiteCursorP11FailureCase(
    error.code,
    readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(graph.owner),
  );
}

function typescriptReport(): SQLiteCursorP11ParityReportEnvelope {
  const fixedZero = fixedReadCase("fixed-read-0", 1, 0, "iterator-return");
  const fixedTwo = fixedReadCase("fixed-read-2", 16, 2, "lexical-release");
  return Object.freeze({
    version: SQLITE_CURSOR_P11_PARITY_REPORT_VERSION,
    implementation: "typescript" as const,
    portable: createSQLiteCursorP11PortableReport([
      mutationCase("child-owned-20", SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1], 20),
      mutationCase("reusable-shape-0", SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2], 0),
      mutationCase("reusable-shape-3", SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2], 3),
      fixedZero.normalized,
      fixedTwo.normalized,
      orderFailureCase(),
    ]),
    runtimeLocal: Object.freeze({
      runtime: "typescript" as const,
      fixedReadResourceKinds: Object.freeze([
        fixedZero.runtimeLocal,
        fixedTwo.runtimeLocal,
      ]),
    }),
  });
}

function portableOnly(report: SQLiteCursorP11ParityReportEnvelope) {
  return { version: report.version, portable: report.portable };
}

function pythonReport(): Readonly<{
  readonly report: SQLiteCursorP11ParityReportEnvelope;
  readonly stdout: string;
}> {
  const script = join(
    repositoryRoot,
    "python/tests/sqlite_cursor_publication_owner_composition_report.py",
  );
  const result = spawnSync(
    "uv",
    ["run", "--project", "python", "python", script],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 180_000 },
  );
  expect(result.error, `Python P11 reporter spawn failed: ${String(result.error)}`).toBeUndefined();
  expect(result.signal, `Python P11 reporter terminated: ${result.stderr}`).toBeNull();
  expect(result.status, `Python P11 reporter failed: ${result.stderr}`).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.endsWith("\n")).toBe(true);
  expect(result.stdout.match(/\n/gu)).toHaveLength(1);
  const decoded = JSON.parse(result.stdout) as SQLiteCursorP11ParityReportEnvelope;
  expect(result.stdout).toBe(`${JSON.stringify(decoded)}\n`);
  return { report: decoded, stdout: result.stdout };
}

afterAll(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite P11-A zero-I/O normalized cross-runtime report", () => {
  it("normalizes the closed local scenario matrix without widening P11-A claims", () => {
    const report = typescriptReport();
    expect(Object.isFrozen(report)).toBe(true);
    expect(report.portable.cases.map(({ caseId }) => caseId)).toEqual([
      "child-owned-20",
      "reusable-shape-0",
      "reusable-shape-3",
      "fixed-read-0",
      "fixed-read-2",
      "mutation-order-failure",
    ]);
    expect(report.portable.invariants).toEqual({
      actualNativeIoCount: 0,
      sqlAuthority: false,
      routeClosure: false,
      stage18Accepted: false,
      commitAttemptCount: 0,
      dynamicCountProvenance: false,
    });
    expect(report.portable.nonclaims).toEqual([
      "native-sql-execution",
      "native-resource-retirement",
      "route-closure",
      "stage-18-acceptance",
      "runtime-commit-execution",
      "dynamic-count-provenance",
    ]);
  });

  crossRuntimeIt(
    "matches Python portable JSON byte-for-byte and emits deterministic Python stdout twice",
    () => {
      const typescript = typescriptReport();
      const first = pythonReport();
      const second = pythonReport();
      expect(first.stdout).toBe(second.stdout);
      expect(JSON.stringify(portableOnly(typescript)))
        .toBe(JSON.stringify(portableOnly(first.report)));
    },
    420_000,
  );

  crossRuntimeIt("keeps runtime-local retirement names outside portable equality", () => {
    const typescript = typescriptReport().runtimeLocal;
    const python = pythonReport().report.runtimeLocal;
    expect(typescript).toEqual({
      runtime: "typescript",
      fixedReadResourceKinds: [
        { caseId: "fixed-read-0", resourceKind: "iterator-return" },
        { caseId: "fixed-read-2", resourceKind: "lexical-release" },
      ],
    });
    expect(python).toEqual({
      runtime: "python",
      fixedReadResourceKinds: [
        { caseId: "fixed-read-0", resourceKind: "abstract-python-cursor-release" },
        { caseId: "fixed-read-2", resourceKind: "abstract-python-cursor-release" },
      ],
    });
  }, 220_000);
});
