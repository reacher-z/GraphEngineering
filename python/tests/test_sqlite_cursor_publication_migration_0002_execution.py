from __future__ import annotations

import gc
import sqlite3
from pathlib import Path
from typing import cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_initial_write_digest as digest_module
import graph_engineering.sqlite_cursor_publication_migration_0002_asset as asset_module
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_cursor_publication_target_catalog as target_module
import graph_engineering.sqlite_operation_baseline_source as source_module
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    _create_migration_lock_capability_intrinsic,
    _create_provider_clock_capability_intrinsic,
    _create_provider_clock_source_intrinsic,
    _MigrationLockIdentity,
    _observe_provider_clock_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_migration_0002_asset import (
    SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
    _load_sqlite_cursor_migration_0002_asset_intrinsic,
    _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_outer_authority import (
    _activate_sqlite_cursor_outer_publication_authority_intrinsic,
    _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic,
    _prepare_sqlite_cursor_outer_publication_authority_intrinsic,
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
)
from graph_engineering.sqlite_cursor_publication_target_catalog import (
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
    _read_target_catalog_observation_intrinsic,
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
    _begin_sqlite_connection_migration_0002_execution_intrinsic,
    _execute_next_sqlite_connection_migration_0002_statement_intrinsic,
    _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic,
    _SQLiteConnectionMigration0002Execution,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_operation_baseline_cursor_source_fence import _mint_receipt
from tests.test_sqlite_operation_baseline_legacy_invariants import (
    _insert_operation,
    _populate_shared_legacy_fixture,
    _prepare_legacy,
)

_PARAMETER_DIGEST = "8acdf04fe02395192d1c7d704cf8ecf52e29513ccd77024ff4f9cc9e230da80a"
_RESULT_DIGESTS = {
    0: "2475973b53ba5659827cf78fca83b7a040172ae04e0c03d7de1cd7a297f1a96e",
    2: "9c4a39646a7cb26c3ba53e91941b6fe0f4435355a06d2138156d1fd9551ba417",
}
_TEMP_CONFLICT_NAMES = (
    "ge_cycle_schema",
    "GE_CYCLE_SCHEMA_V1",
    "ge_cycle_operations",
    "GE_CYCLE_OPERATIONS_V1",
    "ge_cycle_operations_commit_idx",
    "GE_CYCLE_OPERATIONS_SEQUENCE_UQ",
    "ge_cycle_operations_replay_idx",
    "GE_CYCLE_OPERATION_BASELINES",
    "ge_cycle_operation_baseline_entries",
    "GE_CYCLE_OPERATION_BASELINE_ENTRIES_KEY_UQ",
    "ge_cycle_operation_baseline_entries_hash_uq",
    "GE_CYCLE_OPERATION_SEQUENCE",
)


def _populate(connection: SQLiteV1BaselineConnectionOwner, legacy_count: int) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    connection.execute("DELETE FROM main.ge_cycle_operations").close()
    for ordinal in range(legacy_count):
        _insert_operation(
            connection,
            f"legacy-operation-{ordinal}",
            "delete-checkpoint",
            {"deleted": False},
        )
    connection.commit()


def _clean_graph(legacy_count: int = 0) -> tuple[object, ...]:
    connection, summary, stage, projection = _prepare_legacy(
        lambda owner: _populate(owner, legacy_count)
    )
    report = run_sqlite_v1_legacy_invariant_campaign(summary, projection, stage)
    assert report.diagnostics == ()
    assert projection.legacy_operation_count == legacy_count
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
    source = _create_provider_clock_source_intrinsic(lambda: expected_lock.active_expires_at_ms - 1)
    clock = _create_provider_clock_capability_intrinsic(connection, lock, source)
    evidence = _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
    return connection, stage, receipt, projection, transfer, lock, clock, evidence


def _active(
    legacy_count: int = 0,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
]:
    connection, stage, receipt, projection, transfer, lock, clock, evidence = _clean_graph(
        legacy_count
    )
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
    return connection, stage, authority


def _raw(connection: SQLiteV1BaselineConnectionOwner) -> sqlite3.Connection:
    return cast(
        sqlite3.Connection,
        object.__getattribute__(connection, "_SQLiteV1BaselineConnectionOwner__connection"),
    )


def _cleanup_graph(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
) -> None:
    """Rollback transactional DDL/TEMP ownership before disposing the B2 stage."""

    try:
        connection.rollback()
    finally:
        try:
            stage.dispose()
        finally:
            connection.close()


@pytest.mark.parametrize("legacy_count", [0, 2])
def test_real_b2_graph_executes_exact_twenty_and_mints_bound_receipt(
    legacy_count: int,
) -> None:
    connection, stage, authority = _active(legacy_count)
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    before_generation = connection._transaction_generation
    expected_vector = [0] * 20
    expected_vector[3] = 1
    expected_vector[16] = legacy_count
    try:
        receipt = _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        assert type(receipt) is _SQLiteMigration0002CatalogRebuildReceipt
        snapshot = _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(receipt)
        repeated = _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(receipt)

        assert repeated is snapshot
        assert snapshot.affected_rows == 1 + legacy_count
        assert (
            snapshot.application_id_before
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
        )
        assert (
            snapshot.application_id_after
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
        )
        assert snapshot.asset_sha256 == SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256
        assert snapshot.asset_utf8_bytes == SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES
        assert snapshot.execute_count == 1
        assert snapshot.fixed_statement_count == 20
        assert snapshot.legacy_operation_copy_row_count == legacy_count
        assert snapshot.outer_ledger_before == (0, 0, 0)
        assert snapshot.outer_ledger_after == (1 + legacy_count, 20, 1)
        assert snapshot.outer_ledger_delta == (1 + legacy_count, 20, 1)
        assert snapshot.parameter_sha256 == _PARAMETER_DIGEST
        assert (
            snapshot.post_ddl_catalog_sha256
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        )
        assert snapshot.pre_ddl_catalog_sha256 != snapshot.post_ddl_catalog_sha256
        assert snapshot.prepare_count == 20
        assert (
            snapshot.preview_manifest_sha256 == SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256
        )
        assert snapshot.result_sha256 == _RESULT_DIGESTS[legacy_count]
        assert snapshot.schema_copy_row_count == 1
        assert snapshot.schema_sql_sha256 == SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256
        assert snapshot.statement_affected_rows == tuple(expected_vector)
        assert snapshot.total_changes_before == before_changes
        assert snapshot.total_changes_after == before_changes + 1 + legacy_count
        assert snapshot.total_changes_delta == 1 + legacy_count
        assert snapshot.transaction_epoch_before == before_epoch
        assert snapshot.transaction_epoch_after == before_epoch + 20
        assert snapshot.transaction_generation is before_generation
        assert snapshot.user_version_before == 1
        assert snapshot.user_version_after == 2
        assert snapshot.write_kind == "migration-0002-catalog-rebuild"

        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "active"
        assert owner.migration_0002_logical_execution_count == 1
        assert owner.migration_0002_prepared_statement_count == 20
        assert owner.migration_0002_receipt is receipt
        assert owner.outer_ledger == (1 + legacy_count, 20, 1)
        assert owner.write_phase == "0002-complete"
        assert connection.transaction_epoch == before_epoch + 20
        assert connection.total_changes == before_changes + 1 + legacy_count
        assert connection._transaction_generation is before_generation
        assert connection.in_exclusive_transaction

        if legacy_count:
            cursor = connection.execute(
                """SELECT ledger_format_version, request_blob, commit_sequence
                     FROM main.ge_cycle_operations
                    ORDER BY tenant_id COLLATE BINARY, operation_id COLLATE BINARY"""
            )
            try:
                assert cursor.fetchmany(3) == [(1, None, None), (1, None, None)]
            finally:
                cursor.close()
    finally:
        _cleanup_graph(connection, stage)


def test_success_trace_contains_fixed_asset_plan_in_exact_order_without_transaction_control() -> (
    None
):
    connection, stage, authority = _active()
    raw = _raw(connection)
    trace: list[str] = []
    before_epoch = connection.transaction_epoch
    before_generation = connection._transaction_generation
    asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
    plan = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic(asset).statements
    raw.set_trace_callback(trace.append)
    try:
        _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
    finally:
        raw.set_trace_callback(None)
    try:
        normalized = tuple(statement.strip() for statement in trace)
        expected = tuple(statement.strip() for statement in plan)
        starts = [
            index
            for index in range(len(normalized) - len(expected) + 1)
            if normalized[index : index + len(expected)] == expected
        ]
        assert len(starts) == 1
        pre_plan_forbidden = (
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
        )
        assert all(
            not statement.lstrip().upper().startswith(pre_plan_forbidden)
            for statement in normalized[: starts[0]]
        )
        assert connection.transaction_epoch == before_epoch + 20
        assert connection._transaction_generation is before_generation
        forbidden = ("BEGIN", "COMMIT", "ROLLBACK")
        assert all(not statement.lstrip().upper().startswith(forbidden) for statement in trace)
    finally:
        _cleanup_graph(connection, stage)


def test_second_execution_is_zero_sql_terminal_poison_and_preserves_completed_ledger() -> None:
    connection, stage, authority = _active()
    raw = _raw(connection)
    try:
        receipt = _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        before_epoch = connection.transaction_epoch
        before_changes = connection.total_changes
        statements: list[str] = []
        raw.set_trace_callback(statements.append)
        try:
            with pytest.raises(ValueError, match=r"MIGRATION_0002_REPLAY|MIGRATION_0002_REUSE"):
                _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        finally:
            raw.set_trace_callback(None)
        assert statements == []
        assert connection.transaction_epoch == before_epoch
        assert connection.total_changes == before_changes
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.write_phase == "poisoned"
        assert owner.outer_ledger == (1, 20, 1)
        assert stage._cursor_outer_publication_state == "poisoned"
        with pytest.raises(ValueError, match=r"POISONED|MIGRATION_0002"):
            _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(receipt)
    finally:
        _cleanup_graph(connection, stage)


def test_rollback_restores_exact_pre_ddl_observation_and_retires_receipt() -> None:
    connection, stage, authority = _active()
    pre = _read_target_catalog_observation_intrinsic(connection)
    try:
        receipt = _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        completed = _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(receipt)
        connection.rollback()
        restored = _read_target_catalog_observation_intrinsic(connection)
        assert restored.application_id == pre.application_id == completed.application_id_before
        assert restored.user_version == pre.user_version == completed.user_version_before == 1
        assert restored.catalog_sha256 == pre.catalog_sha256 == completed.pre_ddl_catalog_sha256
        assert restored.catalog_sha256 != completed.post_ddl_catalog_sha256
        with pytest.raises(ValueError, match=r"STALE_FENCE|RETIRED"):
            _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(receipt)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "retired"
        )
        with pytest.raises(ValueError, match=r"STALE_FENCE|RETIRED"):
            _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(receipt)
    finally:
        _cleanup_graph(connection, stage)


def test_forged_cloned_and_cross_run_receipts_never_replace_exact_provenance() -> None:
    first_connection, first_stage, first_authority = _active()
    second_connection, second_stage, second_authority = _active()
    try:
        first = _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(first_authority)
        second = _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(second_authority)
        clone = object.__new__(_SQLiteMigration0002CatalogRebuildReceipt)
        for hostile in (object(), clone):
            with pytest.raises(ValueError, match=r"MIGRATION_0002_RECEIPT"):
                _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
                    hostile  # type: ignore[arg-type]
                )
        assert first is not second
        first_snapshot = _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
            first
        )
        second_snapshot = _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
            second
        )
        assert first_snapshot.transaction_generation is not second_snapshot.transaction_generation
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                first_authority
            ).lifecycle
            == "active"
        )
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                second_authority
            ).lifecycle
            == "active"
        )
    finally:
        _cleanup_graph(second_connection, second_stage)
        _cleanup_graph(first_connection, first_stage)


