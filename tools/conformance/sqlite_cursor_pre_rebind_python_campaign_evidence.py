#!/usr/bin/env python3
"""Run real Python 128/1024-row B2 campaigns and emit measured JSON evidence."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, cast

ROOT = Path(__file__).resolve().parents[2]
PYTHON_ROOT = ROOT / "python"
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import graph_engineering.sqlite_operation_baseline_cursor_campaign as campaign_module
from graph_engineering.canonical import canonical_bytes
from graph_engineering.sqlite_operation_baseline_cursor_campaign import (
    SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
    SQLITE_CURSOR_EVENT_LOOKUP_SQL,
    _run_sqlite_cursor_pre_rebind_campaign,
    _SQLiteCursorCampaignResourceProbe,
)
from graph_engineering.sqlite_operation_baseline_cursor_ownership import (
    assert_sqlite_cursor_pre_rebind_receipt_provenance,
)
from graph_engineering.sqlite_operation_baseline_cursor_stage_ownership import (
    _begin_sqlite_cursor_stage_ownership_transfer,
    _create_sqlite_cursor_seal_temp_table,
)
from graph_engineering.sqlite_operation_baseline_legacy_invariants import (
    run_sqlite_v1_legacy_invariant_campaign,
)
from tests.test_sqlite_operation_baseline_cursor_campaign import (
    _cleanup,
    _read_all_rows,
    _streaming_receipt_for_connection,
)
from tests.test_sqlite_operation_baseline_legacy_invariants import _prepare_legacy
from tests.test_sqlite_operation_baseline_source import add_checkpoint_history


def _normalize_details(details: tuple[str, ...]) -> list[str]:
    return [" ".join(detail.split()).upper() for detail in details]


def _prepared_lookup_scale_fence(population: int) -> tuple[Any, Any, Any, Any, Any]:
    if population < 2:
        raise ValueError("lookup scale evidence requires at least two rows")

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
        summary = {key: value for key, value in checkpoint.items() if key != "value"}
        identity_cursor = connection.execute(
            "SELECT provider_descriptor_hash, schema_identity_sha256 "
            "FROM ge_cycle_schema WHERE singleton = 1"
        )
        descriptor, schema = cast(tuple[str, str], identity_cursor.fetchone())
        identity_cursor.close()
        rows: list[tuple[object, ...]] = [
            (
                "tenant-a",
                f"{1:064x}",
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
                checkpoint["boundRecordHash"],
                descriptor,
                schema,
                canonical_bytes(
                    {
                        "exists": True,
                        "recordHash": checkpoint["boundRecordHash"],
                        "sequence": 0,
                    }
                ),
                500,
                1500,
                None,
            ),
            (
                "tenant-a",
                f"{2:064x}",
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
                canonical_bytes([summary]),
                500,
                1500,
                None,
            ),
        ]
        for index in range(3, population + 1):
            reverse = population - index + 1
            tenant = f"tenant-scale-{reverse:04d}"
            stream = f"stream-scale-{reverse:04d}"
            rows.append(
                (
                    tenant,
                    f"{index:064x}",
                    "event",
                    "b" * 64,
                    "c" * 64,
                    stream,
                    None,
                    canonical_bytes(
                        {
                            "contractVersion": "cycle-store-provider/v1alpha1",
                            "pageSize": 1,
                            "streamId": stream,
                        }
                    ),
                    1,
                    0,
                    -1,
                    None,
                    descriptor,
                    schema,
                    canonical_bytes(
                        {"exists": False, "recordHash": None, "sequence": -1}
                    ),
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
    if report.diagnostics:
        raise AssertionError("lookup scale predecessor campaign diagnosed")
    receipt = _streaming_receipt_for_connection(
        summary, identity, connection, expected_count=population
    )
    return connection, summary, stage, identity, receipt


def _run(population: int) -> dict[str, Any]:
    connection, _summary, stage, identity, receipt = _prepared_lookup_scale_fence(
        population
    )
    probe = _SQLiteCursorCampaignResourceProbe()
    original_execute = campaign_module._OWNER_EXECUTE
    original_fetchone = campaign_module._CURSOR_FETCHONE
    original_close = campaign_module._CURSOR_CLOSE
    point_lookup_executions = 0
    point_lookup_executions_by_kind = {"event": 0, "checkpoint": 0}
    active_point_lookup_ids: set[int] = set()
    maximum_nested_point_lookup = 0

    def measured_execute(
        owner: Any,
        sql: str,
        parameters: tuple[object, ...] = (),
    ) -> Any:
        nonlocal maximum_nested_point_lookup, point_lookup_executions
        cursor = original_execute(owner, sql, parameters)
        if sql in {SQLITE_CURSOR_EVENT_LOOKUP_SQL, SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL}:
            point_lookup_executions += 1
            kind = "event" if sql == SQLITE_CURSOR_EVENT_LOOKUP_SQL else "checkpoint"
            point_lookup_executions_by_kind[kind] += 1
            active_point_lookup_ids.add(id(cursor))
            maximum_nested_point_lookup = max(
                maximum_nested_point_lookup, len(active_point_lookup_ids)
            )
        return cursor

    def measured_fetchone(cursor: Any) -> Any:
        return original_fetchone(cursor)

    def measured_close(cursor: Any) -> None:
        try:
            original_close(cursor)
        finally:
            active_point_lookup_ids.discard(id(cursor))

    campaign_module._OWNER_EXECUTE = measured_execute
    campaign_module._CURSOR_FETCHONE = measured_fetchone
    campaign_module._CURSOR_CLOSE = measured_close
    try:
        transfer = _begin_sqlite_cursor_stage_ownership_transfer(
            connection, stage, receipt
        )
        _create_sqlite_cursor_seal_temp_table(connection, stage, receipt, transfer)
        pages_before = cast(
            int,
            _read_all_rows(
                connection, "SELECT page_count FROM pragma_page_count('temp')"
            )[0][0],
        )
        outcome = _run_sqlite_cursor_pre_rebind_campaign(
            connection,
            stage,
            receipt,
            transfer,
            _resource_probe=probe,
        )
        pages_after = cast(
            int,
            _read_all_rows(
                connection, "SELECT page_count FROM pragma_page_count('temp')"
            )[0][0],
        )
        temp_objects = _read_all_rows(
            connection,
            "SELECT type, name FROM temp.sqlite_schema WHERE name = 'ge_blr_cursor_seal'",
        )
        temp_rows = cast(
            int,
            _read_all_rows(connection, "SELECT count(*) FROM temp.ge_blr_cursor_seal")[
                0
            ][0],
        )
        observed_root = assert_sqlite_cursor_pre_rebind_receipt_provenance(
            outcome.receipt
        ).immutable_seal_receipt.immutable_root_sha256
        expected_root = assert_sqlite_cursor_pre_rebind_receipt_provenance(
            receipt
        ).immutable_seal_receipt.immutable_root_sha256
        return {
            "population": population,
            "outcome": outcome.status,
            "exactInputReceipt": outcome.receipt is receipt,
            "exactProjectionIdentity": outcome.projection_identity is identity,
            "expectedRootSha256": expected_root,
            "observedRootSha256": observed_root,
            "resourceEvidence": {
                "maximumActiveRegisteredCursors": probe.maximum_active_registered_cursors,
                "maximumNestedPointLookup": maximum_nested_point_lookup,
                "pointLookupExecutions": point_lookup_executions,
                "pointLookupExecutionsByKind": point_lookup_executions_by_kind,
                "pointLookupEvidence": "instrumented-owner-execute-and-cursor-close",
                "finalNestedPointLookup": len(active_point_lookup_ids),
                "maximumFetchSize": probe.maximum_fetch_size,
                "maximumLiveRawRows": probe.maximum_live_raw_rows,
                "maximumLiveDecodedSnapshots": probe.maximum_live_decoded_snapshots,
                "maximumLiveCarriers": probe.maximum_live_carriers,
                "maximumTempObjects": probe.maximum_temp_objects,
                "currentTempObjectCount": probe.final_physical_temp_objects,
                "finalTempObjectCount": probe.final_physical_temp_objects,
                "tempObjectMeasurements": probe.temp_object_measurements,
                "tempObjectCountEvidence": "in-campaign-temp-schema-scalar",
                "maximumTempRows": probe.maximum_temp_rows,
                "finalActiveRegisteredCursors": probe.current_active_registered_cursors,
                "finalLiveRawRows": probe.current_live_raw_rows,
                "finalLiveDecodedSnapshots": probe.current_live_decoded_snapshots,
                "finalLiveCarriers": probe.current_live_carriers,
                "tempObjectCount": len(temp_objects),
                "tempObjectMeasurementProvenance": "in-campaign-temp-schema-scalar",
                "tempRowCount": temp_rows,
                "tempPageCountBefore": pages_before,
                "tempPageCountAfter": pages_after,
            },
            "eqpEvidenceProvenance": "in-campaign-registered-cursor",
            "eqp": [
                {"kind": kind, "sql": sql, "details": _normalize_details(details)}
                for kind, sql, details in probe.eqp_evidence
            ],
        }
    finally:
        campaign_module._OWNER_EXECUTE = original_execute
        campaign_module._CURSOR_FETCHONE = original_fetchone
        campaign_module._CURSOR_CLOSE = original_close
        _cleanup(connection, stage)


def main() -> None:
    populations = [int(value) for value in sys.argv[1:]] or [128, 1_024]
    if any(population not in {128, 1_024} for population in populations):
        raise ValueError("production evidence population must be 128 or 1024")
    report = {
        "schemaVersion": 1,
        "runtime": "python",
        "contract": "sqlite-cursor-pre-rebind-v1-production-campaign-evidence",
        "campaigns": [_run(population) for population in populations],
    }
    print(json.dumps(report, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
