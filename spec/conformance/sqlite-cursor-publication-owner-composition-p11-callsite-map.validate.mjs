import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scanRepository } from "../../tools/sqlite-native-callsite-discovery.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MANIFEST_PATH = path.join(
  ROOT,
  "spec/sqlite-cursor-publication-owner-composition-p11.callsites.json",
);
const PYTHON_REPORTER = path.join(
  ROOT,
  "python/tests/sqlite_native_callsite_classification_report.py",
);
const RAW_SHA256 = "16d7514e1fa9995c64c55132844b295c671af8fdc611df8c247261c2d61bf8c7";
const CANONICAL_SHA256 = "85e05220c392c31af0d3a947185250c59913f05bd22fb1c0332310c0137a4364";
const SHA256 = /^[0-9a-f]{64}$/u;
const TS_PATH = "packages/sqlite/src/operation-baseline-source.ts";
const PY_PATH = "python/src/graph_engineering/sqlite_operation_baseline_source.py";
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
const SOURCE_HASHES = new Map([
  [TS_PATH, "d112fb088039a0ed139eeb15e63dabd0a011fc3cf45f24ec0c8cfd1f47be6b68"],
  [PY_PATH, "74ea2f6e81f29973a2bbb3a720c7ebf1efdea46cbf51b1cb76c4ad14fea69f3b"],
]);
const CURSOR_FAMILIES = new Set([
  "py:post-ddl-reader",
  "py:baseline-entry-publication",
  "py:baseline-header-publication",
  "py:operation-sequence-zero",
  "py:migration-0002-statement-cursor",
  "py:migration-0002-next-statement",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function compareCodePoints(left, right) {
  const a = [...left];
  const b = [...right];
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const delta = a[index].codePointAt(0) - b[index].codePointAt(0);
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareCodePoints).map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function exactKeys(value, expected, label) {
  assert.deepEqual(Object.keys(value).sort(compareCodePoints), [...expected].sort(compareCodePoints), label);
}

function identityKey(value) {
  return stableJson({
    path: value.path,
    line: value.line,
    column: value.column,
    method: value.method,
    sqlOrigin: value.sqlOrigin,
  });
}

function counts(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => compareCodePoints(left, right)));
}

function validateDynamicClosure(callsite) {
  const closure = callsite.dynamicClosure;
  exactKeys(closure, [
    "status", "source", "cardinality", "quoting", "assetOrdinal", "digestKind",
    "sourceAssetSha256", "expansionSqlSha256", "componentContract",
  ], "dynamicClosure keys");
  assert.equal(Array.isArray(closure.expansionSqlSha256), true);
  assert.equal(closure.expansionSqlSha256.every((digest) => SHA256.test(digest)), true);
  assert.equal(new Set(closure.expansionSqlSha256).size, closure.expansionSqlSha256.length);
  assert.equal(closure.sourceAssetSha256 === null || SHA256.test(closure.sourceAssetSha256), true);
  if (closure.digestKind === "sql-expansion") assert.equal(closure.expansionSqlSha256.length, 1);
  if (closure.digestKind === "sql-expansion-set") {
    assert.equal(closure.cardinality, closure.expansionSqlSha256.length);
  }
  if (closure.digestKind === "source-asset") {
    assert.equal(SHA256.test(closure.sourceAssetSha256), true);
    assert.equal(closure.expansionSqlSha256.length, 0);
  }
  if (closure.digestKind === "none") {
    assert.equal(closure.sourceAssetSha256, null);
    assert.equal(closure.expansionSqlSha256.length, 0);
  }
}

