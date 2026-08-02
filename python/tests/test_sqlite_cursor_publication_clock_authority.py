from __future__ import annotations

import gc
from collections.abc import Callable, Iterator
from contextlib import suppress
from dataclasses import replace
from pathlib import Path
from weakref import ref

import pytest

import graph_engineering.sqlite_cursor_publication_clock_authority as clock_module
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    SQLITE_CURSOR_CLOCK_BOUNDARIES,
    SQLITE_CURSOR_CLOCK_CONSUMERS,
    _assert_active_second_boundary_graph_intrinsic,
    _assert_clock_evidence_predecessor_intrinsic,
    _assert_consumed_clock_tombstone_intrinsic,
    _assert_prepared_second_boundary_graph_intrinsic,
    _ClockEvidence,
    _consume_provider_clock_evidence_intrinsic,
    _create_migration_lock_capability_intrinsic,
    _create_provider_clock_capability_intrinsic,
    _create_provider_clock_source_intrinsic,
    _MigrationLockCapability,
    _MigrationLockIdentity,
    _observe_provider_clock_intrinsic,
    _ProviderClockCapability,
    _ProviderClockSource,
    _read_clock_evidence_snapshot_intrinsic,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

ROOT = Path(__file__).resolve().parents[2]
LOCK = _MigrationLockIdentity(
    lock_id="b3-lock",
    owner_id="b3-owner",
    source_schema_version=1,
    target_schema_version=2,
    lock_epoch=1,
    fencing_token=1,
    active_expires_at_ms=1_000,
)


def open_run(lock: _MigrationLockIdentity = LOCK) -> SQLiteV1BaselineConnectionOwner:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    schema = (ROOT / "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql").read_text()
    connection.executescript(schema)
    connection.execute(
        """INSERT INTO main.ge_cycle_migration_lock
           (singleton, active_lock_id, active_owner_id, active_source_version,
            active_target_version, active_lock_epoch, active_fencing_token,
            active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
            last_fencing_token, updated_at_ms)
           VALUES (1, ?, ?, ?, ?, ?, ?, 10, ?, ?, ?, 10)""",
        (
            lock.lock_id,
            lock.owner_id,
            lock.source_schema_version,
            lock.target_schema_version,
            lock.lock_epoch,
            lock.fencing_token,
            lock.active_expires_at_ms,
            lock.lock_epoch,
            lock.fencing_token,
        ),
    ).close()
    connection.commit()
    connection.execute("BEGIN EXCLUSIVE").close()
    return connection


def clock_values(values: list[object]) -> Callable[[], int]:
    iterator: Iterator[object] = iter(values)

    def provider_now() -> int:
        return next(iterator)  # type: ignore[return-value]

    return provider_now


def authority(
    connection: SQLiteV1BaselineConnectionOwner,
    values: list[object],
) -> tuple[
    _ProviderClockCapability,
    _MigrationLockCapability,
    _ProviderClockSource,
]:
    source = _create_provider_clock_source_intrinsic(clock_values(values))
    lock = _create_migration_lock_capability_intrinsic(connection, LOCK)
    clock = _create_provider_clock_capability_intrinsic(connection, lock, source)
    return clock, lock, source


def close_run(connection: SQLiteV1BaselineConnectionOwner) -> None:
    try:
        if connection.in_transaction:
            connection.rollback()
    finally:
        connection.close()


def expect_code(code: str) -> pytest.RaisesExc[ValueError]:
    return pytest.raises(ValueError, match=f"^{code}$")


def test_mints_four_chained_receipts_and_consumes_each_exactly_once() -> None:
    connection = open_run()
    try:
        clock, _, _ = authority(connection, [100, 200, 300, 400])
        evidence: list[_ClockEvidence] = []
        previous: _ClockEvidence | None = None
        for boundary in SQLITE_CURSOR_CLOCK_BOUNDARIES:
            current = _observe_provider_clock_intrinsic(clock, boundary)
            assert current is not previous
            assert _assert_clock_evidence_predecessor_intrinsic(clock, current, previous) is current
            snapshot = _read_clock_evidence_snapshot_intrinsic(clock, current)
            assert snapshot.boundary == boundary
            assert snapshot.consumer == SQLITE_CURSOR_CLOCK_CONSUMERS[boundary]
            assert snapshot.active_expires_at_ms == 1_000
            evidence.append(current)
            previous = current

        assert [
            _read_clock_evidence_snapshot_intrinsic(clock, item).provider_now_ms
            for item in evidence
        ] == [100, 200, 300, 400]
        for index, boundary in enumerate(SQLITE_CURSOR_CLOCK_BOUNDARIES):
            current = evidence[index]
            consumer = SQLITE_CURSOR_CLOCK_CONSUMERS[boundary]
            tombstone = _consume_provider_clock_evidence_intrinsic(clock, current, consumer)
            assert (
                _assert_consumed_clock_tombstone_intrinsic(clock, current, tombstone, consumer)
                is tombstone
            )
            with expect_code("GE_CURSOR_B3_CLOCK_REPLAY"):
                _consume_provider_clock_evidence_intrinsic(clock, current, consumer)
        with expect_code("GE_CURSOR_B3_CLOCK_ORDER"):
            _observe_provider_clock_intrinsic(clock, "before-commit")
    finally:
        close_run(connection)


