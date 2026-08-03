from __future__ import annotations

import builtins
import gc
import json
from pathlib import Path
from typing import Never
from weakref import ref

import pytest

import graph_engineering
import graph_engineering.sqlite_cursor_publication_owner_composition as composition
import graph_engineering.sqlite_cursor_publication_transaction_owner as transaction
from tests.test_sqlite_cursor_publication_transaction_owner import _active


def _capture_and_finalize(owner: object, primary: BaseException) -> None:
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner, primary
    )
    with pytest.raises(BaseException) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner, capture
        )
    assert raised.value is primary


def _retained_count_receipt_for(adopted: object, retained_count: int) -> object:
    retained_projection = tuple({"ordinal": ordinal} for ordinal in range(retained_count))
    return composition._mint_sqlite_cursor_publication_retained_count_receipt_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        retained_projection,
    )


def test_exact_p9_owner_and_begin_receipt_are_adopted_once(tmp_path: Path) -> None:
    connection, owner, receipt = _active(tmp_path / "composition.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    snapshot = composition._read_sqlite_cursor_publication_owner_composition_snapshot_intrinsic(
        adopted
    )
    owner_snapshot = (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(owner)
    )
    assert snapshot.lifecycle == "begin-adopted"
    assert snapshot.exact_owner is True
    assert snapshot.exact_begin_receipt is True
    assert snapshot.exact_connection is True
    assert snapshot.exact_lineage is True
    assert snapshot.exact_generation is True
    assert snapshot.begin_transaction_epoch == owner_snapshot.transaction_epoch
    assert snapshot.current_transaction_epoch == snapshot.begin_transaction_epoch
    assert snapshot.begin_total_changes == owner_snapshot.total_changes
    assert snapshot.current_total_changes == snapshot.begin_total_changes
    assert snapshot.begin_temp_mutation_epoch == owner_snapshot.temp_mutation_epoch
    assert snapshot.current_temp_mutation_epoch == snapshot.begin_temp_mutation_epoch
    assert snapshot.highest_accepted_30_stage is None
    assert snapshot.third_evidence_consumed is False
    assert snapshot.commit_presented is False
    assert snapshot.commit_attempt_count == 0

    before = (connection.transaction_epoch, connection.total_changes)
    with pytest.raises(ValueError, match=r"^GE_SQLITE_TX_OWNER_COMMIT_HARD_DISABLED$"):
        transaction._commit_sqlite_cursor_publication_transaction_intrinsic(owner, object())
    assert (connection.transaction_epoch, connection.total_changes) == before
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_composition_replay_is_terminal_and_runs_exact_p9_cleanup(
    tmp_path: Path,
) -> None:
    _connection, owner, receipt = _active(tmp_path / "replay.sqlite")
    composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(owner, receipt)
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_COMPOSITION_ADOPTION$"):
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(owner, receipt)
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0


def test_composition_rejects_structural_substitutes_before_native_io(
    tmp_path: Path,
) -> None:
    connection, owner, receipt = _active(tmp_path / "substitutes.sqlite")
    before = (connection.transaction_epoch, connection.total_changes)
    for wrong_owner, wrong_receipt in ((object(), receipt), (object(), object())):
        with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_COMPOSITION_ADOPTION$"):
            composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
                wrong_owner, wrong_receipt
            )
    assert (connection.transaction_epoch, connection.total_changes) == before

    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_COMPOSITION_ADOPTION$"):
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(owner, object())
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1


def test_composition_rejects_cross_owner_receipt_without_adopting_either(
    tmp_path: Path,
) -> None:
    _connection_a, owner_a, _receipt_a = _active(tmp_path / "owner-a.sqlite")
    _connection_b, owner_b, receipt_b = _active(tmp_path / "owner-b.sqlite")
    with pytest.raises(ValueError, match=r"^GE_SQLITE_TX_OWNER_BEGIN_RECEIPT$"):
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(owner_a, receipt_b)
    terminal_a = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner_a
    )
    assert terminal_a.lifecycle == "finalized"
    assert terminal_a.rollback_attempt_count == 1
    adopted_b = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner_b, receipt_b
    )
    assert adopted_b is not None
    _capture_and_finalize(owner_b, RuntimeError("bounded stop b"))


def test_composition_preflight_presentation_failure_uses_exact_p9_cleanup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connection, owner, receipt = _active(tmp_path / "preflight.sqlite")
    primary = RuntimeError("preflight presentation unavailable")

    def unavailable(_owner: object) -> object:
        raise primary

    monkeypatch.setattr(transaction, "_presentation", unavailable)
    with pytest.raises(RuntimeError) as raised:
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(owner, receipt)
    assert raised.value is primary
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 0
    assert terminal.close_attempt_count == 1
    assert terminal.close_native_return_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.reopen_source_v1_count == 1


