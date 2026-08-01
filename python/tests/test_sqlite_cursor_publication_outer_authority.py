from __future__ import annotations

import gc
import sqlite3
from pathlib import Path
from typing import cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_clock_authority as clock_module
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as ownership_module
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    _consume_provider_clock_evidence_intrinsic,
    _create_migration_lock_capability_intrinsic,
    _create_provider_clock_capability_intrinsic,
    _create_provider_clock_source_intrinsic,
    _MigrationLockIdentity,
    _observe_provider_clock_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_outer_authority import (
    _activate_sqlite_cursor_outer_publication_authority_intrinsic,
    _assert_sqlite_cursor_outer_publication_authority_intrinsic,
    _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic,
    _prepare_sqlite_cursor_outer_publication_authority_intrinsic,
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _SQLiteCursorOuterPublicationAuthority,
)
from graph_engineering.sqlite_operation_baseline_cursor_campaign import (
    SQLiteCursorPreRebindComplete,
    _run_sqlite_cursor_pre_rebind_campaign,
)
from graph_engineering.sqlite_operation_baseline_cursor_stage_ownership import (
    _begin_sqlite_cursor_stage_ownership_transfer,
    _create_sqlite_cursor_seal_temp_table,
)
from graph_engineering.sqlite_operation_baseline_legacy_invariants import (
    run_sqlite_v1_legacy_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_operation_baseline_checkpoint_invariants import _cleanup
from tests.test_sqlite_operation_baseline_cursor_source_fence import _mint_receipt
from tests.test_sqlite_operation_baseline_legacy_invariants import (
    _populate_shared_legacy_fixture,
    _prepare_legacy,
)


def _populate_clean(connection: SQLiteV1BaselineConnectionOwner) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)


def _clean_graph() -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    object,
    object,
    object,
    object,
    object,
    object,
]:
    connection, summary, stage, projection = _prepare_legacy(_populate_clean)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, projection, stage)
    assert report.diagnostics == ()
    receipt = _mint_receipt(summary, projection)
    transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
    _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
    outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
    assert type(outcome) is SQLiteCursorPreRebindComplete
    cursor = connection.execute(
        """SELECT active_lock_id, active_owner_id, active_source_version,
                  active_target_version, active_lock_epoch, active_fencing_token,
                  active_expires_at_ms
             FROM main.ge_cycle_migration_lock WHERE singleton = 1"""
    )
    try:
        row = cursor.fetchone()
        assert row is not None and cursor.fetchone() is None
    finally:
        cursor.close()
    assert type(row[4]) is int and type(row[5]) is int and type(row[6]) is int
    expected_lock = _MigrationLockIdentity(
        lock_id=str(row[0]),
        owner_id=str(row[1]),
        source_schema_version=1,
        target_schema_version=2,
        lock_epoch=cast(int, row[4]),
        fencing_token=cast(int, row[5]),
        active_expires_at_ms=cast(int, row[6]),
    )
    lock = _create_migration_lock_capability_intrinsic(connection, expected_lock)
    clock_source = _create_provider_clock_source_intrinsic(
        lambda: expected_lock.active_expires_at_ms - 1
    )
    clock = _create_provider_clock_capability_intrinsic(connection, lock, clock_source)
    evidence = _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
    return connection, stage, receipt, projection, transfer, lock, clock, evidence


def _prepare_clean() -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
]:
    connection, stage, receipt, projection, transfer, lock, clock, evidence = _clean_graph()
    authority = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
        connection,
        stage,
        receipt,  # type: ignore[arg-type]
        projection,  # type: ignore[arg-type]
        transfer,  # type: ignore[arg-type]
        lock,  # type: ignore[arg-type]
        clock,  # type: ignore[arg-type]
        evidence,  # type: ignore[arg-type]
    )
    return connection, stage, authority


def test_prepares_one_exact_inactive_zero_ledger_authority_idempotently() -> None:
    graph = _clean_graph()
    connection, stage, receipt, projection, transfer, lock, clock, evidence = graph
    try:
        before_epoch = connection.transaction_epoch
        before_changes = connection.total_changes
        authority = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            connection,
            stage,
            receipt,  # type: ignore[arg-type]
            projection,  # type: ignore[arg-type]
            transfer,  # type: ignore[arg-type]
            lock,  # type: ignore[arg-type]
            clock,  # type: ignore[arg-type]
            evidence,  # type: ignore[arg-type]
        )
        repeated = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            connection,
            stage,
            receipt,  # type: ignore[arg-type]
            projection,  # type: ignore[arg-type]
            transfer,  # type: ignore[arg-type]
            lock,  # type: ignore[arg-type]
            clock,  # type: ignore[arg-type]
            evidence,  # type: ignore[arg-type]
        )
        assert type(authority) is _SQLiteCursorOuterPublicationAuthority
        assert repeated is authority
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.lifecycle == "inactive"
        assert snapshot.activation_count == 0
        assert snapshot.outer_clock_consumed_tombstone is None
        assert snapshot.outer_ledger == (0, 0, 0)
        assert snapshot.write_phase == "ready-0002"
        assert connection.transaction_epoch == before_epoch
        assert connection.total_changes == before_changes
    finally:
        _cleanup(connection, stage)


