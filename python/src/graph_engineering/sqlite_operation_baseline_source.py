"""Bounded source identity/count capture for a caller-owned SQLite v1 transaction."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from collections.abc import Callable, Generator, Iterator, Mapping
from contextlib import suppress
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from os.path import abspath
from types import MappingProxyType
from typing import Any, Literal, NamedTuple, Never, cast
from weakref import ReferenceType, ref

from .canonical import canonical_bytes, canonical_sha256
from .cycle_store_provider import CycleStoreProviderOperation, cycle_store_adapter_codec
from .models import MAX_SAFE_INTEGER, JsonObject, JsonValue
from .portable_json import portable_json_snapshot
from .sqlite_cursor_publication_migration_0002_asset import (
    SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES,
    SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT,
    SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256,
    SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256,
    _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic,
    _SQLiteCursorMigration0002Asset,
)
from .sqlite_cursor_publication_native_projection_bridge import (
    _install_sqlite_cursor_publication_native_projection_abandoner_intrinsic,
    _install_sqlite_cursor_publication_native_projection_producer_intrinsic,
    _install_sqlite_cursor_publication_native_projection_receipt_views_intrinsic,
    _invoke_sqlite_cursor_publication_native_projection_reproof_intrinsic,
)
from .sqlite_cycle_store import (
    _REQUIRED_MIGRATION_POSTCONDITIONS,
    SQLITE_CYCLE_STORE_CATALOG_SHA256,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
    SQLiteCycleStoreProvider,
    _load_migration_assets,
    _migration_postconditions_blob,
)
from .sqlite_operation_baseline import (
    BASELINE_ENTRY_KINDS,
    BaselineEntryInput,
    BaselineEntryKind,
    capture_baseline_entry,
    validate_baseline_source_envelope,
)
from .sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_SEAL_EMPTY_ROOT,
    SQLiteCursorSealAccumulator,
    SQLiteCursorSealRow,
    decode_sqlite_v1_cursor_seal_row,
)


@dataclass(slots=True)
class _IdentityIterationState:
    started: bool = False
    poisoned: bool = False
    completed: bool = False


_COOPERATIVE_CONSTRUCTION_TOKEN = object()
_TYPE = type
_ABSOLUTE_PATH = abspath


class _CooperativeSourceItem:
    """Opaque, one-at-a-time source handoff for the internal stage protocol."""

    __slots__ = (
        "_before_total_changes",
        "_connection",
        "_entry",
        "_item_nonce",
        "_sequence",
        "_source_session",
        "_stage_session",
        "_transaction_epoch",
    )

    def __init__(
        self,
        entry: BaselineEntryInput,
        connection: SQLiteV1BaselineConnectionOwner,
        transaction_epoch: int,
        source_session: object,
        stage_session: object,
        sequence: int,
        before_total_changes: int,
        item_nonce: object,
        construction_token: object,
    ) -> None:
        if construction_token is not _COOPERATIVE_CONSTRUCTION_TOKEN:
            raise TypeError("cooperative source items are module-private")
        self._entry = entry
        self._connection = connection
        self._transaction_epoch = transaction_epoch
        self._source_session = source_session
        self._stage_session = stage_session
        self._sequence = sequence
        self._before_total_changes = before_total_changes
        self._item_nonce = item_nonce


class _CooperativeWriteReceipt:
    """Opaque exact-+2 receipt; consumption mutates only this current receipt."""

    __slots__ = (
        "_after_total_changes",
        "_before_total_changes",
        "_connection",
        "_consumed",
        "_entry",
        "_item",
        "_item_nonce",
        "_sequence",
        "_source_session",
        "_stage_session",
        "_transaction_epoch",
    )

    def __init__(
        self,
        item: _CooperativeSourceItem,
        stage_session: object,
        after_total_changes: int,
        construction_token: object,
    ) -> None:
        if construction_token is not _COOPERATIVE_CONSTRUCTION_TOKEN:
            raise TypeError("cooperative write receipts are module-private")
        self._item = item
        self._entry = item._entry
        self._connection = item._connection
        self._transaction_epoch = item._transaction_epoch
        self._source_session = item._source_session
        self._stage_session = stage_session
        self._sequence = item._sequence
        self._before_total_changes = item._before_total_changes
        self._after_total_changes = after_total_changes
        self._item_nonce = item._item_nonce
        self._consumed = False


def _issue_cooperative_write_receipt(
    item: _CooperativeSourceItem,
    stage_session: object,
    after_total_changes: int,
) -> _CooperativeWriteReceipt:
    """Issue a receipt only from the private source/stage cooperation lane."""

    if type(item) is not _CooperativeSourceItem or type(after_total_changes) is not int:
        raise TypeError("cooperative write receipt inputs are invalid")
    if stage_session is not item._stage_session:
        raise ValueError("cooperative write receipt stage binding is invalid")
    return _CooperativeWriteReceipt(
        item,
        stage_session,
        after_total_changes,
        _COOPERATIVE_CONSTRUCTION_TOKEN,
    )


_TRANSACTION_TOKENS = frozenset({"BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"})
_EPOCH_MUTATING_TOKENS = _TRANSACTION_TOKENS | frozenset(
    {
        "ALTER",
        "ANALYZE",
        "ATTACH",
        "CREATE",
        "DETACH",
        "DROP",
        "PRAGMA",
        "REINDEX",
        "VACUUM",
    }
)
SQLiteTransactionMode = Literal["deferred", "immediate", "exclusive", "unknown"]


def _forbidden_temp_store_directory(sql: str) -> bool:
    lowered = sql.lower()
    # Conservative by design: this internal owner never needs the deprecated
    # global directory PRAGMA, including in quoted/commented/script spellings.
    return "pragma" in lowered and "temp_store_directory" in lowered


def _temp_mutation_epoch_advancing_sql(sql: str) -> bool:
    """Conservatively advance for every native statement that may mutate state.

    The TEMP epoch is deliberately broader than textual ``TEMP`` writes: raw
    internal statements and trigger bodies share the same trace callback, and
    every statement except the read/begin floor advances the proof epoch.
    """

    token = _first_sqlite_token(sql)
    if token == "PRAGMA":
        normalized = " ".join(sql.strip().upper().split())
        if "=" in normalized:
            return True
        read_only_pragmas = (
            "PRAGMA APPLICATION_ID",
            "PRAGMA DATABASE_LIST",
            "PRAGMA FOREIGN_KEY_CHECK",
            "PRAGMA INTEGRITY_CHECK",
            "PRAGMA QUICK_CHECK",
            "PRAGMA TABLE_INFO",
            "PRAGMA USER_VERSION",
        )
        return not normalized.startswith(read_only_pragmas)
    return bool(token) and token not in {"BEGIN", "EXPLAIN", "SELECT", "VALUES"}


def _first_sqlite_token(sql: str) -> str:
    tokens = _leading_sqlite_tokens(sql, 1)
    return tokens[0] if tokens else ""


def _abandoned_transaction_owner_guard(_operation: str, _sql: str | None) -> Never:
    raise ValueError("GE_SQLITE_TX_OWNER_ABANDONED")


def _leading_sqlite_tokens(sql: str, limit: int) -> tuple[str, ...]:
    offset = 0
    tokens: list[str] = []
    while offset < len(sql) and len(tokens) < limit:
        while offset < len(sql):
            if sql[offset] == ";" and not tokens:
                offset += 1
                continue
            if sql[offset].isspace():
                offset += 1
                continue
            if sql.startswith("--", offset):
                newline = sql.find("\n", offset + 2)
                if newline < 0:
                    return tuple(tokens)
                offset = newline + 1
                continue
            if sql.startswith("/*", offset):
                close = sql.find("*/", offset + 2)
                if close < 0:
                    return tuple(tokens)
                offset = close + 2
                continue
            break
        token: list[str] = []
        while offset < len(sql) and sql[offset].isascii() and sql[offset].isalpha():
            token.append(sql[offset])
            offset += 1
        if not token:
            break
        tokens.append("".join(token).upper())
    return tuple(tokens)


def _begin_transaction_mode(sql: str) -> SQLiteTransactionMode:
    tokens = _leading_sqlite_tokens(sql, 2)
    if not tokens or tokens[0] != "BEGIN":
        return "unknown"
    if len(tokens) > 1 and tokens[1] in {"DEFERRED", "IMMEDIATE", "EXCLUSIVE"}:
        return cast(SQLiteTransactionMode, tokens[1].lower())
    return "deferred"


class _SQLiteCursorCapability:
    """Minimal cursor surface that never exposes the owned connection."""

    __slots__ = ("__cursor",)

    def __init__(self, cursor: sqlite3.Cursor) -> None:
        self.__cursor = cursor

    def fetchone(self) -> tuple[object, ...] | None:
        row = self.__cursor.fetchone()
        return None if row is None else tuple(cast(tuple[object, ...], row))

    def fetchmany(self, size: int) -> list[tuple[object, ...]]:
        return [tuple(cast(tuple[object, ...], row)) for row in self.__cursor.fetchmany(size)]

    @property
    def rowcount(self) -> int:
        """Expose only SQLite's affected-row count, never the owner handle."""

        return self.__cursor.rowcount

    def close(self) -> None:
        self.__cursor.close()


_MIGRATION_0002_CONSTRUCTION_TOKEN = object()
_MIGRATION_0002_FIXED_STATEMENT_COUNT = 20
_MIGRATION_0002_TEMP_CONFLICT_QUERY = (
    "SELECT count(*) FROM temp.sqlite_schema WHERE lower(name) IN ("
    "'ge_cycle_schema','ge_cycle_schema_v1','ge_cycle_operations',"
    "'ge_cycle_operations_v1','ge_cycle_operations_commit_idx',"
    "'ge_cycle_operations_sequence_uq','ge_cycle_operations_replay_idx',"
    "'ge_cycle_operation_baselines','ge_cycle_operation_baseline_entries',"
    "'ge_cycle_operation_baseline_entries_key_uq',"
    "'ge_cycle_operation_baseline_entries_hash_uq','ge_cycle_operation_sequence')"
)
SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC = (
    "SELECT kind_rank, entry_kind, key_blob, state_blob "
    "FROM temp.ge_blr_stage ORDER BY kind_rank ASC, key_blob ASC"
)
_POST_DDL_READER_SOURCE_SQL = SQLITE_CURSOR_POST_DDL_BASELINE_SOURCE_QUERY_INTRINSIC
SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC = (
    "INSERT INTO main.ge_cycle_operation_baseline_entries "
    "(baseline_id, ordinal, entry_kind, entry_key_blob, entry_state_blob, "
    "previous_entry_hash, entry_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
)
SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC = (
    "b522e3ee2bb4599d74b32c8602242b1b74c3f804dd9129a8eb5a0f529cdca88b"
)
SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_PARAMETER_ORDER_INTRINSIC = (
    "baseline_id",
    "ordinal",
    "entry_kind",
    "entry_key_blob",
    "entry_state_blob",
    "previous_entry_hash",
    "entry_hash",
)
_BASELINE_ENTRY_PUBLICATION_INSERT_SQL = (
    SQLITE_CURSOR_BASELINE_ENTRY_PUBLICATION_INSERT_SQL_INTRINSIC
)
_BASELINE_ENTRY_PUBLICATION_CONSTRUCTION_TOKEN = object()
SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC = (
    "INSERT INTO main.ge_cycle_operation_baselines "
    "(baseline_id, baseline_format_version, source_application_id, "
    "source_user_version, source_schema_identity_sha256, "
    "source_migration_lineage_id, source_migration_lineage_sha256, "
    "source_descriptor_hash, captured_at_ms, legacy_operation_count, entry_count, "
    "first_entry_hash, final_entry_hash, canonical_projection_sha256, "
    "creation_runtime, creation_runtime_version, policy_blob) "
    "VALUES (?, 1, 1195724359, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)
SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_SHA256_INTRINSIC = (
    "b1a32ec385dd78f9727a63b9c303a9cb95c9525910010984d09b7f0fd868e79a"
)
SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_PARAMETER_ORDER_INTRINSIC = (
    "baseline_id",
    "source_schema_identity_sha256",
    "source_migration_lineage_id",
    "source_migration_lineage_sha256",
    "source_descriptor_hash",
    "captured_at_ms",
    "legacy_operation_count",
    "entry_count",
    "first_entry_hash",
    "final_entry_hash",
    "canonical_projection_sha256",
    "creation_runtime",
    "creation_runtime_version",
    "policy_blob",
)
_BASELINE_HEADER_PUBLICATION_INSERT_SQL = (
    SQLITE_CURSOR_BASELINE_HEADER_PUBLICATION_INSERT_SQL_INTRINSIC
)
_BASELINE_HEADER_PUBLICATION_CONSTRUCTION_TOKEN = object()
SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC = (
    "INSERT INTO main.ge_cycle_operation_sequence "
    "(singleton, baseline_id, last_commit_sequence, baseline_captured_at_ms, "
    "updated_at_ms) VALUES (1, ?, 0, ?, ?)"
)
SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC = (
    "a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85"
)
SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_PARAMETER_ORDER_INTRINSIC = (
    "baselineId",
    "baselineCapturedAtMs",
    "updatedAtMs",
)
_OPERATION_SEQUENCE_ZERO_INSERT_SQL = SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC
_OPERATION_SEQUENCE_ZERO_CONSTRUCTION_TOKEN = object()

SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC = (
    "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, "
    "schema_identity_sha256 = ? WHERE descriptor_hash = ? "
    "AND schema_identity_sha256 = ?"
)
SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC = (
    "6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91"
)
SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC = (
    "targetDescriptorHash",
    "targetSchemaIdentitySha256",
    "sourceDescriptorHash",
    "sourceSchemaIdentitySha256",
)
SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC = "SELECT changes() AS affected_rows"
SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC = (
    "a6ab435eb54879f942436129997f231de19504b11028b55b014fddc2bb42e112"
)
_CURSOR_PUBLICATION_REBIND_CONSTRUCTION_TOKEN = object()


class _SQLiteConnectionCursorPublicationRebindExecution:
    """Opaque owner for one fixed cursor rebind and its changes() proof."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CURSOR_PUBLICATION_REBIND_CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION")


class _SQLiteCursorPrivateWriteLedgerSnapshot(NamedTuple):
    affected_rows_watermark: int
    fixed_statement_count: int
    logical_write_sequence: int


class _SQLiteConnectionCursorPublicationRebindSnapshot(NamedTuple):
    lifecycle: Literal["prepared", "executed", "released", "completed", "poisoned"]
    rebind_sql: str
    rebind_sql_sha256: str
    parameter_order: tuple[str, str, str, str]
    changes_sql: str
    changes_sql_sha256: str
    parameters: tuple[str, str, str, str] | None
    prepare_count: Literal[1]
    execute_count: Literal[0, 1]
    release_count: Literal[0, 1]
    changes_prepare_count: Literal[0, 1]
    changes_fetch_count: Literal[0, 1]
    changes_release_count: Literal[0, 1]
    affected_rows: int | None
    changes_affected_rows: int | None
    total_changes_before: int
    total_changes: int
    total_changes_delta: int
    transaction_epoch_before: int
    transaction_epoch: int
    transaction_generation: object
    cursor_ledger_before: _SQLiteCursorPrivateWriteLedgerSnapshot
    cursor_ledger_after: _SQLiteCursorPrivateWriteLedgerSnapshot
    cursor_ledger_delta: _SQLiteCursorPrivateWriteLedgerSnapshot


_CursorPublicationChangesPrimaryBoundary = Literal[
    "serialized-changes-pre-query",
    "serialized-changes-prepare",
    "serialized-changes-execute",
    "serialized-changes-fetch",
    "serialized-changes-release",
    "serialized-changes-post-query",
    "rule11-outer-ledger",
    "rule11-five-count",
]


@dataclass(slots=True)
class _CursorPublicationRebindExecutionState:
    connection: SQLiteV1BaselineConnectionOwner
    cursor: sqlite3.Cursor | None
    rebind_sql: str
    rebind_sql_sha256: str
    parameter_order: tuple[str, str, str, str]
    changes_sql: str
    changes_sql_sha256: str
    transaction_generation: object
    transaction_epoch_before: int
    transaction_epoch: int
    total_changes_before: int
    total_changes: int
    lifecycle: Literal["prepared", "executed", "released", "completed", "poisoned"] = (
        "prepared"
    )
    parameters: tuple[str, str, str, str] | None = None
    prepare_count: Literal[1] = 1
    execute_count: Literal[0, 1] = 0
    release_count: Literal[0, 1] = 0
    changes_prepare_count: Literal[0, 1] = 0
    changes_fetch_count: Literal[0, 1] = 0
    changes_release_count: Literal[0, 1] = 0
    affected_rows: int | None = None
    changes_affected_rows: int | None = None
    cursor_ledger_logical_write_sequence: Literal[0, 1] = 0
    cursor_ledger_fixed_statement_count: Literal[0, 1] = 0
    cursor_ledger_affected_rows_watermark: int = 0
    seal_read_begin_count: Literal[0, 1] = 0


@dataclass(slots=True)
class _CursorPublicationChangesPrimaryCapture:
    nonce: object
    connection: SQLiteV1BaselineConnectionOwner | None
    state: _CursorPublicationRebindExecutionState | None = None
    error: BaseException | None = None
    boundary: _CursorPublicationChangesPrimaryBoundary | None = None
    consumed: bool = False
    invalid: bool = False


@dataclass(frozen=True, slots=True)
class _CursorPublicationChangesPrimaryCapturePhase:
    nonce: object
    capture: _CursorPublicationChangesPrimaryCapture
    phase: Literal["armed", "recorded", "consumed"]


_CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE: ContextVar[
    _CursorPublicationChangesPrimaryCapturePhase | None
] = ContextVar("ge_sqlite_cursor_publication_changes_primary_capture", default=None)


@dataclass(frozen=True, slots=True)
class _CursorPublicationRebindReleaseFaultState:
    connection_id: int
    error_ref: ReferenceType[BaseException]


SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_INTRINSIC = (
    "SELECT tenant_id, token_hash FROM main.ge_cycle_cursors "
    "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY"
)
SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_SHA256_INTRINSIC = (
    "09d1ce669070093fbbf0dfd8ce7e2a7bbfde96d051b3ce9341be85495479ec32"
)
SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_INTRINSIC = (
    "SELECT tenant_id, token_hash FROM temp.ge_blr_cursor_seal "
    "ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY"
)
SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_SHA256_INTRINSIC = (
    "1694ab6fe938203b0d8f6cb72cf82238e89234c21086ff5d224c7de4db7b1266"
)
SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_INTRINSIC = (
    "SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash, "
    "stream_id, checkpoint_scope, request_scope_blob, page_size, next_position, "
    "snapshot_tail_sequence, snapshot_tail_record_hash, descriptor_hash, "
    "schema_identity_sha256, snapshot_blob, created_at_ms, expires_at_ms, "
    "consumed_at_ms FROM main.ge_cycle_cursors WHERE tenant_id = ? "
    "AND token_hash = ? LIMIT 1"
)
SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_SHA256_INTRINSIC = (
    "bd056ee55f2bd27eee3277ed7bfee8ae7b7db935edc3cf0937fc8167e2eac342"
)


class _SQLiteConnectionCursorPublicationSealQueryPlansSnapshot(NamedTuple):
    probe_count: Literal[3]
    identities: tuple[str, str, str]
    sql_sha256: tuple[str, str, str]
    normalized_details: tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]]
    normalized_plan_sha256: tuple[str, str, str]
    sorter_free: Literal[True]
    primary_key_point_lookup: Literal[True]
    transaction_generation: object
    transaction_epoch: int
    total_changes: int


_CURSOR_PUBLICATION_SEAL_READ_CONSTRUCTION_TOKEN = object()


class _SQLiteConnectionCursorPublicationSealReadExecution:
    """Opaque exact-owner for one raw post-rebind seal observation."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _CURSOR_PUBLICATION_SEAL_READ_CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_CURSOR_SEAL_READ_EXECUTION")


class _SQLiteConnectionCursorPublicationSealReadSnapshot(NamedTuple):
    lifecycle: Literal["prepared", "running", "completed", "released", "poisoned"]
    main_key_scan_sql: str
    main_key_scan_sql_sha256: str
    key_driver_sql: str
    key_driver_sql_sha256: str
    point_lookup_sql: str
    point_lookup_sql_sha256: str
    execute_count: Literal[0, 1]
    release_count: Literal[0, 1]
    main_key_prepare_count: Literal[0, 1]
    main_key_row_count: int
    main_key_terminal_fetch_count: Literal[0, 1]
    main_key_close_attempt_count: int
    main_key_close_count: Literal[0, 1]
    driver_prepare_count: Literal[0, 1]
    driver_row_count: int
    driver_terminal_fetch_count: Literal[0, 1]
    driver_close_attempt_count: int
    driver_close_count: Literal[0, 1]
    point_statement_prepare_count: Literal[0, 1]
    point_statement_execute_count: int
    point_statement_release_count: Literal[0, 1]
    point_cursor_created_count: int
    point_cursor_close_attempt_count: int
    point_cursor_closed_count: int
    lookup_row_count: int
    accumulator_row_count: int
    observed_descriptor_hash: str | None
    observed_schema_identity_sha256: str | None
    computed_immutable_root_sha256: str | None
    active_cursor_count: int
    maximum_active_cursor_count: int
    live_physical_row_count: int
    maximum_live_physical_row_count: int
    live_carrier_count: int
    maximum_live_carrier_count: int
    transaction_epoch: int
    transaction_generation: object
    total_changes_before: int
    total_changes: int
    total_changes_delta: int


@dataclass(slots=True)
class _CursorPublicationSealReadExecutionState:
    connection: SQLiteV1BaselineConnectionOwner
    rebind_execution: _SQLiteConnectionCursorPublicationRebindExecution
    main_key_scan_sql: str
    main_key_scan_sql_sha256: str
    key_driver_sql: str
    key_driver_sql_sha256: str
    point_lookup_sql: str
    point_lookup_sql_sha256: str
    transaction_generation: object
    transaction_epoch: int
    total_changes_before: int
    total_changes: int
    lifecycle: Literal["prepared", "running", "completed", "released", "poisoned"] = (
        "prepared"
    )
    execute_count: Literal[0, 1] = 0
    release_count: Literal[0, 1] = 0
    main_key_prepare_count: Literal[0, 1] = 0
    main_key_row_count: int = 0
    main_key_terminal_fetch_count: Literal[0, 1] = 0
    main_key_close_attempt_count: int = 0
    main_key_close_count: Literal[0, 1] = 0
    driver_prepare_count: Literal[0, 1] = 0
    driver_row_count: int = 0
    driver_terminal_fetch_count: Literal[0, 1] = 0
    driver_close_attempt_count: int = 0
    driver_close_count: Literal[0, 1] = 0
    point_statement_prepare_count: Literal[0, 1] = 0
    point_statement_execute_count: int = 0
    point_statement_release_count: Literal[0, 1] = 0
    point_cursor_created_count: int = 0
    point_cursor_close_attempt_count: int = 0
    point_cursor_closed_count: int = 0
    lookup_row_count: int = 0
    accumulator_row_count: int = 0
    observed_descriptor_hash: str | None = None
    observed_schema_identity_sha256: str | None = None
    computed_immutable_root_sha256: str | None = None
    active_cursor_count: int = 0
    maximum_active_cursor_count: int = 0
    live_physical_row_count: int = 0
    maximum_live_physical_row_count: int = 0
    live_carrier_count: int = 0
    maximum_live_carrier_count: int = 0
    main_cursor: sqlite3.Cursor | None = None
    driver_cursor: sqlite3.Cursor | None = None
    point_cursor: sqlite3.Cursor | None = None
    point_statement_owner: _CursorSealReadPointStatementOwner | None = None


class _SQLiteConnectionMigration0002Execution:
    """Opaque exact-owner session for the fixed migration-0002 statement plan."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _MIGRATION_0002_CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_MIGRATION_0002_EXECUTION")


class _SQLiteConnectionMigration0002StepSnapshot(NamedTuple):
    affected_rows_delta: int
    completed_statement_count: int
    fixed_statement_ordinal: int
    prepared_statement_count: int
    total_changes: int
    transaction_epoch: int
    transaction_generation: object


class _SQLiteConnectionMigration0002ExecutionSnapshot(NamedTuple):
    affected_rows: int
    completed_statement_count: int
    lifecycle: Literal["active", "completed", "poisoned"]
    next_statement_ordinal: int
    prepared_statement_count: int
    total_changes: int
    transaction_epoch: int
    transaction_generation: object


class _SQLiteConnectionPostDdlPublicationReader:
    """Opaque source-owner handle for one fixed ordered TEMP read."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _MIGRATION_0002_CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_POST_DDL_READER_SOURCE")


class _SQLiteConnectionPostDdlPublicationReaderSnapshot(NamedTuple):
    close_attempt_count: Literal[0, 1]
    close_succeeded: bool
    execute_count: Literal[0, 1]
    fetch_count: int
    lifecycle: Literal["prepared", "active", "closed", "poisoned"]
    prepare_count: Literal[1]
    total_changes: int
    transaction_epoch: int
    transaction_generation: object


class _SQLiteConnectionBaselineEntryPublicationExecution:
    """Opaque source-owner session for one sequential permanent entry write."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _BASELINE_ENTRY_PUBLICATION_CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_BASELINE_ENTRY_EXECUTION")


class _SQLiteConnectionBaselineEntryPublicationStepSnapshot(NamedTuple):
    affected_rows_delta: Literal[1]
    completed_entry_count: int
    entry_ordinal: int
    execute_count: int
    prepare_count: Literal[1]
    total_changes: int
    transaction_epoch: int
    transaction_generation: object


class _SQLiteConnectionBaselineEntryPublicationExecutionSnapshot(NamedTuple):
    affected_rows: int
    completed_entry_count: int
    execute_count: int
    expected_entry_count: int
    lifecycle: Literal["active", "completed", "poisoned"]
    next_entry_ordinal: int
    prepare_count: Literal[1]
    total_changes_before: int
    total_changes: int
    total_changes_delta: int
    transaction_epoch: int
    transaction_generation: object
    close_attempt_count: Literal[0, 1]
    close_succeeded: bool


class _SQLiteConnectionBaselineHeaderPublicationExecution:
    """Opaque source-owner session for one permanent baseline-header write."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _BASELINE_HEADER_PUBLICATION_CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_BASELINE_HEADER_EXECUTION")


class _SQLiteConnectionBaselineHeaderPublicationStepSnapshot(NamedTuple):
    affected_rows_delta: Literal[1]
    completed_execution_count: Literal[1]
    execute_count: Literal[1]
    prepare_count: Literal[1]
    total_changes: int
    transaction_epoch: int
    transaction_generation: object


class _SQLiteConnectionBaselineHeaderPublicationExecutionSnapshot(NamedTuple):
    affected_rows: int
    completed_execution_count: Literal[0, 1]
    execute_count: Literal[0, 1]
    lifecycle: Literal["active", "completed", "poisoned"]
    prepare_count: Literal[1]
    total_changes_before: int
    total_changes: int
    total_changes_delta: int
    transaction_epoch: int
    transaction_generation: object
    close_attempt_count: Literal[0, 1]
    close_succeeded: bool


class _SQLiteConnectionOperationSequenceZeroExecution:
    """Opaque source-owner session for the singleton sequence-zero write."""

    __slots__ = ("__weakref__",)

    def __init__(self, token: object) -> None:
        if token is not _OPERATION_SEQUENCE_ZERO_CONSTRUCTION_TOKEN:
            raise TypeError("GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION")


class _SQLiteConnectionOperationSequenceZeroStepSnapshot(NamedTuple):
    affected_rows_delta: Literal[1]
    completed_execution_count: Literal[1]
    execute_count: Literal[1]
    prepare_count: Literal[1]
    total_changes: int
    transaction_epoch: int
    transaction_generation: object


class _SQLiteConnectionOperationSequenceZeroExecutionSnapshot(NamedTuple):
    affected_rows: int
    completed_execution_count: Literal[0, 1]
    execute_count: Literal[0, 1]
    lifecycle: Literal["active", "completed", "poisoned"]
    prepare_count: Literal[1]
    total_changes_before: int
    total_changes: int
    total_changes_delta: int
    transaction_epoch: int
    transaction_generation: object
    close_attempt_count: Literal[0, 1]
    close_succeeded: bool


@dataclass(slots=True)
class _PostDdlPublicationReaderState:
    close_attempt_count: Literal[0, 1]
    close_error_code: str | None
    close_succeeded: bool
    connection: SQLiteV1BaselineConnectionOwner
    cursor: sqlite3.Cursor
    execute_count: Literal[0, 1]
    fetch_count: int
    lifecycle: Literal["prepared", "active", "closed", "poisoned"]
    total_changes: int
    transaction_epoch: int
    transaction_generation: object


@dataclass(slots=True)
class _Migration0002ExecutionState:
    connection: SQLiteV1BaselineConnectionOwner
    asset: object
    statements: tuple[str, ...]
    transaction_generation: object
    affected_rows: int
    completed_statement_count: int
    lifecycle: Literal["active", "completed", "poisoned"]
    next_statement_ordinal: int
    prepared_statement_count: int
    total_changes: int
    transaction_epoch: int


@dataclass(slots=True)
class _BaselineEntryPublicationExecutionState:
    affected_rows: int
    close_attempt_count: Literal[0, 1]
    close_error_code: str | None
    close_succeeded: bool
    completed_entry_count: int
    connection: SQLiteV1BaselineConnectionOwner
    cursor: sqlite3.Cursor | None
    execute_count: int
    expected_entry_count: int
    lifecycle: Literal["active", "completed", "poisoned"]
    next_entry_ordinal: int
    prepare_count: Literal[1]
    total_changes_before: int
    total_changes: int
    transaction_epoch_before: int
    transaction_epoch: int
    transaction_generation: object


@dataclass(slots=True)
class _BaselineHeaderPublicationExecutionState:
    affected_rows: int
    close_attempt_count: Literal[0, 1]
    close_error_code: str | None
    close_succeeded: bool
    completed_execution_count: Literal[0, 1]
    connection: SQLiteV1BaselineConnectionOwner
    cursor: sqlite3.Cursor | None
    execute_count: Literal[0, 1]
    lifecycle: Literal["active", "completed", "poisoned"]
    prepare_count: Literal[1]
    total_changes_before: int
    total_changes: int
    transaction_epoch_before: int
    transaction_epoch: int
    transaction_generation: object


@dataclass(slots=True)
class _OperationSequenceZeroExecutionState:
    affected_rows: int
    close_attempt_count: Literal[0, 1]
    close_error_code: str | None
    close_succeeded: bool
    completed_execution_count: Literal[0, 1]
    connection: SQLiteV1BaselineConnectionOwner
    cursor: sqlite3.Cursor | None
    execute_count: Literal[0, 1]
    fixed_insert_sql: str
    fixed_insert_sql_sha256: str
    lifecycle: Literal["active", "completed", "poisoned"]
    prepare_count: Literal[1]
    total_changes_before: int
    total_changes: int
    transaction_epoch_before: int
    transaction_epoch: int
    transaction_generation: object


_MIGRATION_0002_EXECUTIONS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteConnectionMigration0002Execution],
        _Migration0002ExecutionState,
    ],
] = {}
_POST_DDL_PUBLICATION_READERS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteConnectionPostDdlPublicationReader],
        _PostDdlPublicationReaderState,
    ],
] = {}
_BASELINE_ENTRY_PUBLICATION_EXECUTIONS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteConnectionBaselineEntryPublicationExecution],
        _BaselineEntryPublicationExecutionState,
    ],
] = {}
_BASELINE_HEADER_PUBLICATION_EXECUTIONS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteConnectionBaselineHeaderPublicationExecution],
        _BaselineHeaderPublicationExecutionState,
    ],
] = {}
_OPERATION_SEQUENCE_ZERO_EXECUTIONS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteConnectionOperationSequenceZeroExecution],
        _OperationSequenceZeroExecutionState,
    ],
] = {}
_CURSOR_PUBLICATION_REBIND_EXECUTIONS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteConnectionCursorPublicationRebindExecution],
        _CursorPublicationRebindExecutionState,
    ],
] = {}
_CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteConnectionCursorPublicationRebindExecution],
        _CursorPublicationRebindReleaseFaultState,
    ],
] = {}
_CURSOR_PUBLICATION_SEAL_READ_EXECUTIONS: dict[
    int,
    tuple[
        ReferenceType[_SQLiteConnectionCursorPublicationSealReadExecution],
        _CursorPublicationSealReadExecutionState,
    ],
] = {}

