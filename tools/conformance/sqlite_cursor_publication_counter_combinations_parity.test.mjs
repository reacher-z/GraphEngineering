import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test, { before } from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const TS_REPORTER = join(
  ROOT,
  "tools/conformance/sqlite_cursor_publication_counter_combinations_typescript_report.mjs",
);
const PY_REPORTER = join(
  ROOT,
  "tools/conformance/sqlite_cursor_publication_counter_combinations_python_report.py",
);
const SCHEMA_VERSION = "sqlite-cursor-publication-counter-combinations-parity/v1";
const COUNT_FIELDS = [
  "b2CursorCount",
  "nativeAffectedCount",
  "changesAffectedCount",
  "totalChangesDelta",
  "cursorLedgerAffectedDelta",
];
const MUTABLE_COUNT_FIELDS = COUNT_FIELDS.slice(1);
const FIELD_SLUGS = {
  nativeAffectedCount: "native",
  changesAffectedCount: "changes",
  totalChangesDelta: "total",
  cursorLedgerAffectedDelta: "cursor-ledger",
};
const LEDGER_FIELDS = [
  "logicalWriteSequence",
  "fixedStatementCount",
  "affectedRowsWatermark",
];
const LEDGER_TRANSITION_FIELDS = ["before", "after", "delta"];
const REPORT_FIELDS = [
  "schemaVersion",
  "runtime",
  "authenticBaseline",
  "realTriggerAmplification",
  "checkerCombinationCases",
  "nonclaims",
  "claims",
];
const BASELINE_FIELDS = [
  "caseId",
  "population",
  "counts",
  "outerLedger",
  "cursorLedger",
  "checker",
  "lifecycle",
];
const TRIGGER_FIELDS = [
  "caseId",
  "population",
  "counts",
  "outerLedger",
  "cursorLedger",
  "disagreementEdges",
  "primaryBoundary",
  "lifecycle",
  "finalizer",
  "reopenRecovery",
];
const CHECKER_FIELDS = ["accepted", "violationCount", "diagnosticsTruncated"];
const BASELINE_LIFECYCLE_FIELDS = ["execution", "write", "rule11"];
const TRIGGER_LIFECYCLE_FIELDS = [
  "authority",
  "context",
  "execution",
  "adoptionMinted",
];
const FINALIZER_FIELDS = [
  "primaryPreserved",
  "stateTrace",
  "selectedThrow",
  "diagnosticCodes",
  "rollbackAttemptCount",
  "closeAttemptCount",
];
const RECOVERY_FIELDS = [
  "cursorCount",
  "operationCount",
  "v2ArtifactCount",
  "foreignKeyViolationCount",
  "integrityCheck",
];
const COMBINATION_FIELDS = [
  "caseId",
  "corruptedDimensions",
  "input",
  "result",
  "seam",
];
const NONCLAIM_FIELDS = ["caseFamily", "reason"];
const CLAIM_FIELDS = [
  "realTriggerAmplificationIsNativeObservation",
  "checkerInputsDerivedFromAuthenticRealSQLiteEvidence",
  "checkerCombinationCasesAreNativeObservations",
  "outerLedgerCombinationCoverage",
  "runtimeLocalObservationSeamsCovered",
];
const EXPECTED_NONCLAIMS = [
  {
    caseFamily: "outer-ledger-pair-and-multi-corruption",
    reason: "outer-ledger-is-private-authority-state-without-a-common-post-t-native-seam",
  },
  {
    caseFamily: "independent-native-changes-observation-corruption",
    reason: "runtime-local-native-result-or-changes-proof-injection-is-required",
  },
  {
    caseFamily: "independent-native-cursor-ledger-corruption",
    reason: "cursor-ledger-affected-is-captured-from-the-same-native-result",
  },
  {
    caseFamily: "independent-changes-cursor-ledger-corruption",
    reason: "runtime-local-state-or-driver-injection-is-required",
  },
  {
    caseFamily: "driver-native-result-shape-and-throw-combinations",
    reason: "no-common-driver-native-fault-adapter-is-available",
  },
];
const EXPECTED_CLAIMS = {
  realTriggerAmplificationIsNativeObservation: true,
  checkerInputsDerivedFromAuthenticRealSQLiteEvidence: true,
  checkerCombinationCasesAreNativeObservations: false,
  outerLedgerCombinationCoverage: false,
  runtimeLocalObservationSeamsCovered: false,
};
const ZERO_LEDGER = {
  logicalWriteSequence: 0,
  fixedStatementCount: 0,
  affectedRowsWatermark: 0,
};
const OUTER_LEDGER = {
  logicalWriteSequence: 4,
  fixedStatementCount: 27,
  affectedRowsWatermark: 9,
};
const CURSOR_LEDGER = {
  logicalWriteSequence: 1,
  fixedStatementCount: 1,
  affectedRowsWatermark: 1,
};
const EQUAL_COUNTS = {
  b2CursorCount: 1,
  nativeAffectedCount: 1,
  changesAffectedCount: 1,
  totalChangesDelta: 1,
  cursorLedgerAffectedDelta: 1,
};
const TRIGGER_COUNTS = { ...EQUAL_COUNTS, totalChangesDelta: 2 };
const DISAGREEMENT_EDGES = [
  "nativeAffectedCount!=totalChangesDelta",
  "changesAffectedCount!=totalChangesDelta",
  "totalChangesDelta!=cursorLedgerAffectedDelta",
];

