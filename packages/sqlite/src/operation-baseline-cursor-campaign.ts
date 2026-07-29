import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
  MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
  MIN_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
  SQLITE_CURSOR_COUNT_MARKER_SQL,
  SQLITE_CURSOR_EVENT_LOOKUP_SQL,
  SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
  SQLITE_CURSOR_PRE_REBIND_RULE_ORDER,
  SQLITE_CURSOR_ROW_RULES,
  SQLITE_CURSOR_SOURCE_QUERY,
  SQLITE_CURSOR_STAGE_SEAL_SQL,
  SQLITE_CURSOR_STAGE_INSERT_SQL,
  type SQLiteCursorPreRebindRuleId,
} from "./cursor-pre-rebind-contract.js";
import {
  SQLiteCursorSealAccumulator,
  validateSQLiteCursorSealCarrier,
  type SQLiteCursorSealRow,
} from "./operation-baseline-cursor-invariants.js";
import {
  assertSQLiteCursorPreRebindReceiptProvenance,
  type SQLiteCursorPreRebindReceipt,
} from "./operation-baseline-cursor-ownership.js";
import {
  abortSQLiteCursorPreRebindStageCampaign,
  beginSQLiteCursorPreRebindStageCampaign,
  completeSQLiteCursorPreRebindStageCampaign,
  diagnoseSQLiteCursorPreRebindStageCampaign,
  fenceSQLiteCursorPreRebindStageCampaign,
  insertSQLiteCursorPreRebindStageRow,
  registerSQLiteCursorPreRebindStageCleanup,
  type SQLiteCursorPreRebindStageCampaign,
  type SQLiteCursorStageOwnershipTransfer,
} from "./operation-baseline-cursor-stage-ownership.js";
import {
  inspectSQLiteCursorRow,
  type SQLiteCursorStageValue,
} from "./operation-baseline-cursor-inspection.js";
import type { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import type { OperationBaselineProjectionIdentity } from "./operation-baseline.js";
import { sqliteRow, sqliteSafeInteger, sqliteText } from "./sqlite-codec.js";
import {
  prepareSQLiteConnectionIntrinsic,
  type SQLiteConnection,
} from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;
const FORBIDDEN_PLAN = ["AUTOMATIC", "MATERIALIZE", "USE TEMP B-TREE", "CO-ROUTINE"];
const CATALOG_NAMES = Object.freeze([
  "ge_cycle_checkpoint_revisions",
  "ge_cycle_checkpoint_revisions_lookup_idx",
  "ge_cycle_cursors",
  "ge_cycle_migration_lock",
  "ge_cycle_records",
  "ge_cycle_records_stream_sequence_hash_uq",
  "ge_cycle_schema",
]);
const CATALOG_IDENTITIES = Object.freeze(new Map<string, readonly [string, string, string]>([
  ["ge_cycle_checkpoint_revisions", ["table", "ge_cycle_checkpoint_revisions",
    "6cd5ca1cb83b687ad5d545d03f0c15a3edb02c9d88c0afdd9984ae4376d44c5c"]],
  ["ge_cycle_checkpoint_revisions_lookup_idx", ["index", "ge_cycle_checkpoint_revisions",
    "9e51c4c421ba6a66fd3bdced00ef64173635c35cff91bf4609d4e424c75c10d4"]],
  ["ge_cycle_cursors", ["table", "ge_cycle_cursors",
    "519abf879eee49cee95d6c99c5026ca629fba7bdb5037a8791a5ec03f295dcb9"]],
  ["ge_cycle_migration_lock", ["table", "ge_cycle_migration_lock",
    "ef0718cd3244fd1957cfd66356735c2c2e599c27194a9af9a102fc95ab6e7aca"]],
  ["ge_cycle_records", ["table", "ge_cycle_records",
    "18864cc98a9b33c2e192473be94189f161fa21c3f0ece7489aa6f1a26fbd2cdc"]],
  ["ge_cycle_records_stream_sequence_hash_uq", ["index", "ge_cycle_records",
    "69a32763f756ad96d8dbaee38e8d942ec6fd0e52ab568b024121fd3890acfc58"]],
  ["ge_cycle_schema", ["table", "ge_cycle_schema",
    "24c4bca33d6d94e2c7ac2aa6b0655d0f34297497c9eb312f2bbbfe699a10f492"]],
]));

export type SQLiteCursorQueryPlanKind =
  | "source"
  | "event-lookup"
  | "checkpoint-lookup"
  | "stage-insert"
  | "count-marker"
  | "row-marker"
  | "stage-seal";

function normalizedPlanDetail(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toUpperCase();
}

/** Package-private closed, portable B2 EQP acceptance predicate. */
export function acceptsSQLiteCursorQueryPlan(
  kind: SQLiteCursorQueryPlanKind,
  sql: string,
  details: readonly string[],
): boolean {
  const normalized = details.map(normalizedPlanDetail);
  if (normalized.some((detail) =>
    FORBIDDEN_PLAN.some((fragment) => detail.includes(fragment)))) return false;

  switch (kind) {
    case "source":
      return sql === SQLITE_CURSOR_SOURCE_QUERY
        && normalized.length === 1
        && /^SCAN (?:MAIN\.)?GE_CYCLE_CURSORS(?: USING (?:COVERING )?(?:INDEX )?PRIMARY KEY)?$/u
          .test(normalized[0]!);
    case "event-lookup":
      return sql === SQLITE_CURSOR_EVENT_LOOKUP_SQL
        && normalized.length === 1
        && /^SEARCH (?:MAIN\.)?GE_CYCLE_RECORDS USING COVERING INDEX GE_CYCLE_RECORDS_STREAM_SEQUENCE_HASH_UQ \(TENANT_ID=\? AND STREAM_ID=\? AND SEQUENCE=\? AND RECORD_HASH=\?\)$/u
          .test(normalized[0]!);
    case "checkpoint-lookup":
      return sql === SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL
        && normalized.length === 1
        && /^SEARCH (?:MAIN\.)?GE_CYCLE_CHECKPOINT_REVISIONS USING INDEX GE_CYCLE_CHECKPOINT_REVISIONS_LOOKUP_IDX \(TENANT_ID=\? AND CHECKPOINT_SCOPE=\? AND CHECKPOINT_ID=\?\)$/u
          .test(normalized[0]!);
    case "stage-insert":
      // SQLite emits no EQP row for a simple INSERT. Binding this empty plan
      // to the exact package-owned SQL proves the sole write target is TEMP.
      return sql === SQLITE_CURSOR_STAGE_INSERT_SQL && normalized.length === 0;
    case "count-marker":
      return sql === SQLITE_CURSOR_COUNT_MARKER_SQL
        && normalized.length === 1 && normalized[0] === "SCAN CONSTANT ROW";
    case "row-marker":
      return SQLITE_CURSOR_ROW_RULES.some((rule) => rule.sql === sql)
        && normalized.length === 1
        && /^SCAN (?:TEMP\.)?GE_BLR_CURSOR_SEAL$/u.test(normalized[0]!);
    case "stage-seal":
      return sql === SQLITE_CURSOR_STAGE_SEAL_SQL
        && normalized.length === 1
        && /^SCAN (?:TEMP\.)?GE_BLR_CURSOR_SEAL$/u.test(normalized[0]!);
  }
}

export interface SQLiteCursorPreRebindDiagnostic {
  readonly ruleId: SQLiteCursorPreRebindRuleId;
  readonly violationCount: number;
  readonly diagnosticsTruncated: boolean;
}

export type SQLiteCursorPreRebindVector = readonly [
  number, number, number, number, number,
  number, number, number, number, number,
];

export type SQLiteCursorPreRebindOutcome =
  | Readonly<{
    status: "pre-rebind-complete";
    projectionIdentity: OperationBaselineProjectionIdentity;
    receipt: SQLiteCursorPreRebindReceipt;
    diagnostics: readonly [];
    vector: readonly [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  }>
  | Readonly<{
    status: "diagnosed";
    projectionIdentity: OperationBaselineProjectionIdentity;
    diagnostics: readonly SQLiteCursorPreRebindDiagnostic[];
    vector: SQLiteCursorPreRebindVector;
  }>;

export interface SQLiteCursorPreRebindCampaignOptions {
  readonly diagnosticLimit?: number;
  readonly cancellation?: SQLiteCursorPreRebindCancellationSignal;
}

export interface SQLiteCursorPreRebindCancellationSignal {
  readonly __sqliteCursorPreRebindCancellationSignal: never;
}

export interface SQLiteCursorPreRebindCancellationController {
  readonly signal: SQLiteCursorPreRebindCancellationSignal;
  cancel(): void;
}

export interface SQLiteCursorPreRebindResourceEvidence {
  readonly maximumFetchSize: 0 | 1;
  readonly maximumLiveDecodedRows: 0 | 1;
  readonly maximumLiveCarriers: 0 | 1;
  readonly maximumLiveRawRows: 0 | 1;
  readonly maximumActiveRegisteredCursors: 0 | 1;
  readonly maximumNestedPointOperations: 0 | 1;
  readonly maximumTempObjects: number;
  readonly maximumTempRows: number;
  readonly currentActiveRegisteredCursors: number;
  readonly currentLiveDecodedRows: number;
  readonly currentLiveRawRows: number;
  readonly currentNestedPointOperations: number;
  readonly currentTempObjectCount: number;
  readonly finalTempObjectCount: number;
  readonly finalTempRows: number;
  readonly tempObjectCountEvidence: "in-campaign-temp-schema-scalar";
  readonly tempObjectMeasurements: number;
}

export interface SQLiteCursorPreRebindQueryPlanEvidence {
  readonly kind: SQLiteCursorQueryPlanKind;
  readonly sql: string;
  readonly details: readonly string[];
}

interface SQLiteCursorPreRebindCancellationState {
  cancelled: boolean;
  readonly cancelAtLabel?: string;
  readonly cancelAtOccurrence?: number;
  matchedOccurrences: number;
}

const CANCELLATIONS = new WeakMap<object, SQLiteCursorPreRebindCancellationState>();

export function createSQLiteCursorPreRebindCancellationController():
SQLiteCursorPreRebindCancellationController {
  const signal = Object.freeze(Object.create(null)) as SQLiteCursorPreRebindCancellationSignal;
  const state: SQLiteCursorPreRebindCancellationState = {
    cancelled: false,
    matchedOccurrences: 0,
  };
  CANCELLATIONS.set(signal as object, state);
  return Object.freeze({ signal, cancel: (): void => { state.cancelled = true; } });
}

/** Package-private deterministic cancellation seam for closed-boundary tests. */
export function createSQLiteCursorPreRebindLabelCancellationController(
  label: string,
  occurrence = 1,
): SQLiteCursorPreRebindCancellationController {
  if (label.length === 0 || !Number.isSafeInteger(occurrence) || occurrence < 1) {
    throw new TypeError("SQLite cursor cancellation label and occurrence are invalid");
  }
  const signal = Object.freeze(Object.create(null)) as SQLiteCursorPreRebindCancellationSignal;
  const state: SQLiteCursorPreRebindCancellationState = {
    cancelled: false,
    cancelAtLabel: label,
    cancelAtOccurrence: occurrence,
    matchedOccurrences: 0,
  };
  CANCELLATIONS.set(signal as object, state);
  return Object.freeze({ signal, cancel: (): void => { state.cancelled = true; } });
}

function corruption(message: string): CycleStoreProviderError {
  return new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function checkedOptions(options: unknown): Readonly<{
  limit: number;
  cancellation?: SQLiteCursorPreRebindCancellationSignal;
}> {
  if (options === undefined) return Object.freeze({ limit: DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT });
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)
        || Object.getPrototypeOf(options) !== Object.prototype) throw new TypeError();
    const keys = Reflect.ownKeys(options);
    if (keys.length > 2
        || keys.some((key) => key !== "diagnosticLimit" && key !== "cancellation")) {
      throw new TypeError();
    }
    const descriptor = Object.getOwnPropertyDescriptor(options, "diagnosticLimit");
    const cancellationDescriptor = Object.getOwnPropertyDescriptor(options, "cancellation");
    if ((descriptor !== undefined && !("value" in descriptor))
        || (cancellationDescriptor !== undefined && !("value" in cancellationDescriptor))) {
      throw new TypeError();
    }
    const value = descriptor?.value ?? DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT;
    if (!Number.isSafeInteger(value)
        || value < MIN_SQLITE_CURSOR_DIAGNOSTIC_LIMIT
        || value > MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT) throw new TypeError();
    const cancellation = cancellationDescriptor?.value as unknown;
    if (cancellation !== undefined && (cancellation === null || typeof cancellation !== "object"
        || CANCELLATIONS.get(cancellation as object) === undefined)) throw new TypeError();
    return cancellation === undefined
      ? Object.freeze({ limit: value as number })
      : Object.freeze({
        cancellation: cancellation as SQLiteCursorPreRebindCancellationSignal,
        limit: value as number,
      });
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite cursor pre-rebind campaign options are invalid",
    );
  }
}

