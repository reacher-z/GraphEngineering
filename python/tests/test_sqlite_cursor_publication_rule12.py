from __future__ import annotations

import gc
from dataclasses import replace
from importlib import import_module
from typing import Any, Never, cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_clock_authority as clock
import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_cursor_publication_rule12 as rule12
import graph_engineering.sqlite_cursor_publication_subprotocol as protocol
import graph_engineering.sqlite_cursor_publication_third_clock as third_clock
import graph_engineering.sqlite_operation_baseline_source as source
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_SEAL_EMPTY_ROOT,
)

_subprotocol_tests: Any = cast(
    Any,
    import_module("tests.test_sqlite_cursor_publication_subprotocol"),
)
_CursorAdoptionGraph = _subprotocol_tests._CursorAdoptionGraph
_session = _subprotocol_tests._session
_reporter: Any = cast(
    Any,
    import_module("tests.sqlite_cursor_publication_rule12_clock_report"),
)


@pytest.mark.parametrize("population", [0, 1, 3])
def test_rule12_real_sqlite_bounded_success(population: int) -> None:
    graph = _CursorAdoptionGraph(population)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        receipt = rule12._execute_sqlite_cursor_publication_rule12_intrinsic(
            predecessor
        )
        snapshot = (
            rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                receipt
            )
        )
        assert snapshot.rule_id == "BLR_CURSOR_SEAL_MISMATCH"
        assert snapshot.position == 12
        assert snapshot.rule11_receipt is predecessor
        assert snapshot.main_key_count == population
        assert snapshot.driver_count == population
        assert snapshot.lookup_count == population
        assert snapshot.receipt_count == population
        assert snapshot.accumulator_count == population
        assert snapshot.receipt_immutable_root_sha256 == (
            snapshot.computed_immutable_root_sha256
        )
        assert snapshot.point_statement_execute_count == population
        assert snapshot.point_cursor_created_count == population
        assert snapshot.point_cursor_closed_count == population
        assert snapshot.maximum_active_cursor_count <= 2
        assert snapshot.maximum_live_physical_row_count <= 1
        assert snapshot.maximum_live_carrier_count <= 1
        assert snapshot.violation_count == 0
        assert snapshot.diagnostics_truncated is False
        assert snapshot.total_changes_delta == 0
        seal = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            graph.connection, snapshot.seal_read_execution
        )
        if population == 0:
            assert seal.observed_descriptor_hash is None
            assert seal.observed_schema_identity_sha256 is None
            assert seal.computed_immutable_root_sha256 == SQLITE_CURSOR_SEAL_EMPTY_ROOT
    finally:
        graph.close()


def test_rule12_replay_is_terminal_and_mints_no_second_receipt() -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_RULE12_REPLAY$"):
            rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
        assert authority.write_phase == "poisoned"
    finally:
        graph.close()


def test_rule12_cancellation_after_rule11_poisons_and_mints_nothing() -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        baseline = len(rule12._RECEIPTS)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_RULE12_CANCELLED$"):
            rule12._execute_sqlite_cursor_publication_rule12_intrinsic(
                predecessor, controller.signal
            )
        assert len(rule12._RECEIPTS) == baseline
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
    finally:
        graph.close()


@pytest.mark.parametrize("population", [0, 1, 3])
def test_final_rule12_cancellation_happens_after_validation_before_mint(
    monkeypatch: pytest.MonkeyPatch,
    population: int,
) -> None:
    graph = _CursorAdoptionGraph(population)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        checks = iter((*([False] * (population + 2)), True))
        executions: list[Any] = []
        receipt_baseline = len(rule12._RECEIPTS)
        begin = rule12._begin_sqlite_connection_cursor_publication_seal_read_intrinsic

        def check(_signal: object) -> bool:
            return next(checks)

        def capture(*args: object, **kwargs: object) -> Any:
            execution = begin(*cast(Any, args), **cast(Any, kwargs))
            executions.append(execution)
            return execution

        monkeypatch.setattr(
            rule12,
            "_is_sqlite_cursor_publication_session_cancellation_requested_intrinsic",
            check,
        )
        monkeypatch.setattr(
            rule12,
            "_begin_sqlite_connection_cursor_publication_seal_read_intrinsic",
            capture,
        )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_RULE12_CANCELLED$"):
            rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
        assert len(executions) == 1
        seal = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            graph.connection, executions[0]
        )
        assert seal.lifecycle == "completed"
        assert seal.driver_terminal_fetch_count == 1
        assert seal.driver_close_count == 1
        assert seal.point_statement_release_count == 1
        assert seal.main_key_row_count == population
        assert seal.driver_row_count == population
        assert seal.lookup_row_count == population
        assert seal.accumulator_row_count == population
        assert seal.computed_immutable_root_sha256 is not None
        assert len(rule12._RECEIPTS) == receipt_baseline
    finally:
        graph.close()


