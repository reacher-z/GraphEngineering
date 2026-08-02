import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const TS_REPORTER = join(
  ROOT,
  "tools/conformance/sqlite_cursor_publication_rule11_typescript_report.mjs",
);
const PY_REPORTER = join(
  ROOT,
  "tools/conformance/sqlite_cursor_publication_rule11_python_report.py",
);
const SCHEMA_VERSION = "sqlite-cursor-publication-rule11-parity/v2";
const REBIND_SQL_SHA256 = "6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91";
const CHANGES_SQL_SHA256 = "a6ab435eb54879f942436129997f231de19504b11028b55b014fddc2bb42e112";

const REPORT_FIELDS = ["schemaVersion", "runtime", "successes", "failures"];
const SUCCESS_FIELDS = [
  "caseId",
  "cursorCount",
  "sql",
  "sqlSha256",
  "changesSql",
  "changesSqlSha256",
  "parameterSha256",
  "epochDelta",
  "totalDelta",
  "counts",
  "cursorLedgerLogicalWriteDelta",
  "cursorLedgerFixedStatementDelta",
  "outerLedgerUnchanged",
  "sameIdentity",
  "lifecycle",
  "consumeMint",
];
const COUNT_FIELDS = [
  "b2CursorCount",
  "nativeAffectedCount",
  "changesAffectedCount",
  "totalChangesDelta",
  "cursorLedgerAffectedDelta",
];
const IDENTITY_FIELDS = [
  "session",
  "preparedOwner",
  "context",
  "tombstone",
  "adoption",
];
const LIFECYCLE_FIELDS = ["session", "context", "tombstone", "adoption", "write", "rule11"];
const CONSUME_MINT_FIELDS = [
  "writePrepareCount",
  "writeExecuteCount",
  "writeReleaseCount",
  "changesPrepareCount",
  "changesFetchCount",
  "changesReleaseCount",
  "rule11ViolationCount",
  "diagnosticsTruncated",
];
const FAILURE_FIELDS = Object.freeze({
  "pre-cancel": [
    "caseId",
    "outcome",
    "selectedGraphPoisoned",
    "sameSessionRetrySucceeded",
  ],
  "forged-cancel": [
    "caseId",
    "outcome",
    "invalidPresentationPrecedesCancellation",
    "graphSelected",
  ],
  "replay-poison": [
    "caseId",
    "outcome",
    "selectedGraphPoisoned",
    "replayRejected",
    "receiptReadableAfterPoison",
  ],
  "preconsume-release": [
    "caseId",
    "outcome",
    "primaryIdentityPreserved",
    "selectedGraphPoisoned",
    "sessionConsumed",
    "contextLifecycle",
    "executionLifecycle",
    "executeCount",
    "releaseCount",
    "replayRejected",
  ],
});

function exactKeys(value, expected, label) {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true,
    `${label} must be an object`);
  assert.deepEqual(Object.keys(value), expected, `${label} keys or key order drifted`);
}

function exactSafeInteger(value, expected, label) {
  assert.equal(Number.isSafeInteger(value), true, `${label} must be a safe integer`);
  assert.equal(value, expected, `${label} differs`);
}

function validateCounts(value, cursorCount, label) {
  exactKeys(value, COUNT_FIELDS, label);
  for (const field of COUNT_FIELDS) {
    exactSafeInteger(value[field], cursorCount, `${label}.${field}`);
  }
}

