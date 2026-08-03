import { isProxy } from "node:util/types";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLiteConnection,
  auditSQLiteConnectionPublicationSourceV1Intrinsic,
  closeSQLiteConnectionPublicationTransactionOwnerIntrinsic,
  consumeSQLiteConnectionPublicationReopenCapabilityIntrinsic,
  executeSQLiteConnectionPublicationTransactionOwnerControlIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
  registerSQLiteConnectionPublicationTransactionOwnerIntrinsic,
  revokeSQLiteConnectionPublicationReopenCapabilityIntrinsic,
  type SQLiteConnectionPublicationTransactionGuard,
  type SQLiteConnectionPublicationTransactionGuardRoute,
  type SQLiteConnectionPublicationReopenCapability,
  type SQLiteConnectionTransactionLineage,
  type SQLiteTransactionMode,
} from "./sqlite-connection.js";

const CONTRACT_ID = "sqlite-cursor-publication-transaction-owner-v1" as const;
const CONTRACT_FIXTURE_SHA256 =
  "e900c0d822a31690c6cd4ef8d160d1cc4474bf4c605471d1aac899d4b293b303" as const;
const objectCreateIntrinsic = Object.create;
const objectFreezeIntrinsic = Object.freeze;
const objectGetOwnPropertyDescriptorIntrinsic = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOfIntrinsic = Object.getPrototypeOf;
const cycleStoreProviderErrorPrototypeIntrinsic = CycleStoreProviderError.prototype;
const weakMapDeleteIntrinsic = WeakMap.prototype.delete;
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const weakRefDerefIntrinsic = WeakRef.prototype.deref;
const weakRefIntrinsic = WeakRef;
const reflectApplyIntrinsic = Reflect.apply;

export const SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS = objectFreezeIntrinsic([
  "connection-commit-method",
  "connection-rollback-method",
  "execute-COMMIT-or-END",
  "execute-ROLLBACK",
  "execute-BEGIN",
  "execute-SAVEPOINT-or-RELEASE-or-ROLLBACK-TO",
  "multi-statement-exec-containing-transaction-control",
  "prepared-statement-containing-transaction-control",
  "script-containing-implicit-or-explicit-transaction-control",
  "nested-BEGIN",
  "close-live-guarded-transaction",
  "newly-prepared-permanent-DML-after-pre-retirement",
  "already-prepared-permanent-DML-after-pre-retirement",
  "newly-prepared-permanent-DDL-after-pre-retirement",
  "already-prepared-permanent-DDL-after-pre-retirement",
  "persistent-PRAGMA-including-user-version-or-application-id",
  "VACUUM-ANALYZE-or-REINDEX",
  "ATTACH-DETACH-or-connection-topology-change",
  "any-other-permanent-state-mutation-or-transaction-proof-history-change",
] as const);

export type SQLiteCursorPublicationTransactionGuardPath =
  typeof SQLITE_CURSOR_PUBLICATION_TRANSACTION_GUARD_PATHS[number];

export type SQLiteCursorPublicationTransactionOwnerErrorCode =
  | "GE_SQLITE_TX_OWNER_INVALID_AUTHORITY"
  | "GE_SQLITE_TX_OWNER_INVALID_STATE"
  | "GE_SQLITE_TX_OWNER_GUARD_REJECTED"
  | "GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT"
  | "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
  | "GE_SQLITE_TX_OWNER_REOPEN_UNAVAILABLE"
  | "GE_SQLITE_TX_OWNER_COMMIT_DISABLED";

export class SQLiteCursorPublicationTransactionOwnerError extends Error {
  readonly code: SQLiteCursorPublicationTransactionOwnerErrorCode;
  readonly guardPath: SQLiteCursorPublicationTransactionGuardPath | null;

  constructor(
    code: SQLiteCursorPublicationTransactionOwnerErrorCode,
    message: string,
    options: ErrorOptions & Readonly<{
      readonly guardPath?: SQLiteCursorPublicationTransactionGuardPath;
    }> = {},
  ) {
    super(message, options);
    this.name = "SQLiteCursorPublicationTransactionOwnerError";
    this.code = code;
    this.guardPath = options.guardPath ?? null;
  }
}

export interface SQLiteCursorPublicationTransactionOwner {
  readonly __sqliteCursorPublicationTransactionOwner: never;
}

export interface SQLiteCursorPublicationProvisionalGeneration {
  readonly __sqliteCursorPublicationProvisionalGeneration: never;
}

export interface SQLiteCursorPublicationTransactionBeginReceipt {
  readonly __sqliteCursorPublicationTransactionBeginReceipt: never;
}

export interface SQLiteCursorPublicationTransactionFailureCapture {
  readonly __sqliteCursorPublicationTransactionFailureCapture: never;
}

export interface SQLiteCursorPublicationTransactionBeginReceiptSnapshot {
  readonly exactOwner: true;
  readonly exactConnection: true;
  readonly exactTransactionLineage: true;
  readonly exactProvisionalGeneration: true;
  readonly exclusiveMode: true;
  readonly transactionEpoch: bigint;
  readonly totalChanges: number;
  readonly tempMutationEpoch: bigint;
  readonly beginAttempt: 1;
}

