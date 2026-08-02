from __future__ import annotations

import gc
import hashlib
from contextlib import suppress
from dataclasses import replace
from inspect import signature
from pathlib import Path
from typing import cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_initial_write_digest as digest_module
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_operation_baseline_source as source_module
from graph_engineering.sqlite_cursor_publication_initial_write_digest import (
    _digest_sqlite_initial_write_parameters_intrinsic,
    _digest_sqlite_initial_write_result_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_outer_authority import (
    SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC,
    SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
    SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256,
    _assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic,
    _execute_sqlite_cursor_baseline_entries_publication_intrinsic,
    _execute_sqlite_cursor_post_ddl_publication_reader_intrinsic,
    _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic,
    _mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic,
    _read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic,
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic,
    _SQLiteBaselineEntriesPublicationReceipt,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _SQLiteMigration0002CatalogRebuildReceipt,
)
from graph_engineering.sqlite_operation_baseline import (
    BASELINE_ENTRY_DOMAIN,
    BASELINE_ENTRY_KINDS,
    BASELINE_GENESIS_HASH,
    _domain_hash,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC as SOURCE_INSERT_SQL,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC as SOURCE_INSERT_SHA256,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic,
    _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic,
    _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic,
    _SQLiteConnectionBaselineEntryPublicationExecution,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_cursor_publication_migration_0002_execution import _raw
from tests.test_sqlite_cursor_publication_post_ddl_catalog_fence import _migrated

_INSERT_SQL = (
    "INSERT INTO main.ge_cycle_operation_baseline_entries "
    "(baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, "
    "previous_entry_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
)
_INSERT_SQL_SHA256 = "b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b"
_PARAMETER_12_SHA256 = "11868f0d60b09e10e3cab4c381a10c47a2ee14f2048ef89c1ac662e42d7300e3"
_RESULT_12_SHA256 = "2aab4754e5067476019ad2bb64cb9eb430de5481b643b739e574082aec63b06c"
_RECEIPT_FIELDS = (
    "affected_rows",
    "authority",
    "baseline_id",
    "connection",
    "entry_count",
    "execute_count",
    "final_entry_hash",
    "first_entry_hash",
    "fixed_insert_sql",
    "fixed_insert_sql_sha256",
    "migration_0002_receipt",
    "mint_count",
    "outer_ledger_after",
    "outer_ledger_before",
    "outer_ledger_delta",
    "parameter_sha256",
    "post_ddl_catalog_fence",
    "prepare_count",
    "projection_identity",
    "projection_reference",
    "reader_close_count",
    "reader_lease",
    "reader_lease_lifecycle",
    "reader_rederived_projection_sha256",
    "result_sha256",
    "source_read_sql",
    "source_read_sql_sha256",
    "total_changes_after",
    "total_changes_before",
    "total_changes_delta",
    "transaction_epoch_after",
    "transaction_epoch_before",
    "transaction_generation",
    "write_kind",
)
_SOURCE_EXECUTION_FIELDS = (
    "affected_rows",
    "completed_entry_count",
    "execute_count",
    "expected_entry_count",
    "lifecycle",
    "next_entry_ordinal",
    "prepare_count",
    "total_changes_before",
    "total_changes",
    "total_changes_delta",
    "transaction_epoch",
    "transaction_generation",
    "close_attempt_count",
    "close_succeeded",
)
_SOURCE_STEP_FIELDS = (
    "affected_rows_delta",
    "completed_entry_count",
    "entry_ordinal",
    "execute_count",
    "prepare_count",
    "total_changes",
    "transaction_epoch",
    "transaction_generation",
)


def _terminal_graph(
    legacy_count: int = 8,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
]:
    connection, stage, authority, migration_receipt = _migrated(legacy_count)
    fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, migration_receipt)
    reader_lease = _mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic(
        authority, migration_receipt, fence
    )
    _execute_sqlite_cursor_post_ddl_publication_reader_intrinsic(
        authority, migration_receipt, fence, reader_lease
    )
    return connection, stage, authority, migration_receipt, fence, reader_lease


def _reader_minted_graph(
    legacy_count: int = 1,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
]:
    connection, stage, authority, migration_receipt = _migrated(legacy_count)
    fence = _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(authority, migration_receipt)
    reader_lease = _mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic(
        authority, migration_receipt, fence
    )
    return connection, stage, authority, migration_receipt, fence, reader_lease


def _publish(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
) -> _SQLiteBaselineEntriesPublicationReceipt:
    return _execute_sqlite_cursor_baseline_entries_publication_intrinsic(
        authority, migration_receipt, fence, reader_lease
    )


def _assert_receipt(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    receipt: _SQLiteBaselineEntriesPublicationReceipt,
) -> _SQLiteBaselineEntriesPublicationReceipt:
    return _assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic(
        authority, migration_receipt, fence, reader_lease, receipt
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


def _published_rows(
    connection: SQLiteV1BaselineConnectionOwner,
) -> list[tuple[object, ...]]:
    cursor = connection.execute(
        "SELECT baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, "
        "previous_entry_hash, entry_hash "
        "FROM main.ge_cycle_operation_baseline_entries ORDER BY ordinal ASC"
    )
    try:
        rows: list[tuple[object, ...]] = []
        while True:
            batch = cursor.fetchmany(64)
            if not batch:
                return rows
            rows.extend(batch)
    finally:
        cursor.close()


def _text(value: str) -> dict[str, object]:
    return {"type": "text", "value": value}


def _integer(value: int) -> dict[str, object]:
    return {"type": "integer", "value": str(value)}


def _blob(value: object) -> dict[str, object]:
    import base64

    assert type(value) is bytes
    return {
        "type": "blob",
        "value": base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii"),
    }


def _parameter_frame(rows: list[tuple[object, ...]]) -> list[list[dict[str, object]]]:
    return [
        [
            _text(cast(str, row[0])),
            _integer(cast(int, row[1])),
            _text(cast(str, row[2])),
            _blob(row[3]),
            _blob(row[4]),
            _text(cast(str, row[5])),
            _text(cast(str, row[6])),
        ]
        for row in rows
    ]


def test_publishes_exact_e12_frame_chain_receipt_and_ledger() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
    reader = _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(reader_lease)
    epoch_before = connection.transaction_epoch
    changes_before = connection.total_changes
    try:
        assert reader.rederived_entry_count == 12
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        snapshot = _read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(receipt)
        assert snapshot._fields == _RECEIPT_FIELDS
        assert snapshot.affected_rows == 12
        assert snapshot.authority is authority
        assert snapshot.baseline_id == before.projection_identity.baseline_id
        assert snapshot.connection is connection
        assert snapshot.entry_count == 12
        assert snapshot.execute_count == 12
        assert snapshot.final_entry_hash == before.projection_identity.final_entry_hash
        assert snapshot.first_entry_hash == before.projection_identity.first_entry_hash
        assert snapshot.fixed_insert_sql == _INSERT_SQL
        assert snapshot.fixed_insert_sql_sha256 == _INSERT_SQL_SHA256
        assert snapshot.migration_0002_receipt is migration_receipt
        assert snapshot.mint_count == 1
        assert snapshot.outer_ledger_before == before.outer_ledger
        assert snapshot.outer_ledger_before == (2, 20, 1)
        assert snapshot.outer_ledger_after == (14, 32, 2)
        assert snapshot.outer_ledger_delta == (12, 12, 1)
        assert snapshot.post_ddl_catalog_fence is fence
        assert snapshot.prepare_count == 1
        assert snapshot.projection_identity is before.projection_identity
        assert snapshot.projection_reference is before.projection_reference
        assert snapshot.reader_close_count == 1
        assert snapshot.reader_lease is reader_lease
        assert snapshot.reader_lease_lifecycle == "retired"
        assert (
            snapshot.reader_rederived_projection_sha256
            == before.projection_identity.projection_sha256
        )
        assert snapshot.result_sha256 == _RESULT_12_SHA256
        assert snapshot.source_read_sql == SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL
        assert (
            snapshot.source_read_sql_sha256
            == SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256
        )
        assert snapshot.total_changes_before == changes_before
        assert snapshot.total_changes_after == changes_before + 12
        assert snapshot.total_changes_delta == 12
        assert snapshot.transaction_epoch_before == epoch_before
        assert snapshot.transaction_epoch_after == epoch_before + 12
        assert snapshot.transaction_generation is connection._transaction_generation
        assert snapshot.write_kind == "baseline-entries-publication"

        rows = _published_rows(connection)
        assert len(rows) == 12
        for ordinal, row in enumerate(rows):
            assert len(row) == 7
            assert row[0] == snapshot.baseline_id
            assert row[1] == ordinal
            assert row[2] in BASELINE_ENTRY_KINDS
            assert row[5] == (BASELINE_GENESIS_HASH if ordinal == 0 else rows[ordinal - 1][6])
            assert row[6] == _domain_hash(
                BASELINE_ENTRY_DOMAIN,
                {
                    "baselineId": row[0],
                    "entryKeySha256": hashlib.sha256(cast(bytes, row[3])).hexdigest(),
                    "entryKind": row[2],
                    "entryStateSha256": hashlib.sha256(cast(bytes, row[4])).hexdigest(),
                    "ordinal": ordinal,
                    "previousEntryHash": row[5],
                },
            )
        assert rows[0][6] == snapshot.first_entry_hash
        assert rows[-1][6] == snapshot.final_entry_hash
        frame = _parameter_frame(rows)
        assert len(frame) == 12
        assert all(len(execution) == 7 for execution in frame)
        assert snapshot.parameter_sha256 == _digest_sqlite_initial_write_parameters_intrinsic(frame)
        assert snapshot.parameter_sha256 == _PARAMETER_12_SHA256
        assert snapshot.result_sha256 == _digest_sqlite_initial_write_result_intrinsic(
            {"affectedRows": "12"}
        )
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
        after = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert after.baseline_entries_publication_receipt is receipt
        assert after.baseline_entries_publication_receipt_mint_count == 1
        assert after.outer_ledger == snapshot.outer_ledger_after
        assert after.write_phase == "baseline-entries-complete"
        assert after.lifecycle == "active"
        assert connection.in_transaction
    finally:
        _safe_cleanup(connection, stage)


def test_source_execution_e0_prepares_once_completes_and_runs_zero_rows() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    before_epoch = connection.transaction_epoch
    before_changes = connection.total_changes
    try:
        execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
            connection, 0
        )
        assert type(execution) is _SQLiteConnectionBaselineEntryPublicationExecution
        snapshot = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert snapshot._fields == _SOURCE_EXECUTION_FIELDS
        assert snapshot.affected_rows == 0
        assert snapshot.completed_entry_count == 0
        assert snapshot.execute_count == 0
        assert snapshot.expected_entry_count == 0
        assert snapshot.lifecycle == "completed"
        assert snapshot.next_entry_ordinal == 0
        assert snapshot.prepare_count == 1
        assert snapshot.total_changes_before == before_changes
        assert snapshot.total_changes == before_changes
        assert snapshot.total_changes_delta == 0
        assert snapshot.transaction_epoch == before_epoch
        assert snapshot.transaction_generation is connection._transaction_generation
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
        assert _published_rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_insert_sql_and_sha_are_exact_and_identical_in_both_owners() -> None:
    assert len(_INSERT_SQL.encode("utf-8")) == 183
    assert SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC == _INSERT_SQL
    assert SOURCE_INSERT_SQL == _INSERT_SQL
    assert SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC == (
        _INSERT_SQL_SHA256
    )
    assert SOURCE_INSERT_SHA256 == _INSERT_SQL_SHA256
    assert hashlib.sha256(_INSERT_SQL.encode("utf-8")).hexdigest() == _INSERT_SQL_SHA256


def test_source_step_and_execution_snapshots_lock_exact_fields_for_one_row() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    try:
        execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
            connection, 1
        )
        step = _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
            connection,
            execution,
            "v2-" + "1" * 64,
            0,
            "schema-envelope",
            b"{" + b'"scope":"cycle-store"' + b"}",
            b"{}",
            BASELINE_GENESIS_HASH,
            "2" * 64,
        )
        assert step._fields == _SOURCE_STEP_FIELDS
        assert step.affected_rows_delta == 1
        assert step.completed_entry_count == 1
        assert step.entry_ordinal == 0
        assert step.execute_count == 1
        assert step.prepare_count == 1
        assert step.total_changes == connection.total_changes
        assert step.transaction_epoch == connection.transaction_epoch
        assert step.transaction_generation is connection._transaction_generation
        snapshot = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert snapshot.lifecycle == "completed"
        assert snapshot.completed_entry_count == 1
        assert snapshot.execute_count == 1
        assert snapshot.affected_rows == 1
        assert snapshot.close_attempt_count == 1
        assert snapshot.close_succeeded is True
    finally:
        _safe_cleanup(connection, stage)


