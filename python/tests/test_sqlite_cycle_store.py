from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import sqlite3
import subprocess
import threading
from datetime import UTC, datetime, timedelta
from importlib.resources import files
from pathlib import Path
from typing import Any

import pytest

import graph_engineering as ge
from graph_engineering.cycle_store_provider import (
    CycleStoreProviderError,
    create_cycle_store_checkpoint,
    create_cycle_store_record,
)
from graph_engineering.sqlite_cycle_store import (
    SQLITE_CYCLE_STORE_APPLICATION_ID,
    SQLITE_MIGRATION_MANIFEST_SHA256,
    SQLiteCycleStoreProvider,
    _add_duration,
)

AUTH: dict[str, Any] = {
    "tenantId": "tenant-a",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}
MISSING = {"exists": False, "sequence": -1, "recordHash": None}

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
TYPESCRIPT_SQLITE_MODULE = REPOSITORY_ROOT / "packages/sqlite/dist/sqlite-cycle-store.js"
TYPESCRIPT_RUNTIME_MODULE = REPOSITORY_ROOT / "packages/runtime/dist/index.js"
NODE_INTEROP_READY = (
    shutil.which("node") is not None
    and TYPESCRIPT_SQLITE_MODULE.is_file()
    and TYPESCRIPT_RUNTIME_MODULE.is_file()
)

NODE_INTEROP_SCRIPT = r"""
import { SQLiteCycleStoreProvider } from "./packages/sqlite/dist/sqlite-cycle-store.js";
import { inspectSQLiteCycleStoreIntegrity } from "./packages/sqlite/dist/semantic-integrity.js";
import {
  createCycleStoreCheckpoint,
  createCycleStoreRecord,
} from "./packages/runtime/dist/index.js";

const [mode, path, payloadRaw] = process.argv.slice(1);
const auth = {
  tenantId: "tenant-a",
  principalHash: "a".repeat(64),
  authorizationHash: "b".repeat(64),
};
const mutation = (operationId) => ({ ...auth, operationId });
const provider = new SQLiteCycleStoreProvider(path, {
  now: () => new Date("2026-07-27T00:00:00Z"),
});

try {
  if (mode === "create") {
    const records = [];
    for (let sequence = 0; sequence < 3; sequence += 1) {
      records.push(createCycleStoreRecord({
        recordId: `ts-${sequence}`,
        sequence,
        previousRecordHash: records.at(-1)?.recordHash ?? null,
        value: { sequence, source: "typescript" },
      }));
    }
    await provider.append({
      context: mutation("ts-create"),
      streamId: "stream-a",
      expectedTail: { exists: false, sequence: -1, recordHash: null },
      lease: null,
      records,
    });
    for (const [index, suffix] of ["a", "b"].entries()) {
      const checkpoint = createCycleStoreCheckpoint({
        checkpointScope: "scope-a",
        checkpointId: `cp-${suffix}`,
        streamId: "stream-a",
        boundSequence: 2,
        boundRecordHash: records[2].recordHash,
        createdAt: `2026-07-27T00:00:0${index + 1}Z`,
        value: { source: "typescript", suffix },
      });
      await provider.saveCheckpoint({
        context: mutation(`ts-save-${suffix}`),
        checkpoint,
        lease: null,
      });
    }
    const event = await provider.readEventPage({
      context: auth,
      streamId: "stream-a",
      fromSequence: 0,
      pageSize: 1,
      cursor: null,
    });
    const checkpoints = await provider.listCheckpoints({
      context: auth,
      checkpointScope: "scope-a",
      pageSize: 1,
      cursor: null,
    });
    process.stdout.write(JSON.stringify({
      eventSequence: event.records[0].sequence,
      eventCursor: event.nextCursor,
      checkpointId: checkpoints.checkpoints[0].checkpointId,
      checkpointCursor: checkpoints.nextCursor,
    }));
  } else if (mode === "resume") {
    const payload = JSON.parse(payloadRaw);
    const event = await provider.readEventPage({
      context: auth,
      streamId: "stream-a",
      fromSequence: null,
      pageSize: 1,
      cursor: payload.eventCursor,
    });
    let checkpoints = null;
    if (payload.checkpointCursor !== null) {
      checkpoints = await provider.listCheckpoints({
        context: auth,
        checkpointScope: "scope-a",
        pageSize: 1,
        cursor: payload.checkpointCursor,
      });
    }
    process.stdout.write(JSON.stringify({
      eventSequence: event.records[0].sequence,
      eventCursor: event.nextCursor,
      checkpointId: checkpoints?.checkpoints[0]?.checkpointId ?? null,
      checkpointCursor: checkpoints?.nextCursor ?? null,
    }));
  } else if (mode === "audit") {
    process.stdout.write(JSON.stringify(inspectSQLiteCycleStoreIntegrity(path, "semantic")));
  } else {
    throw new Error("unknown interop mode");
  }
} finally {
  provider.close();
}
"""


def run_typescript_interop(
    mode: str,
    path: Path,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    completed = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--no-warnings",
            "-e",
            NODE_INTEROP_SCRIPT,
            mode,
            str(path),
            json.dumps(payload),
        ],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert completed.returncode == 0, completed.stderr
    decoded = json.loads(completed.stdout)
    assert isinstance(decoded, dict)
    return decoded


def mutation(operation_id: str) -> dict[str, Any]:
    return {**AUTH, "operationId": operation_id}


def records(count: int, prefix: str = "record") -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for sequence in range(count):
        result.append(
            create_cycle_store_record(
                record_id=f"{prefix}-{sequence}",
                sequence=sequence,
                previous_record_hash=(None if not result else str(result[-1]["recordHash"])),
                value={"sequence": sequence, "source": prefix},
            )
        )
    return result


async def create_stream(
    provider: SQLiteCycleStoreProvider,
    *,
    stream_id: str = "stream-a",
    count: int = 1,
) -> list[dict[str, Any]]:
    batch = records(count, stream_id)
    await provider.append(
        {
            "context": mutation(f"create-{stream_id}"),
            "streamId": stream_id,
            "expectedTail": MISSING,
            "lease": None,
            "records": batch,
        }
    )
    return batch


