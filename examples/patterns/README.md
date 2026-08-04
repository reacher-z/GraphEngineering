# Runnable pattern showcase

Three complete pattern bundles live beside this showcase, each with its own
manifest, canonical graph pair, deterministic fixtures, and dual-language
runners:

- [`research-diamond/`](research-diamond/README.md) — Pattern 01, the
  multi-source research diamond.
- [`cited-research/`](cited-research/README.md) — Pattern 02, cited deep
  research in honest reduced form (stable hash-derived claim ids, a static
  skeptic stage instead of per-claim fan-out, a citation-coverage gate and an
  exportable evidence table; see its manifest's limitations).
- [`ecosystem-scan/`](ecosystem-scan/README.md) — Pattern 10, the scheduled
  ecosystem scan in honest reduced form (nothing in it is actually scheduled;
  see its manifest's limitations).

This example constructs the four topology patterns exported by the
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
- `verifiedFanout` first proves that its three specialized `validator` nodes
  fail closed with zero attempts. It then runs an explicit topology-equivalent
  execution projection in which only those three node kinds are replaced by
  ordinary `transform` jobs. A second controlled gate proves three-way overlap;
  the script asserts `maxObservedConcurrency === 3`, the exact adjudicated
  output, and distinct declaration/execution graph hashes. This demonstrates
  fan-out mechanics without claiming verifier semantics.

The gates use no sleeps, timestamps, timeouts, or timing thresholds. If the
workers are not actually concurrent, they cannot pass the gate.

## Routing and early-stop boundary

This particular showcase still does not pass `routedBranches` or `loopUntilDry`
to `runGraph`; it compiles them, asserts their exact capability labels and
condition annotations, and reports `executed: false`:

- `edge-condition-routing/v1alpha1`
- `edge-condition-routing-and-early-stop/v1alpha1`

That report is a boundary of this script, not a statement that routing is still
declarative-only. The current TypeScript and Python schedulers execute the
pattern package's closed, compiler-validated `RouteEquals` condition in ordinary
and durable start/resume runs. They run only selected branches, settle inactive
branches with explicit skipped terminals and zero attempts, and bind merge
inputs only from active branches. Dedicated durable `RouteSelected` history,
route-decision replay identity, and scheduler-integrated barrier settlement are
still open work.

`loopUntilDry` remains declarative-only through the Graph IR scheduler. Its
finite graph annotations do not stop later rounds early, so running that graph
would execute every statically expanded round. The standalone bounded-cycle
controller has its own replay/fork capability, but that separate API does not
make the `loopUntilDry` graph scheduler-executable.

## Capability-gated Graph IR vocabulary

Successful compilation does not imply that every recognized Graph IR field has
runtime semantics. Until its capability gate lands, this example does not claim
execution or enforcement for `stream`/`artifact-ref` edges; `subgraph`,
`validator`, or `human` behavior; barrier policies beyond the current static
all-success join; or `stateSchema`, `resources`, and `isolation`. A generic
caller-supplied executor for one of those node kinds is not evidence of
streaming, artifact transport, subgraph scheduling, settled/quorum/deadline
barrier behavior, verifier/human gating, state reduction, resource control, or
isolation.

The report also records successful keyed-permutation hash checks for `diamond`,
`verifiedFanout`, and `routedBranches`. Finally, in-memory smoke assertions prove
that an accessor is rejected without invoking its getter and that returned
pattern graphs are recursively frozen and reject mutation.
