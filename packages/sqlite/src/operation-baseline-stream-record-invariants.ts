import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLITE_BASELINE_ABORT_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_BEGIN_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN,
  SQLITE_BASELINE_REGISTER_STREAM_RECORD_CLEANUP,
  type SQLiteBaselineStreamRecordCampaignStage,
} from "./operation-baseline-cooperation.js";
import type { OperationBaselineProjectionIdentity } from "./operation-baseline.js";
import type { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import { sqliteRow, sqliteSafeInteger } from "./sqlite-codec.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

export const DEFAULT_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT = 16;
export const MAX_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT = 64;

const RAW_SQLITE_STREAM_RECORD_RULES = [
  {
    ruleId: "BLR_RECORD_STREAM_MISSING",
    sql: `SELECT 1
            FROM temp.ge_blr_records AS record
                 INDEXED BY ge_blr_records_stream_sequence_uidx
            LEFT JOIN temp.ge_blr_streams AS stream
              ON stream.tenant_id = record.tenant_id
             AND stream.stream_id = record.stream_id
           WHERE stream.key_blob IS NULL
           LIMIT ?`,
  },
  {
    ruleId: "BLR_STREAM_EMPTY",
    sql: `SELECT 1
            FROM temp.ge_blr_streams
           WHERE tail_sequence = -1
           LIMIT ?`,
  },
  {
    ruleId: "BLR_RECORD_GAP",
    sql: `SELECT 1
            FROM temp.ge_blr_records INDEXED BY ge_blr_records_stream_sequence_uidx
           GROUP BY tenant_id, stream_id
          HAVING min(sequence) <> 0 OR count(*) <> max(sequence) + 1
           LIMIT ?`,
  },
  {
    ruleId: "BLR_RECORD_PREDECESSOR",
    sql: `SELECT 1
            FROM temp.ge_blr_records AS current
                 INDEXED BY ge_blr_records_stream_sequence_uidx
            JOIN temp.ge_blr_records AS prior
                 INDEXED BY ge_blr_records_stream_position_idx
              ON prior.tenant_id = current.tenant_id
             AND prior.stream_id = current.stream_id
             AND prior.sequence = current.sequence - 1
           WHERE current.sequence > 0
             AND current.previous_record_hash IS NOT prior.record_hash
           LIMIT ?`,
  },
  {
    ruleId: "BLR_STREAM_TAIL",
    sql: `SELECT 1
            FROM temp.ge_blr_streams AS stream
            LEFT JOIN temp.ge_blr_records AS tail
                 INDEXED BY ge_blr_records_stream_position_idx
              ON tail.tenant_id = stream.tenant_id
             AND tail.stream_id = stream.stream_id
             AND tail.sequence = stream.tail_sequence
           WHERE stream.tail_sequence >= 0
             AND (tail.key_blob IS NULL
               OR tail.record_hash IS NOT stream.tail_record_hash
               OR EXISTS (
                 SELECT 1
                   FROM temp.ge_blr_records AS later
                        INDEXED BY ge_blr_records_stream_position_idx
                  WHERE later.tenant_id = stream.tenant_id
                    AND later.stream_id = stream.stream_id
                    AND later.sequence > stream.tail_sequence
               ))
           LIMIT ?`,
  },
  {
    ruleId: "BLR_RECORD_HASH_DUPLICATE",
    sql: `SELECT 1
            FROM temp.ge_blr_records INDEXED BY ge_blr_records_tenant_hash_uidx
           GROUP BY tenant_id, record_hash
          HAVING count(*) > 1
           LIMIT ?`,
  },
  {
    ruleId: "BLR_RECORD_BINDING",
    sql: `SELECT violation FROM (
            SELECT 1 AS violation
              FROM temp.ge_blr_records AS record
                   INDEXED BY ge_blr_records_tenant_hash_uidx
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 3 AND common.key_blob = record.key_blob
             WHERE common.key_blob IS NULL
                OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId') IS NOT record.tenant_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.recordId') IS NOT record.record_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId') IS NOT record.tenant_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId') IS NOT record.stream_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.recordId') IS NOT record.record_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.sequence') IS NOT record.sequence
                OR json_extract(CAST(common.state_blob AS TEXT), '$.previousRecordHash') IS NOT record.previous_record_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.recordHash') IS NOT record.record_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.valueHash') IS NOT record.value_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.valueBytes') IS NOT record.value_bytes
                OR json_extract(CAST(common.state_blob AS TEXT), '$.committedAtMs') IS NOT record.committed_at_ms
            UNION ALL
            SELECT 1 AS violation
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_records AS record ON record.key_blob = common.key_blob
             WHERE common.kind_rank = 3 AND record.key_blob IS NULL
          ) LIMIT ?`,
  },
] as const;

export const SQLITE_STREAM_RECORD_RULES = Object.freeze(
  RAW_SQLITE_STREAM_RECORD_RULES.map((rule) => Object.freeze(rule)),
);

export type SQLiteStreamRecordRuleId = typeof SQLITE_STREAM_RECORD_RULES[number]["ruleId"];

export interface SQLiteBaselineReconciliationDiagnostic {
  readonly ruleId: SQLiteStreamRecordRuleId;
  readonly violationCount: number;
  readonly diagnosticsTruncated: boolean;
}

export interface SQLiteStreamRecordCampaignReport {
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly diagnostics: readonly SQLiteBaselineReconciliationDiagnostic[];
}

export interface SQLiteStreamRecordCampaignOptions {
  readonly diagnosticLimit?: number;
}

function corruption(message: string): CycleStoreProviderError {
  return new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function campaignDiagnosticLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT;
  let ownKeys: readonly PropertyKey[];
  let prototype: object | null;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    ownKeys = Reflect.ownKeys(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite baseline stream/record campaign options are invalid",
    );
  }
  if (prototype !== Object.prototype
      || ownKeys.some((key) => key !== "diagnosticLimit")
      || ownKeys.length > 1) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite baseline stream/record campaign options are invalid",
    );
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "diagnosticLimit");
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite baseline stream/record campaign options are invalid",
    );
  }
  if (descriptor !== undefined && !("value" in descriptor)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite baseline stream/record campaign options are invalid",
    );
  }
  const checked = descriptor === undefined
    ? DEFAULT_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT
    : descriptor.value;
  if (!Number.isSafeInteger(checked)
      || (checked as number) < 1
      || (checked as number) > MAX_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT",
      OPERATION,
      "SQLite baseline diagnostic limit is outside bounds",
    );
  }
  return checked as number;
}

