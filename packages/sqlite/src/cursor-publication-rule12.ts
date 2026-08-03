import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  adoptSQLiteCursorPreVerificationClockEvidenceIntrinsic,
  adoptSQLiteCursorRule12SealAcceptanceIntrinsic,
  assertSQLiteCursorRule12EntryAuthorityIntrinsic,
  isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic,
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
  type SQLiteCursorPostRebindWatermarkAdoption,
  type SQLiteCursorPublicationRebindContext,
  type SQLiteCursorPublicationSession,
  type SQLiteCursorPublicationSessionCancellationSignal,
} from "./cursor-publication-outer-authority.js";
import {
  completeSQLiteCursorRebindRule11ForRule12Intrinsic,
  poisonSQLiteCursorRebindRule11ForRule12Intrinsic,
  prepareSQLiteCursorRebindRule11ForRule12Intrinsic,
  readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic,
  type SQLiteCursorRebindRule11Owner,
  type SQLiteCursorRebindRule11OwnerSnapshot,
  type SQLiteCursorRebindWriteReceipt,
} from "./cursor-publication-rebind.js";
import {
  beginSQLiteConnectionPostRebindSealReadIntrinsic,
  createSQLiteConnectionPostRebindSealReadCancellationAuthorityIntrinsic,
  disposeSQLiteConnectionPostRebindSealReadIntrinsic,
  executeSQLiteConnectionPostRebindSealReadIntrinsic,
  type SQLiteConnectionPostRebindSealReadEvidence,
  type SQLiteConnectionPostRebindSealReadExecution,
} from "./cursor-publication-rule12-read.js";
import {
  SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
  SQLITE_CURSOR_SEAL_DOMAIN,
  SQLITE_CURSOR_SEAL_EMPTY_ROOT,
  SQLITE_CURSOR_SEAL_ROW_DOMAIN,
} from "./operation-baseline-cursor-invariants.js";
import type {
  SQLiteConnection,
  SQLiteConnectionPostRebindSealQueryPlanSnapshot,
  SQLiteConnectionTransactionLineage,
} from "./sqlite-connection.js";
import type {
  SQLiteCursorMigrationLockCapability,
  SQLiteCursorProviderClockCapability,
  SQLiteCursorProviderClockConsumedTombstone,
  SQLiteCursorProviderClockEvidence,
} from "./cursor-publication-clock-authority.js";

const OPERATION = "inspect-schema" as const;
const objectCreateIntrinsic = Object.create;
const objectFreezeIntrinsic = Object.freeze;
const reflectApplyIntrinsic = Reflect.apply;
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;

export const SQLITE_CURSOR_RULE12_ID_INTRINSIC = "BLR_CURSOR_SEAL_MISMATCH" as const;
export const SQLITE_CURSOR_RULE12_POSITION_INTRINSIC = 12 as const;
export const SQLITE_CURSOR_RULE12_ORDER_INTRINSIC = objectFreezeIntrinsic([
  "token-hash-utf8-bytes",
  "tenant-id-utf8-bytes",
] as const);

/** Opaque accepted main-table seal; it is not cursor-clock or commit authority. */
export interface SQLiteCursorRule12SuccessReceipt {
  readonly __sqliteCursorRule12SuccessReceipt: never;
}