function validateCallsite(callsite) {
  exactKeys(callsite, [
    "language", "stableIdentity", "receiverEvidence", "operationKind", "apiStage",
    "connectionRole", "candidateDispositionHint", "lowerNativeEdge", "sqlEvidence",
    "parameterProvenance", "phase", "ownerCompositionExpectation", "budget",
    "resourceLifecycle", "routeId", "disposition", "reason",
    "nativeProjectionAuthority", "runtimeRouteAuthority", "callFamilyId",
    "logicalExecutionId", "resourceLifecycleId", "invocationContexts", "negativeFacts",
    "dynamicClosure", "nonAuthorizingRole", "riskCodes", "authorityBarriers",
    "cursorPair", "threatCodes",
  ], "callsite keys");
  const identity = callsite.stableIdentity;
  exactKeys(identity, [
    "path", "line", "column", "method", "sqlOrigin", "occurrence",
    "scannerSha256", "candidateSha256",
  ], "identity keys");
  assert.equal(SHA256.test(identity.scannerSha256), true);
  assert.equal(SHA256.test(identity.candidateSha256), true);
  assert.equal(identity.occurrence, 0);
  assert.equal(
    identity.scannerSha256,
    sha256(stableJson({
      path: identity.path,
      line: identity.line,
      column: identity.column,
      method: identity.method,
      sqlOrigin: identity.sqlOrigin,
    })),
  );
  if (callsite.language === "python") {
    assert.equal(identity.candidateSha256, sha256(stableJson({
      path: identity.path,
      line: identity.line,
      column: identity.column,
      method: identity.method,
      sqlOrigin: identity.sqlOrigin,
      occurrence: identity.occurrence,
    })));
  } else {
    assert.equal(identity.candidateSha256, identity.scannerSha256);
  }
  assert.equal(callsite.disposition, "unknown");
  assert.equal(callsite.routeId, null);
  assert.equal(callsite.nativeProjectionAuthority, false);
  assert.equal(callsite.runtimeRouteAuthority, false);
  assert.equal(callsite.reason.length > 20, true);
  assert.equal(callsite.riskCodes.includes("R9_ROUTE_AUTHORITY_ABSENT"), true);
  assert.equal(callsite.authorityBarriers.includes("route-disposition-unknown"), true);
  assert.equal(callsite.authorityBarriers.includes("native-projection-authority-false"), true);
  assert.equal(callsite.authorityBarriers.includes("runtime-route-authority-false"), true);
  assert.equal(callsite.riskCodes.every((code) => RISK_CODES.includes(code)), true);
  assert.equal(callsite.threatCodes.every((code) => THREAT_CODES.includes(code)), true);
  assert.equal(callsite.authorityBarriers.every((code) => AUTHORITY_BARRIERS.includes(code)), true);
  if (callsite.operationKind === "generic-sql-sink") {
    assert.equal(callsite.threatCodes.includes("GENERIC_SINK_ESCALATION"), true);
  }
  if (callsite.sqlEvidence.status === "exact") {
    assert.equal(callsite.threatCodes.includes("DIGEST_NOT_AUTHORITY"), true);
  }
  if (callsite.receiverEvidence.category === "wrapper-guard-or-test-like-production-probe") {
    assert.equal(callsite.threatCodes.includes("WRAPPER_PROVENANCE_NOT_COMPOSITION"), true);
  }
  if (callsite.invocationContexts.length > 1) {
    assert.equal(callsite.threatCodes.includes("CONTEXT_CONFLATION"), true);
  }
  if (callsite.cursorPair !== null) {
    assert.equal(callsite.threatCodes.includes("API_STAGE_DOUBLE_COUNT"), true);
    assert.equal(callsite.threatCodes.includes("RESOURCE_CROSS_PAIRING"), true);
  }
  if (callsite.dynamicClosure.status.startsWith("bounded-static-")) {
    assert.equal(callsite.threatCodes.includes("DYNAMIC_IDENTIFIER_EXPANSION"), true);
  }
  if (callsite.invocationContexts.some(({ connectionState }) => connectionState === "reopened-audit")) {
    assert.equal(callsite.threatCodes.includes("REOPEN_AUDIT_PERMIT_FORBIDDEN"), true);
  }
  assert.equal(callsite.invocationContexts.length > 0, true);
  for (const context of callsite.invocationContexts) {
    exactKeys(context, ["id", "connectionState", "rm1PermitAvailable", "futurePermitPolicy"], "context keys");
    assert.equal(context.rm1PermitAvailable, false);
    assert.equal(["never", "requires-context-split", "requires-closed-leaf"].includes(context.futurePermitPolicy), true);
  }
  assert.deepEqual(callsite.nonAuthorizingRole, {
    id: callsite.nonAuthorizingRole.id,
    inventoryEvidenceOnly: true,
    mayIssuePermit: false,
    mayMintNativeProjection: false,
    mayAuthorizeRuntimeRoute: false,
  });
  validateDynamicClosure(callsite);
}

