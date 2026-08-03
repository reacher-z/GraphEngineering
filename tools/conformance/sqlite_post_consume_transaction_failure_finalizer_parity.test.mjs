import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test, { before } from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const TS_REPORTER = join(
  ROOT,
  "tools/conformance/sqlite_post_consume_transaction_failure_finalizer_typescript_report.mjs",
);
const PY_REPORTER = join(
  ROOT,
  "tools/conformance/sqlite_post_consume_transaction_failure_finalizer_python_report.py",
);
const SCHEMA_VERSION = "sqlite-post-consume-transaction-failure-finalizer-parity/v1";
const BASELINE_DATA_DOMAIN =
  "graph-engineering/sqlite-post-consume-transaction-failure-finalizer-baseline-data/v1\0";
const BASELINE_DATA_SHA256 =
  "7844faec4246da8bbc86a74f5677117f04ac7f574e0bdc1eee5558dea8d0efce";
const CASE_IDS = ["both", "rollback-only", "close-only"];
const REPORT_FIELDS = ["schemaVersion", "runtime", "cases"];
const CASE_FIELDS = [
  "caseId",
  "stateTrace",
  "counts",
  "selectedThrow",
  "diagnosticCodes",
  "diagnostics",
  "claims",
  "reopenRecovery",
  "oldGraphPoisoned",
  "freshGraphSuccess",
];
const COUNT_FIELDS = [
  "ownerConsumeCount",
  "terminalizeCount",
  "rollbackAttemptCount",
  "rollbackNativeReturnCount",
  "rollbackAfterNativeReturnFaultCount",
  "rollbackSecondaryFailureCount",
  "closeAttemptCount",
  "closeNativeReturnCount",
  "closeAfterNativeReturnFaultCount",
  "closeTertiaryFailureCount",
];
const DIAGNOSTIC_FIELDS = ["code", "operation", "rank", "origin"];
const CLAIM_FIELDS = [
  "cleanupNeverReplacesPrimary",
  "driverNativeRollbackThrow",
  "driverNativeCloseThrow",
  "ownsBegin",
  "ownsCommit",
  "ownsRule12",
  "ownsSuccessPath",
];
const RECOVERY_FIELDS = [
  "applicationId",
  "userVersion",
  "currentVersion",
  "schemaIdentitySha256",
  "catalogSha256",
  "cursorCount",
  "operationCount",
  "v2ArtifactCount",
  "foreignKeyViolationCount",
  "integrityCheck",
  "baselineDataDomain",
  "baselineDataSha256",
];
const EXPECTED_RECOVERY = Object.freeze({
  applicationId: 1_195_724_359,
  userVersion: 1,
  currentVersion: 1,
  schemaIdentitySha256:
    "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
  catalogSha256:
    "8fab5049e2c9de5d114abc0c682934f1bc6fb5abd2e4c2e3ae55ef329c3e7264",
  cursorCount: 1,
  operationCount: 1,
  v2ArtifactCount: 0,
  foreignKeyViolationCount: 0,
  integrityCheck: "ok",
  baselineDataDomain: BASELINE_DATA_DOMAIN,
  baselineDataSha256: BASELINE_DATA_SHA256,
});
const PRIMARY = {
  code: "GE_SQLITE_POST_T_TERMINAL_PRIMARY",
  operation: "cursor-publication-rule-11",
  rank: "primary",
  origin: "authenticated-post-t-terminal-primary",
};
const ROLLBACK = {
  code: "GE_SQLITE_ROLLBACK_AFTER_NATIVE_RETURN",
  operation: "rollback",
  rank: "secondary",
  origin: "after-native-return-ambiguous-cleanup-fault",
};
const CLOSE = {
  code: "GE_SQLITE_CLOSE_AFTER_NATIVE_RETURN",
  operation: "close",
  rank: "tertiary",
  origin: "after-native-return-ambiguous-cleanup-fault",
};
const EXPECTED_DIAGNOSTICS = {
  both: [PRIMARY, ROLLBACK, CLOSE],
  "rollback-only": [PRIMARY, ROLLBACK],
  "close-only": [PRIMARY, CLOSE],
};

