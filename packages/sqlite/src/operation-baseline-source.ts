import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { isProxy } from "node:util/types";

import { canonicalHash, canonicalSerialize } from "@graph-engineering/core";
import {
  CycleStoreProviderError,
  cycleStoreAdapterCodec,
  type CycleStoreCheckpoint,
  type CycleStoreCheckpointSummary,
  type CycleStoreMutationOperation,
} from "@graph-engineering/runtime";

import {
  BASELINE_ENTRY_KINDS,
  type OperationBaselineEntryInput,
  type OperationBaselineEntryKind,
  type OperationBaselineSourceEnvelope,
  decodeOperationBaselineCanonicalBytes,
  encodeOperationBaselineKey,
  encodeOperationBaselineSourceEnvelope,
  encodeOperationBaselineState,
} from "./operation-baseline.js";
import {
  SQLITE_BASELINE_COOPERATIVE_ENTRIES,
  SQLITE_BASELINE_COOPERATIVE_POISON,
  SQLITE_BASELINE_CONSUME_OWNED_WRITE,
  SQLITE_BASELINE_FINISH_COOPERATIVE_WRITES,
  SQLITE_BASELINE_ABORT_ORDERED_HANDOFF,
  SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE,
  type SQLiteBaselineCooperativeStage,
  type SQLiteBaselineOwnedWriteReceipt,
  type SQLiteBaselineOrderedHandoffSourceBinding,
  type SQLiteBaselineOrderedHandoffStage,
} from "./operation-baseline-cooperation.js";
import {
  sqliteBlob,
  sqliteNullableText,
  sqliteRow,
  sqliteSafeInteger,
  sqliteText,
} from "./sqlite-codec.js";
import {
  SQLiteConnection,
  iterateSQLiteStatementNativeIntrinsic,
  nextSQLiteStatementIteratorNativeIntrinsic,
  prepareSQLiteConnectionIntrinsic,
  readSQLiteConnectionOwnerSnapshot,
  readSQLiteConnectionTotalChangesSnapshot,
  returnSQLiteStatementIteratorNativeIntrinsic,
} from "./sqlite-connection.js";
import {
  assertSQLiteCursorPublicationOwnerCompositionConnectionIntrinsic,
  captureSQLiteCursorPublicationTransactionFailureIntrinsic,
  finalizeSQLiteCursorPublicationTransactionFailureIntrinsic,
  readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic,
  type SQLiteCursorPublicationTransactionBeginReceipt,
  type SQLiteCursorPublicationTransactionOwner,
} from "./cursor-publication-transaction-owner.js";
import {
  consumeSQLiteCursorPublicationNativeProjectionIntrinsic,
  hasSQLiteCursorPublicationNativeProjectionConsumerIntrinsic,
} from "./cursor-publication-native-projection-bridge.js";
import {
  SQLITE_ALPHA_V0_TO_V1_SQL_SHA256,
  SQLITE_SCHEMA_IDENTITY_SHA256,
  SQLITE_SCHEMA_SQL_SHA256,
} from "./migrations.js";
import { SQLITE_CYCLE_STORE_DESCRIPTOR_HASH } from "./sqlite-profile.js";

const OPERATION = "inspect-schema" as const;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const SQLITE_V1_BASELINE_NATIVE_PROJECTION_DOMAIN =
  "graph-engineering/sqlite-v1-baseline-projection/v1\0" as const;
const SQLITE_V1_BASELINE_READ_SESSION_DOMAIN =
  "graph-engineering/sqlite-v1-baseline-read-session/v1\0" as const;
// Capture every lower native bridge at definition time.  The projection path
// must not consult a replaceable instance/prototype export after authority has
// been established.
const prepareSQLiteConnectionDefinitionIntrinsic = prepareSQLiteConnectionIntrinsic;
const iterateSQLiteStatementDefinitionIntrinsic = iterateSQLiteStatementNativeIntrinsic;
const nextSQLiteStatementIteratorDefinitionIntrinsic =
  nextSQLiteStatementIteratorNativeIntrinsic;
const returnSQLiteStatementIteratorDefinitionIntrinsic =
  returnSQLiteStatementIteratorNativeIntrinsic;
const randomBytesDefinitionIntrinsic = randomBytes;
const reflectApplyDefinitionIntrinsic = Reflect.apply;
const objectCreateDefinitionIntrinsic = Object.create;
const objectFreezeDefinitionIntrinsic = Object.freeze;
const objectFromEntriesDefinitionIntrinsic = Object.fromEntries;
const arrayFilterDefinitionIntrinsic = Array.prototype.filter;
const arrayFindIndexDefinitionIntrinsic = Array.prototype.findIndex;
const arrayMapDefinitionIntrinsic = Array.prototype.map;
const arrayPushDefinitionIntrinsic = Array.prototype.push;
const arrayReduceDefinitionIntrinsic = Array.prototype.reduce;
const arraySliceDefinitionIntrinsic = Array.prototype.slice;
const arraySomeDefinitionIntrinsic = Array.prototype.some;
const mapConstructorDefinitionIntrinsic = Map;
const mapGetDefinitionIntrinsic = Map.prototype.get;
const mapSetDefinitionIntrinsic = Map.prototype.set;
const setConstructorDefinitionIntrinsic = Set;
const setAddDefinitionIntrinsic = Set.prototype.add;
const setHasDefinitionIntrinsic = Set.prototype.has;
const weakMapGetDefinitionIntrinsic = WeakMap.prototype.get;
const weakMapSetDefinitionIntrinsic = WeakMap.prototype.set;
const consumeSQLiteCursorPublicationNativeProjectionDefinitionIntrinsic =
  consumeSQLiteCursorPublicationNativeProjectionIntrinsic;
const hasSQLiteCursorPublicationNativeProjectionConsumerDefinitionIntrinsic =
  hasSQLiteCursorPublicationNativeProjectionConsumerIntrinsic;

export type SQLiteV1BaselineCounts = Readonly<Record<OperationBaselineEntryKind, number>>;

/**
 * The frozen, exactly three-key source clock evidence.
 *
 * `capturedAtMs` is the caller-supplied capture clock, `providerHighWaterAtMs`
 * is the migration-lock high-water, and `maximumNonCursorObservedAtMs` is the
 * maximum provider-owned observation of every source family except
 * `ge_cycle_cursors`. Capture keeps the two orderings it always enforced: the
 * high-water may not be behind non-cursor state, and the capture clock may not
 * be behind the high-water.
 *
 * Cursor creation and consumption clocks are deliberately absent. They will be
 * checked by the future Slice B cursor campaign against this same frozen
 * high-water, so a cursor-only regression will become one
 * `BLR_CURSOR_EXPIRY_CONSUMPTION` unit instead of a generic source failure.
 * This splits diagnostic ownership only: a valid
 * database still ends up with the same clock ordering as the earlier combined
 * maximum. Lease and migration-lock future expiry clocks and checkpoint RFC3339
 * creation timestamps stay outside the observation maximum as before, as does
 * cursor `expires_at_ms`, which only has to be strictly after its creation.
 */
export interface SQLiteV1BaselineClockEvidence {
  readonly capturedAtMs: number;
  readonly maximumNonCursorObservedAtMs: number;
  readonly providerHighWaterAtMs: number;
}

export interface SQLiteV1BaselineSourceSummary {
  readonly sourceEnvelope: OperationBaselineSourceEnvelope;
  readonly countsByKind: SQLiteV1BaselineCounts;
  readonly expectedEntryCount: number;
  readonly clockEvidence: SQLiteV1BaselineClockEvidence;
  /**
   * Streams all twelve v1 source families implemented by this foundation.
   * The iterator is deliberately one-shot and remains transaction-scoped.
   */
  readonly entries: () => Generator<OperationBaselineEntryInput, void, undefined>;
}

export interface SQLiteV1BaselineLowerOwnedNativeProjection {
  readonly __sqliteV1BaselineLowerOwnedNativeProjection: never;
}

export interface SQLiteV1BaselineNativeFamilyRetirementSnapshot {
  readonly entryKind: OperationBaselineEntryKind;
  readonly expectedCount: number;
  readonly observedCount: number;
  readonly terminalObserved: true;
  readonly retirementKind: "iterator-return" | "lexical-release";
  readonly retirementAttemptCount: 1;
  readonly retirementSuccessCount: 1;
  readonly prepareCount: 1;
  readonly terminalCount: 1;
  readonly sqlSha256: string;
  readonly normalizedSqlSha256: string;
}

export interface SQLiteV1BaselineLowerOwnedNativeProjectionSnapshot {
  readonly routeId: "main.baseline-entries";
  readonly sourceDomain: "sqlite-v1-baseline-source";
  readonly lifecycle: "retired" | "adopted";
  readonly expectedProjectionCount: number;
  readonly retainedCount: number;
  readonly projectionSha256: string;
  readonly sourceEnvelopeSha256: string;
  readonly sourceSummarySha256: string;
  readonly readSessionSha256: string;
  readonly exactReadSession: true;
  readonly exactResourcePairing: true;
  readonly nativeSourceProvenance: true;
  readonly fullExhausted: true;
  readonly exactSourceConnection: true;
  readonly familyCount: 12;
  readonly familyRetirements: readonly SQLiteV1BaselineNativeFamilyRetirementSnapshot[];
  readonly genuineZeroClaim: false;
  readonly logicalNativeReadCount: 12;
  readonly physicalNativeIoCountClaimed: false;
  readonly sqlAuthority: false;
  readonly exactOwner: true;
  readonly exactBeginReceipt: true;
  readonly exactComposition: true;
  readonly exactTransactionLineage: true;
  readonly exactTransactionGeneration: true;
}

interface MutableNativeFamilyRetirement {
  readonly entryKind: OperationBaselineEntryKind;
  readonly expectedCount: number;
  observedCount: number;
  terminalObserved: boolean;
  readonly retirementKind: "iterator-return" | "lexical-release";
  retirementAttemptCount: number;
  retirementSuccessCount: number;
  prepareCount: number;
  terminalCount: number;
  sqlSha256: string | undefined;
  normalizedSqlSha256: string | undefined;
  readonly resourceIdentity: object;
  statementIdentity: object | undefined;
  iteratorIdentity: object | undefined;
  retiredIteratorIdentity: object | undefined;
}

interface SQLiteV1BaselineNativeDrainResult {
  readonly entries: readonly OperationBaselineEntryInput[];
  readonly familyRetirements: readonly SQLiteV1BaselineNativeFamilyRetirementSnapshot[];
  readonly resourceIdentities: readonly object[];
}

function nativeRetirementFor(
  retirements: ReadonlyMap<OperationBaselineEntryKind, MutableNativeFamilyRetirement> | undefined,
  entryKind: OperationBaselineEntryKind,
): MutableNativeFamilyRetirement | undefined {
  return retirements === undefined
    ? undefined
    : reflectApplyDefinitionIntrinsic(mapGetDefinitionIntrinsic, retirements, [entryKind]) as
      MutableNativeFamilyRetirement | undefined;
}

/** Private registry state for one exact summary returned by this module. */
interface SQLiteV1BaselineCapturedSourceState {
  readonly connection: SQLiteConnection;
  readonly transactionEpoch: bigint;
  readonly nativeDrain: (reprove: () => void) => SQLiteV1BaselineNativeDrainResult;
}

