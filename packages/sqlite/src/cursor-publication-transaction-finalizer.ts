import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic,
  readSQLiteCursorPublicationSessionSnapshotIntrinsic,
  readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic,
  type SQLiteCursorOuterPublicationAuthority,
  type SQLiteCursorPublicationRebindContext,
  type SQLiteCursorPublicationSession,
  type SQLiteCursorPublicationSessionConsumedTombstone,
} from "./cursor-publication-outer-authority.js";
import {
  executeSQLiteCursorPublicationRebindRule11Intrinsic,
} from "./cursor-publication-rebind.js";
import {
  SQLiteConnection,
  execSQLiteConnectionTrustedIntrinsic,
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  type SQLiteConnectionTransactionLineage,
} from "./sqlite-connection.js";

const PROVIDER_OPERATION = "inspect-schema" as const;
const objectCreateIntrinsic = Object.create;
const objectFreezeIntrinsic = Object.freeze;
const reflectApplyIntrinsic = Reflect.apply;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakRefDerefIntrinsic = WeakRef.prototype.deref;
const weakRefIntrinsic = WeakRef;
const weakSetAddIntrinsic = WeakSet.prototype.add;
const weakSetDeleteIntrinsic = WeakSet.prototype.delete;
const weakSetHasIntrinsic = WeakSet.prototype.has;
const sqliteConnectionCloseIntrinsic = SQLiteConnection.prototype.close;
const execSQLiteConnectionTrustedVerifierIntrinsic = execSQLiteConnectionTrustedIntrinsic;
const readSQLiteConnectionOwnerSnapshotVerifierIntrinsic = readSQLiteConnectionOwnerSnapshot;
const readSQLiteConnectionCursorRebindExecutionSnapshotVerifierIntrinsic =
  readSQLiteConnectionCursorRebindExecutionSnapshotIntrinsic;
const readOuterSnapshotIntrinsic =
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic;
const readContextSnapshotIntrinsic =
  readSQLiteCursorPublicationRebindContextSnapshotIntrinsic;
const readPublicationSessionSnapshotIntrinsic =
  readSQLiteCursorPublicationSessionSnapshotIntrinsic;
const readTombstoneSnapshotIntrinsic =
  readSQLiteCursorPublicationSessionConsumedTombstoneSnapshotIntrinsic;
const executePublicationRebindRule11LeafIntrinsic =
  executeSQLiteCursorPublicationRebindRule11Intrinsic;

export interface SQLiteCursorPostConsumeTransactionFailureFinalizerOwner {
  readonly __sqliteCursorPostConsumeTransactionFailureFinalizerOwner: never;
}

/**
 * The capture is the only strong owner of the directly caught primary. Callers
 * may retain `leafPrimary` for identity comparison, but cannot present or
 * replace it during finalization.
 */
export interface SQLiteCursorPostConsumeTransactionFailureCapture {
  readonly owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner;
  readonly leafPrimary: object;
}

export interface SQLiteCursorPostConsumeFinalizerDiagnostic {
  readonly code:
    | "GE_SQLITE_POST_T_TERMINAL_PRIMARY"
    | "GE_SQLITE_ROLLBACK_AFTER_NATIVE_RETURN"
    | "GE_SQLITE_CLOSE_AFTER_NATIVE_RETURN";
  readonly operation: "cursor-publication-rule-11" | "rollback" | "close";
  readonly rank: "primary" | "secondary" | "tertiary";
  readonly origin:
    | "authenticated-post-t-terminal-primary"
    | "after-native-return-ambiguous-cleanup-fault";
}

