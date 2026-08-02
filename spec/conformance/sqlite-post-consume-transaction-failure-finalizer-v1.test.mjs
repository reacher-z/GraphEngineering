import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  PostConsumeFinalizerContractError,
  TRUSTED_FIXTURE_SHA256,
  canonicalJson,
  loadPostConsumeFinalizerFixture,
  parseStrictJson,
  validateCanonicalPostConsumeFinalizerFixture,
  validatePostConsumeFinalizerFixture,
} from "./sqlite-post-consume-transaction-failure-finalizer-v1.validate.mjs";

function cloneFixture() {
  return structuredClone(loadPostConsumeFinalizerFixture());
}

function expectFailure(mutator, code) {
  const fixture = cloneFixture();
  mutator(fixture);
  assert.throws(
    () => validatePostConsumeFinalizerFixture(fixture),
    (error) => error instanceof PostConsumeFinalizerContractError && error.code === code,
  );
}

function resignFixture(fixture) {
  fixture.fixtureCanonicalSha256 = "0".repeat(64);
  fixture.fixtureCanonicalSha256 = createHash("sha256")
    .update(canonicalJson(fixture), "utf8").digest("hex");
}

test("v1 freezes an authenticated post-T primary-only transaction failure finalizer", () => {
  assert.deepEqual(validateCanonicalPostConsumeFinalizerFixture(), {
    ok: true,
    status: "contract-frozen",
    caseCount: 3,
    lifecycle: "prepared->finalizing->finalized",
    rollbackAttemptCountPerCase: 1,
    closeAttemptCountPerCase: 1,
    fixtureCanonicalSha256: "81c055216223c89dc68055bbf325a73c61bfb899977dfb6255059137783ae360",
    implementationClaim: false,
    driverNativeCleanupThrowClaim: false,
  });
});

test("v1 freezes exact lineage, authority, consumed T and one-shot owner identity", () => {
  const fixture = loadPostConsumeFinalizerFixture();
  assert.deepEqual(fixture.identityContract.exactRequiredObjects, [
    "sqlite-connection-object-identity",
    "unchanged-transaction-lineage-object-identity",
    "exact-transaction-generation",
    "outer-publication-authority-object-identity",
    "consumed-publication-session-tombstone-t-object-identity",
    "one-shot-finalizer-owner-object-identity",
  ]);
  expectFailure((value) => { value.identityContract.exactRequiredObjects.reverse(); },
    "GE_SQLITE_FINALIZER_IDENTITY");
  expectFailure((value) => { value.cases[1].identityProjection.authority = "authority-A"; },
    "GE_SQLITE_FINALIZER_IDENTITY");
  expectFailure((value) => { value.identityContract.ownerReplayRejected = false; },
    "GE_SQLITE_FINALIZER_SCHEMA");
});

test("v1 terminalizes then attempts rollback and close exactly once in every case", () => {
  const fixture = loadPostConsumeFinalizerFixture();
  assert.deepEqual(fixture.lifecycleContract.operationOrder, [
    "consume-one-shot-owner",
    "terminalize-selected-graph",
    "attempt-native-rollback-once",
    "record-rollback-after-return-secondary-if-present",
    "attempt-native-close-once",
    "record-close-after-return-tertiary-if-present",
    "enter-finalized",
    "rethrow-original-primary",
  ]);
  for (const entry of fixture.cases) {
    assert.deepEqual(entry.expected.stateTrace, ["prepared", "finalizing", "finalized"]);
    assert.equal(entry.expected.ownerConsumeCount, 1);
    assert.equal(entry.expected.terminalizeCount, 1);
    assert.equal(entry.expected.rollbackAttemptCount, 1);
    assert.equal(entry.expected.rollbackNativeReturnCount, 1);
    assert.equal(entry.expected.closeAttemptCount, 1);
    assert.equal(entry.expected.closeNativeReturnCount, 1);
  }
  expectFailure((value) => { value.cases[0].expected.closeAttemptCount = 0; },
    "GE_SQLITE_FINALIZER_SCHEMA");
  expectFailure((value) => { value.cases[0].expected.stateTrace = ["prepared", "finalized", "finalizing"]; },
    "GE_SQLITE_FINALIZER_SCHEMA");
  expectFailure((value) => {
    [value.lifecycleContract.operationOrder[2], value.lifecycleContract.operationOrder[4]] =
      [value.lifecycleContract.operationOrder[4], value.lifecycleContract.operationOrder[2]];
  }, "GE_SQLITE_FINALIZER_SCHEMA");
});

test("v1 preserves leaf primary over rollback secondary and close tertiary", () => {
  const fixture = loadPostConsumeFinalizerFixture();
  assert.deepEqual(fixture.cases.map((entry) => entry.expected.diagnosticCodes), [
    ["GE_SQLITE_POST_T_TERMINAL_PRIMARY", "GE_SQLITE_ROLLBACK_AFTER_NATIVE_RETURN", "GE_SQLITE_CLOSE_AFTER_NATIVE_RETURN"],
    ["GE_SQLITE_POST_T_TERMINAL_PRIMARY", "GE_SQLITE_ROLLBACK_AFTER_NATIVE_RETURN"],
    ["GE_SQLITE_POST_T_TERMINAL_PRIMARY", "GE_SQLITE_CLOSE_AFTER_NATIVE_RETURN"],
  ]);
  assert.ok(fixture.cases.every((entry) =>
    entry.expected.selectedThrow === "GE_SQLITE_POST_T_TERMINAL_PRIMARY"));
  expectFailure((value) => {
    value.cases[0].expected.diagnosticCodes = [
      "GE_SQLITE_POST_T_TERMINAL_PRIMARY",
      "GE_SQLITE_CLOSE_AFTER_NATIVE_RETURN",
      "GE_SQLITE_ROLLBACK_AFTER_NATIVE_RETURN",
    ];
  }, "GE_SQLITE_FINALIZER_PRECEDENCE");
});

