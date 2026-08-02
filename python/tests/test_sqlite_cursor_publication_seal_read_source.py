from __future__ import annotations

import gc
import hashlib
import json
from pathlib import Path
from typing import Any, cast
from weakref import ref

import pytest

import graph_engineering.sqlite_operation_baseline_source as source
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    SQLiteCursorSealAccumulator,
    decode_sqlite_v1_cursor_seal_row,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_V2 = ROOT / "spec/migrations/sqlite/schema-v2.sql"
SOURCE_DESCRIPTOR = "1" * 64
SOURCE_SCHEMA = "2" * 64
TARGET_DESCRIPTOR = "3" * 64
TARGET_SCHEMA = "4" * 64
THIRD_DESCRIPTOR = "7" * 64
THIRD_SCHEMA = "8" * 64


def _expect(code: str) -> pytest.RaisesExc[ValueError]:
    return pytest.raises(ValueError, match=f"^{code}$")


def _physical_row(
    ordinal: int,
    descriptor: str,
    schema: str,
    *,
    request_scope_blob: bytes = b"{}",
) -> tuple[object, ...]:
    return (
        f"tenant-{ordinal}",
        f"{ordinal + 10:064x}",
        "event",
        "5" * 64,
        "6" * 64,
        f"stream-{ordinal}",
        None,
        request_scope_blob,
        1,
        0,
        -1,
        None,
        descriptor,
        schema,
        b"{}",
        1,
        2,
        None,
    )


def _close(connection: SQLiteV1BaselineConnectionOwner) -> None:
    try:
        if connection.in_transaction:
            connection.rollback()
    finally:
        connection.close()


def _open_completed_rebind(
    cursor_count: int,
    *,
    driver_ordinals: tuple[int, ...] | None = None,
    third_party_ordinals: frozenset[int] = frozenset(),
    request_scope_blob: bytes = b"{}",
) -> tuple[SQLiteV1BaselineConnectionOwner, object, list[tuple[object, ...]]]:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    connection.executescript(SCHEMA_V2.read_text(encoding="utf-8"))
    connection.execute(
        "CREATE TEMP TABLE ge_blr_cursor_seal ("
        "token_hash TEXT NOT NULL, tenant_id TEXT NOT NULL, "
        "PRIMARY KEY (token_hash, tenant_id)) WITHOUT ROWID, STRICT"
    ).close()
    connection.execute("CREATE TABLE main.seal_drift (value INTEGER NOT NULL)").close()
    target_rows: list[tuple[object, ...]] = []
    for ordinal in range(cursor_count):
        descriptor = THIRD_DESCRIPTOR if ordinal in third_party_ordinals else SOURCE_DESCRIPTOR
        schema = THIRD_SCHEMA if ordinal in third_party_ordinals else SOURCE_SCHEMA
        row = _physical_row(
            ordinal,
            descriptor,
            schema,
            request_scope_blob=request_scope_blob,
        )
        connection.execute(
            "INSERT INTO main.ge_cycle_cursors "
            "(tenant_id, token_hash, kind, principal_hash, authorization_hash, "
            "stream_id, checkpoint_scope, request_scope_blob, page_size, "
            "next_position, snapshot_tail_sequence, snapshot_tail_record_hash, "
            "descriptor_hash, schema_identity_sha256, snapshot_blob, created_at_ms, "
            "expires_at_ms, consumed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "
            "?, ?, ?, ?, ?, ?, ?, ?)",
            row,
        ).close()
        target_rows.append(
            _physical_row(
                ordinal,
                TARGET_DESCRIPTOR if ordinal not in third_party_ordinals else THIRD_DESCRIPTOR,
                TARGET_SCHEMA if ordinal not in third_party_ordinals else THIRD_SCHEMA,
                request_scope_blob=request_scope_blob,
            )
        )
    for ordinal in driver_ordinals if driver_ordinals is not None else range(cursor_count):
        connection.execute(
            "INSERT INTO temp.ge_blr_cursor_seal (token_hash, tenant_id) VALUES (?, ?)",
            (f"{ordinal + 10:064x}", f"tenant-{ordinal}"),
        ).close()
    connection.commit()
    connection.execute("BEGIN EXCLUSIVE").close()
    rebind = source._prepare_sqlite_connection_cursor_publication_rebind_intrinsic(connection)
    source._execute_sqlite_connection_cursor_publication_rebind_intrinsic(
        connection,
        rebind,
        TARGET_DESCRIPTOR,
        TARGET_SCHEMA,
        SOURCE_DESCRIPTOR,
        SOURCE_SCHEMA,
    )
    source._release_sqlite_connection_cursor_publication_rebind_intrinsic(
        connection, rebind
    )
    completed = source._prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic(
        connection, rebind
    )
    assert completed.lifecycle == "completed"
    return connection, rebind, target_rows