export type SQLiteCursorPublicationTransactionOwnerLifecycle =
  | "registered"
  | "beginning"
  | "active"
  | "begin-postflight-in-doubt"
  | "begin-in-doubt"
  | "failure-claimed"
  | "rolling-back"
  | "rolled-back"
  | "rollback-failed"
  | "rollback-in-doubt"
  | "closing"
  | "awaiting-reopen"
  | "reopen-verified-v1"
  | "reopen-unavailable"
  | "corrupt"
  | "finalized";

export interface SQLiteCursorPublicationTransactionOwnerSnapshot {
  readonly schemaVersion: 1;
  readonly contractId: typeof CONTRACT_ID;
  readonly contractFixtureCanonicalSha256: typeof CONTRACT_FIXTURE_SHA256;
  readonly lifecycle: SQLiteCursorPublicationTransactionOwnerLifecycle;
  readonly registrationCount: 1;
  readonly provisionalGenerationMintCount: 1;
  readonly provisionalGenerationPromotionCount: 0 | 1;
  readonly provisionalGenerationTombstoneCount: 0 | 1;
  readonly beginAttemptCount: 0 | 1;
  readonly beginNativeReturnCount: 0 | 1;
  readonly beginReceiptMintCount: 0 | 1;
  readonly rollbackAttemptCount: 0 | 1;
  readonly rollbackNativeReturnCount: 0 | 1;
  readonly closeAttemptCount: 0 | 1;
  readonly closeNativeReturnCount: 0 | 1;
  readonly reopenAttemptCount: 0 | 1;
  readonly reopenSourceV1Count: 0 | 1;
  readonly runtimeTransactionControlCount: 0 | 1 | 2;
  readonly commitAttemptCount: 0;
  readonly commitHardDisabled: true;
  readonly guardRejectionCount: number;
  readonly rejectedGuardPaths: readonly SQLiteCursorPublicationTransactionGuardPath[];
  readonly diagnosticCodes: readonly (
    | "GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY"
    | "GE_SQLITE_TX_OWNER_ROLLBACK_SECONDARY"
    | "GE_SQLITE_TX_OWNER_CLOSE_TERTIARY"
    | "GE_SQLITE_TX_OWNER_REOPEN_AUDIT"
  )[];
  readonly hasLiveProvisionalGeneration: boolean;
  readonly hasExactTransactionLineage: boolean;
  readonly hasExactTransactionGeneration: boolean;
  readonly exclusiveMode: boolean;
  readonly transactionEpoch: bigint;
  readonly totalChanges: number;
  readonly tempMutationEpoch: bigint;
  readonly transactionEpochAdvancedExactlyOnceByOwnerBegin: boolean;
  readonly totalChangesUnchangedByOwnerBegin: boolean;
  readonly tempMutationEpochUnchangedByOwnerBegin: boolean;
  readonly claims: Readonly<{
    readonly runtimeOwnerImplementation: true;
    readonly runtimeBeginExecution: true;
    readonly runtimeReturnedFailureCleanup: true;
    readonly driverNativeRollbackThrow: false;
    readonly driverNativeCloseThrow: false;
    readonly runtimeCommitExecution: false;
    readonly driverNativeBeginThrow: false;
    readonly crashReopenRecovery: false;
    readonly publicApi: false;
  }>;
}

interface OwnerState {
  readonly owner: WeakRef<object>;
  connection: SQLiteConnection | null;
  reopenCapability: SQLiteConnectionPublicationReopenCapability | null;
  readonly sourceFingerprint: string;
  provisionalGeneration: SQLiteCursorPublicationProvisionalGeneration | null;
  attemptedTransactionLineage: SQLiteConnectionTransactionLineage | null;
  transactionLineage: SQLiteConnectionTransactionLineage | null;
  transactionGeneration: object | null;
  transactionMode: SQLiteTransactionMode | null;
  transactionEpoch: bigint;
  totalChanges: number;
  tempMutationEpoch: bigint;
  readonly initialTransactionEpoch: bigint;
  readonly initialTotalChanges: number;
  readonly initialTempMutationEpoch: bigint;
  beginPostflightValid: boolean;
  lifecycle: SQLiteCursorPublicationTransactionOwnerLifecycle;
  provisionalGenerationPromotionCount: 0 | 1;
  provisionalGenerationTombstoneCount: 0 | 1;
  beginAttemptCount: 0 | 1;
  beginNativeReturnCount: 0 | 1;
  beginReceiptMintCount: 0 | 1;
  rollbackAttemptCount: 0 | 1;
  rollbackNativeReturnCount: 0 | 1;
  closeAttemptCount: 0 | 1;
  closeNativeReturnCount: 0 | 1;
  reopenAttemptCount: 0 | 1;
  reopenSourceV1Count: 0 | 1;
  runtimeTransactionControlCount: 0 | 1 | 2;
  readonly rejectedGuardPaths: Set<SQLiteCursorPublicationTransactionGuardPath>;
  guardRejectionCount: number;
  primary: object | undefined;
  beginReceipt: WeakRef<object> | undefined;
  readonly diagnosticCodes: (
    | "GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY"
    | "GE_SQLITE_TX_OWNER_ROLLBACK_SECONDARY"
    | "GE_SQLITE_TX_OWNER_CLOSE_TERTIARY"
    | "GE_SQLITE_TX_OWNER_REOPEN_AUDIT"
  )[];
}

