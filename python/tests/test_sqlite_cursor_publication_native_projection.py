from __future__ import annotations

import gc
import hashlib
import sqlite3
from dataclasses import replace
from pathlib import Path
from typing import cast
from weakref import ref

import pytest

import graph_engineering.sqlite_cursor_publication_native_projection_bridge as bridge
import graph_engineering.sqlite_cursor_publication_owner_composition as composition
import graph_engineering.sqlite_cursor_publication_transaction_owner as transaction
import graph_engineering.sqlite_operation_baseline_source as source
from graph_engineering.canonical import canonical_bytes
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)
from tests.test_sqlite_cursor_publication_owner_composition import _capture_and_finalize
from tests.test_sqlite_operation_baseline_source import (
    database as memory_source_v1_database,
)
from tests.test_sqlite_operation_baseline_source import insert_legacy_operation

APPLIED_AT_MS = 1_785_110_405_000
SOURCE_FAMILIES = (
    "schema-envelope",
    "migration-lineage",
    "stream-head",
    "record-identity",
    "checkpoint-current",
    "checkpoint-revision",
    "lease-current",
    "used-lease-identity",
    "legal-hold",
    "migration-lock-current",
    "used-migration-lock-identity",
    "legacy-operation",
)


def _active_with_optional_streams(
    path: Path, optional_count: int
) -> tuple[SQLiteV1BaselineConnectionOwner, object, object]:
    memory = memory_source_v1_database()
    memory.execute(
        """UPDATE ge_cycle_schema
              SET latest_migration_applied_at_ms = ?,
                  created_at_ms = ?, updated_at_ms = ?""",
        (APPLIED_AT_MS, APPLIED_AT_MS, APPLIED_AT_MS),
    ).close()
    memory.execute(
        "UPDATE ge_cycle_migrations SET applied_at_ms = ?",
        (APPLIED_AT_MS,),
    ).close()
    memory.execute(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ? WHERE singleton = 1",
        (APPLIED_AT_MS,),
    ).close()
    for ordinal in range(optional_count):
        insert_legacy_operation(
            memory,
            operation_id=f"operation-{ordinal}",
            result={"deleted": False},
            request_hash=hashlib.sha256(
                f"request-{ordinal}".encode()
            ).hexdigest(),
            committed_at_ms=APPLIED_AT_MS,
        )
    memory.commit()
    target = SQLiteV1BaselineConnectionOwner(str(path))
    memory_raw = cast(
        sqlite3.Connection,
        object.__getattribute__(memory, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    target_raw = cast(
        sqlite3.Connection,
        object.__getattribute__(target, "_SQLiteV1BaselineConnectionOwner__connection"),
    )
    memory_raw.backup(target_raw)
    memory.close()
    owner = transaction._register_sqlite_cursor_publication_transaction_owner_intrinsic(
        target
    )
    begin_receipt = (
        transaction._begin_sqlite_cursor_publication_transaction_intrinsic(owner)
    )
    return target, owner, begin_receipt


def _assert_exact_p9_failure_cleanup(owner: object, case: str) -> None:
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized", case
    assert terminal.rollback_attempt_count == 1, case
    assert terminal.rollback_native_return_count == 1, case
    assert terminal.close_attempt_count == 1, case
    assert terminal.close_native_return_count == 1, case
    assert terminal.reopen_attempt_count == 1, case
    assert terminal.reopen_source_v1_count == 1, case
    assert terminal.commit_attempt_count == 0, case


@pytest.mark.parametrize("optional_count", [0, 1, 3])
def test_lower_native_projection_exhausts_all_families_and_mints_distinct_parent(
    tmp_path: Path, optional_count: int
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / f"native-{optional_count}.sqlite", optional_count
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )

    native_adoption = (
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    )
    receipt_snapshot = native_adoption.receipt_snapshot
    assert receipt_snapshot.lifecycle == "consumed"
    assert receipt_snapshot.source_family_count == 12
    assert receipt_snapshot.expected_projection_count == 3 + optional_count
    assert receipt_snapshot.retained_count == 3 + optional_count
    assert receipt_snapshot.expected_family_counts == receipt_snapshot.observed_family_counts
    assert receipt_snapshot.logical_native_read_count == 12
    assert receipt_snapshot.prepare_count == 12
    assert receipt_snapshot.terminal_observed_count == 12
    assert receipt_snapshot.cursor_close_attempt_count == 12
    assert receipt_snapshot.cursor_close_return_count == 12
    assert receipt_snapshot.exact_resource_pairing is True
    assert receipt_snapshot.exact_read_session is True
    assert receipt_snapshot.ordered_normalized_sql_sha256 == (
        "d463cf27633ca463ff1cc0ff57ccc632addf74d5c4f641aeb6425508fd9a840d",
        "c43f6ea643b6e2c03200609416e7c7d6bfdb735ca96f7fc83e2c7a474d6d3d4e",
        "30a30fe14c69e7d9f1795b29800fae147df3b44cf938d08b6734c44d5dfb8044",
        "4c92628b34578bcfeeca4d1003b3bdb2ce6c723405185db6bf12fe16b3581b4d",
        "fc3ac0e541a22d5afbdd25c19d3883addd0e9bef09ad63c6343389716c98102b",
        "bb15b913e9f3881f515c4a8712ad3e05b6133558e8b5170a21f833444c54eecd",
        "bed724e3679e1c12eb81f017f748bd7a45c119673fbd4cd914d4b075485f5b04",
        "315c46c5ad6064c39ed153b6e86f4fc1ac93093bbeb1520281e059097605d8a8",
        "85819d020543c637a1eea9eaeb8d84a6e5e11c6d292e59dfddfccbdbcba5c63f",
        "090564e9a36643dfaa705dac5eefd0a86acff04bfc000cd397202ddc8242fe0d",
        "8f4c8983ce55744fe36f398cb990f0bbf06c9787189180669d6d26ae58baf2a2",
        "e186ae71f91a771a95e41f05497f6e2c0ec3e38a7c7d6d16c17713cece498a02",
    )
    assert receipt_snapshot.native_source_provenance is True
    assert receipt_snapshot.native_projection_authority is True
    assert receipt_snapshot.genuine_zero_claim is False
    assert receipt_snapshot.sql_authority is False

    parent = native_adoption.parent
    parent_snapshot = (
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            parent
        )
    )
    assert parent_snapshot.route_id == "main.baseline-entries"
    assert parent_snapshot.expected_count == 3 + optional_count
    assert parent_snapshot.count_provenance == "lower-native"
    assert parent_snapshot.actual_native_io_count == 0
    assert parent_snapshot.sql_authority is False
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_generic_shape_receipt_is_rejected_before_native_projection_io(
    tmp_path: Path,
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / "generic-hostile.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    generic = composition._mint_sqlite_cursor_publication_retained_count_receipt_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        (),
    )
    generic_snapshot = (
        composition._read_sqlite_cursor_publication_retained_count_receipt_snapshot_intrinsic(
            adopted, generic
        )
    )
    assert generic_snapshot.native_source_provenance is False
    assert generic_snapshot.actual_native_io_count == 0
    assert generic_snapshot.sql_authority is False
    native_receipt_count_before = source._count_native_projection_receipts_for_test(
        adopted
    )

    assert not hasattr(
        composition,
        "_adopt_sqlite_cursor_publication_native_projection_receipt_intrinsic",
    )
    assert summary._identity_iteration_state.started is False
    assert (
        source._count_native_projection_receipts_for_test(adopted)
        == native_receipt_count_before
    )
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_shape_parent_cannot_be_upgraded_by_mutable_presentation_record(
    tmp_path: Path,
) -> None:
    _connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / "shape-upgrade.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    generic = composition._mint_sqlite_cursor_publication_retained_count_receipt_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        (),
    )
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        generic,
    )
    composition._PARENT_SCOPES[id(parent)].record.count_provenance = "lower-native"
    with pytest.raises(
        ValueError, match=r"^GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID$"
    ):
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            parent
        )
    _assert_exact_p9_failure_cleanup(owner, "shape-upgrade")