# CPython's sqlite descriptors are captured once so later module/class
# replacement cannot redirect the package-owned execution lane.
_SQLITE_CONNECTION_CURSOR = sqlite3.Connection.cursor
_SQLITE_CONNECTION_IN_TRANSACTION = sqlite3.Connection.in_transaction
_SQLITE_CONNECTION_SET_TRACE_CALLBACK = sqlite3.Connection.set_trace_callback
_SQLITE_CONNECTION_TOTAL_CHANGES = sqlite3.Connection.total_changes
_SQLITE_CURSOR_EXECUTE = sqlite3.Cursor.execute
_SQLITE_CURSOR_CLOSE = sqlite3.Cursor.close
_SQLITE_CURSOR_FETCHONE = sqlite3.Cursor.fetchone
_SQLITE_CURSOR_ROWCOUNT = sqlite3.Cursor.rowcount
_BASELINE_ENTRY_SQLITE_CONNECTION_CURSOR = sqlite3.Connection.cursor
_BASELINE_ENTRY_SQLITE_CONNECTION_IN_TRANSACTION = sqlite3.Connection.in_transaction
_BASELINE_ENTRY_SQLITE_CONNECTION_TOTAL_CHANGES = sqlite3.Connection.total_changes
_BASELINE_ENTRY_SQLITE_CURSOR_EXECUTE = sqlite3.Cursor.execute
_BASELINE_ENTRY_SQLITE_CURSOR_CLOSE = sqlite3.Cursor.close
_BASELINE_ENTRY_SQLITE_CURSOR_ROWCOUNT = sqlite3.Cursor.rowcount
_BASELINE_HEADER_SQLITE_CONNECTION_CURSOR = sqlite3.Connection.cursor
_BASELINE_HEADER_SQLITE_CONNECTION_IN_TRANSACTION = sqlite3.Connection.in_transaction
_BASELINE_HEADER_SQLITE_CONNECTION_TOTAL_CHANGES = sqlite3.Connection.total_changes
_BASELINE_HEADER_SQLITE_CURSOR_EXECUTE = sqlite3.Cursor.execute
_BASELINE_HEADER_SQLITE_CURSOR_CLOSE = sqlite3.Cursor.close
_BASELINE_HEADER_SQLITE_CURSOR_ROWCOUNT = sqlite3.Cursor.rowcount
_SEQUENCE_ZERO_SQLITE_CONNECTION_CURSOR = sqlite3.Connection.cursor
_SEQUENCE_ZERO_SQLITE_CONNECTION_IN_TRANSACTION = sqlite3.Connection.in_transaction
_SEQUENCE_ZERO_SQLITE_CONNECTION_TOTAL_CHANGES = sqlite3.Connection.total_changes
_SEQUENCE_ZERO_SQLITE_CURSOR_EXECUTE = sqlite3.Cursor.execute
_SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE = sqlite3.Cursor.close
_SEQUENCE_ZERO_SQLITE_CURSOR_ROWCOUNT = sqlite3.Cursor.rowcount
_CURSOR_REBIND_SQLITE_CONNECTION_CURSOR = sqlite3.Connection.cursor
_CURSOR_REBIND_SQLITE_CONNECTION_IN_TRANSACTION = sqlite3.Connection.in_transaction
_CURSOR_REBIND_SQLITE_CONNECTION_TOTAL_CHANGES = sqlite3.Connection.total_changes
_CURSOR_REBIND_SQLITE_CURSOR_EXECUTE = sqlite3.Cursor.execute
_CURSOR_REBIND_SQLITE_CURSOR_CLOSE = sqlite3.Cursor.close
_CURSOR_REBIND_SQLITE_CURSOR_FETCHMANY = sqlite3.Cursor.fetchmany
_CURSOR_REBIND_SQLITE_CURSOR_ROWCOUNT = sqlite3.Cursor.rowcount
_CURSOR_REBIND_SQLITE_CURSOR_CONNECTION = sqlite3.Cursor.connection
_CURSOR_SEAL_READ_SQLITE_CONNECTION_CURSOR = sqlite3.Connection.cursor
_CURSOR_SEAL_READ_SQLITE_CONNECTION_IN_TRANSACTION = sqlite3.Connection.in_transaction
_CURSOR_SEAL_READ_SQLITE_CONNECTION_TOTAL_CHANGES = sqlite3.Connection.total_changes
_CURSOR_SEAL_READ_SQLITE_CURSOR_EXECUTE = sqlite3.Cursor.execute
_CURSOR_SEAL_READ_SQLITE_CURSOR_CLOSE = sqlite3.Cursor.close
_CURSOR_SEAL_READ_SQLITE_CURSOR_FETCHONE = sqlite3.Cursor.fetchone
_CURSOR_SEAL_READ_SQLITE_CURSOR_CONNECTION = sqlite3.Cursor.connection
_CURSOR_SEAL_READ_ACCUMULATOR = SQLiteCursorSealAccumulator
_CURSOR_SEAL_READ_DECODE_ROW = decode_sqlite_v1_cursor_seal_row
_READ_MIGRATION_0002_ASSET = _read_sqlite_cursor_migration_0002_asset_snapshot_intrinsic


def _sqlite_native_in_transaction(connection: sqlite3.Connection) -> bool:
    try:
        value = _SQLITE_CONNECTION_IN_TRANSACTION.__get__(connection, sqlite3.Connection)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_MIGRATION_0002_CONNECTION") from error
    if type(value) is not bool:
        _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_CONNECTION")
    return value


def _sqlite_native_total_changes(connection: sqlite3.Connection) -> int:
    try:
        value = _SQLITE_CONNECTION_TOTAL_CHANGES.__get__(connection, sqlite3.Connection)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_MIGRATION_0002_COUNTER") from error
    if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
        _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_COUNTER")
    return value


def _migration_0002_fail(code: str) -> Never:
    raise ValueError(code)


def _migration_0002_state(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionMigration0002Execution,
) -> _Migration0002ExecutionState:
    if type(execution) is not _SQLiteConnectionMigration0002Execution:
        _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_EXECUTION")
    current = _MIGRATION_0002_EXECUTIONS.get(id(execution))
    if current is None or current[0]() is not execution or current[1].connection is not connection:
        _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_EXECUTION")
    return current[1]


def _register_migration_0002_execution(
    execution: _SQLiteConnectionMigration0002Execution,
    state: _Migration0002ExecutionState,
) -> None:
    execution_id = id(execution)

    def discard(reference: ReferenceType[_SQLiteConnectionMigration0002Execution]) -> None:
        current = _MIGRATION_0002_EXECUTIONS.get(execution_id)
        if current is not None and current[0] is reference:
            _MIGRATION_0002_EXECUTIONS.pop(execution_id, None)

    reference = ref(execution, discard)
    _MIGRATION_0002_EXECUTIONS[execution_id] = (reference, state)


def _post_ddl_reader_state(
    connection: SQLiteV1BaselineConnectionOwner,
    reader: _SQLiteConnectionPostDdlPublicationReader,
) -> _PostDdlPublicationReaderState:
    if type(reader) is not _SQLiteConnectionPostDdlPublicationReader:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    current = _POST_DDL_PUBLICATION_READERS.get(id(reader))
    if current is None or current[0]() is not reader or current[1].connection is not connection:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    return current[1]


def _post_ddl_reader_state_from_handle(
    reader: _SQLiteConnectionPostDdlPublicationReader,
) -> _PostDdlPublicationReaderState:
    if type(reader) is not _SQLiteConnectionPostDdlPublicationReader:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    current = _POST_DDL_PUBLICATION_READERS.get(id(reader))
    if current is None or current[0]() is not reader:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    return current[1]


def _register_post_ddl_reader(
    reader: _SQLiteConnectionPostDdlPublicationReader,
    state: _PostDdlPublicationReaderState,
) -> None:
    reader_id = id(reader)

    def discard(reference: ReferenceType[_SQLiteConnectionPostDdlPublicationReader]) -> None:
        current = _POST_DDL_PUBLICATION_READERS.get(reader_id)
        if current is not None and current[0] is reference:
            _POST_DDL_PUBLICATION_READERS.pop(reader_id, None)

    reference = ref(reader, discard)
    _POST_DDL_PUBLICATION_READERS[reader_id] = (reference, state)


def _baseline_entry_publication_fail(code: str) -> Never:
    raise ValueError(code)


def _baseline_entry_native_in_transaction(connection: sqlite3.Connection) -> bool:
    try:
        value = _BASELINE_ENTRY_SQLITE_CONNECTION_IN_TRANSACTION.__get__(
            connection, sqlite3.Connection
        )
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_ENTRY_CONNECTION") from error
    if type(value) is not bool:
        _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_CONNECTION")
    return value


def _baseline_entry_native_total_changes(connection: sqlite3.Connection) -> int:
    try:
        value = _BASELINE_ENTRY_SQLITE_CONNECTION_TOTAL_CHANGES.__get__(
            connection, sqlite3.Connection
        )
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_ENTRY_COUNTER") from error
    if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
        _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_COUNTER")
    return value


def _is_baseline_entry_lower_hex_64(value: object) -> bool:
    if type(value) is not str or len(value) != 64:
        return False
    return all(character in "0123456789abcdef" for character in value)


_BASELINE_HEADER_IS_LOWER_HEX_64 = _is_baseline_entry_lower_hex_64


def _checked_baseline_entry_publication_parameters(
    baseline_id: object,
    ordinal: object,
    entry_kind: object,
    entry_key_blob: object,
    entry_state_blob: object,
    previous_entry_hash: object,
    entry_hash: object,
) -> tuple[str, int, str, bytes, bytes, str, str]:
    if (
        type(baseline_id) is not str
        or len(baseline_id) != 67
        or baseline_id[:3] != "v2-"
        or not _is_baseline_entry_lower_hex_64(baseline_id[3:])
        or type(ordinal) is not int
        or not 0 <= ordinal <= MAX_SAFE_INTEGER
        or type(entry_kind) is not str
        or entry_kind not in BASELINE_ENTRY_KINDS
        or type(entry_key_blob) is not bytes
        or type(entry_state_blob) is not bytes
        or not _is_baseline_entry_lower_hex_64(previous_entry_hash)
        or not _is_baseline_entry_lower_hex_64(entry_hash)
    ):
        _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_PARAMETERS")
    return (
        baseline_id,
        ordinal,
        entry_kind,
        entry_key_blob,
        entry_state_blob,
        cast(str, previous_entry_hash),
        cast(str, entry_hash),
    )


def _baseline_entry_publication_state(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionBaselineEntryPublicationExecution,
) -> _BaselineEntryPublicationExecutionState:
    if type(execution) is not _SQLiteConnectionBaselineEntryPublicationExecution:
        _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_EXECUTION")
    current = _BASELINE_ENTRY_PUBLICATION_EXECUTIONS.get(id(execution))
    if current is None or current[0]() is not execution or current[1].connection is not connection:
        _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_EXECUTION")
    return current[1]


def _register_baseline_entry_publication_execution(
    execution: _SQLiteConnectionBaselineEntryPublicationExecution,
    state: _BaselineEntryPublicationExecutionState,
) -> None:
    execution_id = id(execution)

    def discard(
        reference: ReferenceType[_SQLiteConnectionBaselineEntryPublicationExecution],
    ) -> None:
        current = _BASELINE_ENTRY_PUBLICATION_EXECUTIONS.get(execution_id)
        if current is not None and current[0] is reference:
            _BASELINE_ENTRY_PUBLICATION_EXECUTIONS.pop(execution_id, None)

    reference = ref(execution, discard)
    _BASELINE_ENTRY_PUBLICATION_EXECUTIONS[execution_id] = (reference, state)


def _baseline_header_publication_fail(code: str) -> Never:
    raise ValueError(code)


def _baseline_header_native_in_transaction(connection: sqlite3.Connection) -> bool:
    try:
        value = _BASELINE_HEADER_SQLITE_CONNECTION_IN_TRANSACTION.__get__(
            connection, sqlite3.Connection
        )
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_HEADER_CONNECTION") from error
    if type(value) is not bool:
        _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_CONNECTION")
    return value


def _baseline_header_native_total_changes(connection: sqlite3.Connection) -> int:
    try:
        value = _BASELINE_HEADER_SQLITE_CONNECTION_TOTAL_CHANGES.__get__(
            connection, sqlite3.Connection
        )
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_BASELINE_HEADER_COUNTER") from error
    if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
        _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_COUNTER")
    return value


def _checked_baseline_header_publication_parameters(
    baseline_id: object,
    source_schema_identity_sha256: object,
    source_migration_lineage_id: object,
    source_migration_lineage_sha256: object,
    source_descriptor_hash: object,
    captured_at_ms: object,
    legacy_operation_count: object,
    entry_count: object,
    first_entry_hash: object,
    final_entry_hash: object,
    canonical_projection_sha256: object,
    creation_runtime: object,
    creation_runtime_version: object,
    policy_blob: object,
) -> tuple[str, str, str, str, str, int, int, int, str, str, str, str, str, bytes]:
    if (
        type(baseline_id) is not str
        or len(baseline_id) != 67
        or baseline_id[:3] != "v2-"
        or not _BASELINE_HEADER_IS_LOWER_HEX_64(baseline_id[3:])
        or not _BASELINE_HEADER_IS_LOWER_HEX_64(source_schema_identity_sha256)
        or type(source_migration_lineage_id) is not str
        or not source_migration_lineage_id
        or not _BASELINE_HEADER_IS_LOWER_HEX_64(source_migration_lineage_sha256)
        or not _BASELINE_HEADER_IS_LOWER_HEX_64(source_descriptor_hash)
        or type(captured_at_ms) is not int
        or not 0 <= captured_at_ms <= MAX_SAFE_INTEGER
        or type(legacy_operation_count) is not int
        or not 0 <= legacy_operation_count <= MAX_SAFE_INTEGER
        or type(entry_count) is not int
        or not legacy_operation_count <= entry_count <= MAX_SAFE_INTEGER
        or not _BASELINE_HEADER_IS_LOWER_HEX_64(first_entry_hash)
        or not _BASELINE_HEADER_IS_LOWER_HEX_64(final_entry_hash)
        or not _BASELINE_HEADER_IS_LOWER_HEX_64(canonical_projection_sha256)
        or type(creation_runtime) is not str
        or not creation_runtime
        or type(creation_runtime_version) is not str
        or not creation_runtime_version
        or type(policy_blob) is not bytes
    ):
        _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_PARAMETERS")
    return (
        baseline_id,
        cast(str, source_schema_identity_sha256),
        source_migration_lineage_id,
        cast(str, source_migration_lineage_sha256),
        cast(str, source_descriptor_hash),
        captured_at_ms,
        legacy_operation_count,
        entry_count,
        cast(str, first_entry_hash),
        cast(str, final_entry_hash),
        cast(str, canonical_projection_sha256),
        creation_runtime,
        creation_runtime_version,
        policy_blob,
    )


def _baseline_header_publication_state(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionBaselineHeaderPublicationExecution,
) -> _BaselineHeaderPublicationExecutionState:
    if type(execution) is not _SQLiteConnectionBaselineHeaderPublicationExecution:
        _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_EXECUTION")
    current = _BASELINE_HEADER_PUBLICATION_EXECUTIONS.get(id(execution))
    if current is None or current[0]() is not execution or current[1].connection is not connection:
        _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_EXECUTION")
    return current[1]


def _register_baseline_header_publication_execution(
    execution: _SQLiteConnectionBaselineHeaderPublicationExecution,
    state: _BaselineHeaderPublicationExecutionState,
) -> None:
    execution_id = id(execution)

    def discard(
        reference: ReferenceType[_SQLiteConnectionBaselineHeaderPublicationExecution],
    ) -> None:
        current = _BASELINE_HEADER_PUBLICATION_EXECUTIONS.get(execution_id)
        if current is not None and current[0] is reference:
            _BASELINE_HEADER_PUBLICATION_EXECUTIONS.pop(execution_id, None)

    reference = ref(execution, discard)
    _BASELINE_HEADER_PUBLICATION_EXECUTIONS[execution_id] = (reference, state)


def _operation_sequence_zero_fail(code: str) -> Never:
    raise ValueError(code)


def _assert_operation_sequence_zero_sql_commitment(sql: object, sha256: object) -> None:
    """Authenticate the exact fixed statement without trusting module aliases."""

    if type(sql) is not str or type(sha256) is not str:
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_SQL_IDENTITY")
    sql_bytes = sql.encode("utf-8")
    if (
        sql
        != "INSERT INTO main.ge_cycle_operation_sequence (singleton, baseline_id, "
        "last_commit_sequence, baseline_captured_at_ms, updated_at_ms) "
        "VALUES (1, ?, 0, ?, ?)"
        or len(sql_bytes) != 154
        or sha256 != "a9afde17c90fcc7381eefa3fa81823752d6f1bc29c9eced2de8b31176cc1dd85"
        or hashlib.sha256(sql_bytes).hexdigest() != sha256
    ):
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_SQL_IDENTITY")


def _sequence_zero_native_in_transaction(connection: sqlite3.Connection) -> bool:
    try:
        value = _SEQUENCE_ZERO_SQLITE_CONNECTION_IN_TRANSACTION.__get__(
            connection, sqlite3.Connection
        )
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_SEQUENCE_ZERO_CONNECTION") from error
    if type(value) is not bool:
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_CONNECTION")
    return value


def _sequence_zero_native_total_changes(connection: sqlite3.Connection) -> int:
    try:
        value = _SEQUENCE_ZERO_SQLITE_CONNECTION_TOTAL_CHANGES.__get__(
            connection, sqlite3.Connection
        )
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_SEQUENCE_ZERO_COUNTER") from error
    if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_COUNTER")
    return value


def _checked_operation_sequence_zero_parameters(
    baseline_id: object,
    baseline_captured_at_ms: object,
    updated_at_ms: object,
) -> tuple[str, int, int]:
    if (
        type(baseline_id) is not str
        or len(baseline_id) != 67
        or baseline_id[:3] != "v2-"
        or not _BASELINE_HEADER_IS_LOWER_HEX_64(baseline_id[3:])
        or type(baseline_captured_at_ms) is not int
        or not 0 <= baseline_captured_at_ms <= MAX_SAFE_INTEGER
        or type(updated_at_ms) is not int
        or not baseline_captured_at_ms <= updated_at_ms <= MAX_SAFE_INTEGER
    ):
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_PARAMETERS")
    return baseline_id, baseline_captured_at_ms, updated_at_ms


def _operation_sequence_zero_state(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionOperationSequenceZeroExecution,
) -> _OperationSequenceZeroExecutionState:
    if type(execution) is not _SQLiteConnectionOperationSequenceZeroExecution:
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION")
    current = _OPERATION_SEQUENCE_ZERO_EXECUTIONS.get(id(execution))
    if current is None or current[0]() is not execution or current[1].connection is not connection:
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION")
    return current[1]


def _register_operation_sequence_zero_execution(
    execution: _SQLiteConnectionOperationSequenceZeroExecution,
    state: _OperationSequenceZeroExecutionState,
) -> None:
    execution_id = id(execution)

    def discard(
        reference: ReferenceType[_SQLiteConnectionOperationSequenceZeroExecution],
    ) -> None:
        current = _OPERATION_SEQUENCE_ZERO_EXECUTIONS.get(execution_id)
        if current is not None and current[0] is reference:
            _OPERATION_SEQUENCE_ZERO_EXECUTIONS.pop(execution_id, None)

    reference = ref(execution, discard)
    _OPERATION_SEQUENCE_ZERO_EXECUTIONS[execution_id] = (reference, state)


def _cursor_publication_rebind_fail(code: str) -> Never:
    raise ValueError(code)


def _cursor_publication_rebind_native_in_transaction(
    connection: sqlite3.Connection,
    _descriptor: Any = _CURSOR_REBIND_SQLITE_CONNECTION_IN_TRANSACTION,
) -> bool:
    try:
        value = _descriptor.__get__(connection, sqlite3.Connection)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_CURSOR_REBIND_CONNECTION") from error
    if type(value) is not bool:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_CONNECTION")
    return value


def _cursor_publication_rebind_native_total_changes(
    connection: sqlite3.Connection,
    _descriptor: Any = _CURSOR_REBIND_SQLITE_CONNECTION_TOTAL_CHANGES,
) -> int:
    try:
        value = _descriptor.__get__(connection, sqlite3.Connection)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_CURSOR_REBIND_COUNTER") from error
    if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_COUNTER")
    return value


