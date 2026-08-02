from __future__ import annotations

import builtins
import gc
import sqlite3
from importlib import import_module
from typing import Any, cast
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_cursor_publication_subprotocol as protocol
import graph_engineering.sqlite_operation_baseline_source as source
from graph_engineering.canonical import canonical_bytes
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    _create_migration_lock_capability_intrinsic,
    _create_provider_clock_capability_intrinsic,
    _create_provider_clock_source_intrinsic,
    _MigrationLockIdentity,
    _observe_provider_clock_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_initial_write_digest import (
    _digest_sqlite_initial_write_parameters_intrinsic,
)
from graph_engineering.sqlite_operation_baseline_cursor_campaign import (
    SQLiteCursorPreRebindComplete,
    _run_sqlite_cursor_pre_rebind_campaign,
)
from graph_engineering.sqlite_operation_baseline_cursor_stage_ownership import (
    _begin_sqlite_cursor_stage_ownership_transfer,
    _create_sqlite_cursor_seal_temp_table,
)

_AdoptionGraph: Any = cast(
    Any,
    import_module("tests.test_sqlite_cursor_publication_initial_stage_adoption"),
)._AdoptionGraph
_cursor_campaign_test_module: Any = cast(
    Any,
    import_module("tests.test_sqlite_operation_baseline_cursor_campaign"),
)
_legacy_invariants_test_module: Any = cast(
    Any,
    import_module("tests.test_sqlite_operation_baseline_legacy_invariants"),
)


def _prepared_cursor_population(population: int) -> tuple[Any, Any, Any, Any, Any]:
    """Capture rows and the authentic migration lock in one source epoch."""

    def populate(connection: Any) -> None:
        _legacy_invariants_test_module._populate_shared_legacy_fixture(
            connection, hostile=False
        )
        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        try:
            descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        finally:
            identity_cursor.close()
        for index in range(1, population + 1):
            reverse = population - index + 1
            tenant = f"tenant-{reverse:04d}"
            stream = f"stream-{reverse:04d}"
            connection.execute(
                "INSERT INTO ge_cycle_cursors VALUES "
                "(?, ?, 'event', ?, ?, ?, NULL, ?, 1, 0, -1, NULL, ?, ?, ?, 500, 1500, NULL)",
                (
                    tenant,
                    f"{index:064x}",
                    "b" * 64,
                    "c" * 64,
                    stream,
                    canonical_bytes(
                        {
                            "contractVersion": "cycle-store-provider/v1alpha1",
                            "pageSize": 1,
                            "streamId": stream,
                        }
                    ),
                    descriptor,
                    schema,
                    canonical_bytes(
                        {"exists": False, "recordHash": None, "sequence": -1}
                    ),
                ),
            ).close()
        connection.commit()

    connection, summary, stage, projection = (
        _legacy_invariants_test_module._prepare_legacy(populate)
    )
    report = _legacy_invariants_test_module.run_sqlite_v1_legacy_invariant_campaign(
        summary, projection, stage
    )
    assert report.diagnostics == ()
    receipt = _cursor_campaign_test_module._streaming_receipt_for_connection(
        summary, projection, connection, expected_count=population
    )
    return connection, summary, stage, projection, receipt


