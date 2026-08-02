"""Emit real-SQLite Python evidence for the B3 initial-publication parity gate."""

from __future__ import annotations

import json
import re
import sqlite3
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer
from graph_engineering.canonical import canonical_bytes, canonical_sha256
from graph_engineering.cycle_store_provider import (
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    cycle_store_adapter_codec,
)
from graph_engineering.models import JsonObject
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    _create_migration_lock_capability_intrinsic,
    _create_provider_clock_capability_intrinsic,
    _create_provider_clock_source_intrinsic,
    _MigrationLockIdentity,
    _observe_provider_clock_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_target_catalog import (
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
    _read_target_catalog_observation_intrinsic,
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
    _run_sqlite_cursor_pre_rebind_campaign,
)
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    seal_sqlite_v1_cursor_rows,
)
from graph_engineering.sqlite_operation_baseline_cursor_ownership import (
    SQLiteCursorPreRebindReceipt,
    SQLiteCursorPreRebindReceiptCandidate,
    SQLiteCursorPreRebindReceiptIssuer,
    create_sqlite_cursor_capture_session,
    create_sqlite_cursor_exact_projection_reference,
    create_sqlite_cursor_ownership_capability,
)
from graph_engineering.sqlite_operation_baseline_cursor_stage_ownership import (
    _begin_sqlite_cursor_stage_ownership_transfer,
    _create_sqlite_cursor_seal_temp_table,
    _SQLiteCursorStageOwnershipOuterPublicationAuthority,
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
    SQLiteV1BaselineSourceSummary,
    capture_sqlite_v1_baseline_source_summary,
)
from graph_engineering.sqlite_operation_baseline_stage import (
    SQLiteV1BaselineTempStage,
    configure_sqlite_v1_baseline_temp_storage,
    create_sqlite_v1_baseline_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_stream_record_invariants import (
    run_sqlite_v1_stream_record_invariant_campaign,
)

ROOT = Path(__file__).resolve().parents[2]
NOW = 1_785_110_405_000
ACQUIRED_AT = "2026-07-27T00:00:05.000Z"
EXPIRES_AT = "2026-07-27T00:00:05.001Z"
CHECKPOINT_CREATED_AT = "2026-07-28T00:00:00.123Z"
ASSETS = _load_migration_assets()
CURSOR_REBIND = re.compile(r"UPDATE\s+(?:main\.)?ge_cycle_cursors\s+SET", re.IGNORECASE)

ORDERED_FIELDS = (
    "caseId",
    "outcome",
    "failureBoundary",
    "state",
    "poisoned",
    "providerClockReadCount",
    "clockEvidenceConsumeCount",
    "outerAuthorityMintCount",
    "perWritePrepareCounts",
    "perWriteExecuteCounts",
    "perWriteAffectedRowCounts",
    "perWriteTotalChangesDeltas",
    "outerLedgerLogicalWriteSequence",
    "outerLedgerFixedStatementCount",
    "outerLedgerAffectedRowsWatermark",
    "postDdlCatalogFenceMintCount",
    "readerLeaseMintCount",
    "readerLeaseCloseCount",
    "initialWriteReceiptMintCount",
    "initialWriteReceiptConsumeCount",
    "initialWriteReceiptTombstoneCount",
    "stageAdoptionReceiptMintCount",
    "bundleRetryable",
    "sameTransactionLineage",
    "catalogFenceMatches",
    "cursorRebindPrepareCount",
    "cursorRebindExecuteCount",
    "commitCount",
)


def _epoch_ms(value: str) -> int:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return int(parsed.astimezone(UTC).timestamp() * 1_000)


def _raw(connection: SQLiteV1BaselineConnectionOwner) -> sqlite3.Connection:
    return cast(
        sqlite3.Connection,
        object.__getattribute__(
            connection, "_SQLiteV1BaselineConnectionOwner__connection"
        ),
    )


def _database() -> SQLiteV1BaselineConnectionOwner:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    schema = (
        ROOT / "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql"
    ).read_text(encoding="utf-8")
    connection.executescript(schema)
    connection.execute(
        """INSERT INTO ge_cycle_schema VALUES
           (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)""",
        (
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            ASSETS.schema_sql_hash,
            NOW,
            SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
            NOW,
            NOW,
        ),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_migrations VALUES
           (1, 0, 'fresh-v1-baseline', ?, ?, ?,
            'rebuild-from-verified-backup-only', ?)""",
        (
            ASSETS.schema_sql_hash,
            SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            NOW,
            canonical_bytes(
                {"requiredPostconditions": list(_REQUIRED_MIGRATION_POSTCONDITIONS)}
            ),
        ),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_migration_lock VALUES
           (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)""",
        (NOW,),
    ).close()
    connection.commit()
    return connection


def _insert_operation(
    connection: SQLiteV1BaselineConnectionOwner,
    operation_id: str,
    result: object,
) -> None:
    encoded = cycle_store_adapter_codec.encode_ledger_result(
        "delete-checkpoint", result
    )
    connection.execute(
        """INSERT INTO ge_cycle_operations
           (tenant_id, operation_id, operation_name, request_hash,
            result_blob, result_hash, committed_at_ms)
           VALUES (?, ?, 'delete-checkpoint', ?, ?, ?, ?)""",
        (
            "tenant-a",
            operation_id,
            canonical_sha256({"request": operation_id}),
            encoded,
            canonical_sha256(result),
            NOW,
        ),
    ).close()


def _populate_control(connection: SQLiteV1BaselineConnectionOwner) -> None:
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
    summary: JsonObject = {
        key: value for key, value in checkpoint.items() if key != "value"
    }
    summary_blob = cycle_store_adapter_codec.encode_ledger_result(
        "save-checkpoint", summary
    )
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
    _insert_operation(connection, "legacy-operation-0", {"deleted": False})
    connection.commit()


def _mint_receipt(
    summary: SQLiteV1BaselineSourceSummary,
    identity: Any,
) -> SQLiteCursorPreRebindReceipt:
    envelope = summary.source_envelope
    seal = seal_sqlite_v1_cursor_rows(
        (),
        expected_count=0,
        source_descriptor_hash=str(envelope["sourceDescriptorHash"]),
        source_schema_identity_sha256=str(envelope["sourceSchemaIdentitySha256"]),
    )
    tenant = create_sqlite_cursor_ownership_capability("tenant", bytes(32))
    source_stage = create_sqlite_cursor_ownership_capability(
        "source-stage", bytes([17]) * 32
    )
    campaign = create_sqlite_cursor_ownership_capability("campaign", bytes([34]) * 32)
    connection = create_sqlite_cursor_ownership_capability(
        "connection", bytes([51]) * 32
    )
    session = create_sqlite_cursor_capture_session(
        tenant_ownership=tenant,
        source_stage_ownership=source_stage,
        campaign_ownership=campaign,
        connection_ownership=connection,
        nonce=bytes([68]) * 32,
    )
    candidate = SQLiteCursorPreRebindReceiptCandidate(
        summary,
        summary.clock_evidence,
        seal,
        identity,
        create_sqlite_cursor_exact_projection_reference(identity),
        session,
        tenant,
        source_stage,
        campaign,
        connection,
    )
    return SQLiteCursorPreRebindReceiptIssuer(candidate).issue(candidate)


@dataclass
class _CaseGraph:
    connection: SQLiteV1BaselineConnectionOwner
    stage: SQLiteV1BaselineTempStage
    authority: _SQLiteCursorStageOwnershipOuterPublicationAuthority
    generation: object
    provider_reads: list[int]
    trace: _TraceCounters
    migration: outer._SQLiteMigration0002CatalogRebuildReceipt | None = None
    fence: outer._SQLiteCursorPostDdlCatalogFence | None = None
    reader: outer._SQLiteCursorPostDdlPublicationReaderLease | None = None
    entries: outer._SQLiteBaselineEntriesPublicationReceipt | None = None
    header: outer._SQLiteBaselineHeaderPublicationReceipt | None = None
    sequence: outer._SQLiteOperationSequenceZeroPublicationReceipt | None = None
    write_arrays: _WriteArrays | None = None

    def cleanup(self) -> None:
        self.trace.detach()
        with suppress(BaseException):
            if self.connection.in_transaction:
                self.connection.rollback()
        with suppress(BaseException):
            self.stage.dispose()
        with suppress(BaseException):
            self.connection.close()


class _TraceCounters:
    def __init__(self, connection: SQLiteV1BaselineConnectionOwner) -> None:
        self.connection = connection
        self.cursor_rebind_prepare_count = 0
        self.cursor_rebind_execute_count = 0
        self.commit_count = 0
        self.rollback_count = 0
        _raw(connection).set_trace_callback(self.observe)

    def observe(self, sql: str) -> None:
        statement = sql.strip()
        if CURSOR_REBIND.search(statement) is not None:
            self.cursor_rebind_prepare_count += 1
            self.cursor_rebind_execute_count += 1
        first = statement.split(maxsplit=1)[0].upper() if statement else ""
        if first == "COMMIT":
            self.commit_count += 1
        elif first == "ROLLBACK":
            self.rollback_count += 1

    def detach(self) -> None:
        with suppress(BaseException):
            _raw(self.connection).set_trace_callback(None)


@dataclass(frozen=True)
class _WriteArrays:
    """Read-only evidence captured while the four original receipts are live."""

    prepare: list[int]
    execute: list[int]
    affected: list[int]
    changes: list[int]


def _build_active_graph() -> _CaseGraph:
    connection = _database()
    _populate_control(connection)
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
    _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
    projection = _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
    assert projection.legacy_operation_count == 1
    assert projection.entry_count == 12
    assert (
        run_sqlite_v1_stream_record_invariant_campaign(
            summary, projection, stage
        ).diagnostics
        == ()
    )
    assert (
        run_sqlite_v1_checkpoint_invariant_campaign(
            summary, projection, stage
        ).diagnostics
        == ()
    )
    assert (
        run_sqlite_v1_lease_lock_hold_invariant_campaign(
            summary, projection, stage
        ).diagnostics
        == ()
    )
    assert (
        run_sqlite_v1_legacy_invariant_campaign(summary, projection, stage).diagnostics
        == ()
    )

    receipt = _mint_receipt(summary, projection)
    transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
    _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
    outcome = _run_sqlite_cursor_pre_rebind_campaign(
        connection, stage, receipt, transfer
    )
    assert type(outcome).__name__ == "SQLiteCursorPreRebindComplete"

    cursor = connection.execute(
        """SELECT active_lock_id, active_owner_id, active_source_version,
                  active_target_version, active_lock_epoch, active_fencing_token,
                  active_expires_at_ms
             FROM main.ge_cycle_migration_lock WHERE singleton = 1"""
    )
    try:
        row = cursor.fetchone()
        assert row is not None and cursor.fetchone() is None
    finally:
        cursor.close()
    lock_identity = _MigrationLockIdentity(
        str(row[0]),
        str(row[1]),
        1,
        2,
        cast(int, row[4]),
        cast(int, row[5]),
        cast(int, row[6]),
    )
    provider_reads = [0]

    def provider_now() -> int:
        provider_reads[0] += 1
        return lock_identity.active_expires_at_ms - 1

    trace = _TraceCounters(connection)
    lock = _create_migration_lock_capability_intrinsic(connection, lock_identity)
    clock_source = _create_provider_clock_source_intrinsic(provider_now)
    clock = _create_provider_clock_capability_intrinsic(connection, lock, clock_source)
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
    return _CaseGraph(
        connection,
        stage,
        authority,
        connection._transaction_generation,
        provider_reads,
        trace,
    )


def _through_sequence() -> _CaseGraph:
    graph = _build_active_graph()
    graph.migration = (
        outer._execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(
            graph.authority
        )
    )
    graph.fence = outer._mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
        graph.authority, graph.migration
    )
    graph.reader = (
        outer._mint_sqlite_cursor_post_ddl_publication_reader_lease_intrinsic(
            graph.authority, graph.migration, graph.fence
        )
    )
    outer._execute_sqlite_cursor_post_ddl_publication_reader_intrinsic(
        graph.authority, graph.migration, graph.fence, graph.reader
    )
    graph.entries = outer._execute_sqlite_cursor_baseline_entries_publication_intrinsic(
        graph.authority, graph.migration, graph.fence, graph.reader
    )
    graph.header = outer._execute_sqlite_cursor_baseline_header_publication_intrinsic(
        graph.authority,
        graph.migration,
        graph.fence,
        graph.reader,
        graph.entries,
    )
    graph.sequence = (
        outer._execute_sqlite_cursor_operation_sequence_zero_publication_intrinsic(
            graph.authority,
            graph.migration,
            graph.fence,
            graph.reader,
            graph.entries,
            graph.header,
        )
    )
    graph.write_arrays = _capture_write_arrays(graph)
    return graph


