"""Transaction-external TEMP storage preparation for SQLite baseline staging."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections.abc import Iterator, Mapping
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from types import TracebackType
from typing import Literal, Never, cast

from .canonical import canonical_sha256
from .cycle_store_provider import CycleStoreProviderOperation, cycle_store_adapter_codec
from .models import MAX_SAFE_INTEGER
from .sqlite_operation_baseline import (
    BASELINE_ENTRY_KINDS,
    BaselineEntryInput,
    BaselineEntryKind,
    BaselineProjectionIdentity,
    baseline_entry_sort_key,
    capture_baseline_entry,
)
from .sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    _CooperativeSourceItem,
    _CooperativeWriteReceipt,
    _issue_cooperative_write_receipt,
    _SQLiteCursorCapability,
)

DEFAULT_SQLITE_V1_BASELINE_TEMP_CACHE_KIB = 8_192
MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB = 1_024
MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB = 65_536

SQLITE_V1_BASELINE_COMMON_STAGE_TABLE = "ge_blr_stage"
SQLITE_V1_BASELINE_RELATION_KEYS_VIEW = "ge_blr_relation_keys"
SQLITE_V1_BASELINE_RELATION_TABLES: tuple[str, ...] = (
    "ge_blr_schema",
    "ge_blr_migrations",
    "ge_blr_streams",
    "ge_blr_records",
    "ge_blr_checkpoint_current",
    "ge_blr_checkpoint_revisions",
    "ge_blr_leases",
    "ge_blr_used_leases",
    "ge_blr_holds",
    "ge_blr_migration_lock",
    "ge_blr_used_migration_locks",
    "ge_blr_legacy_operations",
)

SQLiteV1BaselineTempStageState = Literal["open", "poisoned", "disposed"]

_KIND_RANK = {kind: rank for rank, kind in enumerate(BASELINE_ENTRY_KINDS)}
_KEY_BLOB = (
    "BLOB NOT NULL CHECK (typeof(key_blob) = 'blob' AND length(key_blob) BETWEEN 2 AND 4096)"
)


def _relation_table(name: str, columns: str, primary_key: str) -> str:
    return f"""CREATE TEMP TABLE {name} (
 key_blob {_KEY_BLOB},
 {columns},
 PRIMARY KEY ({primary_key}),
 UNIQUE (key_blob)
) STRICT, WITHOUT ROWID"""


_COMMON_KIND_CHECK = " OR\n  ".join(
    f"(kind_rank = {rank} AND entry_kind = '{kind}')"
    for rank, kind in enumerate(BASELINE_ENTRY_KINDS)
)

_LEGACY_TAIL_FIELDS = (
    "tail_exists",
    "tail_sequence",
    "tail_record_hash",
    "appended_records",
)
_LEGACY_CHECKPOINT_FIELDS = (
    "checkpoint_scope",
    "checkpoint_id",
    "checkpoint_stream_id",
    "checkpoint_bound_sequence",
    "checkpoint_bound_record_hash",
    "checkpoint_created_at",
    "checkpoint_value_hash",
    "checkpoint_value_bytes",
)
_LEGACY_DELETE_FIELDS = ("checkpoint_deleted",)
_LEGACY_LEASE_FIELDS = (
    "lease_id",
    "lease_holder_id",
    "lease_epoch",
    "lease_fencing_token",
    "lease_acquired_at_ms",
    "lease_expires_at_ms",
)
_LEGACY_RELEASE_FIELDS = (
    "lease_status",
    "last_lease_epoch",
    "last_lease_fencing_token",
)
_LEGACY_LOCK_FIELDS = (
    "lock_id",
    "lock_owner_id",
    "lock_source_version",
    "lock_target_version",
    "lock_epoch",
    "lock_fencing_token",
    "lock_acquired_at_ms",
    "lock_expires_at_ms",
)
_LEGACY_DERIVED_FIELDS = (
    *_LEGACY_TAIL_FIELDS,
    *_LEGACY_CHECKPOINT_FIELDS,
    *_LEGACY_DELETE_FIELDS,
    *_LEGACY_LEASE_FIELDS,
    *_LEGACY_RELEASE_FIELDS,
    *_LEGACY_LOCK_FIELDS,
)


def _all_null_sql(fields: tuple[str, ...]) -> str:
    return " AND ".join(f"{field} IS NULL" for field in fields)


def _all_present_sql(fields: tuple[str, ...]) -> str:
    return " AND ".join(f"{field} IS NOT NULL" for field in fields)


def _other_legacy_fields(*retained: tuple[str, ...]) -> tuple[str, ...]:
    keep = {field for fields in retained for field in fields}
    return tuple(field for field in _LEGACY_DERIVED_FIELDS if field not in keep)


_LEGACY_OPERATION_CHECK = " OR\n  ".join(
    (
        "(operation_name = 'append' "
        f"AND {_all_present_sql(_LEGACY_TAIL_FIELDS)} "
        "AND tail_exists = 1 AND tail_sequence >= 0 AND tail_record_hash IS NOT NULL "
        "AND appended_records > 0 AND "
        f"{_all_null_sql(_other_legacy_fields(_LEGACY_TAIL_FIELDS))})",
        "(operation_name = 'save-checkpoint' AND "
        f"{_all_present_sql(_LEGACY_CHECKPOINT_FIELDS)} AND "
        f"{_all_null_sql(_other_legacy_fields(_LEGACY_CHECKPOINT_FIELDS))})",
        "(operation_name = 'delete-checkpoint' AND checkpoint_deleted IS NOT NULL "
        "AND checkpoint_deleted IN (0, 1) AND "
        f"{_all_null_sql(_other_legacy_fields(_LEGACY_DELETE_FIELDS))})",
        "(operation_name = 'acquire-lease' AND "
        f"{_all_present_sql(_LEGACY_LEASE_FIELDS)} "
        "AND lease_epoch = lease_fencing_token "
        "AND lease_expires_at_ms > lease_acquired_at_ms AND "
        f"{_all_null_sql(_other_legacy_fields(_LEGACY_LEASE_FIELDS))})",
        "(operation_name = 'renew-lease' AND "
        f"{_all_present_sql(_LEGACY_LEASE_FIELDS)} "
        "AND lease_epoch = lease_fencing_token "
        "AND lease_expires_at_ms > lease_acquired_at_ms AND "
        f"{_all_null_sql(_other_legacy_fields(_LEGACY_LEASE_FIELDS))})",
        "(operation_name = 'release-lease' AND lease_status = 'released' "
        "AND last_lease_epoch IS NOT NULL AND last_lease_fencing_token IS NOT NULL "
        "AND last_lease_epoch = last_lease_fencing_token AND "
        f"{_all_null_sql(_other_legacy_fields(_LEGACY_RELEASE_FIELDS))})",
        f"(operation_name = 'set-legal-hold' AND {_all_null_sql(_LEGACY_DERIVED_FIELDS)})",
        "(operation_name = 'acquire-migration-lock' AND "
        f"{_all_present_sql(_LEGACY_LOCK_FIELDS)} "
        "AND lock_epoch = lock_fencing_token "
        "AND lock_target_version > lock_source_version "
        "AND lock_expires_at_ms > lock_acquired_at_ms AND "
        f"{_all_null_sql(_other_legacy_fields(_LEGACY_LOCK_FIELDS))})",
        f"(operation_name = 'release-migration-lock' AND {_all_null_sql(_LEGACY_DERIVED_FIELDS)})",
    )
)

_TEMP_TABLE_DDL: tuple[tuple[str, str], ...] = (
    (
        SQLITE_V1_BASELINE_COMMON_STAGE_TABLE,
        f"""CREATE TEMP TABLE {SQLITE_V1_BASELINE_COMMON_STAGE_TABLE} (
 kind_rank INTEGER NOT NULL CHECK (typeof(kind_rank) = 'integer' AND kind_rank BETWEEN 0 AND 11),
 entry_kind TEXT NOT NULL CHECK (typeof(entry_kind) = 'text'),
 key_blob {_KEY_BLOB},
 state_blob BLOB NOT NULL
   CHECK (typeof(state_blob) = 'blob' AND length(state_blob) BETWEEN 2 AND 2097152),
 PRIMARY KEY (kind_rank, key_blob),
 UNIQUE (entry_kind, key_blob),
 CHECK ({_COMMON_KIND_CHECK})
) STRICT, WITHOUT ROWID""",
    ),
    (
        "ge_blr_schema",
        _relation_table(
            "ge_blr_schema",
            """singleton INTEGER NOT NULL CHECK (singleton = 1),
 current_version INTEGER NOT NULL,
 min_reader_version INTEGER NOT NULL,
 max_reader_version INTEGER NOT NULL,
 min_writer_version INTEGER NOT NULL,
 max_writer_version INTEGER NOT NULL,
 schema_identity_sha256 TEXT NOT NULL COLLATE BINARY,
 latest_migration_sha256 TEXT NOT NULL COLLATE BINARY,
 provider_descriptor_hash TEXT NOT NULL COLLATE BINARY,
 latest_migration_applied_at_ms INTEGER NOT NULL,
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 CHECK (updated_at_ms >= created_at_ms)""",
            "singleton",
        ),
    ),
    (
        "ge_blr_migrations",
        _relation_table(
            "ge_blr_migrations",
            """version INTEGER NOT NULL,
 previous_version INTEGER NOT NULL,
 migration_id TEXT NOT NULL COLLATE BINARY,
 sql_sha256 TEXT NOT NULL COLLATE BINARY,
 schema_identity_sha256 TEXT NOT NULL COLLATE BINARY,
 applied_at_ms INTEGER NOT NULL""",
            "version",
        ),
    ),
    (
        "ge_blr_streams",
        _relation_table(
            "ge_blr_streams",
            """tenant_id TEXT NOT NULL COLLATE BINARY,
 stream_id TEXT NOT NULL COLLATE BINARY,
 tail_sequence INTEGER NOT NULL,
 tail_record_hash TEXT,
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 CHECK (tail_sequence >= -1),
 CHECK ((tail_sequence = -1 AND tail_record_hash IS NULL)
   OR (tail_sequence >= 0 AND tail_record_hash IS NOT NULL)),
 CHECK (updated_at_ms >= created_at_ms)""",
            "tenant_id, stream_id",
        ),
    ),
    (
        "ge_blr_records",
        _relation_table(
            "ge_blr_records",
            """tenant_id TEXT NOT NULL COLLATE BINARY,
 stream_id TEXT NOT NULL COLLATE BINARY,
 record_id TEXT NOT NULL COLLATE BINARY,
 sequence INTEGER NOT NULL,
 previous_record_hash TEXT,
 record_hash TEXT NOT NULL COLLATE BINARY,
 value_hash TEXT NOT NULL COLLATE BINARY,
 value_bytes INTEGER NOT NULL,
 committed_at_ms INTEGER NOT NULL,
 CHECK (sequence >= 0),
 CHECK ((sequence = 0 AND previous_record_hash IS NULL)
   OR (sequence > 0 AND previous_record_hash IS NOT NULL)),
 CHECK (value_bytes >= 1)""",
            "tenant_id, record_id",
        ),
    ),
    (
        "ge_blr_checkpoint_current",
        _relation_table(
            "ge_blr_checkpoint_current",
            """tenant_id TEXT NOT NULL COLLATE BINARY,
 checkpoint_scope TEXT NOT NULL COLLATE BINARY,
 checkpoint_id TEXT NOT NULL COLLATE BINARY,
 stream_id TEXT NOT NULL COLLATE BINARY,
 bound_sequence INTEGER NOT NULL,
 bound_record_hash TEXT NOT NULL COLLATE BINARY,
 checkpoint_revision INTEGER NOT NULL,
 checkpoint_created_at TEXT NOT NULL COLLATE BINARY,
 value_hash TEXT NOT NULL COLLATE BINARY,
 value_bytes INTEGER NOT NULL,
 committed_at_ms INTEGER NOT NULL""",
            "tenant_id, checkpoint_scope, checkpoint_id",
        ),
    ),
    (
        "ge_blr_checkpoint_revisions",
        _relation_table(
            "ge_blr_checkpoint_revisions",
            """tenant_id TEXT NOT NULL COLLATE BINARY,
 checkpoint_scope TEXT NOT NULL COLLATE BINARY,
 revision INTEGER NOT NULL,
 checkpoint_id TEXT NOT NULL COLLATE BINARY,
 action TEXT NOT NULL CHECK (action IN ('put', 'delete')),
 stream_id TEXT,
 bound_sequence INTEGER,
 bound_record_hash TEXT,
 checkpoint_created_at TEXT,
 value_hash TEXT,
 value_bytes INTEGER,
 recorded_at_ms INTEGER NOT NULL,
 CHECK (
   (action = 'put' AND stream_id IS NOT NULL AND bound_sequence IS NOT NULL
    AND bound_record_hash IS NOT NULL AND checkpoint_created_at IS NOT NULL
    AND value_hash IS NOT NULL AND value_bytes IS NOT NULL)
   OR
   (action = 'delete' AND stream_id IS NULL AND bound_sequence IS NULL
    AND bound_record_hash IS NULL AND checkpoint_created_at IS NULL
    AND value_hash IS NULL AND value_bytes IS NULL)
 )""",
            "tenant_id, checkpoint_scope, revision",
        ),
    ),
    (
        "ge_blr_leases",
        _relation_table(
            "ge_blr_leases",
            """tenant_id TEXT NOT NULL COLLATE BINARY,
 stream_id TEXT NOT NULL COLLATE BINARY,
 active_lease_id TEXT,
 active_holder_id TEXT,
 active_lease_epoch INTEGER,
 active_fencing_token INTEGER,
 active_acquired_at_ms INTEGER,
 active_expires_at_ms INTEGER,
 last_lease_epoch INTEGER NOT NULL,
 last_fencing_token INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 CHECK (last_lease_epoch = last_fencing_token AND last_lease_epoch >= 0),
 CHECK (
   (active_lease_id IS NULL AND active_holder_id IS NULL
    AND active_lease_epoch IS NULL AND active_fencing_token IS NULL
    AND active_acquired_at_ms IS NULL AND active_expires_at_ms IS NULL)
   OR
   (active_lease_id IS NOT NULL AND active_holder_id IS NOT NULL
    AND active_lease_epoch IS NOT NULL AND active_fencing_token IS NOT NULL
    AND active_acquired_at_ms IS NOT NULL AND active_expires_at_ms IS NOT NULL
    AND active_lease_epoch = active_fencing_token
    AND active_lease_epoch = last_lease_epoch
    AND active_expires_at_ms > active_acquired_at_ms)
 )""",
            "tenant_id, stream_id",
        ),
    ),
    (
        "ge_blr_used_leases",
        _relation_table(
            "ge_blr_used_leases",
            """tenant_id TEXT NOT NULL COLLATE BINARY,
 stream_id TEXT NOT NULL COLLATE BINARY,
 lease_id TEXT NOT NULL COLLATE BINARY,
 lease_epoch INTEGER NOT NULL,
 fencing_token INTEGER NOT NULL,
 first_used_at_ms INTEGER NOT NULL,
 CHECK (lease_epoch = fencing_token AND lease_epoch >= 1)""",
            "tenant_id, stream_id, lease_id",
        ),
    ),
    (
        "ge_blr_holds",
        _relation_table(
            "ge_blr_holds",
            """tenant_id TEXT NOT NULL COLLATE BINARY,
 stream_id TEXT NOT NULL COLLATE BINARY,
 hold_id TEXT NOT NULL COLLATE BINARY,
 placed_at_ms INTEGER NOT NULL""",
            "tenant_id, stream_id, hold_id",
        ),
    ),
    (
        "ge_blr_migration_lock",
        _relation_table(
            "ge_blr_migration_lock",
            """singleton INTEGER NOT NULL CHECK (singleton = 1),
 active_lock_id TEXT,
 active_owner_id TEXT,
 active_source_version INTEGER,
 active_target_version INTEGER,
 active_lock_epoch INTEGER,
 active_fencing_token INTEGER,
 active_acquired_at_ms INTEGER,
 active_expires_at_ms INTEGER,
 last_lock_epoch INTEGER NOT NULL,
 last_fencing_token INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 CHECK (last_lock_epoch = last_fencing_token AND last_lock_epoch >= 0),
 CHECK (
   (active_lock_id IS NULL AND active_owner_id IS NULL
    AND active_source_version IS NULL AND active_target_version IS NULL
    AND active_lock_epoch IS NULL AND active_fencing_token IS NULL
    AND active_acquired_at_ms IS NULL AND active_expires_at_ms IS NULL)
   OR
   (active_lock_id IS NOT NULL AND active_owner_id IS NOT NULL
    AND active_source_version IS NOT NULL AND active_target_version IS NOT NULL
    AND active_lock_epoch IS NOT NULL AND active_fencing_token IS NOT NULL
    AND active_acquired_at_ms IS NOT NULL AND active_expires_at_ms IS NOT NULL
    AND active_target_version > active_source_version
    AND active_lock_epoch = active_fencing_token
    AND active_lock_epoch = last_lock_epoch
    AND active_expires_at_ms > active_acquired_at_ms)
 )""",
            "singleton",
        ),
    ),
    (
        "ge_blr_used_migration_locks",
        _relation_table(
            "ge_blr_used_migration_locks",
            """lock_id TEXT NOT NULL COLLATE BINARY,
 lock_epoch INTEGER NOT NULL,
 fencing_token INTEGER NOT NULL,
 first_used_at_ms INTEGER NOT NULL,
 CHECK (lock_epoch = fencing_token AND lock_epoch >= 1)""",
            "lock_id",
        ),
    ),
    (
        "ge_blr_legacy_operations",
        _relation_table(
            "ge_blr_legacy_operations",
            f"""tenant_id TEXT NOT NULL COLLATE BINARY,
 operation_id TEXT NOT NULL COLLATE BINARY,
 operation_name TEXT NOT NULL COLLATE BINARY,
 request_hash TEXT NOT NULL COLLATE BINARY,
 result_hash TEXT NOT NULL COLLATE BINARY,
 result_blob_sha256 TEXT NOT NULL COLLATE BINARY,
 committed_at_ms INTEGER NOT NULL,
 tail_exists INTEGER,
 tail_sequence INTEGER,
 tail_record_hash TEXT,
 appended_records INTEGER,
 checkpoint_scope TEXT,
 checkpoint_id TEXT,
 checkpoint_stream_id TEXT,
 checkpoint_bound_sequence INTEGER,
 checkpoint_bound_record_hash TEXT,
 checkpoint_created_at TEXT,
 checkpoint_value_hash TEXT,
 checkpoint_value_bytes INTEGER,
 checkpoint_deleted INTEGER,
 lease_id TEXT,
 lease_holder_id TEXT,
 lease_epoch INTEGER,
 lease_fencing_token INTEGER,
 lease_acquired_at_ms INTEGER,
 lease_expires_at_ms INTEGER,
 lease_status TEXT,
 last_lease_epoch INTEGER,
 last_lease_fencing_token INTEGER,
 lock_id TEXT,
 lock_owner_id TEXT,
 lock_source_version INTEGER,
 lock_target_version INTEGER,
 lock_epoch INTEGER,
 lock_fencing_token INTEGER,
 lock_acquired_at_ms INTEGER,
 lock_expires_at_ms INTEGER,
 CHECK ({_LEGACY_OPERATION_CHECK})""",
            "tenant_id, operation_id",
        ),
    ),
)

_TEMP_INDEX_DDL: tuple[str, ...] = (
    "CREATE UNIQUE INDEX ge_blr_records_tenant_hash_uidx ON ge_blr_records "
    "(tenant_id, record_hash)",
    "CREATE UNIQUE INDEX ge_blr_records_stream_sequence_uidx ON ge_blr_records "
    "(tenant_id, stream_id, sequence)",
    "CREATE INDEX ge_blr_records_stream_position_idx ON ge_blr_records "
    "(tenant_id, stream_id, sequence, record_hash)",
    "CREATE INDEX ge_blr_checkpoint_current_record_idx ON ge_blr_checkpoint_current "
    "(tenant_id, stream_id, bound_sequence, bound_record_hash)",
    "CREATE INDEX ge_blr_checkpoint_revisions_latest_idx ON ge_blr_checkpoint_revisions "
    "(tenant_id, checkpoint_scope, checkpoint_id, revision DESC)",
    "CREATE INDEX ge_blr_checkpoint_revisions_record_idx ON ge_blr_checkpoint_revisions "
    "(tenant_id, stream_id, bound_sequence, bound_record_hash)",
    "CREATE UNIQUE INDEX ge_blr_used_leases_epoch_uidx ON ge_blr_used_leases "
    "(tenant_id, stream_id, lease_epoch)",
    "CREATE UNIQUE INDEX ge_blr_used_leases_fencing_uidx ON ge_blr_used_leases "
    "(tenant_id, stream_id, fencing_token)",
    "CREATE UNIQUE INDEX ge_blr_used_migration_locks_epoch_uidx "
    "ON ge_blr_used_migration_locks (lock_epoch)",
    "CREATE UNIQUE INDEX ge_blr_used_migration_locks_fencing_uidx "
    "ON ge_blr_used_migration_locks (fencing_token)",
)

_TEMP_INDEX_NAMES: tuple[str, ...] = (
    "ge_blr_records_tenant_hash_uidx",
    "ge_blr_records_stream_sequence_uidx",
    "ge_blr_records_stream_position_idx",
    "ge_blr_checkpoint_current_record_idx",
    "ge_blr_checkpoint_revisions_latest_idx",
    "ge_blr_checkpoint_revisions_record_idx",
    "ge_blr_used_leases_epoch_uidx",
    "ge_blr_used_leases_fencing_uidx",
    "ge_blr_used_migration_locks_epoch_uidx",
    "ge_blr_used_migration_locks_fencing_uidx",
)

_TEMP_RELATION_KEYS_VIEW_DDL = f"""CREATE TEMP VIEW {SQLITE_V1_BASELINE_RELATION_KEYS_VIEW} AS
 SELECT 0 AS kind_rank, key_blob FROM ge_blr_schema
 UNION ALL SELECT 1, key_blob FROM ge_blr_migrations
 UNION ALL SELECT 2, key_blob FROM ge_blr_streams
 UNION ALL SELECT 3, key_blob FROM ge_blr_records
 UNION ALL SELECT 4, key_blob FROM ge_blr_checkpoint_current
 UNION ALL SELECT 5, key_blob FROM ge_blr_checkpoint_revisions
 UNION ALL SELECT 6, key_blob FROM ge_blr_leases
 UNION ALL SELECT 7, key_blob FROM ge_blr_used_leases
 UNION ALL SELECT 8, key_blob FROM ge_blr_holds
 UNION ALL SELECT 9, key_blob FROM ge_blr_migration_lock
 UNION ALL SELECT 10, key_blob FROM ge_blr_used_migration_locks
 UNION ALL SELECT 11, key_blob FROM ge_blr_legacy_operations"""


@dataclass(frozen=True, slots=True)
class _RelationInsert:
    """One closed, module-owned relation statement and its bound values."""

    sql: str
    parameters: tuple[object, ...]


_SCHEMA_RELATION_INSERT = """INSERT INTO temp.ge_blr_schema (
 key_blob, singleton, current_version, min_reader_version, max_reader_version,
 min_writer_version, max_writer_version, schema_identity_sha256,
 latest_migration_sha256, provider_descriptor_hash,
 latest_migration_applied_at_ms, created_at_ms, updated_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

_MIGRATION_RELATION_INSERT = """INSERT INTO temp.ge_blr_migrations (
 key_blob, version, previous_version, migration_id, sql_sha256,
 schema_identity_sha256, applied_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?)"""

_STREAM_RELATION_INSERT = """INSERT INTO temp.ge_blr_streams (
 key_blob, tenant_id, stream_id, tail_sequence, tail_record_hash,
 created_at_ms, updated_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?)"""

_RECORD_RELATION_INSERT = """INSERT INTO temp.ge_blr_records (
 key_blob, tenant_id, stream_id, record_id, sequence, previous_record_hash,
 record_hash, value_hash, value_bytes, committed_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

_CHECKPOINT_CURRENT_RELATION_INSERT = """INSERT INTO temp.ge_blr_checkpoint_current (
 key_blob, tenant_id, checkpoint_scope, checkpoint_id, stream_id,
 bound_sequence, bound_record_hash, checkpoint_revision, checkpoint_created_at,
 value_hash, value_bytes, committed_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

_CHECKPOINT_REVISION_RELATION_INSERT = """INSERT INTO temp.ge_blr_checkpoint_revisions (
 key_blob, tenant_id, checkpoint_scope, revision, checkpoint_id, action,
 stream_id, bound_sequence, bound_record_hash, checkpoint_created_at,
 value_hash, value_bytes, recorded_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

_LEASE_RELATION_INSERT = """INSERT INTO temp.ge_blr_leases (
 key_blob, tenant_id, stream_id, active_lease_id, active_holder_id,
 active_lease_epoch, active_fencing_token, active_acquired_at_ms,
 active_expires_at_ms, last_lease_epoch, last_fencing_token, updated_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

_USED_LEASE_RELATION_INSERT = """INSERT INTO temp.ge_blr_used_leases (
 key_blob, tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
 first_used_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?)"""

_HOLD_RELATION_INSERT = """INSERT INTO temp.ge_blr_holds (
 key_blob, tenant_id, stream_id, hold_id, placed_at_ms
) VALUES (?, ?, ?, ?, ?)"""

_MIGRATION_LOCK_RELATION_INSERT = """INSERT INTO temp.ge_blr_migration_lock (
 key_blob, singleton, active_lock_id, active_owner_id, active_source_version,
 active_target_version, active_lock_epoch, active_fencing_token,
 active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
 last_fencing_token, updated_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

_USED_MIGRATION_LOCK_RELATION_INSERT = """INSERT INTO temp.ge_blr_used_migration_locks (
 key_blob, lock_id, lock_epoch, fencing_token, first_used_at_ms
) VALUES (?, ?, ?, ?, ?)"""

_LEGACY_RELATION_INSERT = """INSERT INTO temp.ge_blr_legacy_operations (
 key_blob, tenant_id, operation_id, operation_name, request_hash, result_hash,
 result_blob_sha256, committed_at_ms, tail_exists, tail_sequence,
 tail_record_hash, appended_records, checkpoint_scope, checkpoint_id,
 checkpoint_stream_id, checkpoint_bound_sequence, checkpoint_bound_record_hash,
 checkpoint_created_at, checkpoint_value_hash, checkpoint_value_bytes,
 checkpoint_deleted, lease_id, lease_holder_id, lease_epoch,
 lease_fencing_token, lease_acquired_at_ms, lease_expires_at_ms, lease_status,
 last_lease_epoch, last_lease_fencing_token, lock_id, lock_owner_id,
 lock_source_version, lock_target_version, lock_epoch, lock_fencing_token,
 lock_acquired_at_ms, lock_expires_at_ms
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"""

_LEGACY_RESULT_SELECT = """SELECT operation_name, request_hash, result_blob,
 result_hash, committed_at_ms
 FROM main.ge_cycle_operations
 WHERE tenant_id = ? AND operation_id = ?"""


def _relation_insert_for(entry: BaselineEntryInput) -> _RelationInsert:
    """Project one recaptured entry into exactly one fixed relation statement."""

    state = entry.state
    key_blob = entry.key_bytes
    kind = entry.entry_kind
    if kind == "schema-envelope":
        return _RelationInsert(
            _SCHEMA_RELATION_INSERT,
            (
                key_blob,
                1,
                state["currentVersion"],
                state["minReaderVersion"],
                state["maxReaderVersion"],
                state["minWriterVersion"],
                state["maxWriterVersion"],
                state["schemaIdentitySha256"],
                state["latestMigrationSha256"],
                state["providerDescriptorHash"],
                state["latestMigrationAppliedAtMs"],
                state["createdAtMs"],
                state["updatedAtMs"],
            ),
        )
    if kind == "migration-lineage":
        return _RelationInsert(
            _MIGRATION_RELATION_INSERT,
            (
                key_blob,
                state["version"],
                state["previousVersion"],
                state["migrationId"],
                state["sqlSha256"],
                state["schemaIdentitySha256"],
                state["appliedAtMs"],
            ),
        )
    if kind == "stream-head":
        return _RelationInsert(
            _STREAM_RELATION_INSERT,
            (
                key_blob,
                state["tenantId"],
                state["streamId"],
                state["tailSequence"],
                state["tailRecordHash"],
                state["createdAtMs"],
                state["updatedAtMs"],
            ),
        )
    if kind == "record-identity":
        return _RelationInsert(
            _RECORD_RELATION_INSERT,
            (
                key_blob,
                state["tenantId"],
                state["streamId"],
                state["recordId"],
                state["sequence"],
                state["previousRecordHash"],
                state["recordHash"],
                state["valueHash"],
                state["valueBytes"],
                state["committedAtMs"],
            ),
        )
    if kind == "checkpoint-current":
        return _RelationInsert(
            _CHECKPOINT_CURRENT_RELATION_INSERT,
            (
                key_blob,
                state["tenantId"],
                state["checkpointScope"],
                state["checkpointId"],
                state["streamId"],
                state["boundSequence"],
                state["boundRecordHash"],
                state["checkpointRevision"],
                state["createdAt"],
                state["valueHash"],
                state["valueBytes"],
                state["committedAtMs"],
            ),
        )
    if kind == "checkpoint-revision":
        summary = state["summary"]
        stream_id = summary["streamId"] if isinstance(summary, dict) else None
        return _RelationInsert(
            _CHECKPOINT_REVISION_RELATION_INSERT,
            (
                key_blob,
                state["tenantId"],
                state["checkpointScope"],
                state["revision"],
                state["checkpointId"],
                state["action"],
                stream_id,
                state["boundSequence"],
                state["boundRecordHash"],
                state["checkpointCreatedAt"],
                state["valueHash"],
                state["valueBytes"],
                state["recordedAtMs"],
            ),
        )
    if kind == "lease-current":
        return _RelationInsert(
            _LEASE_RELATION_INSERT,
            (
                key_blob,
                state["tenantId"],
                state["streamId"],
                state["activeLeaseId"],
                state["activeHolderId"],
                state["activeLeaseEpoch"],
                state["activeFencingToken"],
                state["activeAcquiredAtMs"],
                state["activeExpiresAtMs"],
                state["lastLeaseEpoch"],
                state["lastFencingToken"],
                state["updatedAtMs"],
            ),
        )
    if kind == "used-lease-identity":
        return _RelationInsert(
            _USED_LEASE_RELATION_INSERT,
            (
                key_blob,
                state["tenantId"],
                state["streamId"],
                state["leaseId"],
                state["leaseEpoch"],
                state["fencingToken"],
                state["firstUsedAtMs"],
            ),
        )
    if kind == "legal-hold":
        return _RelationInsert(
            _HOLD_RELATION_INSERT,
            (
                key_blob,
                state["tenantId"],
                state["streamId"],
                state["holdId"],
                state["placedAtMs"],
            ),
        )
    if kind == "migration-lock-current":
        return _RelationInsert(
            _MIGRATION_LOCK_RELATION_INSERT,
            (
                key_blob,
                state["singleton"],
                state["activeLockId"],
                state["activeOwnerId"],
                state["activeSourceVersion"],
                state["activeTargetVersion"],
                state["activeLockEpoch"],
                state["activeFencingToken"],
                state["activeAcquiredAtMs"],
                state["activeExpiresAtMs"],
                state["lastLockEpoch"],
                state["lastFencingToken"],
                state["updatedAtMs"],
            ),
        )
    if kind == "used-migration-lock-identity":
        return _RelationInsert(
            _USED_MIGRATION_LOCK_RELATION_INSERT,
            (
                key_blob,
                state["lockId"],
                state["lockEpoch"],
                state["fencingToken"],
                state["firstUsedAtMs"],
            ),
        )
    raise ValueError("legacy operation projection requires its source carrier")


def _exact_epoch_milliseconds(value: object) -> int:
    if type(value) is not str:
        raise ValueError("legacy result timestamp is invalid")
    time_part = value[value.find("T") + 1 :]
    zone_offset = (
        len(time_part) - 1
        if time_part.endswith("Z")
        else max(time_part.rfind("+"), time_part.rfind("-"))
    )
    clock = time_part[:zone_offset]
    fraction = clock.partition(".")[2]
    if len(fraction) > 3 and any(digit != "0" for digit in fraction[3:]):
        raise ValueError("legacy result timestamp is not exact milliseconds")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("legacy result timestamp is invalid") from None
    if parsed.tzinfo is None or parsed.microsecond % 1_000 != 0:
        raise ValueError("legacy result timestamp is not exact milliseconds")
    epoch = datetime(1970, 1, 1, tzinfo=UTC)
    delta = parsed.astimezone(UTC) - epoch
    milliseconds = delta.days * 86_400_000 + delta.seconds * 1_000 + delta.microseconds // 1_000
    if milliseconds < 0 or milliseconds > MAX_SAFE_INTEGER:
        raise ValueError("legacy result timestamp is outside bounds")
    return milliseconds


def _legacy_result_projection(
    operation: CycleStoreProviderOperation,
    decoded: object,
) -> tuple[object, ...]:
    """Return all nullable legacy columns in their single selected group."""

    empty: tuple[object, ...] = (None,) * 30
    if operation == "append":
        result = cast(dict[str, object], decoded)
        tail = cast(dict[str, object], result["tail"])
        return (
            int(cast(bool, tail["exists"])),
            tail["sequence"],
            tail["recordHash"],
            result["appendedRecords"],
            *empty[4:],
        )
    if operation == "save-checkpoint":
        result = cast(dict[str, object], decoded)
        return (
            *empty[:4],
            result["checkpointScope"],
            result["checkpointId"],
            result["streamId"],
            result["boundSequence"],
            result["boundRecordHash"],
            result["createdAt"],
            result["valueHash"],
            result["valueBytes"],
            *empty[12:],
        )
    if operation == "delete-checkpoint":
        result = cast(dict[str, object], decoded)
        return (*empty[:12], int(cast(bool, result["deleted"])), *empty[13:])
    if operation in ("acquire-lease", "renew-lease"):
        result = cast(dict[str, object], decoded)
        return (
            *empty[:13],
            result["leaseId"],
            result["holderId"],
            result["leaseEpoch"],
            result["fencingToken"],
            _exact_epoch_milliseconds(result["acquiredAt"]),
            _exact_epoch_milliseconds(result["expiresAt"]),
            *empty[19:],
        )
    if operation == "release-lease":
        result = cast(dict[str, object], decoded)
        return (
            *empty[:19],
            result["status"],
            result["lastLeaseEpoch"],
            result["lastFencingToken"],
            *empty[22:],
        )
    if operation == "acquire-migration-lock":
        result = cast(dict[str, object], decoded)
        return (
            *empty[:22],
            result["lockId"],
            result["ownerId"],
            result["sourceSchemaVersion"],
            result["targetSchemaVersion"],
            result["lockEpoch"],
            result["fencingToken"],
            _exact_epoch_milliseconds(result["acquiredAt"]),
            _exact_epoch_milliseconds(result["expiresAt"]),
        )
    # set-legal-hold and release-migration-lock intentionally claim no
    # result-specific scalar because their recoverable legacy state has no
    # corresponding normalized column.
    return empty


def _validate_baseline_temp_catalog(connection: SQLiteV1BaselineConnectionOwner) -> None:
    expected_objects = {
        *[("table", name) for name, _sql in _TEMP_TABLE_DDL],
        *[("index", name) for name in _TEMP_INDEX_NAMES],
        ("view", SQLITE_V1_BASELINE_RELATION_KEYS_VIEW),
    }
    cursor = connection.execute(
        "SELECT type, name FROM temp.sqlite_schema "
        "WHERE substr(lower(name), 1, 7) = 'ge_blr_' ORDER BY type, name"
    )
    try:
        object_rows = cursor.fetchmany(len(expected_objects) + 1)
    finally:
        cursor.close()
    if (
        len(object_rows) != len(expected_objects)
        or {(row[0], row[1]) for row in object_rows if len(row) == 2} != expected_objects
    ):
        raise ValueError("BLR_STAGE_WRITE_COUNT: baseline TEMP catalog identity drifted")

    cursor = connection.execute("PRAGMA temp.table_list")
    try:
        table_rows = cursor.fetchmany(len(_TEMP_TABLE_DDL) + 16)
    finally:
        cursor.close()
    catalog = {
        row[1]: (row[4], row[5])
        for row in table_rows
        if len(row) == 6 and row[1] in {name for name, _sql in _TEMP_TABLE_DDL}
    }
    if catalog != {name: (1, 1) for name, _sql in _TEMP_TABLE_DDL}:
        raise ValueError("BLR_STAGE_WRITE_COUNT: baseline TEMP table shape drifted")


def _recapture_ordered_stage_row(row: tuple[object, ...]) -> BaselineEntryInput:
    """Revalidate one exact common-stage row without trusting stored JSON bytes."""

    if len(row) != 4:
        raise ValueError("BLR_HANDOFF_ROW: ordered TEMP stage row shape is invalid")
    kind_rank, entry_kind, key_blob, state_blob = row
    if (
        type(kind_rank) is not int
        or kind_rank < 0
        or kind_rank >= len(BASELINE_ENTRY_KINDS)
        or type(entry_kind) is not str
        or entry_kind != BASELINE_ENTRY_KINDS[kind_rank]
        or type(key_blob) is not bytes
        or type(state_blob) is not bytes
    ):
        raise ValueError("BLR_HANDOFF_ROW: ordered TEMP stage kind or bytes are invalid")
    try:
        key = json.loads(key_blob)
        state = json.loads(state_blob)
        captured = capture_baseline_entry(BASELINE_ENTRY_KINDS[kind_rank], key, state)
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        raise ValueError("BLR_HANDOFF_ROW: ordered TEMP stage JSON is invalid") from None
    if captured.key_bytes != key_blob or captured.state_bytes != state_blob:
        raise ValueError("BLR_HANDOFF_ROW: ordered TEMP stage bytes are not canonical")
    if baseline_entry_sort_key(captured) != (kind_rank, key_blob):
        raise ValueError("BLR_HANDOFF_ROW: ordered TEMP stage rank recapture drifted")
    return captured


class _SQLiteV1BaselineOrderedStageReader:
    """Private one-shot, one-row-at-a-time cursor over the verified common stage."""

    __slots__ = (
        "_closed",
        "_counts_by_rank",
        "_cursor",
        "_eof",
        "_expected_total_changes",
        "_iterated",
        "_observed_count",
        "_stage",
    )

    def __init__(
        self,
        stage: SQLiteV1BaselineTempStage,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
    ) -> None:
        self._stage = stage
        self._cursor = cursor
        self._expected_total_changes = expected_total_changes
        self._observed_count = 0
        self._counts_by_rank = [0] * len(BASELINE_ENTRY_KINDS)
        self._iterated = False
        self._eof = False
        self._closed = False

    @property
    def observed_count(self) -> int:
        return self._observed_count

    @property
    def reached_eof(self) -> bool:
        return self._eof

    @property
    def counts_by_rank(self) -> tuple[int, ...]:
        return tuple(self._counts_by_rank)

    def __iter__(self) -> Iterator[BaselineEntryInput]:
        if self._iterated:
            self._fail("BLR_HANDOFF_ONESHOT: ordered TEMP stage reader was iterated twice")
        self._iterated = True
        return self

    def __next__(self) -> BaselineEntryInput:
        if self._closed:
            if self._eof:
                raise StopIteration
            self._fail("BLR_HANDOFF_EARLY_CLOSE: ordered TEMP stage reader is closed")
        self._stage._assert_ordered_handoff_fence(self._expected_total_changes)
        try:
            row = self._cursor.fetchone()
        except BaseException:
            self._fail("BLR_HANDOFF_READ: ordered TEMP stage fetch failed")
        self._stage._assert_ordered_handoff_fence(self._expected_total_changes)
        if row is None:
            self._eof = True
            try:
                self._close_cursor_only()
            except BaseException:
                self._fail("BLR_HANDOFF_READ: ordered TEMP stage cursor close failed")
            raise StopIteration
        try:
            captured = _recapture_ordered_stage_row(row)
        except (TypeError, ValueError):
            self._fail("BLR_HANDOFF_ROW: ordered TEMP stage row failed recapture")
        self._observed_count += 1
        rank, _key_blob = baseline_entry_sort_key(captured)
        self._counts_by_rank[rank] += 1
        self._stage._assert_ordered_handoff_fence(self._expected_total_changes)
        return captured

    def close(self) -> None:
        """Close immediately; an incomplete read permanently poisons the handoff."""

        if self._closed:
            return
        try:
            self._close_cursor_only()
        except BaseException:
            self._fail("BLR_HANDOFF_READ: ordered TEMP stage cursor close failed")
        if not self._eof:
            self._fail("BLR_HANDOFF_EARLY_CLOSE: ordered TEMP stage reader closed early")

    def _close_cursor_only(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._cursor.close()

    def _fail(self, message: str) -> Never:
        with suppress(BaseException):
            self._close_cursor_only()
        self._stage._poison(message)


@dataclass(frozen=True, slots=True)
class SQLiteV1BaselineTempStorageConfiguration:
    """Read-back evidence for the bounded FILE-backed TEMP configuration."""

    temp_store: Literal["file"]
    cache_kib: int
    cache_spill: Literal[True]


def _require_outside_transaction(connection: SQLiteV1BaselineConnectionOwner) -> None:
    if connection.in_transaction:
        raise ValueError("SQLite v1 baseline TEMP storage must be configured outside a transaction")


def _execute_pragma(connection: SQLiteV1BaselineConnectionOwner, sql: str) -> None:
    cursor = connection.execute(sql)
    cursor.close()


def _read_pragma_integer(connection: SQLiteV1BaselineConnectionOwner, sql: str) -> int:
    cursor = connection.execute(sql)
    try:
        row = cursor.fetchone()
    finally:
        cursor.close()
    if row is None or len(row) != 1 or type(row[0]) is not int:
        raise ValueError("SQLite v1 baseline TEMP storage read-back is invalid")
    return row[0]


def _checked_cache_kib(value: object) -> int:
    if (
        type(value) is not int
        or value < MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        or value > MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
    ):
        raise ValueError("SQLite v1 baseline TEMP cache size is outside bounds")
    return value


def _has_baseline_temp_object(connection: SQLiteV1BaselineConnectionOwner) -> bool:
    cursor = connection.execute(
        "SELECT 1 FROM temp.sqlite_schema WHERE substr(lower(name), 1, 7) = 'ge_blr_' LIMIT 1"
    )
    try:
        return cursor.fetchone() is not None
    finally:
        cursor.close()


def read_sqlite_v1_baseline_temp_storage(
    connection: SQLiteV1BaselineConnectionOwner,
) -> SQLiteV1BaselineTempStorageConfiguration:
    """Read and validate the exact baseline TEMP configuration outside a transaction."""

    _require_outside_transaction(connection)
    return _read_sqlite_v1_baseline_temp_storage(connection)


def _read_sqlite_v1_baseline_temp_storage(
    connection: SQLiteV1BaselineConnectionOwner,
) -> SQLiteV1BaselineTempStorageConfiguration:
    """Read the exact TEMP profile without changing transaction ownership."""

    temp_store = _read_pragma_integer(connection, "PRAGMA temp_store")
    temp_cache_size = _read_pragma_integer(connection, "PRAGMA temp.cache_size")
    cache_spill_threshold = _read_pragma_integer(connection, "PRAGMA cache_spill")
    if (
        temp_store != 1
        or temp_cache_size >= 0
        or -temp_cache_size < MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        or -temp_cache_size > MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        or cache_spill_threshold <= 0
    ):
        raise ValueError("SQLite v1 baseline TEMP storage configuration drifted")
    return SQLiteV1BaselineTempStorageConfiguration(
        temp_store="file",
        cache_kib=-temp_cache_size,
        cache_spill=True,
    )


def configure_sqlite_v1_baseline_temp_storage(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    cache_kib: int = DEFAULT_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
) -> SQLiteV1BaselineTempStorageConfiguration:
    """Configure bounded FILE-backed TEMP storage without accepting a directory path."""

    _require_outside_transaction(connection)
    checked_cache_kib = _checked_cache_kib(cache_kib)
    _execute_pragma(connection, "PRAGMA temp_store = FILE")
    _execute_pragma(
        connection,
        f"PRAGMA temp.cache_size = {-checked_cache_kib}",
    )
    _execute_pragma(connection, "PRAGMA cache_spill = ON")
    profile = read_sqlite_v1_baseline_temp_storage(connection)
    if profile.cache_kib != checked_cache_kib:
        raise ValueError("SQLite v1 baseline TEMP cache size read-back drifted")
    return profile


class SQLiteV1BaselineTempStage:
    """EXCLUSIVE-owner-bound TEMP catalog for one baseline reconciliation.

    The stage never owns the transaction.  It neither commits nor rolls back,
    and disposal only drops the TEMP objects created by this instance.
    """

    __slots__ = (
        "_allowed_total_changes",
        "_checkpoint_campaign_completed",
        "_checkpoint_campaign_cursor",
        "_checkpoint_campaign_session",
        "_checkpoint_campaign_started",
        "_connection",
        "_cooperative_next_sequence",
        "_cooperative_pending_receipt",
        "_cooperative_source_session",
        "_cooperative_stage_session",
        "_cooperative_stream_finished",
        "_cooperative_summary",
        "_cooperative_write_active",
        "_created_indexes",
        "_created_tables",
        "_created_view",
        "_lease_lock_hold_campaign_completed",
        "_lease_lock_hold_campaign_cursor",
        "_lease_lock_hold_campaign_session",
        "_lease_lock_hold_campaign_started",
        "_legacy_campaign_completed",
        "_legacy_campaign_cursor",
        "_legacy_campaign_session",
        "_legacy_campaign_started",
        "_legacy_main_operation_catalog",
        "_legacy_main_schema_version",
        "_ordered_handoff_completed",
        "_ordered_handoff_reader",
        "_ordered_handoff_started",
        "_ordered_projection_identity",
        "_state",
        "_stream_record_campaign_completed",
        "_stream_record_campaign_cursor",
        "_stream_record_campaign_session",
        "_stream_record_campaign_started",
        "_transaction_epoch",
    )

    def __init__(self, connection: SQLiteV1BaselineConnectionOwner) -> None:
        self._connection = connection
        self._checkpoint_campaign_started = False
        self._checkpoint_campaign_completed = False
        self._checkpoint_campaign_cursor: _SQLiteCursorCapability | None = None
        self._checkpoint_campaign_session: object | None = None
        self._created_tables: list[str] = []
        self._created_indexes: list[str] = []
        self._created_view = False
        self._lease_lock_hold_campaign_started = False
        self._lease_lock_hold_campaign_completed = False
        self._lease_lock_hold_campaign_cursor: _SQLiteCursorCapability | None = None
        self._lease_lock_hold_campaign_session: object | None = None
        self._legacy_campaign_started = False
        self._legacy_campaign_completed = False
        self._legacy_campaign_cursor: _SQLiteCursorCapability | None = None
        self._legacy_campaign_session: object | None = None
        self._legacy_main_schema_version = -1
        self._legacy_main_operation_catalog: tuple[object, ...] = ()
        self._state: SQLiteV1BaselineTempStageState = "open"
        self._transaction_epoch = connection.transaction_epoch
        self._allowed_total_changes = connection.total_changes
        self._cooperative_next_sequence = 0
        self._cooperative_pending_receipt: _CooperativeWriteReceipt | None = None
        self._cooperative_source_session: object | None = None
        self._cooperative_summary: SQLiteV1BaselineSourceSummary | None = None
        self._cooperative_stage_session = object()
        self._cooperative_stream_finished = False
        self._cooperative_write_active = False
        self._ordered_handoff_started = False
        self._ordered_handoff_completed = False
        self._ordered_handoff_reader: _SQLiteV1BaselineOrderedStageReader | None = None
        self._ordered_projection_identity: BaselineProjectionIdentity | None = None
        self._stream_record_campaign_started = False
        self._stream_record_campaign_completed = False
        self._stream_record_campaign_cursor: _SQLiteCursorCapability | None = None
        self._stream_record_campaign_session: object | None = None
        if not connection.in_exclusive_transaction:
            self._state = "disposed"
            raise ValueError(
                "BLR_EXCLUSIVE_TRANSACTION_REQUIRED: baseline TEMP stage requires "
                "the owner EXCLUSIVE transaction"
            )
        if _has_baseline_temp_object(connection):
            self._state = "disposed"
            raise ValueError("BLR_STAGE_WRITE_COUNT: baseline TEMP namespace is not empty")
        self._legacy_main_schema_version, self._legacy_main_operation_catalog = (
            self._read_legacy_main_catalog()
        )
        try:
            _read_sqlite_v1_baseline_temp_storage(connection)
        except ValueError:
            self._state = "disposed"
            raise ValueError(
                "BLR_TEMP_STORAGE_REQUIRED: baseline TEMP stage requires the "
                "bounded FILE-backed TEMP profile"
            ) from None
        try:
            for name, sql in _TEMP_TABLE_DDL:
                _execute_pragma(connection, sql)
                self._created_tables.append(name)
                self._transaction_epoch = connection.transaction_epoch
            for name, sql in zip(_TEMP_INDEX_NAMES, _TEMP_INDEX_DDL, strict=True):
                _execute_pragma(connection, sql)
                self._created_indexes.append(name)
                self._transaction_epoch = connection.transaction_epoch
            _execute_pragma(connection, _TEMP_RELATION_KEYS_VIEW_DDL)
            self._created_view = True
            self._transaction_epoch = connection.transaction_epoch
            catalog_epoch = connection.transaction_epoch
            try:
                _validate_baseline_temp_catalog(connection)
            finally:
                # The validator's one PRAGMA table_list read advances the
                # owner epoch even when shape validation raises. Adopt only
                # that exact internal read, never an arbitrary caller change.
                if (
                    connection.in_exclusive_transaction
                    and connection.transaction_epoch == catalog_epoch + 1
                ):
                    self._transaction_epoch = connection.transaction_epoch
            if not connection.in_exclusive_transaction:
                raise ValueError(
                    "BLR_EXCLUSIVE_TRANSACTION_REQUIRED: baseline TEMP stage lost "
                    "the owner EXCLUSIVE transaction"
                )
            if connection.total_changes != self._allowed_total_changes:
                raise ValueError(
                    "BLR_UNEXPLAINED_WRITE: baseline TEMP catalog creation changed rows"
                )
            self._transaction_epoch = connection.transaction_epoch
        except Exception as error:
            self._state = "disposed"
            self._drop_created_objects()
            if isinstance(error, ValueError) and str(error).startswith("BLR_"):
                raise
            raise ValueError(
                "BLR_STAGE_WRITE_COUNT: baseline TEMP catalog creation failed"
            ) from None

    @property
    def state(self) -> SQLiteV1BaselineTempStageState:
        """Return the explicit lifecycle state without touching SQLite."""

        return self._state

    @property
    def common_entry_count(self) -> int:
        """Return the exact current common-stage row count."""

        self._assert_open_and_bound()
        cursor = self._connection.execute(
            f"SELECT count(*) FROM {SQLITE_V1_BASELINE_COMMON_STAGE_TABLE}"
        )
        try:
            row = cursor.fetchone()
        finally:
            cursor.close()
        self._assert_open_and_bound()
        if row is None or len(row) != 1 or type(row[0]) is not int or row[0] < 0:
            self._poison("BLR_STAGE_COUNT: common TEMP stage count is invalid")
        return row[0]

    def insert_common_entry(self, entry: BaselineEntryInput) -> None:
        """Insert one exact canonical entry and require a one-row write delta."""

        self._assert_open_and_bound()
        if self._cooperative_source_session is not None and not self._cooperative_write_active:
            self._poison(
                "BLR_COOP_SEQUENCE: direct common writes cannot enter a cooperative stream"
            )
        try:
            if not isinstance(entry, BaselineEntryInput):
                raise TypeError("baseline common-stage entry has the wrong type")
            canonical = capture_baseline_entry(entry.entry_kind, entry.key, entry.state)
            if canonical.key_bytes != entry.key_bytes or canonical.state_bytes != entry.state_bytes:
                raise ValueError("baseline common-stage entry bytes are not canonical")
            kind_rank = _KIND_RANK[entry.entry_kind]
        except (KeyError, TypeError, ValueError):
            self._poison("BLR_STAGE_WRITE_COUNT: common TEMP stage entry is invalid")

        before = self._connection.total_changes
        try:
            cursor = self._connection.execute(
                f"INSERT INTO {SQLITE_V1_BASELINE_COMMON_STAGE_TABLE} "
                "(kind_rank, entry_kind, key_blob, state_blob) VALUES (?, ?, ?, ?)",
                (kind_rank, entry.entry_kind, entry.key_bytes, entry.state_bytes),
            )
            try:
                affected_rows = cursor.rowcount
            finally:
                cursor.close()
        except sqlite3.IntegrityError:
            self._poison("BLR_STAGE_KEY_DUPLICATE: common TEMP stage key is duplicated")
        except Exception:
            self._poison("BLR_STAGE_WRITE_COUNT: common TEMP stage insert failed")

        after = self._connection.total_changes
        if affected_rows != 1 or after != before + 1:
            self._poison("BLR_STAGE_WRITE_COUNT: common TEMP stage insert changed the wrong count")
        self._allowed_total_changes = after
        self._assert_open_and_bound()

    def insert_entry_with_relation(self, entry: BaselineEntryInput) -> None:
        """Insert one canonical common row and its fixed normalized projection.

        Legacy operation projection re-reads its one exact retained v1 result
        carrier by canonical identity, then verifies, decodes, re-encodes, and
        hashes it before either paired write. No request bytes are claimed.
        """

        self._assert_open_and_bound()
        if self._cooperative_source_session is not None and not self._cooperative_write_active:
            self._poison(
                "BLR_COOP_SEQUENCE: direct paired writes cannot enter a cooperative stream"
            )
        try:
            if not isinstance(entry, BaselineEntryInput):
                raise TypeError("baseline relation entry has the wrong type")
            canonical = capture_baseline_entry(entry.entry_kind, entry.key, entry.state)
            if canonical.key_bytes != entry.key_bytes or canonical.state_bytes != entry.state_bytes:
                raise ValueError("baseline relation entry bytes are not canonical")
            relation_insert = (
                self._legacy_relation_insert_for(canonical)
                if canonical.entry_kind == "legacy-operation"
                else _relation_insert_for(canonical)
            )
        except (KeyError, TypeError, ValueError) as error:
            self._poison(str(error))

        pair_before = self._connection.total_changes
        self.insert_common_entry(canonical)
        self._assert_open_and_bound()
        before = self._connection.total_changes
        try:
            cursor = self._connection.execute(
                relation_insert.sql,
                relation_insert.parameters,
            )
            try:
                affected_rows = cursor.rowcount
            finally:
                cursor.close()
        except sqlite3.IntegrityError:
            self._poison("BLR_STAGE_KEY_DUPLICATE: normalized TEMP relation key is duplicated")
        except Exception:
            self._poison("BLR_STAGE_WRITE_COUNT: normalized TEMP relation insert failed")

        after = self._connection.total_changes
        if affected_rows != 1 or after != before + 1 or after != pair_before + 2:
            self._poison("BLR_STAGE_WRITE_COUNT: paired TEMP stage insert changed the wrong count")
        self._allowed_total_changes = after
        self._assert_open_and_bound()

    def _insert_cooperative_entry(
        self,
        item: _CooperativeSourceItem,
    ) -> _CooperativeWriteReceipt:
        """Synchronously pair one authentic source item and issue its sole receipt."""

        self._assert_open_and_bound()
        pending = self._cooperative_pending_receipt
        if pending is not None:
            if not pending._consumed:
                self._poison("BLR_COOP_RECEIPT: prior cooperative receipt was not consumed")
            self._cooperative_pending_receipt = None
        if type(item) is not _CooperativeSourceItem:
            self._poison("BLR_COOP_ITEM: cooperative source item is invalid")
        if self._cooperative_source_session is None:
            self._cooperative_source_session = item._source_session
        if (
            item._connection is not self._connection
            or item._transaction_epoch != self._transaction_epoch
            or item._source_session is not self._cooperative_source_session
            or item._stage_session is not self._cooperative_stage_session
            or item._sequence != self._cooperative_next_sequence
            or item._before_total_changes != self._allowed_total_changes
            or item._before_total_changes != self._connection.total_changes
        ):
            self._poison("BLR_COOP_ITEM: cooperative source item binding is invalid")

        before = self._connection.total_changes
        self._cooperative_write_active = True
        try:
            self.insert_entry_with_relation(item._entry)
        finally:
            self._cooperative_write_active = False
        after = self._connection.total_changes
        if after != before + 2 or after != self._allowed_total_changes:
            self._poison("BLR_COOP_DELTA: cooperative paired write did not change exactly two rows")
        receipt = _issue_cooperative_write_receipt(
            item,
            self._cooperative_stage_session,
            after,
        )
        self._assert_open_and_bound()
        self._cooperative_pending_receipt = receipt
        self._cooperative_next_sequence += 1
        return receipt

    def _finish_cooperative_stream(
        self,
        source_session: object,
        expected_count: int,
        summary: SQLiteV1BaselineSourceSummary,
    ) -> None:
        """Prove that the final receipt was burned and the sequence is exact."""

        self._assert_open_and_bound()
        pending = self._cooperative_pending_receipt
        if (
            self._cooperative_source_session is not source_session
            or type(expected_count) is not int
            or expected_count < 0
            or self._cooperative_next_sequence != expected_count
            or pending is None
            or not pending._consumed
            or type(summary) is not SQLiteV1BaselineSourceSummary
            or summary._connection is not self._connection
            or summary.expected_entry_count != expected_count
        ):
            self._poison("BLR_COOP_SEQUENCE: cooperative stream completion is invalid")
        self._cooperative_pending_receipt = None
        self._cooperative_summary = summary
        self._cooperative_stream_finished = True
        self._assert_open_and_bound()

    def _abort_cooperative_stream(self) -> Never:
        """Permanently poison a stage whose source/receipt handshake failed."""

        self._poison("BLR_COOP_ABORTED: cooperative source-to-stage stream failed")

    def _poison_cooperative_state(self) -> None:
        """Poison without replacing the authoritative cooperation error."""

        self._state = "poisoned"
        self._cooperative_pending_receipt = None
        self._cooperative_summary = None
        self._cooperative_stream_finished = False

    def _open_ordered_projection_reader(
        self,
        summary: SQLiteV1BaselineSourceSummary,
    ) -> _SQLiteV1BaselineOrderedStageReader:
        """Open the sole ordered reader after a completed cooperative load."""

        if type(summary) is not SQLiteV1BaselineSourceSummary:
            self._poison("BLR_HANDOFF_BINDING: source summary has the wrong type")
        if self._ordered_handoff_started:
            self._poison("BLR_HANDOFF_ONESHOT: ordered TEMP stage handoff already started")
        self._ordered_handoff_started = True
        expected_total_changes = self._allowed_total_changes
        source_state = summary._identity_iteration_state
        if (
            self._state != "open"
            or summary._connection is not self._connection
            or not source_state.started
            or not source_state.completed
            or source_state.poisoned
            or not self._cooperative_stream_finished
            or self._cooperative_summary is not summary
            or self._cooperative_source_session is None
            or self._cooperative_pending_receipt is not None
            or self._cooperative_next_sequence != summary.expected_entry_count
            or summary._captured_transaction_epoch != self._transaction_epoch
            or summary._captured_transaction_epoch != self._connection.transaction_epoch
            or summary._source_total_changes + 2 * summary.expected_entry_count
            != expected_total_changes
        ):
            self._poison("BLR_HANDOFF_BINDING: source and verified TEMP stage are not bound")
        self._assert_ordered_handoff_fence(expected_total_changes)
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        try:
            cursor = self._connection.execute(
                f"SELECT kind_rank, entry_kind, key_blob, state_blob "
                f"FROM temp.{SQLITE_V1_BASELINE_COMMON_STAGE_TABLE} "
                "ORDER BY kind_rank ASC, key_blob ASC"
            )
        except BaseException:
            self._poison("BLR_HANDOFF_READ: ordered TEMP stage cursor open failed")
        self._assert_ordered_handoff_fence(expected_total_changes)
        reader = _SQLiteV1BaselineOrderedStageReader(
            self,
            cursor,
            expected_total_changes,
        )
        self._ordered_handoff_reader = reader
        return reader

    def _finish_ordered_projection_reader(
        self,
        summary: SQLiteV1BaselineSourceSummary,
        reader: _SQLiteV1BaselineOrderedStageReader,
    ) -> None:
        """Seal the handoff only after EOF, exact counts, coverage, and catalog gates."""

        expected_total_changes = self._allowed_total_changes
        if (
            self._ordered_handoff_reader is not reader
            or not self._ordered_handoff_started
            or self._ordered_handoff_completed
            or not reader.reached_eof
            or reader.observed_count != summary.expected_entry_count
            or not self._cooperative_stream_finished
            or self._cooperative_summary is not summary
        ):
            self._poison("BLR_HANDOFF_COUNT: ordered TEMP stage completion is invalid")
        if any(
            reader.counts_by_rank[rank] != summary.counts_by_kind[kind]
            for rank, kind in enumerate(BASELINE_ENTRY_KINDS)
        ):
            self._poison("BLR_HANDOFF_COUNT: ordered TEMP stage kind counts drifted")
        self._assert_ordered_handoff_fence(expected_total_changes)
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)

    def _complete_ordered_projection_reader(
        self,
        reader: _SQLiteV1BaselineOrderedStageReader,
        identity: BaselineProjectionIdentity,
    ) -> None:
        """Publish success only after the coordinator sealed and fenced the root."""

        if (
            self._ordered_handoff_reader is not reader
            or not reader.reached_eof
            or self._ordered_handoff_completed
            or type(identity) is not BaselineProjectionIdentity
        ):
            self._poison("BLR_HANDOFF_COMPLETION: ordered TEMP stage completion drifted")
        self._assert_ordered_handoff_fence(self._allowed_total_changes)
        self._ordered_handoff_reader = None
        self._ordered_projection_identity = identity
        self._ordered_handoff_completed = True

    def _begin_stream_record_campaign(
        self,
        summary: SQLiteV1BaselineSourceSummary,
        identity: BaselineProjectionIdentity,
    ) -> tuple[int, object]:
        """Bind the sole stream/record campaign to the exact completed handoff."""

        if self._stream_record_campaign_started:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: stream/record campaign already started")
        self._stream_record_campaign_started = True
        if (
            type(summary) is not SQLiteV1BaselineSourceSummary
            or type(identity) is not BaselineProjectionIdentity
            or not self._ordered_handoff_completed
            or self._ordered_handoff_reader is not None
            or self._ordered_projection_identity is not identity
            or self._cooperative_summary is not summary
            or identity.entry_count != summary.expected_entry_count
            or self._state != "open"
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: stream/record campaign binding is invalid")
        expected_total_changes = self._allowed_total_changes
        self._assert_ordered_handoff_fence(expected_total_changes)
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        session = object()
        self._stream_record_campaign_session = session
        return expected_total_changes, session

    def _assert_stream_record_campaign_fence(
        self,
        session: object,
        expected_total_changes: int,
    ) -> None:
        if (
            self._stream_record_campaign_session is not session
            or not self._stream_record_campaign_started
            or self._stream_record_campaign_completed
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: stream/record campaign session is invalid")
        self._assert_ordered_handoff_fence(expected_total_changes)
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)

    def _register_stream_record_campaign_cursor(
        self,
        session: object,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
    ) -> None:
        self._assert_stream_record_campaign_fence(session, expected_total_changes)
        if (
            type(cursor) is not _SQLiteCursorCapability
            or self._stream_record_campaign_cursor is not None
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: stream/record rule cursor is invalid")
        self._stream_record_campaign_cursor = cursor
        self._assert_stream_record_campaign_fence(session, expected_total_changes)

    def _release_stream_record_campaign_cursor(
        self,
        session: object,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
    ) -> None:
        if self._stream_record_campaign_cursor is not cursor:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: stream/record rule cursor binding drifted")
        self._stream_record_campaign_cursor = None
        self._assert_stream_record_campaign_fence(session, expected_total_changes)

    def _complete_stream_record_campaign(
        self,
        identity: BaselineProjectionIdentity,
        expected_total_changes: int,
        session: object,
    ) -> None:
        """Publish campaign completion only after its final common/catalog barrier."""

        if (
            not self._stream_record_campaign_started
            or self._stream_record_campaign_completed
            or self._ordered_projection_identity is not identity
            or self._stream_record_campaign_session is not session
            or self._stream_record_campaign_cursor is not None
        ):
            self._poison(
                "BLR_STAGE_ITERATOR_INCOMPLETE: stream/record campaign completion is invalid"
            )
        self._assert_ordered_handoff_fence(expected_total_changes)
        summary = self._cooperative_summary
        if summary is None:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: stream/record source binding is absent")
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        self._stream_record_campaign_completed = True
        self._stream_record_campaign_session = None

    def _abort_stream_record_campaign(self, session: object | None) -> Never:
        """Finalize the active rule cursor and permanently poison the campaign lane."""

        cursor = self._stream_record_campaign_cursor
        self._stream_record_campaign_cursor = None
        if cursor is not None:
            with suppress(BaseException):
                cursor.close()
        if session is not None and session is not self._stream_record_campaign_session:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: stream/record campaign session drifted")
        self._stream_record_campaign_session = None
        self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: stream/record campaign aborted")

    def _begin_checkpoint_campaign(
        self,
        summary: SQLiteV1BaselineSourceSummary,
        identity: BaselineProjectionIdentity,
    ) -> tuple[int, object]:
        """Bind the checkpoint campaign after the stream/record phase completed."""

        if self._checkpoint_campaign_started:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint campaign already started")
        self._checkpoint_campaign_started = True
        if (
            type(summary) is not SQLiteV1BaselineSourceSummary
            or type(identity) is not BaselineProjectionIdentity
            or not self._ordered_handoff_completed
            or not self._stream_record_campaign_completed
            or self._ordered_handoff_reader is not None
            or self._ordered_projection_identity is not identity
            or self._cooperative_summary is not summary
            or identity.entry_count != summary.expected_entry_count
            or self._state != "open"
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint campaign binding is invalid")
        expected_total_changes = self._allowed_total_changes
        self._assert_ordered_handoff_fence(expected_total_changes)
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        session = object()
        self._checkpoint_campaign_session = session
        return expected_total_changes, session

    def _assert_checkpoint_campaign_fence(
        self,
        session: object,
        expected_total_changes: int,
    ) -> None:
        if (
            self._checkpoint_campaign_session is not session
            or not self._checkpoint_campaign_started
            or self._checkpoint_campaign_completed
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint campaign session is invalid")
        self._assert_ordered_handoff_fence(expected_total_changes)
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)

    def _register_checkpoint_campaign_cursor(
        self,
        session: object,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
    ) -> None:
        self._assert_checkpoint_campaign_fence(session, expected_total_changes)
        if (
            type(cursor) is not _SQLiteCursorCapability
            or self._checkpoint_campaign_cursor is not None
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint rule cursor is invalid")
        self._checkpoint_campaign_cursor = cursor
        self._assert_checkpoint_campaign_fence(session, expected_total_changes)

    def _release_checkpoint_campaign_cursor(
        self,
        session: object,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
    ) -> None:
        if self._checkpoint_campaign_cursor is not cursor:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint rule cursor binding drifted")
        self._checkpoint_campaign_cursor = None
        self._assert_checkpoint_campaign_fence(session, expected_total_changes)

    def _complete_checkpoint_campaign(
        self,
        identity: BaselineProjectionIdentity,
        expected_total_changes: int,
        session: object,
    ) -> None:
        if (
            not self._checkpoint_campaign_started
            or self._checkpoint_campaign_completed
            or self._ordered_projection_identity is not identity
            or self._checkpoint_campaign_session is not session
            or self._checkpoint_campaign_cursor is not None
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint campaign completion is invalid")
        self._assert_checkpoint_campaign_fence(session, expected_total_changes)
        summary = self._cooperative_summary
        if summary is None:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint source binding is absent")
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        self._checkpoint_campaign_completed = True
        self._checkpoint_campaign_session = None

    def _abort_checkpoint_campaign(self, session: object | None) -> Never:
        cursor = self._checkpoint_campaign_cursor
        self._checkpoint_campaign_cursor = None
        if cursor is not None:
            with suppress(BaseException):
                cursor.close()
        if session is not None and session is not self._checkpoint_campaign_session:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint campaign session drifted")
        self._checkpoint_campaign_session = None
        self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: checkpoint campaign aborted")

    def _begin_lease_lock_hold_campaign(
        self,
        summary: SQLiteV1BaselineSourceSummary,
        identity: BaselineProjectionIdentity,
    ) -> tuple[int, object]:
        """Bind the lease/lock/hold campaign after checkpoint completion."""

        if self._lease_lock_hold_campaign_started:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold campaign already started")
        self._lease_lock_hold_campaign_started = True
        if (
            type(summary) is not SQLiteV1BaselineSourceSummary
            or type(identity) is not BaselineProjectionIdentity
            or not self._ordered_handoff_completed
            or not self._stream_record_campaign_completed
            or not self._checkpoint_campaign_completed
            or self._ordered_handoff_reader is not None
            or self._ordered_projection_identity is not identity
            or self._cooperative_summary is not summary
            or identity.entry_count != summary.expected_entry_count
            or self._state != "open"
        ):
            self._poison(
                "BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold campaign binding is invalid"
            )
        expected_total_changes = self._allowed_total_changes
        self._assert_ordered_handoff_fence(expected_total_changes)
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        session = object()
        self._lease_lock_hold_campaign_session = session
        return expected_total_changes, session

    def _assert_lease_lock_hold_campaign_fence(
        self,
        session: object,
        expected_total_changes: int,
    ) -> None:
        if (
            self._lease_lock_hold_campaign_session is not session
            or not self._lease_lock_hold_campaign_started
            or self._lease_lock_hold_campaign_completed
        ):
            self._poison(
                "BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold campaign session is invalid"
            )
        self._assert_ordered_handoff_fence(expected_total_changes)
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)

    def _register_lease_lock_hold_campaign_cursor(
        self,
        session: object,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
    ) -> None:
        self._assert_lease_lock_hold_campaign_fence(session, expected_total_changes)
        if (
            type(cursor) is not _SQLiteCursorCapability
            or self._lease_lock_hold_campaign_cursor is not None
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold rule cursor is invalid")
        self._lease_lock_hold_campaign_cursor = cursor
        self._assert_lease_lock_hold_campaign_fence(session, expected_total_changes)

    def _release_lease_lock_hold_campaign_cursor(
        self,
        session: object,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
    ) -> None:
        if self._lease_lock_hold_campaign_cursor is not cursor:
            self._poison(
                "BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold rule cursor binding drifted"
            )
        self._lease_lock_hold_campaign_cursor = None
        self._assert_lease_lock_hold_campaign_fence(session, expected_total_changes)

    def _complete_lease_lock_hold_campaign(
        self,
        identity: BaselineProjectionIdentity,
        expected_total_changes: int,
        session: object,
    ) -> None:
        if (
            not self._lease_lock_hold_campaign_started
            or self._lease_lock_hold_campaign_completed
            or self._ordered_projection_identity is not identity
            or self._lease_lock_hold_campaign_session is not session
            or self._lease_lock_hold_campaign_cursor is not None
        ):
            self._poison(
                "BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold campaign completion is invalid"
            )
        self._assert_lease_lock_hold_campaign_fence(session, expected_total_changes)
        summary = self._cooperative_summary
        if summary is None:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold source binding is absent")
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        self._lease_lock_hold_campaign_completed = True
        self._lease_lock_hold_campaign_session = None

    def _abort_lease_lock_hold_campaign(self, session: object | None) -> Never:
        cursor = self._lease_lock_hold_campaign_cursor
        self._lease_lock_hold_campaign_cursor = None
        if cursor is not None:
            with suppress(BaseException):
                cursor.close()
        if session is not None and session is not self._lease_lock_hold_campaign_session:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold campaign session drifted")
        self._lease_lock_hold_campaign_session = None
        self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: lease/lock/hold campaign aborted")

    def _begin_legacy_campaign(
        self,
        summary: SQLiteV1BaselineSourceSummary,
        identity: BaselineProjectionIdentity,
    ) -> tuple[int, object]:
        """Bind the sole legacy campaign after lease/lock/hold completion."""

        if self._legacy_campaign_started:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy campaign already started")
        self._legacy_campaign_started = True
        if (
            type(summary) is not SQLiteV1BaselineSourceSummary
            or type(identity) is not BaselineProjectionIdentity
            or not self._ordered_handoff_completed
            or not self._stream_record_campaign_completed
            or not self._checkpoint_campaign_completed
            or not self._lease_lock_hold_campaign_completed
            or self._ordered_handoff_reader is not None
            or self._ordered_projection_identity is not identity
            or self._cooperative_summary is not summary
            or identity.entry_count != summary.expected_entry_count
            or self._state != "open"
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy campaign binding is invalid")
        expected_total_changes = self._allowed_total_changes
        self._assert_legacy_main_catalog()
        self._assert_ordered_handoff_fence(expected_total_changes)
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        session = object()
        self._legacy_campaign_session = session
        return expected_total_changes, session

    def _assert_legacy_campaign_fence(
        self,
        session: object,
        expected_total_changes: int,
    ) -> None:
        if (
            self._legacy_campaign_session is not session
            or not self._legacy_campaign_started
            or self._legacy_campaign_completed
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy campaign session is invalid")
        self._assert_legacy_main_catalog()
        self._assert_ordered_handoff_fence(expected_total_changes)
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)

    def _register_legacy_campaign_cursor(
        self,
        session: object,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
    ) -> None:
        self._assert_legacy_campaign_fence(session, expected_total_changes)
        if type(cursor) is not _SQLiteCursorCapability or self._legacy_campaign_cursor is not None:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy rule cursor is invalid")
        self._legacy_campaign_cursor = cursor

    def _finalize_legacy_campaign_cursor(
        self,
        session: object,
        cursor: _SQLiteCursorCapability,
        expected_total_changes: int,
        *,
        preserve_primary: bool,
    ) -> None:
        """Clear cursor ownership before its sole close on every exit path."""

        if self._legacy_campaign_cursor is not cursor:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy rule cursor binding drifted")
        self._legacy_campaign_cursor = None
        if preserve_primary:
            cursor.close()
            return
        primary: BaseException | None = None
        try:
            self._assert_legacy_campaign_fence(session, expected_total_changes)
        except BaseException as error:
            primary = error
        try:
            cursor.close()
        except BaseException as error:
            if primary is None:
                primary = error
        if primary is not None:
            raise primary
        self._assert_legacy_campaign_fence(session, expected_total_changes)

    def _complete_legacy_campaign(
        self,
        identity: BaselineProjectionIdentity,
        expected_total_changes: int,
        session: object,
    ) -> None:
        if (
            not self._legacy_campaign_started
            or self._legacy_campaign_completed
            or self._ordered_projection_identity is not identity
            or self._legacy_campaign_session is not session
            or self._legacy_campaign_cursor is not None
        ):
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy campaign completion is invalid")
        self._assert_legacy_campaign_fence(session, expected_total_changes)
        summary = self._cooperative_summary
        if summary is None:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy source binding is absent")
        self.assert_common_counts(summary.counts_by_kind)
        self.assert_relation_key_coverage()
        self._assert_ordered_handoff_catalog(expected_total_changes)
        self._assert_ordered_handoff_fence(expected_total_changes)
        self._legacy_campaign_completed = True
        self._legacy_campaign_session = None

    def _abort_legacy_campaign(self, session: object | None) -> Never:
        cursor = self._legacy_campaign_cursor
        self._legacy_campaign_cursor = None
        if cursor is not None:
            with suppress(BaseException):
                cursor.close()
        if session is not None and session is not self._legacy_campaign_session:
            self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy campaign session drifted")
        self._legacy_campaign_session = None
        self._poison("BLR_STAGE_ITERATOR_INCOMPLETE: legacy campaign aborted")

    def _read_legacy_main_catalog(self) -> tuple[int, tuple[object, ...]]:
        schema_cursor: _SQLiteCursorCapability | None = None
        catalog_cursor: _SQLiteCursorCapability | None = None
        try:
            schema_cursor = self._connection.execute(
                "SELECT schema_version FROM pragma_schema_version"
            )
            schema_row = schema_cursor.fetchone()
            schema_extra = schema_cursor.fetchone()
            owned_schema_cursor = schema_cursor
            schema_cursor = None
            owned_schema_cursor.close()
            catalog_cursor = self._connection.execute(
                "SELECT type, name, tbl_name, rootpage, sql FROM main.sqlite_schema "
                "WHERE type = 'table' AND name = 'ge_cycle_operations'"
            )
            catalog_row = catalog_cursor.fetchone()
            catalog_extra = catalog_cursor.fetchone()
            owned_catalog_cursor = catalog_cursor
            catalog_cursor = None
            owned_catalog_cursor.close()
        except BaseException:
            if schema_cursor is not None:
                with suppress(BaseException):
                    schema_cursor.close()
            if catalog_cursor is not None:
                with suppress(BaseException):
                    catalog_cursor.close()
            self._poison("BLR_LEGACY_INVENTORY: main operation catalog read failed")
        if (
            schema_row is None
            or schema_extra is not None
            or len(schema_row) != 1
            or type(schema_row[0]) is not int
            or catalog_extra is not None
        ):
            self._poison("BLR_LEGACY_INVENTORY: main operation catalog is invalid")
        if catalog_row is None:
            return schema_row[0], ()
        if (
            len(catalog_row) != 5
            or catalog_row[0] != "table"
            or catalog_row[1] != "ge_cycle_operations"
            or catalog_row[2] != "ge_cycle_operations"
            or type(catalog_row[3]) is not int
            or catalog_row[3] < 1
            or type(catalog_row[4]) is not str
        ):
            self._poison("BLR_LEGACY_INVENTORY: main operation catalog is invalid")
        return schema_row[0], tuple(catalog_row)

    def _assert_legacy_main_catalog(self) -> None:
        schema_version, operation_catalog = self._read_legacy_main_catalog()
        if (
            schema_version != self._legacy_main_schema_version
            or operation_catalog != self._legacy_main_operation_catalog
        ):
            self._poison("BLR_LEGACY_INVENTORY: main operation catalog drifted")

    def _assert_ordered_handoff_fence(self, expected_total_changes: int) -> None:
        self._assert_open_and_bound()
        if (
            type(expected_total_changes) is not int
            or expected_total_changes != self._allowed_total_changes
            or expected_total_changes != self._connection.total_changes
        ):
            self._poison("BLR_UNEXPLAINED_WRITE: ordered TEMP handoff write fence changed")

    def _assert_ordered_handoff_catalog(self, expected_total_changes: int) -> None:
        """Re-prove reserved objects and STRICT/WITHOUT ROWID shape without epoch mutation."""

        expected_objects = {
            *[("table", name) for name, _sql in _TEMP_TABLE_DDL],
            *[("index", name) for name in _TEMP_INDEX_NAMES],
            ("view", SQLITE_V1_BASELINE_RELATION_KEYS_VIEW),
        }
        actual_objects: set[tuple[object, object]] = set()
        cursor: _SQLiteCursorCapability | None = None
        catalog_failure: BaseException | None = None
        try:
            cursor = self._connection.execute(
                "SELECT type, name FROM temp.sqlite_schema "
                "WHERE substr(lower(name), 1, 7) = 'ge_blr_' ORDER BY type, name"
            )
            while True:
                self._assert_ordered_handoff_fence(expected_total_changes)
                row = cursor.fetchone()
                self._assert_ordered_handoff_fence(expected_total_changes)
                if row is None:
                    break
                if len(row) != 2 or type(row[0]) is not str or type(row[1]) is not str:
                    self._poison("BLR_HANDOFF_CATALOG: TEMP catalog row is invalid")
                actual_objects.add((row[0], row[1]))
        except BaseException as error:
            catalog_failure = error
        finally:
            if cursor is not None:
                try:
                    cursor.close()
                except BaseException as error:
                    if catalog_failure is None:
                        catalog_failure = error
        if catalog_failure is not None:
            if isinstance(catalog_failure, ValueError) and str(catalog_failure).startswith("BLR_"):
                raise catalog_failure
            self._poison("BLR_HANDOFF_CATALOG: TEMP catalog identity query failed")
        if actual_objects != expected_objects:
            self._poison("BLR_HANDOFF_CATALOG: TEMP catalog identity drifted")

        expected_shapes = {(name, "table", 1, 1) for name, _sql in _TEMP_TABLE_DDL}
        expected_shapes.add((SQLITE_V1_BASELINE_RELATION_KEYS_VIEW, "view", 0, 0))
        actual_shapes: set[tuple[object, object, object, object]] = set()
        cursor = None
        catalog_failure = None
        try:
            cursor = self._connection.execute(
                "SELECT name, type, wr, strict FROM pragma_table_list "
                "WHERE schema = 'temp' AND substr(lower(name), 1, 7) = 'ge_blr_' "
                "ORDER BY name"
            )
            while True:
                self._assert_ordered_handoff_fence(expected_total_changes)
                row = cursor.fetchone()
                self._assert_ordered_handoff_fence(expected_total_changes)
                if row is None:
                    break
                if len(row) != 4:
                    self._poison("BLR_HANDOFF_CATALOG: TEMP table shape row is invalid")
                actual_shapes.add((row[0], row[1], row[2], row[3]))
        except BaseException as error:
            catalog_failure = error
        finally:
            if cursor is not None:
                try:
                    cursor.close()
                except BaseException as error:
                    if catalog_failure is None:
                        catalog_failure = error
        if catalog_failure is not None:
            if isinstance(catalog_failure, ValueError) and str(catalog_failure).startswith("BLR_"):
                raise catalog_failure
            self._poison("BLR_HANDOFF_CATALOG: TEMP table shape query failed")
        if actual_shapes != expected_shapes:
            self._poison("BLR_HANDOFF_CATALOG: TEMP table shape drifted")
        self._assert_ordered_handoff_fence(expected_total_changes)

    def _legacy_relation_insert_for(
        self,
        entry: BaselineEntryInput,
    ) -> _RelationInsert:
        """Re-read and prove the exact retained v1 result before either write."""

        self._assert_open_and_bound()
        key = entry.key
        state = entry.state
        try:
            cursor = self._connection.execute(
                _LEGACY_RESULT_SELECT,
                (key["tenantId"], key["operationId"]),
            )
            try:
                rows = cursor.fetchmany(2)
            finally:
                cursor.close()
        except Exception:
            self._poison("SQLite v1 legacy result carrier query failed")
        self._assert_open_and_bound()
        if len(rows) != 1 or len(rows[0]) != 5:
            self._poison("SQLite v1 legacy result carrier identity is missing")
        operation_name, request_hash, result_blob, result_hash, committed_at_ms = rows[0]
        if (
            operation_name != state["operationName"]
            or request_hash != state["requestHash"]
            or result_hash != state["resultHash"]
            or committed_at_ms != state["committedAtMs"]
            or type(operation_name) is not str
            or type(result_blob) is not bytes
            or not 2 <= len(result_blob) <= 16_777_216
            or hashlib.sha256(result_blob).hexdigest() != state["resultBlobSha256"]
        ):
            self._poison("SQLite v1 legacy result carrier identity drifted")
        try:
            operation = cast(CycleStoreProviderOperation, operation_name)
            decoded = cycle_store_adapter_codec.decode_ledger_result(operation, result_blob)
            if (
                cycle_store_adapter_codec.encode_ledger_result(operation, decoded) != result_blob
                or canonical_sha256(decoded) != result_hash
            ):
                raise ValueError("legacy result canonical identity drifted")
            derived = _legacy_result_projection(operation, decoded)
        except Exception:
            self._poison("SQLite v1 legacy result carrier is invalid")
        return _RelationInsert(
            _LEGACY_RELATION_INSERT,
            (
                entry.key_bytes,
                state["tenantId"],
                state["operationId"],
                operation_name,
                request_hash,
                result_hash,
                state["resultBlobSha256"],
                committed_at_ms,
                *derived,
            ),
        )

    def assert_common_counts(
        self,
        expected: Mapping[BaselineEntryKind, int],
    ) -> None:
        """Prove exact grouped and total common-stage counts for all twelve kinds."""

        self._assert_open_and_bound()
        if not isinstance(expected, Mapping) or set(expected) != set(BASELINE_ENTRY_KINDS):
            raise ValueError(
                "BLR_STAGE_COUNT_EXPECTATION: expected counts must contain exactly "
                "the twelve baseline entry kinds"
            )

        expected_total = 0
        for kind_rank, entry_kind in enumerate(BASELINE_ENTRY_KINDS):
            expected_count = expected[entry_kind]
            if (
                type(expected_count) is not int
                or expected_count < 0
                or expected_count > MAX_SAFE_INTEGER
            ):
                raise ValueError(
                    "BLR_STAGE_COUNT_EXPECTATION: expected stage count is outside bounds"
                )
            expected_total += expected_count
            if expected_total > MAX_SAFE_INTEGER:
                raise ValueError(
                    "BLR_STAGE_COUNT_EXPECTATION: expected stage total is outside bounds"
                )
            actual_count = self._read_safe_count(
                f"SELECT count(*) FROM temp.{SQLITE_V1_BASELINE_COMMON_STAGE_TABLE} "
                "WHERE kind_rank = ? AND entry_kind = ?",
                (kind_rank, entry_kind),
                label="common TEMP stage kind count",
            )
            if actual_count != expected_count:
                self._poison("BLR_STAGE_COUNT: common TEMP stage count drifted")

        actual_total = self._read_safe_count(
            f"SELECT count(*) FROM temp.{SQLITE_V1_BASELINE_COMMON_STAGE_TABLE}",
            label="common TEMP stage total count",
        )
        if actual_total != expected_total:
            self._poison("BLR_STAGE_COUNT: common TEMP stage total count drifted")
        self._assert_open_and_bound()

    def assert_relation_key_coverage(self) -> None:
        """Prove bidirectional key-and-rank coverage across common and relation stages."""

        self._assert_open_and_bound()
        missing_count = self._read_safe_count(
            f"SELECT count(*) "
            f"FROM temp.{SQLITE_V1_BASELINE_COMMON_STAGE_TABLE} AS stage "
            f"LEFT JOIN temp.{SQLITE_V1_BASELINE_RELATION_KEYS_VIEW} AS relation "
            "ON relation.kind_rank = stage.kind_rank "
            "AND relation.key_blob = stage.key_blob "
            "WHERE relation.key_blob IS NULL",
            label="common TEMP stage missing relation count",
        )
        extra_count = self._read_safe_count(
            f"SELECT count(*) "
            f"FROM temp.{SQLITE_V1_BASELINE_RELATION_KEYS_VIEW} AS relation "
            f"LEFT JOIN temp.{SQLITE_V1_BASELINE_COMMON_STAGE_TABLE} AS stage "
            "ON stage.kind_rank = relation.kind_rank "
            "AND stage.key_blob = relation.key_blob "
            "WHERE stage.key_blob IS NULL",
            label="common TEMP stage extra relation count",
        )
        self._assert_open_and_bound()
        if missing_count != 0 or extra_count != 0:
            self._poison("BLR_STAGE_KEY_COVERAGE: baseline stage/relation key coverage drifted")

    def dispose(self) -> None:
        """Idempotently drop owned TEMP tables in reverse creation order."""

        if self._state == "disposed":
            return
        active_reader = self._ordered_handoff_reader
        cursor_close_failure: BaseException | None = None
        cursor_cleanup_message = "BLR_HANDOFF_CLEANUP: ordered TEMP stage cursor cleanup failed"
        if active_reader is not None:
            try:
                active_reader._close_cursor_only()
            except BaseException as error:
                cursor_close_failure = error
            self._ordered_handoff_reader = None
        campaign_cursor = self._stream_record_campaign_cursor
        if campaign_cursor is not None:
            try:
                campaign_cursor.close()
            except BaseException as error:
                if cursor_close_failure is None:
                    cursor_close_failure = error
                    cursor_cleanup_message = (
                        "BLR_STAGE_ITERATOR_INCOMPLETE: TEMP campaign cursor cleanup failed"
                    )
            self._stream_record_campaign_cursor = None
        checkpoint_cursor = self._checkpoint_campaign_cursor
        if checkpoint_cursor is not None:
            try:
                checkpoint_cursor.close()
            except BaseException as error:
                if cursor_close_failure is None:
                    cursor_close_failure = error
                    cursor_cleanup_message = (
                        "BLR_STAGE_ITERATOR_INCOMPLETE: TEMP checkpoint cursor cleanup failed"
                    )
            self._checkpoint_campaign_cursor = None
        lease_lock_hold_cursor = self._lease_lock_hold_campaign_cursor
        if lease_lock_hold_cursor is not None:
            try:
                lease_lock_hold_cursor.close()
            except BaseException as error:
                if cursor_close_failure is None:
                    cursor_close_failure = error
                    cursor_cleanup_message = (
                        "BLR_STAGE_ITERATOR_INCOMPLETE: TEMP lease/lock/hold cursor cleanup failed"
                    )
            self._lease_lock_hold_campaign_cursor = None
        legacy_cursor = self._legacy_campaign_cursor
        if legacy_cursor is not None:
            self._legacy_campaign_cursor = None
            try:
                legacy_cursor.close()
            except BaseException as error:
                if cursor_close_failure is None:
                    cursor_close_failure = error
                    cursor_cleanup_message = (
                        "BLR_STAGE_ITERATOR_INCOMPLETE: TEMP legacy cursor cleanup failed"
                    )
        if (
            not self._connection.in_exclusive_transaction
            or self._connection.transaction_epoch != self._transaction_epoch
        ):
            self._clear_created_objects()
            if cursor_close_failure is not None:
                self._state = "poisoned"
                raise ValueError(cursor_cleanup_message) from cursor_close_failure
            self._state = "disposed"
            return
        try:
            self._drop_created_objects()
        except BaseException:
            if cursor_close_failure is None:
                raise
        if cursor_close_failure is not None:
            self._state = "poisoned"
            raise ValueError(cursor_cleanup_message) from cursor_close_failure
        self._state = "disposed"

    def __enter__(self) -> SQLiteV1BaselineTempStage:
        self._assert_open_and_bound()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> Literal[False]:
        del exc_type, exc_value, traceback
        self.dispose()
        return False

    def _assert_open_and_bound(self) -> None:
        if self._state == "disposed":
            raise ValueError("baseline TEMP stage is disposed")
        if self._state == "poisoned":
            raise ValueError("baseline TEMP stage is poisoned; only dispose is allowed")
        if not self._connection.in_exclusive_transaction:
            self._poison(
                "BLR_EXCLUSIVE_TRANSACTION_REQUIRED: baseline TEMP stage requires "
                "the captured owner EXCLUSIVE transaction"
            )
        if self._connection.transaction_epoch != self._transaction_epoch:
            self._poison("BLR_TRANSACTION_CHANGED: baseline TEMP stage transaction changed")
        if self._connection.total_changes != self._allowed_total_changes:
            self._poison("BLR_UNEXPLAINED_WRITE: baseline TEMP stage observed an external write")

    def _read_safe_count(
        self,
        sql: str,
        parameters: tuple[object, ...] = (),
        *,
        label: str,
    ) -> int:
        try:
            cursor = self._connection.execute(sql, parameters)
            try:
                row = cursor.fetchone()
            finally:
                cursor.close()
        except Exception:
            self._poison(f"BLR_STAGE_COUNT: {label} query failed")
        if (
            row is None
            or len(row) != 1
            or type(row[0]) is not int
            or row[0] < 0
            or row[0] > MAX_SAFE_INTEGER
        ):
            self._poison(f"BLR_STAGE_COUNT: {label} is invalid")
        return row[0]

    def _poison(self, message: str) -> Never:
        active_reader = self._ordered_handoff_reader
        if active_reader is not None:
            with suppress(BaseException):
                active_reader._close_cursor_only()
            self._ordered_handoff_reader = None
        campaign_cursor = self._stream_record_campaign_cursor
        if campaign_cursor is not None:
            with suppress(BaseException):
                campaign_cursor.close()
            self._stream_record_campaign_cursor = None
        checkpoint_cursor = self._checkpoint_campaign_cursor
        if checkpoint_cursor is not None:
            with suppress(BaseException):
                checkpoint_cursor.close()
            self._checkpoint_campaign_cursor = None
        lease_lock_hold_cursor = self._lease_lock_hold_campaign_cursor
        if lease_lock_hold_cursor is not None:
            with suppress(BaseException):
                lease_lock_hold_cursor.close()
            self._lease_lock_hold_campaign_cursor = None
        legacy_cursor = self._legacy_campaign_cursor
        if legacy_cursor is not None:
            self._legacy_campaign_cursor = None
            with suppress(BaseException):
                legacy_cursor.close()
        self._state = "poisoned"
        self._cooperative_pending_receipt = None
        self._cooperative_summary = None
        self._cooperative_stream_finished = False
        self._ordered_projection_identity = None
        raise ValueError(message)

    def _drop_created_objects(self) -> None:
        if (
            not self._connection.in_exclusive_transaction
            or self._connection.transaction_epoch != self._transaction_epoch
        ):
            self._clear_created_objects()
            return
        first_failure: Exception | None = None
        if self._created_view:
            try:
                cursor = self._connection.execute(
                    f"DROP VIEW temp.{SQLITE_V1_BASELINE_RELATION_KEYS_VIEW}"
                )
                cursor.close()
                self._transaction_epoch = self._connection.transaction_epoch
            except Exception as error:
                first_failure = error
        for name in reversed(self._created_indexes):
            try:
                cursor = self._connection.execute(f"DROP INDEX temp.{name}")
                cursor.close()
                self._transaction_epoch = self._connection.transaction_epoch
            except Exception as error:
                if first_failure is None:
                    first_failure = error
        for name in reversed(self._created_tables):
            try:
                cursor = self._connection.execute(f"DROP TABLE temp.{name}")
                cursor.close()
                self._transaction_epoch = self._connection.transaction_epoch
            except Exception as error:
                if first_failure is None:
                    first_failure = error

        try:
            has_residue = _has_baseline_temp_object(self._connection)
        except Exception as error:
            has_residue = True
            if first_failure is None:
                first_failure = error
        if has_residue and first_failure is None:
            first_failure = ValueError("baseline TEMP stage disposal left reserved objects")
        if first_failure is not None:
            self._state = "poisoned"
            raise ValueError(
                "BLR_STAGE_DISPOSE: baseline TEMP stage cleanup failed or left residue"
            ) from first_failure
        self._clear_created_objects()

    def _clear_created_objects(self) -> None:
        self._created_view = False
        self._created_indexes.clear()
        self._created_tables.clear()


def create_sqlite_v1_baseline_temp_stage(
    connection: SQLiteV1BaselineConnectionOwner,
) -> SQLiteV1BaselineTempStage:
    """Create the fixed TEMP catalog inside the caller's EXCLUSIVE transaction."""

    return SQLiteV1BaselineTempStage(connection)
