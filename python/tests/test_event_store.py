from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from graph_engineering import GraphEvent
from graph_engineering.persistence import (
    CorruptEventLogError,
    EventStore,
    JsonlEventStore,
    MemoryEventStore,
    PersistenceValidationError,
    UnsafeIdentifierError,
    VersionConflictError,
)


def event(run_id: str, sequence: int, event_id: str | None = None) -> GraphEvent:
    return GraphEvent.model_validate(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1",
            "eventId": event_id or f"event-{sequence}",
            "type": "RunStarted" if sequence else "RunCreated",
            "timestamp": "2026-07-26T00:00:00Z",
            "runId": run_id,
            "graphRevision": 1,
            "sequence": sequence,
            "redacted": True,
            "data": {"sequence": sequence},
        }
    )


def stores(tmp_path: Path) -> tuple[EventStore, ...]:
    return (MemoryEventStore(), JsonlEventStore(tmp_path / "jsonl"))


@pytest.mark.parametrize("store_index", [0, 1])
def test_event_store_append_read_and_inclusive_offset(tmp_path: Path, store_index: int) -> None:
    store = stores(tmp_path)[store_index]

    async def scenario() -> None:
        assert await store.append("run-1", -1, (event("run-1", 0),)) == 0
        assert await store.append("run-1", 0, (event("run-1", 1), event("run-1", 2))) == 2
        assert [item.sequence for item in await store.read("run-1")] == [0, 1, 2]
        assert [item.sequence for item in await store.read("run-1", 1)] == [1, 2]

    asyncio.run(scenario())


@pytest.mark.parametrize("store_index", [0, 1])
def test_empty_append_is_cas_checked_no_op(tmp_path: Path, store_index: int) -> None:
    store = stores(tmp_path)[store_index]

    async def scenario() -> None:
        assert await store.append("run-empty", -1, ()) == -1
        with pytest.raises(VersionConflictError):
            await store.append("run-empty", 0, ())

    asyncio.run(scenario())
    if isinstance(store, JsonlEventStore):
        assert not store.path_for_run("run-empty").exists()


def test_jsonl_store_serializes_concurrent_compare_and_swap(tmp_path: Path) -> None:
    first_store = JsonlEventStore(tmp_path)
    second_store = JsonlEventStore(tmp_path)

    async def scenario() -> list[Any]:
        return await asyncio.gather(
            first_store.append("race", -1, (event("race", 0, "left"),)),
            second_store.append("race", -1, (event("race", 0, "right"),)),
            return_exceptions=True,
        )

    outcomes = asyncio.run(scenario())

    assert sum(outcome == 0 for outcome in outcomes) == 1
    assert sum(isinstance(outcome, VersionConflictError) for outcome in outcomes) == 1
    assert len(asyncio.run(first_store.read("race"))) == 1


def test_jsonl_store_reopens_and_reads_fsynced_records(tmp_path: Path) -> None:
    first = JsonlEventStore(tmp_path)
    asyncio.run(first.append("restart", -1, (event("restart", 0), event("restart", 1))))

    reopened = JsonlEventStore(tmp_path)
    restored = asyncio.run(reopened.read("restart"))

    assert [item.event_id for item in restored] == ["event-0", "event-1"]


def test_append_rejects_run_and_sequence_mismatch_without_writing(tmp_path: Path) -> None:
    store = JsonlEventStore(tmp_path)

    with pytest.raises(PersistenceValidationError):
        asyncio.run(store.append("expected", -1, (event("other", 0),)))
    assert not store.path_for_run("expected").exists()

    with pytest.raises(PersistenceValidationError):
        asyncio.run(store.append("expected", -1, (event("expected", 1),)))
    assert not store.path_for_run("expected").exists()


def test_jsonl_store_detects_truncation_and_sequence_corruption(tmp_path: Path) -> None:
    store = JsonlEventStore(tmp_path)
    asyncio.run(store.append("corrupt", -1, (event("corrupt", 0),)))
    path = store.path_for_run("corrupt")
    path.write_bytes(path.read_bytes()[:-1])

    with pytest.raises(CorruptEventLogError, match="truncated"):
        asyncio.run(store.read("corrupt"))

    other = JsonlEventStore(tmp_path / "sequence")
    wrong = event("gap", 1).model_dump_json(by_alias=True, exclude_none=True)
    other.path_for_run("gap").write_text(f"{wrong}\n")
    with pytest.raises(CorruptEventLogError, match="expected sequence 0"):
        asyncio.run(other.read("gap"))

    empty = JsonlEventStore(tmp_path / "empty")
    empty.path_for_run("zero-byte").touch()
    with pytest.raises(CorruptEventLogError, match="empty"):
        asyncio.run(empty.read("zero-byte"))


@pytest.mark.parametrize("unsafe", ["../escape", "a/b", "a\\b", ".", "..", "💥"])
def test_event_store_rejects_unsafe_run_ids(tmp_path: Path, unsafe: str) -> None:
    store = JsonlEventStore(tmp_path / "safe-root")

    with pytest.raises(UnsafeIdentifierError):
        asyncio.run(store.read(unsafe))
    assert tuple((tmp_path / "safe-root" / "events").iterdir()) == ()


def test_event_store_rejects_non_string_run_id_and_event_container(tmp_path: Path) -> None:
    store = JsonlEventStore(tmp_path)

    with pytest.raises(UnsafeIdentifierError):
        asyncio.run(store.read(42))  # type: ignore[arg-type]
    with pytest.raises(PersistenceValidationError):
        asyncio.run(store.append("run-null", -1, None))  # type: ignore[arg-type]


def test_stale_cas_wins_over_invalid_event_details(tmp_path: Path) -> None:
    store = JsonlEventStore(tmp_path)
    asyncio.run(store.append("priority", -1, (event("priority", 0),)))

    with pytest.raises(VersionConflictError):
        asyncio.run(
            store.append("priority", -1, (None,))  # type: ignore[arg-type]
        )


def test_memory_store_clones_mutable_event_data() -> None:
    store = MemoryEventStore()
    original = event("clone", 0)
    asyncio.run(store.append("clone", -1, (original,)))
    original.data["mutated"] = True

    restored = asyncio.run(store.read("clone"))[0]

    assert "mutated" not in restored.data


def test_jsonl_store_escapes_lone_surrogates_as_utf8_safe_json(tmp_path: Path) -> None:
    store = JsonlEventStore(tmp_path)
    lone_surrogate = json.loads(r'"\ud800"')
    original = GraphEvent.model_validate(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1",
            "eventId": "event-surrogate",
            "type": "RunCreated",
            "timestamp": "2026-07-26T00:00:00Z",
            "runId": "surrogate",
            "graphRevision": 1,
            "sequence": 0,
            "data": {"text": lone_surrogate},
        }
    )

    assert asyncio.run(store.append("surrogate", -1, (original,))) == 0

    raw = store.path_for_run("surrogate").read_bytes()
    assert b"\\ud800" in raw
    raw.decode("utf-8")
    restored = asyncio.run(store.read("surrogate"))[0]
    assert restored.data == {"text": lone_surrogate}


@pytest.mark.parametrize("value", [-2, 2**53, True])
def test_event_store_rejects_unsafe_version_numbers(tmp_path: Path, value: int) -> None:
    store = JsonlEventStore(tmp_path)

    with pytest.raises(PersistenceValidationError):
        asyncio.run(store.append("version", value, ()))
    with pytest.raises(PersistenceValidationError):
        asyncio.run(store.read("version", value))
