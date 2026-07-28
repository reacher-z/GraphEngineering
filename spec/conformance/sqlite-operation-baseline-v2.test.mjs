#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  BaselineVectorError,
  ENTRY_KINDS,
  applyAttackVector,
  buildCanonicalBaselineFixture,
  canonicalJson,
  loadCanonicalBaselineFixture,
  validateBaselineModel,
  validateCanonicalBaselineFixture,
} from "./sqlite-operation-baseline-v2.validate.mjs";

const fixture = loadCanonicalBaselineFixture();

test("the frozen baseline fixture validates all twelve kinds", () => {
  assert.equal(validateCanonicalBaselineFixture(fixture), fixture);
  assert.deepEqual(fixture.entryVectors.map((entry) => entry.entryKind), ENTRY_KINDS);
  assert.deepEqual(fixture.entryVectors.map((entry) => entry.ordinal), [...Array(12).keys()]);
});

test("source, policy, chain, and projection identities are literal golden values", () => {
  assert.equal(fixture.baselineId, "v2-e43886d3883954231f8101d31b7d43cb4f70e0bca9c7cb25b2f34ce51256609d");
  assert.equal(fixture.policyVector.byteLength, 946);
  assert.equal(fixture.policyVector.sha256, "67cbe0ac8bf04f28061d50f8b7089312cc1e1f9a9520ede95deec0d1f4ec5eb0");
  assert.equal(fixture.entryVectors[0].entryHash, "87d4a5e99f9ef10f87314c0d1b38d76dac592b3934b55bf607560d9f6872760f");
  assert.equal(fixture.entryVectors.at(-1).entryHash, "b9948b7fa96c6d45f0fac10a52792ce88a4e243741dccf1e364311aeaba7dc86");
  assert.equal(fixture.projection.byteLength, 293);
  assert.equal(fixture.projection.sha256, "2a15f26152e5328917066f94df3f1911101cfca324045c3e9e012b8dc1d0f00a");
});

test("every declared key, state, policy, and projection byte carrier is exact UTF-8", () => {
  const vectors = [fixture.policyVector, ...fixture.entryVectors.flatMap((entry) => [entry.key, entry.state])];
  for (const vector of vectors) {
    const bytes = Buffer.from(vector.canonicalHex, "hex");
    assert.equal(bytes.toString("hex"), vector.canonicalHex);
    assert.equal(bytes.toString("utf8"), vector.canonicalUtf8);
    assert.equal(bytes.length, vector.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), vector.sha256);
    assert.equal(canonicalJson(JSON.parse(vector.canonicalUtf8)), vector.canonicalUtf8);
    assert.equal(canonicalJson(vector.value), vector.canonicalUtf8);
  }
  const projectionBytes = Buffer.from(fixture.projection.canonicalHex, "hex");
  assert.equal(projectionBytes.toString("utf8"), fixture.projection.canonicalUtf8);
  assert.equal(projectionBytes.length, fixture.projection.byteLength);
  assert.equal(canonicalJson(fixture.projection.canonicalValue), fixture.projection.canonicalUtf8);
});

test("the fixture rebuild is deterministic and byte-for-byte stable", () => {
  assert.equal(canonicalJson(buildCanonicalBaselineFixture()), canonicalJson(fixture));
});

test("all twelve hostile mutations fail at their frozen semantic boundary", () => {
  for (const attack of fixture.attackVectors) {
    assert.throws(
      () => validateBaselineModel(applyAttackVector(fixture, attack)),
      (error) => error instanceof BaselineVectorError && error.code === attack.expectedCode,
      attack.id,
    );
  }
});

test("v1 row constraints and cross-entry identities fail before hash comparison", () => {
  const rewriteState = (value, ordinal, mutate) => {
    const state = structuredClone(value.entryVectors[ordinal].state.value);
    mutate(state);
    const text = canonicalJson(state);
    const bytes = Buffer.from(text, "utf8");
    Object.assign(value.entryVectors[ordinal].state, {
      value: state,
      canonicalUtf8: text,
      canonicalHex: bytes.toString("hex"),
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  };
  const mutations = [
    [4, (state) => { state.summary.boundSequence = 1; }],
    [7, (state) => { state.leaseEpoch = 2; }],
    [9, (state) => { state.lastLockEpoch = 2; }],
    [10, (state) => { state.lockEpoch = 2; }],
    [2, (state) => { state.tailSequence = 1; }],
    [9, (state) => { state.updatedAtMs = 1735689600999; }],
  ];
  for (const [ordinal, mutate] of mutations) {
    const hostile = structuredClone(fixture);
    rewriteState(hostile, ordinal, mutate);
    assert.throws(
      () => validateBaselineModel(hostile),
      (error) => error instanceof BaselineVectorError && error.code === "GE_BASELINE_ENTRY_SHAPE",
      `semantic mutation at ordinal ${ordinal}`,
    );
  }
  for (const mutate of [
    (value) => { value.sourceEnvelope.sourceMigrationLineageId = "wrong-lineage"; },
    (value) => { value.sourceEnvelope.capturedAtMs = 1735689600999; },
  ]) {
    const hostile = structuredClone(fixture);
    mutate(hostile);
    assert.throws(
      () => validateBaselineModel(hostile),
      (error) => error instanceof BaselineVectorError && error.code === "GE_BASELINE_ENTRY_SHAPE",
      "source envelope coherency mutation",
    );
  }
});

test("closed fixture validation rejects unknown and missing fields", () => {
  const unknown = structuredClone(fixture);
  unknown.unexpected = true;
  assert.throws(() => validateCanonicalBaselineFixture(unknown), (error) => error.code === "GE_BASELINE_ENTRY_SHAPE");

  const missing = structuredClone(fixture);
  delete missing.sourceEnvelope.sourceUserVersion;
  assert.throws(() => validateCanonicalBaselineFixture(missing), (error) => error.code === "GE_BASELINE_ENTRY_SHAPE");
});