def test_native_parent_cannot_be_downgraded_by_mutable_presentation_record(
    tmp_path: Path,
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / "native-downgrade.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    native_adoption = (
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    )
    parent = native_adoption.parent
    composition._PARENT_SCOPES[id(parent)].record.count_provenance = "shape-only"
    with pytest.raises(
        ValueError, match=r"^GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID$"
    ):
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            parent
        )
    _assert_exact_p9_failure_cleanup(owner, "native-downgrade")


def test_native_parent_private_contract_rejects_zero_count_completion_forgery(
    tmp_path: Path,
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / "native-zero-count-forgery.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    native_adoption = (
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    )
    parent = native_adoption.parent
    assert native_adoption.receipt_snapshot.retained_count == 3

    # Reproduce the former bypass: rewriting the public registry record to zero
    # used to authorize prepare -> zero postflight -> retire -> consume while the
    # lower-owned receipt still proved three retained entries.
    composition._PARENT_SCOPES[id(parent)].record.expected_count = 0
    with pytest.raises(
        ValueError, match=r"^GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID$"
    ):
        composition._prepare_sqlite_cursor_publication_reusable_parent_intrinsic(parent)

    _assert_exact_p9_failure_cleanup(owner, "native-zero-count-forgery")
    assert source._count_native_projection_receipts_for_test(adopted) == 0


