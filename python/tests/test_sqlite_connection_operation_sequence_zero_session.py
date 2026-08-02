from __future__ import annotations

import gc
import hashlib
from collections.abc import Callable
from inspect import signature
from typing import cast
from weakref import ref

import pytest

import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_operation_baseline_source as source_module
from graph_engineering.sqlite_cursor_publication_outer_authority import (
    _SQLiteBaselineEntriesPublicationReceipt,
    _SQLiteBaselineHeaderPublicationReceipt,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _SQLiteMigration0002CatalogRebuildReceipt,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC,
    SQLiteV1BaselineConnectionOwner,
    _begin_sqlite_connection_operation_sequence_zero_execution_intrinsic,
    _execute_sqlite_connection_operation_sequence_zero_intrinsic,
    _read_sqlite_connection_operation_sequence_zero_execution_snapshot_intrinsic,
    _SQLiteConnectionOperationSequenceZeroExecution,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_cursor_publication_baseline_header import (
    _graph,
    _publish_header,
    _safe_cleanup,
)

_INSERT_SQL = (
    "INSERT INTO main.ge_cycle_operation_sequence (singleton, baseline_id, "
    "last_commit_sequence, baseline_captured_at_ms, updated_at_ms) "
    "VALUES (1, ?, 0, ?, ?)"
)
_INSERT_SHA256 = "a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85"
_PARAMETER_ORDER = ("baselineId", "baselineCapturedAtMs", "updatedAtMs")
_STEP_FIELDS = (
    "affected_rows_delta",
    "completed_execution_count",
    "execute_count",
    "prepare_count",
    "total_changes",
    "transaction_epoch",
    "transaction_generation",
)
_EXECUTION_FIELDS = (
    "affected_rows",
    "completed_execution_count",
    "execute_count",
    "lifecycle",
    "prepare_count",
    "total_changes_before",
    "total_changes",
    "total_changes_delta",
    "transaction_epoch",
    "transaction_generation",
    "close_attempt_count",
    "close_succeeded",
)


def _source_graph(
    legacy_count: int = 1,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _SQLiteBaselineEntriesPublicationReceipt,
    _SQLiteBaselineHeaderPublicationReceipt,
]:
    graph = _graph(legacy_count)
    connection, stage, authority, migration, fence, reader, entries = graph
    header = _publish_header(authority, migration, fence, reader, entries)
    return connection, stage, authority, migration, fence, reader, entries, header


def _parameters(
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> tuple[str, int, int]:
    state = outer_module._authority_state(authority)
    return (
        state.projection_identity.baseline_id,
        state.captured_at_ms,
        max(state.captured_at_ms, state.outer_provider_now_ms),
    )


def _begin(
    connection: SQLiteV1BaselineConnectionOwner,
) -> _SQLiteConnectionOperationSequenceZeroExecution:
    return _begin_sqlite_connection_operation_sequence_zero_execution_intrinsic(connection)


def _execute(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionOperationSequenceZeroExecution,
    parameters: tuple[object, object, object],
) -> object:
    return _execute_sqlite_connection_operation_sequence_zero_intrinsic(
        connection, execution, *parameters
    )


def _progress(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionOperationSequenceZeroExecution,
) -> object:
    return _read_sqlite_connection_operation_sequence_zero_execution_snapshot_intrinsic(
        connection, execution
    )


def _rows(connection: SQLiteV1BaselineConnectionOwner) -> list[tuple[object, ...]]:
    cursor = connection.execute(
        "SELECT singleton, baseline_id, last_commit_sequence, "
        "baseline_captured_at_ms, updated_at_ms "
        "FROM main.ge_cycle_operation_sequence ORDER BY singleton ASC"
    )
    try:
        rows: list[tuple[object, ...]] = []
        while True:
            batch = cursor.fetchmany(16)
            if not batch:
                return rows
            rows.extend(tuple(row) for row in batch)
    finally:
        cursor.close()


def test_exact_154_byte_sql_sha_three_parameter_order_and_closed_api() -> None:
    assert len(_INSERT_SQL.encode("utf-8")) == 154
    assert SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC == _INSERT_SQL
    assert source_module._OPERATION_SEQUENCE_ZERO_INSERT_SQL == _INSERT_SQL
    assert SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC == _INSERT_SHA256
    assert hashlib.sha256(_INSERT_SQL.encode()).hexdigest() == _INSERT_SHA256
    assert SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC == _PARAMETER_ORDER
    assert tuple(
        signature(_begin_sqlite_connection_operation_sequence_zero_execution_intrinsic).parameters
    ) == ("connection",)
    assert tuple(
        signature(_execute_sqlite_connection_operation_sequence_zero_intrinsic).parameters
    ) == (
        "connection",
        "execution",
        "baseline_id",
        "baseline_captured_at_ms",
        "updated_at_ms",
    )
    assert tuple(
        signature(
            _read_sqlite_connection_operation_sequence_zero_execution_snapshot_intrinsic
        ).parameters
    ) == ("connection", "execution")


def test_direct_session_writes_singleton_zero_and_reports_exact_real_progress() -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    parameters = _parameters(authority)
    changes_before = connection.total_changes
    epoch_before = connection.transaction_epoch
    generation = connection._transaction_generation
    try:
        execution = _begin(connection)
        assert type(execution) is _SQLiteConnectionOperationSequenceZeroExecution
        before = _progress(connection, execution)
        assert before._fields == _EXECUTION_FIELDS
        assert before == (
            0,
            0,
            0,
            "active",
            1,
            changes_before,
            changes_before,
            0,
            epoch_before,
            generation,
            0,
            False,
        )
        step = _execute(connection, execution, parameters)
        assert step._fields == _STEP_FIELDS
        assert step == (
            1,
            1,
            1,
            1,
            changes_before + 1,
            epoch_before + 1,
            generation,
        )
        after = _progress(connection, execution)
        assert after == (
            1,
            1,
            1,
            "completed",
            1,
            changes_before,
            changes_before + 1,
            1,
            epoch_before + 1,
            generation,
            1,
            True,
        )
        assert _rows(connection) == [(1, parameters[0], 0, parameters[1], parameters[2])]
    finally:
        _safe_cleanup(connection, stage)


def test_begin_requires_same_active_begin_exclusive_generation() -> None:
    graph = _source_graph(1)
    connection, stage, *_ = graph
    try:
        connection.rollback()
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_STALE_FENCE$"):
            _begin(connection)
        connection.executescript("BEGIN")
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_STALE_FENCE$"):
            _begin(connection)
    finally:
        _safe_cleanup(connection, stage)


def test_forged_proxy_and_cross_connection_execution_handles_are_rejected() -> None:
    graph = _source_graph(1)
    other = _source_graph(1)
    connection, stage, authority, *_ = graph
    other_connection, other_stage, *_ = other
    execution = _begin(connection)
    other_execution = _begin(other_connection)
    try:
        for hostile in (object(), cast(_SQLiteConnectionOperationSequenceZeroExecution, object())):
            with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION$"):
                _execute(connection, hostile, _parameters(authority))
            with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION$"):
                _progress(connection, hostile)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION$"):
            _execute(connection, other_execution, _parameters(authority))
        assert _execute(connection, execution, _parameters(authority)).affected_rows_delta == 1
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


def test_completed_and_poisoned_sessions_reject_replay_without_second_close() -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    parameters = _parameters(authority)
    try:
        completed = _begin(connection)
        _execute(connection, completed, parameters)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_TERMINAL$"):
            _execute(connection, completed, parameters)
        assert _progress(connection, completed).close_attempt_count == 1

        poisoned = _begin(connection)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_PARAMETERS$"):
            _execute(connection, poisoned, ("v1-legacy", parameters[1], parameters[2]))
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_TERMINAL$"):
            _execute(connection, poisoned, parameters)
        assert _progress(connection, poisoned).close_attempt_count == 1
        assert len(_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    "mutator",
    [
        lambda p: (None, p[1], p[2]),
        lambda p: ("v1-legacy", p[1], p[2]),
        lambda p: (f"v2-{'A' * 64}", p[1], p[2]),
        lambda p: (p[0], True, p[2]),
        lambda p: (p[0], -1, p[2]),
        lambda p: (p[0], 1.5, p[2]),
        lambda p: (p[0], p[1], str(p[2])),
        lambda p: (p[0], p[1], p[1] - 1),
        lambda p: (p[0], p[1], 2**53),
    ],
)
def test_hostile_parameters_are_rejected_before_native_execute(
    mutator: Callable[[tuple[str, int, int]], tuple[object, object, object]],
) -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    parameters = _parameters(authority)
    try:
        execution = _begin(connection)
        hostile = mutator(parameters)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_PARAMETERS$"):
            _execute(connection, execution, hostile)
        snapshot = _progress(connection, execution)
        assert snapshot.execute_count == 0
        assert snapshot.completed_execution_count == 0
        assert snapshot.affected_rows == 0
        assert snapshot.total_changes_delta == 0
        assert snapshot.close_attempt_count == 1
        assert snapshot.lifecycle == "poisoned"
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_timestamp_equality_is_the_accepted_monotonic_boundary() -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    baseline_id, captured_at_ms, _ = _parameters(authority)
    try:
        step = _execute(
            connection,
            _begin(connection),
            (baseline_id, captured_at_ms, captured_at_ms),
        )
        assert step.affected_rows_delta == 1
        assert _rows(connection)[0][3:] == (captured_at_ms, captured_at_ms)
    finally:
        _safe_cleanup(connection, stage)


def test_owner_counter_and_epoch_drift_after_prepare_poison_without_own_write() -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    try:
        execution = _begin(connection)
        cursor = connection.execute(
            "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
        )
        cursor.close()
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_OWNER_DRIFT$"):
            _execute(connection, execution, _parameters(authority))
        snapshot = _progress(connection, execution)
        assert snapshot.execute_count == 0
        assert snapshot.completed_execution_count == 0
        assert snapshot.affected_rows == 1
        assert snapshot.total_changes_delta == 1
        assert snapshot.close_attempt_count == 1
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_replaced_transaction_generation_after_prepare_is_rejected() -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    try:
        execution = _begin(connection)
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_OWNER_DRIFT$"):
            _execute(connection, execution, _parameters(authority))
        snapshot = _progress(connection, execution)
        assert snapshot.execute_count == 0
        assert snapshot.completed_execution_count == 0
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.close_attempt_count == 1
    finally:
        _safe_cleanup(connection, stage)


def test_prepare_failure_creates_no_execution_and_zero_native_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _source_graph(1)
    connection, stage, *_ = graph
    baseline = len(source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS)

    def fail_prepare(*_: object) -> object:
        raise RuntimeError("forced sequence prepare failure")

    monkeypatch.setattr(source_module, "_SEQUENCE_ZERO_SQLITE_CONNECTION_CURSOR", fail_prepare)
    try:
        changes = connection.total_changes
        epoch = connection.transaction_epoch
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_PREPARE$"):
            _begin(connection)
        assert len(source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS) == baseline
        assert connection.total_changes == changes
        assert connection.transaction_epoch == epoch
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_suppressed_insert_retains_completed_native_return_but_zero_rows() -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    cursor = connection.execute(
        "CREATE TRIGGER main.ge_hostile_sequence_ignore "
        "BEFORE INSERT ON ge_cycle_operation_sequence "
        "BEGIN SELECT RAISE(IGNORE); END"
    )
    cursor.close()
    try:
        execution = _begin(connection)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_AFFECTED_ROWS$"):
            _execute(connection, execution, _parameters(authority))
        snapshot = _progress(connection, execution)
        assert snapshot.completed_execution_count == 1
        assert snapshot.execute_count == 1
        assert snapshot.affected_rows == 0
        assert snapshot.total_changes_delta == 0
        assert snapshot.close_attempt_count == 1
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_trigger_side_effect_exposes_real_two_row_accounting_failure() -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    for sql in (
        "CREATE TABLE main.ge_hostile_sequence_echo (id INTEGER PRIMARY KEY, note TEXT NOT NULL)",
        "CREATE TRIGGER main.ge_hostile_sequence_echo_trigger "
        "AFTER INSERT ON ge_cycle_operation_sequence "
        "BEGIN INSERT INTO ge_hostile_sequence_echo (note) VALUES ('shadow'); END",
    ):
        cursor = connection.execute(sql)
        cursor.close()
    try:
        execution = _begin(connection)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_ACCOUNTING$"):
            _execute(connection, execution, _parameters(authority))
        snapshot = _progress(connection, execution)
        assert snapshot.completed_execution_count == 1
        assert snapshot.execute_count == 1
        assert snapshot.affected_rows == 2
        assert snapshot.total_changes_delta == 2
        assert snapshot.close_attempt_count == 1
        assert len(_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_success_closes_once_drops_cursor_and_terminal_replay_never_recloses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    original_close = source_module._SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE
    closes = 0

    def counted_close(cursor: object) -> object:
        nonlocal closes
        closes += 1
        return original_close(cursor)

    monkeypatch.setattr(source_module, "_SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE", counted_close)
    try:
        execution = _begin(connection)
        _execute(connection, execution, _parameters(authority))
        state = source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS[id(execution)][1]
        assert closes == 1
        assert state.cursor is None
        assert state.close_error_code is None
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_TERMINAL$"):
            _execute(connection, execution, _parameters(authority))
        assert closes == 1
        assert _progress(connection, execution).close_succeeded is True
    finally:
        _safe_cleanup(connection, stage)


def test_cleanup_failure_after_native_success_preserves_row_and_poisons(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph

    def fail_close(_: object) -> None:
        raise RuntimeError("forced sequence cleanup failure")

    monkeypatch.setattr(source_module, "_SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE", fail_close)
    try:
        execution = _begin(connection)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_CLEANUP$"):
            _execute(connection, execution, _parameters(authority))
        snapshot = _progress(connection, execution)
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.execute_count == 1
        assert snapshot.completed_execution_count == 1
        assert snapshot.affected_rows == 1
        assert snapshot.total_changes_delta == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is False
        state = source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS[id(execution)][1]
        assert state.cursor is None
        assert state.close_error_code == "GE_CURSOR_B3_SEQUENCE_ZERO_CLEANUP"
        assert len(_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_execute_primary_outranks_cleanup_secondary_and_retains_no_exception_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph

    def fail_execute(*_: object) -> object:
        raise RuntimeError("forced primary execute failure")

    def fail_close(_: object) -> None:
        raise RuntimeError("forced secondary close failure")

    monkeypatch.setattr(source_module, "_SEQUENCE_ZERO_SQLITE_CURSOR_EXECUTE", fail_execute)
    monkeypatch.setattr(source_module, "_SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE", fail_close)
    try:
        execution = _begin(connection)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTE$"):
            _execute(connection, execution, _parameters(authority))
        snapshot = _progress(connection, execution)
        assert snapshot.execute_count == 1
        assert snapshot.completed_execution_count == 0
        assert snapshot.affected_rows == 0
        assert snapshot.total_changes_delta == 0
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is False
        state = source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS[id(execution)][1]
        assert state.cursor is None
        assert state.close_error_code == "GE_CURSOR_B3_SEQUENCE_ZERO_CLEANUP"
        assert {
            "exception",
            "traceback",
            "error",
        }.isdisjoint(source_module._OperationSequenceZeroExecutionState.__dataclass_fields__)
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_execution_registry_is_weak_and_releases_connection_graph() -> None:
    graph = _source_graph(1)
    connection, stage, *_ = graph
    baseline = len(source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS)
    execution = _begin(connection)
    assert len(source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS) == baseline + 1
    execution_ref = ref(execution)
    del execution
    gc.collect()
    gc.collect()
    assert execution_ref() is None
    assert len(source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS) == baseline
    _safe_cleanup(connection, stage)


@pytest.mark.parametrize("mutation_point", ["before-begin", "after-begin"])
def test_late_private_and_public_sql_rebinding_cannot_redirect_fixed_insert(
    monkeypatch: pytest.MonkeyPatch,
    mutation_point: str,
) -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    hostile = (
        "UPDATE main.ge_cycle_schema SET current_version = 999 "
        "WHERE singleton = 1 RETURNING ?, ?, ?"
    )
    try:
        cursor = connection.execute(
            "SELECT current_version FROM main.ge_cycle_schema WHERE singleton = 1"
        )
        try:
            before = cursor.fetchone()
            assert before is not None and cursor.fetchone() is None
        finally:
            cursor.close()
        execution: _SQLiteConnectionOperationSequenceZeroExecution
        if mutation_point == "before-begin":
            monkeypatch.setattr(
                source_module,
                "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC",
                hostile,
            )
            monkeypatch.setattr(source_module, "_OPERATION_SEQUENCE_ZERO_INSERT_SQL", hostile)
            execution = _begin(connection)
        else:
            execution = _begin(connection)
            monkeypatch.setattr(
                source_module,
                "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC",
                hostile,
            )
            monkeypatch.setattr(source_module, "_OPERATION_SEQUENCE_ZERO_INSERT_SQL", hostile)
        step = _execute(connection, execution, _parameters(authority))
        assert step.affected_rows_delta == 1
        cursor = connection.execute(
            "SELECT current_version FROM main.ge_cycle_schema WHERE singleton = 1"
        )
        try:
            assert cursor.fetchone() == before
            assert cursor.fetchone() is None
        finally:
            cursor.close()
        assert len(_rows(connection)) == 1
        state = source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS[id(execution)][1]
        assert state.fixed_insert_sql == _INSERT_SQL
        assert state.fixed_insert_sql_sha256 == _INSERT_SHA256
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("paired_sha", [False, True])
def test_session_sql_commitment_tamper_is_rejected_before_native_execute(
    paired_sha: bool,
) -> None:
    graph = _source_graph(1)
    connection, stage, authority, *_ = graph
    hostile = (
        "UPDATE main.ge_cycle_schema SET current_version = current_version "
        "WHERE singleton = 1 RETURNING ?, ?, ?"
    )
    try:
        execution = _begin(connection)
        state = source_module._OPERATION_SEQUENCE_ZERO_EXECUTIONS[id(execution)][1]
        state.fixed_insert_sql = hostile
        if paired_sha:
            state.fixed_insert_sql_sha256 = hashlib.sha256(hostile.encode()).hexdigest()
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_SQL_IDENTITY$"):
            _execute(connection, execution, _parameters(authority))
        snapshot = _progress(connection, execution)
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.execute_count == 0
        assert snapshot.completed_execution_count == 0
        assert snapshot.affected_rows == 0
        assert snapshot.total_changes_delta == 0
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert state.cursor is None
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)