async def expect_code(awaitable: Any, code: str) -> CycleStoreProviderError:
    with pytest.raises(CycleStoreProviderError) as caught:
        await awaitable
    assert caught.value.code == code
    return caught.value


def test_sqlite_surface_assets_bootstrap_and_reopen(tmp_path: Path) -> None:
    async def scenario() -> None:
        path = tmp_path / "store.db"
        provider = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
        )
        descriptor = await provider.describe()
        assert ge.SQLiteCycleStoreProvider is SQLiteCycleStoreProvider
        assert descriptor["providerId"] == "sqlite-local"
        assert descriptor["descriptorHash"] == (
            "4071e4e5e2cddad01af4f87e4df45fa55bbc4e238674174ce40eca765d2c03fe"
        )
        assert descriptor["capabilities"]["durability"] == "durable"
        assert descriptor["capabilities"]["distributedFencing"] is False
        await provider.close()

        reopened = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
        )
        inspection = await reopened.inspect_schema(AUTH)
        assert inspection["descriptorHash"] == descriptor["descriptorHash"]
        await reopened.close()

        conn = sqlite3.connect(path)
        try:
            assert conn.execute("PRAGMA application_id").fetchone() == (
                SQLITE_CYCLE_STORE_APPLICATION_ID,
            )
            assert conn.execute("PRAGMA user_version").fetchone() == (1,)
            assert conn.execute("PRAGMA journal_mode").fetchone() == ("wal",)
            assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        finally:
            conn.close()

    asyncio.run(scenario())

    resource_root = files("graph_engineering._sqlite_migrations")
    expected_hashes = {
        "schema-v1.sql": "ddf524d8d0fcdde2a862c168c90698538b9197fa24216f0f249b6ea789c48e1c",
        "schema-v1.identity.json": (
            "4fcbe9872605011356e0655e2b9f9c3210e2bddbb131ddc87f08a93f0a1b9682"
        ),
        "0001-alpha-v0-to-v1.sql": (
            "a8e9de4d1bae81f8405ef611fca1298bef024ad1df5e905d1d5a9357d1e8cb9c"
        ),
    }
    for name, expected in expected_hashes.items():
        assert hashlib.sha256(resource_root.joinpath(name).read_bytes()).hexdigest() == expected


def test_sqlite_append_restart_idempotency_and_real_writer_cas(tmp_path: Path) -> None:
    async def scenario() -> None:
        path = tmp_path / "race.db"
        first = SQLiteCycleStoreProvider(path, initial_time="2026-07-27T00:00:00Z")
        second = SQLiteCycleStoreProvider(path, initial_time="2026-07-27T00:00:00Z")
        left_record = records(1, "left")[0]
        right_record = records(1, "right")[0]
        left_request = {
            "context": mutation("left-op"),
            "streamId": "stream-a",
            "expectedTail": MISSING,
            "lease": None,
            "records": [left_record],
        }
        right_request = {
            "context": mutation("right-op"),
            "streamId": "stream-a",
            "expectedTail": MISSING,
            "lease": None,
            "records": [right_record],
        }
        outcomes = await asyncio.gather(
            first.append(left_request),
            second.append(right_request),
            return_exceptions=True,
        )
        accepted = [item for item in outcomes if not isinstance(item, Exception)]
        rejected = [item for item in outcomes if isinstance(item, CycleStoreProviderError)]
        assert len(accepted) == 1
        assert len(rejected) == 1
        assert rejected[0].code == "GE_CYCLE_STORE_CONFLICT"

        winner = first if not isinstance(outcomes[0], Exception) else second
        winning_request = left_request if winner is first else right_request
        replay = await winner.append(winning_request)
        assert replay == accepted[0]
        await first.close()
        await second.close()

        reopened = SQLiteCycleStoreProvider(path, initial_time="2026-07-27T00:00:00Z")
        assert await reopened.append(winning_request) == replay
        page = await reopened.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 10,
                "cursor": None,
            }
        )
        assert len(page["records"]) == 1
        conn = sqlite3.connect(path)
        try:
            assert conn.execute("SELECT COUNT(*) FROM ge_cycle_operations").fetchone() == (1,)
        finally:
            conn.close()
        await reopened.close()

    asyncio.run(scenario())


def test_sqlite_connection_has_one_dedicated_owner_and_closes_once(tmp_path: Path) -> None:
    async def scenario() -> None:
        owner_threads: set[int] = set()

        def fault_hook(_boundary: str) -> None:
            owner_threads.add(threading.get_ident())

        provider = SQLiteCycleStoreProvider(
            tmp_path / "owned.db",
            initial_time="2026-07-27T00:00:00Z",
            fault_hook=fault_hook,
        )
        connection = provider._connection
        assert connection is not None
        await create_stream(provider)
        await provider.set_legal_hold(
            {
                "context": mutation("owner-hold"),
                "streamId": "stream-a",
                "holdId": "hold-a",
                "action": "place",
            }
        )
        assert provider._connection is connection
        assert len(owner_threads) == 1
        assert threading.get_ident() not in owner_threads
        await provider.close()
        assert provider._connection is None
        await provider.close()
        await expect_code(provider.describe(), "GE_CYCLE_STORE_UNAVAILABLE")

    asyncio.run(scenario())