class _CursorAdoptionGraph:
    def __init__(self, population: int) -> None:
        (
            self.connection,
            summary,
            self.stage,
            projection,
            receipt,
        ) = _prepared_cursor_population(population)
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(
            self.connection, self.stage, receipt
        )
        _create_sqlite_cursor_seal_temp_table(
            self.connection, self.stage, receipt, transfer
        )
        outcome = _run_sqlite_cursor_pre_rebind_campaign(
            self.connection, self.stage, receipt, transfer
        )
        assert type(outcome) is SQLiteCursorPreRebindComplete
        cursor = self.connection.execute(
            "SELECT active_lock_id, active_owner_id, active_source_version, "
            "active_target_version, active_lock_epoch, active_fencing_token, "
            "active_expires_at_ms FROM main.ge_cycle_migration_lock WHERE singleton = 1"
        )
        try:
            row = cursor.fetchone()
            assert row is not None and cursor.fetchone() is None
        finally:
            cursor.close()
        lock_identity = _MigrationLockIdentity(
            str(row[0]),
            str(row[1]),
            1,
            2,
            cast(int, row[4]),
            cast(int, row[5]),
            cast(int, row[6]),
        )
        lock = _create_migration_lock_capability_intrinsic(
            self.connection, lock_identity
        )
        clock_source = _create_provider_clock_source_intrinsic(
            lambda: lock_identity.active_expires_at_ms - 1
        )
        clock = _create_provider_clock_capability_intrinsic(
            self.connection, lock, clock_source
        )
        evidence = _observe_provider_clock_intrinsic(
            clock, "before-first-permanent-mutation"
        )
        self.authority = (
            outer._prepare_sqlite_cursor_outer_publication_authority_intrinsic(
                self.connection,
                self.stage,
                receipt,
                projection,
                transfer,
                lock,
                clock,
                evidence,
            )
        )
        outer._activate_sqlite_cursor_outer_publication_authority_intrinsic(
            self.authority
        )
        self.migration = (
            outer._execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(
                self.authority
            )
        )
        self.fence = outer._mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
            self.authority, self.migration
        )
        self.reader = (
            outer._mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic(
                self.authority, self.migration, self.fence
            )
        )
        outer._execute_sqlite_cursor_post_ddl_publication_reader_intrinsic(
            self.authority, self.migration, self.fence, self.reader
        )
        self.entries = (
            outer._execute_sqlite_cursor_baseline_entries_publication_intrinsic(
                self.authority, self.migration, self.fence, self.reader
            )
        )
        self.header = (
            outer._execute_sqlite_cursor_baseline_header_publication_intrinsic(
                self.authority,
                self.migration,
                self.fence,
                self.reader,
                self.entries,
            )
        )
        self.sequence = (
            outer._execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic(
                self.authority,
                self.migration,
                self.fence,
                self.reader,
                self.entries,
                self.header,
            )
        )
        self.bundle = (
            self.migration,
            self.entries,
            self.header,
            self.sequence,
        )
        self.population = population
        self.summary = summary

    def close(self) -> None:
        try:
            self.connection.rollback()
        finally:
            try:
                self.stage.dispose()
            finally:
                self.connection.close()


def _expect(code: str) -> pytest.RaisesExc[ValueError]:
    return pytest.raises(ValueError, match=f"^{code}$")


def _session(graph: Any) -> Any:
    adoption = outer._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
        graph.authority, graph.bundle, graph.fence, graph.reader
    )
    prepared = outer._prepare_sqlite_cursor_publication_session_intrinsic(
        graph.authority, adoption
    )
    evidence = outer._observe_sqlite_cursor_publication_session_clock_intrinsic(prepared)
    return cast(Any, outer._publish_sqlite_cursor_publication_session_intrinsic)(
        prepared, evidence
    )


def _graph_to_a() -> tuple[Any, Any, Any, Any, Any, Any]:
    graph = _AdoptionGraph(0)
    session = _session(graph)
    execution = source._prepare_sqlite_connection_cursor_publication_rebind_intrinsic(
        graph.connection
    )
    context = outer._prepare_sqlite_cursor_publication_rebind_context_intrinsic(
        session, execution
    )
    context_snapshot = (
        outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(context)
    )
    prepared_owner = context_snapshot.prepared_owner
    assert (
        protocol._prepare_sqlite_cursor_publication_rebind_subprotocol_intrinsic(
            context, prepared_owner
        )
        is prepared_owner
    )
    tombstone = outer._consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
        context
    )
    source._execute_sqlite_connection_cursor_publication_rebind_intrinsic(
        graph.connection, execution, *context_snapshot.parameter_values
    )
    source._release_sqlite_connection_cursor_publication_rebind_intrinsic(
        graph.connection, execution
    )
    source._prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic(
        graph.connection, execution
    )
    adoption = outer._adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
        context, tombstone, execution
    )
    return graph, context, prepared_owner, tombstone, adoption, execution


def _mint_w(graph_data: tuple[Any, Any, Any, Any, Any, Any]) -> Any:
    _graph, context, prepared_owner, tombstone, adoption, _execution = graph_data
    return protocol._mint_sqlite_cursor_publication_rebind_write_receipt_intrinsic(
        context, prepared_owner, tombstone, adoption
    )