def test_final_rule12_cancellation_primary_survives_poison_cleanup_fault(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        checks = iter((False, False, False, True))
        poison = protocol._poison_sqlite_cursor_publication_rebind_downstream_intrinsic

        def check(_signal: object) -> bool:
            return next(checks)

        def poison_then_fault(*args: object, **kwargs: object) -> Never:
            poison(*cast(Any, args), **cast(Any, kwargs))
            raise RuntimeError("cleanup fault")

        monkeypatch.setattr(
            rule12,
            "_is_sqlite_cursor_publication_session_cancellation_requested_intrinsic",
            check,
        )
        monkeypatch.setattr(
            protocol,
            "_poison_sqlite_cursor_publication_rebind_downstream_intrinsic",
            poison_then_fault,
        )
        baseline = len(rule12._RECEIPTS)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_RULE12_CANCELLED$"):
            rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
        assert len(rule12._RECEIPTS) == baseline
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
    finally:
        graph.close()


def test_rule12_cancellation_after_point_close_precedes_next_driver_fetch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _CursorAdoptionGraph(3)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        checks = iter((False, True))
        executions: list[Any] = []
        begin = rule12._begin_sqlite_connection_cursor_publication_seal_read_intrinsic

        def check(_signal: object) -> bool:
            return next(checks)

        def capture(*args: object, **kwargs: object) -> Any:
            execution = begin(*cast(Any, args), **cast(Any, kwargs))
            executions.append(execution)
            return execution

        monkeypatch.setattr(
            rule12,
            "_is_sqlite_cursor_publication_session_cancellation_requested_intrinsic",
            check,
        )
        monkeypatch.setattr(
            rule12,
            "_begin_sqlite_connection_cursor_publication_seal_read_intrinsic",
            capture,
        )
        baseline = len(rule12._RECEIPTS)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_RULE12_CANCELLED$"):
            rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
        seal = source._read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
            graph.connection, executions[0]
        )
        assert seal.lifecycle == "poisoned"
        assert seal.driver_row_count == 1
        assert seal.lookup_row_count == 1
        assert seal.point_cursor_closed_count == 1
        assert seal.driver_terminal_fetch_count == 0
        assert seal.driver_close_count == 1
        assert len(rule12._RECEIPTS) == baseline
    finally:
        graph.close()


def test_rule12_tampered_final_evidence_poisons_without_mint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        execute = rule12._execute_sqlite_connection_cursor_publication_seal_read_intrinsic

        def tamper(*args: object, **kwargs: object) -> Any:
            snapshot = execute(*cast(Any, args), **cast(Any, kwargs))
            return snapshot._replace(driver_row_count=snapshot.driver_row_count + 1)

        monkeypatch.setattr(
            rule12,
            "_execute_sqlite_connection_cursor_publication_seal_read_intrinsic",
            tamper,
        )
        baseline = len(rule12._RECEIPTS)
        with pytest.raises(
            ValueError, match=r"^GE_CURSOR_B3_RULE12_SEAL_MISMATCH$"
        ):
            rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
        assert len(rule12._RECEIPTS) == baseline
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
    finally:
        graph.close()


def test_rule12_receipt_is_opaque_and_not_root_exported() -> None:
    with pytest.raises(TypeError, match=r"^GE_CURSOR_B3_RULE12_RECEIPT$"):
        rule12._SQLiteCursorPublicationRule12SuccessReceipt(object())
    assert not hasattr(graph_engineering, "SQLiteCursorPublicationRule12SuccessReceipt")


def _accepted_rule12(graph: Any) -> Any:
    predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
        _session(graph)
    )
    return rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)


