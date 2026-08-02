import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCursorPublicationFixture,
  parseStrictJson,
  validateCanonicalCursorPublicationFixture,
} from "../../spec/conformance/sqlite-cursor-publication-rebind-v2.validate.mjs";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TYPESCRIPT_REPORT = "tools/conformance/sqlite_cursor_publication_initial_typescript_report.mjs";
const PYTHON_REPORT = "tools/conformance/sqlite_cursor_publication_initial_python_report.py";
const REPORT_FIELDS = Object.freeze([
  "runtime",
  "publicExports",
  "counterProbe",
  "rollbackCount",
  "cases",
]);
const PUBLIC_EXPORT_FIELDS = Object.freeze([
  "packageRootAdoption",
  "packageRootMeasurement",
]);
const NORMALIZED_FIELDS = Object.freeze([
  "caseId",
  "outcome",
  "failureBoundary",
  "state",
  "poisoned",
  "providerClockReadCount",
  "clockEvidenceConsumeCount",
  "outerAuthorityMintCount",
  "perWritePrepareCounts",
  "perWriteExecuteCounts",
  "perWriteAffectedRowCounts",
  "perWriteTotalChangesDeltas",
  "outerLedgerLogicalWriteSequence",
  "outerLedgerFixedStatementCount",
  "outerLedgerAffectedRowsWatermark",
  "postDdlCatalogFenceMintCount",
  "readerLeaseMintCount",
  "readerLeaseCloseCount",
  "initialWriteReceiptMintCount",
  "initialWriteReceiptConsumeCount",
  "initialWriteReceiptTombstoneCount",
  "stageAdoptionReceiptMintCount",
  "bundleRetryable",
  "sameTransactionLineage",
  "catalogFenceMatches",
  "cursorRebindPrepareCount",
  "cursorRebindExecuteCount",
  "commitCount",
]);
const EXPECTED_CASE_IDS = Object.freeze([
  "initial-publication-success-control",
  "initial-publication-invalid-adoption-bundle",
  "initial-publication-post-0002-catalog-drift",
]);

// This validates the schema, frozen fixture digest, hostile registry digests,
// migration assets and every semantic contract before the comparator derives
// an oracle from the fixture. A report can never weaken its own comparator.
validateCanonicalCursorPublicationFixture();
const FIXTURE = loadCursorPublicationFixture();
const PARITY = FIXTURE.parityGates.initialPublicationNormalizedOutput;
const EXPECTED_RECORD_BYTES = JSON.stringify(PARITY.expectedRecords);
const EXPECTED_PROBE = Object.freeze({
  ...PARITY.counterSelfProbe,
  rollbackCount: 1,
});
const PROBE_FIELDS = Object.freeze(Object.keys(EXPECTED_PROBE));
const ALLOWED_OUTCOMES = new Set(["success", "rejected", "poisoned"]);
const ALLOWED_STATES = new Set(FIXTURE.stateMachine.states);

assert.deepEqual(PARITY.orderedFields, NORMALIZED_FIELDS);
assert.equal(NORMALIZED_FIELDS.length, 28);
assert.deepEqual(PARITY.expectedRecords.map(({ caseId }) => caseId), EXPECTED_CASE_IDS);
assert.equal(PARITY.preRebindCasesRequireZeroCursorRebindAndCommitCounts, true);

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