@pytest.mark.parametrize("count", [0, 1, 7, 2**53 - 1])
def test_closed_five_count_checker_accepts_safe_equal_counts(count: int) -> None:
    result = protocol._check_sqlite_cursor_publication_rule11_counts_intrinsic(
        protocol._Rule11CountProjection(count, count, count, count, count)
    )
    assert result == (True, 0, None)


def test_closed_checker_uses_captured_tuple_and_all_intrinsics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def forbidden(*_args: object, **_kwargs: object) -> Any:
        raise AssertionError("hostile late builtins lookup")

    with monkeypatch.context() as hostile:
        hostile.setattr(builtins, "tuple", forbidden)
        hostile.setattr(builtins, "all", forbidden)
        result = protocol._check_sqlite_cursor_publication_rule11_counts_intrinsic(
            protocol._Rule11CountProjection(3, 3, 3, 3, 3)
        )
    assert result == (True, 0, None)


@pytest.mark.parametrize("slot", range(5))
def test_each_count_mutation_is_one_closed_violation(slot: int) -> None:
    values = [7, 7, 7, 7, 7]
    values[slot] = 6
    result = protocol._check_sqlite_cursor_publication_rule11_counts_intrinsic(
        protocol._Rule11CountProjection(*values)
    )
    assert result == (False, 1, "cursor rebind count mismatch")


@pytest.mark.parametrize("value", [-1, 2**53, True, 1.0, "1"])
def test_closed_checker_rejects_non_safe_exact_integers(value: object) -> None:
    projection = protocol._Rule11CountProjection(0, 0, cast(Any, value), 0, 0)
    with _expect("GE_CURSOR_B3_RULE11_COUNT_SHAPE"):
        protocol._check_sqlite_cursor_publication_rule11_counts_intrinsic(projection)


def test_exact_outer_s_p_t_e_a_mints_w_then_zero_io_r11(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    data = _graph_to_a()
    graph, context, prepared_owner, tombstone, adoption, execution = data
    try:
        receipt = _mint_w(data)
        write = protocol._read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
            receipt
        )
        assert write.context is context
        assert write.prepared_owner is prepared_owner
        assert write.consumed_tombstone is tombstone
        assert write.post_rebind_adoption is adoption
        assert write.rebind_execution is execution
        assert write.counts == (0, 0, 0, 0, 0)
        assert write.outer_ledger_before == write.outer_ledger_after
        expected_frame = [
            [{"type": "text", "value": value} for value in write.parameters]
        ]
        assert write.parameter_sha256 == (
            _digest_sqlite_initial_write_parameters_intrinsic(expected_frame)
        )
        assert write.parameter_sha256 == (
            "524ece2b423a16fe16cf147e4918f74029ec71bd1559a65a2e7e2710a73ef37f"
        )

        def forbidden(*_args: object, **_kwargs: object) -> Any:
            raise AssertionError("Rule 11 performed model/provider/SQLite I/O")

        for name in (
            "_DIGEST_PARAMETERS",
        ):
            monkeypatch.setattr(protocol, name, forbidden)
        for name in (
            "_READ_VALIDATED_TARGET_CATALOG",
            "_LIVE_LOCK",
            "_READ_CLOCK_EVIDENCE",
            "_owner_snapshot",
        ):
            monkeypatch.setattr(outer, name, forbidden)
        rule11 = protocol._execute_sqlite_cursor_publication_rule11_intrinsic(receipt)
        result = protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
            rule11
        )
        assert result.rule_id == "BLR_CURSOR_REBIND_COUNT"
        assert result.position == 11
        assert result.write_receipt is receipt
        assert result.counts == (0, 0, 0, 0, 0)
    finally:
        graph.close()


