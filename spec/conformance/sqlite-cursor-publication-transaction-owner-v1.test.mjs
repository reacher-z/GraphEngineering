import assert from "node:assert/strict";
import test from "node:test";

import {
  TRUSTED_FIXTURE_SHA256,
  TransactionOwnerContractError,
  canonicalJson,
  computeFixtureDigest,
  loadTransactionOwnerFixture,
  parseStrictJson,
  validateCanonicalTransactionOwnerFixture,
  validateTransactionOwnerFixture,
} from "./sqlite-cursor-publication-transaction-owner-v1.validate.mjs";

function cloneFixture() {
  return structuredClone(loadTransactionOwnerFixture());
}

function expectFailure(mutator, code) {
  const fixture = cloneFixture();
  mutator(fixture);
  assert.throws(
    () => validateTransactionOwnerFixture(fixture),
    (error) => error instanceof TransactionOwnerContractError && error.code === code,
  );
}

function mutateAndResign(mutator) {
  const fixture = cloneFixture();
  mutator(fixture);
  fixture.fixtureCanonicalSha256 = computeFixtureDigest(fixture);
  return fixture;
}

test("v1 is an executable contract redbar with both dependency roots verified", () => {
  assert.deepEqual(validateCanonicalTransactionOwnerFixture(), {
    ok: true,
    status: "contract-frozen-redbar",
    describedFutureScenarioCount: 32,
    runtimeExecutedCaseCount: 0,
    runtimeTransactionControlCount: 0,
    atomicPublicationStageCount: 30,
    implementationClaim: false,
    protocolClaim: false,
    releaseGate: false,
    fixtureCanonicalSha256: TRUSTED_FIXTURE_SHA256,
    anchorsVerified: true,
  });
});

test("v1 keeps every implementation, protocol, release and runtime claim false", () => {
  const claims = Object.keys(cloneFixture().claims);
  for (const claim of claims) {
    expectFailure((value) => { value.claims[claim] = true; }, "GE_SQLITE_TX_OWNER_SCHEMA");
  }
  expectFailure((value) => { value.boundary.runtimeExecutedCaseCount = 1; },
    "GE_SQLITE_TX_OWNER_SCHEMA");
  expectFailure((value) => { value.boundary.contractRuntimeTransactionControlCount = 1; },
    "GE_SQLITE_TX_OWNER_SCHEMA");
  expectFailure((value) => { value.futureTargetCases[0].runtimeExecuted = true; },
    "GE_SQLITE_TX_OWNER_SCHEMA");
});

test("v1 validates the rebind and post-consume failure-finalizer trusted anchors", () => {
  const fixture = cloneFixture();
  assert.equal(fixture.anchors.rebindFixtureCanonicalSha256,
    "d368cd53e819e06e950f2dabedcb5a5b2fca535536efe85abb2e4b488bae2e7d");
  assert.equal(fixture.anchors.failureFinalizerFixtureCanonicalSha256,
    "81c055216223c89dc68055bbf325a73c61bfb899977dfb6255059137783ae360");
  expectFailure((value) => { value.anchors.rebindContractId = "substitute"; },
    "GE_SQLITE_TX_OWNER_SCHEMA");
  expectFailure((value) => { value.anchors.failureFinalizerFixtureCanonicalSha256 = "f".repeat(64); },
    "GE_SQLITE_TX_OWNER_SCHEMA");
});

test("v1 freezes every raw transaction-control and post-retirement write bypass", () => {
  const fixture = cloneFixture();
  assert.equal(fixture.boundary.guardedTransactionControlPaths.length, 19);
  for (const required of [
    "connection-commit-method", "connection-rollback-method",
    "execute-SAVEPOINT-or-RELEASE-or-ROLLBACK-TO",
    "multi-statement-exec-containing-transaction-control",
    "already-prepared-permanent-DDL-after-pre-retirement",
    "persistent-PRAGMA-including-user-version-or-application-id",
    "VACUUM-ANALYZE-or-REINDEX",
    "ATTACH-DETACH-or-connection-topology-change",
  ]) assert.ok(fixture.boundary.guardedTransactionControlPaths.includes(required));
  expectFailure((value) => { value.boundary.guardedTransactionControlPaths.reverse(); },
    "GE_SQLITE_TX_OWNER_GUARD");
  expectFailure((value) => {
    value.boundary.guardedTransactionControlPaths[0] = "unguarded-commit";
  }, "GE_SQLITE_TX_OWNER_GUARD");
});

