"""Private outer-authorized cursor-rebind write receipt and Rule 11 gate."""

from __future__ import annotations

from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, NamedTuple, Never, cast
from weakref import ReferenceType, ref

from .models import MAX_SAFE_INTEGER
from .sqlite_cursor_publication_initial_write_digest import (
    _digest_sqlite_initial_write_parameters_intrinsic,
)
from .sqlite_cursor_publication_outer_authority import (
    _adopt_sqlite_cursor_post_rebind_watermark_intrinsic,
    _assert_sqlite_cursor_post_rebind_watermark_adoption_intrinsic,
    _assert_sqlite_cursor_publication_rebind_prepared_owner_identity_intrinsic,
    _assert_sqlite_cursor_publication_session_consumed_tombstone_intrinsic,
    _consume_sqlite_cursor_publication_session_for_rebind_intrinsic,
    _is_sqlite_cursor_publication_session_cancellation_requested_intrinsic,
    _poison_sqlite_cursor_publication_rebind_downstream_intrinsic,
    _prepare_sqlite_cursor_publication_rebind_context_intrinsic,
    _read_sqlite_cursor_poisoned_post_rebind_graph_snapshot_intrinsic,
    _read_sqlite_cursor_post_rebind_watermark_adoption_snapshot_intrinsic,
    _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic,
    _read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic,
    _read_sqlite_cursor_publication_session_snapshot_intrinsic,
    _release_sqlite_cursor_publication_rebind_context_before_consume_intrinsic,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorOuterPublicationLedgerSnapshot,
    _SQLiteCursorPostRebindWatermarkAdoption,
    _SQLiteCursorPublicationRebindContext,
    _SQLiteCursorPublicationRebindPreparedOwner,
    _SQLiteCursorPublicationSession,
    _SQLiteCursorPublicationSessionCancellationSignal,
    _SQLiteCursorPublicationSessionConsumedTombstone,
)
from .sqlite_operation_baseline_source import (
    SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
    SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
    SQLiteV1BaselineConnectionOwner,
    _arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic,
    _execute_sqlite_connection_cursor_publication_rebind_intrinsic,
    _prepare_sqlite_connection_cursor_publication_rebind_intrinsic,
    _prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic,
    _read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic,
    _record_sqlite_connection_cursor_publication_rebind_completed_primary_intrinsic,
    _release_sqlite_connection_cursor_publication_rebind_intrinsic,
    _SQLiteConnectionCursorPublicationRebindExecution,
    _SQLiteConnectionCursorPublicationRebindSnapshot,
)

RULE11_ID: Literal["BLR_CURSOR_REBIND_COUNT"] = "BLR_CURSOR_REBIND_COUNT"
RULE11_POSITION: Literal[11] = 11
_CONSTRUCTION_TOKEN = object()
_TYPE = type
_LEN = len
_INT = int
_VALUE_ERROR = ValueError
_ID = id
_REF = ref
_TUPLE: Any = tuple
_ALL: Any = all
_DICT_GET = dict.get
_DICT_SET = dict.__setitem__
_DICT_POP = dict.pop
_DIGEST_PARAMETERS = _digest_sqlite_initial_write_parameters_intrinsic


def _fail(code: str) -> Never:
    raise _VALUE_ERROR(code)


class _SQLiteCursorPublicationRebindWriteReceipt:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_REBIND_WRITE_RECEIPT")


class _SQLiteCursorPublicationRule11SuccessReceipt:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_RULE11_RECEIPT")


class _Rule11CountProjection(NamedTuple):
    b2_cursor_count: int
    native_affected_count: int
    changes_affected_count: int
    total_changes_delta: int
    cursor_ledger_affected_delta: int


class _Rule11CheckResult(NamedTuple):
    accepted: bool
    violation_count: Literal[0, 1]
    diagnostic: str | None


_EvidenceMismatchDimension = Literal[
    "native-affected",
    "changes-affected",
    "total-delta",
    "outer-ledger",
    "cursor-ledger",
]
_EVIDENCE_DIMENSION_ORDER: tuple[_EvidenceMismatchDimension, ...] = (
    "native-affected",
    "changes-affected",
    "total-delta",
    "outer-ledger",
    "cursor-ledger",
)


class _EvidenceMismatchOutcomeSnapshot(NamedTuple):
    dimensions: tuple[_EvidenceMismatchDimension, ...]
    evaluated_dimensions: tuple[_EvidenceMismatchDimension, ...]
    observed_counts: _Rule11CountProjection
    projected_counts: _Rule11CountProjection
    check: _Rule11CheckResult
    real_evidence_observed: Literal[True]
    outer_mismatch: bool
    first_poison_reason: str
    tombstone_lifecycle: Literal["poisoned"]
    adoption_lifecycle: Literal["poisoned"]
    write_lifecycle: Literal["absent", "poisoned"]
    rule11_lifecycle: Literal["absent"]


class _SQLiteCursorPublicationRebindWriteReceiptSnapshot(NamedTuple):
    lifecycle: Literal["write-receipt-minted", "rule11-complete", "poisoned"]
    session: _SQLiteCursorPublicationSession
    outer_authority: _SQLiteCursorOuterPublicationAuthority
    context: _SQLiteCursorPublicationRebindContext
    prepared_owner: _SQLiteCursorPublicationRebindPreparedOwner
    consumed_tombstone: _SQLiteCursorPublicationSessionConsumedTombstone
    post_rebind_adoption: _SQLiteCursorPostRebindWatermarkAdoption
    rebind_execution: _SQLiteConnectionCursorPublicationRebindExecution
    connection: SQLiteV1BaselineConnectionOwner
    transaction_generation: object
    transaction_epoch_before: int
    transaction_epoch_after: int
    total_changes_before: int
    total_changes_after: int
    rebind_sql: str
    rebind_sql_sha256: str
    parameter_order: tuple[str, str, str, str]
    parameters: tuple[str, str, str, str]
    parameter_sha256: str
    changes_sql: str
    changes_sql_sha256: str
    prepare_count: Literal[1]
    execute_count: Literal[1]
    release_count: Literal[1]
    changes_prepare_count: Literal[1]
    changes_fetch_count: Literal[1]
    changes_release_count: Literal[1]
    counts: _Rule11CountProjection
    cursor_ledger_logical_write_delta: Literal[1]
    cursor_ledger_fixed_statement_delta: Literal[1]
    outer_ledger_before: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_after: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_unchanged: Literal[True]
    rule11_consume_count: Literal[0, 1]


class _SQLiteCursorPublicationRule11SuccessReceiptSnapshot(NamedTuple):
    rule_id: Literal["BLR_CURSOR_REBIND_COUNT"]
    position: Literal[11]
    write_receipt: _SQLiteCursorPublicationRebindWriteReceipt
    counts: _Rule11CountProjection
    cursor_ledger_logical_write_delta: Literal[1]
    cursor_ledger_fixed_statement_delta: Literal[1]
    violation_count: Literal[0]
    diagnostics_truncated: Literal[False]
    transaction_generation: object
    transaction_epoch: int
    total_changes: int


@dataclass(slots=True)
class _WriteRecord:
    snapshot: _SQLiteCursorPublicationRebindWriteReceiptSnapshot
    consumed: bool = False


@dataclass(slots=True)
class _Rule11Record:
    snapshot: _SQLiteCursorPublicationRule11SuccessReceiptSnapshot
    lifecycle: Literal["active", "rule12-pending", "rule12-complete", "poisoned"] = (
        "active"
    )
    rule12_receipt: ReferenceType[object] | None = None