def _cursor_publication_rebind_hash(value: object) -> str:
    if (
        type(value) is not str
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_PARAMETERS")
    return value


def _cursor_publication_rebind_cursor_belongs(
    cursor: object,
    connection: sqlite3.Connection,
    _descriptor: Any = _CURSOR_REBIND_SQLITE_CURSOR_CONNECTION,
) -> bool:
    if type(cursor) is not sqlite3.Cursor:
        return False
    try:
        return _descriptor.__get__(cursor, sqlite3.Cursor) is connection
    except BaseException:
        return False


def _cursor_publication_rebind_state(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: object,
    _type: Callable[[object], type] = type,
    _identity: Callable[[object], int] = id,
    _dictionary_get: Callable[..., object] = dict.get,
) -> _CursorPublicationRebindExecutionState:
    if _type(execution) is not _SQLiteConnectionCursorPublicationRebindExecution:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION")
    current = _dictionary_get(_CURSOR_PUBLICATION_REBIND_EXECUTIONS, _identity(execution))
    if (
        type(current) is not tuple
        or len(current) != 2
        or current[0]() is not execution
        or type(current[1]) is not _CursorPublicationRebindExecutionState
        or current[1].connection is not connection
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION")
    return current[1]


def _register_cursor_publication_rebind_execution(
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    state: _CursorPublicationRebindExecutionState,
    _identity: Callable[[object], int] = id,
    _make_ref: Callable[..., ReferenceType[object]] = ref,
    _dictionary_get: Callable[..., object] = dict.get,
    _dictionary_set: Callable[..., None] = dict.__setitem__,
    _dictionary_pop: Callable[..., object] = dict.pop,
    _cursor_close: Callable[[sqlite3.Cursor], None] = _CURSOR_REBIND_SQLITE_CURSOR_CLOSE,
) -> None:
    execution_id = _identity(execution)

    def discard(dead: ReferenceType[object]) -> None:
        current = _dictionary_get(_CURSOR_PUBLICATION_REBIND_EXECUTIONS, execution_id)
        if type(current) is tuple and len(current) == 2 and current[0] is dead:
            cursor = current[1].cursor
            if cursor is not None:
                with suppress(BaseException):
                    _cursor_close(cursor)
                current[1].cursor = None
            _dictionary_pop(_CURSOR_PUBLICATION_REBIND_EXECUTIONS, execution_id, None)

    execution_ref = _make_ref(execution, discard)
    _dictionary_set(
        _CURSOR_PUBLICATION_REBIND_EXECUTIONS,
        execution_id,
        (execution_ref, state),
    )


def _register_cursor_publication_rebind_release_fault(
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    fault: _CursorPublicationRebindReleaseFaultState,
    _identity: Callable[[object], int] = id,
    _make_ref: Callable[..., ReferenceType[object]] = ref,
    _dictionary_get: Callable[..., object] = dict.get,
    _dictionary_set: Callable[..., None] = dict.__setitem__,
    _dictionary_pop: Callable[..., object] = dict.pop,
) -> None:
    execution_id = _identity(execution)

    def discard(dead: ReferenceType[object]) -> None:
        current = _dictionary_get(
            _CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS, execution_id
        )
        if type(current) is tuple and len(current) == 2 and current[0] is dead:
            _dictionary_pop(
                _CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS, execution_id, None
            )

    _dictionary_set(
        _CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS,
        execution_id,
        (_make_ref(execution, discard), fault),
    )


_REGISTER_CURSOR_PUBLICATION_REBIND_RELEASE_FAULT = (
    _register_cursor_publication_rebind_release_fault
)


def _discard_cursor_publication_rebind_release_fault_exact(
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    _identity: Callable[[object], int] = id,
    _dictionary_get: Callable[..., object] = dict.get,
    _dictionary_pop: Callable[..., object] = dict.pop,
) -> None:
    execution_id = _identity(execution)
    current = _dictionary_get(_CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS, execution_id)
    if type(current) is tuple and len(current) == 2 and current[0]() is execution:
        _dictionary_pop(_CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS, execution_id, None)


def _take_cursor_publication_rebind_release_fault_exact(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    _identity: Callable[[object], int] = id,
    _dictionary_get: Callable[..., object] = dict.get,
    _dictionary_pop: Callable[..., object] = dict.pop,
) -> BaseException | None:
    execution_id = _identity(execution)
    current = _dictionary_get(_CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS, execution_id)
    if current is None:
        return None
    if (
        type(current) is not tuple
        or len(current) != 2
        or current[0]() is not execution
        or type(current[1]) is not _CursorPublicationRebindReleaseFaultState
        or current[1].connection_id != _identity(connection)
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT")
    error = current[1].error_ref()
    _dictionary_pop(_CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS, execution_id, None)
    if error is None:
        _cursor_publication_rebind_fail(
            "GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT"
        )
    return error


def _arm_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
) -> tuple[
    _CursorPublicationChangesPrimaryCapture,
    Token[_CursorPublicationChangesPrimaryCapturePhase | None],
]:
    """Arm one context-local exact-E handoff for the fixed outer leaf call."""

    if (
        _TYPE(connection) is not SQLiteV1BaselineConnectionOwner
        or _CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get() is not None
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY")
    nonce = object()
    capture = _CursorPublicationChangesPrimaryCapture(nonce, connection)
    armed = _CursorPublicationChangesPrimaryCapturePhase(nonce, capture, "armed")
    return capture, _CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.set(armed)


def _reset_sqlite_connection_cursor_publication_rebind_changes_primary_capture_intrinsic(
    capture: _CursorPublicationChangesPrimaryCapture,
    token: Token[_CursorPublicationChangesPrimaryCapturePhase | None],
) -> None:
    """Erase every strong handoff edge and restore the prior context on all exits."""

    current = _CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get()
    capture.connection = None
    capture.state = None
    capture.error = None
    capture.boundary = None
    capture.consumed = True
    capture.invalid = True
    try:
        _CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.reset(token)
    except (RuntimeError, ValueError):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY")
    if (
        current is None
        or current.capture is not capture
        or current.nonce is not capture.nonce
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY")


def _record_cursor_publication_rebind_changes_primary_exact(
    state: _CursorPublicationRebindExecutionState,
    error: BaseException,
    boundary: _CursorPublicationChangesPrimaryBoundary,
) -> None:
    """Write the first exact E into the active synchronous capture, if armed."""

    if (
        not isinstance(error, BaseException)
        or _TYPE(boundary) is not str
        or boundary
        not in {
            "serialized-changes-pre-query",
            "serialized-changes-prepare",
            "serialized-changes-execute",
            "serialized-changes-fetch",
            "serialized-changes-release",
            "serialized-changes-post-query",
            "rule11-outer-ledger",
            "rule11-five-count",
        }
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY")
    current = _CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get()
    if current is None:
        return
    capture = current.capture
    if (
        current.phase != "armed"
        or current.nonce is not capture.nonce
        or capture.consumed
        or capture.invalid
        or state.connection is not capture.connection
        or capture.state is not None
        or capture.error is not None
        or capture.boundary is not None
    ):
        capture.invalid = True
        return
    capture.state = state
    capture.error = error
    capture.boundary = boundary
    _CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.set(
        _CursorPublicationChangesPrimaryCapturePhase(
            capture.nonce, capture, "recorded"
        )
    )


def _record_sqlite_connection_cursor_publication_rebind_completed_primary_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    error: BaseException,
    boundary: Literal["rule11-outer-ledger", "rule11-five-count"],
) -> None:
    """Record exact completed-E only inside the active synchronous leaf capture."""

    if (
        _TYPE(connection) is not SQLiteV1BaselineConnectionOwner
        or _TYPE(boundary) is not str
        or boundary not in {"rule11-outer-ledger", "rule11-five-count"}
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY")
    state = _cursor_publication_rebind_state(connection, execution)
    if state.lifecycle != "completed":
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY")
    _record_cursor_publication_rebind_changes_primary_exact(state, error, boundary)


def _take_sqlite_connection_cursor_publication_rebind_changes_primary_intrinsic(
    capture: _CursorPublicationChangesPrimaryCapture,
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    error: BaseException,
) -> _CursorPublicationChangesPrimaryBoundary:
    """Consume one exact lower E proof; clear before validating caller identity."""

    if (
        _TYPE(capture) is not _CursorPublicationChangesPrimaryCapture
        or _TYPE(connection) is not SQLiteV1BaselineConnectionOwner
        or not isinstance(error, BaseException)
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY")
    current = _CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.get()
    recorded_connection = capture.connection
    recorded_state = capture.state
    primary = capture.error
    boundary = capture.boundary
    invalid = capture.invalid
    capture.connection = None
    capture.state = None
    capture.error = None
    capture.boundary = None
    capture.consumed = True
    capture.invalid = True
    if (
        current is not None
        and current.capture is capture
        and current.nonce is capture.nonce
    ):
        _CURSOR_PUBLICATION_CHANGES_PRIMARY_CAPTURE.set(
            _CursorPublicationChangesPrimaryCapturePhase(
                capture.nonce, capture, "consumed"
            )
        )
    state = _cursor_publication_rebind_state(connection, execution)
    completed_boundary = _TYPE(boundary) is str and boundary in {
        "rule11-outer-ledger",
        "rule11-five-count",
    }
    changes_boundary = _TYPE(boundary) is str and boundary in {
        "serialized-changes-pre-query",
        "serialized-changes-prepare",
        "serialized-changes-execute",
        "serialized-changes-fetch",
        "serialized-changes-release",
        "serialized-changes-post-query",
    }
    required_lifecycle = "completed" if completed_boundary else "poisoned"
    if (
        current is None
        or current.phase != "recorded"
        or current.capture is not capture
        or current.nonce is not capture.nonce
        or invalid
        or not (completed_boundary or changes_boundary)
        or recorded_connection is not connection
        or recorded_state is not state
        or state.connection is not connection
        or state.lifecycle != required_lifecycle
        or primary is None
        or boundary is None
        or primary is not error
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_PRIMARY")
    return boundary


def _cursor_publication_rebind_snapshot(
    state: _CursorPublicationRebindExecutionState,
) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
    before = _SQLiteCursorPrivateWriteLedgerSnapshot(0, 0, 0)
    after = _SQLiteCursorPrivateWriteLedgerSnapshot(
        state.cursor_ledger_affected_rows_watermark,
        state.cursor_ledger_fixed_statement_count,
        state.cursor_ledger_logical_write_sequence,
    )
    return _SQLiteConnectionCursorPublicationRebindSnapshot(
        lifecycle=state.lifecycle,
        rebind_sql=state.rebind_sql,
        rebind_sql_sha256=state.rebind_sql_sha256,
        parameter_order=state.parameter_order,
        changes_sql=state.changes_sql,
        changes_sql_sha256=state.changes_sql_sha256,
        parameters=state.parameters,
        prepare_count=state.prepare_count,
        execute_count=state.execute_count,
        release_count=state.release_count,
        changes_prepare_count=state.changes_prepare_count,
        changes_fetch_count=state.changes_fetch_count,
        changes_release_count=state.changes_release_count,
        affected_rows=state.affected_rows,
        changes_affected_rows=state.changes_affected_rows,
        total_changes_before=state.total_changes_before,
        total_changes=state.total_changes,
        total_changes_delta=state.total_changes - state.total_changes_before,
        transaction_epoch_before=state.transaction_epoch_before,
        transaction_epoch=state.transaction_epoch,
        transaction_generation=state.transaction_generation,
        cursor_ledger_before=before,
        cursor_ledger_after=after,
        cursor_ledger_delta=after,
    )


def _cursor_publication_seal_read_fail(code: str) -> Never:
    raise ValueError(code)


def _cursor_publication_seal_read_native_in_transaction(
    connection: sqlite3.Connection,
    _descriptor: Any = _CURSOR_SEAL_READ_SQLITE_CONNECTION_IN_TRANSACTION,
) -> bool:
    try:
        value = _descriptor.__get__(connection, sqlite3.Connection)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_CONNECTION") from error
    if type(value) is not bool:
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_CONNECTION")
    return value


def _cursor_publication_seal_read_native_total_changes(
    connection: sqlite3.Connection,
    _descriptor: Any = _CURSOR_SEAL_READ_SQLITE_CONNECTION_TOTAL_CHANGES,
) -> int:
    try:
        value = _descriptor.__get__(connection, sqlite3.Connection)
    except BaseException as error:
        raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_COUNTER") from error
    if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER:
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_COUNTER")
    return value


def _cursor_publication_seal_read_cursor_belongs(
    cursor: object,
    connection: sqlite3.Connection,
    _descriptor: Any = _CURSOR_SEAL_READ_SQLITE_CURSOR_CONNECTION,
) -> bool:
    if type(cursor) is not sqlite3.Cursor:
        return False
    try:
        return _descriptor.__get__(cursor, sqlite3.Cursor) is connection
    except BaseException:
        return False


def _cursor_publication_seal_read_key(row: object) -> tuple[str, str, bytes, bytes]:
    if type(row) is not tuple or len(row) != 2:
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_KEY_SHAPE")
    tenant_id, token_hash = row
    if (
        type(tenant_id) is not str
        or not 1 <= len(tenant_id) <= 128
        or not tenant_id[0].isascii()
        or not tenant_id[0].isalnum()
        or any(
            not character.isascii()
            or (not character.isalnum() and character not in "._-")
            for character in tenant_id
        )
        or type(token_hash) is not str
        or len(token_hash) != 64
        or any(character not in "0123456789abcdef" for character in token_hash)
    ):
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_KEY_SHAPE")
    return tenant_id, token_hash, tenant_id.encode("utf-8"), token_hash.encode("utf-8")


def _cursor_publication_seal_read_state(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: object,
    _type: Callable[[object], type] = type,
    _identity: Callable[[object], int] = id,
    _dictionary_get: Callable[..., object] = dict.get,
) -> _CursorPublicationSealReadExecutionState:
    if _type(execution) is not _SQLiteConnectionCursorPublicationSealReadExecution:
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_EXECUTION")
    current = _dictionary_get(_CURSOR_PUBLICATION_SEAL_READ_EXECUTIONS, _identity(execution))
    if (
        type(current) is not tuple
        or len(current) != 2
        or current[0]() is not execution
        or type(current[1]) is not _CursorPublicationSealReadExecutionState
        or current[1].connection is not connection
    ):
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_EXECUTION")
    return current[1]


def _cursor_publication_seal_read_snapshot(
    state: _CursorPublicationSealReadExecutionState,
) -> _SQLiteConnectionCursorPublicationSealReadSnapshot:
    return _SQLiteConnectionCursorPublicationSealReadSnapshot(
        lifecycle=state.lifecycle,
        main_key_scan_sql=state.main_key_scan_sql,
        main_key_scan_sql_sha256=state.main_key_scan_sql_sha256,
        key_driver_sql=state.key_driver_sql,
        key_driver_sql_sha256=state.key_driver_sql_sha256,
        point_lookup_sql=state.point_lookup_sql,
        point_lookup_sql_sha256=state.point_lookup_sql_sha256,
        execute_count=state.execute_count,
        release_count=state.release_count,
        main_key_prepare_count=state.main_key_prepare_count,
        main_key_row_count=state.main_key_row_count,
        main_key_terminal_fetch_count=state.main_key_terminal_fetch_count,
        main_key_close_attempt_count=state.main_key_close_attempt_count,
        main_key_close_count=state.main_key_close_count,
        driver_prepare_count=state.driver_prepare_count,
        driver_row_count=state.driver_row_count,
        driver_terminal_fetch_count=state.driver_terminal_fetch_count,
        driver_close_attempt_count=state.driver_close_attempt_count,
        driver_close_count=state.driver_close_count,
        point_statement_prepare_count=state.point_statement_prepare_count,
        point_statement_execute_count=state.point_statement_execute_count,
        point_statement_release_count=state.point_statement_release_count,
        point_cursor_created_count=state.point_cursor_created_count,
        point_cursor_close_attempt_count=state.point_cursor_close_attempt_count,
        point_cursor_closed_count=state.point_cursor_closed_count,
        lookup_row_count=state.lookup_row_count,
        accumulator_row_count=state.accumulator_row_count,
        observed_descriptor_hash=state.observed_descriptor_hash,
        observed_schema_identity_sha256=state.observed_schema_identity_sha256,
        computed_immutable_root_sha256=(
            state.computed_immutable_root_sha256
            if state.lifecycle == "completed"
            else None
        ),
        active_cursor_count=state.active_cursor_count,
        maximum_active_cursor_count=state.maximum_active_cursor_count,
        live_physical_row_count=state.live_physical_row_count,
        maximum_live_physical_row_count=state.maximum_live_physical_row_count,
        live_carrier_count=state.live_carrier_count,
        maximum_live_carrier_count=state.maximum_live_carrier_count,
        transaction_epoch=state.transaction_epoch,
        transaction_generation=state.transaction_generation,
        total_changes_before=state.total_changes_before,
        total_changes=state.total_changes,
        total_changes_delta=state.total_changes - state.total_changes_before,
    )


def _register_cursor_publication_seal_read_execution(
    execution: _SQLiteConnectionCursorPublicationSealReadExecution,
    state: _CursorPublicationSealReadExecutionState,
    _identity: Callable[[object], int] = id,
    _make_ref: Callable[..., ReferenceType[object]] = ref,
    _dictionary_get: Callable[..., object] = dict.get,
    _dictionary_set: Callable[..., None] = dict.__setitem__,
    _dictionary_pop: Callable[..., object] = dict.pop,
    _cursor_close: Callable[[sqlite3.Cursor], None] = _CURSOR_SEAL_READ_SQLITE_CURSOR_CLOSE,
) -> None:
    execution_id = _identity(execution)

    def discard(dead: ReferenceType[object]) -> None:
        current = _dictionary_get(_CURSOR_PUBLICATION_SEAL_READ_EXECUTIONS, execution_id)
        if type(current) is tuple and len(current) == 2 and current[0] is dead:
            current_state = current[1]
            for attribute in ("point_cursor", "driver_cursor", "main_cursor"):
                cursor = getattr(current_state, attribute)
                if cursor is not None:
                    with suppress(BaseException):
                        _cursor_close(cursor)
                    setattr(current_state, attribute, None)
            current_state.active_cursor_count = 0
            current_state.live_physical_row_count = 0
            current_state.live_carrier_count = 0
            _dictionary_pop(_CURSOR_PUBLICATION_SEAL_READ_EXECUTIONS, execution_id, None)

    execution_ref = _make_ref(execution, discard)
    _dictionary_set(
        _CURSOR_PUBLICATION_SEAL_READ_EXECUTIONS,
        execution_id,
        (execution_ref, state),
    )


@dataclass(slots=True)
class _CursorSealReadPointStatementOwner:
    """One real reusable fixed-SQL point statement bound to one connection."""

    state: _CursorPublicationSealReadExecutionState
    connection: sqlite3.Connection
    sql: str
    cursor_factory: Callable[[sqlite3.Connection], sqlite3.Cursor]
    cursor_execute: Callable[..., sqlite3.Cursor]
    cursor_belongs: Callable[[object, sqlite3.Connection], bool]
    recovery_cursor_close: Callable[[sqlite3.Cursor], None]
    execute_count: int = 0
    release_count: Literal[0, 1] = 0
    active_cursor: sqlite3.Cursor | None = None

    def execute(
        self,
        tenant_id: str,
        token_hash: str,
        _point_sql: str = SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_INTRINSIC,
        _point_sql_sha256: str = (
            SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_SHA256_INTRINSIC
        ),
    ) -> sqlite3.Cursor:
        if (
            self.release_count != 0
            or self.active_cursor is not None
            or self.state.lifecycle != "running"
            or self.sql != _point_sql
            or self.state.point_lookup_sql != _point_sql
            or self.state.point_lookup_sql_sha256 != _point_sql_sha256
        ):
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_EXECUTE"
            )
        try:
            cursor = self.cursor_factory(self.connection)
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_PREPARE") from error
        if not self.cursor_belongs(cursor, self.connection):
            with suppress(BaseException):
                self.recovery_cursor_close(cursor)
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_PREPARE"
            )
        self.active_cursor = cursor
        self.state.point_cursor = cursor
        self.state.point_cursor_created_count += 1
        self.state.active_cursor_count += 1
        self.state.maximum_active_cursor_count = max(
            self.state.maximum_active_cursor_count,
            self.state.active_cursor_count,
        )
        if self.state.active_cursor_count > 2:
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_READ_CURSOR_BUDGET"
            )
        self.execute_count += 1
        self.state.point_statement_execute_count = self.execute_count
        try:
            result = self.cursor_execute(cursor, _point_sql, (tenant_id, token_hash))
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_EXECUTE") from error
        if result is not cursor:
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_EXECUTE"
            )
        return cursor

    def release(self) -> None:
        if self.release_count != 0 or self.active_cursor is not None:
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_RELEASE"
            )
        self.release_count = 1
        self.state.point_statement_release_count = 1


class SQLiteV1BaselineConnectionOwner:
    """Exclusive connection capability with separate lineage and mutation epoch."""

    __slots__ = (
        "__connection",
        "__location",
        "__publication_transaction_closed",
        "__publication_transaction_guard",
        "__publication_transaction_lineage",
        "__publication_transaction_owner_ref",
        "__temp_mutation_epoch",
        "__transaction_epoch",
        "__transaction_generation",
        "__transaction_mode",
        "__weakref__",
    )

    def __init__(self, location: str) -> None:
        if type(location) is not str or not location:
            raise TypeError("baseline owner requires one SQLite location")
        # Freeze a filesystem authority before the first native open.  A
        # relative spelling must never be re-resolved against a later cwd when
        # the guarded publication transaction closes and reopens its source.
        pinned_location = location if location == ":memory:" else _ABSOLUTE_PATH(location)
        self.__connection = sqlite3.connect(pinned_location)
        self.__location = pinned_location
        self.__publication_transaction_closed = False
        self.__publication_transaction_guard: Callable[[str, str | None], None] | None = None
        self.__publication_transaction_lineage: object | None = None
        self.__publication_transaction_owner_ref: ReferenceType[object] | None = None
        self.__transaction_epoch = 0
        self.__temp_mutation_epoch = 0
        self.__transaction_generation: object | None = None
        self.__transaction_mode: SQLiteTransactionMode | None = None
        owner_ref = ref(self)

        def trace_temp_mutation(sql: str) -> None:
            owner = owner_ref()
            if owner is not None and _temp_mutation_epoch_advancing_sql(sql):
                owner.__temp_mutation_epoch += 1

        _SQLITE_CONNECTION_SET_TRACE_CALLBACK(self.__connection, trace_temp_mutation)

    @property
    def in_transaction(self) -> bool:
        return self.__connection.in_transaction

    @property
    def total_changes(self) -> int:
        return self.__connection.total_changes

    @property
    def transaction_epoch(self) -> int:
        return self.__transaction_epoch

    @property
    def temp_mutation_epoch(self) -> int:
        return self.__temp_mutation_epoch

    @property
    def _transaction_generation(self) -> object | None:
        """Return the exact private identity of the active transaction lineage."""

        return self.__transaction_generation if self.__connection.in_transaction else None

    @property
    def transaction_mode(self) -> SQLiteTransactionMode | None:
        """Return the conservatively observed mode of the active transaction."""

        return self.__transaction_mode if self.__connection.in_transaction else None

    @property
    def in_exclusive_transaction(self) -> bool:
        """Whether the owner can prove that its current transaction is EXCLUSIVE."""

        return self.__connection.in_transaction and self.__transaction_mode == "exclusive"

    def execute(
        self,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        self.__assert_publication_transaction_guard("execute", sql)
        if _forbidden_temp_store_directory(sql):
            raise ValueError("SQLite temp_store_directory is forbidden")
        before = self.__connection.in_transaction
        token = _first_sqlite_token(sql)
        cursor = self.__connection.execute(sql, parameters)
        after = self.__connection.in_transaction
        if not before and after:
            self.__transaction_generation = object()
        elif not after:
            self.__transaction_generation = None
        if not after:
            self.__transaction_mode = None
        elif not before:
            self.__transaction_mode = (
                _begin_transaction_mode(sql) if token == "BEGIN" else "deferred"
            )
        elif self.__transaction_mode is None:
            self.__transaction_mode = "unknown"
        if token in _EPOCH_MUTATING_TOKENS or before != after:
            self.__transaction_epoch += 1
        return _SQLiteCursorCapability(cursor)

    def _prepare_cursor_publication_rebind(
        self,
        _native_in_transaction: Callable[[sqlite3.Connection], bool] = (
            _cursor_publication_rebind_native_in_transaction
        ),
        _native_total_changes: Callable[[sqlite3.Connection], int] = (
            _cursor_publication_rebind_native_total_changes
        ),
        _cursor_factory: Callable[[sqlite3.Connection], sqlite3.Cursor] = (
            _CURSOR_REBIND_SQLITE_CONNECTION_CURSOR
        ),
        _register: Callable[
            [
                _SQLiteConnectionCursorPublicationRebindExecution,
                _CursorPublicationRebindExecutionState,
            ],
            None,
        ] = _register_cursor_publication_rebind_execution,
        _cursor_belongs: Callable[[object, sqlite3.Connection], bool] = (
            _cursor_publication_rebind_cursor_belongs
        ),
        _cursor_close: Callable[[sqlite3.Cursor], None] = (
            _CURSOR_REBIND_SQLITE_CURSOR_CLOSE
        ),
        _digest: Callable[..., object] = hashlib.sha256,
        _rebind_sql: str = SQLITE_CURSOR_PUBLICATION_REBIND_SQL_INTRINSIC,
        _rebind_sql_sha256: str = SQLITE_CURSOR_PUBLICATION_REBIND_SQL_SHA256_INTRINSIC,
        _parameter_order: tuple[str, str, str, str] = (
            SQLITE_CURSOR_PUBLICATION_REBIND_PARAMETER_ORDER_INTRINSIC
        ),
        _changes_sql: str = SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_INTRINSIC,
        _changes_sql_sha256: str = SQLITE_CURSOR_PUBLICATION_CHANGES_SQL_SHA256_INTRINSIC,
    ) -> _SQLiteConnectionCursorPublicationRebindExecution:
        """Allocate one native cursor and bind it to the frozen rebind statement."""

        generation = self.__transaction_generation
        if (
            not _native_in_transaction(self.__connection)
            or self.__transaction_mode != "exclusive"
            or generation is None
            or type(self.__transaction_epoch) is not int
            or self.__transaction_epoch < 0
        ):
            _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_LINEAGE")
        if (
            _rebind_sql
            != "UPDATE main.ge_cycle_cursors SET descriptor_hash = ?, "
            "schema_identity_sha256 = ? WHERE descriptor_hash = ? "
            "AND schema_identity_sha256 = ?"
            or cast(Any, _digest)(_rebind_sql.encode("utf-8")).hexdigest()
            != _rebind_sql_sha256
            or _rebind_sql_sha256
            != "6fc61b515e758a1e84745af28783f4e9dcee5e76f80f314aa25a08980d2fef91"
            or _parameter_order
            != (
                "targetDescriptorHash",
                "targetSchemaIdentitySha256",
                "sourceDescriptorHash",
                "sourceSchemaIdentitySha256",
            )
            or _changes_sql != "SELECT changes() AS affected_rows"
            or cast(Any, _digest)(_changes_sql.encode("utf-8")).hexdigest()
            != _changes_sql_sha256
            or _changes_sql_sha256
            != "a6ab435eb54879f942436129997f231de19504b11028b55b014fddc2bb42e112"
        ):
            _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_SQL_IDENTITY")
        total_changes = _native_total_changes(self.__connection)
        try:
            cursor = _cursor_factory(self.__connection)
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_CURSOR_REBIND_PREPARE") from error
        if not _cursor_belongs(cursor, self.__connection):
            with suppress(BaseException):
                _cursor_close(cursor)
            _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_PREPARE")
        execution = _SQLiteConnectionCursorPublicationRebindExecution(
            _CURSOR_PUBLICATION_REBIND_CONSTRUCTION_TOKEN
        )
        state = _CursorPublicationRebindExecutionState(
            connection=self,
            cursor=cursor,
            rebind_sql=_rebind_sql,
            rebind_sql_sha256=_rebind_sql_sha256,
            parameter_order=_parameter_order,
            changes_sql=_changes_sql,
            changes_sql_sha256=_changes_sql_sha256,
            transaction_generation=generation,
            transaction_epoch_before=self.__transaction_epoch,
            transaction_epoch=self.__transaction_epoch,
            total_changes_before=total_changes,
            total_changes=total_changes,
        )
        try:
            _register(execution, state)
        except BaseException:
            with suppress(BaseException):
                _cursor_close(cursor)
            raise
        return execution

    def _execute_cursor_publication_rebind(
        self,
        execution: _SQLiteConnectionCursorPublicationRebindExecution,
        target_descriptor_hash: object,
        target_schema_identity_sha256: object,
        source_descriptor_hash: object,
        source_schema_identity_sha256: object,
        _state_for: Callable[..., _CursorPublicationRebindExecutionState] = (
            _cursor_publication_rebind_state
        ),
        _validate_hash: Callable[[object], str] = _cursor_publication_rebind_hash,
        _native_in_transaction: Callable[[sqlite3.Connection], bool] = (
            _cursor_publication_rebind_native_in_transaction
        ),
        _native_total_changes: Callable[[sqlite3.Connection], int] = (
            _cursor_publication_rebind_native_total_changes
        ),
        _cursor_execute: Callable[..., sqlite3.Cursor] = _CURSOR_REBIND_SQLITE_CURSOR_EXECUTE,
        _rowcount_descriptor: Any = _CURSOR_REBIND_SQLITE_CURSOR_ROWCOUNT,
        _cursor_belongs: Callable[[object, sqlite3.Connection], bool] = (
            _cursor_publication_rebind_cursor_belongs
        ),
        _recovery_total_changes: Callable[[sqlite3.Connection], int] = (
            _cursor_publication_rebind_native_total_changes
        ),
    ) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
        """Execute the four exact parameters once; retain cursor ownership for release."""

        state = _state_for(self, execution)
        parameters = (
            _validate_hash(target_descriptor_hash),
            _validate_hash(target_schema_identity_sha256),
            _validate_hash(source_descriptor_hash),
            _validate_hash(source_schema_identity_sha256),
        )
        if parameters[:2] == parameters[2:]:
            state.lifecycle = "poisoned"
            _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_PARAMETERS")
        if state.cursor is None or not _cursor_belongs(
            state.cursor, self.__connection
        ):
            state.lifecycle = "poisoned"
            _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_EXECUTION")
        if (
            state.lifecycle != "prepared"
            or state.execute_count != 0
            or state.release_count != 0
            or state.cursor is None
            or not _native_in_transaction(self.__connection)
            or self.__transaction_mode != "exclusive"
            or self.__transaction_generation is not state.transaction_generation
            or self.__transaction_epoch != state.transaction_epoch_before
            or _native_total_changes(self.__connection) != state.total_changes_before
        ):
            state.lifecycle = "poisoned"
            _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_LINEAGE")
        state.parameters = parameters
        state.execute_count = 1
        try:
            _cursor_execute(
                state.cursor,
                state.rebind_sql,
                parameters,
            )
        except BaseException as error:
            state.lifecycle = "poisoned"
            raise ValueError("GE_CURSOR_B3_CURSOR_REBIND_EXECUTE") from error

        # Bypass of the public convenience execute path is intentional, so its
        # mutation epoch must be advanced immediately after native success.
        self.__transaction_epoch += 1
        state.transaction_epoch = self.__transaction_epoch
        state.lifecycle = "executed"
        state.cursor_ledger_logical_write_sequence = 1
        state.cursor_ledger_fixed_statement_count = 1

        def record_affected_rows(affected_rows: object) -> None:
            if (
                type(affected_rows) is not int
                or not 0 <= affected_rows <= MAX_SAFE_INTEGER
            ):
                _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_AFFECTED")
            state.affected_rows = affected_rows
            state.cursor_ledger_affected_rows_watermark = affected_rows

        def record_total_changes(total_changes: object) -> None:
            if (
                type(total_changes) is not int
                or not state.total_changes_before <= total_changes <= MAX_SAFE_INTEGER
            ):
                _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_COUNTER")
            state.total_changes = total_changes

        try:
            try:
                affected_value = _rowcount_descriptor.__get__(
                    state.cursor, sqlite3.Cursor
                )
            except BaseException as error:
                raise ValueError(
                    "GE_CURSOR_B3_CURSOR_REBIND_AFFECTED"
                ) from error
            record_affected_rows(affected_value)
            total_changes = _native_total_changes(self.__connection)
            record_total_changes(total_changes)
            return _cursor_publication_rebind_snapshot(state)
        except BaseException as primary:
            state.lifecycle = "poisoned"
            if state.affected_rows is None and state.cursor is not None:
                with suppress(BaseException):
                    record_affected_rows(
                        _CURSOR_REBIND_SQLITE_CURSOR_ROWCOUNT.__get__(
                            state.cursor, sqlite3.Cursor
                        )
                    )
            if state.affected_rows is None:
                state.cursor_ledger_affected_rows_watermark = 0
            with suppress(BaseException):
                record_total_changes(_recovery_total_changes(self.__connection))
            raise primary

    def _release_cursor_publication_rebind(
        self,
        execution: _SQLiteConnectionCursorPublicationRebindExecution,
        _state_for: Callable[..., _CursorPublicationRebindExecutionState] = (
            _cursor_publication_rebind_state
        ),
        _cursor_close: Callable[[sqlite3.Cursor], None] = _CURSOR_REBIND_SQLITE_CURSOR_CLOSE,
        _cursor_belongs: Callable[[object, sqlite3.Connection], bool] = (
            _cursor_publication_rebind_cursor_belongs
        ),
    ) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
        """Retire the native rebind cursor exactly once, including cancellation cleanup."""

        state = _state_for(self, execution)
        cursor = state.cursor
        if (
            state.release_count != 0
            or cursor is None
            or not _cursor_belongs(cursor, self.__connection)
            or state.lifecycle not in {"prepared", "executed", "poisoned"}
        ):
            state.lifecycle = "poisoned"
            _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_RELEASE")
        try:
            injected_primary = _take_cursor_publication_rebind_release_fault_exact(
                self, execution
            )
        except BaseException as primary:
            state.release_count = 1
            state.cursor = None
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                _cursor_close(cursor)
            raise primary
        state.release_count = 1
        state.cursor = None
        previous = state.lifecycle
        try:
            _cursor_close(cursor)
        except BaseException as error:
            state.lifecycle = "poisoned"
            if injected_primary is not None:
                raise injected_primary from None
            raise ValueError("GE_CURSOR_B3_CURSOR_REBIND_RELEASE") from error
        if injected_primary is not None:
            state.lifecycle = "poisoned"
            raise injected_primary
        if previous in {"prepared", "executed"}:
            state.lifecycle = "released"
        return _cursor_publication_rebind_snapshot(state)

    def _prove_cursor_publication_rebind_changes(
        self,
        execution: _SQLiteConnectionCursorPublicationRebindExecution,
        _state_for: Callable[..., _CursorPublicationRebindExecutionState] = (
            _cursor_publication_rebind_state
        ),
        _native_in_transaction: Callable[[sqlite3.Connection], bool] = (
            _cursor_publication_rebind_native_in_transaction
        ),
        _native_total_changes: Callable[[sqlite3.Connection], int] = (
            _cursor_publication_rebind_native_total_changes
        ),
        _cursor_factory: Callable[[sqlite3.Connection], sqlite3.Cursor] = (
            _CURSOR_REBIND_SQLITE_CONNECTION_CURSOR
        ),
        _cursor_execute: Callable[..., sqlite3.Cursor] = _CURSOR_REBIND_SQLITE_CURSOR_EXECUTE,
        _cursor_fetchmany: Callable[[sqlite3.Cursor, int], object] = (
            _CURSOR_REBIND_SQLITE_CURSOR_FETCHMANY
        ),
        _cursor_close: Callable[[sqlite3.Cursor], None] = _CURSOR_REBIND_SQLITE_CURSOR_CLOSE,
        _cursor_belongs: Callable[[object, sqlite3.Connection], bool] = (
            _cursor_publication_rebind_cursor_belongs
        ),
    ) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
        """Boundedly fetch the only changes() row, close once, and finalize."""

        state = _state_for(self, execution)
        try:
            lineage_valid = (
                state.lifecycle == "released"
                and state.execute_count == 1
                and state.release_count == 1
                and state.affected_rows is not None
                and state.changes_prepare_count == 0
                and state.changes_fetch_count == 0
                and state.changes_release_count == 0
                and _native_in_transaction(self.__connection)
                and self.__transaction_mode == "exclusive"
                and self.__transaction_generation is state.transaction_generation
                and self.__transaction_epoch == state.transaction_epoch
                and _native_total_changes(self.__connection) == state.total_changes
            )
        except BaseException as error:
            state.lifecycle = "poisoned"
            _record_cursor_publication_rebind_changes_primary_exact(
                state, error, "serialized-changes-pre-query"
            )
            raise
        if not lineage_valid:
            state.lifecycle = "poisoned"
            lineage_error = ValueError("GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE")
            _record_cursor_publication_rebind_changes_primary_exact(
                state, lineage_error, "serialized-changes-pre-query"
            )
            raise lineage_error
        try:
            changes_cursor = _cursor_factory(self.__connection)
        except BaseException as error:
            state.lifecycle = "poisoned"
            prepare_error = ValueError("GE_CURSOR_B3_CURSOR_CHANGES_PREPARE")
            _record_cursor_publication_rebind_changes_primary_exact(
                state, prepare_error, "serialized-changes-prepare"
            )
            raise prepare_error from error
        if not _cursor_belongs(changes_cursor, self.__connection):
            with suppress(BaseException):
                _cursor_close(changes_cursor)
            state.lifecycle = "poisoned"
            prepare_error = ValueError("GE_CURSOR_B3_CURSOR_CHANGES_PREPARE")
            _record_cursor_publication_rebind_changes_primary_exact(
                state, prepare_error, "serialized-changes-prepare"
            )
            raise prepare_error
        state.changes_prepare_count = 1

        primary: BaseException | None = None
        rows: object = None
        try:
            _cursor_execute(changes_cursor, state.changes_sql, ())
            state.changes_fetch_count = 1
            rows = _cursor_fetchmany(changes_cursor, 2)
            if type(rows) is not list or len(rows) != 1:
                _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_SHAPE")
            row = rows[0]
            if type(row) is not tuple or len(row) != 1 or type(row[0]) is not int:
                _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_SHAPE")
            value = row[0]
            if not 0 <= value <= MAX_SAFE_INTEGER or value != state.affected_rows:
                _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_CHANGES_VALUE")
            state.changes_affected_rows = value
        except BaseException as error:
            primary = error
        state.changes_release_count = 1
        close_error: BaseException | None = None
        try:
            _cursor_close(changes_cursor)
        except BaseException as error:
            close_error = error
        if primary is not None:
            state.lifecycle = "poisoned"
            _record_cursor_publication_rebind_changes_primary_exact(
                state,
                primary,
                "serialized-changes-execute"
                if state.changes_fetch_count == 0
                else "serialized-changes-fetch",
            )
            raise primary
        if close_error is not None:
            state.lifecycle = "poisoned"
            primary = ValueError("GE_CURSOR_B3_CURSOR_CHANGES_RELEASE")
            _record_cursor_publication_rebind_changes_primary_exact(
                state, primary, "serialized-changes-release"
            )
            raise primary from close_error
        try:
            current_total = _native_total_changes(self.__connection)
        except BaseException as error:
            state.lifecycle = "poisoned"
            _record_cursor_publication_rebind_changes_primary_exact(
                state, error, "serialized-changes-post-query"
            )
            raise
        if (
            current_total != state.total_changes
            or current_total - state.total_changes_before != state.affected_rows
            or self.__transaction_epoch != state.transaction_epoch
            or self.__transaction_generation is not state.transaction_generation
        ):
            state.lifecycle = "poisoned"
            primary = ValueError("GE_CURSOR_B3_CURSOR_CHANGES_LINEAGE")
            _record_cursor_publication_rebind_changes_primary_exact(
                state, primary, "serialized-changes-post-query"
            )
            raise primary
        state.lifecycle = "completed"
        return _cursor_publication_rebind_snapshot(state)

    def _read_cursor_publication_rebind_snapshot(
        self,
        execution: _SQLiteConnectionCursorPublicationRebindExecution,
        _state_for: Callable[..., _CursorPublicationRebindExecutionState] = (
            _cursor_publication_rebind_state
        ),
    ) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
        return _cursor_publication_rebind_snapshot(_state_for(self, execution))

    def _begin_cursor_publication_seal_read(
        self,
        rebind_execution: _SQLiteConnectionCursorPublicationRebindExecution,
        _rebind_state_for: Callable[..., _CursorPublicationRebindExecutionState] = (
            _cursor_publication_rebind_state
        ),
        _native_in_transaction: Callable[[sqlite3.Connection], bool] = (
            _cursor_publication_seal_read_native_in_transaction
        ),
        _native_total_changes: Callable[[sqlite3.Connection], int] = (
            _cursor_publication_seal_read_native_total_changes
        ),
        _register: Callable[
            [
                _SQLiteConnectionCursorPublicationSealReadExecution,
                _CursorPublicationSealReadExecutionState,
            ],
            None,
        ] = _register_cursor_publication_seal_read_execution,
        _digest: Callable[..., object] = hashlib.sha256,
        _main_sql: str = SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_INTRINSIC,
        _main_sha256: str = (
            SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_SHA256_INTRINSIC
        ),
        _driver_sql: str = SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_INTRINSIC,
        _driver_sha256: str = (
            SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_SHA256_INTRINSIC
        ),
        _point_sql: str = SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_INTRINSIC,
        _point_sha256: str = (
            SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_SHA256_INTRINSIC
        ),
    ) -> _SQLiteConnectionCursorPublicationSealReadExecution:
        """Bind raw seal observation to one exact completed rebind proof."""

        rebind_state = _rebind_state_for(self, rebind_execution)
        if (
            rebind_state.lifecycle != "completed"
            or rebind_state.cursor is not None
            or rebind_state.execute_count != 1
            or rebind_state.release_count != 1
            or rebind_state.changes_prepare_count != 1
            or rebind_state.changes_fetch_count != 1
            or rebind_state.changes_release_count != 1
            or rebind_state.affected_rows is None
            or rebind_state.changes_affected_rows != rebind_state.affected_rows
            or rebind_state.seal_read_begin_count != 0
            or not _native_in_transaction(self.__connection)
            or self.__transaction_mode != "exclusive"
            or self.__transaction_generation is not rebind_state.transaction_generation
            or self.__transaction_epoch != rebind_state.transaction_epoch
        ):
            _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_LINEAGE")
        total_changes = _native_total_changes(self.__connection)
        if total_changes != rebind_state.total_changes:
            _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_LINEAGE")
        exact_sql = (
            (
                _main_sql,
                _main_sha256,
                "SELECT tenant_id, token_hash FROM main.ge_cycle_cursors "
                "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY",
                "09d1ce669070093fbbf0dfd8ce7e2a7bbfde96d051b3ce9341be85495479ec32",
            ),
            (
                _driver_sql,
                _driver_sha256,
                "SELECT tenant_id, token_hash FROM temp.ge_blr_cursor_seal "
                "ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
                "1694ab6fe938203b0d8f6cb72cf82238e89234c21086ff5d224c7de4db7b1266",
            ),
            (
                _point_sql,
                _point_sha256,
                "SELECT tenant_id, token_hash, kind, principal_hash, "
                "authorization_hash, stream_id, checkpoint_scope, request_scope_blob, "
                "page_size, next_position, snapshot_tail_sequence, "
                "snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256, "
                "snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms FROM "
                "main.ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ? LIMIT 1",
                "bd056ee55f2bd27eee3277ed7bfee8ae7b7db935edc3cf0937fc8167e2eac342",
            ),
        )
        for sql, digest, literal, expected_digest in exact_sql:
            try:
                actual_digest = cast(Any, _digest)(sql.encode("utf-8")).hexdigest()
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_SQL_IDENTITY") from error
            if sql != literal or digest != expected_digest or actual_digest != digest:
                _cursor_publication_seal_read_fail(
                    "GE_CURSOR_B3_CURSOR_SEAL_READ_SQL_IDENTITY"
                )
        execution = _SQLiteConnectionCursorPublicationSealReadExecution(
            _CURSOR_PUBLICATION_SEAL_READ_CONSTRUCTION_TOKEN
        )
        state = _CursorPublicationSealReadExecutionState(
            connection=self,
            rebind_execution=rebind_execution,
            main_key_scan_sql=_main_sql,
            main_key_scan_sql_sha256=_main_sha256,
            key_driver_sql=_driver_sql,
            key_driver_sql_sha256=_driver_sha256,
            point_lookup_sql=_point_sql,
            point_lookup_sql_sha256=_point_sha256,
            transaction_generation=rebind_state.transaction_generation,
            transaction_epoch=rebind_state.transaction_epoch,
            total_changes_before=total_changes,
            total_changes=total_changes,
        )
        _register(execution, state)
        rebind_state.seal_read_begin_count = 1
        return execution

    def _execute_cursor_publication_seal_read(
        self,
        execution: _SQLiteConnectionCursorPublicationSealReadExecution,
        expected_cursor_count: int | None = None,
        after_point_close: Callable[[], None] | None = None,
        _state_for: Callable[..., _CursorPublicationSealReadExecutionState] = (
            _cursor_publication_seal_read_state
        ),
        _native_in_transaction: Callable[[sqlite3.Connection], bool] = (
            _cursor_publication_seal_read_native_in_transaction
        ),
        _native_total_changes: Callable[[sqlite3.Connection], int] = (
            _cursor_publication_seal_read_native_total_changes
        ),
        _cursor_factory: Callable[[sqlite3.Connection], sqlite3.Cursor] = (
            _CURSOR_SEAL_READ_SQLITE_CONNECTION_CURSOR
        ),
        _cursor_execute: Callable[..., sqlite3.Cursor] = (
            _CURSOR_SEAL_READ_SQLITE_CURSOR_EXECUTE
        ),
        _cursor_fetchone: Callable[[sqlite3.Cursor], object] = (
            _CURSOR_SEAL_READ_SQLITE_CURSOR_FETCHONE
        ),
        _cursor_close: Callable[[sqlite3.Cursor], None] = (
            _CURSOR_SEAL_READ_SQLITE_CURSOR_CLOSE
        ),
        _recovery_cursor_close: Callable[[sqlite3.Cursor], None] = (
            _CURSOR_SEAL_READ_SQLITE_CURSOR_CLOSE
        ),
        _cursor_belongs: Callable[[object, sqlite3.Connection], bool] = (
            _cursor_publication_seal_read_cursor_belongs
        ),
        _decode_row: Callable[[object], SQLiteCursorSealRow] = _CURSOR_SEAL_READ_DECODE_ROW,
        _accumulator_type: Callable[..., object] = _CURSOR_SEAL_READ_ACCUMULATOR,
        _main_sql: str = SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_INTRINSIC,
        _main_sql_sha256: str = (
            SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_SHA256_INTRINSIC
        ),
        _driver_sql: str = SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_INTRINSIC,
        _driver_sql_sha256: str = (
            SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_SHA256_INTRINSIC
        ),
        _point_sql: str = SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_INTRINSIC,
        _point_sql_sha256: str = (
            SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_SHA256_INTRINSIC
        ),
    ) -> _SQLiteConnectionCursorPublicationSealReadSnapshot:
        """Compute raw bounded seal evidence without accepting Rule 12."""

        state = _state_for(self, execution)
        if (
            expected_cursor_count is not None
            and (
                type(expected_cursor_count) is not int
                or not 0 <= expected_cursor_count <= MAX_SAFE_INTEGER
            )
        ):
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_READ_EXPECTED_COUNT"
            )
        if after_point_close is not None and not callable(after_point_close):
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_READ_CANCELLATION"
            )

        def prove_lineage() -> None:
            current_total = _native_total_changes(self.__connection)
            state.total_changes = current_total
            if (
                not _native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is not state.transaction_generation
                or self.__transaction_epoch != state.transaction_epoch
                or current_total != state.total_changes_before
            ):
                _cursor_publication_seal_read_fail(
                    "GE_CURSOR_B3_CURSOR_SEAL_READ_LINEAGE"
                )

        def opened(cursor: sqlite3.Cursor, attribute: str) -> None:
            setattr(state, attribute, cursor)
            state.active_cursor_count += 1
            state.maximum_active_cursor_count = max(
                state.maximum_active_cursor_count,
                state.active_cursor_count,
            )
            if state.active_cursor_count > 2:
                _cursor_publication_seal_read_fail(
                    "GE_CURSOR_B3_CURSOR_SEAL_READ_CURSOR_BUDGET"
                )

        def prepare_cursor(attribute: str, code: str) -> sqlite3.Cursor:
            try:
                cursor = _cursor_factory(self.__connection)
            except BaseException as error:
                raise ValueError(code) from error
            if not _cursor_belongs(cursor, self.__connection):
                with suppress(BaseException):
                    _recovery_cursor_close(cursor)
                _cursor_publication_seal_read_fail(code)
            opened(cursor, attribute)
            return cursor

        def execute_sql(
            cursor: sqlite3.Cursor,
            sql: str,
            parameters: tuple[object, ...],
            code: str,
        ) -> None:
            try:
                result = _cursor_execute(cursor, sql, parameters)
            except BaseException as error:
                raise ValueError(code) from error
            if result is not cursor:
                _cursor_publication_seal_read_fail(code)

        def fetch_one(cursor: sqlite3.Cursor, code: str) -> object:
            try:
                return _cursor_fetchone(cursor)
            except BaseException as error:
                raise ValueError(code) from error

        def close_cursor(
            attribute: str,
            attempt_counter: str,
            success_counter: str,
            code: str,
        ) -> None:
            cursor = cast(sqlite3.Cursor | None, getattr(state, attribute))
            if cursor is None or getattr(state, success_counter) != 0:
                _cursor_publication_seal_read_fail(code)
            setattr(state, attempt_counter, getattr(state, attempt_counter) + 1)
            try:
                _cursor_close(cursor)
            except BaseException as error:
                raise ValueError(code) from error
            setattr(state, success_counter, 1)
            setattr(state, attribute, None)
            state.active_cursor_count -= 1

        def close_point(code: str) -> None:
            cursor = state.point_cursor
            if cursor is None:
                _cursor_publication_seal_read_fail(code)
            state.point_cursor_close_attempt_count += 1
            try:
                _cursor_close(cursor)
            except BaseException as error:
                raise ValueError(code) from error
            state.point_cursor_closed_count += 1
            state.point_cursor = None
            if state.point_statement_owner is not None:
                state.point_statement_owner.active_cursor = None
            state.active_cursor_count -= 1

        def recover_cursor(attribute: str) -> None:
            cursor = cast(sqlite3.Cursor | None, getattr(state, attribute))
            if cursor is not None:
                if attribute == "point_cursor":
                    state.point_cursor_close_attempt_count += 1
                elif attribute == "driver_cursor":
                    state.driver_close_attempt_count += 1
                elif attribute == "main_cursor":
                    state.main_key_close_attempt_count += 1
                try:
                    _recovery_cursor_close(cursor)
                except BaseException:
                    return
                else:
                    if attribute == "point_cursor":
                        state.point_cursor_closed_count += 1
                        if state.point_statement_owner is not None:
                            state.point_statement_owner.active_cursor = None
                    elif attribute == "driver_cursor":
                        state.driver_close_count = 1
                    elif attribute == "main_cursor":
                        state.main_key_close_count = 1
                    setattr(state, attribute, None)
                    if state.active_cursor_count > 0:
                        state.active_cursor_count -= 1

        try:
            if (
                state.lifecycle != "prepared"
                or state.execute_count != 0
                or state.main_key_scan_sql != _main_sql
                or state.main_key_scan_sql_sha256 != _main_sql_sha256
                or state.key_driver_sql != _driver_sql
                or state.key_driver_sql_sha256 != _driver_sql_sha256
                or state.point_lookup_sql != _point_sql
                or state.point_lookup_sql_sha256 != _point_sql_sha256
            ):
                _cursor_publication_seal_read_fail(
                    "GE_CURSOR_B3_CURSOR_SEAL_READ_EXECUTION"
                )
            prove_lineage()
            state.lifecycle = "running"
            state.execute_count = 1

            main_cursor = prepare_cursor(
                "main_cursor", "GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_PREPARE"
            )
            state.main_key_prepare_count = 1
            execute_sql(
                main_cursor,
                _main_sql,
                (),
                "GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_PREPARE",
            )
            previous_main_key: tuple[bytes, bytes] | None = None
            while True:
                row = fetch_one(main_cursor, "GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_FETCH")
                if row is None:
                    state.main_key_terminal_fetch_count = 1
                    break
                state.live_physical_row_count = 1
                state.maximum_live_physical_row_count = max(
                    state.maximum_live_physical_row_count, 1
                )
                try:
                    _tenant, _token, tenant_bytes, token_bytes = (
                        _cursor_publication_seal_read_key(row)
                    )
                    current_main_key = (tenant_bytes, token_bytes)
                    if previous_main_key is not None and current_main_key <= previous_main_key:
                        _cursor_publication_seal_read_fail(
                            "GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_ORDER"
                        )
                    previous_main_key = current_main_key
                    if state.main_key_row_count >= MAX_SAFE_INTEGER:
                        _cursor_publication_seal_read_fail(
                            "GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_COUNT"
                        )
                    state.main_key_row_count += 1
                finally:
                    state.live_physical_row_count = 0
                    del row
            close_cursor(
                "main_cursor",
                "main_key_close_attempt_count",
                "main_key_close_count",
                "GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_CLOSE",
            )
            prove_lineage()
            if (
                expected_cursor_count is not None
                and state.main_key_row_count != expected_cursor_count
            ):
                _cursor_publication_seal_read_fail(
                    "GE_CURSOR_B3_CURSOR_SEAL_READ_MAIN_COUNT"
                )

            driver_cursor = prepare_cursor(
                "driver_cursor", "GE_CURSOR_B3_CURSOR_SEAL_READ_DRIVER_PREPARE"
            )
            state.driver_prepare_count = 1
            execute_sql(
                driver_cursor,
                _driver_sql,
                (),
                "GE_CURSOR_B3_CURSOR_SEAL_READ_DRIVER_PREPARE",
            )
            point_statement_owner = _CursorSealReadPointStatementOwner(
                state=state,
                connection=self.__connection,
                sql=_point_sql,
                cursor_factory=_cursor_factory,
                cursor_execute=_cursor_execute,
                cursor_belongs=_cursor_belongs,
                recovery_cursor_close=_recovery_cursor_close,
            )
            state.point_statement_owner = point_statement_owner
            state.point_statement_prepare_count = 1
            previous_driver_key: tuple[bytes, bytes] | None = None
            accumulator: object | None = None
            while True:
                driver_row = fetch_one(
                    driver_cursor, "GE_CURSOR_B3_CURSOR_SEAL_READ_DRIVER_FETCH"
                )
                if driver_row is None:
                    state.driver_terminal_fetch_count = 1
                    break
                state.live_physical_row_count = 1
                state.maximum_live_physical_row_count = max(
                    state.maximum_live_physical_row_count, 1
                )
                try:
                    tenant, token, tenant_bytes, token_bytes = (
                        _cursor_publication_seal_read_key(driver_row)
                    )
                    current_driver_key = (token_bytes, tenant_bytes)
                    if (
                        previous_driver_key is not None
                        and current_driver_key <= previous_driver_key
                    ):
                        _cursor_publication_seal_read_fail(
                            "GE_CURSOR_B3_CURSOR_SEAL_READ_DRIVER_ORDER"
                        )
                    previous_driver_key = current_driver_key
                    if state.driver_row_count >= MAX_SAFE_INTEGER:
                        _cursor_publication_seal_read_fail(
                            "GE_CURSOR_B3_CURSOR_SEAL_READ_DRIVER_COUNT"
                        )
                    state.driver_row_count += 1
                finally:
                    state.live_physical_row_count = 0
                    del driver_row

                point_cursor = point_statement_owner.execute(tenant, token)
                physical_row = fetch_one(
                    point_cursor, "GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_FETCH"
                )
                if physical_row is None:
                    _cursor_publication_seal_read_fail(
                        "GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_SHAPE"
                    )
                state.live_physical_row_count = 1
                state.maximum_live_physical_row_count = max(
                    state.maximum_live_physical_row_count, 1
                )
                decoded: SQLiteCursorSealRow | None = None
                try:
                    try:
                        decoded = _decode_row(physical_row)
                    except BaseException as error:
                        raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_ROW") from error
                    state.live_carrier_count = 1
                    state.maximum_live_carrier_count = max(
                        state.maximum_live_carrier_count, 1
                    )
                    if decoded.carrier.tenant_id != tenant or decoded.carrier.token_hash != token:
                        _cursor_publication_seal_read_fail(
                            "GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_KEY"
                        )
                    if accumulator is None:
                        state.observed_descriptor_hash = decoded.descriptor_hash
                        state.observed_schema_identity_sha256 = (
                            decoded.schema_identity_sha256
                        )
                        try:
                            accumulator = cast(Any, _accumulator_type)(
                                state.main_key_row_count,
                                decoded.descriptor_hash,
                                decoded.schema_identity_sha256,
                            )
                        except BaseException as error:
                            raise ValueError(
                                "GE_CURSOR_B3_CURSOR_SEAL_READ_ACCUMULATOR"
                            ) from error
                    try:
                        cast(Any, accumulator).append(decoded)
                    except BaseException as error:
                        raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_ROW") from error
                    state.accumulator_row_count = cast(Any, accumulator).cursor_count
                    state.lookup_row_count += 1
                finally:
                    state.live_physical_row_count = 0
                    state.live_carrier_count = 0
                    del decoded, physical_row
                close_point("GE_CURSOR_B3_CURSOR_SEAL_READ_POINT_CLOSE")
                prove_lineage()
                if after_point_close is not None:
                    after_point_close()

            point_statement_owner.release()
            close_cursor(
                "driver_cursor",
                "driver_close_attempt_count",
                "driver_close_count",
                "GE_CURSOR_B3_CURSOR_SEAL_READ_DRIVER_CLOSE",
            )
            prove_lineage()
            if after_point_close is not None:
                after_point_close()
            if accumulator is None:
                try:
                    accumulator = cast(Any, _accumulator_type)(0, "0" * 64, "0" * 64)
                except BaseException as error:
                    raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_ACCUMULATOR") from error
            if not (
                state.main_key_row_count
                == state.driver_row_count
                == state.lookup_row_count
                == state.accumulator_row_count
                == state.point_statement_execute_count
                == state.point_cursor_created_count
                == state.point_cursor_closed_count
            ):
                _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_COUNTS")
            try:
                computed = cast(Any, accumulator).finish()
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_CURSOR_SEAL_READ_ACCUMULATOR") from error
            state.accumulator_row_count = computed.cursor_count
            if state.main_key_row_count == 0:
                if (
                    computed.immutable_root_sha256 != SQLITE_CURSOR_SEAL_EMPTY_ROOT
                    or state.observed_descriptor_hash is not None
                    or state.observed_schema_identity_sha256 is not None
                ):
                    _cursor_publication_seal_read_fail(
                        "GE_CURSOR_B3_CURSOR_SEAL_READ_ACCUMULATOR"
                    )
            elif (
                computed.source_descriptor_hash != state.observed_descriptor_hash
                or computed.source_schema_identity_sha256
                != state.observed_schema_identity_sha256
            ):
                _cursor_publication_seal_read_fail(
                    "GE_CURSOR_B3_CURSOR_SEAL_READ_ACCUMULATOR"
                )
            if not (
                state.active_cursor_count == 0
                and state.live_physical_row_count == 0
                and state.live_carrier_count == 0
                and state.maximum_active_cursor_count <= 2
                and state.maximum_live_physical_row_count <= 1
                and state.maximum_live_carrier_count <= 1
                and state.main_key_prepare_count == 1
                and state.main_key_terminal_fetch_count == 1
                and state.main_key_close_attempt_count == 1
                and state.main_key_close_count == 1
                and state.driver_prepare_count == 1
                and state.driver_terminal_fetch_count == 1
                and state.driver_close_attempt_count == 1
                and state.driver_close_count == 1
                and state.point_statement_prepare_count == 1
                and state.point_statement_release_count == 1
                and state.point_cursor_close_attempt_count
                == state.main_key_row_count
                and point_statement_owner.execute_count
                == state.point_statement_execute_count
                and point_statement_owner.release_count == 1
                and point_statement_owner.active_cursor is None
            ):
                _cursor_publication_seal_read_fail(
                    "GE_CURSOR_B3_CURSOR_SEAL_READ_RESOURCE_BUDGET"
                )
            prove_lineage()
            state.computed_immutable_root_sha256 = computed.immutable_root_sha256
            state.lifecycle = "completed"
            return _cursor_publication_seal_read_snapshot(state)
        except BaseException as primary:
            state.lifecycle = "poisoned"
            state.computed_immutable_root_sha256 = None
            state.live_physical_row_count = 0
            state.live_carrier_count = 0
            recover_cursor("point_cursor")
            point_owner = state.point_statement_owner
            if point_owner is not None and point_owner.release_count == 0:
                with suppress(BaseException):
                    point_owner.release()
            recover_cursor("driver_cursor")
            recover_cursor("main_cursor")
            with suppress(BaseException):
                state.total_changes = _native_total_changes(self.__connection)
            raise primary

    def _release_cursor_publication_seal_read(
        self,
        execution: _SQLiteConnectionCursorPublicationSealReadExecution,
        _state_for: Callable[..., _CursorPublicationSealReadExecutionState] = (
            _cursor_publication_seal_read_state
        ),
    ) -> _SQLiteConnectionCursorPublicationSealReadSnapshot:
        """Cancel one still-prepared raw seal observation without reading SQL."""

        state = _state_for(self, execution)
        if state.lifecycle != "prepared" or state.execute_count != 0 or state.release_count != 0:
            if state.lifecycle != "completed":
                state.lifecycle = "poisoned"
            _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_RELEASE")
        state.release_count = 1
        state.lifecycle = "released"
        return _cursor_publication_seal_read_snapshot(state)

    def _read_cursor_publication_seal_read_snapshot(
        self,
        execution: _SQLiteConnectionCursorPublicationSealReadExecution,
        _state_for: Callable[..., _CursorPublicationSealReadExecutionState] = (
            _cursor_publication_seal_read_state
        ),
    ) -> _SQLiteConnectionCursorPublicationSealReadSnapshot:
        return _cursor_publication_seal_read_snapshot(_state_for(self, execution))

    def _prepare_post_ddl_publication_reader(
        self,
    ) -> _SQLiteConnectionPostDdlPublicationReader:
        """Allocate one cursor for the package-fixed read without executing it."""

        if (
            not _sqlite_native_in_transaction(self.__connection)
            or self.__transaction_mode != "exclusive"
            or self.__transaction_generation is None
        ):
            _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE_FENCE")
        try:
            cursor = _SQLITE_CONNECTION_CURSOR(self.__connection)
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_POST_DDL_READER_SOURCE_PREPARE") from error
        reader = _SQLiteConnectionPostDdlPublicationReader(_MIGRATION_0002_CONSTRUCTION_TOKEN)
        _register_post_ddl_reader(
            reader,
            _PostDdlPublicationReaderState(
                close_attempt_count=0,
                close_error_code=None,
                close_succeeded=False,
                connection=self,
                cursor=cursor,
                execute_count=0,
                fetch_count=0,
                lifecycle="prepared",
                total_changes=_sqlite_native_total_changes(self.__connection),
                transaction_epoch=self.__transaction_epoch,
                transaction_generation=self.__transaction_generation,
            ),
        )
        return reader

    def _execute_post_ddl_publication_reader(
        self,
        reader: _SQLiteConnectionPostDdlPublicationReader,
    ) -> None:
        """Execute the fixed zero-parameter source statement exactly once."""

        state = _post_ddl_reader_state(self, reader)
        if state.lifecycle != "prepared" or state.execute_count != 0:
            state.lifecycle = "poisoned"
            _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE_REPLAY")
        if (
            not _sqlite_native_in_transaction(self.__connection)
            or self.__transaction_mode != "exclusive"
            or self.__transaction_generation is not state.transaction_generation
            or self.__transaction_epoch != state.transaction_epoch
            or _sqlite_native_total_changes(self.__connection) != state.total_changes
        ):
            state.lifecycle = "poisoned"
            _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE_FENCE")
        try:
            _SQLITE_CURSOR_EXECUTE(
                state.cursor,
                _POST_DDL_READER_SOURCE_SQL,
                (),
            )
        except BaseException as error:
            state.lifecycle = "poisoned"
            state.close_attempt_count = 1
            try:
                _SQLITE_CURSOR_CLOSE(state.cursor)
                state.close_succeeded = True
            except BaseException:
                state.close_error_code = "GE_CURSOR_B3_POST_DDL_READER_SOURCE_CLOSE"
            raise ValueError("GE_CURSOR_B3_POST_DDL_READER_SOURCE_EXECUTE") from error
        state.execute_count = 1
        state.lifecycle = "active"

    def _fetch_post_ddl_publication_reader(
        self,
        reader: _SQLiteConnectionPostDdlPublicationReader,
    ) -> tuple[object, ...] | None:
        """Fetch one row from an active fixed reader without implicit batching."""

        state = _post_ddl_reader_state(self, reader)
        if state.lifecycle != "active" or state.execute_count != 1:
            _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE_STATE")
        try:
            row = _SQLITE_CURSOR_FETCHONE(state.cursor)
        except BaseException as error:
            state.lifecycle = "poisoned"
            raise ValueError("GE_CURSOR_B3_POST_DDL_READER_SOURCE_FETCH") from error
        state.fetch_count += 1
        return cast(tuple[object, ...] | None, row)

    def _close_post_ddl_publication_reader(
        self,
        reader: _SQLiteConnectionPostDdlPublicationReader,
    ) -> None:
        """Attempt native close once and replay any retained close error."""

        state = _post_ddl_reader_state(self, reader)
        if state.close_attempt_count == 1:
            if state.close_error_code is not None:
                raise ValueError(state.close_error_code)
            return
        state.close_attempt_count = 1
        try:
            _SQLITE_CURSOR_CLOSE(state.cursor)
        except BaseException as error:
            state.lifecycle = "poisoned"
            state.close_error_code = "GE_CURSOR_B3_POST_DDL_READER_SOURCE_CLOSE"
            raise ValueError(state.close_error_code) from error
        state.close_succeeded = True
        state.lifecycle = "closed"

    def _read_post_ddl_publication_reader_snapshot(
        self,
        reader: _SQLiteConnectionPostDdlPublicationReader,
    ) -> _SQLiteConnectionPostDdlPublicationReaderSnapshot:
        state = _post_ddl_reader_state(self, reader)
        return _SQLiteConnectionPostDdlPublicationReaderSnapshot(
            close_attempt_count=state.close_attempt_count,
            close_succeeded=state.close_succeeded,
            execute_count=state.execute_count,
            fetch_count=state.fetch_count,
            lifecycle=state.lifecycle,
            prepare_count=1,
            total_changes=state.total_changes,
            transaction_epoch=state.transaction_epoch,
            transaction_generation=state.transaction_generation,
        )

    def _begin_baseline_entry_publication_execution(
        self,
        expected_entry_count: int,
    ) -> _SQLiteConnectionBaselineEntryPublicationExecution:
        """Prepare one connection-owned fixed-INSERT execution session."""

        if (
            type(expected_entry_count) is not int
            or not 0 <= expected_entry_count <= MAX_SAFE_INTEGER
        ):
            _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_EXPECTED_COUNT")
        try:
            if (
                not _baseline_entry_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is None
                or type(self.__transaction_epoch) is not int
                or self.__transaction_epoch < 0
            ):
                _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_STALE_FENCE")
            transaction_generation = self.__transaction_generation
            transaction_epoch = self.__transaction_epoch
            total_changes = _baseline_entry_native_total_changes(self.__connection)
        except ValueError:
            raise
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_BASELINE_ENTRY_OWNER_OBSERVATION") from error

        try:
            cursor = _BASELINE_ENTRY_SQLITE_CONNECTION_CURSOR(self.__connection)
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_BASELINE_ENTRY_PREPARE") from error
        try:
            owner_drifted = (
                not _baseline_entry_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is not transaction_generation
                or self.__transaction_epoch != transaction_epoch
                or _baseline_entry_native_total_changes(self.__connection) != total_changes
            )
        except BaseException as error:
            with suppress(BaseException):
                _BASELINE_ENTRY_SQLITE_CURSOR_CLOSE(cursor)
            raise ValueError("GE_CURSOR_B3_BASELINE_ENTRY_OWNER_OBSERVATION") from error
        if owner_drifted:
            with suppress(BaseException):
                _BASELINE_ENTRY_SQLITE_CURSOR_CLOSE(cursor)
            _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_OWNER_DRIFT")

        retained_cursor: sqlite3.Cursor | None = cursor
        if expected_entry_count == 0:
            try:
                _BASELINE_ENTRY_SQLITE_CURSOR_CLOSE(cursor)
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_BASELINE_ENTRY_CLEANUP") from error
            retained_cursor = None

        execution = _SQLiteConnectionBaselineEntryPublicationExecution(
            _BASELINE_ENTRY_PUBLICATION_CONSTRUCTION_TOKEN
        )
        _register_baseline_entry_publication_execution(
            execution,
            _BaselineEntryPublicationExecutionState(
                affected_rows=0,
                close_attempt_count=1 if expected_entry_count == 0 else 0,
                close_error_code=None,
                close_succeeded=expected_entry_count == 0,
                completed_entry_count=0,
                connection=self,
                cursor=retained_cursor,
                execute_count=0,
                expected_entry_count=expected_entry_count,
                lifecycle="completed" if expected_entry_count == 0 else "active",
                next_entry_ordinal=0,
                prepare_count=1,
                total_changes_before=total_changes,
                total_changes=total_changes,
                transaction_epoch_before=transaction_epoch,
                transaction_epoch=transaction_epoch,
                transaction_generation=transaction_generation,
            ),
        )
        return execution

    def _close_baseline_entry_publication_execution(
        self,
        state: _BaselineEntryPublicationExecutionState,
    ) -> None:
        """Close the retained cursor exactly once without retaining exceptions."""

        if state.close_attempt_count == 1:
            if state.close_error_code is not None:
                raise ValueError(state.close_error_code)
            return
        state.close_attempt_count = 1
        cursor = state.cursor
        state.cursor = None
        if cursor is None:
            state.close_error_code = "GE_CURSOR_B3_BASELINE_ENTRY_CLEANUP"
            raise ValueError(state.close_error_code)
        try:
            _BASELINE_ENTRY_SQLITE_CURSOR_CLOSE(cursor)
        except BaseException as error:
            state.close_error_code = "GE_CURSOR_B3_BASELINE_ENTRY_CLEANUP"
            raise ValueError(state.close_error_code) from error
        state.close_succeeded = True

    def _synchronize_baseline_entry_publication_after_failure(
        self,
        state: _BaselineEntryPublicationExecutionState,
    ) -> None:
        """Retain observed physical progress without replacing the primary error."""

        if type(self.__transaction_epoch) is int and self.__transaction_epoch >= 0:
            state.transaction_epoch = self.__transaction_epoch
        try:
            total_changes = _baseline_entry_native_total_changes(self.__connection)
            delta = total_changes - state.total_changes_before
            if type(delta) is int and 0 <= delta <= MAX_SAFE_INTEGER:
                state.total_changes = total_changes
                state.affected_rows = delta
        except BaseException:
            pass

    def _execute_next_baseline_entry_publication_row(
        self,
        execution: _SQLiteConnectionBaselineEntryPublicationExecution,
        baseline_id: object,
        ordinal: object,
        entry_kind: object,
        entry_key_blob: object,
        entry_state_blob: object,
        previous_entry_hash: object,
        entry_hash: object,
    ) -> _SQLiteConnectionBaselineEntryPublicationStepSnapshot:
        """Run the next fixed seven-parameter INSERT and retain its real progress."""

        state = _baseline_entry_publication_state(self, execution)
        if state.lifecycle != "active":
            _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_TERMINAL")
        if state.next_entry_ordinal >= state.expected_entry_count:
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_entry_publication_execution(state)
            _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_REPLAY")

        try:
            parameters = _checked_baseline_entry_publication_parameters(
                baseline_id,
                ordinal,
                entry_kind,
                entry_key_blob,
                entry_state_blob,
                previous_entry_hash,
                entry_hash,
            )
            if (
                not _baseline_entry_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is not state.transaction_generation
                or self.__transaction_epoch != state.transaction_epoch
                or _baseline_entry_native_total_changes(self.__connection) != state.total_changes
            ):
                _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_OWNER_DRIFT")
            if parameters[1] != state.next_entry_ordinal:
                _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_ORDINAL")
        except BaseException:
            self._synchronize_baseline_entry_publication_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_entry_publication_execution(state)
            raise

        state.execute_count += 1
        cursor = state.cursor
        if cursor is None:
            state.lifecycle = "poisoned"
            _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_EXECUTION")
        if type(self.__transaction_epoch) is not int or self.__transaction_epoch < 0:
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_entry_publication_execution(state)
            _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_EPOCH")
        self.__transaction_epoch += 1
        state.transaction_epoch = self.__transaction_epoch
        try:
            raw_result = _BASELINE_ENTRY_SQLITE_CURSOR_EXECUTE(
                cursor,
                _BASELINE_ENTRY_PUBLICATION_INSERT_SQL,
                parameters,
            )
        except BaseException as error:
            self._synchronize_baseline_entry_publication_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_entry_publication_execution(state)
            raise ValueError("GE_CURSOR_B3_BASELINE_ENTRY_EXECUTE") from error

        # Returning from the native call is the irreversible completion boundary.
        # Commit that fact before rowcount or total_changes observation can fail.
        entry_ordinal = state.next_entry_ordinal
        state.completed_entry_count += 1
        state.next_entry_ordinal += 1
        state.affected_rows = state.completed_entry_count
        try:
            if raw_result is not cursor:
                _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_RESULT")
            try:
                raw_rowcount = _BASELINE_ENTRY_SQLITE_CURSOR_ROWCOUNT.__get__(
                    cursor, sqlite3.Cursor
                )
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_BASELINE_ENTRY_RESULT") from error
            if type(raw_rowcount) is not int or raw_rowcount != 1:
                _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_AFFECTED_ROWS")
            total_changes = _baseline_entry_native_total_changes(self.__connection)
            if total_changes - state.total_changes != 1:
                _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_ACCOUNTING")
            state.total_changes = total_changes
            state.affected_rows = total_changes - state.total_changes_before
            if state.completed_entry_count == state.expected_entry_count:
                state.lifecycle = "completed"
                self._close_baseline_entry_publication_execution(state)
            return _SQLiteConnectionBaselineEntryPublicationStepSnapshot(
                affected_rows_delta=1,
                completed_entry_count=state.completed_entry_count,
                entry_ordinal=entry_ordinal,
                execute_count=state.execute_count,
                prepare_count=state.prepare_count,
                total_changes=state.total_changes,
                transaction_epoch=state.transaction_epoch,
                transaction_generation=state.transaction_generation,
            )
        except BaseException:
            self._synchronize_baseline_entry_publication_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_entry_publication_execution(state)
            raise

    def _read_baseline_entry_publication_execution_snapshot(
        self,
        execution: _SQLiteConnectionBaselineEntryPublicationExecution,
    ) -> _SQLiteConnectionBaselineEntryPublicationExecutionSnapshot:
        state = _baseline_entry_publication_state(self, execution)
        return _SQLiteConnectionBaselineEntryPublicationExecutionSnapshot(
            affected_rows=state.affected_rows,
            completed_entry_count=state.completed_entry_count,
            execute_count=state.execute_count,
            expected_entry_count=state.expected_entry_count,
            lifecycle=state.lifecycle,
            next_entry_ordinal=state.next_entry_ordinal,
            prepare_count=state.prepare_count,
            total_changes_before=state.total_changes_before,
            total_changes=state.total_changes,
            total_changes_delta=state.total_changes - state.total_changes_before,
            transaction_epoch=state.transaction_epoch,
            transaction_generation=state.transaction_generation,
            close_attempt_count=state.close_attempt_count,
            close_succeeded=state.close_succeeded,
        )

    def _begin_baseline_header_publication_execution(
        self,
    ) -> _SQLiteConnectionBaselineHeaderPublicationExecution:
        """Allocate one cursor/session for the fixed baseline-header INSERT."""

        try:
            if (
                not _baseline_header_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is None
                or type(self.__transaction_epoch) is not int
                or self.__transaction_epoch < 0
            ):
                _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_STALE_FENCE")
            transaction_generation = self.__transaction_generation
            transaction_epoch = self.__transaction_epoch
            total_changes = _baseline_header_native_total_changes(self.__connection)
        except ValueError:
            raise
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_BASELINE_HEADER_OWNER_OBSERVATION") from error

        # Python's stdlib sqlite3 surface has no prepare-only API.  Exactly one
        # package-owned cursor allocation is the closed-set prepare reservation;
        # the fixed SQL is supplied only by the later single execute call.
        try:
            cursor = _BASELINE_HEADER_SQLITE_CONNECTION_CURSOR(self.__connection)
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_BASELINE_HEADER_PREPARE") from error
        try:
            owner_drifted = (
                not _baseline_header_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is not transaction_generation
                or self.__transaction_epoch != transaction_epoch
                or _baseline_header_native_total_changes(self.__connection) != total_changes
            )
        except BaseException as error:
            with suppress(BaseException):
                _BASELINE_HEADER_SQLITE_CURSOR_CLOSE(cursor)
            raise ValueError("GE_CURSOR_B3_BASELINE_HEADER_OWNER_OBSERVATION") from error
        if owner_drifted:
            with suppress(BaseException):
                _BASELINE_HEADER_SQLITE_CURSOR_CLOSE(cursor)
            _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_OWNER_DRIFT")

        execution = _SQLiteConnectionBaselineHeaderPublicationExecution(
            _BASELINE_HEADER_PUBLICATION_CONSTRUCTION_TOKEN
        )
        _register_baseline_header_publication_execution(
            execution,
            _BaselineHeaderPublicationExecutionState(
                affected_rows=0,
                close_attempt_count=0,
                close_error_code=None,
                close_succeeded=False,
                completed_execution_count=0,
                connection=self,
                cursor=cursor,
                execute_count=0,
                lifecycle="active",
                prepare_count=1,
                total_changes_before=total_changes,
                total_changes=total_changes,
                transaction_epoch_before=transaction_epoch,
                transaction_epoch=transaction_epoch,
                transaction_generation=transaction_generation,
            ),
        )
        return execution

    def _close_baseline_header_publication_execution(
        self,
        state: _BaselineHeaderPublicationExecutionState,
    ) -> None:
        """Close the header cursor exactly once and retain only a scalar code."""

        if state.close_attempt_count == 1:
            if state.close_error_code is not None:
                raise ValueError(state.close_error_code)
            return
        state.close_attempt_count = 1
        cursor = state.cursor
        state.cursor = None
        if cursor is None:
            state.close_error_code = "GE_CURSOR_B3_BASELINE_HEADER_CLEANUP"
            raise ValueError(state.close_error_code)
        try:
            _BASELINE_HEADER_SQLITE_CURSOR_CLOSE(cursor)
        except BaseException as error:
            state.close_error_code = "GE_CURSOR_B3_BASELINE_HEADER_CLEANUP"
            raise ValueError(state.close_error_code) from error
        state.close_succeeded = True

    def _synchronize_baseline_header_publication_after_failure(
        self,
        state: _BaselineHeaderPublicationExecutionState,
    ) -> None:
        """Retain real native progress without replacing the primary error."""

        if type(self.__transaction_epoch) is int and self.__transaction_epoch >= 0:
            state.transaction_epoch = self.__transaction_epoch
        try:
            total_changes = _baseline_header_native_total_changes(self.__connection)
            delta = total_changes - state.total_changes_before
            if type(delta) is int and 0 <= delta <= MAX_SAFE_INTEGER:
                state.total_changes = total_changes
                state.affected_rows = delta
        except BaseException:
            pass

    def _execute_baseline_header_publication(
        self,
        execution: _SQLiteConnectionBaselineHeaderPublicationExecution,
        baseline_id: object,
        source_schema_identity_sha256: object,
        source_migration_lineage_id: object,
        source_migration_lineage_sha256: object,
        source_descriptor_hash: object,
        captured_at_ms: object,
        legacy_operation_count: object,
        entry_count: object,
        first_entry_hash: object,
        final_entry_hash: object,
        canonical_projection_sha256: object,
        creation_runtime: object,
        creation_runtime_version: object,
        policy_blob: object,
    ) -> _SQLiteConnectionBaselineHeaderPublicationStepSnapshot:
        """Run the fixed fourteen-parameter INSERT and retain its real progress."""

        state = _baseline_header_publication_state(self, execution)
        if state.lifecycle != "active":
            _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_TERMINAL")
        try:
            parameters = _checked_baseline_header_publication_parameters(
                baseline_id,
                source_schema_identity_sha256,
                source_migration_lineage_id,
                source_migration_lineage_sha256,
                source_descriptor_hash,
                captured_at_ms,
                legacy_operation_count,
                entry_count,
                first_entry_hash,
                final_entry_hash,
                canonical_projection_sha256,
                creation_runtime,
                creation_runtime_version,
                policy_blob,
            )
            if (
                not _baseline_header_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is not state.transaction_generation
                or self.__transaction_epoch != state.transaction_epoch
                or _baseline_header_native_total_changes(self.__connection) != state.total_changes
            ):
                _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_OWNER_DRIFT")
        except BaseException:
            self._synchronize_baseline_header_publication_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_header_publication_execution(state)
            raise

        cursor = state.cursor
        if cursor is None:
            state.lifecycle = "poisoned"
            _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_EXECUTION")
        state.execute_count = 1
        if type(self.__transaction_epoch) is not int or self.__transaction_epoch < 0:
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_header_publication_execution(state)
            _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_EPOCH")
        self.__transaction_epoch += 1
        state.transaction_epoch = self.__transaction_epoch
        try:
            raw_result = _BASELINE_HEADER_SQLITE_CURSOR_EXECUTE(
                cursor,
                _BASELINE_HEADER_PUBLICATION_INSERT_SQL,
                parameters,
            )
        except BaseException as error:
            self._synchronize_baseline_header_publication_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_header_publication_execution(state)
            raise ValueError("GE_CURSOR_B3_BASELINE_HEADER_EXECUTE") from error

        # Native return is the irreversible one-row boundary.  Record it before
        # inspecting result shape, rowcount, counters, or cleanup.
        state.completed_execution_count = 1
        state.affected_rows = 1
        try:
            if raw_result is not cursor:
                _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_RESULT")
            try:
                raw_rowcount = _BASELINE_HEADER_SQLITE_CURSOR_ROWCOUNT.__get__(
                    cursor, sqlite3.Cursor
                )
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_BASELINE_HEADER_RESULT") from error
            if type(raw_rowcount) is not int or raw_rowcount != 1:
                _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_AFFECTED_ROWS")
            total_changes = _baseline_header_native_total_changes(self.__connection)
            if total_changes - state.total_changes != 1:
                _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_ACCOUNTING")
            state.total_changes = total_changes
            state.affected_rows = total_changes - state.total_changes_before
            state.lifecycle = "completed"
            self._close_baseline_header_publication_execution(state)
            return _SQLiteConnectionBaselineHeaderPublicationStepSnapshot(
                affected_rows_delta=1,
                completed_execution_count=1,
                execute_count=1,
                prepare_count=state.prepare_count,
                total_changes=state.total_changes,
                transaction_epoch=state.transaction_epoch,
                transaction_generation=state.transaction_generation,
            )
        except BaseException:
            self._synchronize_baseline_header_publication_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_baseline_header_publication_execution(state)
            raise

    def _read_baseline_header_publication_execution_snapshot(
        self,
        execution: _SQLiteConnectionBaselineHeaderPublicationExecution,
    ) -> _SQLiteConnectionBaselineHeaderPublicationExecutionSnapshot:
        state = _baseline_header_publication_state(self, execution)
        return _SQLiteConnectionBaselineHeaderPublicationExecutionSnapshot(
            affected_rows=state.affected_rows,
            completed_execution_count=state.completed_execution_count,
            execute_count=state.execute_count,
            lifecycle=state.lifecycle,
            prepare_count=state.prepare_count,
            total_changes_before=state.total_changes_before,
            total_changes=state.total_changes,
            total_changes_delta=state.total_changes - state.total_changes_before,
            transaction_epoch=state.transaction_epoch,
            transaction_generation=state.transaction_generation,
            close_attempt_count=state.close_attempt_count,
            close_succeeded=state.close_succeeded,
        )

    def _begin_operation_sequence_zero_execution(
        self,
        _fixed_insert_sql: str = SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
        _fixed_insert_sql_sha256: str = (
            SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC
        ),
    ) -> _SQLiteConnectionOperationSequenceZeroExecution:
        """Reserve one cursor/session for the fixed singleton INSERT."""

        _assert_operation_sequence_zero_sql_commitment(
            _fixed_insert_sql,
            _fixed_insert_sql_sha256,
        )
        try:
            if (
                not _sequence_zero_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is None
                or type(self.__transaction_epoch) is not int
                or self.__transaction_epoch < 0
            ):
                _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_STALE_FENCE")
            transaction_generation = self.__transaction_generation
            transaction_epoch = self.__transaction_epoch
            total_changes = _sequence_zero_native_total_changes(self.__connection)
        except ValueError:
            raise
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_SEQUENCE_ZERO_OWNER_OBSERVATION") from error

        # stdlib sqlite3 has no prepare-only API.  This single package-owned
        # cursor allocation is the prepare reservation; no SQL executes here.
        try:
            cursor = _SEQUENCE_ZERO_SQLITE_CONNECTION_CURSOR(self.__connection)
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_SEQUENCE_ZERO_PREPARE") from error
        try:
            owner_drifted = (
                not _sequence_zero_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is not transaction_generation
                or self.__transaction_epoch != transaction_epoch
                or _sequence_zero_native_total_changes(self.__connection) != total_changes
            )
        except BaseException as error:
            with suppress(BaseException):
                _SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE(cursor)
            raise ValueError("GE_CURSOR_B3_SEQUENCE_ZERO_OWNER_OBSERVATION") from error
        if owner_drifted:
            with suppress(BaseException):
                _SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE(cursor)
            _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_OWNER_DRIFT")

        execution = _SQLiteConnectionOperationSequenceZeroExecution(
            _OPERATION_SEQUENCE_ZERO_CONSTRUCTION_TOKEN
        )
        _register_operation_sequence_zero_execution(
            execution,
            _OperationSequenceZeroExecutionState(
                affected_rows=0,
                close_attempt_count=0,
                close_error_code=None,
                close_succeeded=False,
                completed_execution_count=0,
                connection=self,
                cursor=cursor,
                execute_count=0,
                fixed_insert_sql=_fixed_insert_sql,
                fixed_insert_sql_sha256=_fixed_insert_sql_sha256,
                lifecycle="active",
                prepare_count=1,
                total_changes_before=total_changes,
                total_changes=total_changes,
                transaction_epoch_before=transaction_epoch,
                transaction_epoch=transaction_epoch,
                transaction_generation=transaction_generation,
            ),
        )
        return execution

    def _close_operation_sequence_zero_execution(
        self,
        state: _OperationSequenceZeroExecutionState,
    ) -> None:
        """Close the reserved cursor exactly once and retain no exception."""

        if state.close_attempt_count == 1:
            if state.close_error_code is not None:
                raise ValueError(state.close_error_code)
            return
        state.close_attempt_count = 1
        cursor = state.cursor
        state.cursor = None
        if cursor is None:
            state.close_error_code = "GE_CURSOR_B3_SEQUENCE_ZERO_CLEANUP"
            raise ValueError(state.close_error_code)
        try:
            _SEQUENCE_ZERO_SQLITE_CURSOR_CLOSE(cursor)
        except BaseException as error:
            state.close_error_code = "GE_CURSOR_B3_SEQUENCE_ZERO_CLEANUP"
            raise ValueError(state.close_error_code) from error
        state.close_succeeded = True

    def _synchronize_operation_sequence_zero_after_failure(
        self,
        state: _OperationSequenceZeroExecutionState,
    ) -> None:
        """Retain real epoch/change progress without replacing primary errors."""

        if type(self.__transaction_epoch) is int and self.__transaction_epoch >= 0:
            state.transaction_epoch = self.__transaction_epoch
        try:
            total_changes = _sequence_zero_native_total_changes(self.__connection)
            delta = total_changes - state.total_changes_before
            if type(delta) is int and 0 <= delta <= MAX_SAFE_INTEGER:
                state.total_changes = total_changes
                state.affected_rows = delta
        except BaseException:
            pass

    def _execute_operation_sequence_zero(
        self,
        execution: _SQLiteConnectionOperationSequenceZeroExecution,
        baseline_id: object,
        baseline_captured_at_ms: object,
        updated_at_ms: object,
        _fixed_insert_sql: str = SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_INTRINSIC,
        _fixed_insert_sql_sha256: str = (
            SQLITE_CURSOR_OPERATION_SEQUENCE_ZERO_INSERT_SQL_SHA256_INTRINSIC
        ),
    ) -> _SQLiteConnectionOperationSequenceZeroStepSnapshot:
        """Run the fixed three-parameter INSERT once and retain real progress."""

        state = _operation_sequence_zero_state(self, execution)
        if state.lifecycle != "active":
            _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_TERMINAL")
        try:
            _assert_operation_sequence_zero_sql_commitment(
                state.fixed_insert_sql,
                state.fixed_insert_sql_sha256,
            )
            _assert_operation_sequence_zero_sql_commitment(
                _fixed_insert_sql,
                _fixed_insert_sql_sha256,
            )
            parameters = _checked_operation_sequence_zero_parameters(
                baseline_id,
                baseline_captured_at_ms,
                updated_at_ms,
            )
            if (
                not _sequence_zero_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is not state.transaction_generation
                or self.__transaction_epoch != state.transaction_epoch
                or _sequence_zero_native_total_changes(self.__connection) != state.total_changes
            ):
                _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_OWNER_DRIFT")
        except BaseException:
            self._synchronize_operation_sequence_zero_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_operation_sequence_zero_execution(state)
            raise

        cursor = state.cursor
        if cursor is None:
            state.lifecycle = "poisoned"
            _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTION")
        state.execute_count = 1
        if type(self.__transaction_epoch) is not int or self.__transaction_epoch < 0:
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_operation_sequence_zero_execution(state)
            _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_EPOCH")
        self.__transaction_epoch += 1
        state.transaction_epoch = self.__transaction_epoch
        try:
            raw_result = _SEQUENCE_ZERO_SQLITE_CURSOR_EXECUTE(
                cursor,
                _fixed_insert_sql,
                parameters,
            )
        except BaseException as error:
            self._synchronize_operation_sequence_zero_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_operation_sequence_zero_execution(state)
            raise ValueError("GE_CURSOR_B3_SEQUENCE_ZERO_EXECUTE") from error

        # Native return is irreversible.  Preserve it before inspecting the
        # returned cursor, rowcount, aggregate counter, or cleanup result.
        state.completed_execution_count = 1
        state.affected_rows = 1
        try:
            if raw_result is not cursor:
                _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_RESULT")
            try:
                raw_rowcount = _SEQUENCE_ZERO_SQLITE_CURSOR_ROWCOUNT.__get__(cursor, sqlite3.Cursor)
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_SEQUENCE_ZERO_RESULT") from error
            if type(raw_rowcount) is not int or raw_rowcount != 1:
                _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_AFFECTED_ROWS")
            total_changes = _sequence_zero_native_total_changes(self.__connection)
            if total_changes - state.total_changes != 1:
                _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_ACCOUNTING")
            state.total_changes = total_changes
            state.affected_rows = total_changes - state.total_changes_before
            state.lifecycle = "completed"
            self._close_operation_sequence_zero_execution(state)
            return _SQLiteConnectionOperationSequenceZeroStepSnapshot(
                affected_rows_delta=1,
                completed_execution_count=1,
                execute_count=1,
                prepare_count=state.prepare_count,
                total_changes=state.total_changes,
                transaction_epoch=state.transaction_epoch,
                transaction_generation=state.transaction_generation,
            )
        except BaseException:
            self._synchronize_operation_sequence_zero_after_failure(state)
            state.lifecycle = "poisoned"
            with suppress(BaseException):
                self._close_operation_sequence_zero_execution(state)
            raise

    def _read_operation_sequence_zero_execution_snapshot(
        self,
        execution: _SQLiteConnectionOperationSequenceZeroExecution,
    ) -> _SQLiteConnectionOperationSequenceZeroExecutionSnapshot:
        state = _operation_sequence_zero_state(self, execution)
        return _SQLiteConnectionOperationSequenceZeroExecutionSnapshot(
            affected_rows=state.affected_rows,
            completed_execution_count=state.completed_execution_count,
            execute_count=state.execute_count,
            lifecycle=state.lifecycle,
            prepare_count=state.prepare_count,
            total_changes_before=state.total_changes_before,
            total_changes=state.total_changes,
            total_changes_delta=state.total_changes - state.total_changes_before,
            transaction_epoch=state.transaction_epoch,
            transaction_generation=state.transaction_generation,
            close_attempt_count=state.close_attempt_count,
            close_succeeded=state.close_succeeded,
        )

    def _begin_migration_0002_execution(
        self,
        asset: object,
    ) -> _SQLiteConnectionMigration0002Execution:
        """Open the exact fixed-plan session; never accepts caller SQL."""

        if (
            not _sqlite_native_in_transaction(self.__connection)
            or self.__transaction_mode != "exclusive"
            or self.__transaction_generation is None
        ):
            _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_STALE_FENCE")
        snapshot = _READ_MIGRATION_0002_ASSET(cast(_SQLiteCursorMigration0002Asset, asset))
        if (
            snapshot.asset_sha256 != SQLITE_CURSOR_MIGRATION_0002_ASSET_SHA256
            or snapshot.asset_utf8_bytes != SQLITE_CURSOR_MIGRATION_0002_ASSET_UTF8_BYTES
            or snapshot.fixed_statement_count != SQLITE_CURSOR_MIGRATION_0002_FIXED_STATEMENT_COUNT
            or snapshot.fixed_statement_count != _MIGRATION_0002_FIXED_STATEMENT_COUNT
            or snapshot.preview_manifest_sha256
            != SQLITE_CURSOR_MIGRATION_0002_PREVIEW_MANIFEST_SHA256
            or snapshot.schema_sql_sha256 != SQLITE_CURSOR_MIGRATION_0002_SCHEMA_SQL_SHA256
            or type(snapshot.statements) is not tuple
            or len(snapshot.statements) != _MIGRATION_0002_FIXED_STATEMENT_COUNT
            or any(type(statement) is not str or not statement for statement in snapshot.statements)
        ):
            _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_ASSET")

        try:
            cursor = _SQLITE_CONNECTION_CURSOR(self.__connection)
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_MIGRATION_0002_PREPARE") from error
        try:
            _SQLITE_CURSOR_EXECUTE(cursor, _MIGRATION_0002_TEMP_CONFLICT_QUERY, ())
            row = _SQLITE_CURSOR_FETCHONE(cursor)
            trailing = _SQLITE_CURSOR_FETCHONE(cursor)
        except BaseException as error:
            with suppress(BaseException):
                _SQLITE_CURSOR_CLOSE(cursor)
            raise ValueError("GE_CURSOR_B3_MIGRATION_0002_TEMP_PREFLIGHT") from error
        try:
            _SQLITE_CURSOR_CLOSE(cursor)
        except BaseException as error:
            raise ValueError("GE_CURSOR_B3_MIGRATION_0002_CLEANUP") from error
        if (
            type(row) is not tuple
            or len(row) != 1
            or type(row[0]) is not int
            or row[0] != 0
            or trailing is not None
        ):
            _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_TEMP_CONFLICT")

        execution = _SQLiteConnectionMigration0002Execution(_MIGRATION_0002_CONSTRUCTION_TOKEN)
        _register_migration_0002_execution(
            execution,
            _Migration0002ExecutionState(
                connection=self,
                asset=asset,
                statements=snapshot.statements,
                transaction_generation=self.__transaction_generation,
                affected_rows=0,
                completed_statement_count=0,
                lifecycle="active",
                next_statement_ordinal=1,
                prepared_statement_count=0,
                total_changes=_sqlite_native_total_changes(self.__connection),
                transaction_epoch=self.__transaction_epoch,
            ),
        )
        return execution

    def _execute_next_migration_0002_statement(
        self,
        execution: _SQLiteConnectionMigration0002Execution,
    ) -> _SQLiteConnectionMigration0002StepSnapshot:
        """Execute one next-only statement and retain irreversible progress."""

        state = _migration_0002_state(self, execution)
        if state.lifecycle != "active":
            _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_TERMINAL")
        if state.next_statement_ordinal > _MIGRATION_0002_FIXED_STATEMENT_COUNT:
            state.lifecycle = "poisoned"
            _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_REPLAY")
        try:
            owner_drifted = (
                not _sqlite_native_in_transaction(self.__connection)
                or self.__transaction_mode != "exclusive"
                or self.__transaction_generation is not state.transaction_generation
                or self.__transaction_epoch != state.transaction_epoch
                or _sqlite_native_total_changes(self.__connection) != state.total_changes
            )
        except BaseException as error:
            state.lifecycle = "poisoned"
            raise ValueError("GE_CURSOR_B3_MIGRATION_0002_OWNER_OBSERVATION") from error
        if owner_drifted:
            state.lifecycle = "poisoned"
            _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_OWNER_DRIFT")

        ordinal = state.next_statement_ordinal
        sql = state.statements[ordinal - 1]
        cursor: sqlite3.Cursor | None = None
        try:
            try:
                cursor = _SQLITE_CONNECTION_CURSOR(self.__connection)
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_MIGRATION_0002_PREPARE") from error
            state.prepared_statement_count += 1
            # Every attempted native statement consumes an epoch before run,
            # including DML and an execute that later raises.
            if type(self.__transaction_epoch) is not int or self.__transaction_epoch < 0:
                _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_EPOCH")
            self.__transaction_epoch += 1
            state.transaction_epoch = self.__transaction_epoch
            try:
                _SQLITE_CURSOR_EXECUTE(cursor, sql, ())
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_MIGRATION_0002_STATEMENT") from error

            # Returning from native execute is the irreversible completion
            # boundary. Record it before rowcount, counter or close observation.
            state.completed_statement_count += 1
            state.next_statement_ordinal += 1
            try:
                raw_rowcount = _SQLITE_CURSOR_ROWCOUNT.__get__(cursor, sqlite3.Cursor)
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_MIGRATION_0002_STATEMENT") from error
            total_changes = _sqlite_native_total_changes(self.__connection)
            delta = total_changes - state.total_changes
            if (
                type(raw_rowcount) is not int
                or type(total_changes) is not int
                or type(delta) is not int
                or delta < 0
                or delta > MAX_SAFE_INTEGER
            ):
                _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_ACCOUNTING")
            if ordinal in {4, 17}:
                if raw_rowcount != delta:
                    _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_ACCOUNTING")
            elif delta != 0:
                _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_ACCOUNTING")
            if state.affected_rows > MAX_SAFE_INTEGER - delta:
                _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_ACCOUNTING")
            state.affected_rows += delta
            state.total_changes = total_changes
            owned_cursor = cursor
            cursor = None
            try:
                _SQLITE_CURSOR_CLOSE(owned_cursor)
            except BaseException as error:
                raise ValueError("GE_CURSOR_B3_MIGRATION_0002_CLEANUP") from error
            if state.completed_statement_count == _MIGRATION_0002_FIXED_STATEMENT_COUNT:
                state.lifecycle = "completed"
            return _SQLiteConnectionMigration0002StepSnapshot(
                affected_rows_delta=delta,
                completed_statement_count=state.completed_statement_count,
                fixed_statement_ordinal=ordinal,
                prepared_statement_count=state.prepared_statement_count,
                total_changes=state.total_changes,
                transaction_epoch=state.transaction_epoch,
                transaction_generation=state.transaction_generation,
            )
        except BaseException as error:
            # Preserve the original failure. A completed native statement may
            # have changed total_changes even if later observation failed.
            try:
                synchronized = _sqlite_native_total_changes(self.__connection)
                delta = synchronized - state.total_changes
                if (
                    type(delta) is int
                    and 0 <= delta <= MAX_SAFE_INTEGER
                    and state.affected_rows <= MAX_SAFE_INTEGER - delta
                ):
                    state.affected_rows += delta
                    state.total_changes = synchronized
            except BaseException:
                pass
            state.lifecycle = "poisoned"
            if cursor is not None:
                with suppress(BaseException):
                    _SQLITE_CURSOR_CLOSE(cursor)
            if isinstance(error, ValueError):
                raise
            raise ValueError("GE_CURSOR_B3_MIGRATION_0002_STATEMENT") from error

    def _read_migration_0002_execution_snapshot(
        self,
        execution: _SQLiteConnectionMigration0002Execution,
    ) -> _SQLiteConnectionMigration0002ExecutionSnapshot:
        state = _migration_0002_state(self, execution)
        return _SQLiteConnectionMigration0002ExecutionSnapshot(
            affected_rows=state.affected_rows,
            completed_statement_count=state.completed_statement_count,
            lifecycle=state.lifecycle,
            next_statement_ordinal=state.next_statement_ordinal,
            prepared_statement_count=state.prepared_statement_count,
            total_changes=state.total_changes,
            transaction_epoch=state.transaction_epoch,
            transaction_generation=state.transaction_generation,
        )

    def executescript(self, sql: str) -> None:
        self.__assert_publication_transaction_guard("executescript", sql)
        if _forbidden_temp_store_directory(sql):
            raise ValueError("SQLite temp_store_directory is forbidden")
        try:
            self.__connection.executescript(sql)
        finally:
            after = self.__connection.in_transaction
            self.__transaction_generation = object() if after else None
            self.__transaction_mode = "unknown" if after else None
            self.__transaction_epoch += 1

    def commit(self) -> None:
        self.__assert_publication_transaction_guard("commit", None)
        self.__connection.commit()
        self.__transaction_generation = None
        self.__transaction_mode = None
        self.__transaction_epoch += 1

    def rollback(self) -> None:
        self.__assert_publication_transaction_guard("rollback", None)
        self.__connection.rollback()
        self.__transaction_generation = None
        self.__transaction_mode = None
        self.__transaction_epoch += 1

    def close(self) -> None:
        self.__assert_publication_transaction_guard("close", None)
        self.__connection.close()
        self.__transaction_generation = None

    def __assert_publication_transaction_guard(
        self,
        operation: str,
        sql: str | None,
    ) -> None:
        callback = self.__publication_transaction_guard
        owner_ref = self.__publication_transaction_owner_ref
        if callback is None and owner_ref is None:
            return
        if owner_ref is not None and owner_ref() is None:
            raise ValueError("GE_SQLITE_TX_OWNER_ABANDONED")
        if callback is None or owner_ref is None:
            raise ValueError("GE_SQLITE_TX_OWNER_GUARD_STATE")
        callback(operation, sql)

    def _install_publication_transaction_guard(
        self,
        owner: object,
        callback: Callable[[str, str | None], None],
    ) -> None:
        if (
            self.__publication_transaction_guard is not None
            or self.__publication_transaction_owner_ref is not None
            or self.__connection.in_transaction
            or self.__transaction_generation is not None
            or self.__publication_transaction_lineage is not None
        ):
            raise ValueError("GE_SQLITE_TX_OWNER_REGISTRATION")
        connection_ref = ref(self)

        def owner_collected(dead_ref: ReferenceType[object]) -> None:
            connection = connection_ref()
            if (
                connection is not None
                and connection.__publication_transaction_owner_ref is dead_ref
            ):
                # Fail closed forever.  Losing the only live authority must not
                # turn an owned transaction into an unguarded raw connection.
                connection.__publication_transaction_guard = _abandoned_transaction_owner_guard

        try:
            owner_ref = ref(owner, owner_collected)
        except TypeError as error:
            raise TypeError("GE_SQLITE_TX_OWNER_WEAK_IDENTITY") from error
        self.__publication_transaction_owner_ref = owner_ref
        self.__publication_transaction_guard = callback

    def _publication_transaction_recoverable(self) -> bool:
        return self.__location != ":memory:"

    def _discard_publication_transaction_guard(self, owner: object) -> None:
        owner_ref = self.__publication_transaction_owner_ref
        if owner_ref is None or owner_ref() is not owner:
            raise ValueError("GE_SQLITE_TX_OWNER_PRESENTATION")
        if not self.__publication_transaction_closed and (
            self.__connection.in_transaction
            or self.__transaction_generation is not None
            or self.__transaction_mode is not None
            or self.__publication_transaction_lineage is not None
        ):
            raise ValueError("GE_SQLITE_TX_OWNER_LIVE_GUARD")
        self.__publication_transaction_owner_ref = None
        self.__publication_transaction_guard = None

    def _begin_publication_transaction_exclusive(
        self,
        owner: object,
        lineage: object,
        generation: object,
    ) -> None:
        owner_ref = self.__publication_transaction_owner_ref
        if (
            owner_ref is None
            or owner_ref() is not owner
            or self.__connection.in_transaction
            or self.__transaction_generation is not None
            or self.__transaction_mode is not None
            or self.__publication_transaction_lineage is not None
        ):
            raise ValueError("GE_SQLITE_TX_OWNER_BEGIN_PRESENTATION")
        self.__publication_transaction_lineage = lineage
        self.__transaction_generation = generation
        self.__transaction_mode = "exclusive"
        self.__transaction_epoch += 1
        cursor = self.__connection.execute("BEGIN EXCLUSIVE")
        cursor.close()

    def _observe_publication_transaction(
        self,
        owner: object,
        lineage: object,
        generation: object,
    ) -> tuple[bool, bool, bool, SQLiteTransactionMode | None, int, int, int]:
        owner_ref = self.__publication_transaction_owner_ref
        if owner_ref is None or owner_ref() is not owner:
            raise ValueError("GE_SQLITE_TX_OWNER_PRESENTATION")
        in_transaction = _SQLITE_CONNECTION_IN_TRANSACTION.__get__(
            self.__connection, sqlite3.Connection
        )
        return (
            in_transaction,
            self.__publication_transaction_lineage is lineage,
            self.__transaction_generation is generation,
            self.__transaction_mode,
            self.__transaction_epoch,
            _SQLITE_CONNECTION_TOTAL_CHANGES.__get__(self.__connection, sqlite3.Connection),
            self.__temp_mutation_epoch,
        )

    def _rollback_publication_transaction(
        self,
        owner: object,
        lineage: object,
        generation: object,
    ) -> None:
        owner_ref = self.__publication_transaction_owner_ref
        if (
            owner_ref is None
            or owner_ref() is not owner
            or not self.__connection.in_transaction
            or self.__publication_transaction_lineage is not lineage
            or self.__transaction_generation is not generation
            or self.__transaction_mode != "exclusive"
        ):
            raise ValueError("GE_SQLITE_TX_OWNER_PRESENTATION")
        self.__connection.rollback()
        self.__transaction_generation = None
        self.__transaction_mode = None
        self.__publication_transaction_lineage = None
        self.__transaction_epoch += 1

    def _tombstone_publication_transaction_generation(
        self,
        owner: object,
        generation: object,
    ) -> None:
        owner_ref = self.__publication_transaction_owner_ref
        if (
            owner_ref is None
            or owner_ref() is not owner
            or self.__transaction_generation is not generation
        ):
            raise ValueError("GE_SQLITE_TX_OWNER_PRESENTATION")
        # This tombstones authority at the transaction-owner layer only.  The
        # connection must retain exact-generation evidence until an authorised
        # rollback has checked it at the I/O boundary.

    def _close_publication_transaction(self, owner: object) -> None:
        owner_ref = self.__publication_transaction_owner_ref
        if owner_ref is None or owner_ref() is not owner:
            raise ValueError("GE_SQLITE_TX_OWNER_PRESENTATION")
        self.__connection.close()
        self.__transaction_generation = None
        self.__transaction_mode = None
        self.__publication_transaction_lineage = None
        self.__publication_transaction_closed = True

    def _publication_transaction_source_fingerprint(self, owner: object) -> tuple[object, ...]:
        owner_ref = self.__publication_transaction_owner_ref
        if owner_ref is None or owner_ref() is not owner:
            raise ValueError("GE_SQLITE_TX_OWNER_PRESENTATION")
        logical_dump = tuple(self.__connection.iterdump())
        return (logical_dump,)

    def _validate_publication_transaction_source_v1(self, owner: object) -> None:
        owner_ref = self.__publication_transaction_owner_ref
        if owner_ref is None or owner_ref() is not owner or self.__connection.in_transaction:
            raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
        _validate_publication_transaction_source_v1_connection(self.__connection)

    def _validate_publication_transaction_source_v1_active(
        self,
        owner: object,
        lineage: object,
        generation: object,
    ) -> None:
        owner_ref = self.__publication_transaction_owner_ref
        if (
            owner_ref is None
            or owner_ref() is not owner
            or not self.__connection.in_transaction
            or self.__publication_transaction_lineage is not lineage
            or self.__transaction_generation is not generation
            or self.__transaction_mode != "exclusive"
        ):
            raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
        _validate_publication_transaction_source_v1_connection(self.__connection)

    def _reopen_publication_transaction_source_fingerprint(
        self,
        owner: object,
    ) -> tuple[object, ...]:
        owner_ref = self.__publication_transaction_owner_ref
        if owner_ref is None or owner_ref() is not owner:
            raise ValueError("GE_SQLITE_TX_OWNER_PRESENTATION")
        if self.__location == ":memory:":
            raise ValueError("GE_SQLITE_TX_OWNER_REOPEN_MEMORY")
        audit = sqlite3.connect(self.__location)
        try:
            _validate_publication_transaction_source_v1_connection(audit)
            logical_dump = tuple(audit.iterdump())
            application_id = audit.execute("PRAGMA application_id").fetchone()
            user_version = audit.execute("PRAGMA user_version").fetchone()
            integrity = audit.execute("PRAGMA integrity_check").fetchall()
            foreign_keys = audit.execute("PRAGMA foreign_key_check").fetchall()
            topology = audit.execute("PRAGMA database_list").fetchall()
            temp_catalog = audit.execute(
                "SELECT type, name, tbl_name, sql FROM temp.sqlite_schema "
                "ORDER BY type COLLATE BINARY, name COLLATE BINARY"
            ).fetchall()
            return (
                logical_dump,
                application_id,
                user_version,
                tuple(tuple(row) for row in integrity),
                tuple(tuple(row) for row in foreign_keys),
                tuple(tuple(row) for row in topology),
                tuple(tuple(row) for row in temp_catalog),
            )
        finally:
            audit.close()


_OWNER_BEGIN_MIGRATION_0002 = SQLiteV1BaselineConnectionOwner._begin_migration_0002_execution
_OWNER_EXECUTE_NEXT_MIGRATION_0002 = (
    SQLiteV1BaselineConnectionOwner._execute_next_migration_0002_statement
)
_OWNER_READ_MIGRATION_0002 = SQLiteV1BaselineConnectionOwner._read_migration_0002_execution_snapshot
_OWNER_PREPARE_POST_DDL_READER = (
    SQLiteV1BaselineConnectionOwner._prepare_post_ddl_publication_reader
)
_OWNER_EXECUTE_POST_DDL_READER = (
    SQLiteV1BaselineConnectionOwner._execute_post_ddl_publication_reader
)
_OWNER_FETCH_POST_DDL_READER = SQLiteV1BaselineConnectionOwner._fetch_post_ddl_publication_reader
_OWNER_CLOSE_POST_DDL_READER = SQLiteV1BaselineConnectionOwner._close_post_ddl_publication_reader
_OWNER_READ_POST_DDL_READER = (
    SQLiteV1BaselineConnectionOwner._read_post_ddl_publication_reader_snapshot
)
_OWNER_BEGIN_BASELINE_ENTRY_PUBLICATION = (
    SQLiteV1BaselineConnectionOwner._begin_baseline_entry_publication_execution
)
_OWNER_EXECUTE_NEXT_BASELINE_ENTRY_PUBLICATION = (
    SQLiteV1BaselineConnectionOwner._execute_next_baseline_entry_publication_row
)
_OWNER_READ_BASELINE_ENTRY_PUBLICATION = (
    SQLiteV1BaselineConnectionOwner._read_baseline_entry_publication_execution_snapshot
)
_OWNER_BEGIN_BASELINE_HEADER_PUBLICATION = (
    SQLiteV1BaselineConnectionOwner._begin_baseline_header_publication_execution
)
_OWNER_EXECUTE_BASELINE_HEADER_PUBLICATION = (
    SQLiteV1BaselineConnectionOwner._execute_baseline_header_publication
)
_OWNER_READ_BASELINE_HEADER_PUBLICATION = (
    SQLiteV1BaselineConnectionOwner._read_baseline_header_publication_execution_snapshot
)
_OWNER_BEGIN_OPERATION_SEQUENCE_ZERO = (
    SQLiteV1BaselineConnectionOwner._begin_operation_sequence_zero_execution
)
_OWNER_EXECUTE_OPERATION_SEQUENCE_ZERO = (
    SQLiteV1BaselineConnectionOwner._execute_operation_sequence_zero
)
_OWNER_READ_OPERATION_SEQUENCE_ZERO = (
    SQLiteV1BaselineConnectionOwner._read_operation_sequence_zero_execution_snapshot
)
_OWNER_PREPARE_CURSOR_PUBLICATION_REBIND = (
    SQLiteV1BaselineConnectionOwner._prepare_cursor_publication_rebind
)
_OWNER_EXECUTE_CURSOR_PUBLICATION_REBIND = (
    SQLiteV1BaselineConnectionOwner._execute_cursor_publication_rebind
)
_OWNER_RELEASE_CURSOR_PUBLICATION_REBIND = (
    SQLiteV1BaselineConnectionOwner._release_cursor_publication_rebind
)
_OWNER_PROVE_CURSOR_PUBLICATION_REBIND_CHANGES = (
    SQLiteV1BaselineConnectionOwner._prove_cursor_publication_rebind_changes
)
_OWNER_READ_CURSOR_PUBLICATION_REBIND = (
    SQLiteV1BaselineConnectionOwner._read_cursor_publication_rebind_snapshot
)
_OWNER_BEGIN_CURSOR_PUBLICATION_SEAL_READ = (
    SQLiteV1BaselineConnectionOwner._begin_cursor_publication_seal_read
)
_OWNER_EXECUTE_CURSOR_PUBLICATION_SEAL_READ = (
    SQLiteV1BaselineConnectionOwner._execute_cursor_publication_seal_read
)
_OWNER_RELEASE_CURSOR_PUBLICATION_SEAL_READ = (
    SQLiteV1BaselineConnectionOwner._release_cursor_publication_seal_read
)
_OWNER_READ_CURSOR_PUBLICATION_SEAL_READ = (
    SQLiteV1BaselineConnectionOwner._read_cursor_publication_seal_read_snapshot
)
_OWNER_EXECUTE_QUERY_PLAN = SQLiteV1BaselineConnectionOwner.execute
_QUERY_PLAN_FETCHONE = _SQLiteCursorCapability.fetchone
_QUERY_PLAN_CLOSE = _SQLiteCursorCapability.close
_QUERY_PLAN_STR_SPLIT = str.split
_QUERY_PLAN_STR_JOIN = str.join


def _read_sqlite_connection_cursor_publication_seal_query_plans_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    _execute: Callable[..., _SQLiteCursorCapability] = _OWNER_EXECUTE_QUERY_PLAN,
    _fetchone: Callable[[_SQLiteCursorCapability], tuple[object, ...] | None] = (
        _QUERY_PLAN_FETCHONE
    ),
    _close: Callable[[_SQLiteCursorCapability], None] = _QUERY_PLAN_CLOSE,
    _split: Callable[..., list[str]] = _QUERY_PLAN_STR_SPLIT,
    _join: Callable[..., str] = _QUERY_PLAN_STR_JOIN,
) -> _SQLiteConnectionCursorPublicationSealQueryPlansSnapshot:
    """Run the three fixed EQP probes before the cursor rebind can execute."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_seal_read_fail(
            "GE_CURSOR_B3_CURSOR_SEAL_QUERY_PLAN_CONNECTION"
        )
    generation = connection._transaction_generation
    epoch = connection.transaction_epoch
    changes = connection.total_changes
    probes = (
        (
            "main-cursor-primary-key-count-order-without-sort",
            SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_INTRINSIC,
            SQLITE_CURSOR_PUBLICATION_SEAL_MAIN_KEY_SCAN_SQL_SHA256_INTRINSIC,
            (),
        ),
        (
            "temp-driver-primary-key-order-without-sort",
            SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_INTRINSIC,
            SQLITE_CURSOR_PUBLICATION_SEAL_KEY_DRIVER_SQL_SHA256_INTRINSIC,
            (),
        ),
        (
            "main-cursor-primary-key-point-lookup",
            SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_INTRINSIC,
            SQLITE_CURSOR_PUBLICATION_SEAL_POINT_LOOKUP_SQL_SHA256_INTRINSIC,
            ("eqp", "0" * 64),
        ),
    )
    observed: list[tuple[str, ...]] = []
    digests: list[str] = []
    for _identity_value, sql, _sql_digest, parameters in probes:
        cursor = _execute(
            connection, "EXPLAIN QUERY PLAN " + sql, parameters
        )
        details: list[str] = []
        primary: BaseException | None = None
        try:
            while True:
                row = _fetchone(cursor)
                if row is None:
                    break
                if type(row) is not tuple or len(row) != 4 or type(row[3]) is not str:
                    _cursor_publication_seal_read_fail(
                        "GE_CURSOR_B3_CURSOR_SEAL_QUERY_PLAN_SHAPE"
                    )
                details.append(
                    _join(" ", _split(row[3]))
                )
        except BaseException as error:
            primary = error
            raise
        finally:
            if primary is None:
                _close(cursor)
            else:
                with suppress(BaseException):
                    _close(cursor)
        if not details:
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_QUERY_PLAN_SHAPE"
            )
        joined = "\n".join(details).upper()
        if any(
            forbidden in joined
            for forbidden in (
                "AUTOMATIC",
                "MATERIALIZE",
                "USE TEMP B-TREE",
                "CO-ROUTINE",
            )
        ):
            _cursor_publication_seal_read_fail(
                "GE_CURSOR_B3_CURSOR_SEAL_QUERY_PLAN_FORBIDDEN"
            )
        frozen = tuple(details)
        observed.append(frozen)
        digests.append(canonical_sha256(list(frozen)))
    if (
        observed[0] != ("SCAN main.ge_cycle_cursors",)
        or observed[1] != ("SCAN temp.ge_blr_cursor_seal",)
        or observed[2]
        != (
            "SEARCH main.ge_cycle_cursors USING PRIMARY KEY "
            "(tenant_id=? AND token_hash=?)",
        )
        or not connection.in_exclusive_transaction
        or connection._transaction_generation is not generation
        or connection.transaction_epoch != epoch
        or connection.total_changes != changes
    ):
        _cursor_publication_seal_read_fail(
            "GE_CURSOR_B3_CURSOR_SEAL_QUERY_PLAN_IDENTITY"
        )
    return _SQLiteConnectionCursorPublicationSealQueryPlansSnapshot(
        3,
        cast(tuple[str, str, str], tuple(probe[0] for probe in probes)),
        cast(tuple[str, str, str], tuple(probe[2] for probe in probes)),
        cast(
            tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...]],
            tuple(observed),
        ),
        cast(tuple[str, str, str], tuple(digests)),
        True,
        True,
        generation,
        epoch,
        changes,
    )


def _prepare_sqlite_connection_cursor_publication_rebind_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    _implementation: Callable[
        [SQLiteV1BaselineConnectionOwner],
        _SQLiteConnectionCursorPublicationRebindExecution,
    ] = _OWNER_PREPARE_CURSOR_PUBLICATION_REBIND,
) -> _SQLiteConnectionCursorPublicationRebindExecution:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_CONNECTION")
    return _implementation(connection)


def _execute_sqlite_connection_cursor_publication_rebind_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    target_descriptor_hash: object,
    target_schema_identity_sha256: object,
    source_descriptor_hash: object,
    source_schema_identity_sha256: object,
    _implementation: Callable[..., _SQLiteConnectionCursorPublicationRebindSnapshot] = (
        _OWNER_EXECUTE_CURSOR_PUBLICATION_REBIND
    ),
) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_CONNECTION")
    return _implementation(
        connection,
        execution,
        target_descriptor_hash,
        target_schema_identity_sha256,
        source_descriptor_hash,
        source_schema_identity_sha256,
    )


def _release_sqlite_connection_cursor_publication_rebind_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    _implementation: Callable[..., _SQLiteConnectionCursorPublicationRebindSnapshot] = (
        _OWNER_RELEASE_CURSOR_PUBLICATION_REBIND
    ),
) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_CONNECTION")
    return _implementation(connection, execution)


def _arm_sqlite_connection_cursor_publication_rebind_release_fault_for_test_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    error: BaseException,
    _make_ref: Callable[..., ReferenceType[object]] = ref,
) -> None:
    """Arm one exact prepared E; the selected release retires then raises."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner or not isinstance(
        error, BaseException
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT")
    state = _cursor_publication_rebind_state(connection, execution)
    if (
        state.lifecycle != "prepared"
        or state.execute_count != 0
        or state.release_count != 0
        or state.cursor is None
    ):
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT")
    try:
        error_ref = cast(ReferenceType[BaseException], _make_ref(error))
    except TypeError:
        _cursor_publication_rebind_fail(
            "GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT"
        )
    current = _CURSOR_PUBLICATION_REBIND_RELEASE_FAULTS.get(id(execution))
    if current is not None and current[0]() is execution:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_RELEASE_FAULT")
    try:
        _REGISTER_CURSOR_PUBLICATION_REBIND_RELEASE_FAULT(
            execution,
            _CursorPublicationRebindReleaseFaultState(id(connection), error_ref),
        )
    except BaseException:
        _discard_cursor_publication_rebind_release_fault_exact(execution)
        raise


