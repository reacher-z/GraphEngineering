from __future__ import annotations

import gc
import hashlib
import sqlite3
from pathlib import Path
from typing import Any, cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_operation_baseline_source as source
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_V2 = ROOT / "spec/migrations/sqlite/schema-v2.sql"
SOURCE_DESCRIPTOR = "1" * 64
SOURCE_SCHEMA = "2" * 64
TARGET_DESCRIPTOR = "3" * 64
TARGET_SCHEMA = "4" * 64


def _expect(code: str) -> pytest.RaisesExc[ValueError]:
    return pytest.raises(ValueError, match=f"^{code}$")


def _open_target(*, cursor_count: int = 1) -> SQLiteV1BaselineConnectionOwner:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    connection.executescript(SCHEMA_V2.read_text(encoding="utf-8"))
    for ordinal in range(cursor_count):
        connection.execute(
            """INSERT INTO main.ge_cycle_cursors
               (tenant_id, token_hash, kind, principal_hash,
                authorization_hash, stream_id, checkpoint_scope,
                request_scope_blob, page_size, next_position,
                snapshot_tail_sequence, snapshot_tail_record_hash,
                descriptor_hash, schema_identity_sha256, snapshot_blob,
                created_at_ms, expires_at_ms, consumed_at_ms)
               VALUES (?, ?, 'event', ?, ?, ?, NULL, ?, 1, 0, -1, NULL,
                       ?, ?, ?, 1, 2, NULL)""",
            (
                f"tenant-{ordinal}",
                f"{ordinal + 10:064x}",
                "5" * 64,
                "6" * 64,
                f"stream-{ordinal}",
                b"{}",
                SOURCE_DESCRIPTOR,
                SOURCE_SCHEMA,
                b"{}",
            ),
        ).close()
    connection.commit()
    connection.execute("BEGIN EXCLUSIVE").close()
    return connection


def _close(connection: SQLiteV1BaselineConnectionOwner) -> None:
    try:
        if connection.in_transaction:
            connection.rollback()
    finally:
        connection.close()


def _prepare(connection: SQLiteV1BaselineConnectionOwner) -> object:
    return source._prepare_sqlite_connection_cursor_publication_rebind_intrinsic(connection)


def _execute(connection: SQLiteV1BaselineConnectionOwner, execution: object) -> Any:
    return source._execute_sqlite_connection_cursor_publication_rebind_intrinsic(
        connection,
        cast(Any, execution),
        TARGET_DESCRIPTOR,
        TARGET_SCHEMA,
        SOURCE_DESCRIPTOR,
        SOURCE_SCHEMA,
    )


def _release(connection: SQLiteV1BaselineConnectionOwner, execution: object) -> Any:
    return source._release_sqlite_connection_cursor_publication_rebind_intrinsic(
        connection, cast(Any, execution)
    )


def _prove_changes(connection: SQLiteV1BaselineConnectionOwner, execution: object) -> Any:
    return source._prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic(
        connection, cast(Any, execution)
    )


def _state(execution: object) -> Any:
    return source._CURSOR_PUBLICATION_REBIND_EXECUTIONS[id(execution)][1]


