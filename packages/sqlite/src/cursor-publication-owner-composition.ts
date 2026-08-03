import { isProxy } from "node:util/types";

import {
  readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic,
  type SQLiteCursorRule12SuccessReceipt,
} from "./cursor-publication-rule12.js";
import {
  abortSQLiteCursorPublicationOwnerCompositionAdoptionIntrinsic as abortOwnerComposition,
  adoptSQLiteCursorPublicationOwnerCompositionIntrinsic as adoptOwnerComposition,
  assertSQLiteCursorPublicationOwnerCompositionCurrentIntrinsic,
  captureSQLiteCursorPublicationTransactionFailureIntrinsic,
  finalizeSQLiteCursorPublicationTransactionFailureIntrinsic,
  prepareSQLiteCursorPublicationOwnerCompositionAdoptionIntrinsic as prepareOwnerComposition,
  readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic,
  readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic,
  type SQLiteCursorPublicationTransactionBeginReceipt,
  type SQLiteCursorPublicationTransactionBeginReceiptSnapshot,
  type SQLiteCursorPublicationTransactionOwner,
} from "./cursor-publication-transaction-owner.js";

const objectCreateIntrinsic = Object.create;
const objectFreezeIntrinsic = Object.freeze;
const arrayIncludesIntrinsic = Array.prototype.includes;
const arraySomeIntrinsic = Array.prototype.some;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const reflectApplyIntrinsic = Reflect.apply;
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapHasIntrinsic = WeakMap.prototype.has;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakRefDerefIntrinsic = WeakRef.prototype.deref;
const weakRefIntrinsic = WeakRef;

export type SQLiteCursorPublicationOwnerCompositionErrorCode =
  | "GE_SQLITE_P11_INVALID_AUTHORITY"
  | "GE_SQLITE_P11_INVALID_STATE"
  | "GE_SQLITE_P11_ADOPTION_REPLAY"
  | "GE_SQLITE_P11_SCOPE_INVALID"
  | "GE_SQLITE_P11_SCOPE_ORDER"
  | "GE_SQLITE_P11_FIXED_READ_INVALID"
  | "GE_SQLITE_P11_FIXED_READ_ORDER"
  | "GE_SQLITE_P11_RULE12_NOT_OWNER_SCOPED";

export class SQLiteCursorPublicationOwnerCompositionError extends Error {
  readonly code: SQLiteCursorPublicationOwnerCompositionErrorCode;

  constructor(
    code: SQLiteCursorPublicationOwnerCompositionErrorCode,
    message: string,
    options: ErrorOptions = {},
  ) {
    super(message, options);
    this.name = "SQLiteCursorPublicationOwnerCompositionError";
    this.code = code;
  }
}

/** Package-private P11 authority.  It is deliberately absent from index.ts. */
export interface SQLiteCursorPublicationOwnerComposition {
  readonly __sqliteCursorPublicationOwnerComposition: never;
}

export interface SQLiteCursorPublicationOwnerCompositionSnapshot {
  readonly lifecycle: "begin-adopted" | "poisoned";
  readonly exactOwner: true;
  readonly exactBeginReceipt: true;
  readonly beginTransactionEpoch: bigint;
  readonly beginTotalChanges: number;
  readonly beginTempMutationEpoch: bigint;
  readonly currentTransactionEpoch: bigint;
  readonly currentTotalChanges: number;
  readonly currentTempMutationEpoch: bigint;
  readonly acceptedStageIds: readonly [];
  readonly acceptedStageReceiptCount: 0;
  readonly highestAccepted30Stage: null;
  readonly rule12Selected: false;
  readonly thirdEvidenceConsumed: false;
  readonly stage18Accepted: false;
  readonly commitPresented: false;
  readonly commitAttemptCount: 0;
  readonly publicApi: false;
}

export type SQLiteCursorPublicationMutationScopeModel =
  | "child-owned-one-shot"
  | "parent-owned-reusable";

export interface SQLiteCursorPublicationMutationRouteDescriptor {
  readonly routeId:
    | "b2.cursor-seal-table-ddl"
    | "main.migration-0002"
    | "main.baseline-entries"
    | "main.baseline-header"
    | "main.operation-sequence-zero"
    | "main.cursor-rebind";
  readonly model: SQLiteCursorPublicationMutationScopeModel;
  readonly bindingKind: "sql-sha256" | "asset-sha256";
  readonly bindingSha256: string;
}

export const SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES = objectFreezeIntrinsic([
  objectFreezeIntrinsic({
    bindingKind: "sql-sha256",
    bindingSha256: "032db65e1e8c11d90ed27fc6a6e2cab130d1bf33c7d688381f5666379c52b84a",
    routeId: "b2.cursor-seal-table-ddl",
    model: "child-owned-one-shot",
  }),
  objectFreezeIntrinsic({
    bindingKind: "asset-sha256",
    bindingSha256: "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d",
    routeId: "main.migration-0002",
    model: "child-owned-one-shot",
  }),
  objectFreezeIntrinsic({
    bindingKind: "sql-sha256",
    bindingSha256: "b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b",
    routeId: "main.baseline-entries",
    model: "parent-owned-reusable",
  }),
  objectFreezeIntrinsic({
    bindingKind: "sql-sha256",
    bindingSha256: "b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a",
    routeId: "main.baseline-header",
    model: "child-owned-one-shot",
  }),
  objectFreezeIntrinsic({
    bindingKind: "sql-sha256",
    bindingSha256: "a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85",
    routeId: "main.operation-sequence-zero",
    model: "child-owned-one-shot",
  }),
  objectFreezeIntrinsic({
    bindingKind: "sql-sha256",
    bindingSha256: "6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91",
    routeId: "main.cursor-rebind",
    model: "child-owned-one-shot",
  }),
] as const satisfies readonly SQLiteCursorPublicationMutationRouteDescriptor[]);

export interface SQLiteCursorPublicationMutationParentScope {
  readonly __sqliteCursorPublicationMutationParentScope: never;
}

