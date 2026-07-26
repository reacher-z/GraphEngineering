#!/usr/bin/env python3
"""Execute the Quickstart diamond through the native Python scheduler."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from graph_engineering import NodeContext, compile_graph, run_graph


GRAPH_PATH = Path(__file__).with_name("research-diamond.graph.json")


async def scope(context: NodeContext):
    return context.input


async def research_docs(context: NodeContext):
    await asyncio.sleep(0.02)
    return {
        "source": "docs",
        "finding": f"Document the contract for {context.input['scope']['topic']}",
    }


async def research_code(context: NodeContext):
    await asyncio.sleep(0.01)
    return {
        "source": "code",
        "finding": f"Test the runtime for {context.input['scope']['topic']}",
    }


async def synthesize(context: NodeContext):
    return context.input


async def main() -> None:
    graph = compile_graph(json.loads(GRAPH_PATH.read_text(encoding="utf-8")))
    result = await run_graph(
        graph,
        {"topic": "durable agent graphs"},
        {
            "scope": scope,
            "research-docs": research_docs,
            "research-code": research_code,
            "synthesize": synthesize,
        },
    )
    assert result.status.value == "succeeded"
    assert result.max_observed_concurrency == 2
    print(
        json.dumps(
            {
                "status": result.status.value,
                "maxObservedConcurrency": result.max_observed_concurrency,
                "report": result.outputs["report"],
            },
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
