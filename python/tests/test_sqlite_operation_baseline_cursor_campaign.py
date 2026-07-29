from __future__ import annotations

import asyncio
import copy
import gc
import hashlib
import json
import sqlite3
from contextlib import suppress
from importlib.resources import files
from pathlib import Path
from typing import Any, cast

import pytest

import graph_engineering.sqlite_operation_baseline_cursor_campaign as campaign_module
import graph_engineering.sqlite_operation_baseline_cursor_stage_ownership as stage_ownership_module
import graph_engineering.sqlite_operation_baseline_stage as stage_module
from graph_engineering.canonical import canonical_bytes
from graph_engineering.cycle_store_provider import (
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    cycle_store_adapter_codec,
)
from graph_engineering.sqlite_cycle_store import SQLiteCycleStoreProvider
from graph_engineering.sqlite_operation_baseline_checkpoint_invariants import (
    run_sqlite_v1_checkpoint_invariant_campaign,
)
from graph_engineering.sqlite_operation_baseline_cooperation import (
    _stream_sqlite_v1_baseline_source_into_temp_stage,
)
from graph_engineering.sqlite_operation_baseline_cursor_campaign import (
    _CANCELLATION_BOUNDARY_LABELS,
    _ROW_MARKER_SQL,
    SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
    SQLITE_CURSOR_COUNT_MARKER_SQL,
    SQLITE_CURSOR_EVENT_LOOKUP_SQL,
    SQLITE_CURSOR_SEAL_INSERT_SQL,
    SQLITE_CURSOR_SEAL_PROJECTION_SQL,
    SQLITE_CURSOR_TEMP_OBJECT_COUNT_SQL,
    SQLiteCursorCampaignCancelledError,
    SQLiteCursorPreRebindComplete,
    _create_sqlite_cursor_campaign_cancellation,
    _normalized_sql_sha256,
    _run_sqlite_cursor_pre_rebind_campaign,
    _SQLiteCursorCampaignResourceProbe,
    accepts_sqlite_cursor_query_plan,
)
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    SQLiteCursorImmutableSealReceipt,
    SQLiteCursorSealAccumulator,
    decode_sqlite_v1_cursor_seal_row,
    seal_sqlite_v1_cursor_rows,
)
from graph_engineering.sqlite_operation_baseline_cursor_ownership import (
    SQLITE_CURSOR_MAIN_PROJECTION_SQL,
    SQLiteCursorPreRebindReceipt,
    SQLiteCursorPreRebindReceiptCandidate,
    SQLiteCursorPreRebindReceiptIssuer,
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
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
from tests.test_sqlite_operation_baseline_checkpoint_invariants import _cleanup
from tests.test_sqlite_operation_baseline_cursor_source_fence import _prepared_fence
from tests.test_sqlite_operation_baseline_legacy_invariants import NOW, _prepare_legacy
from tests.test_sqlite_operation_baseline_source import add_checkpoint_history

_CASE = cast(
    dict[str, Any],
    json.loads(
        (
            Path(__file__).resolve().parents[2]
            / "spec"
            / "conformance"
            / "sqlite-cursor-pre-rebind-v1.case.json"
        ).read_text(encoding="utf-8")
    ),
)

_LIFECYCLE_OUTCOMES = {
    cast(str, scenario["name"]): cast(str, scenario["outcome"])
    for scenario in cast(list[dict[str, object]], _CASE["lifecycleObligations"]["scenarios"])
}
_HOSTILE_CASES = {
    cast(str, scenario["name"]): scenario
    for scenario in cast(list[dict[str, object]], _CASE["hostileObligations"]["scenarios"])
}


def _assert_lifecycle_case(case_id: str, outcome: str) -> None:
    assert _LIFECYCLE_OUTCOMES[case_id] == outcome


def _assert_hostile_case(case_id: str, vector: tuple[int, ...]) -> None:
    scenario = _HOSTILE_CASES[case_id]
    assert scenario["outcome"] == "diagnosed"
    assert tuple(cast(list[int], scenario["vector"])) == vector


@pytest.fixture(autouse=True)
def _collect_weak_campaign_authorities() -> Any:
    yield
    gc.collect()


def _receipt_for_rows(
    summary: Any,
    identity: Any,
    rows: tuple[tuple[object, ...], ...],
) -> SQLiteCursorPreRebindReceipt:
    envelope = summary.source_envelope
    seal = seal_sqlite_v1_cursor_rows(
        sorted(rows, key=lambda row: (cast(str, row[1]).encode(), cast(str, row[0]).encode())),
        expected_count=len(rows),
        source_descriptor_hash=str(envelope["sourceDescriptorHash"]),
        source_schema_identity_sha256=str(envelope["sourceSchemaIdentitySha256"]),
    )
    return _receipt_for_seal(summary, identity, seal)


def _receipt_for_seal(
    summary: Any,
    identity: Any,
    seal: SQLiteCursorImmutableSealReceipt,
) -> SQLiteCursorPreRebindReceipt:
    tenant = create_sqlite_cursor_ownership_capability("tenant", bytes(32))
    source_stage = create_sqlite_cursor_ownership_capability("source-stage", bytes([17]) * 32)
    campaign = create_sqlite_cursor_ownership_capability("campaign", bytes([34]) * 32)
    connection = create_sqlite_cursor_ownership_capability("connection", bytes([51]) * 32)
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


def _streaming_receipt_for_connection(
    summary: Any,
    identity: Any,
    connection: Any,
    expected_count: int,
) -> SQLiteCursorPreRebindReceipt:
    envelope = summary.source_envelope
    accumulator = SQLiteCursorSealAccumulator(
        expected_count,
        str(envelope["sourceDescriptorHash"]),
        str(envelope["sourceSchemaIdentitySha256"]),
    )
    seal_sql = SQLITE_CURSOR_MAIN_PROJECTION_SQL.replace(
        "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY",
        "ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY",
    )
    cursor = connection.execute(seal_sql)
    observed = 0
    try:
        while True:
            row = cursor.fetchone()
            if row is None:
                break
            accumulator.append(decode_sqlite_v1_cursor_seal_row(row))
            observed += 1
    finally:
        cursor.close()
    assert observed == expected_count
    return _receipt_for_seal(summary, identity, accumulator.finish())


def _read_all_rows(connection: Any, sql: str) -> tuple[tuple[object, ...], ...]:
    cursor = connection.execute(sql)
    rows: list[tuple[object, ...]] = []
    try:
        while True:
            row = cursor.fetchone()
            if row is None:
                return tuple(rows)
            rows.append(row)
    finally:
        cursor.close()


def _assert_terminal_fault_postconditions(
    stage: Any,
    error: BaseException,
    *,
    permanent_before: tuple[tuple[object, ...], ...],
    connection: Any,
) -> None:
    assert stage.state == "poisoned"
    assert stage._cursor_campaign_state == "poisoned"
    assert stage._cursor_campaign_active_cursor is None
    assert stage._cursor_campaign_active_role is None
    assert stage._cursor_campaign_active_rule_index is None
    assert _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL) == permanent_before
    rendered = str(error)
    assert "tenant-a" not in rendered
    assert "immutableRoot" not in rendered
    assert "receipt" not in rendered.lower()
    assert "b" * 64 not in rendered


def _prepared_event_empty_fence(
    *, scope_extra: bool = False, count: int = 1
) -> tuple[Any, Any, Any, Any, SQLiteCursorPreRebindReceipt]:
    rows: list[tuple[object, ...]] = []

    def populate(connection: Any) -> None:
        descriptor = _CASE["semanticVectors"][1]["identities"]["descriptorHash"]
        schema = _CASE["semanticVectors"][1]["identities"]["schemaIdentitySha256"]
        # Use the real repository identities rather than the fixture's abstract identities.
        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        identity_cursor.close()
        request_scope = {
            "contractVersion": "cycle-store-provider/v1alpha1",
            "pageSize": 64,
            "streamId": "stream-a",
        }
        if scope_extra:
            request_scope["extra"] = True
        for index in range(count):
            row = (
                "tenant-a",
                f"{index + 1:064x}",
                "event",
                "b" * 64,
                "c" * 64,
                "stream-a",
                None,
                canonical_bytes(request_scope),
                64,
                0,
                -1,
                None,
                descriptor,
                schema,
                canonical_bytes({"exists": False, "recordHash": None, "sequence": -1}),
                500,
                1500,
                None,
            )
            connection.execute(
                "INSERT INTO ge_cycle_cursors VALUES "
                "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                row,
            ).close()
            rows.append(row)
        connection.commit()

    connection, summary, stage, identity = _prepare_legacy(populate)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    return connection, summary, stage, identity, _receipt_for_rows(summary, identity, tuple(rows))


def _prepared_replaced_index_fence() -> tuple[Any, Any, Any, Any, SQLiteCursorPreRebindReceipt]:
    def populate(connection: Any) -> None:
        connection.execute("DROP INDEX ge_cycle_records_stream_sequence_hash_uq").close()
        connection.execute(
            "CREATE UNIQUE INDEX ge_cycle_records_stream_sequence_hash_uq "
            "ON ge_cycle_records (tenant_id, stream_id, sequence, record_hash DESC)"
        ).close()
        connection.commit()

    connection, summary, stage, identity = _prepare_legacy(populate)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    return connection, summary, stage, identity, _receipt_for_rows(summary, identity, ())


def _prepared_checkpoint_fence(
    *,
    include_event: bool,
) -> tuple[Any, Any, Any, Any, SQLiteCursorPreRebindReceipt]:
    rows: list[tuple[object, ...]] = []

    def populate(connection: Any) -> None:
        checkpoint = add_checkpoint_history(connection)
        for revision in range(3, 10):
            connection.execute(
                "INSERT INTO ge_cycle_checkpoint_revisions "
                "(tenant_id, checkpoint_scope, revision, checkpoint_id, action, "
                "summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at, "
                "value_hash, value_bytes, recorded_at_ms) "
                "VALUES ('tenant-a', 'scope-a', ?, 'checkpoint-a', 'delete', "
                "NULL, NULL, NULL, NULL, NULL, NULL, 1000)",
                (revision,),
            ).close()
        summary_value = {key: value for key, value in checkpoint.items() if key != "value"}
        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        identity_cursor.close()
        checkpoint_row = (
            "tenant-a",
            "b" * 64,
            "checkpoint",
            "b" * 64,
            "c" * 64,
            None,
            "scope-a",
            canonical_bytes(
                {
                    "checkpointScope": "scope-a",
                    "contractVersion": "cycle-store-provider/v1alpha1",
                    "pageSize": 16,
                }
            ),
            16,
            1,
            None,
            None,
            descriptor,
            schema,
            canonical_bytes([summary_value]),
            500,
            1500,
            None,
        )
        rows.append(checkpoint_row)
        if include_event:
            rows.append(
                (
                    "tenant-z",
                    "a" * 64,
                    "event",
                    "b" * 64,
                    "c" * 64,
                    "stream-z",
                    None,
                    canonical_bytes(
                        {
                            "contractVersion": "cycle-store-provider/v1alpha1",
                            "pageSize": 64,
                            "streamId": "stream-z",
                        }
                    ),
                    64,
                    0,
                    -1,
                    None,
                    descriptor,
                    schema,
                    canonical_bytes({"exists": False, "recordHash": None, "sequence": -1}),
                    500,
                    1500,
                    None,
                )
            )
        for row in rows:
            connection.execute(
                "INSERT INTO ge_cycle_cursors VALUES "
                "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                row,
            ).close()
        connection.commit()

    connection, summary, stage, identity = _prepare_legacy(populate)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    return connection, summary, stage, identity, _receipt_for_rows(summary, identity, tuple(rows))


def _prepared_aggregate_diagnosed_fence() -> tuple[
    Any, Any, Any, Any, SQLiteCursorPreRebindReceipt, str
]:
    receipt_rows: list[tuple[object, ...]] = []
    shape_token = f"{1:064x}"

    def populate(connection: Any) -> None:
        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        identity_cursor.close()
        clean_request = canonical_bytes(
            {
                "contractVersion": "cycle-store-provider/v1alpha1",
                "pageSize": 64,
                "streamId": "stream-a",
            }
        )
        clean_snapshot = canonical_bytes({"exists": False, "recordHash": None, "sequence": -1})
        source_rows: list[tuple[object, ...]] = []
        for index in range(1, 8):
            clean = (
                "tenant-a",
                f"{index:064x}",
                "event",
                "b" * 64,
                "c" * 64,
                "stream-a",
                None,
                clean_request,
                64,
                0,
                -1,
                None,
                descriptor,
                schema,
                clean_snapshot,
                500,
                1500,
                None,
            )
            hostile = list(clean)
            if index == 2:
                hostile[3] = "bad"
                hostile[7] = canonical_bytes(
                    {
                        "contractVersion": "cycle-store-provider/v1alpha1",
                        "extra": True,
                        "pageSize": 64,
                        "streamId": "stream-a",
                    }
                )
            elif index == 3:
                hostile[7] = b"\xff{}"
            elif index == 4:
                hostile[9] = 1
            elif index == 5:
                hostile[15] = NOW + 1
                hostile[16] = NOW + 1_000
            elif index == 6:
                hostile[12] = "d" * 64
            elif index == 7:
                hostile[14] = canonical_bytes({"exists": True, "recordHash": None, "sequence": -1})
            source_rows.append(tuple(hostile))
            receipt_rows.append(clean)

        checkpoint_request = canonical_bytes(
            {
                "checkpointScope": "scope-a",
                "contractVersion": "cycle-store-provider/v1alpha1",
                "pageSize": 16,
            }
        )
        checkpoint_clean = (
            "tenant-a",
            "8" * 64,
            "checkpoint",
            "b" * 64,
            "c" * 64,
            None,
            "scope-a",
            checkpoint_request,
            16,
            0,
            None,
            None,
            descriptor,
            schema,
            canonical_bytes([]),
            500,
            1500,
            None,
        )
        checkpoint_hostile = list(checkpoint_clean)
        checkpoint_hostile[14] = canonical_bytes([{"not": "a checkpoint summary"}])
        source_rows.append(tuple(checkpoint_hostile))
        receipt_rows.append(checkpoint_clean)

        connection.execute("PRAGMA ignore_check_constraints = ON").close()
        for row in source_rows:
            connection.execute(
                "INSERT INTO ge_cycle_cursors VALUES "
                "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                row,
            ).close()
        connection.execute("PRAGMA ignore_check_constraints = OFF").close()
        connection.commit()

    connection, summary, stage, identity = _prepare_legacy(populate)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    return (
        connection,
        summary,
        stage,
        identity,
        _receipt_for_rows(summary, identity, tuple(receipt_rows)),
        shape_token,
    )