def test_publication_prepares_once_runs_exactly_e_times_and_never_rereads_temp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    begin = outer_module._BEGIN_BASELINE_ENTRY_PUBLICATION
    execute = outer_module._EXECUTE_NEXT_BASELINE_ENTRY
    begin_calls = 0
    execute_calls = 0
    statements: list[str] = []

    def counted_begin(owner: object, expected: int) -> object:
        nonlocal begin_calls
        begin_calls += 1
        assert owner is connection
        assert expected == 12
        return begin(owner, expected)

    def counted_execute(*args: object) -> object:
        nonlocal execute_calls
        execute_calls += 1
        assert len(args) == 9
        assert args[0] is connection
        assert args[3] == execute_calls - 1
        return execute(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_BASELINE_ENTRY_PUBLICATION", counted_begin)
    monkeypatch.setattr(outer_module, "_EXECUTE_NEXT_BASELINE_ENTRY", counted_execute)
    raw = _raw(connection)
    raw.set_trace_callback(statements.append)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        assert begin_calls == 1
        assert execute_calls == 12
        inserts = [statement for statement in statements if statement.startswith("INSERT INTO")]
        assert len(inserts) == 12
        assert all("ge_cycle_operation_baseline_entries" in statement for statement in inserts)
        assert not any("temp.ge_blr_stage" in statement for statement in statements)
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
    finally:
        raw.set_trace_callback(None)
        _safe_cleanup(connection, stage)


def test_publication_builds_exact_seven_argument_rows_in_canonical_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    execute = outer_module._EXECUTE_NEXT_BASELINE_ENTRY
    observed: list[tuple[object, ...]] = []

    def capture(*args: object) -> object:
        assert len(args) == 9
        observed.append(tuple(args[2:]))
        return execute(*args)

    monkeypatch.setattr(outer_module, "_EXECUTE_NEXT_BASELINE_ENTRY", capture)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        rows = _published_rows(connection)
        assert observed == rows
        assert len(observed) == 12
        for ordinal, parameters in enumerate(observed):
            assert len(parameters) == 7
            assert type(parameters[0]) is str
            assert type(parameters[1]) is int and parameters[1] == ordinal
            assert type(parameters[2]) is str
            assert type(parameters[3]) is bytes
            assert type(parameters[4]) is bytes
            assert type(parameters[5]) is str
            assert type(parameters[6]) is str
        snapshot = _read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(receipt)
        assert snapshot.parameter_sha256 == _digest_sqlite_initial_write_parameters_intrinsic(
            _parameter_frame(rows)
        )
    finally:
        _safe_cleanup(connection, stage)


def test_prepare_failure_poison_preserves_zero_entry_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    epoch_before = connection.transaction_epoch
    changes_before = connection.total_changes
    ledger_before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        authority
    ).outer_ledger
    primary = RuntimeError("injected baseline-entry prepare failure")

    def fail_prepare(_connection: object, _expected: int) -> object:
        raise primary

    monkeypatch.setattr(outer_module, "_BEGIN_BASELINE_ENTRY_PUBLICATION", fail_prepare)
    try:
        with pytest.raises(RuntimeError, match="injected baseline-entry prepare failure") as caught:
            _publish(authority, migration_receipt, fence, reader_lease)
        assert caught.value is primary
        assert _published_rows(connection) == []
        assert connection.transaction_epoch == epoch_before
        assert connection.total_changes == changes_before
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.baseline_entries_publication_receipt_mint_count == 0
        assert snapshot.outer_ledger == ledger_before
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_seventh_execute_failure_retains_exact_six_row_physical_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    execute = outer_module._EXECUTE_NEXT_BASELINE_ENTRY
    captured_execution: object | None = None
    calls = 0
    primary = RuntimeError("injected seventh baseline-entry execute failure")

    def fail_seventh(*args: object) -> object:
        nonlocal calls, captured_execution
        captured_execution = args[1]
        if calls == 6:
            raise primary
        result = execute(*args)
        calls += 1
        return result

    monkeypatch.setattr(outer_module, "_EXECUTE_NEXT_BASELINE_ENTRY", fail_seventh)
    try:
        with pytest.raises(RuntimeError, match="injected seventh") as caught:
            _publish(authority, migration_receipt, fence, reader_lease)
        assert caught.value is primary
        assert calls == 6
        assert captured_execution is not None
        progress = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection,
            cast(_SQLiteConnectionBaselineEntryPublicationExecution, captured_execution),
        )
        assert progress.prepare_count == 1
        assert progress.expected_entry_count == 12
        assert progress.execute_count == 6
        assert progress.completed_entry_count == 6
        assert progress.next_entry_ordinal == 6
        assert progress.affected_rows == 6
        assert len(_published_rows(connection)) == 6
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.outer_ledger == (8, 26, 1)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.baseline_entries_publication_receipt_mint_count == 0
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    ("field", "replacement", "error_pattern"),
    [
        ("affected_rows_delta", 0, "ACCOUNTING|RESULT|ROW|PROGRESS|EXECUTION"),
        ("total_changes", -1, "COUNTER|ACCOUNTING|WATERMARK|PROGRESS|EXECUTION"),
    ],
)
def test_post_run_step_fault_keeps_real_row_but_mints_no_receipt(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    replacement: int,
    error_pattern: str,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    execute = outer_module._EXECUTE_NEXT_BASELINE_ENTRY
    changes_before = connection.total_changes
    replaced = False

    def corrupt(*args: object) -> object:
        nonlocal replaced
        step = execute(*args)
        if replaced:
            return step
        replaced = True
        value = replacement if field != "total_changes" else step.total_changes + replacement
        return step._replace(**{field: value})

    monkeypatch.setattr(outer_module, "_EXECUTE_NEXT_BASELINE_ENTRY", corrupt)
    try:
        with pytest.raises(ValueError, match=error_pattern):
            _publish(authority, migration_receipt, fence, reader_lease)
        assert len(_published_rows(connection)) == 1
        assert connection.total_changes == changes_before + 1
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.outer_ledger == (3, 21, 1)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("digest_kind", ["parameters", "result"])
def test_independent_post_write_digest_verifier_fault_retains_all_rows_without_receipt(
    monkeypatch: pytest.MonkeyPatch,
    digest_kind: str,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    changes_before = connection.total_changes
    alias = (
        "_DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER"
        if digest_kind == "parameters"
        else "_DIGEST_INITIAL_WRITE_RESULT_VERIFIER"
    )
    verifier = getattr(outer_module, alias)

    def wrong_digest(value: object) -> str:
        assert verifier(value) != "0" * 64
        return "0" * 64

    monkeypatch.setattr(outer_module, alias, wrong_digest)
    try:
        with pytest.raises(ValueError, match=r"DIGEST|RECEIPT|FRAME|RESULT"):
            _publish(authority, migration_receipt, fence, reader_lease)
        assert len(_published_rows(connection)) == 12
        assert connection.total_changes == changes_before + 12
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.outer_ledger == (14, 32, 1)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.baseline_entries_publication_receipt_mint_count == 0
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_replay_poisons_before_prepare_or_any_additional_row() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        before_changes = connection.total_changes
        before_rows = _published_rows(connection)
        with pytest.raises(ValueError, match=r"REPLAY|REUSED|BASELINE_ENTRIES"):
            _publish(authority, migration_receipt, fence, reader_lease)
        assert connection.total_changes == before_changes
        assert _published_rows(connection) == before_rows
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is receipt
        assert snapshot.baseline_entries_publication_receipt_mint_count == 1
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("wrong_predecessor", ["migration", "fence", "reader"])
def test_wrong_graph_predecessor_writes_nothing_and_valid_graph_remains_retryable(
    wrong_predecessor: str,
) -> None:
    graph = _terminal_graph(1)
    other = _terminal_graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease = graph
    other_connection, other_stage, _, other_migration, other_fence, other_reader = other
    args: list[object] = [authority, migration_receipt, fence, reader_lease]
    args[{"migration": 1, "fence": 2, "reader": 3}[wrong_predecessor]] = {
        "migration": other_migration,
        "fence": other_fence,
        "reader": other_reader,
    }[wrong_predecessor]
    changes_before = connection.total_changes
    try:
        with pytest.raises(ValueError, match=r"GRAPH|BASELINE_ENTRIES"):
            _execute_sqlite_cursor_baseline_entries_publication_intrinsic(*args)  # type: ignore[arg-type]
        assert connection.total_changes == changes_before
        assert _published_rows(connection) == []
        unchanged = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert unchanged.lifecycle == "active"
        assert unchanged.write_phase == "post-ddl-reader-closed"
        assert unchanged.baseline_entries_publication_receipt is None
        assert _publish(authority, migration_receipt, fence, reader_lease)
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


def test_receipt_assertion_rejects_forgery_snapshot_and_cross_run_substitution() -> None:
    graph = _terminal_graph(1)
    other = _terminal_graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease = graph
    other_connection, other_stage, other_authority, other_migration, other_fence, other_reader = (
        other
    )
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        other_receipt = _publish(other_authority, other_migration, other_fence, other_reader)
        snapshot = _read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(receipt)
        forged = object.__new__(_SQLiteBaselineEntriesPublicationReceipt)
        candidates = (cast(object, snapshot), forged, other_receipt, object())
        for candidate in candidates:
            with pytest.raises(ValueError, match=r"RECEIPT|GRAPH|BASELINE_ENTRIES"):
                _assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic(
                    authority,
                    migration_receipt,
                    fence,
                    reader_lease,
                    cast(_SQLiteBaselineEntriesPublicationReceipt, candidate),
                )
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
        assert (
            _assert_receipt(
                other_authority, other_migration, other_fence, other_reader, other_receipt
            )
            is other_receipt
        )
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


def test_active_reader_is_rejected_before_permanent_write() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _reader_minted_graph(1)
    changes_before = connection.total_changes
    try:
        with pytest.raises(ValueError, match=r"READER|TERMINAL|BASELINE_ENTRIES"):
            _publish(authority, migration_receipt, fence, reader_lease)
        assert _published_rows(connection) == []
        assert connection.total_changes == changes_before
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_failed_close_reader_is_rejected_and_close_is_never_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _reader_minted_graph(1)
    close_calls = 0
    primary = RuntimeError("injected reader close failure")

    def fail_close(_reader: object) -> None:
        nonlocal close_calls
        close_calls += 1
        raise primary

    monkeypatch.setattr(outer_module, "_CURSOR_CLOSE", fail_close)
    try:
        with pytest.raises(ValueError, match="CLOSE") as reader_error:
            _execute_sqlite_cursor_post_ddl_publication_reader_intrinsic(
                authority, migration_receipt, fence, reader_lease
            )
        assert reader_error.value.__cause__ is primary
        assert close_calls == 1
        with pytest.raises(ValueError, match=r"READER|TERMINAL|BASELINE_ENTRIES"):
            _publish(authority, migration_receipt, fence, reader_lease)
        assert close_calls == 1
        assert _published_rows(connection) == []
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_stale_transaction_lineage_retires_before_prepare_and_writes_nothing() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    changes_before = connection.total_changes
    try:
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match=r"STALE|LINEAGE|GENERATION|FENCE"):
            _publish(authority, migration_receipt, fence, reader_lease)
        # Rolling back migration 0002 also removes its newly created table, so
        # the immutable total_changes watermark is the only valid no-write
        # observation in the replacement transaction.
        assert connection.total_changes == changes_before
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.baseline_entries_publication_receipt_mint_count == 0
        assert snapshot.lifecycle == "retired"
        assert snapshot.write_phase == "retired"
    finally:
        _safe_cleanup(connection, stage)


def test_unexplained_total_changes_drift_poisons_before_publication_prepare() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    cursor = connection.execute(
        "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
    )
    cursor.close()
    changes_after_drift = connection.total_changes
    try:
        with pytest.raises(ValueError, match=r"WATERMARK|DRIFT|LEDGER|FENCE"):
            _publish(authority, migration_receipt, fence, reader_lease)
        assert connection.total_changes == changes_after_drift
        assert _published_rows(connection) == []
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("expected_count", [-1, True, 2**53])
def test_source_rejects_invalid_expected_count_before_cursor_prepare(
    expected_count: object,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    try:
        with pytest.raises(ValueError, match="EXPECTED_COUNT"):
            _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
                connection, cast(int, expected_count)
            )
        assert _published_rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_source_prepare_failure_is_structured_and_creates_no_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    registry_before = len(source_module._BASELINE_ENTRY_PUBLICATION_EXECUTIONS)
    primary = RuntimeError("injected native cursor allocation failure")

    def fail_cursor(_raw_connection: object) -> object:
        raise primary

    monkeypatch.setattr(source_module, "_BASELINE_ENTRY_SQLITE_CONNECTION_CURSOR", fail_cursor)
    try:
        with pytest.raises(ValueError, match="BASELINE_ENTRY_PREPARE") as caught:
            _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(connection, 1)
        assert caught.value.__cause__ is primary
        assert len(source_module._BASELINE_ENTRY_PUBLICATION_EXECUTIONS) == registry_before
        assert _published_rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_source_native_execute_failure_counts_attempt_but_not_completion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
        connection, 1
    )
    primary = RuntimeError("injected native execute failure")

    def fail_execute(*_args: object) -> object:
        raise primary

    monkeypatch.setattr(source_module, "_BASELINE_ENTRY_SQLITE_CURSOR_EXECUTE", fail_execute)
    try:
        with pytest.raises(ValueError, match="BASELINE_ENTRY_EXECUTE") as caught:
            _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                0,
                "schema-envelope",
                b'{"scope":"cycle-store"}',
                b"{}",
                BASELINE_GENESIS_HASH,
                "2" * 64,
            )
        assert caught.value.__cause__ is primary
        snapshot = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.execute_count == 1
        assert snapshot.completed_entry_count == 0
        assert snapshot.affected_rows == 0
        assert snapshot.next_entry_ordinal == 0
        assert _published_rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_source_wrong_native_rowcount_retains_completed_physical_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
        connection, 1
    )

    class WrongRowCount:
        def __get__(self, _instance: object, _owner: object) -> int:
            return 0

    monkeypatch.setattr(source_module, "_BASELINE_ENTRY_SQLITE_CURSOR_ROWCOUNT", WrongRowCount())
    try:
        with pytest.raises(ValueError, match="AFFECTED_ROWS"):
            _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                0,
                "schema-envelope",
                b'{"scope":"cycle-store"}',
                b"{}",
                BASELINE_GENESIS_HASH,
                "2" * 64,
            )
        snapshot = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.execute_count == 1
        assert snapshot.completed_entry_count == 1
        assert snapshot.affected_rows == 1
        assert snapshot.next_entry_ordinal == 1
        assert len(_published_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_source_native_counter_drift_retains_completed_physical_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
        connection, 1
    )
    native = source_module._BASELINE_ENTRY_SQLITE_CONNECTION_TOTAL_CHANGES
    reads = 0

    class DriftCounter:
        def __get__(self, instance: object, owner: object) -> int:
            nonlocal reads
            reads += 1
            actual = native.__get__(instance, owner)
            return actual + 1 if reads == 2 else actual

    # The execution itself performs one pre-run counter read and one post-run
    # read.  Drift only the latter; failure synchronization then sees reality.
    monkeypatch.setattr(
        source_module,
        "_BASELINE_ENTRY_SQLITE_CONNECTION_TOTAL_CHANGES",
        DriftCounter(),
    )
    try:
        with pytest.raises(ValueError, match="ACCOUNTING"):
            _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                0,
                "schema-envelope",
                b'{"scope":"cycle-store"}',
                b"{}",
                BASELINE_GENESIS_HASH,
                "2" * 64,
            )
        snapshot = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.execute_count == 1
        assert snapshot.completed_entry_count == 1
        assert snapshot.affected_rows == 1
        assert snapshot.total_changes_delta == 1
        assert len(_published_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    ("ordinal", "entry_kind", "key_blob", "state_blob", "previous_hash", "entry_hash"),
    [
        (1, "schema-envelope", b"{}", b"{}", "1" * 64, "2" * 64),
        (0, "unknown", b"{}", b"{}", "1" * 64, "2" * 64),
        (0, "schema-envelope", bytearray(b"{}"), b"{}", "1" * 64, "2" * 64),
        (0, "schema-envelope", b"{}", memoryview(b"{}"), "1" * 64, "2" * 64),
        (0, "schema-envelope", b"{}", b"{}", "A" * 64, "2" * 64),
        (0, "schema-envelope", b"{}", b"{}", "1" * 64, "g" * 64),
    ],
)
def test_source_rejects_noncanonical_seven_parameter_rows_before_native_run(
    ordinal: object,
    entry_kind: object,
    key_blob: object,
    state_blob: object,
    previous_hash: object,
    entry_hash: object,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
        connection, 1
    )
    try:
        with pytest.raises(ValueError, match="BASELINE_ENTRY"):
            _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                ordinal,
                entry_kind,
                key_blob,
                state_blob,
                previous_hash,
                entry_hash,
            )
        progress = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.lifecycle == "poisoned"
        assert progress.execute_count == 0
        assert progress.completed_entry_count == 0
        assert _published_rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_source_execution_is_one_shot_and_wrong_connection_cannot_read_it() -> None:
    graph = _terminal_graph(0)
    other = _terminal_graph(0)
    connection, stage, _, _, _, _ = graph
    other_connection, other_stage, _, _, _, _ = other
    try:
        execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
            connection, 0
        )
        with pytest.raises(ValueError, match="BASELINE_ENTRY_EXECUTION"):
            _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
                other_connection, execution
            )
        with pytest.raises(ValueError, match="TERMINAL"):
            _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                0,
                "schema-envelope",
                b"{}",
                b"{}",
                BASELINE_GENESIS_HASH,
                "2" * 64,
            )
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("baseline_id", "v2-" + "0" * 64),
        ("ordinal", 7),
        ("previous_entry_hash", "0" * 64),
        ("entry_hash", "0" * 64),
    ],
)
def test_private_reader_vector_chain_drift_is_reproved_before_prepare(
    field: str,
    replacement: object,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    record = outer_module._post_ddl_publication_reader_record(reader_lease)
    assert record.retained_entries is not None
    entries = list(record.retained_entries)
    index = len(entries) - 1 if field == "entry_hash" else 0
    entries[index] = replace(entries[index], **{field: replacement})
    record.retained_entries = tuple(entries)
    changes_before = connection.total_changes
    try:
        with pytest.raises(ValueError, match=r"CHAIN|FRAME|PROJECTION|BASELINE_ENTRIES"):
            _publish(authority, migration_receipt, fence, reader_lease)
        assert connection.total_changes == changes_before
        assert _published_rows(connection) == []
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_outer_writer_uses_captured_source_reader_and_digest_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)

    def hostile(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("late module replacement escaped captured boundary")

    monkeypatch.setattr(
        outer_module,
        "_read_sqlite_cursor_post_ddl_publication_reader_entries_intrinsic",
        hostile,
    )
    monkeypatch.setattr(
        source_module,
        "_begin_sqlite_connection_baseline_entry_publication_execution_intrinsic",
        hostile,
    )
    monkeypatch.setattr(
        source_module,
        "_execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic",
        hostile,
    )
    monkeypatch.setattr(digest_module, "_digest_sqlite_initial_write_parameters_intrinsic", hostile)
    monkeypatch.setattr(digest_module, "_digest_sqlite_initial_write_result_intrinsic", hostile)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
        assert len(_published_rows(connection)) == 12
    finally:
        _safe_cleanup(connection, stage)


def test_outer_writer_uses_captured_base64_and_sha_dependencies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)

    def hostile(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("late base64/hash replacement was invoked")

    monkeypatch.setattr(outer_module, "urlsafe_b64encode", hostile)
    monkeypatch.setattr(outer_module, "hashlib", hostile)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
    finally:
        _safe_cleanup(connection, stage)


def test_receipt_assertion_rejects_outer_ledger_regression() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        state = outer_module._authority_state(authority)
        state.fixed_statement_count -= 1
        with pytest.raises(ValueError, match=r"LEDGER|WATERMARK|RECEIPT"):
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _safe_cleanup(connection, stage)


def test_publication_does_not_open_close_or_replace_caller_transaction() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    generation = connection._transaction_generation
    statements: list[str] = []
    raw = _raw(connection)
    raw.set_trace_callback(statements.append)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        assert connection.in_transaction
        assert connection.in_exclusive_transaction
        assert connection._transaction_generation is generation
        controls = {
            statement.lstrip().split(maxsplit=1)[0].upper()
            for statement in statements
            if statement.strip()
        }
        assert controls.isdisjoint({"BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE"})
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
    finally:
        raw.set_trace_callback(None)
        _safe_cleanup(connection, stage)


def test_receipt_mints_no_header_sequence_or_adoption_authority() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        assert len(_published_rows(connection)) == 12
        for table in (
            "main.ge_cycle_operation_baselines",
            "main.ge_cycle_operation_sequence",
        ):
            cursor = connection.execute(f"SELECT COUNT(*) FROM {table}")
            try:
                row = cursor.fetchone()
                assert row == (0,)
            finally:
                cursor.close()
        snapshot = _read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(receipt)
        assert not hasattr(snapshot, "baseline_header_publication_receipt")
        assert not hasattr(snapshot, "operation_sequence_zero_publication_receipt")
        assert not hasattr(snapshot, "initial_stage_adoption_receipt")
    finally:
        _safe_cleanup(connection, stage)


def test_api_has_no_caller_sql_rows_count_hashes_parameters_or_cleanup() -> None:
    execute_parameters = tuple(
        signature(_execute_sqlite_cursor_baseline_entries_publication_intrinsic).parameters
    )
    assert execute_parameters == (
        "authority",
        "migration_0002_receipt",
        "fence",
        "reader_lease",
    )
    assert_parameters = tuple(
        signature(_assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic).parameters
    )
    assert assert_parameters == (*execute_parameters, "receipt")
    forbidden = {
        "sql",
        "rows",
        "entries",
        "count",
        "baseline_id",
        "ordinal",
        "hash",
        "parameters",
        "cursor",
        "cleanup",
    }
    assert forbidden.isdisjoint(execute_parameters)
    assert forbidden.isdisjoint(assert_parameters)


def test_package_root_keeps_all_baseline_entry_capabilities_private() -> None:
    for name in (
        "SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC",
        "SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC",
        "SQLiteBaselineEntriesPublicationReceipt",
        "execute_sqlite_cursor_baseline_entries_publication",
        "assert_sqlite_cursor_baseline_entries_publication_receipt",
        "read_sqlite_baseline_entries_publication_receipt_snapshot",
        "_SQLiteBaselineEntriesPublicationReceipt",
        "_SQLiteBaselineEntriesPublicationReceiptSnapshot",
        "_execute_sqlite_cursor_baseline_entries_publication_intrinsic",
        "_assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic",
        "_read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic",
        "_SQLiteConnectionBaselineEntryPublicationExecution",
        "_SQLiteConnectionBaselineEntryPublicationExecutionSnapshot",
        "_SQLiteConnectionBaselineEntryPublicationStepSnapshot",
        "_begin_sqlite_connection_baseline_entry_publication_execution_intrinsic",
        "_execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic",
        "_read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic",
    ):
        assert not hasattr(graph_engineering, name)


def test_successful_receipt_registry_does_not_keep_upstream_graph_alive() -> None:
    gc.collect()
    gc.collect()
    baselines = (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
        len(outer_module._POST_DDL_PUBLICATION_READER_LEASES),
        len(outer_module._BASELINE_ENTRIES_PUBLICATION_RECEIPTS),
    )

    def abandon() -> tuple[object, object, object, object, object, object]:
        connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        references = (
            ref(authority),
            ref(migration_receipt),
            ref(fence),
            ref(reader_lease),
            ref(stage),
        )
        _safe_cleanup(connection, stage)
        return (receipt, *references)

    receipt, authority_ref, migration_ref, fence_ref, reader_ref, stage_ref = abandon()
    gc.collect()
    gc.collect()
    assert authority_ref() is None  # type: ignore[operator]
    assert migration_ref() is None  # type: ignore[operator]
    assert fence_ref() is None  # type: ignore[operator]
    assert reader_ref() is None  # type: ignore[operator]
    assert stage_ref() is None  # type: ignore[operator]
    assert (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
        len(outer_module._POST_DDL_PUBLICATION_READER_LEASES),
    ) == baselines[:4]
    assert len(outer_module._BASELINE_ENTRIES_PUBLICATION_RECEIPTS) == baselines[4] + 1
    with pytest.raises(ValueError, match=r"RECEIPT|GRAPH|BASELINE_ENTRIES"):
        _read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(
            cast(_SQLiteBaselineEntriesPublicationReceipt, receipt)
        )
    receipt_ref = ref(receipt)
    del receipt
    gc.collect()
    gc.collect()
    assert receipt_ref() is None
    assert len(outer_module._BASELINE_ENTRIES_PUBLICATION_RECEIPTS) == baselines[4]


def test_leaf_source_contains_no_commit_rollback_header_sequence_or_adoption_write() -> None:
    source = Path(cast(str, outer_module.__file__)).read_text(encoding="utf-8")
    start = source.index("def _execute_sqlite_cursor_baseline_entries_publication_intrinsic")
    end = source.find("def _execute_sqlite_cursor_baseline_header", start)
    leaf = source[start : end if end >= 0 else len(source)]
    for forbidden in (
        ".commit(",
        ".rollback(",
        ".begin_exclusive(",
        "executescript(",
        "INSERT INTO main.ge_cycle_operation_baselines",
        "INSERT INTO main.ge_cycle_operation_sequence",
        "initial_stage_adoption",
        "manifest_activation",
    ):
        assert forbidden not in leaf


@pytest.mark.parametrize("hostile_seam", ["builder", "verifier"])
def test_independent_frame_builder_and_verifier_reject_single_seam_substitution(
    monkeypatch: pytest.MonkeyPatch,
    hostile_seam: str,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    changes_before = connection.total_changes

    def empty_frame(_entries: object, _projection: object) -> list[object]:
        return []

    seam = (
        "_BUILD_BASELINE_ENTRIES_FRAME"
        if hostile_seam == "builder"
        else "_VERIFY_BASELINE_ENTRIES_FRAME"
    )
    monkeypatch.setattr(outer_module, seam, empty_frame)
    try:
        with pytest.raises(ValueError, match="DIGEST"):
            _publish(authority, migration_receipt, fence, reader_lease)
        # The first-pass seam is evaluated before DML while the verifier seam
        # is evaluated after it; either isolated substitution must mint zero.
        expected_rows = 12
        assert len(_published_rows(connection)) == expected_rows
        assert connection.total_changes == changes_before + expected_rows
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.baseline_entries_publication_receipt_mint_count == 0
        assert snapshot.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("key_bytes", b""),
        ("state_bytes", b'{ "noncanonical": true }'),
    ],
)
def test_retained_reader_bytes_are_bounded_and_canonically_recaptured_before_prepare(
    field: str,
    replacement: bytes,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    record = outer_module._post_ddl_publication_reader_record(reader_lease)
    assert record.retained_entries is not None
    entries = list(record.retained_entries)
    entries[0] = replace(entries[0], **{field: replacement})
    record.retained_entries = tuple(entries)
    changes_before = connection.total_changes
    try:
        with pytest.raises(ValueError, match="CHAIN"):
            _publish(authority, migration_receipt, fence, reader_lease)
        assert connection.total_changes == changes_before
        assert _published_rows(connection) == []
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_receipt_registry_record_retains_only_weak_graph_edges_and_scalar_commitments() -> None:
    fields = set(outer_module._BaselineEntriesPublicationReceiptRecord.__dataclass_fields__)
    assert {
        "connection",
        "authority",
        "migration_0002_receipt",
        "fence",
        "reader_lease",
        "projection_identity",
        "projection_reference",
        "entries",
        "frame",
        "snapshot",
        "exception",
        "error",
    }.isdisjoint(fields)
    assert {
        "connection_id",
        "projection_identity_id",
        "authority_ref",
        "migration_0002_receipt_ref",
        "fence_ref",
        "reader_lease_ref",
        "projection_reference_ref",
    } <= fields


def test_receipt_assertion_rejects_equal_projection_identity_clone_substitution() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        state = outer_module._authority_state(authority)
        original = state.projection_identity
        clone = replace(original)
        assert clone == original and clone is not original
        state.projection_identity = clone
        with pytest.raises(
            ValueError,
            match=r"(?i)projection|graph|receipt|ownership|provenance|invalid",
        ):
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _safe_cleanup(connection, stage)


def test_post_return_primary_outranks_progress_read_failure_and_retains_source_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    execute = outer_module._EXECUTE_NEXT_BASELINE_ENTRY
    primary = RuntimeError("injected post-return primary")
    secondary = RuntimeError("injected progress-read secondary")
    captured_execution: _SQLiteConnectionBaselineEntryPublicationExecution | None = None

    def run_then_fail(*args: object) -> object:
        nonlocal captured_execution
        captured_execution = cast(_SQLiteConnectionBaselineEntryPublicationExecution, args[1])
        execute(*args)
        raise primary

    def fail_progress(*_args: object) -> object:
        raise secondary

    monkeypatch.setattr(outer_module, "_EXECUTE_NEXT_BASELINE_ENTRY", run_then_fail)
    monkeypatch.setattr(outer_module, "_READ_BASELINE_ENTRY_PUBLICATION_PROGRESS", fail_progress)
    try:
        with pytest.raises(RuntimeError, match="post-return primary") as caught:
            _publish(authority, migration_receipt, fence, reader_lease)
        assert caught.value is primary
        assert captured_execution is not None
        progress = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, captured_execution
        )
        assert progress.execute_count == 1
        assert progress.completed_entry_count == 1
        assert progress.affected_rows == 1
        assert len(_published_rows(connection)) == 1
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_receipt_assertion_allows_monotonic_later_phase_ledger_advancement() -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        state = outer_module._authority_state(authority)
        cursor = connection.execute(
            "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
        )
        cursor.close()
        state.logical_write_sequence += 1
        state.fixed_statement_count += 1
        state.affected_rows_watermark += 1
        state.current_transaction_epoch = connection.transaction_epoch
        state.current_total_changes = connection.total_changes
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
    finally:
        _safe_cleanup(connection, stage)


