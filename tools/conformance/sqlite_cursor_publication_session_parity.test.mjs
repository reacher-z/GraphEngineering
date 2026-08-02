import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCursorPublicationFixture,
  parseStrictJson,
  validateCanonicalCursorPublicationFixture,
} from "../../spec/conformance/sqlite-cursor-publication-rebind-v2.validate.mjs";
import {
  ACTIVATED_RECORD_FIELDS,
  SESSION_ACTIVATED_ORDINALS,
  SESSION_CANDIDATE_ORDINALS,
  SESSION_RUNTIME_ERROR_ORACLE,
  SESSION_UNAVAILABLE,
  assertHonestActivationAccounting,
  expectedActivatedRecord,
  expandHostileRecord,
} from "./sqlite_cursor_publication_session_activated_records.mjs";
import { auditSQLiteCursorPublicationSessionTypescriptTail } from
  "./sqlite_cursor_publication_session_typescript_tail_audit.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TYPESCRIPT_REPORT = join(
  ROOT, "tools/conformance/sqlite_cursor_publication_session_typescript_report.mjs",
);
const PYTHON_REPORT = join(
  ROOT, "tools/conformance/sqlite_cursor_publication_session_python_report.py",
);
const REPORTERS_PRESENT = existsSync(TYPESCRIPT_REPORT) && existsSync(PYTHON_REPORT);

const REPORT_FIELDS = Object.freeze([
  "runtime",
  "publicExports",
  "staticGates",
  "counterProbe",
  "rollbackCount",
  "success",
  "cancellation",
  "activatedRecords",
]);
const PUBLIC_EXPORT_FIELDS = Object.freeze([
  "packageRootPrepare",
  "packageRootObserve",
  "packageRootPublish",
  "packageRootAssert",
  "packageRootReadSnapshot",
  "packageRootCancellation",
  "packageRootPreparedOwner",
  "packageRootSession",
]);
const STATIC_GATE_FIELDS = Object.freeze([
  "closedPrepareSignature",
  "closedObserveSignature",
  "closedPublishSignature",
  "atomicTailNoCancellation",
  "atomicTailNoFaultHook",
  "atomicTailNoSql",
  "atomicTailNoProviderClock",
  "atomicTailNoCallerDispatch",
  "atomicTailNoImport",
  "atomicTailNoTransactionControl",
  "atomicTailNoCursorRebind",
  "atomicTailNoCommit",
  "clockRegistryEncapsulated",
  "packageRootDeclarationPrivate",
]);
const CANCELLATION_FIELDS = Object.freeze([
  "caseId",
  "outcome",
  "state",
  "poisoned",
  "providerClockReadCount",
  "clockEvidenceConsumeCount",
  "sessionRetryable",
  "cursorRebindPrepareCount",
  "cursorRebindExecuteCount",
  "commitCount",
]);

validateCanonicalCursorPublicationFixture();
const FIXTURE = loadCursorPublicationFixture();
const PARITY = FIXTURE.parityGates.initialPublicationNormalizedOutput;
const NORMALIZED_FIELDS = Object.freeze([...PARITY.orderedFields]);
const SESSION_EVIDENCE = FIXTURE.authority.publicationSession.leafLocalEvidenceContract;
const SUCCESS_ORACLE = SESSION_EVIDENCE.success;
const CANCELLATION_ORACLE = SESSION_EVIDENCE.preTailCancellation;
const ACCOUNTING = assertHonestActivationAccounting(FIXTURE);
const EXPECTED_COUNTER_PROBE = Object.freeze({
  ...PARITY.counterSelfProbe,
  publicationSessionMintCount: 1,
  publicationSessionAssertionCount: 1,
  cancellationObservationCount: 1,
  rollbackCount: 1,
});
const COUNTER_PROBE_FIELDS = Object.freeze(Object.keys(EXPECTED_COUNTER_PROBE));
const ALLOWED_OUTCOMES = new Set(["success", "rejected", "poisoned"]);
const ALLOWED_STATES = new Set(FIXTURE.stateMachine.states);

assert.equal(NORMALIZED_FIELDS.length, 28);
assert.deepEqual(Object.keys(SUCCESS_ORACLE), NORMALIZED_FIELDS);
assert.deepEqual(Object.keys(CANCELLATION_ORACLE), CANCELLATION_FIELDS);
assert.deepEqual(ACCOUNTING, { activated: 4, candidates: 25, registry: 145 });

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, fields, label) {
  assert.ok(isObject(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value), fields, `${label} keys or key order differ`);
}

function assertNonnegativeSafeInteger(value, label) {
  assert.ok(Number.isSafeInteger(value) && value >= 0,
    `${label} must be a nonnegative safe integer`);
}

