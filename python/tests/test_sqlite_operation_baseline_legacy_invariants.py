from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import FrozenInstanceError
from datetime import UTC, datetime
from typing import cast

import pytest

from graph_engineering.canonical import canonical_bytes, canonical_sha256
from graph_engineering.cycle_store_provider import (
    CycleStoreProviderOperation,
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    cycle_store_adapter_codec,
)
from graph_engineering.models import JsonObject
from graph_engineering.sqlite_operation_baseline import BaselineProjectionIdentity
from graph_engineering.sqlite_operation_baseline_checkpoint_invariants import (
    run_sqlite_v1_checkpoint_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_lease_lock_hold_invariants import (
    run_sqlite_v1_lease_lock_hold_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_legacy_invariants import (
    SQLITE_LEGACY_RULES,
    SQLiteLegacyCampaignReport,
    SQLiteLegacyReconciliationDiagnostic,
    SQLiteV1LegacyInvariantCampaign,
    run_sqlite_v1_legacy_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
)
from graph_engineering.sqlite_operation_baseline_stage import SQLiteV1BaselineTempStage
from tests.test_sqlite_operation_baseline_checkpoint_invariants import (
    _cleanup,
    _prepare,
)

Populate = Callable[[SQLiteV1BaselineConnectionOwner], None]
NOW = 1_785_110_405_000
ACQUIRED_AT = "2026-07-27T00:00:05.000Z"
EXPIRES_AT = "2026-07-27T00:00:05.001Z"
CHECKPOINT_CREATED_AT = "2026-07-28T00:00:00.123Z"


def _epoch_ms(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return int(parsed.astimezone(UTC).timestamp() * 1_000)


def _insert_operation(
    connection: SQLiteV1BaselineConnectionOwner,
    operation_id: str,
    operation_name: CycleStoreProviderOperation,
    result: object,
    *,
    request_hash: str | None = None,
    tenant_id: str = "tenant-a",
) -> None:
    encoded = cycle_store_adapter_codec.encode_ledger_result(operation_name, result)
    connection.execute(
        """INSERT INTO ge_cycle_operations
           (tenant_id, operation_id, operation_name, request_hash,
            result_blob, result_hash, committed_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            tenant_id,
            operation_id,
            operation_name,
            hashlib.sha256(f"request:{operation_id}".encode()).hexdigest()
            if request_hash is None
            else request_hash,
            encoded,
            canonical_sha256(result),
            NOW,
        ),
    ).close()


def _populate_shared_legacy_fixture(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    hostile: bool,
) -> None:
    connection.execute(
        """UPDATE ge_cycle_schema
              SET latest_migration_applied_at_ms = ?, created_at_ms = ?, updated_at_ms = ?""",
        (NOW, NOW, NOW),
    ).close()
    connection.execute("UPDATE ge_cycle_migrations SET applied_at_ms = ?", (NOW,)).close()
    connection.execute(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ? WHERE singleton = 1",
        (NOW,),
    ).close()
    record = create_cycle_store_record(
        record_id="record-a",
        sequence=0,
        previous_record_hash=None,
        value=7,
    )
    connection.execute(
        """INSERT INTO ge_cycle_streams
           (tenant_id, stream_id, tail_sequence, tail_record_hash,
            created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)""",
        ("tenant-a", "stream-a", 0, record["recordHash"], NOW, NOW),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_records
           (tenant_id, stream_id, sequence, record_id, previous_record_hash,
            value_hash, value_bytes, value_blob, record_hash, record_blob,
            committed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
    ).close()

    checkpoint = create_cycle_store_checkpoint(
        checkpoint_scope="scope-a",
        checkpoint_id="checkpoint-a",
        stream_id="stream-a",
        bound_sequence=0,
        bound_record_hash=cast(str, record["recordHash"]),
        created_at=CHECKPOINT_CREATED_AT,
        value=9,
    )
    summary: JsonObject = {key: value for key, value in checkpoint.items() if key != "value"}
    summary_blob = cycle_store_adapter_codec.encode_ledger_result("save-checkpoint", summary)
    connection.execute(
        """INSERT INTO ge_cycle_checkpoint_revisions
           (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
            summary_blob, bound_sequence, bound_record_hash,
            checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
           VALUES (?, ?, 1, ?, 'put', ?, ?, ?, ?, ?, ?, ?)""",
        (
            "tenant-a",
            checkpoint["checkpointScope"],
            checkpoint["checkpointId"],
            summary_blob,
            checkpoint["boundSequence"],
            checkpoint["boundRecordHash"],
            checkpoint["createdAt"],
            checkpoint["valueHash"],
            checkpoint["valueBytes"],
            NOW,
        ),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_checkpoints
           (tenant_id, checkpoint_scope, checkpoint_id, stream_id,
            bound_sequence, bound_record_hash, created_at, value_hash,
            value_bytes, value_blob, checkpoint_blob, summary_blob,
            checkpoint_revision, committed_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)""",
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
            NOW,
        ),
    ).close()

    acquired_ms = _epoch_ms(ACQUIRED_AT)
    expires_ms = _epoch_ms(EXPIRES_AT)
    connection.execute(
        """INSERT INTO ge_cycle_leases
           (tenant_id, stream_id, active_lease_id, active_holder_id,
            active_lease_epoch, active_fencing_token, active_acquired_at_ms,
            active_expires_at_ms, last_lease_epoch, last_fencing_token,
            updated_at_ms) VALUES (?, ?, ?, ?, 1, 1, ?, ?, 1, 1, ?)""",
        ("tenant-a", "stream-a", "lease-a", "holder-a", acquired_ms, expires_ms, NOW),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_used_lease_ids
           (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
            first_used_at_ms) VALUES (?, ?, ?, 1, 1, ?)""",
        ("tenant-a", "stream-a", "lease-a", acquired_ms),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_legal_holds
           (tenant_id, stream_id, hold_id, placed_at_ms) VALUES (?, ?, ?, ?)""",
        ("tenant-a", "stream-a", "hold-a", NOW),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_used_migration_lock_ids
           (lock_id, lock_epoch, fencing_token, first_used_at_ms)
           VALUES ('lock-a', 1, 1, ?)""",
        (acquired_ms,),
    ).close()
    connection.execute(
        """UPDATE ge_cycle_migration_lock
              SET active_lock_id = 'lock-a', active_owner_id = 'owner-a',
                  active_source_version = 1, active_target_version = 2,
                  active_lock_epoch = 1, active_fencing_token = 1,
                  active_acquired_at_ms = ?, active_expires_at_ms = ?,
                  last_lock_epoch = 1, last_fencing_token = 1,
                  updated_at_ms = ? WHERE singleton = 1""",
        (acquired_ms, expires_ms, NOW),
    ).close()

    governance = {
        "legalHoldIds": ["hold-a"],
        "retentionMode": "retain-authoritative-history",
        "archiveMode": "lossless-before-delete",
        "compactionMode": "logical-history-preserving",
    }
    lease = {
        "leaseId": "lease-a",
        "holderId": "holder-a",
        "leaseEpoch": 1,
        "fencingToken": 1,
        "acquiredAt": ACQUIRED_AT,
        "expiresAt": EXPIRES_AT,
    }
    lock = {
        "lockId": "lock-a",
        "ownerId": "owner-a",
        "sourceSchemaVersion": 1,
        "targetSchemaVersion": 2,
        "lockEpoch": 1,
        "fencingToken": 1,
        "acquiredAt": ACQUIRED_AT,
        "expiresAt": EXPIRES_AT,
    }
    base_rows: tuple[tuple[str, CycleStoreProviderOperation, object], ...] = (
        ("operation-a", "set-legal-hold", governance),
        (
            "legacy-append",
            "append",
            {
                "tail": {"exists": True, "sequence": 0, "recordHash": record["recordHash"]},
                "appendedRecords": 1,
            },
        ),
        ("legacy-checkpoint-save", "save-checkpoint", summary),
        ("legacy-checkpoint-delete", "delete-checkpoint", {"deleted": False}),
        ("legacy-lease-acquire", "acquire-lease", lease),
        ("legacy-lease-renew", "renew-lease", lease),
        (
            "legacy-lease-release",
            "release-lease",
            {"status": "released", "lease": None, "lastLeaseEpoch": 1, "lastFencingToken": 1},
        ),
        ("legacy-lock-acquire", "acquire-migration-lock", lock),
        ("legacy-lock-release", "release-migration-lock", None),
    )
    for operation_id, operation_name, result in base_rows:
        _insert_operation(
            connection,
            operation_id,
            operation_name,
            result,
            request_hash=(
                hashlib.sha256(b"request-a").hexdigest() if operation_id == "operation-a" else None
            ),
        )

    if hostile:
        hostile_rows: tuple[tuple[str, CycleStoreProviderOperation, object], ...] = (
            (
                "hostile-append-missing",
                "append",
                {
                    "tail": {"exists": True, "sequence": 0, "recordHash": "f" * 64},
                    "appendedRecords": 1,
                },
            ),
            (
                "hostile-append-range",
                "append",
                {
                    "tail": {"exists": True, "sequence": 0, "recordHash": record["recordHash"]},
                    "appendedRecords": 2,
                },
            ),
            (
                "hostile-checkpoint-save",
                "save-checkpoint",
                {
                    "checkpointScope": "scope-a",
                    "checkpointId": "checkpoint-missing",
                    "streamId": "stream-a",
                    "boundSequence": 0,
                    "boundRecordHash": record["recordHash"],
                    "createdAt": CHECKPOINT_CREATED_AT,
                    "valueHash": "e" * 64,
                    "valueBytes": 1,
                },
            ),
            ("hostile-checkpoint-delete", "delete-checkpoint", {"deleted": True}),
            (
                "hostile-lease-acquire",
                "acquire-lease",
                {
                    "leaseId": "lease-missing-a",
                    "holderId": "holder-missing-a",
                    "leaseEpoch": 2,
                    "fencingToken": 2,
                    "acquiredAt": "2026-07-27T00:00:05.010Z",
                    "expiresAt": "2026-07-27T00:00:06.000Z",
                },
            ),
            (
                "hostile-lease-renew",
                "renew-lease",
                {
                    "leaseId": "lease-missing-b",
                    "holderId": "holder-missing-b",
                    "leaseEpoch": 3,
                    "fencingToken": 3,
                    "acquiredAt": "2026-07-27T00:00:05.020Z",
                    "expiresAt": "2026-07-27T00:00:06.000Z",
                },
            ),
            (
                "hostile-lease-release",
                "release-lease",
                {"status": "released", "lease": None, "lastLeaseEpoch": 4, "lastFencingToken": 4},
            ),
            (
                "hostile-lock-acquire",
                "acquire-migration-lock",
                {
                    "lockId": "lock-missing",
                    "ownerId": "owner-missing",
                    "sourceSchemaVersion": 1,
                    "targetSchemaVersion": 2,
                    "lockEpoch": 2,
                    "fencingToken": 2,
                    "acquiredAt": "2026-07-27T00:00:05.030Z",
                    "expiresAt": "2026-07-27T00:00:06.000Z",
                },
            ),
        )
        for operation_id, operation_name, result in hostile_rows:
            _insert_operation(connection, operation_id, operation_name, result)
        connection.execute(
            """UPDATE ge_cycle_migration_lock
                  SET active_lock_id = 'lock-a',
                      active_owner_id = 'owner-physical',
                      active_source_version = 1, active_target_version = 2,
                      active_lock_epoch = 1, active_fencing_token = 1,
                      active_acquired_at_ms = ?, active_expires_at_ms = ?,
                      last_lock_epoch = 1, last_fencing_token = 1,
                      updated_at_ms = ? WHERE singleton = 1""",
            (acquired_ms, expires_ms, NOW),
        ).close()
    connection.commit()


def _prepare_legacy(
    populate: Populate | None = None,
    *,
    require_clean_predecessors: bool = True,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    SQLiteV1BaselineTempStage,
    BaselineProjectionIdentity,
]:
    connection, summary, stage, identity = _prepare(populate, captured_at_ms=NOW)
    checkpoint_report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
    lease_report = run_sqlite_v1_lease_lock_hold_invariant_campaign(summary, identity, stage)
    if require_clean_predecessors:
        assert checkpoint_report.diagnostics == ()
        assert lease_report.diagnostics == ()
    return connection, summary, stage, identity


def _populate_direct_attack(
    connection: SQLiteV1BaselineConnectionOwner,
    attack: str,
) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    record = create_cycle_store_record(
        record_id="record-a", sequence=0, previous_record_hash=None, value=7
    )
    acquired_at = "2026-07-27T00:00:05.010Z"
    expires_at = "2026-07-27T00:00:06.000Z"
    if attack == "append-missing":
        _insert_operation(
            connection,
            "direct-append-missing",
            "append",
            {
                "tail": {"exists": True, "sequence": 0, "recordHash": "f" * 64},
                "appendedRecords": 1,
            },
        )
    elif attack == "append-range":
        _insert_operation(
            connection,
            "direct-append-range",
            "append",
            {
                "tail": {
                    "exists": True,
                    "sequence": 0,
                    "recordHash": record["recordHash"],
                },
                "appendedRecords": 2,
            },
        )
    elif attack == "checkpoint-save":
        _insert_operation(
            connection,
            "direct-save-missing",
            "save-checkpoint",
            {
                "checkpointScope": "scope-a",
                "checkpointId": "checkpoint-missing",
                "streamId": "stream-a",
                "boundSequence": 0,
                "boundRecordHash": record["recordHash"],
                "createdAt": CHECKPOINT_CREATED_AT,
                "valueHash": "e" * 64,
                "valueBytes": 1,
            },
        )
    elif attack == "checkpoint-delete":
        _insert_operation(
            connection,
            "direct-delete-missing",
            "delete-checkpoint",
            {"deleted": True},
        )
    elif attack in ("lease-acquire", "lease-renew"):
        operation: CycleStoreProviderOperation = (
            "acquire-lease" if attack == "lease-acquire" else "renew-lease"
        )
        _insert_operation(
            connection,
            f"direct-{attack}",
            operation,
            {
                "leaseId": f"missing-{attack}",
                "holderId": "holder-missing",
                "leaseEpoch": 2,
                "fencingToken": 2,
                "acquiredAt": acquired_at,
                "expiresAt": expires_at,
            },
        )
    elif attack == "lease-release":
        _insert_operation(
            connection,
            "direct-release-missing",
            "release-lease",
            {
                "status": "released",
                "lease": None,
                "lastLeaseEpoch": 2,
                "lastFencingToken": 2,
            },
        )
    elif attack == "lock-missing":
        _insert_operation(
            connection,
            "direct-lock-missing",
            "acquire-migration-lock",
            {
                "lockId": "lock-missing",
                "ownerId": "owner-missing",
                "sourceSchemaVersion": 1,
                "targetSchemaVersion": 2,
                "lockEpoch": 2,
                "fencingToken": 2,
                "acquiredAt": acquired_at,
                "expiresAt": expires_at,
            },
        )
    elif attack == "lock-active-drift":
        connection.execute(
            "UPDATE ge_cycle_migration_lock SET active_owner_id = 'owner-physical'"
        ).close()
    else:
        raise AssertionError(f"unknown direct attack: {attack}")
    connection.commit()


def _raw_sql_count(
    connection: SQLiteV1BaselineConnectionOwner,
    sql: str,
    limit: int = 16,
) -> int:
    cursor = connection.execute(sql, (limit + 1,))
    observed = 0
    try:
        while cursor.fetchone() is not None:
            observed += 1
    finally:
        cursor.close()
    return observed


def _raw_inventory_count(
    connection: SQLiteV1BaselineConnectionOwner,
    limit: int = 16,
) -> int:
    return _raw_sql_count(connection, SQLITE_LEGACY_RULES[0].sql, limit)


def _insert_followup_record(
    connection: SQLiteV1BaselineConnectionOwner,
    *,
    tenant_id: str,
    stream_id: str,
    record_id: str,
    previous_hash: str | None,
    sequence: int,
) -> JsonObject:
    record = create_cycle_store_record(
        record_id=record_id,
        sequence=sequence,
        previous_record_hash=previous_hash,
        value=8,
    )
    if sequence == 0:
        connection.execute(
            """INSERT INTO ge_cycle_streams
               (tenant_id, stream_id, tail_sequence, tail_record_hash,
                created_at_ms, updated_at_ms) VALUES (?, ?, 0, ?, ?, ?)""",
            (tenant_id, stream_id, record["recordHash"], NOW, NOW),
        ).close()
    connection.execute(
        """INSERT INTO ge_cycle_records
           (tenant_id, stream_id, sequence, record_id, previous_record_hash,
            value_hash, value_bytes, value_blob, record_hash, record_blob,
            committed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tenant_id,
            stream_id,
            sequence,
            record_id,
            previous_hash,
            record["valueHash"],
            record["valueBytes"],
            canonical_bytes(record["value"]),
            record["recordHash"],
            canonical_bytes(record),
            NOW,
        ),
    ).close()
    if sequence > 0:
        connection.execute(
            """UPDATE ge_cycle_streams SET tail_sequence = ?, tail_record_hash = ?
                WHERE tenant_id = ? AND stream_id = ?""",
            (sequence, record["recordHash"], tenant_id, stream_id),
        ).close()
    return record


def _populate_safe_evolution(
    connection: SQLiteV1BaselineConnectionOwner,
    evolution: str,
) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    acquired_ms = _epoch_ms(ACQUIRED_AT)
    if evolution == "append-later-head":
        row = connection.execute(
            """SELECT record_hash FROM ge_cycle_records
                WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a' AND sequence = 0"""
        )
        try:
            previous = row.fetchone()
        finally:
            row.close()
        assert previous is not None
        _insert_followup_record(
            connection,
            tenant_id="tenant-a",
            stream_id="stream-a",
            record_id="record-a-1",
            previous_hash=cast(str, previous[0]),
            sequence=1,
        )
    elif evolution == "checkpoint-delete-recreate":
        connection.execute(
            """INSERT INTO ge_cycle_checkpoint_revisions
               (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
                summary_blob, bound_sequence, bound_record_hash,
                checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
               VALUES ('tenant-a', 'scope-a', 2, 'checkpoint-a', 'delete',
                       NULL, NULL, NULL, NULL, NULL, NULL, ?)""",
            (NOW,),
        ).close()
        connection.execute(
            """INSERT INTO ge_cycle_checkpoint_revisions
               SELECT tenant_id, checkpoint_scope, 3, checkpoint_id, action,
                      summary_blob, bound_sequence, bound_record_hash,
                      checkpoint_created_at, value_hash, value_bytes, recorded_at_ms
                 FROM ge_cycle_checkpoint_revisions
                WHERE tenant_id = 'tenant-a' AND checkpoint_scope = 'scope-a'
                  AND revision = 1"""
        ).close()
        connection.execute(
            """UPDATE ge_cycle_checkpoints SET checkpoint_revision = 3
                WHERE tenant_id = 'tenant-a' AND checkpoint_scope = 'scope-a'
                  AND checkpoint_id = 'checkpoint-a'"""
        ).close()
    elif evolution == "lease-later-acquisition":
        connection.execute(
            """INSERT INTO ge_cycle_used_lease_ids
               (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
                first_used_at_ms) VALUES ('tenant-a', 'stream-a', 'lease-later', 2, 2, ?)""",
            (NOW,),
        ).close()
        connection.execute(
            """UPDATE ge_cycle_leases
                  SET active_lease_id = 'lease-later', active_holder_id = 'holder-later',
                      active_lease_epoch = 2, active_fencing_token = 2,
                      active_acquired_at_ms = ?, active_expires_at_ms = ?,
                      last_lease_epoch = 2, last_fencing_token = 2, updated_at_ms = ?
                WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'""",
            (NOW, NOW + 2_000, NOW),
        ).close()
    elif evolution == "lease-same-tenant-ambiguous":
        _insert_followup_record(
            connection,
            tenant_id="tenant-a",
            stream_id="stream-b",
            record_id="record-b-0",
            previous_hash=None,
            sequence=0,
        )
        connection.execute(
            """INSERT INTO ge_cycle_leases
               (tenant_id, stream_id, active_lease_id, active_holder_id,
                active_lease_epoch, active_fencing_token, active_acquired_at_ms,
                active_expires_at_ms, last_lease_epoch, last_fencing_token, updated_at_ms)
               VALUES ('tenant-a', 'stream-b', 'lease-a', 'holder-other', 1, 1,
                       ?, ?, 1, 1, ?)""",
            (acquired_ms, acquired_ms + 5_000, NOW),
        ).close()
        connection.execute(
            """INSERT INTO ge_cycle_used_lease_ids
               (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
                first_used_at_ms) VALUES ('tenant-a', 'stream-b', 'lease-a', 1, 1, ?)""",
            (acquired_ms,),
        ).close()
    elif evolution == "lease-current-nonbinding":
        connection.execute(
            """UPDATE ge_cycle_leases
                  SET active_holder_id = 'holder-renewed', active_expires_at_ms = ?
                WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'""",
            (acquired_ms + 5_000,),
        ).close()
    elif evolution == "lock-later-acquisition":
        connection.execute(
            """INSERT INTO ge_cycle_used_migration_lock_ids
               (lock_id, lock_epoch, fencing_token, first_used_at_ms)
               VALUES ('lock-later', 2, 2, ?)""",
            (NOW,),
        ).close()
        connection.execute(
            """UPDATE ge_cycle_migration_lock
                  SET active_lock_id = 'lock-later', active_owner_id = 'owner-later',
                      active_source_version = 2, active_target_version = 3,
                      active_lock_epoch = 2, active_fencing_token = 2,
                      active_acquired_at_ms = ?, active_expires_at_ms = ?,
                      last_lock_epoch = 2, last_fencing_token = 2, updated_at_ms = ?
                WHERE singleton = 1""",
            (NOW, NOW + 2_000, NOW),
        ).close()
    else:
        raise AssertionError(f"unknown safe evolution: {evolution}")
    connection.commit()


def _populate_with_prebuilt_operation_shadow(
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    catalog = connection.execute(
        """SELECT sql FROM main.sqlite_schema
            WHERE type = 'table' AND name = 'ge_cycle_operations'"""
    )
    try:
        row = catalog.fetchone()
    finally:
        catalog.close()
    assert row is not None and type(row[0]) is str
    shadow_sql = row[0].replace(
        "CREATE TABLE ge_cycle_operations",
        "CREATE TABLE ge_cycle_operations_shadow",
        1,
    )
    connection.execute(shadow_sql).close()
    connection.execute(
        """INSERT INTO ge_cycle_operations_shadow
           SELECT tenant_id, operation_id, operation_name, request_hash,
                  x'7b7d', result_hash, committed_at_ms
             FROM ge_cycle_operations"""
    ).close()
    connection.commit()


def _populate_cross_tenant_aliases(connection: SQLiteV1BaselineConnectionOwner) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    record = create_cycle_store_record(
        record_id="record-a", sequence=0, previous_record_hash=None, value=7
    )
    checkpoint = create_cycle_store_checkpoint(
        checkpoint_scope="scope-a",
        checkpoint_id="checkpoint-a",
        stream_id="stream-a",
        bound_sequence=0,
        bound_record_hash=cast(str, record["recordHash"]),
        created_at=CHECKPOINT_CREATED_AT,
        value=9,
    )
    checkpoint_summary = {key: value for key, value in checkpoint.items() if key != "value"}
    lease = {
        "leaseId": "lease-a",
        "holderId": "holder-a",
        "leaseEpoch": 1,
        "fencingToken": 1,
        "acquiredAt": ACQUIRED_AT,
        "expiresAt": EXPIRES_AT,
    }
    _insert_operation(
        connection,
        "cross-append",
        "append",
        {
            "tail": {
                "exists": True,
                "sequence": 0,
                "recordHash": record["recordHash"],
            },
            "appendedRecords": 1,
        },
        tenant_id="tenant-b",
    )
    _insert_operation(
        connection,
        "cross-save",
        "save-checkpoint",
        checkpoint_summary,
        tenant_id="tenant-b",
    )
    _insert_operation(
        connection,
        "cross-lease",
        "acquire-lease",
        lease,
        tenant_id="tenant-b",
    )
    connection.commit()


def _populate_delete_true_with_any_tenant_revision(
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    connection.execute(
        """INSERT INTO ge_cycle_checkpoint_revisions
           (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
            summary_blob, bound_sequence, bound_record_hash,
            checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
           VALUES ('tenant-a', 'scope-deleted', 1, 'checkpoint-deleted', 'delete',
                   NULL, NULL, NULL, NULL, NULL, NULL, ?)""",
        (NOW,),
    ).close()
    _insert_operation(
        connection,
        "delete-true-any",
        "delete-checkpoint",
        {"deleted": True},
    )
    connection.commit()


def _populate_release_split_domain(connection: SQLiteV1BaselineConnectionOwner) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    _insert_followup_record(
        connection,
        tenant_id="tenant-a",
        stream_id="stream-b",
        record_id="record-b-release",
        previous_hash=None,
        sequence=0,
    )
    connection.execute(
        """INSERT INTO ge_cycle_used_lease_ids
           (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
            first_used_at_ms) VALUES ('tenant-a', 'stream-a', 'lease-exact-2', 2, 2, ?)""",
        (NOW,),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_leases
           (tenant_id, stream_id, active_lease_id, active_holder_id,
            active_lease_epoch, active_fencing_token, active_acquired_at_ms,
            active_expires_at_ms, last_lease_epoch, last_fencing_token, updated_at_ms)
           VALUES ('tenant-a', 'stream-b', NULL, NULL, NULL, NULL, NULL, NULL,
                   2, 2, ?)""",
        (NOW,),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_used_lease_ids
           (tenant_id, stream_id, lease_id, lease_epoch, fencing_token,
            first_used_at_ms) VALUES ('tenant-a', 'stream-b', 'lease-only-1', 1, 1, ?)""",
        (NOW,),
    ).close()
    _insert_operation(
        connection,
        "release-split-domain",
        "release-lease",
        {
            "status": "released",
            "lease": None,
            "lastLeaseEpoch": 2,
            "lastFencingToken": 2,
        },
    )
    connection.commit()


def _populate_active_lock_drift(
    connection: SQLiteV1BaselineConnectionOwner,
    field: str,
) -> None:
    _populate_shared_legacy_fixture(connection, hostile=False)
    mutations: dict[str, tuple[str, tuple[object, ...]]] = {
        "owner": ("active_owner_id = 'owner-drift'", ()),
        "source": ("active_source_version = 2, active_target_version = 3", ()),
        "target": ("active_target_version = 3", ()),
        "epoch-fence": (
            "active_lock_epoch = 2, active_fencing_token = 2, "
            "last_lock_epoch = 2, last_fencing_token = 2",
            (),
        ),
        "acquired": ("active_acquired_at_ms = ?", (NOW - 1,)),
        "expiry": ("active_expires_at_ms = ?", (NOW + 2,)),
    }
    clause, parameters = mutations[field]
    connection.execute(
        f"UPDATE ge_cycle_migration_lock SET {clause} WHERE singleton = 1",
        parameters,
    ).close()
    connection.commit()


def test_shared_all_nine_pristine_fixture_is_exact_and_empty() -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=False)
    )
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert report == SQLiteLegacyCampaignReport(identity, ())
        assert report.projection_identity is identity
        assert identity == BaselineProjectionIdentity(
            baseline_id="v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af",
            entry_count=20,
            legacy_operation_count=9,
            first_entry_hash="f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c",
            final_entry_hash="7438000be18c081b0fd1eff96b3f4c9736dca1b6873285de6f2140d1f2e3bf46",
            projection_sha256="459ecad40c2ed54c59c38bb3fecbabfc71694bdf4f59f1eebbdae749fbb9dd62",
        )
        assert stage._legacy_campaign_completed
        with pytest.raises(FrozenInstanceError):
            report.diagnostics = ()  # type: ignore[misc]
    finally:
        _cleanup(connection, stage)


def test_shared_hostile_fixture_has_exact_five_rule_vector() -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=True)
    )
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert identity == BaselineProjectionIdentity(
            baseline_id="v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af",
            entry_count=28,
            legacy_operation_count=17,
            first_entry_hash="f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c",
            final_entry_hash="85cc900b39b8631815f5631aa13711a9ef152f88e91793bb771f0be85b1a55e2",
            projection_sha256="a23da0ae704c5d1414fd55950ff1f306eeffb8d5408340dbe713e2fa02b72647",
        )
        assert report.diagnostics == (
            SQLiteLegacyReconciliationDiagnostic("BLR_LEGACY_APPEND_BINDING", 2, False),
            SQLiteLegacyReconciliationDiagnostic("BLR_LEGACY_CHECKPOINT_BINDING", 2, False),
            SQLiteLegacyReconciliationDiagnostic("BLR_LEGACY_LEASE_BINDING", 3, False),
            SQLiteLegacyReconciliationDiagnostic("BLR_LEGACY_LOCK_BINDING", 2, False),
        )
        diagnostic_by_rule = {item.rule_id: item.violation_count for item in report.diagnostics}
        assert tuple(diagnostic_by_rule.get(rule.rule_id, 0) for rule in SQLITE_LEGACY_RULES) == (
            0,
            2,
            2,
            3,
            2,
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("attack", "rule_id"),
    [
        ("append-missing", "BLR_LEGACY_APPEND_BINDING"),
        ("append-range", "BLR_LEGACY_APPEND_BINDING"),
        ("checkpoint-save", "BLR_LEGACY_CHECKPOINT_BINDING"),
        ("checkpoint-delete", "BLR_LEGACY_CHECKPOINT_BINDING"),
        ("lease-acquire", "BLR_LEGACY_LEASE_BINDING"),
        ("lease-renew", "BLR_LEGACY_LEASE_BINDING"),
        ("lease-release", "BLR_LEGACY_LEASE_BINDING"),
        ("lock-missing", "BLR_LEGACY_LOCK_BINDING"),
        ("lock-active-drift", "BLR_LEGACY_LOCK_BINDING"),
    ],
)
def test_each_recoverable_binding_attack_is_one_direct_diagnostic(
    attack: str,
    rule_id: str,
) -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_direct_attack(owner, attack)
    )
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert [(item.rule_id, item.violation_count) for item in report.diagnostics] == [
            (rule_id, 1)
        ]
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("orphan_shape", "expected"),
    [
        ("relation-led", 1),
        ("common-only", 1),
        ("main-only", 1),
    ],
)
def test_inventory_three_branches_emit_one_unit_per_operation(
    orphan_shape: str,
    expected: int,
) -> None:
    connection, _summary, stage, _identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=False)
    )
    try:
        if orphan_shape == "relation-led":
            connection.execute(
                """UPDATE temp.ge_blr_legacy_operations
                      SET operation_name = 'release-migration-lock'
                    WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'"""
            ).close()
        elif orphan_shape == "common-only":
            connection.execute(
                """DELETE FROM temp.ge_blr_legacy_operations
                    WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'"""
            ).close()
        else:
            key_row = connection.execute(
                """SELECT key_blob FROM temp.ge_blr_legacy_operations
                    WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'"""
            )
            try:
                key = key_row.fetchone()
            finally:
                key_row.close()
            assert key is not None
            connection.execute(
                "DELETE FROM temp.ge_blr_legacy_operations WHERE key_blob = ?", (key[0],)
            ).close()
            connection.execute(
                "DELETE FROM temp.ge_blr_stage WHERE kind_rank = 11 AND key_blob = ?",
                (key[0],),
            ).close()
        assert _raw_inventory_count(connection) == expected
    finally:
        _cleanup(connection, stage)


