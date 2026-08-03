#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { validateCanonicalCursorPublicationFixture } from
  "./sqlite-cursor-publication-rebind-v2.validate.mjs";
import { validateCanonicalPostConsumeFinalizerFixture } from
  "./sqlite-post-consume-transaction-failure-finalizer-v1.validate.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(ROOT, "sqlite-cursor-publication-transaction-owner-v1.case.json");
const SCHEMA_PATH = join(ROOT, "sqlite-cursor-publication-transaction-owner-v1.schema.json");
const ZERO_DIGEST = "0".repeat(64);
const DIGEST_DOMAIN =
  "graph-engineering/sqlite-cursor-publication-transaction-owner-v1-fixture/v1\0";

export const TRUSTED_FIXTURE_SHA256 =
  "e900c0d822a31690c6cd4ef8d160d1cc4474bf4c605471d1aac899d4b293b303";

const REBIND_FIXTURE_SHA256 =
  "d368cd53e819e06e950f2dabedcb5a5b2fca535536efe85abb2e4b488bae2e7d";
const FAILURE_FINALIZER_FIXTURE_SHA256 =
  "81c055216223c89dc68055bbf325a73c61bfb899977dfb6255059137783ae360";

const GUARDED_PATHS = Object.freeze([
  "connection-commit-method", "connection-rollback-method", "execute-COMMIT-or-END",
  "execute-ROLLBACK", "execute-BEGIN", "execute-SAVEPOINT-or-RELEASE-or-ROLLBACK-TO",
  "multi-statement-exec-containing-transaction-control",
  "prepared-statement-containing-transaction-control",
  "script-containing-implicit-or-explicit-transaction-control", "nested-BEGIN",
  "close-live-guarded-transaction", "newly-prepared-permanent-DML-after-pre-retirement",
  "already-prepared-permanent-DML-after-pre-retirement",
  "newly-prepared-permanent-DDL-after-pre-retirement",
  "already-prepared-permanent-DDL-after-pre-retirement",
  "persistent-PRAGMA-including-user-version-or-application-id",
  "VACUUM-ANALYZE-or-REINDEX", "ATTACH-DETACH-or-connection-topology-change",
  "any-other-permanent-state-mutation-or-transaction-proof-history-change",
]);

const BEGIN_RECEIPT_COMMITMENTS = Object.freeze([
  "exact-transaction-owner-identity", "exact-connection-object-identity",
  "exact-transaction-lineage-object-identity", "exact-transaction-generation-commitment",
  "exclusive-mode", "transaction-epoch", "total-changes", "temp-mutation-epoch",
  "begin-attempt-one",
]);

const COMMON_OBJECTS = Object.freeze([
  "sqlite-connection-object-identity", "transaction-owner-object-identity",
  "begin-receipt-object-identity", "transaction-lineage-object-identity",
  "transaction-generation-commitment", "database-reopen-capability-object-identity",
]);
const FAILURE_OBJECTS = Object.freeze([
  "transaction-owner-object-identity", "authenticated-terminal-primary-object-identity",
  "post-consume-failure-rollback-owner-object-identity",
]);
const SUCCESS_OBJECTS = Object.freeze([
  "transaction-owner-object-identity", "final-commit-fence-receipt-object-identity",
]);
const COMMIT_FAILURE_OBJECTS = Object.freeze([
  "transaction-owner-object-identity", "native-commit-primary-object-identity",
  "internal-commit-failure-cleanup-owner-object-identity",
]);
const TRANSITIVE_FENCE_OBJECTS = Object.freeze([
  "outer-publication-authority-object-identity", "rule-11-success-receipt-object-identity",
  "rule-12-success-receipt-object-identity",
  "pre-verification-clock-consumed-receipt-object-identity",
  "cursor-clock-complete-capability-object-identity",
  "lineage-publication-receipt-object-identity", "metadata-publication-receipt-object-identity",
  "publication-rules-receipt-object-identity", "fresh-v2-catalog-receipt-object-identity",
  "physical-semantic-audit-receipt-object-identity",
  "pre-retirement-stage-fence-receipt-object-identity",
  "stage-retirement-receipt-object-identity",
  "pre-commit-clock-consumed-receipt-object-identity",
]);

