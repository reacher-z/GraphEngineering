#!/usr/bin/env python3
"""Emit Python B2 cursor contract/inspector evidence for the parity gate."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any, cast

from graph_engineering.sqlite_operation_baseline_cursor_campaign import (
    _ROW_MARKER_SQL,
    _RULES,
    DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
    MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
    SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL,
    SQLITE_CURSOR_COUNT_MARKER_SQL,
    SQLITE_CURSOR_EVENT_LOOKUP_SQL,
    SQLITE_CURSOR_SEAL_INSERT_SQL,
    SQLITE_CURSOR_SEAL_PROJECTION_SQL,
)
from graph_engineering.sqlite_operation_baseline_cursor_inspection import (
    _inspect_sqlite_v1_cursor_row,
)
from graph_engineering.sqlite_operation_baseline_cursor_invariants import (
    SQLITE_CURSOR_PHYSICAL_FIELDS,
    SQLiteCursorSealAccumulator,
    sqlite_cursor_seal_carrier_document,
    sqlite_cursor_seal_row_digest,
)
from graph_engineering.sqlite_operation_baseline_cursor_ownership import (
    SQLITE_CURSOR_MAIN_PROJECTION_SQL,
)


def _normalized_sql(value: str) -> str:
    return re.sub(r"[\t\n\v\f\r ]+", " ", value.strip())


def _sql_entry(value: str) -> dict[str, str]:
    normalized = _normalized_sql(value)
    return {
        "normalized": normalized,
        "sha256": hashlib.sha256(normalized.encode("ascii")).hexdigest(),
    }


def _fixture_canonical_sha256(fixture: dict[str, Any]) -> str:
    canonical = json.loads(json.dumps(fixture))
    canonical["parityGates"]["fixtureCanonicalSha256"] = "0" * 64
    encoded = json.dumps(
        canonical,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _decode_wire_value(value: object) -> object:
    if type(value) is dict and set(cast(dict[str, object], value)) == {"bytesBase64"}:
        encoded = cast(dict[str, object], value)["bytesBase64"]
        if type(encoded) is not str:
            raise TypeError("bytesBase64 must be a string")
        return base64.b64decode(encoded, validate=True)
    return value


def _physical_row(literal: dict[str, object]) -> list[object]:
    materialized = dict(literal)
    request = materialized.pop("request_scope_blob_utf8")
    snapshot = materialized.pop("snapshot_blob_utf8")
    if type(request) is not str or type(snapshot) is not str:
        raise TypeError("fixture cursor BLOB text must be a string")
    materialized["request_scope_blob"] = request.encode("utf-8")
    materialized["snapshot_blob"] = snapshot.encode("utf-8")
    return [materialized[field] for field in SQLITE_CURSOR_PHYSICAL_FIELDS]


def _history(vector: dict[str, Any]) -> tuple[set[tuple[object, ...]], set[tuple[object, ...]]]:
    events = {
        (row["tenant_id"], row["stream_id"], row["sequence"], row["record_hash"])
        for row in vector["eventHistory"]
    }
    checkpoints = {
        (
            row["tenant_id"],
            row["checkpoint_scope"],
            row["checkpoint_id"],
            row["summary_blob_utf8"].encode("utf-8"),
        )
        for row in vector["checkpointPutHistory"]
    }
    return events, checkpoints


def _case_report(
    fixture: dict[str, Any],
    specification: dict[str, Any],
) -> dict[str, Any]:
    vector = next(
        item for item in fixture["semanticVectors"] if item["name"] == specification["vector"]
    )
    events, checkpoints = _history(vector)
    inspected_rows = []
    maximum_live_raw_rows = 0
    maximum_live_inspections = 0
    for ordinal, source in enumerate(specification["rows"], start=1):
        row = _physical_row(dict(fixture["literalRows"][source["literal"]]))
        for mutation in source.get("mutations", []):
            field = mutation["field"]
            row[SQLITE_CURSOR_PHYSICAL_FIELDS.index(field)] = _decode_wire_value(mutation["value"])
        if "truncateTo" in source:
            del row[source["truncateTo"] :]
        maximum_live_raw_rows = max(maximum_live_raw_rows, 1)
        inspected = _inspect_sqlite_v1_cursor_row(
            tuple(row),
            source_ordinal=ordinal,
            source_descriptor_hash=vector["identities"]["descriptorHash"],
            source_schema_identity_sha256=vector["identities"]["schemaIdentitySha256"],
            provider_high_water_at_ms=vector["clocks"]["providerHighWaterAtMs"],
            event_tail_exists=(
                (lambda *_args: False)
                if source.get("eventLookup") == "miss"
                else lambda tenant, stream, sequence, record_hash: (
                    tenant,
                    stream,
                    sequence,
                    record_hash,
                )
                in events
            ),
            checkpoint_revision_exists=(
                (lambda *_args: False)
                if source.get("checkpointLookup") == "miss"
                else lambda tenant, scope, checkpoint_id, summary: (
                    tenant,
                    scope,
                    checkpoint_id,
                    summary,
                )
                in checkpoints
            ),
        )
        inspected_rows.append(inspected)
        maximum_live_inspections = max(maximum_live_inspections, 1)

    rule_indexes = (0, 1, 2, 3, 4, 5, 7, 8, 9)
    counts = [0] * 10
    stage_tuples: list[list[object]] = []
    pre_stage_tuples: list[list[object]] = []
    seal_rows = []
    row_digests: list[str] = []
    for inspected in inspected_rows:
        if not inspected.stageable:
            pre_stage_tuples.append(list(inspected.insert_values))
            if not inspected.source_key_storage_ok:
                counts[0] += 1
            counts[7] += 1
            continue
        stage_tuples.append(list(inspected.insert_values))
        for flag, rule_index in zip(inspected.rule_flags, rule_indexes, strict=True):
            if not flag:
                counts[rule_index] += 1
        if inspected.seal_row is not None:
            seal_rows.append(inspected.seal_row)
            row_digests.append(sqlite_cursor_seal_row_digest(inspected.seal_row.carrier).hex())

    walked = len(inspected_rows)
    staged = len(stage_tuples)
    captured = specification["capturedCount"]
    counts[6] = 1 if captured != walked or walked != staged else 0
    diagnostics = [
        {"ruleId": rule_id, "violationCount": counts[index], "diagnosticsTruncated": False}
        for index, (rule_id, _flag) in enumerate(_RULES)
        if counts[index] != 0
    ]
    clean = counts == [0] * 10
    root: str | None = None
    carriers: list[dict[str, object]] = []
    if clean:
        seal_rows.sort(key=lambda item: (item.carrier.token_hash.encode(), item.carrier.tenant_id.encode()))
        accumulator = SQLiteCursorSealAccumulator(
            captured,
            vector["identities"]["descriptorHash"],
            vector["identities"]["schemaIdentitySha256"],
        )
        for seal_row in seal_rows:
            accumulator.append(seal_row)
            carriers.append(sqlite_cursor_seal_carrier_document(seal_row.carrier))
        root = accumulator.finish().immutable_root_sha256

    return {
        "id": specification["id"],
        "vector": counts,
        "diagnostics": diagnostics,
        "preStageTuples": pre_stage_tuples,
        "stageTuples": stage_tuples,
        "rowDigests": row_digests,
        "carriers": carriers,
        "rootSha256": root,
        "outcome": "pre-rebind-complete" if clean else "diagnosed",
        "resourceObservation": {
            "walkedRows": walked,
            "stagedRows": staged,
            "sealEligibleRows": len(seal_rows),
            "maximumFetchSize": 1 if walked else 0,
            "maximumLiveRawRows": maximum_live_raw_rows,
            "maximumLiveInspections": maximum_live_inspections,
        },
    }


def main() -> None:
    payload = cast(dict[str, Any], json.load(sys.stdin))
    fixture_path = Path(payload["fixturePath"]).resolve()
    fixture = cast(dict[str, Any], json.loads(fixture_path.read_text(encoding="utf-8")))
    sql = {
        "source": _sql_entry(SQLITE_CURSOR_MAIN_PROJECTION_SQL),
        "insert": _sql_entry(SQLITE_CURSOR_SEAL_INSERT_SQL),
        "seal": _sql_entry(SQLITE_CURSOR_SEAL_PROJECTION_SQL),
        "countMarker": _sql_entry(SQLITE_CURSOR_COUNT_MARKER_SQL),
        "eventLookup": _sql_entry(SQLITE_CURSOR_EVENT_LOOKUP_SQL),
        "checkpointLookup": _sql_entry(SQLITE_CURSOR_CHECKPOINT_LOOKUP_SQL),
        "rowMarkers": [
            {"ruleId": rule_id, **_sql_entry(cast(str, _ROW_MARKER_SQL[index]))}
            for index, (rule_id, _flag) in enumerate(_RULES)
            if _ROW_MARKER_SQL[index] is not None
        ],
    }
    report = {
        "schemaVersion": 1,
        "runtime": "python",
        "fixtureId": fixture["id"],
        "fixtureSha256": _fixture_canonical_sha256(fixture),
        "contract": {
            "diagnosticLimits": {
                "minimum": 1,
                "default": DEFAULT_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
                "maximum": MAX_SQLITE_CURSOR_DIAGNOSTIC_LIMIT,
            },
            "ruleOrder": [rule_id for rule_id, _flag in _RULES],
            "sql": sql,
        },
        "cases": [_case_report(fixture, item) for item in payload["cases"]],
        "remainingEvidence": payload["remainingEvidence"],
    }
    json.dump(report, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