@dataclass(slots=True)
class _ContextLatch:
    lifecycle: Literal["write-receipt-minted", "rule11-complete", "poisoned"]
    write_receipt_ref: ReferenceType[_SQLiteCursorPublicationRebindWriteReceipt]


@dataclass(frozen=True, slots=True)
class _PendingPreconsumeReleaseFault:
    authority_ref: ReferenceType[_SQLiteCursorOuterPublicationAuthority]
    connection_id: int
    error_ref: ReferenceType[BaseException]


@dataclass(frozen=True, slots=True)
class _PendingEvidenceMismatch:
    authority_ref: ReferenceType[_SQLiteCursorOuterPublicationAuthority]
    connection_id: int
    dimensions: tuple[_EvidenceMismatchDimension, ...]


@dataclass(slots=True)
class _EvidenceMismatchOutcome:
    dimensions: tuple[_EvidenceMismatchDimension, ...]
    evaluated_dimensions: tuple[_EvidenceMismatchDimension, ...] | None = None
    observed_counts: _Rule11CountProjection | None = None
    projected_counts: _Rule11CountProjection | None = None
    check: _Rule11CheckResult | None = None
    real_evidence_observed: bool = False
    outer_mismatch: bool | None = None
    first_poison_reason: str | None = None
    tombstone_ref: ReferenceType[_SQLiteCursorPublicationSessionConsumedTombstone] | None = None
    adoption_ref: ReferenceType[_SQLiteCursorPostRebindWatermarkAdoption] | None = None
    write_ref: ReferenceType[_SQLiteCursorPublicationRebindWriteReceipt] | None = None
    tombstone_lifecycle: Literal["absent", "active", "poisoned"] = "absent"
    adoption_lifecycle: Literal["absent", "active", "poisoned"] = "absent"
    write_lifecycle: Literal["absent", "active", "poisoned"] = "absent"
    rule11_lifecycle: Literal["absent"] = "absent"


class _Entry(NamedTuple):
    key_ref: ReferenceType[object]
    value: object


_WRITE_RECEIPTS: dict[int, _Entry] = {}
_RULE11_RECEIPTS: dict[int, _Entry] = {}
_WRITE_BY_CONTEXT: dict[int, _Entry] = {}
_PRECONSUME_RELEASE_FAULTS: dict[int, _Entry] = {}
_EVIDENCE_MISMATCHES_BY_SESSION: dict[int, _Entry] = {}
_EVIDENCE_MISMATCH_OUTCOMES: dict[int, _Entry] = {}


def _register(registry: dict[int, _Entry], owner: object, value: object) -> None:
    owner_id = _ID(owner)

    def discard(dead: ReferenceType[object]) -> None:
        current = _DICT_GET(registry, owner_id)
        if current is not None and current.key_ref is dead:
            _DICT_POP(registry, owner_id, None)

    _DICT_SET(registry, owner_id, _Entry(_REF(owner, discard), value))


_REGISTER_WRITE = _register
_REGISTER_RULE11 = _register
_REGISTER_CONTEXT_LATCH = _register
_REGISTER_PRECONSUME_RELEASE_FAULT = _register
_REGISTER_EVIDENCE_MISMATCH = _register
_REGISTER_EVIDENCE_OUTCOME = _register


def _discard_exact(registry: dict[int, _Entry], owner: object) -> None:
    owner_id = _ID(owner)
    current = _DICT_GET(registry, owner_id)
    if current is not None and current.key_ref() is owner:
        _DICT_POP(registry, owner_id, None)


def _record(
    registry: dict[int, _Entry],
    owner: object,
    owner_type: type[object],
    record_type: type[object],
    code: str,
) -> object:
    if _TYPE(owner) is not owner_type:
        _fail(code)
    current = _DICT_GET(registry, _ID(owner))
    if (
        current is None
        or current.key_ref() is not owner
        or _TYPE(current.value) is not record_type
    ):
        _fail(code)
    return current.value


def _arm_sqlite_cursor_publication_preconsume_release_fault_for_test_intrinsic(
    session: _SQLiteCursorPublicationSession,
    error: BaseException,
    _make_ref: Any = ref,
) -> None:
    """Arm one authentic S for an exact-E preconsume release failure."""

    if not isinstance(error, BaseException):
        _fail("GE_CURSOR_B3_REBIND_RELEASE_FAULT")
    try:
        error_ref = cast(ReferenceType[BaseException], _make_ref(error))
    except TypeError:
        _fail("GE_CURSOR_B3_REBIND_RELEASE_FAULT")
    snapshot = _read_sqlite_cursor_publication_session_snapshot_intrinsic(session)
    current = _DICT_GET(_PRECONSUME_RELEASE_FAULTS, _ID(session))
    evidence = _DICT_GET(_EVIDENCE_MISMATCHES_BY_SESSION, _ID(session))
    if (
        (current is not None and current.key_ref() is session)
        or (evidence is not None and evidence.key_ref() is session)
    ):
        _fail("GE_CURSOR_B3_REBIND_RELEASE_FAULT")
    try:
        _REGISTER_PRECONSUME_RELEASE_FAULT(
            _PRECONSUME_RELEASE_FAULTS,
            session,
            _PendingPreconsumeReleaseFault(
                _REF(snapshot.authority), _ID(snapshot.connection), error_ref
            ),
        )
    except BaseException:
        _discard_exact(_PRECONSUME_RELEASE_FAULTS, session)
        raise


def _handoff_sqlite_cursor_publication_preconsume_release_fault_for_test_intrinsic(
    session: _SQLiteCursorPublicationSession,
    context: _SQLiteCursorPublicationRebindContext,
    prepared_owner: _SQLiteCursorPublicationRebindPreparedOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
) -> bool:
    current = _DICT_GET(_PRECONSUME_RELEASE_FAULTS, _ID(session))
    if current is None or current.key_ref() is not session:
        return False
    pending = (
        current.value
        if _TYPE(current.value) is _PendingPreconsumeReleaseFault
        else None
    )
    try:
        error = pending.error_ref() if pending is not None else None
        snapshot = _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
            context
        )
        if (
            pending is None
            or error is None
            or pending.authority_ref() is not snapshot.authority
            or pending.connection_id != _ID(snapshot.connection)
            or snapshot.lifecycle != "prepared"
            or snapshot.session is not session
        ):
            _fail("GE_CURSOR_B3_REBIND_RELEASE_FAULT")
        if (
            snapshot.prepared_owner is not prepared_owner
            or snapshot.execution is not execution
        ):
            _fail("GE_CURSOR_B3_REBIND_RELEASE_FAULT")
    except BaseException:
        _discard_exact(_PRECONSUME_RELEASE_FAULTS, session)
        raise
    _discard_exact(_PRECONSUME_RELEASE_FAULTS, session)
    _arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
        snapshot.connection, execution, error
    )
    return True


def _exact_evidence_mismatch_dimensions(
    dimensions: object,
) -> tuple[_EvidenceMismatchDimension, ...]:
    if _TYPE(dimensions) is not tuple or not 2 <= _LEN(dimensions) <= 5:
        _fail("GE_CURSOR_B3_REBIND_EVIDENCE_DIMENSIONS")
    prior = -1
    selected: list[_EvidenceMismatchDimension] = []
    for dimension in dimensions:
        if _TYPE(dimension) is not str:
            _fail("GE_CURSOR_B3_REBIND_EVIDENCE_DIMENSIONS")
        try:
            rank = _EVIDENCE_DIMENSION_ORDER.index(cast(_EvidenceMismatchDimension, dimension))
        except _VALUE_ERROR:
            _fail("GE_CURSOR_B3_REBIND_EVIDENCE_DIMENSIONS")
        if rank <= prior:
            _fail("GE_CURSOR_B3_REBIND_EVIDENCE_DIMENSIONS")
        selected.append(cast(_EvidenceMismatchDimension, dimension))
        prior = rank
    return cast(tuple[_EvidenceMismatchDimension, ...], _TUPLE(selected))