interface BeginReceiptState {
  readonly owner: WeakRef<object>;
  readonly connection: WeakRef<object>;
  readonly transactionLineage: WeakRef<object>;
  readonly provisionalGeneration: WeakRef<object>;
  readonly transactionEpoch: bigint;
  readonly totalChanges: number;
  readonly tempMutationEpoch: bigint;
}

interface FailureCaptureState {
  readonly state: OwnerState;
  readonly owner: object;
  readonly primary: object;
}

const OWNER_STATES = new WeakMap<object, OwnerState>();
const CONNECTION_STATES = new WeakMap<object, WeakRef<OwnerState>>();
const BEGIN_RECEIPTS = new WeakMap<object, BeginReceiptState>();
const FAILURE_CAPTURES = new WeakMap<object, FailureCaptureState>();
let beginAfterNativeReturnFaultForTest: object | undefined;
let closeAfterNativeReturnFaultForTest: object | undefined;

function ownerError(
  code: SQLiteCursorPublicationTransactionOwnerErrorCode,
  message: string,
  options: ErrorOptions & Readonly<{
    readonly guardPath?: SQLiteCursorPublicationTransactionGuardPath;
  }> = {},
): never {
  throw new SQLiteCursorPublicationTransactionOwnerError(code, message, options);
}

function stateForOwner(owner: SQLiteCursorPublicationTransactionOwner): OwnerState {
  if (owner === null || typeof owner !== "object" || isProxy(owner)) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_AUTHORITY", "transaction owner is invalid");
  }
  const state = reflectApplyIntrinsic(weakMapGetIntrinsic, OWNER_STATES, [owner as object]) as
    OwnerState | undefined;
  const selected = state === undefined
    ? undefined
    : reflectApplyIntrinsic(weakRefDerefIntrinsic, state.owner, []) as object | undefined;
  if (state === undefined || selected !== owner) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_AUTHORITY", "transaction owner is stale");
  }
  return state;
}

function firstToken(sql: string): string {
  const match = /^(?:(?:\s|;)+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*([A-Za-z]+)/u.exec(sql);
  return match?.[1]?.toUpperCase() ?? "";
}

function guardPath(
  state: OwnerState,
  route: SQLiteConnectionPublicationTransactionGuardRoute,
  sql: string | null,
): SQLiteCursorPublicationTransactionGuardPath | null {
  if (route === "connection-commit") return "connection-commit-method";
  if (route === "connection-rollback") return "connection-rollback-method";
  if (route === "close") return "close-live-guarded-transaction";
  if (route === "immediate") return "script-containing-implicit-or-explicit-transaction-control";
  if (sql === null) return "any-other-permanent-state-mutation-or-transaction-proof-history-change";
  const token = firstToken(sql);
  if ((route === "prepare" || route === "prepared-execute") && token === "SELECT") return null;
  if (route === "exec" && /;[\s\S]*\b(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/iu.test(sql)) {
    return "multi-statement-exec-containing-transaction-control";
  }
  if (route === "prepare" && ["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"]
    .includes(token)) return "prepared-statement-containing-transaction-control";
  if (token === "COMMIT" || token === "END") return "execute-COMMIT-or-END";
  if (token === "ROLLBACK" && /\bTO\b/iu.test(sql)) {
    return "execute-SAVEPOINT-or-RELEASE-or-ROLLBACK-TO";
  }
  if (token === "ROLLBACK") return "execute-ROLLBACK";
  if (token === "BEGIN") return state.lifecycle === "active" ? "nested-BEGIN" : "execute-BEGIN";
  if (token === "SAVEPOINT" || token === "RELEASE") {
    return "execute-SAVEPOINT-or-RELEASE-or-ROLLBACK-TO";
  }
  if (token === "PRAGMA") return "persistent-PRAGMA-including-user-version-or-application-id";
  if (token === "VACUUM" || token === "ANALYZE" || token === "REINDEX") {
    return "VACUUM-ANALYZE-or-REINDEX";
  }
  if (token === "ATTACH" || token === "DETACH") {
    return "ATTACH-DETACH-or-connection-topology-change";
  }
  const existing = route === "prepared-execute";
  if (["INSERT", "UPDATE", "DELETE", "REPLACE"].includes(token)) {
    return existing
      ? "already-prepared-permanent-DML-after-pre-retirement"
      : "newly-prepared-permanent-DML-after-pre-retirement";
  }
  if (["ALTER", "CREATE", "DROP"].includes(token)) {
    return existing
      ? "already-prepared-permanent-DDL-after-pre-retirement"
      : "newly-prepared-permanent-DDL-after-pre-retirement";
  }
  return "any-other-permanent-state-mutation-or-transaction-proof-history-change";
}

function checkConnectionGuard(
  connection: SQLiteConnection,
  route: SQLiteConnectionPublicationTransactionGuardRoute,
  sql: string | null,
): void {
  const stateReference = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    CONNECTION_STATES,
    [connection],
  ) as WeakRef<OwnerState> | undefined;
  const state = stateReference === undefined ? undefined
    : reflectApplyIntrinsic(weakRefDerefIntrinsic, stateReference, []) as OwnerState | undefined;
  if (state === undefined) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "transaction guard lost its owner state");
  }
  const path = guardPath(state, route, sql);
  if (path === null) return;
  state.guardRejectionCount += 1;
  state.rejectedGuardPaths.add(path);
  ownerError("GE_SQLITE_TX_OWNER_GUARD_REJECTED", "guarded transaction route is forbidden", {
    guardPath: path,
  });
}

