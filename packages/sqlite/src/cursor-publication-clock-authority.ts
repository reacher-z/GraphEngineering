import { CycleStoreProviderError } from "@graph-engineering/runtime";

import { sqliteRow, sqliteSafeInteger, sqliteText } from "./sqlite-codec.js";
import {
  SQLiteConnection,
  type SQLiteConnectionTransactionLineage,
  prepareSQLiteConnectionIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
} from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

export const SQLITE_CURSOR_CLOCK_BOUNDARIES = Object.freeze([
  "before-first-permanent-mutation",
  "before-cursor-rebind",
  "before-verification",
  "before-commit",
] as const);

export type SQLiteCursorClockBoundary = typeof SQLITE_CURSOR_CLOCK_BOUNDARIES[number];

export const SQLITE_CURSOR_CLOCK_CONSUMERS = Object.freeze({
  "before-first-permanent-mutation": "outer-publication-authority",
  "before-cursor-rebind": "cursor-publication-session",
  "before-verification": "cursor-clock-capability",
  "before-commit": "final-commit-fence",
} as const satisfies Readonly<Record<SQLiteCursorClockBoundary, string>>);

export type SQLiteCursorClockConsumer =
  typeof SQLITE_CURSOR_CLOCK_CONSUMERS[SQLiteCursorClockBoundary];

export interface SQLiteCursorMigrationLockIdentity {
  readonly lockId: string;
  readonly ownerId: string;
  readonly sourceSchemaVersion: 1;
  readonly targetSchemaVersion: 2;
  readonly lockEpoch: number;
  readonly fencingToken: number;
  readonly activeExpiresAtMs: number;
}

/** Opaque package-owned source of provider time. */
export interface SQLiteCursorProviderClockSource {
  readonly __sqliteCursorProviderClockSource: never;
}

/** Opaque capability for one exact live migration-lock object graph. */
export interface SQLiteCursorMigrationLockCapability {
  readonly __sqliteCursorMigrationLockCapability: never;
}

/** Package-private authority. The package export map does not expose this module. */
export interface SQLiteCursorProviderClockCapability {
  readonly __sqliteCursorProviderClockCapability: never;
}

/** Opaque fresh provider-clock observation for one exact boundary. */
export interface SQLiteCursorProviderClockEvidence {
  readonly __sqliteCursorProviderClockEvidence: never;
}

/** Opaque proof that the intended owner consumed one evidence receipt once. */
export interface SQLiteCursorProviderClockConsumedTombstone {
  readonly __sqliteCursorProviderClockConsumedTombstone: never;
}

export interface SQLiteCursorProviderClockEvidenceSnapshot {
  readonly boundary: SQLiteCursorClockBoundary;
  readonly consumer: SQLiteCursorClockConsumer;
  readonly providerNowMs: number;
  readonly activeExpiresAtMs: number;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  readonly transactionEpoch: bigint;
}

interface MigrationLockCapabilityState {
  readonly connection: SQLiteConnection;
  readonly expectedLock: Readonly<SQLiteCursorMigrationLockIdentity>;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
}

interface CapabilityState {
  readonly connection: SQLiteConnection;
  readonly expectedLock: Readonly<SQLiteCursorMigrationLockIdentity>;
  readonly migrationLockCapability: SQLiteCursorMigrationLockCapability;
  readonly providerClockSource: SQLiteCursorProviderClockSource;
  readonly transactionLineage: SQLiteConnectionTransactionLineage;
  nextBoundaryIndex: number;
  observing: boolean;
  poisoned: boolean;
  previousEvidence: SQLiteCursorProviderClockEvidence | undefined;
  previousProviderNowMs: number | undefined;
}

interface EvidenceState extends SQLiteCursorProviderClockEvidenceSnapshot {
  readonly capability: SQLiteCursorProviderClockCapability;
  readonly previousEvidence: SQLiteCursorProviderClockEvidence | undefined;
  consumed: boolean;
}

interface TombstoneState {
  readonly capability: SQLiteCursorProviderClockCapability;
  readonly consumer: SQLiteCursorClockConsumer;
  readonly evidence: SQLiteCursorProviderClockEvidence;
}

