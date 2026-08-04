#!/usr/bin/env python3
"""Course module 1 -- the COMMON INCORRECT implementation (artifact 6).

The mistake: treating the edge as a prompt hand-off instead of a typed data
contract.  The producer flattens the priced order into a prose blob --
"Order AB-12: 3 units at $19.50 each" -- and the consumer has to
reverse-engineer the fields back out of the sentence with pattern matching.

People write this constantly, usually phrased as "just pass the text along"
or "the next step's model will figure it out".  It works on the demo input,
and then a value that *looks like* another value lands in the wrong field:
here the naive "first number is the quantity" parse grabs the ``12`` embedded
in the SKU ``AB-12`` and invoices 12 units instead of 3 -- silently, for a
perfectly ordinary, fully deterministic input.  Nothing raised.

The typed edge in ``run.py`` cannot make this mistake: ``quantity`` crosses
the edge as a named integer field, so there is nothing to parse and nothing
to parse wrongly.

Run: uv run --project python python examples/course/module-01/wrong.py
(exits 1: the invoice is wrong)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from handlers import ORDER, dollars, read_json  # noqa: E402


def prose_hand_off(order: dict | None = None) -> dict:
    """The incorrect edge: producer emits prose, consumer parses it back."""

    order = dict(ORDER) if order is None else order

    # The "producer": every typed field is flattened into one sentence.
    prose = (
        f"Order {order['sku']}: {order['quantity']} units"
        f" at {dollars(order['unitPriceCents'])} each"
    )

    # The "consumer": reverse-engineer the fields out of the sentence.
    # The mistake, verbatim: "the first number in the text is the quantity".
    sku = re.match(r"^Order (\S+):", prose).group(1)
    quantity = int(re.search(r"\d+", prose).group())  # grabs the "12" inside "AB-12"
    price = re.search(r"\$(\d+)\.(\d{2})", prose)
    unit_price_cents = int(price.group(1)) * 100 + int(price.group(2))
    total_cents = quantity * unit_price_cents

    return {
        "invoice": {
            "invoiceLine": (
                f"{sku}: {quantity} x {dollars(unit_price_cents)} each = {dollars(total_cents)}"
            ),
            "totalCents": total_cents,
        },
        "prose": prose,
        "parsedQuantity": quantity,
    }


def main() -> None:
    expected = read_json("fixtures/expected-run.json")
    wrong = prose_hand_off()
    print(
        json.dumps(
            {
                "schemaVersion": "graph-engineering.course-module-wrong/v1alpha1",
                "module": 1,
                "mistake": "prose blob across the edge instead of typed fields",
                "prose": wrong["prose"],
                "parsedQuantity": wrong["parsedQuantity"],
                "actualQuantity": ORDER["quantity"],
                "wrongInvoice": wrong["invoice"],
                "expectedInvoice": expected["output"]["invoice"],
                "overbilledCents": (
                    wrong["invoice"]["totalCents"] - expected["output"]["invoice"]["totalCents"]
                ),
            },
            indent=2,
        )
    )
    sys.exit(1)  # this implementation is wrong, and says so


if __name__ == "__main__":
    main()