const ATOMIC_PUBLICATION_ORDER = Object.freeze([
  "source-v1-semantically-valid", "transaction-owner-registered",
  "begin-exclusive-returned", "b2-pre-rebind-complete", "outer-clock-evidence-consumed",
  "outer-publication-authority-minted", "migration-0002-catalog-rebuild",
  "post-0002-catalog-fence-adopted", "baseline-entries-published",
  "baseline-header-published", "operation-sequence-zero-published",
  "post-ddl-stage-authority-adopted", "pre-rebind-clock-evidence-consumed",
  "cursor-publication-session-minted", "cursor-rebind-executed-once",
  "rule-11-rebind-count-accepted", "rule-12-main-table-seal-accepted",
  "pre-verification-clock-evidence-consumed", "cursor-clock-complete",
  "migration-lineage-published", "schema-and-descriptor-metadata-published",
  "publication-rules-accepted", "fresh-v2-catalog-equivalence-accepted",
  "physical-and-semantic-postconditions-accepted",
  "pre-retirement-stage-fence-adopted", "cursor-temp-stage-retired",
  "pre-commit-clock-evidence-consumed",
  "final-migration-lock-transaction-fence-accepted",
  "success-commit-authority-selected-internal-state-no-new-capability",
  "single-atomic-commit",
]);
const REJECTED_DIRECT_AUTHORITIES = Object.freeze([
  "boolean-success", "rule-11-success-receipt", "raw-seal-read-evidence",
  "rule-12-success-receipt", "pre-verification-clock-evidence",
  "cursor-clock-complete-capability", "stage-retirement-receipt",
  "pre-commit-clock-evidence",
]);

const STATES = Object.freeze([
  "registered", "beginning", "active", "begin-postflight-in-doubt",
  "begin-failed-same-generation-active", "begin-in-doubt", "failure-claimed", "success-claimed", "committing",
  "commit-returned", "commit-failed-same-generation-active", "commit-in-doubt",
  "success-authority-tombstoned", "commit-failure-cleanup-owned", "rolling-back",
  "rolled-back", "rollback-failed", "rollback-in-doubt", "closing", "awaiting-reopen", "reopen-verified-v1",
  "reopen-verified-v2", "reopen-unavailable", "corrupt", "finalized",
]);
const TRANSITIONS = Object.freeze([
  "registered->beginning", "beginning->active", "beginning->begin-postflight-in-doubt",
  "beginning->begin-failed-same-generation-active", "beginning->begin-in-doubt",
  "begin-postflight-in-doubt->closing",
  "begin-failed-same-generation-active->rolling-back", "begin-in-doubt->closing",
  "active->failure-claimed", "failure-claimed->rolling-back", "active->success-claimed",
  "success-claimed->committing", "committing->commit-returned",
  "committing->commit-failed-same-generation-active", "committing->commit-in-doubt",
  "commit-returned->success-authority-tombstoned",
  "commit-in-doubt->success-authority-tombstoned",
  "commit-failed-same-generation-active->success-authority-tombstoned",
  "success-authority-tombstoned->commit-failure-cleanup-owned",
  "success-authority-tombstoned->closing",
  "commit-failure-cleanup-owned->rolling-back", "rolling-back->rolled-back",
  "rolling-back->rollback-failed", "rollback-failed->closing",
  "rollback-failed->rollback-in-doubt", "rollback-in-doubt->closing",
  "rolled-back->closing",
  "closing->awaiting-reopen", "awaiting-reopen->reopen-verified-v1",
  "awaiting-reopen->reopen-verified-v2", "awaiting-reopen->reopen-unavailable",
  "awaiting-reopen->corrupt", "reopen-verified-v1->finalized",
  "reopen-verified-v2->finalized", "reopen-unavailable->finalized", "corrupt->finalized",
]);