export interface SQLiteCursorRule12SuccessReceiptSnapshot {
  readonly lifecycle: "active" | "pre-verification-clock-read-unconsumed";
  readonly ruleId: typeof SQLITE_CURSOR_RULE12_ID_INTRINSIC;
  readonly position: typeof SQLITE_CURSOR_RULE12_POSITION_INTRINSIC;
  readonly rule11Receipt: SQLiteCursorRebindRule11Owner;
  readonly rebindWriteReceipt: SQLiteCursorRebindWriteReceipt;
  readonly session: SQLiteCursorPublicationSession;
  readonly context: SQLiteCursorPublicationRebindContext;
  readonly watermarkAdoption: SQLiteCursorPostRebindWatermarkAdoption;
  readonly connection: SQLiteConnection;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transactionEpoch: bigint;
  readonly totalChanges: number;
  readonly b2CursorCount: number;
  readonly mainKeyCount: number;
  readonly driverCount: number;
  readonly lookupCount: number;
  readonly accumulatorCount: number;
  readonly receiptImmutableRootSha256: string;
  readonly computedImmutableRootSha256: string;
  readonly targetDescriptorHash: string;
  readonly targetSchemaIdentitySha256: string;
  readonly sealAlgorithmVersion: typeof SQLITE_CURSOR_SEAL_ALGORITHM_VERSION;
  readonly rowDomain: typeof SQLITE_CURSOR_SEAL_ROW_DOMAIN;
  readonly sealDomain: typeof SQLITE_CURSOR_SEAL_DOMAIN;
  readonly order: typeof SQLITE_CURSOR_RULE12_ORDER_INTRINSIC;
  readonly queryPlans: SQLiteConnectionPostRebindSealQueryPlanSnapshot;
  readonly sealRead: SQLiteConnectionPostRebindSealReadEvidence;
  readonly maximumActiveCursors: number;
  readonly maximumLivePhysicalRows: number;
  readonly maximumLiveCarriers: number;
  readonly violationCount: 0;
  readonly diagnosticsTruncated: false;
  readonly migrationLockCapability: SQLiteCursorMigrationLockCapability;
  readonly providerClockCapability: SQLiteCursorProviderClockCapability;
  readonly outerClockEvidence: SQLiteCursorProviderClockEvidence;
  readonly outerClockConsumedTombstone: SQLiteCursorProviderClockConsumedTombstone;
  readonly preRebindClockEvidence: SQLiteCursorProviderClockEvidence;
  readonly preRebindClockConsumedTombstone: SQLiteCursorProviderClockConsumedTombstone;
  readonly preVerificationClockEvidence: SQLiteCursorProviderClockEvidence | undefined;
}

interface Rule12State {
  readonly token: SQLiteCursorRule12SuccessReceipt;
  readonly rule11: SQLiteCursorRebindRule11Owner;
  readonly rule11Snapshot: SQLiteCursorRebindRule11OwnerSnapshot;
  readonly readExecution: SQLiteConnectionPostRebindSealReadExecution;
  readonly readEvidence: SQLiteConnectionPostRebindSealReadEvidence;
  lifecycle: "active" | "pre-verification-clock-read-unconsumed" | "poisoned";
  preVerificationClockEvidence: SQLiteCursorProviderClockEvidence | undefined;
}

const RECEIPTS = new WeakMap<object, Rule12State>();
let registrationFaultForTest: Readonly<{ readonly value: unknown }> | undefined;
let postRegistrationFailureObserverForTest:
  ((receipt: SQLiteCursorRule12SuccessReceipt) => void) | undefined;
let postSealValidationObserverForTest: (() => void) | undefined;
let cleanupFaultForTest: Readonly<{ readonly value: unknown }> | undefined;

