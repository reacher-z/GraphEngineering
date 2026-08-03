import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import { digestSQLiteInitialWriteParametersIntrinsic } from
  "./cursor-publication-initial-write-digest.js";
import {
  adoptSQLiteCursorPostRebindWatermarkIntrinsic,
  assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic,
  assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic,
  consumeSQLiteCursorPublicationSessionForRebindIntrinsic,
  isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic,
  poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic,
  prepareSQLiteCursorPublicationRebindContextIntrinsic,
  readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic,
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
  readSQLiteCursorPublicationSessionSnapshotIntrinsic,
  releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic,
  type SQLiteCursorOuterPublicationAuthority,
  type SQLiteCursorOuterPublicationLedgerSnapshot,
  type SQLiteCursorPostRebindWatermarkAdoption,
  type SQLiteCursorPostRebindWatermarkAdoptionSnapshot,
  type SQLiteCursorPublicationRebindContext,
  type SQLiteCursorPublicationRebindContextSnapshot,
  type SQLiteCursorPublicationRebindPreparedOwner,
  type SQLiteCursorPublicationSession,
  type SQLiteCursorPublicationSessionCancellationSignal,
  type SQLiteCursorPublicationSessionConsumedTombstone,
} from "./cursor-publication-outer-authority.js";
import {
  beginSQLiteConnectionCursorRebindExecutionIntrinsic,
  executeSQLiteConnectionCursorRebindIntrinsic,
  injectSQLiteConnectionCursorRebindChangesFaultForTestIntrinsic,
  injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic,
  injectSQLiteConnectionCursorRebindReleaseFaultForTestIntrinsic,
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic,
  releaseSQLiteConnectionCursorRebindExecutionIntrinsic,
  takeSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic,
  type SQLiteConnection,
  type SQLiteConnectionCursorRebindExecution,
  type SQLiteConnectionCursorRebindExecutionSnapshot,
  type SQLiteConnectionTransactionLineage,
  type SQLiteCursorRebindChangesFaultStage,
  type SQLiteCursorRebindEvidenceMismatchDimension,
} from "./sqlite-connection.js";

const isProxyIntrinsic = isProxy;
const objectCreateIntrinsic = Object.create;
const objectFreezeIntrinsic = Object.freeze;
const objectGetOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const reflectApplyIntrinsic = Reflect.apply;
const reflectOwnKeysIntrinsic = Reflect.ownKeys;
const arrayIncludesIntrinsic = Array.prototype.includes;
const arrayIsArrayIntrinsic = Array.isArray;
const arrayPrototypeIntrinsic = Array.prototype;
const objectGetPrototypeOfIntrinsic = Object.getPrototypeOf;
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;
const weakMapHasIntrinsic = WeakMap.prototype.has;
const weakRefIntrinsic = WeakRef;
const weakRefDerefIntrinsic = WeakRef.prototype.deref;
const numberIsSafeIntegerIntrinsic = Number.isSafeInteger;
const OPERATION = "inspect-schema" as const;

export const SQLITE_CURSOR_REBIND_RULE11_ID_INTRINSIC =
  "BLR_CURSOR_REBIND_COUNT" as const;
export const SQLITE_CURSOR_REBIND_RULE11_POSITION_INTRINSIC = 11 as const;

/** W: exact outer-adopted cursor rebind write evidence. */
export interface SQLiteCursorRebindWriteReceipt {
  readonly __sqliteCursorRebindWriteReceipt: never;
}

/** R11: successful zero-I/O Rule 11 gate, reserved for a future exact Rule 12 owner. */
export interface SQLiteCursorRebindRule11Owner {
  readonly __sqliteCursorRebindRule11Owner: never;
}

export interface SQLiteCursorRebindRule11FiveCounts {
  readonly b2CursorCount: number;
  readonly nativeAffectedCount: number;
  readonly changesAffectedCount: number;
  readonly totalChangesDelta: number;
  readonly cursorLedgerAffectedDelta: number;
}

export interface SQLiteCursorRebindRule11TupleEvaluation {
  readonly accepted: boolean;
  readonly counts: Readonly<SQLiteCursorRebindRule11FiveCounts>;
  readonly violationCount: 0 | 1;
  readonly diagnosticsTruncated: false;
}

export interface SQLiteCursorRebindWriteReceiptSnapshot {
  readonly lifecycle: "active" | "rule11-complete" | "poisoned";
  readonly session: SQLiteCursorPublicationSession;
  readonly preparedOwner: SQLiteCursorPublicationRebindPreparedOwner;
  readonly context: SQLiteCursorPublicationRebindContext;
  readonly consumedTombstone: SQLiteCursorPublicationSessionConsumedTombstone;
  readonly watermarkAdoption: SQLiteCursorPostRebindWatermarkAdoption;
  readonly outerAuthority: SQLiteCursorOuterPublicationAuthority;
  readonly execution: SQLiteConnectionCursorRebindExecution;
  readonly connection: SQLiteConnection;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transactionEpochBefore: bigint;
  readonly transactionEpochAfter: bigint;
  readonly totalChangesBefore: number;
  readonly totalChangesAfter: number;
  readonly counts: Readonly<SQLiteCursorRebindRule11FiveCounts>;
  readonly cursorLedgerLogicalWriteDelta: 1;
  readonly cursorLedgerFixedStatementDelta: 1;
  readonly prepareCount: 1;
  readonly executeCount: 1;
  readonly releaseCount: 1;
  readonly changesPrepareCount: 1;
  readonly changesFetchCount: 1;
  readonly changesReleaseCount: 1;
  readonly sql: SQLiteConnectionCursorRebindExecutionSnapshot["sql"];
  readonly sqlSha256: SQLiteConnectionCursorRebindExecutionSnapshot["sqlSha256"];
  readonly parameterOrder: SQLiteConnectionCursorRebindExecutionSnapshot["parameterOrder"];
  readonly parameterValues: NonNullable<
    SQLiteConnectionCursorRebindExecutionSnapshot["parameterValues"]
  >;
  readonly parameterSha256: string;
  readonly changesSql: SQLiteConnectionCursorRebindExecutionSnapshot["changesSql"];
  readonly changesSqlSha256:
    SQLiteConnectionCursorRebindExecutionSnapshot["changesSqlSha256"];
  readonly preparedExecutionSnapshot: SQLiteConnectionCursorRebindExecutionSnapshot;
  readonly completedExecutionSnapshot: SQLiteConnectionCursorRebindExecutionSnapshot;
  readonly cursorLedgerBefore: Readonly<{
    readonly logicalWriteSequence: 0;
    readonly fixedStatementCount: 0;
    readonly affectedRowsWatermark: 0;
  }>;
  readonly cursorLedgerAfter: Readonly<{
    readonly logicalWriteSequence: 1;
    readonly fixedStatementCount: 1;
    readonly affectedRowsWatermark: number;
  }>;
  readonly outerLedgerBefore: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly outerLedgerAfter: SQLiteCursorOuterPublicationLedgerSnapshot;
  readonly violationCount: 0 | 1;
}

export interface SQLiteCursorRebindRule11OwnerSnapshot {
  readonly lifecycle: "active";
  readonly ruleId: typeof SQLITE_CURSOR_REBIND_RULE11_ID_INTRINSIC;
  readonly position: typeof SQLITE_CURSOR_REBIND_RULE11_POSITION_INTRINSIC;
  readonly writeReceipt: SQLiteCursorRebindWriteReceipt;
  readonly session: SQLiteCursorPublicationSession;
  readonly preparedOwner: SQLiteCursorPublicationRebindPreparedOwner;
  readonly context: SQLiteCursorPublicationRebindContext;
  readonly consumedTombstone: SQLiteCursorPublicationSessionConsumedTombstone;
  readonly watermarkAdoption: SQLiteCursorPostRebindWatermarkAdoption;
  readonly counts: Readonly<SQLiteCursorRebindRule11FiveCounts>;
  readonly cursorLedgerLogicalWriteDelta: 1;
  readonly cursorLedgerFixedStatementDelta: 1;
  readonly violationCount: 0;
  readonly diagnosticsTruncated: false;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transactionEpoch: bigint;
  readonly totalChanges: number;
}