export interface SQLiteCursorPostConsumeTransactionFailureFinalizerSnapshot {
  readonly lifecycle: "prepared" | "finalizing" | "finalized";
  readonly stateTrace: readonly ("prepared" | "finalizing" | "finalized")[];
  readonly ownerConsumeCount: 0 | 1;
  readonly terminalizeCount: 0 | 1;
  readonly rollbackAttemptCount: 0 | 1;
  readonly rollbackNativeReturnCount: 0 | 1;
  readonly rollbackAfterNativeReturnAmbiguousFaultCount: 0 | 1;
  readonly rollbackSecondaryFailureCount: 0 | 1;
  readonly closeAttemptCount: 0 | 1;
  readonly closeNativeReturnCount: 0 | 1;
  readonly closeAfterNativeReturnAmbiguousFaultCount: 0 | 1;
  readonly closeTertiaryFailureCount: 0 | 1;
  readonly selectedThrow: "GE_SQLITE_POST_T_TERMINAL_PRIMARY";
  readonly diagnosticCodes: readonly SQLiteCursorPostConsumeFinalizerDiagnostic["code"][];
  readonly diagnostics: readonly SQLiteCursorPostConsumeFinalizerDiagnostic[];
  readonly claims: Readonly<{
    cleanupNeverReplacesPrimary: true;
    driverNativeRollbackThrow: false;
    driverNativeCloseThrow: false;
    ownsBegin: false;
    ownsCommit: false;
    ownsRule12: false;
    ownsSuccessPath: false;
  }>;
  readonly leafPrimaryAlive: boolean;
  readonly graphIdentitiesAlive: boolean;
  readonly transactionEpoch: bigint;
}

type RegistrationFaultStage = "after-owner" | "after-authority";

interface FinalizerState {
  readonly authority: WeakRef<object>;
  readonly connection: WeakRef<object>;
  context: WeakRef<object> | undefined;
  leafPrimary: WeakRef<object> | undefined;
  tombstone: WeakRef<object> | undefined;
  readonly transactionLineage: WeakRef<object>;
  transactionEpoch: bigint;
  lifecycle: "capturing" | "prepared" | "finalizing" | "finalized";
  ownerConsumeCount: 0 | 1;
  terminalizeCount: 0 | 1;
  rollbackAttemptCount: 0 | 1;
  rollbackNativeReturnCount: 0 | 1;
  rollbackAfterNativeReturnAmbiguousFaultCount: 0 | 1;
  rollbackSecondaryFailureCount: 0 | 1;
  closeAttemptCount: 0 | 1;
  closeNativeReturnCount: 0 | 1;
  closeAfterNativeReturnAmbiguousFaultCount: 0 | 1;
  closeTertiaryFailureCount: 0 | 1;
}

const PRIMARY_DIAGNOSTIC = objectFreezeIntrinsic({
  code: "GE_SQLITE_POST_T_TERMINAL_PRIMARY",
  operation: "cursor-publication-rule-11",
  rank: "primary",
  origin: "authenticated-post-t-terminal-primary",
} as const satisfies SQLiteCursorPostConsumeFinalizerDiagnostic);
const ROLLBACK_DIAGNOSTIC = objectFreezeIntrinsic({
  code: "GE_SQLITE_ROLLBACK_AFTER_NATIVE_RETURN",
  operation: "rollback",
  rank: "secondary",
  origin: "after-native-return-ambiguous-cleanup-fault",
} as const satisfies SQLiteCursorPostConsumeFinalizerDiagnostic);
const CLOSE_DIAGNOSTIC = objectFreezeIntrinsic({
  code: "GE_SQLITE_CLOSE_AFTER_NATIVE_RETURN",
  operation: "close",
  rank: "tertiary",
  origin: "after-native-return-ambiguous-cleanup-fault",
} as const satisfies SQLiteCursorPostConsumeFinalizerDiagnostic);
const TRACE_PREPARED = objectFreezeIntrinsic(["prepared"] as const);
const TRACE_FINALIZING = objectFreezeIntrinsic(["prepared", "finalizing"] as const);
const TRACE_FINALIZED = objectFreezeIntrinsic([
  "prepared", "finalizing", "finalized",
] as const);
const CLAIMS = objectFreezeIntrinsic({
  cleanupNeverReplacesPrimary: true,
  driverNativeRollbackThrow: false,
  driverNativeCloseThrow: false,
  ownsBegin: false,
  ownsCommit: false,
  ownsRule12: false,
  ownsSuccessPath: false,
} as const);
const DIAGNOSTICS_PRIMARY = objectFreezeIntrinsic([PRIMARY_DIAGNOSTIC] as const);
const DIAGNOSTICS_PRIMARY_ROLLBACK = objectFreezeIntrinsic([
  PRIMARY_DIAGNOSTIC, ROLLBACK_DIAGNOSTIC,
] as const);
const DIAGNOSTICS_PRIMARY_CLOSE = objectFreezeIntrinsic([
  PRIMARY_DIAGNOSTIC, CLOSE_DIAGNOSTIC,
] as const);
const DIAGNOSTICS_ALL = objectFreezeIntrinsic([
  PRIMARY_DIAGNOSTIC, ROLLBACK_DIAGNOSTIC, CLOSE_DIAGNOSTIC,
] as const);
const CODES_PRIMARY = objectFreezeIntrinsic([PRIMARY_DIAGNOSTIC.code] as const);
const CODES_PRIMARY_ROLLBACK = objectFreezeIntrinsic([
  PRIMARY_DIAGNOSTIC.code, ROLLBACK_DIAGNOSTIC.code,
] as const);
const CODES_PRIMARY_CLOSE = objectFreezeIntrinsic([
  PRIMARY_DIAGNOSTIC.code, CLOSE_DIAGNOSTIC.code,
] as const);
const CODES_ALL = objectFreezeIntrinsic([
  PRIMARY_DIAGNOSTIC.code, ROLLBACK_DIAGNOSTIC.code, CLOSE_DIAGNOSTIC.code,
] as const);