function validateNormalizedShape(record, label) {
  assertExactKeys(record, NORMALIZED_FIELDS, label);
  for (const field of NORMALIZED_FIELDS) {
    const value = record[field];
    const type = PARITY.fieldTypes[field];
    if (type === "non-empty-string") {
      assert.ok(typeof value === "string" && value.length > 0,
        `${label}.${field} must be a non-empty string`);
    } else if (type === "enum-success-rejected-poisoned") {
      assert.ok(ALLOWED_OUTCOMES.has(value), `${label}.${field} is not a frozen outcome`);
    } else if (type === "slug-or-null") {
      assert.ok(value === null
        || (typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)),
      `${label}.${field} must be null or a lowercase slug`);
    } else if (type === "enum-state-machine-states") {
      assert.ok(typeof value === "string" && ALLOWED_STATES.has(value),
        `${label}.${field} is not a frozen state`);
    } else if (type === "exact-four-nonnegative-safe-integers") {
      assert.ok(Array.isArray(value) && value.length === 4,
        `${label}.${field} must contain exactly four counters`);
      value.forEach((entry, index) => {
        assertNonnegativeSafeInteger(entry, `${label}.${field}[${String(index)}]`);
      });
    } else if (type === "nonnegative-safe-integer") {
      assertNonnegativeSafeInteger(value, `${label}.${field}`);
    } else if (type === "boolean") {
      assert.equal(typeof value, "boolean", `${label}.${field} must be Boolean`);
    } else {
      assert.fail(`${label}.${field} has unknown frozen type ${String(type)}`);
    }
  }
  assert.equal(record.cursorRebindPrepareCount, 0,
    `${label} crossed the cursor-rebind prepare boundary`);
  assert.equal(record.cursorRebindExecuteCount, 0,
    `${label} crossed the cursor-rebind execute boundary`);
  assert.equal(record.commitCount, 0, `${label} crossed the commit boundary`);
}

function validateNormalized(record, oracle, label) {
  validateNormalizedShape(record, label);
  assert.equal(JSON.stringify(record), JSON.stringify(oracle), `${label} differs from frozen fixture`);
}

function validateCancellation(record) {
  const label = "cancellation";
  assertExactKeys(record, CANCELLATION_FIELDS, label);
  assert.equal(record.caseId, "publication-session-cancelled-before-tail");
  assert.equal(record.outcome, "cancelled");
  assert.equal(record.state, "pre-rebind-complete");
  for (const field of ["poisoned", "sessionRetryable"]) {
    assert.equal(typeof record[field], "boolean", `${label}.${field} must be Boolean`);
  }
  for (const field of [
    "providerClockReadCount", "clockEvidenceConsumeCount",
    "cursorRebindPrepareCount", "cursorRebindExecuteCount", "commitCount",
  ]) {
    assertNonnegativeSafeInteger(record[field], `${label}.${field}`);
  }
  assert.equal(record.cursorRebindPrepareCount, 0, "cancellation crossed rebind prepare");
  assert.equal(record.cursorRebindExecuteCount, 0, "cancellation crossed rebind execute");
  assert.equal(record.commitCount, 0, "cancellation crossed commit");
  assert.equal(JSON.stringify(record), JSON.stringify(CANCELLATION_ORACLE),
    "cancellation differs from frozen fixture");
}

function validatePublicExports(value, runtime) {
  assertExactKeys(value, PUBLIC_EXPORT_FIELDS, `${runtime}.publicExports`);
  for (const [name, exposed] of Object.entries(value)) {
    assert.equal(exposed, false, `${runtime} leaked publication-session API at ${name}`);
  }
}

function validateStaticGates(value, runtime) {
  assertExactKeys(value, STATIC_GATE_FIELDS, `${runtime}.staticGates`);
  for (const [name, passed] of Object.entries(value)) {
    assert.equal(passed, true, `${runtime} failed static gate ${name}`);
  }
}

function validateCounterProbe(value, runtime) {
  assertExactKeys(value, COUNTER_PROBE_FIELDS, `${runtime}.counterProbe`);
  assert.equal(JSON.stringify(value), JSON.stringify(EXPECTED_COUNTER_PROBE),
    `${runtime}.counterProbe did not activate every recorder exactly once`);
}

function validateActivatedRecords(records, runtime) {
  assert.ok(Array.isArray(records), `${runtime}.activatedRecords must be an array`);
  assert.equal(records.length, SESSION_ACTIVATED_ORDINALS.length,
    `${runtime} must emit exactly four honest activated records`);
  records.forEach((record, index) => {
    const ordinal = SESSION_ACTIVATED_ORDINALS[index];
    const label = `${runtime}.activatedRecords[${String(index)}]`;
    assertExactKeys(record, ACTIVATED_RECORD_FIELDS, label);
    assert.equal(record.ordinal, ordinal, `${label}.ordinal or record order differs`);
    assert.ok(SESSION_CANDIDATE_ORDINALS.includes(record.ordinal),
      `${label}.ordinal is outside the publication-session candidate slice`);
    assert.equal(record.runtimeError, SESSION_RUNTIME_ERROR_ORACLE[runtime][ordinal],
      `${label}.runtimeError does not prove the exact runtime path`);
    const hostile = FIXTURE.hostileExecutionContract.records[ordinal - 1];
    assert.equal(record.semanticErrorCode, hostile.expectedCode,
      `${label}.semanticErrorCode differs from the frozen registry`);
    assert.equal(record.sameGraphRetryable, false,
      `${label} incorrectly claims same-graph retryability`);
    assert.equal(record.freshGraphSucceeded, true,
      `${label} did not prove fresh-graph recovery`);
    validateNormalized(record.normalized, expandHostileRecord(FIXTURE, ordinal),
      `${label}.normalized`);
  });
}