const TRUSTED_OBSERVATIONS = Object.freeze([
  "same-exact-exclusive-generation-active", "verified-autocommit",
  "different-generation-active", "observation-unavailable",
]);
const SAME_GENERATION_PROOF = Object.freeze([
  "exact-owned-connection-is-live", "native-in-transaction-true",
  "exact-lineage-object-still-selected", "exact-generation-commitment-unchanged",
  "transaction-epoch-unchanged", "exclusive-mode-still-selected",
]);
const REOPEN_CLASSIFICATIONS = Object.freeze([
  "source-v1", "complete-v2", "intermediate-corrupt", "unavailable-unresolved",
]);
const REOPEN_EVIDENCE = Object.freeze([
  "exact-database-reopen-identity", "application-id-and-user-version",
  "exact-physical-catalog-digest", "schema-descriptor-and-lineage-metadata",
  "baseline-entry-count-and-root", "cursor-count-root-and-target-identities",
  "operation-sequence-and-legacy-replay-commitments", "migration-lock-terminal-state",
  "integrity-check-ok", "foreign-key-check-empty",
]);
const DIAGNOSTIC_ORDER = Object.freeze([
  "presentation-or-authority-rejection-before-io",
  "final-fence-validation-before-consumption", "native-begin-or-commit-primary",
  "rollback-secondary-if-authorized", "close-tertiary", "reopen-audit-diagnostic",
]);
const IO_COUNT_ORDER = Object.freeze([
  "begin-attempt", "commit-attempt", "rollback-attempt", "close-attempt", "reopen-attempt",
]);
const OWNERSHIP_COUNT_ORDER = Object.freeze([
  "failure-claim", "success-claim", "success-authority-tombstone",
  "begin-failure-cleanup-claim", "commit-failure-cleanup-claim",
]);

const NONCLAIMS = Object.freeze([
  "runtime-owner-implementation", "runtime-begin-execution", "runtime-commit-execution",
  "runtime-rollback-integration", "rule-12-success-receipt", "third-clock-authorization",
  "cursor-clock-complete", "post-cursor-adoption", "temp-stage-retirement",
  "pre-commit-clock-authorization", "final-commit-fence-implementation",
  "driver-native-begin-or-commit-throw", "commit-crash-reopen-proof",
  "package-root-public-export", "active-manifest-release",
]);

