import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const SCHEMA_PATH = fileURLToPath(new URL(
  "./sqlite-cursor-publication-native-projection-np1.schema.json",
  import.meta.url,
));
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const ENGINE = new Ajv2020({ allErrors: true, strict: true });
const VALIDATE = ENGINE.compile(SCHEMA);

export const NP1_FAMILY_ORDER = Object.freeze([
  "schema-envelope",
  "migration-lineage",
  "stream-head",
  "record-identity",
  "checkpoint-current",
  "checkpoint-revision",
  "lease-current",
  "used-lease-identity",
  "legal-hold",
  "migration-lock-current",
  "used-migration-lock-identity",
  "legacy-operation",
]);

export const NP1_SUCCESS_CASES = Object.freeze([
  Object.freeze(["baseline-dynamic-0-total-3", 0, 3]),
  Object.freeze(["baseline-dynamic-1-total-4", 1, 4]),
  Object.freeze(["baseline-dynamic-3-total-6", 3, 6]),
]);

export const NP1_REJECTION_CASES = Object.freeze([
  Object.freeze(["baseline-total-0-impossible", 0]),
  Object.freeze(["baseline-total-1-impossible", 1]),
]);

export const NP1_NORMALIZED_SQL_SHA256 = Object.freeze([
  "d463cf27633ca463ff1cc0ff57ccc632addf74d5c4f641aeb6425508fd9a840d",
  "c43f6ea643b6e2c03200609416e7c7d6bfdb735ca96f7fc83e2c7a474d6d3d4e",
  "30a30fe14c69e7d9f1795b29800fae147df3b44cf938d08b6734c44d5dfb8044",
  "4c92628b34578bcfeeca4d1003b3bdb2ce6c723405185db6bf12fe16b3581b4d",
  "fc3ac0e541a22d5afbdd25c19d3883addd0e9bef09ad63c6343389716c98102b",
  "bb15b913e9f3881f515c4a8712ad3e05b6133558e8b5170a21f833444c54eecd",
  "bed724e3679e1c12eb81f017f748bd7a45c119673fbd4cd914d4b075485f5b04",
  "315c46c5ad6064c39ed153b6e86f4fc1ac93093bbeb1520281e059097605d8a8",
  "85819d020543c637a1eea9eaeb8d84a6e5e11c6d292e59dfddfccbdbcba5c63f",
  "090564e9a36643dfaa705dac5eefd0a86acff04bfc000cd397202ddc8242fe0d",
  "8f4c8983ce55744fe36f398cb990f0bbf06c9787189180669d6d26ae58baf2a2",
  "e186ae71f91a771a95e41f05497f6e2c0ec3e38a7c7d6d16c17713cece498a02",
]);

export class SQLiteNativeProjectionReportError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SQLiteNativeProjectionReportError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SQLiteNativeProjectionReportError(code, message);
}

