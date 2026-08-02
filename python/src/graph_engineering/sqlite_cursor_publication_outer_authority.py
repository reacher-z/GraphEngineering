"""Package-private owner of the SQLite cursor initial-publication write lane.

The owner binds and activates the exact completed B2 stage graph, then permits
the ordered migration-0002, post-DDL proof/read, baseline entries, baseline
header and operation-sequence-zero publication leaves.  It never begins,
commits, rolls back or rebinds the caller-owned transaction.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from base64 import urlsafe_b64encode
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Literal, NamedTuple, Never, TypeAlias, cast
from weakref import ReferenceType, WeakKeyDictionary, ref

from .sqlite_cursor_publication_clock_authority import (
    _CLOCK_CAPABILITIES,
    _EVIDENCE,
    _LOCK_CAPABILITIES,
    _TOMBSTONES,
    ClockConsumer,
    _assert_active_second_boundary_graph_intrinsic,
    _assert_clock_evidence_predecessor_intrinsic,
    _assert_consumed_clock_tombstone_intrinsic,
    _assert_prepared_second_boundary_graph_intrinsic,
    _ClockEvidence,
    _consume_provider_clock_evidence_intrinsic,
    _ConsumedClockTombstone,
    _live_lock,
    _MigrationLockCapability,
    _observe_provider_clock_intrinsic,
    _ProviderClockCapability,
    _read_clock_evidence_snapshot_intrinsic,
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
    SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR,
    _read_target_catalog_observation_intrinsic,
    _read_validated_target_catalog_intrinsic,
    _TargetCatalogSnapshot,
)
from .sqlite_operation_baseline import (
    BASELINE_ENTRY_KINDS,
    BASELINE_GENESIS_HASH,
    MAX_BASELINE_KEY_BYTES,
    MAX_BASELINE_STATE_BYTES,
    BaselineAccumulator,
    BaselineEntry,
    BaselineProjectionIdentity,
    capture_baseline_entry,
    encode_baseline_policy,
)
from .sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorExactProjectionReference,
    SQLiteCursorPreRebindReceipt,
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
)
from .sqlite_operation_baseline_cursor_stage_ownership import (
    _TRANSFERS as _OWNERSHIP_TRANSFERS,
)
from .sqlite_operation_baseline_cursor_stage_ownership import (
    _assert_sqlite_cursor_stage_ownership_initial_publication_adopted_intrinsic,
    _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic,
    _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic,
    _assert_sqlite_cursor_stage_ownership_post_ddl_reader_terminal_intrinsic,
    _assert_sqlite_cursor_stage_ownership_pre_rebind_complete_intrinsic,
    _assert_sqlite_cursor_stage_ownership_publication_session_intrinsic,
    _burn_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic,
    _burn_sqlite_cursor_stage_ownership_publication_session_intrinsic,
    _complete_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic,
    _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic,
    _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic,
    _prepare_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic,
    _prepare_sqlite_cursor_stage_ownership_publication_session_intrinsic,
    _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic,
    _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _publish_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic,
    _publish_sqlite_cursor_stage_ownership_publication_session_intrinsic,
    _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic,
    _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _SQLiteCursorStageOwnershipOuterPublicationAuthority,
    _SQLiteCursorStageOwnershipOuterPublicationTail,
    _SQLiteCursorStageOwnershipPublicationSessionTail,
    _SQLiteCursorStageOwnershipTransfer,
)
from .sqlite_operation_baseline_source import (
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC,
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC,
    SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC,
    SQLiteV1BaselineConnectionOwner,
    _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic,
    _begin_sqlite_connection_baseline_header_publication_execution_intrinsic,
    _begin_sqlite_connection_migration_0002_execution_intrinsic,
    _begin_sqlite_connection_operation_sequence_zero_execution_intrinsic,
    _close_owned_sqlite_connection_post_ddl_publication_reader_intrinsic,
    _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic,
    _execute_next_sqlite_connection_migration_0002_statement_intrinsic,
    _execute_sqlite_connection_baseline_header_publication_intrinsic,
    _execute_sqlite_connection_operation_sequence_zero_intrinsic,
    _execute_sqlite_connection_post_ddl_publication_reader_intrinsic,
    _fetch_next_owned_sqlite_connection_post_ddl_publication_reader_intrinsic,
    _prepare_sqlite_connection_post_ddl_publication_reader_intrinsic,
    _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic,
    _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic,
    _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic,
    _read_sqlite_connection_operation_sequence_zero_execution_snapshot_intrinsic,
    _read_sqlite_connection_post_ddl_publication_reader_snapshot_intrinsic,
    _SQLiteConnectionBaselineEntryPublicationExecution,
    _SQLiteConnectionBaselineHeaderPublicationExecution,
    _SQLiteConnectionMigration0002Execution,
    _SQLiteConnectionOperationSequenceZeroExecution,
)
from .sqlite_operation_baseline_stage import (
    SQLiteV1BaselineTempStage,
    _SQLiteBaselineCursorB2FenceRetirement,
    _SQLiteCursorInitialPublicationOuterLedgerWatermark,
    _SQLiteCursorInitialPublicationStageWatermark,
)

_CONSTRUCTION_TOKEN = object()
_MAX_SAFE_INTEGER = 2**53 - 1
_SOURCE_V1_CATALOG_SHA256 = "359cf74f441a201fcae970d77eac460529d9c562ad7a42d20e5224b65b88b2f0"
_SOURCE_V1_CATALOG_ROW_COUNT = 27
_SOURCE_V1_CATALOG_CANONICAL_UTF8_BYTES = 4_504
SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL = (
    SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC
)
SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256 = (
    "adae52750ecd70a75090b52de7d60763eea144c1383cf4739df9d8e8a6b2357f"
)
SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC = (
    "INSERT INTO main.ge_cycle_operation_baseline_entries "
    "(baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, "
    "previous_entry_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
)
SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC = (
    "b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b"
)
_BASELINE_ENTRIES_SOURCE_SQL = SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL
_BASELINE_ENTRIES_SOURCE_SQL_SHA256 = SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256
_BASELINE_ENTRIES_INSERT_SQL = SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC
_BASELINE_ENTRIES_INSERT_SQL_SHA256 = (
    SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC
)
SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC = (
    "INSERT INTO main.ge_cycle_operation_baselines (baseline_id, "
    "baseline_format_version, source_application_id, source_user_version, "
    "source_schema_identity_sha256, source_migration_lineage_id, "
    "source_migration_lineage_sha256, source_descriptor_hash, captured_at_ms, "
    "legacy_operation_count, entry_count, first_entry_hash, final_entry_hash, "
    "canonical_projection_sha256, creation_runtime, creation_runtime_version, "
    "policy_blob) VALUES (?, 1, 1195724359, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)
SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC = (
    "b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a"
)
SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC = (
    "baselineId",
    "sourceSchemaIdentitySha256",
    "sourceMigrationLineageId",
    "sourceMigrationLineageSha256",
    "sourceDescriptorHash",
    "capturedAtMs",
    "legacyOperationCount",
    "entryCount",
    "firstEntryHash",
    "finalEntryHash",
    "canonicalProjectionSha256",
    "creationRuntime",
    "creationRuntimeVersion",
    "policyBlob",
)
SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC = "graph-engineering-python"
SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC = "0.1.0a1"
_BASELINE_HEADER_INSERT_SQL = SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC
_BASELINE_HEADER_INSERT_SQL_SHA256 = (
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC
)
_BASELINE_HEADER_PARAMETER_ORDER = (
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC
)
_BASELINE_HEADER_CREATION_RUNTIME = SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_INTRINSIC
_BASELINE_HEADER_CREATION_RUNTIME_VERSION = (
    SQLITE_CURSOR_BASELINE_HEADER_CREATION_RUNTIME_VERSION_INTRINSIC
)
_BASELINE_HEADER_POLICY_UTF8_BYTES = 946
_BASELINE_HEADER_POLICY_SHA256 = "67cbe0ac8bf04f28061d50f8b7089312cc1e1f9a9520ede95deec0d1f4ec5eb0"
_OPERATION_SEQUENCE_ZERO_INSERT_SQL = SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC
_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256 = (
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC
)
_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER = (
    SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC
)


def _capture_operation_sequence_zero_sql_commitment(
    sql: str,
    sql_sha256: str,
    parameter_order: tuple[str, ...],
) -> Callable[[], tuple[str, str, tuple[str, ...]]]:
    """Close over definition-time values that paired module rebinding cannot alter."""

    def read() -> tuple[str, str, tuple[str, ...]]:
        return sql, sql_sha256, parameter_order

    return read


_READ_CAPTURED_OPERATION_SEQUENCE_ZERO_SQL_COMMITMENT = (
    _capture_operation_sequence_zero_sql_commitment(
        _OPERATION_SEQUENCE_ZERO_INSERT_SQL,
        _OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256,
        _OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER,
    )
)

_SQLiteCursorOuterPublicationAuthority: TypeAlias = (
    _SQLiteCursorStageOwnershipOuterPublicationAuthority
)
_AuthorityLifecycle: TypeAlias = Literal["inactive", "active", "poisoned", "retired"]
_WritePhase: TypeAlias = Literal[
    "ready-0002",
    "executing-0002",
    "0002-complete",
    "post-ddl-catalog-fence",
    "post-ddl-reader-closed",
    "executing-baseline-entries",
    "baseline-entries-complete",
    "executing-baseline-header",
    "baseline-header-complete",
    "executing-sequence-zero",
    "sequence-zero-complete",
    "initial-stage-adoption-complete",
    "publication-active",
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


class _SQLiteCursorPublicationSessionPreparedOwner:
    """Opaque owner of the exact three prepared publication continuations."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_PUBLICATION_PREPARED_OWNER")


class _SQLiteCursorPublicationSession:
    """Opaque single-use identity made active by the B3 publication tail."""

    __slots__ = ("__state", "__weakref__")

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_PUBLICATION_SESSION")
        object.__setattr__(self, "_SQLiteCursorPublicationSession__state", None)

    def __setattr__(self, _name: str, _value: object) -> None:
        raise TypeError("GE_CURSOR_B3_PUBLICATION_SESSION_STATE")


class _SQLiteCursorPublicationSessionCancellationSignal:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_PUBLICATION_CANCELLATION")


class _SQLiteCursorPublicationSessionCancellationController:
    __slots__ = ("_signal",)

    def __init__(
        self,
        token: object,
        signal: _SQLiteCursorPublicationSessionCancellationSignal,
    ) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_PUBLICATION_CANCELLATION")
        self._signal = signal

    @property
    def signal(self) -> _SQLiteCursorPublicationSessionCancellationSignal:
        return self._signal

    def cancel(self) -> None:
        state = _identity_get(
            _PUBLICATION_CANCELLATIONS,
            self._signal,
            _SQLiteCursorPublicationSessionCancellationSignal,
        )
        if state is None:
            _fail("GE_CURSOR_B3_PUBLICATION_CANCELLATION")
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


class _SQLiteCursorPostDdlPublicationReaderLease:
    """Opaque one-shot owner of the fixed post-DDL TEMP projection read."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_POST_DDL_READER_LEASE")


_ReaderLifecycle: TypeAlias = Literal[
    "minted-unused",
    "reader-active",
    "reader-closed",
    "retired",
    "poisoned",
]


class _SQLiteCursorPostDdlPublicationReaderLeaseSnapshot(NamedTuple):
    authority: _SQLiteCursorOuterPublicationAuthority
    close_attempt_count: Literal[0, 1]
    close_succeeded: bool
    connection: SQLiteV1BaselineConnectionOwner
    consumes_any_write_receipt: Literal[False]
    read_proof_epoch: int
    execute_count: Literal[0, 1]
    fetch_count: int
    lifecycle: _ReaderLifecycle
    may_mint_stage_adoption_receipt: Literal[False]
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt
    mint_count: Literal[1]
    outer_ledger_read_watermark: _SQLiteCursorOuterPublicationLedgerSnapshot
    ownership_acquisition_count: Literal[0, 1]
    permanent_write_authority: Literal[False]
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence
    prepare_count: Literal[0, 1]
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    rederived_entry_count: int | None
    rederived_final_entry_hash: str | None
    rederived_first_entry_hash: str | None
    rederived_legacy_operation_count: int | None
    rederived_projection_sha256: str | None
    source_read_sql: str
    source_read_sql_sha256: str
    stage: SQLiteV1BaselineTempStage
    total_changes_read_watermark: int
    transaction_generation: object
    transaction_epoch: int
    transfer: _SQLiteCursorStageOwnershipTransfer


class _SQLiteBaselineEntriesPublicationReceipt:
    """Opaque reusable proof of the one permanent baseline-entry write."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_BASELINE_ENTRIES_RECEIPT")


class _SQLiteBaselineEntriesPublicationReceiptSnapshot(NamedTuple):
    affected_rows: int
    authority: _SQLiteCursorOuterPublicationAuthority
    baseline_id: str
    connection: SQLiteV1BaselineConnectionOwner
    entry_count: int
    execute_count: int
    final_entry_hash: str
    first_entry_hash: str
    fixed_insert_sql: str
    fixed_insert_sql_sha256: str
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt
    mint_count: Literal[1]
    outer_ledger_after: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_before: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_delta: _SQLiteCursorOuterPublicationLedgerSnapshot
    parameter_sha256: str
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence
    prepare_count: Literal[1]
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    reader_close_count: Literal[1]
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease
    reader_lease_lifecycle: Literal["retired"]
    reader_rederived_projection_sha256: str
    result_sha256: str
    source_read_sql: str
    source_read_sql_sha256: str
    total_changes_after: int
    total_changes_before: int
    total_changes_delta: int
    transaction_epoch_after: int
    transaction_epoch_before: int
    transaction_generation: object
    write_kind: Literal["baseline-entries-publication"]


class _SQLiteBaselineHeaderPublicationReceipt:
    """Opaque reusable proof of the permanent baseline-header write."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_BASELINE_HEADER_RECEIPT")


class _SQLiteBaselineHeaderPublicationReceiptSnapshot(NamedTuple):
    affected_rows: Literal[1]
    authority: _SQLiteCursorOuterPublicationAuthority
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt
    baseline_id: str
    canonical_projection_sha256: str
    captured_at_ms: int
    connection: SQLiteV1BaselineConnectionOwner
    creation_runtime: Literal["graph-engineering-python"]
    creation_runtime_version: Literal["0.1.0a1"]
    entry_count: int
    execute_count: Literal[1]
    final_entry_hash: str
    fixed_insert_sql: str
    fixed_insert_sql_sha256: str
    first_entry_hash: str
    legacy_operation_count: int
    mint_count: Literal[1]
    outer_ledger_after: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_before: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_delta: _SQLiteCursorOuterPublicationLedgerSnapshot
    parameter_sha256: str
    parameter_order: tuple[str, ...]
    policy_blob_base64url: str
    policy_blob_sha256: str
    policy_blob_utf8_bytes: int
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence
    prepare_count: Literal[1]
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease
    result_sha256: str
    source_descriptor_hash: str
    source_migration_lineage_id: str
    source_migration_lineage_sha256: str
    source_schema_identity_sha256: str
    total_changes_after: int
    total_changes_before: int
    total_changes_delta: Literal[1]
    transaction_epoch_after: int
    transaction_epoch_before: int
    transaction_generation: object
    write_kind: Literal["baseline-header-publication"]


class _SQLiteOperationSequenceZeroPublicationReceipt:
    """Opaque reusable proof of the singleton sequence-zero write."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT")


class _SQLiteOperationSequenceZeroPublicationReceiptSnapshot(NamedTuple):
    affected_rows: Literal[1]
    authority: _SQLiteCursorOuterPublicationAuthority
    baseline_captured_at_ms: int
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt
    baseline_header_publication_receipt: _SQLiteBaselineHeaderPublicationReceipt
    baseline_id: str
    connection: SQLiteV1BaselineConnectionOwner
    execute_count: Literal[1]
    fixed_insert_sql: str
    fixed_insert_sql_sha256: str
    last_commit_sequence: Literal[0]
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt
    mint_count: Literal[1]
    outer_clock_evidence: _ClockEvidence
    outer_ledger_after: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_before: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_delta: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_provider_now_ms: int
    parameter_order: tuple[str, ...]
    parameter_sha256: str
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence
    prepare_count: Literal[1]
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease
    result_sha256: str
    total_changes_after: int
    total_changes_before: int
    total_changes_delta: Literal[1]
    transaction_epoch_after: int
    transaction_epoch_before: int
    transaction_generation: object
    updated_at_ms: int
    write_kind: Literal["operation-sequence-zero-publication"]


class _SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_INITIAL_ADOPTION_TOMBSTONE")


class _SQLiteBaselineEntriesPublicationReceiptConsumedTombstone:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_INITIAL_ADOPTION_TOMBSTONE")


class _SQLiteBaselineHeaderPublicationReceiptConsumedTombstone:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_INITIAL_ADOPTION_TOMBSTONE")


class _SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_INITIAL_ADOPTION_TOMBSTONE")


class _SQLiteCursorInitialStageAdoptionReceipt:
    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT")


_SQLiteCursorInitialPublicationReceiptBundle: TypeAlias = tuple[
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteBaselineEntriesPublicationReceipt,
    _SQLiteBaselineHeaderPublicationReceipt,
    _SQLiteOperationSequenceZeroPublicationReceipt,
]


class _SQLiteCursorInitialStageAdoptionReceiptSnapshot(NamedTuple):
    authority: _SQLiteCursorOuterPublicationAuthority
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    receipt: SQLiteCursorPreRebindReceipt
    projection_identity: BaselineProjectionIdentity
    projection_reference: SQLiteCursorExactProjectionReference
    transfer: _SQLiteCursorStageOwnershipTransfer
    transaction_generation: object
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt
    baseline_header_publication_receipt: _SQLiteBaselineHeaderPublicationReceipt
    operation_sequence_zero_publication_receipt: _SQLiteOperationSequenceZeroPublicationReceipt
    migration_0002_consumed_tombstone: _SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone
    baseline_entries_consumed_tombstone: _SQLiteBaselineEntriesPublicationReceiptConsumedTombstone
    baseline_header_consumed_tombstone: _SQLiteBaselineHeaderPublicationReceiptConsumedTombstone
    operation_sequence_zero_consumed_tombstone: (
        _SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone
    )
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease
    reader_lease_lifecycle: Literal["retired"]
    reader_close_count: Literal[1]
    reader_rederived_projection_sha256: str
    adopted_transaction_epoch: int
    adopted_total_changes: int
    adopted_outer_ledger: _SQLiteCursorOuterPublicationLedgerSnapshot
    target_catalog_sha256: str
    retired_b2_fence: _SQLiteBaselineCursorB2FenceRetirement
    mint_count: Literal[1]
    write_kind: Literal["initial-publication-stage-adoption"]


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
    source_migration_lineage_id: str
    source_migration_lineage_sha256: str
    source_schema_identity_sha256: str
    captured_at_ms: int
    outer_provider_now_ms: int
    source_schema_version: Literal[1]
    target_schema_version: Literal[2]
    activation_count: Literal[0, 1]
    migration_0002_logical_execution_count: Literal[0, 1]
    migration_0002_prepared_statement_count: int
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt | None
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence | None
    post_ddl_catalog_fence_mint_count: Literal[0, 1]
    post_ddl_publication_reader_lease: _SQLiteCursorPostDdlPublicationReaderLease | None
    post_ddl_publication_reader_lease_mint_count: Literal[0, 1]
    post_ddl_publication_reader_lease_close_count: Literal[0, 1]
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt | None
    baseline_entries_publication_receipt_mint_count: Literal[0, 1]
    baseline_entries_logical_execution_count: Literal[0, 1]
    baseline_entries_prepare_count: Literal[0, 1]
    baseline_entries_execute_count: int
    baseline_entries_affected_rows: int
    baseline_header_publication_receipt: _SQLiteBaselineHeaderPublicationReceipt | None
    baseline_header_publication_receipt_mint_count: Literal[0, 1]
    baseline_header_logical_execution_count: Literal[0, 1]
    baseline_header_prepare_count: Literal[0, 1]
    baseline_header_execute_count: Literal[0, 1]
    baseline_header_affected_rows: Literal[0, 1]
    operation_sequence_zero_publication_receipt: (
        _SQLiteOperationSequenceZeroPublicationReceipt | None
    )
    operation_sequence_zero_publication_receipt_mint_count: Literal[0, 1]
    operation_sequence_zero_logical_execution_count: Literal[0, 1]
    operation_sequence_zero_prepare_count: Literal[0, 1]
    operation_sequence_zero_execute_count: Literal[0, 1]
    operation_sequence_zero_affected_rows: Literal[0, 1]
    initial_stage_adoption_receipt: _SQLiteCursorInitialStageAdoptionReceipt | None
    initial_stage_adoption_receipt_mint_count: Literal[0, 1]
    receipt_consumption_count: Literal[0, 4]
    tombstone_mint_count: Literal[0, 4]
    migration_0002_consumed_tombstone: (
        _SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone | None
    )
    baseline_entries_consumed_tombstone: (
        _SQLiteBaselineEntriesPublicationReceiptConsumedTombstone | None
    )
    baseline_header_consumed_tombstone: (
        _SQLiteBaselineHeaderPublicationReceiptConsumedTombstone | None
    )
    operation_sequence_zero_consumed_tombstone: (
        _SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone | None
    )
    write_phase: _WritePhase


@dataclass(slots=True)
class _CancellationState:
    cancelled: bool = False


@dataclass(frozen=True, slots=True)
class _SourceHeaderCommitment:
    """Preparation-time source scalars independent of mutable authority state."""

    captured_at_ms: int
    source_descriptor_hash: str
    source_migration_lineage_id: str
    source_migration_lineage_sha256: str
    source_schema_identity_sha256: str


@dataclass(slots=True, weakref_slot=True)
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
    source_header_commitment: _SourceHeaderCommitment
    source_descriptor_hash: str
    source_migration_lineage_id: str
    source_migration_lineage_sha256: str
    source_schema_identity_sha256: str
    captured_at_ms: int
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
    post_ddl_publication_reader_lease: _SQLiteCursorPostDdlPublicationReaderLease | None = None
    post_ddl_publication_reader_lease_mint_count: Literal[0, 1] = 0
    post_ddl_publication_reader_lease_close_count: Literal[0, 1] = 0
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt | None = None
    baseline_entries_publication_receipt_mint_count: Literal[0, 1] = 0
    baseline_entries_logical_execution_count: Literal[0, 1] = 0
    baseline_entries_prepare_count: Literal[0, 1] = 0
    baseline_entries_execute_count: int = 0
    baseline_entries_affected_rows: int = 0
    baseline_header_publication_receipt: _SQLiteBaselineHeaderPublicationReceipt | None = None
    baseline_header_publication_receipt_mint_count: Literal[0, 1] = 0
    baseline_header_logical_execution_count: Literal[0, 1] = 0
    baseline_header_prepare_count: Literal[0, 1] = 0
    baseline_header_execute_count: Literal[0, 1] = 0
    baseline_header_affected_rows: Literal[0, 1] = 0
    operation_sequence_zero_publication_receipt: (
        _SQLiteOperationSequenceZeroPublicationReceipt | None
    ) = None
    operation_sequence_zero_publication_receipt_mint_count: Literal[0, 1] = 0
    operation_sequence_zero_logical_execution_count: Literal[0, 1] = 0
    operation_sequence_zero_prepare_count: Literal[0, 1] = 0
    operation_sequence_zero_execute_count: Literal[0, 1] = 0
    operation_sequence_zero_affected_rows: Literal[0, 1] = 0
    initial_stage_adoption_receipt: _SQLiteCursorInitialStageAdoptionReceipt | None = None
    initial_stage_adoption_receipt_mint_count: Literal[0, 1] = 0
    receipt_consumption_count: Literal[0, 4] = 0
    tombstone_mint_count: Literal[0, 4] = 0
    migration_0002_consumed_tombstone: (
        _SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone | None
    ) = None
    baseline_entries_consumed_tombstone: (
        _SQLiteBaselineEntriesPublicationReceiptConsumedTombstone | None
    ) = None
    baseline_header_consumed_tombstone: (
        _SQLiteBaselineHeaderPublicationReceiptConsumedTombstone | None
    ) = None
    operation_sequence_zero_consumed_tombstone: (
        _SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone | None
    ) = None
    write_phase: _WritePhase = "ready-0002"
    publication_prepared_owner: _SQLiteCursorPublicationSessionPreparedOwner | None = None
    publication_session: ReferenceType[_SQLiteCursorPublicationSession] | None = None


@dataclass(slots=True)
class _PublicationPreparedState:
    authority_ref: ReferenceType[_SQLiteCursorOuterPublicationAuthority]
    adoption_receipt_ref: ReferenceType[_SQLiteCursorInitialStageAdoptionReceipt]
    lower_tail: _SQLiteCursorStageOwnershipPublicationSessionTail | None
    lifecycle: Literal["prepared", "published", "poisoned"] = "prepared"
    observed_evidence: _ClockEvidence | None = None


@dataclass(slots=True, weakref_slot=True)
class _PublicationSessionState:
    prepared_owner: _SQLiteCursorPublicationSessionPreparedOwner
    authority: _SQLiteCursorOuterPublicationAuthority
    adoption_receipt: _SQLiteCursorInitialStageAdoptionReceipt
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    receipt: SQLiteCursorPreRebindReceipt
    projection_reference: SQLiteCursorExactProjectionReference
    projection_identity: BaselineProjectionIdentity
    transfer: _SQLiteCursorStageOwnershipTransfer
    transaction_generation: object
    migration_lock_capability: _MigrationLockCapability
    migration_lock_identity: object
    provider_clock_capability: _ProviderClockCapability
    outer_clock_evidence: _ClockEvidence
    outer_provider_now_ms: int
    pre_rebind_clock_evidence: _ClockEvidence
    pre_rebind_provider_now_ms: int
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence
    source_descriptor_hash: str
    source_schema_identity: str
    target_descriptor_hash: str
    target_schema_identity: str
    consumed_tombstone: _ConsumedClockTombstone | None = None
    lifecycle: Literal["pending", "publication-active", "poisoned"] = "pending"


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


@dataclass(slots=True)
class _PostDdlPublicationReaderLeaseRecord:
    authority_id: int
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]
    baseline_id: str
    close_attempt_count: Literal[0, 1]
    close_error_code: str | None
    close_succeeded: bool
    execute_count: Literal[0, 1]
    expected_entry_count: int
    expected_final_entry_hash: str
    expected_first_entry_hash: str
    expected_legacy_operation_count: int
    expected_projection_sha256: str
    fence_id: int
    fence_ref: ReferenceType[_SQLiteCursorPostDdlCatalogFence]
    fetch_count: int
    lifecycle: _ReaderLifecycle
    migration_0002_receipt_id: int
    migration_0002_receipt_ref: ReferenceType[_SQLiteMigration0002CatalogRebuildReceipt]
    outer_ledger_read_watermark: _SQLiteCursorOuterPublicationLedgerSnapshot
    ownership_acquisition_count: Literal[0, 1]
    prepare_count: Literal[0, 1]
    projection_reference_id: int
    projection_reference_ref: ReferenceType[SQLiteCursorExactProjectionReference]
    rederived_projection: BaselineProjectionIdentity | None
    retained_entries: tuple[BaselineEntry, ...] | None
    stage_id: int
    stage_ref: ReferenceType[SQLiteV1BaselineTempStage]
    total_changes_read_watermark: int
    transaction_epoch: int
    transaction_generation: object
    transfer_id: int
    transfer_ref: ReferenceType[_SQLiteCursorStageOwnershipTransfer]


@dataclass(frozen=True, slots=True)
class _BaselineEntriesPublicationReceiptRecord:
    affected_rows: int
    authority_id: int
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]
    baseline_id: str
    connection_id: int
    entry_count: int
    execute_count: int
    final_entry_hash: str
    first_entry_hash: str
    fixed_insert_sql: str
    fixed_insert_sql_sha256: str
    fence_id: int
    fence_ref: ReferenceType[_SQLiteCursorPostDdlCatalogFence]
    migration_0002_receipt_id: int
    migration_0002_receipt_ref: ReferenceType[_SQLiteMigration0002CatalogRebuildReceipt]
    outer_ledger_after: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_before: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_delta: _SQLiteCursorOuterPublicationLedgerSnapshot
    parameter_sha256: str
    prepare_count: Literal[1]
    projection_identity_id: int
    projection_reference_id: int
    projection_reference_ref: ReferenceType[SQLiteCursorExactProjectionReference]
    reader_lease_id: int
    reader_lease_ref: ReferenceType[_SQLiteCursorPostDdlPublicationReaderLease]
    reader_rederived_projection_sha256: str
    result_sha256: str
    source_read_sql: str
    source_read_sql_sha256: str
    total_changes_after: int
    total_changes_before: int
    total_changes_delta: int
    transaction_epoch_after: int
    transaction_epoch_before: int
    transaction_generation: object


