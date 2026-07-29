import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { canonicalSerialize } from "@graph-engineering/core";
import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  BASELINE_EMPTY_ROOT,
  BASELINE_ENTRY_KINDS,
  BASELINE_PROJECTION_DOMAIN,
  createOperationBaselineId,
  operationBaselineDomainHash,
  type OperationBaselineProjectionIdentity,
} from "./operation-baseline.js";
import {
  SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
  SQLITE_CURSOR_SEAL_SOURCE_COLUMNS,
  type SQLiteCursorSealReceipt,
} from "./operation-baseline-cursor-invariants.js";
import {
  assertSQLiteV1BaselineCursorSourceProvenance,
  type SQLiteV1BaselineClockEvidence,
  type SQLiteV1BaselineSourceSummary,
} from "./operation-baseline-source.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;
const HASH = /^[0-9a-f]{64}$/u;
const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export const SQLITE_CURSOR_OWNERSHIP_CONTRIBUTION_DOMAIN =
  "graph-engineering/sqlite-cursor-ownership-contribution/v1\0";
export const SQLITE_CURSOR_CAPTURE_SESSION_DOMAIN =
  "graph-engineering/sqlite-cursor-capture-session/v1\0";
export const SQLITE_CURSOR_EXACT_PROJECTION_DOMAIN =
  "graph-engineering/sqlite-cursor-exact-projection/v1\0";
export const SQLITE_CURSOR_BASELINE_PROJECTION_REFERENCE_DOMAIN =
  "graph-engineering/sqlite-cursor-baseline-projection-reference/v1\0";
export const SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN =
  "graph-engineering/sqlite-cursor-pre-rebind-receipt/v1\0";

export const SQLITE_CURSOR_MAIN_SOURCE_QUERY =
  `SELECT ${SQLITE_CURSOR_SEAL_SOURCE_COLUMNS.join(", ")} FROM main.ge_cycle_cursors `
  + "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY";

export const SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS = Object.freeze(
  SQLITE_CURSOR_SEAL_SOURCE_COLUMNS.filter(
    (field) => field !== "descriptor_hash" && field !== "schema_identity_sha256",
  ),
);
export const SQLITE_CURSOR_STATIC_PROJECTION_FIELDS = Object.freeze([
  "immutablePhysicalFields", "normalizedQuerySha256", "physicalFields", "sealAlgorithmVersion",
] as const);
export const SQLITE_CURSOR_BASELINE_PROJECTION_FIELDS = Object.freeze([
  "baselineId", "cursorContractSha256", "entryCount", "finalEntryHash", "firstEntryHash",
  "legacyOperationCount", "projectionSha256",
] as const);
export const SQLITE_CURSOR_SESSION_FIELDS = Object.freeze([
  "campaignOwnershipSha256", "connectionOwnershipSha256", "nonceSha256",
  "sourceStageOwnershipSha256", "tenantOwnershipSha256",
] as const);
export const SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS = Object.freeze([
  "campaignOwnershipSha256", "captureSessionSha256", "capturedAtMs",
  "connectionOwnershipSha256", "cursorCount", "immutableRootSha256",
  "maximumNonCursorObservedAtMs", "projectionReferenceSha256", "providerHighWaterAtMs",
  "sourceDescriptorHash", "sourceSchemaIdentitySha256", "sourceStageOwnershipSha256",
  "tenantOwnershipSha256",
] as const);

export type SQLiteCursorOwnershipKind = "tenant" | "source-stage" | "campaign" | "connection";
export interface SQLiteCursorOwnershipCapability { readonly __sqliteCursorOwnership: never }
export interface SQLiteCursorCaptureSession { readonly __sqliteCursorSession: never }

interface CapabilityState { readonly kind: SQLiteCursorOwnershipKind; readonly commitment: string }
interface SessionState {
  readonly campaign: SQLiteCursorOwnershipCapability;
  readonly connection: SQLiteCursorOwnershipCapability;
  readonly sourceStage: SQLiteCursorOwnershipCapability;
  readonly tenant: SQLiteCursorOwnershipCapability;
  readonly payload: Readonly<Record<(typeof SQLITE_CURSOR_SESSION_FIELDS)[number], string>>;
  readonly sessionSha256: string;
}
const CAPABILITIES = new WeakMap<object, CapabilityState>();
const SESSIONS = new WeakMap<object, SessionState>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;