function exactKeys(value, expected, label) {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true,
    `${label} must be an object`);
  assert.deepEqual(Object.keys(value), expected, `${label} keys or key order drifted`);
}

function exactBit(value, expected, label) {
  assert.equal(Number.isSafeInteger(value), true, `${label} must be a safe integer`);
  assert.equal(value, expected, `${label} differs`);
}

function validateReport(value, runtime) {
  exactKeys(value, REPORT_FIELDS, `${runtime} report`);
  assert.equal(value.schemaVersion, SCHEMA_VERSION);
  assert.equal(value.runtime, runtime);
  assert.equal(Array.isArray(value.cases), true, `${runtime}.cases must be an array`);
  assert.equal(value.cases.length, CASE_IDS.length, `${runtime}.cases length drifted`);
  assert.deepEqual(value.cases.map((entry) => entry.caseId), CASE_IDS,
    `${runtime}.cases order or identity drifted`);
  for (const [index, entry] of value.cases.entries()) {
    const label = `${runtime}.cases[${index}]`;
    exactKeys(entry, CASE_FIELDS, label);
    assert.deepEqual(entry.stateTrace, ["prepared", "finalizing", "finalized"],
      `${label}.stateTrace drifted`);
    exactKeys(entry.counts, COUNT_FIELDS, `${label}.counts`);
    const rollback = entry.caseId !== "close-only" ? 1 : 0;
    const close = entry.caseId !== "rollback-only" ? 1 : 0;
    const expectedCounts = {
      ownerConsumeCount: 1,
      terminalizeCount: 1,
      rollbackAttemptCount: 1,
      rollbackNativeReturnCount: 1,
      rollbackAfterNativeReturnFaultCount: rollback,
      rollbackSecondaryFailureCount: rollback,
      closeAttemptCount: 1,
      closeNativeReturnCount: 1,
      closeAfterNativeReturnFaultCount: close,
      closeTertiaryFailureCount: close,
    };
    for (const field of COUNT_FIELDS) {
      exactBit(entry.counts[field], expectedCounts[field], `${label}.counts.${field}`);
    }
    assert.equal(entry.selectedThrow, PRIMARY.code, `${label}.selectedThrow drifted`);
    const diagnostics = EXPECTED_DIAGNOSTICS[entry.caseId];
    assert.deepEqual(entry.diagnosticCodes, diagnostics.map((value_) => value_.code),
      `${label}.diagnosticCodes drifted`);
    assert.equal(Array.isArray(entry.diagnostics), true, `${label}.diagnostics must be an array`);
    entry.diagnostics.forEach((diagnostic, diagnosticIndex) =>
      exactKeys(diagnostic, DIAGNOSTIC_FIELDS,
        `${label}.diagnostics[${diagnosticIndex}]`));
    assert.deepEqual(entry.diagnostics, diagnostics, `${label}.diagnostics drifted`);
    exactKeys(entry.claims, CLAIM_FIELDS, `${label}.claims`);
    assert.deepEqual(entry.claims, {
      cleanupNeverReplacesPrimary: true,
      driverNativeRollbackThrow: false,
      driverNativeCloseThrow: false,
      ownsBegin: false,
      ownsCommit: false,
      ownsRule12: false,
      ownsSuccessPath: false,
    }, `${label}.claims drifted`);
    exactKeys(entry.reopenRecovery, RECOVERY_FIELDS, `${label}.reopenRecovery`);
    assert.deepEqual(entry.reopenRecovery, EXPECTED_RECOVERY,
      `${label}.reopenRecovery exact portable evidence drifted`);
    assert.equal(entry.oldGraphPoisoned, true, `${label}.oldGraphPoisoned differs`);
    assert.equal(entry.freshGraphSuccess, true, `${label}.freshGraphSuccess differs`);
  }
  return value;
}

