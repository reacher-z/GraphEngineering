import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLITE_BASELINE_ABORT_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_BEGIN_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN,
  SQLITE_BASELINE_REGISTER_CHECKPOINT_CLEANUP,
  type SQLiteBaselineCheckpointCampaignStage,
} from "./operation-baseline-cooperation.js";
import type { OperationBaselineProjectionIdentity } from "./operation-baseline.js";
import type { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import { sqliteRow, sqliteSafeInteger } from "./sqlite-codec.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

export const DEFAULT_SQLITE_CHECKPOINT_DIAGNOSTIC_LIMIT = 16;
export const MAX_SQLITE_CHECKPOINT_DIAGNOSTIC_LIMIT = 64;

const LATEST_REVISION = `NOT EXISTS (
  SELECT 1
    FROM temp.ge_blr_checkpoint_revisions AS later
         INDEXED BY ge_blr_checkpoint_revisions_latest_idx
   WHERE later.tenant_id = latest.tenant_id
     AND later.checkpoint_scope = latest.checkpoint_scope
     AND later.checkpoint_id = latest.checkpoint_id
     AND later.revision > latest.revision
)`;

const RAW_SQLITE_CHECKPOINT_RULES = [
  {
    ruleId: "BLR_CHECKPOINT_REVISION_GAP",
    sql: `SELECT 1
            FROM temp.ge_blr_checkpoint_revisions
                 INDEXED BY ge_blr_checkpoint_revisions_latest_idx
           GROUP BY tenant_id, checkpoint_scope
          HAVING min(revision) <> 1 OR count(*) <> max(revision)
           LIMIT ?`,
  },
  {
    ruleId: "BLR_CHECKPOINT_RECORD_MISSING",
    sql: `SELECT violation FROM (
            SELECT 1 AS violation
              FROM temp.ge_blr_checkpoint_current AS current
                   INDEXED BY ge_blr_checkpoint_current_record_idx
              LEFT JOIN temp.ge_blr_records AS record
                   INDEXED BY ge_blr_records_stream_position_idx
                ON record.tenant_id = current.tenant_id
               AND record.stream_id = current.stream_id
               AND record.sequence = current.bound_sequence
               AND record.record_hash = current.bound_record_hash
             WHERE record.key_blob IS NULL
            UNION ALL
            SELECT 1 AS violation
              FROM temp.ge_blr_checkpoint_revisions AS revision
                   INDEXED BY ge_blr_checkpoint_revisions_record_idx
              LEFT JOIN temp.ge_blr_records AS record
                   INDEXED BY ge_blr_records_stream_position_idx
                ON record.tenant_id = revision.tenant_id
               AND record.stream_id = revision.stream_id
               AND record.sequence = revision.bound_sequence
               AND record.record_hash = revision.bound_record_hash
             WHERE revision.action = 'put' AND record.key_blob IS NULL
          ) LIMIT ?`,
  },
  {
    ruleId: "BLR_CHECKPOINT_CURRENT_MISSING",
    sql: `SELECT 1
            FROM temp.ge_blr_checkpoint_revisions AS latest
                 INDEXED BY ge_blr_checkpoint_revisions_latest_idx
            LEFT JOIN temp.ge_blr_checkpoint_current AS current
              ON current.tenant_id = latest.tenant_id
             AND current.checkpoint_scope = latest.checkpoint_scope
             AND current.checkpoint_id = latest.checkpoint_id
           WHERE latest.action = 'put'
             AND ${LATEST_REVISION}
             AND current.key_blob IS NULL
           LIMIT ?`,
  },
  {
    ruleId: "BLR_CHECKPOINT_CURRENT_UNEXPECTED",
    sql: `SELECT 1
            FROM temp.ge_blr_checkpoint_current AS current
           WHERE NOT EXISTS (
             SELECT 1
               FROM temp.ge_blr_checkpoint_revisions AS latest
                    INDEXED BY ge_blr_checkpoint_revisions_latest_idx
              WHERE latest.tenant_id = current.tenant_id
                AND latest.checkpoint_scope = current.checkpoint_scope
                AND latest.checkpoint_id = current.checkpoint_id
                AND latest.action = 'put'
                AND ${LATEST_REVISION}
           )
           LIMIT ?`,
  },
  {
    ruleId: "BLR_CHECKPOINT_CURRENT_STALE",
    sql: `SELECT 1
            FROM temp.ge_blr_checkpoint_revisions AS latest
                 INDEXED BY ge_blr_checkpoint_revisions_latest_idx
            JOIN temp.ge_blr_checkpoint_current AS current
              ON current.tenant_id = latest.tenant_id
             AND current.checkpoint_scope = latest.checkpoint_scope
             AND current.checkpoint_id = latest.checkpoint_id
           WHERE latest.action = 'put'
             AND ${LATEST_REVISION}
             AND current.checkpoint_revision IS NOT latest.revision
           LIMIT ?`,
  },
  {
    ruleId: "BLR_CHECKPOINT_CURRENT_BINDING",
    sql: `SELECT violation FROM (
            SELECT 1 AS violation
              FROM temp.ge_blr_checkpoint_current AS current
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 4 AND common.key_blob = current.key_blob
              LEFT JOIN temp.ge_blr_checkpoint_revisions AS latest
                   INDEXED BY ge_blr_checkpoint_revisions_latest_idx
                ON latest.tenant_id = current.tenant_id
               AND latest.checkpoint_scope = current.checkpoint_scope
               AND latest.checkpoint_id = current.checkpoint_id
               AND latest.revision = current.checkpoint_revision
               AND latest.action = 'put'
               AND ${LATEST_REVISION}
             WHERE common.key_blob IS NULL
                OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId') IS NOT current.tenant_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.checkpointScope') IS NOT current.checkpoint_scope
                OR json_extract(CAST(common.key_blob AS TEXT), '$.checkpointId') IS NOT current.checkpoint_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId') IS NOT current.tenant_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointScope') IS NOT current.checkpoint_scope
                OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointId') IS NOT current.checkpoint_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId') IS NOT current.stream_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.boundSequence') IS NOT current.bound_sequence
                OR json_extract(CAST(common.state_blob AS TEXT), '$.boundRecordHash') IS NOT current.bound_record_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointRevision') IS NOT current.checkpoint_revision
                OR json_extract(CAST(common.state_blob AS TEXT), '$.createdAt') IS NOT current.checkpoint_created_at
                OR json_extract(CAST(common.state_blob AS TEXT), '$.valueHash') IS NOT current.value_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.valueBytes') IS NOT current.value_bytes
                OR json_extract(CAST(common.state_blob AS TEXT), '$.committedAtMs') IS NOT current.committed_at_ms
                OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.checkpointScope') IS NOT current.checkpoint_scope
                OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.checkpointId') IS NOT current.checkpoint_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.streamId') IS NOT current.stream_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.boundSequence') IS NOT current.bound_sequence
                OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.boundRecordHash') IS NOT current.bound_record_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.createdAt') IS NOT current.checkpoint_created_at
                OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.valueHash') IS NOT current.value_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.valueBytes') IS NOT current.value_bytes
                OR (latest.key_blob IS NOT NULL AND (
                     current.stream_id IS NOT latest.stream_id
                  OR current.bound_sequence IS NOT latest.bound_sequence
                  OR current.bound_record_hash IS NOT latest.bound_record_hash
                  OR current.checkpoint_created_at IS NOT latest.checkpoint_created_at
                  OR current.value_hash IS NOT latest.value_hash
                  OR current.value_bytes IS NOT latest.value_bytes
                  OR current.committed_at_ms IS NOT latest.recorded_at_ms
                ))
            UNION ALL
            SELECT 1 AS violation
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_checkpoint_current AS current
                ON current.key_blob = common.key_blob
             WHERE common.kind_rank = 4 AND current.key_blob IS NULL
            UNION ALL
            SELECT 1 AS violation
              FROM temp.ge_blr_checkpoint_revisions AS revision
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 5 AND common.key_blob = revision.key_blob
             WHERE common.key_blob IS NULL
                OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId') IS NOT revision.tenant_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.checkpointScope') IS NOT revision.checkpoint_scope
                OR json_extract(CAST(common.key_blob AS TEXT), '$.revision') IS NOT revision.revision
                OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId') IS NOT revision.tenant_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointScope') IS NOT revision.checkpoint_scope
                OR json_extract(CAST(common.state_blob AS TEXT), '$.revision') IS NOT revision.revision
                OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointId') IS NOT revision.checkpoint_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.action') IS NOT revision.action
                OR json_extract(CAST(common.state_blob AS TEXT), '$.boundSequence') IS NOT revision.bound_sequence
                OR json_extract(CAST(common.state_blob AS TEXT), '$.boundRecordHash') IS NOT revision.bound_record_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointCreatedAt') IS NOT revision.checkpoint_created_at
                OR json_extract(CAST(common.state_blob AS TEXT), '$.valueHash') IS NOT revision.value_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.valueBytes') IS NOT revision.value_bytes
                OR json_extract(CAST(common.state_blob AS TEXT), '$.recordedAtMs') IS NOT revision.recorded_at_ms
                OR (revision.action = 'put' AND (
                     json_extract(CAST(common.state_blob AS TEXT), '$.summary.checkpointScope') IS NOT revision.checkpoint_scope
                  OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.checkpointId') IS NOT revision.checkpoint_id
                  OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.streamId') IS NOT revision.stream_id
                  OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.boundSequence') IS NOT revision.bound_sequence
                  OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.boundRecordHash') IS NOT revision.bound_record_hash
                  OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.createdAt') IS NOT revision.checkpoint_created_at
                  OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.valueHash') IS NOT revision.value_hash
                  OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.valueBytes') IS NOT revision.value_bytes
                ))
                OR (revision.action = 'delete'
                  AND (json_type(CAST(common.state_blob AS TEXT), '$.boundSequence') IS NOT 'null'
                    OR json_type(CAST(common.state_blob AS TEXT), '$.boundRecordHash') IS NOT 'null'
                    OR json_type(CAST(common.state_blob AS TEXT), '$.checkpointCreatedAt') IS NOT 'null'
                    OR json_type(CAST(common.state_blob AS TEXT), '$.valueHash') IS NOT 'null'
                    OR json_type(CAST(common.state_blob AS TEXT), '$.valueBytes') IS NOT 'null'
                    OR json_type(CAST(common.state_blob AS TEXT), '$.summary') IS NOT 'null'))
            UNION ALL
            SELECT 1 AS violation
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_checkpoint_revisions AS revision
                ON revision.key_blob = common.key_blob
             WHERE common.kind_rank = 5 AND revision.key_blob IS NULL
          ) LIMIT ?`,
  },
] as const;

export const SQLITE_CHECKPOINT_RULES = Object.freeze(
  RAW_SQLITE_CHECKPOINT_RULES.map((rule) => Object.freeze(rule)),
);

export type SQLiteCheckpointRuleId = typeof SQLITE_CHECKPOINT_RULES[number]["ruleId"];

export interface SQLiteCheckpointDiagnostic {
  readonly ruleId: SQLiteCheckpointRuleId;
  readonly violationCount: number;
  readonly diagnosticsTruncated: boolean;
}

export interface SQLiteCheckpointCampaignReport {
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly diagnostics: readonly SQLiteCheckpointDiagnostic[];
}

export interface SQLiteCheckpointCampaignOptions {
  readonly diagnosticLimit?: number;
}

function corruption(message: string): CycleStoreProviderError {
  return new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function diagnosticLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SQLITE_CHECKPOINT_DIAGNOSTIC_LIMIT;
  let ownKeys: readonly PropertyKey[];
  let prototype: object | null;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    ownKeys = Reflect.ownKeys(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline checkpoint campaign options are invalid",
    );
  }
  if (prototype !== Object.prototype
      || ownKeys.some((key) => key !== "diagnosticLimit")
      || ownKeys.length > 1) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline checkpoint campaign options are invalid",
    );
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "diagnosticLimit");
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline checkpoint campaign options are invalid",
    );
  }
  if (descriptor !== undefined && !("value" in descriptor)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline checkpoint campaign options are invalid",
    );
  }
  const checked = descriptor === undefined
    ? DEFAULT_SQLITE_CHECKPOINT_DIAGNOSTIC_LIMIT
    : descriptor.value;
  if (!Number.isSafeInteger(checked)
      || (checked as number) < 1
      || (checked as number) > MAX_SQLITE_CHECKPOINT_DIAGNOSTIC_LIMIT) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline checkpoint diagnostic limit is outside bounds",
    );
  }
  return checked as number;
}