def test_cancelled_activation_is_retryable_then_consumes_and_publishes_once() -> None:
    connection, stage, authority = _prepare_clean()
    try:
        controller = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
        controller.cancel()
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_CANCELLED$"):
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(
                authority,
                controller.signal,  # type: ignore[arg-type]
            )
        cancelled = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            authority  # type: ignore[arg-type]
        )
        assert cancelled.lifecycle == "inactive"
        assert cancelled.activation_count == 0
        assert cancelled.outer_clock_consumed_tombstone is None

        assert (
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(
                authority  # type: ignore[arg-type]
            )
            is authority
        )
        assert (
            _assert_sqlite_cursor_outer_publication_authority_intrinsic(
                authority  # type: ignore[arg-type]
            )
            is authority
        )
        active = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            authority  # type: ignore[arg-type]
        )
        assert active.lifecycle == "active"
        assert active.activation_count == 1
        assert active.outer_clock_consumed_tombstone is not None
        assert stage._cursor_outer_publication_state == "published"
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_NOT_INACTIVE$"):
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(
                authority  # type: ignore[arg-type]
            )
    finally:
        _cleanup(connection, stage)


def test_captured_dependencies_ignore_later_module_level_replacement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _prepare_clean()
    try:
        monkeypatch.setattr(
            clock_module,
            "_consume_provider_clock_evidence_intrinsic",
            lambda *_args: (_ for _ in ()).throw(RuntimeError("replacement clock")),
        )
        monkeypatch.setattr(
            ownership_module,
            "_publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic",
            lambda *_args: (_ for _ in ()).throw(RuntimeError("replacement publish")),
        )
        assert (
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(
                authority  # type: ignore[arg-type]
            )
            is authority
        )
    finally:
        _cleanup(connection, stage)


def test_rejects_preconsumed_and_no_longer_latest_first_boundary_evidence() -> None:
    consumed = _clean_graph()
    later = _clean_graph()
    consumed_connection, consumed_stage, *consumed_tail = consumed
    later_connection, later_stage, *later_tail = later
    try:
        _consume_provider_clock_evidence_intrinsic(
            consumed_tail[-2],  # type: ignore[arg-type]
            consumed_tail[-1],  # type: ignore[arg-type]
            "outer-publication-authority",
        )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_CLOCK_GRAPH$"):
            _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
                consumed_connection,
                consumed_stage,
                consumed_tail[0],  # type: ignore[arg-type]
                consumed_tail[1],  # type: ignore[arg-type]
                consumed_tail[2],  # type: ignore[arg-type]
                consumed_tail[3],  # type: ignore[arg-type]
                consumed_tail[4],  # type: ignore[arg-type]
                consumed_tail[5],  # type: ignore[arg-type]
            )

        _observe_provider_clock_intrinsic(
            later_tail[-2],  # type: ignore[arg-type]
            "before-cursor-rebind",
        )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_CLOCK_GRAPH$"):
            _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
                later_connection,
                later_stage,
                later_tail[0],  # type: ignore[arg-type]
                later_tail[1],  # type: ignore[arg-type]
                later_tail[2],  # type: ignore[arg-type]
                later_tail[3],  # type: ignore[arg-type]
                later_tail[4],  # type: ignore[arg-type]
                later_tail[5],  # type: ignore[arg-type]
            )
    finally:
        _cleanup(later_connection, later_stage)
        _cleanup(consumed_connection, consumed_stage)


def test_rejects_clone_and_cross_run_mix_before_corrected_exact_prepare() -> None:
    first = _clean_graph()
    second = _clean_graph()
    (
        first_connection,
        first_stage,
        first_receipt,
        first_projection,
        first_transfer,
        first_lock,
        first_clock,
        first_evidence,
    ) = first
    second_connection, second_stage, *second_tail = second
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_CLOCK_GRAPH$"):
            _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
                first_connection,
                first_stage,
                first_receipt,  # type: ignore[arg-type]
                first_projection,  # type: ignore[arg-type]
                first_transfer,  # type: ignore[arg-type]
                first_lock,  # type: ignore[arg-type]
                first_clock,  # type: ignore[arg-type]
                second_tail[-1],  # type: ignore[arg-type]
            )
        authority = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            first_connection,
            first_stage,
            first_receipt,  # type: ignore[arg-type]
            first_projection,  # type: ignore[arg-type]
            first_transfer,  # type: ignore[arg-type]
            first_lock,  # type: ignore[arg-type]
            first_clock,  # type: ignore[arg-type]
            first_evidence,  # type: ignore[arg-type]
        )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_AUTHORITY$"):
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(
                object()  # type: ignore[arg-type]
            )
        assert _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority) is authority
    finally:
        _cleanup(second_connection, second_stage)
        _cleanup(first_connection, first_stage)