const CAPTURED_CURSOR_SOURCES = new WeakMap<object, SQLiteV1BaselineCapturedSourceState>();
const LOWER_OWNED_NATIVE_PROJECTIONS = new WeakMap<object, {
  readonly connection: SQLiteConnection;
  readonly sourceSummary: SQLiteV1BaselineSourceSummary;
  readonly owner: SQLiteCursorPublicationTransactionOwner;
  readonly beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt;
  readonly composition: object;
  readonly transactionEpoch: bigint;
  readonly retainedEntries: readonly OperationBaselineEntryInput[];
  readonly resourceIdentities: readonly object[];
  readonly readSessionIdentity: object;
  readonly snapshot: SQLiteV1BaselineLowerOwnedNativeProjectionSnapshot;
  adopted: boolean;
}>();

export type SQLiteV1BaselineNativeProjectionFaultPoint =
  | "prepare-before" | "prepare-after"
  | "next-before" | "next-after"
  | "decode-before" | "decode-after"
  | "terminal-before" | "terminal-after"
  | "retirement-reproof-before" | "return" | "retirement-reproof-after"
  | "hash-before" | "hash-after"
  | "mint-before" | "mint-after";

export interface SQLiteV1BaselineNativeProjectionFaultForTest {
  readonly point: SQLiteV1BaselineNativeProjectionFaultPoint;
  readonly error: object;
  readonly family?: OperationBaselineEntryKind;
  readonly rowOrdinal?: number;
}

let nativeProjectionFaultsForTest: readonly Readonly<
  SQLiteV1BaselineNativeProjectionFaultForTest
>[] | undefined;
export interface SQLiteV1BaselineNativeProjectionFailureTelemetryForTest {
  readonly nativeReturnAttemptCount: number;
  readonly nativeReturnSuccessCount: number;
  readonly secondaryFailureCount: number;
}
let currentNativeProjectionFailureTelemetryForTest: {
  nativeReturnAttemptCount: number;
  nativeReturnSuccessCount: number;
  secondaryFailureCount: number;
} | undefined;
let lastNativeProjectionFailureTelemetryForTest:
SQLiteV1BaselineNativeProjectionFailureTelemetryForTest | undefined;

function retainNativeProjectionPrimary(
  primary: { readonly present: boolean; readonly value: unknown },
  error: unknown,
): { readonly present: boolean; readonly value: unknown } {
  if (!primary.present) return { present: true, value: error };
  if (currentNativeProjectionFailureTelemetryForTest !== undefined) {
    currentNativeProjectionFailureTelemetryForTest.secondaryFailureCount += 1;
  }
  return primary;
}

export function readSQLiteV1BaselineNativeProjectionFailureTelemetryForTestIntrinsic():
SQLiteV1BaselineNativeProjectionFailureTelemetryForTest | undefined {
  return lastNativeProjectionFailureTelemetryForTest;
}

function maybeThrowNativeProjectionFaultForTest(
  point: SQLiteV1BaselineNativeProjectionFaultPoint,
  retirement?: MutableNativeFamilyRetirement,
  rowOrdinal?: number,
): void {
  const faults = nativeProjectionFaultsForTest;
  const index = faults === undefined
    ? -1
    : reflectApplyDefinitionIntrinsic(
      arrayFindIndexDefinitionIntrinsic,
      faults,
      [(fault: SQLiteV1BaselineNativeProjectionFaultForTest) => fault.point === point
        && (fault.family === undefined || fault.family === retirement?.entryKind)
        && (fault.rowOrdinal === undefined || fault.rowOrdinal === rowOrdinal)],
    ) as number;
  if (faults === undefined || index < 0) return;
  const fault = faults[index]!;
  const remaining = reflectApplyDefinitionIntrinsic(
    arrayFilterDefinitionIntrinsic,
    faults,
    [(_value: SQLiteV1BaselineNativeProjectionFaultForTest, ordinal: number) => ordinal !== index],
  ) as SQLiteV1BaselineNativeProjectionFaultForTest[];
  nativeProjectionFaultsForTest = remaining.length === 0
    ? undefined
    : objectFreezeDefinitionIntrinsic(remaining);
  throw fault.error;
}

/** Package-private one-shot native projection fault seam. */
export function injectSQLiteV1BaselineNativeProjectionFaultForTestIntrinsic(
  point: SQLiteV1BaselineNativeProjectionFaultPoint,
  error: object,
  family?: OperationBaselineEntryKind,
  rowOrdinal?: number,
): void {
  injectSQLiteV1BaselineNativeProjectionFaultSequenceForTestIntrinsic([
    {
      error,
      point,
      ...(family === undefined ? {} : { family }),
      ...(rowOrdinal === undefined ? {} : { rowOrdinal }),
    },
  ]);
}

/** Package-private bounded multi-fault seam for exact-primary precedence. */
export function injectSQLiteV1BaselineNativeProjectionFaultSequenceForTestIntrinsic(
  faults: readonly SQLiteV1BaselineNativeProjectionFaultForTest[],
): void {
  const hasInvalidFault = reflectApplyDefinitionIntrinsic(
    arraySomeDefinitionIntrinsic,
    faults,
    [({ error, rowOrdinal }: SQLiteV1BaselineNativeProjectionFaultForTest) => error === null
      || typeof error !== "object" || isProxy(error)
      || (rowOrdinal !== undefined
        && (!Number.isSafeInteger(rowOrdinal) || rowOrdinal < 0))],
  ) as boolean;
  if (nativeProjectionFaultsForTest !== undefined || faults.length < 1
      || faults.length > 4 || hasInvalidFault) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite native projection fault injection is invalid",
    );
  }
  nativeProjectionFaultsForTest = objectFreezeDefinitionIntrinsic(
    reflectApplyDefinitionIntrinsic(
      arrayMapDefinitionIntrinsic,
      faults,
      [(fault: SQLiteV1BaselineNativeProjectionFaultForTest) =>
        objectFreezeDefinitionIntrinsic({ ...fault })],
    ) as SQLiteV1BaselineNativeProjectionFaultForTest[],
  );
}

interface SQLiteV1BaselineTransactionGuard {
  totalChanges: number;
  readonly transactionEpoch: bigint;
}

const REQUIRED_POSTCONDITIONS = Object.freeze([
  "application-id-matches",
  "user-version-is-1",
  "schema-singleton-is-manifest-bound",
  "migration-ledger-row-is-manifest-bound",
  "all-canonical-tables-are-strict",
  "logical-schema-identity-matches-fresh-v1",
  "foreign-key-check-is-empty",
  "integrity-check-is-ok",
  "alpha-row-counts-are-preserved",
  "stream-heads-match-record-tails",
  "canonical-blobs-and-hashes-are-preserved",
  "checkpoint-revisions-are-seeded",
  "lease-and-migration-fences-are-monotonic",
  "no-v0-or-placeholder-state-remains",
] as const);
const FROZEN_POSTCONDITIONS = Object.freeze({
  requiredPostconditions: REQUIRED_POSTCONDITIONS,
});
const EXPECTED_POSTCONDITIONS = canonicalSerialize(FROZEN_POSTCONDITIONS);

function fail(message: string): never {
  throw new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

/** Cross-runtime SQL identity: CRLF-neutral and formatting-whitespace neutral. */
export function sqliteV1BaselineNormalizedSqlSha256Intrinsic(sql: string): string {
  return createHash("sha256")
    .update(
      sql.replace(/\r\n?/gu, "\n")
        .replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/gu, "")
        .replace(/[\t\n\v\f\r ]+/gu, " "),
      "utf8",
    )
    .digest("hex");
}

function safeBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "bigint" || value < 0n || value > MAX_SAFE_BIGINT) {
    return fail(`SQLite v1 baseline ${label} is outside bounds`);
  }
  return value;
}

function capturedAt(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite v1 baseline capture time is outside bounds",
    );
  }
  return value as number;
}

function validatedEntry(
  entryKind: OperationBaselineEntryKind,
  key: Readonly<Record<string, unknown>>,
  state: Readonly<Record<string, unknown>>,
): OperationBaselineEntryInput {
  try {
    encodeOperationBaselineKey(entryKind, key);
    encodeOperationBaselineState(entryKind, state);
  } catch {
    return fail(`SQLite v1 baseline ${entryKind} row is invalid`);
  }
  return objectFreezeDefinitionIntrinsic({
    entryKind,
    key: objectFreezeDefinitionIntrinsic(key),
    state: objectFreezeDefinitionIntrinsic(state),
  });
}

function decodedCheckpointSummary(blob: Buffer): Readonly<Record<string, unknown>> {
  if (blob.byteLength < 2 || blob.byteLength > 1_048_576) {
    return fail("SQLite v1 baseline checkpoint summary carrier is outside bounds");
  }
  let summary: CycleStoreCheckpointSummary;
  try {
    summary = cycleStoreAdapterCodec.decodeLedgerResult("save-checkpoint", blob);
  } catch {
    return fail("SQLite v1 baseline checkpoint summary carrier is invalid");
  }
  if (!blob.equals(Buffer.from(
    cycleStoreAdapterCodec.encodeLedgerResult("save-checkpoint", summary),
  ))) {
    return fail("SQLite v1 baseline checkpoint summary carrier is noncanonical");
  }
  return objectFreezeDefinitionIntrinsic({ ...summary });
}

const LEGACY_OPERATIONS = new Set<CycleStoreMutationOperation>([
  "append",
  "save-checkpoint",
  "delete-checkpoint",
  "acquire-lease",
  "renew-lease",
  "release-lease",
  "set-legal-hold",
  "acquire-migration-lock",
  "release-migration-lock",
]);

function legacyOperation(value: unknown): CycleStoreMutationOperation {
  const operation = sqliteText(value, OPERATION, "legacy operation name");
  if (!(reflectApplyDefinitionIntrinsic(
    setHasDefinitionIntrinsic,
    LEGACY_OPERATIONS,
    [operation as CycleStoreMutationOperation],
  ) as boolean)) {
    return fail("SQLite v1 baseline legacy operation name is invalid");
  }
  return operation as CycleStoreMutationOperation;
}

function legacyResultBlobSha256(
  operation: CycleStoreMutationOperation,
  blob: Buffer,
  resultHash: string,
): string {
  if (blob.byteLength < 2 || blob.byteLength > 16_777_216) {
    return fail("SQLite v1 baseline legacy operation result carrier is outside bounds");
  }
  try {
    const decoded = cycleStoreAdapterCodec.decodeLedgerResult(operation, blob);
    const reencoded = Buffer.from(cycleStoreAdapterCodec.encodeLedgerResult(operation, decoded));
    if (!reencoded.equals(blob) || canonicalHash(decoded) !== resultHash) {
      return fail("SQLite v1 baseline legacy operation result carrier is invalid");
    }
    return createHash("sha256").update(blob).digest("hex");
  } catch {
    return fail("SQLite v1 baseline legacy operation result carrier is invalid");
  }
}