const CAPABILITIES = new WeakMap<object, CapabilityState>();
const CLOCK_SOURCES = new WeakMap<object, () => number>();
const EVIDENCE = new WeakMap<object, EvidenceState>();
const LOCK_CAPABILITIES = new WeakMap<object, MigrationLockCapabilityState>();
const TOMBSTONES = new WeakMap<object, TombstoneState>();
const weakMapGetIntrinsic = WeakMap.prototype.get;
const weakMapSetIntrinsic = WeakMap.prototype.set;
const objectCreateIntrinsic = Object.create;
const objectFreezeIntrinsic = Object.freeze;
const objectGetOwnPropertyDescriptorsIntrinsic = Object.getOwnPropertyDescriptors;

function fail(
  code: "GE_CYCLE_STORE_CORRUPTION" | "GE_CYCLE_STORE_INVALID_ARGUMENT"
    | "GE_CYCLE_STORE_STALE_FENCE" | "GE_CYCLE_STORE_UNAVAILABLE",
  message: string,
): never {
  throw new CycleStoreProviderError(code, OPERATION, message);
}

function positiveSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", `${label} is invalid`);
  }
  return value as number;
}

function nonnegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", `${label} is invalid`);
  }
  return value as number;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", `${label} is invalid`);
  }
  return value;
}

function checkedExpectedLock(
  value: SQLiteCursorMigrationLockIdentity,
): Readonly<SQLiteCursorMigrationLockIdentity> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "migration lock identity is invalid");
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Reflect.apply(objectGetOwnPropertyDescriptorsIntrinsic, Object, [value]) as
      PropertyDescriptorMap;
  } catch {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "migration lock identity is invalid");
  }
  const data = (key: keyof SQLiteCursorMigrationLockIdentity): unknown => {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", `migration lock ${key} is invalid`);
    }
    return descriptor.value;
  };
  const lockEpoch = positiveSafeInteger(data("lockEpoch"), "migration lock epoch");
  const fencingToken = positiveSafeInteger(data("fencingToken"), "migration fencing token");
  if (data("sourceSchemaVersion") !== 1 || data("targetSchemaVersion") !== 2
      || lockEpoch !== fencingToken) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "migration lock version/fence is invalid");
  }
  return Object.freeze({
    lockId: identifier(data("lockId"), "migration lock ID"),
    ownerId: identifier(data("ownerId"), "migration lock owner ID"),
    sourceSchemaVersion: 1 as const,
    targetSchemaVersion: 2 as const,
    lockEpoch,
    fencingToken,
    activeExpiresAtMs: nonnegativeSafeInteger(
      data("activeExpiresAtMs"),
      "migration lock expiry",
    ),
  });
}

function requireExclusiveLineage(
  connection: SQLiteConnection,
  lineage: SQLiteConnectionTransactionLineage,
): void {
  const owner = readSQLiteConnectionOwnerSnapshot(connection);
  if (!owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage !== lineage) {
    fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite cursor clock transaction lineage changed");
  }
}

function liveLock(connection: SQLiteConnection): Readonly<SQLiteCursorMigrationLockIdentity> {
  const row = sqliteRow(prepareSQLiteConnectionIntrinsic(connection, `
    SELECT active_lock_id, active_owner_id, active_source_version,
           active_target_version, active_lock_epoch, active_fencing_token,
           active_expires_at_ms
      FROM main.ge_cycle_migration_lock
     WHERE singleton = 1
  `, OPERATION).get(), 7, OPERATION, "cursor publication migration lock");
  return Object.freeze({
    lockId: sqliteText(row[0], OPERATION, "migration lock ID"),
    ownerId: sqliteText(row[1], OPERATION, "migration lock owner ID"),
    sourceSchemaVersion: sqliteSafeInteger(
      row[2], 1, 1, OPERATION, "migration source schema version",
    ) as 1,
    targetSchemaVersion: sqliteSafeInteger(
      row[3], 2, 2, OPERATION, "migration target schema version",
    ) as 2,
    lockEpoch: sqliteSafeInteger(
      row[4], 1, Number.MAX_SAFE_INTEGER, OPERATION, "migration lock epoch",
    ),
    fencingToken: sqliteSafeInteger(
      row[5], 1, Number.MAX_SAFE_INTEGER, OPERATION, "migration fencing token",
    ),
    activeExpiresAtMs: sqliteSafeInteger(
      row[6], 0, Number.MAX_SAFE_INTEGER, OPERATION, "migration lock expiry",
    ),
  });
}

