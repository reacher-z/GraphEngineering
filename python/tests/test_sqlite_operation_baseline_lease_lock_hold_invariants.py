from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import FrozenInstanceError, replace

import pytest

import graph_engineering.sqlite_operation_baseline_lease_lock_hold_invariants as campaign_module
from graph_engineering.sqlite_operation_baseline import BaselineProjectionIdentity
from graph_engineering.sqlite_operation_baseline_checkpoint_invariants import (
    run_sqlite_v1_checkpoint_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_cooperation import (
    _stream_sqlite_v1_baseline_source_into_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_handoff import (
    _project_ordered_sqlite_v1_baseline_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_lease_lock_hold_invariants import (
    SQLITE_LEASE_LOCK_HOLD_RULES,
    SQLiteLeaseLockHoldCampaignReport,
    SQLiteLeaseLockHoldReconciliationDiagnostic,
    SQLiteLeaseLockHoldRuleId,
    SQLiteV1LeaseLockHoldInvariantCampaign,
    run_sqlite_v1_lease_lock_hold_invariant_campaign,
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
    run_sqlite_v1_stream_record_invariant_campaign,
)
from tests.test_sqlite_operation_baseline_checkpoint_invariants import (
    SHARED_NOW,
    _cleanup,
    _insert_stream_record,
    _normalize_shared_base_clocks,
    _prepare,
)
from tests.test_sqlite_operation_baseline_source import database

Populate = Callable[[SQLiteV1BaselineConnectionOwner], None]
ACQUIRED_AT = SHARED_NOW - 100
EXPIRES_AT = SHARED_NOW + 100
LOCK_ACQUIRED_AT = SHARED_NOW - 200
LOCK_EXPIRES_AT = SHARED_NOW + 200


def _insert_lease(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    stream_id: str,
    *,
    last_epoch: int,
    active_lease_id: str | None = None,
    active_holder_id: str | None = None,
    acquired_at_ms: int | None = None,
    expires_at_ms: int | None = None,
) -> None:
    active = active_lease_id is not None
    connection.execute(
        """INSERT INTO ge_cycle_leases
           (tenant_id, stream_id, active_lease_id, active_holder_id,
            active_lease_epoch, active_fencing_token, active_acquired_at_ms,
            active_expires_at_ms, last_lease_epoch, last_fencing_token,
            updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tenant_id,
            stream_id,
            active_lease_id,
            active_holder_id,
            last_epoch if active else None,
            last_epoch if active else None,
            acquired_at_ms if active else None,
            expires_at_ms if active else None,
            last_epoch,
            last_epoch,
            SHARED_NOW,
        ),
    ).close()


def _insert_used_lease(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    stream_id: str,
    lease_id: str,
    epoch: int,
    *,
    first_used_at_ms: int = ACQUIRED_AT,
) -> None:
    connection.execute(
        """INSERT INTO ge_cycle_used_lease_ids
           (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
            first_used_at_ms) VALUES (?, ?, ?, ?, ?, ?)""",
        (tenant_id, stream_id, lease_id, epoch, epoch, first_used_at_ms),
    ).close()


def _insert_hold(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    stream_id: str,
    hold_id: str,
) -> None:
    connection.execute(
        """INSERT INTO ge_cycle_legal_holds
           (tenant_id, stream_id, hold_id, placed_at_ms) VALUES (?, ?, ?, ?)""",
        (tenant_id, stream_id, hold_id, SHARED_NOW),
    ).close()


def _insert_domain_stream(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    stream_id: str,
) -> None:
    _insert_stream_record(connection, tenant_id, stream_id, f"record-{stream_id}-0")


def _populate_shared_hostile_relations(
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    connection.execute("PRAGMA foreign_keys = OFF").close()

    _insert_domain_stream(connection, "tenant-foreign", "stream-orphan")
    _insert_lease(
        connection,
        "tenant-lease-orphan",
        "stream-orphan",
        last_epoch=0,
    )
    _insert_hold(
        connection,
        "tenant-hold-orphan",
        "stream-orphan",
        "hold-orphan",
    )

    _insert_domain_stream(connection, "tenant-start", "stream-start")
    _insert_lease(connection, "tenant-start", "stream-start", last_epoch=2)
    _insert_used_lease(
        connection,
        "tenant-start",
        "stream-start",
        "lease-start-2",
        2,
    )

    _insert_domain_stream(connection, "tenant-interior", "stream-interior")
    _insert_lease(connection, "tenant-interior", "stream-interior", last_epoch=3)
    _insert_used_lease(
        connection,
        "tenant-interior",
        "stream-interior",
        "lease-interior-1",
        1,
    )
    _insert_used_lease(
        connection,
        "tenant-interior",
        "stream-interior",
        "lease-interior-3",
        3,
    )

    _insert_domain_stream(connection, "tenant-extra", "stream-extra")
    _insert_lease(connection, "tenant-extra", "stream-extra", last_epoch=2)
    for epoch in (1, 2, 3):
        _insert_used_lease(
            connection,
            "tenant-extra",
            "stream-extra",
            f"lease-extra-{epoch}",
            epoch,
        )

    _insert_domain_stream(connection, "tenant-active-id", "stream-active-id")
    _insert_lease(
        connection,
        "tenant-active-id",
        "stream-active-id",
        last_epoch=1,
        active_lease_id="lease-active-wrong",
        active_holder_id="holder-active-id",
        acquired_at_ms=ACQUIRED_AT,
        expires_at_ms=EXPIRES_AT,
    )
    _insert_used_lease(
        connection,
        "tenant-active-id",
        "stream-active-id",
        "lease-active-terminal",
        1,
    )

    _insert_domain_stream(connection, "tenant-active-clock", "stream-active-clock")
    _insert_lease(
        connection,
        "tenant-active-clock",
        "stream-active-clock",
        last_epoch=1,
        active_lease_id="lease-active-clock",
        active_holder_id="holder-active-clock",
        acquired_at_ms=ACQUIRED_AT,
        expires_at_ms=EXPIRES_AT,
    )
    _insert_used_lease(
        connection,
        "tenant-active-clock",
        "stream-active-clock",
        "lease-active-clock",
        1,
        first_used_at_ms=ACQUIRED_AT - 1,
    )

    _insert_domain_stream(connection, "tenant-zero", "stream-zero")
    _insert_lease(connection, "tenant-zero", "stream-zero", last_epoch=0)

    _insert_domain_stream(connection, "tenant-retired", "stream-retired")
    _insert_lease(connection, "tenant-retired", "stream-retired", last_epoch=2)
    for epoch in (1, 2):
        _insert_used_lease(
            connection,
            "tenant-retired",
            "stream-retired",
            f"lease-retired-{epoch}",
            epoch,
        )

    _insert_domain_stream(connection, "tenant-active-valid", "stream-active-valid")
    _insert_lease(
        connection,
        "tenant-active-valid",
        "stream-active-valid",
        last_epoch=1,
        active_lease_id="lease-active-valid",
        active_holder_id="holder-active-valid",
        acquired_at_ms=ACQUIRED_AT,
        expires_at_ms=EXPIRES_AT,
    )
    _insert_used_lease(
        connection,
        "tenant-active-valid",
        "stream-active-valid",
        "lease-active-valid",
        1,
    )

    _insert_hold(
        connection,
        "tenant-active-clock",
        "stream-active-clock",
        "hold-valid-a",
    )
    _insert_hold(
        connection,
        "tenant-active-clock",
        "stream-active-clock",
        "hold-valid-b",
    )

    connection.execute(
        """UPDATE ge_cycle_migration_lock
              SET active_lock_id = ?, active_owner_id = ?,
                  active_source_version = 1, active_target_version = 2,
                  active_lock_epoch = 3, active_fencing_token = 3,
                  active_acquired_at_ms = ?, active_expires_at_ms = ?,
                  last_lock_epoch = 3, last_fencing_token = 3,
                  updated_at_ms = ?
            WHERE singleton = 1""",
        (
            "lock-active-wrong",
            "owner-active",
            LOCK_ACQUIRED_AT,
            LOCK_EXPIRES_AT,
            SHARED_NOW,
        ),
    ).close()
    for lock_id, epoch, first_used_at_ms in (
        ("lock-history-2", 2, LOCK_ACQUIRED_AT - 1),
        ("lock-terminal-3", 3, LOCK_ACQUIRED_AT - 1),
    ):
        connection.execute(
            """INSERT INTO ge_cycle_used_migration_lock_ids
               (lock_id, lock_epoch, fencing_token, first_used_at_ms)
               VALUES (?, ?, ?, ?)""",
            (lock_id, epoch, epoch, first_used_at_ms),
        ).close()

    _normalize_shared_base_clocks(connection)
    connection.commit()


def _prepare_campaign(
    populate: Populate | None = None,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    SQLiteV1BaselineTempStage,
    BaselineProjectionIdentity,
]:
    connection, summary, stage, identity = _prepare(
        populate,
        captured_at_ms=SHARED_NOW if populate is not None else 1_000,
    )
    checkpoint_report = run_sqlite_v1_checkpoint_invariant_campaign(
        summary,
        identity,
        stage,
    )
    assert checkpoint_report.diagnostics == ()
    return connection, summary, stage, identity


def test_pristine_campaign_is_empty_frozen_and_exactly_identity_bound() -> None:
    connection, summary, stage, identity = _prepare_campaign()
    try:
        report = run_sqlite_v1_lease_lock_hold_invariant_campaign(
            summary,
            identity,
            stage,
        )
        assert report == SQLiteLeaseLockHoldCampaignReport(identity, ())
        assert report.projection_identity is identity
        assert stage._lease_lock_hold_campaign_completed
        with pytest.raises(FrozenInstanceError):
            report.diagnostics = ()  # type: ignore[misc]
    finally:
        _cleanup(connection, stage)


def test_shared_hostile_fixture_reports_exact_rule_order_and_counts() -> None:
    connection, summary, stage, identity = _prepare_campaign(
        _populate_shared_hostile_relations
    )
    try:
        report = run_sqlite_v1_lease_lock_hold_invariant_campaign(
            summary,
            identity,
            stage,
        )
        assert report.projection_identity == BaselineProjectionIdentity(
            baseline_id=(
                "v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af"
            ),
            entry_count=46,
            legacy_operation_count=0,
            first_entry_hash=(
                "f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c"
            ),
            final_entry_hash=(
                "6b929039b709ef0a09818896df9d0366564389219e7fbec1866648bd67684638"
            ),
            projection_sha256=(
                "ebc3aab7adc7062aee8067e2bbada04d14f0502802f1241dd62b2a790eb9e755"
            ),
        )
        assert report.projection_identity is identity
        assert report.diagnostics == (
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_LEASE_STREAM_MISSING", 1, False
            ),
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_LEASE_HISTORY_INCOMPLETE", 3, False
            ),
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_LEASE_ACTIVE_BINDING", 2, False
            ),
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE", 1, False
            ),
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_MIGRATION_LOCK_ACTIVE_BINDING", 1, False
            ),
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_HOLD_STREAM_MISSING", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_rule_registry_is_frozen_ordered_and_marker_only() -> None:
    assert tuple(rule.rule_id for rule in SQLITE_LEASE_LOCK_HOLD_RULES) == (
        "BLR_LEASE_STREAM_MISSING",
        "BLR_LEASE_HISTORY_INCOMPLETE",
        "BLR_LEASE_ACTIVE_BINDING",
        "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE",
        "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
        "BLR_HOLD_STREAM_MISSING",
    )
    for rule in SQLITE_LEASE_LOCK_HOLD_RULES:
        assert "LIMIT ?" in rule.sql
        assert "SELECT 1" in rule.sql
        assert "SELECT *" not in rule.sql
        with pytest.raises(FrozenInstanceError):
            rule.sql = "SELECT 2"  # type: ignore[misc]


def test_every_indexed_rule_has_bounded_named_query_plan() -> None:
    connection, _summary_value, stage, _identity = _prepare_campaign()
    try:
        for rule in SQLITE_LEASE_LOCK_HOLD_RULES:
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
            assert "MATERIALIZE" not in plan, (rule.rule_id, plan)
            assert "AUTOMATIC" not in plan, (rule.rule_id, plan)
            expected_temp_groups = int(rule.rule_id == "BLR_LEASE_HISTORY_INCOMPLETE")
            assert plan.count("USE TEMP B-TREE FOR GROUP BY") == expected_temp_groups
    finally:
        _cleanup(connection, stage)


def _populate_orphan_leases(
    connection: SQLiteV1BaselineConnectionOwner,
    count: int,
) -> None:
    connection.execute("PRAGMA foreign_keys = OFF").close()
    _insert_domain_stream(connection, "tenant-foreign", "stream-limit")
    for index in range(count):
        _insert_lease(
            connection,
            f"tenant-limit-{index:03d}",
            "stream-limit",
            last_epoch=0,
        )
    _normalize_shared_base_clocks(connection)
    connection.commit()


@pytest.mark.parametrize("diagnostic_limit", [1, 16, 64])
@pytest.mark.parametrize("extra", [False, True], ids=["exact-limit", "limit-plus-one"])
def test_exact_diagnostic_limit_boundary(
    diagnostic_limit: int,
    extra: bool,
) -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        _populate_orphan_leases(connection, diagnostic_limit + int(extra))

    connection, summary, stage, identity = _prepare_campaign(populate)
    try:
        report = run_sqlite_v1_lease_lock_hold_invariant_campaign(
            summary,
            identity,
            stage,
            diagnostic_limit=diagnostic_limit,
        )
        assert report.diagnostics == (
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_LEASE_STREAM_MISSING",
                diagnostic_limit,
                extra,
            ),
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("diagnostic_limit", [None, True, 0, 65, 1.5, "16"])
def test_invalid_limit_fails_before_campaign_begin(diagnostic_limit: object) -> None:
    connection, summary, stage, identity = _prepare_campaign()
    try:
        with pytest.raises(ValueError, match="outside bounds"):
            SQLiteV1LeaseLockHoldInvariantCampaign(
                summary,
                identity,
                stage,
                diagnostic_limit=diagnostic_limit,
            )
        assert not stage._lease_lock_hold_campaign_started
        assert stage.state == "open"
    finally:
        _cleanup(connection, stage)


def test_campaign_requires_completed_checkpoint_campaign() -> None:
    connection, summary, stage, identity = _prepare()
    try:
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_equal_projection_replacement_and_second_run_are_terminal() -> None:
    connection, summary, stage, identity = _prepare_campaign()
    try:
        replacement = replace(identity)
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            SQLiteV1LeaseLockHoldInvariantCampaign(summary, replacement, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)

    connection, summary, stage, identity = _prepare_campaign()
    try:
        campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
        campaign.run()
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            campaign.run()
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_abandonment_is_terminal() -> None:
    connection, summary, stage, identity = _prepare_campaign()
    try:
        campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            campaign.dispose()
        assert campaign.state == "poisoned"
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "rule", SQLITE_LEASE_LOCK_HOLD_RULES, ids=lambda rule: rule.rule_id
)
def test_dml_after_each_rule_cursor_creation_is_rejected_and_cursor_is_closed(
    monkeypatch: pytest.MonkeyPatch,
    rule: object,
) -> None:
    checked_rule = rule
    assert hasattr(checked_rule, "sql")
    target_sql = checked_rule.sql
    connection, summary, stage, identity = _prepare_campaign()
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
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
    connection, summary, stage, identity = _prepare_campaign()
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
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
        if target is None and sql == SQLITE_LEASE_LOCK_HOLD_RULES[0].sql:
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
        original_run_rule = SQLiteV1LeaseLockHoldInvariantCampaign._run_rule

        def run_rule(
            campaign_value: SQLiteV1LeaseLockHoldInvariantCampaign,
            rule_value: object,
        ) -> int:
            observed = original_run_rule(campaign_value, rule_value)  # type: ignore[arg-type]
            inject()
            return observed

        monkeypatch.setattr(SQLiteV1LeaseLockHoldInvariantCampaign, "_run_rule", run_rule)
    if boundary == "terminal":
        original_complete = SQLiteV1BaselineTempStage._complete_lease_lock_hold_campaign

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
            "_complete_lease_lock_hold_campaign",
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
    connection, summary, stage, identity = _prepare_campaign()
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
    cursor = connection.execute(SQLITE_LEASE_LOCK_HOLD_RULES[0].sql, (17,))
    stage._register_lease_lock_hold_campaign_cursor(
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
    connection, summary, stage, identity = _prepare_campaign()
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
    cursor = connection.execute(SQLITE_LEASE_LOCK_HOLD_RULES[0].sql, (17,))
    stage._register_lease_lock_hold_campaign_cursor(
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
    connection, summary, stage, identity = _prepare_campaign()
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
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
        if sql == SQLITE_LEASE_LOCK_HOLD_RULES[0].sql:
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
        assert str(raised.value).startswith("BLR_LEASE_STREAM_MISSING:")
        assert "close" not in str(raised.value)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_malformed_witness_marker_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_campaign()
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if sql == SQLITE_LEASE_LOCK_HOLD_RULES[0].sql:
            return original_execute(owner, "SELECT 2")
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    try:
        with pytest.raises(ValueError) as raised:
            run_sqlite_v1_lease_lock_hold_invariant_campaign(summary, identity, stage)
        assert str(raised.value).startswith("BLR_LEASE_STREAM_MISSING:")
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_catalog_replacement_during_rule_fetch_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_campaign()
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
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
        if sql == SQLITE_LEASE_LOCK_HOLD_RULES[1].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        nonlocal injected
        row = original_fetchone(cursor)
        if cursor is target and not injected:
            injected = True
            replacement = original_execute(
                connection,
                "DROP INDEX temp.ge_blr_used_leases_epoch_uidx",
            )
            replacement.close()
        return row

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    try:
        with pytest.raises(
            ValueError,
            match=r"TRANSACTION_CHANGED|CATALOG|rule execution failed",
        ):
            campaign.run()
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_dml_immediately_after_diagnostic_construction_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_campaign(
        _populate_shared_hostile_relations
    )
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_close = _SQLiteCursorCapability.close
    original_diagnostic = SQLiteLeaseLockHoldReconciliationDiagnostic
    injected = False

    def diagnostic(
        rule_id: SQLiteLeaseLockHoldRuleId,
        violation_count: int,
        diagnostics_truncated: bool,
    ) -> SQLiteLeaseLockHoldReconciliationDiagnostic:
        nonlocal injected
        value = original_diagnostic(
            rule_id,
            violation_count,
            diagnostics_truncated,
        )
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
        "SQLiteLeaseLockHoldReconciliationDiagnostic",
        diagnostic,
    )
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            run_sqlite_v1_lease_lock_hold_invariant_campaign(summary, identity, stage)
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_cursor_close_only_failure_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_campaign()
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_LEASE_LOCK_HOLD_RULES[0].sql:
            target = cursor
        return cursor

    def close(cursor: _SQLiteCursorCapability) -> None:
        original_close(cursor)
        if cursor is target:
            raise RuntimeError("hostile close only")

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError) as raised:
            campaign.run()
        assert str(raised.value).startswith("BLR_LEASE_STREAM_MISSING:")
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("table", "predicate"),
    [
        ("ge_blr_stage", "kind_rank = 6"),
        ("ge_blr_leases", "1 = 1"),
        ("ge_blr_stage", "kind_rank = 7"),
        ("ge_blr_used_leases", "1 = 1"),
        ("ge_blr_stage", "kind_rank = 8"),
        ("ge_blr_holds", "1 = 1"),
        ("ge_blr_stage", "kind_rank = 9"),
        ("ge_blr_migration_lock", "1 = 1"),
        ("ge_blr_stage", "kind_rank = 10"),
        ("ge_blr_used_migration_locks", "1 = 1"),
    ],
)
def test_common_relation_disagreement_cannot_enter_campaign(
    table: str,
    predicate: str,
) -> None:
    connection, summary, stage, identity = _prepare_campaign(
        _populate_shared_hostile_relations
    )
    try:
        connection.execute(f"DELETE FROM temp.{table} WHERE {predicate}").close()
        stage._allowed_total_changes = connection.total_changes
        with pytest.raises(ValueError, match=r"STAGE_(COUNT|KEY_COVERAGE)"):
            run_sqlite_v1_lease_lock_hold_invariant_campaign(summary, identity, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def _populate_valid_relations(connection: SQLiteV1BaselineConnectionOwner) -> None:
    _insert_domain_stream(connection, "tenant-valid", "stream-valid")
    _insert_lease(
        connection,
        "tenant-valid",
        "stream-valid",
        last_epoch=1,
        active_lease_id="lease-valid",
        active_holder_id="holder-valid",
        acquired_at_ms=ACQUIRED_AT,
        expires_at_ms=EXPIRES_AT,
    )
    _insert_used_lease(
        connection,
        "tenant-valid",
        "stream-valid",
        "lease-valid",
        1,
    )
    _insert_hold(connection, "tenant-valid", "stream-valid", "hold-valid")
    connection.execute(
        """UPDATE ge_cycle_migration_lock
              SET active_lock_id = 'lock-valid', active_owner_id = 'owner-valid',
                  active_source_version = 1, active_target_version = 2,
                  active_lock_epoch = 1, active_fencing_token = 1,
                  active_acquired_at_ms = ?, active_expires_at_ms = ?,
                  last_lock_epoch = 1, last_fencing_token = 1,
                  updated_at_ms = ?
            WHERE singleton = 1""",
        (LOCK_ACQUIRED_AT, LOCK_EXPIRES_AT, SHARED_NOW),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_used_migration_lock_ids
           (lock_id, lock_epoch, fencing_token, first_used_at_ms)
           VALUES ('lock-valid', 1, 1, ?)""",
        (LOCK_ACQUIRED_AT,),
    ).close()
    _normalize_shared_base_clocks(connection)
    connection.commit()


def _rule(rule_id: str) -> object:
    return next(rule for rule in SQLITE_LEASE_LOCK_HOLD_RULES if rule.rule_id == rule_id)


def _rule_witness_count(
    connection: SQLiteV1BaselineConnectionOwner,
    rule_id: str,
) -> int:
    checked = _rule(rule_id)
    assert hasattr(checked, "sql")
    cursor = connection.execute(checked.sql, (65,))
    count = 0
    try:
        while cursor.fetchone() is not None:
            count += 1
    finally:
        cursor.close()
    return count


@pytest.mark.parametrize(
    ("kind_rank", "field", "rule_id"),
    [
        *[
            (6, field, "BLR_LEASE_ACTIVE_BINDING")
            for field in (
                "activeAcquiredAtMs",
                "activeExpiresAtMs",
                "activeFencingToken",
                "activeHolderId",
                "activeLeaseEpoch",
                "activeLeaseId",
                "lastFencingToken",
                "lastLeaseEpoch",
                "streamId",
                "tenantId",
                "updatedAtMs",
            )
        ],
        *[
            (7, field, "BLR_LEASE_HISTORY_INCOMPLETE")
            for field in (
                "fencingToken",
                "firstUsedAtMs",
                "leaseEpoch",
                "leaseId",
                "streamId",
                "tenantId",
            )
        ],
        *[
            (8, field, "BLR_HOLD_STREAM_MISSING")
            for field in ("holdId", "placedAtMs", "streamId", "tenantId")
        ],
        *[
            (9, field, "BLR_MIGRATION_LOCK_ACTIVE_BINDING")
            for field in (
                "activeAcquiredAtMs",
                "activeExpiresAtMs",
                "activeFencingToken",
                "activeLockEpoch",
                "activeLockId",
                "activeOwnerId",
                "activeSourceVersion",
                "activeTargetVersion",
                "lastFencingToken",
                "lastLockEpoch",
                "singleton",
                "updatedAtMs",
            )
        ],
        *[
            (10, field, "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE")
            for field in ("fencingToken", "firstUsedAtMs", "lockEpoch", "lockId")
        ],
    ],
)
def test_every_canonical_state_field_substitution_is_detected_by_real_sql(
    kind_rank: int,
    field: str,
    rule_id: str,
) -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(
                    json_set(CAST(state_blob AS TEXT), ?, 'hostile') AS BLOB
                  )
                WHERE kind_rank = ?""",
            (f"$.{field}", kind_rank),
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, rule_id) == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("relation_table", "common_rank", "id_column", "active_rule"),
    [
        (
            "ge_blr_used_leases",
            7,
            "first_used_at_ms",
            "BLR_LEASE_ACTIVE_BINDING",
        ),
        (
            "ge_blr_used_migration_locks",
            10,
            "first_used_at_ms",
            "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
        ),
    ],
)
def test_active_terminal_first_use_clock_is_bound_across_relations(
    relation_table: str,
    common_rank: int,
    id_column: str,
    active_rule: str,
) -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        connection.execute(
            f"UPDATE temp.{relation_table} SET {id_column} = {id_column} - 1"
        ).close()
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(json_set(
                    CAST(state_blob AS TEXT), '$.firstUsedAtMs',
                    json_extract(CAST(state_blob AS TEXT), '$.firstUsedAtMs') - 1
                  ) AS BLOB)
                WHERE kind_rank = ?""",
            (common_rank,),
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, active_rule) == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("table", "rank", "column", "json_field", "rule_id"),
    [
        (
            "ge_blr_leases",
            6,
            "active_holder_id",
            "activeHolderId",
            "BLR_LEASE_ACTIVE_BINDING",
        ),
        (
            "ge_blr_migration_lock",
            9,
            "active_owner_id",
            "activeOwnerId",
            "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
        ),
    ],
)
def test_inactive_null_tuple_drift_is_detected_when_common_drifts_with_relation(
    table: str,
    rank: int,
    column: str,
    json_field: str,
    rule_id: str,
) -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        _insert_domain_stream(connection, "tenant-inactive", "stream-inactive")
        _insert_lease(
            connection,
            "tenant-inactive",
            "stream-inactive",
            last_epoch=0,
        )
        _normalize_shared_base_clocks(connection)
        connection.commit()

    connection, _summary, stage, _identity = _prepare_campaign(populate)
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        connection.execute(f"UPDATE temp.{table} SET {column} = 'hostile'").close()
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(
                    json_set(CAST(state_blob AS TEXT), ?, 'hostile') AS BLOB
                  )
                WHERE kind_rank = ?""",
            (f"$.{json_field}", rank),
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, rule_id) == 1
    finally:
        _cleanup(connection, stage)


def test_version_reversal_is_detected_when_lock_common_drifts_with_relation() -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        connection.execute(
            "UPDATE temp.ge_blr_migration_lock SET active_target_version = 1"
        ).close()
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(
                    json_set(CAST(state_blob AS TEXT), '$.activeTargetVersion', 1)
                    AS BLOB
                  )
                WHERE kind_rank = 9"""
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert (
            _rule_witness_count(connection, "BLR_MIGRATION_LOCK_ACTIVE_BINDING")
            == 1
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("table", "rank", "acquired_column", "expires_column", "rule_id"),
    [
        (
            "ge_blr_leases",
            6,
            "active_acquired_at_ms",
            "active_expires_at_ms",
            "BLR_LEASE_ACTIVE_BINDING",
        ),
        (
            "ge_blr_migration_lock",
            9,
            "active_acquired_at_ms",
            "active_expires_at_ms",
            "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
        ),
    ],
)
def test_expiry_order_is_defended_when_common_drifts_with_relation(
    table: str,
    rank: int,
    acquired_column: str,
    expires_column: str,
    rule_id: str,
) -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        connection.execute(
            f"UPDATE temp.{table} SET {expires_column} = {acquired_column}"
        ).close()
        json_field = "activeExpiresAtMs"
        acquired_field = "activeAcquiredAtMs"
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(json_set(
                    CAST(state_blob AS TEXT), ?,
                    json_extract(CAST(state_blob AS TEXT), ?)
                  ) AS BLOB)
                WHERE kind_rank = ?""",
            (f"$.{json_field}", f"$.{acquired_field}", rank),
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, rule_id) == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("table", "rank", "epoch_column", "fence_column", "rule_id"),
    [
        (
            "ge_blr_leases",
            6,
            "last_lease_epoch",
            "last_fencing_token",
            "BLR_LEASE_ACTIVE_BINDING",
        ),
        (
            "ge_blr_migration_lock",
            9,
            "last_lock_epoch",
            "last_fencing_token",
            "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
        ),
    ],
)
def test_negative_high_water_is_defended_when_common_drifts_with_relation(
    table: str,
    rank: int,
    epoch_column: str,
    fence_column: str,
    rule_id: str,
) -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        connection.execute(
            f"UPDATE temp.{table} SET {epoch_column} = -1, {fence_column} = -1"
        ).close()
        epoch_field = "lastLeaseEpoch" if rank == 6 else "lastLockEpoch"
        fence_field = "lastFencingToken"
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(json_set(
                    CAST(state_blob AS TEXT), ?, -1, ?, -1
                  ) AS BLOB)
                WHERE kind_rank = ?""",
            (f"$.{epoch_field}", f"$.{fence_field}", rank),
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, rule_id) == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("kind_rank", "key_field", "rule_id"),
    [
        (6, "tenantId", "BLR_LEASE_ACTIVE_BINDING"),
        (6, "streamId", "BLR_LEASE_ACTIVE_BINDING"),
        (7, "tenantId", "BLR_LEASE_HISTORY_INCOMPLETE"),
        (7, "streamId", "BLR_LEASE_HISTORY_INCOMPLETE"),
        (7, "leaseId", "BLR_LEASE_HISTORY_INCOMPLETE"),
        (8, "tenantId", "BLR_HOLD_STREAM_MISSING"),
        (8, "streamId", "BLR_HOLD_STREAM_MISSING"),
        (8, "holdId", "BLR_HOLD_STREAM_MISSING"),
        (9, "singleton", "BLR_MIGRATION_LOCK_ACTIVE_BINDING"),
        (10, "lockId", "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE"),
    ],
)
def test_every_canonical_key_field_substitution_is_detected_by_real_sql(
    kind_rank: int,
    key_field: str,
    rule_id: str,
) -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET key_blob = CAST(
                    json_set(CAST(key_blob AS TEXT), ?, 'hostile') AS BLOB
                  )
                WHERE kind_rank = ?""",
            (f"$.{key_field}", kind_rank),
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, rule_id) >= 1
    finally:
        _cleanup(connection, stage)


def test_retired_lease_id_cannot_substitute_for_terminal_active_identity() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        _insert_domain_stream(connection, "tenant-retired-id", "stream-retired-id")
        _insert_lease(
            connection,
            "tenant-retired-id",
            "stream-retired-id",
            last_epoch=2,
            active_lease_id="lease-retired-id",
            active_holder_id="holder-retired-id",
            acquired_at_ms=ACQUIRED_AT,
            expires_at_ms=EXPIRES_AT,
        )
        _insert_used_lease(
            connection,
            "tenant-retired-id",
            "stream-retired-id",
            "lease-retired-id",
            1,
        )
        _insert_used_lease(
            connection,
            "tenant-retired-id",
            "stream-retired-id",
            "lease-terminal-id",
            2,
        )
        _normalize_shared_base_clocks(connection)
        connection.commit()

    connection, summary, stage, identity = _prepare_campaign(populate)
    try:
        report = run_sqlite_v1_lease_lock_hold_invariant_campaign(
            summary,
            identity,
            stage,
        )
        assert report.diagnostics == (
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_LEASE_ACTIVE_BINDING", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_duplicate_epoch_and_singleton_candidates_are_physically_rejected() -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO temp.ge_blr_used_leases
                   (key_blob, tenant_id, stream_id, lease_id, lease_epoch,
                    fencing_token, first_used_at_ms)
                   VALUES (x'7b7d', 'tenant-valid', 'stream-valid',
                           'lease-duplicate', 1, 1, 1)"""
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO temp.ge_blr_migration_lock
                   SELECT x'7b7d', singleton, active_lock_id, active_owner_id,
                          active_source_version, active_target_version,
                          active_lock_epoch, active_fencing_token,
                          active_acquired_at_ms, active_expires_at_ms,
                          last_lock_epoch, last_fencing_token, updated_at_ms
                     FROM temp.ge_blr_migration_lock"""
            )
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                """INSERT INTO temp.ge_blr_stage
                   SELECT kind_rank, entry_kind, key_blob, state_blob
                     FROM temp.ge_blr_stage WHERE kind_rank = 9"""
            )
    finally:
        _cleanup(connection, stage)


def test_second_lock_common_candidate_is_rejected_by_predecessor_coverage() -> None:
    connection, summary, stage, identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        connection.execute(
            """INSERT INTO temp.ge_blr_stage
               SELECT kind_rank, entry_kind, x'7b7d', state_blob
                 FROM temp.ge_blr_stage WHERE kind_rank = 9"""
        ).close()
        stage._allowed_total_changes = connection.total_changes
        with pytest.raises(ValueError, match=r"STAGE_(COUNT|KEY_COVERAGE)"):
            run_sqlite_v1_lease_lock_hold_invariant_campaign(summary, identity, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_drop_recreate_catalog_attack_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_campaign(
        _populate_shared_hostile_relations
    )
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_LEASE_LOCK_HOLD_RULES[1].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        nonlocal injected
        row = original_fetchone(cursor)
        if cursor is target and row is not None and not injected:
            injected = True
            dropped = original_execute(
                connection,
                "DROP INDEX temp.ge_blr_used_leases_epoch_uidx",
            )
            original_close(dropped)
            recreated = original_execute(
                connection,
                "CREATE UNIQUE INDEX ge_blr_used_leases_epoch_uidx "
                "ON ge_blr_used_leases (tenant_id, stream_id, lease_id)",
            )
            original_close(recreated)
        return row

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    try:
        with pytest.raises(
            ValueError,
            match=r"TRANSACTION_CHANGED|CATALOG|rule execution failed",
        ):
            campaign.run()
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_empty_stream_is_not_missing_but_is_reported_by_predecessor_campaign() -> None:
    connection = database()
    connection.execute(
        """INSERT INTO ge_cycle_streams
           (tenant_id, stream_id, tail_sequence, tail_record_hash,
            created_at_ms, updated_at_ms)
           VALUES ('tenant-empty', 'stream-empty', -1, NULL, ?, ?)""",
        (SHARED_NOW, SHARED_NOW),
    ).close()
    _insert_lease(connection, "tenant-empty", "stream-empty", last_epoch=0)
    _insert_hold(connection, "tenant-empty", "stream-empty", "hold-empty")
    _normalize_shared_base_clocks(connection)
    connection.commit()
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    summary = capture_sqlite_v1_baseline_source_summary(
        connection,
        captured_at_ms=SHARED_NOW,
    )
    _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
    identity = _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
    try:
        stream_report = run_sqlite_v1_stream_record_invariant_campaign(
            summary,
            identity,
            stage,
        )
        assert tuple(item.rule_id for item in stream_report.diagnostics) == (
            "BLR_STREAM_EMPTY",
        )
        checkpoint_report = run_sqlite_v1_checkpoint_invariant_campaign(
            summary,
            identity,
            stage,
        )
        assert checkpoint_report.diagnostics == ()
        report = run_sqlite_v1_lease_lock_hold_invariant_campaign(
            summary,
            identity,
            stage,
        )
        assert report.diagnostics == ()
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("table", "rank", "column", "json_field", "rule_id"),
    [
        *[
            ("ge_blr_leases", 6, column, json_field, "BLR_LEASE_ACTIVE_BINDING")
            for column, json_field in (
                ("active_lease_id", "activeLeaseId"),
                ("active_holder_id", "activeHolderId"),
                ("active_lease_epoch", "activeLeaseEpoch"),
                ("active_fencing_token", "activeFencingToken"),
                ("active_acquired_at_ms", "activeAcquiredAtMs"),
                ("active_expires_at_ms", "activeExpiresAtMs"),
            )
        ],
        *[
            (
                "ge_blr_migration_lock",
                9,
                column,
                json_field,
                "BLR_MIGRATION_LOCK_ACTIVE_BINDING",
            )
            for column, json_field in (
                ("active_lock_id", "activeLockId"),
                ("active_owner_id", "activeOwnerId"),
                ("active_source_version", "activeSourceVersion"),
                ("active_target_version", "activeTargetVersion"),
                ("active_lock_epoch", "activeLockEpoch"),
                ("active_fencing_token", "activeFencingToken"),
                ("active_acquired_at_ms", "activeAcquiredAtMs"),
                ("active_expires_at_ms", "activeExpiresAtMs"),
            )
        ],
    ],
)
def test_each_active_present_field_rejects_null_with_synchronized_common(
    table: str,
    rank: int,
    column: str,
    json_field: str,
    rule_id: str,
) -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        connection.execute(f"UPDATE temp.{table} SET {column} = NULL").close()
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(json_set(
                    CAST(state_blob AS TEXT), ?, json('null')
                  ) AS BLOB)
                WHERE kind_rank = ?""",
            (f"$.{json_field}", rank),
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, rule_id) == 1
    finally:
        _cleanup(connection, stage)