def _arm_sqlite_cursor_publication_rebind_evidence_mismatch_for_test_intrinsic(
    session: _SQLiteCursorPublicationSession,
    dimensions: object,
) -> None:
    """Arm one exact S for a post-observation five-dimension projection."""

    selected = _exact_evidence_mismatch_dimensions(dimensions)
    snapshot = _read_sqlite_cursor_publication_session_snapshot_intrinsic(session)
    current = _DICT_GET(_EVIDENCE_MISMATCHES_BY_SESSION, _ID(session))
    competing = _DICT_GET(_PRECONSUME_RELEASE_FAULTS, _ID(session))
    if (
        (current is not None and current.key_ref() is session)
        or (competing is not None and competing.key_ref() is session)
    ):
        _fail("GE_CURSOR_B3_REBIND_EVIDENCE_ARM")
    try:
        _REGISTER_EVIDENCE_MISMATCH(
            _EVIDENCE_MISMATCHES_BY_SESSION,
            session,
            _PendingEvidenceMismatch(
                _REF(snapshot.authority), _ID(snapshot.connection), selected
            ),
        )
    except BaseException:
        _discard_exact(_EVIDENCE_MISMATCHES_BY_SESSION, session)
        raise


def _handoff_sqlite_cursor_publication_rebind_evidence_mismatch_intrinsic(
    session: _SQLiteCursorPublicationSession,
    context: _SQLiteCursorPublicationRebindContext,
    prepared_owner: _SQLiteCursorPublicationRebindPreparedOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    _register_outcome: Any = _REGISTER_EVIDENCE_OUTCOME,
) -> None:
    """Delete exact-S pending state before binding its pure outcome to exact E."""

    current = _DICT_GET(_EVIDENCE_MISMATCHES_BY_SESSION, _ID(session))
    if current is None or current.key_ref() is not session:
        return
    pending = current.value if _TYPE(current.value) is _PendingEvidenceMismatch else None
    _discard_exact(_EVIDENCE_MISMATCHES_BY_SESSION, session)
    try:
        snapshot = _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(context)
        if (
            pending is None
            or pending.authority_ref() is not snapshot.authority
            or pending.connection_id != _ID(snapshot.connection)
            or snapshot.lifecycle != "prepared"
            or snapshot.session is not session
            or snapshot.prepared_owner is not prepared_owner
            or snapshot.execution is not execution
            or _DICT_GET(_EVIDENCE_MISMATCH_OUTCOMES, _ID(execution)) is not None
        ):
            _fail("GE_CURSOR_B3_REBIND_EVIDENCE_HANDOFF")
        _register_outcome(
            _EVIDENCE_MISMATCH_OUTCOMES,
            execution,
            _EvidenceMismatchOutcome(pending.dimensions),
        )
    except BaseException:
        _discard_exact(_EVIDENCE_MISMATCH_OUTCOMES, execution)
        raise


def _evidence_mismatch_outcome(
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
) -> _EvidenceMismatchOutcome | None:
    current = _DICT_GET(_EVIDENCE_MISMATCH_OUTCOMES, _ID(execution))
    if current is None:
        return None
    if current.key_ref() is not execution or _TYPE(current.value) is not _EvidenceMismatchOutcome:
        _fail("GE_CURSOR_B3_REBIND_EVIDENCE_OUTCOME")
    return current.value


def _evidence_projection_is_exact(outcome: _EvidenceMismatchOutcome) -> bool:
    observed = outcome.observed_counts
    projected = outcome.projected_counts
    check = outcome.check
    evaluated = outcome.evaluated_dimensions
    if (
        observed is None
        or projected is None
        or check is None
        or evaluated is None
        or outcome.outer_mismatch is None
        or evaluated != outcome.dimensions
    ):
        return False
    expected = _check_sqlite_cursor_publication_rule11_counts_intrinsic(projected)
    return (
        projected.b2_cursor_count == observed.b2_cursor_count
        and projected.native_affected_count
        == observed.native_affected_count
        + _INT(_mismatch_includes(evaluated, "native-affected"))
        and projected.changes_affected_count
        == observed.changes_affected_count
        + _INT(_mismatch_includes(evaluated, "changes-affected"))
        and projected.total_changes_delta
        == observed.total_changes_delta
        + _INT(_mismatch_includes(evaluated, "total-delta"))
        and projected.cursor_ledger_affected_delta
        == observed.cursor_ledger_affected_delta
        + _INT(_mismatch_includes(evaluated, "cursor-ledger"))
        and outcome.outer_mismatch
        is _mismatch_includes(evaluated, "outer-ledger")
        and check == expected
    )


def _mismatch_includes(
    dimensions: tuple[_EvidenceMismatchDimension, ...],
    dimension: _EvidenceMismatchDimension,
) -> bool:
    return dimension in dimensions


def _project_evidence_mismatch(
    outcome: _EvidenceMismatchOutcome,
    observed: _Rule11CountProjection,
) -> _Rule11CountProjection:
    dimensions = outcome.dimensions
    projected = _Rule11CountProjection(
        observed.b2_cursor_count,
        observed.native_affected_count
        + _INT(_mismatch_includes(dimensions, "native-affected")),
        observed.changes_affected_count
        + _INT(_mismatch_includes(dimensions, "changes-affected")),
        observed.total_changes_delta
        + _INT(_mismatch_includes(dimensions, "total-delta")),
        observed.cursor_ledger_affected_delta
        + _INT(_mismatch_includes(dimensions, "cursor-ledger")),
    )
    check = _check_sqlite_cursor_publication_rule11_counts_intrinsic(projected)
    outcome.evaluated_dimensions = dimensions
    outcome.observed_counts = observed
    outcome.projected_counts = projected
    outcome.check = check
    outcome.real_evidence_observed = True
    outcome.outer_mismatch = _mismatch_includes(dimensions, "outer-ledger")
    return projected


def _read_sqlite_cursor_publication_rebind_evidence_mismatch_outcome_for_test_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
) -> _EvidenceMismatchOutcomeSnapshot:
    """Expose only immutable scalar evidence from the pair/multi mismatch seam."""

    _read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
        connection, execution
    )
    outcome = _evidence_mismatch_outcome(execution)
    if outcome is None or not _evidence_projection_is_exact(outcome):
        _fail("GE_CURSOR_B3_REBIND_EVIDENCE_OUTCOME")
    observed = outcome.observed_counts
    projected = outcome.projected_counts
    check = outcome.check
    evaluated = outcome.evaluated_dimensions
    reason = outcome.first_poison_reason
    if (
        observed is None
        or projected is None
        or check is None
        or evaluated is None
        or outcome.outer_mismatch is None
        or reason is None
        or outcome.real_evidence_observed is not True
        or outcome.tombstone_lifecycle != "poisoned"
        or outcome.adoption_lifecycle != "poisoned"
        or outcome.write_lifecycle not in {"absent", "poisoned"}
    ):
        _fail("GE_CURSOR_B3_REBIND_EVIDENCE_OUTCOME")
    return _EvidenceMismatchOutcomeSnapshot(
        outcome.dimensions,
        evaluated,
        observed,
        projected,
        check,
        True,
        outcome.outer_mismatch,
        reason,
        "poisoned",
        "poisoned",
        outcome.write_lifecycle,
        "absent",
    )


