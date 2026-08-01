"""Package-private B3 provider-clock authority; performs no permanent write."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Final, Literal, NoReturn, TypeVar, cast
from weakref import WeakKeyDictionary

from .sqlite_operation_baseline_source import SQLiteV1BaselineConnectionOwner

_OWNER_EXECUTE = SQLiteV1BaselineConnectionOwner.execute

_CONSTRUCTION_TOKEN: Final = object()

ClockBoundary = Literal[
    "before-first-permanent-mutation",
    "before-cursor-rebind",
    "before-verification",
    "before-commit",
]
ClockConsumer = Literal[
    "outer-publication-authority",
    "cursor-publication-session",
    "cursor-clock-capability",
    "final-commit-fence",
]

SQLITE_CURSOR_CLOCK_BOUNDARIES: Final[tuple[ClockBoundary, ...]] = (
    "before-first-permanent-mutation",
    "before-cursor-rebind",
    "before-verification",
    "before-commit",
)
SQLITE_CURSOR_CLOCK_CONSUMERS: Final[dict[ClockBoundary, ClockConsumer]] = {
    "before-first-permanent-mutation": "outer-publication-authority",
    "before-cursor-rebind": "cursor-publication-session",
    "before-verification": "cursor-clock-capability",
    "before-commit": "final-commit-fence",
}


@dataclass(frozen=True, slots=True)
class _MigrationLockIdentity:
    lock_id: str
    owner_id: str
    source_schema_version: Literal[1]
    target_schema_version: Literal[2]
    lock_epoch: int
    fencing_token: int
    active_expires_at_ms: int


@dataclass(frozen=True, slots=True)
class _ClockEvidenceSnapshot:
    boundary: ClockBoundary
    consumer: ClockConsumer
    provider_now_ms: int
    active_expires_at_ms: int
    transaction_generation: object
    transaction_epoch: int


class _ProviderClockSource:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_CLOCK_SOURCE")


class _MigrationLockCapability:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_MIGRATION_LOCK_CAPABILITY")


class _ProviderClockCapability:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_CLOCK_CAPABILITY")


class _ClockEvidence:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_CLOCK_EVIDENCE")


class _ConsumedClockTombstone:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_CLOCK_TOMBSTONE")


@dataclass(frozen=True, slots=True)
class _LockCapabilityState:
    connection: SQLiteV1BaselineConnectionOwner
    expected_lock: _MigrationLockIdentity
    transaction_generation: object


@dataclass(slots=True)
class _ClockCapabilityState:
    connection: SQLiteV1BaselineConnectionOwner
    lock_capability: _MigrationLockCapability
    expected_lock: _MigrationLockIdentity
    source: _ProviderClockSource
    transaction_generation: object
    next_boundary_index: int = 0
    observing: bool = False
    poisoned: bool = False
    previous_evidence: _ClockEvidence | None = None
    previous_provider_now_ms: int | None = None


@dataclass(slots=True)
class _EvidenceState:
    capability: _ProviderClockCapability
    snapshot: _ClockEvidenceSnapshot
    previous_evidence: _ClockEvidence | None
    consumed: bool = False


@dataclass(frozen=True, slots=True)
class _TombstoneState:
    capability: _ProviderClockCapability
    evidence: _ClockEvidence
    consumer: ClockConsumer


_CLOCK_SOURCES: WeakKeyDictionary[_ProviderClockSource, Callable[[], int]] = WeakKeyDictionary()
_LOCK_CAPABILITIES: WeakKeyDictionary[_MigrationLockCapability, _LockCapabilityState] = (
    WeakKeyDictionary()
)
_CLOCK_CAPABILITIES: WeakKeyDictionary[_ProviderClockCapability, _ClockCapabilityState] = (
    WeakKeyDictionary()
)
_EVIDENCE: WeakKeyDictionary[_ClockEvidence, _EvidenceState] = WeakKeyDictionary()
_TOMBSTONES: WeakKeyDictionary[_ConsumedClockTombstone, _TombstoneState] = WeakKeyDictionary()

_Key = TypeVar("_Key", bound=object)
_Value = TypeVar("_Value")


def _fail(code: str) -> NoReturn:
    raise ValueError(code)


def _weak_get(registry: WeakKeyDictionary[_Key, _Value], key: object) -> _Value | None:
    """Reject non-weak-referenceable or otherwise hostile keys as absent."""

    try:
        return registry.get(cast(_Key, key))
    except TypeError:
        return None


def _safe_integer(value: object, minimum: int, code: str) -> int:
    if type(value) is not int or value < minimum or value > 2**53 - 1:
        _fail(code)
    return value


def _identifier(value: object, code: str) -> str:
    if type(value) is not str or not value or "\0" in value:
        _fail(code)
    return value


def _checked_lock(value: _MigrationLockIdentity) -> _MigrationLockIdentity:
    if type(value) is not _MigrationLockIdentity:
        _fail("GE_CURSOR_B3_MIGRATION_LOCK")
    epoch = _safe_integer(value.lock_epoch, 1, "GE_CURSOR_B3_MIGRATION_LOCK")
    fence = _safe_integer(value.fencing_token, 1, "GE_CURSOR_B3_MIGRATION_LOCK")
    if value.source_schema_version != 1 or value.target_schema_version != 2 or epoch != fence:
        _fail("GE_CURSOR_B3_MIGRATION_LOCK")
    return _MigrationLockIdentity(
        lock_id=_identifier(value.lock_id, "GE_CURSOR_B3_MIGRATION_LOCK"),
        owner_id=_identifier(value.owner_id, "GE_CURSOR_B3_MIGRATION_LOCK"),
        source_schema_version=1,
        target_schema_version=2,
        lock_epoch=epoch,
        fencing_token=fence,
        active_expires_at_ms=_safe_integer(
            value.active_expires_at_ms, 0, "GE_CURSOR_B3_MIGRATION_LOCK"
        ),
    )


def _live_lock(connection: SQLiteV1BaselineConnectionOwner) -> _MigrationLockIdentity:
    cursor = _OWNER_EXECUTE(
        connection,
        """
        SELECT active_lock_id, active_owner_id, active_source_version,
               active_target_version, active_lock_epoch, active_fencing_token,
               active_expires_at_ms
          FROM main.ge_cycle_migration_lock
         WHERE singleton = 1
        """,
    )
    try:
        row = cursor.fetchone()
        if row is None or cursor.fetchone() is not None or len(row) != 7:
            _fail("GE_CURSOR_B3_MIGRATION_LOCK")
    finally:
        cursor.close()
    assert row is not None
    return _MigrationLockIdentity(
        lock_id=_identifier(row[0], "GE_CURSOR_B3_MIGRATION_LOCK"),
        owner_id=_identifier(row[1], "GE_CURSOR_B3_MIGRATION_LOCK"),
        source_schema_version=cast(
            Literal[1], _safe_integer(row[2], 1, "GE_CURSOR_B3_MIGRATION_LOCK")
        ),
        target_schema_version=cast(
            Literal[2], _safe_integer(row[3], 2, "GE_CURSOR_B3_MIGRATION_LOCK")
        ),
        lock_epoch=_safe_integer(row[4], 1, "GE_CURSOR_B3_MIGRATION_LOCK"),
        fencing_token=_safe_integer(row[5], 1, "GE_CURSOR_B3_MIGRATION_LOCK"),
        active_expires_at_ms=_safe_integer(row[6], 0, "GE_CURSOR_B3_MIGRATION_LOCK"),
    )


def _require_lineage(connection: SQLiteV1BaselineConnectionOwner, generation: object) -> None:
    if (
        not connection.in_exclusive_transaction
        or connection._transaction_generation is not generation
    ):
        _fail("GE_CURSOR_B3_TRANSACTION_LINEAGE")


def _create_provider_clock_source_intrinsic(
    provider_now: Callable[[], int],
) -> _ProviderClockSource:
    if not callable(provider_now):
        _fail("GE_CURSOR_B3_CLOCK_SOURCE")
    source = _ProviderClockSource(_CONSTRUCTION_TOKEN)
    _CLOCK_SOURCES[source] = provider_now
    return source


def _create_migration_lock_capability_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    expected_lock_value: _MigrationLockIdentity,
) -> _MigrationLockCapability:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _fail("GE_CURSOR_B3_MIGRATION_LOCK_CAPABILITY")
    generation = connection._transaction_generation
    if not connection.in_exclusive_transaction or generation is None:
        _fail("GE_CURSOR_B3_TRANSACTION_LINEAGE")
    expected = _checked_lock(expected_lock_value)
    if _live_lock(connection) != expected:
        _fail("GE_CURSOR_B3_MIGRATION_LOCK")
    capability = _MigrationLockCapability(_CONSTRUCTION_TOKEN)
    _LOCK_CAPABILITIES[capability] = _LockCapabilityState(connection, expected, generation)
    return capability


def _create_provider_clock_capability_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    lock_capability: _MigrationLockCapability,
    source: _ProviderClockSource,
) -> _ProviderClockCapability:
    lock_state = _weak_get(_LOCK_CAPABILITIES, lock_capability)
    if (
        type(connection) is not SQLiteV1BaselineConnectionOwner
        or lock_state is None
        or lock_state.connection is not connection
        or _weak_get(_CLOCK_SOURCES, source) is None
    ):
        _fail("GE_CURSOR_B3_CLOCK_CAPABILITY")
    _require_lineage(connection, lock_state.transaction_generation)
    if _live_lock(connection) != lock_state.expected_lock:
        _fail("GE_CURSOR_B3_MIGRATION_LOCK")
    capability = _ProviderClockCapability(_CONSTRUCTION_TOKEN)
    _CLOCK_CAPABILITIES[capability] = _ClockCapabilityState(
        connection=connection,
        lock_capability=lock_capability,
        expected_lock=lock_state.expected_lock,
        source=source,
        transaction_generation=lock_state.transaction_generation,
    )
    return capability


def _observe_provider_clock_intrinsic(
    capability: _ProviderClockCapability, boundary: ClockBoundary
) -> _ClockEvidence:
    state = _weak_get(_CLOCK_CAPABILITIES, capability)
    if state is None:
        _fail("GE_CURSOR_B3_CLOCK_CAPABILITY")
    if state.poisoned:
        _fail("GE_CURSOR_B3_CLOCK_POISONED")
    if state.observing:
        state.poisoned = True
        _fail("GE_CURSOR_B3_CLOCK_REENTRANT")
    expected_boundary = (
        SQLITE_CURSOR_CLOCK_BOUNDARIES[state.next_boundary_index]
        if state.next_boundary_index < len(SQLITE_CURSOR_CLOCK_BOUNDARIES)
        else None
    )
    if boundary != expected_boundary:
        _fail("GE_CURSOR_B3_CLOCK_ORDER")
    _require_lineage(state.connection, state.transaction_generation)
    epoch_before = state.connection.transaction_epoch
    changes_before = state.connection.total_changes
    lock_before = _live_lock(state.connection)
    if lock_before != state.expected_lock:
        _fail("GE_CURSOR_B3_MIGRATION_LOCK")
    provider_now = _weak_get(_CLOCK_SOURCES, state.source)
    if provider_now is None:
        _fail("GE_CURSOR_B3_CLOCK_SOURCE")
    state.observing = True
    try:
        provider_now_value: object = provider_now()
    except Exception as error:
        state.observing = False
        if state.poisoned:
            raise ValueError("GE_CURSOR_B3_CLOCK_REENTRANT") from error
        state.poisoned = True
        raise ValueError("GE_CURSOR_B3_CLOCK_UNAVAILABLE") from error
    state.observing = False
    if state.poisoned:
        _fail("GE_CURSOR_B3_CLOCK_REENTRANT")
    try:
        if type(provider_now_value) is not int or not 0 <= provider_now_value <= 2**53 - 1:
            _fail("GE_CURSOR_B3_CLOCK_UNAVAILABLE")
        provider_now_ms = provider_now_value
        _require_lineage(state.connection, state.transaction_generation)
        epoch_after = state.connection.transaction_epoch
        changes_after = state.connection.total_changes
        lock_after = _live_lock(state.connection)
        if epoch_after != epoch_before or changes_after != changes_before:
            _fail("GE_CURSOR_B3_CLOCK_SIDE_EFFECT")
        if lock_after != state.expected_lock or lock_after != lock_before:
            _fail("GE_CURSOR_B3_MIGRATION_LOCK")
        if (
            state.previous_provider_now_ms is not None
            and provider_now_ms < state.previous_provider_now_ms
        ):
            _fail("GE_CURSOR_B3_CLOCK_REGRESSION")
        if provider_now_ms >= state.expected_lock.active_expires_at_ms:
            _fail("GE_CURSOR_B3_LOCK_EXPIRED")
        evidence = _ClockEvidence(_CONSTRUCTION_TOKEN)
        snapshot = _ClockEvidenceSnapshot(
            boundary=boundary,
            consumer=SQLITE_CURSOR_CLOCK_CONSUMERS[boundary],
            provider_now_ms=provider_now_ms,
            active_expires_at_ms=state.expected_lock.active_expires_at_ms,
            transaction_generation=state.transaction_generation,
            transaction_epoch=epoch_after,
        )
        _EVIDENCE[evidence] = _EvidenceState(
            capability=capability,
            snapshot=snapshot,
            previous_evidence=state.previous_evidence,
        )
        state.previous_evidence = evidence
        state.previous_provider_now_ms = provider_now_ms
        state.next_boundary_index += 1
        return evidence
    except Exception:
        state.poisoned = True
        raise


def _consume_provider_clock_evidence_intrinsic(
    capability: _ProviderClockCapability,
    evidence: _ClockEvidence,
    consumer: ClockConsumer,
) -> _ConsumedClockTombstone:
    if _weak_get(_CLOCK_CAPABILITIES, capability) is None:
        _fail("GE_CURSOR_B3_CLOCK_CAPABILITY")
    state = _weak_get(_EVIDENCE, evidence)
    if state is None or state.capability is not capability or state.snapshot.consumer != consumer:
        _fail("GE_CURSOR_B3_CLOCK_EVIDENCE")
    if state.consumed:
        _fail("GE_CURSOR_B3_CLOCK_REPLAY")
    state.consumed = True
    tombstone = _ConsumedClockTombstone(_CONSTRUCTION_TOKEN)
    _TOMBSTONES[tombstone] = _TombstoneState(capability, evidence, consumer)
    return tombstone


def _read_clock_evidence_snapshot_intrinsic(
    capability: _ProviderClockCapability, evidence: _ClockEvidence
) -> _ClockEvidenceSnapshot:
    state = _weak_get(_EVIDENCE, evidence)
    if state is None or state.capability is not capability:
        _fail("GE_CURSOR_B3_CLOCK_EVIDENCE")
    return state.snapshot


def _assert_clock_evidence_predecessor_intrinsic(
    capability: _ProviderClockCapability,
    evidence: _ClockEvidence,
    previous_evidence: _ClockEvidence | None,
) -> _ClockEvidence:
    state = _weak_get(_EVIDENCE, evidence)
    if (
        state is None
        or state.capability is not capability
        or state.previous_evidence is not previous_evidence
    ):
        _fail("GE_CURSOR_B3_CLOCK_CHAIN")
    return evidence


def _assert_consumed_clock_tombstone_intrinsic(
    capability: _ProviderClockCapability,
    evidence: _ClockEvidence,
    tombstone: _ConsumedClockTombstone,
    consumer: ClockConsumer,
) -> _ConsumedClockTombstone:
    state = _weak_get(_TOMBSTONES, tombstone)
    if (
        state is None
        or state.capability is not capability
        or state.evidence is not evidence
        or state.consumer != consumer
    ):
        _fail("GE_CURSOR_B3_CLOCK_TOMBSTONE")
    return tombstone