def _begin(connection: SQLiteV1BaselineConnectionOwner, rebind: object) -> object:
    return source._begin_sqlite_connection_cursor_publication_seal_read_intrinsic(
        connection, cast(Any, rebind)
    )


def _execute(connection: SQLiteV1BaselineConnectionOwner, execution: object) -> Any:
    return source._execute_sqlite_connection_cursor_publication_seal_read_intrinsic(
        connection, cast(Any, execution)
    )


def _independent_one_row_root() -> str:
    """Known-answer oracle that does not import the production decoder/accumulator."""

    blob_sha256 = hashlib.sha256(b"{}").hexdigest()
    carrier = {
        "authorizationHash": "6" * 64,
        "checkpointScope": None,
        "consumedAtMs": None,
        "createdAtMs": 1,
        "expiresAtMs": 2,
        "kind": "event",
        "nextPosition": 0,
        "pageSize": 1,
        "principalHash": "5" * 64,
        "requestScopeBlobSha256": blob_sha256,
        "requestScopeByteLength": 2,
        "snapshotBlobSha256": blob_sha256,
        "snapshotByteLength": 2,
        "snapshotTailRecordHash": None,
        "snapshotTailSequence": -1,
        "streamId": "stream-0",
        "tenantId": "tenant-0",
        "tokenHash": f"{10:064x}",
    }
    carrier_bytes = json.dumps(
        carrier,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()
    row_domain = b"graph-engineering/sqlite-cursor-seal-row/v1\0"
    seal_domain = b"graph-engineering/sqlite-cursor-seal/v1\0"
    row_digest = hashlib.sha256(
        row_domain + len(carrier_bytes).to_bytes(8, "big") + carrier_bytes
    ).digest()
    genesis = hashlib.sha256(seal_domain + b"\x00").digest()
    row_state = hashlib.sha256(
        seal_domain
        + b"\x01"
        + genesis
        + (1).to_bytes(8, "big")
        + row_digest
    ).digest()
    return hashlib.sha256(
        seal_domain + b"\x02" + (1).to_bytes(8, "big") + row_state
    ).hexdigest()


@pytest.mark.parametrize("cursor_count", [0, 1, 4, 64])
def test_raw_seal_evidence_happy_path_is_bounded_and_exact(cursor_count: int) -> None:
    connection, rebind, target_rows = _open_completed_rebind(cursor_count)
    try:
        execution = _begin(connection, rebind)
        evidence = _execute(connection, execution)
        assert evidence.lifecycle == "completed"
        assert evidence.execute_count == 1
        assert evidence.release_count == 0
        assert hashlib.sha256(evidence.main_key_scan_sql.encode()).hexdigest() == (
            evidence.main_key_scan_sql_sha256
        )
        assert hashlib.sha256(evidence.key_driver_sql.encode()).hexdigest() == (
            evidence.key_driver_sql_sha256
        )
        assert hashlib.sha256(evidence.point_lookup_sql.encode()).hexdigest() == (
            evidence.point_lookup_sql_sha256
        )
        assert (
            evidence.main_key_prepare_count,
            evidence.main_key_row_count,
            evidence.main_key_terminal_fetch_count,
            evidence.main_key_close_attempt_count,
            evidence.main_key_close_count,
        ) == (1, cursor_count, 1, 1, 1)
        assert (
            evidence.driver_prepare_count,
            evidence.driver_row_count,
            evidence.driver_terminal_fetch_count,
            evidence.driver_close_attempt_count,
            evidence.driver_close_count,
        ) == (1, cursor_count, 1, 1, 1)
        assert (
            evidence.point_statement_prepare_count,
            evidence.point_statement_execute_count,
            evidence.point_statement_release_count,
        ) == (1, cursor_count, 1)
        assert (
            evidence.point_cursor_created_count,
            evidence.point_cursor_close_attempt_count,
            evidence.point_cursor_closed_count,
        ) == (cursor_count, cursor_count, cursor_count)
        assert evidence.lookup_row_count == evidence.accumulator_row_count == cursor_count
        assert evidence.active_cursor_count == 0
        assert evidence.maximum_active_cursor_count <= 2
        assert evidence.live_physical_row_count == evidence.live_carrier_count == 0
        assert evidence.maximum_live_physical_row_count <= 1
        assert evidence.maximum_live_carrier_count <= 1
        assert evidence.total_changes_delta == 0
        assert not hasattr(evidence, "accepted")
        assert not hasattr(evidence, "rule12_success_receipt")
        assert not hasattr(evidence, "third_clock_authority")

        state = source._CURSOR_PUBLICATION_SEAL_READ_EXECUTIONS[id(execution)][1]
        point_owner = state.point_statement_owner
        assert point_owner is not None
        assert point_owner.execute_count == cursor_count
        assert point_owner.release_count == 1
        assert point_owner.active_cursor is None
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_EXECUTE"):
            point_owner.execute("tenant-0", f"{10:064x}")

        if cursor_count == 0:
            assert evidence.computed_immutable_root_sha256 == SQLITE_CURSOR_SEAL_EMPTY_ROOT
            assert evidence.observed_descriptor_hash is None
            assert evidence.observed_schema_identity_sha256 is None
        else:
            accumulator = SQLiteCursorSealAccumulator(
                cursor_count, TARGET_DESCRIPTOR, TARGET_SCHEMA
            )
            for row in target_rows:
                accumulator.append(decode_sqlite_v1_cursor_seal_row(row))
            expected = accumulator.finish()
            assert evidence.computed_immutable_root_sha256 == expected.immutable_root_sha256
            if cursor_count == 1:
                assert evidence.computed_immutable_root_sha256 == _independent_one_row_root()
            assert evidence.observed_descriptor_hash == TARGET_DESCRIPTOR
            assert evidence.observed_schema_identity_sha256 == TARGET_SCHEMA
    finally:
        _close(connection)


def test_begin_requires_exact_completed_rebind_and_is_single_use() -> None:
    connection, rebind, _rows = _open_completed_rebind(1)
    try:
        execution = _begin(connection, rebind)
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_LINEAGE"):
            _begin(connection, rebind)
        released = source._release_sqlite_connection_cursor_publication_seal_read_intrinsic(
            connection, cast(Any, execution)
        )
        assert released.lifecycle == "released"
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_EXECUTION"):
            _execute(connection, execution)
        poisoned = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert poisoned.lifecycle == "poisoned"
        assert poisoned.main_key_prepare_count == 0
    finally:
        _close(connection)


def test_lineage_or_total_changes_drift_is_terminal_before_reads() -> None:
    connection, rebind, _rows = _open_completed_rebind(1)
    try:
        execution = _begin(connection, rebind)
        connection.execute("INSERT INTO main.seal_drift (value) VALUES (1)").close()
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_LINEAGE"):
            _execute(connection, execution)
        snapshot = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.main_key_prepare_count == 0
        assert snapshot.total_changes_delta == 1
    finally:
        _close(connection)


def test_count_and_missing_point_corruption_poison_without_raw_root_claim() -> None:
    extra_connection, extra_rebind, _rows = _open_completed_rebind(
        2, driver_ordinals=(0,)
    )
    missing_connection, missing_rebind, _rows = _open_completed_rebind(
        1, driver_ordinals=(99,)
    )
    try:
        extra_execution = _begin(extra_connection, extra_rebind)
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_COUNTS"):
            _execute(extra_connection, extra_execution)
        extra = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            extra_connection, cast(Any, extra_execution)
        )
        assert extra.lifecycle == "poisoned"
        assert extra.computed_immutable_root_sha256 is None
        assert extra.active_cursor_count == 0
        assert (extra.main_key_close_count, extra.driver_close_count) == (1, 1)

        missing_execution = _begin(missing_connection, missing_rebind)
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_SHAPE"):
            _execute(missing_connection, missing_execution)
        missing = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            missing_connection, cast(Any, missing_execution)
        )
        assert missing.lifecycle == "poisoned"
        assert missing.computed_immutable_root_sha256 is None
        assert missing.active_cursor_count == 0
        assert missing.point_cursor_created_count == missing.point_cursor_closed_count == 1
        assert missing.driver_close_count == 1
    finally:
        _close(extra_connection)
        _close(missing_connection)


