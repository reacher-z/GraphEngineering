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

## Durable local SQLite CycleStore

`SQLiteCycleStoreProvider` is the native Python implementation of the shared
CycleStore provider contract. It uses the standard-library `sqlite3` module and
one dedicated worker-thread-owned connection per adapter instance. The database
is durable and interoperable with `@graph-engineering/sqlite`, but it is scoped
to one host and a local filesystem; SQLite file locks are not distributed
fencing and network filesystems are unsupported.

```python
import asyncio
from pathlib import Path
from tempfile import TemporaryDirectory

from graph_engineering import SQLiteCycleStoreProvider


async def main() -> None:
    with TemporaryDirectory() as root:
        async with SQLiteCycleStoreProvider(Path(root) / "cycle-store.db") as provider:
            descriptor = await provider.describe()
            assert descriptor["providerId"] == "sqlite-local"


asyncio.run(main())
```

Provider calls are async so they compose with the runtime, while complete
SQLite operations execute serially on the connection's dedicated worker.
Cancelling an awaiting task does not prove that its database transaction was
rolled back; retry the exact canonical request with the same `operationId`.
Use the native online `backup()` and manifest-verified `restore_backup()` APIs,
never a raw copy of a live WAL database. The full safety and recovery procedure
is in the [SQLite operator runbook](../docs/SQLITE.md), and a temporary-path
executable example is retained at
[`examples/sqlite/python_quickstart.py`](../examples/sqlite/python_quickstart.py).

## Native Python CLI

Installing the Python distribution provides both `graph` and the compatibility
alias `grapheng`. They are the same native Python entry point: neither command
starts Node.js, delegates to the TypeScript CLI, executes graph nodes, nor calls
a model or provider.

```bash
graph validate graph.json
graph plan graph.yaml
graph compile - --input-format yaml --json
graph visualize graph.json --format mermaid
graph doctor --json
graph init my-graph --dry-run
```

`validate`, `plan`, `compile`, and `visualize` accept strict JSON or the safe
YAML profile described below. `auto` is the default input format: `.json`,
`.yaml`, and `.yml` select their corresponding decoder, case-insensitively. An
unknown or absent file extension fails closed. Standard input (`-`) is always
JSON in `auto`; YAML on stdin requires `--input-format yaml`. Format selection
happens before a file is opened. File and stdin reads stop at the source
decoder's 1 MiB ceiling plus one sentinel byte, so the CLI never buffers an
unbounded source before validation.

`plan` reports compiler-owned topological layers and concurrency without
executing nodes. `compile` returns the canonical Graph IR and SHA-256 in JSON
mode, while its human output stays concise. `visualize` renders deterministic,
read-only Mermaid or Graphviz DOT using generated syntax identifiers and
numeric escaping for caller-controlled label characters. `doctor` performs
only bounded local Python/package/fixture checks. `init` exclusively creates
`graph.json` from the package-owned quickstart template in a new or existing
empty non-symlink directory; it has no force or overwrite mode.

Add `--json` to any command for automation. Machine mode writes exactly one
newline-terminated JSON document to stdout and nothing to stderr:

```json
{"schemaVersion":"graph-engineering.cli/v1alpha1","command":"validate","ok":true,"exitCode":0,"data":{"file":"graph.json","valid":true,"graphName":"example","graphHash":"…","diagnosticCodes":[],"diagnostics":[]},"error":null}
```

The envelope version, command result shapes, source-error projection, and exit
codes match the TypeScript CLI. Invalid Graph IR is command data with
`error: null`; usage, read, and source failures set `data: null` and return a
stable error object. Source errors include `format`, JSON Pointer `path`, and
one-based `line`/`column` when available, without source contents or parser
stacks. Human output renders C0/C1, escape, line-break, bidirectional, and lone
surrogate controls as visible `\u{NNNN}` text.

| Exit | Meaning |
| ---: | --- |
| `0` | command success or healthy doctor |
| `1` | decoded Graph IR rejected by the canonical compiler |
| `2` | usage, read, source, format, or safe-init failure |
| `3` | doctor found an unhealthy local installation |
| `70` | unexpected internal failure |

## Runtime SDK quick start

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

## Safe authoring, builders, and revision-1 identity

`parse_graph_source` accepts explicit `json` or `yaml` input and returns only a
detached portable JSON value. It does not infer a format or silently repair a
graph; pass its result to `compile_graph` for the one canonical validation and
hashing path.

