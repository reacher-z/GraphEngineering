"""Private read-only checkpoint invariant campaign over verified TEMP relations."""

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
from .sqlite_operation_baseline_stream_record_invariants import (
    DEFAULT_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT,
    _diagnostic_limit,
)

SQLiteCheckpointRuleId = Literal[
    "BLR_CHECKPOINT_REVISION_GAP",
    "BLR_CHECKPOINT_RECORD_MISSING",
    "BLR_CHECKPOINT_CURRENT_MISSING",
    "BLR_CHECKPOINT_CURRENT_UNEXPECTED",
    "BLR_CHECKPOINT_CURRENT_STALE",
    "BLR_CHECKPOINT_CURRENT_BINDING",
]


@dataclass(frozen=True, slots=True)
class SQLiteCheckpointReconciliationDiagnostic:
    rule_id: SQLiteCheckpointRuleId
    violation_count: int
    diagnostics_truncated: bool


@dataclass(frozen=True, slots=True)
class SQLiteCheckpointCampaignReport:
    projection_identity: BaselineProjectionIdentity
    diagnostics: tuple[SQLiteCheckpointReconciliationDiagnostic, ...]


@dataclass(frozen=True, slots=True)
class _SQLiteCheckpointRule:
    rule_id: SQLiteCheckpointRuleId
    sql: str
    required_indexes: tuple[str, ...]
    grouped_scan: bool = False


