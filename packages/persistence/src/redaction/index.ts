/**
 * The D9 durable payload protection and redaction module.
 *
 * This subtree implements spec/redaction-semantics.md v1alpha2: the RFC 6901
 * pointer transform (Section 3.3.1), the payload-disposition truth table
 * (Section 3.2), the effective capture policy and its canonical hash
 * (Section 4), the protected payload primitive (Section 5), and the shared
 * deterministic sink-before-write guard (Section 7).
 *
 * It is deliberately self-contained — it imports nothing from the rest of
 * `@graph-engineering/persistence` — so it can be lifted into a standalone
 * `@graph-engineering/redaction` package without code changes once the
 * workspace manifest and lockfile can be edited in the same change.
 *
 * Honest claim boundary: this module does not by itself close D9. Section 12.1
 * requires both native lanes, the shared corpus, the packaged canary campaign,
 * and an independent R3 review.
 */

export {
  CAPTURE_SINK_CLASSES,
  CAPTURE_SOURCE_CLASSES,
  GUARD_FAILURE_PHASES,
  POLICY_CONTROLS,
  REDACTION_FAILURE_CODES,
  type CaptureSinkClass,
  type CaptureSourceClass,
  type GuardFailure,
  type GuardFailurePhase,
  type PolicyControl,
  type RedactionFailureCode,
} from "./codes.js";
export {
  decodeBase64Url,
  encodeBase64Url,
  hmacSha256Hex,
  sha256Hex,
} from "./crypto.js";
export {
  DISPOSITION_TRUTH_TABLE,
  PAYLOAD_DISPOSITIONS,
  checkDispositionFacts,
  metadataOnlyFacts,
  protectedRefFacts,
  redactedFacts,
  type DispositionFacts,
  type PayloadDisposition,
} from "./disposition.js";
export {
  CHECKPOINT_PROJECTION_TYPE,
  CHECKPOINT_V1ALPHA2_API_VERSION,
  isCaptureSinkClass,
  isCaptureSourceClass,
  validateCheckpointV1Alpha2Document,
  validatePayloadDispositionDocument,
  validateProtectedAadDocument,
  validateProtectedBlobDocument,
  validateProtectedStoreEnvelopeDocument,
  validateProtectedValueRefDocument,
  validateRedactionReceiptDocument,
  validateRedactionRuleDocument,
  validateSinkGuardDecisionDocument,
  type DocumentCheck,
} from "./documents.js";
export { canonicalTagged, encodeDurableJson, type DurableJson } from "./durable-json.js";
export { FileProtectedPayloadStore, type FileProtectedPayloadStoreOptions } from "./file-protected-store.js";
export {
  defaultPolicyEnabled,
  evaluateFlow,
  type FlowDecision,
  type FlowOutcome,
  type FlowRequest,
} from "./flow.js";
export {
  SINK_GUARD_DECISION_API_VERSION,
  SinkGuard,
  consumePreparedSinkWrite,
  controlEnabled,
  PreparedSinkWrite,
  type AuthorityClass,
  type ConsumeResult,
  type GuardOccurrence,
  type GuardPayloadField,
  type GuardRequest,
  type GuardResult,
  type SinkGuardDecision,
  type SinkGuardOptions,
} from "./guard.js";
export {
  SINK_POLICY_ROWS,
  SOURCE_CLASSIFICATION_ROWS,
  sinkRow,
  sourceRow,
  type SinkPolicyRow,
  type SourceClassificationRow,
} from "./inventory.js";
export {
  DETERMINISTIC_TEST_KEY_REF,
  DeterministicTestKeyProvider,
  HostKeyProvider,
  keyRefHash,
  type KeyProvider,
} from "./key-provider.js";
export { SECTION_11_LIMITS, type PortableLimits } from "./limits.js";
export {
  FORBIDDEN_POINTER_TOKENS,
  REDACTION_TOKEN,
  decodePointer,
  encodePointer,
  redactionTransform,
  type ReplacementMode,
  type TransformResult,
} from "./pointer.js";
export {
  CAPTURE_POLICY_API_VERSION,
  DEFAULT_CAPTURE_POLICY,
  POLICY_MODE_VOCABULARY,
  REDACTION_RULE_API_VERSION,
  REDACTION_TRANSFORM,
  TRANSFORM_IMPLEMENTATION_HASH,
  TRANSFORM_IMPLEMENTATION_MANIFEST,
  capturePolicyHash,
  normalizeCapturePolicy,
  policyMode,
  ruleForSink,
  ruleRegistryHash,
  ruleRegistrySnapshot,
  ruleSetHash,
  validateCapturePolicy,
  type CapturePolicy,
  type RedactionRule,
  type RuleRegistrySnapshot,
} from "./policy.js";
export {
  canonicalJsonString,
  compareUnicodeCodePoints,
  hasUnpairedSurrogate,
  materializePortableJson,
  snapshotPortableJson,
  utf8ByteLength,
  type PortableSnapshot,
} from "./portable.js";
export {
  CONTRACT_VERSION_V1ALPHA2,
  DURABLE_CODEC,
  MemoryProtectedPayloadStore,
  PROTECTED_AAD_API_VERSION,
  PROTECTED_BLOB_API_VERSION,
  PROTECTED_STORE_CONTRACT,
  PROTECTED_VALUE_API_VERSION,
  computeAadHash,
  computeAuthorityBindingHash,
  computeCiphertextHash,
  computeTenantScopeHash,
  computeValueMac,
  protectValue,
  unprotectValue,
  validateBlobBytes,
  type AuthorityScope,
  type ProtectedAad,
  type ProtectedBlob,
  type ProtectedPayloadStore,
  type ProtectedStoreCapability,
  type ProtectedValueRef,
  type SemanticContext,
} from "./protected-store.js";
export {
  NEVER_REDACTABLE_SINKS,
  NEVER_REDACTABLE_SOURCE_CLASSES,
  REDACTION_RECEIPT_API_VERSION,
  buildRedactionReceipt,
  computeResultHash,
  computeSourceHash,
  verifyRedactionReceipt,
  type RedactionReceipt,
} from "./receipt.js";
export {
  SinkCanaryScanner,
  canaryNeedles,
  scanBytesForCanaries,
  type CanaryDetection,
  type CanaryForm,
  type SeededCanary,
  type SinkScannerOptions,
} from "./scanner.js";
