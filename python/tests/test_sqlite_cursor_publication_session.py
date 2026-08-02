from __future__ import annotations

import gc
import inspect
from collections.abc import Iterator
from dataclasses import replace
from typing import Any
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_clock_authority as clock_module
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as ownership_module
import graph_engineering.sqlite_operation_baseline_stage as stage_module
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    _assert_prepared_second_boundary_graph_intrinsic,
    _consume_provider_clock_evidence_intrinsic,
    _observe_provider_clock_intrinsic,
)
from tests.test_sqlite_cursor_publication_initial_stage_adoption import _AdoptionGraph


@pytest.fixture  # type: ignore[untyped-decorator]
def session_graphs() -> Iterator[Any]:
    graphs: list[_AdoptionGraph] = []

    def create() -> tuple[_AdoptionGraph, object]:
        graph = _AdoptionGraph(1)
        graphs.append(graph)
        adoption = outer_module._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
            graph.authority,
            graph.bundle,
            graph.fence,
            graph.reader,
        )
        return graph, adoption

    yield create
    for graph in reversed(graphs):
        graph.close()


def _prepare_and_observe(graph: _AdoptionGraph, adoption: object) -> tuple[object, object]:
    prepared = outer_module._prepare_sqlite_cursor_publication_session_intrinsic(
        graph.authority,
        adoption,
    )
    evidence = outer_module._observe_sqlite_cursor_publication_session_clock_intrinsic(prepared)
    return prepared, evidence


