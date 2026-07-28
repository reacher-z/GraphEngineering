#!/usr/bin/env python3
"""Bounded JSON worker for retained SQLite cross-language interoperability."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import platform
import sqlite3
import sys
from datetime import datetime
from importlib.resources import files
from pathlib import Path
from typing import Any, Never, cast

from graph_engineering import (
    SQLITE_BACKUP_MANIFEST_API_VERSION,
    SQLITE_BACKUP_MANIFEST_DOMAIN,
    SQLITE_CYCLE_STORE_APPLICATION_ID,
    SQLITE_CYCLE_STORE_CATALOG_SHA256,
    SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
    SQLITE_CYCLE_STORE_PROVIDER_ID,
    SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
    SQLITE_CYCLE_STORE_SCHEMA_VERSION,
    CycleStoreProviderError,
    SQLiteCycleStoreProvider,
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    cycle_store_adapter_codec,
)
from graph_engineering.canonical import canonical_sha256

AUTH: dict[str, Any] = {
    "tenantId": "interop-tenant",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}
MISSING: dict[str, Any] = {
    "exists": False,
    "sequence": -1,
    "recordHash": None,
}
COMMAND_TIMEOUT_SECONDS = 20.0
MAX_CURSOR_PAGES = 8


def emit(value: object) -> None:
    sys.stdout.write(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def worker_failure() -> Never:
    emit(
        {
            "type": "result",
            "outcome": "worker-error",
            "error": {
                "name": "WorkerError",
                "code": None,
                "operation": None,
                "retryable": None,
                "message": "SQLite interop worker failed safely",
                "details": {},
            },
        }
    )
    raise SystemExit(70)


def mutation(operation_id: str) -> dict[str, Any]:
    return {**AUTH, "operationId": operation_id}


def lease_binding(lease: dict[str, Any]) -> dict[str, Any]:
    return {
        "leaseId": lease["leaseId"],
        "holderId": lease["holderId"],
        "fencingToken": lease["fencingToken"],
    }


def records(
    count: int,
    prefix: str,
    start_sequence: int = 0,
    previous_record_hash: str | None = None,
    value: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    previous = previous_record_hash
    for offset in range(count):
        sequence = start_sequence + offset
        record = create_cycle_store_record(
            record_id=f"{prefix}-{sequence}",
            sequence=sequence,
            previous_record_hash=previous,
            value={"source": prefix, "sequence": sequence, **(value or {})},
        )
        result.append(record)
        previous = cast(str, record["recordHash"])
    return result


def provider(path: str, now: str) -> SQLiteCycleStoreProvider:
    return SQLiteCycleStoreProvider(path, initial_time=now)


async def append_batch(
    store: SQLiteCycleStoreProvider,
    *,
    operation_id: str,
    stream_id: str,
    batch: list[dict[str, Any]],
    expected_tail: dict[str, Any] | None = None,
    lease: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await store.append(
        {
            "context": mutation(operation_id),
            "streamId": stream_id,
            "expectedTail": expected_tail or MISSING,
            "lease": lease,
            "records": batch,
        }
    )


async def state_summary(
    store: SQLiteCycleStoreProvider,
    configuration: dict[str, Any],
    cursor_continuation: dict[str, Any],
) -> dict[str, Any]:
    descriptor = await store.describe()
    schema = await store.inspect_schema(AUTH)
    full_page = await store.read_event_page(
        {
            "context": AUTH,
            "streamId": configuration["streamId"],
            "fromSequence": 0,
            "pageSize": 256,
            "cursor": None,
        }
    )
    checkpoint = await store.load_checkpoint(
        {
            "context": AUTH,
            "checkpointScope": configuration["checkpointScope"],
            "checkpointId": configuration["checkpointId"],
        }
    )
    lease = await store.inspect_lease(
        {"context": AUTH, "streamId": configuration["streamId"]}
    )
    governance = await store.inspect_governance(
        {"context": AUTH, "streamId": configuration["streamId"]}
    )
    tail = await store.read_tail(
        {"context": AUTH, "streamId": configuration["streamId"]}
    )
    return {
        "descriptorHash": descriptor["descriptorHash"],
        "schemaVersion": schema["schemaVersion"],
        "tail": tail,
        "records": full_page["records"],
        "checkpoint": checkpoint,
        "lease": lease,
        "governance": governance,
        "cursorContinuation": cursor_continuation,
    }


async def seed_state(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    prefix = cast(str, configuration["prefix"])
    stream_id = cast(str, configuration["streamId"])
    try:
        batch = records(3, prefix)
        appended = await append_batch(
            store,
            operation_id=f"{prefix}-append",
            stream_id=stream_id,
            batch=batch,
        )
        checkpoint = create_cycle_store_checkpoint(
            checkpoint_scope=configuration["checkpointScope"],
            checkpoint_id=configuration["checkpointId"],
            stream_id=stream_id,
            bound_sequence=2,
            bound_record_hash=cast(str, batch[2]["recordHash"]),
            created_at=configuration["checkpointCreatedAt"],
            value={"source": prefix, "state": "checkpoint"},
        )
        await store.save_checkpoint(
            {
                "context": mutation(f"{prefix}-checkpoint-save"),
                "checkpoint": checkpoint,
                "lease": None,
            }
        )
        first_lease = await store.acquire_lease(
            {
                "context": mutation(f"{prefix}-lease-one-acquire"),
                "streamId": stream_id,
                "leaseId": f"{prefix}-lease-one",
                "holderId": f"{prefix}-holder-one",
                "ttlMs": 10_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )
        first_binding = lease_binding(first_lease)
        await store.renew_lease(
            {
                "context": mutation(f"{prefix}-lease-one-renew"),
                "streamId": stream_id,
                "lease": first_binding,
                "ttlMs": 20_000,
            }
        )
        await store.release_lease(
            {
                "context": mutation(f"{prefix}-lease-one-release"),
                "streamId": stream_id,
                "lease": first_binding,
            }
        )
        second_lease = await store.acquire_lease(
            {
                "context": mutation(f"{prefix}-lease-two-acquire"),
                "streamId": stream_id,
                "leaseId": f"{prefix}-lease-two",
                "holderId": f"{prefix}-holder-two",
                "ttlMs": 10_000,
                "mode": "acquire",
                "expectedFencingToken": 1,
            }
        )
        await store.release_lease(
            {
                "context": mutation(f"{prefix}-lease-two-release"),
                "streamId": stream_id,
                "lease": lease_binding(second_lease),
            }
        )
        await store.set_legal_hold(
            {
                "context": mutation(f"{prefix}-hold-place"),
                "streamId": stream_id,
                "holdId": f"{prefix}-hold",
                "action": "place",
            }
        )
        first_page = await store.read_event_page(
            {
                "context": AUTH,
                "streamId": stream_id,
                "fromSequence": 0,
                "pageSize": 1,
                "cursor": None,
            }
        )
        cursor = first_page["nextCursor"]
        if type(cursor) is not str:
            raise TypeError("state seed did not produce a cursor")
        expected_continuation = {
            "record": batch[1],
            "snapshotTail": appended["tail"],
            "hasNextCursor": True,
        }
        summary = await state_summary(store, configuration, expected_continuation)
        return {
            "summary": summary,
            "publicCanonicalSha256": canonical_sha256(summary),
            "cursor": cursor,
        }
    finally:
        await store.close()


async def validate_state(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        continuation = await store.read_event_page(
            {
                "context": AUTH,
                "streamId": configuration["streamId"],
                "fromSequence": None,
                "pageSize": 1,
                "cursor": configuration["cursor"],
            }
        )
        continuation_records = cast(list[dict[str, Any]], continuation["records"])
        if len(continuation_records) != 1:
            raise ValueError("state continuation shape is invalid")
        normalized = {
            "record": continuation_records[0],
            "snapshotTail": continuation["snapshotTail"],
            "hasNextCursor": continuation["nextCursor"] is not None,
        }
        summary = await state_summary(store, configuration, normalized)
        audit = await store.audit_integrity("semantic")
        return {
            "summary": summary,
            "publicCanonicalSha256": canonical_sha256(summary),
            "audit": audit,
        }
    finally:
        await store.close()


async def audit_state(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        return {
            "descriptor": await store.describe(),
            "schema": await store.inspect_schema(AUTH),
            "audit": await store.audit_integrity("semantic"),
        }
    finally:
        await store.close()


async def append_continuation(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        tail = await store.read_tail(
            {"context": AUTH, "streamId": configuration["streamId"]}
        )
        batch = records(
            1,
            configuration["prefix"],
            cast(int, tail["sequence"]) + 1,
            cast(str, tail["recordHash"]),
            cast(dict[str, Any], configuration.get("value", {})),
        )
        result = await append_batch(
            store,
            operation_id=configuration["operationId"],
            stream_id=configuration["streamId"],
            batch=batch,
            expected_tail=tail,
        )
        return {"record": batch[0], "result": result}
    finally:
        await store.close()


async def seed_checkpoint_snapshot(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        stream_id = cast(str, configuration["streamId"])
        prefix = cast(str, configuration["prefix"])
        batch = records(1, prefix)
        await append_batch(
            store,
            operation_id=f"{prefix}-append",
            stream_id=stream_id,
            batch=batch,
        )
        for index, suffix in enumerate(("a", "b", "c"), start=1):
            checkpoint = create_cycle_store_checkpoint(
                checkpoint_scope=configuration["checkpointScope"],
                checkpoint_id=f"{prefix}-checkpoint-{suffix}",
                stream_id=stream_id,
                bound_sequence=0,
                bound_record_hash=cast(str, batch[0]["recordHash"]),
                created_at=f"2026-07-27T00:00:0{index}Z",
                value={"source": prefix, "suffix": suffix},
            )
            await store.save_checkpoint(
                {
                    "context": mutation(f"{prefix}-save-{suffix}"),
                    "checkpoint": checkpoint,
                    "lease": None,
                }
            )
        page = await store.list_checkpoints(
            {
                "context": AUTH,
                "checkpointScope": configuration["checkpointScope"],
                "pageSize": 1,
                "cursor": None,
            }
        )
        cursor = page["nextCursor"]
        page_checkpoints = cast(list[dict[str, Any]], page["checkpoints"])
        if type(cursor) is not str or len(page_checkpoints) != 1:
            raise TypeError("checkpoint seed did not produce a cursor")
        return {
            "firstCheckpointId": page_checkpoints[0]["checkpointId"],
            "cursor": cursor,
            "record": batch[0],
        }
    finally:
        await store.close()


async def continue_checkpoint_snapshot(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        cursor: str | None = configuration["cursor"]
        snapshot_ids: list[str] = []
        for _ in range(MAX_CURSOR_PAGES):
            if cursor is None:
                break
            page = await store.list_checkpoints(
                {
                    "context": AUTH,
                    "checkpointScope": configuration["checkpointScope"],
                    "pageSize": 1,
                    "cursor": cursor,
                }
            )
            page_checkpoints = cast(list[dict[str, Any]], page["checkpoints"])
            snapshot_ids.extend(
                cast(str, checkpoint["checkpointId"]) for checkpoint in page_checkpoints
            )
            cursor = cast(str | None, page["nextCursor"])
        if cursor is not None:
            raise RuntimeError("checkpoint cursor exceeded its page bound")
        live = await store.list_checkpoints(
            {
                "context": AUTH,
                "checkpointScope": configuration["checkpointScope"],
                "pageSize": 256,
                "cursor": None,
            }
        )
        return {
            "snapshotIds": snapshot_ids,
            "liveIds": [
                checkpoint["checkpointId"]
                for checkpoint in cast(list[dict[str, Any]], live["checkpoints"])
            ],
            "audit": await store.audit_integrity("semantic"),
        }
    finally:
        await store.close()


async def restore_and_continue(configuration: dict[str, Any]) -> dict[str, Any]:
    manifest_path = Path(f"{configuration['backupPath']}.manifest.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    store = await SQLiteCycleStoreProvider.restore_backup(
        configuration["backupPath"],
        configuration["destinationPath"],
        initial_time=configuration["now"],
    )
    try:
        tail = await store.read_tail(
            {"context": AUTH, "streamId": configuration["streamId"]}
        )
        batch = records(
            1,
            configuration["prefix"],
            cast(int, tail["sequence"]) + 1,
            cast(str, tail["recordHash"]),
        )
        result = await append_batch(
            store,
            operation_id=configuration["operationId"],
            stream_id=configuration["streamId"],
            batch=batch,
            expected_tail=tail,
        )
        return {
            "manifestSha256": manifest["manifestSha256"],
            "record": batch[0],
            "result": result,
            "audit": await store.audit_integrity("semantic"),
        }
    finally:
        await store.close()


async def seed_backup(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        batch = records(2, configuration["prefix"])
        result = await append_batch(
            store,
            operation_id=configuration["operationId"],
            stream_id=configuration["streamId"],
            batch=batch,
        )
        backup = await store.backup(configuration["backupPath"])
        integrity = backup.get("integrity")
        if not isinstance(integrity, dict):
            raise TypeError("backup integrity is invalid")
        return {
            "records": batch,
            "result": result,
            "manifestSha256": backup["manifestSha256"],
            "semanticSha256": integrity["semanticSha256"],
            "counters": integrity["counters"],
        }
    finally:
        await store.close()


async def validate_simple(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        page = await store.read_event_page(
            {
                "context": AUTH,
                "streamId": configuration["streamId"],
                "fromSequence": 0,
                "pageSize": 256,
                "cursor": None,
            }
        )
        return {
            "records": page["records"],
            "tail": await store.read_tail(
                {"context": AUTH, "streamId": configuration["streamId"]}
            ),
            "audit": await store.audit_integrity("semantic"),
        }
    finally:
        await store.close()


def file_sha256(path: Any) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def identities(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        descriptor = await store.describe()
        schema = await store.inspect_schema(AUTH)
        record = create_cycle_store_record(
            record_id="identity-record-0",
            sequence=0,
            previous_record_hash=None,
            value={"identity": "portable", "sequence": 0},
        )
        request = {
            "context": mutation("identity-operation"),
            "streamId": "identity-stream",
            "expectedTail": MISSING,
            "lease": None,
            "records": [record],
        }
        captured = cycle_store_adapter_codec.capture_request(
            "append", request, descriptor
        )
        migration_root = files("graph_engineering._sqlite_migrations")
        return {
            "providerId": SQLITE_CYCLE_STORE_PROVIDER_ID,
            "descriptorHash": SQLITE_CYCLE_STORE_DESCRIPTOR_HASH,
            "applicationId": SQLITE_CYCLE_STORE_APPLICATION_ID,
            "schemaVersion": SQLITE_CYCLE_STORE_SCHEMA_VERSION,
            "schemaIdentitySha256": SQLITE_CYCLE_STORE_SCHEMA_IDENTITY_SHA256,
            "catalogSha256": SQLITE_CYCLE_STORE_CATALOG_SHA256,
            "migrationManifestSha256": file_sha256(
                migration_root.joinpath("manifest.json")
            ),
            "schemaSqlSha256": file_sha256(migration_root.joinpath("schema-v1.sql")),
            "schemaIdentityDocumentSha256": file_sha256(
                migration_root.joinpath("schema-v1.identity.json")
            ),
            "alphaV0ToV1SqlSha256": file_sha256(
                migration_root.joinpath("0001-alpha-v0-to-v1.sql")
            ),
            "backupManifestApiVersion": SQLITE_BACKUP_MANIFEST_API_VERSION,
            "backupManifestDomain": SQLITE_BACKUP_MANIFEST_DOMAIN,
            "record": record,
            "recordCanonicalSha256": canonical_sha256(record),
            "operationRequestHash": cycle_store_adapter_codec.operation_request_hash(
                "append", captured
            ),
            "descriptorInspectionHash": descriptor["descriptorHash"],
            "schemaInspectionHash": schema["descriptorHash"],
            "semanticAudit": await store.audit_integrity("semantic"),
            "pythonVersion": platform.python_version(),
            "sqliteVersion": sqlite3.sqlite_version,
        }
    finally:
        await store.close()


async def expect_go() -> dict[str, Any]:
    line = await asyncio.wait_for(
        asyncio.to_thread(sys.stdin.readline), COMMAND_TIMEOUT_SECONDS
    )
    if not line:
        raise EOFError("interop parent closed stdin")
    value = json.loads(line)
    if type(value) is not dict or value.get("type") != "go":
        raise ValueError("interop command is invalid")
    return cast(dict[str, Any], value)


async def race(configuration: dict[str, Any]) -> dict[str, Any]:
    store = provider(configuration["path"], configuration["now"])
    try:
        emit({"type": "ready", "pid": os.getpid()})
        await expect_go()
        batch = records(
            1,
            configuration["prefix"],
            value=cast(dict[str, Any], configuration.get("value", {})),
        )
        result = await append_batch(
            store,
            operation_id=configuration["operationId"],
            stream_id=configuration["streamId"],
            batch=batch,
        )
        return {"record": batch[0], "result": result}
    finally:
        await store.close()


async def stale_lease(configuration: dict[str, Any]) -> dict[str, Any]:
    clock = [datetime.fromisoformat(configuration["now"].replace("Z", "+00:00"))]
    store = SQLiteCycleStoreProvider(configuration["path"], now=lambda: clock[0])
    try:
        lease = await store.acquire_lease(
            {
                "context": mutation(configuration["acquireOperationId"]),
                "streamId": configuration["streamId"],
                "leaseId": configuration["leaseId"],
                "holderId": configuration["holderId"],
                "ttlMs": configuration["ttlMs"],
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )
        emit({"type": "ready", "pid": os.getpid(), "value": {"lease": lease}})
        await expect_go()
        clock[0] = datetime.fromisoformat(
            configuration["appendNow"].replace("Z", "+00:00")
        )
        batch = records(
            1,
            configuration["prefix"],
            cast(int, configuration["expectedTail"]["sequence"]) + 1,
            cast(str, configuration["expectedTail"]["recordHash"]),
        )
        result = await append_batch(
            store,
            operation_id=configuration["appendOperationId"],
            stream_id=configuration["streamId"],
            batch=batch,
            expected_tail=configuration["expectedTail"],
            lease=lease_binding(lease),
        )
        return {"record": batch[0], "result": result}
    finally:
        await store.close()


async def dispatch(configuration: dict[str, Any]) -> dict[str, Any]:
    mode = configuration["mode"]
    if mode == "race":
        return await race(configuration)
    if mode == "stale-lease":
        return await stale_lease(configuration)

    emit({"type": "ready", "pid": os.getpid()})
    await expect_go()
    actions = {
        "seed-state": seed_state,
        "validate-state": validate_state,
        "audit-state": audit_state,
        "append-continuation": append_continuation,
        "seed-checkpoint-snapshot": seed_checkpoint_snapshot,
        "continue-checkpoint-snapshot": continue_checkpoint_snapshot,
        "restore-and-continue": restore_and_continue,
        "seed-backup": seed_backup,
        "validate-simple": validate_simple,
        "identities": identities,
    }
    action = actions.get(mode)
    if action is None:
        raise ValueError("unknown interop worker mode")
    return await action(configuration)


def main() -> None:
    try:
        configuration = json.loads(sys.argv[1])
        if (
            type(configuration) is not dict
            or type(configuration.get("mode")) is not str
        ):
            worker_failure()
        value = asyncio.run(dispatch(configuration))
        emit({"type": "result", "outcome": "accepted", "value": value})
    except CycleStoreProviderError as error:
        emit(
            {
                "type": "result",
                "outcome": "rejected",
                "error": error.to_dict(),
            }
        )
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 - sanitize every unexpected process-boundary failure.
        worker_failure()


if __name__ == "__main__":
    main()
