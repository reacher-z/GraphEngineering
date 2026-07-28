from __future__ import annotations

import hashlib
import json
from dataclasses import replace
from itertools import pairwise
from pathlib import Path
from typing import Any

import pytest

from graph_engineering.canonical import canonical_bytes
from graph_engineering.sqlite_operation_baseline import (
    BASELINE_EMPTY_ROOT,
    BASELINE_ENTRY_DOMAIN,
    BASELINE_ENTRY_KINDS,
    BASELINE_GENESIS_HASH,
    BASELINE_ID_DOMAIN,
    BASELINE_PROJECTION_DOMAIN,
    MAX_BASELINE_KEY_BYTES,
    MAX_BASELINE_STATE_BYTES,
    BaselineEntryInput,
    baseline_entry_sort_key,
    baseline_policy_matches,
    baseline_projection_document,
    build_baseline_projection,
    capture_baseline_entry,
    create_baseline_id,
    create_baseline_policy,
    encode_baseline_policy,
    sort_baseline_entries,
    validate_baseline_source_envelope,
    validate_preordered_baseline_entries,
)

H1 = "1" * 64
H2 = "2" * 64
H3 = "3" * 64
H4 = "4" * 64
ROOT = Path(__file__).resolve().parents[2]


def source_envelope() -> dict[str, Any]:
    return {
        "capturedAtMs": 1_000,
        "sourceApplicationId": 1_195_724_359,
        "sourceDescriptorHash": H1,
        "sourceMigrationLineageId": "fresh-v1-baseline",
        "sourceMigrationLineageSha256": H2,
        "sourceSchemaIdentitySha256": H3,
        "sourceUserVersion": 1,
    }


def entry_values() -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    checkpoint_summary = {
        "boundRecordHash": H1,
        "boundSequence": 0,
        "checkpointId": "checkpoint-a",
        "checkpointScope": "scope-a",
        "createdAt": "2026-07-27T00:00:00Z",
        "streamId": "stream-a",
        "valueBytes": 2,
        "valueHash": H2,
    }
    return [
        (
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
        ),
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
            {"streamId": "stream-a", "tenantId": "tenant-a"},
            {
                "activeAcquiredAtMs": 7,
                "activeExpiresAtMs": 1_007,
                "activeFencingToken": 1,
                "activeHolderId": "holder-a",
                "activeLeaseEpoch": 1,
                "activeLeaseId": "lease-a",
                "lastFencingToken": 1,
                "lastLeaseEpoch": 1,
                "streamId": "stream-a",
                "tenantId": "tenant-a",
                "updatedAtMs": 7,
            },
        ),
        (
            "used-lease-identity",
            {"leaseId": "lease-a", "streamId": "stream-a", "tenantId": "tenant-a"},
            {
                "fencingToken": 1,
                "firstUsedAtMs": 7,
                "leaseEpoch": 1,
                "leaseId": "lease-a",
                "streamId": "stream-a",
                "tenantId": "tenant-a",
            },
        ),
        (
            "legal-hold",
            {"holdId": "hold-a", "streamId": "stream-a", "tenantId": "tenant-a"},
            {"holdId": "hold-a", "placedAtMs": 8, "streamId": "stream-a", "tenantId": "tenant-a"},
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
            {"fencingToken": 1, "firstUsedAtMs": 9, "lockEpoch": 1, "lockId": "lock-a"},
        ),
        (
            "legacy-operation",
            {"operationId": "operation-a", "tenantId": "tenant-a"},
            {
                "committedAtMs": 10,
                "operationId": "operation-a",
                "operationName": "append",
                "requestHash": H1,
                "resultBlobSha256": H2,
                "resultHash": H3,
                "tenantId": "tenant-a",
            },
        ),
    ]


def capture_all() -> list[BaselineEntryInput]:
    return [capture_baseline_entry(kind, key, state) for kind, key, state in entry_values()]