@pytest.mark.parametrize("population", [0, 1, 3])
def test_unique_serialized_entry_runs_real_cursor_populations(population: int) -> None:
    graph = _CursorAdoptionGraph(population)
    try:
        session = _session(graph)
        rule11 = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        result = protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
            rule11
        )
        write = protocol._read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
            result.write_receipt
        )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert result.counts == (population,) * 5
        assert write.lifecycle == "rule11-complete"
        assert authority.write_phase == "cursor-rebind-adopted"
        assert authority.publication_rebind_context is write.context
        assert authority.publication_session_consumed_tombstone is (
            write.consumed_tombstone
        )
        assert authority.post_rebind_watermark_adoption is write.post_rebind_adoption
    finally:
        graph.close()


def test_authentic_precancel_is_retryable_before_e() -> None:
    graph = _AdoptionGraph(0)
    try:
        session = _session(graph)
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        with _expect("GE_CURSOR_B3_REBIND_CANCELLED"):
            protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
                session, controller.signal
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "active"
        assert authority.write_phase == "publication-active"
        assert authority.publication_rebind_context is None
        rule11 = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        assert (
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                rule11
            ).counts
            == (0, 0, 0, 0, 0)
        )
    finally:
        graph.close()


def test_second_boundary_cancellation_releases_p_context_and_same_s_retries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = _AdoptionGraph(0)
    try:
        session = _session(graph)
        original_check = protocol.__dict__[
            "_is_sqlite_cursor_publication_session_cancellation_requested_intrinsic"
        ]
        original_prepare = protocol.__dict__[
            "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic"
        ]
        checks = iter((False, True))
        executions: list[Any] = []

        def check(_signal: object) -> bool:
            return next(checks)

        def prepare(connection: Any) -> Any:
            execution = original_prepare(connection)
            executions.append(execution)
            return execution

        monkeypatch.setattr(
            protocol,
            "_is_sqlite_cursor_publication_session_cancellation_requested_intrinsic",
            check,
        )
        monkeypatch.setattr(
            protocol,
            "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic",
            prepare,
        )
        with _expect("GE_CURSOR_B3_REBIND_CANCELLED"):
            protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(session)
        assert len(executions) == 1
        released = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            graph.connection, executions[0]
        )
        assert released.lifecycle == "released"
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "active"
        assert authority.write_phase == "publication-active"
        assert authority.publication_rebind_context is None
        assert outer._assert_sqlite_cursor_publication_session_intrinsic(session) is session

        monkeypatch.setattr(
            protocol,
            "_is_sqlite_cursor_publication_session_cancellation_requested_intrinsic",
            original_check,
        )
        monkeypatch.setattr(
            protocol,
            "_prepare_sqlite_connection_cursor_publication_rebind_intrinsic",
            original_prepare,
        )
        rule11 = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            session
        )
        assert (
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                rule11
            ).counts
            == (0, 0, 0, 0, 0)
        )
    finally:
        graph.close()


