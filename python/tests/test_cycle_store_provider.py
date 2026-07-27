from __future__ import annotations

import asyncio
import copy
import hashlib
from collections.abc import Awaitable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from graph_engineering import canonical_json
from graph_engineering.cycle_store_provider import (
    CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
    CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN,
    MAX_CYCLE_STORE_APPEND_RECORDS,
    MAX_CYCLE_STORE_PAGE_SIZE,
    CycleStoreProviderError,
    MemoryCycleStoreProvider,
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    create_reference_cycle_store_provider_descriptor,
    validate_cycle_store_provider_descriptor,
)

AUTH: dict[str, Any] = {
    "tenantId": "tenant-a",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}
AUTH_B: dict[str, Any] = {
    "tenantId": "tenant-b",
    "principalHash": "c" * 64,
    "authorizationHash": "d" * 64,
}
MISSING = {"exists": False, "sequence": -1, "recordHash": None}


def mutation(operation_id: str, auth: dict[str, Any] = AUTH) -> dict[str, Any]:
    return {**auth, "operationId": operation_id}


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
    provider: MemoryCycleStoreProvider,
    stream_id: str = "stream-a",
    auth: dict[str, Any] = AUTH,
    count: int = 1,
) -> list[dict[str, Any]]:
    batch = records(count, f"{auth['tenantId']}-{stream_id}")
    await provider.append(
        {
            "context": mutation(f"create-{auth['tenantId']}-{stream_id}", auth),
            "streamId": stream_id,
            "expectedTail": MISSING,
            "lease": None,
            "records": batch,
        }
    )
    return batch


def binding(lease: dict[str, Any]) -> dict[str, Any]:
    return {
        "leaseId": lease["leaseId"],
        "holderId": lease["holderId"],
        "fencingToken": lease["fencingToken"],
    }


async def expect_code(
    awaitable: Awaitable[object],
    code: str,
) -> CycleStoreProviderError:
    with pytest.raises(CycleStoreProviderError) as caught:
        await awaitable
    assert caught.value.code == code
    return caught.value


def descriptor_hash(body: dict[str, Any]) -> str:
    return hashlib.sha256(
        (CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN + canonical_json(body)).encode()
    ).hexdigest()


def test_provider_surface_is_exported_and_all_groups_remain_sorted() -> None:
    import graph_engineering as ge

    assert ge.MemoryCycleStoreProvider is MemoryCycleStoreProvider
    assert ge.CycleStoreProviderError is CycleStoreProviderError
    assert ge.create_cycle_store_record is create_cycle_store_record
    assert ge.create_cycle_store_checkpoint is create_cycle_store_checkpoint
    assert (
        ge.create_reference_cycle_store_provider_descriptor
        is create_reference_cycle_store_provider_descriptor
    )
    uppercase = [name for name in ge.__all__ if name.upper() == name]
    pascal = [name for name in ge.__all__ if name[0].isupper() and name.upper() != name]
    lowercase = [name for name in ge.__all__ if name[0].islower()]
    assert uppercase == sorted(uppercase)
    assert pascal == sorted(pascal)
    assert lowercase == sorted(lowercase)


def test_descriptor_is_closed_extensible_and_cross_language_content_addressed() -> None:
    descriptor = create_reference_cycle_store_provider_descriptor()
    assert descriptor["contractVersion"] == CYCLE_STORE_PROVIDER_CONTRACT_VERSION
    assert descriptor["descriptorHash"] == (
        "8a0caf1fd5c58a94ae15a627098396a033e7026ead96756ea8e7ad6998b6de4c"
    )
    assert validate_cycle_store_provider_descriptor(descriptor) == descriptor

    opened = copy.deepcopy(descriptor)
    opened["unknown"] = True
    with pytest.raises(CycleStoreProviderError):
        validate_cycle_store_provider_descriptor(opened)

    version = copy.deepcopy(descriptor)
    version["contractVersion"] = "cycle-store-provider/v2"
    with pytest.raises(CycleStoreProviderError) as version_error:
        validate_cycle_store_provider_descriptor(version)
    assert version_error.value.code == "GE_CYCLE_STORE_UNSUPPORTED_VERSION"

    durable_body = copy.deepcopy(descriptor)
    durable_body.pop("descriptorHash")
    durable_body["providerId"] = "postgresql-reference"
    durable_body["limits"]["maxPageSize"] = 128
    durable_body["capabilities"].update(
        {
            "durability": "durable",
            "distributedFencing": True,
            "legalHold": "enforced",
            "backupRestore": "enforced",
        }
    )
    durable_body["protection"].update(
        {"payloadProtection": "provider-managed", "encryptionAtRest": "provider-managed"}
    )
    durable_body["governance"].update({"retention": "enforced", "archival": "enforced"})
    durable = {**durable_body, "descriptorHash": descriptor_hash(durable_body)}
    assert validate_cycle_store_provider_descriptor(durable) == durable

    excessive = copy.deepcopy(descriptor)
    excessive["limits"]["maxPageSize"] = MAX_CYCLE_STORE_PAGE_SIZE + 1
    with pytest.raises(CycleStoreProviderError) as limit_error:
        validate_cycle_store_provider_descriptor(excessive)
    assert limit_error.value.code == "GE_CYCLE_STORE_QUOTA_EXCEEDED"


