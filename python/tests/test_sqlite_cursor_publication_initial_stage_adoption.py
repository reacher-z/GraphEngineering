from __future__ import annotations

import dis
import gc
from collections.abc import Callable, Iterator
from dataclasses import fields, is_dataclass
from functools import partial
from inspect import getclosurevars, getsource, signature
from typing import Any
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer_module
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as ownership_module
import graph_engineering.sqlite_operation_baseline_stage as stage_module
from graph_engineering.sqlite_operation_baseline_cursor_stage_ownership import (
    _assert_sqlite_cursor_stage_ownership_initial_publication_adopted_intrinsic,
    _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic,
    _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic,
    _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    SQLITE_CURSOR_INITIAL_PUBLICATION_TARGET_CATALOG_SHA256,
    _SQLiteCursorInitialPublicationOuterLedgerWatermark,
    _SQLiteCursorInitialPublicationStageWatermark,
)
from tests.test_sqlite_connection_operation_sequence_zero_session import _source_graph
from tests.test_sqlite_cursor_publication_baseline_entries import _safe_cleanup
from tests.test_sqlite_cursor_publication_migration_0002_execution import _raw


class _HostileSequence:
    """A fake carrier whose protocols must never be dispatched by adoption."""

    def __init__(self) -> None:
        self.calls = 0

    def __getitem__(self, index: int) -> object:
        self.calls += 1
        raise AssertionError(f"caller __getitem__ invoked at {index}")

    def __len__(self) -> int:
        self.calls += 1
        raise AssertionError("caller __len__ invoked")

    def __iter__(self) -> Iterator[object]:
        self.calls += 1
        raise AssertionError("caller __iter__ invoked")


class _TupleSubclass(tuple[object, ...]):
    def __getitem__(self, index: int | slice) -> object:  # type: ignore[override]
        raise AssertionError(f"tuple subclass __getitem__ invoked at {index}")

    def __iter__(self) -> Iterator[object]:
        raise AssertionError("tuple subclass __iter__ invoked")


class _AdoptionGraph:
    def __init__(self, legacy_count: int = 1) -> None:
        (
            self.connection,
            self.stage,
            self.authority,
            self.migration,
            self.fence,
            self.reader,
            self.entries,
            self.header,
        ) = _source_graph(legacy_count)
        self.sequence = (
            outer_module._execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic(
                self.authority,
                self.migration,
                self.fence,
                self.reader,
                self.entries,
                self.header,
            )
        )
        self.bundle = (self.migration, self.entries, self.header, self.sequence)

    def close(self) -> None:
        _safe_cleanup(self.connection, self.stage)


@pytest.fixture  # type: ignore[untyped-decorator]
def adoption_graphs() -> Iterator[Any]:
    graphs: list[_AdoptionGraph] = []

    def create(legacy_count: int = 1) -> _AdoptionGraph:
        graph = _AdoptionGraph(legacy_count)
        graphs.append(graph)
        return graph

    yield create
    for graph in reversed(graphs):
        graph.close()


def _api(name: str) -> Any:
    """Resolve the concurrently implemented private API without breaking collection."""

    return getattr(outer_module, name)


def _adopt(graph: _AdoptionGraph, bundle: object | None = None, *extra: object) -> object:
    supplied = graph.bundle if bundle is None else bundle
    return _api("_adopt_sqlite_cursor_initial_publication_stage_intrinsic")(
        graph.authority,
        supplied,
        graph.fence,
        graph.reader,
        *extra,
    )


def _authority(graph: _AdoptionGraph) -> Any:
    return outer_module._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        graph.authority
    )


def _assert_unconsumed_healthy(graph: _AdoptionGraph) -> None:
    snapshot = _authority(graph)
    assert snapshot.lifecycle == "active"
    assert snapshot.write_phase == "sequence-zero-complete"
    assert snapshot.initial_stage_adoption_receipt is None
    assert snapshot.initial_stage_adoption_receipt_mint_count == 0
    assert snapshot.receipt_consumption_count == 0
    assert snapshot.tombstone_mint_count == 0
    assert snapshot.migration_0002_consumed_tombstone is None
    assert snapshot.baseline_entries_consumed_tombstone is None
    assert snapshot.baseline_header_consumed_tombstone is None
    assert snapshot.operation_sequence_zero_consumed_tombstone is None


def _opaque_clone(value: object) -> object:
    return object.__new__(type(value))