def test_third_clock_success_is_exact_unconsumed_three_over_two() -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        receipt = _accepted_rule12(graph)
        authorization_baseline = len(rule12._THIRD_AUTHORIZATIONS)
        evidence = third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
            receipt
        )
        assert len(rule12._THIRD_AUTHORIZATIONS) == authorization_baseline
        snapshot = (
            third_clock._read_sqlite_cursor_before_verification_clock_evidence_snapshot_intrinsic(
                receipt, evidence
            )
        )
        assert snapshot.boundary == "before-verification"
        assert snapshot.consumer == "cursor-clock-capability"
        assert snapshot.head_index == 3
        assert snapshot.consumed is False
        assert snapshot.rule12_receipt is receipt
        accepted = (
            rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                receipt
            )
        )
        assert accepted.lifecycle == "pre-verification-clock-read-unconsumed"
        assert accepted.pre_verification_clock_evidence is evidence
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.write_phase == "pre-verification-clock-read-unconsumed"
        assert authority.pre_verification_clock_evidence is evidence
    finally:
        graph.close()


@pytest.mark.parametrize(
    ("provider", "code"),
    [
        (lambda: (_ for _ in ()).throw(RuntimeError("offline")), "CLOCK_UNAVAILABLE"),
        (lambda: 2**53, "CLOCK_UNAVAILABLE"),
        (lambda: 0, "CLOCK_REGRESSION"),
    ],
)
def test_third_clock_provider_failures_poison_without_adoption(
    provider: Any,
    code: str,
) -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        receipt = _accepted_rule12(graph)
        accepted = (
            rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                receipt
            )
        )
        state = clock._CLOCK_CAPABILITIES[accepted.provider_clock_capability]
        clock._CLOCK_SOURCES[state.source] = provider
        authorization_baseline = len(rule12._THIRD_AUTHORIZATIONS)
        with pytest.raises(ValueError, match=f"^GE_CURSOR_B3_{code}$"):
            third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
                receipt
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
        assert authority.pre_verification_clock_evidence is None
        assert len(rule12._THIRD_AUTHORIZATIONS) == authorization_baseline
    finally:
        graph.close()


def test_third_clock_expiry_poison_without_adoption() -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        receipt = _accepted_rule12(graph)
        accepted = (
            rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                receipt
            )
        )
        state = clock._CLOCK_CAPABILITIES[accepted.provider_clock_capability]
        clock._CLOCK_SOURCES[state.source] = lambda: state.expected_lock.active_expires_at_ms
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_LOCK_EXPIRED$"):
            third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
                receipt
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
        assert authority.pre_verification_clock_evidence is None
    finally:
        graph.close()


def test_third_clock_replay_poisons_and_wrong_receipt_read_rejects() -> None:
    first = _CursorAdoptionGraph(1)
    second = _CursorAdoptionGraph(1)
    try:
        first_receipt = _accepted_rule12(first)
        second_receipt = _accepted_rule12(second)
        evidence = third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
            first_receipt
        )
        with pytest.raises(
            ValueError, match=r"^GE_CURSOR_B3_BEFORE_VERIFICATION_EVIDENCE$"
        ):
            third_clock._read_sqlite_cursor_before_verification_clock_evidence_snapshot_intrinsic(
                second_receipt, evidence
            )
        with pytest.raises(
            ValueError, match=r"^GE_CURSOR_B3_BEFORE_VERIFICATION_REPLAY$"
        ):
            third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
                first_receipt
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            first.authority
        )
        assert authority.lifecycle == "poisoned"
    finally:
        first.close()
        second.close()