const EXPECTED_CASE_PROJECTIONS = Object.freeze([
  ["contract-redbar",false,"contract","none","not-attempted","not-applicable","not-attempted","unclaimed",[0,0,0,0,0],[0,0,0,0,0],"contract-redbar","not-executed"],
  ["begin-returned-active",false,"begin","exact-transaction-owner","returned","same-exact-exclusive-generation-active","not-attempted","transaction-owner-active",[1,0,0,0,0],[0,0,0,0,0],"active","active"],
  ["begin-threw-same-generation-active",false,"begin","exact-transaction-owner","threw","same-exact-exclusive-generation-active","source-v1","begin-failure-cleanup-owned",[1,0,1,1,1],[0,0,0,1,0],"source-v1","begin-failed"],
  ["begin-threw-autocommit",false,"begin","exact-transaction-owner","threw","verified-autocommit","source-v1","begin-in-doubt",[1,0,0,1,1],[0,0,0,0,0],"source-v1","begin-failed"],
  ["begin-threw-observation-unavailable",false,"begin","exact-transaction-owner","threw","observation-unavailable","unavailable-unresolved","begin-in-doubt",[1,0,0,1,1],[0,0,0,0,0],"unavailable-unresolved","unresolved"],
  ["terminal-primary-selects-failure-claim",false,"active-failure","exact-authenticated-terminal-primary","not-attempted","same-exact-exclusive-generation-active","source-v1","failure-claimed",[1,0,1,1,1],[1,0,0,0,0],"source-v1","failure"],
  ["commit-returned-reopen-v2",false,"commit","exact-final-commit-fence","returned","verified-autocommit","complete-v2","success-claimed",[1,1,0,1,1],[0,1,1,0,0],"complete-v2","success"],
  ["commit-threw-same-generation-active-rollback-v1",false,"commit","exact-final-commit-fence","threw","same-exact-exclusive-generation-active","source-v1","success-claimed-internal-cleanup",[1,1,1,1,1],[0,1,1,0,1],"source-v1","failure"],
  ["commit-threw-autocommit-reopen-v1",false,"commit","exact-final-commit-fence","threw","verified-autocommit","source-v1","success-claimed-commit-in-doubt",[1,1,0,1,1],[0,1,1,0,0],"source-v1","failure"],
  ["commit-threw-autocommit-reopen-v2",false,"commit","exact-final-commit-fence","threw","verified-autocommit","complete-v2","success-claimed-commit-in-doubt",[1,1,0,1,1],[0,1,1,0,0],"complete-v2","recovered-success"],
  ["commit-threw-different-generation-reopen-intermediate",false,"commit","exact-final-commit-fence","threw","different-generation-active","intermediate-corrupt","success-claimed-commit-in-doubt",[1,1,0,1,1],[0,1,1,0,0],"intermediate-corrupt","corruption"],
  ["commit-threw-observation-unavailable-reopen-unavailable",false,"commit","exact-final-commit-fence","threw","observation-unavailable","unavailable-unresolved","success-claimed-commit-in-doubt",[1,1,0,1,1],[0,1,1,0,0],"unavailable-unresolved","unresolved"],
  ["commit-threw-autocommit-reopen-intermediate",false,"commit","exact-final-commit-fence","threw","verified-autocommit","intermediate-corrupt","success-claimed-commit-in-doubt",[1,1,0,1,1],[0,1,1,0,0],"intermediate-corrupt","corruption"],
]);
const EXPECTED_BEGIN_POSTFLIGHT = Object.freeze([
  ["begin-returned-postflight-autocommit",false,"verified-autocommit",0,1,"source-v1","begin-postflight-failed"],
  ["begin-returned-postflight-different-generation",false,"different-generation-active",0,1,"intermediate-corrupt","corruption"],
  ["begin-returned-postflight-observation-unavailable",false,"observation-unavailable",0,1,"unavailable-unresolved","unresolved"],
]);
const EXPECTED_CLEANUP_FAULTS = Object.freeze([
  ["rollback-returned-close-returned",false,"returned","not-applicable","verified-autocommit","returned","source-v1","rolled-back","original-primary-failure"],
  ["rollback-threw-autocommit-close-returned",false,"threw","after-native-return","verified-autocommit","returned","source-v1","rollback-failed","original-primary-failure"],
  ["rollback-threw-active-close-returned",false,"threw","before-native-return","same-exact-exclusive-generation-active","returned","source-v1","rollback-in-doubt","original-primary-failure"],
  ["rollback-threw-observation-unavailable-close-threw",false,"threw","outcome-unavailable","observation-unavailable","threw","unavailable-unresolved","rollback-in-doubt","unresolved"],
]);
const EXPECTED_REOPEN_OUTCOMES = Object.freeze([
  ["commit-returned",["not-applicable"],"corruption","success","corruption","unresolved"],
  ["rollback-completed",["not-applicable"],"original-primary-failure","corruption","corruption","unresolved"],
  ["commit-in-doubt",["verified-autocommit","different-generation-active","observation-unavailable"],"commit-failed","recovered-success","corruption","unresolved"],
]);

export class TransactionOwnerContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TransactionOwnerContractError";
    this.code = code;
  }
}
function fail(code, message) { throw new TransactionOwnerContractError(code, message); }