test("v1 freezes guarded BEGIN registration, intrinsic observation and receipt commitments", () => {
  const fixture = cloneFixture();
  assert.equal(fixture.beginContract.registrationBeforeBeginIo, true);
  assert.equal(fixture.beginContract.callerOutcomeInputForbidden, true);
  assert.equal(fixture.beginContract.attemptMaximum, 1);
  assert.equal(fixture.beginContract.retryForbidden, true);
  assert.equal(fixture.beginContract.provisionalGenerationMintedBeforeBeginIo, true);
  assert.equal(fixture.beginContract.beginReceiptBeforePromotionForbidden, true);
  assert.deepEqual(fixture.beginContract.receiptCommitments.slice(-4), [
    "transaction-epoch", "total-changes", "temp-mutation-epoch", "begin-attempt-one",
  ]);
  expectFailure((value) => { value.beginContract.receiptCommitments.reverse(); },
    "GE_SQLITE_TX_OWNER_BEGIN");
  expectFailure((value) => { value.beginContract.callerOutcomeInputForbidden = false; },
    "GE_SQLITE_TX_OWNER_SCHEMA");
});

test("v1 separates direct branch presentation from final-fence transitive authentication", () => {
  const fixture = cloneFixture();
  assert.deepEqual(fixture.identityContract.successCommitPresentationObjects, [
    "transaction-owner-object-identity", "final-commit-fence-receipt-object-identity",
  ]);
  assert.ok(fixture.identityContract.finalFenceTransitivelyAuthenticates.includes(
    "rule-12-success-receipt-object-identity"));
  assert.ok(!fixture.identityContract.successCommitPresentationObjects.includes(
    "rule-11-success-receipt-object-identity"));
  for (const field of [
    "commonExactObjects", "failurePresentationObjects", "successCommitPresentationObjects",
    "commitFailureCleanupPresentationObjects", "finalFenceTransitivelyAuthenticates",
  ]) {
    expectFailure((value) => { value.identityContract[field].reverse(); },
      "GE_SQLITE_TX_OWNER_IDENTITY");
  }
});

test("v1 freezes the complete 30-stage atomic publication order", () => {
  const fixture = cloneFixture();
  assert.equal(fixture.dependencyContract.atomicPublicationOrder[0],
    "source-v1-semantically-valid");
  assert.deepEqual(fixture.dependencyContract.atomicPublicationOrder.slice(-4), [
    "pre-commit-clock-evidence-consumed",
    "final-migration-lock-transaction-fence-accepted",
    "success-commit-authority-selected-internal-state-no-new-capability",
    "single-atomic-commit",
  ]);
  expectFailure((value) => {
    [value.dependencyContract.atomicPublicationOrder[16],
      value.dependencyContract.atomicPublicationOrder[17]] =
      [value.dependencyContract.atomicPublicationOrder[17],
        value.dependencyContract.atomicPublicationOrder[16]];
  }, "GE_SQLITE_TX_OWNER_PREDECESSOR");
  expectFailure((value) => {
    value.dependencyContract.atomicPublicationOrder[27] = "raw-commit";
  }, "GE_SQLITE_TX_OWNER_PREDECESSOR");
});

test("v1 rejects every authority below the exact final commit fence", () => {
  const fixture = cloneFixture();
  assert.ok(fixture.dependencyContract.directCommitAuthoritiesRejected.includes("boolean-success"));
  assert.ok(fixture.dependencyContract.directCommitAuthoritiesRejected.includes(
    "rule-12-success-receipt"));
  assert.ok(fixture.dependencyContract.directCommitAuthoritiesRejected.includes(
    "pre-commit-clock-evidence"));
  expectFailure((value) => {
    value.dependencyContract.directCommitAuthoritiesRejected[0] = "final-commit-fence";
  }, "GE_SQLITE_TX_OWNER_AUTHORITY");
  expectFailure((value) => { value.dependencyContract.directCommitAuthoritiesRejected.reverse(); },
    "GE_SQLITE_TX_OWNER_AUTHORITY");
});