def test_paired_late_public_sql_and_sha_replacement_cannot_rewrite_receipt_commitments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        hostile_source = "SELECT 'hostile-source-global'"
        hostile_insert = "INSERT INTO hostile_global VALUES (?)"
        monkeypatch.setattr(
            outer_module,
            "SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL",
            hostile_source,
        )
        monkeypatch.setattr(
            outer_module,
            "SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256",
            hashlib.sha256(hostile_source.encode("utf-8")).hexdigest(),
        )
        monkeypatch.setattr(
            outer_module,
            "SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC",
            hostile_insert,
        )
        monkeypatch.setattr(
            outer_module,
            "SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC",
            hashlib.sha256(hostile_insert.encode("utf-8")).hexdigest(),
        )
        assert (
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt) is receipt
        )
        snapshot = _read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(receipt)
        assert snapshot.source_read_sql == SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL
        assert (
            snapshot.source_read_sql_sha256
            == SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256
        )
        assert snapshot.fixed_insert_sql == _INSERT_SQL
        assert snapshot.fixed_insert_sql_sha256 == _INSERT_SQL_SHA256
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("commitment", ["source", "insert"])
def test_direct_receipt_sql_commitment_tampering_is_rejected_and_poisons(
    commitment: str,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    try:
        receipt = _publish(authority, migration_receipt, fence, reader_lease)
        record = outer_module._baseline_entries_receipt_record(receipt)
        hostile = "SELECT 'tampered'" if commitment == "source" else "INSERT tampered"
        if commitment == "source":
            object.__setattr__(record, "source_read_sql", hostile)
            object.__setattr__(
                record,
                "source_read_sql_sha256",
                hashlib.sha256(hostile.encode("utf-8")).hexdigest(),
            )
        else:
            object.__setattr__(record, "fixed_insert_sql", hostile)
            object.__setattr__(
                record,
                "fixed_insert_sql_sha256",
                hashlib.sha256(hostile.encode("utf-8")).hexdigest(),
            )
        with pytest.raises(ValueError, match=r"SQL|RECEIPT|DRIFT"):
            _assert_receipt(authority, migration_receipt, fence, reader_lease, receipt)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _safe_cleanup(connection, stage)


def test_source_success_closes_native_cursor_exactly_once_and_terminal_replay_never_recloses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    native_close = source_module._BASELINE_ENTRY_SQLITE_CURSOR_CLOSE
    close_calls = 0

    def counted_close(cursor: object) -> object:
        nonlocal close_calls
        close_calls += 1
        return native_close(cursor)

    monkeypatch.setattr(source_module, "_BASELINE_ENTRY_SQLITE_CURSOR_CLOSE", counted_close)
    try:
        execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
            connection, 1
        )
        _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
            connection,
            execution,
            "v2-" + "1" * 64,
            0,
            "schema-envelope",
            b'{"scope":"cycle-store"}',
            b"{}",
            BASELINE_GENESIS_HASH,
            "2" * 64,
        )
        assert close_calls == 1
        progress = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.lifecycle == "completed"
        assert progress.close_attempt_count == 1
        assert progress.close_succeeded is True
        with pytest.raises(ValueError, match="TERMINAL"):
            _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                1,
                "schema-envelope",
                b"{}",
                b"{}",
                "2" * 64,
                "3" * 64,
            )
        assert close_calls == 1
    finally:
        _safe_cleanup(connection, stage)