interface WriteState {
  readonly token: SQLiteCursorRebindWriteReceipt;
  readonly session: SQLiteCursorPublicationSession;
  readonly preparedOwner: SQLiteCursorPublicationRebindPreparedOwner;
  readonly context: SQLiteCursorPublicationRebindContext;
  readonly tombstone: SQLiteCursorPublicationSessionConsumedTombstone;
  readonly adoption: SQLiteCursorPostRebindWatermarkAdoption;
  readonly contextSnapshot: SQLiteCursorPublicationRebindContextSnapshot;
  readonly adoptionSnapshot: SQLiteCursorPostRebindWatermarkAdoptionSnapshot;
  readonly parameterSha256: string;
  readonly counts: Readonly<SQLiteCursorRebindRule11FiveCounts>;
  lifecycle: SQLiteCursorRebindWriteReceiptSnapshot["lifecycle"];
  violationCount: 0 | 1;
}

interface Rule11State {
  readonly token: SQLiteCursorRebindRule11Owner;
  readonly write: WriteState;
  readonly lifecycle: "active";
}

type ProtocolRegistrationStage = "write" | "rule11";

const WRITES = new WeakMap<object, WriteState>();
const WRITE_BY_EXECUTION = new WeakMap<object, SQLiteCursorRebindWriteReceipt>();
const RULE11 = new WeakMap<object, Rule11State>();
let registrationFault: Readonly<{
  readonly stage: ProtocolRegistrationStage;
  readonly error: unknown;
}> | undefined;
let cancelBeforeExecuteForTest = false;

interface PendingPreconsumeReleaseFault {
  readonly authority: WeakRef<object>;
  readonly connection: WeakRef<object>;
  readonly error: WeakRef<object>;
}

const PRECONSUME_RELEASE_FAULTS = new WeakMap<
  object,
  PendingPreconsumeReleaseFault
>();
interface PendingPostconsumeChangesFault extends PendingPreconsumeReleaseFault {
  readonly stage: SQLiteCursorRebindChangesFaultStage;
}
const POSTCONSUME_CHANGES_FAULTS = new WeakMap<
  object,
  PendingPostconsumeChangesFault
>();
interface PendingEvidenceMismatch {
  readonly authority: WeakRef<object>;
  readonly connection: WeakRef<object>;
  readonly dimensions: readonly SQLiteCursorRebindEvidenceMismatchDimension[];
}
const EVIDENCE_MISMATCHES_BY_SESSION = new WeakMap<object, PendingEvidenceMismatch>();
export interface SQLiteCursorRebindEvidenceMismatchOutcomeForTest {
  readonly adoptionLifecycle: "absent" | "active" | "poisoned";
  readonly countEvaluation: Readonly<{
    readonly accepted: boolean;
    readonly violationCount: 0 | 1;
  }>;
  readonly dimensions: readonly SQLiteCursorRebindEvidenceMismatchDimension[];
  readonly evaluatedDimensions: readonly SQLiteCursorRebindEvidenceMismatchDimension[];
  readonly firstPoisonReason:
    | "SQLite rebind evidence mismatch outer ledger"
    | "SQLite Rule 11 five counts disagree"
    | null;
  readonly outerMismatch: boolean;
  readonly projectedCounts: Readonly<SQLiteCursorRebindRule11FiveCounts>;
  readonly realEvidenceObserved: boolean;
  readonly rule11Lifecycle: "absent";
  readonly tombstoneLifecycle: "absent" | "active" | "poisoned";
  readonly writeLifecycle: "absent" | "active" | "poisoned";
}
interface MutableEvidenceMismatchOutcome {
  adoption: WeakRef<object> | undefined;
  adoptionLifecycle: SQLiteCursorRebindEvidenceMismatchOutcomeForTest["adoptionLifecycle"];
  countEvaluation: SQLiteCursorRebindEvidenceMismatchOutcomeForTest["countEvaluation"] | undefined;
  readonly dimensions: readonly SQLiteCursorRebindEvidenceMismatchDimension[];
  evaluatedDimensions: readonly SQLiteCursorRebindEvidenceMismatchDimension[] | undefined;
  firstPoisonReason: SQLiteCursorRebindEvidenceMismatchOutcomeForTest["firstPoisonReason"];
  observedCounts: Readonly<SQLiteCursorRebindRule11FiveCounts> | undefined;
  outerMismatch: boolean | undefined;
  projectedCounts: Readonly<SQLiteCursorRebindRule11FiveCounts> | undefined;
  realEvidenceObserved: boolean;
  readonly rule11Lifecycle: "absent";
  tombstoneLifecycle: SQLiteCursorRebindEvidenceMismatchOutcomeForTest["tombstoneLifecycle"];
  tombstone: WeakRef<object> | undefined;
  write: WeakRef<object> | undefined;
  writeLifecycle: SQLiteCursorRebindEvidenceMismatchOutcomeForTest["writeLifecycle"];
}
const EVIDENCE_MISMATCH_OUTCOMES = new WeakMap<object, MutableEvidenceMismatchOutcome>();
export type SQLiteCursorRebindCompletedFailureBoundary = "outer-ledger" | "five-count";
interface CompletedFailurePrimaryState {
  readonly adoption: WeakRef<object>;
  readonly boundary: SQLiteCursorRebindCompletedFailureBoundary;
  readonly connection: WeakRef<object>;
  readonly context: WeakRef<object>;
  readonly error: WeakRef<object>;
  readonly session: WeakRef<object>;
  readonly tombstone: WeakRef<object>;
}
const COMPLETED_FAILURE_PRIMARIES = new WeakMap<object, CompletedFailurePrimaryState>();
type PreconsumeReleaseRegistrationFailure =
  | Readonly<{ readonly kind: "direct"; readonly error: unknown }>
  | Readonly<{ readonly kind: "weak"; readonly error: WeakRef<object> }>;
let preconsumeReleaseFaultRegistrationFailureForTest:
  PreconsumeReleaseRegistrationFailure | undefined;
let postconsumeChangesFaultRegistrationFailureForTest:
  PreconsumeReleaseRegistrationFailure | undefined;
let completedFailurePrimaryRegistrationFailureForTest:
  PreconsumeReleaseRegistrationFailure | undefined;

function preconsumeReleaseRegistrationFailure(
  error: unknown,
): PreconsumeReleaseRegistrationFailure {
  return error !== null && (typeof error === "object" || typeof error === "function")
    ? objectFreezeIntrinsic({
      kind: "weak" as const,
      error: new weakRefIntrinsic(error),
    })
    : objectFreezeIntrinsic({ kind: "direct" as const, error });
}

function throwPreconsumeReleaseRegistrationFailure(
  failure: PreconsumeReleaseRegistrationFailure,
  faultKind: "preconsume release" | "postconsume changes" | "completed evidence",
): never {
  if (failure.kind === "direct") throw failure.error;
  const error = reflectApplyIntrinsic(
    weakRefDerefIntrinsic,
    failure.error,
    [],
  ) as object | undefined;
  if (error === undefined) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      `SQLite rebind ${faultKind} fault registration failure expired`,
    );
  }
  throw error;
}

function fail(
  code: "GE_CYCLE_STORE_INVALID_ARGUMENT" | "GE_CYCLE_STORE_CORRUPTION"
    | "GE_CYCLE_STORE_UNAVAILABLE",
  message: string,
): never {
  throw new CycleStoreProviderError(code, OPERATION, message);
}

function opaque<T>(): T {
  return objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as T;
}

function safeCount(value: unknown, label: string): number {
  if (!numberIsSafeIntegerIntrinsic(value) || (value as number) < 0) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", `SQLite Rule 11 ${label} is invalid`);
  }
  return value as number;
}

function dataCount(
  input: SQLiteCursorRebindRule11FiveCounts,
  key: keyof SQLiteCursorRebindRule11FiveCounts,
): number {
  const descriptor = reflectApplyIntrinsic(
    objectGetOwnPropertyDescriptorIntrinsic,
    Object,
    [input, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined || !("value" in descriptor)) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite Rule 11 count tuple is invalid");
  }
  return safeCount(descriptor.value, key);
}

