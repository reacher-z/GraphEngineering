# Module 1 exercises — nodes and real data edges

Three exercises, each with a committed solution under
[`solutions/`](./solutions/) that
[`check-exercises.mjs`](./check-exercises.mjs) verifies mechanically:

```bash
node examples/course/module-01/check-exercises.mjs   # exit 0 = all solutions correct
```

Do each exercise yourself first, then diff your result against the solution.
The checker runs the *solutions*, so it stays green regardless of your
attempt — it is the answer key, not your grader. To grade your own attempt,
point the corresponding check at your file.

## Exercise 1 — add a second typed field to the edge contract

Starting from [`typed-edge.graph.json`](./typed-edge.graph.json), extend the
edge's data contract with a `currency` field: the producer now emits
`currency: "USD"` alongside the priced fields, and the consumer renders
amounts with the currency code instead of a hard-coded `$` — the line becomes
`AB-12: 3 x 19.50 USD each = 58.50 USD`.

Two halves to keep honest:

1. the **document** half — widen the producer's `outputSchema` so `currency`
   is a declared, required field of the contract (in this release node
   schemas document the contract; the ordinary schedulers do not yet enforce
   them at runtime), and
2. the **executor** half — the producer adds the field, the consumer reads it
   *by name*. Neither side parses anything.

Predict before running: does `totalCents` change? (It must not — you added a
field, you did not reprice the order.)

Solution: [`solutions/exercise-1.graph.json`](./solutions/exercise-1.graph.json)
and [`solutions/exercise-1.answer.json`](./solutions/exercise-1.answer.json).

## Exercise 2 — rename the port

Rename the edge's destination port: `order` becomes `pricedOrder`. Change
nothing else — not the node ids, not the executors' logic.

Predict what key the consumer now finds the typed order under, and whether
the invoice changes. The port name is the **consumer's** name for the value
(`edge.to.port` becomes the key in the consumer's input object); the payload
is whatever the **producer** returned. Renaming the port re-keys the
consumer's view without touching the producer — the invoice must come out
byte-identical.

Solution: [`solutions/exercise-2.graph.json`](./solutions/exercise-2.graph.json).

## Exercise 3 — delete the edge

Delete the one edge and change nothing else. Predict what happens: does the
run produce an empty invoice, hang, or refuse?

It refuses — before any node runs. `write-invoice` is no longer reachable
from any entrypoint, so compilation fails with `GE1006_UNREACHABLE_NODE` and
`totalAttempts` stays 0. The lesson: a dependency is a *drawn* fact, not an
implied one. In prompt-chain code the consumer would happily run with an
empty context and hallucinate an invoice; in a graph, "the consumer gets the
producer's value" exists only if the edge exists, and the compiler checks it
before execution starts.

Solution: [`solutions/exercise-3.answer.json`](./solutions/exercise-3.answer.json).
