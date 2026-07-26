# Bounded pipeline semantics v1alpha1

This document fixes the observable contract for the standalone TypeScript
`runPipeline` and Python `run_pipeline` APIs. A pipeline accepts a sequence of
portable JSON items and moves each item through the same ordered stages. Items
may occupy different stages at the same time; there is no implicit whole-stage
barrier.

This API is deliberately independent from `runGraph`. It does **not** activate
Graph IR `edge.mode: "stream"`, change the one-result-per-node scheduler model,
or add item-level events to durable graph recovery. Those integrations require
a later protocol revision with item identities, offsets, acknowledgements,
stream fan-in rules, and crash-safe queue reconstruction.

## Public concepts

A pipeline has four bounded parts:

1. a synchronous or asynchronous item source;
2. an immutable, ordered list of stages;
3. bounded queues between adjacent stages; and
4. a global in-flight window that connects consumer demand back to source
   demand.

Every accepted item reaches one structured terminal status. Failed items are
never represented by `null`, silently removed, or converted to an absent array
entry. JSON `null` remains a valid input and output value.

Native APIs use their language naming conventions. The field names shown in
this document use the camel-case portable projection used by conformance
fixtures and documentation.

### Native lifecycle surface

TypeScript exposes a synchronous factory with this semantic surface:

```ts
runPipeline(source, stages, options?): PipelineRun

interface PipelineRun extends AsyncIterableIterator<PipelineItemResult> {
  readonly completion: Promise<PipelineSummary>;
  close(reason?: unknown): Promise<PipelineSummary>;
}
```

`PipelineRun[Symbol.asyncIterator]()` returns the same object. Its iterator
`return()` delegates to `close()` so breaking a `for await` loop initiates
cleanup. `close()` is idempotent and resolves to the same terminal summary as
`completion`.

Python exposes the corresponding synchronous factory and async iterator:

```python
run_pipeline(source, stages, **options) -> PipelineRun

PipelineRun.__aiter__() -> PipelineRun
await PipelineRun.__anext__() -> PipelineItemResult
await PipelineRun.completion() -> PipelineSummary
await PipelineRun.aclose() -> PipelineSummary
async with PipelineRun: ...
```

`aclose()` is idempotent and returns the same terminal summary as
`completion()`. Because breaking an `async for` over an arbitrary custom Python
iterator does not portably call `aclose`, examples use the async context manager.

Both factories validate and copy options and stages synchronously. They do not
advance the source until the first consumer read or context entry. Each run is
single-pass and not replayable. Repeated calls to the language's iterator-symbol
method return the same iterator object; concurrent attempts to advance it fail
explicitly instead of racing terminal delivery.

## Stage contract

A stage has the following logical shape:

```text
PipelineStage {
  id: string
  handler: PipelineHandler
  concurrency: positive integer = 1
  timeoutMs?: non-negative integer
  retry?: {
    maxAttempts: positive integer = 1
    initialDelayMs: non-negative number = 0
    backoffMultiplier: finite number >= 1 = 1
    maxDelayMs?: non-negative number
  }
  onFailure: "stop" | "drop" | "dead-letter" = "dead-letter"
}
```

Stage IDs are non-empty and unique by exact string comparison. The stage list,
configuration values, and handler references are copied before execution can
yield. Mutating the caller's list or stage objects after construction cannot
change a live pipeline.

The handler receives a read-only context with:

- `input`: a detached portable JSON snapshot of the preceding value;
- `itemIndex`: the zero-based admission index;
- `stageId` and `stageIndex`;
- `attempt`: the one-based attempt within this item and stage; and
- a cooperative cancellation signal.

The handler returns one portable JSON value, synchronously or asynchronously.
Its result is detached and validated before the item can enter the next queue.
The pipeline does not infer mappings, flatten collections, or merge values.
Those are explicit stages.

## Options and numeric bounds

The common options are:

