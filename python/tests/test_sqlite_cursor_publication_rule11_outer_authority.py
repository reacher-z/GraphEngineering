from __future__ import annotations

import gc
from collections.abc import Callable, Iterator
from importlib import import_module
from typing import Any, cast
from weakref import ReferenceType, ref

import pytest

import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_operation_baseline_source as source

_AdoptionGraph: Any = cast(
    Any,
    import_module("tests.test_sqlite_cursor_publication_initial_stage_adoption"),
)._AdoptionGraph


def _expect(code: str) -> pytest.RaisesExc[ValueError]:
    return pytest.raises(ValueError, match=f"^{code}$")


@pytest.fixture
def graphs() -> Iterator[Callable[[int], Any]]:
    retained: list[Any] = []

    def create(legacy_count: int = 0) -> Any:
        graph = _AdoptionGraph(legacy_count)
        retained.append(graph)
        return graph

    yield create
    for graph in reversed(retained):
        graph.close()


def _active_session(graph: Any) -> Any:
    adoption = outer._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
        graph.authority, graph.bundle, graph.fence, graph.reader
    )
    prepared = outer._prepare_sqlite_cursor_publication_session_intrinsic(
        graph.authority, adoption
    )
    evidence = outer._observe_sqlite_cursor_publication_session_clock_intrinsic(
        prepared
    )
    return cast(Any, outer._publish_sqlite_cursor_publication_session_intrinsic)(
        prepared, evidence
    )


def _prepared_context(graph: Any) -> tuple[Any, Any, Any, Any]:
    session = _active_session(graph)
    execution = source._prepare_sqlite_connection_cursor_publication_rebind_intrinsic(
        graph.connection
    )
    context = outer._prepare_sqlite_cursor_publication_rebind_context_intrinsic(
        session, execution
    )
    snapshot = outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        context
    )
    return session, execution, context, snapshot


def _complete(
    graph: Any, execution: Any, parameters: tuple[str, str, str, str]
) -> Any:
    source._execute_sqlite_connection_cursor_publication_rebind_intrinsic(
        graph.connection, execution, *parameters
    )
    source._release_sqlite_connection_cursor_publication_rebind_intrinsic(
        graph.connection, execution
    )
    return source._prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic(
        graph.connection, execution
    )


