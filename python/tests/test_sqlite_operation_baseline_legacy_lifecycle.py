from __future__ import annotations

from dataclasses import replace
from typing import cast

import pytest

import graph_engineering.sqlite_operation_baseline_legacy_invariants as campaign_module
from graph_engineering.sqlite_operation_baseline import BaselineProjectionIdentity
from graph_engineering.sqlite_operation_baseline_legacy_invariants import (
    SQLITE_LEGACY_RULES,
    SQLiteLegacyReconciliationDiagnostic,
    SQLiteLegacyRuleId,
    SQLiteV1LegacyInvariantCampaign,
    run_sqlite_v1_legacy_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    _SQLiteCursorCapability,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_operation_baseline_checkpoint_invariants import _cleanup
from tests.test_sqlite_operation_baseline_legacy_invariants import (
    NOW,
    _insert_operation,
    _populate_shared_legacy_fixture,
    _prepare_legacy,
)


def test_malformed_witness_marker_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_legacy()
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    target_close_count = 0

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        if sql == SQLITE_LEGACY_RULES[0].sql:
            target = original_execute(owner, "SELECT 2")
            return target
        return original_execute(owner, sql, parameters)

    def close(cursor: _SQLiteCursorCapability) -> None:
        nonlocal target_close_count
        if cursor is target:
            target_close_count += 1
        original_close(cursor)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError) as raised:
            run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert str(raised.value).startswith("BLR_LEGACY_INVENTORY:")
        assert target_close_count == 1
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_exact_projection_reference_is_required() -> None:
    connection, summary, stage, identity = _prepare_legacy()
    try:
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            SQLiteV1LegacyInvariantCampaign(summary, replace(identity), stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_success_is_one_shot_and_preserves_exact_projection_reference() -> None:
    connection, summary, stage, identity = _prepare_legacy()
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    try:
        report = campaign.run()
        assert report.projection_identity is identity
        assert campaign.state == "complete"
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            campaign.run()
        assert campaign.state == "complete"
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_abandonment_is_terminal() -> None:
    connection, summary, stage, identity = _prepare_legacy()
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    try:
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            campaign.dispose()
        assert campaign.state == "poisoned"
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "rule_index",
    range(len(SQLITE_LEGACY_RULES)),
    ids=[rule.rule_id for rule in SQLITE_LEGACY_RULES],
)
@pytest.mark.parametrize("boundary", ["create", "fetch", "close"])
def test_each_rule_cursor_boundary_is_fenced_and_closed_exactly_once(
    monkeypatch: pytest.MonkeyPatch,
    rule_index: int,
    boundary: str,
) -> None:
    connection, summary, stage, identity = _prepare_legacy()
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    target_sql = SQLITE_LEGACY_RULES[rule_index].sql
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    injected = False
    target_close_count = 0

    def inject() -> None:
        nonlocal injected
        if injected:
            return
        injected = True
        mutation = original_execute(
            connection,
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        )
        original_close(mutation)

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql and target is None:
            target = cursor
            if boundary == "create":
                inject()
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        row = original_fetchone(cursor)
        if boundary == "fetch" and cursor is target:
            inject()
        return row

    def close(cursor: _SQLiteCursorCapability) -> None:
        nonlocal target_close_count
        if cursor is target:
            target_close_count += 1
        original_close(cursor)
        if boundary == "close" and cursor is target:
            inject()

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            campaign.run()
        assert injected
        assert target is not None
        assert target_close_count == 1
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_diagnostic_to_next_rule_transition_is_fenced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=True)
    )
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_close = _SQLiteCursorCapability.close
    original_diagnostic = SQLiteLegacyReconciliationDiagnostic
    injected = False

    def diagnostic(
        rule_id: SQLiteLegacyRuleId,
        violation_count: int,
        diagnostics_truncated: bool,
    ) -> SQLiteLegacyReconciliationDiagnostic:
        nonlocal injected
        value = original_diagnostic(rule_id, violation_count, diagnostics_truncated)
        if not injected:
            injected = True
            mutation = original_execute(
                connection,
                "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            )
            original_close(mutation)
        return value

    monkeypatch.setattr(
        campaign_module,
        "SQLiteLegacyReconciliationDiagnostic",
        diagnostic,
    )
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def _populate_invalid_appends(
    connection: SQLiteV1BaselineConnectionOwner,
    count: int,
) -> None:
    for index in range(count):
        _insert_operation(
            connection,
            f"limit-append-{index:03d}",
            "append",
            {
                "tail": {
                    "exists": True,
                    "sequence": 0,
                    "recordHash": "f" * 64,
                },
                "appendedRecords": 1,
            },
        )
    connection.execute(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ? WHERE singleton = 1",
        (NOW,),
    ).close()
    connection.commit()


@pytest.mark.parametrize("diagnostic_limit", [1, 16, 64])
@pytest.mark.parametrize("extra", [False, True], ids=["exact-limit", "limit-plus-one"])
def test_exact_diagnostic_limit_boundary(
    diagnostic_limit: int,
    extra: bool,
) -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_invalid_appends(owner, diagnostic_limit + int(extra))
    )
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(
            summary,
            identity,
            stage,
            diagnostic_limit=diagnostic_limit,
        )
        assert report.diagnostics == (
            SQLiteLegacyReconciliationDiagnostic(
                "BLR_LEGACY_APPEND_BINDING",
                diagnostic_limit,
                extra,
            ),
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("diagnostic_limit", [None, True, 0, 65, 1.5, "16"])
def test_invalid_limit_fails_before_campaign_begin(diagnostic_limit: object) -> None:
    connection, summary, stage, identity = _prepare_legacy()
    try:
        with pytest.raises(ValueError, match="outside bounds"):
            SQLiteV1LegacyInvariantCampaign(
                summary,
                identity,
                stage,
                diagnostic_limit=diagnostic_limit,
            )
        assert not stage._legacy_campaign_started
        assert stage.state == "open"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("invalid_argument", ["summary", "identity", "stage"])
def test_invalid_owner_types_fail_before_campaign_begin(invalid_argument: str) -> None:
    connection, summary, stage, identity = _prepare_legacy()
    invalid_summary = (
        cast(SQLiteV1BaselineSourceSummary, object()) if invalid_argument == "summary" else summary
    )
    invalid_identity = (
        cast(BaselineProjectionIdentity, object()) if invalid_argument == "identity" else identity
    )
    invalid_stage = (
        cast(SQLiteV1BaselineTempStage, object()) if invalid_argument == "stage" else stage
    )
    try:
        with pytest.raises(TypeError, match="wrong type"):
            SQLiteV1LegacyInvariantCampaign(
                invalid_summary,
                invalid_identity,
                invalid_stage,
            )
        assert not stage._legacy_campaign_started
        assert stage.state == "open"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("replacement", ["table", "index"])
def test_temp_catalog_replacement_during_cursor_creation_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
    replacement: str,
) -> None:
    connection, summary, stage, identity = _prepare_legacy()
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    target_close_count = 0
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal injected, target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_LEGACY_RULES[0].sql and not injected:
            target = cursor
            injected = True
            if replacement == "table":
                dropped = original_execute(owner, "DROP TABLE temp.ge_blr_holds")
                original_close(dropped)
                recreated = original_execute(
                    owner,
                    "CREATE TEMP TABLE ge_blr_holds (hostile INTEGER)",
                )
                original_close(recreated)
            else:
                dropped = original_execute(
                    owner,
                    "DROP INDEX temp.ge_blr_records_tenant_hash_uidx",
                )
                original_close(dropped)
                recreated = original_execute(
                    owner,
                    "CREATE UNIQUE INDEX ge_blr_records_tenant_hash_uidx "
                    "ON ge_blr_records (tenant_id, stream_id, sequence)",
                )
                original_close(recreated)
        return cursor

    def close(cursor: _SQLiteCursorCapability) -> None:
        nonlocal target_close_count
        if cursor is target:
            target_close_count += 1
        original_close(cursor)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError, match=r"TRANSACTION_CHANGED|CATALOG"):
            campaign.run()
        assert injected
        assert target is not None
        assert target_close_count == 1
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_transaction_end_is_terminal() -> None:
    connection, summary, stage, identity = _prepare_legacy()
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    try:
        connection.commit()
        with pytest.raises(
            ValueError,
            match=r"EXCLUSIVE_TRANSACTION_REQUIRED|TRANSACTION_CHANGED",
        ):
            campaign.run()
        assert campaign.state == "poisoned"
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_stage_dispose_finalizes_active_cursor_exactly_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_legacy()
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    cursor = connection.execute(SQLITE_LEGACY_RULES[0].sql, (17,))
    stage._register_legacy_campaign_cursor(
        campaign._session,
        cursor,
        campaign._expected_total_changes,
    )
    original_close = _SQLiteCursorCapability.close
    close_count = 0

    def close(cursor_value: _SQLiteCursorCapability) -> None:
        nonlocal close_count
        if cursor_value is cursor:
            close_count += 1
        original_close(cursor_value)

    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        stage.dispose()
        assert close_count == 1
        assert stage.state == "disposed"
        assert campaign.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


