"""Private read-only lease, migration-lock and legal-hold invariant campaign."""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from typing import Literal

from .sqlite_operation_baseline import BaselineProjectionIdentity
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineSourceSummary,
    _SQLiteCursorCapability,
)
from .sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from .sqlite_operation_baseline_stream_record_invariants import _diagnostic_limit

DEFAULT_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT = 16
MAX_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT = 64

SQLiteLeaseLockHoldRuleId = Literal[
    "BLR_LEASE_STREAM_MISSING",
    "BLR_LEASE_HISTORY_INCOMPLETE",
    "BLR_LEASE_ACTIVE_BINDING",
    "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE",
    "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
    "BLR_HOLD_STREAM_MISSING",
]


@dataclass(frozen=True, slots=True)
class SQLiteLeaseLockHoldReconciliationDiagnostic:
    rule_id: SQLiteLeaseLockHoldRuleId
    violation_count: int
    diagnostics_truncated: bool


@dataclass(frozen=True, slots=True)
class SQLiteLeaseLockHoldCampaignReport:
    projection_identity: BaselineProjectionIdentity
    diagnostics: tuple[SQLiteLeaseLockHoldReconciliationDiagnostic, ...]


@dataclass(frozen=True, slots=True)
class _SQLiteLeaseLockHoldRule:
    rule_id: SQLiteLeaseLockHoldRuleId
    sql: str
    required_indexes: tuple[str, ...]