def test_direct_generic_third_clock_bypass_is_rejected_then_wrapper_succeeds() -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        receipt = _accepted_rule12(graph)
        accepted = rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
            receipt
        )
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_ORDER$"):
            clock._observe_provider_clock_intrinsic(
                accepted.provider_clock_capability, "before-verification"
            )
        with pytest.raises(
            ValueError, match=r"^GE_CURSOR_B3_CLOCK_THIRD_AUTHORITY$"
        ):
            clock._observe_authorized_before_verification_clock_intrinsic(
                accepted.provider_clock_capability,
                accepted.pre_rebind_clock_evidence,
                receipt,
                object(),
            )
        evidence = third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
            receipt
        )
        result = (
            third_clock._read_sqlite_cursor_before_verification_clock_evidence_snapshot_intrinsic(
                receipt, evidence
            )
        )
        assert result.head_index == 3
        with pytest.raises(
            ValueError, match=r"^GE_CURSOR_B3_CLOCK_THIRD_CONSUME_UNAVAILABLE$"
        ):
            clock._consume_provider_clock_evidence_intrinsic(
                accepted.provider_clock_capability,
                evidence,
                "cursor-clock-capability",
            )
        state = clock._CLOCK_CAPABILITIES[accepted.provider_clock_capability]
        calls = 0

        def forbidden_fourth() -> int:
            nonlocal calls
            calls += 1
            return state.expected_lock.active_expires_at_ms - 1

        clock._CLOCK_SOURCES[state.source] = forbidden_fourth
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_ORDER$"):
            clock._observe_provider_clock_intrinsic(
                accepted.provider_clock_capability, "before-commit"
            )
        assert calls == 0
        assert state.next_boundary_index == 3
        assert state.poisoned is True
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_POISONED$"):
            clock._observe_provider_clock_intrinsic(
                accepted.provider_clock_capability, "before-commit"
            )
        assert calls == 0
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_RULE12_RECEIPT$"):
            rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                receipt
            )
    finally:
        graph.close()


def test_third_clock_cancellation_precedes_provider_callback() -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        receipt = _accepted_rule12(graph)
        accepted = rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
            receipt
        )
        state = clock._CLOCK_CAPABILITIES[accepted.provider_clock_capability]
        calls = 0

        def provider() -> int:
            nonlocal calls
            calls += 1
            return state.expected_lock.active_expires_at_ms - 1

        clock._CLOCK_SOURCES[state.source] = provider
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        with pytest.raises(
            ValueError, match=r"^GE_CURSOR_B3_BEFORE_VERIFICATION_CANCELLED$"
        ):
            third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
                receipt, controller.signal
            )
        assert calls == 0
        assert state.next_boundary_index == 2
        assert state.before_verification_authorized is False
    finally:
        graph.close()


@pytest.mark.parametrize("drift", ["live-lock", "transaction-epoch"])
def test_third_clock_selected_graph_drift_precedes_cancellation_and_provider(
    monkeypatch: pytest.MonkeyPatch,
    drift: str,
) -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        receipt = _accepted_rule12(graph)
        accepted = rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
            receipt
        )
        state = clock._CLOCK_CAPABILITIES[accepted.provider_clock_capability]
        provider_calls = 0

        def provider() -> int:
            nonlocal provider_calls
            provider_calls += 1
            return state.expected_lock.active_expires_at_ms - 1

        clock._CLOCK_SOURCES[state.source] = provider
        if drift == "live-lock":
            live_lock = clock._live_lock

            def changed_lock(connection: Any) -> Any:
                current = live_lock(connection)
                return replace(
                    current,
                    active_expires_at_ms=current.active_expires_at_ms + 1,
                )

            monkeypatch.setattr(clock, "_live_lock", changed_lock)
        else:
            descriptor = source.SQLiteV1BaselineConnectionOwner.transaction_epoch
            monkeypatch.setattr(
                source.SQLiteV1BaselineConnectionOwner,
                "transaction_epoch",
                property(lambda owner: descriptor.__get__(owner) + 1),
            )
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_THIRD_LINEAGE$"):
            third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
                receipt, controller.signal
            )
        assert provider_calls == 0
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
    finally:
        graph.close()


def test_third_clock_baseexception_clears_observing_and_poisons() -> None:
    class FatalProvider(BaseException):
        pass

    graph = _CursorAdoptionGraph(1)
    try:
        receipt = _accepted_rule12(graph)
        accepted = rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
            receipt
        )
        state = clock._CLOCK_CAPABILITIES[accepted.provider_clock_capability]

        def provider() -> int:
            raise FatalProvider("fatal")

        clock._CLOCK_SOURCES[state.source] = provider
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_UNAVAILABLE$") as error:
            third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
                receipt
            )
        assert isinstance(error.value.__cause__, FatalProvider)
        assert state.observing is False
        assert state.before_verification_authorized is False
        assert state.poisoned is True
    finally:
        graph.close()