@dataclass(frozen=True, slots=True)
class _BaselineHeaderPublicationReceiptRecord:
    affected_rows: Literal[1]
    authority_id: int
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]
    baseline_entries_receipt_id: int
    baseline_entries_receipt_ref: ReferenceType[_SQLiteBaselineEntriesPublicationReceipt]
    baseline_id: str
    canonical_projection_sha256: str
    captured_at_ms: int
    connection_id: int
    creation_runtime: str
    creation_runtime_version: str
    entry_count: int
    execute_count: Literal[1]
    final_entry_hash: str
    first_entry_hash: str
    fixed_insert_sql: str
    fixed_insert_sql_sha256: str
    legacy_operation_count: int
    fence_id: int
    fence_ref: ReferenceType[_SQLiteCursorPostDdlCatalogFence]
    migration_0002_receipt_id: int
    migration_0002_receipt_ref: ReferenceType[_SQLiteMigration0002CatalogRebuildReceipt]
    outer_ledger_after: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_before: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_delta: _SQLiteCursorOuterPublicationLedgerSnapshot
    parameter_sha256: str
    parameter_order: tuple[str, ...]
    policy_blob_base64url: str
    policy_blob_sha256: str
    policy_blob_utf8_bytes: int
    prepare_count: Literal[1]
    projection_identity_id: int
    projection_reference_id: int
    projection_reference_ref: ReferenceType[SQLiteCursorExactProjectionReference]
    reader_lease_id: int
    reader_lease_ref: ReferenceType[_SQLiteCursorPostDdlPublicationReaderLease]
    result_sha256: str
    source_descriptor_hash: str
    source_migration_lineage_id: str
    source_migration_lineage_sha256: str
    source_schema_identity_sha256: str
    total_changes_after: int
    total_changes_before: int
    transaction_epoch_after: int
    transaction_epoch_before: int
    transaction_generation: object


@dataclass(frozen=True, slots=True)
class _OperationSequenceZeroPublicationReceiptRecord:
    affected_rows: Literal[1]
    authority_id: int
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]
    baseline_captured_at_ms: int
    baseline_entries_receipt_id: int
    baseline_entries_receipt_ref: ReferenceType[_SQLiteBaselineEntriesPublicationReceipt]
    baseline_header_receipt_id: int
    baseline_header_receipt_ref: ReferenceType[_SQLiteBaselineHeaderPublicationReceipt]
    baseline_id: str
    connection_id: int
    execute_count: Literal[1]
    fixed_insert_sql: str
    fixed_insert_sql_sha256: str
    last_commit_sequence: Literal[0]
    migration_0002_receipt_id: int
    migration_0002_receipt_ref: ReferenceType[_SQLiteMigration0002CatalogRebuildReceipt]
    outer_clock_evidence_id: int
    outer_clock_evidence_ref: ReferenceType[_ClockEvidence]
    outer_ledger_after: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_before: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_ledger_delta: _SQLiteCursorOuterPublicationLedgerSnapshot
    outer_provider_now_ms: int
    parameter_order: tuple[str, ...]
    parameter_sha256: str
    fence_id: int
    fence_ref: ReferenceType[_SQLiteCursorPostDdlCatalogFence]
    prepare_count: Literal[1]
    projection_identity_id: int
    projection_reference_id: int
    projection_reference_ref: ReferenceType[SQLiteCursorExactProjectionReference]
    reader_lease_id: int
    reader_lease_ref: ReferenceType[_SQLiteCursorPostDdlPublicationReaderLease]
    result_sha256: str
    total_changes_after: int
    total_changes_before: int
    transaction_epoch_after: int
    transaction_epoch_before: int
    transaction_generation: object
    updated_at_ms: int


_InitialAdoptionLifecycle: TypeAlias = Literal["pending", "active", "poisoned"]


@dataclass(slots=True)
class _ConsumedReceiptTombstoneRecord:
    lifecycle: _InitialAdoptionLifecycle
    original_receipt_id: int
    original_receipt_ref: ReferenceType[object]
    adoption_receipt_id: int
    adoption_receipt_ref: ReferenceType[_SQLiteCursorInitialStageAdoptionReceipt]


@dataclass(slots=True)
class _InitialStageAdoptionReceiptRecord:
    lifecycle: _InitialAdoptionLifecycle
    mint_count: Literal[1]
    write_kind: Literal["initial-publication-stage-adoption"]
    authority_id: int
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]
    connection_id: int
    stage_id: int
    stage_ref: ReferenceType[SQLiteV1BaselineTempStage]
    receipt_id: int
    receipt_ref: ReferenceType[SQLiteCursorPreRebindReceipt]
    projection_identity_id: int
    projection_reference_id: int
    projection_reference_ref: ReferenceType[SQLiteCursorExactProjectionReference]
    transfer_id: int
    transfer_ref: ReferenceType[_SQLiteCursorStageOwnershipTransfer]
    migration_0002_receipt_id: int
    migration_0002_receipt_ref: ReferenceType[_SQLiteMigration0002CatalogRebuildReceipt]
    baseline_entries_receipt_id: int
    baseline_entries_receipt_ref: ReferenceType[_SQLiteBaselineEntriesPublicationReceipt]
    baseline_header_receipt_id: int
    baseline_header_receipt_ref: ReferenceType[_SQLiteBaselineHeaderPublicationReceipt]
    operation_sequence_zero_receipt_id: int
    operation_sequence_zero_receipt_ref: ReferenceType[
        _SQLiteOperationSequenceZeroPublicationReceipt
    ]
    migration_0002_tombstone_id: int
    migration_0002_tombstone_ref: ReferenceType[
        _SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone
    ]
    baseline_entries_tombstone_id: int
    baseline_entries_tombstone_ref: ReferenceType[
        _SQLiteBaselineEntriesPublicationReceiptConsumedTombstone
    ]
    baseline_header_tombstone_id: int
    baseline_header_tombstone_ref: ReferenceType[
        _SQLiteBaselineHeaderPublicationReceiptConsumedTombstone
    ]
    operation_sequence_zero_tombstone_id: int
    operation_sequence_zero_tombstone_ref: ReferenceType[
        _SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone
    ]
    fence_id: int
    fence_ref: ReferenceType[_SQLiteCursorPostDdlCatalogFence]
    reader_lease_id: int
    reader_lease_ref: ReferenceType[_SQLiteCursorPostDdlPublicationReaderLease]
    retired_b2_fence_id: int
    retired_b2_fence_ref: ReferenceType[_SQLiteBaselineCursorB2FenceRetirement]
    watermark: _SQLiteCursorInitialPublicationStageWatermark
    adopted_outer_ledger: _SQLiteCursorOuterPublicationLedgerSnapshot
    adopted_total_changes: int
    adopted_transaction_epoch: int
    target_catalog_sha256: str


class _CheckedInitialPublicationBundle(NamedTuple):
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt
    migration_0002_record: _Migration0002ReceiptRecord
    baseline_entries_receipt: _SQLiteBaselineEntriesPublicationReceipt
    baseline_entries_record: _BaselineEntriesPublicationReceiptRecord
    baseline_header_receipt: _SQLiteBaselineHeaderPublicationReceipt
    baseline_header_record: _BaselineHeaderPublicationReceiptRecord
    operation_sequence_zero_receipt: _SQLiteOperationSequenceZeroPublicationReceipt
    operation_sequence_zero_record: _OperationSequenceZeroPublicationReceiptRecord


class _IdentityEntry(NamedTuple):
    key_ref: ReferenceType[object]
    value: object


class _WeakPublicationSessionState(NamedTuple):
    authority_ref: ReferenceType[_SQLiteCursorOuterPublicationAuthority]
    state_ref: ReferenceType[_PublicationSessionState]


class _AuthorityLink(NamedTuple):
    key_ref: ReferenceType[object]
    authority_ref: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority]


_CANCELLATIONS: dict[int, _IdentityEntry] = {}
_PUBLICATION_CANCELLATIONS: dict[int, _IdentityEntry] = {}
_AUTHORITIES: dict[int, _IdentityEntry] = {}
_PUBLICATION_PREPARED: dict[int, _IdentityEntry] = {}
_PUBLICATION_PREPARED_BY_AUTHORITY: dict[int, _IdentityEntry] = {}
_PUBLICATION_SESSIONS: dict[int, _IdentityEntry] = {}
_AUTHORITY_BY_EVIDENCE: dict[int, _AuthorityLink] = {}
_AUTHORITY_BY_TRANSFER: dict[int, _AuthorityLink] = {}
_MIGRATION_0002_RECEIPTS: dict[int, _IdentityEntry] = {}
_POST_DDL_CATALOG_FENCES: dict[int, _IdentityEntry] = {}
_POST_DDL_PUBLICATION_READER_LEASES: dict[int, _IdentityEntry] = {}
_BASELINE_ENTRIES_PUBLICATION_RECEIPTS: dict[int, _IdentityEntry] = {}
_BASELINE_HEADER_PUBLICATION_RECEIPTS: dict[int, _IdentityEntry] = {}
_OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS: dict[int, _IdentityEntry] = {}
_MIGRATION_0002_RECEIPT_CONSUMPTIONS: dict[int, _IdentityEntry] = {}
_BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS: dict[int, _IdentityEntry] = {}
_BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS: dict[int, _IdentityEntry] = {}
_OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS: dict[int, _IdentityEntry] = {}
_INITIAL_STAGE_ADOPTION_RECEIPTS: dict[int, _IdentityEntry] = {}
_INITIAL_STAGE_ADOPTION_TOMBSTONES: dict[int, _IdentityEntry] = {}

# Capture every replaceable dependency before any caller can alter its module or
# class attribute.  Registry lookup below also checks the weak referent with
# ``is`` so equality and hash hooks are never authority.
_ID = id
_TYPE = type
_REF = ref
_STABLE_ID = _ID
_STABLE_TYPE = _TYPE
_STABLE_REF = _REF
_OBJECT_GETATTRIBUTE = object.__getattribute__
_OBJECT_SETATTR = object.__setattr__
_AUTHORITY_SESSION_SLOT = (
    "_SQLiteCursorStageOwnershipOuterPublicationAuthority__publication_session"
)
_AUTHORITY_SESSION_STATE_SLOT = (
    "_SQLiteCursorStageOwnershipOuterPublicationAuthority__publication_session_state"
)
_AUTHORITY_STATE_SLOT = "_SQLiteCursorStageOwnershipOuterPublicationAuthority__publication_state"
_SESSION_STATE_SLOT = "_SQLiteCursorPublicationSession__state"
_DICT_GET = dict.get
_DICT_SETITEM = dict.__setitem__
_DICT_POP = dict.pop
_TUPLE_LEN = tuple.__len__
_TUPLE_GETITEM = tuple.__getitem__
_WEAK_KEY_GET = WeakKeyDictionary.get
_RECEIPT_PROVENANCE = assert_sqlite_cursor_pre_rebind_receipt_provenance
_OWNERSHIP_ASSERT_COMPLETE = _assert_sqlite_cursor_stage_ownership_pre_rebind_complete_intrinsic
_OWNERSHIP_MINT_OUTER = _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic
_OWNERSHIP_ASSERT_PREPARED = (
    _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic
)
_OWNERSHIP_PUBLISH_OUTER = _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic
_OWNERSHIP_ASSERT_OWNED = _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic
_OWNERSHIP_PREPARE_INITIAL_ADOPTION = (
    _prepare_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic
)
_OWNERSHIP_PUBLISH_INITIAL_ADOPTION = (
    _publish_sqlite_cursor_stage_ownership_initial_publication_adoption_intrinsic
)
_OWNERSHIP_ASSERT_INITIAL_ADOPTED = (
    _assert_sqlite_cursor_stage_ownership_initial_publication_adopted_intrinsic
)
_OWNERSHIP_PREPARE_PUBLICATION_SESSION = (
    _prepare_sqlite_cursor_stage_ownership_publication_session_intrinsic
)
_OWNERSHIP_PREPARE_PUBLICATION_SESSION_COMMIT = (
    _prepare_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic
)
_OWNERSHIP_BURN_PUBLICATION_SESSION_COMMIT = (
    _burn_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic
)
_OWNERSHIP_PUBLISH_PUBLICATION_SESSION_COMMIT = (
    _publish_sqlite_cursor_stage_ownership_publication_session_commit_intrinsic
)
_OWNERSHIP_BURN_PUBLICATION_SESSION = (
    _burn_sqlite_cursor_stage_ownership_publication_session_intrinsic
)
_OWNERSHIP_PUBLISH_PUBLICATION_SESSION = (
    _publish_sqlite_cursor_stage_ownership_publication_session_intrinsic
)
_OWNERSHIP_ASSERT_PUBLICATION_SESSION = (
    _assert_sqlite_cursor_stage_ownership_publication_session_intrinsic
)
_OBSERVE_CLOCK = _observe_provider_clock_intrinsic
_ASSERT_CLOCK_PREDECESSOR = _assert_clock_evidence_predecessor_intrinsic
_ASSERT_CLOCK_TOMBSTONE = _assert_consumed_clock_tombstone_intrinsic
_ASSERT_PREPARED_SECOND_CLOCK = _assert_prepared_second_boundary_graph_intrinsic
_ASSERT_ACTIVE_SECOND_CLOCK = _assert_active_second_boundary_graph_intrinsic
_OWNERSHIP_REGISTER_POST_DDL_READER = (
    _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic
)
_OWNERSHIP_COMPLETE_POST_DDL_READER = (
    _complete_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic
)
_OWNERSHIP_ASSERT_POST_DDL_READER_TERMINAL = (
    _assert_sqlite_cursor_stage_ownership_post_ddl_reader_terminal_intrinsic
)
_OWNERSHIP_RETIRE = _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic
_OWNERSHIP_POISON = _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic
_CONSUME_CLOCK = _consume_provider_clock_evidence_intrinsic
_READ_CLOCK_EVIDENCE = _read_clock_evidence_snapshot_intrinsic
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
_OWNER_PREPARE_POST_DDL_BASELINE_SOURCE = (
    _prepare_sqlite_connection_post_ddl_publication_reader_intrinsic
)
_OWNER_EXECUTE_POST_DDL_BASELINE_SOURCE = (
    _execute_sqlite_connection_post_ddl_publication_reader_intrinsic
)
_CURSOR_FETCHONE = _fetch_next_owned_sqlite_connection_post_ddl_publication_reader_intrinsic
_CURSOR_CLOSE = _close_owned_sqlite_connection_post_ddl_publication_reader_intrinsic
_ABORT_PREOWNERSHIP_READER = _close_owned_sqlite_connection_post_ddl_publication_reader_intrinsic
_READ_POST_DDL_BASELINE_SOURCE = (
    _read_sqlite_connection_post_ddl_publication_reader_snapshot_intrinsic
)
_ACCUMULATOR_CONSTRUCT = BaselineAccumulator
_ACCUMULATOR_APPEND = BaselineAccumulator.append
_ACCUMULATOR_FINISH = BaselineAccumulator.finish
_CAPTURE_BASELINE_ENTRY = capture_baseline_entry
_JSON_LOADS = json.loads
_SHA256 = hashlib.sha256
_LOAD_MIGRATION_0002_ASSET = _load_sqlite_cursor_migration_0002_asset_intrinsic
_READ_MIGRATION_0002_ASSET = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic
_READ_TARGET_CATALOG = _read_target_catalog_observation_intrinsic
_READ_VALIDATED_TARGET_CATALOG = _read_validated_target_catalog_intrinsic
_BEGIN_MIGRATION_0002 = _begin_sqlite_connection_migration_0002_execution_intrinsic
_EXECUTE_NEXT_MIGRATION_0002 = _execute_next_sqlite_connection_migration_0002_statement_intrinsic
_READ_MIGRATION_0002_PROGRESS = _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic
_BEGIN_BASELINE_ENTRY_PUBLICATION = (
    _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic
)
_EXECUTE_NEXT_BASELINE_ENTRY = (
    _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic
)
_READ_BASELINE_ENTRY_PUBLICATION_PROGRESS = (
    _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic
)
_BEGIN_BASELINE_HEADER_PUBLICATION = (
    _begin_sqlite_connection_baseline_header_publication_execution_intrinsic
)
_EXECUTE_BASELINE_HEADER = _execute_sqlite_connection_baseline_header_publication_intrinsic
_READ_BASELINE_HEADER_PUBLICATION_PROGRESS = (
    _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic
)
_BEGIN_OPERATION_SEQUENCE_ZERO = (
    _begin_sqlite_connection_operation_sequence_zero_execution_intrinsic
)
_EXECUTE_OPERATION_SEQUENCE_ZERO = _execute_sqlite_connection_operation_sequence_zero_intrinsic
_READ_OPERATION_SEQUENCE_ZERO_PROGRESS = (
    _read_sqlite_connection_operation_sequence_zero_execution_snapshot_intrinsic
)
_DIGEST_INITIAL_WRITE_PARAMETERS = _digest_sqlite_initial_write_parameters_intrinsic
_DIGEST_INITIAL_WRITE_RESULT = _digest_sqlite_initial_write_result_intrinsic
_DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER = _digest_sqlite_initial_write_parameters_intrinsic
_DIGEST_INITIAL_WRITE_RESULT_VERIFIER = _digest_sqlite_initial_write_result_intrinsic
_URLSAFE_B64ENCODE = urlsafe_b64encode
_ENCODE_BASELINE_POLICY = encode_baseline_policy
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
    key_id = _STABLE_ID(key)

    def retire(dead: ReferenceType[object]) -> None:
        _retire_dead_entry(registry, key_id, dead)

    key_ref = _STABLE_REF(key, retire)
    _DICT_SETITEM(registry, key_id, _IdentityEntry(key_ref, value))


def _identity_get(
    registry: dict[int, _IdentityEntry],
    key: object,
    exact_type: type[object],
    _type: Callable[[object], type[object]] = _STABLE_TYPE,
    _dictionary_get: Callable[..., Any] = _DICT_GET,
    _identity: Callable[[object], int] = _STABLE_ID,
) -> object | None:
    if _type(key) is not exact_type:
        return None
    entry = _dictionary_get(registry, _identity(key))
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
    key_id = _STABLE_ID(key)

    def retire_key(dead: ReferenceType[object]) -> None:
        _retire_dead_link(registry, key_id, dead)

    def retire_authority(
        dead: ReferenceType[_SQLiteCursorStageOwnershipOuterPublicationAuthority],
    ) -> None:
        _retire_dead_link(registry, key_id, cast(ReferenceType[object], dead))

    key_ref = _STABLE_REF(key, retire_key)
    authority_ref = _STABLE_REF(authority, retire_authority)
    _DICT_SETITEM(registry, key_id, _AuthorityLink(key_ref, authority_ref))


def _link_get(
    registry: dict[int, _AuthorityLink],
    key: object,
    exact_type: type[object],
) -> _SQLiteCursorOuterPublicationAuthority | None:
    if _STABLE_TYPE(key) is not exact_type:
        return None
    entry = _DICT_GET(registry, _STABLE_ID(key))
    if entry is None or entry.key_ref() is not key:
        return None
    return entry.authority_ref()


def _authority_state(authority: object) -> _AuthorityState:
    registered = _identity_get(
        _AUTHORITIES,
        authority,
        _SQLiteCursorStageOwnershipOuterPublicationAuthority,
    )
    state = registered if isinstance(registered, _AuthorityState) else None
    try:
        anchored = _OBJECT_GETATTRIBUTE(authority, _AUTHORITY_STATE_SLOT)
    except (AttributeError, TypeError):
        anchored = None
    if state is None:
        _fail("GE_CURSOR_B3_OUTER_AUTHORITY")
    if anchored is not state:
        _poison(
            state,
            cast(_SQLiteCursorOuterPublicationAuthority, authority),
            "SQLite outer-publication private state drifted",
        )
        _fail("GE_CURSOR_B3_OUTER_AUTHORITY")
    return state


def _bind_authority_state(
    authority: _SQLiteCursorOuterPublicationAuthority,
    state: _AuthorityState,
) -> None:
    if _OBJECT_GETATTRIBUTE(authority, _AUTHORITY_STATE_SLOT) is not None:
        _fail("GE_CURSOR_B3_OUTER_AUTHORITY")
    _OBJECT_SETATTR(authority, _AUTHORITY_STATE_SLOT, state)
    _identity_set(_AUTHORITIES, authority, state)