def _prove_sqlite_connection_cursor_publication_rebind_changes_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    _implementation: Callable[..., _SQLiteConnectionCursorPublicationRebindSnapshot] = (
        _OWNER_PROVE_CURSOR_PUBLICATION_REBIND_CHANGES
    ),
) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_CONNECTION")
    return _implementation(connection, execution)


def _read_sqlite_connection_cursor_publication_rebind_snapshot_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationRebindExecution,
    _implementation: Callable[..., _SQLiteConnectionCursorPublicationRebindSnapshot] = (
        _OWNER_READ_CURSOR_PUBLICATION_REBIND
    ),
) -> _SQLiteConnectionCursorPublicationRebindSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_rebind_fail("GE_CURSOR_B3_CURSOR_REBIND_CONNECTION")
    return _implementation(connection, execution)


def _begin_sqlite_connection_cursor_publication_seal_read_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    rebind_execution: _SQLiteConnectionCursorPublicationRebindExecution,
    _implementation: Callable[
        [
            SQLiteV1BaselineConnectionOwner,
            _SQLiteConnectionCursorPublicationRebindExecution,
        ],
        _SQLiteConnectionCursorPublicationSealReadExecution,
    ] = _OWNER_BEGIN_CURSOR_PUBLICATION_SEAL_READ,
) -> _SQLiteConnectionCursorPublicationSealReadExecution:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_CONNECTION")
    return _implementation(connection, rebind_execution)