def test_inventory_relation_and_common_orphans_dedupe_same_operation() -> None:
    connection, _summary, stage, _identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=False)
    )
    try:
        cursor = connection.execute(
            """SELECT key_blob FROM temp.ge_blr_legacy_operations
                 WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'"""
        )
        try:
            key = cursor.fetchone()
        finally:
            cursor.close()
        assert key is not None
        connection.execute(
            """UPDATE temp.ge_blr_legacy_operations
                  SET key_blob = CAST(json_set(CAST(key_blob AS TEXT),
                      '$.operationId', 'operation-substituted') AS BLOB)
                WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'"""
        ).close()
        substituted_cursor = connection.execute(
            """SELECT key_blob FROM temp.ge_blr_legacy_operations
                 WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'"""
        )
        try:
            substituted = substituted_cursor.fetchone()
        finally:
            substituted_cursor.close()
        assert substituted is not None and substituted[0] != key[0]
        assert _raw_inventory_count(connection) == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "evolution",
    [
        "append-later-head",
        "checkpoint-delete-recreate",
        "lease-later-acquisition",
        "lease-same-tenant-ambiguous",
        "lease-current-nonbinding",
        "lock-later-acquisition",
    ],
)
def test_recoverability_does_not_strengthen_safe_historical_facts(
    evolution: str,
) -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_safe_evolution(owner, evolution)
    )
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == ()
    finally:
        _cleanup(connection, stage)