def _prepared_nonlexical_aggregate_fence() -> tuple[
    Any,
    Any,
    Any,
    Any,
    SQLiteCursorPreRebindReceipt,
    tuple[tuple[object, ...], ...],
]:
    connection, summary, stage, identity = _prepare_legacy()
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    envelope = summary.source_envelope
    descriptor = cast(str, envelope["sourceDescriptorHash"])
    schema = cast(str, envelope["sourceSchemaIdentitySha256"])
    clean_request = canonical_bytes(
        {
            "contractVersion": "cycle-store-provider/v1alpha1",
            "pageSize": 1,
            "streamId": "stream-a",
        }
    )
    clean_snapshot = canonical_bytes({"exists": False, "recordHash": None, "sequence": -1})

    def clean_row(ordinal: int) -> tuple[object, ...]:
        return (
            "tenant-a",
            f"{ordinal:064x}",
            "event",
            "b" * 64,
            "c" * 64,
            "stream-a",
            None,
            clean_request,
            1,
            0,
            -1,
            None,
            descriptor,
            schema,
            clean_snapshot,
            500,
            1500,
            None,
        )

    checkpoint_snapshot = canonical_bytes(
        [
            {
                "boundRecordHash": "d" * 64,
                "boundSequence": 6,
                "checkpointId": "cp-a",
                "checkpointScope": "checkpoint-scope",
                "createdAt": "2026-07-28T00:00:00Z",
                "streamId": "stream-alpha",
                "valueBytes": 2,
                "valueHash": "a" * 64,
            }
        ]
    )

    def rule10(values: list[object]) -> None:
        values[2] = "checkpoint"
        values[5] = None
        values[6] = "checkpoint-scope"
        values[7] = canonical_bytes(
            {
                "checkpointScope": "checkpoint-scope",
                "contractVersion": "cycle-store-provider/v1alpha1",
                "pageSize": 1,
            }
        )
        values[9] = 1
        values[10] = None
        values[11] = None
        values[14] = checkpoint_snapshot

    groups: tuple[tuple[int, Any], ...] = (
        (10, rule10),
        (3, lambda values: values.__setitem__(7, b"\xff\xfe")),
        (8, lambda values: values.__setitem__(12, bytes(32))),
        (1, lambda values: values.__setitem__(3, "bad")),
        (6, lambda values: values.__setitem__(12, "0" * 64)),
        (
            2,
            lambda values: values.__setitem__(
                7,
                canonical_bytes(
                    {
                        "contractVersion": "cycle-store-provider/v1alpha1",
                        "extra": True,
                        "pageSize": 1,
                        "streamId": cast(str, values[5]),
                    }
                ),
            ),
        ),
        (
            9,
            lambda values: values.__setitem__(
                14, canonical_bytes({"exists": True, "recordHash": None, "sequence": -1})
            ),
        ),
        (4, lambda values: values.__setitem__(9, 1)),
        (
            5,
            lambda values: (
                values.__setitem__(15, NOW + 1),
                values.__setitem__(16, NOW + 2),
            ),
        ),
    )
    physical_rows: list[tuple[object, ...]] = []
    ordinal = 0
    for count, mutate in groups:
        for _index in range(count):
            ordinal += 1
            values = list(clean_row(ordinal))
            mutate(values)
            physical_rows.append(tuple(values))
    receipt_rows = tuple(clean_row(index) for index in range(1, len(physical_rows)))
    receipt = _receipt_for_rows(summary, identity, receipt_rows)
    return connection, summary, stage, identity, receipt, tuple(physical_rows)


def _prepared_isolated_rule_fence(
    rule_index: int,
) -> tuple[Any, Any, Any, Any, SQLiteCursorPreRebindReceipt, tuple[object, ...]]:
    connection, summary, stage, identity = _prepare_legacy()
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    envelope = summary.source_envelope
    descriptor = cast(str, envelope["sourceDescriptorHash"])
    schema = cast(str, envelope["sourceSchemaIdentitySha256"])
    clean = (
        "tenant-a",
        "1" * 64,
        "event",
        "b" * 64,
        "c" * 64,
        "stream-a",
        None,
        canonical_bytes(
            {
                "contractVersion": "cycle-store-provider/v1alpha1",
                "pageSize": 1,
                "streamId": "stream-a",
            }
        ),
        1,
        0,
        -1,
        None,
        descriptor,
        schema,
        canonical_bytes({"exists": False, "recordHash": None, "sequence": -1}),
        500,
        1500,
        None,
    )
    hostile = list(clean)
    if rule_index == 0:
        hostile[3] = "bad"
    elif rule_index == 1:
        hostile[7] = canonical_bytes(
            {
                "contractVersion": "cycle-store-provider/v1alpha1",
                "extra": True,
                "pageSize": 1,
                "streamId": "stream-a",
            }
        )
    elif rule_index == 2:
        hostile[7] = b"\xff\xfe"
    elif rule_index == 3:
        hostile[9] = 1
    elif rule_index == 4:
        hostile[15] = NOW + 1
        hostile[16] = NOW + 2
    elif rule_index == 5:
        hostile[12] = "0" * 64
    elif rule_index == 7:
        hostile[12] = bytes(32)
    elif rule_index == 8:
        hostile[14] = canonical_bytes({"exists": True, "recordHash": None, "sequence": -1})
    elif rule_index == 9:
        hostile[2] = "checkpoint"
        hostile[5] = None
        hostile[6] = "checkpoint-scope"
        hostile[7] = canonical_bytes(
            {
                "checkpointScope": "checkpoint-scope",
                "contractVersion": "cycle-store-provider/v1alpha1",
                "pageSize": 1,
            }
        )
        hostile[9] = 1
        hostile[10] = None
        hostile[11] = None
        hostile[14] = canonical_bytes(
            [
                {
                    "boundRecordHash": "d" * 64,
                    "boundSequence": 6,
                    "checkpointId": "cp-a",
                    "checkpointScope": "checkpoint-scope",
                    "createdAt": "2026-07-28T00:00:00Z",
                    "streamId": "stream-alpha",
                    "valueBytes": 2,
                    "valueHash": "a" * 64,
                }
            ]
        )
    receipt_rows = () if rule_index == 6 else (clean,)
    return (
        connection,
        summary,
        stage,
        identity,
        _receipt_for_rows(summary, identity, receipt_rows),
        tuple(hostile),
    )


def _prepared_pristine_boundary_fence(
    case_id: str,
) -> tuple[Any, Any, Any, Any, SQLiteCursorPreRebindReceipt]:
    rows: list[tuple[object, ...]] = []

    def populate(connection: Any) -> None:
        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        identity_cursor.close()
        ordinals = (1, 2) if case_id == "same-token-two-tenants" else (1,)
        for ordinal in ordinals:
            tenant = f"tenant-{ordinal}"
            stream = f"stream-{ordinal}"
            page_size = 256 if case_id == "page-size-256" else 1
            token = "a" * 64 if case_id == "same-token-two-tenants" else f"{ordinal:064x}"
            created_at = 500
            expires_at = 900 if case_id == "expired-locally-valid" else 1_500
            consumed_at = created_at if case_id == "consumed-clock-valid" else None
            row = (
                tenant,
                token,
                "event",
                "b" * 64,
                "c" * 64,
                stream,
                None,
                canonical_bytes(
                    {
                        "contractVersion": "cycle-store-provider/v1alpha1",
                        "pageSize": page_size,
                        "streamId": stream,
                    }
                ),
                page_size,
                0,
                -1,
                None,
                descriptor,
                schema,
                canonical_bytes({"exists": False, "recordHash": None, "sequence": -1}),
                created_at,
                expires_at,
                consumed_at,
            )
            connection.execute(
                "INSERT INTO ge_cycle_cursors VALUES "
                "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                row,
            ).close()
            rows.append(row)
        connection.commit()

    connection, summary, stage, identity = _prepare_legacy(populate)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    return connection, summary, stage, identity, _receipt_for_rows(summary, identity, tuple(rows))


def _prepared_retained_history_fence(
    case_id: str = "combined",
) -> tuple[Any, Any, Any, Any, SQLiteCursorPreRebindReceipt]:
    rows: list[tuple[object, ...]] = []

    def populate(connection: Any) -> None:
        history_now = 1_000
        if case_id == "later-event-append-allowed":
            original_record = create_cycle_store_record(
                record_id="record-a",
                sequence=0,
                previous_record_hash=None,
                value={"event-anchor": True},
            )
            connection.execute(
                "INSERT INTO ge_cycle_streams "
                "(tenant_id, stream_id, tail_sequence, tail_record_hash, "
                "created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    "tenant-a",
                    "stream-a",
                    0,
                    original_record["recordHash"],
                    history_now,
                    history_now,
                ),
            ).close()
            connection.execute(
                "INSERT INTO ge_cycle_records "
                "(tenant_id, stream_id, sequence, record_id, previous_record_hash, "
                "value_hash, value_bytes, value_blob, record_hash, record_blob, committed_at_ms) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "tenant-a",
                    "stream-a",
                    original_record["sequence"],
                    original_record["recordId"],
                    original_record["previousRecordHash"],
                    original_record["valueHash"],
                    original_record["valueBytes"],
                    canonical_bytes(original_record["value"]),
                    original_record["recordHash"],
                    canonical_bytes(original_record),
                    history_now,
                ),
            ).close()
            original_checkpoint = {"boundRecordHash": original_record["recordHash"]}
            original_summary: dict[str, object] = {}
        else:
            original_checkpoint = add_checkpoint_history(connection)
            original_summary = {
                key: value for key, value in original_checkpoint.items() if key != "value"
            }
        if case_id in {"combined", "later-event-append-allowed"}:
            later_record = create_cycle_store_record(
                record_id="record-later",
                sequence=1,
                previous_record_hash=cast(str, original_checkpoint["boundRecordHash"]),
                value={"later": True},
            )
            connection.execute(
                "INSERT INTO ge_cycle_records "
                "(tenant_id, stream_id, sequence, record_id, previous_record_hash, "
                "value_hash, value_bytes, value_blob, record_hash, record_blob, committed_at_ms) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "tenant-a",
                    "stream-a",
                    later_record["sequence"],
                    later_record["recordId"],
                    later_record["previousRecordHash"],
                    later_record["valueHash"],
                    later_record["valueBytes"],
                    canonical_bytes(later_record["value"]),
                    later_record["recordHash"],
                    canonical_bytes(later_record),
                    history_now,
                ),
            ).close()
            connection.execute(
                "UPDATE ge_cycle_streams SET tail_sequence = 1, tail_record_hash = ?, "
                "updated_at_ms = ? WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'",
                (later_record["recordHash"], history_now),
            ).close()
        else:
            later_record = None

        later_checkpoint = create_cycle_store_checkpoint(
            checkpoint_scope="scope-a",
            checkpoint_id="checkpoint-a",
            stream_id="stream-a",
            bound_sequence=1 if later_record is not None else 0,
            bound_record_hash=(
                cast(str, later_record["recordHash"])
                if later_record is not None
                else cast(str, original_checkpoint["boundRecordHash"])
            ),
            created_at="2026-07-28T00:00:09Z",
            value=9,
        )
        later_summary = {key: value for key, value in later_checkpoint.items() if key != "value"}
        later_summary_blob = cycle_store_adapter_codec.encode_ledger_result(
            "save-checkpoint", later_summary
        )
        if case_id in {"combined", "later-current-checkpoint-mutation-allowed"}:
            for revision in range(3, 10):
                connection.execute(
                    "INSERT INTO ge_cycle_checkpoint_revisions "
                    "(tenant_id, checkpoint_scope, revision, checkpoint_id, action, "
                    "summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at, "
                    "value_hash, value_bytes, recorded_at_ms) "
                    "VALUES ('tenant-a', 'scope-a', ?, 'checkpoint-a', 'delete', "
                    "NULL, NULL, NULL, NULL, NULL, NULL, ?)",
                    (revision, history_now),
                ).close()
            connection.execute(
                "INSERT INTO ge_cycle_checkpoint_revisions "
                "(tenant_id, checkpoint_scope, revision, checkpoint_id, action, "
                "summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at, "
                "value_hash, value_bytes, recorded_at_ms) "
                "VALUES ('tenant-a', 'scope-a', 11, 'checkpoint-a', 'delete', "
                "NULL, NULL, NULL, NULL, NULL, NULL, ?)",
                (history_now,),
            ).close()
            connection.execute(
                "INSERT INTO ge_cycle_checkpoint_revisions "
                "(tenant_id, checkpoint_scope, revision, checkpoint_id, action, "
                "summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at, "
                "value_hash, value_bytes, recorded_at_ms) "
                "VALUES ('tenant-a', 'scope-a', 12, 'checkpoint-a', 'put', ?, ?, ?, ?, ?, ?, ?)",
                (
                    later_summary_blob,
                    later_checkpoint["boundSequence"],
                    later_checkpoint["boundRecordHash"],
                    later_checkpoint["createdAt"],
                    later_checkpoint["valueHash"],
                    later_checkpoint["valueBytes"],
                    history_now,
                ),
            ).close()
            connection.execute(
                "UPDATE ge_cycle_checkpoints SET stream_id = ?, bound_sequence = ?, "
                "bound_record_hash = ?, created_at = ?, value_hash = ?, value_bytes = ?, "
                "value_blob = ?, checkpoint_blob = ?, summary_blob = ?, "
                "checkpoint_revision = 12, committed_at_ms = ? "
                "WHERE tenant_id = 'tenant-a' AND checkpoint_scope = 'scope-a' "
                "AND checkpoint_id = 'checkpoint-a'",
                (
                    later_checkpoint["streamId"],
                    later_checkpoint["boundSequence"],
                    later_checkpoint["boundRecordHash"],
                    later_checkpoint["createdAt"],
                    later_checkpoint["valueHash"],
                    later_checkpoint["valueBytes"],
                    canonical_bytes(later_checkpoint["value"]),
                    canonical_bytes(later_checkpoint),
                    later_summary_blob,
                    history_now,
                ),
            ).close()

        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        identity_cursor.close()
        rows.extend(
            (
                (
                    "tenant-a",
                    "a" * 64,
                    "event",
                    "b" * 64,
                    "c" * 64,
                    "stream-a",
                    None,
                    canonical_bytes(
                        {
                            "contractVersion": "cycle-store-provider/v1alpha1",
                            "pageSize": 1,
                            "streamId": "stream-a",
                        }
                    ),
                    1,
                    0,
                    0,
                    original_checkpoint["boundRecordHash"],
                    descriptor,
                    schema,
                    canonical_bytes(
                        {
                            "exists": True,
                            "recordHash": original_checkpoint["boundRecordHash"],
                            "sequence": 0,
                        }
                    ),
                    500,
                    1500,
                    None,
                ),
                (
                    "tenant-a",
                    "b" * 64,
                    "checkpoint",
                    "b" * 64,
                    "c" * 64,
                    None,
                    "scope-a",
                    canonical_bytes(
                        {
                            "checkpointScope": "scope-a",
                            "contractVersion": "cycle-store-provider/v1alpha1",
                            "pageSize": 1,
                        }
                    ),
                    1,
                    1,
                    None,
                    None,
                    descriptor,
                    schema,
                    canonical_bytes([original_summary]),
                    500,
                    1500,
                    None,
                ),
            )
        )
        if case_id == "later-event-append-allowed":
            del rows[1:]
        elif case_id == "later-current-checkpoint-mutation-allowed":
            del rows[:1]
        for row in rows:
            connection.execute(
                "INSERT INTO ge_cycle_cursors VALUES "
                "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                row,
            ).close()
        connection.commit()

    connection, summary, stage, identity = _prepare_legacy(populate)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    return connection, summary, stage, identity, _receipt_for_rows(summary, identity, tuple(rows))