function fail(message: string): never {
  throw new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function receiptState(receipt: SQLiteCursorRule12SuccessReceipt): Rule12State {
  const state = receipt !== null && typeof receipt === "object" && !isProxy(receipt)
    ? reflectApplyIntrinsic(weakMapGetIntrinsic, RECEIPTS, [receipt as object]) as
      Rule12State | undefined
    : undefined;
  if (state === undefined || state.token !== receipt || state.lifecycle === "poisoned") {
    return fail("SQLite Rule 12 success receipt is invalid");
  }
  return state;
}

function poisonRule12(
  rule11: SQLiteCursorRebindRule11Owner,
  message: string,
  state?: Rule12State,
): void {
  if (state !== undefined) state.lifecycle = "poisoned";
  try {
    poisonSQLiteCursorRebindRule11ForRule12Intrinsic(rule11, message);
  } catch {
    // Preserve the selected Rule 12 primary, including a thrown non-Error.
  }
}

function assertAcceptedSeal(
  rule11: SQLiteCursorRebindRule11OwnerSnapshot,
  seal: SQLiteConnectionPostRebindSealReadEvidence,
): void {
  const context = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(rule11.context);
  const expected = rule11.counts.b2CursorCount;
  const nonzeroTargetsExact = expected === 0
    ? seal.observedDescriptorHash === null && seal.observedSchemaIdentitySha256 === null
    : seal.observedDescriptorHash === context.targetDescriptorHash
      && seal.observedSchemaIdentitySha256 === context.targetSchemaIdentitySha256;
  if (seal.mainKeyCount !== expected || seal.driverCount !== expected
      || seal.lookupCount !== expected || seal.accumulatorCount !== expected
      || seal.pointStatementExecuteCount !== expected
      || seal.pointCursorCreatedCount !== expected || seal.pointCursorClosedCount !== expected
      || seal.computedImmutableRootSha256 !== context.b2ImmutableRootSha256
      || (expected === 0 && seal.computedImmutableRootSha256 !== SQLITE_CURSOR_SEAL_EMPTY_ROOT)
      || !nonzeroTargetsExact || seal.transactionLineage !== rule11.transactionLineage
      || seal.transactionEpoch !== rule11.transactionEpoch
      || seal.totalChanges !== rule11.totalChanges
      || seal.mainKeyCountPrepareCount !== 1 || seal.mainKeyCountTerminalFetchCount !== 1
      || seal.mainKeyCountCloseCount !== 1 || seal.driverPrepareCount !== 1
      || seal.driverTerminalFetchCount !== 1 || seal.driverCloseCount !== 1
      || seal.pointStatementPrepareCount !== 1 || seal.pointStatementReleaseCount !== 1
      || seal.activeCursors !== 0 || seal.livePhysicalRows !== 0 || seal.liveCarriers !== 0
      || seal.maximumActiveCursors > 2 || seal.maximumLivePhysicalRows > 1
      || seal.maximumLiveCarriers > 1 || context.rule12QueryPlans.probeCount !== 3
      || !context.rule12QueryPlans.sorterFree
      || !context.rule12QueryPlans.primaryKeyPointLookup) {
    return fail("SQLite post-rebind receipt mismatch");
  }
}

/** Package-private one-shot registration seam for failure-atomicity tests. */
export function injectSQLiteCursorRule12RegistrationFaultForTestIntrinsic(error: unknown): void {
  if (registrationFaultForTest !== undefined) {
    return fail("SQLite Rule 12 registration fault is already armed");
  }
  registrationFaultForTest = objectFreezeIntrinsic({ value: error });
}

/** One-shot observer proving a registered receipt is poisoned by later adoption failure. */
export function injectSQLiteCursorRule12PostRegistrationFailureObserverForTestIntrinsic(
  observe: (receipt: SQLiteCursorRule12SuccessReceipt) => void,
): void {
  if (postRegistrationFailureObserverForTest !== undefined || typeof observe !== "function") {
    return fail("SQLite Rule 12 post-registration failure observer is invalid");
  }
  postRegistrationFailureObserverForTest = observe;
}

/** One-shot seam immediately after the complete seal validation, before final cancellation. */
export function injectSQLiteCursorRule12PostSealValidationObserverForTestIntrinsic(
  observe: () => void,
): void {
  if (postSealValidationObserverForTest !== undefined || typeof observe !== "function") {
    return fail("SQLite Rule 12 post-seal validation observer is invalid");
  }
  postSealValidationObserverForTest = observe;
}

/** One-shot cleanup fault proving that an after-begin primary is never replaced. */
export function injectSQLiteCursorRule12CleanupFaultForTestIntrinsic(error: unknown): void {
  if (cleanupFaultForTest !== undefined) {
    return fail("SQLite Rule 12 cleanup fault is already armed");
  }
  cleanupFaultForTest = objectFreezeIntrinsic({ value: error });
}

/** Consume exact R11 once, accept the bounded main-table seal, and mint R12. */
export function executeSQLiteCursorPublicationRule12Intrinsic(
  rule11: SQLiteCursorRebindRule11Owner,
  cancellation?: SQLiteCursorPublicationSessionCancellationSignal,
): SQLiteCursorRule12SuccessReceipt {
  let predecessor: SQLiteCursorRebindRule11OwnerSnapshot | undefined;
  let write: ReturnType<typeof readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic> | undefined;
  let execution: SQLiteConnectionPostRebindSealReadExecution | undefined;
  let state: Rule12State | undefined;
  try {
    predecessor = prepareSQLiteCursorRebindRule11ForRule12Intrinsic(rule11);
    write = readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(
      predecessor.writeReceipt,
    );
    assertSQLiteCursorRule12EntryAuthorityIntrinsic(
      predecessor.context,
      predecessor.watermarkAdoption,
    );
    const cancellationAuthority = cancellation === undefined
      ? undefined
      : createSQLiteConnectionPostRebindSealReadCancellationAuthorityIntrinsic(
        cancellation as object,
        (signal): boolean => isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(
          signal as SQLiteCursorPublicationSessionCancellationSignal,
        ),
      );
    execution = beginSQLiteConnectionPostRebindSealReadIntrinsic(
      write.connection,
      write.execution,
    );
    const seal = executeSQLiteConnectionPostRebindSealReadIntrinsic(
      write.connection,
      execution,
      cancellationAuthority,
    );
    assertAcceptedSeal(predecessor, seal);
    const postSealValidationObserver = postSealValidationObserverForTest;
    postSealValidationObserverForTest = undefined;
    if (postSealValidationObserver !== undefined) postSealValidationObserver();
    // The final cancellation point follows accumulator finish and every
    // count/root/target comparison. It cannot replace an earlier primary.
    if (isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(cancellation)) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE",
        OPERATION,
        "SQLite Rule 12 was cancelled after final seal verification",
      );
    }
    const token = objectFreezeIntrinsic(
      reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
    ) as SQLiteCursorRule12SuccessReceipt;
    state = {
      token,
      rule11,
      rule11Snapshot: predecessor,
      readExecution: execution,
      readEvidence: seal,
      lifecycle: "active",
      preVerificationClockEvidence: undefined,
    };
    const registrationFault = registrationFaultForTest;
    registrationFaultForTest = undefined;
    if (registrationFault !== undefined) throw registrationFault.value;
    reflectApplyIntrinsic(weakMapSetIntrinsic, RECEIPTS, [token as object, state]);
    completeSQLiteCursorRebindRule11ForRule12Intrinsic(rule11, token);
    adoptSQLiteCursorRule12SealAcceptanceIntrinsic(
      predecessor.context,
      predecessor.watermarkAdoption,
      rule11 as object,
      token as object,
    );
    postRegistrationFailureObserverForTest = undefined;
    return token;
  } catch (error) {
    postSealValidationObserverForTest = undefined;
    const registeredState = state;
    const registered = registeredState !== undefined
      && reflectApplyIntrinsic(
        weakMapGetIntrinsic, RECEIPTS, [registeredState.token as object],
      ) === registeredState;
    const observer = postRegistrationFailureObserverForTest;
    postRegistrationFailureObserverForTest = undefined;
    if (registered && observer !== undefined) {
      try { observer(registeredState!.token); } catch { /* Preserve the Rule 12 primary. */ }
    }
    const cleanupFault = cleanupFaultForTest;
    cleanupFaultForTest = undefined;
    if (execution !== undefined && write !== undefined) {
      try {
        if (cleanupFault !== undefined) throw cleanupFault.value;
        disposeSQLiteConnectionPostRebindSealReadIntrinsic(write.connection, execution);
      } catch {
        // The Rule 12 primary outranks lower cursor cleanup.
      }
    }
    poisonRule12(rule11, "SQLite Rule 12 main-table seal acceptance failed", state);
    throw error;
  }
}