def _lower_mint(graph: _AdoptionGraph) -> Any:
    state = outer_module._authority_state(graph.authority)
    watermark = _SQLiteCursorInitialPublicationStageWatermark(
        _SQLiteCursorInitialPublicationOuterLedgerWatermark(
            state.affected_rows_watermark,
            state.fixed_statement_count,
            state.logical_write_sequence,
        ),
        SQLITE_CURSOR_INITIAL_PUBLICATION_TARGET_CATALOG_SHA256,
        state.current_total_changes,
        state.current_transaction_epoch,
    )
    return _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(
        graph.connection,
        graph.stage,
        state.receipt,
        state.projection_identity,
        state.transfer,
        graph.authority,
        graph.reader,
        watermark,
    )


_ADOPTION_REGISTRIES = (
    "_INITIAL_STAGE_ADOPTION_RECEIPTS",
    "_INITIAL_STAGE_ADOPTION_TOMBSTONES",
    "_MIGRATION_0002_RECEIPT_CONSUMPTIONS",
    "_BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS",
    "_BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS",
    "_OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS",
)


def _exact_error(call: Callable[[], object], code: str) -> None:
    with pytest.raises(ValueError) as caught:
        call()
    assert str(caught.value) == code


def _registry_keys() -> tuple[tuple[str, int, frozenset[int]], ...]:
    return tuple(
        (name, len(registry), frozenset(registry))
        for name in _ADOPTION_REGISTRIES
        for registry in (getattr(outer_module, name),)
    )


def _stable_value(value: object) -> object:
    if value is None or type(value) in {bool, bytes, float, int, str}:
        return ("value", value)
    if type(value) is tuple:
        return ("tuple", tuple(_stable_value(item) for item in value))
    return ("identity", id(value))


def _slot_state(value: object) -> tuple[tuple[str, object], ...]:
    names: list[str] = []
    if is_dataclass(value):
        names.extend(field.name for field in fields(value))
    else:
        for cls in type(value).__mro__:
            slots = cls.__dict__.get("__slots__", ())
            if type(slots) is str:
                slots = (slots,)
            names.extend(name for name in slots if name != "__weakref__")
    return tuple(
        (name, _stable_value(object.__getattribute__(value, name)))
        for name in dict.fromkeys(names)
        if hasattr(value, name)
    )


def _three_layer_fingerprint(graph: _AdoptionGraph) -> object:
    # Registry snapshots must exclude dead weak-key entries left by earlier
    # graphs; otherwise collection timing looks like mutation by this call.
    gc.collect()
    outer = outer_module._authority_state(graph.authority)
    ownership = ownership_module._read_transfer_metadata(outer.transfer)
    assert ownership is not None
    return (
        _slot_state(outer),
        _slot_state(ownership),
        _slot_state(graph.stage),
        _registry_keys(),
        (
            frozenset(ownership_module._INITIAL_PUBLICATION_ADOPTION_TAILS),
            frozenset(stage_module._CURSOR_INITIAL_PUBLICATION_ADOPTION_TAILS),
            frozenset(stage_module._CURSOR_B2_FENCE_RETIREMENTS),
        ),
    )


def _assert_four_originals_still_authentic(graph: _AdoptionGraph) -> None:
    assert (
        outer_module._read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
            graph.migration
        ).write_kind
        == "migration-0002-catalog-rebuild"
    )
    assert (
        outer_module._assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
            graph.reader,
            graph.entries,
        )
        is graph.entries
    )
    assert (
        outer_module._assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
            graph.reader,
            graph.entries,
            graph.header,
        )
        is graph.header
    )
    assert (
        outer_module._assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
            graph.reader,
            graph.entries,
            graph.header,
            graph.sequence,
        )
        is graph.sequence
    )


def _assert_zero_proof_terminal_poison(
    graph: _AdoptionGraph,
    registries_before: tuple[tuple[str, int, frozenset[int]], ...],
) -> None:
    snapshot = _authority(graph)
    assert snapshot.lifecycle == "poisoned"
    assert snapshot.write_phase == "poisoned"
    assert snapshot.initial_stage_adoption_receipt is None
    assert snapshot.initial_stage_adoption_receipt_mint_count == 0
    assert snapshot.receipt_consumption_count == 0
    assert snapshot.tombstone_mint_count == 0
    assert snapshot.migration_0002_consumed_tombstone is None
    assert snapshot.baseline_entries_consumed_tombstone is None
    assert snapshot.baseline_header_consumed_tombstone is None
    assert snapshot.operation_sequence_zero_consumed_tombstone is None
    assert _registry_keys() == registries_before
    state = outer_module._authority_state(graph.authority)
    ownership = ownership_module._read_transfer_metadata(state.transfer)
    assert ownership is not None and ownership.lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"
    assert graph.stage._cursor_outer_publication_state == "poisoned"


