import { CycleStoreProviderError } from "@graph-engineering/runtime";

import type {
  SQLiteCursorPublicationNativeProjectionReceiptSnapshot,
} from "../../src/cursor-publication-owner-composition.js";
import type {
  SQLiteCursorPublicationTransactionOwnerSnapshot,
} from "../../src/cursor-publication-transaction-owner.js";
import {
  sqliteV1BaselineNormalizedSqlSha256Intrinsic,
} from "../../src/operation-baseline-source.js";

export const SQLITE_CURSOR_NATIVE_PROJECTION_NP1_CONTRACT_ID =
  "sqlite-cursor-publication-native-projection-np1/v1" as const;
export const SQLITE_CURSOR_NATIVE_PROJECTION_EXPECTED_NORMALIZED_SQL_SHA256 =
  Object.freeze([
    ["schema-envelope", "d463cf27633ca463ff1cc0ff57ccc632addf74d5c4f641aeb6425508fd9a840d"],
    ["migration-lineage", "c43f6ea643b6e2c03200609416e7c7d6bfdb735ca96f7fc83e2c7a474d6d3d4e"],
    ["stream-head", "30a30fe14c69e7d9f1795b29800fae147df3b44cf938d08b6734c44d5dfb8044"],
    ["record-identity", "4c92628b34578bcfeeca4d1003b3bdb2ce6c723405185db6bf12fe16b3581b4d"],
    ["checkpoint-current", "fc3ac0e541a22d5afbdd25c19d3883addd0e9bef09ad63c6343389716c98102b"],
    ["checkpoint-revision", "bb15b913e9f3881f515c4a8712ad3e05b6133558e8b5170a21f833444c54eecd"],
    ["lease-current", "bed724e3679e1c12eb81f017f748bd7a45c119673fbd4cd914d4b075485f5b04"],
    ["used-lease-identity", "315c46c5ad6064c39ed153b6e86f4fc1ac93093bbeb1520281e059097605d8a8"],
    ["legal-hold", "85819d020543c637a1eea9eaeb8d84a6e5e11c6d292e59dfddfccbdbcba5c63f"],
    ["migration-lock-current", "090564e9a36643dfaa705dac5eefd0a86acff04bfc000cd397202ddc8242fe0d"],
    ["used-migration-lock-identity", "8f4c8983ce55744fe36f398cb990f0bbf06c9787189180669d6d26ae58baf2a2"],
    ["legacy-operation", "e186ae71f91a771a95e41f05497f6e2c0ec3e38a7c7d6d16c17713cece498a02"],
  ] as const);
/**
 * Cross-runtime SQL identity removes CRLF and formatting-only whitespace.
 * Runtime-local evidence still retains the byte-exact raw SQL digest.
 */
export function sqliteCursorNativeProjectionNormalizedSqlSha256(
  sql: string,
): string {
  return sqliteV1BaselineNormalizedSqlSha256Intrinsic(sql);
}

export type SQLiteCursorNativeProjectionSuccessCaseId =
  | "baseline-dynamic-0-total-3"
  | "baseline-dynamic-1-total-4"
  | "baseline-dynamic-3-total-6";

export type SQLiteCursorNativeProjectionRejectionCaseId =
  | "baseline-total-0-impossible"
  | "baseline-total-1-impossible";

export interface SQLiteCursorNativeProjectionNormalizedReport {
  readonly schemaVersion: 1;
  readonly contractId: typeof SQLITE_CURSOR_NATIVE_PROJECTION_NP1_CONTRACT_ID;
  readonly implementation: "typescript" | "python";
  readonly portable: Readonly<{
    readonly successCases: readonly object[];
    readonly rejectionCases: readonly object[];
    readonly invariants: object;
    readonly nonclaims: readonly string[];
  }>;
  readonly runtimeLocal: Readonly<{
    readonly runtime: "typescript" | "python";
    readonly retirementMechanism: "native-iterator-return" | "cursor-close";
    readonly successCases: readonly object[];
  }>;
}

function exactSuccessCase(
  optionalDynamicCount: number,
  retainedCount: number,
): SQLiteCursorNativeProjectionSuccessCaseId {
  if (optionalDynamicCount === 0 && retainedCount === 3) {
    return "baseline-dynamic-0-total-3";
  }
  if (optionalDynamicCount === 1 && retainedCount === 4) {
    return "baseline-dynamic-1-total-4";
  }
  if (optionalDynamicCount === 3 && retainedCount === 6) {
    return "baseline-dynamic-3-total-6";
  }
  throw new Error("SQLite NP1 success count vector cannot be normalized");
}