function weakMapGet<K extends object, V>(map: WeakMap<K, V>, key: K): V | undefined {
  return Reflect.apply(weakMapGetIntrinsic, map, [key]) as V | undefined;
}

function weakMapSet<K extends object, V>(map: WeakMap<K, V>, key: K, value: V): void {
  Reflect.apply(weakMapSetIntrinsic, map, [key, value]);
}

function fail(label: string, invalid = false): never {
  throw new CycleStoreProviderError(
    invalid ? "GE_CYCLE_STORE_INVALID_ARGUMENT" : "GE_CYCLE_STORE_CORRUPTION",
    OPERATION,
    `SQLite cursor pre-rebind ${label} is invalid`,
  );
}
function u64(value: number): Buffer {
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(value)); return bytes;
}
function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value)) return fail(label);
  return value;
}
function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_SAFE) {
    return fail(label);
  }
  return value as number;
}
function framed(domain: string, value: unknown): string {
  const bytes = Buffer.from(canonicalSerialize(value), "utf8");
  return createHash("sha256").update(domain, "utf8").update(u64(bytes.length)).update(bytes).digest("hex");
}
function contribution(kind: SQLiteCursorOwnershipKind | "nonce", bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) return fail(`${kind} bytes`, true);
  const copy = Buffer.from(bytes); const label = Buffer.from(kind, "utf8");
  return createHash("sha256").update(SQLITE_CURSOR_OWNERSHIP_CONTRIBUTION_DOMAIN, "utf8")
    .update(u64(label.length)).update(label).update(u64(copy.length)).update(copy).digest("hex");
}
function exactDataObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return fail(label, true);
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) {
      return fail(label, true);
    }
    const snapshot: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor)) return fail(label, true);
      snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch (error) {
    if (error instanceof CycleStoreProviderError) throw error;
    return fail(label, true);
  }
}

function exactStringDataObject(
  value: unknown,
  fields: readonly string[],
  label: string,
): Readonly<Record<string, unknown>> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.getPrototypeOf(value) !== Object.prototype) return fail(label, true);
    const keys = Object.getOwnPropertyNames(value);
    if (keys.length !== fields.length || !fields.every((field) => keys.includes(field))) {
      return fail(label, true);
    }
    const snapshot: Record<string, unknown> = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      if (!descriptor || !("value" in descriptor)) return fail(label, true);
      snapshot[field] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch (error) {
    if (error instanceof CycleStoreProviderError) throw error;
    return fail(label, true);
  }
}

export function createSQLiteCursorOwnershipCapability(
  kind: SQLiteCursorOwnershipKind,
  reference: Uint8Array,
): SQLiteCursorOwnershipCapability {
  if (!["tenant", "source-stage", "campaign", "connection"].includes(kind)) {
    return fail("ownership kind", true);
  }
  const handle = Object.freeze(Object.create(null)) as SQLiteCursorOwnershipCapability;
  weakMapSet(CAPABILITIES, handle as object,
    Object.freeze({ kind, commitment: contribution(kind, reference) }));
  return handle;
}

