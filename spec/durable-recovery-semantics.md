# Durable scheduler recovery semantics v1alpha1

This document freezes the first scheduler-integrated recovery contract shared
by the TypeScript and Python runtimes. It covers continuation of one immutable,
compiled DAG after process loss. It does not define replay, fork, dynamic graph
patches, explicit cycles, streaming edges, distributed leases, or exactly-once
external effects.

The append-only `EventStore` is the source of truth. A checkpoint is only a
rebuildable projection cache and cannot authorize work by itself.

## Public operations

Each runtime exposes separate start and resume operations. Start requires a
graph, graph input, a safe `runId`, a non-empty caller-supplied
`implementationId`, an event store, and executors. Resume requires the same
graph, `runId`, `implementationId`, event store, and executors, but reads the
original graph input from `RunCreated`.

- Start fails with `RUN_ALREADY_EXISTS` when the stream is non-empty.
- Resume fails with `RUN_NOT_FOUND` when the stream is empty.
- Start never silently resumes, and resume never silently creates a run.
- The existing in-memory scheduler API and behavior remain unchanged.
- Durable operational errors are typed, structured errors with a stable code,
  `runId`, message, and optional details. Graph execution failures remain normal
  structured graph results and terminal events.

`implementationId` is a caller assertion about the executor set. The runtime
stores only its tagged Durable JSON SHA-256 as `implementationHash`. This prevents an
accidental resume under a differently declared implementation; it cannot prove
that a caller labeled changed code honestly.

## Bound identity

`RunCreated` binds the run to all of the following:

- `graphRevision`, fixed to `1` in this contract;
- the compiler's canonical `graphHash`;
- `inputHash`, the Durable JSON SHA-256 of the detached graph input;
- `implementationHash`, the Durable JSON SHA-256 of `implementationId`;
- the detached original input itself;
- the effective `maxTotalAttempts` value.

Resume recompiles a detached graph snapshot and validates every bound value
before it appends an event or invokes an executor. A mismatch produces
`GRAPH_HASH_MISMATCH`, `INPUT_HASH_MISMATCH`, or `IMPLEMENTATION_MISMATCH` as
applicable. Because resume reads the original input from history, its public API
does not accept replacement input.

The durable payload boundary accepts the same portable finite JSON values as the
runtime. To preserve every finite binary64 value without relying on
language-specific decimal rendering, persisted inputs, outputs, result
snapshots, and their hashes use the tagged Durable JSON encoding below. NaN,
infinities, unsafe integers, sparse arrays, non-JSON objects, and cycles remain
invalid.

## Tagged Durable JSON

The encoding is a JSON array whose first item is a one-character tag:

```text
null               => ["n"]
boolean            => ["b", true]
string             => ["s", "text"]
safe integer       => ["i", 42]
finite non-integer => ["f", "3ff8000000000000"]
array              => ["a", [<encoded item>, ...]]
object             => ["o", [["key", <encoded value>], ...]]
```

The `f` payload is exactly sixteen lowercase hexadecimal digits containing the
IEEE-754 binary64 bits in big-endian byte order. Object entries are sorted by
Unicode code point and duplicate normalized keys are invalid. Integer-valued
doubles and negative zero normalize to their safe-integer form, matching the
runtime JSON boundary. Decoders reject unknown tags, wrong arity, unsorted or
duplicate object keys, non-safe `i` payloads, and `f` payloads that decode to a
non-finite or integer-valued value.

`inputHash`, `outputHash`, implementation hashes, activity keys, and result
hashes are lowercase SHA-256 of canonical UTF-8 JSON for the tagged value. The
tagged representation itself contains no floating-point number and can be
stored directly inside a v1alpha1 checkpoint.

## Event integrity and stream rules

Every scheduler-written event conforms to `event.schema.json` and has:

- `graphRevision: 1`;
- the run's exact `runId`;
- the next contiguous sequence;
- `payloadHash` equal to lowercase SHA-256 of canonical JSON for `data`;
- a non-empty event ID that is unique within the run and a strict, real-calendar
  RFC 3339 timestamp. Years are `0001` through `9999`; year `0000`, impossible
  calendar dates, leap seconds, and offsets outside `00:00` through `23:59`
  are invalid.

The default event ID may be deterministic from `runId` and sequence. Clock and
event-ID factories are injectable for tests. Stored time and IDs are facts once
appended and are never regenerated during resume.

The runtime semantically validates the complete event history after the store's
envelope/sequence validation. At minimum it rejects:

- a missing, duplicate, misplaced, or incompatible `RunCreated`;
- duplicate event IDs, including a collision with an event already in history;
- lifecycle events before `RunStarted`;
- an event after a terminal event;
- a duplicate terminal event;
- unknown nodes or edges;
- non-contiguous or regressing attempts for one node;
- a start, outcome, or retry without its required predecessor;
- more than one outcome for one attempt;
- a success after a node already settled;
- an incorrect payload hash, graph revision, input hash, output hash, activity
  key, or result payload;
- a terminal result inconsistent with the folded history.

Semantic violations fail with `INVALID_RUN_HISTORY`. Corrupt bytes and invalid
event envelopes retain the persistence layer's structured corruption error.

The writer applies the same requirements before append. Failure of an injected
clock or event-ID factory, an invalid generated timestamp or ID, and an event
construction error are durability failures. They latch `DURABILITY_STORE_FAILED`
and stop new scheduling just like an event-store append failure; they are never
returned as raw host-language exceptions while sibling work continues writing.

## Event payloads

`RunCreated.data` has this exact shape:

```json
{
  "contractVersion": "scheduler-recovery/v1alpha1",
  "graphHash": "<64 lowercase hex>",
  "implementationHash": "<64 lowercase hex>",
  "input": ["o", []],
  "inputHash": "<64 lowercase hex>",
  "maxTotalAttempts": 8
}
```

`RunStarted.data` is an empty object. `RunResumed.data` contains node IDs in
graph declaration order:

```json
{
  "reusedNodeIds": ["left"],
  "interruptedNodeIds": ["right"]
}
```

`NodeScheduled.data` contains the detached bound input and recovery identity:

```json
{
  "input": ["o", [["seed", ["i", 1]]]],
  "inputHash": "<64 lowercase hex>",
  "activityKey": "<64 lowercase hex>",
  "sideEffects": "none"
}
```

`NodeStarted.data` contains `inputHash` and `activityKey`. A normal scheduler
append writes `NodeScheduled` immediately followed by `NodeStarted` in one CAS
batch. A durable `NodeStarted` is the attempt claim: it consumes both the node
retry budget and the global attempt budget before executor code runs.

The stable logical activity key is:

```text
durableJsonHash([
  "activity/v1alpha1", runId, graphRevision, nodeId, inputHash
])
```

Attempt is deliberately excluded. Executors receive `runId`, `attemptId`, and
`idempotencyKey`/`activityKey` in their durable execution context.

`NodeSucceeded.data` contains `inputHash`, the tagged detached validated output, and its
canonical `outputHash`. The runtime appends `NodeSucceeded` and every outgoing
`EdgeEmitted` in one CAS batch; edge events are ordered by edge ID using Unicode
code-point order. Each `EdgeEmitted.data` contains the producer `outputHash`.

`NodeAttemptFailed.data` has this shape:

```json
{
  "terminal": false,
  "failure": {
    "phase": "execute",
    "code": "NODE_EXECUTION_INTERRUPTED",
    "message": "process ended before the attempt outcome was durably recorded",
    "nodeId": "right",
    "attempt": 1,
    "retryable": true,
    "causeName": "ProcessLost"
  }
}
```

