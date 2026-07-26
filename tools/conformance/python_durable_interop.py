"""Produce and consume terminal durable histories across the Python/TS boundary."""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from graph_engineering import (
    GraphEvent,
    NodeContext,
    RunResult,
    compile_graph,
    decode_durable_json,
    resume_graph_run,
    start_graph_run,
)
from graph_engineering.persistence import MemoryEventStore


def _normalize_result(result: RunResult) -> dict[str, Any]:
    return {
        "status": result.status.value,
        "nodeStatuses": {
            node_id: node.status.value for node_id, node in result.nodes.items()
        },
        "failureCodes": [failure.code.value for failure in result.failures],
        "attempts": {
            node_id: node.attempts for node_id, node in result.nodes.items()
        },
        "outputs": dict(result.outputs or {}),
        "totalAttempts": result.total_attempts,
    }


def _serialize_events(events: tuple[GraphEvent, ...]) -> list[dict[str, Any]]:
    return [
        event.model_dump(mode="json", by_alias=True, exclude_none=True)
        for event in events
    ]


def _settled_semantics(events: tuple[GraphEvent, ...]) -> dict[str, Any] | None:
    settled = next(
        (event for event in events if event.type == "NodeSettledWithoutAttempt"),
        None,
    )
    if settled is None:
        return None
    result = decode_durable_json(settled.data["result"])
    if not isinstance(result, dict):
        raise TypeError("NodeSettledWithoutAttempt.result must decode to an object")
    failure = result.get("failure")
    if not isinstance(failure, dict):
        raise TypeError("NodeSettledWithoutAttempt.result.failure must be an object")
    return {
        "nodeId": result.get("nodeId"),
        "status": result.get("status"),
        "attempts": result.get("attempts"),
        "hasInput": "input" in result,
        "input": result.get("input"),
        "failureCode": failure.get("code"),
    }


async def _produce(case: dict[str, Any]) -> dict[str, Any]:
    graph = compile_graph(case["graph"])
    store = MemoryEventStore()
    handlers = {}
    if case["mode"] == "outputBinding":
        handlers = {"root": lambda _: {"actual": True}}
    elif case["mode"] != "missingExecutor":
        raise AssertionError(f"unknown durable interop mode: {case['mode']!r}")

    result = await start_graph_run(
        graph,
        case["graphInput"],
        handlers,
        run_id=case["pythonRunId"],
        implementation_id=case["implementationId"],
        event_store=store,
        clock=lambda: case["fixedTime"],
    )
    events = await store.read(case["pythonRunId"])
    return {
        "result": _normalize_result(result),
        "eventTypes": [event.type for event in events],
        "settled": _settled_semantics(events),
        "events": _serialize_events(events),
    }


async def _consume_typescript(case: dict[str, Any]) -> dict[str, Any]:
    graph = compile_graph(case["graph"])
    events = tuple(GraphEvent.model_validate(event) for event in case["tsEvents"])
    store = MemoryEventStore()
    await store.append(case["tsRunId"], -1, events)
    before = len(events)
    executor_calls = 0

    def must_not_run(_: NodeContext) -> Any:
        nonlocal executor_calls
        executor_calls += 1
        raise AssertionError("terminal cross-language resume invoked an executor")

    result = await resume_graph_run(
        graph,
        {"root": must_not_run},
        run_id=case["tsRunId"],
        implementation_id=case["implementationId"],
        event_store=store,
        clock=lambda: case["fixedTime"],
    )
    after = await store.read(case["tsRunId"])
    return {
        "result": _normalize_result(result),
        "eventTypes": [event.type for event in after],
        "settled": _settled_semantics(after),
        "terminalResume": {
            "newEvents": len(after) - before,
            "executorCalls": executor_calls,
        },
    }


async def _main() -> None:
    request = json.load(sys.stdin)
    cases = request.get("cases")
    if not isinstance(cases, list) or not cases:
        raise AssertionError("durable interop request must contain a non-empty cases array")

    report: dict[str, Any] = {}
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get("name"), str):
            raise TypeError("every durable interop case must be a named object")
        report[case["name"]] = {
            "pythonProduced": await _produce(case),
            "pythonConsumedTs": await _consume_typescript(case),
        }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(_main())