def _prepared_streaming_scale_fence(
    population: int,
) -> tuple[Any, Any, Any, Any, SQLiteCursorPreRebindReceipt]:
    def populate(connection: Any) -> None:
        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        identity_cursor.close()
        for index in range(1, population + 1):
            reverse = population - index + 1
            tenant = f"tenant-{reverse:04d}"
            stream = f"stream-{reverse:04d}"
            connection.execute(
                "INSERT INTO ge_cycle_cursors VALUES "
                "(?, ?, 'event', ?, ?, ?, NULL, ?, 1, 0, -1, NULL, ?, ?, ?, 500, 1500, NULL)",
                (
                    tenant,
                    f"{index:064x}",
                    "b" * 64,
                    "c" * 64,
                    stream,
                    canonical_bytes(
                        {
                            "contractVersion": "cycle-store-provider/v1alpha1",
                            "pageSize": 1,
                            "streamId": stream,
                        }
                    ),
                    descriptor,
                    schema,
                    canonical_bytes({"exists": False, "recordHash": None, "sequence": -1}),
                ),
            ).close()
        connection.commit()

    connection, summary, stage, identity = _prepare_legacy(populate)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    receipt = _streaming_receipt_for_connection(
        summary, identity, connection, expected_count=population
    )
    return connection, summary, stage, identity, receipt


def test_campaign_sql_is_literal_shared_fixture_contract() -> None:
    contract = _CASE["sqlContract"]
    actual = {
        "source": SQLITE_CURSOR_MAIN_PROJECTION_SQL,
        "insert": SQLITE_CURSOR_SEAL_INSERT_SQL,
        "seal": SQLITE_CURSOR_SEAL_PROJECTION_SQL,
        "countMarker": SQLITE_CURSOR_COUNT_MARKER_SQL,
        "eventLookup": SQLITE_CURSOR_EVENT_LOOKUP_SQL,
        "checkpointLookup": SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
    }
    for name, sql in actual.items():
        assert sql == contract[name]["sql"]
        assert _normalized_sql_sha256(sql) == contract[name]["sha256"]
    assert tuple(sql for sql in _ROW_MARKER_SQL if sql is not None) == tuple(
        "SELECT 1 AS violation_marker FROM temp.ge_blr_cursor_seal WHERE "
        f"{marker['flag']} = 0 ORDER BY token_hash COLLATE BINARY, "
        "tenant_id COLLATE BINARY LIMIT ?"
        for marker in contract["rowMarkers"]
    )


@pytest.mark.parametrize("lineage", ["fresh-v1-baseline", "alpha-v0-to-v1"])
def test_both_v1_lineages_have_exact_seven_object_campaign_catalog(lineage: str) -> None:
    migrations = files("graph_engineering._sqlite_migrations")
    connection = sqlite3.connect(":memory:")
    try:
        if lineage == "alpha-v0-to-v1":
            connection.executescript(
                migrations.joinpath("fixtures/alpha-v0.sql").read_text(encoding="utf-8")
            )
            connection.executescript(
                migrations.joinpath("0001-alpha-v0-to-v1.sql").read_text(encoding="utf-8")
            )
        else:
            connection.executescript(
                migrations.joinpath("schema-v1.sql").read_text(encoding="utf-8")
            )
        rows = connection.execute(
            campaign_module._SOURCE_CATALOG_SQL,
            campaign_module._SOURCE_CATALOG_NAMES,
        ).fetchall()
        assert len(rows) == 7
        for object_type, name, table_name, rootpage, sql in rows:
            expected_type, expected_table, expected_sql_hash = (
                campaign_module._SOURCE_CATALOG_IDENTITIES[name]
            )
            assert (object_type, table_name) == (expected_type, expected_table)
            assert type(rootpage) is int and rootpage > 0
            assert hashlib.sha256(sql.encode("utf-8")).hexdigest() == expected_sql_hash
    finally:
        connection.close()


def test_alpha_v0_to_v1_lineage_completes_full_empty_b2_campaign(tmp_path: Path) -> None:
    migrations = files("graph_engineering._sqlite_migrations")
    path = tmp_path / "alpha-v0-to-v1-b2.db"
    raw = sqlite3.connect(path)
    try:
        raw.executescript(migrations.joinpath("fixtures/alpha-v0.sql").read_text(encoding="utf-8"))
    finally:
        raw.close()

    provider = SQLiteCycleStoreProvider(path, initial_time="2026-07-27T00:00:05Z")
    asyncio.run(provider.close())

    connection = SQLiteV1BaselineConnectionOwner(str(path))
    configure_sqlite_v1_baseline_temp_storage(connection)
    connection.execute("BEGIN EXCLUSIVE").close()
    stage = create_sqlite_v1_baseline_temp_stage(connection)
    try:
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        assert summary.source_envelope["sourceMigrationLineageId"] == "alpha-v0-to-v1"
        _stream_sqlite_v1_baseline_source_into_temp_stage(summary, stage)
        identity = _project_ordered_sqlite_v1_baseline_temp_stage(summary, stage)
        assert (
            run_sqlite_v1_stream_record_invariant_campaign(summary, identity, stage).diagnostics
            == ()
        )
        assert (
            run_sqlite_v1_checkpoint_invariant_campaign(summary, identity, stage).diagnostics == ()
        )
        assert (
            run_sqlite_v1_lease_lock_hold_invariant_campaign(summary, identity, stage).diagnostics
            == ()
        )
        assert run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage).diagnostics == ()
        receipt = _receipt_for_rows(summary, identity, ())
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert type(outcome) is SQLiteCursorPreRebindComplete
        assert outcome.vector == (0,) * 10
        assert outcome.receipt is receipt
        assert outcome.projection_identity is identity
    finally:
        _cleanup(connection, stage)


def test_closed_eqp_predicate_rejects_extra_wrong_and_noncovering_plans() -> None:
    assert accepts_sqlite_cursor_query_plan(
        "source", SQLITE_CURSOR_MAIN_PROJECTION_SQL, ("SCAN main.ge_cycle_cursors",)
    )
    assert accepts_sqlite_cursor_query_plan("stage-insert", SQLITE_CURSOR_SEAL_INSERT_SQL, ())
    assert not accepts_sqlite_cursor_query_plan(
        "source",
        SQLITE_CURSOR_MAIN_PROJECTION_SQL,
        ("SCAN main.ge_cycle_cursors", "SEARCH main.ge_cycle_schema USING PRIMARY KEY"),
    )
    assert not accepts_sqlite_cursor_query_plan(
        "source", SQLITE_CURSOR_MAIN_PROJECTION_SQL, ("SCAN main.ge_cycle_records",)
    )
    assert not accepts_sqlite_cursor_query_plan(
        "source",
        SQLITE_CURSOR_MAIN_PROJECTION_SQL,
        ("SCAN main.ge_cycle_cursors", "USE TEMP B-TREE FOR ORDER BY"),
    )
    assert not accepts_sqlite_cursor_query_plan(
        "event-lookup",
        SQLITE_CURSOR_EVENT_LOOKUP_SQL,
        (
            "SEARCH main.ge_cycle_records USING INDEX "
            "ge_cycle_records_stream_sequence_hash_uq (tenant_id=?)",
        ),
    )
    assert not accepts_sqlite_cursor_query_plan(
        "event-lookup",
        SQLITE_CURSOR_EVENT_LOOKUP_SQL,
        (
            "SEARCH main.ge_cycle_records USING COVERING INDEX "
            "ge_cycle_records_range_idx (tenant_id=? AND stream_id=? AND sequence=?)",
        ),
    )
    assert not accepts_sqlite_cursor_query_plan(
        "checkpoint-lookup",
        SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
        (
            "SCAN main.ge_cycle_checkpoint_revisions USING INDEX "
            "ge_cycle_checkpoint_revisions_lookup_idx",
        ),
    )
    assert not accepts_sqlite_cursor_query_plan(
        "row-marker", cast(str, _ROW_MARKER_SQL[0]), ("SCAN temp.some_other_table",)
    )
    assert not accepts_sqlite_cursor_query_plan(
        "stage-insert", SQLITE_CURSOR_SEAL_INSERT_SQL, ("SCAN CONSTANT ROW",)
    )


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:second-run"])
def test_empty_real_campaign_completes_with_exact_receipt_and_is_one_shot(
    _b2_case: None,
) -> None:
    connection, _summary, stage, identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert type(outcome) is SQLiteCursorPreRebindComplete
        assert outcome.status == "pre-rebind-complete"
        assert outcome.receipt is receipt
        assert outcome.projection_identity is identity
        assert outcome.diagnostics == ()
        assert stage._cursor_campaign_state == "pre-rebind-complete"
        assert stage._cursor_campaign_receipt is receipt
        with pytest.raises(ValueError):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)
    del outcome, transfer, receipt, identity, stage, connection
    gc.collect()


def test_real_event_empty_campaign_recomputes_exact_a1_receipt() -> None:
    connection, _summary, stage, identity, receipt = _prepared_event_empty_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert type(outcome) is SQLiteCursorPreRebindComplete
        assert outcome.receipt is receipt
        assert outcome.projection_identity is identity
        assert outcome.vector == (0,) * 10
    finally:
        _cleanup(connection, stage)
    del outcome, transfer, receipt, identity, stage, connection
    gc.collect()