def test_sqlite_event_and_checkpoint_snapshots_survive_restart(tmp_path: Path) -> None:
    async def scenario() -> None:
        path = tmp_path / "snapshot.db"
        provider = SQLiteCycleStoreProvider(path, initial_time="2026-07-27T00:00:00Z")
        batch = await create_stream(provider, count=3)
        event_first = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 1,
                "cursor": None,
            }
        )
        assert event_first["nextCursor"] is not None

        for suffix in ("a", "b"):
            checkpoint = create_cycle_store_checkpoint(
                checkpoint_scope="scope-a",
                checkpoint_id=f"cp-{suffix}",
                stream_id="stream-a",
                bound_sequence=2,
                bound_record_hash=str(batch[-1]["recordHash"]),
                created_at=f"2026-07-27T00:00:0{1 if suffix == 'a' else 2}Z",
                value={"state": suffix},
            )
            await provider.save_checkpoint(
                {
                    "context": mutation(f"save-{suffix}"),
                    "checkpoint": checkpoint,
                    "lease": None,
                }
            )
        checkpoint_first = await provider.list_checkpoints(
            {
                "context": AUTH,
                "checkpointScope": "scope-a",
                "pageSize": 1,
                "cursor": None,
            }
        )
        assert checkpoint_first["checkpoints"][0]["checkpointId"] == "cp-b"
        assert checkpoint_first["nextCursor"] is not None
        audit = await provider.audit_integrity("semantic")
        assert audit["level"] == "semantic"
        assert audit["semanticSha256"] is not None
        assert audit["counters"] == {
            "streams": 1,
            "records": 3,
            "operations": 3,
            "checkpoints": 2,
            "checkpointRevisions": 2,
            "leases": 0,
            "usedLeaseIds": 0,
            "legalHolds": 0,
            "cursors": 2,
            "openCursors": 2,
            "usedMigrationLockIds": 0,
        }

        fourth = create_cycle_store_record(
            record_id="stream-a-3",
            sequence=3,
            previous_record_hash=str(batch[-1]["recordHash"]),
            value={"sequence": 3},
        )
        await provider.append(
            {
                "context": mutation("append-fourth"),
                "streamId": "stream-a",
                "expectedTail": {
                    "exists": True,
                    "sequence": 2,
                    "recordHash": batch[-1]["recordHash"],
                },
                "lease": None,
                "records": [fourth],
            }
        )
        await provider.close()

        reopened = SQLiteCycleStoreProvider(path, initial_time="2026-07-27T00:00:00Z")
        event_second = await reopened.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": None,
                "pageSize": 1,
                "cursor": event_first["nextCursor"],
            }
        )
        event_third = await reopened.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": None,
                "pageSize": 1,
                "cursor": event_second["nextCursor"],
            }
        )
        assert [
            event_first["records"][0]["sequence"],
            event_second["records"][0]["sequence"],
            event_third["records"][0]["sequence"],
        ] == [0, 1, 2]
        assert event_third["nextCursor"] is None

        checkpoint_second = await reopened.list_checkpoints(
            {
                "context": AUTH,
                "checkpointScope": "scope-a",
                "pageSize": 1,
                "cursor": checkpoint_first["nextCursor"],
            }
        )
        assert checkpoint_second["checkpoints"][0]["checkpointId"] == "cp-a"
        assert checkpoint_second["nextCursor"] is None
        await reopened.close()

    asyncio.run(scenario())


