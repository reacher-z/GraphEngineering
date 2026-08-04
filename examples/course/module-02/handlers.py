"""Module 2 -- shared deterministic handlers for the teaching chain.

Every Python runner in this directory (run.py, wrong.py, wrong_test.py) builds
its node handlers from this one module, so the correct and the incorrect
implementation disagree only where the lesson says they disagree: WHERE the
retry lives.

The chain's step logic is pure; the only state anywhere is the fail-once
counter, which makes one chosen node deterministically flaky: its first
attempt raises, every later attempt succeeds.  No adapter, no network, no
clock, no randomness.  The report strings are byte-identical to the
TypeScript lane's, which is why both lanes assert against the same fixture.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping

HERE = Path(__file__).parent

BULLETIN = "retries move to the failing node"

TRANSIENT_MESSAGE = "simulated transient failure: first attempt always flakes"


def read_json(name: str) -> Any:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def extract(graph_input: Mapping[str, Any]) -> dict[str, Any]:
    """Step 1: pull the headline and a word count out of the raw bulletin."""

    return {
        "headline": graph_input["bulletin"],
        "words": len(graph_input["bulletin"].split()),
    }


def enrich(extracted: Mapping[str, Any]) -> dict[str, Any]:
    """Step 2: tag the extracted headline.  Pure -- the flakiness is the wrapper's."""

    return {**extracted, "tag": "long" if extracted["words"] >= 5 else "short"}


def format_report(enriched: Mapping[str, Any]) -> dict[str, Any]:
    """Step 3: render the enriched headline into the final report."""

    return {
        "summary": f"[{enriched['tag']}] {enriched['headline']} ({enriched['words']} words)"
    }


class FailOnce:
    """A deterministic fail-once gate.

    ``wrap(fn)`` returns a function whose FIRST call raises
    ``TRANSIENT_MESSAGE`` and whose later calls delegate to ``fn``.  The
    counter lives in this object -- the same trick a real flaky dependency
    plays on you, minus the nondeterminism.
    """

    def __init__(self) -> None:
        self._calls = 0

    def wrap(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            self._calls += 1
            if self._calls == 1:
                raise RuntimeError(TRANSIENT_MESSAGE)
            return fn(*args, **kwargs)

        return wrapped

    def calls(self) -> int:
        return self._calls


def build_handlers(
    graph_document: Mapping[str, Any],
    flaky: Mapping[str, FailOnce] | None = None,
) -> dict[str, Callable[..., Any]]:
    """Build one handler per node from the graph document itself.

    - ``extract`` (the entrypoint) reads the graph input;
    - ``enrich`` and ``format`` read their single incoming edge, keyed by
      whatever port name the graph declares (``edge.to.port``);
    - any node named in ``flaky`` gets its handler wrapped by that node's
      fail-once gate, so its first attempt raises and its retry succeeds.
    """

    flaky = flaky or {}
    handlers: dict[str, Callable[..., Any]] = {}
    entrypoints = set(graph_document["entrypoints"])
    steps: dict[str, Callable[[Mapping[str, Any]], dict[str, Any]]] = {
        "extract": extract,
        "enrich": enrich,
        "format": format_report,
    }

    def entry_handler(step: Callable[..., Any]) -> Callable[..., Any]:
        def handle(context: Any) -> Any:
            return step(context.input)

        return handle

    def ported_handler(step: Callable[..., Any], port: str) -> Callable[..., Any]:
        def handle(context: Any) -> Any:
            return step(context.input[port])

        return handle

    for node in graph_document["nodes"]:
        step = steps[node["id"]]
        if node["id"] in entrypoints:
            handler = entry_handler(step)
        else:
            inbound = next(
                edge for edge in graph_document["edges"] if edge["to"]["node"] == node["id"]
            )
            handler = ported_handler(step, inbound["to"]["port"])
        gate = flaky.get(node["id"])
        handlers[node["id"]] = gate.wrap(handler) if gate else handler
    return handlers
