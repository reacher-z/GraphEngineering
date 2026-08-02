from __future__ import annotations

import dis
import inspect
from collections.abc import Callable
from typing import Any

import pytest

import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as ownership
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_cursor_publication_initial_stage_adoption import (
    _adopt,
    _AdoptionGraph,
    _api,
    _authority,
    _registry_keys,
    _three_layer_fingerprint,
)
from tests.test_sqlite_cursor_publication_initial_stage_adoption_hostile import (
    _assert_complete_three_layer_poison,
    _identity_record,
)


@pytest.fixture  # type: ignore[untyped-decorator]
def contract_graphs() -> Any:
    graphs: list[_AdoptionGraph] = []

    def create(legacy_count: int = 1) -> _AdoptionGraph:
        graph = _AdoptionGraph(legacy_count)
        graphs.append(graph)
        return graph

    yield create
    for graph in reversed(graphs):
        graph.close()


def _assert_zero_new_proofs_and_three_layer_poison(
    graph: _AdoptionGraph,
    registries_before: tuple[tuple[str, int, frozenset[int]], ...],
) -> None:
    snapshot = _authority(graph)
    assert snapshot.initial_stage_adoption_receipt is None
    assert snapshot.initial_stage_adoption_receipt_mint_count == 0
    assert snapshot.receipt_consumption_count == 0
    assert snapshot.tombstone_mint_count == 0
    assert _registry_keys() == registries_before
    _assert_complete_three_layer_poison(graph)


def _cancel_into_prepared(graph: _AdoptionGraph) -> None:
    controller = outer._create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    controller.cancel()
    with pytest.raises(ValueError, match="INITIAL_ADOPTION_CANCELLED"):
        _adopt(graph, None, controller.signal)
    state = outer._authority_state(graph.authority)
    metadata = ownership._read_transfer_metadata(state.transfer)
    assert metadata is not None
    assert metadata.lifecycle == "initial-publication-adoption-prepared"
    assert graph.stage._cursor_outer_publication_state == "initial-adoption-prepared"


_TAIL_OUTPUT_REGISTRIES = (
    outer._INITIAL_STAGE_ADOPTION_RECEIPTS,
    outer._INITIAL_STAGE_ADOPTION_TOMBSTONES,
    outer._MIGRATION_0002_RECEIPT_CONSUMPTIONS,
    outer._BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
    outer._BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
    outer._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
)


def _make_faulting_atomic_tail(
    failure: BaseException,
    family: str,
    fail_at: int,
) -> Callable[..., object]:
    calls = 0

    def next_call() -> None:
        nonlocal calls
        calls += 1
        if calls == fail_at:
            raise failure

    def object_new(proof_type: type[object]) -> object:
        if family == "allocation":
            next_call()
        return object.__new__(proof_type)

    def weak_reference(value: object, *args: object) -> object:
        if family == "weak-reference":
            next_call()
        return outer._REF(value, *args)

    def dictionary_set(registry: dict[int, object], key: int, value: object) -> None:
        if family == "registration":
            next_call()
        dict.__setitem__(registry, key, value)

    def adoption_record(*args: object, **kwargs: object) -> object:
        if family == "record":
            next_call()
        return outer._InitialStageAdoptionReceiptRecord(*args, **kwargs)

    def consumption_record(*args: object, **kwargs: object) -> object:
        if family == "record":
            next_call()
        return outer._ConsumedReceiptTombstoneRecord(*args, **kwargs)

    return outer._make_initial_adoption_atomic_tail(
        publish_lower=outer._OWNERSHIP_PUBLISH_INITIAL_ADOPTION,
        poison_lower=outer._OWNERSHIP_POISON,
        object_new=object_new,
        adoption_receipt_type=outer._SQLiteCursorInitialStageAdoptionReceipt,
        migration_tombstone_type=(outer._SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone),
        entries_tombstone_type=(outer._SQLiteBaselineEntriesPublicationReceiptConsumedTombstone),
        header_tombstone_type=(outer._SQLiteBaselineHeaderPublicationReceiptConsumedTombstone),
        sequence_tombstone_type=(
            outer._SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone
        ),
        adoption_record_type=adoption_record,
        consumption_record_type=consumption_record,
        identity_entry_type=outer._IdentityEntry,
        identity=outer._ID,
        weak_reference=weak_reference,
        dictionary_get=outer._DICT_GET,
        dictionary_set=dictionary_set,
        dictionary_pop=outer._DICT_POP,
        exception_type=BaseException,
        adoption_receipts=outer._INITIAL_STAGE_ADOPTION_RECEIPTS,
        adoption_tombstones=outer._INITIAL_STAGE_ADOPTION_TOMBSTONES,
        migration_consumptions=outer._MIGRATION_0002_RECEIPT_CONSUMPTIONS,
        entries_consumptions=outer._BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
        header_consumptions=outer._BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
        sequence_consumptions=(outer._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS),
        target_catalog_sha256=(outer.SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256),
    )


