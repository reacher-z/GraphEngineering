"""Package-private SQLite publication transaction owner (P9 BEGIN tranche)."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Literal, NamedTuple, Never, cast
from weakref import ReferenceType, ref

from .sqlite_cursor_publication_native_projection_bridge import (
    _install_sqlite_cursor_publication_native_projection_bridge_intrinsic,
)
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

_CONSTRUCTION_TOKEN = object()
_TYPE = type
_ISINSTANCE = isinstance
_OBJECT_GETATTRIBUTE = object.__getattribute__
_OBJECT_SETATTR = object.__setattr__

GUARDED_TRANSACTION_CONTROL_PATHS = (
    "connection-commit-method",
    "connection-rollback-method",
    "execute-COMMIT-or-END",
    "execute-ROLLBACK",
    "execute-BEGIN",
    "execute-SAVEPOINT-or-RELEASE-or-ROLLBACK-TO",
    "multi-statement-exec-containing-transaction-control",
    "prepared-statement-containing-transaction-control",
    "script-containing-implicit-or-explicit-transaction-control",
    "nested-BEGIN",
    "close-live-guarded-transaction",
    "newly-prepared-permanent-DML-after-pre-retirement",
    "already-prepared-permanent-DML-after-pre-retirement",
    "newly-prepared-permanent-DDL-after-pre-retirement",
    "already-prepared-permanent-DDL-after-pre-retirement",
    "persistent-PRAGMA-including-user-version-or-application-id",
    "VACUUM-ANALYZE-or-REINDEX",
    "ATTACH-DETACH-or-connection-topology-change",
    "any-other-permanent-state-mutation-or-transaction-proof-history-change",
)


def _fail(code: str) -> Never:
    raise ValueError(code)


class _SQLiteCursorPublicationTransactionLineage:
    __slots__ = ("__weakref__",)


class _SQLiteCursorPublicationTransactionGeneration:
    __slots__ = ("__promoted", "__tombstoned", "__weakref__")

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_TX_OWNER_GENERATION")
        self.__promoted = False
        self.__tombstoned = False

    def _promote(self) -> None:
        if self.__promoted or self.__tombstoned:
            _fail("GE_SQLITE_TX_OWNER_GENERATION_REPLAY")
        self.__promoted = True

    def _tombstone(self) -> None:
        if self.__tombstoned:
            return
        self.__tombstoned = True


class _SQLiteCursorPublicationBeginReceipt:
    __slots__ = (
        "__connection",
        "__epoch",
        "__generation",
        "__lineage",
        "__mode",
        "__owner",
        "__temp_mutation_epoch",
        "__total_changes",
        "__weakref__",
    )

    def __init__(
        self,
        owner: _SQLiteCursorPublicationTransactionOwner,
        connection: SQLiteV1BaselineConnectionOwner,
        lineage: _SQLiteCursorPublicationTransactionLineage,
        generation: _SQLiteCursorPublicationTransactionGeneration,
        epoch: int,
        total_changes: int,
        temp_mutation_epoch: int,
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_TX_OWNER_BEGIN_RECEIPT")
        self.__owner: _SQLiteCursorPublicationTransactionOwner | None = owner
        self.__connection: SQLiteV1BaselineConnectionOwner | None = connection
        self.__lineage: _SQLiteCursorPublicationTransactionLineage | None = lineage
        self.__generation: _SQLiteCursorPublicationTransactionGeneration | None = generation
        self.__mode: Literal["exclusive"] | None = "exclusive"
        self.__epoch = epoch
        self.__total_changes = total_changes
        self.__temp_mutation_epoch = temp_mutation_epoch

    def _clear(self) -> None:
        self.__owner = None
        self.__connection = None
        self.__lineage = None
        self.__generation = None
        self.__mode = None


class _SQLiteCursorPublicationAuthenticatedFailure(BaseException):
    __slots__ = ("__owner", "__weakref__")

    def __init__(self, owner: _SQLiteCursorPublicationTransactionOwner, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_TX_OWNER_PRIMARY")
        self.__owner: _SQLiteCursorPublicationTransactionOwner | None = owner
        super().__init__("GE_SQLITE_TX_OWNER_AUTHENTICATED_FAILURE")

    def _clear(self) -> None:
        self.__owner = None


class _SQLiteCursorPublicationTransactionFailureCapture:
    """Opaque one-shot binding of an active owner to the original primary."""

    __slots__ = (
        "__connection",
        "__generation",
        "__lineage",
        "__ordinal",
        "__owner",
        "__primary",
        "__source_fingerprint",
        "__weakref__",
    )

    def __init__(
        self,
        owner: _SQLiteCursorPublicationTransactionOwner,
        primary: BaseException,
        connection: SQLiteV1BaselineConnectionOwner,
        lineage: _SQLiteCursorPublicationTransactionLineage,
        generation: _SQLiteCursorPublicationTransactionGeneration,
        ordinal: int,
        source_fingerprint: tuple[object, ...],
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_TX_OWNER_FAILURE_CAPTURE")
        self.__owner: _SQLiteCursorPublicationTransactionOwner | None = owner
        self.__primary: BaseException | None = primary
        self.__connection: SQLiteV1BaselineConnectionOwner | None = connection
        self.__lineage: _SQLiteCursorPublicationTransactionLineage | None = lineage
        self.__generation: _SQLiteCursorPublicationTransactionGeneration | None = generation
        self.__ordinal = ordinal
        self.__source_fingerprint: tuple[object, ...] | None = source_fingerprint

    def _clear(self) -> None:
        self.__owner = None
        self.__primary = None
        self.__connection = None
        self.__lineage = None
        self.__generation = None
        self.__source_fingerprint = None


class _SQLiteCursorPublicationTransactionOwner:
    __slots__ = (
        "__connection",
        "__failure_capture",
        "__generation",
        "__lineage",
        "__primary",
        "__receipt",
        "__source_fingerprint",
        "__weakref__",
    )

    def __init__(
        self,
        connection: SQLiteV1BaselineConnectionOwner,
        lineage: _SQLiteCursorPublicationTransactionLineage,
        generation: _SQLiteCursorPublicationTransactionGeneration,
        token: object,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_SQLITE_TX_OWNER_CONSTRUCTION")
        self.__connection: SQLiteV1BaselineConnectionOwner | None = connection
        self.__failure_capture: _SQLiteCursorPublicationTransactionFailureCapture | None = None
        self.__lineage: _SQLiteCursorPublicationTransactionLineage | None = lineage
        self.__generation: _SQLiteCursorPublicationTransactionGeneration | None = generation
        self.__receipt: _SQLiteCursorPublicationBeginReceipt | None = None
        self.__primary: _SQLiteCursorPublicationAuthenticatedFailure | None = None
        self.__source_fingerprint: tuple[object, ...] | None = None


class _SQLiteCursorPublicationTransactionOwnerSnapshot(NamedTuple):
    lifecycle: str
    registration_count: int
    provisional_generation_mint_count: int
    provisional_generation_promotion_count: int
    provisional_generation_tombstone_count: int
    begin_attempt_count: int
    begin_native_return_count: int
    begin_receipt_mint_count: int
    rollback_attempt_count: int
    rollback_native_return_count: int
    close_attempt_count: int
    close_native_return_count: int
    reopen_attempt_count: int
    reopen_source_v1_count: int
    runtime_transaction_control_count: int
    commit_attempt_count: int
    commit_hard_disabled: bool
    exact_generation_active: bool
    exact_lineage_selected: bool
    transaction_mode: str | None
    transaction_epoch: int
    total_changes: int
    temp_mutation_epoch: int
    transaction_epoch_advanced_exactly_once_by_owner: bool
    total_changes_unchanged_by_begin: bool
    temp_mutation_epoch_unchanged_by_begin: bool
    guard_rejection_counts: tuple[int, ...]


class _SQLiteCursorPublicationBeginReceiptSnapshot(NamedTuple):
    exact_owner: bool
    exact_connection: bool
    exact_lineage: bool
    exact_generation: bool
    exclusive_mode: bool
    transaction_epoch: int
    total_changes: int
    temp_mutation_epoch: int
    begin_attempt_count: Literal[1]


class _SQLiteCursorPublicationOwnerCompositionAdoptionSnapshot(NamedTuple):
    owner: _SQLiteCursorPublicationTransactionOwner
    begin_receipt: _SQLiteCursorPublicationBeginReceipt
    connection: SQLiteV1BaselineConnectionOwner
    lineage: _SQLiteCursorPublicationTransactionLineage
    generation: _SQLiteCursorPublicationTransactionGeneration
    begin_transaction_epoch: int
    begin_total_changes: int
    begin_temp_mutation_epoch: int
    current_transaction_epoch: int
    current_total_changes: int
    current_temp_mutation_epoch: int


@dataclass(slots=True)
class _State:
    connection_ref: ReferenceType[SQLiteV1BaselineConnectionOwner]
    lineage_ref: ReferenceType[_SQLiteCursorPublicationTransactionLineage]
    generation_ref: ReferenceType[_SQLiteCursorPublicationTransactionGeneration]
    lifecycle: str = "registered"
    registration_count: int = 1
    provisional_generation_mint_count: int = 1
    provisional_generation_promotion_count: int = 0
    provisional_generation_tombstone_count: int = 0
    begin_attempt_count: int = 0
    begin_native_return_count: int = 0
    begin_receipt_mint_count: int = 0
    rollback_attempt_count: int = 0
    rollback_native_return_count: int = 0
    close_attempt_count: int = 0
    close_native_return_count: int = 0
    reopen_attempt_count: int = 0
    reopen_source_v1_count: int = 0
    runtime_transaction_control_count: int = 0
    commit_attempt_count: int = 0
    transaction_mode: str | None = None
    transaction_epoch: int = 0
    total_changes: int = 0
    temp_mutation_epoch: int = 0
    registration_epoch: int = 0
    registration_total_changes: int = 0
    registration_temp_mutation_epoch: int = 0
    exact_generation_active: bool = False
    exact_lineage_selected: bool = False
    begin_transaction_epoch_advanced_exactly_once: bool = False
    begin_total_changes_unchanged: bool = False
    begin_temp_mutation_epoch_unchanged: bool = False
    guard_rejection_counts: tuple[int, ...] = (0,) * 19
    primary_ref: ReferenceType[_SQLiteCursorPublicationAuthenticatedFailure] | None = None
    failure_capture_ref: ReferenceType[_SQLiteCursorPublicationTransactionFailureCapture] | None = (
        None
    )
    failure_capture_ordinal: int = 0
    composition_pending_ref: ReferenceType[object] | None = None
    composition_ref: ReferenceType[object] | None = None
    source_fingerprint: tuple[object, ...] | None = None


class _Entry(NamedTuple):
    owner_ref: ReferenceType[_SQLiteCursorPublicationTransactionOwner]
    state: _State


_OWNERS: dict[int, _Entry] = {}

_INSTALL_GUARD = SQLiteV1BaselineConnectionOwner._install_publication_transaction_guard
_DISCARD_GUARD = SQLiteV1BaselineConnectionOwner._discard_publication_transaction_guard
_RECOVERABLE = SQLiteV1BaselineConnectionOwner._publication_transaction_recoverable
_BEGIN_EXCLUSIVE = SQLiteV1BaselineConnectionOwner._begin_publication_transaction_exclusive
_OBSERVE = SQLiteV1BaselineConnectionOwner._observe_publication_transaction
_ROLLBACK = SQLiteV1BaselineConnectionOwner._rollback_publication_transaction
_CLOSE = SQLiteV1BaselineConnectionOwner._close_publication_transaction
_SOURCE_FINGERPRINT = SQLiteV1BaselineConnectionOwner._publication_transaction_source_fingerprint
_VALIDATE_SOURCE_V1 = SQLiteV1BaselineConnectionOwner._validate_publication_transaction_source_v1
_VALIDATE_ACTIVE_SOURCE_V1 = (
    SQLiteV1BaselineConnectionOwner._validate_publication_transaction_source_v1_active
)
_REOPEN_FINGERPRINT = (
    SQLiteV1BaselineConnectionOwner._reopen_publication_transaction_source_fingerprint
)


def _state(owner: _SQLiteCursorPublicationTransactionOwner) -> _State:
    if _TYPE(owner) is not _SQLiteCursorPublicationTransactionOwner:
        _fail("GE_SQLITE_TX_OWNER_PRESENTATION")
    entry = _OWNERS.get(id(owner))
    if entry is None or entry.owner_ref() is not owner:
        _fail("GE_SQLITE_TX_OWNER_PRESENTATION")
    return entry.state


def _presentation(
    owner: _SQLiteCursorPublicationTransactionOwner,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    _SQLiteCursorPublicationTransactionLineage,
    _SQLiteCursorPublicationTransactionGeneration,
]:
    try:
        connection = _OBJECT_GETATTRIBUTE(
            owner, "_SQLiteCursorPublicationTransactionOwner__connection"
        )
        lineage = _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__lineage")
        generation = _OBJECT_GETATTRIBUTE(
            owner, "_SQLiteCursorPublicationTransactionOwner__generation"
        )
    except (AttributeError, TypeError):
        _fail("GE_SQLITE_TX_OWNER_PRESENTATION")
    if (
        _TYPE(connection) is not SQLiteV1BaselineConnectionOwner
        or _TYPE(lineage) is not _SQLiteCursorPublicationTransactionLineage
        or _TYPE(generation) is not _SQLiteCursorPublicationTransactionGeneration
    ):
        _fail("GE_SQLITE_TX_OWNER_PRESENTATION")
    return connection, lineage, generation


def _guard_case(operation: str, sql: str | None, lifecycle: str) -> int | None:
    if operation == "commit":
        return 0
    if operation == "rollback":
        return 1
    if operation == "close":
        return 10
    if operation == "executescript":
        return 8
    if operation != "execute" or sql is None:
        return 18
    upper = sql.upper()
    statements = [part for part in upper.split(";") if part.strip()]
    if len(statements) > 1:
        return 6
    words = upper.replace(";", " ").split()
    token = words[0] if words else ""
    if token in {"COMMIT", "END"}:
        return 2
    if token == "ROLLBACK" and "TO" not in words:
        return 3
    if token == "BEGIN":
        return 9 if lifecycle == "active" else 4
    if token in {"SAVEPOINT", "RELEASE"} or (token == "ROLLBACK" and "TO" in words):
        return 5
    if token in {"INSERT", "UPDATE", "DELETE", "REPLACE"}:
        return 11
    if token in {"CREATE", "ALTER", "DROP"}:
        return 13
    if token == "PRAGMA":
        return 15
    if token in {"VACUUM", "ANALYZE", "REINDEX"}:
        return 16
    if token in {"ATTACH", "DETACH"}:
        return 17
    if token == "SELECT":
        return None
    return 18


def _reject_guard(owner: _SQLiteCursorPublicationTransactionOwner, case_index: int) -> Never:
    state = _state(owner)
    if state.lifecycle not in {"registered", "active"} or not 0 <= case_index < len(
        GUARDED_TRANSACTION_CONTROL_PATHS
    ):
        _fail("GE_SQLITE_TX_OWNER_GUARD_STATE")
    counts = list(state.guard_rejection_counts)
    counts[case_index] += 1
    state.guard_rejection_counts = tuple(counts)
    code = (
        "GE_SQLITE_TX_OWNER_COMMIT_HARD_DISABLED"
        if case_index in {0, 2}
        else "GE_SQLITE_TX_OWNER_GUARD"
    )
    _fail(code)


def _guard_callback(
    owner_ref: ReferenceType[_SQLiteCursorPublicationTransactionOwner],
    operation: str,
    sql: str | None,
) -> None:
    owner = owner_ref()
    if owner is None:
        _fail("GE_SQLITE_TX_OWNER_ABANDONED")
    case_index = _guard_case(operation, sql, _state(owner).lifecycle)
    if case_index is not None:
        _reject_guard(owner, case_index)


def _register_sqlite_cursor_publication_transaction_owner_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
) -> _SQLiteCursorPublicationTransactionOwner:
    if _TYPE(connection) is not SQLiteV1BaselineConnectionOwner or not _RECOVERABLE(connection):
        _fail("GE_SQLITE_TX_OWNER_REGISTRATION")
    lineage = _SQLiteCursorPublicationTransactionLineage()
    generation = _SQLiteCursorPublicationTransactionGeneration(_CONSTRUCTION_TOKEN)
    owner = _SQLiteCursorPublicationTransactionOwner(
        connection, lineage, generation, _CONSTRUCTION_TOKEN
    )
    state = _State(ref(connection), ref(lineage), ref(generation))

    # Do not close over owner in either weak callback.
    owner_id = id(owner)

    def discard_exact(dead_ref: ReferenceType[_SQLiteCursorPublicationTransactionOwner]) -> None:
        entry = _OWNERS.get(owner_id)
        if entry is not None and entry.owner_ref is dead_ref:
            _OWNERS.pop(owner_id, None)

    owner_ref = ref(owner, discard_exact)
    _OWNERS[owner_id] = _Entry(owner_ref, state)

    def guard(operation: str, sql: str | None) -> None:
        _guard_callback(owner_ref, operation, sql)

    try:
        _INSTALL_GUARD(connection, owner, guard)
        try:
            _VALIDATE_SOURCE_V1(connection, owner)
        except BaseException as error:
            raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1") from error
        source_fingerprint = _SOURCE_FINGERPRINT(connection, owner)
        _OBJECT_SETATTR(
            owner,
            "_SQLiteCursorPublicationTransactionOwner__source_fingerprint",
            source_fingerprint,
        )
        state.source_fingerprint = source_fingerprint
        state.registration_epoch = connection.transaction_epoch
        state.registration_total_changes = connection.total_changes
        state.registration_temp_mutation_epoch = connection.temp_mutation_epoch
        state.temp_mutation_epoch = state.registration_temp_mutation_epoch
        state.transaction_epoch = state.registration_epoch
        state.total_changes = state.registration_total_changes
    except BaseException:
        _OWNERS.pop(owner_id, None)
        with suppress(BaseException):
            _DISCARD_GUARD(connection, owner)
        raise
    return owner


def _observe(
    owner: _SQLiteCursorPublicationTransactionOwner,
) -> tuple[bool, bool, bool, str | None, int, int, int] | None:
    try:
        connection, lineage, generation = _presentation(owner)
        return _OBSERVE(connection, owner, lineage, generation)
    except BaseException:
        return None


def _close_reopen_source_v1(
    owner: _SQLiteCursorPublicationTransactionOwner,
    *,
    retained_connection: SQLiteV1BaselineConnectionOwner | None = None,
    retained_source_fingerprint: tuple[object, ...] | None = None,
) -> Literal["source-v1", "corrupt", "unavailable"]:
    state = _state(owner)
    state.lifecycle = "awaiting-reopen"
    if retained_connection is None:
        connection, _lineage, _generation = _presentation(owner)
    else:
        connection = retained_connection
    if retained_source_fingerprint is None:
        source_fingerprint = _OBJECT_GETATTRIBUTE(
            owner, "_SQLiteCursorPublicationTransactionOwner__source_fingerprint"
        )
    else:
        source_fingerprint = retained_source_fingerprint
    state.close_attempt_count += 1
    close_returned = False
    try:
        _CLOSE(connection, owner)
        state.close_native_return_count += 1
        close_returned = True
    except BaseException:
        pass
    state.reopen_attempt_count += 1
    try:
        reopened = _REOPEN_FINGERPRINT(connection, owner)
    except (OSError, sqlite3.Error):
        state.lifecycle = "reopen-unavailable"
        return "unavailable"
    except BaseException:
        state.lifecycle = "corrupt"
        return "corrupt"
    finally:
        if close_returned:
            with suppress(BaseException):
                _DISCARD_GUARD(connection, owner)
    reopened_topology = cast(tuple[tuple[object, ...], ...], reopened[5])
    source_v1 = (
        reopened[0:1] == source_fingerprint
        and reopened[1] == (1_195_724_359,)
        and reopened[2] == (1,)
        and reopened[3] == (("ok",),)
        and not reopened[4]
        and tuple(row[1] for row in reopened_topology) in {("main",), ("main", "temp")}
        and not reopened[6]
    )
    if source_v1:
        state.reopen_source_v1_count += 1
        state.lifecycle = "reopen-verified-v1"
        return "source-v1"
    state.lifecycle = "corrupt"
    return "corrupt"


def _raise_reopen_terminal_outcome(
    primary: BaseException,
    classification: Literal["source-v1", "corrupt", "unavailable"],
) -> Never:
    if classification == "source-v1":
        raise primary.with_traceback(None) from None
    code = (
        "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
        if classification == "corrupt"
        else "GE_SQLITE_TX_OWNER_REOPEN_UNAVAILABLE"
    )
    raise ValueError(code) from primary.with_traceback(None)


def _clear_presentation(owner: _SQLiteCursorPublicationTransactionOwner) -> None:
    state = _state(owner)
    receipt = _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__receipt")
    primary = _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__primary")
    failure_capture = _OBJECT_GETATTRIBUTE(
        owner, "_SQLiteCursorPublicationTransactionOwner__failure_capture"
    )
    generation = _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__generation")
    if _TYPE(receipt) is _SQLiteCursorPublicationBeginReceipt:
        receipt._clear()
    if _TYPE(primary) is _SQLiteCursorPublicationAuthenticatedFailure:
        primary._clear()
    if _TYPE(failure_capture) is _SQLiteCursorPublicationTransactionFailureCapture:
        failure_capture._clear()
    if _TYPE(generation) is _SQLiteCursorPublicationTransactionGeneration:
        generation._tombstone()
    state.composition_pending_ref = None
    state.composition_ref = None
    for name in (
        "__connection",
        "__failure_capture",
        "__lineage",
        "__generation",
        "__receipt",
        "__primary",
        "__source_fingerprint",
    ):
        _OBJECT_SETATTR(owner, f"_SQLiteCursorPublicationTransactionOwner{name}", None)


def _begin_sqlite_cursor_publication_transaction_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
) -> _SQLiteCursorPublicationBeginReceipt:
    state = _state(owner)
    if state.lifecycle != "registered" or state.begin_attempt_count != 0:
        _fail("GE_SQLITE_TX_OWNER_BEGIN_REPLAY")
    connection, lineage, generation = _presentation(owner)
    state.lifecycle = "beginning"
    state.begin_attempt_count = 1
    state.runtime_transaction_control_count += 1
    primary: BaseException | None = None
    try:
        _BEGIN_EXCLUSIVE(connection, owner, lineage, generation)
        state.begin_native_return_count = 1
    except BaseException as error:
        primary = error
    observation = _observe(owner)
    if primary is None and observation is not None:
        (
            in_transaction,
            same_lineage,
            same_generation,
            mode,
            epoch,
            total_changes,
            temp_mutation_epoch,
        ) = observation
        state.transaction_epoch = epoch
        state.total_changes = total_changes
        state.temp_mutation_epoch = temp_mutation_epoch
        semantic_source_v1 = False
        try:
            _VALIDATE_ACTIVE_SOURCE_V1(
                connection,
                owner,
                lineage,
                generation,
            )
            current_fingerprint = _SOURCE_FINGERPRINT(connection, owner)
            fingerprint_unchanged = current_fingerprint == _OBJECT_GETATTRIBUTE(
                owner,
                "_SQLiteCursorPublicationTransactionOwner__source_fingerprint",
            )
            semantic_source_v1 = True
        except BaseException:
            fingerprint_unchanged = False
        if (
            in_transaction
            and same_lineage
            and same_generation
            and mode == "exclusive"
            and epoch == state.registration_epoch + 1
            and total_changes == state.registration_total_changes
            and temp_mutation_epoch == state.registration_temp_mutation_epoch
            and semantic_source_v1
            and fingerprint_unchanged
        ):
            generation._promote()
            state.provisional_generation_promotion_count = 1
            state.begin_receipt_mint_count = 1
            state.lifecycle = "active"
            state.exact_generation_active = True
            state.exact_lineage_selected = True
            state.transaction_mode = mode
            state.begin_transaction_epoch_advanced_exactly_once = True
            state.begin_total_changes_unchanged = True
            state.begin_temp_mutation_epoch_unchanged = True
            receipt = _SQLiteCursorPublicationBeginReceipt(
                owner,
                connection,
                lineage,
                generation,
                epoch,
                total_changes,
                temp_mutation_epoch,
                _CONSTRUCTION_TOKEN,
            )
            _OBJECT_SETATTR(owner, "_SQLiteCursorPublicationTransactionOwner__receipt", receipt)
            return receipt
        primary = ValueError("GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT")
        state.lifecycle = "begin-postflight-in-doubt"
    elif primary is None:
        primary = ValueError("GE_SQLITE_TX_OWNER_BEGIN_POSTFLIGHT_UNAVAILABLE")
        state.lifecycle = "begin-postflight-in-doubt"
    else:
        state.lifecycle = "begin-in-doubt"

    generation._tombstone()
    state.provisional_generation_tombstone_count = 1
    if observation is not None:
        (
            in_transaction,
            same_lineage,
            same_generation,
            mode,
            epoch,
            total_changes,
            _temp_mutation_epoch,
        ) = observation
        state.transaction_epoch = epoch
        state.total_changes = total_changes
        state.temp_mutation_epoch = _temp_mutation_epoch
        if in_transaction and same_lineage and same_generation and mode == "exclusive":
            state.lifecycle = "begin-failed-same-generation-active"
            state.rollback_attempt_count = 1
            state.runtime_transaction_control_count += 1
            try:
                _ROLLBACK(connection, owner, lineage, generation)
                state.rollback_native_return_count = 1
                state.transaction_epoch = connection.transaction_epoch
                state.total_changes = connection.total_changes
                state.temp_mutation_epoch = connection.temp_mutation_epoch
            except BaseException:
                pass
    reopen_classification = _close_reopen_source_v1(owner)
    state.exact_generation_active = False
    state.exact_lineage_selected = False
    state.transaction_mode = None
    _clear_presentation(owner)
    state.lifecycle = "finalized"
    assert primary is not None
    _raise_reopen_terminal_outcome(primary, reopen_classification)


def _select_sqlite_cursor_publication_authenticated_failure_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
) -> _SQLiteCursorPublicationAuthenticatedFailure:
    """Select the one exact package-owned active-transaction failure claim."""
    state = _state(owner)
    if (
        state.lifecycle != "active"
        or state.primary_ref is not None
        or state.failure_capture_ref is not None
    ):
        _fail("GE_SQLITE_TX_OWNER_PRIMARY")
    primary = _SQLiteCursorPublicationAuthenticatedFailure(owner, _CONSTRUCTION_TOKEN)
    state.primary_ref = ref(primary)
    _OBJECT_SETATTR(owner, "_SQLiteCursorPublicationTransactionOwner__primary", primary)
    return primary


def _capture_sqlite_cursor_publication_transaction_failure_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    primary: BaseException,
) -> _SQLiteCursorPublicationTransactionFailureCapture:
    """Bind the exact original primary to the exact active transaction once."""

    state = _state(owner)
    if (
        state.lifecycle != "active"
        or not _ISINSTANCE(primary, BaseException)
        or state.primary_ref is not None
        or state.failure_capture_ref is not None
    ):
        _fail("GE_SQLITE_TX_OWNER_FAILURE_CAPTURE")
    try:
        connection, lineage, generation = _presentation(owner)
    except BaseException:
        retained_connection = state.connection_ref()
        retained_lineage = state.lineage_ref()
        retained_generation = state.generation_ref()
        if (
            _TYPE(retained_connection) is not SQLiteV1BaselineConnectionOwner
            or _TYPE(retained_lineage) is not _SQLiteCursorPublicationTransactionLineage
            or _TYPE(retained_generation) is not _SQLiteCursorPublicationTransactionGeneration
        ):
            _fail("GE_SQLITE_TX_OWNER_FAILURE_CAPTURE")
        connection = retained_connection
        lineage = retained_lineage
        generation = retained_generation
    source_fingerprint = state.source_fingerprint
    if _TYPE(source_fingerprint) is not tuple:
        _fail("GE_SQLITE_TX_OWNER_FAILURE_CAPTURE")
    ordinal = state.failure_capture_ordinal + 1
    capture = _SQLiteCursorPublicationTransactionFailureCapture(
        owner,
        primary,
        connection,
        lineage,
        generation,
        ordinal,
        source_fingerprint,
        _CONSTRUCTION_TOKEN,
    )
    state.failure_capture_ordinal = ordinal
    state.failure_capture_ref = ref(capture)
    _OBJECT_SETATTR(
        owner,
        "_SQLiteCursorPublicationTransactionOwner__failure_capture",
        capture,
    )
    return capture


def _prepare_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    receipt: _SQLiteCursorPublicationBeginReceipt,
    composition: object,
) -> _SQLiteCursorPublicationOwnerCompositionAdoptionSnapshot:
    """Authenticate and reserve one exact P9 owner/receipt composition adoption."""

    state = _state(owner)
    if (
        state.lifecycle != "active"
        or _TYPE(receipt) is not _SQLiteCursorPublicationBeginReceipt
        or state.primary_ref is not None
        or state.failure_capture_ref is not None
        or state.composition_pending_ref is not None
        or state.composition_ref is not None
        or _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__receipt")
        is not receipt
    ):
        _fail("GE_SQLITE_P11_COMPOSITION_ADOPTION")
    try:
        composition_ref = ref(composition)
    except TypeError:
        _fail("GE_SQLITE_P11_COMPOSITION_ADOPTION")
    connection, lineage, generation = _presentation(owner)
    receipt_snapshot = _read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
        owner, receipt
    )
    observation = _observe(owner)
    try:
        _VALIDATE_ACTIVE_SOURCE_V1(connection, owner, lineage, generation)
        current_fingerprint = _SOURCE_FINGERPRINT(connection, owner)
    except BaseException as error:
        raise ValueError("GE_SQLITE_P11_COMPOSITION_ADOPTION") from error
    expected_fingerprint = _OBJECT_GETATTRIBUTE(
        owner, "_SQLiteCursorPublicationTransactionOwner__source_fingerprint"
    )
    if (
        observation is None
        or observation[:4] != (True, True, True, "exclusive")
        or observation[4:]
        != (
            state.transaction_epoch,
            state.total_changes,
            state.temp_mutation_epoch,
        )
        or current_fingerprint != expected_fingerprint
        or receipt_snapshot[:5] != (True, True, True, True, True)
        or receipt_snapshot.transaction_epoch != state.transaction_epoch
        or receipt_snapshot.total_changes != state.total_changes
        or receipt_snapshot.temp_mutation_epoch != state.temp_mutation_epoch
    ):
        _fail("GE_SQLITE_P11_COMPOSITION_ADOPTION")
    state.composition_pending_ref = composition_ref
    return _SQLiteCursorPublicationOwnerCompositionAdoptionSnapshot(
        owner,
        receipt,
        connection,
        lineage,
        generation,
        receipt_snapshot.transaction_epoch,
        receipt_snapshot.total_changes,
        receipt_snapshot.temp_mutation_epoch,
        state.transaction_epoch,
        state.total_changes,
        state.temp_mutation_epoch,
    )


def _complete_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    receipt: _SQLiteCursorPublicationBeginReceipt,
    composition: object,
) -> None:
    """Commit the prepared owner adoption as a one-way package-private edge."""

    state = _state(owner)
    if (
        state.lifecycle != "active"
        or state.composition_pending_ref is None
        or state.composition_pending_ref() is not composition
        or state.composition_ref is not None
        or _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__receipt")
        is not receipt
    ):
        _fail("GE_SQLITE_P11_COMPOSITION_ADOPTION")
    state.composition_ref = state.composition_pending_ref
    state.composition_pending_ref = None


def _abort_sqlite_cursor_publication_owner_composition_adoption_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    composition: object,
) -> None:
    """Remove only the exact uncommitted adoption reservation."""

    state = _state(owner)
    if (
        state.composition_pending_ref is not None
        and state.composition_pending_ref() is composition
        and state.composition_ref is None
    ):
        state.composition_pending_ref = None


def _assert_sqlite_cursor_publication_owner_composition_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    receipt: _SQLiteCursorPublicationBeginReceipt,
    composition: object,
) -> _SQLiteCursorPublicationOwnerCompositionAdoptionSnapshot:
    """Reauthenticate the committed P11 composition without minting authority."""

    state = _state(owner)
    if (
        state.lifecycle != "active"
        or state.composition_ref is None
        or state.composition_ref() is not composition
        or _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__receipt")
        is not receipt
    ):
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    connection, lineage, generation = _presentation(owner)
    receipt_snapshot = _read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
        owner, receipt
    )
    observation = _observe(owner)
    if (
        observation is None
        or observation[:4] != (True, True, True, "exclusive")
        or observation[4:]
        != (
            state.transaction_epoch,
            state.total_changes,
            state.temp_mutation_epoch,
        )
    ):
        _fail("GE_SQLITE_P11_COMPOSITION_PRESENTATION")
    return _SQLiteCursorPublicationOwnerCompositionAdoptionSnapshot(
        owner,
        receipt,
        connection,
        lineage,
        generation,
        receipt_snapshot.transaction_epoch,
        receipt_snapshot.total_changes,
        receipt_snapshot.temp_mutation_epoch,
        state.transaction_epoch,
        state.total_changes,
        state.temp_mutation_epoch,
    )


def _finalize_failure_with_original_primary(
    owner: _SQLiteCursorPublicationTransactionOwner,
    primary: BaseException,
    connection: SQLiteV1BaselineConnectionOwner,
    lineage: _SQLiteCursorPublicationTransactionLineage,
    generation: _SQLiteCursorPublicationTransactionGeneration,
    source_fingerprint: tuple[object, ...],
) -> Never:
    """Run the bounded P9 failure partition without guessing rollback authority."""

    state = _state(owner)
    observation = _observe(owner)
    state.lifecycle = "failure-claimed"
    if observation is not None and observation[:4] == (True, True, True, "exclusive"):
        state.rollback_attempt_count = 1
        state.runtime_transaction_control_count += 1
        try:
            _ROLLBACK(connection, owner, lineage, generation)
            state.rollback_native_return_count = 1
            state.lifecycle = "rolled-back"
            state.transaction_epoch = connection.transaction_epoch
            state.total_changes = connection.total_changes
            state.temp_mutation_epoch = connection.temp_mutation_epoch
        except BaseException:
            state.lifecycle = "rollback-failed"
    else:
        state.lifecycle = "rollback-authority-unavailable"
    reopen_classification = _close_reopen_source_v1(
        owner,
        retained_connection=connection,
        retained_source_fingerprint=source_fingerprint,
    )
    state.exact_generation_active = False
    state.exact_lineage_selected = False
    state.transaction_mode = None
    _clear_presentation(owner)
    state.lifecycle = "finalized"
    if reopen_classification == "source-v1":
        raise primary.with_traceback(None) from None
    secondary_code = (
        "GE_SQLITE_TX_OWNER_REOPEN_CORRUPTION"
        if reopen_classification == "corrupt"
        else "GE_SQLITE_TX_OWNER_REOPEN_UNAVAILABLE"
    )
    raise primary.with_traceback(None) from ValueError(secondary_code)


def _finalize_sqlite_cursor_publication_transaction_failure_capture_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    capture: _SQLiteCursorPublicationTransactionFailureCapture,
) -> Never:
    """Consume an exact failure capture and re-raise its original primary."""

    state = _state(owner)
    if (
        state.lifecycle != "active"
        or _TYPE(capture) is not _SQLiteCursorPublicationTransactionFailureCapture
        or state.failure_capture_ref is None
        or state.failure_capture_ref() is not capture
        or _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__failure_capture")
        is not capture
        or _OBJECT_GETATTRIBUTE(capture, "_SQLiteCursorPublicationTransactionFailureCapture__owner")
        is not owner
    ):
        _fail("GE_SQLITE_TX_OWNER_FAILURE_CAPTURE")
    primary = _OBJECT_GETATTRIBUTE(
        capture, "_SQLiteCursorPublicationTransactionFailureCapture__primary"
    )
    connection = _OBJECT_GETATTRIBUTE(
        capture, "_SQLiteCursorPublicationTransactionFailureCapture__connection"
    )
    lineage = _OBJECT_GETATTRIBUTE(
        capture, "_SQLiteCursorPublicationTransactionFailureCapture__lineage"
    )
    generation = _OBJECT_GETATTRIBUTE(
        capture, "_SQLiteCursorPublicationTransactionFailureCapture__generation"
    )
    ordinal = _OBJECT_GETATTRIBUTE(
        capture, "_SQLiteCursorPublicationTransactionFailureCapture__ordinal"
    )
    source_fingerprint = _OBJECT_GETATTRIBUTE(
        capture, "_SQLiteCursorPublicationTransactionFailureCapture__source_fingerprint"
    )
    if (
        not _ISINSTANCE(primary, BaseException)
        or _TYPE(connection) is not SQLiteV1BaselineConnectionOwner
        or _TYPE(lineage) is not _SQLiteCursorPublicationTransactionLineage
        or _TYPE(generation) is not _SQLiteCursorPublicationTransactionGeneration
        or _TYPE(ordinal) is not int
        or ordinal != state.failure_capture_ordinal
        or _TYPE(source_fingerprint) is not tuple
        or state.connection_ref() is not connection
        or state.lineage_ref() is not lineage
        or state.generation_ref() is not generation
        or state.source_fingerprint != source_fingerprint
    ):
        _fail("GE_SQLITE_TX_OWNER_FAILURE_CAPTURE")
    _finalize_failure_with_original_primary(
        owner,
        primary,
        connection,
        lineage,
        generation,
        source_fingerprint,
    )


def _finalize_sqlite_cursor_publication_transaction_failure_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    primary: _SQLiteCursorPublicationAuthenticatedFailure,
) -> Never:
    state = _state(owner)
    if (
        state.lifecycle != "active"
        or state.primary_ref is None
        or state.primary_ref() is not primary
        or _OBJECT_GETATTRIBUTE(primary, "_SQLiteCursorPublicationAuthenticatedFailure__owner")
        is not owner
    ):
        _fail("GE_SQLITE_TX_OWNER_PRIMARY")
    connection, _lineage, generation = _presentation(owner)
    observation = _observe(owner)
    if observation is None or observation[:4] != (True, True, True, "exclusive"):
        _fail("GE_SQLITE_TX_OWNER_FAILURE_AUTHORITY")
    state.lifecycle = "failure-claimed"
    state.rollback_attempt_count = 1
    state.runtime_transaction_control_count += 1
    try:
        _ROLLBACK(connection, owner, _lineage, generation)
        state.rollback_native_return_count = 1
        state.lifecycle = "rolled-back"
        state.transaction_epoch = connection.transaction_epoch
        state.total_changes = connection.total_changes
        state.temp_mutation_epoch = connection.temp_mutation_epoch
    except BaseException:
        state.lifecycle = "rollback-failed"
    reopen_classification = _close_reopen_source_v1(owner)
    state.exact_generation_active = False
    state.exact_lineage_selected = False
    state.transaction_mode = None
    _clear_presentation(owner)
    state.lifecycle = "finalized"
    _raise_reopen_terminal_outcome(primary, reopen_classification)


def _commit_sqlite_cursor_publication_transaction_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    _fence: object,
) -> Never:
    state = _state(owner)
    if state.lifecycle != "active":
        _fail("GE_SQLITE_TX_OWNER_COMMIT_HARD_DISABLED")
    _fail("GE_SQLITE_TX_OWNER_COMMIT_HARD_DISABLED")


def _read_sqlite_cursor_publication_transaction_owner_snapshot_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
) -> _SQLiteCursorPublicationTransactionOwnerSnapshot:
    state = _state(owner)
    return _SQLiteCursorPublicationTransactionOwnerSnapshot(
        state.lifecycle,
        state.registration_count,
        state.provisional_generation_mint_count,
        state.provisional_generation_promotion_count,
        state.provisional_generation_tombstone_count,
        state.begin_attempt_count,
        state.begin_native_return_count,
        state.begin_receipt_mint_count,
        state.rollback_attempt_count,
        state.rollback_native_return_count,
        state.close_attempt_count,
        state.close_native_return_count,
        state.reopen_attempt_count,
        state.reopen_source_v1_count,
        state.runtime_transaction_control_count,
        state.commit_attempt_count,
        True,
        state.exact_generation_active,
        state.exact_lineage_selected,
        state.transaction_mode,
        state.transaction_epoch,
        state.total_changes,
        state.temp_mutation_epoch,
        state.begin_transaction_epoch_advanced_exactly_once,
        state.begin_total_changes_unchanged,
        state.begin_temp_mutation_epoch_unchanged,
        state.guard_rejection_counts,
    )


def _read_sqlite_cursor_publication_begin_receipt_snapshot_intrinsic(
    owner: _SQLiteCursorPublicationTransactionOwner,
    receipt: _SQLiteCursorPublicationBeginReceipt,
) -> _SQLiteCursorPublicationBeginReceiptSnapshot:
    state = _state(owner)
    if (
        state.lifecycle != "active"
        or _TYPE(receipt) is not _SQLiteCursorPublicationBeginReceipt
        or _OBJECT_GETATTRIBUTE(owner, "_SQLiteCursorPublicationTransactionOwner__receipt")
        is not receipt
    ):
        _fail("GE_SQLITE_TX_OWNER_BEGIN_RECEIPT")
    connection, lineage, generation = _presentation(owner)
    return _SQLiteCursorPublicationBeginReceiptSnapshot(
        _OBJECT_GETATTRIBUTE(receipt, "_SQLiteCursorPublicationBeginReceipt__owner") is owner,
        _OBJECT_GETATTRIBUTE(receipt, "_SQLiteCursorPublicationBeginReceipt__connection")
        is connection,
        _OBJECT_GETATTRIBUTE(receipt, "_SQLiteCursorPublicationBeginReceipt__lineage") is lineage,
        _OBJECT_GETATTRIBUTE(receipt, "_SQLiteCursorPublicationBeginReceipt__generation")
        is generation,
        _OBJECT_GETATTRIBUTE(receipt, "_SQLiteCursorPublicationBeginReceipt__mode") == "exclusive",
        _OBJECT_GETATTRIBUTE(receipt, "_SQLiteCursorPublicationBeginReceipt__epoch"),
        _OBJECT_GETATTRIBUTE(receipt, "_SQLiteCursorPublicationBeginReceipt__total_changes"),
        _OBJECT_GETATTRIBUTE(receipt, "_SQLiteCursorPublicationBeginReceipt__temp_mutation_epoch"),
        1,
    )


_install_sqlite_cursor_publication_native_projection_bridge_intrinsic(
    cast(
        Callable[[object, object, object], object],
        _assert_sqlite_cursor_publication_owner_composition_intrinsic,
    ),
)
globals().pop(
    "_install_sqlite_cursor_publication_native_projection_bridge_intrinsic", None
)