@pytest.mark.parametrize(
    "point",
    [
        "after-construction",
        "after-registration",
        "after-owner-pending",
        "after-owner-adopt",
    ],
)
def test_composition_adoption_faults_are_atomic_and_use_p9_cleanup(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    point: str,
) -> None:
    _connection, owner, receipt = _active(tmp_path / f"fault-{point}.sqlite")
    baseline = len(composition._COMPOSITIONS)

    class AdoptionFault(BaseException):
        pass

    primary = AdoptionFault(point)
    observed_partials: list[object] = []

    def inject(current: str, partial: object) -> None:
        if current == point:
            observed_partials.append(partial)
            with pytest.raises(
                ValueError,
                match=r"^GE_SQLITE_P11_COMPOSITION_PRESENTATION$",
            ):
                composition._read_sqlite_cursor_publication_owner_composition_snapshot_intrinsic(
                    partial
                )
            raise primary

    monkeypatch.setattr(
        composition,
        "_inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic",
        inject,
    )
    with pytest.raises(BaseException) as raised:
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(owner, receipt)
    assert raised.value is primary
    assert len(observed_partials) == 1
    assert len(composition._COMPOSITIONS) == baseline
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.rollback_native_return_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.close_native_return_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.reopen_source_v1_count == 1
    assert terminal.commit_attempt_count == 0


@pytest.mark.parametrize(
    "primary",
    [KeyboardInterrupt("keyboard"), SystemExit("system")],
)
def test_failure_capture_preserves_original_baseexception_identity(
    tmp_path: Path, primary: BaseException
) -> None:
    _connection, owner, _receipt = _active(tmp_path / f"primary-{type(primary).__name__}.sqlite")
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner, primary
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_TX_OWNER_PRIMARY$"):
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(owner)
    with pytest.raises(ValueError, match=r"^GE_SQLITE_TX_OWNER_FAILURE_CAPTURE$"):
        transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, RuntimeError("replacement")
        )
    with pytest.raises(BaseException) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner, capture
        )
    assert raised.value is primary
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0


def test_observation_unavailable_still_closes_and_reopens_without_rollback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connection, owner, _receipt = _active(tmp_path / "observation.sqlite")
    primary = RuntimeError("original")
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner, primary
    )

    def unavailable(*_args: object) -> object:
        raise RuntimeError("observation unavailable")

    monkeypatch.setattr(transaction, "_OBSERVE", unavailable)
    with pytest.raises(RuntimeError) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner, capture
        )
    assert raised.value is primary
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.rollback_attempt_count == 0
    assert terminal.close_attempt_count == 1
    assert terminal.close_native_return_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.reopen_source_v1_count == 1
    assert terminal.commit_attempt_count == 0


@pytest.mark.parametrize("classification", ["corrupt", "unavailable"])
def test_failure_capture_reopen_secondary_never_replaces_original_primary(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    classification: str,
) -> None:
    _connection, owner, _receipt = _active(tmp_path / f"reopen-{classification}.sqlite")
    primary = RuntimeError(f"original {classification}")
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner, primary
    )
    reopen = transaction._REOPEN_FINGERPRINT

    def classify(*args: object) -> object:
        if classification == "unavailable":
            raise OSError("unavailable")
        result = list(reopen(*args))
        result[1] = (0,)
        return tuple(result)

    monkeypatch.setattr(transaction, "_REOPEN_FINGERPRINT", classify)
    with pytest.raises(RuntimeError) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner, capture
        )
    assert raised.value is primary
    assert isinstance(primary.__cause__, ValueError)
    expected = (
        "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
        if classification == "corrupt"
        else "GE_SQLITE_TX_OWNER_REOPEN_UNAVAILABLE"
    )
    assert primary.__cause__.args == (expected,)
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1


def test_failure_capture_rejects_cross_owner_clone_and_replay(tmp_path: Path) -> None:
    _connection_a, owner_a, _receipt_a = _active(tmp_path / "capture-a.sqlite")
    _connection_b, owner_b, _receipt_b = _active(tmp_path / "capture-b.sqlite")
    primary = RuntimeError("original")
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner_a, primary
    )
    with pytest.raises(TypeError, match=r"^GE_SQLITE_TX_OWNER_FAILURE_CAPTURE$"):
        connection = object.__getattribute__(
            capture, "_SQLiteCursorPublicationTransactionFailureCapture__connection"
        )
        lineage = object.__getattribute__(
            capture, "_SQLiteCursorPublicationTransactionFailureCapture__lineage"
        )
        generation = object.__getattribute__(
            capture, "_SQLiteCursorPublicationTransactionFailureCapture__generation"
        )
        source_fingerprint = object.__getattribute__(
            capture,
            "_SQLiteCursorPublicationTransactionFailureCapture__source_fingerprint",
        )
        transaction._SQLiteCursorPublicationTransactionFailureCapture(
            owner_a,
            primary,
            connection,
            lineage,
            generation,
            1,
            source_fingerprint,
            object(),
        )
    clone = object.__new__(transaction._SQLiteCursorPublicationTransactionFailureCapture)
    with pytest.raises(ValueError, match=r"^GE_SQLITE_TX_OWNER_FAILURE_CAPTURE$"):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner_a, clone
        )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_TX_OWNER_FAILURE_CAPTURE$"):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner_b, capture
        )
    with pytest.raises(RuntimeError) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner_a, capture
        )
    assert raised.value is primary
    with pytest.raises(ValueError, match=r"^GE_SQLITE_TX_OWNER_FAILURE_CAPTURE$"):
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner_a, capture
        )
    _capture_and_finalize(owner_b, RuntimeError("bounded stop b"))