function sameLock(
  actual: Readonly<SQLiteCursorMigrationLockIdentity>,
  expected: Readonly<SQLiteCursorMigrationLockIdentity>,
): boolean {
  return actual.lockId === expected.lockId
    && actual.ownerId === expected.ownerId
    && actual.sourceSchemaVersion === expected.sourceSchemaVersion
    && actual.targetSchemaVersion === expected.targetSchemaVersion
    && actual.lockEpoch === expected.lockEpoch
    && actual.fencingToken === expected.fencingToken
    && actual.activeExpiresAtMs === expected.activeExpiresAtMs;
}

function capabilityState(
  capability: SQLiteCursorProviderClockCapability,
): CapabilityState {
  const state = capability !== null && typeof capability === "object"
    ? Reflect.apply(weakMapGetIntrinsic, CAPABILITIES, [capability as object]) as
      CapabilityState | undefined
    : undefined;
  if (state === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite cursor clock capability is invalid");
  }
  return state;
}

/** Bind the provider's private clock function behind an opaque source. */
export function createSQLiteCursorProviderClockSourceIntrinsic(
  providerNow: () => number,
): SQLiteCursorProviderClockSource {
  if (typeof providerNow !== "function") {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite provider clock source is invalid");
  }
  const source = Object.freeze(Object.create(null)) as SQLiteCursorProviderClockSource;
  Reflect.apply(weakMapSetIntrinsic, CLOCK_SOURCES, [source as object, providerNow]);
  return source;
}

/** Bind one exact live lock and immutable BEGIN lineage behind an opaque capability. */
export function createSQLiteCursorMigrationLockCapabilityIntrinsic(
  connection: SQLiteConnection,
  expectedLockValue: SQLiteCursorMigrationLockIdentity,
): SQLiteCursorMigrationLockCapability {
  if (!(connection instanceof SQLiteConnection)) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite migration lock connection is invalid");
  }
  const owner = readSQLiteConnectionOwnerSnapshot(connection);
  if (!owner.isTransaction || owner.transactionMode !== "exclusive"
      || owner.transactionLineage === null) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite migration lock requires BEGIN EXCLUSIVE");
  }
  const expectedLock = checkedExpectedLock(expectedLockValue);
  if (!sameLock(liveLock(connection), expectedLock)) {
    return fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite cursor migration lock changed");
  }
  const capability = Object.freeze(Object.create(null)) as SQLiteCursorMigrationLockCapability;
  Reflect.apply(weakMapSetIntrinsic, LOCK_CAPABILITIES, [capability as object, Object.freeze({
    connection,
    expectedLock,
    transactionLineage: owner.transactionLineage,
  } satisfies MigrationLockCapabilityState)]);
  return capability;
}

/**
 * Mint the package-private four-boundary clock capability. This performs no
 * permanent mutation and accepts only exact module-minted source/lock objects.
 */
export function createSQLiteCursorProviderClockCapabilityIntrinsic(
  connection: SQLiteConnection,
  migrationLockCapability: SQLiteCursorMigrationLockCapability,
  providerClockSource: SQLiteCursorProviderClockSource,
): SQLiteCursorProviderClockCapability {
  const lockState = migrationLockCapability !== null
      && typeof migrationLockCapability === "object"
    ? Reflect.apply(weakMapGetIntrinsic, LOCK_CAPABILITIES, [
      migrationLockCapability as object,
    ]) as MigrationLockCapabilityState | undefined
    : undefined;
  const providerNow = providerClockSource !== null && typeof providerClockSource === "object"
    ? Reflect.apply(weakMapGetIntrinsic, CLOCK_SOURCES, [providerClockSource as object]) as
      (() => number) | undefined
    : undefined;
  if (!(connection instanceof SQLiteConnection) || lockState === undefined
      || lockState.connection !== connection || providerNow === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite cursor clock input is invalid");
  }
  requireExclusiveLineage(connection, lockState.transactionLineage);
  if (!sameLock(liveLock(connection), lockState.expectedLock)) {
    return fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite cursor clock migration lock changed");
  }
  const capability = Object.freeze(
    Object.create(null),
  ) as SQLiteCursorProviderClockCapability;
  Reflect.apply(weakMapSetIntrinsic, CAPABILITIES, [capability as object, {
    connection,
    expectedLock: lockState.expectedLock,
    migrationLockCapability,
    nextBoundaryIndex: 0,
    observing: false,
    poisoned: false,
    previousEvidence: undefined,
    previousProviderNowMs: undefined,
    providerClockSource,
    transactionLineage: lockState.transactionLineage,
  } satisfies CapabilityState]);
  return capability;
}