function childFailure(label, child) {
  return new Error([
    `${label} failed: status=${String(child.status)} signal=${String(child.signal)}`,
    child.error?.message ?? "",
    child.stdout,
    child.stderr,
  ].filter(Boolean).join("\n"));
}

function runReporter(label, command, arguments_, runtime) {
  const child = spawnSync(command, arguments_, {
    cwd: ROOT,
    detached: process.platform !== "win32",
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  if (child.error !== undefined || child.status !== 0 || child.signal !== null) {
    throw childFailure(label, child);
  }
  assert.equal(child.stderr, "", `${label} wrote unexpected stderr`);
  const parsed = JSON.parse(child.stdout);
  assert.equal(child.stdout, `${JSON.stringify(parsed)}\n`,
    `${label} did not emit one deterministic compact JSON value`);
  return { parsed: validateReport(parsed, runtime), stdout: child.stdout };
}

before(() => {
  const child = spawnSync("corepack", [
    "pnpm", "--filter", "@graph-engineering/sqlite", "build",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  if (child.error !== undefined || child.status !== 0 || child.signal !== null) {
    throw childFailure("TypeScript SQLite source build", child);
  }
});

function runtimeNeutralBytes(report) {
  return JSON.stringify({ ...report, runtime: "runtime-neutral" });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("real SQLite post-consume transaction finalizer is byte-exact across runtimes", {
  timeout: 10 * 60_000,
}, () => {
  const tsFirst = runReporter("TypeScript finalizer reporter", process.execPath,
    ["--no-warnings", TS_REPORTER], "typescript");
  const tsSecond = runReporter("TypeScript finalizer reporter repeat", process.execPath,
    ["--no-warnings", TS_REPORTER], "typescript");
  const pyFirst = runReporter("Python finalizer reporter", "uv",
    ["run", "--project", "python", "python", PY_REPORTER], "python");
  const pySecond = runReporter("Python finalizer reporter repeat", "uv",
    ["run", "--project", "python", "python", PY_REPORTER], "python");
  assert.equal(tsFirst.stdout, tsSecond.stdout,
    "TypeScript reporter was not deterministic across two real-SQLite runs");
  assert.equal(pyFirst.stdout, pySecond.stdout,
    "Python reporter was not deterministic across two real-SQLite runs");
  assert.equal(runtimeNeutralBytes(tsFirst.parsed), runtimeNeutralBytes(pyFirst.parsed),
    "identity-neutral finalizer projections differ across runtimes");

  const hostile = [
    (report) => { report.cases[0].unknown = true; },
    (report) => { report.cases.reverse(); },
    (report) => { report.cases[0].counts.ownerConsumeCount = Number.MAX_SAFE_INTEGER + 1; },
    (report) => { report.cases[0].counts.closeAttemptCount = 0; },
    (report) => { report.cases[0].diagnostics.reverse(); },
    (report) => { report.cases[0].claims.ownsCommit = true; },
    (report) => { report.cases[0].reopenRecovery.unknown = true; },
    (report) => { delete report.cases[0].reopenRecovery.catalogSha256; },
  ];
  for (const field of RECOVERY_FIELDS) {
    hostile.push((report) => {
      const value = report.cases[0].reopenRecovery[field];
      report.cases[0].reopenRecovery[field] = typeof value === "number"
        ? value + 1
        : `${value}-hostile`;
    });
    hostile.push((report) => {
      report.cases[0].reopenRecovery[field] = null;
    });
  }
  for (const mutate of hostile) {
    const report = clone(tsFirst.parsed);
    mutate(report);
    assert.throws(() => validateReport(report, "typescript"),
      "hostile comparator mutation was accepted");
  }
});
