"""Package-private owner of the SQLite cursor initial-publication write lane.

The owner binds and activates the exact completed B2 stage graph, then permits
the ordered migration-0002, post-DDL proof/read and baseline-entry publication
leaves.  It never begins, commits, rolls back or rebinds the caller-owned
transaction.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from base64 import urlsafe_b64encode
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
    _assert_sqlite_cursor_stage_ownership_outer_publication_owned_intrinsic,
    _assert_sqlite_cursor_stage_ownership_outer_publication_prepared_intrinsic,
    _assert_sqlite_cursor_stage_ownership_post_ddl_reader_terminal_intrinsic,
    _assert_sqlite_cursor_stage_ownership_pre_rebind_complete_intrinsic,
    _complete_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic,
    _mint_sqlite_cursor_stage_ownership_outer_publication_authority_intrinsic,
    _poison_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _publish_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _register_sqlite_cursor_stage_ownership_post_ddl_reader_intrinsic,
    _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
    _SQLiteCursorStageOwnershipOuterPublicationAuthority,
    _SQLiteCursorStageOwnershipOuterPublicationTail,
    _SQLiteCursorStageOwnershipTransfer,
)
from .sqlite_operation_baseline_source import (
    SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC,
    SQLiteV1BaselineConnectionOwner,
    _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic,
    _begin_sqlite_connection_baseline_header_publication_execution_intrinsic,
    _begin_sqlite_connection_migration_0002_execution_intrinsic,
    _close_owned_sqlite_connection_post_ddl_publication_reader_intrinsic,
    _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic,
    _execute_next_sqlite_connection_migration_0002_statement_intrinsic,
    _execute_sqlite_connection_baseline_header_publication_intrinsic,
    _execute_sqlite_connection_post_ddl_publication_reader_intrinsic,
    _fetch_next_owned_sqlite_connection_post_ddl_publication_reader_intrinsic,
    _prepare_sqlite_connection_post_ddl_publication_reader_intrinsic,
    _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic,
    _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic,
    _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic,
    _read_sqlite_connection_post_ddl_publication_reader_snapshot_intrinsic,
    _SQLiteConnectionBaselineEntryPublicationExecution,
    _SQLiteConnectionBaselineHeaderPublicationExecution,
    _SQLiteConnectionMigration0002Execution,
)
from .sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage

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
_POST_DDL_PUBLICATION_READER_LEASES: dict[int, _IdentityEntry] = {}
_BASELINE_ENTRIES_PUBLICATION_RECEIPTS: dict[int, _IdentityEntry] = {}
_BASELINE_HEADER_PUBLICATION_RECEIPTS: dict[int, _IdentityEntry] = {}

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
    source_envelope = provenance.source_summary.source_envelope
    source_descriptor_hash = source_envelope.get("sourceDescriptorHash")
    source_migration_lineage_id = source_envelope.get("sourceMigrationLineageId")
    source_migration_lineage_sha256 = source_envelope.get("sourceMigrationLineageSha256")
    source_schema_identity_sha256 = source_envelope.get("sourceSchemaIdentitySha256")
    captured_at_ms = source_envelope.get("capturedAtMs")
    if (
        type(source_descriptor_hash) is not str
        or len(source_descriptor_hash) != 64
        or source_descriptor_hash != seal.source_descriptor_hash
        or type(source_migration_lineage_id) is not str
        or not source_migration_lineage_id
        or type(source_migration_lineage_sha256) is not str
        or len(source_migration_lineage_sha256) != 64
        or type(source_schema_identity_sha256) is not str
        or len(source_schema_identity_sha256) != 64
        or source_schema_identity_sha256 != seal.source_schema_identity_sha256
        or type(captured_at_ms) is not int
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


def _same_projection_identity(
    left: BaselineProjectionIdentity,
    right: BaselineProjectionIdentity,
) -> bool:
    return (
        type(left) is BaselineProjectionIdentity
        and type(right) is BaselineProjectionIdentity
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
        or _ID(authority) != record.authority_id
        or _ID(receipt) != record.migration_0002_receipt_id
        or _ID(fence) != record.fence_id
        or _ID(stage) != record.stage_id
        or _ID(transfer) != record.transfer_id
        or _ID(projection_reference) != record.projection_reference_id
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
                authority_id=_ID(authority),
                authority_ref=_REF(authority),
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
                fence_id=_ID(fence),
                fence_ref=_REF(fence),
                fetch_count=0,
                lifecycle="minted-unused",
                migration_0002_receipt_id=_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_REF(migration_0002_receipt),
                outer_ledger_read_watermark=ledger,
                ownership_acquisition_count=0,
                prepare_count=0,
                projection_reference_id=_ID(state.projection_reference),
                projection_reference_ref=_REF(state.projection_reference),
                rederived_projection=None,
                retained_entries=None,
                stage_id=_ID(state.stage),
                stage_ref=_REF(state.stage),
                total_changes_read_watermark=state.current_total_changes,
                transaction_epoch=state.current_transaction_epoch,
                transaction_generation=state.transaction_generation,
                transfer_id=_ID(state.transfer),
                transfer_ref=_REF(state.transfer),
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
    authority_reference = _REF(authority)
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
            live_state = _identity_get(
                _AUTHORITIES,
                live_authority,
                _SQLiteCursorStageOwnershipOuterPublicationAuthority,
            )
            if live_state is not None:
                cast(
                    _AuthorityState,
                    live_state,
                ).post_ddl_publication_reader_lease_close_count = 1
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
            if type(row) is not tuple or len(row) != 4:
                _fail("GE_CURSOR_B3_POST_DDL_READER_ROW")
            rank, entry_kind, key_blob, state_blob = row
            if (
                type(rank) is not int
                or not 0 <= rank < len(BASELINE_ENTRY_KINDS)
                or type(entry_kind) is not str
                or BASELINE_ENTRY_KINDS[rank] != entry_kind
                or type(key_blob) is not bytes
                or type(state_blob) is not bytes
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
    if type(entries) is not tuple or len(entries) != projection.entry_count:
        _fail("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN")
    frame: list[list[dict[str, str]]] = []
    previous = BASELINE_GENESIS_HASH
    try:
        accumulator = _ACCUMULATOR_CONSTRUCT(projection.baseline_id, projection.entry_count)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_ENTRIES_CHAIN") from error
    for ordinal, entry in enumerate(entries):
        if (
            type(entry) is not BaselineEntry
            or entry.baseline_id != projection.baseline_id
            or entry.ordinal != ordinal
            or entry.previous_entry_hash != previous
            or type(entry.entry_kind) is not str
            or entry.entry_kind not in BASELINE_ENTRY_KINDS
            or type(entry.key_bytes) is not bytes
            or type(entry.state_bytes) is not bytes
            or not 2 <= len(entry.key_bytes) <= MAX_BASELINE_KEY_BYTES
            or not 2 <= len(entry.state_bytes) <= MAX_BASELINE_STATE_BYTES
            or type(entry.entry_hash) is not str
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

    if type(entries) is not tuple or len(entries) != projection.entry_count:
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
            type(retained) is not BaselineEntry
            or retained.baseline_id != projection.baseline_id
            or retained.ordinal != expected_ordinal
            or retained.previous_entry_hash != expected_previous_hash
            or type(retained.entry_kind) is not str
            or retained.entry_kind not in BASELINE_ENTRY_KINDS
            or type(retained.key_bytes) is not bytes
            or type(retained.state_bytes) is not bytes
            or not 2 <= len(retained.key_bytes) <= MAX_BASELINE_KEY_BYTES
            or not 2 <= len(retained.state_bytes) <= MAX_BASELINE_STATE_BYTES
            or type(retained.entry_hash) is not str
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
                authority_id=_ID(authority),
                authority_ref=_REF(authority),
                baseline_id=state.projection_identity.baseline_id,
                connection_id=_ID(state.connection),
                entry_count=expected,
                execute_count=expected,
                final_entry_hash=state.projection_identity.final_entry_hash,
                first_entry_hash=state.projection_identity.first_entry_hash,
                fixed_insert_sql=_BASELINE_ENTRIES_INSERT_SQL,
                fixed_insert_sql_sha256=_BASELINE_ENTRIES_INSERT_SQL_SHA256,
                fence_id=_ID(fence),
                fence_ref=_REF(fence),
                migration_0002_receipt_id=_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_REF(migration_0002_receipt),
                outer_ledger_after=ledger_after,
                outer_ledger_before=ledger_before,
                outer_ledger_delta=_SQLiteCursorOuterPublicationLedgerSnapshot(
                    expected, expected, 1
                ),
                parameter_sha256=parameter_sha256,
                prepare_count=1,
                projection_identity_id=_ID(state.projection_identity),
                projection_reference_id=_ID(state.projection_reference),
                projection_reference_ref=_REF(state.projection_reference),
                reader_lease_id=_ID(reader_lease),
                reader_lease_ref=_REF(reader_lease),
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
        record.authority_id != _ID(authority)
        or record.authority_ref() is not authority
        or record.migration_0002_receipt_id != _ID(migration_0002_receipt)
        or record.migration_0002_receipt_ref() is not migration_0002_receipt
        or record.fence_id != _ID(fence)
        or record.fence_ref() is not fence
        or record.reader_lease_id != _ID(reader_lease)
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
        or _ID(projection_reference) != record.projection_reference_id
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
        or _ID(state.connection) != record.connection_id
        or _ID(projection) != record.projection_identity_id
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
        type(source) is not _SourceHeaderCommitment
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
        or record.authority_id != _ID(authority)
        or record.authority_ref() is not authority
        or record.connection_id != _ID(state.connection)
        or record.migration_0002_receipt_id != _ID(migration_0002_receipt)
        or record.migration_0002_receipt_ref() is not migration_0002_receipt
        or record.fence_id != _ID(fence)
        or record.fence_ref() is not fence
        or record.reader_lease_id != _ID(reader_lease)
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
        or record.projection_reference_id != _ID(state.projection_reference)
        or record.projection_identity_id != _ID(projection)
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
            or entries_record.projection_identity_id != _ID(state.projection_identity)
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
                authority_id=_ID(authority),
                authority_ref=_REF(authority),
                baseline_entries_receipt_id=_ID(baseline_entries_publication_receipt),
                baseline_entries_receipt_ref=_REF(baseline_entries_publication_receipt),
                baseline_id=state.projection_identity.baseline_id,
                canonical_projection_sha256=state.projection_identity.projection_sha256,
                captured_at_ms=source_commitment.captured_at_ms,
                connection_id=_ID(state.connection),
                creation_runtime=_BASELINE_HEADER_CREATION_RUNTIME,
                creation_runtime_version=_BASELINE_HEADER_CREATION_RUNTIME_VERSION,
                entry_count=state.projection_identity.entry_count,
                execute_count=1,
                final_entry_hash=state.projection_identity.final_entry_hash,
                first_entry_hash=state.projection_identity.first_entry_hash,
                fixed_insert_sql=_BASELINE_HEADER_INSERT_SQL,
                fixed_insert_sql_sha256=_BASELINE_HEADER_INSERT_SQL_SHA256,
                legacy_operation_count=state.projection_identity.legacy_operation_count,
                fence_id=_ID(fence),
                fence_ref=_REF(fence),
                migration_0002_receipt_id=_ID(migration_0002_receipt),
                migration_0002_receipt_ref=_REF(migration_0002_receipt),
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
                projection_identity_id=_ID(state.projection_identity),
                projection_reference_id=_ID(state.projection_reference),
                projection_reference_ref=_REF(state.projection_reference),
                reader_lease_id=_ID(reader_lease),
                reader_lease_ref=_REF(reader_lease),
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
        record.authority_id != _ID(authority)
        or record.authority_ref() is not authority
        or record.baseline_entries_receipt_id != _ID(baseline_entries_publication_receipt)
        or record.baseline_entries_receipt_ref() is not baseline_entries_publication_receipt
        or record.migration_0002_receipt_id != _ID(migration_0002_receipt)
        or record.migration_0002_receipt_ref() is not migration_0002_receipt
        or record.fence_id != _ID(fence)
        or record.fence_ref() is not fence
        or record.reader_lease_id != _ID(reader_lease)
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
        or _ID(projection_reference) != record.projection_reference_id
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
        or record.connection_id != _ID(state.connection)
        or record.projection_identity_id != _ID(projection)
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
        write_phase=state.write_phase,
    )
