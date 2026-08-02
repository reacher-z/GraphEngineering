#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = dirname(dirname(ROOT));
const FIXTURE_PATH = join(ROOT, "sqlite-cursor-publication-rebind-v2.case.json");
const SCHEMA_PATH = join(ROOT, "sqlite-cursor-publication-rebind-v2.schema.json");
const TRUSTED_FIXTURE_SHA256 = "d368cd53e819e06e950f2dabedcb5a5b2fca535536efe85abb2e4b488bae2e7d";
const TRUSTED_INITIAL_WRITE_CONTRACT_SHA256 =
  "3bcd8b69ec5ab63b38fa5bcbbd2c13b4c54120f7b7ba46af8649d1187cad2320";
const TRUSTED_POST_DDL_CATALOG_FENCE_SHA256 =
  "57957d645e510e66601f70a59a40298bad26bf057ec2b9d7d3e3370f7545cd56";
const TRUSTED_POST_DDL_READER_LEASE_SHA256 =
  "60542f336c2ad5b59c29caaf87d5aa10beccb4b6873122456acc589f07aedbce";
const TRUSTED_STAGE_ADOPTION_RECEIPT_SHA256 =
  "7f4da0e4423b4155a9210d6cd5c0a61424448cdfb9e369ef0c94483db5d54fda";
const TRUSTED_STAGE_ADOPTION_BRIDGE_SHA256 =
  "b979278ad623140947718e8f6b7d01c6668f674fe0e4c15be61392226365de31";
const TRUSTED_PUBLICATION_SESSION_SHA256 =
  "cbfeca0302748a04e3806f45016af37653660a41ab168952c842da4cf7a4a193";
const TRUSTED_HOSTILE_EXECUTION_CONTRACT_SHA256 =
  "1eab5f82e5d2ccca53196320703a3a67df517a982d9b18d69d1b11e03a3d3b4a";
const TRUSTED_HOSTILE_REGISTRY_SHA256 =
  "4e08dbd783213483692c0a2c36d4b8a3732f9b6b3e1a3f0e8bda24861b816e58";
const TRUSTED_HOSTILE_EXPANDED_SHA256 =
  "6bd821819215291851f2342b41beb565288e7c095de07fc066f47511cc232f95";
const TRUSTED_INITIAL_PUBLICATION_PARITY_SHA256 =
  "0675a45ba4d3943bd199a1387bb0f1f542b597461778056b614fda980201650d";
const TRUSTED_CATALOG_QUERY_SHA256 =
  "bd9a24c0e8307f473f6160b940effdfb77007144fbeea83628f0b7664df1410c";
const TRUSTED_CATALOG_DIGEST_SHA256 =
  "ca85cf266267fa3eb5443bdf6d957b4b03c795cd6e0232a28c52773f1041fadf";
const TRUSTED_FIXTURE_DOMAIN =
  "graph-engineering/sqlite-cursor-publication-rebind-v2-fixture/v1\0";
const TRUSTED_HOSTILE_REGISTRY_DOMAIN =
  "graph-engineering/sqlite-b3-hostile-registry/v1\0";
const TRUSTED_HOSTILE_EXPANDED_DOMAIN =
  "graph-engineering/sqlite-b3-expanded-hostile-expectations/v1\0";
const TRUSTED_CURSOR_ROOT_ENVELOPE_ORDER_SHA256 =
  "1037ce73b975135d9fcc0d34992506d2e19a7d67466dd100013c68c6797a644c";
const TRUSTED_CURSOR_RETRY_ORCHESTRATION_SHA256 =
  "ff981c4e2fa551c159413492fce971fe5f10429b2f40812f5bee8efec172ab1a";
const TRUSTED_CURSOR_REBIND_AUTHORITY_SHA256 =
  "837f2ab30e91097f944090c8f2f2c3b9527d1626764b7d2cb3d6b73657b3de26";
const TRUSTED_CURSOR_WRITE_RULE_RECEIPTS_SHA256 =
  "8c8678b7e2ad3ab9b189d2298b116ea8b6d976bf9bedb158949e54e1d796da95";
const TRUSTED_CURSOR_BOUNDED_READS_QUERY_SHA256 =
  "9ff9e59db6c6a0e94d58d699be70a98af6bb4f9063b3cfc688efa3b3dee71201";
const TRUSTED_CURSOR_THIRD_EVIDENCE_SHA256 =
  "4566795a8a6debc4ad40c193207666f6273ed8b002a7388a693f74763bb8e2ac";
const TRUSTED_CURSOR_PENDING_ATOMIC_TAIL_SHA256 =
  "db9fb4bba77cda0051b28f6fbc664129916b2f7565dcce1821f00f5ef06b8da6";
const TRUSTED_CURSOR_THREE_LAYER_COMPLETION_SHA256 =
  "f209dcfcd0779a6da3f3b21705caa6b20927f09b0de9097908b9567f6ee7422a";
const TRUSTED_CURSOR_ACTIVE_ASSERTION_SHA256 =
  "7c4b8815661d6e81a54165ad3fe1f5c9458507b62a07cb22b1acc00cbc3b370d";
const TRUSTED_CURSOR_LEAF_EVIDENCE_SHA256 =
  "096a829754d782cda6dc0f3c5540d49a383b664f0a6db492ee35864dbecd7a18";

