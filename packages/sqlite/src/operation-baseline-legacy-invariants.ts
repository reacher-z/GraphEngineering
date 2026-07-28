import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLITE_BASELINE_ABORT_LEGACY_CAMPAIGN,
  SQLITE_BASELINE_BEGIN_LEGACY_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_LEGACY_CAMPAIGN,
  SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN,
  SQLITE_BASELINE_REGISTER_LEGACY_CLEANUP,
  type SQLiteBaselineLegacyCampaignStage,
} from "./operation-baseline-cooperation.js";
import type { OperationBaselineProjectionIdentity } from "./operation-baseline.js";
import type { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import { sqliteRow, sqliteSafeInteger } from "./sqlite-codec.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

export const DEFAULT_SQLITE_LEGACY_DIAGNOSTIC_LIMIT = 16;
export const MAX_SQLITE_LEGACY_DIAGNOSTIC_LIMIT = 64;

const LEGACY_OPERATION_NAMES = `
  'append', 'save-checkpoint', 'delete-checkpoint', 'acquire-lease',
  'renew-lease', 'release-lease', 'set-legal-hold',
  'acquire-migration-lock', 'release-migration-lock'`;

const RAW_SQLITE_LEGACY_RULES = [
  {
    ruleId: "BLR_LEGACY_INVENTORY",
    sql: `SELECT 1 FROM (
            SELECT legacy.tenant_id, legacy.operation_id
              FROM temp.ge_blr_legacy_operations AS legacy
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 11 AND common.key_blob = legacy.key_blob
              LEFT JOIN main.ge_cycle_operations AS source
                ON source.tenant_id = legacy.tenant_id
               AND source.operation_id = legacy.operation_id
             WHERE common.key_blob IS NULL
                OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId') IS NOT legacy.tenant_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.operationId') IS NOT legacy.operation_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId') IS NOT legacy.tenant_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.operationId') IS NOT legacy.operation_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.operationName') IS NOT legacy.operation_name
                OR json_extract(CAST(common.state_blob AS TEXT), '$.requestHash') IS NOT legacy.request_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.resultHash') IS NOT legacy.result_hash
                OR json_extract(CAST(common.state_blob AS TEXT), '$.resultBlobSha256') IS NOT legacy.result_blob_sha256
                OR json_extract(CAST(common.state_blob AS TEXT), '$.committedAtMs') IS NOT legacy.committed_at_ms
                OR source.operation_id IS NULL
                OR source.operation_name IS NOT legacy.operation_name
                OR source.request_hash IS NOT legacy.request_hash
                OR source.result_hash IS NOT legacy.result_hash
                OR source.committed_at_ms IS NOT legacy.committed_at_ms
            UNION ALL
            SELECT json_extract(CAST(common.key_blob AS TEXT), '$.tenantId'),
                   json_extract(CAST(common.key_blob AS TEXT), '$.operationId')
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_legacy_operations AS legacy
                ON legacy.key_blob = common.key_blob
             WHERE common.kind_rank = 11 AND legacy.key_blob IS NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM temp.ge_blr_legacy_operations AS identity_legacy
                  WHERE identity_legacy.tenant_id = json_extract(
                          CAST(common.key_blob AS TEXT), '$.tenantId')
                    AND identity_legacy.operation_id = json_extract(
                          CAST(common.key_blob AS TEXT), '$.operationId')
               )
            UNION ALL
            SELECT source.tenant_id, source.operation_id
              FROM main.ge_cycle_operations AS source
              LEFT JOIN temp.ge_blr_legacy_operations AS legacy
                ON legacy.tenant_id = source.tenant_id
               AND legacy.operation_id = source.operation_id
             WHERE source.operation_name IN (${LEGACY_OPERATION_NAMES})
               AND legacy.key_blob IS NULL
               AND NOT EXISTS (
                 SELECT 1
                   FROM temp.ge_blr_stage AS common
                  WHERE common.kind_rank = 11
                    AND json_extract(CAST(common.key_blob AS TEXT), '$.tenantId') = source.tenant_id
                    AND json_extract(CAST(common.key_blob AS TEXT), '$.operationId') = source.operation_id
               )
          ) AS violation_units
          LIMIT ?`,
    requiredIndexes: Object.freeze([] as const),
  },
  {
    ruleId: "BLR_LEGACY_APPEND_BINDING",
    sql: `SELECT 1
            FROM temp.ge_blr_legacy_operations AS legacy
           WHERE legacy.operation_name = 'append'
             AND (legacy.tail_exists IS NOT 1
               OR legacy.appended_records < 1
               OR legacy.tail_sequence - legacy.appended_records + 1 < 0
               OR NOT EXISTS (
                 SELECT 1
                   FROM temp.ge_blr_records AS tail
                        INDEXED BY ge_blr_records_tenant_hash_uidx
                  WHERE tail.tenant_id = legacy.tenant_id
                    AND tail.record_hash = legacy.tail_record_hash
                    AND tail.sequence = legacy.tail_sequence
                    AND (SELECT count(*)
                           FROM temp.ge_blr_records AS member
                                INDEXED BY ge_blr_records_stream_sequence_uidx
                          WHERE member.tenant_id = tail.tenant_id
                            AND member.stream_id = tail.stream_id
                            AND member.sequence BETWEEN
                                legacy.tail_sequence - legacy.appended_records + 1
                                AND legacy.tail_sequence) = legacy.appended_records
               ))
           LIMIT ?`,
    requiredIndexes: Object.freeze([
      "ge_blr_records_tenant_hash_uidx",
      "ge_blr_records_stream_sequence_uidx",
    ] as const),
  },
  {
    ruleId: "BLR_LEGACY_CHECKPOINT_BINDING",
    sql: `SELECT 1
            FROM temp.ge_blr_legacy_operations AS legacy
           WHERE (legacy.operation_name = 'save-checkpoint' AND NOT EXISTS (
                    SELECT 1
                      FROM temp.ge_blr_checkpoint_revisions AS revision
                           INDEXED BY ge_blr_checkpoint_revisions_latest_idx
                     WHERE revision.tenant_id = legacy.tenant_id
                       AND revision.checkpoint_scope = legacy.checkpoint_scope
                       AND revision.checkpoint_id = legacy.checkpoint_id
                       AND revision.action = 'put'
                       AND revision.stream_id = legacy.checkpoint_stream_id
                       AND revision.bound_sequence = legacy.checkpoint_bound_sequence
                       AND revision.bound_record_hash = legacy.checkpoint_bound_record_hash
                       AND revision.checkpoint_created_at = legacy.checkpoint_created_at
                       AND revision.value_hash = legacy.checkpoint_value_hash
                       AND revision.value_bytes = legacy.checkpoint_value_bytes
                  ))
              OR (legacy.operation_name = 'delete-checkpoint'
                  AND legacy.checkpoint_deleted = 1
                  AND NOT EXISTS (
                    SELECT 1
                      FROM temp.ge_blr_checkpoint_revisions AS revision
                           INDEXED BY ge_blr_checkpoint_revisions_latest_idx
                     WHERE revision.tenant_id = legacy.tenant_id
                       AND revision.action = 'delete'
                  ))
           LIMIT ?`,
    requiredIndexes: Object.freeze(["ge_blr_checkpoint_revisions_latest_idx"] as const),
  },
  {
    ruleId: "BLR_LEGACY_LEASE_BINDING",
    sql: `SELECT 1
            FROM temp.ge_blr_legacy_operations AS legacy
           WHERE ((legacy.operation_name = 'acquire-lease'
                    OR legacy.operation_name = 'renew-lease')
                  AND NOT EXISTS (
                    SELECT 1
                      FROM temp.ge_blr_used_leases AS used
                           INDEXED BY ge_blr_used_leases_epoch_uidx
                     WHERE used.tenant_id = legacy.tenant_id
                       AND used.lease_id = legacy.lease_id
                       AND used.lease_epoch = legacy.lease_epoch
                       AND used.fencing_token = legacy.lease_fencing_token
                       AND used.first_used_at_ms = legacy.lease_acquired_at_ms
                  ))
              OR (legacy.operation_name = 'release-lease' AND NOT EXISTS (
                    SELECT 1
                      FROM temp.ge_blr_used_leases AS used
                           INDEXED BY ge_blr_used_leases_epoch_uidx
                      JOIN temp.ge_blr_leases AS lease
                        ON lease.tenant_id = used.tenant_id
                       AND lease.stream_id = used.stream_id
                     WHERE used.tenant_id = legacy.tenant_id
                       AND used.lease_epoch = legacy.last_lease_epoch
                       AND used.fencing_token = legacy.last_lease_fencing_token
                       AND lease.last_lease_epoch >= legacy.last_lease_epoch
                       AND lease.last_fencing_token >= legacy.last_lease_fencing_token
                  ))
           LIMIT ?`,
    requiredIndexes: Object.freeze(["ge_blr_used_leases_epoch_uidx"] as const),
  },
  {
    ruleId: "BLR_LEGACY_LOCK_BINDING",
    sql: `SELECT 1
            FROM temp.ge_blr_legacy_operations AS legacy
           WHERE legacy.operation_name = 'acquire-migration-lock'
             AND (NOT EXISTS (
                    SELECT 1
                      FROM temp.ge_blr_used_migration_locks AS used
                     WHERE used.lock_id = legacy.lock_id
                       AND used.lock_epoch = legacy.lock_epoch
                       AND used.fencing_token = legacy.lock_fencing_token
                       AND used.first_used_at_ms = legacy.lock_acquired_at_ms
                  )
               OR EXISTS (
                    SELECT 1
                      FROM temp.ge_blr_migration_lock AS lock
                     WHERE lock.singleton = 1
                       AND lock.active_lock_id = legacy.lock_id
                       AND (lock.active_owner_id IS NOT legacy.lock_owner_id
                         OR lock.active_source_version IS NOT legacy.lock_source_version
                         OR lock.active_target_version IS NOT legacy.lock_target_version
                         OR lock.active_lock_epoch IS NOT legacy.lock_epoch
                         OR lock.active_fencing_token IS NOT legacy.lock_fencing_token
                         OR lock.active_acquired_at_ms IS NOT legacy.lock_acquired_at_ms
                         OR lock.active_expires_at_ms IS NOT legacy.lock_expires_at_ms)
                  ))
           LIMIT ?`,
    requiredIndexes: Object.freeze([] as const),
  },
] as const;

export const SQLITE_LEGACY_RULES = Object.freeze(
  RAW_SQLITE_LEGACY_RULES.map((rule) => Object.freeze(rule)),
);

export type SQLiteLegacyRuleId = typeof SQLITE_LEGACY_RULES[number]["ruleId"];

export interface SQLiteLegacyDiagnostic {
  readonly ruleId: SQLiteLegacyRuleId;
  readonly violationCount: number;
  readonly diagnosticsTruncated: boolean;
}

export interface SQLiteLegacyCampaignReport {
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly diagnostics: readonly SQLiteLegacyDiagnostic[];
}

export interface SQLiteLegacyCampaignOptions {
  readonly diagnosticLimit?: number;
}

function corruption(message: string): CycleStoreProviderError {
  return new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function diagnosticLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SQLITE_LEGACY_DIAGNOSTIC_LIMIT;
  let keys: readonly PropertyKey[];
  let prototype: object | null;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    keys = Reflect.ownKeys(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline legacy campaign options are invalid",
    );
  }
  if (prototype !== Object.prototype
      || keys.some((key) => key !== "diagnosticLimit")
      || keys.length > 1) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline legacy campaign options are invalid",
    );
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "diagnosticLimit");
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline legacy campaign options are invalid",
    );
  }
  if (descriptor !== undefined && !("value" in descriptor)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline legacy campaign options are invalid",
    );
  }
  const checked = descriptor === undefined
    ? DEFAULT_SQLITE_LEGACY_DIAGNOSTIC_LIMIT
    : descriptor.value;
  if (!Number.isSafeInteger(checked)
      || (checked as number) < 1
      || (checked as number) > MAX_SQLITE_LEGACY_DIAGNOSTIC_LIMIT) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline legacy diagnostic limit is outside bounds",
    );
  }
  return checked as number;
}

