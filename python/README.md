# Graph Engineering for Python

The Python alpha is a typed implementation of the shared Graph Engineering
IR. It validates graph contracts, emits stable cross-language diagnostics,
produces canonical SHA-256 graph hashes, and executes acyclic graphs with
bounded `asyncio` concurrency.

Requires Python 3.11 or newer.

## Quick start

```bash
cd python
uv sync --extra dev
uv run pytest
```

```python
import asyncio
import json
from pathlib import Path

from graph_engineering import NodeContext, compile_graph, run_graph

document = json.loads(Path("../spec/conformance/diamond.graph.json").read_text())
graph = compile_graph(document)


async def passthrough(context: NodeContext):
    if context.node.id == "split":
        return context.graph_input
    if context.node.id == "merge":
        return dict(context.inputs)
    return {"branch": context.node.id}


result = asyncio.run(run_graph(graph, {"query": "hello"}, {"*": passthrough}))
assert result.succeeded
print(dict(result.outputs))
```

Handlers are resolved by node ID, then node kind, then the `"*"` fallback.
Every handler receives only explicit graph input, incoming edge values, and a
read-only snapshot of completed values. A failure is returned as a typed
`NodeFailure`; independent siblings finish, while descendants are marked
`UPSTREAM_FAILED`.

## Settled barrier primitive

`evaluate_settled_barrier` is a deterministic, model-free decision primitive
for work that has already reached a terminal status:

```python
from graph_engineering import evaluate_settled_barrier

barrier = evaluate_settled_barrier(
    [
        {"id": "research", "status": "succeeded", "value": {"findings": 3}},
        {"id": "security", "status": "timed_out"},
    ],
    {"kind": "minimum", "minimum": 1},
)

assert barrier.satisfied
assert barrier.accepted_ids == ("research",)
assert barrier.to_dict()["reasonCode"] == "MINIMUM_MET"
```

Items use the exact fields `id`, `status`, and—only for `succeeded`—`value`.
Statuses are `succeeded`, `failed`, `missing`, or `timed_out`. IDs use the
persistence-safe ASCII identifier contract and must be unique. Successful
values use the portable runtime JSON boundary described below.

Policies are exact objects: `{"kind": "all"}`; `{"kind": "minimum",
"minimum": n}`; or `{"kind": "percentage", "basisPoints": n}`. Percentage
evaluation uses integer cross multiplication, never a floating-point ratio.
Integer wire fields follow JavaScript mathematical-integer semantics: exact
built-in values such as `1.0` are accepted and normalized to Python `int`,
while booleans, subclasses, fractional values, `NaN`, and infinities are
rejected.
Empty input returns `NO_ITEMS`, and an impossible but valid minimum returns
`MINIMUM_EXCEEDS_TOTAL`.

Results are frozen dataclasses whose ID collections are tuples and preserve
item declaration order. `to_dict()`, `to_json()`, and `to_json_bytes()` export
the exact camelCase TypeScript record in fixed field order, using fresh mutable
containers. Invalid inputs raise `PrimitiveValidationError` with immutable,
ordered `(path, code, message)` issues and the stable code
`PRIMITIVE_VALIDATION`; the same three export methods produce its exact wire
record.

## Route selection primitive

`evaluate_route_selection` converts an untrusted route request into deterministic
control flow without calling a model:

```python
from graph_engineering import evaluate_route_selection

selection = evaluate_route_selection(
    {"requestedRoutes": ["security"], "confidenceBasisPoints": 8200},
    {
        "kind": "single",
        "allowedRoutes": ["quick", "security", "human"],
        "defaultRoute": "human",
        "confidence": {
            "minimumBasisPoints": 7000,
            "escalationRoute": "human",
        },
    },
)

assert selection.routed
assert selection.selected_routes == ("security",)
```

