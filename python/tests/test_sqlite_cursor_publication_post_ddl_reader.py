from __future__ import annotations

import gc
from contextlib import suppress
from dataclasses import replace
from inspect import signature
from pathlib import Path
from typing import cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_operation_baseline_source as source_module
from graph_engineering.sqlite_cursor_publication_outer_authority import (
    SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
    SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256,
    _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic,
    _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic,
    _execute_sqlite_cursor_post_ddl_publication_reader_intrinsic,
    _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic,
    _mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic,
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _SQLiteMigration0002CatalogRebuildReceipt,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_cursor_publication_migration_0002_execution import (
    _cleanup_graph,
    _raw,
)
from tests.test_sqlite_cursor_publication_post_ddl_catalog_fence import _migrated

_SOURCE_SQL = (
    "SELECT kind_rank, entry_kind, key_blob, state_blob "
    "FROM temp.ge_blr_stage ORDER BY kind_rank ASC, key_blob ASC"
)
_SOURCE_SQL_SHA256 = "adae52750ecd70a75090b52de7d60763eea144c1383cf4739df9d8e8a6b2357f"
_SNAPSHOT_FIELDS = (
    "authority",
    "close_attempt_count",
    "close_succeeded",
    "connection",
    "consumes_any_write_receipt",
    "read_proof_epoch",
    "execute_count",
    "fetch_count",
    "lifecycle",
    "may_mint_stage_adoption_receipt",
    "migration_0002_receipt",
    "mint_count",
    "outer_ledger_read_watermark",
    "ownership_acquisition_count",
    "permanent_write_authority",
    "post_ddl_catalog_fence",
    "prepare_count",
    "projection_identity",
    "projection_reference",
    "rederived_entry_count",
    "rederived_final_entry_hash",
    "rederived_first_entry_hash",
    "rederived_legacy_operation_count",
    "rederived_projection_sha256",
    "source_read_sql",
    "source_read_sql_sha256",
    "stage",
    "total_changes_read_watermark",
    "transaction_generation",
    "transaction_epoch",
    "transfer",
)


def _reader_graph(
    legacy_count: int = 0,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteCursorPostDdlCatalogFence,
]:
    connection, stage, authority, receipt = _migrated(legacy_count)
    fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, receipt)
    return connection, stage, authority, receipt, fence


def _mint(
    authority: _SQLiteCursorOuterPublicationAuthority,
    receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
) -> _SQLiteCursorPostDdlPublicationReaderLease:
    return _mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic(
        authority, receipt, fence
    )


def _execute(
    authority: _SQLiteCursorOuterPublicationAuthority,
    receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    lease: _SQLiteCursorPostDdlPublicationReaderLease,
    cancellation: object | None = None,
) -> _SQLiteCursorPostDdlPublicationReaderLease:
    return _execute_sqlite_cursor_post_ddl_publication_reader_intrinsic(
        authority,
        receipt,
        fence,
        lease,
        cancellation,  # type: ignore[arg-type]
    )


def _assert_terminal(
    authority: _SQLiteCursorOuterPublicationAuthority,
    receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    lease: _SQLiteCursorPostDdlPublicationReaderLease,
) -> _SQLiteCursorPostDdlPublicationReaderLease:
    return _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic(
        authority, receipt, fence, lease
    )


def _safe_cleanup(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
) -> None:
    with suppress(BaseException):
        if connection.in_transaction:
            connection.rollback()
    with suppress(BaseException):
        stage.dispose()
    with suppress(BaseException):
        connection.close()


@pytest.mark.parametrize("legacy_count", [0, 2])
def test_real_zero_and_nonzero_legacy_projection_retires_exact_reader_without_writes(
    legacy_count: int,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(legacy_count)
    owner_before = (
        connection.transaction_epoch,
        connection.total_changes,
        connection._transaction_generation,
    )
    authority_before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
    try:
        lease = _mint(authority, receipt, fence)
        assert type(lease) is _SQLiteCursorPostDdlPublicationReaderLease
        minted = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert minted._fields == _SNAPSHOT_FIELDS
        assert minted.authority is authority
        assert minted.close_attempt_count == 0
        assert minted.close_succeeded is False
        assert minted.connection is connection
        assert minted.consumes_any_write_receipt is False
        assert minted.execute_count == 0
        assert minted.fetch_count == 0
        assert minted.lifecycle == "minted-unused"
        assert minted.may_mint_stage_adoption_receipt is False
        assert minted.migration_0002_receipt is receipt
        assert minted.mint_count == 1
        assert minted.outer_ledger_read_watermark == authority_before.outer_ledger
        assert minted.ownership_acquisition_count == 0
        assert minted.permanent_write_authority is False
        assert minted.post_ddl_catalog_fence is fence
        assert minted.prepare_count == 0
        assert minted.projection_identity is authority_before.projection_identity
        assert minted.projection_reference is authority_before.projection_reference
        assert minted.source_read_sql == _SOURCE_SQL
        assert minted.source_read_sql_sha256 == _SOURCE_SQL_SHA256
        assert minted.stage is stage
        assert minted.total_changes_read_watermark == owner_before[1]
        assert minted.transaction_epoch == owner_before[0]
        assert minted.read_proof_epoch == minted.transaction_epoch
        assert minted.transaction_generation is owner_before[2]
        assert minted.transfer is authority_before.transfer

        assert _execute(authority, receipt, fence, lease) is lease
        terminal = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert terminal.lifecycle == "retired"
        assert terminal.prepare_count == 1
        assert terminal.execute_count == 1
        assert terminal.ownership_acquisition_count == 1
        assert terminal.close_attempt_count == 1
        assert terminal.close_succeeded is True
        assert terminal.fetch_count == authority_before.projection_identity.entry_count + 1
        assert terminal.rederived_entry_count == authority_before.projection_identity.entry_count
        assert terminal.rederived_legacy_operation_count == legacy_count
        assert (
            terminal.rederived_first_entry_hash
            == authority_before.projection_identity.first_entry_hash
        )
        assert (
            terminal.rederived_final_entry_hash
            == authority_before.projection_identity.final_entry_hash
        )
        assert (
            terminal.rederived_projection_sha256
            == authority_before.projection_identity.projection_sha256
        )
        assert _assert_terminal(authority, receipt, fence, lease) is lease
        assert _assert_terminal(authority, receipt, fence, lease) is lease

        assert (
            connection.transaction_epoch,
            connection.total_changes,
            connection._transaction_generation,
        ) == owner_before
        authority_after = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            authority
        )
        assert authority_after.outer_ledger == authority_before.outer_ledger
        assert authority_after.post_ddl_publication_reader_lease is lease
        assert authority_after.post_ddl_publication_reader_lease_mint_count == 1
        assert authority_after.post_ddl_publication_reader_lease_close_count == 1
        assert authority_after.write_phase == "post-ddl-reader-closed"
    finally:
        _cleanup_graph(connection, stage)


