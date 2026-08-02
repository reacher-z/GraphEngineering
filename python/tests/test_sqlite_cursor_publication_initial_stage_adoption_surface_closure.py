from __future__ import annotations

import gc
import os
import subprocess
import sys
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as ownership
import graph_engineering.sqlite_operation_baseline_stage as stage_module
from tests.test_sqlite_cursor_publication_initial_stage_adoption import (
    _adopt,
    _AdoptionGraph,
    _api,
    _assert_unconsumed_healthy,
    _authority,
    _opaque_clone,
    _three_layer_fingerprint,
)
from tests.test_sqlite_cursor_publication_initial_stage_adoption_hostile import (
    _assert_complete_three_layer_poison as _assert_zero_proof_three_layer_poison,
)
from tests.test_sqlite_cursor_publication_migration_0002_execution import _raw


@pytest.fixture
def surface_graphs() -> Iterator[Callable[[int], _AdoptionGraph]]:
    graphs: list[_AdoptionGraph] = []

    def create(legacy_count: int = 1) -> _AdoptionGraph:
        graph = _AdoptionGraph(legacy_count)
        graphs.append(graph)
        return graph

    yield create
    for graph in reversed(graphs):
        graph.close()


_PROOF_REGISTRY_NAMES = (
    "_INITIAL_STAGE_ADOPTION_RECEIPTS",
    "_INITIAL_STAGE_ADOPTION_TOMBSTONES",
    "_MIGRATION_0002_RECEIPT_CONSUMPTIONS",
    "_BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS",
    "_BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS",
    "_OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS",
)

_ONE_GRAPH_PROOF_DELTA = {
    "_INITIAL_STAGE_ADOPTION_RECEIPTS": 1,
    "_INITIAL_STAGE_ADOPTION_TOMBSTONES": 4,
    "_MIGRATION_0002_RECEIPT_CONSUMPTIONS": 1,
    "_BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS": 1,
    "_BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS": 1,
    "_OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS": 1,
}


def _proof_registry_keys() -> dict[str, frozenset[int]]:
    gc.collect()
    return {name: frozenset(getattr(outer, name)) for name in _PROOF_REGISTRY_NAMES}


def _assert_exact_proof_delta(
    before: dict[str, frozenset[int]],
    after: dict[str, frozenset[int]],
    graph_count: int,
) -> None:
    assert before.keys() == after.keys() == _ONE_GRAPH_PROOF_DELTA.keys()
    for name, one_graph_delta in _ONE_GRAPH_PROOF_DELTA.items():
        assert before[name] < after[name]
        assert len(after[name] - before[name]) == one_graph_delta * graph_count


def _prepared_tails(graph: _AdoptionGraph) -> tuple[object, object]:
    state = outer._authority_state(graph.authority)
    metadata = ownership._read_transfer_metadata(state.transfer)
    assert metadata is not None
    wrapper_tail = metadata.initial_publication_adoption_tail
    stage_tail = metadata.initial_publication_adoption_stage_tail
    assert wrapper_tail is not None
    assert stage_tail is not None
    return wrapper_tail, stage_tail


def _assert_both_tails_burned(wrapper_tail: object, stage_tail: object) -> None:
    assert id(wrapper_tail) not in ownership._INITIAL_PUBLICATION_ADOPTION_TAILS
    assert id(stage_tail) not in stage_module._CURSOR_INITIAL_PUBLICATION_ADOPTION_TAILS


def _assert_complete_three_layer_poison(graph: _AdoptionGraph) -> None:
    state = outer._authority_state(graph.authority)
    metadata = ownership._read_transfer_metadata(state.transfer)
    assert metadata is not None
    assert state.lifecycle == "poisoned"
    assert state.write_phase == "poisoned"
    assert state.stage_ownership_poison_reason is not None
    assert state.initial_stage_adoption_receipt is not None
    assert state.initial_stage_adoption_receipt_mint_count == 1
    assert state.receipt_consumption_count == 4
    assert state.tombstone_mint_count == 4
    assert metadata.lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"
    assert graph.stage._cursor_transfer_state == "poisoned"
    assert graph.stage._cursor_outer_publication_state == "poisoned"
    assert graph.stage._cursor_b2_catalog_change_fence_state == "poisoned"