const FINALIZERS = new WeakMap<object, FinalizerState>();
const FINALIZER_BY_AUTHORITY = new WeakMap<object, WeakRef<object>>();
const ROLLBACK_AFTER_NATIVE_RETURN_AMBIGUOUS_FAULTS = new WeakSet<object>();
const CLOSE_AFTER_NATIVE_RETURN_AMBIGUOUS_FAULTS = new WeakSet<object>();
let registrationFaultStage: RegistrationFaultStage | undefined;

function fail(message: string): never {
  throw new CycleStoreProviderError(
    "GE_CYCLE_STORE_INVALID_ARGUMENT",
    PROVIDER_OPERATION,
    message,
  );
}

function exactObject(value: unknown, label: string): object {
  if ((typeof value !== "object" && typeof value !== "function")
      || value === null || isProxy(value)) {
    return fail(`SQLite post-consume transaction finalizer ${label} is invalid`);
  }
  return value;
}

function weak<T extends object>(value: T): WeakRef<T> {
  return new weakRefIntrinsic(value);
}

function finalizerState(
  owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
): FinalizerState {
  const selected = exactObject(owner, "owner");
  const state = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    FINALIZERS,
    [selected],
  ) as FinalizerState | undefined;
  if (state === undefined || state.lifecycle === "capturing") {
    return fail("SQLite post-consume transaction finalizer owner is invalid");
  }
  return state;
}

function preCaptureGraph(
  session: SQLiteCursorPublicationSession,
): Readonly<{
  authority: SQLiteCursorOuterPublicationAuthority;
  connection: SQLiteConnection;
  transactionEpoch: bigint;
  transactionLineage: SQLiteConnectionTransactionLineage;
}> {
  const sessionSnapshot = readPublicationSessionSnapshotIntrinsic(session);
  const connection = sessionSnapshot.connection;
  const authority = sessionSnapshot.outerAuthority;
  const authoritySnapshot = readOuterSnapshotIntrinsic(authority);
  const owner = readSQLiteConnectionOwnerSnapshotVerifierIntrinsic(connection);
  if (authoritySnapshot.lifecycle !== "active"
      || authoritySnapshot.writePhase !== "publication-active"
      || authoritySnapshot.connection !== connection
      || authoritySnapshot.publicationSession !== session
      || authoritySnapshot.publicationRebindContext !== undefined
      || authoritySnapshot.publicationSessionConsumedTombstone !== undefined
      || authoritySnapshot.postRebindWatermarkAdoption !== undefined
      || !owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage === null
      || owner.transactionLineage !== authoritySnapshot.transactionLineage) {
    return fail("SQLite post-consume transaction leaf capture predecessor is invalid");
  }
  return objectFreezeIntrinsic({
    authority,
    connection,
    transactionEpoch: owner.transactionEpoch,
    transactionLineage: owner.transactionLineage,
  });
}

