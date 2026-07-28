from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import FrozenInstanceError, fields
from pathlib import Path
from typing import cast

import pytest

from graph_engineering.canonical import canonical_bytes, canonical_sha256
from graph_engineering.cycle_store_provider import (
    CycleStoreProviderOperation,
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    cycle_store_adapter_codec,
)
from graph_engineering.models import MAX_SAFE_INTEGER, JsonObject
from graph_engineering.sqlite_cycle_store import (
    _REQUIRED_MIGRATION_POSTCONDITIONS,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
    _load_migration_assets,
)
from graph_engineering.sqlite_operation_baseline import (
    BaselineAccumulator,
    create_baseline_id,
)
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    decode_sqlite_v1_cursor_seal_row,
)
from graph_engineering.sqlite_operation_baseline_source import (
    _MAXIMUM_NON_CURSOR_OBSERVED_SQL,
    SQLiteV1BaselineClockEvidence,
    SQLiteV1BaselineConnectionOwner,
    _SQLiteCursorCapability,
    capture_sqlite_v1_baseline_source_summary,
)

ROOT = Path(__file__).resolve().parents[2]
H1 = "1" * 64
H2 = "2" * 64
H3 = "3" * 64
NOW = 1_000
CLOCK_APPLIED_AT_MS = 1_785_110_405_000
CLOCK_AHEAD_AT_MS = CLOCK_APPLIED_AT_MS + 60_000
SOURCE_ASSETS = _load_migration_assets()


def database() -> SQLiteV1BaselineConnectionOwner:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    schema = (ROOT / "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql").read_text()
    connection.executescript(schema)
    connection.execute(
        """INSERT INTO ge_cycle_schema VALUES
           (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)""",
        (
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            SOURCE_ASSETS.schema_sql_hash,
            NOW,
            SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
            NOW,
            NOW,
        ),
    )
    connection.execute(
        """INSERT INTO ge_cycle_migrations VALUES
           (1, 0, 'fresh-v1-baseline', ?, ?, ?,
            'rebuild-from-verified-backup-only', ?)""",
        (
            SOURCE_ASSETS.schema_sql_hash,
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            NOW,
            canonical_bytes({"requiredPostconditions": list(_REQUIRED_MIGRATION_POSTCONDITIONS)}),
        ),
    )
    connection.execute(
        """INSERT INTO ge_cycle_migration_lock VALUES
           (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)""",
        (NOW,),
    )
    connection.commit()
    return connection