export interface SQLiteCursorPublicationMutationChildPermit {
  readonly __sqliteCursorPublicationMutationChildPermit: never;
}

export interface SQLiteCursorPublicationMutationParentScopeSnapshot {
  readonly routeId: SQLiteCursorPublicationMutationRouteDescriptor["routeId"];
  readonly bindingKind: SQLiteCursorPublicationMutationRouteDescriptor["bindingKind"];
  readonly bindingSha256: string;
  readonly model: SQLiteCursorPublicationMutationScopeModel;
  readonly lifecycle:
    | "parent-issued"
    | "parent-ready"
    | "child-active"
    | "awaiting-zero-postflight"
    | "awaiting-parent-resource-retirement"
    | "parent-complete"
    | "parent-consumed"
    | "poisoned";
  readonly expectedCount: number;
  readonly nextOrdinal: number;
  readonly childIssuedCount: number;
  readonly childEnteredCount: number;
  readonly childNativeReturnCount: number;
  readonly childResourceRetiredCount: number;
  readonly childPostflightAcceptedCount: number;
  readonly childConsumedCount: number;
  readonly reusableParentPrepareCount: 0 | 1;
  readonly reusableExecutionLeaseReleasedCount: number;
  readonly parentResourceRetiredCount: 0 | 1;
  readonly actualNativeIoCount: 0;
  readonly sqlAuthority: false;
}

export interface SQLiteCursorPublicationMutationChildPermitSnapshot {
  readonly ordinal: number;
  readonly model: SQLiteCursorPublicationMutationScopeModel;
  readonly lifecycle:
    | "child-issued"
    | "child-entered"
    | "child-native-returned"
    | "child-resource-retired"
    | "child-postflight-accepted"
    | "child-consumed"
    | "poisoned";
  readonly actualNativeIoCount: 0;
  readonly sqlAuthority: false;
}

export type SQLiteCursorPublicationFixedReadResourceKind =
  | "iterator-return"
  | "lexical-release";

export interface SQLiteCursorPublicationFixedReadRouteDescriptor {
  readonly routeId: string;
  readonly family: "owner-active-read" | "b2-eqp" | "rule12-eqp";
  readonly sqlSha256: string;
}

