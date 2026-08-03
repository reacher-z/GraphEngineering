from __future__ import annotations

import builtins
import gc
from pathlib import Path
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


def test_exact_p9_owner_and_begin_receipt_are_adopted_once(tmp_path: Path) -> None:
    connection, owner, receipt = _active(tmp_path / "composition.sqlite")
    adopted = composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    snapshot = (
        composition._read_sqlite_cursor_publication_owner_composition_snapshot_intrinsic(
            adopted
        )
    )
    owner_snapshot = (
        transaction._read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
            owner
        )
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
        transaction._commit_sqlite_cursor_publication_transaction_intrinsic(
            owner, object()
        )
    assert (connection.transaction_epoch, connection.total_changes) == before
    _capture_and_finalize(owner, RuntimeError("bounded stop"))


def test_composition_replay_is_terminal_and_runs_exact_p9_cleanup(
    tmp_path: Path,
) -> None:
    _connection, owner, receipt = _active(tmp_path / "replay.sqlite")
    composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_P11_COMPOSITION_ADOPTION$"):
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            owner, receipt
        )
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
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            owner, object()
        )
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
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            owner_a, receipt_b
        )
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
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            owner, receipt
        )
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
        composition._adopt_sqlite_cursor_publication_owner_composition_intrinsic(
            owner, receipt
        )
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
    _connection, owner, _receipt = _active(
        tmp_path / f"primary-{type(primary).__name__}.sqlite"
    )
    capture = transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
        owner, primary
    )
    with pytest.raises(ValueError, match=r"^GE_SQLITE_TX_OWNER_PRIMARY$"):
        transaction._select_sqlite_cursor_publication_authenticated_failure_intrinsic(
            owner
        )
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
    _connection, owner, _receipt = _active(
        tmp_path / f"reopen-{classification}.sqlite"
    )
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
    clone = object.__new__(
        transaction._SQLiteCursorPublicationTransactionFailureCapture
    )
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
        capture = (
            transaction._capture_sqlite_cursor_publication_transaction_failure_intrinsic(
                owner, primary
            )
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