def _capture_write_arrays(graph: _CaseGraph) -> _WriteArrays:
    authority = (
        outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
    )
    prepare = [
        authority.migration_0002_prepared_statement_count,
        authority.baseline_entries_prepare_count,
        authority.baseline_header_prepare_count,
        authority.operation_sequence_zero_prepare_count,
    ]
    execute = [
        authority.migration_0002_logical_execution_count,
        authority.baseline_entries_execute_count,
        authority.baseline_header_execute_count,
        authority.operation_sequence_zero_execute_count,
    ]
    affected = [0, 0, 0, 0]
    changes = [0, 0, 0, 0]
    if graph.migration is not None:
        migration_snapshot = outer._read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
            graph.migration
        )
        affected[0] = migration_snapshot.affected_rows
        changes[0] = migration_snapshot.total_changes_delta
    if graph.entries is not None:
        entries_snapshot = (
            outer._read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(
                graph.entries
            )
        )
        affected[1] = entries_snapshot.affected_rows
        changes[1] = entries_snapshot.total_changes_delta
    if graph.header is not None:
        header_snapshot = (
            outer._read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(
                graph.header
            )
        )
        affected[2] = header_snapshot.affected_rows
        changes[2] = header_snapshot.total_changes_delta
    if graph.sequence is not None:
        sequence_snapshot = outer._read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
            graph.sequence
        )
        affected[3] = sequence_snapshot.affected_rows
        changes[3] = sequence_snapshot.total_changes_delta
    return _WriteArrays(prepare, execute, affected, changes)


