import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scanRepository } from "../../tools/sqlite-native-callsite-discovery.mjs";
import {
  loadP11CallsiteMap,
  validateP11CallsiteMap,
} from "./sqlite-cursor-publication-owner-composition-p11-callsite-map.validate.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PYTHON_REPORTER = fileURLToPath(new URL(
  "../../python/tests/sqlite_native_callsite_classification_report.py",
  import.meta.url,
));

function pythonReport() {
  const result = spawnSync(
    "uv",
    ["run", "--project", "python", "python", PYTHON_REPORTER],
    { cwd: ROOT, encoding: "utf8", timeout: 90_000, maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function mutatedFixture() {
  return structuredClone(loadP11CallsiteMap().manifest);
}

function validateMutation(manifest) {
  return validateP11CallsiteMap({
    rawText: `${JSON.stringify(manifest)}\n`,
    manifest,
    enforceFrozenHashes: false,
  });
}

test("frozen RM1 map is a live one-to-one 20+50 scanner/classifier join", () => {
  const summary = validateP11CallsiteMap({
    ...loadP11CallsiteMap(),
    scannerReport: scanRepository({ root: ROOT }),
    pythonReport: pythonReport(),
  });
  assert.deepEqual(summary, {
    callFamilyCount: 23,
    logicalExecutionCount: 50,
    routeClosureClaimed: false,
    scopedCallsiteCount: 70,
  });
});

test("raw and canonical fixture drift fail closed", () => {
  const fixture = loadP11CallsiteMap();
  assert.throws(
    () => validateP11CallsiteMap({ ...fixture, rawText: ` ${fixture.rawText}` }),
    /raw bytes drifted/u,
  );
  const manifest = structuredClone(fixture.manifest);
  manifest.status = "forged";
  assert.throws(
    () => validateP11CallsiteMap({ rawText: fixture.rawText, manifest }),
    /canonical object drifted/u,
  );
});

test("route, projection, and runtime authority cannot be smuggled into RM1", () => {
  for (const mutation of [
    (manifest) => { manifest.callsites[0].disposition = "authenticated-fixed-read"; },
    (manifest) => { manifest.callsites[0].routeId = "read.forged"; },
    (manifest) => { manifest.callsites[0].nativeProjectionAuthority = true; },
    (manifest) => { manifest.callsites[0].runtimeRouteAuthority = true; },
    (manifest) => { manifest.callsites[0].invocationContexts[0].rm1PermitAvailable = true; },
  ]) {
    const manifest = mutatedFixture();
    mutation(manifest);
    assert.throws(() => validateMutation(manifest));
  }
});

test("identity deletion duplication source drift and execution collapse fail closed", () => {
  const deleted = mutatedFixture();
  deleted.callsites.pop();
  assert.throws(() => validateMutation(deleted));

  const duplicated = mutatedFixture();
  duplicated.callsites[1].stableIdentity.candidateSha256 =
    duplicated.callsites[0].stableIdentity.candidateSha256;
  assert.throws(() => validateMutation(duplicated));

  const sourceDrift = mutatedFixture();
  sourceDrift.scope.sourceFiles[0].sourceBlobSha256 = "0".repeat(64);
  assert.throws(() => validateMutation(sourceDrift));

  const collapsed = mutatedFixture();
  const audit = collapsed.callsites.filter(({ operationKind }) => operationKind === "reopen-audit-read");
  audit[1].logicalExecutionId = audit[0].logicalExecutionId;
  audit[1].resourceLifecycleId = audit[0].resourceLifecycleId;
  assert.throws(() => validateMutation(collapsed));
});

test("cursor allocation execution identity and retirement uncertainty cannot cross-pair", () => {
  const manifest = mutatedFixture();
  const pairs = manifest.callsites.filter(({ cursorPair }) => cursorPair !== null);
  pairs[0].cursorPair.executionCandidateSha256 = pairs[2].cursorPair.executionCandidateSha256;
  assert.throws(() => validateMutation(manifest));

  const retirement = mutatedFixture();
  const paired = retirement.callsites.find(({ cursorPair }) => cursorPair !== null);
  paired.cursorPair.terminalRetirement = { status: "proven", value: "forged" };
  assert.throws(() => validateMutation(retirement));
});

test("context split, closure digests, role threats and barriers are mandatory", () => {
  const context = mutatedFixture();
  const shared = context.callsites.find(({ stableIdentity }) => stableIdentity.line === 5817);
  shared.invocationContexts[1].futurePermitPolicy = "never";
  assert.throws(() => validateMutation(context));

  const closure = mutatedFixture();
  const family = closure.callsites.find(({ stableIdentity }) => stableIdentity.line === 5323);
  family.dynamicClosure.expansionSqlSha256.pop();
  assert.throws(() => validateMutation(closure));

  const threat = mutatedFixture();
  const wrapper = threat.callsites.find(({ language, receiverEvidence }) =>
    language === "typescript"
    && receiverEvidence.category === "wrapper-guard-or-test-like-production-probe");
  wrapper.threatCodes = wrapper.threatCodes.filter(
    (code) => code !== "WRAPPER_PROVENANCE_NOT_COMPOSITION",
  );
  assert.throws(() => validateMutation(threat));

  const barrier = mutatedFixture();
  barrier.callsites[0].authorityBarriers = barrier.callsites[0].authorityBarriers.filter(
    (code) => code !== "runtime-route-authority-false",
  );
  assert.throws(() => validateMutation(barrier));
});