function planDetails(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  campaign: SQLiteCursorPreRebindStageCampaign,
  sql: string,
  values: readonly SQLiteCursorStageValue[],
  kind: SQLiteCursorQueryPlanKind,
  poll: (boundary: "before-prepare" | "after-prepare" | "before-fetch" | "after-fetch"
    | "before-close" | "after-close", cancellation?: boolean) => void,
  opened: () => void,
  closed: () => void,
): readonly string[] {
  poll("before-prepare");
  const rows = prepareSQLiteConnectionIntrinsic(
    connection, `EXPLAIN QUERY PLAN ${sql}`, OPERATION,
  ).iterate(...values)[Symbol.iterator]();
  let finalized = false;
  let registered = false;
  const finalize = (): void => {
    if (finalized) return;
    finalized = true;
    try {
      rows.return?.();
    } finally {
      if (registered) closed();
    }
  };
  try {
    registerSQLiteCursorPreRebindStageCleanup(stage, campaign, finalize);
    registered = true;
    opened();
  } catch (error) {
    try { finalize(); } catch { /* Registration failure remains primary. */ }
    throw error;
  }
  const observed: string[] = [];
  try {
    poll("after-prepare");
    for (;;) {
      poll("before-fetch");
      const next = rows.next();
      poll("after-fetch", false);
      if (next.done) {
        break;
      }
      const row = sqliteRow(next.value, 4, OPERATION, "cursor query plan row");
      const detail = sqliteText(row[3], OPERATION, "cursor query plan detail").toUpperCase();
      observed.push(detail);
    }
    if (!acceptsSQLiteCursorQueryPlan(kind, sql, observed)) {
      throw corruption("SQLite cursor pre-rebind query plan is invalid");
    }
    poll("after-fetch");
    poll("before-close");
    registerSQLiteCursorPreRebindStageCleanup(stage, campaign, undefined);
    finalize();
    poll("after-close");
    return Object.freeze(observed.map(normalizedPlanDetail));
  } catch (error) {
    // Abort owns the registered finalizer on every failure path.
    throw error;
  }
}