def _write_arrays(graph: _CaseGraph) -> _WriteArrays:
    """Return evidence without reopening a consumed receipt surface."""

    if graph.write_arrays is None:
        graph.write_arrays = _capture_write_arrays(graph)
    return graph.write_arrays


def _record(
    graph: _CaseGraph,
    *,
    case_id: str,
    outcome: str,
    failure_boundary: str | None,
    state: str,
    bundle_retryable: bool,
    catalog_fence_matches: bool,
) -> dict[str, object]:
    snapshot = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        graph.authority
    )
    write_arrays = _write_arrays(graph)
    ledger = snapshot.outer_ledger
    record: dict[str, object] = {
        "caseId": case_id,
        "outcome": outcome,
        "failureBoundary": failure_boundary,
        "state": state,
        "poisoned": snapshot.lifecycle == "poisoned",
        "providerClockReadCount": graph.provider_reads[0],
        "clockEvidenceConsumeCount": int(
            snapshot.outer_clock_consumed_tombstone is not None
        ),
        "outerAuthorityMintCount": snapshot.activation_count,
        "perWritePrepareCounts": write_arrays.prepare,
        "perWriteExecuteCounts": write_arrays.execute,
        "perWriteAffectedRowCounts": write_arrays.affected,
        "perWriteTotalChangesDeltas": write_arrays.changes,
        "outerLedgerLogicalWriteSequence": ledger.logical_write_sequence,
        "outerLedgerFixedStatementCount": ledger.fixed_statement_count,
        "outerLedgerAffectedRowsWatermark": ledger.affected_rows_watermark,
        "postDdlCatalogFenceMintCount": snapshot.post_ddl_catalog_fence_mint_count,
        "readerLeaseMintCount": snapshot.post_ddl_publication_reader_lease_mint_count,
        "readerLeaseCloseCount": snapshot.post_ddl_publication_reader_lease_close_count,
        "initialWriteReceiptMintCount": (
            int(snapshot.migration_0002_receipt is not None)
            + snapshot.baseline_entries_publication_receipt_mint_count
            + snapshot.baseline_header_publication_receipt_mint_count
            + snapshot.operation_sequence_zero_publication_receipt_mint_count
        ),
        "initialWriteReceiptConsumeCount": snapshot.receipt_consumption_count,
        "initialWriteReceiptTombstoneCount": snapshot.tombstone_mint_count,
        "stageAdoptionReceiptMintCount": snapshot.initial_stage_adoption_receipt_mint_count,
        "bundleRetryable": bundle_retryable,
        "sameTransactionLineage": graph.connection._transaction_generation
        is graph.generation,
        "catalogFenceMatches": catalog_fence_matches,
        "cursorRebindPrepareCount": graph.trace.cursor_rebind_prepare_count,
        "cursorRebindExecuteCount": graph.trace.cursor_rebind_execute_count,
        "commitCount": graph.trace.commit_count,
    }
    assert tuple(record) == ORDERED_FIELDS
    assert graph.trace.rollback_count == 0
    return record