@pytest.mark.parametrize(
    "case_id",
    [
        "same-token-two-tenants",
        "page-size-one",
        "page-size-256",
        "consumed-clock-valid",
        "expired-locally-valid",
    ],
    ids=[
        "b2:same-token-two-tenants",
        "b2:page-size-one",
        "b2:page-size-256",
        "b2:consumed-clock-valid",
        "b2:expired-locally-valid",
    ],
)
def test_pristine_consumed_expired_page_and_composite_key_boundaries_complete(
    case_id: str,
) -> None:
    assert case_id in {
        cast(str, item["name"]) for item in _CASE["pristineObligations"]["scenarios"]
    }
    connection, _summary, stage, identity, receipt = _prepared_pristine_boundary_fence(case_id)
    try:
        physical = _read_all_rows(
            connection,
            "SELECT page_size, created_at_ms, expires_at_ms, consumed_at_ms "
            "FROM main.ge_cycle_cursors ORDER BY tenant_id COLLATE BINARY",
        )
        expected_physical = {
            "same-token-two-tenants": ((1, 500, 1_500, None), (1, 500, 1_500, None)),
            "page-size-one": ((1, 500, 1_500, None),),
            "page-size-256": ((256, 500, 1_500, None),),
            "consumed-clock-valid": ((1, 500, 1_500, 500),),
            "expired-locally-valid": ((1, 500, 900, None),),
        }[case_id]
        assert physical == expected_physical
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert type(outcome) is SQLiteCursorPreRebindComplete
        assert outcome.receipt is receipt
        assert outcome.projection_identity is identity
        assert outcome.vector == (0,) * 10
        if case_id == "same-token-two-tenants":
            cursor = connection.execute(
                "SELECT token_hash, tenant_id FROM temp.ge_blr_cursor_seal "
                "ORDER BY token_hash COLLATE BINARY, tenant_id COLLATE BINARY"
            )
            try:
                assert cursor.fetchone() == ("a" * 64, "tenant-1")
                assert cursor.fetchone() == ("a" * 64, "tenant-2")
                assert cursor.fetchone() is None
            finally:
                cursor.close()
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "case_id",
    ["later-event-append-allowed", "later-current-checkpoint-mutation-allowed"],
    ids=[
        "b2:later-event-append-allowed",
        "b2:later-current-checkpoint-mutation-allowed",
    ],
)
def test_retained_event_tail_and_checkpoint_put_survive_later_current_history(
    case_id: str,
) -> None:
    assert case_id in {
        cast(str, item["name"]) for item in _CASE["pristineObligations"]["scenarios"]
    }
    connection, _summary, stage, identity, receipt = _prepared_retained_history_fence(case_id)
    try:
        current_history = _read_all_rows(
            connection,
            "SELECT "
            "(SELECT tail_sequence FROM main.ge_cycle_streams "
            "WHERE tenant_id = 'tenant-a' AND stream_id = 'stream-a'), "
            "(SELECT checkpoint_revision FROM main.ge_cycle_checkpoints "
            "WHERE tenant_id = 'tenant-a' AND checkpoint_scope = 'scope-a' "
            "AND checkpoint_id = 'checkpoint-a'), "
            "(SELECT max(revision) FROM main.ge_cycle_checkpoint_revisions "
            "WHERE tenant_id = 'tenant-a' AND checkpoint_scope = 'scope-a'), "
            "(SELECT group_concat(kind, ',') FROM main.ge_cycle_cursors)",
        )
        assert (
            current_history
            == {
                "later-event-append-allowed": ((1, None, None, "event"),),
                "later-current-checkpoint-mutation-allowed": ((0, 12, 12, "checkpoint"),),
            }[case_id]
        )
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert type(outcome) is SQLiteCursorPreRebindComplete
        assert outcome.receipt is receipt
        assert outcome.projection_identity is identity
        assert outcome.vector == (0,) * 10
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("population", [128, 1_024])
def test_streams_large_conflicting_source_and_seal_orders_with_bounded_resources(
    population: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, identity, receipt = _prepared_streaming_scale_fence(population)
    expected_root = assert_sqlite_cursor_pre_rebind_receipt_provenance(
        receipt
    ).immutable_seal_receipt.immutable_root_sha256
    first = _read_all_rows(
        connection,
        "SELECT tenant_id, token_hash FROM ge_cycle_cursors "
        "ORDER BY tenant_id COLLATE BINARY, token_hash COLLATE BINARY LIMIT 1",
    )
    last = _read_all_rows(
        connection,
        "SELECT tenant_id, token_hash FROM ge_cycle_cursors "
        "ORDER BY tenant_id COLLATE BINARY DESC, token_hash COLLATE BINARY DESC LIMIT 1",
    )
    assert first == (("tenant-0001", f"{population:064x}"),)
    assert last == ((f"tenant-{population:04d}", f"{1:064x}"),)

    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    source_cursor_id: int | None = None
    source_fetches = 0
    maximum_active_cursors = 0
    eqp_prepares = 0
    resource_probe = _SQLiteCursorCampaignResourceProbe()

    def execute_with_resource_probe(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal source_cursor_id, eqp_prepares
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            source_cursor_id = id(cursor)
        if sql.startswith("EXPLAIN QUERY PLAN "):
            eqp_prepares += 1
        return cursor

    def fetchone_with_resource_probe(cursor: Any) -> Any:
        nonlocal source_fetches, maximum_active_cursors
        if id(cursor) == source_cursor_id:
            source_fetches += 1
            maximum_active_cursors = max(
                maximum_active_cursors,
                1 if stage._cursor_campaign_active_cursor is cursor else 0,
            )
        return original_fetchone(cursor)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_resource_probe)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_resource_probe)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        temp_pages_before = _read_all_rows(
            connection, "SELECT page_count FROM pragma_page_count('temp')"
        )[0][0]
        outcome = _run_sqlite_cursor_pre_rebind_campaign(
            connection,
            stage,
            receipt,
            transfer,
            _resource_probe=resource_probe,
        )
        temp_pages_after = _read_all_rows(
            connection, "SELECT page_count FROM pragma_page_count('temp')"
        )[0][0]
        assert type(outcome) is SQLiteCursorPreRebindComplete
        assert outcome.receipt is receipt
        assert outcome.projection_identity is identity
        assert outcome.vector == (0,) * 10
        assert source_fetches == population + 1
        assert maximum_active_cursors == 1
        assert eqp_prepares == 15
        assert resource_probe.maximum_live_raw_rows == 1
        assert resource_probe.maximum_live_decoded_snapshots == 1
        assert resource_probe.maximum_live_carriers == 1
        assert resource_probe.maximum_fetch_size == 1
        assert resource_probe.maximum_active_registered_cursors == 1
        assert resource_probe.maximum_nested_point_lookups == 1
        assert resource_probe.maximum_temp_objects == 1
        assert resource_probe.temp_object_measurements == 3
        assert resource_probe.maximum_temp_rows == population
        assert resource_probe.current_live_raw_rows == 0
        assert resource_probe.current_live_decoded_snapshots == 0
        assert resource_probe.current_live_carriers == 0
        assert resource_probe.current_active_registered_cursors == 0
        assert resource_probe.current_nested_point_lookups == 0
        assert resource_probe.final_physical_temp_objects == 1
        assert resource_probe.final_physical_temp_rows == population
        assert len(resource_probe.eqp_evidence) == 15
        assert all(
            accepts_sqlite_cursor_query_plan(kind, sql, details)
            for kind, sql, details in resource_probe.eqp_evidence
        )
        assert all(
            all(
                fragment not in detail.upper()
                for fragment in (
                    "AUTOMATIC",
                    "MATERIALIZE",
                    "USE TEMP B-TREE",
                    "CO-ROUTINE",
                )
            )
            for _kind, _sql, details in resource_probe.eqp_evidence
            for detail in details
        )
        assert (
            assert_sqlite_cursor_pre_rebind_receipt_provenance(
                outcome.receipt
            ).immutable_seal_receipt.immutable_root_sha256
            == expected_root
        )
        assert _read_all_rows(
            connection,
            "SELECT type, name FROM temp.sqlite_schema WHERE name = 'ge_blr_cursor_seal'",
        ) == (("table", "ge_blr_cursor_seal"),)
        assert _read_all_rows(connection, "SELECT count(*) FROM temp.ge_blr_cursor_seal") == (
            (population,),
        )
        assert type(temp_pages_before) is int
        assert type(temp_pages_after) is int
        assert temp_pages_after >= temp_pages_before
        assert stage._cursor_campaign_active_cursor is None
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("forged_count", [0, 2])
def test_measured_temp_object_inventory_rejects_missing_or_extra_count(
    forged_count: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    target_cursor_id: int | None = None
    intercepted = False

    def identify_measurement(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal target_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_TEMP_OBJECT_COUNT_SQL and target_cursor_id is None:
            target_cursor_id = id(cursor)
        return cursor

    def forge_measurement(cursor: Any) -> Any:
        nonlocal intercepted
        row = original_fetchone(cursor)
        if id(cursor) == target_cursor_id and not intercepted:
            assert row == (1,)
            intercepted = True
            return (forged_count,)
        return row

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", identify_measurement)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", forge_measurement)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match=r"TEMP object (?:inventory|count)"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert intercepted
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("include_event", [False, True])
def test_real_checkpoint_and_cross_order_campaigns_recompute_exact_a1_receipt(
    include_event: bool,
) -> None:
    connection, _summary, stage, identity, receipt = _prepared_checkpoint_fence(
        include_event=include_event
    )
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert type(outcome) is SQLiteCursorPreRebindComplete
        assert outcome.receipt is receipt
        assert outcome.projection_identity is identity
        assert outcome.vector == (0,) * 10
    finally:
        _cleanup(connection, stage)
    del outcome, transfer, receipt, identity, stage, connection
    gc.collect()


def test_cancelled_before_first_campaign_statement_is_terminal_and_poisoned() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        cancellation = _create_sqlite_cursor_campaign_cancellation()
        cancellation.request_cancel()
        with pytest.raises(SQLiteCursorCampaignCancelledError, match="BLR_CURSOR_CANCELLED"):
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                cancellation=cancellation,
            )
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("case_id", "boundary_label"),
    [
        ("cancel-at-begin", "campaign:before-prepare"),
        ("cancel-at-source", "source:after-prepare"),
        ("cancel-at-seal", "seal:after-prepare"),
        ("cancel-at-rule", "BLR_CURSOR_SEAL_COUNT:before-close"),
        ("cancel-before-complete", "clean-publication:after-close"),
    ],
    ids=[
        "representative-begin",
        "representative-source",
        "representative-seal",
        "representative-rule",
        "representative-before-complete",
    ],
)
def test_cancellation_is_injectable_across_early_middle_and_final_boundaries(
    case_id: str,
    boundary_label: str,
) -> None:
    _assert_lifecycle_case(case_id, "cancelled")
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        cancellation = _create_sqlite_cursor_campaign_cancellation(cancel_at_label=boundary_label)
        with pytest.raises(SQLiteCursorCampaignCancelledError, match="BLR_CURSOR_CANCELLED"):
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                cancellation=cancellation,
            )
        assert cancellation._label_occurrences == 1
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


_B2_CANCELLATION_PHASES = (
    "before-prepare",
    "after-prepare",
    "before-fetch",
    "after-fetch",
    "before-close",
    "after-close",
)
_BEGIN_B2_CANCELLATION_LABELS = frozenset(f"campaign:{phase}" for phase in _B2_CANCELLATION_PHASES)
_SOURCE_B2_CANCELLATION_LABELS = frozenset(
    f"{role}:{phase}"
    for role in (
        "eqp-source",
        "eqp-stage-insert",
        "eqp-event-lookup",
        "eqp-checkpoint-lookup",
        "catalog-snapshot",
        "identity",
        "temp-count",
        "source",
        "inspect",
        "insert",
        "event-lookup",
        "checkpoint-lookup",
    )
    for phase in _B2_CANCELLATION_PHASES
)
_SEAL_B2_CANCELLATION_LABELS = frozenset(
    f"{role}:{phase}" for role in ("eqp-stage-seal", "seal") for phase in _B2_CANCELLATION_PHASES
)
_RULE_B2_CANCELLATION_ROLES = frozenset(
    (
        "eqp-count-marker",
        *(f"eqp-{rule_id}" for rule_id in _CASE["ruleOrder"] if rule_id != "BLR_CURSOR_SEAL_COUNT"),
        *(cast(str, rule_id) for rule_id in _CASE["ruleOrder"]),
    )
)
_RULE_B2_CANCELLATION_LABELS = frozenset(
    f"{role}:{phase}" for role in _RULE_B2_CANCELLATION_ROLES for phase in _B2_CANCELLATION_PHASES
)
_COMPLETE_B2_CANCELLATION_LABELS = frozenset(
    f"{role}:{phase}"
    for role in ("diagnosed-publication", "clean-publication")
    for phase in _B2_CANCELLATION_PHASES
)
_B2_CANCELLATION_GROUPS = (
    _BEGIN_B2_CANCELLATION_LABELS,
    _SOURCE_B2_CANCELLATION_LABELS,
    _SEAL_B2_CANCELLATION_LABELS,
    _RULE_B2_CANCELLATION_LABELS,
    _COMPLETE_B2_CANCELLATION_LABELS,
)
assert len(_BEGIN_B2_CANCELLATION_LABELS) == 6
assert len(_SOURCE_B2_CANCELLATION_LABELS) == 72
assert len(_SEAL_B2_CANCELLATION_LABELS) == 12
assert len(_RULE_B2_CANCELLATION_LABELS) == 120
assert len(_COMPLETE_B2_CANCELLATION_LABELS) == 12
assert sum(map(len, _B2_CANCELLATION_GROUPS)) == len(frozenset().union(*_B2_CANCELLATION_GROUPS))
assert frozenset().union(*_B2_CANCELLATION_GROUPS) == frozenset(_CANCELLATION_BOUNDARY_LABELS)


def _closed_cancellation_execution_id(boundary_label: str) -> str:
    variant = boundary_label.replace(":", "-")
    if boundary_label in _BEGIN_B2_CANCELLATION_LABELS:
        return f"b2:cancel-at-begin:{variant}"
    if boundary_label in _SOURCE_B2_CANCELLATION_LABELS:
        return f"b2:cancel-at-source:{variant}"
    if boundary_label in _SEAL_B2_CANCELLATION_LABELS:
        return f"b2:cancel-at-seal:{variant}"
    if boundary_label in _RULE_B2_CANCELLATION_LABELS:
        return f"b2:cancel-at-rule:{variant}"
    if boundary_label in _COMPLETE_B2_CANCELLATION_LABELS:
        return f"b2:cancel-before-complete:{variant}"
    raise AssertionError(f"unclassified closed cancellation boundary: {boundary_label}")


