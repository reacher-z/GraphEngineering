"""Private read-only stream/record invariant campaign over verified TEMP relations."""

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

DEFAULT_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT = 16
MAX_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT = 64

SQLiteStreamRecordRuleId = Literal[
    "BLR_RECORD_STREAM_MISSING",
    "BLR_STREAM_EMPTY",
    "BLR_RECORD_GAP",
    "BLR_RECORD_PREDECESSOR",
    "BLR_STREAM_TAIL",
    "BLR_RECORD_HASH_DUPLICATE",
    "BLR_RECORD_BINDING",
]


@dataclass(frozen=True, slots=True)
class SQLiteBaselineReconciliationDiagnostic:
    """One closed safe diagnostic with no dynamic or tenant-controlled fields."""

    rule_id: SQLiteStreamRecordRuleId
    violation_count: int
    diagnostics_truncated: bool


@dataclass(frozen=True, slots=True)
class SQLiteStreamRecordCampaignReport:
    """Frozen rule outcome tied to the exact sealed projection object."""

    projection_identity: BaselineProjectionIdentity
    diagnostics: tuple[SQLiteBaselineReconciliationDiagnostic, ...]


@dataclass(frozen=True, slots=True)
class _SQLiteStreamRecordRule:
    rule_id: SQLiteStreamRecordRuleId
    sql: str
    required_indexes: tuple[str, ...]


SQLITE_STREAM_RECORD_RULES: tuple[_SQLiteStreamRecordRule, ...] = (
    _SQLiteStreamRecordRule(
        "BLR_RECORD_STREAM_MISSING",
        """SELECT 1
             FROM temp.ge_blr_records AS record
                  INDEXED BY ge_blr_records_stream_sequence_uidx
             LEFT JOIN temp.ge_blr_streams AS stream
               ON stream.tenant_id = record.tenant_id
              AND stream.stream_id = record.stream_id
            WHERE stream.key_blob IS NULL
            LIMIT ?""",
        ("ge_blr_records_stream_sequence_uidx",),
    ),
    _SQLiteStreamRecordRule(
        "BLR_STREAM_EMPTY",
        """SELECT 1
             FROM temp.ge_blr_streams
            WHERE tail_sequence = -1
            LIMIT ?""",
        (),
    ),
    _SQLiteStreamRecordRule(
        "BLR_RECORD_GAP",
        """SELECT 1
             FROM temp.ge_blr_records INDEXED BY ge_blr_records_stream_sequence_uidx
            GROUP BY tenant_id, stream_id
           HAVING min(sequence) <> 0 OR count(*) <> max(sequence) + 1
            LIMIT ?""",
        ("ge_blr_records_stream_sequence_uidx",),
    ),
    _SQLiteStreamRecordRule(
        "BLR_RECORD_PREDECESSOR",
        """SELECT 1
             FROM temp.ge_blr_records AS current
                  INDEXED BY ge_blr_records_stream_sequence_uidx
             JOIN temp.ge_blr_records AS prior
                  INDEXED BY ge_blr_records_stream_position_idx
               ON prior.tenant_id = current.tenant_id
              AND prior.stream_id = current.stream_id
              AND prior.sequence = current.sequence - 1
            WHERE current.sequence > 0
              AND current.previous_record_hash IS NOT prior.record_hash
            LIMIT ?""",
        (
            "ge_blr_records_stream_sequence_uidx",
            "ge_blr_records_stream_position_idx",
        ),
    ),
    _SQLiteStreamRecordRule(
        "BLR_STREAM_TAIL",
        """SELECT 1
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
            LIMIT ?""",
        ("ge_blr_records_stream_position_idx",),
    ),
    _SQLiteStreamRecordRule(
        "BLR_RECORD_HASH_DUPLICATE",
        """SELECT 1
             FROM temp.ge_blr_records INDEXED BY ge_blr_records_tenant_hash_uidx
            GROUP BY tenant_id, record_hash
           HAVING count(*) > 1
            LIMIT ?""",
        ("ge_blr_records_tenant_hash_uidx",),
    ),
    _SQLiteStreamRecordRule(
        "BLR_RECORD_BINDING",
        """SELECT violation FROM (
             SELECT 1 AS violation
               FROM temp.ge_blr_records AS record
                    INDEXED BY ge_blr_records_tenant_hash_uidx
               LEFT JOIN temp.ge_blr_stage AS common
                 ON common.kind_rank = 3 AND common.key_blob = record.key_blob
              WHERE common.key_blob IS NULL
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.tenantId')
                    IS NOT record.tenant_id
                 OR json_extract(CAST(common.key_blob AS TEXT), '$.recordId')
                    IS NOT record.record_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.tenantId')
                    IS NOT record.tenant_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.streamId')
                    IS NOT record.stream_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.recordId')
                    IS NOT record.record_id
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.sequence')
                    IS NOT record.sequence
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.previousRecordHash')
                    IS NOT record.previous_record_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.recordHash')
                    IS NOT record.record_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.valueHash')
                    IS NOT record.value_hash
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.valueBytes')
                    IS NOT record.value_bytes
                 OR json_extract(CAST(common.state_blob AS TEXT), '$.committedAtMs')
                    IS NOT record.committed_at_ms
             UNION ALL
             SELECT 1 AS violation
               FROM temp.ge_blr_stage AS common
               LEFT JOIN temp.ge_blr_records AS record
                 ON record.key_blob = common.key_blob
              WHERE common.kind_rank = 3 AND record.key_blob IS NULL
           ) LIMIT ?""",
        ("ge_blr_records_tenant_hash_uidx",),
    ),
)