def _success_case() -> tuple[dict[str, object], int]:
    graph = _through_sequence()
    try:
        outer._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
            graph.authority,
            (graph.migration, graph.entries, graph.header, graph.sequence),
            graph.fence,
            graph.reader,
        )
        catalog = _read_target_catalog_observation_intrinsic(graph.connection)
        assert (
            catalog.row_count
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
        )
        catalog_matches = (
            catalog.catalog_sha256
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        )
        assert catalog_matches
        return (
            _record(
                graph,
                case_id="initial-publication-success-control",
                outcome="success",
                failure_boundary=None,
                state="pre-rebind-complete",
                bundle_retryable=False,
                catalog_fence_matches=catalog_matches,
            ),
            graph.trace.rollback_count,
        )
    finally:
        graph.cleanup()


def _expect_consumed_receipt(action: Callable[[], object], code: str) -> None:
    try:
        action()
    except ValueError as error:
        assert type(error) is ValueError
        assert error.args == (code,)
        assert str(error) == code
    else:
        raise AssertionError(f"consumed receipt remained readable: {code}")


def _assert_original_receipts_consumed(graph: _CaseGraph) -> None:
    migration = graph.migration
    entries = graph.entries
    header = graph.header
    sequence = graph.sequence
    assert migration is not None
    assert entries is not None
    assert header is not None
    assert sequence is not None
    _expect_consumed_receipt(
        lambda: (
            outer._read_sqlite_migration_0002_catalog_rebuild_receipt_snapshot_intrinsic(
                migration
            )
        ),
        "GE_CURSOR_B3_MIGRATION_0002_RECEIPT_CONSUMED",
    )
    _expect_consumed_receipt(
        lambda: (
            outer._read_sqlite_baseline_entries_publication_receipt_snapshot_intrinsic(
                entries
            )
        ),
        "GE_CURSOR_B3_BASELINE_ENTRIES_RECEIPT_CONSUMED",
    )
    _expect_consumed_receipt(
        lambda: (
            outer._read_sqlite_baseline_header_publication_receipt_snapshot_intrinsic(
                header
            )
        ),
        "GE_CURSOR_B3_BASELINE_HEADER_RECEIPT_CONSUMED",
    )
    _expect_consumed_receipt(
        lambda: (
            outer._read_sqlite_operation_sequence_zero_publication_receipt_snapshot_intrinsic(
                sequence
            )
        ),
        "GE_CURSOR_B3_SEQUENCE_ZERO_RECEIPT_CONSUMED",
    )