def test_failure_capture_survives_presentation_accessor_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connection, owner, _receipt = _active(tmp_path / "presentation.sqlite")
    primary = RuntimeError("original presentation primary")
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner, primary
    )

    def unavailable(_owner: object) -> object:
        raise RuntimeError("presentation accessor unavailable")

    monkeypatch.setattr(transaction, "_presentation", unavailable)
    with pytest.raises(RuntimeError) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner, capture
        )
    assert raised.value is primary
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.rollback_attempt_count == 0
    assert terminal.close_attempt_count == 1
    assert terminal.close_native_return_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.reopen_source_v1_count == 1


def test_failure_capture_uses_definition_time_isinstance(tmp_path: Path) -> None:
    _connection, owner, _receipt = _active(tmp_path / "isinstance.sqlite")
    primary = RuntimeError("definition-time primary")
    original = builtins.isinstance
    try:
        builtins.isinstance = lambda *_args: False  # type: ignore[assignment]
        capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
            owner, primary
        )
    finally:
        builtins.isinstance = original
    with pytest.raises(RuntimeError) as raised:
        transaction._finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
            owner, capture
        )
    assert raised.value is primary


def test_private_composition_collects_and_is_not_package_exported(tmp_path: Path) -> None:
    _connection, owner, receipt = _active(tmp_path / "gc.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    adopted_ref = ref(adopted)
    assert not hasattr(graph_engineering, "SQLiteCursorPublicationOwnerComposition")
    assert not hasattr(graph_engineering, "SQLiteCursorPublicationMutationScope")
    _capture_and_finalize(owner, RuntimeError("bounded stop"))
    del adopted
    del receipt
    del owner
    gc.collect()
    gc.collect()
    assert adopted_ref() is None


def test_abandoned_active_composition_has_no_registry_reverse_root(
    tmp_path: Path,
) -> None:
    owner_baseline = len(transaction._OWNERS)
    composition_baseline = len(composition._COMPOSITIONS)
    connection, owner, receipt = _active(tmp_path / "abandoned.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    connection_ref = ref(connection)
    owner_ref = ref(owner)
    receipt_ref = ref(receipt)
    adopted_ref = ref(adopted)
    assert len(transaction._OWNERS) == owner_baseline + 1
    assert len(composition._COMPOSITIONS) == composition_baseline + 1

    del adopted
    del receipt
    del owner
    del connection
    gc.collect()
    gc.collect()

    assert adopted_ref() is None
    assert receipt_ref() is None
    assert owner_ref() is None
    assert connection_ref() is None
    assert len(composition._COMPOSITIONS) == composition_baseline
    assert len(transaction._OWNERS) == owner_baseline


def _advance_mutation_child(child: object) -> None:
    composition._enter_sqlite_cursor_publication_mutation_child_permit_intrinsic(child)
    composition._record_sqlite_cursor_publication_mutation_child_return_intrinsic(child)
    composition._retire_sqlite_cursor_publication_mutation_child_resource_intrinsic(child)
    composition._accept_sqlite_cursor_publication_mutation_child_postflight_intrinsic(child)
    composition._consume_sqlite_cursor_publication_mutation_child_permit_intrinsic(child)


def test_child_owned_scope_advances_exact_ordinals_without_native_io(
    tmp_path: Path,
) -> None:
    _connection, owner, receipt = _active(tmp_path / "child-owned.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    route = composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1]
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted, route, 20
    )
    for ordinal in range(20):
        child = composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(
            parent, ordinal
        )
        _advance_mutation_child(child)
    composition._consume_sqlite_cursor_publication_mutation_parent_scope_intrinsic(parent)
    snapshot = composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
        parent
    )
    assert snapshot.route_id == "main.migration-0002"
    assert snapshot.binding_kind == "asset-sha256"
    assert snapshot.binding_sha256 == (
        "1bf03d68eed45366bc7b34ccc329faa51ea389362db59f6a4307b3033d37a96d"
    )
    assert snapshot.model == "child-owned-one-shot"
    assert snapshot.lifecycle == "parent-consumed"
    assert snapshot.expected_count == 20
    assert snapshot.next_ordinal == 20
    assert snapshot.child_issued_count == 20
    assert snapshot.child_entered_count == 20
    assert snapshot.child_native_return_count == 20
    assert snapshot.child_resource_retired_count == 20
    assert snapshot.child_postflight_accepted_count == 20
    assert snapshot.child_consumed_count == 20
    assert snapshot.reusable_parent_prepare_count == 0
    assert snapshot.parent_resource_retired_count == 0
    assert snapshot.actual_native_io_count == 0
    assert snapshot.sql_authority is False
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


@pytest.mark.parametrize("expected_count", [0, 3])
def test_parent_owned_reusable_scope_handles_zero_and_n_without_native_io(
    tmp_path: Path, expected_count: int
) -> None:
    _connection, owner, receipt = _active(tmp_path / f"parent-owned-{expected_count}.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    route = composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2]
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted, route, _retained_count_receipt_for(adopted, expected_count)
    )
    composition._prepare_sqlite_cursor_publication_reusable_parent_intrinsic(parent)
    for ordinal in range(expected_count):
        child = composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(
            parent, ordinal
        )
        _advance_mutation_child(child)
    if expected_count == 0:
        composition._accept_sqlite_cursor_publication_mutation_zero_item_postflight_intrinsic(
            parent
        )
    composition._retire_sqlite_cursor_publication_reusable_parent_resource_intrinsic(parent)
    composition._consume_sqlite_cursor_publication_mutation_parent_scope_intrinsic(parent)
    snapshot = composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
        parent
    )
    assert snapshot.lifecycle == "parent-consumed"
    assert snapshot.model == "parent-owned-reusable"
    assert snapshot.reusable_parent_prepare_count == 1
    assert snapshot.reusable_execution_lease_released_count == expected_count
    assert snapshot.parent_resource_retired_count == 1
    assert snapshot.child_consumed_count == expected_count
    assert snapshot.actual_native_io_count == 0
    assert snapshot.sql_authority is False
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_retained_projection_count_receipt_is_one_shot_and_has_explicit_nonclaims(
    tmp_path: Path,
) -> None:
    _connection, owner, begin_receipt = _active(tmp_path / "retained-count.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    retained_count_receipt = _retained_count_receipt_for(adopted, 0)
    snapshot = (
        composition._read_sqlite_cursor_publication_retained_count_receipt_snapshot_intrinsic(
            adopted, retained_count_receipt
        )
    )
    assert snapshot.route_id == "main.baseline-entries"
    assert snapshot.lifecycle == "issued"
    assert snapshot.retained_count == 0
    assert snapshot.exact_owner is True
    assert snapshot.exact_generation is True
    assert snapshot.exact_scope is False
    assert snapshot.exact_retained_projection_identity is True
    assert snapshot.exact_retained_projection_count is True
    assert snapshot.native_source_provenance is False
    assert snapshot.genuine_zero_claim is False
    assert snapshot.one_shot is True
    assert snapshot.actual_native_io_count == 0
    assert snapshot.sql_authority is False

    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        retained_count_receipt,
    )
    consumed_snapshot = (
        composition._read_sqlite_cursor_publication_retained_count_receipt_snapshot_intrinsic(
            adopted, retained_count_receipt
        )
    )
    assert consumed_snapshot.lifecycle == "consumed"
    assert consumed_snapshot.exact_scope is True
    assert (
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            parent
        ).expected_count
        == 0
    )
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_scalar_fake_zero_and_retained_count_receipt_replay_fail_closed(
    tmp_path: Path,
) -> None:
    _connection, fake_owner, fake_begin = _active(tmp_path / "fake-zero.sqlite")
    fake_composition = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        fake_owner, fake_begin
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            fake_composition,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            0,
        )
    assert (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
            fake_owner
        ).commit_attempt_count
        == 0
    )

    _connection, replay_owner, replay_begin = _active(tmp_path / "receipt-replay.sqlite")
    replay_composition = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        replay_owner, replay_begin
    )
    retained_count_receipt = _retained_count_receipt_for(replay_composition, 0)
    composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        replay_composition,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        retained_count_receipt,
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            replay_composition,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            retained_count_receipt,
        )
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        replay_owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