def test_append_checkpoint_and_lease_cross_tenant_aliases_never_substitute() -> None:
    connection, summary, stage, identity = _prepare_legacy(_populate_cross_tenant_aliases)
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert [(item.rule_id, item.violation_count) for item in report.diagnostics] == [
            ("BLR_LEGACY_APPEND_BINDING", 1),
            ("BLR_LEGACY_CHECKPOINT_BINDING", 1),
            ("BLR_LEGACY_LEASE_BINDING", 1),
        ]
    finally:
        _cleanup(connection, stage)


def test_delete_true_accepts_any_same_tenant_delete_revision() -> None:
    connection, summary, stage, identity = _prepare_legacy(
        _populate_delete_true_with_any_tenant_revision
    )
    try:
        assert run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage).diagnostics == ()
    finally:
        _cleanup(connection, stage)


def test_release_used_pair_and_highwater_must_share_one_domain() -> None:
    connection, summary, stage, identity = _prepare_legacy(
        _populate_release_split_domain,
        require_clean_predecessors=False,
    )
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteLegacyReconciliationDiagnostic("BLR_LEGACY_LEASE_BINDING", 1, False),
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "field", ["owner", "source", "target", "epoch-fence", "acquired", "expiry"]
)
def test_active_lock_each_recoverable_field_is_bound(field: str) -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_active_lock_drift(owner, field),
        require_clean_predecessors=False,
    )
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteLegacyReconciliationDiagnostic("BLR_LEGACY_LOCK_BINDING", 1, False),
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("tenant_id", "tenant-drift"),
        ("operation_id", "operation-drift"),
        ("request_hash", "d" * 64),
        ("result_hash", "e" * 64),
        ("result_blob_sha256", "f" * 64),
        ("operation_name", "release-migration-lock"),
        ("committed_at_ms", NOW - 1),
    ],
)
def test_inventory_raw_scalar_drift_is_one_unit(column: str, value: object) -> None:
    connection, _summary, stage, _identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=False)
    )
    try:
        connection.execute(
            f"""UPDATE temp.ge_blr_legacy_operations SET {column} = ?
                 WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'""",
            (value,),
        ).close()
        assert _raw_inventory_count(connection) == 1
    finally:
        _cleanup(connection, stage)


