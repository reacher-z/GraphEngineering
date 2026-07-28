#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(ROOT, "sqlite-operation-ledger-replay.case.json");
const SCHEMA_PATH = join(ROOT, "sqlite-operation-ledger-replay.schema.json");

const EXPECTED_SLUGS = Object.freeze([
  "ts-all-request-vectors", "python-all-request-vectors", "decode-encode-roundtrip",
  "legal-boundary-request-sizes", "exact-retry-request-identity",
  "captured-before-authorization", "invalid-request-utf8", "noncanonical-request-json",
  "request-shape-drift", "request-number-domain", "request-size-depth-exhaustion",
  "request-hash-only-drift", "coherent-request-hash-row-mismatch", "swapped-request-blobs",
  "operation-name-request-confusion", "request-error-leak", "first-sequence-is-one",
  "all-operation-global-order", "equal-timestamp-order", "retry-does-not-advance",
  "failed-decision-no-gap", "busy-retry-one-sequence", "mixed-process-contiguous",
  "safe-last-sequence", "zero-sequence", "negative-sequence", "duplicate-sequence",
  "sequence-gap", "reordered-sequence-effects", "singleton-row-drift", "sequence-overflow",
  "post-baseline-legacy-insertion", "empty-v1-baseline", "golden-v0-to-v2",
  "golden-v1-to-v2", "large-streamed-baseline", "no-legacy-operations",
  "all-legacy-result-shapes", "ts-migrate-python-audit", "python-migrate-ts-audit",
  "baseline-header-root-drift", "baseline-entry-blob-drift", "baseline-order-drift",
  "baseline-entry-deletion", "baseline-entry-insertion", "legacy-operation-drift",
  "malformed-source-rollback", "killed-baseline-publication", "append-replay",
  "historical-append-after-advance", "save-checkpoint-replay", "delete-present-and-absent",
  "acquire-lease-replay", "renew-lease-replay", "release-lease-replay",
  "expired-takeover-replay", "legal-hold-replay", "migration-lock-replay",
  "all-nine-alternating-history", "equal-final-hold-histories",
  "checkpoint-delete-recreate-history", "historical-lease-result-forgery",
  "append-result-tail-forgery", "append-valid-other-tail", "append-count-forgery",
  "checkpoint-result-forgery", "delete-result-forgery", "lease-result-forgery",
  "governance-result-forgery", "migration-result-forgery", "mutation-without-ledger",
  "ledger-without-mutation", "ts-all-families-python-continue",
  "python-all-families-ts-continue", "ts-event-snapshot-python-append",
  "python-checkpoint-snapshot-ts-mutate", "mixed-empty-tail-race", "mixed-lease-takeover",
  "python-backup-ts-restore", "ts-backup-python-restore", "all-identity-equivalence",
  "alternating-runtime-all-operations", "cross-runtime-request-byte-drift",
  "old-artifact-new-schema-refusal", "installed-npm-lifecycle",
  "installed-wheel-sdist-lifecycle", "bounded-replay-characterization",
  "cancellation-hidden-commit", "busy-full-io-failure", "path-and-symlink-substitution",
  "sql-error-payload-leak", "event-cursor-tail-forgery", "checkpoint-revision-forgery",
  "backup-baseline-manifest-forgery", "migration-asset-byte-drift",
  "evidence-and-nonclaim-sentinel",
]);

