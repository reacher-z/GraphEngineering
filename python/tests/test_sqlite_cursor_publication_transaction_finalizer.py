from __future__ import annotations

import copy
import gc
import json
import sqlite3
from contextvars import copy_context
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


class ChangesPreparePrimary(BaseException):
    pass


class ChangesFetchPrimary(BaseException):
    pass


class ChangesPreQueryPrimary(BaseException):
    pass


class ChangesExecutePrimary(BaseException):
    pass


class ChangesPostQueryPrimary(BaseException):
    pass


class ChangesCloseSecondary(BaseException):
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
    (
        connection,
        authority,
        context,
        tombstone,
        execution,
        _generation,
        primary,
        adoption,
        write,
    ) = presentation
    assert connection is graph.connection and authority is graph.authority
    assert adoption is None and write is None
    return graph, owner, primary, context, tombstone, execution


def _captured_changes_failure(
    monkeypatch: pytest.MonkeyPatch,
    case: str,
    *,
    location: Path | None = None,
    population: int = 1,
    definition_time_leaf_attack: bool = False,
) -> tuple[Any, Any, BaseException, Any, Any, Any]:
    original_init = source.SQLiteV1BaselineConnectionOwner.__init__
    original_prepare = protocol.__dict__[
        "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic"
    ]
    executions: list[Any] = []

    def prepare(connection: Any) -> Any:
        execution = original_prepare(connection)
        executions.append(execution)
        return execution

    prepare_primary = ChangesPreparePrimary("serialized changes prepare")
    fetch_primary = ChangesFetchPrimary("serialized changes fetch")
    pre_query_primary = ChangesPreQueryPrimary("serialized changes pre-query")
    execute_primary = ChangesExecutePrimary("serialized changes execute")
    post_query_primary = ChangesPostQueryPrimary("serialized changes post-query")
    total_changes_calls = 0
    foreign_connection = sqlite3.connect(":memory:") if case == "foreign-cursor" else None

    def fail_prepare(_raw: sqlite3.Connection) -> sqlite3.Cursor:
        raise prepare_primary

    def foreign_cursor(_raw: sqlite3.Connection) -> sqlite3.Cursor:
        assert foreign_connection is not None
        return foreign_connection.cursor()

    def pre_query_in_transaction(_raw: sqlite3.Connection) -> bool:
        if case == "pre-query-raw":
            raise pre_query_primary
        return False

    def fail_execute(
        _cursor: sqlite3.Cursor,
        sql: str,
        parameters: tuple[()],
    ) -> sqlite3.Cursor:
        assert sql == source.SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
        assert parameters == ()
        raise execute_primary

    def post_query_total_changes(raw: sqlite3.Connection) -> int:
        nonlocal total_changes_calls
        total_changes_calls += 1
        if total_changes_calls == 1:
            return raw.total_changes
        if case == "post-query-raw":
            raise post_query_primary
        return raw.total_changes + 1

    rows_by_case: dict[str, object] = {
        "zero": [],
        "two": [(population,), (population,)],
        "shape": ((population,),),
        "type": [(str(population),)],
        "negative": [(-1,)],
        "unsafe": [(2**53,)],
        "close": [(population,)],
        "shape-and-close": [()],
    }

    def fetch(_cursor: sqlite3.Cursor, size: int) -> object:
        assert size == 2
        if case == "fetch":
            raise fetch_primary
        return rows_by_case.get(case, [(population,)])

    def close_then_secondary(cursor: sqlite3.Cursor) -> None:
        source._CURSOR_REBIND_SQLITE_CURSOR_CLOSE(cursor)
        raise ChangesCloseSecondary("serialized changes close")

    def prove(connection: Any, execution: Any) -> Any:
        assert executions == [execution]
        implementation = (
            source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes
        )
        if case == "prepare":
            return implementation(connection, execution, _cursor_factory=fail_prepare)
        if case == "foreign-cursor":
            return implementation(connection, execution, _cursor_factory=foreign_cursor)
        if case in {"pre-query-lineage", "pre-query-raw"}:
            return implementation(
                connection,
                execution,
                _native_in_transaction=pre_query_in_transaction,
            )
        if case == "execute":
            return implementation(connection, execution, _cursor_execute=fail_execute)
        if case in {"post-query-lineage", "post-query-raw"}:
            return implementation(
                connection,
                execution,
                _native_total_changes=post_query_total_changes,
                _cursor_fetchmany=fetch,
            )
        if case in {"close", "shape-and-close"}:
            return implementation(
                connection,
                execution,
                _cursor_fetchmany=fetch,
                _cursor_close=close_then_secondary,
            )
        return implementation(connection, execution, _cursor_fetchmany=fetch)

    monkeypatch.setattr(
        protocol,
        "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic",
        prepare,
    )
    monkeypatch.setattr(
        protocol,
        "_prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic",
        prove,
    )
    if location is None:
        graph = _CursorAdoptionGraph(population)
    else:
        with monkeypatch.context() as redirected:
            redirected.setattr(
                source.SQLiteV1BaselineConnectionOwner,
                "__init__",
                lambda owner, _location: original_init(owner, str(location)),
            )
            graph = _CursorAdoptionGraph(population)
    session = _session(graph)
    rebound_calls = 0
    if definition_time_leaf_attack:
        exact_leaf = finalizer._LEAF

        def rebound(selected: Any) -> Any:
            nonlocal rebound_calls
            rebound_calls += 1
            exact_leaf(selected)
            raise SubstitutePrimary("substitute after rebound leaf")

        monkeypatch.setattr(finalizer, "_LEAF", rebound)
    write_before = len(protocol._WRITE_RECEIPTS)
    rule11_before = len(protocol._RULE11_RECEIPTS)
    try:
        owner = (
            finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
                graph.connection, graph.authority, session
            )
        )
    finally:
        if foreign_connection is not None:
            foreign_connection.close()
    assert len(executions) == 1
    assert rebound_calls == 0
    assert len(protocol._WRITE_RECEIPTS) == write_before
    assert len(protocol._RULE11_RECEIPTS) == rule11_before
    (
        connection,
        authority,
        context,
        tombstone,
        execution,
        _generation,
        primary,
        adoption,
        write,
    ) = finalizer._owner_presentation(owner)
    assert connection is graph.connection and authority is graph.authority
    assert execution is executions[0]
    assert adoption is None and write is None
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
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
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
    assert _read_finalizer(owner).primary_boundary == "native-execute"
    assert not hasattr(
        finalizer,
        "_prepare_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic",
    )
    _finalize(owner, primary)


