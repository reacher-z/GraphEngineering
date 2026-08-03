import type {
  SQLiteCursorPublicationFixedReadPermitSnapshot,
  SQLiteCursorPublicationMutationChildPermitSnapshot,
  SQLiteCursorPublicationMutationParentScopeSnapshot,
} from "../../src/cursor-publication-owner-composition.js";
import type { SQLiteCursorPublicationTransactionOwnerSnapshot } from
  "../../src/cursor-publication-transaction-owner.js";

export const SQLITE_CURSOR_P11_PARITY_REPORT_VERSION =
  "sqlite-cursor-publication-owner-composition-p11-parity/v1" as const;

export interface SQLiteCursorP11NormalizedMutationCase {
  readonly caseId: "child-owned-20" | "reusable-shape-0" | "reusable-shape-3";
  readonly status: "success";
  readonly kind: "mutation";
  readonly route: Readonly<{
    readonly routeId: string;
    readonly model: "child-owned-one-shot" | "parent-owned-reusable";
    readonly bindingKind: "sql-sha256" | "asset-sha256";
    readonly bindingSha256: string;
  }>;
  readonly lifecycle: "parent-consumed";
  readonly expectedCount: number;
  readonly nextOrdinal: number;
  readonly childCounts: readonly [number, number, number, number, number, number];
  readonly childLifecycles: readonly "child-consumed"[];
  readonly reusableCounts: readonly [number, number, number];
  readonly actualNativeIoCount: 0;
  readonly sqlAuthority: false;
  readonly routeClosure: false;
  readonly stage18Accepted: false;
  readonly commitAttemptCount: 0;
  readonly dynamicCountProvenance: false;
}

export interface SQLiteCursorP11NormalizedFixedReadCase {
  readonly caseId: "fixed-read-0" | "fixed-read-2";
  readonly status: "success";
  readonly kind: "fixed-read";
  readonly route: Readonly<{
    readonly routeId: string;
    readonly family: "owner-active-read" | "b2-eqp" | "rule12-eqp";
    readonly sqlSha256: string;
  }>;
  readonly lifecycle: "consumed";
  readonly maximumRows: number;
  readonly observedRows: number;
  readonly maximumCursors: 1;
  readonly prepareCount: 1;
  readonly terminalRowObserved: true;
  readonly resourceRetired: true;
  readonly consumeCount: 1;
  readonly nativeCursorCloseCounts: readonly [0, 0];
  readonly mutationDelta: 0;
  readonly actualNativeIoCount: 0;
  readonly sqlAuthority: false;
  readonly routeClosure: false;
  readonly stage18Accepted: false;
  readonly commitAttemptCount: 0;
  readonly dynamicCountProvenance: false;
}

export interface SQLiteCursorP11NormalizedFailureCase {
  readonly caseId: "mutation-order-failure";
  readonly status: "failure";
  readonly kind: "mutation";
  readonly code: "GE_SQLITE_P11_SCOPE_ORDER";
  readonly rejectedOrdinal: 1;
  readonly expectedOrdinal: 0;
  readonly cleanup: Readonly<{
    readonly lifecycle: "finalized";
    readonly rollbackAttemptCount: 1;
    readonly rollbackNativeReturnCount: 1;
    readonly closeAttemptCount: 1;
    readonly closeNativeReturnCount: 1;
    readonly reopenAttemptCount: 1;
    readonly reopenSourceV1Count: 1;
    readonly commitAttemptCount: 0;
  }>;
  readonly actualNativeIoCount: 0;
  readonly sqlAuthority: false;
  readonly routeClosure: false;
  readonly stage18Accepted: false;
  readonly commitAttemptCount: 0;
  readonly dynamicCountProvenance: false;
}

export interface SQLiteCursorP11PortableReport {
  readonly cases: readonly (
    | SQLiteCursorP11NormalizedMutationCase
    | SQLiteCursorP11NormalizedFixedReadCase
    | SQLiteCursorP11NormalizedFailureCase
  )[];
  readonly invariants: Readonly<{
    readonly actualNativeIoCount: 0;
    readonly sqlAuthority: false;
    readonly routeClosure: false;
    readonly stage18Accepted: false;
    readonly commitAttemptCount: 0;
    readonly dynamicCountProvenance: false;
  }>;
  readonly claims: Readonly<{
    readonly ownerComposition: true;
    readonly migration20DescriptorCountShape: true;
    readonly reusableShapeN0N3: true;
    readonly fixedReadN0N2: true;
    readonly orderFailureCleanup: true;
    readonly nativeSqlExecution: false;
    readonly nativeResourceRetirement: false;
    readonly routeClosure: false;
    readonly stage18Acceptance: false;
    readonly commitRuntime: false;
    readonly dynamicCountProvenance: false;
  }>;
  readonly nonclaims: readonly [
    "native-sql-execution",
    "native-resource-retirement",
    "route-closure",
    "stage-18-acceptance",
    "runtime-commit-execution",
    "dynamic-count-provenance",
  ];
}