@pytest.mark.parametrize("mode", ["sorter", "point"])
def test_real_eqp_uses_definition_time_intrinsics_despite_live_alias_tampering(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
) -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        session = _session(graph)
        def hostile(*_args: object, **_kwargs: object) -> Never:
            raise RuntimeError(mode)

        if mode == "sorter":
            monkeypatch.setattr(source, "_QUERY_PLAN_FETCHONE", hostile)
            monkeypatch.setattr(source, "_QUERY_PLAN_STR_JOIN", hostile)
            monkeypatch.setattr(source._SQLiteCursorCapability, "fetchone", hostile)
        else:
            monkeypatch.setattr(source, "_OWNER_EXECUTE_QUERY_PLAN", hostile)
            monkeypatch.setattr(source, "_QUERY_PLAN_CLOSE", hostile)
            monkeypatch.setattr(
                source.SQLiteV1BaselineConnectionOwner, "execute", hostile
            )
        before = graph.connection.total_changes
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        snapshot = protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
            predecessor
        )
        assert snapshot.position == 11
        assert graph.connection.total_changes == before + 1
        rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
    finally:
        monkeypatch.undo()
        graph.close()


@pytest.mark.parametrize("mode", ["sorter", "point"])
def test_real_eqp_rejection_occurs_before_rebind_execute(
    monkeypatch: pytest.MonkeyPatch,
    mode: str,
) -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        session = _session(graph)
        fetchone = source._QUERY_PLAN_FETCHONE
        rows = 0

        def hostile(cursor: Any) -> Any:
            nonlocal rows
            row = fetchone(cursor)
            if row is not None:
                rows += 1
                if mode == "sorter" and rows == 1:
                    return (*row[:3], "USE TEMP B-TREE FOR ORDER BY")
                if mode == "point" and rows == 3:
                    return (*row[:3], "SCAN main.ge_cycle_cursors")
            return row

        def injected(connection: Any) -> Any:
            return source._read_sqlite_connection_cursor_publication_seal_query_plans_intrinsic(
                connection, _fetchone=hostile
            )

        monkeypatch.setattr(
            outer,
            "_read_sqlite_connection_cursor_publication_seal_query_plans_intrinsic",
            injected,
        )
        before = graph.connection.total_changes
        expected = (
            "GE_CURSOR_B3_CURSOR_SEAL_QUERY_PLAN_FORBIDDEN"
            if mode == "sorter"
            else "GE_CURSOR_B3_CURSOR_SEAL_QUERY_PLAN_IDENTITY"
        )
        with pytest.raises(ValueError, match=f"^{expected}$"):
            protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
                session
            )
        assert graph.connection.total_changes == before
    finally:
        graph.close()


def test_real_eqp_fetch_primary_survives_cursor_close_cleanup_fault() -> None:
    graph = _CursorAdoptionGraph(0)
    try:
        def fetch_fail(_cursor: object) -> Never:
            raise RuntimeError("eqp fetch primary")

        def close_fail(_cursor: object) -> Never:
            raise RuntimeError("eqp close cleanup")

        with pytest.raises(RuntimeError, match=r"^eqp fetch primary$"):
            source._read_sqlite_connection_cursor_publication_seal_query_plans_intrinsic(
                graph.connection,
                _fetchone=fetch_fail,
                _close=close_fail,
            )
    finally:
        graph.close()


