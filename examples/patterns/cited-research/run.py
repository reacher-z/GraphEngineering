#!/usr/bin/env python3
"""Pattern 02 — cited deep research, reduced form.  Python lane, mock end to end.

Four things happen here, in order:

1. The bundle graph is reconstructed from the native ``cited_research``
   constructor and checked against both committed canonical documents (JSON and
   YAML).  A drifted bundle fails here, not at run time.
2. The graph runs on the native Python DAG scheduler.  Each source and each
   skeptic dispatches through the deterministic mock adapter, scripted entirely
   from ``fixtures/sources.json``.  The three source lanes must actually
   overlap, and so must the three skeptic lanes — two ``asyncio.Barrier``
   instances prove it without a sleep or a timestamp.
3. The same graph runs durably with payload protection configured.  The
   committed event sequence is compared against ``fixtures/expected-events.json``
   — the same file the TypeScript lane compares against.
4. A parallelism-versus-barrier trace is rendered from the committed event
   order.

No network access, no credential, no API key, no clock reading, and no real
research: every claim, citation and contradiction is committed fixture data.
The four verdict cases the corpus carries — supported, contradicted,
rejected-by-the-citation-gate, insufficient-evidence — are each asserted
against the run's actual output, not merely described.

Run: uv run --project python python examples/patterns/cited-research/run.py
"""

from __future__ import annotations

import asyncio
import json

from bundle import (  # noqa: E402  (sibling module, loaded from this directory)
    HERE,
    RUN_ID,
    SKEPTIC_SLOTS,
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
from graph_engineering.patterns import cited_research, claim_id
from graph_engineering.persistence import GuardedMemoryEventStore


async def main() -> None:
    # ------------------------------------------------------------------
    # 1. The committed bundle documents are what the constructor produces
    # ------------------------------------------------------------------
    graph_document = read_json("cited-research.graph.json")
    yaml_text = (HERE / "cited-research.graph.yaml").read_text(encoding="utf-8")
    corpus = read_json("fixtures/sources.json")
    descriptor_document = read_json("mock-adapter.descriptor.json")
    expected_run = read_json("fixtures/expected-run.json")
    expected_events = read_json("fixtures/expected-events.json")

    constructed = cited_research(sources=source_options(), skeptic_slots=SKEPTIC_SLOTS)
    assert constructed == graph_document, "the committed JSON graph must equal the constructor output"
    assert parse_graph_source(yaml_text, format="yaml") == graph_document, (
        "the committed YAML graph must decode to the committed JSON graph"
    )
    graph_hash = canonical_sha256(graph_document)
    assert graph_hash == expected_run["graphHash"]
    assert corpus["claimSlots"] == SKEPTIC_SLOTS

    graph = compile_graph(graph_document)
    graph_input = {"question": corpus["question"]}

    # ------------------------------------------------------------------
    # 2. The deterministic mock end-to-end run
    # ------------------------------------------------------------------
    source_gate = asyncio.Barrier(3)
    skeptic_gate = asyncio.Barrier(SKEPTIC_SLOTS)

    async def arrive_source() -> None:
        await source_gate.wait()

    async def arrive_skeptic() -> None:
        await skeptic_gate.wait()

    parallel = Handlers(
        corpus,
        descriptor_document,
        arrive_source=arrive_source,
        arrive_skeptic=arrive_skeptic,
    )
    result = await run_graph(graph, graph_input, parallel.map, max_concurrency=3)
    assert result.status.value == "succeeded", result.failures
    assert result.max_observed_concurrency == expected_run["maxObservedConcurrency"]
    assert result.total_attempts == expected_run["totalAttempts"]
    assert parallel.dispatches == 6, "one mock dispatch per source and per skeptic, and no more"
    assert result.outputs == expected_run["output"]

    # The committed output really contains the corpus's four verdict cases,
    # and the claim ids in it really are the hash rule applied to the texts.
    report = result.outputs["verdicts"]
    table = report["evidenceTable"]
    assert len(table) == 4, "every claim stays in the evidence table"
    for row in table:
        assert claim_id(row["text"]) == row["claimId"], (
            "every table row's id must re-derive from its text"
        )
    by_verdict = {row["verdict"]: row for row in table}
    assert sorted(by_verdict) == [
        "contradicted",
        "insufficient-evidence",
        "rejected",
        "supported",
    ], "all four verdict kinds are present"

    supported = by_verdict["supported"]
    assert report["verdicts"]["supported"] == [supported["claimId"]]
    assert supported["distinctSources"] == ["changelog", "docs"]
    assert supported["accepted"] is True

    contradicted = by_verdict["contradicted"]
    assert report["verdicts"]["contradicted"] == [contradicted["claimId"]]
    assert contradicted["accepted"] is False
    assert contradicted["skeptic"]["finding"] == "contradicted"
    assert contradicted["skeptic"]["counterEvidence"]["source"] == "docs"
    assert contradicted["skeptic"]["counterEvidence"]["itemId"] == "doc-budget"
    assert isinstance(contradicted["skeptic"]["counterEvidence"]["title"], str)

    rejected = by_verdict["rejected"]
    assert report["verdicts"]["rejected"] == [rejected["claimId"]]
    assert report["citationCoverage"]["claimsRejectedForNoCitation"] == [rejected["claimId"]]
    assert rejected["accepted"] is False
    assert rejected["reason"] == "citation-coverage: cites no source item"
    assert rejected["citations"] == []
    assert rejected["skeptic"] is None

    insufficient = by_verdict["insufficient-evidence"]
    assert report["verdicts"]["insufficientEvidence"] == [insufficient["claimId"]]
    assert insufficient["accepted"] is False
    assert insufficient["distinctSources"] == ["changelog"]

    assert report["citationCoverage"]["claimsTotal"] == 4
    assert report["citationCoverage"]["claimsCited"] == 3

    # ------------------------------------------------------------------
    # 3. The same graph, durably, with payload protection configured
    # ------------------------------------------------------------------
    durable_handlers = Handlers(corpus, descriptor_document)
    store = GuardedMemoryEventStore()
    durable = await start_graph_run(
        graph,
        graph_input,
        durable_handlers.map,
        run_id=RUN_ID,
        implementation_id="cited-research-mock@1",
        event_store=store,
        payload_protection=memory_protection(),
        max_concurrency=3,
    )
    assert durable.status.value == "succeeded", durable.failures
    assert durable.outputs == expected_run["output"]
    assert durable_handlers.dispatches == 6

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
                "verdicts": report,
                "trace": render_trace(committed),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