def test_zero_row_t_a_chain_adopts_exact_e_and_repeat_a_is_zero_io(
    graphs: Callable[[int], Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    graph = graphs(0)
    session, execution, context, prepared = _prepared_context(graph)
    session_snapshot = (
        outer._read_sqlite_cursor_publication_session_snapshot_intrinsic(session)
    )
    initial_adoption = session_snapshot.adoption_receipt
    before_outer = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        graph.authority
    ).outer_ledger

    assert prepared.lifecycle == "prepared"
    assert prepared.session is session
    assert prepared.execution is execution
    assert prepared.prepared_execution_snapshot.lifecycle == "prepared"
    assert prepared.prepared_execution_snapshot.transaction_epoch == (
        prepared.historical_transaction_epoch
    )
    assert prepared.prepared_execution_snapshot.total_changes == (
        prepared.historical_total_changes
    )
    assert prepared.prepared_owner is not session_snapshot.prepared_owner
    assert (
        outer._assert_sqlite_cursor_publication_rebind_prepared_owner_intrinsic(
            prepared.prepared_owner
        )
        is prepared.prepared_owner
    )

    tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
        context
    )
    consumed = (
        outer._read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic(
            tombstone
        )
    )
    assert consumed.lifecycle == "active"
    assert consumed.context is context
    assert consumed.prepared_owner is prepared.prepared_owner

    def read_consumed_historical_without_io() -> Any:
        def forbidden_consumed(*_args: object, **_kwargs: object) -> Any:
            raise AssertionError("consumed historical receipt performed live I/O")

        with monkeypatch.context() as isolated:
            for name in (
                "_OWNER_GENERATION",
                "_OWNER_EPOCH",
                "_OWNER_TOTAL_CHANGES",
                "_OWNER_EXCLUSIVE",
                "_LIVE_LOCK",
                "_READ_VALIDATED_TARGET_CATALOG",
                "_READ_CURSOR_PUBLICATION_REBIND_PROGRESS",
                "_READ_CLOCK_EVIDENCE",
            ):
                isolated.setattr(outer, name, forbidden_consumed)
            return (
                outer._read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic(
                    initial_adoption
                )
            )

    historical_before_native = read_consumed_historical_without_io()
    assert historical_before_native.adopted_transaction_epoch == (
        prepared.historical_transaction_epoch
    )
    assert historical_before_native.adopted_total_changes == (
        prepared.historical_total_changes
    )
    completed = _complete(graph, execution, prepared.parameter_values)
    assert read_consumed_historical_without_io() == historical_before_native
    adoption = outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
        context, tombstone, execution
    )
    adopted = outer._read_sqlite_cursor_post_rebind_watermark_adoption_snapshot_intrinsic(
        adoption
    )
    assert completed.lifecycle == "completed"
    assert adopted.execution_snapshot == completed
    assert adopted.historical_transaction_epoch == prepared.historical_transaction_epoch
    assert adopted.adopted_transaction_epoch == prepared.historical_transaction_epoch + 1
    assert adopted.historical_total_changes == prepared.historical_total_changes
    assert adopted.adopted_total_changes == prepared.historical_total_changes
    assert adopted.total_changes_delta == adopted.affected_rows == 0
    assert adopted.historical_outer_ledger == adopted.adopted_outer_ledger == before_outer
    assert (
        outer._assert_sqlite_cursor_outer_publication_authority_intrinsic(
            graph.authority
        )
        is graph.authority
    )

    def forbidden(*_args: object, **_kwargs: object) -> Any:
        raise AssertionError("repeat A assertion performed live I/O")

    for name in (
        "_OWNER_GENERATION",
        "_OWNER_EPOCH",
        "_OWNER_TOTAL_CHANGES",
        "_OWNER_EXCLUSIVE",
        "_LIVE_LOCK",
        "_READ_VALIDATED_TARGET_CATALOG",
        "_READ_CURSOR_PUBLICATION_REBIND_PROGRESS",
        "_READ_CLOCK_EVIDENCE",
    ):
        monkeypatch.setattr(outer, name, forbidden)
    assert (
        outer._assert_sqlite_cursor_post_rebind_watermark_adoption_intrinsic(
            adoption
        )
        is adoption
    )
    assert (
        outer._read_sqlite_cursor_post_rebind_watermark_adoption_snapshot_intrinsic(
            adoption
        )
        == adopted
    )
    assert (
        outer._assert_sqlite_cursor_publication_rebind_prepared_owner_identity_intrinsic(
            prepared.prepared_owner
        )
        is prepared.prepared_owner
    )
    with _expect("GE_CURSOR_B3_PUBLICATION_REBIND_PREPARED_OWNER"):
        outer._assert_sqlite_cursor_publication_rebind_prepared_owner_intrinsic(
            prepared.prepared_owner
        )
    historical = (
        outer._read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic(
            initial_adoption
        )
    )
    assert historical.adopted_transaction_epoch == adopted.historical_transaction_epoch
    assert historical.adopted_total_changes == adopted.historical_total_changes
    assert historical.adopted_outer_ledger == adopted.historical_outer_ledger


def test_outer_authenticated_preconsume_release_allows_fresh_p_e_retry(
    graphs: Callable[[int], Any]
) -> None:
    graph = graphs(1)
    session, execution, context, prepared = _prepared_context(graph)
    forged_owner = object.__new__(type(prepared.prepared_owner))
    with _expect("GE_CURSOR_B3_PUBLICATION_REBIND_PREPARED_OWNER"):
        outer._assert_sqlite_cursor_publication_rebind_prepared_owner_identity_intrinsic(
            forged_owner
        )
    assert outer._authority_state(graph.authority).lifecycle == "active"
    assert (
        outer._release_sqlite_cursor_publication_rebind_context_before_consume_intrinsic(
            context, prepared.prepared_owner
        )
        is context
    )
    released = outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        context
    )
    assert released.lifecycle == "released-before-write"
    released_execution = (
        source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            graph.connection, execution
        )
    )
    assert released_execution.lifecycle == "released"
    assert released_execution.execute_count == 0
    assert (
        outer._assert_sqlite_cursor_publication_rebind_prepared_owner_identity_intrinsic(
            prepared.prepared_owner
        )
        is prepared.prepared_owner
    )
    with _expect("GE_CURSOR_B3_PUBLICATION_REBIND_PREPARED_OWNER"):
        outer._assert_sqlite_cursor_publication_rebind_prepared_owner_intrinsic(
            prepared.prepared_owner
        )

    retry_execution = (
        source._prepare_sqlite_connection_cursor_publication_rebind_intrinsic(
            graph.connection
        )
    )
    retry_context = outer._prepare_sqlite_cursor_publication_rebind_context_intrinsic(
        session, retry_execution
    )
    retry = outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        retry_context
    )
    assert retry_context is not context
    assert retry.prepared_owner is not prepared.prepared_owner
    assert (
        outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
            context
        ).lifecycle
        == "released-before-write"
    )
    tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
        retry_context
    )
    _complete(graph, retry_execution, retry.parameter_values)
    adoption = outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
        retry_context, tombstone, retry_execution
    )
    assert (
        outer._read_sqlite_cursor_post_rebind_watermark_adoption_snapshot_intrinsic(
            adoption
        ).affected_rows
        == 0
    )