```python
from graph_engineering import compile_graph, parse_graph_source

document = parse_graph_source(
    b"""
    apiVersion: graphengineering.reacher-z.github.io/v1alpha1
    kind: Graph
    metadata: {name: one-node, version: 1.0.0}
    inputSchema: {type: object}
    outputSchema: {type: object}
    entrypoints: [root]
    outputs: {result: {node: root}}
    nodes:
      - id: root
        kind: transform
        inputSchema: {type: object}
        outputSchema: {type: object}
        config: null
    edges: []
    """,
    format="yaml",
)
compiled = compile_graph(document)
```

The YAML v1alpha1 profile is one YAML 1.2 document using only JSON-compatible
mappings, sequences, strings, finite numbers, booleans, and null. It rejects
duplicate keys, directives, tags, anchors, aliases, merge keys, timestamps,
complex keys, non-finite or unsafe numbers, multiple documents, invalid UTF-8,
and sources above 1 MiB, 100 nesting levels, or 100,000 scalar/collection AST
nodes (including mapping-key scalars). `SourceLimits` can lower but never raise
those ceilings. Empty, comment-only, or explicit-end-only YAML decodes to
`None` as one implicit null document; the compiler then reports
`GE1007_INVALID_GRAPH`. Plain YAML
supports decimal, `0o` octal, `0x` hexadecimal, and finite float/exponent
forms; numeric underscores, `0b` tokens, and signed octal/hex tokens remain
strings. `GraphSourceError.to_dict()` exposes
the stable `code`, `format`, redacted `message`, `path`, `line`, and `column`
projection without embedding source contents.

The cross-parser profile also fails closed on three host-specific ambiguities:
quoted continuations nested in a block collection must remain indented; a plain
key inside a flow collection requires whitespace after its `:` (`{a:[]}` is
rejected while `{"a":[]}` is valid); and comments after quoted or flow values
require separation (`"x"#c` is rejected while `"x" #c` is valid). A `#`
without preceding whitespace inside an ordinary plain scalar remains data.

Use `graph_builder` when authoring in Python. Every constructor and `add_*`
boundary immediately snapshots its input; node and edge declaration order is
preserved, and roots, public outputs, and IDs are never inferred.

```python
from graph_engineering import graph_builder

built = (
    graph_builder(
        metadata={"name": "one-node", "version": "1.0.0"},
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    .add_node(
        {
            "id": "root",
            "kind": "transform",
            "inputSchema": {"type": "object"},
            "outputSchema": {"type": "object"},
            "config": None,
        }
    )
    .add_entrypoint("root")
    .add_output("result", {"node": "root"})
    .build()
)

assert built.graph_hash == built.identity.graph_hash
assert built.identity.graph_revision == 1
```

A successful build seals the builder. `built.graph` returns a fresh validated
copy on every access, while canonical text, graph hash, domain-separated
node/edge/schema hashes, and revision hash stay bound to the private snapshot.
Duplicate authoring values and post-build writes raise `GraphBuilderError` with
stable `GE_BUILDER_*` codes. Canonical compiler rejection retains every original
diagnostic rather than returning a partial graph or `None`.

Strict typed ports are opt-in through `enable_strict_typed_ports()`. The
v1alpha1 profile meta-validates Draft 2020-12 schemas, accepts an absent
`$schema` or the exact `https://json-schema.org/draft/2020-12/schema` dialect,
rejects every `pattern`/`patternProperties` keyword at any depth, empty `enum`
arrays, and all `$ref`/`$dynamicRef` uses without attempting resolution. Regex
schemas require a later profile with one cross-language grammar. The current
profile requires explicit required
object properties at bindings (including valid boolean subschemas), and uses
canonical-exact schema equality—there is no unproved widening or assignability.
Compiler diagnostics are `GE1201` through `GE1208`. Initial identity verification
uses `GE1301` through `GE1303` for unsupported revisions, graph hash mismatch,
and component/order/schema mismatch. Portable JSON number normalization accepts
an integral `graphRevision` value of `1.0` as revision 1, while booleans remain
invalid. Revision 2+, `GraphPatch`, and runtime
lowering for stream or artifact-ref edges are intentionally not implemented by
this authoring slice.

## Bounded standalone pipelines

`run_pipeline` moves each accepted item through the same ordered stages without
waiting for every item to finish one stage before the next stage starts. Source
intake, stage queues, stage concurrency, per-item attempts, and the total item
count are all bounded.