/** Package-private one-shot executor for the frozen stream/record rule family. */
export class SQLiteStreamRecordInvariantCampaign {
  readonly #connection: SQLiteConnection;
  readonly #projectionIdentity: OperationBaselineProjectionIdentity;
  readonly #stage: SQLiteBaselineTempStage & SQLiteBaselineStreamRecordCampaignStage;
  readonly #session: object;
  readonly #limit: number;
  #state: "open" | "complete" | "poisoned" = "open";

  constructor(
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
    stage: SQLiteBaselineTempStage,
    options: SQLiteStreamRecordCampaignOptions = {},
  ) {
    this.#connection = connection;
    this.#projectionIdentity = projectionIdentity;
    this.#stage = stage as SQLiteBaselineTempStage & SQLiteBaselineStreamRecordCampaignStage;
    this.#limit = campaignDiagnosticLimit(options);
    this.#session = this.#stage[SQLITE_BASELINE_BEGIN_STREAM_RECORD_CAMPAIGN](
      connection,
      projectionIdentity,
    );
  }

  get state(): "open" | "complete" | "poisoned" {
    if (this.#state === "open" && this.#stage.state !== "open") this.#state = "poisoned";
    return this.#state;
  }

  run(): SQLiteStreamRecordCampaignReport {
    if (this.#state !== "open") {
      return this.#stage[SQLITE_BASELINE_ABORT_STREAM_RECORD_CAMPAIGN](
        undefined,
        "SQLite baseline stream/record campaign is one-shot",
      );
    }
    const diagnostics: SQLiteBaselineReconciliationDiagnostic[] = [];
    let activeFinalizer: (() => void) | undefined;
    let primaryFailure: unknown;
    try {
      for (const rule of SQLITE_STREAM_RECORD_RULES) {
        this.#stage[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](this.#session);
        const iterator = this.#connection.prepare(rule.sql, OPERATION)
          .iterate(this.#limit + 1)[Symbol.iterator]();
        let finalized = false;
        const finalize = (): void => {
          if (finalized) return;
          finalized = true;
          iterator.return?.();
        };
        activeFinalizer = finalize;
        this.#stage[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](this.#session);
        this.#stage[SQLITE_BASELINE_REGISTER_STREAM_RECORD_CLEANUP](
          this.#session,
          finalize,
        );
        let observed = 0;
        while (observed <= this.#limit) {
          this.#stage[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](this.#session);
          const next = iterator.next();
          this.#stage[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](this.#session);
          if (next.done) break;
          const row = sqliteRow(next.value, 1, OPERATION, "stream/record witness row");
          sqliteSafeInteger(row[0], 1, 1, OPERATION, "stream/record witness marker");
          observed += 1;
        }
        finalize();
        activeFinalizer = undefined;
        this.#stage[SQLITE_BASELINE_REGISTER_STREAM_RECORD_CLEANUP](
          this.#session,
          undefined,
        );
        this.#stage[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](this.#session);
        if (observed > 0) {
          diagnostics.push(Object.freeze({
            ruleId: rule.ruleId,
            violationCount: Math.min(observed, this.#limit),
            diagnosticsTruncated: observed > this.#limit,
          }));
        }
        this.#stage[SQLITE_BASELINE_FENCE_STREAM_RECORD_CAMPAIGN](this.#session);
      }
      this.#stage[SQLITE_BASELINE_COMPLETE_STREAM_RECORD_CAMPAIGN](this.#session);
      this.#state = "complete";
      return Object.freeze({
        projectionIdentity: this.#projectionIdentity,
        diagnostics: Object.freeze(diagnostics),
      });
    } catch (error) {
      primaryFailure = error instanceof CycleStoreProviderError
        ? error
        : corruption("SQLite baseline stream/record campaign failed");
      this.#state = "poisoned";
      throw primaryFailure;
    } finally {
      if (this.#state !== "complete") {
        try {
          activeFinalizer?.();
        } catch {
          // Preserve the authoritative rule or fence failure.
        }
        try {
          this.#stage[SQLITE_BASELINE_ABORT_STREAM_RECORD_CAMPAIGN](
            this.#session,
            "SQLite baseline stream/record campaign failed",
          );
        } catch (cleanupError) {
          if (primaryFailure === undefined) throw cleanupError;
        }
      }
    }
  }

  dispose(): void {
    if (this.#state !== "open") return;
    this.#state = "poisoned";
    this.#stage[SQLITE_BASELINE_ABORT_STREAM_RECORD_CAMPAIGN](
      this.#session,
      "SQLite baseline stream/record campaign was abandoned",
    );
  }
}

export function runSQLiteStreamRecordInvariantCampaign(
  connection: SQLiteConnection,
  projectionIdentity: OperationBaselineProjectionIdentity,
  stage: SQLiteBaselineTempStage,
  options: SQLiteStreamRecordCampaignOptions = {},
): SQLiteStreamRecordCampaignReport {
  return new SQLiteStreamRecordInvariantCampaign(
    connection,
    projectionIdentity,
    stage,
    options,
  ).run();
}