def test_context_three_edge_registration_rolls_back_and_same_s_e_retry(
    graphs: Callable[[int], Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    class Marker(BaseException):
        pass

    graph = graphs(0)
    session = _active_session(graph)
    execution = source._prepare_sqlite_connection_cursor_publication_rebind_intrinsic(
        graph.connection
    )
    register_link = outer._REGISTER_PUBLICATION_REBIND_LINK
    link_calls = 0

    def register_link_then_fail(*args: object) -> None:
        nonlocal link_calls
        register_link(*cast(Any, args))
        link_calls += 1
        if link_calls == 2:
            raise Marker

    monkeypatch.setattr(
        outer, "_REGISTER_PUBLICATION_REBIND_LINK", register_link_then_fail
    )
    with pytest.raises(Marker):
        outer._prepare_sqlite_cursor_publication_rebind_context_intrinsic(
            session, execution
        )
    state = outer._authority_state(graph.authority)
    assert state.lifecycle == "active"
    assert state.write_phase == "publication-active"
    assert state.publication_rebind_context is None
    assert state.publication_rebind_context_state is None
    assert outer._assert_sqlite_cursor_publication_session_intrinsic(session) is session
    assert (
        source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            graph.connection, execution
        ).lifecycle
        == "prepared"
    )
    assert (
        outer._rebind_link_get(
            outer._PUBLICATION_REBIND_CONTEXT_BY_SESSION, session
        )
        is None
    )

    monkeypatch.setattr(outer, "_REGISTER_PUBLICATION_REBIND_LINK", register_link)
    context = outer._prepare_sqlite_cursor_publication_rebind_context_intrinsic(
        session, execution
    )
    assert (
        outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
            context
        ).execution
        is execution
    )


def test_preconsume_release_failure_is_poisoning_and_preserves_baseexception(
    graphs: Callable[[int], Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    class Marker(BaseException):
        pass

    graph = graphs(0)
    _session, _execution, context, prepared = _prepared_context(graph)

    def fail_release(*_args: object) -> Any:
        raise Marker

    monkeypatch.setattr(outer, "_RELEASE_CURSOR_PUBLICATION_REBIND", fail_release)
    with pytest.raises(Marker):
        outer._release_sqlite_cursor_publication_rebind_context_before_consume_intrinsic(
            context, prepared.prepared_owner
        )
    assert outer._authority_state(graph.authority).lifecycle == "poisoned"
    assert (
        outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
            context
        ).lifecycle
        == "poisoned"
    )


def test_t_registration_failure_rolls_back_and_exact_context_retries(
    graphs: Callable[[int], Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    class Marker(BaseException):
        pass

    graph = graphs(0)
    session, _execution, context, _prepared = _prepared_context(graph)
    register = outer._REGISTER_PUBLICATION_REBIND_TOMBSTONE

    def register_then_fail(*args: object) -> None:
        register(*cast(Any, args))
        raise Marker

    monkeypatch.setattr(
        outer, "_REGISTER_PUBLICATION_REBIND_TOMBSTONE", register_then_fail
    )
    with pytest.raises(Marker):
        outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(context)
    state = outer._authority_state(graph.authority)
    context_snapshot = (
        outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(context)
    )
    assert state.lifecycle == "active"
    assert state.write_phase == "publication-active"
    assert state.publication_session_consumed_tombstone is None
    assert context_snapshot.lifecycle == "prepared"
    assert outer._assert_sqlite_cursor_publication_session_intrinsic(session) is session

    monkeypatch.setattr(outer, "_REGISTER_PUBLICATION_REBIND_TOMBSTONE", register)
    tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
        context
    )
    assert (
        outer._assert_sqlite_cursor_publication_session_consumed_tombstone_intrinsic(
            tombstone
        )
        is tombstone
    )


def test_consumed_s_is_dead_and_incomplete_e_adoption_poisons(
    graphs: Callable[[int], Any]
) -> None:
    old_graph = graphs(0)
    session, _execution, context, _prepared = _prepared_context(old_graph)
    outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(context)
    with _expect("GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH"):
        outer._assert_sqlite_cursor_publication_session_intrinsic(session)
    assert outer._authority_state(old_graph.authority).lifecycle == "poisoned"

    incomplete_graph = graphs(0)
    _session, execution, context, _prepared = _prepared_context(incomplete_graph)
    tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
        context
    )
    with _expect("GE_CURSOR_B3_POST_REBIND_ADOPTION_GRAPH"):
        outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
            context, tombstone, execution
        )
    state = outer._authority_state(incomplete_graph.authority)
    assert state.lifecycle == "poisoned"
    assert state.publication_rebind_context_state is not None
    assert state.publication_rebind_context_state.lifecycle == "poisoned"
    assert state.publication_rebind_context_state.tombstone_state is not None
    assert state.publication_rebind_context_state.tombstone_state.lifecycle == "poisoned"