export const SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES = objectFreezeIntrinsic([
  objectFreezeIntrinsic({
    family: "owner-active-read" as const,
    routeId: "read.temp-table-list",
    sqlSha256: "1a5673ba64ea33f0bf3f0d5bd9327b1aaf16314c9a04d231e99e250e6fd56a23",
  }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.source", sqlSha256: "dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.stage-insert", sqlSha256: "fbcf5255335c392f4f18818d8f12e79abbcfc677f768579fbe05f317a7a4774b" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.stage-seal", sqlSha256: "c169d8478a327605640a031bc1129d699341165bc6f59bdf7151c3e33677458e" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.count-marker", sqlSha256: "d4fa6279ee8d237b0ec82d9aed1b70e804d45890dd6d02313ac9ffea6260c830" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.event-lookup", sqlSha256: "86a336dc93fc818fc41b0e2fdf204256dc197515919f5431084e71adf45585d4" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.checkpoint-lookup", sqlSha256: "8b6322cee22b003a9d8ac33caafcde5272473e9da86dc7f8d21db3209523aba0" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.authorization", sqlSha256: "4b05dede61e9303c06a459416e8d6da4eac6007dedbab602ae4f4b942e9fbebf" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.scope", sqlSha256: "9bf6d38c051294f87798839738e5f913c69a54e8ac81dd571e36eda33ea8b628" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.blob-canonical", sqlSha256: "64b77f510a88d3091603b5d9c93d58a5eb69d65c20f67c081847654434e514b8" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.position", sqlSha256: "aa3a0bbb0a07137a0e497c9140d359608358b5fd3bf1ac7e1ed15a34893678b3" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.expiry-consumption", sqlSha256: "494b6ae97f33349cfb787afedc3bbf2ee69021a669abb4dd14273028d2117771" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.catalog-binding", sqlSha256: "6dec1fa0dc5aa8b48c9fa45c50ed2dba32cb2a01c83f934407484c1200460562" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.shape", sqlSha256: "2600c8112c8e55f814a0f57ea50b822eb14c91e13871bec99965e7aa6a91c8cd" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.event-binding", sqlSha256: "515c1832cfc0238339a838245b7afabc83ca319e7f74fdeabbad6904152e3909" }),
  objectFreezeIntrinsic({ family: "b2-eqp" as const, routeId: "b2.eqp.row-marker.checkpoint-binding", sqlSha256: "92315896aa7d1f1acab782dad89641687da88350f5843f9c34d32026f6a9c8ce" }),
  objectFreezeIntrinsic({ family: "rule12-eqp" as const, routeId: "rule12.eqp.main-key-scan", sqlSha256: "09d1ce669070093fbbf0dfd8ce7e2a7bbfde96d051b3ce9341be85495479ec32" }),
  objectFreezeIntrinsic({ family: "rule12-eqp" as const, routeId: "rule12.eqp.temp-key-driver", sqlSha256: "1694ab6fe938203b0d8f6cb72cf82238e89234c21086ff5d224c7de4db7b1266" }),
  objectFreezeIntrinsic({ family: "rule12-eqp" as const, routeId: "rule12.eqp.main-point-lookup", sqlSha256: "bd056ee55f2bd27eee3277ed7bfee8ae7b7db935edc3cf0937fc8167e2eac342" }),
] as const satisfies readonly SQLiteCursorPublicationFixedReadRouteDescriptor[]);

export interface SQLiteCursorPublicationFixedReadPermit {
  readonly __sqliteCursorPublicationFixedReadPermit: never;
}

export interface SQLiteCursorPublicationFixedReadPermitSnapshot {
  readonly routeId: string;
  readonly sqlSha256: string;
  readonly family: SQLiteCursorPublicationFixedReadRouteDescriptor["family"];
  readonly lifecycle:
    | "issued"
    | "prepared"
    | "bounded-reading"
    | "terminal-row-observed"
    | "resource-retired"
    | "consumed"
    | "poisoned";
  readonly maximumRows: number;
  readonly observedRows: number;
  readonly maximumCursors: 1;
  readonly prepareCount: 0 | 1;
  readonly terminalRowObserved: boolean;
  readonly resourceRetired: boolean;
  readonly resourceKind: SQLiteCursorPublicationFixedReadResourceKind | null;
  readonly consumeCount: 0 | 1;
  readonly actualNativeIoCount: 0;
  readonly mutationDelta: 0;
  readonly sqlAuthority: false;
}

export type SQLiteCursorPublicationOwnerCompositionAdoptionFaultPoint =
  | "registration"
  | "binding"
  | "pending"
  | "owner-adopt";

interface CompositionState {
  readonly token: SQLiteCursorPublicationOwnerComposition;
  readonly owner: SQLiteCursorPublicationTransactionOwner;
  readonly beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt;
  readonly begin: SQLiteCursorPublicationTransactionBeginReceiptSnapshot;
  lifecycle: "constructing" | "begin-adopted" | "poisoned";
}

interface ParentScopeState {
  readonly token: SQLiteCursorPublicationMutationParentScope;
  readonly composition: SQLiteCursorPublicationOwnerComposition;
  readonly descriptor: SQLiteCursorPublicationMutationRouteDescriptor;
  readonly expectedCount: number;
  lifecycle: SQLiteCursorPublicationMutationParentScopeSnapshot["lifecycle"];
  nextOrdinal: number;
  activeChild: SQLiteCursorPublicationMutationChildPermit | undefined;
  childIssuedCount: number;
  childEnteredCount: number;
  childNativeReturnCount: number;
  childResourceRetiredCount: number;
  childPostflightAcceptedCount: number;
  childConsumedCount: number;
  reusableParentPrepareCount: 0 | 1;
  reusableExecutionLeaseReleasedCount: number;
  parentResourceRetiredCount: 0 | 1;
}

interface ChildPermitState {
  readonly token: SQLiteCursorPublicationMutationChildPermit;
  readonly parent: SQLiteCursorPublicationMutationParentScope;
  readonly ordinal: number;
  readonly model: SQLiteCursorPublicationMutationScopeModel;
  lifecycle: SQLiteCursorPublicationMutationChildPermitSnapshot["lifecycle"];
}

interface FixedReadPermitState {
  readonly token: SQLiteCursorPublicationFixedReadPermit;
  readonly composition: SQLiteCursorPublicationOwnerComposition;
  readonly descriptor: SQLiteCursorPublicationFixedReadRouteDescriptor;
  readonly maximumRows: number;
  lifecycle: SQLiteCursorPublicationFixedReadPermitSnapshot["lifecycle"];
  observedRows: number;
  prepareCount: 0 | 1;
  terminalRowObserved: boolean;
  resourceRetired: boolean;
  resourceKind: SQLiteCursorPublicationFixedReadResourceKind | null;
  consumeCount: 0 | 1;
}

const COMPOSITIONS = new WeakMap<object, CompositionState>();
const OWNER_ADOPTIONS = new WeakMap<object, WeakRef<object>>();
const BEGIN_RECEIPT_ADOPTIONS = new WeakMap<object, WeakRef<object>>();
const PARENT_SCOPES = new WeakMap<object, ParentScopeState>();
const CHILD_PERMITS = new WeakMap<object, ChildPermitState>();
const FIXED_READ_PERMITS = new WeakMap<object, FixedReadPermitState>();
let adoptionFaultForTest: Readonly<{
  readonly point: SQLiteCursorPublicationOwnerCompositionAdoptionFaultPoint;
  readonly primary: object;
  readonly observer: ((composition: SQLiteCursorPublicationOwnerComposition) => void) | undefined;
}> | undefined;

function fail(
  code: SQLiteCursorPublicationOwnerCompositionErrorCode,
  message: string,
  options: ErrorOptions = {},
): never {
  throw new SQLiteCursorPublicationOwnerCompositionError(code, message, options);
}

function presentation(value: object, label: string): void {
  if (value === null || typeof value !== "object" || isProxy(value)) {
    fail("GE_SQLITE_P11_INVALID_AUTHORITY", `${label} is not an exact opaque object`);
  }
}

function stateFor(
  composition: SQLiteCursorPublicationOwnerComposition,
): CompositionState {
  presentation(composition as object, "owner composition");
  const state = reflectApplyIntrinsic(weakMapGetIntrinsic, COMPOSITIONS, [
    composition as object,
  ]) as CompositionState | undefined;
  if (state === undefined || state.token !== composition) {
    return fail("GE_SQLITE_P11_INVALID_AUTHORITY", "owner composition is stale");
  }
  return state;
}

function parentStateFor(
  parent: SQLiteCursorPublicationMutationParentScope,
): ParentScopeState {
  presentation(parent as object, "mutation parent scope");
  const state = reflectApplyIntrinsic(weakMapGetIntrinsic, PARENT_SCOPES, [
    parent as object,
  ]) as ParentScopeState | undefined;
  if (state === undefined || state.token !== parent) {
    return fail("GE_SQLITE_P11_SCOPE_INVALID", "mutation parent scope is stale");
  }
  let composition: CompositionState | undefined;
  try {
    composition = stateFor(state.composition);
    if (composition.lifecycle !== "begin-adopted") {
      return fail("GE_SQLITE_P11_INVALID_STATE", "mutation composition is terminal");
    }
    authenticateActiveBegin(composition);
  } catch (error) {
    state.lifecycle = "poisoned";
    if (composition?.lifecycle === "begin-adopted") {
      return terminalCompositionFailure(composition, primaryObject(error));
    }
    throw error;
  }
  return state;
}

function childStateFor(
  child: SQLiteCursorPublicationMutationChildPermit,
): ChildPermitState {
  presentation(child as object, "mutation child permit");
  const state = reflectApplyIntrinsic(weakMapGetIntrinsic, CHILD_PERMITS, [
    child as object,
  ]) as ChildPermitState | undefined;
  if (state === undefined || state.token !== child) {
    return fail("GE_SQLITE_P11_SCOPE_INVALID", "mutation child permit is stale");
  }
  parentStateFor(state.parent);
  return state;
}

function fixedReadStateFor(
  permit: SQLiteCursorPublicationFixedReadPermit,
): FixedReadPermitState {
  presentation(permit as object, "fixed-read permit");
  const state = reflectApplyIntrinsic(weakMapGetIntrinsic, FIXED_READ_PERMITS, [
    permit as object,
  ]) as FixedReadPermitState | undefined;
  if (state === undefined || state.token !== permit) {
    return fail("GE_SQLITE_P11_FIXED_READ_INVALID", "fixed-read permit is stale");
  }
  let composition: CompositionState | undefined;
  try {
    composition = stateFor(state.composition);
    if (composition.lifecycle !== "begin-adopted") {
      return fail("GE_SQLITE_P11_INVALID_STATE", "fixed-read composition is terminal");
    }
    authenticateActiveBegin(composition);
  } catch (error) {
    state.lifecycle = "poisoned";
    if (composition?.lifecycle === "begin-adopted") {
      return terminalCompositionFailure(composition, primaryObject(error));
    }
    throw error;
  }
  return state;
}

function isExactMutationDescriptor(
  descriptor: SQLiteCursorPublicationMutationRouteDescriptor,
): boolean {
  return reflectApplyIntrinsic(arraySomeIntrinsic, SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES, [
    (value: SQLiteCursorPublicationMutationRouteDescriptor) => value === descriptor,
  ]) as boolean;
}

function isExactMutationExpectedCount(
  descriptor: SQLiteCursorPublicationMutationRouteDescriptor,
  expectedCount: number,
): boolean {
  if (!numberIsSafeIntegerIntrinsic(expectedCount)) return false;
  if (descriptor === SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1]) {
    return expectedCount === 20;
  }
  if (descriptor === SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]) {
    return expectedCount >= 0 && expectedCount <= 1_024;
  }
  return (descriptor === SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0]
      || descriptor === SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[3]
      || descriptor === SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[4]
      || descriptor === SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[5])
    && expectedCount === 1;
}