```python
from graph_engineering import PipelineStage, run_pipeline

source_items = ["a", "b", "c"]


async def enrich(context):
    return {"value": context.input, "enriched": True}


async def run_items():
    async with run_pipeline(
        source_items,
        [PipelineStage("enrich", enrich, concurrency=4)],
        buffer_capacity=8,
        max_in_flight=16,
        max_items=1_000,
    ) as run:
        results = [item async for item in run]
        summary = await run.completion()
    return results, summary
```

The source is not advanced until the first read or async-context entry. The
runtime acquires an in-flight credit before every source pull and releases it
only when the consumer receives that item's terminal record, so a slow consumer
eventually stops source intake. Results are structured as `succeeded`, `failed`,
`dropped`, or `cancelled`; JSON `None` remains distinct from an absent input or
output in `to_dict()` projections. Stage policies are `dead-letter`, `drop`, and
`stop`, and retries and timeouts are bounded and cooperatively cancellable.

Stage configuration is also synchronously bounded. `max_stages` defaults to
`2048`, which is also the hard protocol maximum. The factory accepts a finite
sequence with exactly that budget, but inspects at most `max_stages + 1` entries
and raises `ValueError` if another stage is present. Overflow is rejected before
the extra stage's properties or the item source are accessed; callers may set a
smaller positive `max_stages` budget for untrusted configuration.

This primitive is in-memory and standalone. It does not activate Graph IR
`edge.mode: "stream"`, persist item queues, or provide item-level crash recovery.
When called inside a durable graph node, the complete pipeline is part of that
single node attempt and external effects remain at-least-once. See the canonical
contract in [`spec/pipeline-semantics.md`](../spec/pipeline-semantics.md).

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

The native scheduler uses this primitive for a `router` node without an
override handler: the bound node input is the request and `node.config` is the
policy. It executes the fixed versioned `RouteEquals` annotation emitted by the
TypeScript patterns package. Unselected branches settle with
`ROUTE_NOT_SELECTED` and zero attempts, inactive-only descendants stay inactive,
and joins bind only active inputs. A custom router result is accepted only when
its exact eight-field decision can be recomputed from the request evidence and
policy; durable resume repeats that integrity check.

This is an alpha conditional-routing slice. Compiler exhaustiveness/default
diagnostics, dedicated `RouteSelected` events, arbitrary condition expressions,
and scheduler-integrated quorum/deadline barriers remain follow-up work.

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
integers because checkpoint v1alpha1 deliberately retains this stricter number
domain. Graph IR's cross-language finite-binary64 formatter does not widen the
checkpoint schema; tagged Durable JSON separately preserves runtime doubles by
their exact bits.

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

## Native bounded cycles and GraphPatch

The standalone D7 controller executes the closed
`cycle-controllers/v1alpha1` request contract natively in Python. It supports
`until-dry`, bounded `while`, and evaluator-optimizer modes; a global seen set;
inclusive duration, cost, attempt, discovery, iteration, and dynamic-node
limits; runtime-derived activity charging; durable retries; cancellation; and
optional GraphPatch planning. The request—not handler output—binds activity
identity, side-effect class, retry ceiling, timeout, and maximum per-attempt
cost.

```python
from graph_engineering import CycleHandlers, MemoryCycleStore, start_cycle

store = MemoryCycleStore()  # deterministic local/test adapter only
result = await start_cycle(
    request_document,
    CycleHandlers(
        finder=find_candidates,
        candidate_evaluator=evaluate_fresh_candidates,
    ),
    store=store,
    lease=lease_claim,
    checkpoint_every_events=1,  # optional portable latest-checkpoint schedule
)
```

Every activity is claimed by `ActivityStarted` before caller code. A complete
candidate event is validated by folding the prospective full event prefix
before its CAS append. Successful output, failure, timeout, cancellation, and
in-doubt recovery all settle the request-bound reservation exactly; invalid
finder/evaluator/planner output cannot become a `None` result or release
downstream work. `none` work may retry, `idempotent` work retries with one stable
key, and an interrupted `non-idempotent` claim blocks resume/fork with
`IN_DOUBT_SIDE_EFFECT` before a new lease or automatic reinvocation.

`resume_cycle` validates the complete history, exact request/controller hashes,
and a strictly higher lease fence before dispatch. `replay_cycle` folds either
a terminal stream or an explicitly requested prefix without consulting a
clock, handler, compiler plugin, authority service, or random source.
`renew_cycle_lease` preserves lease ID, holder, epoch, fencing token, and
acquisition instant while strictly extending expiry. `pause_cycle` records a
voluntary `paused` or `handoff` release. Both are exact-version, zero-handler
operations and write a verified `{controllerRunId}-latest` acceleration
checkpoint after the authoritative event. Concurrent administrators produce
one CAS winner; every loser returns `GE_CYCLE_VERSION_CONFLICT` without a
second event. `fork_cycle` binds an exact parent
sequence and history hash, copies only the event-derived revision, seen/verdict
categories, committed rounds, counters, decided patch IDs, and in-doubt status,
and gives the child an independent stream and lease.