function exactPoisonedNativePrimaryGraph(
  connection: SQLiteConnection,
  authority: SQLiteCursorOuterPublicationAuthority,
  transactionLineage: SQLiteConnectionTransactionLineage,
): Readonly<{
  context: SQLiteCursorPublicationRebindContext;
  tombstone: SQLiteCursorPublicationSessionConsumedTombstone;
  transactionEpoch: bigint;
}> {
  const authoritySnapshot = readOuterSnapshotIntrinsic(authority);
  const context = authoritySnapshot.publicationRebindContext;
  const tombstone = authoritySnapshot.publicationSessionConsumedTombstone;
  if (context === undefined || tombstone === undefined) {
    return fail("SQLite post-consume transaction leaf did not produce exact T");
  }
  const contextSnapshot = readContextSnapshotIntrinsic(context);
  const tombstoneSnapshot = readTombstoneSnapshotIntrinsic(tombstone);
  const ownerSnapshot = readSQLiteConnectionOwnerSnapshotVerifierIntrinsic(connection);
  const executionSnapshot =
    readSQLiteConnectionCursorRebindExecutionSnapshotVerifierIntrinsic(
      connection,
      contextSnapshot.execution,
    );
  if (authoritySnapshot.lifecycle !== "poisoned"
      || authoritySnapshot.writePhase !== "poisoned"
      || authoritySnapshot.connection !== connection
      || authoritySnapshot.postRebindWatermarkAdoption !== undefined
      || authoritySnapshot.transactionLineage !== transactionLineage
      || contextSnapshot.lifecycle !== "poisoned"
      || contextSnapshot.outerAuthority !== authority
      || contextSnapshot.connection !== connection
      || contextSnapshot.transactionLineage !== transactionLineage
      || tombstoneSnapshot.lifecycle !== "poisoned"
      || tombstoneSnapshot.context !== context
      || tombstoneSnapshot.execution !== contextSnapshot.execution
      || tombstoneSnapshot.preparedOwner !== contextSnapshot.preparedOwner
      || !ownerSnapshot.isTransaction || ownerSnapshot.transactionMode !== "exclusive"
      || ownerSnapshot.transactionLineage !== transactionLineage
      || executionSnapshot.lifecycle !== "poisoned"
      || executionSnapshot.transactionLineage !== transactionLineage
      || executionSnapshot.transactionEpoch !== ownerSnapshot.transactionEpoch
      || executionSnapshot.executeCount !== 1
      || executionSnapshot.releaseCount !== 1
      || !executionSnapshot.statementOwnershipRetired
      || executionSnapshot.affectedRows !== 0
      || executionSnapshot.changesPrepareCount !== 0
      || executionSnapshot.changesFetchCount !== 0
      || executionSnapshot.changesReleaseCount !== 0) {
    return fail("SQLite post-consume transaction native-primary graph is invalid");
  }
  return objectFreezeIntrinsic({
    context,
    tombstone,
    transactionEpoch: ownerSnapshot.transactionEpoch,
  });
}

function throwRegistrationFault(stage: RegistrationFaultStage): void {
  if (registrationFaultStage === stage) {
    registrationFaultStage = undefined;
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INTERNAL",
      PROVIDER_OPERATION,
      "SQLite post-consume transaction finalizer registration fault",
    );
  }
}

/** Package-private pre-leaf register-then-throw rollback seam. */
export function injectSQLiteCursorPostConsumeFinalizerRegistrationFaultForTestIntrinsic(
  stage: RegistrationFaultStage,
): void {
  if ((stage !== "after-owner" && stage !== "after-authority")
      || registrationFaultStage !== undefined) {
    return fail("SQLite post-consume transaction finalizer registration fault is invalid");
  }
  registrationFaultStage = stage;
}

/**
 * Invoke and directly catch the module-captured Rule 11 leaf for one exact S.
 * The caller cannot provide or replace executable code. The predecessor must
 * be active before invocation and the same graph must expose exact poisoned
 * context/T/E evidence afterward.
 */