def test_source_sql_and_digest_are_exact_and_reader_issues_one_fixed_select() -> None:
    assert SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL == _SOURCE_SQL
    assert SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256 == _SOURCE_SQL_SHA256
    connection, stage, authority, receipt, fence = _reader_graph(1)
    statements: list[str] = []
    raw = _raw(connection)
    try:
        lease = _mint(authority, receipt, fence)
        raw.set_trace_callback(statements.append)
        _execute(authority, receipt, fence, lease)
    finally:
        raw.set_trace_callback(None)
        _cleanup_graph(connection, stage)
    source_reads = [statement for statement in statements if "temp.ge_blr_stage" in statement]
    assert source_reads == [_SOURCE_SQL]
    assert all(
        not statement.lstrip()
        .upper()
        .startswith(("BEGIN", "COMMIT", "ROLLBACK", "CREATE", "DROP", "ALTER", "INSERT", "UPDATE"))
        for statement in statements
    )


def test_terminal_assertion_freshly_reproves_catalog_without_moving_watermarks() -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    raw = _raw(connection)
    catalog_reads: list[str] = []
    before = (connection.transaction_epoch, connection.total_changes)
    try:
        lease = _mint(authority, receipt, fence)
        raw.set_trace_callback(catalog_reads.append)
        _execute(authority, receipt, fence, lease)
        execution_reads = sum("sqlite_schema" in sql for sql in catalog_reads)
        assert execution_reads >= 2
        _assert_terminal(authority, receipt, fence, lease)
        assert sum("sqlite_schema" in sql for sql in catalog_reads) > execution_reads
        assert (connection.transaction_epoch, connection.total_changes) == before
    finally:
        raw.set_trace_callback(None)
        _cleanup_graph(connection, stage)