@pytest.mark.parametrize("name", _TEMP_CONFLICT_NAMES)
def test_case_insensitive_temp_shadow_fails_before_first_asset_statement(name: str) -> None:
    connection, stage, authority = _active()
    raw = _raw(connection)
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    raw.execute(f'CREATE TEMP TABLE "{name}" (hostile INTEGER)')
    statements: list[str] = []
    raw.set_trace_callback(statements.append)
    try:
        with pytest.raises(ValueError, match=r"MIGRATION_0002_TEMP_CONFLICT"):
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
    finally:
        raw.set_trace_callback(None)
    try:
        assert connection.transaction_epoch == before_epoch
        assert connection.total_changes == before_changes
        assert any("temp.sqlite_schema" in statement for statement in statements)
        assert all(
            not statement.lstrip()
            .upper()
            .startswith(("ALTER", "CREATE", "DROP", "INSERT", "UPDATE", "DELETE"))
            for statement in statements
        )
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.outer_ledger == (0, 0, 0)
    finally:
        _cleanup_graph(connection, stage)


@pytest.mark.parametrize("drift", ["metadata", "catalog", "ledger", "lineage"])
def test_source_metadata_catalog_ledger_and_lineage_drift_fail_closed(drift: str) -> None:
    connection, stage, authority = _active()
    raw = _raw(connection)
    try:
        if drift == "metadata":
            raw.execute("PRAGMA user_version = 99")
        elif drift == "catalog":
            raw.execute("CREATE TABLE main.ge_cycle_hostile (value INTEGER)")
        elif drift == "ledger":
            raw.execute(
                "UPDATE main.ge_cycle_schema SET updated_at_ms = updated_at_ms + 1 "
                "WHERE singleton=1"
            )
        else:
            connection.rollback()
            connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError):
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle in {"poisoned", "retired"}
        assert owner.outer_ledger == (0, 0, 0)
    finally:
        _cleanup_graph(connection, stage)


