#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "../..");
const registryPath = resolve(
  root, "tools/conformance/sqlite_cursor_pre_rebind_70_case_coverage.json",
);
const fixturePath = resolve(root, "spec/conformance/sqlite-cursor-pre-rebind-v1.case.json");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    throw new Error(`${name} is required`);
  }
  return resolve(process.argv[index + 1]);
};
const typescriptMappingIndex = process.argv.indexOf("--typescript-mapping-only");
const typescriptMappingPath = typescriptMappingIndex < 0 ? undefined
  : resolve(process.argv[typescriptMappingIndex + 1]);
const pythonMappingIndex = process.argv.indexOf("--python-mapping-only");
const pythonMappingPath = pythonMappingIndex < 0 ? undefined
  : resolve(process.argv[pythonMappingIndex + 1]);
const partialMapping = typescriptMappingPath !== undefined || pythonMappingPath !== undefined;
const typescriptPath = !partialMapping
  ? argument("--typescript-report") : undefined;
const pythonPath = !partialMapping ? argument("--python-report") : undefined;
const write = process.argv.includes("--write");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const expectedCaseIds = new Set([
  ...fixture.pristineObligations.scenarios,
  ...fixture.hostileObligations.scenarios,
  ...fixture.lifecycleObligations.scenarios,
].map((scenario) => scenario.name));

function caseIdFromExecutionId(executionId) {
  const tags = [...executionId.matchAll(/\[b2:([^\]]+)\]/gu)]
    .map((match) => match[1].split(":", 1)[0]);
  assert.equal(tags.length, 1, `execution ID must contain exactly one B2 tag: ${executionId}`);
  assert.equal(expectedCaseIds.has(tags[0]), true, `unknown B2 case ID in ${executionId}`);
  return tags[0];
}

function groupExecutionIds(executionIds, runtime) {
  const counts = new Map();
  const grouped = new Map([...expectedCaseIds].map((caseId) => [caseId, []]));
  for (const executionId of executionIds) {
    counts.set(executionId, (counts.get(executionId) ?? 0) + 1);
    const caseId = caseIdFromExecutionId(executionId);
    grouped.get(caseId).push(executionId);
  }
  for (const [executionId, count] of counts) {
    assert.equal(count, 1, `${runtime} duplicate execution ID: ${executionId}`);
  }
  for (const [caseId, ids] of grouped) {
    assert.ok(ids.length > 0, `${runtime} has no execution ID for ${caseId}`);
    ids.sort();
  }
  return grouped;
}

if (typescriptMappingPath !== undefined) {
  const report = JSON.parse(readFileSync(typescriptMappingPath, "utf8"));
  assert.equal(report.summary?.success, true, "TypeScript mapping is not successful");
  const groupedTypescript = groupExecutionIds(
    Object.values(report.mapping).flat(), "typescript",
  );
  for (const entry of registry.cases) {
    for (const executionId of groupedTypescript.get(entry.caseId)) {
      assert.equal(
        executionId.slice(0, executionId.indexOf("::")),
        entry.typescript.file,
        `TypeScript execution file differs for ${entry.caseId}`,
      );
    }
  }
  const migrated = {
    ...registry,
    cases: registry.cases.map((entry) => ({
      ...entry,
      typescript: {
        ...entry.typescript,
        executionIds: groupedTypescript.get(entry.caseId),
      },
    })),
  };
  writeFileSync(registryPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    caseCount: groupedTypescript.size,
    status: "typescript-registry-migrated",
    typescriptExecutionIds: Object.values(report.mapping).flat().length,
  }, null, 2)}\n`);
  process.exit(0);
}

if (pythonMappingPath !== undefined) {
  const report = JSON.parse(readFileSync(pythonMappingPath, "utf8"));
  assert.equal(report.summary?.success, true, "Python mapping is not successful");
  const groupedPython = groupExecutionIds(Object.values(report.mapping).flat(), "python");
  for (const entry of registry.cases) {
    assert.ok(
      Array.isArray(entry.typescript.executionIds)
        && entry.typescript.executionIds.length > 0,
      `TypeScript execution IDs must be migrated before Python: ${entry.caseId}`,
    );
    for (const executionId of groupedPython.get(entry.caseId)) {
      assert.equal(
        executionId.slice(0, executionId.indexOf("::")),
        entry.python.file,
        `Python execution file differs for ${entry.caseId}`,
      );
    }
  }
  const migrated = {
    ...registry,
    auditPolicy: "EXACT requires exclusive canonical executionIds emitted by a real passing runner. Every ID must be owned by one case only; Vitest fullName and pytest nodeid matching is byte-exact with no wildcard, prefix, normalization, title-source, or fallback matching.",
    schemaVersion: 2,
    cases: registry.cases.map((entry) => ({
      ...entry,
      python: {
        ...entry.python,
        executionIds: groupedPython.get(entry.caseId),
      },
    })),
  };
  writeFileSync(registryPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    caseCount: groupedPython.size,
    pythonExecutionIds: Object.values(report.mapping).flat().length,
    status: "registry-migrated",
  }, null, 2)}\n`);
  process.exit(0);
}