Requests and policies are closed objects. Requested and allowed routes are
unique safe IDs. A `multi` policy requires `maxMulticast` between one and the
number of allowed routes; a `single` policy forbids that field. Defaults and
confidence escalation routes must be declared in `allowedRoutes`. Request
confidence and the policy confidence gate must either both be present or both
be absent.

All numeric route fields use the same mathematical-integer rule; for example,
`1.0` normalizes to `1` and signed floating-point zero normalizes to integer
zero in the result.

Decision priority is fixed: validate and snapshot; low-confidence escalation;
empty-request handling; single or multicast count violations; whole-request
unknown-route handling; then canonical selection in `allowedRoutes` declaration
order. Thus a default never hides a count violation, while low-confidence
escalation intentionally takes precedence over count and unknown-route checks.

`RouteSelectionResult` is frozen and stores route lists as tuples. Its
`to_dict()`, `to_json()`, and `to_json_bytes()` exports use the exact ordered
camelCase TypeScript shape and fresh containers. Validation uses the shared
`PrimitiveValidationError` envelope with the route-specific message
`Route selection input is invalid`.

## Portable runtime JSON

Graph input, bound node input, every retry attempt, and executor output cross a
detached portable-JSON boundary. The runtime accepts `None`, built-in strings
and booleans, integers in JavaScript's safe range `±(2^53-1)`, finite floats
(with the same safe-range rule when the float is integer-valued), and built-in
lists and dictionaries whose keys are built-in strings.

Integer-valued floats are normalized to Python integers at this boundary, as
JavaScript JSON has a single number type; this includes normalizing `-0.0` to
`0`. Finite non-integer floats remain floats.

Cycles, `NaN`, infinities, unsafe integers, tuples, sets, class instances, and
custom list or dictionary subclasses are rejected. Reusing the same container
in two non-cyclic locations is valid; each location becomes an independent
copy because reference identity is not part of JSON. Invalid graph input raises
`TypeError`. Invalid executor output produces a retryable `INVALID_OUTPUT` node
failure according to the node's retry policy.

Snapshots isolate mutations across boundaries. Changing the caller's input
after a run starts cannot change node input, a failed attempt cannot contaminate
its retry, and one branch cannot mutate an upstream result or a sibling's
input. Successful `NodeResult` values and graph outputs are also detached from
the object originally returned by the executor.

## Cooperative cancellation

Pass a caller-owned `asyncio.Event` to `run_graph`. Each `NodeContext` receives
a read-only `cancel_signal` with `cancelled`, `is_set()`, and `wait()`; it does
not expose `set()`.

```python
async def cancellable(context: NodeContext):
    await context.cancel_signal.wait()
    return {"observedCancellation": True}


async def cancel_example():
    cancel_event = asyncio.Event()
    task = asyncio.create_task(
        run_graph(graph, {}, {"*": cancellable}, cancel_event=cancel_event)
    )
    cancel_event.set()
    result = await task
    assert result.status == "cancelled"
```

Cancellation wakes handlers, semaphore waiters, and retry delays without
polling. Already successful nodes stay successful. A running node becomes
`failed/NODE_CANCELLED`; work that has not started becomes
`skipped/NODE_CANCELLED`. Ordinary node failure never sets the run's
cancellation event and does not stop independent branches.

Python cannot safely preempt a synchronous handler. A synchronous handler runs
until it returns or raises and can block the event loop; use async handlers and
cooperative awaits for cancellable work. Moving blocking work to a thread keeps
the loop responsive but still cannot forcibly terminate that thread. Set the
event from its owning event loop, or use `loop.call_soon_threadsafe` when the
request originates in another thread.

## Local durable storage

`GraphEvent` validates the shared v1alpha1 event envelope. `MemoryEventStore`
and `JsonlEventStore` implement the same optimistic concurrency contract:
an empty stream has version `-1`, `expected_version` is the last committed
sequence, and appended event sequences must be contiguous.