function isExactFixedReadDescriptor(
  descriptor: SQLiteCursorPublicationFixedReadRouteDescriptor,
): boolean {
  return reflectApplyIntrinsic(arraySomeIntrinsic, SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES, [
    (value: SQLiteCursorPublicationFixedReadRouteDescriptor) => value === descriptor,
  ]) as boolean;
}

function primaryObject(cause: unknown): object {
  return cause !== null && typeof cause === "object"
    ? cause
    : new SQLiteCursorPublicationOwnerCompositionError(
      "GE_SQLITE_P11_INVALID_STATE",
      "P11 terminal failure was not an object",
      { cause },
    );
}

function terminalCompositionFailure(
  composition: CompositionState,
  primary: object,
): never {
  composition.lifecycle = "poisoned";
  const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(
    composition.owner,
    primary,
  );
  return finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture);
}

function authenticateActiveBeginOrTerminate(
  composition: CompositionState,
): ReturnType<typeof authenticateActiveBegin> {
  try {
    return authenticateActiveBegin(composition);
  } catch (error) {
    if (composition.lifecycle === "begin-adopted") {
      return terminalCompositionFailure(composition, primaryObject(error));
    }
    throw error;
  }
}

function poisonParent(parent: ParentScopeState, child?: ChildPermitState): never {
  parent.lifecycle = "poisoned";
  if (child !== undefined) child.lifecycle = "poisoned";
  const composition = stateFor(parent.composition);
  const primary = new SQLiteCursorPublicationOwnerCompositionError(
    "GE_SQLITE_P11_SCOPE_ORDER",
    "mutation permit transition is out of order",
  );
  return terminalCompositionFailure(composition, primary);
}

function maybeThrowAdoptionFault(
  point: SQLiteCursorPublicationOwnerCompositionAdoptionFaultPoint,
  composition: SQLiteCursorPublicationOwnerComposition,
): void {
  const fault = adoptionFaultForTest;
  if (fault === undefined || fault.point !== point) return;
  adoptionFaultForTest = undefined;
  fault.observer?.(composition);
  throw fault.primary;
}

function authenticateActiveBegin(state: CompositionState): Readonly<{
  readonly begin: SQLiteCursorPublicationTransactionBeginReceiptSnapshot;
  readonly currentTransactionEpoch: bigint;
  readonly currentTotalChanges: number;
  readonly currentTempMutationEpoch: bigint;
}> {
  try {
    const begin = readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(
      state.owner,
      state.beginReceipt,
    );
    const current = assertSQLiteCursorPublicationOwnerCompositionCurrentIntrinsic(
      state.owner,
      state.beginReceipt,
      state.token as object,
    );
    if (begin.transactionEpoch !== state.begin.transactionEpoch
        || begin.totalChanges !== state.begin.totalChanges
        || begin.tempMutationEpoch !== state.begin.tempMutationEpoch
        || begin.transactionEpoch > current.transactionEpoch
        || begin.totalChanges > current.totalChanges
        || begin.tempMutationEpoch > current.tempMutationEpoch) {
      return fail("GE_SQLITE_P11_INVALID_STATE", "owner BEGIN composition drifted");
    }
    return {
      begin,
      currentTempMutationEpoch: current.tempMutationEpoch,
      currentTotalChanges: current.totalChanges,
      currentTransactionEpoch: current.transactionEpoch,
    };
  } catch (cause) {
    if (cause instanceof SQLiteCursorPublicationOwnerCompositionError) throw cause;
    return fail(
      "GE_SQLITE_P11_INVALID_AUTHORITY",
      "owner BEGIN composition could not be authenticated",
      { cause },
    );
  }
}