def _raw(connection: SQLiteV1BaselineConnectionOwner) -> sqlite3.Connection:
    return cast(
        sqlite3.Connection,
        object.__getattribute__(connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )


def test_fixed_rebind_and_independent_changes_proof_complete_exactly_once() -> None:
    connection = _open_target(cursor_count=2)
    try:
        before_epoch = connection.transaction_epoch
        before_total = connection.total_changes
        execution = _prepare(connection)
        prepared = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert prepared.lifecycle == "prepared"
        assert prepared.rebind_sql == source.SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC
        assert hashlib.sha256(prepared.rebind_sql.encode()).hexdigest() == (
            prepared.rebind_sql_sha256
        )
        assert prepared.changes_sql == "SELECT changes() AS affected_rows"
        assert hashlib.sha256(prepared.changes_sql.encode()).hexdigest() == (
            prepared.changes_sql_sha256
        )
        assert prepared.parameter_order == (
            "targetDescriptorHash",
            "targetSchemaIdentitySha256",
            "sourceDescriptorHash",
            "sourceSchemaIdentitySha256",
        )
        assert (prepared.prepare_count, prepared.execute_count, prepared.release_count) == (
            1,
            0,
            0,
        )

        executed = _execute(connection, execution)
        assert executed.lifecycle == "executed"
        assert executed.parameters == (
            TARGET_DESCRIPTOR,
            TARGET_SCHEMA,
            SOURCE_DESCRIPTOR,
            SOURCE_SCHEMA,
        )
        assert executed.affected_rows == 2
        assert executed.total_changes_before == before_total
        assert executed.total_changes_delta == 2
        assert executed.transaction_epoch_before == before_epoch
        assert executed.transaction_epoch == before_epoch + 1
        assert executed.cursor_ledger_before == (0, 0, 0)
        assert executed.cursor_ledger_after == (2, 1, 1)
        assert executed.cursor_ledger_delta == (2, 1, 1)

        released = _release(connection, execution)
        assert released.lifecycle == "released"
        completed = _prove_changes(connection, execution)
        assert completed.lifecycle == "completed"
        assert (completed.prepare_count, completed.execute_count, completed.release_count) == (
            1,
            1,
            1,
        )
        assert (
            completed.changes_prepare_count,
            completed.changes_fetch_count,
            completed.changes_release_count,
        ) == (1, 1, 1)
        assert completed.changes_affected_rows == completed.affected_rows == 2
        rows = connection.execute(
            "SELECT DISTINCT descriptor_hash, schema_identity_sha256 FROM main.ge_cycle_cursors"
        ).fetchmany(3)
        assert rows == [(TARGET_DESCRIPTOR, TARGET_SCHEMA)]
        assert not hasattr(execution, "cursor")
        assert not hasattr(execution, "connection")
    finally:
        _close(connection)


def test_zero_affected_rows_is_proved_without_inventing_success_semantics() -> None:
    connection = _open_target(cursor_count=0)
    try:
        execution = _prepare(connection)
        assert _execute(connection, execution).affected_rows == 0
        _release(connection, execution)
        completed = _prove_changes(connection, execution)
        assert completed.changes_affected_rows == 0
        assert completed.total_changes_delta == 0
        assert completed.cursor_ledger_after == (0, 1, 1)
    finally:
        _close(connection)


def test_prepare_requires_exclusive_lineage_and_execution_rejects_lineage_drift() -> None:
    connection = _open_target()
    try:
        connection.rollback()
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_LINEAGE"):
            _prepare(connection)
        connection.execute("BEGIN EXCLUSIVE").close()
        execution = _prepare(connection)
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_LINEAGE"):
            _execute(connection, execution)
        assert _release(connection, execution).lifecycle == "poisoned"
    finally:
        _close(connection)


def test_parameters_reject_hostile_values_without_hash_or_equality_hooks() -> None:
    class Hostile:
        calls = 0

        def __hash__(self) -> int:
            type(self).calls += 1
            raise AssertionError("must not hash")

        def __eq__(self, other: object) -> bool:
            type(self).calls += 1
            raise AssertionError("must not compare")

    connection = _open_target()
    try:
        execution = _prepare(connection)
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_PARAMETERS"):
            source._execute_sqlite_connection_cursor_publication_rebind_intrinsic(
                connection,
                cast(Any, execution),
                Hostile(),
                TARGET_SCHEMA,
                SOURCE_DESCRIPTOR,
                SOURCE_SCHEMA,
            )
        assert Hostile.calls == 0
        snapshot = _release(connection, execution)
        assert (snapshot.execute_count, snapshot.release_count) == (0, 1)
    finally:
        _close(connection)


def test_same_value_replay_is_rejected_before_update_with_zero_progress() -> None:
    connection = _open_target()
    try:
        before_total = connection.total_changes
        execution = _prepare(connection)
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_PARAMETERS"):
            source._execute_sqlite_connection_cursor_publication_rebind_intrinsic(
                connection,
                cast(Any, execution),
                SOURCE_DESCRIPTOR,
                SOURCE_SCHEMA,
                SOURCE_DESCRIPTOR,
                SOURCE_SCHEMA,
            )
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_LINEAGE"):
            _execute(connection, execution)
        snapshot = _release(connection, execution)
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.total_changes_before == before_total
        assert snapshot.total_changes_delta == 0
        assert snapshot.affected_rows is None
        assert (snapshot.execute_count, snapshot.release_count) == (0, 1)
        assert snapshot.cursor_ledger_after == (0, 0, 0)
        assert connection.execute(
            "SELECT descriptor_hash, schema_identity_sha256 "
            "FROM main.ge_cycle_cursors"
        ).fetchone() == (SOURCE_DESCRIPTOR, SOURCE_SCHEMA)
    finally:
        _close(connection)


def test_handle_is_exact_connection_bound_and_lifecycle_is_terminal() -> None:
    first = _open_target()
    second = _open_target()
    try:
        execution = _prepare(first)
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION"):
            _execute(second, execution)
        _execute(first, execution)
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_LINEAGE"):
            _execute(first, execution)
        _release(first, execution)
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_RELEASE"):
            _release(first, execution)
    finally:
        _close(first)
        _close(second)


def test_foreign_cursor_and_hostile_proxy_injection_are_rejected_before_use() -> None:
    class HostileCursor:
        calls = 0

        def __hash__(self) -> int:
            type(self).calls += 1
            raise AssertionError("must not hash")

        def __eq__(self, other: object) -> bool:
            type(self).calls += 1
            raise AssertionError("must not compare")

    connection = _open_target()
    foreign = sqlite3.connect(":memory:")
    try:
        execution = _prepare(connection)
        state = _state(execution)
        source._CURSOR_REBIND_SQLITE_CURSOR_CLOSE(state.cursor)
        state.cursor = foreign.cursor()
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION"):
            _execute(connection, execution)
        state.cursor.close()
        state.cursor = cast(Any, HostileCursor())
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION"):
            _execute(connection, execution)
        assert HostileCursor.calls == 0
        state.cursor = None
    finally:
        foreign.close()
        _close(connection)


def test_definition_time_native_and_owner_captures_survive_alias_rebinding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _open_target()
    try:

        def forbidden(*args: object, **kwargs: object) -> Any:
            raise AssertionError("late rebound alias must not run")

        monkeypatch.setattr(source, "_CURSOR_REBIND_SQLITE_CONNECTION_CURSOR", forbidden)
        monkeypatch.setattr(source, "_CURSOR_REBIND_SQLITE_CURSOR_EXECUTE", forbidden)
        monkeypatch.setattr(source, "_CURSOR_REBIND_SQLITE_CURSOR_FETCHMANY", forbidden)
        monkeypatch.setattr(source, "_CURSOR_REBIND_SQLITE_CURSOR_CLOSE", forbidden)
        monkeypatch.setattr(
            SQLiteV1BaselineConnectionOwner,
            "_prepare_cursor_publication_rebind",
            forbidden,
        )
        monkeypatch.setattr(
            SQLiteV1BaselineConnectionOwner,
            "_execute_cursor_publication_rebind",
            forbidden,
        )
        execution = _prepare(connection)
        _execute(connection, execution)
        _release(connection, execution)
        assert _prove_changes(connection, execution).lifecycle == "completed"
    finally:
        _close(connection)


def test_prepare_freezes_sql_identity_against_late_global_rebinding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _open_target(cursor_count=2)
    try:
        connection.execute(
            "UPDATE main.ge_cycle_cursors SET descriptor_hash = ? WHERE tenant_id = 'tenant-1'",
            ("9" * 64,),
        ).close()
        execution = _prepare(connection)
        monkeypatch.setattr(
            source,
            "SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC",
            "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, "
            "schema_identity_sha256 = ? WHERE descriptor_hash = ? "
            "OR schema_identity_sha256 = ?",
        )
        executed = _execute(connection, execution)
        assert executed.affected_rows == 1
        assert executed.rebind_sql == (
            "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, "
            "schema_identity_sha256 = ? WHERE descriptor_hash = ? "
            "AND schema_identity_sha256 = ?"
        )
        assert hashlib.sha256(executed.rebind_sql.encode()).hexdigest() == (
            executed.rebind_sql_sha256
        )
        rows = connection.execute(
            "SELECT tenant_id, descriptor_hash, schema_identity_sha256 "
            "FROM main.ge_cycle_cursors ORDER BY tenant_id"
        ).fetchmany(3)
        assert rows == [
            ("tenant-0", TARGET_DESCRIPTOR, TARGET_SCHEMA),
            ("tenant-1", "9" * 64, SOURCE_SCHEMA),
        ]

        _release(connection, execution)
        monkeypatch.setattr(
            source,
            "SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC",
            "SELECT 999 AS affected_rows",
        )
        completed = _prove_changes(connection, execution)
        assert completed.lifecycle == "completed"
        assert completed.changes_affected_rows == 1
        assert completed.changes_sql == "SELECT changes() AS affected_rows"
        assert hashlib.sha256(completed.changes_sql.encode()).hexdigest() == (
            completed.changes_sql_sha256
        )
    finally:
        _close(connection)


def test_prepare_uses_definition_time_sql_identity_before_global_rebinding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _open_target(cursor_count=2)
    try:
        authoritative_rebind_sql = source.SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC
        authoritative_rebind_sha = source.SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC
        authoritative_parameter_order = (
            source.SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC
        )
        authoritative_changes_sql = source.SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
        authoritative_changes_sha = source.SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC
        monkeypatch.setattr(
            source,
            "SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC",
            "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, "
            "schema_identity_sha256 = ? WHERE descriptor_hash = ? "
            "OR schema_identity_sha256 = ?",
        )
        monkeypatch.setattr(
            source,
            "SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC",
            "0" * 64,
        )
        monkeypatch.setattr(
            source,
            "SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC",
            (
                "sourceDescriptorHash",
                "sourceSchemaIdentitySha256",
                "targetDescriptorHash",
                "targetSchemaIdentitySha256",
            ),
        )
        monkeypatch.setattr(
            source,
            "SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC",
            "SELECT 999 AS affected_rows",
        )
        monkeypatch.setattr(
            source,
            "SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC",
            "f" * 64,
        )

        execution = _prepare(connection)
        prepared = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert prepared.rebind_sql is authoritative_rebind_sql
        assert prepared.rebind_sql_sha256 is authoritative_rebind_sha
        assert prepared.parameter_order is authoritative_parameter_order
        assert prepared.changes_sql is authoritative_changes_sql
        assert prepared.changes_sql_sha256 is authoritative_changes_sha
        assert hashlib.sha256(prepared.rebind_sql.encode()).hexdigest() == (
            prepared.rebind_sql_sha256
        )
        assert hashlib.sha256(prepared.changes_sql.encode()).hexdigest() == (
            prepared.changes_sql_sha256
        )

        executed = _execute(connection, execution)
        assert executed.affected_rows == 2
        _release(connection, execution)
        completed = _prove_changes(connection, execution)
        assert completed.changes_affected_rows == 2
        rows = connection.execute(
            "SELECT DISTINCT descriptor_hash, schema_identity_sha256 FROM main.ge_cycle_cursors"
        ).fetchmany(3)
        assert rows == [(TARGET_DESCRIPTOR, TARGET_SCHEMA)]
    finally:
        _close(connection)


def test_affected_primary_is_not_replaced_by_cleanup_counter_read() -> None:
    class InvalidRowcount:
        def __get__(self, instance: object, owner: object) -> int:
            del instance, owner
            return -1

    class ReplacementError(RuntimeError):
        pass

    connection = _open_target()
    try:
        execution = _prepare(connection)
        state = _state(execution)
        total_before = cast(int, state.total_changes_before)
        calls = 0

        def counted_total(raw: sqlite3.Connection) -> int:
            nonlocal calls
            del raw
            calls += 1
            if calls == 1:
                return total_before
            return total_before + 1

        def fail_recovery(raw: sqlite3.Connection) -> int:
            del raw
            raise ReplacementError("cleanup replaced the primary")

        with _expect("GE_CURSOR_B3_CURSOR_REBIND_AFFECTED"):
            source.SQLiteV1BaselineConnectionOwner._execute_cursor_publication_rebind(
                connection,
                cast(Any, execution),
                TARGET_DESCRIPTOR,
                TARGET_SCHEMA,
                SOURCE_DESCRIPTOR,
                SOURCE_SCHEMA,
                _native_total_changes=counted_total,
                _rowcount_descriptor=InvalidRowcount(),
                _recovery_total_changes=fail_recovery,
            )
        assert calls == 1
        snapshot = _release(connection, execution)
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.affected_rows == 1
        # The injected recovery counter also failed, so its stale watermark is
        # retained without replacing the authoritative affected-count primary.
        assert snapshot.total_changes_delta == 0
        assert snapshot.cursor_ledger_after == (1, 1, 1)
    finally:
        _close(connection)


def test_trigger_total_drift_preserves_native_cursor_affected_ledger() -> None:
    connection = _open_target()
    try:
        connection.execute(
            "CREATE TABLE main.rebind_audit (tenant_id TEXT NOT NULL)"
        ).close()
        connection.execute(
            "CREATE TRIGGER main.rebind_audit_trigger "
            "AFTER UPDATE ON main.ge_cycle_cursors "
            "BEGIN INSERT INTO rebind_audit (tenant_id) VALUES (NEW.tenant_id); END"
        ).close()
        execution = _prepare(connection)
        executed = _execute(connection, execution)
        assert executed.lifecycle == "executed"
        assert executed.affected_rows == 1
        assert executed.total_changes_delta == 2
        _release(connection, execution)
        with _expect("GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE"):
            _prove_changes(connection, execution)
        snapshot = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.affected_rows == 1
        assert snapshot.changes_affected_rows == 1
        assert (
            snapshot.changes_prepare_count,
            snapshot.changes_fetch_count,
            snapshot.changes_release_count,
        ) == (1, 1, 1)
        assert snapshot.total_changes_delta == 2
        assert snapshot.cursor_ledger_after == (1, 1, 1)
        assert connection.execute(
            "SELECT count(*) FROM main.rebind_audit"
        ).fetchone() == (1,)
    finally:
        _close(connection)


def test_counter_fault_after_native_update_preserves_real_write_progress() -> None:
    class CounterPrimary(RuntimeError):
        pass

    connection = _open_target()
    try:
        execution = _prepare(connection)
        state = _state(execution)
        total_before = cast(int, state.total_changes_before)
        calls = 0

        def fail_after_update(raw: sqlite3.Connection) -> int:
            nonlocal calls
            del raw
            calls += 1
            if calls == 1:
                return total_before
            raise CounterPrimary("post-update counter fault")

        with pytest.raises(CounterPrimary, match=r"^post-update counter fault$"):
            source.SQLiteV1BaselineConnectionOwner._execute_cursor_publication_rebind(
                connection,
                cast(Any, execution),
                TARGET_DESCRIPTOR,
                TARGET_SCHEMA,
                SOURCE_DESCRIPTOR,
                SOURCE_SCHEMA,
                _native_total_changes=fail_after_update,
            )
        assert calls == 2
        snapshot = _release(connection, execution)
        assert snapshot.lifecycle == "poisoned"
        assert (snapshot.prepare_count, snapshot.execute_count, snapshot.release_count) == (
            1,
            1,
            1,
        )
        assert snapshot.affected_rows == 1
        assert snapshot.total_changes_delta == 1
        assert snapshot.cursor_ledger_after == (1, 1, 1)
        assert connection.execute(
            "SELECT descriptor_hash, schema_identity_sha256 "
            "FROM main.ge_cycle_cursors"
        ).fetchone() == (TARGET_DESCRIPTOR, TARGET_SCHEMA)
    finally:
        _close(connection)


def test_changes_shape_is_exact_and_primary_failure_wins_over_close_failure() -> None:
    class Row(tuple[object, ...]):
        pass

    connection = _open_target()
    try:
        execution = _prepare(connection)
        _execute(connection, execution)
        _release(connection, execution)

        def invalid_rows(cursor: sqlite3.Cursor, size: int) -> object:
            del cursor
            assert size == 2
            return [Row((1,))]

        def hostile_close(cursor: sqlite3.Cursor) -> None:
            del cursor
            raise RuntimeError("hostile close")

        with _expect("GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"):
            source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes(
                connection,
                cast(Any, execution),
                _cursor_fetchmany=invalid_rows,
                _cursor_close=hostile_close,
            )
        snapshot = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert (snapshot.changes_fetch_count, snapshot.changes_release_count) == (1, 1)
    finally:
        _close(connection)


def test_changes_value_primary_wins_over_close_failure() -> None:
    connection = _open_target()
    try:
        execution = _prepare(connection)
        _execute(connection, execution)
        _release(connection, execution)

        def invalid_rows(_cursor: sqlite3.Cursor, size: int) -> object:
            assert size == 2
            return [(-1,)]

        def hostile_close(_cursor: sqlite3.Cursor) -> None:
            raise RuntimeError("hostile close secondary")

        with _expect("GE_CURSOR_B3_CURSOR_CHANGES_VALUE"):
            source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes(
                connection,
                cast(Any, execution),
                _cursor_fetchmany=invalid_rows,
                _cursor_close=hostile_close,
            )
        snapshot = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert (snapshot.changes_fetch_count, snapshot.changes_release_count) == (1, 1)
    finally:
        _close(connection)


def test_changes_prepare_and_bounded_fetch_failures_are_terminal() -> None:
    class PreparePrimary(RuntimeError):
        pass

    class FetchPrimary(RuntimeError):
        pass

    prepare_connection = _open_target()
    fetch_connection = _open_target()
    try:
        prepare_execution = _prepare(prepare_connection)
        _execute(prepare_connection, prepare_execution)
        _release(prepare_connection, prepare_execution)

        def fail_prepare(_raw: sqlite3.Connection) -> sqlite3.Cursor:
            raise PreparePrimary("changes prepare primary")

        with _expect("GE_CURSOR_B3_CURSOR_CHANGES_PREPARE"):
            source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes(
                prepare_connection,
                cast(Any, prepare_execution),
                _cursor_factory=fail_prepare,
            )
        prepared = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            prepare_connection, cast(Any, prepare_execution)
        )
        assert prepared.lifecycle == "poisoned"
        assert (
            prepared.changes_prepare_count,
            prepared.changes_fetch_count,
            prepared.changes_release_count,
        ) == (0, 0, 0)

        fetch_execution = _prepare(fetch_connection)
        _execute(fetch_connection, fetch_execution)
        _release(fetch_connection, fetch_execution)
        fetch_calls: list[int] = []

        def fail_fetch(_cursor: sqlite3.Cursor, size: int) -> object:
            fetch_calls.append(size)
            raise FetchPrimary("bounded fetch primary")

        with pytest.raises(FetchPrimary, match=r"^bounded fetch primary$"):
            source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes(
                fetch_connection,
                cast(Any, fetch_execution),
                _cursor_fetchmany=fail_fetch,
            )
        fetched = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            fetch_connection, cast(Any, fetch_execution)
        )
        assert fetch_calls == [2]
        assert fetched.lifecycle == "poisoned"
        assert (
            fetched.changes_prepare_count,
            fetched.changes_fetch_count,
            fetched.changes_release_count,
        ) == (1, 1, 1)
    finally:
        _close(prepare_connection)
        _close(fetch_connection)