@pytest.mark.parametrize(
    "boundary_label",
    _CANCELLATION_BOUNDARY_LABELS,
    ids=[
        _closed_cancellation_execution_id(boundary_label)
        for boundary_label in _CANCELLATION_BOUNDARY_LABELS
    ],
)
def test_every_closed_cancellation_boundary_is_reachable_and_terminal(
    boundary_label: str,
) -> None:
    role = boundary_label.split(":", 1)[0]
    if role in {"event-lookup", "checkpoint-lookup"}:
        connection, _summary, stage, _identity, receipt = _prepared_retained_history_fence()
    elif role == "diagnosed-publication":
        connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence(
            scope_extra=True
        )
    elif role in {"source", "inspect", "insert"}:
        connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence()
    else:
        connection, _summary, stage, _identity, receipt = _prepared_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    cancellation = _create_sqlite_cursor_campaign_cancellation(cancel_at_label=boundary_label)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        observed: BaseException | None = None
        try:
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                cancellation=cancellation,
            )
        except BaseException as error:
            observed = error
        assert type(observed) is SQLiteCursorCampaignCancelledError
        assert str(observed) == "BLR_CURSOR_CANCELLED: cursor campaign was cancelled"
        assert cancellation._label_occurrences == 1
        _assert_terminal_fault_postconditions(
            stage,
            observed,
            permanent_before=permanent_before,
            connection=connection,
        )
    finally:
        _cleanup(connection, stage)


_RULE_TRANSITION_CANCELLATION_CASES = tuple(
    (
        f"{rule_id}:before-prepare",
        f"transition-{str(rule_id).lower().replace('blr_cursor_', '').replace('_', '-')}",
    )
    for rule_id in _CASE["ruleOrder"]
)
assert len(_RULE_TRANSITION_CANCELLATION_CASES) == 10


@pytest.mark.parametrize(
    ("boundary_label", "variant"),
    _RULE_TRANSITION_CANCELLATION_CASES,
    ids=[
        f"b2:cancel-at-rule:{variant}"
        for _boundary_label, variant in _RULE_TRANSITION_CANCELLATION_CASES
    ],
)
def test_cancellation_is_polled_at_every_rule_transition(
    boundary_label: str,
    variant: str,
) -> None:
    assert variant.startswith("transition-")
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    cancellation = _create_sqlite_cursor_campaign_cancellation(cancel_at_label=boundary_label)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(SQLiteCursorCampaignCancelledError, match="BLR_CURSOR_CANCELLED"):
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                cancellation=cancellation,
            )
        assert cancellation._label_occurrences == 1
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
        assert _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL) == permanent_before
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(("diagnostic_limit", "count"), [(1, 2), (16, 17), (64, 65)])
def test_diagnosed_is_bounded_receipt_free_and_retires_transfer(
    diagnostic_limit: int,
    count: int,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence(
        scope_extra=True, count=count
    )
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(
            connection, stage, receipt, transfer, diagnostic_limit=diagnostic_limit
        )
        assert outcome.status == "diagnosed"
        assert outcome.vector == (0, diagnostic_limit, 0, 0, 0, 0, 0, 0, 0, 0)
        assert len(outcome.diagnostics) == 1
        assert outcome.diagnostics[0].rule_id == "BLR_CURSOR_SCOPE"
        assert outcome.diagnostics[0].violation_count == diagnostic_limit
        assert outcome.diagnostics[0].diagnostics_truncated is True
        assert not hasattr(outcome, "receipt")
        assert not hasattr(outcome, "immutable_root_sha256")
        assert stage._cursor_campaign_state == "diagnosed"
        with pytest.raises(ValueError, match="transfer provenance is invalid"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert stage.state == "open"
        assert stage._cursor_campaign_state == "diagnosed"
    finally:
        _cleanup(connection, stage)


def test_outer_abort_preserves_primary_when_campaign_metadata_validation_is_hostile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    primary_pattern = "cursor diagnostic limit is outside bounds"

    def hostile_metadata(*_args: object, **_kwargs: object) -> Any:
        raise RuntimeError("secondary hostile campaign metadata failure")

    monkeypatch.setattr(stage_ownership_module, "_campaign_metadata", hostile_metadata)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match=primary_pattern) as observed:
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                diagnostic_limit=0,
            )
        assert type(observed.value) is ValueError
        assert "secondary hostile" not in str(observed.value)
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
    finally:
        _cleanup(connection, stage)


def test_outer_abort_preserves_primary_when_registry_pop_is_hostile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    primary_pattern = "cursor diagnostic limit is outside bounds"
    transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
    _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)

    def hostile_pop(*_args: object, **_kwargs: object) -> Any:
        raise RuntimeError("secondary hostile registry pop failure")

    monkeypatch.setattr(type(stage_ownership_module._CAMPAIGNS), "pop", hostile_pop)
    try:
        with pytest.raises(ValueError, match=primary_pattern) as observed:
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                diagnostic_limit=0,
            )
        assert type(observed.value) is ValueError
        assert "secondary hostile" not in str(observed.value)
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("diagnostic_limit", [1, 16, 64])
def test_diagnostic_population_at_limit_is_exact_and_not_truncated(
    diagnostic_limit: int,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence(
        scope_extra=True, count=diagnostic_limit
    )
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(
            connection, stage, receipt, transfer, diagnostic_limit=diagnostic_limit
        )
        assert outcome.status == "diagnosed"
        assert outcome.vector == (0, diagnostic_limit, 0, 0, 0, 0, 0, 0, 0, 0)
        assert len(outcome.diagnostics) == 1
        assert outcome.diagnostics[0].rule_id == "BLR_CURSOR_SCOPE"
        assert outcome.diagnostics[0].violation_count == diagnostic_limit
        assert outcome.diagnostics[0].diagnostics_truncated is False
        assert not hasattr(outcome, "receipt")
        assert not hasattr(outcome, "immutable_root_sha256")
    finally:
        _cleanup(connection, stage)


def test_real_aggregate_campaign_reports_all_ten_rules_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt, shape_token = (
        _prepared_aggregate_diagnosed_fence()
    )
    original_fetchone = campaign_module._CURSOR_FETCHONE

    def fetchone_with_one_physical_shape_defect(cursor: Any) -> Any:
        row = original_fetchone(cursor)
        if type(row) is tuple and len(row) == 18 and row[1] == shape_token:
            return row[:-1]
        return row

    monkeypatch.setattr(
        campaign_module, "_CURSOR_FETCHONE", fetchone_with_one_physical_shape_defect
    )
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert outcome.status == "diagnosed"
        assert outcome.vector == (1,) * 10
        assert tuple(diagnostic.rule_id for diagnostic in outcome.diagnostics) == (
            "BLR_CURSOR_AUTHORIZATION",
            "BLR_CURSOR_SCOPE",
            "BLR_CURSOR_BLOB_CANONICAL",
            "BLR_CURSOR_POSITION",
            "BLR_CURSOR_EXPIRY_CONSUMPTION",
            "BLR_CURSOR_CATALOG_BINDING",
            "BLR_CURSOR_SEAL_COUNT",
            "BLR_CURSOR_SHAPE",
            "BLR_CURSOR_EVENT_BINDING",
            "BLR_CURSOR_CHECKPOINT_BINDING",
        )
        assert all(diagnostic.violation_count == 1 for diagnostic in outcome.diagnostics)
        assert all(not diagnostic.diagnostics_truncated for diagnostic in outcome.diagnostics)
        assert not hasattr(outcome, "receipt")
        assert not hasattr(outcome, "immutable_root_sha256")
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:all-rules-nonlexical-input"])
def test_fixture_nonlexical_aggregate_has_exact_population_vector_and_registry_order(
    _b2_case: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt, physical_rows = (
        _prepared_nonlexical_aggregate_fence()
    )
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    injected_rows: dict[int, list[tuple[object, ...]]] = {}

    def execute_with_injected_source(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            injected_rows[id(cursor)] = list(physical_rows)
        return cursor

    def fetchone_with_injected_source(cursor: Any) -> Any:
        rows = injected_rows.get(id(cursor))
        if rows is None:
            return original_fetchone(cursor)
        if rows:
            return rows.pop(0)
        del injected_rows[id(cursor)]
        return None

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_injected_source)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_injected_source)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert outcome.status == "diagnosed"
        assert outcome.vector == (1, 2, 3, 4, 5, 6, 1, 8, 9, 10)
        assert tuple(diagnostic.rule_id for diagnostic in outcome.diagnostics) == tuple(
            _CASE["ruleOrder"]
        )
        assert all(not diagnostic.diagnostics_truncated for diagnostic in outcome.diagnostics)
        assert not hasattr(outcome, "receipt")
        assert not hasattr(outcome, "immutable_root_sha256")
        assert stage._cursor_campaign_state == "diagnosed"
        with pytest.raises(ValueError, match="transfer provenance is invalid"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert stage.state == "open"
        assert stage._cursor_campaign_state == "diagnosed"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "rule_index",
    range(10),
    ids=[
        "b2:authorization-malformed",
        "isolated-scope",
        "isolated-blob",
        "b2:position-beyond-snapshot",
        "b2:provider-clock-regression",
        "b2:descriptor-substitution",
        "b2:source-stage-count-delta",
        "isolated-shape",
        "b2:event-snapshot-mismatch",
        "isolated-checkpoint",
    ],
)
def test_real_campaign_isolates_each_rule_as_one_hot_vector(
    rule_index: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt, physical_row = _prepared_isolated_rule_fence(
        rule_index
    )
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    injected_rows: dict[int, list[tuple[object, ...]]] = {}

    def execute_with_injected_source(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            injected_rows[id(cursor)] = [physical_row]
        return cursor

    def fetchone_with_injected_source(cursor: Any) -> Any:
        rows = injected_rows.get(id(cursor))
        if rows is None:
            return original_fetchone(cursor)
        if rows:
            return rows.pop()
        del injected_rows[id(cursor)]
        return None

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_injected_source)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_injected_source)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        expected = [0] * 10
        expected[rule_index] = 1
        assert outcome.status == "diagnosed"
        assert outcome.vector == tuple(expected)
        assert len(outcome.diagnostics) == 1
        assert outcome.diagnostics[0].rule_id == _CASE["ruleOrder"][rule_index]
        assert outcome.diagnostics[0].violation_count == 1
        assert outcome.diagnostics[0].diagnostics_truncated is False
        assert not hasattr(outcome, "receipt")
        assert not hasattr(outcome, "immutable_root_sha256")
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("case_name", "rule_index", "expected"),
    [
        (
            "authorization-plus-text-page",
            0,
            (1, 0, 0, 0, 0, 0, 0, 1, 0, 0),
        ),
        (
            "checkpoint-text-created-plus-missing-put",
            9,
            (0, 0, 0, 0, 0, 0, 0, 1, 0, 1),
        ),
        (
            "scope-mismatch-plus-text-expiry",
            1,
            (0, 1, 0, 0, 0, 0, 0, 1, 0, 0),
        ),
        (
            "text-consumed-plus-missing-event-tail",
            0,
            (0, 0, 0, 0, 0, 0, 0, 1, 1, 0),
        ),
    ],
)
def test_real_campaign_preserves_mixed_storage_diagnostics(
    case_name: str,
    rule_index: int,
    expected: tuple[int, ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt, original_row = _prepared_isolated_rule_fence(
        rule_index
    )
    physical_row = list(original_row)
    if case_name == "authorization-plus-text-page":
        physical_row[8] = "1"
    elif case_name == "checkpoint-text-created-plus-missing-put":
        physical_row[15] = "500"
    elif case_name == "scope-mismatch-plus-text-expiry":
        physical_row[16] = "1500"
    else:
        physical_row[3] = "b" * 64
        physical_row[10] = 0
        physical_row[11] = "d" * 64
        physical_row[14] = canonical_bytes({"exists": True, "recordHash": "d" * 64, "sequence": 0})
        physical_row[17] = "600"
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    injected_rows: dict[int, list[tuple[object, ...]]] = {}

    def execute_with_injected_source(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            injected_rows[id(cursor)] = [tuple(physical_row)]
        return cursor

    def fetchone_with_injected_source(cursor: Any) -> Any:
        rows = injected_rows.get(id(cursor))
        if rows is None:
            return original_fetchone(cursor)
        if rows:
            return rows.pop()
        del injected_rows[id(cursor)]
        return None

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_injected_source)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_injected_source)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert outcome.status == "diagnosed"
        assert outcome.vector == expected
        assert tuple(
            (diagnostic.rule_id, diagnostic.violation_count) for diagnostic in outcome.diagnostics
        ) == tuple(
            (_CASE["ruleOrder"][index], count) for index, count in enumerate(expected) if count
        )
    finally:
        _cleanup(connection, stage)


def test_forbidden_eqp_plan_is_terminal_campaign_corruption(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        monkeypatch.setattr(
            campaign_module,
            "SQLITE_CURSOR_MAIN_PROJECTION_SQL",
            "SELECT tenant_id, token_hash, kind, principal_hash, authorization_hash, "
            "stream_id, checkpoint_scope, request_scope_blob, page_size, next_position, "
            "snapshot_tail_sequence, snapshot_tail_record_hash, descriptor_hash, "
            "schema_identity_sha256, snapshot_blob, created_at_ms, expires_at_ms, "
            "consumed_at_ms FROM main.ge_cycle_cursors ORDER BY kind",
        )
        with pytest.raises(ValueError, match="BLR_CURSOR_EQP"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:source-index-ddl-replacement"])
def test_initial_same_name_index_replacement_is_catalog_corruption(
    _b2_case: None,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_replaced_index_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="canonical identity drifted"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_initial_catalog_corruption_precedes_precancelled_signal() -> None:
    connection, _summary, stage, _identity, receipt = _prepared_replaced_index_fence()
    cancellation = _create_sqlite_cursor_campaign_cancellation()
    cancellation.request_cancel()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="catalog canonical identity drifted") as observed:
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                cancellation=cancellation,
            )
        assert type(observed.value) is ValueError
        assert cancellation._label_occurrences == 0
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_during_run_catalog_corruption_precedes_new_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    cancellation = _create_sqlite_cursor_campaign_cancellation()
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    corrupt_cursor_id: int | None = None
    arm_corruption = False

    def execute_with_drift_and_cancel(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal corrupt_cursor_id, arm_corruption
        cursor = original_execute(owner, sql, parameters)
        if sql.startswith("EXPLAIN QUERY PLAN ") and not arm_corruption:
            arm_corruption = True
            cancellation.request_cancel()
        elif sql == campaign_module._SOURCE_CATALOG_SNAPSHOT_SQL and arm_corruption:
            corrupt_cursor_id = id(cursor)
        return cursor

    def fetchone_with_catalog_drift(cursor: Any) -> Any:
        row = original_fetchone(cursor)
        if id(cursor) == corrupt_cursor_id and row is not None:
            return (cast(str, row[0]) + " ",)
        return row

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_drift_and_cancel)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_catalog_drift)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="source catalog identity drifted"):
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                cancellation=cancellation,
            )
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_source_fetch_primary_precedes_cancellation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    cancellation = _create_sqlite_cursor_campaign_cancellation()
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    source_cursor_id: int | None = None
    primary = RuntimeError("source fetch primary")

    def execute_with_source_tracking(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal source_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            source_cursor_id = id(cursor)
        return cursor

    def fetchone_with_primary_and_cancel(cursor: Any) -> Any:
        if id(cursor) == source_cursor_id:
            cancellation.request_cancel()
            raise primary
        return original_fetchone(cursor)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_source_tracking)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_primary_and_cancel)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        observed: BaseException | None = None
        try:
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                cancellation=cancellation,
            )
        except BaseException as error:
            observed = error
        assert observed is primary
        _assert_terminal_fault_postconditions(
            stage,
            observed,
            permanent_before=permanent_before,
            connection=connection,
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("phase", "hostile_marker"),
    [
        ("row", ()),
        ("row", ("1",)),
        ("row", (2,)),
        ("count", ()),
        ("count", ("1",)),
        ("count", (2,)),
    ],
    ids=[
        "b2:marker-malformed-arity:row",
        "b2:marker-malformed-type:row",
        "b2:marker-malformed-value:row",
        "b2:marker-malformed-arity:count",
        "b2:marker-malformed-type:count",
        "b2:marker-malformed-value:count",
    ],
)
def test_exact_sqlite_one_shape_precedes_cancellation(
    phase: str,
    hostile_marker: tuple[object, ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    target_sql = cast(str, _ROW_MARKER_SQL[0]) if phase == "row" else SQLITE_CURSOR_COUNT_MARKER_SQL
    expected_message = "rule marker is malformed"
    cancellation = _create_sqlite_cursor_campaign_cancellation()
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    target_cursor_id: int | None = None

    def execute_with_target(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal target_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql:
            target_cursor_id = id(cursor)
        return cursor

    def fetchone_with_hostile_marker(cursor: Any) -> Any:
        if id(cursor) == target_cursor_id:
            cancellation.request_cancel()
            return hostile_marker
        return original_fetchone(cursor)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_target)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_hostile_marker)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match=expected_message):
            _run_sqlite_cursor_pre_rebind_campaign(
                connection,
                stage,
                receipt,
                transfer,
                cancellation=cancellation,
            )
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_equal_count_substituted_row_is_terminal_at_a1_root_fence() -> None:
    connection, summary, stage, identity, _original_receipt = _prepared_event_empty_fence()
    envelope = summary.source_envelope
    substituted_row = (
        "tenant-a",
        "f" * 64,
        "event",
        "b" * 64,
        "c" * 64,
        "stream-a",
        None,
        canonical_bytes(
            {
                "contractVersion": "cycle-store-provider/v1alpha1",
                "pageSize": 64,
                "streamId": "stream-a",
            }
        ),
        64,
        0,
        -1,
        None,
        envelope["sourceDescriptorHash"],
        envelope["sourceSchemaIdentitySha256"],
        canonical_bytes({"exists": False, "recordHash": None, "sequence": -1}),
        500,
        1500,
        None,
    )
    receipt = _receipt_for_rows(summary, identity, (substituted_row,))
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="cursor immutable root drifted"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_during_run_catalog_evidence_drift_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    catalog_reads = 0
    hostile_cursor_id: int | None = None

    def execute_with_catalog_drift(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal catalog_reads, hostile_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == campaign_module._SOURCE_CATALOG_SNAPSHOT_SQL:
            catalog_reads += 1
            if catalog_reads == 1:
                hostile_cursor_id = id(cursor)
        return cursor

    def fetchone_with_catalog_drift(cursor: Any) -> Any:
        row = original_fetchone(cursor)
        if id(cursor) == hostile_cursor_id and row is not None:
            return (cast(str, row[0]) + " ",)
        return row

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_catalog_drift)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_catalog_drift)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="source catalog identity drifted"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert catalog_reads == 1
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