def _assert_receipt(graph: _AdoptionGraph, receipt: object) -> object:
    return _api("_assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic")(
        graph.authority,
        graph.bundle,
        graph.fence,
        graph.reader,
        receipt,
    )


def test_complete_foreign_graph_and_wrong_transitive_owner_are_retryable(
    surface_graphs: Callable[[int], _AdoptionGraph],
) -> None:
    adopt = _api("_adopt_sqlite_cursor_initial_publication_stage_intrinsic")
    for direction in ("foreign-graph", "wrong-owner"):
        local = surface_graphs(2)
        foreign = surface_graphs(3)
        local_state = outer._authority_state(local.authority)
        foreign_state = outer._authority_state(foreign.authority)
        assert foreign.authority is not local.authority
        assert foreign.connection is not local.connection
        assert foreign_state.projection_identity is not local_state.projection_identity
        before_local = _three_layer_fingerprint(local)
        before_foreign = _three_layer_fingerprint(foreign)

        if direction == "foreign-graph":
            arguments = (
                local.authority,
                foreign.bundle,
                foreign.fence,
                foreign.reader,
                None,
            )
        else:
            arguments = (
                foreign.authority,
                local.bundle,
                local.fence,
                local.reader,
                None,
            )

        with pytest.raises(ValueError) as caught:
            adopt(*arguments)
        assert str(caught.value) == "GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE_GRAPH"
        assert _three_layer_fingerprint(local) == before_local
        assert _three_layer_fingerprint(foreign) == before_foreign
        _assert_unconsumed_healthy(local)
        _assert_unconsumed_healthy(foreign)

        # Both exact owners remain independently retryable after the complete
        # wrong-authority/connection/projection presentation is rejected.
        assert _adopt(local) is not None
        assert _adopt(foreign) is not None


@pytest.mark.parametrize("attack", ("clone", "substitution", "exact-replay"))
def test_receipt_forgery_and_replay_poison_all_layers_without_registry_growth(
    surface_graphs: Callable[[int], _AdoptionGraph],
    attack: str,
) -> None:
    target = surface_graphs(2)
    before = _proof_registry_keys()
    receipt = _adopt(target)
    wrapper_tail, stage_tail = _prepared_tails(target)
    _assert_both_tails_burned(wrapper_tail, stage_tail)

    graph_count = 1
    presented: object | None = None
    if attack == "clone":
        presented = _opaque_clone(receipt)
    elif attack == "substitution":
        source = surface_graphs(3)
        presented = _adopt(source)
        source_wrapper_tail, source_stage_tail = _prepared_tails(source)
        _assert_both_tails_burned(source_wrapper_tail, source_stage_tail)
        graph_count = 2

    after_success = _proof_registry_keys()
    _assert_exact_proof_delta(before, after_success, graph_count)

    with pytest.raises(ValueError):
        if attack == "exact-replay":
            _adopt(target)
        else:
            assert presented is not None
            _assert_receipt(target, presented)

    _assert_complete_three_layer_poison(target)
    assert _proof_registry_keys() == after_success
    _assert_both_tails_burned(wrapper_tail, stage_tail)


