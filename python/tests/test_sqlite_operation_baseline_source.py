from __future__ import annotations

import sqlite3
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from graph_engineering.canonical import canonical_bytes
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
from graph_engineering.sqlite_operation_baseline_source import (
    capture_sqlite_v1_baseline_source_summary,
)

ROOT = Path(__file__).resolve().parents[2]
H1 = "1" * 64
H2 = "2" * 64
H3 = "3" * 64
NOW = 1_000
SOURCE_ASSETS = _load_migration_assets()


def database() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    schema = (
        ROOT / "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql"
    ).read_text()
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
            canonical_bytes(
                {
                    "requiredPostconditions": list(
                        _REQUIRED_MIGRATION_POSTCONDITIONS
                    )
                }
            ),
        ),
    )
    connection.execute(
        """INSERT INTO ge_cycle_migration_lock VALUES
           (1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?)""",
        (NOW,),
    )
    connection.commit()
    return connection


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
        assert summary.maximum_observed_at_ms == NOW
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
        with pytest.raises(ValueError, match="schema-envelope source row is invalid"):
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
        with pytest.raises(ValueError, match="migration-lineage source row is invalid"):
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
        iterator = summary.iter_identity_entries()
        assert next(iterator).entry_kind == "schema-envelope"
        connection.rollback()
        with pytest.raises(ValueError, match="active transaction"):
            next(iterator)
    finally:
        connection.close()


def test_partial_identity_iterator_rejects_any_nonempty_unimplemented_family() -> None:
    connection = database()
    try:
        connection.execute(
            """INSERT INTO ge_cycle_operations VALUES
               ('tenant-a', 'operation-a', 'release-lease', ?, ?, ?, ?)""",
            (H1, b"null", H2, NOW),
        )
        connection.commit()
        connection.execute("BEGIN EXCLUSIVE")
        summary = capture_sqlite_v1_baseline_source_summary(
            connection,
            captured_at_ms=NOW,
        )
        assert summary.expected_entry_count == 4
        with pytest.raises(ValueError, match="incomplete foundation"):
            summary.iter_identity_entries()
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
            connection.execute(
                "UPDATE ge_cycle_migrations SET migration_id = 'forged-v1'"
            )
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
        with pytest.raises(ValueError, match="active transaction"):
            capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW)
        connection.execute("BEGIN EXCLUSIVE")
        with pytest.raises(ValueError, match="capture predates"):
            capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW - 1)
        connection.execute(
            "UPDATE ge_cycle_schema SET updated_at_ms = updated_at_ms + 1 WHERE singleton = 1"
        )
        with pytest.raises(ValueError, match="high-water predates"):
            capture_sqlite_v1_baseline_source_summary(connection, captured_at_ms=NOW + 2)
    finally:
        connection.close()