def _execute_sqlite_connection_cursor_publication_seal_read_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationSealReadExecution,
    expected_cursor_count: int | None = None,
    after_point_close: Callable[[], None] | None = None,
    _implementation: Callable[
        [
            SQLiteV1BaselineConnectionOwner,
            _SQLiteConnectionCursorPublicationSealReadExecution,
            int | None,
            Callable[[], None] | None,
        ],
        _SQLiteConnectionCursorPublicationSealReadSnapshot,
    ] = _OWNER_EXECUTE_CURSOR_PUBLICATION_SEAL_READ,
) -> _SQLiteConnectionCursorPublicationSealReadSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_CONNECTION")
    return _implementation(
        connection,
        execution,
        expected_cursor_count,
        after_point_close,
    )


def _release_sqlite_connection_cursor_publication_seal_read_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationSealReadExecution,
    _implementation: Callable[
        [
            SQLiteV1BaselineConnectionOwner,
            _SQLiteConnectionCursorPublicationSealReadExecution,
        ],
        _SQLiteConnectionCursorPublicationSealReadSnapshot,
    ] = _OWNER_RELEASE_CURSOR_PUBLICATION_SEAL_READ,
) -> _SQLiteConnectionCursorPublicationSealReadSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_CONNECTION")
    return _implementation(connection, execution)


