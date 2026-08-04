# Module 2 exercises — linear chain as a degenerate graph

Three exercises, each with a committed solution under
[`solutions/`](./solutions/) that
[`check-exercises.mjs`](./check-exercises.mjs) verifies mechanically:

```bash
node examples/course/module-02/check-exercises.mjs   # exit 0 = all solutions correct
```

Do each exercise yourself first, then diff your result against the solution.
The checker runs the *solutions*, so it stays green regardless of your
attempt — it is the answer key, not your grader. To grade your own attempt,
point the corresponding check at your file.

## Exercise 1 — move the flake to node 3

Starting from [`chain.graph.json`](./chain.graph.json), make `format` the
flaky node instead of `enrich` (in the runners this means wiring the
fail-once gate onto `format`), and move the `retry.maxAttempts: 2`
declaration with it — retry belongs on the node that fails, so the
declaration follows the flake.

Before running anything, predict the per-node attempt counts and
`totalAttempts`. Write them down, then run and compare. Everything upstream
of the flake keeps exactly one attempt — the chain never rewinds.

Solution: [`solutions/exercise-1.graph.json`](./solutions/exercise-1.graph.json)
and [`solutions/exercise-1.answer.json`](./solutions/exercise-1.answer.json).

## Exercise 2 — remove the retry entirely

Delete the `retry` declaration from every node and leave the flake on
`enrich`. Predict, before running:

1. the run `status`;
2. each node's attempt count;
3. what happens to `format` — does it run, fail, or something else?

The answer is the scheduler's failure accounting in miniature: the default
attempt budget is 1, so `enrich` fails permanently on its first flake
(`NODE_EXECUTION_FAILED`), and `format` is **skipped** with 0 attempts and
failure code `UPSTREAM_FAILED` — it never ran, and the result says so
explicitly instead of leaving you to guess.

Solution: [`solutions/exercise-2.graph.json`](./solutions/exercise-2.graph.json)
and [`solutions/exercise-2.answer.json`](./solutions/exercise-2.answer.json).

## Exercise 3 — give the chain three slots

Run the unmodified base graph with a concurrency limit of 3 (keep the flake
on `enrich`). Predict, before running:

1. `maxObservedConcurrency`;
2. `totalAttempts`;
3. whether the report changes at all.

This is what "degenerate graph" means operationally: a chain is a graph
whose every layer has width 1, so extra execution slots buy nothing —
`maxObservedConcurrency` stays 1 and the critical path is the whole graph.
The moment you remove a fake dependency and two nodes share a layer (module
7's diamond), the same scheduler and the same slot count start overlapping
work with no code change.

Solution: [`solutions/exercise-3.answer.json`](./solutions/exercise-3.answer.json).