def test_real_mid_plan_statement_twelve_failure_preserves_irreversible_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _active()
    raw = _raw(connection)
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    original_execute = source_module._SQLITE_CURSOR_EXECUTE
    calls = 0

    def collide_at_statement_twelve(
        cursor: sqlite3.Cursor,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> sqlite3.Cursor:
        nonlocal calls
        calls += 1
        # Call 1 is TEMP preflight, calls 2..12 are statements 1..11.
        if calls == 13:
            raw.execute(
                "CREATE TABLE main.ge_cycle_operation_baselines "
                "(baseline_id TEXT PRIMARY KEY) STRICT"
            )
        return original_execute(cursor, sql, parameters)

    monkeypatch.setattr(
        source_module,
        "_SQLITE_CURSOR_EXECUTE",
        collide_at_statement_twelve,
    )
    first_trace: list[str] = []
    raw.set_trace_callback(first_trace.append)
    try:
        with pytest.raises(ValueError, match=r"MIGRATION_0002_STATEMENT") as raised:
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
    finally:
        raw.set_trace_callback(None)
    assert isinstance(raised.value.__cause__, sqlite3.OperationalError)
    owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
    assert owner.lifecycle == "poisoned"
    assert owner.write_phase == "poisoned"
    assert owner.migration_0002_logical_execution_count == 1
    assert owner.migration_0002_prepared_statement_count == 12
    assert owner.migration_0002_receipt is None
    assert owner.outer_ledger == (1, 11, 0)
    assert connection.transaction_epoch == before_epoch + 12
    assert connection.total_changes == before_changes + 1
    assert stage._cursor_outer_publication_state == "poisoned"

    retry_trace: list[str] = []
    raw.set_trace_callback(retry_trace.append)
    try:
        with pytest.raises(ValueError, match=r"MIGRATION_0002_REPLAY"):
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
    finally:
        raw.set_trace_callback(None)
    try:
        assert retry_trace == []
        repeated = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert repeated.lifecycle == "poisoned"
        assert repeated.outer_ledger == (1, 11, 0)
        assert connection.transaction_epoch == before_epoch + 12
        assert connection.total_changes == before_changes + 1
    finally:
        _cleanup_graph(connection, stage)


class _InjectedPrimary(RuntimeError):
    pass


class _InjectedCleanup(RuntimeError):
    pass


def test_preflight_cursor_open_failure_mints_no_session_and_poisons_zero_ledger(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _active()
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    execution_baseline = len(source_module._MIGRATION_0002_EXECUTIONS)

    def fail_cursor_open(_connection: sqlite3.Connection) -> sqlite3.Cursor:
        raise _InjectedPrimary("preflight cursor open failed")

    monkeypatch.setattr(source_module, "_SQLITE_CONNECTION_CURSOR", fail_cursor_open)
    try:
        with pytest.raises(
            ValueError,
            match=r"^GE_CURSOR_B3_MIGRATION_0002_PREPARE$",
        ) as raised:
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        assert isinstance(raised.value.__cause__, _InjectedPrimary)
        assert str(raised.value.__cause__) == "preflight cursor open failed"
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.write_phase == "poisoned"
        assert owner.migration_0002_logical_execution_count == 0
        assert owner.migration_0002_prepared_statement_count == 0
        assert owner.migration_0002_receipt is None
        assert owner.outer_ledger == (0, 0, 0)
        assert connection.transaction_epoch == before_epoch
        assert connection.total_changes == before_changes
        assert len(source_module._MIGRATION_0002_EXECUTIONS) == execution_baseline
        assert stage._cursor_outer_publication_state == "poisoned"
    finally:
        _cleanup_graph(connection, stage)


def test_statement_cursor_open_failure_preserves_completed_progress_without_attempt_epoch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _active()
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    original = source_module._SQLITE_CONNECTION_CURSOR
    cursor_open_count = 0

    def fail_fifth_statement_cursor_open(connection: sqlite3.Connection) -> sqlite3.Cursor:
        nonlocal cursor_open_count
        cursor_open_count += 1
        # Call 1 is TEMP preflight; calls 2..5 open statements 1..4.
        if cursor_open_count == 6:
            raise _InjectedPrimary("statement five cursor open failed")
        return original(connection)

    monkeypatch.setattr(
        source_module,
        "_SQLITE_CONNECTION_CURSOR",
        fail_fifth_statement_cursor_open,
    )
    try:
        with pytest.raises(
            ValueError,
            match=r"^GE_CURSOR_B3_MIGRATION_0002_PREPARE$",
        ) as raised:
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        assert isinstance(raised.value.__cause__, _InjectedPrimary)
        assert str(raised.value.__cause__) == "statement five cursor open failed"
        assert cursor_open_count == 6
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.write_phase == "poisoned"
        assert owner.migration_0002_logical_execution_count == 1
        assert owner.migration_0002_prepared_statement_count == 4
        assert owner.migration_0002_receipt is None
        assert owner.outer_ledger == (1, 4, 0)
        assert connection.transaction_epoch == before_epoch + 4
        assert connection.total_changes == before_changes + 1
        assert stage._cursor_outer_publication_state == "poisoned"
    finally:
        _cleanup_graph(connection, stage)


def test_post_run_rowcount_failure_keeps_statement_four_completion_and_primary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _active()
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    original = source_module._SQLITE_CURSOR_ROWCOUNT

    class FailFourthRowcount:
        reads = 0

        def __get__(self, instance: sqlite3.Cursor, owner: type[sqlite3.Cursor]) -> object:
            type(self).reads += 1
            if type(self).reads == 4:
                raise _InjectedPrimary("rowcount observation failed after native write")
            return original.__get__(instance, owner)

    monkeypatch.setattr(source_module, "_SQLITE_CURSOR_ROWCOUNT", FailFourthRowcount())
    try:
        with pytest.raises(
            ValueError,
            match=r"^GE_CURSOR_B3_MIGRATION_0002_STATEMENT$",
        ) as raised:
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        assert isinstance(raised.value.__cause__, _InjectedPrimary)
        assert str(raised.value.__cause__) == "rowcount observation failed after native write"
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.migration_0002_logical_execution_count == 1
        assert owner.migration_0002_prepared_statement_count == 4
        assert owner.outer_ledger == (1, 4, 0)
        assert connection.transaction_epoch == before_epoch + 4
        assert connection.total_changes == before_changes + 1
    finally:
        _cleanup_graph(connection, stage)


def test_post_run_counter_failure_keeps_completion_delta_and_original_marker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _active()
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    original = source_module._SQLITE_CONNECTION_TOTAL_CHANGES

    class FailFourthPostRunCounter:
        reads = 0
        failed = False

        def __get__(
            self,
            instance: sqlite3.Connection,
            owner: type[sqlite3.Connection],
        ) -> object:
            # Initial session counter + owner checks and preflight reads make a
            # global ordinal brittle. Fail the first read after statement 4 by
            # observing the real counter transition to before+1.
            value = original.__get__(instance, owner)
            type(self).reads += 1
            if value == before_changes + 1 and not type(self).failed:
                type(self).failed = True
                raise _InjectedPrimary("total_changes observation failed after native write")
            return value

    monkeypatch.setattr(
        source_module,
        "_SQLITE_CONNECTION_TOTAL_CHANGES",
        FailFourthPostRunCounter(),
    )
    try:
        with pytest.raises(
            ValueError,
            match=r"^GE_CURSOR_B3_MIGRATION_0002_COUNTER$",
        ) as raised:
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        assert isinstance(raised.value.__cause__, _InjectedPrimary)
        assert str(raised.value.__cause__) == "total_changes observation failed after native write"
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.migration_0002_prepared_statement_count == 4
        assert owner.outer_ledger == (1, 4, 0)
        assert connection.transaction_epoch == before_epoch + 4
        assert connection.total_changes == before_changes + 1
    finally:
        _cleanup_graph(connection, stage)


@pytest.mark.parametrize("hostile", [None, "1", True, -1, 2**53])
def test_hostile_total_changes_shapes_are_structured_and_terminal(
    monkeypatch: pytest.MonkeyPatch,
    hostile: object,
) -> None:
    connection, stage, _authority = _active()
    asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()

    class HostileCounter:
        def __get__(self, _instance: object, _owner: object) -> object:
            return hostile

    monkeypatch.setattr(source_module, "_SQLITE_CONNECTION_TOTAL_CHANGES", HostileCounter())
    try:
        with pytest.raises(ValueError, match=r"MIGRATION_0002_COUNTER"):
            _begin_sqlite_connection_migration_0002_execution_intrinsic(connection, asset)
    finally:
        _cleanup_graph(connection, stage)


def test_native_execute_failure_consumes_attempt_epoch_and_preserves_primary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _active()
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    original = source_module._SQLITE_CURSOR_EXECUTE
    calls = 0

    def fail_second_statement(
        cursor: sqlite3.Cursor,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> sqlite3.Cursor:
        nonlocal calls
        calls += 1
        # preflight, statement 1, then statement 2
        if calls == 3:
            raise _InjectedPrimary("native execute failed at statement two")
        return original(cursor, sql, parameters)

    monkeypatch.setattr(source_module, "_SQLITE_CURSOR_EXECUTE", fail_second_statement)
    try:
        with pytest.raises(
            ValueError,
            match=r"^GE_CURSOR_B3_MIGRATION_0002_STATEMENT$",
        ) as raised:
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        assert isinstance(raised.value.__cause__, _InjectedPrimary)
        assert str(raised.value.__cause__) == "native execute failed at statement two"
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.migration_0002_prepared_statement_count == 2
        assert owner.outer_ledger == (0, 1, 0)
        assert connection.transaction_epoch == before_epoch + 2
        assert connection.total_changes == before_changes
    finally:
        _cleanup_graph(connection, stage)


def test_successful_native_statement_close_failure_is_attempted_once_and_keeps_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _active()
    before_epoch = connection.transaction_epoch
    original = source_module._SQLITE_CURSOR_CLOSE
    close_calls = 0

    def fail_statement_close(cursor: sqlite3.Cursor) -> None:
        nonlocal close_calls
        close_calls += 1
        # First close belongs to the TEMP preflight. The second follows the
        # successfully executed first asset statement.
        if close_calls == 2:
            raise _InjectedCleanup("statement cursor cleanup failed")
        original(cursor)

    monkeypatch.setattr(source_module, "_SQLITE_CURSOR_CLOSE", fail_statement_close)
    try:
        with pytest.raises(
            ValueError,
            match=r"^GE_CURSOR_B3_MIGRATION_0002_CLEANUP$",
        ) as raised:
            _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        assert isinstance(raised.value.__cause__, _InjectedCleanup)
        assert str(raised.value.__cause__) == "statement cursor cleanup failed"
        assert close_calls == 2
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.lifecycle == "poisoned"
        assert owner.migration_0002_prepared_statement_count == 1
        assert owner.outer_ledger == (0, 1, 0)
        assert connection.transaction_epoch == before_epoch + 1
    finally:
        _cleanup_graph(connection, stage)


def test_preflight_read_failure_outranks_cleanup_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, _authority = _active()
    asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
    close_calls = 0

    def read_failure(_cursor: sqlite3.Cursor) -> object:
        raise _InjectedPrimary("preflight read failed")

    def cleanup_failure(_cursor: object) -> None:
        nonlocal close_calls
        close_calls += 1
        raise _InjectedCleanup("preflight cleanup failed")

    monkeypatch.setattr(source_module, "_SQLITE_CURSOR_FETCHONE", read_failure)
    monkeypatch.setattr(source_module, "_SQLITE_CURSOR_CLOSE", cleanup_failure)
    try:
        with pytest.raises(
            ValueError,
            match=r"^GE_CURSOR_B3_MIGRATION_0002_TEMP_PREFLIGHT$",
        ) as raised:
            _begin_sqlite_connection_migration_0002_execution_intrinsic(connection, asset)
        assert isinstance(raised.value.__cause__, _InjectedPrimary)
        assert str(raised.value.__cause__) == "preflight read failed"
        assert close_calls == 1
    finally:
        _cleanup_graph(connection, stage)


def test_source_session_reports_every_prepared_and_completed_ordinal_and_is_next_only() -> None:
    connection, stage, _authority = _active(2)
    asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
    try:
        execution = _begin_sqlite_connection_migration_0002_execution_intrinsic(connection, asset)
        assert type(execution) is _SQLiteConnectionMigration0002Execution
        generation = connection._transaction_generation
        affected = []
        for ordinal in range(1, 21):
            step = _execute_next_sqlite_connection_migration_0002_statement_intrinsic(
                connection, execution
            )
            assert step.fixed_statement_ordinal == ordinal
            assert step.prepared_statement_count == ordinal
            assert step.completed_statement_count == ordinal
            assert step.transaction_epoch == connection.transaction_epoch
            assert step.transaction_generation is generation
            affected.append(step.affected_rows_delta)
        progress = _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.lifecycle == "completed"
        assert progress.prepared_statement_count == 20
        assert progress.completed_statement_count == 20
        assert progress.next_statement_ordinal == 21
        assert progress.affected_rows == 3
        assert affected == [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0]
        with pytest.raises(ValueError, match=r"MIGRATION_0002_TERMINAL"):
            _execute_next_sqlite_connection_migration_0002_statement_intrinsic(
                connection, execution
            )
    finally:
        _cleanup_graph(connection, stage)


def test_source_session_rejects_wrong_connection_owner_drift_and_releases_registry() -> None:
    # Stabilize weak-registry cardinality before sampling it. Objects abandoned
    # by an earlier test may be collectible without being part of this graph.
    gc.collect()
    gc.collect()
    first_connection, first_stage, _first_authority = _active()
    second_connection, second_stage, _second_authority = _active()
    baseline = len(source_module._MIGRATION_0002_EXECUTIONS)
    try:
        asset = _load_sqlite_cursor_migration_0002_asset_intrinsic()
        execution = _begin_sqlite_connection_migration_0002_execution_intrinsic(
            first_connection, asset
        )
        with pytest.raises(ValueError, match=r"MIGRATION_0002_EXECUTION"):
            _execute_next_sqlite_connection_migration_0002_statement_intrinsic(
                second_connection, execution
            )
        first_connection.execute(
            "UPDATE main.ge_cycle_schema SET updated_at_ms = updated_at_ms + 1 WHERE singleton=1"
        ).close()
        with pytest.raises(ValueError, match=r"MIGRATION_0002_OWNER_DRIFT"):
            _execute_next_sqlite_connection_migration_0002_statement_intrinsic(
                first_connection, execution
            )
        progress = _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic(
            first_connection, execution
        )
        assert progress.lifecycle == "poisoned"
        assert progress.prepared_statement_count == 0
        assert progress.completed_statement_count == 0
        reference = ref(execution)
        del execution
        gc.collect()
        gc.collect()
        assert reference() is None
        assert len(source_module._MIGRATION_0002_EXECUTIONS) == baseline
    finally:
        _cleanup_graph(second_connection, second_stage)
        _cleanup_graph(first_connection, first_stage)


def test_success_graph_naturally_releases_authority_receipt_and_execution_registries() -> None:
    # The registries are intentionally weak. Collect prior-test garbage before
    # taking a baseline so this assertion measures only the graph below.
    gc.collect()
    gc.collect()
    authority_baseline = len(outer_module._AUTHORITIES)
    receipt_baseline = len(outer_module._MIGRATION_0002_RECEIPTS)
    execution_baseline = len(source_module._MIGRATION_0002_EXECUTIONS)

    def abandon() -> tuple[object, object, object]:
        connection, stage, authority = _active()
        receipt = _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        authority_reference = ref(authority)
        receipt_reference = ref(receipt)
        stage_reference = ref(stage)
        # The source execution is function-local to the writer and must already
        # be gone once the authentic receipt has been returned.
        gc.collect()
        assert len(source_module._MIGRATION_0002_EXECUTIONS) == execution_baseline
        _cleanup_graph(connection, stage)
        return authority_reference, receipt_reference, stage_reference

    authority_reference, receipt_reference, stage_reference = abandon()
    gc.collect()
    gc.collect()
    assert authority_reference() is None
    assert receipt_reference() is None
    assert stage_reference() is None
    assert len(outer_module._AUTHORITIES) == authority_baseline
    assert len(outer_module._MIGRATION_0002_RECEIPTS) == receipt_baseline
    assert len(source_module._MIGRATION_0002_EXECUTIONS) == execution_baseline


def test_package_boundaries_remain_private_and_never_use_script_or_transaction_completion() -> None:
    for name in (
        "execute_sqlite_cursor_migration_0002_catalog_rebuild",
        "read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot",
        "SQLiteMigration0002CatalogRebuildReceipt",
        "_execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic",
        "_SQLiteMigration0002CatalogRebuildReceipt",
    ):
        assert not hasattr(graph_engineering, name)
    for module in (outer_module, source_module):
        source_path = Path(cast(str, module.__file__))
        text = source_path.read_text(encoding="utf-8")
        assert "executescript(" not in text if module is outer_module else True
        if module is outer_module:
            for forbidden in (".commit(", ".rollback(", ".rebind("):
                assert forbidden not in text


def test_captured_asset_digest_catalog_and_owner_dependencies_resist_late_replacement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority = _active()

    def replaced(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("late replacement reached migration writer")

    monkeypatch.setattr(
        asset_module, "_load_sqlite_cursor_migration_0002_asset_intrinsic", replaced
    )
    monkeypatch.setattr(
        asset_module, "_read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic", replaced
    )
    monkeypatch.setattr(
        digest_module, "_digest_sqlite_initial_write_parameters_intrinsic", replaced
    )
    monkeypatch.setattr(digest_module, "_digest_sqlite_initial_write_result_intrinsic", replaced)
    monkeypatch.setattr(target_module, "_read_target_catalog_observation_intrinsic", replaced)
    monkeypatch.setattr(target_module, "_read_validated_target_catalog_intrinsic", replaced)
    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", replaced)
    try:
        receipt = _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(authority)
        assert (
            _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
                receipt
            ).fixed_statement_count
            == 20
        )
    finally:
        monkeypatch.undo()
        _cleanup_graph(connection, stage)