function catalogSnapshot(connection: SQLiteConnection, validateCanonical = true): string {
  const placeholders = CATALOG_NAMES.map(() => "?").join(",");
  const row = sqliteRow(prepareSQLiteConnectionIntrinsic(connection,
    `SELECT count(*), group_concat(
       hex(CAST(type AS BLOB)) || ',' ||
       hex(CAST(name AS BLOB)) || ',' ||
       hex(CAST(tbl_name AS BLOB)) || ',' ||
       CAST(rootpage AS TEXT) || ',' ||
       hex(CAST(sql AS BLOB)), ';') FROM (
       SELECT type,name,tbl_name,rootpage,sql FROM main.sqlite_schema
       WHERE name IN (${placeholders}) ORDER BY type COLLATE BINARY, name COLLATE BINARY
     )`, OPERATION).get(...CATALOG_NAMES), 2, OPERATION, "cursor main catalog row");
  const count = sqliteSafeInteger(
    row[0], 0, CATALOG_NAMES.length, OPERATION, "cursor main catalog count",
  );
  const snapshot = sqliteText(row[1], OPERATION, "cursor main catalog snapshot");
  if (count !== CATALOG_NAMES.length) {
    throw corruption("SQLite cursor main catalog is incomplete");
  }
  if (!validateCanonical) return snapshot;
  const entries = snapshot.split(";");
  const observed = new Set<string>();
  for (const entry of entries) {
    const fields = entry.split(",");
    if (fields.length !== 5 || !/^[0-9A-F]*$/u.test(fields[0]!)
        || !/^[0-9A-F]*$/u.test(fields[1]!) || !/^[0-9A-F]*$/u.test(fields[2]!)
        || !/^[1-9][0-9]*$/u.test(fields[3]!) || !/^[0-9A-F]+$/u.test(fields[4]!)) {
      throw corruption("SQLite cursor main catalog row is invalid");
    }
    const type = Buffer.from(fields[0]!, "hex").toString("utf8");
    const name = Buffer.from(fields[1]!, "hex").toString("utf8");
    const table = Buffer.from(fields[2]!, "hex").toString("utf8");
    const rootpage = Number(fields[3]);
    const sql = Buffer.from(fields[4]!, "hex");
    const expected = CATALOG_IDENTITIES.get(name);
    if (!Number.isSafeInteger(rootpage) || rootpage < 1 || observed.has(name)
        || expected === undefined || type !== expected[0] || table !== expected[1]
        || createHash("sha256").update(sql).digest("hex") !== expected[2]) {
      throw corruption("SQLite cursor main catalog canonical identity changed");
    }
    observed.add(name);
  }
  if (observed.size !== CATALOG_NAMES.length
      || CATALOG_NAMES.some((name) => !observed.has(name))) {
    throw corruption("SQLite cursor main catalog is incomplete");
  }
  return snapshot;
}