def test_cross_graph_bridge_misuse_is_healthy_then_exact_bridge_poisons(
    graphs: Callable[[int], Any]
) -> None:
    first = graphs(0)
    second = graphs(0)
    _s1, e1, c1, p1 = _prepared_context(first)
    _s2, _e2, c2, _p2 = _prepared_context(second)
    t1 = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(c1)
    t2 = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(c2)

    with _expect("GE_CURSOR_B3_PUBLICATION_REBIND_DOWNSTREAM_SUBSTITUTION"):
        outer._poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
            c1, t2, "foreign tombstone"
        )
    assert outer._authority_state(first.authority).lifecycle == "active"
    _complete(first, e1, p1.parameter_values)
    adoption = outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(c1, t1, e1)
    with _expect("GE_CURSOR_B3_PUBLICATION_REBIND_DOWNSTREAM_PHASE"):
        outer._poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
            c1, t1, "missing adoption"
        )
    assert outer._authority_state(first.authority).lifecycle == "active"
    outer._poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
        c1, t1, "authenticated downstream failure", adoption
    )
    assert outer._authority_state(first.authority).lifecycle == "poisoned"
    assert outer._authority_state(second.authority).lifecycle == "active"


def test_duplicate_context_consume_and_adoption_replay_are_terminal(
    graphs: Callable[[int], Any]
) -> None:
    duplicate_graph = graphs(0)
    session, _execution, _context, _prepared = _prepared_context(duplicate_graph)
    second_execution = (
        source._prepare_sqlite_connection_cursor_publication_rebind_intrinsic(
            duplicate_graph.connection
        )
    )
    with _expect("GE_CURSOR_B3_PUBLICATION_REBIND_CONTEXT_REUSE"):
        outer._prepare_sqlite_cursor_publication_rebind_context_intrinsic(
            session, second_execution
        )
    assert outer._authority_state(duplicate_graph.authority).lifecycle == "poisoned"

    consume_graph = graphs(0)
    _session, _execution, context, _prepared = _prepared_context(consume_graph)
    outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(context)
    with _expect("GE_CURSOR_B3_PUBLICATION_REBIND_CONSUME"):
        outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(context)
    assert outer._authority_state(consume_graph.authority).lifecycle == "poisoned"

    adoption_graph = graphs(0)
    _session, execution, context, prepared = _prepared_context(adoption_graph)
    tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
        context
    )
    _complete(adoption_graph, execution, prepared.parameter_values)
    adoption = outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
        context, tombstone, execution
    )
    with _expect("GE_CURSOR_B3_POST_REBIND_ADOPTION_REUSE"):
        outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
            context, tombstone, execution
        )
    state = outer._authority_state(adoption_graph.authority)
    assert state.lifecycle == "poisoned"
    assert state.publication_rebind_context_state is not None
    assert state.publication_rebind_context_state.adoption is adoption
    assert state.publication_rebind_context_state.adoption_state is not None
    assert state.publication_rebind_context_state.adoption_state.lifecycle == "poisoned"