def test_real_post_t_native_execute_failure_poisons_outer_preserves_primary_and_collects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registries = (
        protocol._WRITE_RECEIPTS,
        protocol._RULE11_RECEIPTS,
        protocol._WRITE_BY_CONTEXT,
        outer._PUBLICATION_REBIND_CONTEXTS,
        outer._PUBLICATION_REBIND_CONTEXT_BY_SESSION,
        outer._PUBLICATION_REBIND_CONTEXT_BY_PREPARED_OWNER,
        outer._PUBLICATION_SESSION_CONSUMED_TOMBSTONES,
        outer._POST_REBIND_WATERMARK_ADOPTIONS,
        source._CURSOR_PUBLICATION_REBIND_EXECUTIONS,
    )
    for _ in range(3):
        gc.collect()
    baseline = tuple(len(registry) for registry in registries)
    graph = _CursorAdoptionGraph(1)
    session = _session(graph)
    raw = cast(
        sqlite3.Connection,
        object.__getattribute__(
            graph.connection, "_SQLiteV1BaselineConnectionOwner__connection"
        ),
    )
    # Test-only hostile native object. Installing it through the raw exact
    # connection after S avoids changing the owner's captured epoch/counters.
    raw.execute(
        "CREATE TEMP TRIGGER hostile_serialized_rebind_abort "
        "BEFORE UPDATE ON main.ge_cycle_cursors "
        "BEGIN SELECT RAISE(ABORT, 'hostile serialized rebind'); END"
    ).close()
    original_release = protocol.__dict__[
        "_release_sqlite_connection_cursor_publication_rebind_intrinsic"
    ]
    expected_connection_id = id(graph.connection)
    expected_raw_id = id(raw)
    released: list[Any] = []

    class CleanupSecondary(BaseException):
        pass

    def release_then_secondary(connection: Any, execution: Any) -> Any:
        assert id(connection) == expected_connection_id
        assert id(
            object.__getattribute__(
                connection, "_SQLiteV1BaselineConnectionOwner__connection"
            )
        ) == expected_raw_id
        assert released == []
        released.append(execution)
        original_release(connection, execution)
        raise CleanupSecondary

    monkeypatch.setattr(
        protocol,
        "_release_sqlite_connection_cursor_publication_rebind_intrinsic",
        release_then_secondary,
    )
    write_before = len(protocol._WRITE_RECEIPTS)
    rule11_before = len(protocol._RULE11_RECEIPTS)
    with _expect("GE_CURSOR_B3_CURSOR_REBIND_EXECUTE"):
        protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(session)
    monkeypatch.setattr(
        protocol,
        "_release_sqlite_connection_cursor_publication_rebind_intrinsic",
        original_release,
    )
    assert len(released) == 1
    execution = released[0]
    native = source._read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        graph.connection, execution
    )
    assert native.lifecycle == "poisoned"
    assert (native.execute_count, native.release_count) == (1, 1)
    assert len(protocol._WRITE_RECEIPTS) == write_before
    assert len(protocol._RULE11_RECEIPTS) == rule11_before
    authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        graph.authority
    )
    assert authority.lifecycle == "poisoned"
    assert authority.write_phase == "poisoned"
    assert authority.publication_rebind_context is not None
    assert authority.publication_session_consumed_tombstone is not None
    with pytest.raises(ValueError, match="PUBLICATION_SESSION"):
        outer._assert_sqlite_cursor_publication_session_intrinsic(session)

    values = (
        graph.authority,
        session,
        execution,
        authority.publication_rebind_context,
        authority.publication_session_consumed_tombstone,
    )
    weak = [ref(value) for value in values]
    raw.execute("DROP TRIGGER temp.hostile_serialized_rebind_abort").close()
    graph.close()
    released.clear()
    del authority, execution, graph, raw, session, values
    for _ in range(12):
        gc.collect()
    assert all(item() is None for item in weak)
    assert tuple(len(registry) for registry in registries) == baseline


def test_forged_session_is_rejected_before_authentic_precancellation() -> None:
    graph = _AdoptionGraph(0)
    try:
        session = _session(graph)
        forged = object.__new__(type(session))
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        with _expect("GE_CURSOR_B3_PUBLICATION_SESSION"):
            protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
                forged, controller.signal
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "active"
        assert authority.write_phase == "publication-active"
    finally:
        graph.close()


def test_session_lineage_drift_is_terminal_before_authentic_precancellation() -> None:
    graph = _AdoptionGraph(0)
    try:
        session = _session(graph)
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        graph.connection.execute(
            "CREATE TEMP TABLE hostile_serialized_session_drift(value INTEGER NOT NULL)"
        ).close()
        with _expect("GE_CURSOR_B3_PUBLICATION_SESSION_LINEAGE"):
            protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
                session, controller.signal
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        assert authority.lifecycle == "poisoned"
        assert authority.write_phase == "poisoned"
    finally:
        graph.close()


def test_no_independent_p_or_callback_and_forged_outer_p_is_healthy() -> None:
    graph = _AdoptionGraph(0)
    try:
        session = _session(graph)
        execution = source._prepare_sqlite_connection_cursor_publication_rebind_intrinsic(
            graph.connection
        )
        context = outer._prepare_sqlite_cursor_publication_rebind_context_intrinsic(
            session, execution
        )
        prepared_owner = (
            outer._read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
                context
            ).prepared_owner
        )
        forged = object.__new__(type(prepared_owner))
        with _expect("GE_CURSOR_B3_PUBLICATION_REBIND_PREPARED_OWNER"):
            protocol._prepare_sqlite_cursor_publication_rebind_subprotocol_intrinsic(
                context, forged
            )
        assert outer._authority_state(graph.authority).lifecycle == "active"
        assert protocol.__dict__["_SQLiteCursorPublicationRebindPreparedOwner"] is (
            outer._SQLiteCursorPublicationRebindPreparedOwner
        )
        assert not hasattr(protocol, "_PostRebindAdoptionBridge")
        assert not hasattr(protocol, "_missing_post_rebind_adoption_bridge")
    finally:
        graph.close()