def test_one_corrupt_operation_can_cross_rules_but_only_once_per_rule() -> None:
    connection, _summary, stage, _identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=False)
    )
    try:
        connection.execute(
            """UPDATE temp.ge_blr_legacy_operations
                  SET request_hash = ?, tail_record_hash = ?
                WHERE tenant_id = 'tenant-a' AND operation_id = 'legacy-append'""",
            ("d" * 64, "f" * 64),
        ).close()
        counts = tuple(_raw_sql_count(connection, rule.sql) for rule in SQLITE_LEGACY_RULES)
        assert counts == (1, 1, 0, 0, 0)
    finally:
        _cleanup(connection, stage)


def test_registry_is_closed_ordered_marker_only_and_never_reads_result_blob() -> None:
    assert tuple(rule.rule_id for rule in SQLITE_LEGACY_RULES) == (
        "BLR_LEGACY_INVENTORY",
        "BLR_LEGACY_APPEND_BINDING",
        "BLR_LEGACY_CHECKPOINT_BINDING",
        "BLR_LEGACY_LEASE_BINDING",
        "BLR_LEGACY_LOCK_BINDING",
    )
    for rule in SQLITE_LEGACY_RULES:
        assert "LIMIT ?" in rule.sql
        assert "SELECT 1" in rule.sql
        assert re.search(r"\b(?:source\.)?result_blob\b", rule.sql, re.I) is None
        assert "SELECT *" not in rule.sql.upper()
        with pytest.raises(FrozenInstanceError):
            rule.sql = "SELECT 2"  # type: ignore[misc]
    assert [
        hashlib.sha256(re.sub(r"\s+", " ", rule.sql).strip().encode()).hexdigest()
        for rule in SQLITE_LEGACY_RULES
    ] == [
        "47955bd3ba75cbfd515d95cff82dd28213d956818e06a597e07a7376a7874f46",
        "c18ddc48822f41fa3e6dcafcbdfbb26aed83f9ebcb135c959d5bf32fd0c3b055",
        "46a86173db67c4a6e573d68c5bfdf4a8b886862f16857a1c538cbe953ab1ca4d",
        "619daa1f02963c6a4ef58331db5157ed2f8a95aa0f99cc3add27e2063f541212",
        "14ac5f2c3bf01c7b3ac6744b209bded53e7e3001ab94084431a1b92f0f782247",
    ]