def test_parent_strongly_retains_consumed_count_receipt_and_projection(
    tmp_path: Path,
) -> None:
    _connection, owner, begin_receipt = _active(tmp_path / "receipt-retained.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    retained_count_receipt = _retained_count_receipt_for(adopted, 2)
    retained_count_receipt_ref = ref(retained_count_receipt)
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        retained_count_receipt,
    )
    del retained_count_receipt
    gc.collect()
    assert retained_count_receipt_ref() is not None
    assert (
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            parent
        ).expected_count
        == 2
    )
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_abandoned_receipt_callback_cannot_delete_reused_identity_entry(
    tmp_path: Path,
) -> None:
    _connection, owner, begin_receipt = _active(tmp_path / "receipt-id-reuse.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    abandoned = _retained_count_receipt_for(adopted, 0)
    abandoned_id = id(abandoned)
    abandoned_entry = composition._RETAINED_COUNT_RECEIPTS[abandoned_id]
    stale_callback = abandoned_entry.token_ref.__callback__
    assert stale_callback is not None
    abandoned_ref = ref(abandoned)
    del abandoned
    gc.collect()
    assert abandoned_ref() is None
    assert abandoned_id not in composition._RETAINED_COUNT_RECEIPTS

    replacement = _retained_count_receipt_for(adopted, 1)
    replacement_id = id(replacement)
    replacement_entry = composition._RETAINED_COUNT_RECEIPTS[replacement_id]
    if replacement_id != abandoned_id:
        composition._RETAINED_COUNT_RECEIPTS.pop(replacement_id)
        composition._RETAINED_COUNT_RECEIPTS[abandoned_id] = replacement_entry
    try:
        stale_callback(abandoned_entry.token_ref)
        assert composition._RETAINED_COUNT_RECEIPTS[abandoned_id] is replacement_entry
    finally:
        if replacement_id != abandoned_id:
            composition._RETAINED_COUNT_RECEIPTS.pop(abandoned_id, None)
            composition._RETAINED_COUNT_RECEIPTS[replacement_id] = replacement_entry
    assert (
        composition._read_sqlite_cursor_publication_retained_count_receipt_snapshot_intrinsic(
            adopted, replacement
        ).retained_count
        == 1
    )
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_retained_count_receipt_base_setattr_tamper_terminally_fails_exact_graph(
    tmp_path: Path,
) -> None:
    _connection, owner, begin_receipt = _active(tmp_path / "receipt-tamper.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    retained_count_receipt = _retained_count_receipt_for(adopted, 1)
    object.__setattr__(
        retained_count_receipt,
        "_SQLiteCursorPublicationRetainedCountReceipt__projection",
        (),
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            retained_count_receipt,
        )
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0


@pytest.mark.parametrize("projection", [[], tuple(range(1_025))])
def test_retained_count_receipt_rejects_invalid_projection(
    tmp_path: Path, projection: object
) -> None:
    _connection, owner, begin_receipt = _active(tmp_path / "receipt-invalid.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._mint_sqlite_cursor_publication_retained_count_receipt_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            projection,  # type: ignore[arg-type]
        )
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


def test_retained_count_receipt_rejects_non_baseline_route(tmp_path: Path) -> None:
    _connection, owner, begin_receipt = _active(tmp_path / "receipt-route.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._mint_sqlite_cursor_publication_retained_count_receipt_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
            (),
        )
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


def test_cross_composition_receipt_attack_does_not_poison_source_receipt(
    tmp_path: Path,
) -> None:
    _source_connection, source_owner, source_begin = _active(tmp_path / "source.sqlite")
    source_composition = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        source_owner, source_begin
    )
    source_receipt = _retained_count_receipt_for(source_composition, 0)
    _target_connection, target_owner, target_begin = _active(tmp_path / "target.sqlite")
    target_composition = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        target_owner, target_begin
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            target_composition,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            source_receipt,
        )
    target_terminal = (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
            target_owner
        )
    )
    assert target_terminal.lifecycle == "finalized"
    source_snapshot = (
        composition._read_sqlite_cursor_publication_retained_count_receipt_snapshot_intrinsic(
            source_composition, source_receipt
        )
    )
    assert source_snapshot.lifecycle == "issued"
    assert source_snapshot.exact_scope is False
    composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        source_composition,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        source_receipt,
    )
    assert (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
            source_owner
        ).lifecycle
        == "active"
    )
    _capture_and_finalize(source_owner, RuntimeError("bounded stop"))


