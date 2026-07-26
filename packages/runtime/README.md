# `@graph-engineering/runtime`

A small, deterministic TypeScript scheduler for the Graph Engineering v1alpha1
IR, with both in-memory execution and event-sourced durable continuation.

## In-memory execution

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

`runGraph` does not persist progress. Use the separate durable operations when a
run must continue from committed scheduler history after process loss.

## Durable start and resume

```ts
import { JsonlEventStore } from "@graph-engineering/persistence";
import {
  resumeDurableGraphRun,
  startDurableGraphRun,
} from "@graph-engineering/runtime";

const eventStore = new JsonlEventStore({ directory: ".graph-engineering" });
const options = {
  runId: "research-001",
  implementationId: "research-handlers@1",
  eventStore,
  nodeExecutors: {
    research: async ({ input, signal, idempotencyKey }) =>
      search(input, { signal, idempotencyKey }),
    synthesize: async ({ input }) => writeReport(input),
  },
  concurrency: 8,
};

// Invoke with --resume only in a replacement process after confirming that the
// old coordinator stopped. Resume throws RUN_NOT_FOUND for a missing run and
// never accepts replacement input; start throws RUN_ALREADY_EXISTS instead of
// silently resuming.
const result = process.argv.includes("--resume")
  ? await resumeDurableGraphRun(graph, options)
  : await startDurableGraphRun(
      graph,
      { query: "graph engineering" },
      options,
    );
```

The event stream is authoritative. A durable attempt claim commits before its
executor is called; a validated success and ordered edge emissions commit before
dependants are released. Resume verifies the bound graph, original input, and
caller-supplied `implementationId`, then reuses committed successful nodes.

An open attempt has an unknown outcome. Nodes declared
`sideEffects: "none"` or `"idempotent"` may retry within their original node and
global budgets. Idempotent attempts receive the same `activityKey` and
`idempotencyKey`, which the executor must forward to the external system. An
omitted or `"non-idempotent"` declaration fails closed with
`IN_DOUBT_SIDE_EFFECT` and is not invoked again. A valid terminal resume returns
the recorded result with zero new events and zero executor calls.

This alpha recovery path folds the complete event history. It has no scheduler
checkpoint acceleration, distributed lease/fencing, replay/fork, external
exactly-once guarantee, durable activity ledger, or approval callback. The local
JSONL store coordinates one process; confirm that the former coordinator has
stopped before resume. See the
[durable recovery semantics](../../spec/durable-recovery-semantics.md).

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

Edge `condition`/`map`, JSON Schema I/O validation, streaming edges, scheduler
checkpoint acceleration, distributed workers, and distributed leases are
intentionally scheduled for later alphas. They are not silently emulated in this
package.
