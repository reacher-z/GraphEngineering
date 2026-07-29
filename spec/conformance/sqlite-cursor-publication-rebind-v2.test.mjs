import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CursorPublicationContractError,
  loadCursorPublicationFixture,
  parseStrictJson,
  validateCanonicalCursorPublicationFixture,
  validateCursorPublicationFixture,
} from "./sqlite-cursor-publication-rebind-v2.validate.mjs";

function cloneFixture() { return structuredClone(loadCursorPublicationFixture()); }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}
function resignFixture(fixture) {
  fixture.parityGates.fixtureCanonicalSha256 = "0".repeat(64);
  fixture.parityGates.fixtureCanonicalSha256 = createHash("sha256")
    .update(JSON.stringify(canonicalize(fixture))).digest("hex");
}
function expectFailure(mutator, code) {
  const fixture = cloneFixture();
  mutator(fixture);
  assert.throws(
    () => validateCursorPublicationFixture(fixture),
    (error) => error instanceof CursorPublicationContractError && error.code === code,
  );
}

test("B3 freezes an unimplemented cursor subprotocol inside one atomic v1-to-v2 migration", () => {
  assert.deepEqual(validateCanonicalCursorPublicationFixture(), {
    ok: true,
    id: "sqlite-cursor-publication-rebind-v2",
    status: "contract-frozen",
    taskId: "SQLITE-CURSOR-B3-PUBLICATION-REBIND",
    stageCount: 23,
    ruleCount: 2,
    hostileObligationCount: 80,
    faultBoundaryCount: 20,
    targetDescriptorHash: "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92",
    targetSchemaIdentitySha256: "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634",
    fixtureCanonicalSha256: "9ed27de3dadb8989b51da9864b2109f0b760043bea52b3c73234013150e74ef3",
    implementationClaim: false,
    activeManifestClaim: false,
  });
});