export class LedgerCampaignContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LedgerCampaignContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new LedgerCampaignContractError(code, message);
}

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const result = Object.create(null);
    for (const key of Object.keys(value).sort(compareCodePoints)) result[key] = canonicalize(value[key]);
    return result;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function expectedCategory(index) {
  const ordinal = index + 1;
  if (ordinal <= 16) return ordinal <= 6 ? "behavior" : "attack";
  if (ordinal <= 32) return ordinal <= 24 ? "behavior" : "attack";
  if (ordinal <= 48) return ordinal <= 40 ? "behavior" : "attack";
  if (ordinal <= 72) return ordinal <= 61 ? "behavior" : "attack";
  if (ordinal <= 84) return ordinal <= 82 ? "behavior" : "attack";
  return ordinal <= 87 ? "behavior" : "attack";
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
assert.equal(
  ajv.validateSchema(schema),
  true,
  `ledger campaign schema failed meta-validation: ${JSON.stringify(ajv.errors)}`,
);
const validateShape = ajv.compile(schema);

export function loadOperationLedgerReplayFixture() {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
}

export function validateOperationLedgerReplayFixture(value) {
  if (!validateShape(value)) {
    fail("GE_LEDGER_CAMPAIGN_SCHEMA", `closed fixture schema failed: ${JSON.stringify(validateShape.errors)}`);
  }
  const cases = value.cases;
  const ids = new Set();
  const slugs = new Set();
  let behavior = 0;
  let attack = 0;
  for (const [index, entry] of cases.entries()) {
    const expectedId = `OL-R${String(index + 1).padStart(2, "0")}`;
    if (entry.id !== expectedId) fail("GE_LEDGER_CAMPAIGN_ORDER", `case ${index + 1} must be ${expectedId}`);
    if (entry.slug !== EXPECTED_SLUGS[index]) {
      fail("GE_LEDGER_CAMPAIGN_NAME", `${expectedId} slug drifted`);
    }
    if (entry.category !== expectedCategory(index)) {
      fail("GE_LEDGER_CAMPAIGN_CATEGORY", `${expectedId} category drifted`);
    }
    if (ids.has(entry.id) || slugs.has(entry.slug)) {
      fail("GE_LEDGER_CAMPAIGN_DUPLICATE", `${expectedId} duplicates an ID or slug`);
    }
    ids.add(entry.id);
    slugs.add(entry.slug);
    behavior += entry.category === "behavior" ? 1 : 0;
    attack += entry.category === "attack" ? 1 : 0;
    if (entry.expected.outcome !== (entry.category === "behavior" ? "accepted" : "rejected")) {
      fail("GE_LEDGER_CAMPAIGN_OUTCOME", `${expectedId} outcome contradicts its category`);
    }
    if (entry.category === "attack" && entry.expected.typedFailures.length === 0) {
      fail("GE_LEDGER_CAMPAIGN_FAILURE", `${expectedId} lacks a typed rejection`);
    }
    if (entry.category === "attack" && entry.id !== "OL-R88"
      && entry.expected.requiresZeroUnintendedMutation !== true) {
      fail("GE_LEDGER_CAMPAIGN_MUTATION", `${expectedId} does not require zero unintended mutation`);
    }
    const destructive = [
      "destructive-database", "fresh-temporary-root", "explicit-database-path",
    ];
    const destructiveCount = destructive.filter((item) => entry.runtimeRequirements.includes(item)).length;
    if (destructiveCount !== 0 && destructiveCount !== destructive.length) {
      fail("GE_LEDGER_CAMPAIGN_ISOLATION", `${expectedId} has an incomplete destructive-test boundary`);
    }
  }
  if (behavior !== 48 || attack !== 48 || ids.size !== 96 || slugs.size !== 96) {
    fail("GE_LEDGER_CAMPAIGN_COUNT", "the campaign must retain 48 behavior and 48 attack cases");
  }
  const canonical = Buffer.from(canonicalJson(cases), "utf8");
  if (canonical.byteLength !== value.expect.casesCanonicalUtf8Bytes) {
    fail("GE_LEDGER_CAMPAIGN_BYTES", "canonical case byte count drifted");
  }
  const digest = sha256(canonical);
  if (digest !== value.expect.casesSha256) {
    fail("GE_LEDGER_CAMPAIGN_HASH", "canonical case SHA-256 drifted");
  }
  return Object.freeze({
    ok: true,
    status: value.status,
    caseCount: cases.length,
    behaviorCaseCount: behavior,
    attackCaseCount: attack,
    casesCanonicalUtf8Bytes: canonical.byteLength,
    casesSha256: digest,
    implementationClaim: false,
  });
}

export function validateCanonicalOperationLedgerReplayFixture() {
  return validateOperationLedgerReplayFixture(loadOperationLedgerReplayFixture());
}

if (process.argv[1] !== undefined
  && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(validateCanonicalOperationLedgerReplayFixture(), null, 2)}\n`);
}