function exactCounts(input: SQLiteCursorRebindRule11FiveCounts): Readonly<
  SQLiteCursorRebindRule11FiveCounts
> {
  if (input === null || typeof input !== "object" || isProxyIntrinsic(input)) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite Rule 11 count tuple is invalid");
  }
  const keys = reflectApplyIntrinsic(reflectOwnKeysIntrinsic, Reflect, [input]) as
    readonly PropertyKey[];
  if (keys.length !== 5
      || !reflectApplyIntrinsic(arrayIncludesIntrinsic, keys, ["b2CursorCount"])
      || !reflectApplyIntrinsic(arrayIncludesIntrinsic, keys, ["nativeAffectedCount"])
      || !reflectApplyIntrinsic(arrayIncludesIntrinsic, keys, ["changesAffectedCount"])
      || !reflectApplyIntrinsic(arrayIncludesIntrinsic, keys, ["totalChangesDelta"])
      || !reflectApplyIntrinsic(arrayIncludesIntrinsic, keys, ["cursorLedgerAffectedDelta"])) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite Rule 11 count tuple is invalid");
  }
  return objectFreezeIntrinsic({
    b2CursorCount: dataCount(input, "b2CursorCount"),
    nativeAffectedCount: dataCount(input, "nativeAffectedCount"),
    changesAffectedCount: dataCount(input, "changesAffectedCount"),
    totalChangesDelta: dataCount(input, "totalChangesDelta"),
    cursorLedgerAffectedDelta: dataCount(input, "cursorLedgerAffectedDelta"),
  });
}

/** Pure, zero-I/O Rule 11 tuple checker. It never mints authority. */
export function evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(
  input: SQLiteCursorRebindRule11FiveCounts,
): SQLiteCursorRebindRule11TupleEvaluation {
  const counts = exactCounts(input);
  const accepted = counts.b2CursorCount === counts.nativeAffectedCount
    && counts.b2CursorCount === counts.changesAffectedCount
    && counts.b2CursorCount === counts.totalChangesDelta
    && counts.b2CursorCount === counts.cursorLedgerAffectedDelta;
  return objectFreezeIntrinsic({
    accepted,
    counts,
    violationCount: accepted ? 0 : 1,
    diagnosticsTruncated: false,
  });
}

function sameLedger(
  left: SQLiteCursorOuterPublicationLedgerSnapshot,
  right: SQLiteCursorOuterPublicationLedgerSnapshot,
): boolean {
  return left.logicalWriteSequence === right.logicalWriteSequence
    && left.fixedStatementCount === right.fixedStatementCount
    && left.affectedRowsWatermark === right.affectedRowsWatermark;
}

function parameterDigest(
  values: NonNullable<SQLiteConnectionCursorRebindExecutionSnapshot["parameterValues"]>,
): string {
  return digestSQLiteInitialWriteParametersIntrinsic(objectFreezeIntrinsic([
    objectFreezeIntrinsic([
      objectFreezeIntrinsic({ type: "text", value: values[0] }),
      objectFreezeIntrinsic({ type: "text", value: values[1] }),
      objectFreezeIntrinsic({ type: "text", value: values[2] }),
      objectFreezeIntrinsic({ type: "text", value: values[3] }),
    ]),
  ]));
}

function throwRegistrationFault(stage: ProtocolRegistrationStage): void {
  const fault = registrationFault;
  if (fault !== undefined && fault.stage === stage) {
    registrationFault = undefined;
    throw fault.error;
  }
}

/** Package-private one-shot W/R11 registration fault seam. */
export function injectSQLiteCursorRebindProtocolRegistrationFaultForTestIntrinsic(
  stage: ProtocolRegistrationStage,
  error: unknown,
): void {
  if ((stage !== "write" && stage !== "rule11") || registrationFault !== undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite rebind registration fault is invalid");
  }
  registrationFault = objectFreezeIntrinsic({ stage, error });
}

/** Package-private boundary seam for the otherwise synchronous second cancellation check. */
export function injectSQLiteCursorRebindCancelBeforeExecuteForTestIntrinsic(): void {
  if (cancelBeforeExecuteForTest) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite rebind cancellation fault is armed");
  }
  cancelBeforeExecuteForTest = true;
}

/** Package-private exact-S arm for the exact-E preconsume release boundary. */
export function injectSQLiteCursorRebindPreconsumeReleaseFaultForTestIntrinsic(
  session: SQLiteCursorPublicationSession,
  error: unknown,
): void {
  const snapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
  if ((typeof error !== "object" && typeof error !== "function") || error === null
      || isProxyIntrinsic(error)
      || reflectApplyIntrinsic(weakMapHasIntrinsic, PRECONSUME_RELEASE_FAULTS, [
        session as object,
      ])
      || reflectApplyIntrinsic(weakMapHasIntrinsic, POSTCONSUME_CHANGES_FAULTS, [
        session as object,
      ])
      || reflectApplyIntrinsic(weakMapHasIntrinsic, EVIDENCE_MISMATCHES_BY_SESSION, [
        session as object,
      ])) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite rebind preconsume release fault is invalid",
    );
  }
  const pending = objectFreezeIntrinsic({
    authority: new weakRefIntrinsic(snapshot.outerAuthority as object),
    connection: new weakRefIntrinsic(snapshot.connection as object),
    error: new weakRefIntrinsic(error),
  });
  try {
    reflectApplyIntrinsic(weakMapSetIntrinsic, PRECONSUME_RELEASE_FAULTS, [
      session as object,
      pending,
    ]);
    const registrationFailure = preconsumeReleaseFaultRegistrationFailureForTest;
    preconsumeReleaseFaultRegistrationFailureForTest = undefined;
    if (registrationFailure !== undefined) {
      throwPreconsumeReleaseRegistrationFailure(registrationFailure, "preconsume release");
    }
  } catch (registrationError) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, PRECONSUME_RELEASE_FAULTS, [
      session as object,
    ]);
    throw registrationError;
  }
}

/** Package-private failure after exact-S pending registration, before arm returns. */
export function injectSQLiteCursorRebindPreconsumeReleaseFaultRegistrationFailureForTestIntrinsic(
  error: unknown,
): void {
  if (preconsumeReleaseFaultRegistrationFailureForTest !== undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite rebind preconsume release fault registration failure is armed",
    );
  }
  preconsumeReleaseFaultRegistrationFailureForTest =
    preconsumeReleaseRegistrationFailure(error);
}

/** Package-private exact-S arm handed to the exact E after preparation. */
export function injectSQLiteCursorRebindPostconsumeChangesFaultForTestIntrinsic(
  session: SQLiteCursorPublicationSession,
  stage: SQLiteCursorRebindChangesFaultStage,
  error: unknown,
): void {
  const snapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
  if ((stage !== "prepare-after-native-return"
      && stage !== "fetch-after-native-return"
      && stage !== "shape-after-validation"
      && stage !== "release-after-logical-retirement")
      || (typeof error !== "object" && typeof error !== "function") || error === null
      || isProxyIntrinsic(error)
      || reflectApplyIntrinsic(weakMapHasIntrinsic, POSTCONSUME_CHANGES_FAULTS, [
        session as object,
      ])
      || reflectApplyIntrinsic(weakMapHasIntrinsic, PRECONSUME_RELEASE_FAULTS, [
        session as object,
      ])
      || reflectApplyIntrinsic(weakMapHasIntrinsic, EVIDENCE_MISMATCHES_BY_SESSION, [
        session as object,
      ])) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite rebind postconsume changes fault is invalid",
    );
  }
  const pending = objectFreezeIntrinsic({
    authority: new weakRefIntrinsic(snapshot.outerAuthority as object),
    connection: new weakRefIntrinsic(snapshot.connection as object),
    error: new weakRefIntrinsic(error),
    stage,
  });
  try {
    reflectApplyIntrinsic(weakMapSetIntrinsic, POSTCONSUME_CHANGES_FAULTS, [
      session as object,
      pending,
    ]);
    const registrationFailure = postconsumeChangesFaultRegistrationFailureForTest;
    postconsumeChangesFaultRegistrationFailureForTest = undefined;
    if (registrationFailure !== undefined) {
      throwPreconsumeReleaseRegistrationFailure(registrationFailure, "postconsume changes");
    }
  } catch (registrationError) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, POSTCONSUME_CHANGES_FAULTS, [
      session as object,
    ]);
    throw registrationError;
  }
}

