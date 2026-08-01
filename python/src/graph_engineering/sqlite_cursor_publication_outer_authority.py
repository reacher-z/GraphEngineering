"""Package-private owner of the SQLite cursor initial-publication write lane.

The owner binds and activates the exact completed B2 stage graph, then permits
one fixed, package-owned migration-0002 execution.  It never begins, commits,
rolls back or rebinds the caller-owned transaction.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Literal, NamedTuple, Never, TypeAlias, cast
from weakref import ReferenceType, WeakKeyDictionary, ref

from .sqlite_cursor_publication_clock_authority import (
    _CLOCK_CAPABILITIES,
    _EVIDENCE,
    _LOCK_CAPABILITIES,
    _TOMBSTONES,
    _ClockEvidence,
    _consume_provider_clock_evidence_intrinsic,
    _ConsumedClockTombstone,
    _live_lock,
    _MigrationLockCapability,
    _ProviderClockCapability,
)
from .sqlite_cursor_publication_initial_write_digest import (
    _digest_sqlite_initial_write_parameters_intrinsic,
    _digest_sqlite_initial_write_result_intrinsic,
)
from .sqlite_cursor_publication_migration_0002_asset import (
    SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
    SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
    _load_sqlite_cursor_migration_0002_asset_intrinsic,
    _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic,
    _SQLiteCursorMigration0002Asset,
    _SQLiteCursorMigration0002PreviewManifestIdentity,
)
from .sqlite_cursor_publication_target_catalog import (
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
    _read_target_catalog_observation_intrinsic,
    _read_validated_target_catalog_intrinsic,
    _TargetCatalogSnapshot,
)
from .sqlite_operation_baseline import BaselineProjectionIdentity
from .sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorExactProjectionReference,
    SQLiteCursorPreRebindReceipt,
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
)
from .sqlite_operation_baseline_cursor_stage_ownership import (
    _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic,
    _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic,
    _assert_sqlite_cursor_stage_ownership_pre_rebind_complete_intrinsic,
    _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic,
    _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _SQLiteCursorStageOwnershipOuterPublicationAuthority,
    _SQLiteCursorStageOwnershipOuterPublicationTail,
    _SQLiteCursorStageOwnershipTransfer,
)
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    _begin_sqlite_connection_migration_0002_execution_intrinsic,
    _execute_next_sqlite_connection_migration_0002_statement_intrinsic,
    _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic,
    _SQLiteConnectionMigration0002Execution,
)
from .sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage

_CONSTRUCTION_TOKEN = object()
_MAX_SAFE_INTEGER = 2**53 - 1
_SOURCE_V1_CATALOG_SHA256 = "359cf74f441a201fcae970d77eac460529d9c562ad7a42d20e5224b65b88b2f0"
_SOURCE_V1_CATALOG_ROW_COUNT = 27
_SOURCE_V1_CATALOG_CANONICAL_UTF8_BYTES = 4_504

_SQLiteCursorOuterPublicationAuthority: TypeAlias = (
    _SQLiteCursorStageOwnershipOuterPublicationAuthority
)
_AuthorityLifecycle: TypeAlias = Literal["inactive", "active", "poisoned", "retired"]
_WritePhase: TypeAlias = Literal[
    "ready-0002",
    "executing-0002",
    "0002-complete",
    "post-ddl-catalog-fence",
    "poisoned",
    "retired",
]


class _SQLiteCursorOuterPublicationCancellationSignal:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_OUTER_CANCELLATION")


class _SQLiteCursorOuterPublicationCancellationController:
    __slots__ = ("_signal",)

    def __init__(
        self,
        token: object,
        signal: _SQLiteCursorOuterPublicationCancellationSignal,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_OUTER_CANCELLATION")
        self._signal = signal

    @property
    def signal(self) -> _SQLiteCursorOuterPublicationCancellationSignal:
        return self._signal

    def cancel(self) -> None:
        state = _identity_get(
            _CANCELLATIONS,
            self._signal,
            _SQLiteCursorOuterPublicationCancellationSignal,
        )
        if state is None:
            _fail("GE_CURSOR_B3_OUTER_CANCELLATION")
        cast(_CancellationState, state).cancelled = True


class _SQLiteCursorOuterPublicationLedgerSnapshot(NamedTuple):
    affected_rows_watermark: int
    fixed_statement_count: int
    logical_write_sequence: int


class _SQLiteMigration0002CatalogRebuildReceipt:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_MIGRATION_0002_RECEIPT")


class _SQLiteMigration0002CatalogRebuildReceiptSnapshot(NamedTuple):
    affected_rows: int
    application_id_after: Literal[1_195_724_359]
    application_id_before: Literal[1_195_724_359]
    asset_sha256: str
    asset_utf8_bytes: int
    execute_count: Literal[1]
    fixed_statement_count: Literal[20]
    legacy_operation_copy_row_count: int
    outer_ledger_after: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_before: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_delta: _SQLiteCursorOuterPublicationLedgerSnapshot
    parameter_sha256: str
    post_ddl_catalog_sha256: str
    pre_ddl_catalog_sha256: str
    prepare_count: Literal[20]
    preview_manifest_identity: _SQLiteCursorMigration0002PreviewManifestIdentity
    preview_manifest_sha256: str
    result_sha256: str
    schema_copy_row_count: Literal[1]
    schema_sql_sha256: str
    statement_affected_rows: tuple[int, ...]
    total_changes_after: int
    total_changes_before: int
    total_changes_delta: int
    transaction_epoch_after: int
    transaction_epoch_before: int
    transaction_generation: object
    user_version_after: Literal[2]
    user_version_before: Literal[1]
    write_kind: Literal["migration-0002-catalog-rebuild"]


class _SQLiteCursorPostDdlCatalogFence:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE")


class _SQLiteCursorPostDdlCatalogFenceSnapshot(NamedTuple):
    application_id: Literal[1_195_724_359]
    authority: _SQLiteCursorOuterPublicationAuthority
    catalog_canonical_utf8_bytes: Literal[5_785]
    catalog_digest_domain_utf8: str
    catalog_inventory: tuple[str, ...]
    catalog_query: str
    catalog_query_sha256: str
    catalog_row_count: Literal[34]
    catalog_sha256: str
    connection: SQLiteV1BaselineConnectionOwner
    consumes_any_write_receipt: Literal[False]
    is_final_v2_semantic_proof: Literal[False]
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt
    mint_count: Literal[1]
    outer_ledger_watermark: _SQLiteCursorOuterPublicationLedgerSnapshot
    proof_scope: Literal["post-0002-physical-target-catalog-before-baseline-publication"]
    total_changes_watermark: int
    transaction_epoch: int
    transaction_generation: object
    user_version: Literal[2]


class _SQLiteCursorOuterPublicationAuthoritySnapshot(NamedTuple):
    lifecycle: _AuthorityLifecycle
    stage_ownership_poison_reason: str | None
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    receipt: SQLiteCursorPreRebindReceipt
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    transfer: _SQLiteCursorStageOwnershipTransfer
    migration_lock_capability: _MigrationLockCapability
    provider_clock_capability: _ProviderClockCapability
    outer_clock_evidence: _ClockEvidence
    outer_clock_consumed_tombstone: _ConsumedClockTombstone | None
    transaction_generation: object
    transaction_epoch_at_preparation: int
    total_changes_at_preparation: int
    outer_ledger: _SQLiteCursorOuterPublicationLedgerSnapshot
    source_descriptor_hash: str
    source_schema_identity_sha256: str
    outer_provider_now_ms: int
    source_schema_version: Literal[1]
    target_schema_version: Literal[2]
    activation_count: Literal[0, 1]
    migration_0002_logical_execution_count: Literal[0, 1]
    migration_0002_prepared_statement_count: int
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt | None
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence | None
    post_ddl_catalog_fence_mint_count: Literal[0, 1]
    write_phase: _WritePhase


@dataclass(slots=True)
class _CancellationState:
    cancelled: bool = False


@dataclass(slots=True)
class _AuthorityState:
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    receipt: SQLiteCursorPreRebindReceipt
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    transfer: _SQLiteCursorStageOwnershipTransfer
    migration_lock_capability: _MigrationLockCapability
    provider_clock_capability: _ProviderClockCapability
    outer_clock_evidence: _ClockEvidence
    outer_publication_tail: _SQLiteCursorStageOwnershipOuterPublicationTail
    transaction_generation: object
    transaction_epoch_at_preparation: int
    total_changes_at_preparation: int
    source_descriptor_hash: str
    source_schema_identity_sha256: str
    outer_provider_now_ms: int
    lifecycle: _AuthorityLifecycle = "inactive"
    stage_ownership_poison_reason: str | None = None
    outer_clock_consumed_tombstone: _ConsumedClockTombstone | None = None
    current_transaction_epoch: int = 0
    current_total_changes: int = 0
    activation_count: Literal[0, 1] = 0
    affected_rows_watermark: int = 0
    fixed_statement_count: int = 0
    logical_write_sequence: int = 0
    migration_0002_logical_execution_count: Literal[0, 1] = 0
    migration_0002_prepared_statement_count: int = 0
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt | None = None
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence | None = None
    post_ddl_catalog_fence_mint_count: Literal[0, 1] = 0
    write_phase: _WritePhase = "ready-0002"


@dataclass(frozen=True, slots=True)
class _Migration0002ReceiptRecord:
    asset: _SQLiteCursorMigration0002Asset
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]
    connection: SQLiteV1BaselineConnectionOwner
    post_ddl_catalog: _TargetCatalogSnapshot
    pre_ddl_catalog: _TargetCatalogSnapshot
    snapshot: _SQLiteMigration0002CatalogRebuildReceiptSnapshot


@dataclass(frozen=True, slots=True)
class _PostDdlCatalogFenceRecord:
    authority_id: int
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]
    catalog_application_id: int
    catalog_canonical_utf8_bytes: int
    catalog_inventory: tuple[str, ...]
    catalog_row_count: int
    catalog_sha256: str
    catalog_user_version: int
    migration_0002_receipt_id: int
    migration_0002_receipt_ref: ReferenceType[_SQLiteMigration0002CatalogRebuildReceipt]
    outer_ledger_watermark: _SQLiteCursorOuterPublicationLedgerSnapshot
    total_changes_watermark: int
    transaction_epoch: int
    transaction_generation: object


class _IdentityEntry(NamedTuple):
    key_ref: ReferenceType[object]
    value: object


class _AuthorityLink(NamedTuple):
    key_ref: ReferenceType[object]
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]


_CANCELLATIONS: dict[int, _IdentityEntry] = {}
_AUTHORITIES: dict[int, _IdentityEntry] = {}
_AUTHORITY_BY_EVIDENCE: dict[int, _AuthorityLink] = {}
_AUTHORITY_BY_TRANSFER: dict[int, _AuthorityLink] = {}
_MIGRATION_0002_RECEIPTS: dict[int, _IdentityEntry] = {}
_POST_DDL_CATALOG_FENCES: dict[int, _IdentityEntry] = {}

# Capture every replaceable dependency before any caller can alter its module or
# class attribute.  Registry lookup below also checks the weak referent with
# ``is`` so equality and hash hooks are never authority.
_ID = id
_REF = ref
_DICT_GET = dict.get
_DICT_SETITEM = dict.__setitem__
_DICT_POP = dict.pop
_WEAK_KEY_GET = WeakKeyDictionary.get
_RECEIPT_PROVENANCE = assert_sqlite_cursor_pre_rebind_receipt_provenance
_OWNERSHIP_ASSERT_COMPLETE = _assert_sqlite_cursor_stage_ownership_pre_rebind_complete_intrinsic
_OWNERSHIP_MINT_OUTER = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic
_OWNERSHIP_ASSERT_PREPARED = (
    _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic
)
_OWNERSHIP_PUBLISH_OUTER = _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic
_OWNERSHIP_ASSERT_OWNED = _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic
_OWNERSHIP_RETIRE = _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic
_OWNERSHIP_POISON = _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic
_CONSUME_CLOCK = _consume_provider_clock_evidence_intrinsic
_LIVE_LOCK = _live_lock
_OWNER_EPOCH = cast(
    "Callable[[SQLiteV1BaselineConnectionOwner], int]",
    cast("property", SQLiteV1BaselineConnectionOwner.__dict__["transaction_epoch"]).fget,
)
_OWNER_TOTAL_CHANGES = cast(
    "Callable[[SQLiteV1BaselineConnectionOwner], int]",
    cast("property", SQLiteV1BaselineConnectionOwner.__dict__["total_changes"]).fget,
)
_OWNER_EXCLUSIVE = cast(
    "Callable[[SQLiteV1BaselineConnectionOwner], bool]",
    cast("property", SQLiteV1BaselineConnectionOwner.__dict__["in_exclusive_transaction"]).fget,
)
_OWNER_GENERATION = cast(
    "Callable[[SQLiteV1BaselineConnectionOwner], object | None]",
    cast("property", SQLiteV1BaselineConnectionOwner.__dict__["_transaction_generation"]).fget,
)
_LOAD_MIGRATION_0002_ASSET = _load_sqlite_cursor_migration_0002_asset_intrinsic
_READ_MIGRATION_0002_ASSET = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic
_READ_TARGET_CATALOG = _read_target_catalog_observation_intrinsic
_READ_VALIDATED_TARGET_CATALOG = _read_validated_target_catalog_intrinsic
_BEGIN_MIGRATION_0002 = _begin_sqlite_connection_migration_0002_execution_intrinsic
_EXECUTE_NEXT_MIGRATION_0002 = _execute_next_sqlite_connection_migration_0002_statement_intrinsic
_READ_MIGRATION_0002_PROGRESS = _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic
_DIGEST_INITIAL_WRITE_PARAMETERS = _digest_sqlite_initial_write_parameters_intrinsic
_DIGEST_INITIAL_WRITE_RESULT = _digest_sqlite_initial_write_result_intrinsic
_SQLITE_PROGRAMMING_ERROR = sqlite3.ProgrammingError


def _fail(code: str) -> Never:
    raise ValueError(code)


def _retire_dead_entry(
    registry: dict[int, _IdentityEntry],
    key: int,
    dead: ReferenceType[object],
) -> None:
    current = _DICT_GET(registry, key)
    if current is not None and current.key_ref is dead:
        _DICT_POP(registry, key, None)


def _identity_set(registry: dict[int, _IdentityEntry], key: object, value: object) -> None:
    key_id = _ID(key)

    def retire(dead: ReferenceType[object]) -> None:
        _retire_dead_entry(registry, key_id, dead)

    key_ref = _REF(key, retire)
    _DICT_SETITEM(registry, key_id, _IdentityEntry(key_ref, value))


def _identity_get(
    registry: dict[int, _IdentityEntry],
    key: object,
    exact_type: type[object],
) -> object | None:
    if type(key) is not exact_type:
        return None
    entry = _DICT_GET(registry, _ID(key))
    return entry.value if entry is not None and entry.key_ref() is key else None


def _retire_dead_link(
    registry: dict[int, _AuthorityLink],
    key: int,
    dead: ReferenceType[object],
) -> None:
    current = _DICT_GET(registry, key)
    if current is not None and (current.key_ref is dead or current.authority_ref is dead):
        _DICT_POP(registry, key, None)


def _link_set(
    registry: dict[int, _AuthorityLink],
    key: object,
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> None:
    key_id = _ID(key)

    def retire_key(dead: ReferenceType[object]) -> None:
        _retire_dead_link(registry, key_id, dead)

    def retire_authority(
        dead: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority],
    ) -> None:
        _retire_dead_link(registry, key_id, cast(ReferenceType[object], dead))

    key_ref = _REF(key, retire_key)
    authority_ref = _REF(authority, retire_authority)
    _DICT_SETITEM(registry, key_id, _AuthorityLink(key_ref, authority_ref))


def _link_get(
    registry: dict[int, _AuthorityLink],
    key: object,
    exact_type: type[object],
) -> _SQLiteCursorOuterPublicationAuthority | None:
    if type(key) is not exact_type:
        return None
    entry = _DICT_GET(registry, _ID(key))
    if entry is None or entry.key_ref() is not key:
        return None
    return entry.authority_ref()


def _authority_state(authority: object) -> _AuthorityState:
    state = _identity_get(
        _AUTHORITIES,
        authority,
        _SQLiteCursorStageOwnershipOuterPublicationAuthority,
    )
    if state is None:
        _fail("GE_CURSOR_B3_OUTER_AUTHORITY")
    return cast(_AuthorityState, state)


def _clock_graph(
    connection: SQLiteV1BaselineConnectionOwner,
    migration_lock_capability: _MigrationLockCapability,
    provider_clock_capability: _ProviderClockCapability,
    outer_clock_evidence: _ClockEvidence,
) -> tuple[object, int, int]:
    if (
        type(migration_lock_capability) is not _MigrationLockCapability
        or type(provider_clock_capability) is not _ProviderClockCapability
        or type(outer_clock_evidence) is not _ClockEvidence
    ):
        _fail("GE_CURSOR_B3_OUTER_CLOCK_GRAPH")
    lock_state = _WEAK_KEY_GET(_LOCK_CAPABILITIES, migration_lock_capability)
    clock_state = _WEAK_KEY_GET(_CLOCK_CAPABILITIES, provider_clock_capability)
    evidence_state = _WEAK_KEY_GET(_EVIDENCE, outer_clock_evidence)
    if (
        lock_state is None
        or clock_state is None
        or evidence_state is None
        or lock_state.connection is not connection
        or clock_state.connection is not connection
        or clock_state.lock_capability is not migration_lock_capability
        or clock_state.expected_lock is not lock_state.expected_lock
        or evidence_state.capability is not provider_clock_capability
        or evidence_state.consumed
        or evidence_state.previous_evidence is not None
        or evidence_state.snapshot.boundary != "before-first-permanent-mutation"
        or evidence_state.snapshot.consumer != "outer-publication-authority"
        or evidence_state.snapshot.transaction_generation is not lock_state.transaction_generation
        or clock_state.transaction_generation is not lock_state.transaction_generation
        or clock_state.poisoned
        or clock_state.previous_evidence is not outer_clock_evidence
        or clock_state.previous_provider_now_ms != evidence_state.snapshot.provider_now_ms
        or clock_state.next_boundary_index != 1
        or _LIVE_LOCK(connection) != lock_state.expected_lock
    ):
        _fail("GE_CURSOR_B3_OUTER_CLOCK_GRAPH")
    return (
        lock_state.transaction_generation,
        evidence_state.snapshot.provider_now_ms,
        evidence_state.snapshot.transaction_epoch,
    )


def _active_clock_graph(state: _AuthorityState) -> object:
    tombstone = state.outer_clock_consumed_tombstone
    if type(tombstone) is not _ConsumedClockTombstone:
        _fail("GE_CURSOR_B3_OUTER_CLOCK_GRAPH")
    lock_state = _WEAK_KEY_GET(_LOCK_CAPABILITIES, state.migration_lock_capability)
    clock_state = _WEAK_KEY_GET(_CLOCK_CAPABILITIES, state.provider_clock_capability)
    evidence_state = _WEAK_KEY_GET(_EVIDENCE, state.outer_clock_evidence)
    tombstone_state = _WEAK_KEY_GET(_TOMBSTONES, tombstone)
    if (
        lock_state is None
        or clock_state is None
        or evidence_state is None
        or tombstone_state is None
        or lock_state.connection is not state.connection
        or clock_state.connection is not state.connection
        or clock_state.lock_capability is not state.migration_lock_capability
        or clock_state.expected_lock is not lock_state.expected_lock
        or clock_state.poisoned
        or clock_state.transaction_generation is not state.transaction_generation
        or evidence_state.capability is not state.provider_clock_capability
        or not evidence_state.consumed
        or evidence_state.previous_evidence is not None
        or evidence_state.snapshot.boundary != "before-first-permanent-mutation"
        or evidence_state.snapshot.consumer != "outer-publication-authority"
        or evidence_state.snapshot.transaction_generation is not state.transaction_generation
        or evidence_state.snapshot.transaction_epoch != state.transaction_epoch_at_preparation
        or evidence_state.snapshot.provider_now_ms != state.outer_provider_now_ms
        or tombstone_state.capability is not state.provider_clock_capability
        or tombstone_state.evidence is not state.outer_clock_evidence
        or tombstone_state.consumer != "outer-publication-authority"
        or _LIVE_LOCK(state.connection) != lock_state.expected_lock
    ):
        _fail("GE_CURSOR_B3_OUTER_CLOCK_GRAPH")
    return lock_state.transaction_generation


def _owner_snapshot(connection: SQLiteV1BaselineConnectionOwner) -> tuple[object, int, int]:
    generation = _OWNER_GENERATION(connection)
    epoch = _OWNER_EPOCH(connection)
    total_changes = _OWNER_TOTAL_CHANGES(connection)
    if (
        not _OWNER_EXCLUSIVE(connection)
        or generation is None
        or type(epoch) is not int
        or epoch < 0
        or type(total_changes) is not int
        or not 0 <= total_changes <= _MAX_SAFE_INTEGER
    ):
        _fail("GE_CURSOR_B3_OUTER_STALE_FENCE")
    return generation, epoch, total_changes


def _same_graph(
    state: _AuthorityState,
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
    migration_lock_capability: _MigrationLockCapability,
    provider_clock_capability: _ProviderClockCapability,
    outer_clock_evidence: _ClockEvidence,
) -> bool:
    return (
        state.connection is connection
        and state.stage is stage
        and state.receipt is receipt
        and state.projection_identity is projection_identity
        and state.transfer is transfer
        and state.migration_lock_capability is migration_lock_capability
        and state.provider_clock_capability is provider_clock_capability
        and state.outer_clock_evidence is outer_clock_evidence
    )


def _poison(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
    reason: str,
) -> None:
    if state.lifecycle in {"poisoned", "retired"}:
        return
    state.lifecycle = "poisoned"
    state.write_phase = "poisoned"
    state.stage_ownership_poison_reason = reason
    with suppress(BaseException):
        _OWNERSHIP_POISON(state.transfer, authority, reason)


def _retire(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> None:
    if state.lifecycle in {"poisoned", "retired"}:
        return
    state.lifecycle = "retired"
    state.write_phase = "retired"
    with suppress(BaseException):
        _OWNERSHIP_RETIRE(state.transfer, authority)


def _revalidate_inactive(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> None:
    try:
        generation, epoch, changes = _owner_snapshot(state.connection)
        if generation is not state.transaction_generation:
            _fail("GE_CURSOR_B3_OUTER_STALE_FENCE")
        if epoch != state.current_transaction_epoch or changes != state.current_total_changes:
            _fail("GE_CURSOR_B3_OUTER_LEDGER_DRIFT")
        clock_generation, provider_now_ms, clock_epoch = _clock_graph(
            state.connection,
            state.migration_lock_capability,
            state.provider_clock_capability,
            state.outer_clock_evidence,
        )
        if (
            clock_generation is not generation
            or clock_epoch != epoch
            or provider_now_ms != state.outer_provider_now_ms
        ):
            _fail("GE_CURSOR_B3_OUTER_STALE_FENCE")
        _OWNERSHIP_ASSERT_PREPARED(
            state.connection,
            state.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            authority,
            state.outer_publication_tail,
        )
    except BaseException as error:
        if isinstance(error, ValueError) and str(error) == "GE_CURSOR_B3_OUTER_STALE_FENCE":
            _retire(state, authority)
        else:
            _poison(state, authority, "SQLite outer publication invariant failed")
        raise


def _create_sqlite_cursor_outer_publication_cancellation_controller_intrinsic() -> (
    _SQLiteCursorOuterPublicationCancellationController
):
    signal = _SQLiteCursorOuterPublicationCancellationSignal(_CONSTRUCTION_TOKEN)
    _identity_set(_CANCELLATIONS, signal, _CancellationState())
    return _SQLiteCursorOuterPublicationCancellationController(_CONSTRUCTION_TOKEN, signal)


def _prepare_sqlite_cursor_outer_publication_authority_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
    receipt: SQLiteCursorPreRebindReceipt,
    projection_identity: BaselineProjectionIdentity,
    transfer: _SQLiteCursorStageOwnershipTransfer,
    migration_lock_capability: _MigrationLockCapability,
    provider_clock_capability: _ProviderClockCapability,
    outer_clock_evidence: _ClockEvidence,
) -> _SQLiteCursorOuterPublicationAuthority:
    provenance = _RECEIPT_PROVENANCE(receipt)
    if provenance.projection_identity is not projection_identity:
        _fail("GE_CURSOR_B3_OUTER_PROJECTION")

    existing_by_evidence = _link_get(_AUTHORITY_BY_EVIDENCE, outer_clock_evidence, _ClockEvidence)
    existing_by_transfer = _link_get(
        _AUTHORITY_BY_TRANSFER, transfer, _SQLiteCursorStageOwnershipTransfer
    )
    if existing_by_evidence is not None or existing_by_transfer is not None:
        if existing_by_evidence is None or existing_by_evidence is not existing_by_transfer:
            _fail("GE_CURSOR_B3_OUTER_SUBSTITUTION")
        state = _authority_state(existing_by_evidence)
        if state.lifecycle != "inactive" or not _same_graph(
            state,
            connection,
            stage,
            receipt,
            projection_identity,
            transfer,
            migration_lock_capability,
            provider_clock_capability,
            outer_clock_evidence,
        ):
            _fail("GE_CURSOR_B3_OUTER_REUSE")
        _revalidate_inactive(state, existing_by_evidence)
        return existing_by_evidence

    _OWNERSHIP_ASSERT_COMPLETE(connection, stage, receipt, projection_identity, transfer)
    clock_generation, outer_provider_now_ms, clock_epoch = _clock_graph(
        connection,
        migration_lock_capability,
        provider_clock_capability,
        outer_clock_evidence,
    )
    generation, epoch, changes = _owner_snapshot(connection)
    if generation is not clock_generation or epoch != clock_epoch:
        _fail("GE_CURSOR_B3_OUTER_STALE_FENCE")
    mint = _OWNERSHIP_MINT_OUTER(connection, stage, receipt, projection_identity, transfer)
    authority = mint.authority
    seal = provenance.immutable_seal_receipt
    state = _AuthorityState(
        connection=connection,
        stage=stage,
        receipt=receipt,
        projection_identity=projection_identity,
        projection_reference=provenance.projection_reference,
        transfer=transfer,
        migration_lock_capability=migration_lock_capability,
        provider_clock_capability=provider_clock_capability,
        outer_clock_evidence=outer_clock_evidence,
        outer_publication_tail=mint.tail,
        transaction_generation=generation,
        transaction_epoch_at_preparation=epoch,
        total_changes_at_preparation=changes,
        source_descriptor_hash=seal.source_descriptor_hash,
        source_schema_identity_sha256=seal.source_schema_identity_sha256,
        outer_provider_now_ms=outer_provider_now_ms,
        current_transaction_epoch=epoch,
        current_total_changes=changes,
    )
    _identity_set(_AUTHORITIES, authority, state)
    _link_set(_AUTHORITY_BY_EVIDENCE, outer_clock_evidence, authority)
    _link_set(_AUTHORITY_BY_TRANSFER, transfer, authority)
    return authority


def _activate_sqlite_cursor_outer_publication_authority_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    cancellation: _SQLiteCursorOuterPublicationCancellationSignal | None = None,
) -> _SQLiteCursorOuterPublicationAuthority:
    state = _authority_state(authority)
    if (
        state.lifecycle != "inactive"
        or state.activation_count != 0
        or state.outer_clock_consumed_tombstone is not None
    ):
        _fail("GE_CURSOR_B3_OUTER_NOT_INACTIVE")
    if cancellation is not None:
        cancellation_state = _identity_get(
            _CANCELLATIONS,
            cancellation,
            _SQLiteCursorOuterPublicationCancellationSignal,
        )
        if cancellation_state is None:
            _fail("GE_CURSOR_B3_OUTER_CANCELLATION")
        if cast(_CancellationState, cancellation_state).cancelled:
            _fail("GE_CURSOR_B3_OUTER_CANCELLED")

    _revalidate_inactive(state, authority)
    try:
        tombstone = _CONSUME_CLOCK(
            state.provider_clock_capability,
            state.outer_clock_evidence,
            "outer-publication-authority",
        )
        state.outer_clock_consumed_tombstone = tombstone
        _OWNERSHIP_PUBLISH_OUTER(state.outer_publication_tail)
        state.activation_count = 1
        state.lifecycle = "active"
        return authority
    except BaseException:
        _poison(state, authority, "SQLite outer publication activation tail failed")
        raise


def _assert_sqlite_cursor_outer_publication_authority_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> _SQLiteCursorOuterPublicationAuthority:
    state = _authority_state(authority)
    if state.lifecycle == "poisoned" or state.write_phase == "poisoned":
        _fail("GE_CURSOR_B3_OUTER_POISONED")
    if state.lifecycle == "retired" or state.write_phase == "retired":
        _fail("GE_CURSOR_B3_OUTER_STALE_FENCE")
    if (
        state.lifecycle != "active"
        or state.activation_count != 1
        or state.outer_clock_consumed_tombstone is None
    ):
        _fail("GE_CURSOR_B3_OUTER_NOT_ACTIVE")
    try:
        generation, epoch, changes = _owner_snapshot(state.connection)
        if generation is not state.transaction_generation:
            _fail("GE_CURSOR_B3_OUTER_STALE_FENCE")
        if epoch != state.current_transaction_epoch or changes != state.current_total_changes:
            _fail("GE_CURSOR_B3_OUTER_LEDGER_DRIFT")
        clock_generation = _active_clock_graph(state)
        if clock_generation is not generation:
            _fail("GE_CURSOR_B3_OUTER_STALE_FENCE")
        _OWNERSHIP_ASSERT_OWNED(
            state.connection,
            state.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            authority,
        )
        return authority
    except BaseException as error:
        if isinstance(error, ValueError) and str(error) == "GE_CURSOR_B3_OUTER_STALE_FENCE":
            _retire(state, authority)
        else:
            _poison(state, authority, "SQLite active outer publication invariant failed")
        raise


def _outer_ledger_snapshot(
    state: _AuthorityState,
) -> _SQLiteCursorOuterPublicationLedgerSnapshot:
    return _SQLiteCursorOuterPublicationLedgerSnapshot(
        affected_rows_watermark=state.affected_rows_watermark,
        fixed_statement_count=state.fixed_statement_count,
        logical_write_sequence=state.logical_write_sequence,
    )


def _execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> _SQLiteMigration0002CatalogRebuildReceipt:
    """Execute the fixed 20-statement asset without owning transaction completion."""

    state = _authority_state(authority)
    if (
        state.migration_0002_receipt is not None
        or state.migration_0002_logical_execution_count != 0
        or state.logical_write_sequence != 0
        or state.fixed_statement_count != 0
        or state.affected_rows_watermark != 0
    ):
        _poison(state, authority, "SQLite migration 0002 was executed more than once")
        _fail("GE_CURSOR_B3_MIGRATION_0002_REPLAY")

    # Reuse above is terminal before any live SQLite read. A second invocation
    # therefore emits no SQL and cannot look like an idempotent utility.
    _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority)
    if state.write_phase != "ready-0002":
        _poison(state, authority, "SQLite migration 0002 write phase is invalid")
        _fail("GE_CURSOR_B3_MIGRATION_0002_PHASE")

    total_changes_before = state.current_total_changes
    transaction_epoch_before = state.current_transaction_epoch
    ledger_before = _outer_ledger_snapshot(state)
    execution: _SQLiteConnectionMigration0002Execution | None = None
    schema_copy_row_count = 0
    legacy_operation_copy_row_count = 0
    statement_affected_rows: list[int] = []

    try:
        legacy_count = state.projection_identity.legacy_operation_count
        if type(legacy_count) is not int or not 0 <= legacy_count < _MAX_SAFE_INTEGER:
            _fail("GE_CURSOR_B3_MIGRATION_0002_LEGACY_COUNT")

        asset = _LOAD_MIGRATION_0002_ASSET()
        asset_snapshot = _READ_MIGRATION_0002_ASSET(asset)
        if (
            asset_snapshot.asset_sha256 != SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256
            or asset_snapshot.asset_utf8_bytes != SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES
            or asset_snapshot.fixed_statement_count
            != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
            or asset_snapshot.preview_manifest_sha256
            != SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256
            or asset_snapshot.schema_sql_sha256 != SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256
            or len(asset_snapshot.statements) != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
        ):
            _fail("GE_CURSOR_B3_MIGRATION_0002_ASSET")

        # Begin owns the fixed twelve-name TEMP preflight and binds this exact
        # asset/session/connection graph before any permanent mutation.
        execution = _BEGIN_MIGRATION_0002(state.connection, asset)
        pre_ddl_catalog = _READ_TARGET_CATALOG(state.connection)
        if (
            pre_ddl_catalog.application_id != 1_195_724_359
            or pre_ddl_catalog.user_version != 1
            or pre_ddl_catalog.catalog_sha256 != _SOURCE_V1_CATALOG_SHA256
            or pre_ddl_catalog.row_count != _SOURCE_V1_CATALOG_ROW_COUNT
            or pre_ddl_catalog.canonical_utf8_bytes != _SOURCE_V1_CATALOG_CANONICAL_UTF8_BYTES
        ):
            _fail("GE_CURSOR_B3_MIGRATION_0002_SOURCE_METADATA")

        state.write_phase = "executing-0002"
        state.migration_0002_logical_execution_count = 1
        for ordinal in range(1, SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT + 1):
            step = _EXECUTE_NEXT_MIGRATION_0002(state.connection, execution)
            if (
                step.fixed_statement_ordinal != ordinal
                or step.completed_statement_count != ordinal
                or step.prepared_statement_count != ordinal
                or step.transaction_generation is not state.transaction_generation
            ):
                _fail("GE_CURSOR_B3_MIGRATION_0002_ORDER")
            state.current_transaction_epoch = step.transaction_epoch
            state.current_total_changes = step.total_changes
            state.fixed_statement_count = step.completed_statement_count
            state.migration_0002_prepared_statement_count = step.prepared_statement_count
            state.affected_rows_watermark += step.affected_rows_delta
            statement_affected_rows.append(step.affected_rows_delta)
            if ordinal == 4:
                schema_copy_row_count = step.affected_rows_delta
            elif ordinal == 17:
                legacy_operation_copy_row_count = step.affected_rows_delta

        progress = _READ_MIGRATION_0002_PROGRESS(state.connection, execution)
        expected_affected_rows = 1 + legacy_count
        if (
            progress.lifecycle != "completed"
            or progress.prepared_statement_count
            != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
            or progress.completed_statement_count
            != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
            or progress.next_statement_ordinal
            != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT + 1
            or progress.transaction_generation is not state.transaction_generation
            or schema_copy_row_count != 1
            or legacy_operation_copy_row_count != legacy_count
            or progress.affected_rows != expected_affected_rows
            or state.affected_rows_watermark != expected_affected_rows
            or progress.total_changes - total_changes_before != expected_affected_rows
            or state.current_total_changes != progress.total_changes
            or state.current_transaction_epoch != progress.transaction_epoch
            or progress.transaction_epoch - transaction_epoch_before
            != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
        ):
            _fail("GE_CURSOR_B3_MIGRATION_0002_LEDGER")

        post_ddl_catalog = _READ_TARGET_CATALOG(state.connection)
        if (
            post_ddl_catalog.application_id
            != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
            or post_ddl_catalog.user_version
            != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION
            or post_ddl_catalog.row_count
            != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
            or post_ddl_catalog.canonical_utf8_bytes
            != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES
            or post_ddl_catalog.catalog_sha256
            != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
            or post_ddl_catalog.inventory
            != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY
        ):
            _fail("GE_CURSOR_B3_MIGRATION_0002_TARGET_CATALOG")
        parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS([[]])
        result_sha256 = _DIGEST_INITIAL_WRITE_RESULT({"affectedRows": str(expected_affected_rows)})
        ledger_after = _SQLiteCursorOuterPublicationLedgerSnapshot(
            affected_rows_watermark=expected_affected_rows,
            fixed_statement_count=SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
            logical_write_sequence=1,
        )
        ledger_delta = ledger_after
        receipt_snapshot = _SQLiteMigration0002CatalogRebuildReceiptSnapshot(
            affected_rows=expected_affected_rows,
            application_id_after=cast(Literal[1_195_724_359], post_ddl_catalog.application_id),
            application_id_before=cast(Literal[1_195_724_359], pre_ddl_catalog.application_id),
            asset_sha256=SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
            asset_utf8_bytes=SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
            execute_count=1,
            fixed_statement_count=20,
            legacy_operation_copy_row_count=legacy_operation_copy_row_count,
            outer_ledger_after=ledger_after,
            outer_ledger_before=ledger_before,
            outer_ledger_delta=ledger_delta,
            parameter_sha256=parameter_sha256,
            post_ddl_catalog_sha256=post_ddl_catalog.catalog_sha256,
            pre_ddl_catalog_sha256=pre_ddl_catalog.catalog_sha256,
            prepare_count=20,
            preview_manifest_identity=asset_snapshot.preview_manifest_identity,
            preview_manifest_sha256=SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
            result_sha256=result_sha256,
            schema_copy_row_count=1,
            schema_sql_sha256=SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
            statement_affected_rows=tuple(statement_affected_rows),
            total_changes_after=progress.total_changes,
            total_changes_before=total_changes_before,
            total_changes_delta=expected_affected_rows,
            transaction_epoch_after=progress.transaction_epoch,
            transaction_epoch_before=transaction_epoch_before,
            transaction_generation=state.transaction_generation,
            user_version_after=cast(Literal[2], post_ddl_catalog.user_version),
            user_version_before=cast(Literal[1], pre_ddl_catalog.user_version),
            write_kind="migration-0002-catalog-rebuild",
        )
        receipt = _SQLiteMigration0002CatalogRebuildReceipt(_CONSTRUCTION_TOKEN)
        _identity_set(
            _MIGRATION_0002_RECEIPTS,
            receipt,
            _Migration0002ReceiptRecord(
                asset=asset,
                authority_ref=_REF(authority),
                connection=state.connection,
                post_ddl_catalog=post_ddl_catalog,
                pre_ddl_catalog=pre_ddl_catalog,
                snapshot=receipt_snapshot,
            ),
        )
        state.logical_write_sequence = 1
        state.migration_0002_receipt = receipt
        state.write_phase = "0002-complete"
        return receipt
    except BaseException:
        if execution is not None:
            with suppress(BaseException):
                progress = _READ_MIGRATION_0002_PROGRESS(state.connection, execution)
                state.current_transaction_epoch = progress.transaction_epoch
                state.current_total_changes = progress.total_changes
                state.fixed_statement_count = progress.completed_statement_count
                state.migration_0002_prepared_statement_count = progress.prepared_statement_count
                state.affected_rows_watermark = progress.affected_rows
        _poison(state, authority, "SQLite migration 0002 execution failed")
        raise


def _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
    receipt: _SQLiteMigration0002CatalogRebuildReceipt,
) -> _SQLiteMigration0002CatalogRebuildReceiptSnapshot:
    record = _identity_get(
        _MIGRATION_0002_RECEIPTS,
        receipt,
        _SQLiteMigration0002CatalogRebuildReceipt,
    )
    if record is None:
        _fail("GE_CURSOR_B3_MIGRATION_0002_RECEIPT")
    checked = cast(_Migration0002ReceiptRecord, record)
    authority = checked.authority_ref()
    if authority is None:
        _fail("GE_CURSOR_B3_MIGRATION_0002_RECEIPT")
    state = _authority_state(authority)
    _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority)
    asset = _READ_MIGRATION_0002_ASSET(checked.asset)
    snapshot = checked.snapshot
    if (
        state.connection is not checked.connection
        or state.transaction_generation is not snapshot.transaction_generation
        or state.migration_0002_receipt is not receipt
        or state.migration_0002_logical_execution_count != 1
        or state.logical_write_sequence < snapshot.outer_ledger_after.logical_write_sequence
        or state.fixed_statement_count < snapshot.outer_ledger_after.fixed_statement_count
        or state.affected_rows_watermark < snapshot.outer_ledger_after.affected_rows_watermark
        or state.current_transaction_epoch < snapshot.transaction_epoch_after
        or state.current_total_changes < snapshot.total_changes_after
        or asset.preview_manifest_identity is not snapshot.preview_manifest_identity
        or asset.preview_manifest_sha256 != snapshot.preview_manifest_sha256
        or asset.asset_sha256 != snapshot.asset_sha256
    ):
        _poison(state, authority, "SQLite migration 0002 receipt graph drifted")
        _fail("GE_CURSOR_B3_MIGRATION_0002_RECEIPT_DRIFT")
    return snapshot


def _exact_outer_ledger(
    left: _SQLiteCursorOuterPublicationLedgerSnapshot,
    right: _SQLiteCursorOuterPublicationLedgerSnapshot,
) -> bool:
    return (
        left.logical_write_sequence == right.logical_write_sequence
        and left.fixed_statement_count == right.fixed_statement_count
        and left.affected_rows_watermark == right.affected_rows_watermark
    )


def _exact_post_ddl_catalog(
    catalog: _TargetCatalogSnapshot,
    retained: _TargetCatalogSnapshot,
) -> bool:
    return (
        type(catalog) is _TargetCatalogSnapshot
        and type(retained) is _TargetCatalogSnapshot
        and catalog.application_id
        == retained.application_id
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_APPLICATION_ID
        and catalog.user_version
        == retained.user_version
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_USER_VERSION
        and catalog.row_count
        == retained.row_count
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
        and catalog.canonical_utf8_bytes
        == retained.canonical_utf8_bytes
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_CANONICAL_UTF8_BYTES
        and catalog.catalog_sha256
        == retained.catalog_sha256
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        and catalog.canonical_json == retained.canonical_json
        and catalog.canonical_rows == retained.canonical_rows
        and catalog.inventory
        == retained.inventory
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_INVENTORY
        and catalog.query == retained.query == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY
        and catalog.query_sha256
        == retained.query_sha256
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256
        and catalog.target_descriptor is retained.target_descriptor
    )


def _assert_open_fence_authority(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> None:
    """Classify a closed native owner before its properties can leak driver errors."""

    try:
        _OWNER_EXCLUSIVE(state.connection)
    except _SQLITE_PROGRAMMING_ERROR:
        _poison(state, authority, "SQLite post-DDL catalog connection is unavailable")
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_UNAVAILABLE")
    _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority)


def _translate_closed_fence_connection(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> None:
    """Reprobe after a masked reader failure and classify a newly closed owner."""

    try:
        _OWNER_EXCLUSIVE(state.connection)
    except _SQLITE_PROGRAMMING_ERROR:
        _poison(state, authority, "SQLite post-DDL catalog connection is unavailable")
        raise ValueError("GE_CURSOR_B3_POST_DDL_CATALOG_UNAVAILABLE") from None


def _post_ddl_catalog_fence_record(
    fence: _SQLiteCursorPostDdlCatalogFence,
) -> _PostDdlCatalogFenceRecord:
    record = _identity_get(
        _POST_DDL_CATALOG_FENCES,
        fence,
        _SQLiteCursorPostDdlCatalogFence,
    )
    if record is None:
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE")
    return cast(_PostDdlCatalogFenceRecord, record)


def _resolve_post_ddl_catalog_fence_graph(
    record: _PostDdlCatalogFenceRecord,
) -> tuple[
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
]:
    authority = record.authority_ref()
    receipt = record.migration_0002_receipt_ref()
    if (
        authority is None
        or receipt is None
        or _ID(authority) != record.authority_id
        or _ID(receipt) != record.migration_0002_receipt_id
    ):
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE")
    return authority, receipt


def _mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
) -> _SQLiteCursorPostDdlCatalogFence:
    """Mint the one reusable physical-target proof from a fresh catalog read."""

    state = _authority_state(authority)
    if state.post_ddl_catalog_fence is not None or state.post_ddl_catalog_fence_mint_count != 0:
        _poison(state, authority, "SQLite post-DDL catalog fence was minted more than once")
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_REPLAY")
    if (
        state.write_phase != "0002-complete"
        or state.migration_0002_logical_execution_count != 1
        or state.migration_0002_prepared_statement_count
        != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
        or state.migration_0002_receipt is None
    ):
        _poison(state, authority, "SQLite post-DDL catalog fence mint was premature")
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_PREMATURE")

    # Presentation is a caller-controlled shape error. Authenticate it before
    # any live SQLite observation and without damaging a healthy exact graph.
    presented = _identity_get(
        _MIGRATION_0002_RECEIPTS,
        migration_0002_receipt,
        _SQLiteMigration0002CatalogRebuildReceipt,
    )
    if presented is None:
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_RECEIPT")
    receipt_record = cast(_Migration0002ReceiptRecord, presented)
    if (
        receipt_record.authority_ref() is not authority
        or receipt_record.connection is not state.connection
        or state.migration_0002_receipt is not migration_0002_receipt
    ):
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_RECEIPT")

    try:
        _assert_open_fence_authority(state, authority)
        migration = _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
            migration_0002_receipt
        )
        current_ledger = _outer_ledger_snapshot(state)
        if (
            state.transaction_generation is not migration.transaction_generation
            or state.current_transaction_epoch != migration.transaction_epoch_after
            or state.current_total_changes != migration.total_changes_after
            or not _exact_outer_ledger(current_ledger, migration.outer_ledger_after)
        ):
            _fail("GE_CURSOR_B3_POST_DDL_CATALOG_WATERMARK")

        # Receipt-retained catalog data is comparison evidence only. The proof
        # authority is this independent captured validated read.
        catalog = _READ_VALIDATED_TARGET_CATALOG(state.connection)
        _assert_open_fence_authority(state, authority)
        if (
            not _exact_post_ddl_catalog(catalog, receipt_record.post_ddl_catalog)
            or catalog.catalog_sha256 != migration.post_ddl_catalog_sha256
            or catalog.application_id != migration.application_id_after
            or catalog.user_version != migration.user_version_after
        ):
            _fail("GE_CURSOR_B3_POST_DDL_CATALOG_DRIFT")

        fence = _SQLiteCursorPostDdlCatalogFence(_CONSTRUCTION_TOKEN)
        _identity_set(
            _POST_DDL_CATALOG_FENCES,
            fence,
            _PostDdlCatalogFenceRecord(
                authority_id=_ID(authority),
                authority_ref=_REF(authority),
                catalog_application_id=catalog.application_id,
                catalog_canonical_utf8_bytes=catalog.canonical_utf8_bytes,
                catalog_inventory=catalog.inventory,
                catalog_row_count=catalog.row_count,
                catalog_sha256=catalog.catalog_sha256,
                catalog_user_version=catalog.user_version,
                migration_0002_receipt_id=_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_REF(migration_0002_receipt),
                outer_ledger_watermark=current_ledger,
                total_changes_watermark=state.current_total_changes,
                transaction_epoch=state.current_transaction_epoch,
                transaction_generation=state.transaction_generation,
            ),
        )
        state.post_ddl_catalog_fence = fence
        state.post_ddl_catalog_fence_mint_count = 1
        state.write_phase = "post-ddl-catalog-fence"
        return fence
    except BaseException:
        _translate_closed_fence_connection(state, authority)
        _poison(state, authority, "SQLite post-DDL catalog fence validation failed")
        raise


def _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
) -> _SQLiteCursorPostDdlCatalogFence:
    """Reprove the exact live fence with another independent catalog read."""

    record = _post_ddl_catalog_fence_record(fence)
    if (
        record.authority_id != _ID(authority)
        or record.authority_ref() is not authority
        or record.migration_0002_receipt_id != _ID(migration_0002_receipt)
        or record.migration_0002_receipt_ref() is not migration_0002_receipt
    ):
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE_GRAPH")
    state = _authority_state(authority)
    if (
        state.post_ddl_catalog_fence is not fence
        or state.post_ddl_catalog_fence_mint_count != 1
        or state.migration_0002_receipt is not migration_0002_receipt
    ):
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE_GRAPH")

    try:
        _assert_open_fence_authority(state, authority)
        registered_receipt = _identity_get(
            _MIGRATION_0002_RECEIPTS,
            migration_0002_receipt,
            _SQLiteMigration0002CatalogRebuildReceipt,
        )
        if registered_receipt is None:
            _fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE_GRAPH")
        receipt_record = cast(_Migration0002ReceiptRecord, registered_receipt)
        if (
            receipt_record.authority_ref() is not authority
            or receipt_record.connection is not state.connection
        ):
            _fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE_GRAPH")
        _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
            migration_0002_receipt
        )
        watermark = record.outer_ledger_watermark
        if (
            state.transaction_generation is not record.transaction_generation
            or state.current_transaction_epoch < record.transaction_epoch
            or state.current_total_changes < record.total_changes_watermark
            or state.logical_write_sequence < watermark.logical_write_sequence
            or state.fixed_statement_count < watermark.fixed_statement_count
            or state.affected_rows_watermark < watermark.affected_rows_watermark
        ):
            _fail("GE_CURSOR_B3_POST_DDL_CATALOG_WATERMARK")
        catalog = _READ_VALIDATED_TARGET_CATALOG(state.connection)
        _assert_open_fence_authority(state, authority)
        if (
            not _exact_post_ddl_catalog(catalog, receipt_record.post_ddl_catalog)
            or catalog.application_id != record.catalog_application_id
            or catalog.user_version != record.catalog_user_version
            or catalog.row_count != record.catalog_row_count
            or catalog.canonical_utf8_bytes != record.catalog_canonical_utf8_bytes
            or catalog.catalog_sha256 != record.catalog_sha256
            or catalog.inventory != record.catalog_inventory
            or catalog.query != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY
            or catalog.query_sha256 != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256
        ):
            _fail("GE_CURSOR_B3_POST_DDL_CATALOG_DRIFT")
        return fence
    except BaseException:
        _translate_closed_fence_connection(state, authority)
        _poison(state, authority, "SQLite post-DDL catalog fence revalidation failed")
        raise


def _read_sqlite_cursor_post_ddl_catalog_fence_snapshot_intrinsic(
    fence: _SQLiteCursorPostDdlCatalogFence,
) -> _SQLiteCursorPostDdlCatalogFenceSnapshot:
    record = _post_ddl_catalog_fence_record(fence)
    authority, migration_0002_receipt = _resolve_post_ddl_catalog_fence_graph(record)
    _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
        authority,
        migration_0002_receipt,
        fence,
    )
    state = _authority_state(authority)
    return _SQLiteCursorPostDdlCatalogFenceSnapshot(
        application_id=cast(Literal[1_195_724_359], record.catalog_application_id),
        authority=authority,
        catalog_canonical_utf8_bytes=cast(Literal[5_785], record.catalog_canonical_utf8_bytes),
        catalog_digest_domain_utf8=SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_DOMAIN_UTF8,
        catalog_inventory=record.catalog_inventory,
        catalog_query=SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY,
        catalog_query_sha256=SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_QUERY_SHA256,
        catalog_row_count=cast(Literal[34], record.catalog_row_count),
        catalog_sha256=record.catalog_sha256,
        connection=state.connection,
        consumes_any_write_receipt=False,
        is_final_v2_semantic_proof=False,
        migration_0002_receipt=migration_0002_receipt,
        mint_count=1,
        outer_ledger_watermark=record.outer_ledger_watermark,
        proof_scope="post-0002-physical-target-catalog-before-baseline-publication",
        total_changes_watermark=record.total_changes_watermark,
        transaction_epoch=record.transaction_epoch,
        transaction_generation=record.transaction_generation,
        user_version=cast(Literal[2], record.catalog_user_version),
    )


def _read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> _SQLiteCursorOuterPublicationAuthoritySnapshot:
    state = _authority_state(authority)
    return _SQLiteCursorOuterPublicationAuthoritySnapshot(
        lifecycle=state.lifecycle,
        stage_ownership_poison_reason=state.stage_ownership_poison_reason,
        connection=state.connection,
        stage=state.stage,
        receipt=state.receipt,
        projection_identity=state.projection_identity,
        projection_reference=state.projection_reference,
        transfer=state.transfer,
        migration_lock_capability=state.migration_lock_capability,
        provider_clock_capability=state.provider_clock_capability,
        outer_clock_evidence=state.outer_clock_evidence,
        outer_clock_consumed_tombstone=state.outer_clock_consumed_tombstone,
        transaction_generation=state.transaction_generation,
        transaction_epoch_at_preparation=state.transaction_epoch_at_preparation,
        total_changes_at_preparation=state.total_changes_at_preparation,
        outer_ledger=_SQLiteCursorOuterPublicationLedgerSnapshot(
            state.affected_rows_watermark,
            state.fixed_statement_count,
            state.logical_write_sequence,
        ),
        source_descriptor_hash=state.source_descriptor_hash,
        source_schema_identity_sha256=state.source_schema_identity_sha256,
        outer_provider_now_ms=state.outer_provider_now_ms,
        source_schema_version=1,
        target_schema_version=2,
        activation_count=state.activation_count,
        migration_0002_logical_execution_count=state.migration_0002_logical_execution_count,
        migration_0002_prepared_statement_count=state.migration_0002_prepared_statement_count,
        migration_0002_receipt=state.migration_0002_receipt,
        post_ddl_catalog_fence=state.post_ddl_catalog_fence,
        post_ddl_catalog_fence_mint_count=state.post_ddl_catalog_fence_mint_count,
        write_phase=state.write_phase,
    )
