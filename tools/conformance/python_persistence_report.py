#!/usr/bin/env python3
"""Run the shared persistence contract through native Python adapters."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any

from graph_engineering import GraphEvent
from graph_engineering.persistence import (
    CheckpointInput,
    FileCheckpointStore,
    JsonlEventStore,
    MemoryEventStore,
    PersistenceError,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"


def load_json(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def second_event(first: dict[str, Any]) -> GraphEvent:
    document = {
        **first,
        "eventId": "evt-0002",
        "type": "NodeSucceeded",
        "sequence": 1,
        "nodeId": "research",
        "data": {"outputHash": "sha256:verified"},
    }
    return GraphEvent.model_validate(document)


async def exercise_event_store(store: Any, first: GraphEvent, second: GraphEvent) -> dict[str, Any]:
    versions = [await store.append(first.run_id, -1, (first,))]
    versions.append(await store.append(first.run_id, 0, ()))
    versions.append(await store.append(first.run_id, 0, (second,)))
    from_one = await store.read(first.run_id, 1)
    conflict_code: str | None = None
    try:
        await store.append(first.run_id, 0, (second,))
    except PersistenceError as error:
        conflict_code = error.code.value
    return {
        "versions": versions,
        "fromSequenceOne": [
            {"eventId": event.event_id, "type": event.type, "sequence": event.sequence}
            for event in from_one
        ],
        "conflictCode": conflict_code,
    }


async def execute() -> dict[str, Any]:
    first_document = load_json("run-created.event.json")
    first = GraphEvent.model_validate(first_document)
    second = second_event(first_document)

    memory_report = await exercise_event_store(MemoryEventStore(), first, second)
    with tempfile.TemporaryDirectory(prefix="graph-engineering-py-persistence-") as directory:
        jsonl = JsonlEventStore(directory)
        jsonl_report = await exercise_event_store(jsonl, first, second)
        restarted = JsonlEventStore(directory)
        jsonl_report["restartEventIds"] = [
            event.event_id for event in await restarted.read(first.run_id)
        ]

        checkpoint_document = load_json("checkpoint-basic.json")
        checkpoint_input = CheckpointInput.model_validate(
            {
                key: value
                for key, value in checkpoint_document.items()
                if key not in {"apiVersion", "contentHash"}
            }
        )
        checkpoints = FileCheckpointStore(directory)
        saved = await checkpoints.save(checkpoint_input)
        loaded = await FileCheckpointStore(directory).load(
            checkpoint_input.run_id,
            checkpoint_input.checkpoint_id,
        )
        summaries = await checkpoints.list(checkpoint_input.run_id)
        checkpoint_report = {
            "contentHash": saved.content_hash,
            "matchesFixture": saved.model_dump(mode="json", by_alias=True) == checkpoint_document,
            "restartLoadMatches": loaded == saved,
            "summaries": [
                summary.model_dump(mode="json", by_alias=True) for summary in summaries
            ],
        }

    unsafe_code: str | None = None
    try:
        await MemoryEventStore().read("../escape")
    except PersistenceError as error:
        unsafe_code = error.code.value

    return {
        "eventStores": {"memory": memory_report, "jsonl": jsonl_report},
        "checkpoint": checkpoint_report,
        "unsafeIdentifierCode": unsafe_code,
    }


if __name__ == "__main__":
    print(json.dumps(asyncio.run(execute()), ensure_ascii=False, sort_keys=True, separators=(",", ":")))
