#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = dirname(dirname(ROOT));
const FIXTURE_PATH = join(ROOT, "sqlite-cursor-publication-rebind-v2.case.json");
const SCHEMA_PATH = join(ROOT, "sqlite-cursor-publication-rebind-v2.schema.json");
const TRUSTED_FIXTURE_SHA256 = "b92d8d9c05d16f3a230e479ee161acd26e265654e0a44ff14dfe5652328ef7f0";

const EXACT_IDENTITIES = Object.freeze({
  sourceDescriptorHash: "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe",
  sourceSchemaIdentity: "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
  targetDescriptorHash: "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92",
  targetDescriptorBodySha256: "7bb784e57922facd28034dfdd504b37bd60c89e6c09fcd0d3f9adabb8456e214",
  targetDescriptorCanonicalSha256: "27cfd73833b3a8ff29f0b33d2a73a51d1409b40a07e62c96ec4d9910a705a7d9",
  targetSchemaIdentity: "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634",
  migrationSqlSha256: "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d",
  schemaSqlSha256: "5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5",
  previewManifestSha256: "f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf",
});
const EXACT_STAGES = Object.freeze([
  "source-v1-semantically-valid",
  "b2-pre-rebind-complete",
  "outer-publication-authority-minted",
  "migration-0002-catalog-rebuild",
  "post-0002-catalog-fence-adopted",
  "baseline-entries-published",
  "baseline-header-published",
  "operation-sequence-zero-published",
  "post-ddl-stage-authority-adopted",
  "cursor-publication-session-minted",
  "cursor-rebind-executed-once",
  "rule-11-rebind-count-accepted",
  "rule-12-main-table-seal-accepted",
  "cursor-clock-complete",
  "migration-lineage-published",
  "schema-and-descriptor-metadata-published",
  "publication-rules-accepted",
  "fresh-v2-catalog-equivalence-accepted",
  "physical-and-semantic-postconditions-accepted",
  "pre-retirement-stage-fence-adopted",
  "cursor-temp-stage-retired",
  "final-migration-lock-transaction-fence-accepted",
  "single-atomic-commit",
]);
const EXACT_RULES = Object.freeze([
  Object.freeze({ position: 11, id: "BLR_CURSOR_REBIND_COUNT",
    input: "publication-owned-statement-affected-count",
    expected: "equals-pre-rebind-receipt-cursor-count", diagnosticUnit: "count-mismatch",
    violationCountOnFailure: 1, successRequiredForNextRule: true }),
  Object.freeze({ position: 12, id: "BLR_CURSOR_SEAL_MISMATCH",
    input: "fresh-main-table-point-lookup-stream",
    expected: "count-and-immutable-root-equal-receipt-and-every-mutable-identity-equals-target",
    diagnosticUnit: "post-rebind-receipt-mismatch",
    violationCountOnFailure: 1, successRequiredForNextRule: true }),
]);
const EXACT_PRECEDENCE = Object.freeze({
  beforeFirstPermanentWrite: Object.freeze(["b2-receipt-provenance", "exact-object-graph",
    "outer-publication-authority", "migration-lock-capability", "transaction-generation",
    "expected-target-catalog", "cancellation"]),
  beforeCursorRebind: Object.freeze(["publication-session", "migration-lock-freshness",
    "transaction-generation", "post-0002-catalog-fence", "cancellation"]),
  afterStatementStarted: Object.freeze(["permanent-write-ledger", "statement-result-shape",
    "rule-11-count", "rule-12-seal", "cancellation", "cleanup"]),
  afterCommitReturned: Object.freeze(["complete-v2-reopen-audit", "cleanup"]),
});
const EXACT_MUTABLE_FIELDS = Object.freeze(["descriptor_hash", "schema_identity_sha256"]);
const EXACT_IMMUTABLE_FIELDS = Object.freeze([
  "tenant_id", "token_hash", "kind", "principal_hash", "authorization_hash",
  "stream_id", "checkpoint_scope", "request_scope_blob", "page_size",
  "next_position", "snapshot_tail_sequence", "snapshot_tail_record_hash",
  "snapshot_blob", "created_at_ms", "expires_at_ms", "consumed_at_ms",
]);
const EXACT_PARAMETER_ORDER = Object.freeze([
  "targetDescriptorHash", "targetSchemaIdentitySha256",
  "sourceDescriptorHash", "sourceSchemaIdentitySha256",
]);
const EXACT_STATES = Object.freeze([
  "pre-rebind-complete", "publication-active", "cursor/clock-complete", "poisoned", "disposed",
]);
const EXACT_TRANSITIONS = Object.freeze([
  "pre-rebind-complete->publication-active", "publication-active->cursor/clock-complete",
]);
const EXACT_AUTHORITY_OBJECTS = Object.freeze([
  "preRebindReceipt", "projectionReference", "stageOwnershipTransfer",
  "baselineTempStage", "sqliteConnection", "migrationLockCapability",
  "providerClockCapability", "outerClockEvidence", "preRebindClockEvidence",
  "preVerificationClockEvidence", "preCommitClockEvidence",
  "outerPublicationAuthority", "postDdlCatalogFence", "stageAdoptionReceipt",
  "publicationSession", "cursorClockCapability", "migrationLineagePublicationReceipt",
  "schemaDescriptorMetadataPublicationReceipt", "publicationRulesReceipt",
  "freshV2CatalogReceipt", "physicalSemanticPostconditionsReceipt",
  "preRetirementStageFenceReceipt", "stageRetirementReceipt", "finalCommitFenceReceipt",
]);
const EXACT_OUTER_COMMITMENTS = Object.freeze([
  "b2-exact-object-graph", "migration-lock-capability-object-identity",
  "migration-lock-active-expires-at-ms", "provider-clock-capability-object-identity",
  "outer-clock-evidence-object-identity", "outer-provider-now-ms",
  "transaction-generation", "source-identities",
  "expected-target-identities", "expected-target-catalog", "outer-write-ledger",
]);
const EXACT_ADOPTION_RECEIPTS = Object.freeze([
  "migration-0002-catalog-rebuild-receipt", "baseline-entries-publication-receipt",
  "baseline-header-publication-receipt", "operation-sequence-zero-publication-receipt",
]);
const EXACT_COMMITMENTS = Object.freeze([
  "receipt-object-identity", "projection-object-identity", "stage-object-identity",
  "connection-object-identity", "transaction-generation", "migration-lock-id",
  "migration-lock-owner-id", "migration-lock-epoch", "migration-lock-fencing-token",
  "migration-lock-capability-object-identity", "migration-lock-active-expires-at-ms",
  "migration-source-version", "migration-target-version",
  "provider-clock-capability-object-identity",
  "pre-rebind-clock-evidence-receipt-object-identity", "pre-rebind-provider-now-ms",
  "post-0002-catalog-fence", "stage-adoption-receipt", "source-descriptor-hash",
  "source-schema-identity", "target-descriptor-hash", "target-schema-identity",
]);
const EXACT_HOSTILE = Object.freeze([
  "diagnosed-b2-outcome", "cloned-receipt", "cloned-projection", "wrong-stage",
  "wrong-transfer", "wrong-connection", "wrong-publication-session",
  "inactive-migration-lock", "wrong-lock-owner", "wrong-lock-epoch", "wrong-lock-fence",
  "wrong-lock-source-version", "wrong-lock-target-version",
  "cloned-migration-lock-capability", "provider-clock-evidence-substitution",
  "lock-expiry-before-provider-now", "lock-expiry-equal-provider-now",
  "lock-expiry-changed-after-session-mint",
  "provider-clock-advanced-past-expiry-after-session-mint",
  "stale-provider-clock-evidence-replay", "missing-post-cursor-lineage-receipt",
  "missing-post-cursor-metadata-receipt", "pre-retirement-stage-fence-substitution",
  "stage-retirement-receipt-substitution", "owned-temp-residue-after-retirement",
  "provider-clock-receipt-clone", "provider-clock-boundary-reordered",
  "provider-clock-boundary-skipped", "provider-clock-regression",
  "provider-clock-fifth-observation", "post-cursor-receipt-order-swapped",
  "post-cursor-unexplained-write", "pre-retirement-adoption-before-audits",
  "pre-retirement-adoption-reuse", "temp-same-name-identity-substitution",
  "unrelated-temp-object-dropped", "active-main-key-count-cursor-at-retirement",
  "active-key-driver-cursor-at-retirement", "active-point-cursor-at-retirement",
  "permanent-write-after-retirement", "final-commit-fence-reuse",
  "main-key-count-cancellation-close-failure",
  "main-key-count-driver-prepare-before-close",
  "same-ddl-rootpage-reuse-after-temp-recreate",
  "pre-verification-clock-receipt-second-consumption",
  "pre-rebind-clock-receipt-unconsumed", "pre-rebind-clock-receipt-substitution",
  "cursor-clock-capability-clone", "cursor-clock-preverification-unconsumed",
  "lineage-publication-receipt-substitution", "metadata-publication-receipt-substitution",
  "pre-retirement-receipt-commitment-drift", "retirement-receipt-commitment-drift",
  "final-commit-receipt-commitment-drift", "outer-write-receipt-order-swapped",
  "audit-receipt-second-consumption", "missing-consumed-audit-tombstone",
  "outer-write-receipt-second-consumption", "missing-consumed-outer-write-tombstone",
  "outer-clock-evidence-receipt-unconsumed",
  "initial-write-receipt-second-consumption",
  "initial-write-receipt-partial-consumption-on-failed-bundle",
  "missing-initial-write-consumed-tombstone",
  "rollback-and-rebegin",
  "post-0002-catalog-drift", "unexplained-permanent-write", "affected-count-minus-one",
  "affected-count-plus-one", "total-changes-disagreement", "write-ledger-disagreement",
  "second-rebind", "partial-rebind", "mixed-source-target-identities",
  "third-party-identities", "immutable-field-drift", "same-length-request-blob-drift",
  "same-length-snapshot-blob-drift", "cursor-insert", "cursor-delete",
  "equal-count-insert-delete", "root-preserving-count-drift", "second-verification",
  "disposed-reuse",
]);
const EXACT_PARITY = Object.freeze([
  "literal-fixture-consumed-by-both-runtimes", "exact-sql-and-hash-parity",
  "exact-target-identity-parity", "exact-state-transition-parity",
  "exact-failure-precedence-parity", "exact-count-root-parity", "fresh-v2-path",
  "v1-to-v2-path", "v0-to-v1-to-v2-path", "cross-runtime-upgrade-and-reopen",
  "npm-wheel-sdist-asset-byte-parity", "pre-commit-crash-reopens-v1",
  "post-commit-crash-reopens-v2",
]);
const EXACT_FAULTS = Object.freeze([
  "before-outer-publication-authority", "after-outer-publication-authority", "after-0002",
  "after-baseline-first-entry", "after-baseline-middle-entry", "after-baseline-last-entry",
  "after-baseline-header", "after-sequence-zero", "before-cursor-rebind",
  "after-cursor-rebind", "after-rule-11", "during-rule-12-first-row",
  "during-rule-12-middle-row", "during-rule-12-last-row", "after-rule-12",
  "after-lineage", "after-metadata", "after-publication-rules", "before-commit",
  "commit-returned",
]);
const EXACT_CANCELLATION_LABELS = Object.freeze([
  "before-outer-authority", "before-0002", "after-post-ddl-fence",
  "before-cursor-session", "before-rebind-prepare", "before-rebind-execute",
  "after-rebind-execute", "before-rule-11", "before-main-key-count-prepare",
  "before-main-key-count-first-fetch", "before-main-key-count-next-fetch",
  "before-main-key-count-finish", "before-key-driver-prepare",
  "before-key-driver-first-fetch", "before-key-driver-next-fetch",
  "before-point-lookup-prepare", "before-point-lookup-execute",
  "after-point-lookup-fetch", "before-rule-12-finish", "before-cursor-clock-complete",
]);
const EXACT_STATEMENT_BOUNDARIES = Object.freeze([
  "rebind-prepare", "rebind-execute", "rebind-finalize", "changes-prepare",
  "changes-fetch", "changes-finalize", "main-key-count-prepare", "main-key-count-fetch",
  "main-key-count-finalize",
  "key-driver-prepare", "key-driver-fetch", "key-driver-finalize", "point-lookup-prepare",
  "point-lookup-execute", "point-lookup-fetch", "point-lookup-finalize",
]);
const EXACT_CLEANUP_FAULTS = Object.freeze([
  "rebind-finalize-failure", "changes-finalize-failure", "main-key-count-finalize-failure",
  "key-driver-finalize-failure", "point-lookup-finalize-failure",
  "temp-carrier-disposal-failure", "primary-plus-cleanup-failure",
]);
const EXACT_EQP = Object.freeze([
  "temp-driver-primary-key-order-without-sort",
  "main-cursor-primary-key-count-order-without-sort",
  "main-cursor-primary-key-point-lookup",
]);
const EXACT_CLEANUP_ORDER = Object.freeze({
  mainKeyCountSuccess: Object.freeze([
    "close-main-key-count-cursor", "clear-main-key-count-ownership", "prepare-key-driver",
  ]),
  mainKeyCountFailureOrCancellation: Object.freeze([
    "main-key-count-cursor", "temp-stage", "outer-cleanup",
  ]),
  sealFailureOrCancellation: Object.freeze([
    "point-cursor", "driver-cursor", "temp-stage", "outer-cleanup",
  ]),
});
const EXACT_CANCELLATION_SEMANTICS = Object.freeze({
  labelsAreRequestInjectionPoints: true,
  rebindStartedPrimaryBeforeCancellation: Object.freeze([
    "statement-release", "changes-result", "write-ledger", "rule-11",
  ]),
  mainKeyCountRowStartedPrimaryBeforeCancellation: Object.freeze([
    "decode-current-main-key", "validate-current-main-key", "increment-main-key-count",
  ]),
  mainKeyCountBeforeFetchCancellation: Object.freeze([
    "close-main-key-count-cursor", "clear-main-key-count-ownership", "observe-cancellation",
  ]),
  mainKeyCountTerminalPrimaryBeforeCancellation: Object.freeze([
    "prove-terminal-result", "close-main-key-count-cursor",
    "clear-main-key-count-ownership", "freeze-main-key-count",
  ]),
  mainKeyCountTerminalCancellationObservedAfterFrozenCount: true,
  mainKeyCountCloseFailurePrecedence: Object.freeze([
    "earlier-fetch-decode-order-count-or-terminal-primary",
    "main-key-count-close-failure", "cancellation",
    "temp-or-outer-cleanup-failure",
  ]),
  mainKeyCountCancellationClosesCursorBeforeTempCleanup: true,
  rule12RowStartedPrimaryBeforeCancellation: Object.freeze([
    "decode-current-main-row", "validate-current-main-row", "close-point-cursor",
  ]),
  rule12FinalPrimaryBeforeCancellation: Object.freeze([
    "finish-accumulator", "compare-main-key-count", "compare-receipt-count-root",
    "compare-target-identities",
  ]),
  cleanupAlwaysLast: true,
});
const EXACT_SQL = Object.freeze({
  rebind: "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, schema_identity_sha256 = ? WHERE descriptor_hash = ? AND schema_identity_sha256 = ?",
  affectedCount: "SELECT changes() AS affected_rows",
  postRebindMainKeyCountScan: "SELECT tenant_id, token_hash FROM main.ge_cycle_cursors ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY",
  postRebindKeyDriver: "SELECT tenant_id, token_hash FROM temp.ge_blr_cursor_seal ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
  postRebindPointLookup: "SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash, stream_id, checkpoint_scope, request_scope_blob, page_size, next_position, snapshot_tail_sequence, snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256, snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms FROM main.ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ? LIMIT 1",
});

