"""Authenticated Python `before-verification` clock observation.

The only entry is an exact accepted Rule 12 receipt.  Success retains a fresh,
unconsumed third evidence (provider observations/consumes = 3/2); this module
does not mint cursor-clock authority, consume the evidence, or enable COMMIT.
"""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, NamedTuple, Never, cast
from weakref import ReferenceType, ref

from .sqlite_cursor_publication_clock_authority import (
    _assert_consumed_second_boundary_graph_after_rebind_intrinsic,
    _assert_current_third_observation_lineage_intrinsic,
    _assert_unconsumed_third_boundary_graph_intrinsic,
    _bind_selected_rule12_third_evidence_intrinsic,
    _ClockEvidence,
    _discard_failed_rule12_third_evidence_intrinsic,
    _observe_authorized_before_verification_clock_intrinsic,
)
from .sqlite_cursor_publication_outer_authority import (
    _is_sqlite_cursor_publication_session_cancellation_requested_intrinsic,
    _SQLiteCursorPublicationSessionCancellationSignal,
)
from .sqlite_cursor_publication_rule12 import (
    _adopt_sqlite_cursor_publication_rule12_pre_verification_clock_evidence_intrinsic,
    _poison_sqlite_cursor_publication_rule12_after_success_intrinsic,
    _prepare_sqlite_cursor_rule12_third_observation_authorization_intrinsic,
    _read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic,
    _SQLiteCursorPublicationRule12SuccessReceipt,
)

_ID = id
_TYPE = type
_DICT_GET = dict.get
_DICT_SET = dict.__setitem__
_DICT_POP = dict.pop


def _fail(code: str) -> Never:
    raise ValueError(code)


class _SQLiteCursorBeforeVerificationClockEvidenceSnapshot(NamedTuple):
    boundary: Literal["before-verification"]
    consumer: Literal["cursor-clock-capability"]
    provider_now_ms: int
    active_expires_at_ms: int
    transaction_generation: object
    transaction_epoch: int
    total_changes: int
    head_index: Literal[3]
    previous_evidence: object
    rule12_receipt: _SQLiteCursorPublicationRule12SuccessReceipt
    rule11_receipt: object
    publication_session: object
    consumed: Literal[False]


@dataclass(frozen=True, slots=True)
class _Binding:
    receipt_ref: ReferenceType[_SQLiteCursorPublicationRule12SuccessReceipt]


@dataclass(frozen=True, slots=True)
class _IdentityEntry:
    key_ref: ReferenceType[_ClockEvidence]
    binding: _Binding


_EVIDENCE_BINDINGS: dict[int, _IdentityEntry] = {}


def _purge_dead_evidence_bindings_intrinsic() -> None:
    """Eagerly remove dead weak identities before registry observations."""

    for evidence_id, entry in tuple(_EVIDENCE_BINDINGS.items()):
        if entry.key_ref() is None or entry.binding.receipt_ref() is None:
            current = _DICT_GET(_EVIDENCE_BINDINGS, evidence_id)
            if current is entry:
                _DICT_POP(_EVIDENCE_BINDINGS, evidence_id, None)


def _register_binding(
    evidence: _ClockEvidence,
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
) -> None:
    _purge_dead_evidence_bindings_intrinsic()
    evidence_id = _ID(evidence)

    def discard(reference: ReferenceType[_ClockEvidence]) -> None:
        current = _DICT_GET(_EVIDENCE_BINDINGS, evidence_id)
        if current is not None and current.key_ref is reference:
            _DICT_POP(_EVIDENCE_BINDINGS, evidence_id, None)

    evidence_ref = ref(evidence, discard)
    _DICT_SET(
        _EVIDENCE_BINDINGS,
        evidence_id,
        _IdentityEntry(evidence_ref, _Binding(ref(receipt))),
    )


def _binding_for(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
    evidence: _ClockEvidence,
) -> None:
    _purge_dead_evidence_bindings_intrinsic()
    if (
        _TYPE(receipt) is not _SQLiteCursorPublicationRule12SuccessReceipt
        or _TYPE(evidence) is not _ClockEvidence
    ):
        _fail("GE_CURSOR_B3_BEFORE_VERIFICATION_EVIDENCE")
    current = _DICT_GET(_EVIDENCE_BINDINGS, _ID(evidence))
    if (
        current is None
        or current.key_ref() is not evidence
        or current.binding.receipt_ref() is not receipt
    ):
        _fail("GE_CURSOR_B3_BEFORE_VERIFICATION_EVIDENCE")


def _discard_binding_if_owned(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
    evidence: _ClockEvidence,
) -> None:
    _purge_dead_evidence_bindings_intrinsic()
    current = _DICT_GET(_EVIDENCE_BINDINGS, _ID(evidence))
    if (
        current is not None
        and current.key_ref() is evidence
        and current.binding.receipt_ref() is receipt
    ):
        _DICT_POP(_EVIDENCE_BINDINGS, _ID(evidence), None)