def test_source_execute_primary_outranks_close_failure_with_exact_close_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
        connection, 1
    )
    execute_primary = RuntimeError("injected source execute primary")
    close_secondary = RuntimeError("injected source close secondary")
    close_calls = 0

    def fail_execute(*_args: object) -> object:
        raise execute_primary

    def fail_close(_cursor: object) -> object:
        nonlocal close_calls
        close_calls += 1
        raise close_secondary

    monkeypatch.setattr(source_module, "_BASELINE_ENTRY_SQLITE_CURSOR_EXECUTE", fail_execute)
    monkeypatch.setattr(source_module, "_BASELINE_ENTRY_SQLITE_CURSOR_CLOSE", fail_close)
    try:
        with pytest.raises(ValueError, match="BASELINE_ENTRY_EXECUTE") as caught:
            _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                0,
                "schema-envelope",
                b'{"scope":"cycle-store"}',
                b"{}",
                BASELINE_GENESIS_HASH,
                "2" * 64,
            )
        assert caught.value.__cause__ is execute_primary
        assert close_calls == 1
        progress = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.lifecycle == "poisoned"
        assert progress.execute_count == 1
        assert progress.completed_entry_count == 0
        assert progress.close_attempt_count == 1
        assert progress.close_succeeded is False
    finally:
        _safe_cleanup(connection, stage)


