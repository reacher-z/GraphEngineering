"""Package-private P11 owner/BEGIN composition substrate.

This first slice adopts only the exact active P9 transaction owner and its
current BEGIN receipt.  It deliberately mints no write scope, read permit,
Rule 12 edge, third-clock consumer, success claim, or COMMIT authority.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import NamedTuple, Never
from weakref import ReferenceType, ref

from .sqlite_cursor_publication_transaction_owner import (
    _abort_sqlite_cursor_publication_owner_composition_adoption_intrinsic,
    _assert_sqlite_cursor_publication_owner_composition_intrinsic,
    _capture_sqlite_cursor_publication_transaction_failure_intrinsic,
    _complete_sqlite_cursor_publication_owner_composition_adoption_intrinsic,
    _finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic,
    _prepare_sqlite_cursor_publication_owner_composition_adoption_intrinsic,
    _read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic,
    _SQLiteCursorPublicationBeginReceipt,
    _SQLiteCursorPublicationTransactionOwner,
)

_CONSTRUCTION_TOKEN = object()
_TYPE = type
_ID = id
_DICT_GET = dict.get
_DICT_SET = dict.__setitem__
_DICT_POP = dict.pop


def _fail(code: str) -> Never:
    raise ValueError(code)


def _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
    _point: str,
    _composition: _SQLiteCursorPublicationOwnerComposition,
) -> None:
    """Definition-owned no-op seam used only by package tests."""


class _SQLiteCursorPublicationOwnerComposition:
    __slots__ = ("__owner", "__receipt", "__weakref__")

    def __init__(
        self,
        owner: _SQLiteCursorPublicationTransactionOwner,
        receipt: object,
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_COMPOSITION_CONSTRUCTION")
        self.__owner = owner
        self.__receipt = receipt


class _SQLiteCursorPublicationMutationScope:
    """Reserved opaque type; P11-A does not yet mint mutation authority."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_MUTATION_SCOPE_CONSTRUCTION")