def _invalid_bundle_case() -> tuple[dict[str, object], int]:
    graph = _through_sequence()
    try:
        try:
            outer._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
                graph.authority,
                (graph.migration, graph.entries, graph.header),
                graph.fence,
                graph.reader,
            )
        except ValueError as error:
            if str(error) != "GE_CURSOR_B3_INITIAL_ADOPTION_BUNDLE":
                raise
        else:
            raise AssertionError("invalid adoption bundle unexpectedly succeeded")
        catalog = _read_target_catalog_observation_intrinsic(graph.connection)
        assert (
            catalog.row_count
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
        )
        catalog_matches = (
            catalog.catalog_sha256
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        )
        assert catalog_matches
        record = _record(
            graph,
            case_id="initial-publication-invalid-adoption-bundle",
            outcome="rejected",
            failure_boundary="initial-stage-adoption-validation",
            state="pre-rebind-complete",
            bundle_retryable=True,
            catalog_fence_matches=catalog_matches,
        )
        adoption = outer._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
            graph.authority,
            (graph.migration, graph.entries, graph.header, graph.sequence),
            graph.fence,
            graph.reader,
        )
        corrected = (
            outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                graph.authority
            )
        )
        assert corrected.receipt_consumption_count == 4
        assert corrected.tombstone_mint_count == 4
        assert corrected.initial_stage_adoption_receipt_mint_count == 1
        assert corrected.initial_stage_adoption_receipt is adoption
        assert corrected.write_phase == "initial-stage-adoption-complete"
        adoption_snapshot = (
            outer._read_sqlite_cursor_initial_stage_adoption_receipt_snapshot_intrinsic(
                adoption
            )
        )
        assert adoption_snapshot.mint_count == 1
        assert adoption_snapshot.write_kind == "initial-publication-stage-adoption"
        assert adoption_snapshot.migration_0002_receipt is graph.migration
        assert adoption_snapshot.baseline_entries_publication_receipt is graph.entries
        assert adoption_snapshot.baseline_header_publication_receipt is graph.header
        assert (
            adoption_snapshot.operation_sequence_zero_publication_receipt
            is graph.sequence
        )
        _assert_original_receipts_consumed(graph)
        return record, graph.trace.rollback_count
    finally:
        graph.cleanup()