export class CursorPublicationContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CursorPublicationContractError";
    this.code = code;
  }
}
function fail(code, message) { throw new CursorPublicationContractError(code, message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function normalizeSql(sql) { return sql.trim().replace(/[\t\n\v\f\r ]+/gu, " "); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
function fixtureDigest(value) {
  const copy = structuredClone(value);
  copy.parityGates.fixtureCanonicalSha256 = "0".repeat(64);
  return sha256(JSON.stringify(canonicalize(copy)));
}
function exact(actual, expected, code, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code, message);
}

export function parseStrictJson(text) {
  let index = 0;
  const whitespace = () => { while (/[\t\n\r ]/u.test(text[index] ?? "")) index += 1; };
  const string = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index++] === '"') return JSON.parse(text.slice(start, index));
    }
    throw new SyntaxError("unterminated JSON string");
  };
  const value = () => {
    whitespace();
    if (text[index] === "{") {
      index += 1;
      const result = Object.create(null);
      const seen = new Set();
      whitespace();
      if (text[index] === "}") { index += 1; return result; }
      while (true) {
        whitespace();
        if (text[index] !== '"') throw new SyntaxError("object key must be a string");
        const key = string();
        if (seen.has(key)) throw new SyntaxError(`duplicate key ${key}`);
        seen.add(key);
        whitespace();
        if (text[index++] !== ":") throw new SyntaxError("missing colon");
        result[key] = value();
        whitespace();
        const separator = text[index++];
        if (separator === "}") return result;
        if (separator !== ",") throw new SyntaxError("missing comma");
      }
    }
    if (text[index] === "[") {
      index += 1;
      const result = [];
      whitespace();
      if (text[index] === "]") { index += 1; return result; }
      while (true) {
        result.push(value());
        whitespace();
        const separator = text[index++];
        if (separator === "]") return result;
        if (separator !== ",") throw new SyntaxError("missing comma");
      }
    }
    if (text[index] === '"') return string();
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(index));
    if (match === null) throw new SyntaxError("invalid JSON value");
    index += match[0].length;
    return JSON.parse(match[0]);
  };
  const result = value();
  whitespace();
  if (index !== text.length) throw new SyntaxError("trailing JSON content");
  return result;
}