def add_checkpoint_history(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    value: object = 7,
) -> JsonObject:
    record = create_cycle_store_record(
        record_id="record-a",
        sequence=0,
        previous_record_hash=None,
        value={"checkpoint-anchor": True},
    )
    checkpoint = create_cycle_store_checkpoint(
        checkpoint_scope="scope-a",
        checkpoint_id="checkpoint-a",
        stream_id="stream-a",
        bound_sequence=cast(int, record["sequence"]),
        bound_record_hash=cast(str, record["recordHash"]),
        created_at="2026-07-28T00:00:00Z",
        value=value,
    )
    summary = {key: item for key, item in checkpoint.items() if key != "value"}
    summary_blob = cycle_store_adapter_codec.encode_ledger_result(
        "save-checkpoint",
        summary,
    )
    connection.execute(
        """INSERT INTO ge_cycle_streams
           (tenant_id, stream_id, tail_sequence, tail_record_hash,
            created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?)""",
        ("tenant-a", "stream-a", 0, record["recordHash"], NOW, NOW),
    )
    connection.execute(
        """INSERT INTO ge_cycle_records
           (tenant_id, stream_id, sequence, record_id, previous_record_hash,
            value_hash, value_bytes, value_blob, record_hash, record_blob,
            committed_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            "tenant-a",
            "stream-a",
            record["sequence"],
            record["recordId"],
            record["previousRecordHash"],
            record["valueHash"],
            record["valueBytes"],
            canonical_bytes(record["value"]),
            record["recordHash"],
            canonical_bytes(record),
            NOW,
        ),
    )
    for revision, action in ((1, "put"), (2, "delete"), (10, "put")):
        put = action == "put"
        connection.execute(
            """INSERT INTO ge_cycle_checkpoint_revisions
               (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
                summary_blob, bound_sequence, bound_record_hash,
                checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "tenant-a",
                checkpoint["checkpointScope"],
                revision,
                checkpoint["checkpointId"],
                action,
                summary_blob if put else None,
                checkpoint["boundSequence"] if put else None,
                checkpoint["boundRecordHash"] if put else None,
                checkpoint["createdAt"] if put else None,
                checkpoint["valueHash"] if put else None,
                checkpoint["valueBytes"] if put else None,
                NOW,
            ),
        )
    connection.execute(
        """INSERT INTO ge_cycle_checkpoints
           (tenant_id, checkpoint_scope, checkpoint_id, stream_id,
            bound_sequence, bound_record_hash, created_at, value_hash,
            value_bytes, value_blob, checkpoint_blob, summary_blob,
            checkpoint_revision, committed_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            "tenant-a",
            checkpoint["checkpointScope"],
            checkpoint["checkpointId"],
            checkpoint["streamId"],
            checkpoint["boundSequence"],
            checkpoint["boundRecordHash"],
            checkpoint["createdAt"],
            checkpoint["valueHash"],
            checkpoint["valueBytes"],
            canonical_bytes(checkpoint["value"]),
            canonical_bytes(checkpoint),
            summary_blob,
            10,
            NOW,
        ),
    )
    return checkpoint


_CURSOR_CLOCK_COLUMNS = """tenant_id, token_hash, kind, principal_hash,
 authorization_hash, stream_id, checkpoint_scope, request_scope_blob,
 page_size, next_position, snapshot_tail_sequence,
 snapshot_tail_record_hash, descriptor_hash, schema_identity_sha256,
 snapshot_blob, created_at_ms, expires_at_ms, consumed_at_ms"""


def _insert_clock_probe_cursor(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    created_at_ms: object,
    expires_at_ms: object,
    consumed_at_ms: object,
) -> None:
    request_scope = canonical_bytes(
        {
            "contractVersion": "cycle-store-provider/v1alpha1",
            "pageSize": 16,
            "streamId": "stream-a",
        }
    )
    snapshot = canonical_bytes(
        {
            "exists": False,
            "recordHash": None,
            "sequence": -1,
        }
    )
    connection.execute(
        f"""INSERT INTO ge_cycle_cursors ({_CURSOR_CLOCK_COLUMNS})
            VALUES ('tenant-a', ?, 'event', ?, ?, 'stream-a', NULL, ?, 16, 0,
                    -1, NULL, ?, ?, ?, ?, ?, ?)""",
        (
            H1,
            H2,
            H3,
            request_scope,
            SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            snapshot,
            created_at_ms,
            expires_at_ms,
            consumed_at_ms,
        ),
    ).close()


def _seed_clock_probe_database() -> SQLiteV1BaselineConnectionOwner:
    connection = database()
    add_checkpoint_history(connection)
    connection.execute(
        """INSERT INTO ge_cycle_leases
           (tenant_id, stream_id, active_lease_id, active_holder_id,
            active_lease_epoch, active_fencing_token, active_acquired_at_ms,
            active_expires_at_ms, last_lease_epoch, last_fencing_token,
            updated_at_ms)
           VALUES ('tenant-a', 'stream-a', 'lease-a', 'holder-a',
                   1, 1, ?, ?, 1, 1, ?)""",
        (NOW, NOW + 1, NOW),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_used_lease_ids
           (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
            first_used_at_ms)
           VALUES ('tenant-a', 'stream-a', 'lease-a', 1, 1, ?)""",
        (NOW,),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_legal_holds
           (tenant_id, stream_id, hold_id, placed_at_ms)
           VALUES ('tenant-a', 'stream-a', 'hold-a', ?)""",
        (NOW,),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_used_migration_lock_ids
           (lock_id, lock_epoch, fencing_token, first_used_at_ms)
           VALUES ('lock-a', 1, 1, ?)""",
        (NOW,),
    ).close()
    insert_legacy_operation(connection, committed_at_ms=NOW)
    _insert_clock_probe_cursor(
        connection,
        created_at_ms=NOW,
        expires_at_ms=NOW + 1,
        consumed_at_ms=NOW,
    )
    connection.execute(
        """UPDATE ge_cycle_schema
              SET latest_migration_applied_at_ms = ?,
                  created_at_ms = ?, updated_at_ms = ?""",
        (CLOCK_APPLIED_AT_MS, CLOCK_APPLIED_AT_MS, CLOCK_APPLIED_AT_MS),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migrations SET applied_at_ms = ?",
        (CLOCK_APPLIED_AT_MS,),
    ).close()
    for statement in (
        "UPDATE ge_cycle_streams SET created_at_ms = ?, updated_at_ms = ?",
        "UPDATE ge_cycle_records SET committed_at_ms = ?",
        "UPDATE ge_cycle_operations SET committed_at_ms = ?",
        "UPDATE ge_cycle_checkpoints SET committed_at_ms = ?",
        "UPDATE ge_cycle_checkpoint_revisions SET recorded_at_ms = ?",
        "UPDATE ge_cycle_leases SET updated_at_ms = ?",
        "UPDATE ge_cycle_used_lease_ids SET first_used_at_ms = ?",
        "UPDATE ge_cycle_legal_holds SET placed_at_ms = ?",
        "UPDATE ge_cycle_used_migration_lock_ids SET first_used_at_ms = ?",
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ?",
    ):
        parameter_count = statement.count("?")
        connection.execute(
            statement,
            (CLOCK_APPLIED_AT_MS,) * parameter_count,
        ).close()
    connection.execute(
        """UPDATE ge_cycle_cursors
              SET created_at_ms = ?, consumed_at_ms = ?, expires_at_ms = ?""",
        (CLOCK_APPLIED_AT_MS, CLOCK_APPLIED_AT_MS, CLOCK_APPLIED_AT_MS + 1),
    ).close()
    connection.commit()
    return connection


def add_scalar_source_families(connection: SQLiteV1BaselineConnectionOwner) -> None:
    connection.execute(
        """INSERT INTO ge_cycle_streams
           (tenant_id, stream_id, tail_sequence, tail_record_hash,
            created_at_ms, updated_at_ms)
           VALUES ('tenant-a', 'stream-0', -1, NULL, ?, ?)""",
        (NOW, NOW),
    )
    connection.execute(
        """INSERT INTO ge_cycle_streams
           (tenant_id, stream_id, tail_sequence, tail_record_hash,
            created_at_ms, updated_at_ms)
           VALUES ('tenant-a', 'stream-a', -1, NULL, ?, ?)""",
        (NOW, NOW),
    )
    connection.execute(
        """INSERT INTO ge_cycle_leases
           (tenant_id, stream_id, active_lease_id, active_holder_id,
            active_lease_epoch, active_fencing_token, active_acquired_at_ms,
            active_expires_at_ms, last_lease_epoch, last_fencing_token,
            updated_at_ms)
           VALUES ('tenant-a', 'stream-a', 'lease-2', 'holder-a',
                   2, 2, 900, 1100, 2, 2, ?)""",
        (NOW,),
    )
    connection.execute(
        """INSERT INTO ge_cycle_leases
           (tenant_id, stream_id, active_lease_id, active_holder_id,
            active_lease_epoch, active_fencing_token, active_acquired_at_ms,
            active_expires_at_ms, last_lease_epoch, last_fencing_token,
            updated_at_ms)
           VALUES ('tenant-a', 'stream-0', NULL, NULL, NULL, NULL, NULL, NULL,
                   0, 0, ?)""",
        (NOW,),
    )
    for lease_id, epoch, first_used_at_ms in (
        ("lease-2", 2, NOW),
        ("lease-10", 1, 900),
    ):
        connection.execute(
            """INSERT INTO ge_cycle_used_lease_ids
               (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
                first_used_at_ms)
               VALUES ('tenant-a', 'stream-a', ?, ?, ?, ?)""",
            (lease_id, epoch, epoch, first_used_at_ms),
        )
    for hold_id, placed_at_ms in (("hold-2", NOW), ("hold-10", 900)):
        connection.execute(
            """INSERT INTO ge_cycle_legal_holds
               (tenant_id, stream_id, hold_id, placed_at_ms)
               VALUES ('tenant-a', 'stream-a', ?, ?)""",
            (hold_id, placed_at_ms),
        )
    connection.execute(
        """UPDATE ge_cycle_migration_lock
              SET last_lock_epoch = 2, last_fencing_token = 2
            WHERE singleton = 1"""
    )
    for lock_id, epoch, first_used_at_ms in (
        ("lock-2", 2, NOW),
        ("lock-10", 1, 900),
    ):
        connection.execute(
            """INSERT INTO ge_cycle_used_migration_lock_ids
               (lock_id, lock_epoch, fencing_token, first_used_at_ms)
               VALUES (?, ?, ?, ?)""",
            (lock_id, epoch, epoch, first_used_at_ms),
        )


