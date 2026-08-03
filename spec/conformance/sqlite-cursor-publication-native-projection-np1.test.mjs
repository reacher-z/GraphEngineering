import assert from "node:assert/strict";
import test from "node:test";

import {
  NP1_FAMILY_ORDER,
  NP1_NORMALIZED_SQL_SHA256,
  SQLiteNativeProjectionReportError,
  assertSQLiteNativeProjectionPortableParity,
  canonicalReportJson,
  validateSQLiteNativeProjectionReport,
} from "./sqlite-cursor-publication-native-projection-np1.validate.mjs";

const sha = (digit) => digit.repeat(64);
const normalizedSql = NP1_NORMALIZED_SQL_SHA256;
const rawSql = Object.freeze(
  NP1_FAMILY_ORDER.map((_family, index) => sha(((index + 4) % 10).toString())),
);

function familyCounts(optionalDynamicCount) {
  return NP1_FAMILY_ORDER.map((entryKind, index) => ({
    entryKind,
    count: index === 0 || index === 1 || index === 9
      ? 1
      : index === 11 ? optionalDynamicCount : 0,
  }));
}

function successCase(optionalDynamicCount, total, projectionDigit) {
  const caseId = `baseline-dynamic-${optionalDynamicCount}-total-${total}`;
  const expectedFamilyCounts = familyCounts(optionalDynamicCount);
  return {
    caseId,
    outcome: "success",
    routeId: "main.baseline-entries",
    sourceFamilyCount: 12,
    optionalDynamicCount,
    orderedNormalizedSqlSha256: [...normalizedSql],
    expectedFamilyCounts,
    observedFamilyCounts: structuredClone(expectedFamilyCounts),
    expectedProjectionCount: total,
    retainedProjectionCount: total,
    sourceEnvelopeSha256: sha("a"),
    projectionCanonicalSha256: sha(projectionDigit),
    logicalNativeReadCount: 12,
    prepareCount: 12,
    terminalObservationCount: 12,
    decodeCount: total,
    resourceRetirement: {
      normalized: "complete",
      resourceCount: 12,
      attemptCount: 12,
      returnCount: 12,
      exactPairing: true,
    },
    receiptLifecycle: {
      state: "consumed",
      mintCount: 1,
      consumeCount: 1,
      replayRejected: true,
    },
    bindings: {
      exactOwner: true,
      exactBeginReceipt: true,
      exactComposition: true,
      exactConnection: true,
      exactLineage: true,
      exactGeneration: true,
      exactSourceSummary: true,
      exactSourceEnvelope: true,
      exactReadSession: true,
    },
    authority: {
      countProvenance: "lower-native",
      nativeSourceProvenance: true,
      nativeProjectionAuthority: true,
      genuineZeroClaim: false,
      oneShot: true,
      sqlAuthority: false,
      callerSuppliedCount: false,
      callerSuppliedProjection: false,
      physicalNativeIoCountClaimed: false,
    },
    cleanup: {
      receiptMintCount: 1,
      receiptConsumeCount: 1,
      rollbackAttemptCount: 0,
      closeAttemptCount: 0,
      reopenAttemptCount: 0,
      commitAttemptCount: 0,
      primaryPreserved: true,
    },
  };
}

function rejectionCase(requestedProjectionCount) {
  return {
    caseId: `baseline-total-${requestedProjectionCount}-impossible`,
    outcome: "failure",
    routeId: "main.baseline-entries",
    requestedProjectionCount,
    failedStage: "pre-native-source-conservation",
    retainedProjectionCount: null,
    projectionCanonicalSha256: null,
    logicalNativeReadCount: 0,
    receiptMintCount: 0,
    receiptConsumeCount: 0,
    nativeProjectionAuthority: false,
    cleanup: {
      rollbackAttemptCount: 1,
      closeAttemptCount: 1,
      reopenAttemptCount: 1,
      commitAttemptCount: 0,
      primaryPreserved: true,
    },
  };
}