const EXACT_IDENTITIES = Object.freeze({
  sourceDescriptorHash: "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe",
  sourceSchemaIdentity: "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
  targetDescriptorHash: "f632104c823e7559dbbb889b08ac3adb0cf0b6dc528cdb9179c9521ce72cff92",
  targetDescriptorBodySha256: "7bb784e57922facd28034dfdd504b37bd60c89e6c09fcd0d3f9adabb8456e214",
  targetDescriptorCanonicalSha256: "27cfd73833b3a8ff29f0b33d2a73a51d1409b40a07e62c96ec4d9910a705a7d9",
  targetSchemaIdentity: "9fcd96c331999ffb0aca0d9d63ad2b9af073db80012471108c5437a77116f634",
  migrationSqlSha256: "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d",
  schemaSqlSha256: "5a0923462f7fa5eb1627955292aa3657253258fc5832e365257dc913740866a5",
  previewManifestSha256: "f1d447b5b4e925151d04a952376a1386da9196538f18f0be17c56da01d31deaf",
});
const EXACT_STAGES = Object.freeze([
  "source-v1-semantically-valid",
  "b2-pre-rebind-complete",
  "outer-publication-authority-minted",
  "migration-0002-catalog-rebuild",
  "post-0002-catalog-fence-adopted",
  "baseline-entries-published",
  "baseline-header-published",
  "operation-sequence-zero-published",
  "post-ddl-stage-authority-adopted",
  "cursor-publication-session-minted",
  "cursor-rebind-executed-once",
  "rule-11-rebind-count-accepted",
  "rule-12-main-table-seal-accepted",
  "cursor-clock-complete",
  "migration-lineage-published",
  "schema-and-descriptor-metadata-published",
  "publication-rules-accepted",
  "fresh-v2-catalog-equivalence-accepted",
  "physical-and-semantic-postconditions-accepted",
  "pre-retirement-stage-fence-adopted",
  "cursor-temp-stage-retired",
  "final-migration-lock-transaction-fence-accepted",
  "single-atomic-commit",
]);
const EXACT_RULES = Object.freeze([
  Object.freeze({ position: 11, id: "BLR_CURSOR_REBIND_COUNT",
    input: "publication-owned-statement-affected-count",
    expected: "equals-pre-rebind-receipt-cursor-count", diagnosticUnit: "count-mismatch",
    violationCountOnFailure: 1, successRequiredForNextRule: true }),
  Object.freeze({ position: 12, id: "BLR_CURSOR_SEAL_MISMATCH",
    input: "fresh-main-table-point-lookup-stream",
    expected: "count-and-immutable-root-equal-receipt-and-every-mutable-identity-equals-target",
    diagnosticUnit: "post-rebind-receipt-mismatch",
    violationCountOnFailure: 1, successRequiredForNextRule: true }),
]);
const EXACT_PRECEDENCE = Object.freeze({
  outerAuthorityMint: Object.freeze(["b2-receipt-provenance", "exact-object-graph",
    "migration-lock-capability", "transaction-generation", "expected-target-catalog",
    "outer-clock-evidence", "cancellation"]),
  beforeMigration0002: Object.freeze(["outer-publication-authority",
    "migration-lock-freshness", "transaction-generation",
    "expected-source-and-target-identities", "migration-0002-repository-asset",
    "outer-write-ledger", "cancellation"]),
  afterMigration0002BeforeFence: Object.freeze(["migration-0002-statement-result",
    "migration-0002-affected-row-count", "migration-0002-total-changes-delta",
    "migration-0002-outer-ledger-delta", "post-0002-physical-catalog", "cancellation",
    "cleanup"]),
  beforeBaselineEntries: Object.freeze(["post-ddl-catalog-fence",
    "migration-0002-receipt-predecessor", "baseline-entries-parameters",
    "outer-write-ledger", "cancellation"]),
  baselineEntriesReaderLifecycle: Object.freeze(["reader-lease-authority-and-provenance",
    "fixed-source-read-sql-and-order", "reader-prepare-or-execute",
    "row-fetch-decode-order-and-projection-proof", "reader-close-failure", "cancellation",
    "temp-or-outer-cleanup-failure"]),
  beforeBaselineHeader: Object.freeze(["baseline-entries-publication-receipt",
    "baseline-header-parameters", "stable-runtime-identity-and-version",
    "outer-write-ledger", "cancellation"]),
  beforeSequenceZero: Object.freeze(["baseline-header-publication-receipt",
    "operation-sequence-zero-parameters", "provider-authoritative-outer-clock-evidence",
    "outer-write-ledger", "cancellation"]),
  initialStageAdoptionValidation: Object.freeze(["outer-publication-authority",
    "b2-exact-object-graph", "transaction-generation", "post-ddl-catalog-fence",
    "initial-write-receipt-order-and-predecessors",
    "total-changes-and-outer-ledger-watermarks", "cancellation"]),
  initialStageAdoptionAtomicConsume: Object.freeze(["complete-bundle-validation",
    "four-receipt-atomic-consumption", "four-consumed-receipt-tombstones",
    "update-stage-watermarks-and-retire-old-b2-fence", "stage-adoption-receipt-mint"]),
  beforeCursorRebind: Object.freeze(["publication-session", "migration-lock-freshness",
    "transaction-generation", "post-0002-catalog-fence", "cancellation"]),
  afterStatementStarted: Object.freeze(["sqlite-error-or-statement-result-shape",
    "affected-row-count", "total-changes-delta", "permanent-write-ledger-delta",
    "cancellation", "cleanup"]),
  beforeRebindPrepare: Object.freeze([
    "exact-publication-session-presentation-and-object-identity",
    "publication-active-three-layer-authority-graph", "exclusive-transaction-lineage",
    "live-migration-lock-tuple-and-expiry", "source-target-catalog-and-post-0002-fence",
    "pre-rebind-receipt-and-stage-adoption-lineage",
    "three-eqp-shapes-and-forbidden-fragments", "no-trigger-and-no-caller-controlled-sql",
    "total-changes-and-cursor-ledger-before-watermarks", "cancellation",
    "statement-close", "temp-cleanup", "outer-cleanup",
  ]),
  beforeRebindExecute: Object.freeze([
    "exact-cursor-rebind-prepared-owner", "fixed-statement-identity-parameters-and-owner",
    "unchanged-exclusive-transaction-lineage", "live-migration-lock-and-catalog-revalidation",
    "cancellation", "publication-session-consumption-and-tombstone", "statement-close",
    "temp-cleanup", "outer-cleanup",
  ]),
  afterRebindExecute: Object.freeze([
    "native-sqlite-execute-primary", "native-run-result-shape", "affected-row-safe-integer",
    "statement-release-primary", "cancellation", "temp-cleanup", "outer-cleanup",
  ]),
  changesLifecycle: Object.freeze([
    "earlier-rebind-execute-or-release-primary", "changes-prepare-or-fetch-primary",
    "changes-single-row-single-column-shape", "changes-safe-integer-and-affected-equality",
    "changes-release-primary", "total-changes-before-after-delta",
    "cursor-ledger-before-after-deltas", "cancellation", "temp-cleanup", "outer-cleanup",
  ]),
  rule11Validation: Object.freeze([
    "exact-rebind-write-receipt-object-identity",
    "session-connection-transaction-lock-and-target-lineage", "all-five-counts-safe-and-equal",
    "rule-11-diagnostic-and-violation-result", "rule-11-success-receipt-registration",
    "cancellation", "temp-cleanup", "outer-cleanup",
  ]),
  rule12MainCountLifecycle: Object.freeze([
    "exact-rule-11-predecessor-and-read-authority", "main-key-count-eqp-and-prepare-primary",
    "current-main-key-fetch-decode-and-order-primary", "terminal-fetch-and-count-proof",
    "main-key-count-close-primary", "compare-main-count-to-b2-receipt-count",
    "cancellation", "temp-cleanup", "outer-cleanup",
  ]),
  rule12DriverLifecycle: Object.freeze([
    "main-key-count-ownership-cleared", "temp-driver-eqp-and-prepare-primary",
    "point-statement-eqp-and-prepare-primary",
    "current-driver-key-fetch-decode-and-order-primary", "terminal-driver-fetch-proof",
    "point-statement-release-primary", "driver-close-primary", "cancellation",
    "temp-cleanup", "outer-cleanup",
  ]),
  rule12PointLookupLifecycle: Object.freeze([
    "earlier-driver-fetch-decode-or-order-primary", "point-execute-or-fetch-primary",
    "exactly-one-main-row-result-shape",
    "current-main-row-decode-immutable-and-target-identity-primary",
    "point-cursor-close-primary", "cancellation", "next-driver-fetch",
    "point-statement-release", "driver-close", "temp-cleanup", "outer-cleanup",
  ]),
  rule12Finalize: Object.freeze([
    "earlier-count-driver-point-or-close-primary", "finish-seal-accumulator",
    "main-driver-lookup-receipt-and-accumulator-count-equality",
    "receipt-and-computed-root-equality", "every-row-target-mutable-identities",
    "rule-12-diagnostic-and-violation-result", "rule-12-success-receipt-registration",
    "cancellation", "temp-cleanup", "outer-cleanup",
  ]),
  beforeThirdClock: Object.freeze([
    "exact-rule-12-success-receipt-object-identity",
    "rebind-rule-11-rule-12-predecessor-chain",
    "publication-session-connection-and-exclusive-transaction-lineage",
    "provider-clock-and-migration-lock-capability-identities",
    "current-provider-clock-head-index-two", "third-evidence-not-yet-observed",
    "cancellation", "temp-cleanup", "outer-cleanup",
  ]),
  thirdClockObservation: Object.freeze([
    "live-migration-lock-before-provider-read", "provider-callback-result-or-primary-failure",
    "safe-monotonic-provider-now-and-strict-expiry-fence",
    "live-migration-lock-after-provider-read",
    "unchanged-connection-transaction-lock-and-catalog-lineage",
    "exact-boundary-consumer-predecessor-and-head-index-three",
    "third-evidence-registration-unconsumed", "cancellation", "temp-cleanup", "outer-cleanup",
  ]),
  cursorClockValidation: Object.freeze([
    "exact-unconsumed-third-evidence-object-identity",
    "exact-session-rebind-rule-11-and-rule-12-object-graph",
    "unchanged-connection-transaction-live-lock-and-target-catalog",
    "unchanged-total-changes-and-cursor-ledger-watermarks",
    "before-cursor-clock-complete-cancellation", "preconstruct-immutable-capability-and-state",
    "register-non-readable-pending-graph", "prepare-all-three-completion-continuations",
    "burn-preparation-on-failure", "temp-cleanup", "outer-cleanup",
  ]),
  cursorClockAtomicTail: Object.freeze([
    "complete-bundle-validation-and-pending-registration",
    "burn-all-three-completion-continuations", "consume-exact-third-evidence-once",
    "retain-exact-third-evidence-consumed-tombstone",
    "publish-identical-cursor-clock-to-lower-two-layers",
    "publish-identical-cursor-clock-to-outer-session",
    "transition-all-three-layers-to-cursor-clock-complete",
    "activate-and-return-cursor-clock-capability",
  ]),
  afterCommitReturned: Object.freeze(["complete-v2-reopen-audit", "cleanup"]),
});
const EXACT_MUTABLE_FIELDS = Object.freeze(["descriptor_hash", "schema_identity_sha256"]);
const EXACT_IMMUTABLE_FIELDS = Object.freeze([
  "tenant_id", "token_hash", "kind", "principal_hash", "authorization_hash",
  "stream_id", "checkpoint_scope", "request_scope_blob", "page_size",
  "next_position", "snapshot_tail_sequence", "snapshot_tail_record_hash",
  "snapshot_blob", "created_at_ms", "expires_at_ms", "consumed_at_ms",
]);
const EXACT_PARAMETER_ORDER = Object.freeze([
  "targetDescriptorHash", "targetSchemaIdentitySha256",
  "sourceDescriptorHash", "sourceSchemaIdentitySha256",
]);
const EXACT_STATES = Object.freeze([
  "pre-rebind-complete", "publication-active", "cursor/clock-complete", "poisoned", "disposed",
]);
const EXACT_TRANSITIONS = Object.freeze([
  "pre-rebind-complete->publication-active", "publication-active->cursor/clock-complete",
]);
const EXACT_CURSOR_SUBPROTOCOL_STAGES = Object.freeze([
  "prepare-exact-cursor-rebind-owner-through-final-pre-execute-cancellation-without-consuming-session",
  "consume-exact-active-publication-session-and-retain-tombstone-at-final-no-write-pre-execution-boundary",
  "execute-fixed-cursor-rebind-exactly-once",
  "release-statement-and-prove-affected-changes-total-and-ledger",
  "mint-rule-11-success-receipt",
  "perform-bounded-rule-12-seal-and-mint-success-receipt",
  "observe-third-before-verification-clock-only-after-rule-12-success",
  "register-pending-cursor-clock-graph-and-three-completion-continuations",
  "consume-third-evidence-retain-tombstone-and-complete-all-three-layers",
]);
const EXACT_CURSOR_SUBPROTOCOL_CALL_ORDER = Object.freeze([
  "prepare-cursor-rebind-owner", "execute-and-prove-cursor-rebind",
  "validate-and-mint-rule-11-success-receipt",
  "validate-and-mint-rule-12-success-receipt",
  "observe-before-verification-through-exact-rule-12-owner",
  "publish-cursor-clock-atomic-completion",
]);
const EXACT_CURSOR_CLOCK_ATOMIC_TAIL = Object.freeze([
  "burn-outer-publication-session-continuation",
  "burn-stage-ownership-transfer-continuation",
  "burn-baseline-temp-stage-continuation",
  "consume-exact-pre-verification-clock-evidence-once",
  "retain-exact-pre-verification-clock-consumed-tombstone",
  "publish-cursor-clock-identity-to-stage-and-ownership",
  "publish-same-cursor-clock-identity-to-outer-and-session",
  "set-all-three-lifecycle-owners-to-cursor-clock-complete",
  "activate-and-return-opaque-cursor-clock-capability",
]);
const EXACT_CURSOR_CLOCK_ATOMIC_FORBIDDEN = Object.freeze([
  "sql", "provider-clock-callback", "cancellation-read", "fault-injection-hook",
  "caller-dispatch", "dynamic-import", "transaction-control", "cursor-execution",
  "registry-lookup-or-deletion", "commit",
]);
const EXACT_CURSOR_CLOCK_COMMITMENTS = Object.freeze([
  "pre-verification-clock-evidence-receipt-object-identity",
  "pre-verification-provider-now-ms", "provider-clock-capability-object-identity",
  "migration-lock-capability-object-identity", "sqlite-connection-object-identity",
  "begin-exclusive-transaction-lineage", "live-migration-lock-tuple",
  "publication-session-object-identity", "rule-11-success-receipt-object-identity",
  "rule-12-success-receipt-object-identity",
]);
const EXACT_AUTHORITY_OBJECTS = Object.freeze([
  "preRebindReceipt", "projectionReference", "stageOwnershipTransfer",
  "baselineTempStage", "sqliteConnection", "migrationLockCapability",
  "providerClockCapability", "outerClockEvidence", "preRebindClockEvidence",
  "preVerificationClockEvidence", "preCommitClockEvidence",
  "outerPublicationAuthority", "outerClockEvidenceConsumedTombstone", "postDdlCatalogFence",
  "postDdlPublicationReaderLease",
  "migration0002CatalogRebuildReceipt", "baselineEntriesPublicationReceipt",
  "baselineHeaderPublicationReceipt", "operationSequenceZeroPublicationReceipt",
  "migration0002CatalogRebuildConsumedTombstone",
  "baselineEntriesPublicationConsumedTombstone",
  "baselineHeaderPublicationConsumedTombstone",
  "operationSequenceZeroPublicationConsumedTombstone", "stageAdoptionReceipt",
  "publicationSession", "cursorRebindPreparedOwner",
  "publicationSessionConsumedTombstone", "cursorRebindWriteReceipt",
  "rule11SuccessReceipt", "rule12SuccessReceipt",
  "preVerificationClockEvidenceConsumedTombstone", "cursorClockCapability",
  "migrationLineagePublicationReceipt",
  "schemaDescriptorMetadataPublicationReceipt", "publicationRulesReceipt",
  "freshV2CatalogReceipt", "physicalSemanticPostconditionsReceipt",
  "preRetirementStageFenceReceipt", "stageRetirementReceipt", "finalCommitFenceReceipt",
]);
const EXACT_OUTER_COMMITMENTS = Object.freeze([
  "b2-exact-object-graph", "migration-lock-capability-object-identity",
  "migration-lock-active-expires-at-ms", "provider-clock-capability-object-identity",
  "outer-clock-evidence-object-identity",
  "outer-clock-evidence-consumed-tombstone-object-identity", "outer-provider-now-ms",
  "sqlite-connection-object-identity", "unchanged-begin-exclusive-transaction-lineage",
  "transaction-generation", "source-identities",
  "expected-target-identities", "expected-target-catalog", "outer-write-ledger",
]);
const EXACT_OUTER_AUTHORITY = Object.freeze({
  opaque: true,
  moduleMinted: true,
  mintedOnce: true,
  nonTransferable: true,
  cloneRejected: true,
  crossRunSubstitutionRejected: true,
  reusableWithinExactAuthorityGraph: true,
  notConsumedByWritesOrAdoption: true,
  retiredBy: Object.freeze(["commit-returned", "rollback", "poison", "disposal"]),
  authorizesExpectedTargetCatalog: true,
  ownsOuterMigrationWriteLedger: true,
  doesNotAuthorizeCursorRebind: true,
  consumesOuterClockEvidenceReceiptExactlyOnce: true,
  requiredCommitments: EXACT_OUTER_COMMITMENTS,
  mintLifecycle: Object.freeze({
    validatesAndRegistersInactiveAuthorityBeforeAnyReceiptConsumption: true,
    presentationFailureConsumesAnyReceipt: false,
    presentationFailureMayRetryWithSameExactEvidence: true,
    nonInterruptibleAtomicTail: Object.freeze([
      "consume-outer-clock-evidence-once",
      "mint-outer-clock-evidence-consumed-tombstone",
      "publish-b2-stage-transfer-prepared-state",
      "activate-outer-publication-authority",
    ]),
    faultInjectionForbiddenAfterAtomicTailBegins: true,
    failureAfterAtomicTailBeginsPoisonsAndRequiresRollbackAndFreshGraph: true,
  }),
});
const EXACT_ADOPTION_RECEIPTS = Object.freeze([
  "migration-0002-catalog-rebuild-receipt", "baseline-entries-publication-receipt",
  "baseline-header-publication-receipt", "operation-sequence-zero-publication-receipt",
]);
const EXACT_INITIAL_WRITE_RECEIPT_COMMON_COMMITMENTS = Object.freeze([
  "write-kind", "normalized-sql-or-repository-asset-sha256",
  "canonical-parameter-digest-with-domain-separation",
  "canonical-result-digest-with-domain-separation", "predecessor-receipt-object-identity",
  "sqlite-connection-object-identity", "unchanged-begin-exclusive-transaction-lineage",
  "outer-publication-authority-object-identity", "prepare-count", "execute-count",
  "affected-row-count", "total-changes-before-after-delta",
  "outer-ledger-logical-write-sequence-before-after-and-delta",
  "outer-ledger-fixed-statement-count-before-after-and-delta",
  "outer-ledger-affected-rows-watermark-before-after-and-delta",
]);
const EXACT_INITIAL_WRITE_RECEIPT_CONTRACT = Object.freeze({
  opaqueModuleMintedSingleUse: true,
  cloneRejected: true,
  substitutionRejected: true,
  crossRunReplayRejected: true,
  order: EXACT_ADOPTION_RECEIPTS,
  requiredCommonCommitments: EXACT_INITIAL_WRITE_RECEIPT_COMMON_COMMITMENTS,
  canonicalDigestCodec: Object.freeze({
    parameterDomainUtf8: "graph-engineering/sqlite-initial-write-parameters/v1\0",
    resultDomainUtf8: "graph-engineering/sqlite-initial-write-result/v1\0",
    algorithm: "sha256-domain-utf8-plus-canonical-json-utf8",
    canonicalJsonProfile:
      "graph-engineering/canonical-json/v1alpha1-unicode-code-point-key-order",
    domainConcatenation:
      "domain-utf8-bytes-followed-immediately-by-canonical-json-utf8-no-delimiter",
    parameterPayload: "exact-order-array-of-tagged-scalars",
    allowedScalarEncodings: Object.freeze([
      "text-utf8", "integer-decimal", "blob-base64url", "null",
    ]),
    textEncoding: "tagged-object-type-text-utf8-unchanged-unicode-scalars-no-normalization",
    integerEncoding: "tagged-object-type-integer-decimal-canonical-minus-zero-forbidden",
    blobEncoding: "tagged-object-type-blob-unpadded-rfc4648-section-5-base64url",
    nullEncoding: "tagged-object-type-null-no-value-field",
    taggedScalarShapes: Object.freeze({
      text: Object.freeze({
        exactKeysInCanonicalOrder: Object.freeze(["type", "value"]),
        typeLiteral: "text",
        valueEncoding: "unchanged-unicode-scalar-string",
      }),
      integer: Object.freeze({
        exactKeysInCanonicalOrder: Object.freeze(["type", "value"]),
        typeLiteral: "integer",
        valueEncoding: "canonical-decimal-string-negative-zero-forbidden",
      }),
      blob: Object.freeze({
        exactKeysInCanonicalOrder: Object.freeze(["type", "value"]),
        typeLiteral: "blob",
        valueEncoding: "unpadded-rfc4648-section-5-base64url",
      }),
      null: Object.freeze({
        exactKeysInCanonicalOrder: Object.freeze(["type"]),
        typeLiteral: "null",
        valueMemberForbidden: true,
      }),
    }),
    parameterArrayOrder: "exact-parameter-order",
    resultPayload: "affected-rows-decimal-string",
    resultObjectShape: Object.freeze({
      exactKeysInCanonicalOrder: Object.freeze(["affectedRows"]),
      affectedRowsEncoding: "canonical-nonnegative-decimal-string",
      aggregation: "complete-logical-receipt-aggregate-not-per-execution-array",
    }),
    affectedRowsDecimalPattern: "^(0|[1-9][0-9]*)$",
    lastInsertRowidIncluded: false,
  }),
  runtimeIdentityByRuntime: Object.freeze({
    typescript: Object.freeze({
      creationRuntime: "graph-engineering-typescript",
      creationRuntimeVersion: "0.1.0-alpha.1",
    }),
    python: Object.freeze({
      creationRuntime: "graph-engineering-python",
      creationRuntimeVersion: "0.1.0a1",
    }),
  }),
  predecessorChain: Object.freeze({
    migration0002CatalogRebuildReceipt: "outer-publication-authority",
    baselineEntriesPublicationReceipt:
      "migration-0002-catalog-rebuild-receipt-and-post-ddl-catalog-fence",
    baselineHeaderPublicationReceipt: "baseline-entries-publication-receipt",
    operationSequenceZeroPublicationReceipt: "baseline-header-publication-receipt",
  }),
  migration0002CatalogRebuildReceipt: Object.freeze({
    repositoryAssetSha256: EXACT_IDENTITIES.migrationSqlSha256,
    logicalAssetExecutionCount: 1,
    logicalPrepareCount: 20,
    logicalPrepareCountSemantics:
      "one-logical-prepare-per-fixed-asset-statement-independent-of-adapter-api-call-count",
    fixedAssetStatementCount: 20,
    adapterApiCallCountCrossRuntimeEqualityRequired: false,
    schemaCopyRowCountFormula: "1",
    legacyOperationCopyRowCountFormula: "projection.legacyOperationCount",
    affectedRowCountFormula: "1 + projection.legacyOperationCount",
    totalChangesDeltaFormula: "affected-row-count",
    outerLedgerLogicalWriteSequenceDelta: 1,
    outerLedgerFixedStatementCountDelta: 20,
    outerLedgerAffectedRowsDeltaFormula: "1 + projection.legacyOperationCount",
    requiredCommitments: Object.freeze([
      "exact-repository-asset-bytes-and-sha256",
      "preview-manifest-object-and-sha256-identities", "schema-copy-row-count",
      "legacy-operation-copy-row-count", "application-id-before-and-after",
      "user-version-before-and-after", "pre-ddl-physical-catalog-digest",
      "post-ddl-physical-catalog-digest",
    ]),
  }),
  baselineEntriesPublicationReceipt: Object.freeze({
    sourceReadSql: "SELECT kind_rank, entry_kind, key_blob, state_blob FROM temp.ge_blr_stage ORDER BY kind_rank ASC, key_blob ASC",
    sourceReadSqlSha256: "adae52750ecd70a75090b52de7d60763eea144c1383cf4739df9d8e8a6b2357f",
    sourceReadParameterOrder: Object.freeze([]),
    sourceReadRowShape: Object.freeze(["kindRank", "entryKind", "keyBlob", "stateBlob"]),
    insertSql: "INSERT INTO main.ge_cycle_operation_baseline_entries (baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, previous_entry_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    insertSqlSha256: "b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b",
    parameterOrder: Object.freeze([
      "baselineId", "ordinal", "entryKind", "entryKeyBlob", "entryStateBlob",
      "previousEntryHash", "entryHash",
    ]),
    resultShape: "sqlite-run-changes-exactly-one-no-returning-rows",
    prepareCount: 1,
    executeCountFormula: "projection.entryCount",
    affectedRowCountFormula: "projection.entryCount",
    totalChangesDeltaFormula: "projection.entryCount",
    outerLedgerLogicalWriteSequenceDelta: 1,
    outerLedgerFixedStatementCountDeltaFormula: "projection.entryCount",
    outerLedgerAffectedRowsDeltaFormula: "projection.entryCount",
    requiredCommitments: Object.freeze([
      "baseline-id", "entry-count", "ordered-temp-stage-scan-sql-identity-and-sha256",
      "fixed-baseline-entry-insert-sql-identity-and-sha256",
      "ordinal-and-entry-hash-continuity", "first-entry-hash", "final-root-hash",
      "projection-reference-object-identity",
    ]),
  }),
  baselineHeaderPublicationReceipt: Object.freeze({
    insertSql: "INSERT INTO main.ge_cycle_operation_baselines (baseline_id, baseline_format_version, source_application_id, source_user_version, source_schema_identity_sha256, source_migration_lineage_id, source_migration_lineage_sha256, source_descriptor_hash, captured_at_ms, legacy_operation_count, entry_count, first_entry_hash, final_entry_hash, canonical_projection_sha256, creation_runtime, creation_runtime_version, policy_blob) VALUES (?, 1, 1195724359, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    insertSqlSha256: "b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a",
    parameterOrder: Object.freeze([
      "baselineId", "sourceSchemaIdentitySha256", "sourceMigrationLineageId",
      "sourceMigrationLineageSha256", "sourceDescriptorHash", "capturedAtMs",
      "legacyOperationCount", "entryCount", "firstEntryHash", "finalEntryHash",
      "canonicalProjectionSha256", "creationRuntime", "creationRuntimeVersion", "policyBlob",
    ]),
    resultShape: "sqlite-run-changes-exactly-one-no-returning-rows",
    prepareCount: 1,
    executeCount: 1,
    affectedRowCountFormula: "1",
    totalChangesDeltaFormula: "1",
    outerLedgerLogicalWriteSequenceDelta: 1,
    outerLedgerFixedStatementCountDelta: 1,
    outerLedgerAffectedRowsDelta: 1,
    creationRuntimeSource: "runtime-owned-stable-runtime-identity",
    creationRuntimeVersionSource: "runtime-owned-stable-runtime-version",
    callerOrAmbientInterpreterIdentityAllowed: false,
    requiredCommitments: Object.freeze([
      "baseline-id", "entry-count", "legacy-operation-count",
      "projection-reference-object-identity", "first-entry-hash", "final-root-hash",
      "creation-runtime", "creation-runtime-version", "policy-blob-bytes-and-sha256",
    ]),
  }),
  operationSequenceZeroPublicationReceipt: Object.freeze({
    insertSql: "INSERT INTO main.ge_cycle_operation_sequence (singleton, baseline_id, last_commit_sequence, baseline_captured_at_ms, updated_at_ms) VALUES (1, ?, 0, ?, ?)",
    insertSqlSha256: "a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85",
    parameterOrder: Object.freeze(["baselineId", "baselineCapturedAtMs", "updatedAtMs"]),
    resultShape: "sqlite-run-changes-exactly-one-no-returning-rows",
    prepareCount: 1,
    executeCount: 1,
    affectedRowCountFormula: "1",
    totalChangesDeltaFormula: "1",
    outerLedgerLogicalWriteSequenceDelta: 1,
    outerLedgerFixedStatementCountDelta: 1,
    outerLedgerAffectedRowsDelta: 1,
    updatedAtMsSource: "provider-authoritative-outer-clock-evidence",
    requiredLastCommitSequence: 0,
    requiredCommitments: Object.freeze([
      "baseline-id", "last-commit-sequence-zero",
      "baseline-captured-at-ms-from-b2-projection", "updated-at-ms",
      "outer-clock-evidence-receipt-object-identity", "outer-provider-now-ms",
    ]),
  }),
});
const EXACT_POST_DDL_CATALOG_FENCE = Object.freeze({
  opaque: true,
  moduleMinted: true,
  mintedOnce: true,
  cloneRejected: true,
  substitutionRejected: true,
  crossRunOrPostRetirementReplayRejected: true,
  repeatedExactPresentationWithinLiveAuthorityGraphAllowed: true,
  reusableAsExactProofWithinAuthorityGraph: true,
  consumesAnyWriteReceipt: false,
  proofScope: "post-0002-physical-target-catalog-before-baseline-publication",
  mintedAfterMigration0002BeforeBaselineDml: true,
  isFinalV2SemanticProof: false,
  requiredCommitments: Object.freeze([
    "sqlite-connection-object-identity", "unchanged-begin-exclusive-transaction-lineage",
    "outer-publication-authority-object-identity",
    "migration-0002-catalog-rebuild-receipt-object-identity",
    "current-runtime-private-internal-epoch", "total-changes-watermark",
    "outer-write-ledger-watermark", "sqlite-schema-canonical-digest", "application-id",
    "user-version", "expected-complete-target-physical-catalog-inventory",
  ]),
});
const EXACT_POST_DDL_PUBLICATION_READER_LEASE = Object.freeze({
  opaque: true,
  moduleMinted: true,
  mintedOnce: true,
  cloneRejected: true,
  substitutionRejected: true,
  replayRejected: true,
  permitsOnlyFixedOrderedTempSelect: true,
  permanentWriteAuthority: false,
  consumesAnyWriteReceipt: false,
  maximumConcurrentReaders: 1,
  exactCursorCloseCountAfterOwnershipBegins: 1,
  cancellationClosesCursorBeforeCleanup: true,
  rederivesOrdinalAndEntryHashChainEqualExactProjection: true,
  mayAdoptOnlyReadProofWatermarks: true,
  mayMintStageAdoptionReceipt: false,
  activeReaderForbiddenAtStageAdoption: true,
  readerLifecycle: Object.freeze({
    states: Object.freeze([
      "minted-unused", "reader-active", "reader-closed", "retired", "poisoned",
    ]),
    cursorOwnershipBeginsAt: "successful-fixed-source-read-execute-return",
    prepareOrExecuteFailureBeforeCursorOwnershipCloseCount: 0,
    normalCancellationOrPrimaryFailureAfterOwnershipCloseCount: 1,
    successfulCloseRetiresLease: true,
    secondReaderOpenRejected: true,
    reuseAfterCloseRejected: true,
    closeFailurePoisonsAndRequiresRollback: true,
    primaryFailurePrecedesCloseFailure: true,
    closeFailurePrecedesCancellationAndOuterCleanup: true,
    cancellationObservedAfterRequiredCloseAttempt: true,
  }),
  requiredCommitments: Object.freeze([
    "b2-exact-object-graph", "outer-publication-authority-object-identity",
    "migration-0002-catalog-rebuild-receipt-object-identity",
    "post-ddl-catalog-fence-object-identity", "sqlite-connection-object-identity",
    "unchanged-begin-exclusive-transaction-lineage",
    "fixed-source-read-sql-identity-and-sha256", "current-runtime-private-read-proof-epoch",
    "total-changes-and-outer-write-ledger-read-watermarks",
    "exact-projection-reference-object-identity",
  ]),
});
const EXACT_STAGE_ADOPTION_RECEIPT = Object.freeze({
  opaque: true,
  moduleMinted: true,
  mintedOnce: true,
  cloneRejected: true,
  substitutionRejected: true,
  crossRunOrPostRetirementReplayRejected: true,
  repeatedExactPresentationWithinLiveAuthorityGraphAllowed: true,
  reusableAsExactProofWithinAuthorityGraph: true,
  requiredCommitments: Object.freeze([
    "b2-pre-rebind-receipt-object-identity", "b2-projection-reference-object-identity",
    "b2-stage-ownership-transfer-object-identity", "b2-baseline-temp-stage-object-identity",
    "sqlite-connection-object-identity", "unchanged-begin-exclusive-transaction-lineage",
    "outer-publication-authority-object-identity", "post-ddl-catalog-fence-object-identity",
    "four-original-initial-write-receipt-object-identities",
    "four-consumed-initial-write-receipt-tombstone-identities",
    "current-adopted-runtime-private-internal-epoch",
    "total-changes-and-outer-write-ledger-watermarks", "target-physical-catalog-digest",
    "retired-b2-v1-catalog-and-change-fence-object-identity",
  ]),
});
const EXACT_INITIAL_STAGE_ADOPTION_SEMANTICS = Object.freeze({
  packagePrivateIntrinsic: true,
  callerConstructedReceiptsAllowed: false,
  adoptsAfterOuterWrites: true,
  requiredOuterWriteReceipts: EXACT_ADOPTION_RECEIPTS,
  requiresExactOuterPublicationAuthority: true,
  requiresExactPostDdlCatalogFence: true,
  requiresStatementIdentityAndAffectedCountLedger: true,
  requiresTotalChangesDeltaEquality: true,
  retiresOnlyB2V1CatalogAndChangeFence: true,
  preservesPostDdlCatalogFence: true,
  mintsStageAdoptionReceiptOnce: true,
  consumesRequiredOuterWriteReceiptsExactlyOnce: true,
  validatesCompleteBundleBeforeAnyConsumption: true,
  faultInjectionForbiddenAfterAtomicConsumptionBegins: true,
  failedBundleValidationConsumesAnyReceipt: false,
  failedBundleMayRetryWithSameExactBundle: true,
  presentationFailureRetryRequiresCorrectedCompleteBundle: true,
  authorityLineageLockCatalogOrLedgerFailurePoisonsAndRollsBack: true,
  mintsConsumedReceiptTombstones: Object.freeze([
    "migration-0002-catalog-rebuild-consumed-tombstone",
    "baseline-entries-publication-consumed-tombstone",
    "baseline-header-publication-consumed-tombstone",
    "operation-sequence-zero-publication-consumed-tombstone",
  ]),
});
const EXACT_COMMITMENTS = Object.freeze([
  "receipt-object-identity", "projection-reference-object-identity", "stage-object-identity",
  "connection-object-identity", "transaction-generation", "migration-lock-id",
  "migration-lock-owner-id", "migration-lock-epoch", "migration-lock-fencing-token",
  "migration-lock-capability-object-identity", "migration-lock-active-expires-at-ms",
  "migration-source-version", "migration-target-version",
  "provider-clock-capability-object-identity",
  "pre-rebind-clock-evidence-receipt-object-identity", "pre-rebind-provider-now-ms",
  "post-0002-catalog-fence-object-identity", "stage-adoption-receipt-object-identity",
  "source-descriptor-hash",
  "source-schema-identity", "target-descriptor-hash", "target-schema-identity",
]);
const EXACT_HOSTILE = Object.freeze([
  "diagnosed-b2-outcome", "cloned-receipt", "cloned-projection", "wrong-stage",
  "wrong-transfer", "wrong-connection", "wrong-publication-session",
  "inactive-migration-lock", "wrong-lock-owner", "wrong-lock-epoch", "wrong-lock-fence",
  "wrong-lock-source-version", "wrong-lock-target-version",
  "cloned-migration-lock-capability", "provider-clock-evidence-substitution",
  "lock-expiry-before-provider-now", "lock-expiry-equal-provider-now",
  "lock-expiry-changed-after-session-mint",
  "provider-clock-advanced-past-expiry-after-session-mint",
  "stale-provider-clock-evidence-replay", "missing-post-cursor-lineage-receipt",
  "missing-post-cursor-metadata-receipt", "pre-retirement-stage-fence-substitution",
  "stage-retirement-receipt-substitution", "owned-temp-residue-after-retirement",
  "provider-clock-receipt-clone", "provider-clock-boundary-reordered",
  "provider-clock-boundary-skipped", "provider-clock-regression",
  "provider-clock-fifth-observation", "post-cursor-receipt-order-swapped",
  "post-cursor-unexplained-write", "pre-retirement-adoption-before-audits",
  "pre-retirement-adoption-reuse", "temp-same-name-identity-substitution",
  "unrelated-temp-object-dropped", "active-main-key-count-cursor-at-retirement",
  "active-key-driver-cursor-at-retirement", "active-point-cursor-at-retirement",
  "permanent-write-after-retirement", "final-commit-fence-reuse",
  "main-key-count-cancellation-close-failure",
  "main-key-count-driver-prepare-before-close",
  "same-ddl-rootpage-reuse-after-temp-recreate",
  "pre-verification-clock-receipt-second-consumption",
  "pre-rebind-clock-receipt-unconsumed", "pre-rebind-clock-receipt-substitution",
  "cursor-clock-capability-clone", "cursor-clock-preverification-unconsumed",
  "lineage-publication-receipt-substitution", "metadata-publication-receipt-substitution",
  "pre-retirement-receipt-commitment-drift", "retirement-receipt-commitment-drift",
  "final-commit-receipt-commitment-drift", "outer-write-receipt-order-swapped",
  "audit-receipt-second-consumption", "missing-consumed-audit-tombstone",
  "outer-write-receipt-second-consumption", "missing-consumed-outer-write-tombstone",
  "outer-clock-evidence-receipt-unconsumed",
  "outer-clock-consumed-tombstone-missing",
  "cancellation-before-outer-authority-atomic-tail",
  "fault-injection-during-outer-authority-atomic-tail",
  "initial-write-receipt-second-consumption",
  "initial-write-receipt-partial-consumption-on-failed-bundle",
  "missing-initial-write-consumed-tombstone",
  "outer-publication-authority-clone", "outer-publication-authority-substitution",
  "outer-publication-authority-cross-run-replay",
  "outer-publication-authority-use-after-retirement",
  "outer-publication-authority-consumed-by-write",
  "migration-0002-repository-asset-byte-drift",
  "migration-0002-repository-asset-hash-drift", "migration-0002-partial-execution",
  "migration-0002-second-execution", "migration-0002-affected-row-formula-disagreement",
  "migration-0002-total-changes-formula-disagreement",
  "migration-0002-outer-ledger-formula-disagreement", "post-ddl-catalog-fence-clone",
  "post-ddl-catalog-fence-substitution", "post-ddl-catalog-fence-early-mint",
  "post-ddl-catalog-fence-digest-disagreement",
  "post-ddl-catalog-query-row-encoding-or-inventory-drift", "initial-write-receipt-missing",
  "initial-write-receipt-reordered", "initial-write-receipt-duplicate",
  "initial-write-receipt-clone", "initial-write-receipt-wrong-predecessor",
  "initial-write-receipt-wrong-authority", "initial-write-receipt-wrong-lineage",
  "initial-write-receipt-wrong-connection", "initial-write-parameter-digest-drift",
  "baseline-entry-parameter-execution-framing-drift", "initial-write-result-digest-drift",
  "baseline-header-duplicate-execution", "baseline-header-caller-runtime-identity",
  "baseline-header-ambient-interpreter-version",
  "operation-sequence-zero-duplicate-execution",
  "operation-sequence-zero-caller-timestamp", "stage-adoption-receipt-clone",
  "stage-adoption-receipt-cross-run-or-post-retirement-replay",
  "stage-adoption-receipt-substitution", "cancellation-before-stage-adoption-atomic-consume",
  "fault-injection-during-stage-adoption-atomic-consume",
  "initial-write-receipt-substitution", "initial-write-receipt-cross-run-replay",
  "post-ddl-catalog-fence-cross-run-or-post-retirement-replay",
  "post-ddl-publication-reader-lease-clone",
  "post-ddl-publication-reader-lease-substitution",
  "post-ddl-publication-reader-lease-cross-run-replay",
  "post-ddl-publication-reader-lease-sql-drift",
  "post-ddl-publication-reader-lease-order-drift",
  "post-ddl-publication-reader-lease-projection-mismatch",
  "post-ddl-publication-reader-second-open",
  "post-ddl-publication-reader-cursor-leak-at-adoption",
  "post-ddl-publication-reader-cancellation-close-failure",
  "post-ddl-publication-reader-prepare-failure-close-count-drift",
  "post-ddl-publication-reader-close-failure-not-poisoned",
  "post-ddl-publication-reader-reuse-after-close",
  "stage-adoption-reader-lease-terminal-proof-missing",
  "baseline-entry-insert-sql-hash-drift", "baseline-entry-partial-execution",
  "initial-publication-parity-array-wrong-length",
  "initial-publication-parity-array-order-swapped",
  "initial-publication-parity-array-non-integer",
  "rollback-and-rebegin",
  "post-0002-catalog-drift", "unexplained-permanent-write", "affected-count-minus-one",
  "affected-count-plus-one", "total-changes-disagreement", "write-ledger-disagreement",
  "second-rebind", "partial-rebind", "mixed-source-target-identities",
  "third-party-identities", "immutable-field-drift", "same-length-request-blob-drift",
  "same-length-snapshot-blob-drift", "cursor-insert", "cursor-delete",
  "equal-count-insert-delete", "root-preserving-count-drift", "second-verification",
  "disposed-reuse",
]);
const EXACT_PARITY = Object.freeze([
  "literal-fixture-consumed-by-both-runtimes", "exact-sql-and-hash-parity",
  "exact-target-identity-parity", "exact-state-transition-parity",
  "exact-failure-precedence-parity", "exact-count-root-parity", "fresh-v2-path",
  "v1-to-v2-path", "v0-to-v1-to-v2-path", "cross-runtime-upgrade-and-reopen",
  "npm-wheel-sdist-asset-byte-parity", "pre-commit-crash-reopens-v1",
  "post-commit-crash-reopens-v2",
]);
const EXACT_INITIAL_PUBLICATION_PARITY_OUTPUT = Object.freeze({
  orderedFields: Object.freeze([
    "caseId", "outcome", "failureBoundary", "state", "poisoned",
    "providerClockReadCount", "clockEvidenceConsumeCount", "outerAuthorityMintCount",
    "perWritePrepareCounts", "perWriteExecuteCounts", "perWriteAffectedRowCounts",
    "perWriteTotalChangesDeltas", "outerLedgerLogicalWriteSequence",
    "outerLedgerFixedStatementCount", "outerLedgerAffectedRowsWatermark",
    "postDdlCatalogFenceMintCount", "readerLeaseMintCount", "readerLeaseCloseCount",
    "initialWriteReceiptMintCount", "initialWriteReceiptConsumeCount",
    "initialWriteReceiptTombstoneCount", "stageAdoptionReceiptMintCount",
    "bundleRetryable", "sameTransactionLineage", "catalogFenceMatches",
    "cursorRebindPrepareCount", "cursorRebindExecuteCount", "commitCount",
  ]),
  excludedFields: Object.freeze([
    "opaqueObjectAddresses", "runtimePrivateInternalEpochValues", "adapterApiCallCounts",
  ]),
  requiresRealHookInstrumentation: true,
  counterSelfProbe: Object.freeze({
    providerClockReadCount: 1,
    clockEvidenceConsumeCount: 1,
    outerAuthorityMintCount: 1,
  }),
  fourWriteArrayContract: Object.freeze({
    exactOrder: EXACT_ADOPTION_RECEIPTS,
    exactLength: 4,
    elementType: "nonnegative-safe-integer",
    coveredFields: Object.freeze([
      "perWritePrepareCounts", "perWriteExecuteCounts", "perWriteAffectedRowCounts",
      "perWriteTotalChangesDeltas",
    ]),
    successfulPrepareCounts: Object.freeze([20, 1, 1, 1]),
    successfulExecuteCountFormulas: Object.freeze([
      "1", "projection.entryCount", "1", "1",
    ]),
    successfulAffectedRowCountFormulas: Object.freeze([
      "1 + projection.legacyOperationCount", "projection.entryCount", "1", "1",
    ]),
    successfulTotalChangesDeltaFormulas: Object.freeze([
      "1 + projection.legacyOperationCount", "projection.entryCount", "1", "1",
    ]),
    failureCaseEncoding:
      "actual-real-hook-counts-for-all-four-slots-with-unreached-slots-zero",
  }),
  preRebindCasesRequireZeroCursorRebindAndCommitCounts: true,
});
const EXACT_FAULTS = Object.freeze([
  "before-outer-publication-authority", "after-outer-publication-authority", "after-0002",
  "after-baseline-first-entry", "after-baseline-middle-entry", "after-baseline-last-entry",
  "after-baseline-header", "after-sequence-zero", "before-cursor-rebind",
  "after-cursor-rebind", "after-rule-11", "during-rule-12-first-row",
  "during-rule-12-middle-row", "during-rule-12-last-row", "after-rule-12",
  "after-lineage", "after-metadata", "after-publication-rules", "before-commit",
  "commit-returned",
]);
const EXACT_CANCELLATION_LABELS = Object.freeze([
  "before-outer-authority", "before-0002", "after-post-ddl-fence",
  "before-baseline-reader-prepare", "before-baseline-reader-first-fetch",
  "before-baseline-reader-next-fetch", "before-baseline-reader-finish",
  "before-initial-stage-adoption", "before-cursor-session", "before-rebind-prepare",
  "before-rebind-execute",
  "after-rebind-execute", "before-rule-11", "before-main-key-count-prepare",
  "before-main-key-count-first-fetch", "before-main-key-count-next-fetch",
  "before-main-key-count-finish", "before-key-driver-prepare",
  "before-key-driver-first-fetch", "before-key-driver-next-fetch",
  "before-point-lookup-prepare", "before-point-lookup-execute",
  "after-point-lookup-fetch", "before-rule-12-finish", "before-cursor-clock-complete",
]);
const EXACT_STATEMENT_BOUNDARIES = Object.freeze([
  "baseline-reader-prepare", "baseline-reader-fetch", "baseline-reader-finalize",
  "rebind-prepare", "rebind-execute", "rebind-finalize", "changes-prepare",
  "changes-fetch", "changes-finalize", "main-key-count-prepare", "main-key-count-fetch",
  "main-key-count-finalize",
  "key-driver-prepare", "key-driver-fetch", "key-driver-finalize", "point-lookup-prepare",
  "point-lookup-execute", "point-lookup-fetch", "point-lookup-finalize",
]);
const EXACT_CLEANUP_FAULTS = Object.freeze([
  "baseline-reader-finalize-failure", "rebind-finalize-failure",
  "changes-finalize-failure", "main-key-count-finalize-failure",
  "key-driver-finalize-failure", "point-lookup-finalize-failure",
  "temp-carrier-disposal-failure", "primary-plus-cleanup-failure",
]);
const EXACT_EQP = Object.freeze([
  "temp-driver-primary-key-order-without-sort",
  "main-cursor-primary-key-count-order-without-sort",
  "main-cursor-primary-key-point-lookup",
]);
const EXACT_CLEANUP_ORDER = Object.freeze({
  mainKeyCountSuccess: Object.freeze([
    "close-main-key-count-cursor", "clear-main-key-count-ownership", "prepare-key-driver",
  ]),
  mainKeyCountFailureOrCancellation: Object.freeze([
    "main-key-count-cursor", "temp-stage", "outer-cleanup",
  ]),
  sealFailureOrCancellation: Object.freeze([
    "point-cursor", "driver-cursor", "temp-stage", "outer-cleanup",
  ]),
});
const EXACT_CANCELLATION_SEMANTICS = Object.freeze({
  labelsAreRequestInjectionPoints: true,
  rebindStartedPrimaryBeforeCancellation: Object.freeze([
    "statement-release", "changes-result", "write-ledger", "rule-11",
  ]),
  baselineReaderRowStartedPrimaryBeforeCancellation: Object.freeze([
    "decode-current-baseline-row", "validate-order-and-projection",
    "advance-rederived-hash-chain",
  ]),
  baselineReaderBeforeFetchCancellation: Object.freeze([
    "close-baseline-reader-cursor", "clear-baseline-reader-ownership",
    "observe-cancellation",
  ]),
  baselineReaderTerminalPrimaryBeforeCancellation: Object.freeze([
    "prove-terminal-row-count", "prove-final-entry-root", "close-baseline-reader-cursor",
    "clear-baseline-reader-ownership",
  ]),
  baselineReaderCloseFailurePrecedence: Object.freeze([
    "earlier-prepare-fetch-decode-order-projection-or-terminal-primary",
    "baseline-reader-close-failure", "cancellation", "temp-or-outer-cleanup-failure",
  ]),
  baselineReaderCancellationClosesCursorBeforeTempCleanup: true,
  mainKeyCountRowStartedPrimaryBeforeCancellation: Object.freeze([
    "decode-current-main-key", "validate-current-main-key", "increment-main-key-count",
  ]),
  mainKeyCountBeforeFetchCancellation: Object.freeze([
    "close-main-key-count-cursor", "clear-main-key-count-ownership", "observe-cancellation",
  ]),
  mainKeyCountTerminalPrimaryBeforeCancellation: Object.freeze([
    "prove-terminal-result", "close-main-key-count-cursor",
    "clear-main-key-count-ownership", "freeze-main-key-count",
  ]),
  mainKeyCountTerminalCancellationObservedAfterFrozenCount: true,
  mainKeyCountCloseFailurePrecedence: Object.freeze([
    "earlier-fetch-decode-order-count-or-terminal-primary",
    "main-key-count-close-failure", "cancellation",
    "temp-or-outer-cleanup-failure",
  ]),
  mainKeyCountCancellationClosesCursorBeforeTempCleanup: true,
  rule12RowStartedPrimaryBeforeCancellation: Object.freeze([
    "decode-current-main-row", "validate-current-main-row", "close-point-cursor",
  ]),
  rule12FinalPrimaryBeforeCancellation: Object.freeze([
    "finish-accumulator", "compare-main-key-count", "compare-receipt-count-root",
    "compare-target-identities",
  ]),
  cleanupAlwaysLast: true,
});
const EXACT_SQL = Object.freeze({
  rebind: "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, schema_identity_sha256 = ? WHERE descriptor_hash = ? AND schema_identity_sha256 = ?",
  affectedCount: "SELECT changes() AS affected_rows",
  postRebindMainKeyCountScan: "SELECT tenant_id, token_hash FROM main.ge_cycle_cursors ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY",
  postRebindKeyDriver: "SELECT tenant_id, token_hash FROM temp.ge_blr_cursor_seal ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
  postRebindPointLookup: "SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash, stream_id, checkpoint_scope, request_scope_blob, page_size, next_position, snapshot_tail_sequence, snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256, snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms FROM main.ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ? LIMIT 1",
});