def test_every_named_index_and_query_plan_is_fixed_without_automatic_index() -> None:
    connection, _summary, stage, _identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=False)
    )
    try:
        for rule in SQLITE_LEGACY_RULES:
            cursor = connection.execute("EXPLAIN QUERY PLAN " + rule.sql, (17,))
            details: list[str] = []
            try:
                while True:
                    row = cursor.fetchone()
                    if row is None:
                        break
                    details.append(str(row[3]))
            finally:
                cursor.close()
            joined = "\n".join(details)
            assert "AUTOMATIC" not in joined.upper()
            assert "MATERIALIZE" not in joined.upper()
            assert "TEMP B-TREE" not in joined.upper()
            for index_name in rule.required_indexes:
                assert index_name in joined
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("diagnostic_limit", [1, 16, 64])
def test_closed_diagnostic_limits_complete(diagnostic_limit: int) -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=True)
    )
    try:
        report = run_sqlite_v1_legacy_invariant_campaign(
            summary, identity, stage, diagnostic_limit=diagnostic_limit
        )
        assert report.projection_identity is identity
        if diagnostic_limit == 1:
            assert report.diagnostics[0] == SQLiteLegacyReconciliationDiagnostic(
                "BLR_LEGACY_APPEND_BINDING", 1, True
            )
    finally:
        _cleanup(connection, stage)


