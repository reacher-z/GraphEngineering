#!/usr/bin/env node

/**
 * Course module 7 — the COMMON INCORRECT implementation (artifact 6).
 *
 * The mistake: treating fan-in as "first result wins". Instead of letting the
 * graph's merge node join BOTH branches, this version hand-orchestrates the
 * diamond and merges as soon as the first branch completes — a `Promise.race`
 * where the topology demands a join.
 *
 * People write this constantly, usually phrased as "merge whatever is ready"
 * or "stream results into the reducer as they land". It looks faster, it
 * often even passes a smoke test, and it silently drops every branch that was
 * not first. The report below is missing the `examples` branch entirely, and
 * nothing threw.
 *
 * The branch speeds are deterministic on purpose (outline resolves on the
 * microtask queue, examples only after a macrotask), so the wrong answer is
 * the SAME wrong answer every run — which is what lets `wrong.test.mjs`
 * expose it mechanically.
 *
 * Run: node examples/course/module-07/wrong.mjs   (exits 1: the output is wrong)
 */

import { fileURLToPath } from "node:url";

import { BRIEF, draft, mergeSorted, readJson } from "./handlers.mjs";

/** The incorrect fan-in: race to first completion, merge only the winner. */
export async function raceToFirstMerge(brief = BRIEF) {
  // Hand-rolled "split": forward the brief to both branches ourselves,
  // bypassing the scheduler that would have enforced the join.
  const outline = (async () => draft("outline", brief))();
  const examples = (async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return draft("examples", brief);
  })();

  // The mistake, verbatim: the topology says join both, the code says race.
  const first = await Promise.race([outline, examples]);
  await examples; // do not leak a dangling promise; the result is still discarded

  return { report: mergeSorted({ [first.branch]: first }) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const expected = await readJson("fixtures/expected-run.json");
  const wrong = await raceToFirstMerge();
  process.stdout.write(`${JSON.stringify(
    {
      schemaVersion: "graph-engineering.course-module-wrong/v1alpha1",
      module: 7,
      mistake: "race-to-first fan-in instead of joining both branches",
      wrongReport: wrong.report,
      expectedReport: expected.output.report,
      droppedBranches: expected.output.report.branches.filter(
        (branch) => !wrong.report.branches.includes(branch),
      ),
    },
    null,
    2,
  )}\n`);
  process.exitCode = 1; // this implementation is wrong, and says so
}