def test_active_cursor_close_failure_surfaces_after_temp_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_legacy()
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    cursor = connection.execute(SQLITE_LEGACY_RULES[0].sql, (17,))
    stage._register_legacy_campaign_cursor(
        campaign._session,
        cursor,
        campaign._expected_total_changes,
    )
    original_close = _SQLiteCursorCapability.close
    close_count = 0

    def close(cursor_value: _SQLiteCursorCapability) -> None:
        nonlocal close_count
        original_close(cursor_value)
        if cursor_value is cursor:
            close_count += 1
            raise RuntimeError("hostile active cursor close")

    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError, match="STAGE_ITERATOR_INCOMPLETE"):
            stage.dispose()
        assert close_count == 1
        residue = connection.execute(
            "SELECT count(*) FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_'"
        )
        try:
            assert residue.fetchone() == (0,)
        finally:
            residue.close()
    finally:
        connection.rollback()
        connection.close()


@pytest.mark.parametrize("failure", ["close-only", "fetch-and-close"])
def test_cursor_failure_precedence_and_single_close(
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    connection, summary, stage, identity = _prepare_legacy()
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    close_count = 0

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_LEGACY_RULES[0].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        if failure == "fetch-and-close" and cursor is target:
            raise RuntimeError("authoritative hostile fetch")
        return original_fetchone(cursor)

    def close(cursor: _SQLiteCursorCapability) -> None:
        nonlocal close_count
        original_close(cursor)
        if cursor is target:
            close_count += 1
            raise RuntimeError("secondary hostile close")

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError) as raised:
            campaign.run()
        assert str(raised.value) == ("BLR_LEGACY_INVENTORY: legacy rule execution failed")
        assert "close" not in str(raised.value)
        assert close_count == 1
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def _populate_exact_shape_shadow(
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    cursor = connection.execute(
        "SELECT sql FROM main.sqlite_schema WHERE type = 'table' AND name = 'ge_cycle_operations'"
    )
    try:
        row = cursor.fetchone()
    finally:
        cursor.close()
    assert row is not None and type(row[0]) is str
    connection.execute(row[0].replace("ge_cycle_operations", "ge_cycle_operations_shadow")).close()
    connection.execute(
        """INSERT INTO main.ge_cycle_operations_shadow
           (tenant_id, operation_id, operation_name, request_hash,
            result_blob, result_hash, committed_at_ms)
           SELECT tenant_id, operation_id, operation_name, request_hash,
                  zeroblob(length(result_blob)), result_hash, committed_at_ms
             FROM main.ge_cycle_operations"""
    ).close()
    connection.commit()


def test_exact_shape_main_blob_swap_during_active_cursor_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_legacy(_populate_exact_shape_shadow)
    campaign = SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    target_close_count = 0
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_LEGACY_RULES[0].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        nonlocal injected
        row = original_fetchone(cursor)
        if cursor is target and not injected:
            injected = True
            total_changes = connection.total_changes
            first = original_execute(
                connection,
                "ALTER TABLE main.ge_cycle_operations RENAME TO old_operations",
            )
            original_close(first)
            second = original_execute(
                connection,
                "ALTER TABLE main.ge_cycle_operations_shadow RENAME TO ge_cycle_operations",
            )
            original_close(second)
            assert connection.total_changes == total_changes
        return row

    def close(cursor: _SQLiteCursorCapability) -> None:
        nonlocal target_close_count
        if cursor is target:
            target_close_count += 1
        original_close(cursor)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError, match="BLR_LEGACY_INVENTORY"):
            campaign.run()
        assert injected
        assert target_close_count == 1
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)