@pytest.mark.parametrize(
    ("rows", "code"),
    [
        ([], "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"),
        ([(1,), (1,)], "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"),
        (((1,),), "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"),
        ("1", "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"),
        ([()], "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"),
        ([(1, 1)], "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"),
        ([(1.0,)], "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"),
        ([(True,)], "GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"),
        ([(-1,)], "GE_CURSOR_B3_CURSOR_CHANGES_VALUE"),
        ([(2**53,)], "GE_CURSOR_B3_CURSOR_CHANGES_VALUE"),
        ([(0,)], "GE_CURSOR_B3_CURSOR_CHANGES_VALUE"),
    ],
)
def test_bounded_changes_rows_reject_zero_many_shape_type_and_range(
    rows: object,
    code: str,
) -> None:
    connection = _open_target()
    try:
        execution = _prepare(connection)
        _execute(connection, execution)
        _release(connection, execution)
        calls: list[int] = []

        def supplied_rows(_cursor: sqlite3.Cursor, size: int) -> object:
            calls.append(size)
            return rows

        with _expect(code):
            source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes(
                connection,
                cast(Any, execution),
                _cursor_fetchmany=supplied_rows,
            )
        snapshot = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert calls == [2]
        assert snapshot.lifecycle == "poisoned"
        assert (
            snapshot.changes_prepare_count,
            snapshot.changes_fetch_count,
            snapshot.changes_release_count,
        ) == (1, 1, 1)
        assert snapshot.changes_affected_rows is None
    finally:
        _close(connection)