def _anchored_publication_session(
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> _SQLiteCursorPublicationSession | None:
    value = _OBJECT_GETATTRIBUTE(authority, _AUTHORITY_SESSION_SLOT)
    return value if _STABLE_TYPE(value) is _SQLiteCursorPublicationSession else None


def _bind_publication_session_state(
    session: _SQLiteCursorPublicationSession,
    state: _PublicationSessionState,
) -> None:
    if _OBJECT_GETATTRIBUTE(session, _SESSION_STATE_SLOT) is not None:
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION")
    _OBJECT_SETATTR(session, _SESSION_STATE_SLOT, state)
    _identity_set(
        _PUBLICATION_SESSIONS,
        session,
        _WeakPublicationSessionState(
            _STABLE_REF(state.authority),
            _STABLE_REF(state),
        ),
    )


def _publication_session_state(
    session: object,
) -> _PublicationSessionState:
    registered = _identity_get(
        _PUBLICATION_SESSIONS,
        session,
        _SQLiteCursorPublicationSession,
    )
    authority = (
        registered.authority_ref() if isinstance(registered, _WeakPublicationSessionState) else None
    )
    authority_anchor = (
        _OBJECT_GETATTRIBUTE(authority, _AUTHORITY_SESSION_STATE_SLOT)
        if authority is not None
        else None
    )
    registered_state = (
        registered.state_ref() if isinstance(registered, _WeakPublicationSessionState) else None
    )
    # Only the state reached through the authenticated session registry is
    # canonical.  Private anchors are redundant identity witnesses and must
    # never become a writable failure target.
    state = registered_state
    try:
        anchored = _OBJECT_GETATTRIBUTE(session, _SESSION_STATE_SLOT)
    except (AttributeError, TypeError):
        anchored = None
    if (
        state is None
        or registered_state is not state
        or authority_anchor is not state
        or anchored is not state
        or authority is None
        or _anchored_publication_session(authority) is not session
    ):
        if authority is not None:
            authority_state = _authority_state(authority)
            if state is not None:
                state.lifecycle = "poisoned"
            _poison(
                authority_state,
                authority,
                "SQLite publication-session private state drifted",
            )
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION")
    return state


def _clock_graph(
    connection: SQLiteV1BaselineConnectionOwner,
    migration_lock_capability: _MigrationLockCapability,
    provider_clock_capability: _ProviderClockCapability,
    outer_clock_evidence: _ClockEvidence,
) -> tuple[object, int, int]:
    if (
        _STABLE_TYPE(migration_lock_capability) is not _MigrationLockCapability
        or _STABLE_TYPE(provider_clock_capability) is not _ProviderClockCapability
        or _STABLE_TYPE(outer_clock_evidence) is not _ClockEvidence
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
        or evidence_state.capability() is not provider_clock_capability
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
    if _STABLE_TYPE(tombstone) is not _ConsumedClockTombstone:
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
        or evidence_state.capability() is not state.provider_clock_capability
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
        or _STABLE_TYPE(epoch) is not int
        or epoch < 0
        or _STABLE_TYPE(total_changes) is not int
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
    if state.lifecycle == "retired":
        return
    state.lifecycle = "poisoned"
    state.write_phase = "poisoned"
    state.stage_ownership_poison_reason = reason
    try:
        _OWNERSHIP_POISON(state.transfer, authority, reason)
    except BaseException:
        # Once the outer graph has authenticated the exact transfer and
        # authority, a corrupted lower lifecycle must not prevent terminal
        # poison from reaching the transfer and stage.  Restore only the
        # lower poison entry classification, then immediately burn it.
        metadata = _WEAK_KEY_GET(_OWNERSHIP_TRANSFERS, state.transfer)
        if (
            metadata is not None
            and metadata.outer_authority_ref is not None
            and metadata.outer_authority_ref() is authority
        ):
            metadata.lifecycle = "outer-publication-owned"
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
    source_envelope = provenance.source_summary.source_envelope
    source_descriptor_hash = source_envelope.get("sourceDescriptorHash")
    source_migration_lineage_id = source_envelope.get("sourceMigrationLineageId")
    source_migration_lineage_sha256 = source_envelope.get("sourceMigrationLineageSha256")
    source_schema_identity_sha256 = source_envelope.get("sourceSchemaIdentitySha256")
    captured_at_ms = source_envelope.get("capturedAtMs")
    if (
        _STABLE_TYPE(source_descriptor_hash) is not str
        or len(source_descriptor_hash) != 64
        or source_descriptor_hash != seal.source_descriptor_hash
        or _STABLE_TYPE(source_migration_lineage_id) is not str
        or not source_migration_lineage_id
        or _STABLE_TYPE(source_migration_lineage_sha256) is not str
        or len(source_migration_lineage_sha256) != 64
        or _STABLE_TYPE(source_schema_identity_sha256) is not str
        or len(source_schema_identity_sha256) != 64
        or source_schema_identity_sha256 != seal.source_schema_identity_sha256
        or _STABLE_TYPE(captured_at_ms) is not int
        or not 0 <= captured_at_ms <= _MAX_SAFE_INTEGER
    ):
        _fail("GE_CURSOR_B3_OUTER_SOURCE_ENVELOPE")
    source_header_commitment = _SourceHeaderCommitment(
        captured_at_ms=captured_at_ms,
        source_descriptor_hash=source_descriptor_hash,
        source_migration_lineage_id=source_migration_lineage_id,
        source_migration_lineage_sha256=source_migration_lineage_sha256,
        source_schema_identity_sha256=source_schema_identity_sha256,
    )
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
        source_header_commitment=source_header_commitment,
        source_descriptor_hash=source_header_commitment.source_descriptor_hash,
        source_migration_lineage_id=source_migration_lineage_id,
        source_migration_lineage_sha256=source_migration_lineage_sha256,
        source_schema_identity_sha256=(source_header_commitment.source_schema_identity_sha256),
        captured_at_ms=captured_at_ms,
        outer_provider_now_ms=outer_provider_now_ms,
        current_transaction_epoch=epoch,
        current_total_changes=changes,
    )
    _bind_authority_state(authority, state)
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
        _poison(state, authority, "SQLite outer-publication poison propagation")
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
        if state.write_phase == "publication-active":
            prepared_owner = state.publication_prepared_owner
            session = state.publication_session() if state.publication_session is not None else None
            if (
                prepared_owner is None
                or session is None
                or _anchored_publication_session(authority) is not session
            ):
                _fail("GE_CURSOR_B3_PUBLICATION_SESSION")
            _OWNERSHIP_ASSERT_PUBLICATION_SESSION(
                state.connection,
                state.stage,
                state.receipt,
                state.projection_identity,
                state.transfer,
                authority,
                prepared_owner,
                session,
            )
        elif state.write_phase == "initial-stage-adoption-complete":
            _assert_adopted_stage_ownership_from_state(state, authority)
        elif (
            state.write_phase == "sequence-zero-complete"
            and state.post_ddl_publication_reader_lease is not None
        ):
            # The lower owner may already be in its retryable adoption-prepared
            # state after a cancellation.  Its terminal-reader proof accepts
            # both owned and adoption-prepared without exposing that state.
            _OWNERSHIP_ASSERT_POST_DDL_READER_TERMINAL(
                state.transfer,
                authority,
                state.post_ddl_publication_reader_lease,
            )
        else:
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
        if _STABLE_TYPE(legacy_count) is not int or not 0 <= legacy_count < _MAX_SAFE_INTEGER:
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
                authority_ref=_STABLE_REF(authority),
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
    if (
        _identity_get(
            _MIGRATION_0002_RECEIPT_CONSUMPTIONS,
            receipt,
            _SQLiteMigration0002CatalogRebuildReceipt,
        )
        is not None
    ):
        _fail("GE_CURSOR_B3_MIGRATION_0002_RECEIPT_CONSUMED")
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
        _STABLE_TYPE(catalog) is _TargetCatalogSnapshot
        and _STABLE_TYPE(retained) is _TargetCatalogSnapshot
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
        or _STABLE_ID(authority) != record.authority_id
        or _STABLE_ID(receipt) != record.migration_0002_receipt_id
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
                authority_id=_STABLE_ID(authority),
                authority_ref=_STABLE_REF(authority),
                catalog_application_id=catalog.application_id,
                catalog_canonical_utf8_bytes=catalog.canonical_utf8_bytes,
                catalog_inventory=catalog.inventory,
                catalog_row_count=catalog.row_count,
                catalog_sha256=catalog.catalog_sha256,
                catalog_user_version=catalog.user_version,
                migration_0002_receipt_id=_STABLE_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_STABLE_REF(migration_0002_receipt),
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
        record.authority_id != _STABLE_ID(authority)
        or record.authority_ref() is not authority
        or record.migration_0002_receipt_id != _STABLE_ID(migration_0002_receipt)
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
        migration_consumption = _identity_get(
            _MIGRATION_0002_RECEIPT_CONSUMPTIONS,
            migration_0002_receipt,
            _SQLiteMigration0002CatalogRebuildReceipt,
        )
        if migration_consumption is None:
            _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
                migration_0002_receipt
            )
        else:
            _assert_consumed_migration_fence_chain_intrinsic(
                state,
                authority,
                migration_0002_receipt,
                cast(_ConsumedReceiptTombstoneRecord, migration_consumption),
                fence,
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


def _same_projection_identity(
    left: BaselineProjectionIdentity,
    right: BaselineProjectionIdentity,
) -> bool:
    return (
        _STABLE_TYPE(left) is BaselineProjectionIdentity
        and _STABLE_TYPE(right) is BaselineProjectionIdentity
        and left.baseline_id == right.baseline_id
        and left.entry_count == right.entry_count
        and left.legacy_operation_count == right.legacy_operation_count
        and left.first_entry_hash == right.first_entry_hash
        and left.final_entry_hash == right.final_entry_hash
        and left.projection_sha256 == right.projection_sha256
    )


def _post_ddl_publication_reader_record(
    lease: _SQLiteCursorPostDdlPublicationReaderLease,
) -> _PostDdlPublicationReaderLeaseRecord:
    record = _identity_get(
        _POST_DDL_PUBLICATION_READER_LEASES,
        lease,
        _SQLiteCursorPostDdlPublicationReaderLease,
    )
    if record is None:
        _fail("GE_CURSOR_B3_POST_DDL_READER_LEASE")
    return cast(_PostDdlPublicationReaderLeaseRecord, record)


def _resolve_post_ddl_publication_reader_graph(
    record: _PostDdlPublicationReaderLeaseRecord,
) -> tuple[
    _SQLiteCursorOuterPublicationAuthority,
    _SQLiteMigration0002CatalogRebuildReceipt,
    _SQLiteCursorPostDdlCatalogFence,
    SQLiteV1BaselineTempStage,
    _SQLiteCursorStageOwnershipTransfer,
    SQLiteCursorExactProjectionReference,
]:
    authority = record.authority_ref()
    receipt = record.migration_0002_receipt_ref()
    fence = record.fence_ref()
    stage = record.stage_ref()
    transfer = record.transfer_ref()
    projection_reference = record.projection_reference_ref()
    if (
        authority is None
        or receipt is None
        or fence is None
        or stage is None
        or transfer is None
        or projection_reference is None
        or _STABLE_ID(authority) != record.authority_id
        or _STABLE_ID(receipt) != record.migration_0002_receipt_id
        or _STABLE_ID(fence) != record.fence_id
        or _STABLE_ID(stage) != record.stage_id
        or _STABLE_ID(transfer) != record.transfer_id
        or _STABLE_ID(projection_reference) != record.projection_reference_id
    ):
        _fail("GE_CURSOR_B3_POST_DDL_READER_LEASE")
    return authority, receipt, fence, stage, transfer, projection_reference


def _reader_cancellation_state(
    cancellation: _SQLiteCursorOuterPublicationCancellationSignal | None,
) -> _CancellationState | None:
    if cancellation is None:
        return None
    state = _identity_get(
        _CANCELLATIONS,
        cancellation,
        _SQLiteCursorOuterPublicationCancellationSignal,
    )
    if state is None:
        _fail("GE_CURSOR_B3_POST_DDL_READER_CANCELLATION")
    return cast(_CancellationState, state)


def _reader_watermarks_match(
    state: _AuthorityState,
    record: _PostDdlPublicationReaderLeaseRecord,
) -> bool:
    return (
        state.transaction_generation is record.transaction_generation
        and state.current_transaction_epoch == record.transaction_epoch
        and state.current_total_changes == record.total_changes_read_watermark
        and _exact_outer_ledger(
            _outer_ledger_snapshot(state),
            record.outer_ledger_read_watermark,
        )
    )


def _reader_watermarks_not_regressed(
    state: _AuthorityState,
    record: _PostDdlPublicationReaderLeaseRecord,
) -> bool:
    return (
        state.transaction_generation is record.transaction_generation
        and state.current_transaction_epoch >= record.transaction_epoch
        and state.current_total_changes >= record.total_changes_read_watermark
        and state.logical_write_sequence
        >= record.outer_ledger_read_watermark.logical_write_sequence
        and state.fixed_statement_count >= record.outer_ledger_read_watermark.fixed_statement_count
        and state.affected_rows_watermark
        >= record.outer_ledger_read_watermark.affected_rows_watermark
    )


def _expected_reader_projection(
    record: _PostDdlPublicationReaderLeaseRecord,
) -> BaselineProjectionIdentity:
    return BaselineProjectionIdentity(
        baseline_id=record.baseline_id,
        entry_count=record.expected_entry_count,
        legacy_operation_count=record.expected_legacy_operation_count,
        first_entry_hash=record.expected_first_entry_hash,
        final_entry_hash=record.expected_final_entry_hash,
        projection_sha256=record.expected_projection_sha256,
    )


def _mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
) -> _SQLiteCursorPostDdlPublicationReaderLease:
    """Mint the only lease for the package-owned ordered TEMP projection read."""

    fence_record = _post_ddl_catalog_fence_record(fence)
    state = _authority_state(authority)
    if (
        fence_record.authority_ref() is not authority
        or fence_record.migration_0002_receipt_ref() is not migration_0002_receipt
        or state.migration_0002_receipt is not migration_0002_receipt
        or state.post_ddl_catalog_fence is not fence
    ):
        _fail("GE_CURSOR_B3_POST_DDL_READER_GRAPH")
    if (
        state.post_ddl_publication_reader_lease is not None
        or state.post_ddl_publication_reader_lease_mint_count != 0
    ):
        _poison(state, authority, "SQLite post-DDL publication reader lease mint was reused")
        _fail("GE_CURSOR_B3_POST_DDL_READER_MINT_REPLAY")
    if state.write_phase != "post-ddl-catalog-fence":
        _poison(state, authority, "SQLite post-DDL publication reader lease mint was premature")
        _fail("GE_CURSOR_B3_POST_DDL_READER_PREMATURE")

    try:
        _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
            authority,
            migration_0002_receipt,
            fence,
        )
        source_sha256 = _SHA256(
            SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL.encode("utf-8")
        ).hexdigest()
        if (
            SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL
            != SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC
            or source_sha256 != SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256
        ):
            _fail("GE_CURSOR_B3_POST_DDL_READER_SQL")
        provenance = _RECEIPT_PROVENANCE(state.receipt)
        ledger = _outer_ledger_snapshot(state)
        if (
            provenance.projection_identity is not state.projection_identity
            or provenance.projection_reference is not state.projection_reference
            or state.transaction_generation is not fence_record.transaction_generation
            or state.current_transaction_epoch != fence_record.transaction_epoch
            or state.current_total_changes != fence_record.total_changes_watermark
            or not _exact_outer_ledger(ledger, fence_record.outer_ledger_watermark)
        ):
            _fail("GE_CURSOR_B3_POST_DDL_READER_WATERMARK")
        lease = _SQLiteCursorPostDdlPublicationReaderLease(_CONSTRUCTION_TOKEN)
        _identity_set(
            _POST_DDL_PUBLICATION_READER_LEASES,
            lease,
            _PostDdlPublicationReaderLeaseRecord(
                authority_id=_STABLE_ID(authority),
                authority_ref=_STABLE_REF(authority),
                baseline_id=state.projection_identity.baseline_id,
                close_attempt_count=0,
                close_error_code=None,
                close_succeeded=False,
                execute_count=0,
                expected_entry_count=state.projection_identity.entry_count,
                expected_final_entry_hash=state.projection_identity.final_entry_hash,
                expected_first_entry_hash=state.projection_identity.first_entry_hash,
                expected_legacy_operation_count=state.projection_identity.legacy_operation_count,
                expected_projection_sha256=state.projection_identity.projection_sha256,
                fence_id=_STABLE_ID(fence),
                fence_ref=_STABLE_REF(fence),
                fetch_count=0,
                lifecycle="minted-unused",
                migration_0002_receipt_id=_STABLE_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_STABLE_REF(migration_0002_receipt),
                outer_ledger_read_watermark=ledger,
                ownership_acquisition_count=0,
                prepare_count=0,
                projection_reference_id=_STABLE_ID(state.projection_reference),
                projection_reference_ref=_STABLE_REF(state.projection_reference),
                rederived_projection=None,
                retained_entries=None,
                stage_id=_STABLE_ID(state.stage),
                stage_ref=_STABLE_REF(state.stage),
                total_changes_read_watermark=state.current_total_changes,
                transaction_epoch=state.current_transaction_epoch,
                transaction_generation=state.transaction_generation,
                transfer_id=_STABLE_ID(state.transfer),
                transfer_ref=_STABLE_REF(state.transfer),
            ),
        )
        state.post_ddl_publication_reader_lease = lease
        state.post_ddl_publication_reader_lease_mint_count = 1
        return lease
    except BaseException:
        _translate_closed_fence_connection(state, authority)
        _poison(state, authority, "SQLite post-DDL publication reader lease mint failed")
        raise


def _decode_post_ddl_reader_json(value: bytes, maximum: int) -> object:
    if not 2 <= len(value) <= maximum:
        _fail("GE_CURSOR_B3_POST_DDL_READER_ROW")
    try:
        return _JSON_LOADS(value)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("GE_CURSOR_B3_POST_DDL_READER_ROW") from error


_DECODE_POST_DDL_READER_JSON = _decode_post_ddl_reader_json


def _execute_sqlite_cursor_post_ddl_publication_reader_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    lease: _SQLiteCursorPostDdlPublicationReaderLease,
    cancellation: _SQLiteCursorOuterPublicationCancellationSignal | None = None,
) -> _SQLiteCursorPostDdlPublicationReaderLease:
    """Execute the fixed read once, retain exact rows, and close ownership once."""

    record = _post_ddl_publication_reader_record(lease)
    (
        registered_authority,
        registered_receipt,
        registered_fence,
        _,
        transfer,
        projection_reference,
    ) = _resolve_post_ddl_publication_reader_graph(record)
    if (
        registered_authority is not authority
        or registered_receipt is not migration_0002_receipt
        or registered_fence is not fence
    ):
        _fail("GE_CURSOR_B3_POST_DDL_READER_GRAPH")
    state = _authority_state(authority)
    if (
        state.post_ddl_publication_reader_lease is not lease
        or state.post_ddl_publication_reader_lease_mint_count != 1
        or state.projection_reference is not projection_reference
    ):
        _fail("GE_CURSOR_B3_POST_DDL_READER_GRAPH")
    if record.lifecycle != "minted-unused":
        _poison(state, authority, "SQLite post-DDL publication reader lease was reused")
        _fail("GE_CURSOR_B3_POST_DDL_READER_REPLAY")
    cancellation_state = _reader_cancellation_state(cancellation)

    try:
        _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
            authority,
            migration_0002_receipt,
            fence,
        )
        source_sha256 = _SHA256(
            SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL.encode("utf-8")
        ).hexdigest()
        if (
            SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL
            != SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC
            or source_sha256 != SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256
            or not _reader_watermarks_match(state, record)
        ):
            _fail("GE_CURSOR_B3_POST_DDL_READER_WATERMARK")
    except BaseException:
        record.lifecycle = "poisoned"
        _translate_closed_fence_connection(state, authority)
        _poison(state, authority, "SQLite post-DDL publication reader pre-prepare failed")
        raise

    try:
        accumulator = _ACCUMULATOR_CONSTRUCT(
            record.baseline_id,
            record.expected_entry_count,
        )
        retained: list[BaselineEntry] = []
    except BaseException as error:
        record.lifecycle = "poisoned"
        _poison(state, authority, "SQLite post-DDL publication reader accumulator failed")
        raise ValueError("GE_CURSOR_B3_POST_DDL_READER_ACCUMULATOR") from error
    if cancellation_state is not None and cancellation_state.cancelled:
        _fail("GE_CURSOR_B3_POST_DDL_READER_CANCELLED")

    try:
        cursor = _OWNER_PREPARE_POST_DDL_BASELINE_SOURCE(state.connection)
        record.prepare_count = 1
    except BaseException as error:
        record.lifecycle = "poisoned"
        _poison(state, authority, "SQLite post-DDL publication reader prepare failed")
        raise ValueError("GE_CURSOR_B3_POST_DDL_READER_PREPARE") from error

    try:
        _OWNER_EXECUTE_POST_DDL_BASELINE_SOURCE(state.connection, cursor)
    except BaseException as error:
        with suppress(BaseException):
            _ABORT_PREOWNERSHIP_READER(cursor)
        record.lifecycle = "poisoned"
        _poison(state, authority, "SQLite post-DDL publication reader execute failed")
        raise ValueError("GE_CURSOR_B3_POST_DDL_READER_EXECUTE") from error

    record.execute_count = 1
    record.ownership_acquisition_count = 1
    record.lifecycle = "reader-active"
    authority_reference = _STABLE_REF(authority)
    initial_close_cause: BaseException | None = None

    def close_owned_reader() -> None:
        nonlocal initial_close_cause
        if record.close_attempt_count == 1:
            if record.close_error_code is not None:
                raise ValueError(record.close_error_code)
            return
        record.close_attempt_count = 1
        live_authority = authority_reference()
        if live_authority is not None:
            with suppress(ValueError):
                _authority_state(live_authority).post_ddl_publication_reader_lease_close_count = 1
        try:
            _CURSOR_CLOSE(cursor)
            record.close_succeeded = True
        except BaseException as error:
            record.close_error_code = "GE_CURSOR_B3_POST_DDL_READER_CLOSE"
            initial_close_cause = error
            raise ValueError(record.close_error_code) from error

    def cleanup_owned_reader() -> None:
        record.lifecycle = "poisoned"
        close_owned_reader()

    registered = False
    primary: BaseException | None = None
    try:
        _OWNERSHIP_REGISTER_POST_DDL_READER(
            transfer,
            authority,
            lease,
            cleanup_owned_reader,
        )
        registered = True
    except BaseException as error:
        primary = ValueError("GE_CURSOR_B3_POST_DDL_READER_CLEANUP_OWNERSHIP")
        primary.__cause__ = error

    cancelled_after_ownership = False
    terminal = False
    previous_rank: int | None = None
    previous_key: bytes | None = None
    maximum_fetches = record.expected_entry_count + 1
    for _ in range(maximum_fetches):
        if primary is not None:
            break
        if cancellation_state is not None and cancellation_state.cancelled:
            cancelled_after_ownership = True
            break
        try:
            record.fetch_count += 1
            row = _CURSOR_FETCHONE(cursor)
        except BaseException as error:
            primary = ValueError("GE_CURSOR_B3_POST_DDL_READER_FETCH")
            primary.__cause__ = error
            break
        if row is None:
            terminal = True
            break
        try:
            if _STABLE_TYPE(row) is not tuple or len(row) != 4:
                _fail("GE_CURSOR_B3_POST_DDL_READER_ROW")
            rank, entry_kind, key_blob, state_blob = row
            if (
                _STABLE_TYPE(rank) is not int
                or not 0 <= rank < len(BASELINE_ENTRY_KINDS)
                or _STABLE_TYPE(entry_kind) is not str
                or BASELINE_ENTRY_KINDS[rank] != entry_kind
                or _STABLE_TYPE(key_blob) is not bytes
                or _STABLE_TYPE(state_blob) is not bytes
            ):
                _fail("GE_CURSOR_B3_POST_DDL_READER_ROW")
            if previous_rank is not None and (
                rank < previous_rank
                or (rank == previous_rank and previous_key is not None and key_blob <= previous_key)
            ):
                _fail("GE_CURSOR_B3_POST_DDL_READER_ORDER")
            try:
                candidate = _CAPTURE_BASELINE_ENTRY(
                    entry_kind,
                    _DECODE_POST_DDL_READER_JSON(key_blob, MAX_BASELINE_KEY_BYTES),
                    _DECODE_POST_DDL_READER_JSON(state_blob, MAX_BASELINE_STATE_BYTES),
                )
            except BaseException as error:
                if isinstance(error, ValueError) and str(error).startswith(
                    "GE_CURSOR_B3_POST_DDL_READER_"
                ):
                    raise
                raise ValueError("GE_CURSOR_B3_POST_DDL_READER_ROW") from error
            if candidate.key_bytes != key_blob or candidate.state_bytes != state_blob:
                _fail("GE_CURSOR_B3_POST_DDL_READER_CANONICAL")
            try:
                retained.append(_ACCUMULATOR_APPEND(accumulator, candidate))
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_POST_DDL_READER_PROJECTION") from error
            previous_rank = rank
            previous_key = bytes(key_blob)
        except BaseException as error:
            primary = error
            break
        if cancellation_state is not None and cancellation_state.cancelled:
            cancelled_after_ownership = True

    rederived: BaselineProjectionIdentity | None = None
    if primary is None and terminal:
        try:
            rederived = _ACCUMULATOR_FINISH(accumulator)
            if not _same_projection_identity(rederived, _expected_reader_projection(record)):
                _fail("GE_CURSOR_B3_POST_DDL_READER_PROJECTION")
        except BaseException as error:
            if isinstance(error, ValueError) and str(error).startswith(
                "GE_CURSOR_B3_POST_DDL_READER_"
            ):
                primary = error
            else:
                translated = ValueError("GE_CURSOR_B3_POST_DDL_READER_PROJECTION")
                translated.__cause__ = error
                primary = translated
    if rederived is not None:
        record.rederived_projection = rederived

    with suppress(BaseException):
        close_owned_reader()
    outward_close_cause = initial_close_cause
    # The installed cleanup continuation may outlive this execution frame.
    # Keep only the scalar retained error in registry state; the first native
    # cause is transferred to this one outward raise and removed from the cell.
    initial_close_cause = None
    if cancellation_state is not None and cancellation_state.cancelled:
        cancelled_after_ownership = True
    if record.close_succeeded and cast(_ReaderLifecycle, record.lifecycle) != "poisoned":
        record.lifecycle = "reader-closed"
    if registered and record.close_succeeded:
        try:
            _OWNERSHIP_COMPLETE_POST_DDL_READER(
                transfer,
                authority,
                lease,
                True,
            )
        except BaseException as error:
            if primary is None and not cancelled_after_ownership:
                primary = ValueError("GE_CURSOR_B3_POST_DDL_READER_CLEANUP_COMPLETION")
                primary.__cause__ = error

    if primary is not None:
        outward_close_cause = None
        record.lifecycle = "poisoned"
        _poison(state, authority, "SQLite post-DDL publication reader proof failed")
        raise primary
    if record.close_error_code is not None or not record.close_succeeded:
        record.lifecycle = "poisoned"
        _poison(state, authority, "SQLite post-DDL publication reader close failed")
        if record.close_error_code is not None:
            cause = outward_close_cause
            outward_close_cause = None
            raise ValueError(record.close_error_code) from cause
        _fail("GE_CURSOR_B3_POST_DDL_READER_CLOSE")
    if cancelled_after_ownership:
        record.lifecycle = "poisoned"
        _poison(state, authority, "SQLite post-DDL publication reader was cancelled")
        _fail("GE_CURSOR_B3_POST_DDL_READER_CANCELLED")
    if cast(_ReaderLifecycle, record.lifecycle) == "poisoned":
        _poison(state, authority, "SQLite post-DDL publication reader owner was cleaned up")
        _fail("GE_CURSOR_B3_POST_DDL_READER_CLEANUP")

    try:
        _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
            authority,
            migration_0002_receipt,
            fence,
        )
        _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        if not _reader_watermarks_match(state, record):
            _fail("GE_CURSOR_B3_POST_DDL_READER_WATERMARK")
    except BaseException:
        record.lifecycle = "poisoned"
        _translate_closed_fence_connection(state, authority)
        _poison(state, authority, "SQLite post-DDL publication reader post-read fence failed")
        raise
    if cancelled_after_ownership or (
        cancellation_state is not None and cancellation_state.cancelled
    ):
        record.lifecycle = "poisoned"
        _poison(state, authority, "SQLite post-DDL publication reader was cancelled")
        _fail("GE_CURSOR_B3_POST_DDL_READER_CANCELLED")
    if (
        rederived is None
        or len(retained) != record.expected_entry_count
        or state.write_phase != "post-ddl-catalog-fence"
    ):
        record.lifecycle = "poisoned"
        _poison(state, authority, "SQLite post-DDL publication reader completion drifted")
        _fail("GE_CURSOR_B3_POST_DDL_READER_INCOMPLETE")
    record.retained_entries = tuple(retained)
    record.lifecycle = "retired"
    state.write_phase = "post-ddl-reader-closed"
    return lease


def _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    lease: _SQLiteCursorPostDdlPublicationReaderLease,
) -> _SQLiteCursorPostDdlPublicationReaderLease:
    """Reprove one exact retired lease without consuming it."""

    record = _post_ddl_publication_reader_record(lease)
    (
        registered_authority,
        registered_receipt,
        registered_fence,
        _,
        transfer,
        projection_reference,
    ) = _resolve_post_ddl_publication_reader_graph(record)
    if (
        registered_authority is not authority
        or registered_receipt is not migration_0002_receipt
        or registered_fence is not fence
    ):
        _fail("GE_CURSOR_B3_POST_DDL_READER_TERMINAL_GRAPH")
    if (
        record.lifecycle != "retired"
        or record.prepare_count != 1
        or record.execute_count != 1
        or record.ownership_acquisition_count != 1
        or record.close_attempt_count != 1
        or not record.close_succeeded
        or record.close_error_code is not None
        or record.rederived_projection is None
        or record.retained_entries is None
        or len(record.retained_entries) != record.expected_entry_count
    ):
        _fail("GE_CURSOR_B3_POST_DDL_READER_NOT_TERMINAL")
    state = _authority_state(authority)
    _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority)
    if (
        state.post_ddl_publication_reader_lease is not lease
        or state.post_ddl_publication_reader_lease_mint_count != 1
        or state.post_ddl_publication_reader_lease_close_count != 1
        or state.projection_reference is not projection_reference
        or state.write_phase
        not in {
            "post-ddl-reader-closed",
            "executing-baseline-entries",
            "baseline-entries-complete",
            "executing-baseline-header",
            "baseline-header-complete",
            "executing-sequence-zero",
            "sequence-zero-complete",
            "initial-stage-adoption-complete",
            "publication-active",
        }
        or not _reader_watermarks_not_regressed(state, record)
    ):
        _fail("GE_CURSOR_B3_POST_DDL_READER_TERMINAL_GRAPH")
    _OWNERSHIP_ASSERT_POST_DDL_READER_TERMINAL(transfer, authority, lease)
    _assert_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
        authority,
        migration_0002_receipt,
        fence,
    )
    if not _same_projection_identity(
        record.rederived_projection,
        _expected_reader_projection(record),
    ):
        _fail("GE_CURSOR_B3_POST_DDL_READER_PROJECTION")
    return lease


def _read_sqlite_cursor_post_ddl_publication_reader_lease_snapshot_intrinsic(
    lease: _SQLiteCursorPostDdlPublicationReaderLease,
) -> _SQLiteCursorPostDdlPublicationReaderLeaseSnapshot:
    record = _post_ddl_publication_reader_record(lease)
    authority, receipt, fence, stage, transfer, projection_reference = (
        _resolve_post_ddl_publication_reader_graph(record)
    )
    if record.lifecycle == "retired":
        _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic(
            authority,
            receipt,
            fence,
            lease,
        )
    state = _authority_state(authority)
    rederived = record.rederived_projection
    return _SQLiteCursorPostDdlPublicationReaderLeaseSnapshot(
        authority=authority,
        close_attempt_count=record.close_attempt_count,
        close_succeeded=record.close_succeeded,
        connection=state.connection,
        consumes_any_write_receipt=False,
        read_proof_epoch=record.transaction_epoch,
        execute_count=record.execute_count,
        fetch_count=record.fetch_count,
        lifecycle=record.lifecycle,
        may_mint_stage_adoption_receipt=False,
        migration_0002_receipt=receipt,
        mint_count=1,
        outer_ledger_read_watermark=record.outer_ledger_read_watermark,
        ownership_acquisition_count=record.ownership_acquisition_count,
        permanent_write_authority=False,
        post_ddl_catalog_fence=fence,
        prepare_count=record.prepare_count,
        projection_identity=state.projection_identity,
        projection_reference=projection_reference,
        rederived_entry_count=None if rederived is None else rederived.entry_count,
        rederived_final_entry_hash=None if rederived is None else rederived.final_entry_hash,
        rederived_first_entry_hash=None if rederived is None else rederived.first_entry_hash,
        rederived_legacy_operation_count=(
            None if rederived is None else rederived.legacy_operation_count
        ),
        rederived_projection_sha256=None if rederived is None else rederived.projection_sha256,
        source_read_sql=SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL,
        source_read_sql_sha256=SQLITE_CURSOR_POST_DDL_PUBLICATION_READER_SOURCE_SQL_SHA256,
        stage=stage,
        total_changes_read_watermark=record.total_changes_read_watermark,
        transaction_generation=record.transaction_generation,
        transaction_epoch=record.transaction_epoch,
        transfer=transfer,
    )


def _read_sqlite_cursor_post_ddl_publication_reader_entries_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    lease: _SQLiteCursorPostDdlPublicationReaderLease,
) -> tuple[BaselineEntry, ...]:
    """Return the immutable private rows only to the next authenticated writer."""

    _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic(
        authority,
        migration_0002_receipt,
        fence,
        lease,
    )
    retained = _post_ddl_publication_reader_record(lease).retained_entries
    if retained is None:
        _fail("GE_CURSOR_B3_POST_DDL_READER_NOT_TERMINAL")
    return retained


_READ_POST_DDL_READER_ENTRIES = _read_sqlite_cursor_post_ddl_publication_reader_entries_intrinsic


def _baseline_entries_frame(
    entries: tuple[BaselineEntry, ...],
    projection: BaselineProjectionIdentity,
) -> list[list[dict[str, str]]]:
    if _STABLE_TYPE(entries) is not tuple or len(entries) != projection.entry_count:
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    frame: list[list[dict[str, str]]] = []
    previous = BASELINE_GENESIS_HASH
    try:
        accumulator = _ACCUMULATOR_CONSTRUCT(projection.baseline_id, projection.entry_count)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN") from error
    for ordinal, entry in enumerate(entries):
        if (
            _STABLE_TYPE(entry) is not BaselineEntry
            or entry.baseline_id != projection.baseline_id
            or entry.ordinal != ordinal
            or entry.previous_entry_hash != previous
            or _STABLE_TYPE(entry.entry_kind) is not str
            or entry.entry_kind not in BASELINE_ENTRY_KINDS
            or _STABLE_TYPE(entry.key_bytes) is not bytes
            or _STABLE_TYPE(entry.state_bytes) is not bytes
            or not 2 <= len(entry.key_bytes) <= MAX_BASELINE_KEY_BYTES
            or not 2 <= len(entry.state_bytes) <= MAX_BASELINE_STATE_BYTES
            or _STABLE_TYPE(entry.entry_hash) is not str
            or len(entry.entry_hash) != 64
            or any(character not in "0123456789abcdef" for character in entry.entry_hash)
            or (ordinal == 0 and entry.entry_hash != projection.first_entry_hash)
        ):
            _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
        try:
            candidate = _CAPTURE_BASELINE_ENTRY(
                entry.entry_kind,
                _DECODE_POST_DDL_READER_JSON(entry.key_bytes, MAX_BASELINE_KEY_BYTES),
                _DECODE_POST_DDL_READER_JSON(entry.state_bytes, MAX_BASELINE_STATE_BYTES),
            )
            if candidate.key_bytes != entry.key_bytes or candidate.state_bytes != entry.state_bytes:
                _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
            rederived = _ACCUMULATOR_APPEND(accumulator, candidate)
            if (
                rederived.baseline_id != entry.baseline_id
                or rederived.ordinal != entry.ordinal
                or rederived.entry_kind != entry.entry_kind
                or rederived.key_bytes != entry.key_bytes
                or rederived.state_bytes != entry.state_bytes
                or rederived.previous_entry_hash != entry.previous_entry_hash
                or rederived.entry_hash != entry.entry_hash
            ):
                _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
        except BaseException as error:
            if isinstance(error, ValueError) and str(error) == (
                "GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN"
            ):
                raise
            raise ValueError("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN") from error
        frame.append(
            [
                {"type": "text", "value": entry.baseline_id},
                {"type": "integer", "value": str(entry.ordinal)},
                {"type": "text", "value": entry.entry_kind},
                {
                    "type": "blob",
                    "value": _URLSAFE_B64ENCODE(entry.key_bytes).rstrip(b"=").decode("ascii"),
                },
                {
                    "type": "blob",
                    "value": _URLSAFE_B64ENCODE(entry.state_bytes).rstrip(b"=").decode("ascii"),
                },
                {"type": "text", "value": entry.previous_entry_hash},
                {"type": "text", "value": entry.entry_hash},
            ]
        )
        previous = entry.entry_hash
    if projection.entry_count == 0:
        if projection.first_entry_hash != projection.final_entry_hash:
            _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    elif previous != projection.final_entry_hash:
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    try:
        rederived_projection = _ACCUMULATOR_FINISH(accumulator)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN") from error
    if not _same_projection_identity(rederived_projection, projection):
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    return frame