function validateSemanticGroups(callsites) {
  assert.equal(new Set(callsites.map(({ callFamilyId }) => callFamilyId)).size, 23);
  assert.equal(new Set(callsites.map(({ logicalExecutionId }) => logicalExecutionId)).size, 50);
  assert.equal(new Set(callsites.map(({ resourceLifecycleId }) => resourceLifecycleId)).size, 50);
  const tsFamilies = Map.groupBy(callsites.filter(({ language }) => language === "typescript"), ({ callFamilyId }) => callFamilyId);
  assert.equal(tsFamilies.size, 9);
  for (const family of tsFamilies.values()) {
    assert.equal(family.length, 2);
    assert.equal(new Set(family.map(({ logicalExecutionId }) => logicalExecutionId)).size, 1);
    assert.equal(family.filter(({ apiStage }) => apiStage === "prepare").length, 1);
    assert.equal(family.filter(({ apiStage }) => apiStage === "get" || apiStage === "iterate").length, 1);
    assert.equal(family.every(({ threatCodes }) => threatCodes.includes("API_STAGE_DOUBLE_COUNT")), true);
  }
  for (const familyId of CURSOR_FAMILIES) {
    const family = callsites.filter(({ callFamilyId }) => callFamilyId === familyId);
    assert.equal(family.length, 2);
    const allocation = family.find(({ operationKind }) => operationKind === "cursor-allocation");
    const execution = family.find(({ operationKind }) => operationKind === "cursor-execution-sink");
    assert.ok(allocation);
    assert.ok(execution);
    const expectedPair = {
      status: "unresolved-binding",
      allocationCandidateSha256: allocation.stableIdentity.candidateSha256,
      executionCandidateSha256: execution.stableIdentity.candidateSha256,
      connectionGeneration: { status: "unresolved", value: null },
      connectionIdentity: { status: "unresolved", value: null },
      terminalRetirement: { status: "unresolved", value: null },
    };
    assert.deepEqual(allocation.cursorPair, expectedPair);
    assert.deepEqual(execution.cursorPair, expectedPair);
    assert.equal(allocation.logicalExecutionId, execution.logicalExecutionId);
    assert.equal(allocation.resourceLifecycleId, execution.resourceLifecycleId);
  }
  assert.deepEqual(
    callsites.filter(({ candidateDispositionHint }) => candidateDispositionHint === "forbidden").map(({ stableIdentity }) => stableIdentity.line),
    [4278, 4388],
  );
  const audit = callsites.filter(({ operationKind }) => operationKind === "reopen-audit-read");
  assert.deepEqual(audit.map(({ stableIdentity }) => stableIdentity.line), [4505, 4506, 4507, 4508, 4509, 4510]);
  assert.equal(new Set(audit.map(({ logicalExecutionId }) => logicalExecutionId)).size, 6);
  const shared = callsites.filter(({ stableIdentity: { line } }) => line >= 5586 && line <= 5743);
  for (const callsite of shared) {
    assert.deepEqual(callsite.invocationContexts.map(({ connectionState, futurePermitPolicy }) => [connectionState, futurePermitPolicy]), [
      ["inactive-owner", "never"],
      ["active-owner", "requires-context-split"],
      ["reopened-audit", "never"],
    ]);
    assert.equal(callsite.threatCodes.includes("CONTEXT_CONFLATION"), true);
  }
  for (const line of [3012, 3243, 3501, 3756, 4004, 4104]) {
    const callsite = callsites.find(({ stableIdentity }) => stableIdentity.line === line);
    assert.equal(callsite.dynamicClosure.cardinality, 1);
    assert.equal(callsite.dynamicClosure.expansionSqlSha256.length, line === 3012 ? 0 : 1);
    assert.equal(callsite.threatCodes.includes("INJECTION_SEAM"), true);
  }
  for (const line of [5317, 5355]) {
    const callsite = callsites.find(({ stableIdentity }) => stableIdentity.line === line);
    assert.equal(callsite.dynamicClosure.cardinality, 12);
    assert.equal(callsite.dynamicClosure.expansionSqlSha256.length, 12);
    assert.deepEqual(callsite.dynamicClosure.componentContract, ["kind", "sql", "decoder", "fetch"]);
  }
  const migration = callsites.find(({ stableIdentity }) => stableIdentity.line === 4186);
  assert.equal(migration.dynamicClosure.cardinality, 20);
  assert.equal(migration.dynamicClosure.assetOrdinal, "required-1-through-20");
  assert.equal(migration.dynamicClosure.expansionSqlSha256.length, 20);
  const requiredTables = callsites.find(({ stableIdentity }) => stableIdentity.line === 5656);
  assert.equal(requiredTables.dynamicClosure.cardinality, 13);
  assert.equal(requiredTables.dynamicClosure.digestKind, "source-asset");
  for (const line of [5725, 6425]) {
    const callsite = callsites.find(({ stableIdentity }) => stableIdentity.line === line);
    assert.equal(callsite.dynamicClosure.cardinality, 12);
    assert.equal(callsite.dynamicClosure.source, "_TABLES-frozen-12");
  }
  assert.deepEqual(new Set(callsites.flatMap(({ riskCodes }) => riskCodes)), new Set(RISK_CODES));
  assert.deepEqual(new Set(callsites.flatMap(({ threatCodes }) => threatCodes)), new Set(THREAT_CODES));
}

