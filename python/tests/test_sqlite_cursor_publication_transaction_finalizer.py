from __future__ import annotations

import copy
import gc
import json
import sqlite3
from pathlib import Path
from typing import Any, cast
from weakref import ref

import pytest

import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_cursor_publication_subprotocol as protocol
import graph_engineering.sqlite_cursor_publication_transaction_finalizer as finalizer
import graph_engineering.sqlite_operation_baseline_source as source
from tests.test_sqlite_cursor_publication_subprotocol import (
    _CursorAdoptionGraph,
    _session,
)

ROOT = Path(__file__).parents[2]
CASE_PATH = (
    ROOT / "spec" / "conformance" / "sqlite-post-consume-transaction-failure-finalizer-v1.case.json"
)
_read_finalizer = (
    finalizer._read_sqlite_cursor_postconsume_transaction_failure_finalizer_snapshot_intrinsic
)


class RollbackSecondary(BaseException):
    pass


class CloseTertiary(BaseException):
    pass


class PrimaryCollectionMarker:
    pass


class SubstitutePrimary(BaseException):
    pass


def _install_native_abort(graph: Any) -> None:
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(graph.connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    raw.execute(
        "CREATE TEMP TRIGGER postconsume_finalizer_abort "
        "BEFORE UPDATE ON main.ge_cycle_cursors "
        "BEGIN SELECT RAISE(ABORT, 'postconsume finalizer'); END"
    ).close()


def _captured_failure(
    monkeypatch: pytest.MonkeyPatch,
    *,
    location: Path | None = None,
) -> tuple[Any, Any, BaseException, Any, Any, Any]:
    original_init = source.SQLiteV1BaselineConnectionOwner.__init__
    if location is not None:
        with monkeypatch.context() as redirected:
            redirected.setattr(
                source.SQLiteV1BaselineConnectionOwner,
                "__init__",
                lambda owner, _location: original_init(owner, str(location)),
            )
            graph = _CursorAdoptionGraph(1)
    else:
        graph = _CursorAdoptionGraph(1)
    _install_native_abort(graph)
    session = _session(graph)
    owner = finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
        graph.connection, graph.authority, session
    )
    presentation = finalizer._owner_presentation(owner)
    connection, authority, context, tombstone, execution, _generation, primary = presentation
    assert connection is graph.connection and authority is graph.authority
    return graph, owner, primary, context, tombstone, execution


def _finalize(owner: Any, primary: BaseException) -> Any:
    with pytest.raises(type(primary)) as raised:
        finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(owner)
    assert raised.value is primary
    return _read_finalizer(owner)


def test_capture_authenticates_exact_native_primary_e_and_rejects_caller_primary_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph, owner, primary, context, tombstone, execution = _captured_failure(monkeypatch)
    assert type(primary) is ValueError
    assert primary.args == ("GE_CURSOR_B3_CURSOR_REBIND_EXECUTE",)
    assert isinstance(primary.__cause__, sqlite3.Error)
    authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        graph.authority
    )
    context_snapshot = outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        context
    )
    tombstone_snapshot = (
        outer._read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic(
            tombstone
        )
    )
    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, execution
    )
    assert authority.post_rebind_watermark_adoption is None
    assert graph.connection.in_exclusive_transaction
    assert graph.connection._transaction_generation is native.transaction_generation
    assert graph.connection.transaction_epoch == native.transaction_epoch
    assert context_snapshot.execution is execution
    assert tombstone_snapshot.execution is execution
    assert native.lifecycle == "poisoned"
    assert (native.execute_count, native.release_count) == (1, 1)
    assert native.affected_rows is None
    assert native.cursor_ledger_after == (0, 0, 0)
    assert (
        native.changes_prepare_count,
        native.changes_fetch_count,
        native.changes_release_count,
    ) == (0, 0, 0)
    assert not hasattr(
        finalizer,
        "_prepare_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic",
    )
    _finalize(owner, primary)