function exactlyOne(
  connection: SQLiteConnection,
  sql: string,
  length: number,
  label: string,
  retirement?: MutableNativeFamilyRetirement,
  reprove?: () => void,
): readonly unknown[] {
  let result: readonly unknown[] | undefined;
  let count = 0;
  reprove?.();
  maybeThrowNativeProjectionFaultForTest("prepare-before", retirement, 0);
  const statement = prepareSQLiteConnectionDefinitionIntrinsic(connection, sql, OPERATION);
  maybeThrowNativeProjectionFaultForTest("prepare-after", retirement, 0);
  reprove?.();
  const iterator = iterateSQLiteStatementDefinitionIntrinsic(statement);
  let primary: { readonly present: boolean; readonly value: unknown } = {
    present: false,
    value: undefined,
  };
  if (retirement !== undefined) {
    retirement.statementIdentity = statement;
    retirement.iteratorIdentity = iterator;
    retirement.prepareCount += 1;
    retirement.sqlSha256 = createHash("sha256").update(sql).digest("hex");
    retirement.normalizedSqlSha256 = sqliteV1BaselineNormalizedSqlSha256Intrinsic(sql);
  }
  try {
    while (true) {
      reprove?.();
      maybeThrowNativeProjectionFaultForTest("next-before", retirement, count);
      const next = nextSQLiteStatementIteratorDefinitionIntrinsic(iterator);
      maybeThrowNativeProjectionFaultForTest("next-after", retirement, count);
      reprove?.();
      const done = next.done;
      reprove?.();
      if (done) {
        maybeThrowNativeProjectionFaultForTest("terminal-before", retirement, count);
        if (retirement !== undefined) {
          retirement.terminalObserved = true;
          retirement.terminalCount += 1;
        }
        maybeThrowNativeProjectionFaultForTest("terminal-after", retirement, count);
        break;
      }
      count += 1;
      if (retirement !== undefined) retirement.observedCount += 1;
      if (count > 1) return fail(`SQLite v1 baseline ${label} cardinality is invalid`);
      reprove?.();
      maybeThrowNativeProjectionFaultForTest("decode-before", retirement, count - 1);
      result = sqliteRow(next.value, length, OPERATION, label);
      maybeThrowNativeProjectionFaultForTest("decode-after", retirement, count - 1);
      reprove?.();
    }
  } catch (error) {
    primary = retainNativeProjectionPrimary(primary, error);
  } finally {
    if (retirement !== undefined) {
      retirement.retirementAttemptCount += 1;
    }
    try {
      maybeThrowNativeProjectionFaultForTest(
        "retirement-reproof-before",
        retirement,
        retirement?.observedCount,
      );
      reprove?.();
    } catch (error) {
      primary = retainNativeProjectionPrimary(primary, error);
    }
    try {
      if (currentNativeProjectionFailureTelemetryForTest !== undefined) {
        currentNativeProjectionFailureTelemetryForTest.nativeReturnAttemptCount += 1;
      }
      maybeThrowNativeProjectionFaultForTest("return", retirement, retirement?.observedCount);
      returnSQLiteStatementIteratorDefinitionIntrinsic(iterator);
      if (currentNativeProjectionFailureTelemetryForTest !== undefined) {
        currentNativeProjectionFailureTelemetryForTest.nativeReturnSuccessCount += 1;
      }
      if (retirement !== undefined && retirement.iteratorIdentity !== iterator) {
        return fail("SQLite v1 baseline native iterator resource pairing drifted");
      }
      if (retirement !== undefined) retirement.retiredIteratorIdentity = iterator;
      if (retirement !== undefined) retirement.retirementSuccessCount += 1;
    } catch (error) {
      primary = retainNativeProjectionPrimary(primary, error);
    }
    try {
      reprove?.();
      maybeThrowNativeProjectionFaultForTest(
        "retirement-reproof-after",
        retirement,
        retirement?.observedCount,
      );
    } catch (error) {
      primary = retainNativeProjectionPrimary(primary, error);
    }
    if (primary.present) throw primary.value;
  }
  if (primary.present) throw primary.value;
  if (count !== 1 || result === undefined) {
    return fail(`SQLite v1 baseline ${label} cardinality is invalid`);
  }
  return result;
}

function nullableInteger(value: unknown, minimum: number, label: string): number | null {
  return value === null
    ? null
    : sqliteSafeInteger(value, minimum, Number.MAX_SAFE_INTEGER, OPERATION, label);
}

function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : sqliteText(value, OPERATION, label);
}

function totalChanges(connection: SQLiteConnection): number {
  return readSQLiteConnectionTotalChangesSnapshot(connection).totalChanges;
}

function requireCaptureTransaction(
  connection: SQLiteConnection,
  guard: SQLiteV1BaselineTransactionGuard,
): void {
  if (!connection.isTransaction || connection.transactionMode !== "exclusive") {
    return fail("SQLite v1 baseline iteration requires the captured EXCLUSIVE transaction");
  }
  if (connection.transactionEpoch !== guard.transactionEpoch
      || totalChanges(connection) !== guard.totalChanges) {
    return fail("SQLite v1 baseline captured transaction changed");
  }
}

function* transactionRows(
  connection: SQLiteConnection,
  guard: SQLiteV1BaselineTransactionGuard,
  sql: string,
  retirement?: MutableNativeFamilyRetirement,
  reprove?: () => void,
): Generator<unknown, void, undefined> {
  reprove?.();
  maybeThrowNativeProjectionFaultForTest("prepare-before", retirement, 0);
  const statement = prepareSQLiteConnectionDefinitionIntrinsic(connection, sql, OPERATION);
  maybeThrowNativeProjectionFaultForTest("prepare-after", retirement, 0);
  reprove?.();
  const iterator = iterateSQLiteStatementDefinitionIntrinsic(statement);
  let primary: { readonly present: boolean; readonly value: unknown } = {
    present: false,
    value: undefined,
  };
  if (retirement !== undefined) {
    retirement.statementIdentity = statement;
    retirement.iteratorIdentity = iterator;
    retirement.prepareCount += 1;
    retirement.sqlSha256 = createHash("sha256").update(sql).digest("hex");
    retirement.normalizedSqlSha256 = sqliteV1BaselineNormalizedSqlSha256Intrinsic(sql);
  }
  try {
    while (true) {
      requireCaptureTransaction(connection, guard);
      reprove?.();
      maybeThrowNativeProjectionFaultForTest(
        "next-before",
        retirement,
        retirement?.observedCount,
      );
      const next = nextSQLiteStatementIteratorDefinitionIntrinsic(iterator);
      maybeThrowNativeProjectionFaultForTest(
        "next-after",
        retirement,
        retirement?.observedCount,
      );
      reprove?.();
      const done = next.done;
      reprove?.();
      if (done) {
        maybeThrowNativeProjectionFaultForTest(
          "terminal-before",
          retirement,
          retirement?.observedCount,
        );
        if (retirement !== undefined) {
          retirement.terminalObserved = true;
          retirement.terminalCount += 1;
        }
        maybeThrowNativeProjectionFaultForTest(
          "terminal-after",
          retirement,
          retirement?.observedCount,
        );
        return;
      }
      if (retirement !== undefined) retirement.observedCount += 1;
      requireCaptureTransaction(connection, guard);
      reprove?.();
      maybeThrowNativeProjectionFaultForTest(
        "decode-before",
        retirement,
        retirement === undefined ? undefined : retirement.observedCount - 1,
      );
      yield next.value;
      maybeThrowNativeProjectionFaultForTest(
        "decode-after",
        retirement,
        retirement === undefined ? undefined : retirement.observedCount - 1,
      );
      reprove?.();
    }
  } catch (error) {
    primary = retainNativeProjectionPrimary(primary, error);
  } finally {
    if (retirement !== undefined) retirement.retirementAttemptCount += 1;
    try {
      maybeThrowNativeProjectionFaultForTest(
        "retirement-reproof-before",
        retirement,
        retirement?.observedCount,
      );
      reprove?.();
    } catch (error) {
      primary = retainNativeProjectionPrimary(primary, error);
    }
    try {
      if (currentNativeProjectionFailureTelemetryForTest !== undefined) {
        currentNativeProjectionFailureTelemetryForTest.nativeReturnAttemptCount += 1;
      }
      maybeThrowNativeProjectionFaultForTest("return", retirement, retirement?.observedCount);
      returnSQLiteStatementIteratorDefinitionIntrinsic(iterator);
      if (currentNativeProjectionFailureTelemetryForTest !== undefined) {
        currentNativeProjectionFailureTelemetryForTest.nativeReturnSuccessCount += 1;
      }
      if (retirement !== undefined && retirement.iteratorIdentity !== iterator) {
        return fail("SQLite v1 baseline native iterator resource pairing drifted");
      }
      if (retirement !== undefined) retirement.retiredIteratorIdentity = iterator;
      if (retirement !== undefined) retirement.retirementSuccessCount += 1;
    } catch (error) {
      primary = retainNativeProjectionPrimary(primary, error);
    }
    try {
      reprove?.();
      maybeThrowNativeProjectionFaultForTest(
        "retirement-reproof-after",
        retirement,
        retirement?.observedCount,
      );
    } catch (error) {
      primary = retainNativeProjectionPrimary(primary, error);
    }
    if (primary.present) throw primary.value;
  }
  if (primary.present) throw primary.value;
}

