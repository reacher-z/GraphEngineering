"""Course module 7 -- the failing test that exposes the wrong implementation
(artifact 7), Python lane.

One assertion -- "the report equals fixtures/expected-run.json" -- applied to
both implementations:

- against run.py's approach (the graph scheduler joins both branches) it
  PASSES;
- against wrong.py's approach (race to first completion) it FAILS, and this
  file asserts that failure: the wrong report differs from the fixture and is
  missing the ``examples`` branch.

The suite therefore stays green while the pedagogy stays real: pytest exiting
0 means "the correct implementation matches the fixture AND the race bug is
still detected by that same fixture".

Run: uv run --project python pytest examples/course/module-07/wrong_test.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers import BRIEF, build_handlers, read_json, two_party_latch  # noqa: E402
from wrong import race_to_first_merge  # noqa: E402

from graph_engineering import compile_graph, run_graph  # noqa: E402

EXPECTED = read_json("fixtures/expected-run.json")


def assert_matches_fixture(report: object) -> None:
    """The one shared assertion: a report must equal the committed fixture."""

    assert report == EXPECTED["output"]["report"], (
        "report differs from fixtures/expected-run.json"
    )


def test_fixture_assertion_passes_against_correct_implementation() -> None:
    async def run() -> object:
        graph_document = read_json("diamond.graph.json")
        arrive, _ = two_party_latch()
        result = await run_graph(
            compile_graph(graph_document),
            {"brief": BRIEF},
            build_handlers(graph_document, arrive=arrive),
            max_concurrency=2,
        )
        assert result.status.value == "succeeded"
        return result.outputs["report"]

    assert_matches_fixture(asyncio.run(run()))


def test_fixture_assertion_fails_against_race_to_first_merge() -> None:
    wrong = asyncio.run(race_to_first_merge())

    exposed = False
    try:
        assert_matches_fixture(wrong["report"])
    except AssertionError:
        exposed = True
    assert exposed, "the fixture assertion must fail against the race-to-first merge"

    # The failure is the taught failure: a silently dropped branch, not noise.
    assert wrong["report"] != EXPECTED["output"]["report"]
    assert wrong["report"]["branches"] == ["outline"], "the race winner is deterministic"
    assert wrong["report"]["mergedFrom"] == 1, "only one branch was merged"
    assert "examples" not in wrong["report"]["branches"], (
        "the examples branch must have been silently dropped"
    )
