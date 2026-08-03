import assert from "node:assert/strict";
import test from "node:test";

import {
  loadP11Contract,
  validateP11Contract,
} from "./sqlite-cursor-publication-owner-composition-p11.validate.mjs";

const canonical = loadP11Contract();
const clone = (value) => structuredClone(value);

test("P11 route and stage inventories validate as an honest redbar contract", () => {
  assert.deepEqual(validateP11Contract(canonical), {
    b2EqpProbeCount: 15,
    routeClosureClaimed: false,
    rule12EqpProbeCount: 3,
    stageCount: 30,
  });
});

test("B2 15 and Rule12 3 EQP inventories cannot be merged, omitted, or duplicated", () => {
  const missing = clone(canonical);
  missing.routes.fixedReadRoutes.b2EqpSet.routeIds.pop();
  assert.throws(() => validateP11Contract(missing));

  const duplicate = clone(canonical);
  duplicate.routes.fixedReadRoutes.rule12EqpSet.routeIds[2] =
    duplicate.routes.fixedReadRoutes.rule12EqpSet.routeIds[1];
  assert.throws(() => validateP11Contract(duplicate));

  const merged = clone(canonical);
  merged.routes.fixedReadRoutes.rule12EqpSet.routeIds[0] =
    merged.routes.fixedReadRoutes.b2EqpSet.routeIds[0];
  assert.throws(() => validateP11Contract(merged));
});

test("stage predecessor drift, overlap, and stage 18 acceptance fail closed", () => {
  const predecessor = clone(canonical);
  predecessor.stages.stages[11].requiredPredecessor = predecessor.stages.stages[9].id;
  assert.throws(() => validateP11Contract(predecessor));

  const overlap = clone(canonical);
  overlap.stages.slices[3].acceptedStageOrdinals.unshift(11);
  assert.throws(() => validateP11Contract(overlap));

  const stage18 = clone(canonical);
  stage18.stages.stages[17].p11Accepted = true;
  assert.throws(() => validateP11Contract(stage18));
});

test("COMMIT, third-consume, route-closure, and reusable-zero forgeries fail closed", () => {
  const commit = clone(canonical);
  commit.stages.reportContract.p11DSuccess.commitAttemptCount = 1;
  assert.throws(() => validateP11Contract(commit));

  const third = clone(canonical);
  third.stages.auxiliaryTerminalEvidence.thirdEvidenceConsumed = true;
  assert.throws(() => validateP11Contract(third));

  const closure = clone(canonical);
  closure.routes.sourceInventory.routeClosureClaimedByThisArtifact = true;
  assert.throws(() => validateP11Contract(closure));

  const zero = clone(canonical);
  zero.stages.mutationParentChildContract.zeroExpectedCount[
    "parent-owned-reusable"
  ].splice(4, 2);
  assert.throws(() => validateP11Contract(zero));
});

test("exact routes, red gates, slice owners, sources, and Markdown cannot drift", () => {
  for (const mutate of [
    (candidate) => { candidate.routes.fixedReadRoutes.b2EqpSet.sqlSha256[0] = "0".repeat(64); },
    (candidate) => { candidate.routes.b2MutationRoutes.reverse(); },
    (candidate) => { candidate.routes.preRegistrationRoutes.pop(); },
    (candidate) => { candidate.routes.sourceInventory.typescript.pop(); },
    (candidate) => { candidate.stages.p11ARedGates.pop(); },
    (candidate) => { candidate.stages.stages[3].sliceOwner = "P11-C"; },
    (candidate) => { candidate.stages.boundedStop.usesP9FailureCaptureAndFinalizer = false; },
    (candidate) => { candidate.markdownText = candidate.markdownText.replace("COMMIT", "commit"); },
  ]) {
    const candidate = clone(canonical);
    mutate(candidate);
    assert.throws(() => validateP11Contract(candidate));
  }
});
