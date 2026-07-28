"""Emit the shared 54-case CycleStore campaign for Python SQLite.

Unsafe controls stay in this conformance harness.  The production durable
provider deliberately exposes only the public CycleStore and SQLite admin
surfaces.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import sqlite3
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, ClassVar

import python_cycle_store_provider_report as campaign
from graph_engineering import (
    CYCLE_STORE_PROVIDER_ERROR_CODES,
    CYCLE_STORE_PROVIDER_OPERATIONS,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    CycleStoreProviderError,
    SQLiteCycleStoreProvider,
    canonical_json,
)

FIXED_CLOCK_EPOCH_MS = 1_785_110_400_000
MAX_SAFE_INTEGER = 2**53 - 1
METHOD_OPERATIONS = {
    "describe": "describe",
    "inspect_schema": "inspect-schema",
    "read_tail": "read-tail",
    "append": "append",
    "read_event_page": "read-event-page",
    "save_checkpoint": "save-checkpoint",
    "load_checkpoint": "load-checkpoint",
    "list_checkpoints": "list-checkpoints",
    "delete_checkpoint": "delete-checkpoint",
    "acquire_lease": "acquire-lease",
    "renew_lease": "renew-lease",
    "release_lease": "release-lease",
    "inspect_lease": "inspect-lease",
    "set_legal_hold": "set-legal-hold",
    "inspect_governance": "inspect-governance",
    "acquire_migration_lock": "acquire-migration-lock",
    "inspect_migration_lock": "inspect-migration-lock",
    "release_migration_lock": "release-migration-lock",
}


def _exact_count(connection: sqlite3.Connection, sql: str) -> int:
    row = connection.execute(sql).fetchone()
    if row is None or len(row) != 1 or type(row[0]) is not int:
        raise AssertionError("SQLite counter row is invalid")
    value = row[0]
    if value < 0 or value > MAX_SAFE_INTEGER:
        raise AssertionError("SQLite counter is outside bounds")
    return value


class SQLiteCampaignProvider:
    """Memory-harness-compatible adapter around one isolated SQLite file."""

    _instances: ClassVar[list[SQLiteCampaignProvider]] = []

    def __init__(
        self,
        *,
        authorize: Callable[[object, object], object] | None = None,
        fault_hook: Callable[[str], object] | None = None,
    ) -> None:
        self._directory = Path(
            tempfile.mkdtemp(prefix="graph-engineering-python-sqlite-conformance-")
        ).resolve()
        self._database_path = self._directory / "cycle-store.db"
        self._clock_ms = FIXED_CLOCK_EPOCH_MS
        self._injected_failures: dict[str, str] = {}
        self._closed = False
        try:
            self._provider = SQLiteCycleStoreProvider(
                self._database_path,
                now=lambda: datetime.fromtimestamp(self._clock_ms / 1_000, tz=UTC),
                **({} if authorize is None else {"authorize": authorize}),
                **({} if fault_hook is None else {"fault_hook": fault_hook}),
            )
        except BaseException:
            shutil.rmtree(self._directory)
            raise
        self._instances.append(self)

    def __getattr__(self, name: str) -> Any:
        value = getattr(self._provider, name)
        operation = METHOD_OPERATIONS.get(name)
        if operation is None or not callable(value):
            return value

        async def invoke(*args: object, **kwargs: object) -> object:
            code = self._injected_failures.pop(operation, None)
            if code is not None:
                raise CycleStoreProviderError(
                    code,  # type: ignore[arg-type]
                    operation,  # type: ignore[arg-type]
                    "injected provider failure",
                )
            return await value(*args, **kwargs)

        return invoke

    def _connect(self) -> sqlite3.Connection:
        if self._closed or not self._database_path.is_file():
            raise AssertionError("SQLite campaign provider is closed")
        connection = sqlite3.connect(self._database_path, timeout=0.25)
        connection.execute("PRAGMA trusted_schema = OFF")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def unsafe_state_counters_for_test(self) -> dict[str, int]:
        with self._connect() as connection:
            return {
                "streams": _exact_count(
                    connection, "SELECT count(*) FROM ge_cycle_streams"
                ),
                "records": _exact_count(
                    connection, "SELECT count(*) FROM ge_cycle_records"
                ),
                "recordIds": _exact_count(
                    connection,
                    """
                    SELECT count(DISTINCT tenant_id || char(0) || record_id)
                    FROM ge_cycle_records
                    """,
                ),
                "checkpoints": _exact_count(
                    connection, "SELECT count(*) FROM ge_cycle_checkpoints"
                ),
                "leaseStreams": _exact_count(
                    connection, "SELECT count(*) FROM ge_cycle_leases"
                ),
                "idempotencyEntries": _exact_count(
                    connection, "SELECT count(*) FROM ge_cycle_operations"
                ),
                "cursors": _exact_count(
                    connection,
                    """
                    SELECT count(*) FROM ge_cycle_cursors
                    WHERE consumed_at_ms IS NULL
                    """,
                ),
                "legalHolds": _exact_count(
                    connection, "SELECT count(*) FROM ge_cycle_legal_holds"
                ),
                "migrationFence": _exact_count(
                    connection,
                    """
                    SELECT last_fencing_token FROM ge_cycle_migration_lock
                    WHERE singleton = 1
                    """,
                ),
            }

    def unsafe_advance_clock_for_test(self, milliseconds: int) -> None:
        if (
            type(milliseconds) is not int
            or milliseconds < 0
            or self._clock_ms > MAX_SAFE_INTEGER - milliseconds
        ):
            raise TypeError("clock advancement must be a nonnegative safe integer")
        self._clock_ms += milliseconds

    def unsafe_inject_failure_for_test(self, operation: str, code: str) -> None:
        if operation not in CYCLE_STORE_PROVIDER_OPERATIONS:
            raise TypeError("unknown provider operation")
        if code not in CYCLE_STORE_PROVIDER_ERROR_CODES:
            raise TypeError("unknown provider error code")
        self._injected_failures[operation] = code

    def unsafe_corrupt_checkpoint_for_test(
        self,
        tenant_id: str,
        checkpoint_scope: str,
        checkpoint_id: str,
        replacement: object,
    ) -> None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                """
                UPDATE ge_cycle_checkpoints SET checkpoint_blob = ?
                WHERE tenant_id = ? AND checkpoint_scope = ? AND checkpoint_id = ?
                """,
                (
                    canonical_json(replacement).encode(),
                    tenant_id,
                    checkpoint_scope,
                    checkpoint_id,
                ),
            )
            if cursor.rowcount != 1:
                raise AssertionError("checkpoint corruption target does not exist")
            connection.commit()

    def unsafe_set_lease_counters_for_test(
        self,
        tenant_id: str,
        stream_id: str,
        lease_epoch: int,
        fencing_token: int,
    ) -> None:
        if (
            type(lease_epoch) is not int
            or type(fencing_token) is not int
            or lease_epoch < 0
            or fencing_token < 0
            or lease_epoch > MAX_SAFE_INTEGER
            or fencing_token > MAX_SAFE_INTEGER
        ):
            raise TypeError("lease counters must be nonnegative safe integers")
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                """
                UPDATE ge_cycle_leases
                SET active_lease_id = NULL,
                    active_holder_id = NULL,
                    active_lease_epoch = NULL,
                    active_fencing_token = NULL,
                    active_acquired_at_ms = NULL,
                    active_expires_at_ms = NULL,
                    last_lease_epoch = ?,
                    last_fencing_token = ?
                WHERE tenant_id = ? AND stream_id = ?
                """,
                (lease_epoch, fencing_token, tenant_id, stream_id),
            )
            if cursor.rowcount != 1:
                raise AssertionError("lease counter target does not exist")
            connection.commit()

    async def cleanup(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._provider.close()
        expected_prefix = "graph-engineering-python-sqlite-conformance-"
        if self._directory.parent != Path(tempfile.gettempdir()).resolve():
            raise AssertionError("refusing to clean an unexpected directory")
        if not self._directory.name.startswith(expected_prefix):
            raise AssertionError("refusing to clean an unexpected directory")
        shutil.rmtree(self._directory)


async def _sqlite_report() -> dict[str, Any]:
    original_provider = campaign.MemoryCycleStoreProvider
    original_exercise = campaign._exercise

    async def isolated_exercise(item: dict[str, Any]) -> dict[str, Any]:
        start = len(SQLiteCampaignProvider._instances)
        try:
            return await original_exercise(item)
        finally:
            created = SQLiteCampaignProvider._instances[start:]
            del SQLiteCampaignProvider._instances[start:]
            for provider in reversed(created):
                await provider.cleanup()

    campaign.MemoryCycleStoreProvider = SQLiteCampaignProvider
    campaign._exercise = isolated_exercise
    try:
        report = await campaign._report()
    finally:
        campaign.MemoryCycleStoreProvider = original_provider
        campaign._exercise = original_exercise
        for provider in reversed(SQLiteCampaignProvider._instances):
            await provider.cleanup()
        SQLiteCampaignProvider._instances.clear()
    report["descriptorHash"] = SQLITE_CYCLE_STORE_DESCRIPTOR_HASH
    return report


if __name__ == "__main__":
    print(
        json.dumps(
            asyncio.run(_sqlite_report()),
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