def legacy_result_rows() -> list[tuple[str, str, CycleStoreProviderOperation, object]]:
    tail = {"exists": True, "sequence": 0, "recordHash": H3}
    lease = {
        "leaseId": "lease-a",
        "holderId": "holder-a",
        "leaseEpoch": 1,
        "fencingToken": 1,
        "acquiredAt": "2026-07-28T00:00:00Z",
        "expiresAt": "2026-07-28T00:00:01Z",
    }
    return [
        ("tenant-b", "operation-1", "release-migration-lock", None),
        ("tenant-a", "operation-1", "delete-checkpoint", {"deleted": False}),
        (
            "tenant-a",
            "operation-10",
            "save-checkpoint",
            {
                "checkpointScope": "scope-a",
                "checkpointId": "checkpoint-a",
                "streamId": "stream-a",
                "boundSequence": 0,
                "boundRecordHash": H3,
                "createdAt": "2026-07-28T00:00:00Z",
                "valueHash": H2,
                "valueBytes": 2,
            },
        ),
        ("tenant-a", "operation-2", "append", {"tail": tail, "appendedRecords": 1}),
        ("tenant-a", "operation-3", "acquire-lease", lease),
        ("tenant-a", "operation-4", "renew-lease", lease),
        (
            "tenant-a",
            "operation-5",
            "release-lease",
            {
                "status": "released",
                "lease": None,
                "lastLeaseEpoch": 1,
                "lastFencingToken": 1,
            },
        ),
        (
            "tenant-a",
            "operation-6",
            "set-legal-hold",
            {
                "legalHoldIds": ["hold-a", "hold-b"],
                "retentionMode": "retain-authoritative-history",
                "archiveMode": "lossless-before-delete",
                "compactionMode": "logical-history-preserving",
            },
        ),
        (
            "tenant-a",
            "operation-7",
            "acquire-migration-lock",
            {
                "lockId": "lock-a",
                "ownerId": "owner-a",
                "sourceSchemaVersion": 1,
                "targetSchemaVersion": 2,
                "lockEpoch": 1,
                "fencingToken": 1,
                "acquiredAt": "2026-07-28T00:00:00Z",
                "expiresAt": "2026-07-28T00:00:01Z",
            },
        ),
        ("tenant-a", "operation-8", "release-migration-lock", None),
    ]