def test_domains_roots_source_envelope_and_policy_match_frozen_contract() -> None:
    assert BASELINE_ID_DOMAIN.endswith("\0")
    assert BASELINE_ENTRY_DOMAIN.endswith("\0")
    assert BASELINE_PROJECTION_DOMAIN.endswith("\0")
    assert hashlib.sha256(
        b"graph-engineering/sqlite-operation-baseline-genesis/v1\0"
    ).hexdigest() == BASELINE_GENESIS_HASH
    assert hashlib.sha256(
        b"graph-engineering/sqlite-operation-baseline-empty/v1\0"
    ).hexdigest() == BASELINE_EMPTY_ROOT

    envelope = source_envelope()
    expected = hashlib.sha256(BASELINE_ID_DOMAIN.encode() + canonical_bytes(envelope)).hexdigest()
    assert create_baseline_id(envelope) == f"v2-{expected}"
    assert create_baseline_id(envelope) == (
        "v2-fb155d79e7b6efbebbbc92a6bc8d658233e8490ae629292dd776668a380e87a9"
    )
    detached = validate_baseline_source_envelope(envelope)
    envelope["capturedAtMs"] = 2_000
    assert detached["capturedAtMs"] == 1_000

    policy = create_baseline_policy()
    assert policy["entryKinds"] == list(BASELINE_ENTRY_KINDS)
    assert encode_baseline_policy() == canonical_bytes(policy)
    assert len(encode_baseline_policy()) == 946
    assert hashlib.sha256(encode_baseline_policy()).hexdigest() == (
        "67cbe0ac8bf04f28061d50f8b7089312cc1e1f9a9520ede95deec0d1f4ec5eb0"
    )
    assert baseline_policy_matches(policy)
    policy["legacyRequestRecovery"] = True
    assert not baseline_policy_matches(policy)


def test_all_twelve_closed_entry_kinds_have_exact_bounded_canonical_bytes() -> None:
    entries = capture_all()
    assert [entry.entry_kind for entry in entries] == list(BASELINE_ENTRY_KINDS)
    for entry in entries:
        assert entry.key_bytes == canonical_bytes(entry.key)
        assert entry.state_bytes == canonical_bytes(entry.state)
        assert 2 <= len(entry.key_bytes) <= MAX_BASELINE_KEY_BYTES
        assert 2 <= len(entry.state_bytes) <= MAX_BASELINE_STATE_BYTES

    kind, key, state = entry_values()[2]
    with pytest.raises(ValueError, match="closed"):
        capture_baseline_entry(kind, {**key, "unknown": True}, state)
    with pytest.raises(ValueError, match="closed"):
        capture_baseline_entry(kind, key, {**state, "unknown": True})
    with pytest.raises(ValueError, match="disagree"):
        capture_baseline_entry(kind, key, {**state, "streamId": "stream-b"})


def test_sort_chain_projection_and_empty_projection_are_deterministic() -> None:
    baseline_id = create_baseline_id(source_envelope())
    entries = capture_all()
    projection = build_baseline_projection(baseline_id, reversed(entries))
    assert [entry.entry_kind for entry in projection.entries] == list(BASELINE_ENTRY_KINDS)
    assert [entry.ordinal for entry in projection.entries] == list(range(12))
    assert projection.entries[0].previous_entry_hash == BASELINE_GENESIS_HASH
    assert all(
        current.previous_entry_hash == previous.entry_hash
        for previous, current in pairwise(projection.entries)
    )
    assert projection.entry_count == 12
    assert projection.legacy_operation_count == 1
    assert projection.first_entry_hash == projection.entries[0].entry_hash
    assert projection.final_entry_hash == projection.entries[-1].entry_hash
    projection_bytes = canonical_bytes(baseline_projection_document(projection))
    assert projection.projection_sha256 == hashlib.sha256(
        BASELINE_PROJECTION_DOMAIN.encode() + projection_bytes
    ).hexdigest()
    assert projection.projection_sha256 == (
        "ccddea9c7004d7190137d0da12c39dcf8210353f256be8974343b1e0871d42fe"
    )

    empty = build_baseline_projection(baseline_id, [])
    assert empty.entries == ()
    assert empty.entry_count == empty.legacy_operation_count == 0
    assert empty.first_entry_hash == empty.final_entry_hash == BASELINE_EMPTY_ROOT
    assert empty.projection_sha256 == (
        "6d2c46fcc04e36596646207051a43aa5e59e8c3638c3e4020d0e8c697d6dea8b"
    )