export class CursorPublicationContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CursorPublicationContractError";
    this.code = code;
  }
}
function fail(code, message) { throw new CursorPublicationContractError(code, message); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
export function normalizeSql(sql) { return sql.trim().replace(/[\t\n\v\f\r ]+/gu, " "); }
function assertUnicodeScalarString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) {
        fail("GE_CURSOR_B3_CANONICAL_UNICODE", "canonical JSON contains an unpaired high surrogate");
      }
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      fail("GE_CURSOR_B3_CANONICAL_UNICODE", "canonical JSON contains an unpaired low surrogate");
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
assert.equal(
  JSON.stringify(canonicalize({ "😀": "non-bmp", "": "bmp-private-use" })),
  "{\"\":\"bmp-private-use\",\"😀\":\"non-bmp\"}",
  "canonical JSON keys must be ordered by Unicode code point",
);
assert.throws(
  () => canonicalize({ "\uD800": "unpaired-key" }),
  (error) => error instanceof CursorPublicationContractError
    && error.code === "GE_CURSOR_B3_CANONICAL_UNICODE",
  "canonical JSON must reject unpaired surrogate keys",
);
assert.throws(
  () => canonicalize("\uDC00"),
  (error) => error instanceof CursorPublicationContractError
    && error.code === "GE_CURSOR_B3_CANONICAL_UNICODE",
  "canonical JSON must reject unpaired surrogate values",
);
function fixtureDigest(value) {
  const copy = structuredClone(value);
  copy.parityGates.fixtureCanonicalSha256 = "0".repeat(64);
  return domainSeparatedCanonicalDigest(TRUSTED_FIXTURE_DOMAIN, copy);
}
function canonicalObjectDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}
function domainSeparatedCanonicalDigest(domain, value) {
  return sha256(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from(JSON.stringify(canonicalize(value)), "utf8"),
  ]));
}
function exact(actual, expected, code, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code, message);
}
function exactDigest(actual, expectedDigest, code, message) {
  if (canonicalObjectDigest(actual) !== expectedDigest) fail(code, message);
}