@pytest.mark.parametrize("forgery", ["descriptor", "lifecycle-and-counters"])
def test_native_parent_private_contract_rejects_route_or_state_forgery(
    tmp_path: Path, forgery: str
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / f"native-state-forgery-{forgery}.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    parent = (
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        ).parent
    )
    record = composition._PARENT_SCOPES[id(parent)].record
    if forgery == "descriptor":
        record.descriptor = composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0]
    else:
        record.lifecycle = "parent-complete"
        record.next_ordinal = record.expected_count
        record.child_issued_count = record.expected_count
        record.child_entered_count = record.expected_count
        record.child_native_return_count = record.expected_count
        record.child_resource_retired_count = record.expected_count
        record.child_postflight_accepted_count = record.expected_count
        record.child_consumed_count = record.expected_count
        record.reusable_parent_prepare_count = 1
        record.reusable_execution_lease_released_count = record.expected_count
        record.parent_resource_retired_count = 1

    with pytest.raises(
        ValueError, match=r"^GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID$"
    ):
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            parent
        )
    _assert_exact_p9_failure_cleanup(owner, f"native-state-forgery-{forgery}")
    assert source._count_native_projection_receipts_for_test(adopted) == 0


@pytest.mark.parametrize("optional_count", [0, 1, 3])
def test_native_parent_retains_exact_projection_until_complete_consume(
    tmp_path: Path, optional_count: int
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / f"native-parent-lifecycle-{optional_count}.sqlite", optional_count
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    native_adoption = (
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    )
    parent = native_adoption.parent
    del native_adoption
    gc.collect()
    assert source._count_native_projection_receipts_for_test(adopted) == 1
    with pytest.raises(TypeError):
        composition._consume_sqlite_cursor_publication_mutation_parent_scope_intrinsic(  # type: ignore[call-arg]
            parent, lambda _parent: None
        )
    assert source._count_native_projection_receipts_for_test(adopted) == 1

    composition._prepare_sqlite_cursor_publication_reusable_parent_intrinsic(parent)
    for ordinal in range(3 + optional_count):
        child = composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(
            parent, ordinal
        )
        composition._enter_sqlite_cursor_publication_mutation_child_permit_intrinsic(child)
        composition._record_sqlite_cursor_publication_mutation_child_return_intrinsic(child)
        composition._retire_sqlite_cursor_publication_mutation_child_resource_intrinsic(child)
        composition._accept_sqlite_cursor_publication_mutation_child_postflight_intrinsic(
            child
        )
        composition._consume_sqlite_cursor_publication_mutation_child_permit_intrinsic(child)
    composition._retire_sqlite_cursor_publication_reusable_parent_resource_intrinsic(parent)
    composition._consume_sqlite_cursor_publication_mutation_parent_scope_intrinsic(parent)
    gc.collect()
    assert source._count_native_projection_receipts_for_test(adopted) == 0
    consumed = (
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            parent
        )
    )
    assert consumed.lifecycle == "parent-consumed"
    assert consumed.count_provenance == "lower-native"

    presentation = composition._PARENT_SCOPES[id(parent)].record
    presentation.lifecycle = "parent-issued"
    presentation.next_ordinal = 0
    with pytest.raises(
        ValueError, match=r"^GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID$"
    ):
        composition._prepare_sqlite_cursor_publication_reusable_parent_intrinsic(parent)
    assert source._count_native_projection_receipts_for_test(adopted) == 0
    _assert_exact_p9_failure_cleanup(owner, "native-parent-replay")