def test_preserves_begin_lineage_across_ddl_but_rejects_rebegin() -> None:
    connection = open_run()
    try:
        clock, _, _ = authority(connection, [100, 200, 300])
        generation = connection._transaction_generation
        epoch = connection.transaction_epoch
        _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
        connection.execute(
            "CREATE TEMP TABLE temp.ge_b3_epoch_probe (id INTEGER PRIMARY KEY)"
        ).close()
        assert connection._transaction_generation is generation
        assert connection.transaction_epoch > epoch
        _observe_provider_clock_intrinsic(clock, "before-cursor-rebind")

        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        assert connection._transaction_generation is not generation
        with expect_code("GE_CURSOR_B3_TRANSACTION_LINEAGE"):
            _observe_provider_clock_intrinsic(clock, "before-verification")
    finally:
        close_run(connection)


def test_rejects_skipped_cloned_and_substituted_authority() -> None:
    connection = open_run()
    try:
        first, first_lock, first_source = authority(connection, [100, 200])
        second, _, _ = authority(connection, [100, 200])
        with expect_code("GE_CURSOR_B3_CLOCK_ORDER"):
            _observe_provider_clock_intrinsic(first, "before-cursor-rebind")
        evidence = _observe_provider_clock_intrinsic(first, "before-first-permanent-mutation")

        with expect_code("GE_CURSOR_B3_CLOCK_EVIDENCE"):
            _read_clock_evidence_snapshot_intrinsic(
                first,
                object(),  # type: ignore[arg-type]
            )
        with expect_code("GE_CURSOR_B3_CLOCK_EVIDENCE"):
            _consume_provider_clock_evidence_intrinsic(
                second, evidence, "outer-publication-authority"
            )
        with expect_code("GE_CURSOR_B3_CLOCK_CAPABILITY"):
            _create_provider_clock_capability_intrinsic(
                connection,
                object(),  # type: ignore[arg-type]
                first_source,
            )
        with expect_code("GE_CURSOR_B3_CLOCK_CAPABILITY"):
            _create_provider_clock_capability_intrinsic(
                connection,
                first_lock,
                object(),  # type: ignore[arg-type]
            )
    finally:
        close_run(connection)


def test_orphaned_evidence_rejects_fresh_exact_capability_without_identity_rebinding() -> None:
    connection = open_run()
    try:
        clock, lock, source = authority(connection, [100, 200])
        evidence = _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
        clock_ref = ref(clock)
        del clock, lock, source
        for _ in range(8):
            gc.collect()
        assert clock_ref() is None
        clone = object.__new__(_ProviderClockCapability)
        with expect_code("GE_CURSOR_B3_CLOCK_EVIDENCE"):
            _read_clock_evidence_snapshot_intrinsic(clone, evidence)
        fresh, _fresh_lock, _fresh_source = authority(connection, [200])
        with expect_code("GE_CURSOR_B3_CLOCK_EVIDENCE"):
            _read_clock_evidence_snapshot_intrinsic(fresh, evidence)
        with expect_code("GE_CURSOR_B3_CLOCK_EVIDENCE"):
            _consume_provider_clock_evidence_intrinsic(
                fresh,
                evidence,
                "outer-publication-authority",
            )
    finally:
        close_run(connection)