def _assert_sqlite_cursor_publication_rebind_completed_failure_for_finalizer_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    context: _SQLiteCursorPublicationRebindContext,
    tombstone: _SQLiteCursorPublicationSessionConsumedTombstone,
    adoption: _SQLiteCursorPostRebindWatermarkAdoption,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    boundary: Literal["rule11-outer-ledger", "rule11-five-count"],
) -> _SQLiteCursorPublicationRebindWriteReceipt | None:
    """Repeatably authenticate completed E and retain exact W for finalization."""

    if _TYPE(boundary) is not str or boundary not in {
        "rule11-outer-ledger",
        "rule11-five-count",
    }:
        _fail("GE_CURSOR_B3_REBIND_COMPLETED_FAILURE")
    execution_snapshot = (
        _read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, execution
        )
    )
    context_snapshot = _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        context
    )
    tombstone_snapshot = (
        _read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic(
            tombstone
        )
    )
    try:
        poisoned_graph = (
            _read_sqlite_cursor_poisoned_post_rebind_graph_snapshot_intrinsic(
                context, tombstone, adoption
            )
        )
    except BaseException:
        _fail("GE_CURSOR_B3_REBIND_COMPLETED_FAILURE")
    outcome = _evidence_mismatch_outcome(execution)
    selected_tombstone = (
        outcome.tombstone_ref() if outcome is not None and outcome.tombstone_ref else None
    )
    selected_adoption = (
        outcome.adoption_ref() if outcome is not None and outcome.adoption_ref else None
    )
    selected_write = (
        outcome.write_ref() if outcome is not None and outcome.write_ref else None
    )
    affected = execution_snapshot.affected_rows
    changes_affected = execution_snapshot.changes_affected_rows
    authentic_observed = (
        _Rule11CountProjection(
            context_snapshot.b2_cursor_count,
            affected,
            changes_affected,
            execution_snapshot.total_changes_delta,
            execution_snapshot.cursor_ledger_delta.affected_rows_watermark,
        )
        if _TYPE(context_snapshot.b2_cursor_count) is int
        and _TYPE(affected) is int
        and _TYPE(changes_affected) is int
        else None
    )
    if (
        outcome is None
        or execution_snapshot.lifecycle != "completed"
        or authentic_observed is None
        or outcome.observed_counts != authentic_observed
        or execution_snapshot.rebind_sql
        != SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC
        or execution_snapshot.rebind_sql_sha256
        != SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC
        or execution_snapshot.parameter_order
        != SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC
        or execution_snapshot.parameters != context_snapshot.parameter_values
        or execution_snapshot.changes_sql
        != SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
        or execution_snapshot.changes_sql_sha256
        != SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC
        or execution_snapshot.prepare_count != 1
        or execution_snapshot.execute_count != 1
        or execution_snapshot.release_count != 1
        or execution_snapshot.changes_prepare_count != 1
        or execution_snapshot.changes_fetch_count != 1
        or execution_snapshot.changes_release_count != 1
        or execution_snapshot.transaction_generation
        is not context_snapshot.transaction_generation
        or execution_snapshot.transaction_epoch_before
        != context_snapshot.historical_transaction_epoch
        or execution_snapshot.transaction_epoch
        != context_snapshot.historical_transaction_epoch + 1
        or execution_snapshot.total_changes_before
        != context_snapshot.historical_total_changes
        or execution_snapshot.total_changes
        != context_snapshot.historical_total_changes
        + execution_snapshot.total_changes_delta
        or execution_snapshot.cursor_ledger_before != (0, 0, 0)
        or execution_snapshot.cursor_ledger_delta != (affected, 1, 1)
        or execution_snapshot.cursor_ledger_after != (affected, 1, 1)
        or context_snapshot.lifecycle != "poisoned"
        or context_snapshot.connection is not connection
        or context_snapshot.execution is not execution
        or tombstone_snapshot.lifecycle != "poisoned"
        or tombstone_snapshot.context is not context
        or tombstone_snapshot.execution is not execution
        or poisoned_graph.poison_reason != outcome.first_poison_reason
        or poisoned_graph.historical_transaction_epoch
        != context_snapshot.historical_transaction_epoch
        or poisoned_graph.adopted_transaction_epoch
        != execution_snapshot.transaction_epoch
        or poisoned_graph.historical_total_changes
        != context_snapshot.historical_total_changes
        or poisoned_graph.adopted_total_changes != execution_snapshot.total_changes
        or poisoned_graph.total_changes_delta != execution_snapshot.total_changes_delta
        or poisoned_graph.affected_rows != affected
        or not _exact_ledger(
            poisoned_graph.historical_outer_ledger,
            context_snapshot.historical_outer_ledger,
        )
        or not _exact_ledger(
            poisoned_graph.adopted_outer_ledger,
            context_snapshot.historical_outer_ledger,
        )
        or selected_tombstone is not tombstone
        or selected_adoption is not adoption
        or outcome.real_evidence_observed is not True
        or outcome.tombstone_lifecycle != "poisoned"
        or outcome.adoption_lifecycle != "poisoned"
        or outcome.rule11_lifecycle != "absent"
        or not _evidence_projection_is_exact(outcome)
        or outcome.check is None
        or outcome.check.accepted
        or outcome.check.violation_count != 1
    ):
        _fail("GE_CURSOR_B3_REBIND_COMPLETED_FAILURE")
    if boundary == "rule11-outer-ledger":
        if (
            outcome.first_poison_reason
            != "SQLite rebind evidence mismatch outer ledger"
            or outcome.outer_mismatch is not True
            or outcome.write_lifecycle != "absent"
            or selected_write is not None
        ):
            _fail("GE_CURSOR_B3_REBIND_COMPLETED_FAILURE")
        return None
    if (
        outcome.first_poison_reason != "SQLite Rule 11 five counts disagree"
        or outcome.outer_mismatch is not False
        or outcome.write_lifecycle != "poisoned"
        or selected_write is None
    ):
        _fail("GE_CURSOR_B3_REBIND_COMPLETED_FAILURE")
    write = cast(
        _WriteRecord,
        _record(
            _WRITE_RECEIPTS,
            selected_write,
            _SQLiteCursorPublicationRebindWriteReceipt,
            _WriteRecord,
            "GE_CURSOR_B3_REBIND_COMPLETED_FAILURE",
        ),
    )
    write_snapshot = write.snapshot
    latch = _DICT_GET(_WRITE_BY_CONTEXT, _ID(context))
    if (
        not write.consumed
        or write_snapshot.lifecycle != "poisoned"
        or write_snapshot.rule11_consume_count != 1
        or write_snapshot.connection is not connection
        or write_snapshot.context is not context
        or write_snapshot.consumed_tombstone is not tombstone
        or write_snapshot.post_rebind_adoption is not adoption
        or write_snapshot.rebind_execution is not execution
        or write_snapshot.counts != outcome.projected_counts
        or latch is None
        or latch.key_ref() is not context
        or _TYPE(latch.value) is not _ContextLatch
        or cast(_ContextLatch, latch.value).lifecycle != "poisoned"
        or cast(_ContextLatch, latch.value).write_receipt_ref() is not selected_write
    ):
        _fail("GE_CURSOR_B3_REBIND_COMPLETED_FAILURE")
    return selected_write