export function normalizeSQLiteCursorNativeProjectionSuccessCase(
  optionalDynamicCount: 0 | 1 | 3,
  snapshot: SQLiteCursorPublicationNativeProjectionReceiptSnapshot,
): Readonly<{ readonly portable: object; readonly runtimeLocal: object }> {
  const caseId = exactSuccessCase(optionalDynamicCount, snapshot.retainedCount);
  if (snapshot.lifecycle !== "consumed" || snapshot.familyCount !== 12
      || snapshot.familyRetirements.length !== 12
      || snapshot.logicalNativeReadCount !== 12
      || !snapshot.fullExhausted || snapshot.genuineZeroClaim
      || !snapshot.nativeSourceProvenance || !snapshot.nativeProjectionAuthority
      || snapshot.sqlAuthority || snapshot.physicalNativeIoCountClaimed
      || snapshot.expectedProjectionCount !== snapshot.retainedCount
      || snapshot.familyRetirements.some((family, ordinal) =>
        family.entryKind !== SQLITE_CURSOR_NATIVE_PROJECTION_EXPECTED_NORMALIZED_SQL_SHA256[
          ordinal
        ]?.[0]
        || family.normalizedSqlSha256
          !== SQLITE_CURSOR_NATIVE_PROJECTION_EXPECTED_NORMALIZED_SQL_SHA256[ordinal]?.[1]
        || !family.terminalObserved
        || family.prepareCount !== 1 || family.terminalCount !== 1
        || family.retirementAttemptCount !== 1
        || family.retirementSuccessCount !== 1
        || family.expectedCount !== family.observedCount)) {
    throw new Error("SQLite NP1 success graph cannot be normalized");
  }
  const expectedFamilyCounts = snapshot.familyRetirements.map((family) => Object.freeze({
    entryKind: family.entryKind,
    count: family.expectedCount,
  }));
  const observedFamilyCounts = snapshot.familyRetirements.map((family) => Object.freeze({
    entryKind: family.entryKind,
    count: family.observedCount,
  }));
  const portable = Object.freeze({
    caseId,
    outcome: "success" as const,
    routeId: snapshot.routeId,
    sourceFamilyCount: snapshot.familyCount,
    optionalDynamicCount,
    orderedNormalizedSqlSha256: Object.freeze(
      snapshot.familyRetirements.map((family) => family.normalizedSqlSha256),
    ),
    expectedFamilyCounts: Object.freeze(expectedFamilyCounts),
    observedFamilyCounts: Object.freeze(observedFamilyCounts),
    expectedProjectionCount: snapshot.expectedProjectionCount,
    retainedProjectionCount: snapshot.retainedCount,
    sourceEnvelopeSha256: snapshot.sourceEnvelopeSha256,
    projectionCanonicalSha256: snapshot.projectionSha256,
    logicalNativeReadCount: snapshot.logicalNativeReadCount,
    prepareCount: 12 as const,
    terminalObservationCount: 12 as const,
    decodeCount: snapshot.retainedCount,
    resourceRetirement: Object.freeze({
      normalized: "complete" as const,
      exactPairing: snapshot.exactResourcePairing,
      resourceCount: 12 as const,
      attemptCount: 12 as const,
      returnCount: 12 as const,
    }),
    receiptLifecycle: Object.freeze({
      state: "consumed" as const,
      mintCount: 1 as const,
      consumeCount: 1 as const,
      replayRejected: true as const,
    }),
    bindings: Object.freeze({
      exactOwner: snapshot.exactOwner,
      exactBeginReceipt: snapshot.exactBeginReceipt,
      exactComposition: snapshot.exactComposition,
      exactConnection: snapshot.exactSourceConnection,
      exactLineage: snapshot.exactTransactionLineage,
      exactGeneration: snapshot.exactTransactionGeneration,
      exactSourceSummary: true as const,
      exactSourceEnvelope: true as const,
      exactReadSession: snapshot.exactReadSession,
    }),
    authority: Object.freeze({
      countProvenance: snapshot.countProvenance,
      nativeSourceProvenance: snapshot.nativeSourceProvenance,
      nativeProjectionAuthority: snapshot.nativeProjectionAuthority,
      genuineZeroClaim: snapshot.genuineZeroClaim,
      oneShot: snapshot.oneShot,
      sqlAuthority: snapshot.sqlAuthority,
      callerSuppliedCount: false as const,
      callerSuppliedProjection: false as const,
      physicalNativeIoCountClaimed: snapshot.physicalNativeIoCountClaimed,
    }),
    cleanup: Object.freeze({
      receiptMintCount: 1 as const,
      receiptConsumeCount: 1 as const,
      rollbackAttemptCount: 0 as const,
      closeAttemptCount: 0 as const,
      reopenAttemptCount: 0 as const,
      commitAttemptCount: 0 as const,
      primaryPreserved: true as const,
    }),
  });
  return Object.freeze({
    portable,
    runtimeLocal: Object.freeze({
      caseId,
      resourceCount: 12 as const,
      attemptCount: 12 as const,
      returnCount: 12 as const,
      orderedRawSqlSha256: Object.freeze(
        snapshot.familyRetirements.map((family) => family.sqlSha256),
      ),
    }),
  });
}