def insert_legacy_operation(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    tenant_id: object = "tenant-a",
    operation_id: object = "operation-a",
    operation_name: object = "delete-checkpoint",
    result: object = None,
    result_blob: object | None = None,
    request_hash: object = H1,
    result_hash: object | None = None,
    committed_at_ms: object = NOW,
) -> bytes:
    encoded = (
        cycle_store_adapter_codec.encode_ledger_result(
            cast(CycleStoreProviderOperation, operation_name),
            {"deleted": True} if result is None else result,
        )
        if result_blob is None
        else cast(bytes, result_blob)
    )
    logical_hash = (
        canonical_sha256({"deleted": True} if result is None else result)
        if result_hash is None
        else result_hash
    )
    connection.execute(
        """INSERT INTO ge_cycle_operations
           (tenant_id, operation_id, operation_name, request_hash,
            result_blob, result_hash, committed_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            tenant_id,
            operation_id,
            operation_name,
            request_hash,
            encoded,
            logical_hash,
            committed_at_ms,
        ),
    )
    return encoded


def test_captures_frozen_v1_envelope_counts_and_watermark_inside_transaction() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        assert summary.source_envelope["sourceMigrationLineageId"] == "fresh-v1-baseline"
        assert summary.source_envelope["sourceApplicationId"] == 1_195_724_359
        assert len(summary.counts_by_kind) == 12
        assert summary.counts_by_kind["schema-envelope"] == 1
        assert summary.counts_by_kind["migration-lineage"] == 1
        assert summary.counts_by_kind["migration-lock-current"] == 1
        assert summary.expected_entry_count == 3
        assert summary.clock_evidence == SQLiteV1BaselineClockEvidence(
            captured_at_ms=NOW,
            maximum_non_cursor_observed_at_ms=NOW,
            provider_high_water_at_ms=NOW,
        )
        assert [item.name for item in fields(SQLiteV1BaselineClockEvidence)] == [
            "captured_at_ms",
            "maximum_non_cursor_observed_at_ms",
            "provider_high_water_at_ms",
        ]
        with pytest.raises(FrozenInstanceError):
            summary.clock_evidence.provider_high_water_at_ms = NOW + 1  # type: ignore[misc]
    finally:
        connection.close()


def test_identity_iterator_streams_three_families_into_exact_accumulator_once() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        accumulator = BaselineAccumulator(
            create_baseline_id(summary.source_envelope),
            summary.expected_entry_count,
        )
        entries = tuple(summary.iter_identity_entries())
        assert [entry.entry_kind for entry in entries] == [
            "schema-envelope",
            "migration-lineage",
            "migration-lock-current",
        ]
        chained = tuple(accumulator.append(entry) for entry in entries)
        completed = accumulator.finish()
        assert completed.entry_count == 3
        assert completed.legacy_operation_count == 0
        assert completed.first_entry_hash == chained[0].entry_hash
        assert completed.final_entry_hash == chained[-1].entry_hash
        with pytest.raises(ValueError, match="already consumed"):
            summary.iter_identity_entries()
    finally:
        connection.close()


def test_identity_iterator_rejects_noncanonical_or_drifted_postconditions() -> None:
    connection = database()
    try:
        connection.execute(
            "UPDATE ge_cycle_migrations SET postconditions_blob = ? WHERE version = 1",
            (b'{"requiredPostconditions": ["drift"]}',),
        )
        connection.commit()
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        with pytest.raises(ValueError, match="migration-lineage source row is invalid"):
            tuple(summary.iter_identity_entries())
    finally:
        connection.close()


def test_summary_is_immutable_and_returns_detached_source_envelopes() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        detached = summary.source_envelope
        detached["capturedAtMs"] = 0
        assert summary.source_envelope["capturedAtMs"] == NOW
        with pytest.raises(FrozenInstanceError):
            summary.expected_entry_count = 4  # type: ignore[misc]
        with pytest.raises(TypeError):
            summary.counts_by_kind["schema-envelope"] = 0  # type: ignore[index]
    finally:
        connection.close()


def test_identity_iterator_reconciles_captured_schema_and_migration_identity() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        connection.execute(
            "UPDATE ge_cycle_schema SET provider_descriptor_hash = ? WHERE singleton = 1",
            (H1,),
        )
        with pytest.raises(ValueError, match="captured transaction changed"):
            next(summary.iter_identity_entries())
    finally:
        connection.close()

    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        iterator = summary.iter_identity_entries()
        assert next(iterator).entry_kind == "schema-envelope"
        connection.execute(
            "UPDATE ge_cycle_migrations SET applied_at_ms = ? WHERE version = 1",
            (NOW - 1,),
        )
        with pytest.raises(ValueError, match="captured transaction changed"):
            next(iterator)
    finally:
        connection.close()


def test_identity_iterator_fails_if_transaction_ends_after_first_yield() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        cursor_capability = connection.execute("SELECT 1")
        assert not hasattr(cursor_capability, "connection")
        cursor_capability.close()
        iterator = summary.iter_identity_entries()
        assert next(iterator).entry_kind == "schema-envelope"
        assert not hasattr(connection, "set_authorizer")
        connection.execute(";;/* hostile */ ROLLBACK")
        connection.execute(";-- hostile\nBEGIN EXCLUSIVE")
        connection.execute("PRAGMA defer_foreign_keys = ON")
        with pytest.raises(ValueError, match="captured transaction changed"):
            next(iterator)
    finally:
        connection.close()


def test_leading_empty_statement_cannot_hide_savepoint_rollback() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        connection.execute("SAVEPOINT before_capture")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        iterator = summary.iter_identity_entries()
        assert next(iterator).entry_kind == "schema-envelope"
        connection.execute(";;/* hostile */ ROLLBACK TO before_capture")
        with pytest.raises(ValueError, match="captured transaction changed"):
            next(iterator)
    finally:
        connection.close()


def test_count_preserving_source_mutation_after_capture_is_rejected() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        connection.execute(
            """INSERT INTO ge_cycle_streams
               (tenant_id, stream_id, tail_sequence, tail_record_hash,
                created_at_ms, updated_at_ms)
               VALUES ('tenant-a', 'stream-a', -1, NULL, ?, ?)""",
            (NOW, NOW),
        )
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        connection.execute(
            "UPDATE ge_cycle_streams SET stream_id = 'stream-b' WHERE stream_id = 'stream-a'"
        )
        with pytest.raises(ValueError, match="captured transaction changed"):
            tuple(summary.iter_identity_entries())
    finally:
        connection.close()


def test_stream_and_scalar_record_carriers_are_streamed_and_verified() -> None:
    connection = database()
    try:
        record = create_cycle_store_record(
            record_id="record-a",
            sequence=0,
            previous_record_hash=None,
            value=7,
        )
        connection.execute("BEGIN EXCLUSIVE")
        connection.execute(
            """INSERT INTO ge_cycle_streams
               (tenant_id, stream_id, tail_sequence, tail_record_hash,
                created_at_ms, updated_at_ms)
               VALUES (?, ?, -1, NULL, ?, ?)""",
            ("tenant-a", "stream-a", NOW, NOW),
        )
        connection.execute(
            """INSERT INTO ge_cycle_records
               (tenant_id, stream_id, sequence, record_id, previous_record_hash,
                value_hash, value_bytes, value_blob, record_hash, record_blob,
                committed_at_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "tenant-a",
                "stream-a",
                record["sequence"],
                record["recordId"],
                record["previousRecordHash"],
                record["valueHash"],
                record["valueBytes"],
                canonical_bytes(record["value"]),
                record["recordHash"],
                canonical_bytes(record),
                NOW,
            ),
        )
        connection.execute(
            """UPDATE ge_cycle_streams
                  SET tail_sequence = ?, tail_record_hash = ?
                WHERE tenant_id = ? AND stream_id = ?""",
            (record["sequence"], record["recordHash"], "tenant-a", "stream-a"),
        )
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        entries = tuple(summary.iter_identity_entries())
        assert [entry.entry_kind for entry in entries] == [
            "schema-envelope",
            "migration-lineage",
            "stream-head",
            "record-identity",
            "migration-lock-current",
        ]
        assert entries[3].state["valueBytes"] == 1
        assert entries[3].state["recordHash"] == record["recordHash"]

        connection.execute(
            "UPDATE ge_cycle_records SET value_blob = ? WHERE record_id = ?",
            (b"8", record["recordId"]),
        )
        corrupted = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        with pytest.raises(ValueError, match="record-identity source row is invalid"):
            tuple(corrupted.iter_identity_entries())
    finally:
        connection.close()