SQLITE_CHECKPOINT_RULES: tuple[_SQLiteCheckpointRule, ...] = (
    _SQLiteCheckpointRule(
        "BLR_CHECKPOINT_REVISION_GAP",
        """SELECT 1
             FROM temp.ge_blr_checkpoint_revisions
                  INDEXED BY ge_blr_checkpoint_revisions_latest_idx
            GROUP BY tenant_id, checkpoint_scope
           HAVING min(revision) <> 1 OR count(*) <> max(revision)
            LIMIT ?""",
        ("ge_blr_checkpoint_revisions_latest_idx",),
        True,
    ),
    _SQLiteCheckpointRule(
        "BLR_CHECKPOINT_RECORD_MISSING",
        """SELECT violation FROM (
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
           ) LIMIT ?""",
        (
            "ge_blr_checkpoint_current_record_idx",
            "ge_blr_checkpoint_revisions_record_idx",
            "ge_blr_records_stream_position_idx",
        ),
    ),
    _SQLiteCheckpointRule(
        "BLR_CHECKPOINT_CURRENT_MISSING",
        """SELECT 1
             FROM temp.ge_blr_checkpoint_revisions AS latest
                  INDEXED BY ge_blr_checkpoint_revisions_latest_idx
             LEFT JOIN temp.ge_blr_checkpoint_current AS current
               ON current.tenant_id = latest.tenant_id
              AND current.checkpoint_scope = latest.checkpoint_scope
              AND current.checkpoint_id = latest.checkpoint_id
            WHERE latest.action = 'put'
              AND NOT EXISTS (
                SELECT 1
                  FROM temp.ge_blr_checkpoint_revisions AS later
                       INDEXED BY ge_blr_checkpoint_revisions_latest_idx
                 WHERE later.tenant_id = latest.tenant_id
                   AND later.checkpoint_scope = latest.checkpoint_scope
                   AND later.checkpoint_id = latest.checkpoint_id
                   AND later.revision > latest.revision
              )
              AND current.key_blob IS NULL
            LIMIT ?""",
        ("ge_blr_checkpoint_revisions_latest_idx",),
    ),
    _SQLiteCheckpointRule(
        "BLR_CHECKPOINT_CURRENT_UNEXPECTED",
        """SELECT 1
             FROM temp.ge_blr_checkpoint_current AS current
            WHERE NOT EXISTS (
              SELECT 1
                FROM temp.ge_blr_checkpoint_revisions AS latest
                     INDEXED BY ge_blr_checkpoint_revisions_latest_idx
               WHERE latest.tenant_id = current.tenant_id
                 AND latest.checkpoint_scope = current.checkpoint_scope
                 AND latest.checkpoint_id = current.checkpoint_id
                 AND latest.action = 'put'
                 AND NOT EXISTS (
                   SELECT 1
                     FROM temp.ge_blr_checkpoint_revisions AS later
                          INDEXED BY ge_blr_checkpoint_revisions_latest_idx
                    WHERE later.tenant_id = latest.tenant_id
                      AND later.checkpoint_scope = latest.checkpoint_scope
                      AND later.checkpoint_id = latest.checkpoint_id
                      AND later.revision > latest.revision
                 )
            )
            LIMIT ?""",
        ("ge_blr_checkpoint_revisions_latest_idx",),
    ),
    _SQLiteCheckpointRule(
        "BLR_CHECKPOINT_CURRENT_STALE",
        """SELECT 1
             FROM temp.ge_blr_checkpoint_revisions AS latest
                  INDEXED BY ge_blr_checkpoint_revisions_latest_idx
             JOIN temp.ge_blr_checkpoint_current AS current
               ON current.tenant_id = latest.tenant_id
              AND current.checkpoint_scope = latest.checkpoint_scope
              AND current.checkpoint_id = latest.checkpoint_id
            WHERE latest.action = 'put'
              AND NOT EXISTS (
                SELECT 1
                  FROM temp.ge_blr_checkpoint_revisions AS later
                       INDEXED BY ge_blr_checkpoint_revisions_latest_idx
                 WHERE later.tenant_id = latest.tenant_id
                   AND later.checkpoint_scope = latest.checkpoint_scope
                   AND later.checkpoint_id = latest.checkpoint_id
                   AND later.revision > latest.revision
              )
              AND current.checkpoint_revision IS NOT latest.revision
            LIMIT ?""",
        ("ge_blr_checkpoint_revisions_latest_idx",),
    ),
    _SQLiteCheckpointRule(
        "BLR_CHECKPOINT_CURRENT_BINDING",
        """SELECT violation FROM (
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
                AND NOT EXISTS (
                  SELECT 1
                    FROM temp.ge_blr_checkpoint_revisions AS later
                         INDEXED BY ge_blr_checkpoint_revisions_latest_idx
                   WHERE later.tenant_id = latest.tenant_id
                     AND later.checkpoint_scope = latest.checkpoint_scope
                     AND later.checkpoint_id = latest.checkpoint_id
                     AND later.revision > latest.revision
                )
              WHERE common.key_blob IS NULL
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId')
                    IS NOT current.tenant_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.checkpointScope')
                    IS NOT current.checkpoint_scope
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.checkpointId')
                    IS NOT current.checkpoint_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId')
                    IS NOT current.tenant_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointScope')
                    IS NOT current.checkpoint_scope
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointId')
                    IS NOT current.checkpoint_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId')
                    IS NOT current.stream_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.boundSequence')
                    IS NOT current.bound_sequence
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.boundRecordHash')
                    IS NOT current.bound_record_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointRevision')
                    IS NOT current.checkpoint_revision
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.createdAt')
                    IS NOT current.checkpoint_created_at
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.valueHash')
                    IS NOT current.value_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.valueBytes')
                    IS NOT current.value_bytes
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.committedAtMs')
                    IS NOT current.committed_at_ms
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.checkpointScope')
                    IS NOT current.checkpoint_scope
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.checkpointId')
                    IS NOT current.checkpoint_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.streamId')
                    IS NOT current.stream_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.boundSequence')
                    IS NOT current.bound_sequence
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.boundRecordHash')
                    IS NOT current.bound_record_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.createdAt')
                    IS NOT current.checkpoint_created_at
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.valueHash')
                    IS NOT current.value_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.valueBytes')
                    IS NOT current.value_bytes
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
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId')
                    IS NOT revision.tenant_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.checkpointScope')
                    IS NOT revision.checkpoint_scope
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.revision')
                    IS NOT revision.revision
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId')
                    IS NOT revision.tenant_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointScope')
                    IS NOT revision.checkpoint_scope
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.revision')
                    IS NOT revision.revision
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointId')
                    IS NOT revision.checkpoint_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.action')
                    IS NOT revision.action
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.boundSequence')
                    IS NOT revision.bound_sequence
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.boundRecordHash')
                    IS NOT revision.bound_record_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.checkpointCreatedAt')
                    IS NOT revision.checkpoint_created_at
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.valueHash')
                    IS NOT revision.value_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.valueBytes')
                    IS NOT revision.value_bytes
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.recordedAtMs')
                    IS NOT revision.recorded_at_ms
                 OR (revision.action = 'put' AND (
                   json_extract(CAST(common.state_blob AS TEXT), '$.summary.checkpointScope')
                      IS NOT revision.checkpoint_scope
                   OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.checkpointId')
                      IS NOT revision.checkpoint_id
                   OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.streamId')
                      IS NOT revision.stream_id
                   OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.boundSequence')
                      IS NOT revision.bound_sequence
                   OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.boundRecordHash')
                      IS NOT revision.bound_record_hash
                   OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.createdAt')
                      IS NOT revision.checkpoint_created_at
                   OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.valueHash')
                      IS NOT revision.value_hash
                   OR json_extract(CAST(common.state_blob AS TEXT), '$.summary.valueBytes')
                      IS NOT revision.value_bytes))
                 OR (revision.action = 'delete'
                   AND json_type(CAST(common.state_blob AS TEXT), '$.summary') IS NOT 'null')
             UNION ALL
             SELECT 1 AS violation
               FROM temp.ge_blr_stage AS common
               LEFT JOIN temp.ge_blr_checkpoint_revisions AS revision
                 ON revision.key_blob = common.key_blob
              WHERE common.kind_rank = 5 AND revision.key_blob IS NULL
           ) LIMIT ?""",
        ("ge_blr_checkpoint_revisions_latest_idx",),
    ),
)