const schema = parseStrictJson(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
const validateShape = ajv.compile(schema);

export function loadCursorPublicationFixture() {
  return parseStrictJson(readFileSync(FIXTURE_PATH, "utf8"));
}

export function validateCursorPublicationFixture(value, { verifyAssets = false } = {}) {
  if (!validateShape(value)) fail("GE_CURSOR_B3_SCHEMA", JSON.stringify(validateShape.errors));
  const { source, target, migration } = value.identities;
  exact(
    [source.schemaVersion, source.descriptorHash, source.schemaIdentitySha256],
    [1, EXACT_IDENTITIES.sourceDescriptorHash, EXACT_IDENTITIES.sourceSchemaIdentity],
    "GE_CURSOR_B3_SOURCE_IDENTITY", "source identity drifted",
  );
  exact(
    [target.schemaVersion, target.descriptorHash, target.descriptorBodySha256,
      target.descriptorCanonicalSha256, target.schemaIdentitySha256],
    [2, EXACT_IDENTITIES.targetDescriptorHash, EXACT_IDENTITIES.targetDescriptorBodySha256,
      EXACT_IDENTITIES.targetDescriptorCanonicalSha256, EXACT_IDENTITIES.targetSchemaIdentity],
    "GE_CURSOR_B3_TARGET_IDENTITY", "target identity drifted",
  );
  exact(
    [migration.sqlSha256, migration.schemaSqlSha256, migration.previewManifestSha256],
    [EXACT_IDENTITIES.migrationSqlSha256, EXACT_IDENTITIES.schemaSqlSha256,
      EXACT_IDENTITIES.previewManifestSha256],
    "GE_CURSOR_B3_MIGRATION_IDENTITY", "migration asset identity drifted",
  );
  exact(value.sequence.orderedStages, EXACT_STAGES,
    "GE_CURSOR_B3_SEQUENCE", "atomic migration sequence drifted");
  exact(value.rules, EXACT_RULES,
    "GE_CURSOR_B3_RULE_ORDER", "rules 11/12 order drifted");
  exact(value.failureContract.boundaryPrecedence, EXACT_PRECEDENCE,
    "GE_CURSOR_B3_FAILURE_PRECEDENCE", "failure precedence drifted");
  exact(value.sealContract.mutableFields, EXACT_MUTABLE_FIELDS,
    "GE_CURSOR_B3_MUTABLE_FIELDS", "mutable field inventory drifted");
  exact(value.sealContract.immutablePhysicalFields, EXACT_IMMUTABLE_FIELDS,
    "GE_CURSOR_B3_IMMUTABLE_FIELDS", "immutable field inventory drifted");
  exact(value.sqlContract.rebind.parameterOrder, EXACT_PARAMETER_ORDER,
    "GE_CURSOR_B3_PARAMETER_ORDER", "rebind parameter order drifted");
  exact(value.stateMachine.states, EXACT_STATES,
    "GE_CURSOR_B3_STATES", "state inventory drifted");
  exact(value.stateMachine.successTransitions, EXACT_TRANSITIONS,
    "GE_CURSOR_B3_TRANSITIONS", "success transitions drifted");
  exact(value.authority.requiredExactObjects, EXACT_AUTHORITY_OBJECTS,
    "GE_CURSOR_B3_AUTHORITY_GRAPH", "exact authority graph drifted");
  exact(value.authority.outerPublicationAuthority.requiredCommitments,
    EXACT_OUTER_COMMITMENTS, "GE_CURSOR_B3_OUTER_COMMITMENTS",
    "outer publication commitments drifted");
  exact(value.authority.stageAdoptionBridge.requiredOuterWriteReceipts,
    EXACT_ADOPTION_RECEIPTS, "GE_CURSOR_B3_STAGE_ADOPTION",
    "stage adoption receipt order drifted");
  exact(value.authority.publicationSession.requiredCommitments, EXACT_COMMITMENTS,
    "GE_CURSOR_B3_COMMITMENTS", "publication commitments drifted");
  exact(value.hostileObligations, EXACT_HOSTILE,
    "GE_CURSOR_B3_HOSTILE_MATRIX", "hostile obligations drifted");
  exact(value.parityGates.required, EXACT_PARITY,
    "GE_CURSOR_B3_PARITY_GATES", "parity gates drifted");
  exact(value.faultMatrix.boundaries, EXACT_FAULTS,
    "GE_CURSOR_B3_FAULT_MATRIX", "fault boundaries drifted");
  exact(value.lifecycleContract.cancellationLabels, EXACT_CANCELLATION_LABELS,
    "GE_CURSOR_B3_CANCELLATION", "cancellation labels drifted");
  exact(value.lifecycleContract.statementBoundaries, EXACT_STATEMENT_BOUNDARIES,
    "GE_CURSOR_B3_STATEMENT_LIFECYCLE", "statement boundaries drifted");
  exact(value.lifecycleContract.cleanupFaults, EXACT_CLEANUP_FAULTS,
    "GE_CURSOR_B3_CLEANUP", "cleanup faults drifted");
  exact(value.lifecycleContract.cancellationSemantics, EXACT_CANCELLATION_SEMANTICS,
    "GE_CURSOR_B3_CANCELLATION_SEMANTICS", "cancellation observation drifted");
  exact(value.sealContract.phaseCleanupOrder, EXACT_CLEANUP_ORDER,
    "GE_CURSOR_B3_CLEANUP_ORDER", "cursor cleanup order drifted");
  exact(value.sqlContract.eqpRequired, EXACT_EQP,
    "GE_CURSOR_B3_EQP", "EQP requirements drifted");

  const sqlPairs = ["rebind", "affectedCount", "postRebindMainKeyCountScan",
    "postRebindKeyDriver", "postRebindPointLookup"];
  for (const name of sqlPairs) {
    const pair = value.sqlContract[name];
    if (normalizeSql(pair.sql) !== EXACT_SQL[name]) {
      fail("GE_CURSOR_B3_SQL_LITERAL", `${name} SQL literal drifted`);
    }
    if (sha256(normalizeSql(pair.sql)) !== pair.sha256) {
      fail("GE_CURSOR_B3_SQL_HASH", `${name} SQL hash drifted`);
    }
  }
  if (!/^UPDATE main\.ge_cycle_cursors SET descriptor_hash = \?, schema_identity_sha256 = \? WHERE descriptor_hash = \? AND schema_identity_sha256 = \?$/u
    .test(normalizeSql(value.sqlContract.rebind.sql))) {
    fail("GE_CURSOR_B3_REBIND_SQL", "rebind must update only the two manifest-bound identities");
  }
  if (!normalizeSql(value.sqlContract.postRebindKeyDriver.sql)
    .endsWith("ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY")) {
    fail("GE_CURSOR_B3_SCAN_ORDER", "post-rebind key driver order drifted");
  }
  const updateIndex = EXACT_STAGES.indexOf("cursor-rebind-executed-once");
  const sequenceIndex = EXACT_STAGES.indexOf("operation-sequence-zero-published");
  const metadataIndex = EXACT_STAGES.indexOf("schema-and-descriptor-metadata-published");
  const commitIndex = EXACT_STAGES.indexOf("single-atomic-commit");
  if (!(sequenceIndex < updateIndex && updateIndex < metadataIndex && metadataIndex < commitIndex)) {
    fail("GE_CURSOR_B3_ATOMIC_ORDER", "rebind must remain inside the complete atomic migration");
  }
  if (value.hostileObligations.length !== 83
      || value.faultMatrix.boundaries.at(-1) !== "commit-returned") {
    fail("GE_CURSOR_B3_MATRIX", "hostile or fault matrix drifted");
  }
  const digest = fixtureDigest(value);
  if (digest !== TRUSTED_FIXTURE_SHA256
      || value.parityGates.fixtureCanonicalSha256 !== TRUSTED_FIXTURE_SHA256) {
    fail("GE_CURSOR_B3_FIXTURE_HASH", "canonical fixture SHA-256 drifted");
  }
  if (verifyAssets) {
    const assets = [
      ["spec/migrations/sqlite/0002-v1-to-v2-operation-replay.sql", migration.sqlSha256],
      ["spec/migrations/sqlite/schema-v2.sql", migration.schemaSqlSha256],
      ["spec/migrations/sqlite/manifest-v2.preview.json", migration.previewManifestSha256],
    ];
    for (const [relativePath, expectedHash] of assets) {
      const actual = sha256(readFileSync(join(REPOSITORY_ROOT, relativePath)));
      if (actual !== expectedHash) fail("GE_CURSOR_B3_ASSET_HASH", `${relativePath} drifted`);
    }
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFileSync(join(
        REPOSITORY_ROOT, "spec/migrations/sqlite/schema-v2.sql",
      ), "utf8"));
      const ownershipFixture = parseStrictJson(readFileSync(join(
        REPOSITORY_ROOT, "spec/conformance/sqlite-cursor-stage-ownership.case.json",
      ), "utf8"));
      database.exec(ownershipFixture.cursorSealTempTableDdl);
      const driverDetails = database.prepare(
        `EXPLAIN QUERY PLAN ${EXACT_SQL.postRebindKeyDriver}`,
      ).all().map((row) => String(row.detail).toUpperCase());
      const countDetails = database.prepare(
        `EXPLAIN QUERY PLAN ${EXACT_SQL.postRebindMainKeyCountScan}`,
      ).all().map((row) => String(row.detail).toUpperCase());
      const lookupDetails = database.prepare(
        `EXPLAIN QUERY PLAN ${EXACT_SQL.postRebindPointLookup}`,
      ).all("tenant", "token").map((row) => String(row.detail).toUpperCase());
      const details = [...driverDetails, ...countDetails, ...lookupDetails];
      if (value.sqlContract.eqpForbiddenDetailFragments.some((fragment) =>
        details.some((detail) => detail.includes(fragment)))) {
        fail("GE_CURSOR_B3_EQP", "post-rebind proof uses a forbidden query plan");
      }
      if (!driverDetails.some((detail) => detail.includes("GE_BLR_CURSOR_SEAL"))
          || !countDetails.some((detail) => detail.includes("GE_CYCLE_CURSORS"))
          || !lookupDetails.some((detail) =>
            detail.includes("USING PRIMARY KEY (TENANT_ID=? AND TOKEN_HASH=?)"))) {
        fail("GE_CURSOR_B3_EQP", "post-rebind proof lacks its frozen primary-key plans");
      }
    } finally {
      database.close();
    }
  }
  return Object.freeze({
    ok: true,
    id: value.id,
    status: value.status,
    taskId: value.boundary.stableTaskId,
    stageCount: value.sequence.orderedStages.length,
    ruleCount: value.rules.length,
    hostileObligationCount: value.hostileObligations.length,
    faultBoundaryCount: value.faultMatrix.boundaries.length,
    targetDescriptorHash: value.identities.target.descriptorHash,
    targetSchemaIdentitySha256: value.identities.target.schemaIdentitySha256,
    fixtureCanonicalSha256: digest,
    implementationClaim: value.claims.implementationClaim,
    activeManifestClaim: value.claims.activeManifestClaim,
  });
}

export function validateCanonicalCursorPublicationFixture() {
  return validateCursorPublicationFixture(loadCursorPublicationFixture(), { verifyAssets: true });
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(validateCanonicalCursorPublicationFixture(), null, 2)}\n`);
}