function combinations(values, size, start = 0, prefix = []) {
  if (prefix.length === size) return [prefix];
  const result = [];
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    result.push(...combinations(values, size, index + 1, [...prefix, values[index]]));
  }
  return result;
}

const EXPECTED_SUBSETS = [2, 3, 4]
  .flatMap((size) => combinations(MUTABLE_COUNT_FIELDS, size));

function exactKeys(value, expected, label) {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true,
    `${label} must be an object`);
  assert.deepEqual(Object.keys(value), expected, `${label} keys or key order drifted`);
}

function exactSafeInteger(value, expected, label) {
  assert.equal(Number.isSafeInteger(value) && value >= 0, true,
    `${label} must be a non-negative safe integer`);
  assert.equal(value, expected, `${label} differs`);
}

function validateCounts(value, expected, label) {
  exactKeys(value, COUNT_FIELDS, label);
  for (const field of COUNT_FIELDS) {
    exactSafeInteger(value[field], expected[field], `${label}.${field}`);
  }
}

function validateLedger(value, expected, label) {
  exactKeys(value, LEDGER_FIELDS, label);
  for (const field of LEDGER_FIELDS) {
    exactSafeInteger(value[field], expected[field], `${label}.${field}`);
  }
}

function validateLedgerTransition(value, before, after, delta, label) {
  exactKeys(value, LEDGER_TRANSITION_FIELDS, label);
  validateLedger(value.before, before, `${label}.before`);
  validateLedger(value.after, after, `${label}.after`);
  validateLedger(value.delta, delta, `${label}.delta`);
}

function validateChecker(value, expectedAccepted, expectedViolations, label) {
  exactKeys(value, CHECKER_FIELDS, label);
  assert.equal(value.accepted, expectedAccepted, `${label}.accepted differs`);
  exactSafeInteger(value.violationCount, expectedViolations,
    `${label}.violationCount`);
  assert.equal(value.diagnosticsTruncated, false,
    `${label}.diagnosticsTruncated differs`);
}

function validateBaseline(value) {
  exactKeys(value, BASELINE_FIELDS, "authenticBaseline");
  assert.equal(value.caseId, "authentic-success-n1");
  exactSafeInteger(value.population, 1, "authenticBaseline.population");
  validateCounts(value.counts, EQUAL_COUNTS, "authenticBaseline.counts");
  validateLedgerTransition(
    value.outerLedger,
    OUTER_LEDGER,
    OUTER_LEDGER,
    ZERO_LEDGER,
    "authenticBaseline.outerLedger",
  );
  validateLedgerTransition(
    value.cursorLedger,
    ZERO_LEDGER,
    CURSOR_LEDGER,
    CURSOR_LEDGER,
    "authenticBaseline.cursorLedger",
  );
  validateChecker(value.checker, true, 0, "authenticBaseline.checker");
  exactKeys(value.lifecycle, BASELINE_LIFECYCLE_FIELDS, "authenticBaseline.lifecycle");
  assert.deepEqual(value.lifecycle, {
    execution: "completed",
    write: "rule11-complete",
    rule11: "active",
  });
}