test("v1 forbids no-primary cleanup and excludes unrelated ownership", () => {
  const fixture = loadPostConsumeFinalizerFixture();
  assert.equal(fixture.boundary.noPrimaryBranch, "forbidden");
  assert.equal(fixture.boundary.ownsBegin, false);
  assert.equal(fixture.boundary.ownsCommit, false);
  assert.equal(fixture.boundary.ownsRule12, false);
  assert.equal(fixture.boundary.ownsTempRetirement, false);
  assert.equal(fixture.boundary.ownsSuccessPath, false);
  expectFailure((value) => { value.cases[0].input.primary = null; },
    "GE_SQLITE_FINALIZER_SCHEMA");
  expectFailure((value) => { value.boundary.ownsRule12 = true; },
    "GE_SQLITE_FINALIZER_SCHEMA");
  expectFailure((value) => { value.boundary.noPrimaryBranch = "allowed"; },
    "GE_SQLITE_FINALIZER_SCHEMA");
});

test("v1 honestly names after-native-return cleanup injection and preserves nonclaims", () => {
  const fixture = loadPostConsumeFinalizerFixture();
  assert.equal(fixture.diagnosticContract.rollback.origin,
    "after-native-return-ambiguous-cleanup-fault");
  assert.equal(fixture.diagnosticContract.close.origin,
    "after-native-return-ambiguous-cleanup-fault");
  assert.equal(fixture.claims.driverNativeCleanupThrowClaim, false);
  assert.ok(fixture.nonclaims.includes("driver-native-rollback-throw"));
  assert.ok(fixture.nonclaims.includes("driver-native-close-throw"));
  expectFailure((value) => {
    value.diagnosticContract.rollback.origin = "driver-native-throw";
  }, "GE_SQLITE_FINALIZER_SCHEMA");
  expectFailure((value) => { value.nonclaims.splice(1, 1); },
    "GE_SQLITE_FINALIZER_SCHEMA");
});

test("v1 rejects case order, matrix, diagnostic and fixture-byte drift", () => {
  expectFailure((value) => { [value.cases[0], value.cases[1]] = [value.cases[1], value.cases[0]]; },
    "GE_SQLITE_FINALIZER_CASE_ORDER");
  expectFailure((value) => { value.cases[1].input.closeAfterNativeReturnFault = true; },
    "GE_SQLITE_FINALIZER_PRECEDENCE");
  expectFailure((value) => { value.diagnosticContract.rollback.code = "GE_SQLITE_OTHER"; },
    "GE_SQLITE_FINALIZER_DIAGNOSTIC");
  expectFailure((value) => { value.diagnosticContract.primary.operation = "success-cleanup"; },
    "GE_SQLITE_FINALIZER_DIAGNOSTIC");
  expectFailure((value) => { value.cases[0].identityProjection.transactionGeneration = 8; },
    "GE_SQLITE_FINALIZER_FIXTURE_HASH");
  expectFailure((value) => { value.unknown = true; }, "GE_SQLITE_FINALIZER_SCHEMA");
});

test("v1 independent trusted root rejects a synchronously re-signed identity mutation", () => {
  const fixture = cloneFixture();
  fixture.cases[0].identityProjection.transactionGeneration = 8;
  resignFixture(fixture);
  assert.notEqual(fixture.fixtureCanonicalSha256, TRUSTED_FIXTURE_SHA256);
  assert.throws(
    () => validatePostConsumeFinalizerFixture(fixture),
    (error) => error instanceof PostConsumeFinalizerContractError
      && error.code === "GE_SQLITE_FINALIZER_FIXTURE_HASH",
  );
});

test("v1 rejects unsafe transaction generations and claim inflation", () => {
  expectFailure((value) => {
    value.cases[0].identityProjection.transactionGeneration = 9_007_199_254_740_992;
  }, "GE_SQLITE_FINALIZER_SCHEMA");
  expectFailure((value) => { value.cases[0].identityProjection.transactionGeneration = -1; },
    "GE_SQLITE_FINALIZER_SCHEMA");
  for (const claim of [
    "implementationClaim", "protocolClaim", "releaseGate", "driverNativeCleanupThrowClaim",
  ]) {
    expectFailure((value) => { value.claims[claim] = true; }, "GE_SQLITE_FINALIZER_SCHEMA");
  }
});

test("v1 fixture loading rejects duplicate keys and trailing JSON", () => {
  assert.throws(
    () => parseStrictJson('{"schemaVersion":1,"schemaVersion":1}'),
    (error) => error instanceof PostConsumeFinalizerContractError
      && error.code === "GE_SQLITE_FINALIZER_DUPLICATE_KEY",
  );
  assert.throws(() => parseStrictJson('{"schemaVersion":1} trailing'), SyntaxError);
});