def test_sqlite_lease_governance_and_migration_fences_persist(tmp_path: Path) -> None:
    async def scenario() -> None:
        path = tmp_path / "fences.db"
        clock = [datetime(2026, 7, 27, tzinfo=UTC)]
        provider = SQLiteCycleStoreProvider(path, now=lambda: clock[0])
        await create_stream(provider)
        lease = await provider.acquire_lease(
            {
                "context": mutation("lease-acquire"),
                "streamId": "stream-a",
                "leaseId": "lease-a",
                "holderId": "holder-a",
                "ttlMs": 1_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )
        binding = {
            "leaseId": lease["leaseId"],
            "holderId": lease["holderId"],
            "fencingToken": lease["fencingToken"],
        }
        await provider.set_legal_hold(
            {
                "context": mutation("hold-place"),
                "streamId": "stream-a",
                "holdId": "hold-a",
                "action": "place",
            }
        )
        clock[0] += timedelta(seconds=1)
        takeover = await provider.acquire_lease(
            {
                "context": mutation("lease-takeover"),
                "streamId": "stream-a",
                "leaseId": "lease-b",
                "holderId": "holder-b",
                "ttlMs": 1_000,
                "mode": "takeover",
                "expectedFencingToken": 1,
            }
        )
        assert takeover["fencingToken"] == 2
        await expect_code(
            provider.release_lease(
                {
                    "context": mutation("stale-release"),
                    "streamId": "stream-a",
                    "lease": binding,
                }
            ),
            "GE_CYCLE_STORE_STALE_FENCE",
        )
        migration = await provider.acquire_migration_lock(
            {
                "context": mutation("migration-acquire"),
                "lockId": "migration-a",
                "ownerId": "owner-a",
                "sourceSchemaVersion": 1,
                "targetSchemaVersion": 2,
                "ttlMs": 1_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )
        assert migration["fencingToken"] == 1
        await provider.close()

        reopened = SQLiteCycleStoreProvider(path, now=lambda: clock[0])
        assert (await reopened.inspect_lease({"context": AUTH, "streamId": "stream-a"}))[
            "lastFencingToken"
        ] == 2
        assert (await reopened.inspect_governance({"context": AUTH, "streamId": "stream-a"}))[
            "legalHoldIds"
        ] == ["hold-a"]
        assert (await reopened.inspect_migration_lock(AUTH))["fencingToken"] == 1
        await reopened.close()

    asyncio.run(scenario())


def test_sqlite_v0_fixture_migrates_and_close_is_idempotent(tmp_path: Path) -> None:
    fixture = files("graph_engineering._sqlite_migrations").joinpath(
        "fixtures/alpha-v0.sql"
    ).read_text(encoding="utf-8")
    path = tmp_path / "alpha-v0.db"
    conn = sqlite3.connect(path)
    try:
        conn.executescript(fixture)
    finally:
        conn.close()

    with pytest.raises(CycleStoreProviderError) as backwards:
        SQLiteCycleStoreProvider(path, initial_time="2026-07-27T00:00:00Z")
    assert backwards.value.code == "GE_CYCLE_STORE_INVALID_ARGUMENT"
    conn = sqlite3.connect(path)
    try:
        assert conn.execute("PRAGMA user_version").fetchone() == (0,)
    finally:
        conn.close()

    async def scenario() -> None:
        provider = SQLiteCycleStoreProvider(path, initial_time="2026-07-27T00:00:05Z")
        inspection = await provider.inspect_schema(AUTH)
        assert inspection["schemaVersion"] == 1
        await provider.close()
        await provider.close()
        error = await expect_code(provider.describe(), "GE_CYCLE_STORE_UNAVAILABLE")
        assert str(path) not in str(error.to_dict())

    asyncio.run(scenario())

    conn = sqlite3.connect(path)
    try:
        assert conn.execute("PRAGMA user_version").fetchone() == (1,)
        assert conn.execute("SELECT COUNT(*) FROM ge_cycle_records").fetchone()[0] >= 3
        assert conn.execute("PRAGMA foreign_key_check").fetchone() is None
    finally:
        conn.close()


def test_sqlite_clock_high_water_tampering_fails_closed(tmp_path: Path) -> None:
    async def build(path: Path) -> None:
        clock = [datetime(2026, 7, 27, tzinfo=UTC)]
        provider = SQLiteCycleStoreProvider(path, now=lambda: clock[0])
        clock[0] += timedelta(seconds=10)
        await create_stream(provider)
        await provider.close()

    reopen_path = tmp_path / "reopen-low.db"
    asyncio.run(build(reopen_path))
    conn = sqlite3.connect(reopen_path)
    try:
        conn.execute(
            "UPDATE ge_cycle_migration_lock SET updated_at_ms = 0 WHERE singleton = 1"
        )
        conn.commit()
    finally:
        conn.close()
    with pytest.raises(CycleStoreProviderError) as reopened:
        SQLiteCycleStoreProvider(
            reopen_path,
            initial_time="2026-07-27T00:00:10Z",
        )
    assert reopened.value.code == "GE_CYCLE_STORE_CORRUPTION"

    audit_path = tmp_path / "audit-low.db"
    asyncio.run(build(audit_path))

    async def reject_semantic_audit() -> None:
        provider = SQLiteCycleStoreProvider(
            audit_path,
            initial_time="2026-07-27T00:00:10Z",
        )
        conn = sqlite3.connect(audit_path)
        try:
            schema_time = conn.execute(
                "SELECT updated_at_ms FROM ge_cycle_schema WHERE singleton = 1"
            ).fetchone()[0]
            conn.execute(
                """
                UPDATE ge_cycle_migration_lock SET updated_at_ms = ? WHERE singleton = 1
                """,
                (schema_time,),
            )
            conn.commit()
        finally:
            conn.close()
        await expect_code(
            provider.audit_integrity("semantic"),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        await provider.close()

    asyncio.run(reject_semantic_audit())


@pytest.mark.skipif(
    not NODE_INTEROP_READY,
    reason="built TypeScript SQLite/runtime modules and Node.js are required",
)
def test_sqlite_cursor_wire_is_bidirectionally_interoperable(tmp_path: Path) -> None:
    python_origin = tmp_path / "python-origin.db"

    async def create_with_python() -> dict[str, Any]:
        provider = SQLiteCycleStoreProvider(
            python_origin,
            initial_time="2026-07-27T00:00:00Z",
        )
        batch = await create_stream(provider, count=3)
        for index, suffix in enumerate(("a", "b"), start=1):
            checkpoint = create_cycle_store_checkpoint(
                checkpoint_scope="scope-a",
                checkpoint_id=f"cp-{suffix}",
                stream_id="stream-a",
                bound_sequence=2,
                bound_record_hash=str(batch[2]["recordHash"]),
                created_at=f"2026-07-27T00:00:0{index}Z",
                value={"source": "python", "suffix": suffix},
            )
            await provider.save_checkpoint(
                {
                    "context": mutation(f"py-save-{suffix}"),
                    "checkpoint": checkpoint,
                    "lease": None,
                }
            )
        event = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 1,
                "cursor": None,
            }
        )
        checkpoints = await provider.list_checkpoints(
            {
                "context": AUTH,
                "checkpointScope": "scope-a",
                "pageSize": 1,
                "cursor": None,
            }
        )
        await provider.close()
        assert event["records"][0]["sequence"] == 0
        assert checkpoints["checkpoints"][0]["checkpointId"] == "cp-b"
        return {
            "eventCursor": event["nextCursor"],
            "checkpointCursor": checkpoints["nextCursor"],
        }

    python_cursors = asyncio.run(create_with_python())

    async def audit_python_origin() -> dict[str, Any]:
        provider = SQLiteCycleStoreProvider(
            python_origin,
            initial_time="2026-07-27T00:00:00Z",
        )
        audit = await provider.audit_integrity("semantic")
        await provider.close()
        return audit

    python_audit = asyncio.run(audit_python_origin())
    typescript_audit = run_typescript_interop("audit", python_origin)
    assert typescript_audit["semanticSha256"] == python_audit["semanticSha256"]
    assert typescript_audit["counters"] == python_audit["counters"]
    assert typescript_audit["lineageSha256"] == python_audit["lineageSha256"]
    typescript_resumed = run_typescript_interop(
        "resume",
        python_origin,
        python_cursors,
    )
    assert typescript_resumed["eventSequence"] == 1
    assert typescript_resumed["checkpointId"] == "cp-a"

    async def finish_python_origin_with_python() -> None:
        provider = SQLiteCycleStoreProvider(
            python_origin,
            initial_time="2026-07-27T00:00:00Z",
        )
        event = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": None,
                "pageSize": 1,
                "cursor": typescript_resumed["eventCursor"],
            }
        )
        assert event["records"][0]["sequence"] == 2
        assert event["nextCursor"] is None
        await provider.close()

    asyncio.run(finish_python_origin_with_python())

    typescript_origin = tmp_path / "typescript-origin.db"
    typescript_created = run_typescript_interop("create", typescript_origin)
    assert typescript_created["eventSequence"] == 0
    assert typescript_created["checkpointId"] == "cp-b"

    async def resume_typescript_origin_with_python() -> dict[str, Any]:
        provider = SQLiteCycleStoreProvider(
            typescript_origin,
            initial_time="2026-07-27T00:00:00Z",
        )
        event = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": None,
                "pageSize": 1,
                "cursor": typescript_created["eventCursor"],
            }
        )
        checkpoints = await provider.list_checkpoints(
            {
                "context": AUTH,
                "checkpointScope": "scope-a",
                "pageSize": 1,
                "cursor": typescript_created["checkpointCursor"],
            }
        )
        assert event["records"][0]["sequence"] == 1
        assert checkpoints["checkpoints"][0]["checkpointId"] == "cp-a"
        await provider.close()
        return {
            "eventCursor": event["nextCursor"],
            "checkpointCursor": None,
        }

    python_resumed = asyncio.run(resume_typescript_origin_with_python())
    typescript_finished = run_typescript_interop(
        "resume",
        typescript_origin,
        python_resumed,
    )
    assert typescript_finished["eventSequence"] == 2
    assert typescript_finished["eventCursor"] is None


