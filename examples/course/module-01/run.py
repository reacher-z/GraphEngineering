#!/usr/bin/env python3
"""Course module 1 -- nodes and real data edges.  Python lane, correct
implementation.

Three things happen here, in order:

1. Both committed graph documents (JSON and YAML) are decoded and must
   canonicalize to the same hash, which must equal the hash in
   ``fixtures/expected-run.json``.  A drifted document fails here.
2. The two-node graph runs on the native Python DAG scheduler with plain
   deterministic handlers -- no adapter, no network, no credential.  The
   producer's typed order object crosses the one declared edge and lands in
   the consumer keyed by the edge's port name (``order``).
3. The run result is asserted against the committed fixture: status, observed
   concurrency, attempt count, and the full invoice.  It is the same fixture
   the TypeScript lane asserts against.

Run: uv run --project python python examples/course/module-01/run.py
"""

from __future__ import annotations

import asyncio
import json

from handlers import (  # noqa: E402  (sibling module, loaded from this directory)
    HERE,
    ORDER,
    build_handlers,
    read_json,
)

from graph_engineering import canonical_sha256, compile_graph, parse_graph_source, run_graph


async def main() -> None:
    # ------------------------------------------------------------------
    # 1. JSON and YAML are the same graph, and it is the fixture's graph
    # ------------------------------------------------------------------
    graph_document = read_json("typed-edge.graph.json")
    yaml_text = (HERE / "typed-edge.graph.yaml").read_text(encoding="utf-8")
    expected = read_json("fixtures/expected-run.json")

    assert parse_graph_source(yaml_text, format="yaml") == graph_document, (
        "the committed YAML graph must decode to the committed JSON graph"
    )
    graph_hash = canonical_sha256(graph_document)
    assert graph_hash == expected["graphHash"], "graph document drifted from the fixture hash"

    graph = compile_graph(graph_document)

    # ------------------------------------------------------------------
    # 2. Run the pair: price the order, cross the typed edge, invoice it
    # ------------------------------------------------------------------
    handlers = build_handlers(graph_document)

    result = await run_graph(graph, dict(ORDER), handlers, max_concurrency=1)

    # ------------------------------------------------------------------
    # 3. The result is exactly the committed fixture
    # ------------------------------------------------------------------
    assert result.status.value == expected["status"]
    assert result.max_observed_concurrency == expected["maxObservedConcurrency"]
    assert result.total_attempts == expected["totalAttempts"], "each node runs exactly once"
    assert result.outputs == expected["output"], "run output drifted from fixtures/expected-run.json"

    # The consumer read ``quantity`` as a typed integer field, not out of prose:
    assert result.outputs["invoice"]["totalCents"] == ORDER["quantity"] * ORDER["unitPriceCents"]

    print(
        json.dumps(
            {
                "schemaVersion": "graph-engineering.course-module-run/v1alpha1",
                "module": 1,
                "lane": "python",
                "graphHash": graph_hash,
                "status": result.status.value,
                "maxObservedConcurrency": result.max_observed_concurrency,
                "totalAttempts": result.total_attempts,
                "invoice": result.outputs["invoice"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
