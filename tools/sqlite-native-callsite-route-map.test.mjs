import assert from "node:assert/strict";
import test, { before } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildSQLiteNativeCallsiteRouteMap,
  loadSQLiteNativeCallsiteRouteMapInputs,
} from "./sqlite-native-callsite-route-map.mjs";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const MANIFEST = "spec/sqlite-cursor-publication-owner-composition-p11.callsites.json";

let inputs;

before(() => {
  inputs = loadSQLiteNativeCallsiteRouteMapInputs(REPOSITORY_ROOT, MANIFEST);
}, { timeout: 180_000 });

function cloneManifest() {
  return structuredClone(inputs.manifest);
}

function build(manifest = inputs.manifest) {
  return buildSQLiteNativeCallsiteRouteMap(
    inputs.scannerReport,
    inputs.classifierReport,
    manifest,
    inputs.root,
  );
}

function expectRejected(mutator, pattern) {
  const manifest = cloneManifest();
  mutator(manifest);
  assert.throws(() => build(manifest), pattern);
}

test("RM1 joins the exact 18+47 source scope and is byte deterministic", () => {
  const first = build();
  const second = build();
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
  assert.equal(first.callsites.length, 65);
  assert.deepEqual(first.summary.languageCounts, { typescript: 18, python: 47 });
  assert.deepEqual(first.summary.receiverCategoryCountsByLanguage, {
    typescript: { "wrapper-guard-or-test-like-production-probe": 18 },
    python: {
      "confirmed-native-receiver": 32,
      unknown: 9,
      "wrapper-guard-or-test-like-production-probe": 6,
    },
  });
  assert.deepEqual(first.summary.dispositionCounts, { unknown: 65 });
  assert.equal(first.summary.callFamilyCount, 23);
  assert.equal(first.summary.logicalExecutionCount, 50);
  assert.equal(first.summary.resourceLifecycleCount, 50);
  assert.equal(first.routeClosureClaimed, false);
  assert.equal(first.runtimeRouteAuthority, false);
  assert.equal(first.nativeProjectionAuthority, false);
  assert.deepEqual(first.policy, {
    exactSqlDigestIsRouteAuthority: false,
    nativeProjectionAuthority: false,
    receiverEvidenceIsRouteAuthority: false,
    routeAuthorization: false,
    routeClosureClaimed: false,
    runtimeRouteAuthority: false,
    unknownCandidatesDropped: false,
  });
  assert.equal(new Set(first.callsites.map((entry) =>
    entry.stableIdentity.candidateSha256)).size, 65);
  assert.equal(first.callsites.every(({ disposition, nativeProjectionAuthority, routeId, runtimeRouteAuthority }) =>
    disposition === "unknown"
    && nativeProjectionAuthority === false
    && routeId === null
    && runtimeRouteAuthority === false), true);
});

test("RM1 builder requires the scanner/classifier repository root", () => {
  assert.throws(
    () => buildSQLiteNativeCallsiteRouteMap(
      inputs.scannerReport,
      inputs.classifierReport,
      inputs.manifest,
    ),
    /requires the repository root used by scanner and classifier evidence/u,
  );
});

test("RM1 rejects missing, duplicate, reordered, and drifted identities", () => {
  expectRejected(
    (manifest) => manifest.callsites.pop(),
    /exactly 65 callsites/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[64] = structuredClone(manifest.callsites[0]); },
    /duplicate manifest candidate|missing, reordered/u,
  );
  expectRejected(
    (manifest) => { [manifest.callsites[0], manifest.callsites[1]] = [manifest.callsites[1], manifest.callsites[0]]; },
    /missing, reordered/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].stableIdentity.line += 1; },
    /drifted from joined identity/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].stableIdentity.scannerSha256 = "0".repeat(64); },
    /drifted from scanner/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[18].stableIdentity.candidateSha256 = "0".repeat(64); },
    /outside scanner\/classifier evidence/u,
  );
});

test("RM1 requires every route-shape field and exact scanner/classifier evidence", () => {
  expectRejected(
    (manifest) => { delete manifest.callsites[0].operationKind; },
    /fields must be exactly/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].receiverEvidence.category = "confirmed-native-receiver"; },
    /drifted from receiver classifier/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[18].receiverEvidence.reason = "name heuristic"; },
    /drifted from receiver classifier/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].sqlEvidence.status = "exact"; },
    /drifted from scanner evidence/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[2].dynamicClosure.cardinality = 2; },
    /closure is inconsistent|cannot claim/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].parameterProvenance.source = "caller"; },
    /must be null for unresolved|must bind known zero parameters/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].budget.row.maximum = 1; },
    /must be null for unknown/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].resourceLifecycle.states = ["open"]; },
    /empty while unresolved/u,
  );
});