_BUILD_BASELINE_ENTRIES_FRAME = _baseline_entries_frame


def _verify_baseline_entries_frame(
    entries: tuple[BaselineEntry, ...],
    projection: BaselineProjectionIdentity,
) -> list[list[dict[str, str]]]:
    """Independently rebuild the receipt frame from retained canonical rows."""

    if _STABLE_TYPE(entries) is not tuple or len(entries) != projection.entry_count:
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    verified_frame: list[list[dict[str, str]]] = []
    expected_previous_hash = BASELINE_GENESIS_HASH
    try:
        verifier_accumulator = _ACCUMULATOR_CONSTRUCT(
            projection.baseline_id, projection.entry_count
        )
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN") from error
    for expected_ordinal in range(projection.entry_count):
        retained = entries[expected_ordinal]
        if (
            _STABLE_TYPE(retained) is not BaselineEntry
            or retained.baseline_id != projection.baseline_id
            or retained.ordinal != expected_ordinal
            or retained.previous_entry_hash != expected_previous_hash
            or _STABLE_TYPE(retained.entry_kind) is not str
            or retained.entry_kind not in BASELINE_ENTRY_KINDS
            or _STABLE_TYPE(retained.key_bytes) is not bytes
            or _STABLE_TYPE(retained.state_bytes) is not bytes
            or not 2 <= len(retained.key_bytes) <= MAX_BASELINE_KEY_BYTES
            or not 2 <= len(retained.state_bytes) <= MAX_BASELINE_STATE_BYTES
            or _STABLE_TYPE(retained.entry_hash) is not str
            or len(retained.entry_hash) != 64
            or any(symbol not in "0123456789abcdef" for symbol in retained.entry_hash)
            or (expected_ordinal == 0 and retained.entry_hash != projection.first_entry_hash)
        ):
            _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
        try:
            recaptured = _CAPTURE_BASELINE_ENTRY(
                retained.entry_kind,
                _DECODE_POST_DDL_READER_JSON(retained.key_bytes, MAX_BASELINE_KEY_BYTES),
                _DECODE_POST_DDL_READER_JSON(retained.state_bytes, MAX_BASELINE_STATE_BYTES),
            )
            if (
                recaptured.key_bytes != retained.key_bytes
                or recaptured.state_bytes != retained.state_bytes
            ):
                _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
            verified_entry = _ACCUMULATOR_APPEND(verifier_accumulator, recaptured)
            if (
                verified_entry.baseline_id != retained.baseline_id
                or verified_entry.ordinal != retained.ordinal
                or verified_entry.entry_kind != retained.entry_kind
                or verified_entry.key_bytes != retained.key_bytes
                or verified_entry.state_bytes != retained.state_bytes
                or verified_entry.previous_entry_hash != retained.previous_entry_hash
                or verified_entry.entry_hash != retained.entry_hash
            ):
                _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
        except BaseException as error:
            if isinstance(error, ValueError) and str(error) == (
                "GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN"
            ):
                raise
            raise ValueError("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN") from error
        verified_frame.append(
            [
                {"type": "text", "value": retained.baseline_id},
                {"type": "integer", "value": str(retained.ordinal)},
                {"type": "text", "value": retained.entry_kind},
                {
                    "type": "blob",
                    "value": _URLSAFE_B64ENCODE(retained.key_bytes).rstrip(b"=").decode("ascii"),
                },
                {
                    "type": "blob",
                    "value": _URLSAFE_B64ENCODE(retained.state_bytes).rstrip(b"=").decode("ascii"),
                },
                {"type": "text", "value": retained.previous_entry_hash},
                {"type": "text", "value": retained.entry_hash},
            ]
        )
        expected_previous_hash = retained.entry_hash
    if projection.entry_count == 0:
        if projection.first_entry_hash != projection.final_entry_hash:
            _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    elif expected_previous_hash != projection.final_entry_hash:
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    try:
        verified_projection = _ACCUMULATOR_FINISH(verifier_accumulator)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN") from error
    if not _same_projection_identity(verified_projection, projection):
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    return verified_frame


_VERIFY_BASELINE_ENTRIES_FRAME = _verify_baseline_entries_frame


def _baseline_entries_receipt_record(
    receipt: _SQLiteBaselineEntriesPublicationReceipt,
) -> _BaselineEntriesPublicationReceiptRecord:
    if (
        _identity_get(
            _BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
            receipt,
            _SQLiteBaselineEntriesPublicationReceipt,
        )
        is not None
    ):
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_RECEIPT_CONSUMED")
    record = _identity_get(
        _BASELINE_ENTRIES_PUBLICATION_RECEIPTS,
        receipt,
        _SQLiteBaselineEntriesPublicationReceipt,
    )
    if record is None:
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_RECEIPT")
    return cast(_BaselineEntriesPublicationReceiptRecord, record)


def _execute_sqlite_cursor_baseline_entries_publication_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
) -> _SQLiteBaselineEntriesPublicationReceipt:
    """Publish only the immutable rows retained by the exact terminal reader."""

    reader = _post_ddl_publication_reader_record(reader_lease)
    registered = _resolve_post_ddl_publication_reader_graph(reader)
    state = _authority_state(authority)
    if (
        registered[0] is not authority
        or registered[1] is not migration_0002_receipt
        or registered[2] is not fence
        or state.migration_0002_receipt is not migration_0002_receipt
        or state.post_ddl_catalog_fence is not fence
        or state.post_ddl_publication_reader_lease is not reader_lease
    ):
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_GRAPH")
    if (
        state.baseline_entries_publication_receipt is not None
        or state.baseline_entries_publication_receipt_mint_count != 0
        or state.baseline_entries_logical_execution_count != 0
        or state.baseline_entries_prepare_count != 0
        or state.baseline_entries_execute_count != 0
        or state.baseline_entries_affected_rows != 0
    ):
        _poison(state, authority, "SQLite baseline-entries publication was reused")
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_REPLAY")

    try:
        _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic(
            authority, migration_0002_receipt, fence, reader_lease
        )
        _read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
            migration_0002_receipt
        )
        if (
            state.write_phase != "post-ddl-reader-closed"
            or not _reader_watermarks_match(state, reader)
            or reader.rederived_projection is None
            or not _same_projection_identity(reader.rederived_projection, state.projection_identity)
            or reader.close_attempt_count != 1
            or not reader.close_succeeded
        ):
            _fail("GE_CURSOR_B3_BASELINE_ENTRIES_PREDECESSOR")
        source_sha256 = _SHA256(_BASELINE_ENTRIES_SOURCE_SQL.encode("utf-8")).hexdigest()
        insert_sha256 = _SHA256(_BASELINE_ENTRIES_INSERT_SQL.encode("utf-8")).hexdigest()
        if (
            source_sha256 != _BASELINE_ENTRIES_SOURCE_SQL_SHA256
            or insert_sha256 != _BASELINE_ENTRIES_INSERT_SQL_SHA256
        ):
            _fail("GE_CURSOR_B3_BASELINE_ENTRIES_SQL")
        entries = _READ_POST_DDL_READER_ENTRIES(
            authority, migration_0002_receipt, fence, reader_lease
        )
        frame = _BUILD_BASELINE_ENTRIES_FRAME(entries, state.projection_identity)
    except BaseException:
        _poison(state, authority, "SQLite baseline-entries predecessor validation failed")
        raise

    expected = state.projection_identity.entry_count
    total_before = state.current_total_changes
    epoch_before = state.current_transaction_epoch
    ledger_before = _outer_ledger_snapshot(state)
    execution: _SQLiteConnectionBaselineEntryPublicationExecution | None = None
    try:
        state.write_phase = "executing-baseline-entries"
        state.baseline_entries_logical_execution_count = 1
        execution = _BEGIN_BASELINE_ENTRY_PUBLICATION(state.connection, expected)
        state.baseline_entries_prepare_count = 1
        for ordinal, entry in enumerate(entries):
            step = _EXECUTE_NEXT_BASELINE_ENTRY(
                state.connection,
                execution,
                entry.baseline_id,
                entry.ordinal,
                entry.entry_kind,
                entry.key_bytes,
                entry.state_bytes,
                entry.previous_entry_hash,
                entry.entry_hash,
            )
            if (
                step.entry_ordinal != ordinal
                or step.completed_entry_count != ordinal + 1
                or step.execute_count != ordinal + 1
                or step.prepare_count != 1
                or step.affected_rows_delta != 1
                or step.total_changes != total_before + ordinal + 1
                or step.transaction_epoch != epoch_before + ordinal + 1
                or step.transaction_generation is not state.transaction_generation
            ):
                _fail("GE_CURSOR_B3_BASELINE_ENTRIES_EXECUTION")
            state.current_transaction_epoch = step.transaction_epoch
            state.current_total_changes = step.total_changes
            state.baseline_entries_execute_count = step.execute_count
            state.baseline_entries_affected_rows = step.completed_entry_count
            state.fixed_statement_count = ledger_before.fixed_statement_count + ordinal + 1
            state.affected_rows_watermark = ledger_before.affected_rows_watermark + ordinal + 1

        progress = _READ_BASELINE_ENTRY_PUBLICATION_PROGRESS(state.connection, execution)
        if (
            progress.lifecycle != "completed"
            or progress.close_attempt_count != 1
            or not progress.close_succeeded
            or progress.prepare_count != 1
            or progress.expected_entry_count != expected
            or progress.execute_count != expected
            or progress.completed_entry_count != expected
            or progress.next_entry_ordinal != expected
            or progress.affected_rows != expected
            or progress.total_changes_before != total_before
            or progress.total_changes_delta != expected
            or progress.total_changes != total_before + expected
            or progress.transaction_epoch != epoch_before + expected
            or progress.transaction_generation is not state.transaction_generation
        ):
            _fail("GE_CURSOR_B3_BASELINE_ENTRIES_LEDGER")
        state.current_transaction_epoch = progress.transaction_epoch
        state.current_total_changes = progress.total_changes

        parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS(frame)
        verify_entries = _READ_POST_DDL_READER_ENTRIES(
            authority, migration_0002_receipt, fence, reader_lease
        )
        verified_parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER(
            _VERIFY_BASELINE_ENTRIES_FRAME(verify_entries, state.projection_identity)
        )
        result_sha256 = _DIGEST_INITIAL_WRITE_RESULT({"affectedRows": str(expected)})
        verified_result_sha256 = _DIGEST_INITIAL_WRITE_RESULT_VERIFIER(
            {"affectedRows": str(expected)}
        )
        if parameter_sha256 != verified_parameter_sha256 or result_sha256 != verified_result_sha256:
            _fail("GE_CURSOR_B3_BASELINE_ENTRIES_DIGEST")

        ledger_after = _SQLiteCursorOuterPublicationLedgerSnapshot(
            ledger_before.affected_rows_watermark + expected,
            ledger_before.fixed_statement_count + expected,
            ledger_before.logical_write_sequence + 1,
        )
        receipt = _SQLiteBaselineEntriesPublicationReceipt(_CONSTRUCTION_TOKEN)
        _identity_set(
            _BASELINE_ENTRIES_PUBLICATION_RECEIPTS,
            receipt,
            _BaselineEntriesPublicationReceiptRecord(
                affected_rows=expected,
                authority_id=_STABLE_ID(authority),
                authority_ref=_STABLE_REF(authority),
                baseline_id=state.projection_identity.baseline_id,
                connection_id=_STABLE_ID(state.connection),
                entry_count=expected,
                execute_count=expected,
                final_entry_hash=state.projection_identity.final_entry_hash,
                first_entry_hash=state.projection_identity.first_entry_hash,
                fixed_insert_sql=_BASELINE_ENTRIES_INSERT_SQL,
                fixed_insert_sql_sha256=_BASELINE_ENTRIES_INSERT_SQL_SHA256,
                fence_id=_STABLE_ID(fence),
                fence_ref=_STABLE_REF(fence),
                migration_0002_receipt_id=_STABLE_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_STABLE_REF(migration_0002_receipt),
                outer_ledger_after=ledger_after,
                outer_ledger_before=ledger_before,
                outer_ledger_delta=_SQLiteCursorOuterPublicationLedgerSnapshot(
                    expected, expected, 1
                ),
                parameter_sha256=parameter_sha256,
                prepare_count=1,
                projection_identity_id=_STABLE_ID(state.projection_identity),
                projection_reference_id=_STABLE_ID(state.projection_reference),
                projection_reference_ref=_STABLE_REF(state.projection_reference),
                reader_lease_id=_STABLE_ID(reader_lease),
                reader_lease_ref=_STABLE_REF(reader_lease),
                reader_rederived_projection_sha256=(state.projection_identity.projection_sha256),
                result_sha256=result_sha256,
                source_read_sql=_BASELINE_ENTRIES_SOURCE_SQL,
                source_read_sql_sha256=_BASELINE_ENTRIES_SOURCE_SQL_SHA256,
                total_changes_after=progress.total_changes,
                total_changes_before=total_before,
                total_changes_delta=expected,
                transaction_epoch_after=progress.transaction_epoch,
                transaction_epoch_before=epoch_before,
                transaction_generation=state.transaction_generation,
            ),
        )
        state.logical_write_sequence = ledger_after.logical_write_sequence
        state.fixed_statement_count = ledger_after.fixed_statement_count
        state.affected_rows_watermark = ledger_after.affected_rows_watermark
        state.baseline_entries_publication_receipt = receipt
        state.baseline_entries_publication_receipt_mint_count = 1
        state.write_phase = "baseline-entries-complete"
        return receipt
    except BaseException:
        if execution is not None:
            with suppress(BaseException):
                progress = _READ_BASELINE_ENTRY_PUBLICATION_PROGRESS(state.connection, execution)
                state.current_transaction_epoch = progress.transaction_epoch
                state.current_total_changes = progress.total_changes
                state.baseline_entries_prepare_count = progress.prepare_count
                state.baseline_entries_execute_count = progress.execute_count
                state.baseline_entries_affected_rows = progress.affected_rows
                state.fixed_statement_count = (
                    ledger_before.fixed_statement_count + progress.completed_entry_count
                )
                state.affected_rows_watermark = (
                    ledger_before.affected_rows_watermark + progress.affected_rows
                )
        _poison(state, authority, "SQLite baseline-entries publication failed")
        raise


def _assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    receipt: _SQLiteBaselineEntriesPublicationReceipt,
) -> _SQLiteBaselineEntriesPublicationReceipt:
    """Reprove the exact receipt without consuming it."""

    record = _baseline_entries_receipt_record(receipt)
    if (
        record.authority_id != _STABLE_ID(authority)
        or record.authority_ref() is not authority
        or record.migration_0002_receipt_id != _STABLE_ID(migration_0002_receipt)
        or record.migration_0002_receipt_ref() is not migration_0002_receipt
        or record.fence_id != _STABLE_ID(fence)
        or record.fence_ref() is not fence
        or record.reader_lease_id != _STABLE_ID(reader_lease)
        or record.reader_lease_ref() is not reader_lease
    ):
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_RECEIPT_GRAPH")
    state = _authority_state(authority)
    reader = _post_ddl_publication_reader_record(reader_lease)
    try:
        _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic(
            authority, migration_0002_receipt, fence, reader_lease
        )
        entries = _READ_POST_DDL_READER_ENTRIES(
            authority, migration_0002_receipt, fence, reader_lease
        )
        parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER(
            _VERIFY_BASELINE_ENTRIES_FRAME(entries, state.projection_identity)
        )
        result_sha256 = _DIGEST_INITIAL_WRITE_RESULT_VERIFIER(
            {"affectedRows": str(record.entry_count)}
        )
        source_sha256 = _SHA256(record.source_read_sql.encode("utf-8")).hexdigest()
        insert_sha256 = _SHA256(record.fixed_insert_sql.encode("utf-8")).hexdigest()
    except BaseException:
        _poison(state, authority, "SQLite baseline-entries receipt proof failed")
        raise

    projection_reference = record.projection_reference_ref()
    before = record.outer_ledger_before
    after = record.outer_ledger_after
    delta = record.outer_ledger_delta
    projection = state.projection_identity
    if (
        projection_reference is not state.projection_reference
        or _STABLE_ID(projection_reference) != record.projection_reference_id
        or state.migration_0002_receipt is not migration_0002_receipt
        or state.post_ddl_catalog_fence is not fence
        or state.post_ddl_publication_reader_lease is not reader_lease
        or state.baseline_entries_publication_receipt is not receipt
        or state.baseline_entries_publication_receipt_mint_count != 1
        or state.baseline_entries_logical_execution_count != 1
        or state.baseline_entries_prepare_count != 1
        or state.baseline_entries_execute_count != record.entry_count
        or state.baseline_entries_affected_rows != record.entry_count
        or state.logical_write_sequence < after.logical_write_sequence
        or state.fixed_statement_count < after.fixed_statement_count
        or state.affected_rows_watermark < after.affected_rows_watermark
        or state.current_transaction_epoch < record.transaction_epoch_after
        or state.current_total_changes < record.total_changes_after
        or _STABLE_ID(state.connection) != record.connection_id
        or _STABLE_ID(projection) != record.projection_identity_id
        or record.baseline_id != projection.baseline_id
        or record.entry_count != projection.entry_count
        or record.first_entry_hash != projection.first_entry_hash
        or record.final_entry_hash != projection.final_entry_hash
        or record.reader_rederived_projection_sha256 != projection.projection_sha256
        or record.parameter_sha256 != parameter_sha256
        or record.result_sha256 != result_sha256
        or record.source_read_sql != _BASELINE_ENTRIES_SOURCE_SQL
        or record.source_read_sql_sha256 != _BASELINE_ENTRIES_SOURCE_SQL_SHA256
        or source_sha256 != record.source_read_sql_sha256
        or record.fixed_insert_sql != _BASELINE_ENTRIES_INSERT_SQL
        or record.fixed_insert_sql_sha256 != _BASELINE_ENTRIES_INSERT_SQL_SHA256
        or insert_sha256 != record.fixed_insert_sql_sha256
        or record.prepare_count != 1
        or record.execute_count != record.entry_count
        or record.affected_rows != record.entry_count
        or record.total_changes_before != reader.total_changes_read_watermark
        or record.total_changes_delta != record.entry_count
        or record.total_changes_after != record.total_changes_before + record.entry_count
        or record.transaction_epoch_before != reader.transaction_epoch
        or record.transaction_epoch_after != record.transaction_epoch_before + record.entry_count
        or record.transaction_generation is not state.transaction_generation
        or record.transaction_generation is not reader.transaction_generation
        or not _exact_outer_ledger(before, reader.outer_ledger_read_watermark)
        or delta.logical_write_sequence != 1
        or delta.fixed_statement_count != record.entry_count
        or delta.affected_rows_watermark != record.entry_count
        or after.logical_write_sequence != before.logical_write_sequence + 1
        or after.fixed_statement_count != before.fixed_statement_count + record.entry_count
        or after.affected_rows_watermark != before.affected_rows_watermark + record.entry_count
    ):
        _poison(state, authority, "SQLite baseline-entries receipt graph drifted")
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_RECEIPT_DRIFT")
    return receipt


def _read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(
    receipt: _SQLiteBaselineEntriesPublicationReceipt,
) -> _SQLiteBaselineEntriesPublicationReceiptSnapshot:
    record = _baseline_entries_receipt_record(receipt)
    authority = record.authority_ref()
    migration_0002_receipt = record.migration_0002_receipt_ref()
    fence = record.fence_ref()
    reader_lease = record.reader_lease_ref()
    projection_reference = record.projection_reference_ref()
    if (
        authority is None
        or migration_0002_receipt is None
        or fence is None
        or reader_lease is None
        or projection_reference is None
    ):
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_RECEIPT")
    _assert_sqlite_cursor_baseline_entries_publication_receipt_intrinsic(
        authority,
        migration_0002_receipt,
        fence,
        reader_lease,
        receipt,
    )
    state = _authority_state(authority)
    return _SQLiteBaselineEntriesPublicationReceiptSnapshot(
        affected_rows=record.affected_rows,
        authority=authority,
        baseline_id=record.baseline_id,
        connection=state.connection,
        entry_count=record.entry_count,
        execute_count=record.execute_count,
        final_entry_hash=record.final_entry_hash,
        first_entry_hash=record.first_entry_hash,
        fixed_insert_sql=record.fixed_insert_sql,
        fixed_insert_sql_sha256=record.fixed_insert_sql_sha256,
        migration_0002_receipt=migration_0002_receipt,
        mint_count=1,
        outer_ledger_after=record.outer_ledger_after,
        outer_ledger_before=record.outer_ledger_before,
        outer_ledger_delta=record.outer_ledger_delta,
        parameter_sha256=record.parameter_sha256,
        post_ddl_catalog_fence=fence,
        prepare_count=record.prepare_count,
        projection_identity=state.projection_identity,
        projection_reference=projection_reference,
        reader_close_count=1,
        reader_lease=reader_lease,
        reader_lease_lifecycle="retired",
        reader_rederived_projection_sha256=record.reader_rederived_projection_sha256,
        result_sha256=record.result_sha256,
        source_read_sql=record.source_read_sql,
        source_read_sql_sha256=record.source_read_sql_sha256,
        total_changes_after=record.total_changes_after,
        total_changes_before=record.total_changes_before,
        total_changes_delta=record.total_changes_delta,
        transaction_epoch_after=record.transaction_epoch_after,
        transaction_epoch_before=record.transaction_epoch_before,
        transaction_generation=record.transaction_generation,
        write_kind="baseline-entries-publication",
    )


def _baseline_header_parameter_frame(
    baseline_id: str,
    source_schema_identity_sha256: str,
    source_migration_lineage_id: str,
    source_migration_lineage_sha256: str,
    source_descriptor_hash: str,
    captured_at_ms: int,
    legacy_operation_count: int,
    entry_count: int,
    first_entry_hash: str,
    final_entry_hash: str,
    canonical_projection_sha256: str,
    creation_runtime: str,
    creation_runtime_version: str,
    policy_blob: bytes,
) -> list[list[dict[str, str]]]:
    """Build the sole dense fourteen-scalar header execution frame."""

    encoded_policy = _URLSAFE_B64ENCODE(bytes(policy_blob)).rstrip(b"=").decode("ascii")
    return [
        [
            {"type": "text", "value": baseline_id},
            {"type": "text", "value": source_schema_identity_sha256},
            {"type": "text", "value": source_migration_lineage_id},
            {"type": "text", "value": source_migration_lineage_sha256},
            {"type": "text", "value": source_descriptor_hash},
            {"type": "integer", "value": str(captured_at_ms)},
            {"type": "integer", "value": str(legacy_operation_count)},
            {"type": "integer", "value": str(entry_count)},
            {"type": "text", "value": first_entry_hash},
            {"type": "text", "value": final_entry_hash},
            {"type": "text", "value": canonical_projection_sha256},
            {"type": "text", "value": creation_runtime},
            {"type": "text", "value": creation_runtime_version},
            {"type": "blob", "value": encoded_policy},
        ]
    ]


def _verify_baseline_header_parameter_frame(
    baseline_id: str,
    source_schema_identity_sha256: str,
    source_migration_lineage_id: str,
    source_migration_lineage_sha256: str,
    source_descriptor_hash: str,
    captured_at_ms: int,
    legacy_operation_count: int,
    entry_count: int,
    first_entry_hash: str,
    final_entry_hash: str,
    canonical_projection_sha256: str,
    creation_runtime: str,
    creation_runtime_version: str,
    policy_blob: bytes,
) -> list[list[dict[str, str]]]:
    """Independently reconstruct the dense header frame for verification."""

    detached_policy = bytes(policy_blob)
    policy_base64url = _URLSAFE_B64ENCODE(detached_policy).rstrip(b"=").decode("ascii")
    verification: list[dict[str, str]] = []
    verification.append({"type": "text", "value": baseline_id})
    verification.append({"type": "text", "value": source_schema_identity_sha256})
    verification.append({"type": "text", "value": source_migration_lineage_id})
    verification.append({"type": "text", "value": source_migration_lineage_sha256})
    verification.append({"type": "text", "value": source_descriptor_hash})
    verification.append({"type": "integer", "value": str(captured_at_ms)})
    verification.append({"type": "integer", "value": str(legacy_operation_count)})
    verification.append({"type": "integer", "value": str(entry_count)})
    verification.append({"type": "text", "value": first_entry_hash})
    verification.append({"type": "text", "value": final_entry_hash})
    verification.append({"type": "text", "value": canonical_projection_sha256})
    verification.append({"type": "text", "value": creation_runtime})
    verification.append({"type": "text", "value": creation_runtime_version})
    verification.append({"type": "blob", "value": policy_base64url})
    return [verification]


_BUILD_BASELINE_HEADER_FRAME = _baseline_header_parameter_frame
_VERIFY_BASELINE_HEADER_FRAME = _verify_baseline_header_parameter_frame


class _BaselineHeaderArguments(NamedTuple):
    baseline_id: str
    source_schema_identity_sha256: str
    source_migration_lineage_id: str
    source_migration_lineage_sha256: str
    source_descriptor_hash: str
    captured_at_ms: int
    legacy_operation_count: int
    entry_count: int
    first_entry_hash: str
    final_entry_hash: str
    canonical_projection_sha256: str
    creation_runtime: str
    creation_runtime_version: str
    policy_blob: bytes


def _baseline_header_receipt_record(
    receipt: _SQLiteBaselineHeaderPublicationReceipt,
) -> _BaselineHeaderPublicationReceiptRecord:
    if (
        _identity_get(
            _BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
            receipt,
            _SQLiteBaselineHeaderPublicationReceipt,
        )
        is not None
    ):
        _fail("GE_CURSOR_B3_BASELINE_HEADER_RECEIPT_CONSUMED")
    record = _identity_get(
        _BASELINE_HEADER_PUBLICATION_RECEIPTS,
        receipt,
        _SQLiteBaselineHeaderPublicationReceipt,
    )
    if record is None:
        _fail("GE_CURSOR_B3_BASELINE_HEADER_RECEIPT")
    return cast(_BaselineHeaderPublicationReceiptRecord, record)


def _header_frame_arguments(
    state: _AuthorityState,
    source: _SourceHeaderCommitment,
    policy_blob: bytes,
) -> _BaselineHeaderArguments:
    projection = state.projection_identity
    return _BaselineHeaderArguments(
        projection.baseline_id,
        source.source_schema_identity_sha256,
        source.source_migration_lineage_id,
        source.source_migration_lineage_sha256,
        source.source_descriptor_hash,
        source.captured_at_ms,
        projection.legacy_operation_count,
        projection.entry_count,
        projection.first_entry_hash,
        projection.final_entry_hash,
        projection.projection_sha256,
        _BASELINE_HEADER_CREATION_RUNTIME,
        _BASELINE_HEADER_CREATION_RUNTIME_VERSION,
        policy_blob,
    )


def _assert_source_header_commitment_intrinsic(
    state: _AuthorityState,
) -> _SourceHeaderCommitment:
    source = state.source_header_commitment
    if (
        _STABLE_TYPE(source) is not _SourceHeaderCommitment
        or state.captured_at_ms != source.captured_at_ms
        or state.source_descriptor_hash != source.source_descriptor_hash
        or state.source_migration_lineage_id != source.source_migration_lineage_id
        or state.source_migration_lineage_sha256 != source.source_migration_lineage_sha256
        or state.source_schema_identity_sha256 != source.source_schema_identity_sha256
    ):
        _fail("GE_CURSOR_B3_BASELINE_HEADER_SOURCE_COMMITMENT")
    return source