@pytest.mark.parametrize(
    ("case", "boundary", "changes_counts", "primary_code"),
    [
        (
            "pre-query-lineage",
            "serialized-changes-pre-query",
            (0, 0, 0),
            "GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE",
        ),
        ("pre-query-raw", "serialized-changes-pre-query", (0, 0, 0), None),
        (
            "prepare",
            "serialized-changes-prepare",
            (0, 0, 0),
            "GE_CURSOR_B3_CURSOR_CHANGES_PREPARE",
        ),
        (
            "foreign-cursor",
            "serialized-changes-prepare",
            (0, 0, 0),
            "GE_CURSOR_B3_CURSOR_CHANGES_PREPARE",
        ),
        ("execute", "serialized-changes-execute", (1, 0, 1), None),
        ("fetch", "serialized-changes-fetch", (1, 1, 1), None),
        (
            "zero",
            "serialized-changes-fetch",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE",
        ),
        (
            "two",
            "serialized-changes-fetch",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE",
        ),
        (
            "shape",
            "serialized-changes-fetch",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE",
        ),
        (
            "type",
            "serialized-changes-fetch",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE",
        ),
        (
            "negative",
            "serialized-changes-fetch",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_VALUE",
        ),
        (
            "unsafe",
            "serialized-changes-fetch",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_VALUE",
        ),
        (
            "close",
            "serialized-changes-release",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_RELEASE",
        ),
        (
            "post-query-lineage",
            "serialized-changes-post-query",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE",
        ),
        ("post-query-raw", "serialized-changes-post-query", (1, 1, 1), None),
        (
            "shape-and-close",
            "serialized-changes-fetch",
            (1, 1, 1),
            "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE",
        ),
    ],
)
def test_capture_authenticates_serialized_changes_primary_matrix(
    monkeypatch: pytest.MonkeyPatch,
    case: str,
    boundary: str,
    changes_counts: tuple[int, int, int],
    primary_code: str | None,
) -> None:
    graph, owner, primary, _context, _tombstone, execution = _captured_changes_failure(
        monkeypatch, case
    )
    snapshot = _read_finalizer(owner)
    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, execution
    )
    assert snapshot.primary_boundary == boundary
    assert type(snapshot.primary_boundary) is str
    assert json.loads(json.dumps(snapshot.primary_boundary)) == boundary
    assert native.lifecycle == "poisoned"
    assert (native.execute_count, native.release_count, native.affected_rows) == (1, 1, 1)
    assert native.total_changes_delta == 1
    assert native.cursor_ledger_before == (0, 0, 0)
    assert native.cursor_ledger_after == native.cursor_ledger_delta == (1, 1, 1)
    assert (
        native.changes_prepare_count,
        native.changes_fetch_count,
        native.changes_release_count,
    ) == changes_counts
    authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        graph.authority
    )
    assert authority.post_rebind_watermark_adoption is None
    if primary_code is None:
        expected_type = {
            "pre-query-raw": ChangesPreQueryPrimary,
            "execute": ChangesExecutePrimary,
            "fetch": ChangesFetchPrimary,
            "post-query-raw": ChangesPostQueryPrimary,
        }[case]
        assert type(primary) is expected_type
    else:
        assert type(primary) is ValueError
        assert primary.args == (primary_code,)
    if case in {"close", "post-query-lineage", "post-query-raw"}:
        assert native.changes_affected_rows == 1
    else:
        assert native.changes_affected_rows is None
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    _finalize(owner, primary)


@pytest.mark.parametrize(
    ("population", "case", "boundary"),
    [
        (0, "prepare", "serialized-changes-prepare"),
        (3, "shape", "serialized-changes-fetch"),
    ],
)
def test_changes_primary_affected_count_matches_exact_b2_population(
    monkeypatch: pytest.MonkeyPatch,
    population: int,
    case: str,
    boundary: str,
) -> None:
    graph, owner, primary, context, _tombstone, execution = _captured_changes_failure(
        monkeypatch, case, population=population
    )
    context_snapshot = outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        context
    )
    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, execution
    )
    assert context_snapshot.b2_cursor_count == population
    assert native.affected_rows == native.total_changes_delta == population
    assert native.cursor_ledger_after == native.cursor_ledger_delta == (population, 1, 1)
    assert _read_finalizer(owner).primary_boundary == boundary
    _finalize(owner, primary)