def _read_sqlite_connection_cursor_publication_seal_read_snapshot_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionCursorPublicationSealReadExecution,
    _implementation: Callable[
        [
            SQLiteV1BaselineConnectionOwner,
            _SQLiteConnectionCursorPublicationSealReadExecution,
        ],
        _SQLiteConnectionCursorPublicationSealReadSnapshot,
    ] = _OWNER_READ_CURSOR_PUBLICATION_SEAL_READ,
) -> _SQLiteConnectionCursorPublicationSealReadSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _cursor_publication_seal_read_fail("GE_CURSOR_B3_CURSOR_SEAL_READ_CONNECTION")
    return _implementation(connection, execution)


def _begin_sqlite_connection_migration_0002_execution_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    asset: object,
) -> _SQLiteConnectionMigration0002Execution:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_CONNECTION")
    return _OWNER_BEGIN_MIGRATION_0002(connection, asset)


def _execute_next_sqlite_connection_migration_0002_statement_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionMigration0002Execution,
) -> _SQLiteConnectionMigration0002StepSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_CONNECTION")
    return _OWNER_EXECUTE_NEXT_MIGRATION_0002(connection, execution)


def _read_sqlite_connection_migration_0002_execution_snapshot_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionMigration0002Execution,
) -> _SQLiteConnectionMigration0002ExecutionSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _migration_0002_fail("GE_CURSOR_B3_MIGRATION_0002_CONNECTION")
    return _OWNER_READ_MIGRATION_0002(connection, execution)


def _prepare_sqlite_connection_post_ddl_publication_reader_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
) -> _SQLiteConnectionPostDdlPublicationReader:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    return _OWNER_PREPARE_POST_DDL_READER(connection)


def _execute_sqlite_connection_post_ddl_publication_reader_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    reader: _SQLiteConnectionPostDdlPublicationReader,
) -> None:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    _OWNER_EXECUTE_POST_DDL_READER(connection, reader)


def _fetch_sqlite_connection_post_ddl_publication_reader_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    reader: _SQLiteConnectionPostDdlPublicationReader,
) -> tuple[object, ...] | None:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    return _OWNER_FETCH_POST_DDL_READER(connection, reader)


def _fetch_next_owned_sqlite_connection_post_ddl_publication_reader_intrinsic(
    reader: _SQLiteConnectionPostDdlPublicationReader,
) -> tuple[object, ...] | None:
    """Fetch from an already-owned reader without exposing its connection."""

    state = _post_ddl_reader_state_from_handle(reader)
    return _OWNER_FETCH_POST_DDL_READER(state.connection, reader)


def _close_sqlite_connection_post_ddl_publication_reader_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    reader: _SQLiteConnectionPostDdlPublicationReader,
) -> None:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    _OWNER_CLOSE_POST_DDL_READER(connection, reader)


def _close_owned_sqlite_connection_post_ddl_publication_reader_intrinsic(
    reader: _SQLiteConnectionPostDdlPublicationReader,
) -> None:
    """Close an already-owned reader without retaining its graph connection."""

    state = _post_ddl_reader_state_from_handle(reader)
    _OWNER_CLOSE_POST_DDL_READER(state.connection, reader)


def _read_sqlite_connection_post_ddl_publication_reader_snapshot_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    reader: _SQLiteConnectionPostDdlPublicationReader,
) -> _SQLiteConnectionPostDdlPublicationReaderSnapshot:
    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _migration_0002_fail("GE_CURSOR_B3_POST_DDL_READER_SOURCE")
    return _OWNER_READ_POST_DDL_READER(connection, reader)


def _begin_sqlite_connection_baseline_entry_publication_execution_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    expected_entry_count: int,
) -> _SQLiteConnectionBaselineEntryPublicationExecution:
    """Prepare the exact package-owned baseline-entry INSERT once."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_CONNECTION")
    return _OWNER_BEGIN_BASELINE_ENTRY_PUBLICATION(connection, expected_entry_count)


def _execute_next_sqlite_connection_baseline_entry_publication_row_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionBaselineEntryPublicationExecution,
    baseline_id: object,
    ordinal: object,
    entry_kind: object,
    entry_key_blob: object,
    entry_state_blob: object,
    previous_entry_hash: object,
    entry_hash: object,
) -> _SQLiteConnectionBaselineEntryPublicationStepSnapshot:
    """Execute the next exact seven-parameter baseline-entry INSERT."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_CONNECTION")
    return _OWNER_EXECUTE_NEXT_BASELINE_ENTRY_PUBLICATION(
        connection,
        execution,
        baseline_id,
        ordinal,
        entry_kind,
        entry_key_blob,
        entry_state_blob,
        previous_entry_hash,
        entry_hash,
    )


def _read_sqlite_connection_baseline_entry_publication_execution_snapshot_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionBaselineEntryPublicationExecution,
) -> _SQLiteConnectionBaselineEntryPublicationExecutionSnapshot:
    """Read exact prepare/run/completion/counter progress after success or failure."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _baseline_entry_publication_fail("GE_CURSOR_B3_BASELINE_ENTRY_CONNECTION")
    return _OWNER_READ_BASELINE_ENTRY_PUBLICATION(connection, execution)


def _begin_sqlite_connection_baseline_header_publication_execution_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
) -> _SQLiteConnectionBaselineHeaderPublicationExecution:
    """Allocate one source-owned session for the fixed baseline-header INSERT."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_CONNECTION")
    return _OWNER_BEGIN_BASELINE_HEADER_PUBLICATION(connection)


def _execute_sqlite_connection_baseline_header_publication_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionBaselineHeaderPublicationExecution,
    baseline_id: object,
    source_schema_identity_sha256: object,
    source_migration_lineage_id: object,
    source_migration_lineage_sha256: object,
    source_descriptor_hash: object,
    captured_at_ms: object,
    legacy_operation_count: object,
    entry_count: object,
    first_entry_hash: object,
    final_entry_hash: object,
    canonical_projection_sha256: object,
    creation_runtime: object,
    creation_runtime_version: object,
    policy_blob: object,
) -> _SQLiteConnectionBaselineHeaderPublicationStepSnapshot:
    """Execute the exact package-owned fourteen-parameter header INSERT once."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_CONNECTION")
    return _OWNER_EXECUTE_BASELINE_HEADER_PUBLICATION(
        connection,
        execution,
        baseline_id,
        source_schema_identity_sha256,
        source_migration_lineage_id,
        source_migration_lineage_sha256,
        source_descriptor_hash,
        captured_at_ms,
        legacy_operation_count,
        entry_count,
        first_entry_hash,
        final_entry_hash,
        canonical_projection_sha256,
        creation_runtime,
        creation_runtime_version,
        policy_blob,
    )


def _read_sqlite_connection_baseline_header_publication_execution_snapshot_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionBaselineHeaderPublicationExecution,
) -> _SQLiteConnectionBaselineHeaderPublicationExecutionSnapshot:
    """Read exact prepare/run/completion/counter/cleanup progress."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _baseline_header_publication_fail("GE_CURSOR_B3_BASELINE_HEADER_CONNECTION")
    return _OWNER_READ_BASELINE_HEADER_PUBLICATION(connection, execution)


def _begin_sqlite_connection_operation_sequence_zero_execution_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
) -> _SQLiteConnectionOperationSequenceZeroExecution:
    """Reserve one source-owned cursor for the fixed singleton INSERT."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_CONNECTION")
    return _OWNER_BEGIN_OPERATION_SEQUENCE_ZERO(connection)


def _execute_sqlite_connection_operation_sequence_zero_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionOperationSequenceZeroExecution,
    baseline_id: object,
    baseline_captured_at_ms: object,
    updated_at_ms: object,
) -> _SQLiteConnectionOperationSequenceZeroStepSnapshot:
    """Execute the exact package-owned three-parameter singleton INSERT."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_CONNECTION")
    return _OWNER_EXECUTE_OPERATION_SEQUENCE_ZERO(
        connection,
        execution,
        baseline_id,
        baseline_captured_at_ms,
        updated_at_ms,
    )


def _read_sqlite_connection_operation_sequence_zero_execution_snapshot_intrinsic(
    connection: SQLiteV1BaselineConnectionOwner,
    execution: _SQLiteConnectionOperationSequenceZeroExecution,
) -> _SQLiteConnectionOperationSequenceZeroExecutionSnapshot:
    """Read exact prepare/run/completion/counter/cleanup progress."""

    if type(connection) is not SQLiteV1BaselineConnectionOwner:
        _operation_sequence_zero_fail("GE_CURSOR_B3_SEQUENCE_ZERO_CONNECTION")
    return _OWNER_READ_OPERATION_SEQUENCE_ZERO(connection, execution)


@dataclass(frozen=True, slots=True)
class SQLiteV1BaselineClockEvidence:
    """Frozen source-owned clock evidence before cursor diagnostics run."""

    captured_at_ms: int
    maximum_non_cursor_observed_at_ms: int
    provider_high_water_at_ms: int


@dataclass(frozen=True, slots=True, weakref_slot=True)
class SQLiteV1BaselineSourceSummary:
    """Frozen source summary plus the first bounded family iterator.

    The connection remains caller-owned.  Iteration neither begins nor ends a
    transaction and is deliberately one-shot so migration code cannot hash the
    same captured source twice by accident.
    """

    _source_envelope_bytes: bytes = field(repr=False)
    counts_by_kind: Mapping[BaselineEntryKind, int]
    expected_entry_count: int
    clock_evidence: SQLiteV1BaselineClockEvidence
    _connection: SQLiteV1BaselineConnectionOwner = field(repr=False)
    _latest_migration_applied_at_ms: int = field(repr=False)
    _source_total_changes: int = field(repr=False)
    _captured_transaction_epoch: int = field(repr=False)
    _identity_iteration_state: _IdentityIterationState = field(
        default_factory=_IdentityIterationState,
        init=False,
        repr=False,
        compare=False,
    )

    @property
    def source_envelope(self) -> JsonObject:
        """Return a detached copy of the captured immutable source identity."""

        return cast(JsonObject, json.loads(self._source_envelope_bytes))

    def iter_identity_entries(self) -> Iterator[BaselineEntryInput]:
        """Yield every currently implemented v1 source family once."""

        if self._identity_iteration_state.started:
            raise ValueError("SQLite v1 baseline identity iterator is already consumed")
        self._assert_capture_transaction()
        implemented = {
            "schema-envelope",
            "migration-lineage",
            "stream-head",
            "record-identity",
            "checkpoint-current",
            "checkpoint-revision",
            "lease-current",
            "used-lease-identity",
            "legal-hold",
            "migration-lock-current",
            "used-migration-lock-identity",
            "legacy-operation",
        }
        if (
            self.counts_by_kind["schema-envelope"] != 1
            or self.counts_by_kind["migration-lineage"] != 1
            or self.counts_by_kind["migration-lock-current"] != 1
            or any(
                self.counts_by_kind[kind] != 0
                for kind in BASELINE_ENTRY_KINDS
                if kind not in implemented
            )
        ):
            raise ValueError(
                "SQLite v1 baseline iterator cannot cover unimplemented source families"
            )
        self._identity_iteration_state.started = True
        return self._iterate_identity_entries()

    def _cooperative_identity_entries(
        self,
        stage_session: object,
        abort_stage: Callable[[], None],
    ) -> Generator[_CooperativeSourceItem, _CooperativeWriteReceipt, None]:
        """Open the private single-item source-to-stage handoff.

        Unlike the public iterator, this walker accepts only the exact +2
        receipt for the item it most recently yielded. Its accepted
        ``total_changes`` value is local to this generator and never weakens
        the frozen public capture guard.
        """

        if self._identity_iteration_state.started:
            raise ValueError("SQLite v1 baseline identity iterator is already consumed")
        self._assert_capture_transaction()
        self._require_implemented_families()
        self._identity_iteration_state.started = True
        return self._iterate_cooperative_identity_entries(stage_session, abort_stage)

    def _require_implemented_families(self) -> None:
        implemented = {
            "schema-envelope",
            "migration-lineage",
            "stream-head",
            "record-identity",
            "checkpoint-current",
            "checkpoint-revision",
            "lease-current",
            "used-lease-identity",
            "legal-hold",
            "migration-lock-current",
            "used-migration-lock-identity",
            "legacy-operation",
        }
        if (
            self.counts_by_kind["schema-envelope"] != 1
            or self.counts_by_kind["migration-lineage"] != 1
            or self.counts_by_kind["migration-lock-current"] != 1
            or any(
                self.counts_by_kind[kind] != 0
                for kind in BASELINE_ENTRY_KINDS
                if kind not in implemented
            )
        ):
            raise ValueError(
                "SQLite v1 baseline iterator cannot cover unimplemented source families"
            )

    def _iterate_identity_entries(self) -> Iterator[BaselineEntryInput]:
        self._assert_capture_transaction()
        families: tuple[
            tuple[BaselineEntryKind, str, Callable[[object], BaselineEntryInput], int],
            ...,
        ] = (
            ("schema-envelope", _SCHEMA_ENTRY_SQL, _schema_entry, 256),
            ("migration-lineage", _MIGRATION_ENTRY_SQL, _migration_entry, 256),
            ("stream-head", _STREAM_ENTRY_SQL, _stream_entry, 256),
            ("record-identity", _RECORD_ENTRY_SQL, _record_entry, 1),
            ("checkpoint-current", _CHECKPOINT_CURRENT_ENTRY_SQL, _checkpoint_current_entry, 1),
            (
                "checkpoint-revision",
                _CHECKPOINT_REVISION_ENTRY_SQL,
                _checkpoint_revision_entry,
                1,
            ),
            ("lease-current", _LEASE_CURRENT_ENTRY_SQL, _lease_current_entry, 256),
            (
                "used-lease-identity",
                _USED_LEASE_IDENTITY_ENTRY_SQL,
                _used_lease_identity_entry,
                256,
            ),
            ("legal-hold", _LEGAL_HOLD_ENTRY_SQL, _legal_hold_entry, 256),
            (
                "migration-lock-current",
                _MIGRATION_LOCK_ENTRY_SQL,
                _migration_lock_entry,
                256,
            ),
            (
                "used-migration-lock-identity",
                _USED_MIGRATION_LOCK_IDENTITY_ENTRY_SQL,
                _used_migration_lock_identity_entry,
                256,
            ),
            ("legacy-operation", _LEGACY_OPERATION_ENTRY_SQL, _legacy_operation_entry, 1),
        )
        envelope = self.source_envelope
        for kind, sql, capture, fetch_size in families:
            self._assert_capture_transaction()
            cursor = self._connection.execute(sql)
            emitted = 0
            try:
                while True:
                    self._assert_capture_transaction()
                    rows = cursor.fetchmany(fetch_size)
                    if not rows:
                        break
                    for row in rows:
                        self._assert_capture_transaction()
                        emitted += 1
                        try:
                            entry = capture(row)
                            self._reconcile_identity_entry(entry, envelope)
                            yield entry
                        except Exception as error:
                            raise ValueError(
                                f"SQLite v1 baseline {kind} source row is invalid"
                            ) from error
            finally:
                cursor.close()
            self._assert_capture_transaction()
            if emitted != self.counts_by_kind[kind]:
                raise ValueError(f"SQLite v1 baseline {kind} count changed during capture")

    def _iterate_cooperative_identity_entries(
        self,
        stage_session: object,
        abort_stage: Callable[[], None],
    ) -> Generator[_CooperativeSourceItem, _CooperativeWriteReceipt, None]:
        expected_total_changes = self._source_total_changes
        source_session = object()
        sequence = 0
        envelope = self.source_envelope
        completed = False
        try:
            for kind, sql, capture, _fetch_size in _identity_families():
                self._assert_cooperative_transaction(expected_total_changes)
                cursor = self._connection.execute(sql)
                emitted = 0
                try:
                    while True:
                        self._assert_cooperative_transaction(expected_total_changes)
                        row = cursor.fetchone()
                        if row is None:
                            break
                        self._assert_cooperative_transaction(expected_total_changes)
                        emitted += 1
                        try:
                            entry = capture(row)
                            self._reconcile_identity_entry(entry, envelope)
                        except Exception as error:
                            raise ValueError(
                                f"SQLite v1 baseline {kind} source row is invalid"
                            ) from error
                        item = _CooperativeSourceItem(
                            entry,
                            self._connection,
                            self._captured_transaction_epoch,
                            source_session,
                            stage_session,
                            sequence,
                            expected_total_changes,
                            object(),
                            _COOPERATIVE_CONSTRUCTION_TOKEN,
                        )
                        receipt = yield item
                        expected_total_changes = self._consume_cooperative_receipt(
                            item,
                            receipt,
                            expected_total_changes,
                        )
                        sequence += 1
                        del item, receipt
                finally:
                    cursor.close()
                self._assert_cooperative_transaction(expected_total_changes)
                if emitted != self.counts_by_kind[kind]:
                    raise ValueError(f"SQLite v1 baseline {kind} count changed during capture")
            if sequence != self.expected_entry_count:
                raise ValueError("SQLite v1 baseline cooperative source count drifted")
            completed = True
            self._identity_iteration_state.completed = True
        finally:
            if not completed:
                self._identity_iteration_state.poisoned = True
                with suppress(BaseException):
                    abort_stage()

    def _consume_cooperative_receipt(
        self,
        item: _CooperativeSourceItem,
        receipt: _CooperativeWriteReceipt,
        expected_total_changes: int,
    ) -> int:
        if (
            expected_total_changes < 0
            or expected_total_changes > MAX_SAFE_INTEGER - 2
            or type(receipt) is not _CooperativeWriteReceipt
            or receipt._consumed
            or receipt._item is not item
            or receipt._entry is not item._entry
            or receipt._connection is not self._connection
            or receipt._transaction_epoch != self._captured_transaction_epoch
            or receipt._source_session is not item._source_session
            or receipt._stage_session is not item._stage_session
            or receipt._item_nonce is not item._item_nonce
            or receipt._sequence != item._sequence
            or receipt._before_total_changes != expected_total_changes
            or receipt._after_total_changes != expected_total_changes + 2
        ):
            self._identity_iteration_state.poisoned = True
            raise ValueError("BLR_COOP_RECEIPT: cooperative write receipt is invalid")
        self._assert_cooperative_transaction(expected_total_changes + 2)
        self._assert_cooperative_transaction(receipt._after_total_changes)
        receipt._consumed = True
        self._assert_cooperative_transaction(receipt._after_total_changes)
        return receipt._after_total_changes

    def _poison_cooperative_state(self) -> None:
        """Close the one-shot cooperation lane after any handshake failure."""

        self._identity_iteration_state.started = True
        self._identity_iteration_state.poisoned = True

    def _assert_cooperative_transaction(self, expected_total_changes: int) -> None:
        if not self._connection.in_exclusive_transaction:
            self._identity_iteration_state.poisoned = True
            raise ValueError("SQLite v1 baseline requires the captured EXCLUSIVE transaction")
        if (
            self._connection.transaction_epoch != self._captured_transaction_epoch
            or self._connection.total_changes != expected_total_changes
        ):
            self._identity_iteration_state.poisoned = True
            raise ValueError("BLR_COOP_SOURCE_CHANGED: cooperative source transaction changed")

    def _assert_capture_transaction(self) -> None:
        if not self._connection.in_exclusive_transaction:
            raise ValueError("SQLite v1 baseline requires the captured EXCLUSIVE transaction")
        if (
            self._connection.transaction_epoch != self._captured_transaction_epoch
            or self._connection.total_changes != self._source_total_changes
        ):
            raise ValueError("SQLite v1 baseline captured transaction changed")

    def _reconcile_identity_entry(
        self,
        entry: BaselineEntryInput,
        envelope: JsonObject,
    ) -> None:
        state = entry.state
        if entry.entry_kind == "schema-envelope":
            if (
                state["schemaIdentitySha256"] != envelope["sourceSchemaIdentitySha256"]
                or state["providerDescriptorHash"] != envelope["sourceDescriptorHash"]
                or state["latestMigrationSha256"] != envelope["sourceMigrationLineageSha256"]
                or state["latestMigrationAppliedAtMs"] != self._latest_migration_applied_at_ms
            ):
                raise ValueError("captured schema envelope identity drifted")
        elif entry.entry_kind == "migration-lineage" and (
            state["migrationId"] != envelope["sourceMigrationLineageId"]
            or state["sqlSha256"] != envelope["sourceMigrationLineageSha256"]
            or state["schemaIdentitySha256"] != envelope["sourceSchemaIdentitySha256"]
            or state["appliedAtMs"] != self._latest_migration_applied_at_ms
        ):
            raise ValueError("captured migration lineage identity drifted")


_CAPTURED_SOURCE_SUMMARIES: dict[int, ReferenceType[SQLiteV1BaselineSourceSummary]] = {}


class SQLiteV1BaselineNativeProjectionProvenanceError(ValueError):
    """Stable structured rejection for an unregistered or altered NP1 source."""

    code: Literal["GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_PROVENANCE"] = (
        "GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_PROVENANCE"
    )

    def __init__(self) -> None:
        super().__init__("SQLite v1 baseline lower-owned source is invalid")


@dataclass(frozen=True, slots=True)
class _NativeProjectionSourceSummaryRecord:
    summary_ref: ReferenceType[SQLiteV1BaselineSourceSummary]
    connection_ref: ReferenceType[SQLiteV1BaselineConnectionOwner]
    counts_identity: Mapping[BaselineEntryKind, int]
    counts_tuple: tuple[tuple[BaselineEntryKind, int], ...]
    expected_entry_count: int
    source_envelope_bytes: bytes
    source_total_changes: int
    captured_transaction_epoch: int
    clock_evidence: SQLiteV1BaselineClockEvidence


class _NativeProjectionSourceSummaryEvidence(NamedTuple):
    counts: tuple[tuple[BaselineEntryKind, int], ...]
    expected_entry_count: int
    source_envelope_sha256: str
    source_total_changes: int
    captured_transaction_epoch: int
    issued: bool


def _native_projection_source_summary_registry_cell() -> tuple[
    Callable[[SQLiteV1BaselineSourceSummary], None],
    Callable[
        [SQLiteV1BaselineSourceSummary], _NativeProjectionSourceSummaryRecord
    ],
    Callable[
        [SQLiteV1BaselineSourceSummary, _NativeProjectionSourceSummaryRecord], None
    ],
    Callable[
        [SQLiteV1BaselineSourceSummary, _NativeProjectionSourceSummaryRecord], bool
    ],
    Callable[
        [SQLiteV1BaselineSourceSummary], _NativeProjectionSourceSummaryEvidence
    ],
]:
    """Own NP1 source authority in a non-addressable closure.

    Only detached scalar evidence leaves this cell.  In particular, neither the
    provenance record nor its one-shot tombstone can be recovered from module
    globals and replaced by a late monkeypatch.
    """

    records: dict[int, _NativeProjectionSourceSummaryRecord] = {}
    issued: set[int] = set()
    summary_type = SQLiteV1BaselineSourceSummary
    record_factory = _NativeProjectionSourceSummaryRecord
    evidence_factory = _NativeProjectionSourceSummaryEvidence
    weak_ref = ref
    digest = hashlib.sha256
    provenance_error_factory = SQLiteV1BaselineNativeProjectionProvenanceError

    def register(summary: SQLiteV1BaselineSourceSummary) -> None:
        identity = id(summary)

        def discard_exact(
            dead_ref: ReferenceType[SQLiteV1BaselineSourceSummary],
        ) -> None:
            record = records.get(identity)
            if record is not None and record.summary_ref is dead_ref:
                records.pop(identity, None)
                issued.discard(identity)

        summary_ref = weak_ref(summary, discard_exact)
        records[identity] = record_factory(
            summary_ref,
            weak_ref(summary._connection),
            summary.counts_by_kind,
            tuple(summary.counts_by_kind.items()),
            summary.expected_entry_count,
            summary._source_envelope_bytes,
            summary._source_total_changes,
            summary._captured_transaction_epoch,
            summary.clock_evidence,
        )

    def lookup(
        summary: SQLiteV1BaselineSourceSummary,
    ) -> _NativeProjectionSourceSummaryRecord:
        if type(summary) is not summary_type:
            raise provenance_error_factory()
        record = records.get(id(summary))
        if record is None or record.summary_ref() is not summary:
            raise provenance_error_factory()
        connection = record.connection_ref()
        if (
            connection is None
            or summary._connection is not connection
            or summary.counts_by_kind is not record.counts_identity
            or tuple(summary.counts_by_kind.items()) != record.counts_tuple
            or summary.expected_entry_count != record.expected_entry_count
            or summary._source_envelope_bytes != record.source_envelope_bytes
            or summary._source_total_changes != record.source_total_changes
            or summary._captured_transaction_epoch != record.captured_transaction_epoch
            or summary.clock_evidence is not record.clock_evidence
        ):
            raise provenance_error_factory()
        return record

    def claim(
        summary: SQLiteV1BaselineSourceSummary,
        record: _NativeProjectionSourceSummaryRecord,
    ) -> None:
        if lookup(summary) is not record or id(summary) in issued:
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_REPLAY")
        issued.add(id(summary))

    def is_issued(
        summary: SQLiteV1BaselineSourceSummary,
        record: _NativeProjectionSourceSummaryRecord,
    ) -> bool:
        return lookup(summary) is record and id(summary) in issued

    def observe(
        summary: SQLiteV1BaselineSourceSummary,
    ) -> _NativeProjectionSourceSummaryEvidence:
        record = lookup(summary)
        return evidence_factory(
            tuple(record.counts_tuple),
            record.expected_entry_count,
            digest(record.source_envelope_bytes).hexdigest(),
            record.source_total_changes,
            record.captured_transaction_epoch,
            id(summary) in issued,
        )

    return register, lookup, claim, is_issued, observe


(
    _register_native_projection_source_summary,
    _native_projection_source_summary_record_for,
    _claim_native_projection_source_summary,
    _native_projection_source_summary_is_issued,
    _read_native_projection_source_summary_evidence_for_test,
) = _native_projection_source_summary_registry_cell()


def _register_sqlite_v1_baseline_source_summary(
    summary: SQLiteV1BaselineSourceSummary,
    _register_native: Callable[
        [SQLiteV1BaselineSourceSummary], None
    ] = _register_native_projection_source_summary,
) -> None:
    """Retain only weak, exact-identity evidence of module capture."""

    identity = id(summary)

    def discard(reference: ReferenceType[SQLiteV1BaselineSourceSummary]) -> None:
        if _CAPTURED_SOURCE_SUMMARIES.get(identity) is reference:
            _CAPTURED_SOURCE_SUMMARIES.pop(identity, None)

    summary_ref = ref(summary, discard)
    _CAPTURED_SOURCE_SUMMARIES[identity] = summary_ref
    _register_native(summary)


def _assert_sqlite_v1_baseline_source_summary_provenance(
    summary: SQLiteV1BaselineSourceSummary,
) -> SQLiteV1BaselineSourceSummary:
    """Reject structurally equal summaries not returned by the capture function."""

    if type(summary) is not SQLiteV1BaselineSourceSummary:
        raise TypeError("SQLite v1 baseline captured source summary has the wrong type")
    reference = _CAPTURED_SOURCE_SUMMARIES.get(id(summary))
    if reference is None or reference() is not summary:
        raise ValueError("SQLite v1 baseline captured source summary provenance is invalid")
    return summary


_TABLES: tuple[tuple[BaselineEntryKind, str], ...] = (
    ("schema-envelope", "ge_cycle_schema"),
    ("migration-lineage", "ge_cycle_migrations"),
    ("stream-head", "ge_cycle_streams"),
    ("record-identity", "ge_cycle_records"),
    ("checkpoint-current", "ge_cycle_checkpoints"),
    ("checkpoint-revision", "ge_cycle_checkpoint_revisions"),
    ("lease-current", "ge_cycle_leases"),
    ("used-lease-identity", "ge_cycle_used_lease_ids"),
    ("legal-hold", "ge_cycle_legal_holds"),
    ("migration-lock-current", "ge_cycle_migration_lock"),
    ("used-migration-lock-identity", "ge_cycle_used_migration_lock_ids"),
    ("legacy-operation", "ge_cycle_operations"),
)

_SOURCE_ASSETS = _load_migration_assets()
_SQLITE_CYCLE_STORE_SEMANTIC_AUDIT = SQLiteCycleStoreProvider._semantic_audit
_SQLITE_CYCLE_STORE_VALIDATE_SCHEMA = SQLiteCycleStoreProvider._validate_schema
_SQLITE_CYCLE_STORE_RECORD_FROM_ROW = SQLiteCycleStoreProvider._record_from_row
_SQLITE_CYCLE_STORE_CHECKPOINT_FROM_ROW = SQLiteCycleStoreProvider._checkpoint_from_row
_SQLITE_CYCLE_STORE_DECODE_CHECKPOINT_SNAPSHOT = (
    SQLiteCycleStoreProvider._decode_checkpoint_snapshot
)

_MAXIMUM_NON_CURSOR_OBSERVED_SQL = """SELECT max(observed_at_ms) FROM (
 SELECT created_at_ms AS observed_at_ms FROM ge_cycle_schema
 UNION ALL SELECT updated_at_ms FROM ge_cycle_schema
 UNION ALL SELECT latest_migration_applied_at_ms FROM ge_cycle_schema
 UNION ALL SELECT applied_at_ms FROM ge_cycle_migrations
 UNION ALL SELECT created_at_ms FROM ge_cycle_streams
 UNION ALL SELECT updated_at_ms FROM ge_cycle_streams
 UNION ALL SELECT committed_at_ms FROM ge_cycle_records
 UNION ALL SELECT committed_at_ms FROM ge_cycle_operations
 UNION ALL SELECT committed_at_ms FROM ge_cycle_checkpoints
 UNION ALL SELECT recorded_at_ms FROM ge_cycle_checkpoint_revisions
 UNION ALL SELECT updated_at_ms FROM ge_cycle_leases
 UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_lease_ids
 UNION ALL SELECT placed_at_ms FROM ge_cycle_legal_holds
 UNION ALL SELECT first_used_at_ms FROM ge_cycle_used_migration_lock_ids
 UNION ALL SELECT updated_at_ms FROM ge_cycle_migration_lock
)"""

_SOURCE_V1_AUTO_INDEX_CATALOG = frozenset(
    {
        (
            "index",
            "sqlite_autoindex_ge_cycle_migrations_1",
            "ge_cycle_migrations",
            None,
        ),
        (
            "index",
            "sqlite_autoindex_ge_cycle_migrations_2",
            "ge_cycle_migrations",
            None,
        ),
        (
            "index",
            "sqlite_autoindex_ge_cycle_used_migration_lock_ids_1",
            "ge_cycle_used_migration_lock_ids",
            None,
        ),
    }
)