/** Observe the next exact boundary using a fresh live lock and provider time. */
export function observeSQLiteCursorProviderClockIntrinsic(
  capability: SQLiteCursorProviderClockCapability,
  boundary: SQLiteCursorClockBoundary,
): SQLiteCursorProviderClockEvidence {
  const state = capabilityState(capability);
  if (state.poisoned) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite cursor clock capability is poisoned");
  }
  if (state.observing) {
    state.poisoned = true;
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite provider clock reentrancy is forbidden");
  }
  const expectedBoundary = SQLITE_CURSOR_CLOCK_BOUNDARIES[state.nextBoundaryIndex];
  if (boundary !== expectedBoundary) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite cursor clock boundary is out of order");
  }
  requireExclusiveLineage(state.connection, state.transactionLineage);
  const ownerBefore = readSQLiteConnectionOwnerSnapshot(state.connection);
  const changesBefore = readSQLiteConnectionTotalChangesSnapshot(state.connection);
  const before = liveLock(state.connection);
  if (!sameLock(before, state.expectedLock)) {
    return fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite cursor clock migration lock changed");
  }
  const providerNow = Reflect.apply(weakMapGetIntrinsic, CLOCK_SOURCES, [
    state.providerClockSource as object,
  ]) as (() => number) | undefined;
  if (providerNow === undefined) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite provider clock source is invalid");
  }
  let providerNowMs: number;
  state.observing = true;
  try {
    providerNowMs = providerNow();
  } catch {
    state.observing = false;
    if (state.poisoned) {
      return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite provider clock reentrancy poisoned authority");
    }
    state.poisoned = true;
    return fail("GE_CYCLE_STORE_UNAVAILABLE", "SQLite provider clock source failed");
  }
  state.observing = false;
  if (state.poisoned) {
    return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite provider clock reentrancy poisoned authority");
  }
  try {
    if (!Number.isSafeInteger(providerNowMs) || providerNowMs < 0) {
      return fail("GE_CYCLE_STORE_UNAVAILABLE", "SQLite provider clock returned an invalid time");
    }
    requireExclusiveLineage(state.connection, state.transactionLineage);
    const ownerAfter = readSQLiteConnectionOwnerSnapshot(state.connection);
    const changesAfter = readSQLiteConnectionTotalChangesSnapshot(state.connection);
    const after = liveLock(state.connection);
    if (ownerAfter.transactionEpoch !== ownerBefore.transactionEpoch
        || changesAfter.totalChanges !== changesBefore.totalChanges
        || changesAfter.transactionEpoch !== changesBefore.transactionEpoch) {
      return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite provider clock mutated owner state");
    }
    if (!sameLock(after, state.expectedLock) || !sameLock(before, after)) {
      return fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite cursor clock migration lock changed");
    }
    if (state.previousProviderNowMs !== undefined
        && providerNowMs < state.previousProviderNowMs) {
      return fail("GE_CYCLE_STORE_CORRUPTION", "SQLite provider clock moved backwards");
    }
    if (providerNowMs >= state.expectedLock.activeExpiresAtMs) {
      return fail("GE_CYCLE_STORE_STALE_FENCE", "SQLite migration lock expired");
    }
    const evidence = Object.freeze(
      Object.create(null),
    ) as SQLiteCursorProviderClockEvidence;
    Reflect.apply(weakMapSetIntrinsic, EVIDENCE, [evidence as object, {
      activeExpiresAtMs: state.expectedLock.activeExpiresAtMs,
      boundary,
      capability,
      consumed: false,
      consumer: SQLITE_CURSOR_CLOCK_CONSUMERS[boundary],
      previousEvidence: state.previousEvidence,
      providerNowMs,
      transactionEpoch: ownerAfter.transactionEpoch,
      transactionLineage: state.transactionLineage,
    } satisfies EvidenceState]);
    state.previousEvidence = evidence;
    state.previousProviderNowMs = providerNowMs;
    state.nextBoundaryIndex += 1;
    return evidence;
  } catch (error) {
    state.poisoned = true;
    throw error;
  }
}