def _safe_count(value: object) -> int:
    if _TYPE(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
        _fail("GE_CURSOR_B3_RULE11_COUNT_SHAPE")
    return value


def _exact_ledger(
    left: _SQLiteCursorOuterPublicationLedgerSnapshot,
    right: _SQLiteCursorOuterPublicationLedgerSnapshot,
) -> bool:
    return _TYPE(left) is _TYPE(right) and _TUPLE(left) == _TUPLE(right)


def _parameter_sha256(parameters: tuple[str, str, str, str]) -> str:
    return _DIGEST_PARAMETERS(
        [[{"type": "text", "value": value} for value in parameters]]
    )


def _check_sqlite_cursor_publication_rule11_counts_intrinsic(
    projection: _Rule11CountProjection,
) -> _Rule11CheckResult:
    if _TYPE(projection) is not _Rule11CountProjection:
        _fail("GE_CURSOR_B3_RULE11_COUNT_SHAPE")
    values = _TUPLE(_safe_count(value) for value in projection)
    if _ALL(value == values[0] for value in values[1:]):
        return _Rule11CheckResult(True, 0, None)
    return _Rule11CheckResult(False, 1, "cursor rebind count mismatch")


def _prepare_sqlite_cursor_publication_rebind_subprotocol_intrinsic(
    context: _SQLiteCursorPublicationRebindContext,
    prepared_owner: _SQLiteCursorPublicationRebindPreparedOwner,
) -> _SQLiteCursorPublicationRebindPreparedOwner:
    """Authenticate the exact outer-minted P while it is still live."""

    _assert_sqlite_cursor_publication_rebind_prepared_owner_identity_intrinsic(
        prepared_owner
    )
    snapshot = _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
        context
    )
    if snapshot.lifecycle != "prepared" or snapshot.prepared_owner is not prepared_owner:
        _fail("GE_CURSOR_B3_REBIND_PREPARED")
    return prepared_owner


def _authenticate_outer_adoption(
    context: _SQLiteCursorPublicationRebindContext,
    prepared_owner: _SQLiteCursorPublicationRebindPreparedOwner,
    tombstone: _SQLiteCursorPublicationSessionConsumedTombstone,
    adoption: _SQLiteCursorPostRebindWatermarkAdoption,
) -> tuple[Any, Any, _SQLiteConnectionCursorPublicationRebindSnapshot]:
    _assert_sqlite_cursor_publication_rebind_prepared_owner_identity_intrinsic(
        prepared_owner
    )
    _assert_sqlite_cursor_publication_session_consumed_tombstone_intrinsic(tombstone)
    _assert_sqlite_cursor_post_rebind_watermark_adoption_intrinsic(adoption)
    context_snapshot = (
        _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(context)
    )
    tombstone_snapshot = (
        _read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic(
            tombstone
        )
    )
    adoption_snapshot = (
        _read_sqlite_cursor_post_rebind_watermark_adoption_snapshot_intrinsic(adoption)
    )
    execution = adoption_snapshot.execution_snapshot
    if (
        context_snapshot.lifecycle != "write-adopted"
        or context_snapshot.prepared_owner is not prepared_owner
        or tombstone_snapshot.lifecycle != "adopted"
        or tombstone_snapshot.context is not context
        or tombstone_snapshot.prepared_owner is not prepared_owner
        or adoption_snapshot.context is not context
        or adoption_snapshot.tombstone is not tombstone
        or adoption_snapshot.prepared_owner is not prepared_owner
        or adoption_snapshot.execution is not context_snapshot.execution
        or adoption_snapshot.execution_snapshot is not execution
        or execution.lifecycle != "completed"
    ):
        _fail("GE_CURSOR_B3_REBIND_ADOPTION")
    return context_snapshot, adoption_snapshot, execution


def _poison_outer(
    context: _SQLiteCursorPublicationRebindContext,
    tombstone: _SQLiteCursorPublicationSessionConsumedTombstone,
    adoption: _SQLiteCursorPostRebindWatermarkAdoption,
    reason: str,
) -> None:
    _poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
        context, tombstone, reason, adoption
    )


def _terminate_latched_write_receipt(
    context: _SQLiteCursorPublicationRebindContext,
    latch: _ContextLatch,
) -> None:
    """Burn the exact retained W continuation without consulting SQLite."""

    receipt = latch.write_receipt_ref()
    if _TYPE(receipt) is _SQLiteCursorPublicationRebindWriteReceipt:
        entry = _DICT_GET(_WRITE_RECEIPTS, _ID(receipt))
        if (
            entry is not None
            and entry.key_ref() is receipt
            and _TYPE(entry.value) is _WriteRecord
        ):
            record = entry.value
            snapshot = record.snapshot
            if snapshot.context is context:
                record.consumed = True
                record.snapshot = snapshot._replace(
                    lifecycle="poisoned", rule11_consume_count=1
                )
    latch.lifecycle = "poisoned"


def _authenticate_retained_write_receipt(
    receipt: _SQLiteCursorPublicationRebindWriteReceipt,
    record: _WriteRecord,
    *,
    required_lifecycle: Literal["write-receipt-minted", "rule11-complete"] | None,
    code: str,
) -> _SQLiteCursorPublicationRebindWriteReceiptSnapshot:
    """Prove exact W/latch/P/T/A authority using retained data only."""

    snapshot = record.snapshot
    entry = _DICT_GET(_WRITE_BY_CONTEXT, _ID(snapshot.context))
    latch = (
        entry.value
        if entry is not None
        and entry.key_ref() is snapshot.context
        and _TYPE(entry.value) is _ContextLatch
        else None
    )
    if (
        latch is None
        or latch.write_receipt_ref() is not receipt
        or snapshot.lifecycle == "poisoned"
        or latch.lifecycle != snapshot.lifecycle
        or (required_lifecycle is not None and snapshot.lifecycle != required_lifecycle)
        or (
            snapshot.lifecycle == "write-receipt-minted"
            and (record.consumed or snapshot.rule11_consume_count != 0)
        )
        or (
            snapshot.lifecycle == "rule11-complete"
            and (not record.consumed or snapshot.rule11_consume_count != 1)
        )
    ):
        _fail(code)
    try:
        _assert_sqlite_cursor_publication_rebind_prepared_owner_identity_intrinsic(
            snapshot.prepared_owner
        )
        _assert_sqlite_cursor_publication_session_consumed_tombstone_intrinsic(
            snapshot.consumed_tombstone
        )
        _assert_sqlite_cursor_post_rebind_watermark_adoption_intrinsic(
            snapshot.post_rebind_adoption
        )
        context = _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
            snapshot.context
        )
        tombstone = (
            _read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic(
                snapshot.consumed_tombstone
            )
        )
        adoption = _read_sqlite_cursor_post_rebind_watermark_adoption_snapshot_intrinsic(
            snapshot.post_rebind_adoption
        )
    except _VALUE_ERROR:
        _fail(code)
    if (
        context.lifecycle != "write-adopted"
        or context.session is not snapshot.session
        or context.authority is not snapshot.outer_authority
        or context.prepared_owner is not snapshot.prepared_owner
        or tombstone.lifecycle != "adopted"
        or tombstone.context is not snapshot.context
        or tombstone.session is not snapshot.session
        or tombstone.prepared_owner is not snapshot.prepared_owner
        or adoption.lifecycle != "active"
        or adoption.context is not snapshot.context
        or adoption.tombstone is not snapshot.consumed_tombstone
        or adoption.session is not snapshot.session
        or adoption.prepared_owner is not snapshot.prepared_owner
        or adoption.authority is not snapshot.outer_authority
    ):
        _fail(code)
    return snapshot