def test_append_detaches_values_and_reads() -> None:
    async def scenario() -> None:
        provider = MemoryCycleStoreProvider()
        caller_values = [{"sequence": sequence, "source": "record"} for sequence in range(3)]
        batch: list[dict[str, Any]] = []
        for sequence, value in enumerate(caller_values):
            batch.append(
                create_cycle_store_record(
                    record_id=f"record-{sequence}",
                    sequence=sequence,
                    previous_record_hash=(None if not batch else str(batch[-1]["recordHash"])),
                    value=value,
                )
            )
        result = await provider.append(
            {
                "context": mutation("append-1"),
                "streamId": "stream-a",
                "expectedTail": MISSING,
                "lease": None,
                "records": batch,
            }
        )
        caller_values[0]["sequence"] = 99
        page = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 10,
                "cursor": None,
            }
        )
        page["records"][0]["value"]["sequence"] = 77
        repeated = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 10,
                "cursor": None,
            }
        )
        assert repeated["records"][0]["value"]["sequence"] == 0
        assert await provider.read_tail({"context": AUTH, "streamId": "stream-a"}) == result[
            "tail"
        ]

    asyncio.run(scenario())


def test_append_captures_before_awaiting_authorization() -> None:
    async def scenario() -> None:
        gate = asyncio.Event()

        async def authorize(_context: dict[str, Any], _operation: str) -> bool:
            await gate.wait()
            return True

        provider = MemoryCycleStoreProvider(authorize=authorize)
        original = records(1, "captured")[0]
        caller_records = [original]
        pending = asyncio.create_task(
            provider.append(
                {
                    "context": mutation("capture-before-await"),
                    "streamId": "stream-a",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": caller_records,
                }
            )
        )
        await asyncio.sleep(0)
        caller_records[0] = create_cycle_store_record(
            record_id="hostile-replacement",
            sequence=0,
            previous_record_hash=None,
            value={"sentinel": "MUST_NOT_COMMIT"},
        )
        gate.set()
        await pending
        page = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 1,
                "cursor": None,
            }
        )
        assert page["records"][0]["recordHash"] == original["recordHash"]
        assert "MUST_NOT_COMMIT" not in canonical_json(provider.unsafe_state_snapshot_for_test())

    asyncio.run(scenario())


def test_idempotency_commit_ambiguity_and_concurrent_cas() -> None:
    async def scenario() -> None:
        armed = True

        def fault(boundary: str) -> None:
            nonlocal armed
            if armed and boundary == "provider:append:after-commit-before-return":
                armed = False
                raise RuntimeError("lost acknowledgement")

        provider = MemoryCycleStoreProvider(fault_hook=fault)
        request = {
            "context": mutation("ambiguous"),
            "streamId": "stream-a",
            "expectedTail": MISSING,
            "lease": None,
            "records": records(1),
        }
        await expect_code(provider.append(request), "GE_CYCLE_STORE_UNAVAILABLE")
        assert (await provider.append(request))["appendedRecords"] == 1
        changed = copy.deepcopy(request)
        changed["records"] = records(1, "changed")
        await expect_code(
            provider.append(changed),
            "GE_CYCLE_STORE_IDEMPOTENCY_CONFLICT",
        )
        assert provider.unsafe_state_counters_for_test()["records"] == 1

        race = MemoryCycleStoreProvider()
        outcomes = await asyncio.gather(
            race.append(
                {
                    "context": mutation("left"),
                    "streamId": "shared",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": records(1, "left"),
                }
            ),
            race.append(
                {
                    "context": mutation("right"),
                    "streamId": "shared",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": records(1, "right"),
                }
            ),
            return_exceptions=True,
        )
        assert sum(isinstance(item, CycleStoreProviderError) for item in outcomes) == 1
        assert sum(isinstance(item, dict) for item in outcomes) == 1
        assert race.unsafe_state_counters_for_test()["records"] == 1

    asyncio.run(scenario())


