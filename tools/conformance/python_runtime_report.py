#!/usr/bin/env python3
"""Run the shared ready-queue case through the native Python scheduler."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from graph_engineering import NodeContext, compile_graph, run_graph

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "spec" / "conformance" / "runtime-ready-queue.case.json"


async def execute() -> dict[str, Any]:
    case = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    completion: list[str] = []
    inputs: dict[str, Any] = {}
    handlers = {}

    for node_id, returned in case["mock"]["returns"].items():
        delay_ms = case["mock"]["delaysMs"][node_id]

        async def handler(
            context: NodeContext,
            *,
            _node_id: str = node_id,
            _delay_ms: int = delay_ms,
            _returned: Any = returned,
        ) -> Any:
            inputs[_node_id] = context.input
            await asyncio.sleep(_delay_ms / 1000)
            completion.append(_node_id)
            return _returned

        handlers[node_id] = handler

    graph = compile_graph(case["graph"])
    result = await run_graph(graph, case["mock"]["graphInput"], handlers)
    return {
        "status": result.status.value,
        "maxObservedConcurrency": result.max_observed_concurrency,
        "completionOrder": completion,
        "inputs": inputs,
        "outputs": dict(result.outputs or {}),
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