function snapshot(state: Rule12State): SQLiteCursorRule12SuccessReceiptSnapshot {
  const predecessor = state.rule11Snapshot;
  const context = readSQLiteCursorPublicationRebindContextSnapshotIntrinsic(predecessor.context);
  const seal = state.readEvidence;
  return objectFreezeIntrinsic({
    lifecycle: state.lifecycle as Exclude<Rule12State["lifecycle"], "poisoned">,
    ruleId: SQLITE_CURSOR_RULE12_ID_INTRINSIC,
    position: SQLITE_CURSOR_RULE12_POSITION_INTRINSIC,
    rule11Receipt: state.rule11,
    rebindWriteReceipt: predecessor.writeReceipt,
    session: predecessor.session,
    context: predecessor.context,
    watermarkAdoption: predecessor.watermarkAdoption,
    connection: readSQLiteCursorRebindWriteReceiptSnapshotIntrinsic(
      predecessor.writeReceipt,
    ).connection,
    transactionLineage: predecessor.transactionLineage,
    transactionEpoch: predecessor.transactionEpoch,
    totalChanges: predecessor.totalChanges,
    b2CursorCount: predecessor.counts.b2CursorCount,
    mainKeyCount: seal.mainKeyCount,
    driverCount: seal.driverCount,
    lookupCount: seal.lookupCount,
    accumulatorCount: seal.accumulatorCount,
    receiptImmutableRootSha256: context.b2ImmutableRootSha256,
    computedImmutableRootSha256: seal.computedImmutableRootSha256,
    targetDescriptorHash: context.targetDescriptorHash,
    targetSchemaIdentitySha256: context.targetSchemaIdentitySha256,
    sealAlgorithmVersion: SQLITE_CURSOR_SEAL_ALGORITHM_VERSION,
    rowDomain: SQLITE_CURSOR_SEAL_ROW_DOMAIN,
    sealDomain: SQLITE_CURSOR_SEAL_DOMAIN,
    order: SQLITE_CURSOR_RULE12_ORDER_INTRINSIC,
    queryPlans: context.rule12QueryPlans,
    sealRead: seal,
    maximumActiveCursors: seal.maximumActiveCursors,
    maximumLivePhysicalRows: seal.maximumLivePhysicalRows,
    maximumLiveCarriers: seal.maximumLiveCarriers,
    violationCount: 0 as const,
    diagnosticsTruncated: false as const,
    migrationLockCapability: context.migrationLockCapability,
    providerClockCapability: context.providerClockCapability,
    outerClockEvidence: context.outerClockEvidence,
    outerClockConsumedTombstone: context.outerClockConsumedTombstone,
    preRebindClockEvidence: context.preRebindClockEvidence,
    preRebindClockConsumedTombstone: context.preRebindClockConsumedTombstone,
    preVerificationClockEvidence: state.preVerificationClockEvidence,
  });
}

