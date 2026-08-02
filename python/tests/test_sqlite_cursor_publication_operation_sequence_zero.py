from __future__ import annotations

import gc
import hashlib
import os
import time
from dataclasses import replace
from inspect import signature
from pathlib import Path
from typing import cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_clock_authority as clock_module
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_operation_baseline_source as source_module
from graph_engineering.sqlite_cursor_publication_initial_write_digest import (
    _digest_sqlite_initial_write_parameters_intrinsic,
    _digest_sqlite_initial_write_result_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_outer_authority import (
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC,
    _assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic,
    _execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic,
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic,
    _SQLiteBaselineEntriesPublicationReceipt,
    _SQLiteBaselineHeaderPublicationReceipt,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteOperationSequenceZeroPublicationReceipt,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_connection_operation_sequence_zero_session import (
    _INSERT_SHA256,
    _INSERT_SQL,
    _rows,
    _source_graph,
)
from tests.test_sqlite_cursor_publication_baseline_header import _safe_cleanup
from tests.test_sqlite_cursor_publication_migration_0002_execution import _raw

_PARAMETER_ORDER = ("baselineId", "baselineCapturedAtMs", "updatedAtMs")
_RECEIPT_FIELDS = (
    "affected_rows",
    "authority",
    "baseline_captured_at_ms",
    "baseline_entries_publication_receipt",
    "baseline_header_publication_receipt",
    "baseline_id",
    "connection",
    "execute_count",
    "fixed_insert_sql",
    "fixed_insert_sql_sha256",
    "last_commit_sequence",
    "migration_0002_receipt",
    "mint_count",
    "outer_clock_evidence",
    "outer_ledger_after",
    "outer_ledger_before",
    "outer_ledger_delta",
    "outer_provider_now_ms",
    "parameter_order",
    "parameter_sha256",
    "post_ddl_catalog_fence",
    "prepare_count",
    "projection_identity",
    "projection_reference",
    "reader_lease",
    "result_sha256",
    "total_changes_after",
    "total_changes_before",
    "total_changes_delta",
    "transaction_epoch_after",
    "transaction_epoch_before",
    "transaction_generation",
    "updated_at_ms",
    "write_kind",
)

SequenceGraph = tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _SQLiteBaselineEntriesPublicationReceipt,
    _SQLiteBaselineHeaderPublicationReceipt,
]


def _sequence_graph(legacy_count: int = 1) -> SequenceGraph:
    return _source_graph(legacy_count)


def _publish(graph: SequenceGraph) -> _SQLiteOperationSequenceZeroPublicationReceipt:
    _, _, authority, migration, fence, reader, entries, header = graph
    return _execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic(
        authority, migration, fence, reader, entries, header
    )


def _assert_receipt(
    graph: SequenceGraph,
    receipt: _SQLiteOperationSequenceZeroPublicationReceipt,
) -> _SQLiteOperationSequenceZeroPublicationReceipt:
    _, _, authority, migration, fence, reader, entries, header = graph
    return _assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic(
        authority, migration, fence, reader, entries, header, receipt
    )


def _frame(graph: SequenceGraph) -> list[list[dict[str, str]]]:
    authority = graph[2]
    state = outer_module._authority_state(authority)
    return [
        [
            {"type": "text", "value": state.projection_identity.baseline_id},
            {"type": "integer", "value": str(state.source_header_commitment.captured_at_ms)},
            {"type": "integer", "value": str(state.outer_provider_now_ms)},
        ]
    ]


def _authority(graph: SequenceGraph) -> object:
    return _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(graph[2])


def test_exact_154_byte_insert_sha_and_three_parameter_order_match_source() -> None:
    assert len(_INSERT_SQL.encode()) == 154
    assert SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC == _INSERT_SQL
    assert source_module.SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC == _INSERT_SQL
    assert SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC == _INSERT_SHA256
    assert source_module.SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC == (
        _INSERT_SHA256
    )
    assert hashlib.sha256(_INSERT_SQL.encode()).hexdigest() == _INSERT_SHA256
    assert SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC == _PARAMETER_ORDER
    assert source_module.SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC == (
        _PARAMETER_ORDER
    )


def test_closed_outer_api_accepts_only_six_authentic_predecessors() -> None:
    execute = tuple(
        signature(_execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic).parameters
    )
    assert execute == (
        "authority",
        "migration_0002_receipt",
        "fence",
        "reader_lease",
        "baseline_entries_publication_receipt",
        "baseline_header_publication_receipt",
    )
    assert tuple(
        signature(
            _assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic
        ).parameters
    ) == (*execute, "receipt")
    assert {
        "sql",
        "parameters",
        "baseline_id",
        "captured_at_ms",
        "updated_at_ms",
        "clock",
        "cursor",
        "cleanup",
    }.isdisjoint(execute)


def test_publishes_exact_34_field_receipt_row_phase_and_three_real_ledgers() -> None:
    graph = _sequence_graph(1)
    connection, stage, authority, migration, fence, reader, entries, header = graph
    before = _authority(graph)
    state = outer_module._authority_state(authority)
    changes_before = connection.total_changes
    epoch_before = connection.transaction_epoch
    generation = connection._transaction_generation
    try:
        assert before.outer_ledger == (15, 33, 3)
        assert before.write_phase == "baseline-header-complete"
        receipt = _publish(graph)
        snapshot = _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
            receipt
        )
        assert snapshot._fields == _RECEIPT_FIELDS
        assert snapshot.affected_rows == 1
        assert snapshot.authority is authority
        assert snapshot.baseline_captured_at_ms == state.source_header_commitment.captured_at_ms
        assert snapshot.baseline_entries_publication_receipt is entries
        assert snapshot.baseline_header_publication_receipt is header
        assert snapshot.baseline_id == state.projection_identity.baseline_id
        assert snapshot.connection is connection
        assert snapshot.execute_count == 1
        assert snapshot.fixed_insert_sql == _INSERT_SQL
        assert snapshot.fixed_insert_sql_sha256 == _INSERT_SHA256
        assert snapshot.last_commit_sequence == 0
        assert snapshot.migration_0002_receipt is migration
        assert snapshot.mint_count == 1
        assert snapshot.outer_clock_evidence is state.outer_clock_evidence
        assert snapshot.outer_ledger_before == (15, 33, 3)
        assert snapshot.outer_ledger_after == (16, 34, 4)
        assert snapshot.outer_ledger_delta == (1, 1, 1)
        assert snapshot.outer_provider_now_ms == state.outer_provider_now_ms
        assert snapshot.parameter_order == _PARAMETER_ORDER
        assert snapshot.post_ddl_catalog_fence is fence
        assert snapshot.prepare_count == 1
        assert snapshot.projection_identity is state.projection_identity
        assert snapshot.projection_reference is state.projection_reference
        assert snapshot.reader_lease is reader
        assert snapshot.total_changes_before == changes_before
        assert snapshot.total_changes_after == changes_before + 1
        assert snapshot.total_changes_delta == 1
        assert snapshot.transaction_epoch_before == epoch_before
        assert snapshot.transaction_epoch_after == epoch_before + 1
        assert snapshot.transaction_generation is generation
        assert snapshot.updated_at_ms == state.outer_provider_now_ms
        assert snapshot.write_kind == "operation-sequence-zero-publication"
        assert _assert_receipt(graph, receipt) is receipt
        after = _authority(graph)
        assert after.lifecycle == "active"
        assert after.write_phase == "sequence-zero-complete"
        assert after.outer_ledger == (16, 34, 4)
        assert after.operation_sequence_zero_publication_receipt is receipt
        assert after.operation_sequence_zero_publication_receipt_mint_count == 1
        assert after.operation_sequence_zero_logical_execution_count == 1
        assert after.operation_sequence_zero_prepare_count == 1
        assert after.operation_sequence_zero_execute_count == 1
        assert after.operation_sequence_zero_affected_rows == 1
        assert _rows(connection) == [
            (
                1,
                state.projection_identity.baseline_id,
                0,
                state.source_header_commitment.captured_at_ms,
                state.outer_provider_now_ms,
            )
        ]
    finally:
        _safe_cleanup(connection, stage)


