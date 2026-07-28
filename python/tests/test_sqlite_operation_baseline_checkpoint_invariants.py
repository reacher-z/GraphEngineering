from __future__ import annotations

from collections.abc import Callable
from dataclasses import FrozenInstanceError, replace
from typing import cast

import pytest

from graph_engineering.canonical import canonical_bytes
from graph_engineering.cycle_store_provider import (
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    cycle_store_adapter_codec,
)
from graph_engineering.models import JsonObject
from graph_engineering.sqlite_operation_baseline import BaselineProjectionIdentity
from graph_engineering.sqlite_operation_baseline_checkpoint_invariants import (
    SQLITE_CHECKPOINT_RULES,
    SQLiteCheckpointCampaignReport,
    SQLiteCheckpointReconciliationDiagnostic,
    SQLiteV1CheckpointInvariantCampaign,
    run_sqlite_v1_checkpoint_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_cooperation import (
    _stream_sqlite_v1_baseline_source_into_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_handoff import (
    _project_ordered_sqlite_v1_baseline_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    _SQLiteCursorCapability,
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
from tests.test_sqlite_operation_baseline_source import NOW, database

Populate = Callable[[SQLiteV1BaselineConnectionOwner], None]
SHARED_NOW = 1_785_110_405_000
CREATED_AT = "2026-07-28T00:00:00Z"
BINDING_CURRENT_CREATED_AT = "2026-07-29T00:00:00Z"


def _record(
    tenant_id: str,
    stream_id: str,
    record_id: str,
) -> JsonObject:
    return create_cycle_store_record(
        record_id=record_id,
        sequence=0,
        previous_record_hash=None,
        value=f"{tenant_id}:{stream_id}:0",
    )


def _insert_stream_record(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    stream_id: str,
    record_id: str,
) -> JsonObject:
    record = _record(tenant_id, stream_id, record_id)
    connection.execute(
        """INSERT INTO ge_cycle_streams
           (tenant_id, stream_id, tail_sequence, tail_record_hash,
            created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)""",
        (tenant_id, stream_id, 0, record["recordHash"], SHARED_NOW, SHARED_NOW),
    ).close()
    connection.execute(
        """INSERT INTO ge_cycle_records
           (tenant_id, stream_id, sequence, record_id, previous_record_hash,
            value_hash, value_bytes, value_blob, record_hash, record_blob,
            committed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tenant_id,
            stream_id,
            record["sequence"],
            record["recordId"],
            record["previousRecordHash"],
            record["valueHash"],
            record["valueBytes"],
            canonical_bytes(record["value"]),
            record["recordHash"],
            canonical_bytes(record),
            SHARED_NOW,
        ),
    ).close()
    return record


def _checkpoint(
    checkpoint_scope: str,
    checkpoint_id: str,
    stream_id: str,
    record: JsonObject,
    *,
    value: object | None = None,
    created_at: str = CREATED_AT,
    bound_record_hash: str | None = None,
) -> JsonObject:
    return create_cycle_store_checkpoint(
        checkpoint_scope=checkpoint_scope,
        checkpoint_id=checkpoint_id,
        stream_id=stream_id,
        bound_sequence=cast(int, record["sequence"]),
        bound_record_hash=(
            cast(str, record["recordHash"])
            if bound_record_hash is None
            else bound_record_hash
        ),
        created_at=created_at,
        value=f"value-{checkpoint_id}" if value is None else value,
    )


def _summary(checkpoint: JsonObject) -> JsonObject:
    return {key: value for key, value in checkpoint.items() if key != "value"}


def _insert_revision(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    revision: int,
    checkpoint: JsonObject,
    *,
    action: str = "put",
    recorded_at_ms: int = SHARED_NOW,
) -> None:
    put = action == "put"
    summary = _summary(checkpoint)
    summary_blob = cycle_store_adapter_codec.encode_ledger_result(
        "save-checkpoint",
        summary,
    )
    connection.execute(
        """INSERT INTO ge_cycle_checkpoint_revisions
           (tenant_id, checkpoint_scope, revision, checkpoint_id, action,
            summary_blob, bound_sequence, bound_record_hash,
            checkpoint_created_at, value_hash, value_bytes, recorded_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tenant_id,
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
            recorded_at_ms,
        ),
    ).close()


def _insert_current(
    connection: SQLiteV1BaselineConnectionOwner,
    tenant_id: str,
    revision: int,
    checkpoint: JsonObject,
    *,
    committed_at_ms: int = SHARED_NOW,
) -> None:
    summary_blob = cycle_store_adapter_codec.encode_ledger_result(
        "save-checkpoint",
        _summary(checkpoint),
    )
    connection.execute(
        """INSERT INTO ge_cycle_checkpoints
           (tenant_id, checkpoint_scope, checkpoint_id, stream_id,
            bound_sequence, bound_record_hash, created_at, value_hash,
            value_bytes, value_blob, checkpoint_blob, summary_blob,
            checkpoint_revision, committed_at_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            tenant_id,
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
            revision,
            committed_at_ms,
        ),
    ).close()


def _populate_shared_hostile_relations(
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    connection.execute("PRAGMA foreign_keys = OFF").close()

    cross_record = _insert_stream_record(
        connection, "tenant-foreign", "stream-cross", "record-cross-0"
    )
    cross = _checkpoint(
        "scope-cross", "checkpoint-cross", "stream-cross", cross_record
    )
    _insert_revision(connection, "tenant-cross", 1, cross)
    _insert_revision(connection, "tenant-cross", 2, cross, action="delete")

    wrong_record = _insert_stream_record(
        connection, "tenant-wrong", "stream-wrong", "record-wrong-0"
    )
    wrong = _checkpoint(
        "scope-wrong",
        "checkpoint-wrong",
        "stream-wrong",
        wrong_record,
        bound_record_hash="c" * 64,
    )
    _insert_revision(connection, "tenant-wrong", 1, wrong)
    _insert_current(connection, "tenant-wrong", 1, wrong)

    start_record = _insert_stream_record(
        connection, "tenant-start", "stream-start", "record-start-0"
    )
    start = _checkpoint(
        "scope-start", "checkpoint-start", "stream-start", start_record
    )
    _insert_revision(connection, "tenant-start", 2, start)

    mixed_record = _insert_stream_record(
        connection, "tenant-mixed", "stream-mixed", "record-mixed-0"
    )
    mixed_a = _checkpoint(
        "scope-mixed", "checkpoint-a", "stream-mixed", mixed_record
    )
    mixed_b = _checkpoint(
        "scope-mixed", "checkpoint-b", "stream-mixed", mixed_record
    )
    _insert_revision(connection, "tenant-mixed", 1, mixed_a)
    _insert_revision(connection, "tenant-mixed", 2, mixed_b)
    _insert_current(connection, "tenant-mixed", 2, mixed_b)

    delete_record = _insert_stream_record(
        connection, "tenant-delete", "stream-delete", "record-delete-0"
    )
    deleted = _checkpoint(
        "scope-delete", "checkpoint-delete", "stream-delete", delete_record
    )
    _insert_revision(connection, "tenant-delete", 1, deleted)
    _insert_revision(connection, "tenant-delete", 2, deleted, action="delete")
    _insert_current(connection, "tenant-delete", 1, deleted)

    zero_record = _insert_stream_record(
        connection, "tenant-zero", "stream-zero", "record-zero-0"
    )
    zero = _checkpoint("scope-zero", "checkpoint-zero", "stream-zero", zero_record)
    _insert_current(connection, "tenant-zero", 1, zero)

    interleaved_record = _insert_stream_record(
        connection,
        "tenant-interleaved",
        "stream-interleaved",
        "record-interleaved-0",
    )
    interleaved_a = _checkpoint(
        "scope-interleaved",
        "checkpoint-a",
        "stream-interleaved",
        interleaved_record,
    )
    interleaved_b = _checkpoint(
        "scope-interleaved",
        "checkpoint-b",
        "stream-interleaved",
        interleaved_record,
    )
    _insert_revision(connection, "tenant-interleaved", 1, interleaved_a)
    _insert_revision(connection, "tenant-interleaved", 2, interleaved_b)
    _insert_revision(connection, "tenant-interleaved", 3, interleaved_a)
    _insert_current(connection, "tenant-interleaved", 1, interleaved_a)
    _insert_current(connection, "tenant-interleaved", 2, interleaved_b)

    binding_record = _insert_stream_record(
        connection, "tenant-binding", "stream-binding", "record-binding-0"
    )
    binding_revision = _checkpoint(
        "scope-binding",
        "checkpoint-binding",
        "stream-binding",
        binding_record,
        value="binding-revision",
    )
    binding_current = _checkpoint(
        "scope-binding",
        "checkpoint-binding",
        "stream-binding",
        binding_record,
        value="binding-current",
        created_at=BINDING_CURRENT_CREATED_AT,
    )
    _insert_revision(
        connection,
        "tenant-binding",
        1,
        binding_revision,
        recorded_at_ms=SHARED_NOW - 1,
    )
    _insert_current(connection, "tenant-binding", 1, binding_current)

    interior_record = _insert_stream_record(
        connection, "tenant-interior", "stream-interior", "record-interior-0"
    )
    interior = _checkpoint(
        "scope-interior",
        "checkpoint-interior",
        "stream-interior",
        interior_record,
    )
    _insert_revision(connection, "tenant-interior", 1, interior)
    _insert_revision(connection, "tenant-interior", 3, interior)
    _insert_current(connection, "tenant-interior", 3, interior)

    connection.execute(
        """UPDATE ge_cycle_schema
              SET latest_migration_applied_at_ms = ?, created_at_ms = ?, updated_at_ms = ?""",
        (SHARED_NOW, SHARED_NOW, SHARED_NOW),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migrations SET applied_at_ms = ?", (SHARED_NOW,)
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ?", (SHARED_NOW,)
    ).close()
    connection.commit()


def _prepare(
    populate: Populate | None = None,
    *,
    captured_at_ms: int = NOW,
) -> tuple[
    SQLiteV1BaselineConnectionOwner,
    SQLiteV1BaselineSourceSummary,
    SQLiteV1BaselineTempStage,
    BaselineProjectionIdentity,
]:
    connection = database()
    if populate is not None:
        populate(connection)
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    summary = capture_sqlite_v1_baseline_source_summary(
        connection,
        captured_at_ms=captured_at_ms,
    )
    _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
    identity = _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
    stream_report = run_sqlite_v1_stream_record_invariant_campaign(
        summary,
        identity,
        stage,
    )
    assert stream_report.diagnostics == ()
    return connection, summary, stage, identity


def _cleanup(
    connection: SQLiteV1BaselineConnectionOwner,
    stage: SQLiteV1BaselineTempStage,
) -> None:
    try:
        stage.dispose()
    finally:
        connection.rollback()
        connection.close()


def test_pristine_campaign_is_empty_frozen_and_exactly_identity_bound() -> None:
    connection, summary, stage, identity = _prepare()
    try:
        report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert report == SQLiteCheckpointCampaignReport(identity, ())
        assert report.projection_identity is identity
        assert stage._checkpoint_campaign_completed
        with pytest.raises(FrozenInstanceError):
            report.diagnostics = ()  # type: ignore[misc]
    finally:
        _cleanup(connection, stage)


def test_shared_hostile_fixture_reports_exact_rule_order_and_counts() -> None:
    connection, summary, stage, identity = _prepare(
        _populate_shared_hostile_relations,
        captured_at_ms=SHARED_NOW,
    )
    try:
        report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert report.projection_identity == BaselineProjectionIdentity(
            baseline_id=(
                "v2-fa4f8ccf6009797f4204ecbb8c85cc1d753ce219ce25630ef8af21558326f2af"
            ),
            entry_count=43,
            legacy_operation_count=0,
            first_entry_hash=(
                "f061b7d1fd823d623dc13ab12c78806cf6457e2f6e2f054b235d26d8abee787c"
            ),
            final_entry_hash=(
                "c4585a6a22dd0859d5d671f75ff143a6c5eae088cc3d87a2addc97ce9c21144c"
            ),
            projection_sha256=(
                "264a8ba16682d78368f5318e67b2c938167a28549ccf8fbb1ca685d2f79f497e"
            ),
        )
        assert report.projection_identity is identity
        assert report.diagnostics == (
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_REVISION_GAP", 2, False
            ),
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_RECORD_MISSING", 3, False
            ),
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_MISSING", 2, False
            ),
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_UNEXPECTED", 2, False
            ),
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_STALE", 1, False
            ),
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_BINDING", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_rule_registry_is_frozen_ordered_and_marker_only() -> None:
    assert tuple(rule.rule_id for rule in SQLITE_CHECKPOINT_RULES) == (
        "BLR_CHECKPOINT_REVISION_GAP",
        "BLR_CHECKPOINT_RECORD_MISSING",
        "BLR_CHECKPOINT_CURRENT_MISSING",
        "BLR_CHECKPOINT_CURRENT_UNEXPECTED",
        "BLR_CHECKPOINT_CURRENT_STALE",
        "BLR_CHECKPOINT_CURRENT_BINDING",
    )
    for rule in SQLITE_CHECKPOINT_RULES:
        assert "LIMIT ?" in rule.sql
        assert "SELECT 1" in rule.sql
        assert "SELECT *" not in rule.sql
        with pytest.raises(FrozenInstanceError):
            rule.sql = "SELECT 2"  # type: ignore[misc]


def test_every_indexed_rule_has_its_named_query_plan() -> None:
    connection, _summary_value, stage, _identity = _prepare()
    try:
        for rule in SQLITE_CHECKPOINT_RULES:
            cursor = connection.execute("EXPLAIN QUERY PLAN " + rule.sql, (17,))
            details: list[str] = []
            try:
                while True:
                    row = cursor.fetchone()
                    if row is None:
                        break
                    assert len(row) == 4 and isinstance(row[3], str)
                    details.append(row[3])
            finally:
                cursor.close()
            plan = "\n".join(details)
            for index in rule.required_indexes:
                assert index in plan, (rule.rule_id, plan)
    finally:
        _cleanup(connection, stage)


def _populate_unexpected_currents(
    connection: SQLiteV1BaselineConnectionOwner,
    count: int,
) -> None:
    for index in range(count):
        tenant_id = f"tenant-limit-{index:03d}"
        stream_id = f"stream-limit-{index:03d}"
        checkpoint_id = f"checkpoint-limit-{index:03d}"
        record = _insert_stream_record(
            connection,
            tenant_id,
            stream_id,
            f"record-limit-{index:03d}",
        )
        checkpoint = _checkpoint(
            "scope-limit",
            checkpoint_id,
            stream_id,
            record,
        )
        _insert_current(connection, tenant_id, 1, checkpoint)
    connection.execute(
        """UPDATE ge_cycle_schema
              SET latest_migration_applied_at_ms = ?, created_at_ms = ?, updated_at_ms = ?""",
        (SHARED_NOW, SHARED_NOW, SHARED_NOW),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migrations SET applied_at_ms = ?", (SHARED_NOW,)
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ?", (SHARED_NOW,)
    ).close()
    connection.commit()


def _normalize_shared_base_clocks(
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    connection.execute(
        """UPDATE ge_cycle_schema
              SET latest_migration_applied_at_ms = ?, created_at_ms = ?, updated_at_ms = ?""",
        (SHARED_NOW, SHARED_NOW, SHARED_NOW),
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migrations SET applied_at_ms = ?", (SHARED_NOW,)
    ).close()
    connection.execute(
        "UPDATE ge_cycle_migration_lock SET updated_at_ms = ?", (SHARED_NOW,)
    ).close()


def _populate_valid_checkpoint(
    connection: SQLiteV1BaselineConnectionOwner,
) -> None:
    record = _insert_stream_record(
        connection,
        "tenant-valid",
        "stream-valid",
        "record-valid-0",
    )
    checkpoint = _checkpoint(
        "scope-valid",
        "checkpoint-valid",
        "stream-valid",
        record,
    )
    _insert_revision(connection, "tenant-valid", 1, checkpoint)
    _insert_current(connection, "tenant-valid", 1, checkpoint)
    _normalize_shared_base_clocks(connection)
    connection.commit()


@pytest.mark.parametrize("diagnostic_limit", [1, 16, 64])
@pytest.mark.parametrize("extra", [False, True], ids=["exact-limit", "limit-plus-one"])
def test_exact_diagnostic_limit_boundary(
    diagnostic_limit: int,
    extra: bool,
) -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        _populate_unexpected_currents(connection, diagnostic_limit + int(extra))

    connection, summary, stage, identity = _prepare(
        populate,
        captured_at_ms=SHARED_NOW,
    )
    try:
        report = run_sqlite_v1_checkpoint_invariant_campaign(
            summary,
            identity,
            stage,
            diagnostic_limit=diagnostic_limit,
        )
        assert report.diagnostics == (
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_UNEXPECTED",
                diagnostic_limit,
                extra,
            ),
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("diagnostic_limit", [None, True, 0, 65, 1.5, "16"])
def test_invalid_limit_fails_before_campaign_begin(diagnostic_limit: object) -> None:
    connection, summary, stage, identity = _prepare()
    try:
        with pytest.raises(ValueError, match="outside bounds"):
            SQLiteV1CheckpointInvariantCampaign(
                summary,
                identity,
                stage,
                diagnostic_limit=diagnostic_limit,
            )
        assert not stage._checkpoint_campaign_started
        assert stage.state == "open"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("kind_rank", [4, 5], ids=["current", "put-revision"])
@pytest.mark.parametrize(
    "summary_field",
    [
        "checkpointScope",
        "checkpointId",
        "streamId",
        "boundSequence",
        "boundRecordHash",
        "createdAt",
        "valueHash",
        "valueBytes",
    ],
)
def test_nested_summary_field_substitution_is_a_single_binding_witness(
    kind_rank: int,
    summary_field: str,
) -> None:
    connection, summary, stage, identity = _prepare(
        _populate_valid_checkpoint,
        captured_at_ms=SHARED_NOW,
    )
    try:
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(
                    json_set(CAST(state_blob AS TEXT), ?, 'hostile') AS BLOB
                  )
                WHERE kind_rank = ?""",
            (f"$.summary.{summary_field}", kind_rank),
        ).close()
        stage._allowed_total_changes = connection.total_changes
        report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_BINDING", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_delete_revision_requires_explicit_null_summary() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        record = _insert_stream_record(
            connection,
            "tenant-delete-summary",
            "stream-delete-summary",
            "record-delete-summary-0",
        )
        checkpoint = _checkpoint(
            "scope-delete-summary",
            "checkpoint-delete-summary",
            "stream-delete-summary",
            record,
        )
        _insert_revision(connection, "tenant-delete-summary", 1, checkpoint)
        _insert_revision(
            connection,
            "tenant-delete-summary",
            2,
            checkpoint,
            action="delete",
        )
        _normalize_shared_base_clocks(connection)
        connection.commit()

    connection, summary, stage, identity = _prepare(
        populate,
        captured_at_ms=SHARED_NOW,
    )
    try:
        connection.execute(
            """UPDATE temp.ge_blr_stage
                  SET state_blob = CAST(
                    json_set(CAST(state_blob AS TEXT), '$.summary', json('{}')) AS BLOB
                  )
                WHERE kind_rank = 5
                  AND json_extract(CAST(state_blob AS TEXT), '$.action') = 'delete'"""
        ).close()
        stage._allowed_total_changes = connection.total_changes
        report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_BINDING", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_current_revision_mirror_divergence_collapses_to_one_binding_witness() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        record = _insert_stream_record(
            connection,
            "tenant-mirror",
            "stream-mirror",
            "record-mirror-0",
        )
        revision_checkpoint = _checkpoint(
            "scope-mirror",
            "checkpoint-mirror",
            "stream-mirror",
            record,
            value="revision-value",
        )
        current_checkpoint = _checkpoint(
            "scope-mirror",
            "checkpoint-mirror",
            "stream-mirror",
            record,
            value="current-value",
            created_at=BINDING_CURRENT_CREATED_AT,
        )
        _insert_revision(
            connection,
            "tenant-mirror",
            1,
            revision_checkpoint,
            recorded_at_ms=SHARED_NOW - 1,
        )
        _insert_current(connection, "tenant-mirror", 1, current_checkpoint)
        _normalize_shared_base_clocks(connection)
        connection.commit()

    connection, summary, stage, identity = _prepare(
        populate,
        captured_at_ms=SHARED_NOW,
    )
    try:
        report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_BINDING", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_current_and_latest_revision_clock_must_match_exactly() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        record = _insert_stream_record(
            connection,
            "tenant-clock",
            "stream-clock",
            "record-clock-0",
        )
        checkpoint = _checkpoint(
            "scope-clock",
            "checkpoint-clock",
            "stream-clock",
            record,
        )
        _insert_revision(
            connection,
            "tenant-clock",
            1,
            checkpoint,
            recorded_at_ms=SHARED_NOW - 1,
        )
        _insert_current(connection, "tenant-clock", 1, checkpoint)
        _normalize_shared_base_clocks(connection)
        connection.commit()

    connection, summary, stage, identity = _prepare(
        populate,
        captured_at_ms=SHARED_NOW,
    )
    try:
        report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_BINDING", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_zero_history_current_is_unexpected_but_not_stale() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        _populate_unexpected_currents(connection, 1)

    connection, summary, stage, identity = _prepare(
        populate,
        captured_at_ms=SHARED_NOW,
    )
    try:
        report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == (
            SQLiteCheckpointReconciliationDiagnostic(
                "BLR_CHECKPOINT_CURRENT_UNEXPECTED", 1, False
            ),
        )
    finally:
        _cleanup(connection, stage)


