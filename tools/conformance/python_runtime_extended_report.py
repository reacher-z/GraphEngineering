#!/usr/bin/env python3
"""Run portable invalid-output and cancellation cases in the Python runtime."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from graph_engineering import NodeContext, RunResult, compile_graph, run_graph

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"


def load_case(name: str) -> dict[str, Any]:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def normalize(result: RunResult, executed: list[str]) -> dict[str, Any]:
    return {
        "status": result.status.value,
        "nodeStatuses": {
            node_id: node.status.value for node_id, node in result.nodes.items()
        },
        "failureCodes": [failure.code.value for failure in result.failures],
        "attempts": {node_id: node.attempts for node_id, node in result.nodes.items()},
        "outputs": dict(result.outputs or {}),
        "executed": sorted(executed),
    }


async def invalid_output_report() -> dict[str, Any]:
    case = load_case("runtime-invalid-output.case.json")
    executed: list[str] = []

    async def bad(_context: NodeContext) -> Any:
        executed.append("bad")
        return {"not", "json"}

    async def good(_context: NodeContext) -> Any:
        executed.append("good")
        return case["mock"]["returns"]["good"]

    async def bad_child(_context: NodeContext) -> Any:
        executed.append("bad-child")
        return case["mock"]["returns"]["bad-child"]

    result = await run_graph(
        compile_graph(case["graph"]),
        case["mock"]["graphInput"],
        {"bad": bad, "good": good, "bad-child": bad_child},
    )
    return normalize(result, executed)


async def cancellation_report() -> dict[str, Any]:
    case = load_case("runtime-cancellation.case.json")
    executed: list[str] = []
    slow_started = asyncio.Event()
    cancel_event = asyncio.Event()

    async def fast(_context: NodeContext) -> Any:
        executed.append("fast")
        return case["mock"]["returns"]["fast"]

    async def slow(_context: NodeContext) -> Any:
        executed.append("slow")
        slow_started.set()
        await asyncio.Future()

    async def after_slow(_context: NodeContext) -> Any:
        executed.append("after-slow")
        return case["mock"]["returns"]["after-slow"]

    task = asyncio.create_task(
        run_graph(
            compile_graph(case["graph"]),
            case["mock"]["graphInput"],
            {"fast": fast, "slow": slow, "after-slow": after_slow},
            cancel_event=cancel_event,
        )
    )
    await asyncio.wait_for(slow_started.wait(), timeout=1)
    cancel_event.set()
    return normalize(await asyncio.wait_for(task, timeout=1), executed)


async def execute() -> dict[str, Any]:
    return {
        "invalidOutput": await invalid_output_report(),
        "cancellation": await cancellation_report(),
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