function* streamV1Entries(
  connection: SQLiteConnection,
  sourceEnvelope: OperationBaselineSourceEnvelope,
  countsByKind: SQLiteV1BaselineCounts,
  guard: SQLiteV1BaselineTransactionGuard,
  expectedMigrationAppliedAtMs: number,
  nativeRetirements?: ReadonlyMap<OperationBaselineEntryKind, MutableNativeFamilyRetirement>,
  reprove?: () => void,
): Generator<OperationBaselineEntryInput, void, undefined> {
  requireCaptureTransaction(connection, guard);

  const schema = exactlyOne(connection, `
    SELECT current_version, min_reader_version, max_reader_version,
           min_writer_version, max_writer_version, schema_identity_sha256,
           latest_migration_sha256, latest_migration_applied_at_ms,
           provider_descriptor_hash, created_at_ms, updated_at_ms
      FROM ge_cycle_schema WHERE singleton = 1
  `, 11, "schema singleton", nativeRetirementFor(nativeRetirements, "schema-envelope"), reprove);
  const schemaState = {
    createdAtMs: sqliteSafeInteger(schema[9], 0, Number.MAX_SAFE_INTEGER, OPERATION, "schema creation time"),
    currentVersion: sqliteSafeInteger(schema[0], 1, 1, OPERATION, "schema version"),
    latestMigrationAppliedAtMs: sqliteSafeInteger(schema[7], 0, Number.MAX_SAFE_INTEGER, OPERATION, "latest migration time"),
    latestMigrationSha256: sqliteText(schema[6], OPERATION, "latest migration hash"),
    maxReaderVersion: sqliteSafeInteger(schema[2], 1, 1, OPERATION, "maximum reader version"),
    maxWriterVersion: sqliteSafeInteger(schema[4], 1, 1, OPERATION, "maximum writer version"),
    minReaderVersion: sqliteSafeInteger(schema[1], 1, 1, OPERATION, "minimum reader version"),
    minWriterVersion: sqliteSafeInteger(schema[3], 1, 1, OPERATION, "minimum writer version"),
    providerDescriptorHash: sqliteText(schema[8], OPERATION, "provider descriptor hash"),
    schemaIdentitySha256: sqliteText(schema[5], OPERATION, "schema identity"),
    updatedAtMs: sqliteSafeInteger(schema[10], 0, Number.MAX_SAFE_INTEGER, OPERATION, "schema update time"),
  };
  if (schemaState.providerDescriptorHash !== sourceEnvelope.sourceDescriptorHash
      || schemaState.schemaIdentitySha256 !== sourceEnvelope.sourceSchemaIdentitySha256
      || schemaState.latestMigrationSha256 !== sourceEnvelope.sourceMigrationLineageSha256
      || schemaState.latestMigrationAppliedAtMs !== expectedMigrationAppliedAtMs) {
    return fail("SQLite v1 baseline schema envelope identity drifted");
  }
  yield validatedEntry("schema-envelope", { scope: "cycle-store" }, schemaState);

  requireCaptureTransaction(connection, guard);
  const migration = exactlyOne(connection, `
    SELECT version, previous_version, migration_id, sql_sha256,
           schema_identity_sha256, applied_at_ms, reversibility,
           postconditions_blob
      FROM ge_cycle_migrations
     ORDER BY CAST(version AS TEXT) COLLATE BINARY
  `, 8, "migration lineage", nativeRetirementFor(nativeRetirements, "migration-lineage"), reprove);
  const postconditionsBlob = sqliteBlob(migration[7], OPERATION, "migration postconditions");
  let postconditions: unknown;
  try {
    postconditions = decodeOperationBaselineCanonicalBytes(postconditionsBlob, 1_048_576);
  } catch {
    return fail("SQLite v1 baseline migration postconditions are invalid");
  }
  if (canonicalSerialize(postconditions) !== EXPECTED_POSTCONDITIONS) {
    return fail("SQLite v1 baseline migration postconditions drifted");
  }
  const migrationState = {
    appliedAtMs: sqliteSafeInteger(migration[5], 0, Number.MAX_SAFE_INTEGER, OPERATION, "migration time"),
    migrationId: sqliteText(migration[2], OPERATION, "migration ID"),
    postconditions: FROZEN_POSTCONDITIONS,
    previousVersion: sqliteSafeInteger(migration[1], 0, 0, OPERATION, "previous migration version"),
    reversibility: sqliteText(migration[6], OPERATION, "migration reversibility"),
    schemaIdentitySha256: sqliteText(migration[4], OPERATION, "migration schema identity"),
    sqlSha256: sqliteText(migration[3], OPERATION, "migration SQL hash"),
    version: sqliteSafeInteger(migration[0], 1, 1, OPERATION, "migration version"),
  };
  if (migrationState.migrationId !== sourceEnvelope.sourceMigrationLineageId
      || migrationState.sqlSha256 !== sourceEnvelope.sourceMigrationLineageSha256
      || migrationState.schemaIdentitySha256 !== sourceEnvelope.sourceSchemaIdentitySha256
      || migrationState.appliedAtMs !== expectedMigrationAppliedAtMs
      || migrationState.appliedAtMs !== schemaState.latestMigrationAppliedAtMs) {
    return fail("SQLite v1 baseline migration lineage identity drifted");
  }
  const frozenLineage = (migrationState.migrationId === "fresh-v1-baseline"
      && migrationState.sqlSha256 === SQLITE_SCHEMA_SQL_SHA256)
    || (migrationState.migrationId === "alpha-v0-to-v1"
      && migrationState.sqlSha256 === SQLITE_ALPHA_V0_TO_V1_SQL_SHA256);
  if (!frozenLineage
      || schemaState.schemaIdentitySha256 !== SQLITE_SCHEMA_IDENTITY_SHA256
      || schemaState.providerDescriptorHash !== SQLITE_CYCLE_STORE_DESCRIPTOR_HASH) {
    return fail("SQLite v1 baseline frozen source identity drifted");
  }
  yield validatedEntry("migration-lineage", { version: migrationState.version }, migrationState);

  let streamCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, tail_sequence, tail_record_hash,
           created_at_ms, updated_at_ms
      FROM ge_cycle_streams
     ORDER BY stream_id COLLATE BINARY, tenant_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "stream-head"), reprove)) {
    streamCount += 1;
    const row = sqliteRow(raw, 6, OPERATION, "stream head");
    const state = {
      createdAtMs: sqliteSafeInteger(row[4], 0, Number.MAX_SAFE_INTEGER, OPERATION, "stream creation time"),
      streamId: sqliteText(row[1], OPERATION, "stream ID"),
      tailRecordHash: sqliteNullableText(row[3], OPERATION, "stream tail record hash"),
      tailSequence: sqliteSafeInteger(row[2], -1, Number.MAX_SAFE_INTEGER, OPERATION, "stream tail sequence"),
      tenantId: sqliteText(row[0], OPERATION, "stream tenant ID"),
      updatedAtMs: sqliteSafeInteger(row[5], 0, Number.MAX_SAFE_INTEGER, OPERATION, "stream update time"),
    };
    yield validatedEntry(
      "stream-head",
      { streamId: state.streamId, tenantId: state.tenantId },
      state,
    );
  }
  if (streamCount !== countsByKind["stream-head"]) {
    return fail("SQLite v1 baseline stream-head count changed during capture");
  }

  let recordCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, sequence, record_id, previous_record_hash,
           value_hash, value_bytes, value_blob, record_hash, record_blob,
           committed_at_ms
      FROM ge_cycle_records
     ORDER BY record_id COLLATE BINARY, tenant_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "record-identity"), reprove)) {
    recordCount += 1;
    const row = sqliteRow(raw, 11, OPERATION, "record identity");
    const tenantId = sqliteText(row[0], OPERATION, "record tenant ID");
    const streamId = sqliteText(row[1], OPERATION, "record stream ID");
    const sequence = sqliteSafeInteger(row[2], 0, Number.MAX_SAFE_INTEGER, OPERATION, "record sequence");
    const recordId = sqliteText(row[3], OPERATION, "record ID");
    const previousRecordHash = sqliteNullableText(row[4], OPERATION, "previous record hash");
    const valueHash = sqliteText(row[5], OPERATION, "record value hash");
    const valueBytes = sqliteSafeInteger(row[6], 1, 1_048_576, OPERATION, "record value bytes");
    const valueBlob = sqliteBlob(row[7], OPERATION, "record value blob");
    const recordHash = sqliteText(row[8], OPERATION, "record hash");
    const recordBlob = sqliteBlob(row[9], OPERATION, "record blob");
    const record = cycleStoreAdapterCodec.parseStoredRecord(recordBlob, OPERATION);
    if (recordBlob.byteLength < valueBytes
        || recordBlob.byteLength > 2_097_152
        || valueBlob.byteLength !== valueBytes
        || record.recordId !== recordId
        || record.sequence !== sequence
        || record.previousRecordHash !== previousRecordHash
        || record.valueHash !== valueHash
        || record.valueBytes !== valueBytes
        || record.recordHash !== recordHash
        || !recordBlob.equals(Buffer.from(canonicalSerialize(record), "utf8"))
        || !valueBlob.equals(Buffer.from(canonicalSerialize(record.value), "utf8"))
        || canonicalHash(record.value) !== valueHash) {
      return fail("SQLite v1 baseline record carrier identity drifted");
    }
    const state = {
      committedAtMs: sqliteSafeInteger(row[10], 0, Number.MAX_SAFE_INTEGER, OPERATION, "record commit time"),
      previousRecordHash,
      recordHash,
      recordId,
      sequence,
      streamId,
      tenantId,
      valueBytes,
      valueHash,
    };
    yield validatedEntry("record-identity", { recordId, tenantId }, state);
  }
  if (recordCount !== countsByKind["record-identity"]) {
    return fail("SQLite v1 baseline record-identity count changed during capture");
  }

  let checkpointCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, checkpoint_scope, checkpoint_id, stream_id,
           bound_sequence, bound_record_hash, created_at, value_hash,
           value_bytes, value_blob, checkpoint_blob, summary_blob,
           checkpoint_revision, committed_at_ms
      FROM ge_cycle_checkpoints
     ORDER BY checkpoint_id COLLATE BINARY,
              checkpoint_scope COLLATE BINARY,
              tenant_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "checkpoint-current"), reprove)) {
    checkpointCount += 1;
    const row = sqliteRow(raw, 14, OPERATION, "checkpoint current");
    const tenantId = sqliteText(row[0], OPERATION, "checkpoint tenant ID");
    const checkpointScope = sqliteText(row[1], OPERATION, "checkpoint scope");
    const checkpointId = sqliteText(row[2], OPERATION, "checkpoint ID");
    const streamId = sqliteText(row[3], OPERATION, "checkpoint stream ID");
    const boundSequence = sqliteSafeInteger(row[4], 0, Number.MAX_SAFE_INTEGER, OPERATION, "checkpoint sequence");
    const boundRecordHash = sqliteText(row[5], OPERATION, "checkpoint record hash");
    const createdAt = sqliteText(row[6], OPERATION, "checkpoint creation time");
    const valueHash = sqliteText(row[7], OPERATION, "checkpoint value hash");
    const valueBytes = sqliteSafeInteger(row[8], 1, 16_777_216, OPERATION, "checkpoint value bytes");
    const valueBlob = sqliteBlob(row[9], OPERATION, "checkpoint value blob");
    const checkpointBlob = sqliteBlob(row[10], OPERATION, "checkpoint blob");
    const summaryBlob = sqliteBlob(row[11], OPERATION, "checkpoint summary blob");
    const checkpointRevision = sqliteSafeInteger(row[12], 1, Number.MAX_SAFE_INTEGER, OPERATION, "checkpoint revision");
    const committedAtMs = sqliteSafeInteger(row[13], 0, Number.MAX_SAFE_INTEGER, OPERATION, "checkpoint commit time");
    let checkpoint: CycleStoreCheckpoint;
    try {
      checkpoint = cycleStoreAdapterCodec.parseStoredCheckpoint(checkpointBlob, OPERATION);
    } catch {
      return fail("SQLite v1 baseline checkpoint carrier is invalid");
    }
    const { value: _value, ...expectedSummary } = checkpoint;
    const summary = decodedCheckpointSummary(summaryBlob);
    if (checkpointBlob.byteLength < valueBytes
        || checkpointBlob.byteLength > 17_825_792
        || valueBlob.byteLength !== valueBytes
        || checkpoint.checkpointScope !== checkpointScope
        || checkpoint.checkpointId !== checkpointId
        || checkpoint.streamId !== streamId
        || checkpoint.boundSequence !== boundSequence
        || checkpoint.boundRecordHash !== boundRecordHash
        || checkpoint.createdAt !== createdAt
        || checkpoint.valueHash !== valueHash
        || checkpoint.valueBytes !== valueBytes
        || !checkpointBlob.equals(Buffer.from(canonicalSerialize(checkpoint), "utf8"))
        || !valueBlob.equals(Buffer.from(canonicalSerialize(checkpoint.value), "utf8"))
        || canonicalHash(checkpoint.value) !== valueHash
        || canonicalSerialize(summary) !== canonicalSerialize(expectedSummary)) {
      return fail("SQLite v1 baseline checkpoint carrier identity drifted");
    }
    const state = {
      boundRecordHash,
      boundSequence,
      checkpointId,
      checkpointRevision,
      checkpointScope,
      committedAtMs,
      createdAt,
      streamId,
      summary,
      tenantId,
      valueBytes,
      valueHash,
    };
    yield validatedEntry(
      "checkpoint-current",
      { checkpointId, checkpointScope, tenantId },
      state,
    );
  }
  if (checkpointCount !== countsByKind["checkpoint-current"]) {
    return fail("SQLite v1 baseline checkpoint-current count changed during capture");
  }

  let revisionCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, checkpoint_scope, revision, checkpoint_id, action,
           summary_blob, bound_sequence, bound_record_hash,
           checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
      FROM ge_cycle_checkpoint_revisions
     ORDER BY checkpoint_scope COLLATE BINARY,
              CAST(revision AS TEXT) COLLATE BINARY,
              tenant_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "checkpoint-revision"), reprove)) {
    revisionCount += 1;
    const row = sqliteRow(raw, 12, OPERATION, "checkpoint revision");
    const tenantId = sqliteText(row[0], OPERATION, "revision tenant ID");
    const checkpointScope = sqliteText(row[1], OPERATION, "revision scope");
    const revision = sqliteSafeInteger(row[2], 1, Number.MAX_SAFE_INTEGER, OPERATION, "revision number");
    const checkpointId = sqliteText(row[3], OPERATION, "revision checkpoint ID");
    const action = sqliteText(row[4], OPERATION, "revision action");
    const recordedAtMs = sqliteSafeInteger(row[11], 0, Number.MAX_SAFE_INTEGER, OPERATION, "revision record time");
    let summary: Readonly<Record<string, unknown>> | null = null;
    let boundSequence: number | null = null;
    let boundRecordHash: string | null = null;
    let checkpointCreatedAt: string | null = null;
    let valueHash: string | null = null;
    let valueBytes: number | null = null;
    if (action === "put") {
      summary = decodedCheckpointSummary(sqliteBlob(row[5], OPERATION, "revision summary blob"));
      boundSequence = sqliteSafeInteger(row[6], 0, Number.MAX_SAFE_INTEGER, OPERATION, "revision sequence");
      boundRecordHash = sqliteText(row[7], OPERATION, "revision record hash");
      checkpointCreatedAt = sqliteText(row[8], OPERATION, "revision checkpoint time");
      valueHash = sqliteText(row[9], OPERATION, "revision value hash");
      valueBytes = sqliteSafeInteger(row[10], 1, 16_777_216, OPERATION, "revision value bytes");
      if (summary.checkpointScope !== checkpointScope
          || summary.checkpointId !== checkpointId
          || summary.boundSequence !== boundSequence
          || summary.boundRecordHash !== boundRecordHash
          || summary.createdAt !== checkpointCreatedAt
          || summary.valueHash !== valueHash
          || summary.valueBytes !== valueBytes) {
        return fail("SQLite v1 baseline checkpoint revision identity drifted");
      }
    } else if (action === "delete") {
      const deletedTail = reflectApplyDefinitionIntrinsic(
        arraySliceDefinitionIntrinsic,
        row,
        [5, 11],
      ) as unknown[];
      if (reflectApplyDefinitionIntrinsic(
        arraySomeDefinitionIntrinsic,
        deletedTail,
        [(value: unknown) => value !== null],
      ) as boolean) {
        return fail("SQLite v1 baseline checkpoint delete revision is invalid");
      }
    } else {
      return fail("SQLite v1 baseline checkpoint revision action is invalid");
    }
    const state = {
      action,
      boundRecordHash,
      boundSequence,
      checkpointCreatedAt,
      checkpointId,
      checkpointScope,
      recordedAtMs,
      revision,
      summary,
      tenantId,
      valueBytes,
      valueHash,
    };
    yield validatedEntry(
      "checkpoint-revision",
      { checkpointScope, revision, tenantId },
      state,
    );
  }
  if (revisionCount !== countsByKind["checkpoint-revision"]) {
    return fail("SQLite v1 baseline checkpoint-revision count changed during capture");
  }

  let leaseCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, active_lease_id, active_holder_id,
           active_lease_epoch, active_fencing_token, active_acquired_at_ms,
           active_expires_at_ms, last_lease_epoch, last_fencing_token,
           updated_at_ms
      FROM ge_cycle_leases
     ORDER BY stream_id COLLATE BINARY, tenant_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "lease-current"), reprove)) {
    leaseCount += 1;
    const row = sqliteRow(raw, 11, OPERATION, "lease current");
    const tenantId = sqliteText(row[0], OPERATION, "lease tenant ID");
    const streamId = sqliteText(row[1], OPERATION, "lease stream ID");
    yield validatedEntry(
      "lease-current",
      { streamId, tenantId },
      {
        activeAcquiredAtMs: nullableInteger(row[6], 0, "lease acquisition time"),
        activeExpiresAtMs: nullableInteger(row[7], 0, "lease expiry time"),
        activeFencingToken: nullableInteger(row[5], 1, "lease fencing token"),
        activeHolderId: nullableText(row[3], "lease holder ID"),
        activeLeaseEpoch: nullableInteger(row[4], 1, "lease epoch"),
        activeLeaseId: nullableText(row[2], "lease ID"),
        lastFencingToken: sqliteSafeInteger(row[9], 0, Number.MAX_SAFE_INTEGER, OPERATION, "last lease fencing token"),
        lastLeaseEpoch: sqliteSafeInteger(row[8], 0, Number.MAX_SAFE_INTEGER, OPERATION, "last lease epoch"),
        streamId,
        tenantId,
        updatedAtMs: sqliteSafeInteger(row[10], 0, Number.MAX_SAFE_INTEGER, OPERATION, "lease update time"),
      },
    );
  }
  if (leaseCount !== countsByKind["lease-current"]) {
    return fail("SQLite v1 baseline lease-current count changed during capture");
  }

  let usedLeaseCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
           first_used_at_ms
      FROM ge_cycle_used_lease_ids
     ORDER BY lease_id COLLATE BINARY, stream_id COLLATE BINARY,
              tenant_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "used-lease-identity"), reprove)) {
    usedLeaseCount += 1;
    const row = sqliteRow(raw, 6, OPERATION, "used lease identity");
    const tenantId = sqliteText(row[0], OPERATION, "used lease tenant ID");
    const streamId = sqliteText(row[1], OPERATION, "used lease stream ID");
    const leaseId = sqliteText(row[2], OPERATION, "used lease ID");
    yield validatedEntry(
      "used-lease-identity",
      { leaseId, streamId, tenantId },
      {
        fencingToken: sqliteSafeInteger(row[4], 1, Number.MAX_SAFE_INTEGER, OPERATION, "used lease fencing token"),
        firstUsedAtMs: sqliteSafeInteger(row[5], 0, Number.MAX_SAFE_INTEGER, OPERATION, "used lease first-use time"),
        leaseEpoch: sqliteSafeInteger(row[3], 1, Number.MAX_SAFE_INTEGER, OPERATION, "used lease epoch"),
        leaseId,
        streamId,
        tenantId,
      },
    );
  }
  if (usedLeaseCount !== countsByKind["used-lease-identity"]) {
    return fail("SQLite v1 baseline used-lease-identity count changed during capture");
  }

  let holdCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, stream_id, hold_id, placed_at_ms
      FROM ge_cycle_legal_holds
     ORDER BY hold_id COLLATE BINARY, stream_id COLLATE BINARY,
              tenant_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "legal-hold"), reprove)) {
    holdCount += 1;
    const row = sqliteRow(raw, 4, OPERATION, "legal hold");
    const tenantId = sqliteText(row[0], OPERATION, "hold tenant ID");
    const streamId = sqliteText(row[1], OPERATION, "hold stream ID");
    const holdId = sqliteText(row[2], OPERATION, "hold ID");
    yield validatedEntry(
      "legal-hold",
      { holdId, streamId, tenantId },
      {
        holdId,
        placedAtMs: sqliteSafeInteger(row[3], 0, Number.MAX_SAFE_INTEGER, OPERATION, "hold placement time"),
        streamId,
        tenantId,
      },
    );
  }
  if (holdCount !== countsByKind["legal-hold"]) {
    return fail("SQLite v1 baseline legal-hold count changed during capture");
  }

  requireCaptureTransaction(connection, guard);
  const lock = exactlyOne(connection, `
    SELECT singleton, active_lock_id, active_owner_id, active_source_version,
           active_target_version, active_lock_epoch, active_fencing_token,
           active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
           last_fencing_token, updated_at_ms
      FROM ge_cycle_migration_lock WHERE singleton = 1
  `, 12, "migration lock singleton", nativeRetirementFor(nativeRetirements, "migration-lock-current"), reprove);
  const lockState = {
    activeAcquiredAtMs: nullableInteger(lock[7], 0, "active migration acquisition time"),
    activeExpiresAtMs: nullableInteger(lock[8], 0, "active migration expiry time"),
    activeFencingToken: nullableInteger(lock[6], 1, "active migration fencing token"),
    activeLockEpoch: nullableInteger(lock[5], 1, "active migration lock epoch"),
    activeLockId: nullableText(lock[1], "active migration lock ID"),
    activeOwnerId: nullableText(lock[2], "active migration owner ID"),
    activeSourceVersion: nullableInteger(lock[3], 1, "active migration source version"),
    activeTargetVersion: nullableInteger(lock[4], 2, "active migration target version"),
    lastFencingToken: sqliteSafeInteger(lock[10], 0, Number.MAX_SAFE_INTEGER, OPERATION, "last migration fencing token"),
    lastLockEpoch: sqliteSafeInteger(lock[9], 0, Number.MAX_SAFE_INTEGER, OPERATION, "last migration lock epoch"),
    singleton: sqliteSafeInteger(lock[0], 1, 1, OPERATION, "migration lock singleton"),
    updatedAtMs: sqliteSafeInteger(lock[11], 0, Number.MAX_SAFE_INTEGER, OPERATION, "migration lock update time"),
  };
  yield validatedEntry("migration-lock-current", { singleton: 1 }, lockState);

  let usedLockCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT lock_id, lock_epoch, fencing_token, first_used_at_ms
      FROM ge_cycle_used_migration_lock_ids
     ORDER BY lock_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "used-migration-lock-identity"), reprove)) {
    usedLockCount += 1;
    const row = sqliteRow(raw, 4, OPERATION, "used migration lock identity");
    const lockId = sqliteText(row[0], OPERATION, "used migration lock ID");
    yield validatedEntry(
      "used-migration-lock-identity",
      { lockId },
      {
        fencingToken: sqliteSafeInteger(row[2], 1, Number.MAX_SAFE_INTEGER, OPERATION, "used migration lock fencing token"),
        firstUsedAtMs: sqliteSafeInteger(row[3], 0, Number.MAX_SAFE_INTEGER, OPERATION, "used migration lock first-use time"),
        lockEpoch: sqliteSafeInteger(row[1], 1, Number.MAX_SAFE_INTEGER, OPERATION, "used migration lock epoch"),
        lockId,
      },
    );
  }
  if (usedLockCount !== countsByKind["used-migration-lock-identity"]) {
    return fail("SQLite v1 baseline used-migration-lock-identity count changed during capture");
  }

  let legacyCount = 0;
  for (const raw of transactionRows(connection, guard, `
    SELECT tenant_id, operation_id, operation_name, request_hash,
           result_blob, result_hash, committed_at_ms
      FROM ge_cycle_operations
     ORDER BY operation_id COLLATE BINARY, tenant_id COLLATE BINARY
  `, nativeRetirementFor(nativeRetirements, "legacy-operation"), reprove)) {
    legacyCount += 1;
    const row = sqliteRow(raw, 7, OPERATION, "legacy operation");
    const tenantId = sqliteText(row[0], OPERATION, "legacy operation tenant ID");
    const operationId = sqliteText(row[1], OPERATION, "legacy operation ID");
    const operationName = legacyOperation(row[2]);
    const requestHash = sqliteText(row[3], OPERATION, "legacy operation request hash");
    const resultBlob = sqliteBlob(row[4], OPERATION, "legacy operation result blob");
    const resultHash = sqliteText(row[5], OPERATION, "legacy operation result hash");
    yield validatedEntry(
      "legacy-operation",
      { operationId, tenantId },
      {
        committedAtMs: sqliteSafeInteger(
          row[6],
          0,
          Number.MAX_SAFE_INTEGER,
          OPERATION,
          "legacy operation commit time",
        ),
        operationId,
        operationName,
        requestHash,
        resultBlobSha256: legacyResultBlobSha256(operationName, resultBlob, resultHash),
        resultHash,
        tenantId,
      },
    );
  }
  if (legacyCount !== countsByKind["legacy-operation"]) {
    return fail("SQLite v1 baseline legacy-operation count changed during capture");
  }
}

