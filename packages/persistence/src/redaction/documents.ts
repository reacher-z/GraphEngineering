/**
 * Native validators for the closed D9 wire documents.
 *
 * Section 7 requires the guard to "validate disposition, receipt, refs, and
 * closed sink schema" before a byte is produced. Persistence carries no JSON
 * Schema engine, so each closed document has a native validator here; the
 * conformance test drives every `wireCases` document in the shipped corpus
 * through these functions, so a drift between this code and the schemas fails
 * the build rather than passing silently.
 */

import {
  CAPTURE_SINK_CLASSES,
  CAPTURE_SOURCE_CLASSES,
  REDACTION_FAILURE_CODES,
  type CaptureSinkClass,
  type CaptureSourceClass,
} from "./codes.js";
import { checkDispositionFacts, type DispositionFacts } from "./disposition.js";
import { decodePointer } from "./pointer.js";
import { compareUnicodeCodePoints } from "./portable.js";
import {
  validateBlobBytes,
  CONTRACT_VERSION_V1ALPHA2,
  DURABLE_CODEC,
  PROTECTED_AAD_API_VERSION,
  PROTECTED_STORE_CONTRACT,
  PROTECTED_STORE_ENVELOPE_API_VERSION,
  PROTECTED_VALUE_API_VERSION,
  type ProtectedAad,
  type ProtectedBlob,
  type ProtectedValueRef,
} from "./protected-store.js";
import {
  NEVER_REDACTABLE_SINKS,
  NEVER_REDACTABLE_SOURCE_CLASSES,
  REDACTION_RECEIPT_API_VERSION,
} from "./receipt.js";
import { REDACTION_RULE_API_VERSION } from "./policy.js";

export type DocumentCheck =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

const OK: DocumentCheck = Object.freeze({ valid: true });

function bad(reason: string): DocumentCheck {
  return { valid: false, reason };
}

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RECORD_TYPE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const SAFE_REF = /^pv_[A-Za-z0-9][A-Za-z0-9._-]{0,124}$/;
const TIMESTAMP =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export const CHECKPOINT_V1ALPHA2_API_VERSION =
  "graphengineering.reacher-z.github.io/checkpoints/v1alpha2" as const;
export const CHECKPOINT_PROJECTION_TYPE = "scheduler-projection/v1alpha2" as const;

/** Section 6.2 node projection statuses. */
const CHECKPOINT_NODE_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "retry-wait",
  "succeeded",
  "failed",
  "skipped",
]);

const CHECKPOINT_REQUIRED = [
  "apiVersion",
  "projectionType",
  "runId",
  "checkpointId",
  "sequence",
  "createdAt",
  "graphRevision",
  "graphHash",
  "implementationHash",
  "capturePolicyHash",
  "protectedStoreContract",
  "keyRefHash",
  "historyPrefixHash",
  "totalAttempts",
  "protectedRefCount",
  "redacted",
  "payloadDisposition",
  "graphInputRef",
  "graphInputMac",
  "nodes",
  "contentHash",
] as const;

const CHECKPOINT_MAX_NODES = 2048;
const CHECKPOINT_MIN_REF_COUNT = 1;
const CHECKPOINT_MAX_REF_COUNT = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, minimum: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}

function identifier(value: unknown): boolean {
  return typeof value === "string" && IDENTIFIER.test(value) && value !== "." && value !== "..";
}

