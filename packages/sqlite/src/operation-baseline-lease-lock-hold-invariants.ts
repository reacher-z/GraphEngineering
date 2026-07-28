import { CycleStoreProviderError } from "@graph-engineering/runtime";

import {
  SQLITE_BASELINE_ABORT_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_BEGIN_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN,
  SQLITE_BASELINE_REGISTER_LEASE_LOCK_HOLD_CLEANUP,
  type SQLiteBaselineLeaseLockHoldCampaignStage,
} from "./operation-baseline-cooperation.js";
import type { OperationBaselineProjectionIdentity } from "./operation-baseline.js";
import type { SQLiteBaselineTempStage } from "./operation-baseline-stage.js";
import { sqliteRow, sqliteSafeInteger } from "./sqlite-codec.js";
import type { SQLiteConnection } from "./sqlite-connection.js";

const OPERATION = "inspect-schema" as const;

export const DEFAULT_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT = 16;
export const MAX_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT = 64;

const RAW_SQLITE_LEASE_LOCK_HOLD_RULES = [
  {
    ruleId: "BLR_LEASE_STREAM_MISSING",
    sql: `SELECT 1
            FROM temp.ge_blr_leases AS lease
            LEFT JOIN temp.ge_blr_streams AS stream
              ON stream.tenant_id = lease.tenant_id
             AND stream.stream_id = lease.stream_id
           WHERE stream.key_blob IS NULL
           LIMIT ?`,
  },
  {
    ruleId: "BLR_LEASE_HISTORY_INCOMPLETE",
    sql: `SELECT 1 FROM (
            SELECT lease.tenant_id, lease.stream_id
              FROM temp.ge_blr_leases AS lease
             WHERE NOT EXISTS (
               SELECT count(*)
                 FROM temp.ge_blr_used_leases AS used
                      INDEXED BY ge_blr_used_leases_epoch_uidx
                WHERE used.tenant_id = lease.tenant_id
                  AND used.stream_id = lease.stream_id
               HAVING count(*) IS lease.last_lease_epoch
                  AND coalesce(min(used.lease_epoch), 0) IS
                      CASE WHEN lease.last_lease_epoch = 0 THEN 0 ELSE 1 END
                  AND coalesce(max(used.lease_epoch), 0) IS lease.last_lease_epoch
                  AND coalesce(sum(CASE WHEN used.lease_epoch < 1
                                         OR used.fencing_token < 1
                                         OR used.lease_epoch IS NOT used.fencing_token
                                       THEN 1 ELSE 0 END), 0) = 0
             )
            UNION ALL
            SELECT used.tenant_id, used.stream_id
              FROM temp.ge_blr_used_leases AS used
                   INDEXED BY ge_blr_used_leases_epoch_uidx
              LEFT JOIN temp.ge_blr_leases AS lease
                ON lease.tenant_id = used.tenant_id
               AND lease.stream_id = used.stream_id
             WHERE lease.key_blob IS NULL
             GROUP BY used.tenant_id, used.stream_id
            UNION ALL
            SELECT used.tenant_id, used.stream_id
              FROM temp.ge_blr_used_leases AS used
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 7 AND common.key_blob = used.key_blob
             WHERE common.key_blob IS NULL
                OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId') IS NOT used.tenant_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.streamId') IS NOT used.stream_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.leaseId') IS NOT used.lease_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId') IS NOT used.tenant_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId') IS NOT used.stream_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.leaseId') IS NOT used.lease_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.leaseEpoch') IS NOT used.lease_epoch
                OR json_extract(CAST(common.state_blob AS TEXT), '$.fencingToken') IS NOT used.fencing_token
                OR json_extract(CAST(common.state_blob AS TEXT), '$.firstUsedAtMs') IS NOT used.first_used_at_ms
            UNION ALL
            SELECT json_extract(CAST(common.state_blob AS TEXT), '$.tenantId'),
                   json_extract(CAST(common.state_blob AS TEXT), '$.streamId')
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_used_leases AS used ON used.key_blob = common.key_blob
             WHERE common.kind_rank = 7 AND used.key_blob IS NULL
          ) AS violation_domains
           GROUP BY tenant_id, stream_id
           LIMIT ?`,
  },
  {
    ruleId: "BLR_LEASE_ACTIVE_BINDING",
    sql: `SELECT violation FROM (
            SELECT 1 AS violation
              FROM temp.ge_blr_leases AS lease
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 6 AND common.key_blob = lease.key_blob
             WHERE common.key_blob IS NULL
                OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId') IS NOT lease.tenant_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.streamId') IS NOT lease.stream_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId') IS NOT lease.tenant_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId') IS NOT lease.stream_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeLeaseId') IS NOT lease.active_lease_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeHolderId') IS NOT lease.active_holder_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeLeaseEpoch') IS NOT lease.active_lease_epoch
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeFencingToken') IS NOT lease.active_fencing_token
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeAcquiredAtMs') IS NOT lease.active_acquired_at_ms
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeExpiresAtMs') IS NOT lease.active_expires_at_ms
                OR json_extract(CAST(common.state_blob AS TEXT), '$.lastLeaseEpoch') IS NOT lease.last_lease_epoch
                OR json_extract(CAST(common.state_blob AS TEXT), '$.lastFencingToken') IS NOT lease.last_fencing_token
                OR json_extract(CAST(common.state_blob AS TEXT), '$.updatedAtMs') IS NOT lease.updated_at_ms
                OR lease.last_lease_epoch < 0
                OR lease.last_fencing_token < 0
                OR lease.last_lease_epoch IS NOT lease.last_fencing_token
                OR (lease.active_lease_id IS NULL AND (
                     lease.active_holder_id IS NOT NULL
                  OR lease.active_lease_epoch IS NOT NULL
                  OR lease.active_fencing_token IS NOT NULL
                  OR lease.active_acquired_at_ms IS NOT NULL
                  OR lease.active_expires_at_ms IS NOT NULL
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeLeaseId') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeHolderId') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeLeaseEpoch') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeFencingToken') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeAcquiredAtMs') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeExpiresAtMs') IS NOT 'null'
                ))
                OR (lease.active_lease_id IS NOT NULL AND (
                     lease.active_holder_id IS NULL
                  OR lease.active_lease_epoch IS NULL
                  OR lease.active_fencing_token IS NULL
                  OR lease.active_acquired_at_ms IS NULL
                  OR lease.active_expires_at_ms IS NULL
                  OR lease.active_lease_epoch < 1
                  OR lease.active_fencing_token < 1
                  OR lease.active_lease_epoch IS NOT lease.active_fencing_token
                  OR lease.active_lease_epoch IS NOT lease.last_lease_epoch
                  OR lease.active_fencing_token IS NOT lease.last_fencing_token
                  OR lease.active_expires_at_ms <= lease.active_acquired_at_ms
                  OR (EXISTS (
                       SELECT 1 FROM temp.ge_blr_used_leases AS terminal
                            INDEXED BY ge_blr_used_leases_epoch_uidx
                        WHERE terminal.tenant_id = lease.tenant_id
                          AND terminal.stream_id = lease.stream_id
                          AND terminal.lease_epoch = lease.last_lease_epoch
                          AND terminal.fencing_token = lease.last_fencing_token
                     ) AND NOT EXISTS (
                       SELECT 1 FROM temp.ge_blr_used_leases AS active
                        WHERE active.tenant_id = lease.tenant_id
                          AND active.stream_id = lease.stream_id
                          AND active.lease_id = lease.active_lease_id
                          AND active.lease_epoch = lease.active_lease_epoch
                          AND active.fencing_token = lease.active_fencing_token
                          AND active.first_used_at_ms = lease.active_acquired_at_ms
                     ))
                ))
            UNION ALL
            SELECT 1 AS violation
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_leases AS lease ON lease.key_blob = common.key_blob
             WHERE common.kind_rank = 6 AND lease.key_blob IS NULL
          ) LIMIT ?`,
  },
  {
    ruleId: "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE",
    sql: `SELECT 1
           WHERE (SELECT count(*) FROM temp.ge_blr_migration_lock) IS NOT 1
              OR EXISTS (
            SELECT 1
              FROM temp.ge_blr_migration_lock AS lock
             WHERE NOT EXISTS (
               SELECT count(*)
                 FROM temp.ge_blr_used_migration_locks AS used
                      INDEXED BY ge_blr_used_migration_locks_epoch_uidx
               HAVING count(*) IS lock.last_lock_epoch
                  AND coalesce(min(used.lock_epoch), 0) IS
                      CASE WHEN lock.last_lock_epoch = 0 THEN 0 ELSE 1 END
                  AND coalesce(max(used.lock_epoch), 0) IS lock.last_lock_epoch
                  AND coalesce(sum(CASE WHEN used.lock_epoch < 1
                                         OR used.fencing_token < 1
                                         OR used.lock_epoch IS NOT used.fencing_token
                                       THEN 1 ELSE 0 END), 0) = 0
             )
            UNION ALL
            SELECT 1
              FROM temp.ge_blr_used_migration_locks AS used
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 10 AND common.key_blob = used.key_blob
             WHERE common.key_blob IS NULL
                OR json_extract(CAST(common.key_blob AS TEXT), '$.lockId') IS NOT used.lock_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.lockId') IS NOT used.lock_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.lockEpoch') IS NOT used.lock_epoch
                OR json_extract(CAST(common.state_blob AS TEXT), '$.fencingToken') IS NOT used.fencing_token
                OR json_extract(CAST(common.state_blob AS TEXT), '$.firstUsedAtMs') IS NOT used.first_used_at_ms
            UNION ALL
            SELECT 1
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_used_migration_locks AS used
                ON used.key_blob = common.key_blob
             WHERE common.kind_rank = 10 AND used.key_blob IS NULL
           )
           LIMIT ?`,
  },
  {
    ruleId: "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
    sql: `SELECT 1
           WHERE (SELECT count(*) FROM temp.ge_blr_migration_lock) IS NOT 1
              OR EXISTS (
            SELECT 1
              FROM temp.ge_blr_migration_lock AS lock
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 9 AND common.key_blob = lock.key_blob
             WHERE common.key_blob IS NULL
                OR lock.singleton IS NOT 1
                OR json_extract(CAST(common.key_blob AS TEXT), '$.singleton') IS NOT lock.singleton
                OR json_extract(CAST(common.state_blob AS TEXT), '$.singleton') IS NOT lock.singleton
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeLockId') IS NOT lock.active_lock_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeOwnerId') IS NOT lock.active_owner_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeSourceVersion') IS NOT lock.active_source_version
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeTargetVersion') IS NOT lock.active_target_version
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeLockEpoch') IS NOT lock.active_lock_epoch
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeFencingToken') IS NOT lock.active_fencing_token
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeAcquiredAtMs') IS NOT lock.active_acquired_at_ms
                OR json_extract(CAST(common.state_blob AS TEXT), '$.activeExpiresAtMs') IS NOT lock.active_expires_at_ms
                OR json_extract(CAST(common.state_blob AS TEXT), '$.lastLockEpoch') IS NOT lock.last_lock_epoch
                OR json_extract(CAST(common.state_blob AS TEXT), '$.lastFencingToken') IS NOT lock.last_fencing_token
                OR json_extract(CAST(common.state_blob AS TEXT), '$.updatedAtMs') IS NOT lock.updated_at_ms
                OR lock.last_lock_epoch < 0
                OR lock.last_fencing_token < 0
                OR lock.last_lock_epoch IS NOT lock.last_fencing_token
                OR (lock.active_lock_id IS NULL AND (
                     lock.active_owner_id IS NOT NULL
                  OR lock.active_source_version IS NOT NULL
                  OR lock.active_target_version IS NOT NULL
                  OR lock.active_lock_epoch IS NOT NULL
                  OR lock.active_fencing_token IS NOT NULL
                  OR lock.active_acquired_at_ms IS NOT NULL
                  OR lock.active_expires_at_ms IS NOT NULL
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeLockId') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeOwnerId') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeSourceVersion') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeTargetVersion') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeLockEpoch') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeFencingToken') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeAcquiredAtMs') IS NOT 'null'
                  OR json_type(CAST(common.state_blob AS TEXT), '$.activeExpiresAtMs') IS NOT 'null'
                ))
                OR (lock.active_lock_id IS NOT NULL AND (
                     lock.active_owner_id IS NULL
                  OR lock.active_source_version IS NULL
                  OR lock.active_target_version IS NULL
                  OR lock.active_lock_epoch IS NULL
                  OR lock.active_fencing_token IS NULL
                  OR lock.active_acquired_at_ms IS NULL
                  OR lock.active_expires_at_ms IS NULL
                  OR lock.active_source_version < 1
                  OR lock.active_target_version < 2
                  OR lock.active_lock_epoch < 1
                  OR lock.active_fencing_token < 1
                  OR lock.active_target_version <= lock.active_source_version
                  OR lock.active_lock_epoch IS NOT lock.active_fencing_token
                  OR lock.active_lock_epoch IS NOT lock.last_lock_epoch
                  OR lock.active_fencing_token IS NOT lock.last_fencing_token
                  OR lock.active_expires_at_ms <= lock.active_acquired_at_ms
                  OR (EXISTS (
                       SELECT 1 FROM temp.ge_blr_used_migration_locks AS terminal
                            INDEXED BY ge_blr_used_migration_locks_epoch_uidx
                        WHERE terminal.lock_epoch = lock.last_lock_epoch
                          AND terminal.fencing_token = lock.last_fencing_token
                     ) AND NOT EXISTS (
                       SELECT 1 FROM temp.ge_blr_used_migration_locks AS active
                        WHERE active.lock_id = lock.active_lock_id
                          AND active.lock_epoch = lock.active_lock_epoch
                          AND active.fencing_token = lock.active_fencing_token
                          AND active.first_used_at_ms = lock.active_acquired_at_ms
                     ))
                ))
            UNION ALL
            SELECT 1
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_migration_lock AS lock ON lock.key_blob = common.key_blob
             WHERE common.kind_rank = 9 AND lock.key_blob IS NULL
          ) LIMIT ?`,
  },
  {
    ruleId: "BLR_HOLD_STREAM_MISSING",
    sql: `SELECT violation FROM (
            SELECT 1 AS violation
              FROM temp.ge_blr_holds AS hold
              LEFT JOIN temp.ge_blr_streams AS stream
                ON stream.tenant_id = hold.tenant_id
               AND stream.stream_id = hold.stream_id
              LEFT JOIN temp.ge_blr_stage AS common
                ON common.kind_rank = 8 AND common.key_blob = hold.key_blob
             WHERE stream.key_blob IS NULL
                OR common.key_blob IS NULL
                OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId') IS NOT hold.tenant_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.streamId') IS NOT hold.stream_id
                OR json_extract(CAST(common.key_blob AS TEXT), '$.holdId') IS NOT hold.hold_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId') IS NOT hold.tenant_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId') IS NOT hold.stream_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.holdId') IS NOT hold.hold_id
                OR json_extract(CAST(common.state_blob AS TEXT), '$.placedAtMs') IS NOT hold.placed_at_ms
            UNION ALL
            SELECT 1 AS violation
              FROM temp.ge_blr_stage AS common
              LEFT JOIN temp.ge_blr_holds AS hold ON hold.key_blob = common.key_blob
             WHERE common.kind_rank = 8 AND hold.key_blob IS NULL
          ) LIMIT ?`,
  },
] as const;

