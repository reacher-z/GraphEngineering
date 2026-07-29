import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CursorPreRebindContractError,
  loadCursorPreRebindFixture,
  normalizeSql,
  parseStrictJson,
  validateCanonicalCursorPreRebindFixture,
  validateCursorPreRebindFixture,
} from "./sqlite-cursor-pre-rebind-v1.validate.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
function cloneFixture() { return structuredClone(loadCursorPreRebindFixture()); }
function expectFailure(mutator, code) {
  const fixture = cloneFixture();
  mutator(fixture);
  assert.throws(
    () => validateCursorPreRebindFixture(fixture),
    (error) => error instanceof CursorPreRebindContractError && error.code === code,
  );
}

test("B2 freezes the closed rules, SQL, roots, matrices and nonclaims", () => {
  assert.deepEqual(validateCanonicalCursorPreRebindFixture(), {
    ok: true,
    status: "contract-frozen",
    ruleCount: 10,
    semanticVectorCount: 5,
    pristineObligationCount: 12,
    hostileObligationCount: 27,
    lifecycleObligationCount: 31,
    sqlContractCount: 15,
    fixtureCanonicalSha256: "6acb99d9593b37d6e29b6862531e3ade2dae051b21a628a26cc4e1d7e2fdb8bc",
    implementationClaim: false,
    protocolClaim: false,
  });
});

test("B2 exact SQL retains source/stage order, thirty insert binds and marker bounds", () => {
  const fixture = loadCursorPreRebindFixture();
  assert.match(fixture.sqlContract.source.sql,
    /ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY$/u);
  assert.match(fixture.sqlContract.seal.sql,
    /ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY$/u);
  assert.equal((fixture.sqlContract.insert.sql.match(/\?/gu) ?? []).length, 30);
  assert.equal(fixture.sqlContract.rowMarkers.length, 9);
  assert.ok(fixture.sqlContract.rowMarkers.every((entry) =>
    normalizeSql(`SELECT 1 AS violation_marker FROM temp.ge_blr_cursor_seal WHERE ${entry.flag} = 0 ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY LIMIT ?`)
      .endsWith("LIMIT ?")));
  assert.deepEqual(fixture.parityGates.literalDiagnosticPopulations, [1, 2, 16, 17, 64, 65]);
});

test("B2 rejects schema, rule, SQL, marker and fixture digest drift", () => {
  expectFailure((fixture) => { fixture.claims.protocolClaim = true; }, "GE_CURSOR_B2_SCHEMA");
  expectFailure((fixture) => {
    [fixture.ruleOrder[0], fixture.ruleOrder[1]] = [fixture.ruleOrder[1], fixture.ruleOrder[0]];
  }, "GE_CURSOR_B2_SCHEMA");
  expectFailure((fixture) => { fixture.sqlContract.source.sql += " "; }, "GE_CURSOR_B2_FIXTURE_HASH");
  expectFailure((fixture) => { fixture.sqlContract.source.sql += " LIMIT 1"; }, "GE_CURSOR_B2_SQL_HASH");
  expectFailure((fixture) => {
    [fixture.sqlContract.rowMarkers[0], fixture.sqlContract.rowMarkers[1]] =
      [fixture.sqlContract.rowMarkers[1], fixture.sqlContract.rowMarkers[0]];
  }, "GE_CURSOR_B2_MARKER_ORDER");
  expectFailure((fixture) => { fixture.unknown = true; }, "GE_CURSOR_B2_SCHEMA");
});

test("B2 freezes isolated rules, aggregate order and stale equal-count semantics", () => {
  expectFailure((fixture) => { fixture.pristineObligations.scenarios[0].vector[0] = 1; }, "GE_CURSOR_B2_PRISTINE_VECTOR");
  expectFailure((fixture) => { fixture.hostileObligations.scenarios[3].vector = [1,0,0,0,0,0,0,0,0,0]; }, "GE_CURSOR_B2_RULE_MATRIX");
  expectFailure((fixture) => {
    fixture.hostileObligations.scenarios.find((entry) => entry.name === "all-rules-nonlexical-input").vector[9] = 0;
  }, "GE_CURSOR_B2_RULE_MATRIX");
  expectFailure((fixture) => {
    fixture.hostileObligations.scenarios.find((entry) => entry.name === "equal-count-insert-delete").outcome = "diagnosed";
  }, "GE_CURSOR_B2_EQUAL_COUNT");
});

test("B2 semantic roots are independently derived and old A1-only roots cannot pass clean", () => {
  const fixture = loadCursorPreRebindFixture();
  const semanticRoots = new Set(fixture.semanticVectors.map((entry) => entry.expected.immutableRootSha256));
  const oldRoots = Object.values(fixture.carrierContract.a1AlgorithmVectors);
  assert.equal(fixture.carrierContract.a1VectorsAreB2SemanticClaims, false);
  assert.ok(oldRoots.slice(1).every((root) => !semanticRoots.has(root)));
  expectFailure((candidate) => {
    candidate.semanticVectors[2].expected.immutableRootSha256 = candidate.carrierContract.a1AlgorithmVectors.event;
  }, "GE_CURSOR_B2_SEMANTIC_ROOT");
  expectFailure((candidate) => {
    candidate.literalRows.eventNonempty.next_position = 7;
  }, "GE_CURSOR_B2_SEMANTIC_ROOT");
});

test("B2 strict JSON rejects real duplicate keys and SQL normalization is ASCII-only", () => {
  assert.throws(
    () => parseStrictJson('{"schemaVersion":1,"schemaVersion":1}'),
    (error) => error instanceof CursorPreRebindContractError && error.code === "GE_CURSOR_B2_DUPLICATE_KEY",
  );
  assert.equal(normalizeSql("SELECT\t1\nFROM x"), "SELECT 1 FROM x");
  assert.equal(normalizeSql("SELECT\u00a01"), "SELECT\u00a01");
});

test("B2 freezes EQP denial, bounded resources and checkpoint historical order", () => {
  const fixture = loadCursorPreRebindFixture();
  assert.deepEqual(fixture.eqpContract.forbiddenDetailFragments,
    ["AUTOMATIC", "MATERIALIZE", "USE TEMP B-TREE", "CO-ROUTINE"]);
  assert.equal(fixture.eqpContract.eventIndex, "ge_cycle_records_stream_sequence_hash_uq");
  assert.equal(fixture.eqpContract.checkpointIndex, "ge_cycle_checkpoint_revisions_lookup_idx");
  assert.deepEqual(fixture.outcomeContract.checkpointOrder,
    ["boundSequence-desc", "createdAt-desc", "checkpointId-asc"]);
  assert.equal(fixture.resourceLimits.maximumLiveDecodedSnapshots, 1);
  assert.equal(fixture.resourceLimits.diagnosticMaximum, 64);
  assert.deepEqual(fixture.parityGates.fastCharacterizationCounts, [128, 1024]);
});

test("B2 does not flip the conservative whole-protocol registry gate", () => {
  const registry = JSON.parse(readFileSync(
    join(ROOT, "sqlite-baseline-reconciliation.case.json"), "utf8"));
  assert.equal(registry.implementationClaim, false);
  assert.equal(registry.releaseGate, false);
  assert.equal(registry.productionThroughputClaim, false);
  assert.equal(registry.cursorSeal.protocolClaim, false);
  assert.equal(registry.cursorSeal.emptyRootStatus, "deferred-cross-language-derivation");
});