@pytest.mark.parametrize("drift", ["lock", "catalog", "lineage"])
def test_rule12_current_entry_proof_precedes_already_requested_cancellation(
    drift: str,
) -> None:
    graph = _CursorAdoptionGraph(1)
    original_generation = graph.connection._transaction_generation
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        clock_state = clock._CLOCK_CAPABILITIES[authority.provider_clock_capability]
        provider_calls = 0

        def provider() -> int:
            nonlocal provider_calls
            provider_calls += 1
            return 0

        clock._CLOCK_SOURCES[clock_state.source] = provider
        raw = object.__getattribute__(
            graph.connection, "_SQLiteV1BaselineConnectionOwner__connection"
        )
        if drift == "lock":
            raw.execute(
                "UPDATE main.ge_cycle_migration_lock "
                "SET active_owner_id = 'drifted-after-cancel' WHERE singleton = 1"
            ).close()
        elif drift == "catalog":
            raw.execute("PRAGMA user_version = 99").close()
        else:
            object.__setattr__(
                graph.connection,
                "_SQLiteV1BaselineConnectionOwner__transaction_generation",
                object(),
            )
        receipt_baseline = len(rule12._RECEIPTS)
        with pytest.raises(ValueError) as raised:
            rule12._execute_sqlite_cursor_publication_rule12_intrinsic(
                predecessor, controller.signal
            )
        assert str(raised.value) == {
            "lock": "GE_CURSOR_B3_OUTER_LEDGER_DRIFT",
            "catalog": "GE_CURSOR_B3_TARGET_CATALOG_MISMATCH",
            "lineage": "GE_CURSOR_B3_OUTER_STALE_FENCE",
        }[drift]
        assert len(rule12._RECEIPTS) == receipt_baseline
        assert provider_calls == 0
    finally:
        object.__setattr__(
            graph.connection,
            "_SQLiteV1BaselineConnectionOwner__transaction_generation",
            original_generation,
        )
        graph.close()


@pytest.mark.parametrize("failure", ["registration", "outer-adoption"])
def test_rule12_registration_and_outer_adoption_failures_poison_real_r11(
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )

        def fail(*_args: object, **_kwargs: object) -> Never:
            raise RuntimeError(failure)

        target = (
            "_register_receipt"
            if failure == "registration"
            else "_adopt_sqlite_cursor_rule12_seal_acceptance_intrinsic"
        )
        monkeypatch.setattr(rule12, target, fail)
        with pytest.raises(RuntimeError, match=f"^{failure}$"):
            rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_RULE11_RECEIPT$"):
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                predecessor
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
    finally:
        graph.close()


@pytest.mark.parametrize(
    "target",
    [
        "_register_binding",
        "_adopt_sqlite_cursor_publication_rule12_pre_verification_clock_evidence_intrinsic",
        "_bind_selected_rule12_third_evidence_intrinsic",
    ],
)
def test_third_registration_and_adoption_failures_are_atomic(
    monkeypatch: pytest.MonkeyPatch,
    target: str,
) -> None:
    graph = _CursorAdoptionGraph(1)
    try:
        receipt = _accepted_rule12(graph)
        accepted = rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
            receipt
        )
        for _ in range(3):
            gc.collect()
        third_clock._purge_dead_evidence_bindings_intrinsic()
        binding_baseline = len(third_clock._EVIDENCE_BINDINGS)
        authorization_baseline = len(rule12._THIRD_AUTHORIZATIONS)

        captured: list[Any] = []

        def fail(*args: object, **_kwargs: object) -> Never:
            captured.extend(arg for arg in args if type(arg) is clock._ClockEvidence)
            raise RuntimeError(target)

        monkeypatch.setattr(third_clock, target, fail)
        with pytest.raises(RuntimeError, match=f"^{target}$"):
            third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
                receipt
            )
        assert len(third_clock._EVIDENCE_BINDINGS) == binding_baseline
        assert len(rule12._THIRD_AUTHORIZATIONS) == authorization_baseline
        assert len(captured) == 1
        state = clock._CLOCK_CAPABILITIES[accepted.provider_clock_capability]
        assert state.poisoned is True
        assert state.before_verification_authorized is False
        assert state.selected_rule12_receipt is None
        assert state.selected_third_evidence is None
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_EVIDENCE$"):
            clock._read_clock_evidence_snapshot_intrinsic(
                accepted.provider_clock_capability, captured[0]
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
        with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_RULE12_RECEIPT$"):
            rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                receipt
            )
    finally:
        graph.close()