function countRows(connection: SQLiteConnection, table: string): number {
  return sqliteSafeInteger(sqliteRow(prepareSQLiteConnectionIntrinsic(
    connection, `SELECT count(*) FROM ${table}`, OPERATION,
  ).get(), 1, OPERATION, "cursor inventory row")[0], 0, Number.MAX_SAFE_INTEGER,
  OPERATION, "cursor inventory count");
}

export const SQLITE_CURSOR_TEMP_OBJECT_COUNT_SQL =
  "SELECT count(*) FROM temp.sqlite_schema WHERE type = 'table' AND name = 'ge_blr_cursor_seal'";

function countCursorTempObjects(connection: SQLiteConnection): number {
  return sqliteSafeInteger(sqliteRow(prepareSQLiteConnectionIntrinsic(
    connection, SQLITE_CURSOR_TEMP_OBJECT_COUNT_SQL, OPERATION,
  ).get(), 1, OPERATION, "cursor TEMP object inventory row")[0], 0, Number.MAX_SAFE_INTEGER,
  OPERATION, "cursor TEMP object inventory count");
}

function lookupMarkerFound(value: unknown): boolean {
  if (value === undefined) return false;
  const row = sqliteRow(value, 1, OPERATION, "cursor lookup marker");
  sqliteSafeInteger(row[0], 1, 1, OPERATION, "cursor lookup marker");
  return true;
}

function readProviderHighWater(connection: SQLiteConnection): number {
  return sqliteSafeInteger(sqliteRow(prepareSQLiteConnectionIntrinsic(connection,
    "SELECT updated_at_ms FROM main.ge_cycle_migration_lock WHERE singleton = 1",
    OPERATION).get(), 1, OPERATION, "cursor provider high-water row")[0],
  0, Number.MAX_SAFE_INTEGER, OPERATION, "cursor provider high-water");
}

function readSourceIdentities(connection: SQLiteConnection): readonly [string, string] {
  const row = sqliteRow(prepareSQLiteConnectionIntrinsic(connection,
    "SELECT provider_descriptor_hash,schema_identity_sha256 FROM main.ge_cycle_schema WHERE singleton = 1",
    OPERATION).get(), 2, OPERATION, "cursor source identity row");
  return Object.freeze([
    sqliteText(row[0], OPERATION, "cursor source descriptor"),
    sqliteText(row[1], OPERATION, "cursor source schema identity"),
  ] as const);
}

export function sqliteCursorInventoryMarkerBindings(
  capturedCount: number,
  walkedCount: number,
  stagedCount: number,
  diagnosticLimit: number,
): readonly [number, number, number, number, number] {
  return Object.freeze([
    capturedCount, walkedCount, walkedCount, stagedCount, diagnosticLimit + 1,
  ] as const);
}

function sealRowFromStage(value: unknown): SQLiteCursorSealRow {
  const row = sqliteRow(value, 20, OPERATION, "cursor staged seal row");
  const number = (index: number, minimum: number): number => sqliteSafeInteger(
    row[index], minimum, Number.MAX_SAFE_INTEGER, OPERATION, "cursor staged integer",
  );
  const nullableNumber = (index: number, minimum: number): number | null =>
    row[index] === null ? null : number(index, minimum);
  return Object.freeze({
    carrier: validateSQLiteCursorSealCarrier({
      authorizationHash: row[4], checkpointScope: row[6], consumedAtMs: nullableNumber(17, 0),
      createdAtMs: number(15, 0), expiresAtMs: number(16, 0), kind: row[2],
      nextPosition: number(10, 0), pageSize: number(9, 1), principalHash: row[3],
      requestScopeBlobSha256: row[8], requestScopeByteLength: number(7, 2),
      snapshotBlobSha256: row[14], snapshotByteLength: number(13, 2),
      snapshotTailRecordHash: row[12], snapshotTailSequence: nullableNumber(11, -1),
      streamId: row[5], tenantId: row[0], tokenHash: row[1],
    }),
    descriptorHash: sqliteText(row[18], OPERATION, "cursor staged descriptor"),
    schemaIdentitySha256: sqliteText(row[19], OPERATION, "cursor staged schema identity"),
  });
}

/** Package-private one-shot B2 campaign. */
export class SQLiteCursorPreRebindCampaign {
  readonly #connection: SQLiteConnection;
  readonly #stage: SQLiteBaselineTempStage;
  readonly #receipt: SQLiteCursorPreRebindReceipt;
  readonly #witness: ReturnType<typeof assertSQLiteCursorPreRebindReceiptProvenance>;
  readonly #limit: number;
  readonly #cancellation: SQLiteCursorPreRebindCancellationSignal | undefined;
  readonly #campaign: SQLiteCursorPreRebindStageCampaign;
  #state: "open" | "complete" | "diagnosed" | "poisoned" = "open";
  #maximumFetchSize: 0 | 1 = 0;
  #liveDecodedRows = 0;
  #liveCarriers = 0;
  #liveRawRows = 0;
  #maximumLiveDecodedRows: 0 | 1 = 0;
  #maximumLiveCarriers: 0 | 1 = 0;
  #maximumLiveRawRows: 0 | 1 = 0;
  #activeRegisteredCursors = 0;
  #maximumActiveRegisteredCursors: 0 | 1 = 0;
  #activeNestedPointOperations = 0;
  #maximumNestedPointOperations: 0 | 1 = 0;
  #currentTempRows = 0;
  #maximumTempRows = 0;
  #currentTempObjects = 0;
  #maximumTempObjects = 0;
  #finalTempObjectCount = 0;
  #tempObjectMeasurements = 0;
  readonly #queryPlanEvidence: SQLiteCursorPreRebindQueryPlanEvidence[] = [];