def test_cross_connection_summary_finalizes_target_without_poisoning_foreign_source(
    tmp_path: Path,
) -> None:
    foreign_connection, foreign_owner, _foreign_begin = _active_with_optional_streams(
        tmp_path / "foreign-source.sqlite", 0
    )
    foreign_summary = source.capture_sqlite_v1_baseline_source_summary(
        foreign_connection, captured_at_ms=APPLIED_AT_MS
    )
    _target_connection, target_owner, target_begin = _active_with_optional_streams(
        tmp_path / "target-source.sqlite", 0
    )
    target_composition = (
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            target_owner, target_begin
        )
    )

    with pytest.raises(
        ValueError, match=r"^GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_CONNECTION$"
    ):
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            target_composition, foreign_summary
        )
    assert foreign_summary._identity_iteration_state.started is False
    assert foreign_summary._identity_iteration_state.poisoned is False
    target_terminal = (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
            target_owner
        )
    )
    assert target_terminal.lifecycle == "finalized"
    assert target_terminal.commit_attempt_count == 0
    _capture_and_finalize(foreign_owner, RuntimeError("bounded stop"))


@pytest.mark.parametrize("impossible_total", [0, 1])
def test_impossible_total_clone_is_rejected_before_graph_or_native_read(
    tmp_path: Path, impossible_total: int
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / f"impossible-{impossible_total}.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    forged = replace(summary, expected_entry_count=impossible_total)

    with pytest.raises(
        source.SQLiteV1BaselineNativeProjectionProvenanceError
    ) as captured:
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, forged
        )
    assert captured.value.code == "GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_PROVENANCE"
    assert str(captured.value) == "SQLite v1 baseline lower-owned source is invalid"
    assert summary._identity_iteration_state.started is False
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


def test_raw_native_receipt_adopter_is_not_a_cross_composition_surface(
    tmp_path: Path,
) -> None:
    source_connection, source_owner, source_begin = _active_with_optional_streams(
        tmp_path / "receipt-source.sqlite", 0
    )
    source_composition = (
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            source_owner, source_begin
        )
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        source_connection, captured_at_ms=APPLIED_AT_MS
    )
    native_adoption = (
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            source_composition, summary
        )
    )
    _other_connection, other_owner, other_begin = _active_with_optional_streams(
        tmp_path / "receipt-target.sqlite", 0
    )
    _other_composition = (
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            other_owner, other_begin
        )
    )

    assert not hasattr(
        composition,
        "_adopt_sqlite_cursor_publication_native_projection_receipt_intrinsic",
    )
    assert (
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            native_adoption.parent
        ).count_provenance
        == "lower-native"
    )
    assert (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
            other_owner
        ).lifecycle
        == "active"
    )
    _capture_and_finalize(other_owner, RuntimeError("bounded other stop"))
    _capture_and_finalize(source_owner, RuntimeError("bounded stop"))