def test_closed_adoption_api_has_only_exact_graph_inputs() -> None:
    adopt = _api("_adopt_sqlite_cursor_initial_publication_stage_intrinsic")
    assert tuple(signature(adopt).parameters) == (
        "authority",
        "bundle",
        "fence",
        "reader_lease",
        "cancellation",
    )
    assert tuple(
        signature(_api("_assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic")).parameters
    ) == (
        "authority",
        "bundle",
        "fence",
        "reader_lease",
        "receipt",
    )
    assert tuple(
        signature(
            _api("_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic")
        ).parameters
    ) == ("receipt",)


def test_valid_control_atomically_exposes_exact_four_four_one_graph(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs(8)
    before = _authority(graph)
    epoch_before = graph.connection.transaction_epoch
    changes_before = graph.connection.total_changes
    generation_before = graph.connection._transaction_generation

    receipt = _adopt(graph)
    read = _api("_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic")
    assert_receipt = _api("_assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic")
    snapshot = read(receipt)
    after = _authority(graph)

    assert type(receipt).__module__ == outer_module.__name__
    assert not hasattr(receipt, "__dict__")
    assert snapshot.authority is graph.authority
    assert snapshot.connection is graph.connection
    assert snapshot.stage is graph.stage
    assert snapshot.receipt is outer_module._authority_state(graph.authority).receipt
    assert snapshot.projection_identity is before.projection_identity
    assert snapshot.projection_reference is before.projection_reference
    assert snapshot.transfer is before.transfer
    assert snapshot.migration_0002_receipt is graph.migration
    assert snapshot.baseline_entries_publication_receipt is graph.entries
    assert snapshot.baseline_header_publication_receipt is graph.header
    assert snapshot.operation_sequence_zero_publication_receipt is graph.sequence
    assert snapshot.post_ddl_catalog_fence is graph.fence
    assert snapshot.reader_lease is graph.reader
    assert snapshot.reader_lease_lifecycle == "retired"
    assert snapshot.reader_close_count == 1
    assert (
        snapshot.reader_rederived_projection_sha256 == before.projection_identity.projection_sha256
    )
    assert snapshot.adopted_outer_ledger == before.outer_ledger
    assert snapshot.adopted_transaction_epoch == epoch_before
    assert snapshot.adopted_total_changes == changes_before
    assert snapshot.transaction_generation is generation_before
    assert snapshot.target_catalog_sha256 == SQLITE_CURSOR_INITIAL_PUBLICATION_TARGET_CATALOG_SHA256
    assert snapshot.mint_count == 1
    assert snapshot.write_kind == "initial-publication-stage-adoption"
    tombstones = (
        snapshot.migration_0002_consumed_tombstone,
        snapshot.baseline_entries_consumed_tombstone,
        snapshot.baseline_header_consumed_tombstone,
        snapshot.operation_sequence_zero_consumed_tombstone,
    )
    assert len({type(value) for value in tombstones}) == 4
    assert all(not hasattr(value, "__dict__") for value in tombstones)
    assert after.lifecycle == "active"
    assert after.write_phase == "initial-stage-adoption-complete"
    assert after.initial_stage_adoption_receipt is receipt
    assert after.initial_stage_adoption_receipt_mint_count == 1
    assert after.receipt_consumption_count == 4
    assert after.tombstone_mint_count == 4
    assert graph.connection.transaction_epoch == epoch_before
    assert graph.connection.total_changes == changes_before
    assert graph.connection._transaction_generation is generation_before
    assert (
        assert_receipt(
            graph.authority,
            graph.bundle,
            graph.fence,
            graph.reader,
            receipt,
        )
        is receipt
    )
    assert (
        outer_module._assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
        )
        is graph.fence
    )