def test_capture_leaf_is_definition_time_closure_not_rebindable_global(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _CursorAdoptionGraph(1)
    _install_native_abort(graph)
    session = _session(graph)
    exact_leaf = finalizer._LEAF
    rebound_calls = 0

    def rebound(selected: Any) -> Any:
        nonlocal rebound_calls
        rebound_calls += 1
        try:
            exact_leaf(selected)
        except BaseException:
            raise SubstitutePrimary("substitute after real leaf") from None

    monkeypatch.setattr(finalizer, "_LEAF", rebound)
    capture = finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic
    assert "_LEAF" not in capture.__code__.co_names
    closure = dict(zip(capture.__code__.co_freevars, capture.__closure__ or (), strict=True))
    assert closure["exact_leaf"].cell_contents is exact_leaf
    assert closure["implementation"].cell_contents is finalizer._capture_implementation
    owner = capture(graph.connection, graph.authority, session)
    primary = finalizer._owner_presentation(owner)[-1]
    assert type(primary) is ValueError
    assert primary.args == ("GE_CURSOR_B3_CURSOR_REBIND_EXECUTE",)
    assert rebound_calls == 0
    _finalize(owner, primary)


@pytest.mark.parametrize(
    ("case_id", "rollback_fault", "close_fault"),
    [
        ("native-primary-plus-rollback-and-close-after-return-faults", True, True),
        ("native-primary-plus-rollback-after-return-fault-only", True, False),
        ("native-primary-plus-close-after-return-fault-only", False, True),
    ],
)
def test_three_fault_combinations_match_frozen_fixture_and_ordered_diagnostics(
    monkeypatch: pytest.MonkeyPatch,
    case_id: str,
    rollback_fault: bool,
    close_fault: bool,
) -> None:
    fixture = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    expected = next(case["expected"] for case in fixture["cases"] if case["caseId"] == case_id)
    graph, owner, primary, _context, _tombstone, _execution = _captured_failure(monkeypatch)
    prepared = _read_finalizer(owner)
    assert prepared.lifecycle == "prepared"
    assert prepared.state_trace == ("prepared",)
    rollback_error = RollbackSecondary("after native rollback")
    close_error = CloseTertiary("after native close")
    if rollback_fault:
        finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
            owner, "rollback", rollback_error
        )
    if close_fault:
        finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
            owner, "close", close_error
        )
    snapshot = _finalize(owner, primary)
    assert list(snapshot.state_trace) == expected["stateTrace"]
    assert snapshot.lifecycle == "finalized"
    assert snapshot.owner_consume_count == expected["ownerConsumeCount"]
    assert snapshot.terminalize_count == expected["terminalizeCount"]
    assert snapshot.rollback_attempt_count == expected["rollbackAttemptCount"]
    assert snapshot.rollback_native_return_count == expected["rollbackNativeReturnCount"]
    assert snapshot.close_attempt_count == expected["closeAttemptCount"]
    assert snapshot.close_native_return_count == expected["closeNativeReturnCount"]
    assert [diagnostic.code for diagnostic in snapshot.diagnostics] == expected["diagnosticCodes"]
    assert [diagnostic.rank for diagnostic in snapshot.diagnostics] == [
        "primary",
        *(["secondary"] if rollback_fault else []),
        *(["tertiary"] if close_fault else []),
    ]
    assert snapshot.rollback_after_native_return_ambiguous_fault_count == int(rollback_fault)
    assert snapshot.close_after_native_return_ambiguous_fault_count == int(close_fault)
    assert snapshot.rollback_secondary_failure_count == int(rollback_fault)
    assert snapshot.close_tertiary_failure_count == int(close_fault)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_REPLAY$"):
        finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(owner)
    with pytest.raises(sqlite3.ProgrammingError, match="closed database"):
        graph.connection.execute("SELECT 1")


def test_real_rollback_close_reopen_restores_and_fresh_graph_succeeds(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    location = tmp_path / "postconsume.sqlite3"
    _graph, owner, primary, _context, _tombstone, _execution = _captured_failure(
        monkeypatch, location=location
    )
    snapshot = _finalize(owner, primary)
    assert snapshot.rollback_attempt_count == snapshot.rollback_native_return_count == 1
    assert snapshot.close_attempt_count == snapshot.close_native_return_count == 1
    reopened = sqlite3.connect(location)
    try:
        assert reopened.execute(
            "SELECT current_version FROM ge_cycle_schema WHERE singleton = 1"
        ).fetchone() == (1,)
        assert reopened.execute("SELECT count(*) FROM ge_cycle_cursors").fetchone() == (1,)
    finally:
        reopened.close()

    fresh = _CursorAdoptionGraph(1)
    try:
        rule11 = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(fresh)
        )
        result = protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(rule11)
        assert result.violation_count == 0
        assert result.counts == (1, 1, 1, 1, 1)
    finally:
        fresh.close()


def test_success_no_primary_and_post_adoption_replay_cannot_mint_owner() -> None:
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    before = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_NO_PRIMARY$"):
            finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
                graph.connection, graph.authority, session
            )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_GRAPH$"):
            finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
                graph.connection, graph.authority, session
            )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_GRAPH$"):
            finalizer._authenticate_exact_native_primary_graph(graph.connection, graph.authority)
        assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == before
    finally:
        graph.close()


def test_cross_authentic_connection_authority_graph_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    left = _CursorAdoptionGraph(0)
    right = _CursorAdoptionGraph(1)
    _install_native_abort(right)
    session = _session(right)
    before = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_GRAPH$"):
            finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
                left.connection, right.authority, session
            )
        assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == before
        right_snapshot = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            right.authority
        )
        assert right_snapshot.lifecycle == "active"
        assert (
            outer._read_sqlite_cursor_publication_session_snapshot_intrinsic(session).session
            is session
        )
    finally:
        left.close()
        right.close()