test("B3 rejects release, implementation and active-manifest claim inflation", () => {
  expectFailure((fixture) => { fixture.claims.implementationClaim = true; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.claims.releaseGate = true; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.claims.activeManifestClaim = true; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 forbids a standalone rebind commit or transaction ownership", () => {
  expectFailure((fixture) => { fixture.boundary.standaloneCommitAllowed = true; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.boundary.ownsTransactionCommands = true; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.boundary.acceptedPermanentIntermediateStates.push("rebound-v1"); }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 freezes source, target and migration identities", () => {
  expectFailure((fixture) => { fixture.identities.source.descriptorHash = "0".repeat(64); }, "GE_CURSOR_B3_SOURCE_IDENTITY");
  expectFailure((fixture) => { fixture.identities.target.descriptorHash = "0".repeat(64); }, "GE_CURSOR_B3_TARGET_IDENTITY");
  expectFailure((fixture) => { fixture.identities.migration.sqlSha256 = "0".repeat(64); }, "GE_CURSOR_B3_MIGRATION_IDENTITY");
});

test("B3 freezes the complete atomic migration order", () => {
  expectFailure((fixture) => {
    [fixture.sequence.orderedStages[3], fixture.sequence.orderedStages[8]] =
      [fixture.sequence.orderedStages[8], fixture.sequence.orderedStages[3]];
  }, "GE_CURSOR_B3_SEQUENCE");
});

test("B3 freezes rule 11 before rule 12", () => {
  expectFailure((fixture) => { fixture.rules.reverse(); }, "GE_CURSOR_B3_RULE_ORDER");
  expectFailure((fixture) => { fixture.rules[0].position = 12; }, "GE_CURSOR_B3_RULE_ORDER");
});

test("B3 freezes fixed module-owned rebind SQL and parameter order", () => {
  expectFailure((fixture) => { fixture.sqlContract.rebind.sql += " "; }, "GE_CURSOR_B3_FIXTURE_HASH");
  expectFailure((fixture) => { fixture.sqlContract.rebind.sql += " OR 1=1"; }, "GE_CURSOR_B3_SQL_LITERAL");
  expectFailure((fixture) => { fixture.sqlContract.rebind.parameterOrder.reverse(); }, "GE_CURSOR_B3_PARAMETER_ORDER");
});

test("B3 post-rebind proof drives fresh main point lookups without a sorter", () => {
  expectFailure((fixture) => {
    fixture.sqlContract.postRebindKeyDriver.sql = fixture.sqlContract.postRebindKeyDriver.sql
      .replace("token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
        "tenant_id COLLATE BINARY, token_hash COLLATE BINARY");
  }, "GE_CURSOR_B3_SQL_LITERAL");
  expectFailure((fixture) => { fixture.sealContract.source = "b2-temp-carrier"; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 permits only the two manifest-bound mutable identities", () => {
  expectFailure((fixture) => { fixture.sealContract.mutableFields.push("expires_at_ms"); }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    [fixture.sealContract.immutablePhysicalFields[0], fixture.sealContract.immutablePhysicalFields[1]] =
      [fixture.sealContract.immutablePhysicalFields[1], fixture.sealContract.immutablePhysicalFields[0]];
  }, "GE_CURSOR_B3_IMMUTABLE_FIELDS");
});

test("B3 freezes exact-object authority and opaque single-use publication session", () => {
  expectFailure((fixture) => { fixture.authority.requiredExactObjects.reverse(); }, "GE_CURSOR_B3_AUTHORITY_GRAPH");
  expectFailure((fixture) => { fixture.authority.publicationSession.cloneRejected = false; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.authority.migrationLock.mustBeUnexpiredAtProviderClock = false; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.authority.migrationLock.mustBeReprovedBeforeCommit = false; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 requires fresh clock receipts and an exact retirement-to-commit authority chain", () => {
  expectFailure((fixture) => {
    fixture.authority.providerClock.receiptObjectIdentitiesMustBeDistinct = false;
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.authority.providerClock.providerClockReadAtEveryBoundary = false;
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.authority.stageAdoptionBridge.postCursorAdoption.requiredAuditReceipts.pop();
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.authority.stageAdoptionBridge.stageRetirementBridge.preservesUnrelatedTempObjects = false;
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.authority.finalFence.commitConsumesFinalFenceReceiptExactlyOnce = false;
  }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 separates count-scan cleanup from seal-stream cleanup", () => {
  expectFailure((fixture) => {
    fixture.sealContract.phaseCleanupOrder.mainKeyCountFailureOrCancellation.unshift("driver-cursor");
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.sealContract.mainKeyCountCursorClosedBeforeDriverPrepare = false;
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.lifecycleContract.cancellationSemantics.mainKeyCountCloseFailurePrecedence.reverse();
  }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 rejects re-signed weakening of the transitive authority chain", () => {
  const mutations = [
    (fixture) => { fixture.authority.outerPublicationAuthority.consumesOuterClockEvidenceReceiptExactlyOnce = false; },
    (fixture) => { fixture.authority.publicationSession.consumesPreRebindClockEvidenceReceiptExactlyOnce = false; },
    (fixture) => { fixture.authority.cursorClock.requiredCommitments[0] = "attacker-clock-receipt"; },
    (fixture) => { fixture.authority.receiptChain.preRetirementStageFenceReceipt.requiredCommitments.pop(); },
    (fixture) => { fixture.authority.receiptChain.stageRetirementReceipt.cloneRejected = false; },
    (fixture) => { fixture.authority.receiptChain.finalCommitFenceReceipt.requiredCommitments.reverse(); },
    (fixture) => {
      fixture.authority.stageAdoptionBridge.stageRetirementBridge
        .eachAuthorizedDropConsumesPriorAndMintsNextMutationEpochReceipt = false;
    },
  ];
  for (const mutate of mutations) {
    const fixture = cloneFixture();
    mutate(fixture);
    resignFixture(fixture);
    assert.throws(
      () => validateCursorPublicationFixture(fixture),
      (error) => error instanceof CursorPublicationContractError
        && error.code === "GE_CURSOR_B3_SCHEMA",
    );
  }
});

test("B3 freezes one-way state transitions and failure precedence", () => {
  expectFailure((fixture) => { fixture.stateMachine.successTransitions.reverse(); }, "GE_CURSOR_B3_TRANSITIONS");
  expectFailure((fixture) => {
    const precedence = fixture.failureContract.boundaryPrecedence.beforeCursorRebind;
    [precedence[0], precedence[4]] = [precedence[4], precedence[0]];
  }, "GE_CURSOR_B3_FAILURE_PRECEDENCE");
});

test("B3 freezes exact affected-count and permanent-write ledger requirements", () => {
  expectFailure((fixture) => { fixture.writeLedger.expectedStatementCount = 2; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.writeLedger.requiresTotalChangesDeltaEquality = false; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.writeLedger.sameValueReplayAllowed = true; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 freezes crash/reopen split at commit-returned", () => {
  expectFailure((fixture) => { fixture.faultMatrix.boundaries.pop(); }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.faultMatrix.preCommitReopenState = "partial-v2"; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.faultMatrix.subprocessKillRequired = false; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 fixture digest rejects any otherwise-shaped semantic drift", () => {
  expectFailure((fixture) => {
    [fixture.hostileObligations[0], fixture.hostileObligations[1]] =
      [fixture.hostileObligations[1], fixture.hostileObligations[0]];
  }, "GE_CURSOR_B3_HOSTILE_MATRIX");
  expectFailure((fixture) => { fixture.parityGates.fixtureCanonicalSha256 = "0".repeat(64); }, "GE_CURSOR_B3_FIXTURE_HASH");
});

test("B3 rejects maliciously re-signed semantic drift against trusted anchors", () => {
  const commitment = cloneFixture();
  commitment.authority.publicationSession.requiredCommitments[0] = "attacker-controlled";
  resignFixture(commitment);
  assert.throws(() => validateCursorPublicationFixture(commitment),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_COMMITMENTS");

  const affected = cloneFixture();
  affected.sqlContract.affectedCount.sql = "SELECT 0 AS affected_rows";
  affected.sqlContract.affectedCount.sha256 = createHash("sha256")
    .update(affected.sqlContract.affectedCount.sql).digest("hex");
  resignFixture(affected);
  assert.throws(() => validateCursorPublicationFixture(affected),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SQL_LITERAL");

  const obligations = cloneFixture();
  obligations.hostileObligations = obligations.hostileObligations.map((_, index) =>
    `fake-obligation-${index}`);
  resignFixture(obligations);
  assert.throws(() => validateCursorPublicationFixture(obligations),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_HOSTILE_MATRIX");

  const rule = cloneFixture();
  rule.rules[1].diagnosticUnit = "cursor-row";
  resignFixture(rule);
  assert.throws(() => validateCursorPublicationFixture(rule),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_RULE_ORDER");

  const parity = cloneFixture();
  parity.parityGates.required = parity.parityGates.required.map((_, index) =>
    `fake-parity-${index}`);
  resignFixture(parity);
  assert.throws(() => validateCursorPublicationFixture(parity),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_PARITY_GATES");
});

test("B3 strict JSON parser rejects duplicate keys and trailing content", () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /duplicate key/u);
  assert.throws(() => parseStrictJson('{"a":1} false'), /trailing JSON content/u);
  const prototypeKey = parseStrictJson('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(prototypeKey), null);
  assert.equal(Object.hasOwn(prototypeKey, "__proto__"), true);
  assert.deepEqual(Object.keys(prototypeKey), ["__proto__"]);
  expectFailure((fixture) => {
    Object.defineProperty(fixture, "__proto__", { enumerable: true, value: {} });
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    Object.defineProperty(fixture, "constructor", { enumerable: true, value: {} });
  }, "GE_CURSOR_B3_SCHEMA");
});
