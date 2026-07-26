# `@graph-engineering/runtime`

A small, deterministic TypeScript scheduler for the Graph Engineering
v1alpha1 IR.

```ts
import { runGraph } from "@graph-engineering/runtime";

const result = await runGraph(graph, { query: "graph engineering" }, {
  nodeExecutors: {
    research: async ({ input, signal }) => search(input, { signal }),
    synthesize: async ({ input }) => writeReport(input),
  },
  concurrency: 8,
});
```

## Alpha semantics

- ready nodes execute concurrently up to the graph policy and caller limit;
- result arrays always use stable compiler topological order, not completion order;
- an executor failure is retained as structured data and only its descendants
  are skipped; independent branches continue;
- entrypoints receive a detached snapshot of the complete graph input; every
  downstream node receives a mapping keyed by target port (or source node ID),
  including single-edge inputs;
- named Graph IR outputs are returned as an object;
- node retry, timeout, run cancellation, and total attempt budgets are bounded;
- graph input must be portable, acyclic finite JSON; invalid input rejects
  `runGraph` with `TypeError` before any executor is scheduled;
- successful executor values are validated, detached, and deeply frozen before they can flow
  downstream; `undefined`, bigint, non-finite numbers, integers outside
  `[-(2^53-1), 2^53-1]`, cycles, sparse arrays, symbol keys, and class instances
  produce a structured `INVALID_OUTPUT` node failure and participate in the
  configured bounded retry policy. Finite non-integer doubles remain valid;
- transform and barrier nodes default to deterministic identity executors.

Edge `condition`/`map`, JSON Schema I/O validation, streaming edges, durable
checkpoints, and distributed workers are intentionally scheduled for later
alphas. They are not silently emulated in this package.