@pytest.mark.parametrize("drift", ["same-generation-epoch", "new-generation"])
def test_transaction_lineage_or_epoch_drift_rejected_before_consume_or_io(
    monkeypatch: pytest.MonkeyPatch,
    drift: str,
) -> None:
    graph, owner, _primary, _context, _tombstone, _execution = _captured_failure(monkeypatch)
    generation = graph.connection._transaction_generation
    if drift == "same-generation-epoch":
        graph.connection.execute("CREATE TEMP TABLE postconsume_epoch_drift(value)").close()
        assert graph.connection._transaction_generation is generation
    else:
        graph.connection.rollback()
        graph.connection.execute("BEGIN EXCLUSIVE").close()
        assert graph.connection._transaction_generation is not generation
    before = _read_finalizer(owner)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_GRAPH$"):
        finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(owner)
    after = _read_finalizer(owner)
    assert before == after
    assert (
        after.owner_consume_count == after.rollback_attempt_count == after.close_attempt_count == 0
    )
    graph.connection.rollback()
    graph.connection.close()


def test_dead_injected_error_rejected_before_consume_or_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph, owner, _primary, _context, _tombstone, _execution = _captured_failure(monkeypatch)
    error = RollbackSecondary("short lived")
    error_ref = ref(error)
    finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
        owner, "rollback", error
    )
    del error
    for _ in range(6):
        gc.collect()
    assert error_ref() is None
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_PRESENTATION$"):
        finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(owner)
    snapshot = _read_finalizer(owner)
    assert snapshot.lifecycle == "prepared"
    assert (
        snapshot.owner_consume_count
        == snapshot.rollback_attempt_count
        == snapshot.close_attempt_count
        == 0
    )
    graph.connection.rollback()
    graph.connection.close()


def test_duplicate_context_owner_clone_forge_and_registration_rollback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _graph, owner, primary, context, _tombstone, _execution = _captured_failure(monkeypatch)
    before_owner = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    before_context = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_DUPLICATE$"):
        finalizer._register_context(context, owner)
    forged = object.__new__(type(owner))
    with pytest.raises(TypeError):
        cloned = copy.copy(owner)
        del cloned
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_FINALIZER$"):
        finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(forged)
    assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == before_owner
    assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT) == before_context
    _finalize(owner, primary)


@pytest.mark.parametrize("stage", ["owner", "context"])
def test_register_then_throw_discards_both_registry_entries(
    monkeypatch: pytest.MonkeyPatch,
    stage: str,
) -> None:
    graph = _CursorAdoptionGraph(1)
    _install_native_abort(graph)
    session = _session(graph)
    before = (
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS),
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT),
    )

    def fail_context(*_args: object) -> None:
        raise RuntimeError("context registration failed")

    def fail_owner(*_args: object) -> None:
        raise RuntimeError("owner registration failed")

    with pytest.raises(RuntimeError, match=f"{stage} registration failed"):
        finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
            graph.connection,
            graph.authority,
            session,
            fail_owner if stage == "owner" else finalizer._REGISTER_OWNER,
            fail_context if stage == "context" else finalizer._REGISTER_CONTEXT,
        )
    assert (
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS),
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT),
    ) == before
    graph.close()


def test_abandoned_owner_reverse_primary_graph_collects_and_stale_callback_is_safe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for _ in range(3):
        gc.collect()
    baseline = (
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS),
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT),
    )
    graph, owner, primary, context, tombstone, execution = _captured_failure(monkeypatch)
    cast(Any, primary).graph = graph
    marker = PrimaryCollectionMarker()
    cast(Any, primary).collection_marker = marker
    marker_ref = ref(marker)
    owner_id = id(owner)
    stale_owner = finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS[owner_id].key_ref
    stale_context = finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT[
        id(context)
    ].context_ref
    weak = [
        ref(graph.authority),
        ref(context),
        ref(tombstone),
        ref(execution),
        ref(owner),
    ]
    graph.stage.dispose()
    del context, execution, graph, marker, owner, primary, tombstone
    for _ in range(16):
        gc.collect()
    assert all(item() is None for item in weak)
    assert marker_ref() is None
    assert (
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS),
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT),
    ) == baseline
    stale_owner()
    stale_context()
    assert (
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS),
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT),
    ) == baseline


def test_finalized_owner_retains_only_pure_snapshot_not_graph_or_primary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def finalize_and_drop() -> tuple[Any, list[Any]]:
        graph, owner, primary, context, tombstone, execution = _captured_failure(monkeypatch)
        marker = PrimaryCollectionMarker()
        cast(Any, primary).collection_marker = marker
        weak = [
            ref(graph.authority),
            ref(context),
            ref(tombstone),
            ref(execution),
            ref(marker),
        ]
        snapshot = _finalize(owner, primary)
        assert snapshot.lifecycle == "finalized"
        return owner, weak

    owner, weak = finalize_and_drop()
    for _ in range(16):
        gc.collect()
    assert all(item() is None for item in weak)
    snapshot = _read_finalizer(owner)
    assert snapshot.lifecycle == "finalized"
    assert snapshot.state_trace == ("prepared", "finalizing", "finalized")
    assert [diagnostic.code for diagnostic in snapshot.diagnostics] == [
        "GE_SQLITE_POST_T_TERMINAL_PRIMARY"
    ]