def test_sort_uses_unsigned_key_bytes_and_rejects_duplicates_or_preordered_drift() -> None:
    kind, _key, state = entry_values()[2]
    ascii_entry = capture_baseline_entry(
        kind,
        {"streamId": "a", "tenantId": "tenant-a"},
        {**state, "streamId": "a"},
    )
    unicode_entry = capture_baseline_entry(
        kind,
        {"streamId": "z", "tenantId": "tenant-a"},
        {**state, "streamId": "z"},
    )
    ordered = sort_baseline_entries([unicode_entry, ascii_entry])
    assert ordered == (ascii_entry, unicode_entry)
    assert baseline_entry_sort_key(ascii_entry) < baseline_entry_sort_key(unicode_entry)
    assert validate_preordered_baseline_entries(ordered) == ordered
    with pytest.raises(ValueError, match="canonical order"):
        validate_preordered_baseline_entries(reversed(ordered))
    with pytest.raises(ValueError, match="duplicate"):
        sort_baseline_entries([ascii_entry, replace(ascii_entry)])


def test_completed_projection_does_not_expose_mutable_hashed_state() -> None:
    kind, key, state = entry_values()[2]
    captured = capture_baseline_entry(kind, key, state)
    projection = build_baseline_projection(create_baseline_id(source_envelope()), [captured])
    entry = projection.entries[0]
    detached_key = entry.key
    detached_state = entry.state
    detached_key["streamId"] = "mutated"
    detached_state["streamId"] = "mutated"
    assert entry.key["streamId"] == "stream-a"
    assert entry.state["streamId"] == "stream-a"
    assert canonical_bytes(entry.key) == entry.key_bytes
    assert canonical_bytes(entry.state) == entry.state_bytes


def test_semantic_invariants_and_hostile_values_fail_without_value_leaks() -> None:
    cases: list[tuple[int, dict[str, Any], str]] = [
        (0, {"currentVersion": 2}, "version"),
        (1, {"previousVersion": 1}, "contiguous"),
        (2, {"tailRecordHash": None}, "tail"),
        (3, {"previousRecordHash": H1}, "predecessor"),
        (5, {"action": "delete"}, "null"),
        (6, {"lastFencingToken": 2}, "high-water"),
        (7, {"fencingToken": 2}, "fence"),
        (9, {"activeSourceVersion": 1}, "all null"),
        (10, {"fencingToken": 2}, "fence"),
        (11, {"operationName": "inspect-schema"}, "operation"),
    ]
    values = entry_values()
    for index, patch, message in cases:
        kind, key, state = values[index]
        with pytest.raises(ValueError, match=message):
            capture_baseline_entry(kind, key, {**state, **patch})

    marker = "MUST_NOT_LEAK_BASELINE_SECRET_91b5"
    kind, key, state = values[0]
    with pytest.raises(ValueError) as caught:
        capture_baseline_entry(kind, key, {**state, marker: marker})
    assert marker not in str(caught.value)

    cyclic: dict[str, Any] = {}
    cyclic["cycle"] = cyclic
    with pytest.raises(ValueError, match="portable JSON"):
        validate_baseline_source_envelope(cyclic)