def test_retired_lock_id_cannot_substitute_for_terminal_active_identity() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        connection.execute(
            """UPDATE ge_cycle_migration_lock
                  SET active_lock_id = 'lock-retired',
                      active_owner_id = 'owner-retired',
                      active_source_version = 1, active_target_version = 2,
                      active_lock_epoch = 2, active_fencing_token = 2,
                      active_acquired_at_ms = ?, active_expires_at_ms = ?,
                      last_lock_epoch = 2, last_fencing_token = 2,
                      updated_at_ms = ?
                WHERE singleton = 1""",
            (LOCK_ACQUIRED_AT, LOCK_EXPIRES_AT, SHARED_NOW),
        ).close()
        for lock_id, epoch in (("lock-retired", 1), ("lock-terminal", 2)):
            connection.execute(
                """INSERT INTO ge_cycle_used_migration_lock_ids
                   (lock_id, lock_epoch, fencing_token, first_used_at_ms)
                   VALUES (?, ?, ?, ?)""",
                (lock_id, epoch, epoch, LOCK_ACQUIRED_AT),
            ).close()
        _normalize_shared_base_clocks(connection)
        connection.commit()

    connection, summary, stage, identity = _prepare_campaign(populate)
    try:
        report = run_sqlite_v1_lease_lock_hold_invariant_campaign(
            summary,
            identity,
            stage,
        )
        assert report.diagnostics == (
            SQLiteLeaseLockHoldReconciliationDiagnostic(
                "BLR_MIGRATION_LOCK_ACTIVE_BINDING", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_table_drop_recreate_at_cursor_creation_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare_campaign(
        _populate_valid_relations
    )
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_close = _SQLiteCursorCapability.close
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal injected
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_LEASE_LOCK_HOLD_RULES[0].sql and not injected:
            injected = True
            dropped = original_execute(owner, "DROP TABLE temp.ge_blr_holds")
            original_close(dropped)
            recreated = original_execute(
                owner,
                "CREATE TEMP TABLE ge_blr_holds (hostile INTEGER)",
            )
            original_close(recreated)
        return cursor

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    try:
        with pytest.raises(ValueError, match=r"TRANSACTION_CHANGED|CATALOG"):
            campaign.run()
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_multiple_used_binding_anomalies_in_one_lease_domain_collapse_to_one() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        _insert_domain_stream(connection, "tenant-domain", "stream-domain")
        _insert_lease(connection, "tenant-domain", "stream-domain", last_epoch=2)
        _insert_used_lease(
            connection, "tenant-domain", "stream-domain", "lease-domain-1", 1
        )
        _insert_used_lease(
            connection, "tenant-domain", "stream-domain", "lease-domain-2", 2
        )
        _normalize_shared_base_clocks(connection)
        connection.commit()

    connection, _summary, stage, _identity = _prepare_campaign(populate)
    try:
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(
                    json_set(CAST(state_blob AS TEXT), '$.firstUsedAtMs', 1) AS BLOB
                  )
                WHERE kind_rank = 7"""
        ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, "BLR_LEASE_HISTORY_INCOMPLETE") == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "target_rule_id",
    ["BLR_LEASE_HISTORY_INCOMPLETE", "BLR_LEASE_ACTIVE_BINDING"],
    ids=["grouped-history-observed", "active-row-observed"],
)
def test_dml_after_semantic_witness_observation_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
    target_rule_id: str,
) -> None:
    connection, summary, stage, identity = _prepare_campaign(
        _populate_shared_hostile_relations
    )
    campaign = SQLiteV1LeaseLockHoldInvariantCampaign(summary, identity, stage)
    target_sql = next(
        rule.sql for rule in SQLITE_LEASE_LOCK_HOLD_RULES if rule.rule_id == target_rule_id
    )
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        nonlocal injected
        row = original_fetchone(cursor)
        if cursor is target and row is not None and not injected:
            injected = True
            mutation = original_execute(
                connection,
                "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            )
            original_close(mutation)
        return row

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            campaign.run()
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_campaign_uses_only_single_row_fetches(monkeypatch: pytest.MonkeyPatch) -> None:
    connection, summary, stage, identity = _prepare_campaign(
        _populate_shared_hostile_relations
    )

    def forbidden_fetchmany(
        _cursor: _SQLiteCursorCapability,
        _size: int,
    ) -> list[tuple[object, ...]]:
        raise AssertionError("campaign must fetch exactly one marker row")

    monkeypatch.setattr(_SQLiteCursorCapability, "fetchmany", forbidden_fetchmany)
    try:
        report = run_sqlite_v1_lease_lock_hold_invariant_campaign(
            summary,
            identity,
            stage,
        )
        assert tuple(diagnostic.violation_count for diagnostic in report.diagnostics) == (
            1,
            3,
            2,
            1,
            1,
            1,
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("delete_relation", "delete_common_rank", "rule_id"),
    [
        ("ge_blr_leases", None, "BLR_LEASE_ACTIVE_BINDING"),
        (None, 6, "BLR_LEASE_ACTIVE_BINDING"),
        ("ge_blr_used_leases", None, "BLR_LEASE_HISTORY_INCOMPLETE"),
        (None, 7, "BLR_LEASE_HISTORY_INCOMPLETE"),
        ("ge_blr_holds", None, "BLR_HOLD_STREAM_MISSING"),
        (None, 8, "BLR_HOLD_STREAM_MISSING"),
        ("ge_blr_migration_lock", None, "BLR_MIGRATION_LOCK_ACTIVE_BINDING"),
        (None, 9, "BLR_MIGRATION_LOCK_ACTIVE_BINDING"),
        (
            "ge_blr_used_migration_locks",
            None,
            "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE",
        ),
        (None, 10, "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE"),
    ],
)
def test_production_sql_defends_relation_only_and_common_only_carriers(
    delete_relation: str | None,
    delete_common_rank: int | None,
    rule_id: str,
) -> None:
    connection, _summary, stage, _identity = _prepare_campaign(
        _populate_valid_relations
    )
    try:
        if delete_relation is not None:
            connection.execute(f"DELETE FROM temp.{delete_relation}").close()
        else:
            connection.execute(
                "DELETE FROM temp.ge_blr_stage WHERE kind_rank = ?",
                (delete_common_rank,),
            ).close()
        stage._allowed_total_changes = connection.total_changes
        assert _rule_witness_count(connection, rule_id) == 1
    finally:
        _cleanup(connection, stage)


def test_missing_lock_singleton_is_one_unit_in_both_lock_rules() -> None:
    connection, _summary, stage, _identity = _prepare_campaign()
    try:
        connection.execute("DELETE FROM temp.ge_blr_migration_lock").close()
        connection.execute("DELETE FROM temp.ge_blr_stage WHERE kind_rank = 9").close()
        stage._allowed_total_changes = connection.total_changes
        assert (
            _rule_witness_count(
                connection,
                "BLR_MIGRATION_LOCK_HISTORY_INCOMPLETE",
            )
            == 1
        )
        assert (
            _rule_witness_count(connection, "BLR_MIGRATION_LOCK_ACTIVE_BINDING")
            == 1
        )
    finally:
        _cleanup(connection, stage)