def test_live_tombstone_retains_exact_evidence_chain_then_releases_all_clock_registries() -> None:
    for _ in range(3):
        gc.collect()
    baseline = tuple(
        len(registry)
        for registry in (
            clock_module._CLOCK_SOURCES,
            clock_module._LOCK_CAPABILITIES,
            clock_module._CLOCK_CAPABILITIES,
            clock_module._EVIDENCE,
            clock_module._TOMBSTONES,
        )
    )
    connection = open_run()
    try:
        clock, lock, source = authority(connection, [100])
        evidence = _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
        tombstone = _consume_provider_clock_evidence_intrinsic(
            clock,
            evidence,
            "outer-publication-authority",
        )
        clock_ref = ref(clock)
        evidence_ref = ref(evidence)
        del clock, evidence, lock, source
        for _ in range(8):
            gc.collect()
        retained_clock = clock_ref()
        retained_evidence = evidence_ref()
        assert retained_clock is not None
        assert retained_evidence is not None
        assert (
            _assert_consumed_clock_tombstone_intrinsic(
                retained_clock,
                retained_evidence,
                tombstone,
                "outer-publication-authority",
            )
            is tombstone
        )
        del retained_clock, retained_evidence, tombstone
        for _ in range(12):
            gc.collect()
        assert clock_ref() is None
        assert evidence_ref() is None
        assert (
            tuple(
                len(registry)
                for registry in (
                    clock_module._CLOCK_SOURCES,
                    clock_module._LOCK_CAPABILITIES,
                    clock_module._CLOCK_CAPABILITIES,
                    clock_module._EVIDENCE,
                    clock_module._TOMBSTONES,
                )
            )
            == baseline
        )
    finally:
        close_run(connection)


@pytest.mark.parametrize("provider_now", [1_000, 1_001])
def test_rejects_equal_or_past_expiry(provider_now: int) -> None:
    connection = open_run()
    try:
        clock, _, _ = authority(connection, [provider_now])
        with expect_code("GE_CURSOR_B3_LOCK_EXPIRED"):
            _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
    finally:
        close_run(connection)


@pytest.mark.parametrize("provider_now", [-1, 1.5, float("nan"), float("inf")])
def test_rejects_invalid_provider_clock(provider_now: object) -> None:
    connection = open_run()
    try:
        clock, _, _ = authority(connection, [provider_now])
        with expect_code("GE_CURSOR_B3_CLOCK_UNAVAILABLE"):
            _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
    finally:
        close_run(connection)


def test_rejects_regressing_provider_clock() -> None:
    connection = open_run()
    try:
        clock, _, _ = authority(connection, [100, 99])
        _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
        with expect_code("GE_CURSOR_B3_CLOCK_REGRESSION"):
            _observe_provider_clock_intrinsic(clock, "before-cursor-rebind")
    finally:
        close_run(connection)


def test_rereads_live_lock_and_rejects_clock_side_effects() -> None:
    connection = open_run()
    try:
        clock, _, _ = authority(connection, [100, 200])
        _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
        connection.execute(
            "UPDATE main.ge_cycle_migration_lock SET active_owner_id = ? WHERE singleton = 1",
            ("other-owner",),
        ).close()
        with expect_code("GE_CURSOR_B3_MIGRATION_LOCK"):
            _observe_provider_clock_intrinsic(clock, "before-cursor-rebind")
    finally:
        close_run(connection)

    side_effect_connection = open_run()
    try:
        provider_calls = 0

        def provider_now() -> int:
            nonlocal provider_calls
            provider_calls += 1
            if provider_calls == 1:
                side_effect_connection.execute(
                    "UPDATE main.ge_cycle_migration_lock "
                    "SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1"
                ).close()
            return 100

        source = _create_provider_clock_source_intrinsic(provider_now)
        lock = _create_migration_lock_capability_intrinsic(side_effect_connection, LOCK)
        clock = _create_provider_clock_capability_intrinsic(side_effect_connection, lock, source)
        with expect_code("GE_CURSOR_B3_CLOCK_SIDE_EFFECT"):
            _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
        with expect_code("GE_CURSOR_B3_CLOCK_POISONED"):
            _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
        assert provider_calls == 1
    finally:
        close_run(side_effect_connection)


def test_poisoned_reentrant_observation_cannot_mint_evidence() -> None:
    connection = open_run()
    try:
        clock: _ProviderClockCapability | None = None

        def provider_now() -> int:
            assert clock is not None
            with suppress(ValueError):
                _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
            return 100

        source = _create_provider_clock_source_intrinsic(provider_now)
        lock = _create_migration_lock_capability_intrinsic(connection, LOCK)
        clock = _create_provider_clock_capability_intrinsic(connection, lock, source)
        with expect_code("GE_CURSOR_B3_CLOCK_REENTRANT"):
            _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
        with expect_code("GE_CURSOR_B3_CLOCK_POISONED"):
            _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
    finally:
        close_run(connection)