/** Package-private failure after exact-S changes-fault registration. */
export function injectSQLiteCursorRebindPostconsumeChangesFaultRegistrationFailureForTestIntrinsic(
  error: unknown,
): void {
  if (postconsumeChangesFaultRegistrationFailureForTest !== undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite rebind postconsume changes fault registration failure is armed",
    );
  }
  postconsumeChangesFaultRegistrationFailureForTest =
    preconsumeReleaseRegistrationFailure(error);
}

function exactEvidenceMismatchDimensions(
  input: readonly SQLiteCursorRebindEvidenceMismatchDimension[],
): readonly SQLiteCursorRebindEvidenceMismatchDimension[] {
  if (input === null || typeof input !== "object" || isProxyIntrinsic(input)
      || !reflectApplyIntrinsic(arrayIsArrayIntrinsic, Array, [input])
      || objectGetPrototypeOfIntrinsic(input) !== arrayPrototypeIntrinsic
      || input.length < 1 || input.length > 5) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite rebind evidence mismatch dimensions are invalid",
    );
  }
  const normalized: SQLiteCursorRebindEvidenceMismatchDimension[] = [];
  let priorRank = -1;
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = reflectApplyIntrinsic(
      objectGetOwnPropertyDescriptorIntrinsic,
      Object,
      [input, String(index)],
    ) as PropertyDescriptor | undefined;
    const dimension = descriptor !== undefined && "value" in descriptor
      ? descriptor.value as unknown
      : undefined;
    const rank = dimension === "native-affected" ? 0
      : dimension === "changes-affected" ? 1
        : dimension === "total-delta" ? 2
          : dimension === "outer-ledger" ? 3
            : dimension === "cursor-ledger" ? 4
              : -1;
    if (rank <= priorRank) {
      return fail(
        "GE_CYCLE_STORE_INVALID_ARGUMENT",
        "SQLite rebind evidence mismatch dimensions are invalid",
      );
    }
    normalized[index] = dimension as SQLiteCursorRebindEvidenceMismatchDimension;
    priorRank = rank;
  }
  return objectFreezeIntrinsic(normalized);
}

/** Package-private exact-S arm for post-observation evidence projection. */
export function injectSQLiteCursorRebindEvidenceMismatchForTestIntrinsic(
  session: SQLiteCursorPublicationSession,
  dimensions: readonly SQLiteCursorRebindEvidenceMismatchDimension[],
): void {
  const snapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
  const selected = exactEvidenceMismatchDimensions(dimensions);
  if (reflectApplyIntrinsic(weakMapHasIntrinsic, EVIDENCE_MISMATCHES_BY_SESSION, [
    session as object,
  ])
      || reflectApplyIntrinsic(weakMapHasIntrinsic, PRECONSUME_RELEASE_FAULTS, [
        session as object,
      ])
      || reflectApplyIntrinsic(weakMapHasIntrinsic, POSTCONSUME_CHANGES_FAULTS, [
        session as object,
      ])) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite rebind evidence mismatch is already armed",
    );
  }
  reflectApplyIntrinsic(weakMapSetIntrinsic, EVIDENCE_MISMATCHES_BY_SESSION, [
    session as object,
    objectFreezeIntrinsic({
      authority: new weakRefIntrinsic(snapshot.outerAuthority as object),
      connection: new weakRefIntrinsic(snapshot.connection as object),
      dimensions: selected,
    }),
  ]);
}

function handoffEvidenceMismatch(
  session: SQLiteCursorPublicationSession,
  context: SQLiteCursorPublicationRebindContext,
  preparedOwner: SQLiteCursorPublicationRebindPreparedOwner,
  execution: SQLiteConnectionCursorRebindExecution,
): void {
  const pending = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    EVIDENCE_MISMATCHES_BY_SESSION,
    [session as object],
  ) as PendingEvidenceMismatch | undefined;
  if (pending === undefined) return;
  if (!reflectApplyIntrinsic(
    weakMapDeleteIntrinsic,
    EVIDENCE_MISMATCHES_BY_SESSION,
    [session as object],
  )) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite rebind evidence mismatch identity drifted");
  }
  const authority = reflectApplyIntrinsic(
    weakRefDerefIntrinsic, pending.authority, [],
  ) as object | undefined;
  const connection = reflectApplyIntrinsic(
    weakRefDerefIntrinsic, pending.connection, [],
  ) as SQLiteConnection | undefined;
  const snapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
  if (authority === undefined || connection === undefined
      || snapshot.outerAuthority !== authority || snapshot.connection !== connection
      || snapshot.lifecycle !== "prepared" || snapshot.session !== session
      || snapshot.preparedOwner !== preparedOwner || snapshot.execution !== execution) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite rebind evidence mismatch identity drifted");
  }
  injectSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
    connection,
    execution,
    pending.dimensions,
  );
  reflectApplyIntrinsic(weakMapSetIntrinsic, EVIDENCE_MISMATCH_OUTCOMES, [
    execution as object,
    {
      adoption: undefined,
      adoptionLifecycle: "absent",
      countEvaluation: undefined,
      dimensions: pending.dimensions,
      evaluatedDimensions: undefined,
      firstPoisonReason: null,
      observedCounts: undefined,
      outerMismatch: undefined,
      projectedCounts: undefined,
      realEvidenceObserved: false,
      rule11Lifecycle: "absent",
      tombstone: undefined,
      tombstoneLifecycle: "absent",
      write: undefined,
      writeLifecycle: "absent",
    } satisfies MutableEvidenceMismatchOutcome,
  ]);
}

function evidenceMismatchOutcome(
  execution: SQLiteConnectionCursorRebindExecution,
): MutableEvidenceMismatchOutcome | undefined {
  return reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    EVIDENCE_MISMATCH_OUTCOMES,
    [execution as object],
  ) as MutableEvidenceMismatchOutcome | undefined;
}

function mismatchIncludes(
  dimensions: readonly SQLiteCursorRebindEvidenceMismatchDimension[],
  dimension: SQLiteCursorRebindEvidenceMismatchDimension,
): boolean {
  return reflectApplyIntrinsic(arrayIncludesIntrinsic, dimensions, [dimension]) as boolean;
}

function sameMismatchDimensions(
  left: readonly SQLiteCursorRebindEvidenceMismatchDimension[],
  right: readonly SQLiteCursorRebindEvidenceMismatchDimension[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function evidenceProjectionIsExact(outcome: MutableEvidenceMismatchOutcome): boolean {
  const observed = outcome.observedCounts;
  const projected = outcome.projectedCounts;
  const evaluation = outcome.countEvaluation;
  const evaluated = outcome.evaluatedDimensions;
  if (observed === undefined || projected === undefined || evaluation === undefined
      || evaluated === undefined || outcome.outerMismatch === undefined
      || !sameMismatchDimensions(evaluated, outcome.dimensions)) return false;
  const expectedEvaluation = evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(projected);
  return projected.b2CursorCount === observed.b2CursorCount
    && projected.nativeAffectedCount === observed.nativeAffectedCount
      + (mismatchIncludes(evaluated, "native-affected") ? 1 : 0)
    && projected.changesAffectedCount === observed.changesAffectedCount
      + (mismatchIncludes(evaluated, "changes-affected") ? 1 : 0)
    && projected.totalChangesDelta === observed.totalChangesDelta
      + (mismatchIncludes(evaluated, "total-delta") ? 1 : 0)
    && projected.cursorLedgerAffectedDelta === observed.cursorLedgerAffectedDelta
      + (mismatchIncludes(evaluated, "cursor-ledger") ? 1 : 0)
    && outcome.outerMismatch === mismatchIncludes(evaluated, "outer-ledger")
    && evaluation.accepted === expectedEvaluation.accepted
    && evaluation.violationCount === expectedEvaluation.violationCount;
}

/** Read a pure lifecycle projection without exposing any graph capability. */
export function readSQLiteCursorRebindEvidenceMismatchOutcomeForTestIntrinsic(
  connection: SQLiteConnection,
  execution: SQLiteConnectionCursorRebindExecution,
): SQLiteCursorRebindEvidenceMismatchOutcomeForTest {
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic(connection, execution);
  const outcome = evidenceMismatchOutcome(execution);
  if (outcome === undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite rebind evidence mismatch outcome is unavailable",
    );
  }
  if (outcome.countEvaluation === undefined || outcome.evaluatedDimensions === undefined
      || outcome.outerMismatch === undefined || outcome.projectedCounts === undefined
      || !evidenceProjectionIsExact(outcome)) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite rebind evidence mismatch outcome is incomplete",
    );
  }
  return objectFreezeIntrinsic({
    adoptionLifecycle: outcome.adoptionLifecycle,
    countEvaluation: outcome.countEvaluation,
    dimensions: outcome.dimensions,
    evaluatedDimensions: outcome.evaluatedDimensions,
    firstPoisonReason: outcome.firstPoisonReason,
    outerMismatch: outcome.outerMismatch,
    projectedCounts: outcome.projectedCounts,
    realEvidenceObserved: outcome.realEvidenceObserved,
    rule11Lifecycle: outcome.rule11Lifecycle,
    tombstoneLifecycle: outcome.tombstoneLifecycle,
    writeLifecycle: outcome.writeLifecycle,
  });
}