def test_mutation_order_failure_terminally_poisons_exact_p9_graph(
    tmp_path: Path,
) -> None:
    _connection, owner, receipt = _active(tmp_path / "scope-order.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1],
        20,
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_ORDER$") as raised:
        composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(parent, 1)
    assert raised.value.args == ("GE_SQLITE_P11_SCOPE_ORDER",)
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_FIXED_READ_INVALID$"):
        composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
            0,
        )


def test_cloned_route_descriptors_are_terminal_before_native_io(tmp_path: Path) -> None:
    _connection, owner, receipt = _active(tmp_path / "clone-mutation.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    exact = composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0]
    clone = composition._SQLiteCursorPublicationMutationRouteDescriptor(*exact)
    assert clone == exact and clone is not exact
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            adopted, clone, 0
        )
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


def test_route_descriptors_match_the_exact_machine_contract(tmp_path: Path) -> None:
    contract_path = (
        Path(__file__).parents[2]
        / "spec"
        / "sqlite-cursor-publication-owner-composition-p11.routes.json"
    )
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    b2_cursor_seal = contract["b2MutationRoutes"][-2]
    migration = contract["migration0002Route"]
    permanent = contract["permanentMutationRoutes"]
    expected_mutations = (
        (
            b2_cursor_seal["id"],
            b2_cursor_seal["model"],
            "sql-sha256",
            b2_cursor_seal["sqlSha256"],
        ),
        (
            migration["id"],
            migration["model"],
            "asset-sha256",
            migration["assetSha256"],
        ),
        *((route["id"], route["model"], "sql-sha256", route["sqlSha256"]) for route in permanent),
    )
    assert expected_mutations == composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES

    fixed = contract["fixedReadRoutes"]
    expected_reads = (
        (
            fixed["base"][0]["id"],
            "owner-active-read",
            fixed["base"][0]["sqlSha256"],
        ),
        *zip(
            fixed["b2EqpSet"]["routeIds"],
            ("b2-eqp",) * 15,
            fixed["b2EqpSet"]["sqlSha256"],
            strict=True,
        ),
        *zip(
            fixed["rule12EqpSet"]["routeIds"],
            ("rule12-eqp",) * 3,
            fixed["rule12EqpSet"]["sqlSha256"],
            strict=True,
        ),
    )
    assert expected_reads == composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES

    _connection, owner, receipt = _active(tmp_path / "clone-read.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    exact_read = composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[1]
    clone_read = composition._SQLiteCursorPublicationFixedReadRouteDescriptor(*exact_read)
    assert clone_read == exact_read and clone_read is not exact_read
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_FIXED_READ_INVALID$"):
        composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
            adopted, clone_read, 0
        )
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


@pytest.mark.parametrize(
    ("route_index", "wrong_count"),
    [
        *((1, count) for count in (0, 2, 19, 21)),
        *((route_index, count) for route_index in (0, 3, 4, 5) for count in (0, 2, 19, 21)),
    ],
)
def test_fixed_mutation_route_wrong_counts_terminally_fail_before_route_io(
    tmp_path: Path, route_index: int, wrong_count: int
) -> None:
    _connection, owner, receipt = _active(
        tmp_path / f"wrong-count-{route_index}-{wrong_count}.sqlite"
    )
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    parent_count_before = len(composition._PARENT_SCOPES)
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[route_index],
            wrong_count,
        )
    assert len(composition._PARENT_SCOPES) == parent_count_before
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0


