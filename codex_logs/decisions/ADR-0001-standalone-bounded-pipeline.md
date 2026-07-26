# ADR-0001: Ship the first bounded pipeline as a standalone runtime primitive

- Status: accepted for v1alpha1 implementation
- Date: 2026-07-26
- Owners: main, TypeScript runtime, Python runtime
- Canonical contract: `spec/pipeline-semantics.md`

## Context

Graph IR already reserves `edge.mode: "stream"`, but both native graph
schedulers currently execute one node once and retain one portable JSON
`NodeResult` per node. Durable history identifies attempts by run and node, and
`EdgeEmitted` records one value-edge marker after node success. It has no item
identity, item offset, acknowledgement, queue state, window/join policy, or
per-item attempt history.

Directly interpreting a stream edge would therefore change node readiness,
input/output contracts, attempt and budget accounting, graph outputs, fan-in,
event folding, crash recovery, and replay at once. Treating an async iterator as
an ordinary node JSON value would instead be a false implementation: it is not
portable, hashable, recoverable, or safely replayable.

The Day-5 plan still needs an executable pipeline in which independent items
occupy different stages concurrently, slow consumers exert source backpressure,
buffers stay bounded, retries stop, and failures remain structured.

## Decision

The first implementation is a standalone, in-memory `runPipeline` /
`run_pipeline` primitive shared by the TypeScript and Python runtime packages.
It has:

- a synchronous factory and single-pass asynchronous result iterator;
- synchronous or asynchronous sources;
- immutable ordered stage contracts;
- bounded stage queues and a bounded global in-flight credit window;
- a hard item admission limit and statically bounded maximum attempts;
- input-order or completion-order terminal delivery;
- bounded deterministic retries and attempt timeouts;
- explicit stop, drop, and dead-letter policies;
- structured item and run failures rather than `null` placeholders;
- cooperative cancellation, explicit close, and task/listener cleanup; and
- shared cross-language fixtures and a normative protocol document.

The primitive does not activate `edge.mode: "stream"` and does not claim
item-level durability. When called inside a graph node, the entire pipeline is
part of that node attempt and can be replayed as a unit under existing recovery
rules.

## Safety and resource decisions

The source cannot be pulled until an in-flight credit is available. Credit is
released only when a terminal result reaches the consumer. This makes consumer
pressure propagate to the source rather than hiding an unbounded result list.

`maxItems` defaults to a finite value and is checked before each source pull.
The product of `maxItems` and the sum of per-stage attempt bounds must be a safe
integer. Infinite or adversarial sources consequently have bounded work even
when callers forget to cancel.

Input ordering applies only to terminal delivery. Internal stage flow remains
completion-driven so a fast later item can enter a downstream stage while a slow
earlier item is still upstream. The reorder buffer remains bounded by the
in-flight window.

Retries are at-least-once and require idempotent external effects. Timeout and
cancellation can detach non-cooperative user code after observing its eventual
outcome; they cannot revoke an external side effect already initiated.

## Consequences

This delivers useful pipeline/backpressure semantics without destabilizing the
ordinary or durable DAG scheduler. It also creates a precise test bed for future
stream-edge work.

The tradeoff is that a standalone pipeline is not yet a first-class graph edge,
cannot be checkpointed per item, and does not support stream joins, windows,
materializing barriers, replay, or fork. Documentation must keep that boundary
visible.

## Required follow-up before Graph IR stream lowering

1. Add portable item identity and ordinal rules.
2. Specify per-edge enqueue, consume, acknowledgement, and offset events.
3. Define crash reconstruction for bounded queues and in-flight handlers.
4. Define value/stream fan-in: merge, zip, window, and materializing barrier.
5. Bind per-item attempts, budgets, idempotency keys, and external effects.
6. Define stream graph outputs, cancellation, replay, fork, and schema evolution.
7. Add cross-process leases/fencing before distributed workers advance a stream.

Until those contracts exist and pass cross-language crash conformance,
`edge.mode: "stream"` remains declarative only.