def test_integrated_success_burns_both_tails_and_retires_only_old_b2_capture(
    surface_graphs: Callable[[int], _AdoptionGraph],
) -> None:
    graph = surface_graphs(4)
    state = outer._authority_state(graph.authority)
    before = _proof_registry_keys()

    receipt = _adopt(graph)
    after = _proof_registry_keys()
    _assert_exact_proof_delta(before, after, 1)
    wrapper_tail, stage_tail = _prepared_tails(graph)
    _assert_both_tails_burned(wrapper_tail, stage_tail)

    metadata = ownership._read_transfer_metadata(state.transfer)
    assert metadata is not None
    assert metadata.lifecycle == "initial-publication-adopted"
    assert graph.stage._cursor_b2_catalog_change_fence_state == "retired"
    assert graph.stage._cursor_b2_catalog_change_fence_retirement is not None
    assert graph.stage._cursor_transfer_capture_epoch is None
    assert graph.stage._cursor_transfer_stage_epoch is None
    assert graph.stage._cursor_transfer_allowed_total_changes is None
    assert graph.stage._cursor_transfer_lineage is state.transaction_generation
    assert graph.stage._cursor_transfer_receipt is state.receipt
    assert graph.stage._cursor_transfer_projection is state.projection_identity

    with pytest.raises(ValueError, match="outer publication ownership is invalid"):
        ownership._assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic(
            graph.connection,
            graph.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            graph.authority,
        )
    with pytest.raises(ValueError):
        graph.stage._assert_cursor_outer_publication_owned(
            graph.connection,
            state.receipt,
            state.projection_identity,
            state.transfer,
            graph.authority,
        )

    assert _assert_receipt(graph, receipt) is receipt
    assert _authority(graph).lifecycle == "active"
    assert _proof_registry_keys() == after


def test_stage_publish_gate_failure_propagates_terminal_poison_through_all_layers(
    surface_graphs: Callable[[int], _AdoptionGraph],
) -> None:
    graph = surface_graphs(3)
    wrapper_tail: object | None = None
    stage_tail: object | None = None

    def prepare_then_break_stage_publish_gate(*args: object) -> object:
        nonlocal wrapper_tail, stage_tail
        mint = outer._OWNERSHIP_PREPARE_INITIAL_ADOPTION(*args)
        state = outer._authority_state(graph.authority)
        metadata = ownership._read_transfer_metadata(state.transfer)
        assert metadata is not None
        wrapper_tail = mint.tail
        stage_tail = metadata.initial_publication_adoption_stage_tail
        assert stage_tail is not None
        # Preparation was authentic at both lower levels.  Break only the
        # final stage publication gate after both continuations exist.
        graph.stage._cursor_initial_publication_adoption_previous_catalog = None
        return mint

    with pytest.raises(
        ValueError,
        match="SQLite cursor initial publication adoption tail is invalid",
    ):
        outer._adopt_sqlite_cursor_initial_publication_stage_with_tail_intrinsic(
            graph.authority,
            graph.bundle,
            graph.fence,
            graph.reader,
            None,
            outer._INITIAL_ADOPTION_ATOMIC_TAIL,
            prepare_then_break_stage_publish_gate,
        )

    assert wrapper_tail is not None
    assert stage_tail is not None
    _assert_zero_proof_three_layer_poison(graph)
    _assert_both_tails_burned(wrapper_tail, stage_tail)
    with pytest.raises(ValueError, match="adoption tail is invalid"):
        ownership._publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
            wrapper_tail
        )


_LOCK_READ = (
    "SELECT active_lock_id, active_owner_id, active_source_version, "
    "active_target_version, active_lock_epoch, active_fencing_token, "
    "active_expires_at_ms FROM main.ge_cycle_migration_lock WHERE singleton = 1"
)

_EXACT_ADOPTION_TRACE = (
    _LOCK_READ,
    _LOCK_READ,
    _LOCK_READ,
    "SELECT type, name, tbl_name AS tableName, sql FROM main.sqlite_schema "
    "WHERE lower(name) GLOB 'ge_cycle_*' AND sql IS NOT NULL "
    "ORDER BY type COLLATE BINARY, name COLLATE BINARY",
    "SELECT application_id, user_version FROM "
    "main.pragma_application_id(), main.pragma_user_version()",
    "-- PRAGMA application_id",
    "-- PRAGMA user_version",
    _LOCK_READ,
    "SELECT schema_version FROM pragma_schema_version",
    "-- PRAGMA schema_version",
    "SELECT type, name, tbl_name, rootpage, sql FROM main.sqlite_schema "
    "WHERE type = 'table' AND name = 'ge_cycle_operations'",
)