def test_bounded_changes_rejects_subclasses_and_hostile_iterables_without_hooks() -> None:
    class Rows(list[tuple[object, ...]]):
        pass

    class Row(tuple[object, ...]):
        pass

    class Hostile:
        calls = 0

        def __len__(self) -> int:
            type(self).calls += 1
            raise AssertionError("must not inspect hostile length")

        def __iter__(self) -> Any:
            type(self).calls += 1
            raise AssertionError("must not iterate hostile value")

        def __getitem__(self, _key: object) -> Any:
            type(self).calls += 1
            raise AssertionError("must not index hostile value")

    for rows in (Rows([(1,)]), [Row((1,))], Hostile()):
        connection = _open_target()
        try:
            execution = _prepare(connection)
            _execute(connection, execution)
            _release(connection, execution)

            def supplied_rows(
                _cursor: sqlite3.Cursor, size: int, *, _rows: object = rows
            ) -> object:
                assert size == 2
                return _rows

            with _expect("GE_CURSOR_B3_CURSOR_CHANGES_SHAPE"):
                source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes(
                    connection,
                    cast(Any, execution),
                    _cursor_fetchmany=supplied_rows,
                )
        finally:
            _close(connection)
    assert Hostile.calls == 0


@pytest.mark.parametrize("fault_at", [1, 2])
def test_changes_counter_fault_is_terminal_and_cannot_retry(fault_at: int) -> None:
    class CounterPrimary(RuntimeError):
        pass

    connection = _open_target()
    try:
        execution = _prepare(connection)
        _execute(connection, execution)
        _release(connection, execution)
        expected_total = cast(int, _state(execution).total_changes)
        calls = 0

        def faulting_total(raw: sqlite3.Connection) -> int:
            nonlocal calls
            del raw
            calls += 1
            if calls == fault_at:
                raise CounterPrimary(f"changes counter fault {fault_at}")
            return expected_total

        with pytest.raises(
            CounterPrimary, match=rf"^changes counter fault {fault_at}$"
        ):
            source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes(
                connection,
                cast(Any, execution),
                _native_total_changes=faulting_total,
            )
        snapshot = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        expected_proof_count = 0 if fault_at == 1 else 1
        assert snapshot.changes_fetch_count == expected_proof_count
        assert snapshot.changes_release_count == expected_proof_count
        with _expect("GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE"):
            _prove_changes(connection, execution)
    finally:
        _close(connection)


