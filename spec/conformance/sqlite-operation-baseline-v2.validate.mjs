#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(ROOT, "sqlite-operation-baseline-v2.case.json");
const SCHEMA_PATH = join(ROOT, "sqlite-operation-baseline-v2.schema.json");

export const ENTRY_KINDS = Object.freeze([
  "schema-envelope", "migration-lineage", "stream-head", "record-identity",
  "checkpoint-current", "checkpoint-revision", "lease-current",
  "used-lease-identity", "legal-hold", "migration-lock-current",
  "used-migration-lock-identity", "legacy-operation",
]);

const DOMAINS = Object.freeze({
  baselineId: "graph-engineering/sqlite-operation-baseline-id/v1\0",
  entry: "graph-engineering/sqlite-operation-baseline-entry/v1\0",
  projection: "graph-engineering/sqlite-operation-baseline-projection/v1\0",
  genesis: "graph-engineering/sqlite-operation-baseline-genesis/v1\0",
  empty: "graph-engineering/sqlite-operation-baseline-empty/v1\0",
  genesisHash: "5311dba7ae8b844fc3efccd55dd90c3f78e02a7f7e222d7a0a513fd1aff9ec96",
  emptyRoot: "66a081bbc7369b674fa093cb2e3e1d269a1eb506698e24dfc2899074bf06b82a",
});

const KEY_FIELDS = Object.freeze({
  "schema-envelope": ["scope"],
  "migration-lineage": ["version"],
  "stream-head": ["streamId", "tenantId"],
  "record-identity": ["recordId", "tenantId"],
  "checkpoint-current": ["checkpointId", "checkpointScope", "tenantId"],
  "checkpoint-revision": ["checkpointScope", "revision", "tenantId"],
  "lease-current": ["streamId", "tenantId"],
  "used-lease-identity": ["leaseId", "streamId", "tenantId"],
  "legal-hold": ["holdId", "streamId", "tenantId"],
  "migration-lock-current": ["singleton"],
  "used-migration-lock-identity": ["lockId"],
  "legacy-operation": ["operationId", "tenantId"],
});

const STATE_FIELDS = Object.freeze({
  "schema-envelope": ["createdAtMs", "currentVersion", "latestMigrationAppliedAtMs", "latestMigrationSha256", "maxReaderVersion", "maxWriterVersion", "minReaderVersion", "minWriterVersion", "providerDescriptorHash", "schemaIdentitySha256", "updatedAtMs"],
  "migration-lineage": ["appliedAtMs", "migrationId", "postconditions", "previousVersion", "reversibility", "schemaIdentitySha256", "sqlSha256", "version"],
  "stream-head": ["createdAtMs", "streamId", "tailRecordHash", "tailSequence", "tenantId", "updatedAtMs"],
  "record-identity": ["committedAtMs", "previousRecordHash", "recordHash", "recordId", "sequence", "streamId", "tenantId", "valueBytes", "valueHash"],
  "checkpoint-current": ["boundRecordHash", "boundSequence", "checkpointId", "checkpointRevision", "checkpointScope", "committedAtMs", "createdAt", "streamId", "summary", "tenantId", "valueBytes", "valueHash"],
  "checkpoint-revision": ["action", "boundRecordHash", "boundSequence", "checkpointCreatedAt", "checkpointId", "checkpointScope", "recordedAtMs", "revision", "summary", "tenantId", "valueBytes", "valueHash"],
  "lease-current": ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken", "activeHolderId", "activeLeaseEpoch", "activeLeaseId", "lastFencingToken", "lastLeaseEpoch", "streamId", "tenantId", "updatedAtMs"],
  "used-lease-identity": ["fencingToken", "firstUsedAtMs", "leaseEpoch", "leaseId", "streamId", "tenantId"],
  "legal-hold": ["holdId", "placedAtMs", "streamId", "tenantId"],
  "migration-lock-current": ["activeAcquiredAtMs", "activeExpiresAtMs", "activeFencingToken", "activeLockEpoch", "activeLockId", "activeOwnerId", "activeSourceVersion", "activeTargetVersion", "lastFencingToken", "lastLockEpoch", "singleton", "updatedAtMs"],
  "used-migration-lock-identity": ["fencingToken", "firstUsedAtMs", "lockEpoch", "lockId"],
  "legacy-operation": ["committedAtMs", "operationId", "operationName", "requestHash", "resultBlobSha256", "resultHash", "tenantId"],
});

