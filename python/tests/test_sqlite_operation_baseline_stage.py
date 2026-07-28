from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import FrozenInstanceError
from datetime import datetime
from typing import Any

import pytest

import graph_engineering.sqlite_operation_baseline_stage as baseline_stage_module
from graph_engineering.canonical import canonical_sha256
from graph_engineering.cycle_store_provider import (
    CycleStoreProviderOperation,
    cycle_store_adapter_codec,
)
from graph_engineering.sqlite_operation_baseline import (
    BASELINE_ENTRY_KINDS,
    BaselineEntryInput,
    BaselineEntryKind,
    capture_baseline_entry,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    _SQLiteCursorCapability,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    DEFAULT_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
    MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
    MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
    SQLITE_V1_BASELINE_COMMON_STAGE_TABLE,
    SQLITE_V1_BASELINE_RELATION_KEYS_VIEW,
    SQLITE_V1_BASELINE_RELATION_TABLES,
    SQLiteV1BaselineTempStage,
    configure_sqlite_v1_baseline_temp_storage,
    create_sqlite_v1_baseline_temp_stage,
    read_sqlite_v1_baseline_temp_storage,
)

H1 = "1" * 64
H2 = "2" * 64
H3 = "3" * 64
H4 = "4" * 64


def _schema_entry() -> BaselineEntryInput:
    return capture_baseline_entry(
        "schema-envelope",
        {"scope": "cycle-store"},
        {
            "createdAtMs": 1,
            "currentVersion": 1,
            "latestMigrationAppliedAtMs": 2,
            "latestMigrationSha256": H1,
            "maxReaderVersion": 1,
            "maxWriterVersion": 1,
            "minReaderVersion": 1,
            "minWriterVersion": 1,
            "providerDescriptorHash": H2,
            "schemaIdentitySha256": H3,
            "updatedAtMs": 2,
        },
    )


def _relation_entries() -> list[BaselineEntryInput]:
    checkpoint_summary: dict[str, Any] = {
        "boundRecordHash": H1,
        "boundSequence": 0,
        "checkpointId": "checkpoint-a",
        "checkpointScope": "scope-a",
        "createdAt": "2026-07-27T00:00:00Z",
        "streamId": "stream-a",
        "valueBytes": 2,
        "valueHash": H2,
    }
    values: list[tuple[BaselineEntryKind, dict[str, Any], dict[str, Any]]] = [
        ("schema-envelope", {"scope": "cycle-store"}, _schema_entry().state),
        (
            "migration-lineage",
            {"version": 1},
            {
                "appliedAtMs": 2,
                "migrationId": "migration-1",
                "postconditions": {"requiredPostconditions": ["foreign-key-check-is-empty"]},
                "previousVersion": 0,
                "reversibility": "rebuild-from-verified-backup-only",
                "schemaIdentitySha256": H3,
                "sqlSha256": H4,
                "version": 1,
            },
        ),
        (
            "stream-head",
            {"streamId": "stream-a", "tenantId": "tenant-a"},
            {
                "createdAtMs": 3,
                "streamId": "stream-a",
                "tailRecordHash": H1,
                "tailSequence": 0,
                "tenantId": "tenant-a",
                "updatedAtMs": 4,
            },
        ),
        (
            "record-identity",
            {"recordId": "record-a", "tenantId": "tenant-a"},
            {
                "committedAtMs": 3,
                "previousRecordHash": None,
                "recordHash": H1,
                "recordId": "record-a",
                "sequence": 0,
                "streamId": "stream-a",
                "tenantId": "tenant-a",
                "valueBytes": 2,
                "valueHash": H2,
            },
        ),
        (
            "checkpoint-current",
            {
                "checkpointId": "checkpoint-a",
                "checkpointScope": "scope-a",
                "tenantId": "tenant-a",
            },
            {
                "boundRecordHash": H1,
                "boundSequence": 0,
                "checkpointId": "checkpoint-a",
                "checkpointRevision": 1,
                "checkpointScope": "scope-a",
                "committedAtMs": 5,
                "createdAt": "2026-07-27T00:00:00Z",
                "streamId": "stream-a",
                "summary": checkpoint_summary,
                "tenantId": "tenant-a",
                "valueBytes": 2,
                "valueHash": H2,
            },
        ),
        (
            "checkpoint-revision",
            {"checkpointScope": "scope-a", "revision": 1, "tenantId": "tenant-a"},
            {
                "action": "put",
                "boundRecordHash": H1,
                "boundSequence": 0,
                "checkpointCreatedAt": "2026-07-27T00:00:00Z",
                "checkpointId": "checkpoint-a",
                "checkpointScope": "scope-a",
                "recordedAtMs": 6,
                "revision": 1,
                "summary": checkpoint_summary,
                "tenantId": "tenant-a",
                "valueBytes": 2,
                "valueHash": H2,
            },
        ),
        (
            "lease-current",
            {"streamId": "stream-b", "tenantId": "tenant-a"},
            {
                "activeAcquiredAtMs": 7,
                "activeExpiresAtMs": 1_007,
                "activeFencingToken": 1,
                "activeHolderId": "holder-a",
                "activeLeaseEpoch": 1,
                "activeLeaseId": "lease-a",
                "lastFencingToken": 1,
                "lastLeaseEpoch": 1,
                "streamId": "stream-b",
                "tenantId": "tenant-a",
                "updatedAtMs": 7,
            },
        ),
        (
            "used-lease-identity",
            {"leaseId": "lease-a", "streamId": "stream-b", "tenantId": "tenant-a"},
            {
                "fencingToken": 1,
                "firstUsedAtMs": 7,
                "leaseEpoch": 1,
                "leaseId": "lease-a",
                "streamId": "stream-b",
                "tenantId": "tenant-a",
            },
        ),
        (
            "legal-hold",
            {"holdId": "hold-a", "streamId": "stream-a", "tenantId": "tenant-a"},
            {
                "holdId": "hold-a",
                "placedAtMs": 8,
                "streamId": "stream-a",
                "tenantId": "tenant-a",
            },
        ),
        (
            "migration-lock-current",
            {"singleton": 1},
            {
                "activeAcquiredAtMs": None,
                "activeExpiresAtMs": None,
                "activeFencingToken": None,
                "activeLockEpoch": None,
                "activeLockId": None,
                "activeOwnerId": None,
                "activeSourceVersion": None,
                "activeTargetVersion": None,
                "lastFencingToken": 1,
                "lastLockEpoch": 1,
                "singleton": 1,
                "updatedAtMs": 9,
            },
        ),
        (
            "used-migration-lock-identity",
            {"lockId": "lock-a"},
            {
                "fencingToken": 1,
                "firstUsedAtMs": 9,
                "lockEpoch": 1,
                "lockId": "lock-a",
            },
        ),
    ]
    return [capture_baseline_entry(kind, key, state) for kind, key, state in values]