export interface SQLiteCursorCaptureSessionInput {
  readonly campaignOwnership: SQLiteCursorOwnershipCapability;
  readonly connectionOwnership: SQLiteCursorOwnershipCapability;
  readonly nonce: Uint8Array;
  readonly sourceStageOwnership: SQLiteCursorOwnershipCapability;
  readonly tenantOwnership: SQLiteCursorOwnershipCapability;
}
function capability(value: SQLiteCursorOwnershipCapability, kind: SQLiteCursorOwnershipKind): CapabilityState {
  const state = weakMapGet(CAPABILITIES, value as object);
  if (state?.kind !== kind) return fail(`${kind} ownership`, true);
  return state;
}
export function createSQLiteCursorCaptureSession(input: SQLiteCursorCaptureSessionInput): SQLiteCursorCaptureSession {
  const fields = exactDataObject(input, ["campaignOwnership", "connectionOwnership", "nonce",
    "sourceStageOwnership", "tenantOwnership"], "capture session input");
  if (!(fields.nonce instanceof Uint8Array) || fields.nonce.byteLength !== 32) {
    return fail("nonce bytes", true);
  }
  const snapshot = {
    campaignOwnership: fields.campaignOwnership as SQLiteCursorOwnershipCapability,
    connectionOwnership: fields.connectionOwnership as SQLiteCursorOwnershipCapability,
    nonce: Buffer.from(fields.nonce),
    sourceStageOwnership: fields.sourceStageOwnership as SQLiteCursorOwnershipCapability,
    tenantOwnership: fields.tenantOwnership as SQLiteCursorOwnershipCapability,
  };
  const campaign = capability(snapshot.campaignOwnership, "campaign");
  const connection = capability(snapshot.connectionOwnership, "connection");
  const sourceStage = capability(snapshot.sourceStageOwnership, "source-stage");
  const tenant = capability(snapshot.tenantOwnership, "tenant");
  const payload = Object.freeze({
    campaignOwnershipSha256: campaign.commitment,
    connectionOwnershipSha256: connection.commitment,
    nonceSha256: contribution("nonce", snapshot.nonce),
    sourceStageOwnershipSha256: sourceStage.commitment,
    tenantOwnershipSha256: tenant.commitment,
  });
  const session = Object.freeze(Object.create(null)) as SQLiteCursorCaptureSession;
  weakMapSet(SESSIONS, session as object, Object.freeze({
    campaign: snapshot.campaignOwnership, connection: snapshot.connectionOwnership,
    sourceStage: snapshot.sourceStageOwnership, tenant: snapshot.tenantOwnership,
    payload, sessionSha256: framed(SQLITE_CURSOR_CAPTURE_SESSION_DOMAIN, payload),
  }));
  return session;
}

export interface SQLiteCursorExactProjectionReference {
  readonly __sqliteCursorProjectionReference: never;
}
interface ProjectionState {
  readonly document: Readonly<Record<string, string | number>>;
  readonly identity: OperationBaselineProjectionIdentity;
  readonly identitySnapshot: OperationBaselineProjectionIdentity;
  readonly root: string;
}
const PROJECTIONS = new WeakMap<object, ProjectionState>();
const staticProjection = Object.freeze({
  immutablePhysicalFields: SQLITE_CURSOR_IMMUTABLE_PHYSICAL_FIELDS,
  normalizedQuerySha256: createHash("sha256").update(SQLITE_CURSOR_MAIN_SOURCE_QUERY).digest("hex"),
  physicalFields: SQLITE_CURSOR_SEAL_SOURCE_COLUMNS,
  sealAlgorithmVersion: SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
});
export const SQLITE_CURSOR_STATIC_PROJECTION_SHA256 = framed(
  SQLITE_CURSOR_EXACT_PROJECTION_DOMAIN, staticProjection,
);