test("v1 makes outcome claims monotonic and commit-primary cleanup internal to success", () => {
  const fixture = cloneFixture();
  assert.deepEqual(fixture.arbiterContract.claimStateOrder,
    ["unclaimed", "failure-claimed-or-success-claimed"]);
  assert.equal(fixture.arbiterContract.atMostOneLiveOutcomeClaim, true);
  assert.equal(fixture.arbiterContract.commitFailureCleanupIsInternalToSuccessClaim, true);
  assert.equal(fixture.arbiterContract.successAuthorityTombstoneBeforeCommitFailureCleanup, true);
  expectFailure((value) => {
    value.arbiterContract.claimStateOrder = ["unclaimed", "success-claimed", "failure-claimed"];
  }, "GE_SQLITE_TX_OWNER_SCHEMA");
  expectFailure((value) => {
    value.arbiterContract.commitFailureCleanupIsInternalToSuccessClaim = false;
  }, "GE_SQLITE_TX_OWNER_SCHEMA");
});

test("v1 rejects lifecycle shortcuts, branch crossover and retry", () => {
  expectFailure((value) => {
    value.lifecycleContract.allowedTransitions[8] = "active->committing";
  }, "GE_SQLITE_TX_OWNER_LIFECYCLE");
  expectFailure((value) => {
    value.lifecycleContract.allowedTransitions[15] = "success-claimed->failure-claimed";
  }, "GE_SQLITE_TX_OWNER_LIFECYCLE");
  expectFailure((value) => { value.lifecycleContract.states.reverse(); },
    "GE_SQLITE_TX_OWNER_LIFECYCLE");
  expectFailure((value) => { value.lifecycleContract.beginCommitRollbackCloseRetryForbidden = false; },
    "GE_SQLITE_TX_OWNER_SCHEMA");
  expectFailure((value) => {
    value.lifecycleContract.allowedTransitions[22] = "rolling-back->rolled-back-on-throw";
  }, "GE_SQLITE_TX_OWNER_LIFECYCLE");
});

test("v1 permits rollback after COMMIT throw only for the exact same generation proof", () => {
  const fixture = cloneFixture();
  assert.deepEqual(fixture.commitAmbiguityContract.trustedIntrinsicObservations, [
    "same-exact-exclusive-generation-active", "verified-autocommit",
    "different-generation-active", "observation-unavailable",
  ]);
  assert.equal(fixture.commitAmbiguityContract.sameExactGenerationProof.length, 6);
  assert.equal(fixture.commitAmbiguityContract.transactionEpochComparisonBaseline,
    "exact-pre-commit-attempt-snapshot-plus-only-the-owner-recorded-commit-attempt-accounting-transition");
  expectFailure((value) => {
    value.commitAmbiguityContract.trustedIntrinsicObservations = [
      "active", "autocommit", "true", "false",
    ];
  }, "GE_SQLITE_TX_OWNER_AMBIGUITY");
  expectFailure((value) => {
    value.commitAmbiguityContract.sameExactGenerationProof[3] = "caller-boolean";
  }, "GE_SQLITE_TX_OWNER_AMBIGUITY");
});

test("v1 classifies reopen with exact physical and semantic evidence", () => {
  const fixture = cloneFixture();
  assert.deepEqual(fixture.reopenClassificationContract.classifications, [
    "source-v1", "complete-v2", "intermediate-corrupt", "unavailable-unresolved",
  ]);
  assert.equal(fixture.reopenClassificationContract.requiredEvidence.length, 10);
  assert.ok(fixture.reopenClassificationContract.requiredEvidence.includes("integrity-check-ok"));
  assert.ok(fixture.reopenClassificationContract.requiredEvidence.includes("foreign-key-check-empty"));
  expectFailure((value) => {
    value.reopenClassificationContract.classifications[2] = "source-v1-or-complete-v2";
  }, "GE_SQLITE_TX_OWNER_REOPEN");
  expectFailure((value) => {
    value.reopenClassificationContract.requiredEvidence[2] = "user-version-only";
  }, "GE_SQLITE_TX_OWNER_REOPEN");
});