def _assert_baseline_entries_header_predecessor_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    state: _AuthorityState,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    receipt: _SQLiteBaselineEntriesPublicationReceipt,
) -> _BaselineEntriesPublicationReceiptRecord:
    """Authenticate the exact entries receipt without issuing a new SELECT."""

    record = _baseline_entries_receipt_record(receipt)
    reader = _post_ddl_publication_reader_record(reader_lease)
    try:
        _assert_source_header_commitment_intrinsic(state)
        generation, epoch, total_changes = _owner_snapshot(state.connection)
        entries = reader.retained_entries
        if entries is None:
            _fail("GE_CURSOR_B3_BASELINE_HEADER_PREDECESSOR")
        parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER(
            _VERIFY_BASELINE_ENTRIES_FRAME(entries, state.projection_identity)
        )
        result_sha256 = _DIGEST_INITIAL_WRITE_RESULT_VERIFIER(
            {"affectedRows": str(record.entry_count)}
        )
        source_sha256 = _SHA256(record.source_read_sql.encode("utf-8")).hexdigest()
        insert_sha256 = _SHA256(record.fixed_insert_sql.encode("utf-8")).hexdigest()
        resolved = _resolve_post_ddl_publication_reader_graph(reader)
        _OWNERSHIP_ASSERT_POST_DDL_READER_TERMINAL(resolved[4], authority, reader_lease)
    except BaseException:
        _poison(state, authority, "SQLite baseline-header predecessor observation failed")
        raise
    projection = state.projection_identity
    projection_reference = record.projection_reference_ref()
    before = record.outer_ledger_before
    after = record.outer_ledger_after
    delta = record.outer_ledger_delta
    if generation is not state.transaction_generation:
        _retire(state, authority)
        _fail("GE_CURSOR_B3_BASELINE_HEADER_STALE_FENCE")
    if epoch != state.current_transaction_epoch or total_changes != state.current_total_changes:
        _poison(state, authority, "SQLite baseline-header predecessor owner ledger drifted")
        _fail("GE_CURSOR_B3_BASELINE_HEADER_PREDECESSOR")
    if (
        state.lifecycle != "active"
        or record.authority_id != _STABLE_ID(authority)
        or record.authority_ref() is not authority
        or record.connection_id != _STABLE_ID(state.connection)
        or record.migration_0002_receipt_id != _STABLE_ID(migration_0002_receipt)
        or record.migration_0002_receipt_ref() is not migration_0002_receipt
        or record.fence_id != _STABLE_ID(fence)
        or record.fence_ref() is not fence
        or record.reader_lease_id != _STABLE_ID(reader_lease)
        or record.reader_lease_ref() is not reader_lease
        or resolved[0] is not authority
        or resolved[1] is not migration_0002_receipt
        or resolved[2] is not fence
        or state.migration_0002_receipt is not migration_0002_receipt
        or state.post_ddl_catalog_fence is not fence
        or state.post_ddl_publication_reader_lease is not reader_lease
        or state.baseline_entries_publication_receipt is not receipt
        or state.baseline_entries_publication_receipt_mint_count != 1
        or state.baseline_entries_logical_execution_count != 1
        or state.baseline_entries_prepare_count != 1
        or state.baseline_entries_execute_count != projection.entry_count
        or state.baseline_entries_affected_rows != projection.entry_count
        or reader.lifecycle != "retired"
        or reader.close_attempt_count != 1
        or not reader.close_succeeded
        or reader.close_error_code is not None
        or reader.rederived_projection is None
        or not _same_projection_identity(reader.rederived_projection, projection)
        or projection_reference is not state.projection_reference
        or record.projection_reference_id != _STABLE_ID(state.projection_reference)
        or record.projection_identity_id != _STABLE_ID(projection)
        or record.baseline_id != projection.baseline_id
        or record.entry_count != projection.entry_count
        or record.first_entry_hash != projection.first_entry_hash
        or record.final_entry_hash != projection.final_entry_hash
        or record.reader_rederived_projection_sha256 != projection.projection_sha256
        or record.parameter_sha256 != parameter_sha256
        or record.result_sha256 != result_sha256
        or record.source_read_sql != _BASELINE_ENTRIES_SOURCE_SQL
        or record.source_read_sql_sha256 != _BASELINE_ENTRIES_SOURCE_SQL_SHA256
        or source_sha256 != record.source_read_sql_sha256
        or record.fixed_insert_sql != _BASELINE_ENTRIES_INSERT_SQL
        or record.fixed_insert_sql_sha256 != _BASELINE_ENTRIES_INSERT_SQL_SHA256
        or insert_sha256 != record.fixed_insert_sql_sha256
        or record.prepare_count != 1
        or record.execute_count != projection.entry_count
        or record.affected_rows != projection.entry_count
        or record.total_changes_delta != projection.entry_count
        or record.total_changes_after != record.total_changes_before + projection.entry_count
        or record.transaction_epoch_after
        != record.transaction_epoch_before + projection.entry_count
        or record.transaction_generation is not state.transaction_generation
        or record.transaction_generation is not reader.transaction_generation
        or not _exact_outer_ledger(before, reader.outer_ledger_read_watermark)
        or delta.logical_write_sequence != 1
        or delta.fixed_statement_count != projection.entry_count
        or delta.affected_rows_watermark != projection.entry_count
        or after.logical_write_sequence != before.logical_write_sequence + 1
        or after.fixed_statement_count != before.fixed_statement_count + projection.entry_count
        or after.affected_rows_watermark != before.affected_rows_watermark + projection.entry_count
        or state.logical_write_sequence < after.logical_write_sequence
        or state.fixed_statement_count < after.fixed_statement_count
        or state.affected_rows_watermark < after.affected_rows_watermark
        or state.current_transaction_epoch < record.transaction_epoch_after
        or state.current_total_changes < record.total_changes_after
    ):
        _poison(state, authority, "SQLite baseline-header entries predecessor drifted")
        _fail("GE_CURSOR_B3_BASELINE_HEADER_PREDECESSOR")
    return record


def _execute_sqlite_cursor_baseline_header_publication_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt,
) -> _SQLiteBaselineHeaderPublicationReceipt:
    """Publish one header from the authentic non-consuming entries proof."""

    state = _authority_state(authority)
    entries_record = _baseline_entries_receipt_record(baseline_entries_publication_receipt)
    if (
        entries_record.authority_ref() is not authority
        or entries_record.migration_0002_receipt_ref() is not migration_0002_receipt
        or entries_record.fence_ref() is not fence
        or entries_record.reader_lease_ref() is not reader_lease
        or state.baseline_entries_publication_receipt is not baseline_entries_publication_receipt
    ):
        _fail("GE_CURSOR_B3_BASELINE_HEADER_GRAPH")
    if (
        state.baseline_header_publication_receipt is not None
        or state.baseline_header_publication_receipt_mint_count != 0
        or state.baseline_header_logical_execution_count != 0
        or state.baseline_header_prepare_count != 0
        or state.baseline_header_execute_count != 0
        or state.baseline_header_affected_rows != 0
    ):
        _poison(state, authority, "SQLite baseline-header publication was reused")
        _fail("GE_CURSOR_B3_BASELINE_HEADER_REPLAY")

    try:
        _assert_baseline_entries_header_predecessor_intrinsic(
            authority,
            state,
            migration_0002_receipt,
            fence,
            reader_lease,
            baseline_entries_publication_receipt,
        )
        if (
            state.write_phase != "baseline-entries-complete"
            or entries_record.projection_identity_id != _STABLE_ID(state.projection_identity)
            or entries_record.projection_reference_ref() is not state.projection_reference
            or entries_record.transaction_generation is not state.transaction_generation
            or entries_record.total_changes_after != state.current_total_changes
            or entries_record.transaction_epoch_after != state.current_transaction_epoch
            or not _exact_outer_ledger(
                entries_record.outer_ledger_after, _outer_ledger_snapshot(state)
            )
        ):
            _fail("GE_CURSOR_B3_BASELINE_HEADER_PREDECESSOR")
        exact_insert_sha256 = _SHA256(_BASELINE_HEADER_INSERT_SQL.encode("utf-8")).hexdigest()
        if (
            exact_insert_sha256 != _BASELINE_HEADER_INSERT_SQL_SHA256
            or len(_BASELINE_HEADER_INSERT_SQL.encode("utf-8")) != 488
        ):
            _fail("GE_CURSOR_B3_BASELINE_HEADER_SQL")
        policy_blob = bytes(_ENCODE_BASELINE_POLICY())
        policy_sha256 = _SHA256(policy_blob).hexdigest()
        if (
            len(policy_blob) != _BASELINE_HEADER_POLICY_UTF8_BYTES
            or policy_sha256 != _BASELINE_HEADER_POLICY_SHA256
        ):
            _fail("GE_CURSOR_B3_BASELINE_HEADER_POLICY")
        source_commitment = _assert_source_header_commitment_intrinsic(state)
        frame_arguments = _header_frame_arguments(state, source_commitment, policy_blob)
        frame = _BUILD_BASELINE_HEADER_FRAME(*frame_arguments)
    except BaseException:
        _poison(state, authority, "SQLite baseline-header predecessor validation failed")
        raise

    total_before = state.current_total_changes
    epoch_before = state.current_transaction_epoch
    ledger_before = _outer_ledger_snapshot(state)
    execution: _SQLiteConnectionBaselineHeaderPublicationExecution | None = None
    try:
        state.write_phase = "executing-baseline-header"
        state.baseline_header_logical_execution_count = 1
        execution = _BEGIN_BASELINE_HEADER_PUBLICATION(state.connection)
        state.baseline_header_prepare_count = 1
        step = _EXECUTE_BASELINE_HEADER(state.connection, execution, *frame_arguments)
        state.current_transaction_epoch = step.transaction_epoch
        state.current_total_changes = step.total_changes
        state.baseline_header_execute_count = step.execute_count
        state.baseline_header_affected_rows = step.affected_rows_delta
        state.fixed_statement_count = ledger_before.fixed_statement_count + step.execute_count
        state.affected_rows_watermark = (
            ledger_before.affected_rows_watermark + step.affected_rows_delta
        )
        if (
            step.prepare_count != 1
            or step.execute_count != 1
            or step.completed_execution_count != 1
            or step.affected_rows_delta != 1
            or step.total_changes != total_before + 1
            or step.transaction_epoch != epoch_before + 1
            or step.transaction_generation is not state.transaction_generation
        ):
            _fail("GE_CURSOR_B3_BASELINE_HEADER_EXECUTION")

        progress = _READ_BASELINE_HEADER_PUBLICATION_PROGRESS(state.connection, execution)
        if (
            progress.lifecycle != "completed"
            or progress.close_attempt_count != 1
            or not progress.close_succeeded
            or progress.prepare_count != 1
            or progress.execute_count != 1
            or progress.completed_execution_count != 1
            or progress.affected_rows != 1
            or progress.total_changes_before != total_before
            or progress.total_changes_delta != 1
            or progress.total_changes != total_before + 1
            or progress.transaction_epoch != epoch_before + 1
            or progress.transaction_generation is not state.transaction_generation
        ):
            _fail("GE_CURSOR_B3_BASELINE_HEADER_LEDGER")
        state.current_transaction_epoch = progress.transaction_epoch
        state.current_total_changes = progress.total_changes

        parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS(frame)
        verified_parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER(
            _VERIFY_BASELINE_HEADER_FRAME(*frame_arguments)
        )
        result_sha256 = _DIGEST_INITIAL_WRITE_RESULT({"affectedRows": "1"})
        verified_result_sha256 = _DIGEST_INITIAL_WRITE_RESULT_VERIFIER({"affectedRows": "1"})
        if parameter_sha256 != verified_parameter_sha256 or result_sha256 != verified_result_sha256:
            _fail("GE_CURSOR_B3_BASELINE_HEADER_DIGEST")

        ledger_after = _SQLiteCursorOuterPublicationLedgerSnapshot(
            ledger_before.affected_rows_watermark + 1,
            ledger_before.fixed_statement_count + 1,
            ledger_before.logical_write_sequence + 1,
        )
        receipt = _SQLiteBaselineHeaderPublicationReceipt(_CONSTRUCTION_TOKEN)
        _identity_set(
            _BASELINE_HEADER_PUBLICATION_RECEIPTS,
            receipt,
            _BaselineHeaderPublicationReceiptRecord(
                affected_rows=1,
                authority_id=_STABLE_ID(authority),
                authority_ref=_STABLE_REF(authority),
                baseline_entries_receipt_id=_STABLE_ID(baseline_entries_publication_receipt),
                baseline_entries_receipt_ref=_STABLE_REF(baseline_entries_publication_receipt),
                baseline_id=state.projection_identity.baseline_id,
                canonical_projection_sha256=state.projection_identity.projection_sha256,
                captured_at_ms=source_commitment.captured_at_ms,
                connection_id=_STABLE_ID(state.connection),
                creation_runtime=_BASELINE_HEADER_CREATION_RUNTIME,
                creation_runtime_version=_BASELINE_HEADER_CREATION_RUNTIME_VERSION,
                entry_count=state.projection_identity.entry_count,
                execute_count=1,
                final_entry_hash=state.projection_identity.final_entry_hash,
                first_entry_hash=state.projection_identity.first_entry_hash,
                fixed_insert_sql=_BASELINE_HEADER_INSERT_SQL,
                fixed_insert_sql_sha256=_BASELINE_HEADER_INSERT_SQL_SHA256,
                legacy_operation_count=state.projection_identity.legacy_operation_count,
                fence_id=_STABLE_ID(fence),
                fence_ref=_STABLE_REF(fence),
                migration_0002_receipt_id=_STABLE_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_STABLE_REF(migration_0002_receipt),
                outer_ledger_after=ledger_after,
                outer_ledger_before=ledger_before,
                outer_ledger_delta=_SQLiteCursorOuterPublicationLedgerSnapshot(1, 1, 1),
                parameter_sha256=parameter_sha256,
                parameter_order=_BASELINE_HEADER_PARAMETER_ORDER,
                policy_blob_base64url=(
                    _URLSAFE_B64ENCODE(policy_blob).rstrip(b"=").decode("ascii")
                ),
                policy_blob_sha256=policy_sha256,
                policy_blob_utf8_bytes=len(policy_blob),
                prepare_count=1,
                projection_identity_id=_STABLE_ID(state.projection_identity),
                projection_reference_id=_STABLE_ID(state.projection_reference),
                projection_reference_ref=_STABLE_REF(state.projection_reference),
                reader_lease_id=_STABLE_ID(reader_lease),
                reader_lease_ref=_STABLE_REF(reader_lease),
                result_sha256=result_sha256,
                source_descriptor_hash=source_commitment.source_descriptor_hash,
                source_migration_lineage_id=(source_commitment.source_migration_lineage_id),
                source_migration_lineage_sha256=(source_commitment.source_migration_lineage_sha256),
                source_schema_identity_sha256=(source_commitment.source_schema_identity_sha256),
                total_changes_after=progress.total_changes,
                total_changes_before=total_before,
                transaction_epoch_after=progress.transaction_epoch,
                transaction_epoch_before=epoch_before,
                transaction_generation=state.transaction_generation,
            ),
        )
        state.logical_write_sequence = ledger_after.logical_write_sequence
        state.fixed_statement_count = ledger_after.fixed_statement_count
        state.affected_rows_watermark = ledger_after.affected_rows_watermark
        state.baseline_header_publication_receipt = receipt
        state.baseline_header_publication_receipt_mint_count = 1
        state.write_phase = "baseline-header-complete"
        return receipt
    except BaseException:
        if execution is not None:
            with suppress(BaseException):
                progress = _READ_BASELINE_HEADER_PUBLICATION_PROGRESS(state.connection, execution)
                state.current_transaction_epoch = progress.transaction_epoch
                state.current_total_changes = progress.total_changes
                state.baseline_header_prepare_count = progress.prepare_count
                state.baseline_header_execute_count = progress.execute_count
                state.baseline_header_affected_rows = 1 if progress.affected_rows == 1 else 0
                state.fixed_statement_count = (
                    ledger_before.fixed_statement_count + progress.completed_execution_count
                )
                state.affected_rows_watermark = (
                    ledger_before.affected_rows_watermark + progress.affected_rows
                )
        _poison(state, authority, "SQLite baseline-header publication failed")
        raise


def _assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt,
    receipt: _SQLiteBaselineHeaderPublicationReceipt,
) -> _SQLiteBaselineHeaderPublicationReceipt:
    """Reprove the exact completed header without consuming either receipt."""

    record = _baseline_header_receipt_record(receipt)
    if (
        record.authority_id != _STABLE_ID(authority)
        or record.authority_ref() is not authority
        or record.baseline_entries_receipt_id != _STABLE_ID(baseline_entries_publication_receipt)
        or record.baseline_entries_receipt_ref() is not baseline_entries_publication_receipt
        or record.migration_0002_receipt_id != _STABLE_ID(migration_0002_receipt)
        or record.migration_0002_receipt_ref() is not migration_0002_receipt
        or record.fence_id != _STABLE_ID(fence)
        or record.fence_ref() is not fence
        or record.reader_lease_id != _STABLE_ID(reader_lease)
        or record.reader_lease_ref() is not reader_lease
    ):
        _fail("GE_CURSOR_B3_BASELINE_HEADER_RECEIPT_GRAPH")
    state = _authority_state(authority)
    try:
        _assert_baseline_entries_header_predecessor_intrinsic(
            authority,
            state,
            migration_0002_receipt,
            fence,
            reader_lease,
            baseline_entries_publication_receipt,
        )
        source_commitment = _assert_source_header_commitment_intrinsic(state)
        policy_blob = bytes(_ENCODE_BASELINE_POLICY())
        frame_arguments = _header_frame_arguments(state, source_commitment, policy_blob)
        parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER(
            _VERIFY_BASELINE_HEADER_FRAME(*frame_arguments)
        )
        result_sha256 = _DIGEST_INITIAL_WRITE_RESULT_VERIFIER({"affectedRows": "1"})
        policy_sha256 = _SHA256(policy_blob).hexdigest()
        insert_sha256 = _SHA256(record.fixed_insert_sql.encode("utf-8")).hexdigest()
        policy_base64url = _URLSAFE_B64ENCODE(policy_blob).rstrip(b"=").decode("ascii")
    except BaseException:
        _poison(state, authority, "SQLite baseline-header receipt proof failed")
        raise

    projection_reference = record.projection_reference_ref()
    before = record.outer_ledger_before
    after = record.outer_ledger_after
    delta = record.outer_ledger_delta
    projection = state.projection_identity
    entries_record = _baseline_entries_receipt_record(baseline_entries_publication_receipt)
    if (
        projection_reference is not state.projection_reference
        or _STABLE_ID(projection_reference) != record.projection_reference_id
        or state.baseline_header_publication_receipt is not receipt
        or state.baseline_header_publication_receipt_mint_count != 1
        or state.baseline_header_logical_execution_count != 1
        or state.baseline_header_prepare_count != 1
        or state.baseline_header_execute_count != 1
        or state.baseline_header_affected_rows != 1
        or state.logical_write_sequence < after.logical_write_sequence
        or state.fixed_statement_count < after.fixed_statement_count
        or state.affected_rows_watermark < after.affected_rows_watermark
        or state.current_transaction_epoch < record.transaction_epoch_after
        or state.current_total_changes < record.total_changes_after
        or record.connection_id != _STABLE_ID(state.connection)
        or record.projection_identity_id != _STABLE_ID(projection)
        or record.baseline_id != projection.baseline_id
        or record.canonical_projection_sha256 != projection.projection_sha256
        or record.captured_at_ms != source_commitment.captured_at_ms
        or record.entry_count != projection.entry_count
        or record.legacy_operation_count != projection.legacy_operation_count
        or record.first_entry_hash != projection.first_entry_hash
        or record.final_entry_hash != projection.final_entry_hash
        or record.source_descriptor_hash != source_commitment.source_descriptor_hash
        or record.source_migration_lineage_id != source_commitment.source_migration_lineage_id
        or record.source_migration_lineage_sha256
        != source_commitment.source_migration_lineage_sha256
        or record.source_schema_identity_sha256 != source_commitment.source_schema_identity_sha256
        or record.creation_runtime != _BASELINE_HEADER_CREATION_RUNTIME
        or record.creation_runtime_version != _BASELINE_HEADER_CREATION_RUNTIME_VERSION
        or record.policy_blob_utf8_bytes != _BASELINE_HEADER_POLICY_UTF8_BYTES
        or record.policy_blob_sha256 != _BASELINE_HEADER_POLICY_SHA256
        or record.policy_blob_sha256 != policy_sha256
        or record.policy_blob_base64url != policy_base64url
        or record.fixed_insert_sql != _BASELINE_HEADER_INSERT_SQL
        or record.fixed_insert_sql_sha256 != _BASELINE_HEADER_INSERT_SQL_SHA256
        or insert_sha256 != record.fixed_insert_sql_sha256
        or record.parameter_order != _BASELINE_HEADER_PARAMETER_ORDER
        or record.parameter_sha256 != parameter_sha256
        or record.result_sha256 != result_sha256
        or record.prepare_count != 1
        or record.execute_count != 1
        or record.affected_rows != 1
        or record.total_changes_before != entries_record.total_changes_after
        or record.total_changes_after != record.total_changes_before + 1
        or record.transaction_epoch_before != entries_record.transaction_epoch_after
        or record.transaction_epoch_after != record.transaction_epoch_before + 1
        or record.transaction_generation is not state.transaction_generation
        or delta.logical_write_sequence != 1
        or delta.fixed_statement_count != 1
        or delta.affected_rows_watermark != 1
        or after.logical_write_sequence != before.logical_write_sequence + 1
        or after.fixed_statement_count != before.fixed_statement_count + 1
        or after.affected_rows_watermark != before.affected_rows_watermark + 1
    ):
        _poison(state, authority, "SQLite baseline-header receipt graph drifted")
        _fail("GE_CURSOR_B3_BASELINE_HEADER_RECEIPT_DRIFT")
    if not _exact_outer_ledger(before, entries_record.outer_ledger_after):
        _poison(state, authority, "SQLite baseline-header receipt predecessor drifted")
        _fail("GE_CURSOR_B3_BASELINE_HEADER_RECEIPT_DRIFT")
    return receipt


def _read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(
    receipt: _SQLiteBaselineHeaderPublicationReceipt,
) -> _SQLiteBaselineHeaderPublicationReceiptSnapshot:
    record = _baseline_header_receipt_record(receipt)
    authority = record.authority_ref()
    entries_receipt = record.baseline_entries_receipt_ref()
    migration_0002_receipt = record.migration_0002_receipt_ref()
    fence = record.fence_ref()
    reader_lease = record.reader_lease_ref()
    projection_reference = record.projection_reference_ref()
    if (
        authority is None
        or entries_receipt is None
        or migration_0002_receipt is None
        or fence is None
        or reader_lease is None
        or projection_reference is None
    ):
        _fail("GE_CURSOR_B3_BASELINE_HEADER_RECEIPT")
    _assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic(
        authority,
        migration_0002_receipt,
        fence,
        reader_lease,
        entries_receipt,
        receipt,
    )
    state = _authority_state(authority)
    return _SQLiteBaselineHeaderPublicationReceiptSnapshot(
        affected_rows=1,
        authority=authority,
        baseline_entries_publication_receipt=entries_receipt,
        baseline_id=record.baseline_id,
        canonical_projection_sha256=record.canonical_projection_sha256,
        captured_at_ms=record.captured_at_ms,
        connection=state.connection,
        creation_runtime="graph-engineering-python",
        creation_runtime_version="0.1.0a1",
        entry_count=record.entry_count,
        execute_count=1,
        final_entry_hash=record.final_entry_hash,
        fixed_insert_sql=record.fixed_insert_sql,
        fixed_insert_sql_sha256=record.fixed_insert_sql_sha256,
        first_entry_hash=record.first_entry_hash,
        legacy_operation_count=record.legacy_operation_count,
        mint_count=1,
        outer_ledger_after=record.outer_ledger_after,
        outer_ledger_before=record.outer_ledger_before,
        outer_ledger_delta=record.outer_ledger_delta,
        parameter_sha256=record.parameter_sha256,
        parameter_order=record.parameter_order,
        policy_blob_base64url=record.policy_blob_base64url,
        policy_blob_sha256=record.policy_blob_sha256,
        policy_blob_utf8_bytes=record.policy_blob_utf8_bytes,
        post_ddl_catalog_fence=fence,
        prepare_count=1,
        projection_identity=state.projection_identity,
        projection_reference=projection_reference,
        reader_lease=reader_lease,
        result_sha256=record.result_sha256,
        source_descriptor_hash=record.source_descriptor_hash,
        source_migration_lineage_id=record.source_migration_lineage_id,
        source_migration_lineage_sha256=record.source_migration_lineage_sha256,
        source_schema_identity_sha256=record.source_schema_identity_sha256,
        total_changes_after=record.total_changes_after,
        total_changes_before=record.total_changes_before,
        total_changes_delta=1,
        transaction_epoch_after=record.transaction_epoch_after,
        transaction_epoch_before=record.transaction_epoch_before,
        transaction_generation=record.transaction_generation,
        write_kind="baseline-header-publication",
    )


def _operation_sequence_zero_parameter_frame(
    baseline_id: str,
    baseline_captured_at_ms: int,
    updated_at_ms: int,
) -> list[list[dict[str, str]]]:
    """Build the sole dense three-scalar sequence-zero execution frame."""

    return [
        [
            {"type": "text", "value": baseline_id},
            {"type": "integer", "value": str(baseline_captured_at_ms)},
            {"type": "integer", "value": str(updated_at_ms)},
        ]
    ]


def _verify_operation_sequence_zero_parameter_frame(
    baseline_id: str,
    baseline_captured_at_ms: int,
    updated_at_ms: int,
) -> list[list[dict[str, str]]]:
    """Independently rebuild the sequence-zero frame for receipt proof."""

    verification: list[dict[str, str]] = []
    verification.append({"type": "text", "value": baseline_id})
    verification.append({"type": "integer", "value": str(baseline_captured_at_ms)})
    verification.append({"type": "integer", "value": str(updated_at_ms)})
    return [verification]


_BUILD_OPERATION_SEQUENCE_ZERO_FRAME = _operation_sequence_zero_parameter_frame
_VERIFY_OPERATION_SEQUENCE_ZERO_FRAME = _verify_operation_sequence_zero_parameter_frame


def _assert_operation_sequence_zero_sql_commitment_intrinsic(
    _read_canonical: Callable[[], tuple[str, str, tuple[str, ...]]] = (
        _READ_CAPTURED_OPERATION_SEQUENCE_ZERO_SQL_COMMITMENT
    ),
) -> tuple[str, str, tuple[str, ...]]:
    """Reject even a matching SQL/SHA rebind against definition-time truth."""

    # The reader itself is a definition-time default. Rebinding both mutable
    # SQL names *and* their module-level closure getter cannot replace truth.
    canonical_sql, canonical_sha256, canonical_order = _read_canonical()
    canonical_fresh_sha256 = _SHA256(canonical_sql.encode("utf-8")).hexdigest()
    if (
        _STABLE_TYPE(_OPERATION_SEQUENCE_ZERO_INSERT_SQL) is not str
        or _STABLE_TYPE(_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256) is not str
        or _STABLE_TYPE(_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER) is not tuple
        or canonical_sql != _OPERATION_SEQUENCE_ZERO_INSERT_SQL
        or canonical_sha256 != _OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256
        or canonical_order != _OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER
        or len(canonical_sql.encode("utf-8")) != 154
        or canonical_fresh_sha256 != canonical_sha256
        or canonical_order != ("baselineId", "baselineCapturedAtMs", "updatedAtMs")
    ):
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_SQL")
    return canonical_sql, canonical_sha256, canonical_order


def _operation_sequence_zero_receipt_record(
    receipt: _SQLiteOperationSequenceZeroPublicationReceipt,
) -> _OperationSequenceZeroPublicationReceiptRecord:
    if (
        _identity_get(
            _OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
            receipt,
            _SQLiteOperationSequenceZeroPublicationReceipt,
        )
        is not None
    ):
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_CONSUMED")
    record = _identity_get(
        _OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS,
        receipt,
        _SQLiteOperationSequenceZeroPublicationReceipt,
    )
    if record is None:
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT")
    return cast(_OperationSequenceZeroPublicationReceiptRecord, record)


def _read_sequence_zero_clock_value(
    state: _AuthorityState,
) -> int:
    """Freshly rederive the retained provider-clock value from its evidence."""

    clock = _READ_CLOCK_EVIDENCE(
        state.provider_clock_capability,
        state.outer_clock_evidence,
    )
    if (
        clock.boundary != "before-first-permanent-mutation"
        or clock.consumer != "outer-publication-authority"
        or clock.transaction_generation is not state.transaction_generation
        or clock.transaction_epoch != state.transaction_epoch_at_preparation
        or _STABLE_TYPE(clock.provider_now_ms) is not int
        or not 0 <= clock.provider_now_ms <= _MAX_SAFE_INTEGER
        or clock.provider_now_ms != state.outer_provider_now_ms
    ):
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_CLOCK")
    return clock.provider_now_ms