/** Consume one exact receipt once and mint a non-transferable tombstone. */
export function consumeSQLiteCursorProviderClockEvidenceIntrinsic(
  capability: SQLiteCursorProviderClockCapability,
  evidence: SQLiteCursorProviderClockEvidence,
  consumer: SQLiteCursorClockConsumer,
): SQLiteCursorProviderClockConsumedTombstone {
  capabilityState(capability);
  const state = evidence !== null && typeof evidence === "object"
    ? Reflect.apply(weakMapGetIntrinsic, EVIDENCE, [evidence as object]) as
      EvidenceState | undefined
    : undefined;
  if (state === undefined || state.capability !== capability || state.consumer !== consumer) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite cursor clock evidence is invalid");
  }
  if (state.consumed) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite cursor clock evidence was consumed");
  }
  // Build and register every immutable tail object before committing the
  // one-way evidence transition. If construction ever throws, the evidence
  // remains unconsumed and no half-published graph can escape.
  const tombstone = objectFreezeIntrinsic(
    objectCreateIntrinsic(null),
  ) as SQLiteCursorProviderClockConsumedTombstone;
  const tombstoneState = objectFreezeIntrinsic({
    capability,
    consumer,
    evidence,
  } satisfies TombstoneState);
  Reflect.apply(weakMapSetIntrinsic, TOMBSTONES, [tombstone as object, tombstoneState]);
  state.consumed = true;
  return tombstone;
}

/**
 * Validate the exact first-boundary graph before an outer authority enters its
 * non-interruptible activation tail. This function is deliberately read-only:
 * callers must complete every fallible check here before consuming evidence.
 */
export function assertSQLiteCursorOuterClockAuthorityGraphIntrinsic(
  connection: SQLiteConnection,
  migrationLockCapability: SQLiteCursorMigrationLockCapability,
  capability: SQLiteCursorProviderClockCapability,
  evidence: SQLiteCursorProviderClockEvidence,
): SQLiteCursorProviderClockEvidenceSnapshot {
  const clock = capabilityState(capability);
  const receipt = evidence !== null && typeof evidence === "object"
    ? Reflect.apply(weakMapGetIntrinsic, EVIDENCE, [evidence as object]) as
      EvidenceState | undefined
    : undefined;
  if (!(connection instanceof SQLiteConnection)
      || clock.connection !== connection
      || clock.migrationLockCapability !== migrationLockCapability
      || clock.poisoned
      || clock.nextBoundaryIndex !== 1
      || clock.previousEvidence !== evidence
      || receipt === undefined
      || receipt.capability !== capability
      || receipt.boundary !== "before-first-permanent-mutation"
      || receipt.consumer !== "outer-publication-authority"
      || receipt.previousEvidence !== undefined
      || receipt.consumed) {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite outer publication clock graph is invalid",
    );
  }
  requireExclusiveLineage(connection, clock.transactionLineage);
  const ownerBefore = readSQLiteConnectionOwnerSnapshot(connection);
  const changesBefore = readSQLiteConnectionTotalChangesSnapshot(connection);
  const lock = liveLock(connection);
  const ownerAfter = readSQLiteConnectionOwnerSnapshot(connection);
  const changesAfter = readSQLiteConnectionTotalChangesSnapshot(connection);
  if (!sameLock(lock, clock.expectedLock)
      || ownerBefore.transactionLineage !== clock.transactionLineage
      || ownerAfter.transactionLineage !== clock.transactionLineage
      || ownerAfter.transactionEpoch !== ownerBefore.transactionEpoch
      || changesBefore.transactionEpoch !== ownerBefore.transactionEpoch
      || changesAfter.transactionEpoch !== ownerAfter.transactionEpoch
      || changesAfter.totalChanges !== changesBefore.totalChanges
      || receipt.transactionLineage !== clock.transactionLineage) {
    return fail(
      "GE_CYCLE_STORE_STALE_FENCE",
      "SQLite outer publication clock graph changed",
    );
  }
  return Object.freeze({
    activeExpiresAtMs: receipt.activeExpiresAtMs,
    boundary: receipt.boundary,
    consumer: receipt.consumer,
    providerNowMs: receipt.providerNowMs,
    transactionLineage: receipt.transactionLineage,
    transactionEpoch: ownerAfter.transactionEpoch,
  });
}

/** Package-private evidence inspection for downstream authority construction. */
export function readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
  capability: SQLiteCursorProviderClockCapability,
  evidence: SQLiteCursorProviderClockEvidence,
): SQLiteCursorProviderClockEvidenceSnapshot {
  capabilityState(capability);
  const state = evidence !== null && typeof evidence === "object"
    ? Reflect.apply(weakMapGetIntrinsic, EVIDENCE, [evidence as object]) as
      EvidenceState | undefined
    : undefined;
  if (state === undefined || state.capability !== capability) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite cursor clock evidence is invalid");
  }
  return Object.freeze({
    activeExpiresAtMs: state.activeExpiresAtMs,
    boundary: state.boundary,
    consumer: state.consumer,
    providerNowMs: state.providerNowMs,
    transactionLineage: state.transactionLineage,
    transactionEpoch: state.transactionEpoch,
  });
}