```text
PipelineOptions {
  bufferCapacity: positive integer = 16
  maxInFlight: positive integer = 16
  maxItems: positive integer = 1000
  maxStages: positive integer <= 2048 = 2048
  ordering: "input" | "completion" = "input"
  cancellationSignal?: caller-owned signal
}
```

`bufferCapacity`, `maxInFlight`, `maxItems`, `maxStages`, every stage `concurrency`, and
`maxAttempts` must be mathematical integers in `[1, 2^53 - 1]`. Booleans are
not integers. Timer values must be finite, non-negative, no larger than
`2^31 - 1` milliseconds, and cannot be booleans. `backoffMultiplier` must be
finite and at least one. Invalid configuration fails before the source is
advanced or a handler is called.

An option receives its default only when it is omitted (or is JavaScript
`undefined`). Explicit `null` is not an omission and is invalid for every
configuration field. This rule does not affect item values: JSON `null` remains
a valid pipeline input and output.

`maxItems` is a hard admission budget, including invalid input items. Before
requesting another source value, the producer checks whether `maxItems` values
have already been accepted. At the limit it stops without probing the source
again and reports `ITEM_LIMIT_REACHED` after accepted work drains. Even a source
that is infinite or controlled by an adversary therefore cannot create
unbounded total dynamic work.

The maximum possible handler-attempt count is statically bounded by:

```text
maxItems * sum(stage.retry.maxAttempts or 1)
```

Construction rejects a configuration when that product is not a safe integer.
This derived attempt budget is not a usage estimate: no conforming execution
can exceed it.

Construction copies at most `maxStages` declarations and rejects a stage
sequence that contains another value beyond that bound. `maxStages` itself may
not exceed 2048. This check is synchronous and occurs before the item source is
constructed, so an accidental infinite stage generator terminates with a
configuration error instead of hanging the factory forever. An implementation
may request the one overflow value needed to distinguish an exact-length
sequence from an over-limit sequence, but it never invokes a handler or advances
the item source during configuration validation.

If stage enumeration exits abruptly because of overflow or another validation
error, the implementation requests synchronous iterator cleanup when the host
iterator exposes it. Cleanup is best-effort: a failing cleanup hook cannot mask
the deterministic configuration error that caused the unwind.

This finite pull count cannot preempt one malicious synchronous iterator
`next()` call or property getter that never returns. Such caller code shares the
ordinary synchronous-host limitation and must be isolated by a process boundary
when it is not trusted.

Implementations may reject capacities that cannot be represented safely by the
host runtime before allocating queues. They must not silently clamp an invalid
public value.

## Admission and source backpressure

An item is **accepted** after all of the following occur:

1. the pipeline has acquired one global in-flight credit;
2. the source returns a non-terminal item;
3. the item receives the next monotonically increasing `itemIndex`; and
4. the pipeline takes, or attempts to take, its portable JSON snapshot.

The producer must acquire credit **before** requesting the next source item. A
source returning end-of-stream consumes no credit. It also checks the item
budget before acquiring credit or calling the iterator. At all observable times:

```text
accepted - emitted <= maxInFlight
```

Credit is released when the corresponding terminal result is returned to the
consumer, not merely when the last stage finishes. A slow consumer therefore
fills a bounded terminal/reorder buffer, exhausts the in-flight window, fills
upstream queues, and eventually stops the runtime from pulling the source.
This is end-to-end backpressure rather than a concurrency limit with an
unbounded result array behind it.

Source-to-first-stage and stage-to-stage queue occupancy cannot exceed
`bufferCapacity`. A running handler does not count as queued. All queues and
the final reorder buffer are additionally bounded by `maxInFlight` because one
credit follows each accepted item until emission.

A synchronous source or synchronous handler can block its event-loop thread.
The runtime cannot preempt arbitrary synchronous code; applications that need
responsive backpressure and cancellation must use cooperative asynchronous
sources and handlers or isolate blocking work.

## Pipeline flow and absence of barriers