function validateTrigger(value) {
  exactKeys(value, TRIGGER_FIELDS, "realTriggerAmplification");
  assert.equal(value.caseId, "real-trigger-amplification-n1-k1");
  exactSafeInteger(value.population, 1, "realTriggerAmplification.population");
  validateCounts(value.counts, TRIGGER_COUNTS, "realTriggerAmplification.counts");
  validateLedgerTransition(
    value.outerLedger,
    OUTER_LEDGER,
    OUTER_LEDGER,
    ZERO_LEDGER,
    "realTriggerAmplification.outerLedger",
  );
  validateLedgerTransition(
    value.cursorLedger,
    ZERO_LEDGER,
    CURSOR_LEDGER,
    CURSOR_LEDGER,
    "realTriggerAmplification.cursorLedger",
  );
  assert.deepEqual(value.disagreementEdges, DISAGREEMENT_EDGES,
    "realTriggerAmplification.disagreementEdges drifted");
  assert.equal(value.primaryBoundary, "changes-postflight");
  exactKeys(value.lifecycle, TRIGGER_LIFECYCLE_FIELDS,
    "realTriggerAmplification.lifecycle");
  assert.deepEqual(value.lifecycle, {
    authority: "poisoned",
    context: "poisoned",
    execution: "poisoned",
    adoptionMinted: false,
  });
  exactKeys(value.finalizer, FINALIZER_FIELDS, "realTriggerAmplification.finalizer");
  assert.deepEqual(value.finalizer, {
    primaryPreserved: true,
    stateTrace: ["prepared", "finalizing", "finalized"],
    selectedThrow: "GE_SQLITE_POST_T_TERMINAL_PRIMARY",
    diagnosticCodes: ["GE_SQLITE_POST_T_TERMINAL_PRIMARY"],
    rollbackAttemptCount: 1,
    closeAttemptCount: 1,
  });
  exactKeys(value.reopenRecovery, RECOVERY_FIELDS,
    "realTriggerAmplification.reopenRecovery");
  assert.deepEqual(value.reopenRecovery, {
    cursorCount: 1,
    operationCount: 1,
    v2ArtifactCount: 0,
    foreignKeyViolationCount: 0,
    integrityCheck: "ok",
  });
}

function validateCombinationCases(values) {
  assert.equal(Array.isArray(values), true, "checkerCombinationCases must be an array");
  assert.equal(values.length, EXPECTED_SUBSETS.length,
    "checkerCombinationCases length drifted");
  for (const [index, entry] of values.entries()) {
    const subset = EXPECTED_SUBSETS[index];
    const label = `checkerCombinationCases[${index}]`;
    exactKeys(entry, COMBINATION_FIELDS, label);
    assert.equal(entry.caseId,
      `checker-${subset.length}-way-${subset.map((field) => FIELD_SLUGS[field]).join("+")}`,
    `${label}.caseId drifted`);
    assert.deepEqual(entry.corruptedDimensions, subset,
      `${label}.corruptedDimensions drifted`);
    const expectedInput = { ...EQUAL_COUNTS };
    for (const field of subset) expectedInput[field] += 1;
    validateCounts(entry.input, expectedInput, `${label}.input`);
    validateChecker(entry.result, false, 1, `${label}.result`);
    assert.equal(entry.seam, "post-real-sqlite-rule11-pure-checker",
      `${label}.seam drifted`);
  }
}