def test_cross_graph_t_is_healthy_but_exact_w_replay_poisons_selected() -> None:
    first = _graph_to_a()
    second = _graph_to_a()
    g1, c1, p1, t1, a1, _e1 = first
    g2, _c2, _p2, t2, _a2, _e2 = second
    try:
        with _expect("GE_CURSOR_B3_REBIND_ADOPTION"):
            protocol._mint_sqlite_cursor_publication_rebind_write_receipt_intrinsic(
                c1, p1, t2, a1
            )
        assert outer._authority_state(g1.authority).lifecycle == "active"
        assert outer._authority_state(g2.authority).lifecycle == "active"
        receipt = _mint_w(first)
        with _expect("GE_CURSOR_B3_REBIND_WRITE_REUSE"):
            protocol._mint_sqlite_cursor_publication_rebind_write_receipt_intrinsic(
                c1, p1, t1, a1
            )
        assert outer._authority_state(g1.authority).lifecycle == "poisoned"
        assert outer._authority_state(g2.authority).lifecycle == "active"
        record = cast(Any, protocol._WRITE_RECEIPTS[id(receipt)].value)
        assert record.consumed
        assert record.snapshot.lifecycle == "poisoned"
        assert record.snapshot.rule11_consume_count == 1
        before_rule11 = len(protocol._RULE11_RECEIPTS)
        with _expect("GE_CURSOR_B3_RULE11_REUSE"):
            protocol._execute_sqlite_cursor_publication_rule11_intrinsic(receipt)
        assert len(protocol._RULE11_RECEIPTS) == before_rule11
        with _expect("GE_CURSOR_B3_REBIND_WRITE_RECEIPT"):
            protocol._read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
                receipt
            )
    finally:
        g1.close()
        g2.close()


def test_authenticated_outer_poison_invalidates_completed_w_and_rule11_readers() -> None:
    data = _graph_to_a()
    graph, context, _prepared_owner, tombstone, adoption, _execution = data
    try:
        receipt = _mint_w(data)
        rule11 = protocol._execute_sqlite_cursor_publication_rule11_intrinsic(receipt)
        outer._poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
            context,
            tombstone,
            "authenticated post-Rule11 poison",
            adoption,
        )
        assert outer._authority_state(graph.authority).lifecycle == "poisoned"
        with _expect("GE_CURSOR_B3_REBIND_WRITE_RECEIPT"):
            protocol._read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
                receipt
            )
        with _expect("GE_CURSOR_B3_RULE11_RECEIPT"):
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                rule11
            )
    finally:
        graph.close()


def test_rule11_alone_retains_exact_session_authority_until_receipt_drops() -> None:
    registries = (
        protocol._WRITE_RECEIPTS,
        protocol._RULE11_RECEIPTS,
        protocol._WRITE_BY_CONTEXT,
        outer._PUBLICATION_SESSIONS,
        outer._PUBLICATION_REBIND_CONTEXTS,
        outer._PUBLICATION_SESSION_CONSUMED_TOMBSTONES,
        outer._POST_REBIND_WATERMARK_ADOPTIONS,
    )
    for _ in range(3):
        gc.collect()
    baseline = tuple(len(registry) for registry in registries)

    def retained() -> tuple[Any, Any, Any]:
        data = _graph_to_a()
        graph, _context, _prepared, _tombstone, _adoption, _execution = data
        write = _mint_w(data)
        rule11 = protocol._execute_sqlite_cursor_publication_rule11_intrinsic(write)
        snapshot = (
            protocol._read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
                write
            )
        )
        session_ref = ref(snapshot.session)
        authority_ref = ref(snapshot.outer_authority)
        graph.close()
        return rule11, session_ref, authority_ref

    rule11, session_ref, authority_ref = retained()
    for _ in range(8):
        gc.collect()
    assert session_ref() is not None
    assert authority_ref() is not None
    result = protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
        rule11
    )
    assert result.position == 11
    del result, rule11
    for _ in range(12):
        gc.collect()
    assert session_ref() is None
    assert authority_ref() is None
    assert tuple(len(registry) for registry in registries) == baseline


