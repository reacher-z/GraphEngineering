"""Module 7 -- shared deterministic handlers for the teaching diamond.

Every Python runner in this directory (run.py, wrong.py, wrong_test.py) builds
its node handlers from this one module, so the correct and the incorrect
implementation disagree only where the lesson says they disagree: how the
fan-in is joined.

Handlers are pure functions of their input.  No adapter, no network, no clock,
no randomness.  The drafted strings are byte-identical to the TypeScript
lane's, which is why both lanes assert against the same fixture.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping

HERE = Path(__file__).parent

BRIEF = "how a diamond joins parallel work"


def read_json(name: str) -> Any:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def draft(branch: str, brief: str) -> dict[str, str]:
    """Deterministic branch draft.  A pure function of (branch, brief)."""

    return {"branch": branch, "finding": f"{branch} branch: drafted independently for {brief}"}


def merge_sorted(joined: Mapping[str, Any]) -> dict[str, Any]:
    """The deterministic reduce.

    Branch results arrive as one mapping keyed by the merge node's input port
    names; completion order is not represented at all.  Sorting the keys makes
    the report a pure function of the joined values.
    """

    branches = sorted(joined)
    return {
        "branches": branches,
        "findings": [joined[branch] for branch in branches],
        "mergedFrom": len(branches),
    }


def build_handlers(
    graph_document: Mapping[str, Any],
    arrive: Callable[[], Awaitable[None]] | None = None,
) -> dict[str, Callable[..., Any]]:
    """Build one handler per node from the graph document itself.

    - the entry transform (``split``) passes the graph input through;
    - every ``agent`` node drafts its branch (node id minus the ``draft-``
      prefix) from the brief the split node forwarded;
    - the non-entry transform (``merge``) performs the sorted deterministic
      reduce over whatever port names the graph wired into it.

    ``arrive`` is optional; when present every agent awaits it before
    drafting.
    """

    handlers: dict[str, Callable[..., Any]] = {}
    entrypoints = set(graph_document["entrypoints"])

    def identity_handler(context: Any) -> Any:
        return context.input

    def agent_handler(branch: str) -> Callable[..., Awaitable[Any]]:
        async def handle(context: Any) -> Any:
            if arrive is not None:
                await arrive()
            return draft(branch, context.input["split"]["brief"])

        return handle

    def merge_handler(context: Any) -> Any:
        return merge_sorted(context.input)

    for node in graph_document["nodes"]:
        if node["id"] in entrypoints:
            handlers[node["id"]] = identity_handler
        elif node["kind"] == "agent":
            handlers[node["id"]] = agent_handler(node["id"].removeprefix("draft-"))
        else:
            handlers[node["id"]] = merge_handler
    return handlers


def two_party_latch() -> tuple[Callable[[], Awaitable[None]], Callable[[], int]]:
    """A 2-party rendezvous proving both branches overlap, without a clock."""

    barrier = asyncio.Barrier(2)
    arrived = {"count": 0}

    async def arrive() -> None:
        arrived["count"] += 1
        await barrier.wait()

    return arrive, lambda: arrived["count"]
