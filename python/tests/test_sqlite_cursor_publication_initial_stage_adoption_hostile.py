from __future__ import annotations

import dis
import gc
import inspect
from collections.abc import Callable, Iterator
from typing import Any
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as ownership
import graph_engineering.sqlite_operation_baseline_stage as stage_module
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)
from tests.test_sqlite_cursor_publication_initial_stage_adoption import (
    _adopt,
    _AdoptionGraph,
    _api,
    _authority,
)
from tests.test_sqlite_cursor_publication_migration_0002_execution import _raw


@pytest.fixture
def hostile_graphs() -> Iterator[Callable[[int], _AdoptionGraph]]:
    graphs: list[_AdoptionGraph] = []

    def create(legacy_count: int = 1) -> _AdoptionGraph:
        graph = _AdoptionGraph(legacy_count)
        graphs.append(graph)
        return graph

    yield create
    for graph in reversed(graphs):
        graph.close()


def _identity_record(registry: dict[int, Any], key: object) -> Any:
    entry = dict.get(registry, id(key))
    assert entry is not None
    assert entry.key_ref() is key
    return entry.value


def _transfer_metadata(graph: _AdoptionGraph) -> Any:
    metadata = ownership._TRANSFERS.get(outer._authority_state(graph.authority).transfer)
    assert metadata is not None
    return metadata


def _assert_complete_three_layer_poison(graph: _AdoptionGraph) -> None:
    state = outer._authority_state(graph.authority)
    metadata = ownership._TRANSFERS.get(state.transfer)
    assert state.lifecycle == "poisoned"
    assert state.write_phase == "poisoned"
    assert state.stage_ownership_poison_reason is not None
    assert state.receipt_consumption_count == 0
    assert state.tombstone_mint_count == 0
    assert state.initial_stage_adoption_receipt_mint_count == 0
    assert metadata is not None
    assert metadata.lifecycle == "poisoned"
    assert graph.stage.state == "poisoned"
    assert graph.stage._cursor_transfer_state == "poisoned"
    assert graph.stage._cursor_outer_publication_state == "poisoned"
    assert graph.stage._cursor_b2_catalog_change_fence_state == "poisoned"


def _corrupt_exact_graph(graph: _AdoptionGraph, family: str) -> None:
    state = outer._authority_state(graph.authority)
    metadata = _transfer_metadata(graph)
    if family == "authority-lifecycle":
        state.lifecycle = "inactive"
    elif family == "transfer-lifecycle":
        metadata.lifecycle = "pre-rebind-complete"
    elif family == "stage-lifecycle":
        graph.stage._cursor_outer_publication_state = "retired"
    elif family == "transaction-generation":
        graph.connection.rollback()
        graph.connection.execute("BEGIN EXCLUSIVE").close()
    elif family == "transaction-epoch":
        graph.connection.execute(
            "CREATE TEMP TABLE hostile_initial_adoption_epoch(value INTEGER NOT NULL)"
        ).close()
    elif family == "total-changes":
        graph.connection.execute(
            "UPDATE main.ge_cycle_schema SET current_version = current_version WHERE singleton = 1"
        ).close()
    elif family == "write-counter":
        state.operation_sequence_zero_execute_count = 0
    elif family == "target-catalog":
        record = _identity_record(outer._POST_DDL_CATALOG_FENCES, graph.fence)
        object.__setattr__(record, "catalog_sha256", "0" * 64)
    elif family == "terminal-reader":
        reader = _identity_record(
            outer._POST_DDL_PUBLICATION_READER_LEASES,
            graph.reader,
        )
        reader.lifecycle = "reader-closed"
    elif family == "outer-ledger":
        state.logical_write_sequence = 3
    else:  # pragma: no cover - the parameter list is the closed authority
        raise AssertionError(f"unknown corruption family: {family}")


@pytest.mark.parametrize(
    "family",
    (
        "authority-lifecycle",
        "transfer-lifecycle",
        "stage-lifecycle",
        "transaction-generation",
        "transaction-epoch",
        "total-changes",
        "write-counter",
        "target-catalog",
        "terminal-reader",
        "outer-ledger",
    ),
)
def test_every_authenticated_graph_corruption_poisons_all_three_layers(
    hostile_graphs: Callable[[int], _AdoptionGraph],
    family: str,
) -> None:
    graph = hostile_graphs(2)
    _corrupt_exact_graph(graph, family)

    with pytest.raises(ValueError):
        _adopt(graph)

    _assert_complete_three_layer_poison(graph)