function completedEvidenceIsExact(
  execution: SQLiteConnectionCursorRebindExecution,
  context: SQLiteCursorPublicationRebindContext,
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone,
  adoption: SQLiteCursorPostRebindWatermarkAdoption,
  boundary: SQLiteCursorRebindCompletedFailureBoundary,
): boolean {
  const outcome = evidenceMismatchOutcome(execution);
  const selectedTombstone = outcome?.tombstone === undefined ? undefined : reflectApplyIntrinsic(
    weakRefDerefIntrinsic, outcome.tombstone, [],
  );
  const selectedAdoption = outcome?.adoption === undefined ? undefined : reflectApplyIntrinsic(
    weakRefDerefIntrinsic, outcome.adoption, [],
  );
  const selectedWrite = outcome?.write === undefined ? undefined : reflectApplyIntrinsic(
    weakRefDerefIntrinsic, outcome.write, [],
  );
  return outcome !== undefined
    && selectedTombstone === tombstone
    && selectedAdoption === adoption
    && outcome.realEvidenceObserved
    && outcome.tombstoneLifecycle === "poisoned"
    && outcome.adoptionLifecycle === "poisoned"
    && outcome.rule11Lifecycle === "absent"
    && evidenceProjectionIsExact(outcome)
    && (boundary === "outer-ledger"
      ? outcome.firstPoisonReason === "SQLite rebind evidence mismatch outer ledger"
        && outcome.outerMismatch === true && outcome.countEvaluation?.accepted === false
        && outcome.countEvaluation?.violationCount === 1
        && outcome.writeLifecycle === "absent" && selectedWrite === undefined
      : outcome.firstPoisonReason === "SQLite Rule 11 five counts disagree"
        && outcome.outerMismatch === false && outcome.countEvaluation?.accepted === false
        && outcome.countEvaluation?.violationCount === 1
        && outcome.writeLifecycle === "poisoned" && selectedWrite !== undefined)
    && readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context).execution === execution;
}

function registerCompletedFailurePrimary(
  connection: SQLiteConnection,
  session: SQLiteCursorPublicationSession,
  context: SQLiteCursorPublicationRebindContext,
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone,
  adoption: SQLiteCursorPostRebindWatermarkAdoption,
  execution: SQLiteConnectionCursorRebindExecution,
  primary: unknown,
): void {
  const outcome = evidenceMismatchOutcome(execution);
  if (outcome === undefined || outcome.firstPoisonReason === null) return;
  if ((typeof primary !== "object" && typeof primary !== "function") || primary === null
      || isProxyIntrinsic(primary)
      || reflectApplyIntrinsic(weakMapHasIntrinsic, COMPLETED_FAILURE_PRIMARIES, [
        execution as object,
      ])) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite completed failure primary is invalid");
  }
  const boundary: SQLiteCursorRebindCompletedFailureBoundary =
    outcome.firstPoisonReason === "SQLite rebind evidence mismatch outer ledger"
      ? "outer-ledger"
      : "five-count";
  if (!completedEvidenceIsExact(execution, context, tombstone, adoption, boundary)) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite completed failure graph is invalid");
  }
  try {
    reflectApplyIntrinsic(weakMapSetIntrinsic, COMPLETED_FAILURE_PRIMARIES, [
      execution as object,
      objectFreezeIntrinsic({
        adoption: new weakRefIntrinsic(adoption as object),
        boundary,
        connection: new weakRefIntrinsic(connection as object),
        context: new weakRefIntrinsic(context as object),
        error: new weakRefIntrinsic(primary),
        session: new weakRefIntrinsic(session as object),
        tombstone: new weakRefIntrinsic(tombstone as object),
      }),
    ]);
    const registrationFailure = completedFailurePrimaryRegistrationFailureForTest;
    completedFailurePrimaryRegistrationFailureForTest = undefined;
    if (registrationFailure !== undefined) {
      throwPreconsumeReleaseRegistrationFailure(registrationFailure, "completed evidence");
    }
  } catch (error) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, COMPLETED_FAILURE_PRIMARIES, [
      execution as object,
    ]);
    throw error;
  }
}

/** Package-private registration failure after exact completed-E ticket insertion. */
export function injectSQLiteCursorRebindCompletedFailureRegistrationFailureForTestIntrinsic(
  error: unknown,
): void {
  if (completedFailurePrimaryRegistrationFailureForTest !== undefined) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite completed evidence registration failure is armed",
    );
  }
  completedFailurePrimaryRegistrationFailureForTest =
    preconsumeReleaseRegistrationFailure(error);
}

/** Destructively authenticate the exact internally caught completed-E primary. */
export function takeSQLiteCursorRebindCompletedFailureForFinalizerIntrinsic(
  connection: SQLiteConnection,
  session: SQLiteCursorPublicationSession,
  context: SQLiteCursorPublicationRebindContext,
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone,
  adoption: SQLiteCursorPostRebindWatermarkAdoption,
  execution: SQLiteConnectionCursorRebindExecution,
  primary: object,
): SQLiteCursorRebindCompletedFailureBoundary {
  const pending = reflectApplyIntrinsic(
    weakMapGetIntrinsic, COMPLETED_FAILURE_PRIMARIES, [execution as object],
  ) as CompletedFailurePrimaryState | undefined;
  if (pending === undefined || !reflectApplyIntrinsic(
    weakMapDeleteIntrinsic, COMPLETED_FAILURE_PRIMARIES, [execution as object],
  )) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite completed failure ticket is invalid");
  }
  const selected = {
    adoption: reflectApplyIntrinsic(weakRefDerefIntrinsic, pending.adoption, []),
    connection: reflectApplyIntrinsic(weakRefDerefIntrinsic, pending.connection, []),
    context: reflectApplyIntrinsic(weakRefDerefIntrinsic, pending.context, []),
    error: reflectApplyIntrinsic(weakRefDerefIntrinsic, pending.error, []),
    session: reflectApplyIntrinsic(weakRefDerefIntrinsic, pending.session, []),
    tombstone: reflectApplyIntrinsic(weakRefDerefIntrinsic, pending.tombstone, []),
  };
  if (selected.connection !== connection || selected.session !== session
      || selected.context !== context || selected.tombstone !== tombstone
      || selected.adoption !== adoption || selected.error !== primary
      || !completedEvidenceIsExact(execution, context, tombstone, adoption, pending.boundary)) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite completed failure ticket is invalid");
  }
  return pending.boundary;
}