const COUNT_SQL = `SELECT
  (SELECT count(*) FROM ge_cycle_schema),
  (SELECT count(*) FROM ge_cycle_migrations),
  (SELECT count(*) FROM ge_cycle_streams),
  (SELECT count(*) FROM ge_cycle_records),
  (SELECT count(*) FROM ge_cycle_checkpoints),
  (SELECT count(*) FROM ge_cycle_checkpoint_revisions),
  (SELECT count(*) FROM ge_cycle_leases),
  (SELECT count(*) FROM ge_cycle_used_lease_ids),
  (SELECT count(*) FROM ge_cycle_legal_holds),
  (SELECT count(*) FROM ge_cycle_migration_lock),
  (SELECT count(*) FROM ge_cycle_used_migration_lock_ids),
  (SELECT count(*) FROM ge_cycle_operations)`;

/**
 * Every provider-owned observation clock except the two owned by cursors.
 *
 * `ge_cycle_cursors.created_at_ms` and its non-null `consumed_at_ms` are the
 * only branches removed from the earlier combined maximum: the future Slice B
 * cursor campaign will compare them with the same high-water and own their
 * diagnostic. Every other
 * previously covered observation is retained here unchanged.
 */
export const SQLITE_V1_BASELINE_MAXIMUM_NON_CURSOR_OBSERVED_SQL = `SELECT max(observed_at_ms) FROM (
  SELECT created_at_ms AS observed_at_ms FROM ge_cycle_schema
  UNION ALL SELECT updated_at_ms FROM ge_cycle_schema
  UNION ALL SELECT latest_migration_applied_at_ms FROM ge_cycle_schema
  UNION ALL SELECT applied_at_ms FROM ge_cycle_migrations
  UNION ALL SELECT created_at_ms FROM ge_cycle_streams
  UNION ALL SELECT updated_at_ms FROM ge_cycle_streams
  UNION ALL SELECT committed_at_ms FROM ge_cycle_records
  UNION ALL SELECT committed_at_ms FROM ge_cycle_operations
  UNION ALL SELECT committed_at_ms FROM ge_cycle_checkpoints
  UNION ALL SELECT recorded_at_ms FROM ge_cycle_checkpoint_revisions
  UNION ALL SELECT updated_at_ms FROM ge_cycle_leases
  UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_lease_ids
  UNION ALL SELECT placed_at_ms FROM ge_cycle_legal_holds
  UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_migration_lock_ids
  UNION ALL SELECT updated_at_ms FROM ge_cycle_migration_lock
)`;

