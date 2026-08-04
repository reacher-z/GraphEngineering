/**
 * Module 7 — shared deterministic executors for the teaching diamond.
 *
 * Every runner in this directory (run.mjs, wrong.mjs, wrong.test.mjs,
 * check-exercises.mjs) builds its node executors from this one module, so the
 * correct and the incorrect implementation disagree only where the lesson
 * says they disagree: how the fan-in is joined.
 *
 * Executors are pure functions of their input. No adapter, no network, no
 * clock, no randomness.
 */

import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

export const BRIEF = "how a diamond joins parallel work";

export const here = (name) => fileURLToPath(new URL(name, import.meta.url));

export const readJson = async (name) => JSON.parse(await readFile(here(name), "utf8"));

/** Deterministic branch draft. The text is a pure function of (branch, brief). */
export function draft(branch, brief) {
  return { branch, finding: `${branch} branch: drafted independently for ${brief}` };
}

/**
 * The deterministic reduce. Branch results arrive as one object keyed by the
 * merge node's input port names; completion order is not represented at all.
 * Sorting the keys makes the report a pure function of the joined values.
 */
export function mergeSorted(input) {
  const branches = Object.keys(input).sort();
  return {
    branches,
    findings: branches.map((branch) => input[branch]),
    mergedFrom: branches.length,
  };
}

/**
 * An N-party rendezvous. Each worker awaits `arrive()`; nobody proceeds until
 * all `parties` workers have started. This proves the branches actually
 * overlap without reading a clock.
 */
export function latch(parties) {
  let arrived = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  return {
    arrive: async () => {
      arrived += 1;
      if (arrived === parties) release();
      await gate;
    },
    arrivals: () => arrived,
  };
}

/**
 * Build one executor per node from the graph document itself:
 *
 * - the entry transform (`split`) passes the graph input through;
 * - every `agent` node drafts its branch (node id minus the `draft-` prefix)
 *   from the brief the split node forwarded;
 * - the non-entry transform (`merge`) performs the sorted deterministic
 *   reduce over whatever port names the graph wired into it.
 *
 * `arrive` is optional; when present every agent awaits it before drafting.
 */
export function buildExecutors(graphDocument, { arrive } = {}) {
  const executors = {};
  const entrypoints = new Set(graphDocument.entrypoints);
  for (const node of graphDocument.nodes) {
    if (entrypoints.has(node.id)) {
      executors[node.id] = ({ input }) => input;
    } else if (node.kind === "agent") {
      const branch = node.id.replace(/^draft-/, "");
      executors[node.id] = async ({ input }) => {
        if (arrive) await arrive();
        return draft(branch, input.split.brief);
      };
    } else {
      executors[node.id] = ({ input }) => mergeSorted(input);
    }
  }
  return executors;
}