/** Repeatable pure graph assertion after the ticket was consumed at capture. */
export function assertSQLiteCursorRebindCompletedFailureForFinalizerIntrinsic(
  execution: SQLiteConnectionCursorRebindExecution,
  context: SQLiteCursorPublicationRebindContext,
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone,
  adoption: SQLiteCursorPostRebindWatermarkAdoption,
  boundary: SQLiteCursorRebindCompletedFailureBoundary,
): void {
  if (!completedEvidenceIsExact(execution, context, tombstone, adoption, boundary)) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite completed failure graph is invalid");
  }
}

function handoffPostconsumeChangesFault(
  session: SQLiteCursorPublicationSession,
  context: SQLiteCursorPublicationRebindContext,
  preparedOwner: SQLiteCursorPublicationRebindPreparedOwner,
  execution: SQLiteConnectionCursorRebindExecution,
): void {
  const pending = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    POSTCONSUME_CHANGES_FAULTS,
    [session as object],
  ) as PendingPostconsumeChangesFault | undefined;
  if (pending === undefined) return;
  if (!reflectApplyIntrinsic(
    weakMapDeleteIntrinsic,
    POSTCONSUME_CHANGES_FAULTS,
    [session as object],
  )) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite rebind postconsume changes fault identity drifted",
    );
  }
  const authority = reflectApplyIntrinsic(
    weakRefDerefIntrinsic,
    pending.authority,
    [],
  ) as object | undefined;
  const connection = reflectApplyIntrinsic(
    weakRefDerefIntrinsic,
    pending.connection,
    [],
  ) as SQLiteConnection | undefined;
  const error = reflectApplyIntrinsic(
    weakRefDerefIntrinsic,
    pending.error,
    [],
  ) as object | undefined;
  const snapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
  if (authority === undefined || connection === undefined || error === undefined
      || snapshot.outerAuthority !== authority || snapshot.connection !== connection
      || snapshot.lifecycle !== "prepared" || snapshot.session !== session
      || snapshot.preparedOwner !== preparedOwner || snapshot.execution !== execution) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite rebind postconsume changes fault identity drifted",
    );
  }
  injectSQLiteConnectionCursorRebindChangesFaultForTestIntrinsic(
    connection,
    execution,
    pending.stage,
    error,
  );
}

function handoffPreconsumeReleaseFault(
  session: SQLiteCursorPublicationSession,
  context: SQLiteCursorPublicationRebindContext,
  preparedOwner: SQLiteCursorPublicationRebindPreparedOwner,
  execution: SQLiteConnectionCursorRebindExecution,
): boolean {
  const pending = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    PRECONSUME_RELEASE_FAULTS,
    [session as object],
  ) as PendingPreconsumeReleaseFault | undefined;
  if (pending === undefined) return false;
  if (!reflectApplyIntrinsic(
    weakMapDeleteIntrinsic,
    PRECONSUME_RELEASE_FAULTS,
    [session as object],
  )) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite rebind preconsume release fault identity drifted",
    );
  }
  const authority = reflectApplyIntrinsic(
    weakRefDerefIntrinsic,
    pending.authority,
    [],
  ) as object | undefined;
  const connection = reflectApplyIntrinsic(
    weakRefDerefIntrinsic,
    pending.connection,
    [],
  ) as SQLiteConnection | undefined;
  const error = reflectApplyIntrinsic(
    weakRefDerefIntrinsic,
    pending.error,
    [],
  ) as object | undefined;
  const snapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
  if (authority === undefined || connection === undefined || error === undefined
      || snapshot.outerAuthority !== authority || snapshot.connection !== connection
      || snapshot.lifecycle !== "prepared" || snapshot.session !== session
      || snapshot.preparedOwner !== preparedOwner || snapshot.execution !== execution) {
    return fail(
      "GE_CYCLE_STORE_CORRUPTION",
      "SQLite rebind preconsume release fault identity drifted",
    );
  }
  injectSQLiteConnectionCursorRebindReleaseFaultForTestIntrinsic(
    connection,
    execution,
    error,
  );
  return true;
}

function writeState(receipt: SQLiteCursorRebindWriteReceipt): WriteState {
  const state = receipt !== null && typeof receipt === "object" && !isProxyIntrinsic(receipt)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, WRITES, [receipt as object]) as
      WriteState | undefined
    : undefined;
  if (state === undefined || state.token !== receipt) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite Rule 11 write receipt is invalid");
  }
  return state;
}

function assertWriteRetainedGraph(state: WriteState): void {
  assertSQLiteCursorPostRebindWatermarkAdoptionIntrinsic(state.adoption);
  assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic(
    state.preparedOwner,
    state.context,
  );
  if (state.contextSnapshot.session !== state.session
      || state.adoptionSnapshot.context !== state.context
      || state.adoptionSnapshot.tombstone !== state.tombstone
      || state.adoptionSnapshot.preparedOwner !== state.preparedOwner) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite Rule 11 retained graph drifted");
  }
}

function rule11State(owner: SQLiteCursorRebindRule11Owner): Rule11State {
  const state = owner !== null && typeof owner === "object" && !isProxyIntrinsic(owner)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, RULE11, [owner as object]) as
      Rule11State | undefined
    : undefined;
  if (state === undefined || state.token !== owner) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite Rule 11 owner is invalid");
  }
  return state;
}

function poisonAfterConsume(
  context: SQLiteCursorPublicationRebindContext,
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone,
  adoption: SQLiteCursorPostRebindWatermarkAdoption | undefined,
  message: string,
): void {
  try {
    poisonSQLiteCursorPublicationRebindAfterConsumeIntrinsic(
      context,
      tombstone,
      adoption,
      message,
    );
  } catch {
    // The primary failure, including thrown undefined, always wins.
  }
}