def test_all_malformed_carriers_are_retryable_and_never_dispatch_caller_code(
    adoption_graphs: Any,
) -> None:
    labels = (
        "empty",
        "one",
        "three",
        "five",
        "reordered",
        "duplicate",
        "migration-clone",
        "entries-clone",
        "header-clone",
        "sequence-clone",
        "foreign-migration",
        "foreign-chain",
        "list",
        "mapping",
        "tuple-subclass",
        "hostile-sequence",
    )
    for label in labels:
        graph = adoption_graphs(2)
        migration, entries, header, sequence = graph.bundle
        other = adoption_graphs(2) if label.startswith("foreign-") else None
        hostile_sequence = _HostileSequence()
        candidates: dict[str, object] = {
            "empty": (),
            "one": (migration,),
            "three": (migration, entries, header),
            "five": (migration, entries, header, sequence, sequence),
            "reordered": (migration, header, entries, sequence),
            "duplicate": (migration, entries, entries, sequence),
            "migration-clone": (_opaque_clone(migration), entries, header, sequence),
            "entries-clone": (migration, _opaque_clone(entries), header, sequence),
            "header-clone": (migration, entries, _opaque_clone(header), sequence),
            "sequence-clone": (migration, entries, header, _opaque_clone(sequence)),
            "foreign-migration": (
                other.migration if other is not None else migration,
                entries,
                header,
                sequence,
            ),
            "foreign-chain": (
                migration,
                other.entries if other is not None else entries,
                other.header if other is not None else header,
                other.sequence if other is not None else sequence,
            ),
            "list": [migration, entries, header, sequence],
            "mapping": {0: migration, 1: entries, 2: header, 3: sequence},
            "tuple-subclass": _TupleSubclass(graph.bundle),
            "hostile-sequence": hostile_sequence,
        }
        candidate = candidates[label]
        before = _three_layer_fingerprint(graph)
        expected = (
            "GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE_GRAPH"
            if label.startswith("foreign-")
            else "GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE"
        )
        _exact_error(
            partial(_adopt, graph, candidate),
            expected,
        )
        assert _three_layer_fingerprint(graph) == before
        _assert_unconsumed_healthy(graph)
        if label == "hostile-sequence":
            assert hostile_sequence.calls == 0
        # Every retryable presentation rejection is followed immediately by
        # the corrected exact carrier; no later candidate can hide mutation.
        receipt = _adopt(graph)
        assert _authority(graph).initial_stage_adoption_receipt is receipt