@pytest.mark.parametrize(
    ("sqlite_code", "expected_code"),
    [
        (sqlite3.SQLITE_IOERR | (1 << 8), "GE_CYCLE_STORE_UNAVAILABLE"),
        (sqlite3.SQLITE_CANTOPEN, "GE_CYCLE_STORE_UNAVAILABLE"),
        (sqlite3.SQLITE_READONLY, "GE_CYCLE_STORE_PERMISSION_DENIED"),
        (sqlite3.SQLITE_NOTADB, "GE_CYCLE_STORE_CORRUPTION"),
    ],
)
def test_sqlite_constructor_translates_hostile_numeric_errors_without_leaks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    sqlite_code: int,
    expected_code: str,
) -> None:
    raw = sqlite3.DatabaseError("PAYLOAD_SENTINEL")
    raw.sqlite_errorcode = sqlite_code
    raw.sqlite_errorname = "PAYLOAD_SENTINEL_ERROR_NAME"

    def reject_connect(*_args: object, **_kwargs: object) -> sqlite3.Connection:
        raise raw

    monkeypatch.setattr(sqlite3, "connect", reject_connect)
    path = tmp_path / "PAYLOAD_SENTINEL.db"
    with pytest.raises(CycleStoreProviderError) as caught:
        SQLiteCycleStoreProvider(path)
    assert caught.value.code == expected_code
    serialized = json.dumps(caught.value.to_dict(), sort_keys=True)
    assert "PAYLOAD_SENTINEL" not in serialized
    assert str(path) not in serialized
    assert caught.value.details["sqliteClass"] == (sqlite_code & 0xFF)


def test_sqlite_constructor_translates_real_not_a_database(tmp_path: Path) -> None:
    path = tmp_path / "not-a-database.db"
    path.write_bytes(b"PAYLOAD_SENTINEL is not a SQLite database")
    with pytest.raises(CycleStoreProviderError) as caught:
        SQLiteCycleStoreProvider(path)
    assert caught.value.code == "GE_CYCLE_STORE_CORRUPTION"
    assert "PAYLOAD_SENTINEL" not in json.dumps(caught.value.to_dict(), sort_keys=True)


def test_sqlite_rejects_async_fault_hooks_without_waiting_in_transaction(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        executed = False
        armed = True

        async def async_outcome() -> None:
            nonlocal executed
            executed = True

        def async_fault(boundary: str) -> object:
            nonlocal armed
            if not armed or boundary != "provider:append:before-commit":
                return None
            armed = False
            return async_outcome()

        provider = SQLiteCycleStoreProvider(
            tmp_path / "async-fault.db",
            initial_time="2026-07-27T00:00:00Z",
            fault_hook=async_fault,
        )
        request = {
            "context": mutation("async-fault"),
            "streamId": "stream-a",
            "expectedTail": MISSING,
            "lease": None,
            "records": records(1, "async-fault"),
        }
        error = await expect_code(
            provider.append(request),
            "GE_CYCLE_STORE_UNAVAILABLE",
        )
        assert error.details["boundary"] == "provider:append:before-commit"
        assert executed is False
        assert await provider.read_tail({"context": AUTH, "streamId": "stream-a"}) == MISSING
        assert (await provider.append(request))["appendedRecords"] == 1
        await provider.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "options",
    [
        {"busy_timeout_ms": 5_001},
        {"busy_retry_attempts": 9},
        {"busy_retry_elapsed_ms": 30_001},
        {"busy_timeout_ms": 60, "busy_retry_attempts": 2, "busy_retry_elapsed_ms": 119},
        {"busy_retry_elapsed_ms": 1},
    ],
)
def test_sqlite_busy_policy_is_bounded_before_open(
    tmp_path: Path,
    options: dict[str, int],
) -> None:
    with pytest.raises(CycleStoreProviderError) as caught:
        SQLiteCycleStoreProvider(tmp_path / "invalid-busy.db", **options)
    assert caught.value.code == "GE_CYCLE_STORE_INVALID_ARGUMENT"
    assert not (tmp_path / "invalid-busy.db").exists()


def test_sqlite_busy_attempts_respect_the_elapsed_bound(tmp_path: Path) -> None:
    async def scenario() -> None:
        path = tmp_path / "busy.db"
        provider = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
            busy_timeout_ms=20,
            busy_retry_attempts=2,
            busy_retry_elapsed_ms=40,
        )
        blocker = sqlite3.connect(path, isolation_level=None)
        try:
            blocker.execute("BEGIN IMMEDIATE")
            started = asyncio.get_running_loop().time()
            error = await expect_code(
                provider.append(
                    {
                        "context": mutation("busy"),
                        "streamId": "stream-a",
                        "expectedTail": MISSING,
                        "lease": None,
                        "records": records(1, "busy"),
                    }
                ),
                "GE_CYCLE_STORE_UNAVAILABLE",
            )
            elapsed = asyncio.get_running_loop().time() - started
            assert elapsed < 0.5
            assert error.details["attemptCount"] == 2
            assert error.details["sqliteClass"] in (
                sqlite3.SQLITE_BUSY,
                sqlite3.SQLITE_LOCKED,
            )
        finally:
            blocker.execute("ROLLBACK")
            blocker.close()
            await provider.close()

    asyncio.run(scenario())