def test_checkpoint_current_and_revisions_stream_canonical_scalar_carriers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = database()
    try:
        fetch_sizes: list[int] = []
        original_fetchmany = _SQLiteCursorCapability.fetchmany

        def observed_fetchmany(
            cursor: _SQLiteCursorCapability,
            size: int,
        ) -> list[tuple[object, ...]]:
            fetch_sizes.append(size)
            return original_fetchmany(cursor, size)

        monkeypatch.setattr(_SQLiteCursorCapability, "fetchmany", observed_fetchmany)
        connection.execute("BEGIN EXCLUSIVE")
        checkpoint = add_checkpoint_history(connection, value=7)
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        assert summary.expected_entry_count == 9
        entries = tuple(summary.iter_identity_entries())
        assert [entry.entry_kind for entry in entries] == [
            "schema-envelope",
            "migration-lineage",
            "stream-head",
            "record-identity",
            "checkpoint-current",
            "checkpoint-revision",
            "checkpoint-revision",
            "checkpoint-revision",
            "migration-lock-current",
        ]
        current = entries[4]
        assert current.key == {
            "checkpointId": "checkpoint-a",
            "checkpointScope": "scope-a",
            "tenantId": "tenant-a",
        }
        assert current.state["valueBytes"] == 1
        assert current.state["valueHash"] == checkpoint["valueHash"]
        assert current.state["checkpointRevision"] == 10
        revisions = entries[5:8]
        assert [entry.key["revision"] for entry in revisions] == [1, 10, 2]
        assert revisions[0].state["action"] == "put"
        assert revisions[1].state["summary"] == current.state["summary"]
        assert revisions[2].state["action"] == "delete"
        assert all(
            revisions[2].state[field] is None
            for field in (
                "boundRecordHash",
                "boundSequence",
                "checkpointCreatedAt",
                "summary",
                "valueBytes",
                "valueHash",
            )
        )
        accumulator = BaselineAccumulator(
            create_baseline_id(summary.source_envelope),
            summary.expected_entry_count,
        )
        for entry in entries:
            accumulator.append(entry)
        assert accumulator.finish().entry_count == summary.expected_entry_count
        assert fetch_sizes == [256] * 6 + [1] * 8 + [256] * 6 + [1]
    finally:
        connection.close()


@pytest.mark.parametrize(
    ("column", "replacement"),
    [
        ("value_blob", b"8"),
        ("checkpoint_blob", b"{}"),
        ("summary_blob", b"{}"),
    ],
)
def test_checkpoint_current_rejects_hostile_carrier_drift(
    column: str,
    replacement: bytes,
) -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        add_checkpoint_history(connection)
        connection.execute(
            f"UPDATE ge_cycle_checkpoints SET {column} = ? WHERE checkpoint_id = ?",
            (replacement, "checkpoint-a"),
        )
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        with pytest.raises(ValueError, match="checkpoint-current source row is invalid"):
            tuple(summary.iter_identity_entries())
    finally:
        connection.close()


@pytest.mark.parametrize(
    "mutation",
    [
        "UPDATE ge_cycle_checkpoint_revisions SET summary_blob = NULL WHERE revision = 1",
        "UPDATE ge_cycle_checkpoint_revisions SET bound_sequence = 0 WHERE revision = 2",
        "UPDATE ge_cycle_checkpoint_revisions SET bound_sequence = 1 WHERE revision = 10",
    ],
)
def test_checkpoint_revision_rejects_nullable_and_outer_identity_drift(
    mutation: str,
) -> None:
    connection = database()
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute("BEGIN EXCLUSIVE")
        add_checkpoint_history(connection)
        connection.execute(mutation)
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        with pytest.raises(ValueError, match="checkpoint-revision source row is invalid"):
            tuple(summary.iter_identity_entries())
    finally:
        connection.close()


def test_scalar_source_families_stream_closed_state_in_canonical_order() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        add_scalar_source_families(connection)
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        assert summary.expected_entry_count == 13
        entries = tuple(summary.iter_identity_entries())
        assert [entry.entry_kind for entry in entries] == [
            "schema-envelope",
            "migration-lineage",
            "stream-head",
            "stream-head",
            "lease-current",
            "lease-current",
            "used-lease-identity",
            "used-lease-identity",
            "legal-hold",
            "legal-hold",
            "migration-lock-current",
            "used-migration-lock-identity",
            "used-migration-lock-identity",
        ]
        inactive_lease = entries[4]
        lease = entries[5]
        assert inactive_lease.key == {"streamId": "stream-0", "tenantId": "tenant-a"}
        assert all(
            inactive_lease.state[field] is None
            for field in (
                "activeAcquiredAtMs",
                "activeExpiresAtMs",
                "activeFencingToken",
                "activeHolderId",
                "activeLeaseEpoch",
                "activeLeaseId",
            )
        )
        assert lease.key == {"streamId": "stream-a", "tenantId": "tenant-a"}
        assert lease.state["activeLeaseId"] == "lease-2"
        assert lease.state["activeLeaseEpoch"] == lease.state["activeFencingToken"] == 2
        assert lease.state["lastLeaseEpoch"] == lease.state["lastFencingToken"] == 2
        assert [entry.key["leaseId"] for entry in entries[6:8]] == [
            "lease-10",
            "lease-2",
        ]
        assert [entry.key["holdId"] for entry in entries[8:10]] == [
            "hold-10",
            "hold-2",
        ]
        assert [entry.key["lockId"] for entry in entries[11:13]] == [
            "lock-10",
            "lock-2",
        ]
        accumulator = BaselineAccumulator(
            create_baseline_id(summary.source_envelope),
            summary.expected_entry_count,
        )
        for entry in entries:
            accumulator.append(entry)
        assert accumulator.finish().entry_count == summary.expected_entry_count
    finally:
        connection.close()