def _execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt,
    baseline_header_publication_receipt: _SQLiteBaselineHeaderPublicationReceipt,
) -> _SQLiteOperationSequenceZeroPublicationReceipt:
    """Publish sequence zero from the exact reusable baseline-header proof."""

    # Resolve caller presentation before observing the live authority or SQL.
    # A foreign or cloned predecessor is an invalid argument, not graph poison.
    header_record = _baseline_header_receipt_record(baseline_header_publication_receipt)
    if (
        header_record.authority_id != _STABLE_ID(authority)
        or header_record.authority_ref() is not authority
        or header_record.baseline_entries_receipt_id
        != _STABLE_ID(baseline_entries_publication_receipt)
        or header_record.baseline_entries_receipt_ref() is not baseline_entries_publication_receipt
        or header_record.migration_0002_receipt_id != _STABLE_ID(migration_0002_receipt)
        or header_record.migration_0002_receipt_ref() is not migration_0002_receipt
        or header_record.fence_id != _STABLE_ID(fence)
        or header_record.fence_ref() is not fence
        or header_record.reader_lease_id != _STABLE_ID(reader_lease)
        or header_record.reader_lease_ref() is not reader_lease
    ):
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_GRAPH")

    state = _authority_state(authority)
    if (
        state.operation_sequence_zero_publication_receipt is not None
        or state.operation_sequence_zero_publication_receipt_mint_count != 0
        or state.operation_sequence_zero_logical_execution_count != 0
        or state.operation_sequence_zero_prepare_count != 0
        or state.operation_sequence_zero_execute_count != 0
        or state.operation_sequence_zero_affected_rows != 0
    ):
        _poison(state, authority, "SQLite operation-sequence-zero publication was reused")
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_REPLAY")

    try:
        _assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic(
            authority,
            migration_0002_receipt,
            fence,
            reader_lease,
            baseline_entries_publication_receipt,
            baseline_header_publication_receipt,
        )
        source_commitment = _assert_source_header_commitment_intrinsic(state)
        if (
            state.write_phase != "baseline-header-complete"
            or state.baseline_header_publication_receipt is not baseline_header_publication_receipt
            or state.current_total_changes != header_record.total_changes_after
            or state.current_transaction_epoch != header_record.transaction_epoch_after
            or not _exact_outer_ledger(
                _outer_ledger_snapshot(state), header_record.outer_ledger_after
            )
        ):
            _fail("GE_CURSOR_B3_SEQUENCE_ZERO_PREDECESSOR")

        updated_at_ms = _read_sequence_zero_clock_value(state)
        baseline_captured_at_ms = source_commitment.captured_at_ms
        # Keep timestamp monotonicity separate from phase/header identity so a
        # poisoned graph names the actual provider-clock predecessor defect.
        if (
            _STABLE_TYPE(baseline_captured_at_ms) is not int
            or not 0 <= baseline_captured_at_ms <= _MAX_SAFE_INTEGER
            or updated_at_ms < baseline_captured_at_ms
        ):
            _fail("GE_CURSOR_B3_SEQUENCE_ZERO_TIMESTAMP")
    except BaseException:
        _poison(state, authority, "SQLite operation-sequence-zero predecessor validation failed")
        raise

    try:
        canonical_sql, canonical_sql_sha256, canonical_parameter_order = (
            _assert_operation_sequence_zero_sql_commitment_intrinsic()
        )
    except BaseException as error:
        reason = (
            "SQLite operation-sequence-zero SQL identity drifted"
            if isinstance(error, ValueError) and str(error) == "GE_CURSOR_B3_SEQUENCE_ZERO_SQL"
            else "SQLite operation-sequence-zero SQL preflight failed"
        )
        _poison(state, authority, reason)
        raise

    try:
        frame = _BUILD_OPERATION_SEQUENCE_ZERO_FRAME(
            state.projection_identity.baseline_id,
            baseline_captured_at_ms,
            updated_at_ms,
        )
    except BaseException:
        _poison(state, authority, "SQLite operation-sequence-zero parameter construction failed")
        raise

    total_before = state.current_total_changes
    epoch_before = state.current_transaction_epoch
    ledger_before = _outer_ledger_snapshot(state)
    execution: _SQLiteConnectionOperationSequenceZeroExecution | None = None
    try:
        state.write_phase = "executing-sequence-zero"
        state.operation_sequence_zero_logical_execution_count = 1
        execution = _BEGIN_OPERATION_SEQUENCE_ZERO(state.connection)
        state.operation_sequence_zero_prepare_count = 1
        step = _EXECUTE_OPERATION_SEQUENCE_ZERO(
            state.connection,
            execution,
            state.projection_identity.baseline_id,
            baseline_captured_at_ms,
            updated_at_ms,
        )
        state.current_transaction_epoch = step.transaction_epoch
        state.current_total_changes = step.total_changes
        state.operation_sequence_zero_prepare_count = step.prepare_count
        state.operation_sequence_zero_execute_count = step.execute_count
        state.operation_sequence_zero_affected_rows = step.affected_rows_delta
        state.fixed_statement_count = ledger_before.fixed_statement_count + step.execute_count
        state.affected_rows_watermark = (
            ledger_before.affected_rows_watermark + step.affected_rows_delta
        )
        if (
            step.prepare_count != 1
            or step.execute_count != 1
            or step.completed_execution_count != 1
            or step.affected_rows_delta != 1
            or step.total_changes != total_before + 1
            or step.transaction_epoch != epoch_before + 1
            or step.transaction_generation is not state.transaction_generation
        ):
            _fail("GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION")

        progress = _READ_OPERATION_SEQUENCE_ZERO_PROGRESS(state.connection, execution)
        if (
            progress.lifecycle != "completed"
            or progress.close_attempt_count != 1
            or not progress.close_succeeded
            or progress.prepare_count != 1
            or progress.execute_count != 1
            or progress.completed_execution_count != 1
            or progress.affected_rows != 1
            or progress.total_changes_before != total_before
            or progress.total_changes_delta != 1
            or progress.total_changes != total_before + 1
            or progress.transaction_epoch != epoch_before + 1
            or progress.transaction_generation is not state.transaction_generation
            or state.fixed_statement_count != ledger_before.fixed_statement_count + 1
            or state.affected_rows_watermark != ledger_before.affected_rows_watermark + 1
        ):
            _fail("GE_CURSOR_B3_SEQUENCE_ZERO_LEDGER")
        state.current_transaction_epoch = progress.transaction_epoch
        state.current_total_changes = progress.total_changes

        parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS(frame)
        verified_parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER(
            _VERIFY_OPERATION_SEQUENCE_ZERO_FRAME(
                state.projection_identity.baseline_id,
                baseline_captured_at_ms,
                updated_at_ms,
            )
        )
        result_sha256 = _DIGEST_INITIAL_WRITE_RESULT({"affectedRows": "1"})
        verified_result_sha256 = _DIGEST_INITIAL_WRITE_RESULT_VERIFIER({"affectedRows": "1"})
        if parameter_sha256 != verified_parameter_sha256 or result_sha256 != verified_result_sha256:
            _fail("GE_CURSOR_B3_SEQUENCE_ZERO_DIGEST")

        try:
            mint_sql, mint_sql_sha256, mint_parameter_order = (
                _assert_operation_sequence_zero_sql_commitment_intrinsic()
            )
            if (
                mint_sql != canonical_sql
                or mint_sql_sha256 != canonical_sql_sha256
                or mint_parameter_order != canonical_parameter_order
            ):
                _fail("GE_CURSOR_B3_SEQUENCE_ZERO_SQL")
        except BaseException as error:
            reason = (
                "SQLite operation-sequence-zero SQL identity drifted"
                if isinstance(error, ValueError) and str(error) == "GE_CURSOR_B3_SEQUENCE_ZERO_SQL"
                else "SQLite operation-sequence-zero SQL preflight failed"
            )
            _poison(state, authority, reason)
            raise

        ledger_after = _SQLiteCursorOuterPublicationLedgerSnapshot(
            ledger_before.affected_rows_watermark + 1,
            ledger_before.fixed_statement_count + 1,
            ledger_before.logical_write_sequence + 1,
        )
        receipt = _SQLiteOperationSequenceZeroPublicationReceipt(_CONSTRUCTION_TOKEN)
        _identity_set(
            _OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS,
            receipt,
            _OperationSequenceZeroPublicationReceiptRecord(
                affected_rows=1,
                authority_id=_STABLE_ID(authority),
                authority_ref=_STABLE_REF(authority),
                baseline_captured_at_ms=baseline_captured_at_ms,
                baseline_entries_receipt_id=_STABLE_ID(baseline_entries_publication_receipt),
                baseline_entries_receipt_ref=_STABLE_REF(baseline_entries_publication_receipt),
                baseline_header_receipt_id=_STABLE_ID(baseline_header_publication_receipt),
                baseline_header_receipt_ref=_STABLE_REF(baseline_header_publication_receipt),
                baseline_id=state.projection_identity.baseline_id,
                connection_id=_STABLE_ID(state.connection),
                execute_count=1,
                fixed_insert_sql=mint_sql,
                fixed_insert_sql_sha256=mint_sql_sha256,
                last_commit_sequence=0,
                migration_0002_receipt_id=_STABLE_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_STABLE_REF(migration_0002_receipt),
                outer_clock_evidence_id=_STABLE_ID(state.outer_clock_evidence),
                outer_clock_evidence_ref=_STABLE_REF(state.outer_clock_evidence),
                outer_ledger_after=ledger_after,
                outer_ledger_before=ledger_before,
                outer_ledger_delta=_SQLiteCursorOuterPublicationLedgerSnapshot(1, 1, 1),
                outer_provider_now_ms=updated_at_ms,
                parameter_order=mint_parameter_order,
                parameter_sha256=parameter_sha256,
                fence_id=_STABLE_ID(fence),
                fence_ref=_STABLE_REF(fence),
                prepare_count=1,
                projection_identity_id=_STABLE_ID(state.projection_identity),
                projection_reference_id=_STABLE_ID(state.projection_reference),
                projection_reference_ref=_STABLE_REF(state.projection_reference),
                reader_lease_id=_STABLE_ID(reader_lease),
                reader_lease_ref=_STABLE_REF(reader_lease),
                result_sha256=result_sha256,
                total_changes_after=progress.total_changes,
                total_changes_before=total_before,
                transaction_epoch_after=progress.transaction_epoch,
                transaction_epoch_before=epoch_before,
                transaction_generation=state.transaction_generation,
                updated_at_ms=updated_at_ms,
            ),
        )
        state.logical_write_sequence = ledger_after.logical_write_sequence
        state.fixed_statement_count = ledger_after.fixed_statement_count
        state.affected_rows_watermark = ledger_after.affected_rows_watermark
        state.operation_sequence_zero_publication_receipt = receipt
        state.operation_sequence_zero_publication_receipt_mint_count = 1
        state.write_phase = "sequence-zero-complete"
        return receipt
    except BaseException:
        if execution is not None:
            with suppress(BaseException):
                progress = _READ_OPERATION_SEQUENCE_ZERO_PROGRESS(state.connection, execution)
                state.current_transaction_epoch = progress.transaction_epoch
                state.current_total_changes = progress.total_changes
                state.operation_sequence_zero_prepare_count = progress.prepare_count
                state.operation_sequence_zero_execute_count = progress.execute_count
                state.operation_sequence_zero_affected_rows = (
                    1 if progress.affected_rows == 1 else 0
                )
                state.fixed_statement_count = (
                    ledger_before.fixed_statement_count + progress.completed_execution_count
                )
                state.affected_rows_watermark = (
                    ledger_before.affected_rows_watermark + progress.affected_rows
                )
        _poison(state, authority, "SQLite operation-sequence-zero publication failed")
        raise


def _assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_0002_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    baseline_entries_publication_receipt: _SQLiteBaselineEntriesPublicationReceipt,
    baseline_header_publication_receipt: _SQLiteBaselineHeaderPublicationReceipt,
    receipt: _SQLiteOperationSequenceZeroPublicationReceipt,
) -> _SQLiteOperationSequenceZeroPublicationReceipt:
    """Reprove sequence zero without consuming any initial-write receipt."""

    record = _operation_sequence_zero_receipt_record(receipt)
    if (
        record.authority_id != _STABLE_ID(authority)
        or record.authority_ref() is not authority
        or record.baseline_entries_receipt_id != _STABLE_ID(baseline_entries_publication_receipt)
        or record.baseline_entries_receipt_ref() is not baseline_entries_publication_receipt
        or record.baseline_header_receipt_id != _STABLE_ID(baseline_header_publication_receipt)
        or record.baseline_header_receipt_ref() is not baseline_header_publication_receipt
        or record.migration_0002_receipt_id != _STABLE_ID(migration_0002_receipt)
        or record.migration_0002_receipt_ref() is not migration_0002_receipt
        or record.fence_id != _STABLE_ID(fence)
        or record.fence_ref() is not fence
        or record.reader_lease_id != _STABLE_ID(reader_lease)
        or record.reader_lease_ref() is not reader_lease
    ):
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_GRAPH")

    state = _authority_state(authority)
    try:
        canonical_sql, canonical_sql_sha256, canonical_parameter_order = (
            _assert_operation_sequence_zero_sql_commitment_intrinsic()
        )
    except BaseException as error:
        reason = (
            "SQLite operation-sequence-zero SQL identity drifted"
            if isinstance(error, ValueError) and str(error) == "GE_CURSOR_B3_SEQUENCE_ZERO_SQL"
            else "SQLite operation-sequence-zero SQL preflight failed"
        )
        _poison(state, authority, reason)
        raise
    try:
        _assert_sqlite_cursor_baseline_header_publication_receipt_intrinsic(
            authority,
            migration_0002_receipt,
            fence,
            reader_lease,
            baseline_entries_publication_receipt,
            baseline_header_publication_receipt,
        )
        source_commitment = _assert_source_header_commitment_intrinsic(state)
        rederived_provider_now_ms = _read_sequence_zero_clock_value(state)
        parameter_sha256 = _DIGEST_INITIAL_WRITE_PARAMETERS_VERIFIER(
            _VERIFY_OPERATION_SEQUENCE_ZERO_FRAME(
                state.projection_identity.baseline_id,
                source_commitment.captured_at_ms,
                rederived_provider_now_ms,
            )
        )
        result_sha256 = _DIGEST_INITIAL_WRITE_RESULT_VERIFIER({"affectedRows": "1"})
        insert_sha256 = _SHA256(record.fixed_insert_sql.encode("utf-8")).hexdigest()
    except BaseException:
        _poison(state, authority, "SQLite operation-sequence-zero receipt proof failed")
        raise

    header_record = _baseline_header_receipt_record(baseline_header_publication_receipt)
    projection_reference = record.projection_reference_ref()
    clock_evidence = record.outer_clock_evidence_ref()
    before = record.outer_ledger_before
    after = record.outer_ledger_after
    delta = record.outer_ledger_delta
    projection = state.projection_identity
    if (
        projection_reference is not state.projection_reference
        or _STABLE_ID(projection_reference) != record.projection_reference_id
        or clock_evidence is not state.outer_clock_evidence
        or record.outer_clock_evidence_id != _STABLE_ID(state.outer_clock_evidence)
        or state.operation_sequence_zero_publication_receipt is not receipt
        or state.operation_sequence_zero_publication_receipt_mint_count != 1
        or state.operation_sequence_zero_logical_execution_count != 1
        or state.operation_sequence_zero_prepare_count != 1
        or state.operation_sequence_zero_execute_count != 1
        or state.operation_sequence_zero_affected_rows != 1
        or state.write_phase not in {"sequence-zero-complete", "initial-stage-adoption-complete"}
        or state.logical_write_sequence < after.logical_write_sequence
        or state.fixed_statement_count < after.fixed_statement_count
        or state.affected_rows_watermark < after.affected_rows_watermark
        or state.current_transaction_epoch < record.transaction_epoch_after
        or state.current_total_changes < record.total_changes_after
        or record.connection_id != _STABLE_ID(state.connection)
        or record.projection_identity_id != _STABLE_ID(projection)
        or record.baseline_id != projection.baseline_id
        or record.baseline_captured_at_ms != source_commitment.captured_at_ms
        or record.outer_provider_now_ms != rederived_provider_now_ms
        or record.updated_at_ms != rederived_provider_now_ms
        or record.updated_at_ms < record.baseline_captured_at_ms
        or record.last_commit_sequence != 0
        or record.fixed_insert_sql != canonical_sql
        or record.fixed_insert_sql_sha256 != canonical_sql_sha256
        or insert_sha256 != record.fixed_insert_sql_sha256
        or record.parameter_order != canonical_parameter_order
        or record.parameter_sha256 != parameter_sha256
        or record.result_sha256 != result_sha256
        or record.prepare_count != 1
        or record.execute_count != 1
        or record.affected_rows != 1
        or record.total_changes_before != header_record.total_changes_after
        or record.total_changes_after != record.total_changes_before + 1
        or record.transaction_epoch_before != header_record.transaction_epoch_after
        or record.transaction_epoch_after != record.transaction_epoch_before + 1
        or record.transaction_generation is not state.transaction_generation
        or delta.logical_write_sequence != 1
        or delta.fixed_statement_count != 1
        or delta.affected_rows_watermark != 1
        or after.logical_write_sequence != before.logical_write_sequence + 1
        or after.fixed_statement_count != before.fixed_statement_count + 1
        or after.affected_rows_watermark != before.affected_rows_watermark + 1
        or not _exact_outer_ledger(before, header_record.outer_ledger_after)
    ):
        _poison(state, authority, "SQLite operation-sequence-zero receipt graph drifted")
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_DRIFT")
    return receipt


def _read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
    receipt: _SQLiteOperationSequenceZeroPublicationReceipt,
) -> _SQLiteOperationSequenceZeroPublicationReceiptSnapshot:
    record = _operation_sequence_zero_receipt_record(receipt)
    authority = record.authority_ref()
    entries_receipt = record.baseline_entries_receipt_ref()
    header_receipt = record.baseline_header_receipt_ref()
    migration_0002_receipt = record.migration_0002_receipt_ref()
    fence = record.fence_ref()
    reader_lease = record.reader_lease_ref()
    clock_evidence = record.outer_clock_evidence_ref()
    projection_reference = record.projection_reference_ref()
    if (
        authority is None
        or entries_receipt is None
        or header_receipt is None
        or migration_0002_receipt is None
        or fence is None
        or reader_lease is None
        or clock_evidence is None
        or projection_reference is None
    ):
        _fail("GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT")
    _assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic(
        authority,
        migration_0002_receipt,
        fence,
        reader_lease,
        entries_receipt,
        header_receipt,
        receipt,
    )
    state = _authority_state(authority)
    return _SQLiteOperationSequenceZeroPublicationReceiptSnapshot(
        affected_rows=1,
        authority=authority,
        baseline_captured_at_ms=record.baseline_captured_at_ms,
        baseline_entries_publication_receipt=entries_receipt,
        baseline_header_publication_receipt=header_receipt,
        baseline_id=record.baseline_id,
        connection=state.connection,
        execute_count=1,
        fixed_insert_sql=record.fixed_insert_sql,
        fixed_insert_sql_sha256=record.fixed_insert_sql_sha256,
        last_commit_sequence=0,
        migration_0002_receipt=migration_0002_receipt,
        mint_count=1,
        outer_clock_evidence=clock_evidence,
        outer_ledger_after=record.outer_ledger_after,
        outer_ledger_before=record.outer_ledger_before,
        outer_ledger_delta=record.outer_ledger_delta,
        outer_provider_now_ms=record.outer_provider_now_ms,
        parameter_order=record.parameter_order,
        parameter_sha256=record.parameter_sha256,
        post_ddl_catalog_fence=fence,
        prepare_count=1,
        projection_identity=state.projection_identity,
        projection_reference=projection_reference,
        reader_lease=reader_lease,
        result_sha256=record.result_sha256,
        total_changes_after=record.total_changes_after,
        total_changes_before=record.total_changes_before,
        total_changes_delta=1,
        transaction_epoch_after=record.transaction_epoch_after,
        transaction_epoch_before=record.transaction_epoch_before,
        transaction_generation=record.transaction_generation,
        updated_at_ms=record.updated_at_ms,
        write_kind="operation-sequence-zero-publication",
    )


def _checked_initial_publication_bundle_presentation_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    bundle: _SQLiteCursorInitialPublicationReceiptBundle,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    _tuple_length: Callable[[tuple[object, ...]], int] = _TUPLE_LEN,
    _tuple_item: Callable[[tuple[object, ...], int], object] = _TUPLE_GETITEM,
) -> _CheckedInitialPublicationBundle:
    """Resolve an exact carrier and immutable registry edges without live reads."""

    if _STABLE_TYPE(bundle) is not tuple or _tuple_length(bundle) != 4:
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE")
    migration = _tuple_item(bundle, 0)
    entries = _tuple_item(bundle, 1)
    header = _tuple_item(bundle, 2)
    sequence = _tuple_item(bundle, 3)
    if (
        _STABLE_TYPE(authority) is not _SQLiteCursorStageOwnershipOuterPublicationAuthority
        or _STABLE_TYPE(migration) is not _SQLiteMigration0002CatalogRebuildReceipt
        or _STABLE_TYPE(entries) is not _SQLiteBaselineEntriesPublicationReceipt
        or _STABLE_TYPE(header) is not _SQLiteBaselineHeaderPublicationReceipt
        or _STABLE_TYPE(sequence) is not _SQLiteOperationSequenceZeroPublicationReceipt
        or _STABLE_TYPE(fence) is not _SQLiteCursorPostDdlCatalogFence
        or _STABLE_TYPE(reader_lease) is not _SQLiteCursorPostDdlPublicationReaderLease
        or _STABLE_ID(migration) in {_STABLE_ID(entries), _STABLE_ID(header), _STABLE_ID(sequence)}
        or _STABLE_ID(entries) in {_STABLE_ID(header), _STABLE_ID(sequence)}
        or _STABLE_ID(header) == _STABLE_ID(sequence)
    ):
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE")
    authority_entry = _authority_state(authority)
    migration_entry = _identity_get(_MIGRATION_0002_RECEIPTS, migration, _STABLE_TYPE(migration))
    entries_entry = _identity_get(
        _BASELINE_ENTRIES_PUBLICATION_RECEIPTS, entries, _STABLE_TYPE(entries)
    )
    header_entry = _identity_get(
        _BASELINE_HEADER_PUBLICATION_RECEIPTS, header, _STABLE_TYPE(header)
    )
    sequence_entry = _identity_get(
        _OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPTS, sequence, _STABLE_TYPE(sequence)
    )
    fence_entry = _identity_get(_POST_DDL_CATALOG_FENCES, fence, _STABLE_TYPE(fence))
    reader_entry = _identity_get(
        _POST_DDL_PUBLICATION_READER_LEASES, reader_lease, _STABLE_TYPE(reader_lease)
    )
    if (
        authority_entry is None
        or migration_entry is None
        or entries_entry is None
        or header_entry is None
        or sequence_entry is None
        or fence_entry is None
        or reader_entry is None
    ):
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE")
    migration_record = cast(_Migration0002ReceiptRecord, migration_entry)
    entries_record = cast(_BaselineEntriesPublicationReceiptRecord, entries_entry)
    header_record = cast(_BaselineHeaderPublicationReceiptRecord, header_entry)
    sequence_record = cast(_OperationSequenceZeroPublicationReceiptRecord, sequence_entry)
    fence_record = cast(_PostDdlCatalogFenceRecord, fence_entry)
    reader_record = cast(_PostDdlPublicationReaderLeaseRecord, reader_entry)
    if (
        migration_record.authority_ref() is not authority
        or entries_record.authority_ref() is not authority
        or header_record.authority_ref() is not authority
        or sequence_record.authority_ref() is not authority
        or fence_record.authority_ref() is not authority
        or reader_record.authority_ref() is not authority
        or entries_record.migration_0002_receipt_ref() is not migration
        or header_record.migration_0002_receipt_ref() is not migration
        or sequence_record.migration_0002_receipt_ref() is not migration
        or fence_record.migration_0002_receipt_ref() is not migration
        or reader_record.migration_0002_receipt_ref() is not migration
        or header_record.baseline_entries_receipt_ref() is not entries
        or sequence_record.baseline_entries_receipt_ref() is not entries
        or sequence_record.baseline_header_receipt_ref() is not header
        or entries_record.fence_ref() is not fence
        or header_record.fence_ref() is not fence
        or sequence_record.fence_ref() is not fence
        or reader_record.fence_ref() is not fence
        or entries_record.reader_lease_ref() is not reader_lease
        or header_record.reader_lease_ref() is not reader_lease
        or sequence_record.reader_lease_ref() is not reader_lease
    ):
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE_GRAPH")
    return _CheckedInitialPublicationBundle(
        migration,
        migration_record,
        entries,
        entries_record,
        header,
        header_record,
        sequence,
        sequence_record,
    )


def _initial_adoption_watermark(
    state: _AuthorityState,
) -> _SQLiteCursorInitialPublicationStageWatermark:
    ledger = _outer_ledger_snapshot(state)
    return _SQLiteCursorInitialPublicationStageWatermark(
        _SQLiteCursorInitialPublicationOuterLedgerWatermark(
            ledger.affected_rows_watermark,
            ledger.fixed_statement_count,
            ledger.logical_write_sequence,
        ),
        SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
        state.current_total_changes,
        state.current_transaction_epoch,
    )


def _validate_initial_adoption_graph_intrinsic(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
    checked: _CheckedInitialPublicationBundle,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
) -> _SQLiteCursorInitialPublicationStageWatermark:
    if (
        state.initial_stage_adoption_receipt is not None
        or state.initial_stage_adoption_receipt_mint_count != 0
        or state.receipt_consumption_count != 0
        or state.tombstone_mint_count != 0
        or state.migration_0002_consumed_tombstone is not None
        or state.baseline_entries_consumed_tombstone is not None
        or state.baseline_header_consumed_tombstone is not None
        or state.operation_sequence_zero_consumed_tombstone is not None
        or _identity_get(
            _MIGRATION_0002_RECEIPT_CONSUMPTIONS,
            checked.migration_0002_receipt,
            _STABLE_TYPE(checked.migration_0002_receipt),
        )
        is not None
        or _identity_get(
            _BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
            checked.baseline_entries_receipt,
            _STABLE_TYPE(checked.baseline_entries_receipt),
        )
        is not None
        or _identity_get(
            _BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
            checked.baseline_header_receipt,
            _STABLE_TYPE(checked.baseline_header_receipt),
        )
        is not None
        or _identity_get(
            _OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
            checked.operation_sequence_zero_receipt,
            _STABLE_TYPE(checked.operation_sequence_zero_receipt),
        )
        is not None
    ):
        _poison(state, authority, "SQLite initial publication adoption was replayed")
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_REUSE")
    try:
        generation, epoch, changes = _owner_snapshot(state.connection)
        if (
            generation is not state.transaction_generation
            or epoch != state.current_transaction_epoch
            or changes != state.current_total_changes
            or state.lifecycle != "active"
            or state.write_phase != "sequence-zero-complete"
            or state.migration_0002_receipt is not checked.migration_0002_receipt
            or state.baseline_entries_publication_receipt is not checked.baseline_entries_receipt
            or state.baseline_header_publication_receipt is not checked.baseline_header_receipt
            or state.operation_sequence_zero_publication_receipt
            is not checked.operation_sequence_zero_receipt
            or state.post_ddl_catalog_fence is not fence
            or state.post_ddl_publication_reader_lease is not reader_lease
        ):
            _fail("GE_CURSOR_B3_INITIAL_ADOPTION_GRAPH_DRIFT")
        _assert_sqlite_cursor_operation_sequence_zero_publication_receipt_intrinsic(
            authority,
            checked.migration_0002_receipt,
            fence,
            reader_lease,
            checked.baseline_entries_receipt,
            checked.baseline_header_receipt,
            checked.operation_sequence_zero_receipt,
        )
        _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic(
            authority,
            checked.migration_0002_receipt,
            fence,
            reader_lease,
        )
        reader = _post_ddl_publication_reader_record(reader_lease)
        migration = checked.migration_0002_record.snapshot
        entries = checked.baseline_entries_record
        header = checked.baseline_header_record
        sequence = checked.operation_sequence_zero_record
        ledger = _outer_ledger_snapshot(state)
        expected_fixed = (
            SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT + entries.entry_count + 2
        )
        expected_affected = migration.affected_rows + entries.affected_rows + 2
        if (
            reader.lifecycle != "retired"
            or reader.close_attempt_count != 1
            or reader.close_succeeded is not True
            or reader.rederived_projection is None
            or not _same_projection_identity(reader.rederived_projection, state.projection_identity)
            or not _exact_outer_ledger(migration.outer_ledger_after, entries.outer_ledger_before)
            or not _exact_outer_ledger(entries.outer_ledger_after, header.outer_ledger_before)
            or not _exact_outer_ledger(header.outer_ledger_after, sequence.outer_ledger_before)
            or not _exact_outer_ledger(sequence.outer_ledger_after, ledger)
            or ledger.logical_write_sequence != 4
            or ledger.fixed_statement_count != expected_fixed
            or ledger.affected_rows_watermark != expected_affected
            or sequence.transaction_epoch_after != state.current_transaction_epoch
            or sequence.total_changes_after != state.current_total_changes
            or fence is not state.post_ddl_catalog_fence
        ):
            _fail("GE_CURSOR_B3_INITIAL_ADOPTION_GRAPH_DRIFT")
        return _initial_adoption_watermark(state)
    except BaseException:
        _poison(state, authority, "SQLite initial publication adoption graph drifted")
        raise