const CONNECTION_GUARD = objectFreezeIntrinsic(Object.assign(
  objectCreateIntrinsic(null) as object,
  { check: checkConnectionGuard },
)) as SQLiteConnectionPublicationTransactionGuard;

function tombstoneProvisional(state: OwnerState): void {
  if (state.provisionalGeneration !== null) {
    state.provisionalGeneration = null;
    state.provisionalGenerationTombstoneCount = 1;
  }
}

function captureConnectionSnapshot(state: OwnerState): void {
  const connection = state.connection;
  if (connection === null) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "transaction connection is terminal");
  }
  const owner = readSQLiteConnectionOwnerSnapshot(connection);
  const total = readSQLiteConnectionTotalChangesSnapshot(connection);
  state.transactionLineage = owner.transactionLineage;
  state.transactionGeneration = owner.publicationTransactionGeneration;
  state.transactionMode = owner.transactionMode;
  state.transactionEpoch = owner.transactionEpoch;
  state.totalChanges = total.totalChanges;
  state.tempMutationEpoch = owner.tempMutationEpoch;
}

function auditReopenedSourceV1(state: OwnerState, primary: object): void {
  const connection = state.connection;
  const capability = state.reopenCapability;
  const owner = reflectApplyIntrinsic(weakRefDerefIntrinsic, state.owner, []) as object | undefined;
  if (connection === null || capability === null || owner === undefined) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "reopen capability is terminal");
  }
  state.lifecycle = "awaiting-reopen";
  state.reopenAttemptCount = 1;
  let reopenedFingerprint: string;
  try {
    reopenedFingerprint = consumeSQLiteConnectionPublicationReopenCapabilityIntrinsic(
      capability,
      owner,
      connection,
    );
  } catch (error) {
    const codeDescriptor = error !== null && typeof error === "object" && !isProxy(error)
      && objectGetPrototypeOfIntrinsic(error) === cycleStoreProviderErrorPrototypeIntrinsic
      ? objectGetOwnPropertyDescriptorIntrinsic(error, "code")
      : undefined;
    const corrupt = codeDescriptor !== undefined && "value" in codeDescriptor
      && codeDescriptor.value === "GE_CYCLE_STORE_CORRUPTION";
    state.lifecycle = corrupt ? "corrupt" : "reopen-unavailable";
    state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_REOPEN_AUDIT");
    ownerError(
      corrupt
        ? "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
        : "GE_SQLITE_TX_OWNER_REOPEN_UNAVAILABLE",
      corrupt
        ? "reopened database is not exact source-v1"
        : "exact source-v1 database could not be reopened",
      { cause: new AggregateError([primary, error], "primary plus reopen audit") },
    );
  }
  if (reopenedFingerprint !== state.sourceFingerprint) {
    state.lifecycle = "corrupt";
    state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_REOPEN_AUDIT");
    ownerError(
      "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION",
      "reopened source-v1 fingerprint drifted",
      { cause: new AggregateError([primary], "primary plus reopen audit") },
    );
  }
  state.reopenSourceV1Count = 1;
  state.lifecycle = "reopen-verified-v1";
}

function closeOwnedConnection(state: OwnerState, owner: object): void {
  const connection = state.connection;
  if (connection === null) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "transaction connection is terminal");
  }
  state.lifecycle = "closing";
  state.closeAttemptCount = 1;
  try {
    closeSQLiteConnectionPublicationTransactionOwnerIntrinsic(connection, owner);
    state.closeNativeReturnCount = 1;
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, CONNECTION_STATES, [connection]);
    if (closeAfterNativeReturnFaultForTest !== undefined) {
      const injected = closeAfterNativeReturnFaultForTest;
      closeAfterNativeReturnFaultForTest = undefined;
      throw injected;
    }
  } catch {
    state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_CLOSE_TERTIARY");
  }
}

function retireBeginReceipt(state: OwnerState): void {
  const receipt = state.beginReceipt === undefined
    ? undefined
    : reflectApplyIntrinsic(weakRefDerefIntrinsic, state.beginReceipt, []) as object | undefined;
  if (receipt !== undefined) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, BEGIN_RECEIPTS, [receipt]);
  }
  state.beginReceipt = undefined;
}

function terminalize(state: OwnerState): void {
  retireBeginReceipt(state);
  if (state.connection !== null) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, CONNECTION_STATES, [state.connection]);
  }
  const owner = reflectApplyIntrinsic(weakRefDerefIntrinsic, state.owner, []) as object | undefined;
  if (state.reopenCapability !== null && owner !== undefined) {
    try {
      revokeSQLiteConnectionPublicationReopenCapabilityIntrinsic(state.reopenCapability, owner);
    } catch {
      // Clearing the only retained capability still makes its WeakMap entry
      // collectible; terminal cleanup must never replace the primary error.
    }
  }
  state.connection = null;
  state.reopenCapability = null;
  state.provisionalGeneration = null;
  state.attemptedTransactionLineage = null;
  state.transactionLineage = null;
  state.transactionGeneration = null;
  state.transactionMode = null;
  state.primary = undefined;
  state.lifecycle = "finalized";
}