def test_nonterminal_proof_is_nonpoisoning_and_authentic_lease_remains_executable() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        with pytest.raises(ValueError, match=r"READER.*TERMINAL|TERMINAL.*READER"):
            _assert_terminal(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.lifecycle == "minted-unused"
        assert snapshot.prepare_count == snapshot.close_attempt_count == 0
        assert _execute(authority, receipt, fence, lease) is lease
        assert _assert_terminal(authority, receipt, fence, lease) is lease
    finally:
        _cleanup_graph(connection, stage)


def test_execution_replay_poisons_without_second_read_or_counter_change() -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    try:
        lease = _mint(authority, receipt, fence)
        _execute(authority, receipt, fence, lease)
        before = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        with pytest.raises(ValueError, match=r"READER.*REPLAY|READER.*REUSED"):
            _execute(authority, receipt, fence, lease)
        # A retired snapshot is a live proof, not a stale diagnostic escape.
        # Replay poisons the graph, so the public-private read boundary must
        # now reject it.  Inspect only the registry's scalar counters to prove
        # replay performed no second source operation.
        with pytest.raises(ValueError, match="POISONED"):
            _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        after = outer_module._post_ddl_publication_reader_record(lease)
        assert after.prepare_count == before.prepare_count
        assert after.execute_count == before.execute_count
        assert after.fetch_count == before.fetch_count
        assert after.close_attempt_count == before.close_attempt_count
        assert after.close_succeeded is True
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _safe_cleanup(connection, stage)


def test_second_mint_poisons_without_reader_or_write_activity() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    before = (connection.transaction_epoch, connection.total_changes)
    try:
        lease = _mint(authority, receipt, fence)
        with pytest.raises(ValueError, match=r"READER.*MINT|READER.*REPLAY"):
            _mint(authority, receipt, fence)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.prepare_count == 0
        assert snapshot.execute_count == 0
        assert snapshot.fetch_count == 0
        assert snapshot.close_attempt_count == 0
        assert (connection.transaction_epoch, connection.total_changes) == before
    finally:
        _safe_cleanup(connection, stage)


def test_forged_structural_substituted_and_cross_run_lease_presentations_are_harmless() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    other_connection, other_stage, other_authority, other_receipt, other_fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        other_lease = _mint(other_authority, other_receipt, other_fence)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        forged = object.__new__(_SQLiteCursorPostDdlPublicationReaderLease)
        invalid = (object(), forged, snapshot, other_lease)
        for candidate in invalid:
            with pytest.raises(ValueError, match="READER"):
                _execute(
                    authority,
                    receipt,
                    fence,
                    cast(_SQLiteCursorPostDdlPublicationReaderLease, candidate),
                )
        assert (
            _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(
                lease
            ).lifecycle
            == "minted-unused"
        )
        assert _execute(authority, receipt, fence, lease) is lease
        assert _execute(other_authority, other_receipt, other_fence, other_lease) is other_lease
    finally:
        _cleanup_graph(connection, stage)
        _cleanup_graph(other_connection, other_stage)


@pytest.mark.parametrize("wrong_slot", ["authority", "receipt", "fence"])
def test_wrong_graph_presentation_precedes_sql_and_keeps_exact_graph_retryable(
    wrong_slot: str,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    other_connection, other_stage, other_authority, other_receipt, other_fence = _reader_graph()
    raw = _raw(connection)
    statements: list[str] = []
    try:
        lease = _mint(authority, receipt, fence)
        values = {
            "authority": (other_authority, receipt, fence),
            "receipt": (authority, other_receipt, fence),
            "fence": (authority, receipt, other_fence),
        }[wrong_slot]
        raw.set_trace_callback(statements.append)
        with pytest.raises(ValueError):
            _execute(values[0], values[1], values[2], lease)  # type: ignore[arg-type]
        assert statements == []
        assert _execute(authority, receipt, fence, lease) is lease
    finally:
        raw.set_trace_callback(None)
        _cleanup_graph(connection, stage)
        _cleanup_graph(other_connection, other_stage)


def test_precancelled_signal_is_retryable_without_any_reader_counter() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
        cancellation.cancel()
        with pytest.raises(ValueError, match="CANCEL"):
            _execute(authority, receipt, fence, lease, cancellation.signal)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.lifecycle == "minted-unused"
        assert snapshot.prepare_count == 0
        assert snapshot.execute_count == 0
        assert snapshot.ownership_acquisition_count == 0
        assert snapshot.fetch_count == 0
        assert snapshot.close_attempt_count == 0
        assert _execute(authority, receipt, fence, lease) is lease
    finally:
        _cleanup_graph(connection, stage)


def test_invalid_cancellation_is_nonpoisoning_presentation_failure() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        with pytest.raises(ValueError, match="CANCELLATION"):
            _execute(authority, receipt, fence, lease, object())
        assert (
            _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(
                lease
            ).lifecycle
            == "minted-unused"
        )
        assert _execute(authority, receipt, fence, lease) is lease
    finally:
        _cleanup_graph(connection, stage)


def test_rollback_and_rebegin_is_stale_ahead_of_precancellation() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
        cancellation.cancel()
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match=r"STALE|LINEAGE|TRANSACTION|FENCE"):
            _execute(authority, receipt, fence, lease, cancellation.signal)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.prepare_count == 0
        assert snapshot.close_attempt_count == 0
    finally:
        _safe_cleanup(connection, stage)


def test_unexplained_total_changes_drift_precedes_precancellation() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
        cancellation.cancel()
        _raw(connection).execute(
            "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
        ).close()
        with pytest.raises(ValueError, match=r"WATERMARK|DRIFT|LEDGER"):
            _execute(authority, receipt, fence, lease, cancellation.signal)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.prepare_count == 0
        assert snapshot.close_attempt_count == 0
    finally:
        _safe_cleanup(connection, stage)


def test_catalog_drift_before_execute_poisoned_without_reader_ownership() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        _raw(connection).execute("PRAGMA user_version = 1").close()
        with pytest.raises(ValueError, match=r"CATALOG|DRIFT|FENCE"):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.prepare_count == 0
        assert snapshot.ownership_acquisition_count == 0
        assert snapshot.close_attempt_count == 0
    finally:
        _safe_cleanup(connection, stage)


def test_closed_connection_is_stable_failure_without_native_error_escape() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    lease = _mint(authority, receipt, fence)
    connection.close()
    try:
        with pytest.raises(ValueError, match=r"UNAVAILABLE|CLOSED|CONNECTION"):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.prepare_count == 0
        assert snapshot.close_attempt_count == 0
    finally:
        with suppress(BaseException):
            stage.dispose()


def test_prepare_failure_has_zero_ownership_fetch_and_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        primary = RuntimeError("injected post-DDL reader prepare failure")

        def fail_prepare(*_arguments: object, **_keywords: object) -> object:
            raise primary

        monkeypatch.setattr(outer_module, "_OWNER_PREPARE_POST_DDL_BASELINE_SOURCE", fail_prepare)
        with pytest.raises(ValueError) as raised:
            _execute(authority, receipt, fence, lease)
        assert raised.value.__cause__ is primary
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.prepare_count == 0
        assert snapshot.execute_count == 0
        assert snapshot.ownership_acquisition_count == 0
        assert snapshot.fetch_count == 0
        assert snapshot.close_attempt_count == 0
        assert snapshot.close_succeeded is False
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_execute_acquisition_failure_records_prepare_only_and_aborts_preownership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    primary = RuntimeError("injected post-DDL source execute failure")
    try:
        lease = _mint(authority, receipt, fence)

        def fail_execute(*_arguments: object, **_keywords: object) -> None:
            raise primary

        monkeypatch.setattr(outer_module, "_OWNER_EXECUTE_POST_DDL_BASELINE_SOURCE", fail_execute)
        with pytest.raises(ValueError, match="EXECUTE") as raised:
            _execute(authority, receipt, fence, lease)
        assert raised.value.__cause__ is primary
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.prepare_count == 1
        assert snapshot.execute_count == 0
        assert snapshot.ownership_acquisition_count == 0
        assert snapshot.fetch_count == 0
        assert snapshot.close_attempt_count == 0
        assert snapshot.close_succeeded is False
        owner = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert owner.post_ddl_publication_reader_lease_close_count == 0
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_truncation_is_projection_primary_and_closes_owned_cursor_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(2)
    close_calls = 0
    original_close = outer_module._CURSOR_CLOSE
    try:
        lease = _mint(authority, receipt, fence)

        def truncate(_cursor: object) -> None:
            return None

        def count_close(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", truncate)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", count_close)
        with pytest.raises(ValueError, match=r"PROJECTION|ENTRY|COUNT|entry count"):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert close_calls == 1
        assert snapshot.fetch_count == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.rederived_projection_sha256 is None
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    "hostile_row",
    [
        ("malformed",),
        (12, "legacy-operation", b"{}", b"{}"),
        (11, "schema-envelope", b"{}", b"{}"),
        (0, "schema-envelope", b"{}", b"{}", b"extra"),
        (0, "schema-envelope", "not-a-blob", b"{}"),
        (0, "schema-envelope", b"{}", b"{not-json}"),
    ],
)
def test_malformed_rank_kind_shape_blob_and_canonical_rows_are_rejected_before_cancellation(
    monkeypatch: pytest.MonkeyPatch,
    hostile_row: tuple[object, ...],
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    try:
        lease = _mint(authority, receipt, fence)

        def inject(_cursor: object) -> tuple[object, ...]:
            cancellation.cancel()
            return hostile_row

        def count_close(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", inject)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", count_close)
        with pytest.raises(ValueError) as raised:
            _execute(authority, receipt, fence, lease, cancellation.signal)
        assert "CANCEL" not in str(raised.value)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert close_calls == 1
        assert snapshot.fetch_count == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_reversed_source_rows_are_detected_and_owned_cursor_closes_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(2)
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    probe = _raw(connection).execute(_SOURCE_SQL)
    try:
        rows = probe.fetchmany(2)
        assert len(rows) == 2
        lease = _mint(authority, receipt, fence)
        injected = iter((rows[1], rows[0]))

        def reverse(_reader: object) -> tuple[object, ...] | None:
            return next(injected, None)

        def count_close(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", reverse)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", count_close)
        with pytest.raises(ValueError, match=r"ORDER|PROJECTION"):
            _execute(authority, receipt, fence, lease)
        assert close_calls == 1
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.close_attempt_count == 1
        assert snapshot.lifecycle == "poisoned"
    finally:
        probe.close()
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_extra_row_beyond_declared_projection_is_bounded_and_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    original_fetch = outer_module._CURSOR_FETCHONE
    first_row: tuple[object, ...] | None = None
    injected = False
    try:
        lease = _mint(authority, receipt, fence)

        def append_extra(cursor: object) -> tuple[object, ...] | None:
            nonlocal first_row, injected
            row = original_fetch(cursor)  # type: ignore[arg-type]
            if row is not None and first_row is None:
                first_row = row
            if row is None and not injected:
                injected = True
                assert first_row is not None
                return first_row
            return row

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", append_extra)
        with pytest.raises(ValueError, match=r"COUNT|ORDER|DUPLICATE|PROJECTION"):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        expected = snapshot.projection_identity.entry_count
        assert snapshot.fetch_count <= expected + 1
        assert snapshot.close_attempt_count == 1
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_row_primary_outranks_close_failure_and_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    row_primary = ValueError("injected-row-primary")
    close_secondary = RuntimeError("injected-close-secondary")
    close_calls = 0
    try:
        lease = _mint(authority, receipt, fence)

        def fail_row(_cursor: object) -> tuple[object, ...] | None:
            cancellation.cancel()
            raise row_primary

        def fail_close(_cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            raise close_secondary

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", fail_row)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", fail_close)
        with pytest.raises(ValueError) as raised:
            _execute(authority, receipt, fence, lease, cancellation.signal)
        assert raised.value is row_primary or raised.value.__cause__ is row_primary
        assert close_calls == 1
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.fetch_count == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is False
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_row_primary_outranks_close_failure_without_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    row_primary = ValueError("injected-row-primary-without-cancel")
    close_secondary = RuntimeError("injected-close-secondary-without-cancel")
    close_calls = 0
    try:
        lease = _mint(authority, receipt, fence)

        def fail_row(_cursor: object) -> tuple[object, ...] | None:
            raise row_primary

        def fail_close(_cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            raise close_secondary

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", fail_row)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", fail_close)
        with pytest.raises(ValueError) as raised:
            _execute(authority, receipt, fence, lease)
        assert raised.value is row_primary or raised.value.__cause__ is row_primary
        assert close_calls == 1
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.fetch_count == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is False
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_close_only_failure_is_terminal_and_retains_rederived_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    close_primary = RuntimeError("injected-close-primary")
    close_calls = 0
    try:
        lease = _mint(authority, receipt, fence)

        def fail_close(_cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            raise close_primary

        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", fail_close)
        with pytest.raises(ValueError) as raised:
            _execute(authority, receipt, fence, lease)
        assert raised.value.__cause__ is close_primary
        assert close_calls == 1
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.rederived_projection_sha256 == (
            snapshot.projection_identity.projection_sha256
        )
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is False
        assert snapshot.lifecycle == "poisoned"
        with pytest.raises(ValueError):
            _assert_terminal(authority, receipt, fence, lease)
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_close_failure_outranks_cancellation_after_ownership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    original_fetch = outer_module._CURSOR_FETCHONE
    close_primary = RuntimeError("injected-close-outranks-cancel")
    observed = False
    try:
        lease = _mint(authority, receipt, fence)

        def cancel_after_fetch(cursor: object) -> tuple[object, ...] | None:
            nonlocal observed
            row = original_fetch(cursor)  # type: ignore[arg-type]
            if not observed:
                observed = True
                cancellation.cancel()
            return row

        def fail_close(_cursor: object) -> None:
            raise close_primary

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", cancel_after_fetch)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", fail_close)
        with pytest.raises(ValueError) as raised:
            _execute(authority, receipt, fence, lease, cancellation.signal)
        assert raised.value.__cause__ is close_primary
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is False
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_cancellation_after_ownership_closes_once_and_never_mints_terminal_proof(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(2)
    cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    original_fetch = outer_module._CURSOR_FETCHONE
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    observed = False
    try:
        lease = _mint(authority, receipt, fence)

        def cancel_after_fetch(cursor: object) -> tuple[object, ...] | None:
            nonlocal observed
            row = original_fetch(cursor)  # type: ignore[arg-type]
            if not observed:
                observed = True
                cancellation.cancel()
            return row

        def count_close(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", cancel_after_fetch)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", count_close)
        with pytest.raises(ValueError, match="CANCEL"):
            _execute(authority, receipt, fence, lease, cancellation.signal)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert close_calls == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert snapshot.lifecycle == "poisoned"
        with pytest.raises(ValueError):
            _assert_terminal(authority, receipt, fence, lease)
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("cleanup_source", ["stage-dispose", "outer-poison"])
def test_observed_cancellation_outranks_later_graph_cleanup_and_closes_once(
    monkeypatch: pytest.MonkeyPatch,
    cleanup_source: str,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    original_fetch = outer_module._CURSOR_FETCHONE
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    cleanup_errors: list[BaseException] = []
    injected = False
    try:
        lease = _mint(authority, receipt, fence)

        def cancel_then_cleanup(cursor: object) -> tuple[object, ...] | None:
            nonlocal injected
            row = original_fetch(cursor)  # type: ignore[arg-type]
            if injected:
                return row
            injected = True
            cancellation.cancel()
            try:
                if cleanup_source == "stage-dispose":
                    stage.dispose()
                else:
                    outer_module._poison(
                        outer_module._authority_state(authority),
                        authority,
                        "injected cleanup after observed reader cancellation",
                    )
            except BaseException as error:
                cleanup_errors.append(error)
            return row

        def count_close(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", cancel_then_cleanup)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", count_close)
        with pytest.raises(ValueError, match="CANCELLED"):
            _execute(authority, receipt, fence, lease, cancellation.signal)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert injected
        assert close_calls == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert snapshot.lifecycle == "poisoned"
        assert all("CANCELLED" not in str(error) for error in cleanup_errors)
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_post_read_watermark_drift_is_detected_after_exact_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    try:
        lease = _mint(authority, receipt, fence)

        def close_then_drift(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]
            _raw(connection).execute(
                "UPDATE main.ge_cycle_schema "
                "SET current_version = current_version WHERE singleton = 1"
            ).close()

        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", close_then_drift)
        with pytest.raises(ValueError, match=r"WATERMARK|DRIFT|LEDGER"):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert close_calls == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_stage_disposal_during_fetch_uses_shared_cleanup_exactly_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    original_fetch = outer_module._CURSOR_FETCHONE
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    disposed = False
    try:
        lease = _mint(authority, receipt, fence)

        def dispose_after_fetch(cursor: object) -> tuple[object, ...] | None:
            nonlocal disposed
            row = original_fetch(cursor)  # type: ignore[arg-type]
            if not disposed:
                disposed = True
                stage.dispose()
            return row

        def count_close(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", dispose_after_fetch)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", count_close)
        with pytest.raises(ValueError, match=r"CLEANUP|OWNER|STAGE|READER"):
            _execute(authority, receipt, fence, lease)
        assert close_calls == 1
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.close_attempt_count == 1
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_reentrant_second_open_is_detected_and_outer_read_still_closes_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    original_fetch = outer_module._CURSOR_FETCHONE
    nested: BaseException | None = None
    entered = False
    try:
        lease = _mint(authority, receipt, fence)

        def reenter(cursor: object) -> tuple[object, ...] | None:
            nonlocal nested, entered
            if not entered:
                entered = True
                try:
                    _execute(authority, receipt, fence, lease)
                except BaseException as error:
                    nested = error
            return original_fetch(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", reenter)
        with pytest.raises(ValueError):
            _execute(authority, receipt, fence, lease)
        assert isinstance(nested, ValueError)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.close_attempt_count == 1
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_terminal_presentation_during_active_reader_is_rejected_but_nonpoisoning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    original_fetch = outer_module._CURSOR_FETCHONE
    active_error: BaseException | None = None
    tried = False
    try:
        lease = _mint(authority, receipt, fence)

        def assert_while_active(cursor: object) -> tuple[object, ...] | None:
            nonlocal active_error, tried
            if not tried:
                tried = True
                try:
                    _assert_terminal(authority, receipt, fence, lease)
                except BaseException as error:
                    active_error = error
            return original_fetch(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", assert_while_active)
        assert _execute(authority, receipt, fence, lease) is lease
        assert isinstance(active_error, ValueError)
        assert _assert_terminal(authority, receipt, fence, lease) is lease
    finally:
        monkeypatch.undo()
        _cleanup_graph(connection, stage)


def test_terminal_proof_becomes_stale_after_rollback_and_rebegin() -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)
        _execute(authority, receipt, fence, lease)
        assert _assert_terminal(authority, receipt, fence, lease) is lease
        terminal_before = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(
            lease
        )
        assert terminal_before.lifecycle == "retired"
        assert terminal_before.close_attempt_count == 1
        assert terminal_before.close_succeeded is True
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError):
            _assert_terminal(authority, receipt, fence, lease)
        with pytest.raises(ValueError):
            _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
    finally:
        _safe_cleanup(connection, stage)


def test_reader_uses_captured_owner_cursor_and_accumulator_methods(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from graph_engineering.sqlite_operation_baseline import BaselineAccumulator
    from graph_engineering.sqlite_operation_baseline_source import (
        _SQLiteCursorCapability,
    )

    connection, stage, authority, receipt, fence = _reader_graph(1)
    try:
        lease = _mint(authority, receipt, fence)

        def hostile(*_arguments: object, **_keywords: object) -> object:
            raise AssertionError("late hostile dependency replacement reached reader")

        monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", hostile)
        monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", hostile)
        monkeypatch.setattr(_SQLiteCursorCapability, "close", hostile)
        monkeypatch.setattr(BaselineAccumulator, "append", hostile)
        monkeypatch.setattr(BaselineAccumulator, "finish", hostile)
        assert _execute(authority, receipt, fence, lease) is lease
        assert _assert_terminal(authority, receipt, fence, lease) is lease
    finally:
        monkeypatch.undo()
        _cleanup_graph(connection, stage)


@pytest.mark.parametrize(
    "hostile_blob",
    [
        b"\xff",
        b'{"z":1,"a":2}',
        b" " + b"{}",
        b"[1,]",
        b"x" * 4_097,
    ],
)
def test_invalid_utf8_noncanonical_and_oversized_key_bytes_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
    hostile_blob: bytes,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    try:
        lease = _mint(authority, receipt, fence)

        def inject(_cursor: object) -> tuple[object, ...]:
            return (0, "schema-envelope", hostile_blob, b"{}")

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", inject)
        with pytest.raises(ValueError):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.fetch_count == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_oversized_state_blob_is_rejected_before_retention_and_closes_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    oversized_state = b"x" * 2_097_153
    try:
        lease = _mint(authority, receipt, fence)

        def inject(_cursor: object) -> tuple[object, ...]:
            return (0, "schema-envelope", b"{}", oversized_state)

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", inject)
        with pytest.raises(ValueError, match="ROW"):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.fetch_count == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert snapshot.rederived_projection_sha256 is None
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_rederived_projection_mismatch_is_primary_and_closes_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    original_finish = outer_module._ACCUMULATOR_FINISH
    try:
        lease = _mint(authority, receipt, fence)

        def mismatch(accumulator: object) -> object:
            projection = original_finish(accumulator)  # type: ignore[arg-type]
            return replace(projection, projection_sha256="0" * 64)

        monkeypatch.setattr(outer_module, "_ACCUMULATOR_FINISH", mismatch)
        with pytest.raises(ValueError, match="PROJECTION"):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_cancellation_first_observed_at_terminal_fetch_closes_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    cancellation = _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    original_fetch = outer_module._CURSOR_FETCHONE
    cancelled_at_terminal = False
    try:
        lease = _mint(authority, receipt, fence)

        def cancel_terminal(cursor: object) -> tuple[object, ...] | None:
            nonlocal cancelled_at_terminal
            row = original_fetch(cursor)  # type: ignore[arg-type]
            if row is None:
                cancelled_at_terminal = True
                cancellation.cancel()
            return row

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", cancel_terminal)
        with pytest.raises(ValueError, match="CANCEL"):
            _execute(authority, receipt, fence, lease, cancellation.signal)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert cancelled_at_terminal
        assert snapshot.fetch_count == snapshot.projection_identity.entry_count + 1
        assert snapshot.rederived_projection_sha256 == (
            snapshot.projection_identity.projection_sha256
        )
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("drift", ["rollback", "catalog", "close-connection"])
def test_postownership_graph_drift_after_close_is_fatal_and_exact_once(
    monkeypatch: pytest.MonkeyPatch,
    drift: str,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    try:
        lease = _mint(authority, receipt, fence)

        def close_then_drift(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]
            if drift == "rollback":
                connection.rollback()
                connection.execute("BEGIN EXCLUSIVE").close()
            elif drift == "catalog":
                _raw(connection).execute("PRAGMA user_version = 1").close()
            else:
                connection.close()

        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", close_then_drift)
        with pytest.raises(ValueError):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert close_calls == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("cleanup_source", ["stage-poison", "ownership-retire", "outer-retire"])
def test_nested_cleanup_sources_close_active_reader_exactly_once(
    monkeypatch: pytest.MonkeyPatch,
    cleanup_source: str,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    original_fetch = outer_module._CURSOR_FETCHONE
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    triggered = False
    authority_snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        authority
    )
    try:
        lease = _mint(authority, receipt, fence)

        def trigger_cleanup(cursor: object) -> tuple[object, ...] | None:
            nonlocal triggered
            row = original_fetch(cursor)  # type: ignore[arg-type]
            if triggered:
                return row
            triggered = True
            if cleanup_source == "stage-poison":
                stage._poison("injected active reader stage poison")
            elif cleanup_source == "ownership-retire":
                outer_module._OWNERSHIP_RETIRE(authority_snapshot.transfer, authority)
            else:
                outer_module._retire(outer_module._authority_state(authority), authority)
            return row

        def count_close(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", trigger_cleanup)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", count_close)
        with pytest.raises(ValueError):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert close_calls == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_explicit_outer_poison_during_fetch_closes_active_reader_exactly_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    original_fetch = outer_module._CURSOR_FETCHONE
    original_close = outer_module._CURSOR_CLOSE
    close_calls = 0
    poisoned = False
    try:
        lease = _mint(authority, receipt, fence)

        def poison_outer(cursor: object) -> tuple[object, ...] | None:
            nonlocal poisoned
            row = original_fetch(cursor)  # type: ignore[arg-type]
            if not poisoned:
                poisoned = True
                outer_module._poison(
                    outer_module._authority_state(authority),
                    authority,
                    "injected explicit outer poison during reader fetch",
                )
            return row

        def count_close(cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            original_close(cursor)  # type: ignore[arg-type]

        monkeypatch.setattr(outer_module, "_CURSOR_FETCHONE", poison_outer)
        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", count_close)
        with pytest.raises(ValueError):
            _execute(authority, receipt, fence, lease)
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert poisoned
        assert close_calls == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.lifecycle == "poisoned"
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_failed_close_is_not_reissued_by_later_stage_and_outer_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph()
    close_calls = 0
    try:
        lease = _mint(authority, receipt, fence)

        def fail_close(_cursor: object) -> None:
            nonlocal close_calls
            close_calls += 1
            raise RuntimeError("injected one-shot close failure")

        monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", fail_close)
        with pytest.raises(ValueError, match="CLOSE") as execution_failure:
            _execute(authority, receipt, fence, lease)
        record = outer_module._post_ddl_publication_reader_record(lease)
        retained = record.close_error_code
        assert retained == "GE_CURSOR_B3_POST_DDL_READER_CLOSE"
        assert str(execution_failure.value) == retained
        cleanup = stage._cursor_post_ddl_reader_cleanup
        assert cleanup is not None
        assert stage._cursor_post_ddl_reader_state == "active"

        # Every owner sees the same retained cleanup failure, while the
        # idempotent outer close guard prevents another native close attempt.
        with pytest.raises(ValueError) as direct_replay:
            cleanup()
        assert str(direct_replay.value) == retained
        with pytest.raises(ValueError) as repeated_replay:
            cleanup()
        assert str(repeated_replay.value) == retained
        assert close_calls == 1

        with pytest.raises(ValueError) as stage_replay:
            stage.dispose()
        assert stage_replay.value.__cause__ is not None
        assert str(stage_replay.value.__cause__) == retained
        outer_module._retire(outer_module._authority_state(authority), authority)
        assert close_calls == 1
        snapshot = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is False
    finally:
        monkeypatch.undo()
        _safe_cleanup(connection, stage)


def test_captured_canonical_and_json_helpers_survive_late_module_replacement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import graph_engineering.sqlite_operation_baseline as baseline_module

    connection, stage, authority, receipt, fence = _reader_graph(1)
    try:
        lease = _mint(authority, receipt, fence)

        def hostile(*_arguments: object, **_keywords: object) -> object:
            raise AssertionError("late canonical helper replacement reached reader")

        monkeypatch.setattr(baseline_module, "capture_baseline_entry", hostile)
        monkeypatch.setattr(outer_module, "_decode_post_ddl_reader_json", hostile)
        assert _execute(authority, receipt, fence, lease) is lease
        assert _assert_terminal(authority, receipt, fence, lease) is lease
    finally:
        monkeypatch.undo()
        _cleanup_graph(connection, stage)


def test_captured_sha256_survives_late_hashlib_replacement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, receipt, fence = _reader_graph(1)
    try:
        lease = _mint(authority, receipt, fence)

        class HostileHashlib:
            @staticmethod
            def sha256(*_arguments: object, **_keywords: object) -> object:
                raise AssertionError("late hashlib.sha256 replacement reached reader")

        # Replace only this module's late dependency binding. Mutating the
        # process-wide hashlib module would test every upstream proof owner,
        # not the reader leaf's captured ``_SHA256`` boundary.
        monkeypatch.setattr(outer_module, "hashlib", HostileHashlib())
        assert _execute(authority, receipt, fence, lease) is lease
        assert _assert_terminal(authority, receipt, fence, lease) is lease
    finally:
        monkeypatch.undo()
        _cleanup_graph(connection, stage)


def test_api_accepts_no_caller_sql_rows_projection_count_cursor_or_cleanup() -> None:
    mint_parameters = tuple(
        signature(_mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic).parameters
    )
    execute_parameters = tuple(
        signature(_execute_sqlite_cursor_post_ddl_publication_reader_intrinsic).parameters
    )
    assert mint_parameters == ("authority", "migration_0002_receipt", "fence")
    assert execute_parameters == (
        "authority",
        "migration_0002_receipt",
        "fence",
        "lease",
        "cancellation",
    )
    forbidden = {"sql", "rows", "projection", "count", "cursor", "cleanup", "parameters"}
    assert forbidden.isdisjoint(mint_parameters)
    assert forbidden.isdisjoint(execute_parameters)


def test_live_orphan_lease_does_not_keep_upstream_graph_alive() -> None:
    gc.collect()
    gc.collect()
    baselines = (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
    )

    def abandon() -> tuple[
        _SQLiteCursorPostDdlPublicationReaderLease,
        object,
        object,
        object,
        object,
    ]:
        connection, stage, authority, receipt, fence = _reader_graph()
        lease = _mint(authority, receipt, fence)
        references = (ref(authority), ref(receipt), ref(fence), ref(stage))
        _cleanup_graph(connection, stage)
        return (lease, *references)

    lease, authority_ref, receipt_ref, fence_ref, stage_ref = abandon()
    gc.collect()
    gc.collect()
    assert authority_ref() is None  # type: ignore[operator]
    assert receipt_ref() is None  # type: ignore[operator]
    assert fence_ref() is None  # type: ignore[operator]
    assert stage_ref() is None  # type: ignore[operator]
    assert (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
    ) == baselines
    with pytest.raises(ValueError, match="READER"):
        _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)


def test_failed_close_orphan_lease_retains_no_graph_or_traceback_authority(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    gc.collect()
    gc.collect()
    outer_baselines = (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
        len(outer_module._POST_DDL_PUBLICATION_READER_LEASES),
    )
    source_baseline = len(source_module._POST_DDL_PUBLICATION_READERS)
    close_calls = 0

    def fail_close(_cursor: object) -> None:
        nonlocal close_calls
        close_calls += 1
        raise RuntimeError("injected GC close failure must not be retained")

    def release_exception_chain(error: BaseException) -> None:
        pending = [error]
        seen: set[int] = set()
        while pending:
            current = pending.pop()
            if id(current) in seen:
                continue
            seen.add(id(current))
            if current.__cause__ is not None:
                pending.append(current.__cause__)
            if current.__context__ is not None:
                pending.append(current.__context__)
            current.__traceback__ = None
            current.__cause__ = None
            current.__context__ = None

    monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", fail_close)

    def abandon() -> tuple[
        _SQLiteCursorPostDdlPublicationReaderLease,
        object,
        object,
        object,
        object,
    ]:
        connection, stage, authority, receipt, fence = _reader_graph()
        lease = _mint(authority, receipt, fence)
        references = (
            ref(authority),
            ref(receipt),
            ref(fence),
            ref(stage),
        )
        try:
            _execute(authority, receipt, fence, lease)
        except ValueError as error:
            assert "CLOSE" in str(error)
            release_exception_chain(error)
            del error
        else:
            raise AssertionError("expected close failure")
        _safe_cleanup(connection, stage)
        return (lease, *references)

    lease, authority_ref, receipt_ref, fence_ref, stage_ref = abandon()
    monkeypatch.undo()
    gc.collect()
    gc.collect()
    assert close_calls == 1
    assert authority_ref() is None  # type: ignore[operator]
    assert receipt_ref() is None  # type: ignore[operator]
    assert fence_ref() is None  # type: ignore[operator]
    assert stage_ref() is None  # type: ignore[operator]
    record_fields = set(outer_module._PostDdlPublicationReaderLeaseRecord.__dataclass_fields__)
    assert {"connection", "cursor", "close_error"}.isdisjoint(record_fields)
    assert (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
    ) == outer_baselines[:3]
    assert len(outer_module._POST_DDL_PUBLICATION_READER_LEASES) == outer_baselines[3] + 1
    assert len(source_module._POST_DDL_PUBLICATION_READERS) == source_baseline
    with pytest.raises(ValueError, match="READER"):
        _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(lease)

    lease_ref = ref(lease)
    del lease
    gc.collect()
    gc.collect()
    assert lease_ref() is None
    assert len(outer_module._POST_DDL_PUBLICATION_READER_LEASES) == outer_baselines[3]
    assert len(source_module._POST_DDL_PUBLICATION_READERS) == source_baseline


def test_package_root_keeps_every_reader_capability_and_intrinsic_private() -> None:
    for name in (
        "SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL",
        "SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256",
        "SQLiteCursorPostDdlPublicationReaderLease",
        "mint_sqlite_cursor_post_ddl_publication_reader_lease",
        "execute_sqlite_cursor_post_ddl_publication_reader",
        "read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot",
        "assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof",
        "_SQLiteCursorPostDdlPublicationReaderLease",
        "_mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic",
        "_execute_sqlite_cursor_post_ddl_publication_reader_intrinsic",
        "_read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic",
        "_assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic",
        "_read_sqlite_cursor_post_ddl_publication_reader_entries_intrinsic",
        "_SQLiteCursorOuterPublicationAuthoritySnapshot",
        "_SQLiteCursorPostDdlPublicationReaderLeaseSnapshot",
        "_SQLiteConnectionPostDdlPublicationReader",
        "_SQLiteConnectionPostDdlPublicationReaderSnapshot",
        "_prepare_sqlite_connection_post_ddl_publication_reader_intrinsic",
        "_execute_sqlite_connection_post_ddl_publication_reader_intrinsic",
        "_fetch_sqlite_connection_post_ddl_publication_reader_intrinsic",
        "_fetch_next_owned_sqlite_connection_post_ddl_publication_reader_intrinsic",
        "_close_sqlite_connection_post_ddl_publication_reader_intrinsic",
        "_close_owned_sqlite_connection_post_ddl_publication_reader_intrinsic",
        "_read_sqlite_connection_post_ddl_publication_reader_snapshot_intrinsic",
    ):
        assert not hasattr(graph_engineering, name)


def test_joint_authority_receipt_fence_lease_and_stage_graph_collects() -> None:
    gc.collect()
    gc.collect()
    baselines = (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
        len(outer_module._POST_DDL_PUBLICATION_READER_LEASES),
    )

    def abandon() -> tuple[object, object, object, object, object]:
        connection, stage, authority, receipt, fence = _reader_graph(1)
        lease = _mint(authority, receipt, fence)
        _execute(authority, receipt, fence, lease)
        references = (ref(authority), ref(receipt), ref(fence), ref(lease), ref(stage))
        _cleanup_graph(connection, stage)
        return references

    authority_ref, receipt_ref, fence_ref, lease_ref, stage_ref = abandon()
    gc.collect()
    gc.collect()
    assert authority_ref() is None  # type: ignore[operator]
    assert receipt_ref() is None  # type: ignore[operator]
    assert fence_ref() is None  # type: ignore[operator]
    assert lease_ref() is None  # type: ignore[operator]
    assert stage_ref() is None  # type: ignore[operator]
    assert (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
        len(outer_module._POST_DDL_PUBLICATION_READER_LEASES),
    ) == baselines


def test_reader_leaf_contains_no_transaction_control_or_permanent_write_authority() -> None:
    source = Path(cast(str, outer_module.__file__)).read_text(encoding="utf-8")
    start = source.index("def _mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic")
    end = source.find("def _mint_sqlite_cursor_baseline_entries", start)
    reader_leaf = source[start : end if end >= 0 else len(source)]
    for forbidden in (
        ".commit(",
        ".rollback(",
        ".begin_exclusive(",
        "executescript(",
        "INSERT INTO main.",
        "UPDATE main.",
        "DELETE FROM main.",
    ):
        assert forbidden not in reader_leaf