function closed(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): DocumentCheck {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return bad(`unknown-property-${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) return bad(`missing-property-${key}`);
  }
  return OK;
}

function hexFields(value: Record<string, unknown>, keys: readonly string[]): DocumentCheck {
  for (const key of keys) {
    const field = value[key];
    if (typeof field !== "string" || !SHA256.test(field)) {
      return bad(`${key}-is-not-64-lowercase-hex`);
    }
  }
  return OK;
}

export function isCaptureSourceClass(value: unknown): value is CaptureSourceClass {
  return typeof value === "string" && (CAPTURE_SOURCE_CLASSES as readonly string[]).includes(value);
}

export function isCaptureSinkClass(value: unknown): value is CaptureSinkClass {
  return typeof value === "string" && (CAPTURE_SINK_CLASSES as readonly string[]).includes(value);
}

/** Section 5.1 closed protected reference. `.` and `..` are not valid suffixes. */
export function validateProtectedValueRefDocument(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  const shape = closed(document, [
    "apiVersion",
    "ref",
    "codec",
    "ciphertextHash",
    "valueMac",
    "keyRefHash",
    "aadHash",
  ]);
  if (!shape.valid) return shape;
  if (document["apiVersion"] !== PROTECTED_VALUE_API_VERSION) return bad("unknown-version");
  if (document["codec"] !== DURABLE_CODEC) return bad("unknown-codec");
  const ref = document["ref"];
  if (typeof ref !== "string" || !SAFE_REF.test(ref) || ref === "pv_." || ref === "pv_..") {
    return bad("unsafe-reference");
  }
  return hexFields(document, ["ciphertextHash", "valueMac", "keyRefHash", "aadHash"]);
}

/** Section 5.2 protected blob, including the exact decoded byte rules. */
export function validateProtectedBlobDocument(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  const shape = closed(document, ["apiVersion", "algorithm", "nonce", "ciphertext", "tag"]);
  if (!shape.valid) return shape;
  const reason = validateBlobBytes(document as unknown as ProtectedBlob);
  return reason === undefined ? OK : bad(reason);
}

/** Section 5.5 associated data, including the event/checkpoint identity relations. */
export function validateProtectedAadDocument(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  const shape = closed(
    document,
    [
      "apiVersion",
      "contractVersion",
      "runId",
      "graphRevision",
      "recordKind",
      "recordType",
      "sequence",
      "fieldPath",
      "capturePolicyHash",
      "keyRefHash",
      "authorityBindingHash",
      "tenantScopeHash",
      "codec",
      "valueMac",
    ],
    ["nodeId", "edgeId", "attempt", "eventId", "checkpointId"],
  );
  if (!shape.valid) return shape;
  if (document["apiVersion"] !== PROTECTED_AAD_API_VERSION) return bad("unknown-version");
  if (document["contractVersion"] !== CONTRACT_VERSION_V1ALPHA2) return bad("unknown-contract");
  if (document["codec"] !== DURABLE_CODEC) return bad("unknown-codec");
  const recordType = document["recordType"];
  if (typeof recordType !== "string" || !RECORD_TYPE.test(recordType)) return bad("bad-recordType");
  const kind = document["recordKind"];
  if (kind === "event") {
    if (!Object.hasOwn(document, "eventId")) return bad("event-aad-missing-eventId");
    if (Object.hasOwn(document, "checkpointId")) return bad("event-aad-carries-checkpointId");
  } else if (kind === "checkpoint") {
    if (!Object.hasOwn(document, "checkpointId")) return bad("checkpoint-aad-missing-checkpointId");
    if (Object.hasOwn(document, "eventId")) return bad("checkpoint-aad-carries-eventId");
  } else {
    return bad("unknown-recordKind");
  }
  if (!Number.isSafeInteger(document["sequence"]) || (document["sequence"] as number) < 0) {
    return bad("bad-sequence");
  }
  if (!Number.isSafeInteger(document["graphRevision"]) || (document["graphRevision"] as number) < 1) {
    return bad("bad-graphRevision");
  }
  try {
    decodePointer(document["fieldPath"]);
  } catch {
    return bad("fieldPath-is-not-a-canonical-pointer");
  }
  return hexFields(document, [
    "capturePolicyHash",
    "keyRefHash",
    "authorityBindingHash",
    "tenantScopeHash",
    "valueMac",
  ]);
}

/**
 * Section 5.6 guarded store operation envelope. It never accepts a logical
 * plaintext value, encryption key, nonce source, free-form metadata, or raw
 * provider error.
 */
export function validateProtectedStoreEnvelopeDocument(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  if (document["apiVersion"] !== PROTECTED_STORE_ENVELOPE_API_VERSION) return bad("unknown-version");
  const operation = document["operation"];
  const common = [
    "apiVersion",
    "operationId",
    "operation",
    "runId",
    "capturePolicyHash",
    "keyRefHash",
    "authorityBindingHash",
    "tenantScopeHash",
    "protectedValue",
    "aad",
  ];
  let shape: DocumentCheck;
  if (operation === "put") shape = closed(document, [...common, "blob"]);
  else if (operation === "get") shape = closed(document, common);
  else if (operation === "delete") shape = closed(document, [...common, "deleteReason"]);
  else return bad("unknown-operation");
  if (!shape.valid) return shape;

  const reference = validateProtectedValueRefDocument(document["protectedValue"]);
  if (!reference.valid) return reference;
  const aadCheck = validateProtectedAadDocument(document["aad"]);
  if (!aadCheck.valid) return aadCheck;
  const aad = document["aad"] as unknown as ProtectedAad;
  const protectedValue = document["protectedValue"] as unknown as ProtectedValueRef;
  for (const field of [
    "runId",
    "capturePolicyHash",
    "keyRefHash",
    "authorityBindingHash",
    "tenantScopeHash",
  ] as const) {
    if (document[field] !== (aad as unknown as Record<string, unknown>)[field]) {
      return bad(`envelope-and-aad-${field}-differ`);
    }
  }
  if (protectedValue.keyRefHash !== aad.keyRefHash) return bad("reference-aad-keyRefHash-differ");
  if (protectedValue.valueMac !== aad.valueMac) return bad("reference-aad-valueMac-differ");
  if (operation === "put") {
    const blob = validateProtectedBlobDocument(document["blob"]);
    if (!blob.valid) return blob;
  }
  // Section 5.6 also requires `put` to recompute the canonical blob
  // `ciphertextHash` and AAD `aadHash`. That is an operation-boundary check
  // against live bytes, not a document-shape check: it is performed by
  // `MemoryProtectedPayloadStore.put` and `FileProtectedPayloadStore.put`. The
  // shipped corpus carries schema-valid envelopes with placeholder digests, so
  // recomputing here would reject documents the contract declares valid.
  return OK;
}

/** Section 4.1 closed redaction rule. */
export function validateRedactionRuleDocument(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  const shape = closed(document, [
    "apiVersion",
    "ruleId",
    "registryVersion",
    "sink",
    "paths",
    "replacementMode",
  ]);
  if (!shape.valid) return shape;
  if (document["apiVersion"] !== REDACTION_RULE_API_VERSION) return bad("unknown-version");
  if (!isCaptureSinkClass(document["sink"])) return bad("unknown-sink");
  const ruleId = document["ruleId"];
  if (typeof ruleId !== "string" || !IDENTIFIER.test(ruleId)) return bad("bad-ruleId");
  if (!Number.isSafeInteger(document["registryVersion"]) || (document["registryVersion"] as number) < 1) {
    return bad("bad-registryVersion");
  }
  const mode = document["replacementMode"];
  if (mode !== "remove" && mode !== "constant-token") return bad("unknown-replacement-mode");
  return validatePointerList(document["paths"]);
}

function validatePointerList(value: unknown): DocumentCheck {
  if (!Array.isArray(value) || value.length === 0) return bad("paths-must-be-a-non-empty-array");
  if (value.length > 1024) return bad("paths-exceeds-limit");
  for (const pointer of value) {
    try {
      decodePointer(pointer);
    } catch {
      return bad("pointer-is-not-canonical");
    }
  }
  for (let index = 1; index < value.length; index += 1) {
    if (compareUnicodeCodePoints(value[index - 1] as string, value[index] as string) >= 0) {
      return bad("paths-are-not-in-strict-code-point-order");
    }
  }
  return OK;
}

/** Section 3.3 closed bound receipt, including the never-redactable domains. */
export function validateRedactionReceiptDocument(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  const shape = closed(document, [
    "apiVersion",
    "policyHash",
    "sourceHash",
    "resultHash",
    "ruleSetHash",
    "transform",
    "transformImplementationHash",
    "ruleRegistryHash",
    "ruleRegistryVersion",
    "ruleResolutionId",
    "authorityBindingHash",
    "tenantScopeHash",
    "sourceClass",
    "sink",
    "decisionId",
    "runId",
    "graphRevision",
    "occurrenceKind",
    "occurrenceId",
    "occurrenceSequence",
    "occurredAt",
    "fieldPath",
    "paths",
    "replacementMode",
    "count",
  ]);
  if (!shape.valid) return shape;
  if (document["apiVersion"] !== REDACTION_RECEIPT_API_VERSION) return bad("unknown-version");
  if (document["transform"] !== "json-pointer-rules/v1alpha2") return bad("unknown-transform");
  if (!isCaptureSourceClass(document["sourceClass"])) return bad("unknown-source-class");
  if (!isCaptureSinkClass(document["sink"])) return bad("unknown-sink");
  if (NEVER_REDACTABLE_SOURCE_CLASSES.includes(document["sourceClass"] as string)) {
    return bad("authoritative-source-class-cannot-be-redacted");
  }
  if (NEVER_REDACTABLE_SINKS.includes(document["sink"] as string)) {
    return bad("protected-store-sink-cannot-carry-a-receipt");
  }
  const kind = document["occurrenceKind"];
  if (kind !== "event" && kind !== "checkpoint" && kind !== "sink-write") {
    return bad("unknown-occurrenceKind");
  }
  const mode = document["replacementMode"];
  if (mode !== "remove" && mode !== "constant-token") return bad("unknown-replacement-mode");
  const occurredAt = document["occurredAt"];
  if (typeof occurredAt !== "string" || !TIMESTAMP.test(occurredAt)) return bad("bad-occurredAt");
  const paths = validatePointerList(document["paths"]);
  if (!paths.valid) return paths;
  try {
    decodePointer(document["fieldPath"]);
  } catch {
    return bad("fieldPath-is-not-a-canonical-pointer");
  }
  if (document["count"] !== (document["paths"] as readonly string[]).length) {
    return bad("count-does-not-equal-paths-length");
  }
  return hexFields(document, [
    "policyHash",
    "sourceHash",
    "resultHash",
    "ruleSetHash",
    "transformImplementationHash",
    "ruleRegistryHash",
    "authorityBindingHash",
    "tenantScopeHash",
  ]);
}

/** Section 3.2 disposition facts as a standalone document. */
export function validatePayloadDispositionDocument(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  const shape = closed(
    document,
    ["payloadDisposition", "redacted"],
    ["redactionReceipt"],
  );
  if (!shape.valid) return shape;
  const facts = document as unknown as DispositionFacts;
  const truth = checkDispositionFacts(facts);
  if (!truth.valid) return bad(truth.reason);
  if (Object.hasOwn(document, "redactionReceipt")) {
    return validateRedactionReceiptDocument(document["redactionReceipt"]);
  }
  return OK;
}

/**
 * Section 7: the guard decision is a closed metadata-only audit projection. A
 * `failed` decision always includes the stable `failureCode`, exact
 * `executorOutcome`, and `retryDisposition`; every non-failed decision forbids
 * those three failure-disposition fields.
 */
export function validateSinkGuardDecisionDocument(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  const shape = closed(
    document,
    [
      "apiVersion",
      "decisionId",
      "sourceClass",
      "sink",
      "authorityClass",
      "capturePolicyHash",
      "outcome",
      "writeAuthorized",
    ],
    [
      "preparedPayloadHash",
      "protectedRefs",
      "redactionReceipt",
      "inlineRiskAuthorizationHash",
      "failureCode",
      "executorOutcome",
      "retryDisposition",
    ],
  );
  if (!shape.valid) return shape;
  if (
    document["apiVersion"] !== "graphengineering.reacher-z.github.io/sink-guard-decision/v1alpha1"
  ) {
    return bad("unknown-version");
  }
  if (!isCaptureSourceClass(document["sourceClass"])) return bad("unknown-source-class");
  if (!isCaptureSinkClass(document["sink"])) return bad("unknown-sink");
  const authority = document["authorityClass"];
  if (authority !== "authoritative" && authority !== "observational") {
    return bad("unknown-authorityClass");
  }
  const outcome = document["outcome"];
  const failureFields = ["failureCode", "executorOutcome", "retryDisposition"] as const;
  if (outcome === "failed") {
    for (const field of failureFields) {
      if (!Object.hasOwn(document, field)) return bad(`failed-decision-missing-${field}`);
    }
    if (!(REDACTION_FAILURE_CODES as readonly string[]).includes(document["failureCode"] as string)) {
      return bad("unknown-failureCode");
    }
    if (document["writeAuthorized"] !== false) return bad("failed-decision-authorized-a-write");
    for (const field of [
      "preparedPayloadHash",
      "protectedRefs",
      "redactionReceipt",
      "inlineRiskAuthorizationHash",
    ] as const) {
      if (Object.hasOwn(document, field)) return bad(`failed-decision-carries-${field}`);
    }
    return OK;
  }
  for (const field of failureFields) {
    if (Object.hasOwn(document, field)) return bad(`non-failed-decision-carries-${field}`);
  }
  if (outcome === "suppressed") {
    if (document["writeAuthorized"] !== false) return bad("suppressed-decision-authorized-a-write");
    return OK;
  }
  if (
    outcome !== "metadata-only" &&
    outcome !== "protected-ref" &&
    outcome !== "redacted" &&
    outcome !== "inline-unredacted"
  ) {
    return bad("unknown-outcome");
  }
  if (document["writeAuthorized"] !== true) return bad("authorized-outcome-without-writeAuthorized");
  if (!Object.hasOwn(document, "preparedPayloadHash")) return bad("missing-preparedPayloadHash");
  if (authority === "authoritative" && outcome !== "protected-ref" && outcome !== "inline-unredacted") {
    return bad("authoritative-decision-cannot-use-this-outcome");
  }
  return OK;
}

/**
 * Section 6.2 closed `checkpoints/v1alpha2` scheduler projection.
 *
 * This is the native mirror of `spec/checkpoint-v1alpha2.schema.json` and of
 * `validate_checkpoint_shape` in
 * `python/src/graph_engineering/redaction/wire.py`. It exists because the
 * TypeScript lane previously carried validators for twelve of the thirteen
 * closed wire schemas and had no native opinion at all about a checkpoint
 * projection, so a `checkpoints/v1alpha2` document carrying arbitrary inline
 * `state` was refused by Python and waved through here.
 *
 * The member-order of the two checks is load bearing and matches Python: a
 * document that is *missing* a required member is a malformed projection, while
 * a document carrying an *extra* member is legacy `checkpoints/v1alpha1`
 * arbitrary inline state, which never becomes a protected v1alpha2 projection.
 * The reasons are named so the two rejections stay distinguishable.
 */
export function validateCheckpointV1Alpha2Document(document: unknown): DocumentCheck {
  if (!isRecord(document)) return bad("not-an-object");
  for (const key of CHECKPOINT_REQUIRED) {
    if (!Object.hasOwn(document, key)) return bad(`missing-property-${key}`);
  }
  const required = new Set<string>(CHECKPOINT_REQUIRED);
  for (const key of Object.keys(document)) {
    if (!required.has(key)) return bad(`arbitrary-inline-state-${key}`);
  }
  if (document["apiVersion"] !== CHECKPOINT_V1ALPHA2_API_VERSION) return bad("unknown-version");
  if (document["projectionType"] !== CHECKPOINT_PROJECTION_TYPE) return bad("unknown-projection");
  if (document["protectedStoreContract"] !== PROTECTED_STORE_CONTRACT) {
    return bad("unknown-protected-store-contract");
  }

  // Section 3.2: the disposition and the redaction flag are joined through the
  // one truth table, then pinned to the only disposition a checkpoint may claim.
  const truth = checkDispositionFacts({
    payloadDisposition: document["payloadDisposition"],
    redacted: document["redacted"],
  } as unknown as DispositionFacts);
  if (!truth.valid) return bad(truth.reason);
  if (document["payloadDisposition"] !== "protected-ref") return bad("checkpoint-is-not-protected");

  if (!identifier(document["runId"])) return bad("bad-runId");
  if (!identifier(document["checkpointId"])) return bad("bad-checkpointId");
  const hex = hexFields(document, [
    "graphHash",
    "implementationHash",
    "capturePolicyHash",
    "keyRefHash",
    "historyPrefixHash",
    "graphInputMac",
    "contentHash",
  ]);
  if (!hex.valid) return hex;
  if (!safeInteger(document["sequence"], 0)) return bad("bad-sequence");
  if (!safeInteger(document["graphRevision"], 1)) return bad("bad-graphRevision");
  if (!safeInteger(document["totalAttempts"], 0)) return bad("bad-totalAttempts");
  const refCount = document["protectedRefCount"];
  if (
    !safeInteger(refCount, CHECKPOINT_MIN_REF_COUNT) ||
    (refCount as number) > CHECKPOINT_MAX_REF_COUNT
  ) {
    return bad("bad-protectedRefCount");
  }
  const createdAt = document["createdAt"];
  if (typeof createdAt !== "string" || !TIMESTAMP.test(createdAt)) return bad("bad-createdAt");

  const graphInput = validateProtectedValueRefDocument(document["graphInputRef"]);
  if (!graphInput.valid) return graphInput;

  const nodes = document["nodes"];
  if (!Array.isArray(nodes) || nodes.length > CHECKPOINT_MAX_NODES) return bad("bad-nodes");
  const seen = new Set<string>();
  for (const node of nodes) {
    if (!isRecord(node)) return bad("node-is-not-an-object");
    const nodeId = node["nodeId"];
    if (!identifier(nodeId)) return bad("bad-node-nodeId");
    if (typeof node["status"] !== "string" || !CHECKPOINT_NODE_STATUSES.has(node["status"])) {
      return bad("bad-node-status");
    }
    if (seen.has(nodeId as string)) return bad("duplicate-node-nodeId");
    seen.add(nodeId as string);
    for (const [key, value] of Object.entries(node)) {
      if (!key.endsWith("Ref")) continue;
      const reference = validateProtectedValueRefDocument(value);
      if (!reference.valid) return reference;
    }
  }
  return OK;
}
