#!/usr/bin/env node

import assert from "node:assert/strict";
import test from "node:test";

import {
  BLR_ENTRY_KINDS,
  BLR_RULE_IDS,
  ReconciliationRegistryError,
  loadReconciliationRegistry,
  validateReconciliationDiagnostic,
  validateReconciliationRegistry,
} from "./sqlite-baseline-reconciliation.validate.mjs";

const registry = loadReconciliationRegistry();

function rejected(value) {
  assert.throws(
    () => validateReconciliationRegistry(value),
    (error) => error instanceof ReconciliationRegistryError
      || error?.name === "AssertionError",
  );
}

test("freezes all reconciliation rules and all twelve baseline kinds", () => {
  assert.equal(validateReconciliationRegistry(registry), registry);
  assert.deepEqual(registry.entryKinds, BLR_ENTRY_KINDS);
  assert.deepEqual(registry.rules.map((rule) => rule.ruleId), BLR_RULE_IDS);
  assert.equal(new Set(BLR_RULE_IDS).size, 53);
  assert.equal(registry.implementationClaim, false);
});

test("freezes FILE-backed TEMP bounds and cursor seal domains", () => {
  assert.deepEqual(registry.tempStorage, {
    tempStore: "FILE",
    defaultCacheKiB: 8192,
    minimumCacheKiB: 1024,
    maximumCacheKiB: 65536,
    cacheSpill: true,
    tempStoreDirectoryAllowed: false,
  });
  assert.equal(registry.cursorSeal.rowDomain, "graph-engineering/sqlite-cursor-seal-row/v1\0");
  assert.equal(registry.cursorSeal.chainDomain, "graph-engineering/sqlite-cursor-seal/v1\0");
});

test("diagnostic envelope cannot carry tenant-controlled identities or payloads", () => {
  assert.deepEqual(registry.diagnosticEnvelope.fields, [
    "ruleId", "violationCount", "diagnosticsTruncated",
  ]);
  for (const field of ["tenantId", "operationId", "streamId", "payload", "resultBlob"]) {
    const hostile = structuredClone(registry);
    hostile.diagnosticEnvelope.fields[2] = field;
    rejected(hostile);
  }
  const complete = {
    ruleId: "BLR_RECORD_GAP",
    violationCount: 3,
    diagnosticsTruncated: false,
  };
  assert.equal(validateReconciliationDiagnostic(complete, 3), complete);
  const truncated = {
    ruleId: "BLR_RECORD_GAP",
    violationCount: 16,
    diagnosticsTruncated: true,
  };
  assert.equal(validateReconciliationDiagnostic(truncated, 19), truncated);
  for (const hostile of [
    { ...complete, violationCount: "tenant-a" },
    { ...complete, violationCount: -1 },
    { ...complete, diagnosticsTruncated: "false" },
    { ...complete, ruleId: "BLR_UNKNOWN" },
    { ...complete, tenantId: "tenant-a" },
    { ...complete, violationCount: 2 },
    { ...truncated, diagnosticsTruncated: false },
  ]) {
    assert.throws(() => validateReconciliationDiagnostic(hostile, 3));
  }
  assert.throws(() => validateReconciliationDiagnostic(complete, 0));
  assert.throws(() => validateReconciliationDiagnostic(complete, 3, 65));
});

test("rejects rule omission, duplication, reordering, and unknown fields", () => {
  const missing = structuredClone(registry);
  missing.rules.pop();
  rejected(missing);

  const duplicate = structuredClone(registry);
  duplicate.rules[1].ruleId = duplicate.rules[0].ruleId;
  rejected(duplicate);

  const reordered = structuredClone(registry);
  [reordered.rules[0], reordered.rules[1]] = [reordered.rules[1], reordered.rules[0]];
  rejected(reordered);

  const wrongPhase = structuredClone(registry);
  wrongPhase.rules.find((rule) => rule.ruleId === "BLR_RECORD_GAP").phase = "owner";
  rejected(wrongPhase);

  const open = structuredClone(registry);
  open.rules[0].diagnostic = "tenant-a";
  rejected(open);
});

test("rejects implementation, memory TEMP, cache, and domain drift", () => {
  for (const mutate of [
    (value) => { value.implementationClaim = true; },
    (value) => { value.releaseGate = true; },
    (value) => { value.productionThroughputClaim = true; },
    (value) => { value.tempStorage.tempStore = "MEMORY"; },
    (value) => { value.tempStorage.defaultCacheKiB = 8193; },
    (value) => { value.cursorSeal.rowDomain = value.cursorSeal.rowDomain.slice(0, -1); },
    (value) => { value.cursorSeal.protocolClaim = true; },
    (value) => { value.entryKinds.reverse(); },
  ]) {
    const hostile = structuredClone(registry);
    mutate(hostile);
    rejected(hostile);
  }
});