def test_postconditions_checkpoint_summary_timestamps_and_payload_bounds_are_exact() -> None:
    values = entry_values()
    migration_kind, migration_key, migration_state = values[1]
    for postconditions in (
        {},
        {"requiredPostconditions": []},
        {"requiredPostconditions": [""]},
        {"requiredPostconditions": ["ok"], "unknown": True},
    ):
        with pytest.raises(ValueError):
            capture_baseline_entry(
                migration_kind,
                migration_key,
                {**migration_state, "postconditions": postconditions},
            )

    checkpoint_kind, checkpoint_key, checkpoint_state = values[4]
    summary = dict(checkpoint_state["summary"])
    for invalid_summary in (
        {key: value for key, value in summary.items() if key != "streamId"},
        {**summary, "unknown": True},
        {**summary, "valueHash": H4},
        {**summary, "createdAt": "2026-02-30T00:00:00Z"},
    ):
        with pytest.raises(ValueError):
            capture_baseline_entry(
                checkpoint_kind,
                checkpoint_key,
                {**checkpoint_state, "summary": invalid_summary},
            )
    for timestamp in ("", "2026-02-30T00:00:00Z", "2026-07-27 00:00:00Z"):
        with pytest.raises(ValueError, match="createdAt"):
            capture_baseline_entry(
                checkpoint_kind,
                checkpoint_key,
                {**checkpoint_state, "createdAt": timestamp},
            )

    revision_kind, revision_key, revision_state = values[5]
    revision_summary = dict(revision_state["summary"])
    with pytest.raises(ValueError, match="summary and baseline state disagree"):
        capture_baseline_entry(
            revision_kind,
            revision_key,
            {**revision_state, "summary": {**revision_summary, "valueBytes": 3}},
        )

    record_kind, record_key, record_state = values[3]
    with pytest.raises(ValueError, match="valueBytes is outside bounds"):
        capture_baseline_entry(
            record_kind,
            record_key,
            {**record_state, "valueBytes": 1_048_577},
        )
    with pytest.raises(ValueError, match="valueBytes is outside bounds"):
        capture_baseline_entry(
            checkpoint_kind,
            checkpoint_key,
            {
                **checkpoint_state,
                "valueBytes": 16_777_217,
                "summary": {**summary, "valueBytes": 16_777_217},
            },
        )

    legacy_kind, legacy_key, legacy_state = values[11]
    with pytest.raises(ValueError, match="nonempty"):
        capture_baseline_entry(
            legacy_kind,
            legacy_key,
            {**legacy_state, "operationName": ""},
        )


def test_storage_byte_ceilings_are_enforced_before_hashing() -> None:
    kind, key, state = entry_values()[1]
    oversized = {
        **state,
        "postconditions": {"requiredPostconditions": ["x" * MAX_BASELINE_STATE_BYTES]},
    }
    with pytest.raises(ValueError, match="state exceeds"):
        capture_baseline_entry(kind, key, oversized)

    # A forged input object cannot bypass capture-time byte bounds.
    valid = capture_baseline_entry(kind, key, state)
    forged = replace(valid, key_bytes=b"{}" + b"x" * MAX_BASELINE_KEY_BYTES)
    with pytest.raises(ValueError, match="canonical bytes drifted"):
        build_baseline_projection(create_baseline_id(source_envelope()), [forged])
    assert json.loads(valid.key_bytes) == key


def test_python_matches_the_shared_cross_language_baseline_fixture_byte_for_byte() -> None:
    fixture = json.loads(
        (ROOT / "spec/conformance/sqlite-operation-baseline-v2.case.json").read_text()
    )
    baseline_id = create_baseline_id(fixture["sourceEnvelope"])
    assert baseline_id == fixture["baselineId"]
    assert encode_baseline_policy().hex() == fixture["policyVector"]["canonicalHex"]

    captured: list[BaselineEntryInput] = []
    for vector in fixture["entryVectors"]:
        entry = capture_baseline_entry(
            vector["entryKind"],
            vector["key"]["value"],
            vector["state"]["value"],
        )
        assert entry.key_bytes.hex() == vector["key"]["canonicalHex"]
        assert entry.state_bytes.hex() == vector["state"]["canonicalHex"]
        captured.append(entry)

    projection = build_baseline_projection(baseline_id, captured)
    assert [entry.entry_hash for entry in projection.entries] == [
        vector["entryHash"] for vector in fixture["entryVectors"]
    ]
    expected = fixture["projection"]
    assert baseline_projection_document(projection) == expected["canonicalValue"]
    assert projection.projection_sha256 == expected["sha256"]