/** Capture bounded source identity/count evidence inside a caller-owned transaction. */
export function captureSQLiteV1BaselineSourceSummary(
  connection: SQLiteConnection,
  capturedAtMs: number,
): SQLiteV1BaselineSourceSummary {
  if (!connection.isTransaction || connection.transactionMode !== "exclusive") {
    return fail("SQLite v1 baseline capture requires an active EXCLUSIVE transaction");
  }
  const captured = capturedAt(capturedAtMs);
  const applicationId = sqliteSafeInteger(
    sqliteRow(
      connection.prepare(
        "SELECT application_id FROM pragma_application_id",
        OPERATION,
      ).get(),
      1,
      OPERATION,
      "application ID",
    )[0],
    1195724359,
    1195724359,
    OPERATION,
    "application ID",
  );
  const pragmaUserVersion = sqliteSafeInteger(
    sqliteRow(
      connection.prepare(
        "SELECT user_version FROM pragma_user_version",
        OPERATION,
      ).get(),
      1,
      OPERATION,
      "user version",
    )[0],
    1,
    1,
    OPERATION,
    "user version",
  );
  const source = sqliteRow(connection.prepare(`
    SELECT schema_row.current_version, schema_row.schema_identity_sha256,
           schema_row.provider_descriptor_hash, migration.migration_id,
           migration.sql_sha256, schema_row.latest_migration_applied_at_ms,
           migration.applied_at_ms
      FROM ge_cycle_schema AS schema_row
      JOIN ge_cycle_migrations AS migration
        ON migration.version = schema_row.current_version
     WHERE schema_row.singleton = 1
  `, OPERATION).get(), 7, OPERATION, "v1 source identity");
  const sourceUserVersion = sqliteSafeInteger(source[0], 1, 1, OPERATION, "source version");
  if (sourceUserVersion !== pragmaUserVersion) {
    return fail("SQLite v1 baseline schema and PRAGMA versions differ");
  }
  const expectedMigrationAppliedAtMs = sqliteSafeInteger(
    source[5],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "schema latest migration time",
  );
  const capturedMigrationAppliedAtMs = sqliteSafeInteger(
    source[6],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "migration application time",
  );
  if (expectedMigrationAppliedAtMs !== capturedMigrationAppliedAtMs) {
    return fail("SQLite v1 baseline migration application times differ");
  }
  const sourceEnvelope: OperationBaselineSourceEnvelope = {
    capturedAtMs: captured,
    sourceApplicationId: applicationId as 1195724359,
    sourceDescriptorHash: sqliteText(source[2], OPERATION, "source descriptor hash"),
    sourceMigrationLineageId: sqliteText(source[3], OPERATION, "source migration ID"),
    sourceMigrationLineageSha256: sqliteText(source[4], OPERATION, "source migration hash"),
    sourceSchemaIdentitySha256: sqliteText(source[1], OPERATION, "source schema identity"),
    sourceUserVersion: sourceUserVersion as 1,
  };
  encodeOperationBaselineSourceEnvelope(sourceEnvelope);

  const rawCounts = sqliteRow(
    connection.prepare(COUNT_SQL, OPERATION).get(),
    BASELINE_ENTRY_KINDS.length,
    OPERATION,
    "baseline source counts",
  );
  const bigintCounts = reflectApplyDefinitionIntrinsic(
    arrayMapDefinitionIntrinsic,
    rawCounts,
    [(value: unknown, index: number) =>
      safeBigInt(value, `${BASELINE_ENTRY_KINDS[index]} count`)],
  ) as bigint[];
  const total = reflectApplyDefinitionIntrinsic(
    arrayReduceDefinitionIntrinsic,
    bigintCounts,
    [(sum: bigint, value: bigint) => sum + value, 0n],
  ) as bigint;
  if (total > MAX_SAFE_BIGINT) return fail("SQLite v1 baseline total count is outside bounds");
  const countEntries = reflectApplyDefinitionIntrinsic(
    arrayMapDefinitionIntrinsic,
    BASELINE_ENTRY_KINDS,
    [(kind: OperationBaselineEntryKind, index: number) =>
      [kind, Number(bigintCounts[index])] as const],
  ) as readonly (readonly [OperationBaselineEntryKind, number])[];
  const countsByKind = objectFreezeDefinitionIntrinsic(
    objectFromEntriesDefinitionIntrinsic(countEntries),
  ) as SQLiteV1BaselineCounts;

  const maximumNonCursorObservedAtMs = sqliteSafeInteger(
    sqliteRow(connection.prepare(SQLITE_V1_BASELINE_MAXIMUM_NON_CURSOR_OBSERVED_SQL, OPERATION).get(), 1, OPERATION, "non-cursor provider clock")[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "non-cursor provider clock",
  );
  const providerHighWaterAtMs = sqliteSafeInteger(
    sqliteRow(connection.prepare("SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1", OPERATION).get(), 1, OPERATION, "migration lock high-water")[0],
    0,
    Number.MAX_SAFE_INTEGER,
    OPERATION,
    "migration lock high-water",
  );
  if (providerHighWaterAtMs < maximumNonCursorObservedAtMs) {
    return fail("SQLite v1 provider clock high-water predates non-cursor source state");
  }
  if (captured < providerHighWaterAtMs) {
    return fail("SQLite v1 baseline capture predates provider clock high-water");
  }
  const clockEvidence: SQLiteV1BaselineClockEvidence = objectFreezeDefinitionIntrinsic({
    capturedAtMs: captured,
    maximumNonCursorObservedAtMs,
    providerHighWaterAtMs,
  });
  const transactionGuard: SQLiteV1BaselineTransactionGuard = objectFreezeDefinitionIntrinsic({
    totalChanges: totalChanges(connection),
    transactionEpoch: connection.transactionEpoch,
  });
  requireCaptureTransaction(connection, transactionGuard);
  const frozenEnvelope = objectFreezeDefinitionIntrinsic(sourceEnvelope);
  let entriesTaken = false;
  let cooperativeHandoffStage: object | undefined;
  let cooperativeHandoffTotalChanges: number | undefined;
  let cooperativeStreamCompleted = false;
  const takeEntries = (guard: SQLiteV1BaselineTransactionGuard): Generator<
    OperationBaselineEntryInput,
    void,
    undefined
  > => takeEntriesWithRetirements(guard);
  const takeEntriesWithRetirements = (
    guard: SQLiteV1BaselineTransactionGuard,
    nativeRetirements?: ReadonlyMap<
      OperationBaselineEntryKind,
      MutableNativeFamilyRetirement
    >,
    reprove?: () => void,
  ): Generator<OperationBaselineEntryInput, void, undefined> => {
    const implementedKindValues = [
      "schema-envelope",
      "migration-lineage",
      "stream-head",
      "record-identity",
      "checkpoint-current",
      "checkpoint-revision",
      "lease-current",
      "used-lease-identity",
      "legal-hold",
      "migration-lock-current",
      "used-migration-lock-identity",
      "legacy-operation",
    ] as const;
    const implementedKinds = new setConstructorDefinitionIntrinsic<
      OperationBaselineEntryKind
    >();
    for (let ordinal = 0; ordinal < implementedKindValues.length; ordinal += 1) {
      reflectApplyDefinitionIntrinsic(setAddDefinitionIntrinsic, implementedKinds, [
        implementedKindValues[ordinal]!,
      ]);
    }
    requireCaptureTransaction(connection, guard);
    if (countsByKind["schema-envelope"] !== 1
        || countsByKind["migration-lineage"] !== 1
        || countsByKind["migration-lock-current"] !== 1
        || reflectApplyDefinitionIntrinsic(
          arraySomeDefinitionIntrinsic,
          BASELINE_ENTRY_KINDS,
          [(kind: OperationBaselineEntryKind) =>
            !(reflectApplyDefinitionIntrinsic(
              setHasDefinitionIntrinsic,
              implementedKinds,
              [kind],
            ) as boolean) && countsByKind[kind] !== 0],
        ) as boolean) {
      return fail("SQLite v1 baseline iterator cannot cover unimplemented source families");
    }
    if (entriesTaken) return fail("SQLite v1 baseline source entries are one-shot");
    entriesTaken = true;
    return streamV1Entries(
      connection,
      frozenEnvelope,
      countsByKind,
      guard,
      expectedMigrationAppliedAtMs,
      nativeRetirements,
      reprove,
    );
  };
  const entries = (): Generator<OperationBaselineEntryInput, void, undefined> =>
    takeEntries(transactionGuard);
  const cooperativeEntries = (
    requestedConnection: SQLiteConnection,
    stage: SQLiteBaselineCooperativeStage,
  ): Generator<
    OperationBaselineEntryInput,
    void,
    SQLiteBaselineOwnedWriteReceipt | undefined
  > => {
    const cooperativeGuard: SQLiteV1BaselineTransactionGuard = {
      totalChanges: transactionGuard.totalChanges,
      transactionEpoch: transactionGuard.transactionEpoch,
    };
    return (function* cooperativeSourceGenerator() {
      let completed = false;
      let pending = false;
      let primaryFailure: unknown;
      let sequence = 0;
      let upstream: Generator<OperationBaselineEntryInput, void, undefined> | undefined;
      try {
        if (requestedConnection !== connection) {
          fail("SQLite v1 baseline cooperative source connection is invalid");
        }
        upstream = takeEntries(cooperativeGuard);
        let next = upstream.next();
        while (!next.done) {
          const entry = next.value;
          pending = true;
          const receipt: SQLiteBaselineOwnedWriteReceipt | undefined = yield entry;
          if (!connection.isTransaction
              || connection.transactionMode !== "exclusive"
              || connection.transactionEpoch !== cooperativeGuard.transactionEpoch) {
            stage[SQLITE_BASELINE_COOPERATIVE_POISON](
              "SQLite baseline cooperative source transaction changed",
            );
          }
          // This is intentionally the last operation before stage consumption.
          const currentTotalChanges = totalChanges(connection);
          const acceptedTotalChanges = stage[SQLITE_BASELINE_CONSUME_OWNED_WRITE](
            connection,
            entry,
            receipt,
            sequence,
            cooperativeGuard.totalChanges,
            currentTotalChanges,
            cooperativeGuard.transactionEpoch,
          );
          // Independently fence DML injected during receipt validation.
          if (totalChanges(connection) !== acceptedTotalChanges) {
            stage[SQLITE_BASELINE_COOPERATIVE_POISON](
              "SQLite baseline cooperative receipt validation observed an unexplained write",
            );
          }
          cooperativeGuard.totalChanges = acceptedTotalChanges;
          requireCaptureTransaction(connection, cooperativeGuard);
          pending = false;
          sequence += 1;
          next = upstream.next();
        }
        if (sequence !== Number(total)) {
          stage[SQLITE_BASELINE_COOPERATIVE_POISON](
            "SQLite baseline cooperative source count is invalid",
          );
        }
        stage[SQLITE_BASELINE_FINISH_COOPERATIVE_WRITES](
          connection,
          sequence,
          cooperativeGuard.totalChanges,
          totalChanges(connection),
          cooperativeGuard.transactionEpoch,
        );
        cooperativeHandoffStage = stage;
        cooperativeHandoffTotalChanges = cooperativeGuard.totalChanges;
        cooperativeStreamCompleted = true;
        completed = true;
      } catch (error) {
        primaryFailure = error;
        try {
          stage[SQLITE_BASELINE_COOPERATIVE_POISON](
            "SQLite baseline cooperative source stream failed",
          );
        } catch {
          // Preserve the exact source, receipt, or writer failure.
        }
      } finally {
        try {
          upstream?.return?.();
        } catch (error) {
          primaryFailure ??= error;
        }
        if (!completed && pending) {
          try {
            stage[SQLITE_BASELINE_COOPERATIVE_POISON](
              "SQLite baseline cooperative source receipt was skipped",
            );
          } catch (error) {
            primaryFailure ??= error;
          }
        }
        if (primaryFailure !== undefined) throw primaryFailure;
      }
    })();
  };
  const orderedHandoffSource = (
    requestedConnection: SQLiteConnection,
    stage: SQLiteBaselineOrderedHandoffStage,
  ): SQLiteBaselineOrderedHandoffSourceBinding => {
    if (requestedConnection !== connection
        || !cooperativeStreamCompleted
        || cooperativeHandoffStage !== stage
        || cooperativeHandoffTotalChanges === undefined
        || !connection.isTransaction
        || connection.transactionMode !== "exclusive"
        || connection.transactionEpoch !== transactionGuard.transactionEpoch
        || totalChanges(connection) !== cooperativeHandoffTotalChanges) {
      return stage[SQLITE_BASELINE_ABORT_ORDERED_HANDOFF](
        undefined,
        "SQLite baseline ordered handoff source binding is invalid",
      );
    }
    return objectFreezeDefinitionIntrinsic({
      countsByKind,
      expectedEntryCount: Number(total),
      sourceEnvelope: frozenEnvelope,
      totalChanges: cooperativeHandoffTotalChanges,
      transactionEpoch: transactionGuard.transactionEpoch,
    });
  };
  const summary = objectFreezeDefinitionIntrinsic({
    sourceEnvelope: frozenEnvelope,
    countsByKind,
    expectedEntryCount: Number(total),
    clockEvidence,
    entries,
    [SQLITE_BASELINE_COOPERATIVE_ENTRIES]: cooperativeEntries,
    [SQLITE_BASELINE_ORDERED_HANDOFF_SOURCE]: orderedHandoffSource,
  });
  reflectApplyDefinitionIntrinsic(weakMapSetDefinitionIntrinsic, CAPTURED_CURSOR_SOURCES, [
    summary,
    objectFreezeDefinitionIntrinsic({
    connection,
    nativeDrain: (reprove: () => void): SQLiteV1BaselineNativeDrainResult => {
      const retirements = new mapConstructorDefinitionIntrinsic<
        OperationBaselineEntryKind,
        MutableNativeFamilyRetirement
      >();
      for (let ordinal = 0; ordinal < BASELINE_ENTRY_KINDS.length; ordinal += 1) {
        const entryKind = BASELINE_ENTRY_KINDS[ordinal]!;
        reflectApplyDefinitionIntrinsic(mapSetDefinitionIntrinsic, retirements, [
          entryKind,
          {
            entryKind,
            expectedCount: countsByKind[entryKind],
            observedCount: 0,
            prepareCount: 0,
            retirementAttemptCount: 0,
            retirementKind: "iterator-return",
            retirementSuccessCount: 0,
            resourceIdentity: objectFreezeDefinitionIntrinsic(
              objectCreateDefinitionIntrinsic(null),
            ) as object,
            statementIdentity: undefined,
            iteratorIdentity: undefined,
            retiredIteratorIdentity: undefined,
            sqlSha256: undefined,
            normalizedSqlSha256: undefined,
            terminalCount: 0,
            terminalObserved: false,
          } satisfies MutableNativeFamilyRetirement,
        ]);
      }
      const retainedEntries: OperationBaselineEntryInput[] = [];
      const iterator = takeEntriesWithRetirements(transactionGuard, retirements, reprove);
      while (true) {
        reprove();
        const next = iterator.next();
        reprove();
        const done = next.done;
        reprove();
        if (done) break;
        reprove();
        reflectApplyDefinitionIntrinsic(arrayPushDefinitionIntrinsic, retainedEntries, [
          next.value,
        ]);
        reprove();
      }
      const familyRetirements = reflectApplyDefinitionIntrinsic(
        arrayMapDefinitionIntrinsic,
        BASELINE_ENTRY_KINDS,
        [(entryKind: OperationBaselineEntryKind) => {
        const evidence = reflectApplyDefinitionIntrinsic(
          mapGetDefinitionIntrinsic,
          retirements,
          [entryKind],
        ) as MutableNativeFamilyRetirement | undefined;
        if (evidence === undefined) {
          return fail(`SQLite v1 baseline ${entryKind} native retirement is missing`);
        }
        if (evidence.observedCount !== evidence.expectedCount
            || !evidence.terminalObserved
            || evidence.prepareCount !== 1
            || evidence.terminalCount !== 1
            || evidence.retirementAttemptCount !== 1
            || evidence.retirementSuccessCount !== 1
            || evidence.statementIdentity === undefined
            || evidence.iteratorIdentity === undefined
            || evidence.retiredIteratorIdentity !== evidence.iteratorIdentity
            || evidence.normalizedSqlSha256 === undefined
            || evidence.sqlSha256 === undefined) {
          return fail(`SQLite v1 baseline ${entryKind} native retirement is incomplete`);
        }
        return objectFreezeDefinitionIntrinsic({
          entryKind,
          expectedCount: evidence.expectedCount,
          observedCount: evidence.observedCount,
          prepareCount: 1 as const,
          retirementAttemptCount: 1 as const,
          retirementKind: evidence.retirementKind,
          retirementSuccessCount: 1 as const,
          normalizedSqlSha256: evidence.normalizedSqlSha256,
          sqlSha256: evidence.sqlSha256,
          terminalCount: 1 as const,
          terminalObserved: true as const,
        });
      }],
      ) as SQLiteV1BaselineNativeDrainResult["familyRetirements"];
      const resourceIdentities = objectFreezeDefinitionIntrinsic(
        reflectApplyDefinitionIntrinsic(
          arrayMapDefinitionIntrinsic,
          BASELINE_ENTRY_KINDS,
          [(entryKind: OperationBaselineEntryKind) => {
            const evidence = reflectApplyDefinitionIntrinsic(
              mapGetDefinitionIntrinsic,
              retirements,
              [entryKind],
            ) as MutableNativeFamilyRetirement | undefined;
            return evidence === undefined
              ? fail(`SQLite v1 baseline ${entryKind} native retirement is missing`)
              : evidence.resourceIdentity;
          }],
        ) as object[],
      );
      const uniqueResourceIdentities = new setConstructorDefinitionIntrinsic<object>();
      for (let ordinal = 0; ordinal < resourceIdentities.length; ordinal += 1) {
        const identity = resourceIdentities[ordinal]!;
        if (reflectApplyDefinitionIntrinsic(
          setHasDefinitionIntrinsic,
          uniqueResourceIdentities,
          [identity],
        ) as boolean) {
          return fail("SQLite v1 baseline native family resource identities collided");
        }
        reflectApplyDefinitionIntrinsic(setAddDefinitionIntrinsic, uniqueResourceIdentities, [
          identity,
        ]);
      }
      if (retainedEntries.length !== Number(total)) {
        return fail("SQLite v1 baseline lower-owned projection count is invalid");
      }
      return objectFreezeDefinitionIntrinsic({
        entries: objectFreezeDefinitionIntrinsic(retainedEntries),
        familyRetirements: objectFreezeDefinitionIntrinsic(familyRetirements),
        resourceIdentities,
      });
    },
    transactionEpoch: transactionGuard.transactionEpoch,
    }),
  ]);
  return summary;
}

/**
 * Fence a genuinely captured source against its exact live connection.
 *
 * This performs no SQL and deliberately does not compare the capture-time
 * `total_changes()`: once accepted, the existing TEMP stage owns all allowed
 * write-counter movement. Every invocation does synchronously re-prove the
 * active EXCLUSIVE mode and the original pre-TEMP transaction epoch.
 */
export function assertSQLiteV1BaselineCursorSourceProvenance(
  sourceSummary: SQLiteV1BaselineSourceSummary,
  connection: SQLiteConnection,
): void {
  const state = sourceSummary !== null && typeof sourceSummary === "object"
    ? reflectApplyDefinitionIntrinsic(weakMapGetDefinitionIntrinsic, CAPTURED_CURSOR_SOURCES, [
      sourceSummary as object,
    ]) as SQLiteV1BaselineCapturedSourceState | undefined
    : undefined;
  if (state === undefined
      || state.connection !== connection) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite v1 baseline captured source provenance is invalid",
    );
  }
  const first = readSQLiteConnectionOwnerSnapshot(connection);
  if (!first.isTransaction
      || first.transactionMode !== "exclusive"
      || first.transactionEpoch !== state.transactionEpoch) {
    return fail("SQLite v1 baseline captured transaction changed");
  }
  const final = readSQLiteConnectionOwnerSnapshot(connection);
  if (!final.isTransaction
      || final.transactionMode !== "exclusive"
      || final.transactionEpoch !== state.transactionEpoch
      || final.transactionEpoch !== first.transactionEpoch) {
    return fail("SQLite v1 baseline captured transaction changed");
  }
}