def _make_initial_adoption_atomic_tail(
    *,
    publish_lower: Callable[..., Any],
    poison_lower: Callable[..., Any],
    object_new: Callable[[type[object]], object],
    adoption_receipt_type: type[_SQLiteCursorInitialStageAdoptionReceipt],
    migration_tombstone_type: type[_SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone],
    entries_tombstone_type: type[_SQLiteBaselineEntriesPublicationReceiptConsumedTombstone],
    header_tombstone_type: type[_SQLiteBaselineHeaderPublicationReceiptConsumedTombstone],
    sequence_tombstone_type: type[_SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone],
    adoption_record_type: type[_InitialStageAdoptionReceiptRecord],
    consumption_record_type: type[_ConsumedReceiptTombstoneRecord],
    identity_entry_type: type[_IdentityEntry],
    identity: Callable[[object], int],
    weak_reference: Callable[..., Any],
    dictionary_get: Callable[..., Any],
    dictionary_set: Callable[..., None],
    dictionary_pop: Callable[..., object],
    exception_type: type[BaseException],
    adoption_receipts: dict[int, _IdentityEntry],
    adoption_tombstones: dict[int, _IdentityEntry],
    migration_consumptions: dict[int, _IdentityEntry],
    entries_consumptions: dict[int, _IdentityEntry],
    header_consumptions: dict[int, _IdentityEntry],
    sequence_consumptions: dict[int, _IdentityEntry],
    target_catalog_sha256: str,
) -> Callable[..., _SQLiteCursorInitialStageAdoptionReceipt]:
    """Seal every capability reachable after the cancellation boundary."""

    def identity_set(registry: dict[int, _IdentityEntry], key: object, value: object) -> None:
        key_id = identity(key)

        def retire(dead: ReferenceType[object]) -> None:
            current = dictionary_get(registry, key_id)
            if current is not None and current.key_ref is dead:
                dictionary_pop(registry, key_id, None)

        key_ref = weak_reference(key, retire)
        dictionary_set(registry, key_id, identity_entry_type(key_ref, value))

    def mint(proof_type: type[object]) -> Any:
        # Bypass a runtime lookup of the module construction token inside the
        # opaque class __init__; exact mint authority is this sealed closure.
        return object_new(proof_type)

    def perform_tail(
        state: _AuthorityState,
        authority: _SQLiteCursorOuterPublicationAuthority,
        connection: SQLiteV1BaselineConnectionOwner,
        stage: SQLiteV1BaselineTempStage,
        source_receipt: object,
        projection_identity: BaselineProjectionIdentity,
        projection_reference: SQLiteCursorExactProjectionReference,
        transfer: _SQLiteCursorStageOwnershipTransfer,
        migration_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
        entries_receipt: _SQLiteBaselineEntriesPublicationReceipt,
        header_receipt: _SQLiteBaselineHeaderPublicationReceipt,
        sequence_receipt: _SQLiteOperationSequenceZeroPublicationReceipt,
        fence: _SQLiteCursorPostDdlCatalogFence,
        reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
        retired_b2_fence: _SQLiteBaselineCursorB2FenceRetirement,
        watermark: _SQLiteCursorInitialPublicationStageWatermark,
        ledger: _SQLiteCursorOuterPublicationLedgerSnapshot,
        adopted_total_changes: int,
        adopted_transaction_epoch: int,
        lower_tail: object,
        created_records: list[Any],
    ) -> _SQLiteCursorInitialStageAdoptionReceipt:
        adoption_receipt: _SQLiteCursorInitialStageAdoptionReceipt = mint(adoption_receipt_type)
        migration_tombstone: _SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone = mint(
            migration_tombstone_type
        )
        entries_tombstone: _SQLiteBaselineEntriesPublicationReceiptConsumedTombstone = mint(
            entries_tombstone_type
        )
        header_tombstone: _SQLiteBaselineHeaderPublicationReceiptConsumedTombstone = mint(
            header_tombstone_type
        )
        sequence_tombstone: _SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone = mint(
            sequence_tombstone_type
        )
        adoption_record = adoption_record_type(
            lifecycle="pending",
            mint_count=1,
            write_kind="initial-publication-stage-adoption",
            authority_id=identity(authority),
            authority_ref=weak_reference(authority),
            connection_id=identity(connection),
            stage_id=identity(stage),
            stage_ref=weak_reference(stage),
            receipt_id=identity(source_receipt),
            receipt_ref=weak_reference(source_receipt),
            projection_identity_id=identity(projection_identity),
            projection_reference_id=identity(projection_reference),
            projection_reference_ref=weak_reference(projection_reference),
            transfer_id=identity(transfer),
            transfer_ref=weak_reference(transfer),
            migration_0002_receipt_id=identity(migration_receipt),
            migration_0002_receipt_ref=weak_reference(migration_receipt),
            baseline_entries_receipt_id=identity(entries_receipt),
            baseline_entries_receipt_ref=weak_reference(entries_receipt),
            baseline_header_receipt_id=identity(header_receipt),
            baseline_header_receipt_ref=weak_reference(header_receipt),
            operation_sequence_zero_receipt_id=identity(sequence_receipt),
            operation_sequence_zero_receipt_ref=weak_reference(sequence_receipt),
            migration_0002_tombstone_id=identity(migration_tombstone),
            migration_0002_tombstone_ref=weak_reference(migration_tombstone),
            baseline_entries_tombstone_id=identity(entries_tombstone),
            baseline_entries_tombstone_ref=weak_reference(entries_tombstone),
            baseline_header_tombstone_id=identity(header_tombstone),
            baseline_header_tombstone_ref=weak_reference(header_tombstone),
            operation_sequence_zero_tombstone_id=identity(sequence_tombstone),
            operation_sequence_zero_tombstone_ref=weak_reference(sequence_tombstone),
            fence_id=identity(fence),
            fence_ref=weak_reference(fence),
            reader_lease_id=identity(reader_lease),
            reader_lease_ref=weak_reference(reader_lease),
            retired_b2_fence_id=identity(retired_b2_fence),
            retired_b2_fence_ref=weak_reference(retired_b2_fence),
            watermark=watermark,
            adopted_outer_ledger=ledger,
            adopted_total_changes=adopted_total_changes,
            adopted_transaction_epoch=adopted_transaction_epoch,
            target_catalog_sha256=target_catalog_sha256,
        )
        created_records.append(adoption_record)

        def tombstone_record(original: object) -> _ConsumedReceiptTombstoneRecord:
            return consumption_record_type(
                "pending",
                identity(original),
                weak_reference(original),
                identity(adoption_receipt),
                weak_reference(adoption_receipt),
            )

        migration_consumption = tombstone_record(migration_receipt)
        created_records.append(migration_consumption)
        entries_consumption = tombstone_record(entries_receipt)
        created_records.append(entries_consumption)
        header_consumption = tombstone_record(header_receipt)
        created_records.append(header_consumption)
        sequence_consumption = tombstone_record(sequence_receipt)
        created_records.append(sequence_consumption)
        identity_set(adoption_receipts, adoption_receipt, adoption_record)
        identity_set(adoption_tombstones, migration_tombstone, migration_consumption)
        identity_set(adoption_tombstones, entries_tombstone, entries_consumption)
        identity_set(adoption_tombstones, header_tombstone, header_consumption)
        identity_set(adoption_tombstones, sequence_tombstone, sequence_consumption)
        identity_set(
            migration_consumptions,
            migration_receipt,
            migration_consumption,
        )
        identity_set(
            entries_consumptions,
            entries_receipt,
            entries_consumption,
        )
        identity_set(
            header_consumptions,
            header_receipt,
            header_consumption,
        )
        identity_set(
            sequence_consumptions,
            sequence_receipt,
            sequence_consumption,
        )
        try:
            publish_lower(lower_tail)
            state.migration_0002_consumed_tombstone = migration_tombstone
            state.baseline_entries_consumed_tombstone = entries_tombstone
            state.baseline_header_consumed_tombstone = header_tombstone
            state.operation_sequence_zero_consumed_tombstone = sequence_tombstone
            state.receipt_consumption_count = 4
            state.tombstone_mint_count = 4
            state.initial_stage_adoption_receipt = adoption_receipt
            state.initial_stage_adoption_receipt_mint_count = 1
            state.write_phase = "initial-stage-adoption-complete"
            migration_consumption.lifecycle = "active"
            entries_consumption.lifecycle = "active"
            header_consumption.lifecycle = "active"
            sequence_consumption.lifecycle = "active"
            adoption_record.lifecycle = "active"
            return adoption_receipt
        except exception_type:
            adoption_record.lifecycle = "poisoned"
            migration_consumption.lifecycle = "poisoned"
            entries_consumption.lifecycle = "poisoned"
            header_consumption.lifecycle = "poisoned"
            sequence_consumption.lifecycle = "poisoned"
            state.lifecycle = "poisoned"
            state.write_phase = "poisoned"
            state.stage_ownership_poison_reason = "SQLite initial publication adoption tail failed"
            try:  # noqa: SIM105 - tail must not resolve a mutable suppress global
                poison_lower(
                    transfer,
                    authority,
                    "SQLite initial publication adoption tail failed",
                )
            except exception_type:
                pass
            raise

    def atomic_tail(
        state: _AuthorityState,
        authority: _SQLiteCursorOuterPublicationAuthority,
        connection: SQLiteV1BaselineConnectionOwner,
        stage: SQLiteV1BaselineTempStage,
        source_receipt: object,
        projection_identity: BaselineProjectionIdentity,
        projection_reference: SQLiteCursorExactProjectionReference,
        transfer: _SQLiteCursorStageOwnershipTransfer,
        migration_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
        entries_receipt: _SQLiteBaselineEntriesPublicationReceipt,
        header_receipt: _SQLiteBaselineHeaderPublicationReceipt,
        sequence_receipt: _SQLiteOperationSequenceZeroPublicationReceipt,
        fence: _SQLiteCursorPostDdlCatalogFence,
        reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
        retired_b2_fence: _SQLiteBaselineCursorB2FenceRetirement,
        watermark: _SQLiteCursorInitialPublicationStageWatermark,
        ledger: _SQLiteCursorOuterPublicationLedgerSnapshot,
        adopted_total_changes: int,
        adopted_transaction_epoch: int,
        lower_tail: object,
    ) -> _SQLiteCursorInitialStageAdoptionReceipt:
        created_records: list[Any] | None = None
        try:
            created_records = []
            return perform_tail(
                state,
                authority,
                connection,
                stage,
                source_receipt,
                projection_identity,
                projection_reference,
                transfer,
                migration_receipt,
                entries_receipt,
                header_receipt,
                sequence_receipt,
                fence,
                reader_lease,
                retired_b2_fence,
                watermark,
                ledger,
                adopted_total_changes,
                adopted_transaction_epoch,
                lower_tail,
                created_records,
            )
        except exception_type:
            if created_records is not None:
                for record in created_records:
                    record.lifecycle = "poisoned"
            state.migration_0002_consumed_tombstone = None
            state.baseline_entries_consumed_tombstone = None
            state.baseline_header_consumed_tombstone = None
            state.operation_sequence_zero_consumed_tombstone = None
            state.receipt_consumption_count = 0
            state.tombstone_mint_count = 0
            state.initial_stage_adoption_receipt = None
            state.initial_stage_adoption_receipt_mint_count = 0
            state.lifecycle = "poisoned"
            state.write_phase = "poisoned"
            state.stage_ownership_poison_reason = "SQLite initial publication adoption tail failed"
            try:  # noqa: SIM105 - tail must not resolve a mutable suppress global
                poison_lower(
                    transfer,
                    authority,
                    "SQLite initial publication adoption tail failed",
                )
            except exception_type:
                pass
            raise

    return atomic_tail


_INITIAL_ADOPTION_ATOMIC_TAIL = _make_initial_adoption_atomic_tail(
    publish_lower=_OWNERSHIP_PUBLISH_INITIAL_ADOPTION,
    poison_lower=_OWNERSHIP_POISON,
    object_new=object.__new__,
    adoption_receipt_type=_SQLiteCursorInitialStageAdoptionReceipt,
    migration_tombstone_type=_SQLiteMigration0002CatalogRebuildReceiptConsumedTombstone,
    entries_tombstone_type=_SQLiteBaselineEntriesPublicationReceiptConsumedTombstone,
    header_tombstone_type=_SQLiteBaselineHeaderPublicationReceiptConsumedTombstone,
    sequence_tombstone_type=(_SQLiteOperationSequenceZeroPublicationReceiptConsumedTombstone),
    adoption_record_type=_InitialStageAdoptionReceiptRecord,
    consumption_record_type=_ConsumedReceiptTombstoneRecord,
    identity_entry_type=_IdentityEntry,
    identity=_ID,
    weak_reference=_REF,
    dictionary_get=_DICT_GET,
    dictionary_set=_DICT_SETITEM,
    dictionary_pop=_DICT_POP,
    exception_type=BaseException,
    adoption_receipts=_INITIAL_STAGE_ADOPTION_RECEIPTS,
    adoption_tombstones=_INITIAL_STAGE_ADOPTION_TOMBSTONES,
    migration_consumptions=_MIGRATION_0002_RECEIPT_CONSUMPTIONS,
    entries_consumptions=_BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
    header_consumptions=_BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
    sequence_consumptions=_OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
    target_catalog_sha256=SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
)


def _adopt_sqlite_cursor_initial_publication_stage_with_tail_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    bundle: _SQLiteCursorInitialPublicationReceiptBundle,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    cancellation: _SQLiteCursorOuterPublicationCancellationSignal | None,
    atomic_tail: Callable[..., _SQLiteCursorInitialStageAdoptionReceipt],
    prepare_initial_adoption: Callable[..., Any],
) -> _SQLiteCursorInitialStageAdoptionReceipt:
    """Atomically consume the four write receipts into the permanent stage graph."""

    checked = _checked_initial_publication_bundle_presentation_intrinsic(
        authority, bundle, fence, reader_lease
    )
    cancellation_state = _reader_cancellation_state(cancellation)
    state = _authority_state(authority)
    watermark = _validate_initial_adoption_graph_intrinsic(
        state, authority, checked, fence, reader_lease
    )
    try:
        lower_mint = prepare_initial_adoption(
            state.connection,
            state.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            authority,
            reader_lease,
            watermark,
        )
    except BaseException:
        _poison(state, authority, "SQLite initial publication adoption preparation failed")
        raise

    connection = state.connection
    stage = state.stage
    pre_rebind_receipt = state.receipt
    projection_identity = state.projection_identity
    projection_reference = state.projection_reference
    transfer = state.transfer
    migration_receipt = checked.migration_0002_receipt
    entries_receipt = checked.baseline_entries_receipt
    header_receipt = checked.baseline_header_receipt
    sequence_receipt = checked.operation_sequence_zero_receipt
    retired_b2_fence = lower_mint.retired_b2_fence
    lower_watermark = lower_mint.watermark
    lower_tail = lower_mint.tail
    adopted_ledger = checked.operation_sequence_zero_record.outer_ledger_after
    adopted_total_changes = state.current_total_changes
    adopted_transaction_epoch = state.current_transaction_epoch

    # This is the sole cancellation observation.  It occurs after the lower
    # continuation is prepared and before any receipt/tombstone allocation.
    if cancellation_state is not None and cancellation_state.cancelled:
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_CANCELLED")

    return atomic_tail(
        state,
        authority,
        connection,
        stage,
        pre_rebind_receipt,
        projection_identity,
        projection_reference,
        transfer,
        migration_receipt,
        entries_receipt,
        header_receipt,
        sequence_receipt,
        fence,
        reader_lease,
        retired_b2_fence,
        lower_watermark,
        adopted_ledger,
        adopted_total_changes,
        adopted_transaction_epoch,
        lower_tail,
    )


def _close_initial_adoption_entry(
    implementation: Callable[..., _SQLiteCursorInitialStageAdoptionReceipt],
    atomic_tail: Callable[..., _SQLiteCursorInitialStageAdoptionReceipt],
    prepare_initial_adoption: Callable[..., Any],
) -> Callable[..., _SQLiteCursorInitialStageAdoptionReceipt]:
    def adopt(
        authority: _SQLiteCursorOuterPublicationAuthority,
        bundle: _SQLiteCursorInitialPublicationReceiptBundle,
        fence: _SQLiteCursorPostDdlCatalogFence,
        reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
        cancellation: _SQLiteCursorOuterPublicationCancellationSignal | None = None,
    ) -> _SQLiteCursorInitialStageAdoptionReceipt:
        return implementation(
            authority,
            bundle,
            fence,
            reader_lease,
            cancellation,
            atomic_tail,
            prepare_initial_adoption,
        )

    return adopt


_adopt_sqlite_cursor_initial_publication_stage_intrinsic = _close_initial_adoption_entry(
    _adopt_sqlite_cursor_initial_publication_stage_with_tail_intrinsic,
    _INITIAL_ADOPTION_ATOMIC_TAIL,
    _OWNERSHIP_PREPARE_INITIAL_ADOPTION,
)


def _initial_stage_adoption_receipt_record(
    receipt: _SQLiteCursorInitialStageAdoptionReceipt,
) -> _InitialStageAdoptionReceiptRecord:
    record = _identity_get(
        _INITIAL_STAGE_ADOPTION_RECEIPTS,
        receipt,
        _SQLiteCursorInitialStageAdoptionReceipt,
    )
    if record is None:
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT")
    return cast(_InitialStageAdoptionReceiptRecord, record)


def _assert_consumption_intrinsic(
    registry: dict[int, _IdentityEntry],
    original: object,
    tombstone: object,
    adoption_receipt: _SQLiteCursorInitialStageAdoptionReceipt,
) -> None:
    consumption = _identity_get(registry, original, _STABLE_TYPE(original))
    tombstone_entry = _identity_get(
        _INITIAL_STAGE_ADOPTION_TOMBSTONES, tombstone, _STABLE_TYPE(tombstone)
    )
    if (
        consumption is None
        or tombstone_entry is not consumption
        or cast(_ConsumedReceiptTombstoneRecord, consumption).lifecycle != "active"
        or cast(_ConsumedReceiptTombstoneRecord, consumption).original_receipt_ref() is not original
        or cast(_ConsumedReceiptTombstoneRecord, consumption).adoption_receipt_ref()
        is not adoption_receipt
    ):
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_TOMBSTONE_DRIFT")


def _assert_consumed_migration_fence_chain_intrinsic(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
    migration_receipt: _SQLiteMigration0002CatalogRebuildReceipt,
    consumption: _ConsumedReceiptTombstoneRecord,
    fence: _SQLiteCursorPostDdlCatalogFence,
) -> None:
    adoption_receipt = consumption.adoption_receipt_ref()
    if (
        adoption_receipt is None
        or state.initial_stage_adoption_receipt is not adoption_receipt
        or state.migration_0002_consumed_tombstone is None
        or state.post_ddl_catalog_fence is not fence
    ):
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE_GRAPH")
    adoption = _initial_stage_adoption_receipt_record(adoption_receipt)
    if (
        adoption.lifecycle != "active"
        or adoption.authority_ref() is not authority
        or adoption.migration_0002_receipt_ref() is not migration_receipt
        or adoption.fence_ref() is not fence
        or adoption.migration_0002_tombstone_ref() is not state.migration_0002_consumed_tombstone
    ):
        _fail("GE_CURSOR_B3_POST_DDL_CATALOG_FENCE_GRAPH")
    _assert_consumption_intrinsic(
        _MIGRATION_0002_RECEIPT_CONSUMPTIONS,
        migration_receipt,
        state.migration_0002_consumed_tombstone,
        adoption_receipt,
    )


def _assert_adopted_stage_ownership_from_state(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
) -> None:
    receipt = state.initial_stage_adoption_receipt
    if receipt is None:
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT")
    record = _initial_stage_adoption_receipt_record(receipt)
    reader_lease = record.reader_lease_ref()
    retired_b2_fence = record.retired_b2_fence_ref()
    if reader_lease is None or retired_b2_fence is None:
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT_DRIFT")
    _OWNERSHIP_ASSERT_INITIAL_ADOPTED(
        state.connection,
        state.stage,
        state.receipt,
        state.projection_identity,
        state.transfer,
        authority,
        reader_lease,
        retired_b2_fence,
        record.watermark,
    )


def _assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    bundle: _SQLiteCursorInitialPublicationReceiptBundle,
    fence: _SQLiteCursorPostDdlCatalogFence,
    reader_lease: _SQLiteCursorPostDdlPublicationReaderLease,
    receipt: _SQLiteCursorInitialStageAdoptionReceipt,
) -> _SQLiteCursorInitialStageAdoptionReceipt:
    checked = _checked_initial_publication_bundle_presentation_intrinsic(
        authority, bundle, fence, reader_lease
    )
    state = _authority_state(authority)
    try:
        record = _initial_stage_adoption_receipt_record(receipt)
        if (
            record.authority_ref() is not authority
            or state.initial_stage_adoption_receipt is not receipt
        ):
            _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT_SUBSTITUTION")
        migration_tombstone = record.migration_0002_tombstone_ref()
        entries_tombstone = record.baseline_entries_tombstone_ref()
        header_tombstone = record.baseline_header_tombstone_ref()
        sequence_tombstone = record.operation_sequence_zero_tombstone_ref()
        retired_b2_fence = record.retired_b2_fence_ref()
        if (
            record.lifecycle != "active"
            or record.mint_count != 1
            or record.write_kind != "initial-publication-stage-adoption"
            or record.authority_ref() is not authority
            or record.connection_id != _STABLE_ID(state.connection)
            or record.stage_ref() is not state.stage
            or record.receipt_ref() is not state.receipt
            or record.projection_identity_id != _STABLE_ID(state.projection_identity)
            or record.projection_reference_ref() is not state.projection_reference
            or record.transfer_ref() is not state.transfer
            or record.migration_0002_receipt_ref() is not checked.migration_0002_receipt
            or record.baseline_entries_receipt_ref() is not checked.baseline_entries_receipt
            or record.baseline_header_receipt_ref() is not checked.baseline_header_receipt
            or record.operation_sequence_zero_receipt_ref()
            is not checked.operation_sequence_zero_receipt
            or record.fence_ref() is not fence
            or record.reader_lease_ref() is not reader_lease
            or migration_tombstone is None
            or entries_tombstone is None
            or header_tombstone is None
            or sequence_tombstone is None
            or retired_b2_fence is None
            or state.initial_stage_adoption_receipt is not receipt
            or state.initial_stage_adoption_receipt_mint_count != 1
            or state.receipt_consumption_count != 4
            or state.tombstone_mint_count != 4
            or state.migration_0002_consumed_tombstone is not migration_tombstone
            or state.baseline_entries_consumed_tombstone is not entries_tombstone
            or state.baseline_header_consumed_tombstone is not header_tombstone
            or state.operation_sequence_zero_consumed_tombstone is not sequence_tombstone
            or state.write_phase not in {"initial-stage-adoption-complete", "publication-active"}
            or state.current_transaction_epoch != record.adopted_transaction_epoch
            or state.current_total_changes != record.adopted_total_changes
            or not _exact_outer_ledger(_outer_ledger_snapshot(state), record.adopted_outer_ledger)
            or record.target_catalog_sha256
            != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        ):
            _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT_DRIFT")
        generation, epoch, changes = _owner_snapshot(state.connection)
        if (
            generation is not state.transaction_generation
            or epoch != record.adopted_transaction_epoch
            or changes != record.adopted_total_changes
        ):
            _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT_DRIFT")
        if state.write_phase == "initial-stage-adoption-complete":
            _assert_adopted_stage_ownership_from_state(state, authority)
        _assert_sqlite_cursor_post_ddl_publication_reader_terminal_proof_intrinsic(
            authority,
            checked.migration_0002_receipt,
            fence,
            reader_lease,
        )
        _assert_consumption_intrinsic(
            _MIGRATION_0002_RECEIPT_CONSUMPTIONS,
            checked.migration_0002_receipt,
            migration_tombstone,
            receipt,
        )
        _assert_consumption_intrinsic(
            _BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
            checked.baseline_entries_receipt,
            entries_tombstone,
            receipt,
        )
        _assert_consumption_intrinsic(
            _BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
            checked.baseline_header_receipt,
            header_tombstone,
            receipt,
        )
        _assert_consumption_intrinsic(
            _OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
            checked.operation_sequence_zero_receipt,
            sequence_tombstone,
            receipt,
        )
        return receipt
    except BaseException as error:
        _poison(state, authority, "SQLite initial publication adoption receipt drifted")
        if isinstance(error, ValueError) and str(error) == "GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT":
            _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT_SUBSTITUTION")
        raise


def _session_adoption_inputs(
    receipt: _SQLiteCursorInitialStageAdoptionReceipt,
) -> tuple[
    _SQLiteCursorInitialPublicationReceiptBundle,
    _SQLiteCursorPostDdlCatalogFence,
    _SQLiteCursorPostDdlPublicationReaderLease,
    _InitialStageAdoptionReceiptRecord,
]:
    record = _initial_stage_adoption_receipt_record(receipt)
    migration = record.migration_0002_receipt_ref()
    entries = record.baseline_entries_receipt_ref()
    header = record.baseline_header_receipt_ref()
    sequence = record.operation_sequence_zero_receipt_ref()
    fence = record.fence_ref()
    reader = record.reader_lease_ref()
    if (
        migration is None
        or entries is None
        or header is None
        or sequence is None
        or fence is None
        or reader is None
    ):
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH")
    return (migration, entries, header, sequence), fence, reader, record


def _create_sqlite_cursor_publication_session_cancellation_controller_intrinsic() -> (
    _SQLiteCursorPublicationSessionCancellationController
):
    signal = _SQLiteCursorPublicationSessionCancellationSignal(_CONSTRUCTION_TOKEN)
    _identity_set(_PUBLICATION_CANCELLATIONS, signal, _CancellationState())
    return _SQLiteCursorPublicationSessionCancellationController(_CONSTRUCTION_TOKEN, signal)


def _prepare_sqlite_cursor_publication_session_intrinsic(
    authority: _SQLiteCursorOuterPublicationAuthority,
    adoption_receipt: _SQLiteCursorInitialStageAdoptionReceipt,
) -> _SQLiteCursorPublicationSessionPreparedOwner:
    """Validate the adopted graph and prepare all three session continuations."""

    if (
        _STABLE_TYPE(authority) is not _SQLiteCursorStageOwnershipOuterPublicationAuthority
        or _STABLE_TYPE(adoption_receipt) is not _SQLiteCursorInitialStageAdoptionReceipt
    ):
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_PRESENTATION")
    state = _authority_state(authority)
    if (
        _identity_get(
            _INITIAL_STAGE_ADOPTION_RECEIPTS,
            adoption_receipt,
            _SQLiteCursorInitialStageAdoptionReceipt,
        )
        is None
    ):
        _poison(state, authority, "SQLite publication-session receipt forgery")
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH")
    existing = state.publication_prepared_owner
    if existing is not None:
        prepared_state_value = _identity_get(
            _PUBLICATION_PREPARED,
            existing,
            _SQLiteCursorPublicationSessionPreparedOwner,
        )
        prepared_state = cast(_PublicationPreparedState, prepared_state_value)
        if (
            prepared_state_value is None
            or prepared_state.lifecycle != "prepared"
            or prepared_state.authority_ref() is not authority
            or prepared_state.adoption_receipt_ref() is not adoption_receipt
            or state.publication_session is not None
        ):
            _poison(state, authority, "SQLite publication-session substitution")
            _fail("GE_CURSOR_B3_PUBLICATION_SESSION_REUSE")
        bundle, fence, reader, _record = _session_adoption_inputs(adoption_receipt)
        _assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic(
            authority, bundle, fence, reader, adoption_receipt
        )
        repeated_tail = _OWNERSHIP_PREPARE_PUBLICATION_SESSION(
            state.connection,
            state.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            authority,
            existing,
        )
        if repeated_tail is not prepared_state.lower_tail:
            _poison(state, authority, "SQLite publication-session continuation drift")
            _fail("GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH")
        return existing
    if (
        state.lifecycle != "active"
        or state.write_phase != "initial-stage-adoption-complete"
        or state.initial_stage_adoption_receipt is not adoption_receipt
        or state.publication_session is not None
    ):
        _poison(state, authority, "SQLite publication-session preparation drift")
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH")
    bundle, fence, reader, _record = _session_adoption_inputs(adoption_receipt)
    _assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic(
        authority, bundle, fence, reader, adoption_receipt
    )
    prepared = _SQLiteCursorPublicationSessionPreparedOwner(_CONSTRUCTION_TOKEN)
    try:
        lower_tail = _OWNERSHIP_PREPARE_PUBLICATION_SESSION(
            state.connection,
            state.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            authority,
            prepared,
        )
        _identity_set(
            _PUBLICATION_PREPARED,
            prepared,
            _PublicationPreparedState(ref(authority), ref(adoption_receipt), lower_tail),
        )
        state.publication_prepared_owner = prepared
        return prepared
    except BaseException:
        _poison(state, authority, "SQLite publication-session preparation failed")
        raise


