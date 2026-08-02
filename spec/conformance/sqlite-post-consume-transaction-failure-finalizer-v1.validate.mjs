#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(ROOT, "sqlite-post-consume-transaction-failure-finalizer-v1.case.json");
const SCHEMA_PATH = join(ROOT, "sqlite-post-consume-transaction-failure-finalizer-v1.schema.json");

const CASE_IDS = Object.freeze([
  "native-primary-plus-rollback-and-close-after-return-faults",
  "native-primary-plus-rollback-after-return-fault-only",
  "native-primary-plus-close-after-return-fault-only",
]);
const REQUIRED_IDENTITIES = Object.freeze([
  "sqlite-connection-object-identity",
  "unchanged-transaction-lineage-object-identity",
  "exact-transaction-generation",
  "outer-publication-authority-object-identity",
  "consumed-publication-session-tombstone-t-object-identity",
  "one-shot-finalizer-owner-object-identity",
]);
const NONCLAIMS = Object.freeze([
  "production-finalizer-implementation",
  "driver-native-rollback-throw",
  "driver-native-close-throw",
  "begin-ownership",
  "commit-ownership",
  "rule-12-ownership",
  "temp-stage-retirement",
  "success-cleanup-path",
  "rollback-reopen-recovery-proof",
  "fresh-graph-recovery-proof",
]);
const OPERATION_ORDER = Object.freeze([
  "consume-one-shot-owner",
  "terminalize-selected-graph",
  "attempt-native-rollback-once",
  "record-rollback-after-return-secondary-if-present",
  "attempt-native-close-once",
  "record-close-after-return-tertiary-if-present",
  "enter-finalized",
  "rethrow-original-primary",
]);
const ZERO_DIGEST = "0".repeat(64);
export const TRUSTED_FIXTURE_SHA256 =
  "81c055216223c89dc68055bbf325a73c61bfb899977dfb6255059137783ae360";

export class PostConsumeFinalizerContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PostConsumeFinalizerContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new PostConsumeFinalizerContractError(code, message);
}