test("v1 preserves native primary diagnostics through rollback, close and reopen", () => {
  const fixture = cloneFixture();
  assert.deepEqual(fixture.failurePrecedenceContract.diagnosticOrder.slice(2), [
    "native-begin-or-commit-primary", "rollback-secondary-if-authorized",
    "close-tertiary", "reopen-audit-diagnostic",
  ]);
  expectFailure((value) => { value.failurePrecedenceContract.diagnosticOrder.reverse(); },
    "GE_SQLITE_TX_OWNER_PRECEDENCE");
  expectFailure((value) => {
    value.failurePrecedenceContract.rollbackOrCloseNeverOverwritesPrimaryDiagnostic = false;
  }, "GE_SQLITE_TX_OWNER_SCHEMA");
});

test("v1 future targets distinguish BEGIN and COMMIT ambiguity without caller booleans", () => {
  const fixture = cloneFixture();
  assert.equal(fixture.futureTargetCases.length, 13);
  assert.deepEqual(fixture.futureCaseCounterContract.ioCountOrder, [
    "begin-attempt", "commit-attempt", "rollback-attempt", "close-attempt", "reopen-attempt",
  ]);
  assert.deepEqual(fixture.futureCaseCounterContract.ownershipCountOrder, [
    "failure-claim", "success-claim", "success-authority-tombstone",
    "begin-failure-cleanup-claim", "commit-failure-cleanup-claim",
  ]);
  assert.ok(fixture.futureTargetCases.every((entry) => entry.runtimeExecuted === false));
  assert.ok(fixture.futureTargetCases.some((entry) =>
    entry.oracle.trustedIntrinsicObservation === "observation-unavailable"));
  assert.ok(fixture.futureTargetCases.some((entry) =>
    entry.expected.apiOutcome === "recovered-success"));
  assert.ok(fixture.futureTargetCases.some((entry) =>
    entry.expected.apiOutcome === "corruption"));
  expectFailure((value) => {
    value.futureTargetCases[7].expected.ioCounts = [1, 1, 0, 1, 1];
  }, "GE_SQLITE_TX_OWNER_CASE_SEMANTICS");
  expectFailure((value) => {
    value.futureTargetCases[9].expected.apiOutcome = "failure";
  }, "GE_SQLITE_TX_OWNER_CASE_SEMANTICS");
  expectFailure((value) => {
    [value.futureTargetCases[8], value.futureTargetCases[9]] =
      [value.futureTargetCases[9], value.futureTargetCases[8]];
  }, "GE_SQLITE_TX_OWNER_CASE_SEMANTICS");
  expectFailure((value) => { value.futureCaseCounterContract.ioCountOrder.reverse(); },
    "GE_SQLITE_TX_OWNER_CASE_COUNTER");
});

test("v1 fail-closes every BEGIN-returned postflight mismatch", () => {
  const fixture = cloneFixture();
  assert.deepEqual(fixture.beginPostflightFutureTargets.map((entry) => [
    entry.trustedIntrinsicObservation, entry.rollbackAttemptCount,
    entry.closeAttemptCount, entry.apiOutcome,
  ]), [
    ["verified-autocommit", 0, 1, "begin-postflight-failed"],
    ["different-generation-active", 0, 1, "corruption"],
    ["observation-unavailable", 0, 1, "unresolved"],
  ]);
  expectFailure((value) => {
    value.beginPostflightFutureTargets[1].rollbackAttemptCount = 1;
  }, "GE_SQLITE_TX_OWNER_SCHEMA");
  expectFailure((value) => {
    value.beginPostflightFutureTargets[2].apiOutcome = "begin-postflight-failed";
  }, "GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT");
});