def test_prepare_observe_publish_activates_all_three_exact_identity_layers(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    state = outer_module._authority_state(graph.authority)
    before_epoch = graph.connection.transaction_epoch
    before_changes = graph.connection.total_changes

    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    assert outer_module._assert_sqlite_cursor_publication_session_intrinsic(session) is session
    snapshot = outer_module._read_sqlite_cursor_publication_session_snapshot_intrinsic(session)
    transfer = ownership_module._TRANSFERS[state.transfer]

    assert snapshot.lifecycle == "publication-active"
    assert snapshot.session is session
    assert snapshot.prepared_owner is prepared
    assert snapshot.authority is graph.authority
    assert snapshot.adoption_receipt is adoption
    assert snapshot.receipt is state.receipt
    assert snapshot.projection_reference is state.projection_reference
    assert snapshot.projection_identity is state.projection_identity
    assert snapshot.stage is graph.stage
    assert snapshot.connection is graph.connection
    assert snapshot.transfer is state.transfer
    assert snapshot.transaction_generation is state.transaction_generation
    assert snapshot.migration_lock_capability is state.migration_lock_capability
    assert snapshot.provider_clock_capability is state.provider_clock_capability
    assert snapshot.outer_clock_evidence is state.outer_clock_evidence
    assert snapshot.pre_rebind_clock_evidence is evidence
    assert snapshot.post_ddl_catalog_fence is graph.fence
    assert snapshot.source_descriptor_hash == state.source_descriptor_hash
    assert snapshot.source_schema_identity == state.source_schema_identity_sha256
    assert len(snapshot.target_descriptor_hash) == 64
    assert len(snapshot.target_schema_identity) == 64
    assert state.write_phase == "publication-active"
    assert transfer.lifecycle == "publication-active"
    assert graph.stage._cursor_outer_publication_state == "publication-active"
    clock_state = clock_module._CLOCK_CAPABILITIES[state.provider_clock_capability]
    assert clock_state.next_boundary_index == 2
    assert clock_module._EVIDENCE[state.outer_clock_evidence].consumed is True
    assert clock_module._EVIDENCE[evidence].consumed is True
    authority_snapshot = (
        outer_module._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
    )
    assert authority_snapshot.outer_ledger == (16, 34, 4)
    assert authority_snapshot.migration_0002_prepared_statement_count == 20
    assert authority_snapshot.baseline_entries_prepare_count == 1
    assert authority_snapshot.baseline_entries_execute_count == 12
    assert authority_snapshot.baseline_header_execute_count == 1
    assert authority_snapshot.operation_sequence_zero_execute_count == 1
    assert authority_snapshot.receipt_consumption_count == 4
    assert authority_snapshot.tombstone_mint_count == 4
    assert graph.connection.transaction_epoch == before_epoch
    assert graph.connection.total_changes == before_changes


def test_cancelled_pre_tail_reuses_exact_prepared_graph_and_unconsumed_evidence(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    state = outer_module._authority_state(graph.authority)
    controller = (
        outer_module._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
    )
    controller.cancel()
    before_epoch = graph.connection.transaction_epoch
    before_changes = graph.connection.total_changes

    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_CANCELLED$"):
        outer_module._publish_sqlite_cursor_publication_session_intrinsic(
            prepared,
            evidence,
            controller.signal,
        )
    prepared_state = outer_module._PUBLICATION_PREPARED[id(prepared)].value
    assert prepared_state.lifecycle == "prepared"
    assert state.publication_session is None
    assert state.write_phase == "initial-stage-adoption-complete"
    assert graph.connection.transaction_epoch == before_epoch
    assert graph.connection.total_changes == before_changes
    assert (
        _assert_prepared_second_boundary_graph_intrinsic(
            graph.connection,
            state.migration_lock_capability,
            state.provider_clock_capability,
            state.outer_clock_evidence,
            state.outer_clock_consumed_tombstone,
            evidence,
        ).predecessor_evidence
        is state.outer_clock_evidence
    )
    assert (
        outer_module._prepare_sqlite_cursor_publication_session_intrinsic(graph.authority, adoption)
        is prepared
    )
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    assert outer_module._assert_sqlite_cursor_publication_session_intrinsic(session) is session


def test_session_assertion_is_repeatable_read_only_and_rejects_an_early_third_clock(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    state = outer_module._authority_state(graph.authority)
    before_epoch = graph.connection.transaction_epoch
    before_changes = graph.connection.total_changes
    assert outer_module._assert_sqlite_cursor_publication_session_intrinsic(session) is session
    assert outer_module._assert_sqlite_cursor_publication_session_intrinsic(session) is session
    assert graph.connection.transaction_epoch == before_epoch
    assert graph.connection.total_changes == before_changes

    _observe_provider_clock_intrinsic(state.provider_clock_capability, "before-verification")
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_SECOND_GRAPH$"):
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(session)
    transfer = ownership_module._TRANSFERS[state.transfer]
    assert state.lifecycle == "poisoned"
    assert transfer.lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"


def test_session_assertion_uses_one_live_lock_and_one_catalog_observation(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    native_connection = object.__getattribute__(
        graph.connection,
        "_SQLiteV1BaselineConnectionOwner__connection",
    )
    statements: list[str] = []
    native_connection.set_trace_callback(statements.append)
    try:
        assert outer_module._assert_sqlite_cursor_publication_session_intrinsic(session) is session
    finally:
        native_connection.set_trace_callback(None)
    normalized = tuple(" ".join(statement.split()) for statement in statements)
    lock_reads = tuple(
        statement
        for statement in normalized
        if "FROM main.ge_cycle_migration_lock WHERE singleton = 1" in statement
    )
    schema_reads = tuple(
        statement for statement in normalized if "FROM main.sqlite_schema" in statement
    )
    header_reads = tuple(
        statement
        for statement in normalized
        if statement.startswith("SELECT application_id, user_version")
    )
    assert len(lock_reads) == 1
    assert len(schema_reads) == 1
    assert len(header_reads) == 1
    assert normalized == (
        lock_reads[0],
        schema_reads[0],
        header_reads[0],
        "-- PRAGMA application_id",
        "-- PRAGMA user_version",
    )


def test_pending_registration_failure_retains_primary_and_poisons_every_owner(
    session_graphs: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    state = outer_module._authority_state(graph.authority)

    def fail_registration(*_args: object) -> None:
        raise MemoryError("injected pending registration failure")

    monkeypatch.setattr(outer_module, "_identity_set", fail_registration)
    with pytest.raises(MemoryError, match="pending registration failure"):
        outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    transfer = ownership_module._TRANSFERS[state.transfer]
    assert state.lifecycle == "poisoned"
    assert state.write_phase == "poisoned"
    assert transfer.lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"
    assert graph.stage._cursor_publication_session_tail is None


def test_pre_tail_commit_preparation_failure_never_publishes_a_half_transition(
    session_graphs: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    state = outer_module._authority_state(graph.authority)

    def fail(*_args: object) -> object:
        raise MemoryError("injected prepare-commit failure")

    monkeypatch.setattr(
        outer_module,
        "_OWNERSHIP_PREPARE_PUBLICATION_SESSION_COMMIT",
        fail,
    )
    with pytest.raises(MemoryError, match="prepare-commit"):
        outer_module._publish_sqlite_cursor_publication_session_intrinsic(
            prepared,
            evidence,
        )
    transfer = ownership_module._TRANSFERS[state.transfer]
    assert clock_module._EVIDENCE[evidence].consumed is False
    assert state.publication_session is None
    assert state.lifecycle == "poisoned"
    assert state.write_phase == "poisoned"
    assert transfer.lifecycle == "poisoned"
    assert transfer.publication_session_ref is None
    assert graph.stage.state == "poisoned"
    assert graph.stage._cursor_outer_publication_state == "poisoned"
    assert graph.stage._cursor_publication_session_ref is None


def test_atomic_tail_ignores_replaced_module_dispatch_aliases(
    session_graphs: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)

    def fail(*_args: object) -> None:
        raise AssertionError("mutable module dispatch reached atomic tail")

    for module, name in (
        (outer_module, "_OWNERSHIP_BURN_PUBLICATION_SESSION_COMMIT"),
        (outer_module, "_CONSUME_CLOCK"),
        (outer_module, "_OWNERSHIP_PUBLISH_PUBLICATION_SESSION_COMMIT"),
        (ownership_module, "_STAGE_BURN_PUBLICATION_SESSION_COMMIT"),
        (ownership_module, "_STAGE_PUBLISH_PUBLICATION_SESSION_COMMIT"),
    ):
        monkeypatch.setattr(module, name, fail)

    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(
        prepared,
        evidence,
    )
    state = outer_module._authority_state(graph.authority)
    assert clock_module._EVIDENCE[evidence].consumed is True
    assert state.write_phase == "publication-active"
    assert ownership_module._TRANSFERS[state.transfer].lifecycle == "publication-active"
    assert graph.stage._cursor_outer_publication_state == "publication-active"
    assert outer_module._assert_sqlite_cursor_publication_session_intrinsic(session) is session


def test_atomic_tail_commit_closure_contains_no_mutable_registry_work() -> None:
    stage_type = stage_module.SQLiteV1BaselineTempStage
    closure = (
        ownership_module._burn_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic,
        ownership_module._publish_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic,
        stage_type._burn_cursor_publication_session_commit,
        stage_type._publish_cursor_publication_session_commit,
    )
    assert ownership_module._STAGE_BURN_PUBLICATION_SESSION_COMMIT is closure[2]
    assert ownership_module._STAGE_PUBLISH_PUBLICATION_SESSION_COMMIT is closure[3]
    forbidden = {"_DICT_GET", "_DICT_POP", "_DICT_SETITEM"}
    for function in closure:
        assert forbidden.isdisjoint(function.__code__.co_names)
    outer_closure = outer_module._publish_sqlite_cursor_publication_session_intrinsic.__closure__
    assert outer_closure is not None
    captured = tuple(cell.cell_contents for cell in outer_closure)
    implementation = next(
        value
        for value in captured
        if inspect.isfunction(value)
        and value.__name__ == "_publish_sqlite_cursor_publication_session_implementation"
    )
    atomic_tail = next(
        value for value in captured if inspect.isfunction(value) and value.__name__ == "atomic_tail"
    )
    outer_tail = inspect.getsource(atomic_tail).split("# Non-interruptible tail:", 1)[1]
    mutable_dispatch = {
        "_OWNERSHIP_BURN_PUBLICATION_SESSION_COMMIT",
        "_CONSUME_CLOCK",
        "_OWNERSHIP_PUBLISH_PUBLICATION_SESSION_COMMIT",
        "_OBJECT_SETATTR",
        "_AUTHORITY_SESSION_SLOT",
        "_AUTHORITY_SESSION_STATE_SLOT",
        "_poison",
    }
    assert mutable_dispatch.isdisjoint(atomic_tail.__code__.co_names)
    assert all(name not in outer_tail for name in mutable_dispatch | forbidden)
    assert "atomic_tail" not in implementation.__code__.co_names
    for function, stage_callable in (
        (
            ownership_module._burn_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic,
            stage_type._burn_cursor_publication_session_commit,
        ),
        (
            ownership_module._publish_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic,
            stage_type._publish_cursor_publication_session_commit,
        ),
    ):
        cells = function.__closure__
        assert cells is not None
        values = tuple(cell.cell_contents for cell in cells)
        assert stage_callable in values
        for value in values:
            if inspect.isfunction(value):
                assert {
                    "_STAGE_BURN_PUBLICATION_SESSION_COMMIT",
                    "_STAGE_PUBLISH_PUBLICATION_SESSION_COMMIT",
                }.isdisjoint(value.__code__.co_names)


def test_session_capabilities_are_opaque_single_use_and_package_private(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION_PRESENTATION$"):
        outer_module._prepare_sqlite_cursor_publication_session_intrinsic(
            graph.authority,
            object(),
        )
    healthy = outer_module._authority_state(graph.authority)
    assert healthy.lifecycle == "active"
    assert healthy.write_phase == "initial-stage-adoption-complete"
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    with pytest.raises(TypeError, match="GE_CURSOR_B3_PUBLICATION_SESSION"):
        type(session)(object())
    clone = object.__new__(type(session))
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION$"):
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(clone)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION_REUSE$"):
        outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    assert not hasattr(graph_engineering, "SQLiteCursorPublicationSession")
    assert not hasattr(graph_engineering, "prepare_sqlite_cursor_publication_session")


def test_malformed_cancellation_and_prepared_clone_are_healthy_before_tail(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared = outer_module._prepare_sqlite_cursor_publication_session_intrinsic(
        graph.authority, adoption
    )
    clone = object.__new__(type(prepared))
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_PREPARED_OWNER$"):
        outer_module._observe_sqlite_cursor_publication_session_clock_intrinsic(clone)
    evidence = outer_module._observe_sqlite_cursor_publication_session_clock_intrinsic(prepared)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_CANCELLATION$"):
        outer_module._publish_sqlite_cursor_publication_session_intrinsic(
            prepared,
            evidence,
            object(),
        )
    state = outer_module._authority_state(graph.authority)
    assert state.lifecycle == "active"
    assert state.write_phase == "initial-stage-adoption-complete"
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    assert outer_module._assert_sqlite_cursor_publication_session_intrinsic(session) is session


def test_adoption_clone_and_cross_run_adoption_poison_the_selected_graph(
    session_graphs: Any,
) -> None:
    clone_graph, clone_adoption = session_graphs()
    clone = object.__new__(type(clone_adoption))
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH$"):
        outer_module._prepare_sqlite_cursor_publication_session_intrinsic(
            clone_graph.authority,
            clone,
        )
    clone_state = outer_module._authority_state(clone_graph.authority)
    assert clone_state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[clone_state.transfer].lifecycle == "poisoned"
    assert clone_graph.stage.state == "poisoned"

    selected, _selected_adoption = session_graphs()
    foreign, foreign_adoption = session_graphs()
    with pytest.raises(ValueError):
        outer_module._prepare_sqlite_cursor_publication_session_intrinsic(
            selected.authority,
            foreign_adoption,
        )
    selected_state = outer_module._authority_state(selected.authority)
    assert selected_state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[selected_state.transfer].lifecycle == "poisoned"
    assert foreign.stage.state == "open"


def test_cross_run_and_preconsumed_second_evidence_poison_before_publication(
    session_graphs: Any,
) -> None:
    selected, selected_adoption = session_graphs()
    foreign, foreign_adoption = session_graphs()
    selected_prepared, _selected_evidence = _prepare_and_observe(selected, selected_adoption)
    _foreign_prepared, foreign_evidence = _prepare_and_observe(foreign, foreign_adoption)
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION_EVIDENCE$"):
        outer_module._publish_sqlite_cursor_publication_session_intrinsic(
            selected_prepared,
            foreign_evidence,
        )
    selected_state = outer_module._authority_state(selected.authority)
    assert selected_state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[selected_state.transfer].lifecycle == "poisoned"

    consumed, consumed_adoption = session_graphs()
    consumed_prepared, consumed_evidence = _prepare_and_observe(consumed, consumed_adoption)
    consumed_state = outer_module._authority_state(consumed.authority)
    _consume_provider_clock_evidence_intrinsic(
        consumed_state.provider_clock_capability,
        consumed_evidence,
        "cursor-publication-session",
    )
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_SECOND_GRAPH$"):
        outer_module._publish_sqlite_cursor_publication_session_intrinsic(
            consumed_prepared,
            consumed_evidence,
        )
    assert consumed_state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[consumed_state.transfer].lifecycle == "poisoned"


def test_transaction_generation_drift_before_tail_poisons_all_three_owners(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    graph.connection.rollback()
    graph.connection.execute("BEGIN EXCLUSIVE").close()
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION_LINEAGE$"):
        outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    state = outer_module._authority_state(graph.authority)
    assert state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[state.transfer].lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"


@pytest.mark.parametrize("drift", ["total-changes", "target-catalog"])
def test_post_tail_ledger_or_catalog_drift_poisons_every_owner(
    session_graphs: Any,
    drift: str,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    if drift == "total-changes":
        graph.connection.execute(
            "UPDATE main.ge_cycle_migration_lock "
            "SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1"
        ).close()
    else:
        graph.connection.execute("DROP INDEX main.ge_cycle_cursors_expiry_idx").close()
    with pytest.raises(ValueError):
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(session)
    state = outer_module._authority_state(graph.authority)
    assert state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[state.transfer].lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"


def test_post_tail_transaction_lineage_drift_poisons_every_owner(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    graph.connection.rollback()
    graph.connection.execute("BEGIN EXCLUSIVE").close()
    with pytest.raises(ValueError):
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(session)
    state = outer_module._authority_state(graph.authority)
    session_state = outer_module._publication_session_state(session)
    assert session_state.lifecycle == "poisoned"
    assert state.lifecycle == "poisoned"
    assert state.write_phase == "poisoned"
    assert ownership_module._TRANSFERS[state.transfer].lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"
    assert graph.stage._cursor_outer_publication_state == "poisoned"


@pytest.mark.parametrize("evidence_owner", ("outer", "second"))
def test_session_snapshot_expiry_substitution_poisons_every_owner(
    session_graphs: Any,
    evidence_owner: str,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(
        prepared,
        evidence,
    )
    state = outer_module._authority_state(graph.authority)
    session_state = outer_module._publication_session_state(session)
    selected = state.outer_clock_evidence if evidence_owner == "outer" else evidence
    evidence_state = clock_module._EVIDENCE[selected]
    evidence_state.snapshot = replace(
        evidence_state.snapshot,
        active_expires_at_ms=999,
    )

    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_SECOND_GRAPH$"):
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(session)
    assert session_state.lifecycle == "poisoned"
    assert state.lifecycle == "poisoned"
    assert state.write_phase == "poisoned"
    assert ownership_module._TRANSFERS[state.transfer].lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"
    assert graph.stage._cursor_outer_publication_state == "poisoned"


def test_live_authority_retains_the_exact_active_session(session_graphs: Any) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    session_ref = ref(session)
    del session
    gc.collect()
    retained = session_ref()
    assert retained is not None
    authority_state = outer_module._authority_state(graph.authority)
    assert authority_state.publication_session is not None
    assert authority_state.publication_session() is retained
    assert outer_module._anchored_publication_session(graph.authority) is retained
    assert (
        outer_module._assert_sqlite_cursor_outer_publication_authority_intrinsic(graph.authority)
        is graph.authority
    )


def _publication_graph_registry_sizes() -> tuple[int, ...]:
    registries = (
        outer_module._AUTHORITIES,
        outer_module._PUBLICATION_PREPARED,
        outer_module._PUBLICATION_PREPARED_BY_AUTHORITY,
        outer_module._PUBLICATION_SESSIONS,
        outer_module._AUTHORITY_BY_EVIDENCE,
        outer_module._AUTHORITY_BY_TRANSFER,
        outer_module._MIGRATION_0002_RECEIPTS,
        outer_module._POST_DDL_CATALOG_FENCES,
        outer_module._POST_DDL_PUBLICATION_READER_LEASES,
        outer_module._BASELINE_ENTRIES_PUBLICATION_RECEIPTS,
        outer_module._BASELINE_HEADER_PUBLICATION_RECEIPTS,
        outer_module._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS,
        outer_module._MIGRATION_0002_RECEIPT_CONSUMPTIONS,
        outer_module._BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
        outer_module._BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
        outer_module._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
        outer_module._INITIAL_STAGE_ADOPTION_RECEIPTS,
        outer_module._INITIAL_STAGE_ADOPTION_TOMBSTONES,
        ownership_module._TRANSFERS,
        ownership_module._OUTER_PUBLICATION_TAILS,
        ownership_module._INITIAL_PUBLICATION_ADOPTION_TAILS,
        ownership_module._PUBLICATION_SESSION_TAILS,
        stage_module._CURSOR_B2_FENCE_RETIREMENTS,
        stage_module._CURSOR_INITIAL_PUBLICATION_ADOPTION_TAILS,
        stage_module._CURSOR_PUBLICATION_SESSION_TAILS,
        stage_module._REGISTERED_SQLITE_V1_BASELINE_TEMP_STAGES,
        clock_module._CLOCK_SOURCES,
        clock_module._LOCK_CAPABILITIES,
        clock_module._CLOCK_CAPABILITIES,
        clock_module._EVIDENCE,
        clock_module._TOMBSTONES,
    )
    return tuple(len(registry) for registry in registries)


def test_complete_active_graph_is_collectable_without_registry_roots() -> None:
    for _ in range(3):
        gc.collect()
    baseline = _publication_graph_registry_sizes()
    graph = _AdoptionGraph(1)
    adoption = outer_module._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
        graph.authority,
        graph.bundle,
        graph.fence,
        graph.reader,
    )
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    authority_ref = ref(graph.authority)
    prepared_ref = ref(prepared)
    session_ref = ref(session)
    transfer_ref = ref(outer_module._authority_state(graph.authority).transfer)
    del session, evidence, prepared, adoption, graph
    for _ in range(12):
        gc.collect()
    assert authority_ref() is None
    assert prepared_ref() is None
    assert session_ref() is None
    assert transfer_ref() is None
    assert _publication_graph_registry_sizes() == baseline


def test_session_private_state_anchor_is_one_way_and_registry_authenticated(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    session_state_slot = "_SQLiteCursorPublicationSession__state"
    with pytest.raises(TypeError, match="PUBLICATION_SESSION_STATE"):
        setattr(session, session_state_slot, object())
    object.__setattr__(session, session_state_slot, object())
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION$"):
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(session)
    state = outer_module._authority_state(graph.authority)
    assert state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[state.transfer].lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"


def test_authority_session_state_anchor_replacement_poisons_every_owner(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    state = outer_module._authority_state(graph.authority)
    session_state_slot = (
        "_SQLiteCursorStageOwnershipOuterPublicationAuthority__publication_session_state"
    )
    with pytest.raises(TypeError, match="state is immutable"):
        setattr(graph.authority, session_state_slot, object())
    object.__setattr__(
        graph.authority,
        session_state_slot,
        object(),
    )
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION$"):
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(session)
    assert state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[state.transfer].lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"


@pytest.mark.parametrize("anchor_owner", ("authority", "session"))
def test_foreign_session_state_anchor_poisons_only_the_target_graph(
    session_graphs: Any,
    anchor_owner: str,
) -> None:
    target_graph, target_adoption = session_graphs()
    target_prepared, target_evidence = _prepare_and_observe(target_graph, target_adoption)
    target_session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(
        target_prepared, target_evidence
    )
    source_graph, source_adoption = session_graphs()
    source_prepared, source_evidence = _prepare_and_observe(source_graph, source_adoption)
    source_session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(
        source_prepared, source_evidence
    )
    target_outer_state = outer_module._authority_state(target_graph.authority)
    target_session_state = outer_module._publication_session_state(target_session)
    source_outer_state = outer_module._authority_state(source_graph.authority)
    source_session_state = outer_module._publication_session_state(source_session)

    if anchor_owner == "authority":
        object.__setattr__(
            target_graph.authority,
            "_SQLiteCursorStageOwnershipOuterPublicationAuthority__publication_session_state",
            source_session_state,
        )
    else:
        object.__setattr__(
            target_session,
            "_SQLiteCursorPublicationSession__state",
            source_session_state,
        )

    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_PUBLICATION_SESSION$"):
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(target_session)
    assert target_session_state.lifecycle == "poisoned"
    assert target_outer_state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[target_outer_state.transfer].lifecycle == "poisoned"
    assert target_graph.stage.state == "poisoned"

    assert source_session_state.lifecycle == "publication-active"
    assert source_outer_state.lifecycle == "active"
    assert source_outer_state.write_phase == "publication-active"
    assert (
        ownership_module._TRANSFERS[source_outer_state.transfer].lifecycle == "publication-active"
    )
    assert source_graph.stage.state == "open"
    assert source_graph.stage._cursor_outer_publication_state == "publication-active"
    assert (
        outer_module._assert_sqlite_cursor_outer_publication_authority_intrinsic(
            source_graph.authority
        )
        is source_graph.authority
    )
    assert (
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(source_session)
        is source_session
    )
    assert (
        outer_module._assert_sqlite_cursor_publication_session_intrinsic(source_session)
        is source_session
    )


def test_authority_private_state_anchor_replacement_poisons_every_owner(
    session_graphs: Any,
) -> None:
    graph, adoption = session_graphs()
    prepared, evidence = _prepare_and_observe(graph, adoption)
    outer_module._publish_sqlite_cursor_publication_session_intrinsic(prepared, evidence)
    state = outer_module._authority_state(graph.authority)
    publication_state_slot = (
        "_SQLiteCursorStageOwnershipOuterPublicationAuthority__publication_state"
    )
    with pytest.raises(TypeError, match="state is immutable"):
        setattr(graph.authority, publication_state_slot, object())
    object.__setattr__(
        graph.authority,
        publication_state_slot,
        object(),
    )
    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_AUTHORITY$"):
        outer_module._assert_sqlite_cursor_outer_publication_authority_intrinsic(graph.authority)
    assert state.lifecycle == "poisoned"
    assert ownership_module._TRANSFERS[state.transfer].lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"


def test_already_poisoned_outer_state_still_propagates_to_lower_owners(
    session_graphs: Any,
) -> None:
    graph, _adoption = session_graphs()
    state = outer_module._authority_state(graph.authority)
    transfer = ownership_module._TRANSFERS[state.transfer]
    state.lifecycle = "poisoned"

    with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_OUTER_POISONED$"):
        outer_module._assert_sqlite_cursor_outer_publication_authority_intrinsic(graph.authority)
    assert state.lifecycle == "poisoned"
    assert state.write_phase == "poisoned"
    assert transfer.lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"


def test_live_session_retains_the_complete_source_identity_graph() -> None:
    graph = _AdoptionGraph(1)
    stage = graph.stage
    connection = graph.connection
    try:
        adoption = outer_module._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
            graph.authority,
            graph.bundle,
            graph.fence,
            graph.reader,
        )
        prepared, evidence = _prepare_and_observe(graph, adoption)
        session = outer_module._publish_sqlite_cursor_publication_session_intrinsic(
            prepared, evidence
        )
        authority_ref = ref(graph.authority)
        adoption_ref = ref(adoption)
        prepared_ref = ref(prepared)
        del adoption, prepared, evidence, graph
        gc.collect()
        assert authority_ref() is not None
        assert adoption_ref() is not None
        assert prepared_ref() is not None
        assert outer_module._assert_sqlite_cursor_publication_session_intrinsic(session) is session
    finally:
        try:
            if connection.in_transaction:
                connection.rollback()
        finally:
            stage.dispose()
            connection.close()