def test_source_final_row_close_failure_is_structured_and_retains_complete_physical_progress(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
        connection, 1
    )
    close_primary = RuntimeError("injected source final close failure")
    close_calls = 0

    def fail_close(_cursor: object) -> object:
        nonlocal close_calls
        close_calls += 1
        raise close_primary

    monkeypatch.setattr(source_module, "_BASELINE_ENTRY_SQLITE_CURSOR_CLOSE", fail_close)
    try:
        with pytest.raises(ValueError, match="BASELINE_ENTRY_CLEANUP") as caught:
            _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                0,
                "schema-envelope",
                b'{"scope":"cycle-store"}',
                b"{}",
                BASELINE_GENESIS_HASH,
                "2" * 64,
            )
        assert caught.value.__cause__ is close_primary
        assert close_calls == 1
        progress = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.lifecycle == "poisoned"
        assert progress.execute_count == 1
        assert progress.completed_entry_count == 1
        assert progress.affected_rows == 1
        assert progress.close_attempt_count == 1
        assert progress.close_succeeded is False
        assert len(_published_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_terminal_source_execution_retains_no_cursor_and_registry_collects() -> None:
    gc.collect()
    gc.collect()
    baseline = len(source_module._BASELINE_ENTRY_PUBLICATION_EXECUTIONS)
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(0)
    del authority, migration_receipt, fence, reader_lease
    try:
        execution = _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
            connection, 0
        )
        entry = source_module._BASELINE_ENTRY_PUBLICATION_EXECUTIONS[id(execution)]
        state = entry[1]
        assert state.cursor is None
        assert state.close_attempt_count == 1
        assert state.close_succeeded is True
        assert len(source_module._BASELINE_ENTRY_PUBLICATION_EXECUTIONS) == baseline + 1
        execution_ref = ref(execution)
        del state, entry, execution
        gc.collect()
        gc.collect()
        assert execution_ref() is None
        assert len(source_module._BASELINE_ENTRY_PUBLICATION_EXECUTIONS) == baseline
    finally:
        _safe_cleanup(connection, stage)