function validateReport(value, expectedRuntime) {
  assertExactKeys(value, REPORT_FIELDS, `${expectedRuntime} report`);
  assert.equal(value.runtime, expectedRuntime, `${expectedRuntime} report runtime differs`);
  validatePublicExports(value.publicExports, expectedRuntime);
  validateStaticGates(value.staticGates, expectedRuntime);
  validateCounterProbe(value.counterProbe, expectedRuntime);
  assert.equal(value.rollbackCount, 0,
    `${expectedRuntime} subject controls executed rollback before reporting`);
  validateNormalized(value.success, SUCCESS_ORACLE, `${expectedRuntime}.success`);
  validateCancellation(value.cancellation);
  validateActivatedRecords(value.activatedRecords, expectedRuntime);
  return Object.freeze({
    activatedBytes: value.activatedRecords.map(({ normalized }) => JSON.stringify(normalized)),
    cancellationBytes: JSON.stringify(value.cancellation),
    report: value,
    successBytes: JSON.stringify(value.success),
  });
}

function parseReportStdout(label, stdout, expectedRuntime) {
  assert.equal(typeof stdout, "string", `${label} stdout must be text`);
  const parsed = parseStrictJson(stdout);
  assert.equal(stdout, `${JSON.stringify(parsed)}\n`,
    `${label} stdout must be one compact canonical JSON value followed by one LF`);
  return validateReport(parsed, expectedRuntime);
}