@pytest.mark.parametrize(
    ("family", "fail_at"),
    (
        *(("allocation", slot) for slot in range(1, 6)),
        *(("record", slot) for slot in range(1, 6)),
        *(("registration", slot) for slot in range(1, 10)),
        *(("weak-reference", slot) for slot in (1, 16, 17, 24, 25, 33)),
    ),
)  # type: ignore[untyped-decorator]
def test_every_atomic_tail_construction_and_registration_fault_is_terminal(
    contract_graphs: Any,
    family: str,
    fail_at: int,
) -> None:
    graph = contract_graphs(1)
    state = outer._authority_state(graph.authority)
    before_keys = tuple(frozenset(registry) for registry in _TAIL_OUTPUT_REGISTRIES)
    failure = RuntimeError(f"GE_TEST_ATOMIC_TAIL_{family}_{fail_at}")
    tail = _make_faulting_atomic_tail(failure, family, fail_at)

    with pytest.raises(RuntimeError) as caught:
        outer._adopt_sqlite_cursor_initial_publication_stage_with_tail_intrinsic(
            graph.authority,
            graph.bundle,
            graph.fence,
            graph.reader,
            None,
            tail,
            outer._OWNERSHIP_PREPARE_INITIAL_ADOPTION,
        )
    assert caught.value is failure
    assert state.migration_0002_consumed_tombstone is None
    assert state.baseline_entries_consumed_tombstone is None
    assert state.baseline_header_consumed_tombstone is None
    assert state.operation_sequence_zero_consumed_tombstone is None
    assert state.initial_stage_adoption_receipt is None
    _assert_complete_three_layer_poison(graph)

    for registry, keys_before in zip(_TAIL_OUTPUT_REGISTRIES, before_keys, strict=True):
        for key, entry in tuple(registry.items()):
            if key not in keys_before:
                assert entry.value.lifecycle == "poisoned"

    with pytest.raises(ValueError):
        _adopt(graph)


def test_exact_success_formulas_receipt_sequence_and_every_write_counter(
    contract_graphs: Any,
) -> None:
    graph = contract_graphs(8)
    state = outer._authority_state(graph.authority)
    projection = state.projection_identity
    migration = _identity_record(outer._MIGRATION_0002_RECEIPTS, graph.migration).snapshot
    entries = _identity_record(outer._BASELINE_ENTRIES_PUBLICATION_RECEIPTS, graph.entries)
    header = _identity_record(outer._BASELINE_HEADER_PUBLICATION_RECEIPTS, graph.header)
    sequence = _identity_record(
        outer._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS,
        graph.sequence,
    )

    assert state.logical_write_sequence == 4
    assert state.fixed_statement_count == 20 + projection.entry_count + 2
    assert state.affected_rows_watermark == 3 + projection.legacy_operation_count + (
        projection.entry_count
    )
    assert tuple(
        receipt.outer_ledger_before.logical_write_sequence
        for receipt in (migration, entries, header, sequence)
    ) == (0, 1, 2, 3)
    assert tuple(
        receipt.outer_ledger_after.logical_write_sequence
        for receipt in (migration, entries, header, sequence)
    ) == (1, 2, 3, 4)
    assert migration.outer_ledger_after == entries.outer_ledger_before
    assert entries.outer_ledger_after == header.outer_ledger_before
    assert header.outer_ledger_after == sequence.outer_ledger_before
    assert sequence.outer_ledger_after == outer._outer_ledger_snapshot(state)

    assert state.migration_0002_logical_execution_count == 1
    assert state.migration_0002_prepared_statement_count == 20
    assert state.baseline_entries_logical_execution_count == 1
    assert state.baseline_entries_prepare_count == 1
    assert state.baseline_entries_execute_count == projection.entry_count
    assert state.baseline_entries_affected_rows == projection.entry_count
    assert state.baseline_header_logical_execution_count == 1
    assert state.baseline_header_prepare_count == 1
    assert state.baseline_header_execute_count == 1
    assert state.baseline_header_affected_rows == 1
    assert state.operation_sequence_zero_logical_execution_count == 1
    assert state.operation_sequence_zero_prepare_count == 1
    assert state.operation_sequence_zero_execute_count == 1
    assert state.operation_sequence_zero_affected_rows == 1
    assert _adopt(graph) is not None