def test_consume_to_a_window_forbids_generic_assert_and_a_preserves_baseexception(
    graphs: Callable[[int], Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    misuse_graph = graphs(0)
    _session, execution, context, prepared = _prepared_context(misuse_graph)
    outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(context)
    _complete(misuse_graph, execution, prepared.parameter_values)
    with _expect("GE_CURSOR_B3_OUTER_LEDGER_DRIFT"):
        outer._assert_sqlite_cursor_outer_publication_authority_intrinsic(
            misuse_graph.authority
        )
    assert outer._authority_state(misuse_graph.authority).lifecycle == "poisoned"

    class Marker(BaseException):
        pass

    read_catalog = outer._READ_VALIDATED_TARGET_CATALOG
    failure_graph = graphs(0)
    _session, execution, context, prepared = _prepared_context(failure_graph)
    tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
        context
    )
    _complete(failure_graph, execution, prepared.parameter_values)

    def fail_catalog(*_args: object) -> Any:
        raise Marker

    monkeypatch.setattr(outer, "_READ_VALIDATED_TARGET_CATALOG", fail_catalog)
    with pytest.raises(Marker):
        outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
            context, tombstone, execution
        )
    state = outer._authority_state(failure_graph.authority)
    assert state.lifecycle == "poisoned"
    assert state.publication_rebind_context_state is not None
    assert state.publication_rebind_context_state.lifecycle == "poisoned"
    assert state.publication_rebind_context_state.tombstone_state is not None
    assert state.publication_rebind_context_state.tombstone_state.lifecycle == "poisoned"

    monkeypatch.setattr(outer, "_READ_VALIDATED_TARGET_CATALOG", read_catalog)
    registry_graph = graphs(0)
    _session, execution, context, prepared = _prepared_context(registry_graph)
    tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
        context
    )
    _complete(registry_graph, execution, prepared.parameter_values)
    register_adoption = outer._REGISTER_POST_REBIND_ADOPTION

    def register_adoption_then_fail(*args: object) -> None:
        register_adoption(*cast(Any, args))
        raise Marker

    monkeypatch.setattr(
        outer, "_REGISTER_POST_REBIND_ADOPTION", register_adoption_then_fail
    )
    with pytest.raises(Marker):
        outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
            context, tombstone, execution
        )
    state = outer._authority_state(registry_graph.authority)
    assert state.lifecycle == "poisoned"
    assert state.publication_rebind_context_state is not None
    assert state.publication_rebind_context_state.lifecycle == "poisoned"
    assert state.publication_rebind_context_state.tombstone_state is not None
    assert state.publication_rebind_context_state.tombstone_state.lifecycle == "poisoned"


def test_opaque_forgery_and_rebind_registries_do_not_root_completed_graphs() -> None:
    for constructor in (
        outer._SQLiteCursorPublicationRebindContext,
        outer._SQLiteCursorPublicationRebindPreparedOwner,
        outer._SQLiteCursorPublicationSessionConsumedTombstone,
        outer._SQLiteCursorPostRebindWatermarkAdoption,
    ):
        with pytest.raises(TypeError):
            constructor(object())

    for _ in range(3):
        gc.collect()
    registries = (
        outer._PUBLICATION_REBIND_CONTEXTS,
        outer._PUBLICATION_REBIND_CONTEXT_BY_SESSION,
        outer._PUBLICATION_REBIND_CONTEXT_BY_PREPARED_OWNER,
        outer._PUBLICATION_SESSION_CONSUMED_TOMBSTONES,
        outer._POST_REBIND_WATERMARK_ADOPTIONS,
    )
    baseline = tuple(len(registry) for registry in registries)

    def completed_refs() -> tuple[list[ReferenceType[Any]], tuple[int, ...]]:
        graph = _AdoptionGraph(0)
        session, execution, context, prepared = _prepared_context(graph)
        tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
            context
        )
        _complete(graph, execution, prepared.parameter_values)
        adoption = outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
            context, tombstone, execution
        )
        values = (
            graph.authority,
            session,
            execution,
            context,
            prepared.prepared_owner,
            tombstone,
            adoption,
        )
        return [ref(value) for value in values], tuple(id(value) for value in values)

    weak, identities = completed_refs()
    for _ in range(12):
        gc.collect()
    assert all(item() is None for item in weak)
    assert tuple(len(registry) for registry in registries) == baseline
    for registry in registries:
        assert all(identity not in registry for identity in identities)