def test_builds_exact_one_by_three_typed_frame_and_aggregate_digests() -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    expected = _frame(graph)
    try:
        receipt = _publish(graph)
        snapshot = _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
            receipt
        )
        assert expected[0][0]["type"] == "text"
        assert [scalar["type"] for scalar in expected[0]] == ["text", "integer", "integer"]
        assert snapshot.parameter_sha256 == _digest_sqlite_initial_write_parameters_intrinsic(
            expected
        )
        assert snapshot.result_sha256 == _digest_sqlite_initial_write_result_intrinsic(
            {"affectedRows": "1"}
        )
        assert _assert_receipt(graph, receipt) is receipt
    finally:
        _safe_cleanup(connection, stage)


def test_updated_time_is_fresh_provider_evidence_not_wall_clock_or_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, authority, *_ = graph
    state = outer_module._authority_state(authority)
    original = os.environ.get("GRAPH_ENGINEERING_UPDATED_AT_MS")
    monkeypatch.setenv("GRAPH_ENGINEERING_UPDATED_AT_MS", "1")

    def fail_wall_clock() -> float:
        raise AssertionError("wall clock must not be called")

    monkeypatch.setattr(time, "time", fail_wall_clock)
    try:
        receipt = _publish(graph)
        snapshot = _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
            receipt
        )
        clock = clock_module._read_clock_evidence_snapshot_intrinsic(
            state.provider_clock_capability, state.outer_clock_evidence
        )
        assert snapshot.outer_clock_evidence is state.outer_clock_evidence
        assert snapshot.outer_provider_now_ms == clock.provider_now_ms
        assert snapshot.updated_at_ms == clock.provider_now_ms
        assert snapshot.updated_at_ms != 1
        assert _rows(connection)[0][4] == clock.provider_now_ms
    finally:
        if original is None:
            os.environ.pop("GRAPH_ENGINEERING_UPDATED_AT_MS", None)
        else:
            os.environ["GRAPH_ENGINEERING_UPDATED_AT_MS"] = original
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("offset,accepted", [(0, True), (-1, False)])
def test_provider_timestamp_monotonicity_has_distinct_equality_boundary(
    offset: int,
    accepted: bool,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, authority, *_ = graph
    state = outer_module._authority_state(authority)
    captured = state.source_header_commitment.captured_at_ms
    evidence_state = clock_module._EVIDENCE[state.outer_clock_evidence]
    evidence_state.snapshot = replace(evidence_state.snapshot, provider_now_ms=captured + offset)
    state.outer_provider_now_ms = captured + offset
    begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO
    begins = 0

    def counted_begin(*args: object) -> object:
        nonlocal begins
        begins += 1
        return begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", counted_begin)
    try:
        if accepted:
            receipt = _publish(graph)
            snapshot = _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
                receipt
            )
            assert snapshot.updated_at_ms == captured
            assert begins == 1
            assert _assert_receipt(graph, receipt) is receipt
        else:
            with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_TIMESTAMP$"):
                _publish(graph)
            assert begins == 0
            assert _rows(connection) == []
            after = _authority(graph)
            assert after.lifecycle == "poisoned"
            assert after.operation_sequence_zero_publication_receipt is None
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    "wrong_predecessor",
    ["migration", "fence", "reader", "entries", "header"],
)
def test_wrong_cross_graph_predecessor_rejects_before_prepare_without_poisoning(
    wrong_predecessor: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    other = _sequence_graph(1)
    connection, stage, authority, migration, fence, reader, entries, header = graph
    (
        other_connection,
        other_stage,
        _,
        other_migration,
        other_fence,
        other_reader,
        other_entries,
        other_header,
    ) = other
    arguments: list[object] = [authority, migration, fence, reader, entries, header]
    replacements = {
        "migration": other_migration,
        "fence": other_fence,
        "reader": other_reader,
        "entries": other_entries,
        "header": other_header,
    }
    arguments[
        ("migration", "fence", "reader", "entries", "header").index(wrong_predecessor) + 1
    ] = replacements[wrong_predecessor]
    begins = 0
    original_begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO

    def counted_begin(*args: object) -> object:
        nonlocal begins
        begins += 1
        return original_begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", counted_begin)
    try:
        with pytest.raises(ValueError, match=r"SEQUENCE_ZERO_(RECEIPT|RECEIPT_GRAPH)"):
            _execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic(
                *cast(tuple[object, object, object, object, object, object], tuple(arguments))
            )
        assert begins == 0
        assert _rows(connection) == []
        assert _authority(graph).lifecycle == "active"
        assert _authority(graph).write_phase == "baseline-header-complete"
        assert _publish(graph) is not None
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


def test_forged_cloned_and_cross_run_sequence_receipts_do_not_replace_authentic_proof() -> None:
    graph = _sequence_graph(1)
    other = _sequence_graph(1)
    connection, stage, *_ = graph
    other_connection, other_stage, *_ = other
    try:
        receipt = _publish(graph)
        other_receipt = _publish(other)
        clone = tuple(
            _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(receipt)
        )
        for hostile in (object(), clone, other_receipt):
            with pytest.raises(ValueError, match=r"SEQUENCE_ZERO_(RECEIPT|RECEIPT_GRAPH)"):
                _assert_receipt(
                    graph, cast(_SQLiteOperationSequenceZeroPublicationReceipt, hostile)
                )
        assert _assert_receipt(graph, receipt) is receipt
        assert _assert_receipt(other, other_receipt) is other_receipt
    finally:
        _safe_cleanup(connection, stage)
        _safe_cleanup(other_connection, other_stage)


def test_replay_poisons_before_second_prepare_and_preserves_single_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    receipt = _publish(graph)
    begins = 0
    original_begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO

    def counted_begin(*args: object) -> object:
        nonlocal begins
        begins += 1
        return original_begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", counted_begin)
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_REPLAY$"):
            _publish(graph)
        assert begins == 0
        assert len(_rows(connection)) == 1
        after = _authority(graph)
        assert after.lifecycle == "poisoned"
        assert after.write_phase == "poisoned"
        assert after.operation_sequence_zero_publication_receipt is receipt
        assert after.operation_sequence_zero_publication_receipt_mint_count == 1
    finally:
        _safe_cleanup(connection, stage)


def test_prepare_failure_records_zero_physical_progress_and_mints_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    changes = connection.total_changes

    def fail_begin(*_: object) -> object:
        raise ValueError("forced-sequence-prepare")

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", fail_begin)
    try:
        with pytest.raises(ValueError, match="forced-sequence-prepare"):
            _publish(graph)
        after = _authority(graph)
        assert after.lifecycle == "poisoned"
        assert after.operation_sequence_zero_logical_execution_count == 1
        assert after.operation_sequence_zero_prepare_count == 0
        assert after.operation_sequence_zero_execute_count == 0
        assert after.operation_sequence_zero_affected_rows == 0
        assert after.operation_sequence_zero_publication_receipt is None
        assert after.operation_sequence_zero_publication_receipt_mint_count == 0
        assert after.outer_ledger == (15, 33, 3)
        assert connection.total_changes == changes
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_execute_primary_before_native_return_records_prepare_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph

    def fail_execute(*_: object) -> object:
        raise ValueError("forced-sequence-execute")

    monkeypatch.setattr(outer_module, "_EXECUTE_OPERATION_SEQUENCE_ZERO", fail_execute)
    try:
        with pytest.raises(ValueError, match="forced-sequence-execute"):
            _publish(graph)
        after = _authority(graph)
        assert after.operation_sequence_zero_prepare_count == 1
        assert after.operation_sequence_zero_execute_count == 0
        assert after.operation_sequence_zero_affected_rows == 0
        assert after.operation_sequence_zero_publication_receipt is None
        assert after.outer_ledger == (15, 33, 3)
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    "field,value",
    [
        ("affected_rows_delta", 0),
        ("completed_execution_count", 0),
        ("execute_count", 0),
        ("prepare_count", 0),
        ("total_changes", -1),
        ("transaction_epoch", -1),
        ("transaction_generation", object()),
    ],
)
def test_spoofed_post_native_step_preserves_real_row_but_mints_zero(
    monkeypatch: pytest.MonkeyPatch,
    field: str,
    value: object,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    original = outer_module._EXECUTE_OPERATION_SEQUENCE_ZERO

    def spoof(*args: object) -> object:
        step = original(*args)
        return step._replace(**{field: value})

    monkeypatch.setattr(outer_module, "_EXECUTE_OPERATION_SEQUENCE_ZERO", spoof)
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION$"):
            _publish(graph)
        assert len(_rows(connection)) == 1
        after = _authority(graph)
        assert after.lifecycle == "poisoned"
        assert after.operation_sequence_zero_publication_receipt is None
        assert after.operation_sequence_zero_publication_receipt_mint_count == 0
        assert after.operation_sequence_zero_prepare_count in (0, 1)
        assert after.outer_ledger.logical_write_sequence == 3
        assert after.outer_ledger.fixed_statement_count == 34
        assert after.outer_ledger.affected_rows_watermark == 16
    finally:
        _safe_cleanup(connection, stage)


def test_post_native_progress_read_failure_keeps_row_without_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph

    def fail_progress(*_: object) -> object:
        raise ValueError("forced-sequence-progress")

    monkeypatch.setattr(outer_module, "_READ_OPERATION_SEQUENCE_ZERO_PROGRESS", fail_progress)
    try:
        with pytest.raises(ValueError, match="forced-sequence-progress"):
            _publish(graph)
        assert len(_rows(connection)) == 1
        after = _authority(graph)
        assert after.lifecycle == "poisoned"
        assert after.operation_sequence_zero_prepare_count == 1
        assert after.operation_sequence_zero_execute_count == 1
        assert after.operation_sequence_zero_affected_rows == 1
        assert after.operation_sequence_zero_publication_receipt is None
        assert after.outer_ledger == (16, 34, 3)
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("seam", ["builder", "verifier"])
def test_independent_frame_builder_and_verifier_reject_single_seam_substitution(
    monkeypatch: pytest.MonkeyPatch,
    seam: str,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    target = (
        "_BUILD_OPERATION_SEQUENCE_ZERO_FRAME"
        if seam == "builder"
        else "_VERIFY_OPERATION_SEQUENCE_ZERO_FRAME"
    )
    original = getattr(outer_module, target)

    def substitute(*args: object) -> object:
        frame = original(*args)
        return [[*frame[0][:-1], {"type": "integer", "value": "0"}]]

    monkeypatch.setattr(outer_module, target, substitute)
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_DIGEST$"):
            _publish(graph)
        assert len(_rows(connection)) == 1
        assert _authority(graph).operation_sequence_zero_publication_receipt is None
        assert _authority(graph).outer_ledger == (16, 34, 3)
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("kind", ["parameters", "result"])
def test_independent_digest_verifier_fault_retains_physical_row_without_receipt(
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    target = (
        "_DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER"
        if kind == "parameters"
        else "_DIGEST_INITIAL_WRITE_RESULT_VERIFIER"
    )
    original = getattr(outer_module, target)
    calls = 0
    drifted = 0

    def drift(*args: object) -> str:
        nonlocal calls, drifted
        calls += 1
        digest = original(*args)
        if outer_module._authority_state(graph[2]).write_phase != "executing-sequence-zero":
            # This alias also re-proves upstream receipts. Isolate the hostile
            # substitution to the sequence leaf's post-native verifier pass.
            return digest
        drifted += 1
        return f"{digest[:-1]}{'0' if digest[-1] != '0' else '1'}"

    monkeypatch.setattr(outer_module, target, drift)
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_DIGEST$"):
            _publish(graph)
        assert len(_rows(connection)) == 1
        assert _authority(graph).operation_sequence_zero_publication_receipt is None
        assert _authority(graph).outer_ledger == (16, 34, 3)
        assert calls >= 2
        assert drifted == 1
    finally:
        _safe_cleanup(connection, stage)


def test_outer_sql_identity_drift_poisons_before_source_prepare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    begins = 0
    original_begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO

    def counted_begin(*args: object) -> object:
        nonlocal begins
        begins += 1
        return original_begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", counted_begin)
    monkeypatch.setattr(
        outer_module,
        "_OPERATION_SEQUENCE_ZERO_INSERT_SQL",
        f"{_INSERT_SQL} -- drift",
    )
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_SQL$"):
            _publish(graph)
        assert begins == 0
        assert _rows(connection) == []
        assert _authority(graph).lifecycle == "poisoned"
        assert _authority(graph).operation_sequence_zero_publication_receipt is None
    finally:
        _safe_cleanup(connection, stage)


def test_paired_private_outer_sql_and_matching_sha_rebind_rejects_before_prepare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    hostile = _INSERT_SQL.replace("operation_sequence", "operation_sequencx")
    assert len(hostile.encode()) == 154 and hostile != _INSERT_SQL
    begins = 0
    original_begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO

    def counted_begin(*args: object) -> object:
        nonlocal begins
        begins += 1
        return original_begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", counted_begin)
    monkeypatch.setattr(outer_module, "_OPERATION_SEQUENCE_ZERO_INSERT_SQL", hostile)
    monkeypatch.setattr(
        outer_module,
        "_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256",
        hashlib.sha256(hostile.encode()).hexdigest(),
    )
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_SQL$"):
            _publish(graph)
        assert begins == 0
        assert _rows(connection) == []
        after = _authority(graph)
        assert after.lifecycle == "poisoned"
        assert (
            after.stage_ownership_poison_reason
            == "SQLite operation-sequence-zero SQL identity drifted"
        )
        assert after.operation_sequence_zero_prepare_count == 0
        assert after.operation_sequence_zero_publication_receipt is None
        assert after.operation_sequence_zero_publication_receipt_mint_count == 0
    finally:
        _safe_cleanup(connection, stage)


def test_paired_sql_sha_and_captured_getter_rebind_still_rejects_before_prepare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    hostile = _INSERT_SQL.replace("operation_sequence", "operation_sequencx")
    hostile_sha = hashlib.sha256(hostile.encode()).hexdigest()
    begins = 0
    original_begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO

    def counted_begin(*args: object) -> object:
        nonlocal begins
        begins += 1
        return original_begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", counted_begin)
    monkeypatch.setattr(outer_module, "_OPERATION_SEQUENCE_ZERO_INSERT_SQL", hostile)
    monkeypatch.setattr(outer_module, "_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256", hostile_sha)
    monkeypatch.setattr(
        outer_module,
        "_READ_CAPTURED_OPERATION_SEQUENCE_ZERO_SQL_COMMITMENT",
        lambda: (hostile, hostile_sha, _PARAMETER_ORDER),
    )
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_SQL$"):
            _publish(graph)
        assert begins == 0
        assert _rows(connection) == []
        after = _authority(graph)
        assert after.lifecycle == "poisoned"
        assert (
            after.stage_ownership_poison_reason
            == "SQLite operation-sequence-zero SQL identity drifted"
        )
        assert after.operation_sequence_zero_prepare_count == 0
        assert after.operation_sequence_zero_publication_receipt is None
        assert after.operation_sequence_zero_publication_receipt_mint_count == 0
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize("mutation_point", ["before-publish", "during-begin"])
def test_source_private_sql_alias_rebinding_cannot_mint_false_outer_receipt(
    monkeypatch: pytest.MonkeyPatch,
    mutation_point: str,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    hostile = (
        "UPDATE main.ge_cycle_schema SET current_version = 999 "
        "WHERE singleton = 1 RETURNING ?, ?, ?"
    )
    original_begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO
    try:
        cursor = connection.execute(
            "SELECT current_version FROM main.ge_cycle_schema WHERE singleton = 1"
        )
        try:
            version = cursor.fetchone()
            assert version is not None and cursor.fetchone() is None
        finally:
            cursor.close()
        if mutation_point == "before-publish":
            monkeypatch.setattr(source_module, "_OPERATION_SEQUENCE_ZERO_INSERT_SQL", hostile)
        else:

            def mutate_then_begin(*args: object) -> object:
                monkeypatch.setattr(source_module, "_OPERATION_SEQUENCE_ZERO_INSERT_SQL", hostile)
                return original_begin(*args)

            monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", mutate_then_begin)
        receipt = _publish(graph)
        assert _assert_receipt(graph, receipt) is receipt
        cursor = connection.execute(
            "SELECT current_version FROM main.ge_cycle_schema WHERE singleton = 1"
        )
        try:
            assert cursor.fetchone() == version
            assert cursor.fetchone() is None
        finally:
            cursor.close()
        assert len(_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_paired_late_public_sql_and_sha_mutation_cannot_rewrite_historical_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    try:
        receipt = _publish(graph)
        hostile = "INSERT INTO hostile_sequence VALUES (?, ?, ?)"
        hostile_sha = hashlib.sha256(hostile.encode()).hexdigest()
        monkeypatch.setattr(
            outer_module,
            "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC",
            hostile,
        )
        monkeypatch.setattr(
            outer_module,
            "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC",
            hostile_sha,
        )
        monkeypatch.setattr(
            source_module,
            "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC",
            hostile,
        )
        monkeypatch.setattr(
            source_module,
            "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC",
            hostile_sha,
        )
        assert _assert_receipt(graph, receipt) is receipt
        snapshot = _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
            receipt
        )
        assert snapshot.fixed_insert_sql == _INSERT_SQL
        assert snapshot.fixed_insert_sql_sha256 == _INSERT_SHA256
    finally:
        _safe_cleanup(connection, stage)


@pytest.mark.parametrize(
    "field,value",
    [
        ("baseline_captured_at_ms", -1),
        ("updated_at_ms", -1),
        ("last_commit_sequence", 1),
        ("parameter_sha256", "0" * 64),
        ("result_sha256", "0" * 64),
        ("fixed_insert_sql", "INSERT INTO hostile VALUES (?, ?, ?)"),
        ("fixed_insert_sql_sha256", "0" * 64),
    ],
)
def test_direct_receipt_scalar_and_sql_commitment_tampering_is_detected(
    field: str,
    value: object,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    try:
        receipt = _publish(graph)
        record = outer_module._operation_sequence_zero_receipt_record(receipt)
        object.__setattr__(record, field, value)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_DRIFT$"):
            _assert_receipt(graph, receipt)
        assert _authority(graph).lifecycle == "poisoned"
        assert len(_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_paired_receipt_record_sql_and_matching_sha_tamper_is_rejected() -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    try:
        receipt = _publish(graph)
        record = outer_module._operation_sequence_zero_receipt_record(receipt)
        hostile = _INSERT_SQL.replace("operation_sequence", "operation_sequencx")
        object.__setattr__(record, "fixed_insert_sql", hostile)
        object.__setattr__(
            record,
            "fixed_insert_sql_sha256",
            hashlib.sha256(hostile.encode()).hexdigest(),
        )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_DRIFT$"):
            _assert_receipt(graph, receipt)
        assert _authority(graph).lifecycle == "poisoned"
        assert len(_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_fresh_clock_reread_detects_provider_value_drift_during_assertion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    receipt = _publish(graph)
    original = outer_module._READ_CLOCK_EVIDENCE

    def drift(*args: object) -> object:
        snapshot = original(*args)
        return replace(snapshot, provider_now_ms=snapshot.provider_now_ms + 1)

    monkeypatch.setattr(outer_module, "_READ_CLOCK_EVIDENCE", drift)
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_CLOCK$"):
            _assert_receipt(graph, receipt)
        assert _authority(graph).lifecycle == "poisoned"
        assert len(_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_equal_projection_identity_clone_substitution_invalidates_receipt() -> None:
    graph = _sequence_graph(1)
    connection, stage, authority, *_ = graph
    try:
        receipt = _publish(graph)
        state = outer_module._authority_state(authority)
        original = state.projection_identity
        clone = replace(original)
        assert clone == original and clone is not original
        state.projection_identity = clone
        with pytest.raises(ValueError, match=r"PROJECTION|GRAPH|RECEIPT|DRIFT|PREDECESSOR"):
            _assert_receipt(graph, receipt)
        assert _authority(graph).lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_receipt_assertion_rejects_outer_ledger_regression() -> None:
    graph = _sequence_graph(1)
    connection, stage, authority, *_ = graph
    try:
        receipt = _publish(graph)
        state = outer_module._authority_state(authority)
        state.logical_write_sequence -= 1
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_DRIFT$"):
            _assert_receipt(graph, receipt)
        assert _authority(graph).lifecycle == "poisoned"
    finally:
        _safe_cleanup(connection, stage)


def test_receipt_assertion_rejects_write_phase_regression() -> None:
    graph = _sequence_graph(1)
    connection, stage, authority, *_ = graph
    try:
        receipt = _publish(graph)
        state = outer_module._authority_state(authority)
        state.write_phase = "baseline-header-complete"
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_DRIFT$"):
            _assert_receipt(graph, receipt)
        after = _authority(graph)
        assert after.lifecycle == "poisoned"
        assert after.write_phase == "poisoned"
        assert len(_rows(connection)) == 1
    finally:
        _safe_cleanup(connection, stage)


def test_receipt_assertion_allows_monotonic_later_phase_ledger_advancement() -> None:
    graph = _sequence_graph(1)
    connection, stage, authority, *_ = graph
    try:
        receipt = _publish(graph)
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
        assert _assert_receipt(graph, receipt) is receipt
        assert _assert_receipt(graph, receipt) is receipt
    finally:
        _safe_cleanup(connection, stage)


def test_stale_transaction_generation_retires_before_prepare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    connection.rollback()
    connection.execute("BEGIN EXCLUSIVE").close()
    begins = 0
    original_begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO

    def counted_begin(*args: object) -> object:
        nonlocal begins
        begins += 1
        return original_begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", counted_begin)
    try:
        with pytest.raises(ValueError, match=r"STALE|FENCE|LINEAGE|RETIRED"):
            _publish(graph)
        assert begins == 0
        assert _authority(graph).lifecycle == "retired"
        assert _authority(graph).operation_sequence_zero_publication_receipt is None
    finally:
        _safe_cleanup(connection, stage)


def test_unexplained_total_change_drift_poisons_before_prepare(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    cursor = connection.execute(
        "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
    )
    cursor.close()
    begins = 0
    original_begin = outer_module._BEGIN_OPERATION_SEQUENCE_ZERO

    def counted_begin(*args: object) -> object:
        nonlocal begins
        begins += 1
        return original_begin(*args)

    monkeypatch.setattr(outer_module, "_BEGIN_OPERATION_SEQUENCE_ZERO", counted_begin)
    try:
        with pytest.raises(ValueError, match=r"HEADER|RECEIPT|DRIFT|PREDECESSOR"):
            _publish(graph)
        assert begins == 0
        assert _authority(graph).lifecycle == "poisoned"
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_outer_executes_one_insert_and_never_owns_caller_transaction() -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    raw = _raw(connection)
    statements: list[str] = []
    raw.set_trace_callback(statements.append)
    generation = connection._transaction_generation
    try:
        receipt = _publish(graph)
        inserts = [statement for statement in statements if statement.startswith("INSERT INTO")]
        assert len(inserts) == 1
        assert "ge_cycle_operation_sequence" in inserts[0]
        controls = {
            statement.lstrip().split(maxsplit=1)[0].upper()
            for statement in statements
            if statement.strip()
        }
        assert controls.isdisjoint({"BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "RELEASE"})
        assert connection.in_transaction and connection.in_exclusive_transaction
        assert connection._transaction_generation is generation
        assert _assert_receipt(graph, receipt) is receipt
    finally:
        raw.set_trace_callback(None)
        _safe_cleanup(connection, stage)


def test_outer_cleanup_failure_retains_row_and_mints_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph

    def fail_close(_: object) -> None:
        raise RuntimeError("forced sequence cleanup failure")

    monkeypatch.setattr(source_module, "_SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE", fail_close)
    try:
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_CLEANUP$"):
            _publish(graph)
        assert len(_rows(connection)) == 1
        after = _authority(graph)
        assert after.lifecycle == "poisoned"
        assert after.operation_sequence_zero_prepare_count == 1
        assert after.operation_sequence_zero_execute_count == 1
        assert after.operation_sequence_zero_affected_rows == 1
        assert after.operation_sequence_zero_publication_receipt is None
        assert after.operation_sequence_zero_publication_receipt_mint_count == 0
        assert after.outer_ledger == (16, 34, 3)
    finally:
        _safe_cleanup(connection, stage)


def test_execute_primary_outranks_progress_read_secondary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    primary = ValueError("forced primary sequence execute")

    def fail_execute(*_: object) -> object:
        raise primary

    def fail_progress(*_: object) -> object:
        raise RuntimeError("forced secondary progress read")

    monkeypatch.setattr(outer_module, "_EXECUTE_OPERATION_SEQUENCE_ZERO", fail_execute)
    monkeypatch.setattr(outer_module, "_READ_OPERATION_SEQUENCE_ZERO_PROGRESS", fail_progress)
    try:
        with pytest.raises(ValueError, match="forced primary sequence execute") as caught:
            _publish(graph)
        assert caught.value is primary
        assert _authority(graph).operation_sequence_zero_publication_receipt is None
        assert _authority(graph).lifecycle == "poisoned"
        assert _rows(connection) == []
    finally:
        _safe_cleanup(connection, stage)


def test_receipt_record_has_only_weak_graph_edges_and_scalar_commitments() -> None:
    fields = set(outer_module._OperationSequenceZeroPublicationReceiptRecord.__dataclass_fields__)
    assert {
        "connection",
        "authority",
        "migration_0002_receipt",
        "fence",
        "reader_lease",
        "baseline_entries_publication_receipt",
        "baseline_header_publication_receipt",
        "projection_identity",
        "projection_reference",
        "outer_clock_evidence",
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
        "authority_id",
        "authority_ref",
        "migration_0002_receipt_id",
        "migration_0002_receipt_ref",
        "fence_id",
        "fence_ref",
        "reader_lease_id",
        "reader_lease_ref",
        "baseline_entries_receipt_id",
        "baseline_entries_receipt_ref",
        "baseline_header_receipt_id",
        "baseline_header_receipt_ref",
        "outer_clock_evidence_id",
        "outer_clock_evidence_ref",
        "projection_identity_id",
        "projection_reference_id",
        "projection_reference_ref",
        "fixed_insert_sql",
        "fixed_insert_sql_sha256",
    } <= fields


def test_successful_receipt_registry_does_not_keep_upstream_graph_alive() -> None:
    gc.collect()
    gc.collect()
    baseline = len(outer_module._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS)

    def abandon() -> tuple[object, ...]:
        graph = _sequence_graph(1)
        connection, stage, authority, migration, fence, reader, entries, header = graph
        receipt = _publish(graph)
        references = (
            ref(authority),
            ref(migration),
            ref(fence),
            ref(reader),
            ref(entries),
            ref(header),
            ref(stage),
        )
        _safe_cleanup(connection, stage)
        return receipt, *references

    receipt, *references = abandon()
    gc.collect()
    gc.collect()
    assert all(reference() is None for reference in references)
    assert len(outer_module._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS) == baseline + 1
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT$"):
        _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
            cast(_SQLiteOperationSequenceZeroPublicationReceipt, receipt)
        )
    receipt_ref = ref(receipt)
    del receipt
    gc.collect()
    gc.collect()
    assert receipt_ref() is None
    assert len(outer_module._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS) == baseline


def test_package_root_keeps_every_sequence_zero_capability_private() -> None:
    private = {
        "execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic",
        "assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic",
        "read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic",
        "begin_sqlite_connection_operation_sequence_zero_execution_intrinsic",
        "execute_sqlite_connection_operation_sequence_zero_intrinsic",
        "read_sqlite_connection_operation_sequence_zero_execution_snapshot_intrinsic",
        "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC",
        "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC",
        "SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC",
    }
    assert private.isdisjoint(vars(graph_engineering))


def test_leaf_mints_no_adoption_session_rebind_manifest_or_commit_authority() -> None:
    graph = _sequence_graph(1)
    connection, stage, *_ = graph
    try:
        receipt = _publish(graph)
        snapshot = _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
            receipt
        )
        for forbidden in (
            "adoption_receipt",
            "publication_session",
            "cursor_rebind_receipt",
            "retirement_receipt",
            "manifest",
            "commit_receipt",
            "implementation_claim",
            "active_manifest_claim",
        ):
            assert not hasattr(snapshot, forbidden)
        source = Path(cast(str, outer_module.__file__)).read_text(encoding="utf-8")
        start = source.index(
            "def _execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic"
        )
        end = source.index(
            "def _assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic",
            start,
        )
        leaf = source[start:end]
        for forbidden in (
            ".commit(",
            ".rollback(",
            "initial_stage_adoption",
            "publication_session",
            "cursor_rebind",
            "manifest_activation",
        ):
            assert forbidden not in leaf
    finally:
        _safe_cleanup(connection, stage)
