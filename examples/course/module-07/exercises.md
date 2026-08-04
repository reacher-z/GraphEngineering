# Module 7 exercises — diamond topology

Three exercises, each with a committed solution under
[`solutions/`](./solutions/) that
[`check-exercises.mjs`](./check-exercises.mjs) verifies mechanically:

```bash
node examples/course/module-07/check-exercises.mjs   # exit 0 = all solutions correct
```

Do each exercise yourself first, then diff your result against the solution.
The checker runs the *solutions*, so it stays green regardless of your
attempt — it is the answer key, not your grader. To grade your own attempt,
point the corresponding check at your file.

## Exercise 1 — widen the diamond

Starting from [`diamond.graph.json`](./diamond.graph.json), add a third
independent branch `draft-risks` (an `agent` node with role "Draft the risks
and failure modes for the brief") wired exactly like the other two: one edge
from `split`, one edge into `merge` on a new port `risks`.

Before running anything, predict:

1. `maxObservedConcurrency` when the scheduler is given 3 slots, and
2. `mergedFrom` in the report.

Write both predictions down, then run your graph and compare.

Things to keep straight: `policies.maxConcurrency` must rise to 3 or the
third branch cannot overlap, and `policies.maxFanOut` (4) already admits a
third edge out of `split`.

Solution: [`solutions/exercise-1.graph.json`](./solutions/exercise-1.graph.json)
and [`solutions/exercise-1.answer.json`](./solutions/exercise-1.answer.json).

## Exercise 2 — rename the merge ports

Rename the merge node's input ports: `outline` becomes `structure` and
`examples` becomes `cases`. Change nothing else — not the node ids, not the
executors.

Predict what the merged report's `branches` array contains afterwards, and
what the `branch` field inside each finding contains. They are *not* the
same, and understanding why is the point: the port name is the **consumer's**
name for the value (it becomes the key in the merge node's input object,
`edge.to.port`), while the payload is whatever the **producer** returned.
Renaming a port re-keys the join without touching any producer.

Solution: [`solutions/exercise-2.graph.json`](./solutions/exercise-2.graph.json).

## Exercise 3 — serialize the diamond

Run the unmodified base graph with a concurrency limit of 1. Predict, before
running:

1. `maxObservedConcurrency`;
2. `totalAttempts`;
3. whether the merged report changes at all.

One trap is planted for you: the module's own runners make each branch wait
at a 2-party rendezvous to prove overlap. With a single execution slot that
rendezvous can never be satisfied — the first branch would wait forever for a
second branch that is never scheduled. The solution therefore drops the
latch when serializing. Deadlocking your own graph by asserting parallelism
that the concurrency budget forbids is a real failure mode, not a
hypothetical.

Solution: [`solutions/exercise-3.answer.json`](./solutions/exercise-3.answer.json).