/** Register one exact owner and provisional generation before any BEGIN I/O. */
export function registerSQLiteCursorPublicationTransactionOwnerIntrinsic(
  connection: SQLiteConnection,
): SQLiteCursorPublicationTransactionOwner {
  const before = readSQLiteConnectionOwnerSnapshot(connection);
  const total = readSQLiteConnectionTotalChangesSnapshot(connection);
  if (before.isTransaction || before.transactionLineage !== null || before.transactionMode !== null
      || before.transactionEpoch !== total.transactionEpoch) {
    return ownerError(
      "GE_SQLITE_TX_OWNER_INVALID_STATE",
      "transaction owner registration requires one open autocommit connection",
    );
  }
  const owner = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorPublicationTransactionOwner;
  const provisional = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorPublicationProvisionalGeneration;
  const attemptedLineage = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteConnectionTransactionLineage;
  const sourceFingerprint = auditSQLiteConnectionPublicationSourceV1Intrinsic(connection);
  const reopenCapability = registerSQLiteConnectionPublicationTransactionOwnerIntrinsic(
    connection,
    owner as object,
    CONNECTION_GUARD,
  );
  const state: OwnerState = {
    owner: new weakRefIntrinsic(owner as object),
    connection,
    reopenCapability,
    sourceFingerprint,
    provisionalGeneration: provisional,
    attemptedTransactionLineage: attemptedLineage,
    transactionLineage: null,
    transactionGeneration: null,
    transactionMode: null,
    transactionEpoch: before.transactionEpoch,
    totalChanges: total.totalChanges,
    tempMutationEpoch: before.tempMutationEpoch,
    initialTransactionEpoch: before.transactionEpoch,
    initialTotalChanges: total.totalChanges,
    initialTempMutationEpoch: before.tempMutationEpoch,
    beginPostflightValid: false,
    lifecycle: "registered",
    provisionalGenerationPromotionCount: 0,
    provisionalGenerationTombstoneCount: 0,
    beginAttemptCount: 0,
    beginNativeReturnCount: 0,
    beginReceiptMintCount: 0,
    rollbackAttemptCount: 0,
    rollbackNativeReturnCount: 0,
    closeAttemptCount: 0,
    closeNativeReturnCount: 0,
    reopenAttemptCount: 0,
    reopenSourceV1Count: 0,
    runtimeTransactionControlCount: 0,
    rejectedGuardPaths: new Set(),
    guardRejectionCount: 0,
    primary: undefined,
    beginReceipt: undefined,
    diagnosticCodes: [],
  };
  reflectApplyIntrinsic(weakMapSetIntrinsic, OWNER_STATES, [owner as object, state]);
  reflectApplyIntrinsic(weakMapSetIntrinsic, CONNECTION_STATES, [
    connection,
    new weakRefIntrinsic(state),
  ]);
  return owner;
}