def test_mixed_observed_identities_poison_in_accumulator() -> None:
    connection, rebind, _rows = _open_completed_rebind(
        2, third_party_ordinals=frozenset({1})
    )
    try:
        execution = _begin(connection, rebind)
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_ROW"):
            _execute(connection, execution)
        snapshot = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.computed_immutable_root_sha256 is None
        assert snapshot.observed_descriptor_hash == TARGET_DESCRIPTOR
        assert snapshot.observed_schema_identity_sha256 == TARGET_SCHEMA
        assert snapshot.active_cursor_count == 0
        assert snapshot.point_cursor_created_count == snapshot.point_cursor_closed_count == 2
    finally:
        _close(connection)


def test_close_failure_is_primary_and_definition_time_recovery_closes_owner() -> None:
    connection, rebind, _rows = _open_completed_rebind(1)

    def hostile_close(cursor: object) -> None:
        del cursor
        raise RuntimeError("hostile close")

    try:
        execution = _begin(connection, rebind)
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_CLOSE"):
            source.SQLiteV1BaselineConnectionOwner._execute_cursor_publication_seal_read(
                connection,
                cast(Any, execution),
                _cursor_close=cast(Any, hostile_close),
            )
        snapshot = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.main_key_close_attempt_count == 2
        assert snapshot.main_key_close_count == 1
        assert snapshot.active_cursor_count == 0
        assert snapshot.computed_immutable_root_sha256 is None
    finally:
        _close(connection)