function terminateTimedOutProcessGroup(child) {
  if (child.error?.code !== "ETIMEDOUT" || !Number.isInteger(child.pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function childFailure(label, child) {
  const status = child.status ?? "null";
  const signal = child.signal ?? "none";
  const systemError = child.error === undefined ? "" : ` error=${child.error.message}`;
  const output = [child.stdout, child.stderr].filter(Boolean).join("\n--- stderr ---\n");
  return new Error(
    `${label} failed: status=${status} signal=${signal}${systemError}${output ? `\n${output}` : ""}`,
  );
}

function readChildReport(label, child, runtime) {
  terminateTimedOutProcessGroup(child);
  if (child.error !== undefined || child.status !== 0 || child.signal !== null) {
    throw childFailure(label, child);
  }
  if (child.stderr !== "") throw new Error(`${label} wrote unexpected stderr: ${child.stderr}`);
  return parseReportStdout(label, child.stdout, runtime);
}

function runReport(label, command, arguments_, runtime) {
  const child = spawnSync(command, arguments_, {
    cwd: ROOT,
    detached: process.platform !== "win32",
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 20 * 60_000,
  });
  return readChildReport(label, child, runtime);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validEnvelope(runtime = "typescript") {
  return {
    runtime,
    publicExports: Object.fromEntries(PUBLIC_EXPORT_FIELDS.map((field) => [field, false])),
    staticGates: Object.fromEntries(STATIC_GATE_FIELDS.map((field) => [field, true])),
    counterProbe: clone(EXPECTED_COUNTER_PROBE),
    rollbackCount: 0,
    success: clone(SUCCESS_ORACLE),
    cancellation: clone(CANCELLATION_ORACLE),
    activatedRecords: SESSION_ACTIVATED_ORDINALS.map(
      (ordinal) => clone(expectedActivatedRecord(FIXTURE, runtime, ordinal)),
    ),
  };
}

function reorderedObject(value, leftIndex, rightIndex) {
  const entries = Object.entries(value);
  [entries[leftIndex], entries[rightIndex]] = [entries[rightIndex], entries[leftIndex]];
  return Object.fromEntries(entries);
}

test("publication-session activated slice accounts honestly for the frozen registry", () => {
  assert.deepEqual(SESSION_ACTIVATED_ORDINALS, [20, 100, 101, 102]);
  assert.equal(SESSION_CANDIDATE_ORDINALS.length, 25);
  assert.equal(SESSION_UNAVAILABLE.flatMap(({ ordinals }) => ordinals).length, 21);
  assert.equal(FIXTURE.hostileExecutionContract.runtimeExecutionEvidenceClaim, false);
  for (const ordinal of SESSION_ACTIVATED_ORDINALS) {
    const normalized = expandHostileRecord(FIXTURE, ordinal);
    assert.deepEqual(Object.keys(normalized), NORMALIZED_FIELDS);
    assert.equal(normalized.caseId, FIXTURE.hostileExecutionContract.records[ordinal - 1].id);
  }
});

test("publication-session synthetic envelopes exercise the strict comparator kernel", () => {
  const typescript = validateReport(validEnvelope("typescript"), "typescript");
  const python = validateReport(validEnvelope("python"), "python");
  assert.equal(typescript.successBytes, python.successBytes);
  assert.equal(typescript.cancellationBytes, python.cancellationBytes);
  assert.deepEqual(typescript.activatedBytes, python.activatedBytes);
  assert.equal(typescript.successBytes, JSON.stringify(SUCCESS_ORACLE));
  assert.equal(typescript.cancellationBytes, JSON.stringify(CANCELLATION_ORACLE));
});

test("publication-session comparator rejects hostile envelope and control mutations", () => {
  const reject = (description, mutate, pattern = /./u) => {
    const value = validEnvelope();
    mutate(value);
    assert.throws(() => validateReport(value, "typescript"), pattern, description);
  };
  reject("wrong envelope order", (value) => {
    const reordered = reorderedObject(value, 0, 1);
    for (const key of Object.keys(value)) delete value[key];
    Object.assign(value, reordered);
  }, /keys or key order/u);
  reject("missing envelope field", (value) => { delete value.rollbackCount; }, /keys or key order/u);
  reject("extra envelope field", (value) => { value.extra = 0; }, /keys or key order/u);
  reject("wrong runtime", (value) => { value.runtime = "python"; }, /runtime differs/u);
  reject("public export field missing", (value) => {
    delete value.publicExports.packageRootSession;
  }, /keys or key order/u);
  reject("public export field extra", (value) => {
    value.publicExports.extra = false;
  }, /keys or key order/u);
  reject("public export fields reordered", (value) => {
    value.publicExports = reorderedObject(value.publicExports, 0, 1);
  }, /keys or key order/u);
  reject("public export leak", (value) => { value.publicExports.packageRootPublish = true; }, /leaked/u);
  reject("static gate missing", (value) => {
    delete value.staticGates.clockRegistryEncapsulated;
  }, /keys or key order/u);
  reject("static gate extra", (value) => { value.staticGates.extra = true; }, /keys or key order/u);
  reject("static gates reordered", (value) => {
    value.staticGates = reorderedObject(value.staticGates, 0, 1);
  }, /keys or key order/u);
  reject("static gate false", (value) => { value.staticGates.atomicTailNoSql = false; }, /failed/u);
  reject("counter probe missing", (value) => {
    delete value.counterProbe.publicationSessionMintCount;
  }, /keys or key order/u);
  reject("counter probe zero", (value) => {
    value.counterProbe.cancellationObservationCount = 0;
  }, /exactly once/u);
  reject("counter probe extra", (value) => { value.counterProbe.extra = 1; }, /keys or key order/u);
  reject("counter probe reordered", (value) => {
    value.counterProbe = reorderedObject(value.counterProbe, 0, 1);
  }, /keys or key order/u);
  reject("counter probe array drift", (value) => {
    value.counterProbe.perWriteExecuteCounts[0] = 2;
  }, /exactly once/u);
  reject("subject rollback", (value) => { value.rollbackCount = 1; }, /executed rollback/u);
  reject("subject rollback mistyped", (value) => { value.rollbackCount = "0"; }, /executed rollback/u);
  reject("success field missing", (value) => { delete value.success.commitCount; }, /keys or key order/u);
  reject("success fields reordered", (value) => {
    value.success = reorderedObject(value.success, 0, 1);
  }, /keys or key order/u);
  reject("success wrong outcome", (value) => { value.success.outcome = "ok"; }, /frozen outcome/u);
  reject("success invalid state", (value) => { value.success.state = "adopted"; }, /frozen state/u);
  reject("success mistyped Boolean", (value) => { value.success.poisoned = 0; }, /Boolean/u);
  reject("success unsafe integer", (value) => {
    value.success.providerClockReadCount = Number.MAX_SAFE_INTEGER + 1;
  }, /safe integer/u);
  reject("success array length", (value) => { value.success.perWritePrepareCounts.pop(); }, /four/u);
  reject("success negative array entry", (value) => {
    value.success.perWriteExecuteCounts[0] = -1;
  }, /nonnegative safe integer/u);
  reject("success counter drift", (value) => {
    value.success.outerLedgerFixedStatementCount += 1;
  }, /frozen fixture/u);
  reject("success crossed rebind", (value) => {
    value.success.cursorRebindPrepareCount = 1;
  }, /rebind prepare/u);
  reject("cancellation missing", (value) => {
    delete value.cancellation.sessionRetryable;
  }, /keys or key order/u);
  reject("cancellation reordered", (value) => {
    value.cancellation = reorderedObject(value.cancellation, 0, 1);
  }, /keys or key order/u);
  reject("cancellation not retryable", (value) => {
    value.cancellation.sessionRetryable = false;
  }, /frozen fixture/u);
  reject("cancellation mistyped retry", (value) => {
    value.cancellation.sessionRetryable = 1;
  }, /Boolean/u);
  reject("cancellation negative count", (value) => {
    value.cancellation.providerClockReadCount = -1;
  }, /nonnegative safe integer/u);
  reject("cancellation consumed evidence", (value) => {
    value.cancellation.clockEvidenceConsumeCount = 2;
  }, /frozen fixture/u);
  reject("cancellation crossed commit", (value) => {
    value.cancellation.commitCount = 1;
  }, /crossed commit/u);
});

test("publication-session comparator rejects false activated execution evidence", () => {
  const reject = (description, mutate, pattern = /./u) => {
    const value = validEnvelope();
    mutate(value);
    assert.throws(() => validateReport(value, "typescript"), pattern, description);
  };
  reject("missing activation", (value) => { value.activatedRecords.pop(); }, /exactly four/u);
  reject("extra activation", (value) => {
    value.activatedRecords.push(clone(value.activatedRecords[0]));
  }, /exactly four/u);
  reject("reordered activation", (value) => {
    [value.activatedRecords[0], value.activatedRecords[1]] =
      [value.activatedRecords[1], value.activatedRecords[0]];
  }, /ordinal or record order/u);
  reject("duplicate ordinal", (value) => {
    value.activatedRecords[1].ordinal = value.activatedRecords[0].ordinal;
  }, /ordinal or record order/u);
  reject("activated field missing", (value) => {
    delete value.activatedRecords[0].freshGraphSucceeded;
  }, /keys or key order/u);
  reject("activated field extra", (value) => {
    value.activatedRecords[0].extra = true;
  }, /keys or key order/u);
  reject("activated fields reordered", (value) => {
    value.activatedRecords[0] = reorderedObject(value.activatedRecords[0], 0, 1);
  }, /keys or key order/u);
  reject("unavailable ordinal", (value) => { value.activatedRecords[0].ordinal = 18; }, /ordinal/u);
  reject("raw error substitution", (value) => {
    value.activatedRecords[0].runtimeError = "ValueError|GE_CURSOR_B3_PUBLICATION_SESSION_EVIDENCE";
  }, /runtimeError/u);
  reject("semantic code substitution", (value) => {
    value.activatedRecords[0].semanticErrorCode = "GE_CURSOR_B3_AUTHORITY";
  }, /semanticErrorCode/u);
  reject("same graph retry claim", (value) => {
    value.activatedRecords[0].sameGraphRetryable = true;
  }, /same-graph/u);
  reject("no fresh graph proof", (value) => {
    value.activatedRecords[0].freshGraphSucceeded = false;
  }, /fresh-graph/u);
  reject("normalized profile drift", (value) => {
    value.activatedRecords[0].normalized.clockEvidenceConsumeCount += 1;
  }, /frozen fixture/u);
  reject("normalized record key reorder", (value) => {
    value.activatedRecords[0].normalized = reorderedObject(
      value.activatedRecords[0].normalized, 0, 1,
    );
  }, /keys or key order/u);
});

test("publication-session comparator rejects hostile stdout and child termination", () => {
  const valid = `${JSON.stringify(validEnvelope())}\n`;
  assert.throws(() => parseReportStdout("prefix", `noise${valid}`, "typescript"));
  assert.throws(() => parseReportStdout("suffix", `${valid}noise`, "typescript"));
  assert.throws(() => parseReportStdout("extra newline", `${valid}\n`, "typescript"),
    /compact canonical JSON/u);
  assert.throws(() => parseReportStdout(
    "pretty", `${JSON.stringify(validEnvelope(), null, 2)}\n`, "typescript",
  ), /compact canonical JSON/u);
  assert.throws(() => parseStrictJson('{"runtime":"typescript","runtime":"python"}'),
    /duplicate key runtime/u);
  assert.throws(() => readChildReport("stderr", {
    status: 0, signal: null, error: undefined, stdout: valid, stderr: "warning",
  }, "typescript"), /unexpected stderr/u);
  assert.throws(() => readChildReport("nonzero", {
    status: 1, signal: null, error: undefined, stdout: "", stderr: "failed",
  }, "typescript"), /status=1/u);
  assert.throws(() => readChildReport("signal", {
    status: null, signal: "SIGTERM", error: undefined, stdout: "", stderr: "",
  }, "typescript"), /signal=SIGTERM/u);
  assert.throws(() => readChildReport("timeout", {
    status: null,
    signal: "SIGTERM",
    pid: 99_999_999,
    error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
    stdout: "",
    stderr: "",
  }, "typescript"), /ETIMEDOUT|timed out/u);
});

test("publication-session production surface and atomic tails remain closed", () => {
  const tsOuter = readFileSync(join(
    ROOT, "packages/sqlite/src/cursor-publication-outer-authority.ts",
  ), "utf8");
  const tsOwnership = readFileSync(join(
    ROOT, "packages/sqlite/src/operation-baseline-cursor-stage-ownership.ts",
  ), "utf8");
  const tsStage = readFileSync(join(
    ROOT, "packages/sqlite/src/operation-baseline-stage.ts",
  ), "utf8");
  const tsOuterDist = readFileSync(join(
    ROOT, "packages/sqlite/dist/cursor-publication-outer-authority.js",
  ), "utf8");
  const tsOwnershipDist = readFileSync(join(
    ROOT, "packages/sqlite/dist/operation-baseline-cursor-stage-ownership.js",
  ), "utf8");
  const tsStageDist = readFileSync(join(
    ROOT, "packages/sqlite/dist/operation-baseline-stage.js",
  ), "utf8");
  const pyOuter = readFileSync(join(
    ROOT, "python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py",
  ), "utf8");
  const tsIndex = readFileSync(join(ROOT, "packages/sqlite/src/index.ts"), "utf8");
  const pyIndex = readFileSync(join(ROOT, "python/src/graph_engineering/__init__.py"), "utf8");
  const packageJson = JSON.parse(readFileSync(join(ROOT, "packages/sqlite/package.json"), "utf8"));

  for (const name of [
    "prepareSQLiteCursorPublicationSessionIntrinsic",
    "observeSQLiteCursorPublicationSessionClockIntrinsic",
    "publishSQLiteCursorPublicationSessionIntrinsic",
    "assertSQLiteCursorPublicationSessionIntrinsic",
    "SQLiteCursorPublicationSessionPreparedOwner",
    "SQLiteCursorPublicationSession",
  ]) assert.doesNotMatch(tsIndex, new RegExp(name, "u"));
  for (const name of [
    "_prepare_sqlite_cursor_publication_session_intrinsic",
    "_observe_sqlite_cursor_publication_session_clock_intrinsic",
    "_publish_sqlite_cursor_publication_session_intrinsic",
    "_assert_sqlite_cursor_publication_session_intrinsic",
  ]) assert.doesNotMatch(pyIndex, new RegExp(name, "u"));
  assert.deepEqual(Object.keys(packageJson.exports), ["."], "SQLite package deep exports widened");
  for (const builtIndex of [
    join(ROOT, "packages/sqlite/dist/index.js"),
    join(ROOT, "packages/sqlite/dist/index.d.ts"),
  ]) {
    if (!existsSync(builtIndex)) continue;
    const builtSource = readFileSync(builtIndex, "utf8");
    assert.doesNotMatch(builtSource,
      /SQLiteCursorPublicationSession|prepareSQLiteCursorPublicationSessionIntrinsic/u,
      `built package root leaked publication-session internals: ${builtIndex}`);
  }

  assert.match(tsOuter,
    /prepareSQLiteCursorPublicationSessionIntrinsic\([\s\S]*?authority[\s\S]*?adoptionReceipt/u);
  assert.match(tsOuter,
    /observeSQLiteCursorPublicationSessionClockIntrinsic\([\s\S]*?preparedOwner/u);
  assert.match(tsOuter,
    /publishSQLiteCursorPublicationSessionIntrinsic\([\s\S]*?preparedOwner[\s\S]*?evidence[\s\S]*?cancellation/u);
  assert.match(pyOuter,
    /def _prepare_sqlite_cursor_publication_session_intrinsic\([\s\S]*?authority[\s\S]*?adoption_receipt/u);
  assert.match(pyOuter,
    /def _observe_sqlite_cursor_publication_session_clock_intrinsic\([\s\S]*?prepared/u);
  assert.match(pyOuter,
    /def _publish_sqlite_cursor_publication_session_implementation\([\s\S]*?prepared[\s\S]*?evidence[\s\S]*?cancellation[\s\S]*?atomic_tail/u);
  assert.match(pyOuter,
    /def _capture_publication_session_publisher\([\s\S]*?implementation[\s\S]*?_publish_sqlite_cursor_publication_session_implementation[\s\S]*?atomic_tail[\s\S]*?_ATOMIC_PUBLICATION_SESSION_TAIL/u);
  assert.match(pyOuter,
    /_publish_sqlite_cursor_publication_session_intrinsic\s*=\s*_capture_publication_session_publisher\(\)/u);
  for (const hiddenName of [
    "_capture_publication_session_publisher",
    "_publish_sqlite_cursor_publication_session_implementation",
    "_ATOMIC_PUBLICATION_SESSION_TAIL",
  ]) assert.match(pyOuter, new RegExp(`del ${hiddenName}`, "u"));

  const pythonClosureProbe = String.raw`
import dis
import inspect

import graph_engineering.sqlite_cursor_publication_outer_authority as outer

publisher = outer._publish_sqlite_cursor_publication_session_intrinsic
publisher_nonlocals = inspect.getclosurevars(publisher).nonlocals
assert set(publisher_nonlocals) == {"implementation", "atomic_tail"}
implementation = publisher_nonlocals["implementation"]
atomic_tail = publisher_nonlocals["atomic_tail"]
assert inspect.isfunction(implementation)
assert implementation.__name__ == "_publish_sqlite_cursor_publication_session_implementation"
assert inspect.isfunction(atomic_tail)
assert atomic_tail.__name__ == "atomic_tail"
assert "_publish_sqlite_cursor_publication_session_implementation" not in vars(outer)
assert "_capture_publication_session_publisher" not in vars(outer)
assert "_ATOMIC_PUBLICATION_SESSION_TAIL" not in vars(outer)
tail_nonlocals = inspect.getclosurevars(atomic_tail).nonlocals
assert set(tail_nonlocals) == {
    "authority_session_slot",
    "authority_session_state_slot",
    "burn_publication_commit",
    "consume_clock",
    "object_setattr",
    "poison",
    "publish_publication_commit",
}
assert tail_nonlocals["burn_publication_commit"] is outer._OWNERSHIP_BURN_PUBLICATION_SESSION_COMMIT
assert tail_nonlocals["consume_clock"] is outer._CONSUME_CLOCK
assert tail_nonlocals["publish_publication_commit"] is outer._OWNERSHIP_PUBLISH_PUBLICATION_SESSION_COMMIT
assert tail_nonlocals["object_setattr"] is object.__setattr__
assert tail_nonlocals["poison"] is outer._poison
assert tail_nonlocals["authority_session_slot"] == outer._AUTHORITY_SESSION_SLOT
assert tail_nonlocals["authority_session_state_slot"] == outer._AUTHORITY_SESSION_STATE_SLOT
forbidden = {
    "__import__", "call", "eval", "exec", "getattr", "setattr",
    "_AUTHORITY_SESSION_SLOT", "_AUTHORITY_SESSION_STATE_SLOT", "_CONSUME_CLOCK",
    "_OBJECT_SETATTR", "_OWNERSHIP_BURN_PUBLICATION_SESSION_COMMIT",
    "_OWNERSHIP_PUBLISH_PUBLICATION_SESSION_COMMIT", "_poison",
}
assert forbidden.isdisjoint(atomic_tail.__code__.co_names)
assert not any(
    instruction.opname in {"LOAD_GLOBAL", "LOAD_NAME"}
    and instruction.argval in forbidden
    for instruction in dis.get_instructions(atomic_tail)
)
`;
  const pythonClosureResult = spawnSync(
    "uv",
    ["run", "--project", "python", "python", "-c", pythonClosureProbe],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 1_048_576 },
  );
  assert.equal(pythonClosureResult.status, 0,
    `Python publication-session closure probe failed: ${pythonClosureResult.stderr}`);
  assert.equal(pythonClosureResult.stdout, "");

  const tsTailStart = tsOuter.indexOf("// Atomic tail: outer burn");
  const tsTailEnd = tsOuter.indexOf("} catch (error) {", tsTailStart);
  assert.ok(tsTailStart >= 0 && tsTailEnd > tsTailStart, "TypeScript atomic tail markers missing");
  const sourceTail = auditSQLiteCursorPublicationSessionTypescriptTail({
    outerPath: "cursor-publication-outer-authority.ts",
    outerSource: tsOuter,
    ownershipPath: "operation-baseline-cursor-stage-ownership.ts",
    ownershipSource: tsOwnership,
    stagePath: "operation-baseline-stage.ts",
    stageSource: tsStage,
  });
  const distTail = auditSQLiteCursorPublicationSessionTypescriptTail({
    outerPath: "cursor-publication-outer-authority.js",
    outerSource: tsOuterDist,
    ownershipPath: "operation-baseline-cursor-stage-ownership.js",
    ownershipSource: tsOwnershipDist,
    stagePath: "operation-baseline-stage.js",
    stageSource: tsStageDist,
  });
  assert.equal(sourceTail.exact, true,
    "TypeScript source recursive atomic tail escaped its exact allowlist");
  assert.equal(distTail.exact, true,
    "executed TypeScript dist recursive atomic tail escaped its exact allowlist");
  const tsTail = `${sourceTail.text}\n${distTail.text}`;
  assert.doesNotMatch(tsTail, /\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/u);
  assert.doesNotMatch(tsTail, /\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/iu);
  assert.doesNotMatch(tsTail, /\b(?:cancel|fault|hook|rebind|providerNow|observeSQLite)\b/iu);
  assert.doesNotMatch(tsTail, /\bimport\s*\(|Reflect\.apply|\.call\s*\(/u);

  const pyTailStart = pyOuter.indexOf("# Non-interruptible tail:");
  const pyTailEnd = pyOuter.indexOf("except BaseException:", pyTailStart);
  assert.ok(pyTailStart >= 0 && pyTailEnd > pyTailStart, "Python atomic tail markers missing");
  const pyTail = pyOuter.slice(pyTailStart, pyTailEnd)
    .replace(/^\s*#.*$/gmu, "");
  assert.doesNotMatch(pyTail, /\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/u);
  assert.doesNotMatch(pyTail, /\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/iu);
  assert.doesNotMatch(pyTail, /\b(?:cancel|fault|hook|rebind|provider_now|_OBSERVE_CLOCK)\b/iu);
  assert.doesNotMatch(pyTail, /\b(?:__import__|eval|exec|compile)\s*\(/u);

  const tsSessionSlice = tsOuter.slice(
    tsOuter.indexOf("export function prepareSQLiteCursorPublicationSessionIntrinsic"),
    tsOuter.indexOf("export function readSQLiteCursorPublicationSessionSnapshotIntrinsic"),
  );
  assert.doesNotMatch(tsSessionSlice, /\b(?:CAPABILITIES|EVIDENCE|LOCK_CAPABILITIES|TOMBSTONES)\b/u);
  const pySessionSlice = pyOuter.slice(
    pyOuter.indexOf("def _prepare_sqlite_cursor_publication_session_intrinsic"),
    pyOuter.indexOf("class _SQLiteCursorPublicationSessionSnapshot"),
  );
  assert.doesNotMatch(pySessionSlice,
    /\b(?:_CLOCK_CAPABILITIES|_EVIDENCE|_LOCK_CAPABILITIES|_TOMBSTONES)\b/u);
});

test("publication-session shared TypeScript tail audit fails closed on mutations", () => {
  const sourceTree = {
    outerPath: "cursor-publication-outer-authority.ts",
    outerSource: readFileSync(join(
      ROOT, "packages/sqlite/src/cursor-publication-outer-authority.ts",
    ), "utf8"),
    ownershipPath: "operation-baseline-cursor-stage-ownership.ts",
    ownershipSource: readFileSync(join(
      ROOT, "packages/sqlite/src/operation-baseline-cursor-stage-ownership.ts",
    ), "utf8"),
    stagePath: "operation-baseline-stage.ts",
    stageSource: readFileSync(join(
      ROOT, "packages/sqlite/src/operation-baseline-stage.ts",
    ), "utf8"),
  };
  const distTree = {
    outerPath: "cursor-publication-outer-authority.js",
    outerSource: readFileSync(join(
      ROOT, "packages/sqlite/dist/cursor-publication-outer-authority.js",
    ), "utf8"),
    ownershipPath: "operation-baseline-cursor-stage-ownership.js",
    ownershipSource: readFileSync(join(
      ROOT, "packages/sqlite/dist/operation-baseline-cursor-stage-ownership.js",
    ), "utf8"),
    stagePath: "operation-baseline-stage.js",
    stageSource: readFileSync(join(
      ROOT, "packages/sqlite/dist/operation-baseline-stage.js",
    ), "utf8"),
  };
  assert.equal(auditSQLiteCursorPublicationSessionTypescriptTail(sourceTree).exact, true);
  assert.equal(auditSQLiteCursorPublicationSessionTypescriptTail(distTree).exact, true);

  for (const [label, tree] of [["source", sourceTree], ["dist", distTree]]) {
    const unsafeOwnership = tree.ownershipSource.replace(
      "stageTransition.burn();",
      "stageTransition.burn();\n      forbiddenDirectDispatch();",
    );
    assert.notEqual(unsafeOwnership, tree.ownershipSource, `${label} unsafe seam was not found`);
    assert.equal(auditSQLiteCursorPublicationSessionTypescriptTail({
      ...tree,
      ownershipSource: unsafeOwnership,
    }).exact, false, `${label} accepted forbidden lower direct dispatch`);

    const staleOuter = tree.outerSource.replace(
      'sessionState.lifecycle = "publication-active";',
      'sessionState.lifecycle = "stale-dist-or-source";',
    );
    assert.notEqual(staleOuter, tree.outerSource, `${label} stale seam was not found`);
    assert.equal(auditSQLiteCursorPublicationSessionTypescriptTail({
      ...tree,
      outerSource: staleOuter,
    }).exact, false, `${label} accepted a stale outer activation`);
  }

  assert.throws(() => auditSQLiteCursorPublicationSessionTypescriptTail({
    ...sourceTree,
    outerSource: `${sourceTree.outerSource}\nfunction {`,
  }), /parse diagnostics/u);
  assert.throws(() => auditSQLiteCursorPublicationSessionTypescriptTail({
    ...sourceTree,
    outerSource: `${sourceTree.outerSource}\nfunction publishSQLiteCursorPublicationSessionIntrinsic() {}`,
  }), /exactly one function/u);
  assert.throws(() => auditSQLiteCursorPublicationSessionTypescriptTail({
    ...sourceTree,
    stageSource: `${sourceTree.stageSource}\nclass DuplicateTransition {
      [SQLITE_BASELINE_PREPARE_CURSOR_PUBLICATION_SESSION_TRANSITION]() {}
    }`,
  }), /exactly one method/u);
});

test("publication-session TypeScript reporter rejects unsafe source and dist before JSON", () => {
  for (const suffix of [
    "src/operation-baseline-cursor-stage-ownership.ts",
    "dist/operation-baseline-cursor-stage-ownership.js",
  ]) {
    const preload = `
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = function(path, ...args) {
  const value = originalReadFileSync.call(this, path, ...args);
  if (String(path).endsWith(${JSON.stringify(suffix)}) && typeof value === "string") {
    return value.replace(
      "stageTransition.burn();",
      "stageTransition.burn();\\n      forbiddenDirectDispatch();",
    );
  }
  return value;
};
syncBuiltinESMExports();
`;
    const child = spawnSync("node", [
      "--no-warnings",
      "--import",
      `data:text/javascript;base64,${Buffer.from(preload).toString("base64")}`,
      TYPESCRIPT_REPORT,
    ], { cwd: ROOT, encoding: "utf8", maxBuffer: 1_048_576, timeout: 60_000 });
    assert.notEqual(child.status, 0, `${suffix} reporter mutation did not fail closed`);
    assert.equal(child.stdout, "", `${suffix} reporter mutation emitted untrusted JSON`);
    assert.match(child.stderr, /static gate failed before report emission/u);
  }
});

test("publication-session reporter sources are isolated from fixture oracles", {
  skip: !existsSync(TYPESCRIPT_REPORT) && !existsSync(PYTHON_REPORT),
}, () => {
  const sources = [];
  if (existsSync(TYPESCRIPT_REPORT)) {
    sources.push([
      "TypeScript",
      readFileSync(TYPESCRIPT_REPORT, "utf8"),
      "sqlite_cursor_publication_session_python_report",
    ]);
  }
  if (existsSync(PYTHON_REPORT)) {
    sources.push([
      "Python",
      readFileSync(PYTHON_REPORT, "utf8"),
      "sqlite_cursor_publication_session_typescript_report",
    ]);
  }
  for (const [label, source, other] of sources) {
    assert.doesNotMatch(source, /sqlite-cursor-publication-rebind-v2\.case\.json/u,
      `${label} reporter imported the frozen expected records`);
    assert.doesNotMatch(source, /loadCursorPublicationFixture|validateCanonicalCursorPublicationFixture/u,
      `${label} reporter imported the fixture oracle`);
    assert.doesNotMatch(source, new RegExp(other, "u"),
      `${label} reporter imported the other runtime reporter`);
  }
});

test("TypeScript publication-session report independently satisfies the strict oracle", {
  skip: !existsSync(TYPESCRIPT_REPORT),
  timeout: 25 * 60_000,
}, () => {
  runReport(
    "TypeScript publication-session report",
    "node",
    ["--no-warnings", TYPESCRIPT_REPORT],
    "typescript",
  );
});

test("Python publication-session report independently satisfies the strict oracle", {
  skip: !existsSync(PYTHON_REPORT),
  timeout: 25 * 60_000,
}, () => {
  runReport(
    "Python publication-session report",
    "uv",
    ["run", "--project", "python", "python", PYTHON_REPORT],
    "python",
  );
});

test("publication-session reports have exact real-SQLite TypeScript/Python parity", {
  skip: !REPORTERS_PRESENT,
  timeout: 40 * 60_000,
}, () => {
  const typescript = runReport(
    "TypeScript publication-session report",
    "node",
    ["--no-warnings", TYPESCRIPT_REPORT],
    "typescript",
  );
  const python = runReport(
    "Python publication-session report",
    "uv",
    ["run", "--project", "python", "python", PYTHON_REPORT],
    "python",
  );
  assert.equal(typescript.successBytes, python.successBytes,
    "TypeScript/Python publication-session success bytes differ");
  assert.equal(typescript.cancellationBytes, python.cancellationBytes,
    "TypeScript/Python publication-session cancellation bytes differ");
  assert.deepEqual(typescript.activatedBytes, python.activatedBytes,
    "TypeScript/Python activated normalized bytes differ");
});