/** Attempt exactly one owner-controlled BEGIN EXCLUSIVE and mint its exact receipt. */
export function beginSQLiteCursorPublicationTransactionOwnerIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
): SQLiteCursorPublicationTransactionBeginReceipt {
  const state = stateForOwner(owner);
  if (state.lifecycle !== "registered" || state.beginAttemptCount !== 0
      || state.provisionalGeneration === null) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "BEGIN owner is not registered");
  }
  state.lifecycle = "beginning";
  state.beginAttemptCount = 1;
  state.runtimeTransactionControlCount = 1;
  const connection = state.connection;
  const generation = state.provisionalGeneration;
  const attemptedLineage = state.attemptedTransactionLineage;
  if (connection === null || generation === null || attemptedLineage === null) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "BEGIN connection is terminal");
  }
  try {
    executeSQLiteConnectionPublicationTransactionOwnerControlIntrinsic(
      connection,
      owner as object,
      "begin-exclusive",
      attemptedLineage,
      generation,
    );
    state.beginNativeReturnCount = 1;
    if (beginAfterNativeReturnFaultForTest !== undefined) {
      const injected = beginAfterNativeReturnFaultForTest;
      beginAfterNativeReturnFaultForTest = undefined;
      throw injected;
    }
    captureConnectionSnapshot(state);
  } catch (primary) {
    const primaryObject = primary !== null && typeof primary === "object"
      ? primary as object
      : new SQLiteCursorPublicationTransactionOwnerError(
        "GE_SQLITE_TX_OWNER_INVALID_STATE",
        "native BEGIN threw a non-object primary",
        { cause: primary },
      );
    state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY");
    let exactActive = false;
    try {
      captureConnectionSnapshot(state);
      exactActive = state.transactionLineage === attemptedLineage
        && state.transactionGeneration === generation
        && state.transactionMode === "exclusive"
        && state.transactionEpoch === state.initialTransactionEpoch + 1n
        && state.tempMutationEpoch === state.initialTempMutationEpoch
        && state.totalChanges === state.initialTotalChanges;
      if (exactActive) state.beginPostflightValid = true;
    } catch {
      // Observation unavailable is deliberately not rollback authority.
    }
    tombstoneProvisional(state);
    if (exactActive) {
      state.lifecycle = "rolling-back";
      state.rollbackAttemptCount = 1;
      state.runtimeTransactionControlCount = 2;
      try {
        executeSQLiteConnectionPublicationTransactionOwnerControlIntrinsic(
          connection,
          owner as object,
          "rollback",
          attemptedLineage,
          generation,
        );
        state.rollbackNativeReturnCount = 1;
        state.lifecycle = "rolled-back";
        captureConnectionSnapshot(state);
      } catch {
        state.lifecycle = "rollback-in-doubt";
        state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_ROLLBACK_SECONDARY");
      }
    } else {
      state.lifecycle = "begin-in-doubt";
    }
    closeOwnedConnection(state, owner as object);
    try {
      auditReopenedSourceV1(state, primaryObject);
    } catch (error) {
      terminalize(state);
      throw error;
    }
    terminalize(state);
    throw primary;
  }
  if (state.transactionLineage !== attemptedLineage
      || state.transactionGeneration !== generation || state.transactionMode !== "exclusive"
      || state.transactionEpoch !== state.initialTransactionEpoch + 1n
      || state.tempMutationEpoch !== state.initialTempMutationEpoch
      || state.totalChanges !== state.initialTotalChanges) {
    const primary = new SQLiteCursorPublicationTransactionOwnerError(
      "GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT",
      "BEGIN returned without the exact exclusive owner postflight",
    );
    state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY");
    tombstoneProvisional(state);
    state.lifecycle = "begin-postflight-in-doubt";
    closeOwnedConnection(state, owner as object);
    try {
      auditReopenedSourceV1(state, primary);
    } catch (error) {
      terminalize(state);
      throw error;
    }
    terminalize(state);
    throw primary;
  }
  let sourcePostflightPrimary: SQLiteCursorPublicationTransactionOwnerError | undefined;
  try {
    const postBeginSourceFingerprint =
      auditSQLiteConnectionPublicationSourceV1Intrinsic(connection);
    if (postBeginSourceFingerprint !== state.sourceFingerprint) {
      sourcePostflightPrimary = new SQLiteCursorPublicationTransactionOwnerError(
        "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION",
        "source-v1 changed between registration and exact BEGIN",
      );
    }
  } catch (cause) {
    sourcePostflightPrimary = new SQLiteCursorPublicationTransactionOwnerError(
      "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION",
      "source-v1 could not be re-proven after exact BEGIN",
      { cause },
    );
  }
  if (sourcePostflightPrimary !== undefined) {
    state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY");
    tombstoneProvisional(state);
    state.lifecycle = "rolling-back";
    state.rollbackAttemptCount = 1;
    state.runtimeTransactionControlCount = 2;
    try {
      executeSQLiteConnectionPublicationTransactionOwnerControlIntrinsic(
        connection,
        owner as object,
        "rollback",
        attemptedLineage,
        generation,
      );
      state.rollbackNativeReturnCount = 1;
      state.lifecycle = "rolled-back";
      captureConnectionSnapshot(state);
    } catch {
      state.lifecycle = "rollback-in-doubt";
      state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_ROLLBACK_SECONDARY");
    }
    closeOwnedConnection(state, owner as object);
    try {
      auditReopenedSourceV1(state, sourcePostflightPrimary);
    } catch (error) {
      terminalize(state);
      throw error;
    }
    terminalize(state);
    throw sourcePostflightPrimary;
  }
  state.provisionalGenerationPromotionCount = 1;
  state.beginPostflightValid = true;
  state.beginReceiptMintCount = 1;
  state.lifecycle = "active";
  const receipt = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorPublicationTransactionBeginReceipt;
  const lineage = state.transactionLineage;
  if (lineage === null || generation === null) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "BEGIN receipt graph is incomplete");
  }
  reflectApplyIntrinsic(weakMapSetIntrinsic, BEGIN_RECEIPTS, [receipt as object, {
    owner: new weakRefIntrinsic(owner as object),
    connection: new weakRefIntrinsic(connection),
    transactionLineage: new weakRefIntrinsic(lineage as object),
    provisionalGeneration: new weakRefIntrinsic(generation as object),
    transactionEpoch: state.transactionEpoch,
    totalChanges: state.totalChanges,
    tempMutationEpoch: state.tempMutationEpoch,
  } satisfies BeginReceiptState]);
  state.beginReceipt = new weakRefIntrinsic(receipt as object);
  return receipt;
}

