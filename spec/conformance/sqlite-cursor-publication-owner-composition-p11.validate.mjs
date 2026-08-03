import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ROUTES_PATH = path.join(
  ROOT,
  "spec/sqlite-cursor-publication-owner-composition-p11.routes.json",
);
const STAGES_PATH = path.join(
  ROOT,
  "spec/sqlite-cursor-publication-owner-composition-p11.stages.json",
);
const MARKDOWN_PATH = path.join(
  ROOT,
  "spec/sqlite-cursor-publication-owner-composition-p11.md",
);
const OWNER_CASE_PATH = path.join(
  ROOT,
  "spec/conformance/sqlite-cursor-publication-transaction-owner-v1.case.json",
);
const SHA256 = /^[0-9a-f]{64}$/u;
const ROUTES_CANONICAL_SHA256 =
  "2424d6a1e049f2d7515d343684fe96b72c6f5fa3e327e68224e218257aa04c09";
const STAGES_CANONICAL_SHA256 =
  "3d0aa8aba16f779f1ba1addc53ab01756a535ce653d22a4449ae757f6dfe7f1e";
const MARKDOWN_RAW_SHA256 =
  "a8e9ff2a3941edb08f56b2bd9556b99a89c9a8913c89bff03b5ebd084e0f2a32";
