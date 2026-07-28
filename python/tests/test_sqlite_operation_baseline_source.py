from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from graph_engineering.sqlite_operation_baseline_source import (
    capture_sqlite_v1_baseline_source_summary,
)

ROOT = Path(__file__).resolve().parents[2]
H1 = "1" * 64
H2 = "2" * 64
H3 = "3" * 64
NOW = 1_000


def database() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    schema = (
        ROOT / "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql"
    ).read_text()
    connection.executescript(schema)
    connection.execute(
        """INSERT INTO ge_cycle_schema VALUES
           (1, 1, 1, 1, 1, 1, ?, ?, ?, ?, ?, ?)""",
        (H1, H2, NOW, H3, NOW, NOW),
    )
    connection.execute(
        """INSERT INTO ge_cycle_migrations VALUES
           (1, 0, 'fresh-v1-baseline', ?, ?, ?,
            'rebuild-from-verified-backup-only', ?)""",
        (H2, H1, NOW, b"{}"),
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