export function captureSQLiteCursorPostConsumeTransactionFailureIntrinsic(
  session: SQLiteCursorPublicationSession,
): SQLiteCursorPostConsumeTransactionFailureCapture {
  exactObject(session, "publication session");
  const predecessor = preCaptureGraph(session);
  const { authority, connection } = predecessor;
  const existingOwner = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    FINALIZER_BY_AUTHORITY,
    [authority as object],
  ) as WeakRef<object> | undefined;
  if (existingOwner !== undefined
      && reflectApplyIntrinsic(weakRefDerefIntrinsic, existingOwner, []) !== undefined) {
    return fail("SQLite post-consume transaction failure is already captured");
  }

  const owner = objectFreezeIntrinsic(
    reflectApplyIntrinsic(objectCreateIntrinsic, Object, [null]),
  ) as SQLiteCursorPostConsumeTransactionFailureFinalizerOwner;
  const state: FinalizerState = {
    authority: weak(authority as object),
    connection: weak(connection as object),
    context: undefined,
    leafPrimary: undefined,
    tombstone: undefined,
    transactionLineage: weak(predecessor.transactionLineage as object),
    transactionEpoch: predecessor.transactionEpoch,
    lifecycle: "capturing",
    ownerConsumeCount: 0,
    terminalizeCount: 0,
    rollbackAttemptCount: 0,
    rollbackNativeReturnCount: 0,
    rollbackAfterNativeReturnAmbiguousFaultCount: 0,
    rollbackSecondaryFailureCount: 0,
    closeAttemptCount: 0,
    closeNativeReturnCount: 0,
    closeAfterNativeReturnAmbiguousFaultCount: 0,
    closeTertiaryFailureCount: 0,
  };
  try {
    reflectApplyIntrinsic(weakMapSetIntrinsic, FINALIZERS, [owner as object, state]);
    throwRegistrationFault("after-owner");
    reflectApplyIntrinsic(weakMapSetIntrinsic, FINALIZER_BY_AUTHORITY, [
      authority as object,
      weak(owner as object),
    ]);
    throwRegistrationFault("after-authority");
  } catch (error) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, FINALIZERS, [owner as object]);
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, FINALIZER_BY_AUTHORITY, [
      authority as object,
    ]);
    throw error;
  }

  let caught = false;
  let leafPrimary: unknown;
  try {
    reflectApplyIntrinsic(executePublicationRebindRule11LeafIntrinsic, undefined, [session]);
  } catch (error) {
    caught = true;
    leafPrimary = error;
  }
  if (!caught) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, FINALIZERS, [owner as object]);
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, FINALIZER_BY_AUTHORITY, [authority as object]);
    return fail("SQLite post-consume transaction finalizer forbids a no-primary branch");
  }
  try {
    const primary = exactObject(leafPrimary, "directly caught leaf primary");
    const selected = exactPoisonedNativePrimaryGraph(
      connection,
      authority,
      predecessor.transactionLineage,
    );
    state.context = weak(selected.context as object);
    state.tombstone = weak(selected.tombstone as object);
    state.leafPrimary = weak(primary);
    state.transactionEpoch = selected.transactionEpoch;
    state.lifecycle = "prepared";
    return objectFreezeIntrinsic({ owner, leafPrimary: primary });
  } catch (error) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, FINALIZERS, [owner as object]);
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, FINALIZER_BY_AUTHORITY, [authority as object]);
    throw error;
  }
}

export function injectSQLiteCursorPostConsumeRollbackAfterNativeReturnAmbiguousFaultForTestIntrinsic(
  owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
): void {
  const state = finalizerState(owner);
  if (state.lifecycle !== "prepared" || reflectApplyIntrinsic(
    weakSetHasIntrinsic,
    ROLLBACK_AFTER_NATIVE_RETURN_AMBIGUOUS_FAULTS,
    [owner as object],
  )) {
    return fail("SQLite post-consume rollback after-return fault is invalid");
  }
  reflectApplyIntrinsic(weakSetAddIntrinsic, ROLLBACK_AFTER_NATIVE_RETURN_AMBIGUOUS_FAULTS, [
    owner as object,
  ]);
}

