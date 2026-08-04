"""Course module 1 -- the failing test that exposes the wrong implementation
(artifact 7), Python lane.

One assertion -- "the invoice equals fixtures/expected-run.json" -- applied to
both implementations:

- against run.py's approach (a typed order object crosses the declared edge)
  it PASSES;
- against wrong.py's approach (prose across the edge, parsed back by the
  consumer) it FAILS, and this file asserts that failure: the parse read the
  ``12`` inside the SKU ``AB-12`` as the quantity.

The suite therefore stays green while the pedagogy stays real: pytest exiting
0 means "the correct implementation matches the fixture AND the prose-parsing
bug is still detected by that same fixture".

Run: uv run --project python pytest examples/course/module-01/wrong_test.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers import ORDER, build_handlers, read_json  # noqa: E402
from wrong import prose_hand_off  # noqa: E402

from graph_engineering import compile_graph, run_graph  # noqa: E402

EXPECTED = read_json("fixtures/expected-run.json")


def assert_matches_fixture(invoice: object) -> None:
    """The one shared assertion: an invoice must equal the committed fixture."""

    assert invoice == EXPECTED["output"]["invoice"], (
        "invoice differs from fixtures/expected-run.json"
    )


def test_fixture_assertion_passes_against_correct_implementation() -> None:
    async def run() -> object:
        graph_document = read_json("typed-edge.graph.json")
        result = await run_graph(
            compile_graph(graph_document),
            dict(ORDER),
            build_handlers(graph_document),
            max_concurrency=1,
        )
        assert result.status.value == "succeeded"
        return result.outputs["invoice"]

    assert_matches_fixture(asyncio.run(run()))


def test_fixture_assertion_fails_against_prose_hand_off() -> None:
    wrong = prose_hand_off()

    exposed = False
    try:
        assert_matches_fixture(wrong["invoice"])
    except AssertionError:
        exposed = True
    assert exposed, "the fixture assertion must fail against the prose hand-off"

    # The failure is the taught failure: a mis-parsed field, not noise.
    assert wrong["invoice"] != EXPECTED["output"]["invoice"]
    assert wrong["parsedQuantity"] == 12, "the parse read the SKU's digits as the quantity"
    assert ORDER["quantity"] == 3, "the actual quantity was never 12"
    assert wrong["invoice"]["totalCents"] == 12 * ORDER["unitPriceCents"], (
        "the customer is overbilled"
    )
    assert wrong["invoice"]["invoiceLine"].startswith("AB-12: 12 x"), (
        "the wrong invoice bills 12 units, deterministically"
    )