def test_rule11_mismatch_and_replay_poison_exact_outer_graph() -> None:
    mismatch = _graph_to_a()
    replay = _graph_to_a()
    try:
        mismatch_receipt = _mint_w(mismatch)
        mismatch_record = cast(
            Any, protocol._WRITE_RECEIPTS[id(mismatch_receipt)].value
        )
        mismatch_record.snapshot = mismatch_record.snapshot._replace(
            counts=protocol._Rule11CountProjection(1, 0, 0, 0, 0)
        )
        with _expect("GE_CURSOR_B3_RULE11_COUNT_MISMATCH"):
            protocol._execute_sqlite_cursor_publication_rule11_intrinsic(
                mismatch_receipt
            )
        assert outer._authority_state(mismatch[0].authority).lifecycle == "poisoned"

        replay_receipt = _mint_w(replay)
        rule11 = protocol._execute_sqlite_cursor_publication_rule11_intrinsic(
            replay_receipt
        )
        with _expect("GE_CURSOR_B3_RULE11_REUSE"):
            protocol._execute_sqlite_cursor_publication_rule11_intrinsic(
                replay_receipt
            )
        assert outer._authority_state(replay[0].authority).lifecycle == "poisoned"
        with _expect("GE_CURSOR_B3_RULE11_RECEIPT"):
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                rule11
            )
    finally:
        mismatch[0].close()
        replay[0].close()


def test_w_and_r11_registration_baseexceptions_poison_outer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Marker(BaseException):
        pass

    w_data = _graph_to_a()
    r11_data = _graph_to_a()
    try:
        register_latch = protocol._REGISTER_CONTEXT_LATCH

        def latch_then_fail(*args: object) -> None:
            register_latch(*cast(Any, args))
            raise Marker

        monkeypatch.setattr(protocol, "_REGISTER_CONTEXT_LATCH", latch_then_fail)
        with pytest.raises(Marker):
            _mint_w(w_data)
        assert outer._authority_state(w_data[0].authority).lifecycle == "poisoned"

        monkeypatch.setattr(protocol, "_REGISTER_CONTEXT_LATCH", register_latch)
        receipt = _mint_w(r11_data)
        register_rule11 = protocol._REGISTER_RULE11
        captured_rule11: list[Any] = []

        def rule11_then_fail(*args: object) -> None:
            captured_rule11.append(args[1])
            register_rule11(*cast(Any, args))
            raise Marker

        monkeypatch.setattr(protocol, "_REGISTER_RULE11", rule11_then_fail)
        with pytest.raises(Marker):
            protocol._execute_sqlite_cursor_publication_rule11_intrinsic(receipt)
        assert outer._authority_state(r11_data[0].authority).lifecycle == "poisoned"
        assert len(captured_rule11) == 1
        partial = captured_rule11[0]
        assert id(partial) not in protocol._RULE11_RECEIPTS
        with _expect("GE_CURSOR_B3_RULE11_RECEIPT"):
            protocol._read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
                partial
            )
    finally:
        w_data[0].close()
        r11_data[0].close()


def test_opaque_receipts_private_root_and_success_registries_collect() -> None:
    for receipt_type in (
        protocol._SQLiteCursorPublicationRebindWriteReceipt,
        protocol._SQLiteCursorPublicationRule11SuccessReceipt,
    ):
        with pytest.raises(TypeError):
            receipt_type(object())
    for name in (
        "SQLiteCursorPublicationRebindWriteReceipt",
        "SQLiteCursorPublicationRule11SuccessReceipt",
        "execute_sqlite_cursor_publication_rule11",
    ):
        assert not hasattr(graph_engineering, name)

    data = _graph_to_a()
    receipt = _mint_w(data)
    rule11 = protocol._execute_sqlite_cursor_publication_rule11_intrinsic(receipt)
    receipt_id, rule11_id = id(receipt), id(rule11)
    receipt_ref, rule11_ref = ref(receipt), ref(rule11)
    del receipt, rule11
    for _ in range(8):
        gc.collect()
    assert receipt_ref() is None
    assert rule11_ref() is None
    assert receipt_id not in protocol._WRITE_RECEIPTS
    assert rule11_id not in protocol._RULE11_RECEIPTS
    reused = False
    for _ in range(4_096):
        forged = object.__new__(protocol._SQLiteCursorPublicationRebindWriteReceipt)
        reused = reused or id(forged) == receipt_id
        with _expect("GE_CURSOR_B3_REBIND_WRITE_RECEIPT"):
            protocol._read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
                forged
            )
        del forged
        if reused:
            break
    assert receipt_id not in protocol._WRITE_RECEIPTS
    data[0].close()