export function readSQLiteCursorRule12SuccessReceiptSnapshotIntrinsic(
  receipt: SQLiteCursorRule12SuccessReceipt,
): SQLiteCursorRule12SuccessReceiptSnapshot {
  return snapshot(receiptState(receipt));
}

/** Authenticate the optional upper cancellation presentation before clock read three. */
export function assertSQLiteCursorRule12BeforeVerificationCancellationIntrinsic(
  receipt: SQLiteCursorRule12SuccessReceipt,
  cancellation?: SQLiteCursorPublicationSessionCancellationSignal,
): void {
  receiptState(receipt);
  if (isSQLiteCursorPublicationSessionCancellationRequestedIntrinsic(cancellation)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_UNAVAILABLE",
      OPERATION,
      "SQLite before-verification clock read was cancelled",
    );
  }
}

/** Called only by the authenticated third-clock wrapper after evidence mint. */
export function adoptSQLiteCursorRule12PreVerificationClockEvidenceIntrinsic(
  receipt: SQLiteCursorRule12SuccessReceipt,
  evidence: SQLiteCursorProviderClockEvidence,
): void {
  const state = receiptState(receipt);
  if (state.lifecycle !== "active" || state.preVerificationClockEvidence !== undefined) {
    poisonRule12(state.rule11, "SQLite Rule 12 third-clock adoption was replayed", state);
    return fail("SQLite Rule 12 third-clock adoption is invalid");
  }
  const predecessor = state.rule11Snapshot;
  adoptSQLiteCursorPreVerificationClockEvidenceIntrinsic(
    predecessor.context,
    predecessor.watermarkAdoption,
    state.rule11 as object,
    receipt as object,
    evidence as object,
  );
  state.preVerificationClockEvidence = evidence;
  state.lifecycle = "pre-verification-clock-read-unconsumed";
}

/** Poison exact R12 after a third-clock primary without replacing that primary. */
export function poisonSQLiteCursorRule12AfterSuccessIntrinsic(
  receipt: SQLiteCursorRule12SuccessReceipt,
  message: string,
): void {
  const state = receiptState(receipt);
  poisonRule12(state.rule11, message, state);
}