def _second_boundary_graph() -> tuple[
    SQLiteV1BaselineConnectionOwner,
    _MigrationLockCapability,
    _ProviderClockCapability,
    _ClockEvidence,
    object,
    _ClockEvidence,
]:
    connection = open_run()
    clock, lock, _source = authority(connection, [100, 200, 300])
    outer = _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")
    outer_tombstone = _consume_provider_clock_evidence_intrinsic(
        clock, outer, "outer-publication-authority"
    )
    second = _observe_provider_clock_intrinsic(clock, "before-cursor-rebind")
    return connection, lock, clock, outer, outer_tombstone, second


def test_second_boundary_prepared_and_active_assertions_are_symmetric_and_read_only() -> None:
    connection, lock, clock, outer, outer_tombstone, second = _second_boundary_graph()
    try:
        epoch = connection.transaction_epoch
        changes = connection.total_changes
        prepared = _assert_prepared_second_boundary_graph_intrinsic(
            connection,
            lock,
            clock,
            outer,
            outer_tombstone,  # type: ignore[arg-type]
            second,
        )
        assert prepared.evidence.boundary == "before-cursor-rebind"
        assert prepared.evidence.consumer == "cursor-publication-session"
        assert prepared.predecessor_evidence is outer
        assert prepared.migration_lock == LOCK
        assert connection.transaction_epoch == epoch
        assert connection.total_changes == changes

        second_tombstone = _consume_provider_clock_evidence_intrinsic(
            clock, second, "cursor-publication-session"
        )
        with expect_code("GE_CURSOR_B3_CLOCK_SECOND_GRAPH"):
            _assert_prepared_second_boundary_graph_intrinsic(
                connection,
                lock,
                clock,
                outer,
                outer_tombstone,  # type: ignore[arg-type]
                second,
            )
        active = _assert_active_second_boundary_graph_intrinsic(
            connection,
            lock,
            clock,
            outer,
            outer_tombstone,  # type: ignore[arg-type]
            second,
            second_tombstone,
        )
        assert active == prepared
        assert (
            _assert_active_second_boundary_graph_intrinsic(
                connection,
                lock,
                clock,
                outer,
                outer_tombstone,  # type: ignore[arg-type]
                second,
                second_tombstone,
            )
            == active
        )
        assert connection.transaction_epoch == epoch
        assert connection.total_changes == changes
    finally:
        close_run(connection)


@pytest.mark.parametrize("evidence_owner", ("outer", "second"))
def test_second_boundary_rejects_snapshot_expiry_substitution(
    evidence_owner: str,
) -> None:
    connection, lock, clock, outer, outer_tombstone, second = _second_boundary_graph()
    try:
        evidence = outer if evidence_owner == "outer" else second
        evidence_state = clock_module._EVIDENCE[evidence]
        evidence_state.snapshot = replace(
            evidence_state.snapshot,
            active_expires_at_ms=999,
        )
        with expect_code("GE_CURSOR_B3_CLOCK_SECOND_GRAPH"):
            _assert_prepared_second_boundary_graph_intrinsic(
                connection,
                lock,
                clock,
                outer,
                outer_tombstone,  # type: ignore[arg-type]
                second,
            )
    finally:
        close_run(connection)


def test_second_boundary_graph_rejects_unconsumed_substitution_and_early_third() -> None:
    connection, lock, clock, outer, outer_tombstone, second = _second_boundary_graph()
    foreign_connection, foreign_lock, foreign_clock, *_foreign = _second_boundary_graph()
    try:
        with expect_code("GE_CURSOR_B3_CLOCK_SECOND_GRAPH"):
            _assert_active_second_boundary_graph_intrinsic(
                connection,
                lock,
                clock,
                outer,
                outer_tombstone,  # type: ignore[arg-type]
                second,
                object(),  # type: ignore[arg-type]
            )
        for substituted in (
            (foreign_connection, lock, clock),
            (connection, foreign_lock, clock),
            (connection, lock, foreign_clock),
        ):
            with expect_code("GE_CURSOR_B3_CLOCK_SECOND_GRAPH"):
                _assert_prepared_second_boundary_graph_intrinsic(
                    substituted[0],
                    substituted[1],  # type: ignore[arg-type]
                    substituted[2],  # type: ignore[arg-type]
                    outer,
                    outer_tombstone,  # type: ignore[arg-type]
                    second,
                )
        second_tombstone = _consume_provider_clock_evidence_intrinsic(
            clock, second, "cursor-publication-session"
        )
        _observe_provider_clock_intrinsic(clock, "before-verification")
        with expect_code("GE_CURSOR_B3_CLOCK_SECOND_GRAPH"):
            _assert_active_second_boundary_graph_intrinsic(
                connection,
                lock,
                clock,
                outer,
                outer_tombstone,  # type: ignore[arg-type]
                second,
                second_tombstone,
            )
    finally:
        close_run(connection)
        close_run(foreign_connection)