const typescriptReport = JSON.parse(readFileSync(typescriptPath, "utf8"));
assert.equal(typescriptReport.success, true, "Vitest report is not successful");
assert.equal(typescriptReport.numFailedTests, 0, "Vitest report contains failures");
assert.equal(typescriptReport.numPendingTests, 0, "Vitest report contains pending tests");
const typescriptIds = [];
for (const file of typescriptReport.testResults) {
  const canonicalFile = relative(root, realpathSync(file.name));
  for (const test of file.assertionResults) {
    if (!test.fullName.includes("[b2:")) continue;
    assert.equal(test.status, "passed", `tagged Vitest assertion did not pass: ${test.fullName}`);
    typescriptIds.push(`${canonicalFile}::${test.fullName}`);
  }
}

const pythonReport = JSON.parse(readFileSync(pythonPath, "utf8"));
assert.equal(pythonReport.exitStatus, 0, "pytest report is not successful");
const pythonIds = pythonReport.tests.filter((test) => test.executionId.includes("[b2:"))
  .map((test) => {
    assert.equal(test.passed, true, `tagged pytest node did not pass: ${test.executionId}`);
    return test.executionId;
  });

const grouped = {
  typescript: groupExecutionIds(typescriptIds, "typescript"),
  python: groupExecutionIds(pythonIds, "python"),
};
for (const entry of registry.cases) {
  for (const runtime of ["typescript", "python"]) {
    for (const executionId of grouped[runtime].get(entry.caseId)) {
      assert.equal(
        executionId.slice(0, executionId.indexOf("::")),
        entry[runtime].file,
        `${runtime} execution file differs from declared real evidence for ${entry.caseId}`,
      );
    }
  }
}
const migrated = {
  ...registry,
  auditPolicy: "EXACT requires exclusive canonical executionIds emitted by a real passing runner. Every ID must be owned by one case only; Vitest fullName and pytest nodeid matching is byte-exact with no wildcard, prefix, normalization, title-source, or fallback matching.",
  schemaVersion: 2,
  cases: registry.cases.map((entry) => ({
    ...entry,
    typescript: {
      ...entry.typescript,
      executionIds: grouped.typescript.get(entry.caseId),
    },
    python: {
      ...entry.python,
      executionIds: grouped.python.get(entry.caseId),
    },
  })),
};

if (write) {
  writeFileSync(registryPath, `${JSON.stringify(migrated, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify({
  caseCount: expectedCaseIds.size,
  pythonExecutionIds: pythonIds.length,
  status: write ? "registry-migrated" : "migration-validated",
  typescriptExecutionIds: typescriptIds.length,
}, null, 2)}\n`);