export interface SQLiteCursorP11ParityReportEnvelope {
  readonly version: typeof SQLITE_CURSOR_P11_PARITY_REPORT_VERSION;
  readonly implementation: "typescript" | "python";
  readonly portable: SQLiteCursorP11PortableReport;
  readonly runtimeLocal: Readonly<{
    readonly runtime: "typescript" | "python";
    readonly fixedReadResourceKinds: readonly Readonly<{
      readonly caseId: "fixed-read-0" | "fixed-read-2";
      readonly resourceKind: string;
    }>[];
  }>;
}

function assertZeroIo(actualNativeIoCount: number, sqlAuthority: boolean): void {
  if (actualNativeIoCount !== 0 || sqlAuthority) {
    throw new Error("SQLite P11 report cannot normalize an I/O-authorized case");
  }
}

export function normalizeSQLiteCursorP11MutationCase(
  caseId: SQLiteCursorP11NormalizedMutationCase["caseId"],
  parent: SQLiteCursorPublicationMutationParentScopeSnapshot,
  children: readonly SQLiteCursorPublicationMutationChildPermitSnapshot[],
): SQLiteCursorP11NormalizedMutationCase {
  assertZeroIo(parent.actualNativeIoCount, parent.sqlAuthority);
  const exactCase = caseId === "child-owned-20"
    ? parent.routeId === "main.migration-0002"
      && parent.bindingKind === "asset-sha256"
      && parent.model === "child-owned-one-shot"
      && parent.expectedCount === 20
    : parent.routeId === "main.baseline-entries"
      && parent.bindingKind === "sql-sha256"
      && parent.model === "parent-owned-reusable"
      && parent.expectedCount === (caseId === "reusable-shape-0" ? 0 : 3);
  if (!exactCase || parent.lifecycle !== "parent-consumed"
      || children.length !== parent.expectedCount
      || children.some((child) => child.lifecycle !== "child-consumed"
        || child.actualNativeIoCount !== 0 || child.sqlAuthority)) {
    throw new Error("SQLite P11 mutation graph cannot be normalized");
  }
  return Object.freeze({
    caseId,
    status: "success" as const,
    kind: "mutation" as const,
    route: Object.freeze({
      routeId: parent.routeId,
      model: parent.model,
      bindingKind: parent.bindingKind,
      bindingSha256: parent.bindingSha256,
    }),
    lifecycle: parent.lifecycle,
    expectedCount: parent.expectedCount,
    nextOrdinal: parent.nextOrdinal,
    childCounts: Object.freeze([
      parent.childIssuedCount,
      parent.childEnteredCount,
      parent.childNativeReturnCount,
      parent.childResourceRetiredCount,
      parent.childPostflightAcceptedCount,
      parent.childConsumedCount,
    ]),
    childLifecycles: Object.freeze(children.map((child) => child.lifecycle)) as
      readonly "child-consumed"[],
    reusableCounts: Object.freeze([
      parent.reusableParentPrepareCount,
      parent.reusableExecutionLeaseReleasedCount,
      parent.parentResourceRetiredCount,
    ]),
    actualNativeIoCount: 0 as const,
    sqlAuthority: false as const,
    routeClosure: false as const,
    stage18Accepted: false as const,
    commitAttemptCount: 0 as const,
    dynamicCountProvenance: false as const,
  });
}