const HASH_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const SCHEMA_V1 = "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4";
const MIGRATION_V1 = "a8e9de4d1bae81f8405ef611fca1298bef024ad1df5e905d1d5a9357d1e8cb9c";
const DESCRIPTOR_V1 = "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe";
const V1_POSTCONDITIONS = Object.freeze([
  "application-id-matches",
  "user-version-is-1",
  "schema-singleton-is-manifest-bound",
  "migration-ledger-row-is-manifest-bound",
  "all-canonical-tables-are-strict",
  "logical-schema-identity-matches-fresh-v1",
  "foreign-key-check-is-empty",
  "integrity-check-is-ok",
  "alpha-row-counts-are-preserved",
  "stream-heads-match-record-tails",
  "canonical-blobs-and-hashes-are-preserved",
  "checkpoint-revisions-are-seeded",
  "lease-and-migration-fences-are-monotonic",
  "no-v0-or-placeholder-state-remains",
]);

export class BaselineVectorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BaselineVectorError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BaselineVectorError(code, message);
}

function compareCodePoints(left, right) {
  const a = Array.from(left, (value) => value.codePointAt(0));
  const b = Array.from(right, (value) => value.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const result = Object.create(null);
    for (const key of Object.keys(value).sort(compareCodePoints)) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function domainHash(domain, value) {
  return createHash("sha256").update(domain, "utf8").update(canonicalJson(value), "utf8").digest("hex");
}

function blobVector(value) {
  const bytes = Buffer.from(canonicalJson(value), "utf8");
  return {
    value,
    canonicalUtf8: bytes.toString("utf8"),
    canonicalHex: bytes.toString("hex"),
    byteLength: bytes.length,
    sha256: sha256Bytes(bytes),
  };
}

function goldenEntryValues() {
  const checkpointSummary = {
    boundRecordHash: HASH_A,
    boundSequence: 0,
    checkpointId: "checkpoint-0001",
    checkpointScope: "primary",
    createdAt: "2025-01-01T00:00:00.000Z",
    streamId: "stream-main",
    valueBytes: 23,
    valueHash: HASH_C,
  };
  return [
    [{ scope: "cycle-store" }, { createdAtMs: 1735689600000, currentVersion: 1, latestMigrationAppliedAtMs: 1735689600100, latestMigrationSha256: MIGRATION_V1, maxReaderVersion: 1, maxWriterVersion: 1, minReaderVersion: 1, minWriterVersion: 1, providerDescriptorHash: DESCRIPTOR_V1, schemaIdentitySha256: SCHEMA_V1, updatedAtMs: 1735689600100 }],
    [{ version: 1 }, { appliedAtMs: 1735689600100, migrationId: "alpha-v0-to-v1", postconditions: { requiredPostconditions: [...V1_POSTCONDITIONS] }, previousVersion: 0, reversibility: "rebuild-from-verified-backup-only", schemaIdentitySha256: SCHEMA_V1, sqlSha256: MIGRATION_V1, version: 1 }],
    [{ streamId: "stream-main", tenantId: "tenant-alpha" }, { createdAtMs: 1735689600200, streamId: "stream-main", tailRecordHash: HASH_A, tailSequence: 0, tenantId: "tenant-alpha", updatedAtMs: 1735689600400 }],
    [{ recordId: "record-0001", tenantId: "tenant-alpha" }, { committedAtMs: 1735689600300, previousRecordHash: null, recordHash: HASH_A, recordId: "record-0001", sequence: 0, streamId: "stream-main", tenantId: "tenant-alpha", valueBytes: 17, valueHash: HASH_B }],
    [{ checkpointId: "checkpoint-0001", checkpointScope: "primary", tenantId: "tenant-alpha" }, { boundRecordHash: HASH_A, boundSequence: 0, checkpointId: "checkpoint-0001", checkpointRevision: 1, checkpointScope: "primary", committedAtMs: 1735689600500, createdAt: "2025-01-01T00:00:00.000Z", streamId: "stream-main", summary: checkpointSummary, tenantId: "tenant-alpha", valueBytes: 23, valueHash: HASH_C }],
    [{ checkpointScope: "primary", revision: 1, tenantId: "tenant-alpha" }, { action: "put", boundRecordHash: HASH_A, boundSequence: 0, checkpointCreatedAt: "2025-01-01T00:00:00.000Z", checkpointId: "checkpoint-0001", checkpointScope: "primary", recordedAtMs: 1735689600500, revision: 1, summary: checkpointSummary, tenantId: "tenant-alpha", valueBytes: 23, valueHash: HASH_C }],
    [{ streamId: "stream-main", tenantId: "tenant-alpha" }, { activeAcquiredAtMs: 1735689600700, activeExpiresAtMs: 1735689660700, activeFencingToken: 1, activeHolderId: "worker-a", activeLeaseEpoch: 1, activeLeaseId: "lease-live", lastFencingToken: 1, lastLeaseEpoch: 1, streamId: "stream-main", tenantId: "tenant-alpha", updatedAtMs: 1735689600700 }],
    [{ leaseId: "lease-live", streamId: "stream-main", tenantId: "tenant-alpha" }, { fencingToken: 1, firstUsedAtMs: 1735689600700, leaseEpoch: 1, leaseId: "lease-live", streamId: "stream-main", tenantId: "tenant-alpha" }],
    [{ holdId: "hold-0001", streamId: "stream-main", tenantId: "tenant-alpha" }, { holdId: "hold-0001", placedAtMs: 1735689600800, streamId: "stream-main", tenantId: "tenant-alpha" }],
    [{ singleton: 1 }, { activeAcquiredAtMs: null, activeExpiresAtMs: null, activeFencingToken: null, activeLockEpoch: null, activeLockId: null, activeOwnerId: null, activeSourceVersion: null, activeTargetVersion: null, lastFencingToken: 1, lastLockEpoch: 1, singleton: 1, updatedAtMs: 1735689601000 }],
    [{ lockId: "migration-lock-retired" }, { fencingToken: 1, firstUsedAtMs: 1735689400000, lockEpoch: 1, lockId: "migration-lock-retired" }],
    [{ operationId: "operation-legacy-0001", tenantId: "tenant-alpha" }, { committedAtMs: 1735689601000, operationId: "operation-legacy-0001", operationName: "append", requestHash: HASH_B, resultBlobSha256: HASH_C, resultHash: HASH_A, tenantId: "tenant-alpha" }],
  ];
}

function policyValue() {
  return {
    baselineFormatVersion: 1,
    canonicalEncoding: "graph-engineering/canonical-json/v1",
    cursorReplay: "independent-semantic-audit",
    emptyRoot: DOMAINS.emptyRoot,
    entryHashDomain: DOMAINS.entry,
    entryKinds: [...ENTRY_KINDS],
    genesisHash: DOMAINS.genesisHash,
    legacyRequestRecovery: false,
    maxEntryKeyBytes: 4096,
    maxEntryStateBytes: 2097152,
    payloadOmissions: ["checkpoint-value", "record-blob", "record-value"],
    projectionHashDomain: DOMAINS.projection,
    replayStartsAtCommitSequence: 1,
    sort: ["entry-kind-rank", "entry-key-utf8-bytes"],
  };
}

export function buildCanonicalBaselineFixture() {
  const sourceEnvelope = {
    capturedAtMs: 1735689601234,
    sourceApplicationId: 1195724359,
    sourceDescriptorHash: DESCRIPTOR_V1,
    sourceMigrationLineageId: "alpha-v0-to-v1",
    sourceMigrationLineageSha256: MIGRATION_V1,
    sourceSchemaIdentitySha256: SCHEMA_V1,
    sourceUserVersion: 1,
  };
  const baselineId = `v2-${domainHash(DOMAINS.baselineId, sourceEnvelope)}`;
  let previousEntryHash = DOMAINS.genesisHash;
  const entryVectors = goldenEntryValues().map(([keyValue, stateValue], ordinal) => {
    const key = blobVector(keyValue);
    const state = blobVector(stateValue);
    const entryKind = ENTRY_KINDS[ordinal];
    const entryHash = domainHash(DOMAINS.entry, {
      baselineId,
      entryKeySha256: key.sha256,
      entryKind,
      entryStateSha256: state.sha256,
      ordinal,
      previousEntryHash,
    });
    const entry = { vectorId: `BL-V${String(ordinal + 1).padStart(2, "0")}`, category: "behavior", entryKind, ordinal, key, state, previousEntryHash, entryHash };
    previousEntryHash = entryHash;
    return entry;
  });
  const projectionValue = {
    baselineId,
    entryCount: entryVectors.length,
    finalEntryHash: entryVectors.at(-1).entryHash,
    firstEntryHash: entryVectors[0].entryHash,
    legacyOperationCount: 1,
  };
  const projectionBlob = blobVector(projectionValue);
  return {
    schemaVersion: 1,
    id: "sqlite-operation-baseline-v2-vectors-v1",
    status: "contract-frozen",
    implementationClaim: false,
    domains: DOMAINS,
    sourceEnvelope,
    baselineId,
    policyVector: blobVector(policyValue()),
    entryVectors,
    projection: {
      entryCount: 12,
      legacyOperationCount: 1,
      firstEntryHash: entryVectors[0].entryHash,
      finalEntryHash: entryVectors.at(-1).entryHash,
      canonicalValue: projectionValue,
      canonicalUtf8: projectionBlob.canonicalUtf8,
      canonicalHex: projectionBlob.canonicalHex,
      byteLength: projectionBlob.byteLength,
      sha256: domainHash(DOMAINS.projection, projectionValue),
    },
    attackVectors: [
      ["BL-A01", "key-noncanonical-order", 2, "GE_BASELINE_CANONICAL_BYTES"],
      ["BL-A02", "key-unknown-field", 3, "GE_BASELINE_ENTRY_SHAPE"],
      ["BL-A03", "state-missing-field", 4, "GE_BASELINE_ENTRY_SHAPE"],
      ["BL-A04", "duplicate-kind-key", 3, "GE_BASELINE_DUPLICATE"],
      ["BL-A05", "ordinal-gap", 4, "GE_BASELINE_ORDER"],
      ["BL-A06", "previous-hash-drift", 5, "GE_BASELINE_CHAIN"],
      ["BL-A07", "key-invalid-utf8", 6, "GE_BASELINE_CANONICAL_BYTES"],
      ["BL-A08", "state-invalid-utf8", 7, "GE_BASELINE_CANONICAL_BYTES"],
      ["BL-A09", "entry-hash-drift", 8, "GE_BASELINE_ENTRY_HASH"],
      ["BL-A10", "first-root-drift", 9, "GE_BASELINE_PROJECTION"],
      ["BL-A11", "final-root-drift", 10, "GE_BASELINE_PROJECTION"],
      ["BL-A12", "projection-hash-drift", 11, "GE_BASELINE_PROJECTION"],
    ].map(([id, mutation, targetOrdinal, expectedCode]) => ({ id, category: "attack", mutation, targetOrdinal, expectedCode })),
  };
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
assert.equal(ajv.validateSchema(schema), true, `baseline vector schema failed meta-validation: ${JSON.stringify(ajv.errors)}`);
const validateShape = ajv.compile(schema);

function exactKeys(value, fields, context) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("GE_BASELINE_ENTRY_SHAPE", `${context} must be an object`);
  const actual = Object.keys(value).sort(compareCodePoints);
  const expected = [...fields].sort(compareCodePoints);
  if (canonicalJson(actual) !== canonicalJson(expected)) fail("GE_BASELINE_ENTRY_SHAPE", `${context} fields drifted`);
}

function requireEqual(left, right, context) {
  if (canonicalJson(left) !== canonicalJson(right)) fail("GE_BASELINE_ENTRY_SHAPE", `${context} identity drifted`);
}

function validateEntryIdentity(entry, key, state) {
  switch (entry.entryKind) {
    case "schema-envelope":
      requireEqual(key.scope, "cycle-store", "schema envelope scope");
      break;
    case "migration-lineage":
      requireEqual(key.version, state.version, "migration version");
      requireEqual(state.postconditions, { requiredPostconditions: [...V1_POSTCONDITIONS] }, "migration postconditions");
      break;
    case "stream-head":
      requireEqual([key.tenantId, key.streamId], [state.tenantId, state.streamId], "stream key/state");
      break;
    case "record-identity":
      requireEqual([key.tenantId, key.recordId], [state.tenantId, state.recordId], "record key/state");
      if ((state.sequence === 0) !== (state.previousRecordHash === null)) fail("GE_BASELINE_ENTRY_SHAPE", "record predecessor/sequence shape drifted");
      break;
    case "checkpoint-current": {
      requireEqual([key.tenantId, key.checkpointScope, key.checkpointId], [state.tenantId, state.checkpointScope, state.checkpointId], "checkpoint key/state");
      exactKeys(state.summary, ["boundRecordHash", "boundSequence", "checkpointId", "checkpointScope", "createdAt", "streamId", "valueBytes", "valueHash"], "checkpoint summary");
      requireEqual(state.summary, { boundRecordHash: state.boundRecordHash, boundSequence: state.boundSequence, checkpointId: state.checkpointId, checkpointScope: state.checkpointScope, createdAt: state.createdAt, streamId: state.streamId, valueBytes: state.valueBytes, valueHash: state.valueHash }, "checkpoint summary/state");
      break;
    }
    case "checkpoint-revision":
      requireEqual([key.tenantId, key.checkpointScope, key.revision], [state.tenantId, state.checkpointScope, state.revision], "checkpoint revision key/state");
      if (state.action === "put") {
        exactKeys(state.summary, ["boundRecordHash", "boundSequence", "checkpointId", "checkpointScope", "createdAt", "streamId", "valueBytes", "valueHash"], "checkpoint revision summary");
        requireEqual(state.summary, { boundRecordHash: state.boundRecordHash, boundSequence: state.boundSequence, checkpointId: state.checkpointId, checkpointScope: state.checkpointScope, createdAt: state.checkpointCreatedAt, streamId: state.summary.streamId, valueBytes: state.valueBytes, valueHash: state.valueHash }, "checkpoint revision summary/state");
      } else if (state.action !== "delete" || [state.summary, state.boundRecordHash, state.boundSequence, state.checkpointCreatedAt, state.valueBytes, state.valueHash].some((item) => item !== null)) {
        fail("GE_BASELINE_ENTRY_SHAPE", "checkpoint revision action payload drifted");
      }
      break;
    case "lease-current":
      requireEqual([key.tenantId, key.streamId], [state.tenantId, state.streamId], "lease key/state");
      requireEqual(state.lastLeaseEpoch, state.lastFencingToken, "lease high-water");
      if (state.activeLeaseId !== null) requireEqual([state.activeLeaseEpoch, state.activeFencingToken], [state.lastLeaseEpoch, state.lastFencingToken], "active lease fence");
      break;
    case "used-lease-identity":
      requireEqual([key.tenantId, key.streamId, key.leaseId], [state.tenantId, state.streamId, state.leaseId], "used lease key/state");
      requireEqual(state.leaseEpoch, state.fencingToken, "used lease fence");
      break;
    case "legal-hold":
      requireEqual([key.tenantId, key.streamId, key.holdId], [state.tenantId, state.streamId, state.holdId], "legal hold key/state");
      break;
    case "migration-lock-current":
      requireEqual(key.singleton, state.singleton, "migration lock singleton");
      requireEqual(state.lastLockEpoch, state.lastFencingToken, "migration lock high-water");
      if (state.activeLockId !== null) requireEqual([state.activeLockEpoch, state.activeFencingToken], [state.lastLockEpoch, state.lastFencingToken], "active migration lock fence");
      break;
    case "used-migration-lock-identity":
      requireEqual(key.lockId, state.lockId, "used migration lock key/state");
      requireEqual(state.lockEpoch, state.fencingToken, "used migration lock fence");
      break;
    case "legacy-operation":
      requireEqual([key.tenantId, key.operationId], [state.tenantId, state.operationId], "legacy operation key/state");
      break;
    default:
      fail("GE_BASELINE_ENTRY_SHAPE", "unknown entry kind");
  }
}

function validateCrossEntryCoherency(value, decoded) {
  const byKind = new Map(decoded.map((entry) => [entry.entryKind, entry]));
  const schemaState = byKind.get("schema-envelope").state;
  const migration = byKind.get("migration-lineage").state;
  const stream = byKind.get("stream-head").state;
  const record = byKind.get("record-identity").state;
  const checkpoint = byKind.get("checkpoint-current").state;
  const revision = byKind.get("checkpoint-revision").state;
  const lease = byKind.get("lease-current").state;
  const usedLease = byKind.get("used-lease-identity").state;
  const legalHold = byKind.get("legal-hold").state;
  const migrationLock = byKind.get("migration-lock-current").state;
  const usedMigrationLock = byKind.get("used-migration-lock-identity").state;
  const legacyOperation = byKind.get("legacy-operation").state;

  requireEqual([schemaState.currentVersion, schemaState.schemaIdentitySha256, schemaState.latestMigrationSha256, schemaState.latestMigrationAppliedAtMs], [migration.version, migration.schemaIdentitySha256, migration.sqlSha256, migration.appliedAtMs], "schema/migration lineage");
  requireEqual([value.sourceEnvelope.sourceSchemaIdentitySha256, value.sourceEnvelope.sourceDescriptorHash, value.sourceEnvelope.sourceMigrationLineageSha256], [schemaState.schemaIdentitySha256, schemaState.providerDescriptorHash, migration.sqlSha256], "source envelope/catalog");
  requireEqual(value.sourceEnvelope.sourceMigrationLineageId, migration.migrationId, "source envelope/migration identity");
  if (value.sourceEnvelope.capturedAtMs < schemaState.updatedAtMs) fail("GE_BASELINE_ENTRY_SHAPE", "baseline capture predates source state");
  requireEqual([stream.tenantId, stream.streamId, stream.tailSequence, stream.tailRecordHash], [record.tenantId, record.streamId, record.sequence, record.recordHash], "stream/record tail");
  requireEqual([checkpoint.tenantId, checkpoint.streamId, checkpoint.boundSequence, checkpoint.boundRecordHash], [record.tenantId, record.streamId, record.sequence, record.recordHash], "checkpoint/record binding");
  requireEqual([revision.tenantId, revision.checkpointScope, revision.checkpointId, revision.revision, revision.boundSequence, revision.boundRecordHash, revision.checkpointCreatedAt, revision.valueBytes, revision.valueHash, revision.summary], [checkpoint.tenantId, checkpoint.checkpointScope, checkpoint.checkpointId, checkpoint.checkpointRevision, checkpoint.boundSequence, checkpoint.boundRecordHash, checkpoint.createdAt, checkpoint.valueBytes, checkpoint.valueHash, checkpoint.summary], "checkpoint current/revision");
  requireEqual([usedLease.tenantId, usedLease.streamId, usedLease.leaseId, usedLease.leaseEpoch, usedLease.fencingToken], [lease.tenantId, lease.streamId, lease.activeLeaseId, lease.activeLeaseEpoch, lease.activeFencingToken], "lease current/used identity");
  requireEqual([usedMigrationLock.lockEpoch, usedMigrationLock.fencingToken], [migrationLock.lastLockEpoch, migrationLock.lastFencingToken], "migration lock/used identity");
  const maximumObservedCommit = Math.max(
    schemaState.createdAtMs, schemaState.updatedAtMs, migration.appliedAtMs,
    stream.createdAtMs, stream.updatedAtMs, record.committedAtMs,
    checkpoint.committedAtMs, revision.recordedAtMs, lease.updatedAtMs,
    usedLease.firstUsedAtMs, legalHold.placedAtMs, usedMigrationLock.firstUsedAtMs,
    legacyOperation.committedAtMs,
  );
  if (migrationLock.updatedAtMs < maximumObservedCommit) fail("GE_BASELINE_ENTRY_SHAPE", "migration lock clock high-water predates observed provider state");
  if (value.sourceEnvelope.capturedAtMs < migrationLock.updatedAtMs) fail("GE_BASELINE_ENTRY_SHAPE", "baseline capture predates provider clock high-water");
}

function decodeBlob(vector, context, maximum) {
  let bytes;
  try {
    bytes = Buffer.from(vector.canonicalHex, "hex");
    if (bytes.toString("hex") !== vector.canonicalHex) throw new Error("hex round trip drifted");
  } catch {
    fail("GE_BASELINE_CANONICAL_BYTES", `${context} hex is invalid`);
  }
  if (bytes.length < 2 || bytes.length > maximum || bytes.length !== vector.byteLength) fail("GE_BASELINE_CANONICAL_BYTES", `${context} length drifted`);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("GE_BASELINE_CANONICAL_BYTES", `${context} is not valid UTF-8`);
  }
  if (text !== vector.canonicalUtf8 || sha256Bytes(bytes) !== vector.sha256) fail("GE_BASELINE_CANONICAL_BYTES", `${context} byte evidence drifted`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("GE_BASELINE_CANONICAL_BYTES", `${context} is not JSON`);
  }
  if (canonicalJson(parsed) !== text || canonicalJson(vector.value) !== text) fail("GE_BASELINE_CANONICAL_BYTES", `${context} is not the declared canonical value`);
  return parsed;
}

export function validateBaselineModel(value) {
  const seen = new Set();
  const decoded = [];
  for (const [index, entry] of value.entryVectors.entries()) {
    const key = decodeBlob(entry.key, `${entry.entryKind} key`, 4096);
    const state = decodeBlob(entry.state, `${entry.entryKind} state`, 2097152);
    exactKeys(key, KEY_FIELDS[entry.entryKind] ?? [], `${entry.entryKind} key`);
    exactKeys(state, STATE_FIELDS[entry.entryKind] ?? [], `${entry.entryKind} state`);
    validateEntryIdentity(entry, key, state);
    decoded.push({ entryKind: entry.entryKind, key, state });
    const duplicateKey = `${entry.entryKind}\0${entry.key.canonicalHex}`;
    if (seen.has(duplicateKey)) fail("GE_BASELINE_DUPLICATE", `${entry.entryKind} key is duplicated`);
    seen.add(duplicateKey);
    if (entry.ordinal !== index || entry.entryKind !== ENTRY_KINDS[index]) fail("GE_BASELINE_ORDER", `entry ${index} rank or ordinal drifted`);
  }
  validateCrossEntryCoherency(value, decoded);
  let previous = DOMAINS.genesisHash;
  for (const [index, entry] of value.entryVectors.entries()) {
    if (entry.previousEntryHash !== previous) fail("GE_BASELINE_CHAIN", `entry ${index} predecessor drifted`);
    const expectedHash = domainHash(DOMAINS.entry, { baselineId: value.baselineId, entryKeySha256: entry.key.sha256, entryKind: entry.entryKind, entryStateSha256: entry.state.sha256, ordinal: entry.ordinal, previousEntryHash: entry.previousEntryHash });
    if (entry.entryHash !== expectedHash) fail("GE_BASELINE_ENTRY_HASH", `entry ${index} hash drifted`);
    previous = entry.entryHash;
  }
  const expectedProjection = {
    baselineId: value.baselineId,
    entryCount: value.entryVectors.length,
    finalEntryHash: value.entryVectors.at(-1)?.entryHash ?? DOMAINS.emptyRoot,
    firstEntryHash: value.entryVectors[0]?.entryHash ?? DOMAINS.emptyRoot,
    legacyOperationCount: value.entryVectors.filter((entry) => entry.entryKind === "legacy-operation").length,
  };
  const projection = value.projection;
  if (projection.entryCount !== expectedProjection.entryCount || projection.legacyOperationCount !== expectedProjection.legacyOperationCount || projection.firstEntryHash !== expectedProjection.firstEntryHash || projection.finalEntryHash !== expectedProjection.finalEntryHash || canonicalJson(projection.canonicalValue) !== canonicalJson(expectedProjection)) fail("GE_BASELINE_PROJECTION", "projection header drifted");
  const expectedBytes = Buffer.from(canonicalJson(expectedProjection), "utf8");
  if (projection.canonicalUtf8 !== expectedBytes.toString("utf8") || projection.canonicalHex !== expectedBytes.toString("hex") || projection.byteLength !== expectedBytes.length || projection.sha256 !== domainHash(DOMAINS.projection, expectedProjection)) fail("GE_BASELINE_PROJECTION", "projection bytes or hash drifted");
}

function clone(value) {
  return structuredClone(value);
}

function replaceBlob(vector, value) {
  Object.assign(vector, blobVector(value));
}

export function applyAttackVector(value, attack) {
  const hostile = clone(value);
  const entry = hostile.entryVectors[attack.targetOrdinal];
  const flip = (hash) => `${hash[0] === "0" ? "1" : "0"}${hash.slice(1)}`;
  switch (attack.mutation) {
    case "key-noncanonical-order": {
      const text = '{"tenantId":"tenant-alpha","streamId":"stream-main"}';
      const bytes = Buffer.from(text, "utf8");
      Object.assign(entry.key, { canonicalUtf8: text, canonicalHex: bytes.toString("hex"), byteLength: bytes.length, sha256: sha256Bytes(bytes) });
      break;
    }
    case "key-unknown-field": replaceBlob(entry.key, { ...entry.key.value, unexpected: true }); break;
    case "state-missing-field": {
      const state = { ...entry.state.value };
      delete state.valueHash;
      replaceBlob(entry.state, state);
      break;
    }
    case "duplicate-kind-key": {
      const source = hostile.entryVectors[2];
      entry.entryKind = source.entryKind;
      entry.key = clone(source.key);
      entry.state = clone(source.state);
      break;
    }
    case "ordinal-gap": entry.ordinal += 1; break;
    case "previous-hash-drift": entry.previousEntryHash = flip(entry.previousEntryHash); break;
    case "key-invalid-utf8": entry.key.canonicalHex = `ff${entry.key.canonicalHex.slice(2)}`; break;
    case "state-invalid-utf8": entry.state.canonicalHex = `ff${entry.state.canonicalHex.slice(2)}`; break;
    case "entry-hash-drift": entry.entryHash = flip(entry.entryHash); break;
    case "first-root-drift": hostile.projection.firstEntryHash = flip(hostile.projection.firstEntryHash); break;
    case "final-root-drift": hostile.projection.finalEntryHash = flip(hostile.projection.finalEntryHash); break;
    case "projection-hash-drift": hostile.projection.sha256 = flip(hostile.projection.sha256); break;
    default: fail("GE_BASELINE_ENTRY_SHAPE", "unknown attack mutation");
  }
  return hostile;
}

export function loadCanonicalBaselineFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

export function validateCanonicalBaselineFixture(value) {
  if (!validateShape(value)) fail("GE_BASELINE_ENTRY_SHAPE", `closed fixture schema failed: ${JSON.stringify(validateShape.errors)}`);
  const expected = buildCanonicalBaselineFixture();
  if (canonicalJson(value.domains) !== canonicalJson(DOMAINS)) fail("GE_BASELINE_ENTRY_SHAPE", "hash domains drifted");
  if (value.baselineId !== `v2-${domainHash(DOMAINS.baselineId, value.sourceEnvelope)}`) fail("GE_BASELINE_ENTRY_HASH", "baseline ID drifted");
  decodeBlob(value.policyVector, "policy", 1048576);
  if (canonicalJson(value.policyVector.value) !== canonicalJson(policyValue())) fail("GE_BASELINE_ENTRY_SHAPE", "policy value drifted");
  validateBaselineModel(value);
  if (canonicalJson(value) !== canonicalJson(expected)) fail("GE_BASELINE_ENTRY_SHAPE", "frozen golden fixture drifted");
  for (const attack of value.attackVectors) {
    try {
      validateBaselineModel(applyAttackVector(value, attack));
      fail("GE_BASELINE_ENTRY_SHAPE", `${attack.id} was accepted`);
    } catch (error) {
      if (!(error instanceof BaselineVectorError) || error.code !== attack.expectedCode) {
        fail("GE_BASELINE_ENTRY_SHAPE", `${attack.id} returned ${error?.code ?? error?.name ?? "unknown"}, expected ${attack.expectedCode}`);
      }
    }
  }
  return value;
}

if (process.argv.includes("--print-fixture")) {
  process.stdout.write(`${JSON.stringify(buildCanonicalBaselineFixture(), null, 2)}\n`);
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const value = validateCanonicalBaselineFixture(loadCanonicalBaselineFixture());
  process.stdout.write(`validated ${value.entryVectors.length} canonical baseline kinds and ${value.attackVectors.length} hostile mutations\n`);
}