SQLITE_LEASE_LOCK_HOLD_RULES: tuple[_SQLiteLeaseLockHoldRule, ...] = (
    _SQLiteLeaseLockHoldRule(
        "BLR_LEASE_STREAM_MISSING",
        """SELECT 1
             FROM temp.ge_blr_leases AS lease
             LEFT JOIN temp.ge_blr_streams AS stream
               ON stream.tenant_id = lease.tenant_id
              AND stream.stream_id = lease.stream_id
            WHERE stream.key_blob IS NULL
            LIMIT ?""",
        (),
    ),
    _SQLiteLeaseLockHoldRule(
        "BLR_LEASE_HISTORY_INCOMPLETE",
        """SELECT 1 FROM (
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
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId')
                    IS NOT used.tenant_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.streamId')
                    IS NOT used.stream_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.leaseId')
                    IS NOT used.lease_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId')
                    IS NOT used.tenant_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId')
                    IS NOT used.stream_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.leaseId')
                    IS NOT used.lease_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.leaseEpoch')
                    IS NOT used.lease_epoch
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.fencingToken')
                    IS NOT used.fencing_token
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.firstUsedAtMs')
                    IS NOT used.first_used_at_ms
             UNION ALL
             SELECT json_extract(CAST(common.state_blob AS TEXT), '$.tenantId'),
                    json_extract(CAST(common.state_blob AS TEXT), '$.streamId')
               FROM temp.ge_blr_stage AS common
               LEFT JOIN temp.ge_blr_used_leases AS used
                 ON used.key_blob = common.key_blob
              WHERE common.kind_rank = 7 AND used.key_blob IS NULL
           ) AS violation_domains
            GROUP BY tenant_id, stream_id
            LIMIT ?""",
        ("ge_blr_used_leases_epoch_uidx",),
    ),
    _SQLiteLeaseLockHoldRule(
        "BLR_LEASE_ACTIVE_BINDING",
        """SELECT violation FROM (
             SELECT 1 AS violation
               FROM temp.ge_blr_leases AS lease
              LEFT JOIN temp.ge_blr_stage AS common
                 ON common.kind_rank = 6 AND common.key_blob = lease.key_blob
              WHERE common.key_blob IS NULL
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId')
                    IS NOT lease.tenant_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.streamId')
                    IS NOT lease.stream_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId')
                    IS NOT lease.tenant_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId')
                    IS NOT lease.stream_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeLeaseId')
                    IS NOT lease.active_lease_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeHolderId')
                    IS NOT lease.active_holder_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeLeaseEpoch')
                    IS NOT lease.active_lease_epoch
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeFencingToken')
                    IS NOT lease.active_fencing_token
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeAcquiredAtMs')
                    IS NOT lease.active_acquired_at_ms
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeExpiresAtMs')
                    IS NOT lease.active_expires_at_ms
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.lastLeaseEpoch')
                    IS NOT lease.last_lease_epoch
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.lastFencingToken')
                    IS NOT lease.last_fencing_token
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.updatedAtMs')
                    IS NOT lease.updated_at_ms
                 OR lease.last_lease_epoch < 0
                 OR lease.last_fencing_token < 0
                 OR lease.last_lease_epoch IS NOT lease.last_fencing_token
                 OR (lease.active_lease_id IS NULL AND (
                      lease.active_holder_id IS NOT NULL
                   OR lease.active_lease_epoch IS NOT NULL
                   OR lease.active_fencing_token IS NOT NULL
                   OR lease.active_acquired_at_ms IS NOT NULL
                   OR lease.active_expires_at_ms IS NOT NULL
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeLeaseId')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeHolderId')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeLeaseEpoch')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeFencingToken')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeAcquiredAtMs')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeExpiresAtMs')
                      IS NOT 'null'
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
               LEFT JOIN temp.ge_blr_leases AS lease
                 ON lease.key_blob = common.key_blob
              WHERE common.kind_rank = 6 AND lease.key_blob IS NULL
           ) LIMIT ?""",
        ("ge_blr_used_leases_epoch_uidx",),
    ),
    _SQLiteLeaseLockHoldRule(
        "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE",
        """SELECT 1
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
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.lockId')
                    IS NOT used.lock_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.lockId')
                    IS NOT used.lock_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.lockEpoch')
                    IS NOT used.lock_epoch
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.fencingToken')
                    IS NOT used.fencing_token
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.firstUsedAtMs')
                    IS NOT used.first_used_at_ms
             UNION ALL
             SELECT 1
               FROM temp.ge_blr_stage AS common
               LEFT JOIN temp.ge_blr_used_migration_locks AS used
                 ON used.key_blob = common.key_blob
              WHERE common.kind_rank = 10 AND used.key_blob IS NULL
           )
            LIMIT ?""",
        ("ge_blr_used_migration_locks_epoch_uidx",),
    ),
    _SQLiteLeaseLockHoldRule(
        "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
        """SELECT 1
            WHERE (SELECT count(*) FROM temp.ge_blr_migration_lock) IS NOT 1
               OR EXISTS (
             SELECT 1
               FROM temp.ge_blr_migration_lock AS lock
              LEFT JOIN temp.ge_blr_stage AS common
                 ON common.kind_rank = 9 AND common.key_blob = lock.key_blob
              WHERE common.key_blob IS NULL
                 OR lock.singleton IS NOT 1
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.singleton')
                    IS NOT lock.singleton
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.singleton')
                    IS NOT lock.singleton
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeLockId')
                    IS NOT lock.active_lock_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeOwnerId')
                    IS NOT lock.active_owner_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeSourceVersion')
                    IS NOT lock.active_source_version
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeTargetVersion')
                    IS NOT lock.active_target_version
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeLockEpoch')
                    IS NOT lock.active_lock_epoch
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeFencingToken')
                    IS NOT lock.active_fencing_token
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeAcquiredAtMs')
                    IS NOT lock.active_acquired_at_ms
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.activeExpiresAtMs')
                    IS NOT lock.active_expires_at_ms
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.lastLockEpoch')
                    IS NOT lock.last_lock_epoch
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.lastFencingToken')
                    IS NOT lock.last_fencing_token
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.updatedAtMs')
                    IS NOT lock.updated_at_ms
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
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeLockId')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeOwnerId')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeSourceVersion')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeTargetVersion')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeLockEpoch')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeFencingToken')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeAcquiredAtMs')
                      IS NOT 'null'
                   OR json_type(CAST(common.state_blob AS TEXT), '$.activeExpiresAtMs')
                      IS NOT 'null'
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
                        SELECT 1
                          FROM temp.ge_blr_used_migration_locks AS terminal
                               INDEXED BY ge_blr_used_migration_locks_epoch_uidx
                         WHERE terminal.lock_epoch = lock.last_lock_epoch
                           AND terminal.fencing_token = lock.last_fencing_token
                      ) AND NOT EXISTS (
                        SELECT 1
                          FROM temp.ge_blr_used_migration_locks AS active
                         WHERE active.lock_id = lock.active_lock_id
                           AND active.lock_epoch = lock.active_lock_epoch
                           AND active.fencing_token = lock.active_fencing_token
                           AND active.first_used_at_ms = lock.active_acquired_at_ms
                      ))
                 ))
             UNION ALL
             SELECT 1
               FROM temp.ge_blr_stage AS common
               LEFT JOIN temp.ge_blr_migration_lock AS lock
                 ON lock.key_blob = common.key_blob
              WHERE common.kind_rank = 9 AND lock.key_blob IS NULL
           )
            LIMIT ?""",
        ("ge_blr_used_migration_locks_epoch_uidx",),
    ),
    _SQLiteLeaseLockHoldRule(
        "BLR_HOLD_STREAM_MISSING",
        """SELECT violation FROM (
             SELECT 1 AS violation
               FROM temp.ge_blr_holds AS hold
               LEFT JOIN temp.ge_blr_streams AS stream
                 ON stream.tenant_id = hold.tenant_id
                AND stream.stream_id = hold.stream_id
               LEFT JOIN temp.ge_blr_stage AS common
                 ON common.kind_rank = 8 AND common.key_blob = hold.key_blob
              WHERE stream.key_blob IS NULL
                 OR common.key_blob IS NULL
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId')
                    IS NOT hold.tenant_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.streamId')
                    IS NOT hold.stream_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.holdId')
                    IS NOT hold.hold_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId')
                    IS NOT hold.tenant_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId')
                    IS NOT hold.stream_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.holdId')
                    IS NOT hold.hold_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.placedAtMs')
                    IS NOT hold.placed_at_ms
             UNION ALL
             SELECT 1 AS violation
               FROM temp.ge_blr_stage AS common
               LEFT JOIN temp.ge_blr_holds AS hold ON hold.key_blob = common.key_blob
              WHERE common.kind_rank = 8 AND hold.key_blob IS NULL
           ) LIMIT ?""",
        (),
    ),
)


