import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compareUnicodeCodePoints } from "./sqlite-native-callsite-discovery.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCANNER = path.join(REPOSITORY_ROOT, "tools/sqlite-native-callsite-discovery.mjs");
const PYTHON_REPORTER = path.join(
  REPOSITORY_ROOT,
  "python/tests/sqlite_native_callsite_classification_report.py",
);
const CATEGORIES = [
  "confirmed-native-receiver",
  "wrapper-guard-or-test-like-production-probe",
  "false-positive",
  "unknown",
];
const SHA256 = /^[0-9a-f]{64}$/u;

function runScanner() {
  return spawnSync(
    process.execPath,
    ["--no-warnings", SCANNER, "--root", REPOSITORY_ROOT],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

function runPythonReporter() {
  return spawnSync(
    "uv",
    ["run", "--project", "python", "python", PYTHON_REPORTER],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
}

function decodeCleanJsonProcess(result, label) {
  assert.equal(result.error, undefined, `${label} spawn error: ${String(result.error)}`);
  assert.equal(result.signal, null, `${label} signal: ${String(result.signal)}`);
  assert.equal(result.status, 0, `${label} exit ${String(result.status)}: ${result.stderr}`);
  assert.equal(result.stderr, "", `${label} wrote unexpected stderr`);
  assert.equal(result.stdout.endsWith("\n"), true, `${label} must end in one newline`);
  assert.equal(result.stdout.match(/\n/gu)?.length, 1, `${label} must emit one JSON line`);
  const decoded = JSON.parse(result.stdout);
  assert.equal(result.stdout, `${JSON.stringify(decoded)}\n`, `${label} JSON is not canonical`);
  return decoded;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareUnicodeCodePoints).map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function baseIdentity(callsite) {
  return {
    path: callsite.path,
    line: callsite.line,
    column: callsite.column,
    method: callsite.method,
    sqlOrigin: callsite.sqlOrigin,
  };
}

function stableIdentityKey(callsite) {
  return stableJson({ language: callsite.language, ...baseIdentity(callsite) });
}

function scannerPythonIdentities(callsites) {
  const candidates = callsites
    .filter(({ language }) => language === "python")
    .map((callsite) => ({
      callsite,
      canonical: stableJson(callsite),
      identity: baseIdentity(callsite),
    }))
    .sort((left, right) => (
      compareUnicodeCodePoints(left.identity.path, right.identity.path)
      || left.identity.line - right.identity.line
      || left.identity.column - right.identity.column
      || compareUnicodeCodePoints(left.identity.method, right.identity.method)
      || compareUnicodeCodePoints(left.identity.sqlOrigin, right.identity.sqlOrigin)
      || compareUnicodeCodePoints(left.canonical, right.canonical)
    ));
  const occurrences = new Map();
  return candidates.map(({ identity }) => {
    const key = stableJson(identity);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return { ...identity, occurrence };
  });
}

function candidateIdFor(identity) {
  return crypto.createHash("sha256").update(stableJson(identity)).digest("hex");
}

test("Python classifier is a deterministic one-to-one partition of scanner candidates", () => {
  const scannerFirstProcess = runScanner();
  const scannerSecondProcess = runScanner();
  const classifierFirstProcess = runPythonReporter();
  const classifierSecondProcess = runPythonReporter();

  const scannerFirst = decodeCleanJsonProcess(scannerFirstProcess, "Node scanner first run");
  const scannerSecond = decodeCleanJsonProcess(scannerSecondProcess, "Node scanner second run");
  const classifierFirst = decodeCleanJsonProcess(
    classifierFirstProcess,
    "Python classifier first run",
  );
  const classifierSecond = decodeCleanJsonProcess(
    classifierSecondProcess,
    "Python classifier second run",
  );
  assert.equal(scannerFirstProcess.stdout, scannerSecondProcess.stdout);
  assert.deepEqual(scannerSecond, scannerFirst);
  assert.equal(classifierFirstProcess.stdout, classifierSecondProcess.stdout);
  assert.deepEqual(classifierSecond, classifierFirst);

  assert.equal(scannerFirst.callsites.length, 485);
  assert.equal(scannerFirst.summary.callsiteCount, 485);
  const scannerIdentities = scannerFirst.callsites.map(stableIdentityKey);
  assert.equal(new Set(scannerIdentities).size, 485, "scanner stable identities must be unique");
  const scannerLanguageCounts = Object.fromEntries(
    ["python", "typescript"].map((language) => [
      language,
      scannerFirst.callsites.filter((callsite) => callsite.language === language).length,
    ]),
  );
  assert.deepEqual(scannerLanguageCounts, { python: 254, typescript: 231 });
  assert.deepEqual(scannerFirst.summary.byLanguage, scannerLanguageCounts);
  assert.equal(scannerFirst.inputs.pythonFiles.length > 0, true);
  assert.equal(scannerFirst.inputs.typescriptFiles.length > 0, true);
  assert.equal(scannerFirst.routeClosureClaimed, false);

  const expectedPythonIdentities = scannerPythonIdentities(scannerFirst.callsites);
  const actualPythonIdentities = classifierFirst.candidates.map(({ identity }) => identity);
  assert.equal(expectedPythonIdentities.length, 254);
  assert.equal(actualPythonIdentities.length, 254);
  assert.deepEqual(actualPythonIdentities, expectedPythonIdentities);
  assert.equal(
    new Set(actualPythonIdentities.map(stableJson)).size,
    254,
    "classifier identity plus duplicate occurrence must be unique",
  );

  const candidateIds = classifierFirst.candidates.map(({ candidateId }) => candidateId);
  assert.equal(candidateIds.every((candidateId) => SHA256.test(candidateId)), true);
  assert.equal(new Set(candidateIds).size, 254, "candidate IDs must be unique");
  classifierFirst.candidates.forEach((candidate) => {
    assert.equal(candidate.candidateId, candidateIdFor(candidate.identity));
  });

  const reportedCounts = classifierFirst.summary.categoryCounts;
  assert.deepEqual(Object.keys(reportedCounts), CATEGORIES);
  assert.equal(CATEGORIES.reduce((total, category) => total + reportedCounts[category], 0), 254);
  const observedCounts = Object.fromEntries(CATEGORIES.map((category) => [
    category,
    classifierFirst.candidates.filter((candidate) => candidate.category === category).length,
  ]));
  assert.deepEqual(reportedCounts, observedCounts);
  assert.equal(classifierFirst.summary.inputPythonCandidateCount, 254);
  assert.equal(classifierFirst.summary.classifiedCandidateCount, 254);
  assert.equal(classifierFirst.summary.unknownCount, reportedCounts.unknown);

  assert.deepEqual(classifierFirst.classificationPolicy, {
    routeAuthorization: false,
    routeClosureClaimed: false,
    nameHeuristicsCanConfirmNativeReceiver: false,
    crossFunctionReturnInference: false,
    unknownCandidatesDropped: false,
  });
  assert.deepEqual(classifierFirst.sourceScannerPolicy, {
    routeClosureClaimed: false,
    classificationConsumesReadOnlyJson: true,
  });
});

test("cross-process decoder fails closed on spawn errors, nonzero exits, and stderr", () => {
  const clean = {
    error: undefined,
    signal: null,
    status: 0,
    stderr: "",
    stdout: "{}\n",
  };
  assert.deepEqual(decodeCleanJsonProcess(clean, "clean fixture"), {});
  assert.throws(
    () => decodeCleanJsonProcess({ ...clean, error: new Error("missing") }, "spawn fixture"),
    /spawn error/u,
  );
  assert.throws(
    () => decodeCleanJsonProcess({ ...clean, status: 9 }, "exit fixture"),
    /exit 9/u,
  );
  assert.throws(
    () => decodeCleanJsonProcess({ ...clean, stderr: "warning\n" }, "stderr fixture"),
    /unexpected stderr/u,
  );
});
