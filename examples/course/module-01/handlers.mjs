/**
 * Module 1 — shared deterministic executors for the typed-edge pair.
 *
 * Every runner in this directory (run.mjs, wrong.mjs, wrong.test.mjs,
 * check-exercises.mjs) builds its node executors from this one module, so the
 * correct and the incorrect implementation disagree only where the lesson
 * says they disagree: what crosses the edge between the two nodes.
 *
 * Executors are pure functions of their input. No adapter, no network, no
 * clock, no randomness.
 */

import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

/** The one deterministic order both lanes price and invoice. */
export const ORDER = { sku: "AB-12", quantity: 3, unitPriceCents: 1950 };

export const here = (name) => fileURLToPath(new URL(name, import.meta.url));

export const readJson = async (name) => JSON.parse(await readFile(here(name), "utf8"));

/** Integer-only money rendering: 5850 -> "$58.50". No floats anywhere. */
export function dollars(cents) {
  return `$${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * The producer. Takes the typed graph input and returns a typed order object:
 * every field keeps its name and its type, and the computed `totalCents`
 * stays an integer. THIS OBJECT is what crosses the edge.
 */
export function priceOrder(order) {
  return { ...order, totalCents: order.quantity * order.unitPriceCents };
}

/**
 * The consumer. Reads typed fields off the edge value by name — no parsing,
 * no guessing. `order.quantity` is the quantity because the producer said so.
 */
export function writeInvoice(order) {
  return {
    invoiceLine:
      `${order.sku}: ${order.quantity} x ${dollars(order.unitPriceCents)} each` +
      ` = ${dollars(order.totalCents)}`,
    totalCents: order.totalCents,
  };
}

/**
 * Build one executor per node from the graph document itself:
 *
 * - the entry transform (`price-order`) prices the graph input;
 * - the non-entry transform (`write-invoice`) reads the typed order off its
 *   single incoming edge, keyed by whatever port name the graph declares
 *   (`edge.to.port`) — rename the port and the consumer follows the graph.
 */
export function buildExecutors(graphDocument) {
  const executors = {};
  const entrypoints = new Set(graphDocument.entrypoints);
  for (const node of graphDocument.nodes) {
    if (entrypoints.has(node.id)) {
      executors[node.id] = ({ input }) => priceOrder(input);
    } else {
      const inbound = graphDocument.edges.find((edge) => edge.to.node === node.id);
      const port = inbound.to.port;
      executors[node.id] = ({ input }) => writeInvoice(input[port]);
    }
  }
  return executors;
}
