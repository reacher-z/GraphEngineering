#!/usr/bin/env python3
"""Course module 2 -- the COMMON INCORRECT implementation (artifact 6).

The mistake: wrapping the retry around the WHOLE chain instead of declaring
it on the failing node.  This version hand-orchestrates the three steps in a
``for`` loop with one big try/except: when ``enrich`` flakes, the except
restarts from the top and ``extract`` -- which already succeeded -- runs
again.

People write this constantly, usually phrased as "just retry the pipeline" or
a ``@retry`` decorator on the top-level function.  The final report is
IDENTICAL to the correct one, which is exactly why the mistake survives smoke
tests -- the waste is invisible in the output.  It shows up in the attempt
accounting: extract runs twice here (the fixture says once), and every re-run
of a non-failing node is duplicated cost, duplicated latency, and -- the
moment a node has side effects -- a duplicated side effect.

The graph in ``run.py`` cannot make this mistake: ``retry.maxAttempts: 2`` is
declared on the ``enrich`` node, so the scheduler retries exactly the node
that failed, in place, and every other node keeps its single attempt.

Run: uv run --project python python examples/course/module-02/wrong.py
(exits 1: the accounting is wrong)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers import (  # noqa: E402
    BULLETIN,
    FailOnce,
    enrich,
    extract,
    format_report,
    read_json,
)


def retry_whole_chain(bulletin: str = BULLETIN) -> dict:
    """The incorrect retry: one loop around all three steps."""

    gate = FailOnce()  # the SAME deterministic flake run.py gives the scheduler
    flaky_enrich = gate.wrap(enrich)
    attempt_counts = {"extract": 0, "enrich": 0, "format": 0}

    for _attempt in range(1, 3):
        try:
            attempt_counts["extract"] += 1
            extracted = extract({"bulletin": bulletin})
            attempt_counts["enrich"] += 1
            enriched = flaky_enrich(extracted)
            attempt_counts["format"] += 1
            return {"report": format_report(enriched), "attemptCounts": attempt_counts}
        except RuntimeError:
            # The mistake, verbatim: the chain is retried as one opaque unit,
            # so the restart re-runs steps that already succeeded.
            continue
    raise AssertionError("unreachable: the flaky step succeeds on its second attempt")


def main() -> None:
    expected = read_json("fixtures/expected-run.json")
    wrong = retry_whole_chain()
    print(
        json.dumps(
            {
                "schemaVersion": "graph-engineering.course-module-wrong/v1alpha1",
                "module": 2,
                "mistake": "retry wrapped around the whole chain instead of the failing node",
                "wrongAttemptCounts": wrong["attemptCounts"],
                "expectedNodeAttempts": expected["nodeAttempts"],
                "needlesslyReRunNodes": [
                    node_id
                    for node_id, count in wrong["attemptCounts"].items()
                    if count > expected["nodeAttempts"][node_id]
                ],
                "reportIdenticalToFixture": wrong["report"] == expected["output"]["report"],
            },
            indent=2,
        )
    )
    sys.exit(1)  # this implementation is wrong, and says so


if __name__ == "__main__":
    main()