def test_snapshot_pagination_cursor_replay_scope_and_expiry() -> None:
    async def scenario() -> None:
        provider = MemoryCycleStoreProvider()
        initial = await create_stream(provider, count=5)
        first = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 2,
                "cursor": None,
            }
        )
        sixth = create_cycle_store_record(
            record_id="sixth",
            sequence=5,
            previous_record_hash=str(initial[-1]["recordHash"]),
            value={"sequence": 5},
        )
        await provider.append(
            {
                "context": mutation("sixth"),
                "streamId": "stream-a",
                "expectedTail": first["snapshotTail"],
                "lease": None,
                "records": [sixth],
            }
        )
        second = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": None,
                "pageSize": 2,
                "cursor": first["nextCursor"],
            }
        )
        await expect_code(
            provider.read_event_page(
                {
                    "context": AUTH,
                    "streamId": "stream-a",
                    "fromSequence": None,
                    "pageSize": 2,
                    "cursor": first["nextCursor"],
                }
            ),
            "GE_CYCLE_STORE_INVALID_CURSOR",
        )
        third = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": None,
                "pageSize": 2,
                "cursor": second["nextCursor"],
            }
        )
        assert [item["sequence"] for item in second["records"] + third["records"]] == [2, 3, 4]

        expiring = await provider.read_event_page(
            {
                "context": AUTH,
                "streamId": "stream-a",
                "fromSequence": 0,
                "pageSize": 1,
                "cursor": None,
            }
        )
        await expect_code(
            provider.read_event_page(
                {
                    "context": AUTH_B,
                    "streamId": "stream-a",
                    "fromSequence": None,
                    "pageSize": 1,
                    "cursor": expiring["nextCursor"],
                }
            ),
            "GE_CYCLE_STORE_INVALID_CURSOR",
        )
        provider.unsafe_advance_clock_for_test(300_001)
        await expect_code(
            provider.read_event_page(
                {
                    "context": AUTH,
                    "streamId": "stream-a",
                    "fromSequence": None,
                    "pageSize": 1,
                    "cursor": expiring["nextCursor"],
                }
            ),
            "GE_CYCLE_STORE_INVALID_CURSOR",
        )
        assert provider.unsafe_state_counters_for_test()["cursors"] == 0

    asyncio.run(scenario())