def test_definition_time_native_surfaces_ignore_late_substitution(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / "definition-captured.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )

    def bomb(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("late substitution reached native projection")

    monkeypatch.setattr(source.SQLiteV1BaselineConnectionOwner, "execute", bomb)
    monkeypatch.setattr(source._SQLiteCursorCapability, "fetchmany", bomb)
    monkeypatch.setattr(source._SQLiteCursorCapability, "close", bomb)
    monkeypatch.setattr(source, "_identity_families", bomb)
    monkeypatch.setattr(
        bridge,
        "_invoke_sqlite_cursor_publication_native_projection_reproof_intrinsic",
        bomb,
        raising=False,
    )
    native_adoption = (
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    )
    snapshot = native_adoption.receipt_snapshot
    assert snapshot.retained_count == 3
    assert snapshot.cursor_close_return_count == 12
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_native_authority_constructors_and_registries_are_not_module_surfaces() -> None:
    forbidden_source_names = (
        "_NATIVE_PROJECTION_CONSTRUCTION_TOKEN",
        "_NATIVE_PROJECTION_IDENTITY_FAMILIES",
        "_NativeProjectionReceiptRecord",
        "_NativeProjectionSourceSummaryRecord",
        "_NativeProjectionFamilyResourceNonce",
        "_SQLiteV1BaselineNativeProjectionReceipt",
        "_native_projection_source_summary_registry_cell",
        "_native_projection_receipt_registry_cell",
        "_register_sqlite_v1_baseline_source_summary",
        "_mint_native_projection_receipt",
        "_lookup_native_projection_receipt_record",
        "_native_projection_receipt_record_for",
        "_consume_sqlite_v1_baseline_native_projection_receipt_intrinsic",
        "_produce_sqlite_v1_baseline_native_projection_receipt_implementation",
        "_read_native_projection_for_test",
    )
    forbidden_composition_names = (
        "_retain_native_projection_parent_receipt",
        "_assert_native_projection_parent_receipt",
        "_release_native_projection_parent_receipt",
        "_release_native_projection_composition_receipts",
        "_adopt_sqlite_cursor_publication_native_projection_receipt_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_pipeline_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_receipt_consume_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_receipt_snapshot_intrinsic",
    )
    forbidden_bridge_names = (
        "_native_projection_bridge_cell",
        "_install_sqlite_cursor_publication_native_projection_bridge_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_reproof_intrinsic",
        "_native_projection_pipeline_cell",
        "_install_sqlite_cursor_publication_native_projection_producer_intrinsic",
        "_install_sqlite_cursor_publication_native_projection_adopter_intrinsic",
        "_install_sqlite_cursor_publication_native_projection_abandoner_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_pipeline_intrinsic",
        "_native_projection_receipt_views_cell",
        "_install_sqlite_cursor_publication_native_projection_receipt_views_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_receipt_snapshot_intrinsic",
        "_invoke_sqlite_cursor_publication_native_projection_receipt_consume_intrinsic",
        "_seal_sqlite_cursor_publication_native_projection_bridge_intrinsic",
    )
    assert all(not hasattr(source, name) for name in forbidden_source_names)
    assert all(not hasattr(composition, name) for name in forbidden_composition_names)
    assert all(not hasattr(bridge, name) for name in forbidden_bridge_names)


def test_normalized_sql_digest_collapses_only_frozen_ascii_format_whitespace() -> None:
    normalized = source._sqlite_v1_baseline_normalized_sql_sha256_intrinsic
    expected = hashlib.sha256(b"SELECT 1 FROM value").hexdigest()
    assert normalized(" \tSELECT\v\f1\r\nFROM\rvalue\n ") == expected
    for non_ascii in ("\u00a0", "\u0085", "\ufeff", "\u001c"):
        for sql in (
            f"{non_ascii}SELECT 1 FROM value",
            f"SELECT 1 FROM value{non_ascii}",
            f"SELECT{non_ascii}1",
        ):
            assert normalized(sql) == hashlib.sha256(sql.encode("utf-8")).hexdigest()
            assert normalized(sql) != expected


def test_late_registry_and_graph_substitution_cannot_cross_read_foreign_summary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    foreign_connection, foreign_owner, _foreign_begin = _active_with_optional_streams(
        tmp_path / "late-foreign.sqlite", 0
    )
    foreign_summary = source.capture_sqlite_v1_baseline_source_summary(
        foreign_connection, captured_at_ms=APPLIED_AT_MS
    )
    _target_connection, target_owner, target_begin = _active_with_optional_streams(
        tmp_path / "late-target.sqlite", 0
    )
    target_composition = (
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            target_owner, target_begin
        )
    )
    source.capture_sqlite_v1_baseline_source_summary(
        _target_connection, captured_at_ms=APPLIED_AT_MS
    )
    assert not hasattr(source, "_native_projection_source_summary_record_for")
    monkeypatch.setattr(
        source,
        "_native_projection_source_summary_record_for",
        lambda _summary: object(),
        raising=False,
    )
    monkeypatch.setattr(
        source,
        "_sqlite_v1_baseline_native_projection_graph_parts",
        lambda _adoption: (_target_connection, object(), object()),
    )
    receipt_count_before = source._count_native_projection_receipts_for_test(
        target_composition
    )
    with pytest.raises(
        ValueError, match=r"^GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_CONNECTION$"
    ):
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            target_composition, foreign_summary
        )
    assert foreign_summary._identity_iteration_state.started is False
    assert foreign_summary._identity_iteration_state.poisoned is False
    assert (
        source._count_native_projection_receipts_for_test(target_composition)
        == receipt_count_before
    )
    assert (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
            target_owner
        ).lifecycle
        == "finalized"
    )
    _capture_and_finalize(foreign_owner, RuntimeError("bounded stop"))


