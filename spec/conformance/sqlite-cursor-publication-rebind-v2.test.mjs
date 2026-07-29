import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CursorPublicationContractError,
  loadCursorPublicationFixture,
  parseStrictJson,
  validateCanonicalCursorPublicationFixture,
  validateCursorPublicationFixture,
} from "./sqlite-cursor-publication-rebind-v2.validate.mjs";

const FIXTURE_DIGEST_DOMAIN =
  "graph-engineering/sqlite-cursor-publication-rebind-v2-fixture/v1\0";

function cloneFixture() { return structuredClone(loadCursorPublicationFixture()); }
function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new TypeError("unpaired high surrogate");
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      throw new TypeError("unpaired low surrogate");
    }
  }
  return value;
}
function compareUnicodeCodePointSequences(left, right) {
  const leftIterator = left[Symbol.iterator]();
  const rightIterator = right[Symbol.iterator]();
  while (true) {
    const leftEntry = leftIterator.next();
    const rightEntry = rightIterator.next();
    if (leftEntry.done || rightEntry.done) {
      if (leftEntry.done && rightEntry.done) return 0;
      return leftEntry.done ? -1 : 1;
    }
    const difference = leftEntry.value.codePointAt(0) - rightEntry.value.codePointAt(0);
    if (difference !== 0) return difference;
  }
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    for (const key of keys) assertUnicodeScalarString(key);
    return Object.fromEntries(keys.sort(compareUnicodeCodePointSequences)
      .map((key) => [key, canonicalize(value[key])]));
  }
  if (typeof value === "string") return assertUnicodeScalarString(value);
  return value;
}
function domainSeparatedCanonicalDigest(domain, value) {
  return createHash("sha256").update(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from(JSON.stringify(canonicalize(value)), "utf8"),
  ])).digest("hex");
}
function resignFixture(fixture) {
  fixture.parityGates.fixtureCanonicalSha256 = "0".repeat(64);
  fixture.parityGates.fixtureCanonicalSha256 =
    domainSeparatedCanonicalDigest(FIXTURE_DIGEST_DOMAIN, fixture);
}
function expectFailure(mutator) {
  const fixture = cloneFixture();
  mutator(fixture);
  assert.throws(
    () => validateCursorPublicationFixture(fixture),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA",
  );
}
function mutatePath(value, path, mutation) {
  const parent = path.slice(0, -1).reduce((current, key) => current[key], value);
  const key = path.at(-1);
  parent[key] = mutation(parent[key]);
}
function expectResignedFailure(mutator) {
  const fixture = cloneFixture();
  mutator(fixture);
  resignFixture(fixture);
  assert.throws(
    () => validateCursorPublicationFixture(fixture),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA",
  );
}

test("B3 freezes an unimplemented cursor subprotocol inside one atomic v1-to-v2 migration", () => {
  assert.deepEqual(validateCanonicalCursorPublicationFixture(), {
    ok: true,
    id: "sqlite-cursor-publication-rebind-v2",
    status: "contract-frozen",
    taskId: "SQLITE-CURSOR-B3-PUBLICATION-REBIND",
    stageCount: 23,
    ruleCount: 2,
    hostileObligationCount: 145,
    hostileExecutionRecordCount: 145,
    faultBoundaryCount: 20,
    targetDescriptorHash: "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92",
    targetSchemaIdentitySha256: "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634",
    fixtureCanonicalSha256: "32ebd363838ac9aa5c0d3573aa31b1f45244ca469ec248f7c906ff08d3c08993",
    implementationClaim: false,
    activeManifestClaim: false,
  });
});

test("B3 canonical JSON orders keys by Unicode code point rather than UTF-16", () => {
  const value = { "😀": "non-bmp", "\uE000": "bmp-private-use" };
  assert.equal(
    JSON.stringify(canonicalize(value)),
    "{\"\":\"bmp-private-use\",\"😀\":\"non-bmp\"}",
  );
  assert.deepEqual(Object.keys(canonicalize(value)), ["\uE000", "😀"]);
  assert.throws(() => canonicalize({ "\uD800": "unpaired-key" }), /unpaired high surrogate/u);
  assert.throws(() => canonicalize("\uDC00"), /unpaired low surrogate/u);
});