function validateNormalizedRecord(record, index) {
  const label = `cases[${index}]`;
  assertExactKeys(record, NORMALIZED_FIELDS, label);
  assert.equal(record.caseId, EXPECTED_CASE_IDS[index], `${label}.caseId or record order differs`);

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
      value.forEach((entry, arrayIndex) => {
        assertNonnegativeSafeInteger(entry, `${label}.${field}[${arrayIndex}]`);
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

function validatePublicExports(value, runtime) {
  assertExactKeys(value, PUBLIC_EXPORT_FIELDS, `${runtime}.publicExports`);
  for (const [name, exported] of Object.entries(value)) {
    assert.equal(exported, false, `${runtime} leaked private adoption or measurement API at ${name}`);
  }
}

function validateCounterProbe(value, runtime) {
  assertExactKeys(value, PROBE_FIELDS, `${runtime}.counterProbe`);
  assert.equal(JSON.stringify(value), JSON.stringify(EXPECTED_PROBE),
    `${runtime}.counterProbe did not activate every frozen recorder exactly once`);
}

function validateReport(value, expectedRuntime) {
  assertExactKeys(value, REPORT_FIELDS, `${expectedRuntime} report`);
  assert.equal(value.runtime, expectedRuntime, `${expectedRuntime} report runtime differs`);
  validatePublicExports(value.publicExports, expectedRuntime);
  validateCounterProbe(value.counterProbe, expectedRuntime);
  assert.equal(value.rollbackCount, 0,
    `${expectedRuntime} subject controls executed rollback before reporting`);
  assert.ok(Array.isArray(value.cases), `${expectedRuntime}.cases must be an array`);
  assert.equal(value.cases.length, 3, `${expectedRuntime} must emit exactly three records`);
  value.cases.forEach(validateNormalizedRecord);

  const recordBytes = JSON.stringify(value.cases);
  assert.equal(recordBytes, EXPECTED_RECORD_BYTES,
    `${expectedRuntime} records differ from the frozen fixture`);
  return Object.freeze({ recordBytes, report: value });
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
    publicExports: {
      packageRootAdoption: false,
      packageRootMeasurement: false,
    },
    counterProbe: clone(EXPECTED_PROBE),
    rollbackCount: 0,
    cases: clone(PARITY.expectedRecords),
  };
}

function reorderedObject(value, leftIndex, rightIndex) {
  const entries = Object.entries(value);
  [entries[leftIndex], entries[rightIndex]] = [entries[rightIndex], entries[leftIndex]];
  return Object.fromEntries(entries);
}

test("initial publication reports have exact real-SQLite TypeScript/Python parity", {
  timeout: 40 * 60_000,
}, () => {
  const typescript = runReport(
    "TypeScript initial-publication report",
    "node",
    ["--no-warnings", TYPESCRIPT_REPORT],
    "typescript",
  );
  const python = runReport(
    "Python initial-publication report",
    "uv",
    ["run", "--project", "python", "python", PYTHON_REPORT],
    "python",
  );

  assert.equal(typescript.recordBytes, python.recordBytes,
    "TypeScript/Python canonical normalized bytes differ");
  assert.equal(typescript.recordBytes, EXPECTED_RECORD_BYTES,
    "cross-runtime normalized bytes differ from the frozen fixture");
});

test("initial publication comparator rejects hostile report structure and values", () => {
  const reject = (description, mutate, pattern) => {
    const value = validEnvelope();
    mutate(value);
    assert.throws(() => validateReport(value, "typescript"), pattern, description);
  };

  reject("wrong envelope order", (value) => {
    const reordered = reorderedObject(value, 0, 1);
    for (const key of Object.keys(value)) delete value[key];
    Object.assign(value, reordered);
  }, /keys or key order differ/u);
  reject("missing envelope field", (value) => { delete value.rollbackCount; }, /keys or key order/u);
  reject("extra envelope field", (value) => { value.extra = 0; }, /keys or key order/u);
  reject("wrong runtime", (value) => { value.runtime = "python"; }, /runtime differs/u);
  reject("empty public export proof", (value) => {
    value.publicExports = {};
  }, /keys or key order/u);
  reject("missing public export proof", (value) => {
    delete value.publicExports.packageRootMeasurement;
  }, /keys or key order/u);
  reject("extra public export proof", (value) => {
    value.publicExports.extra = false;
  }, /keys or key order/u);
  reject("reordered public export proof", (value) => {
    value.publicExports = reorderedObject(value.publicExports, 0, 1);
  }, /keys or key order/u);
  reject("public export leak", (value) => {
    value.publicExports.packageRootAdoption = true;
  }, /leaked/u);
  reject("mistyped public export proof", (value) => {
    value.publicExports.packageRootMeasurement = 0;
  }, /false/u);
  reject("zero-valued counter probe", (value) => {
    value.counterProbe.providerClockReadCount = 0;
  }, /exactly once/u);
  reject("missing counter probe", (value) => {
    delete value.counterProbe.commitCount;
  }, /keys or key order/u);
  reject("extra counter probe", (value) => { value.counterProbe.extra = 1; }, /keys or key order/u);
  reject("reordered counter probe", (value) => {
    value.counterProbe = reorderedObject(value.counterProbe, 0, 1);
  }, /keys or key order/u);
  reject("subject rollback", (value) => { value.rollbackCount = 1; }, /executed rollback/u);
  reject("cases is not an array", (value) => { value.cases = {}; }, /must be an array/u);
  reject("missing record", (value) => { value.cases.pop(); }, /exactly three/u);
  reject("extra record", (value) => { value.cases.push(clone(value.cases[0])); }, /exactly three/u);
  reject("wrong record order", (value) => {
    [value.cases[0], value.cases[1]] = [value.cases[1], value.cases[0]];
  }, /caseId or record order/u);
  reject("missing record field", (value) => { delete value.cases[0].commitCount; }, /keys or key order/u);
  reject("extra record field", (value) => { value.cases[0].extra = 0; }, /keys or key order/u);
  reject("reordered record field", (value) => {
    value.cases[0] = reorderedObject(value.cases[0], 0, 1);
  }, /keys or key order/u);
  reject("empty case ID", (value) => { value.cases[0].caseId = ""; }, /caseId or record order/u);
  reject("invalid outcome", (value) => { value.cases[0].outcome = "ok"; }, /frozen outcome/u);
  reject("invalid failure slug", (value) => {
    value.cases[1].failureBoundary = "Not A Slug";
  }, /lowercase slug/u);
  reject("invalid state", (value) => { value.cases[0].state = "adopted"; }, /frozen state/u);
  reject("mistyped Boolean", (value) => { value.cases[0].poisoned = 0; }, /must be Boolean/u);
  reject("negative integer", (value) => {
    value.cases[0].providerClockReadCount = -1;
  }, /nonnegative safe integer/u);
  reject("fractional integer", (value) => {
    value.cases[0].providerClockReadCount = 0.5;
  }, /nonnegative safe integer/u);
  reject("unsafe integer", (value) => {
    value.cases[0].providerClockReadCount = Number.MAX_SAFE_INTEGER + 1;
  }, /nonnegative safe integer/u);
  reject("wrong array length", (value) => {
    value.cases[0].perWritePrepareCounts.pop();
  }, /exactly four counters/u);
  reject("negative array integer", (value) => {
    value.cases[0].perWritePrepareCounts[0] = -1;
  }, /nonnegative safe integer/u);
  reject("mistyped array integer", (value) => {
    value.cases[0].perWritePrepareCounts[0] = "20";
  }, /nonnegative safe integer/u);
  reject("swapped write order", (value) => {
    [value.cases[0].perWriteExecuteCounts[0], value.cases[0].perWriteExecuteCounts[1]] =
      [value.cases[0].perWriteExecuteCounts[1], value.cases[0].perWriteExecuteCounts[0]];
  }, /frozen fixture/u);
  reject("fixture counter divergence", (value) => {
    value.cases[0].outerLedgerFixedStatementCount += 1;
  }, /frozen fixture/u);
  reject("cursor rebind prepare crossed", (value) => {
    value.cases[0].cursorRebindPrepareCount = 1;
  }, /cursor-rebind prepare/u);
  reject("cursor rebind execute crossed", (value) => {
    value.cases[0].cursorRebindExecuteCount = 1;
  }, /cursor-rebind execute/u);
  reject("commit crossed", (value) => { value.cases[0].commitCount = 1; }, /commit boundary/u);
});

test("initial publication comparator rejects hostile stdout and child termination", () => {
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
  assert.throws(() => parseStrictJson('{"cases":[{"caseId":"a","caseId":"b"}]}'),
    /duplicate key caseId/u);
  assert.throws(() => readChildReport("nonzero", {
    status: 1,
    signal: null,
    error: undefined,
    stdout: "",
    stderr: "failed",
  }, "typescript"), /status=1/u);
  assert.throws(() => readChildReport("signal", {
    status: null,
    signal: "SIGTERM",
    error: undefined,
    stdout: "",
    stderr: "",
  }, "typescript"), /signal=SIGTERM/u);
});
