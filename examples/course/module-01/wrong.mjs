#!/usr/bin/env node

/**
 * Course module 1 — the COMMON INCORRECT implementation (artifact 6).
 *
 * The mistake: treating the edge as a prompt hand-off instead of a typed
 * data contract. The producer flattens the priced order into a prose blob —
 * "Order AB-12: 3 units at $19.50 each" — and the consumer has to
 * reverse-engineer the fields back out of the sentence with pattern matching.
 *
 * People write this constantly, usually phrased as "just pass the text along"
 * or "the next step's model will figure it out". It works on the demo input,
 * and then a value that *looks like* another value lands in the wrong field:
 * here the naive "first number is the quantity" parse grabs the `12` embedded
 * in the SKU `AB-12` and invoices 12 units instead of 3 — silently, for a
 * perfectly ordinary, fully deterministic input. Nothing threw.
 *
 * The typed edge in `run.mjs` cannot make this mistake: `quantity` crosses
 * the edge as a named integer field, so there is nothing to parse and nothing
 * to parse wrongly.
 *
 * Run: node examples/course/module-01/wrong.mjs   (exits 1: the invoice is wrong)
 */

import { fileURLToPath } from "node:url";

import { ORDER, dollars, readJson } from "./handlers.mjs";

/** The incorrect edge: producer emits prose, consumer parses it back. */
export function proseHandOff(order = ORDER) {
  // The "producer": every typed field is flattened into one sentence.
  const prose = `Order ${order.sku}: ${order.quantity} units at ${dollars(order.unitPriceCents)} each`;

  // The "consumer": reverse-engineer the fields out of the sentence.
  // The mistake, verbatim: "the first number in the text is the quantity".
  const sku = /^Order (\S+):/.exec(prose)[1];
  const quantity = Number(/\d+/.exec(prose)[0]); // grabs the "12" inside "AB-12"
  const price = /\$(\d+)\.(\d{2})/.exec(prose);
  const unitPriceCents = Number(price[1]) * 100 + Number(price[2]);
  const totalCents = quantity * unitPriceCents;

  return {
    invoice: {
      invoiceLine: `${sku}: ${quantity} x ${dollars(unitPriceCents)} each = ${dollars(totalCents)}`,
      totalCents,
    },
    prose,
    parsedQuantity: quantity,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const expected = await readJson("fixtures/expected-run.json");
  const wrong = proseHandOff();
  process.stdout.write(`${JSON.stringify(
    {
      schemaVersion: "graph-engineering.course-module-wrong/v1alpha1",
      module: 1,
      mistake: "prose blob across the edge instead of typed fields",
      prose: wrong.prose,
      parsedQuantity: wrong.parsedQuantity,
      actualQuantity: ORDER.quantity,
      wrongInvoice: wrong.invoice,
      expectedInvoice: expected.output.invoice,
      overbilledCents: wrong.invoice.totalCents - expected.output.invoice.totalCents,
    },
    null,
    2,
  )}\n`);
  process.exitCode = 1; // this implementation is wrong, and says so
}