Stages are ordered for one item, but different items are independent. After an
item succeeds at stage `N`, it may enter stage `N + 1` as soon as queue capacity
and a stage slot are available. It never waits for other items to finish stage
`N`.

With stage concurrency greater than one, items may leave a stage in completion
order. The `ordering` option controls only terminal delivery to the pipeline
consumer; it does not serialize internal stage execution, downstream delivery,
or side effects. This distinction is required so a slow early item cannot
silently recreate a barrier for a fast later item.

Stage concurrency counts active handler attempts. Waiting in a queue, waiting
for a retry delay, and waiting for terminal delivery do not count as active
handler attempts. The observed active attempts for a stage must never exceed
that stage's configured concurrency.

An empty stage list is a valid identity pipeline. Each valid source item
succeeds with a detached output equal to its detached input and with zero
completed stages and zero attempts. An empty source succeeds without emitting
an item result.

## Output ordering

`ordering: "input"` is the default. Terminal results are delivered in ascending
`itemIndex`, even if later items finish first. Implementations use a bounded
reorder buffer; a missing early result can delay consumer delivery but cannot
cause unbounded admission.

`ordering: "completion"` delivers terminal results in the order in which their
terminal outcomes commit to the pipeline coordinator. Exact order between
simultaneous completions is not a cross-language conformance promise. Every
result still retains its deterministic `itemIndex`.

An implementation cannot switch ordering during a run. A single pipeline run
is one non-replayable iterator. Concurrent calls that attempt to advance it fail
explicitly.

## Item result

Every accepted item that can be delivered has one terminal result:

```text
PipelineItemResult {
  itemIndex: non-negative integer
  status: "succeeded" | "failed" | "dropped" | "cancelled"
  inputBound: boolean
  input?: JsonValue
  output?: JsonValue
  completedStages: non-negative integer
  totalAttempts: non-negative integer
  failure?: PipelineItemFailure
}
```

Rules:

- `inputBound` distinguishes an invalid input from valid JSON `null`. `input`
  is present exactly when `inputBound` is true.
- `output` is present exactly for `succeeded`, including when the output is JSON
  `null`.
- `failure` is absent exactly for `succeeded` and present for every other
  status.
- `completedStages` counts stages whose validated output was accepted for this
  item. A handler return that fails output validation does not increment it.
- `totalAttempts` is the sum of handler attempts across all stages for the
  item. Queue waits and invalid input snapshots are not attempts.
- Result input, output, and failure data are detached from caller- and
  handler-owned mutable containers.

The stable item failure shape is:

```text
PipelineItemFailure {
  code: PipelineFailureCode
  message: string
  itemIndex: non-negative integer
  stageId?: string
  stageIndex?: non-negative integer
  attempt: non-negative integer
  retryable: boolean
  causeName?: string
}
```

The stable codes are:

| Code | Meaning |
|---|---|
| `INVALID_INPUT` | The accepted source value is not portable JSON. |
| `STAGE_EXECUTION_FAILED` | A handler threw, rejected, or cancelled itself without pipeline cancellation. |
| `STAGE_TIMEOUT` | The configured stage-attempt timer won. |
| `INVALID_OUTPUT` | A handler returned a value outside portable JSON. |
| `ITEM_CANCELLED` | Pipeline cancellation prevented the item from completing. |

`message` and `causeName` are diagnostic and need not be byte-identical across
languages. Code, indices, stage identity, status, attempts, and presence rules
are conformance fields.

An item result is terminal, so its `retryable` field is always `false`. A failed
attempt was retryable only when the runtime actually scheduled another attempt;
intermediate attempt records are not part of this API.

## Retries and timeouts

Each stage owns a bounded per-item attempt budget. `maxAttempts` includes the
first attempt. A failure may retry only for `STAGE_EXECUTION_FAILED` or
`STAGE_TIMEOUT`, while attempts remain and the pipeline is not cancelled.
`INVALID_INPUT`, `INVALID_OUTPUT`, and `ITEM_CANCELLED` never retry.