def _mint_sqlite_cursor_publication_rebind_write_receipt_intrinsic(
    context: _SQLiteCursorPublicationRebindContext,
    prepared_owner: _SQLiteCursorPublicationRebindPreparedOwner,
    tombstone: _SQLiteCursorPublicationSessionConsumedTombstone,
    adoption: _SQLiteCursorPostRebindWatermarkAdoption,
) -> _SQLiteCursorPublicationRebindWriteReceipt:
    """Mint W only from the exact outer-owned S→P→T→E→A graph."""

    context_snapshot, adoption_snapshot, execution = _authenticate_outer_adoption(
        context, prepared_owner, tombstone, adoption
    )
    existing = _DICT_GET(_WRITE_BY_CONTEXT, _ID(context))
    if existing is not None and existing.key_ref() is context:
        if _TYPE(existing.value) is _ContextLatch:
            _terminate_latched_write_receipt(context, existing.value)
        _poison_outer(context, tombstone, adoption, "SQLite rebind W replay")
        _fail("GE_CURSOR_B3_REBIND_WRITE_REUSE")
    try:
        parameters = execution.parameters
        affected = _safe_count(execution.affected_rows)
        changes_affected = _safe_count(execution.changes_affected_rows)
        total_delta = _safe_count(execution.total_changes_delta)
        ledger_delta = _safe_count(execution.cursor_ledger_delta.affected_rows_watermark)
        observed_counts = _Rule11CountProjection(
            _safe_count(context_snapshot.b2_cursor_count),
            affected,
            changes_affected,
            total_delta,
            ledger_delta,
        )
        mismatch_outcome = _evidence_mismatch_outcome(context_snapshot.execution)
        counts = (
            observed_counts
            if mismatch_outcome is None
            else _project_evidence_mismatch(mismatch_outcome, observed_counts)
        )
        if mismatch_outcome is not None:
            mismatch_outcome.tombstone_ref = _REF(tombstone)
            mismatch_outcome.adoption_ref = _REF(adoption)
            mismatch_outcome.tombstone_lifecycle = "active"
            mismatch_outcome.adoption_lifecycle = "active"
        if (
            parameters is None
            or execution.rebind_sql != SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC
            or execution.rebind_sql_sha256
            != SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC
            or execution.parameter_order
            != SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC
            or execution.changes_sql != SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC
            or execution.changes_sql_sha256
            != SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC
            or parameters != context_snapshot.parameter_values
            or execution.prepare_count != 1
            or execution.execute_count != 1
            or execution.release_count != 1
            or execution.changes_prepare_count != 1
            or execution.changes_fetch_count != 1
            or execution.changes_release_count != 1
            or execution.transaction_generation is not context_snapshot.transaction_generation
            or execution.transaction_epoch_before
            != context_snapshot.historical_transaction_epoch
            or execution.transaction_epoch
            != context_snapshot.historical_transaction_epoch + 1
            or execution.total_changes_before != context_snapshot.historical_total_changes
            or execution.total_changes
            != context_snapshot.historical_total_changes + total_delta
            or _TUPLE(execution.cursor_ledger_before) != (0, 0, 0)
            or _TUPLE(execution.cursor_ledger_delta) != (affected, 1, 1)
            or execution.cursor_ledger_after != execution.cursor_ledger_delta
            or not _exact_ledger(
                adoption_snapshot.historical_outer_ledger,
                context_snapshot.historical_outer_ledger,
            )
            or not _exact_ledger(
                adoption_snapshot.adopted_outer_ledger,
                context_snapshot.historical_outer_ledger,
            )
        ):
            _fail("GE_CURSOR_B3_REBIND_WRITE_GRAPH")
        if mismatch_outcome is not None:
            check = mismatch_outcome.check
            if check is None or check.accepted or check.violation_count != 1:
                _fail("GE_CURSOR_B3_REBIND_EVIDENCE_OUTCOME")
            if mismatch_outcome.outer_mismatch:
                reason = "SQLite rebind evidence mismatch outer ledger"
                primary = _VALUE_ERROR("GE_CURSOR_B3_REBIND_EVIDENCE_OUTER")
                try:
                    _poison_outer(context, tombstone, adoption, reason)
                except BaseException:
                    pass
                else:
                    mismatch_outcome.first_poison_reason = reason
                    mismatch_outcome.tombstone_lifecycle = "poisoned"
                    mismatch_outcome.adoption_lifecycle = "poisoned"
                    _record_sqlite_connection_cursor_publication_rebind_completed_primary_intrinsic(
                        context_snapshot.connection,
                        context_snapshot.execution,
                        primary,
                        "rule11-outer-ledger",
                    )
                raise primary
        receipt = _SQLiteCursorPublicationRebindWriteReceipt(_CONSTRUCTION_TOKEN)
        snapshot = _SQLiteCursorPublicationRebindWriteReceiptSnapshot(
            "write-receipt-minted",
            context_snapshot.session,
            context_snapshot.authority,
            context,
            prepared_owner,
            tombstone,
            adoption,
            context_snapshot.execution,
            context_snapshot.connection,
            context_snapshot.transaction_generation,
            execution.transaction_epoch_before,
            execution.transaction_epoch,
            execution.total_changes_before,
            execution.total_changes,
            execution.rebind_sql,
            execution.rebind_sql_sha256,
            execution.parameter_order,
            parameters,
            _parameter_sha256(parameters),
            execution.changes_sql,
            execution.changes_sql_sha256,
            1,
            1,
            1,
            1,
            1,
            1,
            counts,
            1,
            1,
            context_snapshot.historical_outer_ledger,
            adoption_snapshot.adopted_outer_ledger,
            True,
            0,
        )
        record = _WriteRecord(snapshot)
        latch = _ContextLatch("write-receipt-minted", _REF(receipt))
        _REGISTER_WRITE(_WRITE_RECEIPTS, receipt, record)
        _REGISTER_CONTEXT_LATCH(_WRITE_BY_CONTEXT, context, latch)
        if mismatch_outcome is not None:
            mismatch_outcome.write_ref = _REF(receipt)
            mismatch_outcome.write_lifecycle = "active"
    except BaseException as primary:
        if "receipt" in locals():
            _discard_exact(_WRITE_RECEIPTS, receipt)
        _discard_exact(_WRITE_BY_CONTEXT, context)
        reason = (
            mismatch_outcome.first_poison_reason
            if "mismatch_outcome" in locals()
            and mismatch_outcome is not None
            and mismatch_outcome.first_poison_reason is not None
            else "SQLite rebind W mint failed"
        )
        should_poison = (
            "mismatch_outcome" not in locals()
            or mismatch_outcome is None
            or mismatch_outcome.first_poison_reason is None
        )
        if should_poison:
            try:
                _poison_outer(context, tombstone, adoption, reason)
            except BaseException:
                pass
            else:
                if "mismatch_outcome" in locals() and mismatch_outcome is not None:
                    mismatch_outcome.first_poison_reason = reason
                    mismatch_outcome.tombstone_lifecycle = "poisoned"
                    mismatch_outcome.adoption_lifecycle = "poisoned"
                    if "receipt" in locals():
                        mismatch_outcome.write_ref = None
                        mismatch_outcome.write_lifecycle = "absent"
        raise primary
    return receipt