```python
from graph_engineering import GraphEvent
from graph_engineering.persistence import JsonlEventStore

store = JsonlEventStore(".graph-engineering")
event = GraphEvent.model_validate({
    "apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1",
    "eventId": "event-1",
    "type": "RunCreated",
    "timestamp": "2026-07-26T00:00:00Z",
    "runId": "run-1",
    "graphRevision": 1,
    "sequence": 0,
    "data": {},
})
new_version = asyncio.run(store.append("run-1", -1, (event,)))
assert new_version == 0
```

The JSONL store uses opaque hashed filenames, a per-run `asyncio` lock, one
append followed by `flush` and `fsync`, and strict restart-time corruption and
truncation checks. `FileCheckpointStore` writes content-hashed checkpoint
envelopes through a same-directory temporary file, fsyncs it, atomically
replaces the destination, then fsyncs the directory. Checkpoint lists are
ordered by `(sequence, checkpointId)`.

Checkpoint hash inputs intentionally permit only booleans, strings, null,
containers, and integers in JavaScript's safe range `±(2^53-1)`. Floating-point
or decimal values must be encoded as strings or application-defined scaled
integers until the protocol adopts a cross-language number canonicalization
standard.

These file stores coordinate store instances in one process and event loop by
absolute storage path. They do not provide cross-process locks or distributed
writer leases. SQLite, PostgreSQL, object storage, compaction, and
multi-process coordination remain follow-up adapters.

## Durable start and resume

`start_graph_run` creates a new event-sourced run, while `resume_graph_run`
continues an existing non-terminal history. The operations never silently
substitute for one another. Resume reads the original input from `RunCreated`,
checks the graph and caller-supplied implementation identity, and reuses every
committed successful node.

```python
from graph_engineering import resume_graph_run, start_graph_run
from graph_engineering.persistence import JsonlEventStore

store = JsonlEventStore(".graph-engineering")
result = await start_graph_run(
    graph,
    {"seed": 1},
    handlers,
    run_id="research-001",
    implementation_id="research-handlers@1",
    event_store=store,
)

# In a later process, after confirming the old coordinator has stopped:
result = await resume_graph_run(
    graph,
    handlers,
    run_id="research-001",
    implementation_id="research-handlers@1",
    event_store=store,
)
```

The durable journal commits `NodeScheduled` and `NodeStarted` before calling a
handler. It commits a validated `NodeSucceeded` together with its ordered
`EdgeEmitted` events before releasing dependants. An interrupted attempt remains
charged to both retry budgets. Nodes declared `sideEffects: none` or
`sideEffects: idempotent` can retry; the latter receives the same
`NodeContext.idempotency_key` on every attempt. An omitted or non-idempotent
declaration fails closed with `IN_DOUBT_SIDE_EFFECT` and is not invoked again.

Inputs, outputs, implementation IDs, and terminal results use tagged Durable
JSON. Non-integer finite doubles are encoded from their exact IEEE-754 bits, so
hashes do not depend on Python or JavaScript decimal rendering. The public
`encode_durable_json`, `decode_durable_json`, and `durable_json_hash` helpers
implement the shared conformance corpus.

Terminal resume is idempotent: it returns the recorded result without an event,
checkpoint write, or handler call. CAS detects a losing continuation but is not
a distributed lease. Applications must stop the old coordinator before resume,
forward idempotency keys to remote systems, and reconcile ambiguous external
effects. Scheduler checkpoint acceleration and explicit non-idempotent approval
callbacks are not implemented in this slice; correctness comes from replaying
the complete event stream.

## Current boundary

This alpha deliberately focuses on deterministic DAG compilation and
execution. It includes bounded concurrency, retry/backoff, per-attempt timeout,
a graph-wide attempt budget, named source/input/output port binding, and
event-sourced durable continuation. Edge `map` and `condition`, runtime JSON
Schema validation, streams, checkpoint acceleration, dynamic graph patches,
distributed leases, non-idempotent recovery approval, and provider adapters
remain follow-up work. Floating-point Graph IR canonicalization is not stable
until the shared protocol adopts RFC 8785.