export function parseStrictJson(text) {
  let index = 0;
  const whitespace = () => { while (/^[\t\n\r ]$/u.test(text[index] ?? "")) index += 1; };
  const string = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index] === '"') { index += 1; return JSON.parse(text.slice(start, index)); }
      index += 1;
    }
    throw new SyntaxError("unterminated JSON string");
  };
  const value = () => {
    whitespace();
    if (text[index] === "{") {
      index += 1;
      whitespace();
      const keys = new Set();
      if (text[index] === "}") { index += 1; return; }
      while (true) {
        whitespace();
        if (text[index] !== '"') throw new SyntaxError("JSON object key expected");
        const key = string();
        if (keys.has(key)) fail("GE_SQLITE_TX_OWNER_DUPLICATE_KEY", `duplicate JSON key ${key}`);
        if (key === "__proto__" || key === "constructor") {
          fail("GE_SQLITE_TX_OWNER_PROHIBITED_KEY", `prohibited JSON key ${key}`);
        }
        keys.add(key);
        whitespace();
        if (text[index] !== ":") throw new SyntaxError("JSON colon expected");
        index += 1;
        value();
        whitespace();
        const token = text[index];
        index += 1;
        if (token === "}") return;
        if (token !== ",") throw new SyntaxError("JSON object delimiter expected");
      }
    }
    if (text[index] === "[") {
      index += 1;
      whitespace();
      if (text[index] === "]") { index += 1; return; }
      while (true) {
        value();
        whitespace();
        const token = text[index];
        index += 1;
        if (token === "]") return;
        if (token !== ",") throw new SyntaxError("JSON array delimiter expected");
      }
    }
    if (text[index] === '"') { string(); return; }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u
      .exec(text.slice(index));
    if (!match) throw new SyntaxError("JSON value expected");
    index += match[0].length;
  };
  value();
  whitespace();
  if (index !== text.length) throw new SyntaxError("trailing JSON data");
  return JSON.parse(text);
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
    return Object.fromEntries(Object.keys(value).sort(compareCodePoints)
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
export function canonicalJson(value) { return JSON.stringify(canonicalize(value)); }
export function computeFixtureDigest(value) {
  const copy = structuredClone(value);
  copy.fixtureCanonicalSha256 = ZERO_DIGEST;
  return createHash("sha256").update(DIGEST_DOMAIN, "utf8")
    .update(canonicalJson(copy), "utf8").digest("hex");
}

const schema = parseStrictJson(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
assert.equal(ajv.validateSchema(schema), true,
  `transaction owner schema failed meta-validation: ${JSON.stringify(ajv.errors)}`);
const validateShape = ajv.compile(schema);

export function loadTransactionOwnerFixture() {
  return parseStrictJson(readFileSync(FIXTURE_PATH, "utf8"));
}
function exact(actual, expected, code, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code, message);
}
function projectCase(entry) {
  return [entry.caseId, entry.runtimeExecuted, entry.oracle.phase, entry.oracle.authority,
    entry.oracle.nativeResult, entry.oracle.trustedIntrinsicObservation,
    entry.oracle.reopenObservation, entry.expected.selectedOwner, entry.expected.ioCounts,
    entry.expected.ownershipCounts, entry.expected.terminalClassification,
    entry.expected.apiOutcome];
}
function projectBeginPostflight(entry) {
  return [entry.caseId, entry.runtimeExecuted, entry.trustedIntrinsicObservation,
    entry.rollbackAttemptCount, entry.closeAttemptCount, entry.reopenObservation,
    entry.apiOutcome];
}
function projectCleanupFault(entry) {
  return [entry.caseId, entry.runtimeExecuted, entry.rollbackResult,
    entry.rollbackThrowTiming, entry.postRollbackObservation, entry.closeResult, entry.reopenObservation,
    entry.stateAfterRollback, entry.apiOutcome];
}
function projectReopenOutcome(entry) {
  return [entry.preReopenOutcome, entry.coveredCommitIntrinsicObservations,
    entry.sourceV1ApiOutcome, entry.completeV2ApiOutcome,
    entry.intermediateApiOutcome, entry.unavailableApiOutcome];
}

function validateAnchors(value) {
  const rebind = validateCanonicalCursorPublicationFixture();
  const finalizer = validateCanonicalPostConsumeFinalizerFixture();
  if (rebind.fixtureCanonicalSha256 !== REBIND_FIXTURE_SHA256
      || rebind.fixtureCanonicalSha256 !== value.anchors.rebindFixtureCanonicalSha256
      || finalizer.fixtureCanonicalSha256 !== FAILURE_FINALIZER_FIXTURE_SHA256
      || finalizer.fixtureCanonicalSha256 !== value.anchors.failureFinalizerFixtureCanonicalSha256) {
    fail("GE_SQLITE_TX_OWNER_ANCHOR", "validated dependency trusted roots drifted");
  }
}

export function validateTransactionOwnerFixture(value, { verifyAnchors = true } = {}) {
  if (!validateShape(value)) {
    fail("GE_SQLITE_TX_OWNER_SCHEMA",
      `closed fixture schema failed: ${JSON.stringify(validateShape.errors)}`);
  }
  if (value.boundary.runtimeExecutedCaseCount !== 0
      || value.boundary.contractRuntimeTransactionControlCount !== 0
      || value.futureTargetCases.some((entry) => entry.runtimeExecuted)
      || value.beginPostflightFutureTargets.some((entry) => entry.runtimeExecuted)
      || value.cleanupFaultFutureTargets.some((entry) => entry.runtimeExecuted)) {
    fail("GE_SQLITE_TX_OWNER_TRUTHFULNESS", "contract redbar must contain zero runtime evidence");
  }
  exact(value.boundary.guardedTransactionControlPaths, GUARDED_PATHS,
    "GE_SQLITE_TX_OWNER_GUARD", "transaction-control or post-retirement bypass inventory drifted");
  exact(value.beginContract.receiptCommitments, BEGIN_RECEIPT_COMMITMENTS,
    "GE_SQLITE_TX_OWNER_BEGIN", "BEGIN receipt commitment/order drifted");
  if (!value.beginContract.provisionalGenerationMintedBeforeBeginIo
      || !value.beginContract.beginReceiptBeforePromotionForbidden) {
    fail("GE_SQLITE_TX_OWNER_BEGIN", "pre-I/O provisional generation discipline drifted");
  }
  exact(value.identityContract.commonExactObjects, COMMON_OBJECTS,
    "GE_SQLITE_TX_OWNER_IDENTITY", "common exact identity graph drifted");
  exact(value.identityContract.failurePresentationObjects, FAILURE_OBJECTS,
    "GE_SQLITE_TX_OWNER_IDENTITY", "failure presentation graph drifted");
  exact(value.identityContract.successCommitPresentationObjects, SUCCESS_OBJECTS,
    "GE_SQLITE_TX_OWNER_IDENTITY", "success must present only owner plus exact final fence");
  exact(value.identityContract.commitFailureCleanupPresentationObjects, COMMIT_FAILURE_OBJECTS,
    "GE_SQLITE_TX_OWNER_IDENTITY", "commit-primary internal cleanup graph drifted");
  exact(value.identityContract.finalFenceTransitivelyAuthenticates, TRANSITIVE_FENCE_OBJECTS,
    "GE_SQLITE_TX_OWNER_IDENTITY", "final-fence transitive graph drifted");
  exact(value.dependencyContract.atomicPublicationOrder, ATOMIC_PUBLICATION_ORDER,
    "GE_SQLITE_TX_OWNER_PREDECESSOR", "complete atomic publication order drifted");
  exact(value.dependencyContract.directCommitAuthoritiesRejected, REJECTED_DIRECT_AUTHORITIES,
    "GE_SQLITE_TX_OWNER_AUTHORITY", "non-final-fence object became direct commit authority");
  exact(value.arbiterContract.claimStateOrder,
    ["unclaimed", "failure-claimed-or-success-claimed"],
    "GE_SQLITE_TX_OWNER_ARBITER", "monotonic mutually exclusive claim state drifted");
  exact(value.lifecycleContract.states, STATES,
    "GE_SQLITE_TX_OWNER_LIFECYCLE", "lifecycle state order drifted");
  exact(value.lifecycleContract.allowedTransitions, TRANSITIONS,
    "GE_SQLITE_TX_OWNER_LIFECYCLE", "lifecycle transition order drifted");
  exact(value.commitAmbiguityContract.trustedIntrinsicObservations, TRUSTED_OBSERVATIONS,
    "GE_SQLITE_TX_OWNER_AMBIGUITY", "native outcome observation partition drifted");
  exact(value.commitAmbiguityContract.sameExactGenerationProof, SAME_GENERATION_PROOF,
    "GE_SQLITE_TX_OWNER_AMBIGUITY", "same-generation rollback proof drifted");
  exact(value.reopenClassificationContract.classifications, REOPEN_CLASSIFICATIONS,
    "GE_SQLITE_TX_OWNER_REOPEN", "single-valued reopen classifications drifted");
  exact(value.reopenClassificationContract.requiredEvidence, REOPEN_EVIDENCE,
    "GE_SQLITE_TX_OWNER_REOPEN", "reopen physical/semantic evidence drifted");
  exact(value.failurePrecedenceContract.diagnosticOrder, DIAGNOSTIC_ORDER,
    "GE_SQLITE_TX_OWNER_PRECEDENCE", "native primary and cleanup precedence drifted");
  exact(value.futureCaseCounterContract.ioCountOrder, IO_COUNT_ORDER,
    "GE_SQLITE_TX_OWNER_CASE_COUNTER", "future I/O counter order drifted");
  exact(value.futureCaseCounterContract.ownershipCountOrder, OWNERSHIP_COUNT_ORDER,
    "GE_SQLITE_TX_OWNER_CASE_COUNTER", "future ownership counter order drifted");
  exact(value.futureTargetCases.map(projectCase), EXPECTED_CASE_PROJECTIONS,
    "GE_SQLITE_TX_OWNER_CASE_SEMANTICS", "future oracle, branch, count, or outcome drifted");
  exact(value.beginPostflightFutureTargets.map(projectBeginPostflight),
    EXPECTED_BEGIN_POSTFLIGHT, "GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT",
    "BEGIN-returned fail-closed postflight matrix drifted");
  exact(value.cleanupFaultFutureTargets.map(projectCleanupFault), EXPECTED_CLEANUP_FAULTS,
    "GE_SQLITE_TX_OWNER_CLEANUP_FAULT", "rollback/close fault lifecycle drifted");
  exact(value.reopenOutcomeFutureTargets.map(projectReopenOutcome), EXPECTED_REOPEN_OUTCOMES,
    "GE_SQLITE_TX_OWNER_REOPEN_MATRIX", "reopen outcome matrix drifted");
  exact(value.nonclaims, NONCLAIMS,
    "GE_SQLITE_TX_OWNER_NONCLAIM", "implementation/release nonclaims drifted");

  if (!value.arbiterContract.atMostOneLiveOutcomeClaim
      || !value.arbiterContract.commitFailureCleanupIsInternalToSuccessClaim
      || !value.arbiterContract.successAuthorityTombstoneBeforeCommitFailureCleanup) {
    fail("GE_SQLITE_TX_OWNER_ARBITER", "success and failure ownership can overlap");
  }
  if (!value.beginContract.callerOutcomeInputForbidden
      || value.boundary.callerSuppliedOutcome !== "forbidden"
      || value.registryContract.ambientOrCopiedContextAuthority !== "forbidden") {
    fail("GE_SQLITE_TX_OWNER_AMBIENT_AUTHORITY",
      "outcomes and success authority must come only from exact intrinsic/explicit objects");
  }
  if (verifyAnchors) validateAnchors(value);

  const digest = computeFixtureDigest(value);
  if (value.fixtureCanonicalSha256 !== TRUSTED_FIXTURE_SHA256
      || digest !== value.fixtureCanonicalSha256 || digest !== TRUSTED_FIXTURE_SHA256) {
    fail("GE_SQLITE_TX_OWNER_FIXTURE_HASH",
      "fixture field, domain-separated computed SHA-256 and trusted SHA-256 must match");
  }
  return Object.freeze({
    ok: true,
    status: value.status,
    describedFutureScenarioCount: value.futureTargetCases.length
      + value.beginPostflightFutureTargets.length
      + value.cleanupFaultFutureTargets.length
      + value.reopenOutcomeFutureTargets.length * 4,
    runtimeExecutedCaseCount: 0,
    runtimeTransactionControlCount: 0,
    atomicPublicationStageCount: value.dependencyContract.atomicPublicationOrder.length,
    implementationClaim: false,
    protocolClaim: false,
    releaseGate: false,
    fixtureCanonicalSha256: digest,
    anchorsVerified: verifyAnchors,
  });
}

export function validateCanonicalTransactionOwnerFixture() {
  return validateTransactionOwnerFixture(loadTransactionOwnerFixture(), { verifyAnchors: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(validateCanonicalTransactionOwnerFixture(), null, 2)}\n`);
}
