from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import pytest

import graph_engineering.sqlite_cursor_publication_outer_authority as outer
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as ownership
from tests.test_sqlite_cursor_publication_initial_stage_adoption import (
    _adopt,
    _AdoptionGraph,
    _assert_zero_proof_terminal_poison,
    _registry_keys,
)


@pytest.fixture
def reproof_graphs() -> Iterator[Callable[[int], _AdoptionGraph]]:
    graphs: list[_AdoptionGraph] = []

    def create(legacy_count: int = 2) -> _AdoptionGraph:
        graph = _AdoptionGraph(legacy_count)
        graphs.append(graph)
        return graph

    yield create
    for graph in reversed(graphs):
        graph.close()


def _reader_record(graph: _AdoptionGraph) -> Any:
    return outer._post_ddl_publication_reader_record(graph.reader)


def _replace_digest(value: str) -> str:
    replacement = "0" * 64
    return "1" * 64 if value == replacement else replacement


def _tamper_terminal_reader(graph: _AdoptionGraph, slot: str) -> None:
    reader = _reader_record(graph)
    if slot == "prepare-count":
        reader.prepare_count = 0
    elif slot == "execute-count":
        reader.execute_count = 0
    elif slot == "ownership-acquisition-count":
        reader.ownership_acquisition_count = 0
    elif slot == "retained-entries":
        assert reader.retained_entries
        reader.retained_entries = reader.retained_entries[:-1]
    elif slot == "expected-entry-count":
        reader.expected_entry_count += 1
    elif slot == "expected-first-entry-hash":
        reader.expected_first_entry_hash = _replace_digest(reader.expected_first_entry_hash)
    elif slot == "expected-final-entry-hash":
        reader.expected_final_entry_hash = _replace_digest(reader.expected_final_entry_hash)
    elif slot == "expected-legacy-operation-count":
        reader.expected_legacy_operation_count += 1
    elif slot == "expected-projection-sha256":
        reader.expected_projection_sha256 = _replace_digest(reader.expected_projection_sha256)
    elif slot == "rederived-projection":
        reader.rederived_projection = None
    else:  # pragma: no cover - the parameter list is the closed authority
        raise AssertionError(f"unknown terminal-reader slot: {slot}")


@pytest.mark.parametrize(
    "slot",
    (
        "prepare-count",
        "execute-count",
        "ownership-acquisition-count",
        "retained-entries",
        "expected-entry-count",
        "expected-first-entry-hash",
        "expected-final-entry-hash",
        "expected-legacy-operation-count",
        "expected-projection-sha256",
        "rederived-projection",
    ),
)
def test_adoption_reproves_every_terminal_reader_commitment_before_consumption(
    reproof_graphs: Callable[[int], _AdoptionGraph],
    slot: str,
) -> None:
    graph = reproof_graphs(3)
    registries_before = _registry_keys()
    _tamper_terminal_reader(graph, slot)

    with pytest.raises(ValueError):
        _adopt(graph)

    _assert_zero_proof_terminal_poison(graph, registries_before)


def _enter_paired_prepared_state(graph: _AdoptionGraph) -> None:
    controller = outer._create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic()
    controller.cancel()
    with pytest.raises(ValueError) as caught:
        _adopt(graph, None, controller.signal)
    assert str(caught.value) == "GE_CURSOR_B3_INITIAL_ADOPTION_CANCELLED"

    state = outer._authority_state(graph.authority)
    metadata = ownership._read_transfer_metadata(state.transfer)
    assert metadata is not None
    assert state.lifecycle == "active"
    assert state.write_phase == "sequence-zero-complete"
    assert metadata.lifecycle == "initial-publication-adoption-prepared"
    assert graph.stage._cursor_outer_publication_state == "initial-adoption-prepared"
    assert state.receipt_consumption_count == 0
    assert state.tombstone_mint_count == 0
    assert state.initial_stage_adoption_receipt_mint_count == 0


def _identity_record(registry: dict[int, Any], key: object) -> Any:
    entry = dict.get(registry, id(key))
    assert entry is not None and entry.key_ref() is key
    return entry.value


def _tamper_receipt_commitment(graph: _AdoptionGraph, receipt: str) -> None:
    if receipt == "migration":
        record = _identity_record(outer._MIGRATION_0002_RECEIPTS, graph.migration)
        snapshot = record.snapshot
        object.__setattr__(
            record,
            "snapshot",
            snapshot._replace(asset_sha256=_replace_digest(snapshot.asset_sha256)),
        )
        return

    registries = {
        "entries": (outer._BASELINE_ENTRIES_PUBLICATION_RECEIPTS, graph.entries),
        "header": (outer._BASELINE_HEADER_PUBLICATION_RECEIPTS, graph.header),
        "sequence": (outer._OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS, graph.sequence),
    }
    registry, key = registries[receipt]
    record = _identity_record(registry, key)
    object.__setattr__(record, "parameter_sha256", _replace_digest(record.parameter_sha256))


def _tamper_prepared_graph(graph: _AdoptionGraph, drift: str) -> None:
    state = outer._authority_state(graph.authority)
    if drift == "catalog":
        fence = _identity_record(outer._POST_DDL_CATALOG_FENCES, graph.fence)
        object.__setattr__(fence, "catalog_sha256", _replace_digest(fence.catalog_sha256))
    elif drift == "reader-terminal":
        _reader_record(graph).lifecycle = "reader-active"
    elif drift == "transaction-lineage":
        state.transaction_generation = object()
    elif drift == "transaction-epoch":
        state.current_transaction_epoch -= 1
    elif drift == "total-changes":
        state.current_total_changes -= 1
    elif drift == "fixed-statement-ledger":
        state.fixed_statement_count -= 1
    elif drift == "affected-rows-ledger":
        state.affected_rows_watermark -= 1
    elif drift.startswith("receipt-"):
        _tamper_receipt_commitment(graph, drift.removeprefix("receipt-"))
    else:  # pragma: no cover - the parameter list is the closed authority
        raise AssertionError(f"unknown prepared-retry drift: {drift}")


@pytest.mark.parametrize(
    "drift",
    (
        "catalog",
        "reader-terminal",
        "transaction-lineage",
        "transaction-epoch",
        "total-changes",
        "fixed-statement-ledger",
        "affected-rows-ledger",
        "receipt-migration",
        "receipt-entries",
        "receipt-header",
        "receipt-sequence",
    ),
)
def test_cancelled_prepared_retry_reproves_every_live_layer_and_receipt(
    reproof_graphs: Callable[[int], _AdoptionGraph],
    drift: str,
) -> None:
    graph = reproof_graphs(3)
    _enter_paired_prepared_state(graph)
    registries_before = _registry_keys()
    _tamper_prepared_graph(graph, drift)

    with pytest.raises(ValueError):
        _adopt(graph)

    _assert_zero_proof_terminal_poison(graph, registries_before)
