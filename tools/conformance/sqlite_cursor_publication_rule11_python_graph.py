"""Independent real-SQLite graph builder for the Rule 11 parity reporter."""

from __future__ import annotations

import hashlib
import sqlite3
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import graph_engineering.sqlite_cursor_publication_outer_authority as outer
from graph_engineering.canonical import canonical_bytes
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    _create_migration_lock_capability_intrinsic,
    _create_provider_clock_capability_intrinsic,
    _create_provider_clock_source_intrinsic,
    _MigrationLockIdentity,
    _observe_provider_clock_intrinsic,
)
from graph_engineering.sqlite_cycle_store import (
    _REQUIRED_MIGRATION_POSTCONDITIONS,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
    _load_migration_assets,
)
from graph_engineering.sqlite_operation_baseline_checkpoint_invariants import (
    run_sqlite_v1_checkpoint_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_cooperation import (
    _stream_sqlite_v1_baseline_source_into_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_cursor_campaign import (
    SQLiteCursorPreRebindComplete,
    _run_sqlite_cursor_pre_rebind_campaign,
)
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_PHYSICAL_FIELDS,
    seal_sqlite_v1_cursor_rows,
)
from graph_engineering.sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorPreRebindReceiptCandidate,
    SQLiteCursorPreRebindReceiptIssuer,
    create_sqlite_cursor_capture_session,
    create_sqlite_cursor_exact_projection_reference,
    create_sqlite_cursor_ownership_capability,
)
from graph_engineering.sqlite_operation_baseline_cursor_stage_ownership import (
    _begin_sqlite_cursor_stage_ownership_transfer,
    _create_sqlite_cursor_seal_temp_table,
)
from graph_engineering.sqlite_operation_baseline_handoff import (
    _project_ordered_sqlite_v1_baseline_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_lease_lock_hold_invariants import (
    run_sqlite_v1_lease_lock_hold_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_legacy_invariants import (
    run_sqlite_v1_legacy_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    capture_sqlite_v1_baseline_source_summary,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    configure_sqlite_v1_baseline_temp_storage,
    create_sqlite_v1_baseline_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_stream_record_invariants import (
    run_sqlite_v1_stream_record_invariant_campaign,
)

ROOT = Path(__file__).resolve().parents[2]
RULE11_PARITY_CAPTURED_AT_MS = 1_785_110_405_000
_ASSETS = _load_migration_assets()


def _invariant(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _database() -> SQLiteV1BaselineConnectionOwner:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    schema = (
        ROOT / "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql"
    ).read_text(encoding="utf-8")
    connection.executescript(schema)
    connection.execute(
        "INSERT INTO ge_cycle_schema VALUES (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)",
        (
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            _ASSETS.schema_sql_hash,
            RULE11_PARITY_CAPTURED_AT_MS,
            SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
            RULE11_PARITY_CAPTURED_AT_MS,
            RULE11_PARITY_CAPTURED_AT_MS,
        ),
    ).close()
    connection.execute(
        "INSERT INTO ge_cycle_migrations VALUES "
        "(1, 0, 'fresh-v1-baseline', ?, ?, ?, "
        "'rebuild-from-verified-backup-only', ?)",
        (
            _ASSETS.schema_sql_hash,
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            RULE11_PARITY_CAPTURED_AT_MS,
            canonical_bytes(
                {"requiredPostconditions": list(_REQUIRED_MIGRATION_POSTCONDITIONS)}
            ),
        ),
    ).close()
    connection.execute(
        "INSERT INTO ge_cycle_migration_lock VALUES "
        "(1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)",
        (RULE11_PARITY_CAPTURED_AT_MS,),
    ).close()
    connection.commit()
    return connection


def _install_lock(connection: SQLiteV1BaselineConnectionOwner) -> _MigrationLockIdentity:
    lock = _MigrationLockIdentity(
        "rule11-parity-lock",
        "rule11-parity-owner",
        1,
        2,
        1,
        1,
        RULE11_PARITY_CAPTURED_AT_MS + 100_000,
    )
    connection.execute(
        "INSERT INTO ge_cycle_used_migration_lock_ids "
        "(lock_id, lock_epoch, fencing_token, first_used_at_ms) VALUES (?, ?, ?, ?)",
        (
            lock.lock_id,
            lock.lock_epoch,
            lock.fencing_token,
            RULE11_PARITY_CAPTURED_AT_MS,
        ),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migration_lock SET active_lock_id = ?, active_owner_id = ?, "
        "active_source_version = ?, active_target_version = ?, active_lock_epoch = ?, "
        "active_fencing_token = ?, active_acquired_at_ms = ?, active_expires_at_ms = ?, "
        "last_lock_epoch = ?, last_fencing_token = ?, updated_at_ms = ? WHERE singleton = 1",
        (
            lock.lock_id,
            lock.owner_id,
            lock.source_schema_version,
            lock.target_schema_version,
            lock.lock_epoch,
            lock.fencing_token,
            RULE11_PARITY_CAPTURED_AT_MS,
            lock.active_expires_at_ms,
            lock.lock_epoch,
            lock.fencing_token,
            RULE11_PARITY_CAPTURED_AT_MS,
        ),
    ).close()
    return lock


def _insert_control_operation(connection: SQLiteV1BaselineConnectionOwner) -> None:
    result = canonical_bytes(
        {
            "archiveMode": "lossless-before-delete",
            "compactionMode": "logical-history-preserving",
            "legalHoldIds": [],
            "retentionMode": "retain-authoritative-history",
        }
    )
    connection.execute(
        "INSERT INTO ge_cycle_operations "
        "(tenant_id, operation_id, operation_name, request_hash, result_blob, "
        "result_hash, committed_at_ms) VALUES (?, ?, 'set-legal-hold', ?, ?, ?, ?)",
        (
            "tenant-rule11",
            "operation-rule11",
            f"{1:064d}",
            result,
            hashlib.sha256(result).hexdigest(),
            RULE11_PARITY_CAPTURED_AT_MS - 10,
        ),
    ).close()


def _insert_cursor_rows(
    connection: SQLiteV1BaselineConnectionOwner, cursor_count: int
) -> None:
    _invariant(
        type(cursor_count) is int and cursor_count in (0, 1, 3),
        "Python Rule11 parity cursor population is invalid",
    )
    identity_cursor = connection.execute(
        "SELECT provider_descriptor_hash, schema_identity_sha256 "
        "FROM ge_cycle_schema WHERE singleton = 1"
    )
    try:
        identity = identity_cursor.fetchone()
        _invariant(
            identity is not None and identity_cursor.fetchone() is None,
            "Python Rule11 parity schema identity is invalid",
        )
    finally:
        identity_cursor.close()
    descriptor_hash, schema_identity = cast(tuple[str, str], identity)
    for ordinal in range(1, cursor_count + 1):
        stream_id = f"stream-rule11-{ordinal}"
        connection.execute(
            "INSERT INTO ge_cycle_cursors VALUES "
            "(?, ?, 'event', ?, ?, ?, NULL, ?, 1, 0, -1, NULL, ?, ?, ?, ?, ?, NULL)",
            (
                f"tenant-rule11-{ordinal}",
                f"{ordinal:064x}",
                "b" * 64,
                "c" * 64,
                stream_id,
                canonical_bytes(
                    {
                        "contractVersion": "cycle-store-provider/v1alpha1",
                        "pageSize": 1,
                        "streamId": stream_id,
                    }
                ),
                descriptor_hash,
                schema_identity,
                canonical_bytes(
                    {"exists": False, "recordHash": None, "sequence": -1}
                ),
                RULE11_PARITY_CAPTURED_AT_MS - 100,
                RULE11_PARITY_CAPTURED_AT_MS + 100,
            ),
        ).close()


def _mint_receipt(
    connection: SQLiteV1BaselineConnectionOwner,
    summary: Any,
    projection: Any,
    cursor_count: int,
) -> tuple[object, object]:
    cursor = connection.execute(
        "SELECT " + ", ".join(SQLITE_CURSOR_PHYSICAL_FIELDS)
        + " FROM main.ge_cycle_cursors "
        "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY"
    )
    try:
        collected: list[tuple[object, ...]] = []
        while batch := cursor.fetchmany(64):
            collected.extend(batch)
        rows = tuple(collected)
    finally:
        cursor.close()
    envelope = summary.source_envelope
    seal = seal_sqlite_v1_cursor_rows(
        rows,
        expected_count=cursor_count,
        source_descriptor_hash=str(envelope["sourceDescriptorHash"]),
        source_schema_identity_sha256=str(envelope["sourceSchemaIdentitySha256"]),
    )
    projection_reference = create_sqlite_cursor_exact_projection_reference(projection)
    tenant = create_sqlite_cursor_ownership_capability("tenant", bytes(32))
    source_stage = create_sqlite_cursor_ownership_capability(
        "source-stage", bytes([17]) * 32
    )
    campaign = create_sqlite_cursor_ownership_capability("campaign", bytes([34]) * 32)
    connection_capability = create_sqlite_cursor_ownership_capability(
        "connection", bytes([51]) * 32
    )
    session = create_sqlite_cursor_capture_session(
        tenant_ownership=tenant,
        source_stage_ownership=source_stage,
        campaign_ownership=campaign,
        connection_ownership=connection_capability,
        nonce=bytes([68]) * 32,
    )
    candidate = SQLiteCursorPreRebindReceiptCandidate(
        summary,
        summary.clock_evidence,
        seal,
        projection,
        projection_reference,
        session,
        tenant,
        source_stage,
        campaign,
        connection_capability,
    )
    receipt = SQLiteCursorPreRebindReceiptIssuer(candidate).issue(candidate)
    return receipt, projection_reference


@dataclass(slots=True)
class Rule11PythonGraph:
    connection: SQLiteV1BaselineConnectionOwner
    stage: Any
    authority: object
    migration: object
    fence: object
    cursor_count: int

    def close(self) -> None:
        cleanup_error: Exception | None = None
        try:
            if self.connection.in_transaction:
                self.connection.rollback()
        except Exception as error:  # noqa: BLE001 - aggregate cleanup failure
            cleanup_error = error
        try:
            self.stage.dispose()
            _invariant(
                self.stage._state == "disposed",
                "Python Rule11 parity TEMP stage did not dispose",
            )
            catalog = self.connection.execute(
                "SELECT count(*) FROM temp.sqlite_schema"
            )
            try:
                row = catalog.fetchone()
                _invariant(
                    row == (0,),
                    "Python Rule11 parity TEMP catalog survived stage disposal",
                )
            finally:
                catalog.close()
        except Exception as error:  # noqa: BLE001 - continue closing resources
            if cleanup_error is None:
                cleanup_error = error
        try:
            self.connection.close()
            try:
                cursor = self.connection.execute("SELECT 1")
            except sqlite3.ProgrammingError:
                pass
            else:
                cursor.close()
                raise AssertionError(
                    "Python Rule11 parity connection remained open after close"
                )
        except Exception as error:  # noqa: BLE001 - report first cleanup failure
            if cleanup_error is None:
                cleanup_error = error
        if cleanup_error is not None:
            raise cleanup_error


def create_rule11_python_graph(cursor_count: int) -> Rule11PythonGraph:
    connection = _database()
    stage: object | None = None
    try:
        lock_identity = _install_lock(connection)
        _insert_control_operation(connection)
        _insert_cursor_rows(connection, cursor_count)
        connection.commit()
        configure_sqlite_v1_baseline_temp_storage(connection)
        connection.execute("BEGIN EXCLUSIVE").close()
        stage = create_sqlite_v1_baseline_temp_stage(connection)
        summary = capture_sqlite_v1_baseline_source_summary(
            connection, captured_at_ms=RULE11_PARITY_CAPTURED_AT_MS
        )
        _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        projection = _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        diagnostics = (
            run_sqlite_v1_stream_record_invariant_campaign(
                summary, projection, stage
            ).diagnostics
            + run_sqlite_v1_checkpoint_invariant_campaign(
                summary, projection, stage
            ).diagnostics
            + run_sqlite_v1_lease_lock_hold_invariant_campaign(
                summary, projection, stage
            ).diagnostics
            + run_sqlite_v1_legacy_invariant_campaign(
                summary, projection, stage
            ).diagnostics
        )
        _invariant(
            not diagnostics,
            f"Python Rule11 parity B2 graph is not clean: {diagnostics!r}",
        )
        receipt, _projection_reference = _mint_receipt(
            connection, summary, projection, cursor_count
        )
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(
            connection, stage, receipt
        )
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(
            connection, stage, receipt, transfer
        )
        _invariant(
            type(outcome) is SQLiteCursorPreRebindComplete,
            "Python Rule11 parity B2 did not complete",
        )
        lock = _create_migration_lock_capability_intrinsic(
            connection, lock_identity
        )
        clock_source = _create_provider_clock_source_intrinsic(
            lambda: RULE11_PARITY_CAPTURED_AT_MS + 1_234
        )
        clock = _create_provider_clock_capability_intrinsic(
            connection, lock, clock_source
        )
        evidence = _observe_provider_clock_intrinsic(
            clock, "before-first-permanent-mutation"
        )
        authority = outer._prepare_sqlite_cursor_outer_publication_authority_intrinsic(
            connection,
            stage,
            receipt,
            projection,
            transfer,
            lock,
            clock,
            evidence,
        )
        outer._activate_sqlite_cursor_outer_publication_authority_intrinsic(authority)
        migration = outer._execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(
            authority
        )
        fence = outer._mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
            authority, migration
        )
        return Rule11PythonGraph(
            connection, stage, authority, migration, fence, cursor_count
        )
    except BaseException:
        if stage is not None:
            with suppress(BaseException):
                cast(Any, stage).dispose()
        with suppress(BaseException):
            if connection.in_transaction:
                connection.rollback()
        with suppress(BaseException):
            connection.close()
        raise
