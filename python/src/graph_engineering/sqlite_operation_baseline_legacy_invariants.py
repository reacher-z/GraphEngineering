"""Private read-only recoverable-binding campaign for legacy operations."""

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

DEFAULT_SQLITE_LEGACY_DIAGNOSTIC_LIMIT = 16
MAX_SQLITE_LEGACY_DIAGNOSTIC_LIMIT = 64

SQLiteLegacyRuleId = Literal[
    "BLR_LEGACY_INVENTORY",
    "BLR_LEGACY_APPEND_BINDING",
    "BLR_LEGACY_CHECKPOINT_BINDING",
    "BLR_LEGACY_LEASE_BINDING",
    "BLR_LEGACY_LOCK_BINDING",
]


@dataclass(frozen=True, slots=True)
class SQLiteLegacyReconciliationDiagnostic:
    rule_id: SQLiteLegacyRuleId
    violation_count: int
    diagnostics_truncated: bool


@dataclass(frozen=True, slots=True)
class SQLiteLegacyCampaignReport:
    projection_identity: BaselineProjectionIdentity
    diagnostics: tuple[SQLiteLegacyReconciliationDiagnostic, ...]


@dataclass(frozen=True, slots=True)
class _SQLiteLegacyRule:
    rule_id: SQLiteLegacyRuleId
    sql: str
    required_indexes: tuple[str, ...]


SQLITE_LEGACY_RULES: tuple[_SQLiteLegacyRule, ...] = (
    _SQLiteLegacyRule(
        "BLR_LEGACY_INVENTORY",
        """SELECT 1 FROM (
             SELECT legacy.tenant_id, legacy.operation_id
               FROM temp.ge_blr_legacy_operations AS legacy
               LEFT JOIN temp.ge_blr_stage AS common
                 ON common.kind_rank = 11 AND common.key_blob = legacy.key_blob
               LEFT JOIN main.ge_cycle_operations AS source
                 ON source.tenant_id = legacy.tenant_id
                AND source.operation_id = legacy.operation_id
              WHERE common.key_blob IS NULL
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId')
                    IS NOT legacy.tenant_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.operationId')
                    IS NOT legacy.operation_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId')
                    IS NOT legacy.tenant_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.operationId')
                    IS NOT legacy.operation_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.operationName')
                    IS NOT legacy.operation_name
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.requestHash')
                    IS NOT legacy.request_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.resultHash')
                    IS NOT legacy.result_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.resultBlobSha256')
                    IS NOT legacy.result_blob_sha256
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.committedAtMs')
                    IS NOT legacy.committed_at_ms
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
              WHERE source.operation_name IN ( 'append', 'save-checkpoint', 'delete-checkpoint',
                    'acquire-lease', 'renew-lease', 'release-lease',
                    'set-legal-hold', 'acquire-migration-lock',
                    'release-migration-lock')
                AND legacy.key_blob IS NULL
                AND NOT EXISTS (
                  SELECT 1
                    FROM temp.ge_blr_stage AS common
                   WHERE common.kind_rank = 11
                     AND json_extract(CAST(common.key_blob AS TEXT), '$.tenantId')
                         = source.tenant_id
                     AND json_extract(CAST(common.key_blob AS TEXT), '$.operationId')
                         = source.operation_id
                )
           ) AS violation_units LIMIT ?""",
        (),
    ),
    _SQLiteLegacyRule(
        "BLR_LEGACY_APPEND_BINDING",
        """SELECT 1
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
            LIMIT ?""",
        (
            "ge_blr_records_tenant_hash_uidx",
            "ge_blr_records_stream_sequence_uidx",
        ),
    ),
    _SQLiteLegacyRule(
        "BLR_LEGACY_CHECKPOINT_BINDING",
        """SELECT 1
             FROM temp.ge_blr_legacy_operations AS legacy
            WHERE (legacy.operation_name = 'save-checkpoint'
              AND NOT EXISTS (
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
            LIMIT ?""",
        ("ge_blr_checkpoint_revisions_latest_idx",),
    ),
    _SQLiteLegacyRule(
        "BLR_LEGACY_LEASE_BINDING",
        """SELECT 1
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
               OR (legacy.operation_name = 'release-lease'
              AND NOT EXISTS (
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
            LIMIT ?""",
        ("ge_blr_used_leases_epoch_uidx",),
    ),
    _SQLiteLegacyRule(
        "BLR_LEGACY_LOCK_BINDING",
        """SELECT 1
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
            LIMIT ?""",
        (),
    ),
)


def _legacy_diagnostic_limit(value: object) -> int:
    if type(value) is not int or value < 1 or value > MAX_SQLITE_LEGACY_DIAGNOSTIC_LIMIT:
        raise ValueError("SQLite baseline legacy diagnostic limit is outside bounds")
    return value