@pytest.mark.parametrize(
    ("mutation", "family"),
    [
        (
            "UPDATE ge_cycle_leases SET active_holder_id = NULL",
            "lease-current",
        ),
        (
            "UPDATE ge_cycle_leases SET last_fencing_token = 3",
            "lease-current",
        ),
        (
            "UPDATE ge_cycle_leases SET active_lease_epoch = 1",
            "lease-current",
        ),
        (
            "UPDATE ge_cycle_used_lease_ids SET fencing_token = 3 WHERE lease_id = 'lease-2'",
            "used-lease-identity",
        ),
        (
            "UPDATE ge_cycle_legal_holds SET hold_id = '' WHERE hold_id = 'hold-2'",
            "legal-hold",
        ),
        (
            "UPDATE ge_cycle_used_migration_lock_ids SET fencing_token = 3 "
            "WHERE lock_id = 'lock-2'",
            "used-migration-lock-identity",
        ),
    ],
)
def test_scalar_source_families_reject_partial_active_and_epoch_drift(
    mutation: str,
    family: str,
) -> None:
    connection = database()
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute("BEGIN EXCLUSIVE")
        add_scalar_source_families(connection)
        connection.execute(mutation)
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        with pytest.raises(ValueError, match=rf"{family} source row is invalid"):
            tuple(summary.iter_identity_entries())
    finally:
        connection.close()