def _catalog_drift_case() -> tuple[dict[str, object], int]:
    graph = _build_active_graph()
    try:
        graph.migration = (
            outer._execute_sqlite_cursor_migration_0002_catalog_rebuild_intrinsic(
                graph.authority
            )
        )
        graph.write_arrays = _capture_write_arrays(graph)
        raw = _raw(graph.connection)
        raw.execute("DROP INDEX main.ge_cycle_cursors_open_idx")
        raw.execute(
            "CREATE INDEX ge_cycle_cursors_open_idx "
            "ON ge_cycle_cursors(tenant_id, token_hash, expires_at_ms)"
        )
        catalog = _read_target_catalog_observation_intrinsic(graph.connection)
        assert (
            catalog.row_count
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT
        )
        catalog_matches = (
            catalog.catalog_sha256
            == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
        )
        assert not catalog_matches
        try:
            outer._mint_sqlite_cursor_post_ddl_catalog_fence_intrinsic(
                graph.authority, graph.migration
            )
        except ValueError as error:
            if (
                type(error) is not ValueError
                or error.args != ("GE_CURSOR_B3_TARGET_CATALOG_MISMATCH",)
                or str(error) != "GE_CURSOR_B3_TARGET_CATALOG_MISMATCH"
            ):
                raise
        else:
            raise AssertionError("post-0002 catalog drift unexpectedly succeeded")
        return (
            _record(
                graph,
                case_id="initial-publication-post-0002-catalog-drift",
                outcome="poisoned",
                failure_boundary="after-migration-0002-before-fence",
                state="poisoned",
                bundle_retryable=False,
                catalog_fence_matches=catalog_matches,
            ),
            graph.trace.rollback_count,
        )
    finally:
        graph.cleanup()