class SQLiteV1LegacyInvariantCampaign:
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
        diagnostic_limit: object = DEFAULT_SQLITE_LEGACY_DIAGNOSTIC_LIMIT,
    ) -> None:
        self._diagnostic_limit = _legacy_diagnostic_limit(diagnostic_limit)
        if type(summary) is not SQLiteV1BaselineSourceSummary:
            raise TypeError("legacy campaign source summary has the wrong type")
        if type(identity) is not BaselineProjectionIdentity:
            raise TypeError("legacy campaign projection identity has the wrong type")
        if type(stage) is not SQLiteV1BaselineTempStage:
            raise TypeError("legacy campaign TEMP stage has the wrong type")
        self._summary = summary
        self._identity = identity
        self._stage = stage
        self._state: Literal["open", "complete", "poisoned"] = "open"
        self._expected_total_changes, self._session = stage._begin_legacy_campaign(
            summary, identity
        )

    @property
    def state(self) -> Literal["open", "complete", "poisoned"]:
        if self._state == "open" and self._stage.state != "open":
            self._state = "poisoned"
        return self._state

    def run(self) -> SQLiteLegacyCampaignReport:
        if self._state != "open":
            self._stage._abort_legacy_campaign(self._session)
        diagnostics: list[SQLiteLegacyReconciliationDiagnostic] = []
        try:
            for rule in SQLITE_LEGACY_RULES:
                observed = self._run_rule(rule)
                if observed:
                    diagnostics.append(
                        SQLiteLegacyReconciliationDiagnostic(
                            rule.rule_id,
                            min(observed, self._diagnostic_limit),
                            observed > self._diagnostic_limit,
                        )
                    )
                self._stage._assert_legacy_campaign_fence(
                    self._session, self._expected_total_changes
                )
            self._stage._complete_legacy_campaign(
                self._identity, self._expected_total_changes, self._session
            )
            self._state = "complete"
            return SQLiteLegacyCampaignReport(self._identity, tuple(diagnostics))
        except BaseException:
            self._state = "poisoned"
            with suppress(BaseException):
                self._stage._abort_legacy_campaign(self._session)
            raise

    def dispose(self) -> None:
        if self._state != "open":
            return
        self._state = "poisoned"
        self._stage._abort_legacy_campaign(self._session)

    def _run_rule(self, rule: _SQLiteLegacyRule) -> int:
        cursor: _SQLiteCursorCapability | None = None
        registered = False
        primary: BaseException | None = None
        observed = 0
        try:
            self._stage._assert_legacy_campaign_fence(self._session, self._expected_total_changes)
            cursor = self._summary._connection.execute(rule.sql, (self._diagnostic_limit + 1,))
            self._stage._assert_legacy_campaign_fence(self._session, self._expected_total_changes)
            self._stage._register_legacy_campaign_cursor(
                self._session, cursor, self._expected_total_changes
            )
            registered = True
            while observed <= self._diagnostic_limit:
                self._stage._assert_legacy_campaign_fence(
                    self._session, self._expected_total_changes
                )
                row = cursor.fetchone()
                self._stage._assert_legacy_campaign_fence(
                    self._session, self._expected_total_changes
                )
                if row is None:
                    break
                if len(row) != 1 or type(row[0]) is not int or row[0] != 1:
                    self._stage._poison(f"{rule.rule_id}: legacy witness row is invalid")
                observed += 1
        except BaseException as error:
            primary = error
        if cursor is not None:
            if registered and self._stage._legacy_campaign_cursor is cursor:
                try:
                    self._stage._finalize_legacy_campaign_cursor(
                        self._session,
                        cursor,
                        self._expected_total_changes,
                        preserve_primary=primary is not None,
                    )
                except BaseException as error:
                    if primary is None:
                        primary = error
            elif not registered:
                try:
                    cursor.close()
                except BaseException as error:
                    if primary is None:
                        primary = error
        if primary is not None:
            if isinstance(primary, ValueError) and str(primary).startswith("BLR_"):
                raise primary
            self._stage._poison(f"{rule.rule_id}: legacy rule execution failed")
        return observed


def run_sqlite_v1_legacy_invariant_campaign(
    summary: SQLiteV1BaselineSourceSummary,
    identity: BaselineProjectionIdentity,
    stage: SQLiteV1BaselineTempStage,
    *,
    diagnostic_limit: object = DEFAULT_SQLITE_LEGACY_DIAGNOSTIC_LIMIT,
) -> SQLiteLegacyCampaignReport:
    return SQLiteV1LegacyInvariantCampaign(
        summary,
        identity,
        stage,
        diagnostic_limit=diagnostic_limit,
    ).run()