def _observe_sqlite_cursor_publication_session_clock_intrinsic(
    prepared: _SQLiteCursorPublicationSessionPreparedOwner,
) -> _ClockEvidence:
    """Observe boundary two only through the exact prepared session owner."""

    prepared_value = _identity_get(
        _PUBLICATION_PREPARED,
        prepared,
        _SQLiteCursorPublicationSessionPreparedOwner,
    )
    if prepared_value is None:
        _fail("GE_CURSOR_B3_PUBLICATION_PREPARED_OWNER")
    prepared_state = cast(_PublicationPreparedState, prepared_value)
    authority = prepared_state.authority_ref()
    adoption_receipt = prepared_state.adoption_receipt_ref()
    if authority is None or adoption_receipt is None:
        _fail("GE_CURSOR_B3_PUBLICATION_PREPARED_OWNER")
    state = _authority_state(authority)
    if prepared_state.lifecycle != "prepared":
        _poison(state, authority, "SQLite publication-session reuse")
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_REUSE")
    if (
        state.publication_prepared_owner is not prepared
        or state.initial_stage_adoption_receipt is not adoption_receipt
        or prepared_state.observed_evidence is not None
    ):
        _poison(state, authority, "SQLite publication-session prepared owner drift")
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_REUSE")
    try:
        _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        evidence = _OBSERVE_CLOCK(state.provider_clock_capability, "before-cursor-rebind")
        prepared_state.observed_evidence = evidence
        return evidence
    except BaseException:
        _poison(state, authority, "SQLite publication-session clock observation failed")
        raise


def _capture_atomic_publication_session_tail(
    burn_publication_commit: Callable[[Any], None] = (_OWNERSHIP_BURN_PUBLICATION_SESSION_COMMIT),
    consume_clock: Callable[
        [_ProviderClockCapability, _ClockEvidence, ClockConsumer],
        _ConsumedClockTombstone,
    ] = _CONSUME_CLOCK,
    publish_publication_commit: Callable[[Any], None] = (
        _OWNERSHIP_PUBLISH_PUBLICATION_SESSION_COMMIT
    ),
    object_setattr: Callable[[object, str, object], None] = _OBJECT_SETATTR,
    authority_session_slot: str = _AUTHORITY_SESSION_SLOT,
    authority_session_state_slot: str = _AUTHORITY_SESSION_STATE_SLOT,
    poison: Callable[
        [_AuthorityState, _SQLiteCursorOuterPublicationAuthority, str], None
    ] = _poison,
) -> Callable[..., _SQLiteCursorPublicationSession]:
    """Capture every fallible atomic-tail operation by exact identity."""

    def atomic_tail(
        prepared_state: _PublicationPreparedState,
        publication_commit: object,
        state: _AuthorityState,
        authority: _SQLiteCursorOuterPublicationAuthority,
        session: _SQLiteCursorPublicationSession,
        session_state: _PublicationSessionState,
        authority_session_ref: ReferenceType[_SQLiteCursorPublicationSession],
        evidence: _ClockEvidence,
    ) -> _SQLiteCursorPublicationSession:
        try:
            # Non-interruptible tail: exact captured intrinsics only. Clock
            # consumption completes its registry work before its evidence burn;
            # both lower commit continuations are pre-resolved assignments.
            prepared_state.lifecycle = "published"
            prepared_state.lower_tail = None
            burn_publication_commit(publication_commit)
            tombstone = consume_clock(
                state.provider_clock_capability,
                evidence,
                "cursor-publication-session",
            )
            session_state.consumed_tombstone = tombstone
            publish_publication_commit(publication_commit)
            state.publication_session = authority_session_ref
            object_setattr(authority, authority_session_slot, session)
            object_setattr(authority, authority_session_state_slot, session_state)
            state.write_phase = "publication-active"
            session_state.lifecycle = "publication-active"
            return session
        except BaseException:
            session_state.lifecycle = "poisoned"
            poison(state, authority, "SQLite publication-session atomic tail failed")
            raise

    return atomic_tail


_ATOMIC_PUBLICATION_SESSION_TAIL = _capture_atomic_publication_session_tail()
del _capture_atomic_publication_session_tail


def _publish_sqlite_cursor_publication_session_implementation(
    prepared: _SQLiteCursorPublicationSessionPreparedOwner,
    evidence: _ClockEvidence,
    cancellation: _SQLiteCursorPublicationSessionCancellationSignal | None,
    atomic_tail: Callable[..., _SQLiteCursorPublicationSession],
) -> _SQLiteCursorPublicationSession:
    """Validate boundary two, poll cancellation once, then publish atomically."""

    prepared_value = _identity_get(
        _PUBLICATION_PREPARED,
        prepared,
        _SQLiteCursorPublicationSessionPreparedOwner,
    )
    if prepared_value is None:
        _fail("GE_CURSOR_B3_PUBLICATION_PREPARED_OWNER")
    prepared_state = cast(_PublicationPreparedState, prepared_value)
    authority = prepared_state.authority_ref()
    adoption_receipt = prepared_state.adoption_receipt_ref()
    if authority is None or adoption_receipt is None:
        _fail("GE_CURSOR_B3_PUBLICATION_PREPARED_OWNER")
    state = _authority_state(authority)
    if prepared_state.lifecycle != "prepared":
        _poison(state, authority, "SQLite publication-session reuse")
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_REUSE")
    if (
        state.publication_prepared_owner is not prepared
        or state.initial_stage_adoption_receipt is not adoption_receipt
        or prepared_state.observed_evidence is not evidence
        or _STABLE_TYPE(evidence) is not _ClockEvidence
        or state.outer_clock_consumed_tombstone is None
    ):
        _poison(state, authority, "SQLite publication-session evidence substitution")
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_EVIDENCE")
    try:
        generation, epoch, changes = _owner_snapshot(state.connection)
        if (
            generation is not state.transaction_generation
            or epoch != state.current_transaction_epoch
            or changes != state.current_total_changes
        ):
            _fail("GE_CURSOR_B3_PUBLICATION_SESSION_LINEAGE")
        _assert_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        clock_graph = _ASSERT_PREPARED_SECOND_CLOCK(
            state.connection,
            state.migration_lock_capability,
            state.provider_clock_capability,
            state.outer_clock_evidence,
            state.outer_clock_consumed_tombstone,
            evidence,
        )
        bundle, fence, reader, _record = _session_adoption_inputs(adoption_receipt)
        _assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic(
            authority, bundle, fence, reader, adoption_receipt
        )
    except BaseException:
        _poison(state, authority, "SQLite publication-session validation failed")
        raise
    cancellation_state: _CancellationState | None = None
    if cancellation is not None:
        cancellation_value = _identity_get(
            _PUBLICATION_CANCELLATIONS,
            cancellation,
            _SQLiteCursorPublicationSessionCancellationSignal,
        )
        if cancellation_value is None:
            _fail("GE_CURSOR_B3_PUBLICATION_CANCELLATION")
        cancellation_state = cast(_CancellationState, cancellation_value)
    if cancellation_state is not None and cancellation_state.cancelled:
        _fail("GE_CURSOR_B3_PUBLICATION_CANCELLED")

    session = _SQLiteCursorPublicationSession(_CONSTRUCTION_TOKEN)
    lock_identity = clock_graph.migration_lock
    session_state = _PublicationSessionState(
        prepared_owner=prepared,
        authority=authority,
        adoption_receipt=adoption_receipt,
        connection=state.connection,
        stage=state.stage,
        receipt=state.receipt,
        projection_reference=state.projection_reference,
        projection_identity=state.projection_identity,
        transfer=state.transfer,
        transaction_generation=state.transaction_generation,
        migration_lock_capability=state.migration_lock_capability,
        migration_lock_identity=lock_identity,
        provider_clock_capability=state.provider_clock_capability,
        outer_clock_evidence=state.outer_clock_evidence,
        outer_provider_now_ms=state.outer_provider_now_ms,
        pre_rebind_clock_evidence=evidence,
        pre_rebind_provider_now_ms=clock_graph.evidence.provider_now_ms,
        post_ddl_catalog_fence=fence,
        source_descriptor_hash=state.source_descriptor_hash,
        source_schema_identity=state.source_schema_identity_sha256,
        target_descriptor_hash=SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.descriptor_hash,
        target_schema_identity=(SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.schema_identity_sha256),
    )
    try:
        _bind_publication_session_state(session, session_state)
        lower_tail = prepared_state.lower_tail
        if lower_tail is None:
            _fail("GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH")
        authority_session_ref = _STABLE_REF(session)
        publication_commit = _OWNERSHIP_PREPARE_PUBLICATION_SESSION_COMMIT(
            lower_tail,
            session,
        )
    except BaseException:
        prepared_state.lifecycle = "poisoned"
        with suppress(BaseException):
            if prepared_state.lower_tail is not None:
                _OWNERSHIP_BURN_PUBLICATION_SESSION(prepared_state.lower_tail)
        _poison(state, authority, "SQLite publication-session registration failed")
        raise

    return atomic_tail(
        prepared_state,
        publication_commit,
        state,
        authority,
        session,
        session_state,
        authority_session_ref,
        evidence,
    )


def _capture_publication_session_publisher(
    implementation: Callable[..., _SQLiteCursorPublicationSession] = (
        _publish_sqlite_cursor_publication_session_implementation
    ),
    atomic_tail: Callable[..., _SQLiteCursorPublicationSession] = (
        _ATOMIC_PUBLICATION_SESSION_TAIL
    ),
) -> Callable[
    [
        _SQLiteCursorPublicationSessionPreparedOwner,
        _ClockEvidence,
        _SQLiteCursorPublicationSessionCancellationSignal | None,
    ],
    _SQLiteCursorPublicationSession,
]:
    """Close the atomic tail over exact callables without an injection seam."""

    def publisher(
        prepared: _SQLiteCursorPublicationSessionPreparedOwner,
        evidence: _ClockEvidence,
        cancellation: _SQLiteCursorPublicationSessionCancellationSignal | None = None,
    ) -> _SQLiteCursorPublicationSession:
        return implementation(
            prepared,
            evidence,
            cancellation,
            atomic_tail,
        )

    return publisher


_publish_sqlite_cursor_publication_session_intrinsic = _capture_publication_session_publisher()
del _capture_publication_session_publisher
del _publish_sqlite_cursor_publication_session_implementation
del _ATOMIC_PUBLICATION_SESSION_TAIL


def _assert_publication_session_adoption_graph_intrinsic(
    state: _AuthorityState,
    authority: _SQLiteCursorOuterPublicationAuthority,
    adoption_receipt: _SQLiteCursorInitialStageAdoptionReceipt,
    catalog: _TargetCatalogSnapshot,
    generation: object,
    epoch: int,
    changes: int,
) -> None:
    """Reprove the adopted write graph from retained identities and one catalog read."""

    bundle, fence, reader_lease, record = _session_adoption_inputs(adoption_receipt)
    checked = _checked_initial_publication_bundle_presentation_intrinsic(
        authority, bundle, fence, reader_lease
    )
    migration_tombstone = record.migration_0002_tombstone_ref()
    entries_tombstone = record.baseline_entries_tombstone_ref()
    header_tombstone = record.baseline_header_tombstone_ref()
    sequence_tombstone = record.operation_sequence_zero_tombstone_ref()
    retired_b2_fence = record.retired_b2_fence_ref()
    fence_record = _post_ddl_catalog_fence_record(fence)
    reader_record = _post_ddl_publication_reader_record(reader_lease)
    current_ledger = _outer_ledger_snapshot(state)
    if (
        record.lifecycle != "active"
        or record.mint_count != 1
        or record.write_kind != "initial-publication-stage-adoption"
        or record.authority_ref() is not authority
        or record.connection_id != _STABLE_ID(state.connection)
        or record.stage_ref() is not state.stage
        or record.receipt_ref() is not state.receipt
        or record.projection_identity_id != _STABLE_ID(state.projection_identity)
        or record.projection_reference_ref() is not state.projection_reference
        or record.transfer_ref() is not state.transfer
        or record.migration_0002_receipt_ref() is not checked.migration_0002_receipt
        or record.baseline_entries_receipt_ref() is not checked.baseline_entries_receipt
        or record.baseline_header_receipt_ref() is not checked.baseline_header_receipt
        or record.operation_sequence_zero_receipt_ref()
        is not checked.operation_sequence_zero_receipt
        or record.fence_ref() is not fence
        or record.reader_lease_ref() is not reader_lease
        or migration_tombstone is None
        or entries_tombstone is None
        or header_tombstone is None
        or sequence_tombstone is None
        or retired_b2_fence is None
        or state.initial_stage_adoption_receipt is not adoption_receipt
        or state.initial_stage_adoption_receipt_mint_count != 1
        or state.receipt_consumption_count != 4
        or state.tombstone_mint_count != 4
        or state.migration_0002_consumed_tombstone is not migration_tombstone
        or state.baseline_entries_consumed_tombstone is not entries_tombstone
        or state.baseline_header_consumed_tombstone is not header_tombstone
        or state.operation_sequence_zero_consumed_tombstone is not sequence_tombstone
        or state.write_phase != "publication-active"
        or state.transaction_generation is not generation
        or state.current_transaction_epoch != epoch
        or state.current_total_changes != changes
        or record.adopted_transaction_epoch != epoch
        or record.adopted_total_changes != changes
        or not _exact_outer_ledger(current_ledger, record.adopted_outer_ledger)
        or record.target_catalog_sha256 != SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        or fence_record.authority_ref() is not authority
        or fence_record.migration_0002_receipt_ref() is not checked.migration_0002_receipt
        or fence_record.transaction_generation is not generation
        or fence_record.catalog_sha256 != record.target_catalog_sha256
        or not _exact_post_ddl_catalog(catalog, checked.migration_0002_record.post_ddl_catalog)
        or catalog.application_id != fence_record.catalog_application_id
        or catalog.user_version != fence_record.catalog_user_version
        or catalog.row_count != fence_record.catalog_row_count
        or catalog.canonical_utf8_bytes != fence_record.catalog_canonical_utf8_bytes
        or catalog.catalog_sha256 != fence_record.catalog_sha256
        or catalog.inventory != fence_record.catalog_inventory
        or reader_record.lifecycle != "retired"
        or reader_record.authority_ref() is not authority
        or reader_record.migration_0002_receipt_ref() is not checked.migration_0002_receipt
        or reader_record.fence_ref() is not fence
        or reader_record.stage_ref() is not state.stage
        or reader_record.transfer_ref() is not state.transfer
        or reader_record.projection_reference_ref() is not state.projection_reference
        or reader_record.transaction_generation is not generation
        or reader_record.prepare_count != 1
        or reader_record.execute_count != 1
        or reader_record.ownership_acquisition_count != 1
        or reader_record.close_attempt_count != 1
        or not reader_record.close_succeeded
        or reader_record.close_error_code is not None
        or reader_record.rederived_projection is None
        or reader_record.retained_entries is None
        or len(reader_record.retained_entries) != reader_record.expected_entry_count
        or not _same_projection_identity(
            reader_record.rederived_projection, _expected_reader_projection(reader_record)
        )
    ):
        _fail("GE_CURSOR_B3_PUBLICATION_SESSION_ADOPTION")
    _assert_consumption_intrinsic(
        _MIGRATION_0002_RECEIPT_CONSUMPTIONS,
        checked.migration_0002_receipt,
        migration_tombstone,
        adoption_receipt,
    )
    _assert_consumption_intrinsic(
        _BASELINE_ENTRIES_PUBLICATION_RECEIPT_CONSUMPTIONS,
        checked.baseline_entries_receipt,
        entries_tombstone,
        adoption_receipt,
    )
    _assert_consumption_intrinsic(
        _BASELINE_HEADER_PUBLICATION_RECEIPT_CONSUMPTIONS,
        checked.baseline_header_receipt,
        header_tombstone,
        adoption_receipt,
    )
    _assert_consumption_intrinsic(
        _OPERATION_SEQUENCE_ZERO_PUBLICATION_RECEIPT_CONSUMPTIONS,
        checked.operation_sequence_zero_receipt,
        sequence_tombstone,
        adoption_receipt,
    )
    _OWNERSHIP_ASSERT_POST_DDL_READER_TERMINAL(
        state.transfer,
        authority,
        reader_lease,
    )


def _assert_sqlite_cursor_publication_session_intrinsic(
    session: _SQLiteCursorPublicationSession,
) -> _SQLiteCursorPublicationSession:
    """Repeatably reprove the active three-layer session without consuming it."""

    session_state = _publication_session_state(session)
    authority = session_state.authority
    prepared = session_state.prepared_owner
    adoption_receipt = session_state.adoption_receipt
    state = _authority_state(authority)
    try:
        if (
            session_state.lifecycle != "publication-active"
            or state.lifecycle != "active"
            or state.write_phase != "publication-active"
            or state.publication_prepared_owner is not prepared
            or state.publication_session is None
            or state.publication_session() is not session
            or _anchored_publication_session(authority) is not session
            or state.initial_stage_adoption_receipt is not adoption_receipt
            or session_state.connection is not state.connection
            or session_state.stage is not state.stage
            or session_state.receipt is not state.receipt
            or session_state.projection_reference is not state.projection_reference
            or session_state.projection_identity is not state.projection_identity
            or session_state.transfer is not state.transfer
            or session_state.transaction_generation is not state.transaction_generation
            or session_state.migration_lock_capability is not state.migration_lock_capability
            or session_state.provider_clock_capability is not state.provider_clock_capability
            or session_state.outer_clock_evidence is not state.outer_clock_evidence
            or session_state.outer_provider_now_ms != state.outer_provider_now_ms
            or session_state.post_ddl_catalog_fence is not state.post_ddl_catalog_fence
            or session_state.source_descriptor_hash != state.source_descriptor_hash
            or session_state.source_schema_identity != state.source_schema_identity_sha256
            or session_state.target_descriptor_hash
            != SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.descriptor_hash
            or session_state.target_schema_identity
            != SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.schema_identity_sha256
            or session_state.consumed_tombstone is None
        ):
            _fail("GE_CURSOR_B3_PUBLICATION_SESSION_GRAPH")
        generation_before, epoch_before, changes_before = _owner_snapshot(state.connection)
        live_lock = _LIVE_LOCK(state.connection)
        catalog = _READ_VALIDATED_TARGET_CATALOG(state.connection)
        generation_after, epoch_after, changes_after = _owner_snapshot(state.connection)
        if (
            generation_before is not generation_after
            or generation_after is not state.transaction_generation
            or epoch_before != epoch_after
            or epoch_after != state.current_transaction_epoch
            or changes_before != changes_after
            or changes_after != state.current_total_changes
        ):
            _fail("GE_CURSOR_B3_PUBLICATION_SESSION_LINEAGE")
        clock_graph = _ASSERT_ACTIVE_SECOND_CLOCK(
            state.connection,
            state.migration_lock_capability,
            state.provider_clock_capability,
            state.outer_clock_evidence,
            cast(_ConsumedClockTombstone, state.outer_clock_consumed_tombstone),
            session_state.pre_rebind_clock_evidence,
            session_state.consumed_tombstone,
            observed_live_lock=live_lock,
            observed_transaction_epoch=epoch_after,
            observed_total_changes=changes_after,
        )
        if (
            clock_graph.migration_lock != session_state.migration_lock_identity
            or clock_graph.evidence.provider_now_ms != session_state.pre_rebind_provider_now_ms
            or clock_graph.predecessor_evidence is not state.outer_clock_evidence
        ):
            _fail("GE_CURSOR_B3_PUBLICATION_SESSION_EVIDENCE")
        _assert_publication_session_adoption_graph_intrinsic(
            state,
            authority,
            adoption_receipt,
            catalog,
            generation_after,
            epoch_after,
            changes_after,
        )
        _OWNERSHIP_ASSERT_PUBLICATION_SESSION(
            state.connection,
            state.stage,
            state.receipt,
            state.projection_identity,
            state.transfer,
            authority,
            prepared,
            session,
        )
        return session
    except BaseException:
        session_state.lifecycle = "poisoned"
        _poison(state, authority, "SQLite publication-session assertion failed")
        raise


class _SQLiteCursorPublicationSessionSnapshot(NamedTuple):
    lifecycle: Literal["publication-active"]
    session: _SQLiteCursorPublicationSession
    prepared_owner: _SQLiteCursorPublicationSessionPreparedOwner
    authority: _SQLiteCursorOuterPublicationAuthority
    adoption_receipt: _SQLiteCursorInitialStageAdoptionReceipt
    receipt: SQLiteCursorPreRebindReceipt
    projection_reference: SQLiteCursorExactProjectionReference
    projection_identity: BaselineProjectionIdentity
    stage: SQLiteV1BaselineTempStage
    connection: SQLiteV1BaselineConnectionOwner
    transfer: _SQLiteCursorStageOwnershipTransfer
    transaction_generation: object
    migration_lock_identity: object
    migration_lock_capability: _MigrationLockCapability
    provider_clock_capability: _ProviderClockCapability
    outer_clock_evidence: _ClockEvidence
    outer_provider_now_ms: int
    pre_rebind_clock_evidence: _ClockEvidence
    pre_rebind_provider_now_ms: int
    consumed_tombstone: _ConsumedClockTombstone
    post_ddl_catalog_fence: _SQLiteCursorPostDdlCatalogFence
    source_descriptor_hash: str
    source_schema_identity: str
    target_descriptor_hash: str
    target_schema_identity: str


def _read_sqlite_cursor_publication_session_snapshot_intrinsic(
    session: _SQLiteCursorPublicationSession,
) -> _SQLiteCursorPublicationSessionSnapshot:
    _assert_sqlite_cursor_publication_session_intrinsic(session)
    session_state = _publication_session_state(session)
    authority = session_state.authority
    prepared = session_state.prepared_owner
    adoption_receipt = session_state.adoption_receipt
    tombstone = session_state.consumed_tombstone
    assert tombstone is not None
    return _SQLiteCursorPublicationSessionSnapshot(
        "publication-active",
        session,
        prepared,
        authority,
        adoption_receipt,
        session_state.receipt,
        session_state.projection_reference,
        session_state.projection_identity,
        session_state.stage,
        session_state.connection,
        session_state.transfer,
        session_state.transaction_generation,
        session_state.migration_lock_identity,
        session_state.migration_lock_capability,
        session_state.provider_clock_capability,
        session_state.outer_clock_evidence,
        session_state.outer_provider_now_ms,
        session_state.pre_rebind_clock_evidence,
        session_state.pre_rebind_provider_now_ms,
        tombstone,
        session_state.post_ddl_catalog_fence,
        session_state.source_descriptor_hash,
        session_state.source_schema_identity,
        session_state.target_descriptor_hash,
        session_state.target_schema_identity,
    )


def _read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic(
    receipt: _SQLiteCursorInitialStageAdoptionReceipt,
) -> _SQLiteCursorInitialStageAdoptionReceiptSnapshot:
    record = _initial_stage_adoption_receipt_record(receipt)
    authority = record.authority_ref()
    migration = record.migration_0002_receipt_ref()
    entries = record.baseline_entries_receipt_ref()
    header = record.baseline_header_receipt_ref()
    sequence = record.operation_sequence_zero_receipt_ref()
    fence = record.fence_ref()
    reader_lease = record.reader_lease_ref()
    if (
        authority is None
        or migration is None
        or entries is None
        or header is None
        or sequence is None
        or fence is None
        or reader_lease is None
    ):
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT")
    bundle = (migration, entries, header, sequence)
    _assert_sqlite_cursor_initial_stage_adoption_receipt_intrinsic(
        authority, bundle, fence, reader_lease, receipt
    )
    state = _authority_state(authority)
    migration_tombstone = record.migration_0002_tombstone_ref()
    entries_tombstone = record.baseline_entries_tombstone_ref()
    header_tombstone = record.baseline_header_tombstone_ref()
    sequence_tombstone = record.operation_sequence_zero_tombstone_ref()
    retired_b2_fence = record.retired_b2_fence_ref()
    reader = _post_ddl_publication_reader_record(reader_lease)
    if (
        migration_tombstone is None
        or entries_tombstone is None
        or header_tombstone is None
        or sequence_tombstone is None
        or retired_b2_fence is None
        or reader.rederived_projection is None
    ):
        _fail("GE_CURSOR_B3_INITIAL_ADOPTION_RECEIPT_DRIFT")
    return _SQLiteCursorInitialStageAdoptionReceiptSnapshot(
        authority,
        state.connection,
        state.stage,
        state.receipt,
        state.projection_identity,
        state.projection_reference,
        state.transfer,
        state.transaction_generation,
        migration,
        entries,
        header,
        sequence,
        migration_tombstone,
        entries_tombstone,
        header_tombstone,
        sequence_tombstone,
        fence,
        reader_lease,
        "retired",
        1,
        reader.rederived_projection.projection_sha256,
        record.adopted_transaction_epoch,
        record.adopted_total_changes,
        record.adopted_outer_ledger,
        record.target_catalog_sha256,
        retired_b2_fence,
        1,
        "initial-publication-stage-adoption",
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
        source_migration_lineage_id=state.source_migration_lineage_id,
        source_migration_lineage_sha256=state.source_migration_lineage_sha256,
        source_schema_identity_sha256=state.source_schema_identity_sha256,
        captured_at_ms=state.captured_at_ms,
        outer_provider_now_ms=state.outer_provider_now_ms,
        source_schema_version=1,
        target_schema_version=2,
        activation_count=state.activation_count,
        migration_0002_logical_execution_count=state.migration_0002_logical_execution_count,
        migration_0002_prepared_statement_count=state.migration_0002_prepared_statement_count,
        migration_0002_receipt=state.migration_0002_receipt,
        post_ddl_catalog_fence=state.post_ddl_catalog_fence,
        post_ddl_catalog_fence_mint_count=state.post_ddl_catalog_fence_mint_count,
        post_ddl_publication_reader_lease=state.post_ddl_publication_reader_lease,
        post_ddl_publication_reader_lease_mint_count=(
            state.post_ddl_publication_reader_lease_mint_count
        ),
        post_ddl_publication_reader_lease_close_count=(
            state.post_ddl_publication_reader_lease_close_count
        ),
        baseline_entries_publication_receipt=state.baseline_entries_publication_receipt,
        baseline_entries_publication_receipt_mint_count=(
            state.baseline_entries_publication_receipt_mint_count
        ),
        baseline_entries_logical_execution_count=(state.baseline_entries_logical_execution_count),
        baseline_entries_prepare_count=state.baseline_entries_prepare_count,
        baseline_entries_execute_count=state.baseline_entries_execute_count,
        baseline_entries_affected_rows=state.baseline_entries_affected_rows,
        baseline_header_publication_receipt=state.baseline_header_publication_receipt,
        baseline_header_publication_receipt_mint_count=(
            state.baseline_header_publication_receipt_mint_count
        ),
        baseline_header_logical_execution_count=(state.baseline_header_logical_execution_count),
        baseline_header_prepare_count=state.baseline_header_prepare_count,
        baseline_header_execute_count=state.baseline_header_execute_count,
        baseline_header_affected_rows=state.baseline_header_affected_rows,
        operation_sequence_zero_publication_receipt=(
            state.operation_sequence_zero_publication_receipt
        ),
        operation_sequence_zero_publication_receipt_mint_count=(
            state.operation_sequence_zero_publication_receipt_mint_count
        ),
        operation_sequence_zero_logical_execution_count=(
            state.operation_sequence_zero_logical_execution_count
        ),
        operation_sequence_zero_prepare_count=(state.operation_sequence_zero_prepare_count),
        operation_sequence_zero_execute_count=(state.operation_sequence_zero_execute_count),
        operation_sequence_zero_affected_rows=(state.operation_sequence_zero_affected_rows),
        initial_stage_adoption_receipt=state.initial_stage_adoption_receipt,
        initial_stage_adoption_receipt_mint_count=(state.initial_stage_adoption_receipt_mint_count),
        receipt_consumption_count=state.receipt_consumption_count,
        tombstone_mint_count=state.tombstone_mint_count,
        migration_0002_consumed_tombstone=state.migration_0002_consumed_tombstone,
        baseline_entries_consumed_tombstone=state.baseline_entries_consumed_tombstone,
        baseline_header_consumed_tombstone=state.baseline_header_consumed_tombstone,
        operation_sequence_zero_consumed_tombstone=(
            state.operation_sequence_zero_consumed_tombstone
        ),
        write_phase=state.write_phase,
    )