function mintWriteReceipt(
  session: SQLiteCursorPublicationSession,
  context: SQLiteCursorPublicationRebindContext,
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone,
  adoption: SQLiteCursorPostRebindWatermarkAdoption,
): SQLiteCursorRebindWriteReceipt {
  const contextSnapshot = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
  assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic(
    contextSnapshot.preparedOwner,
    context,
  );
  const adopted = readSQLiteCursorPostRebindWatermarkAdoptionSnapshotIntrinsic(adoption);
  const before = contextSnapshot.preparedExecutionSnapshot;
  const after = adopted.executionSnapshot;
  const parameters = after.parameterValues;
  if (contextSnapshot.lifecycle !== "write-adopted"
      || contextSnapshot.session !== session
      || adopted.context !== context
      || adopted.tombstone !== tombstone
      || adopted.session !== session
      || adopted.preparedOwner !== contextSnapshot.preparedOwner
      || adopted.execution !== contextSnapshot.execution
      || adopted.preparedExecutionSnapshot !== before
      || parameters === null
      || after.changesAffectedRows === null
      || before.cursorLedgerLogicalWriteSequence !== 0
      || before.cursorLedgerFixedStatementCount !== 0
      || before.cursorLedgerAffectedRowsWatermark !== 0
      || after.cursorLedgerLogicalWriteSequence !== 1
      || after.cursorLedgerFixedStatementCount !== 1
      || after.transactionLineage !== contextSnapshot.transactionLineage
      || after.transactionEpoch !== contextSnapshot.historicalTransactionEpoch + 1n
      || after.totalChangesBefore !== contextSnapshot.historicalTotalChanges
      || adopted.historicalTransactionEpoch !== contextSnapshot.historicalTransactionEpoch
      || adopted.historicalTotalChanges !== contextSnapshot.historicalTotalChanges
      || adopted.adoptedTransactionEpoch !== after.transactionEpoch
      || adopted.adoptedTotalChanges !== after.totalChangesAfter
      || adopted.totalChangesDelta !== after.totalChangesDelta
      || adopted.affectedRows !== after.affectedRows
      || !sameLedger(adopted.historicalOuterLedger, contextSnapshot.historicalOuterLedger)
      || !sameLedger(adopted.adoptedOuterLedger, contextSnapshot.historicalOuterLedger)) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite rebind write receipt graph drifted");
  }
  const mismatchOutcome = evidenceMismatchOutcome(contextSnapshot.execution);
  const mismatch = mismatchOutcome === undefined
    ? null
    : takeSQLiteConnectionCursorRebindEvidenceMismatchForTestIntrinsic(
      contextSnapshot.connection,
      contextSnapshot.execution,
    );
  const observedCounts = exactCounts(objectFreezeIntrinsic({
    b2CursorCount: contextSnapshot.b2CursorCount,
    nativeAffectedCount: after.affectedRows,
    changesAffectedCount: after.changesAffectedRows,
    totalChangesDelta: after.totalChangesDelta,
    cursorLedgerAffectedDelta:
      after.cursorLedgerAffectedRowsWatermark - before.cursorLedgerAffectedRowsWatermark,
  }));
  const projectedNativeAffected = mismatch !== null
      && mismatchIncludes(mismatch, "native-affected")
    ? after.affectedRows + 1
    : after.affectedRows;
  const projectedChangesAffected = mismatch !== null
      && mismatchIncludes(mismatch, "changes-affected")
    ? after.changesAffectedRows + 1
    : after.changesAffectedRows;
  const projectedTotalDelta = mismatch !== null && mismatchIncludes(mismatch, "total-delta")
    ? after.totalChangesDelta + 1
    : after.totalChangesDelta;
  const projectedCursorLedgerAffected = mismatch !== null
      && mismatchIncludes(mismatch, "cursor-ledger")
    ? after.cursorLedgerAffectedRowsWatermark + 1
    : after.cursorLedgerAffectedRowsWatermark;
  const counts = exactCounts(objectFreezeIntrinsic({
    b2CursorCount: contextSnapshot.b2CursorCount,
    nativeAffectedCount: projectedNativeAffected,
    changesAffectedCount: projectedChangesAffected,
    totalChangesDelta: projectedTotalDelta,
    cursorLedgerAffectedDelta:
      projectedCursorLedgerAffected - before.cursorLedgerAffectedRowsWatermark,
  }));
  const projectedEvaluation = mismatchOutcome === undefined
    ? undefined
    : evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(counts);
  const outerMismatch = mismatch !== null && mismatchIncludes(mismatch, "outer-ledger");
  if (mismatchOutcome !== undefined && mismatch !== null && projectedEvaluation !== undefined) {
    mismatchOutcome.countEvaluation = objectFreezeIntrinsic({
      accepted: projectedEvaluation.accepted,
      violationCount: projectedEvaluation.violationCount,
    });
    mismatchOutcome.evaluatedDimensions = mismatch;
    mismatchOutcome.observedCounts = observedCounts;
    mismatchOutcome.outerMismatch = outerMismatch;
    mismatchOutcome.projectedCounts = counts;
  }
  if (outerMismatch) {
    mismatchOutcome!.firstPoisonReason = "SQLite rebind evidence mismatch outer ledger";
    poisonAfterConsume(
      context,
      tombstone,
      adoption,
      "SQLite rebind evidence mismatch outer ledger",
    );
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite rebind evidence mismatch outer ledger");
  }
  const existing = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    WRITE_BY_EXECUTION,
    [contextSnapshot.execution as object],
  ) as SQLiteCursorRebindWriteReceipt | undefined;
  if (existing !== undefined) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite rebind execution was already receipted");
  }
  const token = opaque<SQLiteCursorRebindWriteReceipt>();
  const state: WriteState = {
    token,
    session,
    preparedOwner: contextSnapshot.preparedOwner,
    context,
    tombstone,
    adoption,
    contextSnapshot,
    adoptionSnapshot: adopted,
    parameterSha256: parameterDigest(parameters),
    counts,
    lifecycle: "active",
    violationCount: 0,
  };
  throwRegistrationFault("write");
  reflectApplyIntrinsic(weakMapSetIntrinsic, WRITES, [token as object, state]);
  reflectApplyIntrinsic(weakMapSetIntrinsic, WRITE_BY_EXECUTION, [
    contextSnapshot.execution as object,
    token,
  ]);
  if (mismatchOutcome !== undefined) {
    mismatchOutcome.write = new weakRefIntrinsic(token as object);
    mismatchOutcome.writeLifecycle = "active";
  }
  return token;
}

function snapshotWrite(state: WriteState): SQLiteCursorRebindWriteReceiptSnapshot {
  const before = state.contextSnapshot.preparedExecutionSnapshot;
  const after = state.adoptionSnapshot.executionSnapshot;
  return objectFreezeIntrinsic({
    lifecycle: state.lifecycle,
    session: state.session,
    preparedOwner: state.preparedOwner,
    context: state.context,
    consumedTombstone: state.tombstone,
    watermarkAdoption: state.adoption,
    outerAuthority: state.contextSnapshot.outerAuthority,
    execution: state.contextSnapshot.execution,
    connection: state.contextSnapshot.connection,
    transactionLineage: state.contextSnapshot.transactionLineage,
    transactionEpochBefore: state.contextSnapshot.historicalTransactionEpoch,
    transactionEpochAfter: state.adoptionSnapshot.adoptedTransactionEpoch,
    totalChangesBefore: state.contextSnapshot.historicalTotalChanges,
    totalChangesAfter: state.adoptionSnapshot.adoptedTotalChanges,
    counts: state.counts,
    cursorLedgerLogicalWriteDelta: 1,
    cursorLedgerFixedStatementDelta: 1,
    prepareCount: 1,
    executeCount: 1,
    releaseCount: 1,
    changesPrepareCount: 1,
    changesFetchCount: 1,
    changesReleaseCount: 1,
    sql: after.sql,
    sqlSha256: after.sqlSha256,
    parameterOrder: after.parameterOrder,
    parameterValues: after.parameterValues!,
    parameterSha256: state.parameterSha256,
    changesSql: after.changesSql,
    changesSqlSha256: after.changesSqlSha256,
    preparedExecutionSnapshot: before,
    completedExecutionSnapshot: after,
    cursorLedgerBefore: objectFreezeIntrinsic({
      logicalWriteSequence: before.cursorLedgerLogicalWriteSequence as 0,
      fixedStatementCount: before.cursorLedgerFixedStatementCount as 0,
      affectedRowsWatermark: before.cursorLedgerAffectedRowsWatermark as 0,
    }),
    cursorLedgerAfter: objectFreezeIntrinsic({
      logicalWriteSequence: after.cursorLedgerLogicalWriteSequence as 1,
      fixedStatementCount: after.cursorLedgerFixedStatementCount as 1,
      affectedRowsWatermark: after.cursorLedgerAffectedRowsWatermark,
    }),
    outerLedgerBefore: state.contextSnapshot.historicalOuterLedger,
    outerLedgerAfter: state.adoptionSnapshot.adoptedOuterLedger,
    violationCount: state.violationCount,
  });
}

export function readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(
  receipt: SQLiteCursorRebindWriteReceipt,
): SQLiteCursorRebindWriteReceiptSnapshot {
  const state = writeState(receipt);
  assertWriteRetainedGraph(state);
  return snapshotWrite(state);
}

/** Execute the closed five-count Rule 11 gate with zero SQL and mint R11 once. */
export function executeSQLiteCursorRebindRule11GateIntrinsic(
  receipt: SQLiteCursorRebindWriteReceipt,
): SQLiteCursorRebindRule11Owner {
  const state = writeState(receipt);
  assertWriteRetainedGraph(state);
  if (state.lifecycle !== "active") {
    poisonAfterConsume(
      state.context,
      state.tombstone,
      state.adoption,
      "SQLite Rule 11 write receipt was replayed",
    );
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite Rule 11 write receipt is terminal");
  }
  const evaluation = evaluateSQLiteCursorRebindRule11FiveCountsIntrinsic(state.counts);
  if (!evaluation.accepted) {
    state.lifecycle = "poisoned";
    state.violationCount = 1;
    const mismatchOutcome = evidenceMismatchOutcome(state.contextSnapshot.execution);
    if (mismatchOutcome !== undefined) {
      mismatchOutcome.firstPoisonReason = "SQLite Rule 11 five counts disagree";
      mismatchOutcome.writeLifecycle = "poisoned";
    }
    poisonAfterConsume(
      state.context,
      state.tombstone,
      state.adoption,
      "SQLite Rule 11 five counts disagree",
    );
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite Rule 11 five counts disagree");
  }
  const token = opaque<SQLiteCursorRebindRule11Owner>();
  const owner: Rule11State = { token, write: state, lifecycle: "active" };
  try {
    throwRegistrationFault("rule11");
    reflectApplyIntrinsic(weakMapSetIntrinsic, RULE11, [token as object, owner]);
  } catch (error) {
    state.lifecycle = "poisoned";
    poisonAfterConsume(
      state.context,
      state.tombstone,
      state.adoption,
      "SQLite Rule 11 registration failed",
    );
    throw error;
  }
  state.lifecycle = "rule11-complete";
  return token;
}

