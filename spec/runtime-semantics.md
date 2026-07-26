# Runtime semantics v1alpha1

This document fixes the observable rules that native runtimes must share. A
runtime can add internal events or implementation details, but it cannot weaken
these rules.

## Run states

```text
created -> running -> succeeded
                   -> failed
                   -> cancelled
          running -> paused -> running
```

Terminal run states are `succeeded`, `failed`, and `cancelled`. A terminal run
cannot return to running. Resume continues a non-terminal history; replay and
fork create a new, linked history.

## Node states

```text
pending -> scheduled -> running -> succeeded
                                -> retry-wait -> scheduled
                                -> failed
                                -> cancelled
pending/scheduled -> cancelled
```

A node can be scheduled only after every required incoming dependency is
satisfied. A node succeeds only after its output passes validation and is
durably recorded. Retries create new attempts under the same logical node.

## Readiness and ordering

- Nodes named by `entrypoints` are initially ready. Multiple entrypoints are
  first-class and express independent roots that consume graph input.
- An entrypoint cannot have an incoming edge; the compiler reports
  `GE1010_ENTRYPOINT_HAS_INCOMING` instead of ambiguously choosing between graph
  input and an upstream value.
- Every node must be reachable from at least one entrypoint. A zero-indegree
  node omitted from `entrypoints` is unreachable and invalid.
- When multiple nodes become ready, their deterministic scheduling order is the
  order in `GraphSpec.nodes`; concurrency may change completion order.
- The scheduler uses a ready queue, not implicit topological-layer barriers. A
  node starts as soon as all of its own dependencies are satisfied and a
  concurrency slot is available; an unrelated slow sibling cannot block it.
- `maxConcurrency` limits running node attempts, not completed or waiting nodes.
- An edge is emitted only from a successful producer unless it is explicitly a
  failure-policy edge in a later protocol revision.
- A downstream node with multiple required inputs waits for all of them unless
  its barrier policy specifies another threshold.
- Graph results are assembled from the named `outputs` endpoint bindings after
  all referenced output nodes succeed.
- A graph output endpoint with `port` selects that property from the node output;
  a missing property is a structured output-binding failure.

## Input binding

- An entrypoint with no incoming edges receives the raw graph input.
- Every non-entry node receives a mapping, even when it has exactly one incoming
  edge. The key is `edge.to.port` when present, otherwise the source node ID.
- `edge.from.port` selects a property from the source output before binding.
- Two edges cannot bind the same input key unless a future, explicit reducer
  contract permits it; v1alpha1 treats the collision as a structured failure.

## Results and failures

Failures are structured and retain stable code, message, retryability, attempt,
and optional cause metadata. Partial and quorum modes expose every settled item;
they never represent a failed item as null. Cancellation is distinct from
failure and propagates through an abort/cancellation signal.

## Persistence

Events receive a monotonically increasing sequence per run. Appends use an
expected prior sequence/version. A validated node result is persisted before
dependents become schedulable. Resume reconstructs state from durable history
and cannot rerun a successful node unless a new replay/fork history requests it.

## Determinism boundary

Graph orchestration, mappings, readiness, route application, and tie-breaking
are deterministic. Time, random values, generated IDs, model responses, tool
responses, and external I/O enter through recorded runtime activities. Replay
reads their recorded results instead of performing them again.