function validateProjection(value: OperationBaselineProjectionIdentity): void {
  const entryCount = integer(value.entryCount, "projection entry count");
  const legacyOperationCount = integer(value.legacyOperationCount, "projection legacy count");
  if (legacyOperationCount > entryCount || !/^v2-[0-9a-f]{64}$/u.test(value.baselineId)) {
    return fail("projection identity");
  }
  const expected = operationBaselineDomainHash(BASELINE_PROJECTION_DOMAIN, {
    baselineId: value.baselineId, entryCount, finalEntryHash: hash(value.finalEntryHash, "final hash"),
    firstEntryHash: hash(value.firstEntryHash, "first hash"), legacyOperationCount,
  });
  if (hash(value.projectionSha256, "projection hash") !== expected) return fail("projection hash");
  const empty = entryCount === 0;
  if ((value.firstEntryHash === BASELINE_EMPTY_ROOT) !== empty
      || (value.finalEntryHash === BASELINE_EMPTY_ROOT) !== empty) {
    return fail("projection empty root");
  }
}
export function createSQLiteCursorExactProjectionReference(
  projection: OperationBaselineProjectionIdentity,
): SQLiteCursorExactProjectionReference {
  if (!Object.isFrozen(projection)) return fail("unfrozen projection identity", true);
  const fields = exactDataObject(projection, ["baselineId", "entryCount", "finalEntryHash", "firstEntryHash",
    "legacyOperationCount", "projectionSha256"], "projection identity");
  const identitySnapshot = Object.freeze({
    baselineId: fields.baselineId,
    entryCount: fields.entryCount,
    finalEntryHash: fields.finalEntryHash,
    firstEntryHash: fields.firstEntryHash,
    legacyOperationCount: fields.legacyOperationCount,
    projectionSha256: fields.projectionSha256,
  }) as OperationBaselineProjectionIdentity;
  validateProjection(identitySnapshot);
  const payload = Object.freeze({
    baselineId: identitySnapshot.baselineId,
    cursorContractSha256: SQLITE_CURSOR_STATIC_PROJECTION_SHA256,
    entryCount: identitySnapshot.entryCount,
    finalEntryHash: identitySnapshot.finalEntryHash,
    firstEntryHash: identitySnapshot.firstEntryHash,
    legacyOperationCount: identitySnapshot.legacyOperationCount,
    projectionSha256: identitySnapshot.projectionSha256,
  });
  const reference = Object.freeze(Object.create(null)) as SQLiteCursorExactProjectionReference;
  weakMapSet(PROJECTIONS, reference as object, Object.freeze({
    document: payload, identity: projection, identitySnapshot,
    root: framed(SQLITE_CURSOR_BASELINE_PROJECTION_REFERENCE_DOMAIN, payload),
  }));
  return reference;
}

export interface SQLiteCursorPreRebindIssueInput {
  readonly campaignOwnership: SQLiteCursorOwnershipCapability;
  readonly clockEvidence: SQLiteV1BaselineClockEvidence;
  readonly connectionOwnership: SQLiteCursorOwnershipCapability;
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly projectionReference: SQLiteCursorExactProjectionReference;
  readonly sealReceipt: SQLiteCursorSealReceipt;
  readonly session: SQLiteCursorCaptureSession;
  readonly sourceStageOwnership: SQLiteCursorOwnershipCapability;
  readonly sourceSummary: SQLiteV1BaselineSourceSummary;
  readonly tenantOwnership: SQLiteCursorOwnershipCapability;
}
export interface SQLiteCursorPreRebindReceipt {
  readonly __sqliteCursorPreRebindReceipt: never;
}
/** Opaque pre-TEMP binding of one A2b receipt to its exact captured connection. */
export interface SQLiteCursorPreRebindConnectionProvenance {
  readonly __sqliteCursorPreRebindConnectionProvenance: never;
}
interface ReceiptState {
  readonly binding: Readonly<SQLiteCursorPreRebindIssueInput>;
  readonly payload: Readonly<Record<string, string | number>>;
  readonly root: string;
}
const RECEIPTS = new WeakMap<object, ReceiptState>();
interface ConnectionProvenanceState {
  readonly receipt: SQLiteCursorPreRebindReceipt;
}
const CONNECTION_PROVENANCE = new WeakMap<object, ConnectionProvenanceState>();