def test_execute_primary_uses_definition_time_leaf_and_wins_cleanup_precedence(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    location = tmp_path / "postconsume-changes-execute.sqlite3"
    graph, owner, primary, _context, _tombstone, execution = _captured_changes_failure(
        monkeypatch,
        "execute",
        location=location,
        definition_time_leaf_attack=True,
    )
    rollback = RollbackSecondary("execute rollback after return")
    close = CloseTertiary("execute close after return")
    finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
        owner, "rollback", rollback
    )
    finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
        owner, "close", close
    )
    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, execution
    )
    assert type(primary) is ChangesExecutePrimary
    assert native.changes_prepare_count == native.changes_release_count == 1
    assert native.changes_fetch_count == 0
    snapshot = _finalize(owner, primary)
    assert snapshot.primary_boundary == "serialized-changes-execute"
    assert snapshot.rollback_native_return_count == snapshot.close_native_return_count == 1
    assert [item.rank for item in snapshot.diagnostics] == [
        "primary",
        "secondary",
        "tertiary",
    ]
    reopened = sqlite3.connect(location)
    try:
        assert reopened.execute(
            "SELECT current_version FROM ge_cycle_schema WHERE singleton = 1"
        ).fetchone() == (1,)
        assert reopened.execute(
            "SELECT count(*) FROM ge_cycle_cursors "
            "WHERE descriptor_hash = ? AND schema_identity_sha256 = ?",
            (
                "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe",
                "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
            ),
        ).fetchone() == (1,)
    finally:
        reopened.close()


@pytest.mark.parametrize(
    ("case", "changes_counts"),
    [
        ("pre-query", (0, 0, 0)),
        ("prepare", (0, 0, 0)),
        ("execute", (1, 0, 1)),
        ("fetch", (1, 1, 1)),
        ("release", (1, 1, 1)),
        ("post-query", (1, 1, 1)),
    ],
)
def test_transferred_real_traceback_cannot_substitute_exact_lower_primary(
    monkeypatch: pytest.MonkeyPatch,
    case: str,
    changes_counts: tuple[int, int, int],
) -> None:
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    executions: list[Any] = []
    original_prepare = protocol.__dict__[
        "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic"
    ]
    original = source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes
    total_calls = 0
    real_primaries: list[BaseException] = []
    substitutes: list[SubstitutePrimary] = []
    lower_captures: list[Any] = []

    def prepare(connection: Any) -> Any:
        execution = original_prepare(connection)
        executions.append(execution)
        return execution

    def fail_execute(
        _cursor: sqlite3.Cursor,
        sql: str,
        parameters: tuple[()],
    ) -> sqlite3.Cursor:
        assert sql == source.SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
        assert parameters == ()
        raise ChangesExecutePrimary("real lower execute primary")

    def fail_pre_query(_raw: sqlite3.Connection) -> bool:
        raise ChangesPreQueryPrimary("real lower pre-query primary")

    def fail_prepare(_raw: sqlite3.Connection) -> sqlite3.Cursor:
        raise ChangesPreparePrimary("real lower prepare primary")

    def fail_fetch(_cursor: sqlite3.Cursor, size: int) -> object:
        assert size == 2
        raise ChangesFetchPrimary("real lower fetch primary")

    def fail_release(_cursor: sqlite3.Cursor) -> None:
        raise ChangesCloseSecondary("real lower release primary")

    def fail_second_total(raw: sqlite3.Connection) -> int:
        nonlocal total_calls
        total_calls += 1
        if total_calls == 1:
            return raw.total_changes
        raise ChangesPostQueryPrimary("real lower post-query primary")

    def prove(connection: Any, execution: Any) -> Any:
        try:
            if case == "pre-query":
                return original(
                    connection,
                    execution,
                    _native_in_transaction=fail_pre_query,
                )
            if case == "prepare":
                return original(connection, execution, _cursor_factory=fail_prepare)
            if case == "execute":
                return original(connection, execution, _cursor_execute=fail_execute)
            if case == "fetch":
                return original(connection, execution, _cursor_fetchmany=fail_fetch)
            if case == "release":
                return original(connection, execution, _cursor_close=fail_release)
            return original(connection, execution, _native_total_changes=fail_second_total)
        except BaseException as real:
            lower_phase = source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get()
            assert lower_phase is not None and lower_phase.phase == "recorded"
            lower_capture = lower_phase.capture
            assert lower_capture.state is source._cursor_publication_rebind_state(
                connection, execution
            )
            assert lower_capture.error is real
            assert lower_capture.boundary == f"serialized-changes-{case}"
            lower_captures.append(lower_capture)
            real_primaries.append(real)
            replacement = SubstitutePrimary(f"substituted {case} primary").with_traceback(
                real.__traceback__
            )
            substitutes.append(replacement)
            raise replacement from None

    monkeypatch.setattr(
        protocol,
        "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic",
        prepare,
    )
    monkeypatch.setattr(
        protocol,
        "_prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic",
        prove,
    )
    before = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_GRAPH$"):
        finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
            graph.connection, graph.authority, session
        )
    assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == before
    assert len(executions) == 1
    assert len(real_primaries) == len(substitutes) == len(lower_captures) == 1
    transferred = substitutes[0].__traceback__
    assert transferred is not None
    codes: list[Any] = []
    while transferred is not None:
        codes.append(transferred.tb_frame.f_code)
        transferred = transferred.tb_next
    assert original.__code__ in codes
    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, executions[0]
    )
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    assert lower_captures[0].connection is None
    assert lower_captures[0].state is None
    assert lower_captures[0].error is None
    assert lower_captures[0].boundary is None
    assert lower_captures[0].consumed and lower_captures[0].invalid
    assert native.lifecycle == "poisoned"
    assert (
        native.changes_prepare_count,
        native.changes_fetch_count,
        native.changes_release_count,
    ) == changes_counts
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY$"):
        source._take_sqlite_connection_cursor_publication_rebind_changes_primary_intrinsic(
            lower_captures[0], graph.connection, executions[0], real_primaries[0]
        )
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    graph.close()


