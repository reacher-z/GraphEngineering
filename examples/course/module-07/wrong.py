#!/usr/bin/env python3
"""Course module 7 -- the COMMON INCORRECT implementation (artifact 6).

The mistake: treating fan-in as "first result wins".  Instead of letting the
graph's merge node join BOTH branches, this version hand-orchestrates the
diamond and merges as soon as the first branch completes -- a race where the
topology demands a join.

People write this constantly, usually phrased as "merge whatever is ready" or
"stream results into the reducer as they land".  It looks faster, it often
even passes a smoke test, and it silently drops every branch that was not
first.  The report below is missing the ``examples`` branch entirely, and
nothing raised.

The branch speeds are deterministic on purpose (outline is created first and
returns immediately; examples yields to the event loop once), so the wrong
answer is the SAME wrong answer every run -- which is what lets
``wrong_test.py`` expose it mechanically.

Run: uv run --project python python examples/course/module-07/wrong.py
(exits 1: the output is wrong)
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers import BRIEF, draft, merge_sorted, read_json  # noqa: E402


async def race_to_first_merge(brief: str = BRIEF) -> dict:
    """The incorrect fan-in: race to first completion, merge only the winner."""

    results: asyncio.Queue = asyncio.Queue()

    async def outline() -> None:
        await results.put(draft("outline", brief))

    async def examples() -> None:
        await asyncio.sleep(0)  # the slower branch
        await results.put(draft("examples", brief))

    tasks = [asyncio.create_task(outline()), asyncio.create_task(examples())]

    # The mistake, verbatim: the topology says join both, the code takes the
    # first result that lands and merges it alone.
    first = await results.get()
    await asyncio.gather(*tasks)  # the late branch still ran; its result is discarded

    return {"report": merge_sorted({first["branch"]: first})}


async def main() -> None:
    expected = read_json("fixtures/expected-run.json")
    wrong = await race_to_first_merge()
    print(
        json.dumps(
            {
                "schemaVersion": "graph-engineering.course-module-wrong/v1alpha1",
                "module": 7,
                "mistake": "race-to-first fan-in instead of joining both branches",
                "wrongReport": wrong["report"],
                "expectedReport": expected["output"]["report"],
                "droppedBranches": [
                    branch
                    for branch in expected["output"]["report"]["branches"]
                    if branch not in wrong["report"]["branches"]
                ],
            },
            indent=2,
        )
    )
    sys.exit(1)  # this implementation is wrong, and says so


if __name__ == "__main__":
    asyncio.run(main())