def test_release_failures_are_terminal_and_structured() -> None:
    connection = _open_target()
    leaked: list[sqlite3.Cursor] = []

    def hostile_close(cursor: sqlite3.Cursor) -> None:
        leaked.append(cursor)
        raise RuntimeError("hostile close")

    try:
        execution = _prepare(connection)
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_RELEASE"):
            source.SQLiteV1BaselineConnectionOwner._release_cursor_publication_rebind(
                connection,
                cast(Any, execution),
                _cursor_close=hostile_close,
            )
        assert _state(execution).lifecycle == "poisoned"
        source._CURSOR_REBIND_SQLITE_CURSOR_CLOSE(leaked.pop())

        execution = _prepare(connection)
        _execute(connection, execution)
        _release(connection, execution)
        with _expect("GE_CURSOR_B3_CURSOR_CHANGES_RELEASE"):
            source.SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes(
                connection,
                cast(Any, execution),
                _cursor_close=hostile_close,
            )
        assert _state(execution).lifecycle == "poisoned"
        source._CURSOR_REBIND_SQLITE_CURSOR_CLOSE(leaked.pop())
    finally:
        for cursor in leaked:
            source._CURSOR_REBIND_SQLITE_CURSOR_CLOSE(cursor)
        _close(connection)


def test_prepared_release_is_cancellation_cleanup_and_weak_registry_is_bounded() -> None:
    connection = _open_target()
    baseline = len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS)
    try:
        execution = _prepare(connection)
        cancelled = _release(connection, execution)
        assert cancelled.lifecycle == "released"
        assert (cancelled.execute_count, cancelled.release_count) == (0, 1)
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION"):
            _execute(connection, execution)

        execution = _prepare(connection)
        execution_ref = ref(execution)
        execution_id = id(execution)
        del execution
        for _ in range(3):
            gc.collect()
        assert execution_ref() is None
        assert execution_id not in source._CURSOR_PUBLICATION_REBIND_EXECUTIONS
        assert len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS) <= baseline
        assert connection.execute("SELECT count(*) FROM ge_cycle_cursors").fetchone() == (1,)
    finally:
        _close(connection)