def test_success_retires_exact_b2_fence_and_rejects_the_old_owner(
    hostile_graphs: Callable[[int], _AdoptionGraph],
) -> None:
    graph = hostile_graphs(3)
    state = outer._authority_state(graph.authority)
    metadata = _transfer_metadata(graph)

    adoption_receipt = _adopt(graph)
    snapshot = _api("_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic")(
        adoption_receipt
    )

    assert metadata.lifecycle == "initial-publication-adopted"
    assert metadata.initial_publication_adoption_retired_b2_fence is snapshot.retired_b2_fence
    assert graph.stage._cursor_b2_catalog_change_fence_state == "retired"
    assert graph.stage._cursor_b2_catalog_change_fence_retirement is snapshot.retired_b2_fence
    assert graph.stage._cursor_outer_publication_state == "initial-publication-adopted"
    assert (
        ownership._assert_sqlite_cursor_stage_ownership_transfer(
            graph.connection,
            graph.stage,
            state.receipt,
            state.transfer,
        )
        is state.transfer
    )
    with pytest.raises(ValueError, match="outer publication ownership is invalid"):
        ownership._assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic(
            graph.connection,
            graph.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            graph.authority,
        )
    adoption_record = _identity_record(
        outer._INITIAL_STAGE_ADOPTION_RECEIPTS,
        adoption_receipt,
    )
    assert snapshot.retired_b2_fence is not None
    forged_retirement = object.__new__(type(snapshot.retired_b2_fence))
    with pytest.raises(ValueError):
        ownership._assert_sqlite_cursor_stage_ownership_initial_publication_adopted_intrinsic(
            graph.connection,
            graph.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            graph.authority,
            graph.reader,
            forged_retirement,
            adoption_record.watermark,
        )


def _hostile(name: str) -> Callable[..., Any]:
    def fail(*_args: object, **_kwargs: object) -> Any:
        raise AssertionError(f"runtime dependency was not captured: {name}")

    return fail


