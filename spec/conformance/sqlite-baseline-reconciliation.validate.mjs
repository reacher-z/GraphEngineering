#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CASE_PATH = join(ROOT, "sqlite-baseline-reconciliation.case.json");
const SCHEMA_PATH = join(ROOT, "sqlite-baseline-reconciliation.schema.json");

export const BLR_ENTRY_KINDS = Object.freeze([
  "schema-envelope", "migration-lineage", "stream-head", "record-identity",
  "checkpoint-current", "checkpoint-revision", "lease-current",
  "used-lease-identity", "legal-hold", "migration-lock-current",
  "used-migration-lock-identity", "legacy-operation",
]);

export const BLR_RULE_IDS = Object.freeze([
  "BLR_TEMP_CONFIGURATION",
  "BLR_EXCLUSIVE_TRANSACTION_REQUIRED",
  "BLR_TRANSACTION_CHANGED",
  "BLR_UNEXPLAINED_WRITE",
  "BLR_STAGE_WRITE_COUNT",
  "BLR_STAGE_ITERATOR_INCOMPLETE",
  "BLR_STAGE_KEY_DUPLICATE",
  "BLR_STAGE_RELATION_MISSING",
  "BLR_STAGE_RELATION_EXTRA",
  "BLR_STAGE_KIND_RANK",
  "BLR_SCHEMA_CARDINALITY",
  "BLR_LINEAGE_BINDING",
  "BLR_CAPTURE_CLOCK",
  "BLR_STAGE_COVERAGE",
  "BLR_STAGE_COUNT",
  "BLR_RECORD_STREAM_MISSING",
  "BLR_STREAM_EMPTY",
  "BLR_RECORD_GAP",
  "BLR_RECORD_PREDECESSOR",
  "BLR_STREAM_TAIL",
  "BLR_RECORD_HASH_DUPLICATE",
  "BLR_CHECKPOINT_REVISION_GAP",
  "BLR_CHECKPOINT_RECORD_MISSING",
  "BLR_CHECKPOINT_CURRENT_MISSING",
  "BLR_CHECKPOINT_CURRENT_UNEXPECTED",
  "BLR_CHECKPOINT_CURRENT_STALE",
  "BLR_CHECKPOINT_CURRENT_BINDING",
  "BLR_LEASE_STREAM_MISSING",
  "BLR_LEASE_HISTORY_INCOMPLETE",
  "BLR_LEASE_ACTIVE_BINDING",
  "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE",
  "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
  "BLR_HOLD_STREAM_MISSING",
  "BLR_LEGACY_INVENTORY",
  "BLR_LEGACY_APPEND_BINDING",
  "BLR_LEGACY_CHECKPOINT_BINDING",
  "BLR_LEGACY_LEASE_BINDING",
  "BLR_LEGACY_LOCK_BINDING",
  "BLR_CURSOR_AUTHORIZATION",
  "BLR_CURSOR_SCOPE",
  "BLR_CURSOR_BLOB_CANONICAL",
  "BLR_CURSOR_POSITION",
  "BLR_CURSOR_EXPIRY_CONSUMPTION",
  "BLR_CURSOR_CATALOG_BINDING",
  "BLR_CURSOR_SEAL_COUNT",
  "BLR_CURSOR_SHAPE",
  "BLR_CURSOR_EVENT_BINDING",
  "BLR_CURSOR_CHECKPOINT_BINDING",
  "BLR_CURSOR_REBIND_COUNT",
  "BLR_CURSOR_SEAL_MISMATCH",
  "BLR_PUBLISHED_STAGE_COVERAGE",
  "BLR_PUBLISHED_HEADER_BINDING",
  "BLR_PUBLISHED_SEQUENCE_BINDING",
]);

const BLR_RULE_PHASES = Object.freeze([
  ...Array(4).fill("owner"),
  ...Array(6).fill("stage"),
  ...Array(3).fill("source"),
  ...Array(2).fill("stage"),
  ...Array(6).fill("stream-record"),
  ...Array(6).fill("checkpoint"),
  ...Array(6).fill("lease-lock-hold"),
  ...Array(5).fill("legacy"),
  ...Array(12).fill("cursor"),
  ...Array(3).fill("publication"),
]);

export class ReconciliationRegistryError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "ReconciliationRegistryError";
    this.code = "GE_BASELINE_RECONCILIATION_REGISTRY";
  }
}

function fail(message) {
  throw new ReconciliationRegistryError(message);
}

function parsed(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const schema = parsed(SCHEMA_PATH);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateShape = ajv.compile(schema);
const validateDiagnosticShape = ajv.compile(schema.$defs.diagnostic);

export function loadReconciliationRegistry() {
  return parsed(CASE_PATH);
}

export function validateReconciliationRegistry(value) {
  if (!validateShape(value)) return fail("SQLite baseline reconciliation registry shape drifted");
  assert.deepEqual(value.entryKinds, BLR_ENTRY_KINDS);
  const ruleIds = value.rules.map((rule) => rule.ruleId);
  if (new Set(ruleIds).size !== ruleIds.length) return fail("SQLite baseline rule IDs repeat");
  if (ruleIds.length !== BLR_RULE_IDS.length
      || ruleIds.some((ruleId, index) => ruleId !== BLR_RULE_IDS[index])) {
    return fail("SQLite baseline rule order drifted");
  }
  if (value.rules.some((rule, index) => rule.phase !== BLR_RULE_PHASES[index])) {
    return fail("SQLite baseline rule phase drifted");
  }
  if (!value.cursorSeal.rowDomain.endsWith("\0")
      || !value.cursorSeal.chainDomain.endsWith("\0")) {
    return fail("SQLite cursor seal domains are not NUL terminated");
  }
  const forbidden = new Set([
    "tenantId", "operationId", "streamId", "payload", "request", "resultBlob",
  ]);
  if (value.diagnosticEnvelope.fields.some((field) => forbidden.has(field))) {
    return fail("SQLite baseline diagnostics expose tenant-controlled values");
  }
  return value;
}

export function validateReconciliationDiagnostic(
  value,
  actualViolationCount,
  configuredDiagnosticLimit = 16,
) {
  if (!Number.isSafeInteger(actualViolationCount) || actualViolationCount < 1) {
    return fail("SQLite baseline actual violation count is invalid");
  }
  if (!Number.isSafeInteger(configuredDiagnosticLimit)
      || configuredDiagnosticLimit < 1
      || configuredDiagnosticLimit > 64) {
    return fail("SQLite baseline diagnostic limit is invalid");
  }
  if (!validateDiagnosticShape(value)) {
    return fail("SQLite baseline diagnostic shape drifted");
  }
  if (!BLR_RULE_IDS.includes(value.ruleId)) {
    return fail("SQLite baseline diagnostic rule is unknown");
  }
  const expectedCount = Math.min(actualViolationCount, configuredDiagnosticLimit);
  if (value.violationCount !== expectedCount
      || value.diagnosticsTruncated !== (actualViolationCount > configuredDiagnosticLimit)) {
    return fail("SQLite baseline diagnostic truncation drifted");
  }
  return value;
}

const isCli = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const registry = validateReconciliationRegistry(loadReconciliationRegistry());
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: registry.status,
    ruleCount: registry.rules.length,
    implementationClaim: registry.implementationClaim,
  }, null, 2)}\n`);
}