function validateConsumeMint(value, label) {
  exactKeys(value, CONSUME_MINT_FIELDS, label);
  const expected = {
    writePrepareCount: 1,
    writeExecuteCount: 1,
    writeReleaseCount: 1,
    changesPrepareCount: 1,
    changesFetchCount: 1,
    changesReleaseCount: 1,
    rule11ViolationCount: 0,
  };
  for (const [field, count] of Object.entries(expected)) {
    exactSafeInteger(value[field], count, `${label}.${field}`);
  }
  assert.equal(value.diagnosticsTruncated, false, `${label}.diagnosticsTruncated differs`);
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function validateSuccess(value, cursorCount, index) {
  const label = `successes[${index}]`;
  exactKeys(value, SUCCESS_FIELDS, label);
  assert.equal(value.caseId, `success-n${cursorCount}`);
  exactSafeInteger(value.cursorCount, cursorCount, `${label}.cursorCount`);
  assert.equal(value.sql,
    "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, schema_identity_sha256 = ? "
      + "WHERE descriptor_hash = ? AND schema_identity_sha256 = ?");
  assert.equal(value.sqlSha256, REBIND_SQL_SHA256);
  assert.equal(value.sqlSha256, sha256(value.sql), `${label}.sqlSha256 is not derived from SQL`);
  assert.equal(value.changesSql, "SELECT changes() AS affected_rows");
  assert.equal(value.changesSqlSha256, CHANGES_SQL_SHA256);
  assert.equal(value.changesSqlSha256, sha256(value.changesSql),
    `${label}.changesSqlSha256 is not derived from changes SQL`);
  assert.equal(value.parameterSha256,
    "524ece2b423a16fe16cf147e4918f74029ec71bd1559a65a2e7e2710a73ef37f");
  exactSafeInteger(value.epochDelta, 1, `${label}.epochDelta`);
  exactSafeInteger(value.totalDelta, cursorCount, `${label}.totalDelta`);
  validateCounts(value.counts, cursorCount, `${label}.counts`);
  exactSafeInteger(value.cursorLedgerLogicalWriteDelta, 1,
    `${label}.cursorLedgerLogicalWriteDelta`);
  exactSafeInteger(value.cursorLedgerFixedStatementDelta, 1,
    `${label}.cursorLedgerFixedStatementDelta`);
  assert.equal(value.outerLedgerUnchanged, true);
  exactKeys(value.sameIdentity, IDENTITY_FIELDS, `${label}.sameIdentity`);
  assert.equal(Object.values(value.sameIdentity).every((entry) => entry === true), true,
    `${label} contains a false identity edge`);
  exactKeys(value.lifecycle, LIFECYCLE_FIELDS, `${label}.lifecycle`);
  assert.deepEqual(value.lifecycle, {
    session: "consumed-for-rebind",
    context: "write-adopted",
    tombstone: "adopted",
    adoption: "active",
    write: "rule11-complete",
    rule11: "active",
  });
  validateConsumeMint(value.consumeMint, `${label}.consumeMint`);
}

function validateFailures(values) {
  assert.equal(Array.isArray(values), true);
  assert.equal(values.length, 4);
  for (const value of values) {
    const fields = FAILURE_FIELDS[value.caseId];
    assert.equal(fields !== undefined, true,
      `failure.${String(value.caseId)} has an unknown caseId`);
    exactKeys(value, fields, `failure.${String(value.caseId)}`);
    if (value.caseId === "preconsume-release") {
      exactSafeInteger(value.executeCount, 0, "failure.preconsume-release.executeCount");
      exactSafeInteger(value.releaseCount, 1, "failure.preconsume-release.releaseCount");
    }
  }
  assert.deepEqual(values, [
    {
      caseId: "pre-cancel",
      outcome: "cancelled-before-prepare",
      selectedGraphPoisoned: false,
      sameSessionRetrySucceeded: true,
    },
    {
      caseId: "forged-cancel",
      outcome: "invalid-session-presentation",
      invalidPresentationPrecedesCancellation: true,
      graphSelected: false,
    },
    {
      caseId: "replay-poison",
      outcome: "exact-replay-poisoned",
      selectedGraphPoisoned: true,
      replayRejected: true,
      receiptReadableAfterPoison: false,
    },
    {
      caseId: "preconsume-release",
      outcome: "exact-release-primary",
      primaryIdentityPreserved: true,
      selectedGraphPoisoned: true,
      sessionConsumed: false,
      contextLifecycle: "poisoned",
      executionLifecycle: "poisoned",
      executeCount: 0,
      releaseCount: 1,
      replayRejected: true,
    },
  ]);
}

function validateReport(value, runtime) {
  exactKeys(value, REPORT_FIELDS, `${runtime} report`);
  assert.equal(value.schemaVersion, SCHEMA_VERSION);
  assert.equal(value.runtime, runtime);
  assert.equal(Array.isArray(value.successes), true);
  assert.equal(value.successes.length, 3);
  [0, 1, 3].forEach((cursorCount, index) =>
    validateSuccess(value.successes[index], cursorCount, index));
  validateFailures(value.failures);
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
  return Object.freeze({
    bytes: child.stdout,
    report: validateReport(parsed, runtime),
  });
}

function portableBytes(report) {
  return JSON.stringify({
    schemaVersion: report.schemaVersion,
    successes: report.successes,
    failures: report.failures,
  });
}

test("Rule11 comparator rejects hostile canonical projections", () => {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    runtime: "typescript",
    successes: [],
    failures: [],
  };
  assert.throws(() => validateReport(base, "typescript"), /3/u);
  const reordered = {
    runtime: "typescript",
    schemaVersion: SCHEMA_VERSION,
    successes: [],
    failures: [],
  };
  assert.throws(() => validateReport(reordered, "typescript"), /key order/u);

  const exactRelease = {
    caseId: "preconsume-release",
    outcome: "exact-release-primary",
    primaryIdentityPreserved: true,
    selectedGraphPoisoned: true,
    sessionConsumed: false,
    contextLifecycle: "poisoned",
    executionLifecycle: "poisoned",
    executeCount: 0,
    releaseCount: 1,
    replayRejected: true,
  };
  assert.throws(() => validateFailures([
    exactRelease,
    exactRelease,
    exactRelease,
    { ...exactRelease, releaseCount: Number.MAX_SAFE_INTEGER + 1 },
  ]), /safe integer/u);
  const reorderedRelease = {
    outcome: exactRelease.outcome,
    caseId: exactRelease.caseId,
    primaryIdentityPreserved: true,
    selectedGraphPoisoned: true,
    sessionConsumed: false,
    contextLifecycle: "poisoned",
    executionLifecycle: "poisoned",
    executeCount: 0,
    releaseCount: 1,
    replayRejected: true,
  };
  assert.throws(() => validateFailures([
    exactRelease,
    exactRelease,
    exactRelease,
    reorderedRelease,
  ]), /key order/u);
  assert.throws(() => validateFailures([
    exactRelease,
    exactRelease,
    exactRelease,
    { caseId: "unknown" },
  ]), /unknown caseId/u);

  assert.throws(() => validateCounts({
    b2CursorCount: 0,
    nativeAffectedCount: 1,
    changesAffectedCount: 0,
    totalChangesDelta: 0,
    cursorLedgerAffectedDelta: 0,
  }, 0, "hostile native affected evidence"), /differs/u);
  assert.throws(() => validateConsumeMint({
    writePrepareCount: 1,
    writeExecuteCount: 1,
    writeReleaseCount: 1,
    changesPrepareCount: 1,
    changesFetchCount: 2,
    changesReleaseCount: 1,
    rule11ViolationCount: 0,
    diagnosticsTruncated: false,
  }, "hostile changes exact-one evidence"), /differs/u);
});

