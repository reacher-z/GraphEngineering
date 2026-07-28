from __future__ import annotations

from collections.abc import Callable
from dataclasses import FrozenInstanceError, replace

import pytest

from graph_engineering.canonical import canonical_bytes
from graph_engineering.cycle_store_provider import create_cycle_store_record
from graph_engineering.models import JsonObject
from graph_engineering.sqlite_operation_baseline import BaselineProjectionIdentity
from graph_engineering.sqlite_operation_baseline_cooperation import (
    _stream_sqlite_v1_baseline_source_into_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_handoff import (
    _project_ordered_sqlite_v1_baseline_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    _SQLiteCursorCapability,
    capture_sqlite_v1_baseline_source_summary,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    SQLiteV1BaselineTempStage,
    configure_sqlite_v1_baseline_temp_storage,
    create_sqlite_v1_baseline_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_stream_record_invariants import (
    SQLITE_STREAM_RECORD_RULES,
    SQLiteBaselineReconciliationDiagnostic,
    SQLiteStreamRecordCampaignReport,
    SQLiteV1StreamRecordInvariantCampaign,
    run_sqlite_v1_stream_record_invariant_campaign,
)
from tests.test_sqlite_operation_baseline_source import NOW, database

Populate = Callable[[SQLiteV1BaselineConnectionOwner], None]
SHARED_NOW = 1_785_110_405_000


def _insert_stream(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    stream_id: str,
    tail_sequence: int,
    tail_hash: str | None,
) -> None:
    connection.execute(
        """INSERT INTO ge_cycle_streams
           (tenant_id, stream_id, tail_sequence, tail_record_hash,
            created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)""",
        (tenant_id, stream_id, tail_sequence, tail_hash, NOW, NOW),
    ).close()


def _insert_record(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    stream_id: str,
    record: JsonObject,
) -> None:
    value = record["value"]
    connection.execute(
        """INSERT INTO ge_cycle_records
           (tenant_id, stream_id, sequence, record_id, previous_record_hash,
            value_hash, value_bytes, value_blob, record_hash, record_blob,
            committed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tenant_id,
            stream_id,
            record["sequence"],
            record["recordId"],
            record["previousRecordHash"],
            record["valueHash"],
            record["valueBytes"],
            canonical_bytes(value),
            record["recordHash"],
            canonical_bytes(record),
            NOW,
        ),
    ).close()


def _record(record_id: str, sequence: int, previous_hash: str | None) -> JsonObject:
    return create_cycle_store_record(
        record_id=record_id,
        sequence=sequence,
        previous_record_hash=previous_hash,
        value={"record": record_id},
    )


def _shared_record(
    tenant_id: str,
    stream_id: str,
    record_id: str,
    sequence: int,
    previous_hash: str | None,
) -> JsonObject:
    return create_cycle_store_record(
        record_id=record_id,
        sequence=sequence,
        previous_record_hash=previous_hash,
        value=f"{tenant_id}:{stream_id}:{sequence}",
    )


def _populate_hostile_relations(connection: SQLiteV1BaselineConnectionOwner) -> None:
    connection.execute("PRAGMA foreign_keys = OFF").close()

    _insert_stream(connection, "tenant-foreign", "stream-orphan", -1, None)
    orphan = _shared_record(
        "tenant-orphan", "stream-orphan", "orphan-0", 0, None
    )
    _insert_record(connection, "tenant-orphan", "stream-orphan", orphan)
    _insert_stream(connection, "tenant-empty", "stream-empty", -1, None)

    gap_1 = _shared_record("tenant-gap", "stream-gap", "gap-1", 1, "a" * 64)
    _insert_record(connection, "tenant-gap", "stream-gap", gap_1)
    _insert_stream(connection, "tenant-gap", "stream-gap", 1, str(gap_1["recordHash"]))

    interior_0 = _shared_record(
        "tenant-interior", "stream-interior", "interior-0", 0, None
    )
    interior_2 = _shared_record(
        "tenant-interior",
        "stream-interior",
        "interior-2",
        2,
        str(interior_0["recordHash"]),
    )
    _insert_record(connection, "tenant-interior", "stream-interior", interior_0)
    _insert_record(connection, "tenant-interior", "stream-interior", interior_2)
    _insert_stream(
        connection,
        "tenant-interior",
        "stream-interior",
        2,
        str(interior_2["recordHash"]),
    )

    predecessor_0 = _shared_record("tenant-pred", "stream-pred", "pred-0", 0, None)
    predecessor_1 = _shared_record(
        "tenant-pred", "stream-pred", "pred-1", 1, "b" * 64
    )
    _insert_record(connection, "tenant-pred", "stream-pred", predecessor_0)
    _insert_record(connection, "tenant-pred", "stream-pred", predecessor_1)
    _insert_stream(
        connection,
        "tenant-pred",
        "stream-pred",
        1,
        str(predecessor_1["recordHash"]),
    )

    tail_0 = _shared_record("tenant-tail", "stream-tail", "tail-0", 0, None)
    tail_1 = _shared_record(
        "tenant-tail", "stream-tail", "tail-1", 1, str(tail_0["recordHash"])
    )
    _insert_record(connection, "tenant-tail", "stream-tail", tail_0)
    _insert_record(connection, "tenant-tail", "stream-tail", tail_1)
    _insert_stream(connection, "tenant-tail", "stream-tail", 0, str(tail_0["recordHash"]))

    missing_tail_0 = _shared_record(
        "tenant-missing-tail", "stream-missing-tail", "missing-tail-0", 0, None
    )
    _insert_record(
        connection, "tenant-missing-tail", "stream-missing-tail", missing_tail_0
    )
    _insert_stream(
        connection,
        "tenant-missing-tail",
        "stream-missing-tail",
        1,
        "c" * 64,
    )

    wrong_tail_0 = _shared_record(
        "tenant-wrong-tail", "stream-wrong-tail", "wrong-tail-0", 0, None
    )
    _insert_record(connection, "tenant-wrong-tail", "stream-wrong-tail", wrong_tail_0)
    _insert_stream(
        connection,
        "tenant-wrong-tail",
        "stream-wrong-tail",
        0,
        "d" * 64,
    )
    connection.execute(
        """UPDATE ge_cycle_schema
              SET latest_migration_applied_at_ms = ?, created_at_ms = ?, updated_at_ms = ?""",
        (SHARED_NOW, SHARED_NOW, SHARED_NOW),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migrations SET applied_at_ms = ?",
        (SHARED_NOW,),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ?",
        (SHARED_NOW,),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_streams SET created_at_ms = ?, updated_at_ms = ?",
        (SHARED_NOW, SHARED_NOW),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_records SET committed_at_ms = ?",
        (SHARED_NOW,),
    ).close()
    connection.commit()


def _prepare(
    populate: Populate | None = None,
    *,
    captured_at_ms: int = NOW,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    SQLiteV1BaselineTempStage,
    BaselineProjectionIdentity,
]:
    connection = database()
    if populate is not None:
        populate(connection)
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    summary = capture_sqlite_v1_baseline_source_summary(
        connection,
        captured_at_ms=captured_at_ms,
    )
    _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
    identity = _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
    return connection, summary, stage, identity


def _cleanup(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
) -> None:
    try:
        stage.dispose()
    finally:
        connection.rollback()
        connection.close()


def test_pristine_campaign_is_empty_frozen_and_exactly_identity_bound() -> None:
    connection, summary, stage, identity = _prepare()
    try:
        report = run_sqlite_v1_stream_record_invariant_campaign(summary, identity, stage)
        assert report == SQLiteStreamRecordCampaignReport(identity, ())
        assert report.projection_identity is identity
        assert stage._stream_record_campaign_completed
        with pytest.raises(FrozenInstanceError):
            report.diagnostics = ()  # type: ignore[misc]
    finally:
        _cleanup(connection, stage)


def test_shared_hostile_fixture_reports_exact_rule_order_and_counts() -> None:
    connection, summary, stage, identity = _prepare(
        _populate_hostile_relations,
        captured_at_ms=SHARED_NOW,
    )
    try:
        report = run_sqlite_v1_stream_record_invariant_campaign(summary, identity, stage)
        assert report.projection_identity == BaselineProjectionIdentity(
            baseline_id=(
                "v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af"
            ),
            entry_count=21,
            legacy_operation_count=0,
            first_entry_hash=(
                "f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c"
            ),
            final_entry_hash=(
                "f1210fc05e988ad147f859d3eda8eab51e3a1006ef6f4414f66b338bc1ddcd5e"
            ),
            projection_sha256=(
                "8ad7385488da4cba4475e4037671384962cd2d9d24cecd82d08962af0031a6b8"
            ),
        )
        assert report.diagnostics == (
            SQLiteBaselineReconciliationDiagnostic(
                "BLR_RECORD_STREAM_MISSING", 1, False
            ),
            SQLiteBaselineReconciliationDiagnostic("BLR_STREAM_EMPTY", 2, False),
            SQLiteBaselineReconciliationDiagnostic("BLR_RECORD_GAP", 2, False),
            SQLiteBaselineReconciliationDiagnostic(
                "BLR_RECORD_PREDECESSOR", 1, False
            ),
            SQLiteBaselineReconciliationDiagnostic("BLR_STREAM_TAIL", 3, False),
        )
    finally:
        _cleanup(connection, stage)


def test_diagnostic_limit_caps_and_marks_truncation() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        for index in range(18):
            _insert_stream(connection, "tenant-empty", f"stream-{index:02d}", -1, None)
        connection.commit()

    connection, summary, stage, identity = _prepare(populate)
    try:
        report = run_sqlite_v1_stream_record_invariant_campaign(
            summary,
            identity,
            stage,
            diagnostic_limit=16,
        )
        assert report.diagnostics == (
            SQLiteBaselineReconciliationDiagnostic("BLR_STREAM_EMPTY", 16, True),
        )
    finally:
        _cleanup(connection, stage)


def test_binding_rule_detects_count_preserving_scalar_replacement() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        record = _record("binding-0", 0, None)
        _insert_record(connection, "tenant-binding", "stream-binding", record)
        _insert_stream(
            connection,
            "tenant-binding",
            "stream-binding",
            0,
            str(record["recordHash"]),
        )
        connection.commit()

    connection, summary, stage, identity = _prepare(populate)
    try:
        connection.execute(
            "UPDATE temp.ge_blr_records SET value_bytes = value_bytes + 1"
        ).close()
        stage._allowed_total_changes = connection.total_changes
        report = run_sqlite_v1_stream_record_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteBaselineReconciliationDiagnostic("BLR_RECORD_BINDING", 1, False),
        )
    finally:
        _cleanup(connection, stage)


def test_defensive_hash_duplicate_rule_is_reported_from_bounded_witness_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if "HAVING count(*) > 1" in sql:
            return original_execute(owner, "SELECT 1")
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    try:
        report = run_sqlite_v1_stream_record_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteBaselineReconciliationDiagnostic(
                "BLR_RECORD_HASH_DUPLICATE", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_every_indexed_rule_has_its_named_query_plan() -> None:
    connection, _summary, stage, _identity = _prepare()
    try:
        for rule in SQLITE_STREAM_RECORD_RULES:
            cursor = connection.execute("EXPLAIN QUERY PLAN " + rule.sql, (17,))
            details: list[str] = []
            try:
                while True:
                    row = cursor.fetchone()
                    if row is None:
                        break
                    assert len(row) == 4 and isinstance(row[3], str)
                    details.append(row[3])
            finally:
                cursor.close()
            plan = "\n".join(details)
            for index in rule.required_indexes:
                assert index in plan, (rule.rule_id, plan)
            if rule.rule_id == "BLR_STREAM_EMPTY":
                assert "SCAN ge_blr_records" not in plan
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("diagnostic_limit", [None, True, 0, 65, 1.5, "16"])
def test_invalid_limit_fails_before_campaign_begin(diagnostic_limit: object) -> None:
    connection, summary, stage, identity = _prepare()
    try:
        with pytest.raises(ValueError, match="outside bounds"):
            SQLiteV1StreamRecordInvariantCampaign(
                summary,
                identity,
                stage,
                diagnostic_limit=diagnostic_limit,
            )
        assert not stage._stream_record_campaign_started
        assert stage.state == "open"
    finally:
        _cleanup(connection, stage)


def test_equal_projection_replacement_and_second_run_are_terminal() -> None:
    connection, summary, stage, identity = _prepare()
    try:
        replacement = replace(identity)
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            SQLiteV1StreamRecordInvariantCampaign(summary, replacement, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)

    connection, summary, stage, identity = _prepare()
    try:
        campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
        campaign.run()
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            campaign.run()
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_dml_and_catalog_epoch_changes_poison_campaign() -> None:
    connection, summary, stage, identity = _prepare()
    try:
        campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
        connection.execute(
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0"
        ).close()
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            campaign.run()
        assert campaign.state == "poisoned"
    finally:
        _cleanup(connection, stage)

    connection, summary, stage, identity = _prepare()
    try:
        campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
        connection.execute("DROP INDEX temp.ge_blr_records_stream_position_idx").close()
        with pytest.raises(ValueError, match=r"TRANSACTION_CHANGED|CATALOG"):
            campaign.run()
        assert campaign.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_abandonment_and_stage_disposal_poison_active_campaign() -> None:
    connection, summary, stage, identity = _prepare()
    try:
        campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            campaign.dispose()
        assert campaign.state == "poisoned"
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("rule", SQLITE_STREAM_RECORD_RULES, ids=lambda rule: rule.rule_id)
def test_dml_after_each_rule_cursor_creation_is_rejected_and_cursor_is_closed(
    monkeypatch: pytest.MonkeyPatch,
    rule: object,
) -> None:
    checked_rule = rule
    assert hasattr(checked_rule, "sql")
    target_sql = checked_rule.sql
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    target_closed = False
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal injected, target
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql and not injected:
            target = cursor
            injected = True
            mutation = original_execute(
                owner,
                "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            )
            original_close(mutation)
        return cursor

    def close(cursor: _SQLiteCursorCapability) -> None:
        nonlocal target_closed
        if cursor is target:
            target_closed = True
        original_close(cursor)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            campaign.run()
        assert injected and target_closed
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("boundary", ["fetch", "close", "after-rule", "terminal"])
def test_dml_at_remaining_campaign_boundaries_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
    boundary: str,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    injected = False

    def inject() -> None:
        nonlocal injected
        if injected:
            return
        injected = True
        cursor = original_execute(
            connection,
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        )
        original_close(cursor)

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if target is None and sql == SQLITE_STREAM_RECORD_RULES[0].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        row = original_fetchone(cursor)
        if boundary == "fetch" and cursor is target:
            inject()
        return row

    def close(cursor: _SQLiteCursorCapability) -> None:
        original_close(cursor)
        if boundary == "close" and cursor is target:
            inject()

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    if boundary == "after-rule":
        original_run_rule = SQLiteV1StreamRecordInvariantCampaign._run_rule

        def run_rule(campaign_value: SQLiteV1StreamRecordInvariantCampaign, rule: object) -> int:
            observed = original_run_rule(campaign_value, rule)  # type: ignore[arg-type]
            inject()
            return observed

        monkeypatch.setattr(SQLiteV1StreamRecordInvariantCampaign, "_run_rule", run_rule)
    if boundary == "terminal":
        original_complete = SQLiteV1BaselineTempStage._complete_stream_record_campaign

        def complete(
            stage_value: SQLiteV1BaselineTempStage,
            projection: BaselineProjectionIdentity,
            total_changes: int,
            session: object,
        ) -> None:
            inject()
            original_complete(stage_value, projection, total_changes, session)

        monkeypatch.setattr(
            SQLiteV1BaselineTempStage,
            "_complete_stream_record_campaign",
            complete,
        )
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            campaign.run()
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_stage_dispose_finalizes_active_campaign_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
    cursor = connection.execute(SQLITE_STREAM_RECORD_RULES[0].sql, (17,))
    stage._register_stream_record_campaign_cursor(
        campaign._session,
        cursor,
        campaign._expected_total_changes,
    )
    original_close = _SQLiteCursorCapability.close
    closed = False

    def close(cursor_value: _SQLiteCursorCapability) -> None:
        nonlocal closed
        if cursor_value is cursor:
            closed = True
        original_close(cursor_value)

    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        stage.dispose()
        assert closed
        assert stage.state == "disposed"
        assert campaign.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


def test_active_campaign_cursor_close_failure_surfaces_after_catalog_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
    cursor = connection.execute(SQLITE_STREAM_RECORD_RULES[0].sql, (17,))
    stage._register_stream_record_campaign_cursor(
        campaign._session,
        cursor,
        campaign._expected_total_changes,
    )
    original_close = _SQLiteCursorCapability.close

    def close(cursor_value: _SQLiteCursorCapability) -> None:
        original_close(cursor_value)
        if cursor_value is cursor:
            raise RuntimeError("hostile campaign cursor close")

    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError, match="STAGE_ITERATOR_INCOMPLETE"):
            stage.dispose()
        residue = connection.execute(
            "SELECT count(*) FROM temp.sqlite_schema "
            "WHERE substr(lower(name), 1, 7) = 'ge_blr_'"
        )
        try:
            assert residue.fetchone() == (0,)
        finally:
            residue.close()
    finally:
        connection.rollback()
        connection.close()


def test_primary_fetch_failure_is_not_replaced_by_cursor_close_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_STREAM_RECORD_RULES[0].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        if cursor is target:
            raise RuntimeError("authoritative hostile fetch")
        return original_fetchone(cursor)

    def close(cursor: _SQLiteCursorCapability) -> None:
        original_close(cursor)
        if cursor is target:
            raise RuntimeError("secondary hostile close")

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError) as raised:
            campaign.run()
        assert str(raised.value).startswith("BLR_RECORD_STREAM_MISSING:")
        assert "close" not in str(raised.value)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("diagnostic_limit", [1, 16, 64])
@pytest.mark.parametrize("extra", [False, True], ids=["exact-limit", "limit-plus-one"])
def test_exact_diagnostic_limit_boundary(
    diagnostic_limit: int,
    extra: bool,
) -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        count = diagnostic_limit + int(extra)
        for index in range(count):
            _insert_stream(connection, "tenant-limit", f"stream-{index:03d}", -1, None)
        connection.commit()

    connection, summary, stage, identity = _prepare(populate)
    try:
        report = run_sqlite_v1_stream_record_invariant_campaign(
            summary,
            identity,
            stage,
            diagnostic_limit=diagnostic_limit,
        )
        assert report.diagnostics == (
            SQLiteBaselineReconciliationDiagnostic(
                "BLR_STREAM_EMPTY",
                diagnostic_limit,
                extra,
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_malformed_witness_marker_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if sql == SQLITE_STREAM_RECORD_RULES[0].sql:
            return original_execute(owner, "SELECT 2")
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    try:
        with pytest.raises(ValueError) as raised:
            run_sqlite_v1_stream_record_invariant_campaign(summary, identity, stage)
        assert str(raised.value).startswith("BLR_RECORD_STREAM_MISSING:")
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_catalog_replacement_during_rule_fetch_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1StreamRecordInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    target: _SQLiteCursorCapability | None = None
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_STREAM_RECORD_RULES[0].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        nonlocal injected
        row = original_fetchone(cursor)
        if cursor is target and not injected:
            injected = True
            replacement = original_execute(
                connection,
                "DROP INDEX temp.ge_blr_records_stream_position_idx",
            )
            replacement.close()
        return row

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    try:
        with pytest.raises(ValueError, match=r"TRANSACTION_CHANGED|CATALOG"):
            campaign.run()
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("missing_side", ["common", "relation"])
def test_common_relation_disagreement_cannot_enter_campaign(missing_side: str) -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        record = _record("coverage-0", 0, None)
        _insert_record(connection, "tenant-coverage", "stream-coverage", record)
        _insert_stream(
            connection,
            "tenant-coverage",
            "stream-coverage",
            0,
            str(record["recordHash"]),
        )
        connection.commit()

    connection, summary, stage, identity = _prepare(populate)
    try:
        table = "ge_blr_stage" if missing_side == "common" else "ge_blr_records"
        predicate = "kind_rank = 3" if missing_side == "common" else "1 = 1"
        connection.execute(f"DELETE FROM temp.{table} WHERE {predicate}").close()
        stage._allowed_total_changes = connection.total_changes
        with pytest.raises(ValueError, match=r"STAGE_(COUNT|KEY_COVERAGE)"):
            run_sqlite_v1_stream_record_invariant_campaign(summary, identity, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)
