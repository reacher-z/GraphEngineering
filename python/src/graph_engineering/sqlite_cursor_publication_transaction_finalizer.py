"""Authenticated failure-only finalization after exact publication consume T."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, NamedTuple, Never, cast
from weakref import ReferenceType, ref

from .sqlite_cursor_publication_outer_authority import (
    _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic,
    _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic,
    _read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic,
    _read_sqlite_cursor_publication_session_snapshot_intrinsic,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorPublicationRebindContext,
    _SQLiteCursorPublicationSession,
    _SQLiteCursorPublicationSessionConsumedTombstone,
)
from .sqlite_cursor_publication_subprotocol import (
    _execute_sqlite_cursor_publication_rebind_rule11_intrinsic,
)
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    _arm_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic,
    _CursorPublicationChangesPrimaryCapture,
    _read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic,
    _reset_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic,
    _SQLiteConnectionCursorPublicationRebindExecution,
    _take_sqlite_connection_cursor_publication_rebind_changes_primary_intrinsic,
)

_CONSTRUCTION_TOKEN = object()
_LEAF = _execute_sqlite_cursor_publication_rebind_rule11_intrinsic
_OWNER_ROLLBACK = SQLiteV1BaselineConnectionOwner.rollback
_OWNER_CLOSE = SQLiteV1BaselineConnectionOwner.close
_MAX_SAFE_INTEGER = 9_007_199_254_740_991

_PrimaryBoundary = Literal[
    "native-execute",
    "serialized-changes-pre-query",
    "serialized-changes-prepare",
    "serialized-changes-execute",
    "serialized-changes-fetch",
    "serialized-changes-release",
    "serialized-changes-post-query",
]


def _fail(code: str) -> Never:
    raise ValueError(code)


class _PostConsumeTransactionFailureFinalizer:
    """Opaque owner; strong presentation lives here, never in a registry value."""

    __slots__ = (
        "__authority",
        "__connection",
        "__context",
        "__execution",
        "__generation",
        "__primary",
        "__tombstone",
        "__weakref__",
    )

    def __init__(
        self,
        connection: SQLiteV1BaselineConnectionOwner,
        authority: _SQLiteCursorOuterPublicationAuthority,
        context: _SQLiteCursorPublicationRebindContext,
        tombstone: _SQLiteCursorPublicationSessionConsumedTombstone,
        execution: _SQLiteConnectionCursorPublicationRebindExecution,
        generation: object,
        primary: BaseException,
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_POSTCONSUME_FINALIZER")
        object.__setattr__(self, "_PostConsumeTransactionFailureFinalizer__connection", connection)
        object.__setattr__(self, "_PostConsumeTransactionFailureFinalizer__authority", authority)
        object.__setattr__(self, "_PostConsumeTransactionFailureFinalizer__context", context)
        object.__setattr__(self, "_PostConsumeTransactionFailureFinalizer__tombstone", tombstone)
        object.__setattr__(self, "_PostConsumeTransactionFailureFinalizer__execution", execution)
        object.__setattr__(self, "_PostConsumeTransactionFailureFinalizer__generation", generation)
        object.__setattr__(self, "_PostConsumeTransactionFailureFinalizer__primary", primary)

    def __setattr__(self, _name: str, _value: object) -> None:
        raise TypeError("GE_CURSOR_B3_POSTCONSUME_FINALIZER_STATE")


class _PostConsumeDiagnostic(NamedTuple):
    code: str
    operation: str
    rank: Literal["primary", "secondary", "tertiary"]
    origin: Literal[
        "authenticated-post-t-terminal-primary",
        "after-native-return-ambiguous-cleanup-fault",
    ]


_PRIMARY_DIAGNOSTIC = _PostConsumeDiagnostic(
    "GE_SQLITE_POST_T_TERMINAL_PRIMARY",
    "cursor-publication-rule-11",
    "primary",
    "authenticated-post-t-terminal-primary",
)
_ROLLBACK_DIAGNOSTIC = _PostConsumeDiagnostic(
    "GE_SQLITE_ROLLBACK_AFTER_NATIVE_RETURN",
    "rollback",
    "secondary",
    "after-native-return-ambiguous-cleanup-fault",
)
_CLOSE_DIAGNOSTIC = _PostConsumeDiagnostic(
    "GE_SQLITE_CLOSE_AFTER_NATIVE_RETURN",
    "close",
    "tertiary",
    "after-native-return-ambiguous-cleanup-fault",
)


class _PostConsumeTransactionFailureFinalizerSnapshot(NamedTuple):
    lifecycle: Literal["prepared", "finalizing", "finalized"]
    state_trace: tuple[str, ...]
    owner_consume_count: Literal[0, 1]
    terminalize_count: Literal[0, 1]
    rollback_attempt_count: Literal[0, 1]
    rollback_native_return_count: Literal[0, 1]
    rollback_after_native_return_ambiguous_fault_count: Literal[0, 1]
    rollback_secondary_failure_count: Literal[0, 1]
    close_attempt_count: Literal[0, 1]
    close_native_return_count: Literal[0, 1]
    close_after_native_return_ambiguous_fault_count: Literal[0, 1]
    close_tertiary_failure_count: Literal[0, 1]
    diagnostics: tuple[_PostConsumeDiagnostic, ...]
    primary_boundary: _PrimaryBoundary
    transaction_epoch: int


@dataclass(slots=True)
class _FinalizerState:
    connection_id: int
    authority_ref: ReferenceType[_SQLiteCursorOuterPublicationAuthority]
    context_ref: ReferenceType[_SQLiteCursorPublicationRebindContext]
    tombstone_ref: ReferenceType[_SQLiteCursorPublicationSessionConsumedTombstone]
    execution_ref: ReferenceType[_SQLiteConnectionCursorPublicationRebindExecution]
    generation_id: int
    primary_id: int
    transaction_epoch: int
    primary_boundary: _PrimaryBoundary
    lifecycle: Literal["prepared", "finalizing", "finalized"] = "prepared"
    state_trace: tuple[str, ...] = ("prepared",)
    owner_consume_count: Literal[0, 1] = 0
    terminalize_count: Literal[0, 1] = 0
    rollback_attempt_count: Literal[0, 1] = 0
    rollback_native_return_count: Literal[0, 1] = 0
    rollback_after_return_count: Literal[0, 1] = 0
    rollback_secondary_count: Literal[0, 1] = 0
    close_attempt_count: Literal[0, 1] = 0
    close_native_return_count: Literal[0, 1] = 0
    close_after_return_count: Literal[0, 1] = 0
    close_tertiary_count: Literal[0, 1] = 0
    rollback_fault_ref: ReferenceType[BaseException] | None = None
    close_fault_ref: ReferenceType[BaseException] | None = None
    diagnostics: tuple[_PostConsumeDiagnostic, ...] = (_PRIMARY_DIAGNOSTIC,)


class _Entry(NamedTuple):
    key_ref: ReferenceType[_PostConsumeTransactionFailureFinalizer]
    state: _FinalizerState


class _ContextEntry(NamedTuple):
    context_ref: ReferenceType[_SQLiteCursorPublicationRebindContext]
    owner_ref: ReferenceType[_PostConsumeTransactionFailureFinalizer]


_POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS: dict[int, _Entry] = {}
_POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT: dict[int, _ContextEntry] = {}


def _owner_presentation(
    owner: _PostConsumeTransactionFailureFinalizer,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteCursorPublicationRebindContext,
    _SQLiteCursorPublicationSessionConsumedTombstone,
    _SQLiteConnectionCursorPublicationRebindExecution,
    object,
    BaseException,
]:
    try:
        values = (
            object.__getattribute__(owner, "_PostConsumeTransactionFailureFinalizer__connection"),
            object.__getattribute__(owner, "_PostConsumeTransactionFailureFinalizer__authority"),
            object.__getattribute__(owner, "_PostConsumeTransactionFailureFinalizer__context"),
            object.__getattribute__(owner, "_PostConsumeTransactionFailureFinalizer__tombstone"),
            object.__getattribute__(owner, "_PostConsumeTransactionFailureFinalizer__execution"),
            object.__getattribute__(owner, "_PostConsumeTransactionFailureFinalizer__generation"),
            object.__getattribute__(owner, "_PostConsumeTransactionFailureFinalizer__primary"),
        )
    except (AttributeError, TypeError):
        _fail("GE_CURSOR_B3_POSTCONSUME_FINALIZER")
    return cast(
        tuple[
            SQLiteV1BaselineConnectionOwner,
            _SQLiteCursorOuterPublicationAuthority,
            _SQLiteCursorPublicationRebindContext,
            _SQLiteCursorPublicationSessionConsumedTombstone,
            _SQLiteConnectionCursorPublicationRebindExecution,
            object,
            BaseException,
        ],
        values,
    )


def _discard_owner_exact(owner: _PostConsumeTransactionFailureFinalizer) -> None:
    owner_id = id(owner)
    current = _POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS.get(owner_id)
    if current is not None and current.key_ref() is owner:
        _POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS.pop(owner_id, None)


def _discard_context_exact(
    context: _SQLiteCursorPublicationRebindContext,
    owner: _PostConsumeTransactionFailureFinalizer,
) -> None:
    current = _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT.get(id(context))
    if current is not None and current.context_ref() is context and current.owner_ref() is owner:
        _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT.pop(id(context), None)


def _register_owner(owner: _PostConsumeTransactionFailureFinalizer, state: _FinalizerState) -> None:
    owner_id = id(owner)

    def discard(dead: ReferenceType[_PostConsumeTransactionFailureFinalizer]) -> None:
        current = _POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS.get(owner_id)
        if current is not None and current.key_ref is dead:
            context = current.state.context_ref()
            _POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS.pop(owner_id, None)
            if context is not None:
                reverse = _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT.get(id(context))
                if reverse is not None and reverse.owner_ref is dead:
                    _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT.pop(id(context), None)

    _POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS[owner_id] = _Entry(ref(owner, discard), state)


def _register_context(
    context: _SQLiteCursorPublicationRebindContext,
    owner: _PostConsumeTransactionFailureFinalizer,
) -> None:
    context_id = id(context)
    existing = _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT.get(context_id)
    if existing is not None and existing.context_ref() is context:
        if existing.owner_ref() is not None:
            _fail("GE_CURSOR_B3_POSTCONSUME_DUPLICATE")
        _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT.pop(context_id, None)

    def discard_context(dead: ReferenceType[_SQLiteCursorPublicationRebindContext]) -> None:
        current = _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT.get(context_id)
        if current is not None and current.context_ref is dead:
            _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT.pop(context_id, None)

    _POSTCONSUME_TRANSACTION_FAILURE_FINALIZER_BY_CONTEXT[context_id] = _ContextEntry(
        ref(context, discard_context), ref(owner)
    )


_REGISTER_OWNER = _register_owner
_REGISTER_CONTEXT = _register_context


def _state(owner: _PostConsumeTransactionFailureFinalizer) -> _FinalizerState:
    if type(owner) is not _PostConsumeTransactionFailureFinalizer:
        _fail("GE_CURSOR_B3_POSTCONSUME_FINALIZER")
    current = _POSTCONSUME_TRANSACTION_FAILURE_FINALIZERS.get(id(owner))
    if current is None or current.key_ref() is not owner:
        _fail("GE_CURSOR_B3_POSTCONSUME_FINALIZER")
    return current.state


def _native_primary(error: BaseException) -> bool:
    return (
        type(error) is ValueError
        and error.args == ("GE_CURSOR_B3_CURSOR_REBIND_EXECUTE",)
        and isinstance(error.__cause__, sqlite3.Error)
    )


def _authenticate_exact_native_primary_graph(
    connection: SQLiteV1BaselineConnectionOwner,
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> tuple[
    _SQLiteCursorPublicationRebindContext,
    _SQLiteCursorPublicationSessionConsumedTombstone,
    _SQLiteConnectionCursorPublicationRebindExecution,
    object,
    int,
]:
    context, tombstone, execution, generation, epoch, _boundary = (
        _authenticate_exact_post_t_primary_graph(
            connection,
            authority,
            ValueError("GE_CURSOR_B3_CURSOR_REBIND_EXECUTE"),
            _expected_boundary="native-execute",
        )
    )
    return context, tombstone, execution, generation, epoch


def _authenticate_exact_post_t_primary_graph(
    connection: SQLiteV1BaselineConnectionOwner,
    authority: _SQLiteCursorOuterPublicationAuthority,
    primary: BaseException,
    *,
    _expected_boundary: _PrimaryBoundary | None = None,
    _lower_primary_capture: _CursorPublicationChangesPrimaryCapture | None = None,
    _trusted_boundary: _PrimaryBoundary | None = None,
) -> tuple[
    _SQLiteCursorPublicationRebindContext,
    _SQLiteCursorPublicationSessionConsumedTombstone,
    _SQLiteConnectionCursorPublicationRebindExecution,
    object,
    int,
    _PrimaryBoundary,
]:
    try:
        authority_snapshot = _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            authority
        )
        context = authority_snapshot.publication_rebind_context
        tombstone = authority_snapshot.publication_session_consumed_tombstone
        if context is None or tombstone is None:
            _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
        context_snapshot = _read_sqlite_cursor_publication_rebind_context_snapshot_intrinsic(
            context
        )
        tombstone_snapshot = (
            _read_sqlite_cursor_publication_session_consumed_tombstone_snapshot_intrinsic(tombstone)
        )
        execution = context_snapshot.execution
        execution_snapshot = _read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
            connection, execution
        )
        generation = connection._transaction_generation
        epoch = connection.transaction_epoch
    except BaseException:
        _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
    if (
        type(connection) is not SQLiteV1BaselineConnectionOwner
        or authority_snapshot.lifecycle != "poisoned"
        or authority_snapshot.write_phase != "poisoned"
        or authority_snapshot.connection is not connection
        or authority_snapshot.post_rebind_watermark_adoption is not None
        or context_snapshot.lifecycle != "poisoned"
        or context_snapshot.authority is not authority
        or context_snapshot.connection is not connection
        or tombstone_snapshot.lifecycle != "poisoned"
        or tombstone_snapshot.context is not context
        or tombstone_snapshot.execution is not execution
        or tombstone_snapshot.prepared_owner is not context_snapshot.prepared_owner
        or not connection.in_transaction
        or not connection.in_exclusive_transaction
        or generation is None
        or generation is not authority_snapshot.transaction_generation
        or generation is not context_snapshot.transaction_generation
        or generation is not execution_snapshot.transaction_generation
        or type(epoch) is not int
        or execution_snapshot.lifecycle != "poisoned"
        or execution_snapshot.execute_count != 1
        or execution_snapshot.release_count != 1
    ):
        _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")

    changes_counts = (
        execution_snapshot.changes_prepare_count,
        execution_snapshot.changes_fetch_count,
        execution_snapshot.changes_release_count,
    )
    boundary: _PrimaryBoundary
    if (
        execution_snapshot.affected_rows is None
        and execution_snapshot.changes_affected_rows is None
        and execution_snapshot.cursor_ledger_before == (0, 0, 0)
        and execution_snapshot.cursor_ledger_after == (0, 0, 0)
        and execution_snapshot.cursor_ledger_delta == (0, 0, 0)
        and execution_snapshot.total_changes_delta == 0
        and execution_snapshot.total_changes == execution_snapshot.total_changes_before
        and connection.total_changes == execution_snapshot.total_changes
        and changes_counts == (0, 0, 0)
        and epoch == context_snapshot.historical_transaction_epoch
        and epoch == execution_snapshot.transaction_epoch_before
        and epoch == execution_snapshot.transaction_epoch
    ):
        boundary = "native-execute"
    else:
        if _trusted_boundary is not None:
            lower_boundary = _trusted_boundary
        elif _lower_primary_capture is not None:
            try:
                lower_boundary = (
                    _take_sqlite_connection_cursor_publication_rebind_changes_primary_intrinsic(
                        _lower_primary_capture, connection, execution, primary
                    )
                )
            except BaseException:
                _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
        else:
            _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
        affected = execution_snapshot.affected_rows
        total_delta = execution_snapshot.total_changes_delta
        authenticated_post_query_counter_mismatch = (
            lower_boundary == "serialized-changes-post-query"
            and type(primary) is ValueError
            and primary.args == ("GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE",)
            and changes_counts == (1, 1, 1)
            and execution_snapshot.changes_affected_rows == affected
            and type(affected) is int
            and type(total_delta) is int
            and total_delta > affected
        )
        if (
            type(affected) is not int
            or not 0 <= affected <= _MAX_SAFE_INTEGER
            or type(context_snapshot.b2_cursor_count) is not int
            or affected != context_snapshot.b2_cursor_count
            or execution_snapshot.cursor_ledger_before != (0, 0, 0)
            or execution_snapshot.cursor_ledger_after != (affected, 1, 1)
            or execution_snapshot.cursor_ledger_delta != (affected, 1, 1)
            or type(total_delta) is not int
            or not 0 <= total_delta <= _MAX_SAFE_INTEGER
            or (total_delta != affected and not authenticated_post_query_counter_mismatch)
            or execution_snapshot.total_changes
            != execution_snapshot.total_changes_before + total_delta
            or connection.total_changes != execution_snapshot.total_changes
            or execution_snapshot.transaction_epoch_before
            != context_snapshot.historical_transaction_epoch
            or execution_snapshot.transaction_epoch
            != context_snapshot.historical_transaction_epoch + 1
            or epoch != execution_snapshot.transaction_epoch
        ):
            _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
        if (
            changes_counts == (0, 0, 0)
            and execution_snapshot.changes_affected_rows is None
            and lower_boundary == "serialized-changes-prepare"
        ):
            boundary = "serialized-changes-prepare"
        elif (
            changes_counts == (0, 0, 0)
            and execution_snapshot.changes_affected_rows is None
            and lower_boundary == "serialized-changes-pre-query"
        ):
            boundary = "serialized-changes-pre-query"
        elif (
            changes_counts == (1, 0, 1)
            and execution_snapshot.changes_affected_rows is None
            and lower_boundary == "serialized-changes-execute"
        ):
            boundary = "serialized-changes-execute"
        elif (
            changes_counts == (1, 1, 1)
            and execution_snapshot.changes_affected_rows is None
            and lower_boundary == "serialized-changes-fetch"
        ):
            boundary = "serialized-changes-fetch"
        elif (
            changes_counts == (1, 1, 1)
            and execution_snapshot.changes_affected_rows == affected
            and lower_boundary == "serialized-changes-release"
        ):
            boundary = "serialized-changes-release"
        elif (
            changes_counts == (1, 1, 1)
            and execution_snapshot.changes_affected_rows == affected
            and lower_boundary == "serialized-changes-post-query"
        ):
            boundary = "serialized-changes-post-query"
        else:
            _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
    if _expected_boundary is not None and boundary != _expected_boundary:
        _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
    return context, tombstone, execution, generation, epoch, boundary


def _capture_implementation(
    exact_leaf: Callable[[_SQLiteCursorPublicationSession], object],
    connection: SQLiteV1BaselineConnectionOwner,
    authority: _SQLiteCursorOuterPublicationAuthority,
    session: _SQLiteCursorPublicationSession,
    _register_owner_intrinsic: Callable[
        [_PostConsumeTransactionFailureFinalizer, _FinalizerState], None
    ] = _REGISTER_OWNER,
    _register_context_intrinsic: Callable[
        [_SQLiteCursorPublicationRebindContext, _PostConsumeTransactionFailureFinalizer],
        None,
    ] = _REGISTER_CONTEXT,
) -> _PostConsumeTransactionFailureFinalizer:
    """Call the fixed leaf and mint only from an exact authenticated post-T primary."""

    try:
        session_snapshot = _read_sqlite_cursor_publication_session_snapshot_intrinsic(session)
    except BaseException:
        _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
    if (
        type(connection) is not SQLiteV1BaselineConnectionOwner
        or session_snapshot.lifecycle != "publication-active"
        or session_snapshot.session is not session
        or session_snapshot.connection is not connection
        or session_snapshot.authority is not authority
        or session_snapshot.transaction_generation is not connection._transaction_generation
    ):
        _fail("GE_CURSOR_B3_POSTCONSUME_GRAPH")
    lower_capture, lower_token = (
        _arm_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            connection
        )
    )
    primary: BaseException | None = None
    try:
        try:
            exact_leaf(session)
        except BaseException as error:
            primary = error
        if primary is None:
            _fail("GE_CURSOR_B3_POSTCONSUME_NO_PRIMARY")
        authenticated = _authenticate_exact_post_t_primary_graph(
            connection,
            authority,
            primary,
            _lower_primary_capture=lower_capture,
        )
    finally:
        _reset_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
            lower_capture, lower_token
        )
    context, tombstone, execution, generation, epoch, primary_boundary = authenticated
    if primary_boundary == "native-execute" and not _native_primary(primary):
        _fail("GE_CURSOR_B3_POSTCONSUME_PRIMARY")
    owner = _PostConsumeTransactionFailureFinalizer(
        connection,
        authority,
        context,
        tombstone,
        execution,
        generation,
        primary,
        _CONSTRUCTION_TOKEN,
    )
    state = _FinalizerState(
        id(connection),
        ref(authority),
        ref(context),
        ref(tombstone),
        ref(execution),
        id(generation),
        id(primary),
        epoch,
        primary_boundary,
    )
    try:
        _register_owner_intrinsic(owner, state)
        _register_context_intrinsic(context, owner)
    except BaseException:
        _discard_context_exact(context, owner)
        _discard_owner_exact(owner)
        raise
    return owner


def _make_capture(
    exact_leaf: Callable[[_SQLiteCursorPublicationSession], object],
    implementation: Callable[..., _PostConsumeTransactionFailureFinalizer],
) -> Callable[..., _PostConsumeTransactionFailureFinalizer]:
    """Close capture over the definition-time leaf without an override seam."""

    def capture(
        connection: SQLiteV1BaselineConnectionOwner,
        authority: _SQLiteCursorOuterPublicationAuthority,
        session: _SQLiteCursorPublicationSession,
        _register_owner_intrinsic: Callable[
            [_PostConsumeTransactionFailureFinalizer, _FinalizerState], None
        ] = _REGISTER_OWNER,
        _register_context_intrinsic: Callable[
            [
                _SQLiteCursorPublicationRebindContext,
                _PostConsumeTransactionFailureFinalizer,
            ],
            None,
        ] = _REGISTER_CONTEXT,
    ) -> _PostConsumeTransactionFailureFinalizer:
        return implementation(
            exact_leaf,
            connection,
            authority,
            session,
            _register_owner_intrinsic,
            _register_context_intrinsic,
        )

    return capture


_capture_sqlite_cursor_postconsume_transaction_failure_finalizer_intrinsic = _make_capture(
    _execute_sqlite_cursor_publication_rebind_rule11_intrinsic, _capture_implementation
)


def _weak_fault(error: BaseException) -> ReferenceType[BaseException]:
    if not isinstance(error, BaseException):
        _fail("GE_CURSOR_B3_POSTCONSUME_FAULT")
    try:
        return cast(ReferenceType[BaseException], ref(error))
    except TypeError:
        _fail("GE_CURSOR_B3_POSTCONSUME_FAULT")


def _arm_sqlite_cursor_postconsume_after_native_return_fault_for_test_intrinsic(
    owner: _PostConsumeTransactionFailureFinalizer,
    operation: Literal["rollback", "close"],
    error: BaseException,
) -> None:
    state = _state(owner)
    fault_ref = _weak_fault(error)
    if state.lifecycle != "prepared":
        _fail("GE_CURSOR_B3_POSTCONSUME_FAULT")
    if operation == "rollback" and state.rollback_fault_ref is None:
        state.rollback_fault_ref = fault_ref
    elif operation == "close" and state.close_fault_ref is None:
        state.close_fault_ref = fault_ref
    else:
        _fail("GE_CURSOR_B3_POSTCONSUME_FAULT")


def _read_sqlite_cursor_postconsume_transaction_failure_finalizer_snapshot_intrinsic(
    owner: _PostConsumeTransactionFailureFinalizer,
) -> _PostConsumeTransactionFailureFinalizerSnapshot:
    state = _state(owner)
    return _PostConsumeTransactionFailureFinalizerSnapshot(
        state.lifecycle,
        state.state_trace,
        state.owner_consume_count,
        state.terminalize_count,
        state.rollback_attempt_count,
        state.rollback_native_return_count,
        state.rollback_after_return_count,
        state.rollback_secondary_count,
        state.close_attempt_count,
        state.close_native_return_count,
        state.close_after_return_count,
        state.close_tertiary_count,
        state.diagnostics,
        state.primary_boundary,
        state.transaction_epoch,
    )


def _clear_owner_presentation(
    owner: _PostConsumeTransactionFailureFinalizer,
) -> None:
    for name in (
        "__connection",
        "__authority",
        "__context",
        "__tombstone",
        "__execution",
        "__generation",
        "__primary",
    ):
        object.__setattr__(
            owner,
            f"_PostConsumeTransactionFailureFinalizer{name}",
            None,
        )


def _finalize_impl(
    owner: _PostConsumeTransactionFailureFinalizer,
) -> BaseException:
    """Finish cleanup, erase graph presentation, and return only the primary."""

    state = _state(owner)
    if state.lifecycle != "prepared" or state.owner_consume_count != 0:
        _fail("GE_CURSOR_B3_POSTCONSUME_REPLAY")
    connection, authority, context, tombstone, execution, generation, primary = _owner_presentation(
        owner
    )
    rollback_fault = state.rollback_fault_ref() if state.rollback_fault_ref is not None else None
    close_fault = state.close_fault_ref() if state.close_fault_ref is not None else None
    if (
        id(connection) != state.connection_id
        or state.authority_ref() is not authority
        or state.context_ref() is not context
        or state.tombstone_ref() is not tombstone
        or state.execution_ref() is not execution
        or id(generation) != state.generation_id
        or id(primary) != state.primary_id
        or (state.rollback_fault_ref is not None and rollback_fault is None)
        or (state.close_fault_ref is not None and close_fault is None)
    ):
        _fail("GE_CURSOR_B3_POSTCONSUME_PRESENTATION")
    selected = _authenticate_exact_post_t_primary_graph(
        connection,
        authority,
        primary,
        _trusted_boundary=state.primary_boundary,
    )
    if selected != (
        context,
        tombstone,
        execution,
        generation,
        state.transaction_epoch,
        state.primary_boundary,
    ):
        _fail("GE_CURSOR_B3_POSTCONSUME_PRESENTATION")
    if state.primary_boundary == "native-execute" and not _native_primary(primary):
        _fail("GE_CURSOR_B3_POSTCONSUME_PRIMARY")

    state.lifecycle = "finalizing"
    state.state_trace = ("prepared", "finalizing")
    state.owner_consume_count = 1
    state.terminalize_count = 1
    state.rollback_attempt_count = 1
    try:
        _OWNER_ROLLBACK(connection)
        state.rollback_native_return_count = 1
        if rollback_fault is not None:
            state.rollback_after_return_count = 1
            state.rollback_secondary_count = 1
            state.diagnostics += (_ROLLBACK_DIAGNOSTIC,)
    except BaseException:
        state.rollback_secondary_count = 1
    finally:
        state.close_attempt_count = 1
        try:
            _OWNER_CLOSE(connection)
            state.close_native_return_count = 1
            if close_fault is not None:
                state.close_after_return_count = 1
                state.close_tertiary_count = 1
                state.diagnostics += (_CLOSE_DIAGNOSTIC,)
        except BaseException:
            state.close_tertiary_count = 1
    state.lifecycle = "finalized"
    state.state_trace = ("prepared", "finalizing", "finalized")
    _clear_owner_presentation(owner)
    return primary.with_traceback(None)


def _finalize_sqlite_cursor_postconsume_transaction_failure_intrinsic(
    owner: _PostConsumeTransactionFailureFinalizer,
) -> Never:
    """Consume/terminalize, real rollback once, real close once, rethrow primary."""

    primary = _finalize_impl(owner)
    raise primary from None