def test_snapshot_identity_and_stale_weak_callback_preserve_replacement_then_collect() -> None:
    for _ in range(3):
        gc.collect()
    baseline = len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS)
    connection = _open_target()
    try:
        execution = _prepare(connection)
        first = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        second = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert first == second
        assert first is not second
        assert first.transaction_generation is connection._transaction_generation
        assert second.transaction_generation is first.transaction_generation

        execution_id = id(execution)
        original_entry = source._CURSOR_PUBLICATION_REBIND_EXECUTIONS[execution_id]
        original_reference = original_entry[0]
        assert original_reference() is execution
        callback = original_reference.__callback__
        assert callback is not None

        replacement = source._SQLiteConnectionCursorPublicationRebindExecution(
            source._CURSOR_PUBLICATION_REBIND_CONSTRUCTION_TOKEN
        )
        replacement_reference = ref(replacement)
        source._CURSOR_PUBLICATION_REBIND_EXECUTIONS[execution_id] = (
            replacement_reference,
            original_entry[1],
        )
        callback(original_reference)
        assert source._CURSOR_PUBLICATION_REBIND_EXECUTIONS[execution_id][0] is (
            replacement_reference
        )

        source._CURSOR_PUBLICATION_REBIND_EXECUTIONS[execution_id] = original_entry
        execution_reference = ref(execution)
        del execution
        for _ in range(8):
            gc.collect()
        assert execution_reference() is None
        assert execution_id not in source._CURSOR_PUBLICATION_REBIND_EXECUTIONS
        assert len(source._CURSOR_PUBLICATION_REBIND_EXECUTIONS) == baseline
    finally:
        _close(connection)