test("RM1 lower edges are singular, same-language, and category compatible", () => {
  const pythonNative = inputs.manifest.callsites.find(({ language, receiverEvidence }) =>
    language === "python" && receiverEvidence.category === "confirmed-native-receiver");
  assert.ok(pythonNative);
  expectRejected(
    (manifest) => {
      manifest.callsites[0].lowerNativeEdge.status = "unique-lower-native-receiver";
      manifest.callsites[0].lowerNativeEdge.targetCandidateSha256 =
        pythonNative.stableIdentity.candidateSha256;
    },
    /same runtime language/u,
  );
  expectRejected(
    (manifest) => {
      manifest.callsites[0].lowerNativeEdge.targetCandidateSha256 = [
        pythonNative.stableIdentity.candidateSha256,
      ];
    },
    /null or a lowercase SHA-256/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[18].lowerNativeEdge.targetCandidateSha256 = null; },
    /confirmed native candidate itself exactly once/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[19].lowerNativeEdge.status = "self-native-receiver"; },
    /cannot assert a lower native edge/u,
  );
});

test("RM1 never promotes unknown inventory into runtime or projection authority", () => {
  const unknownIndex = inputs.manifest.callsites.findIndex(({ receiverEvidence }) =>
    receiverEvidence.category === "unknown");
  assert.notEqual(unknownIndex, -1);
  expectRejected(
    (manifest) => { manifest.callsites[unknownIndex].runtimeRouteAuthority = true; },
    /runtimeRouteAuthority must be false/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[unknownIndex].nativeProjectionAuthority = true; },
    /nativeProjectionAuthority must be false/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[unknownIndex].disposition = "authenticated-fixed-read"; },
    /disposition must remain fail-closed unknown/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[unknownIndex].routeId = "invented.route"; },
    /routeId must remain null/u,
  );
  expectRejected(
    (manifest) => { manifest.scope.routeClosureClaimed = true; },
    /routeClosureClaimed must be false/u,
  );
  expectRejected(
    (manifest) => { manifest.scope.nativeProjectionAuthority = true; },
    /nativeProjectionAuthority must be false/u,
  );
});

test("RM1 rejects family, stage, scope, source-blob, and summary drift", () => {
  expectRejected(
    (manifest) => { manifest.callsites[0].callFamilyId = "ts:baseline-source:256"; },
    /does not bind its TypeScript source expression/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].apiStage = "prepare"; },
    /incompatible with the TypeScript scanner method/u,
  );
  const pythonCursorIndex = inputs.manifest.callsites.findIndex(({ language, stableIdentity }) =>
    language === "python" && stableIdentity.method === "cursor");
  expectRejected(
    (manifest) => { manifest.callsites[pythonCursorIndex].apiStage = "execute"; },
    /must expose cursor allocation/u,
  );
  expectRejected(
    (manifest) => { manifest.scope.sourceFiles[0].expectedCallsiteCount = 19; },
    /exact ordered 18\+47 source scope/u,
  );
  expectRejected(
    (manifest) => { manifest.scope.sourceFiles[0].sourceBlobSha256 = "0".repeat(64); },
    /exact ordered 18\+47 source scope/u,
  );
  expectRejected(
    (manifest) => { manifest.summary.callFamilyCount += 1; },
    /summary is stale or incomplete/u,
  );
});

test("RM1 rejects permit and non-authorizing-role escalation", () => {
  expectRejected(
    (manifest) => { manifest.callsites[0].invocationContexts[0].rm1PermitAvailable = true; },
    /rm1PermitAvailable must be false/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].nonAuthorizingRole.mayIssuePermit = true; },
    /mayIssuePermit must be false/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].nonAuthorizingRole.mayMintNativeProjection = true; },
    /mayMintNativeProjection must be false/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].nonAuthorizingRole.mayAuthorizeRuntimeRoute = true; },
    /mayAuthorizeRuntimeRoute must be false/u,
  );
});