def test_decode_failure_never_enters_carrier_and_recovers_all_cursors() -> None:
    connection, rebind, _rows = _open_completed_rebind(1)

    def hostile_decode(row: object) -> Any:
        del row
        raise RuntimeError("hostile decode")

    try:
        execution = _begin(connection, rebind)
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_ROW"):
            source.SQLiteV1BaselineConnectionOwner._execute_cursor_publication_seal_read(
                connection,
                cast(Any, execution),
                _decode_row=hostile_decode,
            )
        snapshot = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.computed_immutable_root_sha256 is None
        assert snapshot.maximum_live_physical_row_count == 1
        assert snapshot.maximum_live_carrier_count == 0
        assert snapshot.live_physical_row_count == snapshot.live_carrier_count == 0
        assert snapshot.active_cursor_count == 0
        assert snapshot.point_cursor_close_attempt_count == 1
        assert snapshot.point_cursor_closed_count == 1
        assert snapshot.point_statement_release_count == 1
    finally:
        _close(connection)


def test_primary_close_failure_survives_cleanup_close_failure_truthfully() -> None:
    connection, rebind, _rows = _open_completed_rebind(1)

    def hostile_close(cursor: object) -> None:
        del cursor
        raise RuntimeError("hostile close")

    try:
        execution = _begin(connection, rebind)
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_CLOSE"):
            source.SQLiteV1BaselineConnectionOwner._execute_cursor_publication_seal_read(
                connection,
                cast(Any, execution),
                _cursor_close=cast(Any, hostile_close),
                _recovery_cursor_close=cast(Any, hostile_close),
            )
        snapshot = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.computed_immutable_root_sha256 is None
        assert snapshot.main_key_close_attempt_count == 2
        assert snapshot.main_key_close_count == 0
        assert snapshot.active_cursor_count == 1
    finally:
        _close(connection)