export function parseStrictJson(text) {
  let index = 0;
  const whitespace = () => { while (/[\t\n\r ]/u.test(text[index] ?? "")) index += 1; };
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
        if (keys.has(key)) fail("GE_SQLITE_FINALIZER_DUPLICATE_KEY", `duplicate JSON key ${key}`);
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

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function fixtureDigest(value) {
  const copy = structuredClone(value);
  copy.fixtureCanonicalSha256 = ZERO_DIGEST;
  return createHash("sha256").update(canonicalJson(copy), "utf8").digest("hex");
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
assert.equal(ajv.validateSchema(schema), true,
  `post-consume finalizer schema failed meta-validation: ${JSON.stringify(ajv.errors)}`);
const validateShape = ajv.compile(schema);

export function loadPostConsumeFinalizerFixture() {
  return parseStrictJson(readFileSync(FIXTURE_PATH, "utf8"));
}

function exact(actual, expected, code, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code, message);
}

export function validatePostConsumeFinalizerFixture(value) {
  if (!validateShape(value)) {
    fail("GE_SQLITE_FINALIZER_SCHEMA", `closed fixture schema failed: ${JSON.stringify(validateShape.errors)}`);
  }

  exact(value.identityContract.exactRequiredObjects, REQUIRED_IDENTITIES,
    "GE_SQLITE_FINALIZER_IDENTITY", "exact connection, lineage, generation, authority, consumed T and owner drifted");
  exact(value.cases.map((entry) => entry.caseId), CASE_IDS,
    "GE_SQLITE_FINALIZER_CASE_ORDER", "canonical case identity/order drifted");
  exact(value.nonclaims, NONCLAIMS,
    "GE_SQLITE_FINALIZER_NONCLAIM", "contract ownership or evidence nonclaims drifted");
  exact(value.lifecycleContract.operationOrder, OPERATION_ORDER,
    "GE_SQLITE_FINALIZER_LIFECYCLE", "terminalize, rollback, close and primary rethrow order drifted");

  const diagnostics = value.diagnosticContract;
  if (diagnostics.primary.code !== "GE_SQLITE_POST_T_TERMINAL_PRIMARY"
      || diagnostics.primary.operation !== "cursor-publication-rule-11"
      || diagnostics.primary.rank !== "primary"
      || diagnostics.primary.origin !== "authenticated-post-t-terminal-primary"
      || diagnostics.rollback.code !== "GE_SQLITE_ROLLBACK_AFTER_NATIVE_RETURN"
      || diagnostics.rollback.operation !== "rollback"
      || diagnostics.rollback.rank !== "secondary"
      || diagnostics.rollback.origin !== "after-native-return-ambiguous-cleanup-fault"
      || diagnostics.close.code !== "GE_SQLITE_CLOSE_AFTER_NATIVE_RETURN"
      || diagnostics.close.operation !== "close"
      || diagnostics.close.rank !== "tertiary"
      || diagnostics.close.origin !== "after-native-return-ambiguous-cleanup-fault") {
    fail("GE_SQLITE_FINALIZER_DIAGNOSTIC", "canonical primary/secondary/tertiary diagnostics drifted");
  }

  const projectedIdentities = new Set();
  for (const entry of value.cases) {
    const projection = entry.identityProjection;
    for (const [field, identity] of Object.entries(projection)) {
      if (field === "transactionGeneration") continue;
      if (projectedIdentities.has(identity)) {
        fail("GE_SQLITE_FINALIZER_IDENTITY", `identity ${field} is shared across independent case graphs`);
      }
      projectedIdentities.add(identity);
    }

    const expectedCodes = [diagnostics.primary.code];
    if (entry.input.rollbackAfterNativeReturnFault) expectedCodes.push(diagnostics.rollback.code);
    if (entry.input.closeAfterNativeReturnFault) expectedCodes.push(diagnostics.close.code);
    exact(entry.expected.diagnosticCodes, expectedCodes,
      "GE_SQLITE_FINALIZER_PRECEDENCE", `${entry.caseId} diagnostic projection drifted`);
    if (entry.expected.selectedThrow !== entry.input.primary
        || entry.expected.ownerConsumeCount !== 1
        || entry.expected.terminalizeCount !== 1
        || entry.expected.rollbackAttemptCount !== 1
        || entry.expected.rollbackNativeReturnCount !== 1
        || entry.expected.closeAttemptCount !== 1
        || entry.expected.closeNativeReturnCount !== 1) {
      fail("GE_SQLITE_FINALIZER_COUNTS", `${entry.caseId} exact lifecycle counts drifted`);
    }
  }

  if (!value.cases.every((entry) => entry.input.primary === diagnostics.primary.code)) {
    fail("GE_SQLITE_FINALIZER_PRIMARY_REQUIRED", "a finalizer case omitted its authenticated post-T primary");
  }
  if (!value.cases[0].input.rollbackAfterNativeReturnFault
      || !value.cases[0].input.closeAfterNativeReturnFault
      || !value.cases[1].input.rollbackAfterNativeReturnFault
      || value.cases[1].input.closeAfterNativeReturnFault
      || value.cases[2].input.rollbackAfterNativeReturnFault
      || !value.cases[2].input.closeAfterNativeReturnFault) {
    fail("GE_SQLITE_FINALIZER_MATRIX", "both/rollback-only/close-only cleanup fault matrix drifted");
  }

  const digest = fixtureDigest(value);
  if (value.fixtureCanonicalSha256 !== TRUSTED_FIXTURE_SHA256
      || digest !== value.fixtureCanonicalSha256
      || digest !== TRUSTED_FIXTURE_SHA256) {
    fail("GE_SQLITE_FINALIZER_FIXTURE_HASH",
      "fixture field, computed SHA-256 and independent trusted SHA-256 must all match");
  }
  return Object.freeze({
    ok: true,
    status: value.status,
    caseCount: value.cases.length,
    lifecycle: value.lifecycleContract.stateOrder.join("->"),
    rollbackAttemptCountPerCase: 1,
    closeAttemptCountPerCase: 1,
    fixtureCanonicalSha256: digest,
    implementationClaim: false,
    driverNativeCleanupThrowClaim: false,
  });
}

export function validateCanonicalPostConsumeFinalizerFixture() {
  return validatePostConsumeFinalizerFixture(loadPostConsumeFinalizerFixture());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(validateCanonicalPostConsumeFinalizerFixture(), null, 2)}\n`);
}