def test_outer_final_close_failure_retains_e12_rows_mints_zero_and_poisons_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(1)
    begin = outer_module._BEGIN_BASELINE_ENTRY_PUBLICATION
    execution: _SQLiteConnectionBaselineEntryPublicationExecution | None = None
    close_primary = RuntimeError("injected outer final close failure")

    def capture_begin(owner: object, expected: int) -> object:
        nonlocal execution
        execution = cast(
            _SQLiteConnectionBaselineEntryPublicationExecution,
            begin(owner, expected),
        )
        return execution

    def fail_close(_cursor: object) -> object:
        raise close_primary

    monkeypatch.setattr(outer_module, "_BEGIN_BASELINE_ENTRY_PUBLICATION", capture_begin)
    monkeypatch.setattr(source_module, "_BASELINE_ENTRY_SQLITE_CURSOR_CLOSE", fail_close)
    try:
        with pytest.raises(ValueError, match="BASELINE_ENTRY_CLEANUP") as caught:
            _publish(authority, migration_receipt, fence, reader_lease)
        assert caught.value.__cause__ is close_primary
        assert execution is not None
        progress = _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.completed_entry_count == 12
        assert progress.execute_count == 12
        assert progress.affected_rows == 12
        assert progress.lifecycle == "poisoned"
        assert progress.close_attempt_count == 1
        assert progress.close_succeeded is False
        assert len(_published_rows(connection)) == 12
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.outer_ledger == (14, 32, 1)
        assert snapshot.baseline_entries_publication_receipt is None
        assert snapshot.baseline_entries_publication_receipt_mint_count == 0
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)