/** Verify the exact previous receipt identity committed by this observation. */
export function assertSQLiteCursorProviderClockEvidencePredecessorIntrinsic(
  capability: SQLiteCursorProviderClockCapability,
  evidence: SQLiteCursorProviderClockEvidence,
  previousEvidence: SQLiteCursorProviderClockEvidence | undefined,
): SQLiteCursorProviderClockEvidence {
  capabilityState(capability);
  const state = evidence !== null && typeof evidence === "object"
    ? Reflect.apply(weakMapGetIntrinsic, EVIDENCE, [evidence as object]) as
      EvidenceState | undefined
    : undefined;
  if (state === undefined || state.capability !== capability
      || state.previousEvidence !== previousEvidence) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite cursor clock chain is invalid");
  }
  return evidence;
}

/** Verify an exact consumed tombstone without consuming the evidence again. */
export function assertSQLiteCursorProviderClockConsumedTombstoneIntrinsic(
  capability: SQLiteCursorProviderClockCapability,
  evidence: SQLiteCursorProviderClockEvidence,
  tombstone: SQLiteCursorProviderClockConsumedTombstone,
  consumer: SQLiteCursorClockConsumer,
): SQLiteCursorProviderClockConsumedTombstone {
  capabilityState(capability);
  const state = tombstone !== null && typeof tombstone === "object"
    ? Reflect.apply(weakMapGetIntrinsic, TOMBSTONES, [tombstone as object]) as
      TombstoneState | undefined
    : undefined;
  if (state === undefined || state.capability !== capability
      || state.evidence !== evidence || state.consumer !== consumer) {
    return fail("GE_CYCLE_STORE_INVALID_ARGUMENT", "SQLite cursor clock tombstone is invalid");
  }
  return tombstone;
}

/** Revalidate the consumed first-boundary edge retained by an active authority. */
export function assertSQLiteCursorOuterClockAuthorityActiveGraphIntrinsic(
  connection: SQLiteConnection,
  migrationLockCapability: SQLiteCursorMigrationLockCapability,
  capability: SQLiteCursorProviderClockCapability,
  evidence: SQLiteCursorProviderClockEvidence,
  tombstone: SQLiteCursorProviderClockConsumedTombstone,
): SQLiteCursorProviderClockEvidenceSnapshot {
  const clock = capabilityState(capability);
  const receipt = evidence !== null && typeof evidence === "object"
    ? Reflect.apply(weakMapGetIntrinsic, EVIDENCE, [evidence as object]) as
      EvidenceState | undefined
    : undefined;
  const consumed = tombstone !== null && typeof tombstone === "object"
    ? Reflect.apply(weakMapGetIntrinsic, TOMBSTONES, [tombstone as object]) as
      TombstoneState | undefined
    : undefined;
  if (!(connection instanceof SQLiteConnection)
      || clock.connection !== connection
      || clock.migrationLockCapability !== migrationLockCapability
      || clock.poisoned
      || receipt === undefined
      || receipt.capability !== capability
      || receipt.boundary !== "before-first-permanent-mutation"
      || receipt.consumer !== "outer-publication-authority"
      || receipt.previousEvidence !== undefined
      || !receipt.consumed
      || consumed === undefined
      || consumed.capability !== capability
      || consumed.evidence !== evidence
      || consumed.consumer !== "outer-publication-authority") {
    return fail(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      "SQLite active outer publication clock graph is invalid",
    );
  }
  requireExclusiveLineage(connection, clock.transactionLineage);
  if (!sameLock(liveLock(connection), clock.expectedLock)) {
    return fail(
      "GE_CYCLE_STORE_STALE_FENCE",
      "SQLite active outer publication migration lock changed",
    );
  }
  return Object.freeze({
    activeExpiresAtMs: receipt.activeExpiresAtMs,
    boundary: receipt.boundary,
    consumer: receipt.consumer,
    providerNowMs: receipt.providerNowMs,
    transactionLineage: receipt.transactionLineage,
    transactionEpoch: readSQLiteConnectionOwnerSnapshot(connection).transactionEpoch,
  });
}