def test_pre_tail_cancellation_allocates_no_public_proof_and_exact_bundle_retries(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    outer_before = _authority(graph)
    registries_before = _registry_keys()
    controller = (
        outer_module._create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    )
    controller.cancel()

    _exact_error(
        lambda: _adopt(graph, None, controller.signal),
        "GE_CURSOR_B3_INITIAL_ADOPTION_CANCELLED",
    )
    _assert_unconsumed_healthy(graph)
    assert _authority(graph) == outer_before
    assert _registry_keys() == registries_before
    _assert_four_originals_still_authentic(graph)

    state = outer_module._authority_state(graph.authority)
    ownership = ownership_module._read_transfer_metadata(state.transfer)
    assert ownership is not None
    assert ownership.lifecycle == "initial-publication-adoption-prepared"
    assert graph.stage._cursor_outer_publication_state == "initial-adoption-prepared"
    prepared_tail = ownership.initial_publication_adoption_tail
    prepared_stage_tail = ownership.initial_publication_adoption_stage_tail
    assert prepared_tail is not None and prepared_stage_tail is not None

    # A second cancelled call must reprove and reuse the exact two prepared
    # continuations. It cannot allocate, register, consume, or replace either.
    _exact_error(
        lambda: _adopt(graph, None, controller.signal),
        "GE_CURSOR_B3_INITIAL_ADOPTION_CANCELLED",
    )
    assert _registry_keys() == registries_before
    assert ownership.initial_publication_adoption_tail is prepared_tail
    assert ownership.initial_publication_adoption_stage_tail is prepared_stage_tail
    assert graph.stage._cursor_initial_publication_adoption_tail is prepared_stage_tail
    _assert_four_originals_still_authentic(graph)

    receipt = _adopt(graph)
    after = _authority(graph)
    assert after.initial_stage_adoption_receipt is receipt
    assert after.initial_stage_adoption_receipt_mint_count == 1
    assert after.receipt_consumption_count == 4
    assert after.tombstone_mint_count == 4
    registry_after = {name: (size, keys) for name, size, keys in _registry_keys()}
    registry_before = {name: (size, keys) for name, size, keys in registries_before}
    expected_deltas = {
        "_INITIAL_STAGE_ADOPTION_RECEIPTS": 1,
        "_INITIAL_STAGE_ADOPTION_TOMBSTONES": 4,
        "_MIGRATION_0002_RECEIPT_CONSUMPTIONS": 1,
        "_BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS": 1,
        "_BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS": 1,
        "_OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS": 1,
    }
    for name, delta in expected_deltas.items():
        before_size, before_keys = registry_before[name]
        after_size, after_keys = registry_after[name]
        assert after_size - before_size == delta
        assert before_keys < after_keys
        new_keys = after_keys - before_keys
        registry = getattr(outer_module, name)
        assert {registry[key].value.lifecycle for key in new_keys} == {"active"}
    assert id(receipt) in (
        registry_after["_INITIAL_STAGE_ADOPTION_RECEIPTS"][1]
        - registry_before["_INITIAL_STAGE_ADOPTION_RECEIPTS"][1]
    )


def test_bytecode_has_one_final_pre_tail_poll_before_the_sealed_atomic_tail() -> None:
    implementation = outer_module._adopt_sqlite_cursor_initial_publication_stage_with_tail_intrinsic
    instructions = tuple(dis.get_instructions(implementation))
    cancelled = tuple(
        instruction
        for instruction in instructions
        if instruction.opname == "LOAD_ATTR" and instruction.argval == "cancelled"
    )
    assert len(cancelled) == 1
    prepare = next(
        instruction
        for instruction in instructions
        if instruction.opname == "LOAD_FAST" and instruction.argval == "prepare_initial_adoption"
    )
    atomic_tail = next(
        instruction
        for instruction in instructions
        if instruction.opname == "LOAD_FAST" and instruction.argval == "atomic_tail"
    )
    assert prepare.offset < cancelled[0].offset < atomic_tail.offset

    implementation_source = getsource(implementation)
    assert implementation_source.count("cancellation_state.cancelled") == 1
    assert implementation_source.index("lower_mint =") < implementation_source.index(
        "cancellation_state.cancelled"
    )
    assert implementation_source.index("cancellation_state.cancelled") < (
        implementation_source.index("return atomic_tail(")
    )

    # Allocation and all registrations live only in the sealed synchronous
    # tail. No constructor or registry call exists on the cancellable path.
    tail = outer_module._INITIAL_ADOPTION_ATOMIC_TAIL
    # The public sealed callable is now a terminal-failure wrapper.  Inspect
    # its captured implementation to keep the allocation/registration/order
    # assertions attached to the code that performs those operations.
    perform_tail = getclosurevars(tail).nonlocals["perform_tail"]
    tail_source = getsource(perform_tail)
    assert 'lifecycle="pending"' in tail_source
    assert tail_source.count("mint(") == 5
    assert tail_source.count("identity_set(") == 9
    assert tail_source.index("identity_set(adoption_receipts") < tail_source.index(
        "publish_lower(lower_tail)"
    )
    assert tail_source.index("publish_lower(lower_tail)") < tail_source.index(
        'adoption_record.lifecycle = "active"'
    )
    assert {
        "adoption_receipt_type",
        "migration_tombstone_type",
        "entries_tombstone_type",
        "header_tombstone_type",
        "sequence_tombstone_type",
        "publish_lower",
    }.issubset(perform_tail.__code__.co_freevars)

    # A pending receipt can never reach snapshot materialization: read always
    # delegates to assert, whose first lifecycle gate requires active.
    read_source = getsource(
        outer_module._read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic
    )
    assert_source = getsource(
        outer_module._assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic
    )
    assert "_assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic(" in read_source
    assert 'record.lifecycle != "active"' in assert_source


def test_presentation_and_cancellation_validation_precedence_is_exact_and_retryable(
    adoption_graphs: Any,
) -> None:
    cancelled_graph = adoption_graphs()
    controller = (
        outer_module._create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    )
    controller.cancel()
    before = _three_layer_fingerprint(cancelled_graph)
    _exact_error(
        lambda: _api("_adopt_sqlite_cursor_initial_publication_stage_intrinsic")(
            cancelled_graph.authority,
            cancelled_graph.bundle[:3],
            cancelled_graph.fence,
            cancelled_graph.reader,
            controller.signal,
        ),
        "GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE",
    )
    assert _three_layer_fingerprint(cancelled_graph) == before
    assert _adopt(cancelled_graph) is not None

    invalid_signal_graph = adoption_graphs()
    invalid_signal = _opaque_clone(controller.signal)
    before = _three_layer_fingerprint(invalid_signal_graph)
    _exact_error(
        lambda: _api("_adopt_sqlite_cursor_initial_publication_stage_intrinsic")(
            invalid_signal_graph.authority,
            invalid_signal_graph.bundle,
            invalid_signal_graph.fence,
            invalid_signal_graph.reader,
            invalid_signal,
        ),
        "GE_CURSOR_B3_POST_DDL_READER_CANCELLATION",
    )
    assert _three_layer_fingerprint(invalid_signal_graph) == before
    assert _adopt(invalid_signal_graph) is not None


_VALIDATION_FAULT_SLOTS = (
    ("authority-owner-snapshot", "_owner_snapshot"),
    ("migration-receipt-proof", "_READ_MIGRATION_0002_ASSET"),
    ("entries-receipt-proof", "_VERIFY_BASELINE_ENTRIES_FRAME"),
    ("header-receipt-proof", "_VERIFY_BASELINE_HEADER_FRAME"),
    ("sequence-receipt-proof", "_VERIFY_OPERATION_SEQUENCE_ZERO_FRAME"),
    ("fresh-target-catalog", "_READ_VALIDATED_TARGET_CATALOG"),
    ("reader-terminal", "_OWNERSHIP_ASSERT_POST_DDL_READER_TERMINAL"),
    ("reader-projection", "_same_projection_identity"),
    ("stage-watermark", "_initial_adoption_watermark"),
)


@pytest.mark.parametrize(
    ("slot", "dependency"),
    _VALIDATION_FAULT_SLOTS,
)  # type: ignore[untyped-decorator]
def test_each_authenticated_validation_fault_slot_is_terminal_before_allocation(
    adoption_graphs: Any,
    monkeypatch: pytest.MonkeyPatch,
    slot: str,
    dependency: str,
) -> None:
    graph = adoption_graphs()
    registries_before = _registry_keys()
    failure = ValueError(f"GE_TEST_INITIAL_ADOPTION_SLOT_{slot.upper().replace('-', '_')}")

    def fail_slot(*_args: object, **_kwargs: object) -> object:
        raise failure

    monkeypatch.setattr(outer_module, dependency, fail_slot)
    with pytest.raises(ValueError) as caught:
        _adopt(graph)
    assert caught.value is failure
    _assert_zero_proof_terminal_poison(graph, registries_before)


def test_lower_prepare_failure_is_terminal_and_never_reaches_the_real_atomic_tail(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    registries_before = _registry_keys()
    failure = ValueError("GE_TEST_INITIAL_ADOPTION_SLOT_LOWER_PREPARE")
    prepare_calls = 0

    def fail_prepare(*_args: object, **_kwargs: object) -> object:
        nonlocal prepare_calls
        prepare_calls += 1
        raise failure

    with pytest.raises(ValueError) as caught:
        outer_module._adopt_sqlite_cursor_initial_publication_stage_with_tail_intrinsic(
            graph.authority,
            graph.bundle,
            graph.fence,
            graph.reader,
            None,
            outer_module._INITIAL_ADOPTION_ATOMIC_TAIL,
            fail_prepare,
        )
    assert caught.value is failure
    assert prepare_calls == 1
    _assert_zero_proof_terminal_poison(graph, registries_before)


def test_wrong_fence_and_reader_identities_are_retryable_with_zero_consumption(
    adoption_graphs: Any,
) -> None:
    adopt = _api("_adopt_sqlite_cursor_initial_publication_stage_intrinsic")
    labels = (
        "foreign-fence",
        "foreign-reader",
        "reader-clone",
        "missing-reader",
    )
    for label in labels:
        graph = adoption_graphs()
        other = adoption_graphs() if label.startswith("foreign-") else None
        fence = other.fence if label == "foreign-fence" and other is not None else graph.fence
        readers = {
            "foreign-reader": other.reader if other is not None else graph.reader,
            "reader-clone": _opaque_clone(graph.reader),
            "missing-reader": None,
            "foreign-fence": graph.reader,
        }
        reader = readers[label]
        before = _three_layer_fingerprint(graph)
        expected = (
            "GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE_GRAPH"
            if label.startswith("foreign-")
            else "GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE"
        )
        _exact_error(
            partial(adopt, graph.authority, graph.bundle, fence, reader),
            expected,
        )
        assert _three_layer_fingerprint(graph) == before
        _assert_unconsumed_healthy(graph)
        assert _adopt(graph) is not None


def test_cancelled_preparation_still_reproves_all_live_state_before_retry(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    controller = (
        outer_module._create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    )
    controller.cancel()
    with pytest.raises(ValueError, match=r"CANCEL|UNAVAILABLE"):
        _adopt(graph, None, controller.signal)
    _assert_unconsumed_healthy(graph)

    cursor = graph.connection.execute(
        "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
    )
    cursor.close()
    with pytest.raises(ValueError, match=r"LEDGER|CHANGE|DRIFT|TRANSACTION_CHANGED"):
        _adopt(graph)
    after = _authority(graph)
    assert after.lifecycle == "poisoned"
    assert after.receipt_consumption_count == 0
    assert after.tombstone_mint_count == 0
    assert after.initial_stage_adoption_receipt_mint_count == 0


def test_authentic_lower_tail_publishes_once_and_replay_is_rejected(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    mint = _lower_mint(graph)
    state = outer_module._authority_state(graph.authority)

    _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(mint.tail)
    assert (
        _assert_sqlite_cursor_stage_ownership_initial_publication_adopted_intrinsic(
            graph.connection,
            graph.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            graph.authority,
            graph.reader,
            mint.retired_b2_fence,
            mint.watermark,
        )
        is state.transfer
    )
    with pytest.raises(ValueError, match=r"adoption tail is invalid"):
        _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(mint.tail)


@pytest.mark.parametrize("terminal", ["retire", "poison"])  # type: ignore[untyped-decorator]
def test_lower_tail_cannot_publish_or_revive_after_terminal_action(
    adoption_graphs: Any,
    terminal: str,
) -> None:
    graph = adoption_graphs()
    mint = _lower_mint(graph)
    state = outer_module._authority_state(graph.authority)

    if terminal == "retire":
        _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
            state.transfer, graph.authority
        )
    else:
        with pytest.raises(ValueError, match="hostile prepared adoption poison"):
            _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
                state.transfer,
                graph.authority,
                "hostile prepared adoption poison",
            )
    with pytest.raises(ValueError, match=r"adoption tail is invalid"):
        _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic(mint.tail)


def test_adoption_capabilities_remain_package_private() -> None:
    for name in (
        "adopt_sqlite_cursor_initial_publication_stage_intrinsic",
        "assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic",
        "read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic",
        "SQLiteCursorInitialStageAdoptionReceipt",
    ):
        assert not hasattr(graph_engineering, name)


def test_every_consumed_original_rejects_assert_and_read_but_fence_survives(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    _adopt(graph)
    proofs: tuple[Callable[[], object], ...] = (
        lambda: outer_module._read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
            graph.migration
        ),
        lambda: outer_module._assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
            graph.reader,
            graph.entries,
        ),
        lambda: outer_module._read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(
            graph.entries
        ),
        lambda: outer_module._assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
            graph.reader,
            graph.entries,
            graph.header,
        ),
        lambda: outer_module._read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(
            graph.header
        ),
        lambda: (
            outer_module._assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic(
                graph.authority,
                graph.migration,
                graph.fence,
                graph.reader,
                graph.entries,
                graph.header,
                graph.sequence,
            )
        ),
        lambda: (
            outer_module._read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
                graph.sequence
            )
        ),
    )
    for proof in proofs:
        with pytest.raises(ValueError, match=r"CONSUMED|consumed"):
            proof()
    assert (
        outer_module._assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
        )
        is graph.fence
    )
    after = _authority(graph)
    assert after.lifecycle == "active"
    assert after.write_phase == "initial-stage-adoption-complete"
    assert after.receipt_consumption_count == 4