@pytest.mark.parametrize(
    "fault_point",
    [
        "prepare-before:schema-envelope",
        "prepare-after:schema-envelope",
        "fetch-after:schema-envelope",
        "decode-before:schema-envelope",
        "terminal-after:schema-envelope",
        "close-after:schema-envelope",
        "digest-before",
        "digest-after",
        "mint-before",
        "mint-after",
    ],
)
def test_native_projection_stage_fault_preserves_primary_and_mints_no_parent(
    tmp_path: Path, fault_point: str
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / f"fault-{fault_point.replace(':', '-')}.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    primary = RuntimeError(f"primary:{fault_point}")
    token = source._NATIVE_PROJECTION_FAULTS.set({fault_point: primary})
    try:
        with pytest.raises(RuntimeError) as captured:
            composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
                adopted, summary
            )
    finally:
        source._NATIVE_PROJECTION_FAULTS.reset(token)
    assert captured.value is primary
    expected_telemetry = {
        "prepare-before:schema-envelope": (0, 0, 0, 0),
        "prepare-after:schema-envelope": (1, 0, 1, 1),
        "fetch-after:schema-envelope": (1, 0, 1, 1),
        "decode-before:schema-envelope": (1, 0, 1, 1),
        "terminal-after:schema-envelope": (1, 1, 1, 1),
        "close-after:schema-envelope": (1, 1, 1, 1),
        "digest-before": (12, 12, 12, 12),
        "digest-after": (12, 12, 12, 12),
        "mint-before": (12, 12, 12, 12),
        "mint-after": (12, 12, 12, 12),
    }
    assert (
        source._NATIVE_PROJECTION_LAST_FAILURE_TELEMETRY.get()
        == expected_telemetry[fault_point]
    )
    gc.collect()
    assert all(
        entry.record.composition_ref() is not adopted
        for entry in composition._PARENT_SCOPES.values()
    )
    assert source._count_native_projection_receipts_for_test(adopted) == 0
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