/**
 * One-shot adopt the exact active P9 owner and its current immutable BEGIN receipt.
 *
 * P11-A intentionally stops here: this authority has no mutation/read permit,
 * accepted 30-stage receipt, Rule 12 selection, third consume, or COMMIT route.
 */
export function injectSQLiteCursorPublicationOwnerCompositionAdoptionFaultForTestIntrinsic(
  point: SQLiteCursorPublicationOwnerCompositionAdoptionFaultPoint,
  primary: object,
  observer?: (composition: SQLiteCursorPublicationOwnerComposition) => void,
): void {
  if (!(reflectApplyIntrinsic(arrayIncludesIntrinsic,
    ["registration", "binding", "pending", "owner-adopt"], [point]) as boolean)
      || primary === null || typeof primary !== "object" || isProxy(primary)
      || adoptionFaultForTest !== undefined || (observer !== undefined && typeof observer !== "function")) {
    fail("GE_SQLITE_P11_INVALID_STATE", "composition fault seam is invalid");
  }
  adoptionFaultForTest = { observer, point, primary };
}

export function adoptSQLiteCursorPublicationOwnerCompositionIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
  beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt,
): SQLiteCursorPublicationOwnerComposition {
  presentation(owner as object, "transaction owner");
  presentation(beginReceipt as object, "BEGIN receipt");
  if (reflectApplyIntrinsic(weakMapHasIntrinsic, OWNER_ADOPTIONS, [owner as object])
      || reflectApplyIntrinsic(weakMapHasIntrinsic, BEGIN_RECEIPT_ADOPTIONS, [
        beginReceipt as object,
      ])) {
    return fail("GE_SQLITE_P11_ADOPTION_REPLAY", "owner or BEGIN receipt was already adopted");
  }
  let begin: SQLiteCursorPublicationTransactionBeginReceiptSnapshot;
  try {
    begin = readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(owner, beginReceipt);
    const ownerSnapshot = readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner);
    if (ownerSnapshot.lifecycle !== "active" || ownerSnapshot.beginAttemptCount !== 1
        || ownerSnapshot.beginNativeReturnCount !== 1
        || ownerSnapshot.beginReceiptMintCount !== 1
        || ownerSnapshot.commitAttemptCount !== 0 || !ownerSnapshot.commitHardDisabled
        || !ownerSnapshot.hasExactTransactionLineage
        || !ownerSnapshot.hasExactTransactionGeneration || !ownerSnapshot.exclusiveMode
        || begin.transactionEpoch !== ownerSnapshot.transactionEpoch
        || begin.totalChanges !== ownerSnapshot.totalChanges
        || begin.tempMutationEpoch !== ownerSnapshot.tempMutationEpoch) {
      return fail("GE_SQLITE_P11_INVALID_STATE", "P9 owner BEGIN graph is not current");
    }
  } catch (cause) {
    if (cause instanceof SQLiteCursorPublicationOwnerCompositionError) throw cause;
    return fail(
      "GE_SQLITE_P11_INVALID_AUTHORITY",
      "P9 owner and BEGIN receipt are not the same exact graph",
      { cause },
    );
  }
  const composition = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorPublicationOwnerComposition;
  const state: CompositionState = {
    begin,
    beginReceipt,
    lifecycle: "constructing",
    owner,
    token: composition,
  };
  let pending = false;
  let ownerAdopted = false;
  try {
    reflectApplyIntrinsic(weakMapSetIntrinsic, COMPOSITIONS, [composition as object, state]);
    maybeThrowAdoptionFault("registration", composition);
    reflectApplyIntrinsic(weakMapSetIntrinsic, OWNER_ADOPTIONS, [
      owner as object,
      new weakRefIntrinsic(composition as object),
    ]);
    reflectApplyIntrinsic(weakMapSetIntrinsic, BEGIN_RECEIPT_ADOPTIONS, [
      beginReceipt as object,
      new weakRefIntrinsic(composition as object),
    ]);
    maybeThrowAdoptionFault("binding", composition);
    prepareOwnerComposition(owner, beginReceipt, composition as object);
    pending = true;
    maybeThrowAdoptionFault("pending", composition);
    adoptOwnerComposition(owner, beginReceipt, composition as object);
    pending = false;
    ownerAdopted = true;
    maybeThrowAdoptionFault("owner-adopt", composition);
    state.lifecycle = "begin-adopted";
    return composition;
  } catch (cause) {
    state.lifecycle = "poisoned";
    if (pending && !ownerAdopted) {
      try {
        abortOwnerComposition(owner, composition as object);
      } catch {
        // P9 failure finalization remains the only cleanup authority.
      }
    }
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, COMPOSITIONS, [composition as object]);
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, OWNER_ADOPTIONS, [owner as object]);
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, BEGIN_RECEIPT_ADOPTIONS, [
      beginReceipt as object,
    ]);
    const primary = cause !== null && typeof cause === "object"
      ? cause as object
      : new SQLiteCursorPublicationOwnerCompositionError(
        "GE_SQLITE_P11_INVALID_STATE",
        "composition adoption threw a non-object primary",
        { cause },
      );
    const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(owner, primary);
    return finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture);
  }
}

/** Read scalar-only P11-A evidence; no owner, receipt, connection, path, or scope leaks. */
export function readSQLiteCursorPublicationOwnerCompositionSnapshotIntrinsic(
  composition: SQLiteCursorPublicationOwnerComposition,
): SQLiteCursorPublicationOwnerCompositionSnapshot {
  const state = stateFor(composition);
  if (state.lifecycle === "constructing") {
    return fail("GE_SQLITE_P11_INVALID_STATE", "owner composition is not published");
  }
  const current = authenticateActiveBeginOrTerminate(state);
  return objectFreezeIntrinsic({
    acceptedStageIds: objectFreezeIntrinsic([]) as readonly [],
    acceptedStageReceiptCount: 0,
    beginTempMutationEpoch: state.begin.tempMutationEpoch,
    beginTotalChanges: state.begin.totalChanges,
    beginTransactionEpoch: state.begin.transactionEpoch,
    commitAttemptCount: 0,
    commitPresented: false,
    currentTempMutationEpoch: current.currentTempMutationEpoch,
    currentTotalChanges: current.currentTotalChanges,
    currentTransactionEpoch: current.currentTransactionEpoch,
    exactBeginReceipt: true,
    exactOwner: true,
    highestAccepted30Stage: null,
    lifecycle: state.lifecycle,
    publicApi: false,
    rule12Selected: false,
    stage18Accepted: false,
    thirdEvidenceConsumed: false,
  });
}