function validateGoldenDigestVectors(codec) {
  const expectedIds = [
    "one-empty-execution", "one-mixed-execution", "two-executions",
    "integer-signed-64-minimum", "integer-signed-64-maximum",
    "result-zero", "result-three",
  ];
  exact(codec.goldenVectors.map(({ id }) => id), expectedIds,
    "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS", "canonical digest vector order drifted");
  for (const vector of codec.goldenVectors) {
    const domain = vector.kind === "parameters" ? codec.parameterDomainUtf8 : codec.resultDomainUtf8;
    if (sha256(Buffer.concat([
      Buffer.from(domain, "utf8"), Buffer.from(vector.canonicalJson, "utf8"),
    ])) !== vector.sha256) {
      fail("GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS", `${vector.id} digest vector drifted`);
    }
    const decoded = parseStrictJson(vector.canonicalJson);
    if (JSON.stringify(canonicalize(decoded)) !== vector.canonicalJson) {
      fail("GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS", `${vector.id} is not canonical JSON`);
    }
    if (vector.kind === "parameters") {
      for (const execution of decoded) {
        for (const scalar of execution) {
          if (scalar.type === "integer") {
            if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u.test(scalar.value)) {
              fail("GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS",
                `${vector.id} has a noncanonical integer lexeme`);
            }
            const integer = BigInt(scalar.value);
            if (integer < -9223372036854775808n || integer > 9223372036854775807n) {
              fail("GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS",
                `${vector.id} exceeds the signed 64-bit range`);
            }
          }
        }
      }
    }
  }
}