export function injectSQLiteCursorPostConsumeCloseAfterNativeReturnAmbiguousFaultForTestIntrinsic(
  owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
): void {
  const state = finalizerState(owner);
  if (state.lifecycle !== "prepared" || reflectApplyIntrinsic(
    weakSetHasIntrinsic,
    CLOSE_AFTER_NATIVE_RETURN_AMBIGUOUS_FAULTS,
    [owner as object],
  )) {
    return fail("SQLite post-consume close after-return fault is invalid");
  }
  reflectApplyIntrinsic(weakSetAddIntrinsic, CLOSE_AFTER_NATIVE_RETURN_AMBIGUOUS_FAULTS, [
    owner as object,
  ]);
}

/**
 * Consume the owner, enter `finalizing` before I/O, attempt real rollback and
 * close once, enter `finalized`, and rethrow the internally captured primary.
 */
export function finalizeSQLiteCursorPostConsumeTransactionFailureIntrinsic(
  owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
): never {
  const state = finalizerState(owner);
  if (state.lifecycle !== "prepared") {
    return fail("SQLite post-consume transaction finalizer owner replay is invalid");
  }
  const connection = reflectApplyIntrinsic(
    weakRefDerefIntrinsic, state.connection, [],
  ) as SQLiteConnection | undefined;
  const authority = reflectApplyIntrinsic(
    weakRefDerefIntrinsic, state.authority, [],
  ) as SQLiteCursorOuterPublicationAuthority | undefined;
  const context = state.context === undefined ? undefined : reflectApplyIntrinsic(
    weakRefDerefIntrinsic, state.context, [],
  ) as SQLiteCursorPublicationRebindContext | undefined;
  const tombstone = state.tombstone === undefined ? undefined : reflectApplyIntrinsic(
    weakRefDerefIntrinsic, state.tombstone, [],
  ) as SQLiteCursorPublicationSessionConsumedTombstone | undefined;
  const transactionLineage = reflectApplyIntrinsic(
    weakRefDerefIntrinsic, state.transactionLineage, [],
  ) as SQLiteConnectionTransactionLineage | undefined;
  const leafPrimary = state.leafPrimary === undefined ? undefined : reflectApplyIntrinsic(
    weakRefDerefIntrinsic, state.leafPrimary, [],
  );
  // A dead primary forbids cleanup. This check dominates owner consumption,
  // the `finalizing` transition, and every native operation.
  if (leafPrimary === undefined) {
    return fail("SQLite post-consume transaction leaf primary expired before finalizing");
  }
  if (connection === undefined || authority === undefined || context === undefined
      || tombstone === undefined || transactionLineage === undefined) {
    return fail("SQLite post-consume transaction finalizer graph expired");
  }
  const selected = exactPoisonedNativePrimaryGraph(
    connection,
    authority,
    transactionLineage,
  );
  if (selected.context !== context || selected.tombstone !== tombstone
      || selected.transactionEpoch !== state.transactionEpoch) {
    return fail("SQLite post-consume transaction finalizer graph drifted");
  }

  // Assignment-only one-shot consumption and terminalization precede all I/O.
  state.ownerConsumeCount = 1;
  state.lifecycle = "finalizing";
  state.terminalizeCount = 1;

  state.rollbackAttemptCount = 1;
  try {
    execSQLiteConnectionTrustedVerifierIntrinsic(connection, "ROLLBACK", PROVIDER_OPERATION);
    state.rollbackNativeReturnCount = 1;
    if (reflectApplyIntrinsic(
      weakSetDeleteIntrinsic,
      ROLLBACK_AFTER_NATIVE_RETURN_AMBIGUOUS_FAULTS,
      [owner as object],
    )) {
      state.rollbackAfterNativeReturnAmbiguousFaultCount = 1;
      throw ROLLBACK_DIAGNOSTIC;
    }
  } catch {
    state.rollbackSecondaryFailureCount = 1;
  }

  state.closeAttemptCount = 1;
  try {
    reflectApplyIntrinsic(sqliteConnectionCloseIntrinsic, connection, []);
    state.closeNativeReturnCount = 1;
    if (reflectApplyIntrinsic(
      weakSetDeleteIntrinsic,
      CLOSE_AFTER_NATIVE_RETURN_AMBIGUOUS_FAULTS,
      [owner as object],
    )) {
      state.closeAfterNativeReturnAmbiguousFaultCount = 1;
      throw CLOSE_DIAGNOSTIC;
    }
  } catch {
    state.closeTertiaryFailureCount = 1;
  }

  state.lifecycle = "finalized";
  throw leafPrimary;
}