  constructor(
    connection: SQLiteConnection,
    stage: SQLiteBaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    transfer: SQLiteCursorStageOwnershipTransfer,
    options: SQLiteCursorPreRebindCampaignOptions = {},
  ) {
    this.#witness = assertSQLiteCursorPreRebindReceiptProvenance(receipt);
    this.#connection = connection;
    this.#stage = stage;
    this.#receipt = receipt;
    this.#campaign = beginSQLiteCursorPreRebindStageCampaign(
      connection, stage, receipt, transfer,
    );
    try {
      const checked = checkedOptions(options);
      this.#limit = checked.limit;
      this.#cancellation = checked.cancellation;
      registerSQLiteCursorPreRebindStageCleanup(
        this.#stage,
        this.#campaign,
        () => {
          if (this.#state === "open") this.#state = "poisoned";
        },
      );
    } catch (error) {
      try {
        abortSQLiteCursorPreRebindStageCampaign(
          stage, this.#campaign, "SQLite cursor pre-rebind options are invalid",
        );
      } catch {
        // The exact invalid-options primary remains authoritative.
      }
      throw error;
    }
  }

  get state(): "open" | "complete" | "diagnosed" | "poisoned" {
    return this.#state;
  }

  /** Package-private boundedness evidence captured by the production loop. */
  get resourceEvidence(): SQLiteCursorPreRebindResourceEvidence {
    return Object.freeze({
      maximumFetchSize: this.#maximumFetchSize,
      maximumLiveDecodedRows: this.#maximumLiveDecodedRows,
      maximumLiveCarriers: this.#maximumLiveCarriers,
      maximumLiveRawRows: this.#maximumLiveRawRows,
      maximumActiveRegisteredCursors: this.#maximumActiveRegisteredCursors,
      maximumNestedPointOperations: this.#maximumNestedPointOperations,
      maximumTempObjects: this.#maximumTempObjects,
      maximumTempRows: this.#maximumTempRows,
      currentActiveRegisteredCursors: this.#activeRegisteredCursors,
      currentLiveDecodedRows: this.#liveDecodedRows,
      currentLiveRawRows: this.#liveRawRows,
      currentNestedPointOperations: this.#activeNestedPointOperations,
      currentTempObjectCount: this.#currentTempObjects,
      finalTempObjectCount: this.#finalTempObjectCount,
      finalTempRows: this.#currentTempRows,
      tempObjectCountEvidence: "in-campaign-temp-schema-scalar",
      tempObjectMeasurements: this.#tempObjectMeasurements,
    });
  }

