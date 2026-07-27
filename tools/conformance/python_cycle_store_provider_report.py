"""Emit independent native-Python CycleStore provider conformance evidence."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from pathlib import Path
from typing import Any, cast

from graph_engineering import canonical_json
from graph_engineering.cycle_store_provider import (
    CYCLE_STORE_OPERATION_DOMAIN,
    CYCLE_STORE_PROVIDER_CONTRACT_VERSION,
    CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN,
    CYCLE_STORE_PROVIDER_ERROR_CODES,
    CYCLE_STORE_RECORD_DOMAIN,
    CycleStoreProviderError,
    MemoryCycleStoreProvider,
    create_cycle_store_checkpoint,
    create_cycle_store_record,
    create_reference_cycle_store_provider_descriptor,
    validate_cycle_store_provider_descriptor,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "spec" / "conformance" / "cycle-store-provider.case.json"
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
LEAK_SENTINELS = ("PAYLOAD_SENTINEL", "AUTHORIZATION_SENTINEL", "DATABASE_SENTINEL")


def _mutation(operation_id: str, auth: dict[str, Any] = AUTH) -> dict[str, Any]:
    return {**auth, "operationId": operation_id}


def _records(count: int, prefix: str = "record") -> list[dict[str, Any]]:
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


async def _create_stream(
    provider: MemoryCycleStoreProvider,
    stream_id: str = "stream-a",
    auth: dict[str, Any] = AUTH,
    count: int = 1,
) -> list[dict[str, Any]]:
    batch = _records(count, f"{auth['tenantId']}-{stream_id}")
    await provider.append(
        {
            "context": _mutation(f"create-{auth['tenantId']}-{stream_id}", auth),
            "streamId": stream_id,
            "expectedTail": MISSING,
            "lease": None,
            "records": batch,
        }
    )
    return batch


def _binding(lease: dict[str, Any]) -> dict[str, Any]:
    return {
        "leaseId": lease["leaseId"],
        "holderId": lease["holderId"],
        "fencingToken": lease["fencingToken"],
    }


def _tail(batch: list[dict[str, Any]]) -> dict[str, Any]:
    if not batch:
        return MISSING
    return {
        "exists": True,
        "sequence": batch[-1]["sequence"],
        "recordHash": batch[-1]["recordHash"],
    }


def _checkpoint(
    batch: list[dict[str, Any]],
    **overrides: Any,
) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "checkpoint_scope": "scope-a",
        "checkpoint_id": "checkpoint-a",
        "stream_id": "stream-a",
        "bound_sequence": batch[-1]["sequence"],
        "bound_record_hash": batch[-1]["recordHash"],
        "created_at": "2026-07-27T00:00:01Z",
        "value": {"state": "checkpoint-a"},
    }
    fields.update(overrides)
    return create_cycle_store_checkpoint(**fields)


def _lease_request(operation_id: str = "lease-1", **overrides: Any) -> dict[str, Any]:
    request: dict[str, Any] = {
        "context": _mutation(operation_id),
        "streamId": "stream-a",
        "leaseId": "lease-1",
        "holderId": "holder-a",
        "ttlMs": 100,
        "mode": "acquire",
        "expectedFencingToken": 0,
    }
    request.update(overrides)
    return request


def _migration_request(
    operation_id: str = "migration-1",
    **overrides: Any,
) -> dict[str, Any]:
    request: dict[str, Any] = {
        "context": _mutation(operation_id),
        "lockId": "migration-1",
        "ownerId": "owner-a",
        "sourceSchemaVersion": 1,
        "targetSchemaVersion": 2,
        "ttlMs": 100,
        "mode": "acquire",
        "expectedFencingToken": 0,
    }
    request.update(overrides)
    return request


def _domain_hash(domain: str, value: object) -> str:
    return hashlib.sha256((domain + canonical_json(value)).encode()).hexdigest()


def _category_counts(cases: list[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in cases:
        category = cast(str, item["category"])
        counts[category] = counts.get(category, 0) + 1
    return dict(sorted(counts.items()))


def _aggregate_states(case_results: list[dict[str, Any]]) -> dict[str, int]:
    keys = (
        "streams",
        "records",
        "recordIds",
        "checkpoints",
        "leaseStreams",
        "idempotencyEntries",
        "cursors",
        "legalHolds",
        "migrationFence",
    )
    return {
        key: sum(cast(int, cast(dict[str, Any], item["finalState"])[key]) for item in case_results)
        for key in keys
    }


async def _exercise(item: dict[str, Any]) -> dict[str, Any]:
    provider = MemoryCycleStoreProvider()
    attack_before = provider.unsafe_state_counters_for_test()
    observation: Any = {}
    scenario = cast(str, item["scenario"])
    try:
        if scenario == "descriptor-reference":
            descriptor = await provider.describe()
            validate_cycle_store_provider_descriptor(descriptor)
            capabilities = cast(dict[str, Any], descriptor["capabilities"])
            observation = {
                "descriptorHash": descriptor["descriptorHash"],
                "durability": capabilities["durability"],
                "distributedFencing": capabilities["distributedFencing"],
            }
        elif scenario == "descriptor-durable-profile":
            body = copy.deepcopy(await provider.describe())
            body.pop("descriptorHash")
            body["providerId"] = "postgresql-reference"
            cast(dict[str, Any], body["capabilities"]).update(
                {
                    "durability": "durable",
                    "distributedFencing": True,
                    "legalHold": "enforced",
                    "backupRestore": "enforced",
                }
            )
            cast(dict[str, Any], body["protection"]).update(
                {
                    "payloadProtection": "provider-managed",
                    "encryptionAtRest": "provider-managed",
                }
            )
            cast(dict[str, Any], body["governance"]).update(
                {"retention": "enforced", "archival": "enforced"}
            )
            descriptor = validate_cycle_store_provider_descriptor(
                {
                    **body,
                    "descriptorHash": _domain_hash(
                        CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body
                    ),
                }
            )
            capabilities = cast(dict[str, Any], descriptor["capabilities"])
            observation = {
                "providerId": descriptor["providerId"],
                "durability": capabilities["durability"],
                "distributedFencing": capabilities["distributedFencing"],
            }
        elif scenario == "descriptor-smaller-limits":
            body = copy.deepcopy(await provider.describe())
            body.pop("descriptorHash")
            body["providerId"] = "bounded-reference"
            cast(dict[str, Any], body["limits"])["maxPageSize"] = 128
            descriptor = validate_cycle_store_provider_descriptor(
                {
                    **body,
                    "descriptorHash": _domain_hash(
                        CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN, body
                    ),
                }
            )
            observation = {
                "providerId": descriptor["providerId"],
                "maxPageSize": cast(dict[str, Any], descriptor["limits"])["maxPageSize"],
            }
        elif scenario == "schema-inspection":
            observation = await provider.inspect_schema(AUTH)
        elif scenario == "descriptor-unknown-field":
            descriptor = copy.deepcopy(await provider.describe())
            descriptor["unknown"] = True
            attack_before = provider.unsafe_state_counters_for_test()
            validate_cycle_store_provider_descriptor(descriptor)
        elif scenario == "descriptor-limit-overflow":
            descriptor = copy.deepcopy(await provider.describe())
            cast(dict[str, Any], descriptor["limits"])["maxPageSize"] = 257
            attack_before = provider.unsafe_state_counters_for_test()
            validate_cycle_store_provider_descriptor(descriptor)
        elif scenario == "empty-tail":
            observation = await provider.read_tail({"context": AUTH, "streamId": "missing"})
        elif scenario in ("append-single", "append-atomic-batch"):
            count = 1 if scenario == "append-single" else 3
            observation = await provider.append(
                {
                    "context": _mutation("append"),
                    "streamId": "stream-a",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": _records(count),
                }
            )
        elif scenario == "append-exact-retry":
            request = {
                "context": _mutation("append-retry"),
                "streamId": "stream-a",
                "expectedTail": MISSING,
                "lease": None,
                "records": _records(1),
            }
            first = await provider.append(request)
            second = await provider.append(request)
            observation = {
                "first": first,
                "second": second,
                "recordCount": provider.unsafe_state_counters_for_test()["records"],
            }
        elif scenario == "append-commit-then-throw":
            armed = True

            def fault(boundary: str) -> None:
                nonlocal armed
                if armed and boundary == "provider:append:after-commit-before-return":
                    armed = False
                    raise RuntimeError("DATABASE_SENTINEL")

            provider = MemoryCycleStoreProvider(fault_hook=fault)
            request = {
                "context": _mutation("ambiguous"),
                "streamId": "stream-a",
                "expectedTail": MISSING,
                "lease": None,
                "records": _records(1),
            }
            first_code = None
            try:
                await provider.append(request)
            except CycleStoreProviderError as error:
                first_code = error.code
            recovered = await provider.append(request)
            observation = {
                "firstCode": first_code,
                "recovered": recovered,
                "recordCount": provider.unsafe_state_counters_for_test()["records"],
            }
        elif scenario.startswith("append-"):
            initial = await _create_stream(provider)
            next_record = create_cycle_store_record(
                record_id="next-record",
                sequence=1,
                previous_record_hash=str(initial[0]["recordHash"]),
                value={"next": True},
            )
            if scenario == "append-cas-loss":
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.append(
                    {
                        "context": _mutation("cas-loss"),
                        "streamId": "stream-a",
                        "expectedTail": MISSING,
                        "lease": None,
                        "records": [next_record],
                    }
                )
            elif scenario == "append-expected-hash-drift":
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.append(
                    {
                        "context": _mutation("hash-drift"),
                        "streamId": "stream-a",
                        "expectedTail": {
                            "exists": True,
                            "sequence": 0,
                            "recordHash": "f" * 64,
                        },
                        "lease": None,
                        "records": [next_record],
                    }
                )
            elif scenario == "append-broken-chain":
                broken = create_cycle_store_record(
                    record_id="broken",
                    sequence=1,
                    previous_record_hash="e" * 64,
                    value={"broken": True},
                )
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.append(
                    {
                        "context": _mutation("broken"),
                        "streamId": "stream-a",
                        "expectedTail": _tail(initial),
                        "lease": None,
                        "records": [broken],
                    }
                )
            elif scenario == "append-duplicate-record-id":
                duplicate = create_cycle_store_record(
                    record_id=str(initial[0]["recordId"]),
                    sequence=1,
                    previous_record_hash=str(initial[0]["recordHash"]),
                    value={"duplicate": True},
                )
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.append(
                    {
                        "context": _mutation("duplicate"),
                        "streamId": "stream-a",
                        "expectedTail": _tail(initial),
                        "lease": None,
                        "records": [duplicate],
                    }
                )
            elif scenario == "append-operation-request-drift":
                request = {
                    "context": _mutation("shared-append"),
                    "streamId": "other",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": _records(1, "original"),
                }
                await provider.append(request)
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.append({**request, "records": _records(1, "changed")})
            elif scenario == "append-operation-name-reuse":
                request = {
                    "context": _mutation("cross-operation"),
                    "streamId": "other",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": _records(1, "cross"),
                }
                await provider.append(request)
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.delete_checkpoint(
                    {
                        "context": _mutation("cross-operation"),
                        "checkpointScope": "scope-a",
                        "checkpointId": "missing",
                        "expectedValueHash": None,
                    }
                )
            elif scenario == "append-count-overflow":
                provider = MemoryCycleStoreProvider()
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.append(
                    {
                        "context": _mutation("overflow"),
                        "streamId": "stream-a",
                        "expectedTail": MISSING,
                        "lease": None,
                        "records": _records(65, "overflow"),
                    }
                )
            else:
                raise TypeError(f"unknown append scenario {scenario}")
        elif scenario == "event-exact-traversal":
            await _create_stream(provider, count=5)
            sequences: list[int] = []
            cursor = None
            snapshot_tail = None
            while True:
                page = await provider.read_event_page(
                    {
                        "context": AUTH,
                        "streamId": "stream-a",
                        "fromSequence": 0 if cursor is None else None,
                        "pageSize": 2,
                        "cursor": cursor,
                    }
                )
                sequences.extend(item["sequence"] for item in page["records"])
                snapshot_tail = page["snapshotTail"]
                cursor = page["nextCursor"]
                if cursor is None:
                    break
            observation = {
                "sequences": sequences,
                "snapshotTail": snapshot_tail,
                "nextCursor": cursor,
            }
        elif scenario == "event-append-during-scan":
            initial = await _create_stream(provider, count=3)
            first = await provider.read_event_page(
                {
                    "context": AUTH,
                    "streamId": "stream-a",
                    "fromSequence": 0,
                    "pageSize": 1,
                    "cursor": None,
                }
            )
            later = create_cycle_store_record(
                record_id="later",
                sequence=3,
                previous_record_hash=str(initial[2]["recordHash"]),
                value={"later": True},
            )
            await provider.append(
                {
                    "context": _mutation("later"),
                    "streamId": "stream-a",
                    "expectedTail": _tail(initial),
                    "lease": None,
                    "records": [later],
                }
            )
            remaining: list[int] = []
            cursor = first["nextCursor"]
            while cursor is not None:
                page = await provider.read_event_page(
                    {
                        "context": AUTH,
                        "streamId": "stream-a",
                        "fromSequence": None,
                        "pageSize": 1,
                        "cursor": cursor,
                    }
                )
                remaining.extend(item["sequence"] for item in page["records"])
                cursor = page["nextCursor"]
            observation = {
                "snapshotSequences": [first["records"][0]["sequence"], *remaining],
                "snapshotTail": first["snapshotTail"],
                "currentTail": await provider.read_tail(
                    {"context": AUTH, "streamId": "stream-a"}
                ),
            }
        elif scenario == "event-beyond-tail":
            await _create_stream(provider, count=2)
            observation = await provider.read_event_page(
                {
                    "context": AUTH,
                    "streamId": "stream-a",
                    "fromSequence": 9,
                    "pageSize": 2,
                    "cursor": None,
                }
            )
        elif scenario == "event-missing-stream":
            observation = await provider.read_event_page(
                {
                    "context": AUTH,
                    "streamId": "missing",
                    "fromSequence": 0,
                    "pageSize": 2,
                    "cursor": None,
                }
            )
        elif scenario.startswith("event-cursor-"):
            await _create_stream(provider, count=3)
            if scenario == "event-cursor-stream-scope":
                await _create_stream(provider, "stream-b", AUTH, 1)
            first = await provider.read_event_page(
                {
                    "context": AUTH,
                    "streamId": "stream-a",
                    "fromSequence": 0,
                    "pageSize": 1,
                    "cursor": None,
                }
            )
            attack_before = provider.unsafe_state_counters_for_test()
            if scenario == "event-cursor-tenant-scope":
                await provider.read_event_page(
                    {
                        "context": AUTH_B,
                        "streamId": "stream-a",
                        "fromSequence": None,
                        "pageSize": 1,
                        "cursor": first["nextCursor"],
                    }
                )
            elif scenario == "event-cursor-stream-scope":
                await provider.read_event_page(
                    {
                        "context": AUTH,
                        "streamId": "stream-b",
                        "fromSequence": None,
                        "pageSize": 1,
                        "cursor": first["nextCursor"],
                    }
                )
            elif scenario == "event-cursor-page-size":
                await provider.read_event_page(
                    {
                        "context": AUTH,
                        "streamId": "stream-a",
                        "fromSequence": None,
                        "pageSize": 2,
                        "cursor": first["nextCursor"],
                    }
                )
            elif scenario == "event-cursor-tamper":
                await provider.read_event_page(
                    {
                        "context": AUTH,
                        "streamId": "stream-a",
                        "fromSequence": None,
                        "pageSize": 1,
                        "cursor": "cursor-not-valid!",
                    }
                )
            else:
                raise TypeError(f"unknown cursor scenario {scenario}")
        elif scenario.startswith("checkpoint-"):
            batch = await _create_stream(provider, count=2)
            base = _checkpoint(batch)
            if scenario == "checkpoint-save-load":
                summary = await provider.save_checkpoint(
                    {"context": _mutation("save"), "checkpoint": base, "lease": None}
                )
                loaded = await provider.load_checkpoint(
                    {
                        "context": AUTH,
                        "checkpointScope": "scope-a",
                        "checkpointId": "checkpoint-a",
                    }
                )
                observation = {"summary": summary, "loaded": loaded}
            elif scenario == "checkpoint-list-order":
                second = _checkpoint(
                    batch,
                    checkpoint_id="checkpoint-b",
                    created_at="2026-07-27T00:00:02Z",
                    value={"state": "checkpoint-b"},
                )
                await provider.save_checkpoint(
                    {"context": _mutation("save-a"), "checkpoint": base, "lease": None}
                )
                await provider.save_checkpoint(
                    {"context": _mutation("save-b"), "checkpoint": second, "lease": None}
                )
                page = await provider.list_checkpoints(
                    {
                        "context": AUTH,
                        "checkpointScope": "scope-a",
                        "pageSize": 2,
                        "cursor": None,
                    }
                )
                observation = {
                    "checkpointIds": [item["checkpointId"] for item in page["checkpoints"]]
                }
            elif scenario == "checkpoint-delete":
                await provider.save_checkpoint(
                    {"context": _mutation("save"), "checkpoint": base, "lease": None}
                )
                deleted = await provider.delete_checkpoint(
                    {
                        "context": _mutation("delete"),
                        "checkpointScope": "scope-a",
                        "checkpointId": "checkpoint-a",
                        "expectedValueHash": base["valueHash"],
                    }
                )
                observation = {
                    "deleted": deleted,
                    "tail": await provider.read_tail(
                        {"context": AUTH, "streamId": "stream-a"}
                    ),
                    "loaded": await provider.load_checkpoint(
                        {
                            "context": AUTH,
                            "checkpointScope": "scope-a",
                            "checkpointId": "checkpoint-a",
                        }
                    ),
                }
            elif scenario == "checkpoint-exact-retry":
                request = {"context": _mutation("save"), "checkpoint": base, "lease": None}
                first = await provider.save_checkpoint(request)
                second = await provider.save_checkpoint(request)
                observation = {"first": first, "second": second}
            elif scenario == "checkpoint-stale-tail":
                stale = _checkpoint([batch[0]], checkpoint_id="stale")
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.save_checkpoint(
                    {"context": _mutation("stale"), "checkpoint": stale, "lease": None}
                )
            elif scenario == "checkpoint-content-hash-drift":
                drifted = copy.deepcopy(base)
                drifted["value"] = {"state": "PAYLOAD_SENTINEL"}
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.save_checkpoint(
                    {"context": _mutation("drift"), "checkpoint": drifted, "lease": None}
                )
            elif scenario == "checkpoint-immutable-id":
                await provider.save_checkpoint(
                    {"context": _mutation("save"), "checkpoint": base, "lease": None}
                )
                changed = _checkpoint(batch, value={"state": "changed"})
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.save_checkpoint(
                    {"context": _mutation("changed"), "checkpoint": changed, "lease": None}
                )
            elif scenario == "checkpoint-corrupt-load":
                await provider.save_checkpoint(
                    {"context": _mutation("save"), "checkpoint": base, "lease": None}
                )
                provider.unsafe_corrupt_checkpoint_for_test(
                    "tenant-a",
                    "scope-a",
                    "checkpoint-a",
                    {**base, "value": {"state": "PAYLOAD_SENTINEL"}},
                )
                attack_before = provider.unsafe_state_counters_for_test()
                await provider.load_checkpoint(
                    {
                        "context": AUTH,
                        "checkpointScope": "scope-a",
                        "checkpointId": "checkpoint-a",
                    }
                )
            else:
                raise TypeError(f"unknown checkpoint scenario {scenario}")
        elif scenario.startswith("lease-"):
            initial = await _create_stream(provider)
            first_request = _lease_request()
            if scenario == "lease-first-acquire":
                observation = await provider.acquire_lease(first_request)
            elif scenario == "lease-renew":
                first = await provider.acquire_lease(first_request)
                provider.unsafe_advance_clock_for_test(10)
                observation = await provider.renew_lease(
                    {
                        "context": _mutation("renew"),
                        "streamId": "stream-a",
                        "lease": _binding(first),
                        "ttlMs": 200,
                    }
                )
            elif scenario == "lease-release-reacquire":
                first = await provider.acquire_lease(first_request)
                released = await provider.release_lease(
                    {
                        "context": _mutation("release"),
                        "streamId": "stream-a",
                        "lease": _binding(first),
                    }
                )
                second = await provider.acquire_lease(
                    _lease_request(
                        "lease-2",
                        leaseId="lease-2",
                        holderId="holder-b",
                        expectedFencingToken=1,
                    )
                )
                observation = {"released": released, "second": second}
            elif scenario == "lease-expired-takeover":
                first = await provider.acquire_lease(first_request)
                provider.unsafe_advance_clock_for_test(100)
                second = await provider.acquire_lease(
                    _lease_request(
                        "takeover",
                        leaseId="lease-2",
                        holderId="holder-b",
                        mode="takeover",
                        expectedFencingToken=1,
                    )
                )
                observation = {"firstFence": first["fencingToken"], "second": second}
            elif scenario == "lease-exact-retry":
                first = await provider.acquire_lease(first_request)
                provider.unsafe_advance_clock_for_test(1_000)
                second = await provider.acquire_lease(first_request)
                observation = {"first": first, "second": second}
            else:
                first = await provider.acquire_lease(first_request)
                next_record = create_cycle_store_record(
                    record_id="next",
                    sequence=1,
                    previous_record_hash=str(initial[0]["recordHash"]),
                    value={"next": True},
                )
                if scenario == "lease-active-owner-conflict":
                    attack_before = provider.unsafe_state_counters_for_test()
                    await provider.acquire_lease(
                        _lease_request(
                            "second",
                            leaseId="lease-2",
                            holderId="holder-b",
                            expectedFencingToken=1,
                        )
                    )
                elif scenario == "lease-early-takeover":
                    attack_before = provider.unsafe_state_counters_for_test()
                    await provider.acquire_lease(
                        _lease_request(
                            "early",
                            leaseId="lease-2",
                            holderId="holder-b",
                            mode="takeover",
                            expectedFencingToken=1,
                        )
                    )
                elif scenario == "lease-stale-renew":
                    attack_before = provider.unsafe_state_counters_for_test()
                    await provider.renew_lease(
                        {
                            "context": _mutation("stale-renew"),
                            "streamId": "stream-a",
                            "lease": {**_binding(first), "holderId": "substituted"},
                            "ttlMs": 200,
                        }
                    )
                elif scenario == "lease-stale-release":
                    provider.unsafe_advance_clock_for_test(100)
                    attack_before = provider.unsafe_state_counters_for_test()
                    await provider.release_lease(
                        {
                            "context": _mutation("stale-release"),
                            "streamId": "stream-a",
                            "lease": _binding(first),
                        }
                    )
                elif scenario == "lease-stale-write":
                    attack_before = provider.unsafe_state_counters_for_test()
                    await provider.append(
                        {
                            "context": _mutation("stale-write"),
                            "streamId": "stream-a",
                            "expectedTail": _tail(initial),
                            "lease": None,
                            "records": [next_record],
                        }
                    )
                elif scenario == "lease-expired-write":
                    provider.unsafe_advance_clock_for_test(100)
                    attack_before = provider.unsafe_state_counters_for_test()
                    await provider.append(
                        {
                            "context": _mutation("expired-write"),
                            "streamId": "stream-a",
                            "expectedTail": _tail(initial),
                            "lease": _binding(first),
                            "records": [next_record],
                        }
                    )
                elif scenario == "lease-fence-overflow":
                    provider.unsafe_set_lease_counters_for_test(
                        "tenant-a", "stream-a", 2**53 - 1, 2**53 - 1
                    )
                    attack_before = provider.unsafe_state_counters_for_test()
                    await provider.acquire_lease(
                        _lease_request(
                            "overflow",
                            leaseId="overflow",
                            expectedFencingToken=2**53 - 1,
                        )
                    )
                else:
                    raise TypeError(f"unknown lease scenario {scenario}")
        elif scenario == "tenant-same-id-isolation":
            left = create_cycle_store_record(
                record_id="shared-record",
                sequence=0,
                previous_record_hash=None,
                value={"tenant": "a"},
            )
            right = create_cycle_store_record(
                record_id="shared-record",
                sequence=0,
                previous_record_hash=None,
                value={"tenant": "b"},
            )
            await provider.append(
                {
                    "context": _mutation("tenant-a", AUTH),
                    "streamId": "shared",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": [left],
                }
            )
            await provider.append(
                {
                    "context": _mutation("tenant-b", AUTH_B),
                    "streamId": "shared",
                    "expectedTail": MISSING,
                    "lease": None,
                    "records": [right],
                }
            )
            observation = {
                "tenantA": await provider.read_tail({"context": AUTH, "streamId": "shared"}),
                "tenantB": await provider.read_tail({"context": AUTH_B, "streamId": "shared"}),
            }
        elif scenario == "safe-error-envelope":
            provider.unsafe_inject_failure_for_test(
                "read-tail", "GE_CYCLE_STORE_UNAVAILABLE"
            )
            serialized = None
            try:
                await provider.read_tail(
                    {"context": AUTH, "streamId": "PAYLOAD_SENTINEL"}
                )
            except CycleStoreProviderError as error:
                serialized = error.to_dict()
            text = canonical_json(serialized)
            assert "stack" not in text and "cause" not in text
            assert "PAYLOAD_SENTINEL" not in text
            observation = serialized
        elif scenario == "authorization-denied-lookup":
            provider = MemoryCycleStoreProvider(authorize=lambda _context, _operation: False)
            attack_before = provider.unsafe_state_counters_for_test()
            await provider.read_tail(
                {
                    "context": {**AUTH, "authorizationHash": "f" * 64},
                    "streamId": "PAYLOAD_SENTINEL",
                }
            )
        elif scenario == "injected-error-classification":
            caught_codes: list[str] = []
            for code in ("GE_CYCLE_STORE_UNAVAILABLE", "GE_CYCLE_STORE_CORRUPTION"):
                provider.unsafe_inject_failure_for_test("read-tail", code)
                try:
                    await provider.read_tail({"context": AUTH, "streamId": "stream-a"})
                except CycleStoreProviderError as error:
                    caught_codes.append(error.code)
            observation = {"caughtCodes": caught_codes}
            provider.unsafe_inject_failure_for_test(
                "read-tail", "GE_CYCLE_STORE_QUOTA_EXCEEDED"
            )
            attack_before = provider.unsafe_state_counters_for_test()
            await provider.read_tail({"context": AUTH, "streamId": "stream-a"})
        elif scenario == "governance-hold-declarations":
            await _create_stream(provider)
            placed = await provider.set_legal_hold(
                {
                    "context": _mutation("hold"),
                    "streamId": "stream-a",
                    "holdId": "legal-1",
                    "action": "place",
                }
            )
            observation = {
                "placed": placed,
                "inspected": await provider.inspect_governance(
                    {"context": AUTH, "streamId": "stream-a"}
                ),
                "descriptorGovernance": (await provider.describe())["governance"],
            }
        elif scenario == "migration-retry-takeover":
            request = _migration_request()
            first = await provider.acquire_migration_lock(request)
            retry = await provider.acquire_migration_lock(request)
            provider.unsafe_advance_clock_for_test(100)
            takeover = await provider.acquire_migration_lock(
                _migration_request(
                    "migration-2",
                    lockId="migration-2",
                    ownerId="owner-b",
                    mode="takeover",
                    expectedFencingToken=1,
                )
            )
            observation = {"first": first, "retry": retry, "takeover": takeover}
        elif scenario == "migration-live-lock-conflict":
            await provider.acquire_migration_lock(_migration_request())
            attack_before = provider.unsafe_state_counters_for_test()
            await provider.acquire_migration_lock(
                _migration_request(
                    "migration-2",
                    lockId="migration-2",
                    ownerId="owner-b",
                    expectedFencingToken=1,
                )
            )
        elif scenario == "migration-blocks-online-writer":
            initial = await _create_stream(provider)
            await provider.acquire_migration_lock(_migration_request())
            next_record = create_cycle_store_record(
                record_id="blocked",
                sequence=1,
                previous_record_hash=str(initial[0]["recordHash"]),
                value={"secret": "PAYLOAD_SENTINEL"},
            )
            attack_before = provider.unsafe_state_counters_for_test()
            await provider.append(
                {
                    "context": _mutation("blocked"),
                    "streamId": "stream-a",
                    "expectedTail": _tail(initial),
                    "lease": None,
                    "records": [next_record],
                }
            )
        else:
            raise TypeError(f"unknown CycleStore provider scenario {scenario}")

        assert item["polarity"] != "attack", f"{item['id']}: attack unexpectedly succeeded"
        return {
            "id": item["id"],
            "category": item["category"],
            "polarity": item["polarity"],
            "outcome": item["expectOutcome"],
            "code": None,
            "operation": None,
            "retryable": None,
            "zeroMutation": None,
            "observation": observation,
            "finalState": provider.unsafe_state_counters_for_test(),
        }
    except CycleStoreProviderError as error:
        assert item["polarity"] == "attack", f"{item['id']}: behavior raised {error}"
        assert error.code == item["expectCode"], f"{item['id']}: exact code drifted"
        final_state = provider.unsafe_state_counters_for_test()
        assert final_state == attack_before, f"{item['id']}: rejection mutated state"
        serialized = canonical_json(error.to_dict())
        assert all(sentinel not in serialized for sentinel in LEAK_SENTINELS)
        return {
            "id": item["id"],
            "category": item["category"],
            "polarity": item["polarity"],
            "outcome": "rejected",
            "code": error.code,
            "operation": error.operation,
            "retryable": error.retryable,
            "zeroMutation": True,
            "observation": observation,
            "finalState": final_state,
        }


async def _report() -> dict[str, Any]:
    fixture = cast(dict[str, Any], json.loads(FIXTURE.read_text(encoding="utf-8")))
    cases = cast(list[dict[str, Any]], fixture["cases"])
    assert sorted(fixture) == [
        "cases",
        "contractVersion",
        "descriptorSchema",
        "errorCodes",
        "expect",
        "hashDomains",
        "id",
        "requiredAssertions",
        "schemaVersion",
    ]
    assert fixture["id"] == "cycle-store-provider-v1alpha1"
    assert fixture["contractVersion"] == CYCLE_STORE_PROVIDER_CONTRACT_VERSION
    assert fixture["errorCodes"] == list(CYCLE_STORE_PROVIDER_ERROR_CODES)
    assert fixture["hashDomains"] == {
        "descriptor": CYCLE_STORE_PROVIDER_DESCRIPTOR_DOMAIN,
        "record": CYCLE_STORE_RECORD_DOMAIN,
        "operation": CYCLE_STORE_OPERATION_DOMAIN,
    }
    assert len({item["id"] for item in cases}) == len(cases)
    assert len({item["assertion"] for item in cases}) == len(cases)
    for item in cases:
        assert sorted(item) == [
            "assertion",
            "category",
            "expectCode",
            "expectOutcome",
            "id",
            "mutation",
            "polarity",
            "scenario",
        ]
    case_results = [await _exercise(item) for item in cases]
    attack_count = sum(item["polarity"] == "attack" for item in cases)
    behavior_count = sum(item["polarity"] == "behavior" for item in cases)
    expected = cast(dict[str, Any], fixture["expect"])
    assert len(cases) == expected["caseCount"]
    assert attack_count == expected["attackCaseCount"]
    assert behavior_count == expected["behaviorCaseCount"]
    assert _category_counts(cases) == expected["categoryCounts"]
    case_list_canonical = canonical_json(cases)
    case_list_bytes = len(case_list_canonical.encode())
    case_list_hash = hashlib.sha256(case_list_canonical.encode()).hexdigest()
    assert case_list_bytes == expected["casesCanonicalUtf8Bytes"]
    assert case_list_hash == expected["casesSha256"]
    probe_record = create_cycle_store_record(
        record_id="conformance-probe",
        sequence=0,
        previous_record_hash=None,
        value={"probe": True},
    )
    probe_request = {
        "context": _mutation("conformance-probe"),
        "streamId": "conformance-probe",
        "expectedTail": MISSING,
        "lease": None,
        "records": [probe_record],
    }
    report = {
        "campaign": fixture["id"],
        "contractVersion": fixture["contractVersion"],
        "descriptorHash": create_reference_cycle_store_provider_descriptor()["descriptorHash"],
        "caseCount": len(cases),
        "attackCaseCount": attack_count,
        "behaviorCaseCount": behavior_count,
        "categoryCounts": _category_counts(cases),
        "caseListCanonicalUtf8Bytes": case_list_bytes,
        "caseListSha256": case_list_hash,
        "probeIdentities": {
            "recordHash": probe_record["recordHash"],
            "operationHash": _domain_hash(
                CYCLE_STORE_OPERATION_DOMAIN,
                {"operation": "append", "request": probe_request},
            ),
        },
        "caseResults": case_results,
        "aggregateFinalState": _aggregate_states(case_results),
        "leakSentinelScan": "clean",
    }
    report_text = canonical_json(report)
    assert all(sentinel not in report_text for sentinel in LEAK_SENTINELS)
    return report


if __name__ == "__main__":
    print(json.dumps(asyncio.run(_report()), ensure_ascii=False, separators=(",", ":")))