export function normalizeSQLiteCursorP11FixedReadCase(
  caseId: SQLiteCursorP11NormalizedFixedReadCase["caseId"],
  permit: SQLiteCursorPublicationFixedReadPermitSnapshot,
): SQLiteCursorP11NormalizedFixedReadCase {
  assertZeroIo(permit.actualNativeIoCount, permit.sqlAuthority);
  const exactCase = caseId === "fixed-read-0"
    ? permit.routeId === "b2.eqp.source" && permit.maximumRows === 0
    : permit.routeId === "rule12.eqp.main-key-scan" && permit.maximumRows === 2;
  if (!exactCase || permit.lifecycle !== "consumed" || permit.prepareCount !== 1
      || !permit.terminalRowObserved || !permit.resourceRetired || permit.consumeCount !== 1) {
    throw new Error("SQLite P11 fixed-read graph cannot be normalized");
  }
  return Object.freeze({
    caseId,
    status: "success" as const,
    kind: "fixed-read" as const,
    route: Object.freeze({
      routeId: permit.routeId,
      family: permit.family,
      sqlSha256: permit.sqlSha256,
    }),
    lifecycle: permit.lifecycle,
    maximumRows: permit.maximumRows,
    observedRows: permit.observedRows,
    maximumCursors: permit.maximumCursors,
    prepareCount: permit.prepareCount,
    terminalRowObserved: permit.terminalRowObserved,
    resourceRetired: permit.resourceRetired,
    consumeCount: permit.consumeCount,
    nativeCursorCloseCounts: Object.freeze([0, 0]) as readonly [0, 0],
    mutationDelta: permit.mutationDelta,
    actualNativeIoCount: permit.actualNativeIoCount,
    sqlAuthority: permit.sqlAuthority,
    routeClosure: false as const,
    stage18Accepted: false as const,
    commitAttemptCount: 0 as const,
    dynamicCountProvenance: false as const,
  });
}

export function normalizeSQLiteCursorP11FailureCase(
  code: string,
  owner: SQLiteCursorPublicationTransactionOwnerSnapshot,
): SQLiteCursorP11NormalizedFailureCase {
  if (code !== "GE_SQLITE_P11_SCOPE_ORDER" || owner.lifecycle !== "finalized"
      || owner.rollbackAttemptCount !== 1 || owner.rollbackNativeReturnCount !== 1
      || owner.closeAttemptCount !== 1 || owner.closeNativeReturnCount !== 1
      || owner.reopenAttemptCount !== 1 || owner.reopenSourceV1Count !== 1
      || owner.commitAttemptCount !== 0) {
    throw new Error("SQLite P11 terminal failure cannot be normalized");
  }
  return Object.freeze({
    caseId: "mutation-order-failure" as const,
    status: "failure" as const,
    kind: "mutation" as const,
    code,
    rejectedOrdinal: 1 as const,
    expectedOrdinal: 0 as const,
    cleanup: Object.freeze({
      lifecycle: owner.lifecycle,
      rollbackAttemptCount: owner.rollbackAttemptCount,
      rollbackNativeReturnCount: owner.rollbackNativeReturnCount,
      closeAttemptCount: owner.closeAttemptCount,
      closeNativeReturnCount: owner.closeNativeReturnCount,
      reopenAttemptCount: owner.reopenAttemptCount,
      reopenSourceV1Count: owner.reopenSourceV1Count,
      commitAttemptCount: owner.commitAttemptCount,
    }),
    actualNativeIoCount: 0 as const,
    sqlAuthority: false as const,
    routeClosure: false as const,
    stage18Accepted: false as const,
    commitAttemptCount: 0 as const,
    dynamicCountProvenance: false as const,
  });
}

export function createSQLiteCursorP11PortableReport(
  cases: SQLiteCursorP11PortableReport["cases"],
): SQLiteCursorP11PortableReport {
  return Object.freeze({
    cases: Object.freeze([...cases]),
    invariants: Object.freeze({
      actualNativeIoCount: 0 as const,
      sqlAuthority: false as const,
      routeClosure: false as const,
      stage18Accepted: false as const,
      commitAttemptCount: 0 as const,
      dynamicCountProvenance: false as const,
    }),
    claims: Object.freeze({
      ownerComposition: true as const,
      migration20DescriptorCountShape: true as const,
      reusableShapeN0N3: true as const,
      fixedReadN0N2: true as const,
      orderFailureCleanup: true as const,
      nativeSqlExecution: false as const,
      nativeResourceRetirement: false as const,
      routeClosure: false as const,
      stage18Acceptance: false as const,
      commitRuntime: false as const,
      dynamicCountProvenance: false as const,
    }),
    nonclaims: Object.freeze([
      "native-sql-execution",
      "native-resource-retirement",
      "route-closure",
      "stage-18-acceptance",
      "runtime-commit-execution",
      "dynamic-count-provenance",
    ] as const),
  });
}