/** Issue a pure P11-A parent scope; it has no SQL or connection execution surface. */
export function issueSQLiteCursorPublicationMutationParentScopeIntrinsic(
  composition: SQLiteCursorPublicationOwnerComposition,
  descriptor: SQLiteCursorPublicationMutationRouteDescriptor,
  expectedCount: number,
): SQLiteCursorPublicationMutationParentScope {
  const compositionState = stateFor(composition);
  if (compositionState.lifecycle !== "begin-adopted") {
    return fail("GE_SQLITE_P11_SCOPE_INVALID", "mutation parent scope input is invalid");
  }
  if (!isExactMutationDescriptor(descriptor)
      || !isExactMutationExpectedCount(descriptor, expectedCount)) {
    return terminalCompositionFailure(
      compositionState,
      new SQLiteCursorPublicationOwnerCompositionError(
        "GE_SQLITE_P11_SCOPE_INVALID",
        "mutation parent scope input is invalid",
      ),
    );
  }
  authenticateActiveBeginOrTerminate(compositionState);
  const parent = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorPublicationMutationParentScope;
  const reusable = descriptor.model === "parent-owned-reusable";
  const state: ParentScopeState = {
    activeChild: undefined,
    childConsumedCount: 0,
    childEnteredCount: 0,
    childIssuedCount: 0,
    childNativeReturnCount: 0,
    childPostflightAcceptedCount: 0,
    childResourceRetiredCount: 0,
    composition,
    descriptor,
    expectedCount,
    lifecycle: reusable
      ? "parent-issued"
      : expectedCount === 0 ? "awaiting-zero-postflight" : "parent-ready",
    nextOrdinal: 0,
    parentResourceRetiredCount: 0,
    reusableExecutionLeaseReleasedCount: 0,
    reusableParentPrepareCount: 0,
    token: parent,
  };
  reflectApplyIntrinsic(weakMapSetIntrinsic, PARENT_SCOPES, [parent as object, state]);
  return parent;
}

export function prepareSQLiteCursorPublicationReusableParentIntrinsic(
  parent: SQLiteCursorPublicationMutationParentScope,
): void {
  const state = parentStateFor(parent);
  if (state.descriptor.model !== "parent-owned-reusable"
      || state.lifecycle !== "parent-issued" || state.reusableParentPrepareCount !== 0) {
    return poisonParent(state);
  }
  state.reusableParentPrepareCount = 1;
  state.lifecycle = state.expectedCount === 0
    ? "awaiting-zero-postflight"
    : "parent-ready";
}

export function issueSQLiteCursorPublicationMutationChildPermitIntrinsic(
  parent: SQLiteCursorPublicationMutationParentScope,
  ordinal: number,
): SQLiteCursorPublicationMutationChildPermit {
  const state = parentStateFor(parent);
  if (state.lifecycle !== "parent-ready" || state.activeChild !== undefined
      || ordinal !== state.nextOrdinal || ordinal >= state.expectedCount) {
    return poisonParent(state);
  }
  const child = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorPublicationMutationChildPermit;
  const childState: ChildPermitState = {
    lifecycle: "child-issued",
    model: state.descriptor.model,
    ordinal,
    parent,
    token: child,
  };
  state.activeChild = child;
  state.childIssuedCount += 1;
  state.lifecycle = "child-active";
  reflectApplyIntrinsic(weakMapSetIntrinsic, CHILD_PERMITS, [child as object, childState]);
  return child;
}

export function enterSQLiteCursorPublicationMutationChildPermitIntrinsic(
  child: SQLiteCursorPublicationMutationChildPermit,
): void {
  const childState = childStateFor(child);
  const parent = parentStateFor(childState.parent);
  if (parent.activeChild !== child || parent.lifecycle !== "child-active"
      || childState.lifecycle !== "child-issued") {
    return poisonParent(parent, childState);
  }
  childState.lifecycle = "child-entered";
  parent.childEnteredCount += 1;
}

/** Record a lower-owned return signal without executing or accepting SQL in this module. */
export function recordSQLiteCursorPublicationMutationChildReturnIntrinsic(
  child: SQLiteCursorPublicationMutationChildPermit,
): void {
  const childState = childStateFor(child);
  const parent = parentStateFor(childState.parent);
  if (parent.activeChild !== child || childState.lifecycle !== "child-entered") {
    return poisonParent(parent, childState);
  }
  childState.lifecycle = "child-native-returned";
  parent.childNativeReturnCount += 1;
}

export function retireSQLiteCursorPublicationMutationChildResourceIntrinsic(
  child: SQLiteCursorPublicationMutationChildPermit,
): void {
  const childState = childStateFor(child);
  const parent = parentStateFor(childState.parent);
  if (parent.activeChild !== child || childState.lifecycle !== "child-native-returned") {
    return poisonParent(parent, childState);
  }
  childState.lifecycle = "child-resource-retired";
  parent.childResourceRetiredCount += 1;
  if (childState.model === "parent-owned-reusable") {
    parent.reusableExecutionLeaseReleasedCount += 1;
  }
}

export function acceptSQLiteCursorPublicationMutationChildPostflightIntrinsic(
  child: SQLiteCursorPublicationMutationChildPermit,
): void {
  const childState = childStateFor(child);
  const parent = parentStateFor(childState.parent);
  if (parent.activeChild !== child || childState.lifecycle !== "child-resource-retired") {
    return poisonParent(parent, childState);
  }
  childState.lifecycle = "child-postflight-accepted";
  parent.childPostflightAcceptedCount += 1;
}