def _validate_publication_transaction_source_v1_connection(
    connection: sqlite3.Connection,
) -> None:
    """Validate the complete pre-BEGIN source-v1 and connection closed sets."""

    topology = connection.execute("PRAGMA database_list").fetchall()
    if (
        not topology
        or any(
            len(row) != 3
            or type(row[0]) is not int
            or type(row[1]) is not str
            or type(row[2]) is not str
            for row in topology
        )
        or tuple(row[1] for row in topology) not in {("main",), ("main", "temp")}
    ):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
    temp_catalog = connection.execute(
        "SELECT type, name, tbl_name, sql FROM temp.sqlite_schema "
        "ORDER BY type COLLATE BINARY, name COLLATE BINARY"
    ).fetchall()
    if temp_catalog:
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")

    application_id = connection.execute("PRAGMA application_id").fetchone()
    user_version = connection.execute("PRAGMA user_version").fetchone()
    if application_id != (1_195_724_359,) or user_version != (1,):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")

    identity = _SOURCE_ASSETS.schema_identity
    required_tables = cast(JsonObject, identity["requiredTables"])
    required_indexes = frozenset(cast(list[str], identity["requiredIndexes"]))
    catalog_rows = connection.execute(
        "SELECT type, name, tbl_name, sql FROM main.sqlite_schema "
        "ORDER BY type COLLATE BINARY, name COLLATE BINARY"
    ).fetchall()
    if any(
        len(row) != 4
        or type(row[0]) is not str
        or type(row[1]) is not str
        or type(row[2]) is not str
        or (row[3] is not None and type(row[3]) is not str)
        for row in catalog_rows
    ):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
    catalog = {tuple(row) for row in catalog_rows}
    table_sql = {
        cast(str, row[1]): cast(str, row[3])
        for row in catalog_rows
        if row[0] == "table" and row[3] is not None
    }
    explicit_indexes = {
        cast(str, row[1])
        for row in catalog_rows
        if row[0] == "index" and row[3] is not None
    }
    expected_catalog_size = (
        len(required_tables) + len(required_indexes) + len(_SOURCE_V1_AUTO_INDEX_CATALOG)
    )
    if (
        set(table_sql) != set(required_tables)
        or explicit_indexes != required_indexes
        or len(catalog) != expected_catalog_size
        or not _SOURCE_V1_AUTO_INDEX_CATALOG.issubset(catalog)
        or any(row[0] not in {"table", "index"} for row in catalog_rows)
    ):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
    for table_name, expected_columns_value in required_tables.items():
        sql = table_sql[table_name]
        if "STRICT" not in sql.upper():
            raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
        escaped = table_name.replace('"', '""')
        columns = [
            cast(str, row[1])
            for row in connection.execute(f'PRAGMA table_info("{escaped}")').fetchall()
        ]
        if columns != expected_columns_value:
            raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
    normalized_catalog: list[JsonObject] = []
    for row in connection.execute(
        "SELECT type, name, tbl_name, sql FROM main.sqlite_schema "
        "WHERE name GLOB 'ge_cycle_*' AND type IN ('table', 'index') "
        "AND sql IS NOT NULL ORDER BY type, name"
    ).fetchall():
        if len(row) != 4 or not all(type(value) is str for value in row):
            raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
        normalized_catalog.append(
            cast(
                JsonObject,
                {
                    "type": row[0],
                    "name": row[1],
                    "tableName": row[2],
                    "sql": re.sub(r"\s+", " ", row[3]).strip(),
                },
            )
        )
    if canonical_sha256(normalized_catalog) != SQLITE_CYCLE_STORE_CATALOG_SHA256:
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")

    schema_row = connection.execute(
        """SELECT current_version, min_reader_version, max_reader_version,
                  min_writer_version, max_writer_version, schema_identity_sha256,
                  latest_migration_sha256, provider_descriptor_hash,
                  latest_migration_applied_at_ms, created_at_ms, updated_at_ms
             FROM ge_cycle_schema WHERE singleton = 1"""
    ).fetchone()
    if (
        schema_row is None
        or len(schema_row) != 11
        or schema_row[:5] != (1, 1, 1, 1, 1)
        or schema_row[5] != SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256
        or schema_row[7] != SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
        or not all(type(value) is int for value in schema_row[8:11])
        or not all(0 <= value <= MAX_SAFE_INTEGER for value in schema_row[8:11])
        or schema_row[8] != schema_row[10]
        or schema_row[9] > schema_row[10]
    ):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
    migration_row = connection.execute(
        """SELECT previous_version, migration_id, sql_sha256,
                  schema_identity_sha256, applied_at_ms, reversibility,
                  postconditions_blob
             FROM ge_cycle_migrations WHERE version = 1"""
    ).fetchone()
    valid_lineages = {
        (0, "fresh-v1-baseline", _SOURCE_ASSETS.schema_sql_hash),
        (0, "alpha-v0-to-v1", _SOURCE_ASSETS.migration_sql_hash),
    }
    if (
        migration_row is None
        or len(migration_row) != 7
        or tuple(migration_row[:3]) not in valid_lineages
        or migration_row[3] != SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256
        or migration_row[4] != schema_row[8]
        or migration_row[5] != "rebuild-from-verified-backup-only"
        or migration_row[6] != _migration_postconditions_blob()
        or schema_row[6] != migration_row[2]
    ):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")

    total = 0
    for _kind, table in _TABLES:
        count = connection.execute(f"SELECT count(*) FROM {table}").fetchone()
        if count is None or type(count[0]) is not int or not 0 <= count[0] <= MAX_SAFE_INTEGER:
            raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
        total += count[0]
        if total > MAX_SAFE_INTEGER:
            raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
    singleton_counts = (
        connection.execute("SELECT count(*) FROM ge_cycle_schema").fetchone(),
        connection.execute("SELECT count(*) FROM ge_cycle_migrations").fetchone(),
        connection.execute("SELECT count(*) FROM ge_cycle_migration_lock").fetchone(),
    )
    if singleton_counts != ((1,), (1,), (1,)):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")
    maximum = connection.execute(_MAXIMUM_NON_CURSOR_OBSERVED_SQL).fetchone()
    high_water = connection.execute(
        "SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1"
    ).fetchone()
    integrity = connection.execute("PRAGMA integrity_check").fetchall()
    foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
    if (
        maximum is None
        or high_water is None
        or type(maximum[0]) is not int
        or type(high_water[0]) is not int
        or not 0 <= maximum[0] <= MAX_SAFE_INTEGER
        or not 0 <= high_water[0] <= MAX_SAFE_INTEGER
        or high_water[0] < maximum[0]
        or integrity != [("ok",)]
        or foreign_keys
    ):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")

    # Reuse the provider's complete bounded semantic verifier rather than
    # treating SQLite structural integrity as application-level integrity.
    # This traverses canonical record/checkpoint/operation/cursor carriers,
    # hash chains, stream tails, histories, fences, and cursor bindings.
    auditor = cast(Any, object.__new__(SQLiteCycleStoreProvider))
    auditor._assets = _SOURCE_ASSETS
    auditor._descriptor = cast(
        JsonObject,
        {"descriptorHash": SQLITE_CYCLE_STORE_DESCRIPTOR_HASH},
    )
    # The semantic body dispatches these helpers through ``self``. Bind the
    # definition-time captured intrinsics on the private one-shot auditor so
    # late class replacement cannot weaken registration evidence.
    auditor._validate_schema = _SQLITE_CYCLE_STORE_VALIDATE_SCHEMA.__get__(
        auditor, SQLiteCycleStoreProvider
    )
    auditor._record_from_row = _SQLITE_CYCLE_STORE_RECORD_FROM_ROW.__get__(
        auditor, SQLiteCycleStoreProvider
    )
    auditor._checkpoint_from_row = _SQLITE_CYCLE_STORE_CHECKPOINT_FROM_ROW.__get__(
        auditor, SQLiteCycleStoreProvider
    )
    auditor._decode_checkpoint_snapshot = (
        _SQLITE_CYCLE_STORE_DECODE_CHECKPOINT_SNAPSHOT.__get__(
            auditor, SQLiteCycleStoreProvider
        )
    )
    report = _SQLITE_CYCLE_STORE_SEMANTIC_AUDIT(
        auditor,
        connection,
        "inspect-schema",
    )
    if (
        report.get("level") != "semantic"
        or report.get("applicationId") != 1_195_724_359
        or report.get("schemaVersion") != 1
        or report.get("schemaIdentitySha256")
        != SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256
        or report.get("descriptorHash") != SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
        or report.get("catalogSha256") != SQLITE_CYCLE_STORE_CATALOG_SHA256
    ):
        raise ValueError("GE_SQLITE_TX_OWNER_SOURCE_V1")

_SCHEMA_ENTRY_SQL = """SELECT current_version, min_reader_version,
 max_reader_version, min_writer_version, max_writer_version,
 schema_identity_sha256, latest_migration_sha256,
 latest_migration_applied_at_ms, provider_descriptor_hash, created_at_ms,
 updated_at_ms
 FROM ge_cycle_schema WHERE singleton = 1"""

_MIGRATION_ENTRY_SQL = """SELECT version, previous_version, migration_id,
 sql_sha256, schema_identity_sha256, applied_at_ms, reversibility,
 postconditions_blob
 FROM ge_cycle_migrations ORDER BY CAST(version AS TEXT) COLLATE BINARY"""

_STREAM_ENTRY_SQL = """SELECT tenant_id, stream_id, tail_sequence,
 tail_record_hash, created_at_ms, updated_at_ms
 FROM ge_cycle_streams
 ORDER BY stream_id COLLATE BINARY, tenant_id COLLATE BINARY"""

_RECORD_ENTRY_SQL = """SELECT tenant_id, stream_id, sequence, record_id,
 previous_record_hash, value_hash, value_bytes, value_blob, record_hash,
 record_blob, committed_at_ms
 FROM ge_cycle_records
 ORDER BY record_id COLLATE BINARY, tenant_id COLLATE BINARY"""

_CHECKPOINT_CURRENT_ENTRY_SQL = """SELECT tenant_id, checkpoint_scope,
 checkpoint_id, stream_id, bound_sequence, bound_record_hash, created_at,
 value_hash, value_bytes, value_blob, checkpoint_blob, summary_blob,
 checkpoint_revision, committed_at_ms
 FROM ge_cycle_checkpoints
 ORDER BY checkpoint_id COLLATE BINARY, checkpoint_scope COLLATE BINARY,
 tenant_id COLLATE BINARY"""

_CHECKPOINT_REVISION_ENTRY_SQL = """SELECT tenant_id, checkpoint_scope,
 revision, checkpoint_id, action, summary_blob, bound_sequence,
 bound_record_hash, checkpoint_created_at, value_hash, value_bytes,
 recorded_at_ms
 FROM ge_cycle_checkpoint_revisions
 ORDER BY checkpoint_scope COLLATE BINARY,
 CAST(revision AS TEXT) COLLATE BINARY, tenant_id COLLATE BINARY"""

_LEASE_CURRENT_ENTRY_SQL = """SELECT tenant_id, stream_id, active_lease_id,
 active_holder_id, active_lease_epoch, active_fencing_token,
 active_acquired_at_ms, active_expires_at_ms, last_lease_epoch,
 last_fencing_token, updated_at_ms
 FROM ge_cycle_leases
 ORDER BY stream_id COLLATE BINARY, tenant_id COLLATE BINARY"""

_USED_LEASE_IDENTITY_ENTRY_SQL = """SELECT tenant_id, stream_id, lease_id,
 lease_epoch, fencing_token, first_used_at_ms
 FROM ge_cycle_used_lease_ids
 ORDER BY lease_id COLLATE BINARY, stream_id COLLATE BINARY,
 tenant_id COLLATE BINARY"""

_LEGAL_HOLD_ENTRY_SQL = """SELECT tenant_id, stream_id, hold_id, placed_at_ms
 FROM ge_cycle_legal_holds
 ORDER BY hold_id COLLATE BINARY, stream_id COLLATE BINARY,
 tenant_id COLLATE BINARY"""

_MIGRATION_LOCK_ENTRY_SQL = """SELECT singleton, active_lock_id, active_owner_id,
 active_source_version, active_target_version, active_lock_epoch,
 active_fencing_token, active_acquired_at_ms, active_expires_at_ms,
 last_lock_epoch, last_fencing_token, updated_at_ms
 FROM ge_cycle_migration_lock WHERE singleton = 1"""

_USED_MIGRATION_LOCK_IDENTITY_ENTRY_SQL = """SELECT lock_id, lock_epoch,
 fencing_token, first_used_at_ms
 FROM ge_cycle_used_migration_lock_ids
 ORDER BY lock_id COLLATE BINARY"""

_LEGACY_OPERATION_ENTRY_SQL = """SELECT tenant_id, operation_id,
 operation_name, request_hash, result_blob, result_hash, committed_at_ms
 FROM ge_cycle_operations
 ORDER BY operation_id COLLATE BINARY, tenant_id COLLATE BINARY"""


def _identity_families() -> tuple[
    tuple[BaselineEntryKind, str, Callable[[object], BaselineEntryInput], int],
    ...,
]:
    return (
        ("schema-envelope", _SCHEMA_ENTRY_SQL, _schema_entry, 256),
        ("migration-lineage", _MIGRATION_ENTRY_SQL, _migration_entry, 256),
        ("stream-head", _STREAM_ENTRY_SQL, _stream_entry, 256),
        ("record-identity", _RECORD_ENTRY_SQL, _record_entry, 1),
        ("checkpoint-current", _CHECKPOINT_CURRENT_ENTRY_SQL, _checkpoint_current_entry, 1),
        (
            "checkpoint-revision",
            _CHECKPOINT_REVISION_ENTRY_SQL,
            _checkpoint_revision_entry,
            1,
        ),
        ("lease-current", _LEASE_CURRENT_ENTRY_SQL, _lease_current_entry, 256),
        (
            "used-lease-identity",
            _USED_LEASE_IDENTITY_ENTRY_SQL,
            _used_lease_identity_entry,
            256,
        ),
        ("legal-hold", _LEGAL_HOLD_ENTRY_SQL, _legal_hold_entry, 256),
        (
            "migration-lock-current",
            _MIGRATION_LOCK_ENTRY_SQL,
            _migration_lock_entry,
            256,
        ),
        (
            "used-migration-lock-identity",
            _USED_MIGRATION_LOCK_IDENTITY_ENTRY_SQL,
            _used_migration_lock_identity_entry,
            256,
        ),
        ("legacy-operation", _LEGACY_OPERATION_ENTRY_SQL, _legacy_operation_entry, 1),
    )


_LEGACY_OPERATION_NAMES = frozenset(
    {
        "append",
        "save-checkpoint",
        "delete-checkpoint",
        "acquire-lease",
        "renew-lease",
        "release-lease",
        "set-legal-hold",
        "acquire-migration-lock",
        "release-migration-lock",
    }
)
_MAX_LEGACY_RESULT_BYTES = 16_777_216


def _strict_object(pairs: list[tuple[str, JsonValue]]) -> JsonObject:
    result: JsonObject = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON object key")
        result[key] = value
    return result


def _reject_constant(token: str) -> None:
    raise ValueError(f"invalid JSON constant: {token}")


def _canonical_object_blob(value: object) -> JsonObject:
    if type(value) is not bytes or not 2 <= len(value) <= 1_048_576:
        raise ValueError("canonical object BLOB is outside bounds")
    decoded = json.loads(
        value.decode("utf-8"),
        object_pairs_hook=_strict_object,
        parse_constant=_reject_constant,
    )
    captured = portable_json_snapshot(decoded)
    if type(captured) is not dict or canonical_bytes(captured) != value:
        raise ValueError("canonical object BLOB identity drifted")
    return captured


def _schema_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 11 or values[0] != 1:
        raise ValueError("schema singleton shape drifted")
    return capture_baseline_entry(
        "schema-envelope",
        {"scope": "cycle-store"},
        {
            "createdAtMs": values[9],
            "currentVersion": values[0],
            "latestMigrationAppliedAtMs": values[7],
            "latestMigrationSha256": values[6],
            "maxReaderVersion": values[2],
            "maxWriterVersion": values[4],
            "minReaderVersion": values[1],
            "minWriterVersion": values[3],
            "providerDescriptorHash": values[8],
            "schemaIdentitySha256": values[5],
            "updatedAtMs": values[10],
        },
    )


def _migration_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 8:
        raise ValueError("migration lineage shape drifted")
    postconditions = _canonical_object_blob(values[7])
    if postconditions != {"requiredPostconditions": list(_REQUIRED_MIGRATION_POSTCONDITIONS)}:
        raise ValueError("migration postconditions drifted")
    return capture_baseline_entry(
        "migration-lineage",
        {"version": values[0]},
        {
            "appliedAtMs": values[5],
            "migrationId": values[2],
            "postconditions": postconditions,
            "previousVersion": values[1],
            "reversibility": values[6],
            "schemaIdentitySha256": values[4],
            "sqlSha256": values[3],
            "version": values[0],
        },
    )


def _stream_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 6:
        raise ValueError("stream head shape drifted")
    return capture_baseline_entry(
        "stream-head",
        {"streamId": values[1], "tenantId": values[0]},
        {
            "createdAtMs": values[4],
            "streamId": values[1],
            "tailRecordHash": values[3],
            "tailSequence": values[2],
            "tenantId": values[0],
            "updatedAtMs": values[5],
        },
    )


def _record_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 11:
        raise ValueError("record identity shape drifted")
    value_blob = values[7]
    record_blob = values[9]
    if (
        type(value_blob) is not bytes
        or type(record_blob) is not bytes
        or not 1 <= len(value_blob) <= 1_048_576
        or not len(value_blob) <= len(record_blob) <= 2_097_152
    ):
        raise ValueError("record carrier bounds drifted")
    record = cycle_store_adapter_codec.parse_stored_record(record_blob, "inspect-schema")
    if (
        record["recordId"] != values[3]
        or record["sequence"] != values[2]
        or record["previousRecordHash"] != values[4]
        or record["valueHash"] != values[5]
        or record["valueBytes"] != values[6]
        or record["recordHash"] != values[8]
        or len(value_blob) != values[6]
        or canonical_bytes(record) != record_blob
        or canonical_bytes(record["value"]) != value_blob
        or canonical_sha256(record["value"]) != values[5]
    ):
        raise ValueError("record carrier identity drifted")
    return capture_baseline_entry(
        "record-identity",
        {"recordId": values[3], "tenantId": values[0]},
        {
            "committedAtMs": values[10],
            "previousRecordHash": values[4],
            "recordHash": values[8],
            "recordId": values[3],
            "sequence": values[2],
            "streamId": values[1],
            "tenantId": values[0],
            "valueBytes": values[6],
            "valueHash": values[5],
        },
    )


def _checkpoint_current_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 14:
        raise ValueError("checkpoint current shape drifted")
    value_bytes = _integer(values[8], "checkpoint value bytes", 1)
    checkpoint_revision = _integer(values[12], "checkpoint revision", 1)
    committed_at_ms = _integer(values[13], "checkpoint commit time")
    value_blob = values[9]
    checkpoint_blob = values[10]
    summary_blob = values[11]
    if (
        value_bytes > 16_777_216
        or type(value_blob) is not bytes
        or type(checkpoint_blob) is not bytes
        or type(summary_blob) is not bytes
        or len(value_blob) != value_bytes
        or not value_bytes <= len(checkpoint_blob) <= 17_825_792
        or not 2 <= len(summary_blob) <= 1_048_576
    ):
        raise ValueError("checkpoint current carrier bounds drifted")
    checkpoint = cycle_store_adapter_codec.parse_stored_checkpoint(
        checkpoint_blob,
        "inspect-schema",
    )
    summary = cycle_store_adapter_codec.decode_ledger_result(
        "save-checkpoint",
        summary_blob,
    )
    expected_summary = cast(
        JsonObject,
        {key: value for key, value in checkpoint.items() if key != "value"},
    )
    if (
        canonical_bytes(checkpoint) != checkpoint_blob
        or canonical_bytes(checkpoint["value"]) != value_blob
        or canonical_sha256(checkpoint["value"]) != values[7]
        or cycle_store_adapter_codec.encode_ledger_result(
            "save-checkpoint",
            summary,
        )
        != summary_blob
        or summary != expected_summary
        or checkpoint["checkpointScope"] != values[1]
        or checkpoint["checkpointId"] != values[2]
        or checkpoint["streamId"] != values[3]
        or checkpoint["boundSequence"] != values[4]
        or checkpoint["boundRecordHash"] != values[5]
        or checkpoint["createdAt"] != values[6]
        or checkpoint["valueHash"] != values[7]
        or checkpoint["valueBytes"] != value_bytes
    ):
        raise ValueError("checkpoint current carrier identity drifted")
    return capture_baseline_entry(
        "checkpoint-current",
        {
            "checkpointId": values[2],
            "checkpointScope": values[1],
            "tenantId": values[0],
        },
        {
            "boundRecordHash": values[5],
            "boundSequence": values[4],
            "checkpointId": values[2],
            "checkpointRevision": checkpoint_revision,
            "checkpointScope": values[1],
            "committedAtMs": committed_at_ms,
            "createdAt": values[6],
            "streamId": values[3],
            "summary": summary,
            "tenantId": values[0],
            "valueBytes": value_bytes,
            "valueHash": values[7],
        },
    )


def _checkpoint_revision_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 12:
        raise ValueError("checkpoint revision shape drifted")
    revision = _integer(values[2], "checkpoint revision", 1)
    recorded_at_ms = _integer(values[11], "checkpoint revision time")
    action = values[4]
    payload = values[5:11]
    if action == "put":
        if any(value is None for value in payload):
            raise ValueError("checkpoint put revision payload is incomplete")
        summary_blob = values[5]
        bound_sequence = _integer(values[6], "checkpoint revision sequence")
        value_bytes = _integer(values[10], "checkpoint revision value bytes", 1)
        if (
            type(summary_blob) is not bytes
            or not 2 <= len(summary_blob) <= 1_048_576
            or value_bytes > 16_777_216
        ):
            raise ValueError("checkpoint put revision carrier bounds drifted")
        summary = cast(
            JsonObject,
            cycle_store_adapter_codec.decode_ledger_result(
                "save-checkpoint",
                summary_blob,
            ),
        )
        if (
            cycle_store_adapter_codec.encode_ledger_result(
                "save-checkpoint",
                summary,
            )
            != summary_blob
            or summary["checkpointScope"] != values[1]
            or summary["checkpointId"] != values[3]
            or summary["boundSequence"] != bound_sequence
            or summary["boundRecordHash"] != values[7]
            or summary["createdAt"] != values[8]
            or summary["valueHash"] != values[9]
            or summary["valueBytes"] != value_bytes
        ):
            raise ValueError("checkpoint put revision carrier identity drifted")
        state_summary: object = summary
        state_bound_sequence: object = bound_sequence
        state_value_bytes: object = value_bytes
    elif action == "delete":
        if any(value is not None for value in payload):
            raise ValueError("checkpoint delete revision payload is not null")
        state_summary = None
        state_bound_sequence = None
        state_value_bytes = None
    else:
        raise ValueError("checkpoint revision action is invalid")
    return capture_baseline_entry(
        "checkpoint-revision",
        {
            "checkpointScope": values[1],
            "revision": revision,
            "tenantId": values[0],
        },
        {
            "action": action,
            "boundRecordHash": values[7],
            "boundSequence": state_bound_sequence,
            "checkpointCreatedAt": values[8],
            "checkpointId": values[3],
            "checkpointScope": values[1],
            "recordedAtMs": recorded_at_ms,
            "revision": revision,
            "summary": state_summary,
            "tenantId": values[0],
            "valueBytes": state_value_bytes,
            "valueHash": values[9],
        },
    )


def _lease_current_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 11:
        raise ValueError("lease current shape drifted")
    return capture_baseline_entry(
        "lease-current",
        {"streamId": values[1], "tenantId": values[0]},
        {
            "activeAcquiredAtMs": values[6],
            "activeExpiresAtMs": values[7],
            "activeFencingToken": values[5],
            "activeHolderId": values[3],
            "activeLeaseEpoch": values[4],
            "activeLeaseId": values[2],
            "lastFencingToken": values[9],
            "lastLeaseEpoch": values[8],
            "streamId": values[1],
            "tenantId": values[0],
            "updatedAtMs": values[10],
        },
    )


def _used_lease_identity_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 6:
        raise ValueError("used lease identity shape drifted")
    return capture_baseline_entry(
        "used-lease-identity",
        {"leaseId": values[2], "streamId": values[1], "tenantId": values[0]},
        {
            "fencingToken": values[4],
            "firstUsedAtMs": values[5],
            "leaseEpoch": values[3],
            "leaseId": values[2],
            "streamId": values[1],
            "tenantId": values[0],
        },
    )


def _legal_hold_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 4:
        raise ValueError("legal hold shape drifted")
    return capture_baseline_entry(
        "legal-hold",
        {"holdId": values[2], "streamId": values[1], "tenantId": values[0]},
        {
            "holdId": values[2],
            "placedAtMs": values[3],
            "streamId": values[1],
            "tenantId": values[0],
        },
    )


def _migration_lock_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 12:
        raise ValueError("migration lock shape drifted")
    return capture_baseline_entry(
        "migration-lock-current",
        {"singleton": values[0]},
        {
            "activeAcquiredAtMs": values[7],
            "activeExpiresAtMs": values[8],
            "activeFencingToken": values[6],
            "activeLockEpoch": values[5],
            "activeLockId": values[1],
            "activeOwnerId": values[2],
            "activeSourceVersion": values[3],
            "activeTargetVersion": values[4],
            "lastFencingToken": values[10],
            "lastLockEpoch": values[9],
            "singleton": values[0],
            "updatedAtMs": values[11],
        },
    )


def _used_migration_lock_identity_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 4:
        raise ValueError("used migration lock identity shape drifted")
    return capture_baseline_entry(
        "used-migration-lock-identity",
        {"lockId": values[0]},
        {
            "fencingToken": values[2],
            "firstUsedAtMs": values[3],
            "lockEpoch": values[1],
            "lockId": values[0],
        },
    )


def _legacy_operation_entry(row: object) -> BaselineEntryInput:
    values = tuple(cast(tuple[object, ...], row))
    if len(values) != 7:
        raise ValueError("legacy operation shape drifted")
    operation_name = values[2]
    if type(operation_name) is not str or operation_name not in _LEGACY_OPERATION_NAMES:
        raise ValueError("legacy operation name is invalid")
    result_blob = values[4]
    if (
        type(result_blob) is not bytes
        or len(result_blob) < 2
        or len(result_blob) > _MAX_LEGACY_RESULT_BYTES
    ):
        raise ValueError("legacy operation result carrier is outside bounds")
    operation = cast(CycleStoreProviderOperation, operation_name)
    try:
        decoded = cycle_store_adapter_codec.decode_ledger_result(operation, result_blob)
        reencoded = cycle_store_adapter_codec.encode_ledger_result(operation, decoded)
    except Exception:
        raise ValueError("legacy operation result carrier is invalid") from None
    if reencoded != result_blob or canonical_sha256(decoded) != values[5]:
        raise ValueError("legacy operation result carrier identity drifted")
    tenant_id = values[0]
    operation_id = values[1]
    return capture_baseline_entry(
        "legacy-operation",
        {"operationId": operation_id, "tenantId": tenant_id},
        {
            "committedAtMs": values[6],
            "operationId": operation_id,
            "operationName": operation_name,
            "requestHash": values[3],
            "resultBlobSha256": hashlib.sha256(result_blob).hexdigest(),
            "resultHash": values[5],
            "tenantId": tenant_id,
        },
    )


