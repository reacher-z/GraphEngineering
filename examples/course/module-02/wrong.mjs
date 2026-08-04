#!/usr/bin/env node

/**
 * Course module 2 — the COMMON INCORRECT implementation (artifact 6).
 *
 * The mistake: wrapping the retry around the WHOLE chain instead of
 * declaring it on the failing node. This version hand-orchestrates the three
 * steps in a `for` loop with one big try/catch: when `enrich` flakes, the
 * catch restarts from the top and `extract` — which already succeeded — runs
 * again.
 *
 * People write this constantly, usually phrased as "just retry the pipeline"
 * or a `@retry` decorator on the top-level function. The final report is
 * IDENTICAL to the correct one, which is exactly why the mistake survives
 * smoke tests — the waste is invisible in the output. It shows up in the
 * attempt accounting: extract runs twice here (the fixture says once), and
 * every re-run of a non-failing node is duplicated cost, duplicated latency,
 * and — the moment a node has side effects — a duplicated side effect.
 *
 * The graph in `run.mjs` cannot make this mistake: `retry.maxAttempts: 2` is
 * declared on the `enrich` node, so the scheduler retries exactly the node
 * that failed, in place, and every other node keeps its single attempt.
 *
 * Run: node examples/course/module-02/wrong.mjs   (exits 1: the accounting is wrong)
 */

import { fileURLToPath } from "node:url";

import { BULLETIN, enrich, extract, failOnce, formatReport, readJson } from "./handlers.mjs";

/** The incorrect retry: one loop around all three steps. */
export function retryWholeChain(bulletin = BULLETIN) {
  const gate = failOnce(); // the SAME deterministic flake run.mjs gives the scheduler
  const flakyEnrich = gate.wrap(enrich);
  const attemptCounts = { extract: 0, enrich: 0, format: 0 };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      attemptCounts.extract += 1;
      const extracted = extract({ bulletin });
      attemptCounts.enrich += 1;
      const enriched = flakyEnrich(extracted);
      attemptCounts.format += 1;
      return { report: formatReport(enriched), attemptCounts };
    } catch {
      // The mistake, verbatim: the chain is retried as one opaque unit, so
      // the restart re-runs steps that already succeeded.
    }
  }
  throw new Error("unreachable: the flaky step succeeds on its second attempt");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const expected = await readJson("fixtures/expected-run.json");
  const wrong = retryWholeChain();
  process.stdout.write(`${JSON.stringify(
    {
      schemaVersion: "graph-engineering.course-module-wrong/v1alpha1",
      module: 2,
      mistake: "retry wrapped around the whole chain instead of the failing node",
      wrongAttemptCounts: wrong.attemptCounts,
      expectedNodeAttempts: expected.nodeAttempts,
      needlesslyReRunNodes: Object.keys(wrong.attemptCounts).filter(
        (nodeId) => wrong.attemptCounts[nodeId] > expected.nodeAttempts[nodeId],
      ),
      reportIdenticalToFixture:
        JSON.stringify(wrong.report) === JSON.stringify(expected.output.report),
    },
    null,
    2,
  )}\n`);
  process.exitCode = 1; // this implementation is wrong, and says so
}