export function normalizeSQLiteCursorNativeProjectionRejectionCase(
  requestedProjectionCount: 0 | 1,
  error: unknown,
  owner: SQLiteCursorPublicationTransactionOwnerSnapshot,
): object {
  if (!(error instanceof CycleStoreProviderError)
      || error.code !== "GE_CYCLE_STORE_INVALID_ARGUMENT"
      || error.message !== "SQLite v1 baseline lower-owned source is invalid"
      || owner.lifecycle !== "finalized" || owner.rollbackAttemptCount !== 1
      || owner.closeAttemptCount !== 1 || owner.reopenAttemptCount !== 1
      || owner.commitAttemptCount !== 0) {
    throw new Error("SQLite NP1 rejection cleanup cannot be normalized");
  }
  return Object.freeze({
    caseId: requestedProjectionCount === 0
      ? "baseline-total-0-impossible" as const
      : "baseline-total-1-impossible" as const,
    outcome: "failure" as const,
    routeId: "main.baseline-entries" as const,
    requestedProjectionCount,
    failedStage: "pre-native-source-conservation" as const,
    retainedProjectionCount: null,
    projectionCanonicalSha256: null,
    logicalNativeReadCount: 0 as const,
    receiptMintCount: 0 as const,
    receiptConsumeCount: 0 as const,
    nativeProjectionAuthority: false as const,
    cleanup: Object.freeze({
      rollbackAttemptCount: owner.rollbackAttemptCount,
      closeAttemptCount: owner.closeAttemptCount,
      reopenAttemptCount: owner.reopenAttemptCount,
      commitAttemptCount: owner.commitAttemptCount,
      primaryPreserved: true as const,
    }),
  });
}

export function createSQLiteCursorNativeProjectionNormalizedReport(
  successCases: readonly Readonly<{ readonly portable: object; readonly runtimeLocal: object }>[],
  rejectionCases: readonly object[],
): SQLiteCursorNativeProjectionNormalizedReport {
  if (successCases.length !== 3 || rejectionCases.length !== 2) {
    throw new Error("SQLite NP1 report case inventory is incomplete");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    contractId: SQLITE_CURSOR_NATIVE_PROJECTION_NP1_CONTRACT_ID,
    implementation: "typescript" as const,
    portable: Object.freeze({
      successCases: Object.freeze(successCases.map((value) => value.portable)),
      rejectionCases: Object.freeze([...rejectionCases]),
      invariants: Object.freeze({
        mandatorySingletonCount: 3 as const,
        optionalDynamicCounts: Object.freeze([0, 1, 3]),
        completeProjectionCounts: Object.freeze([3, 4, 6]),
        sourceFamilyCount: 12 as const,
        genuineZeroClaim: false as const,
        physicalNativeIoCountClaimed: false as const,
        sqlAuthority: false as const,
        routeClosure: false as const,
        stage18Accepted: false as const,
        commitAttemptCount: 0 as const,
      }),
      nonclaims: Object.freeze([
        "global-native-route-closure",
        "arbitrary-sql-authority",
        "p11-a-completion",
        "p11-b-c-or-d",
        "stage-18-acceptance",
        "runtime-commit-execution",
        "release-evidence",
        "release-or-popularity",
      ]),
    }),
    runtimeLocal: Object.freeze({
      runtime: "typescript" as const,
      retirementMechanism: "native-iterator-return" as const,
      successCases: Object.freeze(successCases.map((value) => value.runtimeLocal)),
    }),
  });
}