def test_rollback_and_rebegin_retires_inactive_authority_before_consumption() -> None:
    connection, stage, authority = _prepare_clean()
    try:
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_STALE_FENCE$"):
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.lifecycle == "retired"
        assert snapshot.activation_count == 0
        assert snapshot.outer_clock_consumed_tombstone is None
    finally:
        _cleanup(connection, stage)


def test_legal_later_clock_boundary_keeps_outer_authority_active() -> None:
    graph = _clean_graph()
    connection, stage, receipt, projection, transfer, lock, clock, evidence = graph
    try:
        authority = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            connection,
            stage,
            receipt,  # type: ignore[arg-type]
            projection,  # type: ignore[arg-type]
            transfer,  # type: ignore[arg-type]
            lock,  # type: ignore[arg-type]
            clock,  # type: ignore[arg-type]
            evidence,  # type: ignore[arg-type]
        )
        _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        _observe_provider_clock_intrinsic(
            clock,  # type: ignore[arg-type]
            "before-cursor-rebind",
        )
        assert _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority) is authority
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.lifecycle == "active"
        assert snapshot.write_phase == "ready-0002"
    finally:
        _cleanup(connection, stage)


def test_provider_failure_poison_is_rejected_by_active_outer_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _clean_graph()
    connection, stage, receipt, projection, transfer, lock, clock, evidence = graph
    try:
        authority = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            connection,
            stage,
            receipt,  # type: ignore[arg-type]
            projection,  # type: ignore[arg-type]
            transfer,  # type: ignore[arg-type]
            lock,  # type: ignore[arg-type]
            clock,  # type: ignore[arg-type]
            evidence,  # type: ignore[arg-type]
        )
        _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        clock_state = clock_module._CLOCK_CAPABILITIES.get(clock)  # type: ignore[call-overload]
        assert clock_state is not None

        def unavailable() -> int:
            raise RuntimeError("provider unavailable")

        monkeypatch.setitem(clock_module._CLOCK_SOURCES, clock_state.source, unavailable)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_UNAVAILABLE$"):
            _observe_provider_clock_intrinsic(
                clock,  # type: ignore[arg-type]
                "before-cursor-rebind",
            )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_CLOCK_GRAPH$"):
            _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_active_assert_uses_current_outer_watermark_not_first_evidence_epoch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _prepare_clean()
    original_epoch = connection.transaction_epoch
    try:
        _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        state = outer_module._authority_state(authority)
        advanced_epoch = original_epoch + 1
        object.__setattr__(
            connection,
            "_SQLiteV1BaselineConnectionOwner__transaction_epoch",
            advanced_epoch,
        )
        state.current_transaction_epoch = advanced_epoch
        monkeypatch.setattr(outer_module, "_OWNERSHIP_ASSERT_OWNED", lambda *_args: None)
        assert _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority) is authority
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.lifecycle == "active"
        assert snapshot.transaction_epoch_at_preparation == advanced_epoch - 1
    finally:
        object.__setattr__(
            connection,
            "_SQLiteV1BaselineConnectionOwner__transaction_epoch",
            original_epoch,
        )
        _cleanup(connection, stage)