class SQLiteV1LeaseLockHoldInvariantCampaign:
    __slots__ = (
        "_diagnostic_limit",
        "_expected_total_changes",
        "_identity",
        "_session",
        "_stage",
        "_state",
        "_summary",
    )

    def __init__(
        self,
        summary: SQLiteV1BaselineSourceSummary,
        identity: BaselineProjectionIdentity,
        stage: SQLiteV1BaselineTempStage,
        *,
        diagnostic_limit: object = DEFAULT_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT,
    ) -> None:
        self._diagnostic_limit = _diagnostic_limit(diagnostic_limit)
        if type(summary) is not SQLiteV1BaselineSourceSummary:
            raise TypeError("lease/lock/hold campaign source summary has the wrong type")
        if type(identity) is not BaselineProjectionIdentity:
            raise TypeError("lease/lock/hold campaign projection identity has the wrong type")
        if type(stage) is not SQLiteV1BaselineTempStage:
            raise TypeError("lease/lock/hold campaign TEMP stage has the wrong type")
        self._summary = summary
        self._identity = identity
        self._stage = stage
        self._state: Literal["open", "complete", "poisoned"] = "open"
        (
            self._expected_total_changes,
            self._session,
        ) = stage._begin_lease_lock_hold_campaign(summary, identity)

    @property
    def state(self) -> Literal["open", "complete", "poisoned"]:
        if self._state == "open" and self._stage.state != "open":
            self._state = "poisoned"
        return self._state

    def run(self) -> SQLiteLeaseLockHoldCampaignReport:
        if self._state != "open":
            self._stage._abort_lease_lock_hold_campaign(self._session)
        diagnostics: list[SQLiteLeaseLockHoldReconciliationDiagnostic] = []
        try:
            for rule in SQLITE_LEASE_LOCK_HOLD_RULES:
                observed = self._run_rule(rule)
                if observed:
                    diagnostics.append(
                        SQLiteLeaseLockHoldReconciliationDiagnostic(
                            rule.rule_id,
                            min(observed, self._diagnostic_limit),
                            observed > self._diagnostic_limit,
                        )
                    )
                self._stage._assert_lease_lock_hold_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
            self._stage._complete_lease_lock_hold_campaign(
                self._identity,
                self._expected_total_changes,
                self._session,
            )
            self._state = "complete"
            return SQLiteLeaseLockHoldCampaignReport(self._identity, tuple(diagnostics))
        except BaseException:
            self._state = "poisoned"
            with suppress(BaseException):
                self._stage._abort_lease_lock_hold_campaign(self._session)
            raise

    def dispose(self) -> None:
        if self._state != "open":
            return
        self._state = "poisoned"
        self._stage._abort_lease_lock_hold_campaign(self._session)

    def _run_rule(self, rule: _SQLiteLeaseLockHoldRule) -> int:
        cursor: _SQLiteCursorCapability | None = None
        registered = False
        primary: BaseException | None = None
        observed = 0
        try:
            self._stage._assert_lease_lock_hold_campaign_fence(
                self._session,
                self._expected_total_changes,
            )
            cursor = self._summary._connection.execute(
                rule.sql,
                (self._diagnostic_limit + 1,),
            )
            self._stage._assert_lease_lock_hold_campaign_fence(
                self._session,
                self._expected_total_changes,
            )
            self._stage._register_lease_lock_hold_campaign_cursor(
                self._session,
                cursor,
                self._expected_total_changes,
            )
            registered = True
            while observed <= self._diagnostic_limit:
                self._stage._assert_lease_lock_hold_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
                row = cursor.fetchone()
                self._stage._assert_lease_lock_hold_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
                if row is None:
                    break
                if len(row) != 1 or type(row[0]) is not int or row[0] != 1:
                    self._stage._poison(
                        f"{rule.rule_id}: lease/lock/hold witness row is invalid"
                    )
                observed += 1
        except BaseException as error:
            primary = error
        if cursor is not None:
            try:
                if primary is None:
                    self._stage._assert_lease_lock_hold_campaign_fence(
                        self._session,
                        self._expected_total_changes,
                    )
                cursor.close()
            except BaseException as error:
                if primary is None:
                    primary = error
            if registered and primary is None:
                try:
                    self._stage._release_lease_lock_hold_campaign_cursor(
                        self._session,
                        cursor,
                        self._expected_total_changes,
                    )
                except BaseException as error:
                    primary = error
        if primary is not None:
            if isinstance(primary, ValueError) and str(primary).startswith("BLR_"):
                raise primary
            self._stage._poison(
                f"{rule.rule_id}: lease/lock/hold rule execution failed"
            )
        return observed


def run_sqlite_v1_lease_lock_hold_invariant_campaign(
    summary: SQLiteV1BaselineSourceSummary,
    identity: BaselineProjectionIdentity,
    stage: SQLiteV1BaselineTempStage,
    *,
    diagnostic_limit: object = DEFAULT_SQLITE_LEASE_LOCK_HOLD_DIAGNOSTIC_LIMIT,
) -> SQLiteLeaseLockHoldCampaignReport:
    return SQLiteV1LeaseLockHoldInvariantCampaign(
        summary,
        identity,
        stage,
        diagnostic_limit=diagnostic_limit,
    ).run()
