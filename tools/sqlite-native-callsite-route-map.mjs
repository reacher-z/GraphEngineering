#!/usr/bin/env node

/**
 * Fail-closed join for the bounded P11-A RM1 baseline-source callsite map.
 *
 * The scanner and Python classifier remain the receiver-evidence authorities.
 * The external manifest supplies the route-shape assertions.  This module only
 * accepts an exact one-to-one join; it never turns receiver or SQL evidence into
 * runtime route authority and it never claims global route closure.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { compareUnicodeCodePoints } from "./sqlite-native-callsite-discovery.mjs";

const SHA256 = /^[0-9a-f]{64}$/u;
const MANIFEST_RAW_SHA256 = "16d7514e1fa9995c64c55132844b295c671af8fdc611df8c247261c2d61bf8c7";
const MANIFEST_CANONICAL_SHA256 = "85e05220c392c31af0d3a947185250c59913f05bd22fb1c0332310c0137a4364";
const TYPESCRIPT_SOURCE = "packages/sqlite/src/operation-baseline-source.ts";
const PYTHON_SOURCE = "python/src/graph_engineering/sqlite_operation_baseline_source.py";
const EXPECTED_COUNTS = Object.freeze({ python: 47, typescript: 18 });
const EXPECTED_TOTAL = 65;
const RECEIVER_CATEGORIES = new Set([
  "confirmed-native-receiver",
  "wrapper-guard-or-test-like-production-probe",
  "false-positive",
  "unknown",
]);
const DISPOSITIONS = new Set([
  "authenticated-fixed-read",
  "scoped-mutation",
  "forbidden",
  "unknown",
]);
const LOWER_EDGE_STATUSES = new Set([
  "self-native-receiver",
  "unique-lower-native-receiver",
  "unresolved-wrapper-edge",
  "unresolved",
]);
const RISK_CODES = [
  "R1_RECEIVER_UNPROVEN",
  "R2_LOWER_EDGE_UNRESOLVED",
  "R3_SQL_CLOSURE_UNRESOLVED",
  "R4_PARAMETERS_UNRESOLVED",
  "R5_PHASE_UNRESOLVED",
  "R6_OWNER_COMPOSITION_UNRESOLVED",
  "R7_BUDGET_UNRESOLVED",
  "R8_RESOURCE_LIFECYCLE_UNRESOLVED",
  "R9_ROUTE_AUTHORITY_ABSENT",
];
const AUTHORITY_BARRIERS = [
  "route-disposition-unknown",
  "native-projection-authority-false",
  "runtime-route-authority-false",
  "receiver-unproven",
  "lower-native-edge-unresolved",
  "sql-closure-unresolved",
  "parameter-provenance-unresolved",
  "phase-unresolved",
  "owner-composition-unresolved",
  "budget-unresolved",
  "resource-lifecycle-unresolved",
];
const THREAT_CODES = [
  "GENERIC_SINK_ESCALATION",
  "DIGEST_NOT_AUTHORITY",
  "CONTEXT_CONFLATION",
  "INJECTION_SEAM",
  "API_STAGE_DOUBLE_COUNT",
  "RESOURCE_CROSS_PAIRING",
  "DYNAMIC_IDENTIFIER_EXPANSION",
  "REOPEN_AUDIT_PERMIT_FORBIDDEN",
  "WRAPPER_PROVENANCE_NOT_COMPOSITION",
];
const FUTURE_PERMIT_POLICIES = [
  "never",
  "requires-context-split",
  "requires-closed-leaf",
];

function fail(message) {
  throw new Error(`SQLite P11-A RM1 route-map rejected: ${message}`);
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function array(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareUnicodeCodePoints);
  const wanted = [...expected].sort(compareUnicodeCodePoints);
  if (actual.length !== wanted.length
      || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} fields must be exactly ${wanted.join(", ")}`);
  }
}

function requiredString(value, key, label) {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) {
    fail(`${label}.${key} must be a non-empty string`);
  }
  return result;
}

function requiredInteger(value, key, label, minimum = 0) {
  const result = value[key];
  if (!Number.isSafeInteger(result) || result < minimum) {
    fail(`${label}.${key} must be an integer >= ${minimum}`);
  }
  return result;
}

function requiredBoolean(value, key, expected, label) {
  if (value[key] !== expected) fail(`${label}.${key} must be ${String(expected)}`);
  return expected;
}

function nullableString(value, key, label) {
  const result = value[key];
  if (result !== null && (typeof result !== "string" || result.length === 0)) {
    fail(`${label}.${key} must be null or a non-empty string`);
  }
  return result;
}

function nullableSha256(value, key, label) {
  const result = value[key];
  if (result !== null && (typeof result !== "string" || !SHA256.test(result))) {
    fail(`${label}.${key} must be null or a lowercase SHA-256`);
  }
  return result;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareUnicodeCodePoints).map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function scannerIdentity(callsite) {
  return {
    column: callsite.column,
    line: callsite.line,
    method: callsite.method,
    path: callsite.path,
    sqlOrigin: callsite.sqlOrigin,
  };
}

function routeIdentity(callsite, occurrence) {
  return {
    path: callsite.path,
    line: callsite.line,
    column: callsite.column,
    method: callsite.method,
    sqlOrigin: callsite.sqlOrigin,
    occurrence,
  };
}

function compareIdentities(left, right) {
  return compareUnicodeCodePoints(left.path, right.path)
    || left.line - right.line
    || left.column - right.column
    || compareUnicodeCodePoints(left.method, right.method)
    || compareUnicodeCodePoints(left.sqlOrigin, right.sqlOrigin)
    || left.occurrence - right.occurrence;
}

function identityKey(identity) {
  return stableJson(identity);
}

function validateScannerReport(scannerReport) {
  const report = object(scannerReport, "scanner report");
  requiredBoolean(report, "routeClosureClaimed", false, "scanner report");
  const policy = object(report.policy, "scanner report.policy");
  requiredBoolean(policy, "routeClosureClaimed", false, "scanner report.policy");
  const callsites = array(report.callsites, "scanner report.callsites");
  if (callsites.length !== 457) fail("scanner report must retain all 457 global candidates");

  const stableIds = new Set();
  const normalized = [];
  for (let index = 0; index < callsites.length; index += 1) {
    const label = `scanner report.callsites[${index}]`;
    const callsite = object(callsites[index], label);
    const language = requiredString(callsite, "language", label);
    if (language !== "typescript" && language !== "python") fail(`${label}.language is invalid`);
    const identity = scannerIdentity({
      path: requiredString(callsite, "path", label),
      line: requiredInteger(callsite, "line", label, 1),
      column: requiredInteger(callsite, "column", label, 1),
      method: requiredString(callsite, "method", label),
      sqlOrigin: requiredString(callsite, "sqlOrigin", label),
    });
    const stable = object(callsite.stableIdentity, `${label}.stableIdentity`);
    exactKeys(stable, ["column", "line", "method", "path", "sqlOrigin", "sha256"], `${label}.stableIdentity`);
    for (const key of ["column", "line", "method", "path", "sqlOrigin"]) {
      if (stable[key] !== identity[key]) fail(`${label}.stableIdentity.${key} drifted from the callsite`);
    }
    const expectedSha = sha256(JSON.stringify(identity));
    if (stable.sha256 !== expectedSha) fail(`${label}.stableIdentity.sha256 is invalid`);
    if (stableIds.has(expectedSha)) fail(`duplicate scanner stable identity ${expectedSha}`);
    stableIds.add(expectedSha);
    if (callsite.routeClassification !== "unknown" || callsite.unknown !== true) {
      fail(`${label} must remain route-unknown`);
    }
    normalized.push({ callsite, identity, language, scannerSha256: expectedSha });
  }
  return normalized;
}

function pythonOccurrenceCandidates(scannerCandidates) {
  const sortable = scannerCandidates
    .filter(({ language }) => language === "python")
    .map((candidate) => ({ ...candidate, canonical: stableJson(candidate.callsite) }))
    .sort((left, right) => (
      compareUnicodeCodePoints(left.identity.path, right.identity.path)
      || left.identity.line - right.identity.line
      || left.identity.column - right.identity.column
      || compareUnicodeCodePoints(left.identity.method, right.identity.method)
      || compareUnicodeCodePoints(left.identity.sqlOrigin, right.identity.sqlOrigin)
      || compareUnicodeCodePoints(left.canonical, right.canonical)
    ));
  const occurrences = new Map();
  return sortable.map((candidate) => {
    const baseKey = identityKey(candidate.identity);
    const occurrence = occurrences.get(baseKey) ?? 0;
    occurrences.set(baseKey, occurrence + 1);
    const identity = routeIdentity(candidate.identity, occurrence);
    return {
      ...candidate,
      candidateSha256: sha256(stableJson(identity)),
      routeIdentity: identity,
    };
  });
}

function validateClassifierReport(classifierReport, scannerCandidates) {
  const report = object(classifierReport, "Python classifier report");
  const policy = object(report.classificationPolicy, "Python classifier report.classificationPolicy");
  requiredBoolean(policy, "routeAuthorization", false, "Python classifier report.classificationPolicy");
  requiredBoolean(policy, "routeClosureClaimed", false, "Python classifier report.classificationPolicy");
  requiredBoolean(policy, "unknownCandidatesDropped", false, "Python classifier report.classificationPolicy");
  const sourcePolicy = object(report.sourceScannerPolicy, "Python classifier report.sourceScannerPolicy");
  requiredBoolean(sourcePolicy, "routeClosureClaimed", false, "Python classifier report.sourceScannerPolicy");

  const raw = array(report.candidates, "Python classifier report.candidates");
  const expected = pythonOccurrenceCandidates(scannerCandidates);
  if (raw.length !== expected.length || raw.length !== 251) {
    fail("Python classifier must retain all 251 scanner candidates");
  }
  const expectedById = new Map(expected.map((candidate) => [candidate.candidateSha256, candidate]));
  const result = new Map();
  for (let index = 0; index < raw.length; index += 1) {
    const label = `Python classifier report.candidates[${index}]`;
    const classified = object(raw[index], label);
    const candidateId = requiredString(classified, "candidateId", label);
    if (!SHA256.test(candidateId)) fail(`${label}.candidateId must be a lowercase SHA-256`);
    const expectedCandidate = expectedById.get(candidateId);
    if (!expectedCandidate) fail(`${label}.candidateId does not join one scanner identity`);
    const identity = object(classified.identity, `${label}.identity`);
    exactKeys(identity, ["column", "line", "method", "occurrence", "path", "sqlOrigin"], `${label}.identity`);
    if (identityKey(identity) !== identityKey(expectedCandidate.routeIdentity)) {
      fail(`${label}.identity drifted from scanner identity/occurrence ordering`);
    }
    const category = requiredString(classified, "category", label);
    if (!RECEIVER_CATEGORIES.has(category)) fail(`${label}.category is invalid`);
    if (result.has(candidateId)) fail(`duplicate Python classifier candidate ${candidateId}`);
    const scannerEvidence = object(classified.scannerEvidence, `${label}.scannerEvidence`);
    const sqlEvidence = object(classified.sqlEvidence, `${label}.sqlEvidence`);
    const scannerSql = object(expectedCandidate.callsite.sqlEvidence, "scanner SQL evidence");
    for (const key of ["status", "shape", "sha256", "token"]) {
      if (sqlEvidence[key] !== scannerSql[key]) fail(`${label}.sqlEvidence.${key} drifted from scanner`);
    }
    result.set(candidateId, {
      candidateId,
      category,
      classified,
      identity: expectedCandidate.routeIdentity,
      reason: requiredString(classified, "reason", label),
      scanner: expectedCandidate,
      scannerEvidence,
      sqlEvidence,
    });
  }
  if (result.size !== expected.length) fail("Python scanner/classifier join is not one-to-one");
  return result;
}

function typescriptCandidates(scannerCandidates) {
  const result = new Map();
  for (const candidate of scannerCandidates.filter(({ language }) => language === "typescript")) {
    const classification = object(
      candidate.callsite.typescriptClassification,
      "TypeScript scanner classification",
    );
    const category = requiredString(classification, "disposition", "TypeScript scanner classification");
    if (!RECEIVER_CATEGORIES.has(category)) fail("TypeScript scanner category is invalid");
    result.set(candidate.scannerSha256, {
      candidateId: candidate.scannerSha256,
      category,
      identity: routeIdentity(candidate.identity, 0),
      reason: requiredString(candidate.callsite, "receiverEvidence", "TypeScript scanner callsite"),
      scanner: candidate,
    });
  }
  return result;
}

function validateNullableClaim(value, label, valueKeys) {
  const record = object(value, label);
  exactKeys(record, ["status", ...valueKeys], label);
  const status = requiredString(record, "status", label);
  if (status !== "resolved" && status !== "unresolved" && status !== "not-applicable") {
    fail(`${label}.status is invalid`);
  }
  for (const key of valueKeys) {
    const item = record[key];
    if (status === "unresolved" && item !== null) fail(`${label}.${key} must be null while unresolved`);
    if (status === "resolved" && (typeof item !== "string" || item.length === 0)) {
      fail(`${label}.${key} must be a non-empty string while resolved`);
    }
    if (status === "not-applicable" && item !== null) {
      fail(`${label}.${key} must be null when not applicable`);
    }
  }
  return record;
}

function validateBudget(value, label) {
  const budget = object(value, label);
  exactKeys(budget, ["cursor", "row"], label);
  for (const name of ["row", "cursor"]) {
    const itemLabel = `${label}.${name}`;
    const item = object(budget[name], itemLabel);
    exactKeys(item, ["kind", "maximum"], itemLabel);
    const kind = requiredString(item, "kind", itemLabel);
    if (kind === "unknown" || kind === "not-applicable") {
      if (item.maximum !== null) fail(`${itemLabel}.maximum must be null for ${kind}`);
    } else {
      requiredInteger(item, "maximum", itemLabel, 0);
    }
  }
  return budget;
}

function validateResourceLifecycle(value, label) {
  const lifecycle = object(value, label);
  exactKeys(lifecycle, ["states", "status"], label);
  const status = requiredString(lifecycle, "status", label);
  const states = array(lifecycle.states, `${label}.states`);
  if (!states.every((state) => typeof state === "string" && state.length > 0)) {
    fail(`${label}.states must contain only non-empty strings`);
  }
  if (new Set(states).size !== states.length) fail(`${label}.states must be unique`);
  if (status === "unresolved" && states.length !== 0) {
    fail(`${label}.states must be empty while unresolved`);
  }
  if (status !== "unresolved" && status !== "resolved" && status !== "not-applicable") {
    fail(`${label}.status is invalid`);
  }
  return lifecycle;
}

function validateSqlEvidence(value, expected, label) {
  const evidence = object(value, label);
  exactKeys(evidence, ["sha256", "shape", "status", "token"], label);
  for (const key of ["status", "shape"]) requiredString(evidence, key, label);
  nullableSha256(evidence, "sha256", label);
  nullableString(evidence, "token", label);
  for (const key of ["status", "shape", "sha256", "token"]) {
    if (evidence[key] !== expected[key]) fail(`${label}.${key} drifted from scanner evidence`);
  }
  return evidence;
}

function validateParameterProvenance(value, label) {
  const provenance = object(value, label);
  exactKeys(provenance, ["source", "status"], label);
  const status = requiredString(provenance, "status", label);
  if (status === "unresolved" || status === "not-applicable-no-sql") {
    if (provenance.source !== null) fail(`${label}.source must be null for ${status}`);
  } else if (status === "known-zero-parameter") {
    if (provenance.source !== "source-call-arity") {
      fail(`${label}.source must bind known zero parameters to source-call-arity`);
    }
  } else {
    fail(`${label}.status is invalid`);
  }
  return provenance;
}

function validateDynamicClosure(value, sqlEvidence, label) {
  const closure = object(value, label);
  exactKeys(
    closure,
    [
      "assetOrdinal",
      "cardinality",
      "componentContract",
      "digestKind",
      "expansionSqlSha256",
      "quoting",
      "source",
      "sourceAssetSha256",
      "status",
    ],
    label,
  );
  const status = requiredString(closure, "status", label);
  const digestKind = requiredString(closure, "digestKind", label);
  if (!["none", "source-asset", "sql-expansion", "sql-expansion-set"].includes(digestKind)) {
    fail(`${label}.digestKind is invalid`);
  }
  const digests = array(closure.expansionSqlSha256, `${label}.expansionSqlSha256`);
  if (!digests.every((digest) => typeof digest === "string" && SHA256.test(digest))
      || new Set(digests).size !== digests.length) {
    fail(`${label}.expansionSqlSha256 must contain unique lowercase SHA-256 values`);
  }
  const sourceAssetSha256 = nullableSha256(closure, "sourceAssetSha256", label);
  const componentContract = array(closure.componentContract, `${label}.componentContract`);
  if (!componentContract.every((component) => typeof component === "string" && component.length > 0)
      || new Set(componentContract).size !== componentContract.length) {
    fail(`${label}.componentContract must contain unique non-empty strings`);
  }
  if (status === "exact-static") {
    if (sqlEvidence.status !== "exact" || closure.cardinality !== 1
        || digests.length !== 1 || digests[0] !== sqlEvidence.sha256
        || typeof closure.source !== "string" || closure.source.length === 0
        || closure.quoting !== "source-frozen" || closure.assetOrdinal !== null
        || digestKind !== "sql-expansion" || sourceAssetSha256 !== null
        || componentContract.length !== 0) {
      fail(`${label} exact-static closure is inconsistent with scanner SQL evidence`);
    }
  } else if (status === "not-applicable-no-sql") {
    if (sqlEvidence.status !== "absent" || closure.source !== null
        || closure.cardinality !== 0 || closure.quoting !== null
        || closure.assetOrdinal !== null || digests.length !== 0
        || digestKind !== "none" || sourceAssetSha256 !== null
        || componentContract.length !== 0) {
      fail(`${label} no-SQL closure is inconsistent with scanner SQL evidence`);
    }
  } else if (status === "unresolved") {
    if (closure.cardinality !== null || closure.quoting !== null
        || closure.assetOrdinal !== null || digests.length !== 0
        || digestKind !== "none" || sourceAssetSha256 !== null
        || componentContract.length !== 0) {
      fail(`${label} unresolved closure cannot claim closed expansion data`);
    }
    if (typeof closure.source !== "string" || closure.source.length === 0) {
      fail(`${label}.source must describe the unresolved SQL shape`);
    }
  } else if (status === "captured-fixed-sql-unresolved-route") {
    if (sqlEvidence.status !== "unknown" || closure.cardinality !== 1
        || closure.quoting !== "definition-time-captured-fixed-sql"
        || closure.assetOrdinal !== null || sourceAssetSha256 !== null
        || typeof closure.source !== "string" || closure.source.length === 0
        || !((digestKind === "none" && digests.length === 0)
          || (digestKind === "sql-expansion" && digests.length === 1))) {
      fail(`${label} captured fixed-SQL closure is inconsistent`);
    }
  } else if (status === "bounded-static-assets-unresolved-route"
      || status === "bounded-static-family-unresolved-route") {
    if (sqlEvidence.status !== "unknown" || !Number.isSafeInteger(closure.cardinality)
        || closure.cardinality < 1 || digests.length !== closure.cardinality
        || digestKind !== "sql-expansion-set" || sourceAssetSha256 !== null
        || typeof closure.source !== "string" || closure.source.length === 0
        || typeof closure.quoting !== "string" || closure.quoting.length === 0
        || componentContract.length === 0
        || (status === "bounded-static-assets-unresolved-route"
          ? typeof closure.assetOrdinal !== "string" || closure.assetOrdinal.length === 0
          : closure.assetOrdinal !== null)) {
      fail(`${label} bounded static closure is inconsistent`);
    }
  } else if (status === "bounded-static-enum-unresolved-route") {
    if (sqlEvidence.status !== "dynamic" || !Number.isSafeInteger(closure.cardinality)
        || closure.cardinality < 1
        || typeof closure.source !== "string" || closure.source.length === 0
        || typeof closure.quoting !== "string" || closure.quoting.length === 0
        || typeof closure.assetOrdinal !== "string" || closure.assetOrdinal.length === 0
        || componentContract.length === 0
        || !((digestKind === "none" && sourceAssetSha256 === null && digests.length === 0)
          || (digestKind === "source-asset" && sourceAssetSha256 !== null && digests.length === 0))) {
      fail(`${label} bounded enum closure is inconsistent`);
    }
  } else {
    fail(`${label}.status is invalid`);
  }
  return closure;
}

function validateInvocationContexts(value, label) {
  const contexts = array(value, label);
  if (contexts.length === 0) fail(`${label} must retain at least one invocation context`);
  const ids = new Set();
  for (let index = 0; index < contexts.length; index += 1) {
    const itemLabel = `${label}[${index}]`;
    const context = object(contexts[index], itemLabel);
    exactKeys(
      context,
      ["connectionState", "futurePermitPolicy", "id", "rm1PermitAvailable"],
      itemLabel,
    );
    const id = requiredString(context, "id", itemLabel);
    requiredString(context, "connectionState", itemLabel);
    requiredBoolean(context, "rm1PermitAvailable", false, itemLabel);
    const futurePermitPolicy = requiredString(context, "futurePermitPolicy", itemLabel);
    if (!FUTURE_PERMIT_POLICIES.includes(futurePermitPolicy)) {
      fail(`${itemLabel}.futurePermitPolicy is invalid`);
    }
    if (ids.has(id)) fail(`${label} contains duplicate context ${id}`);
    ids.add(id);
  }
  return contexts;
}

function validateNegativeFacts(value, label) {
  const facts = object(value, label);
  exactKeys(
    facts,
    [
      "controlStatement",
      "dynamicSqlUnclosed",
      "nativeProjectionProduced",
      "noSqlRoute",
      "reopenAuditOnly",
      "zeroParameter",
    ],
    label,
  );
  for (const key of [
    "controlStatement",
    "dynamicSqlUnclosed",
    "noSqlRoute",
    "reopenAuditOnly",
  ]) {
    if (typeof facts[key] !== "boolean") fail(`${label}.${key} must be boolean`);
  }
  requiredBoolean(facts, "nativeProjectionProduced", false, label);
  if (facts.zeroParameter !== null && typeof facts.zeroParameter !== "boolean") {
    fail(`${label}.zeroParameter must be boolean or null`);
  }
  return facts;
}

function validateNonAuthorizingRole(value, label) {
  const role = object(value, label);
  exactKeys(
    role,
    ["id", "inventoryEvidenceOnly", "mayAuthorizeRuntimeRoute", "mayIssuePermit", "mayMintNativeProjection"],
    label,
  );
  requiredString(role, "id", label);
  requiredBoolean(role, "inventoryEvidenceOnly", true, label);
  requiredBoolean(role, "mayAuthorizeRuntimeRoute", false, label);
  requiredBoolean(role, "mayIssuePermit", false, label);
  requiredBoolean(role, "mayMintNativeProjection", false, label);
  return role;
}

function validateVocabularySubset(value, vocabulary, required, label) {
  const values = array(value, label);
  if (!values.every((item) => typeof item === "string" && vocabulary.includes(item))) {
    fail(`${label} contains an unknown code`);
  }
  if (new Set(values).size !== values.length) fail(`${label} must not contain duplicates`);
  for (const item of required) {
    if (!values.includes(item)) fail(`${label} is missing required code ${item}`);
  }
  return values;
}

function validateCursorPair(value, candidate, allCandidates, label) {
  if (value === null) return null;
  const pair = object(value, label);
  exactKeys(
    pair,
    [
      "allocationCandidateSha256",
      "connectionGeneration",
      "connectionIdentity",
      "executionCandidateSha256",
      "status",
      "terminalRetirement",
    ],
    label,
  );
  if (pair.status !== "unresolved-binding") fail(`${label}.status must remain unresolved-binding`);
  const allocation = requiredString(pair, "allocationCandidateSha256", label);
  const execution = requiredString(pair, "executionCandidateSha256", label);
  if (!SHA256.test(allocation) || !SHA256.test(execution) || allocation === execution) {
    fail(`${label} allocation/execution identities are invalid`);
  }
  const allocationCandidate = allCandidates.get(allocation);
  const executionCandidate = allCandidates.get(execution);
  if (!allocationCandidate || !executionCandidate
      || allocationCandidate.scanner.language !== "python"
      || executionCandidate.scanner.language !== "python"
      || allocationCandidate.identity.method !== "cursor"
      || executionCandidate.identity.method !== "execute") {
    fail(`${label} must join one Python cursor allocation to one execute candidate`);
  }
  if (candidate.candidateId !== allocation && candidate.candidateId !== execution) {
    fail(`${label} does not contain its owning candidate`);
  }
  for (const key of ["connectionGeneration", "connectionIdentity", "terminalRetirement"]) {
    validateNullableClaim(pair[key], `${label}.${key}`, ["value"]);
  }
  return pair;
}

function validateReceiverEvidence(value, expected, label) {
  const receiver = object(value, label);
  exactKeys(receiver, ["aliasDepth", "category", "confidence", "family", "kind", "reason"], label);
  const category = requiredString(receiver, "category", label);
  if (!RECEIVER_CATEGORIES.has(category)) fail(`${label}.category is invalid`);
  for (const key of ["confidence", "kind", "reason"]) requiredString(receiver, key, label);
  nullableString(receiver, "family", label);
  if (receiver.aliasDepth !== null
      && (!Number.isSafeInteger(receiver.aliasDepth) || receiver.aliasDepth < 0)) {
    fail(`${label}.aliasDepth must be null or a non-negative integer`);
  }
  for (const key of ["aliasDepth", "category", "confidence", "family", "kind", "reason"]) {
    if (receiver[key] !== expected[key]) fail(`${label}.${key} drifted from receiver classifier`);
  }
  return receiver;
}

function validateLowerNativeEdge(value, candidate, allCandidates, label) {
  const edge = object(value, label);
  exactKeys(edge, ["reason", "status", "targetCandidateSha256"], label);
  const status = requiredString(edge, "status", label);
  if (!LOWER_EDGE_STATUSES.has(status)) fail(`${label}.status is invalid`);
  const target = nullableSha256(edge, "targetCandidateSha256", label);
  requiredString(edge, "reason", label);

  if (candidate.category === "confirmed-native-receiver") {
    if (status !== "self-native-receiver" || target !== candidate.candidateId) {
      fail(`${label} must identify the confirmed native candidate itself exactly once`);
    }
    return edge;
  }
  if (candidate.category === "wrapper-guard-or-test-like-production-probe") {
    if (status === "unresolved-wrapper-edge") {
      if (target !== null) fail(`${label} unresolved wrapper edge cannot name a target`);
      return edge;
    }
    if (status !== "unique-lower-native-receiver" || target === null) {
      fail(`${label} wrapper edge must be explicitly unresolved or name one unique native target`);
    }
    const lower = allCandidates.get(target);
    if (!lower || lower.category !== "confirmed-native-receiver") {
      fail(`${label} target must join one confirmed native candidate`);
    }
    if (lower.scanner.language !== candidate.scanner.language) {
      fail(`${label} target must use the same runtime language as its wrapper`);
    }
    return edge;
  }
  if (status !== "unresolved" || target !== null) {
    fail(`${label} unknown/non-SQLite receiver cannot assert a lower native edge`);
  }
  return edge;
}

function expectedReceiver(candidate) {
  if (candidate.scanner.language === "typescript") {
    const callsite = candidate.scanner.callsite;
    return {
      aliasDepth: callsite.receiverEvidenceAliasDepth,
      category: candidate.category,
      confidence: callsite.receiverConfidence,
      family: callsite.receiverFamily,
      kind: callsite.receiverKind,
      reason: candidate.reason,
    };
  }
  return {
    aliasDepth: null,
    category: candidate.category,
    confidence: candidate.scannerEvidence.receiverConfidence,
    family: null,
    kind: candidate.scannerEvidence.receiverKind,
    reason: candidate.reason,
  };
}

function validateStableIdentity(value, candidate, label) {
  const identity = object(value, label);
  exactKeys(
    identity,
    [
      "candidateSha256",
      "column",
      "line",
      "method",
      "occurrence",
      "path",
      "scannerSha256",
      "sqlOrigin",
    ],
    label,
  );
  for (const key of ["path", "method", "sqlOrigin"]) requiredString(identity, key, label);
  requiredInteger(identity, "line", label, 1);
  requiredInteger(identity, "column", label, 1);
  requiredInteger(identity, "occurrence", label, 0);
  for (const key of ["scannerSha256", "candidateSha256"]) {
    if (!SHA256.test(requiredString(identity, key, label))) fail(`${label}.${key} is invalid`);
  }
  for (const key of ["path", "line", "column", "method", "sqlOrigin", "occurrence"]) {
    if (identity[key] !== candidate.identity[key]) fail(`${label}.${key} drifted from joined identity`);
  }
  if (identity.scannerSha256 !== candidate.scanner.scannerSha256) {
    fail(`${label}.scannerSha256 drifted from scanner`);
  }
  if (identity.candidateSha256 !== candidate.candidateId) {
    fail(`${label}.candidateSha256 drifted from classifier identity`);
  }
  return identity;
}

function increment(counter, key) {
  counter[key] = (counter[key] ?? 0) + 1;
}

function validateManifestPreamble(manifest, sourceRoot) {
  exactKeys(
    manifest,
    [
      "callsites",
      "authorityBarrierVocabulary",
      "classificationPolicy",
      "contractId",
      "futurePermitPolicyVocabulary",
      "schemaVersion",
      "scope",
      "sourceImplementationCommit",
      "status",
      "summary",
      "riskCodeVocabulary",
      "threatCodeVocabulary",
    ],
    "manifest",
  );
  if (manifest.schemaVersion !== 1) fail("manifest.schemaVersion must be 1");
  if (requiredString(manifest, "contractId", "manifest")
      !== "sqlite-cursor-publication-owner-composition-p11-callsites-v1") {
    fail("manifest.contractId is invalid");
  }
  if (requiredString(manifest, "status", "manifest") !== "p11-a-rm1-inventory-only") {
    fail("manifest.status is invalid");
  }
  if (!/^[0-9a-f]{40}$/u.test(requiredString(manifest, "sourceImplementationCommit", "manifest"))) {
    fail("manifest.sourceImplementationCommit must be a full lowercase Git commit");
  }

  const scope = object(manifest.scope, "manifest.scope");
  exactKeys(
    scope,
    [
      "globalScannerCallsiteCount",
      "nativeProjectionAuthority",
      "routeAuthorization",
      "routeClosureClaimed",
      "runtimeRouteAuthority",
      "scopedCallsiteCount",
      "sourceFiles",
      "unknownCandidatesDropped",
    ],
    "manifest.scope",
  );
  requiredBoolean(scope, "routeAuthorization", false, "manifest.scope");
  requiredBoolean(scope, "routeClosureClaimed", false, "manifest.scope");
  requiredBoolean(scope, "nativeProjectionAuthority", false, "manifest.scope");
  requiredBoolean(scope, "runtimeRouteAuthority", false, "manifest.scope");
  requiredBoolean(scope, "unknownCandidatesDropped", false, "manifest.scope");
  if (scope.scopedCallsiteCount !== EXPECTED_TOTAL || scope.globalScannerCallsiteCount !== 457) {
    fail("manifest.scope candidate counts are invalid");
  }
  const sourceFiles = array(scope.sourceFiles, "manifest.scope.sourceFiles");
  const expectedSources = [
    {
      expectedCallsiteCount: 18,
      language: "typescript",
      path: TYPESCRIPT_SOURCE,
      sourceBlobSha256: sha256(fs.readFileSync(path.join(sourceRoot, TYPESCRIPT_SOURCE))),
    },
    {
      expectedCallsiteCount: 47,
      language: "python",
      path: PYTHON_SOURCE,
      sourceBlobSha256: sha256(fs.readFileSync(path.join(sourceRoot, PYTHON_SOURCE))),
    },
  ];
  if (stableJson(sourceFiles) !== stableJson(expectedSources)) {
    fail("manifest.scope.sourceFiles must be the exact ordered 18+47 source scope");
  }

  const policy = object(manifest.classificationPolicy, "manifest.classificationPolicy");
  exactKeys(
    policy,
    [
      "allowedDispositions",
      "defaultDisposition",
      "exactSqlDigestIsRouteAuthority",
      "missingEvidenceDisposition",
      "receiverEvidenceIsRouteAuthority",
      "unresolvedLowerEdgeIsRouteAuthority",
    ],
    "manifest.classificationPolicy",
  );
  if (stableJson(policy.allowedDispositions) !== stableJson([...DISPOSITIONS])) {
    fail("manifest.classificationPolicy.allowedDispositions is invalid or reordered");
  }
  for (const key of ["defaultDisposition", "missingEvidenceDisposition"]) {
    if (policy[key] !== "unknown") fail(`manifest.classificationPolicy.${key} must be unknown`);
  }
  for (const key of [
    "exactSqlDigestIsRouteAuthority",
    "receiverEvidenceIsRouteAuthority",
    "unresolvedLowerEdgeIsRouteAuthority",
  ]) requiredBoolean(policy, key, false, "manifest.classificationPolicy");
  if (stableJson(manifest.riskCodeVocabulary) !== stableJson(RISK_CODES)) {
    fail("manifest.riskCodeVocabulary is incomplete or reordered");
  }
  if (stableJson(manifest.authorityBarrierVocabulary) !== stableJson(AUTHORITY_BARRIERS)) {
    fail("manifest.authorityBarrierVocabulary is incomplete or reordered");
  }
  if (stableJson(manifest.threatCodeVocabulary) !== stableJson(THREAT_CODES)) {
    fail("manifest.threatCodeVocabulary is incomplete or reordered");
  }
  if (stableJson(manifest.futurePermitPolicyVocabulary) !== stableJson(FUTURE_PERMIT_POLICIES)) {
    fail("manifest.futurePermitPolicyVocabulary is incomplete or reordered");
  }
}

function validateContextualFields(entry, candidate, label) {
  const operationKind = requiredString(entry, "operationKind", label);
  const callFamilyId = requiredString(entry, "callFamilyId", label);
  requiredString(entry, "logicalExecutionId", label);
  requiredString(entry, "resourceLifecycleId", label);
  const apiStage = requiredString(entry, "apiStage", label);
  requiredString(entry, "connectionRole", label);
  const hint = requiredString(entry, "candidateDispositionHint", label);
  if (!DISPOSITIONS.has(hint)) fail(`${label}.candidateDispositionHint is invalid`);
  if (operationKind === "unknown" && hint !== "unknown") {
    fail(`${label} cannot hint a non-unknown disposition for an unknown operation`);
  }
  if (candidate.scanner.language === "typescript") {
    if (callFamilyId !== `ts:baseline-source:${candidate.identity.line}`) {
      fail(`${label}.callFamilyId does not bind its TypeScript source expression`);
    }
    if (apiStage !== candidate.identity.method) {
      fail(`${label}.apiStage is incompatible with the TypeScript scanner method`);
    }
  } else {
    if (!callFamilyId.startsWith("py:")) fail(`${label}.callFamilyId is cross-language`);
    if (candidate.identity.method === "cursor" && apiStage !== "allocate-cursor") {
      fail(`${label}.apiStage must expose cursor allocation`);
    }
    if (candidate.identity.method === "executescript" && apiStage !== "execute-script") {
      fail(`${label}.apiStage must expose script execution`);
    }
  }
}

function validateManifestCallsite(entryValue, candidate, allCandidates, index) {
  const label = `manifest.callsites[${index}]`;
  const entry = object(entryValue, label);
  exactKeys(
    entry,
    [
      "apiStage",
      "authorityBarriers",
      "budget",
      "callFamilyId",
      "candidateDispositionHint",
      "connectionRole",
      "cursorPair",
      "disposition",
      "dynamicClosure",
      "invocationContexts",
      "language",
      "logicalExecutionId",
      "lowerNativeEdge",
      "nativeProjectionAuthority",
      "negativeFacts",
      "nonAuthorizingRole",
      "operationKind",
      "ownerCompositionExpectation",
      "parameterProvenance",
      "phase",
      "reason",
      "receiverEvidence",
      "resourceLifecycleId",
      "resourceLifecycle",
      "riskCodes",
      "routeId",
      "runtimeRouteAuthority",
      "sqlEvidence",
      "stableIdentity",
      "threatCodes",
    ],
    label,
  );
  if (entry.language !== candidate.scanner.language) fail(`${label}.language drifted from scanner`);
  validateStableIdentity(entry.stableIdentity, candidate, `${label}.stableIdentity`);
  validateReceiverEvidence(entry.receiverEvidence, expectedReceiver(candidate), `${label}.receiverEvidence`);
  validateContextualFields(entry, candidate, label);
  validateLowerNativeEdge(entry.lowerNativeEdge, candidate, allCandidates, `${label}.lowerNativeEdge`);
  const sqlEvidence = validateSqlEvidence(
    entry.sqlEvidence,
    object(candidate.scanner.callsite.sqlEvidence, "scanner SQL evidence"),
    `${label}.sqlEvidence`,
  );
  const parameterProvenance = validateParameterProvenance(
    entry.parameterProvenance,
    `${label}.parameterProvenance`,
  );
  validateNullableClaim(entry.phase, `${label}.phase`, ["value"]);
  validateNullableClaim(
    entry.ownerCompositionExpectation,
    `${label}.ownerCompositionExpectation`,
    ["owner", "composition"],
  );
  validateBudget(entry.budget, `${label}.budget`);
  validateResourceLifecycle(entry.resourceLifecycle, `${label}.resourceLifecycle`);
  const contexts = validateInvocationContexts(entry.invocationContexts, `${label}.invocationContexts`);
  const facts = validateNegativeFacts(entry.negativeFacts, `${label}.negativeFacts`);
  validateDynamicClosure(entry.dynamicClosure, sqlEvidence, `${label}.dynamicClosure`);
  validateNonAuthorizingRole(entry.nonAuthorizingRole, `${label}.nonAuthorizingRole`);
  validateCursorPair(entry.cursorPair, candidate, allCandidates, `${label}.cursorPair`);
  if (entry.routeId !== null) fail(`${label}.routeId must remain null in RM1`);
  if (entry.disposition !== "unknown") fail(`${label}.disposition must remain fail-closed unknown in RM1`);
  requiredString(entry, "reason", label);
  requiredBoolean(entry, "nativeProjectionAuthority", false, label);
  requiredBoolean(entry, "runtimeRouteAuthority", false, label);
  if (!contexts.every(({ rm1PermitAvailable }) => rm1PermitAvailable === false)) {
    fail(`${label} contains an invocation context that could issue a permit`);
  }
  if (facts.zeroParameter === true && parameterProvenance.status !== "known-zero-parameter") {
    fail(`${label}.negativeFacts.zeroParameter lacks parameter provenance`);
  }
  if (facts.noSqlRoute !== (sqlEvidence.status === "absent")) {
    fail(`${label}.negativeFacts.noSqlRoute is inconsistent with SQL evidence`);
  }
  if (facts.dynamicSqlUnclosed !== (sqlEvidence.status === "dynamic")) {
    fail(`${label}.negativeFacts.dynamicSqlUnclosed is inconsistent with SQL evidence`);
  }
  const requiredRisks = ["R9_ROUTE_AUTHORITY_ABSENT"];
  const requiredBarriers = [
    "route-disposition-unknown",
    "native-projection-authority-false",
    "runtime-route-authority-false",
  ];
  if (candidate.category === "unknown") {
    requiredRisks.push("R1_RECEIVER_UNPROVEN");
    requiredBarriers.push("receiver-unproven");
  }
  if (["unresolved", "unresolved-wrapper-edge"].includes(entry.lowerNativeEdge.status)) {
    requiredRisks.push("R2_LOWER_EDGE_UNRESOLVED");
    requiredBarriers.push("lower-native-edge-unresolved");
  }
  if (["unknown", "dynamic"].includes(sqlEvidence.status)) {
    requiredRisks.push("R3_SQL_CLOSURE_UNRESOLVED");
    requiredBarriers.push("sql-closure-unresolved");
  }
  if (parameterProvenance.status === "unresolved") {
    requiredRisks.push("R4_PARAMETERS_UNRESOLVED");
    requiredBarriers.push("parameter-provenance-unresolved");
  }
  requiredRisks.push(
    "R5_PHASE_UNRESOLVED",
    "R6_OWNER_COMPOSITION_UNRESOLVED",
    "R7_BUDGET_UNRESOLVED",
    "R8_RESOURCE_LIFECYCLE_UNRESOLVED",
  );
  requiredBarriers.push(
    "phase-unresolved",
    "owner-composition-unresolved",
    "budget-unresolved",
    "resource-lifecycle-unresolved",
  );
  validateVocabularySubset(entry.riskCodes, RISK_CODES, requiredRisks, `${label}.riskCodes`);
  validateVocabularySubset(
    entry.authorityBarriers,
    AUTHORITY_BARRIERS,
    requiredBarriers,
    `${label}.authorityBarriers`,
  );
  const requiredThreats = [];
  if (candidate.category === "wrapper-guard-or-test-like-production-probe") {
    requiredThreats.push("WRAPPER_PROVENANCE_NOT_COMPOSITION");
  }
  if (sqlEvidence.status === "exact") requiredThreats.push("DIGEST_NOT_AUTHORITY");
  if (contexts.length > 1) requiredThreats.push("CONTEXT_CONFLATION");
  if (contexts.some(({ connectionState }) => connectionState === "reopened-audit")) {
    requiredThreats.push("REOPEN_AUDIT_PERMIT_FORBIDDEN");
  }
  if (entry.cursorPair !== null) requiredThreats.push("RESOURCE_CROSS_PAIRING");
  if (entry.dynamicClosure.status.startsWith("bounded-static-")) {
    requiredThreats.push("DYNAMIC_IDENTIFIER_EXPANSION");
  }
  if ([
    "generic-sql-sink",
    "script-control-candidate",
    "summary-identity-iteration",
  ].includes(entry.operationKind)
      || entry.dynamicClosure.status === "bounded-static-assets-unresolved-route") {
    requiredThreats.push("GENERIC_SINK_ESCALATION");
  }
  if (sqlEvidence.status === "unknown"
      && !["summary-identity-iteration"].includes(entry.operationKind)) {
    requiredThreats.push("INJECTION_SEAM");
  }
  validateVocabularySubset(
    entry.threatCodes,
    THREAT_CODES,
    requiredThreats,
    `${label}.threatCodes`,
  );
  if (candidate.category === "unknown" && entry.runtimeRouteAuthority !== false) {
    fail(`${label} unknown receiver cannot gain route authority`);
  }
  return entry;
}

function computedSummary(callsites) {
  const languageCounts = {};
  const receiverCategoryCountsByLanguage = {};
  const dispositionCounts = {};
  const candidateDispositionHintCounts = {};
  const sqlStatusCounts = {};
  const lowerNativeEdgeStatusCounts = {};
  const callFamilies = new Set();
  const logicalExecutions = new Set();
  const resourceLifecycles = new Set();
  for (const callsite of callsites) {
    increment(languageCounts, callsite.language);
    const categories = receiverCategoryCountsByLanguage[callsite.language] ?? {};
    increment(categories, callsite.receiverEvidence.category);
    receiverCategoryCountsByLanguage[callsite.language] = categories;
    increment(dispositionCounts, callsite.disposition);
    increment(candidateDispositionHintCounts, callsite.candidateDispositionHint);
    increment(sqlStatusCounts, callsite.sqlEvidence.status);
    increment(lowerNativeEdgeStatusCounts, callsite.lowerNativeEdge.status);
    callFamilies.add(callsite.callFamilyId);
    logicalExecutions.add(callsite.logicalExecutionId);
    resourceLifecycles.add(callsite.resourceLifecycleId);
  }
  return {
    languageCounts,
    receiverCategoryCountsByLanguage,
    dispositionCounts,
    candidateDispositionHintCounts,
    sqlStatusCounts,
    lowerNativeEdgeStatusCounts,
    callFamilyCount: callFamilies.size,
    logicalExecutionCount: logicalExecutions.size,
    resourceLifecycleCount: resourceLifecycles.size,
  };
}

function validateLogicalEdges(callsites) {
  const families = new Map();
  const executions = new Map();
  const resources = new Map();
  const cursorPairs = new Map();
  for (const callsite of callsites) {
    const family = families.get(callsite.callFamilyId) ?? [];
    family.push(callsite);
    families.set(callsite.callFamilyId, family);
    const execution = executions.get(callsite.logicalExecutionId) ?? [];
    execution.push(callsite);
    executions.set(callsite.logicalExecutionId, execution);
    const resource = resources.get(callsite.resourceLifecycleId) ?? [];
    resource.push(callsite);
    resources.set(callsite.resourceLifecycleId, resource);
    if (callsite.cursorPair !== null) {
      const pairKey = `${callsite.cursorPair.allocationCandidateSha256}\u0000${callsite.cursorPair.executionCandidateSha256}`;
      const pair = cursorPairs.get(pairKey) ?? [];
      pair.push(callsite);
      cursorPairs.set(pairKey, pair);
    }
  }
  if (families.size !== 23 || executions.size !== 50 || resources.size !== 50) {
    fail("call-family/logical-execution/resource partition must be exactly 23/50/50");
  }
  for (const [logicalExecutionId, group] of executions) {
    if (new Set(group.map(({ language }) => language)).size !== 1) {
      fail(`logical execution ${logicalExecutionId} crosses runtime languages`);
    }
    if (new Set(group.map(({ callFamilyId }) => callFamilyId)).size !== 1) {
      fail(`logical execution ${logicalExecutionId} crosses call families`);
    }
    if (new Set(group.map(({ resourceLifecycleId }) => resourceLifecycleId)).size !== 1) {
      fail(`logical execution ${logicalExecutionId} crosses resource lifecycles`);
    }
    if (group.filter(({ runtimeRouteAuthority }) => runtimeRouteAuthority).length > 1
        || group.filter(({ nativeProjectionAuthority }) => nativeProjectionAuthority).length > 1) {
      fail(`logical execution ${logicalExecutionId} double-counts authority`);
    }
    const contextShapes = new Set(group.map(({ invocationContexts }) => stableJson(invocationContexts)));
    // Cursor allocation and execution deliberately have different lexical
    // contexts. Other multi-candidate logical executions must share one context
    // set so a candidate cannot be moved between operating states.
    if (contextShapes.size > 1 && !group.every(({ cursorPair }) => cursorPair !== null)) {
      fail(`logical execution ${logicalExecutionId} crosses invocation contexts`);
    }
    if (group.length > 1
        && !group.every(({ threatCodes }) => threatCodes.includes("API_STAGE_DOUBLE_COUNT"))) {
      fail(`logical execution ${logicalExecutionId} lacks API-stage double-count threat coverage`);
    }
    if (group.length === 1
        && group[0].threatCodes.includes("API_STAGE_DOUBLE_COUNT")) {
      fail(`logical execution ${logicalExecutionId} has spurious API-stage double-count threat coverage`);
    }
  }
  for (const [resourceLifecycleId, group] of resources) {
    if (new Set(group.map(({ language }) => language)).size !== 1
        || new Set(group.map(({ callFamilyId }) => callFamilyId)).size !== 1
        || new Set(group.map(({ logicalExecutionId }) => logicalExecutionId)).size !== 1) {
      fail(`resource lifecycle ${resourceLifecycleId} crosses language, family, or logical execution`);
    }
  }
  if (cursorPairs.size !== 6) fail("cursor pairing must contain exactly six logical pairs");
  for (const [pairKey, pair] of cursorPairs) {
    if (pair.length !== 2
        || new Set(pair.map(({ logicalExecutionId }) => logicalExecutionId)).size !== 1
        || new Set(pair.map(({ resourceLifecycleId }) => resourceLifecycleId)).size !== 1
        || pair.filter(({ apiStage }) => apiStage === "allocate-cursor").length !== 1
        || pair.filter(({ apiStage }) => apiStage === "execute-on-allocated-cursor").length !== 1
        || !pair.every(({ threatCodes }) => threatCodes.includes("RESOURCE_CROSS_PAIRING"))) {
      fail(`cursor pair ${pairKey} is incomplete, duplicated, or cross-paired`);
    }
  }
}

export function buildSQLiteNativeCallsiteRouteMap(
  scannerReport,
  classifierReport,
  manifestValue,
  rootInput,
) {
  if (typeof rootInput !== "string" || rootInput.length === 0) {
    fail("build requires the repository root used by scanner and classifier evidence");
  }
  const sourceRoot = canonicalRoot(rootInput);
  const scannerCandidates = validateScannerReport(scannerReport);
  const python = validateClassifierReport(classifierReport, scannerCandidates);
  const typescript = typescriptCandidates(scannerCandidates);
  const allCandidates = new Map([...typescript, ...python]);
  if (allCandidates.size !== 457) fail("cross-language candidate identities are not globally unique");

  const expected = [...allCandidates.values()]
    .filter(({ identity }) => identity.path === TYPESCRIPT_SOURCE || identity.path === PYTHON_SOURCE)
    .sort((left, right) => compareIdentities(left.identity, right.identity));
  const expectedLanguageCounts = Object.fromEntries(["python", "typescript"].map((language) => [
    language,
    expected.filter(({ scanner }) => scanner.language === language).length,
  ]));
  if (expected.length !== EXPECTED_TOTAL
      || stableJson(expectedLanguageCounts) !== stableJson(EXPECTED_COUNTS)) {
    fail("scanner/classifier source scope is not exactly 18 TypeScript plus 47 Python candidates");
  }

  const manifest = object(manifestValue, "manifest");
  validateManifestPreamble(manifest, sourceRoot);
  const rawCallsites = array(manifest.callsites, "manifest.callsites");
  if (rawCallsites.length !== expected.length) fail("manifest must contain exactly 65 callsites");
  const seen = new Set();
  const callsites = rawCallsites.map((entryValue, index) => {
    const raw = object(entryValue, `manifest.callsites[${index}]`);
    const stable = object(raw.stableIdentity, `manifest.callsites[${index}].stableIdentity`);
    const candidateId = requiredString(stable, "candidateSha256", `manifest.callsites[${index}].stableIdentity`);
    if (seen.has(candidateId)) fail(`duplicate manifest candidate ${candidateId}`);
    seen.add(candidateId);
    const candidate = allCandidates.get(candidateId);
    if (!candidate) fail(`manifest candidate ${candidateId} is outside scanner/classifier evidence`);
    if (candidateId !== expected[index].candidateId) {
      fail(`manifest.callsites[${index}] is missing, reordered, or from the wrong source scope`);
    }
    return validateManifestCallsite(raw, candidate, allCandidates, index);
  });
  if (seen.size !== EXPECTED_TOTAL) fail("manifest/scanner join is not one-to-one");
  validateLogicalEdges(callsites);
  const summary = computedSummary(callsites);
  if (stableJson(manifest.summary) !== stableJson(summary)) fail("manifest.summary is stale or incomplete");
  const canonicalManifestSha256 = sha256(stableJson(manifest));
  if (canonicalManifestSha256 !== MANIFEST_CANONICAL_SHA256) {
    fail("manifest does not match the independently frozen RM1 evidence matrix");
  }

  return {
    schemaVersion: 1,
    contractId: "sqlite-native-callsite-route-map-p11-a-rm1-v1",
    sourceManifest: {
      contractId: manifest.contractId,
      sha256: canonicalManifestSha256,
      sourceImplementationCommit: manifest.sourceImplementationCommit,
    },
    policy: {
      exactSqlDigestIsRouteAuthority: false,
      nativeProjectionAuthority: false,
      receiverEvidenceIsRouteAuthority: false,
      routeAuthorization: false,
      routeClosureClaimed: false,
      runtimeRouteAuthority: false,
      unknownCandidatesDropped: false,
    },
    summary,
    callsites: JSON.parse(JSON.stringify(callsites)),
    nativeProjectionAuthority: false,
    routeClosureClaimed: false,
    runtimeRouteAuthority: false,
  };
}

function canonicalRoot(directory) {
  const resolved = path.resolve(directory);
  let root;
  try {
    root = fs.realpathSync(resolved);
  } catch (error) {
    throw new Error(`Route-map repository root is unavailable: ${resolved}: ${error.message}`, {
      cause: error,
    });
  }
  if (!fs.statSync(root).isDirectory()) fail("repository root must be a directory");
  return root;
}

function manifestPath(root, relative) {
  if (typeof relative !== "string" || relative.length === 0 || path.isAbsolute(relative)) {
    fail("manifest path must be a non-empty repository-relative path");
  }
  const normalized = path.normalize(relative);
  if (normalized !== relative || normalized === "." || normalized === "..") {
    fail("manifest path must use canonical repository-relative spelling");
  }
  const resolved = path.resolve(root, relative);
  const relation = path.relative(root, resolved);
  if (path.isAbsolute(relation) || relation === ".." || relation.startsWith(`..${path.sep}`)) {
    fail("manifest path escapes the repository root");
  }
  let canonical;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (error) {
    throw new Error(`Route-map manifest is unavailable: ${relative}: ${error.message}`, {
      cause: error,
    });
  }
  if (canonical !== resolved || !fs.statSync(canonical).isFile()) {
    fail("manifest must be a canonical regular nonsymlink file");
  }
  return canonical;
}

function decodeCleanJsonProcess(result, label) {
  if (result.error) {
    throw new Error(`${label} spawn failed: ${result.error.message}`, { cause: result.error });
  }
  if (result.signal !== null && result.signal !== undefined) {
    fail(`${label} was terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) fail(`${label} exited ${String(result.status)}: ${result.stderr || result.stdout}`);
  if (typeof result.stderr !== "string" || result.stderr.length !== 0) {
    fail(`${label} wrote stderr`);
  }
  if (typeof result.stdout !== "string" || !result.stdout.endsWith("\n")
      || result.stdout.match(/\n/gu)?.length !== 1) {
    fail(`${label} must emit exactly one newline-terminated JSON record`);
  }
  let decoded;
  try {
    decoded = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} emitted invalid JSON: ${error.message}`, { cause: error });
  }
  if (result.stdout !== `${JSON.stringify(decoded)}\n`) fail(`${label} JSON must be canonical`);
  return { decoded, stdout: result.stdout };
}

function runJsonTwice(command, args, options, label, spawn = spawnSync) {
  const first = decodeCleanJsonProcess(spawn(command, args, options), `${label} first run`);
  const second = decodeCleanJsonProcess(spawn(command, args, options), `${label} second run`);
  if (first.stdout !== second.stdout) fail(`${label} output is not byte deterministic`);
  return first.decoded;
}

export function loadSQLiteNativeCallsiteRouteMapInputs(
  rootInput,
  manifestRelative,
  spawn = spawnSync,
) {
  const root = canonicalRoot(rootInput);
  const manifestFile = manifestPath(root, manifestRelative);
  const processOptions = {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  };
  const scannerPath = path.join(root, "tools/sqlite-native-callsite-discovery.mjs");
  const reporterPath = path.join(
    root,
    "python/tests/sqlite_native_callsite_classification_report.py",
  );
  const scannerReport = runJsonTwice(
    process.execPath,
    ["--no-warnings", scannerPath, "--root", root],
    processOptions,
    "SQLite native callsite scanner",
    spawn,
  );
  const classifierReport = runJsonTwice(
    "uv",
    ["run", "--project", "python", "python", reporterPath],
    processOptions,
    "Python SQLite callsite classifier",
    spawn,
  );
  let bytes;
  try {
    bytes = fs.readFileSync(manifestFile);
  } catch (error) {
    throw new Error(`Route-map manifest cannot be read: ${error.message}`, { cause: error });
  }
  if (sha256(bytes) !== MANIFEST_RAW_SHA256) {
    fail("manifest file bytes do not match the frozen RM1 fixture SHA-256");
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`Route-map manifest is invalid JSON: ${error.message}`, { cause: error });
  }
  return { classifierReport, manifest, root, scannerReport };
}

function parseArguments(argv) {
  const options = {
    manifest: "spec/sqlite-cursor-publication-owner-composition-p11.callsites.json",
    pretty: false,
    root: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") options.root = argv[++index];
    else if (argument === "--manifest") options.manifest = argv[++index];
    else if (argument === "--pretty") options.pretty = true;
    else fail(`unknown argument ${argument}`);
  }
  if (typeof options.root !== "string" || typeof options.manifest !== "string") {
    fail("--root and --manifest require values");
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const inputs = loadSQLiteNativeCallsiteRouteMapInputs(options.root, options.manifest);
  const report = buildSQLiteNativeCallsiteRouteMap(
    inputs.scannerReport,
    inputs.classifierReport,
    inputs.manifest,
    inputs.root,
  );
  process.stdout.write(`${JSON.stringify(report, null, options.pretty ? 2 : 0)}\n`);
}