class _SQLiteCursorPublicationFixedReadPermit:
    """Reserved opaque type; P11-A does not yet mint fixed-read authority."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_P11_FIXED_READ_CONSTRUCTION")


class _SQLiteCursorPublicationOwnerCompositionSnapshot(NamedTuple):
    lifecycle: str
    exact_owner: bool
    exact_begin_receipt: bool
    exact_connection: bool
    exact_lineage: bool
    exact_generation: bool
    begin_transaction_epoch: int
    begin_total_changes: int
    begin_temp_mutation_epoch: int
    current_transaction_epoch: int
    current_total_changes: int
    current_temp_mutation_epoch: int
    highest_accepted_30_stage: None
    accepted_stage_receipt_count: int
    accepted_stage_ids: tuple[str, ...]
    attempted_stage: None
    third_evidence_consumed: bool
    commit_presented: bool
    commit_attempt_count: int


@dataclass(slots=True)
class _Record:
    owner_ref: ReferenceType[_SQLiteCursorPublicationTransactionOwner]
    receipt_ref: ReferenceType[_SQLiteCursorPublicationBeginReceipt]
    connection_ref: ReferenceType[object] | None
    lineage_ref: ReferenceType[object] | None
    generation_ref: ReferenceType[object] | None
    begin_transaction_epoch: int
    begin_total_changes: int
    begin_temp_mutation_epoch: int
    lifecycle: str = "unadopted"


class _Entry(NamedTuple):
    composition_ref: ReferenceType[_SQLiteCursorPublicationOwnerComposition]
    record: _Record


_COMPOSITIONS: dict[int, _Entry] = {}


def _record_for(
    composition: _SQLiteCursorPublicationOwnerComposition,
) -> _Record:
    if _TYPE(composition) is not _SQLiteCursorPublicationOwnerComposition:
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    entry = _DICT_GET(_COMPOSITIONS, _ID(composition))
    if entry is None or entry.composition_ref() is not composition:
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    return entry.record


def _composition_owner_receipt(
    composition: _SQLiteCursorPublicationOwnerComposition,
    record: _Record,
) -> tuple[
    _SQLiteCursorPublicationTransactionOwner,
    _SQLiteCursorPublicationBeginReceipt,
]:
    owner = object.__getattribute__(
        composition, "_SQLiteCursorPublicationOwnerComposition__owner"
    )
    receipt = object.__getattribute__(
        composition, "_SQLiteCursorPublicationOwnerComposition__receipt"
    )
    if (
        _TYPE(owner) is not _SQLiteCursorPublicationTransactionOwner
        or _TYPE(receipt) is not _SQLiteCursorPublicationBeginReceipt
        or record.owner_ref() is not owner
        or record.receipt_ref() is not receipt
    ):
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    return owner, receipt


def _adopt_sqlite_cursor_publication_owner_composition_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    receipt: _SQLiteCursorPublicationBeginReceipt,
) -> _SQLiteCursorPublicationOwnerComposition:
    """One-shot adopt the exact active P9 owner and its exact BEGIN receipt."""

    if _TYPE(owner) is not _SQLiteCursorPublicationTransactionOwner:
        _fail("GE_SQLITE_P11_COMPOSITION_ADOPTION")
    composition = _SQLiteCursorPublicationOwnerComposition(
        owner, receipt, _CONSTRUCTION_TOKEN
    )
    composition_id = _ID(composition)

    def discard_exact(
        dead_ref: ReferenceType[_SQLiteCursorPublicationOwnerComposition],
    ) -> None:
        entry = _DICT_GET(_COMPOSITIONS, composition_id)
        if entry is not None and entry.composition_ref is dead_ref:
            _DICT_POP(_COMPOSITIONS, composition_id, None)

    composition_ref = ref(composition, discard_exact)
    reserved = False
    try:
        _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
            "after-construction", composition
        )
        if _TYPE(receipt) is not _SQLiteCursorPublicationBeginReceipt:
            _fail("GE_SQLITE_P11_COMPOSITION_ADOPTION")
        preflight = _read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
            owner, receipt
        )
        record = _Record(
            ref(owner),
            ref(receipt),
            None,
            None,
            None,
            preflight.transaction_epoch,
            preflight.total_changes,
            preflight.temp_mutation_epoch,
        )
        _DICT_SET(_COMPOSITIONS, composition_id, _Entry(composition_ref, record))
        _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
            "after-registration", composition
        )
        adoption = (
            _prepare_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
                owner, receipt, composition
            )
        )
        reserved = True
        record.connection_ref = ref(adoption.connection)
        record.lineage_ref = ref(adoption.lineage)
        record.generation_ref = ref(adoption.generation)
        _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
            "after-owner-pending", composition
        )
        _complete_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
            owner, receipt, composition
        )
        _inject_sqlite_cursor_publication_owner_composition_adoption_fault_intrinsic(
            "after-owner-adopt", composition
        )
        record.lifecycle = "begin-adopted"
    except BaseException as primary:
        _DICT_POP(_COMPOSITIONS, composition_id, None)
        if reserved:
            _abort_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
                owner, composition
            )
        try:
            capture = _capture_sqlite_cursor_publication_transaction_failure_intrinsic(
                owner, primary
            )
            _finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
                owner, capture
            )
        except BaseException as finalized:
            if finalized is primary or finalized.__cause__ is primary:
                raise
        raise primary.with_traceback(None) from None
    return composition


def _read_sqlite_cursor_publication_owner_composition_snapshot_intrinsic(
    composition: _SQLiteCursorPublicationOwnerComposition,
) -> _SQLiteCursorPublicationOwnerCompositionSnapshot:
    """Return immutable P11-A scalar evidence after exact graph reproof."""

    record = _record_for(composition)
    owner, receipt = _composition_owner_receipt(composition, record)
    adoption = _assert_sqlite_cursor_publication_owner_composition_intrinsic(
        owner, receipt, composition
    )
    if (
        record.lifecycle != "begin-adopted"
        or adoption.owner is not owner
        or adoption.begin_receipt is not receipt
        or record.connection_ref is None
        or record.connection_ref() is not adoption.connection
        or record.lineage_ref is None
        or record.lineage_ref() is not adoption.lineage
        or record.generation_ref is None
        or record.generation_ref() is not adoption.generation
        or adoption.begin_transaction_epoch != record.begin_transaction_epoch
        or adoption.begin_total_changes != record.begin_total_changes
        or adoption.begin_temp_mutation_epoch != record.begin_temp_mutation_epoch
    ):
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    return _SQLiteCursorPublicationOwnerCompositionSnapshot(
        record.lifecycle,
        True,
        True,
        True,
        True,
        True,
        record.begin_transaction_epoch,
        record.begin_total_changes,
        record.begin_temp_mutation_epoch,
        adoption.current_transaction_epoch,
        adoption.current_total_changes,
        adoption.current_temp_mutation_epoch,
        None,
        0,
        (),
        None,
        False,
        False,
        0,
    )