def _create_legacy_source_table(connection: SQLiteV1BaselineConnectionOwner) -> None:
    connection.execute(
        """CREATE TABLE ge_cycle_operations (
         tenant_id TEXT NOT NULL,
         operation_id TEXT NOT NULL,
         operation_name TEXT NOT NULL,
         request_hash TEXT NOT NULL,
         result_blob BLOB NOT NULL,
         result_hash TEXT NOT NULL,
         committed_at_ms INTEGER NOT NULL,
         PRIMARY KEY (tenant_id, operation_id)
        ) STRICT, WITHOUT ROWID"""
    ).close()


def _legacy_derived_expected(
    operation: CycleStoreProviderOperation,
    result: object,
) -> tuple[object, ...]:
    def epoch_ms(value: object) -> int:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return int(parsed.timestamp() * 1_000)

    values: list[object] = [None] * 30
    typed = result if isinstance(result, dict) else {}
    if operation == "append":
        tail = typed["tail"]
        assert isinstance(tail, dict)
        values[0:4] = [
            1,
            tail["sequence"],
            tail["recordHash"],
            typed["appendedRecords"],
        ]
    elif operation == "save-checkpoint":
        values[4:12] = [
            typed["checkpointScope"],
            typed["checkpointId"],
            typed["streamId"],
            typed["boundSequence"],
            typed["boundRecordHash"],
            typed["createdAt"],
            typed["valueHash"],
            typed["valueBytes"],
        ]
    elif operation == "delete-checkpoint":
        values[12] = int(bool(typed["deleted"]))
    elif operation in ("acquire-lease", "renew-lease"):
        values[13:19] = [
            typed["leaseId"],
            typed["holderId"],
            typed["leaseEpoch"],
            typed["fencingToken"],
            epoch_ms(typed["acquiredAt"]),
            epoch_ms(typed["expiresAt"]),
        ]
    elif operation == "release-lease":
        values[19:22] = [
            typed["status"],
            typed["lastLeaseEpoch"],
            typed["lastFencingToken"],
        ]
    elif operation == "acquire-migration-lock":
        values[22:30] = [
            typed["lockId"],
            typed["ownerId"],
            typed["sourceSchemaVersion"],
            typed["targetSchemaVersion"],
            typed["lockEpoch"],
            typed["fencingToken"],
            epoch_ms(typed["acquiredAt"]),
            epoch_ms(typed["expiresAt"]),
        ]
    return tuple(values)


def _insert_legacy_fixture(
    connection: SQLiteV1BaselineConnectionOwner,
    operation_id: str,
    operation: CycleStoreProviderOperation,
    result: object,
    committed_at_ms: int,
) -> tuple[BaselineEntryInput, tuple[object, ...]]:
    request_hash = hashlib.sha256(f"request:{operation_id}".encode()).hexdigest()
    result_blob = cycle_store_adapter_codec.encode_ledger_result(operation, result)
    result_hash = canonical_sha256(result)
    result_blob_sha256 = hashlib.sha256(result_blob).hexdigest()
    connection.execute(
        "INSERT INTO ge_cycle_operations VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            "tenant-a",
            operation_id,
            operation,
            request_hash,
            result_blob,
            result_hash,
            committed_at_ms,
        ),
    ).close()
    entry = capture_baseline_entry(
        "legacy-operation",
        {"operationId": operation_id, "tenantId": "tenant-a"},
        {
            "committedAtMs": committed_at_ms,
            "operationId": operation_id,
            "operationName": operation,
            "requestHash": request_hash,
            "resultBlobSha256": result_blob_sha256,
            "resultHash": result_hash,
            "tenantId": "tenant-a",
        },
    )
    return (
        entry,
        (
            entry.key_bytes,
            "tenant-a",
            operation_id,
            operation,
            request_hash,
            result_hash,
            result_blob_sha256,
            committed_at_ms,
            *_legacy_derived_expected(operation, result),
        ),
    )


def _install_legacy_source_row(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    operation_id: str = "operation-a",
) -> BaselineEntryInput:
    _create_legacy_source_table(connection)
    entry, _expected = _insert_legacy_fixture(
        connection,
        operation_id,
        "append",
        {
            "tail": {"exists": True, "sequence": 0, "recordHash": H1},
            "appendedRecords": 1,
        },
        10,
    )
    connection.commit()
    return entry