def test_exact_prepared_release_fault_is_graph_bound_one_shot_and_default_off() -> None:
    class ReleasePrimary(BaseException):
        pass

    first = _open_target()
    second = _open_target()
    try:
        first_execution = _prepare(first)
        second_execution = _prepare(second)
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT"):
            source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
                first, cast(Any, first_execution), ValueError("not weakrefable")
            )
        primary = ReleasePrimary("selected exact E")
        source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
            first, cast(Any, first_execution), primary
        )
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT"):
            source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
                first, cast(Any, first_execution), ReleasePrimary("double arm")
            )
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION"):
            source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
                second, cast(Any, first_execution), ReleasePrimary("cross graph")
            )
        forged = object.__new__(type(first_execution))
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION"):
            source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
                first, cast(Any, forged), ReleasePrimary("forged")
            )

        unselected = _release(second, second_execution)
        assert unselected.lifecycle == "released"
        assert unselected.release_count == 1
        with pytest.raises(ReleasePrimary, match=r"^selected exact E$"):
            _release(first, first_execution)
        selected = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            first, cast(Any, first_execution)
        )
        assert selected.lifecycle == "poisoned"
        assert (selected.execute_count, selected.release_count) == (0, 1)
        assert id(first_execution) not in source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_RELEASE"):
            _release(first, first_execution)

        normal_execution = _prepare(first)
        assert _release(first, normal_execution).lifecycle == "released"
    finally:
        _close(first)
        _close(second)