function validateInitialPublicationParity(parity, states) {
  if (parity.orderedFields.length !== 28
      || Object.keys(parity.fieldTypes).length !== 28) {
    fail("GE_CURSOR_B3_PARITY_OUTPUT", "normalized parity output must freeze 28 fields");
  }
  exact(Object.keys(parity.fieldTypes), parity.orderedFields,
    "GE_CURSOR_B3_PARITY_OUTPUT", "normalized parity field types are not ordered exactly");
  const arrayFields = new Set(parity.fourWriteArrayContract.coveredFields);
  const outcomes = new Set(["success", "rejected", "poisoned"]);
  const stateSet = new Set(states);
  for (const record of parity.expectedRecords) {
    exact(Object.keys(record), parity.orderedFields,
      "GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId} normalized output shape drifted`);
    for (const field of parity.orderedFields) {
      const type = parity.fieldTypes[field];
      const fieldValue = record[field];
      if (type === "non-empty-string") {
        if (field !== "caseId" || typeof fieldValue !== "string" || fieldValue.length === 0) {
          fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} is not a non-empty string`);
        }
      } else if (type === "enum-success-rejected-poisoned") {
        if (field !== "outcome" || !outcomes.has(fieldValue)) {
          fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} is not a valid outcome`);
        }
      } else if (type === "slug-or-null") {
        if (field !== "failureBoundary"
            || (fieldValue !== null
              && (typeof fieldValue !== "string"
                || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(fieldValue)))) {
          fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} is not null or a valid slug`);
        }
      } else if (type === "enum-state-machine-states") {
        if (field !== "state" || typeof fieldValue !== "string" || !stateSet.has(fieldValue)) {
          fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} is not a state-machine state`);
        }
      } else if (type === "exact-four-nonnegative-safe-integers") {
        if (!arrayFields.has(field)) {
          fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} is not declared as a four-write field`);
        }
        if (!Array.isArray(fieldValue) || fieldValue.length !== 4
            || fieldValue.some((entry) => !Number.isSafeInteger(entry) || entry < 0)) {
          fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} is not an exact four-counter array`);
        }
      } else if (type === "nonnegative-safe-integer") {
        if (!Number.isSafeInteger(fieldValue) || fieldValue < 0) {
          fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} is not a nonnegative safe integer`);
        }
      } else if (type === "boolean") {
        if (typeof fieldValue !== "boolean") {
          fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} is not Boolean`);
        }
      } else {
        fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId}.${field} has an unknown field type`);
      }
    }
    if (parity.preRebindCasesRequireZeroCursorRebindAndCommitCounts
        && (record.cursorRebindPrepareCount !== 0 || record.cursorRebindExecuteCount !== 0
          || record.commitCount !== 0)) {
      fail("GE_CURSOR_B3_PARITY_OUTPUT", `${record.caseId} crossed the pre-rebind boundary`);
    }
  }
}

function validateHostileExecutionContract(value) {
  const contract = value.hostileExecutionContract;
  const parity = value.parityGates.initialPublicationNormalizedOutput;
  const semanticFields = new Set([
    "caseId", "outcome", "failureBoundary", "state", "poisoned", "bundleRetryable",
    "sameTransactionLineage", "catalogFenceMatches",
  ]);
  const counterFields = parity.orderedFields.filter((field) => !semanticFields.has(field));
  if (contract.records.length !== 145 || value.hostileObligations.length !== 145) {
    fail("GE_CURSOR_B3_HOSTILE_EXECUTION", "hostile registry must contain 145 records");
  }
  if (Object.keys(contract.counterProfiles).length !== 25) {
    fail("GE_CURSOR_B3_HOSTILE_EXECUTION", "hostile registry must define 25 counter profiles");
  }
  for (const [profileId, counters] of Object.entries(contract.counterProfiles)) {
    exact(Object.keys(counters), counterFields, "GE_CURSOR_B3_HOSTILE_EXECUTION",
      `${profileId} counter profile fields drifted`);
    for (const field of counterFields) {
      const counter = counters[field];
      if (Array.isArray(counter)) {
        if (counter.length !== 4
            || counter.some((entry) => !Number.isSafeInteger(entry) || entry < 0)) {
          fail("GE_CURSOR_B3_HOSTILE_EXECUTION", `${profileId}.${field} counter drifted`);
        }
      } else if (!Number.isSafeInteger(counter) || counter < 0) {
        fail("GE_CURSOR_B3_HOSTILE_EXECUTION", `${profileId}.${field} counter drifted`);
      }
    }
  }
  const expanded = [];
  for (const [index, record] of contract.records.entries()) {
    if (record.ordinal !== index + 1 || record.id !== value.hostileObligations[index]
        || record.hook !== `hostile/${record.id}`) {
      fail("GE_CURSOR_B3_HOSTILE_EXECUTION", `hostile record ${index + 1} identity drifted`);
    }
    const profile = contract.profiles[record.expectedProfile];
    const counterProfile = contract.counterProfiles[record.expectedCounterProfile];
    if (profile === undefined
        || counterProfile === undefined
        || profile.outcome !== record.expected.outcome
        || profile.state !== record.expected.state
        || profile.poisoned !== record.expected.poisoned
        || profile.bundleRetryable !== record.expected.bundleRetryable
        || profile.commitCount !== 0) {
      fail("GE_CURSOR_B3_HOSTILE_EXECUTION", `${record.id} profile expansion drifted`);
    }
    const expectedRetryProfile = {
      "not-retryable": new Set([
        "diagnosed-input-rejected", "precondition-rejected", "disposed-use-rejected",
      ]),
      "fresh-authority-graph": new Set(["poisoned-rollback-required"]),
      "same-exact-valid-authority-evidence": new Set(["precondition-rejected"]),
      "corrected-complete-bundle": new Set(["retryable-presentation-rejected"]),
      "same-exact-valid-bundle": new Set(["retryable-presentation-rejected"]),
    }[record.retryEvidenceMode];
    if (expectedRetryProfile === undefined || !expectedRetryProfile.has(record.expectedProfile)
        || !(record.failureBoundaryParent in EXACT_PRECEDENCE)) {
      fail("GE_CURSOR_B3_HOSTILE_EXECUTION", `${record.id} phase/parent/retry mode drifted`);
    }
    expanded.push(Object.fromEntries(parity.orderedFields.map((field) => [
      field,
      field === "caseId" ? record.id
        : Object.hasOwn(record.expected, field) ? record.expected[field] : counterProfile[field],
    ])));
  }
  validateInitialPublicationParity({
    ...parity,
    expectedRecords: expanded,
    preRebindCasesRequireZeroCursorRebindAndCommitCounts: false,
  }, value.stateMachine.states);
  const registryDigest = domainSeparatedCanonicalDigest(
    TRUSTED_HOSTILE_REGISTRY_DOMAIN, contract.records,
  );
  const expandedDigest = domainSeparatedCanonicalDigest(
    TRUSTED_HOSTILE_EXPANDED_DOMAIN, expanded,
  );
  if (registryDigest !== TRUSTED_HOSTILE_REGISTRY_SHA256
      || contract.trustedRegistrySha256 !== TRUSTED_HOSTILE_REGISTRY_SHA256
      || expandedDigest !== TRUSTED_HOSTILE_EXPANDED_SHA256
      || contract.expandedExpectationsSha256 !== TRUSTED_HOSTILE_EXPANDED_SHA256) {
    fail("GE_CURSOR_B3_HOSTILE_EXECUTION", "hostile registry or expanded expectation hash drifted");
  }
  exactDigest(contract, TRUSTED_HOSTILE_EXECUTION_CONTRACT_SHA256,
    "GE_CURSOR_B3_HOSTILE_EXECUTION", "hostile execution contract drifted");
}

function validateCursorSubprotocolBarrier(value) {
  const authority = value.authority;
  const contract = value.cursorSubprotocolContract;
  const orchestration = contract.orchestrationApiContract;
  const evidence = contract.leafLocalEvidenceContract;
  const third = authority.preVerificationClockEvidenceContract;
  const cursorClock = authority.cursorClock;

  const initialStages = contract.orderedStages.slice(0, 3);
  const preparationOrder = authority.cursorRebindPreparedOwner.preparationOrder;
  const prepareCancellationIndex = preparationOrder.indexOf(
    "observe-before-rebind-prepare-cancellation",
  );
  const prepareIndex = preparationOrder.indexOf(
    "prepare-one-connection-owned-fixed-rebind-execution",
  );
  const executeCancellationIndex = preparationOrder.indexOf(
    "observe-before-rebind-execute-cancellation",
  );
  const consumeIndex = preparationOrder.indexOf(
    "consume-exact-publication-session-at-final-no-write-boundary",
  );
  const tombstoneIndex = preparationOrder.indexOf(
    "retain-publication-session-consumed-tombstone",
  );
  const executeIndex = preparationOrder.indexOf("execute-fixed-rebind-exactly-once");
  if (initialStages[0] !== EXACT_CURSOR_SUBPROTOCOL_STAGES[0]
      || initialStages[1] !== EXACT_CURSOR_SUBPROTOCOL_STAGES[1]
      || initialStages[2] !== EXACT_CURSOR_SUBPROTOCOL_STAGES[2]
      || !(prepareCancellationIndex >= 0
        && prepareCancellationIndex < prepareIndex
        && prepareIndex < executeCancellationIndex
        && executeCancellationIndex < consumeIndex
        && consumeIndex < tombstoneIndex
        && tombstoneIndex < executeIndex)
      || contract.sessionConsumptionBoundary !== "final-no-write-pre-execution-boundary"
      || !initialStages[1].endsWith(`at-${contract.sessionConsumptionBoundary}`)
      || contract.retryContract.preparationOrCancellationBeforeSessionConsumptionRetryable
        !== true
      || authority.cursorRebindPreparedOwner.healthyFailureBeforeSessionConsumptionRetryable
        !== true) {
    fail("GE_CURSOR_B3_CURSOR_SESSION_CONSUMPTION_ORDER",
      "prepare and pre-execution cancellation must precede session consumption, tombstone and execute");
  }
  exactDigest({
    requiredExactObjects: authority.requiredExactObjects,
    transition: contract.transition,
    orderedStages: contract.orderedStages,
    acceptedPermanentIntermediateStates: contract.acceptedPermanentIntermediateStates,
    sessionConsumptionBoundary: contract.sessionConsumptionBoundary,
    irreversibleRegionStartsAt: contract.irreversibleRegionStartsAt,
  }, TRUSTED_CURSOR_ROOT_ENVELOPE_ORDER_SHA256,
  "GE_CURSOR_B3_CURSOR_ROOT_ENVELOPE_ORDER", "cursor root envelope or order drifted");
  exactDigest({
    retryContract: contract.retryContract,
    orchestrationApiContract: contract.orchestrationApiContract,
  }, TRUSTED_CURSOR_RETRY_ORCHESTRATION_SHA256,
  "GE_CURSOR_B3_CURSOR_RETRY_ORCHESTRATION",
  "cursor retry and orchestration envelope drifted");
  exactDigest({
    cursorRebindPreparedOwner: authority.cursorRebindPreparedOwner,
    publicationSessionConsumedTombstone: authority.publicationSessionConsumedTombstone,
  }, TRUSTED_CURSOR_REBIND_AUTHORITY_SHA256,
  "GE_CURSOR_B3_CURSOR_REBIND_AUTHORITY", "cursor rebind authority envelope drifted");
  const { boundedReadTopology, ...rule12ReceiptEnvelope } = authority.rule12SuccessReceipt;
  exactDigest({
    cursorRebindWriteReceipt: authority.cursorRebindWriteReceipt,
    rule11SuccessReceipt: authority.rule11SuccessReceipt,
    rule12SuccessReceipt: rule12ReceiptEnvelope,
  }, TRUSTED_CURSOR_WRITE_RULE_RECEIPTS_SHA256,
  "GE_CURSOR_B3_CURSOR_WRITE_RULE_RECEIPTS", "cursor write and rule receipts drifted");
  exactDigest({
    boundedReadTopology,
    queryBudgetContract: contract.queryBudgetContract,
  }, TRUSTED_CURSOR_BOUNDED_READS_QUERY_SHA256,
  "GE_CURSOR_B3_CURSOR_BOUNDED_READS_QUERY", "bounded reads or query budget drifted");
  exactDigest({
    preVerificationClockEvidenceContract: authority.preVerificationClockEvidenceContract,
    preVerificationClockEvidenceConsumedTombstone:
      authority.preVerificationClockEvidenceConsumedTombstone,
  }, TRUSTED_CURSOR_THIRD_EVIDENCE_SHA256,
  "GE_CURSOR_B3_CURSOR_THIRD_EVIDENCE", "third evidence envelope drifted");
  const cursorClockEnvelope = Object.fromEntries(Object.entries(cursorClock)
    .filter(([name]) => name !== "pendingRegistrationContract"
      && name !== "atomicTailContract"
      && name !== "threeLayerCompletionContract"
      && name !== "activeAssertionContract"));
  exactDigest({
    cursorClockEnvelope,
    pendingRegistrationContract: cursorClock.pendingRegistrationContract,
    atomicTailContract: cursorClock.atomicTailContract,
  }, TRUSTED_CURSOR_PENDING_ATOMIC_TAIL_SHA256,
  "GE_CURSOR_B3_CURSOR_PENDING_ATOMIC_TAIL", "pending or atomic-tail envelope drifted");
  exactDigest(cursorClock.threeLayerCompletionContract,
    TRUSTED_CURSOR_THREE_LAYER_COMPLETION_SHA256,
    "GE_CURSOR_B3_CURSOR_THREE_LAYER_COMPLETION",
    "three-layer completion envelope drifted");
  exactDigest(cursorClock.activeAssertionContract, TRUSTED_CURSOR_ACTIVE_ASSERTION_SHA256,
    "GE_CURSOR_B3_CURSOR_ACTIVE_ASSERTION", "active assertion envelope drifted");
  exactDigest(contract.leafLocalEvidenceContract, TRUSTED_CURSOR_LEAF_EVIDENCE_SHA256,
    "GE_CURSOR_B3_CURSOR_LEAF_EVIDENCE", "leaf evidence envelope drifted");

  exact(contract.orderedStages, EXACT_CURSOR_SUBPROTOCOL_STAGES,
    "GE_CURSOR_B3_CURSOR_SUBPROTOCOL_ORDER", "cursor subprotocol stage order drifted");
  exact(orchestration.exactCallOrder, EXACT_CURSOR_SUBPROTOCOL_CALL_ORDER,
    "GE_CURSOR_B3_CURSOR_SUBPROTOCOL_ORDER", "cursor subprotocol call order drifted");
  const rule12Stage = contract.orderedStages.indexOf(
    "perform-bounded-rule-12-seal-and-mint-success-receipt",
  );
  const thirdStage = contract.orderedStages.indexOf(
    "observe-third-before-verification-clock-only-after-rule-12-success",
  );
  const rule12Call = orchestration.exactCallOrder.indexOf(
    "validate-and-mint-rule-12-success-receipt",
  );
  const thirdCall = orchestration.exactCallOrder.indexOf(
    "observe-before-verification-through-exact-rule-12-owner",
  );
  if (!(rule12Stage >= 0 && rule12Stage < thirdStage
      && rule12Call >= 0 && rule12Call < thirdCall
      && orchestration.thirdObservationBeforeRule11OrRule12Forbidden === true
      && orchestration.rule12FailureBlocksThirdObservation === true
      && authority.rule12SuccessReceipt.failureBlocksThirdClockObservation === true
      && third.observationAuthorizedOnlyBy === "exact-rule-12-success-receipt-object-identity"
      && third.observedAfter === "rule-12-main-table-seal-accepted")) {
    fail("GE_CURSOR_B3_THIRD_CLOCK_ORDER",
      "third clock observation must be authorized by and occur only after Rule 12 success");
  }
  if (authority.cursorRebindPreparedOwner.healthyFailureBeforeSessionConsumptionRetryable
        !== true
      || authority.cursorRebindPreparedOwner
        .authenticatedGraphDriftAfterSessionSelectionPoisonsAllThreeOwners !== true
      || authority.cursorRebindPreparedOwner.failureAfterSessionConsumptionRequiresFreshAuthorityGraph
        !== true
      || contract.retryContract.preparationOrCancellationBeforeSessionConsumptionRetryable
        !== true
      || contract.retryContract.sessionConsumptionOrExecutionStartedPoisonsOnAnyLaterFailure
        !== true
      || contract.retryContract.postExecutionSameGraphRetryAllowed !== false) {
    fail("GE_CURSOR_B3_CURSOR_RETRY_BOUNDARY",
      "healthy pre-consume retry and authenticated selected-graph poison boundaries drifted");
  }

  const requiredObjects = [
    "cursorRebindPreparedOwner", "publicationSessionConsumedTombstone",
    "cursorRebindWriteReceipt", "rule11SuccessReceipt", "rule12SuccessReceipt",
    "preVerificationClockEvidenceConsumedTombstone", "cursorClockCapability",
  ];
  if (requiredObjects.some((name) => !value.authority.requiredExactObjects.includes(name))) {
    fail("GE_CURSOR_B3_CURSOR_RECEIPT_GRAPH",
      "cursor subprotocol exact receipt and tombstone graph is incomplete");
  }
  exact(cursorClock.requiredCommitments, EXACT_CURSOR_CLOCK_COMMITMENTS,
    "GE_CURSOR_B3_CURSOR_RECEIPT_GRAPH", "cursor clock commitments drifted");
  if (!authority.cursorRebindWriteReceipt.requiredCommitments
    .includes("publication-session-object-identity-and-consumed-tombstone")
      || !authority.rule11SuccessReceipt.requiredCommitments
        .includes("exact-predecessor-rebind-write-receipt-object-identity")
      || authority.rule12SuccessReceipt.exactPredecessor
        !== "rule-11-success-receipt-object-identity"
      || !authority.rule12SuccessReceipt.requiredCommitments
        .includes("rule-id-position-and-exact-rule-11-predecessor-identity")
      || !third.requiredCommitments
        .includes("publication-session-rebind-rule-11-and-rule-12-receipt-identities")
      || !authority.preVerificationClockEvidenceConsumedTombstone.requiredCommitments
        .includes("exact-rule-12-success-receipt-object-identity")) {
    fail("GE_CURSOR_B3_CURSOR_RECEIPT_GRAPH",
      "cursor receipt predecessor and consumed-tombstone commitments are not closed");
  }
  const changesLifecycle = authority.cursorRebindWriteReceipt.changesLifecycle;
  exact([
    changesLifecycle.prepareCount,
    changesLifecycle.fetchCount,
    changesLifecycle.releaseCount,
  ], contract.queryBudgetContract.changesPrepareFetchRelease,
  "GE_CURSOR_B3_CURSOR_QUERY_BUDGET", "changes() lifecycle disagrees with query budget");
  if (changesLifecycle.connectionOwnedSingleRowGet !== true
      || Object.hasOwn(changesLifecycle, "terminalFetchCount")) {
    fail("GE_CURSOR_B3_CURSOR_QUERY_BUDGET",
      "connection-owned changes() get must not invent a terminal fetch");
  }

  const successRecord = evidence.expectedSuccessRecord;
  exact(Object.keys(successRecord), evidence.normalizedFields,
    "GE_CURSOR_B3_CURSOR_SUCCESS_EVIDENCE",
    "cursor subprotocol success evidence field order drifted");
  const successCursorCount = evidence.successControlCursorCount;
  const expectedSuccessRecord = {
    caseId: "cursor-subprotocol-success-control",
    outcome: "success",
    failureBoundary: null,
    state: "cursor/clock-complete",
    poisoned: false,
    providerClockReadCount: 3,
    clockEvidenceConsumeCount: 3,
    publicationSessionConsumeCount: 1,
    publicationSessionTombstoneCount: 1,
    cursorRebindPrepareCount: 1,
    cursorRebindExecuteCount: 1,
    cursorRebindReleaseCount: 1,
    changesPrepareCount: 1,
    changesFetchCount: 1,
    changesReleaseCount: 1,
    cursorLedgerLogicalWriteSequence: 1,
    cursorLedgerFixedStatementCount: 1,
    cursorLedgerAffectedRowsWatermark: successCursorCount,
    outerLedgerLogicalWriteSequence: 4,
    outerLedgerFixedStatementCount: 34,
    outerLedgerAffectedRowsWatermark: 16,
    totalChangesDelta: successCursorCount,
    rule11ReceiptMintCount: 1,
    rule12ReceiptMintCount: 1,
    preVerificationEvidenceTombstoneCount: 1,
    cursorClockMintCount: 1,
    pendingCursorClockCount: 0,
    commitCount: 0,
  };
  if (!Number.isSafeInteger(successCursorCount) || successCursorCount < 0) {
    fail("GE_CURSOR_B3_CURSOR_SUCCESS_EVIDENCE", "success cursor count must be safe");
  }
  exact(successRecord, expectedSuccessRecord, "GE_CURSOR_B3_CURSOR_SUCCESS_EVIDENCE",
    "cursor subprotocol success evidence drifted");

  const profiles = value.hostileExecutionContract.counterProfiles;
  const counts = (name) => [
    profiles[name]?.providerClockReadCount,
    profiles[name]?.clockEvidenceConsumeCount,
  ];
  exact(counts("cursor-rebind-executed"), [2, 2],
    "GE_CURSOR_B3_CURSOR_CLOCK_PROFILE", "Rule 12 failure clock profile drifted");
  exact(counts("pre-verification-clock-read-unconsumed"), [3, 2],
    "GE_CURSOR_B3_CURSOR_CLOCK_PROFILE", "third-observed clock profile drifted");
  exact(counts("post-verification-audits"), [3, 3],
    "GE_CURSOR_B3_CURSOR_CLOCK_PROFILE", "cursor-clock success profile drifted");
  exact(evidence.failureProfileInvariants.rule11OrRule12PoisonProviderReadsConsumes, [2, 2],
    "GE_CURSOR_B3_CURSOR_CLOCK_PROFILE", "Rule 11/12 leaf profile drifted");
  exact(evidence.failureProfileInvariants.thirdClockPoisonProviderReadsConsumes, [3, 2],
    "GE_CURSOR_B3_CURSOR_CLOCK_PROFILE", "third-observed leaf profile drifted");
  exact(evidence.failureProfileInvariants.cursorClockCompleteProviderReadsConsumes, [3, 3],
    "GE_CURSOR_B3_CURSOR_CLOCK_PROFILE", "cursor-clock-complete leaf profile drifted");
  if (third.rule11OrRule12FailureProviderClockReadCount !== 2
      || third.rule11OrRule12FailureClockEvidenceConsumeCount !== 2
      || third.successProviderClockReadCount !== 3
      || third.successClockEvidenceConsumeCountBeforeTail !== 2) {
    fail("GE_CURSOR_B3_CURSOR_CLOCK_PROFILE",
      "third-boundary authority profile disagrees with leaf evidence");
  }
  const rule12Records = value.hostileExecutionContract.records.filter((record) =>
    record.phase === "rule-12-count-scan" || record.phase === "rule-12-verification");
  if (rule12Records.length !== 12
      || rule12Records.some((record) =>
        JSON.stringify(counts(record.expectedCounterProfile)) !== JSON.stringify([2, 2]))) {
    fail("GE_CURSOR_B3_CURSOR_CLOCK_PROFILE",
      "every frozen Rule 12 hostile must fail before the third clock observation");
  }

  exact(cursorClock.atomicTailContract.orderedSteps, EXACT_CURSOR_CLOCK_ATOMIC_TAIL,
    "GE_CURSOR_B3_CURSOR_CLOCK_ATOMIC_TAIL", "cursor-clock atomic tail order drifted");
  exact(cursorClock.atomicTailContract.forbiddenWithinAtomicTail,
    EXACT_CURSOR_CLOCK_ATOMIC_FORBIDDEN, "GE_CURSOR_B3_CURSOR_CLOCK_ATOMIC_TAIL",
    "cursor-clock atomic tail forbidden-operation inventory drifted");
  const preparedContinuations = cursorClock.pendingRegistrationContract
    .completionContinuationPreparationOrder;
  const burnedContinuations = cursorClock.atomicTailContract.orderedSteps.slice(0, 3)
    .map((step) => step.replace(/^burn-/u, ""));
  if (JSON.stringify([...preparedContinuations].reverse())
      !== JSON.stringify(burnedContinuations)) {
    fail("GE_CURSOR_B3_CURSOR_CLOCK_ATOMIC_TAIL",
      "completion continuations must prepare lower-to-outer and burn in exact reverse order");
  }
  if (cursorClock.atomicTailContract.nonInterruptible !== true
      || cursorClock.atomicTailContract.allValidationAndNonClockAllocationPrecedeTail !== true
      || cursorClock.atomicTailContract
        .clockOwnedTombstoneAllocationAndRegistrationOccursInsideConsumeBeforeEvidenceBurn
        !== true
      || cursorClock.atomicTailContract.onlyAllowedFallibleTailOperation
        !== "closure-captured-clock-owned-tombstone-allocation-and-registry-insertion"
      || cursorClock.atomicTailContract.registryInsertionPrecedesOneWayEvidenceConsumedFlag !== true
      || cursorClock.pendingRegistrationContract.pendingGraphRegisteredBeforeEvidenceConsumption
        !== true
      || cursorClock.pendingRegistrationContract.pendingCapabilityReadable !== false
      || third.remainsUnconsumedUntil !== "cursor-clock-atomic-tail"
      || contract.queryBudgetContract.atomicTailSqlProviderCancellationDispatchTransactionCursorCount
        !== 0) {
    fail("GE_CURSOR_B3_CURSOR_CLOCK_ATOMIC_TAIL",
      "cursor-clock atomic tail must be closed, pre-registered and non-interruptible");
  }
  exact(cursorClock.activeAssertionContract.activeAssertionReadBudget, {
    liveMigrationLockReadCount: 1,
    targetCatalogObservationCount: 1,
    targetCatalogNativeStatementCount: 2,
    totalChangesReadCount: 1,
    cursorLedgerPrivateSnapshotReadCount: 1,
    providerClockCallbackCount: 0,
    evidenceConsumeCount: 0,
    writeSqlCount: 0,
    transactionControlCount: 0,
  }, "GE_CURSOR_B3_CURSOR_CLOCK_ASSERTION",
  "cursor-clock active assertion read budget drifted");
  if (cursorClock.activeAssertionContract.repeatable !== true
      || cursorClock.activeAssertionContract.readOnly !== true
      || cursorClock.activeAssertionContract.consumesNothing !== true
      || cursorClock.activeAssertionContract.providerClockCallbackAllowed !== false
      || cursorClock.activeAssertionContract.additionalEvidenceConsumptionAllowed !== false
      || cursorClock.activeAssertionContract.noFourthClockObservationRequired !== true
      || !cursorClock.activeAssertionContract.requiredProofs
        .includes("target-catalog-identity-and-no-fourth-clock-observation")) {
    fail("GE_CURSOR_B3_CURSOR_CLOCK_ASSERTION",
      "cursor-clock assertion must be repeatable, read-only and preserve clock head three");
  }
}

export function parseStrictJson(text) {
  let index = 0;
  const whitespace = () => { while (/[\t\n\r ]/u.test(text[index] ?? "")) index += 1; };
  const string = () => {
    const start = index++;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index++] === '"') return JSON.parse(text.slice(start, index));
    }
    throw new SyntaxError("unterminated JSON string");
  };
  const value = () => {
    whitespace();
    if (text[index] === "{") {
      index += 1;
      const result = Object.create(null);
      const seen = new Set();
      whitespace();
      if (text[index] === "}") { index += 1; return result; }
      while (true) {
        whitespace();
        if (text[index] !== '"') throw new SyntaxError("object key must be a string");
        const key = string();
        if (seen.has(key)) throw new SyntaxError(`duplicate key ${key}`);
        seen.add(key);
        whitespace();
        if (text[index++] !== ":") throw new SyntaxError("missing colon");
        result[key] = value();
        whitespace();
        const separator = text[index++];
        if (separator === "}") return result;
        if (separator !== ",") throw new SyntaxError("missing comma");
      }
    }
    if (text[index] === "[") {
      index += 1;
      const result = [];
      whitespace();
      if (text[index] === "]") { index += 1; return result; }
      while (true) {
        result.push(value());
        whitespace();
        const separator = text[index++];
        if (separator === "]") return result;
        if (separator !== ",") throw new SyntaxError("missing comma");
      }
    }
    if (text[index] === '"') return string();
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(text.slice(index));
    if (match === null) throw new SyntaxError("invalid JSON value");
    index += match[0].length;
    return JSON.parse(match[0]);
  };
  const result = value();
  whitespace();
  if (index !== text.length) throw new SyntaxError("trailing JSON content");
  return result;
}

const schema = parseStrictJson(readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
assert.equal(ajv.validateSchema(schema), true, JSON.stringify(ajv.errors));
const validateShape = ajv.compile(schema);

export function loadCursorPublicationFixture() {
  return parseStrictJson(readFileSync(FIXTURE_PATH, "utf8"));
}

export function validateCursorPublicationFixtureSemantics(value, { verifyAssets = false } = {}) {
  const { source, target, migration } = value.identities;
  exact(
    [source.schemaVersion, source.descriptorHash, source.schemaIdentitySha256],
    [1, EXACT_IDENTITIES.sourceDescriptorHash, EXACT_IDENTITIES.sourceSchemaIdentity],
    "GE_CURSOR_B3_SOURCE_IDENTITY", "source identity drifted",
  );
  exact(
    [target.schemaVersion, target.descriptorHash, target.descriptorBodySha256,
      target.descriptorCanonicalSha256, target.schemaIdentitySha256],
    [2, EXACT_IDENTITIES.targetDescriptorHash, EXACT_IDENTITIES.targetDescriptorBodySha256,
      EXACT_IDENTITIES.targetDescriptorCanonicalSha256, EXACT_IDENTITIES.targetSchemaIdentity],
    "GE_CURSOR_B3_TARGET_IDENTITY", "target identity drifted",
  );
  exact(
    [migration.sqlSha256, migration.schemaSqlSha256, migration.previewManifestSha256],
    [EXACT_IDENTITIES.migrationSqlSha256, EXACT_IDENTITIES.schemaSqlSha256,
      EXACT_IDENTITIES.previewManifestSha256],
    "GE_CURSOR_B3_MIGRATION_IDENTITY", "migration asset identity drifted",
  );
  exact(value.sequence.orderedStages, EXACT_STAGES,
    "GE_CURSOR_B3_SEQUENCE", "atomic migration sequence drifted");
  exact(value.rules, EXACT_RULES,
    "GE_CURSOR_B3_RULE_ORDER", "rules 11/12 order drifted");
  exact(value.failureContract.boundaryPrecedence, EXACT_PRECEDENCE,
    "GE_CURSOR_B3_FAILURE_PRECEDENCE", "failure precedence drifted");
  exact(value.sealContract.mutableFields, EXACT_MUTABLE_FIELDS,
    "GE_CURSOR_B3_MUTABLE_FIELDS", "mutable field inventory drifted");
  exact(value.sealContract.immutablePhysicalFields, EXACT_IMMUTABLE_FIELDS,
    "GE_CURSOR_B3_IMMUTABLE_FIELDS", "immutable field inventory drifted");
  exact(value.sqlContract.rebind.parameterOrder, EXACT_PARAMETER_ORDER,
    "GE_CURSOR_B3_PARAMETER_ORDER", "rebind parameter order drifted");
  exact(value.stateMachine.states, EXACT_STATES,
    "GE_CURSOR_B3_STATES", "state inventory drifted");
  exact(value.stateMachine.successTransitions, EXACT_TRANSITIONS,
    "GE_CURSOR_B3_TRANSITIONS", "success transitions drifted");
  exact(value.authority.requiredExactObjects, EXACT_AUTHORITY_OBJECTS,
    "GE_CURSOR_B3_AUTHORITY_GRAPH", "exact authority graph drifted");
  validateCursorSubprotocolBarrier(value);
  exact(value.authority.outerPublicationAuthority, EXACT_OUTER_AUTHORITY,
    "GE_CURSOR_B3_OUTER_AUTHORITY", "outer publication authority lifecycle drifted");
  exact(value.authority.outerPublicationAuthority.requiredCommitments,
    EXACT_OUTER_COMMITMENTS, "GE_CURSOR_B3_OUTER_COMMITMENTS",
    "outer publication commitments drifted");
  validateGoldenDigestVectors(
    value.authority.initialOuterWriteReceiptContract.canonicalDigestCodec,
  );
  exactDigest(value.authority.initialOuterWriteReceiptContract,
    TRUSTED_INITIAL_WRITE_CONTRACT_SHA256, "GE_CURSOR_B3_INITIAL_WRITE_RECEIPTS",
    "initial outer write receipt contract drifted");
  exactDigest(value.authority.postDdlCatalogFence,
    TRUSTED_POST_DDL_CATALOG_FENCE_SHA256, "GE_CURSOR_B3_POST_DDL_CATALOG_FENCE",
    "post-DDL catalog fence contract drifted");
  const catalogRead = value.authority.postDdlCatalogFence.catalogReadContract;
  if (sha256(catalogRead.sql) !== TRUSTED_CATALOG_QUERY_SHA256
      || catalogRead.querySha256 !== TRUSTED_CATALOG_QUERY_SHA256
      || catalogRead.expectedDigestSha256 !== TRUSTED_CATALOG_DIGEST_SHA256) {
    fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE", "post-DDL physical catalog anchors drifted");
  }
  exactDigest(value.authority.postDdlPublicationReaderLease,
    TRUSTED_POST_DDL_READER_LEASE_SHA256, "GE_CURSOR_B3_POST_DDL_READER_LEASE",
    "post-DDL publication reader lease contract drifted");
  exactDigest(value.authority.stageAdoptionReceipt,
    TRUSTED_STAGE_ADOPTION_RECEIPT_SHA256, "GE_CURSOR_B3_STAGE_ADOPTION_RECEIPT",
    "stage adoption receipt contract drifted");
  exactDigest(value.authority.stageAdoptionBridge,
    TRUSTED_STAGE_ADOPTION_BRIDGE_SHA256, "GE_CURSOR_B3_STAGE_ADOPTION",
    "stage adoption semantics drifted");
  exact(value.authority.stageAdoptionBridge.requiredOuterWriteReceipts,
    EXACT_ADOPTION_RECEIPTS, "GE_CURSOR_B3_STAGE_ADOPTION",
    "stage adoption receipt order drifted");
  exact(value.authority.publicationSession.requiredCommitments, EXACT_COMMITMENTS,
    "GE_CURSOR_B3_COMMITMENTS", "publication commitments drifted");
  const publicationSession = value.authority.publicationSession;
  exactDigest(publicationSession, TRUSTED_PUBLICATION_SESSION_SHA256,
    "GE_CURSOR_B3_PUBLICATION_SESSION", "publication session mint contract drifted");
  if (publicationSession.crossRunRejected !== true
      || publicationSession.substitutionRejected !== true) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "publication session must reject cross-run and substitution presentation");
  }
  if (!publicationSession.requiredCommitments.includes("projection-reference-object-identity")
      || !publicationSession.threeLayerPublicationContract.retainsExactIdentityEdges
        .includes("baseline-projection-identity-object-identity")) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "projection-reference commitment and baseline projection identity edge must remain distinct");
  }
  exact(publicationSession.secondClockEvidenceContract, {
    boundary: "before-cursor-rebind",
    consumer: "cursor-publication-session",
    predecessor: "outer-clock-evidence-receipt-object-identity",
    capability: "provider-clock-capability-object-identity",
    distinctFromOuterEvidence: true,
    unconsumedAtValidation: true,
  }, "GE_CURSOR_B3_PUBLICATION_SESSION",
  "second clock evidence contract drifted");
  if (!value.authority.providerClock.receiptLabels
    .includes("pre-rebind-clock-evidence-receipt")
      || !publicationSession.requiredCommitments
        .includes("pre-rebind-clock-evidence-receipt-object-identity")
      || !publicationSession.requiredCommitments
        .includes("post-0002-catalog-fence-object-identity")
      || !publicationSession.requiredCommitments
        .includes("stage-adoption-receipt-object-identity")) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "second evidence or authority identity commitments are not closed");
  }
  if (!value.lifecycleContract.cancellationLabels
    .includes(publicationSession.cancellationContract.label)) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "publication cancellation label is not owned by the lifecycle contract");
  }
  if (!value.stateMachine.states
    .includes(publicationSession.threeLayerPublicationContract.successfulState)) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "publication-active success state is not owned by the state machine");
  }
  const leafEvidence = publicationSession.leafLocalEvidenceContract;
  const successCounterProfile = value.hostileExecutionContract.counterProfiles[
    leafEvidence.successCounterProfile
  ];
  exact(Object.keys(leafEvidence.success),
    value.parityGates.initialPublicationNormalizedOutput.orderedFields,
    "GE_CURSOR_B3_PUBLICATION_SESSION",
    "publication success evidence must preserve the exact 28-field order");
  for (const field of Object.keys(successCounterProfile ?? {})) {
    if (JSON.stringify(leafEvidence.success[field])
        !== JSON.stringify(successCounterProfile[field])) {
      fail("GE_CURSOR_B3_PUBLICATION_SESSION",
        `publication success evidence disagrees with ${leafEvidence.successCounterProfile}.${field}`);
    }
  }
  if (leafEvidence.success.caseId !== "publication-session-success-control"
      || leafEvidence.success.outcome !== "success"
      || leafEvidence.success.failureBoundary !== null
      || leafEvidence.success.state !== "publication-active"
      || leafEvidence.success.poisoned !== false
      || leafEvidence.success.bundleRetryable !== false
      || leafEvidence.success.sameTransactionLineage !== true
      || leafEvidence.success.catalogFenceMatches !== true) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "publication success evidence semantic fields drifted");
  }
  const cancellation = leafEvidence.preTailCancellation;
  exact(Object.keys(cancellation), [
    "caseId", "outcome", "state", "poisoned", "providerClockReadCount",
    "clockEvidenceConsumeCount", "sessionRetryable", "cursorRebindPrepareCount",
    "cursorRebindExecuteCount", "commitCount",
  ], "GE_CURSOR_B3_PUBLICATION_SESSION",
  "pre-tail cancellation must preserve its exact 10-field order");
  if (cancellation.providerClockReadCount !== successCounterProfile.providerClockReadCount
      || cancellation.clockEvidenceConsumeCount !== 1
      || cancellation.caseId !== "publication-session-cancelled-before-tail"
      || cancellation.outcome !== "cancelled"
      || cancellation.state !== value.boundary.requiredPredecessorState
      || cancellation.poisoned !== false
      || cancellation.sessionRetryable !== true
      || cancellation.cursorRebindPrepareCount !== 0
      || cancellation.cursorRebindExecuteCount !== 0
      || cancellation.commitCount !== 0) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "pre-tail cancellation evidence does not preserve the exact prepared graph and evidence");
  }
  const adoptionPoisonRecords = value.hostileExecutionContract.records
    .filter((record) => publicationSession.failureAndRetryContract.provenanceBoundary
      .stageAdoptionReceiptOrdinals.includes(record.ordinal));
  if (adoptionPoisonRecords.length !== 3
      || adoptionPoisonRecords.some((record) => record.expectedCode !== "GE_CURSOR_B3_INVARIANT"
        || record.expected.outcome !== "poisoned"
        || record.expected.state !== "poisoned"
        || record.expected.poisoned !== true)) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "authority-bound stage adoption receipt drift must poison at ordinals 100-102");
  }
  const preparedOrder = publicationSession.mintLifecycle.preparedContinuationOrder;
  const burnedOwnerOrder = publicationSession.atomicTailContract.orderedSteps.slice(0, 3)
    .map((step) => step.replace(/^burn-/u, ""));
  if (JSON.stringify([...preparedOrder].reverse()) !== JSON.stringify(burnedOwnerOrder)) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "nested prepare must be stage-to-outer and atomic burn must be outer-to-stage");
  }
  const pending = publicationSession.pendingRegistrationContract;
  if (pending.failureBeforeTailMayRetrySameExactPreparedGraphAndEvidence !== false
      || pending.allocationOrRegistrationFailureBurnsAllPreparedContinuations !== true
      || pending.allocationOrRegistrationFailurePoisonsAllThreeOwners !== true
      || pending.allocationOrRegistrationFailureRequiresFreshAuthorityGraph !== true
      || pending.allocationOrRegistrationFailureRetainsPrimaryFailure !== true) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "allocation or registration failure must poison three owners and retain its primary failure");
  }
  const postTailAssertion = publicationSession.postTailAssertionContract;
  exact(postTailAssertion.requiredRevalidations, [
    "exact-session-identity",
    "live-migration-lock",
    "unchanged-transaction-generation-and-exclusive-lineage",
    "post-ddl-catalog-fence",
    "stage-adoption-receipt-and-four-tombstone-graph",
    "outer-write-ledger-and-total-changes",
    "exact-pre-rebind-clock-consumed-tombstone",
    "exact-outer-authority-stage-ownership-transfer-baseline-temp-stage-and-baseline-projection-identities",
  ], "GE_CURSOR_B3_PUBLICATION_SESSION",
  "post-tail assertion revalidation order drifted");
  if (!publicationSession.atomicTailContract.forbiddenWithinAtomicTail.includes("sql")
      || publicationSession.sideEffectContract.forbiddenOperations.includes("sql")
      || publicationSession.sideEffectContract.allSqlForbiddenWithinAtomicTail !== true
      || publicationSession.sideEffectContract.allowedReadOnlySqlBeforeAtomicTail.length !== 2
      || JSON.stringify(postTailAssertion.allowedModuleOwnedReadOnlyProofSql)
        !== JSON.stringify(
          publicationSession.sideEffectContract.allowedReadOnlySqlForPostTailAssertion)
      || JSON.stringify(publicationSession.sideEffectContract.allowedReadOnlySqlBeforeAtomicTail)
        !== JSON.stringify(
          publicationSession.sideEffectContract.allowedReadOnlySqlForPostTailAssertion)
      || postTailAssertion.allOtherSqlForbidden !== true
      || JSON.stringify(postTailAssertion.forbiddenOperations)
        !== JSON.stringify(
          publicationSession.sideEffectContract.postTailAssertionForbiddenOperations)
      || [
        "permanent-or-write-sql", "cursor-rebind-sql", "transaction-control",
        "provider-clock-third-observation", "rule-11", "rule-12", "commit",
      ].some((operation) => !postTailAssertion.forbiddenOperations.includes(operation))
      || postTailAssertion.consumesEvidenceOrPublicationSession !== false) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "publication SQL boundary must isolate tail SQL and close post-tail assertion proof reads");
  }
  if (postTailAssertion.revalidationFailurePoisonsAllThreeOwnersAndRequiresFreshGraph !== true) {
    fail("GE_CURSOR_B3_PUBLICATION_SESSION",
      "post-tail revalidation failure must poison all three owners and require a fresh graph");
  }
  exact(value.hostileObligations, EXACT_HOSTILE,
    "GE_CURSOR_B3_HOSTILE_MATRIX", "hostile obligations drifted");
  exact(value.parityGates.required, EXACT_PARITY,
    "GE_CURSOR_B3_PARITY_GATES", "parity gates drifted");
  exactDigest(value.parityGates.initialPublicationNormalizedOutput,
    TRUSTED_INITIAL_PUBLICATION_PARITY_SHA256, "GE_CURSOR_B3_PARITY_OUTPUT",
    "initial publication normalized parity output drifted");
  validateInitialPublicationParity(
    value.parityGates.initialPublicationNormalizedOutput,
    value.stateMachine.states,
  );
  validateHostileExecutionContract(value);
  exact(value.faultMatrix.boundaries, EXACT_FAULTS,
    "GE_CURSOR_B3_FAULT_MATRIX", "fault boundaries drifted");
  exact(value.lifecycleContract.cancellationLabels, EXACT_CANCELLATION_LABELS,
    "GE_CURSOR_B3_CANCELLATION", "cancellation labels drifted");
  exact(value.lifecycleContract.statementBoundaries, EXACT_STATEMENT_BOUNDARIES,
    "GE_CURSOR_B3_STATEMENT_LIFECYCLE", "statement boundaries drifted");
  exact(value.lifecycleContract.cleanupFaults, EXACT_CLEANUP_FAULTS,
    "GE_CURSOR_B3_CLEANUP", "cleanup faults drifted");
  exact(value.lifecycleContract.cancellationSemantics, EXACT_CANCELLATION_SEMANTICS,
    "GE_CURSOR_B3_CANCELLATION_SEMANTICS", "cancellation observation drifted");
  exact(value.sealContract.phaseCleanupOrder, EXACT_CLEANUP_ORDER,
    "GE_CURSOR_B3_CLEANUP_ORDER", "cursor cleanup order drifted");
  exact(value.sqlContract.eqpRequired, EXACT_EQP,
    "GE_CURSOR_B3_EQP", "EQP requirements drifted");

  const sqlPairs = ["rebind", "affectedCount", "postRebindMainKeyCountScan",
    "postRebindKeyDriver", "postRebindPointLookup"];
  for (const name of sqlPairs) {
    const pair = value.sqlContract[name];
    if (normalizeSql(pair.sql) !== EXACT_SQL[name]) {
      fail("GE_CURSOR_B3_SQL_LITERAL", `${name} SQL literal drifted`);
    }
    if (sha256(normalizeSql(pair.sql)) !== pair.sha256) {
      fail("GE_CURSOR_B3_SQL_HASH", `${name} SQL hash drifted`);
    }
  }
  const initialReceipts = value.authority.initialOuterWriteReceiptContract;
  const initialSqlPairs = [
    [initialReceipts.baselineEntriesPublicationReceipt, "sourceReadSql", "sourceReadSqlSha256"],
    [initialReceipts.baselineEntriesPublicationReceipt, "insertSql", "insertSqlSha256"],
    [initialReceipts.baselineHeaderPublicationReceipt, "insertSql", "insertSqlSha256"],
    [initialReceipts.operationSequenceZeroPublicationReceipt, "insertSql", "insertSqlSha256"],
  ];
  for (const [receipt, sqlField, hashField] of initialSqlPairs) {
    if (sha256(normalizeSql(receipt[sqlField])) !== receipt[hashField]) {
      fail("GE_CURSOR_B3_INITIAL_SQL_HASH", `${sqlField} hash drifted`);
    }
  }
  if (!/^UPDATE main\.ge_cycle_cursors SET descriptor_hash = \?, schema_identity_sha256 = \? WHERE descriptor_hash = \? AND schema_identity_sha256 = \?$/u
    .test(normalizeSql(value.sqlContract.rebind.sql))) {
    fail("GE_CURSOR_B3_REBIND_SQL", "rebind must update only the two manifest-bound identities");
  }
  if (!normalizeSql(value.sqlContract.postRebindKeyDriver.sql)
    .endsWith("ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY")) {
    fail("GE_CURSOR_B3_SCAN_ORDER", "post-rebind key driver order drifted");
  }
  const updateIndex = EXACT_STAGES.indexOf("cursor-rebind-executed-once");
  const sequenceIndex = EXACT_STAGES.indexOf("operation-sequence-zero-published");
  const metadataIndex = EXACT_STAGES.indexOf("schema-and-descriptor-metadata-published");
  const commitIndex = EXACT_STAGES.indexOf("single-atomic-commit");
  if (!(sequenceIndex < updateIndex && updateIndex < metadataIndex && metadataIndex < commitIndex)) {
    fail("GE_CURSOR_B3_ATOMIC_ORDER", "rebind must remain inside the complete atomic migration");
  }
  if (value.hostileObligations.length !== 145
      || value.hostileExecutionContract.records.length !== 145
      || value.faultMatrix.boundaries.at(-1) !== "commit-returned") {
    fail("GE_CURSOR_B3_MATRIX", "hostile or fault matrix drifted");
  }
  const digest = fixtureDigest(value);
  if (digest !== TRUSTED_FIXTURE_SHA256
      || value.parityGates.fixtureCanonicalSha256 !== TRUSTED_FIXTURE_SHA256) {
    fail("GE_CURSOR_B3_FIXTURE_HASH", "canonical fixture SHA-256 drifted");
  }
  if (verifyAssets) {
    const assets = [
      ["spec/migrations/sqlite/0002-v1-to-v2-operation-replay.sql", migration.sqlSha256],
      ["spec/migrations/sqlite/schema-v2.sql", migration.schemaSqlSha256],
      ["spec/migrations/sqlite/manifest-v2.preview.json", migration.previewManifestSha256],
    ];
    for (const [relativePath, expectedHash] of assets) {
      const actual = sha256(readFileSync(join(REPOSITORY_ROOT, relativePath)));
      if (actual !== expectedHash) fail("GE_CURSOR_B3_ASSET_HASH", `${relativePath} drifted`);
    }
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(readFileSync(join(
        REPOSITORY_ROOT, "spec/migrations/sqlite/schema-v2.sql",
      ), "utf8"));
      const catalogRead = value.authority.postDdlCatalogFence.catalogReadContract;
      const catalogRows = database.prepare(catalogRead.sql).all().map((row) => ({
        name: String(row.name),
        sqlSha256: sha256(String(row.sql)),
        tableName: String(row.tableName),
        type: String(row.type),
      }));
      const canonicalCatalogJson = JSON.stringify(canonicalize(catalogRows));
      const catalogInventory = catalogRows.map((row) =>
        `${row.type}:${row.name}:${row.tableName}:${row.sqlSha256}`);
      const catalogDigest = sha256(Buffer.concat([
        Buffer.from(catalogRead.digestDomainUtf8, "utf8"),
        Buffer.from(canonicalCatalogJson, "utf8"),
      ]));
      if (catalogRows.length !== catalogRead.expectedRowCount
          || Buffer.byteLength(canonicalCatalogJson, "utf8")
            !== catalogRead.expectedCanonicalRowBytes
          || JSON.stringify(catalogInventory) !== JSON.stringify(catalogRead.expectedInventory)
          || catalogDigest !== TRUSTED_CATALOG_DIGEST_SHA256
          || catalogDigest !== catalogRead.expectedDigestSha256
          || database.prepare("PRAGMA application_id").get().application_id
            !== catalogRead.expectedApplicationId
          || database.prepare("PRAGMA user_version").get().user_version
            !== catalogRead.expectedUserVersion) {
        fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE",
          "fresh v2 physical catalog does not match the complete trusted inventory");
      }
      database.exec(`
        CREATE VIEW main.GE_CYCLE_Hostile_View AS SELECT 1 AS hostile_value;
        CREATE TRIGGER main.Ge_CyClE_Hostile_Trigger
        AFTER INSERT ON main.ge_cycle_schema BEGIN SELECT 1; END;
      `);
      const hostileCatalogRows = database.prepare(catalogRead.sql).all().map((row) => ({
        name: String(row.name),
        sqlSha256: sha256(String(row.sql)),
        tableName: String(row.tableName),
        type: String(row.type),
      }));
      const hostileNames = new Set(hostileCatalogRows.map(({ name }) => name));
      const hostileCatalogDigest = sha256(Buffer.concat([
        Buffer.from(catalogRead.digestDomainUtf8, "utf8"),
        Buffer.from(JSON.stringify(canonicalize(hostileCatalogRows)), "utf8"),
      ]));
      if (!hostileNames.has("GE_CYCLE_Hostile_View")
          || !hostileNames.has("Ge_CyClE_Hostile_Trigger")
          || hostileCatalogRows.length !== catalogRead.expectedRowCount + 2
          || hostileCatalogDigest === TRUSTED_CATALOG_DIGEST_SHA256) {
        fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE",
          "case-insensitive catalog ownership probe failed to expose hostile view/trigger objects");
      }
      database.exec(`
        DROP TRIGGER main.Ge_CyClE_Hostile_Trigger;
        DROP VIEW main.GE_CYCLE_Hostile_View;
      `);
      const ownershipFixture = parseStrictJson(readFileSync(join(
        REPOSITORY_ROOT, "spec/conformance/sqlite-cursor-stage-ownership.case.json",
      ), "utf8"));
      database.exec(ownershipFixture.cursorSealTempTableDdl);
      const driverDetails = database.prepare(
        `EXPLAIN QUERY PLAN ${EXACT_SQL.postRebindKeyDriver}`,
      ).all().map((row) => String(row.detail).toUpperCase());
      const countDetails = database.prepare(
        `EXPLAIN QUERY PLAN ${EXACT_SQL.postRebindMainKeyCountScan}`,
      ).all().map((row) => String(row.detail).toUpperCase());
      const lookupDetails = database.prepare(
        `EXPLAIN QUERY PLAN ${EXACT_SQL.postRebindPointLookup}`,
      ).all("tenant", "token").map((row) => String(row.detail).toUpperCase());
      const details = [...driverDetails, ...countDetails, ...lookupDetails];
      if (value.sqlContract.eqpForbiddenDetailFragments.some((fragment) =>
        details.some((detail) => detail.includes(fragment)))) {
        fail("GE_CURSOR_B3_EQP", "post-rebind proof uses a forbidden query plan");
      }
      if (!driverDetails.some((detail) => detail.includes("GE_BLR_CURSOR_SEAL"))
          || !countDetails.some((detail) => detail.includes("GE_CYCLE_CURSORS"))
          || !lookupDetails.some((detail) =>
            detail.includes("USING PRIMARY KEY (TENANT_ID=? AND TOKEN_HASH=?)"))) {
        fail("GE_CURSOR_B3_EQP", "post-rebind proof lacks its frozen primary-key plans");
      }
    } finally {
      database.close();
    }
  }
  return Object.freeze({
    ok: true,
    id: value.id,
    status: value.status,
    taskId: value.boundary.stableTaskId,
    stageCount: value.sequence.orderedStages.length,
    ruleCount: value.rules.length,
    hostileObligationCount: value.hostileObligations.length,
    hostileExecutionRecordCount: value.hostileExecutionContract.records.length,
    faultBoundaryCount: value.faultMatrix.boundaries.length,
    targetDescriptorHash: value.identities.target.descriptorHash,
    targetSchemaIdentitySha256: value.identities.target.schemaIdentitySha256,
    fixtureCanonicalSha256: digest,
    implementationClaim: value.claims.implementationClaim,
    activeManifestClaim: value.claims.activeManifestClaim,
  });
}

export function validateCursorPublicationFixture(value, { verifyAssets = false } = {}) {
  if (!validateShape(value)) fail("GE_CURSOR_B3_SCHEMA", JSON.stringify(validateShape.errors));
  return validateCursorPublicationFixtureSemantics(value, { verifyAssets });
}

export function validateCanonicalCursorPublicationFixture() {
  return validateCursorPublicationFixture(loadCursorPublicationFixture(), { verifyAssets: true });
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(`${JSON.stringify(validateCanonicalCursorPublicationFixture(), null, 2)}\n`);
}
