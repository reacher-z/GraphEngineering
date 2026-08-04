"""Module 1 -- shared deterministic handlers for the typed-edge pair.

Every Python runner in this directory (run.py, wrong.py, wrong_test.py) builds
its node handlers from this one module, so the correct and the incorrect
implementation disagree only where the lesson says they disagree: what crosses
the edge between the two nodes.

Handlers are pure functions of their input.  No adapter, no network, no clock,
no randomness.  The invoice strings are byte-identical to the TypeScript
lane's, which is why both lanes assert against the same fixture.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable, Mapping

HERE = Path(__file__).parent

#: The one deterministic order both lanes price and invoice.
ORDER = {"sku": "AB-12", "quantity": 3, "unitPriceCents": 1950}


def read_json(name: str) -> Any:
    return json.loads((HERE / name).read_text(encoding="utf-8"))


def dollars(cents: int) -> str:
    """Integer-only money rendering: 5850 -> "$58.50".  No floats anywhere."""

    return f"${cents // 100}.{cents % 100:02d}"


def price_order(order: Mapping[str, Any]) -> dict[str, Any]:
    """The producer.

    Takes the typed graph input and returns a typed order object: every field
    keeps its name and its type, and the computed ``totalCents`` stays an
    integer.  THIS OBJECT is what crosses the edge.
    """

    return {**order, "totalCents": order["quantity"] * order["unitPriceCents"]}


def write_invoice(order: Mapping[str, Any]) -> dict[str, Any]:
    """The consumer.

    Reads typed fields off the edge value by name -- no parsing, no guessing.
    ``order["quantity"]`` is the quantity because the producer said so.
    """

    return {
        "invoiceLine": (
            f"{order['sku']}: {order['quantity']} x {dollars(order['unitPriceCents'])} each"
            f" = {dollars(order['totalCents'])}"
        ),
        "totalCents": order["totalCents"],
    }


def build_handlers(graph_document: Mapping[str, Any]) -> dict[str, Callable[..., Any]]:
    """Build one handler per node from the graph document itself.

    - the entry transform (``price-order``) prices the graph input;
    - the non-entry transform (``write-invoice``) reads the typed order off
      its single incoming edge, keyed by whatever port name the graph
      declares (``edge.to.port``) -- rename the port and the consumer follows
      the graph.
    """

    handlers: dict[str, Callable[..., Any]] = {}
    entrypoints = set(graph_document["entrypoints"])

    def producer_handler(context: Any) -> Any:
        return price_order(context.input)

    def consumer_handler(port: str) -> Callable[..., Any]:
        def handle(context: Any) -> Any:
            return write_invoice(context.input[port])

        return handle

    for node in graph_document["nodes"]:
        if node["id"] in entrypoints:
            handlers[node["id"]] = producer_handler
        else:
            inbound = next(
                edge for edge in graph_document["edges"] if edge["to"]["node"] == node["id"]
            )
            handlers[node["id"]] = consumer_handler(inbound["to"]["port"])
    return handlers