function codePointCompare(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function canonicalReportJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalReportJson).join(",")}]`;
  const keys = Object.keys(value).sort(codePointCompare);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalReportJson(value[key])}`)
    .join(",")}}`;
}

function assertExactFamilyVector(vector, label) {
  assert.deepEqual(
    vector.map((entry) => entry.entryKind),
    NP1_FAMILY_ORDER,
    `${label} family order drifted`,
  );
  assert.equal(new Set(vector.map((entry) => entry.entryKind)).size, 12,
    `${label} family identities must be unique`);
}

function validatePortableSemantics(portable) {
  assert.deepEqual(
    portable.successCases.map((entry) => entry.caseId),
    NP1_SUCCESS_CASES.map(([caseId]) => caseId),
    "NP1 success case order drifted",
  );
  assert.deepEqual(
    portable.rejectionCases.map((entry) => entry.caseId),
    NP1_REJECTION_CASES.map(([caseId]) => caseId),
    "NP1 rejection case order drifted",
  );

  let orderedNormalizedSqlSha256;
  let sourceEnvelopeSha256;
  const projectionDigests = new Set();
  for (let index = 0; index < NP1_SUCCESS_CASES.length; index += 1) {
    const [caseId, optionalCount, total] = NP1_SUCCESS_CASES[index];
    const entry = portable.successCases[index];
    assert.equal(entry.caseId, caseId);
    assert.equal(entry.optionalDynamicCount, optionalCount,
      `${caseId} optional count drifted`);
    assert.equal(entry.expectedProjectionCount, total,
      `${caseId} expected total drifted`);
    assert.equal(entry.retainedProjectionCount, total,
      `${caseId} retained total drifted`);
    assert.equal(entry.decodeCount, total, `${caseId} decode total drifted`);
    assertExactFamilyVector(entry.expectedFamilyCounts, `${caseId} expected`);
    assertExactFamilyVector(entry.observedFamilyCounts, `${caseId} observed`);
    assert.deepEqual(entry.observedFamilyCounts, entry.expectedFamilyCounts,
      `${caseId} observed counts drifted`);
    assert.equal(
      entry.expectedFamilyCounts.reduce((sum, family) => sum + family.count, 0),
      total,
      `${caseId} family count conservation failed`,
    );
    assert.equal(entry.expectedFamilyCounts[0].count, 1,
      `${caseId} schema singleton drifted`);
    assert.equal(entry.expectedFamilyCounts[1].count, 1,
      `${caseId} migration singleton drifted`);
    assert.equal(entry.expectedFamilyCounts[9].count, 1,
      `${caseId} migration-lock singleton drifted`);
    assert.equal(entry.expectedFamilyCounts[11].count, optionalCount,
      `${caseId} optional legacy-operation count drifted`);
    for (const [familyIndex, family] of entry.expectedFamilyCounts.entries()) {
      if (![0, 1, 9, 11].includes(familyIndex)) {
        assert.equal(family.count, 0, `${caseId} unexpected optional family ${family.entryKind}`);
      }
    }
    if (orderedNormalizedSqlSha256 === undefined) {
      orderedNormalizedSqlSha256 = entry.orderedNormalizedSqlSha256;
    } else {
      assert.deepEqual(
        entry.orderedNormalizedSqlSha256,
        orderedNormalizedSqlSha256,
        `${caseId} ordered normalized SQL inventory drifted`,
      );
    }
    assert.deepEqual(
      entry.orderedNormalizedSqlSha256,
      NP1_NORMALIZED_SQL_SHA256,
      `${caseId} normalized SQL inventory is not the frozen NP1 oracle`,
    );
    if (sourceEnvelopeSha256 === undefined) sourceEnvelopeSha256 = entry.sourceEnvelopeSha256;
    else assert.equal(entry.sourceEnvelopeSha256, sourceEnvelopeSha256,
      `${caseId} source envelope drifted`);
    projectionDigests.add(entry.projectionCanonicalSha256);
  }
  assert.equal(projectionDigests.size, 3, "NP1 distinct projections share one digest");

  for (let index = 0; index < NP1_REJECTION_CASES.length; index += 1) {
    const [caseId, requested] = NP1_REJECTION_CASES[index];
    const entry = portable.rejectionCases[index];
    assert.equal(entry.caseId, caseId);
    assert.equal(entry.requestedProjectionCount, requested,
      `${caseId} requested total drifted`);
  }
}

function validateRuntimeLocalSemantics(runtimeLocal) {
  assert.deepEqual(
    runtimeLocal.successCases.map((entry) => entry.caseId),
    NP1_SUCCESS_CASES.map(([caseId]) => caseId),
    "NP1 runtime-local case order drifted",
  );
  const orderedRawSqlSha256 = runtimeLocal.successCases[0].orderedRawSqlSha256;
  for (const entry of runtimeLocal.successCases.slice(1)) {
    assert.deepEqual(
      entry.orderedRawSqlSha256,
      orderedRawSqlSha256,
      `${entry.caseId} runtime-local raw SQL inventory drifted`,
    );
  }
}

export function validateSQLiteNativeProjectionReport(report) {
  if (!VALIDATE(report)) {
    return fail(
      "GE_SQLITE_P11_NP1_REPORT_SCHEMA",
      ENGINE.errorsText(VALIDATE.errors, { separator: "; " }),
    );
  }
  try {
    validatePortableSemantics(report.portable);
    validateRuntimeLocalSemantics(report.runtimeLocal);
  } catch (error) {
    return fail("GE_SQLITE_P11_NP1_REPORT_SEMANTICS", error.message);
  }
  return report;
}

export function assertSQLiteNativeProjectionPortableParity(typescript, python) {
  validateSQLiteNativeProjectionReport(typescript);
  validateSQLiteNativeProjectionReport(python);
  if (typescript.implementation !== "typescript" || python.implementation !== "python") {
    return fail("GE_SQLITE_P11_NP1_REPORT_RUNTIME", "NP1 parity runtime labels are invalid");
  }
  const left = canonicalReportJson(typescript.portable);
  const right = canonicalReportJson(python.portable);
  if (left !== right) {
    return fail("GE_SQLITE_P11_NP1_REPORT_PARITY", "NP1 portable reports diverged");
  }
  return Object.freeze({
    portableBytes: Buffer.byteLength(left),
    successCaseCount: typescript.portable.successCases.length,
    rejectionCaseCount: typescript.portable.rejectionCases.length,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify({
    contractId: "sqlite-cursor-publication-native-projection-np1/v1",
    familyCount: NP1_FAMILY_ORDER.length,
    rejectionCaseCount: NP1_REJECTION_CASES.length,
    successCaseCount: NP1_SUCCESS_CASES.length,
  }));
}