const ISSUE_FIELDS = Object.freeze([
  "campaignOwnership", "clockEvidence", "connectionOwnership", "projectionIdentity",
  "projectionReference", "sealReceipt", "session", "sourceStageOwnership", "sourceSummary",
  "tenantOwnership",
] as const);
function snapshotIssue(input: SQLiteCursorPreRebindIssueInput): Readonly<SQLiteCursorPreRebindIssueInput> {
  try {
    const fields = exactDataObject(input, ISSUE_FIELDS, "issue input");
    return Object.freeze({
      campaignOwnership: fields.campaignOwnership as SQLiteCursorOwnershipCapability,
      clockEvidence: fields.clockEvidence as SQLiteV1BaselineClockEvidence,
      connectionOwnership: fields.connectionOwnership as SQLiteCursorOwnershipCapability,
      projectionIdentity: fields.projectionIdentity as OperationBaselineProjectionIdentity,
      projectionReference: fields.projectionReference as SQLiteCursorExactProjectionReference,
      sealReceipt: fields.sealReceipt as SQLiteCursorSealReceipt,
      session: fields.session as SQLiteCursorCaptureSession,
      sourceStageOwnership: fields.sourceStageOwnership as SQLiteCursorOwnershipCapability,
      sourceSummary: fields.sourceSummary as SQLiteV1BaselineSourceSummary,
      tenantOwnership: fields.tenantOwnership as SQLiteCursorOwnershipCapability,
    });
  } catch (error) {
    if (error instanceof CycleStoreProviderError) throw error;
    return fail("issue input", true);
  }
}

interface ValidatedBinding {
  readonly clockEvidence: SQLiteV1BaselineClockEvidence;
  readonly projection: ProjectionState;
  readonly sealReceipt: SQLiteCursorSealReceipt;
  readonly session: SessionState;
}
function validateBinding(input: SQLiteCursorPreRebindIssueInput): ValidatedBinding {
  if (!Object.isFrozen(input.sourceSummary) || !Object.isFrozen(input.clockEvidence)
      || !Object.isFrozen(input.sealReceipt) || !Object.isFrozen(input.projectionIdentity)
      || !Object.isFrozen(input.projectionReference)) return fail("unfrozen source binding", true);
  const clockFields = exactDataObject(input.clockEvidence,
    ["capturedAtMs", "maximumNonCursorObservedAtMs", "providerHighWaterAtMs"], "clock evidence");
  const receiptFields = exactDataObject(input.sealReceipt, ["cursorCount", "immutableRootSha256",
    "sourceDescriptorHash", "sourceSchemaIdentitySha256"], "A1 receipt");
  const summaryFields = exactStringDataObject(input.sourceSummary,
    ["clockEvidence", "countsByKind", "entries", "expectedEntryCount", "sourceEnvelope"],
    "source summary");
  if (summaryFields.clockEvidence !== input.clockEvidence
      || typeof summaryFields.entries !== "function"
      || !Object.isFrozen(summaryFields.countsByKind)
      || !Object.isFrozen(summaryFields.sourceEnvelope)) return fail("source summary", true);
  const countFields = exactDataObject(summaryFields.countsByKind, BASELINE_ENTRY_KINDS, "source counts");
  let total = 0;
  for (const kind of BASELINE_ENTRY_KINDS) {
    const count = integer(countFields[kind], `${kind} source count`);
    if (total > MAX_SAFE - count) return fail("source count total");
    total += count;
  }
  const expectedEntryCount = integer(summaryFields.expectedEntryCount, "expected entry count");
  if (total !== expectedEntryCount) return fail("source count total");
  const session = weakMapGet(SESSIONS, input.session as object);
  if (!session) return fail("session", true);
  if (session.campaign !== input.campaignOwnership || session.connection !== input.connectionOwnership
      || session.sourceStage !== input.sourceStageOwnership || session.tenant !== input.tenantOwnership) {
    return fail("session ownership", true);
  }
  const projectionState = weakMapGet(PROJECTIONS, input.projectionReference);
  if (projectionState?.identity !== input.projectionIdentity) {
    return fail("source or projection ownership", true);
  }
  validateProjection(projectionState.identitySnapshot);
  const freshProjectionDocument = Object.freeze({
    baselineId: projectionState.identitySnapshot.baselineId,
    cursorContractSha256: SQLITE_CURSOR_STATIC_PROJECTION_SHA256,
    entryCount: projectionState.identitySnapshot.entryCount,
    finalEntryHash: projectionState.identitySnapshot.finalEntryHash,
    firstEntryHash: projectionState.identitySnapshot.firstEntryHash,
    legacyOperationCount: projectionState.identitySnapshot.legacyOperationCount,
    projectionSha256: projectionState.identitySnapshot.projectionSha256,
  });
  if (canonicalSerialize(freshProjectionDocument) !== canonicalSerialize(projectionState.document)
      || framed(SQLITE_CURSOR_BASELINE_PROJECTION_REFERENCE_DOMAIN, freshProjectionDocument)
        !== projectionState.root) return fail("projection reference drift");
  const envelope = summaryFields.sourceEnvelope as SQLiteV1BaselineSourceSummary["sourceEnvelope"];
  const captured = integer(clockFields.capturedAtMs, "capture clock");
  const maximum = integer(clockFields.maximumNonCursorObservedAtMs, "non-cursor clock");
  const highWater = integer(clockFields.providerHighWaterAtMs, "provider high-water");
  let baselineId: string;
  try { baselineId = createOperationBaselineId(envelope); } catch { return fail("source envelope"); }
  if (baselineId !== projectionState.identitySnapshot.baselineId
      || projectionState.identitySnapshot.entryCount !== expectedEntryCount
      || projectionState.identitySnapshot.legacyOperationCount !== countFields["legacy-operation"]
      || envelope.capturedAtMs !== captured || highWater < maximum || captured < highWater
      || receiptFields.sourceDescriptorHash !== envelope.sourceDescriptorHash
      || receiptFields.sourceSchemaIdentitySha256 !== envelope.sourceSchemaIdentitySha256) {
    return fail("mixed source binding");
  }
  const cursorCount = integer(receiptFields.cursorCount, "cursor count");
  const root = hash(receiptFields.immutableRootSha256, "root");
  if ((cursorCount === 0) !== (root === SQLITE_CURSOR_SEAL_EMPTY_ROOT)) {
    return fail("empty cursor root");
  }
  return Object.freeze({
    clockEvidence: Object.freeze({ capturedAtMs: captured,
      maximumNonCursorObservedAtMs: maximum, providerHighWaterAtMs: highWater }),
    projection: projectionState,
    sealReceipt: Object.freeze({ cursorCount, immutableRootSha256: root,
      sourceDescriptorHash: hash(receiptFields.sourceDescriptorHash, "source descriptor"),
      sourceSchemaIdentitySha256: hash(receiptFields.sourceSchemaIdentitySha256, "source schema") }),
    session,
  });
}