def test_cloned_and_cross_graph_adoption_receipts_are_never_forgery(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    other = adoption_graphs()
    substituted = adoption_graphs()
    receipt = _adopt(graph)
    other_receipt = _adopt(other)
    substituted_receipt = _adopt(substituted)
    clone = _opaque_clone(receipt)
    read = _api("_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic")
    assert_receipt = _api("_assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic")

    with pytest.raises(ValueError, match=r"RECEIPT|INVALID|invalid"):
        read(clone)
    with pytest.raises(ValueError, match=r"SUBSTITUT|substitut|CORRUPTION"):
        assert_receipt(
            graph.authority,
            graph.bundle,
            graph.fence,
            graph.reader,
            clone,
        )
    assert _authority(graph).lifecycle == "poisoned"

    with pytest.raises(ValueError, match=r"SUBSTITUT|substitut|CORRUPTION"):
        assert_receipt(
            other.authority,
            other.bundle,
            other.fence,
            other.reader,
            substituted_receipt,
        )
    assert _authority(other).lifecycle == "poisoned"
    assert read(substituted_receipt).authority is substituted.authority
    assert other_receipt is not substituted_receipt


def test_replay_is_terminal_and_never_exposes_a_second_partial_result(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    receipt = _adopt(graph)

    with pytest.raises(ValueError, match=r"REPLAY|REUS|reus|CONSUMED|consumed"):
        _adopt(graph)
    after = _authority(graph)
    assert after.lifecycle == "poisoned"
    assert after.write_phase == "poisoned"
    assert after.initial_stage_adoption_receipt is receipt
    assert after.initial_stage_adoption_receipt_mint_count == 1
    assert after.receipt_consumption_count == 4
    assert after.tombstone_mint_count == 4


def test_transaction_epoch_drift_is_terminal_with_zero_consumption(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    cursor = graph.connection.execute(
        "CREATE TEMP TABLE hostile_adoption_epoch(value INTEGER NOT NULL)"
    )
    cursor.close()

    with pytest.raises(ValueError, match=r"LEDGER|EPOCH|DRIFT|TRANSACTION_CHANGED"):
        _adopt(graph)
    after = _authority(graph)
    assert after.lifecycle == "poisoned"
    assert after.initial_stage_adoption_receipt_mint_count == 0
    assert after.receipt_consumption_count == 0
    assert after.tombstone_mint_count == 0


def test_total_changes_drift_is_terminal_with_zero_consumption(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    cursor = graph.connection.execute(
        "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
    )
    cursor.close()

    with pytest.raises(ValueError, match=r"LEDGER|CHANGE|DRIFT"):
        _adopt(graph)
    after = _authority(graph)
    assert after.lifecycle == "poisoned"
    assert after.initial_stage_adoption_receipt_mint_count == 0
    assert after.receipt_consumption_count == 0
    assert after.tombstone_mint_count == 0


def test_transaction_lineage_replacement_is_terminal_with_zero_consumption(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs()
    graph.connection.rollback()
    cursor = graph.connection.execute("BEGIN EXCLUSIVE")
    cursor.close()

    with pytest.raises(ValueError, match=r"LINEAGE|STALE|RETIRED|DRIFT"):
        _adopt(graph)
    after = _authority(graph)
    assert after.lifecycle in {"poisoned", "retired"}
    assert after.initial_stage_adoption_receipt_mint_count == 0
    assert after.receipt_consumption_count == 0
    assert after.tombstone_mint_count == 0


def test_adoption_executes_no_write_sql_transaction_control_or_cursor_rebind(
    adoption_graphs: Any,
) -> None:
    graph = adoption_graphs(3)
    raw = _raw(graph.connection)
    statements: list[str] = []
    raw.set_trace_callback(statements.append)
    epoch_before = graph.connection.transaction_epoch
    changes_before = graph.connection.total_changes
    generation_before = graph.connection._transaction_generation
    connection_identity = id(graph.connection)
    try:
        _adopt(graph)
    finally:
        raw.set_trace_callback(None)

    controls = {
        statement.lstrip().split(maxsplit=1)[0].upper()
        for statement in statements
        if statement.strip()
    }
    forbidden = {
        "BEGIN",
        "COMMIT",
        "ROLLBACK",
        "SAVEPOINT",
        "RELEASE",
        "INSERT",
        "UPDATE",
        "DELETE",
    }
    assert controls.isdisjoint(forbidden)
    assert graph.connection.transaction_epoch == epoch_before
    assert graph.connection.total_changes == changes_before
    assert graph.connection._transaction_generation is generation_before
    assert id(graph.connection) == connection_identity


def test_adoption_record_has_only_weak_graph_edges_and_scalar_commitments() -> None:
    record_type = _api("_InitialStageAdoptionReceiptRecord")
    fields = set(record_type.__dataclass_fields__)
    assert {
        "authority",
        "bundle",
        "connection",
        "stage",
        "receipt",
        "projection_identity",
        "projection_reference",
        "transfer",
        "fence",
        "reader_lease",
        "migration_0002_receipt",
        "baseline_entries_publication_receipt",
        "baseline_header_publication_receipt",
        "operation_sequence_zero_publication_receipt",
        "snapshot",
        "tail",
        "cursor",
        "exception",
        "traceback",
    }.isdisjoint(fields)
    assert any(name.endswith("_ref") for name in fields)
    assert any(name.endswith("_id") for name in fields)
    assert {"lifecycle", "mint_count", "write_kind"}.issubset(fields)


def test_adoption_receipt_registry_releases_dead_graph_and_receipt_key() -> None:
    graph = _AdoptionGraph()
    receipt = _adopt(graph)
    receipt_ref = ref(receipt)
    authority_ref = ref(graph.authority)
    receipt_id = id(receipt)
    registry = _api("_INITIAL_STAGE_ADOPTION_RECEIPTS")
    assert receipt_id in registry

    graph.close()
    del receipt
    del graph
    for _ in range(8):
        gc.collect()
        if receipt_ref() is None and authority_ref() is None:
            break
    assert receipt_ref() is None
    assert authority_ref() is None
    assert receipt_id not in registry