/** Package-private one-shot executor for the frozen legacy family. */
export class SQLiteLegacyInvariantCampaign {
  readonly #connection: SQLiteConnection;
  readonly #projectionIdentity: OperationBaselineProjectionIdentity;
  readonly #stage: SQLiteBaselineTempStage & SQLiteBaselineLegacyCampaignStage;
  readonly #session: object;
  readonly #limit: number;
  #state: "open" | "complete" | "poisoned" = "open";

  constructor(
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
    stage: SQLiteBaselineTempStage,
    options: SQLiteLegacyCampaignOptions = {},
  ) {
    this.#connection = connection;
    this.#projectionIdentity = projectionIdentity;
    this.#stage = stage as SQLiteBaselineTempStage & SQLiteBaselineLegacyCampaignStage;
    this.#limit = diagnosticLimit(options);
    this.#session = this.#stage[SQLITE_BASELINE_BEGIN_LEGACY_CAMPAIGN](
      connection, projectionIdentity,
    );
  }

  get state(): "open" | "complete" | "poisoned" {
    if (this.#state === "open" && this.#stage.state !== "open") this.#state = "poisoned";
    return this.#state;
  }

  run(): SQLiteLegacyCampaignReport {
    if (this.#state !== "open") {
      return this.#stage[SQLITE_BASELINE_ABORT_LEGACY_CAMPAIGN](
        undefined, "SQLite baseline legacy campaign is one-shot",
      );
    }
    const diagnostics: SQLiteLegacyDiagnostic[] = [];
    let activeFinalizer: (() => void) | undefined;
    let primaryFailure: unknown;
    try {
      for (const rule of SQLITE_LEGACY_RULES) {
        this.#stage[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](this.#session);
        const iterator = this.#connection.prepare(rule.sql, OPERATION)
          .iterate(this.#limit + 1)[Symbol.iterator]();
        let finalized = false;
        const finalize = (): void => {
          if (finalized) return;
          finalized = true;
          iterator.return?.();
        };
        activeFinalizer = finalize;
        this.#stage[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](this.#session);
        this.#stage[SQLITE_BASELINE_REGISTER_LEGACY_CLEANUP](this.#session, finalize);
        let observed = 0;
        while (observed <= this.#limit) {
          this.#stage[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](this.#session);
          const next = iterator.next();
          this.#stage[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](this.#session);
          if (next.done) break;
          const row = sqliteRow(next.value, 1, OPERATION, "legacy witness row");
          sqliteSafeInteger(row[0], 1, 1, OPERATION, "legacy witness marker");
          observed += 1;
        }
        finalize();
        activeFinalizer = undefined;
        this.#stage[SQLITE_BASELINE_REGISTER_LEGACY_CLEANUP](this.#session, undefined);
        this.#stage[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](this.#session);
        if (observed > 0) {
          diagnostics.push(Object.freeze({
            ruleId: rule.ruleId,
            violationCount: Math.min(observed, this.#limit),
            diagnosticsTruncated: observed > this.#limit,
          }));
        }
        this.#stage[SQLITE_BASELINE_FENCE_LEGACY_CAMPAIGN](this.#session);
      }
      this.#stage[SQLITE_BASELINE_COMPLETE_LEGACY_CAMPAIGN](this.#session);
      this.#state = "complete";
      return Object.freeze({
        projectionIdentity: this.#projectionIdentity,
        diagnostics: Object.freeze(diagnostics),
      });
    } catch (error) {
      primaryFailure = error instanceof CycleStoreProviderError
        ? error
        : corruption("SQLite baseline legacy campaign failed");
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
          this.#stage[SQLITE_BASELINE_ABORT_LEGACY_CAMPAIGN](
            this.#session, "SQLite baseline legacy campaign failed",
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
    this.#stage[SQLITE_BASELINE_ABORT_LEGACY_CAMPAIGN](
      this.#session, "SQLite baseline legacy campaign was abandoned",
    );
  }
}

export function runSQLiteLegacyInvariantCampaign(
  connection: SQLiteConnection,
  projectionIdentity: OperationBaselineProjectionIdentity,
  stage: SQLiteBaselineTempStage,
  options: SQLiteLegacyCampaignOptions = {},
): SQLiteLegacyCampaignReport {
  return new SQLiteLegacyInvariantCampaign(
    connection, projectionIdentity, stage, options,
  ).run();
}