def test_native_projection_exhaustive_family_boundary_and_row_fault_matrix(
    tmp_path: Path,
) -> None:
    """Exercise every applicable NP1 native boundary with exact cleanup evidence."""

    boundary_points = (
        "prepare-before",
        "prepare-after",
        "fetch-before",
        "fetch-after",
        "terminal-before",
        "terminal-after",
        "close-before",
        "close-after",
    )
    executed = 0
    for optional_count in (0, 1, 3):
        for family_index, family in enumerate(SOURCE_FAMILIES):
            for boundary in boundary_points:
                fault_point = f"{boundary}:{family}"
                case = f"n{optional_count}-{fault_point}"
                connection, owner, begin_receipt = _active_with_optional_streams(
                    tmp_path / f"matrix-{executed}.sqlite", optional_count
                )
                adopted = (
                    composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
                        owner, begin_receipt
                    )
                )
                summary = source.capture_sqlite_v1_baseline_source_summary(
                    connection, captured_at_ms=APPLIED_AT_MS
                )
                primary = RuntimeError(case)
                token = source._NATIVE_PROJECTION_FAULTS.set({fault_point: primary})
                try:
                    with pytest.raises(RuntimeError) as captured:
                        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
                            adopted, summary
                        )
                finally:
                    source._NATIVE_PROJECTION_FAULTS.reset(token)
                assert captured.value is primary, case
                current_prepare = family_index + (boundary != "prepare-before")
                current_terminal = family_index + int(
                    boundary
                    in {"terminal-after", "close-before", "close-after"}
                )
                current_close = family_index + (boundary != "prepare-before")
                assert source._NATIVE_PROJECTION_LAST_FAILURE_TELEMETRY.get() == (
                    current_prepare,
                    current_terminal,
                    current_close,
                    current_close,
                ), case
                gc.collect()
                assert source._count_native_projection_receipts_for_test(adopted) == 0, case
                assert all(
                    entry.record.composition_ref() is not adopted
                    for entry in composition._PARENT_SCOPES.values()
                ), case
                _assert_exact_p9_failure_cleanup(owner, case)
                executed += 1

        row_cases: list[tuple[str, int]] = [
            ("schema-envelope", 0),
            ("migration-lineage", 0),
            ("migration-lock-current", 0),
        ]
        if optional_count == 1:
            row_cases.append(("legacy-operation", 0))
        elif optional_count == 3:
            row_cases.extend(("legacy-operation", row) for row in range(3))
        for family, row in row_cases:
            family_index = SOURCE_FAMILIES.index(family)
            for boundary in ("decode-before", "decode-after"):
                fault_point = f"{boundary}:{family}:{row}"
                case = f"n{optional_count}-{fault_point}"
                connection, owner, begin_receipt = _active_with_optional_streams(
                    tmp_path / f"matrix-{executed}.sqlite", optional_count
                )
                adopted = (
                    composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
                        owner, begin_receipt
                    )
                )
                summary = source.capture_sqlite_v1_baseline_source_summary(
                    connection, captured_at_ms=APPLIED_AT_MS
                )
                primary = RuntimeError(case)
                token = source._NATIVE_PROJECTION_FAULTS.set({fault_point: primary})
                try:
                    with pytest.raises(RuntimeError) as captured:
                        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
                            adopted, summary
                        )
                finally:
                    source._NATIVE_PROJECTION_FAULTS.reset(token)
                assert captured.value is primary, case
                assert source._NATIVE_PROJECTION_LAST_FAILURE_TELEMETRY.get() == (
                    family_index + 1,
                    family_index,
                    family_index + 1,
                    family_index + 1,
                ), case
                gc.collect()
                assert source._count_native_projection_receipts_for_test(adopted) == 0, case
                assert all(
                    entry.record.composition_ref() is not adopted
                    for entry in composition._PARENT_SCOPES.values()
                ), case
                _assert_exact_p9_failure_cleanup(owner, case)
                executed += 1

    assert executed == 314


def test_fetch_primary_wins_over_close_secondary_and_native_close_still_runs(
    tmp_path: Path,
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / "primary-close-secondary.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    primary = RuntimeError("fetch-primary")
    secondary = RuntimeError("close-secondary")
    token = source._NATIVE_PROJECTION_FAULTS.set(
        {
            "fetch-after:schema-envelope": primary,
            "close-before:schema-envelope": secondary,
        }
    )
    try:
        with pytest.raises(RuntimeError) as captured:
            composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
                adopted, summary
            )
    finally:
        source._NATIVE_PROJECTION_FAULTS.reset(token)
    assert captured.value is primary
    assert source._NATIVE_PROJECTION_LAST_FAILURE_TELEMETRY.get() == (1, 0, 1, 1)
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