function snapshotRule11(state: Rule11State): SQLiteCursorRebindRule11OwnerSnapshot {
  return objectFreezeIntrinsic({
    lifecycle: "active",
    ruleId: SQLITE_CURSOR_REBIND_RULE11_ID_INTRINSIC,
    position: SQLITE_CURSOR_REBIND_RULE11_POSITION_INTRINSIC,
    writeReceipt: state.write.token,
    session: state.write.session,
    preparedOwner: state.write.preparedOwner,
    context: state.write.context,
    consumedTombstone: state.write.tombstone,
    watermarkAdoption: state.write.adoption,
    counts: state.write.counts,
    cursorLedgerLogicalWriteDelta: 1,
    cursorLedgerFixedStatementDelta: 1,
    violationCount: 0,
    diagnosticsTruncated: false,
    transactionLineage: state.write.contextSnapshot.transactionLineage,
    transactionEpoch: state.write.adoptionSnapshot.adoptedTransactionEpoch,
    totalChanges: state.write.adoptionSnapshot.adoptedTotalChanges,
  });
}

export function readSQLiteCursorRebindRule11OwnerSnapshotIntrinsic(
  owner: SQLiteCursorRebindRule11Owner,
): SQLiteCursorRebindRule11OwnerSnapshot {
  const state = rule11State(owner);
  if (state.write.lifecycle !== "rule11-complete") {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite Rule 11 owner is terminal");
  }
  assertWriteRetainedGraph(state.write);
  return snapshotRule11(state);
}

function cleanupUnboundExecution(
  connection: SQLiteConnection,
  execution: SQLiteConnectionCursorRebindExecution,
): void {
  try {
    releaseSQLiteConnectionCursorRebindExecutionIntrinsic(connection, execution);
  } catch {
    // A previously selected primary always wins cleanup precedence.
  }
}

function cleanupPreparedContext(
  context: SQLiteCursorPublicationRebindContext,
  preparedOwner: SQLiteCursorPublicationRebindPreparedOwner,
): void {
  try {
    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(context, preparedOwner);
  } catch {
    // A previously selected primary always wins cleanup precedence.
  }
}

/**
 * Real serialized leaf: S -> P/context -> T -> E -> A -> W -> zero-I/O R11.
 * It owns no transaction begin/commit/rollback and performs no Rule 12 work.
 */
export function executeSQLiteCursorPublicationRebindRule11Intrinsic(
  session: SQLiteCursorPublicationSession,
  cancellation?: SQLiteCursorPublicationSessionCancellationSignal,
): SQLiteCursorRebindRule11Owner {
  const injectedCancellation = cancelBeforeExecuteForTest;
  cancelBeforeExecuteForTest = false;

  // Authenticate the exact S presentation before cancellation can select a
  // non-consuming exit.  A cancelled request must never mask a forged,
  // cross-run, replayed, or otherwise drifted predecessor capability.
  const sessionSnapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
  const connection = sessionSnapshot.connection;
  if (isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(cancellation)) {
    return fail("GE_CYCLE_STORE_UNAVAILABLE", "SQLite cursor rebind was cancelled before prepare");
  }

  // Authentic S supplies the only connection accepted by begin E.
  let execution: SQLiteConnectionCursorRebindExecution | undefined;
  let context: SQLiteCursorPublicationRebindContext | undefined;
  let preparedOwner: SQLiteCursorPublicationRebindPreparedOwner | undefined;
  try {
    execution = beginSQLiteConnectionCursorRebindExecutionIntrinsic(connection);
    context = prepareSQLiteCursorPublicationRebindContextIntrinsic(session, execution);
    const prepared = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(context);
    preparedOwner = prepared.preparedOwner;
    assertSQLiteCursorPublicationRebindPreparedOwnerIntrinsic(preparedOwner, context);
  } catch (error) {
    if (context !== undefined && preparedOwner !== undefined) {
      cleanupPreparedContext(context, preparedOwner);
    } else if (execution !== undefined) {
      cleanupUnboundExecution(connection, execution);
    }
    throw error;
  }

  let forcePreconsumeRelease: boolean;
  try {
    forcePreconsumeRelease = handoffPreconsumeReleaseFault(
      session,
      context,
      preparedOwner,
      execution,
    );
  } catch (error) {
    cleanupPreparedContext(context, preparedOwner);
    throw error;
  }
  const cancelledBeforeExecute = injectedCancellation
    || isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(cancellation);
  if (forcePreconsumeRelease || cancelledBeforeExecute) {
    // Release failure has precedence over cancellation and poisons in outer.
    releaseSQLiteCursorPublicationRebindContextBeforeConsumeIntrinsic(context, preparedOwner);
    if (forcePreconsumeRelease) {
      return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite rebind release fault did not fire");
    }
    return fail("GE_CYCLE_STORE_UNAVAILABLE", "SQLite cursor rebind was cancelled before execute");
  }

  try {
    handoffPostconsumeChangesFault(session, context, preparedOwner, execution);
    handoffEvidenceMismatch(session, context, preparedOwner, execution);
  } catch (error) {
    cleanupPreparedContext(context, preparedOwner);
    throw error;
  }

  let tombstone: SQLiteCursorPublicationSessionConsumedTombstone;
  try {
    tombstone = consumeSQLiteCursorPublicationSessionForRebindIntrinsic(context);
    const outcome = evidenceMismatchOutcome(execution);
    if (outcome !== undefined) {
      outcome.tombstone = new weakRefIntrinsic(tombstone as object);
      outcome.tombstoneLifecycle = "active";
    }
  } catch (error) {
    // A T registration failure leaves S/context prepared and therefore retryable.
    cleanupPreparedContext(context, preparedOwner);
    throw error;
  }

  let adoption: SQLiteCursorPostRebindWatermarkAdoption | undefined;
  try {
    executeSQLiteConnectionCursorRebindIntrinsic(
      connection,
      execution,
      {
        targetDescriptorHash: sessionSnapshot.targetDescriptorHash,
        targetSchemaIdentitySha256: sessionSnapshot.targetSchemaIdentitySha256,
        sourceDescriptorHash: sessionSnapshot.sourceDescriptorHash,
        sourceSchemaIdentitySha256: sessionSnapshot.sourceSchemaIdentitySha256,
      },
    );
    const observedOutcome = evidenceMismatchOutcome(execution);
    if (observedOutcome !== undefined) observedOutcome.realEvidenceObserved = true;
    adoption = adoptSQLiteCursorPostRebindWatermarkIntrinsic(context, tombstone, execution);
    if (observedOutcome !== undefined) {
      observedOutcome.adoption = new weakRefIntrinsic(adoption as object);
      observedOutcome.adoptionLifecycle = "active";
    }
    const write = mintWriteReceipt(session, context, tombstone, adoption);
    return executeSQLiteCursorRebindRule11GateIntrinsic(write);
  } catch (error) {
    poisonAfterConsume(
      context,
      tombstone,
      adoption,
      "SQLite cursor rebind failed after session consumption",
    );
    const outcome = evidenceMismatchOutcome(execution);
    if (outcome !== undefined) {
      outcome.tombstoneLifecycle = "poisoned";
      if (outcome.adoptionLifecycle === "active") outcome.adoptionLifecycle = "poisoned";
      if (outcome.writeLifecycle === "active") outcome.writeLifecycle = "poisoned";
      if (adoption !== undefined) {
        registerCompletedFailurePrimary(
          connection,
          session,
          context,
          tombstone,
          adoption,
          execution,
          error,
        );
      }
    }
    throw error;
  }
}