def _observe_sqlite_cursor_before_verification_clock_intrinsic(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
    cancellation: _SQLiteCursorPublicationSessionCancellationSignal | None = None,
) -> _ClockEvidence:
    """Observe the third boundary once from the exact active R12 graph."""

    snapshot = _read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
        receipt
    )
    evidence: _ClockEvidence | None = None
    try:
        if snapshot.lifecycle != "active":
            _fail("GE_CURSOR_B3_BEFORE_VERIFICATION_REPLAY")
        _assert_consumed_second_boundary_graph_after_rebind_intrinsic(
            cast(Any, snapshot.connection),
            cast(Any, snapshot.migration_lock_capability),
            cast(Any, snapshot.provider_clock_capability),
            cast(Any, snapshot.outer_clock_evidence),
            cast(Any, snapshot.outer_clock_consumed_tombstone),
            cast(Any, snapshot.pre_rebind_clock_evidence),
            cast(Any, snapshot.pre_rebind_clock_consumed_tombstone),
            snapshot.historical_transaction_epoch,
            snapshot.historical_total_changes,
        )
        _assert_current_third_observation_lineage_intrinsic(
            cast(Any, snapshot.connection),
            cast(Any, snapshot.migration_lock_capability),
            cast(Any, snapshot.provider_clock_capability),
            snapshot.transaction_generation,
            snapshot.transaction_epoch,
            snapshot.total_changes,
        )
        if _is_sqlite_cursor_publication_session_cancellation_requested_intrinsic(
            cancellation
        ):
            _fail("GE_CURSOR_B3_BEFORE_VERIFICATION_CANCELLED")
        authorization = (
            _prepare_sqlite_cursor_rule12_third_observation_authorization_intrinsic(
                receipt
            )
        )
        evidence = _observe_authorized_before_verification_clock_intrinsic(
            cast(Any, snapshot.provider_clock_capability),
            cast(Any, snapshot.pre_rebind_clock_evidence),
            receipt,
            authorization,
        )
        _assert_unconsumed_third_boundary_graph_intrinsic(
            cast(Any, snapshot.connection),
            cast(Any, snapshot.migration_lock_capability),
            cast(Any, snapshot.provider_clock_capability),
            cast(Any, snapshot.pre_rebind_clock_evidence),
            evidence,
            snapshot.transaction_generation,
            snapshot.transaction_epoch,
            snapshot.total_changes,
        )
        _register_binding(evidence, receipt)
        _adopt_sqlite_cursor_publication_rule12_pre_verification_clock_evidence_intrinsic(
            receipt, evidence
        )
        _bind_selected_rule12_third_evidence_intrinsic(
            cast(Any, snapshot.provider_clock_capability), receipt, evidence
        )
        return evidence
    except BaseException as primary:
        if evidence is not None:
            _discard_binding_if_owned(receipt, evidence)
            with suppress(BaseException):
                _discard_failed_rule12_third_evidence_intrinsic(
                    cast(Any, snapshot.provider_clock_capability),
                    cast(Any, snapshot.pre_rebind_clock_evidence),
                    evidence,
                )
        with suppress(BaseException):
            _poison_sqlite_cursor_publication_rule12_after_success_intrinsic(
                receipt, "SQLite before-verification clock observation failed"
            )
        raise primary


def _read_sqlite_cursor_before_verification_clock_evidence_snapshot_intrinsic(
    receipt: _SQLiteCursorPublicationRule12SuccessReceipt,
    evidence: _ClockEvidence,
) -> _SQLiteCursorBeforeVerificationClockEvidenceSnapshot:
    """Read retained 3/2 evidence without SQL, provider calls, or consumption."""

    _binding_for(receipt, evidence)
    snapshot = _read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
        receipt
    )
    if (
        snapshot.lifecycle != "pre-verification-clock-read-unconsumed"
        or snapshot.pre_verification_clock_evidence is not evidence
    ):
        _fail("GE_CURSOR_B3_BEFORE_VERIFICATION_EVIDENCE")
    third = _assert_unconsumed_third_boundary_graph_intrinsic(
        cast(Any, snapshot.connection),
        cast(Any, snapshot.migration_lock_capability),
        cast(Any, snapshot.provider_clock_capability),
        cast(Any, snapshot.pre_rebind_clock_evidence),
        evidence,
        snapshot.transaction_generation,
        snapshot.transaction_epoch,
        snapshot.total_changes,
    )
    return _SQLiteCursorBeforeVerificationClockEvidenceSnapshot(
        "before-verification",
        "cursor-clock-capability",
        third.evidence.provider_now_ms,
        third.evidence.active_expires_at_ms,
        snapshot.transaction_generation,
        snapshot.transaction_epoch,
        snapshot.total_changes,
        3,
        snapshot.pre_rebind_clock_evidence,
        receipt,
        snapshot.rule11_receipt,
        snapshot.publication_session,
        False,
    )