@pytest.mark.parametrize(
    "fault_point",
    ["consume-before", "consume-after", "parent-registered", "parent-after"],
)
def test_atomic_adoption_fault_never_exposes_parent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, fault_point: str
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / f"adopt-{fault_point}.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    primary = RuntimeError(f"primary:{fault_point}")

    def inject(point: str, _composition: object) -> None:
        if point == fault_point:
            raise primary

    monkeypatch.setattr(
        composition,
        "_inject_sqlite_cursor_publication_native_projection_adoption_fault_intrinsic",
        inject,
    )
    with pytest.raises(RuntimeError) as captured:
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    assert captured.value is primary
    gc.collect()
    assert source._count_native_projection_receipts_for_test(adopted) == 0
    assert all(
        entry.record.composition_ref() is not adopted
        for entry in composition._PARENT_SCOPES.values()
    )
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


@pytest.mark.parametrize(
    ("field", "replacement"),
    [
        ("_source_envelope_bytes", b"{}"),
        ("expected_entry_count", 0),
        ("_captured_transaction_epoch", -1),
    ],
)
def test_registered_summary_field_rebinding_is_rejected(
    tmp_path: Path, field: str, replacement: object
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / f"summary-rebind-{field}.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    object.__setattr__(summary, field, replacement)

    with pytest.raises(
        source.SQLiteV1BaselineNativeProjectionProvenanceError
    ) as captured:
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    assert captured.value.code == "GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_PROVENANCE"
    assert str(captured.value) == "SQLite v1 baseline lower-owned source is invalid"
    assert summary._identity_iteration_state.started is False
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


def test_summary_state_reset_and_gc_cannot_replay_native_projection(
    tmp_path: Path,
) -> None:
    connection, owner, begin_receipt = _active_with_optional_streams(
        tmp_path / "summary-replay.sqlite", 0
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
    )
    native_adoption = (
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    )
    summary_reference = ref(summary)
    summary._identity_iteration_state.started = False
    summary._identity_iteration_state.completed = False

    with pytest.raises(
        ValueError, match=r"^GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_REPLAY$"
    ):
        composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
            adopted, summary
        )
    assert native_adoption.receipt_snapshot.lifecycle == "consumed"
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0
    del summary
    gc.collect()
    assert summary_reference() is None


def test_projection_and_source_digests_match_independent_oracles_and_repeat(
    tmp_path: Path,
) -> None:
    snapshots: list[object] = []
    for run in range(2):
        oracle_connection, oracle_owner, _oracle_begin = _active_with_optional_streams(
            tmp_path / f"digest-oracle-{run}.sqlite", 3
        )
        oracle_summary = source.capture_sqlite_v1_baseline_source_summary(
            oracle_connection, captured_at_ms=APPLIED_AT_MS
        )
        oracle_entries = tuple(oracle_summary.iter_identity_entries())
        projection_oracle = hashlib.sha256(
            b"graph-engineering/sqlite-v1-baseline-projection/v1\x00"
            + canonical_bytes(
                [
                    {
                        "entryKind": entry.entry_kind,
                        "key": entry.key,
                        "state": entry.state,
                    }
                    for entry in oracle_entries
                ]
            )
        ).hexdigest()
        source_envelope_oracle = hashlib.sha256(
            canonical_bytes(oracle_summary.source_envelope)
        ).hexdigest()
        _capture_and_finalize(oracle_owner, RuntimeError("bounded oracle stop"))

        connection, owner, begin_receipt = _active_with_optional_streams(
            tmp_path / f"digest-{run}.sqlite", 3
        )
        adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            owner, begin_receipt
        )
        summary = source.capture_sqlite_v1_baseline_source_summary(
        connection, captured_at_ms=APPLIED_AT_MS
        )
        native_adoption = (
            composition._capture_and_adopt_sqlite_cursor_publication_native_projection_intrinsic(
                adopted, summary
            )
        )
        snapshot = native_adoption.receipt_snapshot
        assert snapshot.projection_sha256 == projection_oracle
        assert snapshot.source_envelope_sha256 == source_envelope_oracle
        assert len(snapshot.ordered_sql_sha256) == 12
        assert all(len(digest) == 64 for digest in snapshot.ordered_sql_sha256)
        snapshots.append(snapshot)
        _capture_and_finalize(owner, RuntimeError("bounded stop"))
    assert snapshots[0] == snapshots[1]