LEGACY_RESULT_CASES: tuple[
    tuple[str, CycleStoreProviderOperation, object, int],
    ...,
] = (
    (
        "op-append",
        "append",
        {
            "tail": {"exists": True, "sequence": 0, "recordHash": H1},
            "appendedRecords": 1,
        },
        101,
    ),
    (
        "op-save",
        "save-checkpoint",
        {
            "checkpointScope": "scope",
            "checkpointId": "checkpoint",
            "streamId": "stream",
            "boundSequence": 0,
            "boundRecordHash": H1,
            "createdAt": "2026-07-28T00:00:00.123Z",
            "valueHash": H2,
            "valueBytes": 7,
        },
        102,
    ),
    ("op-delete", "delete-checkpoint", {"deleted": False}, 103),
    (
        "op-acquire-lease",
        "acquire-lease",
        {
            "leaseId": "lease",
            "holderId": "holder",
            "leaseEpoch": 1,
            "fencingToken": 1,
            "acquiredAt": "2026-07-28T00:00:00.123Z",
            "expiresAt": "2026-07-28T00:00:01.456Z",
        },
        104,
    ),
    (
        "op-renew-lease",
        "renew-lease",
        {
            "leaseId": "lease",
            "holderId": "holder",
            "leaseEpoch": 1,
            "fencingToken": 1,
            "acquiredAt": "2026-07-28T00:00:00.123Z",
            "expiresAt": "2026-07-28T00:00:01.456Z",
        },
        105,
    ),
    (
        "op-release-lease",
        "release-lease",
        {
            "status": "released",
            "lease": None,
            "lastLeaseEpoch": 1,
            "lastFencingToken": 1,
        },
        106,
    ),
    (
        "op-hold",
        "set-legal-hold",
        {
            "legalHoldIds": ["hold"],
            "retentionMode": "retain-authoritative-history",
            "archiveMode": "lossless-before-delete",
            "compactionMode": "logical-history-preserving",
        },
        107,
    ),
    (
        "op-acquire-lock",
        "acquire-migration-lock",
        {
            "lockId": "lock",
            "ownerId": "owner",
            "sourceSchemaVersion": 1,
            "targetSchemaVersion": 2,
            "lockEpoch": 1,
            "fencingToken": 1,
            "acquiredAt": "2026-07-28T00:00:00.123Z",
            "expiresAt": "2026-07-28T00:00:01.456Z",
        },
        108,
    ),
    ("op-release-lock", "release-migration-lock", None, 109),
)


def _stage_state(stage: SQLiteV1BaselineTempStage) -> str:
    return stage.state


def _zero_counts() -> dict[BaselineEntryKind, int]:
    return dict.fromkeys(BASELINE_ENTRY_KINDS, 0)


