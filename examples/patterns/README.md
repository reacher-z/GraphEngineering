# Runnable pattern showcase

This example constructs all four built-in Graph Engineering patterns from the
built `@graph-engineering/patterns` package, sends every result through the
canonical core compiler again, and prints one stable JSON report containing
each graph hash, topological layers, pattern label, and required runtime
capability.

From the repository root, build the three local package artifacts and run the
showcase with one command:

```bash
corepack pnpm --filter @graph-engineering/core build && corepack pnpm --filter @graph-engineering/patterns build && corepack pnpm --filter @graph-engineering/runtime build && node examples/patterns/showcase.mjs
```

No API key is needed. The script performs no network access, file reads beyond
loading the built modules, file writes, randomness, or wall-clock measurement.
It writes only the JSON report to stdout.

## What is executed

- `diamond` runs through the real v1alpha1 runtime with two deterministic local
  workers. A controlled promise gate proves both workers are active together;
  the script asserts `maxObservedConcurrency === 2` and the exact named output.
- `verifiedFanout` runs three deterministic verifier lenses through the real
  runtime. A second controlled gate proves three-way overlap; the script asserts
  `maxObservedConcurrency === 3` and the exact adjudicated output.

The gates use no sleeps, timestamps, timeouts, or timing thresholds. If the
workers are not actually concurrent, they cannot pass the gate.

## Declarative-only boundary

`routedBranches` and `loopUntilDry` are intentionally **not** passed to the
current scheduler. The showcase compiles them and asserts their exact capability
labels and condition annotations, then reports `executed: false`:

- `edge-condition-routing/v1alpha1`
- `edge-condition-routing-and-early-stop/v1alpha1`

The v1alpha1 scheduler does not evaluate edge conditions, route one branch, or
stop a statically unrolled loop early. Executing these graphs today would run
every reachable branch or round, so this example never simulates or implies
that those capabilities exist.

The report also records successful keyed-permutation hash checks for `diamond`,
`verifiedFanout`, and `routedBranches`. Finally, in-memory smoke assertions prove
that an accessor is rejected without invoking its getter and that returned
pattern graphs are recursively frozen and reject mutation.