function report(implementation = "typescript") {
  const successCases = [
    successCase(0, 3, "1"),
    successCase(1, 4, "2"),
    successCase(3, 6, "3"),
  ];
  return {
    schemaVersion: 1,
    contractId: "sqlite-cursor-publication-native-projection-np1/v1",
    implementation,
    portable: {
      successCases,
      rejectionCases: [rejectionCase(0), rejectionCase(1)],
      invariants: {
        mandatorySingletonCount: 3,
        optionalDynamicCounts: [0, 1, 3],
        completeProjectionCounts: [3, 4, 6],
        sourceFamilyCount: 12,
        genuineZeroClaim: false,
        physicalNativeIoCountClaimed: false,
        sqlAuthority: false,
        routeClosure: false,
        stage18Accepted: false,
        commitAttemptCount: 0,
      },
      nonclaims: [
        "global-native-route-closure",
        "arbitrary-sql-authority",
        "p11-a-completion",
        "p11-b-c-or-d",
        "stage-18-acceptance",
        "runtime-commit-execution",
        "release-evidence",
        "release-or-popularity",
      ],
    },
    runtimeLocal: {
      runtime: implementation,
      retirementMechanism: implementation === "typescript"
        ? "native-iterator-return"
        : "cursor-close",
      successCases: successCases.map(({ caseId }) => ({
        caseId,
        resourceCount: 12,
        attemptCount: 12,
        returnCount: 12,
        orderedRawSqlSha256: [...rawSql],
      })),
    },
  };
}

function assertCode(code, action) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof SQLiteNativeProjectionReportError);
    assert.equal(error.code, code);
    return true;
  });
}

test("accepts strict TypeScript and Python reports and proves portable parity", () => {
  const typescript = report();
  const python = report("python");
  assert.equal(validateSQLiteNativeProjectionReport(typescript), typescript);
  assert.equal(validateSQLiteNativeProjectionReport(python), python);
  assert.deepEqual(assertSQLiteNativeProjectionPortableParity(typescript, python), {
    portableBytes: Buffer.byteLength(canonicalReportJson(typescript.portable)),
    successCaseCount: 3,
    rejectionCaseCount: 2,
  });
});

test("schema rejects claims, missing retirement evidence, and extra fields", () => {
  for (const mutate of [
    (value) => { value.portable.successCases[0].authority.sqlAuthority = true; },
    (value) => { delete value.runtimeLocal.successCases[0].orderedRawSqlSha256; },
    (value) => { value.portable.successCases[0].callerProjection = []; },
  ]) {
    const candidate = report();
    mutate(candidate);
    assertCode("GE_SQLITE_P11_NP1_REPORT_SCHEMA", () => {
      validateSQLiteNativeProjectionReport(candidate);
    });
  }
});

test("semantic validation rejects reordered cases, families, and count drift", () => {
  for (const mutate of [
    (value) => { value.portable.successCases.reverse(); },
    (value) => { value.portable.successCases[0].expectedFamilyCounts.reverse(); },
    (value) => { value.portable.successCases[2].expectedFamilyCounts[11].count = 2; },
    (value) => { value.portable.successCases[1].sourceEnvelopeSha256 = sha("b"); },
    (value) => {
      for (const entry of value.portable.successCases) {
        entry.orderedNormalizedSqlSha256[0] = sha("f");
      }
    },
    (value) => { value.runtimeLocal.successCases[1].orderedRawSqlSha256[0] = sha("f"); },
  ]) {
    const candidate = report();
    mutate(candidate);
    assertCode("GE_SQLITE_P11_NP1_REPORT_SEMANTICS", () => {
      validateSQLiteNativeProjectionReport(candidate);
    });
  }
});

test("runtime label and mechanism are inseparable", () => {
  const candidate = report("python");
  candidate.runtimeLocal.runtime = "typescript";
  assertCode("GE_SQLITE_P11_NP1_REPORT_SCHEMA", () => {
    validateSQLiteNativeProjectionReport(candidate);
  });
});

test("zero and one are negative total-projection cases, never successes", () => {
  for (const mutate of [
    (value) => { value.portable.rejectionCases[0].requestedProjectionCount = 1; },
    (value) => { value.portable.rejectionCases[1].receiptMintCount = 1; },
    (value) => { value.portable.rejectionCases[0].cleanup.commitAttemptCount = 1; },
  ]) {
    const candidate = report();
    mutate(candidate);
    const code = mutate.toString().includes("requestedProjectionCount")
      ? "GE_SQLITE_P11_NP1_REPORT_SEMANTICS"
      : "GE_SQLITE_P11_NP1_REPORT_SCHEMA";
    assertCode(code, () => validateSQLiteNativeProjectionReport(candidate));
  }
});

test("portable parity rejects a valid implementation-specific divergence", () => {
  const typescript = report();
  const python = report("python");
  python.portable.successCases[2].projectionCanonicalSha256 = sha("4");
  assertCode("GE_SQLITE_P11_NP1_REPORT_PARITY", () => {
    assertSQLiteNativeProjectionPortableParity(typescript, python);
  });
});
