#!/usr/bin/env python3
"""Course module 2 -- linear chain as a degenerate graph.  Python lane,
correct implementation.

Three things happen here, in order:

1. Both committed graph documents (JSON and YAML) are decoded and must
   canonicalize to the same hash, which must equal the hash in
   ``fixtures/expected-run.json``.  A drifted document fails here.
2. The three-node chain runs on the native Python DAG scheduler.  The
   ``enrich`` node is deterministically flaky (first attempt raises, second
   succeeds), and the graph declares ``retry.maxAttempts: 2`` ON THAT NODE --
   so the scheduler retries exactly the failing node, in place.
3. The run result is asserted against the committed fixture, including the
   PER-NODE attempt counts: extract 1, enrich 2, format 1.  The nodes around
   the flaky one never re-run.  It is the same fixture the TypeScript lane
   asserts against.

Run: uv run --project python python examples/course/module-02/run.py
"""

from __future__ import annotations

import asyncio
import json

from handlers import (  # noqa: E402  (sibling module, loaded from this directory)
    BULLETIN,
    HERE,
    FailOnce,
    build_handlers,
    read_json,
)

from graph_engineering import canonical_sha256, compile_graph, parse_graph_source, run_graph


async def main() -> None:
    # ------------------------------------------------------------------
    # 1. JSON and YAML are the same graph, and it is the fixture's graph
    # ------------------------------------------------------------------
    graph_document = read_json("chain.graph.json")
    yaml_text = (HERE / "chain.graph.yaml").read_text(encoding="utf-8")
    expected = read_json("fixtures/expected-run.json")

    assert parse_graph_source(yaml_text, format="yaml") == graph_document, (
        "the committed YAML graph must decode to the committed JSON graph"
    )
    graph_hash = canonical_sha256(graph_document)
    assert graph_hash == expected["graphHash"], "graph document drifted from the fixture hash"

    graph = compile_graph(graph_document)

    # ------------------------------------------------------------------
    # 2. Run the chain: enrich flakes once and is retried in place
    # ------------------------------------------------------------------
    gate = FailOnce()
    handlers = build_handlers(graph_document, flaky={"enrich": gate})

    result = await run_graph(graph, {"bulletin": BULLETIN}, handlers, max_concurrency=1)

    # ------------------------------------------------------------------
    # 3. The result is exactly the fixture -- per-node attempts included
    # ------------------------------------------------------------------
    assert result.status.value == expected["status"]
    assert result.max_observed_concurrency == expected["maxObservedConcurrency"]
    assert result.total_attempts == expected["totalAttempts"]
    assert gate.calls() == 2, "the flaky handler was invoked exactly twice"

    node_attempts = {node_id: node.attempts for node_id, node in result.nodes.items()}
    assert node_attempts == expected["nodeAttempts"], (
        "only the flaky node may consume a second attempt"
    )
    assert result.outputs == expected["output"], "run output drifted from fixtures/expected-run.json"

    print(
        json.dumps(
            {
                "schemaVersion": "graph-engineering.course-module-run/v1alpha1",
                "module": 2,
                "lane": "python",
                "graphHash": graph_hash,
                "status": result.status.value,
                "maxObservedConcurrency": result.max_observed_concurrency,
                "totalAttempts": result.total_attempts,
                "nodeAttempts": node_attempts,
                "report": result.outputs["report"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