Some scheduler outcomes settle a node without starting a new attempt: missing
executor configuration, deterministic input-binding failure, upstream failure,
attempt-budget exhaustion, or cancellation before dispatch. They are not left
as unaudited fields inside the terminal snapshot. The scheduler commits a
`NodeSettledWithoutAttempt` event before releasing dependants. Its data object
has exactly one `result` field containing Tagged Durable JSON. The decoded value
is the same exact node-result object used in the terminal result: `nodeId`, topological
`sequence`, `status`, `attempts`, optional bound `input`, and a structured
`failure`. Its status must be `failed` or `skipped`; it cannot contain an
`output`; its attempt count and failure identity must equal the folded history.
Input presence is significant: an absent `input` means input binding never
completed, while an explicitly present tagged null is a successfully bound JSON
null input.
The envelope requires `nodeId` and omits `attempt`. The fold treats this event as
both the node's first scheduling fact when no `NodeScheduled` exists and its
completion fact. Consequently every terminal node result is derived from an
explicit node outcome event rather than trusted only because it appears in the
terminal snapshot.

When another attempt is allowed, the same CAS batch appends `NodeRetried` after
`NodeAttemptFailed`. `NodeRetried.attempt` names the next attempt, and its data
contains the absolute RFC 3339 `availableAt` time and `activityKey`. The retry
event does not consume a budget; the next `NodeStarted` does. Resume waits only
the remaining delay, rather than restarting the whole backoff.

A retry reservation is exclusive. Once `NodeRetried` reserves attempt `N`, a
late `NodeStarted` for an older attempt cannot reopen the node, and a second
`NodeStarted` cannot follow a recorded outcome. Pending retry reservations count
against the global attempt budget even before their corresponding starts.

The terminal `RunSucceeded`, `RunFailed`, or `RunCancelled` event stores a
tagged portable `result` snapshot in `data`. This makes terminal resume idempotent and
allows it to return the recorded result without rerunning scheduling logic.
Every graph node must have an explicit folded outcome and no retry reservation
may remain pending before a terminal event is valid.

Structured failure identity is cross-language data; human diagnostic prose is
not. Consumers validate deterministic fields such as phase, code, node ID,
attempt, retryability, output name, and port when applicable, but preserve and
accept a producer's non-empty `message` and optional host-specific cause name.
The synthetic `NODE_EXECUTION_INTERRUPTED` message and `ProcessLost` cause are
the exception: both are canonical facts defined above. An output-binding
failure has the portable fields `phase`, `code`, `message`, `outputName`,
`nodeId`, and optional `port`; it does not acquire attempt or retryability fields.

## Commit-before-release invariant

For every attempt, persistence and execution are ordered as follows:

```text
NodeScheduled + NodeStarted committed
  -> executor may run
  -> output validates and detaches
  -> NodeSucceeded + EdgeEmitted committed
  -> dependants may become ready
```

For a node that settles without dispatch, the corresponding invariant is
`NodeSettledWithoutAttempt committed -> dependants may become ready`.

An append failure is never converted to a successful node. A dependent cannot
start, be scheduled, or observe an output until the success batch has returned
successfully. Parallel append calls for one run are serialized locally, and each
uses the last successful sequence as its expected version.

A compare-and-swap conflict stops new scheduling and surfaces
`RESUME_CONFLICT`; it is never blindly retried. Executors already in flight may
still have produced external effects, which is one reason CAS is not a lease.

## Recovery projection

Resume reads and folds the complete event stream before claiming continuation.
The fold reconstructs:

- original graph input;
- successful node inputs and outputs;
- final node failures;
- claimed attempts per node and globally;
- retry availability times;
- open `NodeStarted` attempts;
- run terminal state and recorded result.

It then appends `RunResumed` with expected-version CAS before executor code is
allowed to run. A losing resume returns `RESUME_CONFLICT` and invokes no
executor. The scheduler seeds committed successful results into its normal
ready-queue engine. Those nodes are never executed again, and their dependants
consume their recorded outputs.