def _begin_configured_stage_transaction(
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()


def _accept_test_relation_writes(
    stage: SQLiteV1BaselineTempStage,
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    """Adopt writes that stand in for the not-yet-wired normalized decoders."""

    stage._allowed_total_changes = connection.total_changes


def _insert_schema_relation(
    connection: SQLiteV1BaselineConnectionOwner,
    key_blob: bytes,
) -> None:
    connection.execute(
        "INSERT INTO temp.ge_blr_schema "
        "(key_blob, singleton, current_version, schema_identity_sha256, "
        "min_reader_version, max_reader_version, min_writer_version, "
        "max_writer_version, latest_migration_sha256, provider_descriptor_hash, "
        "latest_migration_applied_at_ms, created_at_ms, updated_at_ms) "
        "VALUES (?, 1, 1, ?, 1, 1, 1, 1, ?, ?, 2, 1, 2)",
        (key_blob, H3, H1, H2),
    ).close()


def _insert_migration_relation(
    connection: SQLiteV1BaselineConnectionOwner,
    key_blob: bytes,
) -> None:
    connection.execute(
        "INSERT INTO temp.ge_blr_migrations "
        "(key_blob, version, previous_version, migration_id, sql_sha256, "
        "schema_identity_sha256, applied_at_ms) VALUES (?, 1, 0, 'm1', ?, ?, 2)",
        (key_blob, H1, H3),
    ).close()


def test_owner_conservatively_tracks_and_proves_exclusive_transaction_mode() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        assert connection.transaction_mode is None
        assert not connection.in_exclusive_transaction

        connection.execute("BEGIN").close()
        assert connection.transaction_mode == "deferred"
        assert not connection.in_exclusive_transaction
        connection.execute("ROLLBACK").close()

        connection.execute("; /* prefix */ BEGIN /* mode */ IMMEDIATE").close()
        assert connection.transaction_mode == "immediate"
        assert not connection.in_exclusive_transaction
        connection.rollback()

        connection.execute(";; -- prefix\n BEGIN /* mode */ EXCLUSIVE").close()
        assert connection.transaction_mode == "exclusive"
        assert connection.in_exclusive_transaction
        connection.execute("SAVEPOINT nested").close()
        connection.execute("ROLLBACK TO nested").close()
        connection.execute("RELEASE nested").close()
        assert connection.transaction_mode == "exclusive"
        assert connection.in_exclusive_transaction
        connection.commit()
        assert connection.transaction_mode is None
        assert not connection.in_exclusive_transaction

        connection.executescript("BEGIN EXCLUSIVE;")
        assert connection.transaction_mode == "unknown"
        assert not connection.in_exclusive_transaction
        connection.rollback()

        connection.execute("SAVEPOINT only_savepoint").close()
        assert connection.transaction_mode == "deferred"
        assert not connection.in_exclusive_transaction
        connection.rollback()

        with pytest.raises(Exception, match="definitely_missing_table"):
            connection.executescript(
                "BEGIN EXCLUSIVE; SELECT * FROM definitely_missing_table;"
            )
        assert connection.in_transaction
        assert connection.transaction_mode == "unknown"
        assert not connection.in_exclusive_transaction
        connection.rollback()

        connection.execute("CREATE TABLE implicit_transaction (value INTEGER)").close()
        connection.execute("INSERT INTO implicit_transaction VALUES (1)").close()
        assert connection.transaction_mode == "deferred"
        assert not connection.in_exclusive_transaction
    finally:
        connection.close()


def test_configures_and_reads_bounded_file_backed_temp_without_directory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    statements: list[str] = []
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def observed_execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        statements.append(sql)
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", observed_execute)
    try:
        configured = configure_sqlite_v1_baseline_temp_storage(connection)
        assert configured.temp_store == "file"
        assert configured.cache_kib == DEFAULT_SQLITE_V1_BASELINE_TEMP_CACHE_KIB == 8_192
        assert configured.cache_spill is True
        assert read_sqlite_v1_baseline_temp_storage(connection) == configured
        assert any(statement == "PRAGMA temp_store = FILE" for statement in statements)
        assert any(statement == "PRAGMA temp.cache_size = -8192" for statement in statements)
        assert any(statement == "PRAGMA cache_spill = ON" for statement in statements)
        assert all("temp_store_directory" not in statement.lower() for statement in statements)
        with pytest.raises(FrozenInstanceError):
            configured.cache_kib = 1  # type: ignore[misc]
    finally:
        connection.close()


def test_temp_configuration_rejects_transaction_scope_and_readback_drift() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("PRAGMA temp_store = MEMORY").close()
        with pytest.raises(ValueError, match="configuration drifted"):
            read_sqlite_v1_baseline_temp_storage(connection)

        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("PRAGMA temp.cache_spill = OFF").close()
        with pytest.raises(ValueError, match="configuration drifted"):
            read_sqlite_v1_baseline_temp_storage(connection)

        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match="outside a transaction"):
            configure_sqlite_v1_baseline_temp_storage(connection)
        with pytest.raises(ValueError, match="outside a transaction"):
            read_sqlite_v1_baseline_temp_storage(connection)
    finally:
        connection.close()


def test_temp_cache_boundaries_and_directory_pragma_are_closed() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        assert configure_sqlite_v1_baseline_temp_storage(
            connection,
            cache_kib=MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
        ).cache_kib == MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        assert configure_sqlite_v1_baseline_temp_storage(
            connection,
            cache_kib=MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB,
        ).cache_kib == MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB
        for cache_kib in (
            MIN_SQLITE_V1_BASELINE_TEMP_CACHE_KIB - 1,
            MAX_SQLITE_V1_BASELINE_TEMP_CACHE_KIB + 1,
            1.5,
            True,
        ):
            with pytest.raises(ValueError, match="outside bounds"):
                configure_sqlite_v1_baseline_temp_storage(
                    connection,
                    cache_kib=cache_kib,  # type: ignore[arg-type]
                )
        for sql in (
            "PRAGMA main.temp_store_directory = '/tmp'",
            "PRAGMA /* hostile */ [temp_store_directory] = '/tmp'",
        ):
            with pytest.raises(ValueError, match="temp_store_directory is forbidden"):
                connection.execute(sql)
        with pytest.raises(ValueError, match="temp_store_directory is forbidden"):
            connection.executescript("SELECT 1; PRAGMA temp_store_directory = '/tmp';")
    finally:
        connection.close()


def test_temp_stage_requires_exclusive_owner_transaction() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        with pytest.raises(ValueError, match="BLR_EXCLUSIVE_TRANSACTION_REQUIRED"):
            create_sqlite_v1_baseline_temp_stage(connection)
        for begin in ("BEGIN", "BEGIN IMMEDIATE"):
            connection.execute(begin).close()
            with pytest.raises(ValueError, match="BLR_EXCLUSIVE_TRANSACTION_REQUIRED"):
                create_sqlite_v1_baseline_temp_stage(connection)
            connection.rollback()
    finally:
        connection.close()


@pytest.mark.parametrize("profile", ["unconfigured", "memory", "small-cache", "no-spill"])
def test_temp_stage_rejects_invalid_file_profile_before_creating_catalog(
    profile: str,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    try:
        if profile != "unconfigured":
            configure_sqlite_v1_baseline_temp_storage(connection)
        if profile == "memory":
            connection.execute("PRAGMA temp_store = MEMORY").close()
        elif profile == "small-cache":
            connection.execute("PRAGMA temp.cache_size = -512").close()
        elif profile == "no-spill":
            connection.execute("PRAGMA cache_spill = OFF").close()
        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(ValueError, match="BLR_TEMP_STORAGE_REQUIRED"):
            create_sqlite_v1_baseline_temp_stage(connection)
        cursor = connection.execute(
            "SELECT count(*) FROM sqlite_temp_schema WHERE name GLOB 'ge_blr_*'"
        )
        try:
            assert cursor.fetchone() == (0,)
        finally:
            cursor.close()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_temp_stage_catalog_is_fixed_strict_and_without_rowid() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        expected_tables = {
            SQLITE_V1_BASELINE_COMMON_STAGE_TABLE,
            *SQLITE_V1_BASELINE_RELATION_TABLES,
        }
        cursor = connection.execute("PRAGMA temp.table_list")
        try:
            table_rows = cursor.fetchmany(100)
        finally:
            cursor.close()
        catalog = {
            row[1]: (row[4], row[5])
            for row in table_rows
            if row[1] in expected_tables
        }
        assert catalog == {name: (1, 1) for name in expected_tables}

        cursor = connection.execute(
            "SELECT name FROM sqlite_temp_schema "
            "WHERE type = 'index' AND name GLOB 'ge_blr_*' ORDER BY name"
        )
        try:
            indexes = {row[0] for row in cursor.fetchmany(100)}
        finally:
            cursor.close()
        assert indexes == {
            "ge_blr_checkpoint_current_record_idx",
            "ge_blr_checkpoint_revisions_latest_idx",
            "ge_blr_checkpoint_revisions_record_idx",
            "ge_blr_records_stream_position_idx",
            "ge_blr_records_stream_sequence_uidx",
            "ge_blr_records_tenant_hash_uidx",
            "ge_blr_used_leases_epoch_uidx",
            "ge_blr_used_leases_fencing_uidx",
            "ge_blr_used_migration_locks_epoch_uidx",
            "ge_blr_used_migration_locks_fencing_uidx",
        }
        cursor = connection.execute(
            "SELECT sql FROM sqlite_temp_schema WHERE type = 'view' AND name = ?",
            (SQLITE_V1_BASELINE_RELATION_KEYS_VIEW,),
        )
        try:
            view_row = cursor.fetchone()
        finally:
            cursor.close()
        assert view_row is not None
        assert "UNION ALL SELECT 11" in str(view_row[0])
        assert connection.in_exclusive_transaction
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_repeated_stage_creation_does_not_invalidate_or_leak_the_active_stage() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        with pytest.raises(ValueError, match="namespace is not empty"):
            create_sqlite_v1_baseline_temp_stage(connection)
        stage.assert_common_counts(_zero_counts())
        stage.assert_relation_key_coverage()
        stage.dispose()
        cursor = connection.execute(
            "SELECT count(*) FROM temp.sqlite_schema "
            "WHERE substr(lower(name), 1, 7) = 'ge_blr_'"
        )
        try:
            assert cursor.fetchone() == (0,)
        finally:
            cursor.close()
    finally:
        connection.rollback()
        connection.close()


def test_relation_tables_reject_inconsistent_stream_record_and_fence_rows() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        invalid_rows: tuple[tuple[str, tuple[object, ...]], ...] = (
            (
                "INSERT INTO temp.ge_blr_streams VALUES "
                "(?, 'tenant', 'stream', -1, 'unexpected', 1, 2)",
                (b"s1",),
            ),
            (
                "INSERT INTO temp.ge_blr_records VALUES "
                "(?, 'tenant', 'stream', 'record', 0, 'unexpected', 'rh', 'vh', 1, 2)",
                (b"r1",),
            ),
            (
                "INSERT INTO temp.ge_blr_leases VALUES "
                "(?, 'tenant', 'stream', 'lease', NULL, NULL, NULL, NULL, NULL, 1, 1, 2)",
                (b"l1",),
            ),
            (
                "INSERT INTO temp.ge_blr_used_leases VALUES "
                "(?, 'tenant', 'stream', 'lease', 1, 2, 3)",
                (b"u1",),
            ),
            (
                "INSERT INTO temp.ge_blr_migration_lock VALUES "
                "(?, 1, 'lock', 'owner', 2, 1, 1, 1, 1, 2, 1, 1, 2)",
                (b"m1",),
            ),
            (
                "INSERT INTO temp.ge_blr_used_migration_locks VALUES "
                "(?, 'lock', 1, 2, 3)",
                (b"v1",),
            ),
            (
                "INSERT INTO temp.ge_blr_legacy_operations "
                "(key_blob, tenant_id, operation_id, operation_name, request_hash, "
                "result_hash, result_blob_sha256, committed_at_ms, tail_exists, "
                "tail_record_hash, appended_records) VALUES "
                "(?, 'tenant', 'append-null', 'append', 'r', 'h', 'b', 1, 1, 'tail', 1)",
                (b"a1",),
            ),
            (
                "INSERT INTO temp.ge_blr_legacy_operations "
                "(key_blob, tenant_id, operation_id, operation_name, request_hash, "
                "result_hash, result_blob_sha256, committed_at_ms, checkpoint_deleted) "
                "VALUES (?, 'tenant', 'delete-null', 'delete-checkpoint', "
                "'r', 'h', 'b', 1, NULL)",
                (b"d1",),
            ),
        )
        before = connection.total_changes
        for sql, parameters in invalid_rows:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute(sql, parameters)
        assert connection.total_changes == before
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_common_stage_insert_count_duplicate_and_poison_lifecycle() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        entry = _schema_entry()
        assert _stage_state(stage) == "open"
        assert stage.common_entry_count == 0
        before = connection.total_changes
        stage.insert_common_entry(entry)
        assert connection.total_changes == before + 1
        assert stage.common_entry_count == 1
        with pytest.raises(ValueError, match="BLR_STAGE_KEY_DUPLICATE"):
            stage.insert_common_entry(entry)
        assert _stage_state(stage) == "poisoned"
        with pytest.raises(ValueError, match="only dispose"):
            _ = stage.common_entry_count
        stage.dispose()
        assert _stage_state(stage) == "disposed"
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_common_stage_poisoned_on_key_state_identity_mismatch() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        first = capture_baseline_entry(
            "stream-head",
            {"streamId": "stream", "tenantId": "tenant-a"},
            {
                "createdAtMs": 1,
                "streamId": "stream",
                "tailRecordHash": None,
                "tailSequence": -1,
                "tenantId": "tenant-a",
                "updatedAtMs": 1,
            },
        )
        second = capture_baseline_entry(
            "stream-head",
            {"streamId": "stream", "tenantId": "tenant-b"},
            {
                "createdAtMs": 1,
                "streamId": "stream",
                "tailRecordHash": None,
                "tailSequence": -1,
                "tenantId": "tenant-b",
                "updatedAtMs": 1,
            },
        )
        mismatched = BaselineEntryInput(
            entry_kind="stream-head",
            key=first.key,
            state=second.state,
            key_bytes=first.key_bytes,
            state_bytes=second.state_bytes,
        )
        with pytest.raises(ValueError, match="BLR_STAGE_WRITE_COUNT"):
            stage.insert_common_entry(mismatched)
        assert _stage_state(stage) == "poisoned"
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_catalog_creation_rejects_injected_row_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("CREATE TABLE caller_probe(value INTEGER)").close()
    connection.execute("BEGIN EXCLUSIVE").close()
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    injected = False

    def inject_row_write(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal injected
        cursor = original_execute(owner, sql, parameters)
        if not injected and sql.startswith("CREATE TEMP TABLE ge_blr_schema"):
            injected = True
            original_execute(owner, "INSERT INTO caller_probe(value) VALUES (1)").close()
        return cursor

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", inject_row_write)
    try:
        with pytest.raises(ValueError, match="BLR_UNEXPLAINED_WRITE"):
            create_sqlite_v1_baseline_temp_stage(connection)
        cursor = original_execute(
            connection,
            "SELECT count(*) FROM temp.sqlite_schema "
            "WHERE substr(lower(name), 1, 7) = 'ge_blr_'",
        )
        try:
            assert cursor.fetchone() == (0,)
        finally:
            cursor.close()
    finally:
        monkeypatch.undo()
        connection.rollback()
        connection.close()


def test_catalog_shape_failure_after_pragma_still_cleans_every_owned_object(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    original_validate = baseline_stage_module._validate_baseline_temp_catalog

    def reject_after_catalog_pragma(owner: SQLiteV1BaselineConnectionOwner) -> None:
        original_validate(owner)
        raise ValueError("BLR_STAGE_WRITE_COUNT: injected catalog shape failure")

    monkeypatch.setattr(
        baseline_stage_module,
        "_validate_baseline_temp_catalog",
        reject_after_catalog_pragma,
    )
    try:
        with pytest.raises(ValueError, match="injected catalog shape failure"):
            create_sqlite_v1_baseline_temp_stage(connection)
        cursor = connection.execute(
            "SELECT count(*) FROM temp.sqlite_schema "
            "WHERE substr(lower(name), 1, 7) = 'ge_blr_'"
        )
        try:
            assert cursor.fetchone() == (0,)
        finally:
            cursor.close()
    finally:
        connection.rollback()
        connection.close()


def test_common_stage_wrong_write_count_poisoned(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def ignored_common_insert(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if sql.startswith(f"INSERT INTO {SQLITE_V1_BASELINE_COMMON_STAGE_TABLE}"):
            return original_execute(owner, "SELECT 1")
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", ignored_common_insert)
    try:
        with pytest.raises(ValueError, match="BLR_STAGE_WRITE_COUNT"):
            stage.insert_common_entry(_schema_entry())
        assert _stage_state(stage) == "poisoned"
    finally:
        stage.dispose()
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_common_stage_exact_grouped_total_counts_and_expectation_bounds() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        before = connection.total_changes
        stage.assert_common_counts(_zero_counts())
        stage.assert_relation_key_coverage()
        assert connection.total_changes == before

        missing_kind = _zero_counts()
        del missing_kind["legacy-operation"]
        with pytest.raises(ValueError, match="exactly the twelve"):
            stage.assert_common_counts(missing_kind)
        with pytest.raises(ValueError, match="outside bounds"):
            stage.assert_common_counts({**_zero_counts(), "schema-envelope": True})
        with pytest.raises(ValueError, match="outside bounds"):
            stage.assert_common_counts(
                {**_zero_counts(), "schema-envelope": 9_007_199_254_740_992}
            )
        assert _stage_state(stage) == "open"
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_common_stage_wrong_expected_group_count_poisoned() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        stage.insert_common_entry(_schema_entry())
        with pytest.raises(ValueError, match="BLR_STAGE_COUNT"):
            stage.assert_common_counts(_zero_counts())
        assert _stage_state(stage) == "poisoned"
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_relation_key_coverage_poisoned_on_missing_relation() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        stage.insert_common_entry(_schema_entry())
        with pytest.raises(ValueError, match="BLR_STAGE_KEY_COVERAGE"):
            stage.assert_relation_key_coverage()
        assert _stage_state(stage) == "poisoned"
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_relation_key_coverage_poisoned_on_extra_relation() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        _insert_schema_relation(connection, _schema_entry().key_bytes)
        _accept_test_relation_writes(stage, connection)
        with pytest.raises(ValueError, match="BLR_STAGE_KEY_COVERAGE"):
            stage.assert_relation_key_coverage()
        assert _stage_state(stage) == "poisoned"
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_relation_key_coverage_poisoned_on_rank_mismatch() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        entry = _schema_entry()
        stage.insert_common_entry(entry)
        _insert_migration_relation(connection, entry.key_bytes)
        _accept_test_relation_writes(stage, connection)
        with pytest.raises(ValueError, match="BLR_STAGE_KEY_COVERAGE"):
            stage.assert_relation_key_coverage()
        assert _stage_state(stage) == "poisoned"
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_relation_key_coverage_accepts_exact_rank_and_key_match() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        entry = _schema_entry()
        stage.insert_common_entry(entry)
        _insert_schema_relation(connection, entry.key_bytes)
        _accept_test_relation_writes(stage, connection)
        before = connection.total_changes
        stage.assert_common_counts({**_zero_counts(), "schema-envelope": 1})
        stage.assert_relation_key_coverage()
        assert connection.total_changes == before
        assert _stage_state(stage) == "open"
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


@pytest.mark.parametrize(
    "entry",
    _relation_entries(),
    ids=[entry.entry_kind for entry in _relation_entries()],
)
def test_paired_writer_projects_each_entry_only_into_its_fixed_relation(
    entry: BaselineEntryInput,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        before = connection.total_changes
        stage.insert_entry_with_relation(entry)
        assert connection.total_changes == before + 2

        rank = BASELINE_ENTRY_KINDS.index(entry.entry_kind)
        for relation_rank, table in enumerate(SQLITE_V1_BASELINE_RELATION_TABLES):
            cursor = connection.execute(f"SELECT count(*) FROM temp.{table}")
            try:
                assert cursor.fetchone() == ((1,) if relation_rank == rank else (0,))
            finally:
                cursor.close()
        stage.assert_common_counts({**_zero_counts(), entry.entry_kind: 1})
        stage.assert_relation_key_coverage()
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_paired_writer_projects_delete_revision_with_no_put_carrier() -> None:
    entry = capture_baseline_entry(
        "checkpoint-revision",
        {"checkpointScope": "scope-a", "revision": 2, "tenantId": "tenant-a"},
        {
            "action": "delete",
            "boundRecordHash": None,
            "boundSequence": None,
            "checkpointCreatedAt": None,
            "checkpointId": "checkpoint-a",
            "checkpointScope": "scope-a",
            "recordedAtMs": 7,
            "revision": 2,
            "summary": None,
            "tenantId": "tenant-a",
            "valueBytes": None,
            "valueHash": None,
        },
    )
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        stage.insert_entry_with_relation(entry)
        cursor = connection.execute(
            "SELECT stream_id, bound_sequence, bound_record_hash, "
            "checkpoint_created_at, value_hash, value_bytes "
            "FROM temp.ge_blr_checkpoint_revisions"
        )
        try:
            assert cursor.fetchone() == (None, None, None, None, None, None)
        finally:
            cursor.close()
        stage.assert_relation_key_coverage()
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_paired_writer_requeries_and_proves_legacy_result_before_writes() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    entry = _install_legacy_source_row(connection)
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        before = connection.total_changes
        stage.insert_entry_with_relation(entry)
        assert connection.total_changes == before + 2
        cursor = connection.execute(
            "SELECT tail_exists, tail_sequence, tail_record_hash, appended_records, "
            "checkpoint_scope, lease_id, lock_id "
            "FROM temp.ge_blr_legacy_operations"
        )
        try:
            assert cursor.fetchone() == (1, 0, H1, 1, None, None, None)
        finally:
            cursor.close()
        stage.assert_common_counts({**_zero_counts(), "legacy-operation": 1})
        stage.assert_relation_key_coverage()
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


@pytest.mark.parametrize(
    ("operation_id", "operation", "result", "committed_at_ms"),
    LEGACY_RESULT_CASES,
    ids=[case[1] for case in LEGACY_RESULT_CASES],
)
def test_paired_writer_projects_all_nine_exact_legacy_result_shapes(
    operation_id: str,
    operation: CycleStoreProviderOperation,
    result: object,
    committed_at_ms: int,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _create_legacy_source_table(connection)
    entry, expected_row = _insert_legacy_fixture(
        connection,
        operation_id,
        operation,
        result,
        committed_at_ms,
    )
    connection.commit()
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        before = connection.total_changes
        stage.insert_entry_with_relation(entry)
        assert connection.total_changes == before + 2
        cursor = connection.execute(
            "SELECT * FROM temp.ge_blr_legacy_operations WHERE key_blob = ?",
            (entry.key_bytes,),
        )
        try:
            actual_row = cursor.fetchone()
        finally:
            cursor.close()
        assert actual_row is not None
        assert len(actual_row) == len(expected_row) == 38
        assert actual_row == expected_row
        derived = actual_row[8:]
        assert len(derived) == 30
        if operation in ("set-legal-hold", "release-migration-lock"):
            assert derived == (None,) * 30
        if operation in ("acquire-lease", "renew-lease"):
            assert derived[17] == 1_785_196_800_123
            assert derived[18] == 1_785_196_801_456
        if operation == "acquire-migration-lock":
            assert derived[28] == 1_785_196_800_123
            assert derived[29] == 1_785_196_801_456
        stage.assert_common_counts({**_zero_counts(), "legacy-operation": 1})
        stage.assert_relation_key_coverage()
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_legacy_source_query_is_main_qualified_against_temp_table_shadow() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _create_legacy_source_table(connection)
    entry, expected_row = _insert_legacy_fixture(
        connection,
        "op-shadow",
        "append",
        {
            "tail": {"exists": True, "sequence": 0, "recordHash": H1},
            "appendedRecords": 1,
        },
        110,
    )
    connection.commit()
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute(
        "CREATE TEMP TABLE ge_cycle_operations AS "
        "SELECT * FROM main.ge_cycle_operations WHERE 0"
    ).close()
    connection.execute(
        "INSERT INTO temp.ge_cycle_operations SELECT * FROM main.ge_cycle_operations"
    ).close()
    connection.execute(
        "UPDATE temp.ge_cycle_operations SET operation_name = 'release-migration-lock'"
    ).close()
    connection.commit()
    connection.execute("BEGIN EXCLUSIVE").close()
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        stage.insert_entry_with_relation(entry)
        cursor = connection.execute(
            "SELECT * FROM temp.ge_blr_legacy_operations WHERE key_blob = ?",
            (entry.key_bytes,),
        )
        try:
            assert cursor.fetchone() == expected_row
        finally:
            cursor.close()
        stage.assert_relation_key_coverage()
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_paired_writer_loads_nonempty_bidirectional_coverage_for_all_twelve_kinds() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    legacy = _install_legacy_source_row(connection)
    entries = [*_relation_entries(), legacy]
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        before = connection.total_changes
        for entry in entries:
            stage.insert_entry_with_relation(entry)
        assert connection.total_changes == before + 2 * len(BASELINE_ENTRY_KINDS)
        stage.assert_common_counts(dict.fromkeys(BASELINE_ENTRY_KINDS, 1))
        stage.assert_relation_key_coverage()
        cursor = connection.execute(
            f"SELECT count(*) FROM temp.{SQLITE_V1_BASELINE_RELATION_KEYS_VIEW}"
        )
        try:
            assert cursor.fetchone() == (len(BASELINE_ENTRY_KINDS),)
        finally:
            cursor.close()
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_paired_writer_duplicate_and_relation_failure_are_permanent_poison(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        entry = _schema_entry()
        stage.insert_entry_with_relation(entry)
        with pytest.raises(ValueError, match="duplicated"):
            stage.insert_entry_with_relation(entry)
        assert stage.state == "poisoned"
        with pytest.raises(ValueError, match="poisoned"):
            stage.insert_entry_with_relation(entry)
        stage.dispose()
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()

    second = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(second)
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def fail_relation(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if "INSERT INTO temp.ge_blr_schema" in sql:
            raise sqlite3.OperationalError("injected relation failure")
        return original_execute(owner, sql, parameters)

    try:
        stage = create_sqlite_v1_baseline_temp_stage(second)
        before = second.total_changes
        monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", fail_relation)
        with pytest.raises(ValueError, match="relation insert failed"):
            stage.insert_entry_with_relation(_schema_entry())
        assert second.total_changes == before + 1
        assert stage.state == "poisoned"
        monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", original_execute)
        cursor = second.execute(
            f"SELECT count(*) FROM temp.{SQLITE_V1_BASELINE_COMMON_STAGE_TABLE}"
        )
        try:
            assert cursor.fetchone() == (1,)
        finally:
            cursor.close()
        with pytest.raises(ValueError, match="poisoned"):
            stage.assert_relation_key_coverage()
        stage.dispose()
    finally:
        monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", original_execute)
        if second.in_transaction:
            second.rollback()
        second.close()


def test_paired_writer_rejects_external_dml_between_the_two_owned_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    connection.execute("CREATE TABLE hostile(value INTEGER NOT NULL)").close()
    _begin_configured_stage_transaction(connection)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    injected = False

    def inject_external_write(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal injected
        cursor = original_execute(owner, sql, parameters)
        if not injected and "INSERT INTO ge_blr_stage" in sql:
            injected = True
            external = original_execute(owner, "INSERT INTO main.hostile VALUES (1)")
            external.close()
        return cursor

    try:
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", inject_external_write)
        with pytest.raises(ValueError, match="wrong count"):
            stage.insert_entry_with_relation(_schema_entry())
        assert stage.state == "poisoned"
        monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", original_execute)
        cursor = connection.execute("SELECT count(*) FROM main.hostile")
        try:
            assert cursor.fetchone() == (1,)
        finally:
            cursor.close()
        stage.dispose()
    finally:
        monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", original_execute)
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_temp_stage_rejects_rollback_rebegin_and_disposes_twice() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    connection.rollback()
    connection.execute("BEGIN EXCLUSIVE").close()
    try:
        with pytest.raises(ValueError, match="BLR_TRANSACTION_CHANGED"):
            _ = stage.common_entry_count
        assert _stage_state(stage) == "poisoned"
        stage.dispose()
        stage.dispose()
        assert _stage_state(stage) == "disposed"
        assert connection.in_exclusive_transaction
    finally:
        if connection.in_transaction:
            connection.rollback()
        connection.close()


def test_temp_stage_context_disposal_is_reverse_order_and_never_ends_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    drops: list[str] = []
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def observed_execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if sql.startswith("DROP "):
            drops.append(sql)
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", observed_execute)
    try:
        with create_sqlite_v1_baseline_temp_stage(connection) as stage:
            assert stage.common_entry_count == 0
        assert _stage_state(stage) == "disposed"
        assert drops == [
            f"DROP VIEW temp.{SQLITE_V1_BASELINE_RELATION_KEYS_VIEW}",
            "DROP INDEX temp.ge_blr_used_migration_locks_fencing_uidx",
            "DROP INDEX temp.ge_blr_used_migration_locks_epoch_uidx",
            "DROP INDEX temp.ge_blr_used_leases_fencing_uidx",
            "DROP INDEX temp.ge_blr_used_leases_epoch_uidx",
            "DROP INDEX temp.ge_blr_checkpoint_revisions_record_idx",
            "DROP INDEX temp.ge_blr_checkpoint_revisions_latest_idx",
            "DROP INDEX temp.ge_blr_checkpoint_current_record_idx",
            "DROP INDEX temp.ge_blr_records_stream_position_idx",
            "DROP INDEX temp.ge_blr_records_stream_sequence_uidx",
            "DROP INDEX temp.ge_blr_records_tenant_hash_uidx",
            *[
                f"DROP TABLE temp.{name}"
                for name in reversed(
                    (
                        SQLITE_V1_BASELINE_COMMON_STAGE_TABLE,
                        *SQLITE_V1_BASELINE_RELATION_TABLES,
                    )
                )
            ],
        ]
        assert connection.in_exclusive_transaction
        cursor = connection.execute(
            "SELECT count(*) FROM sqlite_temp_schema WHERE name GLOB 'ge_blr_*'"
        )
        try:
            assert cursor.fetchone() == (0,)
        finally:
            cursor.close()
    finally:
        connection.rollback()
        connection.close()


def test_temp_stage_disposal_reports_drop_failure_and_reserved_residue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    attempted_drops: list[str] = []

    def failing_drop(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if sql.startswith("DROP "):
            attempted_drops.append(sql)
        if sql == "DROP TABLE temp.ge_blr_leases":
            raise sqlite3.OperationalError("injected drop failure")
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", failing_drop)
    try:
        with pytest.raises(ValueError, match="BLR_STAGE_DISPOSE") as raised:
            stage.dispose()
        assert isinstance(raised.value.__cause__, sqlite3.OperationalError)
        assert str(raised.value.__cause__) == "injected drop failure"
        assert _stage_state(stage) == "poisoned"
        assert "DROP TABLE temp.ge_blr_stage" in attempted_drops
        cursor = original_execute(
            connection,
            "SELECT type, name FROM sqlite_temp_schema WHERE name GLOB 'ge_blr_*'",
        )
        try:
            assert cursor.fetchmany(10) == [("table", "ge_blr_leases")]
        finally:
            cursor.close()
    finally:
        monkeypatch.undo()
        original_execute(connection, "DROP TABLE temp.ge_blr_leases").close()
        connection.rollback()
        connection.close()


def test_temp_stage_rejects_preexisting_baseline_namespace_without_deleting_it() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("CREATE TEMP TABLE GE_BLR_Hostile(value INTEGER)").close()
    connection.execute("BEGIN EXCLUSIVE").close()
    try:
        with pytest.raises(ValueError, match="namespace is not empty"):
            create_sqlite_v1_baseline_temp_stage(connection)
        cursor = connection.execute(
            "SELECT type FROM temp.sqlite_schema WHERE name = 'GE_BLR_Hostile'"
        )
        try:
            assert cursor.fetchone() == ("table",)
        finally:
            cursor.close()
    finally:
        connection.rollback()
        connection.execute("DROP TABLE temp.GE_BLR_Hostile").close()
        connection.close()


def test_stale_stage_disposal_never_drops_replacement_namespace_object() -> None:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    _begin_configured_stage_transaction(connection)
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    connection.rollback()
    connection.execute("BEGIN EXCLUSIVE").close()
    connection.execute("CREATE TEMP TABLE ge_blr_schema(replacement TEXT)").close()
    try:
        with pytest.raises(ValueError, match="BLR_TRANSACTION_CHANGED"):
            _ = stage.common_entry_count
        stage.dispose()
        cursor = connection.execute("PRAGMA temp.table_info('ge_blr_schema')")
        try:
            assert [row[1] for row in cursor.fetchmany(10)] == ["replacement"]
        finally:
            cursor.close()
    finally:
        connection.rollback()
        connection.close()