def test_legacy_operations_stream_all_closed_results_in_canonical_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = database()
    try:
        fetch_sizes: list[int] = []
        original_fetchmany = _SQLiteCursorCapability.fetchmany

        def observed_fetchmany(
            cursor: _SQLiteCursorCapability,
            size: int,
        ) -> list[tuple[object, ...]]:
            fetch_sizes.append(size)
            return original_fetchmany(cursor, size)

        monkeypatch.setattr(_SQLiteCursorCapability, "fetchmany", observed_fetchmany)
        connection.execute("BEGIN EXCLUSIVE")
        rows = legacy_result_rows()
        expected: dict[tuple[str, str], tuple[bytes, str]] = {}
        for tenant_id, operation_id, operation_name, result in rows:
            result_blob = cycle_store_adapter_codec.encode_ledger_result(
                operation_name,
                result,
            )
            result_hash = canonical_sha256(result)
            connection.execute(
                """INSERT INTO ge_cycle_operations
                   (tenant_id, operation_id, operation_name, request_hash,
                    result_blob, result_hash, committed_at_ms)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    tenant_id,
                    operation_id,
                    operation_name,
                    H1,
                    result_blob,
                    result_hash,
                    NOW,
                ),
            )
            expected[(operation_id, tenant_id)] = (result_blob, result_hash)

        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        assert summary.expected_entry_count == 13
        entries = tuple(summary.iter_identity_entries())
        legacy = entries[3:]
        assert [entry.entry_kind for entry in entries[:3]] == [
            "schema-envelope",
            "migration-lineage",
            "migration-lock-current",
        ]
        assert [(entry.key["operationId"], entry.key["tenantId"]) for entry in legacy] == [
            ("operation-1", "tenant-a"),
            ("operation-1", "tenant-b"),
            ("operation-10", "tenant-a"),
            ("operation-2", "tenant-a"),
            ("operation-3", "tenant-a"),
            ("operation-4", "tenant-a"),
            ("operation-5", "tenant-a"),
            ("operation-6", "tenant-a"),
            ("operation-7", "tenant-a"),
            ("operation-8", "tenant-a"),
        ]
        assert {entry.state["operationName"] for entry in legacy} == {
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
        for entry in legacy:
            identity = (cast(str, entry.key["operationId"]), cast(str, entry.key["tenantId"]))
            result_blob, result_hash = expected[identity]
            assert entry.state["resultBlobSha256"] == hashlib.sha256(result_blob).hexdigest()
            assert entry.state["resultHash"] == result_hash
            assert entry.state["requestHash"] == H1
            assert entry.state["committedAtMs"] == NOW
        assert fetch_sizes[-11:] == [1] * 11
    finally:
        connection.close()


@pytest.mark.parametrize(
    "tamper",
    [
        "unknown-operation",
        "noncanonical",
        "wrong-operation-shape",
        "result-hash",
        "one-byte",
        "oversized",
        "tenant-id",
        "operation-id",
        "request-hash",
        "committed-at",
        "payload-marker",
    ],
)
def test_legacy_operation_rejects_hostile_row_and_never_leaks_blob(tamper: str) -> None:
    connection = database()
    marker = "MUST_NOT_LEAK_LEGACY_RESULT_7f9238"
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON")
        connection.execute("BEGIN EXCLUSIVE")
        operation_name: object = "delete-checkpoint"
        result_blob: object | None = None
        result_hash: object | None = None
        tenant_id: object = "tenant-a"
        operation_id: object = "operation-a"
        request_hash: object = H1
        committed_at_ms: object = NOW
        if tamper == "unknown-operation":
            operation_name = "DELETE-CHECKPOINT"
            result_blob = canonical_bytes({"deleted": True})
        elif tamper == "noncanonical":
            result_blob = b'{ "deleted":true}'
        elif tamper == "wrong-operation-shape":
            operation_name = "append"
            result_blob = canonical_bytes({"deleted": True})
        elif tamper == "result-hash":
            result_hash = H2
        elif tamper == "one-byte":
            result_blob = b"0"
        elif tamper == "oversized":
            result_blob = b"0" * 16_777_217
        elif tamper == "tenant-id":
            tenant_id = ""
        elif tamper == "operation-id":
            operation_id = ".."
        elif tamper == "request-hash":
            request_hash = "A" * 64
        elif tamper == "committed-at":
            committed_at_ms = -1
        else:
            result_blob = canonical_bytes({"deleted": True, "secret": marker})

        insert_legacy_operation(
            connection,
            tenant_id=tenant_id,
            operation_id=operation_id,
            operation_name=operation_name,
            result_blob=result_blob,
            request_hash=request_hash,
            result_hash=result_hash,
            committed_at_ms=committed_at_ms,
        )
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        assert summary.expected_entry_count == 4
        with pytest.raises(ValueError, match="legacy-operation source row is invalid") as raised:
            tuple(summary.iter_identity_entries())
        error: BaseException | None = raised.value
        messages: list[str] = []
        while error is not None:
            messages.append(str(error))
            error = error.__cause__
        assert marker not in " ".join(messages)
    finally:
        connection.close()


@pytest.mark.parametrize("tamper", ["user-version", "descriptor", "lineage"])
def test_capture_rejects_pragma_or_frozen_source_anchor_drift(tamper: str) -> None:
    connection = database()
    try:
        if tamper == "user-version":
            connection.execute("PRAGMA user_version = 2")
        elif tamper == "descriptor":
            connection.execute(
                "UPDATE ge_cycle_schema SET provider_descriptor_hash = ?",
                (H1,),
            )
        else:
            connection.execute("UPDATE ge_cycle_migrations SET migration_id = 'forged-v1'")
        connection.commit()
        connection.execute("BEGIN EXCLUSIVE")
        with pytest.raises(ValueError, match=r"version|frozen source identity"):
            capture_sqlite_v1_baseline_source_summary(
                connection,
                captured_at_ms=NOW,
            )
    finally:
        connection.close()


def test_requires_transaction_and_rejects_capture_or_clock_drift() -> None:
    connection = database()
    try:
        with pytest.raises(ValueError, match="active EXCLUSIVE transaction"):
            capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        connection.execute("BEGIN")
        with pytest.raises(ValueError, match="active EXCLUSIVE transaction"):
            capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        connection.rollback()
        connection.execute("BEGIN IMMEDIATE")
        with pytest.raises(ValueError, match="active EXCLUSIVE transaction"):
            capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        connection.rollback()
        connection.execute("BEGIN EXCLUSIVE")
        for unsafe_capture in (-1, True, 1.5, MAX_SAFE_INTEGER + 1):
            with pytest.raises(ValueError, match="capture time"):
                capture_sqlite_v1_baseline_source_summary(
                    connection,
                    captured_at_ms=unsafe_capture,  # type: ignore[arg-type]
                )
        with pytest.raises(ValueError, match="capture predates"):
            capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW - 1)
        connection.execute(
            "UPDATE ge_cycle_schema SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1"
        )
        with pytest.raises(ValueError, match="high-water predates"):
            capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW + 2)
    finally:
        connection.close()


def test_cursor_clocks_ahead_of_high_water_are_deferred_to_cursor_campaign() -> None:
    connection = _seed_clock_probe_database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        connection.execute(
            """UPDATE ge_cycle_cursors
                  SET created_at_ms = ?, consumed_at_ms = ?, expires_at_ms = ?""",
            (CLOCK_AHEAD_AT_MS, CLOCK_AHEAD_AT_MS + 60_000, CLOCK_AHEAD_AT_MS + 120_000),
        ).close()
        cursor = connection.execute(f"SELECT {_CURSOR_CLOCK_COLUMNS} FROM ge_cycle_cursors")
        try:
            physical = cursor.fetchone()
        finally:
            cursor.close()
        assert physical is not None
        decoded = decode_sqlite_v1_cursor_seal_row(physical)
        assert decoded.carrier.created_at_ms == CLOCK_AHEAD_AT_MS
        assert decoded.carrier.consumed_at_ms == CLOCK_AHEAD_AT_MS + 60_000
        assert decoded.descriptor_hash == SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
        assert decoded.schema_identity_sha256 == SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=CLOCK_APPLIED_AT_MS,
        )
        assert summary.clock_evidence == SQLiteV1BaselineClockEvidence(
            captured_at_ms=CLOCK_APPLIED_AT_MS,
            maximum_non_cursor_observed_at_ms=CLOCK_APPLIED_AT_MS,
            provider_high_water_at_ms=CLOCK_APPLIED_AT_MS,
        )
        assert summary.clock_evidence.captured_at_ms == summary.source_envelope["capturedAtMs"]
        connection.execute(
            "UPDATE ge_cycle_streams SET updated_at_ms = ? WHERE stream_id = 'stream-a'",
            (CLOCK_AHEAD_AT_MS,),
        ).close()
        with pytest.raises(ValueError, match="high-water predates non-cursor source state"):
            capture_sqlite_v1_baseline_source_summary(
                connection,
                captured_at_ms=CLOCK_APPLIED_AT_MS,
            )
    finally:
        connection.close()


def test_non_cursor_clock_query_has_frozen_cross_runtime_identity() -> None:
    normalized = " ".join(_MAXIMUM_NON_CURSOR_OBSERVED_SQL.split())
    assert hashlib.sha256(normalized.encode()).hexdigest() == (
        "c85e9836aadf613752aa9ba078c00248a4aa5cc3faafda916409b1ddf3201e1b"
    )
    assert "ge_cycle_cursors" not in normalized
    assert "expires_at_ms" not in normalized
    assert normalized.count("UNION ALL SELECT") == 14


def test_every_retained_non_cursor_clock_keeps_source_failure_ownership() -> None:
    connection = _seed_clock_probe_database()
    probes = (
        ("schema created", ("UPDATE ge_cycle_schema SET created_at_ms = ?",)),
        ("schema updated", ("UPDATE ge_cycle_schema SET updated_at_ms = ?",)),
        (
            "migration applied pair",
            (
                "UPDATE ge_cycle_schema SET latest_migration_applied_at_ms = ?",
                "UPDATE ge_cycle_migrations SET applied_at_ms = ?",
            ),
        ),
        ("stream created", ("UPDATE ge_cycle_streams SET created_at_ms = ?",)),
        ("stream updated", ("UPDATE ge_cycle_streams SET updated_at_ms = ?",)),
        ("record committed", ("UPDATE ge_cycle_records SET committed_at_ms = ?",)),
        ("operation committed", ("UPDATE ge_cycle_operations SET committed_at_ms = ?",)),
        (
            "checkpoint committed",
            ("UPDATE ge_cycle_checkpoints SET committed_at_ms = ?",),
        ),
        (
            "checkpoint revision recorded",
            ("UPDATE ge_cycle_checkpoint_revisions SET recorded_at_ms = ?",),
        ),
        ("lease updated", ("UPDATE ge_cycle_leases SET updated_at_ms = ?",)),
        (
            "used lease first-use",
            ("UPDATE ge_cycle_used_lease_ids SET first_used_at_ms = ?",),
        ),
        ("legal hold placed", ("UPDATE ge_cycle_legal_holds SET placed_at_ms = ?",)),
        (
            "used lock first-use",
            ("UPDATE ge_cycle_used_migration_lock_ids SET first_used_at_ms = ?",),
        ),
    )
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        for label, statements in probes:
            connection.execute("BEGIN EXCLUSIVE").close()
            for statement in statements:
                connection.execute(statement, (CLOCK_AHEAD_AT_MS,)).close()
            with pytest.raises(
                ValueError,
                match="high-water predates non-cursor source state",
            ) as failure:
                capture_sqlite_v1_baseline_source_summary(
                    connection,
                    captured_at_ms=CLOCK_APPLIED_AT_MS,
                )
            assert label
            assert "non-cursor" in str(failure.value)
            connection.rollback()

        connection.execute("BEGIN EXCLUSIVE").close()
        connection.execute(
            "UPDATE ge_cycle_migration_lock SET updated_at_ms = ? WHERE singleton = 1",
            (CLOCK_AHEAD_AT_MS,),
        ).close()
        with pytest.raises(ValueError, match="capture predates provider clock high-water"):
            capture_sqlite_v1_baseline_source_summary(
                connection,
                captured_at_ms=CLOCK_APPLIED_AT_MS,
            )
        connection.rollback()
    finally:
        connection.close()


def test_all_explicitly_excluded_clocks_leave_source_evidence_unchanged() -> None:
    connection = _seed_clock_probe_database()
    exact = SQLiteV1BaselineClockEvidence(
        captured_at_ms=CLOCK_APPLIED_AT_MS,
        maximum_non_cursor_observed_at_ms=CLOCK_APPLIED_AT_MS,
        provider_high_water_at_ms=CLOCK_APPLIED_AT_MS,
    )
    probes: tuple[tuple[str, str, tuple[object, ...]], ...] = (
        (
            "cursor provider clocks and expiry",
            """UPDATE ge_cycle_cursors
                  SET created_at_ms = ?, consumed_at_ms = ?, expires_at_ms = ?""",
            (CLOCK_AHEAD_AT_MS, CLOCK_AHEAD_AT_MS + 1_000, CLOCK_AHEAD_AT_MS + 2_000),
        ),
        (
            "lease future expiry",
            "UPDATE ge_cycle_leases SET active_expires_at_ms = ?",
            (CLOCK_AHEAD_AT_MS,),
        ),
        (
            "migration-lock future expiry",
            "UPDATE ge_cycle_migration_lock SET active_expires_at_ms = ?",
            (CLOCK_AHEAD_AT_MS,),
        ),
        (
            "checkpoint RFC3339 creation",
            "UPDATE ge_cycle_checkpoints SET created_at = ?",
            ("2099-01-01T00:00:00Z",),
        ),
        (
            "checkpoint-revision RFC3339 creation",
            "UPDATE ge_cycle_checkpoint_revisions SET checkpoint_created_at = ?",
            ("2099-01-01T00:00:00Z",),
        ),
    )
    try:
        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        for label, statement, parameters in probes:
            connection.execute("BEGIN EXCLUSIVE").close()
            connection.execute(statement, parameters).close()
            summary = capture_sqlite_v1_baseline_source_summary(
                connection,
                captured_at_ms=CLOCK_APPLIED_AT_MS,
            )
            assert summary.clock_evidence == exact, label
            connection.rollback()
    finally:
        connection.close()


def test_persisted_clock_evidence_safe_integer_edges_match_typescript() -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE").close()
        maximum_capture = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=MAX_SAFE_INTEGER,
        )
        assert maximum_capture.clock_evidence == SQLiteV1BaselineClockEvidence(
            captured_at_ms=MAX_SAFE_INTEGER,
            maximum_non_cursor_observed_at_ms=NOW,
            provider_high_water_at_ms=NOW,
        )
        connection.execute(
            "UPDATE ge_cycle_migration_lock SET updated_at_ms = ? WHERE singleton = 1",
            (MAX_SAFE_INTEGER,),
        ).close()
        high_water_edge = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=MAX_SAFE_INTEGER,
        )
        assert high_water_edge.clock_evidence == SQLiteV1BaselineClockEvidence(
            captured_at_ms=MAX_SAFE_INTEGER,
            maximum_non_cursor_observed_at_ms=MAX_SAFE_INTEGER,
            provider_high_water_at_ms=MAX_SAFE_INTEGER,
        )
        connection.rollback()

        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        connection.execute("BEGIN EXCLUSIVE").close()
        connection.execute(
            "UPDATE ge_cycle_schema SET updated_at_ms = ? WHERE singleton = 1",
            (MAX_SAFE_INTEGER + 1,),
        ).close()
        with pytest.raises(ValueError, match="maximum non-cursor observed time"):
            capture_sqlite_v1_baseline_source_summary(
                connection,
                captured_at_ms=MAX_SAFE_INTEGER,
            )
        connection.rollback()

        connection.execute("BEGIN EXCLUSIVE").close()
        connection.execute(
            "UPDATE ge_cycle_migration_lock SET updated_at_ms = -1 WHERE singleton = 1"
        ).close()
        with pytest.raises(ValueError, match="provider clock high-water"):
            capture_sqlite_v1_baseline_source_summary(
                connection,
                captured_at_ms=MAX_SAFE_INTEGER,
            )
        connection.rollback()

        connection.execute("BEGIN EXCLUSIVE").close()
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(
                "UPDATE ge_cycle_schema SET updated_at_ms = 1000.5 WHERE singleton = 1"
            )
        connection.rollback()
    finally:
        connection.close()


@pytest.mark.parametrize(
    "mutation",
    [
        "CREATE TEMP TABLE hostile_stage(value INTEGER)",
        "ANALYZE",
        "ANALYZE ge_cycle_records",
    ],
)
def test_capture_rejects_unexplained_schema_write_after_summary(mutation: str) -> None:
    connection = database()
    try:
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        connection.execute(mutation).close()
        with pytest.raises(ValueError, match="captured transaction changed"):
            tuple(summary.iter_identity_entries())
    finally:
        connection.close()