export const SQLITE_LEASE_LOCK_HOLD_RULES = Object.freeze(
  RAW_SQLITE_LEASE_LOCK_HOLD_RULES.map((rule) => Object.freeze(rule)),
);

export type SQLiteLeaseLockHoldRuleId =
  typeof SQLITE_LEASE_LOCK_HOLD_RULES[number]["ruleId"];

export interface SQLiteLeaseLockHoldDiagnostic {
  readonly ruleId: SQLiteLeaseLockHoldRuleId;
  readonly violationCount: number;
  readonly diagnosticsTruncated: boolean;
}

export interface SQLiteLeaseLockHoldCampaignReport {
  readonly projectionIdentity: OperationBaselineProjectionIdentity;
  readonly diagnostics: readonly SQLiteLeaseLockHoldDiagnostic[];
}

export interface SQLiteLeaseLockHoldCampaignOptions {
  readonly diagnosticLimit?: number;
}

function corruption(message: string): CycleStoreProviderError {
  return new CycleStoreProviderError("GE_CYCLE_STORE_CORRUPTION", OPERATION, message);
}

function diagnosticLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT;
  let ownKeys: readonly PropertyKey[];
  let prototype: object | null;
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError();
    ownKeys = Reflect.ownKeys(value);
    prototype = Object.getPrototypeOf(value);
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline lease/lock/hold campaign options are invalid",
    );
  }
  if (prototype !== Object.prototype
      || ownKeys.some((key) => key !== "diagnosticLimit")
      || ownKeys.length > 1) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline lease/lock/hold campaign options are invalid",
    );
  }
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, "diagnosticLimit");
  } catch {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline lease/lock/hold campaign options are invalid",
    );
  }
  if (descriptor !== undefined && !("value" in descriptor)) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline lease/lock/hold campaign options are invalid",
    );
  }
  const checked = descriptor === undefined
    ? DEFAULT_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT
    : descriptor.value;
  if (!Number.isSafeInteger(checked)
      || (checked as number) < 1
      || (checked as number) > MAX_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT) {
    throw new CycleStoreProviderError(
      "GE_CYCLE_STORE_INVALID_ARGUMENT", OPERATION,
      "SQLite baseline lease/lock/hold diagnostic limit is outside bounds",
    );
  }
  return checked as number;
}