def _execute_sqlite_cursor_publication_rule11_intrinsic(
    receipt: _SQLiteCursorPublicationRebindWriteReceipt,
) -> _SQLiteCursorPublicationRule11SuccessReceipt:
    record = cast(
        _WriteRecord,
        _record(
            _WRITE_RECEIPTS,
            receipt,
            _SQLiteCursorPublicationRebindWriteReceipt,
            _WriteRecord,
            "GE_CURSOR_B3_RULE11_PREDECESSOR",
        ),
    )
    snapshot = record.snapshot
    mismatch_outcome = _evidence_mismatch_outcome(snapshot.rebind_execution)
    intended_count_mismatch: ValueError | None = None
    try:
        snapshot = _authenticate_retained_write_receipt(
            receipt,
            record,
            required_lifecycle="write-receipt-minted",
            code="GE_CURSOR_B3_RULE11_REUSE",
        )
        check = _check_sqlite_cursor_publication_rule11_counts_intrinsic(snapshot.counts)
        if not check.accepted or check.violation_count != 0:
            if (
                mismatch_outcome is not None
                and mismatch_outcome.outer_mismatch is False
                and mismatch_outcome.check == check
                and snapshot.counts == mismatch_outcome.projected_counts
                and not check.accepted
                and check.violation_count == 1
                and _evidence_projection_is_exact(mismatch_outcome)
            ):
                intended_count_mismatch = _VALUE_ERROR(
                    "GE_CURSOR_B3_RULE11_COUNT_MISMATCH"
                )
                raise intended_count_mismatch
            _fail("GE_CURSOR_B3_RULE11_COUNT_MISMATCH")
        if (
            snapshot.cursor_ledger_logical_write_delta != 1
            or snapshot.cursor_ledger_fixed_statement_delta != 1
            or not snapshot.outer_ledger_unchanged
            or not _exact_ledger(snapshot.outer_ledger_before, snapshot.outer_ledger_after)
        ):
            _fail("GE_CURSOR_B3_RULE11_COUNT_MISMATCH")
        rule11 = _SQLiteCursorPublicationRule11SuccessReceipt(_CONSTRUCTION_TOKEN)
        result = _SQLiteCursorPublicationRule11SuccessReceiptSnapshot(
            RULE11_ID,
            RULE11_POSITION,
            receipt,
            snapshot.counts,
            1,
            1,
            0,
            False,
            snapshot.transaction_generation,
            snapshot.transaction_epoch_after,
            snapshot.total_changes_after,
        )
        _REGISTER_RULE11(_RULE11_RECEIPTS, rule11, _Rule11Record(result))
    except BaseException as primary:
        if "rule11" in locals():
            _discard_exact(_RULE11_RECEIPTS, rule11)
        record.consumed = True
        record.snapshot = snapshot._replace(lifecycle="poisoned", rule11_consume_count=1)
        latch_entry = _DICT_GET(_WRITE_BY_CONTEXT, _ID(snapshot.context))
        if latch_entry is not None and latch_entry.key_ref() is snapshot.context:
            cast(_ContextLatch, latch_entry.value).lifecycle = "poisoned"
        reason = "SQLite Rule 11 failed"
        selected_count_mismatch = (
            mismatch_outcome is not None and primary is intended_count_mismatch
        )
        if mismatch_outcome is not None:
            mismatch_outcome.write_lifecycle = "poisoned"
        if selected_count_mismatch:
            reason = "SQLite Rule 11 five counts disagree"
        try:
            _poison_outer(
                snapshot.context,
                snapshot.consumed_tombstone,
                snapshot.post_rebind_adoption,
                reason,
            )
        except BaseException:
            pass
        else:
            if mismatch_outcome is not None:
                mismatch_outcome.first_poison_reason = reason
                mismatch_outcome.tombstone_lifecycle = "poisoned"
                mismatch_outcome.adoption_lifecycle = "poisoned"
            if selected_count_mismatch:
                _record_sqlite_connection_cursor_publication_rebind_completed_primary_intrinsic(
                    snapshot.connection,
                    snapshot.rebind_execution,
                    primary,
                    "rule11-five-count",
                )
        raise primary
    record.consumed = True
    record.snapshot = snapshot._replace(
        lifecycle="rule11-complete", rule11_consume_count=1
    )
    latch_entry = _DICT_GET(_WRITE_BY_CONTEXT, _ID(snapshot.context))
    if latch_entry is not None and latch_entry.key_ref() is snapshot.context:
        cast(_ContextLatch, latch_entry.value).lifecycle = "rule11-complete"
    return rule11


def _read_sqlite_cursor_publication_rebind_write_receipt_snapshot_intrinsic(
    receipt: _SQLiteCursorPublicationRebindWriteReceipt,
) -> _SQLiteCursorPublicationRebindWriteReceiptSnapshot:
    record = cast(
        _WriteRecord,
        _record(
            _WRITE_RECEIPTS,
            receipt,
            _SQLiteCursorPublicationRebindWriteReceipt,
            _WriteRecord,
            "GE_CURSOR_B3_REBIND_WRITE_RECEIPT",
        ),
    )
    return _authenticate_retained_write_receipt(
        receipt,
        record,
        required_lifecycle=None,
        code="GE_CURSOR_B3_REBIND_WRITE_RECEIPT",
    )


def _read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
    receipt: _SQLiteCursorPublicationRule11SuccessReceipt,
) -> _SQLiteCursorPublicationRule11SuccessReceiptSnapshot:
    record = cast(
        _Rule11Record,
        _record(
            _RULE11_RECEIPTS,
            receipt,
            _SQLiteCursorPublicationRule11SuccessReceipt,
            _Rule11Record,
            "GE_CURSOR_B3_RULE11_RECEIPT",
        ),
    )
    if record.lifecycle == "poisoned":
        _fail("GE_CURSOR_B3_RULE11_RECEIPT")
    result = record.snapshot
    write = cast(
        _WriteRecord,
        _record(
            _WRITE_RECEIPTS,
            result.write_receipt,
            _SQLiteCursorPublicationRebindWriteReceipt,
            _WriteRecord,
            "GE_CURSOR_B3_RULE11_RECEIPT",
        ),
    )
    write_snapshot = _authenticate_retained_write_receipt(
        result.write_receipt,
        write,
        required_lifecycle="rule11-complete",
        code="GE_CURSOR_B3_RULE11_RECEIPT",
    )
    if write_snapshot.counts != result.counts:
        _fail("GE_CURSOR_B3_RULE11_RECEIPT")
    return result


def _prepare_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
    receipt: _SQLiteCursorPublicationRule11SuccessReceipt,
) -> _SQLiteCursorPublicationRule11SuccessReceiptSnapshot:
    """Consume the authentic R11 lifecycle into one pending Rule 12 attempt."""

    record = cast(
        _Rule11Record,
        _record(
            _RULE11_RECEIPTS,
            receipt,
            _SQLiteCursorPublicationRule11SuccessReceipt,
            _Rule11Record,
            "GE_CURSOR_B3_RULE11_RECEIPT",
        ),
    )
    if record.lifecycle != "active" or record.rule12_receipt is not None:
        if record.lifecycle != "poisoned":
            _poison_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
                receipt, "SQLite Rule 11 predecessor replayed for Rule 12"
            )
        _fail("GE_CURSOR_B3_RULE12_REPLAY")
    snapshot = _read_sqlite_cursor_publication_rule11_receipt_snapshot_intrinsic(
        receipt
    )
    record.lifecycle = "rule12-pending"
    return snapshot


def _complete_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
    receipt: _SQLiteCursorPublicationRule11SuccessReceipt,
    rule12_receipt: object,
) -> None:
    """Publish the exact Rule 12 successor into the real R11 owner once."""

    record = cast(
        _Rule11Record,
        _record(
            _RULE11_RECEIPTS,
            receipt,
            _SQLiteCursorPublicationRule11SuccessReceipt,
            _Rule11Record,
            "GE_CURSOR_B3_RULE11_RECEIPT",
        ),
    )
    if (
        rule12_receipt is None
        or record.lifecycle != "rule12-pending"
        or record.rule12_receipt is not None
    ):
        _poison_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
            receipt, "SQLite Rule 12 successor adoption drifted"
        )
        _fail("GE_CURSOR_B3_RULE12_ADOPTION")
    try:
        record.rule12_receipt = ref(rule12_receipt)
    except TypeError as error:
        _poison_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
            receipt, "SQLite Rule 12 successor was not weak-referenceable"
        )
        raise ValueError("GE_CURSOR_B3_RULE12_ADOPTION") from error
    record.lifecycle = "rule12-complete"