test("RM1 requires complete, unique risk, barrier, and threat coverage", () => {
  expectRejected(
    (manifest) => {
      manifest.callsites[0].riskCodes = manifest.callsites[0].riskCodes
        .filter((code) => code !== "R9_ROUTE_AUTHORITY_ABSENT");
    },
    /missing required code R9_ROUTE_AUTHORITY_ABSENT/u,
  );
  expectRejected(
    (manifest) => {
      manifest.callsites[0].authorityBarriers = manifest.callsites[0].authorityBarriers
        .filter((code) => code !== "route-disposition-unknown");
    },
    /missing required code route-disposition-unknown/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].riskCodes.push("NOT_A_RISK"); },
    /contains an unknown code/u,
  );
  expectRejected(
    (manifest) => {
      manifest.callsites[0].authorityBarriers.push(manifest.callsites[0].authorityBarriers[0]);
    },
    /must not contain duplicates/u,
  );
  const wrapperIndex = inputs.manifest.callsites.findIndex(({ receiverEvidence }) =>
    receiverEvidence.category === "wrapper-guard-or-test-like-production-probe");
  expectRejected(
    (manifest) => {
      manifest.callsites[wrapperIndex].threatCodes = manifest.callsites[wrapperIndex].threatCodes
        .filter((code) => code !== "WRAPPER_PROVENANCE_NOT_COMPOSITION");
    },
    /missing required code WRAPPER_PROVENANCE_NOT_COMPOSITION/u,
  );
  const exactIndex = inputs.manifest.callsites.findIndex(({ sqlEvidence }) =>
    sqlEvidence.status === "exact");
  expectRejected(
    (manifest) => {
      manifest.callsites[exactIndex].threatCodes = manifest.callsites[exactIndex].threatCodes
        .filter((code) => code !== "DIGEST_NOT_AUTHORITY");
    },
    /missing required code DIGEST_NOT_AUTHORITY/u,
  );
});

test("RM1 rejects logical-execution, resource, and cursor cross-pairing", () => {
  expectRejected(
    (manifest) => { manifest.callsites[0].logicalExecutionId = manifest.callsites[2].logicalExecutionId; },
    /partition must be exactly|crosses call families/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[0].resourceLifecycleId = manifest.callsites[2].resourceLifecycleId; },
    /partition must be exactly|crosses resource lifecycles/u,
  );
  const cursorIndexes = inputs.manifest.callsites
    .map((entry, index) => entry.cursorPair === null ? -1 : index)
    .filter((index) => index >= 0);
  assert.equal(cursorIndexes.length, 12);
  const firstPair = inputs.manifest.callsites[cursorIndexes[0]].cursorPair;
  const otherExecution = inputs.manifest.callsites
    .find(({ cursorPair }) => cursorPair !== null
      && cursorPair.executionCandidateSha256 !== firstPair.executionCandidateSha256)
    .cursorPair.executionCandidateSha256;
  expectRejected(
    (manifest) => {
      manifest.callsites[cursorIndexes[0]].cursorPair.executionCandidateSha256 = otherExecution;
    },
    /does not contain its owning candidate|crosses invocation contexts|exactly six logical pairs|incomplete, duplicated, or cross-paired/u,
  );
  expectRejected(
    (manifest) => { manifest.callsites[cursorIndexes[0]].cursorPair = null; },
    /crosses invocation contexts|exactly six logical pairs|incomplete, duplicated, or cross-paired/u,
  );
});

test("RM1 requires threat coverage at execution, resource, dynamic, and context boundaries", () => {
  const multiExecutionIndex = inputs.manifest.callsites.findIndex(({ threatCodes }) =>
    threatCodes.includes("API_STAGE_DOUBLE_COUNT"));
  expectRejected(
    (manifest) => {
      manifest.callsites[multiExecutionIndex].threatCodes =
        manifest.callsites[multiExecutionIndex].threatCodes
          .filter((code) => code !== "API_STAGE_DOUBLE_COUNT");
    },
    /lacks API-stage double-count threat coverage/u,
  );
  const cursorIndex = inputs.manifest.callsites.findIndex(({ cursorPair }) => cursorPair !== null);
  expectRejected(
    (manifest) => {
      manifest.callsites[cursorIndex].threatCodes = manifest.callsites[cursorIndex].threatCodes
        .filter((code) => code !== "RESOURCE_CROSS_PAIRING");
    },
    /missing required code RESOURCE_CROSS_PAIRING/u,
  );
  const contextIndex = inputs.manifest.callsites.findIndex(({ invocationContexts }) =>
    invocationContexts.length > 1);
  expectRejected(
    (manifest) => {
      manifest.callsites[contextIndex].threatCodes = manifest.callsites[contextIndex].threatCodes
        .filter((code) => code !== "CONTEXT_CONFLATION");
    },
    /missing required code CONTEXT_CONFLATION/u,
  );
  const dynamicIndex = inputs.manifest.callsites.findIndex(({ dynamicClosure }) =>
    dynamicClosure.status.startsWith("bounded-static-"));
  expectRejected(
    (manifest) => {
      manifest.callsites[dynamicIndex].threatCodes = manifest.callsites[dynamicIndex].threatCodes
        .filter((code) => code !== "DYNAMIC_IDENTIFIER_EXPANSION");
    },
    /missing required code DYNAMIC_IDENTIFIER_EXPANSION/u,
  );
});