function diagnostics(state: FinalizerState): readonly SQLiteCursorPostConsumeFinalizerDiagnostic[] {
  if (state.rollbackAfterNativeReturnAmbiguousFaultCount === 1
      && state.closeAfterNativeReturnAmbiguousFaultCount === 1) return DIAGNOSTICS_ALL;
  if (state.rollbackAfterNativeReturnAmbiguousFaultCount === 1) {
    return DIAGNOSTICS_PRIMARY_ROLLBACK;
  }
  if (state.closeAfterNativeReturnAmbiguousFaultCount === 1) return DIAGNOSTICS_PRIMARY_CLOSE;
  return DIAGNOSTICS_PRIMARY;
}

function diagnosticCodes(
  state: FinalizerState,
): readonly SQLiteCursorPostConsumeFinalizerDiagnostic["code"][] {
  if (state.rollbackAfterNativeReturnAmbiguousFaultCount === 1
      && state.closeAfterNativeReturnAmbiguousFaultCount === 1) return CODES_ALL;
  if (state.rollbackAfterNativeReturnAmbiguousFaultCount === 1) return CODES_PRIMARY_ROLLBACK;
  if (state.closeAfterNativeReturnAmbiguousFaultCount === 1) return CODES_PRIMARY_CLOSE;
  return CODES_PRIMARY;
}

export function readSQLiteCursorPostConsumeTransactionFailureFinalizerSnapshotIntrinsic(
  owner: SQLiteCursorPostConsumeTransactionFailureFinalizerOwner,
): SQLiteCursorPostConsumeTransactionFailureFinalizerSnapshot {
  const state = finalizerState(owner);
  if (state.lifecycle === "capturing") {
    return fail("SQLite post-consume transaction finalizer owner is invalid");
  }
  const contextAlive = state.context !== undefined
    && reflectApplyIntrinsic(weakRefDerefIntrinsic, state.context, []) !== undefined;
  const tombstoneAlive = state.tombstone !== undefined
    && reflectApplyIntrinsic(weakRefDerefIntrinsic, state.tombstone, []) !== undefined;
  const graphIdentitiesAlive = reflectApplyIntrinsic(
    weakRefDerefIntrinsic, state.connection, [],
  ) !== undefined
    && reflectApplyIntrinsic(weakRefDerefIntrinsic, state.authority, []) !== undefined
    && contextAlive && tombstoneAlive
    && reflectApplyIntrinsic(weakRefDerefIntrinsic, state.transactionLineage, []) !== undefined;
  const trace = state.lifecycle === "prepared"
    ? TRACE_PREPARED
    : state.lifecycle === "finalizing" ? TRACE_FINALIZING : TRACE_FINALIZED;
  return objectFreezeIntrinsic({
    lifecycle: state.lifecycle,
    stateTrace: trace,
    ownerConsumeCount: state.ownerConsumeCount,
    terminalizeCount: state.terminalizeCount,
    rollbackAttemptCount: state.rollbackAttemptCount,
    rollbackNativeReturnCount: state.rollbackNativeReturnCount,
    rollbackAfterNativeReturnAmbiguousFaultCount:
      state.rollbackAfterNativeReturnAmbiguousFaultCount,
    rollbackSecondaryFailureCount: state.rollbackSecondaryFailureCount,
    closeAttemptCount: state.closeAttemptCount,
    closeNativeReturnCount: state.closeNativeReturnCount,
    closeAfterNativeReturnAmbiguousFaultCount:
      state.closeAfterNativeReturnAmbiguousFaultCount,
    closeTertiaryFailureCount: state.closeTertiaryFailureCount,
    selectedThrow: PRIMARY_DIAGNOSTIC.code,
    diagnosticCodes: diagnosticCodes(state),
    diagnostics: diagnostics(state),
    claims: CLAIMS,
    leafPrimaryAlive: state.leafPrimary !== undefined && reflectApplyIntrinsic(
      weakRefDerefIntrinsic, state.leafPrimary, [],
    ) !== undefined,
    graphIdentitiesAlive,
    transactionEpoch: state.transactionEpoch,
  });
}