/**
 * Exhaust all twelve native source families and retain the exact normalized
 * projection behind an opaque lower-owned token. No caller projection, count,
 * SQL, descriptor, or route hint is accepted.
 */
function drainSQLiteV1BaselineLowerOwnedNativeProjectionIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
  beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt,
  composition: object,
  sourceSummary: SQLiteV1BaselineSourceSummary,
): SQLiteV1BaselineLowerOwnedNativeProjection {
  const state = sourceSummary !== null && typeof sourceSummary === "object"
    ? reflectApplyDefinitionIntrinsic(weakMapGetDefinitionIntrinsic, CAPTURED_CURSOR_SOURCES, [
      sourceSummary as object,
    ]) as SQLiteV1BaselineCapturedSourceState | undefined
    : undefined;
  if (state === undefined) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite v1 baseline lower-owned source is invalid",
    );
  }
  const reprove = (): void => {
    assertSQLiteCursorPublicationOwnerCompositionConnectionIntrinsic(
      owner,
      beginReceipt,
      composition,
      state.connection,
    );
    assertSQLiteV1BaselineCursorSourceProvenance(sourceSummary, state.connection);
  };
  reprove();
  const drained = state.nativeDrain(reprove);
  reprove();
  maybeThrowNativeProjectionFaultForTest("hash-before");
  const projectionSha256 = createHash("sha256")
    .update(SQLITE_V1_BASELINE_NATIVE_PROJECTION_DOMAIN)
    .update(canonicalSerialize(drained.entries))
    .digest("hex");
  maybeThrowNativeProjectionFaultForTest("hash-after");
  reprove();
  const retainedCount = drained.entries.length;
  const sourceEnvelopeSha256 = canonicalHash(sourceSummary.sourceEnvelope);
  const sourceSummarySha256 = canonicalHash({
    clockEvidence: sourceSummary.clockEvidence,
    countsByKind: sourceSummary.countsByKind,
    expectedEntryCount: sourceSummary.expectedEntryCount,
    sourceEnvelope: sourceSummary.sourceEnvelope,
  });
  // The opaque identity is the authority.  Its random commitment is evidence
  // only and is intentionally distinct from the deterministic projection hash.
  const readSessionIdentity = objectFreezeDefinitionIntrinsic(
    objectCreateDefinitionIntrinsic(null),
  ) as object;
  const readSessionNonce = randomBytesDefinitionIntrinsic(32);
  const readSessionSha256 = createHash("sha256")
    .update(SQLITE_V1_BASELINE_READ_SESSION_DOMAIN)
    .update(readSessionNonce)
    .update(projectionSha256)
    .update(sourceEnvelopeSha256)
    .update(sourceSummarySha256)
    .digest("hex");
  readSessionNonce.fill(0);
  reprove();
  maybeThrowNativeProjectionFaultForTest("mint-before");
  const token = objectFreezeDefinitionIntrinsic(objectCreateDefinitionIntrinsic(null)) as
    SQLiteV1BaselineLowerOwnedNativeProjection;
  const snapshot: SQLiteV1BaselineLowerOwnedNativeProjectionSnapshot =
    objectFreezeDefinitionIntrinsic({
    exactSourceConnection: true,
    exactBeginReceipt: true,
    exactComposition: true,
    exactOwner: true,
    exactResourcePairing: true,
    exactTransactionGeneration: true,
    exactTransactionLineage: true,
    expectedProjectionCount: sourceSummary.expectedEntryCount,
    exactReadSession: true,
    familyCount: 12,
    familyRetirements: drained.familyRetirements,
    fullExhausted: true,
    genuineZeroClaim: false,
    lifecycle: "retired",
    logicalNativeReadCount: 12,
    nativeSourceProvenance: true,
    physicalNativeIoCountClaimed: false,
    projectionSha256,
    readSessionSha256,
    retainedCount,
    routeId: "main.baseline-entries",
    sourceDomain: "sqlite-v1-baseline-source",
    sourceEnvelopeSha256,
    sourceSummarySha256,
    sqlAuthority: false,
    });
  reflectApplyDefinitionIntrinsic(
    weakMapSetDefinitionIntrinsic,
    LOWER_OWNED_NATIVE_PROJECTIONS,
    [token as object, {
    adopted: false,
    beginReceipt,
    composition,
    connection: state.connection,
    owner,
    retainedEntries: drained.entries,
    resourceIdentities: drained.resourceIdentities,
    readSessionIdentity,
    snapshot,
    sourceSummary,
    transactionEpoch: state.transactionEpoch,
    }],
  );
  maybeThrowNativeProjectionFaultForTest("mint-after");
  return token;
}