def test_exact_count_page_clock_and_fence_boundaries() -> None:
    async def scenario() -> None:
        provider = MemoryCycleStoreProvider()
        before = provider.unsafe_state_counters_for_test()
        await expect_code(
            provider.append(
                {
                    "context": mutation("too-many"),
                    "streamId": "stream-a",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": records(MAX_CYCLE_STORE_APPEND_RECORDS + 1, "too-many"),
                }
            ),
            "GE_CYCLE_STORE_QUOTA_EXCEEDED",
        )
        assert provider.unsafe_state_counters_for_test() == before
        await provider.append(
            {
                "context": mutation("maximum"),
                "streamId": "stream-a",
                "expectedTail": MISSING,
                "lease": None,
                "records": records(MAX_CYCLE_STORE_APPEND_RECORDS, "maximum"),
            }
        )
        await expect_code(
            provider.read_event_page(
                {
                    "context": AUTH,
                    "streamId": "stream-a",
                    "fromSequence": 0,
                    "pageSize": MAX_CYCLE_STORE_PAGE_SIZE + 1,
                    "cursor": None,
                }
            ),
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
        )
        provider.unsafe_set_lease_counters_for_test(
            "tenant-a", "stream-a", 2**53 - 1, 2**53 - 1
        )
        await expect_code(
            provider.acquire_lease(
                {
                    "context": mutation("overflow"),
                    "streamId": "stream-a",
                    "leaseId": "overflow",
                    "holderId": "holder",
                    "ttlMs": 1,
                    "mode": "acquire",
                    "expectedFencingToken": 2**53 - 1,
                }
            ),
            "GE_CYCLE_STORE_QUOTA_EXCEEDED",
        )

        now = datetime(2026, 7, 27, 1, tzinfo=UTC)
        clock_value = [now]
        rollback = MemoryCycleStoreProvider(now=lambda: clock_value[0])
        await create_stream(rollback)
        lease = await rollback.acquire_lease(
            {
                "context": mutation("clock-first"),
                "streamId": "stream-a",
                "leaseId": "clock-first",
                "holderId": "holder",
                "ttlMs": 1_000,
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )
        clock_value[0] -= timedelta(milliseconds=1)
        await expect_code(
            rollback.renew_lease(
                {
                    "context": mutation("clock-back"),
                    "streamId": "stream-a",
                    "lease": binding(lease),
                    "ttlMs": 2_000,
                }
            ),
            "GE_CYCLE_STORE_INVALID_ARGUMENT",
        )

    asyncio.run(scenario())


def test_checkpoint_crud_order_immutability_and_corruption() -> None:
    async def scenario() -> None:
        provider = MemoryCycleStoreProvider()
        batch = await create_stream(provider, count=2)
        checkpoints = [
            create_cycle_store_checkpoint(
                checkpoint_scope="scope-a",
                checkpoint_id=f"cp-{suffix}",
                stream_id="stream-a",
                bound_sequence=1,
                bound_record_hash=str(batch[-1]["recordHash"]),
                created_at=f"2026-07-27T00:00:0{index}Z",
                value={"state": suffix},
            )
            for index, suffix in ((1, "a"), (2, "b"))
        ]
        for checkpoint in checkpoints:
            await provider.save_checkpoint(
                {
                    "context": mutation(f"save-{checkpoint['checkpointId']}"),
                    "checkpoint": checkpoint,
                    "lease": None,
                }
            )
        page = await provider.list_checkpoints(
            {"context": AUTH, "checkpointScope": "scope-a", "pageSize": 2, "cursor": None}
        )
        assert [item["checkpointId"] for item in page["checkpoints"]] == ["cp-b", "cp-a"]
        changed = create_cycle_store_checkpoint(
            checkpoint_scope="scope-a",
            checkpoint_id="cp-a",
            stream_id="stream-a",
            bound_sequence=1,
            bound_record_hash=str(batch[-1]["recordHash"]),
            created_at="2026-07-27T00:00:01Z",
            value={"state": "changed"},
        )
        await expect_code(
            provider.save_checkpoint(
                {"context": mutation("changed"), "checkpoint": changed, "lease": None}
            ),
            "GE_CYCLE_STORE_CONFLICT",
        )
        provider.unsafe_corrupt_checkpoint_for_test(
            "tenant-a", "scope-a", "cp-a", {**checkpoints[0], "value": {"corrupt": True}}
        )
        await expect_code(
            provider.load_checkpoint(
                {"context": AUTH, "checkpointScope": "scope-a", "checkpointId": "cp-a"}
            ),
            "GE_CYCLE_STORE_CORRUPTION",
        )
        assert await provider.delete_checkpoint(
            {
                "context": mutation("delete-b"),
                "checkpointScope": "scope-a",
                "checkpointId": "cp-b",
                "expectedValueHash": checkpoints[1]["valueHash"],
            }
        ) == {"deleted": True}
        assert (await provider.read_tail({"context": AUTH, "streamId": "stream-a"}))[
            "sequence"
        ] == 1

    asyncio.run(scenario())


def test_lease_fencing_expiry_takeover_and_stale_writes() -> None:
    async def scenario() -> None:
        provider = MemoryCycleStoreProvider()
        initial = await create_stream(provider)
        first = await provider.acquire_lease(
            {
                "context": mutation("lease-1"),
                "streamId": "stream-a",
                "leaseId": "lease-1",
                "holderId": "holder-a",
                "ttlMs": 100,
                "mode": "acquire",
                "expectedFencingToken": 0,
            }
        )
        await expect_code(
            provider.acquire_lease(
                {
                    "context": mutation("early"),
                    "streamId": "stream-a",
                    "leaseId": "lease-2",
                    "holderId": "holder-b",
                    "ttlMs": 100,
                    "mode": "takeover",
                    "expectedFencingToken": 1,
                }
            ),
            "GE_CYCLE_STORE_LEASE_CONFLICT",
        )
        next_record = create_cycle_store_record(
            record_id="next",
            sequence=1,
            previous_record_hash=str(initial[0]["recordHash"]),
            value={"next": True},
        )
        await expect_code(
            provider.append(
                {
                    "context": mutation("unfenced"),
                    "streamId": "stream-a",
                    "expectedTail": {
                        "exists": True,
                        "sequence": 0,
                        "recordHash": initial[0]["recordHash"],
                    },
                    "lease": None,
                    "records": [next_record],
                }
            ),
            "GE_CYCLE_STORE_STALE_FENCE",
        )
        provider.unsafe_advance_clock_for_test(100)
        await expect_code(
            provider.release_lease(
                {
                    "context": mutation("expired-release"),
                    "streamId": "stream-a",
                    "lease": binding(first),
                }
            ),
            "GE_CYCLE_STORE_STALE_FENCE",
        )
        takeover = await provider.acquire_lease(
            {
                "context": mutation("takeover"),
                "streamId": "stream-a",
                "leaseId": "lease-2",
                "holderId": "holder-b",
                "ttlMs": 100,
                "mode": "takeover",
                "expectedFencingToken": 1,
            }
        )
        assert [takeover["leaseEpoch"], takeover["fencingToken"]] == [2, 2]
        await provider.append(
            {
                "context": mutation("fenced"),
                "streamId": "stream-a",
                "expectedTail": {
                    "exists": True,
                    "sequence": 0,
                    "recordHash": initial[0]["recordHash"],
                },
                "lease": binding(takeover),
                "records": [next_record],
            }
        )

    asyncio.run(scenario())


def test_tenant_authorization_safe_errors_and_migration_exclusion() -> None:
    async def scenario() -> None:
        calls = 0

        def authorize(context: dict[str, Any], _operation: str) -> bool:
            nonlocal calls
            calls += 1
            return context["authorizationHash"] != "f" * 64

        provider = MemoryCycleStoreProvider(authorize=authorize)
        initial = await create_stream(provider, "same", AUTH)
        await create_stream(provider, "same", AUTH_B)
        denied = {**AUTH, "authorizationHash": "f" * 64}
        before = provider.unsafe_state_counters_for_test()
        error = await expect_code(
            provider.read_tail({"context": denied, "streamId": "same"}),
            "GE_CYCLE_STORE_PERMISSION_DENIED",
        )
        assert error.details == {}
        assert provider.unsafe_state_counters_for_test() == before
        assert calls > 2

        request = {
            "context": mutation("migration-1"),
            "lockId": "migration-1",
            "ownerId": "owner-a",
            "sourceSchemaVersion": 1,
            "targetSchemaVersion": 2,
            "ttlMs": 100,
            "mode": "acquire",
            "expectedFencingToken": 0,
        }
        first = await provider.acquire_migration_lock(request)
        assert await provider.acquire_migration_lock(request) == first
        blocked = create_cycle_store_record(
            record_id="blocked",
            sequence=1,
            previous_record_hash=str(initial[0]["recordHash"]),
            value={"secret": "PAYLOAD_SENTINEL"},
        )
        blocked_before = provider.unsafe_state_counters_for_test()
        await expect_code(
            provider.append(
                {
                    "context": mutation("blocked"),
                    "streamId": "same",
                    "expectedTail": {
                        "exists": True,
                        "sequence": 0,
                        "recordHash": initial[0]["recordHash"],
                    },
                    "lease": None,
                    "records": [blocked],
                }
            ),
            "GE_CYCLE_STORE_MIGRATION_LOCKED",
        )
        assert provider.unsafe_state_counters_for_test() == blocked_before

        provider.unsafe_inject_failure_for_test(
            "read-tail", "GE_CYCLE_STORE_UNAVAILABLE"
        )
        unavailable = await expect_code(
            provider.read_tail({"context": AUTH, "streamId": "secret-stream"}),
            "GE_CYCLE_STORE_UNAVAILABLE",
        )
        serialized = canonical_json(unavailable.to_dict())
        assert "stack" not in serialized
        assert "cause" not in serialized
        assert "secret-stream" not in serialized
        assert "PAYLOAD_SENTINEL" not in canonical_json(provider.unsafe_state_snapshot_for_test())

    asyncio.run(scenario())