function validateLiveJoin(manifest, scannerReport, pythonReport) {
  assert.equal(scannerReport.summary.callsiteCount, 457);
  assert.equal(scannerReport.routeClosureClaimed, false);
  const scoped = scannerReport.callsites.filter(({ path: sourcePath }) => sourcePath === TS_PATH || sourcePath === PY_PATH);
  assert.equal(scoped.length, 65);
  const scannerByKey = new Map(scoped.map((callsite) => [identityKey(callsite), callsite]));
  const pythonByKey = new Map(pythonReport.candidates.filter(({ identity }) => identity.path === PY_PATH)
    .map((callsite) => [identityKey(callsite.identity), callsite]));
  assert.equal(pythonByKey.size, 47);
  for (const entry of manifest.callsites) {
    const key = identityKey(entry.stableIdentity);
    const scanner = scannerByKey.get(key);
    assert.ok(scanner, `missing live scanner identity ${key}`);
    assert.equal(entry.stableIdentity.scannerSha256, scanner.stableIdentity.sha256);
    assert.deepEqual(entry.sqlEvidence, {
      status: scanner.sqlEvidence.status,
      shape: scanner.sqlEvidence.shape,
      sha256: scanner.sqlEvidence.sha256 ?? null,
      token: scanner.sqlEvidence.token ?? null,
    });
    if (entry.language === "typescript") {
      assert.equal(entry.receiverEvidence.category, scanner.typescriptClassification.disposition);
      assert.equal(entry.receiverEvidence.reason, scanner.typescriptClassification.receiverEvidence);
    } else {
      const classified = pythonByKey.get(key);
      assert.ok(classified, `missing live Python identity ${key}`);
      assert.equal(entry.stableIdentity.candidateSha256, classified.candidateId);
      assert.equal(entry.receiverEvidence.category, classified.category);
      assert.equal(entry.receiverEvidence.reason, classified.reason);
    }
  }
}