export function consumeSQLiteCursorPublicationMutationChildPermitIntrinsic(
  child: SQLiteCursorPublicationMutationChildPermit,
): void {
  const childState = childStateFor(child);
  const parent = parentStateFor(childState.parent);
  if (parent.activeChild !== child || childState.lifecycle !== "child-postflight-accepted"
      || childState.ordinal !== parent.nextOrdinal) {
    return poisonParent(parent, childState);
  }
  childState.lifecycle = "child-consumed";
  parent.childConsumedCount += 1;
  parent.nextOrdinal += 1;
  parent.activeChild = undefined;
  if (parent.nextOrdinal < parent.expectedCount) {
    parent.lifecycle = "parent-ready";
  } else {
    parent.lifecycle = parent.descriptor.model === "parent-owned-reusable"
      ? "awaiting-parent-resource-retirement"
      : "parent-complete";
  }
}

export function acceptSQLiteCursorPublicationMutationZeroItemPostflightIntrinsic(
  parent: SQLiteCursorPublicationMutationParentScope,
): void {
  const state = parentStateFor(parent);
  if (state.expectedCount !== 0 || state.lifecycle !== "awaiting-zero-postflight") {
    return poisonParent(state);
  }
  state.lifecycle = state.descriptor.model === "parent-owned-reusable"
    ? "awaiting-parent-resource-retirement"
    : "parent-complete";
}

export function retireSQLiteCursorPublicationReusableParentResourceIntrinsic(
  parent: SQLiteCursorPublicationMutationParentScope,
): void {
  const state = parentStateFor(parent);
  if (state.descriptor.model !== "parent-owned-reusable"
      || state.lifecycle !== "awaiting-parent-resource-retirement"
      || state.reusableParentPrepareCount !== 1 || state.parentResourceRetiredCount !== 0) {
    return poisonParent(state);
  }
  state.parentResourceRetiredCount = 1;
  state.lifecycle = "parent-complete";
}

export function consumeSQLiteCursorPublicationMutationParentScopeIntrinsic(
  parent: SQLiteCursorPublicationMutationParentScope,
): void {
  const state = parentStateFor(parent);
  if (state.lifecycle !== "parent-complete" || state.nextOrdinal !== state.expectedCount) {
    return poisonParent(state);
  }
  state.lifecycle = "parent-consumed";
}

export function readSQLiteCursorPublicationMutationParentScopeSnapshotIntrinsic(
  parent: SQLiteCursorPublicationMutationParentScope,
): SQLiteCursorPublicationMutationParentScopeSnapshot {
  const state = parentStateFor(parent);
  return objectFreezeIntrinsic({
    actualNativeIoCount: 0,
    bindingKind: state.descriptor.bindingKind,
    bindingSha256: state.descriptor.bindingSha256,
    childConsumedCount: state.childConsumedCount,
    childEnteredCount: state.childEnteredCount,
    childIssuedCount: state.childIssuedCount,
    childNativeReturnCount: state.childNativeReturnCount,
    childPostflightAcceptedCount: state.childPostflightAcceptedCount,
    childResourceRetiredCount: state.childResourceRetiredCount,
    expectedCount: state.expectedCount,
    lifecycle: state.lifecycle,
    model: state.descriptor.model,
    nextOrdinal: state.nextOrdinal,
    parentResourceRetiredCount: state.parentResourceRetiredCount,
    reusableExecutionLeaseReleasedCount: state.reusableExecutionLeaseReleasedCount,
    reusableParentPrepareCount: state.reusableParentPrepareCount,
    routeId: state.descriptor.routeId,
    sqlAuthority: false,
  });
}

export function readSQLiteCursorPublicationMutationChildPermitSnapshotIntrinsic(
  child: SQLiteCursorPublicationMutationChildPermit,
): SQLiteCursorPublicationMutationChildPermitSnapshot {
  const state = childStateFor(child);
  return objectFreezeIntrinsic({
    actualNativeIoCount: 0,
    lifecycle: state.lifecycle,
    model: state.model,
    ordinal: state.ordinal,
    sqlAuthority: false,
  });
}

export function issueSQLiteCursorPublicationFixedReadPermitIntrinsic(
  composition: SQLiteCursorPublicationOwnerComposition,
  descriptor: SQLiteCursorPublicationFixedReadRouteDescriptor,
  maximumRows: number,
): SQLiteCursorPublicationFixedReadPermit {
  const compositionState = stateFor(composition);
  if (compositionState.lifecycle !== "begin-adopted") {
    return fail("GE_SQLITE_P11_FIXED_READ_INVALID", "fixed-read permit input is invalid");
  }
  if (!isExactFixedReadDescriptor(descriptor)
      || !numberIsSafeIntegerIntrinsic(maximumRows) || maximumRows < 0 || maximumRows > 4_096) {
    return terminalCompositionFailure(
      compositionState,
      new SQLiteCursorPublicationOwnerCompositionError(
        "GE_SQLITE_P11_FIXED_READ_INVALID",
        "fixed-read permit input is invalid",
      ),
    );
  }
  authenticateActiveBeginOrTerminate(compositionState);
  const permit = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorPublicationFixedReadPermit;
  const state: FixedReadPermitState = {
    composition,
    consumeCount: 0,
    descriptor,
    lifecycle: "issued",
    maximumRows,
    observedRows: 0,
    prepareCount: 0,
    resourceKind: null,
    resourceRetired: false,
    terminalRowObserved: false,
    token: permit,
  };
  reflectApplyIntrinsic(weakMapSetIntrinsic, FIXED_READ_PERMITS, [permit as object, state]);
  return permit;
}