def _integer(value: object, label: str, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum or value > MAX_SAFE_INTEGER:
        raise ValueError(f"SQLite v1 baseline {label} is outside bounds")
    return value


def _capture_sqlite_v1_baseline_source_summary_implementation(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    captured_at_ms: int,
    register_summary: Callable[[SQLiteV1BaselineSourceSummary], None],
) -> SQLiteV1BaselineSourceSummary:
    """Capture source identity and exact family counts without ending the transaction."""

    if not connection.in_exclusive_transaction:
        raise ValueError("SQLite v1 baseline capture requires an active EXCLUSIVE transaction")
    captured = _integer(captured_at_ms, "capture time")
    application_cursor = connection.execute("SELECT application_id FROM pragma_application_id")
    try:
        application_row = application_cursor.fetchone()
    finally:
        application_cursor.close()
    if application_row is None or _integer(application_row[0], "application ID") != 1_195_724_359:
        raise ValueError("SQLite v1 baseline application identity is invalid")
    user_version_cursor = connection.execute("SELECT user_version FROM pragma_user_version")
    try:
        user_version_row = user_version_cursor.fetchone()
    finally:
        user_version_cursor.close()
    if user_version_row is None or _integer(user_version_row[0], "user version", 1) != 1:
        raise ValueError("SQLite v1 baseline user version is invalid")
    source = connection.execute(
        """SELECT s.current_version, s.schema_identity_sha256,
                  s.provider_descriptor_hash, m.migration_id, m.sql_sha256,
                  s.latest_migration_applied_at_ms,
                  s.latest_migration_sha256, m.schema_identity_sha256
             FROM ge_cycle_schema AS s
             JOIN ge_cycle_migrations AS m ON m.version = s.current_version
            WHERE s.singleton = 1"""
    ).fetchone()
    if source is None or len(source) != 8 or _integer(source[0], "source version", 1) != 1:
        raise ValueError("SQLite v1 baseline source identity is invalid")
    if not all(type(value) is str for value in (*source[1:5], source[6], source[7])):
        raise ValueError("SQLite v1 baseline source identity is invalid")
    lineage_pair = (source[3], source[4])
    if (
        source[1] != SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256
        or source[2] != SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
        or source[6] != source[4]
        or source[7] != source[1]
        or lineage_pair
        not in {
            ("fresh-v1-baseline", _SOURCE_ASSETS.schema_sql_hash),
            ("alpha-v0-to-v1", _SOURCE_ASSETS.migration_sql_hash),
        }
    ):
        raise ValueError("SQLite v1 baseline frozen source identity is invalid")
    latest_migration_applied_at_ms = _integer(source[5], "latest migration applied time")
    envelope = validate_baseline_source_envelope(
        {
            "capturedAtMs": captured,
            "sourceApplicationId": 1_195_724_359,
            "sourceDescriptorHash": source[2],
            "sourceMigrationLineageId": source[3],
            "sourceMigrationLineageSha256": source[4],
            "sourceSchemaIdentitySha256": source[1],
            "sourceUserVersion": 1,
        }
    )
    counts: dict[BaselineEntryKind, int] = {}
    total = 0
    for kind, table in _TABLES:
        row = connection.execute(f"SELECT count(*) FROM {table}").fetchone()
        if row is None:
            raise ValueError("SQLite v1 baseline source count is missing")
        count = _integer(row[0], f"{kind} count")
        total += count
        if total > MAX_SAFE_INTEGER:
            raise ValueError("SQLite v1 baseline total count is outside bounds")
        counts[kind] = count
    if tuple(counts) != BASELINE_ENTRY_KINDS:
        raise AssertionError("baseline source family order drifted")

    maximum_row = connection.execute(_MAXIMUM_NON_CURSOR_OBSERVED_SQL).fetchone()
    lock_row = connection.execute(
        "SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1"
    ).fetchone()
    if maximum_row is None or lock_row is None:
        raise ValueError("SQLite v1 baseline provider clock is missing")
    maximum_non_cursor = _integer(maximum_row[0], "maximum non-cursor observed time")
    lock_high_water = _integer(lock_row[0], "provider clock high-water")
    if lock_high_water < maximum_non_cursor:
        raise ValueError("SQLite v1 provider clock high-water predates non-cursor source state")
    if captured < lock_high_water:
        raise ValueError("SQLite v1 baseline capture predates provider clock high-water")
    clock_evidence = SQLiteV1BaselineClockEvidence(
        captured_at_ms=captured,
        maximum_non_cursor_observed_at_ms=maximum_non_cursor,
        provider_high_water_at_ms=lock_high_water,
    )
    summary = SQLiteV1BaselineSourceSummary(
        canonical_bytes(envelope),
        MappingProxyType(counts),
        total,
        clock_evidence,
        connection,
        latest_migration_applied_at_ms,
        connection.total_changes,
        connection.transaction_epoch,
    )
    summary._assert_capture_transaction()
    register_summary(summary)
    return summary


def _bind_sqlite_v1_baseline_source_summary_capture() -> Callable[
    ..., SQLiteV1BaselineSourceSummary
]:
    implementation = _capture_sqlite_v1_baseline_source_summary_implementation
    register_summary = _register_sqlite_v1_baseline_source_summary

    def capture(
        connection: SQLiteV1BaselineConnectionOwner,
        *,
        captured_at_ms: int,
    ) -> SQLiteV1BaselineSourceSummary:
        return implementation(
            connection,
            captured_at_ms=captured_at_ms,
            register_summary=register_summary,
        )

    return capture


capture_sqlite_v1_baseline_source_summary = (
    _bind_sqlite_v1_baseline_source_summary_capture()
)


_NATIVE_PROJECTION_CONSTRUCTION_TOKEN = object()
_NATIVE_PROJECTION_IDENTITY_FAMILIES = _identity_families()
_NATIVE_PROJECTION_ASSERT_CAPTURE = SQLiteV1BaselineSourceSummary._assert_capture_transaction
_NATIVE_PROJECTION_REQUIRE_FAMILIES = SQLiteV1BaselineSourceSummary._require_implemented_families
_NATIVE_PROJECTION_RECONCILE_ENTRY = SQLiteV1BaselineSourceSummary._reconcile_identity_entry
_NATIVE_PROJECTION_OWNER_EXECUTE = SQLiteV1BaselineConnectionOwner.execute
_NATIVE_PROJECTION_CURSOR_FETCHMANY = _SQLiteCursorCapability.fetchmany
_NATIVE_PROJECTION_CURSOR_CLOSE = _SQLiteCursorCapability.close
_NATIVE_PROJECTION_CURSOR_IDENTITY_GET = object.__getattribute__
_NATIVE_PROJECTION_CURSOR_IDENTITY_TYPE = sqlite3.Cursor
_NATIVE_PROJECTION_FAULTS: ContextVar[Mapping[str, BaseException] | None] = ContextVar(
    "ge_sqlite_native_projection_faults", default=None
)
_NATIVE_PROJECTION_LAST_FAILURE_TELEMETRY: ContextVar[
    tuple[int, int, int, int] | None
] = ContextVar("ge_sqlite_native_projection_last_failure_telemetry", default=None)


def _bind_sqlite_v1_baseline_normalized_sql_sha256() -> Callable[[str], str]:
    ascii_format_whitespace = re.compile(r"[\x09-\x0d\x20]+")
    ascii_format_edges = "\x09\x0a\x0b\x0c\x0d\x20"
    sha256 = hashlib.sha256

    def normalized_sha256(sql: str) -> str:
        if type(sql) is not str:
            raise TypeError("GE_SQLITE_P11_NATIVE_PROJECTION_SQL_TEXT")
        line_normalized = sql.replace("\r\n", "\n").replace("\r", "\n")
        normalized = ascii_format_whitespace.sub(
            " ", line_normalized.strip(ascii_format_edges)
        )
        return sha256(normalized.encode("utf-8")).hexdigest()

    return normalized_sha256


_sqlite_v1_baseline_normalized_sql_sha256_intrinsic = (
    _bind_sqlite_v1_baseline_normalized_sql_sha256()
)


def _inject_sqlite_v1_baseline_native_projection_fault_intrinsic(point: str) -> None:
    faults = _NATIVE_PROJECTION_FAULTS.get()
    if faults is not None:
        error = faults.get(point)
        if error is not None:
            raise error


def _sqlite_v1_baseline_native_projection_graph_parts(
    adoption: object,
) -> tuple[object, object, object]:
    try:
        return (
            object.__getattribute__(adoption, "connection"),
            object.__getattribute__(adoption, "lineage"),
            object.__getattribute__(adoption, "generation"),
        )
    except (AttributeError, TypeError) as error:
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_GRAPH") from error


class _SQLiteV1BaselineNativeProjectionReceipt:
    """Opaque proof of one fully exhausted lower-owned 12-family projection."""

    __slots__ = ("__composition", "__projection", "__summary", "__weakref__")

    def __init__(
        self,
        _composition: object,
        _summary: SQLiteV1BaselineSourceSummary,
        _projection: tuple[BaselineEntryInput, ...],
        _token: object,
    ) -> None:
        raise TypeError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_CONSTRUCTION")

    def __setattr__(self, _name: str, _value: object) -> Never:
        _reject_sqlite_v1_baseline_native_projection_receipt_mutation(self)

    def __delattr__(self, _name: str) -> Never:
        _reject_sqlite_v1_baseline_native_projection_receipt_mutation(self)


class _NativeProjectionReadSessionNonce:
    __slots__ = ()


class _SQLiteV1BaselineNativeProjectionReceiptSnapshot(NamedTuple):
    contract: Literal["sqlite-v1-baseline-native-projection-np1"]
    route_id: Literal["main.baseline-entries"]
    lifecycle: Literal["receipt-issued", "consumed", "poisoned"]
    source_family_count: Literal[12]
    ordered_sql_sha256: tuple[str, ...]
    ordered_normalized_sql_sha256: tuple[str, ...]
    expected_family_counts: tuple[tuple[str, int], ...]
    observed_family_counts: tuple[tuple[str, int], ...]
    expected_projection_count: int
    retained_count: int
    source_envelope_sha256: str
    projection_sha256: str
    logical_native_read_count: Literal[12]
    prepare_count: Literal[12]
    terminal_observed_count: Literal[12]
    cursor_close_attempt_count: Literal[12]
    cursor_close_return_count: Literal[12]
    exact_resource_pairing: Literal[True]
    exact_owner: Literal[True]
    exact_begin_receipt: Literal[True]
    exact_composition: Literal[True]
    exact_connection: Literal[True]
    exact_lineage: Literal[True]
    exact_generation: Literal[True]
    exact_source_summary: Literal[True]
    exact_read_session: Literal[True]
    full_exhausted: Literal[True]
    native_source_provenance: Literal[True]
    native_projection_authority: Literal[True]
    genuine_zero_claim: Literal[False]
    one_shot: Literal[True]
    actual_native_io_count: None
    sql_authority: Literal[False]


@dataclass(frozen=True, slots=True)
class _NativeProjectionReceiptRecord:
    composition_ref: ReferenceType[object]
    owner_ref: ReferenceType[object]
    begin_receipt_ref: ReferenceType[object]
    connection_ref: ReferenceType[SQLiteV1BaselineConnectionOwner]
    lineage_ref: ReferenceType[object]
    generation_ref: ReferenceType[object]
    summary: SQLiteV1BaselineSourceSummary
    projection: tuple[BaselineEntryInput, ...]
    ordered_sql_sha256: tuple[str, ...]
    ordered_normalized_sql_sha256: tuple[str, ...]
    family_retirements: tuple[_NativeProjectionFamilyRetirement, ...]
    expected_family_counts: tuple[tuple[str, int], ...]
    observed_family_counts: tuple[tuple[str, int], ...]
    source_envelope_sha256: str
    projection_sha256: str
    prepare_count: int
    terminal_observed_count: int
    cursor_close_attempt_count: int
    cursor_close_return_count: int
    read_session_nonce: object


@dataclass(frozen=True, slots=True)
class _NativeProjectionFamilyRetirement:
    entry_kind: str
    resource_identity: sqlite3.Cursor
    raw_sql_sha256: str
    normalized_sql_sha256: str
    expected_count: int
    observed_count: int
    prepare_count: Literal[1]
    terminal_count: Literal[1]
    retirement_attempt_count: Literal[1]
    retirement_return_count: Literal[1]


class _NativeProjectionReceiptEntry(NamedTuple):
    receipt_ref: ReferenceType[_SQLiteV1BaselineNativeProjectionReceipt]
    record: _NativeProjectionReceiptRecord


def _native_projection_receipt_registry_cell() -> tuple[
    Callable[
        [
            object,
            SQLiteV1BaselineSourceSummary,
            tuple[BaselineEntryInput, ...],
            _NativeProjectionReceiptRecord,
        ],
        _SQLiteV1BaselineNativeProjectionReceipt,
    ],
    Callable[[object], _NativeProjectionReceiptRecord | None],
    Callable[[object], str | None],
    Callable[[object, str, str], bool],
    Callable[[object], None],
    Callable[[object], None],
    Callable[[object], int],
]:
    registry: dict[int, _NativeProjectionReceiptEntry] = {}
    lifecycles: dict[int, Literal["receipt-issued", "consumed", "poisoned"]] = {}
    receipt_type = _SQLiteV1BaselineNativeProjectionReceipt
    entry_factory = _NativeProjectionReceiptEntry
    weak_ref = ref
    object_new = object.__new__
    object_setattr = object.__setattr__

    def mint(
        composition: object,
        summary: SQLiteV1BaselineSourceSummary,
        projection: tuple[BaselineEntryInput, ...],
        record: _NativeProjectionReceiptRecord,
    ) -> _SQLiteV1BaselineNativeProjectionReceipt:
        receipt = object_new(receipt_type)
        object_setattr(
            receipt,
            "_SQLiteV1BaselineNativeProjectionReceipt__composition",
            composition,
        )
        object_setattr(
            receipt, "_SQLiteV1BaselineNativeProjectionReceipt__summary", summary
        )
        object_setattr(
            receipt,
            "_SQLiteV1BaselineNativeProjectionReceipt__projection",
            projection,
        )
        receipt_id = id(receipt)

        def discard_exact(
            dead_ref: ReferenceType[_SQLiteV1BaselineNativeProjectionReceipt],
        ) -> None:
            entry = registry.get(receipt_id)
            if entry is not None and entry.receipt_ref is dead_ref:
                registry.pop(receipt_id, None)
                lifecycles.pop(receipt_id, None)

        registry[receipt_id] = entry_factory(
            weak_ref(receipt, discard_exact), record
        )
        lifecycles[receipt_id] = "receipt-issued"
        return receipt

    def lookup(receipt: object) -> _NativeProjectionReceiptRecord | None:
        entry = registry.get(id(receipt))
        if entry is None or entry.receipt_ref() is not receipt:
            return None
        return entry.record

    def lifecycle_for(receipt: object) -> str | None:
        if lookup(receipt) is None:
            return None
        return lifecycles.get(id(receipt))

    def transition(receipt: object, expected: str, successor: str) -> bool:
        receipt_id = id(receipt)
        if lookup(receipt) is None or lifecycles.get(receipt_id) != expected:
            if receipt_id in lifecycles:
                lifecycles[receipt_id] = "poisoned"
            return False
        if successor not in {"consumed", "poisoned"}:
            lifecycles[receipt_id] = "poisoned"
            return False
        lifecycles[receipt_id] = cast(
            Literal["receipt-issued", "consumed", "poisoned"], successor
        )
        return True

    def poison(receipt: object) -> None:
        receipt_id = id(receipt)
        if lookup(receipt) is not None:
            lifecycles[receipt_id] = "poisoned"

    def abandon(receipt: object) -> None:
        receipt_id = id(receipt)
        entry = registry.get(receipt_id)
        if entry is None or entry.receipt_ref() is not receipt:
            return
        lifecycles[receipt_id] = "poisoned"
        registry.pop(receipt_id, None)
        lifecycles.pop(receipt_id, None)

    def count_for(composition: object) -> int:
        return sum(
            entry.record.composition_ref() is composition for entry in registry.values()
        )

    return mint, lookup, lifecycle_for, transition, poison, abandon, count_for


(
    _mint_native_projection_receipt,
    _lookup_native_projection_receipt_record,
    _native_projection_receipt_lifecycle_for,
    _transition_native_projection_receipt_lifecycle,
    _poison_native_projection_receipt,
    _abandon_native_projection_receipt,
    _count_native_projection_receipts_for_test,
) = _native_projection_receipt_registry_cell()
_install_sqlite_cursor_publication_native_projection_abandoner_intrinsic(
    _abandon_native_projection_receipt
)


def _native_projection_receipt_record_for_implementation(
    composition: object,
    receipt: object,
    reprove: Callable[[object, object, object], object],
    lookup_receipt: Callable[[object], _NativeProjectionReceiptRecord | None],
    source_record_for: Callable[
        [SQLiteV1BaselineSourceSummary], _NativeProjectionSourceSummaryRecord
    ],
    graph_parts: Callable[[object], tuple[object, object, object]],
    source_is_issued: Callable[
        [SQLiteV1BaselineSourceSummary, _NativeProjectionSourceSummaryRecord], bool
    ],
    canonical_encoder: Callable[[object], bytes],
    sha256: Callable[[bytes], Any],
    receipt_type: type[_SQLiteV1BaselineNativeProjectionReceipt],
    read_session_nonce_type: type[_NativeProjectionReadSessionNonce],
    object_getattribute: Callable[[object, str], object],
    poison_receipt: Callable[[object], None],
    family_retirement_type: type[_NativeProjectionFamilyRetirement],
    resource_identity_type: type[sqlite3.Cursor],
) -> _NativeProjectionReceiptRecord:
    if type(receipt) is not receipt_type:
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    record = lookup_receipt(receipt)
    if record is None:
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    registered_composition = record.composition_ref()
    if registered_composition is not composition:
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    try:
        presented_composition = object_getattribute(
            receipt, "_SQLiteV1BaselineNativeProjectionReceipt__composition"
        )
        presented_summary = object_getattribute(
            receipt, "_SQLiteV1BaselineNativeProjectionReceipt__summary"
        )
        presented_projection = object_getattribute(
            receipt, "_SQLiteV1BaselineNativeProjectionReceipt__projection"
        )
    except BaseException:
        poison_receipt(receipt)
        raise
    if (
        presented_composition is not composition
        or presented_summary is not record.summary
        or presented_projection is not record.projection
        or record.connection_ref() is not record.summary._connection
        or len(record.projection)
        != sum(count for _kind, count in record.expected_family_counts)
        or record.expected_family_counts != record.observed_family_counts
        or record.prepare_count != 12
        or record.terminal_observed_count != 12
        or record.cursor_close_attempt_count != 12
        or record.cursor_close_return_count != 12
        or type(record.read_session_nonce) is not read_session_nonce_type
        or len(record.family_retirements) != 12
        or tuple(item.entry_kind for item in record.family_retirements)
        != tuple(kind for kind, _count in record.expected_family_counts)
        or tuple(item.raw_sql_sha256 for item in record.family_retirements)
        != record.ordered_sql_sha256
        or tuple(item.normalized_sql_sha256 for item in record.family_retirements)
        != record.ordered_normalized_sql_sha256
        or len({id(item.resource_identity) for item in record.family_retirements}) != 12
        or any(
            type(item) is not family_retirement_type
            or type(item.resource_identity) is not resource_identity_type
            or item.expected_count != record.expected_family_counts[index][1]
            or item.observed_count != record.observed_family_counts[index][1]
            or item.prepare_count != 1
            or item.terminal_count != 1
            or item.retirement_attempt_count != 1
            or item.retirement_return_count != 1
            for index, item in enumerate(record.family_retirements)
        )
    ):
        poison_receipt(receipt)
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    source_record = source_record_for(record.summary)
    if not source_is_issued(record.summary, source_record):
        poison_receipt(receipt)
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    recomputed_projection_sha256 = sha256(
        b"graph-engineering/sqlite-v1-baseline-projection/v1\x00"
        + canonical_encoder(
            [
                {
                    "entryKind": entry.entry_kind,
                    "key": entry.key,
                    "state": entry.state,
                }
                for entry in record.projection
            ]
        )
    ).hexdigest()
    if (
        record.source_envelope_sha256
        != sha256(source_record.source_envelope_bytes).hexdigest()
        or record.projection_sha256 != recomputed_projection_sha256
    ):
        poison_receipt(receipt)
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    adoption = reprove(
        record.owner_ref(), record.begin_receipt_ref(), composition
    )
    connection, lineage, generation = graph_parts(adoption)
    if (
        connection is not record.connection_ref()
        or lineage is not record.lineage_ref()
        or generation is not record.generation_ref()
    ):
        poison_receipt(receipt)
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    return record


def _bind_native_projection_receipt_validator() -> Callable[
    [object, object], _NativeProjectionReceiptRecord
]:
    implementation = _native_projection_receipt_record_for_implementation
    reprove = _invoke_sqlite_cursor_publication_native_projection_reproof_intrinsic
    lookup_receipt = _lookup_native_projection_receipt_record
    source_record_for = _native_projection_source_summary_record_for
    graph_parts = _sqlite_v1_baseline_native_projection_graph_parts
    source_is_issued = _native_projection_source_summary_is_issued
    canonical_encoder = canonical_bytes
    sha256 = hashlib.sha256
    receipt_type = _SQLiteV1BaselineNativeProjectionReceipt
    read_session_nonce_type = _NativeProjectionReadSessionNonce
    object_getattribute = object.__getattribute__
    poison_receipt = _poison_native_projection_receipt
    family_retirement_type = _NativeProjectionFamilyRetirement
    resource_identity_type = _NATIVE_PROJECTION_CURSOR_IDENTITY_TYPE

    def validate(composition: object, receipt: object) -> _NativeProjectionReceiptRecord:
        return implementation(
            composition,
            receipt,
            reprove,
            lookup_receipt,
            source_record_for,
            graph_parts,
            source_is_issued,
            canonical_encoder,
            sha256,
            receipt_type,
            read_session_nonce_type,
            object_getattribute,
            poison_receipt,
            family_retirement_type,
            resource_identity_type,
        )

    return validate


_native_projection_receipt_record_for = _bind_native_projection_receipt_validator()


def _bind_native_projection_receipt_mutation_rejection() -> Callable[
    [_SQLiteV1BaselineNativeProjectionReceipt], Never
]:
    lookup = _lookup_native_projection_receipt_record
    poison = _poison_native_projection_receipt

    def reject(receipt: _SQLiteV1BaselineNativeProjectionReceipt) -> Never:
        primary = ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
        record = lookup(receipt)
        if record is not None:
            poison(receipt)
        raise primary

    return reject


_reject_sqlite_v1_baseline_native_projection_receipt_mutation = (
    _bind_native_projection_receipt_mutation_rejection()
)


def _produce_sqlite_v1_baseline_native_projection_receipt_implementation(
    owner: object,
    begin_receipt: object,
    composition: object,
    summary: SQLiteV1BaselineSourceSummary,
    identity_families: tuple[
        tuple[BaselineEntryKind, str, Callable[[object], BaselineEntryInput], int], ...
    ],
    assert_capture: Callable[[SQLiteV1BaselineSourceSummary], None],
    require_families: Callable[[SQLiteV1BaselineSourceSummary], None],
    reconcile_entry: Callable[
        [SQLiteV1BaselineSourceSummary, BaselineEntryInput, JsonObject], None
    ],
    owner_execute: Callable[
        [SQLiteV1BaselineConnectionOwner, str, tuple[object, ...]],
        _SQLiteCursorCapability,
    ],
    cursor_fetchmany: Callable[
        [_SQLiteCursorCapability, int], list[tuple[object, ...]]
    ],
    cursor_close: Callable[[_SQLiteCursorCapability], None],
    inject_fault: Callable[[str], None],
    reprove: Callable[[object, object, object], object],
    source_record_for: Callable[
        [SQLiteV1BaselineSourceSummary], _NativeProjectionSourceSummaryRecord
    ],
    claim_source: Callable[
        [SQLiteV1BaselineSourceSummary, _NativeProjectionSourceSummaryRecord], None
    ],
    graph_parts: Callable[[object], tuple[object, object, object]],
    baseline_entry_kinds: tuple[BaselineEntryKind, ...],
    decode_envelope: Callable[[bytes], JsonObject],
    canonical_encoder: Callable[[object], bytes],
    sha256: Callable[[bytes], Any],
    mint_receipt: Callable[
        [
            object,
            SQLiteV1BaselineSourceSummary,
            tuple[BaselineEntryInput, ...],
            _NativeProjectionReceiptRecord,
        ],
        _SQLiteV1BaselineNativeProjectionReceipt,
    ],
    nonce_factory: Callable[[], object],
    receipt_record_factory: Callable[..., _NativeProjectionReceiptRecord],
    weak_ref: Callable[[object], Any],
    set_failure_telemetry: Callable[
        [tuple[int, int, int, int] | None], object
    ],
    family_retirement_factory: Callable[..., _NativeProjectionFamilyRetirement],
    cursor_identity_get: Callable[[object, str], object],
    cursor_identity_type: type[sqlite3.Cursor],
    normalized_sql_sha256: Callable[[str], str],
) -> _SQLiteV1BaselineNativeProjectionReceipt:
    """Drain all fixed source families and mint one exact lower-native receipt.

    No caller-controlled SQL, count, projection, decoder, iterator, cursor, or
    callback crosses this boundary.  The only data capability is a provenance-
    registered source summary already bound to its exact connection/generation.
    """

    exact_summary: SQLiteV1BaselineSourceSummary | None = None
    source_selected = False
    prepare_count = 0
    terminal_observed_count = 0
    cursor_close_attempt_count = 0
    cursor_close_return_count = 0
    set_failure_telemetry(None)
    try:
        source_record = source_record_for(summary)
        exact_summary = summary
        assert_capture(exact_summary)
        require_families(exact_summary)
        if exact_summary._identity_iteration_state.started:
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_REPLAY")

        initial_adoption = reprove(owner, begin_receipt, composition)
        initial_parts = graph_parts(initial_adoption)
        source_connection = source_record.connection_ref()
        if source_connection is None or initial_parts[0] is not source_connection:
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_CONNECTION")
        claim_source(exact_summary, source_record)
        source_selected = True

        def reprove_graph() -> tuple[object, object, object]:
            checked = reprove(owner, begin_receipt, composition)
            parts = graph_parts(checked)
            current_record = source_record_for(exact_summary)
            if current_record is not source_record or parts[0] is not source_connection:
                raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_CONNECTION")
            return parts

        reprove_graph()
        exact_summary._identity_iteration_state.started = True
        projection: list[BaselineEntryInput] = []
        observed_counts: list[tuple[str, int]] = []
        family_retirements: list[_NativeProjectionFamilyRetirement] = []
        envelope = decode_envelope(source_record.source_envelope_bytes)
        families = identity_families
        ordered_sql_sha256 = tuple(
            sha256(sql.encode("utf-8")).hexdigest()
            for _kind, sql, _capture, _fetch_size in families
        )
        ordered_normalized_sql_sha256 = tuple(
            normalized_sql_sha256(sql)
            for _kind, sql, _capture, _fetch_size in families
        )
        for family_ordinal, (kind, sql, capture, fetch_size) in enumerate(families):
            reprove_graph()
            assert_capture(exact_summary)
            cursor: _SQLiteCursorCapability | None = None
            family_primary: BaseException | None = None
            resource_identity: sqlite3.Cursor | None = None
            emitted = 0
            try:
                inject_fault(f"prepare-before:{kind}")
                reprove_graph()
                cursor = owner_execute(source_connection, sql, ())
                candidate_identity = cursor_identity_get(
                    cursor, "_SQLiteCursorCapability__cursor"
                )
                if type(candidate_identity) is not cursor_identity_type:
                    raise ValueError(
                        "GE_SQLITE_P11_NATIVE_PROJECTION_RESOURCE_PAIRING"
                    )
                resource_identity = candidate_identity
                prepare_count += 1
                reprove_graph()
                inject_fault(f"prepare-after:{kind}")
                while True:
                    inject_fault(f"fetch-before:{kind}")
                    reprove_graph()
                    assert_capture(exact_summary)
                    rows = cursor_fetchmany(cursor, fetch_size)
                    reprove_graph()
                    inject_fault(f"fetch-after:{kind}")
                    if not rows:
                        inject_fault(f"terminal-before:{kind}")
                        reprove_graph()
                        terminal_observed_count += 1
                        reprove_graph()
                        inject_fault(f"terminal-after:{kind}")
                        break
                    for row in rows:
                        inject_fault(f"decode-before:{kind}:{emitted}")
                        inject_fault(f"decode-before:{kind}")
                        reprove_graph()
                        assert_capture(exact_summary)
                        reprove_graph()
                        entry = capture(row)
                        reconcile_entry(exact_summary, entry, envelope)
                        reprove_graph()
                        inject_fault(f"decode-after:{kind}")
                        inject_fault(f"decode-after:{kind}:{emitted}")
                        projection.append(entry)
                        emitted += 1
                expected_for_kind = dict(source_record.counts_tuple)[kind]
                if emitted != expected_for_kind:
                    raise ValueError(
                        f"GE_SQLITE_P11_NATIVE_PROJECTION_{kind.upper()}_COUNT"
                    )
            except BaseException as error:
                family_primary = error
            finally:
                if cursor is not None:
                    try:
                        inject_fault(f"close-before:{kind}")
                    except BaseException as boundary_error:
                        if family_primary is None:
                            family_primary = boundary_error
                    try:
                        reprove_graph()
                    except BaseException as boundary_error:
                        if family_primary is None:
                            family_primary = boundary_error
                    cursor_close_attempt_count += 1
                    try:
                        cursor_close(cursor)
                        cursor_close_return_count += 1
                    except BaseException as close_error:
                        if family_primary is None:
                            family_primary = close_error
                    try:
                        reprove_graph()
                    except BaseException as boundary_error:
                        if family_primary is None:
                            family_primary = boundary_error
                    try:
                        inject_fault(f"close-after:{kind}")
                    except BaseException as boundary_error:
                        if family_primary is None:
                            family_primary = boundary_error
            if family_primary is not None:
                raise family_primary
            observed_counts.append((kind, emitted))
            if resource_identity is None:
                raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RESOURCE_PAIRING")
            family_retirements.append(
                family_retirement_factory(
                    kind,
                    resource_identity,
                    ordered_sql_sha256[family_ordinal],
                    ordered_normalized_sql_sha256[family_ordinal],
                    dict(source_record.counts_tuple)[kind],
                    emitted,
                    1,
                    1,
                    1,
                    1,
                )
            )
            reprove_graph()
        retained_projection = tuple(projection)
        expected_counts = tuple(
            source_record.counts_tuple
        )
        observed_family_counts = tuple(observed_counts)
        if (
            tuple(kind for kind, _count in observed_family_counts) != baseline_entry_kinds
            or observed_family_counts != expected_counts
            or len(retained_projection) != source_record.expected_entry_count
            or prepare_count != 12
            or terminal_observed_count != 12
            or cursor_close_attempt_count != 12
            or cursor_close_return_count != 12
        ):
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_CONSERVATION")
        exact_summary._identity_iteration_state.completed = True
        _adoption_connection, adoption_lineage, adoption_generation = reprove_graph()
        inject_fault("digest-before")
        projection_sha256 = sha256(
            b"graph-engineering/sqlite-v1-baseline-projection/v1\x00"
            + canonical_encoder(
                [
                    {
                        "entryKind": entry.entry_kind,
                        "key": entry.key,
                        "state": entry.state,
                    }
                    for entry in retained_projection
                ]
            )
        ).hexdigest()
        inject_fault("digest-after")
        inject_fault("mint-before")
        receipt_record = receipt_record_factory(
                weak_ref(composition),
                weak_ref(owner),
                weak_ref(begin_receipt),
                weak_ref(exact_summary._connection),
                weak_ref(adoption_lineage),
                weak_ref(adoption_generation),
                exact_summary,
                retained_projection,
                ordered_sql_sha256,
                ordered_normalized_sql_sha256,
                tuple(family_retirements),
                expected_counts,
                observed_family_counts,
                sha256(source_record.source_envelope_bytes).hexdigest(),
                projection_sha256,
                prepare_count,
                terminal_observed_count,
                cursor_close_attempt_count,
                cursor_close_return_count,
                nonce_factory(),
            )
        receipt = mint_receipt(
            composition,
            exact_summary,
            retained_projection,
            receipt_record,
        )
        inject_fault("mint-after")
        return receipt
    except BaseException as primary:
        set_failure_telemetry(
            (
                prepare_count,
                terminal_observed_count,
                cursor_close_attempt_count,
                cursor_close_return_count,
            )
        )
        if exact_summary is not None and source_selected:
            with suppress(BaseException):
                exact_summary._identity_iteration_state.poisoned = True
        raise primary


def _bind_sqlite_v1_baseline_native_projection_producer(
    implementation: Callable[..., _SQLiteV1BaselineNativeProjectionReceipt],
) -> Callable[
    [object, object, object, object], object,
]:
    identity_families = _NATIVE_PROJECTION_IDENTITY_FAMILIES
    assert_capture = _NATIVE_PROJECTION_ASSERT_CAPTURE
    require_families = _NATIVE_PROJECTION_REQUIRE_FAMILIES
    reconcile_entry = _NATIVE_PROJECTION_RECONCILE_ENTRY
    owner_execute = _NATIVE_PROJECTION_OWNER_EXECUTE
    cursor_fetchmany = _NATIVE_PROJECTION_CURSOR_FETCHMANY
    cursor_close = _NATIVE_PROJECTION_CURSOR_CLOSE
    inject_fault = _inject_sqlite_v1_baseline_native_projection_fault_intrinsic
    reprove = _invoke_sqlite_cursor_publication_native_projection_reproof_intrinsic
    source_record_for = _native_projection_source_summary_record_for
    claim_source = _claim_native_projection_source_summary
    graph_parts = _sqlite_v1_baseline_native_projection_graph_parts
    baseline_entry_kinds = BASELINE_ENTRY_KINDS
    json_loads = json.loads
    canonical_encoder = canonical_bytes
    sha256 = hashlib.sha256
    mint_receipt = _mint_native_projection_receipt
    nonce_factory = _NativeProjectionReadSessionNonce
    receipt_record_factory = _NativeProjectionReceiptRecord
    weak_ref = ref
    set_failure_telemetry = _NATIVE_PROJECTION_LAST_FAILURE_TELEMETRY.set
    summary_type = SQLiteV1BaselineSourceSummary
    provenance_error_factory = SQLiteV1BaselineNativeProjectionProvenanceError
    family_retirement_factory = _NativeProjectionFamilyRetirement
    cursor_identity_get = _NATIVE_PROJECTION_CURSOR_IDENTITY_GET
    cursor_identity_type = _NATIVE_PROJECTION_CURSOR_IDENTITY_TYPE

    normalized_sql_sha256 = _sqlite_v1_baseline_normalized_sql_sha256_intrinsic

    def decode_envelope(value: bytes) -> JsonObject:
        decoded = json_loads(value)
        if type(decoded) is not dict:
            raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_SOURCE_PROVENANCE")
        return cast(JsonObject, decoded)

    def produce(
        owner: object,
        begin_receipt: object,
        composition: object,
        summary: object,
    ) -> object:
        if type(summary) is not summary_type:
            raise provenance_error_factory()
        return implementation(
            owner,
            begin_receipt,
            composition,
            summary,
            identity_families,
            assert_capture,
            require_families,
            reconcile_entry,
            owner_execute,
            cursor_fetchmany,
            cursor_close,
            inject_fault,
            reprove,
            source_record_for,
            claim_source,
            graph_parts,
            baseline_entry_kinds,
            decode_envelope,
            canonical_encoder,
            sha256,
            mint_receipt,
            nonce_factory,
            receipt_record_factory,
            weak_ref,
            set_failure_telemetry,
            family_retirement_factory,
            cursor_identity_get,
            cursor_identity_type,
            normalized_sql_sha256,
        )

    return produce


_install_sqlite_cursor_publication_native_projection_producer_intrinsic(
    _bind_sqlite_v1_baseline_native_projection_producer(
        _produce_sqlite_v1_baseline_native_projection_receipt_implementation
    )
)


def _read_sqlite_v1_baseline_native_projection_receipt_snapshot_implementation(
    composition: object,
    receipt: object,
    validate: Callable[[object, object], _NativeProjectionReceiptRecord],
    lifecycle_for: Callable[[object], str | None],
    snapshot_factory: Callable[..., _SQLiteV1BaselineNativeProjectionReceiptSnapshot],
) -> _SQLiteV1BaselineNativeProjectionReceiptSnapshot:
    record = validate(composition, receipt)
    lifecycle = lifecycle_for(receipt)
    if lifecycle not in {"receipt-issued", "consumed", "poisoned"}:
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_INVALID")
    return snapshot_factory(
        "sqlite-v1-baseline-native-projection-np1",
        "main.baseline-entries",
        lifecycle,
        12,
        record.ordered_sql_sha256,
        record.ordered_normalized_sql_sha256,
        record.expected_family_counts,
        record.observed_family_counts,
        sum(count for _kind, count in record.expected_family_counts),
        len(record.projection),
        record.source_envelope_sha256,
        record.projection_sha256,
        12,
        12,
        12,
        12,
        12,
        True,
        True,
        True,
        True,
        True,
        True,
        True,
        True,
        True,
        True,
        True,
        True,
        False,
        True,
        None,
        False,
    )


def _consume_sqlite_v1_baseline_native_projection_receipt_implementation(
    composition: object,
    receipt: object,
    validate: Callable[[object, object], _NativeProjectionReceiptRecord],
    transition: Callable[[object, str, str], bool],
) -> int:
    record = validate(composition, receipt)
    if not transition(receipt, "receipt-issued", "consumed"):
        raise ValueError("GE_SQLITE_P11_NATIVE_PROJECTION_RECEIPT_REPLAY")
    return len(record.projection)


def _bind_native_projection_receipt_views() -> tuple[
    Callable[
        [object, object], _SQLiteV1BaselineNativeProjectionReceiptSnapshot
    ],
    Callable[[object, object], int],
]:
    validate = _native_projection_receipt_record_for
    lifecycle_for = _native_projection_receipt_lifecycle_for
    transition = _transition_native_projection_receipt_lifecycle
    snapshot_factory = _SQLiteV1BaselineNativeProjectionReceiptSnapshot
    snapshot_implementation = (
        _read_sqlite_v1_baseline_native_projection_receipt_snapshot_implementation
    )
    consume_implementation = (
        _consume_sqlite_v1_baseline_native_projection_receipt_implementation
    )

    def snapshot(
        composition: object, receipt: object
    ) -> _SQLiteV1BaselineNativeProjectionReceiptSnapshot:
        return snapshot_implementation(
            composition, receipt, validate, lifecycle_for, snapshot_factory
        )

    def consume(composition: object, receipt: object) -> int:
        return consume_implementation(composition, receipt, validate, transition)

    return snapshot, consume


(
    _read_sqlite_v1_baseline_native_projection_receipt_snapshot_intrinsic,
    _consume_sqlite_v1_baseline_native_projection_receipt_intrinsic,
) = _bind_native_projection_receipt_views()
_install_sqlite_cursor_publication_native_projection_receipt_views_intrinsic(
    _read_sqlite_v1_baseline_native_projection_receipt_snapshot_intrinsic,
    _consume_sqlite_v1_baseline_native_projection_receipt_intrinsic,
)

globals().pop("_mint_native_projection_receipt", None)
globals().pop("_lookup_native_projection_receipt_record", None)
globals().pop("_native_projection_receipt_lifecycle_for", None)
globals().pop("_transition_native_projection_receipt_lifecycle", None)
globals().pop("_poison_native_projection_receipt", None)
globals().pop("_abandon_native_projection_receipt", None)
globals().pop("_native_projection_receipt_record_for", None)
globals().pop("_native_projection_receipt_record_for_implementation", None)
globals().pop("_register_native_projection_source_summary", None)
globals().pop("_native_projection_source_summary_record_for", None)
globals().pop("_claim_native_projection_source_summary", None)
globals().pop("_native_projection_source_summary_is_issued", None)
globals().pop("_NATIVE_PROJECTION_CONSTRUCTION_TOKEN", None)
globals().pop("_NATIVE_PROJECTION_IDENTITY_FAMILIES", None)
globals().pop("_NATIVE_PROJECTION_ASSERT_CAPTURE", None)
globals().pop("_NATIVE_PROJECTION_REQUIRE_FAMILIES", None)
globals().pop("_NATIVE_PROJECTION_RECONCILE_ENTRY", None)
globals().pop("_NATIVE_PROJECTION_OWNER_EXECUTE", None)
globals().pop("_NATIVE_PROJECTION_CURSOR_FETCHMANY", None)
globals().pop("_NATIVE_PROJECTION_CURSOR_CLOSE", None)
globals().pop("_NativeProjectionSourceSummaryRecord", None)
globals().pop("_NativeProjectionReceiptRecord", None)
globals().pop("_NativeProjectionReceiptEntry", None)
globals().pop("_SQLiteV1BaselineNativeProjectionReceipt", None)
globals().pop("_NativeProjectionReadSessionNonce", None)
globals().pop("_NativeProjectionFamilyRetirement", None)
globals().pop("_NATIVE_PROJECTION_CURSOR_IDENTITY_GET", None)
globals().pop("_NATIVE_PROJECTION_CURSOR_IDENTITY_TYPE", None)
globals().pop("_consume_sqlite_v1_baseline_native_projection_receipt_intrinsic", None)
globals().pop("_native_projection_source_summary_registry_cell", None)
globals().pop("_native_projection_receipt_registry_cell", None)
globals().pop("_bind_native_projection_receipt_validator", None)
globals().pop("_bind_native_projection_receipt_mutation_rejection", None)
globals().pop("_bind_sqlite_v1_baseline_native_projection_producer", None)
globals().pop("_produce_sqlite_v1_baseline_native_projection_receipt_implementation", None)
globals().pop("_bind_native_projection_receipt_views", None)
globals().pop("_read_sqlite_v1_baseline_native_projection_receipt_snapshot_implementation", None)
globals().pop("_consume_sqlite_v1_baseline_native_projection_receipt_implementation", None)
globals().pop("_register_sqlite_v1_baseline_source_summary", None)
globals().pop("_bind_sqlite_v1_baseline_source_summary_capture", None)
globals().pop("_capture_sqlite_v1_baseline_source_summary_implementation", None)
globals().pop("_bind_sqlite_v1_baseline_normalized_sql_sha256", None)
globals().pop(
    "_install_sqlite_cursor_publication_native_projection_abandoner_intrinsic", None
)
globals().pop(
    "_install_sqlite_cursor_publication_native_projection_producer_intrinsic", None
)
globals().pop(
    "_install_sqlite_cursor_publication_native_projection_receipt_views_intrinsic",
    None,
)
globals().pop(
    "_invoke_sqlite_cursor_publication_native_projection_reproof_intrinsic", None
)