test("v1 gives rollback throw an honest failed or in-doubt lifecycle before close", () => {
  const fixture = cloneFixture();
  assert.ok(fixture.lifecycleContract.states.includes("rollback-failed"));
  assert.ok(fixture.lifecycleContract.states.includes("rollback-in-doubt"));
  assert.ok(fixture.lifecycleContract.allowedTransitions.includes("rolling-back->rollback-failed"));
  assert.ok(!fixture.lifecycleContract.allowedTransitions.includes("rollback-failed->rolled-back"));
  assert.deepEqual(fixture.cleanupFaultFutureTargets.map((entry) => entry.stateAfterRollback), [
    "rolled-back", "rollback-failed", "rollback-in-doubt", "rollback-in-doubt",
  ]);
  assert.deepEqual(fixture.cleanupFaultFutureTargets.map((entry) => entry.rollbackThrowTiming), [
    "not-applicable", "after-native-return", "before-native-return", "outcome-unavailable",
  ]);
  expectFailure((value) => {
    value.cleanupFaultFutureTargets[1].stateAfterRollback = "rolled-back";
  }, "GE_SQLITE_TX_OWNER_CLEANUP_FAULT");
  expectFailure((value) => {
    value.cleanupFaultFutureTargets[3].closeResult = "returned";
  }, "GE_SQLITE_TX_OWNER_CLEANUP_FAULT");
});

test("v1 freezes all reopen outcomes for returned, rolled-back and in-doubt branches", () => {
  const fixture = cloneFixture();
  assert.deepEqual(fixture.reopenOutcomeFutureTargets[2], {
    preReopenOutcome: "commit-in-doubt",
    coveredCommitIntrinsicObservations: [
      "verified-autocommit", "different-generation-active", "observation-unavailable",
    ],
    sourceV1ApiOutcome: "commit-failed",
    completeV2ApiOutcome: "recovered-success",
    intermediateApiOutcome: "corruption",
    unavailableApiOutcome: "unresolved",
  });
  expectFailure((value) => {
    value.reopenOutcomeFutureTargets[0].unavailableApiOutcome = "success";
  }, "GE_SQLITE_TX_OWNER_SCHEMA");
  expectFailure((value) => {
    value.reopenOutcomeFutureTargets[2].coveredCommitIntrinsicObservations.pop();
  }, "GE_SQLITE_TX_OWNER_REOPEN_MATRIX");
});

test("v1 rejects synchronized malicious rewrites even when the attacker re-signs them", () => {
  for (const mutate of [
    (value) => { value.futureTargetCases[6].expected.ioCounts = [1, 1, 1, 1, 1]; },
    (value) => { value.futureTargetCases[8].expected.terminalClassification = "complete-v2"; },
    (value) => { value.dependencyContract.atomicPublicationOrder.reverse(); },
    (value) => { value.nonclaims.reverse(); },
  ]) {
    const fixture = mutateAndResign(mutate);
    assert.notEqual(fixture.fixtureCanonicalSha256, TRUSTED_FIXTURE_SHA256);
    assert.throws(() => validateTransactionOwnerFixture(fixture),
      (error) => error instanceof TransactionOwnerContractError);
  }
});

test("v1 independent trusted root rejects attacker-selected digest fields", () => {
  expectFailure((value) => { value.fixtureCanonicalSha256 = "f".repeat(64); },
    "GE_SQLITE_TX_OWNER_FIXTURE_HASH");
  const fixture = cloneFixture();
  assert.equal(computeFixtureDigest(fixture), TRUSTED_FIXTURE_SHA256);
  assert.equal(canonicalJson({ "\u{10000}": 1, "\ue000": 2 }),
    '{"":2,"𐀀":1}');
});

test("v1 rejects nonclaims, unknown properties and unsafe strict JSON", () => {
  expectFailure((value) => { value.nonclaims[2] = "runtime-commit-proven"; },
    "GE_SQLITE_TX_OWNER_NONCLAIM");
  expectFailure((value) => { value.unknown = true; }, "GE_SQLITE_TX_OWNER_SCHEMA");
  assert.throws(
    () => parseStrictJson('{"schemaVersion":1,"schemaVersion":1}'),
    (error) => error instanceof TransactionOwnerContractError
      && error.code === "GE_SQLITE_TX_OWNER_DUPLICATE_KEY",
  );
  assert.throws(
    () => parseStrictJson('{"__proto__":{}}'),
    (error) => error instanceof TransactionOwnerContractError
      && error.code === "GE_SQLITE_TX_OWNER_PROHIBITED_KEY",
  );
  assert.throws(
    () => parseStrictJson('{"constructor":{}}'),
    (error) => error instanceof TransactionOwnerContractError
      && error.code === "GE_SQLITE_TX_OWNER_PROHIBITED_KEY",
  );
  assert.throws(() => parseStrictJson('{"schemaVersion":1} trailing'), SyntaxError);
});