test("B3 rejects release, implementation and active-manifest claim inflation", () => {
  expectFailure((fixture) => { fixture.claims.implementationClaim = true; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.claims.releaseGate = true; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.claims.activeManifestClaim = true; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 forbids a standalone rebind commit or transaction ownership", () => {
  expectFailure((fixture) => { fixture.boundary.standaloneCommitAllowed = true; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.boundary.ownsTransactionCommands = true; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.boundary.acceptedPermanentIntermediateStates.push("rebound-v1"); }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 freezes source, target and migration identities", () => {
  expectFailure((fixture) => { fixture.identities.source.descriptorHash = "0".repeat(64); }, "GE_CURSOR_B3_SOURCE_IDENTITY");
  expectFailure((fixture) => { fixture.identities.target.descriptorHash = "0".repeat(64); }, "GE_CURSOR_B3_TARGET_IDENTITY");
  expectFailure((fixture) => { fixture.identities.migration.sqlSha256 = "0".repeat(64); }, "GE_CURSOR_B3_MIGRATION_IDENTITY");
});

test("B3 freezes the complete atomic migration order", () => {
  expectFailure((fixture) => {
    [fixture.sequence.orderedStages[3], fixture.sequence.orderedStages[8]] =
      [fixture.sequence.orderedStages[8], fixture.sequence.orderedStages[3]];
  }, "GE_CURSOR_B3_SEQUENCE");
});

test("B3 freezes rule 11 before rule 12", () => {
  expectFailure((fixture) => { fixture.rules.reverse(); }, "GE_CURSOR_B3_RULE_ORDER");
  expectFailure((fixture) => { fixture.rules[0].position = 12; }, "GE_CURSOR_B3_RULE_ORDER");
});

test("B3 freezes fixed module-owned rebind SQL and parameter order", () => {
  expectFailure((fixture) => { fixture.sqlContract.rebind.sql += " "; }, "GE_CURSOR_B3_FIXTURE_HASH");
  expectFailure((fixture) => { fixture.sqlContract.rebind.sql += " OR 1=1"; }, "GE_CURSOR_B3_SQL_LITERAL");
  expectFailure((fixture) => { fixture.sqlContract.rebind.parameterOrder.reverse(); }, "GE_CURSOR_B3_PARAMETER_ORDER");
});

test("B3 post-rebind proof drives fresh main point lookups without a sorter", () => {
  expectFailure((fixture) => {
    fixture.sqlContract.postRebindKeyDriver.sql = fixture.sqlContract.postRebindKeyDriver.sql
      .replace("token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
        "tenant_id COLLATE BINARY, token_hash COLLATE BINARY");
  }, "GE_CURSOR_B3_SQL_LITERAL");
  expectFailure((fixture) => { fixture.sealContract.source = "b2-temp-carrier"; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 permits only the two manifest-bound mutable identities", () => {
  expectFailure((fixture) => { fixture.sealContract.mutableFields.push("expires_at_ms"); }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    [fixture.sealContract.immutablePhysicalFields[0], fixture.sealContract.immutablePhysicalFields[1]] =
      [fixture.sealContract.immutablePhysicalFields[1], fixture.sealContract.immutablePhysicalFields[0]];
  }, "GE_CURSOR_B3_IMMUTABLE_FIELDS");
});

test("B3 freezes exact-object authority and opaque single-use publication session", () => {
  expectFailure((fixture) => { fixture.authority.requiredExactObjects.reverse(); }, "GE_CURSOR_B3_AUTHORITY_GRAPH");
  expectFailure((fixture) => { fixture.authority.publicationSession.cloneRejected = false; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.authority.migrationLock.mustBeUnexpiredAtProviderClock = false; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.authority.migrationLock.mustBeReprovedBeforeCommit = false; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 requires fresh clock receipts and an exact retirement-to-commit authority chain", () => {
  expectFailure((fixture) => {
    fixture.authority.providerClock.receiptObjectIdentitiesMustBeDistinct = false;
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.authority.providerClock.providerClockReadAtEveryBoundary = false;
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.authority.stageAdoptionBridge.postCursorAdoption.requiredAuditReceipts.pop();
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.authority.stageAdoptionBridge.stageRetirementBridge.preservesUnrelatedTempObjects = false;
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.authority.finalFence.commitConsumesFinalFenceReceiptExactlyOnce = false;
  }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 separates count-scan cleanup from seal-stream cleanup", () => {
  expectFailure((fixture) => {
    fixture.sealContract.phaseCleanupOrder.mainKeyCountFailureOrCancellation.unshift("driver-cursor");
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.sealContract.mainKeyCountCursorClosedBeforeDriverPrepare = false;
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    fixture.lifecycleContract.cancellationSemantics.mainKeyCountCloseFailurePrecedence.reverse();
  }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 rejects re-signed weakening of the transitive authority chain", () => {
  const mutations = [
    (fixture) => { fixture.authority.outerPublicationAuthority.consumesOuterClockEvidenceReceiptExactlyOnce = false; },
    (fixture) => { fixture.authority.stageAdoptionBridge.consumesRequiredOuterWriteReceiptsExactlyOnce = false; },
    (fixture) => { fixture.authority.stageAdoptionBridge.failedBundleValidationConsumesAnyReceipt = true; },
    (fixture) => { fixture.authority.stageAdoptionBridge.failedBundleMayRetryWithSameExactBundle = false; },
    (fixture) => { fixture.authority.stageAdoptionBridge.mintsConsumedReceiptTombstones = false; },
    (fixture) => { fixture.authority.publicationSession.consumesPreRebindClockEvidenceReceiptExactlyOnce = false; },
    (fixture) => { fixture.authority.cursorClock.requiredCommitments[0] = "attacker-clock-receipt"; },
    (fixture) => { fixture.authority.receiptChain.preRetirementStageFenceReceipt.requiredCommitments.pop(); },
    (fixture) => { fixture.authority.receiptChain.stageRetirementReceipt.cloneRejected = false; },
    (fixture) => { fixture.authority.receiptChain.finalCommitFenceReceipt.requiredCommitments.reverse(); },
    (fixture) => {
      fixture.authority.stageAdoptionBridge.stageRetirementBridge
        .eachAuthorizedDropConsumesPriorAndMintsNextMutationEpochReceipt = false;
    },
  ];
  for (const mutate of mutations) {
    const fixture = cloneFixture();
    mutate(fixture);
    resignFixture(fixture);
    assert.throws(
      () => validateCursorPublicationFixture(fixture),
      (error) => error instanceof CursorPublicationContractError
        && error.code === "GE_CURSOR_B3_SCHEMA",
    );
  }
});

test("B3 rejects re-signed weakening of every initial-publication lifecycle Boolean", () => {
  const booleanPaths = [
    ...[
      "opaque", "moduleMinted", "mintedOnce", "nonTransferable", "cloneRejected",
      "crossRunSubstitutionRejected", "reusableWithinExactAuthorityGraph",
      "notConsumedByWritesOrAdoption", "authorizesExpectedTargetCatalog",
      "ownsOuterMigrationWriteLedger", "doesNotAuthorizeCursorRebind",
      "consumesOuterClockEvidenceReceiptExactlyOnce",
    ].map((field) => ["authority", "outerPublicationAuthority", field]),
    ...[
      "validatesAndRegistersInactiveAuthorityBeforeAnyReceiptConsumption",
      "presentationFailureConsumesAnyReceipt",
      "presentationFailureMayRetryWithSameExactEvidence",
      "faultInjectionForbiddenAfterAtomicTailBegins",
      "failureAfterAtomicTailBeginsPoisonsAndRequiresRollbackAndFreshGraph",
    ].map((field) => ["authority", "outerPublicationAuthority", "mintLifecycle", field]),
    ...[
      "opaqueModuleMintedSingleUse", "cloneRejected", "substitutionRejected",
      "crossRunReplayRejected",
    ].map((field) => ["authority", "initialOuterWriteReceiptContract", field]),
    ["authority", "initialOuterWriteReceiptContract", "canonicalDigestCodec",
      "lastInsertRowidIncluded"],
    ["authority", "initialOuterWriteReceiptContract", "migration0002CatalogRebuildReceipt",
      "adapterApiCallCountCrossRuntimeEqualityRequired"],
    ...[
      "opaque", "moduleMinted", "mintedOnce", "cloneRejected", "substitutionRejected",
      "crossRunOrPostRetirementReplayRejected",
      "repeatedExactPresentationWithinLiveAuthorityGraphAllowed",
      "reusableAsExactProofWithinAuthorityGraph",
      "consumesAnyWriteReceipt", "mintedAfterMigration0002BeforeBaselineDml",
      "isFinalV2SemanticProof",
    ].map((field) => ["authority", "postDdlCatalogFence", field]),
    ...[
      "opaque", "moduleMinted", "mintedOnce", "cloneRejected", "substitutionRejected",
      "replayRejected", "permitsOnlyFixedOrderedTempSelect", "permanentWriteAuthority",
      "consumesAnyWriteReceipt", "cancellationClosesCursorBeforeCleanup",
      "rederivesOrdinalAndEntryHashChainEqualExactProjection",
      "mayAdoptOnlyReadProofWatermarks", "mayMintStageAdoptionReceipt",
      "activeReaderForbiddenAtStageAdoption",
    ].map((field) => ["authority", "postDdlPublicationReaderLease", field]),
    ...[
      "successfulCloseRetiresLease", "secondReaderOpenRejected", "reuseAfterCloseRejected",
      "closeFailurePoisonsAndRequiresRollback", "primaryFailurePrecedesCloseFailure",
      "closeFailurePrecedesCancellationAndOuterCleanup",
      "cancellationObservedAfterRequiredCloseAttempt",
    ].map((field) => ["authority", "postDdlPublicationReaderLease", "readerLifecycle", field]),
    ...[
      "opaque", "moduleMinted", "mintedOnce", "cloneRejected", "substitutionRejected",
      "crossRunOrPostRetirementReplayRejected",
      "repeatedExactPresentationWithinLiveAuthorityGraphAllowed",
      "reusableAsExactProofWithinAuthorityGraph",
    ].map((field) => ["authority", "stageAdoptionReceipt", field]),
    ...[
      "packagePrivateIntrinsic", "callerConstructedReceiptsAllowed", "adoptsAfterOuterWrites",
      "requiresExactOuterPublicationAuthority", "requiresExactPostDdlCatalogFence",
      "requiresExactRetiredPostDdlPublicationReaderLease",
      "requiresReaderLeaseCloseCountExactlyOne",
      "requiresReaderReDerivedProjectionReadProof",
      "requiresStatementIdentityAndAffectedCountLedger", "requiresTotalChangesDeltaEquality",
      "retiresOnlyB2V1CatalogAndChangeFence", "preservesPostDdlCatalogFence",
      "mintsStageAdoptionReceiptOnce", "consumesRequiredOuterWriteReceiptsExactlyOnce",
      "validatesCompleteBundleBeforeAnyConsumption",
      "faultInjectionForbiddenAfterAtomicConsumptionBegins",
      "failedBundleValidationConsumesAnyReceipt",
      "invalidPresentationRetryRequiresCorrectedCompleteBundle",
      "validBundleCancellationBeforeAtomicConsumeMayRetrySameExactBundle",
      "authorityLineageLockCatalogLedgerOrReaderFailureRetryable",
      "atomicConsumeFailureRetryable",
      "authorityLineageLockCatalogOrLedgerFailurePoisonsAndRollsBack",
    ].map((field) => ["authority", "stageAdoptionBridge", field]),
    ["authority", "initialOuterWriteReceiptContract", "baselineHeaderPublicationReceipt",
      "callerOrAmbientInterpreterIdentityAllowed"],
  ];
  for (const path of booleanPaths) {
    expectResignedFailure(
      (fixture) => mutatePath(fixture, path, (current) => !current),
      ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_OUTER_AUTHORITY",
        "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS", "GE_CURSOR_B3_POST_DDL_CATALOG_FENCE",
        "GE_CURSOR_B3_POST_DDL_READER_LEASE", "GE_CURSOR_B3_STAGE_ADOPTION_RECEIPT",
        "GE_CURSOR_B3_STAGE_ADOPTION"],
    );
  }
});

test("B3 rejects re-signed initial-write commitment, predecessor and ledger drift", () => {
  const contractPath = ["authority", "initialOuterWriteReceiptContract"];
  const listPaths = [
    [...contractPath, "order"],
    [...contractPath, "requiredCommonCommitments"],
    [...contractPath, "canonicalDigestCodec", "allowedScalarEncodings"],
    [...contractPath, "migration0002CatalogRebuildReceipt", "requiredCommitments"],
    [...contractPath, "baselineEntriesPublicationReceipt", "requiredCommitments"],
    [...contractPath, "baselineHeaderPublicationReceipt", "requiredCommitments"],
    [...contractPath, "operationSequenceZeroPublicationReceipt", "requiredCommitments"],
    ["authority", "outerPublicationAuthority", "retiredBy"],
    ["authority", "outerPublicationAuthority", "mintLifecycle", "nonInterruptibleAtomicTail"],
    ["authority", "stageAdoptionBridge", "mintsConsumedReceiptTombstones"],
    ["authority", "postDdlPublicationReaderLease", "requiredCommitments"],
    ["authority", "postDdlPublicationReaderLease", "readerLifecycle", "states"],
  ];
  for (const path of listPaths) {
    expectResignedFailure(
      (fixture) => mutatePath(fixture, path, (current) => [...current].reverse()),
      ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_OUTER_AUTHORITY",
        "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS", "GE_CURSOR_B3_POST_DDL_READER_LEASE",
        "GE_CURSOR_B3_STAGE_ADOPTION"],
    );
  }

  for (const predecessor of [
    "migration0002CatalogRebuildReceipt", "baselineEntriesPublicationReceipt",
    "baselineHeaderPublicationReceipt", "operationSequenceZeroPublicationReceipt",
  ]) {
    expectResignedFailure((fixture) => {
      fixture.authority.initialOuterWriteReceiptContract.predecessorChain[predecessor] =
        "attacker-controlled-predecessor";
    }, ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS"]);
  }

  const receiptFields = {
    migration0002CatalogRebuildReceipt: [
      "logicalAssetExecutionCount", "logicalPrepareCount", "fixedAssetStatementCount",
      "schemaCopyRowCountFormula",
      "legacyOperationCopyRowCountFormula", "affectedRowCountFormula",
      "totalChangesDeltaFormula", "outerLedgerLogicalWriteSequenceDelta",
      "outerLedgerFixedStatementCountDelta", "outerLedgerAffectedRowsDeltaFormula",
    ],
    baselineEntriesPublicationReceipt: [
      "prepareCount", "executeCountFormula", "affectedRowCountFormula",
      "totalChangesDeltaFormula", "outerLedgerLogicalWriteSequenceDelta",
      "outerLedgerFixedStatementCountDeltaFormula", "outerLedgerAffectedRowsDeltaFormula",
    ],
    baselineHeaderPublicationReceipt: [
      "executeCount", "affectedRowCountFormula", "totalChangesDeltaFormula",
      "outerLedgerLogicalWriteSequenceDelta", "outerLedgerFixedStatementCountDelta",
      "outerLedgerAffectedRowsDelta",
    ],
    operationSequenceZeroPublicationReceipt: [
      "executeCount", "affectedRowCountFormula", "totalChangesDeltaFormula",
      "outerLedgerLogicalWriteSequenceDelta", "outerLedgerFixedStatementCountDelta",
      "outerLedgerAffectedRowsDelta",
    ],
  };
  for (const [receiptName, fields] of Object.entries(receiptFields)) {
    for (const field of fields) {
      expectResignedFailure((fixture) => {
        const receipt = fixture.authority.initialOuterWriteReceiptContract[receiptName];
        receipt[field] = typeof receipt[field] === "number" ? receipt[field] + 1 :
          "attacker-controlled-formula";
      }, ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS"]);
    }
  }
});

test("B3 rejects re-signed 0002 identity, runtime source, clock source and proof drift", () => {
  const mutations = [
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .migration0002CatalogRebuildReceipt.repositoryAssetSha256 = "0".repeat(64);
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .canonicalDigestCodec.parameterDomainUtf8 = "attacker-domain\0";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .canonicalDigestCodec.affectedRowsDecimalPattern = "^.*$";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .runtimeIdentityByRuntime.typescript.creationRuntimeVersion = "process.version";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .runtimeIdentityByRuntime.python.creationRuntime = "caller-provided";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .baselineEntriesPublicationReceipt.sourceReadSql += " LIMIT 1";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .baselineEntriesPublicationReceipt.sourceReadSqlSha256 = "0".repeat(64);
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .baselineEntriesPublicationReceipt.insertSql += " RETURNING ordinal";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .baselineEntriesPublicationReceipt.parameterOrder.reverse();
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .baselineHeaderPublicationReceipt.insertSqlSha256 = "0".repeat(64);
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .baselineHeaderPublicationReceipt.parameterOrder.reverse();
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .operationSequenceZeroPublicationReceipt.insertSqlSha256 = "0".repeat(64);
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .operationSequenceZeroPublicationReceipt.parameterOrder.reverse();
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .baselineHeaderPublicationReceipt.creationRuntimeSource = "ambient-interpreter";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .baselineHeaderPublicationReceipt.creationRuntimeVersionSource = "caller-provided";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .operationSequenceZeroPublicationReceipt.updatedAtMsSource = "wall-clock";
    },
    (fixture) => {
      fixture.authority.initialOuterWriteReceiptContract
        .operationSequenceZeroPublicationReceipt.requiredLastCommitSequence = 1;
    },
    (fixture) => { fixture.authority.postDdlCatalogFence.proofScope = "final-v2-proof"; },
    (fixture) => { fixture.authority.postDdlPublicationReaderLease.maximumConcurrentReaders = 2; },
    (fixture) => {
      fixture.authority.postDdlPublicationReaderLease
        .exactCursorCloseCountAfterOwnershipBegins = 0;
    },
    (fixture) => { fixture.authority.postDdlCatalogFence.requiredCommitments.reverse(); },
    (fixture) => { fixture.authority.stageAdoptionReceipt.requiredCommitments.reverse(); },
  ];
  for (const mutate of mutations) {
    expectResignedFailure(mutate,
      ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS",
        "GE_CURSOR_B3_POST_DDL_CATALOG_FENCE", "GE_CURSOR_B3_POST_DDL_READER_LEASE",
        "GE_CURSOR_B3_STAGE_ADOPTION_RECEIPT"]);
  }
});

test("B3 rejects re-signed canonical digest carrier drift", () => {
  const codecPath = ["authority", "initialOuterWriteReceiptContract", "canonicalDigestCodec"];
  const scalarPaths = [
    [...codecPath, "canonicalJsonProfile"],
    [...codecPath, "domainConcatenation"],
    [...codecPath, "taggedScalarShapes", "text", "typeLiteral"],
    [...codecPath, "taggedScalarShapes", "text", "valueEncoding"],
    [...codecPath, "taggedScalarShapes", "integer", "typeLiteral"],
    [...codecPath, "taggedScalarShapes", "integer", "valueEncoding"],
    [...codecPath, "taggedScalarShapes", "blob", "typeLiteral"],
    [...codecPath, "taggedScalarShapes", "blob", "valueEncoding"],
    [...codecPath, "taggedScalarShapes", "null", "typeLiteral"],
    [...codecPath, "resultObjectShape", "affectedRowsEncoding"],
    [...codecPath, "resultObjectShape", "aggregation"],
  ];
  for (const path of scalarPaths) {
    expectResignedFailure(
      (fixture) => mutatePath(fixture, path, () => "attacker-controlled"),
      ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS"],
    );
  }
  for (const path of [
    [...codecPath, "taggedScalarShapes", "text", "exactKeysInCanonicalOrder"],
    [...codecPath, "taggedScalarShapes", "integer", "exactKeysInCanonicalOrder"],
    [...codecPath, "taggedScalarShapes", "blob", "exactKeysInCanonicalOrder"],
    [...codecPath, "taggedScalarShapes", "null", "exactKeysInCanonicalOrder"],
    [...codecPath, "resultObjectShape", "exactKeysInCanonicalOrder"],
  ]) {
    expectResignedFailure(
      (fixture) => mutatePath(fixture, path, (current) => [...current, "extra"]),
      ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS"],
    );
  }
  expectResignedFailure((fixture) => {
    fixture.authority.initialOuterWriteReceiptContract.canonicalDigestCodec
      .taggedScalarShapes.null.valueMemberForbidden = false;
  }, ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS"]);
});

test("B3 rejects re-signed reader lifecycle and typed parity-array drift", () => {
  const readerLifecycle = ["authority", "postDdlPublicationReaderLease", "readerLifecycle"];
  for (const [field, value] of [
    ["cursorOwnershipBeginsAt", "prepare-started"],
    ["prepareOrExecuteFailureBeforeCursorOwnershipCloseCount", 1],
    ["normalCancellationOrPrimaryFailureAfterOwnershipCloseCount", 0],
  ]) {
    expectResignedFailure(
      (fixture) => mutatePath(fixture, [...readerLifecycle, field], () => value),
      ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_POST_DDL_READER_LEASE"],
    );
  }

  const parityPath = ["parityGates", "initialPublicationNormalizedOutput",
    "fourWriteArrayContract"];
  for (const [field, mutation] of [
    ["exactOrder", (current) => [...current].reverse()],
    ["exactLength", () => 3],
    ["elementType", () => "number"],
    ["coveredFields", (current) => current.slice(0, 3)],
    ["successfulPrepareCounts", (current) => [current[0], current[1], current[2]]],
    ["successfulExecuteCountFormulas", (current) => [...current].reverse()],
    ["successfulAffectedRowCountFormulas", (current) => [...current].reverse()],
    ["successfulTotalChangesDeltaFormulas", (current) => [...current].reverse()],
    ["failureCaseEncoding", () => "omit-unreached-slots"],
  ]) {
    expectResignedFailure(
      (fixture) => mutatePath(fixture, [...parityPath, field], mutation),
      ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_PARITY_OUTPUT"],
    );
  }
});

test("B3 freezes all 145 hostile execution records and both trusted registry hashes", () => {
  const fixture = cloneFixture();
  const contract = fixture.hostileExecutionContract;
  assert.equal(fixture.hostileObligations.length, 145);
  assert.equal(contract.records.length, 145);
  assert.equal(contract.trustedRegistrySha256,
    "4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58");
  assert.equal(contract.expandedExpectationsSha256,
    "6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95");
  for (const [index, record] of contract.records.entries()) {
    assert.equal(record.ordinal, index + 1);
    assert.equal(record.id, fixture.hostileObligations[index]);
    assert.equal(record.hook, `hostile/${record.id}`);
    assert.deepEqual(Object.keys(record), [
      "ordinal", "id", "category", "phase", "failureBoundaryParent", "hook",
      "mutation", "expectedCode", "expectedCounterProfile", "retryEvidenceMode",
      "expected", "expectedProfile",
    ]);
    assert.deepEqual(Object.keys(record.expected), [
      "outcome", "failureBoundary", "state", "poisoned", "bundleRetryable",
      "sameTransactionLineage", "catalogFenceMatches",
    ]);
  }
});

test("B3 resolves 25 exact counter profiles into the trusted 145-by-28 digest", () => {
  const fixture = cloneFixture();
  const contract = fixture.hostileExecutionContract;
  const parity = fixture.parityGates.initialPublicationNormalizedOutput;
  const semanticFields = new Set([
    "caseId", "outcome", "failureBoundary", "state", "poisoned", "bundleRetryable",
    "sameTransactionLineage", "catalogFenceMatches",
  ]);
  const counterFields = parity.orderedFields.filter((field) => !semanticFields.has(field));
  assert.equal(Object.keys(contract.counterProfiles).length, 25);
  assert.equal(counterFields.length, 20);
  for (const profile of Object.values(contract.counterProfiles)) {
    assert.deepEqual(Object.keys(profile), counterFields);
  }
  const expanded = contract.records.map((record) => Object.fromEntries(
    parity.orderedFields.map((field) => [
      field,
      field === "caseId" ? record.id
        : Object.hasOwn(record.expected, field) ? record.expected[field]
          : contract.counterProfiles[record.expectedCounterProfile][field],
    ]),
  ));
  assert.equal(expanded.length, 145);
  assert.ok(expanded.every((record) => Object.keys(record).length === 28));
  assert.equal(domainSeparatedCanonicalDigest(
    contract.trustedRegistryHashContract.domainUtf8, contract.records,
  ), "4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58");
  assert.equal(domainSeparatedCanonicalDigest(
    contract.expandedExpectationsHashContract.domainUtf8, expanded,
  ), "6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95");
});

test("B3 freezes seven digest vectors and the signed 64-bit integer boundary", () => {
  const fixture = cloneFixture();
  const codec = fixture.authority.initialOuterWriteReceiptContract.canonicalDigestCodec;
  assert.deepEqual(codec.goldenVectors.map(({ id }) => id), [
    "one-empty-execution", "one-mixed-execution", "two-executions",
    "integer-signed-64-minimum", "integer-signed-64-maximum",
    "result-zero", "result-three",
  ]);
  assert.equal(codec.integerMinimum, "-9223372036854775808");
  assert.equal(codec.integerMaximum, "9223372036854775807");
  const underflow = cloneFixture();
  const vector = underflow.authority.initialOuterWriteReceiptContract
    .canonicalDigestCodec.goldenVectors[3];
  vector.canonicalJson = "[[{\"type\":\"integer\",\"value\":\"-9223372036854775809\"}]]";
  vector.sha256 = createHash("sha256").update(Buffer.concat([
    Buffer.from(underflow.authority.initialOuterWriteReceiptContract
      .canonicalDigestCodec.parameterDomainUtf8, "utf8"),
    Buffer.from(vector.canonicalJson, "utf8"),
  ])).digest("hex");
  resignFixture(underflow);
  assert.throws(() => validateCursorPublicationFixture(underflow),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");
});

test("B3 exposes no semantic-only bypass around exact schema rejection", () => {
  const fixture = cloneFixture();
  fixture.identities.source.descriptorHash = "0".repeat(64);
  resignFixture(fixture);
  assert.throws(() => validateCursorPublicationFixture(fixture),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");

  const extraRoot = cloneFixture();
  extraRoot.attackerRootMember = undefined;
  resignFixture(extraRoot);
  assert.throws(() => validateCursorPublicationFixture(extraRoot),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");
});

test("B3 domain-separated fixture root and case-insensitive catalog probe are exact", () => {
  const fixture = cloneFixture();
  assert.equal(fixture.parityGates.fixtureDigestContract.domainUtf8, FIXTURE_DIGEST_DOMAIN);
  const zeroed = structuredClone(fixture);
  zeroed.parityGates.fixtureCanonicalSha256 = "0".repeat(64);
  assert.equal(domainSeparatedCanonicalDigest(FIXTURE_DIGEST_DOMAIN, zeroed),
    "32ebd363838ac9aa5c0d3573aa31b1f45244ca469ec248f7c906ff08d3c08993");
  const catalog = fixture.authority.postDdlCatalogFence.catalogReadContract;
  assert.match(catalog.sql, /WHERE lower\(name\) GLOB 'ge_cycle_\*'/u);
  assert.equal(catalog.querySha256,
    "bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c");
  assert.equal(catalog.expectedDigestSha256,
    "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf");
  assert.equal(validateCanonicalCursorPublicationFixture().ok, true);
});

test("B3 rejects maliciously re-signed hostile record and hash substitution", () => {
  expectResignedFailure((fixture) => {
    fixture.hostileExecutionContract.records[82].category = "authority";
  }, ["GE_CURSOR_B3_HOSTILE_EXECUTION", "GE_CURSOR_B3_SCHEMA"]);
  expectResignedFailure((fixture) => {
    fixture.hostileExecutionContract.records[119].expected.failureBoundary =
      "attacker-controlled-boundary";
  }, ["GE_CURSOR_B3_HOSTILE_EXECUTION", "GE_CURSOR_B3_SCHEMA"]);
  expectResignedFailure((fixture) => {
    fixture.hostileExecutionContract.trustedRegistrySha256 = "0".repeat(64);
    fixture.hostileExecutionContract.expandedExpectationsSha256 = "f".repeat(64);
  }, ["GE_CURSOR_B3_HOSTILE_EXECUTION", "GE_CURSOR_B3_SCHEMA"]);
});

test("B3 rejects maliciously re-signed catalog, reader proof and digest-vector drift", () => {
  expectResignedFailure((fixture) => {
    const catalog = fixture.authority.postDdlCatalogFence.catalogReadContract;
    catalog.sql = catalog.sql.replace("AND sql IS NOT NULL ", "");
    catalog.querySha256 = createHash("sha256").update(catalog.sql).digest("hex");
  }, ["GE_CURSOR_B3_POST_DDL_CATALOG_FENCE", "GE_CURSOR_B3_SCHEMA"]);
  expectResignedFailure((fixture) => {
    fixture.authority.initialOuterWriteReceiptContract.baselineEntriesPublicationReceipt
      .requiredCommitments.pop();
  }, ["GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS", "GE_CURSOR_B3_SCHEMA"]);
  expectResignedFailure((fixture) => {
    fixture.authority.stageAdoptionReceipt.requiredCommitments.splice(10, 3);
  }, ["GE_CURSOR_B3_STAGE_ADOPTION_RECEIPT", "GE_CURSOR_B3_SCHEMA"]);
  expectResignedFailure((fixture) => {
    const vector = fixture.authority.initialOuterWriteReceiptContract
      .canonicalDigestCodec.goldenVectors[2];
    vector.canonicalJson = "[[{\"type\":\"text\",\"value\":\"flattened\"}]]";
    vector.sha256 = createHash("sha256").update(Buffer.concat([
      Buffer.from(fixture.authority.initialOuterWriteReceiptContract
        .canonicalDigestCodec.parameterDomainUtf8, "utf8"),
      Buffer.from(vector.canonicalJson, "utf8"),
    ])).digest("hex");
  }, ["GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS", "GE_CURSOR_B3_SCHEMA"]);
});

test("B3 freezes the complete 28-field parity type map and three exact vectors", () => {
  const fixture = cloneFixture();
  const parity = fixture.parityGates.initialPublicationNormalizedOutput;
  assert.equal(parity.orderedFields.length, 28);
  assert.deepEqual(Object.keys(parity.fieldTypes), parity.orderedFields);
  assert.equal(parity.fieldTypes.state, "enum-state-machine-states");
  assert.deepEqual(fixture.stateMachine.states, [
    "pre-rebind-complete", "publication-active", "cursor/clock-complete",
    "poisoned", "disposed",
  ]);
  assert.equal(parity.expectedRecords.length, 3);
  for (const record of parity.expectedRecords) {
    assert.deepEqual(Object.keys(record), parity.orderedFields);
  }
  expectResignedFailure((mutated) => {
    mutated.parityGates.initialPublicationNormalizedOutput
      .fieldTypes.outerLedgerFixedStatementCount = "boolean";
  }, ["GE_CURSOR_B3_PARITY_OUTPUT", "GE_CURSOR_B3_SCHEMA"]);
  expectResignedFailure((mutated) => {
    mutated.parityGates.initialPublicationNormalizedOutput.expectedRecords[0]
      .outerLedgerFixedStatementCount = 33;
  }, ["GE_CURSOR_B3_PARITY_OUTPUT", "GE_CURSOR_B3_SCHEMA"]);
});

test("B3 freezes the corrective hostile authority, receipt, digest and adoption cases", () => {
  for (const hostile of [
    "outer-clock-consumed-tombstone-missing",
    "cancellation-before-outer-authority-atomic-tail",
    "fault-injection-during-outer-authority-atomic-tail",
    "initial-write-receipt-wrong-connection",
    "initial-write-parameter-digest-drift",
    "initial-write-result-digest-drift",
    "stage-adoption-receipt-cross-run-or-post-retirement-replay",
    "stage-adoption-receipt-substitution",
    "post-ddl-catalog-fence-cross-run-or-post-retirement-replay",
  ]) {
    expectResignedFailure((fixture) => {
      fixture.hostileObligations[fixture.hostileObligations.indexOf(hostile)] =
        "attacker-removed-required-hostile";
    }, "GE_CURSOR_B3_HOSTILE_MATRIX");
  }
});

test("B3 freezes one-way state transitions and failure precedence", () => {
  expectFailure((fixture) => { fixture.stateMachine.successTransitions.reverse(); }, "GE_CURSOR_B3_TRANSITIONS");
  for (const boundary of Object.keys(cloneFixture().failureContract.boundaryPrecedence)) {
    expectResignedFailure((fixture) => {
      fixture.failureContract.boundaryPrecedence[boundary].reverse();
    }, "GE_CURSOR_B3_FAILURE_PRECEDENCE");
  }
});

test("B3 freezes exact affected-count and permanent-write ledger requirements", () => {
  expectFailure((fixture) => { fixture.writeLedger.expectedStatementCount = 2; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.writeLedger.requiresTotalChangesDeltaEquality = false; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.writeLedger.sameValueReplayAllowed = true; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 freezes crash/reopen split at commit-returned", () => {
  expectFailure((fixture) => { fixture.faultMatrix.boundaries.pop(); }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.faultMatrix.preCommitReopenState = "partial-v2"; }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => { fixture.faultMatrix.subprocessKillRequired = false; }, "GE_CURSOR_B3_SCHEMA");
});

test("B3 fixture digest rejects any otherwise-shaped semantic drift", () => {
  expectFailure((fixture) => {
    [fixture.hostileObligations[0], fixture.hostileObligations[1]] =
      [fixture.hostileObligations[1], fixture.hostileObligations[0]];
  }, "GE_CURSOR_B3_HOSTILE_MATRIX");
  expectFailure((fixture) => { fixture.parityGates.fixtureCanonicalSha256 = "0".repeat(64); }, "GE_CURSOR_B3_FIXTURE_HASH");
});

test("B3 rejects maliciously re-signed drift through the public schema-first entry", () => {
  const commitment = cloneFixture();
  commitment.authority.publicationSession.requiredCommitments[0] = "attacker-controlled";
  resignFixture(commitment);
  assert.throws(() => validateCursorPublicationFixture(commitment),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");

  const affected = cloneFixture();
  affected.sqlContract.affectedCount.sql = "SELECT 0 AS affected_rows";
  affected.sqlContract.affectedCount.sha256 = createHash("sha256")
    .update(affected.sqlContract.affectedCount.sql).digest("hex");
  resignFixture(affected);
  assert.throws(() => validateCursorPublicationFixture(affected),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");

  const obligations = cloneFixture();
  obligations.hostileObligations = obligations.hostileObligations.map((_, index) =>
    `fake-obligation-${index}`);
  resignFixture(obligations);
  assert.throws(() => validateCursorPublicationFixture(obligations),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");

  const rule = cloneFixture();
  rule.rules[1].diagnosticUnit = "cursor-row";
  resignFixture(rule);
  assert.throws(() => validateCursorPublicationFixture(rule),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");

  const parity = cloneFixture();
  parity.parityGates.required = parity.parityGates.required.map((_, index) =>
    `fake-parity-${index}`);
  resignFixture(parity);
  assert.throws(() => validateCursorPublicationFixture(parity),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");

  const parityOutput = cloneFixture();
  parityOutput.parityGates.initialPublicationNormalizedOutput.orderedFields.reverse();
  resignFixture(parityOutput);
  assert.throws(() => validateCursorPublicationFixture(parityOutput),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");

  const parityExclusion = cloneFixture();
  parityExclusion.parityGates.initialPublicationNormalizedOutput.excludedFields.pop();
  resignFixture(parityExclusion);
  assert.throws(() => validateCursorPublicationFixture(parityExclusion),
    (error) => error instanceof CursorPublicationContractError
      && error.code === "GE_CURSOR_B3_SCHEMA");

  for (const field of [
    "requiresRealHookInstrumentation", "preRebindCasesRequireZeroCursorRebindAndCommitCounts",
  ]) {
    expectResignedFailure((fixture) => {
      const output = fixture.parityGates.initialPublicationNormalizedOutput;
      output[field] = !output[field];
    }, ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_PARITY_OUTPUT"]);
  }
  for (const field of [
    "providerClockReadCount", "clockEvidenceConsumeCount", "outerAuthorityMintCount",
  ]) {
    expectResignedFailure((fixture) => {
      fixture.parityGates.initialPublicationNormalizedOutput.counterSelfProbe[field] = 2;
    }, ["GE_CURSOR_B3_SCHEMA", "GE_CURSOR_B3_PARITY_OUTPUT"]);
  }
});

test("B3 strict JSON parser rejects duplicate keys and trailing content", () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), /duplicate key/u);
  assert.throws(() => parseStrictJson('{"a":1} false'), /trailing JSON content/u);
  const prototypeKey = parseStrictJson('{"__proto__":{"polluted":true}}');
  assert.equal(Object.getPrototypeOf(prototypeKey), null);
  assert.equal(Object.hasOwn(prototypeKey, "__proto__"), true);
  assert.deepEqual(Object.keys(prototypeKey), ["__proto__"]);
  expectFailure((fixture) => {
    Object.defineProperty(fixture, "__proto__", { enumerable: true, value: {} });
  }, "GE_CURSOR_B3_SCHEMA");
  expectFailure((fixture) => {
    Object.defineProperty(fixture, "constructor", { enumerable: true, value: {} });
  }, "GE_CURSOR_B3_SCHEMA");
});
