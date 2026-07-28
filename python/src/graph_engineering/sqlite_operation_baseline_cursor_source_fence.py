"""Private captured-source connection fence for the SQLite cursor campaign."""

from __future__ import annotations

from dataclasses import dataclass
from weakref import WeakKeyDictionary

from .sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorPreRebindReceipt,
    SQLiteCursorPreRebindReceiptProvenance,
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
)
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineClockEvidence,
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    _assert_sqlite_v1_baseline_source_summary_provenance,
)

_CONSTRUCTION_TOKEN = object()


def _assert_live_source_connection_binding(
    connection: SQLiteV1BaselineConnectionOwner,
    provenance: SQLiteCursorPreRebindReceiptProvenance,
) -> tuple[SQLiteV1BaselineSourceSummary, SQLiteV1BaselineClockEvidence, int]:
    """Synchronously prove the exact captured connection and clock ownership."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        raise TypeError("cursor captured-source connection has the wrong type")
    summary = provenance.source_summary
    clock = provenance.clock_evidence
    _assert_sqlite_v1_baseline_source_summary_provenance(summary)
    if type(clock) is not SQLiteV1BaselineClockEvidence or clock is not summary.clock_evidence:
        raise ValueError("cursor captured-source clock ownership is invalid")
    if summary._connection is not connection:
        raise ValueError("cursor captured-source connection ownership is invalid")
    try:
        epoch = connection.transaction_epoch
        in_exclusive_transaction = connection.in_exclusive_transaction
        confirmed_epoch = connection.transaction_epoch
    except Exception:
        raise ValueError("cursor captured-source connection is closed or unavailable") from None
    if (
        not in_exclusive_transaction
        or summary._captured_transaction_epoch != epoch
        or confirmed_epoch != epoch
    ):
        raise ValueError("cursor captured-source transaction epoch is invalid")
    return summary, clock, epoch


@dataclass(frozen=True, slots=True, weakref_slot=True, eq=False)
class _SQLiteCursorCapturedSourceConnectionWitness:
    """Opaque exact-context witness; callers may only request revalidation."""

    _connection: SQLiteV1BaselineConnectionOwner
    _receipt: SQLiteCursorPreRebindReceipt
    _provenance: SQLiteCursorPreRebindReceiptProvenance
    _source_summary: SQLiteV1BaselineSourceSummary
    _clock_evidence: SQLiteV1BaselineClockEvidence
    _transaction_epoch: int
    _construction_token: object

    def __post_init__(self) -> None:
        if self._construction_token is not _CONSTRUCTION_TOKEN:
            raise TypeError("cursor captured-source witnesses are module-minted")

    def _assert_current(self) -> None:
        """Repeat the whole receipt/source/connection fence without consuming it."""

        provenance = assert_sqlite_cursor_pre_rebind_receipt_provenance(self._receipt)
        _assert_registered_witness(self)
        if provenance is not self._provenance:
            raise ValueError("cursor captured-source receipt provenance drifted")
        summary, clock, epoch = _assert_live_source_connection_binding(
            self._connection,
            provenance,
        )
        if (
            summary is not self._source_summary
            or clock is not self._clock_evidence
            or epoch != self._transaction_epoch
        ):
            raise ValueError("cursor captured-source connection witness drifted")


@dataclass(frozen=True, slots=True)
class _WitnessMetadata:
    connection: SQLiteV1BaselineConnectionOwner
    receipt: SQLiteCursorPreRebindReceipt
    provenance: SQLiteCursorPreRebindReceiptProvenance
    source_summary: SQLiteV1BaselineSourceSummary
    clock_evidence: SQLiteV1BaselineClockEvidence
    transaction_epoch: int


_WITNESSES: WeakKeyDictionary[_SQLiteCursorCapturedSourceConnectionWitness, _WitnessMetadata] = (
    WeakKeyDictionary()
)


def _register_witness(witness: _SQLiteCursorCapturedSourceConnectionWitness) -> None:
    """Register exactly one module-minted witness without retaining the key."""

    _WITNESSES[witness] = _WitnessMetadata(
        witness._connection,
        witness._receipt,
        witness._provenance,
        witness._source_summary,
        witness._clock_evidence,
        witness._transaction_epoch,
    )


def _assert_registered_witness(
    witness: _SQLiteCursorCapturedSourceConnectionWitness,
) -> _WitnessMetadata:
    """Reject copied, replaced, subclassed, or state-substituted witnesses."""

    if type(witness) is not _SQLiteCursorCapturedSourceConnectionWitness:
        raise TypeError("cursor captured-source witness has the wrong type")
    metadata = _WITNESSES.get(witness)
    if metadata is None:
        raise ValueError("cursor captured-source witness provenance is invalid")
    if (
        metadata.connection is not witness._connection
        or metadata.receipt is not witness._receipt
        or metadata.provenance is not witness._provenance
        or metadata.source_summary is not witness._source_summary
        or metadata.clock_evidence is not witness._clock_evidence
        or metadata.transaction_epoch != witness._transaction_epoch
    ):
        raise ValueError("cursor captured-source witness registered state drifted")
    return metadata


def _assert_sqlite_cursor_captured_source_connection_provenance(
    connection: SQLiteV1BaselineConnectionOwner,
    receipt: SQLiteCursorPreRebindReceipt,
) -> _SQLiteCursorCapturedSourceConnectionWitness:
    """Fence A2b first, then prove its source came from this exact live owner.

    This pre-TEMP tranche intentionally does not compare the source capture's
    historical ``total_changes`` value with the later baseline stage value.
    That adjacent allowed-change invariant belongs exclusively to the stage
    owner fence implemented by the next Slice B tranche.
    """

    provenance = assert_sqlite_cursor_pre_rebind_receipt_provenance(receipt)
    summary, clock, epoch = _assert_live_source_connection_binding(
        connection,
        provenance,
    )
    witness = _SQLiteCursorCapturedSourceConnectionWitness(
        connection,
        receipt,
        provenance,
        summary,
        clock,
        epoch,
        _CONSTRUCTION_TOKEN,
    )
    _register_witness(witness)
    try:
        # Re-run every mutable connection check immediately before publication.
        witness._assert_current()
    except BaseException:
        _WITNESSES.pop(witness, None)
        raise
    return witness
