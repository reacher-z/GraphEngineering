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
    _execute_sqlite_connection_cursor_publication_rebind_intrinsic,
    _prepare_sqlite_connection_cursor_publication_rebind_intrinsic,
    _prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic,
    _release_sqlite_connection_cursor_publication_rebind_intrinsic,
    _SQLiteConnectionCursorPublicationRebindExecution,
    _SQLiteConnectionCursorPublicationRebindSnapshot,
)

RULE11_ID: Literal["BLR_CURSOR_REBIND_COUNT"] = "BLR_CURSOR_REBIND_COUNT"
RULE11_POSITION: Literal[11] = 11
_CONSTRUCTION_TOKEN = object()
_TYPE = type
_ID = id
_REF = ref
_TUPLE: Any = tuple
_ALL: Any = all
_DICT_GET = dict.get
_DICT_SET = dict.__setitem__
_DICT_POP = dict.pop
_DIGEST_PARAMETERS = _digest_sqlite_initial_write_parameters_intrinsic


def _fail(code: str) -> Never:
    raise ValueError(code)


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


@dataclass(frozen=True, slots=True)
class _Rule11Record:
    snapshot: _SQLiteCursorPublicationRule11SuccessReceiptSnapshot


@dataclass(slots=True)
class _ContextLatch:
    lifecycle: Literal["write-receipt-minted", "rule11-complete", "poisoned"]
    write_receipt_ref: ReferenceType[_SQLiteCursorPublicationRebindWriteReceipt]


class _Entry(NamedTuple):
    key_ref: ReferenceType[object]
    value: object


_WRITE_RECEIPTS: dict[int, _Entry] = {}
_RULE11_RECEIPTS: dict[int, _Entry] = {}
_WRITE_BY_CONTEXT: dict[int, _Entry] = {}


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
    except ValueError:
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
        counts = _Rule11CountProjection(
            _safe_count(context_snapshot.b2_cursor_count),
            affected,
            changes_affected,
            total_delta,
            ledger_delta,
        )
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
    except BaseException as primary:
        if "receipt" in locals():
            _discard_exact(_WRITE_RECEIPTS, receipt)
        _discard_exact(_WRITE_BY_CONTEXT, context)
        with suppress(BaseException):
            _poison_outer(context, tombstone, adoption, "SQLite rebind W mint failed")
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
    try:
        snapshot = _authenticate_retained_write_receipt(
            receipt,
            record,
            required_lifecycle="write-receipt-minted",
            code="GE_CURSOR_B3_RULE11_REUSE",
        )
        check = _check_sqlite_cursor_publication_rule11_counts_intrinsic(snapshot.counts)
        if (
            not check.accepted
            or check.violation_count != 0
            or snapshot.cursor_ledger_logical_write_delta != 1
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
        with suppress(BaseException):
            _poison_outer(
                snapshot.context,
                snapshot.consumed_tombstone,
                snapshot.post_rebind_adoption,
                "SQLite Rule 11 failed",
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
    result = cast(
        _Rule11Record,
        _record(
            _RULE11_RECEIPTS,
            receipt,
            _SQLiteCursorPublicationRule11SuccessReceipt,
            _Rule11Record,
            "GE_CURSOR_B3_RULE11_RECEIPT",
        ),
    ).snapshot
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
    if _is_sqlite_cursor_publication_session_cancellation_requested_intrinsic(
        cancellation
    ):
        _release_sqlite_cursor_publication_rebind_context_before_consume_intrinsic(
            context, prepared_owner
        )
        _fail("GE_CURSOR_B3_REBIND_CANCELLED")
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
        with suppress(BaseException):
            _release_sqlite_connection_cursor_publication_rebind_intrinsic(
                connection, execution
            )
        with suppress(BaseException):
            _poison_sqlite_cursor_publication_rebind_downstream_intrinsic(
                context,
                tombstone,
                "SQLite serialized rebind Rule 11 failed after T",
                adoption,
            )
        raise primary