An open `NodeStarted` has an unknown outcome. Resume records a synthetic
`NODE_EXECUTION_INTERRUPTED` outcome before deciding whether to continue:

- `sideEffects: "none"` may retry automatically;
- `sideEffects: "idempotent"` may retry with the same activity key; the
  application is responsible for actually passing that key to the external
  system;
- `sideEffects: "non-idempotent"` or an omitted declaration may not retry.
  This contract fails closed with `IN_DOUBT_SIDE_EFFECT`. An auditable
  application approval/reconciliation protocol is intentionally outside this
  v1alpha1 slice and must not be simulated by silently reinvoking the executor.

The interrupted attempt remains consumed. Its successor uses attempt `N + 1`.
If either the per-node or global attempt budget is exhausted, the node settles
as failed without invoking an executor.

Cancellation signals do not survive a process. A committed `RunCancelled` is
terminal. A crash without a terminal cancellation event is recovered from its
durable node history under the same unknown-outcome rules.

## Terminal idempotence

When a valid terminal event already exists, resume:

- returns its recorded graph result;
- appends no event;
- saves no checkpoint;
- invokes no executor;
- reports every node/output/failure exactly as recorded.

## Checkpoints

Scheduler recovery in this revision is correct from events alone. Checkpoint
integration is optional acceleration and must not weaken that behavior.

When implemented, a scheduler checkpoint must contain the last applied event
sequence, graph/input/implementation hashes, a history-prefix hash, total
attempts, and node projections in graph declaration order. Inputs and outputs
use tagged Durable JSON so the checkpoint's safe-integer-only state remains
valid even when runtime values contain finite decimals.

A checkpoint must never lead the event stream. Missing, stale, corrupt,
ahead-of-tail, or projection-inconsistent checkpoints are ignored with a
structured recovery warning and rebuilt from events. Event corruption is never
hidden by a checkpoint. Checkpoint writes occur only after authoritative event
commit and before a dependent is released if the configured policy requires a
fresh cache. This document does not make checkpoint availability a correctness
requirement.

## Stable durable error codes

- `RUN_NOT_FOUND`
- `RUN_ALREADY_EXISTS`
- `GRAPH_HASH_MISMATCH`
- `INPUT_HASH_MISMATCH`
- `IMPLEMENTATION_MISMATCH`
- `INVALID_RUN_HISTORY`
- `NODE_EXECUTION_INTERRUPTED`
- `IN_DOUBT_SIDE_EFFECT`
- `RESUME_CONFLICT`
- `DURABILITY_STORE_FAILED`

Persistence codes such as `UNSAFE_IDENTIFIER`, `VERSION_CONFLICT`,
`CORRUPT_EVENT_LOG`, and `PERSISTENCE_IO` remain available as causal detail.

## Explicit limits

This contract supports continuation only for one static revision-1 DAG. The
local JSONL store is documented for one coordinating process and private local
storage. CAS detects stale writes; it does not prevent two processes from
executing external work before one loses a write race. Distributed resume needs
a real lease/fencing provider.

External effects are at-least-once. A crash can occur after the outside system
commits and before `NodeSucceeded` commits. Stable activity keys, idempotent
remote APIs, reconciliation, compensation, and human approval are application
responsibilities. This revision does not expose an approval callback or record
an approval decision. The project does not claim universal exactly-once
execution.

All scheduler durations that reach a host timer are bounded to a signed 32-bit
millisecond interval. `initialDelayMs` and `maxDelayMs` are in
`0..2147483647`; `timeoutMs` and `maxDurationMs` are in `1..2147483647`.
Larger values fail graph compilation with `GE1007_INVALID_GRAPH`. Count budgets
remain independent safe integers subject to their existing field-specific
limits. Date arithmetic or host timer failures after compilation latch
`DURABILITY_STORE_FAILED` instead of silently overflowing, wrapping, or running
immediately.
