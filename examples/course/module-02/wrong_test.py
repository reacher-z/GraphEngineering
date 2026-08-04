"""Course module 2 -- the failing test that exposes the wrong implementation
(artifact 7), Python lane.

One assertion -- "the run shape (report AND per-node attempts) equals
fixtures/expected-run.json" -- applied to both implementations:

- against run.py's approach (retry declared on the flaky node; the scheduler
  retries it in place) it PASSES;
- against wrong.py's approach (retry wrapped around the whole chain) it
  FAILS, and this file asserts that failure.  Crucially the wrong REPORT is
  identical to the fixture's -- an output-only test cannot catch this bug.
  The attempt accounting catches it: extract ran twice.

The suite therefore stays green while the pedagogy stays real: pytest exiting
0 means "the correct implementation matches the fixture AND the
whole-chain-retry bug is still detected by that same fixture".

Run: uv run --project python pytest examples/course/module-02/wrong_test.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers import BULLETIN, FailOnce, build_handlers, read_json  # noqa: E402
from wrong import retry_whole_chain  # noqa: E402

from graph_engineering import compile_graph, run_graph  # noqa: E402

EXPECTED = read_json("fixtures/expected-run.json")


def assert_matches_fixture(shape: dict) -> None:
    """The one shared assertion: report and per-node attempts match the fixture."""

    assert shape == {
        "report": EXPECTED["output"]["report"],
        "nodeAttempts": EXPECTED["nodeAttempts"],
    }, "run shape differs from fixtures/expected-run.json"


def test_fixture_assertion_passes_against_correct_implementation() -> None:
    async def run() -> dict:
        graph_document = read_json("chain.graph.json")
        result = await run_graph(
            compile_graph(graph_document),
            {"bulletin": BULLETIN},
            build_handlers(graph_document, flaky={"enrich": FailOnce()}),
            max_concurrency=1,
        )
        assert result.status.value == "succeeded"
        return {
            "report": result.outputs["report"],
            "nodeAttempts": {node_id: node.attempts for node_id, node in result.nodes.items()},
        }

    assert_matches_fixture(asyncio.run(run()))


def test_fixture_assertion_fails_against_whole_chain_retry() -> None:
    wrong = retry_whole_chain()

    exposed = False
    try:
        assert_matches_fixture(
            {"report": wrong["report"], "nodeAttempts": wrong["attemptCounts"]}
        )
    except AssertionError:
        exposed = True
    assert exposed, "the fixture assertion must fail against the whole-chain retry"

    # The failure is the taught failure: wasted re-runs, not a wrong report.
    assert wrong["report"] == EXPECTED["output"]["report"], (
        "the report is identical -- an output-only test would call this correct"
    )
    assert wrong["attemptCounts"]["extract"] == 2, (
        "extract was needlessly re-run by the chain retry"
    )
    assert EXPECTED["nodeAttempts"]["extract"] == 1, "the scheduler runs extract exactly once"
    assert wrong["attemptCounts"]["enrich"] == 2, "the flaky node still needed its two attempts"
    assert wrong["attemptCounts"]["format"] == 1, (
        "format ran once -- only upstream work was duplicated"
    )