test("Rule11 reporter sources are isolated from tests, fixture oracles, and each other", () => {
  const sources = [
    TS_REPORTER,
    PY_REPORTER,
    join(ROOT, "tools/conformance/sqlite_cursor_publication_rule11_typescript_graph.mjs"),
    join(ROOT, "tools/conformance/sqlite_cursor_publication_rule11_python_graph.py"),
  ].map((path) => [path, readFileSync(path, "utf8")]);
  for (const [path, source] of sources) {
    assert.doesNotMatch(source, /(?:^|["'/])tests?(?:["'/]|$)/mu,
      `${path} imported test code`);
    assert.doesNotMatch(source, /\.case\.json|sqlite-cursor-publication-rebind-v2/u,
      `${path} imported a fixture oracle`);
  }
  assert.doesNotMatch(sources[0][1], /python_report|python_graph/u);
  assert.doesNotMatch(sources[1][1], /typescript_report|typescript_graph/u);
});

test("Rule11 real-SQLite reporters are deterministic and byte-exact across runtimes", {
  timeout: 10 * 60_000,
}, () => {
  const typescriptFirst = runReporter(
    "TypeScript Rule11 reporter",
    "node",
    ["--no-warnings", TS_REPORTER],
    "typescript",
  );
  const pythonFirst = runReporter(
    "Python Rule11 reporter",
    "uv",
    ["run", "--project", "python", "python", PY_REPORTER],
    "python",
  );
  const typescriptSecond = runReporter(
    "TypeScript Rule11 reporter repeat",
    "node",
    ["--no-warnings", TS_REPORTER],
    "typescript",
  );
  const pythonSecond = runReporter(
    "Python Rule11 reporter repeat",
    "uv",
    ["run", "--project", "python", "python", PY_REPORTER],
    "python",
  );
  assert.equal(typescriptFirst.bytes, typescriptSecond.bytes,
    "TypeScript Rule11 reporter bytes are nondeterministic");
  assert.equal(pythonFirst.bytes, pythonSecond.bytes,
    "Python Rule11 reporter bytes are nondeterministic");
  assert.equal(
    portableBytes(typescriptFirst.report),
    portableBytes(pythonFirst.report),
    "TypeScript/Python Rule11 canonical value projections differ",
  );
});