const SUPPORTED_MUTATION_COUNT_POLICIES = [
  ["b2.cursor-seal-table-ddl", { kind: "exact", expectedCount: 1 }],
  ["main.migration-0002", { kind: "exact", expectedCount: 20 }],
  ["main.baseline-entries", {
    kind: "bounded-dynamic",
    minimum: 0,
    maximum: 1_024,
    requiresFutureExactCountProvenance: true,
    zeroIsOnlyShapeUntilReceipt: true,
  }],
  ["main.baseline-header", { kind: "exact", expectedCount: 1 }],
  ["main.operation-sequence-zero", { kind: "exact", expectedCount: 1 }],
  ["main.cursor-rebind", { kind: "exact", expectedCount: 1 }],
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function unique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assertShaValues(value, trail = "fixture") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertShaValues(entry, `${trail}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (/sha256$/iu.test(key)) {
        const values = Array.isArray(entry) ? entry : [entry];
        for (const digest of values) {
          assert.equal(
            typeof digest === "string" && SHA256.test(digest),
            true,
            `${trail}.${key} must contain lowercase SHA-256 values`,
          );
        }
      } else {
        assertShaValues(entry, `${trail}.${key}`);
      }
    }
  }
}

function validateRoutes(routes, { repoRoot = ROOT } = {}) {
  assert.equal(
    sha256(stableJson(routes)),
    ROUTES_CANONICAL_SHA256,
    "route inventory must remain the exact frozen canonical object",
  );
  assert.equal(routes.schemaVersion, 1);
  assert.equal(
    routes.contractId,
    "sqlite-cursor-publication-owner-composition-p11-routes-v1",
  );
  assert.equal(routes.status, "p11-a-redbar-contract");
  assert.deepEqual(routes.normativePlanSections, ["31.37.81", "31.37.82", "31.37.84"]);
  assert.equal(routes.inventoryPolicy.defaultClassification, "forbidden");
  assert.equal(routes.inventoryPolicy.unknownRoute, "reject-before-native-io");
  for (const field of [
    "callerSuppliedRouteId",
    "callerSuppliedSql",
    "callerSuppliedDigest",
    "callerSuppliedCallback",
    "multiStatementSql",
  ]) assert.equal(routes.inventoryPolicy[field], false, `${field} must remain disabled`);

  const classifications = routes.classifications.map(({ id }) => id);
  assert.deepEqual(classifications, [
    "pre-registration",
    "public-harmless-select",
    "authenticated-fixed-read",
    "scoped-mutation",
    "forbidden",
  ]);
  unique(classifications, "classifications");

  const routeGroups = [
    routes.preRegistrationRoutes,
    routes.publicHarmlessSelectRoutes,
    routes.b2MutationRoutes,
    [routes.migration0002Route],
    routes.permanentMutationRoutes,
    routes.fixedReadRoutes.base,
  ];
  const routeIds = routeGroups.flat().map(({ id }) => id);
  unique(routeIds, "route IDs");
  for (const route of routeGroups.flat()) {
    assert.equal(classifications.includes(route.classification), true, `${route.id} classification`);
  }

  assert.equal(routes.migration0002Route.expectedCount, 20);
  assert.equal(routes.migration0002Route.statementSqlSha256.length, 20);
  assert.equal(routes.migration0002Route.model, "child-owned-one-shot");
  assert.equal(routes.permanentMutationRoutes.length, 4);
  for (const route of routes.b2MutationRoutes) {
    assert.equal(
      ["child-owned-one-shot", "parent-owned-reusable"].includes(route.model),
      true,
      `${route.id} must bind one exact resource model`,
    );
  }
  assert.equal(
    routes.permanentMutationRoutes.find(({ id }) => id === "main.baseline-entries")?.model,
    "parent-owned-reusable",
  );
  const supportedMutationRoutes = [
    routes.b2MutationRoutes.find(({ id }) => id === "b2.cursor-seal-table-ddl"),
    routes.migration0002Route,
    ...routes.permanentMutationRoutes,
  ];
  assert.equal(supportedMutationRoutes.every((route) => route !== undefined), true);
  assert.deepEqual(
    supportedMutationRoutes.map(({ id, countPolicy }) => [id, countPolicy]),
    SUPPORTED_MUTATION_COUNT_POLICIES,
    "all six P11-A supported mutation descriptors must retain their exact count policy",
  );
  unique(supportedMutationRoutes.map(({ id }) => id), "P11-A supported mutation descriptors");

  const b2Eqp = routes.fixedReadRoutes.b2EqpSet;
  const rule12Eqp = routes.fixedReadRoutes.rule12EqpSet;
  assert.equal(b2Eqp.expectedCount, 15);
  assert.equal(b2Eqp.routeIds.length, 15);
  assert.equal(b2Eqp.sqlSha256.length, 15);
  assert.equal(rule12Eqp.expectedCount, 3);
  assert.equal(rule12Eqp.routeIds.length, 3);
  assert.equal(rule12Eqp.sqlSha256.length, 3);
  unique(b2Eqp.routeIds, "B2 EQP route IDs");
  unique(rule12Eqp.routeIds, "Rule12 EQP route IDs");
  assert.equal(
    b2Eqp.routeIds.some((routeId) => rule12Eqp.routeIds.includes(routeId)),
    false,
    "B2 and Rule12 EQP route IDs must remain disjoint",
  );

  assert.deepEqual(routes.acceptanceAssertions, {
    b2EqpProbeCount: 15,
    rule12EqpProbeCount: 3,
    eqpSetsAreDisjointByRouteId: true,
    missingOrDuplicateEqpRouteRejected: true,
    unknownRouteRejectedBeforeNativeIo: true,
    fakeZeroCanCompleteWithoutExactCountReceipt: false,
    failedOrPoisonedGraphCanMintDropPermit: false,
    commitAttemptCount: 0,
  });
  assert.equal(routes.sourceInventory.routeClosureClaimedByThisArtifact, false);
  assert.equal(routes.sourceInventory.unclassifiedCallsiteCountRequiredForAcceptance, 0);
  assert.equal(
    routes.sourceInventory.discoveryEvidence.observedActualUnclassifiedNativeCallsiteCount,
    null,
  );
  assert.equal(routes.sourceInventory.discoveryEvidence.importedModuleGlobalStringCandidateCount, 81);
  assert.equal(routes.sourceInventory.discoveryEvidence.importedModuleGlobalUniqueCandidateCount, 60);
  assert.equal(routes.sourceInventory.discoveryEvidence.qualifyingExactFixedSqlLiteralCount, 59);
  for (const runtime of ["typescript", "python"]) {
    const files = routes.sourceInventory[runtime];
    unique(files, `${runtime} source inventory`);
    for (const file of files) {
      assert.equal(fs.statSync(path.join(repoRoot, file)).isFile(), true, `missing ${file}`);
    }
  }
  assertShaValues(routes, "routes");
  return routes;
}

function validateStages(stages, ownerCase) {
  assert.equal(
    sha256(stableJson(stages)),
    STAGES_CANONICAL_SHA256,
    "stage inventory must remain the exact frozen canonical object",
  );
  assert.equal(stages.schemaVersion, 1);
  assert.equal(
    stages.contractId,
    "sqlite-cursor-publication-owner-composition-p11-stages-v1",
  );
  assert.equal(stages.status, "p11-a-redbar-contract");
  assert.equal(stages.stageCount, 30);
  assert.equal(stages.stages.length, 30);
  const ordinals = stages.stages.map(({ ordinal }) => ordinal);
  assert.deepEqual(ordinals, Array.from({ length: 30 }, (_value, index) => index + 1));
  const stageIds = stages.stages.map(({ id }) => id);
  unique(stageIds, "stage IDs");
  assert.deepEqual(stageIds, ownerCase.dependencyContract.atomicPublicationOrder);
  stages.stages.forEach((stage, index) => {
    assert.equal(stage.requiredPredecessor, index === 0 ? null : stages.stages[index - 1].id);
    if (stage.ordinal <= 17) {
      assert.equal(stage.successMintCount, 1);
      assert.equal(stage.successConsumeCount, 1);
      assert.equal(["P11-B", "P11-C", "P11-D"].includes(stage.sliceOwner), true);
      assert.equal(
        stage.sliceOwner,
        stage.ordinal <= 4 ? "P11-B" : stage.ordinal <= 11 ? "P11-C" : "P11-D",
      );
    } else {
      assert.equal(stage.sliceOwner, "POST-P11");
      assert.equal(stage.p11MintCount, 0);
      assert.equal(stage.p11ConsumeCount, 0);
      assert.equal(stage.p11Accepted, false);
    }
  });

  assert.deepEqual(
    stages.slices.map(({ id, acceptedStageOrdinals, maximumAcceptedStage }) => ({
      acceptedStageOrdinals,
      id,
      maximumAcceptedStage,
    })),
    [
      { id: "P11-A", acceptedStageOrdinals: [], maximumAcceptedStage: 0 },
      { id: "P11-B", acceptedStageOrdinals: [1, 2, 3, 4], maximumAcceptedStage: 4 },
      { id: "P11-C", acceptedStageOrdinals: [5, 6, 7, 8, 9, 10, 11], maximumAcceptedStage: 11 },
      { id: "P11-D", acceptedStageOrdinals: [12, 13, 14, 15, 16, 17], maximumAcceptedStage: 17 },
    ],
  );
  assert.deepEqual(
    stages.mutationParentChildContract.zeroExpectedCount["child-owned-one-shot"],
    [
      "prove-exact-zero-provenance",
      "mint-no-child",
      "zero-item-postflight",
      "parent-complete",
      "parent-consumed",
    ],
  );
  assert.deepEqual(stages.compositionAdoption.order, [
    "authenticate-owner-and-begin-receipt",
    "construct-all-immutable-objects",
    "register-composition-and-exact-owner-receipt-binding",
    "mark-receipt-composition-pending",
    "owner-state-one-way-adopt",
    "composition-begin-adopted",
  ]);
  assert.deepEqual(
    stages.compositionAdoption.faultPoints.map(({ id }) => id),
    ["registration-fault", "binding-fault", "pending-fault", "owner-adopt-fault"],
  );
  assert.deepEqual(stages.fixedReadContract.states, [
    "issued",
    "prepared",
    "bounded-reading",
    "terminal-row-observed",
    "resource-retired",
    "consumed",
  ]);
  assert.equal(stages.failureContract.pythonCapture, "exact-original-BaseException-identity");
  assert.equal(stages.failureContract.observationUnavailableStillClosesAndReopens, true);
  assert.equal(stages.boundedStop.usesP9FailureCaptureAndFinalizer, true);
  assert.equal(stages.boundedStop.oneShot, true);
  assert.deepEqual(stages.p11ARedGates, [
    "early-failure-cannot-report-stage-17",
    "migration-20-child-permits-and-postflight-failure-edge",
    "n-row-child-permits-and-zero-expected-count",
    "owner-active-fixed-pragma-and-b2-eqp-read-zero-mutation",
    "typescript-and-python-retirement-evidence-is-not-fabricated",
    "python-original-baseexception-and-observation-unavailable-cleanup",
    "poisoned-graph-mints-no-drop-authority",
    "route-and-stage-inventory-is-closed-with-unknown-fail-closed",
    "bounded-stop-reuses-exact-p9-failure-authority",
    "composition-registration-binding-pending-owner-adopt-faults-are-atomic",
  ]);
  const claimedOrdinals = stages.slices.flatMap(({ acceptedStageOrdinals }) => acceptedStageOrdinals);
  unique(claimedOrdinals, "slice-owned ordinals");
  assert.deepEqual(claimedOrdinals, Array.from({ length: 17 }, (_value, index) => index + 1));

  assert.deepEqual(stages.auxiliaryTerminalEvidence, {
    id: "third-clock-observed-unconsumed",
    afterStageOrdinal: 17,
    partOfThirtyStageInventory: false,
    observedCount: 3,
    consumedCount: 2,
    thirdEvidenceConsumed: false,
    stage18Accepted: false,
  });
  assert.equal(stages.reportContract.p11DSuccess.highestAcceptedStage, 17);
  assert.equal(stages.reportContract.p11DSuccess.thirdEvidenceConsumed, false);
  assert.equal(stages.reportContract.p11DSuccess.commitPresented, false);
  assert.equal(stages.reportContract.p11DSuccess.commitAttemptCount, 0);
  assert.equal(stages.reportContract.stage18MustRemainFalse, true);
  assert.equal(stages.failureContract.postPoisonDropPermitAllowed, false);
  assert.deepEqual(stages.failureContract.limits, {
    commit: 0,
    rollbackMaximum: 1,
    closeMaximum: 1,
    reopenMaximum: 1,
  });
  assert.deepEqual(
    stages.mutationParentChildContract.zeroExpectedCount["parent-owned-reusable"],
    [
      "prove-exact-zero-provenance",
      "prepare-once",
      "mint-no-child",
      "zero-item-postflight",
      "awaiting-parent-resource-retirement",
      "parent-resource-retired",
      "parent-complete",
      "parent-consumed",
    ],
  );
  assert.equal(stages.boundedStop.createsThirdRollbackAuthority, false);
  assert.equal(stages.nonClaims.includes("single-atomic-commit"), true);
  assert.equal(stages.nonClaims.includes("release-or-stars"), true);
  return stages;
}

function validateMarkdown(markdownText) {
  assert.equal(sha256(markdownText), MARKDOWN_RAW_SHA256, "P11 Markdown bytes must remain frozen");
  for (const required of [
    "Status: **P11-A redbar contract**",
    "thirdEvidenceConsumed=false",
    "commitAttemptCount=0",
    "B2 EQP set: exactly 15",
    "R12 EQP set: exactly 3",
    "requiresFutureExactCountProvenance=true",
    "zeroIsOnlyShapeUntilReceipt=true",
    "dynamicCountProvenance=false",
    "nativeSourceProvenance=false",
    "genuineZeroClaim=false",
    "confirmed-native-receiver",
    "routeClosureClaimed=false",
    "fake-zero completion claim",
    "The exact original Python primary is re-raised",
    "It must not be cited as P11 completion.",
  ]) assert.equal(markdownText.includes(required), true, `missing Markdown invariant: ${required}`);
}

export function validateP11Contract({ markdownText, routes, stages, ownerCase, repoRoot = ROOT }) {
  validateMarkdown(markdownText);
  validateRoutes(routes, { repoRoot });
  validateStages(stages, ownerCase);
  return {
    b2EqpProbeCount: routes.fixedReadRoutes.b2EqpSet.routeIds.length,
    routeClosureClaimed: routes.sourceInventory.routeClosureClaimedByThisArtifact,
    rule12EqpProbeCount: routes.fixedReadRoutes.rule12EqpSet.routeIds.length,
    stageCount: stages.stages.length,
    supportedMutationDescriptorCount: SUPPORTED_MUTATION_COUNT_POLICIES.length,
  };
}

export function loadP11Contract() {
  return {
    markdownText: fs.readFileSync(MARKDOWN_PATH, "utf8"),
    ownerCase: readJson(OWNER_CASE_PATH),
    routes: readJson(ROUTES_PATH),
    stages: readJson(STAGES_PATH),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = validateP11Contract(loadP11Contract());
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}
