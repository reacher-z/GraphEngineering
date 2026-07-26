#!/usr/bin/env python3
"""Run the shared crash/resume case through the native Python runtime."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from graph_engineering import (
    NodeContext,
    compile_graph,
    resume_graph_run,
    start_graph_run,
)
from graph_engineering.persistence import MemoryEventStore

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "spec" / "conformance" / "durable-resume.case.json"
FIXED_TIME = "2026-07-26T12:00:00.000Z"


class ProcessLost(BaseException):
    """Escape normal attempt handling to model abrupt process loss."""


async def execute() -> dict[str, Any]:
    case = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    graph = compile_graph(case["graph"])
    store = MemoryEventStore()

    async def left(_: NodeContext) -> Any:
        return case["preCrash"]["succeeded"]["output"]

    async def right_crashes(_: NodeContext) -> Any:
        await asyncio.sleep(0.02)
        raise ProcessLost

    try:
        await start_graph_run(
            graph,
            case["graphInput"],
            {"left": left, "right": right_crashes, "merge": lambda _: None},
            run_id=case["runId"],
            implementation_id=case["implementationId"],
            event_store=store,
            clock=lambda: FIXED_TIME,
        )
    except ProcessLost:
        pass
    else:
        raise AssertionError("the pre-crash execution unexpectedly completed")

    before_resume = await store.read(case["runId"])
    executor_calls: list[dict[str, Any]] = []
    merge_input: Any = None
    resumed_activity_keys: list[str | None] = []

    def left_must_not_run(_: NodeContext) -> Any:
        raise AssertionError("resume reran the committed left node")

    def right(context: NodeContext) -> Any:
        executor_calls.append({"nodeId": context.node.id, "attempt": context.attempt})
        resumed_activity_keys.append(context.activity_key)
        return case["resumeReturns"]["right"]

    def merge(context: NodeContext) -> Any:
        nonlocal merge_input
        executor_calls.append({"nodeId": context.node.id, "attempt": context.attempt})
        merge_input = context.input
        return case["resumeReturns"]["merge"]

    result = await resume_graph_run(
        graph,
        {"left": left_must_not_run, "right": right, "merge": merge},
        run_id=case["runId"],
        implementation_id=case["implementationId"],
        event_store=store,
        clock=lambda: FIXED_TIME,
    )
    after_resume = await store.read(case["runId"])
    resumed = next(event for event in after_resume if event.type == "RunResumed")
    right_schedules = [
        event
        for event in after_resume
        if event.type == "NodeScheduled" and event.node_id == "right"
    ]

    terminal_calls = 0

    def terminal_must_not_run(_: NodeContext) -> Any:
        nonlocal terminal_calls
        terminal_calls += 1
        raise AssertionError("terminal resume invoked an executor")

    terminal_version = len(after_resume)
    terminal = await resume_graph_run(
        graph,
        {
            "left": terminal_must_not_run,
            "right": terminal_must_not_run,
            "merge": terminal_must_not_run,
        },
        run_id=case["runId"],
        implementation_id=case["implementationId"],
        event_store=store,
        clock=lambda: FIXED_TIME,
    )
    final_history = await store.read(case["runId"])

    return {
        "status": result.status.value,
        "output": dict(result.outputs or {}),
        "nodeStatuses": {
            node_id: node.status.value for node_id, node in result.nodes.items()
        },
        "attempts": {
            node_id: node.attempts for node_id, node in result.nodes.items()
        },
        "totalAttempts": result.total_attempts,
        "executorCalls": executor_calls,
        "mergeInput": merge_input,
        "reusedNodeIds": resumed.data["reusedNodeIds"],
        "interruptedNodeIds": resumed.data["interruptedNodeIds"],
        "preCrashEventTypes": [event.type for event in before_resume],
        "preCrashEvents": [
            event.model_dump(mode="json", by_alias=True, exclude_none=True)
            for event in before_resume
        ],
        "resumeEventTypes": [
            event.type for event in after_resume[len(before_resume) :]
        ],
        "activityKeyStable": (
            len(right_schedules) == 2
            and right_schedules[0].data["activityKey"]
            == right_schedules[1].data["activityKey"]
            and resumed_activity_keys
            == [right_schedules[0].data["activityKey"]]
        ),
        "terminalResume": {
            "newEvents": len(final_history) - terminal_version,
            "executorCalls": terminal_calls,
            "sameResult": terminal == result,
        },
    }


if __name__ == "__main__":
    print(
        json.dumps(
            asyncio.run(execute()),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
    )