class _CounterProbeRecorder:
    """Isolated no-op hooks proving each report counter path is observable."""

    def __init__(self) -> None:
        self._provider_clock_read_count = 0
        self._clock_evidence_consume_count = 0
        self._outer_authority_mint_count = 0
        self._write_prepare_counts = [0, 0, 0, 0]
        self._write_execute_counts = [0, 0, 0, 0]
        self._write_affected_counts = [0, 0, 0, 0]
        self._write_change_counts = [0, 0, 0, 0]
        self._ledger_logical_write_sequence = 0
        self._ledger_fixed_statement_count = 0
        self._ledger_affected_rows_watermark = 0
        self._catalog_fence_mint_count = 0
        self._reader_lease_mint_count = 0
        self._reader_lease_close_count = 0
        self._initial_write_receipt_mint_count = 0
        self._initial_write_receipt_consume_count = 0
        self._initial_write_receipt_tombstone_count = 0
        self._stage_adoption_receipt_mint_count = 0
        self._cursor_rebind_prepare_count = 0
        self._cursor_rebind_execute_count = 0
        self._commit_count = 0
        self._rollback_count = 0

    @staticmethod
    def _slot(counts: list[int], slot: int) -> None:
        if not 0 <= slot < 4:
            raise AssertionError(f"unknown write probe slot: {slot}")
        counts[slot] += 1

    def provider_clock_read(self) -> None:
        self._provider_clock_read_count += 1

    def clock_evidence_consumed(self) -> None:
        self._clock_evidence_consume_count += 1

    def outer_authority_minted(self) -> None:
        self._outer_authority_mint_count += 1

    def write_prepared(self, slot: int) -> None:
        self._slot(self._write_prepare_counts, slot)

    def write_executed(self, slot: int) -> None:
        self._slot(self._write_execute_counts, slot)

    def write_affected(self, slot: int) -> None:
        self._slot(self._write_affected_counts, slot)

    def write_changed(self, slot: int) -> None:
        self._slot(self._write_change_counts, slot)

    def ledger_logical_write(self) -> None:
        self._ledger_logical_write_sequence += 1

    def ledger_fixed_statement(self) -> None:
        self._ledger_fixed_statement_count += 1

    def ledger_affected_row(self) -> None:
        self._ledger_affected_rows_watermark += 1

    def catalog_fence_minted(self) -> None:
        self._catalog_fence_mint_count += 1

    def reader_lease_minted(self) -> None:
        self._reader_lease_mint_count += 1

    def reader_lease_closed(self) -> None:
        self._reader_lease_close_count += 1

    def initial_write_receipt_minted(self) -> None:
        self._initial_write_receipt_mint_count += 1

    def initial_write_receipt_consumed(self) -> None:
        self._initial_write_receipt_consume_count += 1

    def initial_write_receipt_tombstoned(self) -> None:
        self._initial_write_receipt_tombstone_count += 1

    def stage_adoption_receipt_minted(self) -> None:
        self._stage_adoption_receipt_mint_count += 1

    def cursor_rebind_prepared(self) -> None:
        self._cursor_rebind_prepare_count += 1

    def cursor_rebind_executed(self) -> None:
        self._cursor_rebind_execute_count += 1

    def committed(self) -> None:
        self._commit_count += 1

    def rolled_back(self) -> None:
        self._rollback_count += 1

    def snapshot(self) -> dict[str, object]:
        return {
            "providerClockReadCount": self._provider_clock_read_count,
            "clockEvidenceConsumeCount": self._clock_evidence_consume_count,
            "outerAuthorityMintCount": self._outer_authority_mint_count,
            "perWritePrepareCounts": list(self._write_prepare_counts),
            "perWriteExecuteCounts": list(self._write_execute_counts),
            "perWriteAffectedRowCounts": list(self._write_affected_counts),
            "perWriteTotalChangesDeltas": list(self._write_change_counts),
            "outerLedgerLogicalWriteSequence": self._ledger_logical_write_sequence,
            "outerLedgerFixedStatementCount": self._ledger_fixed_statement_count,
            "outerLedgerAffectedRowsWatermark": self._ledger_affected_rows_watermark,
            "postDdlCatalogFenceMintCount": self._catalog_fence_mint_count,
            "readerLeaseMintCount": self._reader_lease_mint_count,
            "readerLeaseCloseCount": self._reader_lease_close_count,
            "initialWriteReceiptMintCount": self._initial_write_receipt_mint_count,
            "initialWriteReceiptConsumeCount": self._initial_write_receipt_consume_count,
            "initialWriteReceiptTombstoneCount": self._initial_write_receipt_tombstone_count,
            "stageAdoptionReceiptMintCount": self._stage_adoption_receipt_mint_count,
            "cursorRebindPrepareCount": self._cursor_rebind_prepare_count,
            "cursorRebindExecuteCount": self._cursor_rebind_execute_count,
            "commitCount": self._commit_count,
            "rollbackCount": self._rollback_count,
        }