export function validateP11CallsiteMap({
  rawText,
  manifest,
  scannerReport,
  pythonReport,
  repoRoot = ROOT,
  enforceFrozenHashes = true,
}) {
  if (enforceFrozenHashes) {
    assert.equal(sha256(rawText), RAW_SHA256, "callsite-map raw bytes drifted");
    assert.equal(sha256(stableJson(manifest)), CANONICAL_SHA256, "callsite-map canonical object drifted");
  }
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.contractId, "sqlite-cursor-publication-owner-composition-p11-callsites-v1");
  assert.equal(manifest.status, "p11-a-rm1-inventory-only");
  assert.equal(manifest.sourceImplementationCommit, "90fae463db5ef3097cf4b21ff4e07517edfbebd0");
  assert.equal(manifest.scope.scopedCallsiteCount, 65);
  assert.equal(manifest.scope.globalScannerCallsiteCount, 457);
  assert.deepEqual(
    [manifest.scope.routeAuthorization, manifest.scope.routeClosureClaimed, manifest.scope.nativeProjectionAuthority, manifest.scope.runtimeRouteAuthority, manifest.scope.unknownCandidatesDropped],
    [false, false, false, false, false],
  );
  for (const source of manifest.scope.sourceFiles) {
    assert.equal(source.sourceBlobSha256, SOURCE_HASHES.get(source.path));
    const absolute = path.join(repoRoot, source.path);
    assert.equal(fs.lstatSync(absolute).isSymbolicLink(), false);
    assert.equal(fs.statSync(absolute).isFile(), true);
    assert.equal(sha256(fs.readFileSync(absolute)), source.sourceBlobSha256);
  }
  assert.deepEqual(manifest.riskCodeVocabulary, RISK_CODES);
  assert.deepEqual(manifest.threatCodeVocabulary, THREAT_CODES);
  assert.deepEqual(manifest.authorityBarrierVocabulary, AUTHORITY_BARRIERS);
  assert.deepEqual(manifest.futurePermitPolicyVocabulary, ["never", "requires-context-split", "requires-closed-leaf"]);
  assert.equal(manifest.callsites.length, 65);
  manifest.callsites.forEach(validateCallsite);
  assert.equal(new Set(manifest.callsites.map(({ stableIdentity }) => stableIdentity.candidateSha256)).size, 65);
  assert.deepEqual(counts(manifest.callsites.map(({ language }) => language)), { python: 47, typescript: 18 });
  assert.deepEqual(counts(manifest.callsites.map(({ disposition }) => disposition)), { unknown: 65 });
  validateSemanticGroups(manifest.callsites);
  if (scannerReport !== undefined || pythonReport !== undefined) {
    assert.ok(scannerReport);
    assert.ok(pythonReport);
    validateLiveJoin(manifest, scannerReport, pythonReport);
  }
  return { callFamilyCount: 23, logicalExecutionCount: 50, routeClosureClaimed: false, scopedCallsiteCount: 65 };
}

export function loadP11CallsiteMap() {
  const rawText = fs.readFileSync(MANIFEST_PATH, "utf8");
  return { rawText, manifest: JSON.parse(rawText) };
}

function runPythonReporter() {
  const result = spawnSync("uv", ["run", "--project", "python", "python", PYTHON_REPORTER], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 90_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, `Python reporter spawn error: ${String(result.error)}`);
  assert.equal(result.signal, null, `Python reporter signal: ${String(result.signal)}`);
  assert.equal(result.status, 0, `Python reporter exit ${String(result.status)}: ${result.stderr}`);
  assert.equal(result.stderr, "", "Python reporter wrote stderr");
  return JSON.parse(result.stdout);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = validateP11CallsiteMap({
    ...loadP11CallsiteMap(),
    scannerReport: scanRepository({ root: ROOT }),
    pythonReport: runPythonReporter(),
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