def test_post_root_final_source_identity_reread_drift_is_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    identity_sql = (
        "SELECT (SELECT count(*) FROM main.ge_cycle_cursors), "
        "(SELECT updated_at_ms FROM main.ge_cycle_migration_lock WHERE singleton = 1), "
        "schema_identity_sha256, provider_descriptor_hash "
        "FROM main.ge_cycle_schema WHERE singleton = 1"
    )
    identity_reads = 0
    hostile_cursor_id: int | None = None

    def execute_with_final_identity_drift(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal identity_reads, hostile_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == identity_sql:
            identity_reads += 1
            if identity_reads == 3:
                hostile_cursor_id = id(cursor)
        return cursor

    def fetchone_with_final_identity_drift(cursor: Any) -> Any:
        row = original_fetchone(cursor)
        if id(cursor) == hostile_cursor_id and row is not None:
            hostile = list(row)
            hostile[1] = cast(int, hostile[1]) + 1
            return tuple(hostile)
        return row

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_final_identity_drift)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_final_identity_drift)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="source identity drifted"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert identity_reads == 3
        assert stage.state == "poisoned"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "reported_rowcount",
    [0, 2],
    ids=["b2:insert-zero-change", "b2:insert-two-changes"],
)
def test_stage_insert_rejects_nonunit_reported_rowcount_without_permanent_mutation(
    reported_rowcount: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    monkeypatch.setattr(campaign_module, "_rowcount", lambda _cursor: reported_rowcount)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        observed: BaseException | None = None
        try:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        except BaseException as error:
            observed = error
        assert observed is not None
        assert str(observed) == ("BLR_CURSOR_CAMPAIGN_WRITE: cursor insert change count is invalid")
        _assert_terminal_fault_postconditions(
            stage,
            observed,
            permanent_before=permanent_before,
            connection=connection,
        )
    finally:
        _cleanup(connection, stage)


def test_nonstageable_decode_precedes_insert_and_leaves_temp_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    physical = (
        "tenant-a",
        "1" * 64,
        "event",
        "b" * 64,
        "c" * 64,
        "stream-a",
        None,
        canonical_bytes(
            {
                "contractVersion": "cycle-store-provider/v1alpha1",
                "pageSize": 1,
                "streamId": "stream-a",
            }
        ),
        1,
        0,
        -1,
        None,
        "d" * 64,
        "e" * 64,
        canonical_bytes({"exists": False, "recordHash": None, "sequence": -1}),
        500,
        1500,
    )
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    source_rows: dict[int, list[tuple[object, ...]]] = {}
    insert_calls = 0

    def execute_with_nonstageable_source(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal insert_calls
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            source_rows[id(cursor)] = [physical]
        elif sql == SQLITE_CURSOR_SEAL_INSERT_SQL:
            insert_calls += 1
        return cursor

    def fetchone_with_nonstageable_source(cursor: Any) -> Any:
        rows = source_rows.get(id(cursor))
        if rows is None:
            return original_fetchone(cursor)
        if rows:
            return rows.pop()
        del source_rows[id(cursor)]
        return None

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_nonstageable_source)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_nonstageable_source)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert outcome.status == "diagnosed"
        assert outcome.vector == (0, 0, 0, 0, 0, 0, 1, 1, 0, 0)
        assert insert_calls == 0
        assert _read_all_rows(connection, "SELECT count(*) FROM temp.ge_blr_cursor_seal") == ((0,),)
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("phase", "fault_kind"),
    [
        ("source", "prepare"),
        ("source", "fetch"),
        ("source", "close"),
        ("marker", "prepare"),
        ("marker", "fetch"),
        ("marker", "close"),
        ("seal", "prepare"),
        ("seal", "fetch"),
        ("seal", "close"),
    ],
    ids=[
        "b2:source-prepare-failure",
        "b2:source-first-fetch-failure",
        "b2:source-close-failure",
        "marker-prepare",
        "marker-fetch",
        "marker-close",
        "seal-prepare",
        "seal-fetch",
        "seal-close",
    ],
)
def test_statement_lifecycle_faults_preserve_primary_and_cleanup_once(
    phase: str,
    fault_kind: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    target_sql = {
        "source": SQLITE_CURSOR_MAIN_PROJECTION_SQL,
        "marker": cast(str, _ROW_MARKER_SQL[0]),
        "seal": SQLITE_CURSOR_SEAL_PROJECTION_SQL,
    }[phase]
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    original_close = campaign_module._CURSOR_CLOSE
    target_cursor_ids: set[int] = set()
    close_calls = 0
    primary = RuntimeError(f"{phase}-{fault_kind}-primary")

    def execute_with_fault(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        if sql == target_sql and fault_kind == "prepare":
            raise primary
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql:
            target_cursor_ids.add(id(cursor))
        return cursor

    def fetchone_with_fault(cursor: Any) -> Any:
        if id(cursor) in target_cursor_ids and fault_kind == "fetch":
            raise primary
        return original_fetchone(cursor)

    def close_with_fault(cursor: Any) -> None:
        nonlocal close_calls
        if id(cursor) in target_cursor_ids:
            close_calls += 1
            if fault_kind == "close":
                raise primary
        original_close(cursor)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_fault)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetchone_with_fault)
    monkeypatch.setattr(campaign_module, "_CURSOR_CLOSE", close_with_fault)
    monkeypatch.setattr(stage_module, "_CURSOR_CLOSE", close_with_fault)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        observed: BaseException | None = None
        try:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        except BaseException as error:
            observed = error
        assert observed is primary
        assert close_calls == (0 if fault_kind == "prepare" else 1)
        _assert_terminal_fault_postconditions(
            stage,
            observed,
            permanent_before=permanent_before,
            connection=connection,
        )
        stage.dispose()
        assert close_calls == (0 if fault_kind == "prepare" else 1)
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("phase", "target_sql"),
    [
        ("source", SQLITE_CURSOR_MAIN_PROJECTION_SQL),
        ("rule", cast(str, _ROW_MARKER_SQL[0])),
        ("seal", SQLITE_CURSOR_SEAL_PROJECTION_SQL),
    ],
    ids=[
        "b2:cleanup-only-failure:source",
        "b2:cleanup-only-failure:rule",
        "b2:cleanup-only-failure:seal",
    ],
)
def test_cleanup_only_failure_is_primary_for_each_cursor_family(
    phase: str,
    target_sql: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    original_execute = campaign_module._OWNER_EXECUTE
    original_close = campaign_module._CURSOR_CLOSE
    target_cursor_ids: set[int] = set()
    close_calls = 0
    primary = RuntimeError(f"{phase}-close-primary")

    def identify_target(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql:
            target_cursor_ids.add(id(cursor))
        return cursor

    def fail_only_cleanup(cursor: Any) -> None:
        nonlocal close_calls
        if id(cursor) in target_cursor_ids:
            close_calls += 1
            original_close(cursor)
            raise primary
        original_close(cursor)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", identify_target)
    monkeypatch.setattr(campaign_module, "_CURSOR_CLOSE", fail_only_cleanup)
    monkeypatch.setattr(stage_module, "_CURSOR_CLOSE", fail_only_cleanup)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(RuntimeError) as raised:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert raised.value is primary
        assert close_calls == 1
        _assert_terminal_fault_postconditions(
            stage,
            primary,
            permanent_before=permanent_before,
            connection=connection,
        )
        stage.dispose()
        assert close_calls == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("case_id", "failure_fetch"),
    [
        ("source-middle-fetch-failure", 2),
        ("source-final-fetch-failure", 3),
    ],
    ids=[
        "b2:source-middle-fetch-failure",
        "b2:source-final-fetch-failure",
    ],
)
def test_source_positioned_fetch_failures_are_terminal_statement_corruption(
    case_id: str,
    failure_fetch: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _assert_lifecycle_case(case_id, "statement-corruption")
    connection, _summary, stage, _identity, receipt = _prepared_streaming_scale_fence(3)
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    source_cursor_id: int | None = None
    source_fetches = 0
    primary = RuntimeError(case_id)

    def execute_with_source_identity(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal source_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            source_cursor_id = id(cursor)
        return cursor

    def fail_at_position(cursor: Any) -> Any:
        nonlocal source_fetches
        if id(cursor) == source_cursor_id:
            source_fetches += 1
            if source_fetches == failure_fetch:
                raise primary
        return original_fetchone(cursor)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_source_identity)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fail_at_position)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(RuntimeError) as raised:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert raised.value is primary
        assert source_fetches == failure_fetch
        _assert_terminal_fault_postconditions(
            stage,
            primary,
            permanent_before=permanent_before,
            connection=connection,
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:decode-before-insert-failure"])
def test_decode_before_insert_failure_is_terminal_statement_corruption(
    _b2_case: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case_id = "decode-before-insert-failure"
    _assert_lifecycle_case(case_id, "statement-corruption")
    connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    original_execute = campaign_module._OWNER_EXECUTE
    insert_calls = 0
    primary = RuntimeError(case_id)

    def count_inserts(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal insert_calls
        if sql == SQLITE_CURSOR_SEAL_INSERT_SQL:
            insert_calls += 1
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", count_inserts)
    monkeypatch.setattr(
        campaign_module,
        "_inspect_sqlite_v1_cursor_row",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(primary),
    )
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(RuntimeError) as raised:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert raised.value is primary
        assert insert_calls == 0
        _assert_terminal_fault_postconditions(
            stage,
            primary,
            permanent_before=permanent_before,
            connection=connection,
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:primary-plus-cleanup"])
def test_primary_plus_cleanup_preserves_primary_and_closes_exactly_once(
    _b2_case: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case_id = "primary-plus-cleanup"
    _assert_lifecycle_case(case_id, "statement-corruption")
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    original_close = stage_module._CURSOR_CLOSE
    source_cursor_id: int | None = None
    close_calls = 0
    primary = RuntimeError("source-fetch-primary")
    cleanup = RuntimeError("source-close-cleanup")

    def identify_source(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal source_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            source_cursor_id = id(cursor)
        return cursor

    def fail_source_fetch(cursor: Any) -> Any:
        if id(cursor) == source_cursor_id:
            raise primary
        return original_fetchone(cursor)

    def fail_source_cleanup(cursor: Any) -> None:
        nonlocal close_calls
        if id(cursor) == source_cursor_id:
            close_calls += 1
            original_close(cursor)
            raise cleanup
        original_close(cursor)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", identify_source)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fail_source_fetch)
    monkeypatch.setattr(stage_module, "_CURSOR_CLOSE", fail_source_cleanup)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(RuntimeError) as raised:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert raised.value is primary
        assert close_calls == 1
        _assert_terminal_fault_postconditions(
            stage,
            primary,
            permanent_before=permanent_before,
            connection=connection,
        )
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:receipt-clone"])
def test_receipt_clone_is_rejected_before_campaign_authority(_b2_case: None) -> None:
    case_id = "receipt-clone"
    _assert_lifecycle_case(case_id, "invalid-authority")
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    cloned = copy.copy(receipt)
    assert type(cloned) is type(receipt)
    assert cloned is not receipt
    try:
        with pytest.raises(ValueError, match="provenance"):
            _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, cloned)
        assert stage._cursor_campaign_state == "unused"
    finally:
        with suppress(BaseException):
            stage.dispose()
        with suppress(BaseException):
            connection.close()


@pytest.mark.parametrize(
    "case_id",
    ["transaction-end", "rollback-rebegin", "active-dispose", "closed-connection"],
    ids=[
        "b2:transaction-end",
        "b2:rollback-rebegin",
        "b2:active-dispose",
        "b2:closed-connection",
    ],
)
def test_active_campaign_owner_lifecycle_faults_are_terminal(
    case_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    declared = {
        "transaction-end": "stale-epoch",
        "rollback-rebegin": "stale-epoch",
        "active-dispose": "disposed",
        "closed-connection": "poisoned",
    }[case_id]
    _assert_lifecycle_case(case_id, declared)
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    original_capability_close = stage_module._SQLiteCursorCapability.close
    source_cursor_id: int | None = None
    injected = False
    injected_primary: BaseException | None = None
    permanent_at_close: tuple[tuple[object, ...], ...] | None = None
    hostile_close_calls = 0

    def identify_source(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal source_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == SQLITE_CURSOR_MAIN_PROJECTION_SQL:
            source_cursor_id = id(cursor)
        return cursor

    def inject_owner_fault(cursor: Any) -> Any:
        nonlocal hostile_close_calls, injected, injected_primary, permanent_at_close
        if id(cursor) == source_cursor_id and not injected:
            injected = True
            if case_id == "transaction-end":
                connection.commit()
            elif case_id == "rollback-rebegin":
                connection.rollback()
                begin_cursor = connection.execute("BEGIN EXCLUSIVE")
                begin_cursor.close()
            elif case_id == "active-dispose":

                def hostile_close(_cursor: Any) -> None:
                    nonlocal hostile_close_calls
                    if id(_cursor) == source_cursor_id:
                        hostile_close_calls += 1
                        raise AssertionError("replaceable cursor close was reached")
                    original_capability_close(_cursor)

                monkeypatch.setattr(stage_module._SQLiteCursorCapability, "close", hostile_close)
                stage.dispose()
            else:
                permanent_at_close = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
                connection.close()
        try:
            return original_fetchone(cursor)
        except BaseException as error:
            injected_primary = error
            raise

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", identify_source)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", inject_owner_fault)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        observed: BaseException | None = None
        try:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        except BaseException as error:
            observed = error
        assert observed is not None
        assert injected
        expected = {
            "transaction-end": (
                ValueError,
                "BLR_EXCLUSIVE_TRANSACTION_REQUIRED: baseline TEMP stage requires the "
                "captured owner EXCLUSIVE transaction",
            ),
            "rollback-rebegin": (
                ValueError,
                "BLR_TRANSACTION_CHANGED: baseline TEMP stage transaction changed",
            ),
            "active-dispose": (sqlite3.ProgrammingError, "Cannot operate on a closed cursor."),
            "closed-connection": (
                sqlite3.ProgrammingError,
                "Cannot operate on a closed database.",
            ),
        }[case_id]
        assert type(observed) is expected[0]
        assert str(observed) == expected[1]
        if injected_primary is not None:
            assert observed is injected_primary
        if case_id == "active-dispose":
            assert hostile_close_calls == 0
            assert stage.state == "disposed"
        assert stage._cursor_campaign_state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
        assert stage._cursor_campaign_active_role is None
        assert stage._cursor_campaign_active_rule_index is None
        if case_id == "closed-connection":
            assert permanent_at_close == permanent_before
        else:
            assert _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL) == permanent_before
        rendered = str(observed)
        assert "receipt" not in rendered.lower()
        assert "immutableRoot" not in rendered
        assert "tenant-a" not in rendered
        assert "b" * 64 not in rendered
    finally:
        with suppress(BaseException):
            stage.dispose()
        with suppress(BaseException):
            connection.close()


@pytest.mark.parametrize(
    "case_id",
    [
        "post-source-pre-barrier-mutation",
        "post-diagnostic-mutation",
        "rule-transition-mutation",
    ],
    ids=[
        "b2:post-source-pre-barrier-mutation",
        "b2:post-diagnostic-mutation",
        "b2:rule-transition-mutation",
    ],
)
def test_declared_campaign_phase_mutations_are_unexplained_writes(
    case_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _assert_lifecycle_case(case_id, "unexplained-write")
    if case_id == "post-diagnostic-mutation":
        connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence(
            scope_extra=True
        )
    else:
        connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    identity_sql = (
        "SELECT (SELECT count(*) FROM main.ge_cycle_cursors), "
        "(SELECT updated_at_ms FROM main.ge_cycle_migration_lock WHERE singleton = 1), "
        "schema_identity_sha256, provider_descriptor_hash "
        "FROM main.ge_cycle_schema WHERE singleton = 1"
    )
    identity_cursor_ids: set[int] = set()
    identity_reads = 0
    marker_prepares = 0
    mutated = False

    def mutate_main() -> None:
        nonlocal mutated
        assert not mutated
        mutated = True
        mutation = original_execute(
            connection,
            "UPDATE main.ge_cycle_migration_lock "
            "SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1",
        )
        mutation.close()

    def execute_with_phase_mutation(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal identity_reads, marker_prepares
        if (
            case_id == "post-source-pre-barrier-mutation"
            and sql == "SELECT count(*) FROM temp.ge_blr_cursor_seal"
            and not mutated
        ):
            mutate_main()
        if sql in {candidate for candidate in _ROW_MARKER_SQL if candidate is not None}:
            marker_prepares += 1
            if case_id == "rule-transition-mutation" and marker_prepares == 2:
                mutate_main()
        cursor = original_execute(owner, sql, parameters)
        if sql == identity_sql:
            identity_reads += 1
            if case_id == "post-diagnostic-mutation" and identity_reads == 2:
                identity_cursor_ids.add(id(cursor))
        return cursor

    def fetch_with_post_diagnostic_mutation(cursor: Any) -> Any:
        row = original_fetchone(cursor)
        if id(cursor) in identity_cursor_ids and row is not None and not mutated:
            mutate_main()
        return row

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_phase_mutation)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetch_with_post_diagnostic_mutation)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        observed: BaseException | None = None
        try:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        except BaseException as error:
            observed = error
        assert observed is not None
        assert mutated
        assert str(observed) == (
            "BLR_UNEXPLAINED_WRITE: baseline TEMP stage observed an external write"
        )
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:abandonment"])
def test_abandonment_dispose_terminates_unrun_authority_and_clears_temp(
    _b2_case: None,
) -> None:
    case_id = "abandonment"
    _assert_lifecycle_case(case_id, "poisoned")
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        authority = campaign_module._begin_sqlite_cursor_pre_rebind_campaign(
            connection, stage, receipt, transfer
        )
        assert stage._cursor_campaign_state == "active"
        stage.dispose()
        assert stage.state == "disposed"
        assert stage._cursor_campaign_state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
        with pytest.raises(ValueError, match="baseline TEMP stage is disposed"):
            campaign_module._assert_sqlite_cursor_pre_rebind_campaign(
                connection, stage, receipt, authority
            )
        with pytest.raises(sqlite3.OperationalError, match="no such table"):
            _read_all_rows(connection, "SELECT count(*) FROM temp.ge_blr_cursor_seal")
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    ("case_id", "column", "hostile_value", "vector"),
    [
        ("scope-null-group", 5, None, (0, 1, 0, 0, 0, 0, 0, 0, 0, 0)),
        (
            "blob-over-bound",
            7,
            b"x" * (1_048_576 + 1),
            (0, 0, 1, 0, 0, 0, 0, 0, 0, 0),
        ),
        (
            "clock-consumed-before-created",
            17,
            499,
            (0, 0, 0, 0, 1, 0, 0, 0, 0, 0),
        ),
        (
            "schema-substitution",
            13,
            "0" * 64,
            (0, 0, 0, 0, 0, 1, 0, 0, 0, 0),
        ),
    ],
    ids=[
        "b2:scope-null-group",
        "b2:blob-over-bound",
        "b2:clock-consumed-before-created",
        "b2:schema-substitution",
    ],
)
def test_exact_hostile_physical_row_cases_are_one_hot(
    case_id: str,
    column: int,
    hostile_value: object,
    vector: tuple[int, ...],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _assert_hostile_case(case_id, vector)
    connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence()
    original_fetchone = campaign_module._CURSOR_FETCHONE
    injected = False

    def fetch_hostile_source(cursor: Any) -> Any:
        nonlocal injected
        row = original_fetchone(cursor)
        if type(row) is tuple and len(row) == 18 and row[1] == "1".zfill(64):
            physical = list(row)
            physical[column] = hostile_value
            injected = True
            return tuple(physical)
        return row

    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fetch_hostile_source)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert injected
        assert outcome.status == "diagnosed"
        assert outcome.vector == vector
        assert tuple(diagnostic.rule_id for diagnostic in outcome.diagnostics) == (
            _CASE["ruleOrder"][vector.index(1)],
        )
        assert not hasattr(outcome, "receipt")
        assert stage._cursor_campaign_state == "diagnosed"
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize(
    "case_id",
    ["checkpoint-sequence-order", "checkpoint-created-order", "checkpoint-id-order"],
    ids=[
        "b2:checkpoint-sequence-order",
        "b2:checkpoint-created-order",
        "b2:checkpoint-id-order",
    ],
)
def test_exact_checkpoint_snapshot_ordering_cases_are_one_hot(case_id: str) -> None:
    vector = (0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
    _assert_hostile_case(case_id, vector)
    rows: list[tuple[object, ...]] = []

    def populate(connection: Any) -> None:
        record_zero = create_cycle_store_record(
            record_id="record-order-0",
            sequence=0,
            previous_record_hash=None,
            value=0,
        )
        record_one = create_cycle_store_record(
            record_id="record-order-1",
            sequence=1,
            previous_record_hash=cast(str, record_zero["recordHash"]),
            value=1,
        )
        connection.execute(
            "INSERT INTO ge_cycle_streams "
            "(tenant_id, stream_id, tail_sequence, tail_record_hash, created_at_ms, updated_at_ms) "
            "VALUES ('tenant-order', 'stream-order', 1, ?, 1000, 1000)",
            (record_one["recordHash"],),
        ).close()
        for record in (record_zero, record_one):
            connection.execute(
                "INSERT INTO ge_cycle_records "
                "(tenant_id, stream_id, sequence, record_id, previous_record_hash, "
                "value_hash, value_bytes, value_blob, record_hash, record_blob, committed_at_ms) "
                "VALUES ('tenant-order', 'stream-order', ?, ?, ?, ?, ?, ?, ?, ?, 1000)",
                (
                    record["sequence"],
                    record["recordId"],
                    record["previousRecordHash"],
                    record["valueHash"],
                    record["valueBytes"],
                    canonical_bytes(record["value"]),
                    record["recordHash"],
                    canonical_bytes(record),
                ),
            ).close()
        record_hashes = {
            0: cast(str, record_zero["recordHash"]),
            1: cast(str, record_one["recordHash"]),
        }
        if case_id == "checkpoint-sequence-order":
            definitions = (
                ("checkpoint-a", 0, "2026-07-28T00:00:00Z"),
                ("checkpoint-b", 1, "2026-07-28T00:00:00Z"),
            )
        elif case_id == "checkpoint-created-order":
            definitions = (
                ("checkpoint-a", 1, "2026-07-28T00:00:00Z"),
                ("checkpoint-b", 1, "2026-07-28T00:00:01Z"),
            )
        else:
            definitions = (
                ("checkpoint-z", 1, "2026-07-28T00:00:00Z"),
                ("checkpoint-a", 1, "2026-07-28T00:00:00Z"),
            )
        summaries: list[dict[str, object]] = []
        for revision, (checkpoint_id, sequence, created_at) in enumerate(definitions, 1):
            checkpoint = create_cycle_store_checkpoint(
                checkpoint_scope="scope-order",
                checkpoint_id=checkpoint_id,
                stream_id="stream-order",
                bound_sequence=sequence,
                bound_record_hash=record_hashes[sequence],
                created_at=created_at,
                value=revision,
            )
            summary_value = {key: value for key, value in checkpoint.items() if key != "value"}
            summary_blob = cycle_store_adapter_codec.encode_ledger_result(
                "save-checkpoint", summary_value
            )
            connection.execute(
                "INSERT INTO ge_cycle_checkpoint_revisions "
                "(tenant_id, checkpoint_scope, revision, checkpoint_id, action, "
                "summary_blob, bound_sequence, bound_record_hash, checkpoint_created_at, "
                "value_hash, value_bytes, recorded_at_ms) "
                "VALUES (?, 'scope-order', ?, ?, 'put', ?, ?, ?, ?, ?, ?, ?)",
                (
                    "tenant-order",
                    revision,
                    checkpoint_id,
                    summary_blob,
                    sequence,
                    checkpoint["boundRecordHash"],
                    created_at,
                    checkpoint["valueHash"],
                    checkpoint["valueBytes"],
                    1_000,
                ),
            ).close()
            connection.execute(
                "INSERT INTO ge_cycle_checkpoints "
                "(tenant_id, checkpoint_scope, checkpoint_id, stream_id, bound_sequence, "
                "bound_record_hash, created_at, value_hash, value_bytes, value_blob, "
                "checkpoint_blob, summary_blob, checkpoint_revision, committed_at_ms) "
                "VALUES ('tenant-order', 'scope-order', ?, 'stream-order', "
                "?, ?, ?, ?, ?, ?, ?, ?, ?, 1000)",
                (
                    checkpoint_id,
                    sequence,
                    checkpoint["boundRecordHash"],
                    created_at,
                    checkpoint["valueHash"],
                    checkpoint["valueBytes"],
                    canonical_bytes(checkpoint["value"]),
                    canonical_bytes(checkpoint),
                    summary_blob,
                    revision,
                ),
            ).close()
            summaries.append(summary_value)
        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        identity_cursor.close()
        row = (
            "tenant-order",
            "9" * 64,
            "checkpoint",
            "b" * 64,
            "c" * 64,
            None,
            "scope-order",
            canonical_bytes(
                {
                    "checkpointScope": "scope-order",
                    "contractVersion": "cycle-store-provider/v1alpha1",
                    "pageSize": 2,
                }
            ),
            2,
            0,
            None,
            None,
            descriptor,
            schema,
            canonical_bytes(summaries),
            500,
            1500,
            None,
        )
        connection.execute(
            "INSERT INTO ge_cycle_cursors VALUES "
            "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            row,
        ).close()
        rows.append(row)
        connection.commit()

    connection, summary, stage, identity = _prepare_legacy(populate)
    report = run_sqlite_v1_legacy_invariant_campaign(summary, identity, stage)
    assert report.diagnostics == ()
    receipt = _receipt_for_rows(summary, identity, tuple(rows))
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert outcome.status == "diagnosed"
        assert outcome.vector == vector
        assert tuple(diagnostic.rule_id for diagnostic in outcome.diagnostics) == (
            "BLR_CURSOR_CHECKPOINT_BINDING",
        )
        assert not hasattr(outcome, "receipt")
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:equal-count-insert-delete"])
def test_equal_count_insert_delete_is_detected_by_a1_root(_b2_case: None) -> None:
    case_id = "equal-count-insert-delete"
    scenario = _HOSTILE_CASES[case_id]
    assert scenario["outcome"] == "stale-authority"
    connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence()
    original = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    assert len(original) == 1
    replacement = list(original[0])
    replacement[1] = "f" * 64
    delete_cursor = connection.execute(
        "DELETE FROM main.ge_cycle_cursors WHERE tenant_id = ? AND token_hash = ?",
        (original[0][0], original[0][1]),
    )
    delete_cursor.close()
    insert_cursor = connection.execute(
        "INSERT INTO main.ge_cycle_cursors VALUES "
        "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        tuple(replacement),
    )
    insert_cursor.close()
    assert _read_all_rows(connection, "SELECT count(*) FROM main.ge_cycle_cursors") == ((1,),)
    # The mutation occurs before B2 takes transfer ownership. Synchronize the
    # predecessor's write fence to characterize the independent equal-count A1 root gate.
    stage._allowed_total_changes = connection.total_changes
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="cursor immutable root drifted"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("_b2_case", [None], ids=["b2:source-table-ddl-replacement"])
def test_source_table_real_ddl_replacement_is_catalog_corruption(
    _b2_case: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    case_id = "source-table-ddl-replacement"
    scenario = _HOSTILE_CASES[case_id]
    assert scenario["outcome"] == "catalog-corruption"
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    original_execute = campaign_module._OWNER_EXECUTE
    raw = connection._SQLiteV1BaselineConnectionOwner__connection
    table_sql = cast(
        str,
        raw.execute(
            "SELECT sql FROM main.sqlite_schema WHERE type = 'table' AND name = 'ge_cycle_cursors'"
        ).fetchone()[0],
    )
    replaced = False

    def execute_with_real_table_replacement(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal replaced
        if sql.startswith("EXPLAIN QUERY PLAN ") and not replaced:
            replaced = True
            raw.execute("ALTER TABLE main.ge_cycle_cursors RENAME TO ge_cycle_cursors_old")
            raw.execute(table_sql)
            raw.execute("DROP TABLE main.ge_cycle_cursors_old")
            (
                stage._legacy_main_schema_version,
                stage._legacy_main_operation_catalog,
            ) = stage._read_legacy_main_catalog()
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", execute_with_real_table_replacement)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="source catalog identity drifted"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert replaced
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("role", ["source", "seal", "rule"])
@pytest.mark.parametrize(
    ("fetch_phase", "failure_fetch"),
    [("first", 1), ("middle", 2), ("final", 3), ("terminal", 4)],
)
def test_registered_cursor_fetch_lifecycle_matrix_preserves_primary_and_cleanup_once(
    role: str,
    fetch_phase: str,
    failure_fetch: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if role == "rule":
        connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence(
            scope_extra=True,
            count=3,
        )
        target_sql = cast(str, _ROW_MARKER_SQL[1])
    else:
        connection, _summary, stage, _identity, receipt = _prepared_streaming_scale_fence(3)
        target_sql = (
            SQLITE_CURSOR_MAIN_PROJECTION_SQL
            if role == "source"
            else SQLITE_CURSOR_SEAL_PROJECTION_SQL
        )
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    original_close = stage_module._CURSOR_CLOSE
    target_cursor_id: int | None = None
    fetches = 0
    closes = 0
    primary = RuntimeError(f"{role}-{fetch_phase}-fetch-primary")

    def identify_target(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal target_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql:
            target_cursor_id = id(cursor)
        return cursor

    def fail_positioned_fetch(cursor: Any) -> Any:
        nonlocal fetches
        if id(cursor) == target_cursor_id:
            fetches += 1
            if fetches == failure_fetch:
                raise primary
        return original_fetchone(cursor)

    def count_target_close(cursor: Any) -> None:
        nonlocal closes
        if id(cursor) == target_cursor_id:
            closes += 1
        original_close(cursor)

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", identify_target)
    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", fail_positioned_fetch)
    monkeypatch.setattr(stage_module, "_CURSOR_CLOSE", count_target_close)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(RuntimeError) as raised:
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert raised.value is primary
        assert fetches == failure_fetch
        assert closes == 1
        _assert_terminal_fault_postconditions(
            stage,
            primary,
            permanent_before=permanent_before,
            connection=connection,
        )
        stage.dispose()
        assert closes == 1
    finally:
        _cleanup(connection, stage)


@pytest.mark.parametrize("rule_index", range(10))
def test_every_rule_transition_external_write_is_terminal(
    rule_index: int,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_fence()
    target_sql = (
        SQLITE_CURSOR_COUNT_MARKER_SQL
        if rule_index == 6
        else cast(str, _ROW_MARKER_SQL[rule_index])
    )
    original_execute = campaign_module._OWNER_EXECUTE
    original_close = stage_module._CURSOR_CLOSE
    target_cursor_id: int | None = None
    mutated = False

    def identify_target(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal target_cursor_id
        cursor = original_execute(owner, sql, parameters)
        if sql == target_sql:
            target_cursor_id = id(cursor)
        return cursor

    def mutate_at_transition(cursor: Any) -> None:
        nonlocal mutated
        original_close(cursor)
        if id(cursor) == target_cursor_id and not mutated:
            mutated = True
            write = original_execute(
                connection,
                "UPDATE main.ge_cycle_migration_lock "
                "SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1",
            )
            write.close()

    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", identify_target)
    monkeypatch.setattr(stage_module, "_CURSOR_CLOSE", mutate_at_transition)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        with pytest.raises(ValueError, match="BLR_UNEXPLAINED_WRITE"):
            _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert mutated
        assert stage.state == "poisoned"
        assert stage._cursor_campaign_active_cursor is None
    finally:
        _cleanup(connection, stage)


def test_oversized_valid_text_keys_stage_as_two_unique_rule1_only_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_streaming_scale_fence(2)
    original_fetchone = campaign_module._CURSOR_FETCHONE
    source_ordinal = 0

    def replace_source_keys(cursor: Any) -> Any:
        nonlocal source_ordinal
        row = original_fetchone(cursor)
        if type(row) is tuple and len(row) == 18:
            source_ordinal += 1
            hostile = list(row)
            hostile[0] = f"tenant-{source_ordinal}-" + "t" * 256
            hostile[1] = f"{source_ordinal}" + "f" * 128
            return tuple(hostile)
        return row

    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", replace_source_keys)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert outcome.status == "diagnosed"
        assert outcome.vector == (2, 0, 0, 0, 0, 0, 0, 0, 0, 0)
        assert _read_all_rows(
            connection,
            "SELECT count(*), count(DISTINCT token_hash), count(DISTINCT tenant_id) "
            "FROM temp.ge_blr_cursor_seal",
        ) == ((2, 2, 2),)
    finally:
        _cleanup(connection, stage)


def test_ordinal_sentinel_collision_stays_diagnosed_and_preserves_main(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_streaming_scale_fence(2)
    permanent_before = _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL)
    original_fetchone = campaign_module._CURSOR_FETCHONE
    source_ordinal = 0
    ordinal_two_sentinel_token = hashlib.sha256(
        b"graph-engineering/sqlite-cursor-inspection-sentinel/v1\0" + b"2:token"
    ).hexdigest()

    def inject_former_collision(cursor: Any) -> Any:
        nonlocal source_ordinal
        row = original_fetchone(cursor)
        if type(row) is not tuple or len(row) != 18:
            return row
        source_ordinal += 1
        staged = list(row)
        if source_ordinal == 1:
            staged[0] = "tenant-z"
            staged[1] = ordinal_two_sentinel_token
        else:
            staged[0] = "tenant-z"
            staged[1] = "f" * 100_000
        return tuple(staged)

    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", inject_former_collision)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert outcome.status == "diagnosed"
        assert outcome.vector == (1, 0, 0, 0, 0, 0, 0, 0, 0, 0)
        assert len(outcome.diagnostics) == 1
        assert outcome.diagnostics[0].rule_id == "BLR_CURSOR_AUTHORIZATION"
        assert outcome.diagnostics[0].violation_count == 1
        assert _read_all_rows(
            connection,
            "SELECT token_hash, tenant_id, seal_eligible "
            "FROM temp.ge_blr_cursor_seal ORDER BY token_hash COLLATE BINARY",
        ) == (
            ("!ge-invalid-token-2", "tenant-z", 0),
            (ordinal_two_sentinel_token, "tenant-z", 1),
        )
        assert _read_all_rows(connection, SQLITE_CURSOR_MAIN_PROJECTION_SQL) == permanent_before
        assert not hasattr(outcome, "receipt")
        assert stage._cursor_campaign_state == "diagnosed"
        assert stage.state == "open"
    finally:
        _cleanup(connection, stage)


def test_key_storage_nonstageable_is_r1_r8_plus_independent_r7(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection, _summary, stage, _identity, receipt = _prepared_event_empty_fence()
    original_fetchone = campaign_module._CURSOR_FETCHONE
    insert_calls = 0
    original_execute = campaign_module._OWNER_EXECUTE

    def inject_bad_key_storage(cursor: Any) -> Any:
        row = original_fetchone(cursor)
        if type(row) is tuple and len(row) == 18 and row[1] == "1".zfill(64):
            hostile = list(row)
            hostile[0] = 7
            hostile[1] = bytes(32)
            return tuple(hostile)
        return row

    def count_inserts(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal insert_calls
        if sql == SQLITE_CURSOR_SEAL_INSERT_SQL:
            insert_calls += 1
        return original_execute(owner, sql, parameters)

    monkeypatch.setattr(campaign_module, "_CURSOR_FETCHONE", inject_bad_key_storage)
    monkeypatch.setattr(campaign_module, "_OWNER_EXECUTE", count_inserts)
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(connection, stage, receipt)
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        outcome = _run_sqlite_cursor_pre_rebind_campaign(connection, stage, receipt, transfer)
        assert outcome.status == "diagnosed"
        assert outcome.vector == (1, 0, 0, 0, 0, 0, 1, 1, 0, 0)
        assert insert_calls == 0
        assert _read_all_rows(connection, "SELECT count(*) FROM temp.ge_blr_cursor_seal") == ((0,),)
    finally:
        _cleanup(connection, stage)