@pytest.mark.parametrize(
    ("boundary", "primary_type"),
    [
        ("serialized-changes-pre-query", ChangesPreQueryPrimary),
        ("serialized-changes-post-query", ChangesPostQueryPrimary),
    ],
)
def test_equal_integer_identity_cannot_substitute_live_exact_primary(
    monkeypatch: pytest.MonkeyPatch,
    boundary: str,
    primary_type: type[BaseException],
) -> None:
    """Regress CPython id reuse: numeric equality is never identity evidence."""

    graph, owner, captured_primary, _context, _tombstone, execution = _captured_changes_failure(
        monkeypatch, "shape"
    )
    capture, token = (
        source._arm_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            graph.connection
        )
    )
    exact = primary_type("exact lower primary")
    exact_ref = ref(exact)
    exact_id = id(exact)
    state = source._cursor_publication_rebind_state(graph.connection, execution)
    source._record_cursor_publication_rebind_changes_primary_exact(
        state, exact, cast(Any, boundary)
    )
    del exact
    assert exact_ref() is capture.error
    substitute: BaseException | None = None
    for _ in range(4_096):
        candidate = primary_type("attempted id reuse substitute")
        assert id(candidate) != exact_id
        substitute = candidate
    assert substitute is not None
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY$"):
            source._take_sqlite_connection_cursor_publication_rebind_changes_primary_intrinsic(
                capture, graph.connection, execution, substitute
            )
        assert capture.connection is None
        assert capture.state is capture.error is capture.boundary is None
        assert capture.consumed and capture.invalid
    finally:
        source._reset_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            capture, token
        )
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    for _ in range(6):
        gc.collect()
    assert exact_ref() is None
    _finalize(owner, captured_primary)


