#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import process from "node:process";

import Ajv2020 from "ajv/dist/2020.js";

const root = resolve(import.meta.dirname, "../..");
const fixturePath = resolve(root, "spec/conformance/sqlite-cursor-pre-rebind-v1.case.json");
const registryPath = resolve(root, "tools/conformance/sqlite_cursor_pre_rebind_70_case_coverage.json");
const schemaPath = resolve(root, "tools/conformance/sqlite_cursor_pre_rebind_coverage.schema.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const allowOpen = process.argv.includes("--allow-open");
const registryOnly = process.argv.includes("--registry-only");

const groups = [
  ["pristine", fixture.pristineObligations.scenarios],
  ["hostile", fixture.hostileObligations.scenarios],
  ["lifecycle", fixture.lifecycleObligations.scenarios],
];
const expected = new Map(groups.flatMap(([group, scenarios]) =>
  scenarios.map(({ name }) => [name, group])));
const findings = [];
const seen = new Set();
const ajv = new Ajv2020({ allErrors: true, strict: true });
if (!ajv.validateSchema(schema)) {
  findings.push(`schema-invalid:${JSON.stringify(ajv.errors)}`);
} else {
  const validateRegistry = ajv.compile(schema);
  if (!validateRegistry(registry)) {
    findings.push(...(validateRegistry.errors ?? []).map((error) =>
      `schema:${error.instancePath || "$"}:${error.keyword}`));
  }
}

const digestCaseIds = (caseIds) => createHash("sha256")
  .update(JSON.stringify([...caseIds].sort()))
  .digest("hex");

function childDiagnostics(child) {
  const output = [child.stdout, child.stderr].filter(Boolean).join("\n--- stderr ---\n");
  const termination = `status=${child.status ?? "null"},signal=${child.signal ?? "none"}`;
  const systemError = child.error === undefined ? "" : `,error=${child.error.message}`;
  return `${termination}${systemError}${output ? `:\n${output}` : ""}`;
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

function executeRuntimeEvidence() {
  const temporary = mkdtempSync(resolve(tmpdir(), "ge-b2-coverage-"));
  const startedAt = Date.now();
  try {
    const typescriptFiles = [...new Set(registry.cases
      .filter((entry) => entry.typescript.status === "EXACT")
      .map((entry) => entry.typescript.file.replace(/^packages\/sqlite\//u, "")))];
    const vitestOutput = resolve(temporary, "vitest.json");
    const typescript = spawnSync("corepack", [
      "pnpm", "--filter", "@graph-engineering/sqlite", "exec", "vitest", "run",
      ...typescriptFiles, "--reporter=json", "--testTimeout=30000", `--outputFile=${vitestOutput}`,
    ], {
      cwd: root,
      detached: process.platform !== "win32",
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 20 * 60_000,
    });
    terminateTimedOutProcessGroup(typescript);
    if (typescript.error !== undefined) {
      findings.push(
        `execution:typescript-runner-error:${childDiagnostics(typescript)}`,
      );
    }
    if (typescript.status !== 0) {
      findings.push(`execution:typescript-runner:${childDiagnostics(typescript)}`);
    }
    const passedTypescriptIds = [];
    const reportedTypescriptFiles = new Set();
    if (existsSync(vitestOutput)) {
      try {
        const report = JSON.parse(readFileSync(vitestOutput, "utf8"));
        if (report.success !== true || report.numFailedTests !== 0 || report.numPendingTests !== 0) {
          findings.push("execution:typescript-report-not-clean");
        }
        for (const file of report.testResults) {
          const canonicalFile = relative(root, realpathSync(file.name));
          reportedTypescriptFiles.add(canonicalFile);
          if (file.status === "failed" && typeof file.message === "string") {
            findings.push(
              `execution:typescript-file-failed:${canonicalFile}:\n${file.message.slice(0, 16_384)}`,
            );
          }
          for (const test of file.assertionResults) {
            if (test.status === "passed") {
              passedTypescriptIds.push(`${canonicalFile}::${test.fullName}`);
            } else if (test.status === "failed") {
              const messages = Array.isArray(test.failureMessages)
                ? test.failureMessages.join("\n").slice(0, 16_384)
                : "";
              findings.push(
                `execution:typescript-test-failed:${canonicalFile}::${test.fullName}`
                  + (messages ? `:\n${messages}` : ""),
              );
            } else {
              findings.push(
                `execution:typescript-test-${test.status}:${canonicalFile}::${test.fullName}`,
              );
            }
          }
        }
      } catch (error) {
        findings.push(`execution:typescript-report:${String(error)}`);
      }
    } else {
      findings.push("execution:typescript-report-missing");
    }
    const passedTypescript = new Set(passedTypescriptIds);
    if (passedTypescript.size !== passedTypescriptIds.length) {
      const counts = new Map();
      for (const executionId of passedTypescriptIds) {
        counts.set(executionId, (counts.get(executionId) ?? 0) + 1);
      }
      for (const [executionId, count] of counts) {
        if (count > 1) findings.push(`execution:typescript-duplicate:${executionId}:${count}`);
      }
    }
    for (const file of typescriptFiles.map((value) => `packages/sqlite/${value}`)) {
      if (!reportedTypescriptFiles.has(file)) findings.push(`execution:typescript-file-missing:${file}`);
    }

    const pythonFiles = [...new Set(registry.cases
      .filter((entry) => entry.python.status === "EXACT")
      .map((entry) => entry.python.file))];
    const pythonSelectors = registry.cases.flatMap((entry) =>
      entry.python.status === "EXACT" ? entry.python.executionIds : []);
    const pytestOutput = resolve(temporary, "pytest.json");
    const python = spawnSync("uv", [
      "run", "--project", "python", "pytest", "-q",
      "-p", "sqlite_cursor_pre_rebind_pytest_plugin", ...pythonSelectors,
    ], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GE_B2_PYTEST_REPORT: pytestOutput,
        PYTHONPATH: [resolve(root, "tools/conformance"), process.env.PYTHONPATH]
          .filter(Boolean).join(":"),
      },
      maxBuffer: 64 * 1024 * 1024,
      // The exact 302-node Python campaign is CPU-bound and takes roughly
      // eleven minutes on the reference workstation.  Preserve meaningful
      // headroom for slower hosted runners while remaining below the parity
      // orchestrator's 60-minute coverage-child deadline. The preceding
      // TypeScript child owns at most 20 minutes, leaving five minutes for
      // structured parsing and finally cleanup in the outer child.
      timeout: 35 * 60_000,
      detached: process.platform !== "win32",
    });
    terminateTimedOutProcessGroup(python);
    if (python.error !== undefined) {
      findings.push(`execution:python-runner-error:${childDiagnostics(python)}`);
    }
    if (python.status !== 0) {
      findings.push(`execution:python-runner:${childDiagnostics(python)}`);
    }
    const passedPythonIds = [];
    const reportedPythonFiles = new Set();
    if (existsSync(pytestOutput)) {
      try {
        const report = JSON.parse(readFileSync(pytestOutput, "utf8"));
        if (report.exitStatus !== 0 || report.tests.some((test) => test.passed !== true)) {
          findings.push("execution:python-report-not-clean");
        }
        for (const test of report.tests) {
          const separator = test.executionId.indexOf("::");
          if (separator > 0) reportedPythonFiles.add(test.executionId.slice(0, separator));
          if (test.passed === true) passedPythonIds.push(test.executionId);
        }
      } catch (error) {
        findings.push(`execution:python-report:${String(error)}`);
      }
    } else {
      findings.push("execution:python-report-missing");
    }
    const passedPython = new Set(passedPythonIds);
    if (passedPython.size !== passedPythonIds.length) {
      const counts = new Map();
      for (const executionId of passedPythonIds) {
        counts.set(executionId, (counts.get(executionId) ?? 0) + 1);
      }
      for (const [executionId, count] of counts) {
        if (count > 1) findings.push(`execution:python-duplicate:${executionId}:${count}`);
      }
    }
    for (const file of pythonFiles) {
      if (!reportedPythonFiles.has(file)) findings.push(`execution:python-file-missing:${file}`);
    }

    const executed = { typescript: [], python: [] };
    const executionIds = {};
    const caseEvidence = [];
    for (const entry of registry.cases) {
      const tsRequired = entry.typescript.status === "EXACT" ? entry.typescript.executionIds : [];
      const pyRequired = entry.python.status === "EXACT" ? entry.python.executionIds : [];
      const tsMatched = tsRequired.filter((executionId) => passedTypescript.has(executionId));
      const pyMatched = pyRequired.filter((executionId) => passedPython.has(executionId));
      const tsMissing = tsRequired.filter((executionId) => !passedTypescript.has(executionId));
      const pyMissing = pyRequired.filter((executionId) => !passedPython.has(executionId));
      if (entry.typescript.status === "EXACT" && tsMissing.length !== 0) {
        findings.push(`${entry.group}:${entry.caseId}.typescript:not-executed`);
      } else if (entry.typescript.status === "EXACT") {
        executed.typescript.push(entry.caseId);
      }
      if (entry.python.status === "EXACT" && pyMissing.length !== 0) {
        findings.push(`${entry.group}:${entry.caseId}.python:not-executed`);
      } else if (entry.python.status === "EXACT") {
        executed.python.push(entry.caseId);
      }
      caseEvidence.push({
        caseId: entry.caseId,
        group: entry.group,
        python: {
          asserts: entry.python.asserts,
          declaredTitle: entry.python.title,
          matchedExecutionIds: pyMatched,
          missingExecutionIds: pyMissing,
        },
        typescript: {
          asserts: entry.typescript.asserts,
          declaredTitle: entry.typescript.title,
          matchedExecutionIds: tsMatched,
          missingExecutionIds: tsMissing,
        },
      });
    }
    const required = [...expected.keys()].sort();
    for (const runtime of ["typescript", "python"]) {
      executed[runtime].sort();
      const requiredExecutionIds = registry.cases.flatMap((entry) =>
        entry[runtime].status === "EXACT" ? entry[runtime].executionIds : []).sort();
      const passed = runtime === "typescript" ? passedTypescript : passedPython;
      const actualExecutionIds = [...passed]
        .filter((executionId) => /\[b2:[^\]]+\]/u.test(executionId))
        .sort();
      const requiredExecutionIdSet = new Set(requiredExecutionIds);
      const matchedExecutionIds = requiredExecutionIds.filter((executionId) => passed.has(executionId));
      const missingExecutionIds = requiredExecutionIds.filter((executionId) => !passed.has(executionId));
      const unexpectedExecutionIds = actualExecutionIds.filter(
        (executionId) => !requiredExecutionIdSet.has(executionId));
      for (const executionId of unexpectedExecutionIds) {
        findings.push(`execution:${runtime}:unexpected-b2-id:${executionId}`);
      }
      executionIds[runtime] = {
        actualCount: actualExecutionIds.length,
        actualExecutionIds,
        actualExecutionIdsSha256: digestCaseIds(actualExecutionIds),
        matchedCount: matchedExecutionIds.length,
        matchedExecutionIds,
        matchedExecutionIdsSha256: digestCaseIds(matchedExecutionIds),
        missingExecutionIds,
        requiredCount: requiredExecutionIds.length,
        requiredExecutionIds,
        requiredExecutionIdsSha256: digestCaseIds(requiredExecutionIds),
        unexpectedExecutionIds,
      };
      if (JSON.stringify(executed[runtime]) !== JSON.stringify(required)) {
        findings.push(`execution:${runtime}:required-executed-mismatch`);
      }
    }
    return {
      caseEvidence,
      durationMs: Date.now() - startedAt,
      requiredCaseIds: required,
      requiredCaseIdsSha256: digestCaseIds(required),
      runtimes: Object.fromEntries(["typescript", "python"].map((runtime) => [runtime, {
        executedCaseIds: executed[runtime],
        executedCaseIdsSha256: digestCaseIds(executed[runtime]),
        executedCount: executed[runtime].length,
        requiredCount: required.length,
        executionIds: executionIds[runtime],
      }])),
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (registry.schemaVersion !== 2) findings.push("registry.schemaVersion");
if (registry.fixture !== "spec/conformance/sqlite-cursor-pre-rebind-v1.case.json") {
  findings.push("registry.fixture");
}
if (!Array.isArray(registry.cases) || registry.cases.length !== expected.size) {
  findings.push(`registry.cases.length:${registry.cases?.length ?? "non-array"}!=${expected.size}`);
}

const executionOwners = { typescript: new Map(), python: new Map() };
for (const entry of registry.cases ?? []) {
  const key = `${entry.group}:${entry.caseId}`;
  if (seen.has(key)) findings.push(`duplicate:${key}`);
  seen.add(key);
  if (expected.get(entry.caseId) !== entry.group) findings.push(`unexpected:${key}`);
  for (const runtime of ["typescript", "python"]) {
    const evidence = entry[runtime];
    if (!evidence || !["EXACT", "OPEN"].includes(evidence.status)) {
      findings.push(`${key}.${runtime}.status`);
      continue;
    }
    if (evidence.status === "OPEN") {
      if (!allowOpen) findings.push(`${key}.${runtime}:OPEN`);
      continue;
    }
    if (typeof evidence.file !== "string" || typeof evidence.title !== "string") {
      findings.push(`${key}.${runtime}:missing-test-reference`);
      continue;
    }
    const sourcePath = resolve(root, evidence.file);
    if (!existsSync(sourcePath)) {
      findings.push(`${key}.${runtime}:missing-file:${evidence.file}`);
      continue;
    }
    for (const executionId of evidence.executionIds ?? []) {
      const caseTags = [...executionId.matchAll(/\[b2:([^\]]+)\]/gu)]
        .map((match) => match[1].split(":", 1)[0]);
      if (caseTags.length !== 1 || caseTags[0] !== entry.caseId) {
        findings.push(`${key}.${runtime}:execution-case-tag:${executionId}`);
      }
      const separator = executionId.indexOf("::");
      const executionFile = separator < 0 ? "" : executionId.slice(0, separator);
      if (executionFile !== evidence.file) {
        findings.push(`${key}.${runtime}:execution-file-mismatch:${executionId}`);
      }
      const previous = executionOwners[runtime].get(executionId);
      if (previous !== undefined) {
        findings.push(`${key}.${runtime}:execution-id-reused:${executionId}:owned-by:${previous}`);
      } else {
        executionOwners[runtime].set(executionId, key);
      }
    }
  }
}

for (const [caseId, group] of expected) {
  if (!seen.has(`${group}:${caseId}`)) findings.push(`missing:${group}:${caseId}`);
}

const openCount = registry.cases.filter((entry) =>
  entry.typescript.status === "OPEN" || entry.python.status === "OPEN").length;
const execution = registryOnly || findings.length !== 0 ? undefined : executeRuntimeEvidence();
const result = {
  contract: fixture.id,
  caseCount: expected.size,
  exact: {
    typescript: registry.cases.filter((entry) => entry.typescript.status === "EXACT").length,
    python: registry.cases.filter((entry) => entry.python.status === "EXACT").length,
    both: registry.cases.filter((entry) =>
      entry.typescript.status === "EXACT" && entry.python.status === "EXACT").length,
  },
  open: openCount,
  findings: findings.slice(0, 80),
  findingsTruncated: findings.length > 80,
  execution,
  status: findings.length === 0
    ? registryOnly ? "registry-valid-static-only"
      : openCount === 0 ? "coverage-execution-complete" : "coverage-executed-with-open"
    : "coverage-incomplete",
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (findings.length !== 0) process.exitCode = 1;