  /** Package-private, in-campaign evidence from the exact registered EQP cursors. */
  get queryPlanEvidence(): readonly SQLiteCursorPreRebindQueryPlanEvidence[] {
    return Object.freeze(this.#queryPlanEvidence.map((item) => Object.freeze({
      kind: item.kind,
      sql: item.sql,
      details: Object.freeze([...item.details]),
    })));
  }

  #verifyQueryPlan(
    catalog: string,
    sql: string,
    values: readonly SQLiteCursorStageValue[],
    kind: SQLiteCursorQueryPlanKind,
    label: string,
  ): void {
    const details = planDetails(
      this.#connection,
      this.#stage,
      this.#campaign,
      sql,
      values,
      kind,
      (boundary, cancellation = true) => {
        if (cancellation) this.#poll(catalog, `${label}:${boundary}`);
        else this.#fence(catalog);
      },
      () => this.#registeredCursorOpened(),
      () => this.#registeredCursorClosed(),
    );
    this.#queryPlanEvidence.push(Object.freeze({ kind, sql, details }));
  }

  #registeredCursorOpened(): void {
    this.#activeRegisteredCursors += 1;
    if (this.#activeRegisteredCursors > 1) {
      throw corruption("SQLite cursor pre-rebind registered cursor bound exceeded");
    }
    this.#maximumActiveRegisteredCursors = 1;
  }

  #registeredCursorClosed(): void {
    this.#activeRegisteredCursors -= 1;
    if (this.#activeRegisteredCursors < 0) {
      throw corruption("SQLite cursor pre-rebind registered cursor accounting failed");
    }
  }

  #pointOperation<T>(operation: () => T): T {
    this.#activeNestedPointOperations += 1;
    if (this.#activeNestedPointOperations > 1) {
      throw corruption("SQLite cursor pre-rebind point-operation bound exceeded");
    }
    this.#maximumNestedPointOperations = 1;
    try {
      return operation();
    } finally {
      this.#activeNestedPointOperations -= 1;
    }
  }

  #fence(catalog: string): void {
    fenceSQLiteCursorPreRebindStageCampaign(this.#stage, this.#campaign);
    if (this.#pointOperation(
      () => catalogSnapshot(this.#connection, false),
    ) !== catalog) {
      throw corruption("SQLite cursor main catalog changed during pre-rebind");
    }
    fenceSQLiteCursorPreRebindStageCampaign(this.#stage, this.#campaign);
  }

  #measureTempObjectInventory(catalog: string): void {
    this.#fence(catalog);
    const observed = this.#pointOperation(
      () => countCursorTempObjects(this.#connection),
    );
    this.#fence(catalog);
    this.#tempObjectMeasurements += 1;
    this.#currentTempObjects = observed;
    this.#finalTempObjectCount = observed;
    this.#maximumTempObjects = Math.max(this.#maximumTempObjects, observed);
    if (observed !== 1) {
      throw corruption("SQLite cursor TEMP object inventory changed during pre-rebind");
    }
  }

  #checkCancellation(label?: string): void {
    const state = this.#cancellation === undefined
      ? undefined
      : CANCELLATIONS.get(this.#cancellation as object);
    if (state !== undefined && label !== undefined && state.cancelAtLabel === label) {
      state.matchedOccurrences += 1;
      if (state.matchedOccurrences === state.cancelAtOccurrence) state.cancelled = true;
    }
    if (state?.cancelled === true) {
      throw new CycleStoreProviderError(
        "GE_CYCLE_STORE_UNAVAILABLE", OPERATION,
        "SQLite cursor pre-rebind campaign was cancelled",
      );
    }
  }

  #poll(catalog: string, label: string): void {
    this.#fence(catalog);
    this.#checkCancellation(label);
  }

  #assertPublicationSource(
    descriptor: string,
    schema: string,
    providerHighWaterAtMs: number,
    expectedCursorCount: number,
  ): void {
    const [actualDescriptor, actualSchema] = readSourceIdentities(this.#connection);
    if (actualDescriptor !== descriptor || actualSchema !== schema
        || readProviderHighWater(this.#connection) !== providerHighWaterAtMs
        || countRows(this.#connection, "main.ge_cycle_cursors") !== expectedCursorCount) {
      throw corruption("SQLite cursor pre-rebind publication evidence changed");
    }
  }

  #boundedMarkers(
    catalog: string,
    sql: string,
    values: readonly SQLiteCursorStageValue[],
    label: string,
  ): number {
    this.#poll(catalog, `${label}:before-prepare`);
    const iterator = prepareSQLiteConnectionIntrinsic(
      this.#connection, sql, OPERATION,
    ).iterate(...values)[Symbol.iterator]();
    let finalized = false;
    let registered = false;
    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      try {
        iterator.return?.();
      } finally {
        if (registered) this.#registeredCursorClosed();
      }
    };
    try {
      registerSQLiteCursorPreRebindStageCleanup(this.#stage, this.#campaign, finalize);
      registered = true;
      this.#registeredCursorOpened();
    } catch (error) {
      try { finalize(); } catch { /* Registration failure remains primary. */ }
      throw error;
    }
    let observed = 0;
    try {
      this.#poll(catalog, `${label}:after-prepare`);
      while (observed <= this.#limit) {
        this.#poll(catalog, `${label}:before-fetch`);
        const next = iterator.next();
        if (next.done) {
          this.#poll(catalog, `${label}:after-fetch`);
          break;
        }
        this.#maximumFetchSize = 1;
        const marker = sqliteRow(next.value, 1, OPERATION, "cursor rule marker");
        sqliteSafeInteger(marker[0], 1, 1, OPERATION, "cursor rule marker");
        this.#poll(catalog, `${label}:after-fetch`);
        observed += 1;
      }
      this.#poll(catalog, `${label}:before-close`);
      registerSQLiteCursorPreRebindStageCleanup(this.#stage, this.#campaign, undefined);
      finalize();
      this.#poll(catalog, `${label}:after-close`);
      return observed;
    } catch (error) {
      // Leave the registered owner intact. Abort clears ownership first and
      // invokes this finalizer exactly once without masking this primary.
      throw error;
    }
  }

  run(): SQLiteCursorPreRebindOutcome {
    if (this.#state !== "open") {
      this.#state = "poisoned";
      return abortSQLiteCursorPreRebindStageCampaign(
        this.#stage, undefined, "SQLite cursor pre-rebind campaign is one-shot",
      );
    }
    let primary: unknown;
    try {
      // Until run starts, the stage owns a small abandonment finalizer that
      // poisons this never-run campaign. Synchronous execution now takes over;
      // every subsequently active native cursor installs its own exact owner.
      registerSQLiteCursorPreRebindStageCleanup(
        this.#stage, this.#campaign, undefined,
      );
      const catalog = catalogSnapshot(this.#connection);
      this.#fence(catalog);
      this.#checkCancellation("run:start");
      this.#measureTempObjectInventory(catalog);
      const sealReceipt = this.#witness.sealReceipt;
      const clock = this.#witness.clockEvidence;
      const [descriptor, schema] = readSourceIdentities(this.#connection);
      if (descriptor !== sealReceipt.sourceDescriptorHash
          || schema !== sealReceipt.sourceSchemaIdentitySha256
          || readProviderHighWater(this.#connection) !== clock.providerHighWaterAtMs
          || clock.capturedAtMs < clock.providerHighWaterAtMs
          || clock.providerHighWaterAtMs < clock.maximumNonCursorObservedAtMs) {
        throw corruption("SQLite cursor pre-rebind source evidence changed");
      }
      const mainBefore = countRows(this.#connection, "main.ge_cycle_cursors");
      // Validate and retain the exact fixed 15-statement EQP set before any
      // source work.  This is deliberately the same order as Python's
      // in-campaign evidence, and includes stage-seal even when the eventual
      // outcome is diagnosed and no seal cursor is opened.
      this.#verifyQueryPlan(catalog, SQLITE_CURSOR_SOURCE_QUERY, [], "source", "plan:source");
      this.#verifyQueryPlan(catalog, SQLITE_CURSOR_STAGE_INSERT_SQL,
        ["0".repeat(64), ".", "event", "0".repeat(64), "0".repeat(64), ".", null,
          2, "0".repeat(64), 1, 0, -1, null, 2, "0".repeat(64), 0, 1, null,
          "0".repeat(64), "0".repeat(64), 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        "stage-insert", "plan:stage-insert");
      this.#verifyQueryPlan(catalog, SQLITE_CURSOR_STAGE_SEAL_SQL, [],
        "stage-seal", "plan:stage-seal");
      this.#verifyQueryPlan(catalog, SQLITE_CURSOR_COUNT_MARKER_SQL,
        [0, 0, 0, 0, this.#limit + 1], "count-marker", "plan:BLR_CURSOR_SEAL_COUNT");
      this.#verifyQueryPlan(catalog, SQLITE_CURSOR_EVENT_LOOKUP_SQL,
        [".", ".", 0, "0".repeat(64)], "event-lookup", "plan:event-lookup");
      this.#verifyQueryPlan(catalog, SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
        [".", ".", ".", Buffer.from("{}")], "checkpoint-lookup", "plan:checkpoint-lookup");
      let planRowRuleIndex = 0;
      for (const ruleId of SQLITE_CURSOR_PRE_REBIND_RULE_ORDER) {
        if (ruleId === "BLR_CURSOR_SEAL_COUNT") continue;
        const rule = SQLITE_CURSOR_ROW_RULES[planRowRuleIndex++]!;
        this.#verifyQueryPlan(catalog, rule.sql, [this.#limit + 1],
          "row-marker", `plan:${ruleId}`);
      }
      this.#poll(catalog, "event-lookup:before-prepare");
      const eventLookup = prepareSQLiteConnectionIntrinsic(
        this.#connection, SQLITE_CURSOR_EVENT_LOOKUP_SQL, OPERATION,
      );
      this.#poll(catalog, "event-lookup:after-prepare");
      this.#poll(catalog, "checkpoint-lookup:before-prepare");
      const checkpointLookup = prepareSQLiteConnectionIntrinsic(
        this.#connection, SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL, OPERATION,
      );
      this.#poll(catalog, "checkpoint-lookup:after-prepare");
      this.#poll(catalog, "source:before-prepare");
      const source = prepareSQLiteConnectionIntrinsic(
        this.#connection, SQLITE_CURSOR_SOURCE_QUERY, OPERATION,
      ).iterate()[Symbol.iterator]();
      let sourceClosed = false;
      let sourceRegistered = false;
      const closeSource = (): void => {
        if (sourceClosed) return;
        sourceClosed = true;
        try {
          source.return?.();
        } finally {
          if (sourceRegistered) this.#registeredCursorClosed();
        }
      };
      try {
        registerSQLiteCursorPreRebindStageCleanup(this.#stage, this.#campaign, closeSource);
        sourceRegistered = true;
        this.#registeredCursorOpened();
      } catch (error) {
        try { closeSource(); } catch { /* Registration failure remains primary. */ }
        throw error;
      }
      let walked = 0;
      let preStageAuthorization = 0;
      let preStageShape = 0;
      try {
        this.#poll(catalog, "source:after-prepare");
        for (;;) {
          this.#poll(catalog, "source:before-fetch");
          const next = source.next();
          if (next.done) {
            this.#poll(catalog, "source:after-fetch");
            break;
          }
          this.#maximumFetchSize = 1;
          this.#poll(catalog, "source:after-fetch");
          this.#liveRawRows += 1;
          this.#maximumLiveRawRows = Math.max(
            this.#maximumLiveRawRows, this.#liveRawRows,
          ) as 0 | 1;
          let decoded = false;
          try {
            this.#poll(catalog, "source:before-inspect");
            const inspected = inspectSQLiteCursorRow(next.value, {
              sourceOrdinal: walked + 1,
              sourceDescriptorHash: descriptor,
              sourceSchemaIdentitySha256: schema,
              providerHighWaterAtMs: clock.providerHighWaterAtMs,
              eventTailExists: (tenantId, streamId, sequence, recordHash) => {
                this.#poll(catalog, "event-lookup:before-get");
                const found = lookupMarkerFound(this.#pointOperation(() => eventLookup.get(
                  tenantId, streamId, sequence, recordHash,
                )));
                this.#poll(catalog, "event-lookup:after-get");
                return found;
              },
              checkpointPutExists: (tenantId, checkpointScope, checkpointId, summaryBlob) => {
                this.#poll(catalog, "checkpoint-lookup:before-get");
                const found = lookupMarkerFound(this.#pointOperation(() => checkpointLookup.get(
                  tenantId, checkpointScope, checkpointId, summaryBlob,
                )));
                this.#poll(catalog, "checkpoint-lookup:after-get");
                return found;
              },
            });
            decoded = true;
            this.#liveDecodedRows += 1;
            this.#maximumLiveDecodedRows = Math.max(
              this.#maximumLiveDecodedRows, this.#liveDecodedRows,
            ) as 0 | 1;
            this.#poll(catalog, "source:after-inspect");
            if (!inspected.stageable) {
              if (inspected.preStageAuthorization) preStageAuthorization += 1;
              if (inspected.preStageShape) preStageShape += 1;
              walked += 1;
              continue;
            }
            this.#poll(catalog, "stage-insert:before-execute");
            insertSQLiteCursorPreRebindStageRow(
              this.#stage, this.#campaign, inspected.stageValues,
            );
            this.#currentTempRows += 1;
            this.#maximumTempRows = Math.max(this.#maximumTempRows, this.#currentTempRows);
            this.#poll(catalog, "stage-insert:after-execute");
            walked += 1;
          } finally {
            if (decoded) this.#liveDecodedRows -= 1;
            this.#liveRawRows -= 1;
          }
        }
        this.#poll(catalog, "source:before-close");
        registerSQLiteCursorPreRebindStageCleanup(this.#stage, this.#campaign, undefined);
        closeSource();
        this.#poll(catalog, "source:after-close");
      } catch (error) {
        // The stage still owns closeSource; abort clears then invokes it once.
        throw error;
      }
      this.#fence(catalog);
      this.#measureTempObjectInventory(catalog);
      const mainAfter = countRows(this.#connection, "main.ge_cycle_cursors");
      const staged = countRows(this.#connection, "temp.ge_blr_cursor_seal");
      if (mainBefore !== mainAfter) {
        throw corruption("SQLite cursor main inventory changed during pre-rebind");
      }
      if (staged !== this.#currentTempRows) {
        throw corruption("SQLite cursor TEMP insert inventory changed during pre-rebind");
      }
      const vector = Array<number>(10).fill(0);
      const diagnostics: SQLiteCursorPreRebindDiagnostic[] = [];
      let rowRuleIndex = 0;
      for (let index = 0; index < SQLITE_CURSOR_PRE_REBIND_RULE_ORDER.length; index += 1) {
        const ruleId = SQLITE_CURSOR_PRE_REBIND_RULE_ORDER[index]!;
        this.#fence(catalog);
        this.#checkCancellation(`rule:${ruleId}:start`);
        let observed: number;
        if (ruleId === "BLR_CURSOR_SEAL_COUNT") {
          const bindings = sqliteCursorInventoryMarkerBindings(
            sealReceipt.cursorCount, walked, staged, this.#limit,
          );
          observed = this.#boundedMarkers(
            catalog, SQLITE_CURSOR_COUNT_MARKER_SQL, bindings, `rule:${ruleId}`,
          );
        } else {
          const rule = SQLITE_CURSOR_ROW_RULES[rowRuleIndex++]!;
          observed = this.#boundedMarkers(
            catalog, rule.sql, [this.#limit + 1], `rule:${ruleId}`,
          );
          if (ruleId === "BLR_CURSOR_AUTHORIZATION") {
            observed = Math.min(this.#limit + 1, observed + preStageAuthorization);
          } else if (ruleId === "BLR_CURSOR_SHAPE") {
            observed = Math.min(this.#limit + 1, observed + preStageShape);
          }
        }
        vector[index] = Math.min(observed, this.#limit);
        if (observed > 0) diagnostics.push(Object.freeze({
          ruleId,
          violationCount: Math.min(observed, this.#limit),
          diagnosticsTruncated: observed > this.#limit,
        }));
      }
      this.#fence(catalog);
      const [barrierDescriptor, barrierSchema] = readSourceIdentities(this.#connection);
      if (barrierDescriptor !== descriptor || barrierSchema !== schema
          || readProviderHighWater(this.#connection) !== clock.providerHighWaterAtMs) {
        throw corruption("SQLite cursor pre-rebind rule barrier evidence changed");
      }
      this.#fence(catalog);
      if (diagnostics.length > 0) {
        this.#measureTempObjectInventory(catalog);
        this.#assertPublicationSource(
          descriptor, schema, clock.providerHighWaterAtMs, mainBefore,
        );
        this.#checkCancellation("publish:diagnosed");
        diagnoseSQLiteCursorPreRebindStageCampaign(this.#stage, this.#campaign);
        this.#state = "diagnosed";
        return Object.freeze({
          status: "diagnosed",
          projectionIdentity: this.#witness.projectionIdentity,
          diagnostics: Object.freeze(diagnostics),
          vector: Object.freeze(vector) as unknown as SQLiteCursorPreRebindVector,
        });
      }

      if (walked !== sealReceipt.cursorCount || staged !== sealReceipt.cursorCount) {
        throw corruption("SQLite cursor pre-rebind clean inventory count changed");
      }

      const accumulator = new SQLiteCursorSealAccumulator(
        sealReceipt.cursorCount, descriptor, schema,
      );
      this.#poll(catalog, "seal:before-prepare");
      const seals = prepareSQLiteConnectionIntrinsic(
        this.#connection, SQLITE_CURSOR_STAGE_SEAL_SQL, OPERATION,
      ).iterate()[Symbol.iterator]();
      let sealsClosed = false;
      let sealsRegistered = false;
      const closeSeals = (): void => {
        if (sealsClosed) return;
        sealsClosed = true;
        try {
          seals.return?.();
        } finally {
          if (sealsRegistered) this.#registeredCursorClosed();
        }
      };
      try {
        registerSQLiteCursorPreRebindStageCleanup(this.#stage, this.#campaign, closeSeals);
        sealsRegistered = true;
        this.#registeredCursorOpened();
      } catch (error) {
        try { closeSeals(); } catch { /* Registration failure remains primary. */ }
        throw error;
      }
      try {
        this.#poll(catalog, "seal:after-prepare");
        for (;;) {
          this.#poll(catalog, "seal:before-fetch");
          const next = seals.next();
          if (next.done) {
            this.#poll(catalog, "seal:after-fetch");
            break;
          }
          this.#maximumFetchSize = 1;
          this.#liveRawRows += 1;
          this.#maximumLiveRawRows = Math.max(
            this.#maximumLiveRawRows, this.#liveRawRows,
          ) as 0 | 1;
          this.#liveCarriers += 1;
          this.#maximumLiveCarriers = Math.max(
            this.#maximumLiveCarriers, this.#liveCarriers,
          ) as 0 | 1;
          try {
            accumulator.append(sealRowFromStage(next.value));
            this.#poll(catalog, "seal:after-fetch");
          } finally {
            this.#liveCarriers -= 1;
            this.#liveRawRows -= 1;
          }
        }
        this.#poll(catalog, "seal:before-close");
        registerSQLiteCursorPreRebindStageCleanup(this.#stage, this.#campaign, undefined);
        closeSeals();
        this.#poll(catalog, "seal:after-close");
      } catch (error) {
        throw error;
      }
      const reproduced = accumulator.finish();
      if (reproduced.cursorCount !== sealReceipt.cursorCount
          || reproduced.immutableRootSha256 !== sealReceipt.immutableRootSha256
          || reproduced.sourceDescriptorHash !== sealReceipt.sourceDescriptorHash
          || reproduced.sourceSchemaIdentitySha256 !== sealReceipt.sourceSchemaIdentitySha256) {
        throw corruption("SQLite cursor pre-rebind A1 authority changed");
      }
      const [finalDescriptor, finalSchema] = readSourceIdentities(this.#connection);
      if (finalDescriptor !== descriptor || finalSchema !== schema
          || readProviderHighWater(this.#connection) !== clock.providerHighWaterAtMs) {
        throw corruption("SQLite cursor pre-rebind final source evidence changed");
      }
      assertSQLiteCursorPreRebindReceiptProvenance(this.#receipt);
      this.#fence(catalog);
      this.#measureTempObjectInventory(catalog);
      this.#assertPublicationSource(
        descriptor, schema, clock.providerHighWaterAtMs, mainBefore,
      );
      this.#checkCancellation("publish:complete");
      completeSQLiteCursorPreRebindStageCampaign(this.#stage, this.#campaign);
      this.#state = "complete";
      const emptyDiagnostics = Object.freeze([]) as readonly [];
      const emptyVector = Object.freeze(
        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const,
      );
      return Object.freeze({
        status: "pre-rebind-complete",
        projectionIdentity: this.#witness.projectionIdentity,
        receipt: this.#receipt,
        diagnostics: emptyDiagnostics,
        vector: emptyVector,
      });
    } catch (error) {
      primary = error;
      this.#state = "poisoned";
      throw primary;
    } finally {
      if (this.#state === "poisoned") {
        try {
          abortSQLiteCursorPreRebindStageCampaign(
            this.#stage, this.#campaign, "SQLite cursor pre-rebind campaign failed",
          );
        } catch (cleanupError) {
          if (primary === undefined) throw cleanupError;
        }
      }
    }
  }
}

export function runSQLiteCursorPreRebindCampaign(
  connection: SQLiteConnection,
  stage: SQLiteBaselineTempStage,
  receipt: SQLiteCursorPreRebindReceipt,
  transfer: SQLiteCursorStageOwnershipTransfer,
  options: SQLiteCursorPreRebindCampaignOptions = {},
): SQLiteCursorPreRebindOutcome {
  return new SQLiteCursorPreRebindCampaign(
    connection, stage, receipt, transfer, options,
  ).run();
}