/** Validate and read the exact live BEGIN receipt provenance graph. */
export function readSQLiteCursorPublicationTransactionBeginReceiptIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
  receipt: SQLiteCursorPublicationTransactionBeginReceipt,
): SQLiteCursorPublicationTransactionBeginReceiptSnapshot {
  const state = stateForOwner(owner);
  if (receipt === null || typeof receipt !== "object" || isProxy(receipt)
      || state.lifecycle !== "active") {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_AUTHORITY", "BEGIN receipt is invalid");
  }
  const receiptState = reflectApplyIntrinsic(weakMapGetIntrinsic, BEGIN_RECEIPTS, [
    receipt as object,
  ]) as BeginReceiptState | undefined;
  const selectedOwner = receiptState === undefined ? undefined
    : reflectApplyIntrinsic(weakRefDerefIntrinsic, receiptState.owner, []) as object | undefined;
  const connection = receiptState === undefined ? undefined
    : reflectApplyIntrinsic(weakRefDerefIntrinsic, receiptState.connection, []) as
      SQLiteConnection | undefined;
  const lineage = receiptState === undefined ? undefined
    : reflectApplyIntrinsic(weakRefDerefIntrinsic, receiptState.transactionLineage, []) as
      SQLiteConnectionTransactionLineage | undefined;
  const generation = receiptState === undefined ? undefined
    : reflectApplyIntrinsic(weakRefDerefIntrinsic, receiptState.provisionalGeneration, []) as
      SQLiteCursorPublicationProvisionalGeneration | undefined;
  if (receiptState === undefined || selectedOwner !== owner || connection !== state.connection
      || lineage !== state.transactionLineage || generation !== state.provisionalGeneration
      || generation !== state.transactionGeneration
      || receiptState.transactionEpoch !== state.transactionEpoch
      || receiptState.totalChanges !== state.totalChanges) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_AUTHORITY", "BEGIN receipt is stale");
  }
  return objectFreezeIntrinsic({
    exactOwner: true,
    exactConnection: true,
    exactTransactionLineage: true,
    exactProvisionalGeneration: true,
    exclusiveMode: true,
    transactionEpoch: receiptState.transactionEpoch,
    totalChanges: receiptState.totalChanges,
    tempMutationEpoch: receiptState.tempMutationEpoch,
    beginAttempt: 1,
  });
}

/** One-shot after-native-return fault seam; it does not claim a driver-native throw. */
export function injectSQLiteCursorPublicationBeginAfterNativeReturnFaultForTestIntrinsic(
  error: object,
): void {
  if (error === null || typeof error !== "object" || isProxy(error)
      || beginAfterNativeReturnFaultForTest !== undefined) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "BEGIN fault seam is invalid");
  }
  beginAfterNativeReturnFaultForTest = error;
}

/** One-shot after-native-close-return fault seam; reopen must still run. */
export function injectSQLiteCursorPublicationCloseAfterNativeReturnFaultForTestIntrinsic(
  error: object,
): void {
  if (error === null || typeof error !== "object" || isProxy(error)
      || closeAfterNativeReturnFaultForTest !== undefined) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "close fault seam is invalid");
  }
  closeAfterNativeReturnFaultForTest = error;
}

/** Test-only view of the opaque lower-owned capability; it exposes no path or callback. */
export function readSQLiteCursorPublicationReopenCapabilityForTestIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
): SQLiteConnectionPublicationReopenCapability {
  const state = stateForOwner(owner);
  if (state.reopenCapability === null) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "reopen capability is terminal");
  }
  return state.reopenCapability;
}

/** Test-only exact-identity consume route for clone/substitution/cross-owner proofs. */
export function auditSQLiteCursorPublicationReopenCapabilityForTestIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
  capability: SQLiteConnectionPublicationReopenCapability,
): string {
  const state = stateForOwner(owner);
  if (state.connection === null) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "reopen connection is terminal");
  }
  return consumeSQLiteConnectionPublicationReopenCapabilityIntrinsic(
    capability,
    owner as object,
    state.connection,
  );
}

/** Capture one exact active-owner terminal primary before cleanup authority exists. */
export function captureSQLiteCursorPublicationTransactionFailureIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
  primary: object,
): SQLiteCursorPublicationTransactionFailureCapture {
  const state = stateForOwner(owner);
  if (state.lifecycle !== "active" || primary === null || typeof primary !== "object"
      || isProxy(primary) || state.primary !== undefined) {
    return ownerError(
      "GE_SQLITE_TX_OWNER_INVALID_AUTHORITY",
      "active transaction failure primary is invalid",
    );
  }
  state.lifecycle = "failure-claimed";
  state.primary = primary;
  state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_TERMINAL_PRIMARY");
  retireBeginReceipt(state);
  const capture = objectFreezeIntrinsic(objectCreateIntrinsic(null)) as
    SQLiteCursorPublicationTransactionFailureCapture;
  reflectApplyIntrinsic(weakMapSetIntrinsic, FAILURE_CAPTURES, [capture as object, {
    state,
    owner: owner as object,
    primary,
  } satisfies FailureCaptureState]);
  return capture;
}