def _counter_probe() -> dict[str, object]:
    recorder = _CounterProbeRecorder()
    recorder.provider_clock_read()
    recorder.clock_evidence_consumed()
    recorder.outer_authority_minted()
    recorder.write_prepared(0)
    recorder.write_prepared(1)
    recorder.write_prepared(2)
    recorder.write_prepared(3)
    recorder.write_executed(0)
    recorder.write_executed(1)
    recorder.write_executed(2)
    recorder.write_executed(3)
    recorder.write_affected(0)
    recorder.write_affected(1)
    recorder.write_affected(2)
    recorder.write_affected(3)
    recorder.write_changed(0)
    recorder.write_changed(1)
    recorder.write_changed(2)
    recorder.write_changed(3)
    recorder.ledger_logical_write()
    recorder.ledger_fixed_statement()
    recorder.ledger_affected_row()
    recorder.catalog_fence_minted()
    recorder.reader_lease_minted()
    recorder.reader_lease_closed()
    recorder.initial_write_receipt_minted()
    recorder.initial_write_receipt_consumed()
    recorder.initial_write_receipt_tombstoned()
    recorder.stage_adoption_receipt_minted()
    recorder.cursor_rebind_prepared()
    recorder.cursor_rebind_executed()
    recorder.committed()
    recorder.rolled_back()
    return recorder.snapshot()


def _public_exports() -> dict[str, bool]:
    package_members = vars(graph_engineering)
    declared_exports = getattr(graph_engineering, "__all__", ())

    def exposed(name: str) -> bool:
        return (
            name in package_members
            or name in declared_exports
            or hasattr(graph_engineering, name)
        )

    return {
        "packageRootAdoption": exposed(
            "_adopt_sqlite_cursor_initial_publication_stage_intrinsic"
        ),
        "packageRootMeasurement": exposed(
            "_read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic"
        ),
    }


def build_report() -> dict[str, object]:
    cases_with_rollbacks = (
        _success_case(),
        _invalid_bundle_case(),
        _catalog_drift_case(),
    )
    public_exports = _public_exports()
    if not public_exports or any(public_exports.values()):
        raise AssertionError(
            "initial-publication private API leaked from the Python root"
        )
    rollback_count = sum(item[1] for item in cases_with_rollbacks)
    if rollback_count != 0:
        raise AssertionError(
            "initial-publication case executed rollback before observation"
        )
    return {
        "runtime": "python",
        "publicExports": public_exports,
        "counterProbe": _counter_probe(),
        "rollbackCount": rollback_count,
        "cases": [item[0] for item in cases_with_rollbacks],
    }


def main() -> None:
    print(json.dumps(build_report(), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