def test_failure_profiles_do_not_root_rebind_graphs_or_registries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registries = (
        protocol._WRITE_RECEIPTS,
        protocol._RULE11_RECEIPTS,
        protocol._WRITE_BY_CONTEXT,
        outer._PUBLICATION_SESSIONS,
        outer._PUBLICATION_REBIND_CONTEXTS,
        outer._PUBLICATION_REBIND_CONTEXT_BY_SESSION,
        outer._PUBLICATION_REBIND_CONTEXT_BY_PREPARED_OWNER,
        outer._PUBLICATION_SESSION_CONSUMED_TOMBSTONES,
        outer._POST_REBIND_WATERMARK_ADOPTIONS,
        outer._PUBLICATION_CANCELLATIONS,
    )
    for _ in range(3):
        gc.collect()
    baseline = tuple(len(registry) for registry in registries)

    def finish(graph: Any, values: tuple[Any, ...]) -> list[Any]:
        weak = [ref(value) for value in values]
        graph.close()
        return weak

    def prewrite_cancel() -> list[Any]:
        graph = _AdoptionGraph(0)
        session = _session(graph)
        controller = (
            outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        )
        controller.cancel()
        with _expect("GE_CURSOR_B3_REBIND_CANCELLED"):
            protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
                session, controller.signal
            )
        return finish(graph, (graph.authority, session, controller.signal))

    def postconsume_poison() -> list[Any]:
        data = _graph_to_a()
        graph, context, prepared, tombstone, adoption, execution = data
        outer._poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
            context, tombstone, "GC post-consume poison", adoption
        )
        return finish(
            graph,
            (
                graph.authority,
                context,
                prepared,
                tombstone,
                adoption,
                execution,
            ),
        )

    def rule11_poison() -> list[Any]:
        data = _graph_to_a()
        graph, context, prepared, tombstone, adoption, execution = data
        receipt = _mint_w(data)
        record = cast(Any, protocol._WRITE_RECEIPTS[id(receipt)].value)
        record.snapshot = record.snapshot._replace(
            counts=protocol._Rule11CountProjection(1, 0, 0, 0, 0)
        )
        with _expect("GE_CURSOR_B3_RULE11_COUNT_MISMATCH"):
            protocol._execute_sqlite_cursor_publication_rule11_intrinsic(receipt)
        return finish(
            graph,
            (
                graph.authority,
                context,
                prepared,
                tombstone,
                adoption,
                execution,
                receipt,
            ),
        )

    def registration_fault() -> list[Any]:
        class Marker(BaseException):
            pass

        data = _graph_to_a()
        graph, context, prepared, tombstone, adoption, execution = data
        original = protocol._REGISTER_WRITE

        def register_then_fail(*args: object) -> None:
            original(*cast(Any, args))
            raise Marker

        monkeypatch.setattr(protocol, "_REGISTER_WRITE", register_then_fail)
        try:
            with pytest.raises(Marker):
                _mint_w(data)
        finally:
            monkeypatch.setattr(protocol, "_REGISTER_WRITE", original)
        return finish(
            graph,
            (graph.authority, context, prepared, tombstone, adoption, execution),
        )

    weak = (
        prewrite_cancel()
        + postconsume_poison()
        + rule11_poison()
        + registration_fault()
    )
    for _ in range(12):
        gc.collect()
    assert all(item() is None for item in weak)
    assert tuple(len(registry) for registry in registries) == baseline
