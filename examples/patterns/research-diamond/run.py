#!/usr/bin/env python3
"""Pattern 01 — multi-source research diamond.  Python lane, mock end to end.

Four things happen here, in order:

1. The bundle graph is reconstructed from the native ``research_diamond``
   constructor and checked against both committed canonical documents (JSON and
   YAML).  A drifted bundle fails here, not at run time.
2. The graph runs on the native Python DAG scheduler.  Each source node
   dispatches through the deterministic mock adapter, scripted entirely from
   ``fixtures/sources.json``.  The three sources must actually overlap — an
   ``asyncio.Barrier`` proves it without a sleep or a timestamp.
3. The same graph runs durably with payload protection configured.  The
   committed event sequence is compared against ``fixtures/expected-events.json``
   — the same file the TypeScript lane compares against.
4. A parallelism-versus-barrier trace is rendered from the committed event
   order.

No network access, no credential, no API key.  This is a native runtime, not a
client for the TypeScript one: it reads the same Graph IR, the same adapter
descriptor and the same fixtures.

Run: uv run --project python python examples/patterns/research-diamond/run.py
"""

from __future__ import annotations

import asyncio
import json

from bundle import (  # noqa: E402  (sibling module, loaded from this directory)
    HERE,
    RUN_ID,
    Handlers,
    committed_events,
    memory_protection,
    read_json,
    render_trace,
    source_options,
)
from graph_engineering import (
    canonical_sha256,
    compile_graph,
    parse_graph_source,
    run_graph,
    start_graph_run,
)
from graph_engineering.patterns import research_diamond
from graph_engineering.persistence import GuardedMemoryEventStore


async def main() -> None:
    # ------------------------------------------------------------------
    # 1. The committed bundle documents are what the constructor produces
    # ------------------------------------------------------------------
    graph_document = read_json("research-diamond.graph.json")
    yaml_text = (HERE / "research-diamond.graph.yaml").read_text(encoding="utf-8")
    corpus = read_json("fixtures/sources.json")
    descriptor_document = read_json("mock-adapter.descriptor.json")
    expected_run = read_json("fixtures/expected-run.json")
    expected_events = read_json("fixtures/expected-events.json")

    constructed = research_diamond(sources=source_options())
    assert constructed == graph_document, "the committed JSON graph must equal the constructor output"
    assert parse_graph_source(yaml_text, format="yaml") == graph_document, (
        "the committed YAML graph must decode to the committed JSON graph"
    )
    graph_hash = canonical_sha256(graph_document)
    assert graph_hash == expected_run["graphHash"]

    graph = compile_graph(graph_document)

    # ------------------------------------------------------------------
    # 2. The deterministic mock end-to-end run
    # ------------------------------------------------------------------
    gate = asyncio.Barrier(3)

    async def arrive() -> None:
        await gate.wait()

    parallel = Handlers(corpus, descriptor_document, arrive=arrive)
    result = await run_graph(
        graph, {"question": corpus["question"]}, parallel.map, max_concurrency=3
    )
    assert result.status.value == "succeeded", result.failures
    assert result.max_observed_concurrency == expected_run["maxObservedConcurrency"]
    assert result.total_attempts == expected_run["totalAttempts"]
    assert parallel.dispatches == 3, "one mock dispatch per source, and no more"
    assert result.outputs == expected_run["output"]

    # ------------------------------------------------------------------
    # 3. The same graph, durably, with payload protection configured
    # ------------------------------------------------------------------
    durable_handlers = Handlers(corpus, descriptor_document)
    store = GuardedMemoryEventStore()
    durable = await start_graph_run(
        graph,
        {"question": corpus["question"]},
        durable_handlers.map,
        run_id=RUN_ID,
        implementation_id="research-diamond-mock@1",
        event_store=store,
        payload_protection=memory_protection(),
        max_concurrency=3,
    )
    assert durable.status.value == "succeeded", durable.failures
    assert durable.outputs == expected_run["output"]
    assert durable_handlers.dispatches == 3

    committed = await committed_events(store, RUN_ID)
    assert committed == expected_events["nominal"], "durable event sequence drifted from fixture"

    # ------------------------------------------------------------------
    # 4. Parallelism versus barrier wait, from the committed event order
    # ------------------------------------------------------------------
    print(
        json.dumps(
            {
                "schemaVersion": "graph-engineering.pattern-bundle-run/v1alpha1",
                "lane": "python",
                "graphHash": graph_hash,
                "constructorParity": {"json": True, "yaml": True},
                "parallelRun": {
                    "status": result.status.value,
                    "maxObservedConcurrency": result.max_observed_concurrency,
                    "totalAttempts": result.total_attempts,
                    "mockDispatches": parallel.dispatches,
                },
                "durableRun": {
                    "status": durable.status.value,
                    "committedEvents": len(committed),
                    "matchesFixture": True,
                    "mockDispatches": durable_handlers.dispatches,
                },
                "report": result.outputs["report"],
                "trace": render_trace(committed),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