def test_adoption_survives_hostile_module_alias_replacement_after_graph_preparation(
    hostile_graphs: Callable[[int], _AdoptionGraph],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = hostile_graphs(2)
    adopt = _api("_adopt_sqlite_cursor_initial_publication_stage_intrinsic")
    replacements = (
        (outer, "_ID"),
        (outer, "_TYPE"),
        (outer, "_REF"),
        (outer, "_DICT_GET"),
        (outer, "_DICT_SETITEM"),
        (outer, "_DICT_POP"),
        (outer, "_TUPLE_LEN"),
        (outer, "_TUPLE_GETITEM"),
        (outer, "_OWNERSHIP_PREPARE_INITIAL_ADOPTION"),
        (outer, "_OWNERSHIP_PUBLISH_INITIAL_ADOPTION"),
        (outer, "_INITIAL_ADOPTION_ATOMIC_TAIL"),
        (ownership, "_DICT_GET"),
        (ownership, "_DICT_POP"),
        (stage_module, "_DICT_GET"),
        (stage_module, "_DICT_POP"),
        (outer, "id"),
        (outer, "type"),
        (outer, "ref"),
        (ownership, "id"),
        (ownership, "type"),
        (stage_module, "id"),
        (stage_module, "type"),
    )
    with monkeypatch.context() as patch:
        for module, name in replacements:
            patch.setattr(module, name, _hostile(f"{module.__name__}.{name}"), raising=False)
        receipt = adopt(
            graph.authority,
            graph.bundle,
            graph.fence,
            graph.reader,
            None,
        )

    assert _authority(graph).initial_stage_adoption_receipt is receipt


def test_atomic_tail_has_no_runtime_global_or_forbidden_effect_surface() -> None:
    tail = outer._INITIAL_ADOPTION_ATOMIC_TAIL
    closure = inspect.getclosurevars(tail)
    source = inspect.getsource(tail).lower()
    instructions = tuple(dis.get_instructions(tail))

    assert closure.globals == {}
    assert closure.unbound == set()
    assert not any(
        instruction.opname in {"IMPORT_NAME", "IMPORT_FROM"} for instruction in instructions
    )
    assert not any(instruction.opname == "LOAD_GLOBAL" for instruction in instructions)
    forbidden_source = (
        "cancellation",
        "test_hook",
        "provider",
        ".execute(",
        ".prepare(",
        ".executescript(",
        ".commit(",
        ".rollback(",
        "rebind",
    )
    assert all(fragment not in source for fragment in forbidden_source)
    forbidden_names = {
        "execute",
        "prepare",
        "executescript",
        "commit",
        "rollback",
        "rebind",
        "cancellation",
    }
    assert forbidden_names.isdisjoint(tail.__code__.co_names)


def test_exact_catalog_reader_and_ordered_transitive_consumption_graph(
    hostile_graphs: Callable[[int], _AdoptionGraph],
) -> None:
    graph = hostile_graphs(8)
    state = outer._authority_state(graph.authority)
    metadata = _transfer_metadata(graph)
    fence_snapshot = outer._read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(
        graph.fence
    )

    adoption_receipt = _adopt(graph)
    snapshot = _api("_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic")(
        adoption_receipt
    )
    record = _identity_record(outer._INITIAL_STAGE_ADOPTION_RECEIPTS, adoption_receipt)

    assert fence_snapshot.catalog_row_count == 34
    assert len(fence_snapshot.catalog_inventory) == 34
    assert fence_snapshot.user_version == 2
    assert (
        fence_snapshot.catalog_sha256
        == stage_module.SQLITE_CURSOR_INITIAL_PUBLICATION_TARGET_CATALOG_SHA256
    )
    assert metadata.post_ddl_reader_lifecycle == "closed"
    assert metadata.post_ddl_reader_cleanup is None
    assert graph.stage._cursor_post_ddl_reader_state == "closed"
    assert graph.stage._cursor_post_ddl_reader_cleanup is None
    reader = _identity_record(outer._POST_DDL_PUBLICATION_READER_LEASES, graph.reader)
    assert reader.lifecycle == "retired"
    assert reader.close_attempt_count == 1
    assert reader.close_succeeded is True
    assert reader.rederived_projection is not None
    assert (
        reader.rederived_projection.projection_sha256 == state.projection_identity.projection_sha256
    )
    assert snapshot.retired_b2_fence is graph.stage._cursor_b2_catalog_change_fence_retirement

    originals = (
        graph.migration,
        graph.entries,
        graph.header,
        graph.sequence,
    )
    tombstones = (
        snapshot.migration_0002_consumed_tombstone,
        snapshot.baseline_entries_consumed_tombstone,
        snapshot.baseline_header_consumed_tombstone,
        snapshot.operation_sequence_zero_consumed_tombstone,
    )
    expected_types = (
        outer._SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone,
        outer._SQLiteBaselineEntriesPublicationReceiptConsumedTombstone,
        outer._SQLiteBaselineHeaderPublicationReceiptConsumedTombstone,
        outer._SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone,
    )
    consumption_registries = (
        outer._MIGRATION_0002_RECEIPT_CONSUMPTIONS,
        outer._BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
        outer._BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
        outer._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
    )
    assert tuple(type(value) for value in tombstones) == expected_types
    for original, tombstone, registry in zip(
        originals,
        tombstones,
        consumption_registries,
        strict=True,
    ):
        consumption = _identity_record(registry, original)
        assert _identity_record(outer._INITIAL_STAGE_ADOPTION_TOMBSTONES, tombstone) is consumption
        assert consumption.lifecycle == "active"
        assert consumption.original_receipt_ref() is original
        assert consumption.adoption_receipt_ref() is adoption_receipt

    assert record.lifecycle == "active"
    assert record.authority_ref() is graph.authority
    assert record.stage_ref() is graph.stage
    assert record.transfer_ref() is state.transfer
    assert record.fence_ref() is graph.fence
    assert record.reader_lease_ref() is graph.reader
    assert record.retired_b2_fence_ref() is snapshot.retired_b2_fence
    assert record.watermark.outer_ledger == snapshot.adopted_outer_ledger
    assert record.target_catalog_sha256 == fence_snapshot.catalog_sha256


def test_adoption_issues_only_read_sql_and_no_transaction_or_connection_rebind(
    hostile_graphs: Callable[[int], _AdoptionGraph],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = hostile_graphs(3)
    raw = _raw(graph.connection)
    statements: list[str] = []
    raw.set_trace_callback(statements.append)
    connection_id = id(graph.connection)
    raw_id = id(raw)
    epoch = graph.connection.transaction_epoch
    changes = graph.connection.total_changes
    generation = graph.connection._transaction_generation

    with monkeypatch.context() as patch:
        patch.setattr(
            SQLiteV1BaselineConnectionOwner,
            "commit",
            _hostile("connection.commit"),
        )
        patch.setattr(
            SQLiteV1BaselineConnectionOwner,
            "rollback",
            _hostile("connection.rollback"),
        )
        patch.setattr(
            SQLiteV1BaselineConnectionOwner,
            "executescript",
            _hostile("connection.executescript"),
        )
        try:
            _adopt(graph)
        finally:
            raw.set_trace_callback(None)

    normalized = (
        "\n".join(
            line for line in statement.splitlines() if not line.lstrip().startswith("--")
        ).lstrip()
        for statement in statements
    )
    verbs = {statement.split(maxsplit=1)[0].upper() for statement in normalized if statement}
    assert verbs <= {"SELECT", "PRAGMA"}
    assert id(graph.connection) == connection_id
    assert id(_raw(graph.connection)) == raw_id
    assert graph.connection.transaction_epoch == epoch
    assert graph.connection.total_changes == changes
    assert graph.connection._transaction_generation is generation


def _adoption_registry_sizes() -> tuple[int, ...]:
    registries = (
        outer._AUTHORITIES,
        outer._AUTHORITY_BY_EVIDENCE,
        outer._AUTHORITY_BY_TRANSFER,
        outer._MIGRATION_0002_RECEIPTS,
        outer._POST_DDL_CATALOG_FENCES,
        outer._POST_DDL_PUBLICATION_READER_LEASES,
        outer._BASELINE_ENTRIES_PUBLICATION_RECEIPTS,
        outer._BASELINE_HEADER_PUBLICATION_RECEIPTS,
        outer._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS,
        outer._MIGRATION_0002_RECEIPT_CONSUMPTIONS,
        outer._BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
        outer._BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
        outer._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
        outer._INITIAL_STAGE_ADOPTION_RECEIPTS,
        outer._INITIAL_STAGE_ADOPTION_TOMBSTONES,
        ownership._TRANSFERS,
        ownership._OUTER_PUBLICATION_TAILS,
        ownership._INITIAL_PUBLICATION_ADOPTION_TAILS,
        stage_module._CURSOR_B2_FENCE_RETIREMENTS,
        stage_module._CURSOR_INITIAL_PUBLICATION_ADOPTION_TAILS,
    )
    return tuple(len(registry) for registry in registries)


def test_complete_adoption_graph_and_every_registry_release_after_gc() -> None:
    gc.collect()
    gc.collect()
    before = _adoption_registry_sizes()
    graph = _AdoptionGraph(2)
    receipt = _adopt(graph)
    snapshot = _api("_read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic")(
        receipt
    )
    state = outer._authority_state(graph.authority)
    referents = (
        graph.authority,
        graph.stage,
        state.transfer,
        state.projection_reference,
        graph.migration,
        graph.fence,
        graph.reader,
        graph.entries,
        graph.header,
        graph.sequence,
        receipt,
        snapshot.migration_0002_consumed_tombstone,
        snapshot.baseline_entries_consumed_tombstone,
        snapshot.baseline_header_consumed_tombstone,
        snapshot.operation_sequence_zero_consumed_tombstone,
        snapshot.retired_b2_fence,
    )
    references = tuple(ref(value) for value in referents)

    graph.close()
    del referents
    del state
    del snapshot
    del receipt
    del graph
    for _ in range(12):
        gc.collect()
        if all(reference() is None for reference in references):
            break

    assert all(reference() is None for reference in references)
    assert _adoption_registry_sizes() == before


def test_package_runtime_and_type_surfaces_expose_no_adoption_or_successor_authority() -> None:
    forbidden_exact = {
        "SQLiteCursorInitialStageAdoptionReceipt",
        "adopt_sqlite_cursor_initial_publication_stage_intrinsic",
        "assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic",
        "read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic",
    }
    successor_fragments = (
        "publication_session",
        "cursor_rebind",
        "publication_commit",
        "commit_authority",
    )
    public_names = set(dir(graph_engineering))
    exported_names = set(graph_engineering.__all__)

    assert forbidden_exact.isdisjoint(public_names)
    assert forbidden_exact.isdisjoint(exported_names)
    assert all(
        fragment not in name.lower()
        for fragment in successor_fragments
        for name in public_names | exported_names
    )
    assert not hasattr(outer, "_begin_sqlite_cursor_initial_publication_session_intrinsic")
    assert not hasattr(outer, "_rebind_sqlite_cursor_initial_publication_intrinsic")
    assert not hasattr(outer, "_commit_sqlite_cursor_initial_publication_intrinsic")