def _assert_sqlite_cursor_publication_rule11_rule12_successor_intrinsic(
    receipt: _SQLiteCursorPublicationRule11SuccessReceipt,
    rule12_receipt: object,
) -> None:
    record = cast(
        _Rule11Record,
        _record(
            _RULE11_RECEIPTS,
            receipt,
            _SQLiteCursorPublicationRule11SuccessReceipt,
            _Rule11Record,
            "GE_CURSOR_B3_RULE11_RECEIPT",
        ),
    )
    if (
        record.lifecycle != "rule12-complete"
        or record.rule12_receipt is None
        or record.rule12_receipt() is not rule12_receipt
    ):
        _fail("GE_CURSOR_B3_RULE12_ADOPTION")


def _poison_sqlite_cursor_publication_rule11_for_rule12_intrinsic(
    receipt: _SQLiteCursorPublicationRule11SuccessReceipt,
    reason: str,
) -> None:
    """Poison the exact R11/W/outer graph while preserving an upper primary."""

    record = cast(
        _Rule11Record,
        _record(
            _RULE11_RECEIPTS,
            receipt,
            _SQLiteCursorPublicationRule11SuccessReceipt,
            _Rule11Record,
            "GE_CURSOR_B3_RULE11_RECEIPT",
        ),
    )
    if type(reason) is not str or not reason:
        _fail("GE_CURSOR_B3_RULE12_POISON")
    if record.lifecycle == "poisoned":
        return
    record.lifecycle = "poisoned"
    write_record = cast(
        _WriteRecord,
        _record(
            _WRITE_RECEIPTS,
            record.snapshot.write_receipt,
            _SQLiteCursorPublicationRebindWriteReceipt,
            _WriteRecord,
            "GE_CURSOR_B3_RULE11_RECEIPT",
        ),
    )
    write = _authenticate_retained_write_receipt(
        record.snapshot.write_receipt,
        write_record,
        required_lifecycle="rule11-complete",
        code="GE_CURSOR_B3_RULE11_RECEIPT",
    )
    write_record.snapshot = write._replace(lifecycle="poisoned")
    _poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
        write.context,
        write.consumed_tombstone,
        reason,
        write.post_rebind_adoption,
    )


def _execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
    session: _SQLiteCursorPublicationSession,
    cancellation: _SQLiteCursorPublicationSessionCancellationSignal | None = None,
) -> _SQLiteCursorPublicationRule11SuccessReceipt:
    """Serialized leaf: S→P/context→T→E→A→W→zero-I/O R11."""

    session_snapshot = _read_sqlite_cursor_publication_session_snapshot_intrinsic(
        session
    )
    if _is_sqlite_cursor_publication_session_cancellation_requested_intrinsic(
        cancellation
    ):
        _fail("GE_CURSOR_B3_REBIND_CANCELLED")
    connection = session_snapshot.connection
    execution: _SQLiteConnectionCursorPublicationRebindExecution | None = None
    context: _SQLiteCursorPublicationRebindContext | None = None
    prepared_owner: _SQLiteCursorPublicationRebindPreparedOwner | None = None
    force_preconsume_release = False
    try:
        execution = _prepare_sqlite_connection_cursor_publication_rebind_intrinsic(
            connection
        )
        context = _prepare_sqlite_cursor_publication_rebind_context_intrinsic(
            session, execution
        )
        context_snapshot = (
            _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(context)
        )
        prepared_owner = context_snapshot.prepared_owner
        _prepare_sqlite_cursor_publication_rebind_subprotocol_intrinsic(
            context, prepared_owner
        )
        force_preconsume_release = (
            _handoff_sqlite_cursor_publication_preconsume_release_fault_for_test_intrinsic(
                session, context, prepared_owner, execution
            )
        )
    except BaseException as primary:
        if context is not None and prepared_owner is not None:
            with suppress(BaseException):
                _release_sqlite_cursor_publication_rebind_context_before_consume_intrinsic(
                    context, prepared_owner
                )
        elif execution is not None:
            with suppress(BaseException):
                _release_sqlite_connection_cursor_publication_rebind_intrinsic(
                    connection, execution
                )
        raise primary
    cancelled_before_execute = (
        _is_sqlite_cursor_publication_session_cancellation_requested_intrinsic(
            cancellation
        )
    )
    if force_preconsume_release or cancelled_before_execute:
        _release_sqlite_cursor_publication_rebind_context_before_consume_intrinsic(
            context, prepared_owner
        )
        if force_preconsume_release:
            _fail("GE_CURSOR_B3_REBIND_RELEASE_FAULT")
        _fail("GE_CURSOR_B3_REBIND_CANCELLED")
    try:
        _handoff_sqlite_cursor_publication_rebind_evidence_mismatch_intrinsic(
            session, context, prepared_owner, execution
        )
    except BaseException as primary:
        with suppress(BaseException):
            _release_sqlite_cursor_publication_rebind_context_before_consume_intrinsic(
                context, prepared_owner
            )
        raise primary
    try:
        tombstone = _consume_sqlite_cursor_publication_session_for_rebind_intrinsic(
            context
        )
    except BaseException as primary:
        with suppress(BaseException):
            _release_sqlite_cursor_publication_rebind_context_before_consume_intrinsic(
                context, prepared_owner
            )
        raise primary
    adoption: _SQLiteCursorPostRebindWatermarkAdoption | None = None
    try:
        _execute_sqlite_connection_cursor_publication_rebind_intrinsic(
            connection,
            execution,
            session_snapshot.target_descriptor_hash,
            session_snapshot.target_schema_identity,
            session_snapshot.source_descriptor_hash,
            session_snapshot.source_schema_identity,
        )
        _release_sqlite_connection_cursor_publication_rebind_intrinsic(
            connection, execution
        )
        _prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic(
            connection, execution
        )
        adoption = _adopt_sqlite_cursor_post_rebind_watermark_intrinsic(
            context, tombstone, execution
        )
        write = _mint_sqlite_cursor_publication_rebind_write_receipt_intrinsic(
            context, prepared_owner, tombstone, adoption
        )
        return _execute_sqlite_cursor_publication_rule11_intrinsic(write)
    except BaseException as primary:
        execution_completed = False
        with suppress(BaseException):
            execution_completed = (
                _read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
                    connection, execution
                ).lifecycle
                == "completed"
            )
        if not execution_completed:
            with suppress(BaseException):
                _release_sqlite_connection_cursor_publication_rebind_intrinsic(
                    connection, execution
                )
        mismatch_outcome = _evidence_mismatch_outcome(execution)
        if mismatch_outcome is None or mismatch_outcome.first_poison_reason is None:
            fallback_reason = (
                "SQLite Rule 11 failed"
                if mismatch_outcome is not None
                else "SQLite serialized rebind Rule 11 failed after T"
            )
            try:
                _poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
                    context,
                    tombstone,
                    fallback_reason,
                    adoption,
                )
            except BaseException:
                pass
            else:
                if mismatch_outcome is not None:
                    mismatch_outcome.first_poison_reason = fallback_reason
                    mismatch_outcome.tombstone_lifecycle = "poisoned"
                    mismatch_outcome.adoption_lifecycle = "poisoned"
        raise primary