def _diagnostic_limit(value: object) -> int:
    if (
        type(value) is not int
        or value < 1
        or value > MAX_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT
    ):
        raise ValueError("SQLite baseline diagnostic limit is outside bounds")
    return value


class SQLiteV1StreamRecordInvariantCampaign:
    """One-shot private executor for the first frozen relational rule family."""

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
            raise TypeError("stream/record campaign source summary has the wrong type")
        if type(identity) is not BaselineProjectionIdentity:
            raise TypeError("stream/record campaign projection identity has the wrong type")
        if type(stage) is not SQLiteV1BaselineTempStage:
            raise TypeError("stream/record campaign TEMP stage has the wrong type")
        self._summary = summary
        self._identity = identity
        self._stage = stage
        self._state: Literal["open", "complete", "poisoned"] = "open"
        self._expected_total_changes, self._session = stage._begin_stream_record_campaign(
            summary,
            identity,
        )

    @property
    def state(self) -> Literal["open", "complete", "poisoned"]:
        if self._state == "open" and self._stage.state != "open":
            self._state = "poisoned"
        return self._state

    def run(self) -> SQLiteStreamRecordCampaignReport:
        if self._state != "open":
            self._stage._abort_stream_record_campaign(self._session)
        diagnostics: list[SQLiteBaselineReconciliationDiagnostic] = []
        try:
            for rule in SQLITE_STREAM_RECORD_RULES:
                observed = self._run_rule(rule)
                if observed:
                    diagnostics.append(
                        SQLiteBaselineReconciliationDiagnostic(
                            rule.rule_id,
                            min(observed, self._diagnostic_limit),
                            observed > self._diagnostic_limit,
                        )
                    )
                self._stage._assert_stream_record_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
            self._stage._complete_stream_record_campaign(
                self._identity,
                self._expected_total_changes,
                self._session,
            )
            self._state = "complete"
            return SQLiteStreamRecordCampaignReport(self._identity, tuple(diagnostics))
        except BaseException:
            self._state = "poisoned"
            with suppress(BaseException):
                self._stage._abort_stream_record_campaign(self._session)
            raise

    def dispose(self) -> None:
        if self._state != "open":
            return
        self._state = "poisoned"
        self._stage._abort_stream_record_campaign(self._session)

    def _run_rule(self, rule: _SQLiteStreamRecordRule) -> int:
        cursor: _SQLiteCursorCapability | None = None
        registered = False
        primary: BaseException | None = None
        observed = 0
        try:
            self._stage._assert_stream_record_campaign_fence(
                self._session,
                self._expected_total_changes,
            )
            cursor = self._summary._connection.execute(
                rule.sql,
                (self._diagnostic_limit + 1,),
            )
            self._stage._assert_stream_record_campaign_fence(
                self._session,
                self._expected_total_changes,
            )
            self._stage._register_stream_record_campaign_cursor(
                self._session,
                cursor,
                self._expected_total_changes,
            )
            registered = True
            while observed <= self._diagnostic_limit:
                self._stage._assert_stream_record_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
                row = cursor.fetchone()
                self._stage._assert_stream_record_campaign_fence(
                    self._session,
                    self._expected_total_changes,
                )
                if row is None:
                    break
                if len(row) != 1 or type(row[0]) is not int or row[0] != 1:
                    self._stage._poison(
                        f"{rule.rule_id}: stream/record witness row is invalid"
                    )
                observed += 1
        except BaseException as error:
            primary = error
        if cursor is not None:
            try:
                if primary is None:
                    self._stage._assert_stream_record_campaign_fence(
                        self._session,
                        self._expected_total_changes,
                    )
                cursor.close()
            except BaseException as error:
                if primary is None:
                    primary = error
            if registered and primary is None:
                try:
                    self._stage._release_stream_record_campaign_cursor(
                        self._session,
                        cursor,
                        self._expected_total_changes,
                    )
                except BaseException as error:
                    primary = error
        if primary is not None:
            if isinstance(primary, ValueError) and str(primary).startswith("BLR_"):
                raise primary
            self._stage._poison(f"{rule.rule_id}: stream/record rule execution failed")
        return observed


def run_sqlite_v1_stream_record_invariant_campaign(
    summary: SQLiteV1BaselineSourceSummary,
    identity: BaselineProjectionIdentity,
    stage: SQLiteV1BaselineTempStage,
    *,
    diagnostic_limit: object = DEFAULT_SQLITE_STREAM_RECORD_DIAGNOSTIC_LIMIT,
) -> SQLiteStreamRecordCampaignReport:
    """Run the private one-shot stream/record campaign to completion."""

    return SQLiteV1StreamRecordInvariantCampaign(
        summary,
        identity,
        stage,
        diagnostic_limit=diagnostic_limit,
    ).run()
