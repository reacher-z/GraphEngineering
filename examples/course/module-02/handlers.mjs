/**
 * Module 2 — shared deterministic executors for the teaching chain.
 *
 * Every runner in this directory (run.mjs, wrong.mjs, wrong.test.mjs,
 * check-exercises.mjs) builds its node executors from this one module, so the
 * correct and the incorrect implementation disagree only where the lesson
 * says they disagree: WHERE the retry lives.
 *
 * The chain's step logic is pure; the only state anywhere is the fail-once
 * counter, which makes one chosen node deterministically flaky: its first
 * attempt throws, every later attempt succeeds. No adapter, no network, no
 * clock, no randomness.
 */

import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

export const BULLETIN = "retries move to the failing node";

export const TRANSIENT_MESSAGE = "simulated transient failure: first attempt always flakes";

export const here = (name) => fileURLToPath(new URL(name, import.meta.url));

export const readJson = async (name) => JSON.parse(await readFile(here(name), "utf8"));

/** Step 1: pull the headline and a word count out of the raw bulletin. */
export function extract(input) {
  return { headline: input.bulletin, words: input.bulletin.split(/\s+/).length };
}

/** Step 2: tag the extracted headline. Pure — the flakiness is the wrapper's. */
export function enrich(extracted) {
  return { ...extracted, tag: extracted.words >= 5 ? "long" : "short" };
}

/** Step 3: render the enriched headline into the final report. */
export function formatReport(enriched) {
  return { summary: `[${enriched.tag}] ${enriched.headline} (${enriched.words} words)` };
}

/**
 * A deterministic fail-once gate. `wrap(fn)` returns a function whose FIRST
 * call throws `TRANSIENT_MESSAGE` and whose later calls delegate to `fn`.
 * The counter lives in this closure — the same trick a real flaky dependency
 * plays on you, minus the nondeterminism.
 */
export function failOnce() {
  let calls = 0;
  return {
    wrap: (fn) => (...args) => {
      calls += 1;
      if (calls === 1) throw new Error(TRANSIENT_MESSAGE);
      return fn(...args);
    },
    calls: () => calls,
  };
}

/**
 * Build one executor per node from the graph document itself:
 *
 * - `extract` (the entrypoint) reads the graph input;
 * - `enrich` and `format` read their single incoming edge, keyed by whatever
 *   port name the graph declares (`edge.to.port`);
 * - any node named in `flaky` gets its executor wrapped by that node's
 *   fail-once gate, so its first attempt throws and its retry succeeds.
 */
export function buildExecutors(graphDocument, { flaky = {} } = {}) {
  const executors = {};
  const entrypoints = new Set(graphDocument.entrypoints);
  const steps = { extract, enrich, format: formatReport };
  for (const node of graphDocument.nodes) {
    const step = steps[node.id];
    let executor;
    if (entrypoints.has(node.id)) {
      executor = ({ input }) => step(input);
    } else {
      const inbound = graphDocument.edges.find((edge) => edge.to.node === node.id);
      const port = inbound.to.port;
      executor = ({ input }) => step(input[port]);
    }
    const gate = flaky[node.id];
    executors[node.id] = gate ? gate.wrap(executor) : executor;
  }
  return executors;
}