/** Package-private one-shot executor for the frozen checkpoint rule family. */
export class SQLiteCheckpointInvariantCampaign {
  readonly #connection: SQLiteConnection;
  readonly #projectionIdentity: OperationBaselineProjectionIdentity;
  readonly #stage: SQLiteBaselineTempStage & SQLiteBaselineCheckpointCampaignStage;
  readonly #session: object;
  readonly #limit: number;
  #state: "open" | "complete" | "poisoned" = "open";

  constructor(
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
    stage: SQLiteBaselineTempStage,
    options: SQLiteCheckpointCampaignOptions = {},
  ) {
    this.#connection = connection;
    this.#projectionIdentity = projectionIdentity;
    this.#stage = stage as SQLiteBaselineTempStage & SQLiteBaselineCheckpointCampaignStage;
    this.#limit = diagnosticLimit(options);
    this.#session = this.#stage[SQLITE_BASELINE_BEGIN_CHECKPOINT_CAMPAIGN](
      connection, projectionIdentity,
    );
  }

  get state(): "open" | "complete" | "poisoned" {
    if (this.#state === "open" && this.#stage.state !== "open") this.#state = "poisoned";
    return this.#state;
  }

  run(): SQLiteCheckpointCampaignReport {
    if (this.#state !== "open") {
      return this.#stage[SQLITE_BASELINE_ABORT_CHECKPOINT_CAMPAIGN](
        undefined, "SQLite baseline checkpoint campaign is one-shot",
      );
    }
    const diagnostics: SQLiteCheckpointDiagnostic[] = [];
    let activeFinalizer: (() => void) | undefined;
    let primaryFailure: unknown;
    try {
      for (const rule of SQLITE_CHECKPOINT_RULES) {
        this.#stage[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](this.#session);
        const iterator = this.#connection.prepare(rule.sql, OPERATION)
          .iterate(this.#limit + 1)[Symbol.iterator]();
        let finalized = false;
        const finalize = (): void => {
          if (finalized) return;
          finalized = true;
          iterator.return?.();
        };
        activeFinalizer = finalize;
        this.#stage[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](this.#session);
        this.#stage[SQLITE_BASELINE_REGISTER_CHECKPOINT_CLEANUP](this.#session, finalize);
        let observed = 0;
        while (observed <= this.#limit) {
          this.#stage[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](this.#session);
          const next = iterator.next();
          this.#stage[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](this.#session);
          if (next.done) break;
          const row = sqliteRow(next.value, 1, OPERATION, "checkpoint witness row");
          sqliteSafeInteger(row[0], 1, 1, OPERATION, "checkpoint witness marker");
          observed += 1;
        }
        finalize();
        activeFinalizer = undefined;
        this.#stage[SQLITE_BASELINE_REGISTER_CHECKPOINT_CLEANUP](this.#session, undefined);
        this.#stage[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](this.#session);
        if (observed > 0) {
          diagnostics.push(Object.freeze({
            ruleId: rule.ruleId,
            violationCount: Math.min(observed, this.#limit),
            diagnosticsTruncated: observed > this.#limit,
          }));
        }
        this.#stage[SQLITE_BASELINE_FENCE_CHECKPOINT_CAMPAIGN](this.#session);
      }
      this.#stage[SQLITE_BASELINE_COMPLETE_CHECKPOINT_CAMPAIGN](this.#session);
      this.#state = "complete";
      return Object.freeze({
        projectionIdentity: this.#projectionIdentity,
        diagnostics: Object.freeze(diagnostics),
      });
    } catch (error) {
      primaryFailure = error instanceof CycleStoreProviderError
        ? error
        : corruption("SQLite baseline checkpoint campaign failed");
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
          this.#stage[SQLITE_BASELINE_ABORT_CHECKPOINT_CAMPAIGN](
            this.#session, "SQLite baseline checkpoint campaign failed",
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
    this.#stage[SQLITE_BASELINE_ABORT_CHECKPOINT_CAMPAIGN](
      this.#session, "SQLite baseline checkpoint campaign was abandoned",
    );
  }
}

export function runSQLiteCheckpointInvariantCampaign(
  connection: SQLiteConnection,
  projectionIdentity: OperationBaselineProjectionIdentity,
  stage: SQLiteBaselineTempStage,
  options: SQLiteCheckpointCampaignOptions = {},
): SQLiteCheckpointCampaignReport {
  return new SQLiteCheckpointInvariantCampaign(
    connection, projectionIdentity, stage, options,
  ).run();
}
