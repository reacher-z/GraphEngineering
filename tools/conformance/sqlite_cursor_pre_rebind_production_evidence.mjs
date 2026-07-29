#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const populations = process.argv.slice(2).map(Number);
const requestedPopulations = populations.length === 0 ? [128, 1_024] : populations;
assert.equal(requestedPopulations.every((population) => [128, 1_024].includes(population)), true);
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
function report(command, args) {
  const child = spawnSync(command, args, {
    cwd: root,
    detached: process.platform !== "win32",
    encoding: "utf8",
    maxBuffer: 32 << 20,
    // Both runtime characterizations are independently bounded inside the
    // parity orchestrator's twelve-minute production-evidence budget.
    timeout: 5 * 60_000,
  });
  terminateTimedOutProcessGroup(child);
  const output = [child.stdout, child.stderr].filter(Boolean).join("\n--- stderr ---\n");
  if (child.error !== undefined) {
    const termination = `status=${child.status ?? "null"}, signal=${child.signal ?? "none"}`;
    throw new Error(
      `${command} production evidence failed (${termination}, error=${child.error.message})`
        + (output ? `:\n${output}` : ""),
    );
  }
  if (child.status !== 0) {
    const termination = `status=${child.status ?? "null"}, signal=${child.signal ?? "none"}`;
    throw new Error(
      `${command} production evidence failed (${termination})${output ? `:\n${output}` : ""}`,
    );
  }
  return JSON.parse(child.stdout);
}

const typescript = report("node", [
  "--no-warnings", "tools/conformance/sqlite_cursor_pre_rebind_typescript_campaign_evidence.mjs",
  ...requestedPopulations.map(String),
]);
const python = report("uv", [
  "run", "--project", "python", "python",
  "tools/conformance/sqlite_cursor_pre_rebind_python_campaign_evidence.py",
  ...requestedPopulations.map(String),
]);
assert.equal(typescript.contract, python.contract);
assert.deepEqual(typescript.campaigns.map(({ population }) => population), requestedPopulations);
assert.deepEqual(python.campaigns.map(({ population }) => population), requestedPopulations);

const normalized = [];
for (const population of requestedPopulations) {
  const ts = typescript.campaigns.find((item) => item.population === population);
  const py = python.campaigns.find((item) => item.population === population);
  assert.ok(ts && py);
  for (const item of [ts, py]) {
    assert.equal(item.outcome, "pre-rebind-complete");
    assert.equal(item.exactInputReceipt, true);
    assert.equal(item.exactProjectionIdentity, true);
    assert.equal(item.observedRootSha256, item.expectedRootSha256);
    assert.equal(item.resourceEvidence.maximumActiveRegisteredCursors, 1);
    assert.equal(item.resourceEvidence.pointLookupExecutions > 0, true);
    assert.equal(item.resourceEvidence.pointLookupExecutionsByKind.event > 0, true);
    assert.equal(item.resourceEvidence.pointLookupExecutionsByKind.checkpoint > 0, true);
    assert.equal([
      "instrumented-native-statement-get",
      "instrumented-owner-execute-and-cursor-close",
    ].includes(item.resourceEvidence.pointLookupEvidence), true);
    assert.equal((item.resourceEvidence.maximumNestedPointLookup
      ?? item.resourceEvidence.maximumNestedPointOperations), 1);
    assert.equal((item.resourceEvidence.finalNestedPointLookup
      ?? item.resourceEvidence.currentNestedPointOperations), 0);
    assert.equal(item.resourceEvidence.maximumFetchSize, 1);
    assert.equal(item.resourceEvidence.maximumLiveRawRows, 1);
    assert.equal(item.resourceEvidence.maximumLiveCarriers, 1);
    assert.equal(item.resourceEvidence.maximumTempObjects, 1);
    assert.equal(item.resourceEvidence.currentTempObjectCount, 1);
    assert.equal(item.resourceEvidence.finalTempObjectCount, 1);
    assert.equal(item.resourceEvidence.tempObjectCountEvidence,
      "in-campaign-temp-schema-scalar");
    assert.equal(item.resourceEvidence.tempObjectMeasurementProvenance,
      "in-campaign-temp-schema-scalar");
    assert.equal(item.resourceEvidence.tempObjectMeasurements >= 3, true);
    assert.equal(item.resourceEvidence.maximumTempRows, population);
    assert.equal(item.resourceEvidence.finalActiveRegisteredCursors, 0);
    assert.equal(item.resourceEvidence.tempObjectCount, 1);
    assert.equal(item.resourceEvidence.finalTempObjectCount,
      item.resourceEvidence.tempObjectCount);
    assert.equal(item.resourceEvidence.tempRowCount, population);
    assert.equal(item.eqpEvidenceProvenance, "in-campaign-registered-cursor");
    assert.ok(item.resourceEvidence.tempPageCountAfter >= item.resourceEvidence.tempPageCountBefore);
    assert.ok(item.resourceEvidence.tempPageCountAfter - item.resourceEvidence.tempPageCountBefore
      < population + 64);
    assert.equal(item.eqp.length, 15);
    assert.equal(item.eqp.flatMap(({ details }) => details).some((detail) =>
      ["AUTOMATIC", "MATERIALIZE", "USE TEMP B-TREE", "CO-ROUTINE"]
        .some((fragment) => detail.includes(fragment))), false);
  }
  assert.equal(ts.observedRootSha256, py.observedRootSha256);
  assert.equal(ts.eqpEvidenceProvenance, py.eqpEvidenceProvenance);
  assert.deepEqual(ts.eqp, py.eqp);
  assert.deepEqual(
    ts.resourceEvidence.pointLookupExecutionsByKind,
    py.resourceEvidence.pointLookupExecutionsByKind,
  );
  normalized.push({
    population,
    rootSha256: ts.observedRootSha256,
    eqpStatements: ts.eqp.length,
    eqpEvidenceProvenance: ts.eqpEvidenceProvenance,
    typescript: ts.resourceEvidence,
    python: py.resourceEvidence,
  });
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  contract: typescript.contract,
  status: "production-evidence-complete",
  campaigns: normalized,
}, null, 2)}\n`);