def test_sqlite_time_decisions_commit_high_water_and_reject_rollback(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        path = tmp_path / "clock-observation.db"
        clock = [datetime(2026, 7, 27, tzinfo=UTC)]
        provider = SQLiteCycleStoreProvider(path, now=lambda: clock[0])
        operations = (
            lambda: provider.read_event_page(
                {
                    "context": AUTH,
                    "streamId": "missing",
                    "fromSequence": 0,
                    "pageSize": 1,
                    "cursor": None,
                }
            ),
            lambda: provider.list_checkpoints(
                {
                    "context": AUTH,
                    "checkpointScope": "missing",
                    "pageSize": 1,
                    "cursor": None,
                }
            ),
            lambda: provider.inspect_lease(
                {"context": AUTH, "streamId": "missing"}
            ),
        )
        for operation in operations:
            clock[0] += timedelta(seconds=1)
            await operation()
            connection = sqlite3.connect(path)
            try:
                assert connection.execute(
                    "SELECT updated_at_ms FROM ge_cycle_migration_lock WHERE singleton = 1"
                ).fetchone() == (int(clock[0].timestamp() * 1_000),)
            finally:
                connection.close()

        clock[0] -= timedelta(milliseconds=1)
        await expect_code(
            provider.inspect_lease({"context": AUTH, "streamId": "missing"}),
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
        )
        await provider.close()

    asyncio.run(scenario())


def test_sqlite_legal_hold_blocks_checkpoint_deletion(tmp_path: Path) -> None:
    async def scenario() -> None:
        provider = SQLiteCycleStoreProvider(
            tmp_path / "legal-hold.db",
            initial_time="2026-07-27T00:00:00Z",
        )
        batch = await create_stream(provider)
        checkpoint = create_cycle_store_checkpoint(
            checkpoint_scope="scope-a",
            checkpoint_id="checkpoint-a",
            stream_id="stream-a",
            bound_sequence=0,
            bound_record_hash=str(batch[0]["recordHash"]),
            created_at="2026-07-27T00:00:00Z",
            value={"retained": True},
        )
        await provider.save_checkpoint(
            {"context": mutation("save"), "checkpoint": checkpoint, "lease": None}
        )
        await provider.set_legal_hold(
            {
                "context": mutation("hold"),
                "streamId": "stream-a",
                "holdId": "hold-a",
                "action": "place",
            }
        )
        await expect_code(
            provider.delete_checkpoint(
                {
                    "context": mutation("blocked-delete"),
                    "checkpointScope": "scope-a",
                    "checkpointId": "checkpoint-a",
                    "expectedValueHash": checkpoint["valueHash"],
                }
            ),
            "GE_CYCLE_STORE_LEGAL_HOLD",
        )
        assert (
            await provider.load_checkpoint(
                {
                    "context": AUTH,
                    "checkpointScope": "scope-a",
                    "checkpointId": "checkpoint-a",
                }
            )
            is not None
        )
        await provider.set_legal_hold(
            {
                "context": mutation("release-hold"),
                "streamId": "stream-a",
                "holdId": "hold-a",
                "action": "release",
            }
        )
        assert await provider.delete_checkpoint(
            {
                "context": mutation("delete"),
                "checkpointScope": "scope-a",
                "checkpointId": "checkpoint-a",
                "expectedValueHash": checkpoint["valueHash"],
            }
        ) == {"deleted": True}
        await provider.close()

    asyncio.run(scenario())


def test_sqlite_manifest_postconditions_are_compiled_and_audited(tmp_path: Path) -> None:
    assert SQLITE_MIGRATION_MANIFEST_SHA256 == (
        "5f052a21215a39de101d56447fa4b25d20b6053bc558e3960562932e958d7af6"
    )
    assert ge.SQLITE_MIGRATION_MANIFEST_SHA256 == SQLITE_MIGRATION_MANIFEST_SHA256

    async def scenario() -> None:
        path = tmp_path / "postconditions.db"
        provider = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
        )
        connection = sqlite3.connect(path)
        try:
            connection.execute("UPDATE ge_cycle_migrations SET postconditions_blob = x'7b7d'")
            connection.commit()
        finally:
            connection.close()
        await expect_code(
            provider.audit_integrity("semantic"),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        await provider.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "erased_table",
    ["ge_cycle_used_lease_ids", "ge_cycle_used_migration_lock_ids"],
)
def test_sqlite_semantic_audit_rejects_erased_fence_history(
    tmp_path: Path,
    erased_table: str,
) -> None:
    async def scenario() -> None:
        path = tmp_path / f"{erased_table}.db"
        provider = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
        )
        await create_stream(provider)
        await provider.acquire_lease(
            {
                "context": mutation("lease"),
                "streamId": "stream-a",
                "leaseId": "lease-a",
                "holderId": "holder-a",
                "ttlMs": 1_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )
        await provider.acquire_migration_lock(
            {
                "context": mutation("migration"),
                "lockId": "migration-a",
                "ownerId": "owner-a",
                "sourceSchemaVersion": 1,
                "targetSchemaVersion": 2,
                "ttlMs": 1_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )
        connection = sqlite3.connect(path)
        try:
            connection.execute(f'DELETE FROM "{erased_table}"')
            connection.commit()
        finally:
            connection.close()
        await expect_code(
            provider.audit_integrity("semantic"),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        await provider.close()

    asyncio.run(scenario())


def test_sqlite_semantic_audit_reconciles_ledger_results_to_state(tmp_path: Path) -> None:
    async def scenario() -> None:
        path = tmp_path / "forged-ledger.db"
        provider = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
        )
        await create_stream(provider)
        forged = {
            "tail": {"exists": True, "sequence": 0, "recordHash": "f" * 64},
            "appendedRecords": 1,
        }
        result_blob = ge.cycle_store_adapter_codec.encode_ledger_result(
            "append",
            forged,
        )
        connection = sqlite3.connect(path)
        try:
            connection.execute(
                """
                UPDATE ge_cycle_operations SET result_blob = ?, result_hash = ?
                WHERE tenant_id = ? AND operation_id = ?
                """,
                (
                    result_blob,
                    ge.canonical_sha256(forged),
                    AUTH["tenantId"],
                    "create-stream-a",
                ),
            )
            connection.commit()
        finally:
            connection.close()
        await expect_code(
            provider.audit_integrity("semantic"),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        await provider.close()

    asyncio.run(scenario())


def test_sqlite_semantic_audit_binds_event_cursor_to_retained_tail(tmp_path: Path) -> None:
    async def scenario() -> None:
        path = tmp_path / "cursor-tail.db"
        provider = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
        )
        await create_stream(provider, count=3)
        page = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 1,
                "cursor": None,
            }
        )
        assert page["nextCursor"] is not None
        forged_tail = {
            "exists": True,
            "sequence": 2,
            "recordHash": "f" * 64,
        }
        connection = sqlite3.connect(path)
        try:
            connection.execute(
                """
                UPDATE ge_cycle_cursors
                SET snapshot_tail_record_hash = ?, snapshot_blob = ?
                WHERE consumed_at_ms IS NULL
                """,
                ("f" * 64, ge.canonical_bytes(forged_tail)),
            )
            connection.commit()
        finally:
            connection.close()
        await expect_code(
            provider.audit_integrity("semantic"),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        await provider.close()

    asyncio.run(scenario())


def test_sqlite_semantic_audit_binds_current_checkpoint_revision(tmp_path: Path) -> None:
    async def scenario() -> None:
        path = tmp_path / "checkpoint-revision.db"
        provider = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
        )
        batch = await create_stream(provider)
        checkpoint = create_cycle_store_checkpoint(
            checkpoint_scope="scope-a",
            checkpoint_id="checkpoint-a",
            stream_id="stream-a",
            bound_sequence=0,
            bound_record_hash=str(batch[0]["recordHash"]),
            created_at="2026-07-27T00:00:00Z",
            value={"retained": True},
        )
        await provider.save_checkpoint(
            {"context": mutation("save"), "checkpoint": checkpoint, "lease": None}
        )
        connection = sqlite3.connect(path)
        try:
            connection.execute(
                "UPDATE ge_cycle_checkpoints SET checkpoint_revision = 2"
            )
            connection.commit()
        finally:
            connection.close()
        await expect_code(
            provider.audit_integrity("semantic"),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        await provider.close()

    asyncio.run(scenario())


@pytest.mark.parametrize("tamper", ["unretained-summary", "reordered-snapshot"])
def test_sqlite_semantic_audit_binds_checkpoint_cursor_snapshot(
    tmp_path: Path,
    tamper: str,
) -> None:
    async def scenario() -> None:
        path = tmp_path / f"checkpoint-cursor-{tamper}.db"
        provider = SQLiteCycleStoreProvider(
            path,
            initial_time="2026-07-27T00:00:00Z",
        )
        batch = await create_stream(provider)
        for index, checkpoint_id in enumerate(("checkpoint-a", "checkpoint-b"), start=1):
            checkpoint = create_cycle_store_checkpoint(
                checkpoint_scope="scope-a",
                checkpoint_id=checkpoint_id,
                stream_id="stream-a",
                bound_sequence=0,
                bound_record_hash=str(batch[0]["recordHash"]),
                created_at=f"2026-07-27T00:00:0{index}Z",
                value={"checkpoint": checkpoint_id},
            )
            await provider.save_checkpoint(
                {
                    "context": mutation(f"save-{checkpoint_id}"),
                    "checkpoint": checkpoint,
                    "lease": None,
                }
            )
        page = await provider.list_checkpoints(
            {
                "context": AUTH,
                "checkpointScope": "scope-a",
                "pageSize": 1,
                "cursor": None,
            }
        )
        assert page["nextCursor"] is not None
        connection = sqlite3.connect(path)
        try:
            row = connection.execute(
                "SELECT snapshot_blob FROM ge_cycle_cursors WHERE consumed_at_ms IS NULL"
            ).fetchone()
            assert row is not None and isinstance(row[0], bytes)
            snapshot = json.loads(row[0])
            assert isinstance(snapshot, list) and len(snapshot) == 2
            if tamper == "unretained-summary":
                snapshot[0]["checkpointId"] = "forged-checkpoint"
            else:
                snapshot.reverse()
            connection.execute(
                "UPDATE ge_cycle_cursors SET snapshot_blob = ?",
                (ge.canonical_bytes(snapshot),),
            )
            connection.commit()
        finally:
            connection.close()
        await expect_code(
            provider.audit_integrity("semantic"),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        await provider.close()

    asyncio.run(scenario())


def test_sqlite_ttl_additions_reject_safe_integer_overflow(tmp_path: Path) -> None:
    async def scenario() -> None:
        acquire = SQLiteCycleStoreProvider(
            tmp_path / "lease-overflow.db",
            initial_time="2026-07-27T00:00:00Z",
        )
        await create_stream(acquire)
        acquire._manual_now_ms = 2**53 - 1
        await expect_code(
            acquire.acquire_lease(
                {
                    "context": mutation("lease-overflow"),
                    "streamId": "stream-a",
                    "leaseId": "lease-overflow",
                    "holderId": "holder-a",
                    "ttlMs": 1,
                    "mode": "acquire",
                    "expectedFencingToken": 0,
                }
            ),
            "GE_CYCLE_STORE_QUOTA_EXCEEDED",
        )
        await acquire.close()

        with pytest.raises(CycleStoreProviderError) as renew_overflow:
            _add_duration(2**53 - 1, 1, "renew-lease")
        assert renew_overflow.value.code == "GE_CYCLE_STORE_QUOTA_EXCEEDED"

        migration = SQLiteCycleStoreProvider(
            tmp_path / "migration-overflow.db",
            initial_time="2026-07-27T00:00:00Z",
        )
        migration._manual_now_ms = 2**53 - 1
        await expect_code(
            migration.acquire_migration_lock(
                {
                    "context": mutation("migration-overflow"),
                    "lockId": "migration-overflow",
                    "ownerId": "owner-a",
                    "sourceSchemaVersion": 1,
                    "targetSchemaVersion": 2,
                    "ttlMs": 1,
                    "mode": "acquire",
                    "expectedFencingToken": 0,
                }
            ),
            "GE_CYCLE_STORE_QUOTA_EXCEEDED",
        )
        await migration.close()

    asyncio.run(scenario())


def test_sqlite_quick_audit_hardens_and_validates_connection_settings(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        provider = SQLiteCycleStoreProvider(
            tmp_path / "audit-settings.db",
            initial_time="2026-07-27T00:00:00Z",
        )
        observed: dict[str, object] = {}
        original = provider._validate_audit_connection_settings

        def capture_settings(
            connection: sqlite3.Connection,
            operation: Any,
        ) -> None:
            observed["queryOnly"] = connection.execute("PRAGMA query_only").fetchone()
            observed["busyTimeout"] = connection.execute(
                "PRAGMA busy_timeout"
            ).fetchone()
            original(connection, operation)

        provider._validate_audit_connection_settings = capture_settings  # type: ignore[method-assign]
        assert (await provider.audit_integrity("quick"))["quickCheck"] == "ok"
        assert observed == {"queryOnly": (1,), "busyTimeout": (250,)}
        connection = provider._connection
        assert connection is not None
        restored = provider._executor.submit(
            lambda: (
                connection.execute("PRAGMA query_only").fetchone(),
                connection.execute("PRAGMA busy_timeout").fetchone(),
            )
        ).result()
        assert restored == ((0,), (250,))

        provider._executor.submit(
            lambda: connection.execute("PRAGMA foreign_keys = OFF")
        ).result()
        await expect_code(
            provider.audit_integrity("quick"),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        await provider.close()

    asyncio.run(scenario())


def test_sqlite_cancellation_recovers_a_hidden_commit_by_operation_id(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        entered = threading.Event()
        release = threading.Event()
        armed = True

        def fault(boundary: str) -> None:
            nonlocal armed
            if armed and boundary == "provider:append:before-commit":
                armed = False
                entered.set()
                assert release.wait(timeout=5)

        provider = SQLiteCycleStoreProvider(
            tmp_path / "cancel-hidden-commit.db",
            initial_time="2026-07-27T00:00:00Z",
            fault_hook=fault,
        )
        request = {
            "context": mutation("cancel-hidden-commit"),
            "streamId": "stream-a",
            "expectedTail": MISSING,
            "lease": None,
            "records": records(1, "cancel-hidden-commit"),
        }
        task = asyncio.create_task(provider.append(request))
        assert await asyncio.to_thread(entered.wait, 5)
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
        recovered = await provider.append(request)
        assert recovered["appendedRecords"] == 1
        page = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 10,
                "cursor": None,
            }
        )
        assert len(page["records"]) == 1
        await provider.close()

    asyncio.run(scenario())


def test_sqlite_append_exposes_exact_synchronous_transaction_stage_order(
    tmp_path: Path,
) -> None:
    async def scenario() -> None:
        observed: list[str] = []
        provider = SQLiteCycleStoreProvider(
            tmp_path / "stage-order.db",
            initial_time="2026-07-27T00:00:00Z",
            fault_hook=observed.append,
        )
        result = await provider.append(
            {
                "context": mutation("stage-order"),
                "streamId": "stream-a",
                "expectedTail": MISSING,
                "lease": None,
                "records": records(1, "stage-order"),
            }
        )
        assert result["appendedRecords"] == 1
        assert observed == [
            "provider:append:transaction-reserved",
            "provider:append:decision-state-read",
            "provider:append:records-staged",
            "provider:append:ledger-staged",
            "provider:append:before-commit",
            "provider:append:commit-returned",
            "provider:append:after-commit-before-return",
        ]
        await provider.close()

    asyncio.run(scenario())


@pytest.mark.parametrize(
    ("boundary", "committed_before_fault"),
    [
        ("provider:append:transaction-reserved", False),
        ("provider:append:decision-state-read", False),
        ("provider:append:records-staged", False),
        ("provider:append:ledger-staged", False),
        ("provider:append:before-commit", False),
        ("provider:append:commit-returned", True),
        ("provider:append:after-commit-before-return", True),
    ],
)
def test_sqlite_append_stage_faults_rollback_or_recover_by_operation_id(
    tmp_path: Path,
    boundary: str,
    committed_before_fault: bool,
) -> None:
    async def scenario() -> None:
        armed = True

        def fault(observed: str) -> None:
            nonlocal armed
            if armed and observed == boundary:
                armed = False
                raise RuntimeError("hostile fault payload")

        provider = SQLiteCycleStoreProvider(
            tmp_path / f"stage-fault-{boundary.rsplit(':', 1)[-1]}.db",
            initial_time="2026-07-27T00:00:00Z",
            fault_hook=fault,
        )
        request = {
            "context": mutation("stage-fault"),
            "streamId": "stream-a",
            "expectedTail": MISSING,
            "lease": None,
            "records": records(1, "stage-fault"),
        }
        error = await expect_code(
            provider.append(request),
            "GE_CYCLE_STORE_UNAVAILABLE",
        )
        assert error.details == {"boundary": boundary}
        tail_after_fault = await provider.read_tail(
            {"context": AUTH, "streamId": "stream-a"}
        )
        assert tail_after_fault["exists"] is committed_before_fault

        recovered = await provider.append(request)
        assert recovered["appendedRecords"] == 1
        page = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 10,
                "cursor": None,
            }
        )
        assert len(page["records"]) == 1
        assert page["records"][0]["recordId"] == "stage-fault-0"
        await provider.close()

    asyncio.run(scenario())