export class SQLiteCursorPreRebindReceiptIssuer {
  readonly #expected: SQLiteCursorPreRebindIssueInput;
  #issued = false;
  constructor(expected: SQLiteCursorPreRebindIssueInput) {
    const snapshot = snapshotIssue(expected); validateBinding(snapshot); this.#expected = snapshot;
  }
  issue(candidate: SQLiteCursorPreRebindIssueInput): SQLiteCursorPreRebindReceipt {
    if (this.#issued) return fail("issuer reuse", true);
    const candidateSnapshot = snapshotIssue(candidate);
    if (candidateSnapshot.sourceSummary !== this.#expected.sourceSummary
        || candidate.clockEvidence !== this.#expected.clockEvidence
        || candidate.sealReceipt !== this.#expected.sealReceipt
        || candidate.projectionIdentity !== this.#expected.projectionIdentity
        || candidate.projectionReference !== this.#expected.projectionReference
        || candidate.session !== this.#expected.session
        || candidate.tenantOwnership !== this.#expected.tenantOwnership
        || candidate.sourceStageOwnership !== this.#expected.sourceStageOwnership
        || candidate.campaignOwnership !== this.#expected.campaignOwnership
        || candidate.connectionOwnership !== this.#expected.connectionOwnership) {
      return fail("candidate substitution", true);
    }
    const validated = validateBinding(candidateSnapshot);
    const { session } = validated;
    const payload = Object.freeze({
      campaignOwnershipSha256: session.payload.campaignOwnershipSha256,
      captureSessionSha256: session.sessionSha256,
      capturedAtMs: validated.clockEvidence.capturedAtMs,
      connectionOwnershipSha256: session.payload.connectionOwnershipSha256,
      cursorCount: validated.sealReceipt.cursorCount,
      immutableRootSha256: validated.sealReceipt.immutableRootSha256,
      maximumNonCursorObservedAtMs: validated.clockEvidence.maximumNonCursorObservedAtMs,
      projectionReferenceSha256: validated.projection.root,
      providerHighWaterAtMs: validated.clockEvidence.providerHighWaterAtMs,
      sourceDescriptorHash: validated.sealReceipt.sourceDescriptorHash,
      sourceSchemaIdentitySha256: validated.sealReceipt.sourceSchemaIdentitySha256,
      sourceStageOwnershipSha256: session.payload.sourceStageOwnershipSha256,
      tenantOwnershipSha256: session.payload.tenantOwnershipSha256,
    });
    exactDataObject(payload, SQLITE_CURSOR_PRE_REBIND_RECEIPT_FIELDS, "receipt payload");
    const receipt = Object.freeze(Object.create(null)) as SQLiteCursorPreRebindReceipt;
    weakMapSet(RECEIPTS, receipt as object, Object.freeze({
      binding: candidateSnapshot, payload,
      root: framed(SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN, payload),
    }));
    this.#issued = true;
    return receipt;
  }
}

/** Non-consuming package-private provenance fence for the future Slice B owner. */
export function assertSQLiteCursorPreRebindReceiptProvenance(
  receipt: SQLiteCursorPreRebindReceipt,
): Readonly<SQLiteCursorPreRebindIssueInput & {
  receiptSha256: string;
  projectionReferenceSha256: string;
}> {
  const state = weakMapGet(RECEIPTS, receipt as object);
  if (!state) return fail("receipt provenance", true);
  validateBinding(state.binding);
  if (state.root !== framed(SQLITE_CURSOR_PRE_REBIND_RECEIPT_DOMAIN, state.payload)) {
    return fail("receipt mutation");
  }
  return Object.freeze({
    ...state.binding,
    receiptSha256: state.root,
    projectionReferenceSha256:
      (weakMapGet(PROJECTIONS, state.binding.projectionReference) as ProjectionState).root,
  });
}

/**
 * First Slice B owner fence. A2b provenance is always checked before the live
 * connection is touched, and the source summary is derived only from A2b's
 * retained witness rather than accepted again from the caller.
 *
 * The returned handle is opaque. The future TEMP-stage tranche will retain it
 * while the stage assumes ownership of later DDL epochs and allowed writes.
 */
export function assertSQLiteCursorPreRebindConnectionProvenance(
  connection: SQLiteConnection,
  receipt: SQLiteCursorPreRebindReceipt,
): SQLiteCursorPreRebindConnectionProvenance {
  const receiptWitness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  assertSQLiteV1BaselineCursorSourceProvenance(
    receiptWitness.sourceSummary,
    connection,
  );
  const provenance = Object.freeze(
    Object.create(null),
  ) as SQLiteCursorPreRebindConnectionProvenance;
  // Repeat the module-owned private snapshot immediately before the witness is
  // registered and becomes observable to the caller.
  assertSQLiteV1BaselineCursorSourceProvenance(
    receiptWitness.sourceSummary,
    connection,
  );
  weakMapSet(CONNECTION_PROVENANCE, provenance as object, Object.freeze({
    receipt,
  }));
  return provenance;
}

/** Revalidate until B0 performs its one-way stage/campaign ownership transfer. */
export function assertSQLiteCursorPreRebindConnectionProvenanceWitness(
  connection: SQLiteConnection,
  receipt: SQLiteCursorPreRebindReceipt,
  provenance: SQLiteCursorPreRebindConnectionProvenance,
): SQLiteCursorPreRebindConnectionProvenance {
  // Keep A2b authoritative and first, including when the connection is closed
  // or the presented connection witness is forged.
  const freshReceiptWitness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
  const state = provenance !== null && typeof provenance === "object"
    ? weakMapGet(CONNECTION_PROVENANCE, provenance as object)
    : undefined;
  if (state === undefined
      || state.receipt !== receipt) {
    return fail("connection provenance witness", true);
  }
  assertSQLiteV1BaselineCursorSourceProvenance(
    freshReceiptWitness.sourceSummary,
    connection,
  );
  return provenance;
}