def test_injected_release_primary_wins_over_real_close_secondary() -> None:
    class ReleasePrimary(BaseException):
        pass

    class CloseSecondary(BaseException):
        pass

    connection = _open_target()
    leaked: list[sqlite3.Cursor] = []
    try:
        execution = _prepare(connection)
        primary = ReleasePrimary("release primary")
        source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
            connection,
            cast(Any, execution),
            primary,
        )

        def fail_close(cursor: sqlite3.Cursor) -> None:
            leaked.append(cursor)
            raise CloseSecondary("close secondary")

        with pytest.raises(ReleasePrimary, match=r"^release primary$"):
            source.SQLiteV1BaselineConnectionOwner._release_cursor_publication_rebind(
                connection,
                cast(Any, execution),
                _cursor_close=fail_close,
            )
        snapshot = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.release_count == 1
        assert len(leaked) == 1
        source._CURSOR_REBIND_SQLITE_CURSOR_CLOSE(leaked.pop())
    finally:
        for cursor in leaked:
            source._CURSOR_REBIND_SQLITE_CURSOR_CLOSE(cursor)
        _close(connection)


def test_release_fault_registration_failure_discards_partial_exact_entry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class RegistrationPrimary(BaseException):
        pass

    connection = _open_target()
    try:
        execution = _prepare(connection)
        register = source._REGISTER_CURSOR_PUBLICATION_REBIND_RELEASE_FAULT

        def register_then_fail(*args: object) -> None:
            register(*cast(Any, args))
            raise RegistrationPrimary("release fault registration")

        monkeypatch.setattr(
            source,
            "_REGISTER_CURSOR_PUBLICATION_REBIND_RELEASE_FAULT",
            register_then_fail,
        )
        with pytest.raises(
            RegistrationPrimary, match=r"^release fault registration$"
        ):
            source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
                connection,
                cast(Any, execution),
                RegistrationPrimary("selected"),
            )
        assert id(execution) not in source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS
        assert _release(connection, execution).lifecycle == "released"
    finally:
        _close(connection)


def test_release_fault_registry_is_weak_and_stale_callback_safe() -> None:
    class ReleasePrimary(BaseException):
        pass

    for _ in range(3):
        gc.collect()
    baseline = len(source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS)
    connection = _open_target()
    try:
        execution = _prepare(connection)
        source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
            connection, cast(Any, execution), ReleasePrimary("weak")
        )
        execution_id = id(execution)
        original = source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS[execution_id]
        callback = original[0].__callback__
        assert callback is not None
        replacement = source._SQLiteConnectionCursorPublicationRebindExecution(
            source._CURSOR_PUBLICATION_REBIND_CONSTRUCTION_TOKEN
        )
        replacement_ref = ref(replacement)
        source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS[execution_id] = (
            replacement_ref,
            original[1],
        )
        callback(original[0])
        assert source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS[execution_id][0] is (
            replacement_ref
        )
        source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS[execution_id] = original
        execution_ref = ref(execution)
        del execution
        for _ in range(8):
            gc.collect()
        assert execution_ref() is None
        assert execution_id not in source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS
        assert len(source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS) == baseline
    finally:
        _close(connection)


def test_release_fault_error_reverse_root_collects_with_exact_e_graph() -> None:
    class ReleasePrimary(BaseException):
        pass

    for _ in range(3):
        gc.collect()
    registries = (
        source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS,
        source._CURSOR_PUBLICATION_REBIND_EXECUTIONS,
    )
    baseline = tuple(len(registry) for registry in registries)
    connection = _open_target()
    execution = _prepare(connection)
    primary = ReleasePrimary("reverse lower root")
    cast(Any, primary).graph = (execution, connection)
    source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
        connection, cast(Any, execution), primary
    )
    weak = (ref(primary), ref(execution))
    _close(connection)
    del connection, execution, primary
    for _ in range(12):
        gc.collect()
    assert all(item() is None for item in weak)
    assert tuple(len(registry) for registry in registries) == baseline


def test_dead_release_fault_error_selected_release_poisons_and_clears() -> None:
    class ReleasePrimary(BaseException):
        pass

    connection = _open_target()
    try:
        execution = _prepare(connection)
        primary = ReleasePrimary("dead lower primary")
        primary_ref = ref(primary)
        source._arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
            connection, cast(Any, execution), primary
        )
        del primary
        for _ in range(3):
            gc.collect()
        assert primary_ref() is None
        with _expect("GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT"):
            _release(connection, execution)
        snapshot = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert (snapshot.execute_count, snapshot.release_count) == (0, 1)
        assert id(execution) not in source._CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS
    finally:
        _close(connection)


def test_rebind_primitives_remain_module_private() -> None:
    public = set(graph_engineering.__all__)
    assert "_SQLiteConnectionCursorPublicationRebindExecution" not in public
    assert "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic" not in public
    assert "_execute_sqlite_connection_cursor_publication_rebind_intrinsic" not in public
    assert "_prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic" not in public