@pytest.mark.parametrize("expected_count", [0, 1_024])
def test_reusable_route_accepts_bounded_projection_counts_without_native_provenance_claim(
    tmp_path: Path, expected_count: int
) -> None:
    _connection, owner, receipt = _active(tmp_path / f"reusable-bound-{expected_count}.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
        _retained_count_receipt_for(adopted, expected_count),
    )
    snapshot = composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
        parent
    )
    assert snapshot.expected_count == expected_count
    assert snapshot.actual_native_io_count == 0
    assert snapshot.sql_authority is False
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


@pytest.mark.parametrize("wrong_count", [-1, 1_025, True])
def test_reusable_route_rejects_out_of_bounds_and_bool_before_route_io(
    tmp_path: Path, wrong_count: object
) -> None:
    _connection, owner, receipt = _active(tmp_path / f"reusable-wrong-{wrong_count!s}.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_SCOPE_INVALID$"):
        composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            wrong_count,  # type: ignore[arg-type]
        )
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.commit_attempt_count == 0


def test_fixed_read_route_sets_are_exact_bounded_and_zero_io(tmp_path: Path) -> None:
    routes = composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES
    b2_ids = tuple(route.route_id for route in routes if route.family == "b2-eqp")
    rule12_ids = tuple(route.route_id for route in routes if route.family == "rule12-eqp")
    assert len(b2_ids) == 15
    assert len(rule12_ids) == 3
    assert set(b2_ids).isdisjoint(rule12_ids)

    _connection, owner, receipt = _active(tmp_path / "fixed-read.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    permit = composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
        adopted, routes[1], 2
    )
    composition._prepare_sqlite_cursor_publication_fixed_read_permit_intrinsic(permit)
    composition._begin_sqlite_cursor_publication_fixed_read_intrinsic(permit)
    composition._observe_sqlite_cursor_publication_fixed_read_row_intrinsic(permit)
    composition._observe_sqlite_cursor_publication_fixed_read_row_intrinsic(permit)
    composition._observe_sqlite_cursor_publication_fixed_read_terminal_intrinsic(permit)
    composition._retire_sqlite_cursor_publication_fixed_read_resource_intrinsic(
        permit, "abstract-python-cursor-release"
    )
    composition._consume_sqlite_cursor_publication_fixed_read_permit_intrinsic(permit)
    snapshot = composition._read_sqlite_cursor_publication_fixed_read_permit_snapshot_intrinsic(
        permit
    )
    assert snapshot.route_id == "b2.eqp.source"
    assert snapshot.sql_sha256 == (
        "dda30c873dcae965e1cac3f6478549b98e2414e982c1287997b93a2c09d760a4"
    )
    assert snapshot.lifecycle == "consumed"
    assert snapshot.maximum_rows == 2
    assert snapshot.observed_rows == 2
    assert snapshot.maximum_cursors == 1
    assert snapshot.prepare_count == 1
    assert snapshot.resource_retired is True
    assert snapshot.resource_kind == "abstract-python-cursor-release"
    assert snapshot.native_cursor_close_attempt_count == 0
    assert snapshot.native_cursor_close_return_count == 0
    assert snapshot.actual_native_io_count == 0
    assert snapshot.mutation_delta == 0
    assert snapshot.sql_authority is False
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_fixed_read_order_failure_preserves_primary_and_terminally_cleans_p9(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connection, owner, receipt = _active(tmp_path / "fixed-order.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    permit = composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
        0,
    )
    captured_primaries: list[BaseException] = []
    original_capture = composition._capture_sqlite_cursor_publication_transaction_failure_intrinsic

    def capture_exact(current_owner: object, primary: BaseException) -> object:
        captured_primaries.append(primary)
        return original_capture(current_owner, primary)

    monkeypatch.setattr(
        composition,
        "_capture_sqlite_cursor_publication_transaction_failure_intrinsic",
        capture_exact,
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_FIXED_READ_ORDER$") as raised:
        composition._begin_sqlite_cursor_publication_fixed_read_intrinsic(permit)
    assert raised.value.args == ("GE_SQLITE_P11_FIXED_READ_ORDER",)
    assert captured_primaries == [raised.value]
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0


def test_zero_row_fixed_read_still_requires_terminal_and_abstract_retirement(
    tmp_path: Path,
) -> None:
    _connection, owner, receipt = _active(tmp_path / "fixed-zero.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    permit = composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[16],
        0,
    )
    composition._prepare_sqlite_cursor_publication_fixed_read_permit_intrinsic(permit)
    composition._begin_sqlite_cursor_publication_fixed_read_intrinsic(permit)
    composition._observe_sqlite_cursor_publication_fixed_read_terminal_intrinsic(permit)
    composition._retire_sqlite_cursor_publication_fixed_read_resource_intrinsic(
        permit, "abstract-python-cursor-release"
    )
    composition._consume_sqlite_cursor_publication_fixed_read_permit_intrinsic(permit)
    snapshot = composition._read_sqlite_cursor_publication_fixed_read_permit_snapshot_intrinsic(
        permit
    )
    assert snapshot.observed_rows == 0
    assert snapshot.terminal_row_observed is True
    assert snapshot.resource_retired is True
    assert snapshot.native_cursor_close_attempt_count == 0
    assert snapshot.native_cursor_close_return_count == 0
    assert snapshot.actual_native_io_count == 0
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_every_derived_scope_transition_reproves_native_current_owner(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connection, owner, receipt = _active(tmp_path / "native-reproof.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    native_observation_count = 0
    original_observe = transaction._OBSERVE

    def observe_exact(*args: object) -> object:
        nonlocal native_observation_count
        native_observation_count += 1
        return original_observe(*args)

    monkeypatch.setattr(transaction, "_OBSERVE", observe_exact)
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
        1,
    )
    child = composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(parent, 0)
    _advance_mutation_child(child)
    composition._consume_sqlite_cursor_publication_mutation_parent_scope_intrinsic(parent)
    composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(parent)
    assert native_observation_count == 9
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_composition_snapshot_native_drift_terminally_uses_exact_p9_primary(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connection, owner, receipt = _active(tmp_path / "snapshot-drift.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    original_observe = transaction._OBSERVE
    original_capture = composition._capture_sqlite_cursor_publication_transaction_failure_intrinsic
    captured_primaries: list[BaseException] = []

    def drift(*args: object) -> object:
        observation = list(original_observe(*args))
        observation[5] += 1
        return tuple(observation)

    def capture_exact(current_owner: object, primary: BaseException) -> object:
        captured_primaries.append(primary)
        return original_capture(current_owner, primary)

    monkeypatch.setattr(transaction, "_OBSERVE", drift)
    monkeypatch.setattr(
        composition,
        "_capture_sqlite_cursor_publication_transaction_failure_intrinsic",
        capture_exact,
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_COMPOSITION_PRESENTATION$") as raised:
        composition._read_sqlite_cursor_publication_owner_composition_snapshot_intrinsic(adopted)
    assert captured_primaries == [raised.value]
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0


def test_abandoned_active_scope_child_and_fixed_permit_leave_no_registry_roots(
    tmp_path: Path,
) -> None:
    gc.collect()
    gc.collect()
    owner_baseline = len(transaction._OWNERS)
    composition_baseline = len(composition._COMPOSITIONS)
    parent_baseline = len(composition._PARENT_SCOPES)
    retained_count_baseline = len(composition._RETAINED_COUNT_RECEIPTS)
    child_baseline = len(composition._CHILD_PERMITS)
    fixed_baseline = len(composition._FIXED_READ_PERMITS)
    connection, owner, receipt = _active(tmp_path / "scope-gc.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
        1,
    )
    child = composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(parent, 0)
    permit = composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
        0,
    )
    retained_count_receipt = _retained_count_receipt_for(adopted, 0)
    retained_count_parent = (
        composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
            retained_count_receipt,
        )
    )
    connection_ref = ref(connection)
    owner_ref = ref(owner)
    receipt_ref = ref(receipt)
    adopted_ref = ref(adopted)
    parent_ref = ref(parent)
    child_ref = ref(child)
    permit_ref = ref(permit)
    retained_count_receipt_ref = ref(retained_count_receipt)
    retained_count_parent_ref = ref(retained_count_parent)

    del retained_count_parent
    del retained_count_receipt
    del permit
    del child
    del parent
    del adopted
    del receipt
    del owner
    del connection
    gc.collect()
    gc.collect()

    assert permit_ref() is None
    assert retained_count_parent_ref() is None
    assert retained_count_receipt_ref() is None
    assert child_ref() is None
    assert parent_ref() is None
    assert adopted_ref() is None
    assert receipt_ref() is None
    assert owner_ref() is None
    assert connection_ref() is None
    assert len(composition._FIXED_READ_PERMITS) == fixed_baseline
    assert len(composition._CHILD_PERMITS) == child_baseline
    assert len(composition._PARENT_SCOPES) == parent_baseline
    assert len(composition._RETAINED_COUNT_RECEIPTS) == retained_count_baseline
    assert len(composition._COMPOSITIONS) == composition_baseline
    assert len(transaction._OWNERS) == owner_baseline


@pytest.mark.parametrize(
    ("token_kind", "action"),
    [
        (token_kind, action)
        for token_kind in ("composition", "parent", "child", "fixed")
        for action in ("setattr", "delattr", "base-setattr", "base-delattr")
    ],
)
def test_recognized_token_attribute_tampering_terminally_cleans_exact_p9(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    token_kind: str,
    action: str,
) -> None:
    _connection, owner, receipt = _active(tmp_path / f"token-{token_kind}-{action}.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
        1,
    )
    child = composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(parent, 0)
    permit = composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
        0,
    )
    selected = {
        "composition": (
            adopted,
            "_SQLiteCursorPublicationOwnerComposition__owner",
            lambda: (
                composition._read_sqlite_cursor_publication_owner_composition_snapshot_intrinsic(
                    adopted
                )
            ),
        ),
        "parent": (
            parent,
            "_SQLiteCursorPublicationMutationParentScope__composition",
            lambda: (
                composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
                    parent
                )
            ),
        ),
        "child": (
            child,
            "_SQLiteCursorPublicationMutationChildPermit__parent",
            lambda: (
                composition._read_sqlite_cursor_publication_mutation_child_permit_snapshot_intrinsic(
                    child
                )
            ),
        ),
        "fixed": (
            permit,
            "_SQLiteCursorPublicationFixedReadPermit__composition",
            lambda: (
                composition._read_sqlite_cursor_publication_fixed_read_permit_snapshot_intrinsic(
                    permit
                )
            ),
        ),
    }[token_kind]
    token, attribute, present = selected
    captured_primaries: list[BaseException] = []
    original_capture = composition._capture_sqlite_cursor_publication_transaction_failure_intrinsic

    def capture_exact(current_owner: object, primary: BaseException) -> object:
        captured_primaries.append(primary)
        return original_capture(current_owner, primary)

    monkeypatch.setattr(
        composition,
        "_capture_sqlite_cursor_publication_transaction_failure_intrinsic",
        capture_exact,
    )
    with pytest.raises(BaseException) as raised:
        if action == "setattr":
            setattr(token, attribute, object())
        elif action == "delattr":
            delattr(token, attribute)
        elif action == "base-setattr":
            object.__setattr__(token, attribute, object())
            present()
        else:
            object.__delattr__(token, attribute)
            present()
    assert captured_primaries == [raised.value]
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0


def test_definition_time_object_intrinsics_survive_builtins_replacement(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _connection, owner, receipt = _active(tmp_path / "hostile-object.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
        adopted,
        composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[1],
        20,
    )
    original_object = builtins.object
    hostile_sentinel = RuntimeError("HOSTILE_BUILTINS_OBJECT_INTRINSIC_USED")

    class HostileObject:
        @staticmethod
        def __getattribute__(*_args: object) -> Never:
            raise hostile_sentinel

        @staticmethod
        def __setattr__(*_args: object) -> Never:
            raise hostile_sentinel

        @staticmethod
        def __delattr__(*_args: object) -> Never:
            raise hostile_sentinel

    captured_primaries: list[BaseException] = []
    original_capture = composition._capture_sqlite_cursor_publication_transaction_failure_intrinsic

    def capture_exact(current_owner: object, primary: BaseException) -> object:
        captured_primaries.append(primary)
        return original_capture(current_owner, primary)

    monkeypatch.setattr(
        composition,
        "_capture_sqlite_cursor_publication_transaction_failure_intrinsic",
        capture_exact,
    )

    thrown: BaseException | None = None
    try:
        builtins.object = HostileObject  # type: ignore[misc,assignment]
        composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(parent, 1)
    except BaseException as error:
        thrown = error
    finally:
        builtins.object = original_object  # type: ignore[misc,assignment]
    assert isinstance(thrown, ValueError)
    assert thrown.args == ("GE_SQLITE_P11_SCOPE_ORDER",)
    assert captured_primaries == [thrown]
    terminal = transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
        owner
    )
    assert terminal.lifecycle == "finalized"
    assert terminal.rollback_attempt_count == 1
    assert terminal.close_attempt_count == 1
    assert terminal.reopen_attempt_count == 1
    assert terminal.commit_attempt_count == 0


def test_definition_time_int_and_tuple_types_survive_builtins_replacement(
    tmp_path: Path,
) -> None:
    _connection, owner, begin_receipt = _active(tmp_path / "hostile-types.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, begin_receipt
    )
    retained_projection = ({"ordinal": 0},)
    original_int = builtins.int
    original_tuple = builtins.tuple

    class HostileInt(int):
        pass

    class HostileTuple(tuple):
        pass

    thrown: BaseException | None = None
    retained_parent: object | None = None
    fixed_permit: object | None = None
    child: object | None = None
    try:
        builtins.int = HostileInt  # type: ignore[misc,assignment]
        builtins.tuple = HostileTuple  # type: ignore[misc,assignment]
        retained_count_receipt = (
            composition._mint_sqlite_cursor_publication_retained_count_receipt_intrinsic(
                adopted,
                composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
                retained_projection,
            )
        )
        retained_parent = (
            composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
                adopted,
                composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[2],
                retained_count_receipt,
            )
        )
        one_parent = composition._issue_sqlite_cursor_publication_mutation_parent_scope_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_MUTATION_ROUTES[0],
            1,
        )
        child = composition._issue_sqlite_cursor_publication_mutation_child_permit_intrinsic(
            one_parent, 0
        )
        fixed_permit = composition._issue_sqlite_cursor_publication_fixed_read_permit_intrinsic(
            adopted,
            composition._SQLITE_CURSOR_PUBLICATION_P11_FIXED_READ_ROUTES[0],
            0,
        )
    except BaseException as error:
        thrown = error
    finally:
        builtins.int = original_int  # type: ignore[misc,assignment]
        builtins.tuple = original_tuple  # type: ignore[misc,assignment]
    assert thrown is None
    assert retained_parent is not None
    assert fixed_permit is not None
    assert child is not None
    assert (
        composition._read_sqlite_cursor_publication_mutation_parent_scope_snapshot_intrinsic(
            retained_parent
        ).expected_count
        == 1
    )
    _capture_and_finalize(owner, RuntimeError("bounded stop"))