The delay before attempt `k + 1`, after attempt `k` fails, is:

```text
min(maxDelayMs, initialDelayMs * backoffMultiplier^(k - 1))
```

When `maxDelayMs` is absent it equals `initialDelayMs`. The implementation must
calculate without producing a non-finite host timer and clamp only the computed
delay to the already validated configured maximum. Retry delay is cancellable
and does not occupy a stage concurrency slot.

A timeout starts immediately before the handler is invoked, after the item has
obtained its stage concurrency slot. Queue time and retry delay do not consume
the timeout. Timeout or cancellation asks the handler to stop cooperatively.
If user code ignores that signal, the pipeline may detach and observe its late
outcome so the pipeline itself can terminate; the external side effect may
still occur.

Retries are at-least-once attempts. A handler with external effects must be
idempotent or use an application-provided idempotency key derived from stable
item and stage identity. This standalone pipeline does not persist retry claims
and does not promise exactly-once effects.

## Final failure policies

The stage policy applies only after a failure cannot retry:

- `dead-letter`: the item stops before downstream stages and emits `failed`.
  Other items and source intake continue.
- `drop`: the item stops before downstream stages and emits `dropped` with its
  failure. The explicit terminal result is the audit record; drop never means
  silent disappearance.
- `stop`: the item emits `failed`, source intake is requested to stop, and no
  later source item may be deliberately accepted. Items already accepted drain
  to their own terminal outcomes. They are not discarded merely because a
  sibling triggered stop.

The accepted set at a concurrent stop boundary may include items pulled before
the final failure committed, up to `maxInFlight`. Every member of that set is
accounted. Implementations call the source iterator's close/return hook when it
exists. A source that ignores close is an application limitation and may be
detached after its eventual outcome is observed.

An exception raised only by the source close/return hook is observed for cleanup
and diagnostics but does not replace the first run-level failure or turn an
otherwise explicit consumer close into a different terminal cause.

An invalid accepted input produces a `failed` item and intake continues. Source
iteration failure is a run-level failure, not a fabricated item.

## Cancellation and consumer close

Caller cancellation has priority once observed. The runtime stops intentional
source intake, wakes queue and retry waiters, signals active handlers, and
settles every accepted non-terminal item as `cancelled`. No new handler attempt
starts after cancellation is observed.

Closing a run early is explicit cancellation initiated by the consumer. The
runtime may be unable to deliver terminal results after the consumer refuses
further items, but it must account for accepted work in the final summary and
must not leak its own producer, worker, coordinator, timer, or listener tasks.
Late outcomes from non-cooperative user code are observed so they do not become
unhandled exceptions.

Language-level cancellation of the consumer task remains language-level
cancellation. Cleanup APIs must be used in a `finally`/`using` or async context
manager. Merely abandoning a custom async iterator without closing it is not a
portable cleanup guarantee.

## Run failures and summary

A source iterator exception stops intake and is recorded as:

```text
PipelineRunFailure {
  code: "SOURCE_FAILED" | "ITEM_LIMIT_REACHED"
  message: string
  causeName?: string
}
```

Already accepted items drain unless caller cancellation or consumer close ends
the run. Source failure is not assigned an `itemIndex` because the source did
not produce an accepted item.

Reaching `maxItems` records `ITEM_LIMIT_REACHED`, stops without one extra source
pull, and drains accepted work. Because the runtime deliberately does not peek,
it reports the limit whenever exactly `maxItems` items were accepted, even when
the caller believes the source would have ended next. Callers processing a
known finite collection should set a limit strictly above the expected length.

After exhaustion or explicit close, completion exposes:

```text
PipelineSummary {
  status: "succeeded" | "failed" | "cancelled"
  accepted: non-negative integer
  emitted: non-negative integer
  succeeded: non-negative integer
  failed: non-negative integer
  dropped: non-negative integer
  cancelled: non-negative integer
  maxObservedInFlight: non-negative integer
  stageMaxObservedConcurrency: { [stageId]: non-negative integer }
  stageMaxObservedQueueDepth: { [stageId]: non-negative integer }
  runFailure?: PipelineRunFailure
}
```

`accepted` equals the sum of terminal status counts after normal drain or
explicit close. `emitted` can be smaller only when the consumer closes before
accepting all terminal records. Natural exhaustion has `emitted == accepted`.
`maxObservedInFlight <= maxInFlight`; observed queue depths cannot exceed
`bufferCapacity`.

Summary status precedence is:

1. caller cancellation or consumer close -> `cancelled`;
2. run failure or any failed/dropped item -> `failed`;
3. otherwise -> `succeeded`.

A completion awaitable is allowed to remain pending while an open consumer has
not drained bounded results; silently collecting an unbounded output array to
make completion finish would violate this contract. Explicit close must always
initiate cleanup and make completion settle without requiring further reads.

## Snapshot and mutation isolation

Portable JSON uses the same finite, cycle-free, safe-integer boundary as the
ordinary runtimes. At minimum implementations detach:

- each source value at admission;
- the input supplied to every attempt;
- every handler output before downstream release;
- result values retained for terminal delivery; and
- configuration and stage metadata before execution.

Mutating the original source item after it is pulled, a previous handler input,
a returned handler object, the stage array, or option objects cannot alter
already admitted or future pipeline semantics. Handler functions themselves are
opaque application capabilities and are referenced, not serialized.

## Durable and Graph IR boundary

Calling a standalone pipeline inside a graph node treats the complete pipeline
as part of that one node attempt. The pipeline iterator is not portable JSON
and cannot be returned as a graph node output. An application may explicitly
materialize a bounded result, but a crash can replay the entire node attempt.

Inner pipeline attempts do not consume the enclosing graph's
`maxTotalAttempts`. Applications must include their multiplicative retry cost
in budgets and must not claim item-level recovery. For a non-idempotent durable
node, a crash remains in doubt under the durable recovery rules.

Until a later specification says otherwise:

- `edge.mode: "stream"` remains declarative and is not lowered by `runGraph`;
- graph fan-in still waits for one terminal result per upstream node;
- durable `EdgeEmitted` remains a single value-edge marker;
- no queue contents, item offsets, or item acknowledgements are persisted; and
- stream joins, windows, materializing barriers, replay, and fork are outside
  this standalone API.

Documentation and status tables must preserve this boundary rather than imply
that standalone in-memory flow is crash-safe stream execution.

## Minimum conformance obligations

Both native runtimes must test:

- a fast later item entering a downstream stage before a slow earlier item
  finishes, proving the absence of a whole-stage barrier;
- source pull-ahead and every queue high-water staying within configured bounds;
- input-order delivery with internally completion-ordered flow;
- completion-order delivery without loss or duplicate indices;
- exact per-stage concurrency maxima;
- bounded retry counts, deterministic delays, timeout, and cancellation;
- `stop`, `drop`, and `dead-letter` with every accepted item accounted;
- invalid input versus valid JSON `null`, and invalid stage output;
- source failure after a prefix of accepted items;
- hard item-limit termination without an extra source pull, plus rejection of
  an unsafe derived attempt bound;
- pre-cancellation, cancellation while queued/running/in retry delay, and
  explicit early close;
- mutation isolation for source values, outputs, stages, and handler maps;
- empty source, empty stages, invalid numeric configuration, and duplicate IDs;
- a large run demonstrating fixed queue/in-flight high-water; and
- no runtime-owned task, timer, or listener leak after normal completion or
  close.

Timing-only sleeps are insufficient for the no-barrier and backpressure claims.
Tests use gates, probes, or deterministic coordination so overloaded CI hosts do
not turn semantic checks into flaky benchmarks.