def test_clock_consume_record_construction_failure_keeps_evidence_unconsumed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = open_run()
    try:
        clock, _lock, _source = authority(connection, [100])
        evidence = _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")

        def fail_record(*_args: object) -> object:
            raise MemoryError("injected tombstone-state allocation failure")

        monkeypatch.setattr(clock_module, "_TombstoneState", fail_record)
        with pytest.raises(MemoryError, match="allocation failure"):
            _consume_provider_clock_evidence_intrinsic(
                clock, evidence, "outer-publication-authority"
            )
        assert clock_module._EVIDENCE[evidence].consumed is False
        monkeypatch.undo()
        tombstone = _consume_provider_clock_evidence_intrinsic(
            clock, evidence, "outer-publication-authority"
        )
        assert (
            _assert_consumed_clock_tombstone_intrinsic(
                clock, evidence, tombstone, "outer-publication-authority"
            )
            is tombstone
        )
    finally:
        close_run(connection)


def test_clock_consume_registry_failure_keeps_evidence_unconsumed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = open_run()
    try:
        clock, _lock, _source = authority(connection, [100])
        evidence = _observe_provider_clock_intrinsic(clock, "before-first-permanent-mutation")

        class FailingRegistry:
            def __setitem__(self, _key: object, _value: object) -> None:
                raise MemoryError("injected tombstone registry failure")

        monkeypatch.setattr(clock_module, "_TOMBSTONES", FailingRegistry())
        with pytest.raises(MemoryError, match="registry failure"):
            _consume_provider_clock_evidence_intrinsic(
                clock, evidence, "outer-publication-authority"
            )
        assert clock_module._EVIDENCE[evidence].consumed is False
        monkeypatch.undo()
        _consume_provider_clock_evidence_intrinsic(clock, evidence, "outer-publication-authority")
    finally:
        close_run(connection)


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("active_lock_id", "other-lock"),
        ("active_owner_id", "other-owner"),
        ("active_source_version", 2),
        ("active_target_version", 3),
        ("active_lock_epoch", 2),
        ("active_fencing_token", 2),
        ("active_expires_at_ms", 999),
    ],
)
def test_second_boundary_rejects_every_live_lock_field_drift(
    column: str,
    value: object,
) -> None:
    connection, lock, clock, outer, outer_tombstone, second = _second_boundary_graph()
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        connection.execute(
            f"UPDATE main.ge_cycle_migration_lock SET {column} = ? WHERE singleton = 1",
            (value,),
        ).close()
        with expect_code("GE_CURSOR_B3_CLOCK_SECOND_GRAPH"):
            _assert_prepared_second_boundary_graph_intrinsic(
                connection,
                lock,
                clock,
                outer,
                outer_tombstone,  # type: ignore[arg-type]
                second,
            )
    finally:
        close_run(connection)


def test_second_boundary_rejects_replaced_lineage_and_poisoned_authority() -> None:
    connection, lock, clock, outer, outer_tombstone, second = _second_boundary_graph()
    try:
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE").close()
        with expect_code("GE_CURSOR_B3_TRANSACTION_LINEAGE"):
            _assert_prepared_second_boundary_graph_intrinsic(
                connection,
                lock,
                clock,
                outer,
                outer_tombstone,  # type: ignore[arg-type]
                second,
            )
    finally:
        close_run(connection)

    poisoned, poisoned_lock, poisoned_clock, first, first_tombstone, next_evidence = (
        _second_boundary_graph()
    )
    try:
        clock_module._CLOCK_CAPABILITIES[poisoned_clock].poisoned = True
        with expect_code("GE_CURSOR_B3_CLOCK_SECOND_GRAPH"):
            _assert_prepared_second_boundary_graph_intrinsic(
                poisoned,
                poisoned_lock,
                poisoned_clock,
                first,
                first_tombstone,  # type: ignore[arg-type]
                next_evidence,
            )
    finally:
        close_run(poisoned)