Multi-generation ancestry and portable support replay use the closed lineage
manifest API:

```python
from graph_engineering import (
    export_cycle_lineage_manifest,
    replay_cycle_lineage_manifest,
)

manifest = await export_cycle_lineage_manifest(
    child_request["eventStreamId"],
    store=store,
)
offline = replay_cycle_lineage_manifest(manifest)
assert offline.target.request.model.controller_run_id == child_request["controllerRunId"]
```

The exporter recursively resolves every ancestor through
`read_by_controller_run_id`. It binds controller/run/host/stream identity,
sequence, record and prefix hashes, request/controller hashes, and complete
event bytes under one domain-separated manifest hash. Fixed v1alpha1 bounds are
32 parent edges, 33 streams, 1,024 total events, and 16 MiB canonical JSON.
Offline replay performs no store, lease, clock, handler, plugin, or network
operation. Missing, duplicate, cyclic, reordered, truncated, corrupt, or
substituted ancestry fails with `GE_CYCLE_INVALID_HISTORY` even if an attacker
recomputes the outer manifest hash.

`pause_cycle` and `replay_cycle` accept a `CycleCancellation`, as do resume and
fork. Before an operation's durable commit, cancellation raises stable
`GE_CYCLE_OPERATION_CANCELLED` with exact `operation` and `boundary` details
and writes nothing. After resume lease acquisition, the controller durably
terminates `CANCELLED`; after creation of a dispatchable fork child, the child
receives its lease and cancelled terminal. A committed pause or a
completed result wins over cancellation observed at return. A resume prefix
with an open round is recovery debt: it is settled under a new lease without
handler dispatch even when cancellation was already set.

`GraphPatchRuntime` snapshots exact portable patch bytes, gates the requested
base, IDs, current execution state, authority/capabilities, graph compilation,
graph size/depth/fan-out, reserved structural capacity, and the cumulative
`max_dynamic_nodes` lineage ceiling under one local CAS decision lock. A
non-dry decision is recorded before a new revision becomes visible. Recovery
recompiles every stored accepted patch, restores the committed dynamic-node
count, and reconstructs both accepted and rejected decisions with their
complete authority, policy, budget, diagnostic, and revision evidence.

The retained
[`graph-patch-hostile-shape.case.json`](../spec/conformance/graph-patch-hostile-shape.case.json)
campaign independently reconstructs 54 hostile patch inputs in Python and
TypeScript. It covers closed root/base/append/node/edge/output shapes plus the
100-level and 4 MiB portable-capture ceilings. Every input fails with
`GE_PATCH_INVALID` before a decision or graph mutation, and the native reports
compare exact input lengths and hashes. This is the H05A shape boundary; the
schema-valid semantic attack corpus remains a separate decision boundary.

The retained
[`graph-patch-hostile-semantic.case.json`](../spec/conformance/graph-patch-hostile-semantic.case.json)
campaign executes that H05B boundary as 19 semantic rejections plus five
stateful idempotency/CAS behaviors. Python and TypeScript independently agree
on canonical patch hashes, stable error codes, authority and policy hashes,
budget outcomes, resulting coordinates, decision counts, and dynamic-node
projections across all 24 cases.

`MemoryCycleStore` is deliberately process-local and has neither crash
durability nor distributed fencing. It exists for deterministic tests and
examples. The repository's executable TypeScript ↔ Python D7 join compares
canonical activity inputs, events, results, accepted GraphPatch revisions, and
checkpoints. It also executes and compares 100 lease-administration fault
recoveries: both lease renewal and voluntary release crossed with all ten
applicable durable stages and all five retained fault kinds. Every run checks
the committed prefix, checkpoint durability, stale-version/stale-fence zero
writes, exactly one target event, one safe handler dispatch, read-only replay,
and terminal-resume zero writes.

### Provider-neutral CycleStore contract

Production adapters implement `CycleStoreProvider`. The independent
`MemoryCycleStoreProvider` is a deterministic executable oracle for exact tail
hash CAS, tenant-scoped operation idempotency, snapshot pagination, disposable
checkpoints, provider-clock leases, fencing, governance, and migration
exclusion.

