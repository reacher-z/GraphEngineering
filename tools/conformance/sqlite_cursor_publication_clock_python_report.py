#!/usr/bin/env python3
"""Emit normalized Python B3 provider-clock authority observations."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import graph_engineering
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    SQLITE_CURSOR_CLOCK_BOUNDARIES,
    SQLITE_CURSOR_CLOCK_CONSUMERS,
    _consume_provider_clock_evidence_intrinsic,
    _create_migration_lock_capability_intrinsic,
    _create_provider_clock_capability_intrinsic,
    _create_provider_clock_source_intrinsic,
    _MigrationLockIdentity,
    _observe_provider_clock_intrinsic,
)
from graph_engineering.sqlite_operation_baseline_source import (
    SQLiteV1BaselineConnectionOwner,
)

ROOT = Path(__file__).resolve().parents[2]
LOCK = _MigrationLockIdentity("b3-lock", "b3-owner", 1, 2, 1, 1, 1_000)
FAILURES = {
    "GE_CURSOR_B3_TRANSACTION_LINEAGE": "transaction-lineage",
    "GE_CURSOR_B3_CLOCK_ORDER": "clock-order",
    "GE_CURSOR_B3_CLOCK_REGRESSION": "clock-regression",
    "GE_CURSOR_B3_LOCK_EXPIRED": "lock-expired",
    "GE_CURSOR_B3_CLOCK_UNAVAILABLE": "clock-unavailable",
    "GE_CURSOR_B3_MIGRATION_LOCK": "migration-lock",
    "GE_CURSOR_B3_CLOCK_SIDE_EFFECT": "clock-side-effect",
}
CURSOR_REBIND = re.compile(r"UPDATE\s+(?:main\.)?ge_cycle_cursors\s+SET", re.IGNORECASE)
COMMIT = re.compile(r"(?:^|;)\s*COMMIT\b", re.IGNORECASE | re.MULTILINE)
ACTIVE_COUNTERS: dict[str, int] | None = None
OWNER_EXECUTE = SQLiteV1BaselineConnectionOwner.execute
OWNER_EXECUTESCRIPT = SQLiteV1BaselineConnectionOwner.executescript
OWNER_COMMIT = SQLiteV1BaselineConnectionOwner.commit


def audited_execute(
    owner: SQLiteV1BaselineConnectionOwner,
    sql: str,
    parameters: tuple[object, ...] = (),
) -> Any:
    if ACTIVE_COUNTERS is not None:
        if CURSOR_REBIND.search(sql) is not None:
            ACTIVE_COUNTERS["cursorRebindPrepareCount"] += 1
            ACTIVE_COUNTERS["cursorRebindExecuteCount"] += 1
        if COMMIT.search(sql) is not None:
            ACTIVE_COUNTERS["commitCount"] += 1
    return OWNER_EXECUTE(owner, sql, parameters)


def audited_executescript(owner: SQLiteV1BaselineConnectionOwner, sql: str) -> None:
    if ACTIVE_COUNTERS is not None:
        rebind_count = len(CURSOR_REBIND.findall(sql))
        ACTIVE_COUNTERS["cursorRebindPrepareCount"] += rebind_count
        ACTIVE_COUNTERS["cursorRebindExecuteCount"] += rebind_count
        ACTIVE_COUNTERS["commitCount"] += len(COMMIT.findall(sql))
    OWNER_EXECUTESCRIPT(owner, sql)


def audited_commit(owner: SQLiteV1BaselineConnectionOwner) -> None:
    if ACTIVE_COUNTERS is not None:
        ACTIVE_COUNTERS["commitCount"] += 1
    OWNER_COMMIT(owner)


SQLiteV1BaselineConnectionOwner.execute = audited_execute
SQLiteV1BaselineConnectionOwner.executescript = audited_executescript
SQLiteV1BaselineConnectionOwner.commit = audited_commit


def open_run() -> SQLiteV1BaselineConnectionOwner:
    connection = SQLiteV1BaselineConnectionOwner(":memory:")
    schema_path = ROOT / "python/src/graph_engineering/_sqlite_migrations/schema-v1.sql"
    schema = schema_path.read_text()
    connection.executescript(schema)
    connection.execute(
        """INSERT INTO main.ge_cycle_migration_lock
           (singleton, active_lock_id, active_owner_id, active_source_version,
            active_target_version, active_lock_epoch, active_fencing_token,
            active_acquired_at_ms, active_expires_at_ms, last_lock_epoch,
            last_fencing_token, updated_at_ms)
           VALUES (1, ?, ?, 1, 2, 1, 1, 10, 1000, 1, 1, 10)""",
        (LOCK.lock_id, LOCK.owner_id),
    ).close()
    connection.commit()
    connection.execute("BEGIN EXCLUSIVE").close()
    return connection


def close_run(connection: SQLiteV1BaselineConnectionOwner) -> None:
    try:
        if connection.in_transaction:
            connection.rollback()
    finally:
        connection.close()


def counter_probe() -> dict[str, int]:
    global ACTIVE_COUNTERS

    connection = open_run()
    counters = {
        "cursorRebindPrepareCount": 0,
        "cursorRebindExecuteCount": 0,
        "commitCount": 0,
    }
    ACTIVE_COUNTERS = counters
    try:
        connection.execute(
            "UPDATE main.ge_cycle_cursors SET page_size = page_size WHERE 0",
        ).close()
        connection.commit()
    finally:
        ACTIVE_COUNTERS = None
        close_run(connection)
    return counters


def run_case(
    case_id: str,
    action: Callable[..., None],
    values: list[Any],
) -> dict[str, Any]:
    global ACTIVE_COUNTERS

    connection = open_run()
    reads = 0
    observations = 0
    consumed = 0

    def provider_now() -> int:
        nonlocal reads
        value = values[reads]
        reads += 1
        return value

    source = _create_provider_clock_source_intrinsic(provider_now)
    lock = _create_migration_lock_capability_intrinsic(connection, LOCK)
    clock = _create_provider_clock_capability_intrinsic(connection, lock, source)
    before = connection.total_changes
    counters = {
        "cursorRebindPrepareCount": 0,
        "cursorRebindExecuteCount": 0,
        "commitCount": 0,
    }

    def observe(boundary: Any) -> Any:
        nonlocal observations
        evidence = _observe_provider_clock_intrinsic(clock, boundary)
        observations += 1
        return evidence

    def consume(evidence: Any, consumer: Any) -> None:
        nonlocal consumed
        _consume_provider_clock_evidence_intrinsic(clock, evidence, consumer)
        consumed += 1

    outcome = "accepted"
    ACTIVE_COUNTERS = counters
    try:
        action(connection, observe, consume)
    except ValueError as error:
        outcome = FAILURES.get(str(error), f"unexpected:{error}")
    finally:
        ACTIVE_COUNTERS = None
        delta = connection.total_changes - before
        close_run(connection)
    return {
        "caseId": case_id,
        "outcome": outcome,
        "observations": observations,
        "consumed": consumed,
        "providerClockReads": reads,
        "totalChangesDelta": delta,
        "cursorRebindPrepareCount": counters["cursorRebindPrepareCount"],
        "cursorRebindExecuteCount": counters["cursorRebindExecuteCount"],
        "commitCount": counters["commitCount"],
    }


def control(
    connection: Any,
    observe: Callable[[Any], Any],
    consume: Callable[..., None],
) -> None:
    first = observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0])
    connection.execute(
        "CREATE TEMP TABLE temp.ge_clock_probe (id INTEGER PRIMARY KEY)",
    ).close()
    consume(first, SQLITE_CURSOR_CLOCK_CONSUMERS[SQLITE_CURSOR_CLOCK_BOUNDARIES[0]])
    for boundary in SQLITE_CURSOR_CLOCK_BOUNDARIES[1:]:
        evidence = observe(boundary)
        consume(evidence, SQLITE_CURSOR_CLOCK_CONSUMERS[boundary])


def rollback_rebegin(
    connection: Any,
    observe: Callable[[Any], Any],
    _consume: Any,
) -> None:
    observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0])
    connection.rollback()
    connection.execute("BEGIN EXCLUSIVE").close()
    observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[1])


def skipped(_connection: Any, observe: Callable[[Any], Any], _consume: Any) -> None:
    observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[1])


def twice(_connection: Any, observe: Callable[[Any], Any], _consume: Any) -> None:
    observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0])
    observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[1])


def once(_connection: Any, observe: Callable[[Any], Any], _consume: Any) -> None:
    observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0])


def lock_drift(connection: Any, observe: Callable[[Any], Any], _consume: Any) -> None:
    observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[0])
    connection.execute(
        "UPDATE main.ge_cycle_migration_lock SET active_owner_id = 'other' WHERE singleton = 1"
    ).close()
    observe(SQLITE_CURSOR_CLOCK_BOUNDARIES[1])


def main() -> None:
    cases = [
        run_case("control", control, [100, 200, 300, 400]),
        run_case("rollback-rebegin", rollback_rebegin, [100, 200]),
        run_case("skipped-boundary", skipped, [100]),
        run_case("clock-regression", twice, [100, 99]),
        run_case("expiry-equal", once, [1_000]),
        run_case("clock-invalid", once, [-1]),
        run_case("lock-drift", lock_drift, [100, 200]),
    ]
    print(
        json.dumps(
            {
                "runtime": "python",
                "publicExport": hasattr(
                    graph_engineering, "_create_provider_clock_capability_intrinsic"
                ),
                "counterProbe": counter_probe(),
                "cases": cases,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()