def test_execute_rejects_state_sql_drift_before_any_read() -> None:
    connection, rebind, _rows = _open_completed_rebind(1)
    try:
        execution = _begin(connection, rebind)
        state = source._CURSOR_PUBLICATION_SEAL_READ_EXECUTIONS[id(execution)][1]
        state.main_key_scan_sql = "SELECT 1"
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_EXECUTION"):
            _execute(connection, execution)
        snapshot = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.main_key_prepare_count == 0
        assert snapshot.computed_immutable_root_sha256 is None
    finally:
        _close(connection)


def test_final_lineage_failure_conceals_locally_computed_root() -> None:
    connection, rebind, _rows = _open_completed_rebind(0)
    try:
        execution = _begin(connection, rebind)
        baseline = connection.total_changes
        calls = 0

        def drift_only_on_final_check(native_connection: object) -> int:
            nonlocal calls
            del native_connection
            calls += 1
            return baseline if calls <= 3 else baseline + 1

        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_LINEAGE"):
            source.SQLiteV1BaselineConnectionOwner._execute_cursor_publication_seal_read(
                connection,
                cast(Any, execution),
                _native_total_changes=cast(Any, drift_only_on_final_check),
            )
        snapshot = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            connection, cast(Any, execution)
        )
        assert calls >= 4
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.computed_immutable_root_sha256 is None
        assert snapshot.active_cursor_count == 0
        assert snapshot.point_statement_release_count == 1
    finally:
        _close(connection)


def test_same_length_blob_change_changes_raw_root() -> None:
    left_connection, left_rebind, _rows = _open_completed_rebind(
        1, request_scope_blob=b"{}"
    )
    right_connection, right_rebind, _rows = _open_completed_rebind(
        1, request_scope_blob=b"[]"
    )
    try:
        left = _execute(left_connection, _begin(left_connection, left_rebind))
        right = _execute(right_connection, _begin(right_connection, right_rebind))
        assert len(b"{}") == len(b"[]")
        assert left.computed_immutable_root_sha256 is not None
        assert right.computed_immutable_root_sha256 is not None
        assert left.computed_immutable_root_sha256 != right.computed_immutable_root_sha256
    finally:
        _close(left_connection)
        _close(right_connection)


def test_forged_token_and_foreign_connection_have_zero_authority() -> None:
    connection, rebind, _rows = _open_completed_rebind(0)
    foreign, foreign_rebind, _rows = _open_completed_rebind(0)
    try:
        execution = _begin(connection, rebind)
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_EXECUTION"):
            _execute(connection, object())
        with _expect("GE_CURSOR_B3_CURSOR_SEAL_READ_EXECUTION"):
            _execute(foreign, execution)
        assert _execute(connection, execution).lifecycle == "completed"
        assert _begin(foreign, foreign_rebind) is not execution
    finally:
        _close(connection)
        _close(foreign)


def test_definition_time_alias_capture_and_weak_registry_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, rebind, _rows = _open_completed_rebind(1)
    try:
        execution = _begin(connection, rebind)

        def forbidden(*args: object, **kwargs: object) -> Any:
            raise AssertionError("late alias rebound")

        monkeypatch.setattr(source, "_CURSOR_SEAL_READ_SQLITE_CONNECTION_CURSOR", forbidden)
        monkeypatch.setattr(source, "_CURSOR_SEAL_READ_SQLITE_CURSOR_EXECUTE", forbidden)
        monkeypatch.setattr(source, "_CURSOR_SEAL_READ_SQLITE_CURSOR_FETCHONE", forbidden)
        monkeypatch.setattr(source, "_CURSOR_SEAL_READ_SQLITE_CURSOR_CLOSE", forbidden)
        monkeypatch.setattr(source, "_CURSOR_SEAL_READ_DECODE_ROW", forbidden)
        monkeypatch.setattr(source, "_CURSOR_SEAL_READ_ACCUMULATOR", forbidden)
        assert _execute(connection, execution).lifecycle == "completed"

        other_connection, other_rebind, _other_rows = _open_completed_rebind(0)
        try:
            other_execution = _begin(other_connection, other_rebind)
            execution_id = id(other_execution)
            execution_ref = ref(other_execution)
            del other_execution
            for _ in range(5):
                gc.collect()
            assert execution_ref() is None
            assert execution_id not in source._CURSOR_PUBLICATION_SEAL_READ_EXECUTIONS
        finally:
            _close(other_connection)
    finally:
        _close(connection)