@pytest.mark.parametrize("poison_after_third", [False, True])
def test_rule12_third_graph_collects_to_registry_baselines(
    poison_after_third: bool,
) -> None:
    for _ in range(3):
        gc.collect()
    third_clock._purge_dead_evidence_bindings_intrinsic()
    receipt_baseline = len(rule12._RECEIPTS)
    binding_baseline = len(third_clock._EVIDENCE_BINDINGS)
    rule11_baseline = len(protocol._RULE11_RECEIPTS)

    def run() -> tuple[Any, Any, Any]:
        graph = _CursorAdoptionGraph(1)
        try:
            predecessor = (
                protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
                    _session(graph)
                )
            )
            receipt = rule12._execute_sqlite_cursor_publication_rule12_intrinsic(
                predecessor
            )
            evidence = (
                third_clock._observe_sqlite_cursor_before_verification_clock_intrinsic(
                    receipt
                )
            )
            if poison_after_third:
                with pytest.raises(ValueError, match=r"^GE_CURSOR_B3_CLOCK_ORDER$"):
                    clock._observe_provider_clock_intrinsic(
                        rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                            receipt
                        ).provider_clock_capability,
                        "before-commit",
                    )
            return ref(predecessor), ref(receipt), ref(evidence)
        finally:
            graph.close()

    predecessor_ref, receipt_ref, evidence_ref = run()
    for _ in range(3):
        gc.collect()
    assert predecessor_ref() is None
    assert receipt_ref() is None
    assert evidence_ref() is None
    assert len(rule12._RECEIPTS) == receipt_baseline
    assert len(third_clock._EVIDENCE_BINDINGS) == binding_baseline
    assert len(protocol._RULE11_RECEIPTS) == rule11_baseline


def test_reporter_rejects_a_named_failure_that_did_not_actually_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        _reporter.rule12,
        "_execute_sqlite_cursor_publication_rule12_intrinsic",
        lambda *_args, **_kwargs: object(),
    )
    with pytest.raises(
        RuntimeError,
        match=r"^replay produced None, expected 'GE_CURSOR_B3_RULE12_REPLAY'$",
    ):
        _reporter._failure("replay")


def test_third_authorization_stale_callback_cannot_delete_colliding_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = _CursorAdoptionGraph(0)
    second = _CursorAdoptionGraph(0)
    try:
        first_receipt = _accepted_rule12(first)
        second_receipt = _accepted_rule12(second)
        second_snapshot = (
            rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                second_receipt
            )
        )
        monkeypatch.setattr(rule12, "_ID", lambda _value: 17)
        rule12._prepare_sqlite_cursor_rule12_third_observation_authorization_intrinsic(
            first_receipt
        )
        old_entry = rule12._THIRD_AUTHORIZATIONS[17]
        old_callback = old_entry.key_ref.__callback__
        assert old_callback is not None
        rule12._clear_third_authorization(rule12._record_for(first_receipt))
        new = (
            rule12._prepare_sqlite_cursor_rule12_third_observation_authorization_intrinsic(
                second_receipt
            )
        )
        new_entry = rule12._THIRD_AUTHORIZATIONS[17]
        old_callback(old_entry.key_ref)
        assert rule12._THIRD_AUTHORIZATIONS[17] is new_entry
        assert rule12._verify_sqlite_cursor_rule12_third_observation_authorization_intrinsic(
            second_receipt,
            new,
            second_snapshot.provider_clock_capability,
            second_snapshot.pre_rebind_clock_evidence,
        )
        rule12._clear_third_authorization(rule12._record_for(second_receipt))
    finally:
        monkeypatch.undo()
        first.close()
        second.close()


def test_third_evidence_binding_stale_callback_cannot_delete_colliding_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = _CursorAdoptionGraph(0)
    second = _CursorAdoptionGraph(0)
    try:
        first_receipt = _accepted_rule12(first)
        second_receipt = _accepted_rule12(second)
        old = clock._ClockEvidence(clock._CONSTRUCTION_TOKEN)
        new = clock._ClockEvidence(clock._CONSTRUCTION_TOKEN)
        monkeypatch.setattr(third_clock, "_ID", lambda _value: 23)
        third_clock._register_binding(old, first_receipt)
        old_entry = third_clock._EVIDENCE_BINDINGS[23]
        old_callback = old_entry.key_ref.__callback__
        assert old_callback is not None
        third_clock._discard_binding_if_owned(first_receipt, old)
        third_clock._register_binding(new, second_receipt)
        new_entry = third_clock._EVIDENCE_BINDINGS[23]
        old_callback(old_entry.key_ref)
        assert third_clock._EVIDENCE_BINDINGS[23] is new_entry
        third_clock._binding_for(second_receipt, new)
        third_clock._discard_binding_if_owned(second_receipt, new)
    finally:
        monkeypatch.undo()
        first.close()
        second.close()