/** Roll back, close, and independently prove source-v1 while preserving the exact primary. */
export function finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(
  capture: SQLiteCursorPublicationTransactionFailureCapture,
): never {
  if (capture === null || typeof capture !== "object" || isProxy(capture)) {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_AUTHORITY", "failure capture is invalid");
  }
  const captureState = reflectApplyIntrinsic(
    weakMapGetIntrinsic,
    FAILURE_CAPTURES,
    [capture as object],
  ) as FailureCaptureState | undefined;
  const state = captureState?.state;
  const owner = captureState?.owner;
  const primary = captureState?.primary;
  if (state === undefined || owner === undefined || primary === undefined
      || state.primary !== primary
      || state.lifecycle !== "failure-claimed") {
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_AUTHORITY", "failure capture is stale");
  }
  state.lifecycle = "rolling-back";
  state.rollbackAttemptCount = 1;
  state.runtimeTransactionControlCount = 2;
  const connection = state.connection;
  const generation = state.provisionalGeneration;
  const attemptedLineage = state.attemptedTransactionLineage;
  if (connection === null || generation === null || attemptedLineage === null) {
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, FAILURE_CAPTURES, [capture as object]);
    terminalize(state);
    return ownerError("GE_SQLITE_TX_OWNER_INVALID_STATE", "failure connection is terminal");
  }
  try {
    executeSQLiteConnectionPublicationTransactionOwnerControlIntrinsic(
      connection,
      owner,
      "rollback",
      attemptedLineage,
      generation,
    );
    state.rollbackNativeReturnCount = 1;
    state.lifecycle = "rolled-back";
    captureConnectionSnapshot(state);
  } catch {
    state.lifecycle = "rollback-failed";
    state.diagnosticCodes.push("GE_SQLITE_TX_OWNER_ROLLBACK_SECONDARY");
    try {
      const observed = readSQLiteConnectionOwnerSnapshot(connection);
      if (observed.isTransaction) state.lifecycle = "rollback-in-doubt";
    } catch {
      state.lifecycle = "rollback-in-doubt";
    }
  }
  closeOwnedConnection(state, owner);
  let reopenFailure: unknown;
  let reopenFailed = false;
  try {
    auditReopenedSourceV1(state, primary);
  } catch (error) {
    reopenFailure = error;
    reopenFailed = true;
  } finally {
    // The opaque capture is authority, not evidence.  Revoke it on every
    // terminal path before dropping the last live owner graph from state.
    reflectApplyIntrinsic(weakMapDeleteIntrinsic, FAILURE_CAPTURES, [capture as object]);
    terminalize(state);
  }
  if (reopenFailed) throw reopenFailure;
  throw primary;
}

/** COMMIT is deliberately unreachable until the complete final-fence graph exists. */
export function commitSQLiteCursorPublicationTransactionOwnerIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
  _unsupportedFinalFence: unknown,
): never {
  stateForOwner(owner);
  return ownerError(
    "GE_SQLITE_TX_OWNER_COMMIT_DISABLED",
    "publication COMMIT is hard-disabled before the final fence exists",
  );
}

/** Read package-private evidence without exposing a public transaction owner. */
export function readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
): SQLiteCursorPublicationTransactionOwnerSnapshot {
  const state = stateForOwner(owner);
  return objectFreezeIntrinsic({
    schemaVersion: 1,
    contractId: CONTRACT_ID,
    contractFixtureCanonicalSha256: CONTRACT_FIXTURE_SHA256,
    lifecycle: state.lifecycle,
    registrationCount: 1,
    provisionalGenerationMintCount: 1,
    provisionalGenerationPromotionCount: state.provisionalGenerationPromotionCount,
    provisionalGenerationTombstoneCount: state.provisionalGenerationTombstoneCount,
    beginAttemptCount: state.beginAttemptCount,
    beginNativeReturnCount: state.beginNativeReturnCount,
    beginReceiptMintCount: state.beginReceiptMintCount,
    rollbackAttemptCount: state.rollbackAttemptCount,
    rollbackNativeReturnCount: state.rollbackNativeReturnCount,
    closeAttemptCount: state.closeAttemptCount,
    closeNativeReturnCount: state.closeNativeReturnCount,
    reopenAttemptCount: state.reopenAttemptCount,
    reopenSourceV1Count: state.reopenSourceV1Count,
    runtimeTransactionControlCount: state.runtimeTransactionControlCount,
    commitAttemptCount: 0,
    commitHardDisabled: true,
    guardRejectionCount: state.guardRejectionCount,
    rejectedGuardPaths: objectFreezeIntrinsic([...state.rejectedGuardPaths]),
    diagnosticCodes: objectFreezeIntrinsic([...state.diagnosticCodes]),
    hasLiveProvisionalGeneration: state.provisionalGeneration !== null,
    hasExactTransactionLineage: state.transactionLineage !== null
      && state.transactionLineage === state.attemptedTransactionLineage,
    hasExactTransactionGeneration: state.transactionGeneration !== null
      && state.transactionGeneration === state.provisionalGeneration,
    exclusiveMode: state.transactionMode === "exclusive",
    transactionEpoch: state.transactionEpoch,
    totalChanges: state.totalChanges,
    tempMutationEpoch: state.tempMutationEpoch,
    transactionEpochAdvancedExactlyOnceByOwnerBegin: state.beginPostflightValid,
    totalChangesUnchangedByOwnerBegin: state.beginPostflightValid,
    tempMutationEpochUnchangedByOwnerBegin: state.beginPostflightValid,
    claims: objectFreezeIntrinsic({
      runtimeOwnerImplementation: true,
      runtimeBeginExecution: true,
      runtimeReturnedFailureCleanup: true,
      driverNativeRollbackThrow: false,
      driverNativeCloseThrow: false,
      runtimeCommitExecution: false,
      driverNativeBeginThrow: false,
      crashReopenRecovery: false,
      publicApi: false,
    }),
  });
}