def test_main_catalog_swap_before_campaign_is_fail_closed_without_blob_read() -> None:
    connection, summary, stage, identity = _prepare_legacy(_populate_with_prebuilt_operation_shadow)
    try:
        before_swap_changes = connection.total_changes
        connection.execute(
            "ALTER TABLE ge_cycle_operations RENAME TO ge_cycle_operations_parked"
        ).close()
        connection.execute(
            "ALTER TABLE ge_cycle_operations_shadow RENAME TO ge_cycle_operations"
        ).close()
        assert connection.total_changes == before_swap_changes
        with pytest.raises(ValueError, match="BLR_LEGACY_INVENTORY"):
            SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_equal_count_main_operation_mutation_after_capture_is_fail_closed() -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=False)
    )
    try:
        connection.execute(
            """UPDATE main.ge_cycle_operations SET result_hash = ?
                WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'""",
            ("d" * 64,),
        ).close()
        with pytest.raises(ValueError, match="BLR_UNEXPLAINED_WRITE"):
            SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_equal_count_temp_mutation_fails_at_legacy_begin() -> None:
    connection, summary, stage, identity = _prepare_legacy(
        lambda owner: _populate_shared_legacy_fixture(owner, hostile=False)
    )
    try:
        connection.execute(
            """UPDATE temp.ge_blr_legacy_operations SET request_hash = request_hash
                WHERE tenant_id = 'tenant-a' AND operation_id = 'operation-a'"""
        ).close()
        with pytest.raises(ValueError, match="BLR_UNEXPLAINED_WRITE"):
            SQLiteV1LegacyInvariantCampaign(summary, identity, stage)
        assert not stage._legacy_campaign_completed
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)