def test_adoption_sql_trace_is_the_exact_readonly_allowlist_without_write_pragma(
    surface_graphs: Callable[[int], _AdoptionGraph],
) -> None:
    graph = surface_graphs(1)
    raw = _raw(graph.connection)
    statements: list[str] = []
    raw.set_trace_callback(statements.append)
    try:
        _adopt(graph)
    finally:
        raw.set_trace_callback(None)

    normalized = tuple(" ".join(statement.split()) for statement in statements)
    assert normalized == _EXACT_ADOPTION_TRACE
    executable = tuple(statement for statement in normalized if not statement.startswith("--"))
    assert executable
    assert all(statement.startswith("SELECT ") for statement in executable)
    assert all(not statement.upper().startswith("PRAGMA ") for statement in executable)
    assert not any("PRAGMA " in statement.upper() and "=" in statement for statement in executable)


_SNAPSHOT_FIELDS = (
    "authority",
    "connection",
    "stage",
    "receipt",
    "projection_identity",
    "projection_reference",
    "transfer",
    "transaction_generation",
    "migration_0002_receipt",
    "baseline_entries_publication_receipt",
    "baseline_header_publication_receipt",
    "operation_sequence_zero_publication_receipt",
    "migration_0002_consumed_tombstone",
    "baseline_entries_consumed_tombstone",
    "baseline_header_consumed_tombstone",
    "operation_sequence_zero_consumed_tombstone",
    "post_ddl_catalog_fence",
    "reader_lease",
    "reader_lease_lifecycle",
    "reader_close_count",
    "reader_rederived_projection_sha256",
    "adopted_transaction_epoch",
    "adopted_total_changes",
    "adopted_outer_ledger",
    "target_catalog_sha256",
    "retired_b2_fence",
    "mint_count",
    "write_kind",
)


def test_adoption_snapshot_has_exact_28_field_order(
    surface_graphs: Callable[[int], _AdoptionGraph],
) -> None:
    graph = surface_graphs(2)
    receipt = _adopt(graph)
    snapshot = _api("_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic")(
        receipt
    )

    assert len(snapshot) == 28
    assert type(snapshot)._fields == _SNAPSHOT_FIELDS
    assert tuple(snapshot._asdict()) == _SNAPSHOT_FIELDS


_FORBIDDEN_PACKAGE_ROOT_NAMES = (
    "SQLiteCursorInitialStageAdoptionReceipt",
    "adopt_sqlite_cursor_initial_publication_stage_intrinsic",
    "assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic",
    "read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic",
    "begin_sqlite_cursor_initial_publication_session_intrinsic",
    "rebind_sqlite_cursor_initial_publication_intrinsic",
    "commit_sqlite_cursor_initial_publication_intrinsic",
)


def test_package_root_runtime_and_external_mypy_surface_are_closed() -> None:
    runtime_names = set(dir(graph_engineering))
    exported_names = set(graph_engineering.__all__)
    assert set(_FORBIDDEN_PACKAGE_ROOT_NAMES).isdisjoint(runtime_names)
    assert set(_FORBIDDEN_PACKAGE_ROOT_NAMES).isdisjoint(exported_names)

    consumer = "\n".join(
        (
            "from graph_engineering import GraphBuilder",
            *(f"from graph_engineering import {name}" for name in _FORBIDDEN_PACKAGE_ROOT_NAMES),
            "builder_type: type[GraphBuilder] = GraphBuilder",
        )
    )
    completed = subprocess.run(
        (
            sys.executable,
            "-m",
            "mypy",
            "--strict",
            "--no-incremental",
            "--show-error-codes",
            "--no-error-summary",
            "--no-pretty",
            "-c",
            consumer,
        ),
        cwd=Path(__file__).resolve().parents[2],
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 1, completed.stdout + completed.stderr
    assert completed.stderr == ""
    errors = tuple(line for line in completed.stdout.splitlines() if ": error:" in line)
    assert len(errors) == len(_FORBIDDEN_PACKAGE_ROOT_NAMES)
    assert all("[attr-defined]" in line for line in errors)
    for name in _FORBIDDEN_PACKAGE_ROOT_NAMES:
        assert sum(f'has no attribute "{name}"' in line for line in errors) == 1