function validateReport(value, runtime) {
  exactKeys(value, REPORT_FIELDS, `${runtime} report`);
  assert.equal(value.schemaVersion, SCHEMA_VERSION);
  assert.equal(value.runtime, runtime);
  validateBaseline(value.authenticBaseline);
  validateTrigger(value.realTriggerAmplification);
  validateCombinationCases(value.checkerCombinationCases);
  assert.equal(Array.isArray(value.nonclaims), true, "nonclaims must be an array");
  value.nonclaims.forEach((entry, index) =>
    exactKeys(entry, NONCLAIM_FIELDS, `nonclaims[${index}]`));
  assert.deepEqual(value.nonclaims, EXPECTED_NONCLAIMS, "nonclaims drifted");
  exactKeys(value.claims, CLAIM_FIELDS, "claims");
  assert.deepEqual(value.claims, EXPECTED_CLAIMS, "claims drifted");
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

function runtimeNeutralBytes(report) {
  return JSON.stringify({ ...report, runtime: "runtime-neutral" });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hostileMutations() {
  const mutations = [
    (report) => { report.unknown = true; },
    (report) => { report.schemaVersion = `${SCHEMA_VERSION}-hostile`; },
    (report) => { report.authenticBaseline.population = Number.MAX_SAFE_INTEGER + 1; },
    (report) => { report.authenticBaseline.caseId = "hostile"; },
    (report) => { report.authenticBaseline.lifecycle.execution = "poisoned"; },
    (report) => { report.authenticBaseline.checker.accepted = false; },
    (report) => { report.realTriggerAmplification.caseId = "hostile"; },
    (report) => { report.realTriggerAmplification.disagreementEdges.reverse(); },
    (report) => { report.realTriggerAmplification.primaryBoundary = "native-execute"; },
    (report) => { report.realTriggerAmplification.lifecycle.adoptionMinted = true; },
    (report) => { report.realTriggerAmplification.finalizer.primaryPreserved = false; },
    (report) => { report.realTriggerAmplification.finalizer.stateTrace.reverse(); },
    (report) => { report.checkerCombinationCases.reverse(); },
    (report) => { report.checkerCombinationCases[0].corruptedDimensions.reverse(); },
    (report) => { report.checkerCombinationCases[0].caseId = "hostile"; },
    (report) => { report.checkerCombinationCases[0].result.accepted = true; },
    (report) => { report.checkerCombinationCases[0].seam = "native-observation"; },
    (report) => { report.nonclaims.reverse(); },
    (report) => { report.nonclaims[0].reason = "hostile"; },
    (report) => { report.claims.checkerCombinationCasesAreNativeObservations = true; },
  ];
  for (const section of ["authenticBaseline", "realTriggerAmplification"]) {
    for (const field of COUNT_FIELDS) {
      mutations.push((report) => { report[section].counts[field] += 1; });
      mutations.push((report) => { report[section].counts[field] = null; });
    }
    for (const ledgerName of ["outerLedger", "cursorLedger"]) {
      for (const transition of LEDGER_TRANSITION_FIELDS) {
        for (const field of LEDGER_FIELDS) {
          mutations.push((report) => {
            report[section][ledgerName][transition][field] += 1;
          });
        }
      }
    }
  }
  for (const field of CLAIM_FIELDS) {
    mutations.push((report) => { report.claims[field] = !report.claims[field]; });
  }
  for (const field of RECOVERY_FIELDS) {
    mutations.push((report) => {
      const value = report.realTriggerAmplification.reopenRecovery[field];
      report.realTriggerAmplification.reopenRecovery[field] = typeof value === "number"
        ? value + 1
        : `${value}-hostile`;
    });
    mutations.push((report) => {
      report.realTriggerAmplification.reopenRecovery[field] = null;
    });
  }
  mutations.push((report) => {
    const { schemaVersion, ...rest } = report;
    Object.keys(report).forEach((key) => { delete report[key]; });
    Object.assign(report, rest, { schemaVersion });
  });
  return mutations;
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

test("counter-combination reporter sources are isolated from tests and fixture oracles", () => {
  const sources = [
    [TS_REPORTER, readFileSync(TS_REPORTER, "utf8")],
    [PY_REPORTER, readFileSync(PY_REPORTER, "utf8")],
  ];
  for (const [path, source] of sources) {
    assert.doesNotMatch(source, /(?:^|["'/])tests?(?:["'/]|$)/mu,
      `${path} imported test code`);
    assert.doesNotMatch(source, /\.case\.json|sqlite-cursor-publication-rebind-v2/u,
      `${path} imported a fixture oracle`);
  }
  assert.doesNotMatch(sources[0][1], /python_report/u);
  assert.doesNotMatch(sources[1][1], /typescript_report/u);
});

test("counter-combination comparator rejects hostile canonical projections", () => {
  const child = spawnSync(process.execPath, ["--no-warnings", TS_REPORTER], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  if (child.error !== undefined || child.status !== 0 || child.signal !== null) {
    throw childFailure("TypeScript counter-combination reporter", child);
  }
  const authentic = validateReport(JSON.parse(child.stdout), "typescript");
  for (const mutate of hostileMutations()) {
    const hostile = clone(authentic);
    mutate(hostile);
    assert.throws(() => validateReport(hostile, "typescript"),
      "hostile counter-combination projection was accepted");
  }
});

test("real-SQLite counter combinations are deterministic and byte-exact across runtimes", {
  timeout: 10 * 60_000,
}, () => {
  const tsFirst = runReporter("TypeScript counter-combination reporter", process.execPath,
    ["--no-warnings", TS_REPORTER], "typescript");
  const tsSecond = runReporter(
    "TypeScript counter-combination reporter repeat",
    process.execPath,
    ["--no-warnings", TS_REPORTER],
    "typescript",
  );
  const pyFirst = runReporter("Python counter-combination reporter", "uv", [
    "run", "--project", "python", "python", PY_REPORTER,
  ], "python");
  const pySecond = runReporter("Python counter-combination reporter repeat", "uv", [
    "run", "--project", "python", "python", PY_REPORTER,
  ], "python");
  assert.equal(tsFirst.stdout, tsSecond.stdout,
    "TypeScript counter-combination reporter was not deterministic");
  assert.equal(pyFirst.stdout, pySecond.stdout,
    "Python counter-combination reporter was not deterministic");
  assert.equal(runtimeNeutralBytes(tsFirst.parsed), runtimeNeutralBytes(pyFirst.parsed),
    "runtime-neutral counter-combination projections differ");
});
