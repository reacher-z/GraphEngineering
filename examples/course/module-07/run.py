#!/usr/bin/env python3
"""Course module 7 -- diamond topology.  Python lane, correct implementation.

Three things happen here, in order:

1. Both committed graph documents (JSON and YAML) are decoded and must
   canonicalize to the same hash, which must equal the hash in
   ``fixtures/expected-run.json``.  A drifted document fails here.
2. The diamond runs on the native Python DAG scheduler with plain
   deterministic handlers -- no adapter, no network, no credential.  A
   2-party latch proves the two branches actually overlap.
3. The run result is asserted against the committed fixture: status, observed
   concurrency, attempt count, and the full report.  It is the same fixture
   the TypeScript lane asserts against.

Run: uv run --project python python examples/course/module-07/run.py
"""

from __future__ import annotations

import asyncio
import json

from handlers import (  # noqa: E402  (sibling module, loaded from this directory)
    BRIEF,
    HERE,
    build_handlers,
    read_json,
    two_party_latch,
)

from graph_engineering import canonical_sha256, compile_graph, parse_graph_source, run_graph


async def main() -> None:
    # ------------------------------------------------------------------
    # 1. JSON and YAML are the same graph, and it is the fixture's graph
    # ------------------------------------------------------------------
    graph_document = read_json("diamond.graph.json")
    yaml_text = (HERE / "diamond.graph.yaml").read_text(encoding="utf-8")
    expected = read_json("fixtures/expected-run.json")

    assert parse_graph_source(yaml_text, format="yaml") == graph_document, (
        "the committed YAML graph must decode to the committed JSON graph"
    )
    graph_hash = canonical_sha256(graph_document)
    assert graph_hash == expected["graphHash"], "graph document drifted from the fixture hash"

    graph = compile_graph(graph_document)

    # ------------------------------------------------------------------
    # 2. Run the diamond: split, two overlapping branches, sorted merge
    # ------------------------------------------------------------------
    arrive, arrivals = two_party_latch()
    handlers = build_handlers(graph_document, arrive=arrive)

    result = await run_graph(graph, {"brief": BRIEF}, handlers, max_concurrency=2)

    # ------------------------------------------------------------------
    # 3. The result is exactly the committed fixture
    # ------------------------------------------------------------------
    assert result.status.value == expected["status"]
    assert arrivals() == 2, "both branches must have started before either finished"
    assert result.max_observed_concurrency == expected["maxObservedConcurrency"], (
        "the two branches must overlap"
    )
    assert result.total_attempts == expected["totalAttempts"]
    assert result.outputs == expected["output"], "run output drifted from fixtures/expected-run.json"

    print(
        json.dumps(
            {
                "schemaVersion": "graph-engineering.course-module-run/v1alpha1",
                "module": 7,
                "lane": "python",
                "graphHash": graph_hash,
                "status": result.status.value,
                "maxObservedConcurrency": result.max_observed_concurrency,
                "totalAttempts": result.total_attempts,
                "report": result.outputs["report"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