/** Package-private one-shot executor for the frozen lease/lock/hold family. */
export class SQLiteLeaseLockHoldInvariantCampaign {
  readonly #connection: SQLiteConnection;
  readonly #projectionIdentity: OperationBaselineProjectionIdentity;
  readonly #stage: SQLiteBaselineTempStage & SQLiteBaselineLeaseLockHoldCampaignStage;
  readonly #session: object;
  readonly #limit: number;
  #state: "open" | "complete" | "poisoned" = "open";

  constructor(
    connection: SQLiteConnection,
    projectionIdentity: OperationBaselineProjectionIdentity,
    stage: SQLiteBaselineTempStage,
    options: SQLiteLeaseLockHoldCampaignOptions = {},
  ) {
    this.#connection = connection;
    this.#projectionIdentity = projectionIdentity;
    this.#stage = stage as SQLiteBaselineTempStage & SQLiteBaselineLeaseLockHoldCampaignStage;
    this.#limit = diagnosticLimit(options);
    this.#session = this.#stage[SQLITE_BASELINE_BEGIN_LEASE_LOCK_HOLD_CAMPAIGN](
      connection, projectionIdentity,
    );
  }

  get state(): "open" | "complete" | "poisoned" {
    if (this.#state === "open" && this.#stage.state !== "open") this.#state = "poisoned";
    return this.#state;
  }

  run(): SQLiteLeaseLockHoldCampaignReport {
    if (this.#state !== "open") {
      return this.#stage[SQLITE_BASELINE_ABORT_LEASE_LOCK_HOLD_CAMPAIGN](
        undefined, "SQLite baseline lease/lock/hold campaign is one-shot",
      );
    }
    const diagnostics: SQLiteLeaseLockHoldDiagnostic[] = [];
    let activeFinalizer: (() => void) | undefined;
    let primaryFailure: unknown;
    try {
      for (const rule of SQLITE_LEASE_LOCK_HOLD_RULES) {
        this.#stage[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](this.#session);
        const iterator = this.#connection.prepare(rule.sql, OPERATION)
          .iterate(this.#limit + 1)[Symbol.iterator]();
        let finalized = false;
        const finalize = (): void => {
          if (finalized) return;
          finalized = true;
          iterator.return?.();
        };
        activeFinalizer = finalize;
        this.#stage[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](this.#session);
        this.#stage[SQLITE_BASELINE_REGISTER_LEASE_LOCK_HOLD_CLEANUP](
          this.#session, finalize,
        );
        let observed = 0;
        while (observed <= this.#limit) {
          this.#stage[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](this.#session);
          const next = iterator.next();
          this.#stage[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](this.#session);
          if (next.done) break;
          const row = sqliteRow(next.value, 1, OPERATION, "lease/lock/hold witness row");
          sqliteSafeInteger(row[0], 1, 1, OPERATION, "lease/lock/hold witness marker");
          observed += 1;
        }
        finalize();
        activeFinalizer = undefined;
        this.#stage[SQLITE_BASELINE_REGISTER_LEASE_LOCK_HOLD_CLEANUP](
          this.#session, undefined,
        );
        this.#stage[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](this.#session);
        if (observed > 0) {
          diagnostics.push(Object.freeze({
            ruleId: rule.ruleId,
            violationCount: Math.min(observed, this.#limit),
            diagnosticsTruncated: observed > this.#limit,
          }));
        }
        this.#stage[SQLITE_BASELINE_FENCE_LEASE_LOCK_HOLD_CAMPAIGN](this.#session);
      }
      this.#stage[SQLITE_BASELINE_COMPLETE_LEASE_LOCK_HOLD_CAMPAIGN](this.#session);
      this.#state = "complete";
      return Object.freeze({
        projectionIdentity: this.#projectionIdentity,
        diagnostics: Object.freeze(diagnostics),
      });
    } catch (error) {
      primaryFailure = error instanceof CycleStoreProviderError
        ? error
        : corruption("SQLite baseline lease/lock/hold campaign failed");
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
          this.#stage[SQLITE_BASELINE_ABORT_LEASE_LOCK_HOLD_CAMPAIGN](
            this.#session, "SQLite baseline lease/lock/hold campaign failed",
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
    this.#stage[SQLITE_BASELINE_ABORT_LEASE_LOCK_HOLD_CAMPAIGN](
      this.#session, "SQLite baseline lease/lock/hold campaign was abandoned",
    );
  }
}

export function runSQLiteLeaseLockHoldInvariantCampaign(
  connection: SQLiteConnection,
  projectionIdentity: OperationBaselineProjectionIdentity,
  stage: SQLiteBaselineTempStage,
  options: SQLiteLeaseLockHoldCampaignOptions = {},
): SQLiteLeaseLockHoldCampaignReport {
  return new SQLiteLeaseLockHoldInvariantCampaign(
    connection, projectionIdentity, stage, options,
  ).run();
}