/**
 * Synchronously drain and hand the opaque lower token to the definition-time
 * P11 consumer.  The intermediate token is never observable by a caller and
 * every direct-call/source/native/consumer fault enters the exact P9 terminal
 * finalizer before returning control.
 */
export function captureAndConsumeSQLiteV1BaselineLowerOwnedNativeProjectionIntrinsic(
  owner: SQLiteCursorPublicationTransactionOwner,
  beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt,
  composition: object,
  sourceSummary: SQLiteV1BaselineSourceSummary,
): object {
  currentNativeProjectionFailureTelemetryForTest = {
    nativeReturnAttemptCount: 0,
    nativeReturnSuccessCount: 0,
    secondaryFailureCount: 0,
  };
  lastNativeProjectionFailureTelemetryForTest = undefined;
  try {
    if (!hasSQLiteCursorPublicationNativeProjectionConsumerDefinitionIntrinsic()) {
      throw new Error("SQLite native projection consumer is unavailable");
    }
    const projection = drainSQLiteV1BaselineLowerOwnedNativeProjectionIntrinsic(
      owner,
      beginReceipt,
      composition,
      sourceSummary,
    );
    const parent = consumeSQLiteCursorPublicationNativeProjectionDefinitionIntrinsic(
      composition,
      projection as object,
    );
    currentNativeProjectionFailureTelemetryForTest = undefined;
    return parent;
  } catch (cause) {
    lastNativeProjectionFailureTelemetryForTest = objectFreezeDefinitionIntrinsic({
      nativeReturnAttemptCount:
        currentNativeProjectionFailureTelemetryForTest?.nativeReturnAttemptCount ?? 0,
      nativeReturnSuccessCount:
        currentNativeProjectionFailureTelemetryForTest?.nativeReturnSuccessCount ?? 0,
      secondaryFailureCount:
        currentNativeProjectionFailureTelemetryForTest?.secondaryFailureCount ?? 0,
    });
    currentNativeProjectionFailureTelemetryForTest = undefined;
    const primary = cause !== null && typeof cause === "object"
      ? cause as object
      : new CycleStoreProviderError(
        "GE_CYCLE_STORE_CORRUPTION",
        OPERATION,
        "SQLite native projection threw a non-object primary",
        { cause },
      );
    // The installed consumer may already have terminalized the target. Never
    // attempt a second claim, and never replace the exact primary it threw.
    try {
      if (readSQLiteCursorPublicationTransactionOwnerSnapshotIntrinsic(owner).lifecycle
          !== "active") {
        throw primary;
      }
    } catch (snapshotFailure) {
      if (snapshotFailure === primary) throw primary;
      throw primary;
    }
    const capture = captureSQLiteCursorPublicationTransactionFailureIntrinsic(owner, primary);
    return finalizeSQLiteCursorPublicationTransactionFailureIntrinsic(capture);
  }
}

/** Package-private exact-connection proof; it exposes only scalar evidence. */
export function assertSQLiteV1BaselineLowerOwnedNativeProjectionIntrinsic(
  projection: SQLiteV1BaselineLowerOwnedNativeProjection,
  owner: SQLiteCursorPublicationTransactionOwner,
  beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt,
  composition: object,
): SQLiteV1BaselineLowerOwnedNativeProjectionSnapshot {
  const state = projection !== null && typeof projection === "object"
    ? reflectApplyDefinitionIntrinsic(
      weakMapGetDefinitionIntrinsic,
      LOWER_OWNED_NATIVE_PROJECTIONS,
      [projection as object],
    ) as (typeof LOWER_OWNED_NATIVE_PROJECTIONS extends WeakMap<object, infer V>
      ? V : never) | undefined
    : undefined;
  if (state === undefined || state.owner !== owner || state.beginReceipt !== beginReceipt
      || state.composition !== composition
      || state.retainedEntries.length !== state.snapshot.retainedCount
      || state.snapshot.expectedProjectionCount !== state.snapshot.retainedCount) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite v1 baseline lower-owned projection is invalid",
    );
  }
  assertSQLiteCursorPublicationOwnerCompositionConnectionIntrinsic(
    owner,
    beginReceipt,
    composition,
    state.connection,
  );
  assertSQLiteV1BaselineCursorSourceProvenance(state.sourceSummary, state.connection);
  return state.adopted
    ? objectFreezeDefinitionIntrinsic({ ...state.snapshot, lifecycle: "adopted" })
    : state.snapshot;
}

/** One-shot lower-layer adoption, callable only after the transaction owner reproof. */
export function adoptSQLiteV1BaselineLowerOwnedNativeProjectionIntrinsic(
  projection: SQLiteV1BaselineLowerOwnedNativeProjection,
  owner: SQLiteCursorPublicationTransactionOwner,
  beginReceipt: SQLiteCursorPublicationTransactionBeginReceipt,
  composition: object,
): SQLiteV1BaselineLowerOwnedNativeProjectionSnapshot {
  const state = projection !== null && typeof projection === "object"
    ? reflectApplyDefinitionIntrinsic(
      weakMapGetDefinitionIntrinsic,
      LOWER_OWNED_NATIVE_PROJECTIONS,
      [projection as object],
    ) as (typeof LOWER_OWNED_NATIVE_PROJECTIONS extends WeakMap<object, infer V>
      ? V : never) | undefined
    : undefined;
  if (state === undefined || state.adopted) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite v1 baseline lower-owned projection was replayed",
    );
  }
  assertSQLiteV1BaselineLowerOwnedNativeProjectionIntrinsic(
    projection,
    owner,
    beginReceipt,
    composition,
  );
  state.adopted = true;
  return objectFreezeDefinitionIntrinsic({ ...state.snapshot, lifecycle: "adopted" });
}
