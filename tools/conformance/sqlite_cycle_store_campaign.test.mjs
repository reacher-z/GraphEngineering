import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import { canonicalSerialize } from "../../packages/core/dist/index.js";
import {
  CYCLE_STORE_PROVIDER_ERROR_CODES,
  CYCLE_STORE_PROVIDER_OPERATIONS,
} from "../../packages/runtime/dist/index.js";
import { exerciseSQLiteCycleStoreCampaign } from "./sqlite_cycle_store_campaign.mjs";

const fixture = JSON.parse(readFileSync(
  new URL("../../spec/conformance/sqlite-cycle-store.case.json", import.meta.url),
  "utf8",
));
const temporaryCampaignRoots = () => readdirSync(tmpdir())
  .filter((name) => name.startsWith("graph-engineering-sqlite-campaign-"))
  .sort();

test("SQLite master campaign executes all 36 scenarios with exact typed outcomes", {
  timeout: 60_000,
}, async () => {
  const temporaryBefore = temporaryCampaignRoots();
  const report = await exerciseSQLiteCycleStoreCampaign();
  assert.deepEqual(temporaryCampaignRoots(), temporaryBefore);

  assert.deepEqual(Object.keys(report).sort(), [
    "attackCaseCount",
    "behaviorCaseCount",
    "campaign",
    "caseCount",
    "caseResults",
    "casesCanonicalUtf8Bytes",
    "casesSha256",
    "categoryCounts",
    "childPidCleanup",
    "childProcessCount",
    "fixtureSha256",
    "fixtureUtf8Bytes",
    "jsonBarrierCount",
    "leakSentinelScan",
    "migrationManifest",
    "providerContractVersion",
    "schemaVersion",
    "typedRejectionCount",
    "zeroMutationAttackCount",
  ]);
  assert.equal(report.campaign, "sqlite-cycle-store-v1");
  assert.equal(report.providerContractVersion, "cycle-store-provider/v1alpha1");
  assert.equal(report.caseCount, 36);
  assert.equal(report.behaviorCaseCount, 18);
  assert.equal(report.attackCaseCount, 18);
  assert.equal(report.typedRejectionCount, 18);
  assert.equal(report.zeroMutationAttackCount, 18);
  assert.equal(report.fixtureUtf8Bytes, 13_316);
  assert.equal(
    report.fixtureSha256,
    "60164cab2843257186fc578bf16624e05aa12e50dd7d7c291c7daf756c9ef220",
  );
  assert.equal(report.casesCanonicalUtf8Bytes, 10_297);
  assert.equal(
    report.casesSha256,
    "b16e2b96a842e2596a10d6719df0958b9faf0297312b3b41311a1815c5185a45",
  );
  assert.deepEqual(report.categoryCounts, fixture.expect.categoryCounts);
  assert.equal(report.childProcessCount, 17);
  assert.equal(report.jsonBarrierCount, 27);
  assert.equal(report.childPidCleanup, "clean");
  assert.equal(report.leakSentinelScan, "clean");

  assert.deepEqual(
    report.caseResults.map(({ id }) => id),
    fixture.cases.map(({ id }) => id),
  );
  assert.equal(new Set(report.caseResults.map(({ id }) => id)).size, 36);
  for (const [index, result] of report.caseResults.entries()) {
    const expected = fixture.cases[index];
    assert.deepEqual(Object.keys(result).sort(), [
      "category",
      "code",
      "id",
      "observation",
      "operation",
      "outcome",
      "polarity",
      "retryable",
      "scenario",
      "zeroMutation",
    ]);
    assert.equal(result.id, expected.id);
    assert.equal(result.category, expected.category);
    assert.equal(result.scenario, expected.scenario);
    assert.equal(result.polarity, expected.polarity);
    assert.equal(result.outcome, expected.expectOutcome);
    assert.equal(result.code, expected.expectCode);
    assert.equal(Object.hasOwn(result, "observation"), true);
    assert.notEqual(result.observation, null);
    if (expected.polarity === "attack") {
      assert.ok(CYCLE_STORE_PROVIDER_ERROR_CODES.includes(result.code));
      assert.ok(CYCLE_STORE_PROVIDER_OPERATIONS.includes(result.operation));
      assert.equal(typeof result.retryable, "boolean");
      assert.equal(result.zeroMutation, true);
    } else {
      assert.equal(result.code, null);
      assert.equal(result.operation, null);
      assert.equal(result.retryable, null);
      assert.equal(result.zeroMutation, null);
    }
  }

  const canonical = canonicalSerialize(report);
  assert.deepEqual(JSON.parse(canonical), report);
  for (const forbidden of [
    "PAYLOAD_SENTINEL",
    "AUTHORIZATION_SENTINEL",
    "DATABASE_SENTINEL",
    '"pending"',
    '"skipped"',
  ]) {
    assert.equal(canonical.includes(forbidden), false);
  }
});