```python
from graph_engineering import MemoryCycleStoreProvider, create_cycle_store_record

provider = MemoryCycleStoreProvider()  # process-local, non-durable oracle
record = create_cycle_store_record(
    record_id="controller-created-0",
    sequence=0,
    previous_record_hash=None,
    value=protected_event_carrier,
)
committed = await provider.append(
    {
        "context": {
            "tenantId": "tenant-a",
            "principalHash": principal_hash,
            "authorizationHash": authorization_hash,
            "operationId": "controller-create-op",
        },
        "streamId": "controller.events",
        "expectedTail": {"exists": False, "sequence": -1, "recordHash": None},
        "lease": None,
        "records": [record],
    }
)
```

The provider captures before its first await and returns detached values. Exact
mutation retries are answered before current CAS, lease-expiry, or migration
checks. `MemoryCycleStoreProvider` truthfully declares process-local durability
and no distributed fencing; SQLite/PostgreSQL claims require separate crash,
transaction, takeover, failover, backup, and restore evidence. The normative
[CycleStore provider semantics](../spec/cycle-store-provider-semantics.md)
describe the adapter rules and 54-case cross-language gate.

`build_cycle_operation_interruption_matrix()` derives the 25-row H03B public
operation lattice (pause 6, resume 6, replay 4, fork 9). The native join executes
every boundary and compares exact stream bytes and record hashes, appended
events, structured errors, results, handler counts, fork parent prefixes, and
pause checkpoints with TypeScript.

The retained H03C campaign executes another 35 `PatchAccepted` visibility
faults: seven stages from before event construction through after state update
crossed with five fault kinds. All 20 pre-commit rows reuse the same activity
key and permit only the idempotent planner to run again; all 15 committed rows
restore revision 2 from stored patch bytes without planner reinvocation. Each
row proves one accepted decision, one settlement, one round commit, read-only
replay, and zero-work terminal resume, then compares complete Python and
TypeScript events, hashes, result, and checkpoint. Checkpoint-stage combinations
are covered by the H03D campaign: all three `PatchAccepted` checkpoint
boundaries crossed with five fault kinds. At the two pre-save boundaries, the
latest cache remains one valid event behind; after save it names the exact
accepted patch. Recovery always trusts the event stream, restores revision 2
without reinvoking the planner, and ends with the terminal `-latest` checkpoint.
The native reports compare checkpoint lag and write count as well as complete
events, record hashes, result, and final stored checkpoint.

Pass a nonnegative safe integer as `checkpoint_every_events` to select the same
schedule as TypeScript `checkpointEveryEvents`: zero writes only the terminal
latest checkpoint, while a positive value writes on matching event counts and
again at terminal completion. Omitting the Python option preserves the existing
named round/terminal convenience checkpoints.

`build_cycle_durable_fault_matrix()` derives 855 obligations over 17 event
types, 11 durable stages, and five fault classes. Pass a deterministic
`fault_hook` to `start_cycle`/`resume_cycle` for controller boundaries or to
`MemoryCycleStore` for the before-commit and commit-then-throw boundaries:

```python
from graph_engineering import MemoryCycleStore, build_cycle_durable_fault_matrix

matrix = build_cycle_durable_fault_matrix()

def lose_after_commit(boundary: str) -> None:
    if boundary == "store:event:DiscoveryCommitted:after-commit-before-return":
        raise ProcessLost

store = MemoryCycleStore(fault_hook=lose_after_commit)
```

The cross-language join compares every generated entry and its retained
canonical hash. Production storage/lock adapters, exhaustive execution of all
event-family scenarios, and independent acceptance remain separate
deliverables.

## Current boundary

This alpha deliberately focuses on deterministic DAG compilation and
execution. It includes bounded concurrency, retry/backoff, per-attempt timeout,
a graph-wide attempt budget, named source/input/output port binding, and
event-sourced durable continuation, plus the separate bounded-cycle/GraphPatch
surface described above. Edge `map` and `condition`, runtime JSON Schema
validation, streams, checkpoint acceleration, dynamic mutation of the ordinary
DAG scheduler, production cycle stores, distributed leases, non-idempotent
recovery approval, and production provider adapters remain follow-up work. Accepted
non-integer finite binary64 Graph IR values now
have stable TypeScript/Python bytes and hashes through ECMAScript's
shortest-round-trip number serialization, including `-0` normalization and the
`1e-6`/`1e21` fixed/scientific thresholds. The shared RFC 8785 Appendix B and
seeded bit-pattern corpus tests this number rule, not full JCS: Graph IR keys
continue to sort by Unicode code point. Tagged Durable JSON remains a separate
exact-bit persistence protocol.
