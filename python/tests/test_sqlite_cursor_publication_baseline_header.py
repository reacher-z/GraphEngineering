from __future__ import annotations

import base64
import gc
import hashlib
import os
from dataclasses import replace
from inspect import signature
from pathlib import Path
from typing import cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_operation_baseline_source as source_module
from graph_engineering.sqlite_cursor_publication_initial_write_digest import (
    _digest_sqlite_initial_write_parameters_intrinsic,
    _digest_sqlite_initial_write_result_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_outer_authority import (
    SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC,
    SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC,
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC,
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC,
    _assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic,
    _execute_sqlite_cursor_baseline_header_publication_intrinsic,
    _read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic,
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _SQLiteBaselineEntriesPublicationReceipt,
    _SQLiteBaselineHeaderPublicationReceipt,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _SQLiteMigration0002CatalogRebuildReceipt,
)
from graph_engineering.sqlite_operation_baseline import encode_baseline_policy
from graph_engineering.sqlite_operation_baseline_source import (
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC as SOURCE_INSERT_SQL,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC as SOURCE_INSERT_SHA256,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC as SOURCE_PARAMETER_ORDER,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    _begin_sqlite_connection_baseline_header_publication_execution_intrinsic,
    _execute_sqlite_connection_baseline_header_publication_intrinsic,
    _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic,
    _SQLiteConnectionBaselineHeaderPublicationExecution,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_cursor_publication_baseline_entries import (
    _publish as _publish_entries,
)
from tests.test_sqlite_cursor_publication_baseline_entries import (
    _safe_cleanup,
    _terminal_graph,
)
from tests.test_sqlite_cursor_publication_migration_0002_execution import _raw

_INSERT_SQL = (
    "INSERT INTO main.ge_cycle_operation_baselines (baseline_id, "
    "baseline_format_version, source_application_id, source_user_version, "
    "source_schema_identity_sha256, source_migration_lineage_id, "
    "source_migration_lineage_sha256, source_descriptor_hash, captured_at_ms, "
    "legacy_operation_count, entry_count, first_entry_hash, final_entry_hash, "
    "canonical_projection_sha256, creation_runtime, creation_runtime_version, "
    "policy_blob) VALUES (?, 1, 1195724359, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)
_INSERT_SHA256 = "b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a"
_PARAMETER_ORDER = (
    "baselineId",
    "sourceSchemaIdentitySha256",
    "sourceMigrationLineageId",
    "sourceMigrationLineageSha256",
    "sourceDescriptorHash",
    "capturedAtMs",
    "legacyOperationCount",
    "entryCount",
    "firstEntryHash",
    "finalEntryHash",
    "canonicalProjectionSha256",
    "creationRuntime",
    "creationRuntimeVersion",
    "policyBlob",
)
_SOURCE_PARAMETER_ORDER = (
    "baseline_id",
    "source_schema_identity_sha256",
    "source_migration_lineage_id",
    "source_migration_lineage_sha256",
    "source_descriptor_hash",
    "captured_at_ms",
    "legacy_operation_count",
    "entry_count",
    "first_entry_hash",
    "final_entry_hash",
    "canonical_projection_sha256",
    "creation_runtime",
    "creation_runtime_version",
    "policy_blob",
)
_POLICY_SHA256 = "67cbe0ac8bf04f28061d50f8b7089312cc1e1f9a9520ede95deec0d1f4ec5eb0"
_PARAMETER_E12_SHA256 = "08d9635267a488ec2a7f2277646708c8636c2266944bbb50383b230bf38817ff"
_RESULT_SHA256 = "2475973b53ba5659827cf78fca83b7a040172ae04e0c03d7de1cd7a297f1a96e"
_RECEIPT_FIELDS = (
    "affected_rows",
    "authority",
    "baseline_entries_publication_receipt",
    "baseline_id",
    "canonical_projection_sha256",
    "captured_at_ms",
    "connection",
    "creation_runtime",
    "creation_runtime_version",
    "entry_count",
    "execute_count",
    "final_entry_hash",
    "fixed_insert_sql",
    "fixed_insert_sql_sha256",
    "first_entry_hash",
    "legacy_operation_count",
    "mint_count",
    "outer_ledger_after",
    "outer_ledger_before",
    "outer_ledger_delta",
    "parameter_sha256",
    "parameter_order",
    "policy_blob_base64url",
    "policy_blob_sha256",
    "policy_blob_utf8_bytes",
    "post_ddl_catalog_fence",
    "prepare_count",
    "projection_identity",
    "projection_reference",
    "reader_lease",
    "result_sha256",
    "source_descriptor_hash",
    "source_migration_lineage_id",
    "source_migration_lineage_sha256",
    "source_schema_identity_sha256",
    "total_changes_after",
    "total_changes_before",
    "total_changes_delta",
    "transaction_epoch_after",
    "transaction_epoch_before",
    "transaction_generation",
    "write_kind",
)
_SOURCE_STEP_FIELDS = (
    "affected_rows_delta",
    "completed_execution_count",
    "execute_count",
    "prepare_count",
    "total_changes",
    "transaction_epoch",
    "transaction_generation",
)
_SOURCE_EXECUTION_FIELDS = (
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


def _graph(
    legacy_count: int = 1,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _SQLiteBaselineEntriesPublicationReceipt,
]:
    connection, stage, authority, migration_receipt, fence, reader_lease = _terminal_graph(
        legacy_count
    )
    entries_receipt = _publish_entries(authority, migration_receipt, fence, reader_lease)
    return (
        connection,
        stage,
        authority,
        migration_receipt,
        fence,
        reader_lease,
        entries_receipt,
    )


def _publish_header(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    entries_receipt: _SQLiteBaselineEntriesPublicationReceipt,
) -> _SQLiteBaselineHeaderPublicationReceipt:
    return _execute_sqlite_cursor_baseline_header_publication_intrinsic(
        authority, migration_receipt, fence, reader_lease, entries_receipt
    )


def _assert_header(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    entries_receipt: _SQLiteBaselineEntriesPublicationReceipt,
    receipt: _SQLiteBaselineHeaderPublicationReceipt,
) -> _SQLiteBaselineHeaderPublicationReceipt:
    return _assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic(
        authority,
        migration_receipt,
        fence,
        reader_lease,
        entries_receipt,
        receipt,
    )


def _header_rows(connection: SQLiteV1BaselineConnectionOwner) -> list[tuple[object, ...]]:
    cursor = connection.execute(
        "SELECT baseline_id, baseline_format_version, source_application_id, "
        "source_user_version, source_schema_identity_sha256, "
        "source_migration_lineage_id, source_migration_lineage_sha256, "
        "source_descriptor_hash, captured_at_ms, legacy_operation_count, "
        "entry_count, first_entry_hash, final_entry_hash, "
        "canonical_projection_sha256, creation_runtime, creation_runtime_version, "
        "policy_blob FROM main.ge_cycle_operation_baselines ORDER BY baseline_id ASC"
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


def _text(value: str) -> dict[str, object]:
    return {"type": "text", "value": value}


def _integer(value: int) -> dict[str, object]:
    return {"type": "integer", "value": str(value)}


def _blob(value: bytes) -> dict[str, object]:
    return {
        "type": "blob",
        "value": base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii"),
    }


def _frame(authority: _SQLiteCursorOuterPublicationAuthority) -> list[list[dict[str, object]]]:
    state = outer_module._authority_state(authority)
    projection = state.projection_identity
    return [
        [
            _text(projection.baseline_id),
            _text(state.source_schema_identity_sha256),
            _text(state.source_migration_lineage_id),
            _text(state.source_migration_lineage_sha256),
            _text(state.source_descriptor_hash),
            _integer(state.captured_at_ms),
            _integer(projection.legacy_operation_count),
            _integer(projection.entry_count),
            _text(projection.first_entry_hash),
            _text(projection.final_entry_hash),
            _text(projection.projection_sha256),
            _text("graph-engineering-python"),
            _text("0.1.0a1"),
            _blob(encode_baseline_policy()),
        ]
    ]


def test_exact_sql_sha_parameter_order_and_runtime_literals() -> None:
    assert len(_INSERT_SQL.encode("utf-8")) == 488
    assert SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC == _INSERT_SQL
    assert SOURCE_INSERT_SQL == _INSERT_SQL
    assert SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC == (_INSERT_SHA256)
    assert SOURCE_INSERT_SHA256 == _INSERT_SHA256
    assert hashlib.sha256(_INSERT_SQL.encode()).hexdigest() == _INSERT_SHA256
    assert SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC == (_PARAMETER_ORDER)
    assert SOURCE_PARAMETER_ORDER == _SOURCE_PARAMETER_ORDER
    assert SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC == ("graph-engineering-python")
    assert SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC == "0.1.0a1"


def test_publishes_exact_e12_header_42_field_receipt_and_real_ledgers() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
    changes_before = connection.total_changes
    epoch_before = connection.transaction_epoch
    try:
        assert before.outer_ledger == (14, 32, 2)
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        snapshot = _read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(receipt)
        assert snapshot._fields == _RECEIPT_FIELDS
        assert snapshot.affected_rows == 1
        assert snapshot.authority is authority
        assert snapshot.baseline_entries_publication_receipt is entries
        assert snapshot.baseline_id == before.projection_identity.baseline_id
        assert snapshot.canonical_projection_sha256 == before.projection_identity.projection_sha256
        assert snapshot.captured_at_ms == before.captured_at_ms
        assert snapshot.connection is connection
        assert snapshot.creation_runtime == "graph-engineering-python"
        assert snapshot.creation_runtime_version == "0.1.0a1"
        assert snapshot.entry_count == 12
        assert snapshot.execute_count == 1
        assert snapshot.final_entry_hash == before.projection_identity.final_entry_hash
        assert snapshot.fixed_insert_sql == _INSERT_SQL
        assert snapshot.fixed_insert_sql_sha256 == _INSERT_SHA256
        assert snapshot.first_entry_hash == before.projection_identity.first_entry_hash
        assert snapshot.legacy_operation_count == 1
        assert snapshot.mint_count == 1
        assert snapshot.outer_ledger_before == (14, 32, 2)
        assert snapshot.outer_ledger_after == (15, 33, 3)
        assert snapshot.outer_ledger_delta == (1, 1, 1)
        assert snapshot.parameter_sha256 == _PARAMETER_E12_SHA256
        assert snapshot.parameter_order == _PARAMETER_ORDER
        assert snapshot.policy_blob_sha256 == _POLICY_SHA256
        assert snapshot.policy_blob_utf8_bytes == 946
        assert snapshot.post_ddl_catalog_fence is fence
        assert snapshot.prepare_count == 1
        assert snapshot.projection_identity is before.projection_identity
        assert snapshot.projection_reference is before.projection_reference
        assert snapshot.reader_lease is reader_lease
        assert snapshot.result_sha256 == _RESULT_SHA256
        assert snapshot.source_descriptor_hash == before.source_descriptor_hash
        assert snapshot.source_migration_lineage_id == before.source_migration_lineage_id
        assert snapshot.source_migration_lineage_sha256 == before.source_migration_lineage_sha256
        assert snapshot.source_schema_identity_sha256 == before.source_schema_identity_sha256
        assert snapshot.total_changes_before == changes_before
        assert snapshot.total_changes_after == changes_before + 1
        assert snapshot.total_changes_delta == 1
        assert snapshot.transaction_epoch_before == epoch_before
        assert snapshot.transaction_epoch_after == epoch_before + 1
        assert snapshot.transaction_generation is connection._transaction_generation
        assert snapshot.write_kind == "baseline-header-publication"
        assert (
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
            is receipt
        )
        after = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert after.baseline_header_publication_receipt is receipt
        assert after.baseline_header_publication_receipt_mint_count == 1
        assert after.baseline_header_logical_execution_count == 1
        assert after.baseline_header_prepare_count == 1
        assert after.baseline_header_execute_count == 1
        assert after.baseline_header_affected_rows == 1
        assert after.outer_ledger == (15, 33, 3)
        assert after.write_phase == "baseline-header-complete"
        assert after.lifecycle == "active"
    finally:
        _safe_cleanup(connection, stage)


def test_writes_exact_source_projection_runtime_and_canonical_policy_row() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    state = outer_module._authority_state(authority)
    projection = state.projection_identity
    policy = encode_baseline_policy()
    old_runtime = os.environ.get("GRAPH_ENGINEERING_CREATION_RUNTIME")
    old_version = os.environ.get("GRAPH_ENGINEERING_CREATION_RUNTIME_VERSION")
    os.environ["GRAPH_ENGINEERING_CREATION_RUNTIME"] = "hostile-runtime"
    os.environ["GRAPH_ENGINEERING_CREATION_RUNTIME_VERSION"] = "999"
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        rows = _header_rows(connection)
        assert rows == [
            (
                projection.baseline_id,
                1,
                1195724359,
                1,
                state.source_schema_identity_sha256,
                state.source_migration_lineage_id,
                state.source_migration_lineage_sha256,
                state.source_descriptor_hash,
                state.captured_at_ms,
                projection.legacy_operation_count,
                projection.entry_count,
                projection.first_entry_hash,
                projection.final_entry_hash,
                projection.projection_sha256,
                "graph-engineering-python",
                "0.1.0a1",
                policy,
            )
        ]
        assert len(policy) == 946
        assert hashlib.sha256(policy).hexdigest() == _POLICY_SHA256
        snapshot = _read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(receipt)
        assert snapshot.policy_blob_base64url == base64.urlsafe_b64encode(policy).rstrip(
            b"="
        ).decode("ascii")
    finally:
        if old_runtime is None:
            os.environ.pop("GRAPH_ENGINEERING_CREATION_RUNTIME", None)
        else:
            os.environ["GRAPH_ENGINEERING_CREATION_RUNTIME"] = old_runtime
        if old_version is None:
            os.environ.pop("GRAPH_ENGINEERING_CREATION_RUNTIME_VERSION", None)
        else:
            os.environ["GRAPH_ENGINEERING_CREATION_RUNTIME_VERSION"] = old_version
        _safe_cleanup(connection, stage)


def test_builds_exact_one_by_fourteen_typed_frame_and_result_digest() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    expected = _frame(authority)
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        snapshot = _read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(receipt)
        assert len(expected) == 1 and len(expected[0]) == 14
        assert [scalar["type"] for scalar in expected[0]] == [
            "text",
            "text",
            "text",
            "text",
            "text",
            "integer",
            "integer",
            "integer",
            "text",
            "text",
            "text",
            "text",
            "text",
            "blob",
        ]
        assert snapshot.parameter_sha256 == _digest_sqlite_initial_write_parameters_intrinsic(
            expected
        )
        assert snapshot.parameter_sha256 == _PARAMETER_E12_SHA256
        assert snapshot.result_sha256 == _digest_sqlite_initial_write_result_intrinsic(
            {"affectedRows": "1"}
        )
        assert snapshot.result_sha256 == _RESULT_SHA256
    finally:
        _safe_cleanup(connection, stage)


def test_source_single_run_snapshot_and_exact_close() -> None:
    graph = _graph(0)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    del migration_receipt, fence, reader_lease, entries
    state = outer_module._authority_state(authority)
    projection = state.projection_identity
    before_changes = connection.total_changes
    before_epoch = connection.transaction_epoch
    try:
        execution = _begin_sqlite_connection_baseline_header_publication_execution_intrinsic(
            connection
        )
        assert type(execution) is _SQLiteConnectionBaselineHeaderPublicationExecution
        before = _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert before._fields == _SOURCE_EXECUTION_FIELDS
        assert before.lifecycle == "active"
        assert before.prepare_count == 1
        assert before.execute_count == 0
        assert before.completed_execution_count == 0
        assert before.affected_rows == 0
        assert before.close_attempt_count == 0
        assert before.close_succeeded is False
        step = _execute_sqlite_connection_baseline_header_publication_intrinsic(
            connection,
            execution,
            projection.baseline_id,
            state.source_schema_identity_sha256,
            state.source_migration_lineage_id,
            state.source_migration_lineage_sha256,
            state.source_descriptor_hash,
            state.captured_at_ms,
            projection.legacy_operation_count,
            projection.entry_count,
            projection.first_entry_hash,
            projection.final_entry_hash,
            projection.projection_sha256,
            "graph-engineering-python",
            "0.1.0a1",
            encode_baseline_policy(),
        )
        assert step._fields == _SOURCE_STEP_FIELDS
        assert step.affected_rows_delta == 1
        assert step.completed_execution_count == 1
        assert step.execute_count == 1
        assert step.prepare_count == 1
        assert step.total_changes == before_changes + 1
        assert step.transaction_epoch == before_epoch + 1
        assert step.transaction_generation is connection._transaction_generation
        after = _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert after.lifecycle == "completed"
        assert after.execute_count == 1
        assert after.completed_execution_count == 1
        assert after.affected_rows == 1
        assert after.total_changes_before == before_changes
        assert after.total_changes == before_changes + 1
        assert after.total_changes_delta == 1
        assert after.close_attempt_count == 1
        assert after.close_succeeded is True
        with pytest.raises(ValueError, match="TERMINAL"):
            _execute_sqlite_connection_baseline_header_publication_intrinsic(
                connection,
                execution,
                projection.baseline_id,
                state.source_schema_identity_sha256,
                state.source_migration_lineage_id,
                state.source_migration_lineage_sha256,
                state.source_descriptor_hash,
                state.captured_at_ms,
                0,
                0,
                projection.first_entry_hash,
                projection.final_entry_hash,
                projection.projection_sha256,
                "graph-engineering-python",
                "0.1.0a1",
                encode_baseline_policy(),
            )
    finally:
        _safe_cleanup(connection, stage)


def test_outer_prepares_once_executes_once_and_issues_no_select_or_transaction_control(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    begin = outer_module._BEGIN_BASELINE_HEADER_PUBLICATION
    execute = outer_module._EXECUTE_BASELINE_HEADER
    calls = {"begin": 0, "execute": 0}
    statements: list[str] = []

    def counted_begin(*args: object) -> object:
        calls["begin"] += 1
        return begin(*args)

    def counted_execute(*args: object) -> object:
        calls["execute"] += 1
        assert len(args) == 16
        return execute(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_BASELINE_HEADER_PUBLICATION", counted_begin)
    monkeypatch.setattr(outer_module, "_EXECUTE_BASELINE_HEADER", counted_execute)
    raw = _raw(connection)
    raw.set_trace_callback(statements.append)
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert calls == {"begin": 1, "execute": 1}
        inserts = [statement for statement in statements if statement.startswith("INSERT INTO")]
        assert len(inserts) == 1
        assert "ge_cycle_operation_baselines" in inserts[0]
        assert not any(statement.startswith("SELECT") for statement in statements)
        controls = {
            statement.lstrip().split(maxsplit=1)[0].upper()
            for statement in statements
            if statement.strip()
        }
        assert controls.isdisjoint({"BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE"})
        assert connection.in_transaction and connection.in_exclusive_transaction
        assert (
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
            is receipt
        )
    finally:
        raw.set_trace_callback(None)
        _safe_cleanup(connection, stage)


def test_api_has_no_caller_sql_values_policy_runtime_clock_or_cleanup() -> None:
    execute_parameters = tuple(
        signature(_execute_sqlite_cursor_baseline_header_publication_intrinsic).parameters
    )
    assert execute_parameters == (
        "authority",
        "migration_0002_receipt",
        "fence",
        "reader_lease",
        "baseline_entries_publication_receipt",
    )
    assert_parameters = tuple(
        signature(_assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic).parameters
    )
    assert assert_parameters == (*execute_parameters, "receipt")
    forbidden = {
        "sql",
        "values",
        "parameters",
        "policy",
        "runtime",
        "version",
        "clock",
        "captured_at_ms",
        "cursor",
        "cleanup",
    }
    assert forbidden.isdisjoint(execute_parameters)
    assert forbidden.isdisjoint(assert_parameters)


def test_rejects_forged_and_cross_graph_entries_receipts_before_prepare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    other = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    other_connection, other_stage, *other_tail = other
    del other_tail
    begin_calls = 0
    begin = outer_module._BEGIN_BASELINE_HEADER_PUBLICATION

    def counted_begin(*args: object) -> object:
        nonlocal begin_calls
        begin_calls += 1
        return begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_BASELINE_HEADER_PUBLICATION", counted_begin)
    forged = object.__new__(_SQLiteBaselineEntriesPublicationReceipt)
    candidates = (object(), forged, other[-1])
    try:
        for candidate in candidates:
            with pytest.raises(ValueError, match=r"ENTRIES|RECEIPT|GRAPH|ARGUMENT"):
                _execute_sqlite_cursor_baseline_header_publication_intrinsic(
                    authority,
                    migration_receipt,
                    fence,
                    reader_lease,
                    cast(_SQLiteBaselineEntriesPublicationReceipt, candidate),
                )
        assert begin_calls == 0
        assert _header_rows(connection) == []
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.lifecycle == "active"
        assert state.write_phase == "baseline-entries-complete"
        assert state.baseline_header_publication_receipt is None
        assert (
            _publish_header(authority, migration_receipt, fence, reader_lease, entries) is not None
        )
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


def test_forged_and_cross_graph_header_receipts_do_not_disturb_authentic_receipts() -> None:
    graph = _graph(1)
    other = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    (
        other_connection,
        other_stage,
        other_authority,
        other_migration,
        other_fence,
        other_reader,
        other_entries,
    ) = other
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        other_receipt = _publish_header(
            other_authority, other_migration, other_fence, other_reader, other_entries
        )
        forged = object.__new__(_SQLiteBaselineHeaderPublicationReceipt)
        for candidate in (object(), forged, other_receipt):
            with pytest.raises(ValueError, match=r"HEADER|RECEIPT|GRAPH|ARGUMENT"):
                _assert_header(
                    authority,
                    migration_receipt,
                    fence,
                    reader_lease,
                    entries,
                    cast(_SQLiteBaselineHeaderPublicationReceipt, candidate),
                )
        assert (
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
            is receipt
        )
        assert (
            _assert_header(
                other_authority,
                other_migration,
                other_fence,
                other_reader,
                other_entries,
                other_receipt,
            )
            is other_receipt
        )
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


def test_replay_poisons_before_prepare_and_preserves_one_header_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        before_changes = connection.total_changes
        before_epoch = connection.transaction_epoch
        monkeypatch.setattr(
            outer_module,
            "_BEGIN_BASELINE_HEADER_PUBLICATION",
            lambda *_args: pytest.fail("replay reached prepare"),
        )
        with pytest.raises(ValueError, match=r"HEADER|REPLAY|REUSED|PHASE"):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert connection.total_changes == before_changes
        assert connection.transaction_epoch == before_epoch
        assert len(_header_rows(connection)) == 1
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.baseline_header_publication_receipt is receipt
        assert state.baseline_header_publication_receipt_mint_count == 1
        assert state.lifecycle == "poisoned"
        assert state.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_prepare_failure_records_zero_physical_progress_and_mints_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
    changes_before = connection.total_changes
    epoch_before = connection.transaction_epoch
    primary = RuntimeError("injected baseline-header prepare failure")

    def fail_prepare(*_args: object) -> object:
        raise primary

    monkeypatch.setattr(outer_module, "_BEGIN_BASELINE_HEADER_PUBLICATION", fail_prepare)
    try:
        with pytest.raises(RuntimeError, match="prepare failure") as caught:
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert caught.value is primary
        assert connection.total_changes == changes_before
        assert connection.transaction_epoch == epoch_before
        assert _header_rows(connection) == []
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.baseline_header_prepare_count == 0
        assert state.baseline_header_execute_count == 0
        assert state.baseline_header_affected_rows == 0
        assert state.baseline_header_publication_receipt_mint_count == 0
        assert state.outer_ledger == before.outer_ledger
        assert state.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_execute_failure_before_native_return_records_prepare_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
    changes_before = connection.total_changes
    primary = RuntimeError("injected baseline-header execute failure")
    monkeypatch.setattr(
        outer_module,
        "_EXECUTE_BASELINE_HEADER",
        lambda *_args: (_ for _ in ()).throw(primary),
    )
    try:
        with pytest.raises(RuntimeError, match="execute failure") as caught:
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert caught.value is primary
        assert connection.total_changes == changes_before
        assert _header_rows(connection) == []
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.baseline_header_prepare_count == 1
        assert state.baseline_header_execute_count == 0
        assert state.baseline_header_affected_rows == 0
        assert state.baseline_header_publication_receipt_mint_count == 0
        assert state.outer_ledger == before.outer_ledger
        assert state.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("affected_rows_delta", 0),
        ("total_changes", -1),
        ("transaction_epoch", -1),
    ],
)
def test_post_native_step_fault_preserves_real_row_but_mints_zero(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    replacement: int,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    execute = outer_module._EXECUTE_BASELINE_HEADER
    before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
    changes_before = connection.total_changes

    def corrupt(*args: object) -> object:
        step = execute(*args)
        value = replacement
        if field in {"total_changes", "transaction_epoch"}:
            value = getattr(step, field) + replacement
        return step._replace(**{field: value})

    monkeypatch.setattr(outer_module, "_EXECUTE_BASELINE_HEADER", corrupt)
    try:
        with pytest.raises(ValueError, match=r"HEADER|EXECUTION|COUNTER|LEDGER"):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert len(_header_rows(connection)) == 1
        assert connection.total_changes == changes_before + 1
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.baseline_header_prepare_count == 1
        assert state.baseline_header_execute_count == 1
        assert state.baseline_header_affected_rows == 1
        assert state.baseline_header_publication_receipt_mint_count == 0
        assert state.outer_ledger == (
            before.outer_ledger.affected_rows_watermark + 1,
            before.outer_ledger.fixed_statement_count + 1,
            before.outer_ledger.logical_write_sequence,
        )
        assert state.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("seam", ["builder", "verifier"])
def test_independent_frame_builder_and_verifier_each_detect_substitution(
    monkeypatch: pytest.MonkeyPatch,
    seam: str,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    changes_before = connection.total_changes
    target = (
        "_BUILD_BASELINE_HEADER_FRAME" if seam == "builder" else "_VERIFY_BASELINE_HEADER_FRAME"
    )

    def hostile_frame(*_args: object) -> tuple[tuple[dict[str, object], ...], ...]:
        return (({"type": "text", "value": "hostile"},),)

    monkeypatch.setattr(outer_module, target, hostile_frame)
    try:
        with pytest.raises(ValueError, match=r"DIGEST|FRAME|HEADER"):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        # Both seams are compared after native completion; neither may mint.
        assert len(_header_rows(connection)) == 1
        assert connection.total_changes == changes_before + 1
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.baseline_header_publication_receipt is None
        assert state.baseline_header_publication_receipt_mint_count == 0
        assert state.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("digest_kind", ["parameters", "result"])
def test_independent_digest_verifier_fault_keeps_row_without_receipt(
    monkeypatch: pytest.MonkeyPatch,
    digest_kind: str,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    alias = (
        "_DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER"
        if digest_kind == "parameters"
        else "_DIGEST_INITIAL_WRITE_RESULT_VERIFIER"
    )
    verifier = getattr(outer_module, alias)
    calls = 0

    def fail_header_only(value: object) -> str:
        nonlocal calls
        calls += 1
        actual = verifier(value)
        return actual if calls == 1 else "0" * 64

    monkeypatch.setattr(outer_module, alias, fail_header_only)
    try:
        with pytest.raises(ValueError, match=r"DIGEST|HEADER"):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert calls == 2
        assert len(_header_rows(connection)) == 1
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.baseline_header_publication_receipt_mint_count == 0
        assert state.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_stale_transaction_lineage_retires_before_header_prepare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    connection.rollback()
    begin = connection.execute("BEGIN EXCLUSIVE")
    begin.close()
    monkeypatch.setattr(
        outer_module,
        "_BEGIN_BASELINE_HEADER_PUBLICATION",
        lambda *_args: pytest.fail("stale lineage reached prepare"),
    )
    try:
        with pytest.raises(ValueError, match=r"STALE|LINEAGE|RETIRED|FENCE"):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.lifecycle == "retired"
        assert state.write_phase == "retired"
        assert state.baseline_header_publication_receipt_mint_count == 0
    finally:
        _safe_cleanup(connection, stage)


def test_catalog_drift_poisons_before_header_prepare(monkeypatch: pytest.MonkeyPatch) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    cursor = connection.execute(
        "CREATE TABLE main.ge_hostile_header_catalog_drift (id INTEGER NOT NULL)"
    )
    cursor.close()
    monkeypatch.setattr(
        outer_module,
        "_BEGIN_BASELINE_HEADER_PUBLICATION",
        lambda *_args: pytest.fail("catalog drift reached prepare"),
    )
    try:
        with pytest.raises(ValueError, match=r"CATALOG|FENCE|DRIFT|RECEIPT|PREDECESSOR"):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert _header_rows(connection) == []
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.lifecycle == "poisoned"
        assert state.baseline_header_publication_receipt_mint_count == 0
    finally:
        _safe_cleanup(connection, stage)


def test_total_change_watermark_drift_poisons_before_header_prepare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    cursor = connection.execute(
        "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
    )
    cursor.close()
    monkeypatch.setattr(
        outer_module,
        "_BEGIN_BASELINE_HEADER_PUBLICATION",
        lambda *_args: pytest.fail("watermark drift reached prepare"),
    )
    try:
        with pytest.raises(ValueError, match=r"COUNTER|LEDGER|WATERMARK|DRIFT|RECEIPT|PREDECESSOR"):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert _header_rows(connection) == []
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _safe_cleanup(connection, stage)


def test_equal_projection_clone_substitution_invalidates_header_receipt() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        state = outer_module._authority_state(authority)
        original = state.projection_identity
        clone = replace(original)
        assert clone == original and clone is not original
        state.projection_identity = clone
        with pytest.raises(ValueError, match=r"PROJECTION|GRAPH|RECEIPT|DRIFT|PREDECESSOR"):
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _safe_cleanup(connection, stage)


def test_direct_header_receipt_scalar_tampering_is_detected_and_poisons() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        record = outer_module._baseline_header_receipt_record(receipt)
        object.__setattr__(record, "creation_runtime_version", "hostile-version")
        with pytest.raises(ValueError, match=r"HEADER|RECEIPT|DRIFT|RUNTIME"):
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _safe_cleanup(connection, stage)


def test_paired_late_public_sql_and_sha_mutation_cannot_rewrite_historical_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        hostile = "INSERT INTO hostile_header VALUES (?)"
        monkeypatch.setattr(
            outer_module,
            "SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC",
            hostile,
        )
        monkeypatch.setattr(
            outer_module,
            "SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC",
            hashlib.sha256(hostile.encode()).hexdigest(),
        )
        assert (
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
            is receipt
        )
        snapshot = _read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(receipt)
        assert snapshot.fixed_insert_sql == _INSERT_SQL
        assert snapshot.fixed_insert_sql_sha256 == _INSERT_SHA256
    finally:
        _safe_cleanup(connection, stage)


def test_direct_header_sql_commitment_tamper_is_rejected_even_with_matching_sha() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        record = outer_module._baseline_header_receipt_record(receipt)
        hostile = "INSERT INTO hostile_header VALUES (?)"
        object.__setattr__(record, "fixed_insert_sql", hostile)
        object.__setattr__(
            record,
            "fixed_insert_sql_sha256",
            hashlib.sha256(hostile.encode()).hexdigest(),
        )
        with pytest.raises(ValueError, match=r"SQL|HEADER|RECEIPT|DRIFT"):
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
    finally:
        _safe_cleanup(connection, stage)


def test_source_success_closes_native_cursor_once_and_terminal_replay_never_recloses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(0)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    del migration_receipt, fence, reader_lease, entries
    state = outer_module._authority_state(authority)
    projection = state.projection_identity
    native_close = source_module._BASELINE_HEADER_SQLITE_CURSOR_CLOSE
    close_calls = 0

    def counted_close(cursor: object) -> object:
        nonlocal close_calls
        close_calls += 1
        return native_close(cursor)

    monkeypatch.setattr(source_module, "_BASELINE_HEADER_SQLITE_CURSOR_CLOSE", counted_close)
    parameters = (
        projection.baseline_id,
        state.source_schema_identity_sha256,
        state.source_migration_lineage_id,
        state.source_migration_lineage_sha256,
        state.source_descriptor_hash,
        state.captured_at_ms,
        projection.legacy_operation_count,
        projection.entry_count,
        projection.first_entry_hash,
        projection.final_entry_hash,
        projection.projection_sha256,
        "graph-engineering-python",
        "0.1.0a1",
        encode_baseline_policy(),
    )
    try:
        execution = _begin_sqlite_connection_baseline_header_publication_execution_intrinsic(
            connection
        )
        _execute_sqlite_connection_baseline_header_publication_intrinsic(
            connection, execution, *parameters
        )
        assert close_calls == 1
        with pytest.raises(ValueError, match="TERMINAL"):
            _execute_sqlite_connection_baseline_header_publication_intrinsic(
                connection, execution, *parameters
            )
        assert close_calls == 1
        progress = _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.close_attempt_count == 1
        assert progress.close_succeeded is True
        source_state = source_module._baseline_header_publication_state(connection, execution)
        assert source_state.cursor is None
    finally:
        _safe_cleanup(connection, stage)


def test_source_cleanup_failure_after_native_success_preserves_progress_and_poisons(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(0)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    del migration_receipt, fence, reader_lease, entries
    state = outer_module._authority_state(authority)
    projection = state.projection_identity
    cleanup = RuntimeError("injected source cleanup failure")
    monkeypatch.setattr(
        source_module,
        "_BASELINE_HEADER_SQLITE_CURSOR_CLOSE",
        lambda _cursor: (_ for _ in ()).throw(cleanup),
    )
    try:
        execution = _begin_sqlite_connection_baseline_header_publication_execution_intrinsic(
            connection
        )
        with pytest.raises(ValueError, match=r"CLEANUP"):
            _execute_sqlite_connection_baseline_header_publication_intrinsic(
                connection,
                execution,
                projection.baseline_id,
                state.source_schema_identity_sha256,
                state.source_migration_lineage_id,
                state.source_migration_lineage_sha256,
                state.source_descriptor_hash,
                state.captured_at_ms,
                projection.legacy_operation_count,
                projection.entry_count,
                projection.first_entry_hash,
                projection.final_entry_hash,
                projection.projection_sha256,
                "graph-engineering-python",
                "0.1.0a1",
                encode_baseline_policy(),
            )
        progress = _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.lifecycle == "poisoned"
        assert progress.prepare_count == 1
        assert progress.execute_count == 1
        assert progress.completed_execution_count == 1
        assert progress.affected_rows == 1
        assert progress.total_changes_delta == 1
        assert progress.close_attempt_count == 1
        assert progress.close_succeeded is False
        assert (
            source_module._baseline_header_publication_state(connection, execution).cursor is None
        )
    finally:
        _safe_cleanup(connection, stage)


def test_source_primary_failure_outranks_cleanup_secondary_and_retains_no_exception_graph(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(0)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    del authority, migration_receipt, fence, reader_lease, entries
    primary = RuntimeError("injected native primary")
    secondary = RuntimeError("injected cleanup secondary")
    monkeypatch.setattr(
        source_module,
        "_BASELINE_HEADER_SQLITE_CURSOR_EXECUTE",
        lambda *_args: (_ for _ in ()).throw(primary),
    )
    monkeypatch.setattr(
        source_module,
        "_BASELINE_HEADER_SQLITE_CURSOR_CLOSE",
        lambda *_args: (_ for _ in ()).throw(secondary),
    )
    try:
        execution = _begin_sqlite_connection_baseline_header_publication_execution_intrinsic(
            connection
        )
        with pytest.raises(ValueError, match="BASELINE_HEADER_EXECUTE") as caught:
            _execute_sqlite_connection_baseline_header_publication_intrinsic(
                connection,
                execution,
                "v2-" + "1" * 64,
                "2" * 64,
                "lineage",
                "3" * 64,
                "4" * 64,
                1,
                0,
                0,
                "5" * 64,
                "6" * 64,
                "7" * 64,
                "graph-engineering-python",
                "0.1.0a1",
                encode_baseline_policy(),
            )
        assert caught.value.__cause__ is primary
        assert caught.value.__cause__ is not secondary
        progress = _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic(
            connection, execution
        )
        assert progress.lifecycle == "poisoned"
        assert progress.execute_count == 1
        assert progress.completed_execution_count == 0
        assert progress.affected_rows == 0
        assert progress.close_attempt_count == 1
        assert progress.close_succeeded is False
        source_state = source_module._baseline_header_publication_state(connection, execution)
        assert source_state.cursor is None
        assert not hasattr(source_state, "exception")
        assert not hasattr(source_state, "traceback")
    finally:
        _safe_cleanup(connection, stage)


def test_receipt_registry_record_has_only_weak_graph_edges_and_scalar_commitments() -> None:
    fields = set(outer_module._BaselineHeaderPublicationReceiptRecord.__dataclass_fields__)
    assert {
        "connection",
        "authority",
        "migration_0002_receipt",
        "fence",
        "reader_lease",
        "entries_receipt",
        "projection_identity",
        "projection_reference",
        "source_envelope",
        "policy_blob",
        "frame",
        "snapshot",
        "cursor",
        "execution",
        "exception",
        "traceback",
        "error",
    }.isdisjoint(fields)
    assert {
        "connection_id",
        "projection_identity_id",
        "authority_ref",
        "migration_0002_receipt_ref",
        "fence_ref",
        "reader_lease_ref",
        "baseline_entries_receipt_ref",
        "projection_reference_ref",
    } <= fields


def test_successful_header_receipt_registry_does_not_keep_upstream_graph_alive() -> None:
    gc.collect()
    gc.collect()
    baselines = (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
        len(outer_module._POST_DDL_PUBLICATION_READER_LEASES),
        len(outer_module._BASELINE_ENTRIES_PUBLICATION_RECEIPTS),
        len(outer_module._BASELINE_HEADER_PUBLICATION_RECEIPTS),
    )

    def abandon() -> tuple[object, ...]:
        graph = _graph(1)
        connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        references = (
            ref(authority),
            ref(migration_receipt),
            ref(fence),
            ref(reader_lease),
            ref(entries),
            ref(stage),
        )
        _safe_cleanup(connection, stage)
        return (receipt, *references)

    receipt, authority_ref, migration_ref, fence_ref, reader_ref, entries_ref, stage_ref = abandon()
    gc.collect()
    gc.collect()
    assert authority_ref() is None  # type: ignore[operator]
    assert migration_ref() is None  # type: ignore[operator]
    assert fence_ref() is None  # type: ignore[operator]
    assert reader_ref() is None  # type: ignore[operator]
    assert entries_ref() is None  # type: ignore[operator]
    assert stage_ref() is None  # type: ignore[operator]
    assert (
        len(outer_module._AUTHORITIES),
        len(outer_module._MIGRATION_0002_RECEIPTS),
        len(outer_module._POST_DDL_CATALOG_FENCES),
        len(outer_module._POST_DDL_PUBLICATION_READER_LEASES),
        len(outer_module._BASELINE_ENTRIES_PUBLICATION_RECEIPTS),
    ) == baselines[:5]
    assert len(outer_module._BASELINE_HEADER_PUBLICATION_RECEIPTS) == baselines[5] + 1
    with pytest.raises(ValueError, match=r"HEADER|RECEIPT|GRAPH"):
        _read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(
            cast(_SQLiteBaselineHeaderPublicationReceipt, receipt)
        )
    receipt_ref = ref(receipt)
    del receipt
    gc.collect()
    gc.collect()
    assert receipt_ref() is None
    assert len(outer_module._BASELINE_HEADER_PUBLICATION_RECEIPTS) == baselines[5]


def test_source_execution_registry_releases_handle_and_retains_no_connection_after_gc() -> None:
    graph = _graph(0)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    del authority, migration_receipt, fence, reader_lease, entries
    baseline = len(source_module._BASELINE_HEADER_PUBLICATION_EXECUTIONS)
    execution = _begin_sqlite_connection_baseline_header_publication_execution_intrinsic(connection)
    assert len(source_module._BASELINE_HEADER_PUBLICATION_EXECUTIONS) == baseline + 1
    execution_ref = ref(execution)
    del execution
    gc.collect()
    gc.collect()
    assert execution_ref() is None
    assert len(source_module._BASELINE_HEADER_PUBLICATION_EXECUTIONS) == baseline
    _safe_cleanup(connection, stage)


def test_header_receipt_assertion_allows_monotonic_later_phase_advancement() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
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
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
            is receipt
        )
        assert (
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
            is receipt
        )
    finally:
        _safe_cleanup(connection, stage)


def test_header_leaf_writes_no_sequence_adoption_manifest_or_transaction_control() -> None:
    source = Path(cast(str, outer_module.__file__)).read_text(encoding="utf-8")
    start = source.index("def _execute_sqlite_cursor_baseline_header_publication_intrinsic")
    end = source.find("def _execute_sqlite_cursor_operation_sequence_zero", start)
    leaf = source[start : end if end >= 0 else len(source)]
    for forbidden in (
        ".commit(",
        ".rollback(",
        ".begin_exclusive(",
        "executescript(",
        "INSERT INTO main.ge_cycle_operation_sequence",
        "initial_stage_adoption",
        "manifest_activation",
    ):
        assert forbidden not in leaf


def test_package_root_keeps_all_header_capabilities_private() -> None:
    for name in (
        "SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC",
        "SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC",
        "SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC",
        "SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC",
        "SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC",
        "SQLiteBaselineHeaderPublicationReceipt",
        "execute_sqlite_cursor_baseline_header_publication",
        "assert_sqlite_cursor_baseline_header_publication_receipt",
        "read_sqlite_baseline_header_publication_receipt_snapshot",
        "_SQLiteBaselineHeaderPublicationReceipt",
        "_SQLiteBaselineHeaderPublicationReceiptSnapshot",
        "_execute_sqlite_cursor_baseline_header_publication_intrinsic",
        "_assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic",
        "_read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic",
        "_SQLiteConnectionBaselineHeaderPublicationExecution",
        "_SQLiteConnectionBaselineHeaderPublicationExecutionSnapshot",
        "_SQLiteConnectionBaselineHeaderPublicationStepSnapshot",
        "_begin_sqlite_connection_baseline_header_publication_execution_intrinsic",
        "_execute_sqlite_connection_baseline_header_publication_intrinsic",
        "_read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic",
    ):
        assert not hasattr(graph_engineering, name)


def test_header_receipt_contains_no_sequence_adoption_or_publication_session_authority() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        snapshot = _read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(receipt)
        assert not hasattr(snapshot, "operation_sequence_zero_publication_receipt")
        assert not hasattr(snapshot, "initial_stage_adoption_receipt")
        assert not hasattr(snapshot, "publication_session_authority")
        cursor = connection.execute("SELECT COUNT(*) FROM main.ge_cycle_operation_sequence")
        try:
            assert cursor.fetchone() == (0,)
        finally:
            cursor.close()
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("wrong_predecessor", ["migration", "fence", "reader"])
def test_cross_graph_predecessor_arguments_reject_before_header_prepare_without_poisoning(
    monkeypatch: pytest.MonkeyPatch,
    wrong_predecessor: str,
) -> None:
    graph = _graph(1)
    other = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    other_connection, other_stage, _, other_migration, other_fence, other_reader, _ = other
    arguments: list[object] = [migration_receipt, fence, reader_lease]
    arguments[{"migration": 0, "fence": 1, "reader": 2}[wrong_predecessor]] = {
        "migration": other_migration,
        "fence": other_fence,
        "reader": other_reader,
    }[wrong_predecessor]
    monkeypatch.setattr(
        outer_module,
        "_BEGIN_BASELINE_HEADER_PUBLICATION",
        lambda *_args: pytest.fail("foreign predecessor reached prepare"),
    )
    try:
        with pytest.raises(ValueError, match=r"HEADER|GRAPH|RECEIPT|PREDECESSOR"):
            _execute_sqlite_cursor_baseline_header_publication_intrinsic(
                authority,
                cast(_SQLiteMigration0002CatalogRebuildReceipt, arguments[0]),
                cast(_SQLiteCursorPostDdlCatalogFence, arguments[1]),
                cast(_SQLiteCursorPostDdlPublicationReaderLease, arguments[2]),
                entries,
            )
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.lifecycle == "active"
        assert state.write_phase == "baseline-entries-complete"
        assert state.baseline_header_prepare_count == 0
        assert state.baseline_header_publication_receipt_mint_count == 0
        assert _header_rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


def test_outer_cleanup_failure_after_native_header_write_keeps_physical_progress_without_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    before = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
    changes_before = connection.total_changes
    cleanup = RuntimeError("injected outer-observed header cleanup failure")
    monkeypatch.setattr(
        source_module,
        "_BASELINE_HEADER_SQLITE_CURSOR_CLOSE",
        lambda _cursor: (_ for _ in ()).throw(cleanup),
    )
    try:
        with pytest.raises(ValueError, match=r"CLEANUP"):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert len(_header_rows(connection)) == 1
        assert connection.total_changes == changes_before + 1
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.baseline_header_prepare_count == 1
        assert state.baseline_header_execute_count == 1
        assert state.baseline_header_affected_rows == 1
        assert state.baseline_header_publication_receipt is None
        assert state.baseline_header_publication_receipt_mint_count == 0
        assert state.outer_ledger == (
            before.outer_ledger.affected_rows_watermark + 1,
            before.outer_ledger.fixed_statement_count + 1,
            before.outer_ledger.logical_write_sequence,
        )
        assert state.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_post_return_primary_outranks_progress_read_secondary_and_source_retains_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    execute = outer_module._EXECUTE_BASELINE_HEADER
    primary = RuntimeError("injected header post-return primary")
    secondary = RuntimeError("injected header progress-read secondary")
    captured: _SQLiteConnectionBaselineHeaderPublicationExecution | None = None

    def run_then_fail(*args: object) -> object:
        nonlocal captured
        captured = cast(_SQLiteConnectionBaselineHeaderPublicationExecution, args[1])
        execute(*args)
        raise primary

    monkeypatch.setattr(outer_module, "_EXECUTE_BASELINE_HEADER", run_then_fail)
    monkeypatch.setattr(
        outer_module,
        "_READ_BASELINE_HEADER_PUBLICATION_PROGRESS",
        lambda *_args: (_ for _ in ()).throw(secondary),
    )
    try:
        with pytest.raises(RuntimeError, match="post-return primary") as caught:
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert caught.value is primary
        assert captured is not None
        progress = _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic(
            connection, captured
        )
        assert progress.lifecycle == "completed"
        assert progress.prepare_count == 1
        assert progress.execute_count == 1
        assert progress.completed_execution_count == 1
        assert progress.affected_rows == 1
        assert progress.total_changes_delta == 1
        assert progress.close_attempt_count == 1
        assert progress.close_succeeded is True
        assert len(_header_rows(connection)) == 1
        state = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert state.baseline_header_publication_receipt is None
        assert state.baseline_header_publication_receipt_mint_count == 0
        assert state.lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_header_receipt_assertion_rejects_outer_ledger_regression() -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    try:
        receipt = _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        state = outer_module._authority_state(authority)
        state.fixed_statement_count -= 1
        with pytest.raises(ValueError, match=r"LEDGER|WATERMARK|HEADER|RECEIPT|DRIFT"):
            _assert_header(authority, migration_receipt, fence, reader_lease, entries, receipt)
        assert (
            _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority).lifecycle
            == "poisoned"
        )
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    "field",
    [
        "captured_at_ms",
        "source_migration_lineage_id",
        "source_migration_lineage_sha256",
        "source_descriptor_hash",
        "source_schema_identity_sha256",
    ],
)
def test_source_header_scalar_drift_after_entries_receipt_poisons_before_prepare(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
) -> None:
    graph = _graph(1)
    connection, stage, authority, migration_receipt, fence, reader_lease, entries = graph
    state = outer_module._authority_state(authority)
    original = getattr(state, field)
    replacement: object
    if field == "captured_at_ms":
        replacement = cast(int, original) + 1
    elif field == "source_migration_lineage_id":
        replacement = f"{original}-hostile"
    else:
        replacement = "0" * 64 if original != "0" * 64 else "1" * 64
    setattr(state, field, replacement)
    monkeypatch.setattr(
        outer_module,
        "_BEGIN_BASELINE_HEADER_PUBLICATION",
        lambda *_args: pytest.fail(f"{field} drift reached header prepare"),
    )
    try:
        with pytest.raises(
            ValueError,
            match=r"HEADER|PREDECESSOR|SOURCE|PROVENANCE|RECEIPT|DRIFT",
        ):
            _publish_header(authority, migration_receipt, fence, reader_lease, entries)
        assert _header_rows(connection) == []
        snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(authority)
        assert snapshot.baseline_header_logical_execution_count == 0
        assert snapshot.baseline_header_prepare_count == 0
        assert snapshot.baseline_header_execute_count == 0
        assert snapshot.baseline_header_affected_rows == 0
        assert snapshot.baseline_header_publication_receipt is None
        assert snapshot.baseline_header_publication_receipt_mint_count == 0
        assert snapshot.lifecycle == "poisoned"
        assert snapshot.write_phase == "poisoned"
    finally:
        _safe_cleanup(connection, stage)
