import assert from "node:assert/strict";
import test from "node:test";

import {
  LedgerCampaignContractError,
  loadOperationLedgerReplayFixture,
  validateCanonicalOperationLedgerReplayFixture,
  validateOperationLedgerReplayFixture,
} from "./sqlite-operation-ledger-replay.validate.mjs";

function cloneFixture() {
  return structuredClone(loadOperationLedgerReplayFixture());
}

function expectContractFailure(mutator, code) {
  const fixture = cloneFixture();
  mutator(fixture);
  assert.throws(
    () => validateOperationLedgerReplayFixture(fixture),
    (error) => error instanceof LedgerCampaignContractError && error.code === code,
  );
}

test("the frozen SQLite operation-ledger campaign retains exactly 96 ordered cases", () => {
  assert.deepEqual(validateCanonicalOperationLedgerReplayFixture(), {
    ok: true,
    status: "contract-frozen",
    caseCount: 96,
    behaviorCaseCount: 48,
    attackCaseCount: 48,
    casesCanonicalUtf8Bytes: 81_996,
    casesSha256: "0e6b481368c774ac870b593bd8f86af1b97d0bdc6ab0df23c82f1d88d4a30f38",
    implementationClaim: false,
  });
});

test("the validator rejects ordering, identity, category, outcome, and digest drift", () => {
  expectContractFailure((fixture) => {
    [fixture.cases[0], fixture.cases[1]] = [fixture.cases[1], fixture.cases[0]];
  }, "GE_LEDGER_CAMPAIGN_ORDER");
  expectContractFailure((fixture) => { fixture.cases[0].slug = "renamed-case"; }, "GE_LEDGER_CAMPAIGN_NAME");
  expectContractFailure((fixture) => { fixture.cases[6].category = "behavior"; }, "GE_LEDGER_CAMPAIGN_CATEGORY");
  expectContractFailure((fixture) => { fixture.cases[6].expected.outcome = "accepted"; }, "GE_LEDGER_CAMPAIGN_OUTCOME");
  expectContractFailure((fixture) => { fixture.expect.casesSha256 = "f".repeat(64); }, "GE_LEDGER_CAMPAIGN_HASH");
});

test("the closed schema rejects pending, skipped, unknown, incomplete, and malformed cases", () => {
  expectContractFailure((fixture) => { fixture.status = "pending"; }, "GE_LEDGER_CAMPAIGN_SCHEMA");
  expectContractFailure((fixture) => { fixture.cases[0].expected.skipped = true; }, "GE_LEDGER_CAMPAIGN_SCHEMA");
  expectContractFailure((fixture) => { fixture.cases[0].unknown = true; }, "GE_LEDGER_CAMPAIGN_SCHEMA");
  expectContractFailure((fixture) => { fixture.cases[0].minimumAssertions = []; }, "GE_LEDGER_CAMPAIGN_SCHEMA");
  expectContractFailure((fixture) => {
    fixture.cases[6].expected.typedFailures[0].retryable = "sometimes";
  }, "GE_LEDGER_CAMPAIGN_SCHEMA");
});

test("destructive cases cannot omit their explicit temp-root and database-path boundary", () => {
  expectContractFailure((fixture) => {
    fixture.cases[4].runtimeRequirements = fixture.cases[4].runtimeRequirements
      .filter((value) => value !== "fresh-temporary-root");
  }, "GE_LEDGER_CAMPAIGN_ISOLATION");
  expectContractFailure((fixture) => {
    fixture.cases[6].expected.typedFailures = [];
  }, "GE_LEDGER_CAMPAIGN_FAILURE");
  expectContractFailure((fixture) => {
    fixture.cases[62].expected.requiresZeroUnintendedMutation = false;
  }, "GE_LEDGER_CAMPAIGN_MUTATION");
});