@pytest.mark.parametrize(
    ("surface", "field", "tampered"),
    tuple(
        (surface, field, tampered)
        for surface in ("assert", "read")
        for field, tampered in (
            ("prepare_count", 0),
            ("execute_count", 0),
            ("ownership_acquisition_count", 0),
            ("retained_entries", ()),
            ("expected_projection_sha256", "0" * 64),
        )
    ),
)  # type: ignore[untyped-decorator]
def test_post_adoption_receipt_surfaces_reprove_full_reader_terminal_contract(
    contract_graphs: Any,
    surface: str,
    field: str,
    tampered: object,
) -> None:
    graph = contract_graphs(3)
    receipt = _adopt(graph)
    reader = _identity_record(
        outer._POST_DDL_PUBLICATION_READER_LEASES,
        graph.reader,
    )
    setattr(reader, field, tampered)

    with pytest.raises(ValueError):
        if surface == "assert":
            _api("_assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic")(
                graph.authority,
                graph.bundle,
                graph.fence,
                graph.reader,
                receipt,
            )
        else:
            _api("_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic")(receipt)

    state = outer._authority_state(graph.authority)
    metadata = ownership._read_transfer_metadata(state.transfer)
    assert state.lifecycle == "poisoned"
    assert state.write_phase == "poisoned"
    assert state.initial_stage_adoption_receipt is receipt
    assert state.initial_stage_adoption_receipt_mint_count == 1
    assert state.receipt_consumption_count == 4
    assert state.tombstone_mint_count == 4
    assert metadata is not None and metadata.lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"
    assert graph.stage._cursor_transfer_state == "poisoned"
    assert graph.stage._cursor_outer_publication_state == "poisoned"
    assert graph.stage._cursor_b2_catalog_change_fence_state == "poisoned"


def test_recursive_outer_ownership_and_stage_tail_forbidden_effect_audit() -> None:
    outer_tail = outer._INITIAL_ADOPTION_ATOMIC_TAIL
    outer_closure = inspect.getclosurevars(outer_tail)
    perform_tail = outer_closure.nonlocals["perform_tail"]
    perform_closure = inspect.getclosurevars(perform_tail)
    lower_tail = perform_closure.nonlocals["publish_lower"]
    stage_tail = inspect.signature(lower_tail).parameters["_stage_publish"].default
    assert stage_tail is SQLiteV1BaselineTempStage._publish_cursor_initial_publication_adoption

    forbidden_names = {
        "cancel",
        "cancelled",
        "cancellation",
        "commit",
        "execute",
        "executescript",
        "prepare",
        "provider",
        "rebind",
        "rollback",
        "test_hook",
    }
    forbidden_fragments = (
        ".cancel(",
        ".commit(",
        ".execute(",
        ".executescript(",
        ".prepare(",
        ".rollback(",
        "cancellation",
        "provider",
        "rebind",
        "test_hook",
    )
    for function in (outer_tail, perform_tail, lower_tail, stage_tail):
        source = inspect.getsource(function).lower()
        instructions = tuple(dis.get_instructions(function))
        assert not any(
            instruction.opname in {"IMPORT_FROM", "IMPORT_NAME"} for instruction in instructions
        )
        assert forbidden_names.isdisjoint(function.__code__.co_names)
        assert all(fragment not in source for fragment in forbidden_fragments)
    assert outer_closure.globals == {}
    assert outer_closure.unbound == set()
    assert perform_closure.globals == {}


@pytest.mark.parametrize("slot", range(4))  # type: ignore[untyped-decorator]
def test_foreign_typed_tombstone_in_each_slot_is_retryable_and_non_mutating(
    contract_graphs: Any,
    slot: int,
) -> None:
    graph = contract_graphs(2)
    consumed = contract_graphs(2)
    consumed_receipt = _adopt(consumed)
    consumed_snapshot = _api(
        "_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic"
    )(consumed_receipt)
    tombstones = (
        consumed_snapshot.migration_0002_consumed_tombstone,
        consumed_snapshot.baseline_entries_consumed_tombstone,
        consumed_snapshot.baseline_header_consumed_tombstone,
        consumed_snapshot.operation_sequence_zero_consumed_tombstone,
    )
    candidate = list(graph.bundle)
    candidate[slot] = tombstones[slot]
    malformed = tuple(candidate)
    before = _three_layer_fingerprint(graph)

    with pytest.raises(ValueError, match="INITIAL_ADOPTION_BUNDLE"):
        _adopt(graph, malformed)
    assert _three_layer_fingerprint(graph) == before
    assert _authority(graph).receipt_consumption_count == 0
    assert _authority(graph).tombstone_mint_count == 0
    assert _authority(graph).initial_stage_adoption_receipt_mint_count == 0
    assert _adopt(graph) is not None