function fixedReadOrder(state: FixedReadPermitState): never {
  state.lifecycle = "poisoned";
  const composition = stateFor(state.composition);
  const primary = new SQLiteCursorPublicationOwnerCompositionError(
    "GE_SQLITE_P11_FIXED_READ_ORDER",
    "fixed-read transition is out of order",
  );
  return terminalCompositionFailure(composition, primary);
}

export function prepareSQLiteCursorPublicationFixedReadPermitIntrinsic(
  permit: SQLiteCursorPublicationFixedReadPermit,
): void {
  const state = fixedReadStateFor(permit);
  if (state.lifecycle !== "issued" || state.prepareCount !== 0) return fixedReadOrder(state);
  state.prepareCount = 1;
  state.lifecycle = "prepared";
}

export function beginSQLiteCursorPublicationFixedReadIntrinsic(
  permit: SQLiteCursorPublicationFixedReadPermit,
): void {
  const state = fixedReadStateFor(permit);
  if (state.lifecycle !== "prepared") return fixedReadOrder(state);
  state.lifecycle = "bounded-reading";
}

export function observeSQLiteCursorPublicationFixedReadRowIntrinsic(
  permit: SQLiteCursorPublicationFixedReadPermit,
): void {
  const state = fixedReadStateFor(permit);
  if (state.lifecycle !== "bounded-reading" || state.observedRows >= state.maximumRows) {
    return fixedReadOrder(state);
  }
  state.observedRows += 1;
}

export function observeSQLiteCursorPublicationFixedReadTerminalIntrinsic(
  permit: SQLiteCursorPublicationFixedReadPermit,
): void {
  const state = fixedReadStateFor(permit);
  if (state.lifecycle !== "bounded-reading" || state.terminalRowObserved) {
    return fixedReadOrder(state);
  }
  state.terminalRowObserved = true;
  state.lifecycle = "terminal-row-observed";
}

export function retireSQLiteCursorPublicationFixedReadResourceIntrinsic(
  permit: SQLiteCursorPublicationFixedReadPermit,
  resourceKind: SQLiteCursorPublicationFixedReadResourceKind,
): void {
  const state = fixedReadStateFor(permit);
  if (state.lifecycle !== "terminal-row-observed" || state.resourceRetired
      || !(reflectApplyIntrinsic(arrayIncludesIntrinsic,
        ["iterator-return", "lexical-release"], [resourceKind]) as boolean)) {
    return fixedReadOrder(state);
  }
  state.resourceKind = resourceKind;
  state.resourceRetired = true;
  state.lifecycle = "resource-retired";
}

export function consumeSQLiteCursorPublicationFixedReadPermitIntrinsic(
  permit: SQLiteCursorPublicationFixedReadPermit,
): void {
  const state = fixedReadStateFor(permit);
  if (state.lifecycle !== "resource-retired" || state.consumeCount !== 0) {
    return fixedReadOrder(state);
  }
  state.consumeCount = 1;
  state.lifecycle = "consumed";
}

export function readSQLiteCursorPublicationFixedReadPermitSnapshotIntrinsic(
  permit: SQLiteCursorPublicationFixedReadPermit,
): SQLiteCursorPublicationFixedReadPermitSnapshot {
  const state = fixedReadStateFor(permit);
  return objectFreezeIntrinsic({
    actualNativeIoCount: 0,
    consumeCount: state.consumeCount,
    family: state.descriptor.family,
    lifecycle: state.lifecycle,
    maximumCursors: 1,
    maximumRows: state.maximumRows,
    mutationDelta: 0,
    observedRows: state.observedRows,
    prepareCount: state.prepareCount,
    resourceKind: state.resourceKind,
    resourceRetired: state.resourceRetired,
    routeId: state.descriptor.routeId,
    sqlSha256: state.descriptor.sqlSha256,
    sqlAuthority: false,
    terminalRowObserved: state.terminalRowObserved,
  });
}

/** Test-only bounded stop; it reuses the exact P9 failure capture/finalizer. */
export function boundedStopSQLiteCursorPublicationOwnerCompositionForTestIntrinsic(
  composition: SQLiteCursorPublicationOwnerComposition,
  primary: object,
): never {
  const state = stateFor(composition);
  if (state.lifecycle !== "begin-adopted" || primary === null || typeof primary !== "object"
      || isProxy(primary)) {
    return fail("GE_SQLITE_P11_INVALID_STATE", "bounded-stop presentation is invalid");
  }
  authenticateActiveBeginOrTerminate(state);
  state.lifecycle = "poisoned";
  const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(state.owner, primary);
  return finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture);
}

/**
 * P11-A redbar for the system-level P9/P10 gap.
 *
 * Existing P10 receipts originate from the legacy raw-BEGIN graph and carry no
 * transitive owner-composition identity.  Merely comparing connection or
 * watermark scalars would be false integration, so this tranche authenticates
 * the receipt and then rejects it terminally.  P11-D will replace this redbar
 * only after every lower write/read has retained this exact composition.
 */
export function assertSQLiteCursorPublicationOwnerCompositionRule12Intrinsic(
  composition: SQLiteCursorPublicationOwnerComposition,
  rule12Receipt: SQLiteCursorRule12SuccessReceipt,
): never {
  const state = stateFor(composition);
  if (state.lifecycle !== "begin-adopted") {
    return fail("GE_SQLITE_P11_INVALID_STATE", "owner composition is terminal");
  }
  authenticateActiveBeginOrTerminate(state);
  try {
    readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(rule12Receipt);
  } catch (cause) {
    return terminalCompositionFailure(
      state,
      new SQLiteCursorPublicationOwnerCompositionError(
        "GE_SQLITE_P11_INVALID_AUTHORITY",
        "Rule 12 receipt is not an authentic selected graph",
        { cause },
      ),
    );
  }
  return terminalCompositionFailure(
    state,
    new SQLiteCursorPublicationOwnerCompositionError(
      "GE_SQLITE_P11_RULE12_NOT_OWNER_SCOPED",
      "legacy Rule 12 graph does not retain the exact P9 owner composition",
    ),
  );
}