def test_unarmed_direct_lower_primary_abandonment_releases_error_and_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A direct lower call has no capture ticket and leaves no global E root."""

    for _ in range(3):
        gc.collect()
    baseline = len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS)
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    executions: list[Any] = []
    original_prepare = protocol.__dict__[
        "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic"
    ]
    original = source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes

    def prepare(connection: Any) -> Any:
        execution = original_prepare(connection)
        executions.append(execution)
        return execution

    def fail_pre_query(_raw: sqlite3.Connection) -> bool:
        raise ChangesPreQueryPrimary("unarmed direct lower primary")

    def prove(connection: Any, execution: Any) -> Any:
        return original(
            connection,
            execution,
            _native_in_transaction=fail_pre_query,
        )

    monkeypatch.setattr(
        protocol,
        "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic",
        prepare,
    )
    monkeypatch.setattr(
        protocol,
        "_prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic",
        prove,
    )
    with pytest.raises(ChangesPreQueryPrimary) as raised:
        protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(session)
    assert len(executions) == 1
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    execution = executions.pop()
    execution_ref = ref(execution)
    error = raised.value
    error_ref = ref(error)
    authority_ref = ref(graph.authority)
    assert len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS) == baseline + 1

    monkeypatch.undo()
    graph.close()
    del error, execution, graph, raised, session
    for _ in range(16):
        gc.collect()
    assert execution_ref() is error_ref() is authority_ref() is None
    assert len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS) == baseline
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None


def test_copied_context_lower_primary_cannot_mint_or_retain_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for _ in range(3):
        gc.collect()
    baseline = len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS)
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    executions: list[Any] = []
    copied_contexts: list[Any] = []
    error_refs: list[Any] = []
    original_prepare = protocol.__dict__[
        "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic"
    ]
    original = source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes

    def prepare(connection: Any) -> Any:
        execution = original_prepare(connection)
        executions.append(execution)
        return execution

    def fail_pre_query(_raw: sqlite3.Connection) -> bool:
        error = ChangesPreQueryPrimary("copied-context lower primary")
        error_refs.append(ref(error))
        raise error

    def prove(connection: Any, execution: Any) -> Any:
        copied = copy_context()
        copied_contexts.append(copied)
        return copied.run(
            original,
            connection,
            execution,
            source._cursor_publication_rebind_state,
            fail_pre_query,
        )

    monkeypatch.setattr(
        protocol,
        "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic",
        prepare,
    )
    monkeypatch.setattr(
        protocol,
        "_prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic",
        prove,
    )
    before = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_GRAPH$"):
        finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
            graph.connection, graph.authority, session
        )
    assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == before
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    assert len(executions) == len(copied_contexts) == len(error_refs) == 1
    retained_phase = copied_contexts[0].get(source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE)
    assert retained_phase is not None and retained_phase.phase == "recorded"
    retained_capture = retained_phase.capture
    assert retained_capture.connection is None
    assert retained_capture.state is retained_capture.error is retained_capture.boundary is None
    assert retained_capture.consumed and retained_capture.invalid

    execution = executions.pop()
    execution_ref = ref(execution)
    authority_ref = ref(graph.authority)
    monkeypatch.undo()
    graph.close()
    del execution, graph, retained_capture, retained_phase, session
    for _ in range(16):
        gc.collect()
    assert execution_ref() is error_refs[0]() is authority_ref() is None
    assert len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS) == baseline
    assert copied_contexts[0].get(source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE) is not None


def test_capture_ticket_nested_cross_connection_and_reset_replay_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    right, owner, primary, _context, _tombstone, execution = _captured_changes_failure(
        monkeypatch, "shape"
    )
    left = _CursorAdoptionGraph(0)
    capture, token = (
        source._arm_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            left.connection
        )
    )
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY$"):
        source._arm_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            left.connection
        )
    cross_error = ChangesFetchPrimary("cross-connection primary")
    source._record_cursor_publication_rebind_changes_primary_exact(
        source._cursor_publication_rebind_state(right.connection, execution),
        cross_error,
        "serialized-changes-fetch",
    )
    assert capture.invalid
    assert capture.state is capture.error is capture.boundary is None
    source._reset_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
        capture, token
    )
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY$"):
        source._reset_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            capture, token
        )
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    left.close()
    _finalize(owner, primary)


def test_serialized_changes_fetch_primary_wins_over_changes_close_and_cleanup_faults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph, owner, primary, _context, _tombstone, _execution = _captured_changes_failure(
        monkeypatch, "shape-and-close"
    )
    rollback = RollbackSecondary("rollback after return")
    close = CloseTertiary("close after return")
    finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
        owner, "rollback", rollback
    )
    finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
        owner, "close", close
    )
    snapshot = _finalize(owner, primary)
    assert type(primary) is ValueError
    assert primary.args == ("GE_CURSOR_B3_CURSOR_CHANGES_SHAPE",)
    assert snapshot.primary_boundary == "serialized-changes-fetch"
    assert [item.rank for item in snapshot.diagnostics] == [
        "primary",
        "secondary",
        "tertiary",
    ]
    with pytest.raises(sqlite3.ProgrammingError, match="closed database"):
        graph.connection.execute("SELECT 1")


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
    primary = finalizer._owner_presentation(owner)[6]
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


def test_serialized_changes_primary_real_rollback_close_reopen_restores_native_write(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    location = tmp_path / "postconsume-changes.sqlite3"
    graph, owner, primary, _context, _tombstone, execution = _captured_changes_failure(
        monkeypatch, "close", location=location
    )
    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, execution
    )
    assert native.affected_rows == native.total_changes_delta == 1
    assert native.changes_affected_rows == 1
    assert _read_finalizer(owner).primary_boundary == "serialized-changes-release"
    snapshot = _finalize(owner, primary)
    assert snapshot.rollback_attempt_count == snapshot.rollback_native_return_count == 1
    assert snapshot.close_attempt_count == snapshot.close_native_return_count == 1

    reopened = sqlite3.connect(location)
    try:
        assert reopened.execute(
            "SELECT current_version FROM ge_cycle_schema WHERE singleton = 1"
        ).fetchone() == (1,)
        assert reopened.execute(
            "SELECT count(*) FROM ge_cycle_cursors "
            "WHERE descriptor_hash = ? AND schema_identity_sha256 = ?",
            (
                "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe",
                "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
            ),
        ).fetchone() == (1,)
    finally:
        reopened.close()

    monkeypatch.undo()
    fresh = _CursorAdoptionGraph(1)
    try:
        receipt = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(fresh)
        )
        result = protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(receipt)
        assert result.violation_count == 0
        assert result.counts == (1, 1, 1, 1, 1)
    finally:
        fresh.close()


def test_real_after_update_counter_amplification_finalizes_and_rolls_back(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    location = tmp_path / "postconsume-trigger-amplification.sqlite3"
    original_init = source.SQLiteV1BaselineConnectionOwner.__init__
    with monkeypatch.context() as redirected:
        redirected.setattr(
            source.SQLiteV1BaselineConnectionOwner,
            "__init__",
            lambda owner, _location: original_init(owner, str(location)),
        )
        graph = _CursorAdoptionGraph(1)
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(graph.connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    raw.execute("CREATE TABLE main.rebind_audit (tenant_id TEXT NOT NULL)").close()
    raw.execute(
        "CREATE TRIGGER main.rebind_audit_trigger "
        "AFTER UPDATE ON main.ge_cycle_cursors "
        "BEGIN INSERT INTO rebind_audit (tenant_id) VALUES (NEW.tenant_id); END"
    ).close()
    write_before = len(protocol._WRITE_RECEIPTS)
    rule11_before = len(protocol._RULE11_RECEIPTS)

    owner = finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
        graph.connection, graph.authority, _session(graph)
    )
    (
        _connection,
        _authority,
        _context,
        _tombstone,
        execution,
        _generation,
        primary,
        adoption,
        write,
    ) = finalizer._owner_presentation(owner)
    assert adoption is None and write is None
    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, execution
    )
    assert type(primary) is ValueError
    assert primary.args == ("GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE",)
    assert _read_finalizer(owner).primary_boundary == "serialized-changes-post-query"
    assert (native.affected_rows, native.changes_affected_rows) == (1, 1)
    assert native.total_changes_delta == 2
    assert native.cursor_ledger_after == native.cursor_ledger_delta == (1, 1, 1)
    assert (
        native.changes_prepare_count,
        native.changes_fetch_count,
        native.changes_release_count,
    ) == (1, 1, 1)
    assert raw.execute("SELECT count(*) FROM main.rebind_audit").fetchone() == (1,)
    assert len(protocol._WRITE_RECEIPTS) == write_before
    assert len(protocol._RULE11_RECEIPTS) == rule11_before
    snapshot = _finalize(owner, primary)
    assert snapshot.rollback_native_return_count == snapshot.close_native_return_count == 1

    reopened = sqlite3.connect(location)
    try:
        assert reopened.execute(
            "SELECT count(*) FROM sqlite_master "
            "WHERE type IN ('table', 'trigger') "
            "AND name IN ('rebind_audit', 'rebind_audit_trigger')"
        ).fetchone() == (0,)
        assert reopened.execute(
            "SELECT count(*) FROM ge_cycle_cursors "
            "WHERE descriptor_hash = ? AND schema_identity_sha256 = ?",
            (
                "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe",
                "f3d961d4d96e93a7fab13a91b374c27ff877a93332ff7ed7426f1fff982baff4",
            ),
        ).fetchone() == (1,)
    finally:
        reopened.close()


def test_trigger_counter_mismatch_does_not_admit_raw_post_query_primary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _CursorAdoptionGraph(1)
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(graph.connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    raw.execute("CREATE TABLE main.rebind_audit (tenant_id TEXT NOT NULL)").close()
    raw.execute(
        "CREATE TRIGGER main.rebind_audit_trigger "
        "AFTER UPDATE ON main.ge_cycle_cursors "
        "BEGIN INSERT INTO rebind_audit (tenant_id) VALUES (NEW.tenant_id); END"
    ).close()
    original = source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes
    total_calls = 0

    def total_then_fail(connection: sqlite3.Connection) -> int:
        nonlocal total_calls
        total_calls += 1
        if total_calls == 1:
            return connection.total_changes
        raise ChangesPostQueryPrimary("raw post-query fault")

    def prove(connection: Any, execution: Any) -> Any:
        return original(
            connection,
            execution,
            _native_total_changes=total_then_fail,
        )

    monkeypatch.setattr(
        protocol,
        "_prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic",
        prove,
    )
    before = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    write_before = len(protocol._WRITE_RECEIPTS)
    rule11_before = len(protocol._RULE11_RECEIPTS)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_POSTCONSUME_GRAPH$"):
        finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
            graph.connection, graph.authority, _session(graph)
        )
    assert total_calls == 2
    assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == before
    assert len(protocol._WRITE_RECEIPTS) == write_before
    assert len(protocol._RULE11_RECEIPTS) == rule11_before
    assert source._CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is None
    graph.close()


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


def test_abandoned_serialized_changes_owner_reverse_primary_graph_collects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for _ in range(3):
        gc.collect()
    baseline = (
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS),
        len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT),
    )
    graph, owner, primary, context, tombstone, execution = _captured_changes_failure(
        monkeypatch, "shape"
    )
    cast(Any, primary).graph = graph
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
    monkeypatch.undo()
    graph.close()
    del context, execution, graph, owner, primary, tombstone
    for _ in range(16):
        gc.collect()
    assert all(item() is None for item in weak)
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


_CANONICAL_EVIDENCE_MISMATCH_MATRIX = (
    ("N+C", ("native-affected", "changes-affected")),
    ("N+T", ("native-affected", "total-delta")),
    ("N+O", ("native-affected", "outer-ledger")),
    ("N+L", ("native-affected", "cursor-ledger")),
    ("C+T", ("changes-affected", "total-delta")),
    ("C+O", ("changes-affected", "outer-ledger")),
    ("C+L", ("changes-affected", "cursor-ledger")),
    ("T+O", ("total-delta", "outer-ledger")),
    ("T+L", ("total-delta", "cursor-ledger")),
    ("O+L", ("outer-ledger", "cursor-ledger")),
    ("N+C+T", ("native-affected", "changes-affected", "total-delta")),
    ("C+O+L", ("changes-affected", "outer-ledger", "cursor-ledger")),
    (
        "N+C+T+L",
        ("native-affected", "changes-affected", "total-delta", "cursor-ledger"),
    ),
    (
        "N+C+T+O+L",
        (
            "native-affected",
            "changes-affected",
            "total-delta",
            "outer-ledger",
            "cursor-ledger",
        ),
    ),
)


@pytest.mark.parametrize(
    ("_case_id", "dimensions"),
    _CANONICAL_EVIDENCE_MISMATCH_MATRIX,
    ids=[case_id for case_id, _dimensions in _CANONICAL_EVIDENCE_MISMATCH_MATRIX],
)
def test_pair_multi_evidence_matrix_captures_completed_e_and_finalizes_exact_primary(
    _case_id: str,
    dimensions: tuple[str, ...],
) -> None:
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    protocol._arm_sqlite_cursor_publication_rebind_evidence_mismatch_for_test_intrinsic(
        session, dimensions
    )

    owner = finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
        graph.connection, graph.authority, session
    )
    (
        connection,
        authority,
        context,
        tombstone,
        execution,
        _generation,
        primary,
        adoption,
        write,
    ) = finalizer._owner_presentation(owner)
    assert connection is graph.connection
    assert authority is graph.authority
    assert adoption is not None

    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, execution
    )
    assert native.lifecycle == "completed"
    assert (
        native.affected_rows,
        native.changes_affected_rows,
        native.total_changes_delta,
        native.cursor_ledger_delta.affected_rows_watermark,
    ) == (1, 1, 1, 1)
    assert native.cursor_ledger_before == (0, 0, 0)
    assert native.cursor_ledger_after == native.cursor_ledger_delta == (1, 1, 1)

    outcome = (
        protocol._read_sqlite_cursor_publication_rebind_evidence_mismatch_outcome_for_test_intrinsic(
            graph.connection, execution
        )
    )
    assert outcome.dimensions == dimensions
    assert outcome.evaluated_dimensions == dimensions
    assert outcome.real_evidence_observed is True
    assert outcome.observed_counts == protocol._Rule11CountProjection(1, 1, 1, 1, 1)
    assert outcome.projected_counts == protocol._Rule11CountProjection(
        1,
        1 + int("native-affected" in dimensions),
        1 + int("changes-affected" in dimensions),
        1 + int("total-delta" in dimensions),
        1 + int("cursor-ledger" in dimensions),
    )
    assert outcome.check.accepted is False
    assert outcome.check.violation_count == 1
    assert outcome.outer_mismatch is ("outer-ledger" in dimensions)
    assert outcome.rule11_lifecycle == "absent"
    assert outcome.tombstone_lifecycle == outcome.adoption_lifecycle == "poisoned"

    context_snapshot = (
        outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(context)
    )
    tombstone_snapshot = (
        outer._read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic(
            tombstone
        )
    )
    authority_snapshot = (
        outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
    )
    assert context_snapshot.lifecycle == tombstone_snapshot.lifecycle == "poisoned"
    assert authority_snapshot.post_rebind_watermark_adoption is adoption
    assert authority_snapshot.lifecycle == authority_snapshot.write_phase == "poisoned"

    selected = _read_finalizer(owner)
    if "outer-ledger" in dimensions:
        assert write is None
        assert outcome.write_lifecycle == "absent"
        assert outcome.first_poison_reason == (
            "SQLite rebind evidence mismatch outer ledger"
        )
        assert selected.primary_boundary == "rule11-outer-ledger"
        assert type(primary) is ValueError
        assert primary.args == ("GE_CURSOR_B3_REBIND_EVIDENCE_OUTER",)
    else:
        assert write is not None
        assert outcome.write_lifecycle == "poisoned"
        assert outcome.first_poison_reason == "SQLite Rule 11 five counts disagree"
        assert selected.primary_boundary == "rule11-five-count"
        assert type(primary) is ValueError
        assert primary.args == ("GE_CURSOR_B3_RULE11_COUNT_MISMATCH",)

    finalized = _finalize(owner, primary)
    assert finalized.rollback_attempt_count == finalized.rollback_native_return_count == 1
    assert finalized.close_attempt_count == finalized.close_native_return_count == 1
    assert finalizer._owner_presentation(owner) == (None,) * 9


def test_all_five_cleanup_primary_precedes_ambiguous_faults_and_fresh_graph_succeeds(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    location = tmp_path / "all-five-recovery.sqlite3"
    original_init = source.SQLiteV1BaselineConnectionOwner.__init__
    with monkeypatch.context() as redirected:
        redirected.setattr(
            source.SQLiteV1BaselineConnectionOwner,
            "__init__",
            lambda owner, _location: original_init(owner, str(location)),
        )
        graph = _CursorAdoptionGraph(1)
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(
            graph.connection, "_SQLiteV1BaselineConnectionOwner__connection"
        ),
    )
    before = raw.execute("SELECT * FROM main.ge_cycle_cursors ORDER BY tenant_id").fetchall()
    assert raw.execute("PRAGMA main.user_version").fetchone() == (2,)
    assert raw.execute("SELECT COUNT(*) FROM main.ge_cycle_schema").fetchone() == (1,)
    assert raw.execute("SELECT COUNT(*) FROM main.ge_cycle_cursors").fetchone() == (1,)
    session = _session(graph)
    dimensions = _CANONICAL_EVIDENCE_MISMATCH_MATRIX[-1][1]
    protocol._arm_sqlite_cursor_publication_rebind_evidence_mismatch_for_test_intrinsic(
        session, dimensions
    )
    owner = finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
        graph.connection, graph.authority, session
    )
    primary = finalizer._owner_presentation(owner)[6]
    rollback_fault = RollbackSecondary("after rollback return")
    close_fault = CloseTertiary("after close return")
    finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
        owner, "rollback", rollback_fault
    )
    finalizer._arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
        owner, "close", close_fault
    )
    finalized = _finalize(owner, primary)
    assert finalized.primary_boundary == "rule11-outer-ledger"
    assert finalized.rollback_after_native_return_ambiguous_fault_count == 1
    assert finalized.close_after_native_return_ambiguous_fault_count == 1
    assert [diagnostic.rank for diagnostic in finalized.diagnostics] == [
        "primary",
        "secondary",
        "tertiary",
    ]
    reopened = sqlite3.connect(location)
    try:
        after = reopened.execute(
            "SELECT * FROM main.ge_cycle_cursors ORDER BY tenant_id"
        ).fetchall()
        assert reopened.execute("PRAGMA main.user_version").fetchone() == (1,)
        assert reopened.execute("PRAGMA main.application_id").fetchone() == (1_195_724_359,)
        assert reopened.execute("SELECT COUNT(*) FROM main.ge_cycle_schema").fetchone() == (
            1,
        )
        assert reopened.execute("SELECT COUNT(*) FROM main.ge_cycle_cursors").fetchone() == (
            1,
        )
        assert reopened.execute(
            "SELECT COUNT(*) FROM main.sqlite_master "
            "WHERE name IN ('ge_cycle_operation_baselines', "
            "'ge_cycle_operation_baseline_entries')"
        ).fetchone() == (0,)
        assert reopened.execute("PRAGMA main.integrity_check").fetchone() == ("ok",)
        assert reopened.execute("PRAGMA main.foreign_key_check").fetchall() == []
    finally:
        reopened.close()
    assert after == before

    fresh = _CursorAdoptionGraph(1)
    result = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
        _session(fresh)
    )
    assert (
        protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
            result
        ).violation_count
        == 0
    )
    fresh.connection.rollback()
    fresh.connection.close()


def test_completed_finalizer_rejects_hostile_mutated_boundary_before_io() -> None:
    class HostileBoundary(str):
        hooks = 0

        def __hash__(self) -> int:
            type(self).hooks += 1
            raise AssertionError("hostile boundary hash executed")

        def __eq__(self, _other: object) -> bool:
            type(self).hooks += 1
            raise AssertionError("hostile boundary equality executed")

        def __bool__(self) -> bool:
            type(self).hooks += 1
            raise AssertionError("hostile boundary truthiness executed")

    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    protocol._arm_sqlite_cursor_publication_rebind_evidence_mismatch_for_test_intrinsic(
        session, ("native-affected", "changes-affected")
    )
    owner = finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
        graph.connection, graph.authority, session
    )
    primary = finalizer._owner_presentation(owner)[6]
    state = finalizer._state(owner)
    state.primary_boundary = cast(Any, HostileBoundary("rule11-five-count"))
    with pytest.raises(ValueError, match="GE_CURSOR_B3_POSTCONSUME_GRAPH"):
        finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(owner)
    assert HostileBoundary.hooks == 0
    assert state.lifecycle == "prepared"
    assert state.owner_consume_count == 0
    assert state.rollback_attempt_count == state.close_attempt_count == 0

    state.primary_boundary = "rule11-five-count"
    _finalize(owner, primary)


def test_completed_capture_survives_copy_context_and_finalize_replay_is_zero_io() -> None:
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    protocol._arm_sqlite_cursor_publication_rebind_evidence_mismatch_for_test_intrinsic(
        session, ("native-affected", "changes-affected")
    )
    owner = copy_context().run(
        finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic,
        graph.connection,
        graph.authority,
        session,
    )
    primary = finalizer._owner_presentation(owner)[6]
    finalized = _finalize(owner, primary)
    assert finalized.primary_boundary == "rule11-five-count"
    assert finalized.rollback_attempt_count == finalized.close_attempt_count == 1
    with pytest.raises(ValueError, match="GE_CURSOR_B3_POSTCONSUME_REPLAY"):
        finalizer._finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(owner)
    replayed = _read_finalizer(owner)
    assert replayed.rollback_attempt_count == replayed.close_attempt_count == 1


def test_completed_finalizer_strong_a_w_presentation_clears_and_collects() -> None:
    def capture_finalize_drop() -> tuple[Any, list[Any]]:
        graph = _CursorAdoptionGraph(1)
        session = _session(graph)
        protocol._arm_sqlite_cursor_publication_rebind_evidence_mismatch_for_test_intrinsic(
            session, ("native-affected", "changes-affected")
        )
        owner = (
            finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
                graph.connection, graph.authority, session
            )
        )
        presentation = finalizer._owner_presentation(owner)
        primary = presentation[6]
        adoption = presentation[7]
        write = presentation[8]
        assert adoption is not None and write is not None
        marker = PrimaryCollectionMarker()
        cast(Any, primary).collection_marker = marker
        weak = [ref(adoption), ref(write), ref(marker)]
        _finalize(owner, primary)
        assert finalizer._owner_presentation(owner) == (None,) * 9
        return owner, weak

    owner, weak = capture_finalize_drop()
    for _ in range(16):
        gc.collect()
    assert all(item() is None for item in weak)
    assert _read_finalizer(owner).lifecycle == "finalized"


def test_generic_completed_rule11_registration_error_is_not_finalizer_admitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class GenericRule11Registration(BaseException):
        pass

    graph = _CursorAdoptionGraph(1)
    session = _session(graph)

    def reject_registration(*_args: object) -> None:
        raise GenericRule11Registration("generic registration failure")

    baseline = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    monkeypatch.setattr(protocol, "_REGISTER_RULE11", reject_registration)
    with pytest.raises(ValueError, match="GE_CURSOR_B3_POSTCONSUME_GRAPH"):
        finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
            graph.connection, graph.authority, session
        )
    assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == baseline
    authority_snapshot = (
        outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
    )
    assert authority_snapshot.lifecycle == "poisoned"
    assert authority_snapshot.stage_ownership_poison_reason != (
        "SQLite Rule 11 five counts disagree"
    )
    graph.connection.rollback()
    graph.connection.close()


def test_generic_evidence_write_drift_is_not_completed_finalizer_admitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    protocol._arm_sqlite_cursor_publication_rebind_evidence_mismatch_for_test_intrinsic(
        session, ("native-affected", "changes-affected")
    )
    original_rule11 = protocol._execute_sqlite_cursor_publication_rule11_intrinsic

    def drift(receipt: Any) -> Any:
        entry = protocol._WRITE_RECEIPTS[id(receipt)]
        write_record = cast(Any, entry.value)
        write_record.snapshot = write_record.snapshot._replace(
            counts=protocol._Rule11CountProjection(1, 2, 1, 1, 1)
        )
        return original_rule11(receipt)

    monkeypatch.setattr(
        protocol, "_execute_sqlite_cursor_publication_rule11_intrinsic", drift
    )
    baseline = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    with pytest.raises(ValueError, match="GE_CURSOR_B3_POSTCONSUME_GRAPH"):
        finalizer._capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic(
            graph.connection, graph.authority, session
        )
    assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == baseline
    authority_snapshot = (
        outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
    )
    context = authority_snapshot.publication_rebind_context
    assert context is not None
    execution = outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        context
    ).execution
    outcome = (
        protocol._read_sqlite_cursor_publication_rebind_evidence_mismatch_outcome_for_test_intrinsic(
            graph.connection, execution
        )
    )
    assert outcome.first_poison_reason == "SQLite Rule 11 failed"
    assert outcome.tombstone_lifecycle == outcome.adoption_lifecycle == "poisoned"
    assert outcome.write_lifecycle == "poisoned"
    assert outcome.rule11_lifecycle == "absent"
    graph.connection.rollback()
    graph.connection.close()


def test_completed_primary_take_substitution_clears_before_validation_and_replay() -> None:
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    protocol._arm_sqlite_cursor_publication_rebind_evidence_mismatch_for_test_intrinsic(
        session, ("native-affected", "changes-affected")
    )
    capture, token = (
        source._arm_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            graph.connection
        )
    )
    baseline = len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS)
    primary: BaseException | None = None
    try:
        try:
            protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(session)
        except BaseException as error:
            primary = error
        assert primary is not None
        authority_snapshot = (
            outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                graph.authority
            )
        )
        context = authority_snapshot.publication_rebind_context
        assert context is not None
        execution = (
            outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
                context
            ).execution
        )
        substitute = SubstitutePrimary("wrong completed E")
        with pytest.raises(ValueError, match="GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY"):
            source._take_sqlite_connection_cursor_publication_rebind_changes_primary_intrinsic(
                capture, graph.connection, execution, substitute
            )
        assert capture.connection is None
        assert capture.state is None
        assert capture.error is None
        assert capture.boundary is None
        assert capture.consumed is True
        assert capture.invalid is True
        with pytest.raises(ValueError, match="GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY"):
            source._take_sqlite_connection_cursor_publication_rebind_changes_primary_intrinsic(
                capture, graph.connection, execution, primary
            )
        assert len(finalizer._POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS) == baseline
    finally:
        source._reset_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            capture, token
        )
        graph.connection.rollback()
        graph.connection.close()