def test_latest_revision_is_partitioned_by_checkpoint_id() -> None:
    def populate(connection: SQLiteV1BaselineConnectionOwner) -> None:
        record = _insert_stream_record(
            connection,
            "tenant-partition",
            "stream-partition",
            "record-partition-0",
        )
        checkpoint_a = _checkpoint(
            "scope-partition",
            "checkpoint-a",
            "stream-partition",
            record,
        )
        checkpoint_b = _checkpoint(
            "scope-partition",
            "checkpoint-b",
            "stream-partition",
            record,
        )
        _insert_revision(connection, "tenant-partition", 1, checkpoint_a)
        _insert_revision(connection, "tenant-partition", 2, checkpoint_b)
        _insert_current(connection, "tenant-partition", 1, checkpoint_a)
        _insert_current(connection, "tenant-partition", 2, checkpoint_b)
        _normalize_shared_base_clocks(connection)
        connection.commit()

    connection, summary, stage, identity = _prepare(
        populate,
        captured_at_ms=SHARED_NOW,
    )
    try:
        report = run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert report.diagnostics == ()
    finally:
        _cleanup(connection, stage)


def test_checkpoint_campaign_requires_completed_stream_record_campaign() -> None:
    connection = database()
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    summary = capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
    _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
    identity = _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
    try:
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_equal_projection_replacement_and_second_run_are_terminal() -> None:
    connection, summary, stage, identity = _prepare()
    try:
        replacement = replace(identity)
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            SQLiteV1CheckpointInvariantCampaign(summary, replacement, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)

    connection, summary, stage, identity = _prepare()
    try:
        campaign = SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
        campaign.run()
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            campaign.run()
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_abandonment_is_terminal() -> None:
    connection, summary, stage, identity = _prepare()
    try:
        campaign = SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
        with pytest.raises(ValueError, match="ITERATOR_INCOMPLETE"):
            campaign.dispose()
        assert campaign.state == "poisoned"
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("rule", SQLITE_CHECKPOINT_RULES, ids=lambda rule: rule.rule_id)
def test_dml_after_each_rule_cursor_creation_is_rejected_and_cursor_is_closed(
    monkeypatch: pytest.MonkeyPatch,
    rule: object,
) -> None:
    checked_rule = rule
    assert hasattr(checked_rule, "sql")
    target_sql = checked_rule.sql
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    target_closed = False
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal injected, target
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql and not injected:
            target = cursor
            injected = True
            mutation = original_execute(
                owner,
                "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
            )
            original_close(mutation)
        return cursor

    def close(cursor: _SQLiteCursorCapability) -> None:
        nonlocal target_closed
        if cursor is target:
            target_closed = True
        original_close(cursor)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            campaign.run()
        assert injected and target_closed
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("boundary", ["fetch", "close", "after-rule", "terminal"])
def test_dml_at_remaining_campaign_boundaries_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
    boundary: str,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None
    injected = False

    def inject() -> None:
        nonlocal injected
        if injected:
            return
        injected = True
        cursor = original_execute(
            connection,
            "UPDATE temp.ge_blr_stage SET state_blob = state_blob WHERE kind_rank = 0",
        )
        original_close(cursor)

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if target is None and sql == SQLITE_CHECKPOINT_RULES[0].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        row = original_fetchone(cursor)
        if boundary == "fetch" and cursor is target:
            inject()
        return row

    def close(cursor: _SQLiteCursorCapability) -> None:
        original_close(cursor)
        if boundary == "close" and cursor is target:
            inject()

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    if boundary == "after-rule":
        original_run_rule = SQLiteV1CheckpointInvariantCampaign._run_rule

        def run_rule(
            campaign_value: SQLiteV1CheckpointInvariantCampaign,
            rule_value: object,
        ) -> int:
            observed = original_run_rule(campaign_value, rule_value)  # type: ignore[arg-type]
            inject()
            return observed

        monkeypatch.setattr(SQLiteV1CheckpointInvariantCampaign, "_run_rule", run_rule)
    if boundary == "terminal":
        original_complete = SQLiteV1BaselineTempStage._complete_checkpoint_campaign

        def complete(
            stage_value: SQLiteV1BaselineTempStage,
            projection: BaselineProjectionIdentity,
            total_changes: int,
            session: object,
        ) -> None:
            inject()
            original_complete(stage_value, projection, total_changes, session)

        monkeypatch.setattr(
            SQLiteV1BaselineTempStage,
            "_complete_checkpoint_campaign",
            complete,
        )
    try:
        with pytest.raises(ValueError, match="UNEXPLAINED_WRITE"):
            campaign.run()
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_stage_dispose_finalizes_active_campaign_cursor(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
    cursor = connection.execute(SQLITE_CHECKPOINT_RULES[0].sql, (17,))
    stage._register_checkpoint_campaign_cursor(
        campaign._session,
        cursor,
        campaign._expected_total_changes,
    )
    original_close = _SQLiteCursorCapability.close
    closed = False

    def close(cursor_value: _SQLiteCursorCapability) -> None:
        nonlocal closed
        if cursor_value is cursor:
            closed = True
        original_close(cursor_value)

    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        stage.dispose()
        assert closed
        assert stage.state == "disposed"
        assert campaign.state == "poisoned"
    finally:
        connection.rollback()
        connection.close()


def test_active_campaign_cursor_close_failure_surfaces_after_catalog_cleanup(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
    cursor = connection.execute(SQLITE_CHECKPOINT_RULES[0].sql, (17,))
    stage._register_checkpoint_campaign_cursor(
        campaign._session,
        cursor,
        campaign._expected_total_changes,
    )
    original_close = _SQLiteCursorCapability.close

    def close(cursor_value: _SQLiteCursorCapability) -> None:
        original_close(cursor_value)
        if cursor_value is cursor:
            raise RuntimeError("hostile campaign cursor close")

    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError, match="STAGE_ITERATOR_INCOMPLETE"):
            stage.dispose()
        residue = connection.execute(
            "SELECT count(*) FROM temp.sqlite_schema "
            "WHERE substr(lower(name), 1, 7) = 'ge_blr_'"
        )
        try:
            assert residue.fetchone() == (0,)
        finally:
            residue.close()
    finally:
        connection.rollback()
        connection.close()


def test_primary_fetch_failure_is_not_replaced_by_cursor_close_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    original_close = _SQLiteCursorCapability.close
    target: _SQLiteCursorCapability | None = None

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CHECKPOINT_RULES[0].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        if cursor is target:
            raise RuntimeError("authoritative hostile fetch")
        return original_fetchone(cursor)

    def close(cursor: _SQLiteCursorCapability) -> None:
        original_close(cursor)
        if cursor is target:
            raise RuntimeError("secondary hostile close")

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    monkeypatch.setattr(_SQLiteCursorCapability, "close", close)
    try:
        with pytest.raises(ValueError) as raised:
            campaign.run()
        assert str(raised.value).startswith("BLR_CHECKPOINT_REVISION_GAP:")
        assert "close" not in str(raised.value)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_malformed_witness_marker_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    original_execute = SQLiteV1BaselineConnectionOwner.execute

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        if sql == SQLITE_CHECKPOINT_RULES[0].sql:
            return original_execute(owner, "SELECT 2")
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    try:
        with pytest.raises(ValueError) as raised:
            run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert str(raised.value).startswith("BLR_CHECKPOINT_REVISION_GAP:")
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_catalog_replacement_during_rule_fetch_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, summary, stage, identity = _prepare()
    campaign = SQLiteV1CheckpointInvariantCampaign(summary, identity, stage)
    original_execute = SQLiteV1BaselineConnectionOwner.execute
    original_fetchone = _SQLiteCursorCapability.fetchone
    target: _SQLiteCursorCapability | None = None
    injected = False

    def execute(
        owner: SQLiteV1BaselineConnectionOwner,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> _SQLiteCursorCapability:
        nonlocal target
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CHECKPOINT_RULES[0].sql:
            target = cursor
        return cursor

    def fetchone(cursor: _SQLiteCursorCapability) -> tuple[object, ...] | None:
        nonlocal injected
        row = original_fetchone(cursor)
        if cursor is target and not injected:
            injected = True
            replacement = original_execute(
                connection,
                "DROP INDEX temp.ge_blr_checkpoint_revisions_latest_idx",
            )
            replacement.close()
        return row

    monkeypatch.setattr(SQLiteV1BaselineConnectionOwner, "execute", execute)
    monkeypatch.setattr(_SQLiteCursorCapability, "fetchone", fetchone)
    try:
        with pytest.raises(ValueError, match=r"TRANSACTION_CHANGED|CATALOG"):
            campaign.run()
        assert injected
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("missing_side", ["common", "relation"])
def test_common_relation_disagreement_cannot_enter_campaign(missing_side: str) -> None:
    connection, summary, stage, identity = _prepare(
        _populate_shared_hostile_relations,
        captured_at_ms=SHARED_NOW,
    )
    try:
        if missing_side == "common":
            table = "ge_blr_stage"
            predicate = "kind_rank = 4"
        else:
            table = "ge_blr_checkpoint_current"
            predicate = "1 = 1"
        connection.execute(f"DELETE FROM temp.{table} WHERE {predicate}").close()
        stage._allowed_total_changes = connection.total_changes
        with pytest.raises(ValueError, match=r"STAGE_(COUNT|KEY_COVERAGE)"):
            run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)