class SQLiteV1CheckpointInvariantCampaign:
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
        diagnostic_limit: object = DEFAULT_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT,
    ) -> None:
        self._diagnostic_limit = _diagnostic_limit(diagnostic_limit)
        if type(summary) is not SQLiteV1BaselineSourceSummary:
            raise TypeError("checkpoint campaign source summary has the wrong type")
        if type(identity) is not BaselineProjectionIdentity:
            raise TypeError("checkpoint campaign projection identity has the wrong type")
        if type(stage) is not SQLiteV1BaselineTempStage:
            raise TypeError("checkpoint campaign TEMP stage has the wrong type")
        self._summary = summary
        self._identity = identity
        self._stage = stage
        self._state: Literal["open", "complete", "poisoned"] = "open"
        self._expected_total_changes, self._session = stage._begin_checkpoint_campaign(
            summary,
            identity,
        )

    @property
    def state(self) -> Literal["open", "complete", "poisoned"]:
        if self._state == "open" and self._stage.state != "open":
            self._state = "poisoned"
        return self._state

    def run(self) -> SQLiteCheckpointCampaignReport:
        if self._state != "open":
            self._stage._abort_checkpoint_campaign(self._session)
        diagnostics: list[SQLiteCheckpointReconciliationDiagnostic] = []
        try:
            for rule in SQLITE_CHECKPOINT_RULES:
                observed = self._run_rule(rule)
                if observed:
                    diagnostics.append(
                        SQLiteCheckpointReconciliationDiagnostic(
                            rule.rule_id,
                            min(observed, self._diagnostic_limit),
                            observed > self._diagnostic_limit,
                        )
                    )
                self._stage._assert_checkpoint_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
            self._stage._complete_checkpoint_campaign(
                self._identity,
                self._expected_total_changes,
                self._session,
            )
            self._state = "complete"
            return SQLiteCheckpointCampaignReport(self._identity, tuple(diagnostics))
        except BaseException:
            self._state = "poisoned"
            with suppress(BaseException):
                self._stage._abort_checkpoint_campaign(self._session)
            raise

    def dispose(self) -> None:
        if self._state != "open":
            return
        self._state = "poisoned"
        self._stage._abort_checkpoint_campaign(self._session)

    def _run_rule(self, rule: _SQLiteCheckpointRule) -> int:
        cursor: _SQLiteCursorCapability | None = None
        registered = False
        primary: BaseException | None = None
        observed = 0
        try:
            self._stage._assert_checkpoint_campaign_fence(
                self._session,
                self._expected_total_changes,
            )
            cursor = self._summary._connection.execute(
                rule.sql,
                (self._diagnostic_limit + 1,),
            )
            self._stage._assert_checkpoint_campaign_fence(
                self._session,
                self._expected_total_changes,
            )
            self._stage._register_checkpoint_campaign_cursor(
                self._session,
                cursor,
                self._expected_total_changes,
            )
            registered = True
            while observed <= self._diagnostic_limit:
                self._stage._assert_checkpoint_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
                row = cursor.fetchone()
                self._stage._assert_checkpoint_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
                if row is None:
                    break
                if len(row) != 1 or type(row[0]) is not int or row[0] != 1:
                    self._stage._poison(f"{rule.rule_id}: checkpoint witness row is invalid")
                observed += 1
        except BaseException as error:
            primary = error
        if cursor is not None:
            try:
                if primary is None:
                    self._stage._assert_checkpoint_campaign_fence(
                        self._session,
                        self._expected_total_changes,
                    )
                cursor.close()
            except BaseException as error:
                if primary is None:
                    primary = error
            if registered and primary is None:
                try:
                    self._stage._release_checkpoint_campaign_cursor(
                        self._session,
                        cursor,
                        self._expected_total_changes,
                    )
                except BaseException as error:
                    primary = error
        if primary is not None:
            if isinstance(primary, ValueError) and str(primary).startswith("BLR_"):
                raise primary
            self._stage._poison(f"{rule.rule_id}: checkpoint rule execution failed")
        return observed


def run_sqlite_v1_checkpoint_invariant_campaign(
    summary: SQLiteV1BaselineSourceSummary,
    identity: BaselineProjectionIdentity,
    stage: SQLiteV1BaselineTempStage,
    *,
    diagnostic_limit: object = DEFAULT_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT,
) -> SQLiteCheckpointCampaignReport:
    return SQLiteV1CheckpointInvariantCampaign(
        summary,
        identity,
        stage,
        diagnostic_limit=diagnostic_limit,
    ).run()