def test_publish_tail_failure_retains_consumption_and_poison_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _clean_graph()
    connection, stage, receipt, projection, transfer, lock, clock, evidence = graph
    try:
        authority = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            connection,
            stage,
            receipt,  # type: ignore[arg-type]
            projection,  # type: ignore[arg-type]
            transfer,  # type: ignore[arg-type]
            lock,  # type: ignore[arg-type]
            clock,  # type: ignore[arg-type]
            evidence,  # type: ignore[arg-type]
        )

        def fail_publish(_tail: object) -> None:
            raise RuntimeError("injected publish failure")

        monkeypatch.setattr(outer_module, "_OWNERSHIP_PUBLISH_OUTER", fail_publish)
        with pytest.raises(RuntimeError, match=r"^injected publish failure$"):
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)

        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        evidence_state = clock_module._EVIDENCE.get(evidence)  # type: ignore[call-overload]
        ownership_state = ownership_module._TRANSFERS.get(transfer)  # type: ignore[call-overload]
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
        assert snapshot.activation_count == 0
        assert snapshot.outer_clock_consumed_tombstone is not None
        assert evidence_state is not None and evidence_state.consumed
        assert clock_module._TOMBSTONES.get(snapshot.outer_clock_consumed_tombstone) is not None
        assert ownership_state is not None and ownership_state.lifecycle == "poisoned"
        assert stage._cursor_outer_publication_state == "poisoned"
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_NOT_INACTIVE$"):
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("activate", [False, True], ids=["inactive", "active"])
def test_naturally_abandoned_outer_graph_is_not_retained(activate: bool) -> None:
    gc.collect()
    gc.collect()
    outer_baseline = len(outer_module._AUTHORITIES)
    evidence_links_baseline = len(outer_module._AUTHORITY_BY_EVIDENCE)
    transfer_links_baseline = len(outer_module._AUTHORITY_BY_TRANSFER)
    ownership_baseline = len(ownership_module._TRANSFERS)

    def create_and_drop_graph():  # type: ignore[no-untyped-def]
        graph = _clean_graph()
        connection, stage, receipt, projection, transfer, lock, clock, evidence = graph
        authority = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            connection,
            stage,
            receipt,  # type: ignore[arg-type]
            projection,  # type: ignore[arg-type]
            transfer,  # type: ignore[arg-type]
            lock,  # type: ignore[arg-type]
            clock,  # type: ignore[arg-type]
            evidence,  # type: ignore[arg-type]
        )
        if activate:
            _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        authority_ref = ref(authority)
        transfer_ref = ref(transfer)
        stage_ref = ref(stage)
        return authority_ref, transfer_ref, stage_ref

    authority_ref, transfer_ref, stage_ref = create_and_drop_graph()
    gc.collect()
    gc.collect()

    assert authority_ref() is None
    assert transfer_ref() is None
    assert stage_ref() is None
    assert len(outer_module._AUTHORITIES) == outer_baseline
    assert len(outer_module._AUTHORITY_BY_EVIDENCE) == evidence_links_baseline
    assert len(outer_module._AUTHORITY_BY_TRANSFER) == transfer_links_baseline
    assert len(ownership_module._TRANSFERS) == ownership_baseline


def test_prepare_and_activation_are_transitively_read_only_and_do_not_own_transaction() -> None:
    graph = _clean_graph()
    connection, stage, receipt, projection, transfer, lock, clock, evidence = graph
    statements: list[str] = []
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    raw.set_trace_callback(statements.append)
    try:
        authority = _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            connection,
            stage,
            receipt,  # type: ignore[arg-type]
            projection,  # type: ignore[arg-type]
            transfer,  # type: ignore[arg-type]
            lock,  # type: ignore[arg-type]
            clock,  # type: ignore[arg-type]
            evidence,  # type: ignore[arg-type]
        )
        _activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)
    finally:
        raw.set_trace_callback(None)
    try:
        forbidden = (
            "BEGIN",
            "COMMIT",
            "ROLLBACK",
            "INSERT",
            "UPDATE",
            "DELETE",
            "REPLACE",
            "CREATE",
            "DROP",
            "ALTER",
            "VACUUM",
            "ATTACH",
            "DETACH",
        )
        assert statements
        assert all(not statement.lstrip().upper().startswith(forbidden) for statement in statements)
        assert connection.transaction_epoch == before_epoch
        assert connection.total_changes == before_changes
        assert connection.in_exclusive_transaction
        assert stage._cursor_outer_publication_state == "published"
    finally:
        _cleanup(connection, stage)


def test_rollback_and_rebegin_retires_active_authority_without_revival() -> None:
    connection, stage, authority = _prepare_clean()
    try:
        _activate_sqlite_cursor_outer_publication_authority_intrinsic(
            authority  # type: ignore[arg-type]
        )
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_STALE_FENCE$"):
            _assert_sqlite_cursor_outer_publication_authority_intrinsic(
                authority  # type: ignore[arg-type]
            )
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            authority  # type: ignore[arg-type]
        )
        assert snapshot.lifecycle == "retired"
        assert snapshot.write_phase == "retired"
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_STALE_FENCE$"):
            _assert_sqlite_cursor_outer_publication_authority_intrinsic(
                authority  # type: ignore[arg-type]
            )
    finally:
        _cleanup(connection, stage)


def test_runtime_remains_package_private_and_contains_no_sql_or_transaction_control() -> None:
    for name in (
        "_prepare_sqlite_cursor_outer_publication_authority_intrinsic",
        "_activate_sqlite_cursor_outer_publication_authority_intrinsic",
        "_SQLiteCursorOuterPublicationAuthority",
    ):
        assert not hasattr(graph_engineering, name)
    source = __import__(
        "graph_engineering.sqlite_cursor_publication_outer_authority",
        fromlist=["__file__"],
    ).__file__
    assert source is not None
    text = Path(source).read_text(encoding="utf-8")
    for forbidden in (
        ".execute(",
        "executescript",
        ".commit(",
        ".rollback(",
        ".rebind(",
    ):
        assert forbidden not in text
